// inventory.ts: what a hunter carries and wears, and its gold: an item put in the bag (stacking), taken out, used up,
// worn and taken off, bought and sold, edited; and the GM's shop list. Pure. A view changes these only through a
// function here, in `store.apply` (src/core/save-step.ts); a change to what is worn changes the sheet, so chain
// `fitted` (sheet.ts) after it. Ids are arguments: the store reserves one (`store.id('i')`).
//
// Selling pays less than buying: an item sells for `saleShare` of its price (`valueOf`), a quarter (economy design 3),
// rounded down, and at least 1 gold when it has a price (`sellPrice`). So buy then sell gives back the item and leaves
// the hunter `price - sellPrice` gold poorer; tests/inventory.test.ts asserts that difference. An item that revives is not bought back (`sellable`).
//
// What one item is to a hunter is a machine (docs/state-machines.md, "Gear"): in the bag, worn, or gone. A worn item is
// a single one (qty 1) in one slot it fits; `parseWorn` reads a save to that, and every step that changes what is worn
// asks `TABLE` first (`wearMove`). In a fight nothing worn changes and nothing is put on: the fight's row holds the
// sheet it started with (m2-plan 4.4), so the caller says whether the hunter is in one, as for a loadout's swap.
//
// The shop is closed to a dead hunter (`shopOpen`): it buys nothing and sells nothing. The owner, Nov 19: "When a
// player/party dies, they should only be able to be revived by the gm or through resurrection crystals. They can not buy
// it in death", then "Whole shop should be closed in death." A crystal still reaches a dead hunter from the GM (an award)
// or from another hunter (goods.ts `handOver`, offer.ts), and the dead hunter may use it (use.ts `useItem`): the owner,
// Nov 22, a crystal handed over after the death counts as bought before it.
import { SLOTS, valueOf } from '../registry/items.ts';
import type { Item, ItemTemplate, PriceRules, Priced, Slot } from '../registry/items.ts';
import type { Rank, Rules } from '../rules.ts';
import { isRefused, refuse } from '../save-step.ts';
import type { Refused } from '../save-step.ts';
import type { ItemId } from '../ids.ts';
import { record } from './chronicle.ts';
import type { Chronicle } from './chronicle.ts';
import { borrowCap, debtStep, debtTermsLine } from './revive-standing.ts';
import type { DebtRules } from './revive-standing.ts';
import { WAYS_BACK } from './vitals.ts';
import type { Life } from './vitals.ts';

type Carrying = { items: Item[]; equipped: Record<Slot, ItemId | null>; gold: number };
/** The rules a sale reads: an item's price (`PriceRules`) and the share of it the Association pays. */
type SaleRules = PriceRules & Pick<Rules, 'saleShare'>;

/**
 * Whether a field of an item tells two things apart: true, they are different things and never one stack; false, it is
 * the stack's own business (the id of its first entry, the count, the slot, which no stackable item has). A field added
 * to `Item` fails the typecheck here until it is decided.
 */
const DISTINGUISHES: Record<keyof Item, boolean> = {
  id: false, qty: false, slot: false,
  name: true, rar: true, grade: true, type: true, dice: true, bonus: true, value: true, weight: true, armor: true, resist: true,
  icon: true, effects: true, target: true, tell: true, worn: true, active: true, revive: true,
  // `icon` tells two things apart: a GM who gave two potions two pictures wants them told apart in the bag, and merging
  // them would lose one pick (loot's `lootOf` already compares every field but the count).
  // Waits on the owner's ruling SMX-rules-5.3 ("items that differ in description or attack do not stack"): as the app
  // behaves today, they do not. The ruling is this row.
  desc: true, attack: true,
};
const DISTINGUISHING = (Object.keys(DISTINGUISHES) as (keyof Item)[]).filter(k => DISTINGUISHES[k]);
/** What makes two unworn things one stack: every field that `DISTINGUISHES`, and nothing else. */
const stackKey = (i: Partial<Item>): string => JSON.stringify(DISTINGUISHING.map(k => (k === 'effects' ? i.effects ?? [] : i[k] ?? null)));
const stackable = (i: ItemTemplate | Item): boolean => !i.slot;
/** The held item a new one would join, or null when it makes its own entry. */
export const stackOf = (h: Carrying, it: ItemTemplate): Item | null =>
  (stackable(it) && h.items.find(x => stackable(x) && stackKey(x) === stackKey(it))) || null;

