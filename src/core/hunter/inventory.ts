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
import { SLOTS, WEAR_LIMIT, valueOf } from '../registry/items.ts';
import type { PriceRules, Priced, Slot } from '../registry/items.ts';
import { resolveGrant, resolveItem, sameItemDef } from '../registry/item-book.ts';
import type { HeldItem, ItemDefData, ItemGrant, ItemResolveRules, ResolvedItem } from '../registry/item-book.ts';
import type { ItemBook, Rank, Rules } from '../rules.ts';
import { isRefused, refuse } from '../save-step.ts';
import type { Refused } from '../save-step.ts';
import { catalogOfItemDefId, isBuiltInItemId } from '../ids.ts';
import type { CatalogId, ItemDefId, ItemId } from '../ids.ts';
import { record } from './chronicle.ts';
import type { Chronicle } from './chronicle.ts';
import { borrowCap, debtStep, debtTermsLine } from './revive-standing.ts';
import type { DebtRules } from './revive-standing.ts';
import { WAYS_BACK } from './vitals.ts';
import type { Life } from './vitals.ts';

type Carrying = { items: HeldItem[]; equipped: Record<Slot, ItemId | null>; gold: number };
/** The rules a bag is read under: the item defs (`R.items`), the statuses a def follows, and the kits armor follows. */
export type BagRules = ItemResolveRules;
/** The rules a sale reads: an item's price (`PriceRules`), the share of it the Association pays, and the bag's defs. */
type SaleRules = PriceRules & Pick<Rules, 'saleShare'> & BagRules;

// ── the bag as its readers see it: every line resolved (item-book.ts `resolveItem`) ──
/**
 * Every line of a bag as an item: a reference read from its def under `R` (and `extra`, a remote sheet's defs), an
 * ad hoc line from its own. The one reader of a bag: the sheet, a row, a use, the detail, worth and every view.
 */
export const bagOf = (h: { readonly items: readonly HeldItem[] }, R: BagRules, extra?: ItemBook): ResolvedItem[] =>
  h.items.map(i => resolveItem(i, R, extra));
/** Line `itemId` of `h`'s bag resolved, or null when it holds none. */
export function heldItem(h: { readonly items: readonly HeldItem[] }, itemId: string, R: BagRules, extra?: ItemBook): ResolvedItem | null {
  const line = h.items.find(i => i.id === itemId);
  return line ? resolveItem(line, R, extra) : null;
}

/**
 * What a hunter wears, by the rules: the single statement of the worn invariant over resolved items. Walks `SLOTS` in
 * order, keeping an item when it is wearable in that slot, not already worn in an earlier slot, not in `offhand` while
 * a two-handed weapon sits in `weapon`, and within `WEAR_LIMIT` (6). Everything else stays in the bag.
 */
export function fitWorn(named: (slot: Slot) => Pick<ResolvedItem, 'id' | 'slot' | 'qty' | 'twoHanded'> | undefined): Record<Slot, ItemId | null> {
  const out = Object.fromEntries(SLOTS.map(s => [s, null])) as Record<Slot, ItemId | null>;
  let kept = 0, twoHanded = false;
  for (const slot of SLOTS) {
    if (kept >= WEAR_LIMIT) break;
    if (slot === 'offhand' && twoHanded) continue;
    const it = named(slot);
    if (!it || !wearable(it, slot) || Object.values(out).includes(it.id)) continue;
    out[slot] = it.id;
    kept++;
    if (slot === 'weapon' && it.twoHanded) twoHanded = true;
  }
  return out;
}
/**
 * What `h` wears now: its stored slots (hunter.ts `parseWorn`, the structure) read against its items as they resolve
 * under `R` (`fitWorn`), so an edit of a def that no longer fits its slot takes it off on every phone that reads it.
 */
export function wornOf(h: { readonly items: readonly HeldItem[]; readonly equipped: Readonly<Record<Slot, ItemId | null>> }, R: BagRules, extra?: ItemBook): Record<Slot, ItemId | null> {
  const bag = bagOf(h, R, extra);
  return fitWorn(s => { const id = h.equipped[s]; return id ? bag.find(i => i.id === id) : undefined; });
}

