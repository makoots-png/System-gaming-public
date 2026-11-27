// item-book.ts: item definitions by stable `ItemDefId`, held item references (`HeldItem`), wire grants (`ItemGrant`),
// and pure resolution against `R.items`, `BUILT_IN_ITEMS`, optional remote `extraDefs`, and live `R.conditions`.
// Pure; `src/core/rules.ts` imports only types from here so no value cycle exists.
import { isCustomItemDefId, parseItemDefId, parseSaveId } from '../ids.ts';
import type { ItemDefId, ItemId } from '../ids.ts';
import type { ItemBook, Rules } from '../rules.ts';
import { liveAbility, liveOps, liveStatusDef } from '../combat/live-status.ts';
import type { ConditionMap } from '../combat/live-status.ts';
import { BUILT_IN_ITEMS, ITEM_BOUNDS, KIT_SHARE, itemOf, parseItem, piece, weightOf } from './items.ts';
import type { Item, ItemTemplate } from './items.ts';
import { withinSize } from '../size.ts';

/** Player- and GM-facing words for an item whose details are not loaded on this phone. */
export const UNKNOWN_ITEM_WORDS = {
  name: 'Unknown item',
  desc: 'Details for this item are not on this phone yet. Reconnect to the room, or ask your GM.',
} as const;

/**
 * One item definition without per-copy `id` or stack `qty`: what lives in the GM's library (`library.items`),
 * the synced GM catalog, `R.items`, and an ad-hoc player-made bag item.
 */
export type ItemDefData = Omit<Item, 'id' | 'qty'>;

/**
 * One stack in a hunter's bag: either a reference (`ref`) to a definition by `ItemDefId` (which resolves live against
 * `R.items` and `BUILT_IN_ITEMS`), or a player-made item (`adhoc`) carrying its own definition.
 */
export type HeldItem =
  | { readonly kind: 'ref'; readonly id: ItemId; readonly defId: ItemDefId; readonly qty: number }
  | { readonly kind: 'adhoc'; readonly id: ItemId; readonly qty: number; readonly item: ItemDefData };

/**
 * One item stack on the wire or in a reward/stash/loot/quest/bundle entry: either a `ref` (with optional `def` fallback
 * for custom items whose catalog may not be loaded on the receiver) or an `adhoc` player-made item.
 */
export type ItemGrant =
  | { readonly kind: 'ref'; readonly defId: ItemDefId; readonly qty: number; readonly def?: ItemDefData }
  | { readonly kind: 'adhoc'; readonly qty: number; readonly item: ItemDefData };

/** A resolved held item ready for sheet, combat, detail, and view readers. */
export type ResolvedItem = Item & {
  readonly defId?: ItemDefId;
  readonly adhoc?: true;
  readonly unknown?: true;
};

/** A resolved grant (no per-copy `ItemId` yet). */
export type ResolvedGrant = ItemTemplate & {
  readonly defId?: ItemDefId;
  readonly adhoc?: true;
  readonly unknown?: true;
};

/** The most defs a save's `heardItems` keeps (item-refs.ts `heardStep` keeps only the ones the save names). */
export const HEARD_MAX = 400;

/** Minimal rules slice required to resolve an item definition or held item. */
export type ItemResolveRules = Pick<Rules, 'items' | 'fight'> & { readonly conditions: ConditionMap };

type Rec = Record<string, unknown>;
const isObj = (v: unknown): v is Rec => v !== null && typeof v === 'object' && !Array.isArray(v);
const qtyOf = (v: unknown): number | null =>
  (typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= ITEM_BOUNDS.qty ? v : null);

/** Strips `qty` from an `ItemTemplate` to produce its normalized `ItemDefData`. */
export function itemDefDataOf(t: ItemTemplate): ItemDefData {
  const { qty: _qty, ...def } = t;
  return def;
}

/**
 * Reads an `ItemDefData` from outside data through the one item parser (`parseItem`) and drops stack `qty`.
 * Returns null if `parseItem` refuses the value.
 */
export function parseItemDef(v: unknown): ItemDefData | null {
  const t = parseItem(v);
  return t ? itemDefDataOf(t) : null;
}

/**
 * Item defs by id from outside data (the library, `heardItems`, a sheet's or a doc's `defs`): each key `parseItemDefId`
 * reads with a def `parseItemDef` reads, at most `cap`; anything else is dropped.
 */
