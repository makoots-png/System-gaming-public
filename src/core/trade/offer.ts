// offer.ts: an offer between two hunters of a room, its one end, and each phone's record of it. Pure; the save holds the
// records (`settings.sync.offers`). Design: docs/agent-handoff/features/notes-5-trade.md sections 1.4 to 1.10 and 12.1.
//
// A trade moves goods out of hunter A (on phone A) into hunter B (on phone B), and for an exchange the other way too. No
// one write can change both, so both-or-neither comes from one decision both phones read: the offer's one end. Every end
// of offer X (the taker's accept or refuse, the giver's take back, the GM's stop) carries the event id `endIdOf(X)`, and
// the room keeps the first event of an id and answers any later one with its seq (server.ts `addEvent`). `outcomeOf` is a
// pure function of the offer and that end, so both phones come to the same outcome.
//
// Each side's goods wait aside in its own record from the tap's write (`setAside`, goods.ts) until its phone reads the end:
// settled drops them and gains the other side's, any other outcome gives them back. So a unit of goods is always in exactly
// one place: a bag, an aside, or a message in the room. Each record is a machine over what its phone knows (`GIVER`,
// `TAKER`, `WATCH`: every cell), stepped by its taps, by what the outbox heard of its letter (`tried`, `taken`, `unsent`),
// by the end read from a page (`offersSeen`), and by the room gone. An ended record leaves the save in the write that moves
// its goods, so a second read of the same end finds nothing to move.
import { endEvent, newEvent, parseEvent } from '../protocol.ts';
import type { EventStamp, OfferPayload, RoomEvent, StoredEvent } from '../protocol.ts';
import { deviceOf, endIdOf, hunterIdOf, parseOfferId, parseRoomCode, parseSaveId, saveId, sheetKeyOf } from '../ids.ts';
import type { HunterId, ItemId, OfferId, RoomCode, SheetKey } from '../ids.ts';
import { atOutbox, post, step as boxStep } from '../sync/outbox.ts';
import type { Outbox } from '../sync/outbox.ts';
import { refuse } from '../save-step.ts';
import type { Refused } from '../save-step.ts';
import type { Save } from '../save.ts';
import { timeOf } from '../day.ts';
import { oneOf } from '../one-of.ts';
import { NO_GOODS, OFFERS_OPEN, fits, goodsWords, noGoods, parseBagPick, parseGoods, pickWords, received, setAside } from './goods.ts';
import type { BagPick, Goods, OfferRefusal, Shortfall } from './goods.ts';

// ── the offer and its one end ──
/** An offer as a phone keeps it: the `offer` message's fields, its room, and when it was made (the giver) or stored (the others). */
export type Offer = {
  readonly id: OfferId; readonly room: RoomCode; readonly at: string; readonly by: SheetKey; readonly to: SheetKey;
  /** The names the giving phone showed, for the words on the other phones and the GM's log. */
  readonly names: { readonly by: string; readonly to: string };
  readonly gives: Goods; readonly asks: BagPick;
};
/** An offer's end as the room holds it: a hunter's accept (with the asked goods), refuse or take back, or the GM's stop. */
export type OfferEnd =
  | { readonly how: 'accept'; readonly by: SheetKey; readonly gives: Goods }
  | { readonly how: 'refuse' | 'withdraw'; readonly by: SheetKey }
  | { readonly how: 'stop' };
export const OFFER_OUTCOMES = ['settled', 'refused', 'withdrawn', 'stopped', 'void'] as const;
/** How an offer came out. Every outcome but settled sends each side's goods back. */
export type OfferOutcome = (typeof OFFER_OUTCOMES)[number];
/**
 * The one rule every phone reads: how offer `o` came out, given its one end. An accept by its taker that carries exactly
 * the asked goods settles it; a refuse by its taker refuses it; a take back by its giver withdraws it; the GM's stop (only
 * the GM key may post one, `gmOnly`) stops it. Anything else (an accept by another hunter, or carrying other goods) is
 * void: it uses the offer's one end and moves nothing.
 */
export function outcomeOf(o: Offer, e: OfferEnd): OfferOutcome {
  switch (e.how) {
    case 'accept': return e.by === o.to && fits(o.asks, e.gives) ? 'settled' : 'void';
    case 'refuse': return e.by === o.to ? 'refused' : 'void';
    case 'withdraw': return e.by === o.by ? 'withdrawn' : 'void';
    case 'stop': return 'stopped';
  }
}
/** The end an `offerEnd` or `offerStop` event carries; null for any other event. */
export function endOf(ev: RoomEvent): OfferEnd | null {
  if (ev.type === 'offerStop') return { how: 'stop' };
  if (ev.type !== 'offerEnd') return null;
  const p = ev.payload;
  return p.how === 'accept' ? { how: 'accept', by: p.by, gives: p.gives } : { how: p.how, by: p.by };
}
/** The offer an `offer` message makes in room `room`, stored at `at`; null when its id is not an offer's. */
export function offerOf(p: OfferPayload, room: RoomCode, at: string): Offer | null {
  const id = parseOfferId(p.eid);
  return id && { id, room, at, by: p.by, to: p.to[0], names: p.names, gives: p.gives, asks: p.asks };
}