/** Whether a resolved item stacks: it has no slot. */
const stackable = (i: Pick<ResolvedItem, 'slot'>): boolean => !i.slot;
/**
 * The bag line grant `g` joins, among the unworn lines, when it has no slot: a reference to the same def (stacking is by
 * `defId`), or for a player's own (ad hoc) item a line of its own kind with the same def (`sameItemDef`), so a refused
 * or taken-back offer joins the stack it left. Null when it makes its own line.
 */
export function stackOf(h: Carrying, g: ItemGrant, R: BagRules): HeldItem | null {
  if (!stackable(resolveGrant(g, R))) return null;
  const worn = new Set(Object.values(wornOf(h, R)));
  return h.items.find(x => !worn.has(x.id) && (g.kind === 'ref'
    ? x.kind === 'ref' && x.defId === g.defId
    : x.kind === 'adhoc' && sameItemDef(x.item, g.item))) ?? null;
}

/**
 * Whether the Association buys an item back: not one that revives (the Resurrection Crystal). The GM decides how many
 * exist, and a sale would turn a crystal the GM gave into gold the GM never gave (notes-2b-crystal.md 3).
 */
export const sellable = (i: Pick<ResolvedItem, 'revive'>): boolean => !i.revive;
/**
 * What one of an item sells for: `saleShare` of its price (`valueOf`: its own, else the rule's), rounded down, at least
 * 1; a free item, or one not bought back (`sellable`), sells for nothing.
 */
export const sellPrice = (i: Priced & Partial<Pick<ResolvedItem, 'revive'>>, R: PriceRules & Pick<Rules, 'saleShare'>): number => {
  const price = sellable(i) ? valueOf(i, R) : 0;
  return price > 0 ? Math.max(1, Math.floor(price * R.saleShare)) : 0;
};

/** Every slot that held `id` emptied. */
const unwear = (equipped: Record<Slot, ItemId | null>, id: string): Record<Slot, ItemId | null> =>
  Object.fromEntries(Object.entries(equipped).map(([s, v]) => [s, v === id ? null : v])) as Record<Slot, ItemId | null>;

// ── what one item is: in the bag, worn, or gone ──
/** Whether item `it` can be worn in `slot`: its own slot, or either ring slot for a ring. */
export const fits = (it: Pick<ResolvedItem, 'slot'> | null | undefined, slot: string): boolean =>
  !!(it && it.slot && (it.slot === slot || (it.slot.startsWith('ring') && slot.startsWith('ring'))));
/** Whether `it` may be worn in `slot`: it fits, and it is one, not a stack. */
const wearable = (it: Pick<ResolvedItem, 'slot' | 'qty'>, slot: string): boolean => fits(it, slot) && it.qty === 1;

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
/** Why equipping an item may be refused: any `WearWhy`, an item without a gear slot, or already wearing `WEAR_LIMIT` items. */
export type PlanWhy = WearWhy | 'not-gear' | 'wear-limit';
/** What a refused change says (`ui.wrote`'s words). `no-item`, `not-worn` and `not-gear` are changes the screen never offers. */
export const GEAR_WORDS: Readonly<Partial<Record<PlanWhy | BagEditWhy, string>>> = {
  'in-fight': 'Gear cannot change during a fight.',
  'wear-limit': `You are already wearing ${WEAR_LIMIT} of ${WEAR_LIMIT} items. Unequip an item first.`,
  'not-yours': 'Only the GM can change this item.',
};
/** An allowed equip: the slot the item takes and every item id it replaces (for the view's Equip vs Swap label). */
export type WearPlan = { readonly ok: true; readonly slot: Slot; readonly replaces: readonly ItemId[] };

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

