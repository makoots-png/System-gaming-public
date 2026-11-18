# W9, docs, what is owed, the full run: notes

Main tree, branch `claude/zen-pasteur-ov4cgd`, from f4bc302. Not pushed.

## Step 1: a hand edit of a hunter in a fight

Root cause: every hand edit of a hunter's HP, mana, fatigue or statuses (the sheet's step buttons and HP amount, the
HUD's HP amount, the GM board's buttons, Short and Long rest) wrote the sheet, while in a fight the fight's row holds
them; the fight's next `vitals` wrote the row back over the sheet, so the edit was lost (or, until the row changed, the
sheet and the fight disagreed).

Fix, at the one place they all pass through (`app.api.hunter` in `hunter.js`): `fightOf(hid)` says where an edit goes.
- The hunter has a row in this phone's fight (setup or running): `damage`, `heal`, `changeMana`, `changeFatigue`,
  `spendMana` and the sheet's step buttons send the fight's `adjust` (`combat.adjust`); `addCondition` and
  `removeCondition` send the fight's `status` (`combat.status`, new). New `combat.rowFor({ hid } | { key })`.
- The hunter has a row in the GM's fight on a player's phone (`uses.onTable`): no message carries a player's edit, so it is
  refused with the toast "During the GM's fight, the GM changes your HP, mana, fatigue and statuses."
- A rest during either is refused: "You cannot rest during a fight."
- The GM board's card of a player in the GM's fight (`gm.js` `sendHp`, `sendStatus`) goes to that player's row
  (`adjust`, `status`) instead of the `hp` and `status` messages, which the next `vitals` overwrote.

Not changed, listed (each a write beside the fight that a fight rarely meets):
- A reward's statuses (`applyRewards`, `hunter.js`, pushed straight on `h.conditions`) and its level-up refill (`fit`):
  an award during a fight writes the sheet and the next `vitals` puts the row's back. The fight has no command for a
  level-up; awards are given at a fight's end (`endEncounter` after `end`), so only a hand award mid-fight meets it.
- Revive (`life(hid, { type: 'revive' })` from the sheet, the GM board and the `revive` message): sets the sheet at 1 HP
  while the row stays at 0. The fight card's own "Revive" is `adjust { hp: 1 }` and is the path in a fight. A dead
  hunter has no turn, so the next `vitals` comes only when that row changes.
- A death save on a player's phone writes `life` only (no HP), as the fight's `vitals` reads it (`writeBack`); not a bug.

Tests: `tests/e2e/combat-turns.e2e.ts` "a GM's −5 on a fighting hunter's own sheet takes 5 from the fight's card, and
the HP stays after the next turn"; `tests/e2e/table-turn.e2e.ts` "a GM's −5 on a fighting player's card on the party
board takes 5 from the fight's row, and the player's sheet shows it after the next turn" and "a player's −5 on their own
sheet during the GM's fight is turned down with a word, and their HP stays the fight's".
They fail with the fix taken out (`hunter.js` and `gm.js` at f4bc302): `Expected: 46 Received: 51`, `Expected: 40
Received: 45`, and the refusal toast not found; they pass with it.

## Step 2: the owed browser tests (`tests/e2e/combat-turns.e2e.ts`)

- "a goblin burning at strength C loses more HP over its turn than one burning at strength E": Burning put on from the
  Status window at strength C on the goblin whose turn it is, at E on the other at its turn; at each one's next turn its
  HP has fallen by `round(rate * elapsed / RULES.fight.round)` (design 1.3, `dueAmount`), the rate 3d8 at C and 1d6 at E
  on the lowest faces (3 and 1; on the top faces, 24, a goblin of 27 HP fell before its turn and never settled).
- "a caster rat's Curse tapped on its card hurts Brakk by what the damage rule gives": `1d8 + mag` on 1s, the reaction
  d20 of 1 caught and a crit (rules 8b, 9), times the crit size, then rule 12 with Brakk's Resist and the rat's
  penetration, all read from the rows' sheets and `RULES.fight`.
- "the loot of a monster defeated in a fight opens in the Award form when the GM taps Award loot": a bestiary monster with
  75 gold and two potions, added from its Bestiary card, marked defeated, End lists "Loot: 75 gold, Health Potion ×2",
  End without XP, "Award loot…" fills `#gm-gold` with 75 and lists the potion.

## Step 3: every browser file, one at a time (port 3241)

First pass (`--workers=1`, one file at a time; the first files ran while step 1 was being written):
custom-skills 7, customization 8, gates-quests-dailies 21, layout 5, look 9, makers 21, pwa 3, reward-room 1, rewards 5,
room-onboarding 6, room-sync-fixes 14, room-sync 1, room-view 9, save 7, sharing 6, upgrade 3, character 20, used 6
passed; combat-turns 3 failed 11 passed; table-turn 7 passed; table-session 1 failed 6 passed.

Failures, cause and fix:
- combat-turns, my Burning test: at top faces the C goblin fell before its next turn (fixed: lowest faces). My loot
  test: Award XP opens the party's reward window before the loot one (fixed: End without XP).
