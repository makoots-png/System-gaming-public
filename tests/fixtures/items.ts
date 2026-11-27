// Shared fixtures for item-sync tests (PR 1 item book + PRs 2-4 storage, server catalog, and sync).
import { ITEM_STAMP_CHARS, ITEM_STAMP_LEN, builtInItemId, customItemDefId, parseCatalogKey, saveId } from '../../src/core/ids.ts';
import { catalogIdOf } from '../../src/core/catalog-id.ts';
import type { CatalogId, CatalogKey, ItemDefId, ItemId } from '../../src/core/ids.ts';
import { RULES, withItems } from '../../src/core/rules.ts';
import type { Rules } from '../../src/core/rules.ts';
import type { ItemTemplate } from '../../src/core/registry/items.ts';
import { statusKey } from '../../src/core/combat/effect-ops.ts';
import { withGrievousCut } from '../../src/core/combat/grievous.ts';
import { tick } from '../../src/core/combat/timeline.ts';
import { BUILT_IN_STATUSES } from '../../src/core/registry/statuses.ts';
import { itemDefDataOf, parseItemDef } from '../../src/core/registry/item-book.ts';
import type { HeldItem, ItemDefData, ItemGrant } from '../../src/core/registry/item-book.ts';

export const GM_CATALOG_KEY: CatalogKey = parseCatalogKey('ck_test_secret_key_0123456789abcdef')!;
export const OTHER_CATALOG_KEY: CatalogKey = parseCatalogKey('ck_other_table_key_fedcba9876543210')!;
export const GM_CATALOG_ID: CatalogId = catalogIdOf(GM_CATALOG_KEY);
export const OTHER_CATALOG_ID: CatalogId = catalogIdOf(OTHER_CATALOG_KEY);

/** A 16-character stamp from a word, padded with its own letters: readable in a failing test, valid for `customItemDefId`. */
export const stampOf = (word: string): string => word.toLowerCase().replace(/[^a-z0-9]/g, '').padEnd(ITEM_STAMP_LEN, '0').slice(0, ITEM_STAMP_LEN);
/** A `mintStamp` for core steps that mint custom item ids: `s0000...1`, `s0000...2` and on, so a test can name what it gets. */
export function stampSeq(prefix = 's'): () => string {
  let n = 0;
  return () => { n++; return `${prefix}${String(n).padStart(ITEM_STAMP_LEN - prefix.length, '0')}`; };
}
/** A random stamp as the edge mints one (16 of `ITEM_STAMP_CHARS`), from `Math.random`, for property tests. */
export const randomStamp = (): string => Array.from({ length: ITEM_STAMP_LEN }, () => ITEM_STAMP_CHARS[Math.floor(Math.random() * ITEM_STAMP_CHARS.length)]).join('');

export const THORNMAIL_DEF_ID: ItemDefId = builtInItemId('thornmail');
export const DAGGER_DEF_ID: ItemDefId = builtInItemId('iron-dagger');
export const PUNCHLINE_DEF_ID: ItemDefId = builtInItemId('the-punchline');
export const KEEPSAKE_DEF_ID: ItemDefId = builtInItemId('keepsake');

export const CUSTOM_BLADE_ID: ItemDefId = customItemDefId(GM_CATALOG_ID, stampOf('blade1a2b'));
export const CUSTOM_FLASK_FOLLOW_ID: ItemDefId = customItemDefId(GM_CATALOG_ID, stampOf('flask3c4d'));
export const CUSTOM_FLASK_PINNED_ID: ItemDefId = customItemDefId(GM_CATALOG_ID, stampOf('flask5e6f'));
export const FOREIGN_CHARM_ID: ItemDefId = customItemDefId(OTHER_CATALOG_ID, stampOf('charm7g8h'));

const ROUND = RULES.fight.round;

/** Custom weapon definition owned by `GM_CATALOG_ID`. */
export const CUSTOM_BLADE_DEF: ItemDefData = parseItemDef({
  name: 'Rift Fang',
  rar: 'epic',
  grade: 1,
  type: 'weapon',
  slot: 'weapon',
  dice: '2d8',
  attack: 'strike',
  finesse: true,
  bonus: { agi: 3 },
  desc: 'A blade forged from a rift shard.',
})!;

