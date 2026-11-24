// The spawn roll of a new gate (src/core/gates/spawn.ts): pack sizes, who is picked, and the rules' spawn weights.
import { describe, expect, test } from 'bun:test';
import { RANKS, RULES } from '../src/core/rules.ts';
import type { Rank } from '../src/core/rules.ts';
import { DEFAULT_PACK, MAX_KINDS, lootShareOf, packRange, pickWeighted, placeholderName, rollGate, rollLoot } from '../src/core/gates/spawn.ts';
import type { Random, SpawnMonster } from '../src/core/gates/spawn.ts';
import { seedMonsters } from '../src/core/registry/monsters.ts';

const BESTIARY: SpawnMonster[] = seedMonsters(RULES);
/** The same sequence of numbers in [0, 1) on every run (a linear congruential generator), so a failure can be replayed. */
const seeded = (seed: number): Random => () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
const always = (x: number): Random => () => x;
const size = (pack: { count: number }[]) => pack.reduce((s, p) => s + p.count, 0);

test('an E gate spawns 1 to 3 regular monsters (gateSpawn.regulars.E) and every other rank 2 to 6 (the default)', () => {
  expect(packRange(RULES, 'E')).toEqual([1, 3]);
  for (const rank of RANKS.filter(r => r !== 'E')) expect(packRange(RULES, rank)).toEqual([2, 6]);
  expect(DEFAULT_PACK).toEqual([2, 6]);
  for (const rank of RANKS) {
    const [lo, hi] = packRange(RULES, rank);
    // The lowest number a roll can give makes the smallest pack, one just below 1 the largest.
    expect(size(rollGate(RULES, { rank, type: 'normal' }, BESTIARY, always(0)).pack)).toBe(lo);
    expect(size(rollGate(RULES, { rank, type: 'normal' }, BESTIARY, always(0.999999)).pack)).toBe(hi);
  }
});

test('over many rolls every pack stays in its rank\'s range, has at most 3 kinds, and fights only regulars of its rank', () => {
  const rand = seeded(7);
  for (let i = 0; i < 2000; i++) {
    const g = rollGate(RULES, {}, BESTIARY, rand);
    const [lo, hi] = packRange(RULES, g.rank);
    expect(size(g.pack)).toBeGreaterThanOrEqual(lo);
    expect(size(g.pack)).toBeLessThanOrEqual(hi);
    expect(g.pack.length).toBeLessThanOrEqual(MAX_KINDS);
    // Every rank E through S has at least one regular (non-boss) seed, so packs always draw real monsters.
    const regulars = BESTIARY.filter(m => m.rank === g.rank && !m.boss);
    expect(regulars.length).toBeGreaterThan(0);
    for (const p of g.pack) {
      expect(regulars.map(m => m.id)).toContain(p.monsterId);
    }
    if (g.bossId) expect(BESTIARY.find(m => m.id === g.bossId)).toMatchObject({ rank: g.rank, boss: true });
    expect(RULES.gateNames).toContain(g.name);
    expect(g.breakDays).toBe(RULES.rankTable[g.rank].breakDays);
  }
});

test('the GM\'s own monsters of the rank are picked over the seeds, but a placeholder an earlier spawn made does not push the seeds out', () => {
  const mine: SpawnMonster = { id: 'm1', rank: 'C', boss: false, custom: true, type: 'Beast', name: 'Mire Hound' };
  const placeholder: SpawnMonster = { id: 'm2', rank: 'B', boss: false, custom: true, placeholder: true, type: 'Gate', name: placeholderName('B', false) };
  const rand = seeded(3), picked = new Set<string | null>();
  for (let i = 0; i < 50; i++) {
    expect(rollGate(RULES, { rank: 'C' }, [...BESTIARY, mine], rand).pack.map(p => p.monsterId)).toEqual(['m1']);
    for (const p of rollGate(RULES, { rank: 'B' }, [...BESTIARY, placeholder], rand).pack) picked.add(p.monsterId);
  }
  expect([...picked].filter(id => id !== 'm2').length).toBeGreaterThan(0);
});

