# Brief, unit 3: what a player touches

One helper (Opus, heavy-writer), in the main tree. You commit after each numbered step (plain message, no AI attribution, no Co-Authored-By; this overrides "do not commit" in your built-in text). Do not push. Do not start helpers of your own. Never edit anything under `.claude/skills`.

Read first: `AGENTS.md`, `docs/agent-handoff/ui-pass/design.md` (the decisions; they are settled), `docs/agent-handoff/ui-pass/notes-1-look.md` (unit 1's classes and tokens: use them), `docs/agent-handoff/ui-pass/audit.md` entries A4, A5, A6, A7, A15, A16, A17, A23, A27, A28, A30, A32, `docs/state-machines.md` sections "A hunter's life" and "A Job Change chain", `.claude/skills/principle-experience-first/SKILL.md`, `.claude/skills/principle-fix-root-causes/SKILL.md`, `.claude/skills/principle-test-behavior-not-implementation/SKILL.md`. Look at the images each entry names in `docs/agent-handoff/ui-pass/before/` before you change its screen.

## Why (the owner's goal)

the owner's players use this on their phones at the table, 50 looks a session. He asked for it to be "clearly nicer and easier to use for both players (mostly on phones) and the GM". A player should see their state on the first screen, see at once that it is their turn, and never be able to break something the GM gave them.

## Steps

1. **A GM's quest on a player's phone (A6, A7, A28).** First reproduce A6 in a browser test (a player in a room, a chain step issued by the GM over the `chain` message): does Delete show, and what does it do to the chain. Then fix it where the decision is made (the `lock` at `src/views/quests.js:374`): a quest the GM issued, a chain step included, has no Edit and no Delete for a player in a room. Ask one question in one place ("may this phone change this quest"), in core if it needs no DOM, with a unit test; the view calls it. An objective the System counts has no minus and plus. A Penalty Zone quest's edit form has no Kind. Tests for each as what the player or GM sees.
2. **The sheet's first screen (A5, A15, A16).** As the design says: identity as text with Edit, level and XP, HP, the condition chips, then MP and fatigue. Delete hunter moves to the Party panel. The jump row fades at the edge it scrolls toward. Tests at 360 by 780: a Poisoned, Penalized hunter shows both chips without scrolling; Edit opens the three inputs and a change saves; Delete hunter is in the Party panel and still takes its backup and asks.
3. **Dying (A23).** The chip reads Dying or Stable to match the panel. The chip comes from `src/core/hunter/chips.ts`; change it there and in its test. If the label is a status's `label` in the registry that other code matches by name, do not rename the status: change what the chip draws for a hunter at 0 HP.
4. **A player's turn (A4, A17).** On a player's phone in a fight: a status that lands or ticks, damage taken and "Monster info unlocked" are toasts and feed lines, not windows. Find where each window is raised (`src/edge/room-events.ts` appliers, `src/views/bestiary.js:61` and `:127`, the status window in `ui.js`) and change the kind of notice at that one place; do not close windows after the fact. A reward, a quest offer and anything with a choice stay windows. When the turn reaches the player, "Your turn" shows large on the HUD and is not covered. Tests with two phones (copy `tests/e2e/room-sync.e2e.ts`): the GM's Next reaches a poisoned player; the player's phone shows "Your turn" with no window open, and the poison tick is in a toast or the feed.
5. **Death save prompt (A27).** As the design says, no new window. The life machine does not change; this is what the card and the panel show first when `can(life, ...)` allows a death save and it is that hunter's turn. Tests: GM card, and the player's phone in a room.
6. **Small ones.** A30 (one lit tab while the dice sheet is open; d100 fits the row at 360). A32 (the rules reference says the countdown is at the start of the turn, which is what the code does; find the sentence and fix that one line).
7. **Run everything.** `E2E_CHROMIUM=/opt/pw-browsers/chromium bun run ci`. Then `PORT=3261 bun server.ts &`, `bun scripts/ui-shots.ts --url http://localhost:3261 --out <scratch>/after-3`, stop the server; fix the script where your changes moved its taps; look at every `player-360-*` image.

## Rules

- No change to the life, penalty or chain machines, to `save.ts` shapes or to the room protocol. If a step seems to need one, stop that step and write why in the notes.
- A test that pinned the old behaviour is rewritten to the new one, never deleted or skipped.
- Use unit 1's classes. Keep 44 px targets and 16 px inputs on a phone. No hard-coded colours.
- Wording you would change goes in `docs/agent-handoff/copy-tasks.md`, except the labels the design names.
- After a change to `app.api`, events, views or panels: `bun run deps -- --write`.
- Notes as you go in `docs/agent-handoff/ui-pass/notes-3-player.md`: per step what changed and its test, what A6's reproduction showed, what you left.

## Done means

`bun run ci` passes (quote its last lines in the notes). Each step is its own commit. The notes file is committed.

## Time

75 minutes. If you are not at step 7 by minute 55, finish the step you are in at a passing state, commit, list the remaining steps in the notes, and run step 7. Reply in at most 200 words: the commit range, the CI counts, what A6 turned out to be, anything unsure.
