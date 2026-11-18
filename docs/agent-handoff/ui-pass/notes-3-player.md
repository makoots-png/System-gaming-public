# Notes, unit 3: what a player touches

Principles read: experience-first, fix-root-causes, test-behavior-not-implementation. Fix-root-causes made step 1 one core question (`mayChangeQuest`) asked by both the drawing and the handler, instead of hiding the two buttons in `cardHtml`.

## Step 1: a GM's quest on a player's phone (A6, A7, A28)

A6, reproduced in a browser test before the fix (a GM and a player in a room, Ranger issued over the `chain` message, the player on Quests):

- The card showed `Complete, Fail, Edit, Delete` and one minus/plus pair on "Reach Level 10".
- The player's Delete went through: the quest was gone, and the chain went to `status: 'failed'` (the view's `deleteQuest` sends `stepFailed`). The player's Quests then showed "Job Change failed: Ranger, step 1 of 3 — The GM can reissue it." So a player could break what the GM gave them with two taps, and only the GM could put it back.
- Why the old `lock` missed it: `lock = !gm && q.from === 'gm' && inRoom()`, and a chain step's quest is `from: 'system'` (`stepQuest` in `job-chain.ts`) with a `chainId`.

The fix: `src/core/hunter/quest-rights.ts`, pure, three functions.

- `gmIssued(q)`: `from === 'gm'` or it has a `chainId`.
- `mayChangeQuest(q, { role, inRoom })`: the GM any quest; a phone with no room is its own GM; a player in a room none the GM issued.
- `systemCounts(q, chain)`: true only for the chain's open quest when that step's goal is `level`. The level comes from the hunter's level through `levelChanged`, so nobody (GM included) gets minus and plus there.

`quests.js` asks in four places: `cardHtml` (Edit, Delete), `objHtml` (the buttons, through `counted`), the `edit` and `del` handlers and `setProgress`, so a stale card cannot act either. No machine, save shape or protocol change.

A28: the edit form hides the Kind field when the quest being edited is `kind: 'penalty'` (one line in `openForm`). The quest keeps its kind through `submitForm` (the select still holds `penalty`).

Tests: `tests/quest-rights.test.ts` (8 cases: each role, in a room and alone, each quest source; the step whose objective the System counts). `tests/e2e/rewards.e2e.ts` "a player in a room gets no Edit, no Delete and no minus or plus on the Job Change step the GM issued, and Complete and Fail stay". `tests/e2e/gates-quests-dailies.e2e.ts` "the edit form of a Penalty Zone quest has no Kind, and a saved edit keeps it the Penalty Zone quest".

## Step 2: the sheet's first screen (A5, A15, A16)

The Status Window panel now reads, top to bottom: the identity as text (emblem, name, "Job · Title", an Edit button), level and XP, HP with its buttons and the HP amount row, the death panel when it shows, the condition chips and Add condition, then MP, fatigue and the rest buttons.

- A5: `[data-idread]` holds the name and "Job · Title"; Edit (`[data-idedit]`) swaps in the three inputs (`[data-idform]`, the same `data-f` inputs and the same `change` handler, so a change still saves as it typed) and Done closes them. Focus goes to Name on open and back to Edit on close.
- A16: "Delete hunter…" is gone from the sheet. The Party panel's row already had a Delete that asks for the name and calls the same `api.deleteHunter` (the backup, the room `forget` and the fresh hunter when it was the last one), so nothing moved but the button.
- A15: the jump row carries `fade-l` and `fade-r`, set from its scroll position on scroll, on resize and when the Status view opens. The fade is a mask on the nav, so it costs no layout and no colour.

Chips at 360 by 780: Poisoned and Penalized are both in the viewport with `scrollY` at 0 (the test asserts `toBeInViewport({ ratio: 1 })`, not a pixel count).

Tests, all in `tests/e2e/look.e2e.ts`: "on a 360 px phone a Poisoned, Penalized hunter sees both condition chips on the first screen of the sheet" (also: no `[data-delhunter]`, the row fades right), "on the sheet, Edit opens the name, job and title inputs and a new name is saved and shown", "Delete hunter is in the Party panel, asks for the name and takes a backup first" (the backups ring grows by one).

Rewritten, not deleted: the tests that typed into the sheet's inputs now go through `editIdentity(page, field, value)` in `tests/e2e/helpers.ts` (Edit, fill, Enter, Done) and read the name from `[data-idname]`: `save.e2e.ts` (three), `pwa.e2e.ts`, `room-sync.e2e.ts`, `upgrade.e2e.ts`.

## Step 3: Dying (A23)

`chipDef(key, life)` in `src/core/hunter/chips.ts` answers what a chip reads: the `unconscious` chip takes the word the death panel uses, `LIFE_TAG[life.at]` ("Dying", "Stable"), and keeps the registry's description, so the chip's card still explains the death saves. The key stays `unconscious`: the protocol, the save repair and the combat refusals match it by name (`CHIP_REFUSAL`, `tests/protocol.test.ts`, `tests/encounter.test.ts`), and the registry entry is untouched.

