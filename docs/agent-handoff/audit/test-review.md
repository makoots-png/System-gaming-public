# A review of how this repository tests

the owner's goal: tests that catch what a player would meet, that say at a glance where a fault is and how to fix it, and that cost
little in a session and in a push. This file reads and measures; it changes no test and no code.

Measured here (branch test-review at 333eeb5, box of 4 cores shared with two helpers, each run under `flock /tmp/box.lock`):
one `bun test` with the junit reporter (n = 1), one `bun test --parallel=4` (n = 1), and the six job logs of public run 21
(477229429f, every browser test). No browser test was run here.

## 1. What each kind of test costs and catches

Cost, unit pass: 4,240 tests in 110 files, 364 s inside bun (6 m 50 s wall). Four files are 87% of it:

| File | Seconds | Note |
|---|---:|---|
| tests/fight-sim.test.ts | 123.2 | all of it at module load: line 332 runs every `measure()` before any test; its 113 cases report 0.2 s |
| tests/fight-model.test.ts | 105.7 | one case, 2,500 seeded fights, budget 300 s |
| tests/room-system-model.test.ts | 69.1 | the exhaustive walk 65.0 s, the random walks 3.7 s, budget 180 s |
| tests/statecharts.test.ts | 22.5 | 81 cases |
| tests/sync-model.test.ts | 17.8 | one case |
| the other 105 files | 25.6 | |

Cost, browser pass (public run 21): 406 tests in 38 files, 3,381 s of test time (56 min serial), six shards of 5.0 to 6.3 min
wall. Slowest files: battle-map 370 s (24 tests), makers 242 s (46), table-turn 211 s (12), gates-quests-dailies 192 s (27),
room-sync-fixes 187 s (17). A test with two phones takes 11 to 24 s; a one-phone look takes 2 to 5 s.

What found real bugs (decisions.tsv):
- Browser tests, through a refused push: the tab tap undone by a poll (row 326), the map unframed on Combat (346), End turn under
  the bar at 360 px (348), chapter windows nobody could tell apart (378). Each was first read as a flaky test.
- Model tests, when built: a removal lost across a GM reload (116), an event that changes nothing (144), three fight bugs (224),
  a trade take back that could never end (376). The trail records no model failure after a model's first week.
- The charts: the fight model never removed the last combatant (111).
- A read by another model: the neon audit, 154 findings on the live commit a11b6a5d, 20 checked, all 20 real in the code.
  Every one of them had passed every test above.

## 2. The slowest unit tests

The brief names three; the measurement names four, and the largest (fight-sim, 123 s) runs where no per-test timing or timeout
sees it. Seeds are fixed in all of them, so on a push they catch only a regression one of their fixed seeds reaches.

- A pass of their own (bun `--parallel=4`, measured once): 364 s became 154 s inside bun, all 4,237 passing. The limit is now
  fight-sim's load in one worker (123 s). Stops catching nothing. Risk: four workers on a box where one helper times frames, and
  the budgets (180 s, 300 s) were set for a serial run.
- A smaller walk every push with the full one on a schedule: stops catching any regression reached only by seeds past the small
  walk, and nothing records which seeds found the three fight bugs of row 224. Not needed once the pass is parallel.
