// A GM's override of a rule number is read against that rule's domain (src/core/rules.ts, beside the rule): a value
// out of it is refused in the Rules editor and read as the rule's default when a save that holds it loads (audit
// BUG-rules-1 and AW-rules-1). Each case below is a number the editor took before, and what a table saw of it.
import { expect, test } from 'bun:test';
import { parseOverrides, refusalWords } from '../src/core/overrides.ts';
import { RULES, domainOf, inDomain, rulesOf } from '../src/core/rules.ts';
import type { Domain, Rules } from '../src/core/rules.ts';
import { freshSave, newHunter, parseSaveValue } from '../src/core/save.ts';
import type { ParseEnv } from '../src/core/save.ts';
import { addXp } from '../src/core/hunter/progress.ts';
import { hunterSheet } from '../src/core/hunter/sheet.ts';
import { parseFormula } from '../src/core/formula.ts';
import { RARITIES, priceOf } from '../src/core/registry/items.ts';
import { dev } from './fixtures/ids.ts';
import { ruleNumbers } from './fixtures/rule-numbers.ts';

const AT = '2026-11-18T10:00:00.000Z';
const ENV: ParseEnv = { now: new Date(AT), newDeviceToken: () => 'test-device-token-0123456789abcd', newDeviceId: () => dev('d-me') };
/** The rules of a save that holds `rulesOverrides` as it was written before the domains, once it loads. */
function loaded(rulesOverrides: Record<string, unknown>): Rules {
  const p = parseSaveValue(JSON.parse(JSON.stringify({ ...freshSave(ENV, { onboarded: true }), rulesOverrides })), ENV);
  if (p.kind !== 'save') throw new Error(`not a save: ${p.kind}`);
  return rulesOf(p.save.rulesOverrides, p.save.library.statuses);
}

test('a save whose GM set 0 XP a level loads with 100 XP a level, so a hunter who earns 1 XP stays at level 1', () => {
  const R = loaded({ xpPerLevel: 0 });
  expect(addXp(newHunter(R), 1, R).level).toBe(1);
  expect(R.xpPerLevel).toBe(RULES.xpPerLevel);
});

test('a save whose GM set the stat base or the curve\'s half to 0 loads with the shipped ones, so a new hunter\'s max HP is a number', () => {
  const shipped = hunterSheet(newHunter(RULES), RULES).sheet.hpMax;
  for (const fight of [{ statBase: 0 }, { half: 0 }, { growthDiv: 0 }]) {
    const R = loaded({ fight });
    expect([fight, hunterSheet(newHunter(R), R).sheet.hpMax]).toEqual([fight, shipped]);
  }
});

test('a save whose GM allowed dice of a billion sides loads with 1000, so a formula of 1d1000000000 is refused as it is typed', () => {
  const R = loaded({ dice: { maxSides: 1e9 } });
  expect(parseFormula('1d1000000000', R)).toEqual({ ok: false, error: '"1d1000000000" has dice of 1000000000 sides; a die has 2 to 1000.' });
  expect(R.dice.maxSides).toBe(RULES.dice.maxSides);
});

test('the Rules editor keeps none of a round of 0 ticks, 0 XP a level, a streak bonus every 0 days and dice of a billion sides', () => {
  const { overrides, refused } = parseOverrides({ xpPerLevel: 0, streakBonusEvery: 0, dice: { maxSides: 1e9 }, fight: { round: 0 } });
  expect(overrides).toEqual({ dice: {}, fight: {} });
  expect(refused.map(r => [r.path, r.reason])).toEqual([['xpPerLevel', 'range'], ['streakBonusEvery', 'range'], ['dice.maxSides', 'range'], ['fight.round', 'range']]);
});

/** An override of the one rule at `path`, as the GM would write it in the editor. */
const at = (path: string, value: unknown): Record<string, unknown> => path.split('.').reduceRight<Record<string, unknown>>((inner, k, i, keys) => (i === keys.length - 1 ? { [k]: value } : { [k]: inner }), {});
/** The value at `path` of the rules. */
const read = (R: Rules, path: string): unknown => path.split('.').reduce<unknown>((v, k) => (v as Record<string, unknown>)[k], R);
const NUMBERS = ruleNumbers();

