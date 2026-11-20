// map-view.ts: the battle map as plain data (docs/agent-handoff/map/brief-m3-map.md). `mapScene` turns the bodies of a
// fight (the GM's phone, `fightBodies`) or of the room's fight doc (a player's phone, `docBodies`) and what the viewer has
// picked into a `MapScene`: the grid, each token, and the selection's tiles (where a move can go and the way it goes,
// or an ability's reach, who it can hit and where its splash and ring land). `tapOn` says what a tap on a tile does, and
// `hotbar` which abilities sit in the bar. Pure, and no new rule: every tile set comes from space.ts and every legality
// from charge.ts (rule 4), resolve.ts (rules 5 to 6) or fight-view.ts (`aims`). src/views/map.js draws the scene and
// converts tiles to pixels; nothing else. A new thing drawn on the map is a field here with its case in
// tests/map-view.test.ts.
import type { Rules } from '../rules.ts';
import { ATTACK_ID, itemOfAbility } from '../registry/abilities.ts';
import { dist, percent, place, reachable, straightPath, terrainOfChar, tiles, tilesOf, walkPath } from './space.ts';
import type { Grid, Place, MoveReach, Shape, Terrain, Tiles } from './space.ts';
import { cost, roundsOf, tick, walkCost } from './timeline.ts';
import type { Tick } from './timeline.ts';
import { costOf } from './charge.ts';
import { inRange, whoIsIn } from './resolve.ts';
import type { Ability, CombatantId } from './ability-types.ts';
import type { Body, Op, OpRules } from './effect-ops.ts';
import { band, tilesOfRuns, UNSEEN } from './fight-doc.ts';
import type { Band, FightDoc, FightDocRow } from './fight-doc.ts';
import { partyView } from './fight-turn.ts';
import { holds } from './standing.ts';
import { anchorOf, zoneTiles, zoneTone } from './zones.ts';
import type { ZoneId, ZoneTone } from './zones.ts';
import { aims, cardOf, onMap, readyIn, spotOf } from './fight-view.ts';
import type { Aiming, Spot } from './fight-view.ts';
import type { Fight } from './fight-types.ts';

// ── what the map is drawn from ──

/** A token's HP ring: the share of HP left, and the band when the viewer sees only that (a foe), else null (exact). */
export type Ring = { readonly share: number; readonly band: Band | null };
/** Bars a viewer may see of a body, as now and most: the GM's of every row, a player's of their own hunter. */
export type Bars = { readonly hp: readonly [number, number]; readonly mana: readonly [number, number] | null; readonly fatigue: readonly [number, number] | null };
/**
 * A body as the map reads it, from the fight or from the room doc. `stride` is the tiles one move may walk and `dash` the
 * tiles a dash may run (the sheet's `move`, whole), both 0 when rooted and when the viewer does not know them.
 */
export type MapBody = Spot & {
  readonly name: string;
  readonly ring: Ring;
  readonly statuses: boolean;
  readonly mine: boolean;
  readonly stride: Tiles;
  readonly dash: Tiles;
  readonly bars: Bars | null;
  readonly extras: Extras;
  /** Where a monster's intent aims, or else the target its threat suggests; null for neither. */
  readonly aim: MapAimLine | null;
  /** A summon (kits design 1.9): the row that owns it and its rounds left (null: it stays); null for any other body. */
  readonly summon: { readonly owner: CombatantId; readonly left: number | null } | null;
  /** Hidden by its own stealth (kits design 8.7): on the GM's map a foe so hidden is drawn dimmed, as one out of sight. */
  readonly stealth: boolean;
};
/**
 * What a token draws of design 4: its shield as a share of its max HP (1 when the viewer sees only a band), its stagger
 * bar's share and whether a break holds it back, its channel's charge of max and state, and whether a taunt holds it.
 */
export type Extras = {
  readonly shield: number | null;
  readonly stagger: { readonly share: number; readonly staggered: boolean } | null;
  readonly channel: { readonly charge: number; readonly max: number; readonly state: 'holding' | 'broken' | 'fired' } | null;
  readonly taunted: boolean;
  /** Its armed reaction fired since its turn began (kits table 8.9.1, `spent`): a token that turns so is a reaction firing. */
  readonly reacted: boolean;
};
/**
 * A line from a monster's token: its intent (to its target, with the tiles of an area ability's splash and ring when the
 * viewer may know them), or, quieter, the target its threat suggests while no intent is set.
 */
export type MapAimLine = {
  readonly kind: 'intent' | 'suggest'; readonly to: Place; readonly area: readonly Place[] | null; readonly revealed: boolean;
  /** What is coming, said at the line's end once revealed: the ability's name and what it does (null before, and for a suggestion). */
  readonly words: { readonly name: string; readonly what: string | null } | null;
};
const NO_EXTRAS: Extras = { shield: null, stagger: null, channel: null, taunted: false, reacted: false };

/** The band's share of a ring: the middle of the band (fight-doc.ts `band`), so a ring never claims more than a player may know. */
const BAND_SHARE: { readonly [B in Band]: number } = { healthy: 0.875, wounded: 0.625, bloodied: 0.375, critical: 0.125, down: 0 };
const ringOf = (exact: boolean, hp: number, hpMax: number): Ring => {
  const b = band(hp, hpMax);
  return exact ? { share: hpMax > 0 ? Math.max(0, Math.min(1, hp / hpMax)) : 0, band: null } : { share: BAND_SHARE[b], band: b };
};

/** The GM's phone: every row of the fight. A party row's HP ring is exact, a foe's shows its band (as players see it). */
export function fightBodies(f: Fight, R: OpRules & Pick<Rules, 'dice'>, mine: (b: Body) => boolean): MapBody[] {
  const at = (aim: Place | CombatantId): Place | null => typeof aim === 'string' ? f.rows.find(r => r.id === aim)?.place ?? null : aim;
  return f.rows.map(b => {
    const k = cardOf(f, b, R), i = k.intent, to = i ? at(i.target) : k.threat?.suggest ? at(k.threat.suggest) : null;
    const a = i && b.abilities.find(x => x.id === (i.channel ? i.channel.ability : b.intent?.ability));
    const area = i && to && a && a.shape.kind === 'radius' ? (({ hit, ring }) => [...hit, ...ring])(tilesOf(a.shape, b.place, to, f.grid)) : null;
    return {
      ...spotOf(b), name: b.name, ring: ringOf(b.side === 'party', k.hp, k.hpMax), statuses: k.statuses.length > 0, mine: mine(b),
      stride: b.sheet.stride, dash: tiles(Math.floor(b.sheet.move)),
      bars: { hp: [k.hp, k.hpMax], mana: k.manaMax > 0 ? [k.mana, k.manaMax] : null, fatigue: k.fatigueMax > 0 ? [k.fatigue, k.fatigueMax] : null },
      extras: {
        shield: k.shield !== null && k.hpMax > 0 ? Math.min(1, k.shield / k.hpMax) : null,
        stagger: k.stagger && { share: k.stagger.max > 0 ? Math.min(1, k.stagger.fill / k.stagger.max) : 0, staggered: k.stagger.staggered !== null },
        channel: k.channel && { charge: k.channel.charge, max: k.channel.max, state: k.channel.state }, taunted: k.taunt !== null,
        reacted: b.armed?.spent === true,
      },
      aim: to ? { kind: i ? 'intent' : 'suggest', to, area, revealed: i ? i.revealed : false, words: i && i.revealed ? { name: i.name, what: i.lines[0] ?? null } : null } : null,
      summon: b.kind === 'summon' ? { owner: b.owner ?? b.id, left: k.summon } : null,
      stealth: holds(b, 'hidden'),
    };
  });
}