- combat-turns 50 (Toward, W5's): `locator.tap` timed out on a disabled Toward: the test checked `isDisabled()` on the
  card drawn before the save changed, then tapped the redrawn one. Passed on the rerun; fixed anyway, as a race in the
  test: after a step it waits for the card's foe distance to change (or the turn to move on).
- table-session 66 (W6b's), twice, also with `E2E_POPUP_DELAY=100`: "Your turn. Round 2." never came. Instrumented: the
  hunter is Slowed (speed 80, 1.25 rounds between turns), so with some openings its turn after round 1 falls in round 3;
  the loop `startsWith('Round 2')` then ran on to round 20 and the toast said "Round 20.". The test was wrong: it now
  waits for the hunter's first turn in round 2 or later and expects that round's toast.
- Found on the way, an app bug: the GM's bar named the first row of `ahead`, not the row whose turn it is. A row that
  joins at the time of the turn under way with a higher tie, or the current row after a move, took the bar's "Turn:"
  while `currentId` (what the players' doc and every command read) was another (122 of 11,319 running states of the
  fight model's play). Fix: `order` (fight-view.ts) puts the current row first at `now`, then the rest ahead with the
  current turn taken as a standard action. Unit test in `tests/fight-view.test.ts` (fails on the old `order`:
  `Expected: "A" Received: "J"`).

`E2E_POPUP_DELAY=100`: combat-turns 14, table-turn 7, used 6 passed; table-session as above, then 7 passed twice.

`bun scripts/ui-shots.ts` (server on 3261, stopped after): first run exit 1, "move control and target picker" at 1280
and 390, a tap on a Toward the card had just turned off while the monster stepped in. The step now shoots the picker from
the default lines (a monster's Shot reaches 12 tiles, a Curse 8, the lines are 8 apart) and declares its two shots.
Then `119 shots`, exit 0, the fight steps (`[data-start]`, `[data-ahead]`, the move control, the target picker "Use
Curse on… Mira Test · 8 tiles", the end and loot windows) and the maker steps on the new screens. Images not committed.

## Step 4: docs

- `AGENTS.md`: the layout names `edge/roll.ts`; "Where things live" loses the old fight's rows (`encounter.ts`,
  `use.ts`, `status.ts`) and gains stats, derive, sheet, formula, fight, timeline, space, resolve, effect ops, an
  ability, rows, the fight view, the fight doc, the dice and the simulation, each with its test; the vitals row says
  where a hand edit in a fight goes. Recipes: new an ability, a shape, a terrain, a status op, a derived number;
  rewritten a combat command, a room message (`step`, `cast`, `vitals`), a field of a saved thing, a status, an item,
  a skill, a monster, a maker, a rule number. "Saves and roles" at schema 4 with no carry-over; "Machines and their
  charts" names the fight and channel charts; the lint paragraph names the fight's rules. Every backticked path and
  name was grepped (a script over `AGENTS.md`: none missing).
- `rw/design.md` 7.4: what was built against the 15 planned units.
- `copy-tasks.md`: P1's ability names and W9's words appended; one repeated line of W6b made a pointer to W6's.

## Choices

- A player's hand edit in the GM's fight is refused, not sent: no room message carries one, and adding one (a player
  changing a row the GM holds) is a protocol change beyond this unit. The GM board and the GM's own sheet reach the row.
- `combat.adjust` refuses "no change" with its toast (a +1 at full HP on the sheet in a fight now says so).

## Checks (last lines)

- `bun run typecheck`: `$ tsc --noEmit && tsc -p tsconfig.views.json --noEmit` (no error).
- `bun run test`: `Ran 2174 tests across 53 files.` 2174 pass, 0 fail (2173 at f4bc302; +1 in fight-view.test.ts).
- `bun run deps -- --write`: `wrote docs/dependency-map.md`. `bun run charts`: `wrote .../docs/state-machines.md` (no change).
- `bun run build`: `Built 12 files into dist/ (build 9f009e4731fc)` (before the last test-only commits).
- Browser tests: 174 at f4bc302 (172 `test(` calls), 180 now (178 calls; the Status window case runs at 3 sizes).
- First full run (`--workers=2`): `1 failed`, `179 passed (12.6m)`: gates-quests-dailies 151 "a gate cleared after End
  encounter without XP still pays the gate XP" (`System window button "Mark gate cleared"` never came). Alone it passed.
  Cause, a race in the test's `sys` helper: while it waits for "End without XP" it taps any primary button, and the End
  window opening between its two looks had its primary "Award XP to party" tapped. Fixed in `sys` and the same helper
  `chooseInWindow` of combat-turns: they tap past only a window without the wanted button. With
  `E2E_POPUP_DELAY=100` combat-turns then failed on my Burning test (`strict mode violation`: a gate of Goblin and
  Goblin Shaman); rows are found by id now, and two runs passed 14 of 14.
- Final full run, after those fixes (`E2E_CHROMIUM=/opt/pw-browsers/chromium E2E_PORT=3241 bunx playwright test
  --workers=2 --trace off --output=/tmp/pw-all`): `180 passed (12.4m)`, 0 failed.

## Red after this unit

Nothing I know of. Not run: `bun run ci` (the lead's push runs it). No pause of the box was seen in any run.

## Which principle changed a choice

- fix-root-causes: the hand edit is routed where every edit passes (`app.api.hunter`), not guarded where it showed; the
  bar's wrong name was fixed in `order`, the one place the GM's bar reads, not in the test that met it.
- test-behavior-not-implementation: Burning's loss from `dueAmount`'s rule and statuses.ts's dice, the Curse's damage
  from rules 8b to 12 with the rows' sheet numbers, the loot from the monster's own entry.
