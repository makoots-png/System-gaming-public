# UI and UX audit (before the UI pass)

Images are in `docs/agent-handoff/ui-pass/before/`, made by `scripts/ui-shots.ts` (see `notes-audit.md`). `gm-1280-*` is the GM at 1280 by 800 with a mouse, `gm-390-*` the same GM screens at 390 by 844 with touch, `player-360-*` a player on a 360 by 780 touch phone in the GM's room. Severity: 1 a player or GM is blocked or misled, 2 felt every session, 3 felt now and then or looks wrong, 4 a blemish. Size of fix: S is CSS or a few lines, M one view, L several views or a shared component.

## Summary

| Id | Sev | Who | Screen | Size | What |
|---|---|---|---|---|---|
| A1 | 2 | GM | Workshop, New status | M | The Workshop's status maker is the fight's Status window: Rounds, 14 "Apply existing" chips, "Save to library" and a button named Apply, with nothing to apply to |
| A2 | 2 | GM | Combat on a phone | S | The Table feed sticks to the bottom over the combatant card, about 110 px, even when empty |
| A3 | 2 | GM | Combat on a phone | S | The selected card comes before the turn order, so whose turn it is, who is down and who has what are a long scroll away |
| A4 | 2 | Player | Fight in a room | M | At the start of the player's turn, status windows and stacked toasts cover the turn banner and the HUD |
| A5 | 2 | Player | Status sheet | M | The sheet opens on an edit form; the condition chips (Poisoned, Penalized, Dying) are about 600 px down |
| A6 | 2 | Player | Quests, Job Change | S | A player in a room gets Edit and Delete on the Job Change step the GM issued |
| A7 | 2 | Player | Quests, Job Change | S | Step 1 "Reach Level 10" has the minus and plus buttons (known, handoff 5) |
| A8 | 2 | GM | Award form on a phone | S | Send award is not sticky; it is below the reward editor and the bottom bar (known, handoff 4) |
| A9 | 2 | GM | Workshop on a phone | S | The Workshop is under More: two taps from home before any maker opens (known, handoff 4) |
| A10 | 3 | Both | Every view | S | Toasts sit at the top over the header and the view's heading, up to three deep (known, handoff 4) |
| A11 | 3 | GM | Item maker | M | Every field shows for every type: a consumable gets Slot, nine "Bonus while worn" boxes and three "Worn:" quick effects; Heals HP and Restores MP repeat the Heal effect |
| A12 | 3 | GM | Monster card, enemy maker | S | A skill prints all six by-rank values where the monster's own rank picks one (the preview half is known, handoff 4) |
| A13 | 3 | Both | Makers, reward editor | S | A pressed chip (Consumable, A target, By rank) differs from the others only by a lighter fill |
| A14 | 3 | Both | Every view | S | Primary and plain buttons differ only in border and text colour; danger buttons look like the rest until hover, which a phone never has |
| A15 | 3 | Player | Status sheet | S | The jump chip row is cut at the right edge ("Ge…") with no sign it scrolls; Inventory and later chips are out of sight |
| A16 | 3 | Player | Status sheet | S | "Delete hunter…" is on the first screen, beside Look |
| A17 | 3 | Player | Fight in a room | S | "MONSTER INFO UNLOCKED" windows reach the player's phone mid-fight, one per monster the GM marks defeated |
| A18 | 3 | Both | Every view | S | The control edge colour `--line` is 2.0 to 1 on the panel, under the 3 to 1 a field or button edge needs |
| A19 | 3 | GM | Desktop, every view | S | The top nav wraps to two rows at 1280 (13 views) |
| A20 | 3 | GM | Desktop, Workshop and GM view | M | A phone column stretched: Workshop rows span 1210 px with their buttons on the left; the Award form fills half the screen and leaves the other half empty |
| A21 | 3 | GM | Skill maker at 1280 | S | A 540 px window, one column, preview below the fold; the status maker beside it uses two columns |
| A22 | 3 | Both | Forms and windows | S | Button order varies: makers put Cancel left and Save right, the quest form Save left and Cancel right |
| A23 | 3 | Player | Dying | S | One state, two names: the death panel says Dying, the chip says Unconscious |
| A24 | 3 | GM | Status in a fight | S | Applying a built-in status is two taps (pick, then Apply) (known, handoff 4) |
| A25 | 3 | GM | Enemy maker | S | The remove "×" of a starting status wraps to its own line (known, handoff 4) |
| A26 | 3 | GM | Quest form | S | Enter in a reward editor text field submits the quest form (known, handoff 4) |
| A27 | 3 | GM | Fight | M | A dying hunter gets no death save prompt at the start of their turn (known, handoff 5) |
| A28 | 3 | GM | Quest edit | S | The edit form lets a GM change a Penalty Zone quest's kind (known, handoff 5) |
| A29 | 4 | GM | Reward editor | S | The disabled "Title" chip (one title per reward) reads as broken at opacity .35, with no reason given |
| A30 | 4 | Player | Dice quick sheet | S | Two bottom tabs are lit at once (Status and Dice); d100 wraps to a row of its own |
| A31 | 4 | GM | Session log, share code | S | A use's title and text run together; the share code box cuts its seventh line (known, handoff 4) |
| A32 | 4 | Both | Rules reference | S | It says timed conditions count down at the end of the turn; the code counts at the start (known, handoff 5) |
| A33 | 4 | GM | Workshop | S | A status entry's Edit, Duplicate, Delete and Share are four equal buttons on every row; Delete has no danger look |

