import { grantName } from '../src/core/registry/item-book.ts';
import { describe, expect, test } from 'bun:test';
import { GOODS_GOLD_MAX, GOODS_LINES, NO_GOODS, OFFER_MAX, fits, goodsSize, goodsWords, handOver, parseBagPick, parseGoods, received, refusalWords, setAside } from '../src/core/trade/goods.ts';
import type { BagPick, Goods } from '../src/core/trade/goods.ts';
import { bagOf, equip, putItem } from '../src/core/hunter/inventory.ts';
import { SHOP_ITEMS, STARTER_GEAR, parseItem } from '../src/core/registry/items.ts';
import { itemDefDataOf } from '../src/core/registry/item-book.ts';
import type { ItemGrant } from '../src/core/registry/item-book.ts';
import { useItem } from '../src/core/hunter/use.ts';
import { REVIVE_HP } from '../src/core/hunter/vitals.ts';
import { THING_MAX } from '../src/core/size.ts';
import { RULES } from '../src/core/rules.ts';
import { freshSave, newHunter } from '../src/core/save.ts';
import type { Hunter, Save } from '../src/core/save.ts';
import { isRefused } from '../src/core/save-step.ts';
import type { Refused } from '../src/core/save-step.ts';
import { dev, hid, iid } from './fixtures/ids.ts';
import type { ItemId } from '../src/core/ids.ts';
import { adhocOf, customId, refOf, rulesWith } from './fixtures/items.ts';

const ok = <T extends object>(v: T): Exclude<T, Refused> => { if (isRefused(v)) throw new Error(`refused: ${v.why}`); return v as Exclude<T, Refused>; };
const SHIELD_ID = STARTER_GEAR.towerShield.defId, POTION_ID = STARTER_GEAR.manaPotion.defId;
const shield = (qty = 1): ItemGrant => refOf(SHIELD_ID, { qty });
const potion = (qty = 1): ItemGrant => refOf(POTION_ID, { qty });
/** Brakk: 3 mana potions (i1), a tower shield (i2), 150 gold. */
const brakk = (): Hunter => putItem(putItem({ ...newHunter(RULES), id: hid('h1'), name: 'Brakk', gold: 150 }, potion(3), iid('i1'), RULES), shield(), iid('i2'), RULES);
const names = (h: Hunter, R = RULES) => bagOf(h, R).map(i => [i.id, i.name, i.qty]);
const note = (n: number) => ({ op: 'note', text: 'x'.repeat(n) });
/** `Tome <i>`: the largest item `parseItem` takes, within two bytes of `THING_MAX.item`. */
const tome = (i: number) => Array.from({ length: 501 }, (_, n) => parseItem({ name: `Tome ${i}`, type: 'accessory', desc: 'ࠀ'.repeat(n) + 'x'.repeat(500 - n), effects: Array(12).fill(note(200)), worn: { label: 'w', desc: 'x'.repeat(500), ops: Array(12).fill(note(200)) } })).findLast(it => it !== null)!;
const counter = (start: number) => { let n = start; return (): ItemId => iid(`i${++n}`); };
const pick = (gold: number, ...items: [string, number, string][]): BagPick => ({ gold, items: items.map(([id, qty, name]) => ({ id: iid(id), qty, name })) });

