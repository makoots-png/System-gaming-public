import { describe, expect, test } from 'bun:test';
import { TERRAIN, defaultPlace, dist, dodge, dodgeOptions, feet, inShape, openGrid, pathCost, percent, place, reachable, sees, seenBy, shovePath, straightCost, straightPath, tiles, tilesOf, walkPath } from '../src/core/combat/space.ts';
import type { Cover, Grid, Place, Shape, SpaceRules, Terrain } from '../src/core/combat/space.ts';
import { rng } from './models/fight-play.ts';

// The numbers of design.md section 5, as the paper script's PAPER table has them.
const R: SpaceRules = { tileFeet: 5, lineGap: 8, lineBack: 2 };

// A map drawn as rows of characters: a terrain's character is that terrain, any other character is floor with a mark on it.
function draw(rows: readonly string[]): { grid: Grid; marks: (c: string) => Place[] } {
  const chars = (Object.keys(TERRAIN) as Terrain[]).map(t => [TERRAIN[t].char, t] as const);
  const cells = rows.flatMap(r => [...r]);
  const grid: Grid = { w: rows[0]!.length, h: rows.length, tiles: cells.map(c => chars.find(([ch]) => ch === c)?.[1] ?? 'floor') };
  const marks = (c: string): Place[] => cells.flatMap((ch, i) => ch === c ? [place(i % grid.w, Math.floor(i / grid.w))] : []);
  return { grid, marks };
}
const one = (list: Place[]): Place => list[0]!;
const same = (a: Place, b: Place): boolean => a.x === b.x && a.y === b.y;
// What a cover looks like on its grid: `x` hit, `o` ring, walls as drawn, `.` the rest.
function picture(grid: Grid, cover: Cover): string[] {
  return Array.from({ length: grid.h }, (_, y) => Array.from({ length: grid.w }, (_, x) => {
    const p = place(x, y);
    if (cover.hit.some(q => same(p, q))) return 'x';
    if (cover.ring.some(q => same(p, q))) return 'o';
    return grid.tiles?.[y * grid.w + x] === 'wall' ? TERRAIN.wall.char : '.';
  }).join(''));
}

const radius = (r: number, outer: number | null = null): Shape =>
  ({ kind: 'radius', radius: tiles(r), ring: outer === null ? null : { outer: tiles(outer), share: percent(50) } });
const line = (width: number, pierce: boolean): Shape => ({ kind: 'line', width: tiles(width), pierce });

describe('the 5-10-5 distance', () => {
  test('distances in tiles and feet are those of table 5.1', () => {
    const pairs = [[1, 0], [1, 1], [2, 2], [3, 0], [3, 3], [4, 2], [8, 0], [8, 6]] as const;
    const d = pairs.map(([dx, dy]) => dist(place(0, 0), place(dx, dy)));
    expect(d).toEqual([1, 1, 3, 3, 4, 5, 8, 11]);
    expect(d.map(t => feet(t, R))).toEqual([5, 5, 15, 15, 20, 25, 40, 55]);
  });

  test('the distance does not depend on the direction', () => {
    expect(dist(place(5, 2), place(1, 4))).toEqual(5);
    expect(dist(place(1, 4), place(5, 2))).toEqual(5);
  });
});