/**
 * A player's phone: the room doc's rows on `grid`. A hunter's or shadow's HP is exact; a monster's is its band, and its
 * shield a full pale ring (its share of a max HP the player does not see). An intent's area is drawn only once revealed.
 * `spent`: the doc's party rows whose reaction fired since their turn began.
 */
export function docBodies(rows: readonly FightDocRow[], mine: (r: FightDocRow) => boolean, grid: Grid, spent: readonly CombatantId[] = []): MapBody[] {
  const at = (aim: CombatantId | { readonly x: number; readonly y: number }): Place | null => {
    if (typeof aim !== 'string') return place(aim.x, aim.y);
    const r = rows.find(x => x.id === aim);
    return r ? place(r.place.x, r.place.y) : null;
  };
  return rows.map(r => {
    const from = place(r.place.x, r.place.y);
    const extras: Extras = {
      shield: r.shield === null ? null : r.kind === 'monster' ? 1 : Math.min(1, r.shield / Math.max(1, r.hpMax)),
      stagger: r.kind === 'monster' && r.stagger ? { share: r.stagger.max > 0 ? Math.min(1, r.stagger.fill / r.stagger.max) : 0, staggered: r.stagger.staggered !== null } : null,
      channel: r.channel && { charge: r.channel.charge, max: r.channel.max, state: r.channel.state }, taunted: r.taunt !== null,
      reacted: spent.includes(r.id),
    };
    const base = { id: r.id, side: r.side, kind: r.kind, place: from, down: r.down, name: r.name, statuses: r.statuses.length > 0, mine: mine(r), extras, summon: r.kind === 'summon' ? { owner: r.owner, left: r.left } : null, stealth: false };
    if (r.kind === 'monster') {
      const i = r.intent, to = i ? at(i.target) : r.suggest ? at(r.suggest) : null, v = i?.reveal ?? null;
      const shape: Shape | null = v && v.radius !== null ? { kind: 'radius', radius: tiles(v.radius), ring: v.outer === null ? null : { outer: tiles(v.outer), share: percent(50) } } : null;
      const area = shape && to ? (({ hit, ring }) => [...hit, ...ring])(tilesOf(shape, from, to, grid)) : null;
      const aim: MapAimLine | null = to ? { kind: i ? 'intent' : 'suggest', to, area, revealed: v !== null, words: i && v ? { name: i.name, what: v.lines[0] ?? null } : null } : null;
      return { ...base, ring: { share: BAND_SHARE[r.band], band: r.band }, stride: tiles(0), dash: tiles(0), bars: null, aim };
    }
    return { ...base, ring: ringOf(true, r.hp, r.hpMax), stride: tiles(r.stride), dash: tiles(r.move), bars: { hp: [r.hp, r.hpMax], mana: null, fatigue: null }, aim: null };
  });
}

// ── what the viewer picked ──

/**
 * Nothing (on the actor's turn its movement area shows), a tile to move to, or an ability with the tile it is aimed at.
 * An ability aimed at a foe or an ally is aimed at the tile its target stands on.
 */
export type Selection =
  | { readonly kind: 'none' }
  | { readonly kind: 'move'; readonly to: Place }
  | { readonly kind: 'aim'; readonly ability: Aiming; readonly at: Place | null };

// ── the scene ──

/**
 * A token: a body on the map. `label` is the name's first letters (on the disc), `plate` where its name is written (`platesOf`);
 * `bars` what the viewer may see of its numbers.
 */
export type MapToken = {
  readonly id: CombatantId; readonly place: Place; readonly side: MapBody['side']; readonly kind: MapBody['kind'];
  readonly name: string; readonly label: string; readonly plate: Plate | null; readonly ring: Ring; readonly bars: Bars | null;
  readonly current: boolean; readonly down: boolean; readonly statuses: boolean; readonly mine: boolean;
  readonly extras: Extras;
  /** On the GM's map: a foe the party cannot see (out of sight, or hidden by its stealth), drawn dimmed. A player's map never holds one. */
  readonly hidden: boolean;
  /** A summon's owner's name and its rounds left (`MapBody.summon`); null for any other body. */
  readonly summon: { readonly owner: string; readonly left: number | null } | null;
};
/**
 * A line the map draws from a token (`MapAimLine`), with the outline of its area when it has one and the words at its end.
 * `nth` of `of` is its place among the lines that end on the same tile, so two that meet there are drawn apart.
 */
export type MapLine = {
  readonly from: CombatantId; readonly at: Place; readonly to: Place; readonly kind: MapAimLine['kind']; readonly revealed: boolean;
  readonly loops: readonly (readonly Corner[])[]; readonly words: MapAimLine['words']; readonly nth: number; readonly of: number;
};
/** The way a move goes: its tiles without the start, its steps, whether it is a dash, and its cost as words. */
export type MapPath = { readonly to: Place; readonly tiles: readonly Place[]; readonly steps: Tiles; readonly dash: boolean; readonly words: string };
/**
 * Where an aimed ability lands: the tile, the body it is aimed at (null for a place or an empty tile), the tiles of its
 * shape in full and in its ring, the bodies in each, whether a Use is allowed, and the aim a command names.
 */
export type MapAim = {
  readonly at: Place; readonly target: CombatantId | null;
  readonly splash: readonly Place[]; readonly ring: readonly Place[];
  readonly hit: readonly CombatantId[]; readonly ringed: readonly CombatantId[];
  readonly ok: boolean; readonly send: CombatantId | Place | null;
};
/** What the selection draws: nothing, the actor's movement area (stride, and lighter the dash) with a chosen way, or an ability's aim. */
export type MapFocus =
  | { readonly kind: 'none' }
  | { readonly kind: 'move'; readonly stride: readonly Place[]; readonly dash: readonly Place[]; readonly path: MapPath | null }
  | { readonly kind: 'aim'; readonly ability: Aiming; readonly reach: readonly Place[]; readonly targets: readonly CombatantId[]; readonly aim: MapAim | null };
/** A tile that is not floor, for the drawing (a fight with no map has none). */
export type MapTerrain = { readonly place: Place; readonly terrain: Terrain };