Drawn through it: the sheet's chips (`hunter.js`) and the GM board's card for a remote hunter (`gm.js`); both dropped their `STATE_CHIP_DEFS` import. The combat card already used `LIFE_TAG`, so it said Dying all along.

Tests: `tests/statuses.test.ts` "a hunter at 0 HP wears the chip the death panel names: Dying while the saves run, Stable once stabilized, Dead after three failures". Rewritten: `character.e2e.ts` "At 0 HP the chip says the same word as the death panel…" (chip and `[data-life]` both Dying, then both Stable after a stabilize) and "A GM sees a remote hunter at 0 HP as Dying…".

The lint rule "nothing names the chips drawn from them" now lists `src/core/hunter/chips.ts` among the files that may name a chip: it is the file that draws them.

## Step 4: a player's turn (A4, A17)

Each notice changed where it is raised, once:

- A status that lands on a player (`applyStatus` in `src/edge/room-events.ts`): a toast, "Poisoned: −4 on checks · 1d6 damage at turn start · 3 rounds". It needs no answer, and the window sat over the turn banner.
- Falling to 0 HP (`applyHp`): a toast, "You have fallen. … Roll a death save on your sheet." The sheet's death panel is where the player acts (step 5). Damage itself was already a toast.
- "Monster info unlocked" (`unlock` and the bulk case in `src/views/bestiary.js`): a toast with the name, rank and stat line, on both phones. The Bestiary entry holds the rest.
- The player's turn (`onDocs` in `src/views/table.js`): the window is gone. The HUD's turn order gets `.tb-mine` ("▶ YOUR TURN", large, filled cyan) above Round, the Status banner reads "▶ Your turn · Round N" in the same filled style, and a toast says "Your turn. Round 1."

A reward, a quest offer, a Job Change offer and the level-up window stay windows: each is a reward or a choice.

A player's phone has no feed of its own (the Table feed is the GM's), so a toast is the notice; the GM's log and feed already carry the same lines.

Tests: `tests/applied.test.ts` "the player is told in a toast, not a window, with the numbers of the Burning the hunter now has" (and the twice-arriving event counts toasts). `tests/e2e/table-session.e2e.ts`: the two-phone fight now checks, the moment the GM's Next reaches the poisoned player, a "Your turn. Round 1." toast, an "−N HP · Poisoned …" toast, the banner, `.tb-mine` on the HUD and `.sys-overlay.show` at 0; the scaled-status test reads the numbers from the toast; `playerAcknowledges` became `playerIsTold`. `combat-turns.e2e.ts` and `makers.e2e.ts` expect the unlock toast, and `scripts/ui-shots.ts` waits for it.

## Step 5: the death save prompt (A27)

No new window and no change to the life machine: what the card and the HUD draw when `can(life, 'deathSave')` holds and it is that hunter's turn.

- `src/views/combat.js`: a `.cmb-death` line above HP on the card of a local hunter whose turn it is: the life tag (Dying or Stable) and a primary "Roll death save".
- `src/views/table.js`: the same line at the top of the player's own block in the HUD, whenever their hunter can roll a save (a player's own turn is their phone's business; the HUD is only up while a fight runs).
- `src/views/hunter.js`: the sheet's death panel keeps its button, now primary.

One roll in one place: `app.api.hunter.deathSave(hid)` (new in `src/core/api.ts`, registered in `hunter.js`) rolls the d20 through the dice log, sends the life event and toasts what it did. The card and the HUD call it; `bun run deps -- --write` ran.

Tests, `tests/e2e/character.e2e.ts`: "a dying hunter whose turn it is is asked for the death save first: on the GM's card, and on the player's HUD in a room" (the card shows Dying and the button, no window is open, a forced failure counts) and "a player in a room at 0 HP is asked for the death save on their HUD, and the roll counts on both phones".

## Step 6: the small ones (A30, A32)

- A30, one lit tab: the bottom bar lights the open sheet's tab, and `nav-bottom:has(.tab[aria-expanded=true]) .tab[aria-current=page]` steps the view's tab back (portrait and landscape rules in `public/app.css`). No JS: the Dice tab already carried `aria-expanded`.
- A30, d100: under 430 px `.dice-btns` is a seven-column grid with a 4 px gap, so each die is about 45 px wide and 44 px tall and nothing wraps.
- A32: `src/views/rulesref.js` now says "timed conditions count down at the start of the afflicted combatant's turn", which is what `turnStarted` in `src/core/combat/encounter.ts` does.

Tests: `look.e2e.ts` "on a 360 px phone the quick dice sheet keeps the seven dice on one row and leaves one tab lit" (the Dice tab takes the lit border, the Status tab loses it and gets it back when the sheet closes; seven buttons, one row, none under 40 px); `character.e2e.ts` "the rules reference says a timed condition counts down at the start of the turn, which is when the fight counts it".
