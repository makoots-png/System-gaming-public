# Notes: save parser (M2 unit 4a)

- Worktree: ./.claude/worktrees/agent-a100301e080ab1961, branch worktree-agent-a100301e080ab1961
- The worktree was created at main (8b41075), not at bb51420. Tree was clean, so I ran `git reset --hard bb51420` on my own branch to put it on the right base.
- bun install done.
- Second helper: worktree ./.claude/worktrees/agent-a9b6f7946bcf91562, branch worktree-agent-a9b6f7946bcf91562, reset to 2e2d9d5, bun install done. Read store.js. Writing in small committed pieces.
- Commit: save types (src/core/save.ts). Optional (?) fields are the ones views add and remove; no default.
- Commit: default factories (newHunter, newQuest, ...), typed wrappers for rules.js/effects.js inside save.ts (no .d.ts). newHunter takes the save's rules instead of the global rules().
- Commit: tests part 1 (v2 fixtures, fight and room dropped, codex kept). Red until the parser exists.
- Commit: parser helpers (fill, list, fixItem, fixConditions). Repair is in place, same as normalize, so views keep their hunter objects.
- Commit: fixHunter and perkSkill, ported from normalize. Found: hunter.notes is capped at 500 by fill (the 4000 in normalize never applied); kept at 500.
- Commit: repair() for the whole save. Uses rulesOf(save.rulesOverrides) for logCap/rollCap. Hardening beyond normalize: an id ending in a number above 1e15 is replaced and seq is clamped to 1e15 (above that seq+1 is not exact and new ids repeat).
- Commit: parseSave/parseSaveValue/repairSave/freshSave, fromV2, fromV1, starterHunter, dailyQuest. Tests part 1 green (10 pass). parseSaveValue takes ownership of the value (repairs in place). fromV2 copies every key and then resets encounter and settings.sync, so codex/codexSeen and unknown keys survive. A hunters array under any schema other than 3 or above is read as v2 (as parseAny did).
- Commit: tests part 2 (v1, round trip, idempotent repair, invalid reasons, newer). 33 pass.
- Commit: tests part 3 (hostile input: junk lists, __proto__, long text, numbers as text, duplicate ids, caps). 47 pass. Note: an entity with no id takes its default id (i0, q0...) the first time and only a repeat is renumbered; that is normalize's behaviour, kept.
- Commit: tests part 4 (enum fallbacks, gear and title links, locked stats, build path skill, optional and nullable fields, unknown keys, type test). 61 pass.
- Parity check (one-off script, not committed): today's store.js importJSON against repairSave/parseSaveValue on the three v2 fixtures, the v1 fixture and four junk saves. Same output except the injected device id and the log cap (old code read the global rules(), new code reads the save's own rulesOverrides, as the brief asks).

## Fields added beyond the store examples (31), each with one place that writes it

All are optional (`?`) in the types: views add and remove them, so they have no default. The parser removes one whose value is the wrong kind and otherwise leaves it alone.

- Save (2): `codex` views/bestiary.js:145, `codexSeen` views/bestiary.js:146. Both typed `unknown` (the bestiary view owns the shape).
- SyncSettings (7): `gmKey` edge/sync.js:374, `gmKeys` edge/sync.js:16, `lastRoom` edge/sync.js:81 and :270, `boundHunterId` edge/sync.js:289, `deviceToken` edge/sync.js:42, `joinedAt` edge/sync.js:394, `forgetQueue` edge/sync.js:471. No `keyed`, no `gmKeyLoose` (decided).
- Hunter (1): `deathSaves` views/hunter.js:113 (deleted at :114).
- Quest (3): `chainId`, `step`, `chainJob` views/quests.js:165 and :253.
- Skill (1): `perk` edge/store.js:192 (perkSkill).
- Item (2): `effects` views/inventory.js:79 and views/loot.js:206, `fatigue` views/inventory.js:78 and views/loot.js:203.
- Shadow (1): `baseHp` views/shadows.js:24.
- Monster (3): `elite` views/bestiary.js:91, `auto` views/bestiary.js:92, `statusDefs` views/bestiary.js:92 (typed `unknown[]`, only checked to be a list).
- Encounter (1): `shareInit` views/combat.js:838.
- Combatant (10): `initMod` views/combat.js:132, `tie` views/combat.js:199 and :842, `remote` views/combat.js:137, `atk`, `dmg`, `rank`, `abilities` views/combat.js:145, `boss`, `xp`, `extractable` views/bestiary.js:76.

