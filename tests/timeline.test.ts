import { describe, expect, test } from 'bun:test';
import { acted, ahead, before, delayed, extraNow, hastened, interval, next, opening, paceCost, refunded, roundOf, stunned, tick, walkCost, withSpeed } from '../src/core/combat/timeline.ts';
import type { Clock, TimelineRules } from '../src/core/combat/timeline.ts';
import { tiles } from '../src/core/combat/space.ts';
import { rng } from './models/fight-play.ts';

// The numbers of design.md section 1.2 and 4.6, as the paper script's PAPER table has them.
const R: TimelineRules = { round: 1000, cost: { quick: 70, standard: 100, heavy: 150 }, moveCost: 100 / 6 };
const STANDARD = paceCost('standard', R);
const HEAVY = paceCost('heavy', R);

const row = (id: string, speed: number, at: number, tie = 0): Clock => ({ id, speed, at: tick(at), tie });
const turns = (list: readonly Clock[]): [number, string][] => list.map(r => [r.at, r.id]);

// Table 1.3: the sample fight's five combatants with their opening d20s (seed 7 in the paper script).
const SAMPLE = [
  { id: 'Kai', speed: 141, d20: 1 }, { id: 'Bram', speed: 86, d20: 20 }, { id: 'Mira', speed: 98, d20: 11 },
  { id: 'Ogre', speed: 105, d20: 10 }, { id: 'Wolf', speed: 120, d20: 12 },
];
const sampleRows = (): Clock[] => SAMPLE.map((c, i) => ({ id: c.id, speed: c.speed, at: opening(tick(0), c.speed, c.d20, R), tie: i }));

describe('how long an action takes', () => {
  test('a standard action takes 1000 ticks at speed 100 and less the faster the combatant (table 1.3)', () => {
    expect([100, 141, 86, 98, 105, 120].map(s => interval(s, STANDARD, R))).toEqual([1000, 709, 1163, 1020, 952, 833]);
  });

  test('a heavy action takes half a standard action more', () => {
    expect(interval(100, HEAVY, R)).toEqual(1500);
    expect(interval(86, HEAVY, R)).toEqual(1744);
  });

  test('a quick action takes 70 hundredths of a standard one', () => {
    expect(interval(100, paceCost('quick', R), R)).toEqual(700);
  });

  test('walking costs a sixth of a standard action a tile, so a stride costs what table 4.7 says', () => {
    expect([6, 2, 3, 4, 5].map(n => walkCost(tiles(n), R))).toEqual([100, 33, 50, 67, 83]);
  });
});

describe('the opening roll', () => {
  test('each combatant of the sample fight starts at the time table 1.3 gives', () => {
    expect(sampleRows().map(r => [r.id, r.at])).toEqual([['Kai', 673], ['Bram', 0], ['Mira', 459], ['Ogre', 476], ['Wolf', 333]]);
  });

  test('a 20 acts at once, and an Instinct bonus past 20 changes nothing', () => {
    expect(opening(tick(0), 100, 20, R)).toEqual(0);
    expect(opening(tick(0), 100, 26, R)).toEqual(0);
  });

  test('a 1 waits nineteen twentieths of a standard interval', () => {
    expect(opening(tick(0), 100, 1, R)).toEqual(950);
  });

  test('a combatant who joins mid-fight opens from the current time', () => {
    expect(opening(tick(2500), 100, 11, R)).toEqual(2950);
  });
});

describe('who acts next', () => {
  test('the lowest time acts first', () => {
    expect(next([row('a', 100, 500), row('b', 100, 400), row('c', 200, 450)])?.id).toBe('b');
  });

  test('at the same time the faster combatant acts first', () => {
    expect(next([row('a', 100, 400), row('b', 120, 400)])?.id).toBe('b');
  });

  test('at the same time and speed the higher tie roll acts first', () => {
    expect(next([row('a', 100, 400, 300), row('b', 100, 400, 700)])?.id).toBe('b');
  });

  test('when everything else is equal the lower id acts first', () => {
    expect(next([row('b', 100, 400, 5), row('a', 100, 400, 5)])?.id).toBe('a');
    expect(before(row('a', 100, 400, 5), row('b', 100, 400, 5))).toBe(true);
    expect(before(row('b', 100, 400, 5), row('a', 100, 400, 5))).toBe(false);
  });

  test('a fight with nobody in it has no next turn', () => {
    expect(next([])).toBeUndefined();
  });

  test('after an action the next turn is one interval after the time it was taken', () => {
    expect(acted(row('a', 120, 333), tick(333), STANDARD, R).at).toEqual(1166);
    expect(acted(row('a', 86, 0), tick(0), HEAVY, R).at).toEqual(1744);
  });

  test('the round in the log starts at 1 and turns over every 1000 ticks', () => {
    expect([0, 999, 1000, 2459].map(t => roundOf(tick(t), R))).toEqual([1, 1, 2, 3]);
  });
});

