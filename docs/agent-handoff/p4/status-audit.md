# Status audit (phase 4)

Read-only audit of every status effect at commit 4d8ca47. Facts only, no proposals. Every number carries its `file:line`. Averages are dice means (1d4 = 2.5, 1d6 = 3.5, 1d8 = 4.5, 1d10 = 5.5, 1d12 = 6.5).

The monster counts and the yardstick arithmetic in sections 2 and 3 come from two throwaway bun scripts that import `SEEDS`, `seedMonsters`, `parseAbility`, `RULES`, `mod` and `formulaHpMax` from the source. They were not committed.

## 1. Each status today

### How a status works in code

- **Shape.** An instance is `{ key, rounds, def?, source? }` (`src/core/combat/status.ts:34`). `source.tier` is clamped to 0..5 (`status.ts:114-120`, `MAX_TIER` at `status.ts:47`).
- **Resolving the def.** `statusDef` uses the instance's own `def` first, then `R.conditions[key]`, then the key as its label (`status.ts:137-147`). A legacy `checkMod` becomes a `mod check` op (`status.ts:142-143`).
- **When ops fire.** On a status a `mod` op is always on. Numeric ops (`damage`, `heal`, `mp`, `fatigue`) fire at turn start. Every other op defaults to `use` (`status.ts:61-62`), and nothing fires a status's `use` ops.
- **Modifiers.** `mods` sums every `mod` op across the target's statuses (`status.ts:155-162`).
  - On a hunter they feed `derived`: `ac: 10 + mods.dex + bon.ac + em.ac` (`src/views/hunter.js:113`), `atkMod: em.atk + bon.atk` and `dmgMod: em.dmg + bon.dmg` (`hunter.js:109`), and `checkBonus = mod + rankBonus - fatigue - penalty + em.check` (`hunter.js:115`).
  - A hunter's attack roll is `checkBonus(stat) + atkMod` (`src/views/combat.js:219`), so a `check` mod also moves attacks.
  - A monster or shadow gets `live AC = c.ac + mods.ac` (`combat.js:54`), attack `c.atk + mods.atk + mods.check` (`combat.js:243`) and damage `c.dmg + mods.dmg` (`combat.js:241`).
  - A remote hunter's AC on the GM's card is the AC its phone sends (`combat.js:54`, `combat.js:143`). The phone's own `derived` already holds its statuses' AC mod.
- **Per-turn ops.** `startTurn` calls `tickStatuses` (`src/core/combat/encounter.ts:42-55`).
  - `tickStatuses` collects the per-turn ops first and then counts rounds down by one (`status.ts:199-207`). A status of N rounds therefore ticks N times, at the start of the target's turns.
  - Each op becomes a `rollTick` effect (`encounter.ts:54`). `rollTick` rolls it with the app dice and sends `changeHp` (damage or heal), `changeMp` or `changeFatigue` (`combat.js:99-109`).
  - `mp` and `fatigue` ticks do nothing on a monster or shadow (`combat.js:104,107-108`).
  - Rounds count down only in a running fight. Nothing ticks a hunter's statuses outside one, and no rest clears them. The only writers of `h.conditions` are `addC` and `delC` (`hunter.js:76-85`), `hunterStatuses` (`combat.js:76`) and the save repair (`src/core/save.ts:401`).
- **Stacking.** A target holds one instance per key. The higher `source.tier` wins, a tie goes to the newcomer, rounds take the longer of the two and `null` beats any number (`status.ts:175-191`). Today this is the only code that reads `tier`.
- **Disadvantage.** The dice roller supports `dis` (`src/views/dice.js:64`). No status sets it. Only fatigue does (`combat.js:221`).

### The 14 built-ins (`src/core/registry/statuses.ts:7-22`)

Every row is the same at tier 0, 2 and 5, because no code reads the tier for a number. The "flat number" column is the value at every tier.

