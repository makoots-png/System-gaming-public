// inventory.ts: what a hunter carries and wears, and its gold: an item put in the bag (stacking), taken out, used up,
// worn and taken off, bought and sold, edited; and the GM's shop list. Pure. A view changes these only through a
// function here, in `store.apply` (src/core/save-step.ts); a change to what is worn changes the sheet, so chain
// `fitted` (sheet.ts) after it. Ids are arguments: the store reserves one (`store.id('i')`).
//
// Selling pays less than buying: an item sells for half its price (`valueOf`), rounded down, and at least 1 gold when it
// has a price (`sellPrice`). So
// buy then sell gives back the item and leaves the hunter `price - sellPrice` gold poorer; tests/inventory.test.ts
// asserts that difference. An item that revives is not bought back (`sellable`).
//
// The shop is closed to a dead hunter (`shopOpen`): it buys nothing and sells nothing. The owner, Nov 19: "When a
// player/party dies, they should only be able to be revived by the gm or through resurrection crystals. They can not buy
// it in death", then "Whole shop should be closed in death." A crystal still reaches a dead hunter from the GM (an award)
// or from another hunter (goods.ts `handOver`, offer.ts), and the dead hunter may use it (use.ts `useItem`).
import { valueOf } from '../registry/items.ts';
import type { Item, ItemTemplate, Slot } from '../registry/items.ts';
import type { Rules } from '../rules.ts';
import { refuse } from '../save-step.ts';
import type { Refused } from '../save-step.ts';
import type { ItemId } from '../ids.ts';
import { record } from './chronicle.ts';
import type { Chronicle } from './chronicle.ts';
import { WAYS_BACK } from './vitals.ts';
import type { Life } from './vitals.ts';

type Carrying = { items: Item[]; equipped: Record<Slot, ItemId | null>; gold: number };

/** What makes two unworn things one stack: everything but the id and the count. */
const stackKey = (i: ItemTemplate | Item): string => [i.name, i.rar, i.type, i.dice, i.value, i.weight, i.armor, i.resist, JSON.stringify(i.bonus), JSON.stringify(i.effects ?? []), i.target ?? '', i.tell ? 'tell' : '', i.revive ? 'revive' : ''].join('|');
const stackable = (i: ItemTemplate | Item): boolean => !i.slot;
/** The held item a new one would join, or null when it makes its own entry. */
export const stackOf = (h: Carrying, it: ItemTemplate): Item | null =>
  (stackable(it) && h.items.find(x => stackable(x) && stackKey(x) === stackKey(it))) || null;

/**
 * Whether the Association buys an item back: not one that revives (the Resurrection Crystal). The GM decides how many
 * exist, and a sale would turn a crystal the GM gave into half its price in gold the GM never gave (notes-2b-crystal.md 3).
 */
export const sellable = (i: Pick<Item, 'revive'>): boolean => !i.revive;
/**
 * What one of an item sells for: half its price (`valueOf`: its own, else the rule's), rounded down, at least 1; a free
 * item, or one not bought back (`sellable`), sells for nothing. (Before, an item priced 0 sold for half of base value
 * times multiplier, a second price rule.)
 */
export const sellPrice = (i: Pick<Item, 'value' | 'rar' | 'revive'>, R: Pick<Rules, 'baseValue' | 'rarities'>): number => {
  const price = sellable(i) ? valueOf(i, R) : 0;
  return price > 0 ? Math.max(1, Math.floor(price / 2)) : 0;
};

/** Every slot that held `id` emptied. */
const unwear = (equipped: Record<Slot, ItemId | null>, id: string): Record<Slot, ItemId | null> =>
  Object.fromEntries(Object.entries(equipped).map(([s, v]) => [s, v === id ? null : v])) as Record<Slot, ItemId | null>;

/** The save with the GM's shop list `shop` (a copy), or with none: the default shop of the rules is shown (`defaultShop`). */
export const withShop = <S extends { shop: ItemTemplate[] | null }>(save: S, shop: readonly ItemTemplate[] | null): S => ({ ...save, shop: shop === null ? null : [...shop] });
/** An item (already read by `parseItem`) put in the bag: onto its stack, else as its own entry under `id`. */
export function putItem<H extends Carrying>(h: H, it: ItemTemplate, id: ItemId): H {
  const into = stackOf(h, it);
  if (into) return { ...h, items: h.items.map(x => (x === into ? { ...x, qty: x.qty + it.qty } : x)) };
  return { ...h, items: [...h.items, { ...it, id }] };
}
/** An item taken out of the bag whole, and out of any slot it was in. One not held is refused (`no-item`). */
export function removeItem<H extends Carrying>(h: H, itemId: string): H | Refused<'no-item'> {
  if (!h.items.some(i => i.id === itemId)) return refuse('no-item');
  return { ...h, items: h.items.filter(i => i.id !== itemId), equipped: unwear(h.equipped, itemId) };
}
/** `n` fewer of an item (at most what is held); the last one leaves the bag and any slot. One not held is refused (`no-item`). */
export function takeItems<H extends Carrying>(h: H, itemId: string, n = 1): H | Refused<'no-item'> {
  const it = h.items.find(i => i.id === itemId);
  if (!it) return refuse('no-item');
  const left = it.qty - Math.min(it.qty, Math.max(1, Math.trunc(n) || 1));
  return left > 0 ? { ...h, items: h.items.map(i => (i.id === itemId ? { ...i, qty: left } : i)) } : removeItem(h, itemId);
}
/** The item maker's edit of a held item: its fields replaced, its id kept; one that lost its slot is taken off. */
export function editItem<H extends Carrying>(h: H, itemId: string, it: ItemTemplate): H | Refused<'no-item'> {
  if (!h.items.some(i => i.id === itemId)) return refuse('no-item');
  return { ...h, items: h.items.map(i => (i.id === itemId ? { ...it, id: itemId } : i)), equipped: it.slot ? h.equipped : unwear(h.equipped, itemId) };
}