describe('the order ahead', () => {
  test('alone over 10 rounds, speeds 80, 100, 130 and 200 take 8, 10, 14 and 20 turns (table 1.1)', () => {
    const order = ahead([row('s80', 80, 0), row('s100', 100, 0), row('s130', 130, 0), row('s200', 200, 0)], 60, R).filter(t => t.at < 10_000);
    expect(['s80', 's100', 's130', 's200'].map(id => order.filter(t => t.id === id).length)).toEqual([8, 10, 14, 20]);
  });

  test('over 100 rounds speed 130 takes 1.31 turns a round (table 1.1)', () => {
    expect(ahead([row('x', 130, 0)], 200, R).filter(t => t.at < 100_000)).toHaveLength(131);
  });

  test('a speed-130 combatant acts at its exact times, not on a step (table 1.2)', () => {
    expect(ahead([row('x', 130, 0)], 4, R).map(t => t.at)).toEqual([0, 769, 1538, 2307]);
  });

  test('the sample fight\'s first 14 turns come in the order of table 1.4', () => {
    expect(turns(ahead(sampleRows(), 14, R))).toEqual([
      [0, 'Bram'], [333, 'Wolf'], [459, 'Mira'], [476, 'Ogre'], [673, 'Kai'], [1163, 'Bram'], [1166, 'Wolf'],
      [1382, 'Kai'], [1428, 'Ogre'], [1479, 'Mira'], [1999, 'Wolf'], [2091, 'Kai'], [2326, 'Bram'], [2380, 'Ogre'],
    ]);
  });

  test('the order ahead asks for as many turns as it can give and no more', () => {
    expect(ahead([], 8, R)).toEqual([]);
    expect(ahead([row('a', 100, 0)], 3, R)).toHaveLength(3);
  });
});

describe('what moves a turn', () => {
  test('a heavy action, a slow and a stun give the order of table 1.5 with nothing else in the loop', () => {
    let rows = sampleRows();
    const first = new Set<string>();
    const seen: [number, string][] = [];
    const change = (id: string, f: (r: Clock) => Clock): void => { rows = rows.map(r => r.id === id ? f(r) : r); };
    for (let k = 0; k < 14; k++) {
      const actor = next(rows)!;
      const now = actor.at;
      seen.push([now, actor.id]);
      const isFirst = !first.has(actor.id);
      first.add(actor.id);
      if (isFirst && actor.id === 'Kai') change('Wolf', r => withSpeed(r, now, 84));
      if (isFirst && actor.id === 'Mira') change('Ogre', r => stunned(r, tick(2000)));
      change(actor.id, r => acted(r, now, isFirst && actor.id === 'Bram' ? HEAVY : STANDARD, R));
    }
    expect(seen).toEqual([
      [0, 'Bram'], [333, 'Wolf'], [459, 'Mira'], [673, 'Kai'], [1377, 'Wolf'], [1382, 'Kai'], [1479, 'Mira'],
      [1744, 'Bram'], [2091, 'Kai'], [2476, 'Ogre'], [2499, 'Mira'], [2567, 'Wolf'], [2800, 'Kai'], [2907, 'Bram'],
    ]);
  });

  test('a slow stretches the wait left by old speed over new', () => {
    expect(withSpeed(row('w', 120, 1166), tick(673), 84)).toEqual(row('w', 84, 1377));
  });

  test('a haste shrinks the wait left by old speed over new', () => {
    expect(withSpeed(row('w', 120, 1166), tick(673), 150)).toEqual(row('w', 150, 1067));
  });

  // Questionable decision 1 (Nov 22): a hold adds its length to the target's next turn, wherever that turn was.
  const HOLDS: readonly (readonly [string, Clock, number, number])[] = [
    ['due before a 2000-tick hold landing at 500 would end', row('o', 105, 1200), 2000, 3200],
    ['due after a 300-tick hold landing at 500 would end', row('o', 105, 1200), 300, 1500],
    ['its own turn, now (500)', row('o', 105, 500), 1000, 1500],
    ['already pushed to 3200 by a hold, then held 1000 more', row('o', 105, 3200), 1000, 4200],
  ];
  for (const [when, before, d, after] of HOLDS) {
    test(`a stun of ${d} ticks on a turn ${when} puts that turn at ${after}`, () => {
      expect(stunned(before, tick(d)).at).toEqual(after);
      expect(after - before.at).toBe(d);
    });
  }

  test('a delay pushes the next turn back by its ticks', () => {
    expect(delayed(row('a', 100, 1500), tick(300)).at).toEqual(1800);
  });

  test('a half refund brings the next turn back by half the action', () => {
    const after = acted(row('a', 100, 3000), tick(3000), STANDARD, R);
    expect(refunded(after, tick(3000), tick(1000), 50).at).toEqual(3500);
  });

  test('a full refund acts again next, one tick later, unless someone else is already due now', () => {
    const again = refunded(acted(row('a', 100, 3000), tick(3000), STANDARD, R), tick(3000), tick(1000), 100);
    expect(again.at).toEqual(3001);
    expect(next([again, row('b', 100, 3500)])?.id).toBe('a');
    expect(next([again, row('b', 100, 3000)])?.id).toBe('b');
  });
});