test('a number just past either end of its domain, or a fraction where it is whole, is refused by its path and the rule keeps its default', () => {
  for (const n of NUMBERS) {
    const d: Domain = domainOf(n.path)!;
    const bad = [d.least - 1, d.most + 1, ...(d.whole ? [d.least + 0.5] : [])];
    for (const x of bad) {
      const value = typeof n.value === 'number' ? x : [x, ...n.value.slice(1)];
      const { overrides, refused } = parseOverrides(at(n.path, value));
      const where = typeof n.value === 'number' ? n.path : `${n.path}.0`;
      expect([n.path, x, refused.map(r => [r.path, r.reason])]).toEqual([n.path, x, [[where, 'range']]]);
      expect([n.path, read(rulesOf(overrides), n.path)]).toEqual([n.path, n.value]);
    }
    for (const x of [d.least, d.most]) {
      const value = typeof n.value === 'number' ? x : n.value.map(() => x);
      const { overrides, refused } = parseOverrides(at(n.path, value));
      expect([n.path, x, refused]).toEqual([n.path, x, []]);
      expect([n.path, read(rulesOf(overrides), n.path)]).toEqual([n.path, value]);
    }
  }
});

test('a GM\'s base value or a rarity\'s price factor is no rule: a price is its rank\'s Clear, so such an override is refused as unknown and changes no price', () => {
  const { overrides, refused } = parseOverrides({ baseValue: 50, rarities: { rare: { mult: 30 } } });
  expect(refused.map(r => [r.path, r.reason])).toEqual([['baseValue', 'unknown'], ['rarities.rare.mult', 'unknown']]);
  expect(RARITIES.map(r => priceOf(rulesOf(overrides), r))).toEqual(RARITIES.map(r => priceOf(RULES, r)));
});

test('the Rules editor\'s words for a number out of its domain name its bounds and why they are there', () => {
  const words = (ov: Record<string, unknown>) => parseOverrides(ov).refused.map(refusalWords);
  expect(words({ fight: { round: 0 } })).toEqual(['fight.round: must be a whole number from 100 to 10000. Ticks in a round: under 100 the rounding of speed shows, 0 divides by 0.']);
  expect(words({ fight: { kit: { scalerStep: 0 } } })).toEqual(['fight.kit.scalerStep: must be a number from 0.01 to 0.5. The search step of a suggested scale: 0 searches without end.']);
  expect(words({ rankTable: { E: { dc: [10, 13, 160] } } })).toEqual(['rankTable.E.dc.2: must be a whole number from 1 to 100. A d20 check\'s DC: the S rank\'s hardest is 55, and past 100 no bonus reaches it.']);
  expect(words({ solo: { pack: [3, 2] }, luck: 1, levelUpRestore: 'yes' })).toEqual(['solo.pack: must go from low to high.', 'Unknown rule: luck', 'levelUpRestore: must be true or false.']);
});

test('a save whose GM set the sight base to 6 loads with 0: the base is a sight level, one of the six E to S, so a new hunter sees at 0', () => {
  expect(domainOf('fight.stealth.sightBase')).toMatchObject({ least: 0, most: 5, whole: true });
  const R = loaded({ fight: { stealth: { sightBase: 6 } } });
  expect([R.fight.stealth.sightBase, hunterSheet(newHunter(R), R).sheet.sight]).toEqual([0, 0]);
  const raised = loaded({ fight: { stealth: { sightBase: 2 } } });
  expect(hunterSheet(newHunter(raised), raised).sheet.sight).toBe(2);
});

test('a save whose GM set the foe penetration is weighed against to a kind that is not one loads with the elite; a boss is kept', () => {
  expect(parseOverrides({ itemBudget: { penFoe: 'dragon' } })).toEqual({ overrides: { itemBudget: {} }, refused: [{ path: 'itemBudget.penFoe', reason: 'entry' }] });
  expect(loaded({ itemBudget: { penFoe: 'dragon' } }).itemBudget.penFoe).toBe('elite');
  expect(loaded({ itemBudget: { penFoe: 'boss' } }).itemBudget.penFoe).toBe('boss');
});

test('a percent penetration\'s cap is a whole percent from 0 to 100: a GM\'s 150 is refused and the cap stays at 60', () => {
  expect(loaded({ fight: { penMax: 150 } }).fight.penMax).toBe(60);
  expect(loaded({ fight: { penMax: 45 } }).fight.penMax).toBe(45);
});
