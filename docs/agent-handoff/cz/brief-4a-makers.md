# Brief: the shared maker, the status maker and the item maker (customization, unit 4a)

One helper (Opus, heavy-writer), in the main tree, on branch `claude/zen-pasteur-ov4cgd`. No other helper writes while you work. Units 1 to 3 are merged; read their notes (`cz/notes-1-homes.md`, `cz/notes-2-skills.md`, `cz/notes-3-rewards.md`).

Run `bun install` once. Read first: `AGENTS.md`, `docs/agent-handoff/helper-rules.md`, `docs/agent-handoff/cz/design.md` (sections "Statuses", "Items", "Makers"), `docs/agent-handoff/cz/inventory.md` section 2 (the forms today and the Status dialog's pattern), `docs/agent-handoff/p4/design.md` (what `tiers` and `pct` mean). Principle skills: `principle-experience-first`, `principle-minimize-reader-load`, `principle-migrate-callers-then-delete-legacy-apis`, `principle-subtract-before-you-add`, `principle-test-behavior-not-implementation`, and `unslop`.

Commit after every numbered step (name the files, plain messages, no AI attribution, no Co-Authored-By). This overrides the "do not commit" line of your built-in rules. Do not push. Do not start helpers of your own. Never edit anything under `.claude/skills`.

Browser runs: `E2E_CHROMIUM=/opt/pw-browsers/chromium E2E_PORT=3243 bunx playwright test tests/e2e/<file> --workers=1 --trace off --output=/tmp/pw-cz4a`. Never run `playwright install`. Rerun a file once before reading anything into one failure.

Notes file (append a line after each commit): `docs/agent-handoff/cz/notes-4a-makers.md`.

## Why (the owner's goal)

"The ability to make custom abilities, status effects, custom rewards, items, enemies, etc..." He runs the game from a phone, one-handed, on a 390 px screen. A GM must make a status or an item in under a minute, see in the game's own words what it will do before saving, and never type JSON. Today the Status dialog and the Loot Forge each have their own focus trap, chips and effect rows, neither shows a live preview, and neither can write a number that scales by rank or a percent. This unit builds the one module every maker uses and moves these two makers onto it. Units 4b and 4c add the skill, enemy and reward makers on the same module.

## What to build

`src/views/maker.js`, registered like any view module, exposing through `app.api.maker` (typed in `src/core/api.ts`) only what a second maker needs:

- **The shell**: one function that opens a maker dialog from a title, a body builder and Save and Cancel, and answers a Promise. It owns the focus trap, Escape and Enter, the fit to the visual viewport when the keyboard opens, and the sticky bar. The four private copies (`forge.js`, `loot.js`, and those listed in the inventory) go.
- **Chips**: toggle chips with `aria-pressed` and exclusive groups.
- **The bonus fields**: the nine bonus inputs, built once (three copies exist: `inventory.js`, `skills.js`, `hunter.js`).
- **The effects editor**: a list of rows, one per op, over the whole op vocabulary (`heal`, `damage`, `mp`, `fatigue`, `mod`, `applyStatus`, `cureStatus`, `note`). A row has its kind, its quantity, and for a numeric op or a mod a three-way choice of Flat, By rank, or (heal and damage only) Percent of max HP. By rank shows six small number or dice inputs in one row labelled E D C B A S (or the six rarities when the editor is told the thing is an item), prefilled with the flat value. `applyStatus` picks a status from the rules (and offers "New status…", which opens the status maker and comes back with its key) and rounds. Quick chips add a ready row in one tap (keep the Status dialog's eleven and the Loot Forge's eight where they still make sense; a chip that mirrors a built-in status's op copies that built-in's `tiers` when "By rank" is chosen). The editor answers `Op[]` and every answer passes `sanitizeOps` unchanged: an op the parser would drop is shown as an error on its row, and Save stays off. At most 8 rows (the parser's bound), with the Add control off at 8. An op it is given always has a row: nothing is "kept but not shown" any more, so the "Also keeps N other effects" notes go.
- **The live preview**: under the editor, the lines `describe` (or `describeItem`) gives for the thing as it stands, redrawn on every change. For "By rank" it shows the six values as `describe` prints them.

## Steps

Each step ends with `bun run test`, the browser file it names, and a commit.

1. **The shell, chips and bonus fields**, with the Status dialog, the Loot Forge and the other dialogs that had a private focus trap moved onto the shell, and the three bonus-field builders replaced. No behaviour change. Run every e2e file that opens one of these dialogs.
2. **The effects editor and the preview**, first inside the Status dialog (it replaces the quick chips' private table, "More…", and the kept-ops note). The Status dialog keeps its shape: "Apply existing" chips, or name a new one. On a touch screen an existing status's description is not reachable today (it is a `title` tooltip): a long press or a small "i" on a chip is not needed; instead, picking an existing chip shows its `describe` lines in the preview with the Apply button, so one tap previews and the second applies. When the dialog is opened to put a status on someone by hand, a "Strength" row picks the rank (E to S, default the target's rank; the caller passes it) and the answer carries `source: gmSource(rank)`; `combat.js` and `gm.js` already pass a source (`p4/notes-scale-wiring.md`, last lines). The preview shows the numbers at the picked rank.
3. **The item maker on the same module** (`loot.js`): one form with everything an item has. Type chips, rarity, slot, dice for a weapon, quantity, value, description, the bonus fields (the forge had none), the effects editor told "item" (so By rank is by rarity), the `target` choice ("Affects: the user / a target") shown when it has a use effect, and "Tell me when it is used" (`tell`), off by default. The inventory panel's "Add / edit item" form opens this maker instead of its own fields (a player may still edit an item they hold, as today; the `tell` box shows only to a GM). The legacy heal, MP and fatigue number fields of a consumable stay as fields if the item type still stores them (`heal`, `restoreMp`, `fatigue` on `Item`); say in the notes whether folding them into effects would be a clean follow-up, and do not do it here.
4. **Browser tests**, in `tests/e2e/makers.e2e.ts` (new; copy `tests/e2e/character.e2e.ts` for the setup; phone viewport), each driving the maker through the UI and reading the result from the store and from the game:
   - a GM makes a status "Frostbite" with damage by rank (changes the S value), sees six values in the preview, saves; the library holds the `tiers` op; applied to a monster at rank C in a fight, the card shows the C value;
   - a GM makes a status with 5% of max HP damage a turn; the preview says so; a monster with 200 max HP loses 10 at its turn start;
   - a GM applies an existing status by hand at Strength A to an E-rank target and the card shows the A numbers;
   - a GM makes a consumable "Bottled Storm" with a target, 2d6 damage and a status, sees the preview, saves to the library; reopened with Edit, every field and effect is as saved;
   - a GM makes a ring with +1 AC by rarity and a +2 STR bonus; a hunter who equips it has the AC of its rarity and the STR;
   - a row the parser would drop (dice "abc") shows its error and Save is off;
   - the making of the status and of the item each take no more than a counted number of taps from the GM's home screen; write the count in the test's name and in the notes.
5. `bun run test`, `bun run deps -- --write`, every e2e file that opens a dialog. `AGENTS.md`: a recipe "A maker" (the shell, the effects editor, the preview, where its test goes) and one line in "Where things live".

## Rules

- A maker saves only what the kind's parser gives back for it. Parse, then compare with what the form holds; a difference is a bug in the form.
- One-handed at 390 px: every control at least 44 px tall, no horizontal scroll, the Save bar always reachable above the keyboard. The UI run polishes looks later; this unit gets the structure and the taps right.
- No new op, no formula field. A thing the ops cannot say is a `note` line the GM rules on.
- Words go to `docs/agent-handoff/copy-tasks.md`.
- Views stay JavaScript and pass `tsconfig.views.json`. `maker.js` holds no game rule: it builds forms and calls the parsers.
- If a step needs a decision the design does not make, choose the smaller option, write it in the notes under "Decided by the helper", and go on.

## Done means

`bun run test` passes and the browser files pass. Final reply under 200 words: the commit range, the counts, the tap counts, what you decided yourself, anything unsure.

If you are still going after about 90 minutes of work, commit what passes, write exactly where you are in the notes, and reply.
