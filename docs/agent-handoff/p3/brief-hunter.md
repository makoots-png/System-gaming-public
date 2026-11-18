# Brief: the hunter model (M7)

Four units, one helper each, in order: A leveling and ability points, B vitals and fatigue, C penalty, D job change chain. Your prompt says which unit is yours.

Read `AGENTS.md` and `docs/agent-handoff/helper-rules.md` first (its last section names the principle skills: for this task `principle-model-the-domain`, `principle-type-system-discipline`, `principle-fix-root-causes`, `principle-migrate-callers-then-delete-legacy-apis`, `principle-test-behavior-not-implementation`, `principle-explain-the-number`, and the `tdd` skill for the bugs). Where this brief and the rules differ, this brief wins.

Then read `docs/agent-handoff/p3/hunter-state-inventory.md` in full. It is an exact inventory of today's behaviour with file and line for every writer and reader, written for this milestone. Line numbers may have moved a little; grep to confirm.

Commit after every numbered step (name the files you add, plain messages, no AI attribution lines). Do not push. Do not start helpers of your own. Never edit anything under `.claude/skills`.

Browser runs: `E2E_CHROMIUM=/opt/pw-browsers/chromium E2E_PORT=<the port in your prompt> bunx playwright test tests/e2e/<file> --workers=1 --trace off --output=/tmp/pw-hunter`. Do not run `playwright install`. If a browser test fails once, rerun that file once before reading anything into it. A test must wait for each window a player sees before it taps past it (`docs/agent-handoff/p3/notes-jobchange-flake.md` explains the trap).

Notes file (append a line after each commit): `docs/agent-handoff/p3/notes-hunter.md`.

## Why (the owner's goal)

No implicit state machines, and adding a feature must be easy with a clear trace of what depends on it. A hunter's condition is spread over fields that code keeps in step by hand: HP, an `unconscious` chip and `deathSaves`, repaired after every change by `settle()` in a second store update; a penalty stored three ways; a job chain smeared across quest fields and advanced by a listener behind a `syncing` flag; ability points as a counter that can be farmed (bug 1 in `p3/bugs-found.md`). Each becomes typed state in `src/core/hunter/` with pure functions and bun tests, in the house style of `src/core/gates/gate.ts` (a union and a typed table) and `src/core/combat/encounter.ts` (a reducer that returns effects as data).

Old saves need not work, but a player's hunters must survive: the save repair in `src/core/save.ts` reads the old fields once and writes the new shape (name, stats, level, XP, items, skills, quests, titles and gold are kept).

## Decided for all units

- Each model lives in its own file under `src/core/hunter/` with its test file, and the `Hunter` type in `save.ts` takes its fields from there. A parser at the save boundary, trusted types inside.
- Every writer in `src/views` and `src/edge` goes through the model's function. The old field and its hand-written upkeep are deleted in the same commit that replaces them. A lint rule per model in `tests/lint.test.ts`, named in `AGENTS.md`, says what may write the field.
- What a player or GM sees stays the same except where a unit below says otherwise. Each unit lists its visible changes in the notes.
- `AGENTS.md` gets a "Where things live" row and, where it applies, a recipe.

## Unit A: leveling and ability points (fixes bug 1)

Model in `src/core/hunter/progress.ts`:

- Levels stay stored (`level`, `xp` within the level), changed only by `gainXp(progress, amount, R)`, which answers the new progress and what happened (levels gained or lost) as data.
- Ability points are not a counter any more. The hunter stores what cannot be derived: `bonusPoints` (points from quests, dailies and the GM) and what was spent (the existing locked stat allocation, or a `spent` number if that is simpler; say which). Points available = points for the levels held (`pointsPerLevel` per level above 1) + `bonusPoints` − spent, never shown below 0. Losing levels can leave a hunter overspent: they get no new points until the total catches up. That is the whole fix for bug 1.
- `peakLevel`: the highest level this hunter has reached. The level-up refill of HP and MP happens only when a level above `peakLevel` is reached, so regaining a lost level does not refill (the second half of bug 1).

Steps: 1. the `fixme` test for bug 1 in `gates-quests-dailies.e2e.ts` already fails for the right reason: confirm it. 2. `tests/progress.test.ts` first, then the model, numbers worked out by hand in the test. 3. Save types and repair (an old `points` counter becomes `bonusPoints` such that the hunter has the same points available on load). 4. Move the writers in `hunter.js`, `quests.js`, `gm.js` and anywhere else grep finds, delete the old counter. 5. Lint rule, remove the `fixme`, run `character`, `customization`, `gates-quests-dailies`. 6. AGENTS.md.

## Unit B: vitals and fatigue

Model in `src/core/hunter/vitals.ts`:

