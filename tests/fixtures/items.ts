// Shared fixtures for item-sync tests (PR 1 item book + PRs 2-4 storage, server catalog, and sync).
import { builtInItemId, customItemDefId, parseCatalogId, parseCatalogKey, saveId } from '../../src/core/ids.ts';
import type { CatalogId, CatalogKey, ItemDefId, ItemId } from '../../src/core/ids.ts';
import { RULES } from '../../src/core/rules.ts';
import { statusKey } from '../../src/core/combat/effect-ops.ts';
import { withGrievousCut } from '../../src/core/combat/grievous.ts';
import { tick } from '../../src/core/combat/timeline.ts';
import { BUILT_IN_STATUSES } from '../../src/core/registry/statuses.ts';
import { parseItemDef } from '../../src/core/registry/item-book.ts';
import type { HeldItem, ItemDefData, ItemGrant } from '../../src/core/registry/item-book.ts';

export const GM_CATALOG_ID: CatalogId = parseCatalogId('cat-gm1234567890')!;
export const OTHER_CATALOG_ID: CatalogId = parseCatalogId('cat-other9876543')!;
export const GM_CATALOG_KEY: CatalogKey = parseCatalogKey('ck_test_secret_key_0123456789abcdef')!;

export const THORNMAIL_DEF_ID: ItemDefId = builtInItemId('thornmail');
export const DAGGER_DEF_ID: ItemDefId = builtInItemId('iron-dagger');
export const PUNCHLINE_DEF_ID: ItemDefId = builtInItemId('the-punchline');
export const KEEPSAKE_DEF_ID: ItemDefId = builtInItemId('keepsake');

export const CUSTOM_BLADE_ID: ItemDefId = customItemDefId(GM_CATALOG_ID, 'blade1a2b');
export const CUSTOM_FLASK_FOLLOW_ID: ItemDefId = customItemDefId(GM_CATALOG_ID, 'flask3c4d');
export const CUSTOM_FLASK_PINNED_ID: ItemDefId = customItemDefId(GM_CATALOG_ID, 'flask5e6f');
export const FOREIGN_CHARM_ID: ItemDefId = customItemDefId(OTHER_CATALOG_ID, 'charm7g8h');

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
