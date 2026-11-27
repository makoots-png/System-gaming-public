// An offer between two hunters of a room, its one end and each phone's record of it (src/core/trade/offer.ts,
// notes-5-trade.md 1.4 to 1.10 and 12.1): the outcome's rule, every cell of the three records' tables, the taps' writes,
// the fold, and the proof of 1.8 as a random walk of two players' phones and the GM's against a fake room log that takes
// an event id once, with the four rules checked after every step and the rest rule at its end.
import { builtInDefData, grantName } from '../src/core/registry/item-book.ts';
import { describe, expect, test } from 'bun:test';
import {
  GIVER, OFFER_OUTCOMES, TAKER, WATCH, endOf, lettersKept, offerAnswered, offerPosted, offerStopped, offerTakenBack, letterTaken, offersGone, offersOf, offersSeen,
  outcomeOf, parseOffers, recordStep,
} from '../src/core/trade/offer.ts';
import type { Closed, GiverRow, Offer, OfferEnd, OfferOutcome, OfferRecord, RecordEvent, TakerRow, WatchRow } from '../src/core/trade/offer.ts';
import { NO_GOODS, fits, refusalWords } from '../src/core/trade/goods.ts';
import type { BagPick, Goods } from '../src/core/trade/goods.ts';
import { freshSave, newHunter } from '../src/core/save.ts';
import type { Hunter, Save } from '../src/core/save.ts';
import { RULES } from '../src/core/rules.ts';
import { SHOP_ITEMS } from '../src/core/registry/items.ts';
import type { ItemDefData } from '../src/core/registry/item-book.ts';
import { bagOf, putItem } from '../src/core/hunter/inventory.ts';
import { useItem } from '../src/core/hunter/use.ts';
import { REVIVE_HP } from '../src/core/hunter/vitals.ts';
import { isRefused } from '../src/core/save-step.ts';
import type { Refused } from '../src/core/save-step.ts';
import { next as nextLetter, post, reloaded, roomGone, step as boxStep } from '../src/core/sync/outbox.ts';
import type { Outbox } from '../src/core/sync/outbox.ts';
import { endEvent, parseEvent } from '../src/core/protocol.ts';
import type { RoomEvent, StoredEvent } from '../src/core/protocol.ts';
import { endIdOf, parseOfferId, sheetKeyOf } from '../src/core/ids.ts';
import type { DeviceId, OfferId, SheetKey } from '../src/core/ids.ts';
import { dev, hid, iid, room } from './fixtures/ids.ts';
import { CUSTOM_BLADE_DEF, CUSTOM_BLADE_ID, DAGGER_DEF_ID, refOf, rulesWith } from './fixtures/items.ts';

const T0 = Date.parse('2026-11-19T12:00:00.000Z'), AT = new Date(T0).toISOString(), ROOM = room('TRADE2');
const A = dev('d-brakk'), B = dev('d-mira'), G = dev('d-gm'), C = dev('d-third');
const KA = sheetKeyOf(A, hid('h1')), KB = sheetKeyOf(B, hid('h1')), KC = sheetKeyOf(C, hid('h1'));
const ok = <T extends object>(v: T): Exclude<T, Refused> => { if (isRefused(v)) throw new Error(`refused: ${v.why}`); return v as Exclude<T, Refused>; };
const oid = (s: string): OfferId => { const o = parseOfferId(s); if (!o) throw new Error(s); return o; };
/** A token: a player's own (ad hoc) thing of its own name, so it never stacks and can be counted wherever it is. */
const token = (n: number): ItemDefData => ({ name: `Token ${n}`, rar: 'common', type: 'misc', slot: null, dice: '', bonus: {}, desc: '', armor: 0, resist: 0 });
const hunterOf = (name: string, gold: number, tokens: readonly number[]): Hunter =>
  ({ ...newHunter(RULES), id: hid('h1'), name, gold, items: tokens.map(n => ({ kind: 'adhoc', id: iid(`i${n}`), qty: 1, item: token(n) })) });
/** The names in hunter `h`'s bag, read under the shipped rules. */
const namesIn = (h: Hunter): string[] => bagOf(h, RULES).map(i => i.name);
/** A phone's save in the room: its device, its one hunter bound (a player), or none (the GM). */
function phone(device: DeviceId, h: Hunter | null): Save {
  const s = freshSave({ now: new Date(T0), newDeviceToken: () => 'test-device-token-0123456789abcd', newDeviceId: () => device }, { onboarded: true });
  return { ...s, seq: 1000, hunters: h ? [h] : s.hunters, settings: { ...s.settings, sync: { ...s.settings.sync, room: ROOM, ...(h ? { boundHunterId: h.id } : {}) } } };
}
const brakk = () => phone(A, hunterOf('Brakk', 100, [1, 2, 3]));
const mira = () => phone(B, hunterOf('Mira', 50, [11, 12]));
const gm = () => phone(G, null);
const OPEN = { on: true, held: false, R: RULES } as const;
const pick = (gold: number, ...ids: number[]): BagPick => ({ gold, items: ids.map(n => ({ id: iid(`i${n}`), qty: 1, name: `Token ${n}` })) });
let clock = 0;
const stamp = (device: DeviceId) => ({ device, now: T0 + ++clock, rand: 0.25 });
const box = (s: Save): Outbox => s.settings.sync.outbox ?? [];
const withBox = (s: Save, b: Outbox): Save => ({ ...s, settings: { ...s.settings, sync: { ...s.settings.sync, outbox: b } } });
const bag = (s: Save): string[] => namesIn(s.hunters[0]!).sort();
const gold = (s: Save): number => s.hunters[0]!.gold;
/** Brakk's save after offering `gives` for `asks`, and the offer's id. */
function offered(s: Save, gives: BagPick, asks: BagPick = pick(0)): { save: Save; id: OfferId } {
  const next = ok(offerPosted(s, { hid: hid('h1'), to: KB, toName: 'Mira', gives, asks, at: AT, stamp: stamp(A), ...OPEN }));
  return { save: next, id: offersOf(next).at(-1)!.offer.id };
}

