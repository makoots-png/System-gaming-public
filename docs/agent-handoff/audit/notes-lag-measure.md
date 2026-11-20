# What the lag test should measure (lag-measure)

19 November 2026, branch `lag-measure` from c034f55, a Firecracker VM with 4 CPUs. Every timed run under `flock /tmp/box.lock`, `E2E_CHROMIUM=/opt/google/chrome/chrome`, `E2E_PORT=3233`.

## The question and the decision it changes

The lag test (`tests/e2e/feel.e2e.ts`) bounds the gap between two frames and a tap's time to its first frame, on the wall clock, with the CPU throttled 4x. The lead's proposal: bound the page's own main-thread work in CPU time instead, and keep the wall-clock gap as a looser second check. A measure earns the swap only if it holds still when the host is busy and moves when the app is slower, by more than its own spread. If no candidate does both, nothing is built.

## First finding: under the 4x throttle, thread CPU time is wall time

A page with one click task (a fixed JS loop, then 3000 elements laid out) traced with `devtools.timeline`, 3 rounds, idle and with 4 busy loops beside it (a scratch script, not in the repo):

| | task wall (`dur`), ms | task thread CPU (`tdur`), ms |
|---|---|---|
| idle, 1x | 74.4, 68.5, 64.5 | 64.4, 66.6, 63.4 |
| idle, 4x | 290.5, 277.7, 332.3 | 288.7, 268.3, 330.5 |
| loaded, 1x | 60.9, 66.8, 109.8 | 58.6, 65.3, 80.5 |
| loaded, 4x | 277.9, 268.8, 344.7 | 263.3, 247.1, 321.3 |

At 4x the task's CPU time is its wall time, so the thread's CPU clock counts the throttle (inferred: Chrome's throttle keeps the main thread busy while it holds it; the mechanism was not read in Chrome's source). A CPU-time bound at 4x is a wall-clock bound under another name. So the CPU-time candidate is taken at 1x (no throttle), where it counts only the page's own work; it is compared below with today's measures at 4x.

## The experiment

A throwaway copy of the lag test (`feel-probe.e2e.ts`, kept out of the repo) with its bounds taken out, so every case of every run is recorded. For each measured window it writes one line: today's numbers (the worst frame gap, the worst tap, the longest long task from `PerformanceObserver`) and, when traced, the main thread's `RunTask` events from a Chrome trace (`devtools.timeline`, `disabled-by-default-devtools.timeline`) taken over the window only: the longest task in thread CPU time (`tdur`), the longest in wall time (`dur`), and the sum of all tasks' CPU time.