describe('setting goods aside and receiving them', () => {
  test('two of three potions and 20 gold leave the bag as goods by reference, with the bag ids and names they had', () => {
    const out = ok(setAside(brakk(), pick(20, ['i1', 2, 'Mana Potion']), RULES));
    expect(out.goods).toEqual({ gold: 20, items: [{ from: iid('i1'), item: potion(2) }] });
    expect(out.hunter.items.find(i => i.id === 'i1')!.qty).toBe(1);
    expect(out.hunter.gold).toBe(130);
  });

  test('round trip: goods set aside and received back leave the hunter as it was (the recipe "A control that undoes another")', () => {
    const h = brakk(), out = ok(setAside(h, pick(150, ['i1', 3, 'Mana Potion'], ['i2', 1, 'Dented Tower Shield']), RULES));
    expect(out.hunter.items).toEqual([]);
    expect(out.hunter.gold).toBe(0);
    // the whole stack and the shield come back under new ids, the only stated difference
    const back = received(out.hunter, out.goods, counter(10), RULES);
    expect({ ...back, items: back.items.map(i => ({ ...i, id: 'x' })) }).toEqual({ ...h, items: h.items.map(i => ({ ...i, id: 'x' })) });
  });

  test('received goods join a stack the bag holds, and gear makes its own entry', () => {
    const h = brakk(), got = received(h, { gold: 5, items: [{ from: iid('i9'), item: potion(2) }, { from: iid('i8'), item: shield() }] }, counter(20), RULES);
    expect(got.items.map(i => [i.id, i.qty])).toEqual([['i1', 5], ['i2', 1], ['i22', 1]]);
    expect(got.gold).toBe(155);
  });

  test('a worn item is refused with its name: take it off first', () => {
    const h = ok(equip(brakk(), 'i2', iid('i90'), false, RULES));
    const r = setAside(h, pick(0, ['i2', 1, 'Dented Tower Shield']), RULES);
    expect(r).toMatchObject({ ok: false, why: 'worn' });
    expect(refusalWords(r as never)).toBe('Take off the Dented Tower Shield to give it.');
  });

  test('setAside reads wornOf(h, R): an item whose def lost its slot or was pushed out by a two-handed edit can be given', () => {
    const shieldDef = itemDefDataOf(parseItem({ name: 'Buckler', type: 'armor', slot: 'offhand' })!);
    const swordDef = itemDefDataOf(parseItem({ name: 'Blade', type: 'weapon', slot: 'weapon', dice: '1d6' })!);
    const shId = customId('buckler'), swId = customId('blade');
    const R1 = rulesWith({ [shId]: shieldDef, [swId]: swordDef });
    let h: Hunter = { ...newHunter(RULES), id: hid('h1'), name: 'Brakk', gold: 0 };
    h = putItem(putItem(h, refOf(swId), iid('i1'), R1), refOf(shId), iid('i2'), R1);
    h = ok(equip(ok(equip(h, 'i1', iid('i90'), false, R1)), 'i2', iid('i91'), false, R1));
    // editing the shield def to have no slot makes it unworn under R2 even while raw h.equipped still names i2
    const R2 = rulesWith({ [shId]: { ...shieldDef, slot: null, type: 'misc' }, [swId]: swordDef });
    const given = ok(setAside(h, pick(0, ['i2', 1, 'Buckler']), R2));
    expect(given.goods.items).toHaveLength(1);
    expect(given.hunter.items.map(i => i.id)).toEqual(['i1']);
    // editing the weapon def to two-handed drops offhand in wornOf, so offhand can be given while the weapon stays refused
    const R3 = rulesWith({ [shId]: shieldDef, [swId]: { ...swordDef, twoHanded: true } });
    expect(setAside(h, pick(0, ['i1', 1, 'Blade']), R3)).toMatchObject({ ok: false, why: 'worn' });
    expect(ok(setAside(h, pick(0, ['i2', 1, 'Buckler']), R3)).hunter.items.map(i => i.id)).toEqual(['i1']);
  });

  test('an item no longer held, more of a stack than held, or more gold than held is refused with how short it falls', () => {
    const gone = setAside(brakk(), pick(0, ['i7', 1, 'Iron Shield']), RULES);
    expect(gone).toMatchObject({ ok: false, why: 'no-item' });
    expect(refusalWords(gone as never)).toBe('You no longer have the Iron Shield.');
    const few = setAside(brakk(), pick(0, ['i1', 4, 'Mana Potion']), RULES);
    expect(few).toMatchObject({ ok: false, why: 'few', short: { name: 'Mana Potion', have: 3, need: 4 } });
    const poor = setAside(brakk(), pick(151), RULES);
    expect(poor).toMatchObject({ ok: false, why: 'poor' });
    expect(refusalWords(poor as never)).toBe('You have 150 gold. This needs 151.');
  });

  test('nothing picked is refused; so is more than eight lines or more gold than one offer carries', () => {
    expect(setAside(brakk(), pick(0), RULES)).toEqual({ ok: false, why: 'empty' });
    const nine = pick(0, ...Array.from({ length: GOODS_LINES + 1 }, (_, i): [string, number, string] => [`i${i + 1}`, 1, 'x']));
    expect(setAside(brakk(), nine, RULES)).toEqual({ ok: false, why: 'too-large' });
    expect(setAside({ ...brakk(), gold: 2e9 }, pick(GOODS_GOLD_MAX + 1), RULES)).toEqual({ ok: false, why: 'too-large' });
  });

  test('eight custom items at an item\'s size are put aside for one offer, each carrying its def: nothing the readers take is refused for its size', () => {
    const defs = Object.fromEntries(Array.from({ length: GOODS_LINES }, (_, i) => [customId(`tome${i + 1}`), itemDefDataOf(tome(i + 1))]));
    const R = rulesWith(defs);
    let h: Hunter = { ...newHunter(RULES), id: hid('h1') };
    Object.keys(defs).forEach((id, i) => { h = putItem(h, refOf(id as never), iid(`i${i + 1}`), R); });
    expect(goodsSize(tome(1)), 'each within two bytes of the size').toBeGreaterThan(THING_MAX.item - 3);
    const lines = bagOf(h, R).map((it): [string, number, string] => [it.id, 1, it.name]);
    const goods = ok(setAside(h, pick(0, ...lines), R)).goods;
    expect(goods.items).toHaveLength(GOODS_LINES);
    expect(goods.items.every(l => l.item.kind === 'ref' && l.item.def?.name === grantName(l.item)), 'each custom line carries its def').toBe(true);
  });

  test('eight ad hoc items at an item\'s size are put aside for one offer', () => {
    let h: Hunter = { ...newHunter(RULES), id: hid('h1') };
    for (let i = 1; i <= GOODS_LINES; i++) h = putItem(h, adhocOf(tome(i)), iid(`i${i}`), RULES);
    const lines = bagOf(h, RULES).map((it): [string, number, string] => [it.id, 1, it.name]);
    expect(ok(setAside(h, pick(0, ...lines), RULES)).goods.items).toHaveLength(GOODS_LINES);
  });
});