// ── the shaded areas, as outlines ──

/** A corner of the grid, in tiles: (x, y) is the top left corner of tile (x, y). */
export type Corner = { readonly x: number; readonly y: number };
/**
 * Which area a shade is: the stride, the dash past it, the chosen way, an ability's reach, its splash and its outer ring.
 * `tone` is the area's colour family: `move` for a body's own movement, `hostile` for an ability aimed at a foe or a place
 * (warm), `helpful` for one aimed at an ally or the user (cool).
 */
export const SHADE_KINDS = ['dash', 'stride', 'way', 'reach', 'ring', 'splash'] as const;
export type ShadeKind = (typeof SHADE_KINDS)[number];
export type Tone = 'move' | 'hostile' | 'helpful';
/** One area to shade: its kind and tone, and its outline as closed loops of corners (a hole is a loop the other way round). */
export type Shade = { readonly kind: ShadeKind; readonly tone: Tone; readonly loops: readonly (readonly Corner[])[] };

/**
 * The outline of a set of tiles: one closed loop per edge of the union, clockwise round a region and anticlockwise round a
 * hole, corners only where the edge turns, each loop starting at its top left corner. Two tiles that touch only at a
 * corner are two regions. The map draws each area as one shape from these, so the area has no seams between its tiles.
 */
export function outline(list: readonly Place[]): Corner[][] {
  // a corner or a tile as one number (a tile's neighbour may be at -1): the map draws this on every change, on a phone
  const key = (x: number, y: number): number => (y + 2) * 65536 + x + 2;
  const inSet = new Set(list.map(p => key(p.x, p.y)));
  // every edge of a tile with no tile across it, directed so the tile is on its right (clockwise on a screen, y down)
  const out = new Map<number, Corner[]>(), corners: Corner[] = [];
  const edge = (ax: number, ay: number, bx: number, by: number): void => {
    const k = key(ax, ay), l = out.get(k);
    if (l) l.push({ x: bx, y: by }); else { out.set(k, [{ x: bx, y: by }]); corners.push({ x: ax, y: ay }); }
  };
  for (const p of list) {
    const { x, y } = p;
    if (!inSet.has(key(x, y - 1))) edge(x, y, x + 1, y);
    if (!inSet.has(key(x + 1, y))) edge(x + 1, y, x + 1, y + 1);
    if (!inSet.has(key(x, y + 1))) edge(x + 1, y + 1, x, y + 1);
    if (!inSet.has(key(x - 1, y))) edge(x, y + 1, x, y);
  }
  const loops: Corner[][] = [];
  // each loop starts at the top left corner that still has an edge leaving it; a corner with none left never gets one back
  const starts = corners.sort((a, b) => a.y - b.y || a.x - b.x);
  for (let n = 0; ; ) {
    while (n < starts.length && out.get(key(starts[n]!.x, starts[n]!.y))!.length === 0) n++;
    const s = starts[n];
    if (!s) break;
    const loop: Corner[] = [s];
    let at = s, dx = 0, dy = 0;
    for (;;) {
      const next = out.get(key(at.x, at.y))!;
      // where two regions touch at a corner, turn right first, so each region keeps its own loop
      const turn = (c: Corner): number => { const ex = c.x - at.x, ey = c.y - at.y; return ex === -dy && ey === dx ? 0 : ex === dx && ey === dy ? 1 : 2; };
      next.sort((a, b) => turn(a) - turn(b));
      const to = next.shift()!;
      dx = to.x - at.x; dy = to.y - at.y; at = to;
      if (at.x === s.x && at.y === s.y) break;
      loop.push(at);
    }
    // a corner only where the edge turns
    const bends = loop.filter((c, i) => {
      const a = loop[(i + loop.length - 1) % loop.length]!, b = loop[(i + 1) % loop.length]!;
      return (c.x - a.x) * (b.y - c.y) !== (c.y - a.y) * (b.x - c.x);
    });
    loops.push(bends);
  }
  return loops;
}

/** The shades of a focus, under the tokens in the order drawn: the dash, the stride and the way; or the reach, the ring and the splash. */
function shadesOf(f: MapFocus): Shade[] {
  const shade = (kind: ShadeKind, tone: Tone, list: readonly Place[]): Shade[] => list.length ? [{ kind, tone, loops: outline(list) }] : [];
  switch (f.kind) {
    case 'none': return [];
    case 'move': return [...shade('dash', 'move', f.dash), ...shade('stride', 'move', f.stride), ...shade('way', 'move', f.path ? f.path.tiles : [])];
    case 'aim': {
      const tone: Tone = f.ability.aim === 'ally' || f.ability.aim === 'self' ? 'helpful' : 'hostile';
      return [...shade('reach', tone, f.reach), ...shade('ring', tone, f.aim ? f.aim.ring : []), ...shade('splash', tone, f.aim ? f.aim.splash : [])];
    }
    default: return f satisfies never;
  }
}

/** A zone as the map gets it: from the fight on the GM's phone (`fightGround`), from the doc on a player's (`docGround`). */
export type MapZoneIn = {
  readonly id: ZoneId; readonly name: string; readonly tone: ZoneTone; readonly left: number | null; readonly tiles: readonly Place[];
  /** The body an aura moves with (design 4.8), or null for a zone that lies still. */
  readonly anchor: CombatantId | null;
  /** What it does and the tier it is read at, on the GM's phone (a player's doc carries its tone): its detail's lines. */
  readonly ops?: readonly Op[];
  readonly tier?: number;
};
/**
 * A zone as the map draws it: its outline as loops, its tone, its name and rounds left for a tap, the tile its name sits
 * on (`at`), and `grew`: the outline of the tiles it gained where it lay since the zones the map drew before
 * (`MapInput.before`; design 4.8), else none.
 */
export type DrawnZone = MapZoneIn & { readonly loops: readonly (readonly Corner[])[]; readonly at: Place; readonly grew: readonly (readonly Corner[])[] };
/**
 * What the viewer knows of the party's view: the tiles the party sees now (`lit`), the tiles it has ever seen (`known`,
 * null on the GM's phone, which knows the whole map) and whether this is the GM's map (what the party cannot see is then
 * dimmed, not hidden).
 */
export type MapSight = { readonly lit: ReadonlySet<number>; readonly known: ReadonlySet<number> | null; readonly gm: boolean };
/** The fog the map draws: the outline of the tiles the party does not see now, and of those it never saw (dark). */
export type MapFog = { readonly dim: readonly (readonly Corner[])[]; readonly dark: readonly (readonly Corner[])[]; readonly gm: boolean };

