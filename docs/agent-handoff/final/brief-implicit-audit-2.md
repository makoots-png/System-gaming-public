# Brief: the second audit of everything implicit (read only, one file)

One helper (Opus, heavy-writer). You change no code and no test. You write `docs/agent-handoff/final/implicit-audit-2.md` and commit it with `git commit -m "..." -- docs/agent-handoff/final/implicit-audit-2.md` after each numbered step (plain message, no AI attribution). No push, no helpers, no browser runs, no `bun run test`, never `git checkout`/`stash`/`reset`. Another helper is editing the tree: read what is committed, with `git show HEAD:<path>` for any file `git status` shows modified.

Work in poteto mode: read `.claude/skills/poteto-mode/SKILL.md` and START-HERE's section "Every helper works in poteto mode" first.

## The goal, in the owner's words

"Everything must be explicit. Everything." "Where else might we have implicit state machines or other implicitness? We must root them out and rectify them." The first audit (`final/implicit-audit.md`, 90 findings) was written before fifteen units changed the code. The problem now is that nobody has read the code as it is: a unit may have left a row half done, moved an implicit thing instead of removing it, or added a new one, and the first audit did not read some files at all. Your output is the list of what is still implicit or newly so, with nothing changed.

## Read first

`AGENTS.md`, `docs/agent-handoff/START-HERE.md` ("Everything explicit", "The problem, not the symptom"), `final/brief-implicit-audit.md` (the eight kinds and the method: they are yours too), `final/implicit-audit.md` in full, the "Left" section of every `final/notes-implicit-U*.md` and of `final/notes-leftovers.md` if it exists, `final/brief-leftovers.md` (those rows are being done now: do not list them again), `docs/state-machines.md`, `tests/lint.test.ts` (what is already held, and every allow-list in it).

## Steps

1. **The first audit's rows, checked.** For each of the 90 rows: done (the implicit thing is gone, and a test or lint would catch its return), done in part (what remains, file and line), not done, or left on purpose with a reason that still holds. Read the code for each; a unit's notes saying "done" is not evidence. The eight rows the first audit left (8, 14, 45, 49, 55, 60, 61, 81): does each reason still hold? Commit.
2. **The inventory again, on the code as it is.** The same eight kinds, the same greps, file by file through `src/views`, `src/edge`, `src/app.js`, `src/sw.js`, `server.ts` and `src/core`. This time also read in full what the first audit skipped (its section "What I did not read, and why"): `motion.ts`, `patch.ts`, the fight's modules in `src/core/combat`, the kits' files, `scripts/` where a script writes a checked file. Read hardest where the last lead merged late in a long session, since those merges are suspect: U12 into the seat work (`7207cef`), the fight screen's rows (`eb029ab`), the GM view (`e471f75`), the store (`7cbdf42`), and U14 (`977c46d..e8504bf`). In each, look for one rule written twice, a state that two writers set, and a deleted thing that still has a caller or a test. One row per finding: file and line, kind, the hidden state or rule in one sentence, what a player or GM would see if it went wrong (or "nothing: internal"), how sure you are. Do not list a hit you have not read. Commit.
3. **Every lint allow-list.** For each entry of each allow-list in `tests/lint.test.ts`: is its reason still true, or is it an implicit thing with a permit? List the ones that should be fixed instead of allowed. Commit.
4. **The judgment and the summary.** For each finding of steps 1 to 3: a machine, a union, a pure core step with a test, a lint, delete it, or leave it with the reason. Group them into units with their files and tests, ordered by what a player would notice first. At the top: the count by kind, the ten most likely to bite a player, the units in order, what you did not read and why. If the honest answer is that little is left, say so and list only what is real; do not pad the list. Under 400 lines. Commit.

Reply in at most 250 words: the commit range, the first audit's rows by verdict, the count of new findings by kind, the ten worst, the units.