| Key (line) | Ops (flat number at every tier) | What the code does | Words in `desc` that are only text |
|---|---|---|---|
| bleeding (`:8`) | `damage 1d4` (avg 2.5/turn) | rolls 1d4 off HP at each turn start | "until treated" (no cure exists besides removing it) |
| burning (`:9`) | `damage 1d6` (avg 3.5/turn) | rolls 1d6 off HP at each turn start, logged as "fire damage" (`combat.js:97,105`) | "until extinguished" |
| poisoned (`:10`) | `checkMod -2` (folded to `mod check -2`), `damage 1d4` (avg 2.5/turn) | -2 to every check and attack roll, 1d4 off HP each turn start | "Disadvantage on attacks and checks" (it is -2, not disadvantage) |
| paralyzed (`:11`) | none | nothing | all of it: "Cannot move or act; attacks against you hit" |
| stunned (`:12`) | none | nothing | all of it: "Cannot act; automatically fail STR and DEX saves" |
| frightened (`:13`) | `checkMod -2` | -2 to every check and attack roll | "Disadvantage", "while the source of fear is in sight" |
| blinded (`:14`) | `mod atk -2` | -2 to attack rolls | "Cannot see", "disadvantage" |
| slowed (`:15`) | `mod ac -2` | -2 AC | "Speed halved" |
| hasted (`:16`) | `mod ac +2` | +2 AC | "Speed doubled", "one extra action" |
| invisible (`:17`) | none | nothing | all of it: "attacks against you have disadvantage" |
| prone (`:18`) | `mod ac -2` | -2 AC against every attack | "melee attacks against you have advantage" (code: -2 AC, melee or not) |
| restrained (`:19`) | `mod atk -2` | -2 to attack rolls | "Speed 0", "disadvantage" |
| stealth (`:20`) | none | nothing | "Hidden from view" |
| bloodlust (`:21`) | `checkMod -2` | -2 to every check and attack roll | "Frightened by a superior presence" |

There are also four state chips (`statuses.ts:33-38`): unconscious, dead, exhausted and penalized. They are not statuses. The reducer refuses to add or remove them (`encounter.ts:184,198`). Penalized's -2 to checks comes from `checkPenalty`, not from an op (`hunter.js:105`).

The forge's quick chips are a second set of flat numbers that GMs use for custom statuses (`src/views/forge.js:8-16`): AC ±2, checks ±2, attack ±2, damage +2, 1d4 damage per turn, 1d6 damage per turn, 1d4 heal per turn and a "Can't act" note.

## 2. Every source that applies a status

### Seeded monster abilities

I parsed all 66 ability lines of the 22 seeds (`src/core/registry/monsters.ts:18-39`) with `parseAbility(text, RULES.conditions)` (`src/core/combat/ability.ts:19-41`). 11 lines produce an Apply chip. The chip's rounds come from "(N rounds)" or "for N rounds" right after the name, else `ABILITY_ROUNDS = 3` (`ability.ts:14,35-36`). All 11 chips get 3 rounds.

| Rank | Ability lines | Monster: ability (line) | Status | Rounds | Text the parser ignores |
|---|---|---|---|---|---|
| E | 7 | Giant Centipede: Venom Bite (`monsters.ts:20`) | poisoned | 3 | "CON save DC 13", "1 min" |
| D | 10 | Steel-fanged Lycan: Pounce (`:21`) | prone | 3 | |
| D | | Kasaka (boss): Blue Venom Fangs (`:24`) | poisoned | 3 | "DC 15", "lose 1d8 HP per round" becomes a one-shot 1d8 roll button |
| C | 11 | Ice Elf: Frost Arrow (`:26`) | slowed | 3 | "1 round" (not in a form the parser reads) |
| B | 12 | Red Gate Ice Bear: Frost Maul (`:29`) | slowed | 3 | "until end of next turn" |
| B | | Demon Knight: Dread Presence (`:30`) | frightened | 3 | "WIS save DC 18" |
| B | | Vulcan (boss): Flame Whip (`:32`) | burning | 3 | |
| A | 12 | Giant: Earthshaker (`:34`) | prone | 3 | "DEX save DC 22" |
| S | 14 | Beru (boss): Venom Mandibles (`:37`) | paralyzed | 3 | "CON save DC 25" |
| S | | Kamish (boss): Wing Gust (`:38`) | prone | 3 | |
| S | | Baran (boss): Demon Monarch's Presence (`:39`) | frightened | 3 | "WIS save DC 25" |

Count per status and rank:

| Status | E | D | C | B | A | S | Total |
|---|---|---|---|---|---|---|---|
| poisoned | 1 | 1 | | | | | 2 |
| prone | | 1 | | | 1 | 1 | 3 |
| slowed | | | 1 | 1 | | | 2 |
| frightened | | | | 1 | | 1 | 2 |
| burning | | | | 1 | | | 1 |
| paralyzed | | | | | | 1 | 1 |
| bleeding, stunned, blinded, hasted, invisible, restrained, stealth, bloodlust | 0 | 0 | 0 | 0 | 0 | 0 | 0 |

