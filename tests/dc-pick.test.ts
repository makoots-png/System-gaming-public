import { describe, expect, test } from 'bun:test';
import { DC_KEYS, DC_PICK_EVENTS, DC_PICK_STATES, DC_START, dcKeyOf, dcOf, dcPickStep, dcWords } from '../src/core/dc-pick.ts';
import type { DcKey, DcPick, DcPickEvent } from '../src/core/dc-pick.ts';
import { RANKS, RULES } from '../src/core/rules.ts';

const chosen = (key: DcKey): DcPick => ({ at: 'chosen', key });
const picked = (key: DcKey): DcPickEvent => ({ kind: 'picked', key });

describe('the quick check\'s DC', () => {
  // the owner, Nov 22 (SMX-views-13.1): the number to beat is "Same for everyone", so the view opens on one choice for
  // every hunter, whatever its rank: the lowest rank's Standard.
  test('a Dice view starts on E Standard for every hunter, whatever its rank', () => {
    expect(DC_START).toEqual({ at: 'defaulted' });
    expect(dcKeyOf(DC_START)).toBe('E:1');
    expect(dcOf(DC_START, RULES.rankTable)).toBe(RULES.rankTable.E.dc[1]!);
  });

  test('every state against every event: a pick is the player\'s from then on', () => {
    const states: DcPick[] = [DC_START, chosen('B:2'), chosen('none')];
    const events: DcPickEvent[] = [picked('D:0'), picked('none')];
    const table = states.map(s => events.map(e => dcPickStep(s, e)));
    expect(table).toEqual([
      [chosen('D:0'), chosen('none')],
      [chosen('D:0'), chosen('none')],
      [chosen('D:0'), chosen('none')],
    ]);
  });

  test('picking the option the view defaulted to makes it the player\'s choice', () => {
    expect(dcPickStep(DC_START, picked('E:1'))).toEqual(chosen('E:1'));
  });

  test('a step that changes nothing answers the same value, so the view draws only a change', () => {
    const s = chosen('A:2');
    expect(dcPickStep(s, picked('A:2'))).toBe(s);
  });

  test('the DC is read from the rank table at the roll, so a pick follows the GM\'s numbers for its rank and level', () => {
    const table = { ...RULES.rankTable, C: { ...RULES.rankTable.C, dc: [21, 25, 29] } };
    expect(dcOf(chosen('C:0'), RULES.rankTable)).toBe(20);
    expect(dcOf(chosen('C:0'), table)).toBe(21);
    expect(dcOf(DC_START, { ...table, E: { ...RULES.rankTable.E, dc: [10, 14, 18] } })).toBe(14);
    expect(dcOf(chosen('none'), table)).toBeNull();
  });

  test('two options with the same number stay two choices', () => {
    // the shipped table gives D Hard and C Easy both DC 20
    expect([RULES.rankTable.D.dc[2], RULES.rankTable.C.dc[0]]).toEqual([20, 20]);
    expect(dcPickStep(DC_START, picked('C:0'))).not.toEqual(dcPickStep(DC_START, picked('D:2')));
    expect([dcWords('C:0', RULES.rankTable), dcWords('D:2', RULES.rankTable)]).toEqual(['C Easy (DC 20)', 'D Hard (DC 20)']);
  });

  test('the keys are no DC and each rank\'s three levels, in the order the select lists them', () => {
    expect(DC_KEYS).toEqual(['none', ...RANKS.flatMap(r => [`${r}:0`, `${r}:1`, `${r}:2`])]);
    expect(dcWords('none', RULES.rankTable)).toBe('No DC (roll only)');
    expect(dcWords('S:2', RULES.rankTable)).toBe('S Hard (DC 55)');
  });

  test('the lists of states and events are every member of the types', () => {
    const kinds: Record<DcPickEvent['kind'], true> = { picked: true };
    const ats: Record<DcPick['at'], true> = { defaulted: true, chosen: true };
    expect([...DC_PICK_EVENTS].sort()).toEqual(Object.keys(kinds).sort());
    expect([...DC_PICK_STATES].sort()).toEqual(Object.keys(ats).sort());
  });
});