describe('the tiles a shape covers', () => {
  test('a self shape covers only the user', () => {
    const { grid, marks } = draw(['.....', '..U..', '.....']);
    expect(tilesOf({ kind: 'self' }, one(marks('U')), place(4, 0), grid)).toEqual({ hit: [place(2, 1)], ring: [] });
  });

  test('a touch covers only the one it touches', () => {
    const { grid, marks } = draw(['.....', '..UA.', '.....']);
    expect(tilesOf({ kind: 'touch', reach: tiles(1) }, one(marks('U')), one(marks('A')), grid)).toEqual({ hit: [place(3, 1)], ring: [] });
  });

  test('a radius 2 with a ring to 3 covers a round blast and a band around it', () => {
    const { grid, marks } = draw(['.........', '.........', '.........', '.........', '....A....', '.........', '.........', '.........', '.........']);
    expect(picture(grid, tilesOf(radius(2, 3), place(0, 0), one(marks('A')), grid))).toEqual([
      '.........',
      '...ooo...',
      '..oxxxo..',
      '.oxxxxxo.',
      '.oxxxxxo.',
      '.oxxxxxo.',
      '..oxxxo..',
      '...ooo...',
      '.........',
    ]);
  });

  test('a blast at the edge covers only the tiles on the map', () => {
    const { grid, marks } = draw(['A...', '....', '....']);
    expect(picture(grid, tilesOf(radius(2), place(3, 2), one(marks('A')), grid))).toEqual(['xxx.', 'xxx.', 'xx..']);
  });

  test('a straight line of width 0 runs from the tile after the user to the aim', () => {
    const { grid, marks } = draw(['.......', 'U.....A', '.......']);
    expect(picture(grid, tilesOf(line(0, false), one(marks('U')), one(marks('A')), grid))).toEqual(['.......', '.xxxxxx', '.......']);
  });

  test('a line of width 1 covers one tile either side', () => {
    const { grid, marks } = draw(['.......', 'U.....A', '.......', '.......']);
    expect(picture(grid, tilesOf(line(1, false), one(marks('U')), one(marks('A')), grid))).toEqual(['.xxxxxx', '.xxxxxx', '.xxxxxx', '.......']);
  });

  test('a slanted line takes one tile a column, rounding a half down the slope', () => {
    const { grid, marks } = draw(['U....', '.....', '....A']);
    expect(picture(grid, tilesOf(line(0, false), one(marks('U')), one(marks('A')), grid))).toEqual(['.....', '.xx..', '...xx']);
  });

  test('a line stops before a wall', () => {
    const { grid, marks } = draw(['.......', 'U..#..A', '.......']);
    expect(picture(grid, tilesOf(line(0, true), one(marks('U')), one(marks('A')), grid))).toEqual(['.......', '.xx#...', '.......']);
  });
});

describe('who a use catches', () => {
  const bodiesOf = (marks: (c: string) => Place[], ...ids: string[]) => ids.flatMap(id => marks(id).map(p => ({ id, place: p })));

  test('an arrow that does not pierce stops at the first body on its line', () => {
    const { grid, marks } = draw(['U.B.C.A']);
    const caught = inShape(line(0, false), one(marks('U')), one(marks('A')), grid, bodiesOf(marks, 'C', 'B'));
    expect(caught.hit.map(b => b.id)).toEqual(['B']);
  });

  test('a piercing line catches every body on it', () => {
    const { grid, marks } = draw(['U.B.C.A']);
    const caught = inShape(line(0, true), one(marks('U')), one(marks('A')), grid, bodiesOf(marks, 'C', 'B'));
    expect(caught.hit.map(b => b.id)).toEqual(['B', 'C']);
  });

  test('a blast catches the bodies inside it in full and those in its ring at the ring\'s share', () => {
    const { grid, marks } = draw([
      '.........',
      '.........',
      '..C......',
      '.........',
      '....A...D',
      '.....B...',
      '.........',
      '....E....',
      '.........',
    ]);
    const caught = inShape(radius(2, 3), place(0, 0), one(marks('A')), grid, bodiesOf(marks, 'B', 'C', 'D', 'E'));
    expect(caught.hit.map(b => b.id)).toEqual(['B']);
    expect(caught.ring.map(b => b.id)).toEqual(['C', 'E']);
  });
});

