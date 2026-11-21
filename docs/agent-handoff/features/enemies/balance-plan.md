# Enemy balance pass: the plan

the owner's goal: "a HUGE enemy list. Ranging from weak to basically mythical unbeatable." The draft holds 343 enemies and 23
mythic ones (`README.md`), and none of them is balanced. This plan answers the README's "What the balance pass must
decide", items 1 to 9, in a form a lead can cut into units. It rests on three of the owner's rulings: a boss is tougher only
by "more hp, armor, magic resist" (`fight.kinds.*.control` is already deleted); the four LoL penetration stats, with their
sources settled "during our balance run"; and Tenacity from Strength and Discipline (built, question 25 still open).

Each item says what is **measured** (and by what), what the build takes as a **default**, and what only **the owner**
can rule; his questions are at the end, each with the default built if he does not answer.

## The measures

| Measure | What it answers | Where |
|---|---|---|
| The simulation | whether a rule number holds design section 6's bounds over many seeded fights | `tests/fight-sim.test.ts`, `tests/models/fight-sim.ts`; misses and moves go in `rw/sim-log.md` |
| The odds engine | how one given fight goes: win share, who goes down, rounds | `playBegin`/`playStep` (`combat/play.ts`) with `sensible` (`policy.ts`), as `odds.ts` runs it |
| The worth line | whether one ability or status fits its cost's budget | `abilityWorth`, `statusWorth` (`registry/worth.ts`); warns past `1 + kit.tolerance` (1.08) |
| The item budget | what an item's numbers cost in stat points | `itemSpend` (`registry/item-budget.ts`) |
| The sweep (new, unit 5) | every draft row through the worth line and the odds engine, one line a row | `features/enemies/measure.ts`, run as `flock /tmp/box.lock bun docs/agent-handoff/features/enemies/measure.ts` |

## 1. An enemy's body, from rules (README item 1)

Today a monster is "a hunter of its rank's first level" (`monsterSheet`, `derive.ts`) in its archetype's kit at common
rarity, its max HP and power times its kind's factors, plus the seed's `tweak`; a kind adds no armor or resist. The pass
sets all 366 bodies from these rules, with a tweak only where a row's words ask for one:

| Part | Rule | New? |
|---|---|---|
| Stats | `pointsAt(rankLevels[rank])` split 2:1 by archetype (`ARCHETYPES`) | as today |
| Level | the rank's first level | as today |
| Gear | its archetype's kit **at its rank's tier**: each armor slot's `piece(kit, slot, rarity of the rank)`, as a hunter's full set of that tier. A monster's armor and resist rise by 6 a rank step, as a hunter's do | new function `kitAt(kit, rank)`. The simulation's hunter builds take it too, so both sides rise together |
| Max HP | today's formula times `kinds[kind].hp` times its traits' `hp` | traits are new |
| Power | `kinds[kind].power` | as today |
| Armor, resist | (kit + Vitality's or Discipline's share) times `kinds[kind].armor` or `.resist`, times its traits' | two new factors per kind |
| Tenacity | from its own Strength and Discipline, no kind factor (the owner: a boss does not shorten what lands on it) | as today |
| XP | `rankTable[rank].xp` times `kinds[kind].xp` times its traits' `xp` | traits are new |

**Traits.** `RULES.fight.traits` is a table of named body changes, each with its reason beside it. A seed row names its
traits (`traits: ['slow', 'armored']`), and the GM's bestiary maker gets one checkbox for each. A trait is the
smallest set of existing pieces: an `hp` factor, an `armor` or `resist` factor, a `StatusMod` list that `derive` already
reads (a speed percent, a stat change), and an `xp` factor. The six traits below come from the draft's own words (slow in
15 rows, armour in 19, fast in 6, tough in 1; frail in none, kept as the mirror of tough):