/** The slot item `itemId` is worn in (`wornOf`), or null. */
export const slotOf = (h: Carrying, itemId: string, R: BagRules): Slot | null => {
  const worn = wornOf(h, R);
  return (Object.keys(worn) as Slot[]).find(s => worn[s] === itemId) ?? null;
};
/** Where item `itemId` is now. */
export const wearOf = (h: Carrying, itemId: string, R: BagRules): WearState =>
  !h.items.some(i => i.id === itemId) ? 'gone' : slotOf(h, itemId, R) === null ? 'bag' : 'worn';
/** Where `event` takes item `itemId`, by `TABLE`, or why not. The Bag asks it before it opens a confirm or the item maker. */
export function wearMove(h: Carrying, itemId: string, event: WearEvent, inFight: boolean, R: BagRules): WearState | Refused<WearWhy> {
  const cell = TABLE[inFight ? 'fight' : 'calm'][wearOf(h, itemId, R)][event];
  return typeof cell === 'string' ? cell : refuse(cell.no);
}

/** How many gear slots `h` currently wears (`wornOf`, at most `WEAR_LIMIT`). */
export const wornCount = (h: Carrying, R: BagRules): number => Object.values(wornOf(h, R)).filter(Boolean).length;
/** The two-handed weapon locking `h`'s off hand, or null when off hand is free to use. */
export const handLockedBy = (h: Carrying, R: BagRules): ResolvedItem | null => {
  const id = wornOf(h, R).weapon;
  const it = id ? heldItem(h, id, R) : null;
  return it?.twoHanded ? it : null;
};

/** Candidate slots for equipping `it`: empty ring slots first, then `it.slot`, then the other ring slot. */
function ringCandidates(worn: Record<Slot, ItemId | null>, own: Slot): readonly Slot[] {
  const other: Slot = own === 'ring1' ? 'ring2' : 'ring1';
  const empty: Slot[] = (['ring1', 'ring2'] as const).filter(s => !worn[s]);
  return [...new Set<Slot>([...empty, own, other])];
}
/**
 * Whether item `itemId` can be worn on `h`, which slot it takes, and which worn item ids it replaces. Checks `TABLE`
 * first (`in-fight`, `no-item`), then `not-gear`, then `WEAR_LIMIT` (counting a two-handed weapon as 1 worn item that
 * also replaces `offhand`, and an off-hand item as replacing a worn two-handed weapon).
 */
export function wearPlan(h: Carrying, itemId: string, inFight: boolean, R: BagRules): WearPlan | Refused<PlanWhy> {
  const to = wearMove(h, itemId, 'equip', inFight, R), it = heldItem(h, itemId, R);
  if (isRefused(to) || !it) return isRefused(to) ? to : refuse('no-item');
  if (!it.slot) return refuse('not-gear');
  const worn = wornOf(h, R), current = (Object.keys(worn) as Slot[]).find(s => worn[s] === itemId) ?? null;
  if (current !== null) return { ok: true, slot: current, replaces: [] };
  const candidates: readonly Slot[] = it.slot.startsWith('ring') ? ringCandidates(worn, it.slot) : [it.slot];
  const base = Object.values(worn).filter(Boolean).length, locked = handLockedBy(h, R);
  for (const slot of candidates) {
    const raw: (ItemId | null)[] = [worn[slot]];
    if (slot === 'weapon' && it.twoHanded) raw.push(worn.offhand);
    if (slot === 'offhand' && locked) raw.push(worn.weapon);
    const replaces = [...new Set(raw.filter((id): id is ItemId => id !== null))];
    if (base - replaces.length + 1 <= WEAR_LIMIT) return { ok: true, slot, replaces };
  }
  return refuse('wear-limit');
}

/**
 * A saved loadout's slot map applied atomically in one step. Refused in a fight. Listed items that exist and fit are
 * split off a stack if needed (`nextId`) and proposed; absent slots are cleared; missing or unfit entries are named in
 * `skipped` and leave their current slot as a candidate. Finally `fitWorn` enforces uniqueness, two-handed lock, and
 * `WEAR_LIMIT`, and any candidate item that did not fit is named in `left`.
 */
