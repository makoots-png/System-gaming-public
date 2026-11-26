// zones.ts: a lasting field on the ground (docs/agent-handoff/rw/design.md sections 4.7 and 4.8). A zone is ground (a fixed
// list of tiles, or a radius around an anchor: a place or a body) with an owner (a combatant, or null for the GM and the
// map), the side it spares, an end in fight time (null: until removed) and status ops, which it applies to whoever stands
// in it. A body inside holds the zone's ops as a status that the zone gives it on entry (`hold`), so a zone pays per
// round through the statuses' own settle, pro rata for the time inside, and holds a slow, a root or a stat only while the
// body stands in it. `zoneSync` is the one function that lays a zone's tiles, puts a hold on or takes it off, and keeps the
// auras a status gives off; the reducer calls it after every change of a place, a zone or the time. Burning ground, a fog
// that slows, lava and an aura are zones; terrain (space.ts) is what a tile is, a zone what the ground does.
import type { Tick } from './timeline.ts';
import { isUp } from './row-hp.ts';
import { isMinionOf } from './summons.ts';
import { amountOp, perRound, statusKey, statusOn, withStatuses } from './effect-ops.ts';
import type { AuraOn, Body, Due, LandOp, Op, OpRules, Status, StatusKey } from './effect-ops.ts';
import type { Trigger } from './triggers.ts';
import type { CombatantId } from './ability-types.ts';
import { terrain, TERRAIN, tiles, tilesOf } from './space.ts';
import { harmful } from './standing.ts';
import type { Grid, Place, Side, Tiles } from './space.ts';
import type { Id } from '../ids.ts';

/** A zone's id in its fight (or its map): at most 40 characters. */
export type ZoneId = Id<'ZoneId'>;
export const zoneId = (s: string): ZoneId => s as ZoneId;

/**
 * What an `around` zone is laid around (design 4.8): a place (the centre of a blast's field), or a body (an aura). A
 * body's aura from a status it bears names that status (`status`) and never holds its bearer; one an ability left
 * around its user has `status` null and holds the user as any body.
 */
export type Anchor =
  | { readonly kind: 'place'; readonly at: Place }
  | { readonly kind: 'body'; readonly id: CombatantId; readonly status: StatusKey | null };
/**
 * Where a zone lies: a fixed list of tiles (what the GM paints, a map's zones, a line's field), or the tiles within
 * `radius` of its anchor that the anchor sees, worked out again on every `zoneSync` (`zoneTiles`) and never stored.
 */
export type Ground =
  | { readonly kind: 'tiles'; readonly tiles: readonly Place[] }
  | { readonly kind: 'around'; readonly anchor: Anchor; readonly radius: Tiles; readonly grow: Growth | null };
/**
 * How an `around` zone grows (design 4.8): `step` tiles of radius at each whole round since `from`, the time it was laid,
 * up to `cap`.
 */
export type Growth = { readonly step: Tiles; readonly cap: Tiles; readonly from: Tick };
/** The radius of an `around` ground at `now`: `min(cap, radius + step * whole rounds since from)` when it grows. */
export function radiusAt(g: Extract<Ground, { kind: 'around' }>, now: Tick, R: { readonly fight: { readonly round: number } }): Tiles {
  const w = g.grow;
  return w ? tiles(Math.max(g.radius, Math.min(w.cap, g.radius + w.step * Math.floor(Math.max(0, now - w.from) / R.fight.round)))) : g.radius;
}

/**
 * A lasting field: its `ground`, the one who made it (null: the GM or the map), the side it does not touch (null:
 * everyone), the tier its ops are read at (its owner's rank, or the GM's choice), its end (null: until removed) and
 * whether it ends when its owner goes down. Its `ops` are status ops: a per-round op pays for the time a body stands
 * inside, an op `when: 'use'` pays once on each entry, and a slow, a root or a stat holds while the body is inside.
 */