Per-round effects in ability text that are not statuses, so the GM rolls or applies them by hand each round:

- Vulcan, Cinder Aura: 1d10 fire per round (`monsters.ts:32`).
- Baran, Ice Domain: 3d10 per round (`:39`).
- Gate Troll, Regeneration: 10 HP per round (`:31`).
- Beru, Regeneration: 25 HP per round (`:37`).
- Kasaka: 1d8 per round (`:24`).

### Every path, with the tier the instance gets

| Source | Where the status is applied | `source` and tier today | Def on the instance |
|---|---|---|---|
| A monster's ability chip | `abilityStatus` sends `addStatus(t.id, {key, rounds}, sourceOf(c, ctx()))` (`combat.js:292-296`) | `{kind:'monster', tier: rankTier(c.rank)}`, E 0 to S 5 (`encounter.ts:170-172`, `encounter-types.ts:117-118`) | none, so it resolves through the live rules |
| A shadow's ability chip | the same code | `{kind:'shadow', tier: rank}` | none. A shadow has no `abilities` field (`src/views/shadows.js:23`, `save.ts:190-193`), so `shadowCombatant` gives it `[]` (`combat.js:154`). No shadow card shows a chip |
| The GM's "+ Status" in a fight (Status Forge) | `addStatus(c.id, st)` with no source (`combat.js:770-773`) | the reducer's `defaultSource`: whoever's turn it is, else `{kind:'gm', tier:0}` (`encounter.ts:178-181,185`). It can be the target itself | a full copy of the def: forge "Apply existing" (`forge.js:141`), a typed known name (`forge.js:127-128`) or a new def (`forge.js:130-135`) |
| The GM's fallback picker (only when no forge is registered) | `addStatus(c.id, {key, rounds})` (`combat.js:775-779`) | `defaultSource`, as above | none |
| "A hunter on their turn" | no player-side control exists. The GM taps + Status while it is the hunter's turn | `defaultSource` returns that hunter: `rankIdx(h.rank)` (`combat.js:64`, `encounter.ts:173`), or a remote hunter's synced `tier` (`combat.js:143`, `encounter.ts:174`) | the forge's copy |
| A hunter on their own sheet | `api.addCondition(h.id, key)` (`hunter.js:397-398`, picker at `hunter.js:339`) | none, so `tierOf` reads 0 (`status.ts:175`) | none |
| A consumable's `applyStatus` op (to its user only) | `inventory.use` calls `E.applyOps(hid, ops, { source: it.name })` (`src/views/inventory.js:139-147`), which calls `api.addCondition(hid, op.status, op.rounds, op.def)` (`src/views/effects.js:64-67`) | none, tier 0. The item's rarity `it.rar` is known and not used. `o.source` is only a label string | the def the item forge stored: `defFor(s)` copies the built-in (`src/views/loot.js:66-68,194`), or the forge's def (`loot.js:193`) |
| A worn or wielded item | no path. `applyStatus` with `when:'equip'` is never applied. `inventory.bonuses` reads only `mod` ops (`inventory.js:93`) | n/a | n/a |
| An item against an enemy | no path. An item's `damage` op only writes a line and a feed row (`effects.js:49`, `inventory.js:155`) | n/a | n/a |
| The GM board to a remote hunter | `addRemoteStatus` sends a `status` room event (`src/views/gm.js:333-339`) | none: `StatusGrant` is `key, rounds, def` with no source (`src/core/protocol.ts:86,150-152`) | a copy (forge, or `statusDialog` at `gm.js:323-327`) |
| A status put on a remote hunter in a fight | the reducer keeps the source on the GM's row (`encounter.ts:187-191`). `sendRemote` sends `{key, rounds, def: s.def \|\| defOf(s)}` (`combat.js:127`) | dropped on the way to the phone | a copy is always sent |
| A remote phone receiving a `status` | `applyStatus` removes the key, then adds it (`src/edge/room-events.ts:65-71`) | none, tier 0. The remove-then-add skips the tier and longer-rounds merge | the sent copy |
| The GM's view of a remote hunter's sheet | `remoteCombatant` maps the sheet's statuses to `{key, rounds, def: defOf(x)}` (`combat.js:148`) | dropped | a copy |
| Perks and paths | none. Perk keys are stats, hpMax, mpMax and ac only (`src/core/rules.ts:113`, `src/core/registry/paths.ts:21-28`) | n/a | n/a |
| Jobs | none (`src/core/registry/jobs.ts`) | n/a | n/a |
| Skills | none. A skill has dice and a bonus, no ops | n/a | n/a |
| Quests and rewards | none directly. A reward item can carry `effects` (`protocol.ts:115`), and those apply only when the item is used, as for consumables | n/a | n/a |
| Titles | none. A title holds a `bonus` only (`rules.ts:46-52`) | n/a | n/a |
| Custom content | GM monsters' ability text can name any status, built-in or custom, because `parseAbility` reads `rules().conditions` (`combat.js:274`). Forged statuses: `forge.js`. Forged items: `loot.js` | as the rows above | as the rows above |
| `kind:'item'` source | declared (`status.ts:29`). No code in `src/` builds one. Only `tests/encounter.test.ts:522` does | n/a | n/a |

