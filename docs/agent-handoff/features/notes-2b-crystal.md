UNIT 2b-crystal DONE at 645f03a (code, tests, charts, docs; this commit adds the notes' close)

# Notes: the Resurrection Crystal, and findings 1, 3 and 4 of the look at solo runs

Status: step 1 (cfa5669), step 2 (9d6d614, core and tests), step 3 (adf0d8d, screens and browser tests) and the close's docs (645f03a) committed. The browser loop of the close is below.

## Step 3 as built

- The bag (`inventory.js`): an item that revives goes to `useOnSelf` whatever its target, and is refused with `USE_WORDS.fight` while `fightOf` answers (this phone's fight or the GM's); a refused use toasts `USE_WORDS` (the old "nothing to restore." moved there). No Sell button for an item `sellable` refuses.
- The sheet (`hunter.js`): the death panel has a line `[data-wayback]`, shown only when dead, "The GM's Revive or a Resurrection Crystal brings you back."; the death save's toast on the third failure reads the same.
- The item maker (`loot.js`): a box "Brings its dead user back at 1 HP, outside a fight." (`REVIVE_TEXT`), a GM's only, shown for a consumable; a player's edit keeps the mark unseen. The GM's Edit of the shop's crystal keeps it a crystal (tested), and a GM can make another reviving item.
- The Rules page (`rulesref.js`): the Gates section draws `soloLines` (it never did), and the 0 HP line is `downLine`'s.
- Browser tests: `tests/e2e/crystal.e2e.ts` (new, five: a dead hunter alone uses one and stands at 1 HP, the crystal gone, the use logged, the way back on the sheet, no Sell; a living hunter refused and keeps it; the shop at 100,000 g and a buy; a GM's award of a title and a crystal to a player in a room; the GM's shop edit and a made reviving item), `solo.e2e.ts` (the card's odds in one hunter's voice, its hint and detail without "party", "No world gates." under a personal gate, the died words), `look.e2e.ts` (a dead hunter's sheet at 360 px: Dead and the way back on the first screen, inside the width, 14 px), `character.e2e.ts` (the Rules page shows `downLine` and the three solo lines).
- The first run of crystal.e2e failed one case, "the shop ... buys one": the test's setup pushed a stack of 0 crystals for a hunter meant to hold none, and the bag read it as 1 (a held count is at least 1), so the buy made 2. The setup now pushes nothing for 0; 5 of 5 then.
- Not browser-tested: the refusal in a fight (a rule of three lines in `inventory.use`, its words pinned in `tests/use.test.ts`).

## Close

- `bun run deps -- --write`: "wrote docs/dependency-map.md". `bun run charts`: "wrote .../docs/state-machines.md" (the life chart's revive arrow and note name the crystal; the personal gates' note names the even gate).
- `bun run typecheck`: passes. `bun run test`: "Ran 3701 tests across 98 files." 3698 pass, 3 skip (the Postgres-only cases), 0 fail.
- The lead's CI ran on the box twice during this unit (pids 2760 and 6116); every browser run here waited for it to end.
- Every browser file but feel, one at a time on `E2E_PORT=3260` with `E2E_CHROMIUM=/opt/google/chrome/chrome`: all 33 files passed, none failed or flaky (crystal 5, solo 7, look 25, character 26, makers 35, reward-room 3, the rest as before). feel.e2e.ts not run (the brief leaves it out).

- Caveat found after the loop: from about 15:35 another writer's uncommitted changes appeared in this tree (40 files, among them save.ts, grant.ts, gm.js, lint.test.ts, and new chronicle.ts, facts.ts, noticed.ts, bundles.ts). The files the loop ran after then (about reward-room.e2e.ts onward) were built from a tree that held them. My commits name only my own paths, and none of those changes is mine. Rerun the browser files on my commits alone if that matters.

Left: nothing of the brief. Not done by choice: a gate field that drops a crystal on its Clear (for-the-owner.md); a browser case for the crystal refused in a fight.

## Step 2 as built (what moved from the plan, each with its cause)

- `useItem` asks the life table itself: the revive goes through `sheetEdit`, and its refusal (`cannot`, the table takes `revive` only from dead) is the `not-dead` refusal, so the rule "only the dead" is the life machine's, not a second check of `life.at`.
- `itemOf` leaves out an empty `effects` (the crystal has none): `parseItem` drops an empty list, and the content test "reads back unchanged through parseItem" caught the difference.
- The refusal type is `ItemUseRefusal`: `resolve.ts` already exports a `UseRefusal` (the lint "a type name is exported by one module").
- The loot roll (`inventory.rollLoot`, used by a gate's Clear, a solo run's loot and the GM's roll table) draws from `lootPool`.
- `soloLines` gained a third line (the even gate) rather than a longer second, so the second line's pin stays as it was.
- The first whole `bun run test` ran while the lead's CI was running (its pid showed after the run started); its 2 failures were the type name lint and the stale dependency map, both mine, fixed before the commit.

## 0. The goal, the problem, the smallest change

the owner: "So GM determines resurrection. There should be a resurrection crystal but they should be incredibly expensive to buy. Or I can give them out attached to a title or a quest or a dungeon."

The problem: a hunter who dies alone (a solo run can kill) comes back only by the GM's Revive, and a player with no GM has no way back that the screen names. The smallest change: one built-in consumable, the Resurrection Crystal, whose use brings its dead holder back through the life machine's own `revive` event, sold in the default shop at a price with its reason, givable in any reward as any item is, never dropped by a random loot roll. Beside it, three small findings of the look: the first personal gate is the even one, a solo card's odds speak to one hunter, and the world list's empty line does not contradict a personal gate above it.

## 1. What a dead hunter may do today (read before code)

- The bag has no rule about life. A dead hunter may buy, sell, equip, unequip, edit and drop items. Use runs `useItem` (use.ts): a heal op on a dead hunter is refused by the life table (`sheetEdit` answers `cannot`, `opOn` answers null), so a Health Potion is refused `nothing` and kept; a Mana Potion or a Stamina Tonic still changes mana or fatigue and is spent. Nothing here is changed by this unit except the crystal's own rule.
- The ways out of Dead today: the life table's `revive` (dead to up at `REVIVE_HP`, 1), raised only by the GM: the sheet's Revive button (`app.isGM()`), the GM board's Revive (a player's hunter gets the room's `revive` message), and the GM's fight card (Revive on a down row).
- `fightHold` (fight-save.ts) answers `row` for any row whose holder is the hunter while the fight is not ended, whatever the hunter's life: a dead hunter's row stays in the fight at 0 HP until it ends. On a player's phone it answers `gm` while the room's fight doc holds the hunter's row. So while a fight holds a dead hunter, its life is still the sheet's (the row has none), and a revive there is `lifeInFight` (the GM's, which raises the row too).
- In a fight an item is used as its ability (`itemAbility`): an item with no effects has none (it answers null), so a crystal with no ops is never on a fight card, the hotbar or a `cast`.

## 2. The item's shape (three variants weighed)

1. **A status op `revive`** that `useItem` carries out. A member of `Op` reaches every reader of an op: `modsOf`, `opLine`, `parseOp`, `OP_KIND_SET` (so the status maker offers it on every status, and the round-trip test asks for its row), `landOps` or `payDue`, `abilityWorth`. A revive in a fight, on a status, on a zone or in an ability has no meaning (a dead row is out of the fight until it ends), so most of those cells would be refusals. It adds a second path to the life machine's `revive` inside the fight's op code.
2. **A field of the item, `revive?: true`**, read by `useItem` (use.ts): the use is refused unless the holder is dead (`not-dead`), then the life machine's `revive` through `sheetEdit` (`{ type: 'life', event: { type: 'revive' } }`), the one writer of a hunter's life, then any ops the item has, then one spent (`spendItem`), in one answer. The parser keeps it only on a consumable (the only type the bag uses). The fight never sees it.
3. **A known name** ("Resurrection Crystal" read by name). Refused by AGENTS.md: a fact a view would guess from words is a field set where the thing is made.

Picked 2. It keeps one writer of a hunter's life (`lifeAfter`'s `revive`, through `sheetEdit`, the same call the room's `revive` applier makes), touches no fight code, and a GM can make another crystal-like item (a "Phoenix Feather") with the same box. It is a field like `tell` and `target`: in `Item`, `ItemDef`'s consumable arm, `itemOf`, `parseItem`, `stackKey` (two items that differ only in it are not one stack), and the item maker (a box only a GM sees, kept unseen on a player's edit, as `tell` is, so a player's Edit of a held item cannot make one; it matters also because the GM's Edit of the shop's crystal goes through the maker, and without the box the edit would drop the field).

The use, in order: holder dead, else refused `not-dead` (nothing spent); `revive` through `sheetEdit`; the item's ops (none for the built-in one); one spent. The line is "Back at 1 HP" (`REVIVE_HP`). The use is told as any use is (`uses.told`): the built-in crystal has `tell: true`, so a player's phone in a room posts the room's `used` and a phone alone or the GM's logs it (protocol.ts `useRoute`); a GM who makes another may untick it.

In a fight: refused with words while `fightOf` answers anything (this phone's fight or the GM's), before any write: "Use the Resurrection Crystal after the fight." The crystal has no ops, so it never reaches the fight's ability path. After the fight ends `fightOf` answers null and the crystal works. The GM's Revive stays the way back inside a fight.

## 3. The price (the arithmetic)

What a hunter earns, from the rules as shipped:

- A loot roll (`rollLoot`) pays gold uniform in the rank's span: mean E 100, D 325, C 1,250, B 5,000, A 19,000, S 75,000 (`RULES.loot`), and one item by rarity weight whose sale is about a tenth of the gold (C: a mean rarity multiplier of 3.1, so 310 to buy, 155 to sell), left out below.
- A personal gate is the income a player controls: at most 3 a day (`hours` 8), a rank one below, at, or one above the hunter's by 25, 60, 15 (the share past E or S is the hunter's own; an S or A hunter's S gate is an A gate, `pooled`, since the seeds have no normal S monster). The measured clear share is about half: the E pregens clear 1 goblin in 95 to 99% and 2 in 0 to 16%, and the pack is 1 or 2 evenly; the C builds' mean over 1 and 2 orcs is 53% (notes-2-solo.md section 16, 100 plays a row, a standard error of at most 5 points).
- So a hunter who plays every personal gate a day takes in about 3 × 0.5 × the mean gold of its gate mix: E 0.85 × 100 + 0.15 × 325 = 134, so 200 a day; D 25 + 195 + 188 = 408, so 610; C 81 + 750 + 750 = 1,581, so 2,370; B 313 + 3,000 + 2,850 = 6,163, so 9,240; A 1,250 + 14,250 = 15,500, so 23,250; S 19,000, so 28,500.
- A GM's world gate adds a Clear's roll split over the party (a boss's roll at most doubles the item part): at C about 1,250 / 4 = 310 a hunter a session, small beside the personal gates.
- The shop's dearest item today is the Ring of Vitality at 20,000; a mythic item priced by the rule is 20,000 (10 × 200 × 10).

Where hunters die: everywhere a solo run is hard, but most at E to C: the E pregens die in about 40% of the hard gates, and the C tank cannot clear one same-rank orc alone. A crystal matters most there.

The price: **100,000 gold**, five times the dearest thing in the shop. At C it is 42 days of clearing every personal gate (six weekly sessions of play between); at D 164 days; at E 500 days, so at E it comes from the GM or not at all; at B 11 days, at A and S 3 to 4. "Incredibly expensive" holds where hunters die and stays dear after; at A and S gold is everywhere (one S world gate drops 30,000 to 120,000). It is the item's own `value`, so the GM's shop list (the item maker's Value) and the rules' prices never move it by accident: a GM who wants it cheaper edits it. What would change it: a measured clear share far from a half, or `RULES.loot`'s gold moved.

**Selling one back.** Half of 100,000 is 50,000 gold: a GM who hands one out as a quest's reward at D would hand the party more gold than 80 days of personal gates, and the hunter can turn a GM's decision about a life into gear. That is a problem: the GM decides how many crystals exist, and a sale turns each into gold the GM never gave. So a crystal is not bought back: `sellable` in inventory.ts answers false for an item that revives, `sell` refuses it (`unsellable`), `sellPrice` is 0, and the bag shows no Sell for it. The rule is the field's, not the name's, so a GM's own reviving item is not sold back either. It can still be dropped (the bag's remove).

**Not in a loot roll.** The built-in items are the pool a gate's Clear, a personal gate's run and the GM's roll table draw from (`builtInItems`, the shop's stock and `LOOT_ITEMS`). A mythic crystal there would drop at random from A and S gates, personal ones included, with no GM's hand. The owner's ruling is that the GM decides resurrection, so the pool a roll draws from is `lootPool` (items.ts): the built-in items without a reviving one. The reward editor's Built-in list still offers it (`builtInItems`).

## 4. Giving one (step 3's questions)

- A reward's items are read by `parseItem` (`parseRewards`), so a quest's reward, an award, a bundle and a gate's Clear carry the crystal with its field and need no new code. Tests in `tests/rewards.test.ts` read each through its own step (`grant` for an award and a bundle, `finishQuest` for a quest, `settleClear` for a gate's Clear) and then revive the hunter with the item it was given.
- The reward editor offers it under Built-in (`itemTemplates` = `builtInItems`), and under Shop while the GM's shop is the default.
- "Attached to a title": a reward with a title and the crystal, a browser step (the GM's Award form, a player's phone).
- "A dungeon": a gate's Clear rolls its loot from the pool by rarity, so the GM cannot put a crystal in a Clear's roll, by the rule above. The GM can today: (1) after a fight in the gate, "Award loot…" fills the Award form, where the crystal is under Built-in; (2) a GM's monster's loot lists the library's items, so a crystal saved to the library (the item maker with the new box, ticked) drops from that monster when a fight it lost ends. No new design needed. A line for for-the-owner.md: if he wants "this gate's Clear drops a crystal" as a field of the gate, that is a gate field and a design.

## 5. The words (one name: Resurrection Crystal)

- `WAYS_BACK` in vitals.ts: "The GM's Revive or a Resurrection Crystal". Read by: the solo refusal "This hunter is dead. The GM's Revive or a Resurrection Crystal brings it back."; the run's window "You died. The GM's Revive or a Resurrection Crystal brings you back."; the sheet's death panel under Dead (a line shown only when dead); the death save toast ("3 failures: you are dead. The GM's Revive or a Resurrection Crystal brings you back.", was "Only the GM can revive you."); the Dead chip's text (statuses.ts, "Only the GM can revive."); the Rules page's 0 HP line (`downLine`: "Healing and rest do not raise the dead: the GM's Revive or a Resurrection Crystal from the bag does, at 1 HP.").
- The item: "Resurrection Crystal", mythic, its text "A dead hunter who uses it stands again." Its detail line (`describeItem`): "Brings its dead user back at 1 HP, outside a fight."
- Refusals (use.ts `USE_WORDS`): not dead "The Resurrection Crystal brings back only a dead hunter. It was not used."; in a fight "Use the Resurrection Crystal after the fight."; the old "nothing to restore." moves there too.
- Selling: no Sell button; a sale refused in core is `unsellable`.

## 6. Findings 1, 3 and 4

1. **The even gate.** In `soloTick`, the gate opened by the tick that turns the clock from off to on (a new hunter, one revived, the switch turned on) is rolled at the hunter's own rank (`pooled`) with a pack of exactly 1; every later spawn is rolled by `ranks` and `pack` as now. The rule lives where the clock turns on, so nothing new is stored. Rules page: `soloLines` gains "The first gate after personal gates start for a hunter holds one monster of its own rank." Found on the way: the Rules page never showed `soloLines` (rulesref.js does not call it); the Gates section draws them now.
2. **The solo card's odds** (finding 3). Weighed: (a) the box takes its sentences as an argument (a line function and a detail function), which puts a choice of words in the view and gives the detail panel (detail.ts, the `odds` Thing) a function it cannot store; (b) a voice in core, `OddsVoice = 'party' | 'alone'`, passed to `oddsLine`, `oddsDetail` and the hint, carried by the `odds` Thing, and given to `odds.paint` by its caller (combat.js `party`, gates.js `alone`). Picked (b): the words stay in core, each voice a row the compiler fills, and the numbers come from the one read (`readOdds`). The confirm's first and third lines (`soloConfirmLines`) read the same helpers, so "You clear it in 0% of 100 plays" is written once.
3. **"No gates detected. The world is quiet."** under a personal gate (finding 4): when the solo section shows above the world list (personal gates on, or a gate open to solo runs), the world list's empty line reads "No world gates." (a player) or "No world gates. Spawn one above." (the GM); without it, the old lines. One function in core (`worldEmptyWords`, world.ts).

## 7. Principles read, and the choice each changed

- `principle-model-the-domain`: the crystal is a field of the item that its one use reads, not a fight op with null cells everywhere; the odds' audience is a union (`OddsVoice`) with a row each, not a second set of sentence functions.
- `principle-type-system-discipline`: `revive?: true` on the consumable arm of `ItemDef` only; the refusals are a union with a words table.
- `principle-boundary-discipline`: `parseItem` is the one place the field is read from outside data (a reward, a room message, a form), and keeps it only on a consumable.
- `principle-explain-the-number`: the price in section 3 with its limiter (the clear share and the loot gold) and what would move it.
- `principle-laziness-protocol`: the unsellable rule and the loot pool read the same field, no second flag.
- `principle-test-behavior-not-implementation`: each test drives the step a player's tap runs (`useItem`, `grant`, `finishQuest`, `settleClear`, `soloTick`) and reads the hunter, the bag or the words.

## 8. Decision trail

| # | Decision | Why |
|---|---|---|
| 1 | A field `revive`, not an op | one writer of life; no fight cells |
| 2 | 100,000 gold | section 3 |
| 3 | Not sold back | a GM's gift of a life is not gold |
| 4 | Not in a random loot roll | the owner: the GM determines resurrection |
| 5 | Refused in a fight, not hidden | the player reads why |
| 6 | The first gate is the even one at every off-to-on | the brief's words; a revived hunter meets the same risk as a new one |
| 7 | A voice for the odds | words stay in core, one read |
