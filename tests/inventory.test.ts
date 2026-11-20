import { describe, expect, test } from 'bun:test';
import { BUY_WORDS, SHOP_CLOSED, addGold, buy, editItem, equip, putItem, removeItem, sell, sellPrice, sellable, setGold, shopOpen, takeItems, unequip, withShop, writeShopItem, removeShopItem } from '../src/core/hunter/inventory.ts';
import { SHOP_ITEMS, STARTER_GEAR, itemOf, parseItem, priceOf } from '../src/core/registry/items.ts';
import type { ItemTemplate } from '../src/core/registry/items.ts';
import { RANKS, RULES } from '../src/core/rules.ts';
import type { Rules } from '../src/core/rules.ts';
import { newHunter } from '../src/core/save.ts';
import type { Hunter } from '../src/core/save.ts';
import { isRefused } from '../src/core/save-step.ts';
import type { Refused } from '../src/core/save-step.ts';
import { iid } from './fixtures/ids.ts';
import { WAYS_BACK } from '../src/core/hunter/vitals.ts';

const ok = <T extends object>(v: T): Exclude<T, Refused> => { if (isRefused(v)) throw new Error(`refused: ${v.why}`); return v as Exclude<T, Refused>; };
const shield = itemOf(RULES, STARTER_GEAR.towerShield);
const potion = itemOf(RULES, STARTER_GEAR.manaPotion);
const ring = (name: string): ItemTemplate => ({ ...shield, name, type: 'accessory', slot: 'ring1', weight: 0, armor: 0, resist: 0, bonus: { str: 1 } });
const hunter = (gold = 100): Hunter => ({ ...newHunter(RULES), gold });
/** What the Association pays for one of a thing priced `price`: `saleShare` of it, rounded down, at least 1 (economy design 3). */
const sale = (price: number, R: Pick<Rules, 'saleShare'> = RULES): number => (price > 0 ? Math.max(1, Math.floor(price * R.saleShare)) : 0);

describe('the bag', () => {
  const differing: [string, Partial<ItemTemplate>][] = [['description', { desc: 'a second telling' }], ['attack', { attack: 'shot' }], ['flat penetration', { penFlat: 3 }], ['grade', { grade: 1 }]];
  for (const [what, change] of differing) {
    test(`two slotless things that differ only in their ${what} stay two stacks`, () => {
      const h = putItem(putItem(hunter(), potion, iid('i1')), { ...potion, ...change }, iid('i2'));
      expect(h.items.map(i => i.id)).toEqual(['i1', 'i2']);
      expect(h.items[1]).toMatchObject(change);
    });
  }

  test('a thing without a slot joins its stack; gear makes its own entry', () => {
    const h = putItem(putItem(hunter(), potion, iid('i1')), potion, iid('i2'));
    expect(h.items).toEqual([{ ...potion, id: 'i1', qty: 2 }]);
    const g = putItem(putItem(hunter(), shield, iid('i1')), shield, iid('i2'));
    expect(g.items.map(i => i.id)).toEqual(['i1', 'i2']);
  });

  test('an Epic+ and an Epic of one name are two stacks, two Epic+ are one, and an Epic read with no grade joins the Epic', () => {
    const idol = parseItem({ name: 'Idol', rar: 'epic', type: 'material' })!, plus = parseItem({ name: 'Idol', rar: 'epic', type: 'material', grade: 1 })!;
    const h = [plus, idol, plus, parseItem({ name: 'Idol', rar: 'epic', type: 'material', grade: 0 })!].reduce((x, it, n) => putItem(x, it, iid(`i${n + 1}`)), hunter());
    expect(h.items.map(i => [i.id, i.grade ?? 0, i.qty])).toEqual([['i1', 1, 2], ['i2', 0, 2]]);
  });

  test('round trip: an item put in the bag and removed leaves the hunter as it was', () => {
    const h = hunter();
    expect(ok(removeItem(putItem(h, shield, iid('i1')), 'i1'))).toEqual(h);
  });

  test('taking the last one of a worn item takes it out of its slot too', () => {
    const worn = ok(equip(putItem(hunter(), shield, iid('i1')), 'i1', iid('i900')));
    const gone = ok(takeItems(worn, 'i1', 1));
    expect(gone.items).toEqual([]);
    expect(gone.equipped.offhand).toBeNull();
    expect(takeItems(gone, 'i1', 1)).toEqual({ ok: false, why: 'no-item' });
  });

  test('an edit keeps the id; gear edited into a thing without a slot is taken off', () => {
    const worn = ok(equip(putItem(hunter(), shield, iid('i1')), 'i1', iid('i900')));
    const edited = ok(editItem(worn, 'i1', { ...shield, name: 'Plank', slot: null, type: 'misc' }));
    expect(edited.items[0]).toMatchObject({ id: 'i1', name: 'Plank' });
    expect(edited.equipped.offhand).toBeNull();
  });
});