/** The ground of the GM's fight: its zones and, with a fog, what the party sees (fight-turn.ts `partyView`). */
export function fightGround(f: Fight, R: Pick<Rules, 'fight'>): { zones: MapZoneIn[]; sight: MapSight | null } {
  const now = f.phase === 'setup' ? 0 : f.now, lit = partyView(f);
  return {
    zones: f.zones.map(z => ({ id: z.id, name: z.name, tone: zoneTone(z.ops), tiles: zoneTiles(z, f.rows, f.grid, tick(now), R), anchor: anchorOf(z), left: z.until === null ? null : Math.max(0, roundsOf(z.until - now, R, 'up')), ops: z.ops, tier: z.tier })),
    sight: lit && { lit, known: null, gm: true },
  };
}
/** The ground of a player's table from the room's doc: its map (an unseen tile is floor), its zones and what the party sees. */
export function docGround(e: Extract<FightDoc, { ended: false }>): { grid: Grid; zones: MapZoneIn[]; sight: MapSight | null } {
  const { w, h, tiles: text, lit } = e.grid;
  const grid: Grid = { w, h, tiles: text ? [...text].map(c => terrainOfChar(c) ?? 'floor') : null };
  const at = (i: number): Place => place(i % w, Math.floor(i / w));
  const zones = (e.zones ?? []).map(z => ({ id: z.id, name: z.name, tone: z.tone, left: z.left, tiles: tilesOfRuns(z.tiles, w * h).map(at), anchor: z.anchor ?? null }));
  if (!lit) return { grid, zones, sight: null };
  const set = (pred: (i: number) => boolean) => new Set(Array.from({ length: w * h }, (_, i) => i).filter(pred));
  return { grid, zones, sight: { lit: set(i => lit[i] === '1'), known: set(i => text?.[i] !== UNSEEN), gm: false } };
}

/** Everything the map draws. `actor` is the body whose turn this viewer plays (null: the viewer only watches). */
export type MapScene = {
  readonly w: number; readonly h: number;
  readonly terrain: readonly MapTerrain[];
  /** The walls' outline, so a run of wall tiles draws as one solid block with one edge. */
  readonly walls: readonly (readonly Corner[])[];
  readonly tokens: readonly MapToken[];
  readonly actor: CombatantId | null;
  readonly focus: MapFocus;
  /** The focus's areas as outlines, in the order drawn. */
  readonly shades: readonly Shade[];
  /** Each monster's intent, or the target its threat suggests. */
  readonly lines: readonly MapLine[];
  /** The zones on the ground, under the areas. */
  readonly zones: readonly DrawnZone[];
  /** The fog over what the party does not see, or null with no fog. */
  readonly fog: MapFog | null;
  /** What the map opens framed on (`frameOf`): the bodies and the walls and zones near them; the whole grid with no body. */
  readonly frame: Box;
  /** The body the view keeps in sight when the frame does not fit the screen: the one acting, else the viewer's own, else whose turn it is. */
  readonly anchor: Place | null;
};
/** A box of tiles, both ends inside. */
export type Box = { readonly x0: number; readonly y0: number; readonly x1: number; readonly y1: number };
/**
 * What the scene is made from: the bodies, the grid, whose turn it is and whose turn this viewer plays, the zones on the
 * ground and what the party sees (`fightGround`, `docGround`).
 */
export type MapInput = {
  readonly bodies: readonly MapBody[]; readonly grid: Grid; readonly currentId: CombatantId | null; readonly actor: CombatantId | null;
  readonly zones?: readonly MapZoneIn[]; readonly sight?: MapSight | null;
  /** The zones the map drew before, so a field that grew in place shows its new edge (`DrawnZone.grew`). */
  readonly before?: readonly MapZoneIn[];
  /** A move this phone sent that the GM's phone has not answered: the way it asked for stays drawn until the answer. */
  readonly sent?: { readonly by: CombatantId; readonly way: readonly Place[] } | null;
};
type MapRules = Pick<Rules, 'fight'>;

const same = (a: Place, b: Place): boolean => a.x === b.x && a.y === b.y;
const has = (list: readonly Place[], p: Place): boolean => list.some(q => same(q, p));

/**
 * A token's name on the map: on a strip of the tile under it (`below`) or over it (`above`), `span` tiles wide centred on
 * the token, so it never covers another token or another name. `text` is `shortOf`, or the whole name three tiles wide.
 */
export type Plate = { readonly side: 'below' | 'above'; readonly text: string; readonly span: 1 | 3 };
/** The strip a plate takes: the top of the tile row under its token, or the bottom of the row over it, columns `x0` to `x1`. */
type Strip = { readonly row: number; readonly half: 'top' | 'bottom'; readonly x0: number; readonly x1: number };
const stripOf = (p: Place, side: Plate['side'], span: Plate['span']): Strip => {
  const out = (span - 1) / 2;
  return side === 'below' ? { row: p.y + 1, half: 'top', x0: p.x - out, x1: p.x + out } : { row: p.y - 1, half: 'bottom', x0: p.x - out, x1: p.x + out };
};
/**
 * Where each token's name is written. Under the token when that strip is on the map and holds no token and no other name,
 * else over it, else nowhere: the initials on its disc still say who. Every name is first placed short, one tile wide, so
 * the side depends only on where the bodies stand; then the whole name, three tiles wide, is written on the bodies in
 * `whole` (the one aimed at), in that order, where its wider strip is free too.
 */
export function platesOf(bodies: readonly Pick<MapBody, 'id' | 'place' | 'name' | 'kind'>[], grid: Grid, whole: readonly CombatantId[]): Map<CombatantId, Plate | null> {
  const strips = new Map<CombatantId, Strip>();
  const free = (s: Strip, self: CombatantId): boolean => s.row >= 0 && s.row < grid.h && s.x0 >= 0 && s.x1 < grid.w
    && !bodies.some(b => b.place.y === s.row && b.place.x >= s.x0 && b.place.x <= s.x1)
    && ![...strips].some(([who, o]) => who !== self && o.row === s.row && o.half === s.half && o.x0 <= s.x1 && s.x0 <= o.x1);
  const plates = new Map<CombatantId, Plate | null>();
  for (const b of bodies) {
    const side = (['below', 'above'] as const).find(sd => free(stripOf(b.place, sd, 1), b.id)) ?? null;
    if (side) strips.set(b.id, stripOf(b.place, side, 1));
    plates.set(b.id, side && { side, text: shortOf(b.name, b.kind), span: 1 });
  }
  for (const who of whole) {
    const b = bodies.find(x => x.id === who), at = plates.get(who);
    if (!b || !at || b.name === at.text || !free(stripOf(b.place, at.side, 3), who)) continue;
    strips.set(who, stripOf(b.place, at.side, 3));
    plates.set(who, { side: at.side, text: b.name, span: 3 });
  }
  return plates;
}

/**
 * The name under a token: a hunter's or shadow's first name; a monster's last word, with its pack letter ("Cave Rat B" is
 * "Rat B", "Ice Warden" is "Warden"). The map shows it whole on the body aimed at where there is room (`platesOf`), this elsewhere.
 */
