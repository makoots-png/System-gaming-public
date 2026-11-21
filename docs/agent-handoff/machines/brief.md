# Brief: one unit of "every implicit state machine made explicit"

## The goal, in the owner's words

"Implicit state machines die. No rating system, they all perish. Everything explicit. Architecture first." His
standing words: "I want it perfect", "fix the problem and not the symptoms", "If we do fuck up, it needs to be
obvious where it happened and how to fix it at a glance."

The problem: Neon's hunt (`docs/audit/2026-11-20-neon-state-machines.md`) found 38 lifecycles whose state lives in
loose fields, flags, timers or a view's memory, so wrong states can be reached. Each becomes an explicit machine: a
named state type and one pure transition function in `src/core`, wrong states impossible to build where the type
can do it, a table test of its transitions, and its chart. A view holds none of the machine's state.

## Your unit

`docs/agent-handoff/machines/plan.md` has a table of units and, under "The design of each unit", your unit's
paragraph: read the legend at its top, your row and your paragraph (grep your unit's name; do not read the others).
Your row lists the machines (SMX ids), the core module and the files you may change. The paragraph is the design:
build it. If reading the code shows the design is wrong, say so in your report and build what is right, in your files.

For each of your SMX ids: in the audit, read that machine's section only (grep `### .* SMX-<id>:`; skip the TLA+
part of the file, lines 111 to 630). In `docs/audit/2026-11-20-state-machines-scored.md` grep the id: a row marked
fixed needs no work; an open row is yours; a row that waits on a ruling is built **as the app behaves today**, as a
named row of the table with a comment that names the ruling, so the ruling later is a one-row edit. Do not decide
a game rule. The audit's line numbers have moved: find a function by its name.

## How

- Failing tests first: the transition table (every state against every event, the refused ones too), and one test
  for each open symptom, with expected values worked out from the rule. Then the code. One commit a step.
- One writer for the new state. A state or event that cannot happen is not in the type.
- If the machine has a chart source in `scripts/charts/` and a model in `tests/models/` in your list, keep them true
  (copy the nearest existing pair for a new one). Run `bun run charts` and `bun run deps -- --write` to check, but
  **do not commit** `docs/state-machines.md`, `docs/dependency-map.md`, `scripts/statecharts.ts`, any `docs/guide/`
  file or `tests/lint.test.ts`: the lead owns them (sixteen units run at once and each would conflict). If a lint
  test fails because of your change, or a guide row becomes untrue, say exactly which and what it should say.
- A screen that changes: one 390 px screenshot you read yourself, and a browser test that it fits. Commit no image.

## Read only this

- `.claude/skills/poteto-mode/SKILL.md`, the skill `statechart` (`.claude/skills/statechart/SKILL.md`) and the leaf
  `principle-model-the-domain`. Another leaf only when you apply it.
- `docs/guide/machines.md` (how a machine is listed and charted). The guide rows for your files, by grep.
- Your sections of the plan, the audit and the scored file, as above. The code you change and the test you copy.

## Files you may change

Only your row's list (new files it names included). Other helpers hold every other file. If the work needs one,
stop at that edge, leave it, and say which file, which function and the exact change.

## The box

Work only in your worktree. Wrap every test run in `flock /tmp/box.lock`. End with `flock /tmp/box.lock bun run
test` and say its last lines; if it is red only for a file outside your list, say which. Browser tests:
`E2E_CHROMIUM=/opt/google/chrome/chrome`, one file at a time, the port your prompt gives, `--trace off`. No push,
no AI attribution in a commit. Commit each step. Report in under 250 words: the commits, what a table sees, the
tests that hold it, the rows built as today that wait on a ruling, anything you stopped at, anything you did not run.