/**
 * Whether the Association buys an item back: not one that revives (the Resurrection Crystal). The GM decides how many
 * exist, and a sale would turn a crystal the GM gave into gold the GM never gave (notes-2b-crystal.md 3).
 */
export const sellable = (i: Pick<Item, 'revive'>): boolean => !i.revive;
/**
 * What one of an item sells for: `saleShare` of its price (`valueOf`: its own, else the rule's), rounded down, at least
 * 1; a free item, or one not bought back (`sellable`), sells for nothing. (Before, a literal half, and an item priced 0
 * sold for half of base value times multiplier, a second price rule.)
 */
export const sellPrice = (i: Priced & Partial<Pick<Item, 'revive'>>, R: SaleRules): number => {
  const price = sellable(i) ? valueOf(i, R) : 0;
  return price > 0 ? Math.max(1, Math.floor(price * R.saleShare)) : 0;
};

/** Every slot that held `id` emptied. */
const unwear = (equipped: Record<Slot, ItemId | null>, id: string): Record<Slot, ItemId | null> =>
  Object.fromEntries(Object.entries(equipped).map(([s, v]) => [s, v === id ? null : v])) as Record<Slot, ItemId | null>;

// ── what one item is: in the bag, worn, or gone ──
/** Whether item `it` can be worn in `slot`: its own slot, or either ring slot for a ring. */
export const fits = (it: Pick<Item, 'slot'> | null | undefined, slot: string): boolean =>
  !!(it && it.slot && (it.slot === slot || (it.slot.startsWith('ring') && slot.startsWith('ring'))));
/** Whether `it` may be worn in `slot`: it fits, and it is one, not a stack. */
const wearable = (it: Pick<Item, 'slot' | 'qty'>, slot: string): boolean => fits(it, slot) && it.qty === 1;

export const WEAR_STATES = ['bag', 'worn', 'gone'] as const;
/** Where one item is: in the bag, worn in a slot, or gone (never held, or sold, removed, used up or given). */
export type WearState = (typeof WEAR_STATES)[number];
export const WEAR_EVENTS = ['equip', 'unequip', 'edit', 'reslot', 'remove'] as const;
/**
 * What is done to one item: put on, taken off, edited so it is still one item that fits the slot it is worn in (`edit`;
 * any edit of a thing in the bag), edited to another slot, to none or to a stack (`reslot`), taken out of the bag
 * (`remove`: sold, deleted).
 */
export type WearEvent = (typeof WEAR_EVENTS)[number];
/** Why a change to what is worn is refused: the item is not held, it is not worn, or the hunter is in a fight. */
export type WearWhy = 'no-item' | 'not-worn' | 'in-fight';
/** What a refused change says (`ui.wrote`'s words). `no-item` and `not-worn` are changes the screen never offers. */
export const GEAR_WORDS: Readonly<Partial<Record<WearWhy, string>>> = { 'in-fight': 'Gear cannot change during a fight.' };

type Cell = WearState | { readonly no: WearWhy };
const NO_ITEM: Cell = { no: 'no-item' }, NOT_WORN: Cell = { no: 'not-worn' }, IN_FIGHT: Cell = { no: 'in-fight' };
const GONE: { readonly [E in WearEvent]: Cell } = { equip: NO_ITEM, unequip: NOT_WORN, edit: NO_ITEM, reslot: NO_ITEM, remove: NO_ITEM };
/**
 * Where each event takes an item, out of a fight (`calm`) and in one (`fight`), or why it is refused. Equip on a worn
 * item leaves it where it is (a ring in the first ring slot does not move to the second). In a fight the bag still
 * changes, but nothing is put on and nothing worn is taken off, edited, sold or removed (SMX-rules-5.3c).
 */
