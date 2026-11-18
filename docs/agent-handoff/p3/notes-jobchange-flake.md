# Job Change chain flake: notes

Test: "a Lv 10 hunter works the Job Change chain from the Quests tab and becomes a Necromancer" (`tests/e2e/gates-quests-dailies.e2e.ts`).
Base commit 6e02ec0. Box: 4 cores.

## 1. Reproduce

Command: `E2E_CHROMIUM=/opt/pw-browsers/chromium E2E_PORT=3271 bunx playwright test tests/e2e/gates-quests-dailies.e2e.ts -g "Job Change chain from the Quests tab" --workers=1 --repeat-each=15`

| Condition | Runs | Failed | Time per run |
|---|---|---|---|
| No load | 15 | 0 | about 10 s |
| 6 `yes` loops on 4 cores | 15 | 0 | about 12 s |
| 6 `yes` loops plus Chrome CPU throttle 6x (`Emulation.setCPUThrottlingRate`, through a temporary `E2E_CPU_THROTTLE` lever in the `device` fixture that was not committed) | 15 | 0 | about 22 s |

Neither load nor throttling makes it fail: both slow every task the same way, so the order of tasks stays the same. The race is in the order of tasks, so I tested it by delaying the one task I suspected (section 2).

## 2. Root cause

Premise: after the test taps "Necromancer", the step 1 QUEST COMPLETE window opens one task later, and `dismissAll` can look before it opens, find nothing and stop.

Why, step by step:
- The failure is a `tap()` on `[data-tab="active"]` (line 320) that retries until the 2-minute test timeout because `<div class="overlay sys-overlay show">` intercepts pointer events. A tap has no timeout of its own, so the test just hangs until the test timeout, and the run ends with "Target page, context or browser has been closed". That matches both reports.
- The window in the way is QUEST COMPLETE (in the trace). At Lv 10, issuing the chain completes step 1 at once (`syncChain` -> `complete`) and queues that window.
- `ui.system` opens the next queued window with `setTimeout(next, 0)` after the current one closes. So the window comes one task after the "Necromancer" tap.
- `dismissAll` only looks at what is on screen now. If its first look runs before that task, it sees no window and returns. Under load, the order of the CDP calls and the timer task can go either way.
- `completeQuest` had the same gap twice: a fixed 200 ms wait, then "tap Confirm if it is there", and the completion window that comes a task after the confirm closes.

Test of the premise: changing `setTimeout(next, 0)` to `setTimeout(next, 100)` in `src/views/ui.js` (temporary, reverted) makes the old test fail every time: 1 of 1 without load, then 3 of 3 under load, each at 2.1 min, with the same "sys-overlay show intercepts pointer events" error at line 320.

Verdict: a test bug. The app is right: a window that opens a moment after the tap is what a player sees, and a player waits for it. The test treated "no window on screen yet" as "no window coming".

## 3. Fix (test only)

- Step 1 waits for the QUEST COMPLETE window title before it dismisses.
- `completeQuest` waits for the "Complete quest?" window, taps its Complete button, then waits until a window titled "... COMPLETE" is on screen. Each completion opens one (QUEST, DAILY QUEST, JOB CHANGE COMPLETE), so all five callers in the file now wait on that window. The 200 ms fixed wait is gone.

No timeouts were widened and no retries were added.

## 4. Proof

| Condition | Old test | Fixed test |
|---|---|---|
| Injected 100 ms delay before the next window, no load | 1 of 1 failed | 3 of 3 passed |
| Injected 1000 ms delay, no load | not run | 3 of 3 passed. The two daily tests that use `completeQuest` also pass |
| Injected 100 ms delay plus 6 `yes` loops | 3 of 3 failed (2.1 min each) | 15 of 15 passed |
| Whole file, `--workers=1`, no delay | passed (lead) | 15 passed, 1 skipped (the existing fixme), 2.6 min |

`bun run typecheck` passes.

## Same pattern elsewhere (not fixed: out of scope)

`dismissAll` straight after an action that opens a System window has the same gap anywhere it is used (about 60 calls in 12 files). A cheap way to find them: run the whole suite once with `setTimeout(next, 100)` in `ui.js`. Every test that fails is one that does not wait for the window it expects.

A cheap, always-on signal: set `use.actionTimeout` (for example 15 s, the same as `expect`) in `playwright.config.ts`. A tap blocked by a window would then fail in 15 s, naming the overlay, rather than hanging until the 2-minute test timeout and ending with "Target closed".

Principles: fix-root-causes (the fix waits for the window the player sees, not a longer `dismissAll`); attack-the-premise (load and throttling slowed every task the same way and did not reproduce it, so I tested the ordering premise directly with an injected delay).
