# Brief: a use from the map got slower in push 43

One helper (Opus, heavy-writer) in the main tree, on `claude/zen-pasteur-ov4cgd` at the commit the lead names. Nobody else writes this tree or runs a browser while you work, so your frame times are true. Read `final/brief-implicit-unit.md` and follow it (poteto mode, the cause written before a change, a commit by path after each step with a plain message and no attribution line, no push, no helpers, never `git checkout`, `stash` or `reset` a file in this tree, never edit `.claude/skills`, no new dependency). Do this unit first, then `final/brief-held-statuses.md`.

## The goal, in the owner's words

"I want it perfect, I do not care about time." "For all things we must fix the problem and not the symptoms." The lag test (`tests/e2e/feel.e2e.ts`, alone, one worker, 4x CPU) holds a use from the map to a worst frame of 100 ms. The problem: before push 43 its worst frame was 50 ms with no long task; at push 43 it is 50 to 100 with a long task of 52 to 88 ms, so the next push can fail and a player on a slow phone feels a use.

## What the lead measured (each line: the worst frame of "a use from the map" over three or four runs alone on port 3218)

| Commit | Worst frames | Long tasks |
|---|---|---|
| 5cb20ee (before) | 50, 50, 50, 50.1 | none |
| 45be918 (C5) | 49.9, 50, 49.9 | none |
| e5aace5 (N16) | 66.7, 50, 50 | 53, 50 |
| d0759b0 (V7's end) | 66.7, 66.7, 66.7 | 52, 53, 61 |
| c46fcf7 (C3 in) | 33.4, 83.4, 83.3 | 58, 65 |
| 4c78fbd (M2 in) | 50.1, 49.9, 66.6 | 55 |
| 1292b1f (push 43) | 50, 83.4, 100 | 52, 64, 88 |

It grew over several commits, so the runs are noise around a task that sits near 50 ms: a bisect will not name it. A frame is 16.7 ms, so a task of 45 ms shows as 50 and one of 52 as 66.7.

## Steps

1. Measure, do not guess. Take a CPU profile of the use in the test's own conditions (a throwaway Playwright script in your scratch dir, CDP `Profiler.start` around the Use tap, 4x throttle, the same fight the test builds) at 5cb20ee and at HEAD. For 5cb20ee use `git worktree add <scratch>/base 5cb20ee` with `node_modules` linked from the main tree, and remove it after. Write in `final/notes-lag-use.md` the top functions by self and total time of the long task at each, and what differs.
2. Name the cause: what this push made the use's task do that it did not do before (a thing worked out per row or per ability that was a field read; a draw that now runs twice; a list walked per card). Candidates only, to be confirmed or cleared by the profile: `itemOfAbility` and `itemSpent` now find the row and the ability (N16); the card's Extract per hunter row and `holderHunter` (C3); `formulaOf` working a rule's formula out at every read in `mapScene`, `hotbar`, `cardOf` and `abilityLines` (M2); the refusal table (C5).
3. Fix it where it starts. The rule stays where the audit put it (no stored copy of a derived value, no cache keyed by hand in a view). If the cost is a value worked out many times in one draw from the same inputs, work it out once in that draw and pass it down. Never raise the limit, never change the test.
4. Show it: five runs of `feel.e2e.ts` alone on port 3218 at your commit, every line of `[feel] a use from the map` in the notes. The aim is 50 ms with no long task, as before. If the profile shows the task was already at 45 to 50 ms before the push, say what in it is the largest part and whether it can go; a second fix that takes it clear of the frame boundary is in scope.
5. Close: typecheck, the whole `bun run test`, every browser file one at a time except feel on `E2E_PORT=3260` (the loop in `final/brief-close-audit.md`), the notes, a line `UNIT lag-use DONE at <commit>` at their top. Then go on to `final/brief-held-statuses.md` without waiting.

## Final reply (at most 200 words, for both units)

The commit range; the cause of the slower use in two sentences with the profile's numbers; the five runs; for the held statuses, the variant picked; each check's last line; what is left and why.
