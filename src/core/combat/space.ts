// space.ts: where things are in a fight (docs/agent-handoff/rw/design.md sections 3.1 and 5). Square tiles, the 5-10-5
// distance, the tiles an ability's shape covers, the default places of a fight with no map, a walk around bodies and walls
// and the way it goes, a dash's line, and where a target steps to avoid a shape. Pure; the rule numbers come in as
// `SpaceRules`. Sight (`sees`, `inSight`, `seenBy`) and every line read the terrain's `blocksLine`. A new shape is a member of `Shape`
// and its case in `tilesOf`; a new terrain is a member of `Terrain` and its row in `TERRAIN` (the typecheck asks for
// both), each with a case in tests/space.test.ts.
import type { Brand } from '../ids.ts';

/** A whole number of tiles: a distance, a reach or a count of steps. */
export type Tiles = Brand<number, 'Tiles'>;
/** 0 to 100. */
export type Percent = Brand<number, 'Percent'>;
/** A tile of the grid, whole numbers from 0. */
export type Place = Brand<{ readonly x: number; readonly y: number }, 'Place'>;

/** The tiles an ability covers, from its user and its aim (design 3.3). */
export type Shape =
  | { readonly kind: 'self' }
  | { readonly kind: 'touch'; readonly reach: Tiles }
  | { readonly kind: 'line'; readonly width: Tiles; readonly pierce: boolean }
  | { readonly kind: 'radius'; readonly radius: Tiles; readonly ring: { readonly outer: Tiles; readonly share: Percent } | null };

/** What a tile of the map is. A fight with no map is all floor. */
export type Terrain = 'floor' | 'wall' | 'cover' | 'rough' | 'pit';
/**
 * A terrain's row: its character in a drawn or stored map, whether a body may stand on it, what a step onto it costs (in
 * steps of the 5-10-5 count: a walk, a dash and a dodge pay it), whether it stops a line (a shot, a blast's spread, sight),
 * and whether a body on it is in cover (`coverShare` of the rules). Movement, lines and sight read these columns; nothing
 * reads a terrain's name.
 */
export type TerrainRow = { readonly char: string; readonly walk: boolean; readonly enter: number; readonly blocksLine: boolean; readonly cover: boolean };
/**
 * Each terrain's row. Rough ground costs two to enter, so a stride across it is half as long (design 4.6: zones and
 * rough ground multiply the per-tile cost). A pit (or deep water) holds no body but a shot and an eye pass over it.
 */
export const TERRAIN: { readonly [T in Terrain]: TerrainRow } = {
  floor: { char: '.', walk: true, enter: 1, blocksLine: false, cover: false },
  wall: { char: '#', walk: false, enter: 1, blocksLine: true, cover: false },
  cover: { char: 'o', walk: true, enter: 1, blocksLine: false, cover: true },
  rough: { char: '~', walk: true, enter: 2, blocksLine: false, cover: false },
  pit: { char: '_', walk: false, enter: 1, blocksLine: false, cover: false },
};
export const TERRAINS = Object.keys(TERRAIN) as readonly Terrain[];
/** The terrain of a map's character, or null for a character no terrain has. */
export const terrainOfChar = (c: string): Terrain | null => TERRAINS.find(t => TERRAIN[t].char === c) ?? null;
/** A grid's tiles as one character each, row by row (the form a saved map and the room's doc carry). */
export const tilesText = (grid: Grid): string => grid.tiles ? grid.tiles.map(t => TERRAIN[t].char).join('') : TERRAIN.floor.char.repeat(grid.w * grid.h);

/** The fight's map: its size and its tiles row by row from the top (`tiles[y * w + x]`), or `null` for open floor. */
export type Grid = { readonly w: number; readonly h: number; readonly tiles: readonly Terrain[] | null };

/** The rule numbers this module reads. A later unit passes `RULES.fight`. */
export type SpaceRules = {
  /** Feet in one tile. */
  readonly tileFeet: number;
  /** Tiles between the party's line and the foes' line in a fight with no map. */
  readonly lineGap: number;
  /** Rows kept behind the party's front line in a fight with no map, so a reserve stands behind the front. */
  readonly lineBack: number;
};

