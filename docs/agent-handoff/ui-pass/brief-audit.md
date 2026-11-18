# Brief: UI and UX audit (one script, one set of screenshots, one audit file)

One helper (Opus, heavy-writer), in the main tree. You change no app code and no test. You write `scripts/ui-shots.ts`, the images under `docs/agent-handoff/ui-pass/before/`, and `docs/agent-handoff/ui-pass/audit.md`. You commit after each numbered step (plain message, no AI attribution, no Co-Authored-By; this overrides "do not commit" in your built-in text). Do not push. Do not start helpers of your own. Never edit anything under `.claude/skills`.

Read first: `AGENTS.md`, `docs/agent-handoff/later-phases/ui-prompt.md` (only the paragraphs "PHASE UI" and "Goal"; its box rules do not apply), `docs/agent-handoff/handoff.md` sections 4 and 5, `docs/agent-handoff/lead-report.md` sections 1, 6 and 9 and the "open items" of section 12, `docs/agent-handoff/copy-tasks.md` (so you do not report wording that is already listed), `.claude/skills/principle-experience-first/SKILL.md`, `.claude/skills/principle-build-the-lever/SKILL.md` and `.claude/skills/unslop/SKILL.md`.

## Why (the owner's goal)

the owner runs a tabletop game with this app. His players use phones, he is the GM. He asked for a run that makes the app "clearly nicer and easier to use for both players (mostly on phones) and the GM". His priority for the product is customizability: "The ability to make custom abilities, status effects, custom rewards, items, enemies, etc... and ways to notify me when players have used rewards." So the creation flows (the Workshop and the makers) are polished first, then what a player touches most (the sheet, quests, a fight), then the rest.

The lead ranks and decides the fixes from your audit without opening the views. So the audit must be complete, exact and short. Every finding names its screenshot and its `file:line`.

## Steps

1. **The script.** Write `scripts/ui-shots.ts`, modelled on `scripts/maker-shots.ts` (two phones in a room) and `scripts/shots.ts` (the seeded save). `bun scripts/ui-shots.ts --url http://localhost:<port> --out <dir>` writes one PNG per screen, the same file names on every run, so a later run after the fixes gives the "after" set. Shots are the screen (not full page) at `deviceScaleFactor: 1`, with the clock fixed and animations off so two runs of the same build give the same pixels. Two roles:
   - a player on a 360 by 780 phone (touch, the iPhone user agent): onboarding, each bottom-bar view and each entry under More, the Status window, the sheet with a boon, a status chip's card, a dying hunter and a dead one, the Penalized chip, quests (a daily, a Job Change step, a reward window), the inventory and an item's use, skills, shadows, the dice roller, the Room view out of a room and in a live room with the pill, a reward arriving, the player's side of a fight in a room;
   - a GM at 1280 by 800 (mouse) and the same GM screens at 390 by 844 (touch): the GM view and board, the Workshop and each maker open with a few fields filled (status, item, skill, enemy, reward editor), the Award form scrolled to its bottom, a quest form, gates and a gate form, the bestiary, a fight being built, a running fight with a monster card open, a status being applied, the target picker of a skill, a fight end with loot, Reward uses, the session log, the share code, the Data view, the rules reference, the JSON rules editor, an empty state of each list, a toast while it shows, one error state (a refused room code).
   Name files `<role>-<size>-<nn>-<screen>.png`. The script exits non-zero if a selector it needs is missing. Check: run it twice against a server you start on port 3261 (`PORT=3261 bun server.ts &`, stop it after; this overrides "never start servers" in the helper rules for this script only) and confirm both runs write the same file list; say in the notes how many files differ in bytes between the two runs and why. `bun run typecheck` passes. Commit the script.
2. **The before set.** Run it into `docs/agent-handoff/ui-pass/before/`. Commit the images.
3. **Look at every image** with the Read tool, and read the views for what an image cannot show. Record in `audit.md` as you go, not at the end. For each finding: an id (`A1`, `A2`, ...), who feels it (player or GM), the screen and image file, what is wrong in one or two plain sentences, the `file:line` that draws it, and a severity from 1 (a player or GM is blocked or misled) to 4 (a blemish). Look for, in this order:
   - taps: count the taps from the home screen for the things done most often (use a consumable, mark a quest step, roll, take damage, apply a status in a fight, award a saved reward, make each kind in the Workshop). Run counts where a test already proves them (`tests/e2e/makers.e2e.ts`), read the rest and say "read, not run";
   - actions hidden under the bottom bar, behind a toast, off the right edge, or below a fold with no hint;
   - unclear state: what is selected, whose turn it is, what is saved, what was just sent, what is disabled and why;
   - missing feedback after an action, and missing loading, empty and error states;
   - tap targets under 44 px on the phone (measure with `boundingBox` in a throwaway script, list each selector and size), inputs under 16 px font (iOS zooms the page on focus), text contrast below 4.5 to 1 against its background (compute it from the CSS colours, list the pairs);
   - inconsistent components: list every distinct button style, chip style, card style, form field style, dialog header and spacing value that `public/app.css` and inline styles in `src/views/*.js` produce (grep `style=` and `style.`), and say which are the same thing drawn two ways. List the CSS custom properties that exist and the hard-coded colours and sizes that bypass them;
   - desktop: wasted width, lines too long to read, a phone layout stretched to 1280;
   - accessibility basics: focus visible with a keyboard, a label on every input and icon button, dialogs that trap and restore focus, Escape closes;
   - combat readability: can the GM see at a glance whose turn it is, who is down, which statuses are on whom; can a player see their turn.
   The items of `handoff.md` sections 4 and 5 are known: confirm each against its image, give it an id, and add its `file:line`.
4. **The summary**, at the top of `audit.md`: a table of all findings sorted by severity then by who feels it most often, with a column "size of fix" (S: CSS or a few lines; M: one view; L: several views or a shared component). Then a section "Shared components and tokens": what a small consistent set would be (which button, chip, card, field, sticky action bar, toast position), stated as what exists today and what would merge into what. No fixes in code. Then "What looks good and should not be touched". Commit.

## Rules

- No app code, no test, no CSS changes. A bug you find goes in the audit with its severity.
- One Playwright run at a time. Set `E2E_CHROMIUM=/opt/pw-browsers/chromium`. Never run `playwright install`.
- Wording issues go in `docs/agent-handoff/copy-tasks.md` (append, one line each), not the audit, unless a label is actively misleading.
- Write in plain whole sentences (unslop). No long dashes.
- Notes file: `docs/agent-handoff/ui-pass/notes-audit.md`, written as you go: what the script covers and what it could not reach, and why.

## Done means

`bun run typecheck` passes. `scripts/ui-shots.ts` runs clean twice. `ui-pass/before/` holds the images. `audit.md` has the summary table, the findings with image and `file:line`, the components section. Everything is committed in three or four commits.

## Time

75 minutes. If the script is not covering everything after 35 minutes, commit what it covers, list the missing screens in the notes, and go on to steps 2 to 4 with what you have. Reply in at most 200 words with the commit range and the five worst findings.