export type Zone = {
  readonly id: ZoneId;
  readonly name: string;
  readonly ground: Ground;
  readonly owner: CombatantId | null;
  readonly spares: Side | null;
  /** When true, only minions owned by `owner` stand in this zone (`aura` with `on: 'minions'`). */
  readonly minionsOnly?: true;
  readonly tier: number;
  readonly until: Tick | null;
  readonly endsWithOwner: boolean;
  readonly ops: readonly Op[];
} & ZoneKit;
/**
 * The kits' parts of a zone (kits design 1.8), each absent when it has none: an upkeep its owner pays a round at its turn
 * start (fatigue added, mana spent), the ops that land on whoever stands in it when it ends by its time or its owner's
 * zone price at least `zoneAge` rounds after it was laid, and the triggers its hold carries (triggers.ts). `laid` is
 * when an ability left it and `paid` when its upkeep was last paid; a zone the GM or a map put down has neither.
 */
export type ZoneKit = {
  readonly upkeep?: Upkeep; readonly end?: readonly LandOp[]; readonly triggers?: readonly Trigger[];
  readonly laid?: Tick; readonly paid?: Tick;
};
/** What keeping a zone costs its owner a round: fatigue added and mana spent (kits design 1.8.1). */
export type Upkeep = { readonly fatigue: number; readonly mana: number };
/**
 * What an ability leaves (its `zone`): the zone's name, how long it lasts (null: until removed), its ops, whether it
 * ends with its user, `around`: null to lie on the shape's tiles where it lands, or the radius of an aura around its
 * user, and `grow`: null, or the tiles of radius it gains a round up to its cap (design 4.8; only a field with a centre
 * or a body grows: a radius where it lands, or an aura).
 */
export type ZoneSpec = {
  readonly name: string; readonly duration: Tick | null; readonly ops: readonly Op[]; readonly endsWithOwner: boolean; readonly around: Tiles | null;
  readonly grow: { readonly step: Tiles; readonly cap: Tiles } | null;
} & Pick<ZoneKit, 'upkeep' | 'end' | 'triggers'>;

/** At most this many zones on a fight or a map at once; at most this many tiles in one (a 40 by 40 map). */
export const MAX_ZONES = 16;
export const MAX_ZONE_TILES = 1600;
export const ZONE_NAME_MAX = 40;

// ── where a zone lies ──
/** What `zoneTiles` reads of a row: where it is, and whether it is on the map. */
type Spot = Pick<Body, 'id' | 'place' | 'life' | 'kind'>;
/** The tiles within `radius` of `centre` that `centre` sees: a blast's rule (space.ts `tilesOf`), so a wall stops a field. */
export const areaTiles = (centre: Place, radius: number, grid: Grid): Place[] =>
  [...tilesOf({ kind: 'radius', radius: tiles(radius), ring: null }, centre, centre, grid).hit];
/** The place an `around` zone is laid around, or null when its anchor body is not on the map. */
export function anchorPlace(g: Extract<Ground, { kind: 'around' }>, rows: readonly Spot[]): Place | null {
  if (g.anchor.kind === 'place') return g.anchor.at;
  const id = g.anchor.id, b = rows.find(r => r.id === id);
  return b && (isUp(b) || b.kind === 'hunter') ? b.place : null;
}
/**
 * A zone's tiles at `now`: its list, or the area of its radius at `now` around its anchor (none when its anchor body is
 * not on the map).
 */
export function zoneTiles(z: Zone, rows: readonly Spot[], grid: Grid, now: Tick, R: { readonly fight: { readonly round: number } }): Place[] {
  const g = z.ground;
  if (g.kind === 'tiles') return [...g.tiles];
  const at = anchorPlace(g, rows);
  return at ? areaTiles(at, radiusAt(g, now, R), grid) : [];
}
/** The body a zone moves with, or null for a zone that lies still. */
export const anchorOf = (z: Zone): CombatantId | null => z.ground.kind === 'around' && z.ground.anchor.kind === 'body' ? z.ground.anchor.id : null;