describe('what is worn', () => {
  test('round trip: equip then unequip leaves the hunter as it was', () => {
    const h = putItem(hunter(), shield, iid('i1'));
    expect(ok(unequip(ok(equip(h, 'i1', iid('i900'))), 'offhand'))).toEqual(h);
  });

  test('a ring goes to the first free ring slot; a third swaps out the one in its own slot', () => {
    let h = putItem(putItem(putItem(hunter(), ring('A'), iid('r1')), ring('B'), iid('r2')), ring('C'), iid('r3'));
    h = ok(equip(h, 'r1', iid('i901'))); h = ok(equip(h, 'r2', iid('i901')));
    expect([h.equipped.ring1, h.equipped.ring2]).toEqual(['r1', 'r2']);
    h = ok(equip(h, 'r3', iid('i901')));
    expect([h.equipped.ring1, h.equipped.ring2]).toEqual(['r3', 'r2']);
  });

  test('one of a stack of gear is split off and worn', () => {
    const two = { ...putItem(hunter(), shield, iid('i1')), items: [{ ...shield, id: iid('i1'), qty: 2 }] };
    const h = ok(equip(two, 'i1', iid('i9')));
    expect(h.items.map(i => [i.id, i.qty])).toEqual([['i1', 1], ['i9', 1]]);
    expect(h.equipped.offhand).toBe(iid('i9'));
  });

  test('a thing without a slot, an item not held and a word that is not a slot are refused', () => {
    expect(equip(putItem(hunter(), potion, iid('i1')), 'i1', iid('i901'))).toEqual({ ok: false, why: 'not-gear' });
    expect(equip(hunter(), 'nope', iid('i901'))).toEqual({ ok: false, why: 'no-item' });
    expect(unequip(hunter(), 'tail')).toEqual({ ok: false, why: 'no-slot' });
  });
});

describe('gold, buying and selling', () => {
  test('round trip: gold given then taken back is what it was, and never goes below 0', () => {
    expect(addGold(addGold(hunter(40), 25), -25)).toEqual(hunter(40));
    expect(addGold(hunter(10), -50).gold).toBe(0);
    expect(setGold(hunter(), -3).gold).toBe(0);
  });

  test('selling pays saleShare of the price, a quarter, rounded down, at least 1 gold; a free item sells for nothing', () => {
    expect(sellPrice({ value: 25, rar: 'common', type: 'misc' }, RULES), 'a quarter of 25').toBe(6);
    expect(sellPrice({ value: 1, rar: 'common', type: 'misc' }, RULES)).toBe(1);
    expect(sellPrice({ rar: 'common', type: 'misc' }, RULES), 'no value: the rule\'s price, the one a shop asks').toBe(sale(priceOf(RULES, 'common')));
    expect(sellPrice({ value: 0, rar: 'common', type: 'misc' }, RULES)).toBe(0);
    expect(sellPrice({ value: 25, rar: 'common', type: 'misc' }, { ...RULES, saleShare: 0.5 }), 'a GM\'s share of a half').toBe(12);
  });

  test('an Epic+ without a price of its own is bought at 7,500 and sold for 1,875, an Epic− at 3,333 and for 833 (block [2.1])', () => {
    const idol = (grade: number) => parseItem({ name: 'Idol', rar: 'epic', type: 'material', grade })!;
    for (const [grade, price] of [[1, 7500], [-1, 3333]] as const) {
      const h = hunter(1e5), bought = ok(buy(h, idol(grade), iid('i1'), RULES));
      expect([grade, h.gold - bought.gold, sellPrice(idol(grade), RULES)]).toEqual([grade, price, sale(price)]);
    }
    expect([sale(7500), sale(3333)]).toEqual([1875, 833]);
  });

  test('an item without a price of its own is bought and sold at the price rule as it is now', () => {
    const dear: Rules = { ...RULES, loot: Object.fromEntries(RANKS.map(r => [r, { ...RULES.loot[r], gold: RULES.loot[r].gold.map(g => g * 3) }])) as Rules['loot'] };
    const h = hunter(1e6), { value: _typed, ...byRule } = shield;
    const bought = ok(buy(h, byRule, iid('i1'), dear));
    expect(h.gold - bought.gold).toBe(3 * priceOf(RULES, shield.rar));
    expect(ok(sell(bought, 'i1', 1, dear)).gold - bought.gold).toBe(sale(3 * priceOf(RULES, shield.rar)));
  });

  test('round trip: buy then sell gives back the item and costs the price less what it sells for', () => {
    const h = hunter(500), it = { ...shield, value: 25 };
    const back = ok(sell(ok(buy(h, it, iid('i1'), RULES)), 'i1', 1, RULES));
    expect({ ...back, gold: 0, chronicle: h.chronicle }).toEqual({ ...h, gold: 0 });
    expect(h.gold - back.gold).toBe(25 - sale(25));
    // the System remembers both: the purchase at its price, and the sale at its share of it
    expect(back.chronicle.inbox).toEqual([
      { kind: 'shop', act: 'buy', item: it.name, rar: it.rar, price: 25, goldAfter: 475 },
      { kind: 'shop', act: 'sell', item: it.name, rar: it.rar, price: sale(25), goldAfter: 475 + sale(25) },
    ]);
  });

  test('buying with too little gold is refused; selling more than is held sells what is held', () => {
    expect(buy(hunter(3), { ...shield, value: 25 }, iid('i1'), RULES)).toEqual({ ok: false, why: 'poor' });
    const three = { ...hunter(0), items: [{ ...potion, id: iid('i1'), qty: 3, value: 10 }] };
    const sold = ok(sell(three, 'i1', 9, RULES));
    expect(sold.items).toEqual([]);
    expect(sold.gold).toBe(3 * sale(10));
  });
});