describe('what an accept carries against what the offer asked', () => {
  const asked = pick(20, ['i4', 1, 'Iron Shield']);
  const line = (from: string, qty: number) => ({ from: iid(from), item: shield(qty) });
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
    const s = ok(handOver(save(), hid('h1'), hid('h2'), pick(10, ['i1', 1, 'Mana Potion']), { held: false }, counter(50), RULES));
    expect(s.hunters[0]!.items.find(i => i.id === 'i1')!.qty).toBe(2);
    expect(s.hunters[0]!.gold).toBe(140);
    expect(s.hunters[1]!.items).toEqual([{ kind: 'ref', id: iid('i51'), defId: POTION_ID, qty: 1 }]);
    expect(s.hunters[1]!.gold).toBe(10);
  });
  test('refused to itself, for a hunter not on the phone, while a fight holds the giver, or for goods it lacks; the save is not touched', () => {
    expect(handOver(save(), hid('h1'), hid('h1'), pick(1), { held: false }, counter(0), RULES)).toEqual({ ok: false, why: 'same-hunter' });
    expect(handOver(save(), hid('h1'), hid('h9'), pick(1), { held: false }, counter(0), RULES)).toEqual({ ok: false, why: 'no-hunter' });
    expect(handOver(save(), hid('h1'), hid('h2'), pick(1), { held: true }, counter(0), RULES)).toEqual({ ok: false, why: 'fight' });
    expect(handOver(save(), hid('h1'), hid('h2'), pick(999), { held: false }, counter(0), RULES)).toMatchObject({ ok: false, why: 'poor' });
  });
  test('Brakk gives dead Eldrin a Resurrection Crystal, and Eldrin uses it to come back (the owner, Nov 19: another player may give one in death; Nov 22: it counts as bought before the death)', () => {
    const crystal = refOf(SHOP_ITEMS.find(d => d.name === 'Resurrection Crystal (S)')!.defId);
    const s0 = save(), withCrystal: Save = { ...s0, hunters: [putItem(s0.hunters[0]!, crystal, iid('i3'), RULES), { ...s0.hunters[1]!, life: { at: 'dead' } }] };
    const s = ok(handOver(withCrystal, hid('h1'), hid('h2'), pick(0, ['i3', 1, 'Resurrection Crystal (S)']), { held: false }, counter(60), RULES));
    const eldrin = s.hunters[1]!;
    expect(names(eldrin)).toEqual([['i61', 'Resurrection Crystal (S)', 1]]);
    expect(ok(useItem(eldrin, 'i61', [], RULES)).hunter.life).toEqual({ at: 'up', hp: REVIVE_HP });
  });
});