export function shortOf(name: string, kind: MapBody['kind']): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length < 2) return words[0] ?? '?';
  if (kind !== 'monster') return words[0]!;
  const last = words[words.length - 1]!;
  return last.length === 1 ? `${words[words.length - 2]!} ${last}` : last;
}

/** How far from the bodies a wall, cover, a pit or a zone still counts for the frame the map opens on: a move's reach. */
const NEAR = 3;
/**
 * The box the map opens framed on: every body on the map, and every tile of terrain or of a zone within `NEAR` tiles of
 * that box, so a wall or a field beside the fight shows and one across an empty map does not pull the view out.
 */
export function frameOf(grid: Grid, bodies: readonly Place[], ground: readonly Place[]): Box {
  if (!bodies.length) return { x0: 0, y0: 0, x1: grid.w - 1, y1: grid.h - 1 };
  const xs = bodies.map(p => p.x), ys = bodies.map(p => p.y);
  const b = { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
  const box = { ...b };
  for (const p of ground) {
    if (p.x < b.x0 - NEAR || p.x > b.x1 + NEAR || p.y < b.y0 - NEAR || p.y > b.y1 + NEAR) continue;
    box.x0 = Math.min(box.x0, p.x); box.x1 = Math.max(box.x1, p.x); box.y0 = Math.min(box.y0, p.y); box.y1 = Math.max(box.y1, p.y);
  }
  return box;
}

/**
 * The tile of `list` nearest its middle where a zone's name is written, leaving out the tiles a token or its name plate
 * covers (`covered`): an aura's middle is its body's own tile. Distance across counts double, as a name is wider than a
 * tile, so it goes above or below the middle before beside it. The plain middle when every tile is covered.
 */
function middleOf(list: readonly Place[], covered: (p: Place) => boolean): Place {
  const mx = list.reduce((n, p) => n + p.x, 0) / list.length, my = list.reduce((n, p) => n + p.y, 0) / list.length;
  const far = (p: Place): number => (2 * (p.x - mx)) ** 2 + (p.y - my) ** 2, free = list.filter(p => !covered(p));
  let best = (free.length ? free : list)[0]!;
  for (const p of free.length ? free : list) if (far(p) < far(best)) best = p;
  return best;
}

/** A name's first letters: the first two words' initials, or a pack's letter after the first initial ("Cave Rat B" is CB). */
export function labelOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '?';
  const first = words[0]!, last = words[words.length - 1]!;
  if (words.length === 1) return first.slice(0, 2).toUpperCase();
  return (first[0]! + (last.length === 1 ? last : words[1]![0]!)).toUpperCase();
}

const FRACTIONS: readonly (readonly [number, string])[] = [
  [1 / 6, 'a sixth'], [1 / 4, 'a quarter'], [1 / 3, 'a third'], [1 / 2, 'half'], [2 / 3, 'two thirds'], [3 / 4, 'three quarters'], [5 / 6, 'five sixths'], [1, 'all'],
];
/** A share of a standard action as words: the nearest of the fractions a table says, "a third of your turn". */
export function turnWords(share: number): string {
  let best = FRACTIONS[0]!;
  for (const f of FRACTIONS) if (Math.abs(f[0] - share) < Math.abs(best[0] - share)) best = f;
  return `${best[1]} of your turn`;
}
const pathWords = (steps: number, dash: boolean, R: MapRules): string => dash
  ? `Dash ${steps} tile${steps === 1 ? '' : 's'}: ${turnWords(cost(R.fight.dashTime) / R.fight.cost.standard)} and ${R.fight.dashFatigue} fatigue`
  : `${steps} tile${steps === 1 ? '' : 's'}: ${turnWords(walkCost(tiles(steps), R.fight) / R.fight.cost.standard)}`;

/**
 * Where the actor can go (design 4.6): the tiles a walk reaches in at most its stride around walls and the other bodies
 * on the map, and, lighter, the tiles past them a dash reaches (its whole `move` in a straight line with nothing on it).
 * The tile it stands on is in neither. A rooted body has neither.
 */
function area(user: MapBody, others: readonly Place[], grid: Grid): { walks: MoveReach[]; stride: Place[]; dash: Place[] } {
  if (user.stride <= 0) return { walks: [], stride: [], dash: [] };
  const walks = reachable(user.place, user.stride, grid, others).filter(r => r.steps > 0), stride = walks.map(r => r.place);
  const walked = new Set(stride.map(p => p.y * grid.w + p.x)), dash: Place[] = [];
  for (let y = Math.max(0, user.place.y - user.dash); y <= Math.min(grid.h - 1, user.place.y + user.dash); y++) {
    for (let x = Math.max(0, user.place.x - user.dash); x <= Math.min(grid.w - 1, user.place.x + user.dash); x++) {
      const p = place(x, y);
      if (dist(user.place, p) <= user.dash && !same(p, user.place) && !walked.has(y * grid.w + x) && straightPath(user.place, p, grid, others)) dash.push(p);
    }
  }
  return { walks, stride, dash };
}

