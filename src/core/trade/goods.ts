// goods.ts: what a hunter hands over, gold and items by value, taken out of its bag and put into another's. Pure.
// An offer between two phones (trade/offer.ts) carries goods in its room message; a hand over between two hunters of one
// phone (`handOver`) is one write and no message. The goods taken out of a bag wait aside in the giving phone's record
// until the offer ends, so every unit of goods is in exactly one place: a bag, an aside, or a message in the room
// (notes-5-trade.md 1.8).
//
// Goods are read strictly (`parseGoods`): a line that does not read refuses the whole goods, never drops out of them,
// because a dropped line would be something the giver put aside and the taker never got.
import { ITEM_BOUNDS, parseItem } from '../registry/items.ts';
import type { Item, ItemTemplate } from '../registry/items.ts';
import { addGold, putItem, takeItems } from '../hunter/inventory.ts';
import { isRefused, refuse } from '../save-step.ts';
import type { Refused } from '../save-step.ts';
import { parseSaveId } from '../ids.ts';
import type { HunterId, ItemId } from '../ids.ts';
import type { Save } from '../save.ts';
import type { Slot } from '../registry/items.ts';

/** One line of goods: an item by value with its count (`item.qty`), and the id it had in the bag it left. */
export type GoodsLine = { readonly from: ItemId; readonly item: ItemTemplate };
/** What a hunter hands over: gold, and items by value. */
export type Goods = { readonly gold: number; readonly items: readonly GoodsLine[] };
/** One line chosen from a bag: the item's id there, how many, and its name as the chooser saw it (for words when it is gone). */
export type PickLine = { readonly id: ItemId; readonly qty: number; readonly name: string };
/** A choice from a bag by id and count, and gold: what the Give window picked from this hunter, or what an offer asks of the other. */
export type BagPick = { readonly gold: number; readonly items: readonly PickLine[] };

export const NO_GOODS: Goods = { gold: 0, items: [] };
export const NO_PICK: BagPick = { gold: 0, items: [] };
/** At most this many item lines in one offer's goods or asks: a reader's bound for junk; the bytes (`OFFER_MAX`) decide what fits. */
export const GOODS_LINES = 8;
/** The most gold one offer gives or asks: the reward's bound (`REWARD_BOUNDS`). */
export const GOODS_GOLD_MAX = 1e9;
/**
 * The longest offer or end, in bytes of its payload's JSON in UTF-8 (`goodsSize`): 48 KiB, leaving 16 KiB of the server's
 * 64 KiB body for the request's wrapper. The effect parser does not bound an item's size (a formula nests 40 deep, a status
 * def three levels), so this is the only bound that holds; the measurement is in notes-5-trade.md 12.2.
 */
export const OFFER_MAX = 49_152;
/** The size of a value on the wire: its JSON's bytes in UTF-8. */
export const goodsSize = (v: unknown): number => new TextEncoder().encode(JSON.stringify(v)).length;
/** Whether goods hold nothing. */
export const noGoods = (g: Goods): boolean => g.gold === 0 && g.items.length === 0;

/** What a bag-holder has: a hunter, or anything shaped as one. */
type Carrying = { items: Item[]; equipped: Record<Slot, ItemId | null>; gold: number };

/** How short a hunter is of a line or of gold, for the words of a refusal. */
export type Shortfall = { readonly name: string; readonly have: number; readonly need: number };
/** Why goods could not be set aside: nothing picked, too much for one message, or a line or the gold the hunter lacks. */
export type AsideRefusal =
  | Refused<'empty' | 'too-large'>
  | (Refused<'no-item' | 'worn' | 'few' | 'poor'> & { readonly short: Shortfall });
const shortOf = <W extends 'no-item' | 'worn' | 'few' | 'poor'>(why: W, short: Shortfall): Refused<W> & { readonly short: Shortfall } => ({ ...refuse(why), short });

/** The item without its bag id. */
const templateOf = (it: Item): ItemTemplate => { const { id: _bagId, ...t } = it; return t; };
const worn = (h: Carrying, id: ItemId): boolean => Object.values(h.equipped).includes(id);

/**
 * The goods `pick` takes out of hunter `h`, and the hunter without them: each line through `takeItems`, the gold within
 * what it holds. Refused when nothing is picked (`empty`), past `GOODS_LINES` lines, `GOODS_GOLD_MAX` gold or `OFFER_MAX`
 * bytes (`too-large`), for an item it no longer holds (`no-item`), wears (`worn`) or holds fewer of (`few`), and for gold
 * it lacks (`poor`).
 */
