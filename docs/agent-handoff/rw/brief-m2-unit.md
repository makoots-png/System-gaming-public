# Brief for every unit of milestone 2 (the wiring wave)

Your unit is named in your prompt (P0 to P6, W1a to W9). Its scope, files, tests, check, reading list, principles and traps are its paragraph in `docs/agent-handoff/rw/m2-plan.md` section 4.2 (P units) or its row in 4.3 with its points in 4.4 (W units), read together with the plan's sections 1 (the target), 2 (every caller of what dies), 3 (how content is restated) and 5 (the browser tests) wherever they name your files. The plan is your specification. Its choices marked "decided here" are accepted by the lead unless this file or your prompt says otherwise.

## Why (the owner's goal)

the owner is the GM of a tabletop game played on phones. He had the fight reworked: turns from speed, eight stats, Armor and Resist in place of AC, places on a grid, formulas a GM can type over. It exists as tested pure code beside the old fight, and no screen uses it yet. Milestone 2 moves the whole app onto it and deletes the old fight, the six stats and AC in one wave, so nothing is left side by side. His bar: "Idc if it's big changes so long as the architecture remains ROCK solid", "everything is defined, easy to find", "No implicit state machines anywhere". After the wave a view only draws and sends taps, and every fight number has one home in core.

## Rules for every unit

- Read first, in full: `AGENTS.md`, `docs/agent-handoff/rw/principles.md` and the leaf skill of each row your unit touches, your unit in `m2-plan.md` and the plan sections it points at, the notes of the units before yours (`rw/notes-m2-*.md`, and `rw/notes-u2.md` to `notes-u4.md` for the modules you call), `.claude/skills/unslop/SKILL.md`. For a view unit also `docs/agent-handoff/ui-pass/design.md` (the look and the decisions the screens keep) and `AGENTS.md`'s recipe "A screen's look".
- Commit after each step with `git commit -m "..." -- <paths>` (plain message, no AI attribution, no Co-Authored-By; this overrides "do not commit" in your built-in text). Never push. Never start helpers. Never edit `.claude/skills`. Never `git checkout`, `git stash` or `git reset` a file another unit may own; to drop your own edit, edit it back.
- Never run `bun run ci`. Your check is the one your unit names, with the plan's 4.1 commands. Browser files run one at a time on your own port: `E2E_CHROMIUM=/opt/pw-browsers/chromium E2E_PORT=3241 bunx playwright test tests/e2e/<file> --workers=1 --trace off --output=/tmp/pw-<file>`. A browser test that fails twice is not load: read the error.
- A P unit leaves the whole `bun run test` green. A W unit leaves green what the plan says it owns, keeps `bun run build` green, and lists in its notes exactly what is red when it ends (the commands and the failing files), which must be no more than the plan's "red after".
- Touch only the files your unit owns. If another file must change for your unit to work, make the smallest change, and put it at the top of your notes with the reason.
- No test is skipped, marked `fixme` or `todo`, or loosened to get green. A test of deleted behaviour is deleted with the behaviour. A test of kept behaviour moves to the new code with an expected value that comes from the rule (the design, `RULES.fight`, the paper tables), never from a run of the code under test. Browser test names say what a player or GM sees, and drive the action through the UI.
- Core stays pure: no browser API, no `Math.random`, no module-level `let`, no import from edge or views. Dice are rolled in `src/edge/roll.ts` and passed in. No balance number as a literal outside `RULES.fight`.
- A view draws and sends taps. It computes no fight number and rolls nothing itself: it calls core for what to show and `src/edge/roll.ts` for dice. If you find yourself writing arithmetic on HP, damage, speed, distance or a chance in a view, it belongs in the core module the plan names.
- Subtract first inside your unit: delete what your change makes dead in your own files, in the same commit that makes it dead. Give the lines added and removed in your notes.
- Keep every screen's words as they are where the thing still exists; new words are plain and go in a list in `docs/agent-handoff/copy-tasks.md` (append). Keep the UI run's shared look: its buttons, `.seg`, `.dlg-actions`, toasts, the turn order first on a phone.
- Where the plan is silent or wrong, choose, do the smallest thing that fits the design, and write the choice at the top of your notes. If the plan cannot work as written for your unit, stop after committing what is green and say so in your reply.
- Notes file `docs/agent-handoff/rw/notes-m2-<unit>.md`, written as you go: what you made (exported names with one line each for a core unit; screens and what each now reads for a view unit), your choices, what is red and why, the exact last line of each check.

## Time

The minutes in the plan plus a third. If you are not done by then, commit what is green, write where you are in the notes, and reply.

## Reply

At most 200 words: the commit range (and your worktree path and branch if you have one), the exact last line of each check, what is red after you, your choices the lead should know, and anything the next unit must be told.

## Added by the lead before the wave (these overrule the plan where they differ)

- **W3**: P4 measured a worst-case fight doc row at about 627 characters (`rw/notes-m2-P4.md`), so 32 rows with statuses and the log do not fit the 16,384 cap the plan assumed. Raise the room doc cap in `server.ts` and wherever the app checks it to a number that holds 32 worst-case rows and the log with a fifth to spare, with that arithmetic as the comment, a test at the new bound and one over it. Do not trim what players see to fit the old number.
- **Every W unit**: the units before the wave left notes `rw/notes-m2-P0.md` to `notes-m2-P5.md` and `notes-m2-p6.md`. Read the ones your unit builds on; each ends with what later units must do (for example W2 deletes `perkSkill`, W1b gives each item its `attack`, W4 gives `fatigueDis` a home in core, W6 needs the hunter's stride in the doc).
- **Every W unit**: the lead does not run a full CI between wave units. Your notes' list of what is red is what the next unit and the lead rely on, so make it exact: run `bunx tsc --noEmit --pretty false 2>&1 | cut -d'(' -f1 | sort | uniq -c` and `bun test 2>&1 | grep -E '^\(fail\)' | wc -l` at your end and paste both results.
- `aims` in `fight-view.ts` now calls `inRange` and `whoIsIn` exported from `resolve.ts`; there is one home for the range and shape rules.
