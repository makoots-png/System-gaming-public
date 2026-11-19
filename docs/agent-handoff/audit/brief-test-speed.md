# Brief: the unit pass costs less (the test review's proposals 1, 2 and 5)

## The goal, in the owner's words

"Propose better options if we have them." He watches what a push costs. "Everything must be explicit."
"If we do fuck up, it needs to be obvious where it happened and how to fix it at a glance."

The review (`docs/agent-handoff/audit/test-review.md`, read its proposals 1, 2 and 5 and the evidence lines they
cite, nothing else of it) measured, once each: the unit pass 364 s serial and 154 s with `--parallel=4`; the fight
simulator's 123 s spent as its file loads, where no timing or timeout sees it; a push of only notes refused by a
model test's timeout though no test reads the notes.

## The work, three steps, one commit each, each proved before the next

1. **The fight simulator measures inside its tests.** In `tests/fight-sim.test.ts` the measuring that runs at
   module load (about line 332) moves into a `beforeAll` or the tests that read it, with a time budget and the
   measured time beside it, as the model tests' budgets are written. No assertion changes. Prove: the same tests
   pass, and `bun test tests/fight-sim.test.ts --timings` (or the per-test times) now shows where the time goes.
2. **The unit pass runs in parallel workers.** `scripts/ci.ts` and the `test` script of `package.json`. First
   measure, three runs each under the lock: serial, and parallel at 2, 4 and the box's core count. Choose the
   count from the numbers and write them beside it. Check every model test's budget (grep `180` and `300` and
   `timeout` in `tests/*model*.test.ts` and `tests/fight-sim.test.ts`) against its time under the chosen count:
   a budget is at least twice the slowest of the three runs, with the measurement beside it. If a test passes
   serial and fails in parallel, that is a finding: name its cause (shared port, file, env such as `process.env.TZ`)
   and fix the cause; do not exempt the file without saying why in the code.
3. **A push of only `docs/agent-handoff/` runs the typecheck and no unit test.** One branch in `planOf`
   (`scripts/ci-plan.ts`), its case in `tests/ci-plan.test.ts`, the plan carried out in `scripts/ci.ts`, and a lint
   in `tests/lint.test.ts` named for the rule: no test opens a file under `docs/agent-handoff/` (so the skip stays
   true). The typecheck still runs: a `.ts` file under that folder is typechecked today.
   Update the CI paragraph of `AGENTS.md` and the CI rows of `docs/guide/tests-ci.md` to say what a push now runs.

## Read only this

- `.claude/skills/poteto-mode/SKILL.md`, the skill `benchmark-checklist`, and the leaves
  `principle-explain-the-number`, `principle-sequence-verifiable-units`, `principle-encode-lessons-in-structure`.
- `scripts/ci.ts`, `scripts/ci-plan.ts`, `tests/ci-plan.test.ts`, `package.json`, `tests/fight-sim.test.ts`,
  the CI rows of `docs/guide/tests-ci.md`, and the lint you copy in `tests/lint.test.ts` (grep, do not read whole).

## Rules of the work

- Worktree `../sg-speed`, branch `test-speed`, from the main tree's HEAD; `bun install`; commit each step; do not
  push; do not touch `.claude/skills/`, `tests/e2e/` or `src/`.
- Other helpers share the box and one times frames: every run is wrapped in `flock /tmp/box.lock`. A timing taken
  outside the lock is not a measurement.
- No dashes as punctuation and no cleverness in any text. No AI attribution in commits.

## Before you report

`flock /tmp/box.lock bun run ci` is not yours to run (it runs browsers). Run `flock /tmp/box.lock bun run test`
three times with the final setting and give each time and its count of passes.

## Your report, under 250 words

The branch and commits; the table of timings; the count chosen and why; each budget and its measurement; any test
that behaved differently in parallel and its cause; what a notes push and an app push now run.
