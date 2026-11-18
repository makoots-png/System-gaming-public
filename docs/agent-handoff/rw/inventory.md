# Inventory for the combat and stats rework

Read only. Every fact names its `file:line` at commit 3cc275f. "Not checked" says why. Short names: `enc-types` is `src/core/combat/encounter-types.ts`, `enc` is `src/core/combat/encounter.ts`, `combat.js` is `src/views/combat.js`, `hunter.js` is `src/views/hunter.js`.

## Summary

1. The fight is one pure reducer over `Setup | Running` (enc:364-403) with 20 commands and 11 effects; `send()` in combat.js is its only writer, and a lint test holds that.
2. Turn order is one sorted array and a round is one pass of it; `reached` stops a status ticking twice. Status rounds, skill cooldowns, the player's turn cue and every balance bound count rounds or own turns.
3. Every roll and every derived number is in a view: initiative, to-hit against AC, damage, crits, MP cost, cooldowns, and the hunter's whole `derived()` (hunter.js:110-128). The reducer sees no stats.
4. Damage reaches the reducer as a final whole number with no type (`Outcome`, use.ts:8), from the GM's view or a player's `used` message.
5. Six stats, declared twice, named in 21 files; `mod` is linear and stats are uncapped, so from rank C up the d20 decides nothing for an invested stat. DEX alone gives AC and initiative.
6. AC is a field on every combatant kind, a status mod, a perk, an item bonus, a rank table column and a room doc field. Nothing has a weight, a damage type, a range or a position.
7. Statuses can change only HP, MP, fatigue and four mods (`ac`, `atk`, `dmg`, `check`); one instance per key, stronger tier wins, rounds counted down at the bearer's turn.
8. Fatigue is spent by nothing; MP is the only ability cost; monsters have neither.
9. Players see the fight through one doc capped at 16,384 characters and may send no fight action, only reports the GM applies.
10. The phase 4 simulation already plays the real reducer in 1.5 s, but its monsters never act and its hunters' numbers are hard-coded.

## 1. The fight today

### 1.1 The shape

`Encounter = Setup | Running` (enc-types:25). No fight is `null` in the save; an ended fight is not stored (enc-types:24).

| Field | Type | Where | Written by |
|---|---|---|---|
| `id` | string | Shared, enc-types:26 | `add` (enc:141-143), cut to 80 |
| `gateId` | string or null | Shared | `linkGate` (enc:388) |
| `combatants` | `Combatant[]` | Shared | every command, through `put` (enc:30) or a new list |
| `log` | string[], newest first, 100 lines of 300 (enc-types:113-114) | Shared | `log()` (enc:31-34), prefixed `R<round>:` while running |
| `shareInit` | boolean | Shared | `setShareInit` (enc:378); default true (enc:143) |
| `bankedXp` | number | Shared | `remove` of a downed monster (enc:323) |
| `phase` | `'setup'` or `'running'` | enc-types:27-28 | `rollInitiative` (enc:133), `remove` of the last one (enc:328) |
| `round` | number, 1 to 9999 (enc-types:116) | Running | `landOn` (enc:61), `prev` (enc:89) |
| `currentId` | `CombatantId` | Running | `landOn`, `prev`, `remove` (enc:338) |
| `reached` | `{ round, started: CombatantId[] }` | Running, enc-types:34 | `startTurn` (enc:52-53), `remove` (enc:331, 339) |

Every combatant shares `Order` (enc-types:39): `id`, `name`, `init` (the initiative total), `tie` (a random coin), `initMod`, `group` (string or null, the shared-initiative pack), `state` (`'up' | 'down'`, enc-types:38). The four kinds (enc-types:40-53):

| Kind | Own fields | Notes |
|---|---|---|
| `monster` | `refId`, `hp`, `hpMax`, `ac`, `atk: number \| null`, `dmg` (dice text), `rank`, `boss`, `xp`, `extractable`, `extractTried`, `abilities: string[]`, `skills: SkillTemplate[]`, `statuses` | No stats on the row. `state` follows HP (`followsHp`, enc-types:126) |
| `shadow` | `refId`, `hp`, `hpMax`, `ac`, `atk: number`, `dmg`, `rank`, `statuses` | HP is written back to the sheet by the `shadowHp` effect |
| `hunter` | `hunterId` only | A hunter on this phone. HP, MP and statuses live on the sheet, never on the row (enc-types:47) |
| `remote` | `remote`, `hp`, `hpMax`, `mp`, `mpMax`, `ac`, `tier`, `statuses` | A hunter on another phone: the last numbers it sent, through `syncRemote` (enc:353-360) |

The reducer reads a local hunter through `Ctx.hunter(id)`, which answers a `HunterView` (enc-types:58-59): `name`, `life`, `hpMax`, `mp`, `mpMax`, `ac`, `initMod`, `tier`, `statuses`. `combat.js:68-72` builds it from the view's `derived()` (`initMod` is the DEX modifier, `tier` the rank index). The stored fight is read by `parseEncounter` (encounter-parse.ts:90-116); a combatant by `parseCombatant` (encounter-parse.ts:56-87), which every `add` calls (enc:147). Bounds: 60 combatants, names 60, 30 statuses, AC -99 to 999, init -999 to 999, initMod -99 to 99, HP to 99,999 (enc-types:111-117, encounter-parse.ts:49-53).

### 1.2 Commands and effects

`reduce(enc, cmd, ctx)` (enc:364-403) never rolls and never reads a clock (enc:1-3). `send()` in `combat.js:86-102` is the only caller that stores the result; it writes sheet effects in the same store update (`writeSheet`, combat.js:75-84), then carries out the rest.

| Command (enc-types:65-85) | What it does |
|---|---|
| `add` | Adds parsed combatants; starts a fight from null. In a running fight a pack member takes its pack's `init` and the list is re-sorted (enc:140-158) |
| `rollInitiative` | Takes `InitRoll[]` (`ids`, `total`, `tie`, enc-types:63), sorts, and in setup starts round 1 and the first turn (enc:115-137) |
| `setInitiative` | Sets one `init`, re-sorts while running (enc:371-377) |
| `setShareInit` | Turns pack initiative on or off (enc:378) |
| `next` / `prev` | Moves the turn (section 1.3) |
| `changeHp` / `changeMp` / `changeFatigue` | A signed delta with a reason. Local hunter: an effect. Remote: the row and a `sendRemote`. Monster or shadow: the row; HP 0 sets `down` and emits `defeated` (enc:218-271). MP or fatigue on a monster is refused |
| `setState` | Up or down by hand; up is refused at 0 HP (enc:161-170) |
| `applyStatus` / `removeStatus` | Through `applyStatus`/`removeStatus` of status.ts; source defaults to whoever's turn it is (enc:183-212) |
| `remove` | Drops a combatant; the last one sends the fight back to setup; removing the current one starts the next turn (enc:320-341) |
| `linkGate`, `note`, `setExtractTried` | Gate link, a log line, a monster's extraction count |
| `use` | `by` used `name` on `on` with `outcomes` the view rolled (section 1.5) |
| `syncRemote` | A remote phone's HP, max HP, MP, max MP, AC and tier (enc:353-360) |
| `end` / `clear` | `end` answers null and an `ended` effect with the `Summary`; `clear` answers null and no effects |