## Taps from home for the common actions

Counted from the view a player or GM opens on (Status for a player, GM for a GM). "Run" means a test proves it; "read" means counted from the code and the images, not run.

| Action | Who | Taps | How | Source |
|---|---|---|---|---|
| Take damage | Player | 1 | Status, −5 or −1 on the first screen | read, `player-360-11` |
| Take an exact amount | Player | 3 and a field | HP amount, type, Damage | read |
| Roll a die | Player | 2 | Dice tab opens the quick sheet, d20 | read, `player-360-19` |
| Use a consumable | Player | 2 to 3 | Status, a jump chip to Inventory (off screen at 360, so a swipe of the chip row or a long scroll), Use. No confirm | read, `player-360-14` |
| Mark a quest step | Player | 2 | Quests tab, + on the objective | read, `player-360-16` |
| Apply a status in a fight | GM | 5 on a phone | Combat, a row in the order (after a scroll past the card, A3), + Status, a chip, Apply | read, `gm-390-24`, `gm-390-25` |
| Award a saved reward | GM | 5 to 6 | More, Workshop, Award… on the reward, tick a hunter, scroll, Send award | read |
| Make a status | GM | 8 | More, Workshop, New status, ... | run, `tests/e2e/makers.e2e.ts` (handoff 4) |
| Make an item | GM | 9 | as above | run, makers.e2e.ts |
| Make a skill | GM | 13 | as above | run, makers.e2e.ts |
| Make an enemy | GM | 10 | More, Bestiary, New monster, ... | run, makers.e2e.ts |

## Findings

### A1. The Workshop's status maker is the fight's Status window (GM, 2)

`gm-1280-04-maker-status-top.png`, `gm-390-04-maker-status-top.png`. From the Workshop, "+ New status" opens the same window the combat card opens: a Rounds field with ∞, an "Apply existing" grid of the 14 built-ins, a "Save to library" box (untick it in the Workshop and Save does nothing useful) and a primary button named Apply. In the Workshop there is no target, so the left half of the window and the button's name mislead. The other makers say "Save item", "Save skill". `src/views/workshop.js:79` calls `A().forge.status({ title: 'New status' })`; the window is `src/views/forge.js:39` (save label `'Apply'`), `:45` (Rounds), `:48` (Apply existing), `:58` (Save to library). Size M: a `mode: 'library'` that hides those three parts and says "Save status".

### A2. The Table feed covers the combat card on a phone (GM, 2)