const TABLE: { readonly [P in 'calm' | 'fight']: { readonly [S in WearState]: { readonly [E in WearEvent]: Cell } } } = {
  calm: {
    bag: { equip: 'worn', unequip: NOT_WORN, edit: 'bag', reslot: 'bag', remove: 'gone' },
    worn: { equip: 'worn', unequip: 'bag', edit: 'worn', reslot: 'bag', remove: 'gone' },
    gone: GONE,
  },
  fight: {
    bag: { equip: IN_FIGHT, unequip: NOT_WORN, edit: 'bag', reslot: 'bag', remove: 'gone' },
    worn: { equip: IN_FIGHT, unequip: IN_FIGHT, edit: IN_FIGHT, reslot: IN_FIGHT, remove: IN_FIGHT },
    gone: GONE,
  },
};

/** The slot item `itemId` is worn in, or null. */
export const slotOf = (h: Carrying, itemId: string): Slot | null =>
  (Object.keys(h.equipped) as Slot[]).find(s => h.equipped[s] === itemId) ?? null;
/** Where item `itemId` is now. */
export const wearOf = (h: Carrying, itemId: string): WearState =>
  !h.items.some(i => i.id === itemId) ? 'gone' : slotOf(h, itemId) === null ? 'bag' : 'worn';
/** Where `event` takes item `itemId`, by `TABLE`, or why not. The Bag asks it before it opens a confirm or the item maker. */
export function wearMove(h: Carrying, itemId: string, event: WearEvent, inFight: boolean): WearState | Refused<WearWhy> {
  const cell = TABLE[inFight ? 'fight' : 'calm'][wearOf(h, itemId)][event];
  return typeof cell === 'string' ? cell : refuse(cell.no);
}
/** What an edit to `it` is to item `itemId`: `reslot` when it is worn and `it` would not be wearable in its slot. */
const editOf = (h: Carrying, itemId: string, it: ItemTemplate): WearEvent => {
  const slot = slotOf(h, itemId);
  return slot === null || wearable(it, slot) ? 'edit' : 'reslot';
};

/**
 * What a hunter wears, read from a save or a sheet: slot by slot, the item `named` gives it, kept when it is wearable
 * there and worn in no slot before; else the slot is empty. So one item in two slots stays in the first, and a stack or
 * an item that does not fit its slot goes back to the bag (SMX-rules-5.1).
 */
export function parseWorn(named: (slot: Slot) => Item | undefined): Record<Slot, ItemId | null> {
  const out = Object.fromEntries(SLOTS.map(s => [s, null])) as Record<Slot, ItemId | null>;
  for (const slot of SLOTS) {
    const it = named(slot);
    if (it && wearable(it, slot) && !Object.values(out).includes(it.id)) out[slot] = it.id;
  }
  return out;
}

/**
 * Item `itemId`, held and fitting `slot`, worn there: out of any other slot, swapping out what was there. From a stack
 * one is split off under `splitId` and worn. The one write of a slot besides emptying one; `equip` and a loadout's swap
 * (loadouts.ts) call it.
 */
export function wearIn<H extends Carrying>(h: H, itemId: string, slot: Slot, splitId: ItemId): H {
  const it = h.items.find(i => i.id === itemId);
  if (!it || !fits(it, slot)) return h;
  const split = it.qty > 1, wornId = split ? splitId : it.id;
  const items = split ? [...h.items.map(i => (i === it ? { ...i, qty: i.qty - 1 } : i)), { ...it, id: splitId, qty: 1 }] : h.items;
  return { ...h, items, equipped: { ...unwear(h.equipped, wornId), [slot]: wornId } };
}
/** Slot `slot` emptied. */
export const emptySlot = <H extends Carrying>(h: H, slot: Slot): H => ({ ...h, equipped: { ...h.equipped, [slot]: null } });

