// A write held back under Undo (src/core/held.ts): Give…'s award, End story, an exchange's Accept, the GM's Stop and the GM's Remove of a stash line, from the pick to its end. Every
// state against every event, the refused cells too.
import { describe, expect, test } from 'bun:test';
import { HELD_EVENTS, HELD_STATES, heldKey, heldStep } from '../src/core/held.ts';
import type { HeldEvent, HeldWrite } from '../src/core/held.ts';
import { iid, srid } from './fixtures/ids.ts';
import { parseOfferId } from '../src/core/ids.ts';
import type { OfferId } from '../src/core/ids.ts';

const offer = (s: string): OfferId => parseOfferId(s)!;

const PICK: HeldEvent = { type: 'pick', at: 1_000, ms: 2_000 };
const EVENTS: { readonly [E in HeldEvent['type']]: Extract<HeldEvent, { type: E }> } = {
  pick: PICK, undo: { type: 'undo' }, due: { type: 'due' }, hidden: { type: 'hidden' },
};
const STATES: { readonly [S in HeldWrite['at']]: Extract<HeldWrite, { at: S }> } = {
  absent: { at: 'absent' }, holding: { at: 'holding', until: 3_000 }, committed: { at: 'committed' }, undone: { at: 'undone' },
};

describe('a held write', () => {
  test('every state answers every event: a pick holds it for its own window; Undo drops it; its window\'s end or the page hidden write it, and nothing else does (newer toasts are not an event of it: SMX-gates-5.1)', () => {
    const table = Object.fromEntries(HELD_STATES.map(s => [s, Object.fromEntries(HELD_EVENTS.map(e => [e, heldStep(STATES[s], EVENTS[e])]))]));
    expect(table).toEqual({
      absent: { pick: { at: 'holding', until: 3_000 }, undo: null, due: null, hidden: null },
      holding: { pick: null, undo: { at: 'undone' }, due: { at: 'committed' }, hidden: { at: 'committed' } },
      committed: { pick: null, undo: null, due: null, hidden: null },
      undone: { pick: null, undo: null, due: null, hidden: null },
    });
  });

  test('End story tapped twice on one run holds one end: the second pick of the same write is refused while the first is held (SMX-gates-5.3a)', () => {
    const first = heldStep(STATES.absent, PICK)!;
    expect(heldKey({ kind: 'end', run: srid('sr1') })).toBe(heldKey({ kind: 'end', run: srid('sr1') }));
    expect(heldStep(first, { type: 'pick', at: 1_200, ms: 2_000 })).toBeNull();
    expect(heldStep(heldStep(first, { type: 'undo' })!, { type: 'due' })).toBeNull();
  });

  test('one write is one key: the end of another run, another award or another hunter, an accept or a stop of an offer, the removal of a stash line, is a write of its own', () => {
    const keys = [
      heldKey({ kind: 'accept', offer: offer('d-p1-1abc-wxyz') }), heldKey({ kind: 'stop', offer: offer('d-p1-1abc-wxyz') }),
      heldKey({ kind: 'accept', offer: offer('d-p1-1abd-wxyz') }),
      heldKey({ kind: 'end', run: srid('sr1') }), heldKey({ kind: 'end', run: srid('sr2') }),
      heldKey({ kind: 'give', to: 'h1', bundle: 'seed-mask' }), heldKey({ kind: 'give', to: 'h1', bundle: 'seed-face' }),
      heldKey({ kind: 'give', to: 'd-p1:h1', bundle: 'seed-mask' }),
      heldKey({ kind: 'stashRemove', line: iid('i900') }), heldKey({ kind: 'stashRemove', line: iid('i901') }),
    ];
    expect(new Set(keys).size).toBe(keys.length);
    expect(heldKey({ kind: 'give', to: 'h1', bundle: 'seed-mask' })).toBe(keys[5]!);
    expect(heldKey({ kind: 'stop', offer: offer('d-p1-1abc-wxyz') })).toBe(keys[1]!);
    expect(heldKey({ kind: 'stashRemove', line: iid('i900') }), 'a second Remove of one line is the same write').toBe(keys[8]!);
  });
});
