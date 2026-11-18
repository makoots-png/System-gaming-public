# Notes: kits at the table, typed rolls, more info on anything (brief-kits-table.md)

Goal: the owner's players meet stacks, triggers and reactions for the first time on a phone mid-fight, so each thing must
say what it does where it sits, the kits' state must show on the table, and the Dice view must take Roll20 text. The
smallest change: one detail component over the sentences core already writes, the kits' fields carried from the fight
and the doc into the existing card, HUD, map and hotbar, and the Dice view's field reading through `rollFormula`.

Poteto mode came in at the start of step 2 (the coordinator's message after the usage reset); step 1 was built before it.

## Data shapes, named first

- A detail: `Thing` (a union of status, ability, item, zone, number) in, `Detail` (`title`, `about`, `lines`) out, from
  `detailOf` in core. The view keeps one open key per list (a `Map`), nothing else.
- A sheet number's breakdown: `Part[]` keyed by `SheetSource` (a closed list in a fixed order), summing to the number.
- A reaction on the hotbar: `Slot.react`, a three-state union `arm | armed | spent` read from `Body.armed` (table 8.9.1),
  not a pair of booleans.
- The table's moments: a threshold's burst is the reducer's `burst` effect on the GM's phone and the doc's `DocBurst`
  (`n`, `ids`) on a player's; a reaction firing is the `spent` state of 8.9.1 carried in the doc (`spent`), so a token
  that turns `reacted` is the moment.

## Decision trail

- The burst on a player's phone. Three ways weighed: (a) read the fight log's "goes off" line on the player's phone
  (text parsing, breaks on a copy change); (b) record bursts in the fight state (design 1.2 says nothing records that a
  threshold fired, and it would be a field no rule reads); (c) a `burst` effect from the reducer, which the GM's phone
  keeps as the last one with a count and puts in the doc through `DocContext`, as `refused` already is. Chosen (c): the
  fight stays as designed, the doc carries only the latest, and the count lets a phone show each once.
- A reaction firing. Weighed: an effect like the burst, or the state the machine already has. Chosen the state: a
  reaction stays `spent` until its reactor's turn, so a doc a phone polls late still shows it, where a one-off effect
  could be missed. The doc gains `spent` beside `armed` (12 ids, the same bound).
- Doc size: `spent` and `burst` add 217 characters to the worst case, 55,094 measured, 61,981 with the eighth (under
  62,000). A summon's `left` does not move the worst case (all monsters).

## Log

- Start: worktree `worktree-agent-a4d45b0c06fc78a3a`, fast-forwarded to 318b306 ("Trail: the kits line merged").

## Step 1: the detail component

- Core: `src/core/detail.ts` (`Thing`, `detailOf`): a status (its count of its cap, its rounds left or "Ends in" for a
  delayed one, then `describeStatus` at its source's tier), an ability (`abilityLines`' first line for what it does, its
  cost, `describeAbility`, `opLines` of its ops), an item (`describeItem`, its description), a zone (its tone's sentence,
  rounds left, `opLines` of its ops where the phone knows them), a sheet number (`explain`). Test: tests/detail.test.ts.
- `explain(h, key, R)` is in `src/core/hunter/sheet.ts`, not derive.ts: the statuses part needs `modified`
  (effect-ops.ts), which imports derive.ts, so derive.ts cannot import it back. It works the sheet out again with each
  source added in `SOURCES` order (base: a level 1 body at the base stats with nothing worn; level; stats; gear with its
  bonus; title; path; passive skills; the GM's change; statuses); a part is what its source changed after the ones
  before it. The curves, the load and the clamps are not linear, so this is the one split that always sums. Tests in
  tests/derive.test.ts ("explain"): every key sums to the sheet's number, and parts with an expected value from the rule
  (worn armor is Armor's gear part at the base Vitality, a level 1 base body is all Base at `hpBase`, `hpAdj` is the GM's
  part, a path perk and a title bonus are their own parts, a slow is a negative Statuses part).
- View: `src/views/detail.js`, `app.api.detail` (`control`, `panel`, `wire`, `show`, `close`, `isOpen`; `DetailApi` in
  api.ts), listed in `MODULES` after `effects`. The open detail is kept by list and key in the module, so a view that
  draws its markup again (a patch.ts part, `setHTML`, a list drawn whole) draws it open again; opening draws through the
  view's own redraw and then `enter`s the panel; closing `dismiss`es it and sets `aria-expanded` at once.
- Used on: a sheet chip (hunter.js, list `sheet-chips`), each number of the Derived panel (`sheet-numbers`, now
  buttons), an inventory item and a shop item (their name is the control, `inv-items`, `inv-shop`), the GM's card's
  status chips (`gm-card`) and a monster's abilities on its card (`gm-abil`), the player's HUD chips (`hud-chips`) and a
  token's card on the player's map (`tok-chips`), a zone tapped on the map and an ability held on the hotbar (map.js,
  list `map`, drawn titled in a slot between the dock and the hotbar; a tap on it closes it).
- Subtracted: hunter.js's `openChip` and `[data-chipdesc]` box, table.js's `openChip` and its `.chip-desc`, the GM card's
  `.cmb-fx` list and the chip's tap-to-remove (a chip is now the info control plus an x), the inventory line's effect
  sentences and description line, map.js's `ZONE_WORD` and its toast (the tone's sentence moved to core). Tests that read
  them now open the detail (character.e2e.ts, table-session.e2e.ts, scripts/ui-shots.ts).
- The hold: `--t-hold` (350 ms) on `:root` with its reason, read by `motion.ms('hold')`; the click after a hold is
  swallowed, and a pointer that moves past `SLOP` lets go. The hotbar and drawer refuse text selection and the context
  menu, so a long press on a phone does not select the label.
- Not done: the Skills panel's card (skills.js is the makers helper's file this round; its card already shows the
  skill's sentences, and an active skill's detail is on the hotbar in a fight).

