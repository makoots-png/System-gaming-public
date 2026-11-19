# Does CPU steal explain the lag test's failures? No.

19 November 2026, branch `lag-steal` at a823df6d, Firecracker VM with 4 CPUs (booted 14:07 UTC). Every run below was alone on the box. The runs from 17:03 on were taken under `flock /tmp/box.lock`; the first two (16:57 and 16:59) were before the lock existed, with nothing else running (`ps`: no other process over 1% CPU).

## The hypothesis and the decision it would change

The lead's hypothesis: a frame gap measured while the host held the CPU says nothing of the app, so the test should void such a measurement. If steal explained the long frames, the over-bound frames would fall where steal rose. If not, a void-on-steal rule would hide nothing and fix nothing, so it should not be written.

## How it was measured

A throwaway probe in `tests/e2e/feel.e2e.ts`, since removed:
- The page's recorder also kept each frame's end as epoch time (`performance.timeOrigin + t`).
- The test's node side read `/proc/stat` every 5 ms while a case measured. It kept the steal column of `cpu0` to `cpu3` and the guest's CPU pressure (`/proc/pressure/cpu` total).
- For each frame, the steal over the frame was the counters from the last sample before its start to the first sample after its end, so it errs toward finding steal.
- Four `SCHED_FIFO` threads, one pinned to each CPU, slept 1 ms in a loop and logged any wakeup more than 3 ms late. At that priority no guest task delays them, so a late wakeup is the vCPU not running. This also catches host stalls that the steal counter misses.

## The numbers

Four runs: two probed, one probed with the stall detectors, and one with `FEEL_PROFILE=1` (the profiled run is perturbed and counts only for what is inside its tasks).

- 5383 frames were measured over 100.2 s of cases. Steal over all of it was 2610 ms of CPU, 0.65% of 4 CPUs.
- 59 frames were 50 ms or longer. Steal fell inside 8 of them (14%).
- 15 frames were over their case's bound. Steal fell inside 2 of them (13%), 10 ms on one CPU each time, and those frames were 116.6 ms and 66.6 ms.
- Chance alone puts some steal inside a 70 ms window about 17% of the time at this rate, so steal is no more frequent inside the long frames than anywhere else.
- The stall detectors found no late wakeup inside any long frame. Guest CPU pressure inside them was 1 to 5 ms.
- Steal over a whole run was 116 to 165 ticks, which is the lead's range. Most of it falls outside the measured windows, during setup. The run with 165 ticks had 1 failed case and the run with 116 had 3, so whole runs show no link either.

## The host, checked three other ways

- Speed. A fixed integer loop pinned to one CPU took 187 to 204 ms over 20 runs (±4%), with 0 or 1 steal tick each.
- The throttle. One JS loop timed at rate 1 and rate 4, six times each, in three sittings: the ratio of medians was 4.38, 4.42 and 4.25. On this box "4x" is about 4.35x. Sleep overshoot was 61 µs median for a 100 µs sleep and 128 µs for 1 ms, which is plausibly where Chrome's throttler runs long (a guess, not traced).
- Memory. First touch cost 1.6 to 1.9 µs a page, for 400 MB and for 6000 MB alike. Fresh memory carries no host fault cost.

## What does explain the long frames

The page's own tasks, at 4.35x. Every over-bound frame holds one or more long tasks, and the profiled run breaks them down:
- The fight turn has an 83.5 ms task: the animation frame's script 54 ms, style 17, layout 13, paint 11.
- The maker opening has a 98.9 ms click task, 46.7 ms of it `focus` (a forced style and layout).
- The odds have a 91.4 ms task: the animation frame 36 ms, style 16, paint 13, a minor GC 10.
- The use from the map has a 65 ms task, the same mix as the fight turn.

The odds case fails most often: in 4 of the lead's 5 failed runs today and in all 4 of these. It is not one stray frame. In the third run, from 2.2 s to 3.0 s, its frames ran `67 67 50 50 50 67 50 50 50 50 50 50 33 50 83` ms. That is the screen at 15 to 20 frames a second for most of a second while the count runs, which is the lag the test exists to catch.

