import { describe, expect, test } from 'bun:test';
import { TURN_FREE, TURN_HOLD_EVENTS, TURN_HOLD_STATES, turnHoldStep } from '../src/core/combat/hold.ts';
import type { TurnHold, TurnHoldEvent, TurnHoldEventKind, TurnHoldMoved, TurnHoldState } from '../src/core/combat/hold.ts';

const PICKING: TurnHold = { at: 'picking' };
const SENT: TurnHold = { at: 'sent', from: 'doc-1', id: 'e-pass' };
const STATES: Record<TurnHoldState, TurnHold> = { free: TURN_FREE, picking: PICKING, sent: SENT };

/** One event of each kind, as the views raise them: the entry and the doc are the sent command's own. */
const EVENTS: Record<TurnHoldEventKind, TurnHoldEvent> = {
  tap: { kind: 'tap', via: 'turn' },
  posted: { kind: 'posted', from: 'doc-2', id: 'e-cast' },
  unposted: { kind: 'unposted' },
  doc: { kind: 'doc', at: 'doc-9' },
  refused: { kind: 'refused', id: 'e-pass' },
  dropped: { kind: 'dropped', id: 'e-pass' },
  left: { kind: 'left' },
};

const none = (hold: TurnHold): TurnHoldMoved => ({ hold, send: 'none' });
/**
 * The whole table, worked out from the rule: a tap is taken only while free, and held; a command being picked becomes
 * sent once posted and lets go when nothing was posted or the room changed; a sent command lets go on a doc of another
 * `at`, on its own entry refused or dropped, or when the room changed; nothing else moves the hold.
 */
const TABLE: Record<TurnHoldState, Record<TurnHoldEventKind, TurnHoldMoved>> = {
  free: {
    tap: { hold: PICKING, send: 'held' },
    posted: none(TURN_FREE), unposted: none(TURN_FREE), doc: none(TURN_FREE), refused: none(TURN_FREE), dropped: none(TURN_FREE), left: none(TURN_FREE),
  },
  picking: {
    tap: none(PICKING),
    posted: none({ at: 'sent', from: 'doc-2', id: 'e-cast' }),
    unposted: none(TURN_FREE),
    doc: none(PICKING), refused: none(PICKING), dropped: none(PICKING),
    left: none(TURN_FREE),
  },
  sent: {
    tap: none(SENT), posted: none(SENT), unposted: none(SENT),
    doc: none(TURN_FREE), refused: none(TURN_FREE), dropped: none(TURN_FREE), left: none(TURN_FREE),
  },
};

describe('a player\'s turn held on this phone', () => {
  test('every state answers every event as the table says', () => {
    for (const s of TURN_HOLD_STATES) for (const k of TURN_HOLD_EVENTS) {
      expect([s, k, turnHoldStep(STATES[s], EVENTS[k])]).toEqual([s, k, TABLE[s][k]]);
    }
  });

  test('a move that changes nothing answers the same hold, so the view redraws only a change', () => {
    for (const s of TURN_HOLD_STATES) for (const k of TURN_HOLD_EVENTS) {
      const out = turnHoldStep(STATES[s], EVENTS[k]);
      if (out.hold.at === s && s !== 'sent') expect(out.hold).toBe(STATES[s]);
    }
    expect(turnHoldStep(SENT, { kind: 'doc', at: 'doc-1' }).hold).toBe(SENT);
  });

  test('a sent command waits through every poll of the doc it was sent from, and lets go at the first doc after it', () => {
    const again = turnHoldStep(SENT, { kind: 'doc', at: 'doc-1' });
    expect(again).toEqual(none(SENT));
    expect(turnHoldStep(again.hold, { kind: 'doc', at: 'doc-2' })).toEqual(none(TURN_FREE));
  });

  test('an End turn a full outbox let go gives the turn back, and another message let go keeps it held', () => {
    expect(turnHoldStep(SENT, { kind: 'dropped', id: 'e-pass' })).toEqual(none(TURN_FREE));
    expect(turnHoldStep(SENT, { kind: 'dropped', id: 'e-roll' })).toEqual(none(SENT));
  });

  test('a refusal of another message keeps the turn held; the room\'s refusal of the command lets it go', () => {
    expect(turnHoldStep(SENT, { kind: 'refused', id: 'e-roll' })).toEqual(none(SENT));
    expect(turnHoldStep(SENT, { kind: 'refused', id: 'e-pass' })).toEqual(none(TURN_FREE));
  });

  test('a target window open over a doc that changes keeps the turn held, and the command is held from the doc it is posted at', () => {
    const tapped = turnHoldStep(TURN_FREE, { kind: 'tap', via: 'turn' });
    expect(tapped).toEqual({ hold: PICKING, send: 'held' });
    const over = turnHoldStep(tapped.hold, { kind: 'doc', at: 'doc-5' });
    expect(over).toEqual(none(PICKING));
    const sent = turnHoldStep(over.hold, { kind: 'posted', from: 'doc-5', id: 'e-cast' });
    expect(sent).toEqual(none({ at: 'sent', from: 'doc-5', id: 'e-cast' }));
    expect(turnHoldStep(sent.hold, { kind: 'doc', at: 'doc-5' })).toEqual(none(sent.hold));
  });

  test('a second tap while a command is picked or sent sends nothing', () => {
    for (const hold of [PICKING, SENT]) {
      expect(turnHoldStep(hold, { kind: 'tap', via: 'turn' })).toEqual(none(hold));
      expect(turnHoldStep(hold, { kind: 'tap', via: 'bag' })).toEqual(none(hold));
    }
  });

  // SMX-views-5.1 waits on the owner's ruling: whether a consumable used in a fight takes the turn. Today the List sends it
  // through the bag with nothing held, and its answer does not hold the turn either.
  test('a consumable tapped in the List goes through the bag and leaves the turn free (today, until the ruling)', () => {
    const tapped = turnHoldStep(TURN_FREE, { kind: 'tap', via: 'bag' });
    expect(tapped).toEqual({ hold: TURN_FREE, send: 'unheld' });
    expect(turnHoldStep(tapped.hold, { kind: 'posted', from: 'doc-1', id: 'e-potion' })).toEqual(none(TURN_FREE));
  });
});