describe('the default places with no map', () => {
  test('eight of the party and twelve foes stand in two lines 8 tiles apart, with two rows behind the party and three behind the foes (table 5.2)', () => {
    const grid = openGrid(20, 14);
    const taken: Place[] = [];
    const join = (side: 'party' | 'foe'): Place => { const p = defaultPlace(side, taken, grid, R)!; taken.push(p); return p; };
    const party = Array.from({ length: 8 }, () => join('party'));
    const foes = Array.from({ length: 12 }, () => join('foe'));
    expect(party).toEqual([0, 1, 2, 3, 4, 5, 6, 7].map(x => place(x, 2)));
    expect(foes).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map(x => place(x, 10)));
    expect(dist(party[0]!, foes[0]!)).toEqual(8);
  });

  test('a newcomer takes the first free tile of its side\'s line', () => {
    const grid = openGrid(20, 14);
    expect(defaultPlace('party', [place(1, 2)], grid, R)).toEqual(place(0, 2));
    expect(defaultPlace('party', [place(0, 2), place(1, 2)], grid, R)).toEqual(place(2, 2));
  });

  test('twelve on a side five tiles wide fill a second line one tile behind the first, then a third, on both sides', () => {
    const grid = openGrid(5, 14);
    const taken: Place[] = [];
    const join = (side: 'party' | 'foe'): Place => { const p = defaultPlace(side, taken, grid, R)!; taken.push(p); return p; };
    const foes = Array.from({ length: 12 }, () => join('foe'));
    const party = Array.from({ length: 12 }, () => join('party'));
    const at = (x: number, y: number): string => foes.some(p => same(p, place(x, y))) ? 'F' : party.some(p => same(p, place(x, y))) ? 'P' : '.';
    expect(Array.from({ length: 14 }, (_, y) => Array.from({ length: 5 }, (_, x) => at(x, y)).join(''))).toEqual([
      'PP...',
      'PPPPP',
      'PPPPP',
      '.....',
      '.....',
      '.....',
      '.....',
      '.....',
      '.....',
      '.....',
      'FFFFF',
      'FFFFF',
      'FF...',
      '.....',
    ]);
  });

  test('a side whose rows from its front line back to the edge are full has no place left, though rows in front are free', () => {
    const grid = openGrid(2, 13);
    const party = [0, 1, 2].flatMap(y => [place(0, y), place(1, y)]);
    const foes = [10, 11, 12].flatMap(y => [place(0, y), place(1, y)]);
    expect(defaultPlace('party', party, grid, R)).toBeNull();
    expect(defaultPlace('foe', foes, grid, R)).toBeNull();
    expect(defaultPlace('foe', foes.slice(1), grid, R)).toEqual(place(0, 10));
  });
});

describe('walking', () => {
  test('a walk goes around walls, and every second diagonal step costs 2', () => {
    const { grid, marks } = draw([
      '.....',
      '.###.',
      '..U..',
    ]);
    const reach = reachable(one(marks('U')), 4, grid, []);
    const at = (x: number, y: number): string => String(reach.find(r => same(r.place, place(x, y)))?.steps ?? (grid.tiles?.[y * 5 + x] === 'wall' ? '#' : '.'));
    expect([0, 1, 2].map(y => [0, 1, 2, 3, 4].map(x => at(x, y)).join(''))).toEqual([
      '34.43',
      '2###2',
      '21012',
    ]);
    expect(pathCost(one(marks('U')), place(2, 0), grid, [])).toEqual(5);
  });

  test('a body in the way makes the walk go the long way round', () => {
    const { grid, marks } = draw([
      '.....',
      '.###.',
      '..UBG',
    ]);
    expect(pathCost(one(marks('U')), one(marks('G')), grid, [])).toEqual(2);
    expect(pathCost(one(marks('U')), one(marks('G')), grid, marks('B'))).toEqual(8);
  });

  test('a walk cannot slip diagonally between two walls, but may pass the corner of one', () => {
    const shut = draw(['U#', '#G']);
    expect(pathCost(one(shut.marks('U')), one(shut.marks('G')), shut.grid, [])).toBeNull();
    const open = draw(['U#', '.G']);
    expect(pathCost(one(open.marks('U')), one(open.marks('G')), open.grid, [])).toEqual(1);
  });

  test('the way a walk goes is a chain of neighbouring tiles around walls and bodies, as long in 5-10-5 steps as its cost', () => {
    const { grid, marks } = draw([
      '.....',
      '.###.',
      '..UBG',
    ]);
    const from = one(marks('U')), to = one(marks('G')), way = walkPath(from, to, grid, marks('B'))!;
    expect(way.at(-1)).toEqual(to);
    let at = from, diagonals = 0;
    for (const p of way) {
      expect([Math.abs(p.x - at.x) <= 1 && Math.abs(p.y - at.y) <= 1, grid.tiles![p.y * 5 + p.x], same(p, one(marks('B')))]).toEqual([true, 'floor', false]);
      if (p.x !== at.x && p.y !== at.y) diagonals++;
      at = p;
    }
    // every second diagonal step costs 2 (the 5-10-5 count), so the walk's steps are its tiles and half its diagonals
    expect(way.length + Math.floor(diagonals / 2)).toEqual(pathCost(from, to, grid, marks('B'))!);
    expect(walkPath(from, from, grid, [])).toEqual([]);
    expect(walkPath(one(draw(['U#', '#G']).marks('U')), place(1, 1), draw(['U#', '#G']).grid, [])).toBeNull();
  });

  test('a dash runs the centre line a line ability uses, and a body or wall on it stops the dash', () => {
    const { grid, marks } = draw([
      'U....',
      '.....',
      '..B.#',
    ]);
    expect(straightPath(one(marks('U')), place(4, 1), grid, [])).toEqual([place(1, 0), place(2, 1), place(3, 1), place(4, 1)]); // a half rounds up
    expect(straightCost(one(marks('U')), place(4, 1), grid, [])).toEqual(dist(one(marks('U')), place(4, 1)));
    expect(straightPath(one(marks('U')), place(3, 2), grid, marks('B'))).toEqual([place(1, 1), place(2, 1), place(3, 2)]);
    expect(straightPath(one(marks('U')), place(4, 2), grid, [])).toBeNull();
    expect(straightPath(one(marks('U')), place(2, 2), grid, marks('B'))).toBeNull();
  });

  test('a walk lists the tiles it reaches by fewest steps, then top to bottom, then left to right', () => {
    const { grid, marks } = draw(['...', '.U.', '...']);
    expect(reachable(one(marks('U')), 1, grid, []).map(r => [r.place.x, r.place.y, r.steps])).toEqual([
      [1, 1, 0], [0, 0, 1], [1, 0, 1], [2, 0, 1], [0, 1, 1], [2, 1, 1], [0, 2, 1], [1, 2, 1], [2, 2, 1],
    ]);
  });
});