export function parseItemBook(v: unknown, cap: number): Record<ItemDefId, ItemDefData> {
  const out: Record<ItemDefId, ItemDefData> = {};
  if (!isObj(v)) return out;
  let n = 0;
  for (const [k, raw] of Object.entries(v)) {
    if (n >= cap) break;
    const id = parseItemDefId(k), def = id ? parseItemDef(raw) : null;
    if (id && def) { out[id] = def; n++; }
  }
  return out;
}

/** Parses a `HeldItem` (`ref` or `adhoc`) from outside data, or null when invalid. */
export function parseHeldItem(v: unknown): HeldItem | null {
  if (!isObj(v)) return null;
  const id = parseSaveId<'i'>(v.id);
  const qty = qtyOf(v.qty);
  if (!id || qty === null) return null;
  if (v.kind === 'ref') {
    const defId = parseItemDefId(v.defId);
    return defId ? { kind: 'ref', id, defId, qty } : null;
  }
  if (v.kind === 'adhoc') {
    const item = parseItemDef(v.item);
    return item ? { kind: 'adhoc', id, qty, item } : null;
  }
  return null;
}

/** Parses an `ItemGrant` (`ref` with optional valid `def`, or `adhoc`) from outside data, or null when invalid. */
export function parseItemGrant(v: unknown): ItemGrant | null {
  if (!isObj(v)) return null;
  const qty = qtyOf(v.qty);
  if (qty === null) return null;
  if (v.kind === 'ref') {
    const defId = parseItemDefId(v.defId);
    if (!defId) return null;
    if (v.def === undefined) return { kind: 'ref', defId, qty };
    const def = parseItemDef(v.def);
    return def ? { kind: 'ref', defId, qty, def } : null;
  }
  if (v.kind === 'adhoc') {
    const item = parseItemDef(v.item);
    return item ? { kind: 'adhoc', qty, item } : null;
  }
  return null;
}

/** Resolves any `follow: true` `applyStatus` ops inside `def` against `conditions`, preserving identity when unchanged and falling back to `def` if the resolved item exceeds `THING_MAX.item`. */
export function liveItemDef(def: ItemDefData, conditions: ConditionMap): ItemDefData {
  const effects = def.effects ? liveOps(def.effects, conditions) : undefined;
  const worn = def.worn ? liveStatusDef(def.worn, conditions) : undefined;
  const active = def.active ? liveAbility(def.active, conditions) : undefined;
  if (effects === def.effects && worn === def.worn && active === def.active) return def;
  const next: ItemDefData = {
    ...def,
    ...(effects !== undefined ? { effects: [...effects] } : {}),
    ...(worn !== undefined ? { worn } : {}),
    ...(active !== undefined ? { active } : {}),
  };
  return withinSize('item', { ...next, qty: 1 }) ? next : def;
}

/**
 * `def` with its kit's numbers under `R` (`piece`) when it names a kit and sits in an armor slot, so a change of
 * `fight.kits` reaches every piece of armor made of a kit, built-in or the GM's own; `def` itself when not or unchanged.
 */
export function kittedDef(def: ItemDefData, R: Pick<Rules, 'fight'>): ItemDefData {
  if (!def.kit || def.slot === null || !Object.hasOwn(KIT_SHARE, def.slot)) return def;
  const p = piece(def.kit, def.slot as keyof typeof KIT_SHARE, R);
  return def.weight === p.weight && def.armor === p.armor && def.resist === p.resist ? def : { ...def, ...p };
}

/** Built-in item definition data for `defId` under `R`, or null when `defId` is not a shipped built-in. */
export function builtInDefData(defId: ItemDefId, R: Pick<ItemResolveRules, 'conditions' | 'fight'>): ItemDefData | null {
  const seed = BUILT_IN_ITEMS.get(defId);
  return seed ? itemDefDataOf(itemOf(R, seed)) : null;
}

/** Canonical deep comparison for plain JSON-serializable values (independent of object key insertion order). */
function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!deepEqual(a[i], b[i])) return false;
    return true;
  }
  const ak = Object.keys(a).filter(k => (a as Rec)[k] !== undefined);
  const bk = Object.keys(b).filter(k => (b as Rec)[k] !== undefined);
  if (ak.length !== bk.length) return false;
  for (const k of ak) {
    if (!Object.hasOwn(b, k) || !deepEqual((a as Rec)[k], (b as Rec)[k])) return false;
  }
  return true;
}