// ── a fake room: the server's rule that an id is taken once, and a page of stored events ──
type Room = { events: StoredEvent[]; gone: boolean };
const newRoom = (): Room => ({ events: [], gone: false });
/** Server.ts `addEvent`: the stored event's seq for an id the room holds, else the new one. */
function addEvent(r: Room, from: DeviceId, ev: RoomEvent): number {
  const held = r.events.find(e => e.payload.eid === ev.payload.eid);
  if (held) return held.seq;
  const seq = r.events.length + 1;
  r.events.push({ ...ev, seq, at: new Date(T0 + seq).toISOString(), from });
  return seq;
}
/** One phone sends its next letter and the room takes it: the box's send, `tried`, the room's store, the box's sent, `taken`. */
function deliver(s: Save, r: Room, device: DeviceId): Save {
  const e = nextLetter(box(s), ROOM);
  if (!e || e.letter.kind !== 'event') return s;
  let t = lettersKept(withBox(s, boxStep(box(s), e.id, { type: 'send' })), RULES);
  addEvent(r, device, e.letter.event);
  t = letterTaken(withBox(t, boxStep(box(t), e.id, { type: 'sent' })), e.id, RULES);
  return lettersKept(t, RULES);
}
const seat = (s: Save): 'gm' | 'player' => (s.settings.deviceId === G ? 'gm' : 'player');
const read = (s: Save, r: Room, R = RULES) => offersSeen(s, r.events, { room: ROOM, seat: seat(s) }, R);

describe('how an offer came out: the one rule every phone reads', () => {
  const o: Offer = { id: oid('d-brakk-x1'), room: ROOM, at: AT, by: KA, to: KB, names: { by: 'Brakk', to: 'Mira' }, gives: { gold: 0, items: [] }, asks: { gold: 20, items: [] } };
  const paid: Goods = { gold: 20, items: [] };
  const rows: [string, OfferEnd, OfferOutcome][] = [
    ['the taker accepts with exactly the asked goods', { how: 'accept', by: KB, gives: paid }, 'settled'],
    ['the taker accepts with other goods', { how: 'accept', by: KB, gives: { gold: 19, items: [] } }, 'void'],
    ['the giver posts an accept', { how: 'accept', by: KA, gives: paid }, 'void'],
    ['a third hunter accepts', { how: 'accept', by: KC, gives: paid }, 'void'],
    ['the taker refuses', { how: 'refuse', by: KB }, 'refused'],
    ['the giver refuses', { how: 'refuse', by: KA }, 'void'],
    ['the giver takes it back', { how: 'withdraw', by: KA }, 'withdrawn'],
    ['the taker takes it back', { how: 'withdraw', by: KB }, 'void'],
    ['the GM stops it', { how: 'stop' }, 'stopped'],
  ];
  for (const [what, end, outcome] of rows) test(`${what}: ${outcome}`, () => expect(outcomeOf(o, end)).toBe(outcome));
});

describe('every cell of the three records', () => {
  // notes-5-trade.md 1.6, with Take back as one column (12.1): a next row, a close, or null (nothing happens)
  const giver: { [R in GiverRow]: Record<string, string | null> } = {
    'posting-queued': { takeBack: 'recalled', tried: 'posting-tried', taken: 'open', unsent: 'unsent', end: null, roomGone: 'gone' },
    'posting-tried': { takeBack: 'withdrawing-queued', tried: null, taken: 'open', unsent: null, end: 'end', roomGone: 'stranded' },
    open: { takeBack: 'withdrawing-queued', tried: null, taken: null, unsent: null, end: 'end', roomGone: 'stranded' },
    'withdrawing-queued': { takeBack: null, tried: 'withdrawing-tried', taken: 'withdrawing-taken', unsent: 'open', end: 'end', roomGone: 'stranded' },
    'withdrawing-tried': { takeBack: null, tried: null, taken: 'withdrawing-taken', unsent: 'open', end: 'end', roomGone: 'stranded' },
    'withdrawing-taken': { takeBack: null, tried: null, taken: null, unsent: null, end: 'end', roomGone: 'stranded' },
    stranded: { takeBack: 'reclaimed', tried: null, taken: null, unsent: null, end: 'end', roomGone: null },
  };
  const taker: { [R in TakerRow]: Record<string, string | null> } = {
    offered: { accept: 'accepting-queued', refuse: 'refusing-queued', takeBack: null, tried: null, taken: null, unsent: null, end: 'end', roomGone: 'gone' },
    'accepting-queued': { accept: null, refuse: null, takeBack: null, tried: 'accepting-tried', taken: 'accepting-taken', unsent: 'offered', end: 'end', roomGone: 'gone' },
    'accepting-tried': { accept: null, refuse: null, takeBack: null, tried: null, taken: 'accepting-taken', unsent: null, end: 'end', roomGone: 'stranded' },
    'accepting-taken': { accept: null, refuse: null, takeBack: null, tried: null, taken: null, unsent: null, end: 'end', roomGone: 'stranded' },
    'refusing-queued': { accept: null, refuse: null, takeBack: null, tried: 'refusing-tried', taken: 'refusing-taken', unsent: 'offered', end: 'end', roomGone: 'gone' },
    'refusing-tried': { accept: null, refuse: null, takeBack: null, tried: null, taken: 'refusing-taken', unsent: null, end: 'end', roomGone: 'gone' },
    'refusing-taken': { accept: null, refuse: null, takeBack: null, tried: null, taken: null, unsent: null, end: 'end', roomGone: 'gone' },
    stranded: { accept: null, refuse: null, takeBack: 'reclaimed', tried: null, taken: null, unsent: null, end: 'end', roomGone: null },
  };
  const watch: { [R in WatchRow]: Record<string, string | null> } = {
    open: { stop: 'stopping-queued', tried: null, taken: null, unsent: null, end: 'end', roomGone: 'gone' },
    'stopping-queued': { stop: null, tried: 'stopping-tried', taken: 'stopping-taken', unsent: 'open', end: 'end', roomGone: 'gone' },
    'stopping-tried': { stop: null, tried: null, taken: 'stopping-taken', unsent: 'open', end: 'end', roomGone: 'gone' },
    'stopping-taken': { stop: null, tried: null, taken: null, unsent: null, end: 'end', roomGone: 'gone' },
  };
  test('the tables hold exactly the notes\' cells', () => {
    expect(GIVER).toEqual(giver as never);
    expect(TAKER).toEqual(taker as never);
    expect(WATCH).toEqual(watch as never);
  });

  const o: Offer = { id: oid('d-brakk-x2'), room: ROOM, at: AT, by: KA, to: KB, names: { by: 'Brakk', to: 'Mira' }, gives: { gold: 5, items: [] }, asks: { gold: 3, items: [] } };
  const G5: Goods = { gold: 5, items: [] }, A3: Goods = { gold: 3, items: [] };
  const event = (type: string): RecordEvent => (type === 'accept' ? { type, aside: A3 } : type === 'end' ? { type, end: { how: 'withdraw', by: KA } } : { type } as RecordEvent);
  const holds = (row: TakerRow) => row.startsWith('accepting') || row === 'stranded';
  const takerAt = (row: TakerRow): OfferRecord => (holds(row) ? { side: 'taker', offer: o, hid: hid('h1'), state: row as never, aside: A3 } : { side: 'taker', offer: o, hid: hid('h1'), state: row as never });
  const cases: [string, OfferRecord, Record<string, string | null>][] = [
    ...Object.entries(giver).map(([row, cells]): [string, OfferRecord, Record<string, string | null>] => [`giver ${row}`, { side: 'giver', offer: o, hid: hid('h1'), aside: G5, state: row as GiverRow }, cells]),
    ...Object.entries(taker).map(([row, cells]): [string, OfferRecord, Record<string, string | null>] => [`taker ${row}`, takerAt(row as TakerRow), cells]),
    ...Object.entries(watch).map(([row, cells]): [string, OfferRecord, Record<string, string | null>] => [`GM ${row}`, { side: 'gm', offer: o, state: row as WatchRow }, cells]),
  ];
  for (const [name, r, cells] of cases) {
    test(`${name}: each event leads where its cell says, and an event of another side does nothing`, () => {
      for (const type of ['takeBack', 'accept', 'refuse', 'stop', 'tried', 'taken', 'unsent', 'end', 'roomGone']) {
        const cell = Object.hasOwn(cells, type) ? cells[type]! : null, out = recordStep(r, event(type));
        if (cell === null) expect(out, type).toEqual({ kind: 'same' });
        else if (['end', 'recalled', 'unsent', 'gone', 'reclaimed'].includes(cell)) expect(out, type).toMatchObject({ kind: 'closed', close: cell === 'end' ? 'withdrawn' : cell });
        else expect(out, type).toMatchObject({ kind: 'next', record: { state: cell } });
      }
    });
  }

  test('a close other than settled gives the aside back; settled drops it and gains the other side\'s goods', () => {
    const giverOpen: OfferRecord = { side: 'giver', offer: o, hid: hid('h1'), aside: G5, state: 'open' };
    expect(recordStep(giverOpen, { type: 'end', end: { how: 'accept', by: KB, gives: A3 } })).toEqual({ kind: 'closed', close: 'settled', gain: A3, back: NO_GOODS });
    expect(recordStep(giverOpen, { type: 'end', end: { how: 'stop' } })).toEqual({ kind: 'closed', close: 'stopped', gain: NO_GOODS, back: G5 });
    expect(recordStep(takerAt('accepting-taken'), { type: 'end', end: { how: 'accept', by: KB, gives: A3 } })).toEqual({ kind: 'closed', close: 'settled', gain: G5, back: NO_GOODS });
    expect(recordStep(takerAt('accepting-taken'), { type: 'end', end: { how: 'withdraw', by: KA } })).toEqual({ kind: 'closed', close: 'withdrawn', gain: NO_GOODS, back: A3 });
  });

  test('a taker that only was offered gains nothing even from a settled end: it never put the asked goods aside', () => {
    expect(recordStep(takerAt('offered'), { type: 'end', end: { how: 'accept', by: KB, gives: A3 } })).toEqual({ kind: 'closed', close: 'settled', gain: NO_GOODS, back: NO_GOODS });
  });

  test('a never-sent accept let go goes back to offered and gives the asked goods back', () => {
    expect(recordStep(takerAt('accepting-queued'), { type: 'unsent' })).toEqual({ kind: 'next', record: takerAt('offered'), back: A3 });
  });

  test('every outcome is a close the words know', () => {
    expect([...OFFER_OUTCOMES].sort()).toEqual(['refused', 'settled', 'stopped', 'void', 'withdrawn']);
  });
});

