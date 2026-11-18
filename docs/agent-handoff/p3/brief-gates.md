# Brief: gate lifecycle and payout (M4)

Read `AGENTS.md` and `docs/agent-handoff/helper-rules.md` first (its last section names the principle skills to read). Where this brief and the rules differ, this brief wins.

You work in the repo root on the branch that is checked out. No other helper is running. Commit after every numbered step (name the files you add, plain messages, no AI attribution lines). Do not push. Do not start helpers of your own. Never edit anything under `.claude/skills`.

Browser runs: `E2E_CHROMIUM=/opt/pw-browsers/chromium E2E_PORT=3241 bunx playwright test tests/e2e/<file> --workers=1 --trace off --output=/tmp/pw-gates`. Do not run `playwright install`. If a browser test fails once, rerun that file once before reading anything into it.

Notes file (append a line after each commit): `docs/agent-handoff/p3/notes-gates.md`.

## Why (the owner's goal)

Adding or changing a feature must be easy, with a clear trace to what depends on it, and no implicit state machines. A gate's life (`detected`, `raiding`, `broken`, `cleared`, `closed`) is written directly in about seven places in `src/views/gates.js`, including the GM's edit form, which can set any status. Whether a gate's XP was already paid is one number, `xpPaid`, and `src/views/combat.js` (`endEncounter`, the `covered` line) guesses "already paid" from `status === 'cleared'`. Three past fixes were about this. An audit suspects three more bugs and nobody has reproduced them:

1. Clearing a gate with no hunters selected sets it cleared and pays nobody. A fight still running in that gate then ends, and its End window says the XP was already paid, so the monster XP is lost.
2. The edit form can move a cleared gate back to detected, and the gate keeps its `clearedDay`.
3. Setting a gate to cleared in the edit form pays nothing, but a fight in that gate is then told its XP was already paid.

## The model (decided; say in the notes if something cannot work)

File `src/core/gates/gate.ts`, strict TypeScript, pure, with bun tests in `tests/gate.test.ts`.

- `Gate` is a union on `status`. Only the cleared variant has `clearedDay: number`. `monsters` is typed (`{ monsterId: string; count: number }[]`), ids are branded like the combat ids (`GateId`, and reuse or add a `MonsterId`).
- One transition table, typed so that a missing status or event fails the typecheck: for each status, which events it accepts and where each leads. Events: `enter`, `fightStarted`, `dayAdvanced { day }` (a detected or raiding gate breaks when the day reaches `breakDay`), `clear { day }`, `close`, `gmSet { status, day }` (the edit form: the GM may set any status, but through the table, so entering cleared stamps the day and leaving cleared drops it), `paid { xp }`.
- `transition(gate, event): Gate` answers the same gate when the event does not apply in that status. `can(gate, eventType): boolean` is what the view asks before it shows a button (it replaces the `OPEN_STATUS` checks).
- Payout stays one number (`xpPaid`), with one rule in one place. The review said to try one payer before building a ledger. Pure functions: `gateXp(gate, xpOf)` (the roster's XP), `xpDue(gate, xpOf)` (what the gate still owes, never below 0), and `fightAward(gate | null, fightXp, xpOf)`: a fight with no gate pays its own XP; a fight in a gate pays its XP while the gate still owes anything and nothing once the gate owes nothing. Nobody reads `status` to decide a payment.
- `parseGate(value): Gate | null` is the boundary parser the save repair calls (a cleared gate without a day gets the day from `createdDay`, or say what you chose).

## Steps

1. Reproduce first (`tdd` skill). Write the three suspected bugs as browser tests in `tests/e2e/gates-quests-dailies.e2e.ts`, named for what the GM sees, driven through the UI. Run them against the code as it is. Record in the notes which fail (real bugs) and which pass (not bugs: keep the test only if it pins something a GM cares about). Commit the failing ones as `test.fixme` with the bug named, and add each real bug to `docs/agent-handoff/p3/bugs-found.md`.
2. `tests/gate.test.ts` first, then `src/core/gates/gate.ts`: the table (every status and event pair has a test or is listed as "no change"), `can`, the payout functions with the numbers worked out by hand in the test, `parseGate` with hostile input. Include a small exhaustive check: from every status, every event sequence of length up to 4 leaves a gate that `parseGate` accepts, `xpPaid` never goes down, and only a cleared gate has `clearedDay`.
3. `src/core/save.ts`: `Gate`, `GateMonster` and the status list come from `gate.ts`, the repair calls `parseGate`. Update `tests/save.test.ts`.
4. `src/views/gates.js`: every status write becomes `transition`, every "is this allowed" becomes `can`, the edit form goes through `gmSet`, Clear uses `xpDue`. `src/views/combat.js` `endEncounter`: `covered` and the hand-written `xpPaid` update go, replaced by `fightAward` and a `paid` event. Delete what the table replaces. Check `src/views/gm.js` and any other reader with grep.
5. Lint rule in `tests/lint.test.ts`, named in `AGENTS.md`: only `src/core/gates/gate.ts` writes a gate's `status`, `clearedDay` or `xpPaid` (the message says: add an event to the table).
6. Remove the `fixme` from the bugs the model fixed and make those tests pass. Run `gates-quests-dailies`, `combat-turns`, `table-session` and `save`.
7. `AGENTS.md`: a "Where things live" row for the gate lifecycle and payout, and a recipe "To add a gate status or event".

## Rules for this unit

- Apart from the three bugs, what a GM or player sees does not change. The four existing gate XP tests in `gates-quests-dailies.e2e.ts` are the pin: run them before step 4 and after.
- `gates.js` stays JavaScript. Do not restyle it. Do not touch spawning, loot or the day counter beyond their status writes.
- Explain every number a test expects in the test itself (`principle-explain-the-number`).

## Done means

- `bun run test` passes and the four browser files pass.
- Final reply under 200 words: which of the three bugs were real, what you made, the last line of each command, anything you were unsure of or left out.

If a step turns out to be wrong or much larger than it reads, stop, write why in the notes file and reply. Do not widen the task.
