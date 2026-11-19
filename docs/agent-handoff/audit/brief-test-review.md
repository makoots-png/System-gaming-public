# Brief: a review of how this repository tests (read and measure; change nothing)

## The goal, in the owner's words

"Review other tests we're doing or how we construct them and propose better options if we have them."
"I want it perfect." "If we do fuck up, it needs to be obvious where it happened and how to fix it at a glance."
He watches usage: a session's cost matters, and so does a push that waits on tests.

## What to answer, each with evidence from this repository

1. **What each kind of test costs and catches.** Time per file (run `flock /tmp/box.lock bun test` once with
   timing; for the browser files use the durations in the last public run's logs if you can read them, else
   sample five files). From `docs/agent-handoff/decisions.tsv` (grep `FAILED`, `REFUSED`, `finding`) and the
   audit's verified findings (`docs/audit/2026-11-19-neon-audit.md` lines 1 to 60 only): which kind of test
   found each real bug, and which bugs reached the live site past all of them. Name the gaps by kind of bug.
2. **The slowest unit tests.** Three model tests take most of a 6.5 minute run (the fight model's 2,500 fights,
   the room's exhaustive walk, the sync model). Could they keep their coverage and cost less (a pass of their
   own, a smaller walk on every push with the full one on a schedule, seeds that change by commit)? Say what
   each option would stop catching.
3. **The browser tests' construction.** Read `tests/e2e/helpers.ts` and three files (`room-sync.e2e.ts`,
   `look.e2e.ts`, `phone.e2e.ts`). Fixed waits, tests that set up through the UI what a seed could give, cases
   that repeat one another, cases that assert markup where they could assert what a player sees.
4. **What is not tested at all** that a player would notice: name it from the audit's findings by class
   (for example a refused write, two phones, a reload between writes), not one by one.
5. **The copy of `src/edge/sync.ts` in `tests/models/room-world.ts`** ("copies function by function"): what
   holds the copy true today, and whether the model could drive the real functions.
6. **Tests that have failed with no fault in the app** (the trail names several): what each had in common.

## What to deliver

`docs/agent-handoff/audit/test-review.md`, at most 150 lines: for each question the evidence in a few lines, then
a list of proposals in order of worth, each with what it costs to build, what it saves or catches, what it risks,
and which pstack principle decides it. Mark each proposal "do", "do later" or "do not", with the reason. Propose
nothing you cannot support from what you read or ran. Commit it on branch `test-review` in worktree
`../sg-review`. Change no test and no code.

## Read only this

- `.claude/skills/poteto-mode/SKILL.md`, its `playbooks/investigation.md`, and the leaves
  `principle-test-behavior-not-implementation`, `principle-explain-the-number`, `principle-build-the-lever`,
  `principle-encode-lessons-in-structure`.
- `docs/guide/tests-ci.md`, `scripts/ci.ts`, `scripts/ci-plan.ts`, `.github/workflows/ci.yml`, and the files
  named above. Use grep on the trail and the audit; never read either whole.

## Rules

- Every run is wrapped in `flock /tmp/box.lock` (other helpers share the box and one times frames). Run no
  browser test unless question 1 needs the five samples: then one file at a time, `--workers=1`,
  `E2E_PORT=3235`, `E2E_CHROMIUM=/opt/google/chrome/chrome`, never `feel.e2e.ts`.
- No dashes as punctuation and no cleverness in any text. No AI attribution in commits. Do not push.

## Your report, under 250 words

The five proposals you rank highest with their reasons, and anything that surprised you.
