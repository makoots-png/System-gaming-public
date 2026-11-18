# Brief, unit 0: subtract before the rework adds (no behaviour change)

One helper (Sonnet, writer), in the main tree. Commit after each numbered step with `git commit -m "..." -- <paths>` (plain message, no AI attribution, no Co-Authored-By; this overrides "do not commit" in your built-in text). Do not push. Do not start helpers. Never edit `.claude/skills`. Do not run `bun run ci` (a push may be using port 3218); your checks are `bun run test` and the browser files named below on your own port: `E2E_CHROMIUM=/opt/pw-browsers/chromium E2E_PORT=3241 bunx playwright test tests/e2e/<file> --workers=1 --trace off --output=/tmp/pw-u0`. Another helper works in a separate worktree on new files under `src/core/combat/`; you do not touch `src/core/combat/`.

Read first: `AGENTS.md`, `docs/agent-handoff/rw/principles.md`, `docs/agent-handoff/rw/inventory.md` sections 2.1 to 2.3, `.claude/skills/principle-subtract-before-you-add/SKILL.md`, `.claude/skills/principle-laziness-protocol/SKILL.md`, `.claude/skills/principle-minimize-reader-load/SKILL.md`, the playbook `.claude/skills/poteto-mode/playbooks/refactoring.md`, `.claude/skills/unslop/SKILL.md`.

## Why (the owner's goal)

the owner is reworking the fight and the stats of his tabletop app (eight stats in place of six, Armor and Resist in place of AC). He asked that the principle skills shape the architecture, "subtract before you add" first. Today the list of stats and their labels is repeated in about eight places, so changing a stat means eight edits. This unit leaves one list and one label table, with no change a player or GM can see, so the rework's stat change is one edit.

## Steps

1. **One `STAT_KEYS`.** `src/core/save.ts:51` declares a second `STAT_KEYS` and `StatKey`. Delete them and import from `src/core/rules.ts` (check the import does not make a cycle; if `rules.ts` imports `save.ts`, move the list to a new small `src/core/stats.ts` that both import, and re-export nothing). Delete the test in `tests/rules.test.ts` that only checks the two lists are equal. `bun run test`. Commit.
2. **One label table.** Six view files keep their own label map of the nine bonus keys (`custom.js:13`, `maker.js:13`, `loot.js:18`, `inventory.js:11`, `hunter.js:18-20`, and `skills.js:12` keeps its own key list). Put one table next to `PERK_KEYS` in core (`PERK_LABELS`, a `Record<PerkKey, string>` so the typecheck asks for every key; reuse `STATS` for the six stat labels) and have each view read it through `src/edge/rules.ts` if that is how views reach the rules today (read how `STATS` reaches a view and do the same). Where two maps disagree on a label today, keep each screen's words exactly as they are by passing the differing word at that call site, and list the disagreements in `docs/agent-handoff/copy-tasks.md` (append). Delete the maps. `bun run test`. Commit.
3. **Dead numbers.** `carry` is computed in `src/views/hunter.js:124` and typed in `src/core/api.ts:29` and read by nothing. Confirm with grep, then delete both. Look in `derived()` and `Derived` for any other field no file reads and delete it the same way; list each in the notes with the grep that showed it dead. `bun run test`. Commit.
4. **Check.** `bun run test` passes. Run these browser files on port 3241, one at a time: `character.e2e.ts`, `makers.e2e.ts`, `customization.e2e.ts`, `layout.e2e.ts`, `look.e2e.ts`. A browser test that fails twice is not load: read the error. Run `bun run deps -- --write` and commit what it changes.

## Rules

- No behaviour change. No screen shows a different word, number or order. If a deletion would change one, leave it and say so in the notes.
- Do not add an abstraction with one caller. Fewer lines after than before; give the count (`git diff --stat` from your first commit's parent) in the notes.
- Notes file `docs/agent-handoff/rw/notes-u0.md`, written as you go.

## Done means

One `STAT_KEYS`, one label table, no `carry`; `bun run test` green; the five browser files green; three to five commits; the tree clean.

## Time

40 minutes. Reply in at most 150 words: the commit range, lines removed and added, the exact last line of `bun run test`, anything you left.
