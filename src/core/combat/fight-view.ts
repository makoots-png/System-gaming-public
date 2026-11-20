// fight-view.ts: every number the fight screen draws (docs/agent-handoff/rw/m2-plan.md, unit P3): the order ahead, a
// combatant's card, the targets an ability can aim at, and a step toward or away from a picked body (the move control).
// Pure, and no new rule: each number comes from space.ts, timeline.ts, effect-ops.ts or a rule of resolve.ts. Aims and
// steps read `Spot`s, the little a phone knows of a row, so the GM's screen (the fight's rows through `spotOf`) and a
// player's (the room doc's rows) draw with the same code. A new number a screen draws is a function here with its case in
// tests/fight-view.test.ts.

import type { Rules } from '../rules.ts';
import { dist, place, reachable } from './space.ts';
import { inRange, whoIsIn } from './resolve.ts';
import type { Grid, Place, MoveReach, Side, Tiles } from './space.ts';
import { acted, ahead, paceCost, roundOf, roundsOf, tick } from './timeline.ts';
import type { Tick } from './timeline.ts';
import { printFormula } from '../formula.ts';
import { formulaOf } from '../registry/ability-kinds.ts';
import type { KindRules } from '../registry/ability-kinds.ts';
import type { Ability, AbilityId, CombatantId } from './ability-types.ts';
import { isUp, rowHp } from './row-hp.ts';
import type { LifeState } from '../hunter/vitals.ts';
import { sheetStatuses, statusKey } from './effect-ops.ts';
import type { Body, Channel, CombatantKind, OpRules, SheetStatus, StatusDef } from './effect-ops.ts';
import { usesOf } from './uses.ts';
import type { Fight, StatusGrant } from './fight-types.ts';

// ── the order ahead ──

/** One turn of the order ahead: whose it is (the row as the fight holds it now), when it starts, and its round from 1. */
export type Turn = { readonly row: Body; readonly at: Tick; readonly round: number };

/**
 * The next `n` turns of a running fight if everyone takes a standard action (timeline.ts `ahead`), the current turn first.
 * The current turn is `currentId`'s, at the fight's `now`, whatever has happened since it began: a row that joined at the
 * same time with a higher tie, or the current row's own move, can put another row first in `ahead`, and the GM's bar and
 * the players' doc must name the same turn and round. Only rows that are up take turns. A fight in setup or ended has no order.
 */
export function order(f: Fight, n: number, R: Rules): Turn[] {
  if (f.phase !== 'running' || n < 1) return [];
  const turn = (id: CombatantId, at: Tick): Turn => ({ row: f.rows.find(r => r.id === id)!, at, round: roundOf(at, R.fight) });
  const up = f.rows.filter(isUp), cur = up.find(r => r.id === f.currentId);
  if (!cur) return ahead(up, n, R.fight).map(t => turn(t.id, t.at));
  // The turn under way is taken as a standard action, unless the row's time has already moved past it.
  const after = cur.at > f.now ? cur : acted(cur, f.now, paceCost('standard', R.fight), R.fight);
  const rest = ahead(up.map(r => (r === cur ? after : r)), n - 1, R.fight);
  return [turn(cur.id, f.now), ...rest.map(t => turn(t.id, t.at))];
}

// ── a card ──

/**
 * What a combatant's card shows: whether it is its turn, its speed and the armor, resist and stride of its sheet, HP,
 * mana and fatigue against the sheet's maxima, its shield, a stagger bar in whole points, its statuses with the rounds
 * left (one decimal, null until removed, as the sheet keeps them) and whether it is down. A screen draws a card from this
 * alone and updates in place the parts whose value changed (src/views/patch.ts), so a new number on a card is a field here.
 */
