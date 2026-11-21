import { describe, expect, test } from 'bun:test';
import { describeItem } from '../src/core/effects.ts';
import type { Op } from '../src/core/combat/effect-ops.ts';
import { parseFormula } from '../src/core/formula.ts';
import type { Formula, FormulaBody } from '../src/core/formula.ts';
import { hunterSheet } from '../src/core/hunter/sheet.ts';
import { newHunter } from '../src/core/save.ts';
import { RULES } from '../src/core/rules.ts';

const f = (text: string): Formula => {
  const r = parseFormula(text, RULES);
  if (!r.ok) throw new Error(`${text}: ${r.error}`);
  return r.formula;
};

// A new hunter's own numbers, at max HP 120 and Strength 40 so the sums below can be worked by hand.
const base = hunterSheet(newHunter(RULES), RULES);
const WEARER: FormulaBody = { stats: { ...base.stats, str: 40 }, sheet: { ...base.sheet, hpMax: 120 } };

// the owner's three shields (Nov 21) and a heal that grows with Strength, on one common item.
const OPS: Op[] = [
  { op: 'shield', amount: f('12') },
  { op: 'shield', amount: f('0.2 * hpmax') },
  { op: 'shield', amount: f('10 + 0.2 * hpmax') },
  { op: 'heal', amount: f('5 + 0.3 * str'), when: 'use' },
  { op: 'damage', amount: f('2d6 + str'), type: 'physical', when: 'use' },
];
const ITEM = { rar: 'common', effects: OPS };

describe('an item\'s card', () => {
  test('with its wearer, each amount that grows says what it comes to on them: 20% of max HP 120 is 24, 5 + 0.3 × Strength 40 is 17', () => {
    expect(describeItem(RULES, ITEM, OPS, WEARER)).toEqual([
      'Shield: 12',
      'Shield: 20% of max HP (now 24)',
      'Shield: 10 + 20% of max HP (now 34)',
      'Heal: 5 + 0.3 × Strength (now 17)',
      'Deals 2d6 + str physical damage',
    ]);
  });

  test('without a wearer, the same amounts in words with no "now"', () => {
    expect(describeItem(RULES, ITEM)).toEqual([
      'Shield: 12',
      'Shield: 20% of max HP',
      'Shield: 10 + 20% of max HP',
      'Heal: 5 + 0.3 × Strength',
      'Deals 2d6 + str physical damage',
    ]);
  });
});