The same tasks vary between runs. The fight turn's longest task was 50 ms in the 14:50 push and 51 to 83 ms since, and the bounds were set at the worst of ten runs plus one frame. So these cases sit at their bounds and a run lands on either side. Why the morning's runs held is not known. They ran on an earlier boot of the box, and no measurement of that host or its throttle ratio survives to compare.

## What was changed

Nothing in the test or the app. The brief said to stop if steal did not explain the frames. The candidates for the lead:
- The odds screen's work per frame while the count runs. A train of 50 to 67 ms frames is the app.
- The maker's `focus` that forces layout in the click.
- Whether the test should calibrate its throttle to an effective 4x (measured here as 4.25 to 4.42x) rather than trust the nominal rate.

The probe's tools (the stall detector, the throttle ratio, the tallies) are in the session's scratchpad and are not part of the repo.

# Making the page's own tasks shorter (lag-steal, second pass)

Each case's worst frame in ms (in 60 Hz frames) and worst tap, over 6 runs of `tests/e2e/feel.e2e.ts` under `flock /tmp/box.lock`, `E2E_CHROMIUM=/opt/google/chrome/chrome`.

## Baseline at b79a331b, 6 runs

| Case (bound in frames) | worst frame per run (ms) | worst | worst tap per run (ms) |
|---|---|---|---|
| fight turn (6) | 83, 133, 83, 83, 67, 67 | 133 (8) | 105, 91, 79, 72, 75, 72 |
| watching the GM (3) | 33, 33, 17, 17, 50, 17 | 50 (3) | none |
| maker opening (5) | 83, 67, 83, 50, 50, 50 | 83 (5) | 109, 90, 102, 69, 78, 69 |
| sheet scroll (3) | 17 in all | 17 (1) | 20 at most |
| map pan and pinch (3) | 50, 33, 17, 17, 17, 17 | 50 (3) | 30 at most |
| map ability picked (3) | 33, 17, 33, 50, 50, 33 | 50 (3) | 63, 48, 62, 70, 89, 55 |
| map use (6) | 167, 83, 100, 83, 67, 83 | 167 (10) | 93, 56, 71, 54, 40, 55 |
| odds (3) | 50, 33, 67, 67, 67, 83 | 83 (5) | 37, 36, 65, 44, 52, 32 |

Failed cases per run: 3, 1, 2, 1, 1, 1 (the odds in 4 of 6, the fight turn's frame or tap in 2, the maker's tap in 2, the map use in 2).

## Target 1: the odds playing

Hypothesis 1 (kept): one command of the engine is longer than the slice. A probe (removed) timed every `oddsStep` in `frame` (odds-box.js). The first fight's begin took 34.9 ms at 4x and its next commands 60.7, 18.4 and 29.2 ms: the reducer's code running for the first time. Warm commands took 2 to 12 ms, so a 6 ms slice checked between commands ended at 9 to 18 ms, and with the draw and the frame's style and paint most frames missed one beat (33 ms) and some two. The draw itself was 1 ms at the median, 13 ms at worst. Garbage was not it (minor GC under 5 ms of a 180 ms run in the CPU profile).

A shorter slice cannot fix a 60 ms command, so the engine left the page's thread: `playAway` (src/edge/odds-run.ts) runs the same machine, seed and rules on a worker (src/odds-worker.ts, `/odds-worker.js`), and the box draws the count it sends, at most once a frame. The answer is the same run, so the odds are the same numbers.

| | worst frame per run (ms) | worst |
|---|---|---|
| before | 50, 33, 67, 67, 67, 83 | 83 (5 frames) |
| after | 33, 33, 33, 17, 17, 33 | 33 (2 frames) |

What else it could measure: the test's CPU throttle does not reach the worker, so the run lasts about 1 s and 60 frames are measured, not 500. The page's work per frame is now the count's draw alone, the same in a long run as a short one; a phone runs the worker on another core. The solo run's one play (gates.js) still slices on the page's thread with `ODDS_FRAME_MS`; the lag test does not measure it.