export type Card = {
  readonly turn: boolean;
  /** Rounds the shield has left, one decimal, or null. */
  readonly shieldLeft: number | null;
  readonly channel: ChannelView | null;
  readonly intent: IntentView | null;
  readonly threat: ThreatView | null;
  readonly taunt: TauntView | null;
  readonly speed: number; readonly armor: number; readonly resist: number; readonly stride: number;
  readonly hp: number; readonly hpMax: number;
  readonly mana: number; readonly manaMax: number;
  readonly fatigue: number; readonly fatigueMax: number;
  readonly shield: number | null;
  /** The bar in whole points, and while its last break holds the monster back, the rounds a break costs (`staggerCost`). */
  readonly stagger: { readonly fill: number; readonly max: number; readonly staggered: number | null } | null;
  readonly statuses: readonly SheetStatus[];
  readonly down: boolean;
  /** A summon's rounds left, one decimal, rounded up (kits design 1.9); null for any other body and for a summon that stays. */
  readonly summon: number | null;
};

/** The time a fight's numbers are read at: its `now`, or 0 in setup, which has no time yet and where every status starts. */
export const timeOf = (f: Fight): Tick => f.phase === 'setup' ? tick(0) : f.now;

/** The card of `row` in fight `f`. The reducer drops a shield at the first turn start after its end, so a row's shield is live. */
export function cardOf(f: Fight, row: Body, R: OpRules & KindRules): Card {
  return {
    turn: f.phase === 'running' && f.currentId === row.id,
    speed: row.speed, armor: row.sheet.armor, resist: row.sheet.resist, stride: row.sheet.stride,
    hp: rowHp(row), hpMax: row.sheet.hpMax, mana: row.mana, manaMax: row.sheet.manaMax, fatigue: row.fatigue, fatigueMax: row.sheet.fatigueMax,
    shield: row.shield?.amount ?? null,
    shieldLeft: row.shield ? roundsLeft(row.shield.until, timeOf(f), R) : null,
    stagger: row.stagger && {
      fill: Math.round(row.stagger.fill), max: Math.round(row.stagger.max),
      staggered: row.stagger.until !== undefined && timeOf(f) < row.stagger.until ? R.fight.staggerCost : null,
    },
    statuses: sheetStatuses(row.statuses, timeOf(f), R),
    down: !isUp(row),
    channel: channelView(row, R),
    intent: intentOf(row, R),
    threat: threatOf(f, row, R),
    taunt: tauntOf(row, timeOf(f), R),
    summon: row.kind === 'summon' && row.until !== undefined ? roundsLeft(row.until, timeOf(f), R) : null,
  };
}

/** Rounds from `now` to `until`, rounded up to one decimal, never below 0. */
const roundsLeft = (until: Tick, now: Tick, R: { readonly fight: { readonly round: number } }): number => Math.max(0, roundsOf(until - now, R, 'up'));

// ── the extras (design 4) ──

/**
 * A channel as a card, a token and the hotbar show it while it holds or waits to fire broken: its ability's name, the charge of its max, its state, and the
 * payoff at this charge as a factor of the ability's base, by the growth its maker ticked (design 4.1: linear
 * `1 + channelLin * charge`, exponential `channelExp ^ charge`), to two decimals.
 */
export type ChannelView = {
  readonly ability: AbilityId; readonly name: string; readonly charge: number; readonly max: number; readonly state: Channel['state']; readonly factor: number;
};
export function channelView(row: Body, R: Pick<Rules, 'fight'>): ChannelView | null {
  const c = row.channel;
  // a channel that went off is spent: nothing to show until its user begins another
  if (!c || c.state === 'fired') return null;
  const a = row.abilities.find(x => x.id === c.ability), growth = a?.channel?.growth ?? 'exponential';
  const factor = growth === 'linear' ? 1 + R.fight.channelLin * c.charge : Math.pow(R.fight.channelExp, c.charge);
  return { ability: c.ability, name: a?.name ?? c.ability, charge: c.charge, max: a?.channel?.max ?? R.fight.channelMax, state: c.state, factor: Math.round(factor * 100) / 100 };
}

