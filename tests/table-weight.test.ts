// The GM's table weight on the hunters' dice outside a fight (docs/agent-handoff/features/notes-8-fudge.md section 2,
// ruling 5; unit 8 of section 5). Each expected value is read from the rule, not from running the code.
import { describe, expect, test } from 'bun:test';
import {
  NO_TABLE_WEIGHT, NO_WEIGHT, WEIGHT_MAX, drawnWith, heldWeight, parseHeldWeights, parseTableWeight, rolledWith, rollsD20, showsForced, weighed, weighsFor,
  weightHeard, weightOf, weightOn, weightSpent, weightStep, weightsJoined,
} from '../src/core/table-weight.ts';
import type { TableWeight, WeightEvent } from '../src/core/table-weight.ts';
import { newRollEntry, newSave, parseSaveValue } from '../src/core/save.ts';
import { rolled } from '../src/core/session-log.ts';
import type { ParseEnv, Save } from '../src/core/save.ts';
import { parseSheetKey } from '../src/core/ids.ts';
import type { RoomCode, SheetKey } from '../src/core/ids.ts';
import { RULES } from '../src/core/rules.ts';
import { dev, hid } from './fixtures/ids.ts';

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
    const after = weightStep(tw, { kind: 'rolled', key: KAI, expr: '1d20+3', rolls: [20] });
    expect([weightOf(after, KAI), weightOf(after, MIRA)]).toEqual([{ total: 2, force: null }, { total: 2, force: 1 }]);
  });

  test('a roll with no d20 spends no force: damage dice, a d200, a formula that does not read', () => {
    const tw = run({ kind: 'force', key: KAI, face: 20 });
    for (const expr of ['2d6+1', '1d200', 'd2', 'not a roll', '']) expect(weightStep(tw, { kind: 'rolled', key: KAI, expr, rolls: [20] })).toBe(tw);
    expect([rollsD20('d20'), rollsD20('2d20kh1+4'), rollsD20('1d6+1d20')]).toEqual([true, true, true]);
  });

  test('a d20 roll by a hunter with no force changes nothing', () => {
    const tw = run({ kind: 'hunters', n: 1 });
    expect(weightStep(tw, { kind: 'rolled', key: KAI, expr: '1d20', rolls: [20] })).toBe(tw);
  });

  test('the GM\'s save takes each event through the one step, and a step that changes nothing leaves the save as it was', () => {
    const save = newSave(dev('d-gm1'));
    const set = weighed(save, { kind: 'force', key: KAI, face: 20 });
    expect(set.tableWeight.forced).toEqual({ [KAI]: 20 });
    expect(weighed(set, { kind: 'force', key: KAI, face: 20 })).toBe(set);
    expect(weighed(set, { kind: 'rolled', key: KAI, expr: '1d20', rolls: [20] }).tableWeight).toEqual(NO_TABLE_WEIGHT);
  });

  test('a roll made before the force reached the player\'s phone, reaching the Table feed after it, leaves the force on the GM\'s phone', () => {
    const tw = run({ kind: 'force', key: KAI, face: 20 }, { kind: 'force', key: MIRA, face: 1 });
    expect(weightStep(tw, { kind: 'rolled', key: KAI, expr: '1d20+3', rolls: [7] }), 'a face the force would have set to 20').toBe(tw);
    expect(weightStep(tw, { kind: 'rolled', key: MIRA, expr: '1d20', rolls: [20] }), 'a 20 under a force of 1').toBe(tw);
    expect(weightStep(tw, { kind: 'rolled', key: KAI, expr: '1d20+3', rolls: [20, 9] }), 'an advantage roll with one die off the face').toBe(tw);
  });

  test('a roll shows the forced face when every d20 of it reads that face: plain, advantage and disadvantage, and a d20 beside other dice', () => {
    expect([showsForced('1d20+3', [20], 20), showsForced('1d20+3', [20, 20], 20), showsForced('1d20-1', [1, 1], 1)]).toEqual([true, true, true]);
    expect([showsForced('1d20+1d6', [20, 4], 20), showsForced('1d20+1d6', [12, 4], 20)]).toEqual([true, false]);
    expect([showsForced('2d6', [1, 1], 1), showsForced('1d20', [], 20), showsForced('not a roll', [20], 20)]).toEqual([false, false, false]);
  });

  test('the GM\'s phone sends the spend of a force to that hunter\'s phone, as any change of its weight', () => {
    const tw = run({ kind: 'hunters', n: 2 }, { kind: 'force', key: KAI, face: 20 });
    expect(weighsFor(tw, weightStep(tw, { kind: 'rolled', key: KAI, expr: '1d20', rolls: [20] }), [KAI, MIRA])).toEqual([{ to: [KAI], total: 2, force: null }]);
  });
});