Hypothesis 2 (kept): the count's draw forces a style pass per message. A profile with the worker showed `now` (motion.ts, the running fill's transform read by `getComputedStyle`) at 32 to 124 ms of its own time over a run, in tasks of `HandlePostMessage` that also restyled: the worker's counts (every 16 ms of its time) queued while the slowed page drew, each drew, and each wrote the words before `fillTo` read the fill. One run of the full test had an 82 ms long task in this case. Now the box draws the newest count once a frame, and `fillTo` reads the moving fill and trail before writing the bar (`progress` writes its words after it). After: `now` holds no self time in two profiled runs; 6 runs gave 33, 33, 33, 17, 17, 33 ms.

## Target 2: a maker opening

Hypothesis 3 (reverted): the root `:has()` rules (`html:has(.overlay.show)` and the toast box's four) cost the style pass when a window opens. Chrome's selector stats (category `disabled-by-default-blink.debug`, a probe test since removed) put `html:has(.overlay.show)` and `html:has(.dx-sheet:not([hidden])) .toast-box` first, one attempt each but walking the page. Anchoring them on `body`'s children (`html:has(> body > .overlay.show)`) halved the selector total under stats, but without stats the click task was 64, 53, 52 ms against 78, 51, 51 ms before: inside the spread. Removing the rules outright gave the maker 50, 50, 33 ms in 3 runs, also inside the spread. Not kept.

Probe (no change): the maker's 163 elements restyle in 1.1 ms unthrottled when re-inserted, and disabling any one of the 35 style sheets moves that by at most 0.4 ms, which is the noise. No sheet or rule is the cost.

Probe (no change): opening the item maker three times on one page at 4x, the first click task was 72 and 41 ms in two pages, the later ones 23 to 43 ms. Part of the first open is code running for the first time.

Hypothesis 4 (reverted): compile the bundle eagerly so a first open runs compiled code (`//# allFunctionsCalledOnLoad`, Chrome's compile hint, as the bundle's banner). The first maker open's click task fell to 35 and 37 ms, but 6 runs of the lag test gave the maker 33, 67, 83, 33, 33, 33 ms: the worst did not move (83 before). Not kept; it would also compile 1.27 MB at every load.

Stopped: two hypotheses in a row gave nothing. What limits the maker's tap, from marks in `openMaker` and a trace of its click at 4x: the build's script is 7 to 27 ms (the form's markup 3 to 10, the effects editor, `sync` and the preview the rest), then the first field's `focus()` forces the window's style and layout, 15 to 35 ms. Moving the description, rarity, quantity and value fields to a later frame left `focus` at 17 to 24 ms, so the cost is not the count of fields drawn; it is the window's first style and layout as such, and the page's own (the scroll lock's `html` overflow change lays out the root). Deferring the focus would move the same pass into the frame, not remove it. Spread between pages is larger than any piece: the first open's click task was 39 to 124 ms over five pages (one with a 41 ms pause between two marks with no work between them, a GC or a host stall).

## Target 3: a fight turn

A trace of the turn at 4x (a probe test, removed) splits it into: the ability's tap, a 31 to 47 ms click that opens the picker (style 10 to 15 ms of 24 elements); the target's tap, a 30 to 51 ms click (the reducer 7 to 20 ms, `store.apply` with `repairSave` of the whole save 5 to 12 ms, the picker's close and the focus given back, which lays out the page as the scroll lock lifts); the redraw, a 54 to 72 ms frame (script 27 to 46 ms, of which `slideTo`'s read of the rows lays out what the redraw changed, 15 to 32 ms, then paint 10 to 13 ms); and Next, a 17 to 22 ms click and a 53 to 70 ms redraw. When the click and its redraw fall in one frame the frame is 95 ms. No one piece is over a third of the worst frame.

Both hypotheses above were also measured on this case: without the root `:has()` rules 100, 117, 117 ms in 3 runs; with the compile hint 200, 67, 100, 67, 117, 50 ms. Neither is outside the case's spread (67 to 133 ms at baseline), so no change was made for it. Stopped by the rule.

What would move it, not tried: `store.apply` repairs the whole save after every step (`repairSave`), which a step from core already answers valid; and the redraw could keep the command's frame and its own apart, so a frame never holds both the reducer and the redraw. Both change a contract (the store's, the update loop's) and are the lead's to decide.

## Final: 6 runs at 4700d14e

| Case (bound) | worst frame per run (ms) | worst | worst tap |
|---|---|---|---|
| fight turn (6) | 50, 50, 83, 167, 150, 67 | 167 (10) | 131 |
| watching the GM (3) | 17, 17, 83, 17, 17, 17 | 83 (5) | none |
| maker opening (5) | 67, 33, 33, 50, 83, 50 | 83 (5) | 108 |
| sheet scroll (3) | 17 in all | 17 (1) | 17 |
| map pan and pinch (3) | 17, 17, 33, 17, 17, 17 | 33 (2) | 24 |
| map ability picked (3) | 33, 17, 33, 33, 33, 50 | 50 (3) | 79 |
| map use (6) | 67, 83, 117, 67, 83, 100 | 117 (7) | 66 |
| odds (3) | 17, 17, 33, 33, 33, 33 | 33 (2) | 52 |

Failed cases per run: 0, 0, 2, 1, 2, 0 (baseline 3, 1, 2, 1, 1, 1). The odds no longer fail (4 of 6 at baseline). The fight turn, the maker's tap, the map use and once the player watching still cross their bounds; the fight turn's spread is as wide as at baseline.

# The save's repair on every write (lag-store)

19 November 2026, branch `lag-store` from 6ae095b, a box booted at 19:40 UTC (4 CPUs). Every run under `flock /tmp/box.lock`, `E2E_CHROMIUM=/opt/google/chrome/chrome`, nothing else running.

## Baseline at 6ae095b, 6 runs (19:42 to 19:48)

| Case (bound in frames) | worst frame per run (ms) | worst tap per run (ms) |
|---|---|---|
| fight turn (6) | 67, 50, 33, 67, 50, 33 | 63, 49, 47, 63, 57, 46 |
| watching the GM (3) | 17 in all | none |
| maker opening (5) | 33, 67, 33, 33, 33, 17 | 58, 99, 55, 61, 68, 54 |
| sheet scroll (3) | 17 in all | 17 at most |
| map pan and pinch (3) | 17 in all | 24 at most |
| map ability picked (3) | 33, 17, 17, 17, 17, 17 | 55, 42, 46, 42, 43, 46 |
| map use (6) | 67, 50, 100, 67, 50, 50 | 50, 46, 70, 48, 48, 49 |
| odds (3) | 17 in all | 35 at most |

Failed cases per run: 0, 0, 0, 0, 0, 0. On this boot the test did not reproduce the failures the brief names. The margins are thin: the map use reached its bound (100 ms, 6 frames) once and the maker's tap was 99.2 ms against 100.

## The repair's share of a write, measured first

A probe (removed) timed each part of `store.apply` and `store.update` with `performance.now()` inside the lag test's fight turn and map use at 4x, 3 runs, 7 writes. Per write, in ms:

| part | combat-act (5 writes) | combat-endTurn (3 writes) |
|---|---|---|
| the step (`fought`) | 1.5 to 2.7 | 0.2 to 0.7 |
| the notice step | 0 to 0.8 | 0 |
| `writeInto` | 0.1 to 1.1 | 0.2 to 1.1 |
| `repairSave` (`'kept'`) | 3.0 to 7.2 | 3.1 to 4.8 |
| the store's life (`carry`) | 0 to 0.2 | 0 to 0.5 |
| `emit` (subscribers; the redraw itself waits for the frame) | 0.2 to 2.7 | 0.8 to 1.5 |

`writeInto` is not the cost: a step shares what it does not change, and the walk stops at a shared object. The repair is about half of a write and about a tenth of the tap's click task (30 to 51 ms in the earlier trace), and none of the redraw frame that follows it. The maker opening writes nothing (no write in its window), so the repair cannot be part of its tap.

## Hypothesis 1 (reverted): a step's answer is written without the repair

Commit 2589d78: `apply` writes the step's answer and the notice step's, then stores and announces it; `update` (a test's setup, the console) still repairs. Repair stays at the boundaries that read outside data: load, import, restore, another tab's write, reset, a room message's reader, a player's sheet. `tests/trusted-steps.test.ts` walks a campaign through 13 core steps as the store runs them and checks `repairChanges` (save.ts) is empty after each. The walk found one step that leaned on the repair: `logLine` did not bound a line's title and text, so a line of 600 characters was cut only by the repair. The commit bounds it in `logLine`.

6 runs (20:10 to 20:16):

| Case (bound) | baseline worst frame (ms) | without the repair | baseline worst tap (ms) | without the repair |
|---|---|---|---|---|
| fight turn (6) | 67, 50, 33, 67, 50, 33 | 50, 33, 67, 50, 50, 50 | 63, 49, 47, 63, 57, 46 | 39, 43, 51, 56, 58, 50 |
| map use (6) | 67, 50, 100, 67, 50, 50 | 83, 67, 50, 83, 50, 50 | 50, 46, 70, 48, 48, 49 | 50, 43, 45, 52, 42, 39 |
| maker opening (5) | 33, 67, 33, 33, 33, 17 | 33 in all | 58, 99, 55, 61, 68, 54 | 58, 61, 50, 55, 56, 57 |

Failed cases per run: 0 in all six, as at baseline. The fight turn's tap median moved from 53.2 to 50.7 ms and the map use's from 48.7 to 43.6 ms, both inside the range of the other side (rank-sum U of 13 and 9 of 36 pairs; two-sided 0.05 needs 5 or less). The worst frames did not move. The 3 to 7 ms a write saves is real but smaller than a 60 Hz frame and than the spread, so by the brief's rule it is reverted (4908ac4). Its commit keeps it whole with its test, if it is wanted for the boundary's sake rather than the lag's.

What limits each case now (from the trace in the second pass, not taken again): the fight turn's worst frame is the redraw after the command, its script mostly `slideTo`'s read of the rows forcing layout, then paint; the map use is the same redraw with the tokens; the maker's tap is the window's first style and layout forced by `focus()`. Hypothesis 2 (the command's write and its redraw in separate frames) was not tried: the brief gives it only if hypothesis 1 is not enough, and the test held 6 of 6 at baseline on this boot.

## Final: 6 runs at 073ac6e (the app as at 6ae095b), 20:25 to 20:42

| Case (bound) | worst frame per run (ms) | worst tap per run (ms) |
|---|---|---|
| fight turn (6) | 50, 83, 67, 67, 50, 50 | 50, 58, 53, 56, 70, 58 |
| watching the GM (3) | 83, 33, 17, 33, 17, 33 | none |
| maker opening (5) | 33, 50, 33, 33, 33, 50 | 64, 77, 64, 62, 57, 81 |
| sheet scroll (3) | 17 in all | 18 at most |
| map pan and pinch (3) | 17 in all | 22 at most |
| map ability picked (3) | 17, 50, 17, 33, 33, 33 | 52, 73, 46, 64, 49, 54 |
| map use (6) | 100, 67, 67, 67, 67, 67 | 55, 58, 55, 52, 47, 54 |
| odds (3) | 17 in all | 45 at most |

Failed cases per run: 1, 0, 0, 0, 0, 0. The failure was the player watching the GM's turn: one gap of 83.3 ms among 411 frames, with no long task on the player's page (none over 50 ms). It is not a write's repair (the brief's three cases did not fail) and neither hypothesis reaches it. The second pass saw the same 83 ms once in that case. The lock was waited on by another helper's run during these six, and a gap of 7 minutes fell between runs 3 and 4 (the box paused or the lock was held); each run itself took 41 to 42 s.

Over the 18 runs today with the repair on every write (12) or off it (6): 1 failed case, in the watching case. The fight turn reached 83 ms once (bound 100), the map use 100 ms twice (at its bound), the maker's tap 99.2 ms once (bound 100); in the three probed runs of the fight, maker and map cases the maker's tap was 100.3 ms once, a failure, in a case that writes nothing.

Checks at c6d3070: `bun run test` 4237 pass, 3 skip, 0 fail; `save.e2e.ts` 19 passed, `room-sync.e2e.ts` 2 passed, `combat-turns.e2e.ts` 19 passed, one worker each.
