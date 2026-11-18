import { expect, test } from 'bun:test';
import { above, baseStats, capped, eff, STAT_KEYS, STAT_LABELS } from '../src/core/stats.ts';
import { RULES } from '../src/core/rules.ts';

// Expected values are typed in from table 2.2 of `bun scripts/rw-paper.ts` and the words of design section 2.1.
const R = RULES.fight;
const TABLE_2_2: readonly [number, number, number, number][] = [
  [10, 10, 0, 0], [14, 13.09, 3.09, 7], [20, 17.41, 7.41, 16], [33, 25.99, 15.99, 29],
  [63, 43.6, 33.6, 46], [83, 54.36, 44.36, 53], [174, 98.27, 88.27, 69], [250, 131.33, 121.33, 75],
];

test('there are eight stats, each with its name', () => {
  expect([...STAT_KEYS]).toEqual(['str', 'agi', 'vit', 'ins', 'dis', 'pre', 'pow', 'ctl']);
  expect(STAT_KEYS.map(k => STAT_LABELS[k])).toEqual(['Strength', 'Agility', 'Vitality', 'Instinct', 'Discipline', 'Presence', 'Power', 'Control']);
});

test('every stat starts at 10', () => {
  expect(Object.values(baseStats(R))).toEqual(STAT_KEYS.map(() => 10));
});

test('the effective score, the points above the base and the share of a cap of each score in table 2.2', () => {
  for (const [score, e, x, pct] of TABLE_2_2) {
    expect([score, Math.round(eff(score, R) * 100) / 100, Math.round(above(score, R) * 100) / 100, Math.round(capped(above(score, R), 1, R) * 100)])
      .toEqual([score, e, x, pct]);
  }
});

test('doubling a stat gives 1.74 times its effective score, and an S main stat is worth 9.8 times a base one', () => {
  expect(eff(40, R) / eff(20, R)).toBeCloseTo(1.74, 2);
  expect(eff(174, R) / R.statBase).toBeCloseTo(9.8, 1);
});

test('a capped curve is half its cap at 40 points and never reaches it', () => {
  expect(capped(40, 30, R)).toBe(15);
  expect(capped(1e9, 30, R)).toBeLessThan(30);
  expect(capped(0, 30, R)).toBe(0);
});

test('below 0 a capped curve falls at the slope it starts with, so a loss weighs at least as much as the same gain', () => {
  expect(capped(-20, 40, R)).toBe(-20);
  for (const x of [1, 5, 20, 80]) expect([x, -capped(-x, 10, R) >= capped(x, 10, R)]).toEqual([x, true]);
});

test('a score under 1 counts as 1, so a stat a status drives past 0 still gives a number', () => {
  expect(eff(-5, R)).toBe(eff(1, R));
  expect(Number.isFinite(eff(0, R))).toBe(true);
});