/** The most lines `abilityLines` gives: what it does, its shape, its range and how it is avoided. */
export const ABILITY_LINES = 4;
/**
 * The numbers of an ability in words, as a revealed intent shows them (design 4.5): what it does and its formula, its
 * shape, its range, and how it is avoided. At most four lines.
 */
export function abilityLines(a: Ability, R: KindRules): string[] {
  const out: string[] = [];
  if (a.effect) {
    const what = a.effect.type === 'heal' ? 'Heals' : a.effect.type === 'shield' ? 'Shields' : `${a.effect.type === 'physical' ? 'Physical' : 'Magical'} damage`;
    const f = formulaOf(a, R);
    if (f) out.push(`${what} ${printFormula(f)}`);
  }
  const sh = a.shape;
  if (sh.kind === 'radius') out.push(`Radius ${sh.radius} tile${sh.radius === 1 ? '' : 's'}${sh.ring ? `, ring to ${sh.ring.outer} at ${sh.ring.share}%` : ''}`);
  else if (sh.kind === 'line') out.push(`A line${sh.pierce ? ' that pierces' : ''}`);
  if (a.aim !== 'self') out.push(`Range ${a.range} tile${a.range === 1 ? '' : 's'}`);
  const d = a.delivery;
  out.push(d.kind === 'travel' ? 'Avoided by moving out of it' : d.kind === 'direct' ? 'Discipline resists it' : 'Nothing avoids it');
  return out.slice(0, ABILITY_LINES);
}

/**
 * What a monster will do, as its card and the map show it: the ability's name and its aim, whether the GM revealed its
 * numbers and those numbers (`abilityLines`), and the splash of an area ability (null for any other). A channel that holds
 * is the intent, at its charge, because the table can see it winding up (design 4.5). Null with neither.
 */
export type IntentView = {
  readonly name: string; readonly target: CombatantId | Place; readonly revealed: boolean; readonly lines: readonly string[];
  readonly area: { readonly radius: number; readonly outer: number | null } | null; readonly channel: ChannelView | null;
};
export function intentOf(row: Body, R: KindRules): IntentView | null {
  const c = row.channel?.state === 'holding' ? row.channel : null, i = c ?? row.intent;
  if (!i) return null;
  const a = row.abilities.find(x => x.id === i.ability);
  const revealed = c ? false : row.intent?.revealed === true;
  const area = a && a.shape.kind === 'radius' ? { radius: a.shape.radius, outer: a.shape.ring?.outer ?? null } : null;
  return { name: a?.name ?? i.ability, target: i.aim, revealed, lines: revealed && a ? abilityLines(a, R) : [], area, channel: c && channelView(row, R) };
}

/**
 * A monster's threat table as its card shows it (design 4.2): each body still up with an entry, highest first, with its
 * share of the table in whole percent, and the target it suggests: its taunter while a taunt holds, else the highest
 * entry. Null for a body that keeps no table. The GM may target anyone.
 */
export type ThreatView = { readonly suggest: CombatantId | null; readonly shares: readonly { readonly id: CombatantId; readonly share: number }[] };
export function threatOf(f: Fight, row: Body, R: { readonly fight: { readonly round: number } }): ThreatView | null {
  if (!row.threat) return null;
  const up = new Set(f.rows.filter(isUp).map(r => r.id as string));
  const entries = (Object.entries(row.threat) as [CombatantId, number][]).filter(([id, t]) => up.has(id) && t > 0).sort((a, b) => b[1] - a[1]);
  const total = entries.reduce((n, [, t]) => n + t, 0);
  const taunt = tauntOf(row, timeOf(f), R);
  const suggest = taunt && up.has(taunt.by) ? taunt.by : entries[0]?.[0] ?? null;
  return { suggest, shares: entries.map(([id, t]) => ({ id, share: Math.round(100 * t / total) })) };
}

