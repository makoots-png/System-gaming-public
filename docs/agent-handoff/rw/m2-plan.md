# Milestone 2, the wiring wave: the plan

Written Nov 13 by a read-only planning helper from `brief-m2-plan.md`. The lead writes each unit's brief from this file. Every choice the design, the notes or the brief left open is marked **decided here**; the lead may overrule any of them. Line numbers are as of commit d84c012.

The shape in one paragraph: six green units land first (P0 to P6: the gaps in the new fight, and new pure modules the wave calls). Then the wave: nine units in sequence in the main tree (W1 to W9), red from the first commit of W1 to the end of W9, one push at its end. The old fight modules stay in the tree, unused, until W8 deletes them with their tests, so the app bundles at every step and each view unit can run its own browser files.

## 1. The target

### 1.1 Who owns what after the wave (new rows of "Where things live")

| Question | The one place | Test to copy |
|---|---|---|
| A stat, the curves `eff` and `capped` | `src/core/stats.ts` (`STAT_KEYS` lives only here; `rules.ts` imports it) | `tests/stats.test.ts` |
| A derived number (HP, speed, armor, the 26 of `Sheet`) | `src/core/hunter/derive.ts` | `tests/derive.test.ts` |
| What a hunter's sheet is built from (stats, level, worn gear, title, path picks, passives), a check's bonus, Auto spend | `src/core/hunter/sheet.ts` (new, P2) | `tests/sheet.test.ts` |
| Who acts next, a tick, a cost | `src/core/combat/timeline.ts` | `tests/timeline.test.ts` |
| A place, a distance, a shape, a path | `src/core/combat/space.ts` | `tests/space.test.ts` |
| What one use does | `src/core/combat/resolve.ts` | `tests/resolve.test.ts` |
| A formula | `src/core/formula.ts` | `tests/formula.test.ts` |
| A fight | `src/core/combat/fight.ts`; `send()` in `src/views/combat.js` stores it | `tests/fight.test.ts`, `tests/fight-model.test.ts` |
| A status and its ops | `src/core/combat/effect-ops.ts`, built-ins in `src/core/registry/statuses.ts` | `tests/effect-ops.test.ts`, `tests/statuses.test.ts` |
| An ability | `src/core/combat/ability-types.ts`; kinds `src/core/registry/ability-kinds.ts`; built-ins `src/core/registry/abilities.ts` (new, P1) | `tests/abilities.test.ts` |
| A fight row made from a hunter, a remote sheet, a monster or a shadow | `src/core/combat/rows.ts` (new, P5) | `tests/rows.test.ts` |
| Every number the fight screen draws (order ahead, a card, the targets an ability can aim at, a step toward or away) | `src/core/combat/fight-view.ts` (new, P3) | `tests/fight-view.test.ts` |
| What the room's fight doc holds | `fightDoc` in `src/core/combat/fight-doc.ts` (new, P4); its reader in `DOCS` of `src/core/protocol.ts` | `tests/fight-doc.test.ts`, `tests/protocol.test.ts` |
| The dice a fight asks for | `src/edge/roll.ts` (new, P6); a view never rolls a fight number | `tests/roll.test.ts` |

Rows that go: "A fight" (`encounter.ts`), "A status" (`status.ts`) and their tests. Rows that stay as they are: save, role, upgrade, protocol, room events, rules, progress, vitals, penalty, chips, job chain, gate, link, push, connection, invite.

### 1.2 A `Hunter` in a schema 4 save

`SCHEMA = 4` (today 3, `save.ts:189`), stored under `hunter-system-v4` (`SAVE_KEY`, `store.ts:10`). A stored text under `v3`, `v2` or `v1` is put in the backups with the notice "This save is from before the new combat rules. It is kept in Backups; the app starts a new campaign." and the app opens `freshSave` (**decided here**: the design's section 15 and `combat-rework-notes.md:44`; see risk 1). `fromV1`, `fromV2`, `moveStatuses`, `fromOldHp`, `fromPointsCounter` and the schema 3 repair paths are deleted.

`Hunter = Progress & Vitals & { ... }`, every field:

- From `Progress` (`progress.ts:9-20`): `level`, `xp`, `peakLevel`, `bonusPoints`, `spent`. New: the points a hunter may spend count `RULES.fight.creationPoints` (12) at level 1; `levelPoints` adds them (**decided here**; design 2.1 "12 creation points at level 1").
- From `Vitals` (`vitals.ts`): `life`, `mana` (was `mp`), `fatigue`, `collapsed`. `Maxima` becomes `{ hpMax, manaMax, fatigueMax }` from the `Sheet`; the fatigue thresholds (`RULES.fatigue`, today 50, 80, 100 of a fixed 100, `vitals.ts:110-111`) are read as percents of `fatigueMax` (**decided here**; design 2.2 "keeps its thresholds as shares").
- Kept as they are: `id`, `name`, `job`, `rank`, `gold`, `titleId`, `quests`, `equipped`, `daily`, `penalty`, `jobChain`, `notes`, `updatedAt`, `emblem`, `color`, `loadouts`, `build`, `boons`.
- Changed: `stats` and `statsLocked` hold the eight keys (`newStats` gives 10 each). `hpAdj` stays and `mpAdj` becomes `manaAdj`; both reach `derive` as perks on `hpMax` and `manaMax` (**decided here**: no GM feature is lost). `conditions: SheetStatus[]` where `SheetStatus = { key: StatusKey; def: StatusDef; source: Source; rounds: number | null }` with the new `StatusDef` of `effect-ops.ts`. `titles: Title[]` whose `bonus` is a `Bonus` of `derive.ts` (eight stats, `hpMax`, `manaMax`). `skills: Skill[]` where `Skill = { id, name, level, label, desc } & ({ type: 'active'; ability: Ability } | { type: 'passive'; bonus: Bonus })`. `items: Item[]` (section 3.3). `shadows: Shadow[]` with `Shadow = { id, name, monster, rank, archetype, grade, hp, summoned, notes }`; its kind comes from `grade` (Normal normal; Elite, Knight, Elite Knight elite; Commander, Marshal boss; **decided here**) and its max HP from `monsterSheet`.
- Gone: `mp`, `mpAdj`, the six keys, `Skill.mpCost`, `cooldown`, `cdLeft`, `dice`, `effects`, `target`, `attack`; `Item.heal`, `restoreMp`, `fatigue`, `dice`; `Shadow.hpMax`, `ac`, `atk`, `dmg`, `level`, `baseHp`.

The save's `encounter` becomes `fight: Fight | null`, read by `parseFight(raw, rules)` (`fight-parse.ts:297`). `Monster` (the GM's bestiary) becomes `{ id, name, rank, type, archetype, kind, tweak: { hp?, stats? }, abilities: Ability[], notes: string[], xp, extractable, desc, statuses: StartStatus[], loot, auto? }`; `hp`, `ac`, `atk`, `dmg`, `init`, `stats`, `boss`, `elite` go (`save.ts:136-142`). `CodexInfo` holds `{ hpMax, armor, resist, speed, abilities }` in place of `hp`, `ac`, `atk`, `dmg` (`save.ts:185`).

The entity types move out of `save.ts` into the registry that owns them (`Item` to `items.ts`, `Skill` to `skills.ts`, `Monster` to `monsters.ts`), and `save.ts` re-exports them (**decided here**: today `items.ts` builds `Omit<Item, 'id'>` from a type in `save.ts`, a cycle that would force the save and every registry into one unit).

### 1.3 What the room carries

The `encounter` doc (`protocol.ts:275-285`) becomes the fight doc, built by `fightDoc` (P4):

