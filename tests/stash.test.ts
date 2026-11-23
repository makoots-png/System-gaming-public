// The party stash (src/core/trade/stash.ts, notes-5-trade.md section 3): a put and a take on a phone alone, a player's
// ask answered by the GM's phone in the order the room brings asks, each refusal, and an ask whose letter was lost.
import { describe, expect, test } from 'bun:test';
import { freshSave } from '../src/core/save.ts';
import type { Hunter, Save } from '../src/core/save.ts';
import { isRefused } from '../src/core/save-step.ts';
import type { Refused } from '../src/core/save-step.ts';
import { RULES } from '../src/core/rules.ts';
import { STASH_LINES } from '../src/core/protocol.ts';
import type { RoomEvent, StashAnswerPayload, StashAskPayload } from '../src/core/protocol.ts';
import { parseItem } from '../src/core/registry/items.ts';
import type { Item } from '../src/core/registry/items.ts';
import { roomGone, step } from '../src/core/sync/outbox.ts';
import type { Outbox } from '../src/core/sync/outbox.ts';
import { askedGone, askedOf, shownOf } from '../src/core/sync/asked.ts';
import { STASH_WAITING, asksKept, stashAsked, stashDeposit, stashDismissed, stashLanded, stashPut, stashRemove, stashTake, stashTaken, stranded } from '../src/core/trade/stash.ts';
import type { StashPick } from '../src/core/trade/stash.ts';
import { dev, hid, iid, room } from './fixtures/ids.ts';

const AT = '2026-11-22T20:00:00.000Z', T = Date.parse(AT), ROOM = room('ABCD23'), LOG = { at: AT, cap: RULES.logCap };
const POTION = parseItem({ name: 'Healing Potion', type: 'consumable' })!;
const ON = { on: true, held: false };
const env = (d: string) => ({ now: new Date(AT), newDeviceToken: () => 'test-device-token-0123456789abcd', newDeviceId: () => dev(d) });
/** A phone with one hunter, `name`, holding 3 Healing Potions and 100 gold; a player's phone plays it in room ABCD23. */
function phone(d: string, name: string, seat: 'alone' | 'player' = 'player'): Save {
  const s = freshSave(env(d), { onboarded: true }), h = s.hunters[0]!;
  const sync = seat === 'player' ? { ...s.settings.sync, room: ROOM, boundHunterId: h.id } : s.settings.sync;
  return { ...s, hunters: [{ ...h, name, gold: 100, items: [{ ...POTION, id: iid('i500'), qty: 3 }] }], settings: { ...s.settings, sync } };
}
/** The GM's phone with a stash of `items` and `gold`. */
const gm = (items: Item[], gold = 0): Save => ({ ...freshSave(env('d-gm'), { onboarded: true }), stash: { gold, items } });
const hunter = (s: Save): Hunter => s.hunters[0]!;
const potions = (s: { readonly items: readonly Item[] }): number => s.items.filter(i => i.name === 'Healing Potion').reduce((n, i) => n + i.qty, 0);
const ok = <T>(r: T): Exclude<T, Refused<string>> => { if (isRefused(r as never)) throw new Error(`refused: ${(r as { why: string }).why}`); return r as Exclude<T, Refused<string>>; };
const letters = (s: Save): RoomEvent[] => (s.settings.sync.outbox ?? []).flatMap(e => (e.letter.kind === 'event' ? [e.letter.event] : []));
const withBox = (s: Save, f: (b: Outbox) => Outbox): Save => ({ ...s, settings: { ...s.settings, sync: { ...s.settings.sync, outbox: f(s.settings.sync.outbox ?? []) } } });
/** Player `s` asks the stash for `want`: its save, and the ask's message as the GM's phone reads it. */
function ask(s: Save, want: StashPick, n: number): { save: Save; p: StashAskPayload } {
  const save = ok(stashAsked(s, { hid: hunter(s).id, want, at: AT, stamp: { device: s.settings.deviceId, now: T + n, rand: 0.5 }, ...ON }));
  const ev = letters(save).at(-1)!;
  if (ev.type !== 'stashAsk') throw new Error('no ask posted');
  return { save, p: ev.payload };
}
/** The GM's phone answers `p`: its save, and the answer it posted. */
function answered(g: Save, p: StashAskPayload, n: number, on = true): { save: Save; a: StashAnswerPayload } {
  const save = ok(stashTaken(g, p, { on, room: ROOM, stamp: { device: 'd-gm', now: T + 100 + n, rand: 0.5 }, log: LOG }));
  const ev = letters(save).at(-1)!;
  if (ev.type !== 'stashAnswer') throw new Error('no answer posted');
  return { save, a: ev.payload };
}