const withWeight = (d: ItemDefData): Record<string, unknown> => ({ ...d, weight: weightOf(d) });
/** `d` without the numbers its kit decides (weight, armor, resist), for comparing two defs that name one kit. */
const kitless = (d: ItemDefData): Record<string, unknown> => { const { weight: _w, armor: _a, resist: _r, ...rest } = d; return rest; };

/**
 * Structural equality of two `ItemDefData` values (key-order independent, comparing effective weight via `weightOf`;
 * two that name one kit are compared without the weight, armor and resist the kit decides), used to drop no-op
 * built-in overrides.
 */
export const sameItemDef = (a: ItemDefData, b: ItemDefData): boolean =>
  (a.kit !== undefined && a.kit === b.kit ? deepEqual(kitless(a), kitless(b)) : deepEqual(withWeight(a), withWeight(b)));

/** Whether `def` (after live `follow: true` resolution under `R.conditions`) matches the shipped built-in definition for `defId` under `R`. */
export function isShippedItemDef(defId: ItemDefId, def: ItemDefData, R: Pick<ItemResolveRules, 'conditions' | 'fight'>): boolean {
  const shipped = builtInDefData(defId, R);
  return shipped !== null && sameItemDef(liveItemDef(def, R.conditions), shipped);
}

/** Placeholder resolved grant when an `ItemDefId` is missing from both `R.items` and any fallback defs. */
export function unknownGrant(qty: number, defId: ItemDefId): ResolvedGrant {
  return {
    name: UNKNOWN_ITEM_WORDS.name,
    rar: 'common',
    type: 'misc',
    slot: null,
    qty,
    dice: '',
    bonus: {},
    desc: UNKNOWN_ITEM_WORDS.desc,
    armor: 0,
    resist: 0,
    defId,
    unknown: true,
  };
}

/** Placeholder resolved item when an `ItemDefId` is missing from both `R.items` and any fallback defs. */
export function unknownItem(id: ItemId, qty: number, defId: ItemDefId): ResolvedItem {
  return { id, ...unknownGrant(qty, defId) };
}

/**
 * Resolves `defId` to its current `ItemDefData`, or null if missing:
 * 1. `R.items[defId]` (GM override, custom item, synced room catalog, or player's heard fallback — always wins over stale `extraDefs`).
 * 2. `BUILT_IN_ITEMS` (shipped built-in, computed from `R` so armor kit rules stay live; prevents remote `extraDefs` from spoofing built-ins).
 * 3. `extraDefs[defId]` (remote sheet's attached fallback for a custom `c:*` def absent from `R.items`; never read for `b:*` ids).
 * Every resolved def then takes its kit's numbers (`kittedDef`) and applies `liveItemDef(..., R.conditions)` for `follow: true` status ops.
 */
export function resolveDef(defId: ItemDefId, R: ItemResolveRules, extraDefs?: ItemBook): ItemDefData | null {
  const raw = Object.hasOwn(R.items, defId)
    ? R.items[defId]!
    : BUILT_IN_ITEMS.has(defId)
      ? builtInDefData(defId, R)
      : isCustomItemDefId(defId) && extraDefs && Object.hasOwn(extraDefs, defId)
        ? extraDefs[defId]!
        : null;
  return raw ? liveItemDef(kittedDef(raw, R), R.conditions) : null;
}

/** Resolves a `HeldItem` against `R` (and optional remote sheet `extraDefs`), falling back to `unknownItem`. */
export function resolveItem(held: HeldItem, R: ItemResolveRules, extraDefs?: ItemBook): ResolvedItem {
  if (held.kind === 'adhoc') {
    return { ...liveItemDef(kittedDef(held.item, R), R.conditions), id: held.id, qty: held.qty, adhoc: true };
  }
  const def = resolveDef(held.defId, R, extraDefs);
  return def ? { ...def, id: held.id, qty: held.qty, defId: held.defId } : unknownItem(held.id, held.qty, held.defId);
}