/** A taunt on a body: who taunted it and the rounds it has left (null until removed). */
export type TauntView = { readonly by: CombatantId; readonly left: number | null };
export function tauntOf(row: Body, now: Tick, R: { readonly fight: { readonly round: number } }): TauntView | null {
  const s = row.statuses.find(x => x.source.id !== null && (x.until === null || x.until > now) && x.def.ops.some(o => o.op === 'taunt'));
  return s && s.source.id !== null ? { by: s.source.id, left: s.until === null ? null : roundsLeft(s.until, now, R) } : null;
}

// ── a cooldown ──

/**
 * The rounds until ability `id` is ready again, from the times its row's abilities are ready (`readyAt` of a row, or the
 * room doc's `ready` for the current row) and the fight's `now`: rounded up to one decimal, so a use not yet ready never
 * reads 0; 0 when it is ready.
 */
export function readyIn(readyAt: Readonly<Record<string, Tick>>, id: string, now: Tick, R: { readonly fight: { readonly round: number } }): number {
  const at = Object.hasOwn(readyAt, id) ? readyAt[id]! : now;
  return at <= now ? 0 : roundsOf(at - now, R, 'up');
}

// ── uses left (kits table 2.3) ──

/**
 * The uses left of each of `b`'s abilities limited a fight or a rest, by ability id, 0 for a spent one, in its ability
 * order, at most `max`: the doc's `left` for the current row, and the GM's hotbar.
 */
export function usesLeft(b: Pick<Body, 'abilities' | 'used'>, max: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const a of b.abilities.slice(0, max)) { const u = usesOf(a, b); if (u) out[a.id] = u.at === 'spent' ? 0 : u.left; }
  return out;
}

// ── the Status window ──

/**
 * What the GM's Status window sends as the `status` command's `add`: the status at the tier the window picked, lasting
 * the rounds typed (a round is `R.fight.round` ticks; null lasts until removed).
 */
export const statusGrant = (key: string, def: StatusDef, rounds: number | null, tier: number, R: { readonly fight: { readonly round: number } }): StatusGrant =>
  ({ key: statusKey(key), def, duration: rounds === null ? null : tick(Math.round(rounds * R.fight.round)), tier });

// ── aims and steps, on spots ──

/** A row as aims and steps read it: the GM's from `spotOf`, a player's from the room doc. */
export type Spot = { readonly id: CombatantId; readonly side: Side; readonly kind: CombatantKind; readonly place: Place; readonly down: boolean };
export const spotOf = (b: Body): Spot => ({ id: b.id, side: b.side, kind: b.kind, place: b.place, down: !isUp(b) });
/** The room fight doc's rows as spots (a doc's tile is plain numbers on the wire, and down is its life's), each keeping its other fields. */
export const docSpots = <T extends Omit<Spot, 'place' | 'down'> & { readonly place: { readonly x: number; readonly y: number }; readonly life: { readonly at: LifeState } }>(rows: readonly T[]): (T & Spot)[] =>
  rows.map(r => ({ ...r, place: place(r.place.x, r.place.y), down: !isUp(r) }));
/** On the map: land.ts `alive` over a spot. A monster or shadow that is down is gone; a hunter that is down lies there. */
export const onMap = (s: Spot): boolean => !s.down || s.kind === 'hunter';

/**
 * The rows a reaction before a turn of row `by` may wait for (kits design 8.4): every other row, the other side's rows
 * still up first, each part in the order given. The first is the one an arm that names no row waits for, so the GM's
 * card and a player's phone offer the same rows and wait on the same one.
 */
export function waitChoices<S extends Pick<Spot, 'id' | 'side' | 'down'>>(rows: readonly S[], by: CombatantId): S[] {
  const me = rows.find(x => x.id === by), others = rows.filter(x => x.id !== by);
  const foes = others.filter(x => !!me && x.side !== me.side && !x.down);
  return [...foes, ...others.filter(x => !foes.includes(x))];
}
/** The words of the choice of the row a reaction before a turn waits for: its label, and the window a player picks it in. */
export const WAIT_WORDS = {
  label: 'Before the turn of',
  body: (reaction: string): string => `${reaction} fires just before the turn of the one you pick.`,
} as const;