// ── each phone's record: the states, the events, the tables ──
/** The giver's side, one stored state a row: its offer's letter in the box (never sent, sent once), the room has it, its take back's letter (never sent, sent, taken), the room gone. */
export const GIVER_ROWS = ['posting-queued', 'posting-tried', 'open', 'withdrawing-queued', 'withdrawing-tried', 'withdrawing-taken', 'stranded'] as const;
export type GiverRow = (typeof GIVER_ROWS)[number];
/** The taker's rows that hold nothing aside: offered, and its refuse's letter (never sent, sent, taken). */
export const TAKER_BARE = ['offered', 'refusing-queued', 'refusing-tried', 'refusing-taken'] as const;
/** The taker's rows that hold the asked goods aside: its accept's letter (never sent, sent, taken), and the room gone after a send. */
export const TAKER_HOLDING = ['accepting-queued', 'accepting-tried', 'accepting-taken', 'stranded'] as const;
export const TAKER_ROWS = [...TAKER_BARE, ...TAKER_HOLDING] as const;
export type TakerBare = (typeof TAKER_BARE)[number];
export type TakerHolding = (typeof TAKER_HOLDING)[number];
export type TakerRow = TakerBare | TakerHolding;
/** The GM's phone's record of an offer: open, or its stop's letter (never sent, sent, taken). It holds no goods. */
export const WATCH_ROWS = ['open', 'stopping-queued', 'stopping-tried', 'stopping-taken'] as const;
export type WatchRow = (typeof WATCH_ROWS)[number];

/** A phone's record of one offer: the giver's (with its goods aside), the taker's (with the asked goods aside while it holds them), or the GM's. */
export type OfferRecord =
  | { readonly side: 'giver'; readonly offer: Offer; readonly hid: HunterId; readonly aside: Goods; readonly state: GiverRow }
  | { readonly side: 'taker'; readonly offer: Offer; readonly hid: HunterId; readonly state: TakerBare }
  | { readonly side: 'taker'; readonly offer: Offer; readonly hid: HunterId; readonly state: TakerHolding; readonly aside: Goods }
  | { readonly side: 'gm'; readonly offer: Offer; readonly state: WatchRow };

export const RECORD_EVENTS = ['takeBack', 'accept', 'refuse', 'stop', 'tried', 'taken', 'unsent', 'end', 'roomGone'] as const;
/**
 * What happens to a record. Taps: the giver's or a stranded taker's Take back, the taker's Accept (with the asked goods it
 * set aside) and Refuse, the GM's Stop. What the outbox heard of the record's current letter (`tried`: it left once;
 * `taken`: the room has it; `unsent`: it is no longer queued or on its way and was never sent). The offer's one end read
 * from the room. The room gone (the link's `gone`).
 */
export type RecordEvent =
  | { readonly type: 'takeBack' | 'refuse' | 'stop' | 'tried' | 'taken' | 'unsent' | 'roomGone' }
  | { readonly type: 'accept'; readonly aside: Goods }
  | { readonly type: 'end'; readonly end: OfferEnd };
export const GIVER_EVENTS = ['takeBack', 'tried', 'taken', 'unsent', 'end', 'roomGone'] as const;
export const TAKER_EVENTS = ['accept', 'refuse', 'takeBack', 'tried', 'taken', 'unsent', 'end', 'roomGone'] as const;
export const WATCH_EVENTS = ['stop', 'tried', 'taken', 'unsent', 'end', 'roomGone'] as const;
/**
 * A cell that ends the record: `end`, by the end's outcome (`outcomeOf`); `recalled`, taken back before its letter was ever
 * sent; `unsent`, its letter let go before a send; `gone`, the room closed; `reclaimed`, a stranded record taken back.
 */
export const CLOSE_CELLS = ['end', 'recalled', 'unsent', 'gone', 'reclaimed'] as const;
type CloseCell = (typeof CLOSE_CELLS)[number];
/** Why a record ended: the end's outcome, or a close that needed no end. Every one but settled gives the record's aside back. */
export type OfferClose = OfferOutcome | Exclude<CloseCell, 'end'>;
/** A record's next row, a close, or null where the event does not apply. */
type Cell<R extends string> = R | CloseCell | null;