/** The two sides of a fight. */
export type Side = 'party' | 'foe';
/** The tiles a use covers: `hit` in full, `ring` at the ring's share. A line's `hit` is in order from the user. */
export type Cover = { readonly hit: readonly Place[]; readonly ring: readonly Place[] };
/** Where a target ends against a shape after it moved (design 3.1 rule 8a). The resolver adds `resisted` for a use with no travel. */
export type Dodge = 'caught' | 'ring' | 'out';
/** A tile a walk reaches and the fewest steps it takes. */
export type MoveReach = { readonly place: Place; readonly steps: Tiles };

export const place = (x: number, y: number): Place => ({ x, y }) as Place;
export const tiles = (n: number): Tiles => n as Tiles;
export const percent = (n: number): Percent => n as Percent;

/** The 5-10-5 distance: every second diagonal step costs 2, so a radius looks round and stays a whole number. */
export function dist(a: Place, b: Place): Tiles {
  const dx = Math.abs(a.x - b.x), dy = Math.abs(a.y - b.y);
  return tiles(Math.max(dx, dy) + Math.floor(Math.min(dx, dy) / 2));
}

export const feet = (t: Tiles, rules: SpaceRules): number => t * rules.tileFeet;

/**
 * The sides of a fight's map, in tiles (design 4.8): 4 is the smallest room that holds a fight, 40 (200 feet) twice the
 * default arena each way, what a phone pans and the room doc carries (`DOC_TILES_MAX`). A saved map has the same bounds
 * (registry/maps.ts `MAP_BOUNDS`), and the GM's `resize` keeps a fight inside them.
 */
export const GRID_SIDE = [4, 40] as const;
/** A map of open floor. A fight with no map has one of the default size. */
export const openGrid = (w: number, h: number): Grid => ({ w, h, tiles: null });

const inside = (grid: Grid, x: number, y: number): boolean => x >= 0 && y >= 0 && x < grid.w && y < grid.h;
/** The terrain at (x, y); off the grid it is floor (callers ask `inside` first where it matters). */
export const terrain = (grid: Grid, x: number, y: number): Terrain => grid.tiles?.[y * grid.w + x] ?? 'floor';
const walkable = (grid: Grid, x: number, y: number): boolean => inside(grid, x, y) && TERRAIN[terrain(grid, x, y)].walk;
const indexOf = (grid: Grid, p: Place): number => p.y * grid.w + p.x;

/**
 * The tiles a shape covers when its user stands at `from` and aims at `aim`. A touch takes its target when `sees` finds
 * a line to it. A line runs from the tile after the user to the aim, `width` tiles either side, and stops before the
 * first tile that blocks a line. A radius is centred on the aim and takes each tile its centre `sees`, so a blast stops
 * at a wall and does not go round a corner (design 4.7): a tile behind a wall is safe.
 */
export function tilesOf(shape: Shape, from: Place, aim: Place, grid: Grid): Cover {
  switch (shape.kind) {
    case 'self': return { hit: [from], ring: [] };
    case 'touch': return { hit: sees(from, aim, grid) ? [aim] : [], ring: [] };
    case 'line': return { hit: lineTiles(from, aim, shape.width, grid), ring: [] };
    case 'radius': {
      const outer = shape.ring?.outer ?? shape.radius;
      const hit: Place[] = [], ring: Place[] = [];
      for (let y = Math.max(0, aim.y - outer); y <= Math.min(grid.h - 1, aim.y + outer); y++) {
        for (let x = Math.max(0, aim.x - outer); x <= Math.min(grid.w - 1, aim.x + outer); x++) {
          const p = place(x, y), d = dist(aim, p);
          if (d > outer || TERRAIN[terrain(grid, x, y)].blocksLine || !sees(aim, p, grid)) continue;
          (d <= shape.radius ? hit : ring).push(p);
        }
      }
      return { hit, ring };
    }
    default: return shape satisfies never;
  }
}