describe('properties over seeded fights', () => {
  const SEEDS = Array.from({ length: 200 }, (_, i) => i + 1);

  // The tie rule of design 1.2, written out on its own: lowest at, then highest speed, then highest tie, then lowest id.
  const firstByRule = (rows: readonly Clock[]): Clock => {
    const minAt = Math.min(...rows.map(r => r.at));
    const atMin = rows.filter(r => r.at === minAt);
    const maxSpeed = Math.max(...atMin.map(r => r.speed));
    const fastest = atMin.filter(r => r.speed === maxSpeed);
    const maxTie = Math.max(...fastest.map(r => r.tie));
    return fastest.filter(r => r.tie === maxTie).sort((a, b) => (a.id < b.id ? -1 : 1))[0]!;
  };
  const crowd = (seed: number): Clock[] => {
    const r = rng(seed);
    return Array.from({ length: r.int(1, 7) }, (_, i) => row(`c${r.int(0, 99)}-${i}`, r.pick([80, 100, 100, 130]), r.int(0, 3) * 250, r.int(1, 3)));
  };

  test('the next turn always goes to the lowest time under the tie rule', () => {
    for (const seed of SEEDS) {
      const rows = crowd(seed);
      expect(next(rows)).toBe(firstByRule(rows));
    }
  });

  test('the order ahead is what taking the next turn with a standard action, again and again, gives', () => {
    for (const seed of SEEDS) {
      let rows = crowd(seed);
      const played: Clock[] = [];
      for (let k = 0; k < 12; k++) {
        const actor = next(rows)!;
        played.push(actor);
        rows = rows.map(r => r === actor ? acted(r, actor.at, STANDARD, R) : r);
      }
      expect(ahead(crowd(seed), 12, R)).toEqual(played);
    }
  });

  test('a slow never brings a turn nearer and a haste never pushes it later', () => {
    for (const seed of SEEDS) {
      const r = rng(seed);
      const now = tick(r.int(0, 5000));
      const start = row('a', r.int(40, 250), now + r.int(0, 3000));
      const slower = r.int(40, start.speed), faster = r.int(start.speed, 250);
      expect(withSpeed(start, now, slower).at).toBeGreaterThanOrEqual(start.at);
      expect(withSpeed(start, now, faster).at).toBeLessThanOrEqual(start.at);
    }
  });

  test('two combatants of equal speed take turns one after the other', () => {
    for (const seed of SEEDS) {
      const r = rng(seed);
      const speed = r.int(40, 250), now = tick(r.int(0, 5000));
      const a: Clock = { id: 'a', speed, at: opening(now, speed, r.int(1, 20), R), tie: r.int(1, 1000) };
      const b: Clock = { id: 'b', speed, at: opening(now, speed, r.int(1, 20), R), tie: r.int(1, 1000) };
      const ids = ahead([a, b], 10, R).map(t => t.id);
      for (let k = 1; k < ids.length; k++) expect(ids[k]).not.toBe(ids[k - 1]!);
    }
  });
});

describe('turn economy (kits design 8.6, table 8.9.6)', () => {
  test('a hasten brings a turn earlier by its ticks, never before the next tick, and never later', () => {
    expect(hastened(row('a', 100, 1800), tick(1000), 500).at).toBe(tick(1300));
    expect(hastened(row('a', 100, 1300), tick(1000), 500).at).toBe(tick(1001));
    expect(hastened(row('a', 100, 1000), tick(1000), 500).at).toBe(tick(1000));
  });

  test('an extra action is a turn at the next tick', () => {
    expect(extraNow(row('a', 100, 2000), tick(1000)).at).toBe(tick(1001));
  });

  test('over seeded hastes no turn is set before now + 1 or after where it was', () => {
    const r = rng(25);
    for (let i = 0; i < 2000; i++) {
      const now = r.int(0, 5000), at = now + r.int(0, 3000), by = r.int(0, 4000), b = hastened(row('a', 100, at), tick(now), by);
      expect(b.at >= Math.min(at, now + 1) && b.at <= at).toBe(true);
    }
  });
});
