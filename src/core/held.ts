// held.ts: a write the GM holds back under Undo, from the pick to its end. Pure.
//
// Two writes are held two seconds under a toast with Undo: an award given from Give…'s shelf (gm.js `giveFrom`) and End
// story (stories.js `endStory`). Before, each lived only as a closure in ui.js's toast list: End story tapped twice held
// two ends of one run, and Undo on one left the other to end the story (SMX-gates-5.3a). Now each held write is a value
// of this machine, under its key (`heldKey`: what it writes and to what), and ui.js keeps it with its toast and steps it
// only through `heldStep`. A second pick of a write already held is refused, so one run holds one end.
//
// Two rows wait on the owner's rulings and are built as the app behaves today:
// - `absent × pick → holding` (SMX-gates-5.2): a bundle picked on the shelf is held as it is, with no edit step. Ruled
//   "every reward is editable first", the pick opens a draft (the Award form's, award.ts) and only its send is held.
// - `holding × crowded → committed` (SMX-gates-5.1): two newer toasts push a held one off and write it at once. Ruled
//   "a held write runs only when its own window ends", the row becomes `crowded: h => h`, and ui.js keeps a held toast
//   where plain ones cannot push it off.
import type { StoryRunId } from './ids.ts';

/** What a held write writes, and to what: an award from the shelf (its bundle's key) to a hunter here or a player's (its id or sheet key), or the end of a story's run. */
export type HeldWhat = { readonly kind: 'give'; readonly to: string; readonly bundle: string } | { readonly kind: 'end'; readonly run: StoryRunId };
/** One key for each write: two picks of one write share it, so the second is refused while the first is held. */
export const heldKey = (w: HeldWhat): string => (w.kind === 'give' ? `give ${w.to} ${w.bundle}` : `end ${w.run}`);

export const HELD_STATES = ['absent', 'holding', 'committed', 'undone'] as const;
/** A held write: none under its key; held until `until` (ms on the page's clock) under its toast's Undo; written; dropped by Undo. */
export type HeldWrite = { readonly at: 'absent' } | { readonly at: 'holding'; readonly until: number } | { readonly at: 'committed' } | { readonly at: 'undone' };
export const HELD_EVENTS = ['pick', 'undo', 'due', 'crowded', 'hidden'] as const;
/**
 * The GM picked the write at `at` to hold for `ms` (a bundle on the shelf, End story); tapped Undo; its own window ran
 * out; two newer toasts pushed its toast off the screen; the page was hidden or left (the write is made before it goes).
 */
export type HeldEvent =
  | { readonly type: 'pick'; readonly at: number; readonly ms: number }
  | { readonly type: 'undo' } | { readonly type: 'due' } | { readonly type: 'crowded' } | { readonly type: 'hidden' };

const COMMITTED: HeldWrite = { at: 'committed' }, UNDONE: HeldWrite = { at: 'undone' };
type HeldFn<E extends HeldEvent['type']> = (h: HeldWrite, e: Extract<HeldEvent, { type: E }>) => HeldWrite;
/** Every state against every event; null: refused, nothing changes. Written and undone are ends: the write leaves the list. */
const HELD_TABLE: { readonly [S in HeldWrite['at']]: { readonly [E in HeldEvent['type']]: HeldFn<E> | null } } = {
  // ruling SMX-gates-5.2 waits: a shelf's bundle is held as picked, with no edit step
  absent: { pick: (_h, e) => ({ at: 'holding', until: e.at + e.ms }), undo: null, due: null, crowded: null, hidden: null },
  // ruling SMX-gates-5.1 waits: `crowded` writes it today; a second pick of the same write is refused (5.3a)
  holding: { pick: null, undo: () => UNDONE, due: () => COMMITTED, crowded: () => COMMITTED, hidden: () => COMMITTED },
  committed: { pick: null, undo: null, due: null, crowded: null, hidden: null },
  undone: { pick: null, undo: null, due: null, crowded: null, hidden: null },
};
/** `h` after `e`, or null where the table refuses it. */
export function heldStep(h: HeldWrite, e: HeldEvent): HeldWrite | null {
  const step = HELD_TABLE[h.at][e.type] as HeldFn<HeldEvent['type']> | null;
  return step ? step(h, e) : null;
}
/** No write held under a key. */
export const NOT_HELD: HeldWrite = { at: 'absent' };
