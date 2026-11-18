# Notes: implicit audit unit U5, "The day's clock" (rows 58 core, 62, 63, 64, 65)

Goal: the daily countdown, the daily rollover and an urgent quest's end all follow one rule of time, so a player is
never penalized an hour before or after the countdown said, and an urgent quest never shows as overdue while it still
counts. The problem: when the day resets was two rules (core `dayKey` subtracted hours from the time, the view's
`nextReset` set the local hour), "overdue" and a due time from hours were worked out in views, and three clocks drove
the rollover. The smallest change that meets it: one core module for the day (`src/core/day.ts`: `dayKey`,
`nextReset`, `dueAt`, `dayGap`), `overdue` and the next wake time in core `quests.ts`, `reopenQuest` refusing an urgent
quest past its due time, and one timer in quests.js.

Brief: `brief-implicit-unit.md`. Worktree `.claude/worktrees/agent-a5ce56f7f20ff69d3`, branch
`worktree-agent-a5ce56f7f20ff69d3`, from `claude/zen-pasteur-ov4cgd` at 6d958e9.

## Causes, one sentence each

- Row 62. `dayKey` (core) took the local date of the time minus `resetHour` hours of elapsed time, while the view's
  `nextReset` took the local date at the local hour `resetHour`; on a day whose clocks change between midnight and the
  reset hour the two differ by the change, so the countdown hits zero an hour before (spring) or after (autumn) the
  day key turns and the rollover runs.
- Row 63. `dayKey(date = new Date(), ...)` read the clock inside core by default, so a caller could forget the time.
- Row 64. The rollover ran from three clocks (a 1 s tick inside the Quests view that also drew the countdown, a 60 s
  interval, the page shown), none of them set for the moment anything was due.