export function setAside<H extends Carrying>(h: H, pick: BagPick): { readonly hunter: H; readonly goods: Goods } | AsideRefusal {
  if (pick.items.length === 0 && pick.gold === 0) return refuse('empty');
  if (pick.items.length > GOODS_LINES || pick.gold > GOODS_GOLD_MAX) return refuse('too-large');
  if (!Number.isInteger(pick.gold) || pick.gold < 0 || pick.items.some(l => !Number.isInteger(l.qty) || l.qty < 1)) return refuse('empty');
  let cur: H = h;
  const items: GoodsLine[] = [];
  for (const line of pick.items) {
    const it = cur.items.find(i => i.id === line.id);
    if (!it) return shortOf('no-item', { name: line.name, have: 0, need: line.qty });
    if (worn(cur, it.id)) return shortOf('worn', { name: it.name, have: it.qty, need: line.qty });
    if (it.qty < line.qty) return shortOf('few', { name: it.name, have: it.qty, need: line.qty });
    const out = takeItems(cur, it.id, line.qty);
    if (isRefused(out)) return shortOf('no-item', { name: line.name, have: 0, need: line.qty });
    cur = out;
    items.push({ from: it.id, item: { ...templateOf(it), qty: line.qty } });
  }
  if (h.gold < pick.gold) return shortOf('poor', { name: 'gold', have: h.gold, need: pick.gold });
  const goods: Goods = { gold: pick.gold, items };
  return goodsSize(goods) > OFFER_MAX ? refuse('too-large') : { hunter: addGold(cur, -pick.gold), goods };
}

/** Goods put into hunter `h`: each item through `putItem` (stacking as a bag does) under a new id from `ids`, the gold through `addGold`. */
export function received<H extends Carrying>(h: H, goods: Goods, ids: () => ItemId): H {
  return addGold(goods.items.reduce((cur, l) => putItem(cur, l.item, ids()), h), goods.gold);
}

/** Whether goods carried by an accept are exactly what an offer asked: the same gold, and for each asked line one line from that bag id with that count. */
export function fits(asked: BagPick, goods: Goods): boolean {
  if (goods.gold !== asked.gold || goods.items.length !== asked.items.length) return false;
  return asked.items.every(a => goods.items.some(l => l.from === a.id && l.item.qty === a.qty));
}

/** Why a hand over on one phone was refused: the goods, or a hunter not on the phone, or giving to itself. */
export type HandOverRefusal = AsideRefusal | Refused<'no-hunter' | 'same-hunter' | 'fight'>;
/**
 * Hunter `from` gives hunter `to` (both of this phone) what `pick` takes: `setAside` on one, `received` on the other, one
 * write, no message. Refused while a fight holds the giver (`held`), whose fight row was built from its bag.
 */
export function handOver(save: Save, from: HunterId, to: HunterId, pick: BagPick, ctx: { readonly held: boolean }, ids: () => ItemId): Save | HandOverRefusal {
  if (from === to) return refuse('same-hunter');
  const a = save.hunters.find(h => h.id === from), b = save.hunters.find(h => h.id === to);
  if (!a || !b) return refuse('no-hunter');
  if (ctx.held) return refuse('fight');
  const out = setAside(a, pick);
  if ('ok' in out) return out;
  const gained = received(b, out.goods, ids);
  return { ...save, hunters: save.hunters.map(h => (h.id === from ? out.hunter : h.id === to ? gained : h)) };
}