Paths where a better tier is known but the instance gets no source or tier 0:

1. Item use: the rarity index is known and the instance has no source (`effects.js:66`).
2. Every status on a remote phone: the source is dropped in `sendRemote` (`combat.js:127`) and `StatusGrant` (`protocol.ts:86`). The GM's encounter row keeps it.
3. The GM board's status to a remote hunter: no source (`gm.js:338`).
4. A hunter's own sheet picker: no source (`hunter.js:398`).
5. GM "+ Status" outside a running fight: tier 0 (`encounter.ts:180`). Inside a running fight it takes the current turn's combatant, which may not be who applied it.
6. A quick-line monster or a custom combatant with no rank typed is rank E, tier 0, whatever its HP (`combat.js:330`, `combat.js:752`).
7. A hunter's tier is `h.rank`, which moves only when someone taps re-evaluation (`hunter.js:161-167`). A level-50 hunter that was never re-evaluated is still tier 0.

## 3. The yardsticks

### Monsters per rank (`rules.ts:22-31`, `statBlock` at `monsters.ts:43-54`)

| Rank | HP | AC | To hit | Damage (avg) | Boss (HP ×3, AC +2, atk +2; `rules.ts:30`) | Elite (HP ×1.5; `rules.ts:31`) | Pack size |
|---|---|---|---|---|---|---|---|
| E | 20 | 13 | +4 | 1d8+2 (6.5) | 60 HP, AC 15, +6 | 30 | 1-3 (`rules.ts:69`) |
| D | 60 | 17 | +8 | 2d8+5 (14) | 180, AC 19, +10 | 90 | 2-6 (`src/core/gates/spawn.ts:21`) |
| C | 150 | 24 | +13 | 3d10+10 (26.5) | 450, AC 26, +15 | 225 | 2-6 |
| B | 350 | 31 | +19 | 4d12+18 (44) | 1050, AC 33, +21 | 525 | 2-6 |
| A | 800 | 40 | +26 | 6d12+30 (69) | 2400, AC 42, +28 | 1200 | 2-6 |
| S | 2000 | 50 | +34 | 8d12+50 (102) | 6000, AC 52, +36 | 3000 | 2-6 |

Seeds tweak these per row (`monsters.ts:57-65`). The seeded range per rank:

- E: 14-24 HP.
- D: 60-72 HP; Kasaka boss 162.
- C: 120-225 HP; Cerberus boss 495.
- B: 350-455 HP; Vulcan boss 945.
- A: 640-1200 HP; Igris boss 2160.
- S: bosses only, 4800-9000 HP, AC 52-54.

### A hunter at the level each rank starts

The formulas:

- Rank start levels: E 1, D 10, C 20, B 35, A 50, S 70 (`rules.ts:19`).
- Points: 3 per level above 1 (`rules.ts:16`, `src/core/hunter/progress.ts:31`).
- `hpMax = 4 + 2·CON + 4·(level − 1)` (`rules.ts:17,107`), plus item and perk `hpMax`.
- `mod = floor((score − 10) / 2)` (`rules.ts:97`).
- Rank bonus: E +2, D +3, C +4, B +5, A +6, S +8 (`rules.ts:20`).
- Attack: d20 + mod + rank bonus + atk mods against AC. A natural 20 hits and a natural 1 misses (`combat.js:224,253`).
- Damage per hit: weapon dice + stat mod + dmg mods (`combat.js:235-236`). "Crits double the dice" is only a note in the log (`combat.js:237`).
- Stats start at 10 (`save.ts:168`). No stat cap was found (I looked in `save.ts` and `progress.ts`).

The "typical build" is my assumption. It is Vanguard:

