import { describe, expect, test } from 'bun:test';
import { GOODS_GOLD_MAX, GOODS_LINES, NO_GOODS, OFFER_MAX, fits, goodsSize, goodsWords, handOver, parseBagPick, parseGoods, received, refusalWords, setAside } from '../src/core/trade/goods.ts';
import type { BagPick, Goods } from '../src/core/trade/goods.ts';
import { equip, putItem } from '../src/core/hunter/inventory.ts';
import { STARTER_GEAR, itemOf } from '../src/core/registry/items.ts';
import { RULES } from '../src/core/rules.ts';
import { freshSave, newHunter } from '../src/core/save.ts';
import type { Hunter, Save } from '../src/core/save.ts';
import { isRefused } from '../src/core/save-step.ts';
import type { Refused } from '../src/core/save-step.ts';
import { dev, hid, iid } from './fixtures/ids.ts';
import type { ItemId } from '../src/core/ids.ts';

const ok = <T extends object>(v: T): Exclude<T, Refused> => { if (isRefused(v)) throw new Error(`refused: ${v.why}`); return v as Exclude<T, Refused>; };
const shield = itemOf(RULES, STARTER_GEAR.towerShield);
const potion = itemOf(RULES, STARTER_GEAR.manaPotion);
/** Brakk: 3 mana potions (i1), a tower shield (i2), 150 gold. */
const brakk = (): Hunter => putItem(putItem({ ...newHunter(RULES), id: hid('h1'), name: 'Brakk', gold: 150 }, { ...potion, qty: 3 }, iid('i1')), shield, iid('i2'));
const counter = (start: number) => { let n = start; return (): ItemId => iid(`i${++n}`); };
const pick = (gold: number, ...items: [string, number, string][]): BagPick => ({ gold, items: items.map(([id, qty, name]) => ({ id: iid(id), qty, name })) });