describe('the taps, each one write', () => {
  test('Brakk offers Mira a token for 20 gold: it leaves his bag into the aside, the record waits to be sent, the letter is in the box', () => {
    const { save, id } = offered(brakk(), pick(0, 1), pick(20));
    expect(bag(save)).toEqual(['Token 2', 'Token 3']);
    const r = offersOf(save)[0]!;
    expect(r).toMatchObject({ side: 'giver', state: 'posting-queued', offer: { id, by: KA, to: KB, names: { by: 'Brakk', to: 'Mira' } } });
    expect(r.side === 'giver' && r.aside.items.map(l => grantName(l.item))).toEqual(['Token 1']);
    expect(box(save).map(e => [e.id, e.at])).toEqual([[id, 'queued']]);
  });

  test('an offer is refused out of a room, for a hunter not played there, with trading off, while a fight holds it, to itself, and past ten open', () => {
    const s = brakk(), args = { hid: hid('h1'), to: KB, toName: 'Mira', gives: pick(1), asks: pick(0), at: AT, stamp: stamp(A), ...OPEN };
    expect(offerPosted({ ...s, settings: { ...s.settings, sync: { ...s.settings.sync, room: null } } }, args)).toEqual({ ok: false, why: 'no-room' });
    expect(offerPosted({ ...s, settings: { ...s.settings, sync: { ...s.settings.sync, boundHunterId: hid('h2') } } }, args)).toEqual({ ok: false, why: 'not-played' });
    expect(offerPosted(s, { ...args, on: false })).toEqual({ ok: false, why: 'off' });
    expect(offerPosted(s, { ...args, held: true })).toEqual({ ok: false, why: 'fight' });
    expect(offerPosted(s, { ...args, to: KA })).toEqual({ ok: false, why: 'same-hunter' });
    let many = s;
    for (let i = 0; i < 10; i++) many = offered(many, pick(1)).save;
    const r = offerPosted(many, { ...args, stamp: stamp(A) });
    expect(r).toEqual({ ok: false, why: 'too-many' });
    expect(refusalWords(r as never)).toBe('You already have 10 open offers. Take one back first.');
  });

  test('Take back before the letter left: the token back and the letter out of the box', () => {
    const { save, id } = offered(brakk(), pick(0, 1));
    const back = ok(offerTakenBack(save, id, RULES));
    expect(bag(back)).toEqual(['Token 1', 'Token 2', 'Token 3']);
    expect(offersOf(back)).toEqual([]);
    expect(box(back)).toEqual([]);
  });

  test('Take back after the room took the offer posts the end "withdraw" under the offer\'s end id', () => {
    const r = newRoom(), { save, id } = offered(brakk(), pick(0, 1));
    const sent = deliver(save, r, A), back = ok(offerTakenBack(sent, id, RULES));
    expect(offersOf(back)[0]!.state).toBe('withdrawing-queued');
    expect(box(back).map(e => e.id)).toEqual([endIdOf(id)]);
    expect(offerTakenBack(back, id, RULES)).toEqual({ ok: false, why: 'not-open' });
  });

  test('a full outbox that lets an offer\'s letter go gives the token back in the same write', () => {
    const { save, id } = offered(brakk(), pick(5, 1));
    const dropped = withBox(save, boxStep(box(save), id, { type: 'drop' }));
    const kept = lettersKept(dropped, RULES);
    expect(bag(kept)).toEqual(['Token 1', 'Token 2', 'Token 3']);
    expect(gold(kept)).toBe(100);
    expect(offersOf(kept)).toEqual([]);
    expect(lettersKept(kept, RULES)).toEqual(kept);
  });

  test('a take back whose letter the room refused can be tapped again, and the second letter goes out', () => {
    const r = newRoom(), { save, id } = offered(brakk(), pick(0, 1));
    const back = ok(offerTakenBack(deliver(save, r, A), id, RULES)), end = endIdOf(id);
    const tried = lettersKept(withBox(back, boxStep(box(back), end, { type: 'send' })), RULES);
    const refused = lettersKept(withBox(tried, boxStep(box(tried), end, { type: 'refused', why: 'bad event' })), RULES);
    expect(offersOf(refused)[0]!.state).toBe('open');
    const again = lettersKept(ok(offerTakenBack(refused, id, RULES)), RULES);
    expect(offersOf(again)[0]!.state).toBe('withdrawing-queued');
    expect(box(again).map(e => [e.id, e.at])).toEqual([[end, 'queued']]);
  });

  test('a letter refused after it left once keeps the goods aside: the room may hold it, and Take back still works', () => {
    const { save, id } = offered(brakk(), pick(0, 1));
    const sent = lettersKept(withBox(save, boxStep(box(save), id, { type: 'send' })), RULES);
    const refused = lettersKept(withBox(sent, boxStep(box(sent), id, { type: 'refused', why: 'bad event' })), RULES);
    expect(offersOf(refused)[0]!.state).toBe('posting-tried');
    expect(bag(refused)).toEqual(['Token 2', 'Token 3']);
    expect(offersOf(ok(offerTakenBack(refused, id, RULES)))[0]!.state).toBe('withdrawing-queued');
  });
});