`gm-390-26-combat-running.png`, `gm-390-27-combat-monster-card.png`, `gm-390-28-skill-target-picker.png`. In a running fight under 1100 px the panel column is `position:sticky; bottom:0`, so "TABLE FEED / Player rolls, uses and quest updates appear here." sits over the lower 110 px of the card, above the bottom bar, whether or not it has rows. The card's Initiative, Mark defeated and Remove scroll under it. `src/views/table.js:73`. Size S: collapse it to one line with a count, or make it sticky only when it has a new row.

### A3. On a phone the turn order is below the card (GM, 2)

`gm-390-26-combat-running.png`. The card of the selected combatant comes first and is about 700 px tall; the turn order list, which is the only place that shows whose turn it is, who is down and which statuses are on whom, comes after it. The header line "Turn: Ice Warden" is 12 px grey text, and in that image the card shows Mira Test while it is the Ice Warden's turn. At 1280 the two sit side by side (`gm-1280-26`), which reads well. `src/views/combat.js:955` (card, then `ul.cmb-list`), `:610` (one column under 900 px). Size S: put the list first under 900 px, or a compact strip of the order above the card.

### A4. A player's turn starts under windows (player, 2)

`player-360-07-fight-status-banner.png`, `player-360-08-fight-combat-hud.png`. When the GM's Next reaches the player, the phone shows the "POISONED" window (description, effects, "Confirm" and "Confirm all (2)") on top of the HUD and the sheet, with two toasts above it ("−19 HP · Frost Lance", "−2 HP · Poisoned 2 poison damage"). The "In combat · Round 1 · Your turn" banner and the HUD's ▶ TURN are both behind the dimmer. The player has to clear two windows before seeing it is their turn. The window queue is `src/views/ui.js:78` onward (`Confirm all` at `:160`); the status window is raised by the status applier in `src/edge/room-events.ts`; the banner is `src/views/table.js:214`. Size M: a turn start should lead with "Your turn" and fold status ticks into it, or show the ticks as lines on the HUD.

### A5. The sheet opens on an edit form, the state is far below (player, 2)

`player-360-11-status-top.png`, `player-360-29-hunter-dying.png`, `player-360-30-status-chip-card.png`, `player-360-35-status-penalized.png`. The first screen at 360 is Name, Job and Title inputs, Look and Delete hunter, then Level and HP. The conditions (Poisoned 3r, Slowed 2r, Unconscious, Penalized) are under MP, Fatigue and the two rest buttons, about 600 px down. In `player-360-35` the hunter is Penalized and nothing on the first screen says so. `src/views/hunter.js:345` (identity row), `:372` (Conditions label and `[data-chips]` at `:373`). Size M: show the chips beside Level and HP, and fold the identity fields behind an Edit.

### A6. A player can edit and delete the GM's Job Change step (player, 2)

`player-360-16-quests-active-job-step.png`. A player in a room sees Complete, Fail, Edit and Delete on "Job Change 1/3: Requirements". The lock that hides Edit and Delete for room quests applies only when `q.from === 'gm'`; the image shows the chain's step passes it. Seen in the image; whether Delete then removes the chain was not run. `src/views/quests.js:374` (`lock`), `:375` (`del`), `:389`, `:391`. Size S.

### A7. Job Change step 1 has minus and plus (player, 2, known)

`player-360-16-quests-active-job-step.png`. "Reach Level 10" shows −, 2/10, + . The player can push it to 10/10 and is then refused. `src/views/quests.js:365` (`objHtml` draws the buttons for any live quest). Size S.

### A8. Send award is not sticky (GM, 2, known)

`gm-390-13-award-form-editor.png`, `gm-390-14-award-form-bottom.png`. With an item, a title and a boon, Send award is a small outlined button below the whole reward editor, far under the hunter ticks; the GM scrolls past the editor to send. At 1280 it is under the fold too (`gm-1280-14`). After a send the only feedback is a green line under the button ("Awarded to 0 local hunters. Sent to 1 remote.", `gm-1280-15`), which reads oddly when only remote hunters were picked. `src/views/gm.js:545` (button), `:323` (message). Size S: the `dlg-actions` sticky bar the makers use (`public/app.css:425`).

