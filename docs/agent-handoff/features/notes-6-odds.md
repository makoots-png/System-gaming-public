# Notes: feature 6, how hard is this fight (the odds engine)

Status: step 1 written. Steps 2 to 5 follow, each with its own commit.

## The goal, the problem, the smallest change

A GM building a fight cannot tell how hard it is: abilities are weighed against a budget, a fight against nothing, so the
first sign of a wipe is the wipe. The smallest change: one pure engine in core that plays the fight as it stands many
times on the real `reduce`, with seeded dice and one sensible policy for every row, and answers the odds; one control on
the GM's fight screen that runs it a few commands a frame with its count shown, then one line and its detail. The tests'
simulator stops having its own loop and plays on the engine's.

## Measurements (before any code)

The fight-sim's `playFight` (the loop the engine lifts), its own builds, rank C, seeds 1 to n. Chromium from
`/opt/pw-browsers/chromium`, the module bundled by `Bun.build` and timed in the page; throttle by CDP
`Emulation.setCPUThrottlingRate`. Script: scratchpad `helper5/measure.ts` and `browser.ts` (not committed).

| Fight | Where | ms per fight | Runs | Party wins | Mean rounds |
|---|---|---|---|---|---|
| small: tank and cannon against 3 normal monsters (brute, skirmisher, caster) | bun, no throttle | 13.7 | 50 | 30 of 50 | 6.1 |
| large: tank, blood, pain, summoner, support against 8 monsters (an elite brute, the rest normal) | bun, no throttle | 41.4 | 20 | 13 of 20 | 8.4 |
| small | Chromium, 1x | 9.5 | 30 | 17 of 30 | 6.2 |
| large | Chromium, 1x | 31.7 | 10 | 5 of 10 | 8.0 |
| small | Chromium, 4x | 21.6 | 30 | 17 of 30 | 6.2 |
| large | Chromium, 4x | 101.7 | 10 | 5 of 10 | 8.0 |

The sim's loop also calls `resolve` a second time per use for its tallies, so the engine (which keeps no tallies) is at
most this cost. What limits it: the reducer itself (each command copies the fight and runs every rule); nothing waits on
I/O. A large fight is about 100 turns, so about 1 ms a command at 4x.