/** Whether the centre line from `a` to `b` (as a line ability's: one tile a step along the longer axis) crosses no tile that blocks a line, the two ends aside. */
function clearLine(a: Place, b: Place, grid: Grid): boolean {
  const dx = b.x - a.x, dy = b.y - a.y, n = Math.max(Math.abs(dx), Math.abs(dy));
  for (let i = 1; i < n; i++) if (TERRAIN[terrain(grid, a.x + Math.round(i * dx / n), a.y + Math.round(i * dy / n))].blocksLine) return false;
  return true;
}
/**
 * Whether a body at `a` sees the tile `b`: the centre line one way or the other crosses nothing that blocks a line (the
 * two ends aside, so a wall itself is seen). Either way, so sight is mutual: what sees a body is seen by it.
 */
export const sees = (a: Place, b: Place, grid: Grid): boolean => clearLine(a, b, grid) || clearLine(b, a, grid);

/**
 * A push or a pull (kits design 8.3, table 8.9.3): the tiles a body at `at` moves through, tile by tile on the centre
 * line from `anchor` through it (as `clearLine` steps), away from the anchor or toward it, spending `k` steps of the
 * 5-10-5 count (rough ground costs its `enter`, as a walk). It stops before a wall, a pit, the map's edge or a body, and a
 * pull next to its anchor. The last tile is where the body lands; none when it does not move (or stands on its anchor).
 */
export function shovePath(anchor: Place, at: Place, dir: 'away' | 'toward', k: number, grid: Grid, bodies: readonly Place[]): Place[] {
  const dx = at.x - anchor.x, dy = at.y - anchor.y, n = Math.max(Math.abs(dx), Math.abs(dy)), out: Place[] = [];
  let s = shoveStep({ at: 'standing' }, { type: 'lands', k: n === 0 ? 0 : k });
  for (let i = dir === 'away' ? n + 1 : n - 1; s.at === 'moving'; i += dir === 'away' ? 1 : -1) {
    if (i < 1) { s = shoveStep(s, { type: 'anchor' }); break; }
    const p = place(anchor.x + Math.round(i * dx / n), anchor.y + Math.round(i * dy / n));
    const on = p.x >= 0 && p.y >= 0 && p.x < grid.w && p.y < grid.h, t = TERRAIN[terrain(grid, p.x, p.y)];
    s = shoveStep(s, { type: 'tile', free: on && t.walk && !bodies.some(b => b.x === p.x && b.y === p.y), cost: t.enter });
    if (s.at === 'landed' && s.moved) out.push(p);
    if (s.at === 'moving') out.push(p);
  }
  return out;
}
/** A body pushed or pulled (kits design 8.3, table 8.9.3): standing, moving with `k` steps left, or landed (`moved`: its last tile counts). */
export const SHOVE_STATES = ['standing', 'moving', 'landed'] as const;
export type Shoved = { readonly at: 'standing' } | { readonly at: 'moving'; readonly k: number } | { readonly at: 'landed'; readonly moved: boolean };
/** It lands with `k` tiles (0 when rooted, missed or on its anchor); the next tile, free or not, at its cost; its anchor reached; `zoneSync` after it. */
export type ShoveEvent = { readonly type: 'lands'; readonly k: number } | { readonly type: 'tile'; readonly free: boolean; readonly cost: number } | { readonly type: 'anchor' } | { readonly type: 'settles' };
type ShoveFn<E extends ShoveEvent['type']> = (s: Shoved, e: Extract<ShoveEvent, { type: E }>) => Shoved;
const steps = (s: Shoved): number => (s.at === 'moving' ? s.k : 0);
/** Table 8.9.3. A stop deals nothing; a pit, a wall, the edge and a body stop it before them. `null`: nothing changes. */
const SHOVE_TABLE: { readonly [S in Shoved['at']]: { readonly [E in ShoveEvent['type']]: ShoveFn<E> | null } } = {
  standing: { lands: (_s, e) => (e.k > 0 ? { at: 'moving', k: e.k } : { at: 'standing' }), tile: null, anchor: null, settles: null },
  moving: {
    lands: null,
    tile: (s, e) => (!e.free || e.cost > steps(s) ? { at: 'landed', moved: false } : steps(s) - e.cost > 0 ? { at: 'moving', k: steps(s) - e.cost } : { at: 'landed', moved: true }),
    anchor: () => ({ at: 'landed', moved: false }), settles: null,
  },
  landed: { lands: null, tile: null, anchor: null, settles: () => ({ at: 'standing' }) },
};
export function shoveStep(s: Shoved, e: ShoveEvent): Shoved {
  const step = SHOVE_TABLE[s.at][e.type] as ShoveFn<ShoveEvent['type']> | null;
  return step ? step(s, e as never) : s;
}

