// rules.ts: the rules a view sees. src/core/rules.ts holds the numbers and the pure helpers (they take the rules as an
// argument); this file reads the GM's overrides from the save and binds the helpers to them, so a view calls
// `xpToNext(level)` or `rules().fight`. On a player's phone in a room the room's rules (the GM's `rules` doc: the build
// and personal gates' switches and the economy's rules) are laid over the save's (`withRoomRules` in src/core/hunter/build.ts),
// and the room's synced catalog (`bindCatalog`) supplies `R.items` (`heardItems` under the catalog's defs) and
// `R.conditions` (the built-ins under the catalog's statuses); nothing of the room is written to the save. Alone or as
// GM, the item defs in force are the save's (library over heard) and, on a room's GM phone, the players' sheets' custom
// defs under them (`bindSheetDefs`).
// It re-exports the constants of core/rules.ts and the day's clock of core/day.ts, so a view has one import.
import { RULES, rankForLevel as rankForLevelOf, rulesOf, xpToNext as xpToNextOf } from '../core/rules.ts';
import type { Rank, Rules } from '../core/rules.ts';
import type { StatusDef } from '../core/combat/effect-ops.ts';
import type { RoomRules } from '../core/protocol.ts';
import { withRoomRules } from '../core/hunter/build.ts';
import { savedItemBook } from '../core/save.ts';
import { isCustomItemDefId } from '../core/ids.ts';
import type { ItemDefId } from '../core/ids.ts';
import type { ItemDefData } from '../core/registry/item-book.ts';

export * from '../core/rules.ts';
export * from '../core/overrides.ts';
export * from '../core/day.ts';

/** The parts of the save the rules are made from. */
type RulesSource = { rulesOverrides: unknown; library: { statuses: Record<string, StatusDef>; items: Record<ItemDefId, ItemDefData> }; heardItems: Record<ItemDefId, ItemDefData> };
let sourceOf: () => RulesSource | null = () => null;
/** The store calls this once, with a function that returns the current save. */
export function bindSave(getSave: () => RulesSource): void { sourceOf = getSave; }
let roomRulesOf: () => RoomRules | null = () => null;
/** sync.ts calls this once, with a function that answers the room's rules (the GM's `rules` doc) while this phone is a player in a room, else null. */
export function bindRoom(getRules: () => RoomRules | null): void { roomRulesOf = getRules; }
/** The custom defs of the room's pushed sheets, by id. */
type ItemDefs = Readonly<Record<ItemDefId, ItemDefData>>;
/** The GM's synced catalog as a player phone reads it (edge/sync.ts `bindCatalog`): item defs and statuses. */
export type BoundCatalog = {
  readonly defs: ItemDefs;
  readonly statuses: Readonly<Record<string, StatusDef>>;
};
/** No sheets' defs: one object, so the rules stay the same object between writes. */
const NO_SHEET_DEFS: ItemDefs = Object.freeze({});
let sheetDefsOf: () => ItemDefs = () => NO_SHEET_DEFS;
/**
 * sync.ts calls this once, with a function that answers the custom defs the players' pushed sheets carry while this
 * phone is the GM of a room (protocol.ts `PushedSheet.defs`), else none: the same object until the room's sheets change.
 */
export function bindSheetDefs(getDefs: () => ItemDefs): void { sheetDefsOf = getDefs; }
let catalogOf: () => BoundCatalog | null = () => null;
/**
 * sync.ts calls this once, with a function that answers the room's active synced catalog while this phone is a player
 * in a room, else null: the same object reference until a new catalog read lands or is promoted at `release()`.
 */
export function bindCatalog(getCatalog: () => BoundCatalog | null): void { catalogOf = getCatalog; }

/**
 * What the rules in force were made from, and what they are. The save's overrides, the GM's statuses, and the bound
 * catalog are compared by reference: the store changes the save only through `store.update`, whose repair
 * (src/core/save.ts) gives overrides and statuses new objects on every write, so a new object is a write and the same
 * object is none (tests/rules-in-force.test.ts holds the repair to it). Turning them to JSON instead cost about 2 ms a
 * read with 200 statuses of 2 KB, and a fight turn reads the rules 13 to 30 times. The room's rules are a few switches,
 * made new on each read, so they are compared as JSON.
 */
let made: {
  readonly overrides: unknown; readonly statuses: unknown; readonly items: unknown; readonly heard: unknown;
  readonly sheets: unknown; readonly catalog: BoundCatalog | null; readonly room: string; readonly R: Rules;
} | null = null;
/**
 * The item defs in force (`R.items`):
 * - In a room as a player with a synced catalog (`catalog !== null`): `heardItems` (custom ids only) under `catalog.defs`,
 *   so the GM's built-in overrides and custom item edits win, while deleted or foreign custom items stay readable from `heardItems`.
 * - Otherwise (alone, GM, or before the catalog arrives): the players' sheets' custom defs on the GM's phone, under
 *   `heardItems`, under the library's own.
 */
function itemsInForce(s: RulesSource, sheets: ItemDefs, catalog: BoundCatalog | null): Record<ItemDefId, ItemDefData> {
  if (catalog) {
    const heard = Object.entries(s.heardItems).filter(([k]) => isCustomItemDefId(k as ItemDefId));
    return heard.length ? { ...Object.fromEntries(heard), ...catalog.defs } : { ...catalog.defs };
  }
  const fromSheets = Object.entries(sheets).filter(([k]) => isCustomItemDefId(k as ItemDefId));
  const saved = savedItemBook(s);
  return fromSheets.length ? { ...Object.fromEntries(fromSheets), ...saved } : saved;
}
/**
 * The rules now in force: the shipped rules with the save's overrides and statuses/items merged in (from the room's
 * synced catalog while in a room as a player, else from the save's library), and the room's rules (its build and
 * personal gates' switches and economy) over them while in a room as a player. The same object until an input changes,
 * so a caller may compare two answers to learn whether the rules may have moved.
 */
export function rules(): Rules {
  const s = sourceOf();
  if (!s) return RULES;
  const roomRules = roomRulesOf(), room = JSON.stringify(roomRules), sheets = sheetDefsOf(), catalog = catalogOf();
  if (!made || made.overrides !== s.rulesOverrides || made.statuses !== s.library.statuses || made.items !== s.library.items || made.heard !== s.heardItems || made.sheets !== sheets || made.catalog !== catalog || made.room !== room) {
    const statuses = catalog ? catalog.statuses : s.library.statuses;
    made = {
      overrides: s.rulesOverrides, statuses: s.library.statuses, items: s.library.items, heard: s.heardItems, sheets, catalog, room,
      R: withRoomRules(rulesOf(s.rulesOverrides, statuses, itemsInForce(s, sheets, catalog)), roomRules),
    };
  }
  return made.R;
}

export const xpToNext = (level: number): number => xpToNextOf(rules(), level);
export const rankForLevel = (level: number): Rank => rankForLevelOf(rules(), level);