describe('stepping away from a use (rule 8a)', () => {
  // Table 3.C's blast: radius 2 with a ring to 3, centred one tile from the target, which needs 2 tiles to reach the ring and 3 to be out.
  const { grid, marks } = draw([
    '.........',
    '.........',
    '.........',
    '.........',
    '....A....',
    '....T....',
    '.........',
    '.........',
    '.........',
  ]);
  const cover = tilesOf(radius(2, 3), place(0, 0), one(marks('A')), grid);
  const target = one(marks('T'));

  test('a target that cannot move, or moves one tile, is caught and stays', () => {
    expect(dodge(target, tiles(0), cover, grid, [])).toEqual({ avoid: 'caught', to: target });
    expect(dodge(target, tiles(1), cover, grid, [])).toEqual({ avoid: 'caught', to: target });
  });

  test('with two tiles it reaches the ring, at the highest then leftmost of the nearest ring tiles', () => {
    expect(dodge(target, tiles(2), cover, grid, [])).toEqual({ avoid: 'ring', to: place(2, 6) });
  });

  test('with three tiles it gets out', () => {
    expect(dodge(target, tiles(3), cover, grid, [])).toEqual({ avoid: 'out', to: place(1, 6) });
  });

  test('a tile another body fills is not a place to step to', () => {
    expect(dodge(target, tiles(2), cover, grid, [place(2, 6)])).toEqual({ avoid: 'ring', to: place(6, 6) });
  });

  test('a target already out of the shape stays out where it is', () => {
    expect(dodge(place(8, 8), tiles(3), cover, grid, [])).toEqual({ avoid: 'out', to: place(8, 8) });
  });

  test('dodgeOptions lists every reachable tile with steps and avoid, and auto matches automatic dodge', () => {
    const out = dodgeOptions(target, tiles(3), cover, grid, []);
    expect(out.auto.avoid).toBe('out');
    expect(out.auto.place).toEqual(dodge(target, tiles(3), cover, grid, []).to);
    expect(out.tiles.some(t => same(t.place, target) && t.steps === 0 && t.avoid === 'caught')).toBe(true);
    expect(out.tiles.some(t => t.avoid === 'ring')).toBe(true);
    expect(out.tiles.some(t => t.avoid === 'out')).toBe(true);
    expect(out.tiles.length).toBe(reachable(target, 3, grid, []).length);

    // Reach 1 cannot leave the blast, yet still lists staying put + every reachable neighbor
    const caught = dodgeOptions(target, tiles(1), cover, grid, []);
    expect(caught.auto).toEqual({ place: target, steps: tiles(0), avoid: 'caught' });
    expect(caught.tiles.length).toBeGreaterThan(1);
    expect(caught.tiles.every(t => t.avoid === 'caught')).toBe(true);

    // Reach 0 offers only staying put
    const rooted = dodgeOptions(target, tiles(0), cover, grid, []);
    expect(rooted.tiles).toEqual([{ place: target, steps: tiles(0), avoid: 'caught' }]);
    expect(rooted.auto).toEqual({ place: target, steps: tiles(0), avoid: 'caught' });
  });

  test('dodgeOptions in ring-only mode selects staying put as auto, includes other ring and blast tiles, and respects rough ground steps', () => {
    const inRing = place(2, 6);
    const blocked = [place(1, 5), place(1, 6), place(1, 7), place(2, 7)];
    const opts = dodgeOptions(inRing, tiles(1), cover, grid, blocked);
    expect(opts.auto).toEqual({ place: inRing, steps: tiles(0), avoid: 'ring' });
    expect(opts.tiles.filter(t => t.avoid === 'ring').length).toBeGreaterThanOrEqual(2);
    expect(opts.tiles.some(t => t.avoid === 'caught')).toBe(true);
    expect(dodge(inRing, tiles(1), cover, grid, blocked)).toEqual({ avoid: 'ring', to: inRing });

    // Rough ground costs 2 steps
    const rough = draw(['T~..']);
    const roughOpts = dodgeOptions(one(rough.marks('T')), tiles(2), { hit: [place(0, 0)], ring: [] }, rough.grid, []);
    expect(roughOpts.tiles).toEqual([
      { place: place(0, 0), steps: tiles(0), avoid: 'caught' },
      { place: place(1, 0), steps: tiles(2), avoid: 'out' },
    ]);
    expect(roughOpts.auto).toEqual({ place: place(1, 0), steps: tiles(2), avoid: 'out' });
  });
});