## Step 2: kits at the table

- Core: the reducer's `burst` effect (`act` and a channel's release, one per bearer of `Resolved.bursts`; a case in
  tests/fight.test.ts "a delayed effect"); the doc's `spent`, `burst` and a summon's `left` (fight-doc.ts, read in
  protocol.ts with their bounds; cases in tests/fight-doc.test.ts and tests/protocol.test.ts, the worst case measured);
  `usesLeft` in fight-view.ts (the doc's `left` and the GM's hotbar, one function); `Card.summon`; `MapBody.summon` and
  `.stealth`, `MapToken.summon`, a stealthy foe drawn dimmed on the GM's map (`hidden`), `Extras.reacted`;
  `hotbar(..., kit)` gives each slot `left` and `react` (cases in tests/map-view.test.ts).
- A stacking status's chip shows its count (`.c-n`), counted with `numberTo` by row and key (GM card, HUD, token card);
  a threshold that goes off pops the stacked chips and plays the `channel` burst at the bearer (combat.js from the
  effect, table.js from the doc's `burst` once per count). A reaction firing plays `stagger` and a pop on the token
  (map.js, from `reacted` turning on) or on the GM's card or row.
- Arm: on the hotbar a reaction is a slot that says Arm, Armed or Spent and toggles (never aimed); in the list HUD a
  reaction row has an Arm button; the GM's card has a `.seg` (None and each reaction) with Ready or Spent. A player's
  arm is the room's `arm`; combat.js turns it into the fight's `arm` for that hunter's row at any time. A `turn`
  reaction is not offered on the GM's card (it needs a named row; not built).
- Teammates' rows say "Ready to react" or "Reacted" from the doc. A summon's row says whose it is and its rounds left;
  its token has a dashed disc and a rounds badge. The GM's Start has a Surprised `.seg` (None, The party, The foes).
- Uses left: the hotbar shows "2 left" and is off at 0 (the doc's `left` on the player's turn, `usesLeft` on the GM's).
- A delayed effect's chip reads "in N rounds" and its detail "Ends in N rounds".
- A forced move: the token already slides from its old tile to its new one (`along`); a push is a straight line, so that
  is its path. Not changed.
- `TABLE_REFUSALS`' kits words added to table.js's `REFUSED` (gated, noUses, hp, stacks, zone, extra, seen); before, a
  player saw "undefined".
- Principles: model-the-domain (the reaction as the 8.9.1 state in the doc, not an inferred flag; `Slot.react` as one
  union), subtract-before-you-add (`leftOf` in fight-doc.ts became `usesLeft`, one function for two callers),
  experience-first (a reaction's slot toggles from the hotbar rather than a separate settings place).

## Step 3: typed rolls in the Dice view

- Data shape: the roll is a `Formula` (`parseFormula`, once at the field), rolled as `Rolled` (`rollFormula`: each term's
  faces with their fates); the view keeps the faces' markup by roll id for the detail line only (the log stores the flat
  faces, not their fates, which would be a save field; not needed for this unit).
- `dice.roll` lost its own regex parser, its limits and its `d%` rewrite (subtract-before-you-add): every roll of the app
  (a die button, a check, a death save, a typed roll) goes through `parseFormula` and `rollFormula`. Adv and Dis are
  `withEdge`; the natural (crit, fumble, the coin) is `naturalOf`. The lint's list for formula.ts in views gains
  `withEdge` and `naturalOf` with that reason. The tray's random source is `trayRandom` in src/edge/roll.ts (the page's
  `Math.random` read at each die, as `rollDie`), so the tests that fix a die by replacing `Math.random` keep working.
- How a typed roll decides its kind: a roll from the field is `die`, as a die button's, and its logged text is the
  formula as typed (printed canonically, `/r d20+4` is `1d20 + 4`), before Adv or Dis. So `isCoinRoll`, the one rule,
  calls the coin for a typed plain d20 (`1d20`, `1d20 + 4`) on a natural 1 or 20 (with Adv or Dis on, the kept face is
  the natural, as before), and not for typed `2d20kh1` or `10d20kh4`: the coin's rule names only a plain d20, and a
  typed keep is the player's own dice, not a check. A check from the stat buttons stays `check`.
- The field takes 200 characters (the maker's formula field's), says what is wrong under it as it is typed (the
  parser's own message), and Enter rolls. The last ten typed rolls are kept on this device (localStorage
  `hunter-dice-typed-v1`, not the save) as buttons under the field; a tap rolls one again and moves it first.
- Shown: the total tumbles and lands, then the detail line: the canonical text and each term's faces, a dropped or
  rerolled face struck (`<s>`), an exploded one marked `!`, a success in green and the term's "N successes".
- The room's roll feed sends it as before (`roll` with its text).
- Test: tests/e2e/dice.e2e.ts (the owner's three formulas with fixed faces, a bad formula, the recent list); 5 passed.
- coin.e2e.ts "alone on a 360 px phone" failed once on a 0.34 px difference between Heads' and Tails' y (measured while
  the card rises) and passed on the rerun; a timing of the measurement, not of this change.

## Step 4: tests

- tests/e2e/map-extras.e2e.ts gains the kits' fight (`kitsFight`: Brakk's Mark puts one Pain, a GM's stacking status
  that goes off at 2; the player's hunter holds Parry on its sheet and its row) and three tests: a stack count on the
  rat rises to 1 on the player's token card and opens its detail, then a second Mark sets it off (the doc's `burst`
  names the rat, particles play on the player's page, the chip is gone); Parry armed from the player's hotbar reaches the
  GM's row, a strike sets it off, the doc names the row spent, the slot says Spent and the token reads "reacted"; a press
  and hold opens an ability's detail and does not pick it, and a tap on the detail closes it. They are in
  map-extras.e2e.ts rather than battle-map.e2e.ts and table-turn.e2e.ts: the extras' fight setup is the one that already
  places every body, and these are the kits' extras on the same map.
- Found by the stack test: a player's phone does not hold the GM's own statuses, so the detail of a GM-made status on a
  player's phone says only its count and rounds (no cap, no threshold). Not changed here: carrying the defs would be a
  doc change past its size; a player meets built-in and kit-example statuses with their full sentences.
- tests/e2e/dice.e2e.ts (step 3); tests/e2e/look.e2e.ts gains the detail at 360 and 390 (a chip, Armor's parts, an item:
  inside the screen, no text under 12 px, one open at a time); tests/derive.test.ts "explain" (step 1);
  tests/detail.test.ts; tests/map-view.test.ts (the hotbar's react and uses, a summon's and a hidden foe's token, the
  doc's spent).
- Principles: test-behavior-not-implementation (each expected number comes from the rule: the kept dice of 10d20kh4
  worked by hand, 64; Armor's gear part is the vest's armor at the base Vitality; a burst is asserted by what the
  player's page shows and holds, the doc and the particles, not by a call); prove-it-works (each browser file run).

## Step 5: close

- `bun run deps -- --write` (the map rewritten), `bun run charts` (no change: no machine changed).
- `bun run test`: "Ran 2967 tests across 75 files", 2967 pass, 0 fail.
- Browser files, one at a time on port 3251: battle-map 14 passed and 1 failed, then that test passed alone on its rerun
  (the hotbar's first tap, no failure line read into it; a pause, by helper-rules); map-extras 9 passed; table-turn 8
  passed; table-session 7 passed (after its two locators moved to the detail); character 23 passed; look 13 passed;
  coin 7 (one subpixel failure at the first run, passed on rerun, step 3); dice 5 passed; phone 8 passed;
  combat-turns and custom-skills 21 passed; feel 5 passed, alone and last.
- Lag (feel.e2e.ts, 4x CPU, one run with the box otherwise in use by others; the lead reruns it): a fight turn worst
  frame 83.4 ms, worst tap 58 ms; a player watching 33.4; a maker opening 16.8, tap 52.4; the sheet scrolling 33.4;
  the map: a pan and a pinch 33.4, an ability picked 16.8 (tap 47.5), a use 33.4 (tap 57.6).
- Shots (`scripts/ui-shots.ts --serve 3251`, 132 shots): the sheet's chip card and the GM's monster card at 390 read
  clean; the Dice view's field label ran to two uppercased lines and showed the example in capitals, so it is
  "Type a roll" with the example in the placeholder.
- AGENTS.md: rows for more info on a thing, the kits at the table and the Dice view's typed roll; the doc's row names
  `spent`, `burst` and a summon's `left`; a recipe "More info on a thing".

## Left

- The Skills panel's card (skills.js, the makers helper's file) has no detail control; a skill's sentences stay on its
  card, and an active one's detail is on the hotbar.
- A player's phone does not hold the GM's own statuses, so their detail there is the count and rounds only.
- A `turn` reaction is not offered on the GM's card (it needs the row it answers); the player's Arm sends `on: null`.
- `combat.js` does not yet pass the `vitals` effect's `used` to the sheet (notes-build-2's item for the table unit):
  not done, a rest's uses spent in a fight still do not reach the sheet.
- A forced move slides from its old tile to the new one (a straight push is its path); a pull through a corner is not
  drawn tile by tile.
- A doc status carries no flag for a delayed effect; the player's chip reads "in N rounds" only when its def is known.