/** The save with the GM's shop list `shop` (a copy), or with none: the default shop of the rules is shown (`defaultShop`). */
export const withShop = <S extends { shop: ItemTemplate[] | null }>(save: S, shop: readonly ItemTemplate[] | null): S => ({ ...save, shop: shop === null ? null : [...shop] });
/** An item (already read by `parseItem`) put in the bag: onto its stack, else as its own entry under `id`. */
export function putItem<H extends Carrying>(h: H, it: ItemTemplate, id: ItemId): H {
  const into = stackOf(h, it);
  if (into) return { ...h, items: h.items.map(x => (x === into ? { ...x, qty: x.qty + it.qty } : x)) };
  return { ...h, items: [...h.items, { ...it, id }] };
}
/** Item `itemId` out of the bag and out of any slot. */
const drop = <H extends Carrying>(h: H, itemId: string): H => ({ ...h, items: h.items.filter(i => i.id !== itemId), equipped: unwear(h.equipped, itemId) });
/** The Bag's Remove: an item taken out of the bag whole, and out of any slot it was in, by `TABLE` (`remove`). */
export function removeItem<H extends Carrying>(h: H, itemId: string, inFight: boolean): H | Refused<WearWhy> {
  const to = wearMove(h, itemId, 'remove', inFight);
  return isRefused(to) ? to : drop(h, itemId);
}
/**
 * `n` fewer of an item (at most what is held); the last one leaves the bag and any slot. One not held is refused
 * (`no-item`). A use (use.ts) or a gift (goods.ts) takes them: neither is offered for a worn item in a fight.
 */
export function takeItems<H extends Carrying>(h: H, itemId: string, n = 1): H | Refused<'no-item'> {
  const it = h.items.find(i => i.id === itemId);
  if (!it) return refuse('no-item');
  const left = it.qty - Math.min(it.qty, Math.max(1, Math.trunc(n) || 1));
  return left > 0 ? { ...h, items: h.items.map(i => (i.id === itemId ? { ...i, qty: left } : i)) } : drop(h, itemId);
}
/**
 * The item maker's edit of a held item: its fields replaced, its id kept. A worn item that the edit leaves unwearable
 * in its slot (another slot, none, or a stack) is taken off (`reslot`, SMX-rules-5.2); by `TABLE`.
 */
export function editItem<H extends Carrying>(h: H, itemId: string, it: ItemTemplate, inFight: boolean): H | Refused<WearWhy> {
  const to = wearMove(h, itemId, editOf(h, itemId, it), inFight);
  if (isRefused(to)) return to;
  const items = h.items.map(i => (i.id === itemId ? { ...it, id: i.id } : i));
  return { ...h, items, equipped: to === 'bag' ? unwear(h.equipped, itemId) : h.equipped };
}

/** Gold added, or taken with a number below 0; never below 0. */
export const addGold = <H extends Carrying>(h: H, n: number): H => ({ ...h, gold: Math.max(0, h.gold + (Math.trunc(n) || 0)) });
/** The GM's edit of the gold to a number; never below 0. */
export const setGold = <H extends Carrying>(h: H, n: number): H => ({ ...h, gold: Math.max(0, Math.trunc(n) || 0) });

/**
 * An item put on, by `TABLE`: in its slot, swapping out whatever was there; a ring in the first free ring slot. From a
 * stack of more than one, one is split off under `splitId` and worn (`wearIn`). An item already worn stays where it is.
 * Refused also when it has no slot (`not-gear`). `inFight` is false by default for a new hunter's starter gear
 * (starter.ts); every tap passes it.
 */