// ── a body's hold on a zone ──
/** The key of the hold a body took on zone `z` when it entered at `at`: one per entry, so a later entry never pays for the time between. */
const holdKey = (z: ZoneId, at: Tick): StatusKey => statusKey(`zone-${z}@${at}`);
/** The key an entry's own payment goes by (its `settle`), apart from the hold's per-round payments, which pay by time. */
export const entryKey = (hold: StatusKey): StatusKey => statusKey(`${hold}-in`);
/**
 * Whether `b` stands in `z`, laid on `at` (`zoneTiles`): on one of its tiles, of a side it does not spare, owned by
 * `z.owner` when `z.minionsOnly` is set, and not the bearer of the status the aura comes from.
 */
export const standsIn = (z: Zone, at: readonly Place[], b: Pick<Body, 'id' | 'place' | 'side'> & { readonly owner?: CombatantId | null }): boolean =>
  z.spares !== b.side
  && !(z.minionsOnly && (z.owner === null || !isMinionOf(b, z.owner)))
  && !(z.ground.kind === 'around' && z.ground.anchor.kind === 'body' && z.ground.anchor.status !== null && z.ground.anchor.id === b.id)
  && at.some(p => p.x === b.place.x && p.y === b.place.y);
/** The hold a body takes as it enters `z` at `now`: the zone's ops as a status from its owner at its tier, open while inside. */
const hold = (z: Zone, now: Tick): Status => ({
  key: holdKey(z.id, now), def: { label: z.name, desc: '', ops: z.ops, ...(z.triggers?.length ? { triggers: z.triggers } : {}) }, source: { id: z.owner, tier: z.tier },
  until: null, since: now, settledAt: now, zone: z.id,
});
/**
 * A hold closed at `at` as its body leaves (or its zone ends): it keeps only its per-round ops, which the bearer's next
 * settle pays for the time inside, and then it ends; a slow, a root or a stat stops at once. With nothing left to pay it
 * is gone.
 */
function closed(s: Status, at: Tick): Status | null {
  const owed = s.def.ops.filter(perRound);
  return owed.length && at > s.settledAt ? statusOn({ ...s.def, ops: owed }, { ...s, until: at }, s.stacks) : null;
}

/** What `zoneSync` gives back: the rows with their holds, the zones still on the ground, and what each entry pays at once. */
export type Synced = { readonly rows: Body[]; readonly zones: Zone[]; readonly entries: { readonly id: CombatantId; readonly due: Due }[] };

/** The side a status's aura spares: none, the bearer's other side (it helps allies or its minions), or the bearer's own (it hits foes). */
const sparedBy = (on: AuraOn, side: Side): Side | null => on === 'all' ? null : on === 'allies' || on === 'minions' ? (side === 'party' ? 'foe' : 'party') : side;
/** The first zone id `<prefix><now>-<n>` that no zone in `zones` has. */
export function freeZoneId(prefix: string, now: Tick, zones: readonly Zone[]): ZoneId {
  let n = 1;
  while (zones.some(z => z.id === `${prefix}${now}-${n}`)) n++;
  return zoneId(`${prefix}${now}-${n}`);
}
const sameOps = (a: readonly Op[], b: readonly Op[]): boolean => a.length === b.length && a.every((o, i) => o === b[i]);
/** Whether a status is on its bearer at `now`. */
const liveAt = (s: Status, now: Tick): boolean => s.until === null || s.until > now;
/** The ops a status's aura holds: the status's own but its `aura` and `spread` (an aura of auras would chain with no end). */
export const auraOps = (ops: readonly Op[]): Op[] => ops.filter(o => o.op !== 'aura' && o.op !== 'spread');

/**
 * The auras the statuses on `rows` give off (design 4.8), kept in `zones`: a body that is up and bears a status with an
 * `aura` op (its first) has a zone around it holding the status's other ops at the status's source tier, named for the
 * status, sparing what the op's `on` says, its radius at most the rules' `fieldRadiusMax`. It keeps its id while the
 * status stays, and takes the status's def and source when they change. One whose bearer no longer holds the status is
 * left for `stays` to drop. With `MAX_ZONES` on the ground a new one is not added.
 */
