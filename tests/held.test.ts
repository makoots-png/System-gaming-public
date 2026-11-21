// A write the GM holds back under Undo (src/core/held.ts): Give…'s award and End story, from the pick to its end. Every
// state against every event, the refused cells too, and the rows that wait on a ruling named as the app behaves today.
import { describe, expect, test } from 'bun:test';
import { HELD_EVENTS, HELD_STATES, heldKey, heldStep } from '../src/core/held.ts';
import type { HeldEvent, HeldWrite } from '../src/core/held.ts';
import { srid } from './fixtures/ids.ts';

const PICK: HeldEvent = { type: 'pick', at: 1_000, ms: 2_000 };
const EVENTS: { readonly [E in HeldEvent['type']]: Extract<HeldEvent, { type: E }> } = {
  pick: PICK, undo: { type: 'undo' }, due: { type: 'due' }, crowded: { type: 'crowded' }, hidden: { type: 'hidden' },
};
const STATES: { readonly [S in HeldWrite['at']]: Extract<HeldWrite, { at: S }> } = {
  absent: { at: 'absent' }, holding: { at: 'holding', until: 3_000 }, committed: { at: 'committed' }, undone: { at: 'undone' },
};

describe('a held write', () => {
  test('every state answers every event: a pick holds it for its own window; Undo drops it; its window\'s end, two newer toasts or the page hidden write it', () => {
    const table = Object.fromEntries(HELD_STATES.map(s => [s, Object.fromEntries(HELD_EVENTS.map(e => [e, heldStep(STATES[s], EVENTS[e])]))]));
    expect(table).toEqual({
      absent: { pick: { at: 'holding', until: 3_000 }, undo: null, due: null, crowded: null, hidden: null },
      holding: { pick: null, undo: { at: 'undone' }, due: { at: 'committed' }, crowded: { at: 'committed' }, hidden: { at: 'committed' } },
      committed: { pick: null, undo: null, due: null, crowded: null, hidden: null },
      undone: { pick: null, undo: null, due: null, crowded: null, hidden: null },
    });
  });

  test('End story tapped twice on one run holds one end: the second pick of the same write is refused while the first is held (SMX-gates-5.3a)', () => {
    const first = heldStep(STATES.absent, PICK)!;
    expect(heldKey({ kind: 'end', run: srid('sr1') })).toBe(heldKey({ kind: 'end', run: srid('sr1') }));
    expect(heldStep(first, { type: 'pick', at: 1_200, ms: 2_000 })).toBeNull();
    expect(heldStep(heldStep(first, { type: 'undo' })!, { type: 'due' })).toBeNull();
  });

  test('one write is one key: the end of another run, another award or another hunter is a write of its own', () => {
    const keys = [
      heldKey({ kind: 'end', run: srid('sr1') }), heldKey({ kind: 'end', run: srid('sr2') }),
      heldKey({ kind: 'give', to: 'h1', bundle: 'seed-mask' }), heldKey({ kind: 'give', to: 'h1', bundle: 'seed-face' }),
      heldKey({ kind: 'give', to: 'd-p1:h1', bundle: 'seed-mask' }),
    ];
    expect(new Set(keys).size).toBe(keys.length);
    expect(heldKey({ kind: 'give', to: 'h1', bundle: 'seed-mask' })).toBe(keys[2]!);
  });

  test('waits on the ruling SMX-gates-5.1: today two newer toasts write a held award before its Undo window ends', () => {
    expect(heldStep(STATES.holding, { type: 'crowded' })).toEqual({ at: 'committed' });
  });

  test('waits on the ruling SMX-gates-5.2: today a bundle picked on the shelf is held as it is, with no step to edit it first', () => {
    expect(heldStep(STATES.absent, PICK)).toEqual({ at: 'holding', until: PICK.at + PICK.ms });
  });
});
