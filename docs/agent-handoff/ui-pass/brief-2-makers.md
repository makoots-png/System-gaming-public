# Brief, unit 2: the creation flows

One helper (Opus, heavy-writer), in the main tree. You commit after each numbered step (plain message, no AI attribution, no Co-Authored-By; this overrides "do not commit" in your built-in text). Do not push. Do not start helpers of your own. Never edit anything under `.claude/skills`.

Read first: `AGENTS.md`, `docs/agent-handoff/ui-pass/design.md` (the decisions; they are settled), `docs/agent-handoff/ui-pass/notes-1-look.md` (the classes and tokens unit 1 made: use them, add none that repeats one), `docs/agent-handoff/ui-pass/audit.md` entries A1, A9, A11, A12, A21, A24, A25, A26, A31, A33 and its table of taps, `.claude/skills/principle-experience-first/SKILL.md`, `.claude/skills/principle-test-behavior-not-implementation/SKILL.md`. Look at the images each entry names in `docs/agent-handoff/ui-pass/before/` before you change its screen.

## Why (the owner's goal)

"We're optimizing for customizability. The ability to make custom abilities, status effects, custom rewards, items, enemies, etc... and ways to notify me when players have used rewards." A GM makes each kind from a phone in under a minute. Today a skill takes 13 taps, an enemy 10, an item 9, a status 8, and every maker is two taps from home. This unit makes the makers quicker to reach, shorter and less confusing.

## Steps

1. **The Workshop status maker (A1).** `forge.status` gets a mode (a union, not a boolean pair): applying to a target, or making for the library. In the Workshop: no Rounds, no "Apply existing", no "Save to library", the button says "Save status". Test in `tests/e2e/makers.e2e.ts`: from the Workshop, New status shows none of the three and saves with one button.
2. **One tap for a built-in status in a fight (A24).** As the design says. Tests: the tap count for applying Poisoned from a combat card is one tap after the window opens; a status applied this way has the rounds and strength the fields show. Update the tests that pinned two taps.
3. **Makers from home (A9).** The Make row at the top of the GM view, as the design says. Each button opens the same maker the Workshop opens (call the same `app.api` member; add none). Test: from the GM view at 390 by 844, each of the five opens its maker in one tap. Update the tap counts `makers.e2e.ts` asserts and write the new counts in the notes.
4. **The item maker (A11).** As the design says. The worn block shows by type. The three fixed fields go from the form; an item that holds them still loads, and opening it in the maker shows them as effect rows. `parseItem` keeps reading them. Tests: a consumable shows no slot and no worn bonus; a weapon does; an item saved before with Heals HP 10 opens with a Heal row and still heals 10 when used.
5. **A skill's value at the monster's rank (A12).** The monster card in a fight and the enemy maker's preview print the one value for that monster's rank. Find the function that prints all six (`describe` in `src/core/combat/status.ts`) and give the caller the rank through the path that already resolves a tier; do not format in the view. A unit test in the file that tests `describe`, and the card in a browser test.
6. **The skill maker (A21) and its taps.** Two columns at desktop width like the status and item makers. Then cut taps on a phone where a default does it: say in the notes which fields now start filled and why each default is the common case. The target is 10 taps or fewer for the skill of the existing test (a target, a to-hit, by-rank damage and a status). If you cannot reach it without hiding something a GM needs, stop at what is honest and say what the count is.
7. **Small ones.** A25 (the "×" stays on its row at 390). A26 (Enter in a reward editor text field does not submit the quest form; test it). A33 (a tap on a Workshop row edits; Duplicate, Share and Delete behind one "⋯"; Delete is danger and still asks). A31 (the session log shows a use's title and text as two parts; the share code box shows the whole code or scrolls).
8. **Run everything.** `E2E_CHROMIUM=/opt/pw-browsers/chromium bun run ci`. Then `PORT=3261 bun server.ts &`, `bun scripts/ui-shots.ts --url http://localhost:3261 --out <scratch>/after-2`, stop the server; fix the script where your changes moved its taps; look at every maker image at 390 and at 1280.

## Rules

- A maker saves the same data as before through the same parser. No change to `save.ts` shapes, the room protocol or the reducers. If a step seems to need one, stop that step and write why in the notes.
- A test that pinned the old behaviour is rewritten to the new one, never deleted or skipped.
- Use unit 1's classes. Keep 44 px targets and 16 px inputs on a phone. No hard-coded colours.
- Wording you would change goes in `docs/agent-handoff/copy-tasks.md`, except the labels the design names.
- After a change to `app.api`, events, views or panels: `bun run deps -- --write`.
- Notes as you go in `docs/agent-handoff/ui-pass/notes-2-makers.md`: per step what changed, the tap counts before and after (run, from the tests), what you left.

## Done means

`bun run ci` passes (quote its last lines in the notes). Each step is its own commit. The notes file is committed.

## Time

75 minutes. If you are not at step 8 by minute 55, finish the step you are in at a passing state, commit, list the remaining steps in the notes, and run step 8. Reply in at most 200 words: the commit range, the CI counts, the tap counts, anything unsure.