function withAuras(rows: readonly Body[], zones: readonly Zone[], now: Tick, R: OpRules): Zone[] {
  const out = [...zones];
  for (const b of rows) {
    if (!isUp(b)) continue;
    for (const s of b.statuses) {
      const op = s.zone === undefined && liveAt(s, now) ? s.def.ops.find(o => o.op === 'aura') : undefined;
      if (op?.op !== 'aura') continue;
      const radius = tiles(Math.min(op.radius, R.fight.fieldRadiusMax)), spares = sparedBy(op.on, b.side);
      const minionsOnly = op.on === 'minions', owner = minionsOnly ? (s.source.id ?? b.id) : s.source.id;
      const at = out.findIndex(z => z.ground.kind === 'around' && z.ground.anchor.kind === 'body' && z.ground.anchor.id === b.id && z.ground.anchor.status === s.key);
      const was = out[at], ops = was && sameOps(was.ops, auraOps(s.def.ops)) ? was.ops : auraOps(s.def.ops);
      if (was && was.ground.kind === 'around' && was.name === s.def.label && was.owner === owner && was.tier === s.source.tier && was.spares === spares
        && !!was.minionsOnly === minionsOnly && was.ground.radius === radius && was.ops === ops) continue;
      if (!was && out.length >= MAX_ZONES) continue;
      const zone: Zone = {
        id: was?.id ?? freeZoneId('a', now, out), name: s.def.label, ground: { kind: 'around', anchor: { kind: 'body', id: b.id, status: s.key }, radius, grow: null },
        owner, spares, ...(minionsOnly ? { minionsOnly: true as const } : {}), tier: s.source.tier, until: null, endsWithOwner: false, ops,
      };
      if (was) out[at] = zone; else out.push(zone);
    }
  }
  return out;
}

/**
 * Whether a zone is still on the ground at `now`: before its `until`; its owner up if it ends with its owner; an aura's
 * body up, and still bearing its status when a status gives it off.
 */
function stays(z: Zone, rows: readonly Body[], now: Tick): boolean {
  const up = (id: CombatantId | null): Body | undefined => rows.find(r => r.id === id && isUp(r));
  if ((z.until !== null && z.until <= now) || (z.endsWithOwner && !up(z.owner))) return false;
  if (z.ground.kind !== 'around' || z.ground.anchor.kind !== 'body') return true;
  const a = z.ground.anchor, b = up(a.id);
  return !!b && (a.status === null || b.statuses.some(s => s.key === a.status && s.zone === undefined && liveAt(s, now) && s.def.ops.some(o => o.op === 'aura')));
}

const NONE: ReadonlySet<string> = new Set();
/**
 * The one rule of a zone (design 4.7 and 4.8), at `now`. The auras of statuses are kept (`withAuras`). A zone ends at
 * its `until`, when its owner is gone or down if it ends with its owner, and an aura when its body is, or no longer
 * bears the status it comes from. Each zone left is laid on its tiles now (`zoneTiles`: an aura where its body stands).
 * Then for every body on the map: a hold on a zone it no longer stands in, or a zone that ended, is closed (at the
 * zone's end when that came first); a zone it stands in without a hold gives it one, and each of the zone's ops
 * `when: 'use'` is due once for that entry (`before` 0 and `share` 1: the op's amount, under `entryKey`), whether the
 * body stepped in or the zone came over it. Two zones on one tile each give a hold; their slows do not stack, as two
 * statuses' do not (`modsOf`). Running it twice changes nothing. A body in `forced` was moved by another's use: it takes
 * its holds but pays no entry.
 */