- Row 65. "Overdue" was `Date.parse(q.dueAt) <= Date.now()` written twice in core (`rollover`, `rolloverDue`) and twice
  in quests.js (the card's mark, the Reopen guard), and "an urgent quest past its due time is not reopened" lived only in
  the view, so `reopenQuest` accepted it and the next rollover failed it again.
- Row 58 (core half). A due time from "Due in hours" was `new Date(Date.now() + hrs * 3600e3).toISOString()` in two
  views (quests.js, gm.js); a number of hours too large for a date threw a RangeError from the form.

## Data shape (before code)

- A day is named by its key, the local calendar date `YYYY-MM-DD` on which it began. It begins at the first local
  instant at or after `resetHour`:00 on that date (`new Date(y, m, d, resetHour)`, which JavaScript moves forward out of
  a skipped hour). One function, `resetOn(y, m, d, hour)`, gives that instant; `dayKey` and `nextReset` are both read
  from it, so `dayKey` turns exactly at `nextReset` by construction.
- `overdue(q, nowMs)`: an active urgent quest whose due time has come. `pastDue(q, nowMs)` is the same without the
  status, what Reopen asks.
- `nextWake(save, now, resetHour)`: the next moment the rollover has something to do (the next reset, or the earliest
  due time of an active urgent quest), capped at `RECHECK_MS` ahead. The one timer is set for it.

## Variants weighed (on paper; a helper starts no helpers)

The clock that drives the rollover:

| Variant | Exact at the reset | Wall clock moved (laptop slept with the page shown, clock set by hand, a time zone change) | Clocks |
|---|---|---|---|
| A. One timer set for the next reset or due time, and the page shown (the audit's text) | yes | missed until the page is hidden and shown: a JS timer counts monotonic time, so after the wall clock jumps the timer is still hours away | 1 + event |
| B. A 60 s interval, and the page shown | up to 60 s late; the countdown sits at 00:00:00 | caught within 60 s | 1 + event |
| C. One timer set for the next reset or due time but never more than 60 s ahead, re-armed after every save change, and the page shown | yes | caught within 60 s | 1 + event |

C. The audit's A is wrong on one point found in the code and its tests: the e2e tests move the wall clock with
`page.clock.setSystemTime`, which keeps timers on their monotonic schedule, exactly as a laptop's sleep does; a timer
alone would sit hours away. The cap is the one place that samples the wall clock, and it is a named rule in core with
its reason.

## Rows

| Row | Change | Test that fails without it | Commit |
|---|---|---|---|
| 62 | `src/core/day.ts`: `dayKey` and `nextReset` from one `resetOn`; the view's `nextReset` and core rules.ts's `dayKey` deleted; quests.js, store.ts, save.ts, sync.ts and (through edge/rules.ts) hunter.js read day.ts | `tests/day.test.ts`: run against the old `dayKey` (a scratch copy importing it from rules.ts) 5 of 13 fail: Berlin 29 Mar and 25 Oct, New York 8 Mar and 1 Nov at reset hour 4, and the sweep; hour 0 passes, as the rule predicts. Browser: "on the morning the clocks spring forward, a missed daily is penalized when the countdown reaches zero" | ae4151d, 4616a9d, 001f91a, 0feadca |
| 63 | `dayKey(now, hour)` with no defaults; the views' `|| 0` on the reset hour dropped (save.ts repairs it to 0..23) | the typecheck (a call without the time does not compile) | 001f91a |
| 64 | One timer (`arm` in quests.js) set for `nextWake` (quests.ts): now when the rollover has something to do, else the next reset, an active urgent quest's due time, or `RECHECK_MS` ahead, whichever is first; re-armed on every save change and after each check; the page shown still checks. The 60 s interval and the 1 s tick's rollover check deleted (the 1 s tick now only draws the countdown) | `tests/quests.test.ts` "when the phone next runs the rollover"; browser "an urgent quest fails at its due time" (the old 60 s interval missed the 2 s window) | 01e67c4, 0feadca |
| 65 | `overdue` and `pastDue` in quests.ts, used by `rollover`, `rolloverDue`, `nextWake`, the card's mark; `reopenQuest` refuses `pastDue`, and the view shows the refusal ("Set a new due time first." and the edit form) | `tests/quests.test.ts` "an urgent quest past its due time is not reopened until it is given a new one" (the old `reopenQuest` reopened it); browser Reopen step | 01e67c4, 0feadca |
| 58 (core) | `dueAt(hours, now)` in day.ts, null for no hours, hours behind or a time a date cannot hold; the quest form uses it. gm.js line 395 is U10's (named in the lint's list) | `tests/day.test.ts` "a due time from hours" (1e15 hours threw a RangeError from the form before) | ae4151d, 0feadca |

Lints (`tests/lint.test.ts`): "the day's clock is src/core/day.ts" (no `setDate`/`setHours`, hour or day literals in ms,
`getTimezoneOffset` or `Date.parse(...dueAt)` in a view or the edge; gm.js's `hours * 3600e3` listed for U10), and the
audit's kind 8 lint "a view waits on a timer only where this list names it", with each file's count and reason (the
owners named: U3 row 21, U6 rows 5, 10, 71, U9 row 48, U4). Each starts from the old line it would have caught.

## Choices and what changed them

- Variant C over the audit's A (table above). Found by reading Playwright's clock (`setSystemTime` sets wall time and
  leaves `ticks`, on which timers run) and confirmed by the existing e2e tests, which move the wall clock that way.
- `overdue` and `nextWake` live in quests.ts, not day.ts: they read a quest's kind and status, and quests.ts owns those
  (model-the-domain). day.ts knows only time and imports nothing.
- `dueMs` reads a due time once and treats a text that is no time as none: save.ts's repair keeps `dueAt` as any string
  (`strOrNull`), so `Date.parse` can give NaN, and a NaN in `Math.min` would have set a 0 ms timer. The root fix is the
  repair reading `dueAt` as a time; save.ts is not this unit's file, so it is left for U11 or U14 (below).
- edge/rules.ts re-exports day.ts beside core/rules.ts, so hunter.js (another helper's file) needed no change.
- Principles read and applied: model-the-domain (the day's instant `resetOn` as the one structure both answers read),
  type-system-discipline (`QuestWhy` gains `pastDue`, the view branches on it; `DayKey` left a string, see below),
  boundary-discipline (the time is an argument everywhere in core; only the view reads the clock), fix-root-causes
  (reproduced row 62 with the old `dayKey` before changing it), test-behavior-not-implementation (expected instants
  worked out by hand from the zones' rules, not from a run), prove-it-works (the browser cases on the real app).

## Left, and why

- gm.js line 395 (`hours * 3600e3`): U10 adopts `dueAt` there (row 58's view half).
- save.ts's repair keeps `dueAt` as any string: reading it as a time is a field repair in save.ts (U11 or U14).
- A day key is a plain string in the save (`lastDailyKey`, `lastCheckedKey`, `lastCompleteKey`); branding it is with the
  save's other ids in U14.
- quests.js's 1.5 s progress timer is U3's (row 21), named in the timer lint.

## Checks (Nov 14, 22:20 UTC)

- `bun run typecheck`: passes (`$ tsc --noEmit && tsc -p tsconfig.views.json --noEmit`, nothing after).
- `bun run test`: 0 fail, "Ran 3086 tests across 79 files. [297.23s]". The first run failed only the dependency map,
  fixed by `bun run deps -- --write` (39bc052). `bun run charts`: no change (no machine touched).
- `tests/e2e/gates-quests-dailies.e2e.ts`: "23 passed (2.7m)". With day.ts's `dayKey` put back to the old rule for one
  run, "on the morning the clocks spring forward" fails (no PENALTY window at 4:00 EDT); restored byte for byte after.
- Also run, as they drive the quest form: makers.e2e.ts "a quest whose reward is made in the reward editor" (1 passed),
  rewards.e2e.ts (5 passed). No box pause seen.