/** The scene for `input` with `sel` picked. A selection the actor cannot make (no actor, a tile outside the area) draws as none. */
export function mapScene(input: MapInput, sel: Selection, R: MapRules): MapScene {
  const { bodies, grid } = input, shown = bodies.filter(onMap);
  const terrain: MapTerrain[] = [];
  if (grid.tiles) grid.tiles.forEach((t, i) => { if (t !== 'floor') terrain.push({ place: place(i % grid.w, Math.floor(i / grid.w)), terrain: t }); });
  const sight = input.sight ?? null, idx = (p: Place): number => p.y * grid.w + p.x;
  const user = shown.find(b => b.id === input.actor && !b.down) ?? null;
  const focus: MapFocus = user ? focusOf(user, shown, grid, sel, R) : { kind: 'none' };
  const aimedAt = focus.kind === 'aim' && focus.aim ? focus.aim.target : null;
  const plates = platesOf(shown, grid, aimedAt ? [aimedAt] : []);
  const tokens: MapToken[] = shown.map(b => ({
    id: b.id, place: b.place, side: b.side, kind: b.kind, name: b.name, label: labelOf(b.name), plate: plates.get(b.id) ?? null, ring: b.ring, bars: b.bars,
    current: b.id === input.currentId, down: b.down, statuses: b.statuses, mine: b.mine, extras: b.extras,
    hidden: (b.side === 'foe' && b.stealth) || (!!sight && b.side === 'foe' && !sight.lit.has(idx(b.place))),
    summon: b.summon && { owner: bodies.find(x => x.id === b.summon!.owner)?.name ?? '', left: b.summon.left },
  }));
  // a token covers its tile, and its name the tile its plate's strip is on
  const onStrip = (s: Strip, p: Place): boolean => p.y === s.row && p.x >= s.x0 && p.x <= s.x1;
  const covered = (p: Place): boolean => tokens.some(t => same(t.place, p) || (!!t.plate && onStrip(stripOf(t.place, t.plate.side, t.plate.span), p)));
  const zones: DrawnZone[] = (input.zones ?? []).filter(z => z.tiles.length).map(z => {
    // it grew where it lay when every tile it had is still its own and it has more: an aura that moved did not grow
    const was = input.before?.find(x => x.id === z.id), grew = was && z.tiles.length > was.tiles.length && was.tiles.every(p => has(z.tiles, p))
      ? z.tiles.filter(p => !has(was.tiles, p)) : [];
    return { ...z, loops: outline(z.tiles), at: middleOf(z.tiles, covered), grew: outline(grew) };
  });
  const tilesWhere = (pred: (i: number) => boolean): Place[] => {
    const out: Place[] = [];
    for (let i = 0; i < grid.w * grid.h; i++) if (pred(i)) out.push(place(i % grid.w, Math.floor(i / grid.w)));
    return out;
  };
  const fog: MapFog | null = sight && {
    dim: outline(tilesWhere(i => !sight.lit.has(i) && (!sight.known || sight.known.has(i)))),
    dark: sight.known ? outline(tilesWhere(i => !sight.known!.has(i))) : [], gm: sight.gm,
  };
  const aimed = shown.filter(b => b.aim && !b.down), ends = (p: Place) => aimed.filter(b => same(b.aim!.to, p));
  const lines: MapLine[] = aimed.map(b => {
    const a = b.aim!, meet = ends(a.to);
    return { from: b.id, at: b.place, to: a.to, kind: a.kind, revealed: a.revealed, loops: a.area ? outline(a.area) : [], words: a.words, nth: meet.indexOf(b), of: meet.length };
  });
  const frame = frameOf(grid, tokens.map(t => t.place), [...terrain.map(t => t.place), ...zones.flatMap(z => z.tiles)]);
  const anchor = (user ?? shown.find(b => b.mine) ?? shown.find(b => b.id === input.currentId) ?? null)?.place ?? null;
  const walls = outline(terrain.filter(t => t.terrain === 'wall').map(t => t.place));
  return { w: grid.w, h: grid.h, terrain, walls, tokens, actor: user ? user.id : null, focus, shades: focus.kind === 'none' && input.sent && input.sent.way.length ? [{ kind: 'way', tone: 'move', loops: outline(input.sent.way) }] : shadesOf(focus), lines, zones, fog, frame, anchor };
}

function focusOf(user: MapBody, shown: readonly MapBody[], grid: Grid, sel: Selection, R: MapRules): MapFocus {
  if (sel.kind === 'aim') return aimFocus(user, shown, grid, sel.ability, sel.at);
  const others = shown.filter(b => b.id !== user.id).map(b => b.place);
  const { walks, stride, dash } = area(user, others, grid);
  if (sel.kind === 'none') return { kind: 'move', stride, dash, path: null };
  const walked = walks.find(r => same(r.place, sel.to)), run = !walked && has(dash, sel.to);
  const way = walked ? walkPath(user.place, sel.to, grid, others) : run ? straightPath(user.place, sel.to, grid, others) : null;
  const steps = walked ? walked.steps : dist(user.place, sel.to);
  const path = way ? { to: sel.to, tiles: way, steps, dash: run, words: pathWords(steps, run, R) } : null;
  return { kind: 'move', stride, dash, path };
}

/**
 * An ability picked: its reach (every tile within its range of the user, rule 5; the user's own for a self ability), the
 * bodies it can hit (`aims`: in range and in its shape, rules 5 and 6), and where it lands when aimed at `at`.
 */
function aimFocus(user: MapBody, shown: readonly MapBody[], grid: Grid, a: Aiming, at: Place | null): MapFocus {
  const reach: Place[] = [];
  if (a.aim === 'self') reach.push(user.place);
  else for (let y = 0; y < grid.h; y++) for (let x = 0; x < grid.w; x++) { const p = place(x, y); if (inRange(a, user, p)) reach.push(p); }
  const targets = a.aim === 'place' ? [] : hittable(user, shown, grid, a);
  const where = a.aim === 'self' ? user.place : at;
  if (!where) return { kind: 'aim', ability: a, reach, targets, aim: null };
  const target = a.aim === 'place' ? null : shown.find(b => same(b.place, where) && targets.includes(b.id))?.id ?? null;
  const cover = a.aim === 'self' ? { hit: [user.place], ring: [] } : a.aim === 'ally' ? { hit: [where], ring: [] } : tilesOf(a.shape, user.place, where, grid);
  const inside = whoIsIn(a, user, shown, where, grid);
  const ok = a.aim === 'self' || (a.aim === 'place' ? inRange(a, user, where) : target !== null);
  const send = a.aim === 'self' ? user.id : a.aim === 'place' ? (ok ? where : null) : target;
  return {
    kind: 'aim', ability: a, reach, targets,
    aim: { at: where, target, splash: cover.hit, ring: cover.ring, hit: inside.hit.map(b => b.id), ringed: inside.ring.map(b => b.id), ok, send },
  };
}

/** The bodies `a` can hit from where the user stands: fight-view.ts `aims` in range and in its shape, in the order shown. */
function hittable(user: MapBody, shown: readonly MapBody[], grid: Grid, a: Aiming): CombatantId[] {
  const can = new Set(aims(shown, user.id, a, grid).filter(x => x.inRange && x.inShape).map(x => x.target.id));
  return shown.filter(b => can.has(b.id)).map(b => b.id);
}

// ── a tap ──

/**
 * What a tap on tile `p` does in `scene`: open a token's card, pick a tile to move to or a tile to aim at, back out of
 * what is picked, or nothing. A tap on a body an ability cannot reach is refused with the reason, and the aim stays.
 */
export type Tap =
  | { readonly kind: 'card'; readonly id: CombatantId }
  | { readonly kind: 'moveTo'; readonly to: Place }
  | { readonly kind: 'aimAt'; readonly at: Place }
  | { readonly kind: 'refuse'; readonly reason: 'range' }
  | { readonly kind: 'cancel' }
  /** A tap on a zone and nothing else: the map says its name. */
  | { readonly kind: 'zone'; readonly id: ZoneId }
  | { readonly kind: 'nothing' };
export function tapOn(scene: MapScene, p: Place): Tap {
  const token = scene.tokens.find(t => same(t.place, p)) ?? null, f = scene.focus;
  switch (f.kind) {
    case 'none': case 'move': {
      if (f.kind === 'move' && (has(f.stride, p) || has(f.dash, p))) return { kind: 'moveTo', to: p };
      if (token) return { kind: 'card', id: token.id };
      if (f.kind === 'move' && f.path) return { kind: 'cancel' };
      const z = scene.zones.find(x => has(x.tiles, p));
      return z ? { kind: 'zone', id: z.id } : { kind: 'nothing' };
    }
    case 'aim':
      if (f.ability.aim === 'self') return token && token.id === scene.actor ? { kind: 'nothing' } : { kind: 'cancel' };
      if (f.ability.aim === 'place') return has(f.reach, p) ? { kind: 'aimAt', at: p } : { kind: 'cancel' };
      if (token && f.targets.includes(token.id)) return { kind: 'aimAt', at: p };
      if (token && token.id !== scene.actor && (f.ability.aim === 'ally') === (scene.tokens.find(t => t.id === scene.actor)?.side === token.side)) return { kind: 'refuse', reason: 'range' };
      return { kind: 'cancel' };
    default: return f satisfies never;
  }
}