- Auto-place splits level points 2 STR to 1 CON (alloc at `paths.ts:22`, placed by `allocPlan` at `src/views/custom.js:277-282`).
- It takes the STR perk of each open tier: +2, +1 (+1 CON), +3, +2 (+1 CON), +4, +2 (+2 CON) (`paths.ts:22`). Tiers open by rank (`rules.ts:123`).
- The weapon is the best STR weapon of the rarity with the largest loot weight at that rank (`rules.ts:60-66`; items `src/core/registry/items.ts:34,45,35,54`).
- Item CON and armor are left out.

| Rank (level) | Points (2:1) | STR = 10 + pts + perks + weapon | mod | CON | HP (CON 10) | HP (build) | Weapon | Dmg/hit | Attack | Hit vs AC | Expected dmg/attack |
|---|---|---|---|---|---|---|---|---|---|---|---|
| E (1) | 0 | 10+0+2+0 = 12 | +1 | 10 | 24 | 24 | Steel Longsword 1d8, common | 4.5+1 = 5.5 | +3 | vs 13: 55% | 3.0 |
| D (10) | 27 (18/9) | 10+18+3+0 = 31 | +10 | 20 | 60 | 80 | Steel Longsword 1d8, common | 14.5 | +13 | vs 17: 85% | 12.3 |
| C (20) | 57 (38/19) | 10+38+6+1 = 55 | +22 | 30 | 100 | 140 | Orc Cleaver 1d10 +1 STR, uncommon | 27.5 | +26 | vs 24: 95% (cap) | 26.1 |
| B (35) | 102 (68/34) | 10+68+8+2 = 88 | +39 | 46 | 160 | 232 | Knight Killer 1d10 +2 STR, rare | 44.5 | +44 | vs 31: 95% (cap) | 42.3 |
| A (50) | 147 (98/49) | 10+98+12+3 = 123 | +56 | 61 | 220 | 322 | Frost Giant Hammer 2d6 +3 STR, epic | 63 | +62 | vs 40: 95% (cap) | 59.9 |
| S (70) | 207 (138/69) | 10+138+14+3 = 165 | +77 | 83 | 300 | 446 | Frost Giant Hammer 2d6 +3 STR, epic | 84 | +85 | vs 50: 95% (cap) | 79.8 |

A hunter that puts no points into the attack stat attacks at its rank bonus alone:

- E: +2 against AC 13, 50% to hit, 1d8 = 4.5 a hit.
- S: +8 against AC 50, 5% (natural 20 only).

The build decides the yardstick far more than the rank does.

### Rounds a fight lasts if a party of three only attacks

Each hunter in the build above attacks once a round. Rounds = HP / (3 × expected damage per attack).

| Rank | Party dmg/round | One normal monster | One boss (AC +2) | Burning 1d6 tick as a share of one attack | 1d4 tick as a share of one attack | Burning tick as % of a normal monster's HP | Burning tick as % of the build hunter's HP |
|---|---|---|---|---|---|---|---|
| E | 9.1 | 2.2 | 8.1 | 1.16 | 0.83 | 17.5% | 14.6% |
| D | 37.0 | 1.6 | 5.5 | 0.28 | 0.20 | 5.8% | 4.4% |
| C | 78.4 | 1.9 | 5.7 | 0.13 | 0.10 | 2.3% | 2.5% |
| B | 126.8 | 2.8 | 8.3 | 0.08 | 0.06 | 1.0% | 1.5% |
| A | 179.5 | 4.5 | 13.4 | 0.06 | 0.04 | 0.44% | 1.1% |
| S | 239.4 | 8.4 | 25.1 | 0.04 | 0.03 | 0.18% | 0.8% |

What a whole status is worth at its default 3 rounds from an ability (`ability.ts:14`), which is 3 ticks:

- Burning: 10.5 average damage.
- Bleeding or Poisoned: 7.5.
- A monster's own attack, for comparison: E 6.5, S 102 (`rules.ts:23,28`).

### Flat ±2 modifiers against the 5%-95% clamp

Hit chance = (21 − (AC − bonus)) / 20, clamped to 5%-95%. A -2 to the attacker's roll, or +2 to the defender's AC, moves it by 10 points only when AC − bonus is 2 or more before the change. At AC − bonus = 1 it moves 5 points, and at 0 or less it moves nothing.