describe('two phones settle through the room', () => {
  test('Mira accepts Brakk\'s token for 20 gold: the token leaves his bag and lands in hers, her gold lands in his', () => {
    const r = newRoom();
    let { save: a, id } = offered(brakk(), pick(0, 1), pick(20));
    a = deliver(a, r, A);
    let b = read(mira(), r).save;
    expect(offersOf(b)[0]).toMatchObject({ side: 'taker', state: 'offered' });
    b = ok(offerAnswered(b, id, 'accept', OPEN));
    expect(gold(b)).toBe(30);
    b = deliver(b, r, B);
    const seenB = read(b, r), seenA = read(a, r);
    expect(bag(seenA.save)).toEqual(['Token 2', 'Token 3']);
    expect(gold(seenA.save)).toBe(120);
    expect(bag(seenB.save)).toEqual(['Token 1', 'Token 11', 'Token 12']);
    expect(gold(seenB.save)).toBe(30);
    expect(seenA.news).toEqual([{ kind: 'toast', offer: id, text: 'Mira accepted. You gave 1 Token 1 and got 20 gold.' }]);
    expect(seenB.news).toEqual([{ kind: 'toast', offer: id, text: 'You got 1 Token 1 from Brakk and gave 20 gold.' }]);
    expect([offersOf(seenA.save), offersOf(seenB.save)]).toEqual([[], []]);
  });

  test('dead Mira accepts Brakk\'s Resurrection Crystal: it lands in her bag, and she uses it to come back (the owner, Nov 19)', () => {
    const r = newRoom(), crystal = refOf(SHOP_ITEMS.find(d => d.name === 'Resurrection Crystal (S)')!.defId);
    const giver = brakk(), withCrystal: Save = { ...giver, hunters: [putItem(giver.hunters[0]!, crystal, iid('i9'), RULES)] };
    const taker = mira(), dead: Save = { ...taker, hunters: [{ ...taker.hunters[0]!, life: { at: 'dead' } }] };
    let { save: a, id } = offered(withCrystal, { gold: 0, items: [{ id: iid('i9'), qty: 1, name: 'Resurrection Crystal (S)' }] });
    a = deliver(a, r, A);
    let b = read(dead, r).save;
    b = deliver(ok(offerAnswered(b, id, 'accept', OPEN)), r, B);
    const seenB = read(b, r).save, mine = seenB.hunters[0]!, got = bagOf(mine, RULES).find(i => i.name === 'Resurrection Crystal (S)')!;
    expect([mine.life, got.qty], 'she is still dead, and holds the crystal').toEqual([{ at: 'dead' }, 1]);
    expect(namesIn(read(a, r).save.hunters[0]!), 'it left Brakk\'s bag').not.toContain('Resurrection Crystal (S)');
    expect(ok(useItem(mine, got.id, [], RULES)).hunter.life).toEqual({ at: 'up', hp: REVIVE_HP });
  });

  test('Mira accepts Brakk\'s custom blade: her phone, without the GM\'s def, reads it by the def the offer carried and keeps that def', () => {
    const r = newRoom(), Rb = rulesWith({ [CUSTOM_BLADE_ID]: CUSTOM_BLADE_DEF });
    const giver = brakk(), withBlade: Save = { ...giver, hunters: [putItem(giver.hunters[0]!, refOf(CUSTOM_BLADE_ID), iid('i9'), Rb)] };
    const posted = ok(offerPosted(withBlade, { hid: hid('h1'), to: KB, toName: 'Mira', gives: { gold: 0, items: [{ id: iid('i9'), qty: 1, name: 'Rift Fang' }] }, asks: pick(0), at: AT, stamp: stamp(A), ...OPEN, R: Rb }));
    const id = offersOf(posted).at(-1)!.offer.id;
    const a = deliver(posted, r, A);
    const b = deliver(ok(offerAnswered(read(mira(), r).save, id, 'accept', OPEN)), r, B);
    const seenB = read(b, r).save;
    expect(seenB.hunters[0]!.items.find(i => i.kind === 'ref'), 'a reference to the GM\'s def').toMatchObject({ kind: 'ref', defId: CUSTOM_BLADE_ID, qty: 1 });
    expect(seenB.heardItems).toEqual({ [CUSTOM_BLADE_ID]: CUSTOM_BLADE_DEF });
    expect(bagOf(seenB.hunters[0]!, rulesWith(seenB.heardItems)).map(i => i.name).sort()).toEqual(['Rift Fang', 'Token 11', 'Token 12']);
    expect(read(a, r).save.hunters[0]!.items.some(i => i.id === 'i9'), 'it left Brakk\'s bag').toBe(false);
  });

  test('landing goods uses the phone\'s R so a built-in edited to have no slot stacks on take-back and settle', () => {
    const r = newRoom();
    const slotlessDagger = { ...builtInDefData(DAGGER_DEF_ID, RULES)!, slot: null, type: 'misc' as const };
    const Rslotless = rulesWith({ [DAGGER_DEF_ID]: slotlessDagger });
    // Take back before send: giver already holds a second dagger, so under Rslotless the returned dagger merges into qty 2
    const g0 = brakk(), g1: Save = { ...g0, hunters: [putItem(g0.hunters[0]!, refOf(DAGGER_DEF_ID, { qty: 2 }), iid('i9'), Rslotless)] };
    const posted1 = ok(offerPosted(g1, { hid: hid('h1'), to: KB, toName: 'Mira', gives: { gold: 0, items: [{ id: iid('i9'), qty: 1, name: slotlessDagger.name }] }, asks: pick(0), at: AT, stamp: stamp(A), on: true, held: false, R: Rslotless }));
    const id1 = offersOf(posted1).at(-1)!.offer.id;
    const back = ok(offerTakenBack(posted1, id1, Rslotless));
    expect(back.hunters[0]!.items.filter(i => i.kind === 'ref' && i.defId === DAGGER_DEF_ID)).toMatchObject([{ qty: 2 }]);
    // Settle on taker's phone: taker already holds one dagger, and under Rslotless the accepted dagger merges into qty 2
    const a = deliver(posted1, r, A);
    const m0 = mira(), m1: Save = { ...m0, hunters: [putItem(m0.hunters[0]!, refOf(DAGGER_DEF_ID), iid('i8'), Rslotless)] };
    const b = deliver(ok(offerAnswered(read(m1, r, Rslotless).save, id1, 'accept', { on: true, held: false, R: Rslotless })), r, B);
    const settled = read(b, r, Rslotless).save;
    expect(settled.hunters[0]!.items.filter(i => i.kind === 'ref' && i.defId === DAGGER_DEF_ID)).toMatchObject([{ qty: 2 }]);
    expect(read(a, r, Rslotless).save.hunters[0]!.items.filter(i => i.kind === 'ref' && i.defId === DAGGER_DEF_ID)).toMatchObject([{ qty: 1 }]);
  });

  test('an offer and its end in one page create nothing on the taker\'s phone', () => {
    const r = newRoom();
    let { save: a, id } = offered(brakk(), pick(0, 1));
    a = deliver(a, r, A);
    a = deliver(ok(offerTakenBack(a, id, RULES)), r, A);
    const seen = read(mira(), r);
    expect(offersOf(seen.save)).toEqual([]);
    expect(seen.news).toEqual([]);
  });

  test('a page read twice ends each record once', () => {
    const r = newRoom();
    let { save: a, id } = offered(brakk(), pick(0, 1), pick(20));
    a = deliver(a, r, A);
    let b = deliver(ok(offerAnswered(read(mira(), r).save, id, 'accept', OPEN)), r, B);
    const once = read(a, r).save, twice = read(once, r);
    expect(twice.save).toEqual(once);
    expect(twice.news).toEqual([]);
    b = read(b, r).save;
    expect(read(b, r).save).toEqual(b);
  });

  for (const first of ['accept', 'withdraw'] as const) {
    test(`an accept and a take back sent at once: whichever the room took decides, on both phones (${first} first)`, () => {
      const r = newRoom();
      let { save: a, id } = offered(brakk(), pick(0, 1), pick(20));
      a = deliver(a, r, A);
      let b = ok(offerAnswered(read(mira(), r).save, id, 'accept', OPEN));
      a = ok(offerTakenBack(a, id, RULES));
      if (first === 'accept') { b = deliver(b, r, B); a = deliver(a, r, A); } else { a = deliver(a, r, A); b = deliver(b, r, B); }
      expect(r.events.filter(e => e.payload.eid === endIdOf(id))).toHaveLength(1);
      const sa = read(a, r), sb = read(b, r);
      const outcome = (c: readonly Closed[]) => c.map(x => x.close);
      expect(outcome(sa.closed)).toEqual([first === 'accept' ? 'settled' : 'withdrawn']);
      expect(outcome(sb.closed)).toEqual(outcome(sa.closed));
      if (first === 'accept') {
        expect([bag(sa.save), gold(sa.save), bag(sb.save), gold(sb.save)]).toEqual([['Token 2', 'Token 3'], 120, ['Token 1', 'Token 11', 'Token 12'], 30]);
      } else {
        expect([bag(sa.save), gold(sa.save), bag(sb.save), gold(sb.save)]).toEqual([['Token 1', 'Token 2', 'Token 3'], 100, ['Token 11', 'Token 12'], 50]);
        expect(sb.news).toEqual([{ kind: 'toast', offer: id, text: 'Brakk took back the offer before your answer reached the room server. Back in your bag: 20 gold.' }]);
      }
    });
  }

  test('the GM\'s phone watches every offer, stops one, and logs each end it reads', () => {
    const r = newRoom();
    let { save: a, id } = offered(brakk(), pick(0, 1));
    a = deliver(a, r, A);
    let g = read(gm(), r).save;
    expect(offersOf(g)).toMatchObject([{ side: 'gm', state: 'open' }]);
    g = deliver(ok(offerStopped(g, id, RULES)), r, G);
    expect(r.events.at(-1)).toMatchObject({ type: 'offerStop', payload: { to: [KA, KB], offer: id } });
    const sg = read(g, r), sa = read(a, r);
    expect(sg.news).toEqual([{ kind: 'log', offer: id, text: 'You stopped Brakk\'s offer to Mira.' }]);
    expect(sa.news).toEqual([{ kind: 'toast', offer: id, text: 'The GM stopped your offer to Mira. Back in your bag: 1 Token 1.' }]);
    expect(bag(sa.save)).toEqual(['Token 1', 'Token 2', 'Token 3']);
  });

  test('an offer settled within one page of the GM\'s poll is logged, once', () => {
    const r = newRoom();
    let { save: a, id } = offered(brakk(), pick(0, 1));
    a = deliver(a, r, A);
    deliver(ok(offerAnswered(read(mira(), r).save, id, 'refuse', OPEN)), r, B);
    const seen = read(gm(), r);
    expect(seen.news).toEqual([{ kind: 'log', offer: id, text: 'Mira refused Brakk\'s offer.' }]);
    expect(offersOf(seen.save)).toEqual([]);
  });

  test('a giver who was out of the room ends its offer from the catch-up page it reads when it is back', () => {
    const r = newRoom();
    let { save: a, id } = offered(brakk(), pick(0, 1));
    a = deliver(a, r, A);
    const cursor = r.events.length;
    deliver(ok(offerAnswered(read(mira(), r).save, id, 'accept', OPEN)), r, B);
    const seen = offersSeen(a, r.events.filter(e => e.seq > cursor), { room: ROOM, seat: 'player' }, RULES);
    expect(seen.closed.map(c => c.close)).toEqual(['settled']);
    expect(bag(seen.save)).toEqual(['Token 2', 'Token 3']);
  });

  test('a third phone\'s accept under the offer\'s end id is void: the offer ends, nothing moves', () => {
    const r = newRoom();
    let { save: a, id } = offered(brakk(), pick(0, 1));
    a = deliver(a, r, A);
    const b = read(mira(), r).save;
    addEvent(r, C, endEvent('offerEnd', { by: KC, to: [KA], offer: id, how: 'accept', gives: NO_GOODS })!);
    const sa = read(a, r), sb = read(b, r);
    expect([sa.closed.map(c => c.close), sb.closed.map(c => c.close)]).toEqual([['void'], ['void']]);
    expect([bag(sa.save), bag(sb.save)]).toEqual([['Token 1', 'Token 2', 'Token 3'], ['Token 11', 'Token 12']]);
  });

  test('the room gone: a never-sent offer comes back; one the room may hold is stranded, and Take back after the window gives it back', () => {
    const { save: queued } = offered(brakk(), pick(0, 1));
    expect(bag(offersGone(queued, ROOM, RULES).save)).toEqual(['Token 1', 'Token 2', 'Token 3']);
    const r = newRoom(), { save, id } = offered(brakk(), pick(0, 1));
    const stranded = offersGone(deliver(save, r, A), ROOM, RULES).save;
    expect(offersOf(stranded)[0]!.state).toBe('stranded');
    expect(bag(stranded)).toEqual(['Token 2', 'Token 3']);
    expect(bag(ok(offerTakenBack(stranded, id, RULES)))).toEqual(['Token 1', 'Token 2', 'Token 3']);
  });

  test('an accept is refused once the offer was answered, and for asked gold the taker lacks', () => {
    const r = newRoom();
    let { save: a, id } = offered(brakk(), pick(0, 1), pick(80));
    a = deliver(a, r, A);
    const b = read(mira(), r).save;
    const poor = offerAnswered(b, id, 'accept', OPEN);
    expect(poor).toMatchObject({ ok: false, why: 'poor' });
    expect(refusalWords(poor as never)).toBe('You have 50 gold. This needs 80.');
    const refused = ok(offerAnswered(b, id, 'refuse', { on: false, held: true, R: RULES }));
    expect(offerAnswered(refused, id, 'accept', OPEN)).toEqual({ ok: false, why: 'not-open' });
  });

  test('the records survive a reload: the save\'s reader gives back every record whole, and drops one that does not read', () => {
    const r = newRoom();
    let { save: a, id } = offered(brakk(), pick(3, 1), pick(20, 11));
    a = deliver(a, r, A);
    const b = ok(offerAnswered(read(mira(), r).save, id, 'accept', OPEN));
    for (const s of [a, b, read(gm(), r).save]) expect(parseOffers(JSON.parse(JSON.stringify(offersOf(s))))).toEqual([...offersOf(s)]);
    const raw = JSON.parse(JSON.stringify(offersOf(b)));
    expect(parseOffers([{ ...raw[0], state: 'accepting-taken', aside: 'junk' }, { ...raw[0], offer: { ...raw[0].offer, id: 'x-e' } }, 7])).toEqual([]);
  });
});

