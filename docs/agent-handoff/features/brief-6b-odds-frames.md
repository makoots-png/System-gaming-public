# Brief: the odds engine drops a frame about one run in four

One helper (Opus, heavy-writer) in the main tree, on `claude/zen-pasteur-ov4cgd` at the commit the lead names, alone in the tree: nobody else runs a browser, so your frame times are true. Read `features/notes-6-odds.md` (the engine, its measurements, how the work is cut), `final/notes-lag-use.md` (how the last profile of a frame was taken and read), `AGENTS.md` and `final/brief-implicit-unit.md` (poteto mode, the cause written before a change, a commit by path with a plain message and no attribution line, no push, no helpers, never `git checkout`, `stash` or `reset` a file, never edit `.claude/skills`).

## The goal, in the owner's words

"I love percentages when things are loading. I don't want them to be laggy, this site should not be laggy." "For all things we must fix the problem and not the symptoms."

The problem: the push of feature 6 was refused by its own lag case (`tests/e2e/feel.e2e.ts`, "the GM plays a fight out 100 times for its odds", limit 3 frames = 50 ms at 4x CPU). In the hook's run the worst frame was 83.3 ms; alone on port 3218 the lead read 66.6, 33.3, 33.4, 33.4. No long task over 50 ms was recorded in any of them, so the long frame is several tasks in one frame, or one of 30 to 50 ms beside the frame's own work. The view plays commands for `ODDS_FRAME_MS` (6 ms) a frame and checks the clock between commands, so one command, or one step of the loop, that is itself long cannot be cut by the budget.

## Steps

1. Measure, do not guess. A throwaway script in your scratch dir: the test's own fight (the starter party and 3 monsters) at 4x, the engine run many times, and for each frame over 33 ms what ran in it (CDP `Profiler` or `performance.measure` marks around each call of `oddsStep`, each `playBegin`, each `playStep`, the paint of the count, the paint at done, and a GC mark). Candidates to confirm or clear, not to assume: `playBegin` (a new play: the rows, the openings) as one step; one `reduce` that is long (a turn's start with every settle; a use with a blast and triggers); the done step (`readOdds`: the percentiles over 100 ends, `oddsLine`, the detail) and its paint; the stale key (`oddsKey`: the fight as JSON at each render); a scavenge from what a play allocates. Write the table in `features/notes-6-odds.md` under a new heading: what the long frames held, with times.
2. Name the cause, then fix it where it starts: a step of the loop that is too long is cut into steps the caller's budget can stop between (the run's state already holds a play in progress); work at done that is too long is spread or made cheaper; work repeated each frame that need not be is done once. The limit, the count of fights and the test stay as they are. If the cause is one `reduce` that takes 30 ms at 4x, say which command and why, and whether the fight screen pays the same in play (then it is a finding for the fight too).
3. Show it: ten runs of that case alone on port 3218 (`E2E_PORT=3218 bunx playwright test tests/e2e/feel.e2e.ts -g "odds" --workers=1 --trace off --output=/tmp/pw-feel`), every `[feel]` line in the notes; the aim is every run at or under 33.4 ms. Then the whole `feel.e2e.ts` alone three times.
4. Close: typecheck, the whole `bun run test`, `tests/e2e/odds.e2e.ts` and `tests/e2e/look.e2e.ts` on `E2E_PORT=3260`; the notes; AGENTS.md if a named thing changed. Leave no `bun server.ts` running.

Environment: `E2E_CHROMIUM=/opt/pw-browsers/chromium`; never `playwright install`; never port 3233. Never raise the limit, lengthen a wait or change the test to pass.

## Final reply (at most 150 words)

The commit range; what the long frames held, with the numbers; the fix in two sentences; the ten runs; each check's last line; what is left.