describe('a hunter whose phone joins the room', () => {
  const AB = 'ABCD23' as RoomCode, CD = 'EFGH45' as RoomCode;

  test('a hunter whose phone joins after the GM\'s tap hears its whole weight; the hunters told before hear nothing again', () => {
    const tw = run({ kind: 'hunters', n: 2 }, { kind: 'force', key: MIRA, face: 1 });
    const first = weightsJoined(null, AB, [KAI], tw);
    expect(first.weighs).toEqual([{ to: [KAI], total: 2, force: null }]);
    const next = weightsJoined(first.told, AB, [KAI, MIRA], tw);
    expect(next.weighs).toEqual([{ to: [MIRA], total: 2, force: 1 }]);
    expect(weightsJoined(next.told, AB, [KAI, MIRA], tw).weighs).toEqual([]);
  });

  test('a hunter with no weight is told 0 and no force, since its phone may hold one the GM took off while it was away', () => {
    expect(weightsJoined(null, AB, [KAI], NO_TABLE_WEIGHT).weighs).toEqual([{ to: [KAI], total: 0, force: null }]);
  });

  test('a hunter that left and joins again is told again, and in another room every hunter is', () => {
    const tw = run({ kind: 'own', key: KAI, n: 3 });
    const both = weightsJoined(null, AB, [KAI, MIRA], tw).told, left = weightsJoined(both, AB, [MIRA], tw).told;
    expect(weightsJoined(left, AB, [KAI, MIRA], tw).weighs).toEqual([{ to: [KAI], total: 3, force: null }]);
    expect(weightsJoined(both, CD, [KAI, MIRA], tw).weighs.map(w => w.to[0])).toEqual([KAI, MIRA]);
    expect(weightsJoined('junk', AB, [KAI], tw).weighs.length, 'a memory that does not read tells every hunter').toBe(1);
  });
});

describe('on a player\'s phone', () => {
  const AB = 'ABCD23' as RoomCode, CD = 'EFGH45' as RoomCode, H1 = hid('h1'), H2 = hid('h2');
  const phone = (): Save => newSave(dev('d-player1'));

  test('a weight heard is set, not added, for its hunter alone; one heard in another room replaces what the phone held', () => {
    const once = weightHeard(phone(), AB, H1, { total: 2, force: null });
    const twice = weightHeard(once, AB, H1, { total: 2, force: null });
    expect(heldWeight(twice.settings.sync.weights, AB, H1)).toEqual({ total: 2, force: null });
    expect(heldWeight(twice.settings.sync.weights, AB, H2)).toEqual(NO_WEIGHT);
    const other = weightHeard(weightHeard(twice, AB, H2, { total: 1, force: 20 }), CD, H2, { total: -1, force: null });
    expect(other.settings.sync.weights).toEqual({ room: CD, hunters: { [H2]: { total: -1, force: null } } });
  });

  test('a roll reads the weight only while the phone is a player in the room it came from', () => {
    const held = weightHeard(phone(), AB, H1, { total: 3, force: 20 }).settings.sync.weights;
    expect([heldWeight(held, AB, H1), heldWeight(held, CD, H1), heldWeight(held, null, H1), heldWeight(undefined, AB, H1)])
      .toEqual([{ total: 3, force: 20 }, NO_WEIGHT, NO_WEIGHT, NO_WEIGHT]);
  });

  test('a force sets every d20 of a roll that throws one; any other roll draws with the total', () => {
    expect([drawnWith({ total: 3, force: 20 }, '1d20+2'), drawnWith({ total: 3, force: 1 }, '2d6'), drawnWith({ total: -2, force: null }, '1d20')])
      .toEqual([{ forced: 20 }, 3, -2]);
  });

  test('a d20 roll spends the force and keeps the total; a roll with no d20, another hunter\'s or one made out of the room spends nothing', () => {
    const save = weightHeard(phone(), AB, H1, { total: 3, force: 20 });
    expect(heldWeight(weightSpent(save, AB, H1, '1d20+4').settings.sync.weights, AB, H1)).toEqual({ total: 3, force: null });
    for (const [room, who, expr] of [[AB, H1, '2d6'], [AB, H2, '1d20'], [null, H1, '1d20'], [CD, H1, '1d20']] as const) expect(weightSpent(save, room, who, expr)).toBe(save);
  });

  test('a roll and the spend of its force are one write: the roll is in the log and the force is gone', () => {
    const save = weightHeard(phone(), AB, H1, { total: 0, force: 1 });
    const entry = { ...newRollEntry(), hid: H1, expr: '1d20', rolls: [1], total: 1, natural: 1 };
    const next = rolledWith(rolled(entry, RULES), AB, H1, '1d20')(save) as Save;
    expect([next.rolls.length, heldWeight(next.settings.sync.weights, AB, H1).force]).toEqual([1, null]);
    expect((rolledWith(rolled(entry, RULES), AB, null, '1d20')(save) as Save).settings.sync.weights, 'the GM\'s own roll spends nothing').toEqual(save.settings.sync.weights);
  });

  test('the weights a phone held read back as they were, and a stored one naming no room, or an entry under no hunter id, is dropped', () => {
    const held = weightHeard(phone(), AB, H1, { total: -4, force: 1 }).settings.sync.weights;
    expect(read({ ...phone(), settings: { ...phone().settings, sync: { ...phone().settings.sync, weights: held } } }).settings.sync.weights).toEqual(held);
    expect(parseHeldWeights({ hunters: { [H1]: { total: 1, force: null } } })).toBeUndefined();
    expect(parseHeldWeights({ room: AB, hunters: { [H1]: { total: 1.5, force: 20 }, 'no id': { total: 1, force: null }, [H2]: { total: 2, force: 7 } } }))
      .toEqual({ room: AB, hunters: { [H2]: { total: 2, force: null } } });
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