test('a monster is a placeholder by how it was made, not by its name: the GM\'s own named like one is the GM\'s own (audit U14 sweep)', () => {
  const named: SpawnMonster = { id: 'm3', rank: 'B', boss: false, custom: true, type: 'Gate', name: placeholderName('B', false) };
  const rand = seeded(5);
  for (let i = 0; i < 20; i++) expect(rollGate(RULES, { rank: 'B' }, [...BESTIARY, named], rand).pack.map(p => p.monsterId)).toEqual(['m3']);
});

test('a rank with no monsters in the bestiary asks the caller to make each kind and the boss', () => {
  const g = rollGate(RULES, { rank: 'S', type: 'red', name: 'The Pit' }, [], always(0.999999));
  // 0.999999 asks for the largest pack (6) in the most kinds (3). Each kind gets one, and each of the other 3 goes to
  // the last kind. Each kind is its own monster to make.
  expect(g).toMatchObject({ rank: 'S', type: 'red', name: 'The Pit', bossId: null });
  expect(g.pack).toEqual([{ monsterId: null, count: 1 }, { monsterId: null, count: 1 }, { monsterId: null, count: 4 }]);
});

test('a weighted pick lands on each key in proportion to its weight and never on a weight of 0', () => {
  // { a: 1, b: 3, c: 0 }: a total of 4, so a roll below 1/4 is a and the rest is b.
  expect(pickWeighted({ a: 1, b: 3, c: 0 }, always(0.24))).toBe('a');
  expect(pickWeighted({ a: 1, b: 3, c: 0 }, always(0.26))).toBe('b');
  expect(pickWeighted({ a: 1, b: 3, c: 0 }, always(0.999999))).toBe('b');
  expect(pickWeighted({ a: 0 }, always(0.5))).toBeNull();
});

test('the spawn weights name every rank and every type a GM can pick, each as a share of 100', () => {
  // Written as percentages (E 40 = a 40% chance). A rank or type added without taking its share from the others would
  // change every chance silently, so the sum is pinned.
  const sum = (w: Record<string, number>) => Object.values(w).reduce((s, x) => s + x, 0);
  expect(Object.keys(RULES.gateSpawn.rank).sort()).toEqual([...RANKS].sort());
  expect(sum(RULES.gateSpawn.rank)).toBe(100);
  expect(Object.keys(RULES.gateSpawn.type).sort()).toEqual(['double', 'normal', 'red']);
  expect(sum(RULES.gateSpawn.type)).toBe(100);
  for (const [rank, [lo, hi]] of Object.entries(RULES.gateSpawn.regulars)) {
    expect(RANKS).toContain(rank as Rank);
    expect(lo).toBeGreaterThanOrEqual(1);
    expect(hi).toBeGreaterThanOrEqual(lo!);
  }
});

test('a name the GM types is kept, cut to 60 characters', () => {
  expect(rollGate(RULES, { name: 'x'.repeat(80) }, BESTIARY, always(0)).name).toBe('x'.repeat(60));
});

test('a world gate\'s loot roll (share 1): gold in the rank\'s span, one pick by rarity weight (two for a boss), an item of that rarity; a rarity the pool lacks gives none', () => {
  const pool = [{ rar: 'common', name: 'Rag' }, { rar: 'rare', name: 'Gem' }] as const;
  const [lo, hi] = RULES.loot.E.gold!;
  const fixed = (...v: number[]): Random => { let i = 0; return () => v[i++ % v.length]!; };
  const world = (boss: boolean) => ({ boss, share: 1 });
  // 0 draws the lowest gold and the first weight (common), the first of the pool's commons
  expect(rollLoot(RULES, 'E', world(false), pool, fixed(0))).toEqual([{ kind: 'gold', gold: lo }, { kind: 'item', item: pool[0] }]);
  expect(rollLoot(RULES, 'E', world(true), pool, fixed(0)).filter(d => d.kind === 'item')).toHaveLength(2);
  // just under 1 draws the highest gold and the last weight (rare, E's 5%), the pool's one rare
  expect(rollLoot(RULES, 'E', world(false), pool, fixed(0.9999))).toEqual([{ kind: 'gold', gold: hi }, { kind: 'item', item: pool[1] }]);
  // uncommon (E's weights: common 70, uncommon 25): the pool has none, so no item
  expect(rollLoot(RULES, 'E', world(false), pool, fixed(0, 0.8))).toEqual([{ kind: 'gold', gold: lo }]);
});

