// A battle map (src/core/registry/maps.ts): what parseBattleMap keeps of a saved or shared map, and how a fight starts on
// one. The expected values come from the bounds in MAP_BOUNDS and the terrain table in space.ts.
import { describe, expect, test } from 'bun:test';
import { RULES } from '../src/core/rules.ts';
import { place, TERRAIN, TERRAINS } from '../src/core/combat/space.ts';
import { MAX_ZONES } from '../src/core/combat/zones.ts';
import { fightMapOf, gridOfMap, MAP_BOUNDS, openArena, parseBattleMap } from '../src/core/registry/maps.ts';

/** A 6 by 4 room: a wall round the edge, rough ground and cover inside. */
const ROOM = '#######....##.~o.#######';
const read = (v: Record<string, unknown>) => parseBattleMap({ name: 'Room', w: 6, h: 4, tiles: ROOM, ...v }, RULES);

describe('a battle map', () => {
  test('only a map with no name is refused; a name is cut to 40 characters and its spaces folded', () => {
    expect(parseBattleMap({ w: 6 }, RULES)).toBeNull();
    expect(parseBattleMap({ name: '   ' }, RULES)).toBeNull();
    expect(parseBattleMap('Room', RULES)).toBeNull();
    expect(read({ name: `  Old   ${'x'.repeat(50)}` })!.name).toBe(`Old ${'x'.repeat(36)}`);
  });

  test('its size is 4 to 40 each way, else the open arena\'s; a tile text of another length is all floor', () => {
    expect([read({})!.w, read({})!.h, read({})!.tiles]).toEqual([6, 4, ROOM]);
    expect([read({ w: 41 })!.w, read({ h: 3 })!.h]).toEqual([RULES.fight.grid.w, RULES.fight.grid.h]);
    expect(read({ w: MAP_BOUNDS.size[1], h: MAP_BOUNDS.size[1], tiles: '' })!.tiles).toBe('.'.repeat(1600));
  });

  test('a character no terrain has is floor, and every terrain\'s character reads back as itself', () => {
    expect(read({ tiles: 'X'.repeat(24) })!.tiles).toBe('.'.repeat(24));
    const all = TERRAINS.map(t => TERRAIN[t].char).join('').padEnd(24, '.');
    expect(read({ tiles: all })!.tiles).toBe(all);
  });

  test('a start off the map, on a tile no body stands on, or named twice is dropped; at most 12 a side', () => {
    const starts = { party: [{ x: 1, y: 1 }, { x: 0, y: 0 }, { x: 9, y: 1 }, { x: 1, y: 1 }, { x: 2, y: 2 }], foe: [{ x: 2, y: 2 }, { x: 4, y: 2 }] };
    expect(read({ starts })!.starts).toEqual({ party: [place(1, 1), place(2, 2)], foe: [place(4, 2)] });
    const wide = Array.from({ length: 20 }, (_, i) => ({ x: i, y: 0 }));
    expect(parseBattleMap({ name: 'Field', starts: { party: wide } }, RULES)!.starts.party).toHaveLength(MAP_BOUNDS.starts);
  });

  test('a zone that does not read, or lies around an anchor, is dropped; a map\'s zone is owned by nobody and lasts until removed; at most 16', () => {
    const lava = { id: 'z1', name: 'Lava', ground: { kind: 'tiles', tiles: [{ x: 1, y: 1 }] }, ops: [{ op: 'damage', type: 'magical', amount: { kind: 'number', value: 5 } }], until: 3000, owner: 'c1' };
    const ring = { ...lava, id: 'z3', ground: { kind: 'around', anchor: { kind: 'place', at: { x: 2, y: 2 } }, radius: 1 } };
    const m = read({ zones: [lava, { id: 'z2', name: 'Bad', ground: { kind: 'tiles', tiles: [{ x: 9, y: 9 }] }, ops: [] }, ring, { name: 'No id' }] })!;
    expect(m.zones).toEqual([{ ...lava, until: null, owner: null, endsWithOwner: false, spares: null, tier: 0, ground: { kind: 'tiles', tiles: [place(1, 1)] } }]);
    expect(read({ zones: Array.from({ length: 20 }, (_, i) => ({ ...lava, id: `z${i}` })) })!.zones).toHaveLength(MAX_ZONES);
  });

  test('sight is 1 to 128 tiles, else the rules\'; fog is on only when it is true', () => {
    expect([read({ sight: 6 })!.sight, read({ sight: 0 })!.sight, read({ sight: 2.5 })!.sight]).toEqual([6, RULES.fight.sight, RULES.fight.sight]);
    expect([read({ fog: true })!.fog, read({ fog: 'yes' })!.fog]).toEqual([true, false]);
  });

  test('the open arena is the rules\' grid of floor with no zones and no fog, and its grid is open floor', () => {
    const a = openArena(RULES);
    expect([a.w, a.h, a.zones, a.fog]).toEqual([RULES.fight.grid.w, RULES.fight.grid.h, [], false]);
    expect(gridOfMap(a)).toEqual({ w: RULES.fight.grid.w, h: RULES.fight.grid.h, tiles: null });
    expect(fightMapOf(a)).toEqual({ grid: gridOfMap(a), zones: [], fog: null, starts: { party: [], foe: [] } });
  });

  test('a GM\'s override of the arena\'s size is its size, kept to 4 to 40 a side, since a larger fight does not read back', () => {
    const sized = (w: number, h: number) => { const a = openArena({ fight: { ...RULES.fight, grid: { w, h } } }); return [a.w, a.h]; };
    expect([sized(30, 20), sized(100, 2), sized(Number.NaN, 12)]).toEqual([[30, 20], [MAP_BOUNDS.size[1], MAP_BOUNDS.size[0]], [MAP_BOUNDS.size[0], 12]]);
  });

  test('a fight on a map with fog starts with nothing seen, at the map\'s sight', () => {
    expect(fightMapOf(read({ fog: true, sight: 6 })!).fog).toEqual({ sight: 6, seen: '0'.repeat(24) });
  });

});
