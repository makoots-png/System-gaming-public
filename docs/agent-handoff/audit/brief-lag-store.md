# Brief: the save's repair on every write, against the fight turn's long frame

## The goal, in the owner's words

"This site should not be laggy." "Fix the problem and not the symptoms." "Everything must be explicit."
"If we do fuck up, it needs to be obvious where it happened and how to fix it at a glance."

The lag test (`tests/e2e/feel.e2e.ts`) fails about half its runs on this box, at a fight turn (an 83 ms task),
a maker's tap and a use from the map. The pre-push hook runs it, so no change to the app can be pushed. The unit
is done when the lag test passes 6 runs of 6 with nothing else running, with no bound loosened.

## What to try, in this order

1. **The audit's AW-sync-7**: every `store.apply` runs a full-tree `writeInto` and a full `repairSave`
   (`src/edge/store.ts`, about lines 269 to 295). Measure first what share of a fight turn's task they are.
   If the share is real, repair belongs at the boundary (a load, an import, a restore, a room message's land),
   and a step from core, which is typed, is trusted on the hot path. Say in the code which boundary repairs what.
2. Only if that is not enough: a command's write and its redraw in separate frames.
3. A hypothesis is kept only when it beats the run-to-run spread; otherwise revert it and log its numbers.

## Read only this

- `.claude/skills/poteto-mode/SKILL.md`, its `playbooks/hillclimb.md`, and the leaf skills
  `benchmark-checklist`, `principle-explain-the-number`, `principle-fix-root-causes`,
  `principle-boundary-discipline`. No other skill unless you apply it.
- `docs/agent-handoff/audit/notes-lag-steal.md` whole (13 KB): the baseline, what was tried, how frames were timed.
- `docs/audit/2026-11-19-neon-audit.md`: only the section `### AW-sync-7` (grep the ID; never read the file whole).
- `docs/guide/save-store.md`: the rows on the store's life, a view's write, and what is in a save.
  `docs/guide/tests-ci.md`: the rows on the lag test and the CI.
- The code you change, and the header of each file before its code.

## Rules of the work

- Work in a worktree of your own: `git worktree add ../sg-lag -b lag-store` from `/home/user/systemgaming`.
  Commit each step; uncommitted work dies with the lead's session.
- You are alone on the box: no other browser runs. Still wrap every test, typecheck and build in
  `flock /tmp/box.lock`.
- `E2E_CHROMIUM=/opt/google/chrome/chrome` for every Playwright run. Never `playwright install`.
- No test's bound, retry or wait is changed to pass. A property the repair held on every write (the save is
  always a valid save) must still be held by a test: if repair leaves the hot path, a test walks core's steps and
  shows each answers a save that `repairSave` leaves unchanged, or names why it cannot.
- Correct the comment at the top of `tests/e2e/feel.e2e.ts`: it still says the odds use `ODDS_FRAME_MS`.
- Append your log to `docs/agent-handoff/audit/notes-lag-steal.md`: each hypothesis, its numbers before and
  after over at least 6 runs, kept or reverted, and what limits each case now.
- No dashes as punctuation and no cleverness in any text. No AI attribution in commits.
- Do not push. Do not touch `.claude/skills/`.

## Before you report

`flock /tmp/box.lock bun run test`; the lag test 6 times alone; and the browser files that read the save's
shape (`save.e2e.ts`, `room-sync.e2e.ts`, `combat-turns.e2e.ts`), one worker each.

## Your report, under 300 words

The branch and its commits; the lag test's 6 runs (failed cases a run) before and after; what was kept and what
was reverted, with numbers; any contract that changed (who repairs what, and where); what is still at its bound.