describe('properties over seeded maps', () => {
  const SEEDS = Array.from({ length: 200 }, (_, i) => i + 1);
  const anyPlace = (r: ReturnType<typeof rng>, grid: Grid): Place => place(r.int(0, grid.w - 1), r.int(0, grid.h - 1));

  test('the distance is the same both ways', () => {
    for (const seed of SEEDS) {
      const r = rng(seed), grid = openGrid(20, 14), a = anyPlace(r, grid), b = anyPlace(r, grid);
      expect(dist(a, b)).toEqual(dist(b, a));
    }
  });

  test('a tile is in a radius exactly when its distance from the centre is at most the radius', () => {
    for (const seed of SEEDS) {
      const r = rng(seed), grid = openGrid(20, 14), centre = anyPlace(r, grid), size = r.int(0, 5);
      const cover = tilesOf(radius(size), centre, centre, grid);
      for (let y = 0; y < grid.h; y++) for (let x = 0; x < grid.w; x++) {
        const p = place(x, y);
        expect(cover.hit.some(q => same(p, q))).toBe(dist(centre, p) <= size);
      }
    }
  });

  test('on open floor a walk costs the distance', () => {
    for (const seed of SEEDS) {
      const r = rng(seed), grid = openGrid(12, 9), a = anyPlace(r, grid), b = anyPlace(r, grid);
      expect(pathCost(a, b, grid, [])).toEqual(dist(a, b));
    }
  });

  test('the tile a target steps to is never worse than staying, is free and is within its steps, and a rooted target stays', () => {
    const rank = { out: 0, ring: 1, caught: 2 } as const;
    for (const seed of SEEDS) {
      const r = rng(seed);
      const tilesList: Terrain[] = Array.from({ length: 12 * 9 }, () => r.chance(0.12) ? 'wall' : 'floor');
      const grid: Grid = { w: 12, h: 9, tiles: tilesList };
      const floor = (p: Place): boolean => tilesList[p.y * grid.w + p.x] === 'floor';
      const target = anyPlace(r, grid);
      if (!floor(target)) continue;
      const bodies = Array.from({ length: r.int(0, 6) }, () => anyPlace(r, grid)).filter(p => floor(p) && !same(p, target));
      const cover = tilesOf(radius(r.int(0, 3), r.chance(0.5) ? r.int(3, 5) : null), target, anyPlace(r, grid), grid);
      const staying = cover.hit.some(q => same(q, target)) ? 'caught' : cover.ring.some(q => same(q, target)) ? 'ring' : 'out';
      const can = r.int(0, 4);
      const end = dodge(target, tiles(can), cover, grid, bodies);
      expect(rank[end.avoid]).toBeLessThanOrEqual(rank[staying]);
      expect(floor(end.to) && !bodies.some(b => same(b, end.to))).toBe(true);
      expect(pathCost(target, end.to, grid, bodies)!).toBeLessThanOrEqual(can);
      expect(dodge(target, tiles(0), cover, grid, bodies)).toEqual({ avoid: staying, to: target });
    }
  });
});