describe('setting goods aside and receiving them', () => {
  test('two of three potions and 20 gold leave the bag as goods by value, with the bag ids they had', () => {
    const out = ok(setAside(brakk(), pick(20, ['i1', 2, 'Mana Potion'])));
    expect(out.goods).toEqual({ gold: 20, items: [{ from: iid('i1'), item: { ...potion, qty: 2 } }] });
    expect(out.hunter.items.find(i => i.id === 'i1')!.qty).toBe(1);
    expect(out.hunter.gold).toBe(130);
  });

  test('round trip: goods set aside and received back leave the hunter as it was (the recipe "A control that undoes another")', () => {
    const h = brakk(), out = ok(setAside(h, pick(150, ['i1', 3, 'Mana Potion'], ['i2', 1, 'Dented Tower Shield'])));
    expect(out.hunter.items).toEqual([]);
    expect(out.hunter.gold).toBe(0);
    // the whole stack and the shield come back under new ids, the only stated difference
    const back = received(out.hunter, out.goods, counter(10));
    expect({ ...back, items: back.items.map(i => ({ ...i, id: 'x' })) }).toEqual({ ...h, items: h.items.map(i => ({ ...i, id: 'x' })) });
  });

  test('received goods join a stack the bag holds, and gear makes its own entry', () => {
    const h = brakk(), got = received(h, { gold: 5, items: [{ from: iid('i9'), item: { ...potion, qty: 2 } }, { from: iid('i8'), item: shield }] }, counter(20));
    expect(got.items.map(i => [i.id, i.qty])).toEqual([['i1', 5], ['i2', 1], ['i22', 1]]);
    expect(got.gold).toBe(155);
  });

  test('a worn item is refused with its name: take it off first', () => {
    const h = ok(equip(brakk(), 'i2', iid('i90')));
    const r = setAside(h, pick(0, ['i2', 1, 'Dented Tower Shield']));
    expect(r).toMatchObject({ ok: false, why: 'worn' });
    expect(refusalWords(r as never)).toBe('Take off the Dented Tower Shield to give it.');
  });

  test('an item no longer held, more of a stack than held, or more gold than held is refused with how short it falls', () => {
    const gone = setAside(brakk(), pick(0, ['i7', 1, 'Iron Shield']));
    expect(gone).toMatchObject({ ok: false, why: 'no-item' });
    expect(refusalWords(gone as never)).toBe('You no longer have the Iron Shield.');
    const few = setAside(brakk(), pick(0, ['i1', 4, 'Mana Potion']));
    expect(few).toMatchObject({ ok: false, why: 'few', short: { name: 'Mana Potion', have: 3, need: 4 } });
    const poor = setAside(brakk(), pick(151));
    expect(poor).toMatchObject({ ok: false, why: 'poor' });
    expect(refusalWords(poor as never)).toBe('You have 150 gold. This needs 151.');
  });

  test('nothing picked is refused; so is more than eight lines or more gold than one offer carries', () => {
    expect(setAside(brakk(), pick(0))).toEqual({ ok: false, why: 'empty' });
    const nine = pick(0, ...Array.from({ length: GOODS_LINES + 1 }, (_, i): [string, number, string] => [`i${i + 1}`, 1, 'x']));
    expect(setAside(brakk(), nine)).toEqual({ ok: false, why: 'too-large' });
    expect(setAside({ ...brakk(), gold: 2e9 }, pick(GOODS_GOLD_MAX + 1))).toEqual({ ok: false, why: 'too-large' });
  });

  test('goods past the offer\'s byte cap are refused as too large', () => {
    // a line of 12 notes of 200 three-byte characters (7,200 bytes of text, about 7.5 kB with its item): eight such lines are over 49,152 bytes, six are not
    const note = { op: 'note' as const, text: '\u0800'.repeat(200) };
    let h: Hunter = { ...newHunter(RULES), id: hid('h1') };
    for (let i = 1; i <= 8; i++) h = putItem(h, { ...potion, name: `Tome ${i}`, effects: Array(12).fill(note) }, iid(`i${i}`));
    const lines = h.items.map((it): [string, number, string] => [it.id, 1, it.name]);
    expect(setAside(h, pick(0, ...lines))).toEqual({ ok: false, why: 'too-large' });
    expect(ok(setAside(h, pick(0, ...lines.slice(0, 6)))).goods.items).toHaveLength(6);
  });
});

describe('what an accept carries against what the offer asked', () => {
  const asked = pick(20, ['i4', 1, 'Iron Shield']);
  const line = (from: string, qty: number) => ({ from: iid(from), item: { ...shield, qty } });
  test('the same gold and, for each asked line, one line from that bag id with that count: it fits', () => {
    expect(fits(asked, { gold: 20, items: [line('i4', 1)] })).toBe(true);
    expect(fits(pick(0), NO_GOODS)).toBe(true);
  });
  test('other gold, another item, another count, an extra line or a missing one: it does not', () => {
    expect(fits(asked, { gold: 19, items: [line('i4', 1)] })).toBe(false);
    expect(fits(asked, { gold: 20, items: [line('i5', 1)] })).toBe(false);
    expect(fits(asked, { gold: 20, items: [line('i4', 2)] })).toBe(false);
    expect(fits(asked, { gold: 20, items: [line('i4', 1), line('i6', 1)] })).toBe(false);
    expect(fits(asked, { gold: 20, items: [] })).toBe(false);
    expect(fits(pick(0), { gold: 1, items: [] })).toBe(false);
  });
});