/** The giver (notes-5-trade.md 1.6, its table with Take back in one column, 12.1). */
export const GIVER: { readonly [R in GiverRow]: { readonly [E in (typeof GIVER_EVENTS)[number]]: Cell<GiverRow> } } = {
  'posting-queued': { takeBack: 'recalled', tried: 'posting-tried', taken: 'open', unsent: 'unsent', end: null, roomGone: 'gone' },
  // sent once: the room may have it, so a refused or let go letter changes nothing; Take back races any accept for the one end
  'posting-tried': { takeBack: 'withdrawing-queued', tried: null, taken: 'open', unsent: null, end: 'end', roomGone: 'stranded' },
  open: { takeBack: 'withdrawing-queued', tried: null, taken: null, unsent: null, end: 'end', roomGone: 'stranded' },
  // a withdraw let go: the room may still hold it as the end, and Take back may post the same id again
  'withdrawing-queued': { takeBack: null, tried: 'withdrawing-tried', taken: 'withdrawing-taken', unsent: 'open', end: 'end', roomGone: 'stranded' },
  'withdrawing-tried': { takeBack: null, tried: null, taken: 'withdrawing-taken', unsent: 'open', end: 'end', roomGone: 'stranded' },
  'withdrawing-taken': { takeBack: null, tried: null, taken: null, unsent: null, end: 'end', roomGone: 'stranded' },
  stranded: { takeBack: 'reclaimed', tried: null, taken: null, unsent: null, end: 'end', roomGone: null },
};
/** The taker. An accept cannot be taken back: it may already be the end; Stop or the giver's Take back ends a stuck one. */
export const TAKER: { readonly [R in TakerRow]: { readonly [E in (typeof TAKER_EVENTS)[number]]: Cell<TakerRow> } } = {
  offered: { accept: 'accepting-queued', refuse: 'refusing-queued', takeBack: null, tried: null, taken: null, unsent: null, end: 'end', roomGone: 'gone' },
  // never sent and let go: back to offered, the asked goods back (offered holds none)
  'accepting-queued': { accept: null, refuse: null, takeBack: null, tried: 'accepting-tried', taken: 'accepting-taken', unsent: 'offered', end: 'end', roomGone: 'gone' },
  'accepting-tried': { accept: null, refuse: null, takeBack: null, tried: null, taken: 'accepting-taken', unsent: null, end: 'end', roomGone: 'stranded' },
  'accepting-taken': { accept: null, refuse: null, takeBack: null, tried: null, taken: null, unsent: null, end: 'end', roomGone: 'stranded' },
  'refusing-queued': { accept: null, refuse: null, takeBack: null, tried: 'refusing-tried', taken: 'refusing-taken', unsent: 'offered', end: 'end', roomGone: 'gone' },
  'refusing-tried': { accept: null, refuse: null, takeBack: null, tried: null, taken: 'refusing-taken', unsent: null, end: 'end', roomGone: 'gone' },
  'refusing-taken': { accept: null, refuse: null, takeBack: null, tried: null, taken: null, unsent: null, end: 'end', roomGone: 'gone' },
  stranded: { accept: null, refuse: null, takeBack: 'reclaimed', tried: null, taken: null, unsent: null, end: 'end', roomGone: null },
};
/** The GM's phone: every offer it reads, to show and stop. */
export const WATCH: { readonly [R in WatchRow]: { readonly [E in (typeof WATCH_EVENTS)[number]]: Cell<WatchRow> } } = {
  open: { stop: 'stopping-queued', tried: null, taken: null, unsent: null, end: 'end', roomGone: 'gone' },
  'stopping-queued': { stop: null, tried: 'stopping-tried', taken: 'stopping-taken', unsent: 'open', end: 'end', roomGone: 'gone' },
  'stopping-tried': { stop: null, tried: null, taken: 'stopping-taken', unsent: 'open', end: 'end', roomGone: 'gone' },
  'stopping-taken': { stop: null, tried: null, taken: null, unsent: null, end: 'end', roomGone: 'gone' },
};

/** A record's letter in the outbox, and how far its phone heard it go: queued (never sent), tried (sent once), taken (the room has it). */
type Letter = { readonly of: 'offer' | 'end'; readonly heard: 'queued' | 'tried' | 'taken' };
const GIVER_LETTER: { readonly [R in GiverRow]: Letter | null } = {
  'posting-queued': { of: 'offer', heard: 'queued' }, 'posting-tried': { of: 'offer', heard: 'tried' }, open: null,
  'withdrawing-queued': { of: 'end', heard: 'queued' }, 'withdrawing-tried': { of: 'end', heard: 'tried' }, 'withdrawing-taken': { of: 'end', heard: 'taken' }, stranded: null,
};
const TAKER_LETTER: { readonly [R in TakerRow]: Letter | null } = {
  offered: null, stranded: null,
  'accepting-queued': { of: 'end', heard: 'queued' }, 'accepting-tried': { of: 'end', heard: 'tried' }, 'accepting-taken': { of: 'end', heard: 'taken' },
  'refusing-queued': { of: 'end', heard: 'queued' }, 'refusing-tried': { of: 'end', heard: 'tried' }, 'refusing-taken': { of: 'end', heard: 'taken' },
};
const WATCH_LETTER: { readonly [R in WatchRow]: Letter | null } = {
  open: null, 'stopping-queued': { of: 'end', heard: 'queued' }, 'stopping-tried': { of: 'end', heard: 'tried' }, 'stopping-taken': { of: 'end', heard: 'taken' },
};
const letterOf = (r: OfferRecord): Letter | null => (r.side === 'giver' ? GIVER_LETTER[r.state] : r.side === 'taker' ? TAKER_LETTER[r.state] : WATCH_LETTER[r.state]);
/** The outbox id of the letter record `r` has in flight now, or null: the offer's while posting, the end's after a tap that posts one. */
export const letterIdOf = (r: OfferRecord): string | null => { const l = letterOf(r); return l === null ? null : l.of === 'offer' ? r.offer.id : endIdOf(r.offer.id); };
/** The goods a record holds aside: the giver's, the taker's while it holds the asked goods, none on the GM's phone. */
export const asideOf = (r: OfferRecord): Goods => ('aside' in r ? r.aside : NO_GOODS);

/** What a step did: nothing; moved to a next record (with any goods it gave back); or ended the record, with what it gains and gives back. */
export type RecordStepped =
  | { readonly kind: 'same' }
  | { readonly kind: 'next'; readonly record: OfferRecord; readonly back: Goods }
  | { readonly kind: 'closed'; readonly close: OfferClose; readonly gain: Goods; readonly back: Goods };