/**
 * Whether a body at `a` has the tile `b` in sight `n` tiles far: within `n` by the 5-10-5 count, and `sees` it. The one
 * geometry of sight: the fog's lit tiles (`seenBy`) and a single body's eyes (sight.ts `perceives`) both ask it.
 */
export const inSight = (a: Place, b: Place, grid: Grid, n: number): boolean => dist(a, b) <= n && sees(a, b, grid);

/** A body that looks: where it stands, its side, and whether it is up (a body at 0 HP sees nothing). */
export type Viewer = { readonly place: Place; readonly side: Side; readonly up: boolean };
/**
 * The tiles `side` sees (design 5.3): every tile `inSight` of a body of that side that is up, `sight` tiles far. The
 * union over the side, so the whole party shares one view. As indices `y * w + x`.
 */
export function seenBy(side: Side, bodies: readonly Viewer[], grid: Grid, sight: number): Set<number> {
  const out = new Set<number>();
  for (const b of bodies) {
    if (b.side !== side || !b.up) continue;
    const p = b.place;
    for (let y = Math.max(0, p.y - sight); y <= Math.min(grid.h - 1, p.y + sight); y++) {
      for (let x = Math.max(0, p.x - sight); x <= Math.min(grid.w - 1, p.x + sight); x++) {
        const i = y * grid.w + x, t = place(x, y);
        if (!out.has(i) && inSight(p, t, grid, sight)) out.add(i);
      }
    }
  }
  return out;
}

// The centre line takes one tile per step along the longer axis, rounding the shorter one (a half rounds up); the width
// spreads across the shorter axis, so no tile is listed twice.
function lineTiles(from: Place, aim: Place, width: Tiles, grid: Grid): Place[] {
  const dx = aim.x - from.x, dy = aim.y - from.y, n = Math.max(Math.abs(dx), Math.abs(dy));
  const across = Math.abs(dx) >= Math.abs(dy) ? place(0, 1) : place(1, 0);
  const hit: Place[] = [];
  for (let i = 1; i <= n; i++) {
    const x = from.x + Math.round(i * dx / n), y = from.y + Math.round(i * dy / n);
    if (TERRAIN[terrain(grid, x, y)].blocksLine) break;
    for (let k = -width; k <= width; k++) {
      const sx = x + k * across.x, sy = y + k * across.y;
      if (inside(grid, sx, sy) && !TERRAIN[terrain(grid, sx, sy)].blocksLine) hit.push(place(sx, sy));
    }
  }
  return hit;
}

/**
 * A dash's path (design 4.6): the tiles of the centre line from `from` to `to`, as a line ability's, without `from`, when
 * no wall, edge or body is on a tile of it, else null.
 */
export function straightPath(from: Place, to: Place, grid: Grid, bodies: readonly Place[]): Place[] | null {
  const filled = new Set(bodies.map(b => indexOf(grid, b)));
  const dx = to.x - from.x, dy = to.y - from.y, n = Math.max(Math.abs(dx), Math.abs(dy)), path: Place[] = [];
  for (let i = 1; i <= n; i++) {
    const x = from.x + Math.round(i * dx / n), y = from.y + Math.round(i * dy / n);
    if (!walkable(grid, x, y) || filled.has(y * grid.w + x)) return null;
    path.push(place(x, y));
  }
  return path;
}