| Effect (enc-types:94-106) | Carried out by |
|---|---|
| `turnStarted` | `app.emit('combat:turn')` (combat.js:97): skills tick cooldowns (skills.js:91), the phone buzzes (custom.js:123) |
| `rollTick` | `rollTick` in combat.js:106-117 rolls a status's per-turn op and sends `changeHp`/`changeMp`/`changeFatigue` back to the reducer |
| `hunterHp`, `hunterMp`, `hunterFatigue`, `hunterStatuses` | `writeSheet` through the vitals functions (combat.js:75-84) |
| `sendRemote` | Room `hp` and `status` messages (combat.js:131-143) |
| `shadowHp` | `writeSheet` sets the shadow's HP on its owner's sheet |
| `defeated` | `combat:defeated`: the bestiary records the kill (bestiary.js:93) |
| `ended` | The view's end window pays XP and loot (combat.js:458-505) |
| `refused` | A toast |

### 1.3 Turn order and rounds

- The order is the `combatants` array, kept sorted by `turnCmp` (enc-types:120): `init` high to low, then `initMod`, then `tie`. `sortTurnOrder` runs on `rollInitiative`, `setInitiative`, `add` while running and `parseEncounter` (enc:124, 374, 155; encounter-parse.ts:105).
- Initiative is one d20 per combatant, or one per monster `group` when `shareInit` is on (`initiativeNeeds`, enc:101-113). The view rolls `1d20+mod` (combat.js:188-191) and a `Math.random()` tie (combat.js:195). A hunter's mod is its DEX modifier (combat.js:71, 149); a monster's is its rank table `init` plus the seed's tweak (monsters.ts:72, 135); a shadow's is its rank table `init` (combat.js:165).
- `next` walks the array forward from the current index to the next `up` combatant; passing the end adds a round (`forwardFrom`, enc:66-73). A round is one pass of the array. There is no per-combatant speed, no extra turn, no delay.
- The `turnStarted` rule: `reached` holds the furthest round and whose turns have started in it (enc-types:30-34). `landOn` starts a turn only when `hasStarted` is false (enc:41, 60-64). So `prev` then `next` does not tick a status twice. `prev` walks back only to a turn that has started (enc:81-92).
- `startTurn` (enc:43-58) ticks the combatant's own statuses (`tickStatuses`), logs expiries, records `reached`, emits `turnStarted` and one `rollTick` per per-turn op. A status's `rounds` therefore counts the bearer's own turns, not rounds of the fight.
- Who acts is not checked: `use` and the change commands accept any `by` at any time (enc:283-317).

### 1.4 Where dice are rolled

Every roll is in a view. Core never rolls (enc:1-3, use.ts:2).

| Roll | Where | What the command carries |
|---|---|---|
| Initiative | combat.js:188-197 | `rollInitiative.rolls[].total` and `tie` |
| A hunter's attack | combat.js:233-247 | Nothing: a `note` with the hit or miss. Damage is not applied |
| A hunter's damage | combat.js:248-255 | Nothing: a `note`. The GM applies it by hand |
| A monster's attack and damage | combat.js:264-286 | A `note`; the damage waits in `pend` for an Apply button that sends `changeHp` (combat.js:361-365) |
| A dice button in a monster's ability text | combat.js:309-317 | A `note` and `pend` |
| To hit for a skill or monster skill | combat.js:395-399, 404-411 | Nothing on a miss but a `note`; on a hit the `use` command |
| A skill's, item's or monster skill's numbers | `outcomesOf` called from combat.js:421, 438, 454 with a roller from the view | `use.outcomes[]`: whole numbers and status keys |
| A status's per-turn op | combat.js:106-117 | `changeHp`/`changeMp`/`changeFatigue` with the number |
| The dice engine | `src/views/dice.js:61-94`; `crit` is a natural 20 and `fumble` a natural 1 of a single d20 (dice.js:94) | |

### 1.5 One ability use, traced

1. The tap. A hunter's skill button calls `useSkill` (combat.js:440-455); an item `useItem` (combat.js:413-422); a monster skill `useMonsterSkill` (combat.js:424-439).
2. The target. `askTarget` lists everyone up but the user, with "(AC n)" on each (combat.js:385-393). A skill with `target: 'self'` acts on its user.
3. The cost. A skill pays first: `skills.pay` refuses a skill on cooldown, spends MP through `hunter.spendMp`, sets `cdLeft`, and rolls the skill's `dice` once (skills.js:44-57). A monster skill's MP and cooldown are text only; "the GM keeps a monster's count" (combat.js:304-305). No fatigue cost exists.
4. To hit. Only when the skill has `attack: true` and `target: 'other'` (combat.js:437, 453). `toHit` rolls `1d20+bonus` against the target's live AC; a natural 20 always hits and a natural 1 always misses (combat.js:395-399). A hunter's bonus is `checkBonus(stat) + atkMod` with `stat` from the card's STR or DEX picker (combat.js:229-232, 453); a monster's is `atk + status atk + status check` (combat.js:259). On a miss only a `note` is sent (combat.js:407-408).
5. The numbers. `outcomesOf(ops, tier, { hpMax }, roll)` (use.ts:25-47) keeps ops whose `when` is `use`, reads a tiered op at the user's tier (`atTier`), turns a percent into a share of the target's max HP, a full heal into its max HP, and dice into `roll(dice)`. A crit changes nothing here: no doubled dice on the `use` path. The tier is the hunter's rank index (skills.js:59), the item's rarity index (effects.ts:29), or the monster's rank tier (combat.js:438).
6. The command. `{ type: 'use', by, on, name, outcomes }` (combat.js:410). The reducer (enc:283-317) runs each outcome through `changeHp`, `changeMp`, `changeFatigue`, `addStatus` (with `by` as source) or `dropStatus`; one refused step refuses the whole use; one log line.

What is not there today: no damage type, no armor or resistance, no save rolled by the app, no range or area, no position. Saves exist only as text in monster abilities ("CON save DC 13", monsters.ts:30). The rules reference describes a natural 20 doubling the dice (rulesref.js:108, 149); only `monsterAttack` does it, by rolling the damage twice (combat.js:279). The hunter damage roll says "Crits double the dice" in its note and does not (combat.js:253).

### 1.6 What each kind of ability holds

