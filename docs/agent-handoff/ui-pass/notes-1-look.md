# Notes, unit 1: the shared look

Principles read: experience-first, laziness-protocol, subtract-before-you-add. Subtract-before-you-add made me fold the unstyled `.x-btn` (inventory, skills) into the icon button instead of leaving a fourth "×" class.

## Tokens (in `:root` of `public/app.css`)

- `--edge` `#3f7fb0`: the edge of every input, select, textarea and plain button. `--line` stays for rules and panel borders.
- `--control-h` `44px`: a touch target's height and width.
- `--z-toast` `60`: the toast box, above the bottom bar (40) and the windows (50).

No spacing or radius token: no single value repeats in what this unit touched.

## Contrast of `--edge` (WCAG relative luminance, computed)

`--panel` is `rgba(8,20,38,.82)` over `--ground` `#04070f`, which is `#071222`.

| Edge on | Old `--line` `#1b4a6e` | `--edge` `#3f7fb0` |
|---|---|---|
| `--panel` | 2.0 to 1 | 4.4 to 1 |
| `--ground` | 2.2 to 1 | 4.7 to 1 |
| a plain button's fill (`rgba(17,42,70,.85)` on the panel) | 1.6 to 1 | 3.5 to 1 |
| a field's fill (`rgba(6,14,26,.9)` on the panel) | 2.1 to 1 | 4.5 to 1 |

Dark text (`--ground`) on the cyan fill of a primary button: 12.1 to 1.

## Step 1

Shot every screen into a scratch folder; looked at `gm-1280-17-quest-form` (empty Due in hours and Penalty fields now read as fields) and `player-360-11-status-top`.

## Step 2: button kinds

- `button.primary`: filled cyan, dark text. `button.primary.danger` (a destructive confirm): filled red, dark text.
- `button.danger`: red edge and red text at rest.
- `button.quiet`: text only, no edge. Added for later units; nothing in this unit needed it.
- `.icon-btn`: a 44 px square holding one glyph. Replaces `.rw-rm`, `.mk-fx-rm`, `.enm-rm` and the unstyled `.x-btn` (inventory, skills).

