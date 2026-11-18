# W2, the save at schema 4: notes

On `claude/zen-pasteur-ov4cgd` in the main tree, from 7b3a7d3: commits 281f7ec, 5665134, 003f35e, then the protocol test fix and these notes. Not pushed.

## Files outside my list (smallest change each, with the reason)

- `src/core/combat/fight-parse.ts`: `parseSheetStatus(v, R)`, the reader of a `SheetStatus` (a hunter's condition). It shares `keyDefSource` with the fight's own status reader, so a condition is read with the same bounds as a fight row's status. W3 can read the `vitals` message's statuses with it.
- `src/core/hunter/sheet.ts` (1 line): `checkBonus` calls `fatiguePast` from `vitals.ts`, as P2's notes asked.
- `scripts/charts/life.ts` (1 line): `newVitals` takes `{ hpMax, manaMax, fatigueMax }`.
- `src/views/io.js` (1 line): a single hunter's export wrote `schema: 2`; it writes `SCHEMA` now, or Replace on that file would be refused as old.
- `tests/e2e/room-onboarding.e2e.ts` (1 line): it reads the save under `hunter-system-v4`.
- `tests/pack.test.ts` (2 lines): "a newer schema is refused" used the literal 4; it uses `SCHEMA + 1`.
- `tests/protocol.test.ts` (3 lines): `newItem` is gone, so two cases build a blank item with `parseItem`. Without this the whole file failed to load and hid W3's real failures.
- `docs/dependency-map.md` (`bun run deps -- --write`), `docs/agent-handoff/copy-tasks.md` (appended).

## Choices (read first)

1. **No carry-over.** The standing helper prompt says a player's hunters survive a format change through the migration. The owner's design (item 15), the M2 plan brief, `handoff.md` M2 (a) and `for-the-owner.md:56` ("Old saves are dropped, not migrated") say a new campaign. I followed the design and the plan. The lead should confirm, and W9 rewrites AGENTS.md "Saves and roles".
2. **`loadSave` reads the newest key that holds text** (`v4`, then `v3`, `v2`, `v1`), as before. A save of schema 1 to 3 parses as `{ kind: 'old', serverOk }`: a fresh campaign (onboarded), the notice `old`, and the text backed up with reason "before the new combat rules". Only that newest old text is backed up; the old keys are never written or removed. Junk under any key is `unreadable`, as before; a newer save under any key opens read-only.
3. **`serverOk` survives** an old save (the only thing that does), because without it a phone opened from its cache hides the room panel until it reaches the server (the reason `fromV2` kept it).
4. **An old campaign file is refused at import** with "This save is from before the new combat rules, and this app cannot open it." The Data panel's "Add hunters to party" (io.js, nobody's unit) still pushes a file's raw hunters into the save, where the repair fills the new fields; so an old hunter can still be added by hand that way. Not changed (io.js is outside the wave's owner map); the lead may want W9 to refuse it.
5. **Fatigue capacity.** `Maxima = { hpMax, manaMax, fatigueMax }` (a `Sheet` satisfies it). `fatiguePast(fatigue, m, pct)` is the one test of a share: collapse at `collapseAt`% of `fatigueMax`, and W4's `fatigueDis` is `fatiguePast(h.fatigue, sheet, R.fatigue.disAt)`. A rest takes `R.rest[kind].fatigue` percent of the capacity off (25% short, 100% long). `fitMaxima` also brings fatigue down to a lower capacity. `setFatigue` and `changeFatigue` take the maxima: `(v, n, m, R)`.
6. **Old names kept for the build:** `mpOf`, `changeMp`, `setMp` are aliases of `manaOf`, `changeMana`, `setMana` in `vitals.ts`, because `hunter.js` and `combat.js` import them and a missing export stops `bun run build`. W4/W5 move the callers; W8 deletes the aliases. Likewise `newMonster` stays (bestiary.js imports it), now `{ ...parseMonster({}), id: 'm0' }`.
7. **The repair never cuts by a derived maximum.** HP, mana, fatigue and a shadow's HP are bounded for junk only (0 to 1e9), because a GM's rule change must not prune saved data (lead-report, f09a7b8). A life that does not read is up at the full HP of the hunter's own sheet (`hunterSheet` after the rest of the hunter is repaired). Stats are whole numbers 0 to 1e6, a missing one `statBase`.
8. **Title bonus** is `Perk` (the eight stats, `hpMax`, `manaMax`), a subset of derive's `Bonus`; the repair drops any other key.
9. **Conditions** are read by `parseSheetStatus` under the save's rules, chips dropped, at most `MAX_STATUSES` (30), the fight row's cap.
10. **Sung Jin-Woo** takes Sprint and Bloodlust from `SKILL_SEEDS` and the Venom Fang and Health Potion from `LOOT_ITEMS`/`SHOP_ITEMS` (`skillOf`, `itemOf`), with base stats and the 12 creation points unspent.
11. **Deleted, not moved:** the `titleName` fallback of a quest reward and `lootTables` deletion (old-app fields); an unknown key is now kept like any other. Not deleted (other owners): `parseJobChain`'s old `step`/`chainJob` fallback, `parsePenalty`'s old penalty, `fixSync`'s `gone: true`.