export function equip<H extends Carrying>(h: H, itemId: string, splitId: ItemId, inFight = false): H | Refused<WearWhy | 'not-gear'> {
  const to = wearMove(h, itemId, 'equip', inFight), it = h.items.find(i => i.id === itemId);
  if (isRefused(to) || !it) return isRefused(to) ? to : refuse('no-item');
  if (!it.slot) return refuse('not-gear');
  if (wearOf(h, itemId) === 'worn') return h;
  const slot: Slot = it.slot.startsWith('ring') ? (!h.equipped.ring1 ? 'ring1' : !h.equipped.ring2 ? 'ring2' : it.slot) : it.slot;
  return wearIn(h, itemId, slot, splitId);
}
/** Slot `slot` emptied, by `TABLE` for the item in it. A word that is not a slot is refused (`no-slot`), an empty slot (`not-worn`). */
export function unequip<H extends Carrying>(h: H, slot: string, inFight: boolean): H | Refused<WearWhy | 'no-slot'> {
  const s = (SLOTS as readonly string[]).includes(slot) && slot in h.equipped ? (slot as Slot) : null;
  if (s === null) return refuse('no-slot');
  const id = h.equipped[s];
  if (id === null) return refuse('not-worn');
  const to = wearMove(h, id, 'unequip', inFight);
  return isRefused(to) ? to : emptySlot(h, s);
}

/** Whether the shop trades with a hunter in this life: with anyone but the dead. */
export const shopOpen = (h: { readonly life: Pick<Life, 'at'> }): boolean => h.life.at !== 'dead';
/** What the shop says to a dead hunter, in place of its Buy and Sell buttons and when a purchase or a sale is refused. */
export const SHOP_CLOSED = `The shop is closed while you are dead. You cannot buy or sell. ${WAYS_BACK} brings you back. The GM or another hunter can give you a Resurrection Crystal.`;
/** The rules a purchase reads: item prices, the borrow limit, and the System debt rules. */
export type BuyRules = PriceRules & Pick<Rules, 'borrowCapClears' | 'reviveDebtShare' | 'reviveDebtBurn' | 'reviveDebtXpRate'>;
/** What `buyPlan` reads on a hunter before buying. */
export type BuyCheck = { readonly life: Pick<Life, 'at'>; readonly gold: number; readonly debt: number; readonly rank: Rank };
/** Why a purchase may be refused: dead hunter, borrowing turned off, 0% clear-gold debt payoff, or over the borrow limit. */
export const BUY_REFUSALS = ['dead', 'borrow-off', 'no-payoff', 'over-cap'] as const;
export type BuyRefusal = (typeof BUY_REFUSALS)[number];
/** The exact numbers behind a purchase refusal, for `BUY_WORDS`. */
export type BuyRefusalInfo = {
  readonly name: string;
  readonly rank: Rank;
  readonly price: number;
  readonly have: number;
  readonly need: number;
  readonly debt: number;
  readonly cap: number;
  readonly available: number;
};
/** An allowed purchase: total price, cash paid now, shortfall borrowed onto `Hunter.debt`, total debt after, and borrow limit. */
export type BuyPlan = {
  readonly ok: true;
  readonly price: number;
  readonly cash: number;
  readonly borrow: number;
  readonly debtAfter: number;
  readonly cap: number;
  readonly available: number;
};
const goldAmt = (n: number): string => `${n.toLocaleString('en-US')} gold`;
function buyRefusalInfo(h: BuyCheck, it: Priced & { readonly name: string }, R: BuyRules): BuyRefusalInfo {
  const price = valueOf(it, R), cash = Math.min(h.gold, price), need = price - cash;
  const cap = borrowCap(h.rank, R), available = Math.max(0, cap - h.debt);
  return { name: it.name, rank: h.rank, price, have: h.gold, need, debt: h.debt, cap, available };
}
/**
 * Checks whether hunter `h` can buy `it` under `R`: spends cash first, and borrows any shortfall onto `Hunter.debt`
 * when borrowing is enabled (`borrowCapClears > 0`), debt can be paid off (`reviveDebtShare > 0`), and
 * `debt + shortfall <= borrowCap(rank, R)`. Resurrection Crystals follow the same borrow limit with no separate rule.
 */