Primaries taken away (one per window or form is left): Heal beside Damage (GM board card, sheet HP, combat card, table HUD), Extract on the combat card, +1 day in Gates (Spawn gate stays), per-row Buy, Use, Redeem, Apply to…, Open as GM. Roll initiative is primary before the fight, Next once it runs. Made `danger`: Forget (a GM key), Remove (a gate's monster row).

Left: the target pickers (`combat.js:390`, `table.js:305`) keep their first target primary; the audit asks not to touch the picker, and tests tap the primary. Each gate card keeps Enter or Clear, each quest card Complete: a card is the thing that action is for. The Room view's cards show one at a time.

A29: a full Add chip in the reward editor has a `title` and a line under the Add row says why ("One title per reward.", "At most 20 items per reward.").

Checked: `makers.e2e.ts`, `rewards.e2e.ts`: 19 passed.

## Step 3: the one-of-n choice

- `.seg`: a row of buttons for a one-of-n choice; the chosen one (`aria-pressed="true"` or `aria-selected="true"`) is filled cyan with dark text. A pressed `.mk-chip` (a many-of-n chip) is filled the same way.

Used by: the makers' one-of-n chip groups (`chips()` without `many`) and the effect rows' modes, the inventory Items and Shop tabs, the quest tabs, the dice Adv, Normal, Dis (Dis fills red), and the device settings' text size and motion (was `.cz-seg`). Each keeps its `aria-pressed` or `role="tab"`. Removed: the local pressed rules in `maker.js`, `inventory.js`, `quests.js`, `dice.js`, `custom.js`. The reward editor's Add row adds rows, so it is not one-of-n and stays chips.

Checked: `gates-quests-dailies.e2e.ts`, `customization.e2e.ts`: 28 passed.

## Step 4: toasts

At most two (`ui.js`: a third replaces the oldest); each is one row (tag, text, ×), the text wraps only when it does not fit. Phone: full width, just above the bottom bar. Landscape phone: bottom right. Desktop: bottom right, above the dice button. While a window (`.overlay.show`), the onboarding or the dice sheet is open, the box moves to the top of the screen, so it never covers their buttons. "Dismiss notification" and `aria-live="polite"` kept.

Proof at 360 by 780 (a GM on the starter campaign, three toasts raised; images in the session scratch folder `toast/`, script `toast-shots.ts` beside them, not committed): `toast-1-bottom-bar.png` (two toasts above the bar, the bar clear), `toast-2-window.png` (a Delete confirm open: toasts at the top, Cancel and Delete clear), `toast-3-maker.png` (the status maker open: toasts over its top, Cancel and Apply clear).

Test: `tests/e2e/look.e2e.ts`, "on a phone, three toasts in a row show the last two above the bottom bar, and the bottom bar can still be tapped": 1 passed.

## Step 5: one button order and the sticky bar

- `.dlg-actions` (now in `public/app.css` for any long form, no longer only `.dlg-form` on a desktop): a sticky bar at the bottom of the form, Cancel or Close left, the action right. In a view on a phone it sits above the bottom bar; on a desktop it keeps 48 px clear on the right for the dice button. A System window form keeps its old desktop offsets.

Used by: the Award form (its message sits in the bar, left of Send award), the quest form, the gate edit form. Order fixed (Cancel first): the quest form, the gate clear and edit forms, the title form on the sheet, the bestiary merge form. The System windows already put the cancel action first in a row; the list windows (pickers) keep Cancel last, under the list.

The Award message names who got it: "Sent to Brakk Ironhide.", "Sent to Mira and Brakk.", "Not sent to Mira: offline." when the room send fails, "Mira needs a room (…)" when there is no room. `scripts/ui-shots.ts` waits for the new words.

Test: `tests/e2e/look.e2e.ts`, "on a 390 px phone, with an item, a title and a boon in the Award form, Send award is in view without scrolling and one tap sends it". Checked: `look`, `rewards`, `gates-quests-dailies`, `reward-room`: 27 passed.

## Step 6: inline styles

Classes added in `public/app.css`:

- `.field.chk`: a checkbox and its words in a row of fields, `--control-h` tall (the bestiary's Boss and Elite, were `min-height:40px`).
- `.row-full`: a field that takes a whole line of a wrapping row (combat's Target and Abilities fields, the Room view's GM key).
- `.flush`: no top margin (combat's add rows, the dice log row).
- `.lbl.sec`: a label that starts a part of a panel, 12 px above (combat's Combat log, the dice Quick check; were 14 and 6 px).
- `.note`: the muted 13 px note (an inventory slot's meta line).

Module CSS instead: `.dx-tag.crit` and `.dx-tag.fumble` (dice), `.chip .c-end` (hunter), `.inv-slots` (inventory), the onboarding name input's 16 px in `.ob-form input`.

Left inline, each computed at run time: bar widths (`combat.js` two, `gm.js`, `quests.js`, `table.js` two), a hunter's or swatch colour as a custom property (`custom.js` four, `forge.js`), a status's own colour (`hunter.js` chip border, `table.js` chip border, `rulesref.js` text).

## Step 7: everything

`scripts/ui-shots.ts` ran against this build on port 3261 into the session scratch folder `after-1/`: 117 shots, no missing step (the script's only change is the Award message it waits for, in step 5). Looked at `gm-390-07` (skill maker: By rank filled, Save skill filled), `gm-390-10` (Workshop: New filled, Delete red), `gm-390-14` and `gm-390-15` (Send award pinned above the bottom bar), `gm-390-26` (combat: Next filled, Damage and Clear red, two toasts above the bar), `gm-1280-17` (quest form: Cancel left of Save quest, clear of the dice button), `gm-1280-23` (combat build, toasts bottom right above d20), `player-360-05` (reward window untouched), `player-360-14` (Items and Shop), `player-360-16` (quest tabs), `player-360-19` (dice sheet: Normal filled, toasts moved to the top).

`gm-390-15` showed "Sent to h1." for a remote hunter: the name came from the end of the selection key. Fixed to the room sheet's name (`remoteName`), which also fixes the same id in the session log's award line; `reward-room.e2e.ts` now checks "Sent to Mira Test.".

The first `bun run ci` ran while the screenshot script ran beside it: 149 passed, 1 failed (`makers.e2e.ts:372`, the goblin's HP did not drop within 15 s after Frost Lance). Alone it passed (8.5 s) with `reward-room.e2e.ts`; read as load, not a bug, and CI was run again with nothing beside it.

Wording left for `copy-tasks.md`: none new.

`E2E_CHROMIUM=/opt/pw-browsers/chromium bun run ci` on `d5be562`, last lines:

```
 1657 pass
 0 fail
  150 passed (11.9m)
CI passed
```

## For the next units

Reach for: `--edge`, `--control-h`, `--z-toast`; `button.primary` (one per window), `button.danger`, `button.quiet`, `.icon-btn`; `.seg` for a one-of-n choice; `.dlg-actions` for a long form's sticky bar; `.field.chk`, `.row-full`, `.flush`, `.lbl.sec`, `.note`.