export function wearSet<H extends Carrying>(
  h: H, want: Partial<Record<Slot, ItemId>>, nextId: () => ItemId, inFight: boolean, R: BagRules,
): { readonly h: H; readonly slots: Partial<Record<Slot, ItemId>>; readonly skipped: string[]; readonly left: string[] } | Refused<'in-fight'> {
  if (inFight) return refuse('in-fight');
  let items = h.items;
  const now = wornOf(h, R);
  const slots: Partial<Record<Slot, ItemId>> = { ...want };
  const skipped: string[] = [];
  const desired: Partial<Record<Slot, ItemId | null>> = {};
  for (const slot of SLOTS) {
    const id = want[slot] || null;
    if (!id) { desired[slot] = null; continue; }
    const line = items.find(i => i.id === id), it = line ? resolveItem(line, R) : null;
    if (!line || !it || !fits(it, slot) || !(it.qty >= 1)) {
      skipped.push(it ? it.name : slot);
      desired[slot] = now[slot];
      continue;
    }
    if (line.qty > 1) {
      const splitId = nextId();
      items = [...items.map(i => (i === line ? { ...i, qty: i.qty - 1 } : i)), { ...line, id: splitId, qty: 1 }];
      slots[slot] = splitId;
      desired[slot] = splitId;
    } else {
      desired[slot] = line.id;
    }
  }
  const bag = bagOf({ items }, R);
  const equipped = fitWorn(s => { const id = desired[s]; return id ? bag.find(i => i.id === id) : undefined; });
  const wornIds = new Set(Object.values(equipped).filter((id): id is ItemId => id !== null));
  const left: string[] = [];
  for (const slot of SLOTS) {
    const id = desired[slot];
    if (!id || wornIds.has(id)) continue;
    const it = bag.find(i => i.id === id);
    if (it && !left.includes(it.name)) left.push(it.name);
  }
  return { h: { ...h, items, equipped }, slots, skipped, left };
}

/** Slot `slot` emptied. */
const emptySlot = <H extends Carrying>(h: H, worn: Record<Slot, ItemId | null>, slot: Slot): H => ({ ...h, equipped: { ...worn, [slot]: null } });

// ── the shop: `save.shop`, ids of defs, null for the built-in list ──
/** The save with the GM's shop list `shop` (a copy), or with none: the built-in shop is shown (items.ts `DEFAULT_SHOP_IDS`). */
export const withShop = <S extends { shop: ItemDefId[] | null }>(save: S, shop: readonly ItemDefId[] | null): S => ({ ...save, shop: shop === null ? null : [...new Set(shop)] });
/** The shop list after the item maker saved item `id`: in place of `was` (the id it was opened on), else added at the end. */
export function writeShopItem(shown: readonly ItemDefId[], was: ItemDefId | null, id: ItemDefId): ItemDefId[] {
  const at = was === null ? -1 : shown.indexOf(was);
  const next = at >= 0 ? shown.map((t, i) => (i === at ? id : t)) : [...shown, id];
  return [...new Set(next)];
}
/** The shop list without its `index`th item. */
export const removeShopItem = (shown: readonly ItemDefId[], index: number): ItemDefId[] => shown.filter((_, i) => i !== index);

// ── a bag line put, taken, removed ──
/**
 * An item put in the bag: onto its stack (`stackOf`), else as its own line under `id`. The def a grant carries is not
 * kept here: the caller hands it to item-refs.ts `heardStep`.
 */