- Seeds that change by commit: each push explores new fights, but a failure then lands on an unrelated push (a notes push was
  already refused by a model's timeout, row 387), against the rule that a failure says where it happened.

## 3. The browser tests' construction

- Fixed waits: 13 `waitForTimeout` calls, four in helpers that every file runs: `go` 300 ms (453 call sites), `tapIfShown` 300 ms
  per tap, `onboardGM` 500 ms plus three taps (183 call sites), `onboardPlayer` 500 ms plus two (96). From the call sites alone
  that is at least 8 min of the 56 min serial. `room-sync.e2e.ts` waits 1,500 ms then 8,000 ms for a reload to settle, while its
  second test in the same file proves the same thing with a sentinel (the GM's damage lands, so every earlier message was read).
- Look then act: `dismissAll` (140 call sites) taps whatever window is up now and stops when none is. That is the cause of the Job
  Change flake (row 101); the guide already says to wait for a window by its title (`answerWindow`).
- Setup through the UI: 279 onboardings through the first-run windows, where the subject of most tests is something else; 24
  tests seed a save. The starter campaign is one core step (`starterCampaign`), so a seed could give the same state.
- Repeats: `look.e2e.ts` copies a 44 px and sideways audit six times (lines 404, 630, 653, 678, 729, 792); `phone.e2e.ts` runs the
  same audit (`check`) on every view and every maker at 360 and 390, and does not export it.
- Markup where a player's view would do: `room-sync.e2e.ts:36` passes on any window or toast (`.sys-overlay.show, #toasts .toast`),
  where the contract is REWARD RECEIVED with its numbers; `look.e2e.ts:241` asserts a class name (`primary`) for "the one filled
  button". Outcomes are mostly read from `hunterApp.store`, which the guide allows for reading.

## 4. What is not tested that a player would notice (audit lines 1 to 60, by class)

- A second time: the same GM action twice (BUG-gates-1, a gate paid twice; BUG-views-1, a panel that does not open on the third tap).
- Two paths that must agree: act and release (BUG-rules-3, AW-rules-2), the GM's arm and a player's (BUG-views-2), the item's op
  list and the parser's (BUG-gates-4), Revive on the board and on the fight card (BUG-views-3).
- A refused write: a read-only tab (BUG-views-5, -6, -7). Closed since by a lint and `refused-writes.e2e.ts` (row 392).
- A file round trip: export and import (BUG-sync-3), a pack of a kit with every nested key (BUG-gates-5).
- The real database under two writers: `PUT /sheets` and `_kicked` races (BUG-sync-6). CI runs the memory store only; Postgres
  was run once by hand (rows 185, 188).
- Text that is not English: bytes against characters (four findings).

## 5. The copy of sync.ts in tests/models/room-world.ts

What holds it: the real reducers (link, push, outbox, seen, applied), the real appliers (`applyRoomEvent`) and the real server
handler; the edge glue between them is copied by hand and names the function it copies in a comment. sync.ts keeps 86 functions
inside `register(app)`, none exported; the model cites 16 of them by name. No test or lint compares the two, so a change to a
function of sync.ts leaves the model passing on the old behaviour. To drive the real functions, sync.ts would hand its fetch,
clock, timers and store in as arguments (a runner the browser and the model both build); that is a refactor of a 954-line file.

## 6. Tests that failed with no fault in the app

| Row | Test | What the test did |
|---|---|---|
| 101 | the Job Change chain | looked for a window before the app opened it (`dismissAll`) |
| 329 | map-extras:286 | measured a slot one frame before its setup drew it |
| 329 | reward-room:130, rewards:25 | ran across midnight UTC (now `noonZone`) |
| 346, 349 | table-turn:92, maps:140 and :168 | acted on the fight start's doc, not the setup's (now `setupDoc`) |
| 348 | solo:184, twice | the run ended before or during the look |
| 390 | makers:1354 | a stale expectation of a saved shape; the helper ran only the files it touched |
| 366, 387 | room model, fight model | a compute budget on a slower box; a walk past its timeout failed later files |
| 391 and after | feel.e2e.ts | other helpers' load on the shared box |

In common: eight of eleven looked at the page at a moment instead of waiting for a named state, most often a state the test had
just written with `hunterApp.store.update` (114 call sites) before the page or the room had carried it. The rest are the box.
Three of these "test faults" were hiding real app bugs (rows 346, 348, 378), so reading each trace paid every time.

## Proposals, in order of worth

1. **Run the unit pass in parallel workers.** Do. Cost: `--parallel=4` in `scripts/ci.ts` and `bun run test`, then `--timings`
   so the slowest file starts first. Saves 210 s a push (364 to 154 s, one run each; the limit is fight-sim's load). Also
   isolates files, so a walk past its timeout no longer fails the files after it (row 366). Risk: load on a shared box; check
   the 180 s and 300 s budgets under four workers before relying on it. Principle: explain the number (the limiter is named).
2. **A push of only `docs/agent-handoff/` runs no unit test.** Do. Cost: one branch in `planOf` and its case in
   `tests/ci-plan.test.ts`. Saves the whole unit pass on every notes push; row 387 was a notes push refused by a timeout. No unit
   test reads that folder (only AGENTS.md and docs/guide are read, lint.test.ts:1596). Risk: a future test that reads it; guard
   with a lint that no test opens `docs/agent-handoff/`. Principle: encode lessons in structure.
3. **Wait for a named state in the helpers, never for time.** Do. Cost: `go`, `tapIfShown`, `onboardGM`, `onboardPlayer` wait on
   the view's section or the window's title; `dismissAll` gives way to `answerWindow`; `room-sync.e2e.ts` uses its own sentinel
   for the reload. One run with `E2E_POPUP_DELAY=100` proves each. Saves at least 8 min of serial browser time (about 1.5 min of
   a six shard run) and removes the cause of row 101. Risk: every browser file runs it; a wait on the wrong state. Principle:
   test behaviour, not implementation (a sleep asserts nothing).
4. **One setup helper that waits for what it set up.** Do. Cost: `setUp(page, step, until)` in helpers, its `until` required,
   and a lint that a browser test writes the store only through it. Catches the class of rows 329, 346, 348, 349, the largest
   class of false failures, before a push meets it. Risk: 114 call sites to move; do it file by file as they change.
   Principle: encode lessons in structure.
5. **Move fight-sim's measuring into its tests.** Do. Cost: `measure()` in each `test` or a `beforeAll` with a budget. Its 123 s
   then shows in timings, falls under a timeout, and spreads across workers. Saves nothing alone; with proposal 1 it is the
   new limiter, so it decides the pass's length. Principle: explain the number.
6. **Name the copy of sync.ts and check the names.** Do the lint, do the refactor later. The lint: every sync.ts function the
   model cites exists in sync.ts (it catches a rename or a deletion, not a changed body). The refactor (sync.ts takes fetch,
   clock and store as arguments and the model builds the same runner) would make the model test the shipped glue; cost is a
   954-line file and every room browser test. Principle: test behaviour, not implementation.
7. **Tests by class for the audit's gaps.** Do, one per class, each failing first: a GM action applied twice equals once
   (`settleClear`, award); two paths, one answer (a table that runs each pair the audit names); a pack and a campaign file
   round trip of the kit examples with every nested key; a non-English name at the size bound. Postgres in the unit pass
   when `DATABASE_URL` is set: do later, it needs a database on every box. Principle: encode lessons in structure.
8. **Export the sweep's `check` and drop the six copies in look.e2e.ts.** Do. Cost small; one audit to fix when the rule
   changes. Risk: none seen, the sweep already walks every maker at 360 and 390. Principle: build the lever.
9. **Seed a save for tests whose subject is not first run.** Do later. Cost: a fixture from `starterCampaign`. Saves the
   onboarding windows in 279 setups, but no time was measured here beyond the sleeps; measure five tests first. Risk: a seed
   that drifts from what onboarding gives; `room-onboarding.e2e.ts` keeps the real path. Principle: explain the number.
10. **Tighten loose assertions.** Do with proposal 3: `room-sync.e2e.ts:36` asserts REWARD RECEIVED and its numbers.
    Principle: test behaviour, not implementation.
11. **A smaller model walk per push, or seeds by commit.** Do not. Proposal 1 removes the cost, and either would let a regression
    through or blame the wrong push. A wider seed range on a schedule is the one form worth adding later.
12. **Rebalance the browser shards.** Do not. They run 5.0 to 6.3 min; the spread is under one test file.

## What surprised me

- The largest unit cost is fight-sim, not the three models, and it runs at module load where nothing times it.
- bun 1.4.4 already has `--parallel`, `--shard` and `--timings`; nothing here uses them.
- Every false failure of a browser test that was read to its cause either fixed a test that looked too early or found an app bug.