- **Hunters attacking (build above).** AC − bonus is E 10, D 4, C −2, B −13, A −22, S −35. Blinded, Restrained, Poisoned, Frightened and Bloodlust (-2 to attack) change a hunter's hit chance at E and D only. Slowed and Prone on a monster (-2 AC) change nothing from C up.
- **Monsters attacking.** Against an illustrative hunter AC of 15, AC − monster to-hit is E 11, D 7, C 2, B −4, A −11, S −19. Slowed and Prone on a hunter (-2 AC) change a monster's hit chance at E, D and C only. Hasted (+2 AC) is the same in reverse.

## 4. Where a status's numbers are shown

`describe(R, x)` (`status.ts:211-232`) is the only function that turns ops into words: "1d4 damage at turn start", "−2 to checks", "AC −2", "Applies Burning (3 rounds)". Every site below either calls it or prints only the label.

| Place | File:line | What it prints | Builder |
|---|---|---|---|
| Combat card, condition chips | `combat.js:582` | label, rounds, `desc` as the tooltip | `condLabel` and `defOf` (`combat.js:39-40`). No ops |
| Combat card, stat line | `combat.js:611` | "AC 13 → 11", Atk and Dmg with the monster's status mods summed in | `modsOf`, `atkBonus` and `dmgExpr` (`combat.js:43,241,243`) |
| Combat card, monster Attack button | `combat.js:597` | the attack bonus and damage with mods | as above |
| Combat card, ability Apply chip | `combat.js:278` | "Apply Poisoned · 3r" | `parseAbility`. No ops |
| Combat fallback picker | `combat.js:584` | labels | none |
| Combat log | `encounter.ts:192` ("X is Poisoned for 3 rounds"), `combat.js:105-106` ("Poisoned 2 poison damage") | label, rounds, the rolled number | reducer and `rollTick` |
| Room table row (other players' conditions) | `combat.js:474`, `protocol.ts:285-288` | label, rounds, color | none |
| Status Forge, "Apply existing" chips | `forge.js:70-71` | label, `desc` as the tooltip | none |
| Status Forge, extra effects line | `forge.js:103` | op lines | `describe` via `api.effects.describe` (`forge.js:25`, `effects.js:80`) |
| GM Status library panel | `forge.js:184-187` | op lines, else `desc` | `describe` |
| Hunter sheet chips and the open chip | `hunter.js:459-466` | label, rounds; the open chip shows `desc` and the op lines | `describe` (`hunter.js:466`) |
| Hunter sheet "Add condition" picker | `hunter.js:339,456` | labels | none |
| Player table view, own chips | `src/views/table.js:87-88,108-116` | label, `desc`, op lines | `describe` |
| Remote phone, "! Status" window | `room-events.ts:71-72` | `desc`, op lines, rounds | `describe(app.rules(), a.def)` |
| GM board, remote hunter chips | `gm.js:187,195` | label | none |
| GM board, fallback status dialog | `gm.js:303-327` | labels | none |
| Item card (inventory) | `inventory.js:211` | "Applies Burning (3 rounds)", without the status's own numbers | `describe` of the item ops |
| GM award item card | `gm.js:352-357` | the same | `describe` |
| Item forge, apply and cure rows | `loot.js:82-85` | labels | none |
| Item use toast | `effects.js:67` | "Status applied: Burning (3 rounds)" | none |
| Rules reference, conditions list | `src/views/rulesref.js:50` | label and `desc` | none |
| Rules reference, conditions table | `rulesref.js:142` | label, `desc` and a "Check mod" column from `checkMod` only. Dice, AC and atk ops are not shown | none |
| Bestiary card and editor | `src/views/bestiary.js:219,243` | the raw ability text | none |
| Codex unlock window | `bestiary.js:74-77` | the first 4 abilities, cut at 70 chars | none |

## 5. How an override meets the table

**Merge.** `rulesOf` deep-merges `rulesOverrides` into `RULES` (`rules.ts:84-94`). `conditions` is an object, so each key merges field by field. An array is replaced whole, never merged (`rules.ts:89`, where `isObj` excludes arrays). So `{"conditions":{"poisoned":{"ops":[{"op":"damage","dice":"1d6"}]}}}` keeps Poisoned's label, desc and `checkMod: -2` and replaces its ops list. A new key adds a status.

**Validation.** The GM rules editor validates overrides against the shape of `RULES` but skips everything inside `conditions`, because `DYNAMIC_MAPS` covers it (`gm.js:55,63-75`). Bad ops are dropped later, at read time, by `sanitizeOps` inside `statusDef` (`status.ts:141`).

**Forged statuses** are written to `rulesOverrides.conditions[key] = { ...def, custom: true }` (`forge.js:28-33`). The key comes from `slug`, which never takes a built-in key (`status.ts:125-135`). Reset rules keeps entries that are `custom` and not built-in (`gm.js:539-543`). Room messages do not carry the rules, so a player phone knows only the built-ins plus the defs that arrive with each status. That is why statuses travel with a `def` (`protocol.ts:85-86`).

What a saved custom status looks like:

```
rulesOverrides.conditions["ember-mark"] = { label: "Ember Mark", desc: "...", color: "#ff4d5e", ops: [{ op: "damage", dice: "1d6" }, { op: "mod", stat: "ac", value: -2 }], custom: true }
hunters[i].conditions[j] = { key: "ember-mark", rounds: 3, def?: { label, desc, color?, ops?, checkMod? }, source?: { kind, id, name, tier } }
```

The save repair keeps `def` and `source` on a hunter's conditions (`save.ts:330-339`). The encounter does the same for its combatants (`src/core/combat/encounter-parse.ts:25-37`).

What a tier-aware definition would meet today:

- **An override that only changes the dice** (`poisoned.ops = [damage 1d6]`) replaces the whole ops array. Any tier data inside the built-in's ops is lost unless the override restates it.
- **A custom status with no notion of tier** is `{ label, desc, ops }` with plain `dice` or `amount`. A forged status has only those. `sanitizeOps` drops any field it does not know (`status.ts:66-102`), so a new op field has to be added there or it vanishes in every save repair, room message and forge.
- **An instance that carries its own def wins over the rules** (`status.ts:138-140`), and the test at `tests/status.test.ts:119-122` pins this. These paths store a full def copy on the instance:
  - forge Apply existing (`forge.js:141`);
  - forge typed known name (`forge.js:128`);
  - the item forge (`loot.js:194`);
  - the GM board (`gm.js:327`);
  - every status sent to a remote phone (`combat.js:127`);
  - every status the GM reads from a remote sheet (`combat.js:148`).

  A rules change, or a curve read at tick time from the rules, does not reach those instances.
- **The tier is a snapshot on `source`.** Only `applyStatus` reads it (`status.ts:175`). `turnOps`, `mods`, `describe` and `rollTick` take no source and no tier (`status.ts:155-172,211`; `combat.js:99-109`).

## 6. Percent of health

No op, item, ability or perk deals or heals a percentage of HP. The op types are `heal`, `mp`, `fatigue` and `damage`, each with `dice` or a flat `amount` (`status.ts:8-13`). The nearest things:

- **Short and long rest:** heal 25% and 100% of max HP (`rules.ts:34`, `src/core/hunter/vitals.ts:122`). A rest, not a status.
- **Elixir of Life:** `heal: FULL` (99999), shown as "Heals fully" (`items.ts:30`, `status.ts:42,222`, `effects.js:52-53`).
- **Level-up:** restores HP and MP when `levelUpRestore` is set (`rules.ts:16`).
- **Ability text "for half" or "at half HP"** (`monsters.ts:28`) is text only.

## 7. What the tests pin

| Test | File:line | Exact number it pins |
|---|---|---|
| a 2-round Burning ticks `damage 1d6` | `tests/status.test.ts:64-76` | Burning op `{damage, dice:'1d6'}`, 2 ticks for 2 rounds |
| Poisoned and Slowed give -2 checks and -2 AC | `status.test.ts:115-117` | `{ac:-2, check:-2}` |
| the status card wording | `status.test.ts:128-131` | Poisoned's describe lines: `['−2 to checks', '1d4 damage at turn start']` |
| an instance def beats the rules | `status.test.ts:119-122` | the resolution order (any tier design meets this) |
| stacking by tier | `status.test.ts:29-42` | the higher tier wins, a tie goes to the newer, and the longer rounds stay |
| a source's tier is clamped to 0..5 | `status.test.ts:103-106` | `MAX_TIER` 5 |
| every built-in has ops that survive `sanitizeOps` and one describe line per op | `tests/statuses.test.ts:21-28` | the shape of each entry, not its numbers |
| Burning's rollTick on Brakk | `tests/encounter.test.ts:437` | `op: {damage, dice:'1d6'}` |
| the source tier per kind | `encounter.test.ts:498-523` | monster E = 0, hunter Brakk = 1, shadow Igris (D) = 1, remote Mira = 2, GM = 0, an item passed in = 3 |
| an ability chip's rounds | `tests/monsters.test.ts:70-74` | "(2 rounds)" gives 2; "Poisoned 1 min" gives 3 (`ABILITY_ROUNDS`) |
| Poisoned and Frightened -2 on attack and check; Poisoned 1d4 at turn start | `tests/e2e/character.e2e.ts:208-241` | attack −2 (`:218,227`), STR check −2 (`:228`), and HP drops by exactly 2 with `Math.random = 0.45`, which is 1d4 → 2 (`:236-237`) |
| a GM override of Poisoned | `character.e2e.ts:244-258` | override `checkMod -3`, `atk -1`: attack −4, check −3 |
| forged "Poisoned" with the forge's `d4` chip ticks 1 to 4 | `tests/e2e/table-session.e2e.ts:48,139-141` | the forge chip `1d4` (`forge.js:13`), not the built-in |
| save repair keeps a Burning def | `tests/save.test.ts:617-621` | the def `{damage 1d6}` round-trips |

The other browser files (`combat-turns`, `room-sync*`, `room-view`, `customization`) assert labels and chips, not a status's numbers.

## 8. Odd things

- Paralyzed, Stunned, Invisible and Stealth have no ops. Nothing skips a turn or makes an attack hit (`statuses.ts:11-12,17,20`; `encounter.ts:42-55`).
- Five descriptions promise disadvantage: Poisoned, Frightened, Blinded, Restrained and Invisible. No status sets `dis`. The code uses -2 instead, or nothing.
- These pairs are identical in play:
  - Frightened and Bloodlust: check -2 (`statuses.ts:13,21`).
  - Blinded and Restrained: atk -2 (`:14,19`).
  - Slowed and Prone: AC -2 (`:15,18`).
  - Bleeding is Poisoned without the -2.
- Hasted's "one extra action" and every speed clause (Slowed, Hasted, Restrained) are text only.
- Prone's desc says melee attacks get advantage. The code gives -2 AC against every attack.
- No seeded monster applies 8 of the 14 statuses: Bleeding, Stunned, Blinded, Hasted, Invisible, Restrained, Stealth and Bloodlust.
- Ice Elf's "Slowed 1 round" and Ice Bear's "until end of next turn" both apply 3 rounds. The parser reads only "(N rounds)" and "for N rounds" (`ability.ts:35`).
- Kasaka's "Poisoned and lose 1d8 HP per round" ticks Poisoned's 1d4. The 1d8 is a one-shot roll button (`monsters.ts:24`).
- `combat.js:98` mentions "Regenerating's heal". No such status exists. Troll and Beru regeneration is text.
- The parser turns buffs into attack buttons: Rally "+1 to hit" (`monsters.ts:19`), Shield Wall "+2 AC" (`:22`), Rage "+4 damage" (`:27`) and Knight Order "+2 to hit" (`:33`).
- Save DCs in ability text are not rolled. Apply puts the status on with no save.
- The rules reference says timed conditions count down at the end of the turn (`rulesref.js:148`). The code counts down at the start (`encounter.ts:44`).
- The rules reference's Conditions table shows only `checkMod`. Burning's 1d6, Bleeding's 1d4, Poisoned's 1d4 and every AC and atk op are missing from it (`rulesref.js:142`).
- A status on a hunter outside a running fight never counts down, and rests do not clear it.
- A remote phone applies a status by remove-then-add (`room-events.ts:69-70`), not by `applyStatus`. A weaker or shorter grant replaces a stronger or longer one there.
- A status from the GM's picker during a running fight takes the source of whoever's turn it is, which can be the target itself (`encounter.ts:178-181`).
- An `applyStatus`, `cureStatus` or `note` op inside a status def never fires. Its default `when` is `use` (`status.ts:61-62`). Even with `when:'turn'`, `rollTick` drops non-numeric ops, because `rollOps` returns only `NUM_OPS` (`effects.js:35`, `combat.js:102-103`).
- `bestiary.js:96-98` saves `statusDefs` on auto-added monsters. Nothing reads them.
- An item's `applyStatus` can only target its user (`effects.js:64-66`). No weapon or item puts a status on an enemy.
- The source kind `item` exists in the type but no code path produces it (`status.ts:29`).
- A hunter's status tier follows `h.rank`, which lags level until someone taps re-evaluation (`hunter.js:161-167`).
- The GM rules editor does not validate anything under `conditions` (`gm.js:55,67`).