/** Resolves an `ItemGrant` against `R` (using `grant.def` as last-resort fallback for custom `c:*` defs absent from `R.items`). */
export function resolveGrant(grant: ItemGrant, R: ItemResolveRules, extraDefs?: ItemBook): ResolvedGrant {
  if (grant.kind === 'adhoc') {
    return { ...liveItemDef(kittedDef(grant.item, R), R.conditions), qty: grant.qty, adhoc: true };
  }
  const fallback: ItemBook | undefined = grant.def
    ? (extraDefs ? { ...extraDefs, [grant.defId]: grant.def } : { [grant.defId]: grant.def })
    : extraDefs;
  const def = resolveDef(grant.defId, R, fallback);
  return def ? { ...def, qty: grant.qty, defId: grant.defId } : unknownGrant(grant.qty, grant.defId);
}

/**
 * `qty` of bag line `held` as a grant, for a hand over, the stash or a message: a reference keeps its id and, for a
 * custom item, carries its def as this phone reads it (`resolveDef`), so a phone without the def can still read it; an
 * ad hoc line carries its own.
 */
export function grantOf(held: HeldItem, qty: number, R: ItemResolveRules): ItemGrant {
  if (held.kind === 'adhoc') return { kind: 'adhoc', qty, item: held.item };
  const def = isCustomItemDefId(held.defId) ? resolveDef(held.defId, R) : null;
  return def ? { kind: 'ref', defId: held.defId, qty, def } : { kind: 'ref', defId: held.defId, qty };
}

/** The defs grants carry, by id (`ItemGrant.def`), for item-refs.ts `heardStep`. */
export function grantDefs(grants: readonly ItemGrant[]): Record<ItemDefId, ItemDefData> {
  const out: Record<ItemDefId, ItemDefData> = {};
  for (const g of grants) if (g.kind === 'ref' && g.def && isCustomItemDefId(g.defId)) out[g.defId] = g.def;
  return out;
}

/**
 * `v` (a room event's body) with each reference grant to a custom item that carries no def given its def as `R` reads
 * it (`resolveDef`), so a phone without the GM's library reads what it is given. A grant is an object of `kind: 'ref'`
 * with a `defId` and a `qty` and no `id` (a bag line has one and is never filled). Everything else is copied as it is.
 */
export function withGrantDefs<T>(v: T, R: ItemResolveRules): T {
  const walk = (x: unknown): unknown => {
    if (Array.isArray(x)) return x.map(walk);
    if (!isObj(x)) return x;
    if (x.kind === 'ref' && typeof x.defId === 'string' && typeof x.qty === 'number' && !('id' in x) && x.def === undefined) {
      const id = parseItemDefId(x.defId), def = id && isCustomItemDefId(id) ? resolveDef(id, R) : null;
      return def ? { ...x, def } : x;
    }
    return Object.fromEntries(Object.entries(x).map(([k, y]) => [k, walk(y)]));
  };
  return walk(v) as T;
}

/** The custom defs bag `items` reads under `R`, by id: what a pushed sheet carries so the GM and the server can read them. */
export function bagDefs(items: readonly HeldItem[], R: ItemResolveRules): Record<ItemDefId, ItemDefData> {
  const out: Record<ItemDefId, ItemDefData> = {};
  for (const i of items) {
    if (i.kind !== 'ref' || !isCustomItemDefId(i.defId) || Object.hasOwn(out, i.defId)) continue;
    const def = resolveDef(i.defId, R);
    if (def) out[i.defId] = def;
  }
  return out;
}

/** A grant of `qty` of def `defId`, by reference. */
export const refGrant = (defId: ItemDefId, qty = 1): ItemGrant => ({ kind: 'ref', defId, qty });
/** A grant of `qty` of a player's own item `item` (ad hoc). */
export const adhocGrant = (item: ItemDefData, qty = 1): ItemGrant => ({ kind: 'adhoc', qty, item });

/**
 * The name a grant gives, without the rules: an ad hoc item's own, a custom item's def it carries, the shipped name of a
 * built-in, else `UNKNOWN_ITEM_WORDS.name`. What goods and the stash say in words, on any phone.
 */
export function grantName(g: ItemGrant): string {
  if (g.kind === 'adhoc') return g.item.name;
  if (g.def) return g.def.name;
  return BUILT_IN_ITEMS.get(g.defId)?.name ?? UNKNOWN_ITEM_WORDS.name;
}