describe('a phone alone puts and takes in one write', () => {
  test('two potions put in and one taken out: the bag and the stash move together, each logged', () => {
    const s0 = phone('d-alone', 'Mira', 'alone'), hid = hunter(s0).id;
    const put = ok(stashPut(s0, hid, { gold: 20, items: [{ id: iid('i500'), qty: 2, name: 'Healing Potion' }] }, ON, LOG));
    expect([potions(hunter(put)), hunter(put).gold, potions(put.stash), put.stash.gold]).toEqual([1, 80, 2, 20]);
    const line = put.stash.items[0]!;
    const took = ok(stashTake(put, hid, { kind: 'take', item: line.id, qty: 1, name: line.name }, ON, LOG));
    expect([potions(hunter(took)), potions(took.stash)]).toEqual([2, 1]);
    const gold = ok(stashTake(took, hid, { kind: 'gold', gold: 20 }, ON, LOG));
    expect([hunter(gold).gold, gold.stash.gold]).toEqual([100, 0]);
    expect(gold.log.slice(0, 3).map(l => l.text)).toEqual(['Mira took 20 gold from the stash.', 'Mira took 1 Healing Potion from the stash.', 'Mira put Healing Potion × 2 and 20 gold in the stash.']);
  });

  test('a put stacks with a line of the same item, as a bag does', () => {
    const s0 = phone('d-alone', 'Mira', 'alone'), hid = hunter(s0).id, one = { gold: 0, items: [{ id: iid('i500'), qty: 1, name: 'Healing Potion' }] };
    const twice = ok(stashPut(ok(stashPut(s0, hid, one, ON, LOG)), hid, one, ON, LOG));
    expect(twice.stash.items.map(i => [i.name, i.qty])).toEqual([['Healing Potion', 2]]);
  });

  test('the GM removes a line: it is gone and logged', () => {
    const g = gm([{ ...POTION, id: iid('i900'), qty: 3 }]);
    const out = ok(stashRemove(g, iid('i900'), LOG));
    expect([out.stash.items, out.log[0]!.text]).toEqual([[], 'You removed Healing Potion × 3 from the stash.']);
    expect(stashRemove(out, iid('i900'), LOG)).toEqual({ ok: false, why: 'gone' });
  });

  test('stashDeposit stacks items into the party stash, logs the reason, and refuses full when over STASH_LINES', () => {
    const g = gm([{ ...POTION, id: iid('i900'), qty: 1 }]);
    const out = ok(stashDeposit(g, [POTION], LOG, 'Goblin Den clear'));
    expect(out.stash.items.map(i => [i.name, i.qty])).toEqual([['Healing Potion', 2]]);
    expect(out.log[0]!.text).toBe('Goblin Den clear: 1 Healing Potion.');
    expect(stashDeposit(g, [], LOG, 'Nothing')).toBe(g);
    const full = Array.from({ length: STASH_LINES }, (_, i) => ({ ...parseItem({ name: `Relic ${i}`, type: 'accessory' })!, id: iid(`i${800 + i}`), qty: 1 }));
    expect(stashDeposit(gm(full), [POTION], LOG, 'Overflow')).toEqual({ ok: false, why: 'full' });
  });
});