describe('a hand over between two hunters of one phone', () => {
  const save = (): Save => ({ ...freshSave({ now: new Date('2026-11-19T12:00:00Z'), newDeviceToken: () => 'test-device-token-0123456789abcd', newDeviceId: () => dev('d-phone') }, { onboarded: true }), hunters: [brakk(), { ...newHunter(RULES), id: hid('h2'), name: 'Eldrin', gold: 0 }] });
  test('Brakk gives Eldrin a potion and 10 gold in one write: out of one bag, into the other', () => {
    const s = ok(handOver(save(), hid('h1'), hid('h2'), pick(10, ['i1', 1, 'Mana Potion']), { held: false }, counter(50)));
    expect(s.hunters[0]!.items.find(i => i.id === 'i1')!.qty).toBe(2);
    expect(s.hunters[0]!.gold).toBe(140);
    expect(s.hunters[1]!.items).toEqual([{ ...potion, qty: 1, id: 'i51' }]);
    expect(s.hunters[1]!.gold).toBe(10);
  });
  test('refused to itself, for a hunter not on the phone, while a fight holds the giver, or for goods it lacks; the save is not touched', () => {
    expect(handOver(save(), hid('h1'), hid('h1'), pick(1), { held: false }, counter(0))).toEqual({ ok: false, why: 'same-hunter' });
    expect(handOver(save(), hid('h1'), hid('h9'), pick(1), { held: false }, counter(0))).toEqual({ ok: false, why: 'no-hunter' });
    expect(handOver(save(), hid('h1'), hid('h2'), pick(1), { held: true }, counter(0))).toEqual({ ok: false, why: 'fight' });
    expect(handOver(save(), hid('h1'), hid('h2'), pick(999), { held: false }, counter(0))).toMatchObject({ ok: false, why: 'poor' });
  });
});

describe('goods on the wire', () => {
  test('goodsSize is the JSON\'s bytes in UTF-8: one byte for ASCII, two for é, three for €', () => {
    expect(goodsSize('a')).toBe(3);
    expect(goodsSize('é')).toBe(4);
    expect(goodsSize('€')).toBe(5);
    expect(goodsSize({ gold: 20, items: [] })).toBe('{"gold":20,"items":[]}'.length);
  });

  test('the cap leaves 16 KiB of the server\'s 64 KiB body for the request around the payload', () => {
    expect(OFFER_MAX).toBe(64 * 1024 - 16 * 1024);
  });

  const goods: Goods = { gold: 20, items: [{ from: iid('i1'), item: { ...potion, qty: 2 } }] };
  test('goods read back whole', () => {
    expect(parseGoods(JSON.parse(JSON.stringify(goods)))).toEqual(goods);
    expect(parseBagPick(pick(5, ['i3', 2, 'Iron Shield']))).toEqual(pick(5, ['i3', 2, 'Iron Shield']));
  });

  test('goods are read strictly: a bad line, a line too many, two lines from one bag id or gold that is not a whole number in bounds refuses all of it', () => {
    const line = goods.items[0]!;
    expect(parseGoods({ ...goods, items: [line, { from: 'nope', item: potion }] })).toBeNull();
    expect(parseGoods({ ...goods, items: [line, { from: iid('i2'), item: { desc: 'no name' } }] })).toBeNull();
    expect(parseGoods({ ...goods, items: Array.from({ length: GOODS_LINES + 1 }, (_, i) => ({ from: `i${i + 1}`, item: potion })) })).toBeNull();
    expect(parseGoods({ ...goods, items: [line, line] })).toBeNull();
    for (const gold of [-1, 1.5, GOODS_GOLD_MAX + 1, '20', null]) expect(parseGoods({ ...goods, gold })).toBeNull();
    expect(parseBagPick({ gold: 0, items: [{ id: 'i1', qty: 0, name: 'x' }] })).toBeNull();
    expect(parseBagPick({ gold: 0, items: [{ id: 'i1', qty: 1, name: 'x' }, { id: 'i1', qty: 2, name: 'x' }] })).toBeNull();
    expect(parseBagPick({ gold: 0, items: [{ id: 'i1', qty: 1 }] })).toBeNull();
  });

  test('goods in words: one is counted before its name, more after it, and gold last', () => {
    expect(goodsWords({ gold: 20, items: [{ from: iid('i1'), item: { ...potion, qty: 1 } }, { from: iid('i2'), item: { ...shield, qty: 3 } }] })).toBe('1 Mana Potion, Dented Tower Shield × 3 and 20 gold');
    expect(goodsWords(NO_GOODS)).toBe('nothing');
  });
});