| Trait | Starting value | Reason |
|---|---|---|
| frail | hp 0.8 | the middle of today's seeds' hand tweaks under 1 (0.7 to 0.9) |
| tough | hp 1.3 | the middle of their hand tweaks over 1 (1.1 to 1.5) |
| slow | speed -30% | what plate's bulk costs (`bulkSlow`): "slow" is as slow as a body in plate |
| fast | speed +30% | the mirror of slow |
| armored | armor 1.5 | half again, as a boss's starting armor factor |
| warded | resist 1.5 | the magical twin of armored |

A trait's `xp` is **measured**: the reference party's mean HP lost against the row with it over without it, to a tenth.
Its other numbers are **defaults** the simulation may move. The typed `hp` and `stats` stay for a GM's own monster and the
22 shipped seeds.

**The kinds.** The starting values are normal 1, elite 1.25, boss 1.5 and mythic 2 for both armor and resist (the armor
curve `armorK / (armorK + def)` flattens, so 1.5 times the armor is less than 1.5 times the toughness). The boss's `hp` (3.2
today) is then **measured** back down until the existing boss rows hold (4 to 8 rounds, a hunter down in at most 1 fight
in 4, a death in under 1 in 20, 1 or 2 staggers). That is the owner's ruling as a number: part of a boss's toughness moves
from HP into armor and resist.

## 2. Whether an ability set is too much (README item 2)

An ability set passes three checks, cheapest first. All three are **measured**:

1. **Each ability**: `abilityWorth(a, R, { rank })` at most `1 + kit.tolerance` times its budget (the maker's warning).
   Worth weighs an area by the targets it catches, so a 60 ft blast weighs as the whole party.
2. **Each hit**: the single-hit bound of `tests/abilities.test.ts` (design section 6), once the rows are seeds.
3. **The set**: the odds engine plays the simulation's mixed party at the row's rank against the row's kind's fight, 150
   runs (`fight-sim.test.ts`'s noise floor for a share near 0.1), against design section 6's bounds where it has them:

| Kind | The fight | Bounds |
|---|---|---|
| normal | a pack of three of the row | cleared in 2 to 5 rounds; a hunter down in at most 1 fight in 10 |
| elite | the row in place of the elite brute of the simulation's "pack that can hurt" (two normal skirmishers) | **default** 3 to 6 rounds; a hunter down in at most 1 fight in 6 (between the pack's bounds and the boss's) |
| boss | the row alone | 4 to 8 rounds; a hunter down in at most 1 fight in 4; a death in under 1 in 20 |
| mythic | the row alone, at S | section 4 below |

A row under its low bound of rounds is too weak and gets a trait (tough, armored), not abilities. A row over a bound is
cut where its words allow (rounds, radius, a status), then loses its heaviest ability. A boss with five abilities still
acts once a turn, so "too much" is the measure, not the count.

## 3. Status spread (README item 3)

**Measured**: the sweep prints, for each status, the rows that carry it and the change in their odds when the status is
dropped from the ability. **Default**: no quota per status. A status is cut only where its row fails a bound, in this
order: its typed `rounds` goes back to the kind's default (`abilityKinds`), then to 1 round, then a paralyzed on a normal
below C becomes stunned for 1 round. The draft's typed lengths, reaches and blast sizes were picked by feel, so the sweep
keeps a typed number only where the row's words name it ("a breath that fills the hall").

## 4. Mythic (README item 4)

**Proposal: a fourth kind, `mythic`, as a row of `fight.kinds`** (`hp`, `power`, `armor`, `resist`, `stagger`, `xp`). The
23 rows take kind `mythic` in place of boss or elite. Their rank stays S and their level S's first.

Why a kind: a rank past S adds a row to every rank table (`rankTable`, `loot`, `rarities`, item tiers, gate DCs); a
tweak cannot be picked for a GM's own monster; a rule of its own says again what a kind says. `MonsterKind` is the key
of `fight.kinds`, so the typecheck names every table that must take the row.

Its numbers are **measured** by two simulation rows: M1, four hunters at S's first level win under 1 fight in 20; M2,
four hunters at level 100 (30 past S's first) win 1 fight in 4 to 3 in 4 (the owner's question 3).

**`unbeatable`**: no new mechanic. Each of the 23 lines is either built from pieces that exist (a starting status:
`regenerating`, a hide for "never seen whole"; an aura or a growing zone, `Ground.around` and `Growth`, for "its heat
ends a long fight" or "the field shrinks"; a timed summon, `Ability.summon`, for "calls more without end"), or the GM's:
a note starting "Unbeatable:" ("comes back whole", "his death is an object outside the fight", "knows each roll").

## 5 and 8. Extractable, and what a type means (README items 5 and 8)

**Default**: a type registry, `src/core/registry/monster-types.ts`, holds the 16 types as a union. Each type has one
column, `extractable`. A row is extractable if its seed says so, otherwise if its type says so, and a type the GM typed
that is not in the registry counts as yes. Not extractable by default: Construct, Ooze, Spirit (the README's list), and
every mythic row through its seed (the owner's question 4). Beyond that a type means nothing in a fight: damage is
physical or magical, and there are no elements to be weak to (question 5). The registry also gives the icons' type
defaults (`icon-defaults.ts`) a typed key in place of a string.

## 6 and 7. Notes that state a rule, and loot (README items 6 and 7)

**Default**: where an existing status or op does exactly what a row's first note says (regenerating, a hide, an aura),
the row carries it; every other rule-like note stays the GM's text. The sweep lists such notes found in 5 rows or more
(summons, splitting, flight) for a later mechanics pass. No row carries loot: a gate's fight pays the rank's loot rule
as today (`RULES.loot`, `gates/spawn.ts`, `gates/pay.ts`), and a named drop (a fang) stays a note until crafting exists.

## 9. The four penetration stats (README item 9)

**Shape.** Today the sheet has `pen` (a share, from Control, capped at `penCap` 0.4) and `penFlat` (gear only), and both
cut whichever of armor or resist the hit meets. These become four sheet numbers. The flat pair is in points. The percent
pair is in whole percent, as Tenacity and Potency already are, because an item's or a perk's bonus is a whole number
(perks are summed with `Math.trunc`):

| Sheet field | Shown as | Cuts | Sources |
|---|---|---|---|
| `armorPen` | Armor penetration (%) | armor | Control's curve to `penCap` (40), plus the bonus key `armorPen` |
| `resistPen` | Magic penetration (%) | resist | Control's curve to `penCap` (40), plus the bonus key `resistPen` |
| `armorPenFlat` | Lethality | armor | the bonus key only |
| `resistPenFlat` | Unravel (name: question 1) | resist | the bonus key only |

A rename changes only the labels. The four are bonus keys (section 10), so an item, a title, a path and the GM's grant
may each hold any of them, and every maker that loops the keys (`maker.js`, `inventory.js`, `hunter.js`, `skills.js`,
`custom.js`) gets the rows. `GearPiece.penFlat`, `Item.penFlat` and `Sheet.penFlat` are deleted. The status op key `pen`
in `SHEET_ADD_KEYS` becomes the four.

**Order and formula** (rule 12, `afterDefence` in `land.ts`): percent first, then flat, as today and as in LoL. The pair
is picked by the damage type, the same way the defence is:

```
def   = physical ? target.armor        : target.resist
pct   = physical ? user.armorPen       : user.resistPen        whole percent, at most fight.penMax
flat  = physical ? user.armorPenFlat   : user.resistPenFlat
left  = max(0, def * (1 - pct / 100) - flat)
dealt = max(1, round(max(0, raw - armorFlat * left) * armorK / (armorK + left)))     unchanged
```

`fight.penMax` (new, default 60) caps the percent with its bonuses, so armor always stops at least 40% of what it would;
Control's own part stays capped at `penCap`. (Today a status op clamps all of `pen` to `penCap` while a perk can pass it;
one cap, applied in `derive` and `withSheetOps`, ends that.) Percent scales with the defence and flat does not, so flat
is worth most against a pack's thin armor and percent against a boss's thick armor: the fairness the rows below check.

**Control feeds both percents** (default, question 2): today's measured rule, so no build moves until it wears something
new; physical builds get theirs from items, as in LoL. **Monsters** go through the same `derive`: a caster monster has
some of both percents, and none has flat (no gear, no perks, no trait gives it; "Steel Fangs" stays words).

**Today's content.** `Knight Killer` (`penFlat: 5`) becomes `bonus: { str: 2, armorPenFlat: 5 }`, armor only, as its
words say. `parseItem` reads an old `penFlat` as `bonus.armorPenFlat` (the one-way read at load, so a hunter's bag
survives). The loot maker's "Armor ignored on a hit" field goes. An old status `pen` op reads as `armorPen` and
`resistPen` of the same amount.

**Weight in the item budget.** `Unbudgeted` loses `penFlat`, and `BONUS_COST` gains the four keys. A key's cost is the
points of the power stat (Strength for the armor pair, Power for the resist pair) that would add the same damage to one
reference hit on one reference foe:

```
hit  = the tier's standard action in damage (ratesAt's `strike`)
foe  = a same-rank elite (rule itemBudget.penFoe): a brute's armor for the armor pair, a caster's resist for the resist pair
gain(key)  = (afterDefence(hit, wearer + 10 of key, foe) - afterDefence(hit, wearer, foe)) / 10
gain(stat) = afterDefence(hit + one point's power, wearer, foe) - afterDefence(hit, wearer, foe)
cost(key)  = gain(key) / gain(stat)      points per point of the key
```

The foe is named because penetration is worth more against a tougher one; the elite sits between a pack and a boss
(a **default**; the rows below can move it).

**Fairness against a boss that is tough only by HP, armor and resist** (new simulation rows, at C and S, **measured**).
A bruiser (armor pair) and a cannon (resist pair) each spend one tier's middle item budget three ways: on their main stat,
on percent, and on flat, converted at the rates above. The mixed party with each variant fights a same-rank pack and a
same-rank boss of the new body:

- P1: against the boss percent clears in fewer rounds than flat, against the pack flat in fewer than percent.
- P2: in neither fight does a variant clear more than 25% faster than the main-stat one: a counter, not a must-buy.
- P3: the mixed party's control takes 10 to 35% of a same-rank boss's turns (stagger counted apart), with the boss's
  Tenacity from its own Strength and Discipline. Control still matters against a boss, without a lock.
- The triangle's "cannon beats tank" row, whose lever is penetration, must still hold.

Levers if P1 or P2 fails, in order: `itemBudget.penFoe`, `fight.penMax`, the kinds' armor and resist. Each move goes in
`sim-log.md`, before and after.

## 10. Every stat an item may hold (the owner, Nov 21: "And armor and resist, hp, shield buffs from LoL, everything.")

Read as: a worn item may hold any stat a League of Legends item can. **One shape**: `ItemBonus` and the perks' bonus
become `Partial<Record<BonusKey, number>>`, where `BONUS_KEYS` (replacing `PERK_KEYS`) is the stat keys plus every
sheet number `derive` adds with `b(...)`. `derive` already takes any `SheetNumber` as a bonus key (`Bonus`); only the
item's and the perk's type stop at stats, max HP and max mana. Three sheet numbers stay out: `weight`, `armor` and
`resist` remain `GearPiece` fields, which is what a piece's weight buys (`freeGuard`), so each has one route. `sight`
stays out (it takes the higher, not the sum), as do `stride` and `shadows`, which no LoL stat names. A bonus adds after a
stat's curve cap, as perks do today, and never past a sheet clamp (speed's range, the d20 edge's cap).

| LoL stat | In the game | Key |
|---|---|---|
| Health, mana | max HP, max mana (bonus keys today) | `hpMax`, `manaMax` |
| Armor, magic resist | the item's `armor`, `resist` fields (today) | GearPiece |
| Attack damage, ability power, heal and shield power | physical, magical, support power, from the base stats an item can already raise. Not bonus keys (the owner, Nov 21: "Idk about attack and ability power. I think that's hard to do.") | none |
| Attack speed, move speed | speed (turns a round), move | `speed`, `move` |
| Crit chance, crit damage, tenacity, mana cost cut | crit faces, crit size, tenacity, cost cut | `critFaces`, `critSize`, `tenacity`, `costCut` |
| The four penetrations | section 9 | four keys |
| Shield granted (Sterak's), health regen | a worn status (`Item.worn`, today) with a `shield` op, or `regenerating` | none |
| Lifesteal, omnivamp | **new**: a share of HP damage dealt healed back after rule 14, with no cap (the owner, Nov 21: "No cap on life steal") | `drain` |
| Ability haste | **new**: whole points, League of Legends' formula, cooldown = base × 100 / (100 + haste): 100 halves a cooldown, 200 makes it a third, none reaches 0; no cap (the owner, Nov 21: "make haste work like it does in LoL now, where cdr adds in a way that's not purely additive. Look up their formula and use it.") | `haste` |
| Shields received stronger | **new**: `shielded` beside `dealt`, `taken`, `healed` in `SHARE_ON` | worn status |
| Mana regen, slow resist | not built: mana comes back on a clear by design; tenacity covers slows | none |

Our own sheet numbers that LoL lacks (potency, threat, hold, aim, reaction, will, opening, fatigue, carry) are keys too,
since the shape costs nothing per key.

**Weight in `itemSpend`.** `BONUS_COST` becomes a record over `BonusKey`, so the typecheck asks a cost for each new key.
A key a stat feeds costs the stat points that make the same change on the sample wearer, read the way `hpMax` is today
(`1 / r.hpMax`): `threat` by Presence, `speed` and `move` by Agility,
`critFaces` by Instinct, `critSize`, `costCut`, `potency` and `aim` by Control, `tenacity` by Strength and Discipline
together, and every other key by the stat that feeds it in `derive`. The four penetrations cost by section 9's rule. A
new key no stat feeds (`drain`, `haste`) costs its worth in standard actions over the reference fight, at the rate
a worn status pays (`r.strike / r.phys`). `tests/item-budget.test.ts` works each expected cost from that rule, not from
the code. A worn status's shield is weighed by `wornWorth`, as today.

## The units, in order

Each lands alone with its tests and `bun run test` green; two run side by side only where their files do not overlap.

| # | Unit | Model | Files it may change | Tests | What a table sees |
|---|---|---|---|---|---|
| 1 | The bonus shape and the four penetrations (sections 9, 10) | opus | `hunter/derive.ts`, `hunter/sheet.ts`, `hunter/inventory.ts`, `rules.ts` (`PERK_KEYS` to `BONUS_KEYS`, labels, `penCap`, `penMax`, `itemBudget.penFoe`), `combat/land.ts`, `combat/standing.ts`, `combat/op-amount.ts`, `combat/effect-ops.ts`, `combat/fight-parse.ts`, `status-refs.ts`, `registry/items.ts`, `registry/item-budget.ts`, `views/loot.js`, `features/economy/measure.ts` | `derive.test.ts`, `resolve.test.ts` (rule 12 for each type and pair), `item-budget.test.ts` (each key's cost from its rule), `items.test.ts` (an old `penFlat` read as Lethality), `rules.test.ts`, `rule-domains.test.ts` | four penetration lines on the sheet; a row per key in every maker; Knight Killer reads "+5 Lethality" |
| 1b | Lifesteal, ability haste, shields received (after the owner's question 6) | opus | `hunter/derive.ts`, `rules.ts` (their caps), `combat/resolve.ts` or `land.ts` (drain after rule 14), where a cooldown is set (`charge.ts` or `timeline.ts`), `combat/effect-ops.ts` and `standing.ts` (`shielded`), `registry/item-budget.ts` | `resolve.test.ts`, `effect-ops.test.ts`, `item-budget.test.ts` | an item that heals its wearer on a hit, or brings abilities back sooner |
| 2 | Monster body by rules | opus | `hunter/derive.ts` (`kitAt`, kind and trait factors), `rules.ts` (`kinds.*.armor`/`resist`, `traits`), `registry/monsters.ts` (`traits` on seed and tweak, the parser), `registry/worth.ts` (if it reads `kitGear`), `views/bestiary.js` (trait checkboxes), `tests/models/fight-sim.ts` (builds take `kitAt`) | `monsters.test.ts` (a trait's numbers from its rule; a parser case), `derive.test.ts` (armor at each rank from `piece`) | a boss card shows more armor and resist; a GM can tick "slow" |
| 3 | Mythic kind and type registry | sonnet | `rules.ts` (`kinds.mythic`), `registry/monster-types.ts` (new), `registry/monsters.ts` (extractable by type), `registry/icon-defaults.ts` (typed key), `views/bestiary.js` (kind select, if not read from `MONSTER_KINDS`) | `monsters.test.ts`, `rules.test.ts`, `icons.test.ts` | "Mythic" in the kind select; a Construct offers no Extract |
| 4 | The simulation | opus | `tests/fight-sim.test.ts`, `tests/models/fight-sim.ts`, `rules.ts` (numbers only), `rw/sim-log.md` | the rows P1 to P3, M1 and M2, the elite row, and every existing row still inside its bounds | nothing new; fights last as design section 6 says |
| 5 | The sweep script | sonnet | `features/enemies/measure.ts` (new), `features/enemies/check.ts` (trait names, the mythic kind) | the script runs green on the draft as it stands | nothing (a tool for unit 6) |
| 6 | Fit the rows | sonnet, two side by side | one helper on `draft.json`, one on `mythic.json`; each adds its exceptions to `README.md` under its own heading | the sweep: every row inside its bounds, or listed with a reason | nothing yet |
| 7 | Rows into the game, with icons unit 7b | sonnet | `registry/monsters.ts` or a new `registry/bestiary-rows.ts` for the 366 rows, `SeedTweak.icon` picks (`icons/design.md` unit 7), `tests/monsters.test.ts`, `tests/bestiary.test.ts` (new: the odds of the worst row of each rank and kind from the last sweep, named in the test), the fight doc's worst-case size test | the new bestiary test; `abilities.test.ts` covers every row; the fight doc stays under its cap | the codex lists 388 monsters (366 and the 22 seeds), each with a picture; gates spawn from them by rank |

Order and overlap: 1, 1b, 2 and 3 run one after another, since all change `rules.ts` and 1, 1b and 2 change
`derive.ts`. Unit 5 can be written beside 1 to 4 (it touches only its own files) but is run only after 4 lands. Unit 6
needs 4 and 5. Unit 7 needs 6. If the owner answers question 25 (Tenacity) differently, only unit 4's rows are run again.

## Questions for the owner

Each can be answered in a line. The default is what is built if there is no answer.

1. **Name for flat magic penetration**: Unravel, Spellbreak or Sever? *Default: Unravel.*
2. **Percent penetration from Control, for armor and magic both, as today?** Or armor percent from Strength? *Default:
   Control for both. Physical builds get theirs from items.*
3. **Mythic: beatable only far past S, or never inside the rules?** *Default: four hunters 30 levels past S's first level
   (level 100) win about half the time; at S's first level, under 1 in 20.*
4. **Not extractable: Construct, Ooze, Spirit, and every mythic?** *Default: yes, those four.*
5. **Do monster types mean anything in a fight** (a weakness, a resistance)? *Default: no, for now. A type decides only
   extraction and the default icon.*
6. **Lifesteal and ability haste as new item stats** (section 10)? *Built as unit 1b. The owner, Nov 21: "No cap on life
   steal, no make haste work like it does in LoL now, where cdr adds in a way that's not purely additive. Look up their
   formula and use it." So `drain` has no cap, and `haste` is whole points read by LoL's formula, base × 100 / (100 +
   haste), with no cap: a point of haste gives the same extra uses at any haste, and its item cost is linear in points.*
7. **Mana regen and slow resist left out** (mana comes back on a clear; tenacity covers slows)? *Default: left out.*
8. **May an item's bonus pass a stat's curve cap**, as a perk's does today (never a sheet clamp)? *Default: yes.*
