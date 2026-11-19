# Brief: the unit tests also run on the public repository, and the hook takes their green run

## The goal, in the owner's words

"Ok so should we make the box on GitHub?" "Ok do what's best!" He watches what a push costs, and:
"If we do fuck up, it needs to be obvious where it happened and how to fix it at a glance."

Today every push runs the unit pass on this box, where helpers' timed runs wait on the same lock. The browser
tests already run on the public repository and the hook skips them here when given the tree that ran green
(`CI_BROWSER_REMOTE`). The unit tests should run there the same way, in parallel jobs, so a push waits on GitHub
and not on this box. The lag test stays here: do not move or change it.

## The work, one commit a step

1. **A unit job in `.github/workflows/ci.yml`**, split across jobs by `bun test --shard` (or by file lists) so no
   job is longer than the browser parts (about 6 minutes). Use the budgets the unit pass now has
   (`test-speed` landed before you start: read its commit messages, `git log --oneline -6 -- scripts/ci.ts tests/fight-sim.test.ts`).
   A test that cannot finish on a runner is a finding: name which and why in your report; do not skip it silently.
   If it must stay local, the hook still runs that file here and the plan says so in words.
2. **`CI_UNIT_REMOTE=<tree id>` in `scripts/ci.ts`**, beside `CI_BROWSER_REMOTE` and built the same way: the hook
   then runs the typecheck (and the lag test when the plan asks for it) and trusts the unit run of that tree.
   One variable for both would be simpler if both always come from one run: decide from how `CI_BROWSER_REMOTE`
   is checked today and say which you chose and why. The plan's words (`scripts/ci-plan.ts`) say what was trusted
   and from where, so a log shows at a glance what ran here and what ran there. Cases in `tests/ci-plan.test.ts`.
3. **The guide**: the CI paragraph of `AGENTS.md`, the CI rows of `docs/guide/tests-ci.md`, and section 3 of
   `docs/agent-handoff/handoff.md` say the new way to land a push, step by step.

## What you cannot do, and what the lead does

You cannot push to the public repository or start a run there: the lead does both. So prove the workflow's
syntax and the shard lists locally (run each shard's command here under the lock and add up the counts: every
test in exactly one shard, the total equal to the serial pass's), and tell the lead the exact steps to try it.

## Read only this

- `.claude/skills/poteto-mode/SKILL.md` and the leaves `principle-sequence-verifiable-units`,
  `principle-prove-it-works`, `principle-minimize-reader-load`.
- `.github/workflows/ci.yml`, `scripts/ci.ts`, `scripts/ci-plan.ts`, `tests/ci-plan.test.ts`,
  `scripts/ci-public.sh`, the CI rows of `docs/guide/tests-ci.md`, `handoff.md` section 3.

## Rules

- Worktree `../sg-remote`, branch `ci-remote`, from the main tree's HEAD; `bun install`; commit each step; do not
  push. Wrap every run in `flock /tmp/box.lock`. Run no browser test. Do not touch `src/`, `tests/e2e/` or
  `.claude/skills/`. No dashes as punctuation and no cleverness in any text. No AI attribution in commits.

## Your report, under 250 words

The branch and commits; the shards with each one's count and time here; one variable or two and why; any test
that must stay local and why; the steps for the lead to try a run.