describe('a player asks, the GM\'s phone answers in the order asks arrive', () => {
  test('two takes of the last potion: the first given, the second refused gone', () => {
    const mira = ask(phone('d-mira', 'Mira'), { kind: 'take', item: iid('i900'), qty: 1, name: 'Healing Potion' }, 1);
    const eldrin = ask(phone('d-eldrin', 'Eldrin'), { kind: 'take', item: iid('i900'), qty: 1, name: 'Healing Potion' }, 2);
    const first = answered(gm([{ ...POTION, id: iid('i900'), qty: 1 }]), mira.p, 1), second = answered(first.save, eldrin.p, 2);
    expect([first.a.verdict, second.a.verdict, second.save.stash.items]).toEqual(['given', 'refused', []]);
    const m = ok(stashLanded(mira.save, first.a)), e = ok(stashLanded(eldrin.save, second.a));
    expect([potions(hunter(m.save)), potions(hunter(e.save))]).toEqual([4, 3]);
    expect([m.text, e.text]).toEqual(['From the stash: 1 Healing Potion.', 'The stash has no Healing Potion left.']);
    expect(second.save.log.slice(0, 2).map(l => l.text)).toEqual(['Eldrin asked the stash for 1 Healing Potion: refused (gone).', 'Mira took 1 Healing Potion from the stash.']);
  });

  test('a put waits aside in its ask until the GM\'s phone keeps it; no phone shows a take as its own before the answer', () => {
    const p = ask(phone('d-mira', 'Mira'), { kind: 'put', pick: { gold: 0, items: [{ id: iid('i500'), qty: 2, name: 'Healing Potion' }] } }, 1);
    expect([potions(hunter(p.save)), askedOf(p.save).length]).toEqual([1, 1]);
    const g = answered(gm([]), p.p, 1);
    expect([potions(g.save.stash), g.a.verdict]).toEqual([2, 'kept']);
    const landed = ok(stashLanded(p.save, g.a));
    expect([potions(hunter(landed.save)), askedOf(landed.save), landed.text]).toEqual([1, [], 'In the stash: Healing Potion × 2.']);
    const t = ask(landed.save, { kind: 'take', item: g.save.stash.items[0]!.id, qty: 1, name: 'Healing Potion' }, 2);
    expect(potions(hunter(t.save)), 'a take moves nothing before its answer').toBe(1);
  });
});

describe('each refusal', () => {
  const take = (qty: number): StashPick => ({ kind: 'take', item: iid('i900'), qty, name: 'Healing Potion' });
  test('the GM\'s phone refuses off, full, gone and short, and says what the stash holds', () => {
    const line = { ...POTION, id: iid('i900'), qty: 1 };
    const put = ask(phone('d-mira', 'Mira'), { kind: 'put', pick: { gold: 0, items: [{ id: iid('i500'), qty: 1, name: 'Healing Potion' }] } }, 1);
    expect(answered(gm([line]), put.p, 1, false).a).toMatchObject({ verdict: 'refused', why: 'off' });
    const kinds = Array.from({ length: STASH_LINES }, (_, i) => ({ ...parseItem({ name: `Charm ${i}`, type: 'accessory' })!, id: iid(`i${700 + i}`), qty: 1 }));
    expect(answered(gm(kinds), put.p, 2).a, `past ${STASH_LINES} kinds of item`).toMatchObject({ verdict: 'refused', why: 'full' });
    expect(answered(gm([line, ...kinds.slice(1)]), put.p, 3).a, 'a put that joins a line is no new kind').toMatchObject({ verdict: 'kept' });
    expect(answered(gm([]), ask(phone('d-mira', 'Mira'), take(1), 2).p, 4).a).toMatchObject({ verdict: 'refused', why: 'gone', have: 0 });
    const short = answered(gm([line]), ask(phone('d-mira', 'Mira'), take(2), 3).p, 5).a;
    expect(short).toMatchObject({ verdict: 'refused', why: 'short', have: 1 });
    expect(ok(stashLanded(ask(phone('d-mira', 'Mira'), take(2), 3).save, short)).text).toBe('The stash has 1 Healing Potion, fewer than you asked for.');
    const gold = answered(gm([], 30), ask(phone('d-mira', 'Mira'), { kind: 'gold', gold: 50 }, 4).p, 6).a;
    expect(gold).toMatchObject({ verdict: 'refused', why: 'short', have: 30 });
  });

  test('a refused put brings its goods back on the player\'s phone', () => {
    const put = ask(phone('d-mira', 'Mira'), { kind: 'put', pick: { gold: 0, items: [{ id: iid('i500'), qty: 2, name: 'Healing Potion' }] } }, 1);
    const landed = ok(stashLanded(put.save, answered(gm([]), put.p, 1, false).a));
    expect([potions(hunter(landed.save)), landed.text]).toEqual([3, 'Trading is off for this table. Back in your bag: Healing Potion × 2.']);
  });

  test('the player\'s tap is refused out of a room, for a hunter it does not play there, in a fight, with trading off, and past STASH_WAITING asks', () => {
    const p = phone('d-mira', 'Mira'), mira = hunter(p).id, stamp = { device: 'd-mira', now: T, rand: 0.5 };
    const tap = (s: Save, gate = ON) => stashAsked(s, { hid: mira, want: take(1), at: AT, stamp, ...gate });
    expect(tap({ ...p, settings: { ...p.settings, sync: { ...p.settings.sync, room: null } } })).toEqual({ ok: false, why: 'no-room' });
    expect(tap({ ...p, settings: { ...p.settings, sync: { ...p.settings.sync, boundHunterId: hid('h9') } } })).toEqual({ ok: false, why: 'not-played' });
    expect(tap(p, { on: true, held: true })).toEqual({ ok: false, why: 'fight' });
    expect(tap(p, { on: false, held: false })).toEqual({ ok: false, why: 'off' });
    let s = p;
    for (let i = 0; i < STASH_WAITING; i++) s = ask(s, take(1), 10 + i).save;
    expect(stashAsked(s, { hid: mira, want: take(1), at: AT, stamp: { ...stamp, now: T + 99 }, ...ON })).toEqual({ ok: false, why: 'too-many' });
  });
});