// ── the proof of 1.8: a random walk ──
/** A seeded random number in [0, 1): the walk is the same on every run of a seed. */
function rng(seed: number): () => number {
  let x = seed >>> 0;
  return () => { x = (x + 0x6d2b79f5) >>> 0; let t = x; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
type Device = { save: Save; cursor: number; out: boolean; readonly id: DeviceId };
/**
 * The walk's world. `reclaimed`: the goods of stranded records a player took back after the room was gone, the one way 1.10
 * lets a unit be in two places (the window says so); the rules leave those units out.
 */
type World = { readonly r: Room; readonly a: Device; readonly b: Device; readonly g: Device; outcomes: Map<OfferId, Map<string, OfferOutcome>>; reclaimed: Goods[] };
const START_GOLD = 150;
/**
 * The asides a phone still owns: a record's aside stops being its side's once the room holds a settled end of its offer,
 * since that end proves the goods are the other side's (1.8, point 6: between the two reads they are the room's). So the
 * rule is over bags and the asides no settled end has given away; the design's wording "among the bags and the asides"
 * would count a settled exchange twice in the moment between the taker's read and the giver's.
 */
const liveAsides = (s: Save, r: Room): Goods[] => offersOf(s).flatMap(x => {
  if (!('aside' in x)) return [];
  const end = r.events.find(e => e.payload.eid === endIdOf(x.offer.id)), e = end ? endOf(end) : null;
  return e && outcomeOf(x.offer, e) === 'settled' ? [] : [x.aside];
});
const tokensOf = (s: Save, r: Room = newRoom()): string[] => [...s.hunters.flatMap(namesIn), ...liveAsides(s, r).flatMap(g => g.items.map(l => grantName(l.item)))];
const goldOf = (s: Save, r: Room = newRoom()): number => s.hunters.reduce((n, h) => n + h.gold, 0) + liveAsides(s, r).reduce((n, g) => n + g.gold, 0);

/** The four rules of 1.8, after every step. */
function checkRules(w: World, at: string): void {
  const twice = new Set(w.reclaimed.flatMap(g => g.items.map(l => grantName(l.item)))), extra = w.reclaimed.reduce((n, g) => n + g.gold, 0);
  const tokens = [...tokensOf(w.a.save, w.r), ...tokensOf(w.b.save, w.r)].filter(t => !twice.has(t));
  expect(new Set(tokens).size, `${at}: no token in two places among the bags and the asides`).toBe(tokens.length);
  expect(goldOf(w.a.save, w.r) + goldOf(w.b.save, w.r), `${at}: gold never exceeds the start`).toBeLessThanOrEqual(START_GOLD + extra);
  // a token's last settled move, in the room's order, names the side it left; that side's bag never holds it again until
  // a later settled offer moves it back (its phone holds it aside, unread, or not at all)
  const left = new Map<string, 'A' | 'B'>();
  for (const e of w.r.events) {
    const end = endOf(e), offerEv = end && (e.type === 'offerEnd' || e.type === 'offerStop') ? w.r.events.find(x => String(x.payload.eid) === e.payload.offer) : undefined;
    const o = offerEv?.type === 'offer' ? offerEv.payload : null;
    if (!o || !end || end.how !== 'accept' || end.by !== o.to[0] || !fits(o.asks, end.gives)) continue;
    for (const l of o.gives.items) left.set(grantName(l.item), 'A');
    for (const l of end.gives.items) left.set(grantName(l.item), 'B');
  }
  for (const [name, side] of left) if (!twice.has(name)) expect(namesIn((side === 'A' ? w.a : w.b).save.hunters[0]!), `${at}: ${name} left ${side}'s bag in a settled trade and is not back in it`).not.toContain(name);
  const ends = new Map<string, number>();
  for (const e of w.r.events) if (e.type === 'offerEnd' || e.type === 'offerStop') ends.set(e.payload.offer, (ends.get(e.payload.offer) ?? 0) + 1);
  expect([...ends.values()].every(n => n === 1), `${at}: every offer has at most one end in the room`).toBe(true);
  for (const [id, by] of w.outcomes) expect(new Set(by.values()).size, `${at}: the phones that read offer ${id}'s end read one outcome`).toBeLessThanOrEqual(1);
}
function noteClosed(w: World, who: string, closed: readonly Closed[]): void {
  for (const c of closed) {
    if (!OFFER_OUTCOMES.includes(c.close as OfferOutcome)) continue;
    const by = w.outcomes.get(c.record.offer.id) ?? new Map<string, OfferOutcome>();
    by.set(`${who} ${c.record.side}`, c.close as OfferOutcome);
    w.outcomes.set(c.record.offer.id, by);
  }
}
/** A phone tries to send its next letter; the room answers by `how`, having stored it or not (`stored`, for a hang or a refusal). The box's step and what the record heard are one write each, as sync.ts makes them. */
function send(d: Device, w: World, how: 'ok' | 'lost' | 'failed' | 'refused' | 'hang', stored: boolean): void {
  const e = nextLetter(box(d.save), ROOM);
  if (!e || e.letter.kind !== 'event' || d.out) return;
  d.save = lettersKept(withBox(d.save, boxStep(box(d.save), e.id, { type: 'send' })), RULES);
  if (w.r.gone) { d.save = lettersKept(withBox(d.save, boxStep(box(d.save), e.id, { type: 'refused', why: 'no such room' })), RULES); return; }
  // a refusal may follow a send the room stored (its answer lost, then the resend refused): the case that keeps goods aside
  if (how === 'ok' || how === 'lost' || ((how === 'hang' || how === 'refused') && stored)) addEvent(w.r, d.id, e.letter.event);
  if (how === 'ok') d.save = letterTaken(withBox(d.save, boxStep(box(d.save), e.id, { type: 'sent' })), e.id, RULES);
  if (how === 'lost' || how === 'failed') d.save = withBox(d.save, boxStep(box(d.save), e.id, { type: 'failed' }));
  if (how === 'refused') d.save = withBox(d.save, boxStep(box(d.save), e.id, { type: 'refused', why: 'bad event' }));
  d.save = lettersKept(d.save, RULES);
}
/** A phone reads a page of the room after its cursor, of `n` events; with `keep` false its cursor's write is lost and the page is read again later. */
function poll(d: Device, w: World, who: string, n: number, keep: boolean): void {
  if (d.out || w.r.gone) return;
  const page = w.r.events.filter(e => e.seq > d.cursor).slice(0, n);
  if (!page.length) return;
  const seen = offersSeen(d.save, page, { room: ROOM, seat: d.id === G ? 'gm' : 'player' }, RULES);
  d.save = lettersKept(seen.save, RULES);
  noteClosed(w, who, seen.closed);
  if (keep) d.cursor = page.at(-1)!.seq;
}
/** A phone back in the room reads on from where it stopped (seen.ts): its next polls are its catch-up. */
function rejoin(d: Device, w: World): void {
  if (!d.out || w.r.gone) return;
  d.out = false;
}
const tap = (d: Device, next: Save | Refused): void => { if (!isRefused(next)) d.save = lettersKept(next, RULES); };
/** Where the room may close: from step `after`, with this chance a step. */
type Closing = { readonly after: number; readonly chance: number };
function walk(seed: number, steps: number, closing: Closing | null): World {
  const rand = rng(seed), any = <T>(xs: readonly T[]): T | undefined => xs[Math.floor(rand() * xs.length)];
  const w: World = { r: newRoom(), a: { save: phone(A, hunterOf('Brakk', 100, [1, 2, 3, 4])), cursor: 0, out: false, id: A }, b: { save: phone(B, hunterOf('Mira', 50, [11, 12, 13])), cursor: 0, out: false, id: B }, g: { save: gm(), cursor: 0, out: false, id: G }, outcomes: new Map(), reclaimed: [] };
  const devices = [['A', w.a], ['B', w.b], ['G', w.g]] as const;
  for (let i = 0; i < steps; i++) {
    if (closing && i >= closing.after && !w.r.gone && rand() < closing.chance) {
      w.r.gone = true;
      for (const [, x] of devices) { const gone = offersGone(x.save, ROOM, RULES); x.save = lettersKept(withBox(gone.save, roomGone(box(gone.save), ROOM)), RULES); }
      checkRules(w, `seed ${seed} step ${i} (the room is gone)`);
      continue;
    }
    const roll = rand(), [who, d] = any(devices)!;
    let what = '';
    if (roll < 0.12) {
      what = 'Brakk offers';
      const mine = bagOf(w.a.save.hunters[0]!, RULES), theirs = bagOf(w.b.save.hunters[0]!, RULES);
      const give = rand() < 0.8 ? any(mine) : undefined, ask = rand() < 0.3 ? any(theirs) : undefined;
      const gives: BagPick = { gold: give && rand() < 0.7 ? 0 : 5, items: give ? [{ id: give.id, qty: 1, name: give.name }] : [] };
      const asks: BagPick = { gold: rand() < 0.4 ? 5 : 0, items: ask ? [{ id: ask.id, qty: 1, name: ask.name }] : [] };
      tap(w.a, offerPosted(w.a.save, { hid: hid('h1'), to: KB, toName: 'Mira', gives, asks, at: AT, stamp: { device: A, now: T0 + i, rand: rand() }, ...OPEN }));
    } else if (roll < 0.2) {
      const r = any(offersOf(w.b.save).filter(x => x.side === 'taker'));
      what = 'Mira answers';
      if (r) tap(w.b, offerAnswered(w.b.save, r.offer.id, rand() < 0.75 ? 'accept' : 'refuse', OPEN));
    } else if (roll < 0.26) {
      what = 'Brakk or Mira takes back';
      const p = rand() < 0.75 ? w.a : w.b, r = any(offersOf(p.save));
      if (r?.state === 'stranded') w.reclaimed.push('aside' in r ? r.aside : NO_GOODS);
      if (r) tap(p, offerTakenBack(p.save, r.offer.id, RULES));
    } else if (roll < 0.3) {
      what = 'the GM stops';
      const r = any(offersOf(w.g.save));
      if (r) tap(w.g, offerStopped(w.g.save, r.offer.id, RULES));
    } else if (roll < 0.55) {
      const how = any(['ok', 'ok', 'ok', 'lost', 'failed', 'refused', 'hang'] as const)!;
      what = `${who} sends (${how})`;
      send(d, w, how, rand() < 0.5);
    } else if (roll < 0.8) {
      what = `${who} polls`;
      poll(d, w, who, 1 + Math.floor(rand() * 4), rand() < 0.85);
    } else if (roll < 0.85) {
      what = `${who} reloads`;
      d.save = lettersKept(withBox(d.save, reloaded(box(d.save))), RULES);
      d.cursor = Math.max(0, d.cursor);
    } else if (roll < 0.89) {
      what = `${who} lets a queued letter go`;
      const e = any(box(d.save).filter(x => x.at === 'queued'));
      if (e) d.save = lettersKept(withBox(d.save, boxStep(box(d.save), e.id, { type: 'drop' })), RULES);
    } else if (roll < 0.93) {
      what = `${who} is removed or comes back`;
      if (d.out) rejoin(d, w); else d.out = true;
    } else if (roll < 0.96) {
      what = 'a junk end';
      const r = any(offersOf(w.b.save).filter(x => x.side === 'taker'));
      const by = rand() < 0.5 ? KC : KB, from = by === KC ? C : B;
      const ev = r && endEvent('offerEnd', { by, to: [KA], offer: r.offer.id, how: 'accept', gives: { gold: 999, items: [] } });
      if (ev && !w.r.gone) addEvent(w.r, from, ev);
    }
    checkRules(w, `seed ${seed} step ${i} (${what})`);
  }
  return w;
}
/** At rest: every phone back in the room, every letter taken, every open offer ended (the GM stops what it watches, Brakk takes back the rest), every page read. */
function rest(w: World): void {
  const devices = [['A', w.a], ['B', w.b], ['G', w.g]] as const;
  for (let round = 0; round < 12; round++) {
    for (const [who, d] of devices) {
      rejoin(d, w);
      d.save = lettersKept(withBox(d.save, reloaded(box(d.save))), RULES);
      for (let n = 0; n < 50 && nextLetter(box(d.save), ROOM); n++) send(d, w, 'ok', true);
      poll(d, w, who, 10_000, true);
    }
    for (const r of offersOf(w.g.save)) tap(w.g, offerStopped(w.g.save, r.offer.id, RULES));
    for (const r of offersOf(w.a.save)) tap(w.a, offerTakenBack(w.a.save, r.offer.id, RULES));
    checkRules(w, `rest round ${round}`);
  }
}

const GONE: Closing = { after: 60, chance: 0.05 };
describe('never doubled, never lost: two players and the GM against the room', () => {
  for (let seed = 1; seed <= 120; seed++) {
    test(`walk ${seed}: the rules hold after every step, and at rest every token is in exactly one bag and the gold is whole`, () => {
      const w = walk(seed, 260, null);
      rest(w);
      for (const d of [w.a, w.b, w.g]) expect(offersOf(d.save), `seed ${seed}: no record left`).toEqual([]);
      const tokens = [...tokensOf(w.a.save), ...tokensOf(w.b.save)].sort();
      expect(tokens, `seed ${seed}: every token in exactly one bag`).toEqual(['Token 1', 'Token 11', 'Token 12', 'Token 13', 'Token 2', 'Token 3', 'Token 4']);
      expect(goldOf(w.a.save) + goldOf(w.b.save), `seed ${seed}: the gold is whole`).toBe(START_GOLD);
    });
  }

  test('300 walks with the room gone mid-trade: the rules hold after every step, before and after (a stranded record keeps its goods aside)', () => {
    let gone = 0;
    for (let seed = 1001; seed <= 1300; seed++) if (walk(seed, 200, GONE).r.gone) gone++;
    expect(gone, 'the room closed in nearly every one of them').toBeGreaterThan(290);
  });

  test('the walks do what they are for: offers settle, are refused, withdrawn, stopped and voided, and the room is sometimes gone', () => {
    const seen = new Set<string>();
    let gone = 0;
    for (let seed = 1; seed <= 120; seed++) {
      const w = walk(seed, 260, seed % 4 === 0 ? GONE : null);
      if (w.r.gone) gone++;
      for (const by of w.outcomes.values()) for (const o of by.values()) seen.add(o);
    }
    expect([...seen].sort()).toEqual(['refused', 'settled', 'stopped', 'void', 'withdrawn']);
    expect(gone).toBeGreaterThan(0);
  });
});

// keep the parser of a stored event in view: the walk's room holds only what the room's reader takes
test('every event the walk\'s room holds is one the server\'s reader takes', () => {
  const w = walk(7, 260, null);
  for (const e of w.r.events) expect(parseEvent(e.type, e.payload), e.type).not.toBeNull();
});