| Thing | Shape | Fight reads |
|---|---|---|
| A hunter skill | `Skill` (save.ts:89-94): `name`, `type` active or passive, `level`, `label`, `mpCost`, `cooldown`, `cdLeft`, `dice`, `desc`, `bonus` (perk keys), `effects: Op[]`, `target: 'self' \| 'other'`, `attack`, `perk?`. Parsed by `parseSkill` (skills.ts:70-89) | `effects`, `target`, `attack`, `mpCost`, `cooldown`, `dice` |
| An item | `Item` (save.ts:95-103): `rar`, `type`, `slot`, `qty`, `dice` (weapon damage), `bonus` (worn), `heal`, `restoreMp`, `fatigue?`, `effects?`, `target?: 'other'`, `tell?`. Parsed by `parseItem` (items.ts:116-137) | `itemOps(item, 'use')` (effects.ts:31): `heal`, `restoreMp` and `fatigue` become ops (effects.ts:14-21) |
| An op | `Op` (status.ts:15-38): `damage`, `heal`, `mp`, `fatigue` (dice, amount, `pct` for damage and heal, or six `tiers`), `mod` (`ac`, `atk`, `dmg`, `check`), `applyStatus`, `cureStatus`, `note`; each with `when` `use`, `equip` or `turn`. At most 8 (status.ts:108) | |
| A monster's ability text | A line `Name: text`. `parseAbility` (ability.ts:20-42) makes dice buttons (`2d6+3`), a to-hit button (`+5 to hit` or a leading `+5`) and an Apply button per status name with its rounds (default 3, ability.ts:14) | Buttons that send `note`, `pend` or `applyStatus` |
| A monster skill | A `SkillTemplate` on the monster (save.ts:139, enc-types:42), up to 12 | As a hunter skill, at the monster's rank tier |
| A monster row of `SEEDS` | `[slug, name, rank, type, tweak, stats, abilities, desc]` (monsters.ts:21). `tweak` multiplies `hp` and `xp`, adds `ac`, `atk`, `init`, replaces `dmg` (monsters.ts:18-19). 22 seeds (monsters.ts:28-49) | `hp`, `ac`, `atk`, `dmg`, `init`, `xp`, `abilities`. The six `stats` are stored and never read by the fight (no `stats` on the row, enc-types:40-43) |
| A monster's plain attack | `atk` and `dmg` on the row; the Attack button rolls `1d20+atk` against AC and then `dmg` (combat.js:264-286) | |

## 2. Stats and derived numbers

### 2.1 Where a stat key is named

`STAT_KEYS` is declared twice with the same six keys: `src/core/rules.ts:11` and `src/core/save.ts:51`, each with its own `StatKey` (rules.ts:12, save.ts:60). `STATS` (rules.ts:14-15) pairs each key with a label and the Solo Leveling alias (DEX "Agility", CON "Vitality", INT "Intelligence", WIS "Perception", CHA "Presence"). `PERK_KEYS` is the six stats plus `hpMax`, `mpMax`, `ac` (rules.ts:179); every bonus parser keeps exactly these nine.

| File | What it does with a stat key |
|---|---|
| `src/core/rules.ts` | `STAT_KEYS`, `STATS`, `mod` (163), `formulaHpMax`/`formulaMpMax` read `con`/`int` (173-174), `Perk`, `PERK_KEYS`, titles' bonuses (49-53), `shadow.capacityStat: 'int'` (70) |
| `src/core/save.ts` | Second `STAT_KEYS` (51), `Stats` (63), `newStats` all 10 (193), the repair fills a missing stat with 10, no upper bound (474-479), the v1 migration (656) |
| `src/core/registry/paths.ts` | Six paths, every perk a stat, `hpMax`, `mpMax` or `ac` (22-27); `alloc` weights per stat |
| `src/core/registry/items.ts` | `ItemBonus` (21); 25 of the 38 built-in items carry a stat or AC bonus (36-84); `parseItem` keeps `PERK_KEYS` (123) |
| `src/core/registry/skills.ts` | `parseSkill` keeps `PERK_KEYS` in a skill's bonus (77); Bloodlust's `str: 1` (32) |
| `src/core/registry/monsters.ts` | `S(...)` six stats per seed (25-49), `statBlock` stats (60), `parseMonster` (102) |
| `src/core/rewards.ts` | A reward's bonus keeps `PERK_KEYS` (62) |
| `src/core/api.ts` | `Derived` (27-33) and `Bonuses` (35) types |
| `src/edge/rules.ts` | `Stats` type (26), binds `mod`, `formulaHpMax`, `formulaMpMax` to the current rules |
| `src/views/hunter.js` | `derived()` (110-128), the stat grid and spending (582-608), `BKEYS`/`AKEYS`/`BLABEL` (18-20) |
| `src/views/combat.js` | `initMod` from `mods.dex` (71, 149, 155), the attack stat picker STR or DEX (717), `hunterToHit` and `hunterDamage` (229-255) |
| `src/views/inventory.js` | `bonuses(h)` sums worn gear (73-87), labels (11) |
| `src/views/skills.js` | `BONUS_KEYS` own list of nine (12), passive bonuses (21-32) |
| `src/views/custom.js` | Build screen labels (13), `allocPlan` Auto (275-280), perk preview (369) |
| `src/views/maker.js`, `src/views/loot.js` | Bonus field labels (maker.js:13, 48-54; loot.js:18) |
| `src/views/bestiary.js` | Monster stat display and edit fields (205, 226-230, 303) |
| `src/views/dice.js` | A check button per stat with `checkBonus` (106, 196) |
| `src/views/shadows.js` | Army size is the `capacityStat` score (10); extraction rolls `mods.int + rankBonus` (50) |
| `src/views/rulesref.js` | What each stat is for, in words (101), formulas in words (108-109, 156) |
| `src/views/starter.js` | Three starter hunters' stats (8, 12, 16) |

That is 21 files under `src/`, five of them in `src/core` plus the registry. Five view files keep their own label map of the nine keys (custom.js:13, maker.js:13, loot.js:18, inventory.js:11, hunter.js:20) and skills.js keeps a tenth list (12).

### 2.2 What each stat feeds today

All of these are computed in a view, `derived()` in `hunter.js:110-128`, not in core. `mod(score) = floor((score - 10) / 2)` (rules.ts:163). "Score" below is the stat after gear, title and passive bonuses (hunter.js:113).

| Number | Formula | Where |
|---|---|---|
| Max HP | `4 + 2*CON + 4*(level - 1) + bonus.hpMax + hpAdj`, at least 1 | rules.ts:19, 173; hunter.js:117 |
| Max MP | `1*INT + 2*(level - 1) + bonus.mpMax + mpAdj`, at least 0 | rules.ts:20, 174; hunter.js:118 |
| AC | `10 + mod(DEX) + bonus.ac + status ac` | hunter.js:124 |
| Initiative mod | `mod(DEX)` | hunter.js:124; combat.js:71 |
| Check bonus (any stat) | `mod(stat) + rankBonus - fatiguePenalty - penaltyMod + status check + bonus.check` | hunter.js:126 |
| To hit | `checkBonus(STR or DEX) + status atk + bonus.atk`; the GM picks STR or DEX on the card | combat.js:229-232, 717 |
| Weapon damage | `weapon dice (else 1d4) + mod(STR or DEX) + status dmg + bonus.dmg` | combat.js:248-252 |
| Skill DC | `8 + mod(INT) + rankBonus` (shown; nothing rolls against it) | hunter.js:125, 623 |
| Passive Perception | `10 + mod(WIS) + rankBonus` (shown only) | hunter.js:125, 624 |
| Carry | `15 * STR`. Computed and read by nothing (`grep carry` finds only hunter.js:124 and the type in api.ts:29). No item has a weight | hunter.js:124 |
| Shadow army size | the `int` score | shadows.js:10; rules.ts:70 |
| Extraction | `d20 + mod(INT) + rankBonus` against `max(5, 10 + 3*(monster rank - hunter rank) + 5 if boss)` | shadows.js:12, 50 |
| Fatigue penalty | `-2` to checks at fatigue 50 or more; disadvantage at 80; collapse at 100 | rules.ts:35; hunter.js:115, 122 |
| Daily penalty | `-2` to checks while a penalty is open | rules.ts:37; penalty.ts:90 |
| Saves | none computed. A save is text in an ability ("CON save DC 13"); the GM rolls a check | monsters.ts:30-49 |