/** What aiming the ability at one candidate gives: its 5-10-5 distance, and whether rules 5 and 6 of resolve.ts let it be hit. */
export type AimAt<T extends Spot> = { readonly target: T; readonly dist: Tiles; readonly inRange: boolean; readonly inShape: boolean };
/** What `aims` reads of an ability. */
export type Aiming = Pick<Ability, 'aim' | 'range' | 'shape' | 'foesOnly'>;

/**
 * The bodies `by` can aim `a` at, nearest first (then in the order given): itself for a self ability, its side on the map
 * (itself and a hunter lying down among them) for an ally one, the other side on the map for a foe or place one. Rule 5:
 * in range when the distance is at most the range. Rule 6: in the shape when the use aimed at its tile covers it, among
 * the bodies on the map (the user's side left out of a `foesOnly` use), so a line that does not pierce stops at the first
 * body and a wall stops a line. A self or ally use takes its one target. Taunt (rule 2) is the reducer's alone: a spot
 * carries no statuses.
 */
export function aims<T extends Spot>(spots: readonly T[], by: CombatantId, a: Aiming, grid: Grid): AimAt<T>[] {
  const user = spots.find(s => s.id === by);
  if (!user) return [];
  const map = spots.filter(onMap);
  const candidates = a.aim === 'self' ? [user] : map.filter(s => (a.aim === 'ally') === (s.side === user.side));
  const covers = (t: T): boolean => {
    const { hit, ring } = whoIsIn(a, user, map, t.place, grid);
    return hit.includes(t) || ring.includes(t);
  };
  return candidates
    .map(t => ({ target: t, dist: dist(user.place, t.place), inRange: inRange(a, user, t.place), inShape: covers(t) }))
    .sort((x, y) => x.dist - y.dist);
}

/**
 * The walk of the move control: of the tiles `by` reaches in at most `stride` steps around the walls and the other bodies
 * on the map (space.ts `reachable`, in order of steps, then `y`, then `x`), the first that `better` prefers over every
 * other by its distance to the target. Null when no tile beats standing still, or a body is not on the map.
 */
function stepBy(spots: readonly Spot[], by: CombatantId, target: CombatantId, stride: Tiles, grid: Grid, better: (d: number, best: number) => boolean): MoveReach | null {
  const user = spots.find(s => s.id === by), goal = spots.find(s => s.id === target);
  if (!user || !goal || !onMap(user) || !onMap(goal)) return null;
  const others = spots.filter(s => s.id !== by && onMap(s)).map(s => s.place);
  const options = reachable(user.place, stride, grid, others);
  let best = options[0]!;
  for (const o of options) if (better(dist(o.place, goal.place), dist(best.place, goal.place))) best = o;
  return best.steps === 0 ? null : best;
}

/**
 * Toward: the reachable tile nearest the target, on a tie the fewest steps, then the lowest `y`, then `x` (design 3.1 rule
 * 8a breaks ties so). A full stride or less: it stops beside the target. Null when no tile is nearer than where `by` stands.
 */
export const stepToward = (spots: readonly Spot[], by: CombatantId, target: CombatantId, stride: Tiles, grid: Grid): MoveReach | null =>
  stepBy(spots, by, target, stride, grid, (d, best) => d < best);

/** Away: the reachable tile farthest from the target, with the same ties. Null when no tile is farther than where `by` stands. */
export const stepAway = (spots: readonly Spot[], by: CombatantId, target: CombatantId, stride: Tiles, grid: Grid): MoveReach | null =>
  stepBy(spots, by, target, stride, grid, (d, best) => d > best);