## What I made

- `vitals.ts`: `Vitals.mana`; `Maxima.manaMax`, `fatigueMax`; `manaOf`, `changeMana`, `setMana`; `fatiguePast`; `setFatigue`, `changeFatigue`, `rest`, `fitMaxima`, `refill` on the capacity; the three aliases (choice 6).
- `progress.ts`: `levelPoints` is `pointsAt` of derive.ts, so level 1 holds `RULES.fight.creationPoints` (12).
- `save.ts`: `SCHEMA = 4`; `Hunter` with `manaAdj`, eight-key `Stats`, `conditions: SheetStatus[]`, `Title.bonus: Perk`; `Shadow = { id, name, monster, rank, archetype, grade, hp, summoned, notes }`; `Save.fight: Fight | null` read by `parseFight`; `CodexInfo = { hpMax, armor, resist, speed, abilities }`; `Parsed` gains `old`, loses `migratedFrom`; `Stored` gains `v4`; `Loaded.notice` gains `old`; `newHunter(R)` takes HP and mana from `hunterSheet`; `newStats(R)` is `baseStats(R.fight)`.
- `store.ts`: key `hunter-system-v4`, the `old` banner and import error.
- Deleted: `fromV1`, `v1Defaults`, `fromV2`, `moveStatuses`, `fromOldHp`, `fromPointsCounter`, the old `fixVitals` body (hp, deathSaves, Exhausted chip), `fixConditions`, `perkSkill`, `questRewards`, `newSkill`, `newItem`, the six-stat `newStats`, `Bonus`, `EffectOp`, the old `StatusDef` export, the encounter import. Lines in `src tests scripts` since 7b3a7d3: 678 added, 960 removed (save.ts 127 added, 251 removed).
- Tests: `save.test.ts` 93 (old fixtures are "old"; every storage key; a new hunter; a campaign with a running fight, statuses, a shadow and a room link round trips; the repair cases on the new fields; `Hunter`, `Shadow`, `Monster` satisfy `SheetHunter`, `RowHunter`, `RowShadow`, `RowMonster`). `vitals.test.ts` 66 (a capacity of 120: collapse at 120, penalty at 60, disadvantage at 96, a short rest 30 off). `progress.test.ts` 32 (the per-level cases pin 0 creation points; four cases at 12). `save.e2e.ts` 7: the first test rewritten (old saves under v1, v2, v3 open a new campaign with the banner and their text in Backups, and an old file is refused at import), the export/import test rewritten on a schema 4 campaign, the wrong-shape case at v4, the fight-and-room case deleted, the others with the key renamed.

## Which principle changed a choice

- boundary-discipline: conditions are read by the fight's own reader (`parseSheetStatus`), not a second one in save.ts; the repair trusts nothing derived and bounds for junk only.
- subtract-before-you-add: the migration code (`fromV1`, `fromV2` and its helpers, about 150 lines) went in the same commit that stopped reading old saves; `perkSkill` went with it. I kept nothing "for safety" beyond the aliases the build needs.
- test-behavior-not-implementation: expected numbers come from the rules by name (`hpBase`, `manaBase`, `fatigueBase`, `creationPoints`, `statBase`, the fatigue shares worked by hand for a capacity of 120). Two hand mutations checked: dropping the `serverOk` line fails 3 tests, dropping the chip filter fails 1.