export function buyPlan(h: BuyCheck, it: Priced & { readonly name: string }, R: BuyRules): BuyPlan | (Refused<BuyRefusal> & { readonly info: BuyRefusalInfo }) {
  const info = buyRefusalInfo(h, it, R);
  if (!shopOpen(h)) return { ...refuse('dead'), info };
  const cash = Math.min(h.gold, info.price), borrow = info.need;
  if (borrow === 0) return { ok: true, price: info.price, cash, borrow: 0, debtAfter: h.debt, cap: info.cap, available: info.available };
  if (R.borrowCapClears <= 0) return { ...refuse('borrow-off'), info };
  if (R.reviveDebtShare <= 0) return { ...refuse('no-payoff'), info };
  if (h.debt + borrow > info.cap) return { ...refuse('over-cap'), info };
  return { ok: true, price: info.price, cash, borrow, debtAfter: h.debt + borrow, cap: info.cap, available: info.available };
}
/** The words of a purchase refused, given the item and hunter numbers. */
export const BUY_WORDS: { readonly [W in BuyRefusal]: (info: BuyRefusalInfo) => string } = {
  dead: () => SHOP_CLOSED,
  'borrow-off': i => `${i.name} costs ${goldAmt(i.price)}, and you have ${goldAmt(i.have)}. Shop borrowing is off.`,
  'no-payoff': i => `You cannot borrow for ${i.name}. Debt payments from gate clears are at 0%, so you could not pay the debt off.`,
  'over-cap': i => (i.debt > 0 && i.available === 0
    ? `You cannot borrow ${goldAmt(i.need)} for ${i.name}. Your rank ${i.rank} borrow limit is ${goldAmt(i.cap)} and you already owe ${goldAmt(i.debt)}, so you can borrow 0 gold right now.`
    : `You cannot borrow ${goldAmt(i.need)} for ${i.name}. Your rank ${i.rank} borrow limit is ${goldAmt(i.cap)}, and you can borrow up to ${goldAmt(i.available)}.`),
};
/** All refusal strings for hunter `h` trying to buy `it`, keyed by refusal code for `ui.wrote`. */
export function buyWords(h: BuyCheck, it: Priced & { readonly name: string }, R: BuyRules): Record<BuyRefusal, string> {
  const info = buyRefusalInfo(h, it, R);
  return {
    dead: BUY_WORDS.dead(info),
    'borrow-off': BUY_WORDS['borrow-off'](info),
    'no-payoff': BUY_WORDS['no-payoff'](info),
    'over-cap': BUY_WORDS['over-cap'](info),
  };
}
/** Plain-language copy for shop borrowing UI and confirmation dialogs, imported by views and e2e tests. */
export const BORROW_WORDS = {
  title: 'Buy on debt',
  btnBuy: 'Buy',
  btnBorrow: 'Buy on debt',
  cancel: 'Cancel',
  confirmBtn: (borrow: number): string => `Borrow ${goldAmt(borrow)}`,
  bought: (name: string, plan: Pick<BuyPlan, 'cash' | 'borrow'>): string =>
    `Purchased ${name} (${goldAmt(plan.cash)} paid, ${goldAmt(plan.borrow)} added to debt).`,
  paused: 'Shop borrowing is paused while debt payments from gate clears are at 0%.',
} as const;
/** Shop tab credit summary for a living hunter, or null when borrowing is turned off or the hunter is dead. */
export function shopCreditLine(h: BuyCheck, R: BuyRules): string | null {
  if (!shopOpen(h) || R.borrowCapClears <= 0) return null;
  if (R.reviveDebtShare <= 0) return BORROW_WORDS.paused;
  const cap = borrowCap(h.rank, R), available = Math.max(0, cap - h.debt);
  if (h.debt <= 0) return `Shop credit: you can borrow up to ${goldAmt(cap)} (rank ${h.rank} limit).`;
  if (available > 0) return `Shop credit: you can borrow up to ${goldAmt(available)} more (rank ${h.rank} limit: ${goldAmt(cap)}, you owe ${goldAmt(h.debt)}).`;
  return `Shop credit: you can borrow 0 gold (rank ${h.rank} limit: ${goldAmt(cap)}, you owe ${goldAmt(h.debt)}).`;
}
/** Confirmation window text shown before a hunter borrows in the shop. */
export function borrowConfirm(name: string, plan: BuyPlan, R: DebtRules): {
  readonly title: string;
  readonly body: string;
  readonly lines: readonly string[];
  readonly confirm: string;
  readonly cancel: string;
} {
  const terms = debtTermsLine(R);
  return {
    title: BORROW_WORDS.title,
    body: `You are short ${goldAmt(plan.borrow)} for ${name} (${goldAmt(plan.price)}).`,
    lines: [
      `Pay now: ${goldAmt(plan.cash)}.`,
      `Added to debt: ${goldAmt(plan.borrow)}.`,
      `New total debt: ${goldAmt(plan.debtAfter)}.`,
      ...(terms ? [terms] : []),
    ],
    confirm: BORROW_WORDS.confirmBtn(plan.borrow),
    cancel: BORROW_WORDS.cancel,
  };
}

