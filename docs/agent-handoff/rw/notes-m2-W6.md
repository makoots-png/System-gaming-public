# W6, the players' table: notes

Main tree, branch `claude/zen-pasteur-ov4cgd`, from 4e98b11. Not pushed.

## Files outside my list (smallest change each, with the reason)

- `src/core/registry/abilities.ts`: `itemAbility(item, R)`, `itemAbilityId`, `itemOfAbility`. A fight's `act` (and so a
  player's `cast`) names an ability on the row; a thrown item had none, so `combat.useItem` could only answer false.
- `src/core/combat/rows.ts`: `hunterAbilities` adds an ability for each consumable in the bag that goes to another
  (`target: 'other'`, qty above 0), after the skills. The GM's row of a remote hunter gets them from the pushed sheet.
- `src/core/combat/resolve.ts`: `diceFor` is exported, so a player's phone rolls exactly the dice a target of the
  ability needs (the `cast` message carries one list for every target).
- `src/core/combat/fight-doc.ts` and `src/core/protocol.ts`: a hunter's or shadow's doc row carries `stride` (0 to 64,
  clamped), the stride of its fight sheet (a slow or a root included). P3 asked for it; the lead's note said W6 needs it.
  Only hunter and shadow rows carry it, so the worst-case doc (monster rows) and `DOC_MAX` are unchanged.
- `src/core/combat/fight-view.ts`: `docSpots(rows)`, the room doc's rows as `Spot`s (a `Place` is branded, so a doc row
  was not a spot as it is, which P3 assumed). One test in `fight-view.test.ts`: aims over the doc equal aims over the fight.
- `src/core/api.ts`: `UsesApi.onTable` and `UsesApi.cast`; `SkillsApi.use`, `pay`, `outcomes`, `resetCooldowns`,
  `PaidSkill` and `EffectsApi.roll` deleted (no caller left; `tests/deps.test.ts`), and the `use.ts` import.
- `src/views/hunter.js` (1 line): the call of `skills.resetCooldowns` on a rest is gone with the cooldowns.
- `src/views/effects.js`: `roll` deleted (its callers were the old skill and item rollers).
- `src/views/combat.js`: the card lists a thrown item with its count while this phone's hunter carries one (a remote
  row's items are the player's to throw); a use of it takes one from the bag once the fight took it; `useItem(hid,
  itemId)` uses that ability of the hunter's row; the extraction button builds an `ExtractTarget` (line 640's error).
- Tests: `abilities.test.ts` (2), `rows.test.ts` (1), `fight-doc.test.ts` (1), `protocol.test.ts` (1 and the fixture).

## Choices (read first)