// ── the choice: select, pick, aim, confirm (docs/state-machines.md, "What the map has chosen") ──

/** What the viewer has chosen: nothing, a tile to move to, or an ability of its kit with the tile it is aimed at. */
export type Chosen =
  | { readonly kind: 'none' }
  | { readonly kind: 'move'; readonly to: Place }
  | { readonly kind: 'aim'; readonly ability: Ability; readonly at: Place | null };
export const CHOSEN_KINDS = ['none', 'move', 'aim'] as const satisfies readonly Chosen['kind'][];
/**
 * The map's choice. `now` is drawn (it is the scene's `Selection`). `taps` is what the last taps changed, oldest first,
 * at most two, so a double tap puts back what its two taps chose. `actor` is whose turn this viewer plays as last
 * drawn: a new one starts with nothing chosen. `drawer`: the hotbar's More is open. `sent`: a move this phone sent
 * that the GM's phone has not answered; its way stays drawn until the answer, and the token then goes along it.
 */
export type Choice = {
  readonly now: Chosen; readonly taps: readonly Chosen[]; readonly actor: CombatantId | null; readonly drawer: boolean;
  readonly sent: { readonly by: CombatantId; readonly way: readonly Place[] } | null;
};
export const NO_CHOICE: Choice = { now: { kind: 'none' }, taps: [], actor: null, drawer: false, sent: null };

export const CHOICE_EVENTS = ['seen', 'drawn', 'tap', 'double', 'pick', 'cancel', 'go', 'pass', 'more'] as const;
export type ChoiceEventKind = (typeof CHOICE_EVENTS)[number];
/**
 * `seen`: a draw begins, with whose turn this viewer plays, the actor's kit, and whether this phone's last command is
 * still on its way (`MapSource.waiting`). `drawn`: the scene drawn from `now`. `tap`: a tile tapped (a token's is its
 * tile). `double`: a double tap. `pick`: an ability of the kit tapped on the hotbar. `cancel`: Cancel, or Paint turned
 * on or off. `go`: Move, Dash or Use. `pass`: End turn. `more`: the hotbar's More.
 */
export type ChoiceEvent =
  | { readonly kind: 'seen'; readonly actor: CombatantId | null; readonly kit: readonly Ability[] | null; readonly waiting: boolean }
  | { readonly kind: 'drawn'; readonly scene: MapScene }
  | { readonly kind: 'tap'; readonly scene: MapScene; readonly at: Place }
  | { readonly kind: 'double' }
  | { readonly kind: 'pick'; readonly scene: MapScene; readonly ability: Ability }
  | { readonly kind: 'cancel' }
  | { readonly kind: 'go'; readonly scene: MapScene }
  | { readonly kind: 'pass'; readonly scene: MapScene }
  | { readonly kind: 'more' };
/**
 * What the view carries out. `card`, `zone`: open a body's card or a zone's detail. `refuse`: the body tapped is out of
 * the ability's reach. `offTurn`: a turn's control tapped off the turn. `move`, `use`, `pass`: the commands sent.
 * `along`: the answer to a sent move came, and the token goes along the way it asked for.
 */
export type ChoiceFx =
  | { readonly kind: 'card'; readonly id: CombatantId }
  | { readonly kind: 'zone'; readonly id: ZoneId }
  | { readonly kind: 'refuse' }
  | { readonly kind: 'offTurn' }
  | { readonly kind: 'move'; readonly to: Place; readonly dash: boolean }
  | { readonly kind: 'use'; readonly ability: Ability; readonly aim: CombatantId | Place; readonly at: Place }
  | { readonly kind: 'pass' }
  | { readonly kind: 'along'; readonly id: CombatantId; readonly tiles: readonly Place[] };
export type Chose = { readonly choice: Choice; readonly fx: readonly ChoiceFx[] };

type ChoiceStep<E extends ChoiceEventKind> = (c: Choice, e: Extract<ChoiceEvent, { kind: E }>) => Chose;
type ChoiceRow = { readonly [E in ChoiceEventKind]: ChoiceStep<E> | null };
const NONE: Chosen = { kind: 'none' };
const kept = (choice: Choice, ...fx: ChoiceFx[]): Chose => ({ choice, fx });
/** Nothing chosen, and no tap left for a double tap to put back. */
const cleared = (c: Choice): Choice => ({ ...c, now: NONE, taps: [] });

const seen: ChoiceStep<'seen'> = (c, e) => {
  let next = e.actor === c.actor ? c : { ...cleared(c), actor: e.actor, drawer: false };
  // an aimed ability is the kit's as it is now; one that left the kit is put down
  if (next.now.kind === 'aim') {
    const id = next.now.ability.id, a = (e.kit ?? []).find(x => x.id === id);
    next = a ? { ...next, now: { ...next.now, ability: a } } : { ...next, now: NONE };
  }
  if (e.waiting || !next.sent) return kept(next);
  return kept({ ...next, sent: null }, { kind: 'along', id: next.sent.by, tiles: next.sent.way });
};
/** A tile to move to that the scene no longer offers (a body stepped on it, the stride shrank) is put down. */
const drawn: ChoiceStep<'drawn'> = (c, e) => (e.scene.focus.kind === 'move' && e.scene.focus.path ? kept(c) : kept({ ...c, now: NONE }));
const tapped: ChoiceStep<'tap'> = (c, e) => {
  const t = tapOn(e.scene, e.at), taps = [...c.taps, c.now].slice(-2), was = { ...c, taps };
  switch (t.kind) {
    case 'card': return kept(was, { kind: 'card', id: t.id });
    case 'moveTo': return kept({ ...was, now: { kind: 'move', to: t.to } });
    case 'aimAt': return kept(c.now.kind === 'aim' ? { ...was, now: { ...c.now, at: t.at } } : was);
    case 'refuse': return kept(was, { kind: 'refuse' });
    case 'cancel': return kept({ ...was, now: NONE });
    case 'zone': return kept(was, { kind: 'zone', id: t.id });
    case 'nothing': return kept(was);
    default: return t satisfies never;
  }
};
const doubled: ChoiceStep<'double'> = c => kept(c.taps.length ? { ...c, now: c.taps[0]!, taps: [] } : c);
/** An ability from the hotbar: its reach and targets show (a self ability is aimed at once); the same again puts it down. */
const picked: ChoiceStep<'pick'> = (c, e) => {
  if (!e.scene.actor) return kept(c, { kind: 'offTurn' });
  if (c.now.kind === 'aim' && c.now.ability.id === e.ability.id) return kept(cleared(c));
  return kept({ ...c, now: { kind: 'aim', ability: e.ability, at: null }, taps: [], drawer: false });
};
/**
 * Move, Dash or Use sends what the scene offers for what is chosen now, and puts the choice down in the same step, so
 * a second press before the next draw (a stale scene still offers it) sends nothing, and a scene drawn before the last
 * tap or pick sends nothing either.
 */