describe('goods on the wire', () => {
  test('goodsSize is the JSON\'s bytes in UTF-8: one byte for ASCII, two for é, three for €', () => {
    expect(goodsSize('a')).toBe(3);
    expect(goodsSize('é')).toBe(4);
    expect(goodsSize('€')).toBe(5);
    expect(goodsSize({ gold: 20, items: [] })).toBe('{"gold":20,"items":[]}'.length);
  });

  test('the cap is a whole number of KiB that leaves the request around the payload at least 4 KiB of the server\'s 64 KiB body', () => {
    expect(OFFER_MAX % 1024).toBe(0);
    expect(64 * 1024 - OFFER_MAX).toBeGreaterThanOrEqual(4 * 1024);
  });

  const goods: Goods = { gold: 20, items: [{ from: iid('i1'), item: potion(2) }] };
  test('goods read back whole', () => {
    expect(parseGoods(JSON.parse(JSON.stringify(goods)))).toEqual(goods);
    const custom: Goods = { gold: 0, items: [{ from: iid('i1'), item: { kind: 'ref', defId: customId('tome1'), qty: 1, def: itemDefDataOf(tome(1)) } }, { from: iid('i2'), item: adhocOf(tome(2)) }] };
    expect(parseGoods(JSON.parse(JSON.stringify(custom))), 'a custom line with its def and an ad hoc line').toEqual(custom);
    expect(parseBagPick(pick(5, ['i3', 2, 'Iron Shield']))).toEqual(pick(5, ['i3', 2, 'Iron Shield']));
  });

  test('goods are read strictly: a bad line, a line too many, two lines from one bag id or gold that is not a whole number in bounds refuses all of it', () => {
    const line = goods.items[0]!;
    expect(parseGoods({ ...goods, items: [line, { from: 'nope', item: potion() }] })).toBeNull();
    expect(parseGoods({ ...goods, items: [line, { from: iid('i2'), item: { kind: 'adhoc', qty: 1, item: { desc: 'no name' } } }] })).toBeNull();
    expect(parseGoods({ ...goods, items: Array.from({ length: GOODS_LINES + 1 }, (_, i) => ({ from: `i${i + 1}`, item: potion() })) })).toBeNull();
    expect(parseGoods({ ...goods, items: [line, line] })).toBeNull();
    for (const gold of [-1, 1.5, GOODS_GOLD_MAX + 1, '20', null]) expect(parseGoods({ ...goods, gold })).toBeNull();
    expect(parseBagPick({ gold: 0, items: [{ id: 'i1', qty: 0, name: 'x' }] })).toBeNull();
    expect(parseBagPick({ gold: 0, items: [{ id: 'i1', qty: 1, name: 'x' }, { id: 'i1', qty: 2, name: 'x' }] })).toBeNull();
    expect(parseBagPick({ gold: 0, items: [{ id: 'i1', qty: 1 }] })).toBeNull();
  });

  test('goods in words: one is counted before its name, more after it, and gold last', () => {
    expect(goodsWords({ gold: 20, items: [{ from: iid('i1'), item: potion(1) }, { from: iid('i2'), item: shield(3) }] })).toBe('1 Mana Potion, Dented Tower Shield × 3 and 20 gold');
    expect(goodsWords(NO_GOODS)).toBe('nothing');
  });
});
