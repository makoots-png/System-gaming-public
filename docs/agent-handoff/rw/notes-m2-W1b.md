# W1b, items, skills, paths and monsters: notes

Commits 1f147d4 to the last one with "W1b" in its message, on `claude/zen-pasteur-ov4cgd` in the main tree. Not pushed.

## Files outside my list (smallest change each, with the reason)

- `src/core/combat/fight-parse.ts` (2 exports): `parseOp(v, R)` and `parseAbility(v, R)` expose the fight's own op and ability readers, so `parseItem`, `parseSkill` and `parseMonster` read effects and abilities with the same bounds a fight row has. No logic changed.
- `src/core/save.ts` (W2's): the local `Skill`, `Item`, `Monster`, `StartStatus` and `Loot` types are deleted and re-exported from their registries (plan 1.2's "save.ts re-exports them"). Its 8 tsc errors are W2's (`newStats`, `newSkill`, `newItem`, `newMonster`, `perkSkill`, `newShadow`).
- `src/core/rewards.ts` and `tests/rewards.test.ts` (W1a's): the reward's `skill()` only deleted `perk`, which `parseSkill` no longer keeps, so the list reads with `parseSkill`. The fixtures `POTION` and `SLASH` came from `save.ts`'s `newItem`/`newSkill` (old shapes); they are now `itemOf` of the shop's Health Potion and `skillOf` of Mutilation renamed Slash. Without this the file was red.
- `src/core/registry/statuses.ts` and `tests/statuses.test.ts` (W1a's): a 15th built-in status, `regenerating` (plan 3.2: "regeneration becomes a starting status `regenerating` with a per-round heal"); a start status's def is looked up in `R.conditions` by key (`rows.ts`), so it had to be a built-in. The test's `meanOf` reads a number as well as dice.
- `src/core/registry/ability-kinds.ts` (P1's): `if ('error' in parsed)` in place of `if (!parsed.ok)`. `starter.js` now reaches this file, and the views' loose typecheck (no strict null checks) cannot narrow on `ok`. Same meaning under both configs.
- `docs/dependency-map.md` (`bun run deps -- --write`), `docs/agent-handoff/copy-tasks.md` (appended).

## Choices where the plan was silent or differed (read these first)

1. **A monster's archetype attack is not stored.** `monsterRows` (`rows.ts`) puts `ARCHETYPE_ATTACKS[archetype]` first under `ATTACK_ID` and drops a monster's own ability with that id. So the plan's "Shortbow (shot)", "Bite (strike)", "Claw (strike)" are the archetype's Shot and Strike, not stored names; `Monster.abilities` holds only what the text adds. A goblin has no abilities of its own.
2. **A seed keeps its `type`** (Humanoid, Beast): `[slug, name, rank, type, archetype, kind, tweak, abilities, notes, desc]`. Plan 3.2's tuple left it out, plan 1.2's `Monster` has it.
3. **Seed abilities are `MonsterSpec`s built under the rules** (`monsterAbility(spec, R)` in `abilities.ts`), so a GM's kind override reaches them, as it reaches P1's. The dice are always the kind's: the old text's damage dice (`5d12+20`) were on the old scale.
4. **Distances:** a bite, fang, coil or mandible is a curse with reach 5 ft (1 tile), not the curse's default 8; Spear Reach 10 ft and Flame Whip 15 ft are strikes with that reach; a blast's ring is the kind's ring width past the radius.
5. **Lines the plan did not list, my call:** Pounce (lycan) a strike, reach 2, Prone 1 round; Steel Fangs a note (an `Ability` has no `pen` field, so the plan's "pen 10% in its tweak of the ability" has no home); War Cry, Dread Presence, Demon Monarch's Presence curses with Frightened; Frost Maul a strike with Slowed 1 round; Blizzard Roar (CON save, no status) a blast radius 2; Earthshaker and Wing Gust physical blasts with Prone 1 round; Boulder Throw and Hurl Boulder shots of 12 and 24 tiles; Parry a shield on itself; Slam, Slow, Cinder Aura, Ice Domain, Mandible Shear notes (no push, aura or crit-face op).
6. **Ice Elf's Flurry is a heavy strike**, as plan 3.2's "not fitting" paragraph says; its table row lists Flurry as a note. The two disagree; I took the paragraph that names the multi-attack rule.
7. **A status with no rounds in its text lasts 3 rounds**, the old ability reader's `ABILITY_ROUNDS`.
8. **Regenerating heals 2, 4, 6, 10, 15, 25 HP a round by its source's rank** (E to S). The plan gives 10 at B (Gate Troll) and 25 at S (Beru); the rest step about 1.6 times a rank.
9. **Items:** armour carries `kit` in its `ItemDef` and `itemOf` works out weight, armor and resist from the rules' kits and `KIT_SHARE` (so the GM's kit override reaches them); a weapon's weight comes from its dice (`weaponWeight`). An old armour piece with no AC (Worn Hunter Boots, Mage Circlet) is light. Every held item has `weight`, `armor`, `resist` (0 when none); `attack`, `penFlat`, `effects` are optional. `dice` stays on every item (plan 1.2 lists it as gone, but plan 3.3, P1's `Weapon` and P5's `RowItem` read a weapon's dice).
10. **Skills:** `Skill = SkillTemplate & { id }` (an `Omit` of the union would lose `ability` and `bonus`). `perk` is gone with `mpCost`, `cooldown`, `cdLeft`, `dice`, `effects`, `target`, `attack`: W2 deletes `perkSkill`, as P2 asked. The starter skills are `STARTER_SKILLS` in `skills.ts` (typed by `BuiltInSkill`, so each active one has its ability), and `starter.js` adds them with `skillOf(def, app.rules())`.
11. **Readers use the shipped rules' limits** (`parseItem`, `parseSkill`, `parseMonster` take no rules), as W1a did for rewards and packs. An active skill whose ability does not read has `ability: null`; a monster's or item's unreadable entry is dropped.
12. **Bounds:** item weight 0 to 50 (design 2.3), armor, resist, `penFlat` 0 to 999, at most 12 effects (a status's op count); a monster at most 11 abilities (the row's 12 minus the archetype's attack), 20 notes of 500, a tweak's HP factor above 0 and at most 10 (`fight-parse`'s), stat points -999 to 999.
13. **`monsterRow` and `monsterSource` stay** as a bridge from the new `Monster` to the old fight's row (HP from `monsterSheetOf`, the old AC 10 and 1d8), because `bestiary.js` imports them and the build would stop. W5 deletes both with `toCombatant`.
14. **`statBlock(R, rank, { archetype, kind, ... })`** is a new monster of that rank (a brute and normal unless told), XP by the rule; **`monsterSheetOf(m, R)`** is its sheet with its tweak (the plan's "statBlock becomes the sheet of a seed").
15. **Paths:** each path's second perk where the old one was AC N is the alloc's second stat at 2N, even where the first perk of the tier is already that stat (Striker E: Agility 2 or Strength 2).
16. **The pregens** keep 10 in every stat and add 8 and 4 to their build's two (Brakk Vitality 18 and Strength 14, Mira Agility 18 and Strength 14, Eldrin Power 18 and Control 14), over `newStats()`.

## What I made

- `items.ts`: `Item`, `ItemBonus` (eight stats, `hpMax`, `manaMax`), `ATTACKS`/`Attack`, `KIT_SHARE`/`ArmorSlot`, `ItemDef` per type, `piece(kit, slot, rar, R)`, `weaponWeight(dice)`, `itemOf`, `parseItem`, `ITEM_BOUNDS`; the 38 items by plan 3.3.
- `skills.ts`: `SkillBonus`, `SkillTemplate`, `Skill`, `SkillDef`, `SKILL_SEEDS` (8), `STARTER_SKILLS` (6), `skillOf(def, R)`, `parseSkill`, `SKILL_BOUNDS`.
- `paths.ts`: `PERK_VALUE` `{ stat: 1, hpMax: 1/10, manaMax: 1 }`; the six paths by plan 3.4.
- `abilities.ts`: `MonsterRules`, `MonsterSpec`, `monsterAbility(spec, R)`.
- `monsters.ts`: `Monster`, `MonsterTemplate`, `MonsterTweak`, `StartStatus`, `Loot`, `StatBlock`, `SeedTweak`, `MonsterSeed`, `ARCHETYPE_LIST`, `MONSTER_KINDS`, `SEEDS` (22), `xpOf`, `monsterSheetOf`, `statBlock`, `seedMonsters`, `parseMonster`, `MONSTER_BOUNDS`, `lootOf`, and the two bridges (choice 13).
- `pack.ts`: `itemOpKeys`, `itemRekey` and the old `ItemOp` import are deleted; items walk `effects` and skills and monsters their abilities' `ops` with `opKeys`, and are re-keyed with `rekeyOps` (`rekeyItem`, `rekeySkill`, `rekeyAbility`).
- `starter.js`: pregens by plan 3.6.
- Tests: `items.test.ts` (410 with the per-entry loop), `skills.test.ts` (69), `paths.test.ts` (28), `monsters.test.ts` (205, including the single-hit bound per seed), `pack.test.ts` (21, fixtures on the new shapes and two new assertions: a skill's and a monster's ability op is re-keyed).

The single-hit bound for the seeds (design 6, as P1 measured it: mean dice, caught, no crit, against a same-rank tank): the worst are Cerberus's Three Heads 24%, Igris's Crimson Slash 21%, Kamish's Wing Gust 21%, the Goblin Shaman's Hex Bolt 18%, Cerberus's Hellfire Breath 18%, of the 60% bound (a scratch run of the test's setup).

Lines (`git diff de165ad --shortstat -- src tests`): see the checks below. Deleted in my files: the six-stat seeds' stat lines and `S(...)`, `SeedTweak`'s `boss`, `elite`, `ac`, `atk`, `dmg`, `init`; the old `statBlock` body; `Monster.skills` and `startStatuses`' old key regex; `Item.heal`, `restoreMp`, `fatigue`; `Skill.mpCost`, `cooldown`, `cdLeft`, `dice`, `effects`, `target`, `attack`, `perk`; `PERK_VALUE.ac`, `mpMax`; pack's old-op walkers; rewards' `skill()`; the tests of all of these.

## For the next units

- **W2:** `Hunter.skills: Skill[]`, `items: Item[]` and the save's `monsters: Monster[]` are the registries' types now (re-exported). `newSkill`, `newItem`, `newMonster` must go or change: a blank is what `parseSkill({ name })`, `parseItem({ name })`, `parseMonster({})` answer. Delete `perkSkill`. `CodexInfo` is still the old one. `Shadow` needs `archetype` for P5's `RowShadow`.
- **W3:** `protocol.test.ts`'s award cases send items with `ac`/`mpMax` bonuses and old item fields (`heal`); they are W3's rewrite. The `award` message reads items with `parseItem` and skills with `parseSkill`, already the new shapes.
- **W5:** `bestiary.js` `toCombatant` calls `monsterRow`; replace it with `monsterRows` (`rows.ts`) and delete `monsterRow` and `monsterSource` from `monsters.ts` (and the `encounter-types` and `status.ts` imports there). `seedMonsters(R)` needs rules with the built-in statuses (`app.rules()` has them).
- **W6/W7:** a skill's fight use is `skill.ability` (`null` for Arise and Shadow Exchange); the maker builds an item's `effects` with the fight's ops and a weapon's `attack`. `loot.js` still imports `legacyOps` from `effects.ts`; delete it there when `loot.js` stops (W7).
- **W8:** `fight-sim.ts` could read the seeds' real abilities for risk 3's rerun.

## Which principle changed a choice

- subtract-before-you-add: pack's two old-op walkers and rewards' `skill()` went in the commit that made them dead; `Skill.perk` went rather than being kept for `perkSkill`.
- type-system-discipline: an active built-in or starter skill is typed by `BuiltInSkill`, so a skill without an ability entry does not compile; an armour piece names its `kit` and an `ArmorSlot`, so a share exists for every slot it may take.
- explain-the-number: kit shares, the weapon weight rule, the 4N initiative rule, the Regenerating tiers and the 3-round default each have their reason beside them; the bound's worst shares are above.
- test-behavior-not-implementation: per-entry expected numbers are worked from the rules in the test (`halfUp` of kit times share), and plan 3.3's table rows (Hunter's Leather 3/4/5, the Vest 6/12/3, the Tower Shield 5/9/3) are literal.
- boundary-discipline: the three readers call the fight's own `parseOp` and `parseAbility`, so an item, skill or monster holds only what a fight row could hold.

## The checks

- Own files: `bunx tsc --noEmit --pretty false 2>&1 | grep -E '^(src/core/registry/[a-z-]+\.ts|src/core/pack\.ts|src/core/rewards\.ts|src/core/combat/fight-parse\.ts|tests/(items|skills|paths|monsters|jobs|pack|rewards|statuses)\.test\.ts)\('`: no output.
- `bunx tsc -p tsconfig.views.json --noEmit --pretty false 2>&1 | grep -E '^src/views/starter\.js\('`: no output.
- `bun test tests/items.test.ts tests/skills.test.ts tests/paths.test.ts tests/monsters.test.ts tests/jobs.test.ts tests/pack.test.ts tests/rewards.test.ts tests/statuses.test.ts tests/abilities.test.ts tests/rows.test.ts tests/lint.test.ts tests/deps.test.ts tests/statecharts.test.ts`: `Ran 952 tests across 13 files. [5.71s]`, 0 fail.
- `bun run deps -- --write`: `wrote docs/dependency-map.md`.
- `bun run build`: `Built 12 files into dist/ (build d4f151811995)`.
- `git diff de165ad --shortstat -- src tests`: `19 files changed, 951 insertions(+), 561 deletions(-)`.
- Browser files: none (the unit names none).

## Red after this unit

`bunx tsc --noEmit --pretty false 2>&1 | cut -d'(' -f1 | sort | uniq -c` (file lines only):

```
      8 src/core/save.ts
      1 tests/encounter.test.ts
      3 tests/save.test.ts
      8 tests/status-sim.test.ts
```

`save.ts` and `save.test.ts` are W2's, `encounter.test.ts` and `status-sim.test.ts` W8's. `items.ts`, `monsters.ts`, `paths.ts`, `items.test.ts`, `paths.test.ts` are green now.

`bunx tsc -p tsconfig.views.json --noEmit` (file lines): `save.ts` 8, `bestiary.js` 25, `combat.js` 19, `effects.js` 1, `gates.js` 3, `hunter.js` 3, `inventory.js` 7, `loot.js` 3, `reward-editor.js` 2, `shadows.js` 9, `skills.js` 48, `workshop.js` 7 (W4 to W7; `starter.js` is green).

`bun test 2>&1 | grep -E '^\(fail\)' | wc -l`: 44. By file: `save.test.ts` 20 (W2), `protocol.test.ts` 9 (W3: award items with old bonus keys and fields, a pushed sheet, the poll answer), `encounter.test.ts` 7 and `status.test.ts` 5 (old modules, W8; one encounter case is "a monster from the bestiary", the old row), `applied.test.ts` 3 (W3, as after W1a). `items.test.ts`, `paths.test.ts`, `skills.test.ts` and `lint.test.ts` are green.