const went: ChoiceStep<'go'> = (c, e) => {
  const f = e.scene.focus, by = e.scene.actor, now = c.now;
  if (!by) return kept(c);
  if (f.kind === 'move' && f.path && now.kind === 'move' && same(f.path.to, now.to)) {
    return kept({ ...cleared(c), sent: { by, way: f.path.tiles } }, { kind: 'move', to: f.path.to, dash: f.path.dash });
  }
  // the scene must be the one drawn from this choice: the same ability aimed at the same tile (a self ability at its user)
  if (f.kind === 'aim' && f.aim && f.aim.ok && f.aim.send !== null && now.kind === 'aim' && f.ability === now.ability && (now.at ? same(f.aim.at, now.at) : f.ability.aim === 'self')) {
    return kept({ ...cleared(c), sent: null }, { kind: 'use', ability: now.ability, aim: f.aim.send, at: f.aim.at });
  }
  return kept(c);
};
const passed: ChoiceStep<'pass'> = (c, e) => (e.scene.actor ? kept(cleared(c), { kind: 'pass' }) : kept(c, { kind: 'offTurn' }));
const cancelled: ChoiceStep<'cancel'> = c => kept(cleared(c));
const more: ChoiceStep<'more'> = c => kept({ ...c, drawer: !c.drawer });

/** Each kind of choice's answer to each event; null where the event changes nothing. The typecheck asks for every cell. */
const CHOICE_TABLE: { readonly [K in Chosen['kind']]: ChoiceRow } = {
  none: { seen, drawn: null, tap: tapped, double: doubled, pick: picked, cancel: cancelled, go: null, pass: passed, more },
  move: { seen, drawn, tap: tapped, double: doubled, pick: picked, cancel: cancelled, go: went, pass: passed, more },
  aim: { seen, drawn: null, tap: tapped, double: doubled, pick: picked, cancel: cancelled, go: went, pass: passed, more },
};
/** The choice after `e`, and what the view carries out. The same choice and nothing to do where `e` does not apply. */
export function choose(c: Choice, e: ChoiceEvent): Chose {
  // The table's type pairs each event with its step, so the cell for `e.kind` takes `e`.
  const step = CHOICE_TABLE[c.now.kind][e.kind] as ChoiceStep<ChoiceEventKind> | null;
  return step ? step(c, e as never) : kept(c);
}

// ── the hotbar ──

/**
 * Whose pinned abilities a hotbar keeps (the prefs' `pins`, by this key): a hunter's by its hunter id on this phone or its
 * sheet key on a player's, any other row's by its kind and its monster's or shadow's own name (`Origin.name`), so the
 * rows of one pack share their pins and a row's letter or a rename of another row never moves them.
 */
export function pinKeyOf(b: Pick<Body, 'kind' | 'holder' | 'origin' | 'name'>): string {
  if (b.holder?.kind === 'local') return `hunter:${b.holder.hunterId}`;
  if (b.holder?.kind === 'remote') return `remote:${b.holder.remote}`;
  return `${b.kind}:${b.origin.kind === 'monster' ? b.origin.name : b.name}`;
}
/** A player's own hunter's pins on its phone: the key `pinKeyOf` gives the same hunter's row on this phone. */
export const myPinKey = (hid: string): string => `hunter:${hid}`;
/**
 * One ability in the hotbar: its cost after the user's cost cut, the rounds until it is ready (0: ready), whether it is
 * an item's and pinned, its uses left when it is limited (null when not; kits table 2.3), and for a reaction (kits design
 * 8.4) where it stands: `arm` (not armed), `armed`, or `spent` (it fired since its user's turn began); null for an
 * ability used on a turn. A reaction's tap arms or disarms it; it is never picked to aim.
 */
export type HotbarSlot = {
  readonly id: Ability['id']; readonly name: string; readonly fatigue: number; readonly mana: number;
  readonly wait: number; readonly item: boolean; readonly pinned: boolean;
  readonly left: number | null; readonly react: 'arm' | 'armed' | 'spent' | null;
};
/** What the hotbar knows of a body's kits: its armed reaction (`Body.armed`, or what a player's phone armed) and its uses left (`usesLeft`, the doc's `left`). */
export type HotbarKit = { readonly armed?: { readonly ability: string; readonly spent: boolean } | null; readonly left?: Readonly<Record<string, number>> };
/** The most abilities pinned beside the attack. */
export const PINS = 4;
/**
 * The hotbar of a body with `abilities`: the default attack, then up to `PINS` pinned abilities (the first that are not
 * an item's when `pins` is null), and the rest in the drawer with the items' last. `readyAt` is when each is ready
 * again (a row's `readyAt`, or the room doc's `ready`), `costCut` the user's sheet's. `full`: `PINS` are pinned, so
 * the drawer offers no more Pin.
 */
export function hotbar(abilities: readonly Ability[], readyAt: Readonly<Record<string, Tick>>, now: Tick, costCut: number, pins: readonly string[] | null, R: MapRules, kit: HotbarKit = {}): { bar: HotbarSlot[]; more: HotbarSlot[]; full: boolean } {
  const own = abilities.filter(a => itemOfAbility(a) === null && a.id !== ATTACK_ID);
  const chosen = (pins === null ? own.slice(0, PINS).map(a => a.id as string) : pins.filter(id => own.some(a => a.id === id)).slice(0, PINS));
  const react = (a: Ability): HotbarSlot['react'] => !a.react ? null : kit.armed && kit.armed.ability === a.id ? (kit.armed.spent ? 'spent' : 'armed') : 'arm';
  const slot = (a: Ability): HotbarSlot => ({
    id: a.id, name: a.name, ...costOf(a, costCut), wait: readyIn(readyAt, a.id, now, R), item: itemOfAbility(a) !== null, pinned: chosen.includes(a.id),
    left: kit.left && Object.hasOwn(kit.left, a.id) ? kit.left[a.id]! : null, react: react(a),
  });
  const attack = abilities.filter(a => a.id === ATTACK_ID);
  return {
    bar: [...attack, ...chosen.map(id => own.find(a => a.id === id)!)].map(slot),
    more: [...own.filter(a => !chosen.includes(a.id)), ...abilities.filter(a => itemOfAbility(a) !== null)].map(slot),
    full: chosen.length >= PINS,
  };
}
