// size.ts: how large one item, one status and one ability may be, in bytes, wherever it is read. Pure.
// The bounds of an item's fields multiply (six tiers an amount, 12 ops a def, defs three deep under a status) to
// gigabytes, so no count of fields bounds a thing (notes-5-trade.md 12.4). One size each does: the reader of each
// refuses a thing past it whole (registry/items.ts `parseItem`, combat/fight-parse.ts `parseStatusDef` and
// `parseAbility`), and a maker shows `tooLarge`'s words before it saves. What carries a thing is sized from these: an
// offer (trade/goods.ts `OFFER_MAX`), a sheet, a doc. notes-5-trade.md 12.8 and 12.9 have the measurement.

/** The size of a value on the wire: its JSON's bytes in UTF-8, which is how the server bounds a request's body. */
export const bytesOf = (v: unknown): number => new TextEncoder().encode(JSON.stringify(v)).length;

/**
 * The most bytes each holds, as its reader gives it back.
 * - `item`, 7 KiB: the largest whole KiB at which an offer of 8 items (`GOODS_LINES`) fits the server's 64 KiB body.
 *   The largest item the app ships is 502 bytes (The Punchline). Its powers (registry/powers.ts, a worn status and an
 *   active) are inside it: the largest status and ability the app ships together are under 3 KiB. It does not grow by
 *   an ability's size (item-stats 6.1 said so): 8 items of 15 KiB are past the body, and the offer's lines would shrink.
 * - `status`, 5 KiB: four times the largest status def the app ships (Resonance, 1,035 bytes), up to a KiB. An item can
 *   hold one at the cap as its worn status and keep 2 KiB of its own.
 * - `ability`, 8 KiB: four times the largest ability the app ships (Fester, 1,804 bytes), up to a KiB.
 */
export const THING_MAX = { item: 7168, status: 5120, ability: 8192 } as const;
export type SizedThing = keyof typeof THING_MAX;

/** Whether a thing a reader gave back is within its size. */
export const withinSize = (kind: SizedThing, thing: unknown): boolean => bytesOf(thing) <= THING_MAX[kind];

const WORDS: { readonly [K in SizedThing]: { readonly it: string; readonly holds: string; readonly way: string } } = {
  item: { it: 'This item', holds: 'an item', way: 'Remove an effect, or make its worn status smaller.' },
  status: { it: 'This status', holds: 'a status', way: 'Remove an effect, or one of the things that happen when it stacks, triggers or ends.' },
  ability: { it: 'This skill\'s ability', holds: 'an ability', way: 'Remove an effect.' },
};
const count = (n: number): string => n.toLocaleString('en-US');
/** Why a thing is too large to keep, in the words a maker shows, or null when it fits. */
export function tooLarge(kind: SizedThing, thing: unknown): string | null {
  const size = bytesOf(thing), w = WORDS[kind];
  return size <= THING_MAX[kind] ? null : `${w.it} is too large to save. It takes ${count(size)} bytes, and ${w.holds} holds at most ${count(THING_MAX[kind])}. ${w.way}`;
}