CHA and WIS feed only checks, Passive Perception and words. CON feeds only max HP. Nothing makes a stat cost or slow anything.

### 2.3 Perks, titles, gear and passives

- Perk keys are the nine `PERK_KEYS`. Value: 1 stat point = 1, 10 max HP = 1, 5 max MP = 1, 1 AC = 2 (paths.ts:18); a tier's two perks are worth 2, 2, 3, 3, 4, 4 (paths.ts:19). Tier i opens at rank `RANKS[i]` (`tiersOpen`, rules.ts:189).
- The path's perks are summed by `pathBonus` (rules.ts:191-200) and stored as one passive skill marked `perk` that the save repair rebuilds on every load (save.ts:531-548). So a perk reaches `derived()` through `skills.bonuses` (skills.js:21-32) like any passive.
- Gear: ten slots (`SLOTS`, items.ts:15; `rules.slots`, rules.ts:61), one item per slot (`equipped`, save.ts:126). `inventory.bonuses` (inventory.js:73-87) sums each worn item's `bonus` and its `equip` `mod` ops (`ac`, `atk`, `dmg`, `check`). A weapon's `dice` is its damage (combat.js:250-252). No weight, no armor type, no slot rule beyond one item per slot.
- A title adds its `bonus` (hunter.js:102; rules.ts:49-53). `bonusOf` sums title, gear and passives into one record (hunter.js:99-108).
- A status adds `mod` ops: `ac`, `atk`, `dmg`, `check` only (status.ts:10, 241-248).

### 2.4 Monsters by rank

`statBlock(R, rank, { boss, elite })` (monsters.ts:53-64) reads `R.rankTable[rank]` (rules.ts:24-31): `hp`, `ac`, `atk`, `dmg`, `init`, `xp`. A boss multiplies HP by 3 and XP by 3 and adds 2 to AC and to hit (rules.ts:32); an elite multiplies HP and XP by 1.5 (rules.ts:33). Its six stats are `10 + 2*rankIndex` for STR, DEX and CON (+2 STR and CON for a boss), 8 INT, 10 WIS, 8 CHA (monsters.ts:55, 60); the fight never reads them. A seed takes the block and its `tweak` (monsters.ts:67-76). The GM's quick line (`HP 30, AC 13, +5, 1d8+2`) and the custom form fill what is not typed from `statBlock` (combat.js:325-360, 885-893). A shadow copies the monster's HP, AC, attack and damage when extracted (shadows.js:23); its HP grows 10% a level (shadows.js:14).

### 2.5 How a hunter grows

- XP: `xpToNext(level) = 100 * level` (rules.ts:18, 164); `gainXp` levels up and down and refills HP and MP on a new peak level (progress.ts:45-54).
- Points: 3 a level above 1 (`levelPoints`, progress.ts:31) plus `bonusPoints` (quests, dailies, GM) less `spent` (progress.ts:33-35). One point raises one stat by 1 (hunter.js:582-583). No stat cap.
- Rank: set by the GM's re-evaluation; `rankForLevel` (rules.ts:168-172; levels E 1, D 10, C 20, B 35, A 50, S 70, rules.ts:21) only says which rank the level allows (hunter.js:173). The rank gives `rankBonus` E 2, D 3, C 4, B 5, A 6, S 8 (rules.ts:22), the status source tier (enc:175) and the path tiers open.

### 2.6 The numbers at E, C and S

Computed by a throwaway bun script (not committed) that imports `RULES`, `formulaHpMax`, `formulaMpMax`, `pathBonus`, `mod` and `statBlock` from `src/core`, places all level points with the same rule as Auto (`allocPlan`, custom.js:275-280), takes the first perk of each open tier, and uses a 1d8 weapon and no other gear or title. Hit chance is `(21 - (AC - bonus)) / 20` clamped to 5% to 95% (a natural 20 hits, a natural 1 misses). The phase 4 audit's table (p4/status-audit.md:169-176) is the same Vanguard with loot weapons and agrees on HP.

