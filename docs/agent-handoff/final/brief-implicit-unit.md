# Brief: one unit of the implicit audit (the lead names your unit)

One helper (Opus, heavy-writer), in your own worktree on a branch off `claude/zen-pasteur-ov4cgd` (unless the lead says the main tree). Commit after each row or small group of rows with `git commit -m "..." -- <paths>` (plain message, no AI attribution, no Co-Authored-By). No push, no helpers, no `bun run ci`, never `git checkout`/`stash`/`reset` a file after your start, never edit `.claude/skills`, no new dependency. Checks: `bun run typecheck`, the whole `bun run test`, and the browser files your unit touches, one at a time: `E2E_CHROMIUM=/opt/pw-browsers/chromium E2E_PORT=<the port the lead gives you> bunx playwright test tests/e2e/<file> --workers=1 --trace off --output=/tmp/pw-<unit>`. Never `tests/e2e/feel.e2e.ts` (the lead runs it on a quiet box). Never `playwright install`.

Work in poteto mode: read `.claude/skills/poteto-mode/SKILL.md` and START-HERE's section "Every helper works in poteto mode" first, and follow both (a machine is drawn with the `statechart` skill before its table; a fix follows `principle-fix-root-causes`).

Read in full: `AGENTS.md` (its recipes are how each thing is added: a machine, a room message, a link state, a field of a saved thing, a combat command), `docs/agent-handoff/START-HERE.md` (above all "Everything explicit" and "The problem, not the symptom"), `docs/agent-handoff/final/implicit-audit.md` (the summary, every row marked with your unit in step 1 and step 2, and your unit's entry: its files, its tests, what it deletes), `docs/state-machines.md` for any machine you touch, `docs/agent-handoff/rw/principles.md`, the skills `principle-model-the-domain`, `principle-type-system-discipline`, `principle-boundary-discipline`, `principle-prove-it-works`, `unslop`.

## Why

the owner, the GM: "everything must be explicit. Everything.", "Where else might be have implicit state machines or other impliciteness? We must root them out and rectify them.", "For all things we must fix the problem and not the symptoms." The audit found 90 places where state or a rule is implied. Yours are the rows of one unit. He checks nothing until the site is live; a player must never lose a reward, a report or a form to one of these.

## How

- Do every row of your unit as the audit's judgment says: a machine is a `TABLE` in core with its chart (`scripts/charts/`, `MACHINES`, walk events in `tests/models/`), a union replaces flags so a wrong combination cannot be written, a step is a pure function in core called through `store.apply`, a deletion deletes. Where the audit's judgment is wrong once you read the code, do what is right, and say so in your notes with the reason.
- Before each row: write the cause in one sentence in your notes. After: a test that fails without the change (a bun test of the core function or the machine's table and invariants; a browser case only where a player's screen is the thing). For a failure a player could meet (a send that fails, a reload in the middle, a phone offline), the test makes that failure happen.
- Add the lint test the audit names for your unit's class, so it cannot come back, with an empty allow-list or one that names what another unit owns.
- Keep to your unit's files. Other helpers are working at the same time: one on `maker.js`, `forge.js`, `skills.js`, `loot.js`, `bestiary.js`, `workshop.js`; one on `combat.js`, `table.js`, `map.js`, `dice.js`, a new `detail.js` and the sheet's panels in `hunter.js`; others on other units of this audit. If a row needs a line in a file that is not yours, make the smallest change in its own commit and name it in your reply.
- No behaviour a player sees changes except where the audit says the old behaviour was the bug; each such change gets a line in `docs/agent-handoff/for-the-owner.md` with what he would say to reverse it.

Close: `bun run deps -- --write`, `bun run charts`, typecheck, the whole `bun run test`, your browser files; AGENTS.md rows and recipes for what now exists; notes in `docs/agent-handoff/final/notes-implicit-<unit>.md` (each row: the cause, the change, the test, the commit; what you left and why). Commit.

Time: three hours; stop at a row boundary if short. Reply in at most 200 words: branch, worktree, commit range; each check's last line; rows done of rows given; what a player would have seen for each bug fixed; lines changed in files not yours; what is left.
