// held.ts: a write the GM holds back under Undo, from the pick to its end. Pure.
//
// Five writes are held two seconds under a toast with Undo: an award given from Give…'s shelf (gm.js `giveFrom`), End
// story (stories.js `endStory`), a taker's Accept of an offer that asks something back, the GM's Stop of an offer and
// the GM's Remove of a line of the party stash (trade.js). Before, each lived only as a closure in ui.js's toast list: End story tapped twice held
// two ends of one run, and Undo on one left the other to end the story (SMX-gates-5.3a). Now each held write is a value
// of this machine, under its key (`heldKey`: what it writes and to what), and ui.js keeps it with its toast and steps it
// only through `heldStep`. A second pick of a write already held is refused, so one run holds one end.
//
// A held write runs only when its own window ends, its Undo is tapped, or the page is hidden: newer toasts do not push
// it off (SMX-gates-5.1, the owner, Nov 22: "the undo sticks around after I mess with the other notifications until its
// duration is done"). Before, two newer toasts wrote it at once (an event `crowded`, gone).
// One row waits on a unit written, not built (notes-9-rulings-1122.md, ruling 20):
// - `absent × pick → holding` (SMX-gates-5.2): a bundle picked on the shelf is held as it is, with no edit step. Ruled
//   "every reward is editable first", the pick opens a draft (the Award form's, award.ts) and only its send is held.
import type { ItemId, OfferId, StoryRunId } from './ids.ts';

/**
 * What a held write writes, and to what: an award from the shelf (its bundle's key) to a hunter here or a player's (its id
 * or sheet key), the end of a story's run, a taker's accept of an offer that asks something back, the GM's stop of an
 * offer, or the GM's removal of a party stash line (its item id; trade.js).
 */
export type HeldWhat =
  | { readonly kind: 'give'; readonly to: string; readonly bundle: string }
  | { readonly kind: 'end'; readonly run: StoryRunId }
  | { readonly kind: 'accept' | 'stop'; readonly offer: OfferId }
  | { readonly kind: 'stashRemove'; readonly line: ItemId };
/** One key for each write: two picks of one write share it, so the second is refused while the first is held. */
export function heldKey(w: HeldWhat): string {
  switch (w.kind) {
    case 'give': return `give ${w.to} ${w.bundle}`;
    case 'end': return `end ${w.run}`;
    case 'accept': case 'stop': return `${w.kind} ${w.offer}`;
    case 'stashRemove': return `stashRemove ${w.line}`;
  }
}

export const HELD_STATES = ['absent', 'holding', 'committed', 'undone'] as const;
/** A held write: none under its key; held until `until` (ms on the page's clock) under its toast's Undo; written; dropped by Undo. */
export type HeldWrite = { readonly at: 'absent' } | { readonly at: 'holding'; readonly until: number } | { readonly at: 'committed' } | { readonly at: 'undone' };
export const HELD_EVENTS = ['pick', 'undo', 'due', 'hidden'] as const;
/**
 * The GM picked the write at `at` to hold for `ms` (a bundle on the shelf, End story); tapped Undo; its own window ran
 * out; the page was hidden or left (the write is made before it goes).
 */
export type HeldEvent =
  | { readonly type: 'pick'; readonly at: number; readonly ms: number }
  | { readonly type: 'undo' } | { readonly type: 'due' } | { readonly type: 'hidden' };

const COMMITTED: HeldWrite = { at: 'committed' }, UNDONE: HeldWrite = { at: 'undone' };
type HeldFn<E extends HeldEvent['type']> = (h: HeldWrite, e: Extract<HeldEvent, { type: E }>) => HeldWrite;
/** Every state against every event; null: refused, nothing changes. Written and undone are ends: the write leaves the list. */
const HELD_TABLE: { readonly [S in HeldWrite['at']]: { readonly [E in HeldEvent['type']]: HeldFn<E> | null } } = {
  // ruling SMX-gates-5.2 waits: a shelf's bundle is held as picked, with no edit step
  absent: { pick: (_h, e) => ({ at: 'holding', until: e.at + e.ms }), undo: null, due: null, hidden: null },
  // a second pick of the same write is refused (5.3a)
  holding: { pick: null, undo: () => UNDONE, due: () => COMMITTED, hidden: () => COMMITTED },
  committed: { pick: null, undo: null, due: null, hidden: null },
  undone: { pick: null, undo: null, due: null, hidden: null },
};
/** `h` after `e`, or null where the table refuses it. */
export function heldStep(h: HeldWrite, e: HeldEvent): HeldWrite | null {
  const step = HELD_TABLE[h.at][e.type] as HeldFn<HeldEvent['type']> | null;
  return step ? step(h, e) : null;
}
/** No write held under a key. */
export const NOT_HELD: HeldWrite = { at: 'absent' };