- The fight: `id`, `by`, `active`, `ended`, `at` (a time stamp), `now`, `currentId`, `ahead` (the next 8 ids from `ahead(rows, 8)`), `grid: { w, h }`, the last 5 log lines.
- A row: `id`, `name` (60), `kind`, `side`, `key` (a hunter's sheet key or null), `place: { x, y }`, `at`, `speed`, `band`, exact `hp` and `hpMax` for a hunter or shadow, `statuses` (12 at most: `key`, `label`, `color?`, `left`, the rounds left with one decimal or null), `shield` (amount or null), `down`; a monster adds `intent: { name, target } | null` and `stagger: { fill, max } | null`.
- Bounds: rows 32 (design 5.4); the fight itself keeps `MAX_ROWS` 60 (`fight-types.ts:113`).

Messages (`Payloads`, `protocol.ts:175-178`):

| Type | Who | Payload | Applier |
|---|---|---|---|
| `step` (new) | a player, `ownSheet` | `{ by, to: { x, y }, at }`, `x` and `y` 0 to 63 | `null` on a player's phone; the GM's `combat.js` sends `move` when `by` is `currentId` and `at` is `now` |
| `cast` (new) | a player, `ownSheet` | `{ by, ability (40), aim: { x, y } or a combatant id, at, dice: number[] (8, 0 to 999) }` | `null`; the GM's phone sends `act` with the player's dice for every target and rolls each target's reaction d20 itself |
| `vitals` (new) | GM only | `{ to, hp, mana, fatigue, statuses: SheetStatus[] (12), reason }`, totals | `once: true`; sets HP, mana, fatigue and conditions through `vitals.ts` |
| `hp` | GM only | `{ to, hp, mana, fatigue, reason }` deltas (the board); `mp` renamed `mana` | as today |
| `status` | GM only | `StatusGrant = { key, def, source, rounds }` with the new def | as today |
| `used` | a player | `{ by, who, what, name, text, target, tell }`; `outcomes` goes | `null` |
| `roll`, `revive`, `award`, `quest`, `system`, `questUpdate`, `chain` | as today | as today | as today |

`cast` drops the design's `react` (**decided here**, design 5.5 differs): the reaction d20 is the target's die, which the GM's phone holds, and one die from the player cannot serve several targets of a blast. `cast` gains `at` so the stale check of 5.5 can run. A player's phone keeps sending nothing else that changes the fight.

The `codex` doc's entry carries `hpMax`, `armor`, `resist`, `speed` and 4 ability names in place of `hp`, `ac`, `atk`, `dmg` (`protocol.ts:288-290, 340-347`).

### 1.4 What each view imports from core

- `combat.js`: `reduce`, `can`, `stateOf` from `fight.ts`; `needs` from `resolve.ts`; the screen model from `fight-view.ts`; rows from `rows.ts`; `fightDoc` from `fight-doc.ts`; dice from `src/edge/roll.ts`; `fightAward`, `transition` from `gate.ts`; `lootOf`. Nothing else from `combat/`.
- `table.js`: the doc's types from `protocol.ts`; `stepToward`, `stepAway`, `aims` from `fight-view.ts` (the same code the GM's screen draws with).
- `hunter.js`, `custom.js`, `dice.js`, `shadows.js`, `inventory.js`, `gm.js`: `sheetOf` through `sheet.ts`'s `hunterSheet(h, R)`, `checkBonus`, `STAT_KEYS` and `STAT_LABELS` from `stats.ts`, `vitals.ts` functions.
- `maker.js`, `forge.js`, `bestiary.js`, `skills.js`, `effects.js`, `rulesref.js`, `workshop.js`, `loot.js`: `Op` and `StatusDef` from `effect-ops.ts`, `parseFormula` and `printFormula`, `KINDS` and `abilityOf` from `ability-kinds.ts`, the registries.
- No view imports `encounter*.ts`, `use.ts`, `status.ts` or `ability.ts` (they are deleted in W8), and no view calls `Math.random`, `derive`'s internals or a `Sheet` formula of its own.

## 2. Every caller of what dies

Built with `grep -rnE "<name>" src tests scripts server.ts` and checked per name with `bun run deps -- <file or member>` (the helper of each unit reruns both; counts below are from grep at d84c012).