const SAME: RecordStepped = { kind: 'same' };
const isTakerHolding = (s: TakerRow): s is TakerHolding => oneOf(s, TAKER_HOLDING, null) !== null;
const isClose = (c: string): c is CloseCell => oneOf(c, CLOSE_CELLS, null) !== null;

/** Ends record `r` by `cell`: settled drops its aside and gains the other side's goods; every other close gives its aside back. */
function closed(r: OfferRecord, cell: CloseCell, e: RecordEvent): RecordStepped {
  const close: OfferClose = cell !== 'end' ? cell : e.type === 'end' ? outcomeOf(r.offer, e.end) : 'void';
  if (close !== 'settled') return { kind: 'closed', close, gain: NO_GOODS, back: asideOf(r) };
  // the giver gains the accept's own copy of the asked goods; the taker the offer's goods, only when it had set the asked aside
  const gain = r.side === 'giver' ? (e.type === 'end' && e.end.how === 'accept' ? e.end.gives : NO_GOODS) : r.side === 'taker' && isTakerHolding(r.state) ? r.offer.gives : NO_GOODS;
  return { kind: 'closed', close, gain, back: NO_GOODS };
}
/** Record `r` after event `e`, by its side's table. */
export function recordStep(r: OfferRecord, e: RecordEvent): RecordStepped {
  if (r.side === 'giver') {
    const t = oneOf(e.type, GIVER_EVENTS, null), cell = t === null ? null : GIVER[r.state][t];
    if (cell === null) return SAME;
    return isClose(cell) ? closed(r, cell, e) : { kind: 'next', record: { ...r, state: cell }, back: NO_GOODS };
  }
  if (r.side === 'gm') {
    const t = oneOf(e.type, WATCH_EVENTS, null), cell = t === null ? null : WATCH[r.state][t];
    if (cell === null) return SAME;
    return isClose(cell) ? closed(r, cell, e) : { kind: 'next', record: { ...r, state: cell }, back: NO_GOODS };
  }
  const t = oneOf(e.type, TAKER_EVENTS, null), cell = t === null ? null : TAKER[r.state][t];
  if (cell === null) return SAME;
  if (isClose(cell)) return closed(r, cell, e);
  const row = cell, base = { side: 'taker', offer: r.offer, hid: r.hid } as const, held = asideOf(r);
  if (!isTakerHolding(row)) return { kind: 'next', record: { ...base, state: row }, back: held };
  return { kind: 'next', record: { ...base, state: row, aside: e.type === 'accept' ? e.aside : held }, back: NO_GOODS };
}

// ── the records in the save ──
/** At most this many offers to one hunter are kept; past it the oldest one only offered (it holds nothing) is let go. */
export const OFFERS_TO_KEPT = 20;
/** At most this many offers the GM's phone watches; past it the oldest open one is let go. */
export const OFFERS_WATCHED = 60;
type WithSync = Pick<Save, 'settings'>;
export const offersOf = (s: WithSync): readonly OfferRecord[] => s.settings.sync.offers ?? [];
const withOffers = <S extends WithSync>(s: S, offers: readonly OfferRecord[]): S => ({ ...s, settings: { ...s.settings, sync: { ...s.settings.sync, offers: [...offers] } } });
const boxOf = (s: WithSync): Outbox => s.settings.sync.outbox ?? [];
const sameRecord = (a: OfferRecord, b: OfferRecord): boolean => a.offer.id === b.offer.id && a.side === b.side;
/** The record of offer `id` on side `side`, if the save holds one. */
export const recordOf = (s: WithSync, id: OfferId, side: OfferRecord['side']): OfferRecord | null => offersOf(s).find(r => r.offer.id === id && r.side === side) ?? null;

/** A record that ended: what it was, why, and what moved. */
export type Closed = { readonly record: OfferRecord; readonly close: OfferClose; readonly gain: Goods; readonly back: Goods };
/** A step written to the save: the save, and the record it closed, if it closed one. */
type Written = { readonly save: Save; readonly closed: Closed | null };

/** Goods given to hunter `hid` of the save (none to a hunter no longer there), each new item id from the save's seq. */
function giveTo(save: Save, hid: HunterId, goods: Goods): Save {
  if (noGoods(goods) || !save.hunters.some(h => h.id === hid)) return save;
  let seq = save.seq;
  const ids = (): ItemId => saveId('i', ++seq);
  const hunters = save.hunters.map(h => (h.id === hid ? received(h, goods, ids) : h));
  return { ...save, seq, hunters };
}
/** The record's letters still queued in the box dropped: an ended record has nothing left to say. One on its way is left to the room. */
function lettersDropped(save: Save, id: OfferId): Save {
  const queued = boxOf(save).filter(e => (e.id === id || e.id === endIdOf(id)) && e.at === 'queued');
  return queued.length ? atOutbox(box => queued.reduce((b, e) => boxStep(b, e.id, { type: 'drop' }), box))(save) : save;
}
/**
 * Letter `ev` for room `room` in the box. A refused letter of the same id is put away first: a tap that posts an end again
 * (Take back or Stop after its letter was refused) means it, and the box keeps one entry per id, so the old refusal would
 * keep the new letter out and the record would read it as let go at once.
 */