export function zoneSync(rows: readonly Body[], zones: readonly Zone[], grid: Grid, now: Tick, R: OpRules, forced: ReadonlySet<string> = NONE): Synced {
  const all = withAuras(rows, zones, now, R);
  const live = all.filter(z => stays(z, rows, now));
  const laid = new Map(live.map(z => [z.id, zoneTiles(z, rows, grid, now, R)] as const));
  const endOf = (id: ZoneId): Tick => { const z = all.find(x => x.id === id); return z?.until !== null && z?.until !== undefined && z.until < now ? z.until : now; };
  const entries: { id: CombatantId; due: Due }[] = [];
  const out = rows.map(b => {
    if (!isUp(b) && b.kind !== 'hunter') return b;
    let changed = false;
    const list: Status[] = [];
    for (const s of b.statuses) {
      if (s.zone === undefined || s.until !== null) { list.push(s); continue; }
      const z = live.find(x => x.id === s.zone);
      if (z && standsIn(z, laid.get(z.id)!, b)) { list.push(s); continue; }
      changed = true;
      const c = closed(s, z ? now : endOf(s.zone));
      if (c) list.push(c);
    }
    for (const z of live) {
      if (!standsIn(z, laid.get(z.id)!, b) || list.some(s => s.zone === z.id && s.until === null)) continue;
      changed = true;
      const h = hold(z, now), at = list.findIndex(s => s.key === h.key);
      // left and entered again at the same moment: the hold goes on as it was, with nothing between to pay
      if (at >= 0) list[at] = { ...h, since: list[at]!.since, settledAt: list[at]!.settledAt }; else list.push(h);
      // a forced entry (a push, a pull, a zone moved onto a body) pays no on-entry part: an entry is a body's own step (kits 8.3.4, 8.5.5)
      if (!forced.has(b.id)) for (const op of z.ops) if (amountOp(op) && op.when === 'use') entries.push({ id: b.id, due: { key: entryKey(h.key), op, tier: z.tier, before: 0, share: 1, stacks: 1, ...(z.owner === null ? {} : { sourceId: z.owner }) } });
    }
    return changed ? withStatuses(b, list, now, R) : b;
  });
  return { rows: out, zones: live, entries };
}

/** The colour family a zone is drawn in, from what its ops do: it hurts, it holds a body back (standing.ts `harmful`, the safeguard's rule), it helps, or none of these. */
export type ZoneTone = 'harm' | 'help' | 'hinder' | 'plain';
export function zoneTone(ops: readonly Op[]): ZoneTone {
  if (ops.some(o => o.op === 'damage')) return 'harm';
  if (harmful({ ops })) return 'hinder';
  if (ops.some(o => o.op === 'heal' || o.op === 'mana' || o.op === 'shield' || o.op === 'speed' || o.op === 'stat')) return 'help';
  return 'plain';
}

// ── a zone's life (kits design 1.8, table 2.6) ──
export const ZONE_STATES = ['laid', 'lapsed', 'evicted', 'ended'] as const;
export type ZoneState = (typeof ZONE_STATES)[number];
/** Where a zone of the kits stands: on the ground, gone unpaid, gone to its owner's fourth, or ended (its end landed or not). */
export type ZoneLife = { readonly at: 'laid' } | { readonly at: 'lapsed' } | { readonly at: 'evicted' } | { readonly at: 'ended'; readonly landed: boolean };
/**
 * What changes it: its owner's turn start with the upkeep paid or not; a fourth zone of its owner; its owner's zone
 * price or its time (`old`: at least `zoneAge` rounds since it was laid); its owner down.
 */
export type ZoneEvent =
  | { readonly type: 'paid' } | { readonly type: 'unpaid' } | { readonly type: 'fourth' }
  | { readonly type: 'price'; readonly old: boolean } | { readonly type: 'time'; readonly old: boolean } | { readonly type: 'ownerDown' };