/** A purchase or a sale is a fact of the chronicle (chronicle.ts), recorded with it. The shop reads the life (`shopOpen`). */
type Trading = Carrying & { readonly chronicle: Chronicle; readonly life: Life };
/** What a purchase reads on a hunter: bag, gold, chronicle, life, rank, and System debt. */
type Buying = Trading & { readonly rank: Rank; readonly debt: number };
/**
 * An item bought at its price (`valueOf`): spends cash first and adds any allowed shortfall to `Hunter.debt` via
 * `debtStep`. Refused when dead (`dead`), borrowing is off (`borrow-off`), debt collection is 0% (`no-payoff`), or
 * `debt + shortfall` exceeds the rank's borrow limit (`over-cap`).
 */
export function buy<H extends Buying>(h: H, it: ItemTemplate, id: ItemId, R: BuyRules): H | Refused<BuyRefusal> {
  const plan = buyPlan(h, it, R);
  if (isRefused(plan)) return refuse(plan.why);
  const gold = h.gold - plan.cash;
  const debt = plan.borrow > 0 ? debtStep(h.debt, { type: 'incur', amount: plan.borrow }, R).debt : h.debt;
  return record(putItem({ ...h, gold, debt }, it, id), { kind: 'shop', act: 'buy', item: it.name, rar: it.rar, price: plan.price, goldAfter: gold });
}
/**
 * `n` of an item sold (at most what is held), each for `sellPrice`. Refused for a dead hunter (`dead`), by `TABLE`
 * (`remove`: one not held, one worn in a fight) and for one not bought back (`unsellable`). `inFight` is false by
 * default for the tests that sell outside the Bag; the Bag passes it.
 */
export function sell<H extends Trading>(h: H, itemId: string, n: number, R: SaleRules, inFight = false): H | Refused<'dead' | WearWhy | 'unsellable'> {
  if (!shopOpen(h)) return refuse('dead');
  const to = wearMove(h, itemId, 'remove', inFight), it = h.items.find(i => i.id === itemId);
  if (isRefused(to) || !it) return isRefused(to) ? to : refuse('no-item');
  if (!sellable(it)) return refuse('unsellable');
  const cnt = Math.min(Math.max(1, Math.trunc(n) || 1), it.qty);
  const out = takeItems(h, itemId, cnt);
  if (!('items' in out)) return out;
  const price = sellPrice(it, R) * cnt, gold = h.gold + price;
  return record({ ...out, gold }, { kind: 'shop', act: 'sell', item: it.name, rar: it.rar, price, goldAfter: gold });
}
/** What `sell` pays for `n` of an item. */
export const sellTotal = (it: Item, n: number, R: SaleRules): number => sellPrice(it, R) * Math.min(Math.max(1, Math.trunc(n) || 1), it.qty);

// ── the GM's shop: `save.shop`, null for the built-in list ──
/** The shop list after the item maker saved `it`: in place of the item named `name`, else added at the end. */
export function writeShopItem(shown: readonly ItemTemplate[], name: string | null, it: ItemTemplate): ItemTemplate[] {
  const at = name === null ? -1 : shown.findIndex(t => t.name === name);
  return at >= 0 ? shown.map((t, i) => (i === at ? it : t)) : [...shown, it];
}
/** The shop list without its `index`th item. */
export const removeShopItem = (shown: readonly ItemTemplate[], index: number): ItemTemplate[] => shown.filter((_, i) => i !== index);
