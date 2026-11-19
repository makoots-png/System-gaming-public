// An offer between two hunters (src/core/trade/offer.ts) and each phone's record of it, with every event of their lives,
// walked by the state charts (scripts/charts/trade.ts); tests/statecharts.test.ts checks each walk reaches every state.
// tests/offer.test.ts checks every cell and walks two players and the GM against a room.
import { outcomeOf, recordStep } from '../../src/core/trade/offer.ts';
import type { Offer, OfferClose, OfferEnd, OfferOutcome, OfferRecord, RecordEvent } from '../../src/core/trade/offer.ts';
import { parseOfferId, sheetKeyOf } from '../../src/core/ids.ts';
import type { Goods } from '../../src/core/trade/goods.ts';
import { dev, hid, iid, room } from '../fixtures/ids.ts';

const BY = sheetKeyOf(dev('d-brakk'), hid('h1')), TO = sheetKeyOf(dev('d-mira'), hid('h1')), THIRD = sheetKeyOf(dev('d-third'), hid('h1'));
const POTION: Goods = { gold: 0, items: [{ from: iid('i2'), item: { name: 'Healing Potion', rar: 'common', type: 'consumable', slot: null, qty: 1, dice: '', bonus: {}, desc: '', armor: 0, resist: 0 } }] };
const PAID: Goods = { gold: 20, items: [] };
/** Brakk offers Mira a Healing Potion for 20 gold. */
export const OFFER: Offer = { id: parseOfferId('d-brakk-mo1')!, room: room('TRADE2'), at: '2026-11-19T12:00:00.000Z', by: BY, to: TO, names: { by: 'Brakk', to: 'Mira' }, gives: POTION, asks: { gold: 20, items: [] } };

// ── the offer in the room ──
/** The room's view of an offer: none yet, open, or the outcome of its one end. */
export type RoomWorld = { readonly at: 'none' | 'open' } | { readonly at: OfferOutcome };
export type RoomEvent = { readonly type: 'offer' } | { readonly type: 'end'; readonly end: OfferEnd };
/** The offer, and one of each kind of end: an accept that fits, one that does not, a refuse, a take back, a stop. */
export const ROOM_EVENTS: readonly RoomEvent[] = [
  { type: 'offer' },
  { type: 'end', end: { how: 'accept', by: TO, gives: PAID } }, { type: 'end', end: { how: 'accept', by: THIRD, gives: PAID } },
  { type: 'end', end: { how: 'refuse', by: TO } }, { type: 'end', end: { how: 'withdraw', by: BY } }, { type: 'end', end: { how: 'stop' } },
];
export const ROOM_START: RoomWorld = { at: 'none' };
/** The room after `e`: an offer opens; the first end decides by `outcomeOf`; any later one finds an end state (the room keeps one end id). */
export function roomStep(w: RoomWorld, e: RoomEvent): RoomWorld {
  if (w.at === 'none') return e.type === 'offer' ? { at: 'open' } : w;
  if (w.at === 'open' && e.type === 'end') return { at: outcomeOf(OFFER, e.end) };
  return w;
}

// ── each phone's record ──
/** A record, or the close it ended with. */
export type RecordWorld = OfferRecord | { readonly closed: OfferClose };
/** A tap, what the box heard, one of each end, the room gone. */
export const RECORD_EVENTS: readonly RecordEvent[] = [
  { type: 'takeBack' }, { type: 'accept', aside: PAID }, { type: 'refuse' }, { type: 'stop' }, { type: 'tried' }, { type: 'taken' }, { type: 'unsent' },
  ...ROOM_EVENTS.flatMap(e => (e.type === 'end' ? [{ type: 'end', end: e.end } as const] : [])), { type: 'roomGone' },
];
export const GIVER_START: RecordWorld = { side: 'giver', offer: OFFER, hid: hid('h1'), aside: POTION, state: 'posting-queued' };
export const TAKER_START: RecordWorld = { side: 'taker', offer: OFFER, hid: hid('h1'), state: 'offered' };
export const WATCH_START: RecordWorld = { side: 'gm', offer: OFFER, state: 'open' };
/** A record after `e` (`recordStep`): the next record, the close, or itself. */
export function recordWalkStep(w: RecordWorld, e: RecordEvent): RecordWorld {
  if ('closed' in w) return w;
  const out = recordStep(w, e);
  return out.kind === 'same' ? w : out.kind === 'next' ? out.record : { closed: out.close };
}
/** What makes two record worlds one state: the row, or the close. */
export const recordKey = (w: RecordWorld): string => ('closed' in w ? `closed ${w.closed}` : `${w.side} ${w.state}`);
