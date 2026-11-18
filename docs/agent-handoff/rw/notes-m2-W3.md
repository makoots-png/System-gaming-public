# W3, the room: notes

On `claude/zen-pasteur-ov4cgd` in the main tree, from 92e98a7: commits 4d0990e (code), aec3b1c (tests), cc381b6 (room model), f4b0308 (pill test), a01ce09 (copy tasks), 1427a77 (fight-doc narrowing), then these notes. Not pushed.

## Files outside my list (smallest change each, with the reason)

- `server.ts` (2 lines): the doc cap is `DOC_MAX`, imported from `protocol.ts`, so the server and the app share one number (the lead's instruction). The server's own copy is gone, and so is sync.ts's.
- `src/core/sync/connection.ts`, `src/edge/room-pill.ts`, `src/views/room.js` (`STATE` only): the new connection `tooBig`, for design 5.4's "the pill shows too big to share". The signature is `connection(link, push, tooBig = false)`.
- `src/core/combat/effect-ops.ts`: `addSheetStatus(list, incoming)`, the one-per-key rule for a sheet's statuses (the higher tier's source and def win, the longer rounds stay, null is longest), as `applyStatus` is for a body. The applied tests needed a core home for "a weaker Burning does not replace a stronger one". hunter.js's `addC` still uses the old `status.ts` rule. W4 should switch it to `addSheetStatus`.
- `src/core/combat/fight-doc.ts` (1 line): `o.was.ended === false` in place of `!o.was.ended`. The views typecheck (no strict nulls) could not narrow the union through `!` once `protocol.ts` imported the doc.
- `src/views/hunter.js`: `app.api.hunter.changeMp` is now `changeMana`, and `setVitals` is new (the `vitals` applier calls it). `tests/deps.test.ts` needs every declared member to be registered. Both are built on the old `maxima`, which still has no `fatigueMax`. W4 gives it one.
- `src/views/effects.js` (1 line): calls `changeMana`.
- `src/views/combat.js`: registers `adjust` in place of `applyDamage` and `applyUse`, on the old fight's `setHp` and `setMp`. W5 replaces it with the `adjust` command. The doc is published and read as `fight`.
- `src/views/table.js`: Apply calls `adjust(id, { hp: -total })`. The `used` feed row has no outcomes line and no "Apply to…" button, because the message no longer carries outcomes. The doc is read as `fight`. The `outcomeText` import is gone.
- `src/views/uses.js` (3 lines): sends no outcomes. `usedLine` gets an empty list (W6 writes the line from the name and text alone).

## Choices (read first)

