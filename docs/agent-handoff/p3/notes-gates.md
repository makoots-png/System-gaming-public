# Notes: gate lifecycle and payout (M4)

Brief: `brief-gates.md`. Start commit b8d87f1, branch `claude/zen-pasteur-ov4cgd`.

## Step 1: the three suspected bugs, reproduced

Three browser tests in `tests/e2e/gates-quests-dailies.e2e.ts`, run against the code at b8d87f1 (one run each, all three failed on the first run and on a second run, for the reason the test names):

- Bug 1 is real. Clear with every hunter unticked, then end the running fight: the End window says "[gate cleared: XP already paid]" and has no Award button. Recorded as bug 5 in `bugs-found.md`.
- Bug 2 is real. Edit form: cleared on day 1, back to detected, two days pass, cleared again: the card says "Cleared on day 1", expected day 3. Recorded as bug 6.
- Bug 3 is real. Edit form sets cleared during a fight: the End window says "already paid" and has no Award button. Recorded as bug 7.

All three committed as `test.fixme`.

## Step 2: src/core/gates/gate.ts and tests/gate.test.ts

- Committed. 83 bun tests: one per status and event pair, `can` per status, the XP rules with hand-worked numbers (3 goblins at 25 plus a 75 XP boss = 150), `parseGate` with hostile input, and the walk of every event sequence up to length 4 from each status (154,705 gates).
- Choices: `fightStarted` in raiding or broken is accepted and keeps the status (the Start encounter button shows on every active gate, so `can` must say yes). A `paid` with a negative or non-finite amount adds nothing. A cleared gate without a stored day takes `createdDay`. `parseGate` drops keys a gate does not have (like `parseEncounter`), and answers null for a gate without a string id.
- `newGate()` (the default) moved to gate.ts with `GATE_TYPES` and `GATE_STATUSES`, because gate.ts cannot import save.ts (save.ts imports it).
- Principle that changed a choice: type-system-discipline (the `Gate` union and the mapped `Row` type: a status or event missing from the table fails the typecheck; `GateId` and `MonsterId` are branded and made only in `parseGate`).

## Step 3: save.ts

- Committed. `save.gates` goes through `parseGate` (new `gates()` in save.ts). `list()` now calls a shared `claimId`, so a gate's missing or repeated id is fixed the same way as every other entity's (a gate without a string id takes `g0`, like a hunter item takes `i0`).
- Behaviour changes in the repair: a non-cleared gate loses `clearedDay: null`; unknown keys on a gate are dropped (no view stashes any on a gate; grep found none). `tests/save.test.ts`: the fixture checks compare gates exactly (`currentGates`), the "unknown keys" test no longer includes a gate, and a new `gates` block checks the parser call, dropped keys and ids.
- The repair now replaces gate objects (it still keeps hunter objects). Only gates.js and combat.js read gates, and both look a gate up by id each time.

## Step 4: gates.js and combat.js

- Committed. gates.js: one `step(d, id, event)` helper replaces the gate in the draft with `transition`'s answer and says whether it changed (the log lines are written only then). Spawn builds from `newGate()`. The edit form writes name, rank, type, break day, roster, boss and notes as before, then sends `gmSet`. `OPEN_STATUS` became `active = g => can(g, 'clear')` (the list split and the world doc order); the card's buttons ask `can` per event.
- `mergeWorld` (a second GM phone's world doc) also wrote `status` with `Object.assign`. It now copies the plain fields and sends `gmSet` for the status; a gate it has not seen goes through `parseGate`. Reason: the lint rule in step 5 would flag it, and the other GM's status is a GM choice.
- combat.js `endEncounter`: `award = fightAward(gate, total, xpOf)`; `covered` is `award < total`; the gate gets a `paid { xp: award }` event. The line shown when the gate paid already reads "[gate XP already paid]" (was "[gate cleared: XP already paid]"), because it now also shows when an earlier fight paid the whole gate. That is the one visible copy change.
- Behaviour change that follows from the brief's rule, not one of the three bugs: a second fight in a gate whose first fight already paid all of the gate's XP pays nothing. Before, it paid again until the gate was cleared.
- Pin: the six gate XP tests in gates-quests-dailies passed before step 4 (after step 3) and after it.
- Not mine: "a Lv 10 hunter works the Job Change chain" fails at 2.0 min with "Target page, context or browser has been closed" on line 332. It fails the same way on an exported copy of b8d87f1 (run twice on my tree, once on the copy), so it predates this unit.

## Step 5: lint rule

- Committed. `tests/lint.test.ts`: `clearedDay` and `xpPaid` may not be assigned or written as an object key anywhere in `src` but gate.ts. `.status` may not be assigned, and no object key `status:` may hold a gate status literal, in the view and edge files that read `.gates` (quests also have a `status`, so the check is scoped). Named in AGENTS.md under the lint rules.
- Checked against the b8d87f1 versions of gates.js and combat.js: it flags every hand-written write there (spawn, break, enter, fight start, clear, close, edit form, endEncounter). It does not catch the old `Object.assign(x, g)` in `mergeWorld`; a pattern for that would have flagged unrelated `Object.assign` calls.

## Step 6: the three bug tests pass

- Committed. The three tests are plain `test`s again; bugs 5, 6 and 7 in `bugs-found.md` say fixed.
- Runs (one each, no pause seen): gates-quests-dailies 14 passed, 1 skipped (the ability-point fixme), 1 failed (the Job Change chain test that also fails on b8d87f1, see step 4 and notes-combat-wiring.md). combat-turns 7 passed. table-session 4 passed. save 8 passed. `bun run test`: 423 pass, 0 fail.

## Step 7: AGENTS.md

- Committed. A "Where things live" row for the gate's life and payout, a recipe "To add a gate status or event", and a short recipe for a gate field (it now lives in gate.ts, not save.ts). The lint rule was named in step 5.

## Done

All seven steps committed. `bun run test` last line: "Ran 423 tests across 12 files." with 0 fail. Left out: the Job Change chain browser test still fails as it did before this unit; I did not look into it.
