# UI and UX run: what gets fixed, in what order, and the decisions

Written by the UI lead from `audit.md` (33 findings, ids A1 to A33). Four units, one helper each, in this order. A unit's helper reads the audit entries its brief names; this file holds the decisions the audit left open.

## Order

| Unit | What | Findings | Main files |
|---|---|---|---|
| 1 | The shared look: tokens, button kinds, pressed chips, control edges, toasts, the sticky action bar and one button order | A8, A10, A13, A14, A18, A22, A29 | `public/app.css`, `src/views/ui.js`, the CSS of `maker.js`, the Award form in `gm.js`, the quest form in `quests.js` |
| 2 | The creation flows | A1, A9, A11, A12, A21, A24, A25, A26, A33, A31 | `forge.js`, `workshop.js`, `loot.js`, `bestiary.js`, `skills.js`, `reward-editor.js`, `gm.js`, `combat.js:307` |
| 3 | What a player touches | A4, A5, A6, A7, A15, A16, A17, A23, A27, A28, A30, A32 | `hunter.js`, `quests.js`, `bestiary.js:61`, `ui.js`, `dice.js`, `rulesref.js` |
| 4 | The GM's fight on a phone, and the desktop | A2, A3, A19, A20 | `combat.js`, `table.js`, `app.js`, `workshop.js`, `app.css` |

Unit 1 goes first because every later unit uses its classes. After unit 4 the script `scripts/ui-shots.ts` runs again into `ui-pass/after/`.

## Decisions

Each is a product call the lead made so no one has to ask the owner. The report lists them under "Things the owner can choose".

- **Toasts (A10).** Bottom of the screen above the bottom bar on a phone, bottom right on a desktop. One line each where the text fits, at most two shown; a third replaces the oldest. Never over a window's action bar: while a window or maker is open the toast box sits above the action bar or at the top of the window, whichever the helper can prove with a screenshot.
- **Buttons (A14).** Four kinds: `primary` is filled (cyan fill, dark text), plain is today's default, `quiet` is text only, `danger` has a red edge and red text at rest. One per window is primary: the action the window exists for.
- **Button order (A22).** Cancel or Close on the left, the action on the right, everywhere.
- **Pressed chip (A13).** Filled cyan with dark text, the same as a primary button. A one-of-n choice is one segmented control class.
- **Control edge (A18).** A new token for the edge of a field or button at 3 to 1 or more on the panel; `--line` stays for decorative rules.
- **Tokens.** Add only the tokens unit 1 uses: a control height (44 px), a radius if one value repeats, a spacing step if one repeats, the control edge, and the z-index of the toast box. No token nothing reads.
- **Sticky action bar (A8).** The Award form and the quest form get the makers' sticky bar. The Award message after a send names only who got it ("Sent to Mira" not "Awarded to 0 local hunters. Sent to 1 remote.").
- **The Workshop status maker (A1).** `forge.status` takes a mode. In the Workshop it is a maker like the others: no Rounds, no "Apply existing", no "Save to library", and its button says "Save status". In a fight it stays the apply window.
- **Applying a built-in status in a fight (A24).** One tap. Rounds and the strength sit above the chips with their defaults (the status's own duration, the target's rank); a tap on a chip applies it with those. The preview stays for a new status.
- **Makers from home (A9).** The GM view opens with a "Make" row: Status, Item, Skill, Enemy, Reward, and a link to the Workshop. Each opens its maker in one tap. The bottom bar stays as it is.
- **The item maker (A11).** The worn block (slot, bonuses, the "Worn:" quick effects) shows only for a weapon, armor or accessory. The fixed Heals HP, Restores MP and Removes fatigue fields go; the effect rows do it. An old item that holds those fields still loads and still heals (the parser keeps reading them); the maker shows them as effect rows.
- **A skill's numbers on a monster (A12).** A monster's card and the enemy maker's preview print the value at the monster's rank.
- **Workshop rows (A33).** A tap on the row edits. Duplicate, Share and Delete sit behind one "⋯" button; Delete is a danger button.
- **The sheet (A5, A15, A16).** The first screen is the hunter's state: name, job and title as text with an Edit button that opens the three inputs; level and XP; HP with its buttons; then the condition chips; then MP and fatigue. "Delete hunter" moves to the Party panel beside the hunter's name. The jump chip row shows a fade at the edge it scrolls toward.
- **A player's turn (A4, A17).** On a player's phone, a window is for something the player must decide or a reward. A status that lands or ticks in a fight, damage taken, and "Monster info unlocked" are toasts and feed lines. When the turn reaches the player, "Your turn" is the one thing that shows large.
- **Dying (A23).** The chip says Dying while the death panel says Dying, and Stable when stable. The chip's card explains death saves as now.
- **A GM's quest on a player's phone (A6, A7, A28).** A quest issued by the GM (a room quest or a chain step) has no Edit and no Delete for a player in a room. A Job Change step whose objective the System counts (the level) has no minus and plus. The edit form of a Penalty Zone quest has no Kind.
- **Death save prompt (A27).** When a dying hunter's turn starts in a fight, the GM's card for that hunter shows "Roll death save" first, and a player's phone shows the death panel with the same button. No new window.
- **The fight on a phone (A2, A3).** Under 900 px the turn order comes first as a compact list (the ▶ row, HP as a thin bar, status words, a down mark), and the selected card opens under it. The Table feed is one collapsed line with a count of new rows; it is not sticky when it has nothing new.
- **Desktop (A19, A20, A21).** The nav fits one row at 1280. Workshop entries are a grid of cards. Text views (Data, Rules) have a reading width of about 70 characters. The skill maker uses the two-column layout the status and item makers use.
- **Left out on purpose.** Makers for jobs, paths and rule numbers (the customization phase decided this). A light theme. Icons beyond the ones in the bar. Merging the four ways a status is drawn into one chip component and the ten card classes into one: the audit shows it, it touches every view, and it changes no behaviour a player feels; the report lists it for a later pass. The wording items stay in `copy-tasks.md`.

## Checks every unit runs

- `bun run test`, and the browser test files of every view it touched, one at a time, with `E2E_CHROMIUM=/opt/pw-browsers/chromium`.
- A browser test for each behaviour it changed (taps, what is visible, what is hidden for a player), written as what a player or GM sees. A test that pinned the old behaviour is rewritten to the new one, not deleted.
- The screens it changed, shot again with `scripts/ui-shots.ts` into a scratch folder and looked at with the Read tool, before it reports. If a fix changes the taps the script makes, the script is updated in the same commit.