function posted(save: Save, room: RoomCode, ev: RoomEvent): Save {
  const id = ev.payload.eid;
  return atOutbox(box => post(box.find(e => e.id === id)?.at === 'refused' ? boxStep(box, id, { type: 'drop' }) : box, room, { kind: 'event', event: ev }).box)(save);
}
/** What `stepped` does to the save for record `r`: the record replaced or taken out, its goods moved, an ended record's letters dropped. */
function written(save: Save, r: OfferRecord, stepped: RecordStepped): Written {
  if (stepped.kind === 'same') return { save, closed: null };
  const hid = r.side === 'gm' ? null : r.hid;
  if (stepped.kind === 'next') {
    const s = withOffers(save, offersOf(save).map(x => (sameRecord(x, r) ? stepped.record : x)));
    return { save: hid === null ? s : giveTo(s, hid, stepped.back), closed: null };
  }
  let s = withOffers(save, offersOf(save).filter(x => !sameRecord(x, r)));
  if (hid !== null) s = giveTo(giveTo(s, hid, stepped.gain), hid, stepped.back);
  return { save: lettersDropped(s, r.offer.id), closed: { record: r, close: stepped.close, gain: stepped.gain, back: stepped.back } };
}
/** Record `r` of the save after `e`, written. */
const stepIn = (save: Save, r: OfferRecord, e: RecordEvent): Written => written(save, r, recordStep(r, e));

// ── the taps: each one write of the hunter, the record and the letter (notes-5-trade.md 1.7) ──
/** A refused tap: its kind, and how short it fell where it names a thing (goods.ts `refusalWords`). */
export type TapRefused = Refused<OfferRefusal> & { readonly short?: Shortfall };
/** What the caller knows that the save does not: the table's trading switch (`RULES.trade`, unit 4), and whether a fight holds the hunter (`fightHold`). */
export type TapGate = { readonly on: boolean; readonly held: boolean };

/**
 * Hunter `hid` offers the room's hunter `to` (named `toName` on this phone) the goods `gives`, asking `asks` back: the goods
 * set aside, the giver's record (posting, never sent) and the `offer` letter in the box, one write. Refused out of a room
 * (`no-room`), for a hunter this phone does not play there (`not-played`), with trading off (`off`), while a fight holds it
 * (`fight`), past `OFFERS_OPEN` open offers (`too-many`), to itself (`same-hunter`), for goods `setAside` refuses, or past
 * `OFFER_MAX` bytes (`too-large`).
 */
export function offerPosted(save: Save, a: {
  readonly hid: HunterId; readonly to: SheetKey; readonly toName: string; readonly gives: BagPick; readonly asks: BagPick; readonly at: string; readonly stamp: EventStamp;
} & TapGate): Save | TapRefused {
  const room = save.settings.sync.room, h = save.hunters.find(x => x.id === a.hid);
  if (!room) return refuse('no-room');
  if (!h) return refuse('no-hunter');
  if (save.settings.sync.boundHunterId !== a.hid) return refuse('not-played');
  if (!a.on) return refuse('off');
  if (a.held) return refuse('fight');
  const by = sheetKeyOf(save.settings.deviceId, a.hid);
  if (a.to === by) return refuse('same-hunter');
  if (offersOf(save).filter(r => r.side === 'giver' && r.hid === a.hid).length >= OFFERS_OPEN) return refuse('too-many');
  const aside = setAside(h, a.gives);
  if ('ok' in aside) return aside;
  const ev = newEvent('offer', { by, to: [a.to], names: { by: h.name, to: a.toName }, gives: aside.goods, asks: a.asks }, a.stamp);
  const offer = ev?.type === 'offer' ? offerOf(ev.payload, room, a.at) : null;
  if (!ev || !offer) return refuse('too-large');
  const record: OfferRecord = { side: 'giver', offer, hid: a.hid, aside: offer.gives, state: 'posting-queued' };
  const s = withOffers({ ...save, hunters: save.hunters.map(x => (x.id === a.hid ? aside.hunter : x)) }, [...offersOf(save), record]);
  return posted(s, room, ev);
}

/**
 * This phone's hunter answers offer `id`: Accept sets the asked goods aside and posts the accept carrying them; Refuse
 * posts the refuse. Either is the offer's end letter (`endIdOf`). Refused when the offer is not one this phone was offered
 * or was answered already (`not-open`); an accept also with trading off, while a fight holds the hunter, or for asked goods
 * `setAside` refuses (`no-item`, `worn`, `few`, `poor`). A refuse is never refused for the switch or a fight: it gives nothing.
 */
export function offerAnswered(save: Save, id: OfferId, how: 'accept' | 'refuse', gate: TapGate): Save | TapRefused {
  const r = recordOf(save, id, 'taker');
  if (!r || r.side !== 'taker' || r.state !== 'offered') return refuse('not-open');
  const h = save.hunters.find(x => x.id === r.hid);
  if (!h) return refuse('no-hunter');
  let s = save, gives = NO_GOODS;
  if (how === 'accept') {
    if (!gate.on) return refuse('off');
    if (gate.held) return refuse('fight');
    if (r.offer.asks.items.length || r.offer.asks.gold) {
      const aside = setAside(h, r.offer.asks);
      if ('ok' in aside) return aside;
      s = { ...s, hunters: s.hunters.map(x => (x.id === h.id ? aside.hunter : x)) };
      gives = aside.goods;
    }
  }
  const ev = endEvent('offerEnd', { by: r.offer.to, to: [r.offer.by], offer: id, how, gives });
  if (!ev || ev.type !== 'offerEnd') return refuse('too-large');
  const stepped = recordStep(r, how === 'accept' ? { type: 'accept', aside: ev.payload.gives } : { type: 'refuse' });
  const next = written(s, r, stepped).save;
  return posted(next, r.offer.room, ev);
}