/** A dash's cost when `straightPath` finds its line clear, else null: its 5-10-5 length, and each tile's cost to enter past one. */
export function straightCost(from: Place, to: Place, grid: Grid, bodies: readonly Place[]): Tiles | null {
  const path = straightPath(from, to, grid, bodies);
  return path && tiles(dist(from, to) + path.reduce((n, p) => n + TERRAIN[terrain(grid, p.x, p.y)].enter - 1, 0));
}

/** The bodies a use catches in full and in its ring. A line that does not pierce stops at the first body from the user. */
export function inShape<T extends { readonly place: Place }>(shape: Shape, from: Place, aim: Place, grid: Grid, bodies: readonly T[]): { hit: T[]; ring: T[] } {
  const cover = tilesOf(shape, from, aim, grid);
  const on = (list: readonly Place[]): T[] => list.flatMap(p => bodies.filter(b => b.place.x === p.x && b.place.y === p.y));
  const hit = on(cover.hit);
  return { hit: shape.kind === 'line' && !shape.pierce ? hit.slice(0, 1) : hit, ring: on(cover.ring) };
}

/**
 * Where a combatant of `side` stands when it joins a fight with no map: the first free tile of its side's front line, then
 * of the line one tile behind it (away from the other side), then of the one behind that, to the grid's edge. The party's
 * front line is `lineBack` rows from the top and the foes' is `lineGap` rows further down, so both sides have rows behind
 * them. Null when every row from the front line back to the edge is full; a line never goes in front of its front.
 */
export function defaultPlace(side: Side, taken: readonly Place[], grid: Grid, rules: SpaceRules): Place | null {
  const front = side === 'party' ? rules.lineBack : rules.lineBack + rules.lineGap, away = side === 'party' ? -1 : 1;
  for (let y = front; y >= 0 && y < grid.h; y += away) {
    for (let x = 0; x < grid.w; x++) {
      if (walkable(grid, x, y) && !taken.some(p => p.x === x && p.y === y)) return place(x, y);
    }
  }
  return null;
}

const STEPS = [[0, -1], [-1, 0], [1, 0], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]] as const;

/**
 * The walk's search: from `from`, at most `limit` steps. A step goes to one of the eight tiles around; it may not enter a
 * tile no body stands on or a tile in `bodies` (the other bodies), nor slip diagonally between two such tiles. Steps are
 * counted as the 5-10-5 distance counts them, plus each tile's cost to enter past one (`TERRAIN`'s `enter`: rough ground
 * costs a step more), so a search state is a tile and whether the walk's diagonal steps so far are odd:
 * (y * w + x) * 2 + odd. Answers each tile reached with its fewest steps and the state that reached it, and each state's
 * parent on its shortest walk.
 */
function walk(from: Place, limit: number, grid: Grid, bodies: readonly Place[]): { found: Map<number, { reach: MoveReach; state: number }>; parent: Map<number, number> } {
  const filled = new Set(bodies.map(b => indexOf(grid, b)));
  const free = (x: number, y: number): boolean => walkable(grid, x, y) && !filled.has(y * grid.w + x);
  const wall = (x: number, y: number): boolean => !TERRAIN[terrain(grid, x, y)].walk;
  const best = new Map<number, number>(), parent = new Map<number, number>();
  const buckets: number[][] = [];
  const push = (state: number, steps: number, prev: number | null): void => {
    if (steps > limit || (best.get(state) ?? Infinity) <= steps) return;
    best.set(state, steps);
    if (prev !== null) parent.set(state, prev);
    (buckets[steps] ??= []).push(state);
  };
  push(indexOf(grid, from) * 2, 0, null);
  const found = new Map<number, { reach: MoveReach; state: number }>();
  for (let steps = 0; steps < buckets.length; steps++) {
    for (const state of buckets[steps] ?? []) {
      if (best.get(state) !== steps) continue;
      const tile = state >> 1, odd = state & 1, x = tile % grid.w, y = (tile - x) / grid.w;
      if (!found.has(tile)) found.set(tile, { reach: { place: place(x, y), steps: tiles(steps) }, state });
      for (const [dx, dy] of STEPS) {
        const nx = x + dx, ny = y + dy, diagonal = dx !== 0 && dy !== 0;
        if (!free(nx, ny) || (diagonal && wall(nx, y) && wall(x, ny))) continue;
        const enter = TERRAIN[terrain(grid, nx, ny)].enter - 1;
        push((ny * grid.w + nx) * 2 + (diagonal ? odd ^ 1 : odd), steps + (diagonal && odd ? 2 : 1) + enter, state);
      }
    }
  }
  return { found, parent };
}