export function putItem<H extends Carrying>(h: H, g: ItemGrant, id: ItemId, R: BagRules): H {
  const into = stackOf(h, g, R);
  if (into) return { ...h, items: h.items.map(x => (x === into ? { ...x, qty: x.qty + g.qty } : x)) };
  const line: HeldItem = g.kind === 'ref' ? { kind: 'ref', id, defId: g.defId, qty: g.qty } : { kind: 'adhoc', id, qty: g.qty, item: g.item };
  return { ...h, items: [...h.items, line] };
}
/** Item `itemId` out of the bag and out of any slot. */
const drop = <H extends Carrying>(h: H, itemId: string): H => ({ ...h, items: h.items.filter(i => i.id !== itemId), equipped: unwear(h.equipped, itemId) });
/** The Bag's Remove: an item taken out of the bag whole, and out of any slot it was in, by `TABLE` (`remove`). */
export function removeItem<H extends Carrying>(h: H, itemId: string, inFight: boolean, R: BagRules): H | Refused<WearWhy> {
  const to = wearMove(h, itemId, 'remove', inFight, R);
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

// ── the Bag's Edit (the owner t153u: an item edit reaches every copy; Fable's strict reading for a player in a room) ──
/** Where the phone stands for the Bag's Edit: alone (no room), the GM of its room, or a player in one. */
export type BagSeat = 'alone' | 'gm' | 'player';
/**
 * What the Bag's Edit on line `held` does: `def` edits the item's def, so every copy changes (offered only where the
 * phone owns the def: a built-in outside a room as a player, and a custom item of this campaign's own catalog `own`
 * alone or as the GM); `adhoc` edits the player's own item in place; `none` offers no Edit and no "Make a separate
 * item" (a player in a room on a reference, or a def of another catalog).
 */
export function bagEdit(held: HeldItem, seat: BagSeat, own: CatalogId | null): 'def' | 'adhoc' | 'none' {
  if (held.kind === 'adhoc') return 'adhoc';
  if (seat === 'player') return 'none';
  if (isBuiltInItemId(held.defId)) return 'def';
  return own !== null && catalogOfItemDefId(held.defId) === own ? 'def' : 'none';
}
/** What the Bag's Edit asks before it edits a def that every copy reads (`bagEdit` answered `def`). */
export const BAG_EDIT_WORDS = {
  title: 'Edit item',
  body: (name: string): string => `Editing ${name} changes every copy of it: in every bag, in the stash and in the shop.`,
  every: 'Edit every copy',
  separate: 'Make a separate item',
  cancel: 'Cancel',
} as const;
/** Why a Bag edit is refused besides `WearWhy`: the phone does not own the def (`bagEdit` answered `none`). */
export type BagEditWhy = 'not-yours';
/** What an edit to `it` is to item `itemId`: `reslot` when it is worn and `it` would not be wearable in its slot. */
const editOf = (h: Carrying, itemId: string, it: Pick<ResolvedItem, 'slot' | 'qty'>, R: BagRules): WearEvent => {
  const slot = slotOf(h, itemId, R);
  return slot === null || wearable(it, slot) ? 'edit' : 'reslot';
};
/**
 * The Bag's edit of an ad hoc line: its def replaced, its id and count kept. A worn item that the edit leaves unwearable
 * in its slot is taken off (`reslot`, SMX-rules-5.2), and the worn invariant is read again (`fitWorn`). A reference is
 * refused `not-yours`: its def is edited in the library (library.ts `saveItemDef`), or split off (`detachItem`).
 */
export function editItem<H extends Carrying>(h: H, itemId: string, def: ItemDefData, inFight: boolean, R: BagRules): H | Refused<WearWhy | BagEditWhy> {
  const line = h.items.find(i => i.id === itemId);
  if (line && line.kind !== 'adhoc') return refuse('not-yours');
  const to = wearMove(h, itemId, editOf(h, itemId, { slot: def.slot, qty: line?.qty ?? 1 }, R), inFight, R);
  if (isRefused(to)) return to;
  const items = h.items.map(i => (i.id === itemId && i.kind === 'adhoc' ? { ...i, item: def } : i));
  const worn = wornOf(h, R), base = to === 'bag' ? unwear(worn, itemId) : worn;
  const bag = bagOf({ items }, R);
  return { ...h, items, equipped: fitWorn(s => bag.find(i => i.id === base[s])) };
}
/**
 * "Make a separate item": reference line `itemId` pointed at def `defId` (a new custom def the caller saved in the
 * library), so it stops following the def it came from. Refused `not-yours` where `bagEdit` does not answer `def` (a
 * player in a room, Fable's strict reading of t153u).
 */
export function detachItem<H extends Carrying>(h: H, itemId: string, defId: ItemDefId, inFight: boolean, R: BagRules, seat: BagSeat, own: CatalogId | null): H | Refused<WearWhy | BagEditWhy> {
  const line = h.items.find(i => i.id === itemId);
  if (!line) return refuse('no-item');
  if (line.kind !== 'ref' || bagEdit(line, seat, own) !== 'def') return refuse('not-yours');
  const items = h.items.map(i => (i === line ? { kind: 'ref' as const, id: line.id, defId, qty: line.qty } : i));
  const next = bagOf({ items }, R).find(i => i.id === itemId)!;
  const to = wearMove(h, itemId, editOf(h, itemId, next, R), inFight, R);
  if (isRefused(to)) return to;
  const worn = wornOf(h, R), base = to === 'bag' ? unwear(worn, itemId) : worn;
  const bag = bagOf({ items }, R);
  return { ...h, items, equipped: fitWorn(s => bag.find(i => i.id === base[s])) };
}

/** Gold added, or taken with a number below 0; never below 0. */
export const addGold = <H extends { gold: number }>(h: H, n: number): H => ({ ...h, gold: Math.max(0, h.gold + (Math.trunc(n) || 0)) });
/** The GM's edit of the gold to a number; never below 0. */
export const setGold = <H extends { gold: number }>(h: H, n: number): H => ({ ...h, gold: Math.max(0, Math.trunc(n) || 0) });

/**
 * An item put on, by `wearPlan` and `fitWorn`: in its planned slot, replacing any conflicting items (including
 * off-hand under a two-handed weapon, or a two-handed weapon under an off-hand). From a stack of more than one, one is
 * split off under `splitId` and worn. An item already worn stays where it is. Refused when in a fight (`in-fight`),
 * when it has no slot (`not-gear`), or when equipping it would exceed `WEAR_LIMIT` (`wear-limit`).
 */
export function equip<H extends Carrying>(h: H, itemId: string, splitId: ItemId, inFight: boolean, R: BagRules): H | Refused<PlanWhy> {
  const plan = wearPlan(h, itemId, inFight, R);
  if (isRefused(plan)) return plan;
  if (wearOf(h, itemId, R) === 'worn') return h;
  const line = h.items.find(i => i.id === itemId)!;
  const split = line.qty > 1, wornId = split ? splitId : line.id;
  const items = split ? [...h.items.map(i => (i === line ? { ...i, qty: i.qty - 1 } : i)), { ...line, id: splitId, qty: 1 }] : h.items;
  let next = unwear(wornOf(h, R), wornId);
  for (const oldId of plan.replaces) next = unwear(next, oldId);
  next = { ...next, [plan.slot]: wornId };
  const bag = bagOf({ items }, R);
  return { ...h, items, equipped: fitWorn(s => bag.find(i => i.id === next[s])) };
}
/** Slot `slot` emptied, by `TABLE` for the item in it. A word that is not a slot is refused (`no-slot`), an empty slot (`not-worn`). */
export function unequip<H extends Carrying>(h: H, slot: string, inFight: boolean, R: BagRules): H | Refused<WearWhy | 'no-slot'> {
  const s = (SLOTS as readonly string[]).includes(slot) && slot in h.equipped ? (slot as Slot) : null;
  if (s === null) return refuse('no-slot');
  const worn = wornOf(h, R), id = worn[s];
  if (id === null) return refuse('not-worn');
  const to = wearMove(h, id, 'unequip', inFight, R);
  return isRefused(to) ? to : emptySlot(h, worn, s);
}

/** Whether the shop trades with a hunter in this life: with anyone but the dead. */
export const shopOpen = (h: { readonly life: Pick<Life, 'at'> }): boolean => h.life.at !== 'dead';
/** What the shop says to a dead hunter, in place of its Buy and Sell buttons and when a purchase or a sale is refused. */
export const SHOP_CLOSED = `The shop is closed while you are dead. You cannot buy or sell. ${WAYS_BACK} brings you back. The GM or another hunter can give you a Resurrection Crystal.`;
/** The rules a purchase reads: item prices, the borrow limit, and the System debt rules. */
export type BuyRules = PriceRules & Pick<Rules, 'borrowCapPrices' | 'reviveDebtShare' | 'reviveDebtBurn' | 'reviveDebtXpRate'>;
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
 * when borrowing is enabled (`borrowCapPrices > 0`), debt can be paid off (`reviveDebtShare > 0`), and
 * `debt + shortfall <= borrowCap(rank, R)`. Resurrection Crystals follow the same borrow limit with no separate rule.
 */
export function buyPlan(h: BuyCheck, it: Priced & { readonly name: string }, R: BuyRules): BuyPlan | (Refused<BuyRefusal> & { readonly info: BuyRefusalInfo }) {
  const info = buyRefusalInfo(h, it, R);
  if (!shopOpen(h)) return { ...refuse('dead'), info };
  const cash = Math.min(h.gold, info.price), borrow = info.need;
  if (borrow === 0) return { ok: true, price: info.price, cash, borrow: 0, debtAfter: h.debt, cap: info.cap, available: info.available };
  if (R.borrowCapPrices <= 0) return { ...refuse('borrow-off'), info };
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
  if (!shopOpen(h) || R.borrowCapPrices <= 0) return null;
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
 * Grant `g` bought at its price (`valueOf` of the item it resolves to under `R`): spends cash first and adds any allowed
 * shortfall to `Hunter.debt` via `debtStep`. Refused when dead (`dead`), borrowing is off (`borrow-off`), debt
 * collection is 0% (`no-payoff`), or `debt + shortfall` exceeds the rank's borrow limit (`over-cap`).
 */
export function buy<H extends Buying>(h: H, g: ItemGrant, id: ItemId, R: BuyRules & BagRules): H | Refused<BuyRefusal> {
  const it = resolveGrant(g, R), plan = buyPlan(h, it, R);
  if (isRefused(plan)) return refuse(plan.why);
  const gold = h.gold - plan.cash;
  const debt = plan.borrow > 0 ? debtStep(h.debt, { type: 'incur', amount: plan.borrow }, R).debt : h.debt;
  return record(putItem({ ...h, gold, debt }, g, id, R), { kind: 'shop', act: 'buy', item: it.name, rar: it.rar, price: plan.price, goldAfter: gold });
}
/**
 * `n` of an item sold (at most what is held), each for `sellPrice`. Refused for a dead hunter (`dead`), by `TABLE`
 * (`remove`: one not held, one worn in a fight) and for one not bought back (`unsellable`). `inFight` is false by
 * default for the tests that sell outside the Bag; the Bag passes it.
 */
export function sell<H extends Trading>(h: H, itemId: string, n: number, R: SaleRules, inFight = false): H | Refused<'dead' | WearWhy | 'unsellable'> {
  if (!shopOpen(h)) return refuse('dead');
  const to = wearMove(h, itemId, 'remove', inFight, R), it = heldItem(h, itemId, R);
  if (isRefused(to) || !it) return isRefused(to) ? to : refuse('no-item');
  if (!sellable(it)) return refuse('unsellable');
  const cnt = Math.min(Math.max(1, Math.trunc(n) || 1), it.qty);
  const out = takeItems(h, itemId, cnt);
  if (!('items' in out)) return out;
  const price = sellPrice(it, R) * cnt, gold = h.gold + price;
  return record({ ...out, gold }, { kind: 'shop', act: 'sell', item: it.name, rar: it.rar, price, goldAfter: gold });
}
/** What `sell` pays for `n` of an item. */
export const sellTotal = (it: Priced & Pick<ResolvedItem, 'qty'> & Partial<Pick<ResolvedItem, 'revive'>>, n: number, R: PriceRules & Pick<Rules, 'saleShare'>): number =>
  sellPrice(it, R) * Math.min(Math.max(1, Math.trunc(n) || 1), it.qty);