export type ZoneEventType = ZoneEvent['type'];
type ZoneStepFn<E extends ZoneEventType> = (z: ZoneLife, e: Extract<ZoneEvent, { type: E }>) => { readonly to: ZoneLife; readonly lands: boolean };
const stay: ZoneStepFn<'paid'> = z => ({ to: z, lands: false });
const gone = (to: ZoneLife) => () => ({ to, lands: false });
/** Ended by its price or its time: its end lands only when it is old enough, so placing and popping in one turn is no blast. */
const ends = (_z: ZoneLife, e: { readonly old: boolean }): { readonly to: ZoneLife; readonly lands: boolean } => ({ to: { at: 'ended', landed: e.old }, lands: e.old });
/** Table 2.6 of the kits design. `null`: the event does not apply there, and nothing changes or lands. */
const ZONE_TABLE: { readonly [S in ZoneState]: { readonly [E in ZoneEventType]: ZoneStepFn<E> | null } } = {
  laid: { paid: stay, unpaid: gone({ at: 'lapsed' }), fourth: gone({ at: 'evicted' }), price: ends, time: ends, ownerDown: gone({ at: 'ended', landed: false }) },
  lapsed: { paid: null, unpaid: null, fourth: null, price: null, time: null, ownerDown: null },
  evicted: { paid: null, unpaid: null, fourth: null, price: null, time: null, ownerDown: null },
  ended: { paid: null, unpaid: null, fourth: null, price: null, time: null, ownerDown: null },
};
/** A zone's life after `event`, and whether its end lands now. Never changes its input. */
export function zoneStep(z: ZoneLife, event: ZoneEvent): { readonly to: ZoneLife; readonly lands: boolean } {
  // The table's type pairs each key with the step for that event, so the step for `event.type` takes `event`.
  const step = ZONE_TABLE[z.at][event.type] as ZoneStepFn<ZoneEventType> | null;
  return step ? step(z, event as never) : { to: z, lands: false };
}
/** Whether a zone ending at `at` is old enough for its end to land: `zoneAge` rounds since it was laid (one no ability laid always is). */
export const oldEnough = (z: Zone, at: Tick, R: OpRules): boolean => z.laid === undefined || at - z.laid >= R.fight.kit.zoneAge * R.fight.round;
/** A zone an owner made and holds (not an aura its statuses give off, which are the statuses'). */
const heldBy = (z: Zone, owner: CombatantId): boolean => z.owner === owner && !(z.ground.kind === 'around' && z.ground.anchor.kind === 'body' && z.ground.anchor.status !== null);

/**
 * A zone an ability left, put on the ground (kits design 1.8.2): when its owner already holds `zonesPerOwner`, the
 * oldest of them is evicted first, with no end. Answers the zones and the evicted.
 */
export function placeZone(zones: readonly Zone[], z: Zone, R: OpRules): { zones: Zone[]; evicted: Zone[] } {
  if (z.owner === null) return { zones: [...zones, z], evicted: [] };
  const mine = zones.filter(x => heldBy(x, z.owner!)), over = Math.max(0, mine.length + 1 - R.fight.kit.zonesPerOwner);
  const evicted = mine.slice(0, over).filter(x => zoneStep({ at: 'laid' }, { type: 'fourth' }).to.at === 'evicted');
  return { zones: [...zones.filter(x => !evicted.includes(x)), z], evicted };
}

/**
 * A zone act (kits design 8.5.4): the zone of `owner` named (null: any of its zones) nearest `at`, else its oldest.
 * `shift` moves a fixed zone's tiles by the vector from their centre to `at`, cut to `by` tiles (tiles off the map or on
 * a tile no body may stand on drop; none left, the zone is gone), or an around-place zone's centre the same way; an aura
 * goes with its body and does not shift. `grow` widens an around zone by `by`, to `fieldRadiusMax`; a fixed zone does
 * not grow (design 4.8b). The zones after it, and the one it changed (null when nothing changed).
 */
