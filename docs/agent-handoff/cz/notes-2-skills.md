# Notes: unit 2, skills that act, the `use` command, enemies with skills

Principles read: model the domain, type-system discipline, make operations idempotent, test behaviour, explain the number, unslop. Type-system discipline decided where the target list lives (one `TARGETS` union in `status.ts`, which skills and items share) and that a skill's statuses are named by a `StatusKey`, so a misspelt key fails the typecheck.

## Step 1: parseSkill and the skills table

- `src/core/registry/skills.ts`: `SKILL_TYPES` (moved from save.ts, which re-exports it, as with the item enums), `SkillDef` (active or passive), `SKILL_SEEDS` (the eight seeds from `skills.js`), `skillOf(def)` and `parseSkill(v): SkillTemplate | null`.
- `parseSkill` follows `parseItem`: a non-object or a skill with no name is refused, any other wrong field takes its default. Bounds in `SKILL_BOUNDS`: name 60 (trimmed), label 12 (blank is null), desc 500, level 1 to 10, mpCost 0 to 999 and cooldown 0 to 99 (the form's), cdLeft 0 to the cooldown, grade a rank (E), dice without spaces when `validDice` passes else empty, the bonus's nine keys (`PERK_KEYS`) as whole numbers inside 999 with 0 dropped, effects through `sanitizeOps`, `target` self or other (self), `attack` true only when `true`, `perk` kept when text (40). Every other key is dropped.
- `Skill` gains `effects: Op[]`, `target: Target`, `attack: boolean`; `newSkill` defaults `[]`, `'self'`, `false`. `TARGETS` and `Target` are in `status.ts` (the op vocabulary), for items too in step 6.
- Save: a hunter's skills and `library.skills` (new, at most 200, `LIMITS.librarySkills`) are each read by `parseSkill` and refilled in place with their id, as items are. The perk skill is still rebuilt after the parse (its test passes unchanged).
- The Skills form builds its skill with `parseSkill` (an edit keeps the fields the form does not show: effects, target, attack, grade). Its silent roll check is gone; it shows the same error when `validDice` fails, the check the parser makes. "Add from list" adds `skillOf(seed)`. starter.js builds its pregens' skills with `parseSkill`.
- Seeds that gained effects (no seed's numbers changed):
  - Dagger Rush: `damage 2d4`, target other, attack on. From "Two lightning-fast dagger strikes." (the 2d4 it already rolls).
  - Mutilation: `damage 2d6`, target other, attack on. From "A vicious strike that tears flesh." (the 2d6 it already rolls). "Tears flesh" was not read as Bleeding: the text does not name the status.
  - Stealth: `applyStatus stealth`, rounds null, on itself. From "Vanish from sight. Advantage on Stealth checks until you attack." (the built-in Stealth, "Hidden from view", until taken off).
  - Sprint (movement), Bloodlust (passive bonus), Ruler's Authority (crush with no number), Shadow Exchange and Arise: no effects, since the ops cannot say what they promise.
- Changed expectations in tests/save.test.ts: the fixtures' skills now read back with `effects: []`, `target: 'self'`, `attack: false` (`currentSkills`). Two hostile-input skills got a name (`Dash`), since a nameless skill is now dropped.
- New tests: `tests/skills.test.ts` (every seed reads back unchanged, effects that describe, built-in statuses only; hostile input, every bound); save: the GM's skills (kept, an id each, a nameless one dropped, unknown keys dropped), the 200 cap, a hunter's skill read by the parser.
- Commit 1: step 1.

## Step 2: outcomesOf

- `src/core/combat/use.ts`: the `Outcome` union, `MAX_OUTCOMES` (8), `outcomesOf(ops, tier, target, roll)` and `outcomeText(R, outcome)` (the words of one outcome, shared by the fight's log line and the toast outside a fight).
- Only ops that fire on use count (`when: 'use'`, or no `when` and not a mod). `tiers` are read at the tier through `atTier`, the tier clamped to 0..5. A percent is of the target's max HP (`rollFor`). A full heal (`amount` 99,999 without dice) is the target's max HP, so the log says "+200 HP", not "+99999 HP". A plain number by rank ("20") is that number, without a roll. Dice go to the injected roller.
- Decided by the helper: a fatigue op with a negative amount keeps its sign (the outcome removes fatigue). The brief says every number is at least 0, but the op vocabulary says a negative fatigue amount removes fatigue (the Stamina Tonic is `fatigue: -25`), and 0 would make it do nothing. Every other kind is at least 0.
- Decided by the helper: `outcomesOf` keeps at most 8 outcomes. An item's legacy `heal`, `restoreMp` and `fatigue` add up to three ops to its eight effects, and the fight refuses a use of more than 8.
- Tests: `tests/use.test.ts`, a roller with fixed faces: one case per op, a mod gives nothing, tiers at E and C, a fixed amount by rank, 10% of 200 is 20 and 1% of 30 is 1, the full heal of 200, a roll cut to a whole number of at least 0, the `when` filter, the cap, each outcome's words.
- Commit 2: step 2.

## Step 3: the use command

- `Command` gains `{ type: 'use'; by; on; name; outcomes }` (encounter-types.ts, `Outcome` from use.ts). `reduce` sends it to `use` in encounter.ts.
- Each outcome goes through the function of the single command (`changeHp`, `changeMp`, `changeFatigue`, `addStatus` with `source: sourceOf(by)`, `dropStatus`) on the same draft, so death, a hunter's sheet, another phone and the status stacking rule are theirs. Their log lines are dropped and one line is written: "X uses N on Y: parts." ("X uses N: parts." on oneself), ending "Y is defeated." when the use brought a monster or shadow to 0 HP.
- A local hunter's statuses live on the sheet, which the reducer only reads through `ctx`. Two status steps in one use (a status and a cure) would each start from the sheet as it was, so `use` reads the next step through a ctx that holds the statuses the last step wrote (`withStatuses`). The last `hunterStatuses` effect holds every change.
- Refused (and the fight unchanged): a `by` or `on` the fight does not have, a fight not running, more than 8 outcomes, and any step its single command refuses (a state chip as the status, too many statuses). Decided by the helper: a refused step refuses the whole use rather than skipping that step, so a use applies whole or not at all.
- MP and fatigue on a monster or shadow change nothing and are left out of the line.
- Decided by the helper: the reason a hunter's sheet and another phone see is the use's name ("Dagger Rush").
- Tests in `tests/encounter.test.ts`: damage and defeat, a status with the user's tier replacing a weaker one, a monster's tier, a heal and MP on a hunter, a status and a cure in one use, a remote hunter's effects equal to those of the single commands, MP and fatigue on a monster, each refusal (with the fight unchanged). `use` is in the random play (`tests/models/fight-play.ts`), up to 9 random outcomes. The chart's note lists it; it moves between no phases. Words in `docs/agent-handoff/copy-tasks.md`.
- Commit 3: step 3.

## Step 4: a monster with skills, starting statuses and loot

- `Monster` (save.ts) gains `skills: SkillTemplate[]`, `statuses: StartStatus[]` (`{ key, rounds }`) and `loot: Loot` (`{ gold, items }`); `newMonster` and `statBlock` give `[]`, `[]` and `{ gold: 0, items: [] }`.
- `parseMonster` reads them (bounds in `MONSTER_BOUNDS`): skills through `parseSkill`, at most 12; a starting status whose key passes `STATUS_KEY_RE` (moved from save.ts to status.ts, the library's own check) and is not a hunter's state chip, each key once, rounds whole 1 to 999 or null (a non-number is 1), at most 8; loot gold whole 0 to 1e9, items through `parseItem`, at most 20.
- The fight's monster row (`encounter-types.ts`) carries `skills`, read by `parseSkill` in `parseCombatant` (at most 12).
- `monsterRow(monster, { id, name, group })` in `src/core/registry/monsters.ts` builds the row: the numbers, abilities and skills, and each starting status with the monster's row as its source at its rank's tier. `toCombatant` in bestiary.js reads the monster through `parseMonster` and calls it (the view casts its new id to `CombatantId`; core makes no id but the parser's). The quick-line and custom rows in combat.js have `skills: []`.
- The bestiary editor keeps the skills, starting statuses and loot of the monster it edits (the form does not show them yet).
- Loot is only kept and read. Nothing offers it.
- Tests: `tests/monsters.test.ts` (skills, starting statuses with every bound, loot); `tests/encounter.test.ts` (a C-rank wolf from the bestiary starts the fight with its statuses at tier 2 and its skills; its row reads back from a stored fight). Fixtures that build a monster row gained `skills: []` (encounter, status-sim, save, fight-play).
- Commit 4: step 4.

## Step 5: a hunter's skill in the GM's fight

- `app.api.skills` (types in api.ts): `pay(hid, id)` pays MP, sets the cooldown and rolls `dice`, and answers `{ skill, roll, line }` without a toast (a refusal still toasts why); `outcomes(hid, paid, { hpMax })` is `outcomesOf` at the hunter's rank tier (`rankIdx`) with `app.api.effects.roll`, and the first effect whose dice equal the skill's `dice` takes the roll `pay` made, so a seed like Dagger Rush (dice 2d4, damage 2d4) shows one number, not two; `use(hid, id)` is the outside-a-fight path.
- In the fight (combat.js `useSkill`), a skill without effects is as before (`skills.use` and a note). With effects: `self` pays and sends `use` with `by` and `on` the hunter. `other` first asks for the target (`askTarget`, a list window "Use NAME on…" with everyone up but the user, the card's chosen target first), then pays, so a cancel costs nothing. With `attack` on it rolls a d20 with `hunterToHit` (the numbers `hunterAttack` uses, now shared: the stat's check bonus, the attack mods, disadvantage at 80+ fatigue) against the target's AC and logs the roll; on a miss it logs a note and sends no `use`. On a hit the outcomes are rolled and sent.
- A use applies once: the skill button is disabled in the tap's own handler, before the picker opens, and enabled again when it closes. A second tap lands on a disabled button. No timers.
- Outside a fight (the Skills panel's Use, and the Table kit): a `self` skill's use-ops at the hunter's tier go to `app.api.effects.applyOps` with the hunter as the source, as an item's use does; an `other` skill's toast adds "On the target: ..." with the rolled outcomes, and a percent of max HP in words, for the GM to rule on (TODO(copy) marked).
- Decided by the helper: the picker lists allies too (a heal for a friend is a skill with `target: 'other'`), and the user is never in it.
- Browser: character and combat-turns pass (30 passed) with the change.
- Commit 5: step 5.

## Step 6: an item used on another

- `Item` gains `target?: 'other'`; `parseItem` keeps it only when it is `other`. Decided by the helper: absent means self, as `effects` and `fatigue` are kept only when they say something, so an item that targets its user reads back as before and the save fixtures did not change.
- On the GM's phone, a local hunter's combat card lists, on its turn, its consumables with `target: 'other'` under "Items" (a consumable for the user is still used from the inventory). A tap disables the button, asks for the target with the skills' picker, then `app.api.inventory.consume` (new, api.ts) takes one from the stack and the view sends `use` with `outcomesOf(itemOps(item, 'use'), rarity tier, target)` and the app's roller. All of the item's use effects go to the target: its legacy heal, MP and fatigue as well as its effects.
- `inventory.use` (the inventory's Use button, the Table kit) is unchanged: an item's damage on use is still a line, and what a player's phone sends in a room is untouched. `inventory.use` and `consume` share `takeOne`.
- Unsure: an item with `target: 'other'` used from the inventory's Use button still acts on its user, as every item did. No built-in and no form sets `other` yet; unit 3 (the `used` message) and unit 4 (the item maker) decide that path.
- Test: tests/items.test.ts, `target` kept only as `other`.
- Commit 6: step 6.

## Step 7: a monster's skills on its card

- Each skill of an up monster's row is a button in the card's Abilities list, after its text abilities, with the ability buttons' look (`cmb-ab`). After it, as text only: its MP cost, cooldown and "to hit" when it rolls to hit (the GM keeps a monster's count), then what its effects do (`describe`). The Target select shows when the monster has skills, as it does for abilities.
- A tap (`useMonsterSkill`): a `self` skill acts on the monster. An `other` skill disables its button and asks for the target with the same picker, the card's chosen target first (`pickTarget`, as abilities default). The skill's `dice` are rolled for the table first, and the first effect with the same dice takes that roll (as for a hunter). With `attack` on, a d20 with the monster's attack bonus (`atkBonus`, status mods included, as its Attack button) against the target's AC; a miss logs a note and sends nothing. Then `use` at the monster's rank tier (`rankTier`).
- Commit 7: step 7.

## Step 8: browser tests

- `tests/e2e/custom-skills.e2e.ts`, the GM's phone in the Goblin Den fight, content set up through the store, every use tapped through the UI and its target picked in the "Use NAME on…" window:
  - (a) Brakk's skill (target other, 4 damage, Slowed 2 rounds) on the first goblin: its HP drops by 4, the log line, and its card shows "Slowed · 2r".
  - (b) the goblin's Venom Spit (Poisoned 3 rounds) on Brakk: the log line, and Brakk's card shows "Poisoned · 3r".
  - (c) a monster saved with a starting Hasted, added from the builder: its row and card show Hasted once initiative is rolled.
  - (d) Brakk's Flash Bomb (target other, 5 damage, qty 2) on the goblin: HP drops by 5, the log line, one bomb left.
  - (e) a double tap on the skill (two clicks in one task) opens one window and hurts the goblin once.
- `E2E_CHROMIUM=/opt/pw-browsers/chromium E2E_PORT=3243 bunx playwright test tests/e2e/custom-skills.e2e.ts --workers=1 --trace off --output=/tmp/pw-cz2`: 5 passed, first run.
- Commit 8: step 8.

## Step 9: checks and AGENTS.md

- `bun run test`: 1565 pass, 0 fail. `bun run deps -- --write` and `bun run charts` left their files unchanged at this point (each earlier commit rewrote them).
- Browser files from the brief's grep (character, combat-turns, custom-skills, customization, gates-quests-dailies, save, table-session), one run: 78 passed, 0 failed, no pause seen.
- AGENTS.md: a "Where things live" row for a use (`outcomesOf` in `use.ts`, the `use` command; `tests/use.test.ts`, `tests/encounter.test.ts`); the parsers row names `parseSkill` and `library.skills`; a new "A skill" recipe (the table, `parseSkill` and `SKILL_BOUNDS`, `dice`, effects, target, attack, the fight and outside it); the Item recipe names `target: 'other'`; the Monster recipe names skills, starting statuses (`monsterRow`) and loot.
- Commit 9: step 9.

## Decided by the helper

- `parseSkill` answers a `SkillTemplate` (a skill without its id), as `parseItem` does; the save gives each kept skill its id in place (`refill`). The brief wrote `Skill | null`.
- A skill's bonus keeps the nine bonus keys as whole numbers inside 999 (the item bound). The old repair kept any numeric key, unbounded; the form allows -20 to 50.
- `cdLeft` is at most the cooldown (the form already did this on edit). A skill's description is cut at 500 (the save's old bound; the form stops at 400).
- A seed's status is written as `status('stealth')`, typed by `StatusKey` from registry/statuses.ts, since that file exports no constant per status.
- A fatigue outcome keeps the sign of a negative fatigue op (it removes fatigue); every other outcome is at least 0. A full heal is the target's max HP. A plain number by rank is not rolled. At most 8 outcomes.
- A refused step refuses the whole `use`. The reason the sheet and another phone see is the use's name.
- The skill or item's own `dice` roll is reused for the first effect with the same dice, so one number shows.
- The target picker lists every combatant up but the user, allies included; it opens before MP is paid.
- An item's `target` is optional and kept only as `other`.
- Only consumables with `target: 'other'` are listed on the combat card; the inventory's Use button is unchanged.
- A monster's skill also rolls its `dice` for the table before the attack roll, as a hunter's does.

## Unsure

- An item with `target: 'other'` used from the inventory's Use button (or a player's Table kit) still acts on its user. Unit 3's `used` message is the place to send it to the GM instead.
- Outside a fight an `other` skill's toast cannot know the target's max HP, so a percent is shown in words ("Deals 10% of max HP damage") and everything else is rolled.
- A crit on a skill's attack roll does not double its dice; the GM rules on it, as with an ability's roll.
