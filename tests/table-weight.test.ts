// The GM's table weight on the hunters' dice outside a fight (docs/agent-handoff/features/notes-8-fudge.md section 2,
// ruling 5; unit 8 of section 5). Each expected value is read from the rule, not from running the code.
import { describe, expect, test } from 'bun:test';
import { NO_TABLE_WEIGHT, WEIGHT_MAX, parseTableWeight, rollsD20, weighed, weighsFor, weightOf, weightOn, weightStep } from '../src/core/table-weight.ts';
import type { TableWeight, WeightEvent } from '../src/core/table-weight.ts';
import { newSave, parseSaveValue } from '../src/core/save.ts';
import type { ParseEnv, Save } from '../src/core/save.ts';
import { parseSheetKey } from '../src/core/ids.ts';
import type { SheetKey } from '../src/core/ids.ts';
import { RULES } from '../src/core/rules.ts';
import { dev } from './fixtures/ids.ts';

const key = (s: string): SheetKey => { const k = parseSheetKey(s); if (!k) throw new Error(`not a sheet key: ${s}`); return k; };
const KAI = key('d-player1:h1'), MIRA = key('d-player2:h4'), RIN = key('d-player1:h2');
const run = (...events: WeightEvent[]): TableWeight => events.reduce(weightStep, NO_TABLE_WEIGHT);
const env = (): ParseEnv => ({ now: new Date('2026-11-22T12:00:00.000Z'), newDeviceId: () => dev('d-test1'), newDeviceToken: () => 'token-00000000000000000000000001' });
const read = (raw: unknown): Save => {
  const p = parseSaveValue(JSON.parse(JSON.stringify(raw)), env());
  if (p.kind !== 'save') throw new Error(`not a save: ${p.kind}`);
  return p.save;
};

describe('the GM sets the table weight', () => {
  test('a table weight is set, not added: the same tap twice leaves +2, and the second changes nothing', () => {
    const once = run({ kind: 'hunters', n: 2 });
    expect(once.hunters).toBe(2);
    expect(weightStep(once, { kind: 'hunters', n: 2 })).toBe(once);
    const own = weightStep(once, { kind: 'own', key: KAI, n: -1 });
    expect(weightStep(own, { kind: 'own', key: KAI, n: -1 })).toBe(own);
  });

  test('a hunter\'s weight is the hunters\' plus its own', () => {
    const tw = run({ kind: 'hunters', n: 2 }, { kind: 'own', key: KAI, n: -3 });
    expect(weightOf(tw, KAI)).toEqual({ total: 2 - 3, force: null });
    expect(weightOf(tw, MIRA)).toEqual({ total: 2, force: null });
  });

  test('a hunter\'s own weight set back to 0 leaves no entry, and so does a force taken off', () => {
    const tw = run({ kind: 'own', key: KAI, n: 4 }, { kind: 'force', key: KAI, face: 1 }, { kind: 'own', key: KAI, n: 0 }, { kind: 'force', key: KAI, face: null });
    expect(tw).toEqual(NO_TABLE_WEIGHT);
  });

  test('a GM forces a hunter\'s next roll to 20, then to 1, then takes it off; another hunter\'s is its own', () => {
    const twenty = run({ kind: 'force', key: KAI, face: 20 });
    expect([weightOf(twenty, KAI).force, weightOf(twenty, MIRA).force]).toEqual([20, null]);
    const one = weightStep(twenty, { kind: 'force', key: KAI, face: 1 });
    expect(weightOf(one, KAI).force).toBe(1);
    expect(weightOf(weightStep(one, { kind: 'force', key: KAI, face: null }), KAI).force).toBeNull();
  });

  test('a weight has no bound a die can tell: past one less than the largest die\'s sides it is kept there, where every die reads its top or bottom face', () => {
    expect(WEIGHT_MAX).toBe(RULES.dice.maxSides - 1);
    expect(run({ kind: 'hunters', n: 40 }).hunters).toBe(40);
    expect([run({ kind: 'hunters', n: 5000 }).hunters, weightOf(run({ kind: 'own', key: KAI, n: -5000 }), KAI).total]).toEqual([WEIGHT_MAX, -WEIGHT_MAX]);
  });
});