### A9. The Workshop is under More on a phone (GM, 2, known)

`gm-390-41-more-menu.png`. The GM's bottom bar is GM, Combat, Quests, Dice; the Workshop, Bestiary and Gates are in More. Every maker is More, Workshop, New. `src/app.js:90` (`BOTTOM_GM`). Size S: a "Make" row at the top of the GM view, or the Workshop in the GM's bar.

### A10. Toasts cover the top of the screen (both, 3, known)

`player-360-15-inventory-use-window.png`, `player-360-16`, `gm-390-26`, `gm-390-28`. Toasts are fixed at the top on a phone, 56 to 76 px each, up to three; they cover the room pill, the jump chips and the view's heading for 3.2 s. Several images show two at once over the round header. `src/views/ui.js:73` (three kept), `:74` (3.2 s), `public/app.css:310`, `:368`. Size S: one line, bottom above the bar, or merged into the header.

### A11. The item maker shows every field for every type (GM, 3)

`gm-1280-06-maker-item-filled.png`, `gm-390-06-maker-item-filled.png`. A consumable still gets Slot, "Bonus while worn" with nine number boxes (STR to AC), and the quick effects "Worn: +1 attack", "Worn: +1 damage", "Worn: +1 AC". The fixed fields Heals HP, Restores MP and Removes fatigue do what the Heal effect row does, so there are two ways to make a potion. The window is the longest of the makers. `src/views/loot.js:67` to `:71`, and the quick list in `src/views/maker.js:206`. Size M: show the worn block only for weapon, armor and accessory; one way to heal.

### A12. By-rank values printed in full where the rank is known (GM, 3)

`gm-1280-27-combat-monster-card.png`, `gm-390-27-combat-monster-card.png`, `gm-390-08-maker-enemy-filled.png`. The C-rank Ice Warden's Frost Lance reads "Deals 2d8 / 2d8 / 4d8 / 2d8 / 2d8 / 2d8 damage, by rank E to S" on its card in a fight. A GM wants "4d8". `src/core/combat/status.ts:296` (`BY_RANK`), drawn at `src/views/combat.js:307`. Size S.

### A13. A pressed chip barely differs (GM, 3)

`gm-1280-06` (Consumable, A target, Flat), `gm-1280-07` (Active, A target, By rank), `gm-390-07`. The pressed state is a slightly lighter fill and a cyan border on a dark fill; on a phone in daylight the three-way "Flat / By rank / % of max HP" choice is hard to read. `src/views/maker.js:29`, `:191` (`aria-pressed`), CSS at `:373`. Size S: a filled cyan pressed state, as the bottom bar's current tab.

### A14. Button kinds are not told apart (both, 3)

Every image. `button.primary` changes only the border and text to cyan; `button.danger` has no resting style, only a red hover (`public/app.css:199`, `:200`), so Delete, Remove and Damage look like Edit on a touch screen (`gm-390-10` Delete beside Duplicate, `gm-1280-26` Damage, Remove). "Delete hunter…" is the one red one (`.linkish.danger`). Size S.

### A15. The jump chip row is cut off (player, 3)

`player-360-11-status-top.png`. "Stats, Build, Skills, Titles, Ge…" and the rest (Gear, Inventory, Party and so on) are off the right edge with no fade or arrow. Inventory, the second most used block, is reached by a sideways swipe nobody is told about. `src/views/hunter.js:322`. Size S.

### A16. "Delete hunter…" on the first screen (player, 3)

`player-360-11-status-top.png`. It sits beside Look, under the title field. A backup is taken first, but the button has no business on the screen a player opens 50 times a session. `src/views/hunter.js:345`. Size S: move to the Party panel, which already lists hunters.

### A17. Monster info windows on the player's phone mid-fight (player, 3)

The debug run caught "MONSTER INFO UNLOCKED — ICE WARDEN (C)" covering the player's sheet seconds after the GM marked it defeated (the script waits for it, `notes-audit.md`). Each new kill raises a window the player must close. `src/views/bestiary.js:61`, `:127`. Size S: a toast or a line in the feed.