Left `unknown` on purpose: `lootTables`, `shop`, `codex`, `codexSeen`, the contents of `rulesOverrides`, gate roster lines (`GateMonster`), combatant `conditions` (`unknown[]`), reward items except `effects`.

## Mutation checks (break save.ts, see the test fail, restore)

1. `fromV2` keeps the encounter -> "a save in a fight and in a room opens with its hunters, no fight and no room" fails.
2. `parseSaveValue` treats any object as a v1 save -> the three "refused as not-a-save" tests fail.
3. `list()` stops replacing a repeated id -> "entities that repeat an id get new ids", the ten thousand junk entries test and the too-large id test fail.
4. Quest objectives drop unknown keys -> both "fields the types do not know" tests fail.
5. A locked stat is not lowered to the stat -> "a locked stat is never above the stat" fails.
6. `repair` reads the shipped rules instead of the save's `rulesOverrides` -> the log cap test and the "builds switched off" test fail.

All restored; `git status` clean after them and `bun run test` ends `Ran 131 tests across 6 files.` (131 pass, 0 fail; 61 of them in tests/save.test.ts).

## Where the parser differs from today's normalize (on purpose)

- Nullable typed fields are checked: a value of the wrong kind becomes null (`quest.doneAt/dueAt`, `rewards.titleName/job`, `shadow.monster`, `gate.bossId/clearedDay`, `encounter.gateId`, `combatant.refId/group`, `log.hunterId`, `roll.natural`, `sync.room`). normalize kept any value there. I checked the writers with grep: all write a string, a number or null, so real saves do not change. The parity check above found no difference on the fixtures.
- Optional typed fields of the wrong kind are removed (list above). normalize kept them as unknown keys.
- Ids ending in a number above 1e15 are replaced and `seq` is clamped to 1e15.
- `logCap`, `rollCap`, the build paths and a new hunter's HP and MP come from the save's own `rulesOverrides`, never the global `rules()`.
- Default `schema` is 3. A save keeps the schema number it has (a `newer` save stays at its number).
- The repair needs `env` for three things only: a missing device id, an empty `world.lastDailyKey`, a penalty with no `since`.

## For unit 4b (store wiring)

- `repairSave` and `parseSaveValue` work in place and return the same object. `parseSaveValue` takes ownership of the value it is given.
- Also exported for the store: `LIMITS` (now with `libraryItems`), `starterHunter(save, env)`, `dailyQuest(id, R, env)`, `rulesOf`, `newHunter(R)` and the other factories. `store.newHunter` can be `newHunter(rulesOf(save.rulesOverrides))` plus `dailyQuest`.
- `parseSave` never adds a starter hunter to a save with no hunters. `importJSON` does that today and should keep doing it.
- `SLOTS` and `RARITIES` are repeated in save.ts as literal lists for the types. A test pins them to `RULES.slots` and `TIERS`.

## Unsure

- Optional versus required for the room link fields. I made them optional with no default, so `newSyncSettings()` is still `{ room, cursor, serverOk }` and sync.js reads them the way it does today. If the lead wants them required with defaults, sync.js has to be read for each (`sy().gmKeys || {}` style reads would be fine, `'x' in sync` checks would not).
- `fromV2` copies every key and then resets `encounter` and `settings.sync`, instead of copying only the keys the brief lists. Reason: `codex`, `codexSeen` and unknown keys are campaign data and would be lost.
- A hunters array under a schema that is neither 2, 3 nor above 3 (for example a text or 1) is read as v2, as `parseAny` did. The brief's wording ("schema === 2, or no schema and hunters is an array") is a little narrower.
- hunter.notes is cut at 500 by the fill step. normalize has a 4000 cap that never applied because the fill ran first. Kept at 500 to match today; say if 4000 was meant.