describe('a force is one roll\'s', () => {
  test('a force is cleared when that hunter\'s next d20 roll reaches the Table feed', () => {
    const tw = run({ kind: 'force', key: KAI, face: 20 }, { kind: 'force', key: MIRA, face: 1 }, { kind: 'hunters', n: 2 });
    const after = weightStep(tw, { kind: 'rolled', key: KAI, expr: '1d20+3' });
    expect([weightOf(after, KAI), weightOf(after, MIRA)]).toEqual([{ total: 2, force: null }, { total: 2, force: 1 }]);
  });

  test('a roll with no d20 spends no force: damage dice, a d200, a formula that does not read', () => {
    const tw = run({ kind: 'force', key: KAI, face: 20 });
    for (const expr of ['2d6+1', '1d200', 'd2', 'not a roll', '']) expect(weightStep(tw, { kind: 'rolled', key: KAI, expr })).toBe(tw);
    expect([rollsD20('d20'), rollsD20('2d20kh1+4'), rollsD20('1d6+1d20')]).toEqual([true, true, true]);
  });

  test('a d20 roll by a hunter with no force changes nothing', () => {
    const tw = run({ kind: 'hunters', n: 1 });
    expect(weightStep(tw, { kind: 'rolled', key: KAI, expr: '1d20' })).toBe(tw);
  });

  test('the GM\'s save takes each event through the one step, and a step that changes nothing leaves the save as it was', () => {
    const save = newSave(dev('d-gm1'));
    const set = weighed(save, { kind: 'force', key: KAI, face: 20 });
    expect(set.tableWeight.forced).toEqual({ [KAI]: 20 });
    expect(weighed(set, { kind: 'force', key: KAI, face: 20 })).toBe(set);
    expect(weighed(set, { kind: 'rolled', key: KAI, expr: '1d20' }).tableWeight).toEqual(NO_TABLE_WEIGHT);
  });
});

describe('what a tap sends', () => {
  const room = [KAI, MIRA];

  test('the hunters\' weight sends each player\'s hunter its own total', () => {
    const before = run({ kind: 'own', key: KAI, n: 1 }), after = weightStep(before, { kind: 'hunters', n: 2 });
    expect(weighsFor(before, after, room)).toEqual([{ to: [KAI], total: 3, force: null }, { to: [MIRA], total: 2, force: null }]);
  });

  test('one hunter\'s weight or force sends only that hunter, with its total and its force', () => {
    const before = run({ kind: 'hunters', n: 2 });
    expect(weighsFor(before, weightStep(before, { kind: 'own', key: MIRA, n: -1 }), room)).toEqual([{ to: [MIRA], total: 1, force: null }]);
    expect(weighsFor(before, weightStep(before, { kind: 'force', key: KAI, face: 20 }), room)).toEqual([{ to: [KAI], total: 2, force: 20 }]);
  });

  test('a tap that changes nothing sends nothing, and a hunter not in the room is sent nothing', () => {
    const tw = run({ kind: 'hunters', n: 2 });
    expect(weighsFor(tw, weightStep(tw, { kind: 'hunters', n: 2 }), room)).toEqual([]);
    expect(weighsFor(tw, weightStep(tw, { kind: 'own', key: RIN, n: 3 }), room)).toEqual([]);
  });

  test('a hunter whose total is the same after the change is sent nothing', () => {
    const before = run({ kind: 'own', key: KAI, n: 1 }), after = run({ kind: 'hunters', n: 1 });
    expect(weighsFor(before, after, room)).toEqual([{ to: [MIRA], total: 1, force: null }]);
  });
});

describe('the GM\'s gold dot', () => {
  test('the dot is on while a hunter at the table has a weight or a forced roll, and off when every weight there adds to 0', () => {
    expect(weightOn(NO_TABLE_WEIGHT, [KAI, MIRA])).toBe(false);
    expect(weightOn(run({ kind: 'hunters', n: 1 }), [KAI])).toBe(true);
    expect(weightOn(run({ kind: 'force', key: MIRA, face: 1 }), [KAI, MIRA])).toBe(true);
    expect(weightOn(run({ kind: 'hunters', n: 1 }, { kind: 'own', key: KAI, n: -1 }), [KAI])).toBe(false);
    expect(weightOn(run({ kind: 'own', key: RIN, n: 2 }), [KAI, MIRA]), 'a hunter not at the table').toBe(false);
  });
});

describe('the table weight in a save', () => {
  test('a save without a table weight reads none', () => {
    const { tableWeight: _, ...raw } = newSave(dev('d-gm1'));
    expect(read(raw).tableWeight).toEqual(NO_TABLE_WEIGHT);
    expect(read({ ...raw, tableWeight: 'heavy' }).tableWeight).toEqual(NO_TABLE_WEIGHT);
  });

  test('a stored table weight reads back as it was set', () => {
    const tw = run({ kind: 'hunters', n: -2 }, { kind: 'own', key: KAI, n: 5 }, { kind: 'force', key: MIRA, face: 1 });
    expect(read({ ...newSave(dev('d-gm1')), tableWeight: tw }).tableWeight).toEqual(tw);
  });

  test('a weight that is not whole reads 0, one past every die is kept within it, and an entry under no sheet key, an own 0 or a force but 1 or 20 is dropped', () => {
    expect(parseTableWeight({ hunters: 1.5, own: { [KAI]: 9000, [MIRA]: 0, 'no key': 2, [RIN]: '3' }, forced: { [KAI]: 19, [MIRA]: 20, 'no key': 1 } }))
      .toEqual({ hunters: 0, own: { [KAI]: WEIGHT_MAX }, forced: { [MIRA]: 20 } });
    expect(parseTableWeight({ hunters: -3, own: [], forced: null })).toEqual({ hunters: -3, own: {}, forced: {} });
  });
});