### A18. Control edges are too faint (both, 3)

`--line` (`#1b4a6e`) on the panel (`#081426`) is 2.0 to 1, on the page ground 2.2 to 1, on a button's fill 1.6 to 1. It is the edge of every input, select and plain button, so an empty field (`gm-1280-17` Due in hours, Penalty on failure) reads as a dark band. WCAG asks 3 to 1 for a control's edge. Text is fine: muted `#7f9db5` is 6.5 to 1 on the panel, cyan-dim 8.7, red 5.7, mp blue 5.7, placeholder `#7a98b0` about 6. `public/app.css:7`, `:246`. Size S.

### A19. The desktop nav wraps (GM, 3)

`gm-1280-03` and every `gm-1280-*`. Thirteen views in letter-spaced capitals take two rows at 1280: Device, Room and Data drop to a second row, and the content starts 185 px down. `src/app.js:157`, `.tab` in `public/app.css` around `:100`. Size S.

### A20. Desktop is a stretched phone (GM, 3)

`gm-1280-10-workshop-filled-top.png`: each Workshop entry is a 1190 px row with its description in one line and its four buttons on the left; the "Share custom content" button floats alone at the right above the first section. `gm-1280-13`, `gm-1280-14`: the Award form fills the left half and the right half is empty below the collapsed sections. `gm-1280-35-data-view`, `gm-1280-37-rules-reference`: lines run 1,150 px. `src/views/workshop.js:67`, `src/views/gm.js:540`. Size M: a two- or three-column grid of entries, a reading width on text views.

### A21. The skill maker is narrow at 1280 (GM, 3)

`gm-1280-07-maker-skill-filled.png`. The skill maker is one column in a 540 px window, and its preview is below the fold; the status and item makers are two columns at the same width (`gm-1280-05`, `gm-1280-06`). The skill maker has the most taps (13). Size S: the same two-column layout.

### A22. Save and Cancel trade places (both, 3)

Makers: Cancel left, Save right (`src/views/maker.js:287`, `gm-1280-05`). The quest form: Save quest left, Cancel right (`src/views/quests.js:571`, `gm-1280-17`). System windows: Close left and the action right (`gm-390-30`). Size S.

### A23. Dying and Unconscious (player, 3)

`player-360-29-hunter-dying.png`, `player-360-30-status-chip-card.png`. The death panel says DYING with its pips; the chip above says Unconscious, and its card explains death saves. A player reads two conditions. `src/views/hunter.js:485` (panel), the chip from `src/core/hunter/chips.ts`. Size S. (Wording, but the two labels mislead, so it is here.)

### A24. Applying a status is two taps (GM, 3, known)

`gm-1280-24-status-dialog-existing.png`, `gm-1280-25-status-dialog-picked.png`. A built-in chip previews, then Apply puts it on. Size S.

### A25 to A28 (known, confirmed or read)

- A25: the enemy maker's starting status row puts its "×" on a line of its own under "Hasted / 3 / rounds" (`gm-390-08-maker-enemy-filled.png`, `src/views/bestiary.js:194`).
- A26: Enter in a reward editor text field inside the quest form submits the quest (`src/views/quests.js:580`, read, not run).
- A27: no death save prompt at a dying hunter's turn start (read, not shot; the fight's turn start is `src/core/combat/encounter.ts`).
- A28: the quest edit form offers Kind for a Penalty Zone quest (read, `src/views/quests.js:410` onward).

### A29. The disabled Title chip (GM, 4)

`gm-390-14-award-form-bottom.png`, `gm-1280-15`. With one title in the reward, "Title" in the Add row turns to 35 per cent opacity (2.9 to 1) with no reason. `src/views/reward-editor.js:154`, `public/app.css:198`. Size S: a `title` attribute and a short line ("one title per reward").

### A30. Dice quick sheet (player, 4)

`player-360-19-dice-quick-sheet.png`. The Status tab stays lit while the Dice tab's sheet is open; d100 drops to a second row at 360. `src/views/dice.js`, the bar in `src/app.js:160`. Size S.

