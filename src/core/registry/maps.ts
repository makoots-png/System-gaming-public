// maps.ts: a saved battle map, the GM's place to fight in (docs/agent-handoff/rw/design.md section 5.3). A map is its
// size, one terrain character a tile (space.ts `TERRAIN`), the zones that are always on it (lava, a burning brazier), the
// tiles each side starts on, how far the party sees, and whether the party's view has a fog. One parser, `parseBattleMap`,
// reads a map from the GM's library, a pack or the editor; a wrong field takes its default and only a map with no name is
// refused (the model is `parseItem`). A fight is made from a map by `fightMapOf` (the fight's `add` places rows on its
// starts); a fight with no map named is made from `openArena`, on the same path. A gate names a map by its id (`GateFields.mapId`).
import type { Rules } from '../rules.ts';
import { GRID_SIDE, place, terrainOfChar, tiles, TERRAIN } from '../combat/space.ts';
import type { Grid, Place, Side, Terrain } from '../combat/space.ts';
import type { Op } from '../combat/effect-ops.ts';
import { parseZone } from '../combat/fight-parse.ts';
import { MAX_ZONES, zoneId } from '../combat/zones.ts';
import type { Ground, Zone } from '../combat/zones.ts';
import type { Fog } from '../combat/fight-types.ts';
import type { MapId } from '../ids.ts';

export type { MapId };
export const mapId = (s: string): MapId => s as MapId;

/** A map's zone: always on a fixed list of tiles (a map has no body to lay an aura around). */
export type MapZone = Zone & { readonly ground: Extract<Ground, { kind: 'tiles' }> };
/**
 * A saved map. `tiles`: one terrain character a tile, row by row from the top. `zones`: the zones always on it, each
 * owned by nobody and lasting until removed. `starts`: the tiles each side's combatants take, in order, before the
 * default lines. `sight`: how far the party sees, in tiles. `fog`: whether the party's view hides what it cannot see.
 */
export type BattleMap = {
  readonly id: MapId; readonly name: string; readonly w: number; readonly h: number; readonly tiles: string;
  readonly zones: readonly MapZone[]; readonly starts: { readonly party: readonly Place[]; readonly foe: readonly Place[] };
  readonly sight: number; readonly fog: boolean;
};

/**
 * The bounds of a map. 40 by 40 tiles (200 by 200 feet) is twice the default arena each way: a phone pans it, and its
 * tile text (1,600 characters) and the doc's fog line fit the room doc's cap (protocol.ts `DOC_MAX`). 4 by 4 is the
 * smallest room that holds a fight. 12 starts a side is the most a phone shows on one side.
 */
export const MAP_BOUNDS = { size: GRID_SIDE, name: 40, starts: 12, sight: [1, 128] } as const;
/** At most this many maps in the GM's library. */
export const MAX_MAPS = 50;

/**
 * The open arena: the rules' default grid (a GM's override of `fight.grid` included, kept to `GRID_SIDE`), all floor,
 * no zones, no fog. A fight with no map named is fought on it.
 */
export function openArena(R: Pick<Rules, 'fight'>): BattleMap {
  const side = (n: number): number => Number.isFinite(n) ? Math.max(GRID_SIDE[0], Math.min(GRID_SIDE[1], Math.round(n))) : GRID_SIDE[0];
  const w = side(R.fight.grid.w), h = side(R.fight.grid.h);
  return { id: mapId('open'), name: 'Open arena', w, h, tiles: TERRAIN.floor.char.repeat(w * h), zones: [], starts: { party: [], foe: [] }, sight: R.fight.sight, fog: false };
}

type Rec = Record<string, unknown>;
const isObj = (v: unknown): v is Rec => v !== null && typeof v === 'object' && !Array.isArray(v);
const whole = (v: unknown, lo: number, hi: number, d: number): number => typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi ? v : d;

/**
 * The map in `v`, or null when it has no name. Its size is 4 to 40 each way (else the default arena's); a tile text of
 * another length, or a character no terrain has, is floor; a zone that does not read, or that lies around an anchor
 * rather than on its tiles, is dropped (at most `MAX_ZONES`), and a map's zone is owned by nobody and lasts until
 * removed; a start off the map, on a tile no body stands on or
 * named twice is dropped (at most 12 a side); sight is 1 to 128 (else the rules'); fog is off unless it is `true`.
 */