describe('terrain: walls, cover, rough ground and pits (the TERRAIN table)', () => {
  test('a blast stops at a wall: a tile the centre cannot see past the wall is safe, and it does not wrap round the corner', () => {
    const { grid, marks } = draw([
      '.......',
      '...#...',
      '...#...',
      '.A.#...',
      '...#...',
      '.......',
    ]);
    // radius 3 by the 5-10-5 count; (3, 5) is in reach past the wall's end, (4, 3) is behind it
    expect(picture(grid, tilesOf(radius(3), one(marks('A')), one(marks('A')), grid))).toEqual([
      'xxx....',
      'xxx#...',
      'xxx#...',
      'xxx#...',
      'xxx#...',
      'xxxx...',
    ]);
  });

  test('a touch needs a line to its target: through a wall it takes nobody', () => {
    const { grid, marks } = draw(['A.#.B']);
    expect(tilesOf({ kind: 'touch', reach: tiles(6) }, one(marks('A')), one(marks('B')), grid).hit).toEqual([]);
    expect(tilesOf({ kind: 'touch', reach: tiles(6) }, one(marks('A')), place(1, 0), grid).hit).toEqual([place(1, 0)]);
  });

  test('rough ground costs two steps to enter: a stride of 6 crosses 3 tiles of it, and a dash across it costs as much', () => {
    const { grid, marks } = draw(['A~~~~~~~']);
    const far = reachable(one(marks('A')), 6, grid, []).map(r => r.place.x);
    expect(Math.max(...far)).toBe(3);
    expect(pathCost(one(marks('A')), place(3, 0), grid, [])).toBe(tiles(6));
    expect(straightCost(one(marks('A')), place(3, 0), grid, [])).toBe(tiles(6));
  });

  test('a pit holds no body, so a walk goes round it, but a shot and an eye pass over it', () => {
    const { grid, marks } = draw([
      '.....',
      'A._.B',
      '.....',
    ]);
    expect(walkPath(one(marks('A')), one(marks('B')), grid, [])!.some(p => same(p, place(2, 1)))).toBe(false);
    // round it: a step, two diagonals (the second costs 2 by the 5-10-5 count) and a step
    expect(pathCost(one(marks('A')), one(marks('B')), grid, [])).toBe(tiles(5));
    expect(tilesOf(line(0, false), one(marks('A')), one(marks('B')), grid).hit).toContainEqual(one(marks('B')));
    expect(sees(one(marks('A')), one(marks('B')), grid)).toBe(true);
  });

  test('cover holds a body and stops nothing: a walk and a line go through it', () => {
    const { grid, marks } = draw(['A.o.B']);
    expect(pathCost(one(marks('A')), one(marks('B')), grid, [])).toBe(tiles(4));
    expect(tilesOf(line(0, true), one(marks('A')), one(marks('B')), grid).hit).toHaveLength(4);
  });
});