- One field replaces `hp`, the `unconscious` condition and `deathSaves`: `life: { at: 'up'; hp: number } | { at: 'dying'; successes: 0 | 1 | 2; failures: 0 | 1 | 2 } | { at: 'stable' } | { at: 'dead' }`. HP is read through a selector (`hpOf`). The Unconscious chip is drawn from `life` and is never in `conditions`, so nothing has to guard it against removal: delete those guards.
- `Dead` is new and real: three failed death saves. A dead hunter is not brought back by a heal, a rest, a level-up or a daily refill. Only the GM's Revive does it (to 1 HP), from the sheet and the GM board. Reason: today a "dead" hunter stands up on any heal, which the inventory lists as the top surprise, and the game tells the player "The GM decides your fate".
- One typed table of events, as in `gate.ts`: `damage`, `heal`, `setHp` (GM), `deathSave { roll }` (10 to 19 a success, 2 to 9 a failure, 1 two failures, 20 up at 1 HP: today's numbers, pinned in the test with where they come from), `stabilize`, `revive`, `maxChanged`. Damage while dying, stable or dead changes nothing, as today.
- Fatigue and collapse in the same file: `fatigue` 0 to 100 and `collapsed: boolean`, set when fatigue reaches the rules' collapse number and cleared only by a long rest (today's behaviour of the Exhausted chip). The Exhausted chip is drawn from `collapsed` and is never in `conditions`.
- `settle()` and its `change` listener are deleted. MP and HP are clamped by the function that changes them or by `maxChanged`, which every change to a maximum sends.
- The combat reducer's `hunterHp`, `hunterMp` and `hunterFatigue` effects, the room `hp` applier and item effects go through these functions. The combat card shows a local hunter's Dying, Stable or Dead tag the way it shows Down for a remote one.
- `unconscious` and `exhausted` leave the status registry as statuses that can be applied; their label and description stay available for the chip. A room `status` event or a combat command that tries to add or remove them is refused by the parser or the reducer.

Steps: 1. the pin: run `character`, `combat-turns`, `table-session`, `customization` and record counts. 2. `tests/vitals.test.ts` first (every state and event pair, plus a walk of every event sequence up to length 5 that checks the invariants), then the model. 3. Save types and repair (an old hunter at 0 HP with saves becomes dying or stable; with 3 failures, dead). 4. Move every writer and reader (the inventory lists 15 direct writers and the readers), delete `settle`, the guards and the old fields. The sheet a phone pushes and the GM's remote cards read the new shape through the same selector. 5. Lint rule, new browser tests named for what the player sees (a hunter with three failed saves is dead and a heal does not raise them; the GM revives them; a collapsed hunter stays Exhausted until a long rest), run the pin files plus `gates-quests-dailies` and `room-sync-fixes`. 6. AGENTS.md.

## Unit C: penalty

Model in `src/core/hunter/penalty.ts`: `penalty: null | { since: string; days: number; questId: string }` is the only store. The Penalized chip and the −2 are derived from it. `penalized` leaves the status registry as a status that can be applied (the inventory found that a hand-applied one gives no −2 and cannot be removed). The penalty quest is a real quest, tied to the penalty by `questId`: one function takes the events (`dailyMissed`, `questCompleted`, `dayPassed`) and answers the new penalty plus effects as data (issue the quest, close the quest). The daily rollover in `quests.js` calls it; the three hand-synced writes go. Tests first, including each way the inventory says the three stores could disagree, now impossible or pinned. Run `gates-quests-dailies` and `character`.

## Unit D: job change chain

Model in `src/core/hunter/job-chain.ts` and a jobs table in `src/core/registry/jobs.ts`:

- `jobChain: null | { id: string; job: string; step: 1 | 2 | 3; status: 'active' | 'failed' }` on the hunter is the source of truth. The registry has one entry per job with its three step quests (what `quests.js` builds by hand today), typed so a job without three steps does not compile, and a test every job must pass. This is the table a new job is added to.
- One function takes the events (`issued`, `stepCompleted`, `stepFailed` when its quest is failed or deleted, `abandoned`, `reissued` by the GM) and answers the next chain plus effects as data (issue the next step's quest, grant the job and `canExtract`, close the chain). The quest's `chainId` stays only as a back-reference so completing the quest can name its chain. `step` and `chainJob` on quests, the `syncing` flag and its listener are deleted.
- A failed chain is visible (today there is no failed state) and the GM can reissue it. Say in the notes how it reads on the Quests tab and list the string in `copy-tasks.md`.

Tests first; keep the two Job Change browser tests in `gates-quests-dailies.e2e.ts` green and add one for a failed and reissued chain. AGENTS.md recipe "To add a job".

## Done means (each unit)

- `bun run test` passes and the browser files the unit names pass.
- Final reply under 200 words: what you made, the last line of each command, the visible changes, anything you were unsure of or left out.

If a step turns out to be wrong or much larger than it reads, stop, write why in the notes file and reply. Do not widen the task.
