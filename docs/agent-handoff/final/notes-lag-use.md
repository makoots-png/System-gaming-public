UNIT lag-use DONE at 25cce71 (notes only: no app code changed; the premise did not hold)

# A use from the map got slower in push 43: profiled

Started 2026-11-16 07:25 UTC at d23120b on `claude/zen-pasteur-ov4cgd`, main tree, alone on the box.

Goal (the owner): "I want it perfect, I do not care about time." "For all things we must fix the problem and not the symptoms." The problem as the brief states it: before push 43 the lag test's "a use from the map" held 50 ms with no long task; at push 43 it reads 50 to 100 ms with a long task of 52 to 88 ms. The smallest change expected: find what push 43 made the use's task do that it did not do before and do it once. The evidence below rules that change out. Push 43 did not make the use slower. 5cb20ee and d23120b measure the same when they are run interleaved on the same box. The rest of this file is the evidence, then what fills the long task and whether any of it can go.

Principles read in full this session: fix-root-causes, explain-the-number (with benchmark-checklist), prove-it-works, sequence-verifiable-units. Explain-the-number changed the plan. I ran the two commits interleaved before I read any profile for a cause, and that run refuted the premise. Fix-root-causes kept me from a guard. With no added cost to remove, I changed no app code.

## Method

All scripts and artifacts are in the scratch dir `/tmp/claude-0/-home-user-systemgaming/92775296-016c-5fb1-b771-04765cc647d8/scratchpad/helper2` (not in the repo):
- `base/` was a `git worktree` at 5cb20ee with `node_modules` linked from the main tree. It was removed after the runs.
- `spec.template.ts` is the lag test's map case as a throwaway Playwright file: the same fight, twenty tokens, the same walls, zones and fog, an ability picked at 4x, then the Use. It wraps only the rat tap and Use in CDP `Profiler.start` (100 µs sampling). Optional switches: `TRACE` (a devtools timeline trace), `ALLOC` (the sampling heap profiler, with objects freed by either GC kept), `NOPROF`, and `EXPER=nohas`. The file is generated per tree (`spec-head/`, `spec-base/`) and run by `pw.config.ts` on port 3218 with one worker.
- `dump-build.ts` writes each tree's `app.js` and `app.js.map` as `buildApp()` makes them. The analysers map the minified frames back to source lines through it:
  - `analyze.ts` reads one profile.
  - `compare.ts` gives the median per function over runs, base against head.
  - `tasks.ts` gives a trace's long tasks, what the trace says filled each one, and the profile samples inside each.
  - `styles.ts` gives the style, layout and paint inside each long task.
  - `gc.ts` finds the GCs inside the long tasks.
  - `alloc.ts` gives the bytes allocated per function.
- Load before the runs was 0.6 to 1.0 on 4 cores. Nothing else ran.

## 1. The two commits interleaved, without a profiler

The real lag test file of each tree (`-g "twenty tokens"`), alternating head and base, six of each, port 3218, one worker:

| Run | d23120b (head) worst, long tasks | 5cb20ee (base) worst, long tasks |
|---|---|---|
| 1 | 50, [54] | 116.7, [95, 58] (failed the 6-frame limit) |
| 2 | 50, [50] | 83.4, [68] |
| 3 | 50, [] | 66.6, [65] |
| 4 | 50, [] | 50, [52] |
| 5 | 49.9, [] | 49.9, [50] |
| 6 | 66.6, [51] | 50, [] |

Head had a median of 50 and a worst of 66.6, with 3 of 6 runs carrying a long task (50 to 54). Base had a median of 58 and a worst of 116.7, with 5 of 6 runs carrying a long task (50 to 95). Base is not better, and in this sample it is worse. The lead's table measured each commit at a different time, one after another. This box's speed swings by about 2x from run to run (section 2 shows it), so those numbers were noise around a task near 50 ms, as the brief suspected. They were not a trend over the commits.

## 2. CPU profiles, five of each, alternating

Inclusive time per function over the whole use (all tasks), at 4x. Each cell is the median of 5 runs per side. Functions are matched by source text, because line numbers moved between the commits. Profiling slows the page, so these runs had long tasks on both sides (head [], [66, 65], [56, 76], [], [99]; base [57], [62, 66, 50], [], [], [75]).