## The checks

- Own files: `bunx tsc --noEmit --pretty false 2>&1 | grep -E '^(src/core/save\.ts|src/core/hunter/(vitals|progress|sheet)\.ts|src/edge/store\.ts|src/core/combat/fight-parse\.ts|tests/(save|vitals|progress|pack)\.test\.ts|tests/e2e/(save|room-onboarding)\.e2e\.ts)\('`: no output, grep exit 1.
- `bun test tests/save.test.ts`: `Ran 93 tests across 1 file. [127.00ms]`, 0 fail. `tests/vitals.test.ts tests/progress.test.ts tests/sheet.test.ts tests/rows.test.ts`: `Ran 134 tests across 4 files. [141.00ms]`, 0 fail. `deps`, `statecharts`, `lint`: `Ran 50 tests across 3 files. [5.70s]`, 0 fail.
- `save.e2e.ts`: `7 passed (23.9s)`. `room-onboarding.e2e.ts`: `6 passed (35.6s)`.
- `bun run deps -- --write`: `wrote docs/dependency-map.md`. `bun run build`: `Built 12 files into dist/ (build 01d5619d6893)`.

## Red after this unit

`bunx tsc --noEmit --pretty false 2>&1 | cut -d'(' -f1 | sort | uniq -c` (file lines):

```
      1 tests/encounter.test.ts
      8 tests/status-sim.test.ts
```

Both W8's. `protocol.ts` and `api.ts` compile (the plan expected them red here; W3 still owns their rewrite).

`bunx tsc -p tsconfig.views.json --noEmit` (file lines): `bestiary.js` 25, `combat.js` 28, `custom.js` 1, `effects.js` 1, `gates.js` 4, `hunter.js` 18, `inventory.js` 7, `loot.js` 3, `reward-editor.js` 2, `shadows.js` 16, `skills.js` 48, `workshop.js` 7 (W4 to W7).

`bun test 2>&1 | grep -E '^\(fail\)' | wc -l`: 21. By file: `protocol.test.ts` 6 (award items with old fields and bonus keys, W3), `encounter.test.ts` 7 and `status.test.ts` 5 (old modules, W8), `applied.test.ts` 3 (W3, as before). `status-sim.test.ts` does not load (an unhandled error, its 8 tsc errors; W8). `save.test.ts` is green.

## For the next units

- **W3:** `parseSheetStatus(v, R)` in `fight-parse.ts` reads the `vitals` message's statuses. A pushed sheet (`parseSheetHunter`) is a schema 4 hunter now; the build path is kept as sent and no perk skill exists. `CodexInfo` is `{ hpMax, armor, resist, speed, abilities }` (the codex doc must send that). `api.ts`'s `Derived` still names `mp`/`mpMax`/`ac` (W4).
- **W4:** the sheet reads `h.mana`, `h.manaAdj` (was `mpAdj`) and the maxima from `hunterSheet(h, R).sheet` (which satisfies `Maxima`). `setFatigue`/`changeFatigue` take `(v, n, m, R)`. `fatigueDis` is `fatiguePast(h.fatigue, sheet, R.fatigue.disAt)`. A shadow has `archetype` and no `hpMax`/`ac`/`atk`/`dmg`/`level`/`baseHp`; its max HP is `monsterSheet(rank, archetype, SHADOW_KINDS[grade], R).hpMax` (P5's note). `hunter.js`'s raw editor lists `mpAdj`: rename it `manaAdj`.
- **W5:** the save's fight is `save.fight` (`Fight | null`); `save.encounter` is gone, so the old `combat.js` writes an unknown key the repair keeps. `tests/e2e/combat-turns.e2e.ts:205` seeds `hunter-system-v2`, which now opens a new campaign. `newMonster` can go when bestiary.js stops importing it.
- **W8:** delete `mpOf`, `changeMp`, `setMp` from `vitals.ts`, and `newMonster` if W5/W7 have not.
- **W9:** AGENTS.md "Saves and roles" at schema 4 with no carry-over; `scripts/shots.ts` seeds `hunter-system-v2` (now a new campaign); io.js "Add hunters to party" (choice 4).
