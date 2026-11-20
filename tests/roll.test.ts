import { describe, expect, test } from 'bun:test';
import { pick, rollDice, rollFormula, rollNeeds, rollOpenings, rollSettle, rollTerm } from '../src/edge/roll.ts';
import { diceOf, EXPLODE_MAX, mean, parseFormula, rollOf } from '../src/core/formula.ts';
import type { Dice, Formula, Scope } from '../src/core/formula.ts';
import type { Random } from '../src/edge/roll.ts';
import type { Needs } from '../src/core/combat/resolve.ts';
import { combatantId } from '../src/core/combat/ability-types.ts';
import { heldDieId } from '../src/core/combat/standing.ts';
import { statusKey } from '../src/core/combat/effect-ops.ts';

// A small seeded generator (mulberry32); no test reads real randomness.
const seeded = (seed: number): Random => () => {
  seed = (seed + 0x6D2B79F5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const id = combatantId;
const SEEDS = [1, 2, 3, 99, 12345];

describe('a roll table\'s line (pick)', () => {
  test('each line takes an equal share of the source: four lines split [0, 1) into quarters', () => {
    const lines = ['a', 'b', 'c', 'd'];
    expect([0, 0.2499, 0.25, 0.5, 0.75, 0.9999].map(x => pick(lines, () => x))).toEqual(['a', 'a', 'b', 'c', 'd', 'd']);
  });
  test('an empty table has no line', () => {
    expect(pick([], () => 0.5)).toBeUndefined();
  });
});

describe('rollDice', () => {
  test('a total of count dice lies between count and count times sides, over many seeds', () => {
    for (const seed of SEEDS) {
      const r = seeded(seed);
      for (let i = 0; i < 200; i++) {
        const t = rollDice({ count: 3, sides: 6 }, r);
        expect(t).toBeGreaterThanOrEqual(3);
        expect(t).toBeLessThanOrEqual(18);
        expect(Number.isInteger(t)).toBe(true);
      }
    }
  });
  test('the lowest and highest random values give the lowest and highest face', () => {
    expect(rollDice({ count: 2, sides: 8 }, () => 0)).toBe(2);
    expect(rollDice({ count: 2, sides: 8 }, () => 0.999999)).toBe(16);
  });
  test('the default source stays in the faces', () => {
    for (let i = 0; i < 50; i++) {
      const t = rollDice({ count: 1, sides: 20 });
      expect(t).toBeGreaterThanOrEqual(1);
      expect(t).toBeLessThanOrEqual(20);
    }
  });
});

describe('rollNeeds', () => {
  const needs: Needs = {
    dice: { [id('a')]: [{ count: 2, sides: 6 }, { count: 1, sides: 4 }], [id('b')]: [], [id('c')]: [{ count: 4, sides: 10 }] },
    react: [id('a'), id('c')],
    refund: false,
  };
  test('one total per dice term for each target, each within its faces', () => {
    for (const seed of SEEDS) {
      const rolls = rollNeeds(needs, seeded(seed));
      expect(Object.keys(rolls.dice).sort()).toEqual(['a', 'b', 'c']);
      expect(rolls.dice[id('a')]).toHaveLength(2);
      expect(rolls.dice[id('b')]).toEqual([]);
      const [two6, one4] = rolls.dice[id('a')]!;
      expect(two6).toBeGreaterThanOrEqual(2); expect(two6).toBeLessThanOrEqual(12);
      expect(one4).toBeGreaterThanOrEqual(1); expect(one4).toBeLessThanOrEqual(4);
      const [four10] = rolls.dice[id('c')]!;
      expect(four10).toBeGreaterThanOrEqual(4); expect(four10).toBeLessThanOrEqual(40);
    }
  });
  test('a d20 for each reaction asked and none for the rest', () => {
    const rolls = rollNeeds(needs, seeded(7));
    expect(Object.keys(rolls.react).sort()).toEqual(['a', 'c']);
    for (const v of Object.values(rolls.react)) { expect(v).toBeGreaterThanOrEqual(1); expect(v).toBeLessThanOrEqual(20); }
  });
  test('a refund d20 only when the use asks for one', () => {
    expect('refund' in rollNeeds(needs, seeded(7))).toBe(false);
    const rolls = rollNeeds({ ...needs, refund: true }, seeded(7));
    expect(rolls.refund).toBeGreaterThanOrEqual(1);
    expect(rolls.refund).toBeLessThanOrEqual(20);
  });
  test('a use that needs nothing rolls nothing', () => {
    expect(rollNeeds({ dice: {}, react: [], refund: false }, seeded(1))).toEqual({ dice: {}, react: {} });
  });
  test('the same seed gives the same rolls', () => {
    expect(rollNeeds(needs, seeded(5))).toEqual(rollNeeds(needs, seeded(5)));
  });
});

describe('rollOpenings', () => {
  test('one opening per id in order, a d20 and a d1000 tie each', () => {
    const ids = [id('x'), id('y'), id('z')];
    for (const seed of SEEDS) {
      const out = rollOpenings(ids, seeded(seed));
      expect(out.map(o => o.id)).toEqual(ids);
      for (const o of out) {
        expect(o.d20).toBeGreaterThanOrEqual(1); expect(o.d20).toBeLessThanOrEqual(20);
        expect(o.tie).toBeGreaterThanOrEqual(1); expect(o.tie).toBeLessThanOrEqual(1000);
      }
    }
  });
  test('no ids, no openings', () => {
    expect(rollOpenings([], seeded(1))).toEqual([]);
  });
});

describe('rollSettle', () => {
  test('one total per dice term in order, each within its faces', () => {
    for (const seed of SEEDS) {
      const out = rollSettle([{ count: 1, sides: 6 }, { count: 3, sides: 8 }], seeded(seed));
      expect(out).toHaveLength(2);
      expect(out[0]).toBeGreaterThanOrEqual(1); expect(out[0]).toBeLessThanOrEqual(6);
      expect(out[1]).toBeGreaterThanOrEqual(3); expect(out[1]).toBeLessThanOrEqual(24);
    }
  });
  test('no dice, no totals', () => {
    expect(rollSettle([], seeded(1))).toEqual([]);
  });
});

describe('a dice term with Roll20\'s modifiers', () => {
  const formula = (text: string): Formula => {
    const r = parseFormula(text, { dice: { maxDice: 50, maxSides: 1000 } });
    if (!r.ok) throw new Error(r.error);
    return r.formula;
  };
  const term = (text: string): Dice => diceOf(formula(text))[0]!;
  /** A source that gives these numbers in turn, as faces of a d20: (face - 0.5) / 20. */
  const faces20 = (...faces: number[]): Random => () => (faces.shift()! - 0.5) / 20;

  test('the roller draws the faces core asks for, and core reads them: 2d20kh1 is the higher of the two drawn', () => {
    expect(rollTerm(term('2d20kh1'), faces20(7, 17))).toEqual({ faces: [{ face: 7, fate: 'dropped', exploded: false }, { face: 17, fate: 'kept', exploded: false }], total: 17 });
    expect(rollDice(term('2d20kl1'), faces20(7, 17))).toBe(7);
  });

  test('an exploding die asks again for each die it adds, up to the cap', () => {
    const r = rollTerm(term('1d6!'), () => 0.999999);
    expect([r.faces.length, r.total]).toEqual([EXPLODE_MAX + 1, 6 * (EXPLODE_MAX + 1)]);
  });

  test('whatever the seed, a term rolled is what core reads from the same faces', () => {
    for (const seed of SEEDS) for (const text of ['4d6dl1', '3d8!r1kh2', '10d6>5', '2d10ro<3!']) {
      const d = term(text), r = rollTerm(d, seeded(seed));
      expect([text, rollOf(d, r.faces.map(f => f.face))]).toEqual([text, r]);
    }
  });

  test('a plain term draws the same faces it always did, so a seeded fight rolls the same', () => {
    for (const seed of SEEDS) {
      const r = seeded(seed);
      let old = 0;
      for (let i = 0; i < 3; i++) old += 1 + Math.floor(r() * 6);
      expect(rollDice({ count: 3, sides: 6 }, seeded(seed))).toBe(old);
    }
  });

  test('a fight\'s needs with a kept d20 roll one face from 1 to 20, not the sum of two', () => {
    const kept = term('2d20kh1');
    for (const seed of SEEDS) {
      const rolls = rollNeeds({ dice: { [id('a')]: [kept] }, react: [], refund: false }, seeded(seed));
      const [v] = rolls.dice[id('a')]!;
      expect(v).toBeGreaterThanOrEqual(1);
      expect(v).toBeLessThanOrEqual(20);
    }
    expect(rollSettle([kept], faces20(3, 19))).toEqual([19]);
  });

  test('a formula rolled gives each term\'s faces and the total those terms make', () => {
    const scope = { charge: 0 } as unknown as Scope; // the formula names no stat, so no body is read
    const r = rollFormula(formula('/r 2d20kh1 + d20 + 4'), scope, faces20(5, 12, 9));
    expect(r.terms.map(t => [t.dice, t.faces.map(f => f.face), t.total])).toEqual([
      [{ count: 2, sides: 20, mods: { cut: { how: 'kh', n: 1 } } }, [5, 12], 12],
      [{ count: 1, sides: 20 }, [9], 9],
    ]);
    expect(r.total).toBe(12 + 9 + 4);
  });

  test('over 20,000 seeded rolls of 2d20kh1 the average is within 0.1 of the mean core gives', () => {
    const r = seeded(42);
    let sum = 0;
    for (let i = 0; i < 20000; i++) sum += rollDice(term('2d20kh1'), r);
    expect(Math.abs(sum / 20000 - mean(term('2d20kh1')))).toBeLessThan(0.1);
  });
});

describe('the dice of rule 7b (kits design 8.2)', () => {
  test('a second d20 for each die with an edge and each held die by its id, rolled from the same random source', () => {
    let i = 0;
    const seq = [0.05, 0.5, 0.95, 0.3, 0.7];
    const bless = heldDieId(combatantId('u'), statusKey('bless'), 0), focus = heldDieId(combatantId('u'), statusKey('focus'), 0);
    const r = rollNeeds({ dice: {}, react: [combatantId('t')], refund: false, second: [combatantId('t')], boost: [{ id: bless, sides: 6 }, { id: focus, sides: 8 }] }, () => seq[i++ % seq.length]!);
    expect(r.react).toEqual({ t: 2 });
    expect(r.second).toEqual({ t: 11 });
    expect(r.boost).toEqual({ [bless]: 6, [focus]: 3 });
    expect('second' in rollNeeds({ dice: {}, react: [], refund: false })).toBe(false);
  });
});
