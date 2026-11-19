# Brief: what the lag test measures (investigate, then build)

## The goal, in the owner's words

"This site should not be laggy." "Use the pstack principles to investigate if this is a good idea. Then implement."
"If we do fuck up, it needs to be obvious where it happened and how to fix it at a glance."

The lag test (`tests/e2e/feel.e2e.ts`) times gaps between frames on the wall clock. With no change to the app it
failed about half its runs one night and 1 of 18 the next day (`docs/agent-handoff/audit/notes-lag-steal.md`).
A gate that moves with the machine blocks good pushes and can pass bad ones. The lead's proposal, not yet proven:
bound the page's own work in a frame (main-thread task time from the browser's trace, in CPU time) and keep the
wall-clock gap as a second, looser check.

## Part 1: investigate (the Investigation playbook, then Prototype). Change no test yet

The question is a fact a run can show, so show it. A good measure has two properties:

- **It does not move when the host is busy.** Run the cases with the box idle and with a load beside them
  (for example `stress`-like busy loops on every core, written in bun), at least 6 runs each.
- **It does move when the app is slower.** Run with a known slowdown put into the app on a throwaway branch
  (for example 30 ms of busy work in the redraw after a fight command), at least 6 runs each.

Measure the test's wall-clock numbers as they are today and each candidate beside them, in the same runs.
Candidates, and any better one you find: main-thread task duration from a trace in thread CPU time; the sum of
script, style and layout time in the frame after the tap; long tasks from `PerformanceObserver`; the tap-to-paint
time the test already takes. Say for each how far apart "idle" and "loaded" are against how far apart "as is" and
"slowed" are. A candidate that cannot tell the slowed app from the loaded host is no better than today's.
If nothing separates them, say so and stop: that is an answer.

Write the result in `docs/agent-handoff/audit/notes-lag-measure.md` (the table, how each number was taken, what
limits it) and commit it before Part 2.

## Part 2: build what Part 1 proved, and only that

- The measure and its bounds live in one place the test reads. Each bound has its reason beside it: the number
  measured on the app as it is, the margin, and what a failure means in a player's words.
- A failure says which case, which tap, what the page was doing (the longest tasks by name from the trace) and
  the number against its bound, so the cause is found without a rerun.
- No bound is set so that today's app only just passes; if a case sits at its bound, the case is listed in your
  report as a fault of the app to fix next, not hidden by the bound.
- If the wall-clock check stays as a second check, say in its comment what it catches that the first does not.
- Update the rows on the lag test in `docs/guide/tests-ci.md` and the CI section of `AGENTS.md` if what they say
  changes. `scripts/ci.ts` still runs the lag test last, alone.

## Read only this

- `.claude/skills/poteto-mode/SKILL.md`, its `playbooks/investigation.md` and `playbooks/prototype.md`, the
  skill `benchmark-checklist`, and the leaves `principle-explain-the-number`, `principle-prove-it-works`,
  `principle-test-behavior-not-implementation`, `principle-attack-the-premise`.
- `docs/agent-handoff/audit/notes-lag-steal.md` whole, `tests/e2e/feel.e2e.ts`, the frame helpers it imports,
  `scripts/ci.ts`, and the lag rows of `docs/guide/tests-ci.md` (grep `feel`).

## Rules of the work

- Worktree `../sg-measure`, branch `lag-measure`, from the main tree's HEAD; `bun install`; commit each step;
  do not push; do not touch `.claude/skills/`.
- Every test, typecheck and build is wrapped in `flock /tmp/box.lock` (another helper shares the box).
  `E2E_CHROMIUM=/opt/google/chrome/chrome`, `E2E_PORT=3233`. Never `playwright install`.
- The slowed app is a throwaway branch and is never merged.
- No dashes as punctuation and no cleverness in any text. No AI attribution in commits.

## Your report, under 300 words

The answer to "is it a good idea" with its table; what you built; the 6 final runs idle and 6 loaded; which
cases of the app sit near a bound and why; what you would do next.