1. **The doc is named `fight`** (was `encounter`), served as `_fight`. An `_encounter` put is now refused as an unknown doc (`server-rooms.test.ts`). custom.js:173 still asks for `doc('encounter')` and gets null (W4/W6).
2. **The cap is `DOC_MAX = 30300`** in `protocol.ts`. Its comment works it out from the measured worst case: a monster row with a 60-character name and intent, the six longest built-in statuses, a shield, stagger and a speed with decimals is 700 characters. 32 such rows are 22,400 and the rest of the doc is 1,824, so the doc is 24,224. Spare means a fifth of the cap, so 24,224 × 5/4 = 30,280, rounded up to 30,300. `protocol.test.ts` builds that doc, reads it back whole, and checks that it is at most four fifths of the cap. `server-rooms.test.ts` stores a doc of exactly `DOC_MAX` characters and refuses one a character longer with 413. `MAX_BODY` (64 KiB) is still above it.
3. **The retry.** `putDoc` answers `'stored' | 'tooBig' | 'failed'`. "Too big" means the doc is longer than `DOC_MAX` by the phone's own count, or the server answered 413. `publishNow` then puts the doc once more with `log: []` and logs that with `console.info`. It is not `console.warn`, because the browser tests' `device()` fails a test on a warning. If that put is too big too, `tooBig` (a Map of doc to link gen, named in sync.ts's header) records it and the pill reads `tooBig`. The next put that is stored clears it.
4. **`step` carries `place`, not `to`.** The plan wrote `{ by, to, at }`, but `to` already means "whom a message is for" in every other payload, and the appliers' `targets()` reads it by that name.
5. **`onTurn(f, { by, at })` in `protocol.ts`** is the rule that makes `step` and `cast` idempotent. It answers the row of the sender's remote hunter when the fight is running, that row has the turn, and `at` is the fight's `now`. Otherwise it answers null. W5's `combat.js` calls it from `sync:event` before it sends `move` or `act`. One `currentId` at one `now` is one turn, because time moves on after every use.
6. **A tile is refused, never clamped**, when x or y is outside 0 to 63 or is not a whole number, the same way an id is: a clamped tile is a different tile. Totals and `at` are clamped, as the protocol's numbers always were.
7. **`vitals`** is `{ to: [one key], hp, mana, fatigue, statuses, reason }`. Every total is required and is a whole number from 0 to 1e9. The statuses are read by `parseSheetStatus` with the shipped `RULES` and capped at `MAX_STATUSES` (30), the fight row's own cap, not the plan's 12, so a total never drops a status the fight holds. A chip is dropped. The applier calls `setVitals` and toasts only a fall.
8. **`status`** now carries `SheetStatus` (key, new def, source `{ id, tier }`, rounds with decimals or null), read by `parseSheetStatus`. The toast describes the status the hunter holds after the add, from its own def.
9. **CombatApi** is `{ adjust, targets, setExtractTried, add, isActive, startFlow, awardParty, okToReplace, removeRemote, useItem }`. `setExtractTried` stays: shadows.js (W4) calls it, and the deps test fails on a used member that is not registered.
10. **AppEvents**: `combat:defeated` is `{ body: Body }` and `combat:end` is `{ fight: Ended; gateId: string | null }`. The fight holds no gate id, so W5 passes the one its start flow kept.
11. **The codex entry** is `{ key, name, rank, hpMax, armor, resist, speed, abilities, kills, firstAt }`. Each number is a whole number from 0 to 1e9 and defaults to 0.
12. **`used` lost `outcomes`.** `UseReport` lost it too, and `outcomes` sent by an old phone is dropped by the reader.

## What I made

- `protocol.ts`: `VitalsPayload`, `StepPayload`, `CastPayload` and their `DEFS` entries. `HpPayload.mana`. `StatusPayload` on `SheetStatus`. `UsedPayload` without outcomes. `onTurn`. `DOC_MAX`. The `fight` doc reader on `FightDoc` (P4's bounds `DOC_ROWS`, `DOC_STATUSES`, `DOC_AHEAD`, `DOC_LOG`, and the fight's `NAME_MAX` and `LOG_LINE_MAX`). `BANDS` and `Band` are re-exported from fight-doc.ts, so there is one home. Gone: `EncounterDoc`, `EncounterRow`, `RowStatus`, `StatusGrant`, and the imports of `encounter-types.ts`, `use.ts` and `status.ts`.
- `room-events.ts`: appliers `vitals` (once), `step` and `cast` (null). `hp` on mana. `status` on the new def.
- `api.ts`: `CombatApi.adjust`. `HunterApi.changeMana`, `setVitals`, and `addCondition(hid, SheetStatus)`. `RoomHunter`. `UseReport`.
- `events.ts`: the two combat events on fight types.
- `sync.ts`: `DOC_MAX` from protocol, `putDoc`'s three answers, the retry, `tooBig`, `fight` in `SAME`, and the fast poll on `docs.fight`.
- `tests/models/room-world.ts`: a `gm vitals pN` move, and a `pN cast` move whose `at` is the GM fight's `now`. The GM's phone takes a cast through the real `onTurn` and moves its fight's `now` on, both kept in the save. The mock hunter API is on `changeMana` and `setVitals`.
- Lines in `src tests scripts server.ts` since 92e98a7: about 700 added and 320 removed (most of the additions are tests).

## Tests

- `protocol.test.ts` 165: VALID for the 13 types. A case per bound of `vitals` (totals, required fields, one hunter, 30 statuses, chips), `step` (tile edges 0 and 63, then 64, -1, 2.5 and a string refused; `at` clamped and required), `cast` (ability 1 to 40, aim an id up to 80 or a tile, 8 dice clamped 0 to 999) and `status` (key up to 80, rounds with decimals, source tier 0 to 5, the shipped dice limit). `onTurn` on the turn, stale, another row's turn, another player, a local hunter, setup and no fight. The fight doc's round trip, ended doc, monster HP hidden, HP capped, every bound, bad rows dropped, intent and stagger, refusals, and the worst-case size against `DOC_MAX`. Award items on the new item shape (fixes W2's 6 failures).
- `server-rooms.test.ts` 73: `vitals` is GM-only (refused from a player's own phone, taken from the GM). `step` and `cast` go from the hunter's phone and are refused in another player's name. The doc at `DOC_MAX` and one character over. `_fight`, and `_encounter` refused.
- `applied.test.ts` 17: the status cases on `addSheetStatus` (weaker, stronger and longer, until removed, the toast "Burning: 3d8 magical damage a round · 3 rounds" at tier 2, from statuses.ts's tier table, applied once). `vitals` applied once with its statuses. A mana toast. Another player's step or cast does nothing.
- `room-system-model.test.ts` 10: a new safety rule, "the GM's fight took two players' casts in one turn". Named runs: a cast posted twice (`dup gm`) with a GM reload in between, two taps before the GM hears the first, and `vitals` through a lost poll and a player reload. `vitals` is in `EVENT_KINDS`, so every walk checks it converges once. Hand mutations: with `onTurn` bypassed, both cast runs fail. With `vitals` set to `once: false`, the applied test fails.
- `push.test.ts` 20: `tooBig` reads as too big while the room polls fine, after `notSent`, and never over `reconnecting`.

## Which principle changed a choice

- make-operations-idempotent: `cast` and `step` are idempotent through `onTurn` (turn and `at`), not through an applied ring on the GM's phone, and the model replays one. `vitals` sends totals.
- boundary-discipline: statuses in `status` and `vitals` are read by the fight's own `parseSheetStatus`, not a second reader in protocol.ts. The doc cap has one home, which server and app import.
- test-behavior-not-implementation: the cap test builds the worst case from the field bounds and the built-in labels, not from a run of `fightDoc`. The toast's 3d8 is statuses.ts's tier-2 entry.
- subtract-before-you-add: `used` lost its outcomes, and the feed's Apply-to and `applyUse` went in the same commit. So did the encounter doc and its reader.

## The checks

- Own files: `bunx tsc --noEmit --pretty false 2>&1 | grep -E '^(src/core/(protocol|api|events)\.ts|src/edge/(room-events|sync)\.ts|src/views/app\.ts|tests/(protocol|server-rooms|applied|room-system-model|push|sync-model)\.test\.ts|tests/models/room-world\.ts)\('`: no output.
- `bun test tests/protocol.test.ts tests/server-rooms.test.ts tests/applied.test.ts tests/room-system-model.test.ts tests/push.test.ts tests/sync-model.test.ts`: `Ran 289 tests across 6 files.`, 0 fail.
- `bun test tests/deps.test.ts tests/statecharts.test.ts tests/lint.test.ts tests/server-handshake.test.ts tests/fight-doc.test.ts tests/link.test.ts`: `Ran 110 tests across 6 files. [5.21s]`, 0 fail.
- `bun run deps -- --write`: `wrote docs/dependency-map.md`. `bun run build`: `Built 12 files into dist/ (build 490c7bbb3c3a)`.
- Browser, port 3241: `room-sync.e2e.ts` `1 passed (32.1s)`. `room-sync-fixes.e2e.ts` `14 passed (2.7m)`. `room-onboarding.e2e.ts` `6 passed (34.3s)`. `room-view.e2e.ts` `2 failed, 7 passed (1.2m)`, the same on two runs, and **the same two fail at 92e98a7, before W3** (checked in a scratch worktree, since removed): lines 140 ("several hunters picks who to play as") and 247 ("room strip"). Both fail on the console warning `The specified value "undefined" cannot be parsed`, from a number input on the hunter's sheet that draws an old field (hunter.js, W4).

## Red after this unit

`bunx tsc --noEmit --pretty false 2>&1 | cut -d'(' -f1 | sort | uniq -c` (file lines; the indented lines are continuation lines of those errors):

```
      1 tests/encounter.test.ts
      8 tests/status-sim.test.ts
```

Both are W8's. No error in `src`.

`bun test 2>&1 | grep -E '^\(fail\)' | wc -l`: 12. That is `encounter.test.ts` 7 and `status.test.ts` 5, and `status-sim.test.ts` does not load (an unhandled error from its tsc errors). All three are W8's old modules. `Ran 2325 tests across 59 files. [85.46s]`, 2308 pass, 13 fail. W2's red in `protocol.test.ts` (6) and `applied.test.ts` (3) is green now.

`bunx tsc -p tsconfig.views.json --noEmit` (file lines): `bestiary.js` 31, `combat.js` 30, `custom.js` 6, `effects.js` 2, `gates.js` 5, `hunter.js` 22, `inventory.js` 9, `loot.js` 3, `reward-editor.js` 2, `shadows.js` 16, `skills.js` 49, `table.js` 7, `workshop.js` 7 (W4 to W7). table.js is new on this list: it reads the doc's old `round` and `list` (W6). The others grew by the types W3 changed (the fight doc, `UseReport`, `addCondition`, the combat events).

Browser: the two `room-view.e2e.ts` tests above (W4's sheet; red before W3).

## For the next units

- **W4:** hunter.js's `addC` should call `addSheetStatus` (effect-ops.ts). `maxima` needs `manaMax` and `fatigueMax` for `changeMana` and `setVitals`. custom.js:173 reads `doc('encounter')`: it should be `doc('fight')` with `rows`, keyed on `now` and `currentId`. shadows.js still calls `combat.setExtractTried`. The two room-view.e2e.ts failures above are the sheet's.
- **W5:** register `adjust` on the fight's `adjust` command (delete my shim). Publish `fightDoc(...)` under `'fight'`. On `sync:event`, `step` and `cast` go through `onTurn(fight, payload)` and then `move` or `act` (with the player's dice). `sendRemote` is a `vitals` message to `[key]`, and the local `vitals` effect is `app.api.hunter.setVitals`. Emit `combat:defeated { body }` and `combat:end { fight, gateId }`. makers.e2e.ts:464 (W7's) calls `combat.applyDamage`: use `adjust(id, { hp: -9999 })`.
- **W6:** table.js reads `doc('fight')` (`rows`, `now`, `currentId`, `ahead`). It sends `step { by, place, at }` and `cast { by, ability, aim, at, dice }`, with `at` the doc's `now`. uses.js writes its line without `usedLine`.