export function parseBattleMap(v: unknown, R: Rules): BattleMap | null {
  if (!isObj(v)) return null;
  const name = typeof v.name === 'string' ? v.name.replace(/\s+/g, ' ').trim().slice(0, MAP_BOUNDS.name) : '';
  if (!name) return null;
  const d = openArena(R), [lo, hi] = MAP_BOUNDS.size;
  const w = whole(v.w, lo, hi, d.w), h = whole(v.h, lo, hi, d.h);
  const text = typeof v.tiles === 'string' && v.tiles.length === w * h ? v.tiles : '';
  const list: Terrain[] = Array.from({ length: w * h }, (_, i) => terrainOfChar(text[i] ?? '') ?? 'floor');
  const grid: Grid = { w, h, tiles: list };
  const zones: MapZone[] = [];
  for (const z of Array.isArray(v.zones) ? v.zones : []) {
    if (zones.length >= MAX_ZONES) break;
    const read = parseZone(isObj(z) ? { owner: null, until: null, endsWithOwner: false, spares: null, tier: 0, ...z } : z, grid, R);
    const ground = read?.ground;
    if (read && ground?.kind === 'tiles' && !zones.some(x => x.id === read.id)) zones.push({ ...read, ground, owner: null, until: null, endsWithOwner: false });
  }
  const startsOf = (raw: unknown, taken: Set<number>): Place[] => {
    const out: Place[] = [];
    for (const p of Array.isArray(raw) ? raw : []) {
      if (out.length >= MAP_BOUNDS.starts || !isObj(p)) continue;
      const x = whole(p.x, 0, w - 1, -1), y = whole(p.y, 0, h - 1, -1), i = y * w + x;
      if (x < 0 || y < 0 || !TERRAIN[list[i]!].walk || taken.has(i)) continue;
      taken.add(i); out.push(place(x, y));
    }
    return out;
  };
  const taken = new Set<number>(), s = isObj(v.starts) ? v.starts : {};
  const starts = { party: startsOf(s.party, taken), foe: startsOf(s.foe, taken) };
  const id = typeof v.id === 'string' && v.id.length > 0 && v.id.length <= 40 ? mapId(v.id) : mapId('map');
  return {
    id, name, w, h, tiles: list.map(t => TERRAIN[t].char).join(''), zones, starts,
    sight: whole(v.sight, MAP_BOUNDS.sight[0], MAP_BOUNDS.sight[1], d.sight), fog: v.fog === true,
  };
}

/** A map's grid: its tiles as terrain, or null tiles (open floor) when every tile is floor. */
export function gridOfMap(m: BattleMap): Grid {
  const list = [...m.tiles].map(c => terrainOfChar(c) ?? 'floor');
  return { w: m.w, h: m.h, tiles: list.every(t => t === 'floor') ? null : list };
}

/** What a fight starts with from a map: its grid, its zones (ids kept, so a map's zone is the same zone in each fight), its fog and its starts. */
export function fightMapOf(m: BattleMap): { grid: Grid; zones: readonly Zone[]; fog: Fog | null; starts: BattleMap['starts'] } {
  return {
    grid: gridOfMap(m), zones: m.zones.map(z => ({ ...z, id: zoneId(`m-${z.id}`.slice(0, 40)) })),
    fog: m.fog ? { sight: tiles(m.sight), seen: '0'.repeat(m.w * m.h) } : null, starts: m.starts,
  };
}

// ── the map maker's form projection ──
/** One lasting field as the map maker holds it: its tiles as grid indices, keeping every other `MapZone` field unchanged. */
export type MapFormZone = {
  id: string;
  name: string;
  ops: readonly Op[];
  tiles: Set<number>;
  readonly spares?: Side | null;
  readonly tier?: number;
  readonly upkeep?: Zone['upkeep'];
  readonly end?: Zone['end'];
  readonly triggers?: Zone['triggers'];
  readonly laid?: Zone['laid'];
  readonly paid?: Zone['paid'];
};
/** The map maker's form state: tiles as single-character cells, zones and starts as tile indices. */
export type MapForm = {
  name: string;
  w: number;
  h: number;
  tiles: string[];
  fog: boolean;
  sight: number;
  zones: MapFormZone[];
  starts: { party: number[]; foe: number[] };
};

/** Opens a saved `BattleMap` into the map maker's form state without dropping any optional `MapZone` field. */
export function mapToForm(m: BattleMap): MapForm {
  return {
    name: m.name,
    w: m.w,
    h: m.h,
    tiles: [...m.tiles],
    fog: m.fog,
    sight: m.sight,
    zones: m.zones.map(z => {
      const { id, name, ops, ground, owner: _owner, until: _until, endsWithOwner: _ends, ...keep } = z;
      return {
        ...keep,
        id: String(id),
        name,
        ops: [...ops],
        tiles: new Set(ground.tiles.map(p => p.y * m.w + p.x)),
      };
    }),
    starts: {
      party: m.starts.party.map(p => p.y * m.w + p.x),
      foe: m.starts.foe.map(p => p.y * m.w + p.x),
    },
  };
}

/** Writes the map maker's form state under `id` as the raw object `parseBattleMap` reads. */
export function mapFormRaw(st: MapForm, id: string): Record<string, unknown> {
  return {
    id,
    name: st.name,
    w: st.w,
    h: st.h,
    tiles: st.tiles.join(''),
    fog: st.fog,
    sight: st.sight,
    zones: st.zones.filter(z => z.tiles.size).map(z => {
      const { id: zid, name, ops, tiles: tileSet, ...keep } = z;
      return {
        ...keep,
        id: zid,
        name: name.trim() || 'Field',
        ops,
        ground: { kind: 'tiles', tiles: [...tileSet].sort((a, b) => a - b).map(i => ({ x: i % st.w, y: Math.floor(i / st.w) })) },
      };
    }),
    starts: {
      party: st.starts.party.map(i => ({ x: i % st.w, y: Math.floor(i / st.w) })),
      foe: st.starts.foe.map(i => ({ x: i % st.w, y: Math.floor(i / st.w) })),
    },
  };
}

/** Parses the map maker's form state back into a `BattleMap` under `id`, or null when it has no name. */
export function mapFromForm(st: MapForm, id: string, R: Rules): BattleMap | null {
  return parseBattleMap(mapFormRaw(st, id), R);
}
