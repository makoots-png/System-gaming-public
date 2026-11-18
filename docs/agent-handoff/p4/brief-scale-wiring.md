# Brief: status scaling reaches every source and every screen (phase 4, unit B)

One helper (Opus, heavy-writer), in the repo root on the checked-out branch, after unit A is merged. No other helper writes app code in this tree.

Read first: `AGENTS.md`, `docs/agent-handoff/helper-rules.md`, `docs/agent-handoff/p4/design.md` (the decided model), `docs/agent-handoff/p4/status-audit.md` sections 2, 4 and 5 (every path and every screen, with lines), `docs/agent-handoff/p4/notes-scale-core.md` (what unit A built and named). Principle skills: `principle-model-the-domain`, `principle-boundary-discipline`, `principle-fix-root-causes`, `principle-make-operations-idempotent`, `principle-test-behavior-not-implementation`, `principle-experience-first`, and `tdd`. Where this brief and the rules differ, this brief wins.

Commit after every numbered step (name the files, plain messages, no AI attribution, no Co-Authored-By). Do not push. Do not start helpers of your own. Never edit anything under `.claude/skills`.

Browser runs: `E2E_CHROMIUM=/opt/pw-browsers/chromium E2E_PORT=3241 bunx playwright test tests/e2e/<file> --workers=1 --trace off --output=/tmp/pw-wiring`. Never run `playwright install`. Rerun a file once before reading anything into one failure.

Notes file (append a line after each commit): `docs/agent-handoff/p4/notes-scale-wiring.md`.

## Why (the owner's goal)

"The scaling should be largely decided by the strength of the user/item." Unit A made a status's numbers follow its source's tier in the core. The audit found that most paths drop the source, so today only a monster's ability chip would scale. This unit makes the source arrive on every path, and shows the scaled numbers wherever a status's numbers are shown ("Show the scaled values wherever an effect's numbers are shown, and keep the GM's custom-rule overrides working").

## The decided rules

- The source travels with the status everywhere a status travels. No path builds a status without one where a source is known.
- Tiers: a monster, shadow or hunter is its rank's (E 0 to S 5). An item is its rarity's index in `RARITIES` (common 0 to mythic 5), kind `item`, named after the item. A status applied by hand with nobody acting (the sheet's own picker, the GM board, + Status outside a running fight) is kind `gm` with the target's own rank as its tier. + Status in a running fight keeps taking the combatant whose turn it is.
- A phone applies a status it receives with the core's `applyStatus`, so the higher tier wins and the longer duration stays, as in a fight. The remove-then-add in `src/edge/room-events.ts` goes.
- An instance shows its own tier's numbers. A definition with no instance shows all six (unit A's `describe`).

## Steps

Each step: failing test first where a test can see it, then the change, then `bun run test`.

0. **Restate the simulation's bounds** (`tests/status-sim.test.ts`), as `design.md`'s last section decides. No `test.failing` stays. The bounds apply at C and S and sort a target by how long the attackers need for it, measured in the same run: 4 rounds or more, each status party within 0.8 to 1.25 of the attackers; under 3 rounds, no status party faster. A target between 3 and 4 rounds gets no bound. The E rows are still played and printed and carry no bound; one comment says why in a sentence and points at `design.md`. Do not change a curve.

1. **The room carries the source.** `StatusGrant` in `src/core/protocol.ts` gets the source (bounded by the existing source parser in `status.ts`; optional only if a real sender has none, and then say which). Its case in `VALID` and a case per bound in `tests/protocol.test.ts`. `sendRemote` in `src/views/combat.js` sends the source the reducer kept on the GM's row. `remoteCombatant` keeps the source of each status it reads from a sheet. The room model (`tests/models/room-world.ts`) carries it if it models a status grant.
2. **A phone applies a received status through `applyStatus`** (`src/edge/room-events.ts`). Tests in the file that covers appliers: a weaker grant does not replace a stronger one, and a shorter one does not shorten it. The event stays applied at most once.
3. **An item is a source.** `inventory.use` and `applyOps` (`src/views/inventory.js`, `src/views/effects.js`) pass a real source for the item (its rarity's tier), and `addCondition` in `src/views/hunter.js` takes a source and stores it. The typed signature in `src/core/api.ts` changes with it. The rule "which tier is this item" is one pure function in the core with a test, not arithmetic in a view.
4. **By hand.** The sheet's picker, the GM board's status to a local or remote hunter, and + Status outside a running fight build a `gm` source with the target's rank. `defaultSource` in `src/core/combat/encounter.ts` covers the fight's part (it needs the target; tests in `tests/encounter.test.ts`, including the existing source-tier test, which changes for the GM case and for nothing else).
5. **Percent ticks.** `rollTick` in `combat.js` and the item use path in `effects.js` roll a numeric op through unit A's function with the target's max HP, so `3%` works on a monster, a local hunter and a remote hunter, and on an item's heal. One reducer or effects test per target kind is enough; no built-in uses a percent.
6. **Every screen.** Go through the audit's section 4 table row by row. A row that prints an instance's numbers needs no change if it reads through `statusDef` or `describe` with the instance: check each by reading it, and fix the ones that pass a bare def. Rows that print a definition (the rules reference list and table, the GM status library, the forge's Apply existing chips, the item card's "Applies Burning (3 rounds)") show the six values or, where the tier is known (an item's rarity, the combat card's ability chip for that monster's rank), that tier's value. The combat log's "X is Burning for 3 rounds" may stay as it is. List every row and what you did in the notes. New strings go in `docs/agent-handoff/copy-tasks.md` as TODO(copy).
7. **Browser tests**, in the files that already cover each place (`character.e2e.ts`, `combat-turns.e2e.ts`, `table-session.e2e.ts`, `room-sync.e2e.ts`, `customization.e2e.ts`), named by what the table sees:
   - a C-rank monster's Burning takes 3d8 from a hunter at the start of the hunter's turn, and an E-rank monster's takes 1d6 (seed the dice as `character.e2e.ts` does);
   - a status the GM puts on a remote hunter in a fight shows the same scaled numbers on the player's phone as on the GM's card;
   - an item of a higher rarity applies a stronger status than a common one;
   - a GM override of a built-in's ops with a flat number is flat at every rank, and a forged custom status is unchanged;
   - the rules reference shows a scaled status's six values.
8. `bun run test`, `bun run deps -- --write`, `bun run charts`, then the full `E2E_CHROMIUM=/opt/pw-browsers/chromium bun run ci` once. Read `AGENTS.md`'s lines on statuses and the fight once and correct anything that became untrue.

## Rules

- No reader outside `status.ts` handles `tiers`, and no view computes a tier: it asks the core.
- No parallel old and new paths.
- Wording is not yours to polish: plain strings, listed in `copy-tasks.md`.
- A tier picker for the GM ("apply this as an A-rank source") is not in this unit. If the code makes it a few lines, say so in the notes for the customization phase.

## Done means

`bun run ci` passes. Final reply under 200 words: the commit range, the last lines of `bun run ci`, what a table will notice (a short list), anything you were unsure of or left out.

If you are still going after about 80 minutes of work, commit what passes, write exactly where you are in the notes, and reply.