export function zoneActed(zones: readonly Zone[], owner: CombatantId, act: { readonly act: 'shift' | 'grow'; readonly name: string | null; readonly by: number }, at: Place, rows: readonly Spot[], grid: Grid, now: Tick, R: OpRules): { zones: Zone[]; acted: Zone | null } {
  const mine = zones.filter(z => heldBy(z, owner) && (act.name === null || z.name === act.name));
  if (!mine.length) return { zones: [...zones], acted: null };
  const near = (z: Zone) => Math.min(...zoneTiles(z, rows, grid, now, R).map(t => Math.max(Math.abs(t.x - at.x), Math.abs(t.y - at.y))), Infinity);
  const z = [...mine].sort((p, q) => near(p) - near(q))[0]!;
  const g = z.ground;
  let ground: Ground | null = g;
  const toward = (c: Place): { dx: number; dy: number } => {
    const dx = at.x - c.x, dy = at.y - c.y, n = Math.max(Math.abs(dx), Math.abs(dy));
    return n <= act.by ? { dx, dy } : { dx: Math.round(dx * act.by / n), dy: Math.round(dy * act.by / n) };
  };
  if (act.act === 'shift') {
    if (g.kind === 'tiles') {
      const cx = Math.round(g.tiles.reduce((n, t) => n + t.x, 0) / g.tiles.length), cy = Math.round(g.tiles.reduce((n, t) => n + t.y, 0) / g.tiles.length);
      const v = toward({ x: cx, y: cy } as Place);
      const list = g.tiles.map(t => ({ x: t.x + v.dx, y: t.y + v.dy }) as Place).filter(t => t.x >= 0 && t.y >= 0 && t.x < grid.w && t.y < grid.h && TERRAIN[terrain(grid, t.x, t.y)].walk);
      ground = list.length ? { kind: 'tiles', tiles: list } : null;
    } else if (g.anchor.kind === 'place') {
      const v = toward(g.anchor.at), c = { x: Math.max(0, Math.min(grid.w - 1, g.anchor.at.x + v.dx)), y: Math.max(0, Math.min(grid.h - 1, g.anchor.at.y + v.dy)) } as Place;
      ground = { ...g, anchor: { kind: 'place', at: c } };
    }
  } else if (g.kind === 'around') ground = { ...g, radius: tiles(Math.min(R.fight.fieldRadiusMax, g.radius + act.by)) };
  if (ground === g) return { zones: [...zones], acted: null };
  const changed = ground === null ? null : { ...z, ground };
  return { zones: zones.flatMap(x => x === z ? (changed ? [changed] : []) : [x]), acted: changed ?? z };
}

/**
 * The upkeep `owner` pays at its turn start at `now` (kits design 1.8.1): for each zone it holds with an upkeep, the
 * rate for the time since it was last paid (`paid`, else `laid`), fatigue added and mana spent. A zone whose upkeep the
 * owner cannot pay (mana short, or fatigue past its capacity) lapses at once, with no end; the zones before it are paid.
 */
export function payUpkeep(owner: Body, zones: readonly Zone[], now: Tick, R: OpRules): { owner: Body; zones: Zone[]; lapsed: Zone[] } {
  let o = owner;
  const out: Zone[] = [], lapsed: Zone[] = [];
  for (const z of zones) {
    if (!z.upkeep || !heldBy(z, owner.id)) { out.push(z); continue; }
    const span = Math.max(0, now - (z.paid ?? z.laid ?? now)) / R.fight.round;
    const fatigue = Math.round(z.upkeep.fatigue * span), mana = Math.round(z.upkeep.mana * span);
    const paid = mana <= o.mana && o.fatigue + fatigue <= o.sheet.fatigueMax;
    if (zoneStep({ at: 'laid' }, { type: paid ? 'paid' : 'unpaid' }).to.at === 'lapsed') { lapsed.push(z); continue; }
    o = { ...o, mana: o.mana - mana, fatigue: o.fatigue + fatigue };
    out.push({ ...z, paid: now });
  }
  return { owner: o, zones: out, lapsed };
}

/**
 * The zones a zone price takes (kits design 1.4.3): of `owner`'s zones of the price's name (any name for null), all of
 * them, or one: the one whose tiles hold `at`, else the oldest. Empty when the owner holds none.
 */
export function pricedZones(zones: readonly Zone[], owner: CombatantId, p: { readonly name: string | null; readonly take: 'one' | 'all' }, at: Place, rows: readonly Spot[], grid: Grid, now: Tick, R: OpRules): Zone[] {
  const mine = zones.filter(z => heldBy(z, owner) && (p.name === null || z.name === p.name));
  if (p.take === 'all' || !mine.length) return mine;
  return [mine.find(z => zoneTiles(z, rows, grid, now, R).some(t => t.x === at.x && t.y === at.y)) ?? mine[0]!];
}
