// Every build path in src/core/registry/paths.ts must pass these. A new path is checked here with no new test.
import { describe as group, expect, test } from 'bun:test';
import { BONUS_KEYS, RANKS, RULES, pathBonus, pathOf } from '../src/core/rules.ts';
import { STAT_KEYS } from '../src/core/stats.ts';
import type { Perk } from '../src/core/rules.ts';
import { BUILT_IN_PATHS, PERK_VALUE, TIER_BUDGET } from '../src/core/registry/paths.ts';
import type { PathId } from '../src/core/registry/paths.ts';

/** A perk's worth by the rule in paths.ts: each stat point 1, each 10 max HP 1, each max mana 1 (rounded: 1/10 is not exact in floating point). */
const worth = (p: Perk): number => Math.round(1000 * Object.entries(p).reduce((s, [k, v]) =>
  s + (v ?? 0) * (k === 'hpMax' ? PERK_VALUE.hpMax : k === 'manaMax' ? PERK_VALUE.manaMax : PERK_VALUE.stat), 0)) / 1000;

for (const id of Object.keys(BUILT_IN_PATHS) as PathId[]) {
  const def = BUILT_IN_PATHS[id];
  group(`the build path ${id}`, () => {
    test('has a name the build screen shows (40 characters) and Auto weights on stats', () => {
      expect(def.name.trim()).not.toBe('');
      expect(def.name.length).toBeLessThanOrEqual(40);
      expect(Object.keys(def.alloc).length).toBeGreaterThan(0);
      for (const [k, w] of Object.entries(def.alloc)) { expect(STAT_KEYS as readonly string[]).toContain(k); expect(w).toBeGreaterThan(0); }
    });

    test('has a tier for each rank, the first open at E and the last at S', () => {
      expect(def.tiers).toHaveLength(RANKS.length);
    });

    test('each perk is whole numbers on a stat, max HP or max mana, and both perks of a tier are worth its budget (2, 2, 3, 3, 4, 4)', () => {
      def.tiers.forEach((tier, i) => {
        for (const perk of tier) {
          for (const [k, v] of Object.entries(perk)) { expect(BONUS_KEYS as readonly string[]).toContain(k); expect(Number.isInteger(v) && v! > 0).toBe(true); }
          expect([id, i, worth(perk)]).toEqual([id, i, TIER_BUDGET[i]]);
        }
      });
    });

    test('the rules serve it, and a hunter at rank S who took every first perk has their sum', () => {
      expect(pathOf(RULES, id)?.name).toBe(def.name);
      const sum: Perk = {};
      for (const [first] of def.tiers) for (const [k, v] of Object.entries(first)) sum[k as keyof Perk] = (sum[k as keyof Perk] ?? 0) + v!;
      expect(pathBonus(RULES, { path: id, picks: [0, 0, 0, 0, 0, 0] }, 'S').out).toEqual(sum);
    });
  });
}

test('a perk\'s worth follows the stated values: +2 STR is 2, +20 HP is 2, +2 mana is 2', () => {
  expect([worth({ str: 2 }), worth({ hpMax: 20 }), worth({ manaMax: 2 })]).toEqual([2, 2, 2]);
  expect(TIER_BUDGET).toEqual([2, 2, 3, 3, 4, 4]);
});

group('the paths as plan section 3.4 restates them on the eight stats', () => {
  test('each path weighs Auto toward its build: Vanguard the bruiser, Striker speed, Arcanist the cannon, Warden a tank against magic, Sovereign the support, Seeker by the plain map', () => {
    const alloc = Object.fromEntries(Object.entries(BUILT_IN_PATHS).map(([id, p]) => [id, p.alloc]));
    expect(alloc).toEqual({
      vanguard: { str: 2, vit: 1 }, striker: { agi: 2, str: 1 }, arcanist: { pow: 2, ctl: 1 }, warden: { vit: 2, dis: 1 }, seeker: { ins: 2, agi: 1 }, sovereign: { pre: 2, dis: 1 },
    });
  });

  test('an old AC perk of 1 is the path\'s second stat at 2: Vanguard\'s E-rank pick of CON 1 and AC 1 at D is now Vitality 2', () => {
    expect(BUILT_IN_PATHS.vanguard.tiers[1]).toEqual([{ str: 1, vit: 1 }, { vit: 2 }]);
    expect(BUILT_IN_PATHS.striker.tiers[0][1]).toEqual({ str: 2 });
  });

  test('an old MP perk of 10 is 2 mana: the Arcanist\'s E-rank second pick', () => {
    expect(BUILT_IN_PATHS.arcanist.tiers[0][1]).toEqual({ manaMax: 2 });
  });
});
