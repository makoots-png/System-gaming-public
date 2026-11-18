# Notes, unit 4: the GM's fight on a phone, the desktop, and the after set

Principles read: experience-first, test-behavior-not-implementation. Experience-first made step 1 move the whole order above the card (the order is the one place that answers "whose turn, who is down, what is on whom") instead of adding a second strip that repeats it.

## Step 1: the turn order first on a phone (A3)

- `src/views/combat.js`: `.cmb-main` now holds the order (`ul.cmb-list`) before the card. At 900 px and up `.cmb-list{order:1}` puts it back on the right, so 900 to 1099 px reads as before; at 1100 px and up the cockpit grid places both by column, so `gm-1280-26` is unchanged.
- Under 900 px: the current row is filled and its name cyan and bold (with its ▶), the HP bar is 4 px, the rows sit 4 px apart.
- A combatant who is down gets a red "Down" tag on its row (`.cmb-dn`); the name, initiative, status words and HP are dimmed and the name struck through, the tag is not dimmed.
- Under 900 px a tap on a row selects it and scrolls its card to the top of the screen.
- Test: `tests/e2e/layout.e2e.ts` "on a 390 px phone the GM sees whose turn it is at the top of the fight, the mark moves on Next, and a goblin at 0 HP is marked down in the order" (Brakk and two Goblins built through the Combat view's builder). Checked: `combat-turns`, `custom-skills`: 20 passed.

## Step 2: the Table feed (A2)

- `src/views/table.js`: under 1100 px the feed is one line, a button "Table feed" with a count on the right: "Empty", the number of rows, or "N new" filled cyan while there are rows the GM has not opened. A tap opens and shuts the rows (`aria-expanded`, the panel's own heading is hidden under 1100 px). Rows count as seen when the feed is open or at 1100 px and up, where it stays the side column, always open. `seen` is kept on each row in the same sessionStorage entry as the feed.
- Sticky to the bottom (above the bottom bar under 720 px) only while it is shut and has a new row: `[data-fresh]`. Open or with nothing new it is the last thing in the view, after the log.
- Test: `tests/e2e/layout.e2e.ts` "on a 390 px phone in a room, the empty Table feed is one line that covers none of the card, and a player's roll shows as 1 new" (Mark defeated scrolled to just above the bottom bar is what `elementFromPoint` finds at its centre, and the tap makes it Revive; a roll arrives: "1 new" in view, its row hidden until the tap).
- Rewritten for the new layout, not deleted: the three tests that read feed rows on a phone open the feed first through `openFeed(page)` (new in `tests/e2e/helpers.ts`): `table-session.e2e.ts` (the applied roll, before and after the reload), `used.e2e.ts` (the bomb), `reward-room.e2e.ts` (the boon row). Checked: those three files, 14 passed.

## Step 3: the desktop nav (A19)

- `public/app.css`: the top nav's tabs keep their 13 px capitals and icons, with less around them: padding 6 px 9 px (was 14 px a side), 5 px between icon and word (was 7), letter spacing .07em (was .12em), 2 px between tabs (was 6). No view hidden.
- Test: `tests/e2e/layout.e2e.ts` "at 1280 by 800 the GM's top nav is one row holding all thirteen views" (a mouse device in a room: 13 tabs, one `top` among them).

## Step 4: desktop width (A20)

- Workshop (`workshop.js`): at 900 px and up each kind's entries are a grid of cards, `repeat(auto-fill, minmax(300px, 1fr))`, so four across at 1280. The phone list is unchanged.
- Data and Rules (`public/app.css`): the view's main part and panels are at most 74ch wide and centred. 74ch less the window's 20 px padding a side is about 70 characters of body text. A phone is narrower than that already.
- GM view (`gm.js`, `arrange()`): at 1100 px and up the Award form leaves the left column and is a full-width row under the two (or three) columns. Inside it, Bundle and XP, Gold, Points sit side by side, and the reward rows (item, title, status, boon, ...) go two to a line; the Add row, the preview and the sticky Send award bar span the width. The columns keep Party and Issue quest on the left and the collapsed sections on the right. Below 1100 px nothing moved.
- Test: `tests/e2e/layout.e2e.ts` "at 1280 the Workshop shows its entries as cards, two side by side" (the built-in statuses opened with a mouse; the first two cards share a top and the second starts right of the first). Checked: `rewards`, `sharing`: 11 passed.

## Step 4a: a GM opens on the GM view

- `route()` in `src/app.js`: with no view in the address, `role() === 'gm'` opens the GM view, a player Status. A view named in the address still wins, and a view the role may not see still falls back to Status.
- `src/views/table.js` `refresh` worked out the open view from the address with Status as the default, so a room doc arriving on a GM's phone with no view in the address would have jumped it to Status. It now asks which of Combat and Status is on screen (`hidden === false`) and refreshes that one.
- Test: `tests/e2e/layout.e2e.ts` "a GM's phone opens on the GM view and a player's on Status when the address names no view" (both onboarded, then opened at `/`: the GM view shown and its bottom tab lit; the player on Status, with no GM view at all).
- `tests/e2e/makers.e2e.ts`: `makeFromHome` now opens the app at `/` (the view it opens on) and taps the Make row button, no GM tab first. Checked: 22 passed.

Taps from the view the app opens on, run:

| Make | Unit 2 | Now |
|---|---|---|
| A status (Frostbite) | 7 | 6 |
| An item (Bottled Storm) | 8 | 7 |
| An enemy (Ice Warden) | 9 | 8 |
| A skill (Frost Lance), from the Skills panel | 10 | 10, unchanged: the test starts on Status where the onboarding leaves a GM, and the Skills panel is on Status. From the Make row: 11 in unit 2 less the GM tab, so 10 (counted, not run) |

## Step 4b: the teal box

The app drew it, through the browser. The box is the Workshop's "+ New status" button (116 by 44 at x 247, y 139 at 390 px: the same box) seen through the status maker. `elementsFromPoint` there finds the maker's Name input and window, so it is not an element on top: it is Chromium's tap highlight, the flash a touch browser paints over a tapped element for a moment, and it is painted above everything, the window the tap just opened included. Its colour matches: Chromium's default `#6633B5E5` (40 per cent of 51, 181, 229) over the window's dark fill gives the 23, 81, 107 the shot shows.

Found with a throwaway copy of the script's device (390 by 844, `deviceScaleFactor: 1`, touch, the no-motion style), shooting right after the fill: the box shows; with a 1 s wait, or at `deviceScaleFactor: 2` (the tests' phones), it is gone. Turning off the no-motion style or the screenshot's `animations: 'disabled'` does not change it. A player on an Android phone sees the same flash on every tap.

Fix: `-webkit-tap-highlight-color: transparent` on `body` in `public/app.css`; every button already has its own pressed look. The same shot after the fix: the window's own colour (5, 15, 26) at both points the box covered. No test: the flash is the browser's, a test could only read the CSS property back.

## Step 5: everything

The first `bun run ci` stopped at the views' typecheck: the feed's arrows were written `"\25be"` in a template string, an octal escape `tsconfig.views.json` refuses (the bundle and the browser tests took it). Fixed in its own commit (`89465b9`, characters ▾ and ▴).

`E2E_CHROMIUM=/opt/pw-browsers/chromium bun run ci` on `89465b9`, nothing beside it, last lines:

```
 1668 pass
 0 fail
  171 passed (12.8m)
CI passed
```

## Step 6: the after set

`PORT=3261 bun server.ts`, `E2E_CHROMIUM=/opt/pw-browsers/chromium bun scripts/ui-shots.ts --url http://localhost:3261 --out docs/agent-handoff/ui-pass/after`, exit 0, 117 files with the same names as `before/` (checked with `diff` of the two listings). The script needed no change in this unit: none of its taps go through the order, the feed or the opening view (it names every view it goes to).

Shots whose flow changed in units 1 to 3, kept under the old name:

- `gm-*-25-status-dialog-picked`: the combat card after the one tap on Poisoned (unit 2), not the window with a chip picked.
- `player-360-07-fight-status-banner`, `player-360-08-fight-combat-hud`: the same moment, but no Poisoned window over it (unit 3): the banner, "YOUR TURN" and the toasts.
- `player-360-15-inventory-use-window`: the inventory after the use, with the use as a toast; no window.
- `gm-1280-41-more-menu-not-shown`: as before, a desktop has no More.

Fixed after looking (CSS of screens this unit changed, each reshot):

- `gm-1280-13`, `-14`, `-15`: the reward rows in a two-column grid left a hole under the short Item row beside the tall Title. Now CSS columns, so the rows flow and balance (Item and Title left, Boon right); hunter ticks 200 px wide so "Mira Test (remote)" is one line.
- `gm-1280-07` (and every 1280 shot with a window open): the nav wrapped Data to a second row behind the window. An open window sets `scrollbar-gutter: stable` on the page (`app.css:46`), which took the last pixels of slack. Tabs now 7 px a side, 4 px icon gap, .05em spacing: about 80 px spare at 1280. The nav test also checks one row with a gutter on both edges.

Looked at (Read): `gm-390-02`, `-04`, `-06`, `-10`, `-14`, `-26`, `-27`, `-28`, `-29`; `gm-1280-05`, `-07`, `-10`, `-12`, `-13`, `-14`, `-15`, `-23`, `-24`, `-26`, `-35`, `-37`; `player-360-07`, `-08`, `-11`, `-15`, `-16`, `-19`, `-29`. Not every one of the 117: the rest are screens no unit changed since `before/` (gates, bestiary, shadows, room, device), and the time went to the ones that did.

Still looks wrong, not fixed here (not a few lines of CSS in a screen this unit changed):

- `player-360-07`, `-11`, `-19`: under the name the sheet reads "None" (no job and no title). It should say nothing, or "No job yet".
- `player-360-11`: an empty band about 40 px tall between HP amount and Conditions (the HP message line keeps its height when empty).
- `player-360-15`: two filled buttons on one screen, "Save current gear" and the inventory's "Store"; Store is also shorter than 44 px wide rows around it.
- `gm-390-26`, `-27`: two toasts from the build ("1 × Ice Warden added", "2 × Cave Rat added") sit over the bottom of the card for their 3.2 s; the script moves faster than a person.
- `gm-1280-05`: the status maker scrolled to its effects leaves its right column empty (the preview is under the effects in the left one).
- `gm-1280-10`, `gm-390-10`: "Share custom content" still floats alone above the first section at the right.
- `gm-1280-10`: a Workshop card with two buttons (a skill: Give to… and ⋯) squeezes its text to about 220 px.
- `gm-1280-12`: "Reward uses" is a button the width of the page.

## Findings A1 to A33

Before and after are the same file name in `before/` and `after/`.

| Id | Image | What a person sees now |
|---|---|---|
| A1 | `gm-390-04-maker-status-top` | The Workshop's New status is a maker: Name, Description, Effects, Save status. No Rounds, no Apply existing, and no teal box (4b) |
| A2 | `gm-390-26-combat-running` | The Table feed is one line at the end of Combat ("Table feed · Empty"); it sticks above the bar only with "N new" |
| A3 | `gm-390-26-combat-running` | The turn order is first: ▶ Ice Warden filled at the top, statuses and thin HP bars on each row; the card under it |
| A4 | `player-360-07`, `-08` | "▶ YOUR TURN" large on the HUD and "Your turn · Round 1" on the sheet; the status tick is a toast, no window |
| A5 | `player-360-11-status-top` | Name as text with Edit; level, HP and the condition chips on the first screen |
| A6 | `player-360-16-quests-active-job-step` | The Job Change step has Complete and Fail only |
| A7 | `player-360-16-quests-active-job-step` | "Reach Level 10 2/10" with no minus and plus |
| A8 | `gm-390-14-award-form-bottom` | Send award is in a bar pinned above the bottom bar |
| A9 | `gm-390-02-gm-view-no-room` | The GM view starts with Make: Status, Item, Skill, Enemy, Reward; a GM's phone opens on it (4a) |
| A10 | `gm-390-26`, `player-360-15` | Toasts are one line above the bottom bar, two at most |
| A11 | `gm-390-06-maker-item-filled` | A consumable shows no slot, no bonus while worn; healing is an effect row |
| A12 | `gm-390-27-combat-monster-card` | Frost Lance on the C-rank Ice Warden reads "Deals 4d8 damage" |
| A13 | `gm-1280-07-maker-skill-filled` | Pressed choices are filled cyan (Active, A target, By rank) |
| A14 | `gm-1280-26-combat-running` | Next is filled, Damage and Clear are red, the rest plain |
| A15 | `player-360-11-status-top` | The jump row fades at its right edge |
| A16 | `player-360-11-status-top` | No Delete hunter on the sheet (it is in Party) |
| A17 | `gm-390-29-fight-end` (the GM's), the player's in its log | "Monster info unlocked" is a toast |
| A18 | `gm-1280-17-quest-form` | Empty fields have a visible edge |
| A19 | `gm-1280-03-workshop-empty` | Thirteen tabs in one row; content starts about 45 px higher |
| A20 | `gm-1280-10`, `-13`, `-14`, `-35`, `-37` | Workshop entries are cards four across; Data and Rules are a centred column of about 70 characters; the Award form is full width with its rows in two columns |
| A21 | `gm-1280-07-maker-skill-filled` | The skill maker is two columns; the preview is in view |
| A22 | `gm-1280-17-quest-form` | Cancel left, Save quest right |
| A23 | `player-360-29-hunter-dying` | The chip says Dying, as the death panel does |
| A24 | `gm-1280-24`, `-25` | Rounds and Strength on top; one tap on a chip puts it on |
| A25 | `gm-390-08-maker-enemy-filled` | The starting status's × is on the line of its name |
| A26 | none (read, not shot) | Enter in a reward field of the quest form no longer saves the quest (unit 2's test) |
| A27 | `player-360-29-hunter-dying` (the sheet); the card and HUD prompt are not shot | Roll death save is the primary on the card and the HUD at a dying hunter's turn |
| A28 | none (read) | The edit form of a Penalty Zone quest has no Kind (unit 3's test) |
| A29 | `gm-390-14-award-form-bottom` | The full Title chip says why under the Add row |
| A30 | `player-360-19-dice-quick-sheet` | Only the Dice tab is lit; d4 to d100 in one row |
| A31 | `gm-1280-32-session-log-uses`, `gm-390-36-share-code` | Log lines: title then text; the share code box shows the whole code |
| A32 | `player-360-24-more-rules` (text) | The rules say timed conditions count down at the start of the turn |
| A33 | `gm-390-10-workshop-filled-top` | A row edits on a tap; Duplicate, Share, Delete behind ⋯ |

## Unit 4c

1. Sheet: `h.job` is stored as 'None' for a new hunter; the line under the name now drops it (`hunter.js`), so a new hunter shows nothing there. `.hp-amt-msg:empty` takes no height. Test in `look.e2e.ts`.
2. Inventory: "Save current gear" is no longer `primary` (`custom.js`); `.add-row > button` is 44 px tall at least (`app.css`). Test in `look.e2e.ts`.
3. Workshop: `.ws-top` is a header row with an h2 "Workshop" and Share custom content; cards wrap (`.ws-list li` flex-wrap, text basis 60 per cent, buttons wrap under it and sit right). A one-button card keeps one line at 390.
4. GM view: `.gm-uses-go` is `align-self:flex-start` from 900 px; stretched below.
5. Status maker: the new-status column is split in three wrappers (`fg-a1`, `fg-b`, `fg-a2`), contents on a phone (same order), a two-column grid at 1100 px and wider: name, description, colour left; effects and preview right. One rule in `maker.js` makes `.mk-preview` sticky at the bottom at 1100 px and wider, so the item maker has it too. Test in `look.e2e.ts`.
6. Toasts: nothing changed. A toast removes itself after 3200 ms (`ui.js`), so at 3.5 s the two "added" toasts are gone; the old shots were taken faster than a person acts. Read from the code, no throwaway shot taken.

## CI after step 6

Step 6 changed app CSS (`gm.js` Award rows, the nav's padding), so CI ran again on `acb0118`: 1668 unit tests passed; browser tests 169 passed, 2 failed, both waits on a timing: `makers.e2e.ts:481` (the goblin's HP did not drop within 15 s after Frost Lance, the same test unit 1 saw fail under load) and `table-session.e2e.ts:71` (the player's banner already read "▶ Your turn" when the test still expected "In combat"). Neither touches the order, the feed, the nav or the Award form. Run alone right after, one worker: both passed (8.9 s and 42.1 s). Read as load or a pause, not this change; CI was run once more with nothing beside it.

That last run (11:40) passed its typecheck and the 1668 unit tests, then could not start the browser tests: port 3218 was held by another CI started in this tree at the same minute (not this helper's; left running). So the last full green CI is the one on `89465b9` (step 5); `acb0118` has 169 of 171 browser tests passed in one run and the other two passed alone. The lead's pre-push CI is the verdict.
