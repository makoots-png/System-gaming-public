// item-book.ts: item definitions by stable `ItemDefId`, held item references (`HeldItem`), wire grants (`ItemGrant`),
// and pure resolution against `R.items`, `BUILT_IN_ITEMS`, optional remote `extraDefs`, and live `R.conditions`.
// Pure; `src/core/rules.ts` imports only types from here so no value cycle exists.
import { parseItemDefId, parseSaveId } from '../ids.ts';
import type { ItemDefId, ItemId } from '../ids.ts';
import type { ItemBook, Rules } from '../rules.ts';
import { liveAbility, liveOps, liveStatusDef } from '../combat/live-status.ts';
import type { ConditionMap } from '../combat/live-status.ts';
import { BUILT_IN_ITEMS, ITEM_BOUNDS, itemOf, parseItem } from './items.ts';
import type { Item, ItemTemplate } from './items.ts';

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

/** Minimal rules slice required to resolve an item definition or held item. */
export type ItemResolveRules = Pick<Rules, 'items' | 'conditions' | 'fight'>;

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

/** Resolves any `follow: true` `applyStatus` ops inside `def` against `conditions`, preserving identity when unchanged. */
export function liveItemDef(def: ItemDefData, conditions: ConditionMap): ItemDefData {
  const effects = def.effects ? liveOps(def.effects, conditions) : undefined;
  const worn = def.worn ? liveStatusDef(def.worn, conditions) : undefined;
  const active = def.active ? liveAbility(def.active, conditions) : undefined;
  if (effects === def.effects && worn === def.worn && active === def.active) return def;
  return {
    ...def,
    ...(effects !== undefined ? { effects: [...effects] } : {}),
    ...(worn !== undefined ? { worn } : {}),
    ...(active !== undefined ? { active } : {}),
  };
}

/** Built-in item definition data for `defId` under `R`, or null when `defId` is not a shipped built-in. */
export function builtInDefData(defId: ItemDefId, R: Pick<Rules, 'conditions' | 'fight'>): ItemDefData | null {
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

/** Structural equality of two `ItemDefData` values (key-order independent), used to drop no-op built-in overrides. */
export const sameItemDef = (a: ItemDefData, b: ItemDefData): boolean => deepEqual(a, b);

/** Whether `def` matches the shipped built-in definition for `defId` under `R`. */
export function isShippedItemDef(defId: ItemDefId, def: ItemDefData, R: Pick<Rules, 'conditions' | 'fight'>): boolean {
  const shipped = builtInDefData(defId, R);
  return shipped !== null && sameItemDef(def, shipped);
}

/** Placeholder resolved item when a custom `ItemDefId` is missing from both `R.items` and any fallback defs. */
export function unknownItem(id: ItemId, qty: number, defId: ItemDefId): ResolvedItem {
  return {
    id,
    name: 'Unknown item',
    rar: 'common',
    type: 'misc',
    slot: null,
    qty,
    dice: '',
    bonus: {},
    desc: 'This item\'s definition is no longer available.',
    armor: 0,
    resist: 0,
    defId,
    unknown: true,
  };
}

/**
 * Resolves `defId` to its current `ItemDefData`, or null if missing:
 * 1. `R.items[defId]` (GM override, custom item, synced room catalog, or player's heard fallback — always wins over stale `extraDefs`).
 * 2. `BUILT_IN_ITEMS` (shipped built-in, computed from `R` so armor kit rules stay live; prevents remote `extraDefs` from spoofing built-ins).
 * 3. `extraDefs[defId]` (remote sheet's attached fallback for a custom `c:*` def absent from `R.items`).
 * Every resolved def then applies `liveItemDef(..., R.conditions)` for `follow: true` status ops.
 */
export function resolveDef(defId: ItemDefId, R: ItemResolveRules, extraDefs?: ItemBook): ItemDefData | null {
  const raw = Object.hasOwn(R.items, defId)
    ? R.items[defId]!
    : BUILT_IN_ITEMS.has(defId)
      ? builtInDefData(defId, R)
      : extraDefs && Object.hasOwn(extraDefs, defId)
        ? extraDefs[defId]!
        : null;
  return raw ? liveItemDef(raw, R.conditions) : null;
}

/** Resolves a `HeldItem` against `R` (and optional remote sheet `extraDefs`), falling back to `unknownItem`. */
export function resolveItem(held: HeldItem, R: ItemResolveRules, extraDefs?: ItemBook): ResolvedItem {
  if (held.kind === 'adhoc') {
    return { ...liveItemDef(held.item, R.conditions), id: held.id, qty: held.qty, adhoc: true };
  }
  const def = resolveDef(held.defId, R, extraDefs);
  return def ? { ...def, id: held.id, qty: held.qty, defId: held.defId } : unknownItem(held.id, held.qty, held.defId);
}

/** Resolves an `ItemGrant` against `R` (using `grant.def` as last-resort fallback when absent from `R.items` and `BUILT_IN_ITEMS`). */
export function resolveGrant(grant: ItemGrant, R: ItemResolveRules, extraDefs?: ItemBook): ResolvedGrant {
  if (grant.kind === 'adhoc') {
    return { ...liveItemDef(grant.item, R.conditions), qty: grant.qty, adhoc: true };
  }
  const fallback: ItemBook | undefined = grant.def
    ? (extraDefs ? { ...extraDefs, [grant.defId]: grant.def } : { [grant.defId]: grant.def })
    : extraDefs;
  const def = resolveDef(grant.defId, R, fallback);
  if (def) return { ...def, qty: grant.qty, defId: grant.defId };
  const { id: _id, ...tpl } = unknownItem('i0' as ItemId, grant.qty, grant.defId);
  return tpl;
}