describe('a personal gate\'s loot roll pays the share solo.lootShare names (economy design 4.2)', () => {
  const pool = [{ rar: 'common', name: 'Rag' }, { rar: 'rare', name: 'Gem' }] as const;
  const share = RULES.solo.lootShare;
  const [lo = 0, hi = 0] = RULES.loot.E.gold!;
  const fixed = (...v: number[]): Random => { let i = 0; return () => v[i++ % v.length]!; };
  const personal = (boss: boolean) => ({ boss, share });

  test('its gold is the share of the gold rolled, rounded down', () => {
    // E's gold [100, 350] at a quarter: 100 pays 25, 350 pays 87
    expect(rollLoot(RULES, 'E', personal(false), pool, fixed(0))[0]).toEqual({ kind: 'gold', gold: Math.floor(lo * share) });
    expect(rollLoot(RULES, 'E', personal(false), pool, fixed(0.9999))[0]).toEqual({ kind: 'gold', gold: Math.floor(hi * share) });
    expect(rollLoot({ ...RULES, loot: { ...RULES.loot, E: { ...RULES.loot.E, gold: [100, 100] } } }, 'E', { boss: false, share: 0.5 }, pool, fixed(0))[0]).toEqual({ kind: 'gold', gold: 50 });
  });

  test('its pick happens when a draw falls under the share, before the rarity is drawn', () => {
    // gold, then the chance, then the rarity and the item: a chance draw of 0 is under the share, so the pick is made
    expect(rollLoot(RULES, 'E', personal(false), pool, fixed(0))).toEqual([{ kind: 'gold', gold: Math.floor(lo * share) }, { kind: 'item', item: pool[0] }]);
    // a chance draw of the share itself is not under it: no pick
    expect(rollLoot(RULES, 'E', personal(false), pool, fixed(0, share))).toEqual([{ kind: 'gold', gold: Math.floor(lo * share) }]);
    // just under 1: no pick
    expect(rollLoot(RULES, 'E', personal(false), pool, fixed(0.9999))).toEqual([{ kind: 'gold', gold: Math.floor(hi * share) }]);
    // a share of 0 never picks
    expect(rollLoot(RULES, 'E', { boss: true, share: 0 }, pool, fixed(0)).filter(d => d.kind === 'item')).toHaveLength(0);
  });

  test('a boss\'s two picks each draw their own chance', () => {
    expect(rollLoot(RULES, 'E', personal(true), pool, fixed(0)).filter(d => d.kind === 'item')).toHaveLength(2);
    // gold 0; first chance 0 (picked), rarity 0, item 0; second chance just at the share (not picked)
    expect(rollLoot(RULES, 'E', personal(true), pool, fixed(0, 0, 0, 0, share)).filter(d => d.kind === 'item')).toEqual([{ kind: 'item', item: pool[0] }]);
  });

  test('over many seeded rolls the pick is made about the share of the time', () => {
    const rand = seeded(7), runs = 4000;
    let picks = 0;
    for (let i = 0; i < runs; i++) picks += rollLoot(RULES, 'E', personal(false), [{ rar: 'common' }, { rar: 'uncommon' }, { rar: 'rare' }], rand).filter(d => d.kind === 'item').length;
    expect(Math.abs(picks / runs - share)).toBeLessThan(0.03);
  });
});

test('a cleared gate\'s share of its loot roll: a personal gate the rule solo.lootShare, a world gate all of it, also when run alone', () => {
  expect(lootShareOf(RULES, 'personal')).toBe(RULES.solo.lootShare);
  expect(lootShareOf(RULES, 'world')).toBe(1);
  const edited = { ...RULES, solo: { ...RULES.solo, lootShare: 0.5 } };
  expect(lootShareOf(edited, 'personal')).toBe(0.5);
  expect(lootShareOf(edited, 'world')).toBe(1);
});