/**
 * The giver takes offer `id` back, or a stranded taker takes its answer's goods back. Before its letter ever left: the goods
 * back and the letter dropped. After: the take back's letter (`withdraw` under the end id), which races the taker's accept
 * for the one end. Stranded (the room gone): the goods back, after the window that says what the app cannot know. Refused
 * where Take back does not apply (`not-open`).
 */
export function offerTakenBack(save: Save, id: OfferId): Save | TapRefused {
  const r = recordOf(save, id, 'giver') ?? recordOf(save, id, 'taker');
  const stepped = r ? recordStep(r, { type: 'takeBack' }) : SAME;
  if (!r || stepped.kind === 'same') return refuse('not-open');
  const next = written(save, r, stepped).save;
  if (stepped.kind !== 'next') return next;
  const ev = endEvent('offerEnd', { by: r.offer.by, to: [r.offer.to], offer: id, how: 'withdraw', gives: NO_GOODS });
  return ev ? posted(next, r.offer.room, ev) : refuse('too-large');
}

/** The GM's phone stops offer `id`: its record to stopping and the `offerStop` letter under the end id, to the offer's two hunters. Refused (`not-open`) where Stop does not apply. */
export function offerStopped(save: Save, id: OfferId): Save | TapRefused {
  const r = recordOf(save, id, 'gm');
  const stepped = r ? recordStep(r, { type: 'stop' }) : SAME;
  if (!r || stepped.kind === 'same') return refuse('not-open');
  const ev = endEvent('offerStop', { to: [r.offer.by, r.offer.to], offer: id });
  if (!ev) return refuse('too-large');
  const next = written(save, r, stepped).save;
  return posted(next, r.offer.room, ev);
}

// ── what the box and the link hear ──
/** The outbox heard letter `letter` leave (`tried`) or the room take it (`taken`): the record whose current letter it is steps (sync.ts `boxDo`, unit 2). */
export function offersHeard(save: Save, letter: string, heard: 'tried' | 'taken'): Save {
  const r = offersOf(save).find(x => letterIdOf(x) === letter);
  return r ? stepIn(save, r, { type: heard }).save : save;
}
/** Room `room` is gone: each of its records steps `roomGone` (a never-sent one gives its goods back; one the room may hold is stranded). */
export function offersGone(save: Save, room: RoomCode): { readonly save: Save; readonly closed: readonly Closed[] } {
  let s = save;
  const out: Closed[] = [];
  for (const r of offersOf(save).filter(x => x.offer.room === room)) {
    const w = stepIn(s, r, { type: 'roomGone' });
    s = w.save;
    if (w.closed) out.push(w.closed);
  }
  return { save: s, closed: out };
}
/**
 * The step the store runs after every step (unit 2, beside `noticed`): each record whose current letter was never taken and
 * is no longer queued or on its way in the box steps `unsent`. Whichever writer let the letter go, a never-sent offer's goods
 * come back in that same write. A second run changes nothing.
 */
export function lettersKept(save: Save): Save {
  const box = boxOf(save);
  let s = save;
  for (const r of offersOf(save)) {
    const l = letterOf(r), id = letterIdOf(r);
    if (l === null || id === null || l.heard === 'taken') continue;
    const e = box.find(x => x.id === id);
    if (!e || (e.at !== 'queued' && e.at !== 'sending')) s = stepIn(s, r, { type: 'unsent' }).save;
  }
  return s;
}

// ── the fold: reading offers and ends from a page or a join's history (notes-5-trade.md 1.9) ──
/** What a phone tells of offers: a toast to a player, a line for the GM's session log (its kind `trade` is unit 4's). */
export type OfferNews = { readonly kind: 'toast' | 'log'; readonly text: string };
/** What the fold answers: the next save, what it tells, and the records it ended. */
export type Seen = { readonly save: Save; readonly news: readonly OfferNews[]; readonly closed: readonly Closed[] };

/** Record `r` added: an offer to a hunter past `OFFERS_TO_KEPT` lets the oldest only offered one go (none: not kept); the GM's past `OFFERS_WATCHED` the oldest open one. */
function kept(save: Save, r: OfferRecord): Save {
  const list = offersOf(save);
  if (r.side === 'giver') return withOffers(save, [...list, r]);
  const mine = (x: OfferRecord): boolean => (r.side === 'gm' ? x.side === 'gm' : x.side === 'taker' && x.hid === r.hid);
  const cap = r.side === 'gm' ? OFFERS_WATCHED : OFFERS_TO_KEPT;
  if (list.filter(mine).length < cap) return withOffers(save, [...list, r]);
  const loose = list.find(x => mine(x) && (x.state === 'offered' || (x.side === 'gm' && x.state === 'open')));
  return loose ? withOffers(save, [...list.filter(x => x !== loose), r]) : save;
}

