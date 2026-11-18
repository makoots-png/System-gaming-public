# Notes: unit 1, one home and one parser per kind

Principles read: boundary discipline, type-system discipline, migrate callers then delete, subtract before you add, test behaviour, unslop.

## Step 1: dead weight

- `lootTables` is gone from `Save` and `newSave`; the repair deletes the key from an older save. `rollLoot` rolls by the rules' rank table only.
- A monster's `statusDefs` is gone: the type, the bestiary's `clean` and its auto-add write. The repair deletes the key.
- A shadow combatant has no `abilities`: removed from the fight's `Shadow` type (`encounter-types.ts`) and its parser as well as from `combat.js`, since nothing gave it any. Tests that built a shadow row with `abilities: []` lost the field.
- `forge` is in `MODULES` and `ForgeApi` is a required member of `AppApi`, so `gm.js` calls `forge.status` directly. The fallback `statusDialog` and its `.gm-sw` CSS are deleted.
- Changed expectations: the two save tests that read `main-export.json` back drop its `lootTables: null` first (a current save has no such key). New test: the loot tables and a monster's status defs are dropped at load.
- Commit 1: step 1.

## Step 2: parseItem

- Home: `src/core/registry/items.ts`, beside `itemOf`. `save.ts` calls it, so the item enums (`RARITIES`, `ITEM_TYPES`, `SLOTS` and their types) moved into `items.ts` to avoid a value import cycle; `save.ts` re-exports them, so every other import is unchanged.
- One set of bounds, in `ITEM_BOUNDS`: name 60 (trimmed, required), desc 500, dice 30 (trimmed text, not checked as dice), qty 1 to 9999, value 0 to 1e9, heal and restoreMp 0 to 99,999, fatigue 0 to 100 and kept only above 0, the nine bonus keys (`PERK_KEYS`) -999 to 999 with 0 dropped, effects through `sanitizeOps` and kept only when not empty. Numbers are cut with `Math.trunc`.
- A field of the wrong type or value takes the new item's default; only a missing name or a non-object refuses the item. Chosen because the save repair must keep a hunter's item whose `rar` is damaged; a room message used to refuse the whole item instead.
- Callers migrated and deleted: `fixItem` (save.ts: hunters' items, library, shop), quest reward repair (was: objects with checked effects), `givenItem` (protocol.ts, still 20 a message), `clean` (inventory.js), `cleanItem` and `stripItem` (quests.js). `RewardItem`, `GivenItem` and `GivenRewards` are gone: `Rewards.items` is `ItemTemplate[]` and the room reads `Rewards`.
- The save keeps each item object (emptied and refilled), since views may hold one between updates. An item without an id still takes `i0` as before.
- Forms convert their text to numbers before `parseItem` (the inventory form, the quest form's `Name | rarity | qty` lines).
- Changed expectations:
  - protocol: an award item with `rar: 5` or `qty: 'two'` is now kept with `common` and 1 (was dropped).
  - protocol: the bonus test is renamed to the nine keys (its numbers are unchanged).
  - save: a hunter's item with `qty: -2` is 1 (was 0).
  - save: test items without a name got one (`Gun`, `Gem`): an item without a name is now dropped.
  - save: an item's unknown key (`glow`) is dropped. It moved out of the "unknown keys survive" test into its own test.
  - save: the fixtures' library blade loses `bonus.atk: 1` (`currentLibrary` in the test). `atk` is not a gear bonus key and no sheet counted it.
  - lint (vitals rule): the allowed `out.fatigue` write moved from protocol.ts and inventory.js to items.ts.
- Table-visible: qty above 999 now arrives through a room message (was cut to 999). An item stack edited in the inventory form keeps 9999. A blank-named item in a save is dropped.
- Commit 2: step 2.

## Step 3: an item's ops at its rarity

- `atTier` in `status.ts` is exported (it is the resolver `statusDef` uses; its comment says so). `itemOps(item, when)` in `src/core/effects.ts` is `effectsOf` with each op through `atTier` at the item's rarity tier (`rarityTier`, which `itemSource` also uses now).
- `inventory.use` and `inventory.bonuses` call `itemOps` directly (inventory.js already imported `itemSource` from core). `effectsOf` left `app.api.effects`, which no view used any more; `applyOps` gets flat ops.
- Worn `check`: the sheet reads a status's check mod in `derived().checkBonus` (`em.check`, hunter.js). `inventory.bonuses` now answers `check` as well as `ac`, `atk`, `dmg` from worn mods, `bonusOf` sums it (`AKEYS`), and `checkBonus` adds `bon.check`. `Bonuses` in api.ts lists `atk`, `dmg` and `check`.
- Item cards still show a tiered op as all six numbers (`describeItem` reads `effectsOf`, unresolved): the brief asks for use and wear only.
- Tests: `tests/items.test.ts` (rare heal by rank, epic ring AC by rank, 25% heal of 40 is 10, mods worn and the rest used) and one browser test in `tests/e2e/character.e2e.ts` (the potion, the tonic, the ring and a +2 check charm, through Use and Equip). Before the change the potion healed 0 and the ring added NaN.
- Commit 3: step 3.

## Step 4: the Loot Forge keeps what it cannot show

- `rowsFromEffects` in `loot.js` answers `{ rows, kept }`. Kept: any op with `tiers` or `pct`, an op at a time other than its default (a mod not worn, anything else not on use), a check mod, and `mp` and `fatigue` ops. Save writes the kept ops first, untouched, then the rows.
- The dialog says "Also keeps N other effects: ..." under the effect rows, with the item's own describe lines (the same words the Status dialog uses for its kept ops).
- Browser test in `tests/e2e/character.e2e.ts`: a library item with six effects (heal by rank, 10% damage, AC by rank, a check mod, MP, a note) reads back equal after Edit and Save. Before, Edit and Save left two of them (the note and a flat +1 AC).
- Commit 4: step 4.

## Step 5: library.statuses

- `Library` is `{ items, statuses }`; `statuses: Record<string, StatusDef>`. `statusLibrary` in save.ts: at most 200 keys, each a slug (`STATUS_KEY_RE`: lower-case words joined by hyphens, 1 to 40 characters), not a state chip (`isStateChip`), each def through `sanitizeDef`. Anything else is dropped.
- The move (`moveStatuses`, run first in every repair): `rulesOverrides.conditions` is deleted, and each entry moves to the library. An entry under a built-in key is read over that built-in first (`{ ...builtIn, ...entry }`), because the old `rulesOf` deep-merged it, so `{ label: 'Venom' }` keeps Poisoned's ops and description. A key the library already holds is not replaced.
- `rulesOf(ov, statuses)`: overrides deep-merged as before, then `conditions` is `{ ...built-ins, ...statuses }`: a library entry replaces its built-in whole. `src/edge/rules.ts` binds the whole save (`bindSave(() => state)`) and caches on both parts. `rulesref.js` redraws on both.
- forge.js reads and writes `library.statuses`; the `custom: true` mark is gone. The Status library panel lists the GM's own statuses, then every built-in. Edit works on all of them. Delete shows for a status of the GM's own, Reset for a changed built-in (with a confirm), nothing for an unchanged built-in. The empty-state line went: the list is never empty now.
- gm.js Reset rules keeps `gmTables` only, as before; the library is a separate key, so it stays.
- loot.js: the guards for a missing `library` went (the save is repaired before a view sees it).
- Copy: `docs/agent-handoff/copy-tasks.md` has a new section for Reset, its confirm, and the Loot Forge note from step 4.
- Tests: save (the move, the library keeps its own, hostile entries, the cap), rules (the merge, an override, a custom key, rule numbers still merge). `status.test.ts` is unchanged: the lookup did not change.
- Browser: new test in `tests/e2e/combat-turns.e2e.ts` (rename Poisoned to Venom in the panel, see it on Brakk's combat card, Reset, see Poisoned). Rewritten in `tests/e2e/character.e2e.ts`: "GM Reset rules restores the rule numbers but keeps roll tables and the Status library". It used to override Poisoned through the rules editor and expect Reset rules to undo it. Now it overrides `fatigue.penaltyAt` there, renames Poisoned in the dialog, and expects Reset to undo the fatigue rule and keep Venom. The two tests that seed `rulesOverrides.conditions` through the store now exercise the move at load, and pass unchanged.
- Table-visible: a built-in can be edited and reset. Reset rules no longer undoes a change to a built-in status.
- Commit 5: step 5.

## Step 6: parseOverrides

- `parseOverrides(v)` in `src/core/rules.ts` answers `{ overrides, refused }`; a refusal is `{ path, reason }` with `reason` one of `object`, `unknown`, `list`, `number`, `boolean`, `text`, `statuses`. It reads each key against RULES as `validate` did, but keeps the good keys and refuses only the bad ones (`validate` stopped at the first). `conditions` is refused (`statuses`). `rarities` stays an open map (kept as written, as before). `gmTables` is read on its own: each table a list of text (200 lines of 300), `encounter` a list per rank. A key is looked up with `Object.hasOwn`, so `__proto__` is an unknown rule.
- The save repair runs it after the status move: `rulesOverrides` becomes the kept overrides. The rules editor runs it on the typed JSON and shows the first refusal in today's words (`Unknown rule: p`, `p must be a number.` became `p: must be a number.`), Save off. `validate` and `DYNAMIC_MAPS` are gone from gm.js.
- Decided by the helper: a list rule (`jobs`, `gateNames`, `titles`, a path's `tiers`) is checked only to be a list, as `validate` did. A tighter check per list is left for the makers unit.
- Tests: `tests/rules.test.ts` (valid survives, unknown refused, each wrong type refused, `conditions` refused, non-object and `__proto__`, the roll tables' and Build panel's writes pass and `rulesOf` reads them, table bounds); `tests/save.test.ts` (a damaged override is dropped at load).
- Table-visible: a damaged or unknown override in a save is dropped at load, so it never reaches the rules.
- Commit 6: step 6.

## Step 7: parseMonster

- `parseMonster(v)` in `src/core/registry/monsters.ts` answers a `MonsterTemplate` (a monster without its id) or null for a non-object, with `MONSTER_BOUNDS`. Name 60 (blank is "Monster"), type 40, dmg 30 (blank is 1d4), desc 500. HP 1 to 1e9. AC, attack, initiative and each stat -99 to 999, as the fight parser holds a row. XP 0 to 1e9. Abilities: the non-blank text lines, trimmed, 20 of 500 (what a fight row holds). `boss`, `elite` true only when `true`; `extractable` false only when `false`; `auto` kept only when true. Every other key is dropped. A wrong type takes the default, as with items, and no monster is refused for a blank name: the GM's monsters must survive the load.
- `elite` is now a required `boolean` on `Monster` (`newMonster` false; `statBlock` always sets it). It was optional and already kept by both old readers.
- Migrated and deleted: bestiary.js `clean` (and its `S`, `statsBy` helpers) and the save's monster repair lines. The editor turns its fields into numbers first; a blank number field stays blank, so it takes the default as before (AC 10, not 0).
- The save's items and monsters share `refill` (empty the stored object, fill it from the parser, keep or replace the id).
- Changed expectations: save, a monster's unknown key (`lair`) is dropped (moved out of the "unknown keys survive" test into its own); a monster with `elite: 'yes'` now has `elite: false` (was: no key).
- Tests: `tests/monsters.test.ts` (every seed reads back unchanged; hostile input; the bounds; abilities; elite, boss and auto).
- Commit 7: step 7.

## Step 8: lint

- `tests/lint.test.ts`, two rules. "only parseItem builds an item from outside data, and only parseMonster a monster": no function or function-valued const named `clean`, `cleanItem`, `fixItem`, `givenItem`, `stripItem`, `cleanMonster` or `fixMonster` anywhere in `src` (a local `const clean = String(...)` value is not a function and passes). "no view or edge module reads statuses from the rule overrides": no `rulesOverrides...conditions` or `ov().conditions` in `src/edge` or `src/views`. Each checks that it sees the old line it replaces.
- Commit 8: step 8.

## Step 9: checks and AGENTS.md

- `bun run test`: 1476 pass, 0 fail. `bun run deps -- --write` and `bun run charts` left their files unchanged at this point (the map was rewritten in each earlier commit).
- Browser files from the brief's grep (character, combat-turns, customization, room-view, save, table-session): 61 passed, 1 failed on the first run. The failure was real, not a pause: table-session's `customStatusKeys` read `rulesOverrides.conditions`. It now reads `library.statuses`, and table-session passed alone (7 passed). gates-quests-dailies was also run (loot and quest reward items changed): 20 passed.
- AGENTS.md: a "Where things live" row for what a custom status, item, monster or rule override may hold (the four parsers). The Status, Item, Monster and Rule number recipes name `library.statuses`, `atTier`, `parseItem` with `ITEM_BOUNDS`, `itemOps`, `parseMonster` and `parseOverrides`. The rarity and slot lists now live in `registry/items.ts`. The Rules paragraph names the two new lint rules.

## Decided by the helper

- parseItem and parseMonster give a wrong field its default instead of refusing the thing (only a non-object, or an item with no name, is refused), so a damaged save keeps a hunter's item and the GM's monster. A room award item with a bad field now arrives with the default instead of being dropped.
- Items: the bonus keeps the nine gear keys only. Effects and fatigue are kept only when not empty or above 0. Dice are trimmed text, not checked as dice.
- The item enums moved to `registry/items.ts` (save.ts re-exports them) to avoid an import cycle.
- A shadow combatant lost its `abilities` field in the fight type, not only the read in combat.js.
- `effectsOf` left `app.api.effects`. Item cards still show a tiered op as all six numbers.
- Loot Forge: mp, fatigue, check mods and ops at a non-default time are also kept, not only `tiers` and `pct`. Kept ops are saved first.
- Status library: own statuses listed first, then all built-ins. Reset asks for a confirm, as Delete does.
- A list rule in the overrides is checked only to be a list, as before.
- `elite` is a required boolean on a monster.

## Unsure

- An item with a blank name in a save is now dropped. No real path writes one, but an old save could hold one.
- The rules editor's refusal words changed slightly (`p must be a number.` is now `p: must be a number.`). The copy pass can settle the wording.
