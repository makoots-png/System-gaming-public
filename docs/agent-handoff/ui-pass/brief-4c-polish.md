# Brief, unit 4c: eight small things the after set showed

One helper (Sonnet, writer), in the main tree. You commit after each numbered step (plain message, no AI attribution, no Co-Authored-By; this overrides "do not commit" in your built-in text). Do not push. Do not start helpers of your own. Never edit anything under `.claude/skills`.

Read first: `AGENTS.md`, `docs/agent-handoff/ui-pass/design.md`, `docs/agent-handoff/ui-pass/notes-1-look.md` (the shared classes and tokens: use them), and the list "Still looks wrong" in `docs/agent-handoff/ui-pass/notes-4-fight-desktop.md`. Look at each image it names in `docs/agent-handoff/ui-pass/after/` with the Read tool before you change its screen.

## Why (the owner's goal)

the owner asked for the app to be "clearly nicer and easier to use for both players (mostly on phones) and the GM". The run's after screenshots show eight small blemishes on screens the run already changed. Each is a few lines.

## Steps

1. **The sheet.** Under the name, a hunter with no job and no title shows no line at all, not "None" (`src/views/hunter.js`). The empty HP message line takes no height when it has no text. Test in `tests/e2e/character.e2e.ts` or `look.e2e.ts`: a new hunter's first screen does not show "None" under the name.
2. **One filled button per screen.** On the inventory, "Save current gear" is a plain button; the one filled button of a form is its Save or Store. "Store" is at least 44 px tall and as wide as its row asks.
3. **The Workshop.** "Share custom content" sits in a header row with the view's title, not floating above the first section. A card with two buttons keeps its text at least 60 per cent of the card: the buttons wrap under the text when the card is narrow. At 390 px nothing changes for a one-button card.
4. **The GM view.** "Reward uses" is as wide as its text, not the page, at 900 px and wider.
5. **The status maker at 1280.** The preview is in the right column and stays in view while the effects scroll (sticky inside the window), as the item maker's does if it does; if neither does, make both do it through one rule.
6. **Toasts in a fight.** A toast on the fight view never covers a card's buttons for a person: check the two "added" toasts at 390 by 844 by waiting 3.5 s in a throwaway script and shooting again. If they are gone, change nothing and say so in the notes. If they stay, fix the cause.
7. **Run everything.** `E2E_CHROMIUM=/opt/pw-browsers/chromium bun run ci`. Then `PORT=3261 bun server.ts &`, `E2E_CHROMIUM=/opt/pw-browsers/chromium bun scripts/ui-shots.ts --url http://localhost:3261 --out docs/agent-handoff/ui-pass/after`, stop the server, look at the images of the screens you changed, and commit the images that changed.

## Rules

- Layout and look only. No change to what anything does or saves.
- A test that pinned the old layout is rewritten, never deleted or skipped. Keep 44 px targets and 16 px inputs on a phone. No hard-coded colours.
- Do not run the screenshot script at the same time as a browser test. Use `E2E_PORT=3217` for single-file runs.
- Notes: append a section "Unit 4c" to `docs/agent-handoff/ui-pass/notes-4-fight-desktop.md`: per step what changed, or why nothing did.

## Time

40 minutes. Reply in at most 120 words: the commit range, the CI counts, anything left.