Hunters (level is the rank's first level; stats are STR/DEX/CON/INT/WIS/CHA):

| Build | Rank, level | Stats | Max HP | Max MP | AC | Init | To hit | Dmg a hit |
|---|---|---|---|---|---|---|---|---|
| Vanguard (STR 2 : CON 1) | E, 1 | 12/10/10/10/10/10 | 24 | 10 | 10 | +0 | +3 | 5.5 |
| | C, 20 | 54/10/30/10/10/10 | 140 | 48 | 10 | +0 | +26 | 26.5 |
| | S, 70 | 162/10/83/10/10/10 | 446 | 148 | 10 | +0 | +84 | 80.5 |
| Striker (DEX 2 : STR 1), attacks with DEX | E, 1 | 10/12/10/10/10/10 | 24 | 10 | 11 | +1 | +3 | 5.5 |
| | C, 20 | 30/54/10/10/10/10 | 100 | 48 | 32 | +22 | +26 | 26.5 |
| | S, 70 | 83/162/10/10/10/10 | 300 | 148 | 86 | +76 | +84 | 80.5 |
| Arcanist (INT 2 : WIS 1) | C, 20 | 10/10/10/54/30/10 | 100 | 92 | 10 | +0 | +4 | 4.5 |
| | S, 70 | 10/10/10/162/83/10 | 300 | 300 | 10 | +0 | +8 | 4.5 |

Monsters (`statBlock`):

| Rank | Kind | HP | AC | To hit | Damage (average) | Init | XP |
|---|---|---|---|---|---|---|---|
| E | normal / boss | 20 / 60 | 13 / 15 | +4 / +6 | 1d8+2 (6.5) | +1 | 25 / 75 |
| C | normal / boss | 150 / 450 | 24 / 26 | +13 / +15 | 3d10+10 (26.5) | +6 | 250 / 750 |
| S | normal / boss | 2000 / 6000 | 50 / 52 | +34 / +36 | 8d12+50 (102) | +18 | 8000 / 24000 |

Vanguard against a same-rank monster, one swing each:

| Rank | Vanguard hits | Swings to kill a monster / a boss | Monster hits Vanguard | Monster swings to down Vanguard |
|---|---|---|---|---|
| E | 55% | 6.6 / 24.2 | 75% | 4.9 |
| C | 95% | 6.0 / 17.9 | 95% | 5.6 |
| S | 95% | 26.2 / 78.5 | 95% | 4.6 |

What the tables show: a stat point is linear and uncapped, so from C up the d20 decides nothing for an invested stat (to hit +26 against AC 24). DEX alone gives AC and initiative, so the Striker at S has AC 86 against a monster's +34 (hit only on a natural 20) and the Vanguard keeps AC 10. The Arcanist has no attack that grows: its damage must come from skills, which grow only with the rank tier. Monster HP grows 100 times from E to S while a hunter's hit grows about 15 times (p4/design.md:9).

## 3. Statuses and resources

### 3.1 What a status can do

A status is `{ key, rounds, def?, source? }` (status.ts:51). Its definition `{ label, desc, color?, ops? }` (status.ts:42) comes from the instance's own `def`, else the rules' `conditions` (built-ins laid under the GM's `library.statuses`, rules.ts:99-102), else the key as its label (`unresolved`, status.ts:216-225).

| Op | Can change | Fires |
|---|---|---|
| `damage`, `heal` | HP, by dice, an amount, a percent of max HP (`pct`, 1 to 100) or six tiers | At the bearer's turn start on a status (`defaultWhen`, status.ts:99-100); on use for an item or skill |
| `mp`, `fatigue` | MP; fatigue (a negative amount removes it) | Same |
| `mod` | One of `ac`, `atk`, `dmg`, `check` (`ModStat`, status.ts:10), a flat value -99 to 99 or six tiers | Always on while the status is held (`mods`, status.ts:241-248); on an item, while worn |
| `applyStatus`, `cureStatus` | Another status, two levels deep (status.ts:141) | On use |
| `note` | Text only | On use |

No op can change a stat, speed, initiative, a turn, a target or a shield. The status maker offers exactly these kinds (maker.js:63-64). Paralyzed, Stunned, Invisible and Stealth have no ops; "cannot act", advantage, disadvantage and speed are words for the table (statuses.ts:16-25; p4/design.md:57). At most 8 ops (status.ts:108), 30 statuses a target (enc-types:115).

### 3.2 Duration, stacking and rank

- Duration: `rounds` is a whole number or `null` (until removed). `tickStatuses` runs at the start of the bearer's own turn: it collects the per-turn ops first, then lowers each numbered `rounds` by 1 and drops those at 0 (status.ts:284-292). So a 2-round status ticks twice, and its length is counted in the bearer's turns. A local hunter's ticked list goes back to the sheet through `hunterStatuses` (enc:46-49).
- Stacking: one instance per key per target. `applyStatus` keeps the instance in place; the source with the higher tier wins and brings its def, a tie goes to the newcomer, and the rounds are the longer of the two, `null` beating any number (status.ts:261-276). This is phase 4's stronger-wins rule (p4/design.md:22).
- Rank: an op may hold `tiers`, six values E to S (status.ts:11-19). `atTier` resolves one at the instance's source tier (status.ts:191-198); `statusDef` resolves every op of an instance that way (status.ts:203-206), so every reader sees flat numbers. The source is `{ kind, id, name, tier }`, a snapshot at apply time (status.ts:46-49): a hunter's rank index, a monster's rank, an item's rarity, or the GM at the target's rank (enc:172-186). The built-in curves are in p4/design.md:28-41.
- Per-turn numbers are rolled by the view: the reducer emits `rollTick` with the quantity (`rollFor`, status.ts:230-233) and the view sends the change back as a command (combat.js:106-117).

### 3.3 Where a status is drawn

The handoff names four drawings (docs/agent-handoff/handoff.md:49):

| Drawing | Where |
|---|---|
| The sheet's chip, with its description on tap | hunter.js:540-541 |
| The combat card's remove buttons and the per-status effect lines | combat.js:699-705, 750 |
| The turn order row's words | combat.js:764 |
| The players' table HUD words, and the player's own chips | table.js:116, 121; table.js:134-145 |

A status reaches the table through the room's encounter doc as `{ key, label, rounds, color? }`, 12 a row (combat.js:566).

### 3.4 Vitals

`Vitals = { life, mp, fatigue, collapsed }` (vitals.ts:91). Only a hunter has them; a monster or shadow has `hp` and `hpMax` on its row and no MP or fatigue (enc:258, 268).

| Resource | Range | Spent or lost by | Restored by |
|---|---|---|---|
| HP (`life`) | `up` with 1 to max, or `dying`, `stable`, `dead` at 0 (vitals.ts:14-18) | `changeHp` from a use, a status tick or the GM; damage on a dying hunter does nothing (vitals.ts:70-71) | Heal ops, potions, rests, a new peak level (progress.ts:53), the day's dailies (quests.js:304), `revive` for the dead |
| Death saves | d20: 20 up at 1 HP, 10 to 19 a success, 2 to 9 a failure, 1 two failures; three of either ends it (vitals.ts:35-39, 58-64) | Rolled in the view (hunter.js:488); the card asks for it on a dying hunter's turn (combat.js:709-710, 740) | |
| MP | 0 to max (vitals.ts:104-107) | A skill's `mpCost` (skills.js:48), a shadow's summon (shadows.js:84), `changeMp` | `mp` ops, Mana Potions, rests, a new peak level, dailies |
| Fatigue | 0 to 100 (vitals.ts:110-114) | Nothing spends it. It rises only by hand (hunter.js:448), a `fatigue` op or `changeFatigue` | Rests, the Stamina Tonic (items.ts:42), a negative `fatigue` op |
| Collapse | Set when fatigue reaches 100; ends only with a long rest (vitals.ts:110-126) | | Long rest |

The rest rule (`rest`, vitals.ts:120-126; numbers rules.ts:36): a short rest gives back 25% of max HP and 50% of max MP and removes 25 fatigue; a long rest gives back 100%, 100% and 100 and ends a collapse. A rest is a button on the sheet (hunter.js:285-290, 402, 438-440); nothing calls it after a fight. Fatigue's effects are on checks only: -2 from 50, disadvantage from 80 (rules.ts:35; hunter.js:115, 122, 126; dice.js:111; combat.js:231).

### 3.5 Built-in content that names an old number

Counted by a throwaway script over the registries (not committed).

- Statuses (14, statuses.ts:9-29): `mod ac` in Slowed, Hasted, Prone; `mod atk` in Blinded, Restrained; `mod check` in Poisoned, Frightened, Bloodlust; `mod dmg` in Bloodlust. Words: "Speed" in Slowed, Hasted, Restrained; "STR and DEX saves" in Stunned; advantage or disadvantage in Poisoned, Frightened, Blinded, Invisible, Prone, Restrained. So 8 of 14 have a `mod` on a number the rework replaces or must keep.
- Skills (8, skills.ts:30-45): all 7 active skills cost MP (2 to 8). Dagger Rush and Mutilation roll to hit (`attack: true`). Bloodlust's passive is `str: 1`. Sprint's text is about movement ("double your movement").
- Items (38: 10 shop, 25 loot, 3 starter; items.ts:36-84): 25 carry a stat or AC bonus. Keys by count: `ac` 14, `str` 6, `con` 6, `dex` 6, `mpMax` 5, `int` 4, `wis` 1, `cha` 1, `hpMax` 1. 7 name MP (`mpMax` or `restoreMp`). 10 weapons carry `dice` (1d4 to 4d8). None has a weight or a damage type.
- Monsters (22 seeds, monsters.ts:28-49): every one has rank-table `ac`, `atk` and `init`; 5 tweak AC and 16 tweak initiative. Their ability text names: a save 12 times (CON 4, WIS 4, DEX 4), AC 3 (Steel Fangs "ignore 2 AC", Shield Wall "+2 AC", Parry "+3 AC"), resistance 6, initiative 1 (Hive Mind), "to hit" 2, a distance in ft 21 times.
- Rules: `rankTable` `ac`, `atk`, `init` per rank (rules.ts:25-30), `boss.ac` and `boss.atk` (rules.ts:32), the AC perk value 2 (paths.ts:18), `ac` perks in all six paths (paths.ts:22-27).

## 4. What the room carries

### 4.1 How a fight reaches the players

The fight lives only on the GM's phone (`save.encounter`). Players see it through one room document and change their own sheet through two GM messages.

| Carrier | Direction | What it holds | Bounds |
|---|---|---|---|
| `encounter` doc (protocol.ts:283-285, parser 322-330) | GM to every phone, rebuilt by `encDoc` (combat.js:558-570) and put at most every 800 ms (`PUBLISH_MS`, sync.ts:54, 634-647) | `active`, `round`, `currentId`, `by`, `list` of rows, the last 5 log lines | Rows: 60 by the parser (protocol.ts:328), 30 by the view (combat.js:564). A row: `id`, `name` 60, `kind` monster/hunter/shadow, `key`, `band`, `conds` 12 of `{ key, label 40, rounds 1-999, color }`, `defeated`, and `hp`/`hpMax` for a hunter or shadow only (protocol.ts:278-281, 311-321). Round 1 to 9999. The whole doc at most 16,384 characters of JSON (`DOC_MAX`, server.ts:200, 312) |
| `hp` message (protocol.ts:146, 205) | GM only, to listed sheet keys | Signed `hp`, `mp`, `fatigue` deltas and a reason | Each -99,999 to 99,999 (protocol.ts:36, 186); reason 120 |
| `status` message (protocol.ts:147, 206-209) | GM only | `add`: up to 10 `StatusGrant` with key, rounds, def as written and source (protocol.ts:90, 131-137); `remove`: up to 10 keys | A state chip is refused (protocol.ts:105-106) |
| `revive` | GM only | Sheet keys | |
| A player's sheet | Player to room every 3 s while it changes (`PUSH_MS`, push.ts:9) | The whole `Hunter`, repaired by `parseSheetHunter` with the base rules (protocol.ts:387-397; save.ts:753-760) | 32,768 characters (`SHEET_MAX`, server.ts:200); each list 100 (protocol.ts:376-377) |
| `codex` doc | GM to players | A met monster's `hp`, `ac`, `atk`, `dmg`, 4 abilities (protocol.ts:291-294, 340-347) | 200 entries |

The GM's fight reads a remote hunter's numbers from its sheet through the GM phone's own `derived()` (`remoteNumbers`, combat.js:152-156) and stores them with `syncRemote` only when the sheet has seen the GM's last change (`freshFor`, combat.js:573-582; src/core/sync/sent.ts). So a remote's AC, max HP and tier are worked out on the GM phone from the player's raw sheet.

A player's phone knows its turn from the doc's `round` and `currentId` (table.js:257-266) and emits `combat:turn` for its hunter, which ticks its skill cooldowns (skills.js:91).

### 4.2 What a player's phone may send during a fight

Only three message types are not GM-only, and each speaks for the sender's own hunter (`ownSheet`, protocol.ts:211-230):

- `roll`: a dice result for the GM's Table feed (`total`, `rolls` 50, `crit`, `fumble`, `dmg`). The GM may tap Apply to deal it as damage (table.js:391-392).
- `used`: an item, skill or boon used, with up to 8 `Outcome`s rolled on the player's phone (protocol.ts:167-169, 226-230; bounds use.ts:73). The GM taps to apply them through `combat.applyUse`, which sends `use` with the remote as `by` (table.js:329-334; combat.js:591-596).
- `questUpdate`.

A player cannot move, end a turn, pick a target the fight records, or send a number the GM does not confirm. The appliers on a player's phone for `roll`, `questUpdate` and `used` do nothing (`GM_ONLY_READS`, room-events.ts:51-53).

### 4.3 What the bounds mean for the rework's new state

Measured with a throwaway script that builds docs and runs `DOCS.encounter` (not committed): 8 rows with one status each are about 2,300 characters; 30 rows with 3 statuses each about 10,800; 30 rows with 12 statuses each and 60-character names about 30,200, which passes the parser but is over the server's 16,384. What the GM phone does when a doc put is refused with 413 is not checked (sync.ts:465 handles a refused sheet; the doc path was not read).

| New state | What carries it today | Fact for the designer |
|---|---|---|
| A position per combatant | Nothing | A row has no free field. Two small integers are about 15 characters a row, 450 for 30 rows. The parser drops unknown fields, so `encounterRow` and `EncounterRow` must gain it (protocol.ts:279-281, 311-321) |
| A gauge value or time to next turn | Nothing. Players learn order only from list order and `currentId` | `round` is an int 1 to 9999 and the turn cue keys on `round` and `currentId` (table.js:260) |
| A channel count | A status's `rounds` (1 to 999 or null) is the only number on a row's status | A count of 0 does not fit `rounds` |
| A shield | Nothing; a monster row has no HP for players, only `band` (protocol.ts:281) | A hunter's HP is exact on the table |
| A threat table | Nothing | A table of monsters by hunters is up to 30 by 24 numbers in one doc of 16,384 characters |
| Movement sent by a player | Nothing | A new `ownSheet` message type (the recipe in AGENTS.md "A room message") and a GM-side applier, or GM-only movement |

### 4.4 The save

- The fight is `save.encounter` (save.ts:179), read by `parseEncounter` in the repair (save.ts:609). A fight it cannot read is dropped.
- A hunter's stats are `Hunter.stats` and `statsLocked` (save.ts:124-125); the repair fills each `STAT_KEYS` key with 10 when missing and has no upper bound (save.ts:474-479). Level and points are `Progress` (progress.ts:9-20); HP, MP and fatigue `Vitals`.
- Custom content: `library.items`, `library.statuses`, `library.skills`, `library.rewards` (save.ts:173; repaired at 600-602 and 389-417), the GM's monsters `save.monsters` (`parseMonster`, monsters.ts:98-115; save.ts:357, 607), the shop `save.shop` (save.ts:178, 604), the codex (save.ts:184-185, 605). Each kind has one parser: `parseItem`, `sanitizeDef`, `parseSkill`, `parseRewards`, `parseMonster`.
- Loading: `loadSave` reads the newest stored key (save.ts:733-744); `parseSaveValue` sends schema 3 to `repair`, anything with a `hunters` list to `fromV2` then `repair`, and a v1 shape to `fromV1` (save.ts:700-713). `SCHEMA = 3` (save.ts:189).
- A new campaign with new stat keys must change: `STAT_KEYS` (both copies), `newStats` (save.ts:193), the repair loop (save.ts:474-479) and the v1 migration (save.ts:656), `PERK_KEYS` and every bonus parser that keeps it (skills.ts:77, items.ts:123, rewards.ts:62), the path table (paths.ts:22-27), `SEEDS` stats (monsters.ts:28-49) and `statBlock` (monsters.ts:60), the starter hunters (starter.js:8-16), and the label maps in five views (section 2.1).
- Two rules disagree and the lead must pick: AGENTS.md "Saves and roles" migrates an older save once and keeps the campaign, and the standing instructions to helpers say a player's hunters must survive a format change through that migration; the rework notes say a new campaign is fine and old saves are not carried (combat-rework-notes.md:44). Today an old hunter loaded under new keys would get 10 in each new key and keep its old keys as unknown fields (not checked: `fill`'s handling of extra keys was not read).

## 5. The tests and tools that exist

### 5.1 What each fight test proves

| File | Tests | What it proves |
|---|---|---|
| `tests/encounter.test.ts` | 98 | The reducer command by command: reading a stored fight (38), setup (134), initiative and packs (182), next and prev with the turn-start rule (226-283), re-sorting mid-fight (284), HP and down (325), a hunter on this phone and its sheet effects (375), percent ticks (443), a remote hunter (479), statuses ticking, expiring and their source (509-575), `use` and its all-or-nothing refusal (576-658), a bestiary monster's row (659), removal (680), the rest (738) |
| `tests/encounter-model.test.ts` | 3 | 2,500 seeded random fights of 1 to 40 commands (`SEEDS`, `lengthOf`, fight-play.ts:124-125) with invariants after every command: unique ids, HP within 0 and max, a monster at 0 HP is down, the list is in `turnCmp` order, `reached` is consistent, `next` never lands on a down combatant, no turn starts twice in a round, `parseEncounter` round-trips the fight, the input is never mutated, a fight empties to setup only by `remove` (encounter-model.test.ts:11-47). Two replays of bugs it found (102-118). Took 2.9 s here |
| `tests/models/fight-play.ts` | (shared) | The seeded generator `rng` (mulberry32, 17-28), a mixed party of two local hunters, a remote, a shadow and three monsters (36-42), `world()` that carries out sheet effects (45-62), `randomCommand` over every command type (70-121). The fight chart (`scripts/charts/fight.ts`) plays the same commands |
| `tests/use.test.ts` | 24 | `outcomesOf` per op kind, tiers, percents, full heals, which ops a use counts, words, `outcomesUnseen`, `usedLine`, `outcomeOp` |
| `tests/status.test.ts` | 51 | Stacking and stronger-wins (13), tick order (63), name lookup, sources, `describe`, `sanitizeOps`, tiered ops and percents (167-300) |
| `tests/statuses.test.ts` | 11 | Every built-in status (28-57); the rank-bonus rule for check, attack and AC mods (66-76); Burning above Bleeding above Poisoned; Burning 0.4 to 0.7 of a same-rank hit, with the hit hard-coded `[5.5, 14.5, 27.5, 44.5, 63, 84]` from the phase 4 audit (85-93); the chips |
| `tests/status-sim.test.ts` | 8 | The phase 4 balance bound (below) |
| `tests/ability.test.ts`, `tests/monsters.test.ts` | 2, 22 (the per-seed block runs once a seed) | Ability text parsing; every seed, `statBlock` against the rank table and boss and elite factors (monsters.test.ts:85-100), `parseMonster` bounds |
| `tests/vitals.test.ts`, `tests/rules.test.ts`, `tests/paths.test.ts` | | Life table and rests; the two `STAT_KEYS` must be equal (rules.test.ts:14-19), every rank table has every rank, the monster table rises with rank in every column (rules.test.ts:32), fatigue thresholds in order (56); perk budgets (paths.test.ts:26-44) |

The brief names `docs/agent-handoff/p4/status-sim.test.ts`; the file is `tests/status-sim.test.ts`. No other simulation is under `tests/`.

### 5.2 How the phase 4 simulation plays a fight

- It calls the real `reduce` for every change: `add`, `rollInitiative`, `applyStatus`, `changeHp`, `next` (status-sim.test.ts:70-75, 88-102). It fails on any `refused` effect (72).
- It rolls with the seeded `rng` from fight-play.ts and its own dice parser (33-42). Initiative uses `initiativeNeeds` and `g.int(1, 20) + mod` (89).
- The hunters' attack is rolled in the test, outside the reducer: a d20 against the monster's AC with a natural 1 and 20 rule, then `changeHp` (82-86). The build's attack and damage per rank are hard-coded from the audit (`BUILD`, 21-25: E +3 1d8+1, C +26 1d10+22, S +85 2d6+77).
- Each hunter is the same `HunterView` with 100 HP and AC 15 (63); the monster never acts, so hunters never take damage; no MP, skill or `use` command is played.
- Status ticks are carried out as the edge does: a `rollTick` on the monster is rolled and sent back as `changeHp` (77-81).
- It plays 400 fights per row, 3 ranks (E, C, S) by 2 targets (boss, normal) by 3 parties, 7,200 fights, and prints mean rounds, standard deviation and the ratio to the attackers (115-124). It took 1.5 s here. Its bounds are tests only at C and S (128-149).

What a three-archetype simulation can reuse: `rng` and `cid` (fight-play.ts), the dice parser and `monsterOf` (status-sim.test.ts:33-53), the `send` and `carryOut` loop over the real reducer (70-81), `measure` with mean and standard deviation (107-113), and the pattern of bounds written as tests by lifetime. What it lacks for the rework: monsters that attack, hunters that take damage and can go down, the `use` command, MP and fatigue, stats on a combatant, two parties of hunters against each other (the reducer has no sides: `targetsOf` and `foesOf` in combat.js:260-263 decide sides by `kind`), and a per-combatant view (one `HunterView` serves every hunter, 63-64).

### 5.3 Lint rules that guard the fight

From `tests/lint.test.ts`:

- "only the combat dispatcher writes the fight" (52-67): the one line `d.encounter = r.enc;` in combat.js; no other view or edge line assigns, pushes or sorts into `encounter`.
- "src/core imports nothing from src/edge or src/views" (29), "src/core does not touch the browser, storage or the network" (34), "src/core has no module-level let" (47): the reducer stays pure.
- "only src/core/hunter/vitals.ts changes a hunter's HP, MP, fatigue, life or collapse" (144): `writeSheet` goes through vitals functions.
- "only parseItem builds an item from outside data, and only parseMonster a monster" (223).
- "a view sends a room event made by the constructor" (85) and "only src/core/protocol.ts makes a room event id" (92) for the `hp`, `status` and `used` messages.

No lint rule stops a view from computing a fight number (AC, to-hit, damage) or rolling: those live in combat.js and hunter.js today (section 6).

### 5.4 Browser tests that touch a fight

Names and test counts; how many of each file's tests start a fight was not counted. Files that name initiative, `combat.add`, `startFlow` or the encounter: `combat-turns.e2e.ts` (11, the fight screen's own file), `table-session.e2e.ts` (7, the players' table during a fight), `character.e2e.ts` (20), `custom-skills.e2e.ts` (7, skills used in a fight), `used.e2e.ts` (6, a player's `used` report applied), `makers.e2e.ts` (22, the enemy maker), `gates-quests-dailies.e2e.ts` (21, a gate's fight), `customization.e2e.ts` (8), `save.e2e.ts` (8), `sharing.e2e.ts` (6). `layout.e2e.ts` (5) opens the combat screen and checks its layout (layout.e2e.ts:4-11).

## 6. Where the rework cuts

### 6.1 Part by part

| Part | Must change | Can stay | What in today's design fights it |
|---|---|---|---|
| Timeline by speed | `Running.round`, `currentId`, `reached` (enc-types:28-35); `Order.init`, `tie`, `initMod`; `turnCmp`, `sortTurnOrder` (enc-types:120-121); `forwardFrom`, `next`, `prev`, `landOn` (enc:60-92); `rollInitiative`, `setInitiative`, `setShareInit`, `initiativeNeeds`, `InitRoll` | `startTurn` as the one place a turn begins, with `turnStarted` and `rollTick` effects (enc:43-58) | A round is one pass of a sorted array. Status `rounds` count the bearer's turns (status.ts:284-292), so a faster combatant's statuses end sooner in time. Skill cooldowns tick on each own turn (skills.js:91). The player's turn cue keys on `round` and `currentId` (table.js:260). The log prefix `R<n>` (enc:32), `Summary.rounds` and the end window (enc:346; combat.js:461, 474), the model test's "no turn starts twice in a round" and "list in turnCmp order" (encounter-model.test.ts:25, 34), the chart's "rolls initiative" arrow, and the phase 4 bounds in rounds all assume rounds |
| Positions and movement | A new field on every combatant kind and in `parseCombatant` (encounter-parse.ts:56-87); `EncounterRow` and its parser (protocol.ts:279-281, 311-321); a command | The command and effect pattern; `parseCombatant` as the one reader | No position exists anywhere. A local hunter's row holds only `hunterId` (enc-types:48), so per-fight state for a hunter must be added to that row. The encounter doc is capped at 16,384 characters (server.ts:200) and a player may send no fight message (section 4.2) |
| Land-time avoidance | `Op`, `Skill`, `SkillDef`, `ItemDef` need wind-up, travel and shape (status.ts:15-38; save.ts:89-103; skills.ts:23-25; items.ts:29-33); monster ability text has no fields for them (ability.ts:5-11) | `parseAbility`'s text-to-buttons idea for old text | The hit decision is a d20 against AC rolled in the view (combat.js:395-399); `Skill.attack` is a boolean and `target` is only `self` or `other` (save.ts:91). Twelve seed abilities name a save and 21 a distance in text only (section 3.5) |
| Eight stats | Both `STAT_KEYS` (rules.ts:11; save.ts:51), `STATS`, `Stats`, `newStats`, `PERK_KEYS`, `PERK_VALUE`, every bonus parser, the path table, `SEEDS` and its positional `S(str, dex, con, int, wis, cha)` (monsters.ts:25), `statBlock` stats, the starter hunters, six label maps, `capacityStat: 'int'` (rules.ts:70), the rules reference text | `rules.test.ts:14` already fails when the two lists differ | `mod` is linear and stats have no cap (rules.ts:163; save.ts:474-479), so an S hunter's invested stat gives +76 (section 2.6). Monster rows in a fight carry no stats (enc-types:40-43), and `HunterView` carries none (enc-types:58) |
| Armor, Resist, penetration | Every `ac`: `HunterView`, `Monster`, `Shadow`, `Remote` rows, `syncRemote`, `ModStat` (status.ts:10), `Perk`, `ItemBonus`, `rankTable` and `boss` (rules.ts:25-32), the save's `Shadow` and `CodexInfo` (save.ts:109, 185), the codex doc (protocol.ts:292), the quick line and custom form (combat.js:332, 885), "(AC n)" in pickers | | `Outcome` damage is a final whole number with no type (use.ts:8); `changeHp` takes a signed delta (enc-types:71). A player's `used` message carries final numbers rolled on the player's phone (protocol.ts:167-169), so reduction on the GM side needs the type to travel with the outcome |
| Fatigue and mana | `Skill.mpCost` is the only cost (save.ts:90); paying is in the view (skills.js:44-57) | `Vitals` and its functions (vitals.ts:91-129); the lint rule that only vitals.ts changes them (lint.test.ts:144) | Nothing spends fatigue; fatigue is a fixed 0 to 100 (vitals.ts:111) and acts on checks only. Monsters and shadows have no MP or fatigue (enc:258, 268); a monster skill's cost is text (combat.js:304-305). A rest is only a sheet button (hunter.js:285-290) |
| Typed formulas | Quantities are dice text checked by `DICE_RE` (status.ts:72-73), six tiers, or a percent; `outcomesOf` takes only the tier and the target's max HP (use.ts:25) | `atTier` as the one resolver; one parser per kind | The reducer never rolls (enc:1-3) and every roll is in a view (section 1.4), so a formula that reads both sides' stats must be read where the stats are. The reducer sees no stats today |
| Channels | `Status` is `{ key, rounds, def, source }` (status.ts:51); `tickStatuses` only counts down | Stronger-wins `applyStatus` | A count that grows has no field; a local hunter's statuses live on the sheet, everyone else's on the row (enc:37), so a hunter's channel would be a sheet write per turn. `RowStatus.rounds` is 1 to 999 |
| Taunt and threat | Targeting is in the view: `askTarget`, `pickTarget`, `pickFoe`, `targetsOf`, `foesOf` (combat.js:260-263, 385-393) | | The fight has no sides; the view decides friend and foe by `kind`. `use` accepts any `by` and `on` at any time (enc:283-317) |
| Stagger, shields, intent | New fields; HP for a hunter is `Life` (vitals.ts:14-18) | `boss` on the monster row (enc-types:41) | A shield over a hunter's HP crosses the vitals rule (lint.test.ts:144). Players see a monster only as a `band` (protocol.ts:281) |

### 6.2 Every place a view computes or rolls a fight number

- `hunter.js:99-128`: `bonusOf` and `derived()`: stats with bonuses, `mod`, max HP, max MP, AC, initiative, check bonus, carry, skill DC. Also used for remote hunters on the GM phone (combat.js:152-156).
- `inventory.js:73-87`, `skills.js:21-32`: gear and passive bonuses summed.
- `combat.js:57-62` `live()`: a monster's AC with status mods.
- `combat.js:188-197`: the initiative d20 and the `Math.random()` tie.
- `combat.js:229-255`: a hunter's to-hit, damage dice and stat, "crits double the dice" as text only.
- `combat.js:257-286`: a monster's attack bonus (`atk + status atk + status check`), damage expression, hit against AC, crit as a second damage roll, the pending damage.
- `combat.js:309-322`: ability text dice and Apply buttons.
- `combat.js:395-411`: `toHit` and `sendUse`, natural 20 and 1.
- `combat.js:106-117`: a status tick rolled and sent back.
- `combat.js:260-263, 385-393`: who may be targeted.
- `combat.js:557`: the HP band players see.
- `skills.js:44-57, 91`: MP cost, cooldown set and ticked, the skill's dice.
- `dice.js:61-113`: the dice engine, crit and fumble, a check with fatigue disadvantage.
- `hunter.js:488`: the death save d20. `shadows.js:12, 50`: extraction DC and roll. `custom.js:275-280`: Auto point placement. `effects.js:23-60`: ops rolled on a hunter outside a fight.

### 6.3 Other traps

- Two homes for a hunter's fight state: a local hunter's statuses and vitals are on the sheet and reach the reducer through `Ctx` (enc-types:58-59); a remote's are on the row and copied from its sheet by `syncRemote` only when fresh (combat.js:573-582).
- Balance numbers are hard-coded in tests: `HIT` in statuses.test.ts:87 and `BUILD` in status-sim.test.ts:21-25 both come from the phase 4 audit. The status curves tie check, attack and AC mods to `rankBonus` (statuses.test.ts:66-76), a d20 rule.
- A GM's rule overrides are checked against the shape of `RULES` (rules.ts:127-146): a rule key that the rework removes is refused at load, and a new key is overridable with no code.
- `MAX_OUTCOMES` is 8 for a use (use.ts:15) and a player's `used` message (protocol.ts:229).