Four conditions, each run at 4x untraced (today's test as it is) and at 1x traced (the CPU candidate):

- as is, idle: the app at c034f55, nothing else running (the box lock held).
- as is, loaded: four `bun -e 'for(;;){}'` busy loops, one per CPU, started before the run and killed after it.
- slowed, idle and slowed, loaded: a throwaway branch (`lag-measure-slowed`, never merged) adds a fixed loop of 1.2 million integer steps to every redraw while the fight view shows (`scheduleUpdate` in `src/app.js`). The page records each loop's time: 5.7 to 9.4 ms at 1x (median 7.4, 60 loops), 19.1 to 52.4 ms at 4x (median 33.5). The maker, the sheet and the map's pan and pick do not redraw the fight, so they should not move: they are the controls.

Six batches, one lock hold each; a batch runs the eight (condition, rate) runs back to back, as is and slowed alternating which goes first. 48 runs in all.

All 48 runs passed (the probe asserts only that frames were recorded). The box's load average was 1.2 to 3.9 between batches from the other helpers' work; inside a batch the lock kept them out.

## The table

Median [range] of 6 runs per condition, in ms. "load" and "slowed" are each median's move from as is, idle. The last column: whether one bound could pass every as-is run (idle and loaded) and fail every slowed run, and by how much the two sets miss or overlap.

| case | measure | as is, idle | as is, loaded | slowed, idle | slowed, loaded | load | slowed | one bound? |
|---|---|---|---|---|---|---|---|---|
| fight turn | frame gap, 4x (today) | 50 [50-100] | 66.7 [50-100] | 100 [83-117] | 100 [83-117] | +16.7 | +50 | overlap 16.6 |
| | tap, 4x (today) | 56.7 [51-75] | 67.7 [46-87] | 64 [53-70] | 60.3 [57-85] | +11 | +7.3 | overlap 34.5 |
| | longest long task, 4x | 0 [0-61] | 28 [0-77] | 74 [69-88] | 81.5 [70-108] | +28 | +74 | overlap 8 |
| | longest task, CPU, 1x | 10.1 [8.2-11.7] | 8.4 [7.8-11.9] | 16.8 [14.9-21] | 15.6 [14.2-19.1] | -1.7 | +6.7 | split, 2.3 clear |
| | all tasks' CPU, 1x | 137.5 [133-150] | 116.2 [103-156] | 146.2 [138-166] | 127.7 [127-159] | -21.3 | +8.8 | overlap 29 |
| watching the GM | frame gap, 4x (today) | 16.8 [17-33] | 25.1 [17-67] | 50 [50-100] | 50.1 [50-100] | +8.3 | +33.2 | overlap 16.8 |
| | longest task, CPU, 1x (both phones, see limits) | 8.2 [7.4-13.7] | 8 [7.3-13.2] | 14 [13.2-18.9] | 14.7 [11.7-25.7] | -0.2 | +5.8 | overlap 2 |
| maker opening (control) | frame gap, 4x (today) | 33.4 [33-67] | 41.7 [17-67] | 33.4 [33-33] | 33.4 [33-50] | +8.3 | 0 | |
| | tap, 4x (today) | 62.1 [56-94] | 60.2 [33-67] | 63 [54-68] | 64.7 [59-80] | -1.9 | +0.9 | |
| | longest task, CPU, 1x | 10.9 [9-11.5] | 9.5 [9.1-17.9] | 10.1 [9.2-11.3] | 10.6 [8.5-13.2] | -1.4 | -0.8 | |
| sheet scroll (control) | frame gap, 4x (today) | 16.8 [17-83] | 16.8 [17-17] | 16.8 [17-17] | 16.8 [17-50] | 0 | 0 | |
| | longest task, CPU, 1x | 1.2 [0.9-1.3] | 1.1 [0.9-1.3] | 1.2 [0.9-7.3] | 1 [0.9-1.3] | -0.1 | +0.1 | |
| map pan and pinch (control) | frame gap, 4x (today) | 16.8 [17-33] | 16.8 [17-33] | 16.8 [17-17] | 16.8 [17-50] | 0 | 0 | |
| | longest task, CPU, 1x | 3.3 [3.2-3.5] | 3.5 [3-3.8] | 3.5 [2.8-4.6] | 3.1 [3-3.5] | +0.2 | +0.2 | |
| map ability picked (control) | frame gap, 4x (today) | 16.8 [17-50] | 33.3 [17-33] | 25 [17-33] | 25 [17-50] | +16.5 | +8.3 | |
| | longest task, CPU, 1x | 3.5 [2.5-3.9] | 3.4 [2.6-4.6] | 3.7 [3.1-6.8] | 3.6 [2.8-4.6] | -0.1 | +0.2 | |
| map use | frame gap, 4x (today) | 66.7 [50-83] | 75 [50-100] | 100 [67-233] | 83.3 [67-167] | +8.3 | +33.3 | overlap 33.3 |
| | longest long task, 4x | 62.5 [0-69] | 59 [0-72] | 91 [73-155] | 77 [71-134] | -3.5 | +28.5 | overlap 1 |
| | longest task, CPU, 1x | 10.7 [9.7-20.4] | 10.3 [8.9-10.7] | 19.8 [17.3-38.6] | 17.7 [17.2-18.5] | -0.4 | +9.1 | overlap 3.2 |
| odds (control) | frame gap, 4x (today) | 16.8 [17-17] | 33.4 [17-67] | 16.8 [17-33] | 33.4 [33-67] | +16.6 | 0 | |
| | longest task, CPU, 1x | 4.9 [3.8-6] | 4.5 [4-5.9] | 4.7 [4.1-5.2] | 5.4 [3.1-7.3] | -0.4 | -0.1 | |

The longest task's wall time at 1x moved as its CPU time did, within 1 ms at the median, but its worst runs under load rose (the pan and pinch 3.9 to 14.8 ms, the odds 8.6 to 13.5 ms). The tap at 1x was 8 to 63 ms in every condition and moved with neither. The frame gap at 1x was one frame in 94 of the 96 traced case runs and two frames in the other two (both slowed).

Today's test with its bounds, on the 4x runs: as is, 1 of 6 idle runs failed (the sheet scroll, one 83 ms gap) and 1 of 6 loaded runs (the player watching and the odds). Slowed, 4 of 6 idle runs and 3 of 6 loaded runs failed. So today it catches this slowdown 7 times in 12 and fails the app as it is 2 times in 12.

## What it says

- Today's frame gap moves with the host. Under load the medians rose by up to 16.7 ms (one frame) and the worst runs by up to 50 ms in a case the slowdown does not touch (the odds, 17 ms in all six idle runs and up to 67 ms loaded). In the three slowed cases the load's move is a third to a quarter of the slowdown's, and no bound splits as is from slowed in any of them.
- The longest task's CPU time at 1x does not move with the host: under load every case's median stayed within -1.7 and +0.2 ms of idle (most fell, by up to 17%; why is not known: fewer or merged tasks under load is a guess). It does move with the app: +6.7, +5.8 and +9.1 ms in the three slowed cases, near the loop's 7.4 ms, and under 1 ms in the five controls. In the fight turn one bound splits all 12 as-is runs from all 12 slowed runs.
- What limits it: single long tasks that come and go with no load. The map use as is had one task of 20.4 ms (10.4 ms of it layout) where the other 11 runs had 8.9 to 14.7; the maker had one of 17.9 ms (14.5 of it the click's script) against 9 to 11.5. These are the page's own work, so a bound must sit above them; it then misses part of a slowdown as small as this one (7 ms at 1x, about 30 ms at 4x).
- Host steal does not reach it either, as far as the kernel says: this kernel has `CONFIG_PARAVIRT_TIME_ACCOUNTING=y` and reports steal in `/proc/stat`, so a thread's CPU clock leaves out the time the host held the vCPU. Not tested by a run.

## Limits

- The load was four busy loops inside the guest. The nights that failed were not reproduced, and what loaded the box then is not known; host steal is covered only by the kernel's accounting above.
- The watching case's trace held both phones' renderers (the GM's page is in the same browser): its CPU column counts the GM's own click task (11.5 to 13.7 ms in 4 of 12 as-is runs) beside the player's redraw. The test built in part 2 reads only the measured page's renderer.
- The CPU candidate was traced; today's measures were not. Tracing's own cost is in every CPU number and is the same in every condition.
- Six runs per condition, one box, one boot.

## The answer

Yes, for the longest task's CPU time at 1x: it holds still under host load and moves when the app does, which today's wall-clock gap at 4x does not do. Thread CPU time at 4x is no candidate (the throttle is in it). The sum of all tasks' CPU moves with load (down by 21 to 37 ms) and with the test's own polling, so it is no candidate. Long tasks from `PerformanceObserver` are wall time at 4x and moved with load (+28 ms in the fight turn).

Part 2 builds the first: each case at 1x, traced, bound on its longest task's CPU time, and the wall-clock frame gap and tap kept at 1x as a looser second check.

# Part 2: the test built on it

20 November 2026. A second helper took over the unit after the first was stopped. Branch `lag-measure` merged with `claude/nifty-keller-3nvune` at 0b6de47 (the app now has that branch's changes to `src/views/map.js` and `src/views/detail.js`), and `lag-measure-slowed` merged with it in turn, so the slowed app is the same app plus the same loop.

## Part 1's table, checked before building on it

It supports its answer for the longest task's CPU time at 1x: under load every median moved by -1.7 to +0.2 ms, and with the slowed redraw the three cases that redraw the fight moved by +5.8 to +9.1 ms while the five controls moved by under 1 ms. Only the fight turn splits cleanly (2.3 ms clear); the watching case overlapped by 2 ms with the GM's page in its trace, and the map use by 3.2 ms from one 20.4 ms task. So the measure is sound and a bound on it catches a slowdown of about this size only in part.

## The first helper's last edit (9054b26), judged

- The two frames waited after the act: kept. The redraw a tap asks for runs in the next animation frame, so a window closed as soon as the store changed could miss it. It waits on frames, not on a timer.
- A task names the last tap marked before its end, not before its start: kept. The tap's mark is made inside the click task, so it falls after the task's start; before the fix the task of the tap was named after the tap before it.
- Its bounds cited "12 runs of this test" that were in its scratchpad only, taken before the merge. Replaced by the 18 runs below.
- It left a loop of its own runs going (`runs.sh`, slowed and idle) after it stopped. It held the lock between my batches and ran on the slowed worktree after my merge; its numbers are not used here.

## One change to the message

The frame gap and the tap now carry the tap before them too (`Timed` in the recorder), so all three checks say which tap. A synthetic scroll's touch is a pointerdown, so the sheet case names the button under the finger where the scroll began.

# Part 3: the merge, the final runs, the slowed app

20 November 2026, a third helper. Same box type (4 vCPUs, `Intel(R) Xeon(R) Processor @ 2.10GHz`), port 3261, every run under `flock /tmp/box.lock`, `E2E_CHROMIUM=/opt/google/chrome/chrome`, `--workers=1 --output=/tmp/pw-lag`. Idle and loaded as in part 1: idle is the lock held and nothing else running; loaded is four `bun -e 'for(;;){}'` loops, one per CPU, started a second before the run inside the same lock hold and killed after it.

## The merge

`claude/festive-fermat-tvpykj` (72 commits) merged at c4d669b. One conflict, the CI paragraph of `docs/guide/tests-ci.md`: the working branch's paragraph (the public repository's unit and browser runs, the two variables) with this branch's sentences on what the lag test bounds put in place of "because it times frames and must have the machine to itself". `scripts/ci.ts` merged on its own. The typecheck passed.

## The merge did not move the numbers; the box did

The first twelve runs of the merged app (before the change below) failed 2 of 6 loaded runs and 0 of 6 idle: the ability picked on the map at 6.8 ms (bound 6) and the pan and pinch at 5.1 ms (bound 5). Every case's median sat 30 to 50% above the medians the bounds came from (the fight turn 11.0 against 8.3, the player watching 4.5 against 3.2, the odds 6.0 against 4.0), the controls the merge does not touch included.

To tell the merge from the box, the same test was run idle on three trees, alternating, three runs each: the app the bounds were measured on (c034f55, with this test copied in), the app before the merge (b18a899) and the merged app. Longest task, ms of CPU, median [range]:

| case | c034f55 | b18a899 | merged |
|---|---|---|---|
| fight turn | 11.7 [11.2-12.8] | 13.2 [11.4-20.7] | 12 [10.3-13.9] |
| player watching | 5.2 [5.1-5.3] | 4.8 [4.2-6.1] | 4.7 [4.7-5.6] |
| maker | 12 [11.6-15.3] | 11.9 [11.3-16.6] | 11.4 [10.4-14.9] |
| sheet scroll | 2.9 [2.9-3.2] | 3.1 [3-3.2] | 2.3 [2.2-3.1] |
| pan and pinch | 4.4 [3.9-5.3] | 4.2 [4.1-5.9] | 5.6 [4.2-6.1] |
| ability picked | 3.2 [3.1-5.9] | 4.2 [3.8-4.4] | 5.3 [3.5-5.6] |
| map use | 16.8 [12.4-16.9] | 14.1 [12.1-21] | 12.6 [11.8-13.5] |
| odds | 5.5 [5.4-6.5] | 6.9 [6.2-7.4] | 6.8 [5.5-7.3] |

The three trees overlap in every case, and the app of 19 November fails its own bounds on this box (the pan and pinch at 5.3). So the merge's new map mount moved nothing this test can see; the box of 20 November runs the same app 30 to 60% slower in CPU time than the box of 19 November. The bounds' comment already said they are the box's; this is that case. What a CPU-time measure holds still against is load inside the guest; a slower host, or a host whose other tenants slow every cycle, moves it. One run of b18a899 shows the second kind: every task of its fight turn ran about 1.6 times its usual CPU (the redraw 20.7 ms against 11 to 13, the click 17.9 against 8 to 9) with the box idle and the lock held. The kernel's steal accounting leaves out time the vCPU was off the core, not slower cycles while it is on (inferred; not measured).

## The harness's own read was in the window

A check run with the new bounds failed the player watching at 7.4 ms, a task whose traced parts were `FunctionCall(s) 0.1, FunctionCall(b) 0.1`. Two runs of that case with the `v8`, `toplevel` and `mojom` categories added, and two with `FEEL_PROFILE=1`, showed two kinds of task with almost nothing traced inside: a `Receive mojo message` task running the app's room message (`apply`, `emit`, `update` of the bundle, 4 to 5 ms under the profiler) and one running Playwright's `evaluate`, `serialize` and `jsonValue`, the copy of the recorder's frames out of the page (355 frames in this case, the most of any). The window had a start mark and no end, so every task after `feel-start` counted, the harness's read included. The window now closes with a `feel-end` mark in a task of its own, and only tasks that end before it count.

What that changed, counted over the runs before and after: the tasks with no traced event at all (the read) were the sheet scroll's longest task in all 12 runs before (2.1 to 3.5 ms) and in none after (its longest is a timer's again, 1.1 to 1.6 ms, as on 19 November); in the player watching there were 12 of them before (3.4 to 5.0 ms) and none after. The tasks traced as `FunctionCall(s)` and `FunctionCall(b)` stayed (3.4 to 5.2 ms in the watching case after the fix): they are the app's receipt of the GM's message (inferred from the profile, which put the app's room code in a run of that size; not traced to the line). So the 7.4 ms that failed the check run was most likely the app's own, not the harness's, and the twelve final runs did not see one that long (their worst in that case is 6.3). A smaller harness cost stays in the window: Playwright's waits poll the page inside the act (`v8.callFunction` of 1 to 1.7 ms inside a frame's task in those runs).

## The slowed app

`lag-measure-slowed` was not on the remote, so it was made again as part 1 describes, in a throwaway worktree: a local branch from the merge (d25b20e) adds a loop of 1.2 million integer steps (`x = (x * 31 + i) | 0`, its result kept on `window` so it cannot be dropped) at the top of `scheduleUpdate`'s frame in `src/app.js` while the fight view shows, then merged this branch's test (12467a0). Never merged back. Three runs, idle, with the bounds of the final runs (the watching's at 8 then; at 10 now, which changes no result below).

| case | as is, the final 12 | slowed, 3 runs | slowed runs past the bound |
|---|---|---|---|
| fight turn (bound 21) | 13.0 [8.8-16.2] | 20.9 [16.6-23.7] | 1 of 3 |
| player watching (bound 10) | 4.55 [4.1-6.3] | 12.7 [12.3-13.5] | 3 of 3 |
| map use (bound 26) | 13.9 [10.7-16.4] | 23.0 [18.7-24.9] | 0 of 3 |
| the five controls | | each inside its as-is range | 0 |

All three slowed runs failed, each on the player watching; the second also on the fight turn. The loop's cost on this box, read from the medians, is about 8 ms of CPU (the watching +8.2, the fight +7.9, the map use +9.1); on 19 November it was 7.4 ms (part 1). The failures say where: the fight turn's reads `longest task 23.7 ms CPU (bound 21) ... 23.7 ms CPU (24.3 ms wall) after the tap on button "Next turn": FireAnimationFrame 18.3, FunctionCall(app.js:2172:9260) 18 ...`, the redraw's frame callback after the named tap. The watching case names no tap, because the player taps nothing (`after no tap on this page yet`); its task is the same frame callback (`FireAnimationFrame 9.3, FunctionCall(app.js:2172:9260) 9.1`).

So on this box the measure catches an 8 ms slowdown of the fight's redraw every time in the player watching, where the as-is spread is 2.2 ms wide, and only now and then in the fight turn and the map use, where the as-is spread (7.4 and 5.7 ms) is as wide as the slowdown and the bound sits a quarter above its top. The frame gap and the tap moved with neither (every slowed window held one frame but one sheet scroll at three; the taps 8.8 to 42.9 ms).

## The final twelve runs

The merged app with the window closed at `feel-end` (the test of f8f3e70, whose bounds were still the first guesses then; a bound changes no number). Six idle and six loaded, alternating idle first, 09:44 to 09:53, one lock hold each. Longest task in ms of CPU, median [range]; the frame gap in 60 Hz frames, the windows of two and of three or more out of 48 per condition; the slowest tap in ms.

| case | idle, task | loaded, task | bound | idle, tap | loaded, tap |
|---|---|---|---|---|---|
| fight turn | 14.35 [11.1-16.2] | 9.4 [8.8-13.3] | 21 | 42.2 [40.5-44.1] | 43.2 [38.5-60] |
| player watching | 5.2 [4.3-6.2] | 4.4 [4.1-6.3] | 10 | none | none |
| maker | 14.95 [11.8-16.4] | 10.9 [10.5-14.3] | 23 | 28.6 [26.9-31] | 29.1 [24.7-35.1] |
| sheet scroll | 1.3 [1.1-1.5] | 1.35 [1.1-1.6] | 4 | 8.7 [8.2-8.9] | 8.7 [8.4-9.2] |
| pan and pinch | 5.3 [4.4-7.7] | 5.8 [4-8.5] | 11 | 16.3 [15.2-17.7] | 11.6 [8.8-16.9] |
| ability picked | 6.3 [3-7.1] | 5.45 [3.8-6.8] | 9 | 28 [27.4-31.2] | 28.5 [24.9-29.6] |
| map use | 14.1 [12.7-15.8] | 13.3 [10.7-16.4] | 26 | 28.1 [27.6-28.4] | 27.8 [25.4-32.8] |
| odds | 6.35 [5.4-7.4] | 6.55 [5.4-8.7] | 11 | 27.1 [25.8-28.1] | 26 [17.5-30.8] |
| frame gaps of 2, of 3 | 5, 1 | 3, 1 | 3 frames | | |

Against the bounds they ran with (the first guesses: pan and pinch 7), 1 of 6 idle runs and 1 of 6 loaded runs failed, both on the pan and pinch (7.7 and 8.5). Against the bounds now in the file, none fails, by construction. The bounds were also checked against the runs not used to set them: the twelve before the window fix and six more idle runs of the merged app (their numbers can only be higher, the harness's read being in them) all fall inside, the closest being the sheet scroll at 3.5 against 4 (the harness's read, before the fix) and the ability picked at 6.8 against 9.

Load moved nothing the spread does not already hold: four busy loops left every case's task inside its idle range or lowered it (the fight turn's median fell from 14.35 to 9.4; part 1 saw the same fall, cause not known), and the long frame gaps were no more common loaded (3 windows of two frames, 1 of three) than idle (5 and 1). The one tap past 45 ms (60 ms) was loaded.

## Each bound and its reason

The rule is part 2's: the worst of the twelve plus a quarter, rounded up, never under 4. Each bound's comment in `TASK_MS` carries the same.

- fight 15 to 21: worst 16.2, and the spread is 8.8 to 16.2 for the same app. Not the merge: the app of 19 November gave 11.2 to 12.8 and the app before the merge 11.4 to 20.7 on this box.
- watch 6 to 10: worst 6.3 gives 8; kept at 10 for a 7.4 ms receipt of the GM's message in a check run, the app's own (above). The slowed app's 12.3 to 13.5 still fails it every time.
- maker 23, kept: the rule gives 21, under the 17.9 of 19 November plus its quarter.
- scroll 4, kept: worst 1.6 once the harness's read left the window; 4 is the floor.
- pan and pinch 5 to 11: worst 8.5, best 4.0. Its longest task is the frame after the pan's first move, restyling 67 to 69 elements of the map (`UpdateLayoutTree(69 elements)` 2.7 to 2.9 ms in the two worst). It was 3.9 to 5.9 on the apps before the merge too, so it is not the merge's mount. Why one pan restyles 69 elements is not found: the `panning` class the map puts on its frame at a pan's start is the guess.
- ability picked 6 to 9: worst 7.1. The pick's own script at the lift (2.6 to 5.1 ms, `FunctionCall(app.js:1148:6189)`, the map's pointerup) and the tap's pointerdown fall in one task, or the frame's restyle of about 48 elements lands in the same task when the lift comes as a frame is due. Not the merge either: the app of 19 November reached 5.9.
- map use 26, kept: the rule gives 21, under the 20.4 of 19 November and the 21.0 of the app before the merge on this box.
- odds 8 to 11: worst 8.7.
- FRAMES 3 and TAP_MS 100, kept. Two windows of the twelve runs held three frames (the sheet scroll idle, after its scroll; the pan and pinch loaded) and one of the six check runs (the map use, idle). That is at the bound, idle as often as loaded: the wall-clock check is the one that can still fail a good push, and when it does the message names the window and the tap before the gap.

## What the test no longer catches

- A slowdown of the fight's redraw of about 8 ms of CPU (about 32 ms on the phone it stands for) in the fight turn and the map use, most of the time: their as-is spread on this box is as wide as the slowdown. It catches it every time in the player watching. Part 1 said the same of 19 November's box at 7 ms; this box's wider spread makes it so for the fight turn as well.
- A slower app that only shows on the wall clock at 4x: the test runs at 1x. The phone's four times slower CPU is in the bounds' comments, not in the run.
- Not a loss, but a limit: the measure holds still against load inside the box, not against the box. The same app ran 30 to 60% slower in CPU here than on the box of 19 November, and single cases ran about 1.5 times their usual CPU with the box idle. A bound set on one boot can fail the next. What could hold still against that is a fixed piece of work timed in the same page at the window's start, with each bound a multiple of it; that is a guess and was not tried.

## The rule that the lag test runs alone

Kept, with its reason changed in `scripts/ci.ts`, `playwright.config.ts` and `docs/guide/tests-ci.md`. The loaded runs show that load from busy loops moves neither check, so "it times frames and a second worker's load would be what it measured" is no longer what the runs say. They do not show what a second browser worker does beside it (a GPU process, compositors and a server, not four loops), and that was not run. The reason that stands on its own: the bounds are this box's, so the lag test cannot go with the browser pass to the public runners, and runs here after it.

## Left as found

- The pan and pinch's restyle of about 69 elements and the pick's 3 to 5 ms of script at the lift are the app's, in the map, before and after the merge; both are where a phone would feel the map first.
- The three-frame gaps at the bound (above).
- The throwaway worktrees `/home/user/wt-lag-slowed` (branch `lag-measure-slowed`, local only), `/home/user/wt-lag-pre` (b18a899, its test edited to probe) and `/home/user/wt-lag-c034` (c034f55 with this test copied in) are removed at the end of this part; the slowed branch is kept so the proof can be rerun.
