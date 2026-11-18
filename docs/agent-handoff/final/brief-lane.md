# Brief: a lane of the second audit's units (the lead names your lane)

One helper (Opus, heavy-writer) in your own worktree, on a branch off `claude/zen-pasteur-ov4cgd` at the commit the lead names. The general brief is `final/brief-implicit-unit.md`: read it first and follow all of it (poteto mode, the cause written before each change, a test that fails without it, commit by path after each row, no push, no helpers, never `git checkout`/`stash`/`reset` a file, never edit `.claude/skills`, no new dependency). This file says what a lane is. Where the two differ, this file wins.

## The goal, in the owner's words

"I want it perfect, I do not care about time." "Everything must be explicit. Everything." "For all things we must fix the problem and not the symptoms." Two more audits read the code as it is after the first fifteen units: `final/implicit-audit-2.md` (findings N1 to N20 and rows 41, 42, 51, 57, 84; units V1 to V8) and `final/implicit-audit-3.md` (65 findings from files read top to bottom; units V9 to V14). The problem is that each finding is still a rule a view holds, a rule written twice, a fact kept twice or a loosely typed thing, and several are bugs a player or GM can meet. The smallest change that meets the goal is each row's remedy, done where AGENTS.md says that kind of thing lives.

## Your lane

- **Lane A, the fight** (`E2E_PORT=3250`; never 3233, which the lead's CI uses for its upgrade test: 3218 + 15): V13 (the fight's rules written once), then V10 (a row's identity and who is in a fight), then V3 (the fight's end and the Clear panel), then V6 (the Table feed and the gates' news).
- **Lane B, the sheet, the room and the GM** (`E2E_PORT=3234`): V1 (a player's item in the GM's fight), then V14 (a sheet step answers what it changed), V2 (the GM view's actions in one step), V11 (a quest's completion in one step), V4 (one player, one name, one target), V5 (the link's saves as steps), V12 (this phone's identity out of the save), V9 (content saved by id, rule values read not stored).

A unit's rows are in both audit files: the third audit's summary says which of its rows join V1, V4, V6 and the others, and its own table lists V9 to V14. Each audit's last table gives a unit's files and tests. Rows for V7 and V8 are not yours.

## How a unit goes

1. **Inventory first.** For each row of the unit, find the code as it is now and write one line in `final/notes-<unit>.md` (for example `notes-V13.md`): still true (file and line), already done, or changed shape. The audits did not run anything, and their "sure" column says how far to trust a row: confirm a `med` or `low` row by a failing test or a run before fixing it. If a row is wrong, say why and leave the code.
2. **Each row**: the cause in one sentence, the remedy as the audit judged it (or a better explicit one, with the reason), a test that fails without the change. For a bug a player or GM could meet, the test makes that failure happen.
3. **Sweep for the class** in your unit's files, as the audit asked of every fix.
4. **Close the unit**: `bun run deps -- --write`, `bun run charts`, `bun run typecheck`, the whole `bun run test`, then every browser file one at a time except `tests/e2e/feel.e2e.ts`:
   ```
   for f in tests/e2e/*.e2e.ts; do case $f in *feel*) continue;; esac; E2E_CHROMIUM=/opt/pw-browsers/chromium E2E_PORT=<your port> bunx playwright test $f --workers=1 --trace off --output=/tmp/pw-lane-<A or B> | tail -3; done
   ```
   AGENTS.md rows and recipes for what now exists. `for-the-owner.md` for each change a player or GM sees, with what he would say to reverse it. The notes' "Left" section with reasons. Everything committed.
5. **Report the unit to the lead and go on to the next without waiting.** The report is one message through your final reply only at the end of the lane, so after each unit write a line `UNIT <name> DONE at <commit>` at the top of `final/notes-lane-<A or B>.md` and commit it: the lead reads that file, merges the unit and pushes while you work on the next. Before starting each unit run `git log --oneline -1 claude/zen-pasteur-ov4cgd` and, if the lead's branch moved, `git merge claude/zen-pasteur-ov4cgd` into your branch (a merge commit, no rebase) and rerun typecheck and the whole `bun run test` before you go on.

## Rules that have cost a push before

- A test that fails once is a finding about the app until shown otherwise. Name its cause from evidence (the trace, a reproduction by hand) before changing anything. Never retry, lengthen a wait, loosen a bound or change a test to pass. If the cause is the test's own race, show it by reproducing it on purpose, then fix the test and say so in the notes.
- When the lead says the CI is timing frames, run no browser and no whole `bun run test` until the time it gives.
- The other lane works at the same time on other files. Keep to your unit's files; a line in a file of the other lane goes in its own commit, named in your notes, as small as it can be.
- A machine is drawn with the `statechart` skill before its `TABLE`; a new machine gets its chart and walk events (AGENTS.md's recipe).
- New words a player reads get a `TODO(copy)` mark; the wording pass comes after you.

## Final reply (end of the lane, at most 250 words)

Branch, worktree, commit range; for each unit: rows done of rows given, each check's last line, what a player or GM would have seen for each bug fixed; lines changed in files of the other lane; what is left and why.