describe('the GM\'s shop', () => {
  test('an edit replaces the item of that name, a new one goes at the end, a removal takes its place out', () => {
    const shown = [potion, shield];
    expect(writeShopItem(shown, potion.name, { ...potion, value: 99 })[0]!.value).toBe(99);
    expect(writeShopItem(shown, null, ring('A')).map(t => t.name)).toEqual([potion.name, shield.name, 'A']);
    expect(removeShopItem(shown, 0)).toEqual([shield]);
    expect(shown).toEqual([potion, shield]);
  });
});

test('the GM\'s shop list is set as one step, a copy of the list given, and set back to none for the default shop (implicit audit 3, I3)', () => {
  const list = [{ name: 'Rope', rar: 'common', type: 'material', qty: 1 }] as never[];
  const set = withShop<{ shop: never[] | null; other: number }>({ shop: null, other: 1 }, list);
  expect(set).toEqual({ shop: list, other: 1 });
  expect(set.shop).not.toBe(list);
  expect(withShop(set, null)).toEqual({ shop: null, other: 1 });
});

describe('a Resurrection Crystal is not bought back (notes-2b-crystal.md section 3)', () => {
  const crystal = itemOf(RULES, SHOP_ITEMS.find(d => d.name === 'Resurrection Crystal')!);

  test('a sale is refused and changes nothing; its sell price is 0; any other item still sells for its share', () => {
    const h = putItem(hunter(0), crystal, iid('i1'));
    expect(sellable(crystal)).toBe(false);
    expect(sell(h, 'i1', 1, RULES)).toEqual({ ok: false, why: 'unsellable' });
    expect(sellPrice(crystal, RULES)).toBe(0);
    const { revive: _r, ...plain } = crystal;
    expect(sellPrice(plain, RULES), 'the same price without the revive sells for its share').toBe(sale(100000));
  });

  test('bought, it costs its price and joins the bag; a copy that does not revive is its own stack', () => {
    const h = ok(buy(hunter(100000), crystal, iid('i1'), RULES));
    expect([h.gold, h.items.map(i => [i.name, i.qty])]).toEqual([0, [['Resurrection Crystal', 1]]]);
    const { revive: _r, ...plain } = crystal;
    expect(putItem(h, plain, iid('i2')).items.map(i => i.id)).toEqual(['i1', 'i2']);
    expect(putItem(h, crystal, iid('i3')).items.map(i => [i.id, i.qty])).toEqual([['i1', 2]]);
  });
});

describe('the shop is closed to the dead (the owner, Nov 19: "Whole shop should be closed in death")', () => {
  const crystal = itemOf(RULES, SHOP_ITEMS.find(d => d.name === 'Resurrection Crystal')!);
  const rich = (life: Hunter['life']): Hunter => ({ ...putItem(hunter(200000), potion, iid('i1')), life });

  test('a dead hunter buys nothing, a Resurrection Crystal included, and sells nothing; the hunter is left as it was', () => {
    const dead = rich({ at: 'dead' });
    expect(buy(dead, crystal, iid('i2'), RULES)).toEqual({ ok: false, why: 'dead' });
    expect(buy(dead, potion, iid('i2'), RULES)).toEqual({ ok: false, why: 'dead' });
    expect(sell(dead, 'i1', 1, RULES)).toEqual({ ok: false, why: 'dead' });
    expect(shopOpen(dead)).toBe(false);
  });

  test('a hunter who is down, dying or stable, still buys and sells', () => {
    for (const life of [{ at: 'dying', successes: 0, failures: 0 }, { at: 'stable' }] as const) {
      expect(shopOpen({ life })).toBe(true);
      expect(ok(buy(rich(life), potion, iid('i2'), RULES)).items.find(i => i.id === 'i1')!.qty).toBe(2);
      expect(ok(sell(rich(life), 'i1', 1, RULES)).items).toEqual([]);
    }
  });

  test('a refused purchase says why: short of gold names the item; dead names the ways back and who can give a crystal', () => {
    expect(BUY_WORDS.poor('Health Potion')).toBe('Not enough gold for Health Potion.');
    expect(BUY_WORDS.dead('Health Potion')).toBe(SHOP_CLOSED);
    expect(SHOP_CLOSED).toBe(`The shop is closed while you are dead. You cannot buy or sell. ${WAYS_BACK} brings you back. The GM or another hunter can give you a Resurrection Crystal.`);
  });
});