// ── the readers, strict: a wrong field refuses the whole value ──
type Rec = Record<string, unknown>;
const isObj = (v: unknown): v is Rec => v !== null && typeof v === 'object' && !Array.isArray(v);
const own = (o: Rec, k: string): unknown => (Object.hasOwn(o, k) ? o[k] : undefined);
const goldOf = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= GOODS_GOLD_MAX ? v : null);
function goodsLine(v: unknown): GoodsLine | null {
  if (!isObj(v)) return null;
  const from = parseSaveId<'i'>(own(v, 'from')), item = parseItem(own(v, 'item'));
  return from && item ? { from, item } : null;
}
function pickLine(v: unknown): PickLine | null {
  if (!isObj(v)) return null;
  const id = parseSaveId<'i'>(own(v, 'id')), qty = own(v, 'qty'), name = own(v, 'name');
  const n = typeof qty === 'number' && Number.isInteger(qty) && qty >= 1 && qty <= ITEM_BOUNDS.qty ? qty : null;
  return id && n !== null && typeof name === 'string' ? { id, qty: n, name: name.slice(0, ITEM_BOUNDS.name) } : null;
}
/** Lines read by `read`, at most `GOODS_LINES`, one per `key`: null when one does not read, two share a key, or there are too many. */
function linesOf<T>(v: unknown, read: (x: unknown) => T | null, key: (t: T) => string): T[] | null {
  if (!Array.isArray(v) || v.length > GOODS_LINES) return null;
  const out: T[] = [];
  for (const raw of v) {
    const line = read(raw);
    if (line === null || out.some(x => key(x) === key(line))) return null;
    out.push(line);
  }
  return out;
}
/** Goods from outside data (a room message, a stored record): whole gold from 0 to `GOODS_GOLD_MAX`, at most `GOODS_LINES` lines each read by `parseItem` with a bag id, one per id; else null. */
export function parseGoods(v: unknown): Goods | null {
  if (!isObj(v)) return null;
  const gold = goldOf(own(v, 'gold')), items = linesOf(own(v, 'items'), goodsLine, l => l.from);
  return gold !== null && items ? { gold, items } : null;
}
/** A pick from outside data: whole gold from 0 to `GOODS_GOLD_MAX`, at most `GOODS_LINES` lines of a bag id, a count from 1 and a name, one per id; else null. */
export function parseBagPick(v: unknown): BagPick | null {
  if (!isObj(v)) return null;
  const gold = goldOf(own(v, 'gold')), items = linesOf(own(v, 'items'), pickLine, l => l.id);
  return gold !== null && items ? { gold, items } : null;
}

// ── words ──
const andList = (parts: readonly string[]): string => (parts.length <= 1 ? parts.join('') : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`);
/** One line's words: "1 Healing Potion" for one, "Healing Potion × 3" for more (no plural of a name the GM typed). */
const lineWords = (name: string, qty: number): string => (qty === 1 ? `1 ${name}` : `${name} × ${qty}`);
/** Goods in words: "1 Healing Potion and 20 gold"; "nothing" for none. */
export const goodsWords = (g: Goods): string =>
  andList([...g.items.map(l => lineWords(l.item.name, l.item.qty)), ...(g.gold > 0 ? [`${g.gold} gold`] : [])]) || 'nothing';
/** A pick in words, by the names its lines carry: "Iron Shield × 2 and 20 gold"; "nothing" for none. */
export const pickWords = (p: BagPick): string =>
  andList([...p.items.map(l => lineWords(l.name, l.qty)), ...(p.gold > 0 ? [`${p.gold} gold`] : [])]) || 'nothing';

/** A hunter's offers open at once, at most: one more is refused (`too-many`) until one ends. */
export const OFFERS_OPEN = 10;
/** Why an offer, an answer, a take back or a stop was refused at the tap (notes-5-trade.md 1.7 and 12.1). */
export type OfferRefusal =
  | 'off' | 'fight' | 'no-item' | 'worn' | 'few' | 'poor' | 'empty' | 'too-large' | 'too-many' | 'not-open' | 'no-room' | 'not-played' | 'no-hunter' | 'same-hunter';
/** What a refusal says to the player who tapped, with how short it fell where it names a thing (copy-tasks.md: why, and the way out). */
export const OFFER_REFUSAL_WORDS: { readonly [R in OfferRefusal]: (s: Shortfall) => string } = {
  off: () => 'Trading is off for this table.',
  fight: () => 'A fight holds this hunter. Finish it first.',
  'no-item': s => `You no longer have the ${s.name}.`,
  worn: s => `Take off the ${s.name} to give it.`,
  few: s => `You have ${lineWords(s.name, s.have)}. This needs ${s.need}.`,
  poor: s => `You have ${s.have} gold. This needs ${s.need}.`,
  empty: () => 'Pick something to give.',
  'too-large': () => 'These items are too large to send in one offer. Give fewer.',
  'too-many': () => `You have ${OFFERS_OPEN} offers waiting. Take one back first.`,
  'not-open': () => 'This offer has already been answered.',
  'no-room': () => 'Offers need a room. Join one with the room button at the top.',
  'not-played': () => 'Only the hunter you play in this room can trade there.',
  'no-hunter': () => 'This hunter is no longer on this phone.',
  'same-hunter': () => 'Pick another hunter to give to.',
};
const NO_SHORT: Shortfall = { name: '', have: 0, need: 0 };
/** The words of a refused tap: its kind's, with how short it fell when it says. */
export const refusalWords = (r: Refused<OfferRefusal> & { readonly short?: Shortfall }): string => OFFER_REFUSAL_WORDS[r.why](r.short ?? NO_SHORT);
