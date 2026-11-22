// hold.ts: a player's turn held on this phone while its last command waits (audit SMX-views-5). The GM's phone takes one
// command of a player at each `now` of the fight (`onTurn`, src/core/protocol.ts), so a second tap before the GM's
// answer would be turned down: from the tap until the GM's phone publishes a fight doc after it, the turn's buttons are
// off. The hold is `free`; `picking`, a command tapped and not posted yet (a use's target window is open, or its post has
// not answered); or `sent` from the doc at `from` as the outbox entry `id`. A sent command lets go when a doc of another
// `at` arrives (the GM's phone answered it), when the room refuses it, when a full outbox drops it, or when the phone
// leaves the room. src/views/uses.js keeps the one value and moves it only through `turnHoldStep`; every command of the
// turn, from the table, the Skills panel or the Bag, goes through it (`app.api.uses.command`). Pure.

/** The turn on this phone: free to act, a command being picked or posted, or a command sent and not answered. */
export type TurnHold =
  | { readonly at: 'free' }
  | { readonly at: 'picking' }
  | { readonly at: 'sent'; readonly from: string; readonly id: string };
export type TurnHoldState = TurnHold['at'];
export const TURN_HOLD_STATES = ['free', 'picking', 'sent'] as const satisfies readonly TurnHoldState[];
/** Nothing waits: a page opens with its turn free. */
export const TURN_FREE: TurnHold = { at: 'free' };
const PICKING: TurnHold = { at: 'picking' };

/** How a tapped command came: `turn` for a step, a use, End turn or a Release; `bag` for a consumable's use (inventory.js `use`). Both are held alike (SMX-views-5.1). */
export type TurnHoldVia = 'turn' | 'bag';
/**
 * What moves the hold. `tap`: a command of the turn tapped, from the table, the Skills panel or the Bag, `via` as it came. `posted`: the command tapped went to the outbox
 * as entry `id`, while the doc at `from` was the latest. `unposted`: nothing was posted (the window cancelled, nobody in
 * reach, not the hunter's turn by then, no room). `doc`: a fight doc at `at` arrived. `refused`, `dropped`: the outbox
 * entry `id` was refused by the room, or let go by a full outbox (src/core/sync/outbox.ts). `left`: the phone's room
 * changed.
 */
export type TurnHoldEvent =
  | { readonly kind: 'tap'; readonly via: TurnHoldVia }
  | { readonly kind: 'posted'; readonly from: string; readonly id: string }
  | { readonly kind: 'unposted' }
  | { readonly kind: 'doc'; readonly at: string }
  | { readonly kind: 'refused'; readonly id: string }
  | { readonly kind: 'dropped'; readonly id: string }
  | { readonly kind: 'left' };
export type TurnHoldEventKind = TurnHoldEvent['kind'];
export const TURN_HOLD_EVENTS = ['tap', 'posted', 'unposted', 'doc', 'refused', 'dropped', 'left'] as const satisfies readonly TurnHoldEventKind[];

/**
 * How a tap's command goes out: `held`, posted under the hold, its answer fed back as `posted` or `unposted`; `none`, not
 * sent (the hold is not free). Every other event sends nothing.
 */
export type TurnHoldSend = 'held' | 'none';
export type TurnHoldMoved = { readonly hold: TurnHold; readonly send: TurnHoldSend };

/** A move that sends nothing. */
const to = (hold: TurnHold): TurnHoldMoved => ({ hold, send: 'none' });
/** A sent command lets go once its entry `id` is the one the outbox speaks of. */
const lost = (s: Extract<TurnHold, { at: 'sent' }>, e: { readonly id: string }): TurnHoldMoved => (e.id === s.id ? to(TURN_FREE) : to(s));

type Cell<S extends TurnHoldState, K extends TurnHoldEventKind> = (s: Extract<TurnHold, { at: S }>, e: Extract<TurnHoldEvent, { kind: K }>) => TurnHoldMoved;
/** What each event does in each state; a cell that answers its state with `none` is a move that changes nothing. */
const TABLE: { readonly [S in TurnHoldState]: { readonly [K in TurnHoldEventKind]: Cell<S, K> } } = {
  free: {
    // SMX-views-5.1: a consumable from the Bag is held like any use (the owner, Nov 22: "Not a full turn, but should cost
    // something"). Its use costs `fight.consumableTime` and ends the turn in the GM's fight, as every use does, so the
    // turn's buttons wait on the GM's answer; the hunter's next turn comes after half a standard action.
    tap: () => ({ hold: PICKING, send: 'held' }),
    // the answer of a command the hold does not wait on: one tapped before the phone left its room
    posted: s => to(s),
    unposted: s => to(s),
    doc: s => to(s),
    refused: s => to(s),
    dropped: s => to(s),
    left: s => to(s),
  },
  picking: {
    tap: s => to(s),
    posted: (_, e) => to({ at: 'sent', from: e.from, id: e.id }),
    unposted: () => to(TURN_FREE),
    // the window stays open over a doc that changes: the post reads the doc it is made at
    doc: s => to(s),
    refused: s => to(s),
    dropped: s => to(s),
    left: () => to(TURN_FREE),
  },
  sent: {
    tap: s => to(s),
    posted: s => to(s),
    unposted: s => to(s),
    // each poll parses the doc again, so a doc is told by its `at`: the same `at` is the doc the command was sent from
    doc: (s, e) => (e.at !== s.from ? to(TURN_FREE) : to(s)),
    refused: lost,
    // a full outbox let the command go, so the GM's phone never answers it (SMX-views-5.1)
    dropped: lost,
    left: () => to(TURN_FREE),
  },
};

/** The hold after `e`, and how a tapped command goes out; the same hold with `none` when `e` changes nothing. */
export function turnHoldStep(s: TurnHold, e: TurnHoldEvent): TurnHoldMoved {
  // The table's type pairs each state's row with the cells for that state, so the cell for `e.kind` takes `s` and `e`.
  const row = TABLE[s.at] as { readonly [K in TurnHoldEventKind]: (s: TurnHold, e: TurnHoldEvent) => TurnHoldMoved };
  return row[e.kind](s, e);
}