/**
 * A batch of stored events read by this phone in room `me.room`: a poll page (`poll`, own events included, since a phone
 * learns its own accept or take back won only by reading it as the end) or a join's history (`history`). For each record of
 * the room whose end the batch holds: the end steps it. A giver's own offer read: the room has it (`taken`). Each offer with
 * no end in the batch: a taker's record (offered) on the phone of the hunter it is for, a watch record on the GM's phone. An
 * offer and its end in one batch create nothing (nothing of the taker moved); the GM's phone logs it from a poll and leaves
 * it from history (an old one). Keyed by ids, so a batch read twice ends each record once; it never throws on a parsed event.
 */
export function offersSeen(save: Save, events: readonly StoredEvent[], from: 'poll' | 'history', me: { readonly room: RoomCode; readonly seat: 'gm' | 'player' }): Seen {
  const offers = new Map<OfferId, Offer>(), ends = new Map<OfferId, OfferEnd>();
  for (const ev of events) {
    const end = endOf(ev);
    if (end && (ev.type === 'offerEnd' || ev.type === 'offerStop') && !ends.has(ev.payload.offer)) ends.set(ev.payload.offer, end);
    const o = ev.type === 'offer' ? offerOf(ev.payload, me.room, ev.at) : null;
    if (o && !offers.has(o.id)) offers.set(o.id, o);
  }
  let s = save;
  const news: OfferNews[] = [], done: Closed[] = [];
  for (const r of offersOf(save)) {
    const end = r.offer.room === me.room ? ends.get(r.offer.id) : undefined;
    if (!end) continue;
    const w = stepIn(s, r, { type: 'end', end });
    s = w.save;
    if (w.closed) { done.push(w.closed); const n = closeNews(w.closed); if (n) news.push(n); }
  }
  for (const r of offersOf(s)) if (r.side === 'giver' && r.offer.room === me.room && offers.has(r.offer.id)) s = stepIn(s, r, { type: 'taken' }).save;
  const device = s.settings.deviceId;
  for (const [id, o] of offers) {
    const end = ends.get(id);
    if (end) {
      if (me.seat === 'gm' && from === 'poll' && !offersOf(save).some(r => r.offer.id === id)) news.push({ kind: 'log', text: gmLine(o, outcomeOf(o, end)) });
      continue;
    }
    if (offersOf(s).some(r => r.offer.id === id)) continue;
    if (me.seat === 'gm') { s = kept(s, { side: 'gm', offer: o, state: 'open' }); continue; }
    const hid = hunterIdOf(o.to);
    if (deviceOf(o.to) !== device || !s.hunters.some(h => h.id === hid)) continue;
    s = kept(s, { side: 'taker', offer: o, hid, state: 'offered' });
    if (offersOf(s).some(r => r.offer.id === id)) news.push({ kind: 'toast', text: offeredLine(o) });
  }
  return { save: s, news, closed: done };
}