| Dies | Read today by | Instead | Unit |
|---|---|---|---|
| `encounter.ts`, `encounter-types.ts`, `encounter-parse.ts` | core: `save.ts:6-7`, `protocol.ts:14,19`, `api.ts:19`, `events.ts:5`, `registry/monsters.ts` (`CombatantId`, `MonsterRow`, `rankTier`); views: `combat.js:6`, `forge.js`, `gm.js`, `hunter.js` (`gmSource`); tests: `encounter.test.ts`, `encounter-model.test.ts`, `models/fight-play.ts`, `applied.test.ts`, `monsters.test.ts`, `lint.test.ts`; `scripts/charts/fight.ts` | `fight.ts` and `fight-types.ts`; `gmSource` becomes `{ id: null, tier }` (`Source` of `effect-ops.ts`) | callers W2 to W7, deleted W8 |
| `use.ts` (`outcomesOf`, `outcomeText`, `usedLine`, `MAX_OUTCOMES`, `parseOutcome`, `Outcome`) | `protocol.ts:15,18`, `api.ts:11`, `combat.js:12`, `inventory.js`, `skills.js`, `table.js:310-311,334`, `uses.js`; `use.test.ts` | a use in a fight is `act` (GM) or `cast` (player); `Outcome` of `ability-types.ts`; `uses.js` writes a line from `name` and `text` only | W3, W6, deleted W8 |
| `status.ts` (`describe`, `statusDef`, `sanitizeDef`, `sanitizeOps`, `mods`, `applyStatus`, `FULL`, `MAX_TIER`, `STATUS_KEY_RE`, `atTier`, `validDice`, `slug`) | core: `rules.ts:5`, `save.ts:4-5`, `protocol.ts:5-6`, `api.ts:7`, `effects.ts`, `pack.ts`, `rewards.ts`, `chips.ts`, `registry/{items,skills,monsters,statuses}.ts`; edge: `room-events.ts:4`, `edge/rules.ts`; views: `combat.js`, `effects.js`, `forge.js`, `gm.js`, `hunter.js`, `inventory.js`, `maker.js`, `reward-editor.js`, `rulesref.js`, `skills.js`; tests: `status.test.ts`, `statuses.test.ts`, `items.test.ts`, `skills.test.ts`, `pack.test.ts`, `status-sim.test.ts` | `effect-ops.ts` (`Op`, `StatusDef`, `applyStatus`, `atTier`), the status def reader `parseStatusDef` of `fight-parse.ts` exported for the save and the protocol, and `describeStatus(def, tier)` added to `effect-ops.ts` in W1 | W1 to W7, deleted W8 |
| `ability.ts` (`parseAbility`) | `combat.js:7`; `ability.test.ts` | typed `Ability`s; a seed's text lines that are no ability become `notes` drawn as text (**decided here**) | W5, deleted W8 |
| `mod` (`rules.ts:291`) | `hunter.js:3,112`, `rulesref.js:2,78`, `maker.js` (4), `bestiary.js:205` (inline `Math.floor((v - 10) / 2)`) | `checkBonus` of `sheet.ts`: `floor(x(stat) / 2) + rankBonus - fatigue penalty - penalty`, so today's DC table keeps its meaning (`x` is close to `s - 10` at low scores) (**decided here**) | W4, W7 |
| The six `STAT_KEYS`, `STATS`, `newStats`, `S(...)` (`rules.ts:11-15`, `save.ts:193`, `monsters.ts:25`) | `save.ts:18,474,656`, `monsters.ts:6,102`, `items.ts:9,21`, `paths.ts:4,12`, `edge/rules.ts:5,26`; views `hunter.js` (21 hits), `combat.js` (28), `gm.js` (13), `shadows.js` (10), `bestiary.js` (9), `table.js` (9), `reward-editor.js` (7), `custom.js`, `dice.js`, `loot.js`, `skills.js`, `starter.js`, `rulesref.js`, `maker.js` | `STAT_KEYS`, `StatKey`, `STAT_LABELS` of `stats.ts`; short labels `STR AGI VIT INS DIS PRE POW CTL` added there (**decided here**) | W1, W4 to W7 |
| `PERK_KEYS`' `ac`, `PERK_LABELS.ac`, `Perk` (`rules.ts:305-309`), `PERK_VALUE.ac` (`paths.ts:18`) | `custom.js:3`, `hunter.js:3`, `paths.ts`, `skills.ts:77`, `items.ts:123`, `rewards.ts:62` | `PERK_KEYS = [...STAT_KEYS, 'hpMax', 'manaMax']`, `PERK_VALUE = { stat: 1, hpMax: 1/10, manaMax: 1 }` | W1 |
| `rankTable`'s `hp`, `ac`, `atk`, `dmg`, `init`; `boss`, `elite` (`rules.ts:22-30`) | `monsters.ts:53-65` (`statBlock`), `combat.js:165`, `bestiary.js:225-230`, `rulesref.js:126` | `RULES.fight.kinds`, `monsterSheet`; `rankTable` keeps `dc`, `xp`, `breakDays`; `boss.xp`, `elite.xp` move to `fight.kinds.*.xp` | W1, W5, W7 |
| `hp`, `mp`, `formulaHpMax`, `formulaMpMax` rules (`rules.ts:17-18, 301-302`) | `save.ts:32,224,440`, `hunter.js:3`, `rulesref.js` | `sheet.ts` `hunterSheet(h, R).hpMax`, `.manaMax` | W1, W2, W4 |
| `derived()` (`hunter.js:109-126`) and `app.api.hunter.derived` | `combat.js` (6), `custom.js` (2), `dice.js` (1), `effects.js` (2), `gm.js` (2), `hunter.js` (9), `inventory.js` (1), `shadows.js` (3), `skills.js` (1), `table.js` (3); type `Derived` in `api.ts:28-33` | `app.api.hunter.sheet(h)` answering `{ stats, sheet, hp, mana, fatigue, check(stat) }` from `sheet.ts` (the view only asks) | W4 |
| `bonuses` (`hunter.js:102`, providers `inventory.js:73-87`, `skills.js:21-32`; `Bonuses` in `api.ts:35`) | `hunter.js` | `buildOf` in `sheet.ts` reads worn items, title, path picks and passives itself | W4 |
| `capacityStat: 'int'` (`rules.ts:70`) | `shadows.js:10` | `Sheet.shadows` (design 2.2) | W1, W4 |
| `skillDC`, `passivePerception` | `hunter.js:124,623`, `rulesref.js:109` | gone; the sheet shows `checkBonus` per stat (**decided here**: a save DC is replaced by Will in a fight) | W4 |
| Skill cooldowns on the sheet (`cdLeft`, `skills.js:91` on `combat:turn`, `custom.js:122`) | `skills.js`, `custom.js`, `character.e2e.ts:319` | `readyAt` on the fight row | W6 |
| Item `heal`, `restoreMp`, `fatigue`, `legacyOps` (`effects.ts:14`) | `items.ts`, `effects.ts`, `inventory.js`, `loot.js`, `maker.js` | effect ops (`heal`, `mana`, `fatigue`) | W1, W7 |

The numbers of inventory 6.2, each with its home after the wave:

| Today | After | Unit |
|---|---|---|
| `hunter.js:99-128` `bonusOf`, `derived()` | `sheet.ts` + `derive.ts` | W4 |
| `inventory.js:73-87`, `skills.js:21-32` bonus sums | `buildOf` (`sheet.ts`) | W4 |
| `combat.js:57-62` `live()` AC | the row's `sheet` | W5 |
| `combat.js:188-197` initiative d20 and `Math.random()` tie | `rollOpenings` (`edge/roll.ts`), `start`/`add` openings | W5 |
| `combat.js:229-255` hunter to-hit and damage | the hunter's abilities (weapon attack from `rows.ts`), `act` | W5 |
| `combat.js:257-286` monster attack, hit against AC, crit | the monster's abilities, `resolve` | W5 |
| `combat.js:309-322` ability text dice and Apply | typed abilities; text is notes | W5 |
| `combat.js:395-411` `toHit`, `sendUse` | `needs` + `rollNeeds` + `act` | W5 |
| `combat.js:106-117` status tick roll | `rollSettle` effect, `settle` command, dice from `roll.ts` | W5 |
| `combat.js:260-263, 385-393` who may be targeted | `aims` (`fight-view.ts`) | W5 |
| `combat.js:557` HP band | `fightDoc` | W5 |
| `skills.js:44-57, 91` MP cost, cooldown, dice | the ability's cost in `resolve`; `readyAt` | W6 |
| `dice.js:61-113` engine, crit, fumble, check with fatigue disadvantage | the engine stays (table dice, not fight numbers); the check's bonus from `checkBonus` | W4 |
| `hunter.js:488` death save d20 | stays (a table roll, `vitals.ts` decides) | none |
| `shadows.js:12, 50` extraction DC and roll | DC stays; bonus `checkBonus(h, 'pre')` (**decided here**: shadows are Presence's) | W4 |
| `custom.js:275-280` Auto placement | `autoSpend(h, path)` in `sheet.ts` | W4 |
| `effects.js:23-60` ops rolled on a hunter outside a fight | the same, on the new ops; dice through `roll.ts` | W7 |

## 3. Content

Every rule below is applied to every entry by the unit that owns the registry (W1, except `starter.js`, also W1). Each registry keeps its per-entry test: a loop over the table that checks every entry is well formed (`tests/<registry>.test.ts`). One new per-entry rule (**decided here**, risk 3): every built-in ability's expected dealt damage on a same-rank tank is at most 60% of its max HP, read with `resolve` at average dice, the bound of design section 6.

The old-to-new stat map, used wherever a rule says "map": `str` Strength, `dex` Agility, `con` Vitality, `int` Power, `wis` Instinct, `cha` Presence (today's own aliases, `rules.ts:14-15`). Paths override it (3.4).

### 3.1 Statuses (14, `statuses.ts:10-29`)

Rule: a status becomes an `effect-ops.ts` `StatusDef` with the same key, label and a reworded desc.

- A per-round `damage` keeps its dice per tier as formulas, `when: 'turn'`; Bleeding physical, every other magical.
- A d20 modifier (`mod atk`, `mod check`) of N becomes `stat` on the stat the d20 now compares, amount 4N: attacks use Accuracy (Control), checks and fear use Discipline. Reason: the reaction edge is a quarter of the gap (design 3.1 rule 8a), so 4 points move the die by about one face, the weight today's +1 had.
- `mod ac` becomes `speed` for Slowed and Hasted (tiers 20, 25, 30, 35, 40, 50 percent, signed) and `stat agi` at 4N for Prone (lying down slows the dodge).
- `mod dmg` of N becomes `stat str` and `stat pow`, each `round(N / 0.6)` (power is `0.6 * eff`).
- "Cannot act" is `hold`; "cannot move" or "speed 0" is `root`. A status with no number stays with no ops.

| Entry | Becomes |
|---|---|
| bleeding | `damage physical` 1d4, 1d6, 2d6, 2d8, 3d8, 4d8 a round |
| poisoned | `damage magical` 1d4 to 1d12 a round; `stat ctl` -8, -12, -16, -20, -24, -32 |
| slowed | `speed` -20, -25, -30, -35, -40, -50 |
| stunned | `hold` |
| restrained | `root`; `stat ctl` -8 to -32 |

Not fitting the rule: Paralyzed (`hold` and `root`), Frightened (`stat dis` 4N, desc "Will falters while the source is in sight"), Bloodlust (`stat dis` 4N and the damage rule), Invisible and Stealth (no ops, as today), Hasted ("one extra action" becomes `refund { pct: 50, chance: 25 }` beside the speed; **decided here**).

### 3.2 Monsters (22 seeds, `monsters.ts:28-49`)

Rule: a seed becomes `[slug, name, rank, archetype, kind, tweak, abilities, notes, desc]` (**decided here**: kind beside archetype, not in the tweak).

- Archetype: the largest of today's `str` (brute), `dex` (skirmisher), `int` (caster); a tie is brute.
- Kind: `boss: true` boss, `elite: true` elite, else normal.
- Tweak: `hp` stays a factor; `init: N` becomes `stats: { ins: 4N }` (the opening bonus is a quarter of Instinct's points); `ac`, `atk`, `dmg` are dropped (archetype and kind carry them); `xp` and `extractable` stay.
- Abilities: the archetype's default attack (brute a strike, skirmisher a shot, caster a curse, from P1). Then each text line: a line naming a range in feet and an attack becomes a `shot` with `range = ft / 5`; a cone, burst, line or "within N ft" with a DEX save becomes a `blast` (radius `ft / 10`, at least 1); a WIS or CON save that applies a status becomes a `curse` with `applyStatus`; "+N AC" becomes a `support` on self with a `shield`. Every other line (immunity, resistance, pack tactics, flight) is a note.

| Seed | Becomes |
|---|---|
| goblin (E) | skirmisher, normal; abilities: Shortbow (shot); notes: Nimble Escape, Pack Tactics |
| goblin-shaman (E) | caster, normal, hp 0.7; Hex Bolt (curse, range 6); Rally becomes a note |
| ice-elf (C) | skirmisher, normal, hp 0.8, ins +8; Frost Arrow (shot, range 24, applies Slowed 1 round); notes: Ice Veil, Flurry |
| kasaka (D) | brute, boss, hp 0.9; Bite (strike); Blue Venom Fangs (curse, Poisoned); Serpentine Coil (curse, Restrained); note: Venom Fang drops the fang |
| kamish (S) | brute, boss, hp 1.5, ins +8; Claw (strike); Dragon Breath (blast, magical, radius 9); Frightful Presence (curse, Frightened); Wing Gust (blast, Prone) |

Not fitting, with my call: multi-attacks (Cerberus "Three Heads", Ice Elf "Flurry", Gate Troll "Rend", Ant Royal Guard "Scythe Arms", Igris "Crimson Slash") become one heavy strike (cost 150, the budget's 1.5 share); summons (Cerberus "Hounds of the Gate", Baran "Dark Command", Beru "Ant King's Command") stay notes, the GM adds rows; regeneration (Gate Troll 10, Beru 25 a round) becomes a starting status `regenerating` with a per-round `heal` of that number; Hive Mind ("shares initiative") is a note; Steel Fangs ("ignore 2 AC") becomes a strike with `pen` 10% in its tweak of the ability; Lycan ties `str` and `dex` at 16 and is a brute by the tie rule.

`statBlock` (`monsters.ts:53`) becomes `monsterSheet` plus the seed's tweak; the per-entry test checks every seed's archetype, kind and that each ability parses.

### 3.3 Items (38: shop 10, loot 25, starter 3, `items.ts:36-84`)

Rule (**decided here**): an item gains `weight`, `armor`, `resist` and, for a weapon, `attack: 'strike' | 'shot'`.

- Armor and offhand by slot share of a kit (design table 2.5): chest 0.35, legs 0.2, offhand 0.15, head 0.1, hands 0.1, feet 0.1, which sum to 1, so a full set is the kit. The kit by today's `ac`: 1 light, 2 medium, 3 or more heavy. Each number is the kit's times the share, rounded half up; then armor and resist each gain the rarity's index (common 0 to mythic 5, design 2.3).
- A weapon: `attack` is shot for a bow, else strike; weight 1 for d4 and d6, 2 for d8 to d12, 4 for two or more dice; armor and resist 0. Its dice are the hunter's default attack formula, `<dice> + phys`.
- Neck and rings weigh 0. Stat bonuses map by the stat map; `mpMax` and `restoreMp` divide by 5 (rounded, at least 1) into `manaMax` and a `mana` op; `hpMax` stays.
- A consumable's `heal`, `restoreMp` and `fatigue` become `heal`, `mana` and `fatigue` ops; its other ops follow 3.1.

| Item | Becomes |
|---|---|
| Hunter's Leather (common chest, ac 1) | weight 3, armor 4, resist 5 |
| Reinforced Hunter Vest (uncommon chest, ac 2) | weight 6, armor 12, resist 3 |
| Ironhide Gauntlets (uncommon hands, ac 1, str 1) | weight 1, armor 2, resist 3, str 1 |
| Ring of Vitality (epic ring, con 5) | weight 0, vit 5 |
| Mana Potion (common, restoreMp 20) | ops: `mana` 4 |

Not fitting: Elixir of Life's `FULL` heal stays a `heal` of `FULL` (the op reads the max); Knight Killer ("cruel to armored foes") gains `penFlat` 5 beside str 2; Dented Tower Shield (starter offhand, ac 1) is a heavy offhand by intent, weight 5, armor 9, resist 3, because a tower shield is not light.

### 3.4 Paths and perks (6, `paths.ts:21-27`)

Rule: a path's `alloc` maps to the design's builds where one exists, and every perk inside the path maps its keys the way its alloc did; a key the alloc lacks maps by the stat map. `ac: N` becomes the path's second stat at 2N (PERK_VALUE.ac was 2, so the tier's budget holds). `mpMax: N` becomes `manaMax: N / 5` with `PERK_VALUE.manaMax = 1`, which keeps each tier's budget exactly. `TIER_BUDGET` stays (2, 2, 3, 3, 4, 4).

| Path | alloc |
|---|---|
| Vanguard | str 2, vit 1 (the bruiser) |
| Striker | agi 2, str 1 (the speed build) |
| Arcanist | pow 2, ctl 1 (the cannon; `wis` maps to Control here) |
| Warden | vit 2, dis 1 (a tank that resists magic; `wis` to Discipline) |
| Sovereign | pre 2, dis 1 (the support; `int` to Discipline) |

Seeker (`wis 2, dex 1`) becomes ins 2, agi 1 by the plain map. No path invests Control or Discipline first; a new path is content for later (**decided here**).

### 3.5 Skills (8, `skills.ts:30-45`) and the starter hunters' skills (6, `starter.js:8-18`)

Rule: an active skill becomes `{ type: 'active', ability }` built by `abilityOf(kind, input)` (`ability-kinds.ts:138`); a passive keeps `bonus` mapped by the stat map, `ac: N` as `vit: 2N`. The kind: `attack: true` with melee words is a strike, with ranged words a shot; a status on self is a support with `aim: 'self'`; damage at a distance with no roll to hit is a curse. Costs are the kind's (**decided here**: today's MP costs are dropped so the balance of design section 6 holds); a cooldown of N turns becomes N rounds (`N * 1000` ticks). Dice stay as the formula's dice: `recommended(kind)` with the skill's dice in place of the kind's.

| Skill | Becomes |
|---|---|
| Dagger Rush | strike, quick (70), `2d4 + phys` at the 0.7 share, cooldown 2 rounds |
| Mutilation | strike, standard, `2d6 + phys`, cooldown 3 rounds |
| Sprint | support, self, quick, applies Hasted for 1 round |
| Stealth | support, self, applies Stealth until removed |
| Bloodlust (passive) | bonus str 1 |

Not fitting: Ruler's Authority becomes a curse, physical, range 6 (30 ft); Arise and Shadow Exchange have no fight ability in M2 (Arise is the extraction on the Shadows panel; a swap of places needs the map, M3) and stay actives with `ability: null`. So `Skill` active is `ability: Ability | null` (**decided here**). Starter skills: Shield Wall a support with the kind's shield; Iron Skin passive vit 2; Marked Shot a shot with 1d6; Arc Bolt a curse with 2d6; Trailsense and Mana Sense passives with no bonus.

### 3.6 Jobs, titles, starter hunters

- Jobs (`jobs.ts:21-29`) carry no bonus: nothing to restate.
- Titles (`rules.ts:43-49`): bonuses by the stat map (Wolf Slayer str 2, One Who Overcame Adversity hpMax 20, Demon Hunter pre 2, The One Who Hunts Alone agi 2, King of Shadows pow 5).
- Starter hunters (`starter.js:8-18`): the 12 creation points split 2:1 on the design's build for the job (**decided here**). Brakk (Tanker) vit 18, str 14, heavy-ish kit through the Tower Shield; Mira (Ranger) agi 18, str 14 with the Hunting Bow (shot); Eldrin (Mage) pow 18, ctl 14. Sung Jin-Woo (`starterHunter`, `save.ts:774`) keeps 10s and 12 unspent points.

## 4. The units, in order

### 4.1 How the run keeps the app bundling, and what "green for what it owns" means

- **The old fight stays in the tree, unused, until W8** (migrate the callers, then delete). Reason: `bun run build` bundles every module `MODULES` lists in `src/app.js`, and an import of a deleted file or a missing named export stops the bundle, which stops every browser test at once. So no unit before W8 deletes a file or an export a not-yet-moved view imports; the unit that moves the last importer deletes it, and W8 deletes the rest. **Invariant: `bun run build` is green after every unit.** W1a verifies once that a missing export does stop the build (rename one in a scratch copy), so the rule rests on a fact.
- **The owner map.** Every file the wave touches belongs to one unit (the lists below). A unit's check is: no `tsc` error in its own files, its named bun test files green, its named browser files green, `bun run build` green, `bun run deps -- --write` run. The commands, with `<own>` the unit's own paths as one regular expression:
  - `bunx tsc --noEmit --pretty false 2>&1 | grep -E '^(<own>)\(' ; test $? -eq 1`
  - `bunx tsc -p tsconfig.views.json --noEmit --pretty false 2>&1 | grep -E '^(<own views>)\(' ; test $? -eq 1`
  - `bun test <files>`
  - `E2E_CHROMIUM=/opt/pw-browsers/chromium E2E_PORT=3241 bunx playwright test tests/e2e/<file> --workers=1 --output=/tmp/pw-<file>`, one file at a time.
- **The red ledger.** "Red after" lists what may fail when the unit ends, and the unit that turns it green. The six old-fight test files (`encounter.test.ts`, `encounter-model.test.ts`, `use.test.ts`, `status.test.ts`, `status-sim.test.ts`, `ability.test.ts`) may fail from W1a on and are deleted in W8 with the modules they test. `tests/statecharts.test.ts` and `tests/deps.test.ts` are green after every unit (each runs `bun run charts` and `bun run deps -- --write` when it touched a machine or an import).
- Every unit commits each step (the box restarts), reports the check's last lines in `rw/notes-m2-<unit>.md`, and never pushes. The lead tags the start `m2-start` and pushes once after W9 with `bun run ci`.

### 4.2 Before the wave: green units (P0 to P6)

P0 runs in the main tree first. P1, P2 and P6 add new files only and may run at the same time as P0 in their own worktrees; P3 and P4 start after P0, P5 after P1 and P2, each in its own worktree. Each leaves `bun run test` green. Wall time about 2.5 hours.

**P0, the fight's missing pieces** (75 min, main tree). Changes `fight-types.ts`, `fight.ts`, `fight-turn.ts`, `fight-parse.ts`, `effect-ops.ts`, `derive.ts`, `scripts/charts/fight2.ts`, `tests/fight.test.ts` (about 12 new tests), `tests/models/fight2-play.ts`, `tests/derive.test.ts` (2). Adds, each a command or field with its rule: `adjust { id, hp?, mana?, fatigue? }` (the GM's hand edit, any phase, no time; notes-u4 "the GM's hand edits ... belong to the wiring"); `status { id, add?: { key, def, duration, tier }, remove?: key }` (the GM's Status window, no time, a hold on the current row ends its turn as `act` does); `Body.xp` and `Summary.xp`, the XP of the foes that went down (handoff 2b "XP ... the wiring's"); a shadow's `holder` `{ kind: 'shadow', hunterId, shadowId }` and the effect `shadowHp` (notes-u4 "a shadow's HP write-back"); `vitals` and `sendRemote` carry the row's statuses as `{ key, def, source, rounds }` with rounds left, so the sheet hears of every status (design summary 13); `Origin` of a monster gains `tweak: { hp, stats }` and `monsterSheet` applies it (design 2.4). `undo` stays out (**decided here**: notes-u4 found it undefined against effects already carried out). Check: `bun test tests/fight.test.ts tests/fight-model.test.ts tests/derive.test.ts tests/statecharts.test.ts`, `bun run charts`, `bun run test`. Reads: design 3.3, 4; notes-u4; `fight.ts` `TABLE`. Principles: model-the-domain (a command and its cells, not a flag), make-operations-idempotent (totals). Trap: a new command needs its cell in every phase of `TABLE` and an arrow in `scripts/charts/fight2.ts`.

**P1, the built-in abilities** (60 min, worktree). Creates `src/core/registry/abilities.ts` (`ARCHETYPE_ATTACKS`, `weaponAttack(item, R)`, the abilities of the built-in and starter skills by name, section 3.5) and `tests/abilities.test.ts` (per entry: parses, kind fills every field, expected dealt damage on a same-rank tank at most 60% of its max HP, read with `resolve` at average dice). Check: `bun test tests/abilities.test.ts`, `bun run test`. Reads: `ability-kinds.ts`, design 3.3, section 3.5 here. Principles: explain-the-number, test-behavior. Trap: the 60% figure is design section 6's bound; compute the tank from `split` and `kitGear('heavy')`, never from a run.

**P2, the hunter's sheet** (60 min, worktree). Creates `src/core/hunter/sheet.ts` and `tests/sheet.test.ts` (about 15): `buildOf(h, R): Build` (stats, level, worn gear as `GearPiece`s, perks from the title, the path picks, the passives, `hpAdj` and `manaAdj`), `hunterSheet(h, R)` (with the conditions through `modified`), `checkBonus(h, stat, R)` (section 2, `mod`'s row), `autoSpend(h, path, R)` (today's `custom.js:275-280`). Its input is a structural type of the schema 4 hunter fields it reads, so W2's `Hunter` satisfies it with no change. Reads: design 2.2 and 2.3, `derive.ts`, `hunter.js:98-126`, `custom.js:270-285`. Principles: boundary-discipline, minimize-reader-load. Trap: a path is read as `readonly (readonly Bonus[])[]`, not today's `R.paths` type, which W1b replaces.

**P3, the fight screen's model** (75 min, worktree, after P0). Creates `src/core/combat/fight-view.ts` and `tests/fight-view.test.ts` (about 20): `order(f, n)`, `cardOf(row, now)` (HP, mana, fatigue, shield, statuses with rounds left), `aims(bodies, by, ability, grid)` (each candidate with its distance and whether it is in range and in the shape), `stepToward` and `stepAway(bodies, by, target, stride, grid)` (the reachable tile nearest to or farthest from the target, ties by fewest steps, lowest `y`, then `x`, as rule 8a breaks them). Movement and aims take `{ id, side, place, down }` rows, so `table.js` can call them with the doc's rows. Reads: `space.ts` (`reachable`, `inShape`), `resolve.ts` rules 5 and 6. Principles: minimize-reader-load ("where does this number come from"), encode-lessons. Trap: no new rule; every number is a call to `space.ts`, `timeline.ts` or `resolve.ts`.

**The move control** (**decided here**): M2 has "Toward" and "Away" for a picked foe, a full stride or less. Reason: the default lines are 8 tiles apart (`RULES.fight.lineGap`), a strike reaches 1 tile and a stride is 3 at speed 100, so without a step no melee build can ever hit and a fight cannot be played. A dash, a free tile and the GM's drag (`place`) wait for the map in M3.

**P4, the room's fight doc** (45 min, worktree, after P0). Creates `src/core/combat/fight-doc.ts` (`FightDoc`, `FightDocRow`, `fightDoc(f, R, o)`, `DOC_ROWS = 32`, the HP band) and `tests/fight-doc.test.ts` (about 8, including 20 rows under 16,384 characters, design table 5.3). Reads: design 5.4, `protocol.ts:274-330`, `combat.js:557-570`. Trap: the band moves here from `combat.js:557`; keep its four thresholds.

**P5, rows from hunters, sheets, monsters and shadows** (60 min, worktree, after P1 and P2). Creates `src/core/combat/rows.ts` and `tests/rows.test.ts` (about 12): `hunterRow`, `remoteRow`, `monsterRows(m, n, ids, R)`, `shadowRow`, each a `NewRow` with its origin, abilities (the weapon's attack and the skills' abilities; a monster's archetype attack and its own), HP, mana and fatigue from the sheet or the kind, XP and starting statuses. Replaces `combat.js:146-170` and `monsters.ts:132-145` in the wave. Trap: a remote's sheet is parsed by `parseSheetHunter` before it gets here; no check inside.

**P6, the dice** (30 min, worktree). Creates `src/edge/roll.ts` (`rollDice`, `rollNeeds(needs)`, `rollOpenings(ids)`, `rollSettle`, each with an injected random source defaulting to `crypto.getRandomValues`) and `tests/roll.test.ts`. Reads `resolve.ts:23-29` (`Rolls`, `Needs`), `dice.js:61-113`.

A schema 4 parser beside the old one before the wave is not done (**decided here**): the `Hunter` type is imported by 30 files, so a second one is two homes for a hunter for the length of the wave, which `principles.md` row 1 forbids.

### 4.3 The wave (in sequence, main tree, red from W1a to W9)

| Unit | Minutes | Owns (changes unless marked) | Bun tests | Browser files | Red after, and until |
|---|---|---|---|---|---|
| W1a Statuses and rules | 90 | `stats.ts`, `rules.ts`, `registry/statuses.ts`, `effect-ops.ts`, `fight-parse.ts` (export `parseStatusDef`), `chips.ts`, `effects.ts`, `rewards.ts`, `pack.ts`, `src/edge/rules.ts`, `src/edge/room-events.ts` (status toast only) | rewrite `statuses.test.ts` (11), `rules.test.ts` (20), `rewards.test.ts` (22), `pack.test.ts` (20) | none | tsc in `save.ts` (W2), `protocol.ts`, `api.ts` (W3), `items.ts`, `skills.ts`, `monsters.ts` (W1b), old modules (W8); `save.test.ts` (W2); browser files that show a status (W4 to W7) |
| W1b Items, skills, paths, monsters | 90 | `registry/items.ts`, `skills.ts`, `paths.ts`, `monsters.ts`, `abilities.ts`, `src/views/starter.js` | rewrite `items.test.ts` (31), `skills.test.ts` (18), `paths.test.ts` (5), `monsters.test.ts` (22), `jobs.test.ts` unchanged | none | as W1a, without the registries |
| W2 The save at schema 4 | 75 | `save.ts`, `hunter/vitals.ts`, `hunter/progress.ts`, `src/edge/store.ts` | rewrite `save.test.ts` (94: the migration cases go, about 25 deleted with `fromV1` and `fromV2`, the rest moved), `vitals.test.ts` (24), `progress.test.ts` (28) | `save.e2e.ts` (5 unchanged, 2 rewritten, 1 deleted) | tsc in `protocol.ts`, `api.ts` (W3); views typecheck (W4 to W7) |
| W3 The room | 90 | `protocol.ts`, `src/edge/room-events.ts`, `src/edge/sync.ts` (doc put, 413 retry), `api.ts`, `events.ts`, `src/views/app.ts`, `tests/models/room-world.ts` | rewrite `protocol.test.ts` (77: `step`, `cast`, `vitals` with a case per bound), `server-rooms.test.ts` (38: a GM-only `vitals` refusal), `applied.test.ts` (14), `room-system-model.test.ts` (7: a `vitals` GM move and a replayed `cast`), `push.test.ts` (17), `sync-model.test.ts` (2) | `room-sync.e2e.ts`, `room-sync-fixes.e2e.ts`, `room-view.e2e.ts`, `room-onboarding.e2e.ts` unchanged and green | `bunx tsc --noEmit` errors only in the old modules (W8); views typecheck (W4 to W7) |
| W4 The sheet on eight stats | 90 | `hunter.js`, `custom.js`, `dice.js`, `inventory.js` (bonuses, gear), `shadows.js`, `gm.js`, `reward-editor.js`, `ui.js` | none new | `character.e2e.ts` (4 of its 20 here: 186, 215, 251, 428; 319 deleted with `cdLeft`), `customization.e2e.ts` (4 rewritten), `rewards.e2e.ts` (2), `reward-room.e2e.ts` (1), `gates-quests-dailies.e2e.ts` test at line 455 | views typecheck in W5 to W7 files |
| W5 The GM's fight | 90 | `combat.js` (rewritten), `gates.js` (start flow, clear after a fight), `room.js` (`removeRemote`), `bestiary.js` (`toCombatant` only), `tests/e2e/helpers.ts`, `scripts/ui-shots.ts` (fight steps) | none new | `combat-turns.e2e.ts`, `layout.e2e.ts`, `character.e2e.ts` 127, `gates-quests-dailies.e2e.ts` 101, 117, 151, 245, 290 | views typecheck in W6, W7 files |
| W6 The players' table | 90 | `table.js` (HUD on the doc, `step` and `cast`, Apply as `adjust`), `uses.js`, `skills.js` (use in a fight, no `cdLeft`), `inventory.js` (`useItem` as `act` or `cast`), `custom.js` (the `combat:turn` handler, `custom.js:122`) | none new | `table-session.e2e.ts`, `used.e2e.ts`, `custom-skills.e2e.ts`, `character.e2e.ts` 145, 619, 643 | views typecheck in W7 files |
| W7 Makers, bestiary, rules reference | 90 | `maker.js`, `forge.js`, `workshop.js`, `loot.js`, `bestiary.js`, `rulesref.js`, `effects.js`, `skills.js` (maker), `scripts/ui-shots.ts` (maker steps) | none new | `makers.e2e.ts`, `sharing.e2e.ts`, `character.e2e.ts` 345, 465, 494, 533, 558, 600, 610 | none in typecheck; old tests (W8) |
| W8 Delete the old fight | 60 | deletes `encounter.ts`, `encounter-types.ts`, `encounter-parse.ts`, `use.ts`, `status.ts`, `ability.ts`, `scripts/charts/fight.ts`, `tests/models/fight-play.ts`; renames `fight2` chart to `fight`; deletes leftover exports (`mod`, `STATS` re-export, `formulaHpMax`, `formulaMpMax`, `RULES.hp`, `RULES.mp`, `PERK_LABELS.ac`); `tests/lint.test.ts` | deletes `encounter.test.ts` (98), `encounter-model.test.ts` (3), `use.test.ts` (24), `status.test.ts` (51), `ability.test.ts` (2), `status-sim.test.ts` (2); rewrites `lint.test.ts` (21, plus 3 new) and `statecharts.test.ts` | none | none |
| W9 Docs, maps, the full run | 90 | `AGENTS.md`, `docs/dependency-map.md`, `docs/state-machines.md`, `docs/agent-handoff/copy-tasks.md`, `rw/design.md` section 7, anything left | `bun run test` | every file, one at a time; `scripts/ui-shots.ts` once | none: green, the lead pushes |

Red time: about 13.5 hours of helper time end to end (W1a 90 to W9 90, plus about 10 minutes of the lead's check between units), all of it local commits with no push. W4 and W7 touch disjoint files and could run in two worktrees at once if the lead accepts cherry-picking changed files (handoff section 3 allows new files only); that saves about 1.5 hours. Nothing else can overlap: W1a to W3 change shared core types in order, and W5 to W7 share `skills.js`, `inventory.js` and `bestiary.js`.

### 4.4 Each wave unit's brief points

**W1a.** Restate the 14 statuses by section 3.1; `describeStatus(def, tier)` in `effect-ops.ts` replaces `describe`, `statusDef` and `mods` for every new caller; `chipDef` (`chips.ts:25`) returns the new `StatusDef`; `effects.ts` item ops on the new `Op` (`legacyOps` goes with the item fields in W1b); `rewards.ts` `RewardStatus` holds the new def; `pack.ts` reads statuses with `parseStatusDef`; `rules.ts` imports `STAT_KEYS` from `stats.ts` and re-exports an eight-entry `STATS` until W8; `rankTable` keeps `dc`, `xp`, `breakDays`; `boss` and `elite` fold into `fight.kinds`. Reads: inventory 3.5, 6.3 third point (a removed rule key is refused at load: say so in `rules.test.ts`), design 3.3 ops. Principles: subtract-before-you-add (notes list deleted lines), explain-the-number (the 4N rule). Traps: `statuses.test.ts:87`'s `HIT` and `rankBonus` curves are phase 4's d20 audit: delete those cases with the `mod` ops; `RULES.conditions` is typed by `BUILT_IN_STATUSES`.

**W1b.** Sections 3.2 to 3.6 for every entry; `Item`, `Skill`, `Monster` move to their registries with `parseItem`, `parseSkill`, `parseMonster` on the new shapes (lint rule "only parseItem ... only parseMonster", `lint.test.ts:223`); `statBlock` becomes the sheet of a seed; `starter.js` pregens by 3.6. Traps: `items.test.ts` checks every consumable "does something" (section 3.3's ops satisfy it); `monsters.test.ts` checks every ability parses.

**W2.** Section 1.2. `loadSave` reads `v4`; a `v3`, `v2` or `v1` text goes to the backups with notice `'old'` and a fresh campaign (`save.ts:733-745`); `parseSheetHunter` keeps its two differences. Reads: inventory 4.4, `save.ts:581-713`. Principles: boundary-discipline, subtract (the migration code is about 120 lines). Traps: the lint rule for vitals (`lint.test.ts:144`) names `mp`: rename to `mana` there in W8, not here (W2 does not own the lint file; the rule's regex still matches `mp`, so the rename passes it); `tests/fixtures/saves/*` are schema 1 to 3: keep them as "old saves" for the rewritten `save.e2e.ts` cases.

**W3.** Section 1.3. The doc reader in `DOCS` uses `FightDoc` from P4; `encounterDoc` and `EncounterRow` go; `MAX_COMBATANTS` and `MAX_ROUND` stop being imported from `encounter-types.ts`. `APPLIERS` gains `step: null`, `cast: null`, `vitals: { once: true }`. `CombatApi` (`api.ts:90-115`) becomes `{ isActive, add, startFlow, awardParty, okToReplace, removeRemote, adjust(cid, delta), targets, useItem }` (`applyUse` and `applyDamage` go; the Table feed's Apply calls `adjust`); `AppEvents` `combat:defeated` and `combat:end` carry fight types. A refused doc put is retried once without log lines, then the pill says "too big to share" (design 5.4). Reads: AGENTS.md "A room message" recipe, `room-events.ts`, `sync.ts:620-650`. Principles: make-operations-idempotent (`cast` and `step` are refused unless the turn and `at` match, and the model replays one). Trap: `sent.ts`'s `freshFor` still guards a card against a sheet pushed before the `vitals` message arrived (`table-session.e2e.ts:202` proves it).

**W4.** `app.api.hunter.sheet(h)` replaces `derived`; the sheet shows the eight stats with labels from `stats.ts`, then Speed, Armor, Resist, Reaction, Accuracy, Will, Max mana, Fatigue capacity, Carry and Kit weight from the `Sheet`, then checks; `inventory.js` shows weight against carry and loses `bonuses`; a gear swap in a running fight is refused (**decided here**: the row's sheet is the fight's; a swap mid-fight would need a command that re-derives the row; `customization.e2e.ts:99` is rewritten to that). Traps: `hunter.js:808` confirms spent points against `statsLocked`: keep it on eight keys.

**W5.** `combat.js` draws and sends only: the order ahead (`order`), cards (`cardOf`), a use (`aims` then `needs`, `rollNeeds`, `act`), outcomes from the log and the `Outcome`s, Toward and Away, the Status window as the `status` command, hand edits as `adjust`, End and the summary with XP. `send()` carries out `vitals` (through `app.api.hunter`), `sendRemote` (a `vitals` message), `shadowHp`, `rollSettle` (dice from `roll.ts`, then `settle`), `turnStarted`, `defeated`, `ended`. The quick line becomes `Name xN, rank, archetype` (**decided here**). `startGoblinDenFight` (`helpers.ts:185-200`) starts the fight through the UI, then sets each row's `at` and `tie` in the store so a monster acts first and the named hunters follow (setup only; handoff section 3 records two tests that broke on a random order). Reads: inventory 6.2 and 6.3, `combat.js` whole, `ui-pass/design.md` "The fight on a phone" and "Death save prompt". Principles: separate-before-serializing (one writer), encode-lessons. Traps: the dispatcher line the lint matches (`lint.test.ts:62`) becomes `d.fight = r.fight;` in W8; keep exactly one such line now; `combat.js` is 1026 lines, so commit the draw half and the send half separately.

**W6.** On a player's phone the HUD reads the doc: "Your turn" keys on `now` and `currentId` (`table.js:260` today keys on `round`); the player's abilities come from its own skills and weapon (`rows.ts`), aims and steps from `fight-view.ts` over the doc's rows, and a tap sends `cast` or `step` with the doc's `now` as `at`. The GM's `combat.js` handles both from `sync:event` (owned by W5; W6 adds only the handler call through `app.api.combat`). An item used in a fight is consumed on the phone that holds it when the use is sent, as today (**decided here**; risk 4). Trap: `skills.js:91` ticks cooldowns on `combat:turn`; it goes with `cdLeft`.

**W7.** The effect rows of `maker.js` edit `damage` (with a physical or magical choice), `heal`, `mana`, `fatigue`, `applyStatus` (duration in rounds), `cureStatus`, `note`, `speed`, `stat`; the amount is a text read by `parseFormula` with its error on the row (**decided here**: the typed field with the recommended text and Reset is M4). The skill maker picks a kind and shows the kind's recommended formula read only. The enemy maker picks rank, archetype and kind and shows the derived HP, armor, resist and speed. `rulesref.js` explains the eight stats, the curves, Armor and Resist, the turn order by speed. Trap: `makers.e2e.ts:358` (HP set by rank) is deleted with the HP field.

**W8.** The grep gate: each of `encounter`, `encounter-types`, `encounter-parse`, `combat/use.ts`, `combat/status.ts`, `combat/ability.ts`, `\bmod\(`, `formulaHpMax`, `formulaMpMax`, `\bac\b` in stat or perk tables, `\b(dex|con|int|wis|cha)\b` as stat keys, `derived\(`, `bonuses`, `cdLeft`, `mpCost` finds nothing in `src` (each command in the notes with its empty output). New lint tests, each with its reason: "no view computes or rolls a fight number" (no `Math.random`, no `derive`, `resolve`, `sheetOf` or `formula` call in `src/views`); "only the fight changes a place, HP, shield, stagger, channel, threat or a fight status" (no assignment to those fields of a row outside `src/core/combat/`); "nothing imports the deleted modules". The vitals rule's field list says `mana` for `mp`.

**W9.** `AGENTS.md`: the rows of section 1.1, the rows that go, the recipes of design 7.3 (an ability, a shape, a status op, a terrain, a derived number), the fight command recipe on `fight.ts`, "Saves and roles" at schema 4 with no carry-over, the room message recipe with `step` and `cast`. Then `bun run deps -- --write`, `bun run charts`, `bun run test`, every browser file once, `scripts/ui-shots.ts`; fix what is left in the file that owns it. Report each file's count.

## 5. The browser tests

At d84c012 there are 172 `test(` calls in 20 files (174 tests: the Status window case of `combat-turns.e2e.ts:187` runs once per phone size). Unchanged means green with no edit once its unit (or W9) runs it.

| File | Tests | Unchanged | Rewritten (unit) | Deleted with its behaviour |
|---|---|---|---|---|
| `combat-turns.e2e.ts` | 11 | 1 (New status opens at its top) | 5 (W5): removing the current row, XP of a removed foe, the Status window at its top, a renamed Poisoned on a card, Burning by rank at turn start | 5: back a turn twice (`prev`), a new round with the first (rounds as a pass), re-rolled initiative, the attack roll with disadvantage at fatigue 90 |
| `table-session.e2e.ts` | 7 | 0 | 7 (W6) | 0 |
| `custom-skills.e2e.ts` | 7 | 1 (bomb with no fight and no room) | 6 (W6) | 0 |
| `used.e2e.ts` | 6 | 5 | 1 (W6: the bomb becomes a `cast`) | 0 |
| `character.e2e.ts` | 20 | 4 (95, 267, 373, 388) | 15 (W4 4, W5 1, W6 3, W7 7) | 1 (319, a cooldown on the sheet) |
| `makers.e2e.ts` | 22 | 8 | 12 (W7) | 2 (284 Heals HP field, 358 HP set by rank) |
| `gates-quests-dailies.e2e.ts` | 21 | 15 | 6 (W5 5, W4 1) | 0 |
| `customization.e2e.ts` | 8 | 4 | 4 (W4) | 0 |
| `save.e2e.ts` | 8 | 5 | 2 (W2: an old save opens a new campaign with the message and its text in Backups; the wrong-shape case at schema 4) | 1 (162, a fight and a room kept through the update) |
| `layout.e2e.ts` | 5 | 3 | 2 (W5) | 0 |
| `rewards.e2e.ts` | 5 | 3 | 2 (W4) | 0 |
| `sharing.e2e.ts` | 6 | 5 | 1 (W7) | 0 |
| `reward-room.e2e.ts` | 1 | 1, since the short label stays `STR` (section 2 decides it) | 0 | 0 |
| the room files, `look`, `pwa`, `upgrade` (`room-sync` 1, `room-sync-fixes` 14, `room-view` 9, `room-onboarding` 6, `look` 9, `pwa` 3, `upgrade` 3) | 45 | 45 | 0 | 0 |

New browser tests (named by what is seen): in W5 "a fight with no map shows the order ahead, a Toward step brings Brakk next to a goblin and his Strike shows the goblin's new HP", "a monster stunned on its turn loses it", "End shows the summary with the XP"; in W6 "a player's Strike sent on their turn changes the goblin's band on both phones, and the same tap after the turn moved on changes nothing", "a player's step on their turn moves their token on the GM's order". Totals: 100 unchanged, 63 rewritten, 9 deleted, 5 new.

`scripts/ui-shots.ts` needs: the fight steps (`ui-shots.ts:351-410`) on the new selectors (no `[data-roll]` initiative button, no `.cmb-round`; the quick line without AC), a shot of the order ahead, a card, the target picker and Toward/Away, and the player's HUD with "Your turn"; the maker steps on the new item and enemy fields. W5 and W7 update it in the commit that changes the taps; W9 runs it once.

## 6. Risks

1. **The save rule contradicts itself.** The brief and `combat-rework-notes.md:44` say a new campaign with no carry-over; `AGENTS.md` "Saves and roles" and the standing helper prompt say a player's hunters survive a format change through the migration. A helper following its prompt will write a migration. The plan: the lead settles it in writing before W2 (the W2 brief quotes the rule and overrides the prompt line), and W9 rewrites the AGENTS.md section.
2. **The red run is long (about 13.5 hours) on a box that pauses and once restarted.** The plan: every step is a commit, the owner map and red ledger tell the lead which failure is expected, `bun run build` stays green so browser files run inside units, and the lead reruns each unit's check before the next starts. If the run must stop, `m2-start` is the tag to return to; nothing is pushed.
3. **Content changes the balance.** The sim's builds use the design's three archetypes; the registries' real abilities (weapon dice, Dagger Rush's quick strike, a boss's blast with a 9 tile radius) were never run. The plan: P1's per-entry 60% rule catches the single-hit outlier at the source; after W9 the lead reruns `tests/fight-sim.test.ts` and the four open rows with the real abilities (handoff 2b says to).
4. **Two phones, one fight, stale or doubled taps.** A `cast` replayed, sent on a stale view, or an item consumed when the GM's phone refuses the use. The plan: `at` and `currentId` checks with a replay case in `room-system-model.test.ts` (W3) and a browser test (W6). An item lost to a refused `cast` is accepted for M2 and listed for the owner; the fix is an effect that consumes the item from the GM's side.
5. **`combat.js` and `table.js` are the largest rewrites (1026 and 401 lines) under a 90 minute bound.** The plan moves every number into P3 and P4 first, so W5 and W6 draw and send only; W5 commits the drawing and the sending as two steps. If W5 runs over, its second half (Status window, hand edits, summary) becomes W5b before W6.

What I could not determine by reading: whether Bun's bundler refuses a missing named export (the build invariant rests on it; W1a checks it first), whether `tests/views.test.ts` loads every view module (if so it is red from W1a until W7), the exact runtime of the rewritten browser files, whether the old-fight tests fail at W1a or only later, and how many lines `combat.js` keeps.