1. **A thrown item is an ability** (`itemAbility`): nothing avoids it (`sure`), no fatigue, mana or cooldown (the bag
   counts it), its first damage op is its effect on a foe with a curse's reach, else its first heal op on an ally with a
   support's reach, each at the item's rarity tier; its status, cure and note ops ride along. Mana and fatigue ops are
   dropped (they are the user's own). Its id is `item-<item id>`, cut to 40 for `cast`. A status it puts on is sourced
   from the user's row at the row's tier (the fight's rule for an ability), not the item's rarity.
2. **A player's use goes through `app.api.uses.cast(hid, abilityId)`** (uses.js): the HUD, the Skills panel and the bag
   all call it. It reads the room's fight doc, refuses with a toast when it is not the hunter's turn, lists the targets
   `aims` gives in range and in shape (nearest first, the same window and words as the GM's picker), rolls `diceFor(a)`
   with `rollDice` and sends `cast` with the doc's `now`. A thrown item from the HUD goes through `inventory.use`, so the
   bag loses one only when the room took the cast (plan risk 4: an item lost to a cast the GM's phone refuses stays lost).
3. **The HUD** (table.js) reads `rows`, `now` and `currentId`; the round is `roundOf(now)`. Under "Abilities" it lists
   `hunterAbilities(h)` (the GM's row was built by the same function from the pushed sheet, so the ids match), each Use
   off while it is not the hunter's turn. "Toward <foe>" and "Away" step from the nearest foe (aims of the first foe
   ability, as the GM's Move control) by `stepToward`/`stepAway` with the doc row's `stride`, sent as `step`. On a desktop
   the actions sit in the kit; the kit's skill list is gone (the abilities replace it) and its consumables are the
   ones for the user only. Bars are drawn with CSS `calc` (no arithmetic on HP in the view). The HUD's "MP" is "Mana".
4. **The Skills panel's Use**: a `cast` on a player's phone in the GM's fight; in this phone's own fight a toast says to
   use it from the hunter's card; outside a fight it is free (costs are the fight's), an ability on the user puts its
   ops on the hunter, one on another is told to the GM (`used`). Cooldowns, MP costs and dice rolls are gone with
   `cdLeft`, `mpCost` and `dice`; the card has no CD mark.
5. **Not done, for the lead**: no phone tells a player that the GM's phone refused a cast or step (cooldown, mana,
   range); the doc carries no `readyAt`, so a player's ability on cooldown shows a live Use button. A potion used on
   oneself in a fight changes the sheet, and the fight's next `vitals` writes the row's HP back over it (there is no
   command for a player's own item). An item bought after the hunter joined the fight is not on its row (the abilities
   are read at the join), so its cast is refused.

## Which principle changed a choice

- boundary-discipline: the doc row's `stride` is read once by the doc reader with its bound; the phone trusts it.
- minimize-reader-load: one path for a player's use (`uses.cast`), whichever panel the tap came from; one list of a
  hunter's abilities (`hunterAbilities`) on both phones, so the ids the player sends are the ones the GM's row holds.
- subtract-before-you-add: cooldowns, `pay`, `outcomes`, `resetCooldowns`, the rollers, `effects.roll` and the `use.ts`
  imports of skills.js, inventory.js and uses.js went in the commit that replaced them.
- test-behavior-not-implementation: the step's tile (1, 5) and the stride 3 are worked from `moveBase`, `strideShare`
  and the tie rule, not read from a run (my first guess, (2, 5), was wrong by the tie rule; the code was right).

## Tests

- New `tests/e2e/table-turn.e2e.ts`: "a player's Strike sent on their turn changes the goblin's band on both phones, and
  the same tap after the turn moved on changes nothing" (the replay is the same `cast` payload sent again; a roll sent
  after it shows in the GM's feed, so the GM's phone has read the replay when the HP is checked), "a player's step on
  their turn moves their token on the GM's order".
- `used.e2e.ts`: the bomb test is the Frost Bomb thrown by a player on their turn: Frostbite on the GM's rat, on the
  player's table, one bomb gone.
- `custom-skills.e2e.ts`: all 7 on the fight's rows (an ability put on a row in setup stands for a made skill).
- `table-session.e2e.ts`: the Table feed Apply test on the new quick line.

## Checks (last lines)

- `bunx tsc --noEmit --pretty false 2>&1 | cut -d'(' -f1 | sort | uniq -c`: `2 tests/encounter.test.ts`, `8 tests/status-sim.test.ts` (W8), nothing in `src`.
- `bunx tsc -p tsconfig.views.json --noEmit --pretty false`: no error.
- `bun test 2>&1 | grep -E '^\(fail\)' | wc -l`: 5, all `status.test.ts` (W8). `Ran 2242 tests across 59 files.`, 2235 pass, 7 fail (the 5 and the two files that do not load, `encounter.test.ts` and `status-sim.test.ts`, W8).
- `bun test tests/deps.test.ts tests/statecharts.test.ts tests/lint.test.ts tests/abilities.test.ts tests/rows.test.ts tests/fight-view.test.ts tests/fight-doc.test.ts tests/protocol.test.ts`: `Ran 291 tests across 8 files.`, 0 fail.
- `bun run build`: `Built 12 files into dist/ (build d39e1dabd709)`. `bun run deps -- --write` run and committed.
- Browser, port 3241: `table-turn.e2e.ts` + `used.e2e.ts` `8 passed (2.1m)`; `custom-skills.e2e.ts` 7 passed;
  `makers.e2e.ts` `21 passed (1.8m)`; `sharing.e2e.ts` `6 passed (45.2s)`; `reward-room.e2e.ts` `1 passed (37.2s)`.

## Red after this unit (browser), for W9

- `combat-turns.e2e.ts:173` "in a short window used with a mouse, the Workshop's New status opens at its top": `> 181 | await page.locator('#view-workshop [data-ws="status"] [data-new]').click();` times out (twice). The Workshop's (W7). Its first test (48) failed once while `bun test` ran beside it and passed on the rerun.
- `character.e2e.ts:249` "GM Reset rules restores ...": `> 267 | await p.locator('[aria-modal="true"] [data-q="ck-"]').first().tap();` (an old quick chip of the Status window, gone with W7's forge).
- `character.e2e.ts:138`, `566`, `590` (W6's, not rewritten, out of time): `> 62 | await p.locator('#view-combat [data-roll]').tap();`, `> 613 | await gm.locator('#view-combat [data-roll]').tap();` and `TypeError: Cannot read properties of undefined (reading 'combatants')` (the old `encounter`). They need `[data-start]` and `fight.rows`.
- `table-session.e2e.ts` 71, 202, 257, 307, 318, 328 (W6's, not rewritten, out of time): the old quick line (`Cave Rat, HP 20, AC 10 ...`) and the old Status window chips; errors `> 97 | await expect(gmRow(gm, MONSTER)).toHaveCount(2);`, `> 253 | ...toHaveText(new RegExp(`^${startHp - 4} / \\d+$`))`, `> 271 | await expect(gmRow(gm, MONSTER)).toHaveCount(1);`, and `> 18 | target.evaluate(scrollIntoView)` (the `[data-cforge]` step after the old quick line). 307's expected "−2 to checks" is Poisoned's old words (now Accuracy −8 at E).
- Not run by me: `room-*`, `layout`, `look`, `gates-quests-dailies`, `customization`, `rewards`, `save`, `pwa`, `upgrade`.

Lines: `git diff 4e98b11 --shortstat -- src tests`: 23 files changed, 518 insertions, 232 deletions (tests are most of the additions; skills.js lost its pay, use and outcomes block, table.js its skill kit, inventory.js its outcomes).
