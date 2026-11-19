# Brief for a unit of audit findings (the same for every unit; the lead's prompt names your findings and files)

## The goal, in the owner's words

"Look at the bug list in here." "Fix the problem and not the symptoms." "Everything must be explicit."
"I want it perfect." "If we do fuck up, it needs to be obvious where it happened and how to fix it at a glance."

The audit is `docs/audit/2026-11-19-neon-audit.md`: 154 findings by another model on an older commit. Its author
checked 20; the rest are leads and some are wrong. Never read the file whole: grep each of your finding's IDs and
read its table row and its section.

## The work, for each finding, in this order

1. **Reproduce it with a test that fails on today's code**, written from what a player or a GM would see or from
   the rule the code states, not from the audit's suggested fix. A unit test where the fault is in core or the
   server; a browser test only where the fault is a view's. Commit the failing test alone first.
2. **If it does not reproduce**, write what you tried and why it cannot happen (the line that prevents it) and
   change nothing for it. That is a full result.
3. **Fix it at the first place the system goes wrong.** If two findings share a cause, one fix. If the cause is a
   second path beside a first, make one path and delete the other. If the cause is a state held in flags or in
   two places, it becomes one explicit state (a union, or a machine with its table as the repository's others).
   Add no guard beside a fault you can remove. Change no test's bound, wait or retry to pass.
4. **If the class of bug could come back**, hold it with a lint in `tests/lint.test.ts` or a line of a model's
   invariants, and say so.
5. One commit a finding or a shared cause, its message saying what a table sees differently.

## Read only this

- `.claude/skills/poteto-mode/SKILL.md`, its `playbooks/bug-fix.md`, and the leaves
  `principle-fix-root-causes`, `principle-test-behavior-not-implementation`, `principle-model-the-domain`.
  Another leaf only when you apply it.
- The guide file of your area in `docs/guide/` (the lead's prompt names it): grep for the function you touch and
  read its rows, not the file whole. The header of each source file before its code.
- The code you change and the test file you copy.

## Rules of the work

- A worktree and branch of your own (the lead's prompt names them), from the main tree's HEAD; `bun install`
  there; commit each step; do not push; do not touch `.claude/skills/`.
- Change only the files your prompt lists, and tests. If the fix needs another file, stop and say so in your
  report: another helper may be in it.
- Other helpers share the box and one times frames. Wrap every test, typecheck and build in
  `flock /tmp/box.lock`; expect to wait minutes. Run single test files while you work. Browser runs: one file at
  a time, `--workers=1`, `E2E_CHROMIUM=/opt/google/chrome/chrome`, the `E2E_PORT` your prompt gives, never
  `tests/e2e/feel.e2e.ts`, never `playwright install`.
- If you change a machine or an import: `bun run charts` and `bun run deps -- --write`.
- No dashes as punctuation and no cleverness in any text. No AI attribution in commits.

## Before you report

`flock /tmp/box.lock bun run typecheck`, then `flock /tmp/box.lock bun run test` once, whole.

## Your report, under 300 words

For each finding: reproduced or not, the test that shows it, the cause in one line, what changed and where.
Then: the checks you ran with their counts, any lint or invariant added, anything you saw and left, and for the
lead's `landed.md` row one sentence of what a table sees.