/**
 * Every tile a walk from `from` reaches in at most `limit` steps (`walk`), with the fewest steps, in order of steps, then
 * `y`, then `x`.
 */
export function reachable(from: Place, limit: number, grid: Grid, bodies: readonly Place[]): MoveReach[] {
  return [...walk(from, limit, grid, bodies).found.values()].map(f => f.reach)
    .sort((a, b) => a.steps - b.steps || a.place.y - b.place.y || a.place.x - b.place.x);
}

/** The fewest steps of a walk from `from` to `to` around walls and the other bodies, or null when no walk gets there. */
export function pathCost(from: Place, to: Place, grid: Grid, bodies: readonly Place[]): Tiles | null {
  return reachable(from, Infinity, grid, bodies).find(r => r.place.x === to.x && r.place.y === to.y)?.steps ?? null;
}

/**
 * The tiles of one walk of `pathCost`'s fewest steps from `from` to `to`, without `from`, or null when no walk gets
 * there: what the map draws as the way a move will go.
 */
export function walkPath(from: Place, to: Place, grid: Grid, bodies: readonly Place[]): Place[] | null {
  if (!inside(grid, to.x, to.y)) return null;
  const { found, parent } = walk(from, Infinity, grid, bodies), end = found.get(indexOf(grid, to));
  if (!end) return null;
  const path: Place[] = [];
  for (let s: number | undefined = end.state; s !== undefined && parent.has(s); s = parent.get(s)) { const t = s >> 1; path.push(place(t % grid.w, Math.floor(t / grid.w))); }
  return path.reverse();
}

/** One tile a target can end on during a dodge: the tile, its walk cost in steps (0 for staying put), and where it lies in `cover`. */
export type DodgeTile = { readonly place: Place; readonly steps: Tiles; readonly avoid: Dodge };
/**
 * Every tile a target at `at` that can move `can` steps may dodge to against a use's cover: every tile `reachable`
 * reaches (starting with `at` at 0 steps), each tagged with its `avoid` tier (`'out'`, `'ring'`, or `'caught'`), plus
 * `auto`, the automatic pick (best `avoid` tier, then fewest steps, then lowest `y`, then `x`; staying put when trapped
 * in `'caught'` or already in `'ring'` with no way clear).
 */
export type DodgeOptions = { readonly tiles: readonly DodgeTile[]; readonly auto: DodgeTile };
export function dodgeOptions(at: Place, can: Tiles, cover: Cover, grid: Grid, bodies: readonly Place[]): DodgeOptions {
  const hit = new Set(cover.hit.map(p => indexOf(grid, p))), ring = new Set(cover.ring.map(p => indexOf(grid, p)));
  const where = (p: Place): Dodge => hit.has(indexOf(grid, p)) ? 'caught' : ring.has(indexOf(grid, p)) ? 'ring' : 'out';
  const list: DodgeTile[] = reachable(at, can, grid, bodies).map(r => ({ place: r.place, steps: r.steps, avoid: where(r.place) }));
  const auto = list.find(t => t.avoid === 'out') ?? list.find(t => t.avoid === 'ring') ?? list[0]!;
  return { tiles: list, auto };
}

/**
 * Design 3.1 rule 8a: where a target at `at` that can move `can` steps ends against a use's cover. It takes the best tile
 * it reaches that no body or wall fills: out of the cover, else in the ring, on a tie the fewest steps, then the lowest
 * `y`, then `x`. A target that can reach neither is caught and stays where it is.
 */
export function dodge(at: Place, can: Tiles, cover: Cover, grid: Grid, bodies: readonly Place[]): { avoid: Dodge; to: Place } {
  const { auto } = dodgeOptions(at, can, cover, grid, bodies);
  return { avoid: auto.avoid, to: auto.place };
}
