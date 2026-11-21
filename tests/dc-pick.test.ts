import { describe, expect, test } from 'bun:test';
import { DC_KEYS, DC_PICK_EVENTS, DC_PICK_STATES, dcKeyOf, dcOf, dcPickStep, dcStart, dcWords } from '../src/core/dc-pick.ts';
import type { DcKey, DcPick, DcPickEvent } from '../src/core/dc-pick.ts';
import { RANKS, RULES } from '../src/core/rules.ts';
import type { Rank } from '../src/core/rules.ts';

const chosen = (key: DcKey): DcPick => ({ at: 'chosen', key });
const picked = (key: DcKey): DcPickEvent => ({ kind: 'picked', key });
const hunterRank = (rank: Rank): DcPickEvent => ({ kind: 'hunterRank', rank });

describe('the quick check\'s DC', () => {
  test('a Dice view starts on its hunter\'s rank, Standard', () => {
    expect(dcStart('C')).toEqual({ at: 'defaulted', rank: 'C' });
    expect(dcKeyOf(dcStart('C'))).toBe('C:1');
  });

  test('every state against every event: a pick is the player\'s from then on, and the hunter\'s rank moves nothing today', () => {
    const states: DcPick[] = [dcStart('E'), chosen('B:2'), chosen('none')];
    const events: DcPickEvent[] = [picked('D:0'), picked('none'), hunterRank('S')];
    const table = states.map(s => events.map(e => dcPickStep(s, e)));
    expect(table).toEqual([
      [chosen('D:0'), chosen('none'), dcStart('E')],
      [chosen('D:0'), chosen('none'), chosen('B:2')],
      [chosen('D:0'), chosen('none'), chosen('none')],
    ]);
  });

  test('picking the option the view defaulted to makes it the player\'s choice', () => {
    expect(dcPickStep(dcStart('E'), picked('E:1'))).toEqual(chosen('E:1'));
  });

  // SMX-views-13.1 waits on the owner's ruling "the default check DC follows the active hunter's rank": until then a
  // switch from an E-rank hunter to an S-rank one keeps E Standard, as the app has always done.
  test('a switch to a hunter of another rank keeps the defaulted DC, as today', () => {
    const s = dcStart('E');
    expect(dcPickStep(s, hunterRank('S'))).toBe(s);
    expect(dcOf(dcPickStep(s, hunterRank('S')), RULES.rankTable)).toBe(13);
  });

  test('a step that changes nothing answers the same value, so the view draws only a change', () => {
    const s = chosen('A:2');
    expect(dcPickStep(s, picked('A:2'))).toBe(s);
    expect(dcPickStep(s, hunterRank('E'))).toBe(s);
  });

  test('the DC is read from the rank table at the roll, so a pick follows the GM\'s numbers for its rank and level', () => {
    const table = { ...RULES.rankTable, C: { ...RULES.rankTable.C, dc: [21, 25, 29] } };
    expect(dcOf(chosen('C:0'), RULES.rankTable)).toBe(20);
    expect(dcOf(chosen('C:0'), table)).toBe(21);
    expect(dcOf(dcStart('C'), table)).toBe(25);
    expect(dcOf(chosen('none'), table)).toBeNull();
  });

  test('two options with the same number stay two choices', () => {
    // the shipped table gives D Hard and C Easy both DC 20
    expect([RULES.rankTable.D.dc[2], RULES.rankTable.C.dc[0]]).toEqual([20, 20]);
    expect(dcPickStep(dcStart('E'), picked('C:0'))).not.toEqual(dcPickStep(dcStart('E'), picked('D:2')));
    expect([dcWords('C:0', RULES.rankTable), dcWords('D:2', RULES.rankTable)]).toEqual(['C Easy (DC 20)', 'D Hard (DC 20)']);
  });

  test('the keys are no DC and each rank\'s three levels, in the order the select lists them', () => {
    expect(DC_KEYS).toEqual(['none', ...RANKS.flatMap(r => [`${r}:0`, `${r}:1`, `${r}:2`])]);
    expect(dcWords('none', RULES.rankTable)).toBe('No DC (just roll)');
    expect(dcWords('S:2', RULES.rankTable)).toBe('S Hard (DC 55)');
  });

  test('the lists of states and events are every member of the types', () => {
    const kinds: Record<DcPickEvent['kind'], true> = { picked: true, hunterRank: true };
    const ats: Record<DcPick['at'], true> = { defaulted: true, chosen: true };
    expect([...DC_PICK_EVENTS].sort()).toEqual(Object.keys(kinds).sort());
    expect([...DC_PICK_STATES].sort()).toEqual(Object.keys(ats).sort());
  });
});