describe('a put whose letter the room did not take', () => {
  const putOf = () => ask(phone('d-mira', 'Mira'), { kind: 'put', pick: { gold: 0, items: [{ id: iid('i500'), qty: 2, name: 'Healing Potion' }] } }, 1);
  /** A write as store.ts `apply` makes it: the step's answer, then the every-write step. */
  const written = (s: Save, f: (b: Outbox) => Outbox): Save => asksKept(withBox(s, f));
  const sentOnce = (s: Save, eid: string): Save => written(s, b => step(b, eid, { type: 'send' }));

  test('a put lost before a try comes back by itself, in the write that lets its letter go', () => {
    const { save, p } = putOf();
    const dropped = written(save, b => step(b, p.eid, { type: 'drop' }));
    expect([potions(hunter(dropped)), askedOf(dropped)], 'a full outbox let it go').toEqual([3, []]);
    const gone = asksKept(withBox(askedGone(save, ROOM), b => roomGone(b, ROOM)));
    expect([potions(hunter(gone)), askedOf(gone)], 'the room gone before it was sent').toEqual([3, []]);
    expect(asksKept(dropped), 'a second run changes nothing').toBe(dropped);
  });

  test('a put lost after a try is stranded: its goods stay aside, and Take back asks first', () => {
    const { save, p } = putOf(), sending = sentOnce(save, p.eid);
    expect(askedOf(sending)[0]!.sent, 'heard sent in the write that put it on its way').toBe(true);
    const box = (s: Save): Outbox => s.settings.sync.outbox ?? [];
    const dropped = written(written(sending, b => step(b, p.eid, { type: 'failed' })), b => step(b, p.eid, { type: 'drop' }));
    const refused = written(sending, b => step(b, p.eid, { type: 'refused', why: 'kicked' }));
    const gone = asksKept(withBox(askedGone(sending, ROOM), b => roomGone(b, ROOM)));
    for (const [why, s] of [['let go', dropped], ['refused: a first send may have been stored, its answer lost', refused], ['the room gone', gone]] as const) {
      expect([potions(hunter(s)), stranded(askedOf(s)[0]!, box(s))], why).toEqual([1, true]);
    }
    expect(potions(hunter(ok(stashDismissed(dropped, p.eid)))), 'Take back after the window').toBe(3);
  });

  test('a take lost before a try holds nothing, so it stays for the player to put away', () => {
    const t = ask(phone('d-mira', 'Mira'), { kind: 'take', item: iid('i900'), qty: 1, name: 'Healing Potion' }, 1);
    const dropped = written(t.save, b => step(b, t.p.eid, { type: 'drop' })), w = askedOf(dropped)[0]!;
    expect([shownOf(w, dropped.settings.sync.outbox ?? []).state, stranded(w, dropped.settings.sync.outbox ?? [])]).toEqual(['lost', false]);
    expect(askedOf(ok(stashDismissed(dropped, t.p.eid)))).toEqual([]);
  });

  test('a put the room took is not put away: the GM\'s phone holds the stash and answers it', () => {
    const { save, p } = putOf();
    const taken = { ...save, settings: { ...save.settings, sync: { ...save.settings.sync, outbox: [], asked: askedOf(save).map(w => ({ ...w, state: 'taken' as const, sent: true })) } } };
    expect(stashDismissed(taken, p.eid)).toEqual({ ok: false, why: 'no-ask' });
  });
});
