# Brief, unit 4: the GM's fight on a phone, the desktop, and the after set

One helper (Opus, heavy-writer), in the main tree. You commit after each numbered step (plain message, no AI attribution, no Co-Authored-By; this overrides "do not commit" in your built-in text). Do not push. Do not start helpers of your own. Never edit anything under `.claude/skills`.

Read first: `AGENTS.md`, `docs/agent-handoff/ui-pass/design.md` (the decisions; they are settled), `docs/agent-handoff/ui-pass/notes-1-look.md` (unit 1's classes and tokens: use them), `docs/agent-handoff/ui-pass/audit.md` entries A2, A3, A19, A20 and "What looks good and should not be touched", `.claude/skills/principle-experience-first/SKILL.md`, `.claude/skills/principle-test-behavior-not-implementation/SKILL.md`. Look at the images each entry names in `docs/agent-handoff/ui-pass/before/` before you change its screen.

## Why (the owner's goal)

the owner runs the fight from his own device, often a phone, while his players watch theirs. He asked for the app to be "clearly nicer and easier to use for both players (mostly on phones) and the GM", with combat readable during a fight. At a glance he must see whose turn it is, who is down and which statuses are on whom.

## Steps

1. **The turn order first on a phone (A3).** Under 900 px the order comes before the selected card, compact: the current row marked, a thin HP bar, the status words, a mark for a combatant who is down. A tap on a row selects it and brings its card into view. At 900 px and wider nothing changes (`gm-1280-26` is good). Tests at 390 by 844: with a running fight of one hunter and two monsters, the row of whoever's turn it is is in view without scrolling, and after Next the mark moves; a monster at 0 HP shows its down mark in the order.
2. **The Table feed (A2).** One collapsed line with a count of new rows; not sticky when there is nothing new; a tap opens it. It never covers a card's buttons. Test: in a running fight at 390 by 844 with an empty feed, Mark defeated on the selected card can be tapped without scrolling the feed away; when a player's roll arrives, the count shows.
3. **The desktop nav (A19).** One row at 1280 by 800. Measure it in a test (every tab's top is the same). Do not hide a view.
4. **Desktop width (A20).** Workshop entries in a grid of cards at 900 px and wider. Data and the rules reference get a reading width of about 70 characters. The GM view's Award form and collapsed sections use the width (two columns) at 1100 px and wider. Phone layouts do not change. A test that the Workshop shows two entries side by side at 1280.
4a. **A GM opens on the GM view.** Unit 2 found that a GM's phone opens on the Status view (`route()` in `src/app.js`), so every maker is one tap further than it need be. A phone that is the GM (`app.isGM()`) opens on the GM view when no view is named in the address; a player opens on Status as now. Test both. Update the tap counts `tests/e2e/makers.e2e.ts` asserts, and write the new counts in the notes.
4b. **The teal box.** In `before/gm-390-04-maker-status-top.png`, and still after unit 2, a filled teal rectangle of about 115 by 45 px sits over the right end of the Name field of the status maker. Find what draws it (run the script with a pause and inspect the element at that point). If the app draws it, fix it at its cause; if only the script causes it, fix the script. Say which in the notes.
5. **Run everything.** `E2E_CHROMIUM=/opt/pw-browsers/chromium bun run ci`.
6. **The after set.** `PORT=3261 bun server.ts &`, `bun scripts/ui-shots.ts --url http://localhost:3261 --out docs/agent-handoff/ui-pass/after`, stop the server. The file names must match `before/` so each pair lines up: where units 1 to 3 changed a flow so that a shot no longer exists, keep the name and shoot the screen that replaced it, and list those in the notes. Look at every image with the Read tool, both roles. For anything that looks wrong: fix it if it is a few lines of CSS in a screen this run changed, otherwise list it in the notes with the image name. Commit the images.

## Rules

- No change to the fight reducer, `save.ts` shapes or the room protocol. This unit is layout.
- A test that pinned the old layout is rewritten to the new one, never deleted or skipped.
- Use unit 1's classes. Keep 44 px targets and 16 px inputs on a phone. No hard-coded colours.
- After a change to `app.api`, events, views or panels: `bun run deps -- --write`.
- Notes as you go in `docs/agent-handoff/ui-pass/notes-4-fight-desktop.md`: per step what changed and its test; for step 6 a table of every finding id A1 to A33 with its before image, its after image and one line on what a person now sees, or "not changed" with the reason.

## Done means

`bun run ci` passes (quote its last lines in the notes). Each step is its own commit. `ui-pass/after/` is committed. The notes file is committed.

## Time

75 minutes. If you are not at step 5 by minute 45, finish the step you are in at a passing state, commit, list the remaining steps in the notes, and go on to steps 5 and 6. Reply in at most 200 words: the commit range, the CI counts, what still looks wrong, anything unsure.