What it decides: a large fight at 4x takes six frames on its own, so **a step cannot be a whole fight**. A step is a
number of commands, and the play in progress (the fight, the dice source's state, who went down) is part of the run's
state. The view calls `oddsStep` while its frame budget lasts (8 ms of a 16.7 ms frame, read from the clock in the view,
since core has no clock), then yields to the next frame. One command at about 1 ms fits a frame many times over, so no
worker thread: a worker would also need its own bundle and a message protocol, for nothing the numbers ask for.

The count: **100 fights**. A share p over n runs has a standard error of sqrt(p(1 - p)/n): at worst (p = 0.5) 0.05 at
n = 100, 0.035 at 200. The line rounds to whole percent but says "of 100 fights", so a reader knows how firm it is. 100
large fights at 4x are about 10 s of work, spread over frames at half a frame each about 20 s; at 1x on a laptop about
3 s. 200 would double that for 1.5 points of error; the GM can run it again for another sample.

## The answer's type (named before code)

```ts
type Outcome = 'won' | 'lost' | 'stalled';          // the party won; the foe side won; the time cap with both up
type RowEnd = { hp: number; mana: number; fatigue: number; down: boolean; dead: boolean };
type End = { outcome: Outcome; rounds: number; party: Record<CombatantId, RowEnd> };   // one played fight
type Odds = { of: number; ends: readonly End[]; rows: readonly { id, name, hpMax }[] }  // every played fight kept
type Spread = { low: number; mid: number; high: number }                               // 10th, 50th, 90th percentile
type OddsRead = { of; won; lost; stalled (shares); rounds: Spread; party: { id, name, down share, dead share, hp/mana/fatigue Spread }[] }
```

`Odds` keeps every run's end (100 runs of 5 rows is 500 small records), and `readOdds` works out the shares and spreads
from them. A stalemate (the time cap, 40 rounds, as the sim's) is its own outcome, never a win or a loss.

What feature 2 needs: a solo run resolves in one step and pays a cost (HP, mana and fatigue spent, down, dead) drawn from
one run. That is the engine on one hunter and a gate's monsters with `of: 1` and a seed from the edge: `ends[0].party[id]`
is the cost and `ends[0].outcome` the result. Or it plays 100 and picks one run by a second draw so the cost matches the
odds shown; either way the type holds it, since every run's end is kept. `RowEnd.dead` comes from death saves through
`lifeAfter` (the life machine), as the sim does, so a solo death uses the same machine.

## The policy: three variants weighed

1. **One general policy** that reads the row: its abilities, their kinds, costs, cooldowns, reach, gates and prices
   (through `ready`, rules 2 to 5, so legality is the reducer's own check), heal or shield the most hurt ally under half
   HP, else the strongest damaging ability it may use on the nearest foe (the taunter while taunted), else a status it
   would put on that the foe lacks, else a step toward. A monster plays by its intent when it may, else on the target
   `threatOf` suggests (the GM's card's rule, read and not copied).
2. **A policy per ability kind, composed**: a table from kind (strike, shot, blast, curse, support) to a scorer, each
   row choosing among its own abilities and the best score winning. It reads well but scores across kinds are not
   comparable without inventing a value scale, which is an optimizer by another name.
3. **The tests' archetype policies kept, and one general policy beside them.** The loop takes a policy per row. The
   sim keeps its seven archetype policies (its bounds were tuned on them: moving them would move numbers that are not
   about the lift), and the engine gives every row the general policy.

Picked: **3, with 1 as the general policy.** The loop is one (`playStep`), its policy is a parameter, the sim passes its
own, the GM's odds pass the general one. Variant 2's "best score wins" is not how a player at a table plays.

## How the work is cut

- `src/core/combat/play.ts`: the one loop. `playBegin(fight, seed, R)` starts a fight in setup (openings drawn from the
  seed) or takes one running; `playStep(play, policyOf, cap, R)` plays one command and every die the fight then waits for
  (`owed`), answering what it did (the fight before, the row, the choice, the rolls, the effects) so the sim can count;
  `playEnd(play)` rolls death saves. The dice source is mulberry32 with its 32-bit state in the play, so a step is pure:
  same play in, same play out. The dice of a use are drawn by the same code as the edge's `rollNeeds` (moved into core
  as functions of a `Random`; roll.ts keeps its names with the crypto default), so the engine rolls Roll20's modifiers
  as the table does.
- `src/core/combat/policy.ts`: the general policy and the `Choice` it answers.
- `src/core/combat/odds.ts`: the run's machine (idle, running with its count, done, stale), `oddsStep`, `Odds`,
  `readOdds`, and the line and detail's sentences.
- The seed comes from the edge (`cryptoRandom` in `src/edge/roll.ts`), so core never draws. Fight i of a run plays from
  seed `mix(seed, i)`, so the same fight, rules, seed and count answer the same odds.
- It writes nothing: the engine answers numbers; the view keeps the run in a page `let` named in the lint, never in the
  save, the room or a backup.

## Machine: a run of the engine (drawn before its table)

```
idle --ask--> running(0 of n)
running(k of n) --step--> running(k+j of n) | done
running --changed--> idle          (a run of a fight that is no longer there is worth nothing)
running --cancel--> idle
done --changed--> stale            (the line stays, marked "the fight changed since")
done | stale --ask--> running(0 of n)
stale --changed--> stale
```

The statechart skill's TLA+ run was not used (it installs TLC through mise and the network); `bun run charts` walks the
real step from `tests/models/` and draws the same graph from the code.

## Decision trail

- The loop takes a policy per row, not a policy table keyed by archetype: the engine knows no archetypes.
- Count 100 (standard error at most 5 points), stated with the line.
- No worker: one command is about 1 ms at 4x, a frame holds eight.

## Step 2: the engine (done)

- `src/core/draws.ts` holds the dice draws as functions of a source (moved out of `src/edge/roll.ts`, which keeps its
  names with the crypto default) and `seededSource`, mulberry32 with its state as one number.
- `src/core/combat/play.ts` (`playBegin`, `playStep`, `playOver`, `playDead`), `policy.ts` (`sensible`, `TurnChoice`,
  `Policy`), `odds.ts` (the run's machine and `TABLE`, `Odds`, `readOdds`, `oddsLine`, `oddsDetail`, `ODDS_WORDS`).
- The random walk found the first policy's gap at once: `ready` (rules 2 to 5) let a shot through whose shape caught
  nobody (rule 6 refuses `noTarget` in `landUse`). Cause: the policy asked a part of the rule. Fix at the rule:
  `usable` in resolve.ts asks `ready` and then rule 6's shape check, the part of `landUse` that needs no dice; the
  policy asks only `usable`. The walk then played 120 random kit fights (at least 100 weighable) with no refusal.
- Type names: `Choice`, `Outcome`, `End`, `Spread` and `Decision` were already exported elsewhere (the lint "a type
  name is exported by one module"), so the engine's are `TurnChoice`, `RunOutcome`, `RunEnd`, `Percentiles`.

## Step 3: the simulator on the engine's loop (done)

`tests/models/fight-sim.ts` keeps its builds, policies and counters; its `playFight` now calls `playBegin` and
`playStep` and counts from what each step answers (the fight before, the row, the choice, the rolls, the effects).
Its own dice, death saves and tidy loop are gone. The draw order is the same (openings, then per turn the use's dice
in `needs`' order, then the owed dice, then the death saves), so every one of the 73 printed rows of
`tests/fight-sim.test.ts` is the same number to the last digit as before the lift (outputs compared line by line,
scratchpad `sim-before.txt` and `sim-after.txt`); only the wall time differs (76.3 s, 76.9 s). The one behaviour
change: a fight past 5000 commands now ends as a stalemate where the sim threw; no row reaches it.

## Step 4: where the GM reads it (done)

- The box sits under "Add to the fight" in `src/views/combat.js` (`[data-odds]`, `paintOdds`, `oddsFrame`), so it shows
  while the fight is built and, while it runs, in the Fight tools (the sheet over the map, or under the list). It shows
  only to the phone that runs the fight and only for a fight with a row up on each side (`weighable`).
- Idle: "Play it out 100 times" and a hint. Running: `motion.progress` with the real count ("Playing 37 of 100" and its
  percentage) and Stop. Done: one line (`oddsLine`) that is the "More info" control; its detail is a new `Thing`
  (`kind: 'odds'`, `detailOf` in `src/core/detail.ts`, lines `oddsDetail`). Stale: the line dimmed under "The fight
  changed since these odds. Play it out again to update them." Every sentence is core's (`ODDS_WORDS`, `oddsLine`,
  `oddsDetail`).
- It runs only on the tap. Each frame plays commands for `ODDS_FRAME_MS` (6 ms, read from the clock in the view); the
  run is the page `let odds` (named in the lint), never in the save. `render` sends `changed` with `oddsKey(f)` (the
  fight as JSON without its log): a done answer turns stale, a run under way for another fight is dropped.
- Findings on the way: (1) the browser test read "About 2.5 rounds": a fight's `summary.rounds` is fight time over a
  round, so a share of one; the words round it (`range`, `about`), with a unit case of fractional rounds. (2) The
  percentile read `floor(q * (n - 1))`, which gave the 90th percentile of two runs as the lower one; it is now the
  nearest rank (`ceil(q * n) - 1`), and the expected lines in the tests were worked out by that rule.
- That it writes nothing: `tests/odds.test.ts` ("the engine, its loop and its policy import nothing that writes") and
  the core lints; the browser test compares the fight, outbox, log and hunters before and after a run.
- Browser: `tests/e2e/odds.e2e.ts` (three cases), two cases in `tests/e2e/look.e2e.ts` (360 and 390 px), one case in
  `tests/e2e/feel.e2e.ts` (frames while 100 fights play at 4x; limit 3 frames, the plain limit).

## Step 5: close

- Chart: `scripts/charts/odds.ts`, walk events `tests/models/odds-events.ts`, entry `odds` in `MACHINES`; the walk
  reaches all four states and draws the graph drawn on paper above (seven arrows; ask while running is hidden, it
  starts again).
- AGENTS.md: a row for the odds (engine, loop, policy, draws, seed, the GM's box), the fight-sim row now names the loop,
  the machine in "Machines and their charts", and the recipe "A policy's new choice".
- `for-the-owner.md`: what he sees, and what to say for another count or a smarter plan for the monsters.

## Principles read and what each changed

- `principle-subtract-before-you-add`: the dice draws moved out of `src/edge/roll.ts` into `src/core/draws.ts` rather
  than a second copy in core; the sim's own loop, dice and death saves were deleted, not kept beside the engine's.
- `principle-model-the-domain`: the run is one union with a `TABLE` (idle, running, done, stale), not a "running" flag
  and a "stale" flag in the view; the view keeps one `let`.
- `principle-test-behavior-not-implementation`: the odds tests assert what a reader sees (a party that cannot lose reads
  near 1, a stalemate is its own outcome, the line's words); the expected percentiles were worked out by the
  nearest-rank rule by hand, which is how the floor-index bug was found.
- `principle-explain-the-number`: the count (100) comes from the standard error worked out before any run; the frame
  budget from the 4x measurement (about 1 ms a command), which also ruled out a worker.

## Decision trail (continued)

- `usable` lives in resolve.ts (rules 2 to 6 without dice), not in the policy: the rule's owner answers the question,
  so a new refusal in rule 6 reaches the policy with no change there.
- The detail is a `Thing` of `detail.ts`, so the line is a "More info" control like every other.
- Percentiles are nearest rank, so a spread over few runs reads both ends.

## Unit 6b: the odds engine drops a frame about one run in four

Status: done. The fix is in `odds.ts`; what is left is at the end of this section.

Started at a741fb6, main tree, alone on the box (load 0.2 before the runs). Goal (the owner): "I love percentages when
things are loading. I don't want them to be laggy", and the problem fixed, not its symptom. The problem: the lag case
"the GM plays a fight out 100 times for its odds" (limit 3 frames, 50 ms, at 4x) read 83.3 ms in the hook's run and
66.6, 33.3, 33.4, 33.4 alone. Principles read: fix-root-causes, explain-the-number, prove-it-works,
sequence-verifiable-units. Explain-the-number decided the first move: time every command and every paint of the run
in the page before reading any code for a cause.

### Method

Scratch dir `/tmp/claude-0/-home-user-systemgaming/92775296-016c-5fb1-b771-04765cc647d8/scratchpad/helper6` (not in
the repo): `spec/odds.e2e.ts` is the lag case's own setup (the starter party, 3 goblins, Add, the box scrolled into
view, 4x by CDP) with the rAF gaps and long tasks kept with their start times; `pw.config.ts` runs it on port 3218,
one worker. A throwaway patch in `combat.js` (`combat.orig.js` beside it, never committed) timed each `oddsStep` call
of `oddsFrame` by kind (a command, a begin, the done step), `paintOdds`, the frame's start after its rAF time, and
`oddsKey` in `render`. `analyze.ts` and `top.ts` read the runs, `trace.ts` reads a devtools trace (with
`disabled-by-default-v8.compile`). `AGAIN=1` taps "Play it out again" on the same page after the first run.

### What the long frames held

Six runs at a741fb6 (out1). Every frame over 34 ms is the first frame of the run, and nothing else is long:

| Run | Worst gap | Tap's task before the frame (frame start to oddsFrame) | First command (row, its turn) | Paint | Long tasks |
|---|---|---|---|---|---|
| 1 | 50 | 14.9 | 26.6 (Goblin B, the fight's first turn) | 0.1 | none |
| 2 | 50 | 16.8 | 32.2 (Goblin B) | 1.0 | none |
| 3 | 66.7 | 23.4 | 33.9 (Goblin B) | 1.0 | none |
| 4 | 83.4 | 35.3 | 41.7 (Goblin A) | 0.1 | 55 |
| 5 | 33.4 | 11 | 21.6 (Goblin A) | | none |
| 6 | 50 | 15.5 | 26.7 (Goblin A) | 0.2 | none |

Over all 17,800 commands of the six runs the median command is 0.6 to 0.7 ms and the 99th percentile 2.9 to 3.6 ms.
The next longest are the first turns of each other row in the first fights (Brakk's first attack 11.5 to 18.2 ms).
A begin (the next fight's start and its dice) is at most 4 ms, the done step at most 1 ms, `paintOdds` at most 1 ms;
`render` never ran during a run (no `oddsKey`), and no scavenge sat in a long frame.

The same page tapped again after its first run (`AGAIN=1`, 2 runs): the first command took 0.1 and 0.5 ms and the
frame started 3 to 6 ms after its rAF time. Same commands, same fight, warm: the long frame is gone.

A devtools trace of the first run (2 runs, `trace.ts`):

| Task | Script | V8.CompileCode inside it |
|---|---|---|
| the tap (`asked`: `oddsKey`, `playBegin` with the start and its dice, the box painted) | 17.5 to 19.1 ms | 10.2 to 13.8 ms |
| the next animation frame (`oddsFrame`: the first command) | 31.6 to 39.9 ms | 25.2 to 27.9 ms |
| the frame after | 13.4 to 23.3 ms | 3.9 to 4.6 ms |

### The cause

No step of the loop is long when its code has run before. The long frame is V8 compiling the reducer's code on its
first call: the page has never reduced a `start` or an `act` (a fight in setup runs neither), so the first `start`
compiles its path inside the tap's task, and the first `act` compiles the use's path (policy, `usable`, `needs`,
resolve's rules, triggers, zones, the turn's settle) inside the first frame, about 25 ms of compile at 4x. Two cold
chunks then fall in one frame interval, because the tap's task plays the first fight's begin before the frame the run
was asked for: tap 18 ms plus first command 30 to 40 ms is the 50 to 83 ms frame. The budget (`ODDS_FRAME_MS`) can
stop only between commands, and the begin in `ask` is outside it.

The fight screen pays the same: a GM's first use in a page reduces a cold `act` and compiles the same path in that
use's task (a finding for the fight, not changed here).

### The fix

`ask` now plays nothing: the running state's `play` is null until a step begins the fight (`asked`, `stepped` in
`odds.ts`). Each step is one piece the budget can stop after: a fight begun, one command, or a finished fight's end
kept. The tap's task is the box's paint alone, the begin gets a frame of its own, and the first command's compile gets
the next. The limit, the count, `ODDS_FRAME_MS` and the test are as they were. A unit case in `tests/odds.test.ts`
("the ask plays nothing") fails on a741fb6.

Eight runs of the instrumented spec after the fix (out3): worst gap 16.8 to 33.4 ms, no long task in any. The tap's
frame starts 1 to 14 ms after its rAF time (11 to 35 before); the first begin is 8.5 to 11.7 ms in its frame; the
first command is 16.6 to 30.1 ms in the next.

### Ten runs of the lag case alone (port 3218, one worker, load 0.95 before)

```
[feel] the odds playing cpu=4x frames=368 median=16.7 worst=33.4 taps=1 worstTap=28.8 longtasks=[]
[feel] the odds playing cpu=4x frames=367 median=16.7 worst=33.4 taps=1 worstTap=31 longtasks=[]
[feel] the odds playing cpu=4x frames=368 median=16.7 worst=33.3 taps=1 worstTap=42.7 longtasks=[]
[feel] the odds playing cpu=4x frames=371 median=16.7 worst=33.4 taps=1 worstTap=33.8 longtasks=[]
[feel] the odds playing cpu=4x frames=368 median=16.7 worst=33.3 taps=1 worstTap=35.4 longtasks=[]
[feel] the odds playing cpu=4x frames=369 median=16.7 worst=33.4 taps=1 worstTap=34.9 longtasks=[]
[feel] the odds playing cpu=4x frames=370 median=16.7 worst=33.3 taps=1 worstTap=35.5 longtasks=[]
[feel] the odds playing cpu=4x frames=366 median=16.7 worst=50 taps=1 worstTap=34 longtasks=[]
[feel] the odds playing cpu=4x frames=429 median=16.7 worst=33.4 taps=1 worstTap=28.5 longtasks=[]
[feel] the odds playing cpu=4x frames=367 median=16.7 worst=33.3 taps=1 worstTap=23.5 longtasks=[]
```

All ten passed. Nine are at or under 33.4 ms; one is 50 ms (3 frames, inside the limit). Before the fix, six
instrumented runs read 50, 50, 66.7, 83.4, 33.4, 50.

### What is left

- The one 50 ms frame is, inferred from the instrumented runs (not profiled in that run), the first command's compile:
  16.6 to 30.1 ms measured, so a slow moment of the box takes it past two frames. No budget on the main thread can cut
  a function's first compile. Two ways off the frame, neither taken here: the engine in a worker (its own bundle and
  messages; the step 1 notes ruled it out when a command was judged at 1 ms, and the cold first command is the number
  that argues for it), or the reducer's code compiled before the GM asks.
- A finding for the fight: the GM's first use in a page pays the same compile (about 25 ms at 4x) in that use's task.

### Close

- The whole `feel.e2e.ts` alone, three times on port 3218: `6 passed` each time. The odds case read 16.8, 33.3 and
  16.8 ms. In the same runs the other cases read: a fight turn 83.3, 33.4, 50 (limit 6); a maker 33.3, 33.3, 50.1
  (limit 5); a use from the map 33.4, 49.9, 66.6 (limit 6); the rest 16.8.
- `bun run test`: `Ran 3537 tests across 93 files.` 0 fail, 3 skip. `bun run charts` left `docs/state-machines.md`
  as it was (the run's states and arrows did not change).
- `tests/e2e/odds.e2e.ts` on port 3260: `3 passed`. `tests/e2e/look.e2e.ts` on port 3260: `22 passed`.
- AGENTS.md: no named thing changed, so no edit. No server left running.