describe('what the party sees (seenBy)', () => {
  const v = (p: Place, up = true, side: 'party' | 'foe' = 'party') => ({ place: p, side, up });
  const see = (grid: Grid, viewers: ReturnType<typeof v>[], sight = 25) => seenBy('party', viewers, grid, tiles(sight));
  const lit = (grid: Grid, set: Set<number>) => Array.from({ length: grid.h }, (_, y) => Array.from({ length: grid.w }, (_, x) =>
    grid.tiles?.[y * grid.w + x] === 'wall' ? '#' : set.has(y * grid.w + x) ? '+' : ' ').join(''));

  test('a wall hides what is behind it, and the wall itself is seen', () => {
    const { grid, marks } = draw([
      '......',
      'A..#..',
      '......',
    ]);
    expect(lit(grid, see(grid, [v(one(marks('A')))]))).toEqual([
      '++++++',
      '+++#  ',
      '++++++',
    ]);
  });

  test('a corner reveals as a body steps past it: from behind the wall the room beyond is dark, from its end it is seen', () => {
    const { grid, marks } = draw([
      'A....',
      '####.',
      '...B.',
    ]);
    const behind = see(grid, [v(one(marks('A')))]), past = see(grid, [v(place(4, 0))]);
    const b = one(marks('B'));
    expect([behind.has(b.y * grid.w + b.x), past.has(b.y * grid.w + b.x)]).toEqual([false, true]);
  });

  test('sight is mutual: a body sees a tile exactly when a body there sees it back', () => {
    const { grid } = draw([
      '.#....#.',
      '...#....',
      '#....#..',
      '..#.....',
    ]);
    const all = Array.from({ length: grid.w * grid.h }, (_, i) => place(i % grid.w, Math.floor(i / grid.w)));
    for (const a of all) for (const b of all) expect(sees(a, b, grid)).toBe(sees(b, a, grid));
  });

  test('the party sees the union of what each of its bodies that is up sees; a down body and a foe add nothing', () => {
    const { grid, marks } = draw([
      'A.#.B',
    ]);
    const a = one(marks('A')), b = one(marks('B'));
    expect([...see(grid, [v(a), v(b)])].sort((x, y) => x - y)).toEqual([0, 1, 2, 3, 4]);
    expect([...see(grid, [v(a), v(b, false)])].sort((x, y) => x - y)).toEqual([0, 1, 2]);
    expect([...see(grid, [v(a), v(b, true, 'foe')])].sort((x, y) => x - y)).toEqual([0, 1, 2]);
  });

  test('sight reaches its range by the 5-10-5 distance and no further', () => {
    const grid = openGrid(10, 1);
    expect([...see(grid, [v(place(0, 0))], 4)].sort((x, y) => x - y)).toEqual([0, 1, 2, 3, 4]);
  });
});

describe('a push or a pull (shovePath, kits design 8.3, table 8.9.3)', () => {
  const at = (rows: string[]) => { const d = draw(rows); return { ...d, U: one(d.marks('U')), T: one(d.marks('T')) }; };

  test('a push goes tile by tile away from its anchor on the centre line and stops before a wall', () => {
    const m = at(['U.T..#..']);
    expect(shovePath(m.U, m.T, 'away', 3, m.grid, [])).toEqual([place(3, 0), place(4, 0)]);
  });

  test('a pull stops next to its anchor, and a body in the way stops it before that body', () => {
    const m = at(['U....T..']);
    expect(shovePath(m.U, m.T, 'toward', 9, m.grid, [])).toEqual([place(4, 0), place(3, 0), place(2, 0), place(1, 0)]);
    expect(shovePath(m.U, m.T, 'toward', 9, m.grid, [place(2, 0)])).toEqual([place(4, 0), place(3, 0)]);
  });

  test('a pit and the map\'s edge stop it: nothing falls in; rough ground costs two of its steps', () => {
    expect(shovePath(place(0, 0), place(1, 0), 'away', 3, at(['UT_...']).grid, [])).toEqual([]);
    expect(shovePath(place(0, 0), place(2, 0), 'away', 3, at(['U.T']).grid, [])).toEqual([]);
    const m = at(['UT~....']);
    expect(shovePath(m.U, m.T, 'away', 3, m.grid, [])).toEqual([place(2, 0), place(3, 0)]);
  });

  test('on a diagonal it follows the line from the anchor, and a body on its anchor\'s tile does not move', () => {
    const m = at(['U....', '.T...', '.....', '.....']);
    expect(shovePath(m.U, m.T, 'away', 2, m.grid, [])).toEqual([place(2, 2), place(3, 3)]);
    expect(shovePath(m.U, m.U, 'away', 2, m.grid, [])).toEqual([]);
  });
});