/** Custom consumable whose Grievous Wounds op follows live `R.conditions.grievous`. */
export const CUSTOM_FLASK_FOLLOW_DEF: ItemDefData = parseItemDef({
  name: 'Live Blight Vial',
  rar: 'rare',
  type: 'consumable',
  target: 'other',
  desc: 'Applies Grievous Wounds at the current rules default.',
  effects: [
    { op: 'applyStatus', key: statusKey('grievous'), def: BUILT_IN_STATUSES.grievous, duration: tick(2 * ROUND), follow: true },
  ],
})!;

/** Custom consumable whose Grievous Wounds op is pinned at 25% regardless of rules edits. */
export const CUSTOM_FLASK_PINNED_DEF: ItemDefData = parseItemDef({
  name: 'Mild Blight Vial',
  rar: 'rare',
  type: 'consumable',
  target: 'other',
  desc: 'Applies a fixed 25% Grievous Wounds cut.',
  effects: [
    { op: 'applyStatus', key: statusKey('grievous'), def: withGrievousCut(BUILT_IN_STATUSES.grievous, 25), duration: tick(2 * ROUND) },
  ],
})!;

/** Custom accessory from another GM's catalog (to test foreign fallback resolution). */
export const FOREIGN_CHARM_DEF: ItemDefData = parseItemDef({
  name: 'Stranger\'s Coin',
  rar: 'uncommon',
  type: 'accessory',
  slot: 'neck',
  bonus: { ins: 2 },
  desc: 'A charm brought from another table.',
})!;

/** Player-made ad-hoc item (never synced into a GM catalog). */
export const ADHOC_CHARM_DEF: ItemDefData = parseItemDef({
  name: 'Lucky Pebble',
  rar: 'common',
  type: 'misc',
  desc: 'Picked up outside the gate.',
})!;

export const heldRef = (n: number, defId: ItemDefId, qty = 1): HeldItem =>
  ({ kind: 'ref', id: saveId('i', n), defId, qty });

export const heldAdhoc = (n: number, item: ItemDefData, qty = 1): HeldItem =>
  ({ kind: 'adhoc', id: saveId('i', n), qty, item });

export const grantRef = (defId: ItemDefId, qty = 1, def?: ItemDefData): ItemGrant =>
  (def ? { kind: 'ref', defId, qty, def } : { kind: 'ref', defId, qty });

export const grantAdhoc = (item: ItemDefData, qty = 1): ItemGrant =>
  ({ kind: 'adhoc', qty, item });

export const itemIdN = (n: number): ItemId => saveId('i', n);

// ── PR 2: items by reference in saves, bags and grants ──

/** A custom item id of the GM's catalog named by a word (`stampOf`). */
export const customId = (word: string, catalog: CatalogId = GM_CATALOG_ID): ItemDefId => customItemDefId(catalog, stampOf(word));
/** `R` with `defs` laid over its item book (rules.ts `withItems`): what a test reads a custom item under. */
export const rulesWith = (defs: Readonly<Record<string, ItemDefData>>, R: Rules = RULES): Rules => withItems(R, defs as Record<ItemDefId, ItemDefData>);
/** A by-value item (an old test's template) as an ad hoc grant of its count. */
export const adhocOf = (t: ItemTemplate): ItemGrant => ({ kind: 'adhoc', qty: t.qty, item: itemDefDataOf(t) });
/** A by-value item (an old test's template) as a reference grant to `defId`, of its count. */
export const refOf = (defId: ItemDefId, t: Pick<ItemTemplate, 'qty'> = { qty: 1 }): ItemGrant => ({ kind: 'ref', defId, qty: t.qty });
/** A template as a def keyed under a custom id named by `word`, for `rulesWith`: `{ [customId(word)]: def }`. */
export const defOf = (word: string, t: ItemTemplate): Record<ItemDefId, ItemDefData> => ({ [customId(word)]: itemDefDataOf(t) });