| Function | base | head |
|---|---|---|
| map.js pointerup, then `act`, then combat.js `useAt` (the command's task) | 27.4 | 39.7 |
| fight.ts `reduce` | 17.1 | 24.3 |
| fight.ts `act` | 14.9 | 20.5 |
| store.ts `apply` | 8.2 | 11.6 |
| combat.js `render` (the next frame) | 19.7 | 19.1 |
| map.js `draw` | 29.4 | 25.5 |
| `(program)` (style, layout, paint and the browser's own work) | 323 | 317 |

The medians hide a box that runs at two speeds. Per run:
- `reduce`, base: 34.2, 17.1, 17.0, 17.7, 15.4.
- `reduce`, head: 16.0, 36.7, 25.0, 24.3, 17.2.
- map.js `act`, base: 56.8, 27.9, 28.7, 30.3, 26.8.
- map.js `act`, head: 28.4, 57.8, 48.8, 42.5, 29.1.

In a slow run every function is about twice as slow at once: base run 1 and head runs 2 to 4. In the runs where the box ran fast (base 2 to 5, head 1 and 5), the command's task is 27 to 30 ms on both sides. No function is present at head and absent at base, and none doubles on its own. The candidates the brief named are all small at head:

| Candidate | Head cost (ms, 4x) |
|---|---|
| `formulaOf` (M2) | 0.7 |
| `ticksOf` (M2) | 0.7 |
| `itemSpent` (N16) | 0.1 |
| `holderHunter` (C3) | not in any sample |
| refusal words (C5) | not in any sample |

Self time: the only steady difference is `(garbage collector)`, with base 0, 0.2, 0, 3.1, 3.1 and head 4.7, 2.8, 3.7, 5.7, 2.7. I checked whether head allocates more:
- Sampling heap profiler, 3 runs per side: base allocates 1705, 1665 and 1670 KB per use, head 1625, 1794 and 1752 KB. The difference is within the spread.
- No function allocates much more at head. The largest is map-view.ts `outline` at 197 against 243 KB, and both sides draw the same shades.
- A minor GC of 3.1 to 3.7 ms fell inside the long task in 2 of the 9 traces, one of them on a head run and one on a head run with the profiler off.

A scavenge runs when the young space fills, so whether one lands in the use's window depends on what was allocated before it. It is chance, not new work.

## 3. What fills the use's long task (both commits alike)

These are timeline traces of the same use, three per side, plus three at head with the profiler off. They show three tasks after the tap:

1. The Use's pointerup task: 26 to 43 ms traced. The command runs here: map.js `act` calls `src.use`, combat.js `useAt` calls `send`, `reduce` takes about 17 (fight.ts `act` 17, of which `after` 7, `startTurn` 4, `grounded` 3.5, `zoneSync` 3), and `store.apply` takes about 9 (of which `repairSave` 4.7 is the save repaired after every write).
2. The next frame: 54 to 63 ms traced at head and 57 to 85 at base. This is the long task the lag test sees.
   - `FireAnimationFrame` takes 23 to 34 ms. Inside it, app.js runs combat.js `render` (23), and almost all of that is map.js `draw` (21).
   - `draw` is spread over a dozen parts: `drawTokens` 8 (`bind` 6 over twenty tokens whose classes all change when the aim ends and the turn passes), `drawHotbar` 2.5, `drawNow` 2.3, `mapScene` 1.8, `drawLines` 1.4. The motions it starts (the rising number, `fillTo`, `play`, `animate`) take about 5.
   - After the script come style recalc 9 to 11 ms (about 98 elements), layout 4 to 8 ms (84 of about 370 objects dirty), paint 4 to 11 ms, and layerize plus commit about 5.
3. The frame after: 30 to 42 ms. combat.js `afterFrame` (the bursts) takes about 12, then style for 36 elements takes 6 to 12.

Ruled out:
- The page's 23 `:has()` rules. With every one deleted through the CSSOM before the Use (`EXPER=nohas`, 3 runs against 3), the next frame's style recalc was 7.4 to 8.8 ms against 9.5 to 14 ms. The long task was 53 to 56 against 54 to 63 traced. That is a ms or two at most, and it would cost the layouts those rules make.
- A second draw. `draw` runs once in the frame (`redrawSoon` checks `draws`).

## 4. Can it go

The task sat at 45 to 55 ms before the push and still does. Its largest part is the browser's style, layout and paint of the turn passing: about 30 ms of the frame traced, for about 98 restyled elements. Every token's class changes when the aim ends and the next row takes its turn, the hotbar and the turn line change to the next row's, and the target's number rises. Next is the map's draw, about 21 ms, spread over twelve draws with no part above 8 ms. Each part draws a change the GM must see in that frame. I found no work whose result nothing uses (mantra 1) and no work done twice (mantra 2), so I made no second fix. Getting clear of the frame boundary would take a redesign of what a turn change redraws, or a cheaper stylesheet per element (about 100 µs per element at 4x). Neither is a cost the push added, and I judged neither in scope for this unit. Two leads for a later unit, both the same at both commits:
- `store.apply` repairs the whole save after every write (`repairSave`, 4.7 ms of the command's task). That repairs internal state the types already hold, which boundary-discipline says belongs at load. The cost sits in the command's task, not the long frame.
- `mapScene` allocates about 400 KB per use (`outline` 200 KB). That is GC pressure that sometimes lands a 3 ms scavenge in the frame.

## 5. Five runs of the whole lag test at d23120b (alone, port 3218, one worker)

```
[feel] a use from the map cpu=4x frames=65 median=16.7 worst=66.7 taps=2 worstTap=50.5 longtasks=[51]
[feel] a use from the map cpu=4x frames=63 median=16.7 worst=50.1 taps=2 worstTap=45.1 longtasks=[50]
[feel] a use from the map cpu=4x frames=65 median=16.7 worst=66.7 taps=2 worstTap=43.9 longtasks=[]
[feel] a use from the map cpu=4x frames=65 median=16.7 worst=100 taps=2 worstTap=69.6 longtasks=[82]
[feel] a use from the map cpu=4x frames=66 median=16.7 worst=50.1 taps=2 worstTap=50.5 longtasks=[50]
```
All five runs passed all five tests. Each run printed `5 passed`, in 39.0 to 40.1 s.

## Checks
25cce71 (the lead's handoff commit, made while I worked) changes only `docs/agent-handoff/handoff.md`, so the app I measured at d23120b is the app at 25cce71.
- `bun run test` (typecheck, then bun test) at 25cce71: `Ran 3506 tests across 92 files.` 0 fail, 3 skip.
- The browser files: no app file changed in this unit, so they run once, at the close of the held-statuses unit, over both units together (`notes-close-audit.md`).

## Verdict

No measurable regression. Over 6 interleaved runs per side, head had a median of 50 ms and a worst of 66.6, and 5cb20ee had a median of 58 and a worst of 116.7. Profiles show the same three tasks with the same functions and the same allocation, about 1.7 MB per use. The limiter is the frame after the command: the map's redraw of a turn passing, plus the browser's style, layout and paint, about 50 ms at 4x on this box. Its spread comes from the box's 2x swings in speed and from a scavenge that sometimes lands in the window. No app code changed.
