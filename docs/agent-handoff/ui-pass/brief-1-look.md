# Brief, unit 1: the shared look

One helper (Opus, heavy-writer), in the main tree. You commit after each numbered step (plain message, no AI attribution, no Co-Authored-By; this overrides "do not commit" in your built-in text). Do not push. Do not start helpers of your own. Never edit anything under `.claude/skills`.

Read first: `AGENTS.md`, `docs/agent-handoff/ui-pass/design.md` (the decisions; they are settled), `docs/agent-handoff/ui-pass/audit.md` entries A8, A10, A13, A14, A18, A22, A29 and the section "Shared components and tokens", `.claude/skills/principle-experience-first/SKILL.md`, `.claude/skills/principle-laziness-protocol/SKILL.md`, `.claude/skills/principle-subtract-before-you-add/SKILL.md`. Look at the images each entry names in `docs/agent-handoff/ui-pass/before/` before you change its screen.

## Why (the owner's goal)

the owner asked for the app to be "clearly nicer and easier to use for both players (mostly on phones) and the GM", through a small set of shared components and tokens so future additions stay easy, keeping the Solo Leveling system-window look. This unit builds that small set. Three later units use it, so class names and tokens you add are what they will reach for: keep them few and say each in one line in the notes.

## Steps

1. **Tokens and the control edge (A18).** In `:root` of `public/app.css` add the tokens the design names and only those this unit reads. The edge of every input, select and plain button uses the new edge token, at 3 to 1 or more on `--panel` (compute it and write the ratio in the notes). `--line` stays for rules and panel borders. Check: `bun run test`; shoot three screens and look.
2. **Button kinds (A14, A29).** `button.primary` is filled; `button.danger` has a red edge and red text at rest; add `button.quiet`. Replace the three "×" buttons (`.rw-rm`, `.mk-fx-rm`, `.enm-rm`) with one icon button class. Go through every `class="primary"` in `src/views/` and leave at most one per window or form: the action it exists for. Every Delete and Remove that destroys something is `danger`. A disabled control that a rule disables (the Title chip, A29) says why in a short line beside it. Check: the browser tests of the views you touched.
3. **Pressed chips and the segmented control (A13).** One class for a one-of-n choice with a filled pressed state, used by the makers' modes, the reward editor's Add row where it is one-of-n, the inventory Items and Shop toggle, the quest tabs and the dice sheet's Adv, Normal, Dis. Keep `aria-pressed` or `role="tab"` as each has now.
4. **Toasts (A10).** Position, count and size as the design says. A toast never covers the bottom bar, a window's action bar or a maker's action bar: prove each with a screenshot at 360 by 780 and name the three images in the notes. Keep "Dismiss notification" and `aria-live`. A browser test: with three toasts raised, two show, and the bottom bar's tabs can be tapped.
5. **One button order and the sticky bar (A22, A8).** Cancel or Close left, the action right, in every window and form (the quest form, the gate form, the system windows; grep `Cancel`). The Award form and the quest form get the sticky action bar the makers have: move `.dlg-actions` out of `.dlg-form` into a class any long form can use. The Award form's message after a send names who got it. A browser test at 390 by 844: with an item, a title and a boon in the Award form, Send award is in view without scrolling and one tap sends it.
6. **Inline styles.** The 32 `style="..."` in `src/views/*.js` each become a class that exists or one you add; `min-height:40px` controls become the control height token. Skip one only where the value is computed at run time, and list those in the notes.
7. **Run everything.** `E2E_CHROMIUM=/opt/pw-browsers/chromium bun run ci`. Fix what your changes broke: a test that pinned the old look or order is rewritten to the new one, never deleted or skipped. Then `PORT=3261 bun server.ts &`, `bun scripts/ui-shots.ts --url http://localhost:3261 --out <scratch>/after-1`, stop the server, and look at ten of the images across both roles. If your changes moved a tap the script makes, fix the script.

## Rules

- No change to what a button does, only to how it looks and where it sits, except the Award message of step 5.
- Keep the system-window look: the cornered panels, the glow titles, the "! SYSTEM" tags. Read "What looks good and should not be touched" in the audit.
- Keep every touch target at 44 px or more and every input at 16 px or more on a phone.
- No new dependency, no CDN, no web font.
- Colours go through tokens. Do not add a hard-coded colour; where you touch a rule that has one equal to a token, use the token.
- Wording you would change goes in `docs/agent-handoff/copy-tasks.md`, one line each, except the Award message.
- Write notes as you go in `docs/agent-handoff/ui-pass/notes-1-look.md`: the tokens and classes added (one line each), what you merged, what you left and why, the contrast ratios, the image names that prove step 4.

## Done means

`bun run ci` passes (quote its last lines in the notes). Each step is its own commit. The notes file is committed.

## Time

70 minutes. If you are not at step 7 by minute 50, stop the step you are in at a passing state, commit it, write in the notes which steps remain, then run step 7. Reply in at most 200 words: the commit range, the CI counts, anything unsure.