// ── words (notes-5-trade.md section 7, for the lead's second reading) ──
const backLine = (g: Goods): string => (noGoods(g) ? '' : ` Back in your bag: ${goodsWords(g)}.`);
/** For what the offer asks: " for 20 gold", or nothing for a gift. */
const forLine = (asks: BagPick | Goods, words: string): string => ((asks.items.length || asks.gold) ? ` for ${words}` : '');
/** An offer arriving, on the taker's phone. */
export const offeredLine = (o: Offer): string => `${o.names.by} offers you ${goodsWords(o.gives)}${forLine(o.asks, pickWords(o.asks))}. See your Bag, under Offers.`;
/** The GM's session log line for an offer's end. */
export function gmLine(o: Offer, outcome: OfferOutcome): string {
  switch (outcome) {
    case 'settled': return `${o.names.by} gave ${o.names.to} ${goodsWords(o.gives)}${forLine(o.asks, pickWords(o.asks))}.`;
    case 'refused': return `${o.names.to} refused ${o.names.by}'s offer.`;
    case 'withdrawn': return `${o.names.by} took back an offer to ${o.names.to}.`;
    case 'stopped': return `You stopped ${o.names.by}'s offer to ${o.names.to}.`;
    case 'void': return `${o.names.by}'s offer to ${o.names.to} ended without a trade.`;
  }
}
/** What the giver's phone says when its record ends. */
function giverLine(c: Closed): string {
  const o = c.record.offer, back = backLine(c.back), mira = o.names.to;
  switch (c.close) {
    case 'settled': return `${mira} accepted. You gave ${goodsWords(o.gives)}${noGoods(c.gain) ? '' : ` and got ${goodsWords(c.gain)}`}.`;
    case 'refused': return `${mira} refused your offer.${back}`;
    case 'withdrawn': return `You took back your offer.${back}`;
    case 'stopped': return `The GM stopped your offer to ${mira}.${back}`;
    case 'void': return `Your offer to ${mira} ended without a trade.${back}`;
    case 'recalled': return `You took back your offer before it was sent.${back}`;
    case 'unsent': return `Your offer to ${mira} was never sent.${back}`;
    case 'gone': return `The room closed before your offer was sent.${back}`;
    case 'reclaimed': return `You took back what you offered ${mira}.${back}`;
  }
}
/** What the taker's phone says when its record ends. */
function takerLine(c: Closed): string {
  const o = c.record.offer, back = backLine(c.back), brakk = o.names.by;
  switch (c.close) {
    case 'settled': { const gave = asideOf(c.record); return `You got ${goodsWords(c.gain)} from ${brakk}${noGoods(gave) ? '' : ` and gave ${goodsWords(gave)}`}.`; }
    case 'refused': return `You refused ${brakk}'s offer.${back}`;
    case 'withdrawn': return noGoods(c.back) ? `${brakk} took back the offer of ${goodsWords(o.gives)}.` : `${brakk} took back the offer before your answer reached the room.${back}`;
    case 'stopped': return `The GM stopped ${brakk}'s offer.${back}`;
    case 'void': return `${brakk}'s offer ended without a trade.${back}`;
    case 'recalled': case 'unsent': return `Your answer to ${brakk} was never sent.${back}`;
    case 'gone': return `The room closed before ${brakk}'s offer ended.${back}`;
    case 'reclaimed': return `You took back your answer to ${brakk}.${back}`;
  }
}
/** What a record's end tells: a toast on a player's phone, a log line on the GM's (none for the room gone). */
export function closeNews(c: Closed): OfferNews | null {
  if (c.record.side === 'giver') return { kind: 'toast', text: giverLine(c) };
  if (c.record.side === 'taker') return { kind: 'toast', text: takerLine(c) };
  const outcome = oneOf(c.close, OFFER_OUTCOMES, null);
  return outcome === null ? null : { kind: 'log', text: gmLine(c.record.offer, outcome) };
}
/** What a giver's or taker's record says while it waits (the Offers tab). */
export const STATE_WORDS: { readonly giver: { readonly [R in GiverRow]: (o: Offer) => string }; readonly taker: { readonly [R in TakerRow]: (o: Offer) => string } } = {
  giver: {
    'posting-queued': () => 'Waiting for the room.', 'posting-tried': () => 'Waiting for the room.', open: o => `Waiting for ${o.names.to}.`,
    'withdrawing-queued': o => `Taking back. If ${o.names.to} accepts first, it is theirs.`, 'withdrawing-tried': o => `Taking back. If ${o.names.to} accepts first, it is theirs.`,
    'withdrawing-taken': o => `Taking back. If ${o.names.to} accepts first, it is theirs.`, stranded: () => 'The room closed before this offer ended.',
  },
  taker: {
    offered: o => `${o.names.by} offers ${goodsWords(o.gives)}${forLine(o.asks, `your ${pickWords(o.asks)}`)}.`,
    'accepting-queued': () => 'Accepted. Waiting for the room.', 'accepting-tried': () => 'Accepted. Waiting for the room.', 'accepting-taken': () => 'Accepted. Waiting for the room.',
    'refusing-queued': () => 'Refused. Waiting for the room.', 'refusing-tried': () => 'Refused. Waiting for the room.', 'refusing-taken': () => 'Refused. Waiting for the room.',
    stranded: () => 'The room closed before your answer was settled.',
  },
};

// ── the save's reader ──
type Rec = Record<string, unknown>;
const isObj = (v: unknown): v is Rec => v !== null && typeof v === 'object' && !Array.isArray(v);
/** A stored offer, read by the room's own reader of the `offer` message, with its room and time; else null. */
function storedOffer(v: unknown): Offer | null {
  if (!isObj(v)) return null;
  const room = parseRoomCode(v.room), at = timeOf(v.at);
  const ev = room && at ? parseEvent('offer', { eid: v.id, by: v.by, to: [v.to], names: v.names, gives: v.gives, asks: v.asks }) : null;
  return ev?.type === 'offer' && room && at ? offerOf(ev.payload, room, at) : null;
}
/**
 * The records a save holds, each read whole or dropped (a record that does not read is damage); one per offer and side. No
 * record is dropped for a count: a giver's holds goods, and the taps keep the counts (`OFFERS_OPEN`, `OFFERS_TO_KEPT`,
 * `OFFERS_WATCHED`).
 */
export function parseOffers(v: unknown): OfferRecord[] {
  const out: OfferRecord[] = [];
  for (const raw of Array.isArray(v) ? v : []) {
    if (!isObj(raw)) continue;
    const offer = storedOffer(raw.offer), hid = parseSaveId<'h'>(raw.hid), aside = parseGoods(raw.aside);
    const r: OfferRecord | null = !offer ? null
      : raw.side === 'giver' ? (hid && aside && oneOf(raw.state, GIVER_ROWS, null) ? { side: 'giver', offer, hid, aside, state: oneOf(raw.state, GIVER_ROWS, 'open') } : null)
      : raw.side === 'gm' ? (oneOf(raw.state, WATCH_ROWS, null) ? { side: 'gm', offer, state: oneOf(raw.state, WATCH_ROWS, 'open') } : null)
      : raw.side === 'taker' && hid ? takerRead(offer, hid, raw.state, aside) : null;
    if (r && !out.some(x => sameRecord(x, r))) out.push(r);
  }
  return out;
}
function takerRead(offer: Offer, hid: HunterId, state: unknown, aside: Goods | null): OfferRecord | null {
  const bare = oneOf(state, TAKER_BARE, null), holding = oneOf(state, TAKER_HOLDING, null);
  if (bare) return { side: 'taker', offer, hid, state: bare };
  return holding && aside ? { side: 'taker', offer, hid, state: holding, aside } : null;
}