/** Gold added, or taken with a number below 0; never below 0. */
export const addGold = <H extends Carrying>(h: H, n: number): H => ({ ...h, gold: Math.max(0, h.gold + (Math.trunc(n) || 0)) });
/** The GM's edit of the gold to a number; never below 0. */
export const setGold = <H extends Carrying>(h: H, n: number): H => ({ ...h, gold: Math.max(0, Math.trunc(n) || 0) });

/**
 * An item worn in its slot, swapping out whatever was there. A ring goes to the first free ring slot. From a stack of
 * more than one, one is split off under `splitId` and worn. Refused when the item is not held (`no-item`) or has no
 * slot (`not-gear`).
 */
export function equip<H extends Carrying>(h: H, itemId: string, splitId: ItemId): H | Refused<'no-item' | 'not-gear'> {
  const it = h.items.find(i => i.id === itemId);
  if (!it) return refuse('no-item');
  if (!it.slot) return refuse('not-gear');
  const slot: Slot = it.slot.startsWith('ring') ? (!h.equipped.ring1 ? 'ring1' : !h.equipped.ring2 ? 'ring2' : it.slot) : it.slot;
  const split = it.qty > 1;
  const wornId = split ? splitId : it.id;
  const items = split ? [...h.items.map(i => (i.id === it.id ? { ...i, qty: i.qty - 1 } : i)), { ...it, id: splitId, qty: 1 }] : h.items;
  return { ...h, items, equipped: { ...unwear(h.equipped, wornId), [slot]: wornId } };
}
/** The slot emptied. A word that is not a slot is refused (`no-slot`). */
export function unequip<H extends Carrying>(h: H, slot: string): H | Refused<'no-slot'> {
  return slot in h.equipped ? { ...h, equipped: { ...h.equipped, [slot]: null } } : refuse('no-slot');
}

/** Whether the shop trades with a hunter in this life: with anyone but the dead. Down, dying or stable, it still trades. */
export const shopOpen = (h: { readonly life: Pick<Life, 'at'> }): boolean => h.life.at !== 'dead';
/** What the shop says to a dead hunter, in place of its Buy and Sell buttons and when a purchase or a sale is refused. */
export const SHOP_CLOSED = `The shop is closed while you are dead. You cannot buy or sell. ${WAYS_BACK} brings you back. The GM or another hunter can give you a Resurrection Crystal.`;
/** Why a purchase may be refused. */
export const BUY_REFUSALS = ['poor', 'dead'] as const;
export type BuyRefusal = (typeof BUY_REFUSALS)[number];
/** The words of a purchase refused, for the item named `name`. */
export const BUY_WORDS: { readonly [W in BuyRefusal]: (name: string) => string } = {
  poor: name => `Not enough gold for ${name}.`,
  dead: () => SHOP_CLOSED,
};

/** A purchase or a sale is a fact of the chronicle (chronicle.ts), recorded with it. The shop reads the life (`shopOpen`). */
type Trading = Carrying & { readonly chronicle: Chronicle; readonly life: Life };
/** An item bought at its price (`valueOf`): refused for a dead hunter (`dead`), and when the gold is short (`poor`). */
export function buy<H extends Trading>(h: H, it: ItemTemplate, id: ItemId, R: Pick<Rules, 'baseValue' | 'rarities'>): H | Refused<BuyRefusal> {
  if (!shopOpen(h)) return refuse('dead');
  const price = valueOf(it, R);
  if (h.gold < price) return refuse('poor');
  const gold = h.gold - price;
  return record(putItem({ ...h, gold }, it, id), { kind: 'shop', act: 'buy', item: it.name, rar: it.rar, price, goldAfter: gold });
}
/**
 * `n` of an item sold (at most what is held), each for `sellPrice`. Refused for a dead hunter (`dead`), for one not held
 * (`no-item`) and for one not bought back (`unsellable`).
 */
export function sell<H extends Trading>(h: H, itemId: string, n: number, R: Pick<Rules, 'baseValue' | 'rarities'>): H | Refused<'dead' | 'no-item' | 'unsellable'> {
  if (!shopOpen(h)) return refuse('dead');
  const it = h.items.find(i => i.id === itemId);
  if (!it) return refuse('no-item');
  if (!sellable(it)) return refuse('unsellable');
  const cnt = Math.min(Math.max(1, Math.trunc(n) || 1), it.qty);
  const out = takeItems(h, itemId, cnt);
  if (!('items' in out)) return out;
  const price = sellPrice(it, R) * cnt, gold = h.gold + price;
  return record({ ...out, gold }, { kind: 'shop', act: 'sell', item: it.name, rar: it.rar, price, goldAfter: gold });
}
/** What `sell` pays for `n` of an item. */
export const sellTotal = (it: Item, n: number, R: Pick<Rules, 'baseValue' | 'rarities'>): number => sellPrice(it, R) * Math.min(Math.max(1, Math.trunc(n) || 1), it.qty);

// ── the GM's shop: `save.shop`, null for the built-in list ──
/** The shop list after the item maker saved `it`: in place of the item named `name`, else added at the end. */
export function writeShopItem(shown: readonly ItemTemplate[], name: string | null, it: ItemTemplate): ItemTemplate[] {
  const at = name === null ? -1 : shown.findIndex(t => t.name === name);
  return at >= 0 ? shown.map((t, i) => (i === at ? it : t)) : [...shown, it];
}
/** The shop list without its `index`th item. */
export const removeShopItem = (shown: readonly ItemTemplate[], index: number): ItemTemplate[] => shown.filter((_, i) => i !== index);
