# Brief: the reward editor, bundles, boons and the GM's use log on screen (customization, unit 4c)

One helper (Opus, heavy-writer), in the main tree, on branch `claude/zen-pasteur-ov4cgd`. No other helper writes while you work. Earlier units are merged; read their notes in `docs/agent-handoff/cz/` (`notes-1-homes.md`, `notes-2-skills.md`, `notes-3-rewards.md`, `notes-4a-makers.md`).

Run `bun install` once. Read first: `AGENTS.md` (the recipe "A maker"), `docs/agent-handoff/helper-rules.md`, `docs/agent-handoff/cz/design.md`, `docs/agent-handoff/cz/inventory.md` sections 1 and 2. Principle skills: `principle-experience-first`, `principle-minimize-reader-load`, `principle-migrate-callers-then-delete-legacy-apis`, `principle-test-behavior-not-implementation`, and `unslop`.

Commit after every numbered step (name the files, plain messages, no AI attribution, no Co-Authored-By). This overrides the "do not commit" line of your built-in rules. Do not push. Do not start helpers of your own. Never edit anything under `.claude/skills`. Also read `notes-4b-skill-enemy.md`.

Browser runs: `E2E_CHROMIUM=/opt/pw-browsers/chromium E2E_PORT=3243 bunx playwright test tests/e2e/<file> --workers=1 --trace off --output=/tmp/pw-cz4c`. Never run `playwright install`. Rerun a file once before reading anything into one failure.

Notes file (append a line after each commit): `docs/agent-handoff/cz/notes-4c-rewards-ui.md`.

## Why (the owner's goal)

"...custom rewards... and ways to notify me when players have used rewards." The reward type now holds a title with its bonus, skills, statuses and boons (text rewards the GM honours at the table), bundles are stored, and a use reaches the GM's log once. The screens are still the plain ones unit 3 left. A GM must build a reward in under a minute, reuse it, and see at a glance who used what.

## Steps

Each step ends with `bun run test`, the browser file it names, and a commit.

1. **One reward editor** on `app.api.maker` (a component both forms embed, in a new `src/views/reward-editor.js` or where rewards live; say which). It edits a whole `Rewards`: XP, gold, points as three number fields in one row; then chips that add a row: Item (from the library, the shop, the built-in tables, or "New item…"; many; each with quantity and a "Tell me when used" box), Title (a built-in by name, or a new one: name, description, the bonus fields), Skill (the built-in table, the library, or "New skill…"), Status (from the rules, with rounds), Boon (name and text; a line under it says the player redeems it and you are told), Job (as today). A "Bundle" row at the top: a select of saved bundles that fills the editor, and "Save as bundle…" that asks a name (same name replaces). The live preview is the reward window's lines as the player will see them. Its answer passes `parseRewards` unchanged.
2. **The GM's Award form and the quest form use it.** Delete the Award form's single-item fields, the two private item pickers and the quest form's `Name | rarity | qty` text lines (the inventory lists them), and unit 3's plain bundle select. The GM's quick "Issue quest" keeps its few fields and gains nothing. The fight's "Award loot…" (unit 4b) opens the Award form with the editor filled.
3. **Boons on the sheet**: a "Boons" block where a hunter's titles are (or a panel like Titles; follow the sheet's pattern), each with its name, text and a Redeem button that confirms and then removes it and reports it (unit 3's path). A GM looking at a local hunter can also remove one. An empty block is not drawn.
4. **The GM sees uses.** The Table feed row for a use is readable at a glance: who, what, and the outcome words, with "Apply to…" when it has a target. The Session log's `use` filter is one tap from the GM view's top ("Reward uses", with a count of uses since the GM last opened it; the count is derived from the log and a last-seen time kept in the GM's settings or device prefs, not a second list). The notification button from unit 3 sits beside it with its state in words.
5. **The Workshop's Rewards section** (unit 4b left a place): bundles with New (opens the reward editor alone), Edit, Duplicate, Delete, and "Award…" which opens the Award form with the bundle loaded.
6. **Browser tests** in `tests/e2e/makers.e2e.ts` and a room file (copy `tests/e2e/room-sync.e2e.ts`), through the UI on phone viewports:
   - a GM builds a reward with 100 XP, an item marked "Tell me when used", a new title "Wolf Slayer" with +2 STR, a status and a boon "One free reroll", sees the preview, saves it as the bundle "Wolf hunt", and awards it to a player in a room; the player's phone shows the reward window and the sheet shows each part;
   - the player redeems the boon: it leaves the sheet; the GM's phone shows the feed row, the toast, the "Reward uses" count goes to 1, and the log holds one line with the player's name, the boon's name and its text;
   - the player uses the told item: a second line; an item without the mark writes none;
   - the GM reloads and the two lines are still there, once each;
   - a second campaign night: the GM opens the Workshop, taps Award on "Wolf hunt" and sends it again in a counted number of taps (in the test's name);
   - a quest made with the editor pays its reward on completion, the boon included;
   - solo (no room): redeeming a boon writes the log line on that phone.
7. `bun run test`, `bun run deps -- --write`, every e2e file that touches the GM view, quests, rewards, the table or rooms. `AGENTS.md`: a recipe "A reward field" (the type, `parseRewards`, `applyRewards`, the editor's row, the reward window's line) and the line for the use log.

## Rules

- A use is shown once. The count is derived, never stored as a number that can drift.
- One-handed at 390 px: controls at least 44 px tall, no horizontal scroll, the Save bar above the keyboard.
- Words go to `docs/agent-handoff/copy-tasks.md`.
- Views stay JavaScript and pass `tsconfig.views.json`.
- If a step needs a decision the design does not make, choose the smaller option, write it in the notes under "Decided by the helper", and go on.

## Done means

`bun run test` passes and the browser files pass. Final reply under 200 words: the commit range, the counts, the tap counts, what you decided yourself, anything unsure.

If you are still going after about 90 minutes of work, commit what passes, write exactly where you are in the notes, and reply.