### A31, A32 (known)

- A31: the session log's use line runs title and text together (`gm-1280-32-session-log-uses.png`; `copy-tasks.md` unit 6); the share code box cuts its seventh line (`gm-390-36-share-code.png`).
- A32: the rules reference's countdown timing (`src/views/rulesref.js`).

### A33. Workshop rows (GM, 4)

`gm-390-10-workshop-filled-top.png`. Every entry has four equal buttons, Edit, Duplicate, Delete, Share, a 44 px row under each entry; with 20 entries a kind is a long list of identical button rows. Delete has no danger look (A14). `src/views/workshop.js:67` onward. Size S: Edit on a tap of the row, the rest behind one "⋯".

## Measured

- Tap targets on a 360 px touch phone (a throwaway script, every visible button, link, input, select and summary on Status, Quests, Gates, Combat, Bestiary, Workshop, Dice, Rules, GM, Data, Device and in the five makers): all are 44 px or more except the skip link (139 by 41). The `(pointer:coarse),(max-width:720px)` rules from phase 1 hold. The first measure of the item and enemy makers read 40 px for every control; that was the window's opening scale, not the layout.
- Inputs under 16 px on the phone: only the Data view's file input (`input[data-import]`, 13.3 px), which opens a picker and does not zoom.
- Contrast: see A18 and A29. Every text colour in `:root` is 4.5 to 1 or more on the ground, the panel and a button's fill; disabled text is 2.9 to 1.
- Focus: `button`, `select`, `input` and `.tab` have a 2 px cyan `:focus-visible` outline (`public/app.css:106`, `:197`); a text field's focus is a cyan border (`:245`). `summary` (every collapsible section of the GM view) and plain links fall back to the browser's ring. System windows and makers trap focus, close on Escape and give focus back (`src/views/ui.js:78` onward, `src/views/maker.js:316` to `:323`). Icon buttons I checked have labels (`× ` in the reward editor "Remove …", toasts "Dismiss notification", the quest − and +).

## Shared components and tokens

What exists today, and what would merge into what.

**Tokens.** `:root` in `public/app.css:4` to `:28` has colours (`--ground`, `--panel`, `--panel-solid`, `--line`, `--line-bright`, `--cyan`, `--cyan-dim`, `--muted`, `--ice`, `--gold`, `--red`, `--mp`, `--xp`, `--green`, `--purple`, six `--rank-*`, six `--rar-*`), layout (`--nav-h`, `--rail-w`, `--content-max`, four safe-area insets), fonts (three) and a text scale `--ts`. There is no spacing, radius, control height or z-index token. `app.css` has 72 hard-coded colours (hex or rgba) and the views' own CSS strings 156 more (quests 22, custom 14, hunter 14, gates 11, gm 11 and so on); most are `rgba()` of the accent or of red for glows, the rest repeat a token's value (`#59e6a8` in `bestiary.js:196`, `#b78cff` for fatigue in `app.css:187`). Control heights are written per view: 44 in the makers (`maker.js:370` to `:396`), 40 in combat (`combat.js:636`, `:638`, `:643`, `:647`) and the bestiary (`bestiary.js:184`, `:196`, `:380`), raised to 44 again by media rules. Proposed: `--space-1..4` (4, 8, 12, 16), `--control-h` (44 on touch, 36 on a mouse), `--edge` (a control edge at 3 to 1), `--danger`, `--z-toast`, `--z-overlay`, `--z-bar`.

