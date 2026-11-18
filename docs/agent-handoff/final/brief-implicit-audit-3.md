# Brief: the files neither audit read in full (read only, one file)

One helper (Opus, heavy-writer). You change no code and no test. You write `docs/agent-handoff/final/implicit-audit-3.md` and commit it by path after each group of files (plain message, no AI attribution). No push, no helpers, no bun, no tsc, no browser, never `git checkout`/`stash`/`reset`. Another helper is editing the tree: read committed content with `git show HEAD:<path>` for any file `git status` shows modified.

Work in poteto mode: read `.claude/skills/poteto-mode/SKILL.md` and START-HERE's section "Every helper works in poteto mode" first.

## The goal, in the owner's words

"Everything must be explicit. Everything." "Where else might we have implicit state machines or other implicitness? We must root them out and rectify them." Two audits searched every file, but each read some files only around a search hit. A search finds the patterns someone thought of. The problem is that nobody has read these files from top to bottom, so an implicit thing with no keyword in it is still unseen. You read each one whole.

## Read first

`AGENTS.md`, `final/brief-implicit-audit.md` (the eight kinds: they are yours), `final/implicit-audit-2.md` (its summary, step 2 and step 4, so you do not list a finding again), `final/brief-leftovers.md` (rows being done now: do not list them), `tests/lint.test.ts`.

## The files, each read in full, in this order

1. `src/views/hunter.js`, `src/views/bestiary.js`, `src/views/shadows.js`, `src/views/starter.js`
2. `src/views/workshop.js`, `src/views/loot.js`, `src/views/reward-editor.js`, `src/views/forge.js`, `src/views/map-maker.js`, `src/views/effects.js`, `src/views/detail.js`, the kits' view files (`kit-parts.js` and any other `kit*` file in `src/views`)
3. `src/views/motion.ts`, `src/views/map.js`, and the parts of `combat.js`, `gates.js`, `gm.js`, `table.js`, `quests.js`, `inventory.js`, `room.js`, `coin.js`, `custom.js`, `skills.js`, `maker.js`, `io.js` and `server.ts` that the second audit did not cite (it read those only around its hits)
4. `src/core/combat/*.ts`, `src/core/worth.ts` and the kits' core files: here look for kinds 3, 4 and 5 and for a rule written twice between two modules. The charted tables are tested; the code around them (parsers, the doc's builders, the save's shape of a fight) is where to look.

For each file write one line even when you find nothing: "read in full, lines 1 to N, nothing" so the lead knows it was read. One row per finding: file and line, the kind (1 to 8), the hidden state or rule in one sentence, what a player or GM would see if it went wrong (or "nothing: internal"), how sure you are, and the remedy (machine, union, step, lint, delete, or leave with the reason). A plain UI value such as which tab is lit is not a finding. If a file is clean, say so; do not pad.

At the top when done: the count by kind, the findings a player could meet, and which of the second audit's units (V1 to V8) each finding belongs with, or a new unit with its files and tests. Under 300 lines.

Reply in at most 200 words: the commit range, files read, findings by kind, the ones a player could meet, the units.