**Buttons.** Today: the default `button` (`app.css:191`), `.primary` (cyan border and text), `.danger` (hover only), `.linkish` (a dashed underline), `.mk-chip` (makers and the reward editor, `maker.js:373`), `.cmb-ab` (a monster's skill, mono and cyan, `combat.js:647`), `.emb-btn` (Look), `.help-btn`, `.t-x` (toast close), `.rw-rm`, `.mk-fx-rm`, `.enm-rm` (three 44 px "×" buttons drawn three ways), `.dice-btns button`, `.tab` (nav), the quest tabs, the inventory Items/Shop toggle, the room pill. Merge: one button with four kinds (primary filled, plain, quiet, danger with a resting red edge), one icon button (the three "×"), and one segmented control for every one-of-n choice (`.mk-chip[aria-pressed]` modes, the Items/Shop toggle, the quest tabs, Adv/Normal/Dis in the dice sheet).

**Chips.** Today: `.chip` (sheet conditions, `hunter.js:497`), `.gm-chip` (board), `.gt-chip` (gates), `.lo-chip` (loadouts), `.ob-chip` (onboarding), `.fg-chip` (status window), `.cmb-tag` and the row's coloured status words (combat), `.tb-conds` (player HUD), `.bst-tag`, `.n-tag`, `.t-tag`, `.lv-tag`, `.rw-tag`, `.dx-tag`, `.rank-badge`. A status on someone is drawn four ways: the sheet chip with "· 3r ×" (`player-360-30`), the combat card chip (`gm-1280-26`), the turn-order word without rounds, and the HUD word. Merge: a status chip (colour from the status, rounds, an optional ×) used by all four, and one tag (small caps, outlined) for kinds and ranks.

**Cards.** Today: `.win` (the cornered panel), `.qc` (quest), `.inv-card`, `.gm-card`, `.bst-card`, `.sh-card`, `.cmb-card`, `.rm-card`, the Workshop's entry row, the reward editor's row. Same thing drawn two ways: `.inv-card`, the Workshop row and the reward editor row are each a bordered box with a title, a muted line and a row of buttons. Merge into one entry card.

**Fields.** `ui.field` (`.field` with `.lbl`) is used almost everywhere. Exceptions: the identity inputs `.id-input` (`app.css:150`, underline style), the room code input (`room.js:10`, mono 20 px), and inline `style="min-height:40px"` labels in the bestiary (`bestiary.js:380`, `:381`). Keep `ui.field` as the one field.

**Dialogs.** Two shells: `ui.system` (`.sys-overlay .sys-window`, centred, a tag, a big title, lines, a row of actions) and `maker.open` (`.mk-overlay .mk-win`, a scrolling body and a sticky Cancel/Save bar). The quest form and the Award form are neither: they are in-page forms with their buttons at the end. Merge: forms that run longer than a screen get the maker's sticky action bar (`.dlg-actions`, `app.css:425`); one button order everywhere (Cancel left, the action right).

**Sticky action bar.** Exists only in makers. Needed by the Award form (A8), the quest form and the gate edit form (`gm-1280-19`).

**Toast position.** Top on a phone (`app.css:368`), top right on a desktop (`:310`). Proposed: bottom, above the bottom bar, one line, at most two, never over a window's actions.

**Inline styles.** 32 `style="…"` in `src/views/*.js`: `combat.js` 12 (`margin-top:0` five times, `flex:1 1 100%` four), `custom.js` 4, `table.js` 3, `dice.js` 3 (two colours by token), `bestiary.js` 2 (the 40 px labels), `inventory.js` 2 (`font-size:13px;color:var(--cyan-dim)` is the muted note style). Each is a class the CSS already has or should have.

## What looks good and should not be touched

- The System window look: the cornered `.win` panels, the glow titles, the "! SYSTEM" tags (`player-360-05-reward-received.png` is the app at its best).
- The makers' live preview and the reward editor's "The player sees" box (`gm-390-09`, `gm-1280-15`): the GM sees what the player will read before sending.
- The skill target picker: one tap per target with its AC (`gm-390-28-skill-target-picker.png`).
- The onboarding code check under the field ("No room with that code", `player-360-02`) and the Room view's states.
- The GM board cards at 390 (`gm-390-12`): HP, MP and fatigue bars with ±1, ±5 and a typed amount, all 44 px.
- Combat at 1280 (`gm-1280-26`): card and turn order side by side, ▶ on the current row, status words on each row.
- The death save panel's pips and Roll death save (`player-360-29`).
- The 44 px touch rule and the 16 px inputs from phase 1: measured and holding everywhere.
