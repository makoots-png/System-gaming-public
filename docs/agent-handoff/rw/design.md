# The rework's design on paper

Every number below is printed by `bun scripts/rw-paper.ts` under the same section number. Its rule numbers are `RULES.fight` in `src/core/rules.ts`; the table `PAPER` at the top of the script keeps only the few numbers the paper check alone uses. Sources: the owner's words in `later-phases/combat-rework-notes.md`, the facts in `rw/inventory.md`, the lead's nine decisions in `rw/brief-design.md`.

## The summary: every decision on one page

1. **Turns come from a next-action time.** Each combatant has `at`; the lowest acts, then `at += round(1000 * cost / speed)`. A round is 1000 ticks. A delay, a slow, a stun and an extra turn are each one line of arithmetic on `at` or `speed`. A gauge and a re-rolled initiative were compared on numbers and dropped (section 1).
2. **Costs are quick 70, standard 100, heavy 150, and a tile walked 100/6.** A cost buys a share of the damage budget (0.7, 1, 1.5), so no cost is strictly better.
3. **Durations and cooldowns are in ticks**, not in the bearer's turns, so a slow shortens nothing for free. A per-round op settles pro rata at each turn start.
4. **Eight stats**, `str agi vit ins dis pre pow ctl`, each feeding at least two numbers, each through `eff(s) = 10 * (s / 10) ^ 0.8`. Every share, chance or rate uses `capped(x, cap) = cap * x / (x + 40)`. 12 creation points at level 1; 3 a level and the perk budgets stay.
5. **One `Sheet`** from `derive.ts` for hunters, monsters and shadows, 27 derived numbers, each with its formula and reason in section 2.
6. **A monster is a hunter of its rank's level** with an archetype's split and a kind's factors (normal, elite, boss), so one yardstick measures both sides.
7. **Three bars**: HP, fatigue (physical and aura, 55 back after a fight), mana (10 a major cast, back on a dungeon clear).
8. **Armor and Resist in place of AC**, `dealt = (raw - 0.03 * def) * 100 / (100 + def)`, penetration percent then flat, and a flat part of armor (3%) taken before the percentage so a weak hit loses more than a strong one, no true damage: a damage type that nothing reduces would make Resist and Armor both pointless on the ability that has it, and the GM can already write `pen` 100%.
9. **One avoidance rule.** Time to land is wind-up plus distance over travel speed; the target rolls one d20 (its Reaction against the user's Accuracy, edge capped at 6) and uses that share of the land time to move; where it ends against the shape gives caught, ring or out. No travel means Discipline resists on 12 or more (15 until round four of the simulation), and a resisted use deals half. The same d20 decides the crit.
10. **Positions are real from the start.** Square tiles of 5 feet, the 5-10-5 distance, and a fight with no map puts two lines 8 tiles apart on the same data.
11. **The extras**: a channel that grows one a turn to 5 and fires at half charge when broken; a threat table with taunt as a burst of twice the gap; a stagger bar on elites and bosses that costs 1.5 rounds and regrows 75%; shields where the larger holds; intent showing name and target, numbers on Reveal.
12. **Formulas are data with one parser**: numbers, dice, both sides' stats and `Sheet` keys, `+ - * / ^`, `min`, `max`, `charge`. It refuses only what it cannot read.
13. **The fight's rows carry everything** for every kind, and one `vitals` effect writes a local hunter's HP, mana, fatigue and statuses back to its sheet.
14. **A player may send two fight messages**, `step` and `cast`, each refused unless it is that hunter's turn and the `now` it saw is still current.
15. **The save goes to `schema: 4`** with no carry-over; an older save is kept in the backups with a plain message.
16. **The bounds of section 6 are written before any run**, with one lever each, and the paper check already shows the triangle at C and S, boss fights of 6.5 to 8.2 rounds and a channel completing 13 to 17% of the time unprotected.

## 1. The timeline

### 1.1 Three variants

(a) **A gauge.** Each combatant has a gauge from 0 to 1000. Time moves in steps of 100 ticks; each step adds the combatant's speed. At 1000 it acts and the gauge drops by 1000 (or to 0).

(b) **A next-action time.** Each combatant has `at`, the time of its next turn. The one with the lowest `at` acts; then `at += round(1000 * cost / speed)`.

(c) **Initiative each round.** Each round everyone rolls d20 plus a bonus from speed and acts once, high to low.

| Question | (a) gauge | (b) next-action time | (c) initiative each round |
|---|---|---|---|
| Data on a row | `gauge` and `speed`; the fight also needs the step count | `at` and `speed`; the fight holds `now` (the `at` of whoever acts) | `init` this round; the fight holds the round and the index |
| A slow or haste | Changes the fill per step from the next step | Changes `speed` and rescales the wait left: `at = now + (at - now) * old / new` | A bonus on next round's roll. A slow changes order, never how often |
| A heavy ability's delay | Subtract from the gauge after acting | `at += round(1000 * cost / speed)` with a larger `cost` | Has no meaning past "act last next round" |
| An extra-turn passive | Refill part of the gauge | Refund part of the cost: `at` moves back | A second slot in the round, a new special case |
| A stun | A flag the step loop checks | `at = max(at, now + duration)`, a floor on the next turn | A flag the round loop checks |
| Joining mid-fight | Gauge 0 at the current step | `at = now + opening(speed, d20)` | Rolls next round |
| What "a round" is | 10 steps | 1000 ticks of fight time | One pass of the list |
| Status durations, cooldowns | Steps | Ticks | Rounds (fair, since everyone acts once a round) |
| The log and the turn cue | `R` = steps / 10 | `R` = floor(now / 1000) + 1; the cue keys on `now` and the current id | As today |
| The order ahead on players' phones | Simulate step by step | Sort the rows by `at`, then repeat `at += interval`: a pure function of the rows | Only to the end of this round |
| Determinism and replay | Pure, but every turn walks the steps | Pure: same rows and commands give the same order | Needs a roll each round, carried by a command each round |

Table 1.1 shows what speed does in each. In (c) every speed acts 10 times in 10 rounds: speed only reorders, so "turns more often" (the owner's first sentence) is not reachable without a second mechanism. (a) with overflow kept counts the same turns as (b), but a turn can only start on a step, so a speed-130 combatant acts at 0.80, 1.60, 2.40 instead of every 0.77 rounds (table 1.2): the step size is a second number that distorts speed. (a) with the gauge reset loses turns (12 for 13). Table 1.4 is the sample five-combatant fight in all three; table 1.5 is (b) with a heavy ability, a slow and a stun applied by other combatants, where none of the three needs a branch in the loop.

**Chosen: (b).** It is the gauge of (a) with the step size taken to zero, so it is exact where (a) rounds; the order ahead is a sort of the rows; a delay, a slow, a stun and an extra turn are each one arithmetic line on `at` or `speed`. The numbers did not overturn the lead's lean.

### 1.2 Time

- `Tick` is a branded integer. **One round is 1000 ticks**, the time a speed-100 combatant needs for one standard action. Integers keep replay exact; 1000 keeps the rounding of an interval under 0.1% at speeds 40 to 250.
- **Cost** is a whole number in hundredths of a standard action: quick 70, standard 100, heavy 150. A tile walked costs 100/6, so a full round of walking costs 100 (section 4.6). Reason: a heavy ability costs half a turn more, which the table can feel and the order ahead can show, and a quick one costs 70 so that two quick actions cost more than one standard and the fast build cannot have both the turns and the damage.
- **The interval** of one action is `round(1000 * cost / speed)`.
- **The opening.** At the start, and for a combatant who joins, `at = now + floor(interval(speed) * (20 - min(20, d20 + insEdge)) / 20)`, where `insEdge` is the Instinct opening bonus (section 2). A 20 acts at once; a 1 waits most of an interval. Reason: the table still rolls for who goes first, and a fast combatant still tends to go first because its interval is shorter.
- **The tie rule.** Lower `at` first; then higher current speed; then the higher `tie` (a d1000 rolled when the combatant joins, carried by the command); then the lower id. The last step can never be reached by two rows, so the order is total.
- **Speed is clamped** to 40 to 250 after every status (`SPEED_MIN`, `SPEED_MAX`). Reason: at 40 a combatant still acts every 2.5 rounds; at 250 it acts 2.5 times a round. Outside that a player either waits through a whole table of turns or never lets anyone else play.

### 1.3 What uses time

- **Status durations are in ticks**, stored as `until: Tick`. A status counted in the bearer's own turns would end 2.5 times sooner on a fast bearer, so a slow would hurt a fast target least: the opposite of what a slow is for. A status ends when `now >= until` at the bearer's turn start.
- **A per-round op settles pro rata** at each of the bearer's turn starts: it applies `amount * (min(now, until) - settledAt) / 1000`, rounded to a whole number, then sets `settledAt`. The dice are rolled once per settle by the edge, as today. Table 1.6: 10 a round for 2 rounds is 20 in total on a speed-80, 100 or 200 bearer. A status therefore always settles fully at the bearer's first turn at or after its end, because a status is dropped only then.
- **Cooldowns are in ticks**: a used ability is ready again at `readyAt = now + cooldown * 1000`, kept on the combatant's row. Reason: speed buys more plain actions, not more of the strong ones, which is one of the two brakes on Agility (the other is the speed curve in section 2).
- **A stun** is a floor: `at = max(at, now + duration)`. No turn starts while stunned, so statuses settle at the first turn after it. A stun applied twice keeps the later floor.
- **An extra turn** is a refund: after the action, `at -= round(interval * refund / 100)`, at least `now + 1`. A 100% refund means the combatant acts again next unless someone else's `at` is already `now`.
- **The log prefix** is `R<floor(now / 1000) + 1>`. `Summary.rounds` becomes the fight's length in rounds with one decimal (`now / 1000` at the end).
- **The turn cue** keys on `now` and `currentId`; a phone shows "your turn" when `currentId` is its hunter. The order ahead is `ahead(rows, 8)`: the next 8 turns if everyone takes a standard action, drawn as a strip. Nobody promises it; a heavy ability or a slow redraws it.

### 1.4 What is deleted

`round`, `reached`, `Order.init`, `initMod`, `group` and shared initiative, `turnCmp`, `sortTurnOrder`, `forwardFrom`, `prev`, `rollInitiative`, `setInitiative`, `setShareInit`, `initiativeNeeds`, `InitRoll`. `prev` goes because time cannot run backwards without undoing every settle; an undo of the last command (keep the previous `Running`) replaces it. "No turn starts twice" becomes "`now` never decreases and every turn starts at the minimum `at`", which the model test can check after every command.

## 2. Stats and the `Sheet`

### 2.1 The stats and their curve

One `STAT_KEYS = ['str', 'agi', 'vit', 'ins', 'dis', 'pre', 'pow', 'ctl']` in `src/core/rules.ts`, labels Strength, Agility, Vitality, Instinct, Discipline, Presence, Power, Control. Every stat starts at 10. Points stay at 3 a level and the perk budgets stay (2, 2, 3, 3, 4, 4). **New: 12 creation points at level 1.** Reason: without them an E build differs from another by one 2-point perk, so the rock paper scissors cannot exist at the first session (table 2.1 shows the builds at E with them). 12 is four levels' worth: enough for a main stat of 20, not enough to skip D.

**Every stat goes through one curve first:** `eff(s) = 10 * (s / 10) ^ 0.8`, and `x(s) = eff(s) - 10`, the effective points above the base. Reason: today's `mod` is linear and uncapped, so an S main stat is worth 16 times a base one and decides every d20 (inventory 2.6). With the exponent 0.8 doubling a stat gives 1.74 times; an S main stat of 174 is worth 9.8 times a base 10 (table 2.2). Numbers that must stay inside a range then use **one capped curve**, `capped(x, cap) = cap * x / (x + 40)`: half the cap at 40 effective points (a C main stat has 34), 69% at an S main stat, never the cap. Below 10 (a stat lowered by a status) `capped` falls at its starting slope, so a lowered stat hurts at least as much as a raised one helps. Damage power uses `eff` without a cap, because damage must keep growing with rank; every number that is a share, a chance, a rate or a count uses `capped`.

### 2.2 The derived numbers

`derive(stats, level, gear, perks, statuses)` in `src/core/hunter/derive.ts` returns one `Sheet` for any combatant. `g(level) = 1 + (level - 1) / 24` is what level alone adds.

| Number | Formula | Stat | Why |
|---|---|---|---|
| Max HP | `g * 45 * (1 + capped(x(vit), 0.9))`, times the monster kind's factor, with `g(level) = 1 + (level - 1) / 24` | Vitality | Level carries most HP so a fight is a similar number of hits at every rank. Vitality's part is a share, so it is capped like every share, with Agility's cap on speed: 1.14 times at E, 1.41 at C, 1.62 at S, never 1.9, so a tank's toughness and a speed build's turns grow with rank at the same rate. It was `45 + 0.5 * x(vit)`, uncapped, until round two of the simulation: a tank was 1.09 times as tough as a speed build at E and 1.98 at S, and tank against speed went from 0.10 at C to 1.00 at S (`sim-log.md`) |
| Max mana | `10 + capped(x(pow), 30)` | Power | Mana counts big casts per dungeon, which should not grow with rank: an S cannon has 31, three major casts (section 3) |
| Fatigue capacity | `100 + capped(x(vit), 50)` | Vitality | Today's 0 to 100 bar keeps its thresholds as shares; Vitality makes a physical build last longer, not hit harder |
| Carry | `20 + capped(x(str), 50)` | Strength | Weight is what Strength lets you wear (the owner: "can't equip too much beefy stuff") |
| Speed | `(100 + capped(x(agi), 90)) * loadFactor`, clamped 40 to 250 | Agility, Strength | The cap 90 bounds a pure Agility build at 190 before load; the load factor is the counterweight |
| Load factor | `1 - max(bulk, 0.35 * clamp((weight / carry - 0.5) / 0.5, 0, 1))`, with `bulk = min(0.35, 0.025 * max(0, weight - 20))` | Strength | Free up to half the carry, then up to 35% slower at full carry. Reason: a light kit never slows, and a heavy kit on a weak body costs a third of your turns. **Bulk**: Strength lifts weight but does not shrink plate, so weight over a base body's whole carry (20) slows any wearer 2.5% a point (`bulkSlow`). Only plate has any (12 points, 30%): a tank runs at 70 at C and at S alike. Without it an S tank's Strength lifted its load to 87, its turns grew 1.24 times from C to S against the speed build's 1.15, and it beat the S speed build in every duel (round four, `sim-log.md`). Round three's floor on every kit was not taken, because it slowed the medium kit's wearers too; bulk leaves them alone |
| Move | `6 * speed / 100` tiles a round; stride `floor(move / 2)` tiles a turn | Agility | One number for running away and walking up; weight lowers dodge only through speed |
| Armor | kit armor `+ capped(x(vit), 30)` | Vitality | Gear carries most of it so the tank pays weight for it; Vitality gives a little to every body |
| Resist | kit resist `+ capped(x(dis), 40)` | Discipline | The magical twin of armor, from the will stat. Plate carries as much resist as armor (section 2.3), so a body in plate is not open to magic; what a caster has against it is tempo, Power and penetration |
| Penetration (share) | `capped(x(ctl), 0.4)`; flat penetration `penFlat` is the sum of the gear's | Control | Precision finds the gap; the cap keeps armor worth something against the best caster (at most 40% ignored) |
| Physical power `phys` | `0.6 * eff(str)` | Strength | Uncapped with diminishing returns: the stat a damage formula reads |
| Magical power `mag` | `0.6 * eff(pow)` | Power | Same curve as `phys`, so the two damage types are worth the same before defence |
| Support power `sup` | `0.6 * eff(pre)` | Presence | Heals, shields and team abilities read it; same curve |
| Reaction `react` | `10 + x(ins) + x(agi)` | Instinct, Agility | The target's side of the reaction roll (section 3.2). Noticing the blow is Instinct and getting the body moving is Agility (the owner: Agility is "speed and dodge"), so each counts once, the weight Instinct had alone. It stays on `eff`, the curve Accuracy is on, and the edge's cap of 6 bounds it. It was `eff(ins)` until round three of the simulation: a speed build had Reaction 10, the cannon's Control cancelled its dodge, and speed beat the cannon in 0.30 of duels at C (`sim-log.md`) |
| Accuracy `aim` | `eff(ctl)` | Control | The user's side of the reaction roll |
| Will `will` | `eff(dis)` | Discipline | Replaces Reaction against an ability with no travel |
| Crit faces | `1 + round(capped(x(ins), 5))`, 1 to 6 faces of the reaction d20 | Instinct | A crit is 5% to 30%: never more often than the 1-in-3 where it becomes the expected hit |
| Crit size | `1.5 + capped(x(ctl), 0.5)` | Control | 1.5 to 2 times: a crit is felt, and never more than today's "double the dice" |
| Opening bonus | `min(6, round(0.25 * x(ins)))` on the opening d20 | Instinct | "Reacting first" from the owner's list; capped at 6 so the die still decides 70% of the opening |
| Tenacity | `capped(x(sqrt(str * dis)), 60)` | Strength and Discipline (their geometric mean: equal scores give that score's tenacity, one at the base little) | Control durations are multiplied by `(100 + potency) / (100 + tenacity)`: at most 37% shorter |
| Potency | `capped(x(ctl), 50)` | Control | How well statuses land; mirrors tenacity so equal investment cancels |
| Threat multiplier | `1 + capped(x(pre), 1)` | Presence | A Presence build draws up to twice the threat for the same damage (section 4.2) |
| Channel hold | `0.15 + capped(x(dis), 0.25)` of max HP | Discipline | A single hit at least this big breaks a channel (section 4.1) |
| Cost cut | `capped(x(ctl), 0.25)` | Control | "Lower costs" from the owner's list; at most a quarter off |
| Shadow capacity | `floor(eff(pre) * 0.2)` | Presence | Replaces "army size is the INT score"; 2 at base, 19 for an S Presence build |

Each stat feeds at least two numbers: Strength (`phys`, carry, tenacity with Discipline), Agility (speed, move, reaction), Vitality (HP, fatigue, armor), Instinct (crit faces, reaction, opening), Discipline (resist, will, tenacity with Strength, hold), Presence (`sup`, threat, shadows), Power (`mag`, mana), Control (accuracy, penetration, crit size, potency, cost cut).

Tables 2.3.E, 2.3.C and 2.3.S print every number for the five builds: speed (Agility 2 : Strength 1, light kit), tank (Vitality 2 : Strength 1, heavy), cannon (Power 2 : Control 1, light), bruiser (Strength 2 : Vitality 1, medium), support (Presence 2 : Discipline 1, light). Points split 2:1, every perk on the main stat. The speed build takes Strength second because Agility alone deals no damage; its damage per hit is 60% of the bruiser's at C and its turns are 1.41 times as many.

**The speed bound: the fastest S build acts at most 2.5 times as often as the slowest.** Table 2.4: 2.31 between the five builds at S (the speed build 162, the tank in plate 70), 2.49 against the worst possible body (heavy kit on Strength 10). Reason for 2.5: the fast player acts twice and sometimes three times between two of the slow player's turns, which the table feels, and never four times, where the slow player sits out a whole pass of the table. Statuses can widen it to the clamp (40 to 250).

### 2.3 Gear and weight

Weight sits on the armour slots, the offhand and the weapon (head, chest, hands, legs, feet, offhand, weapon); neck and rings weigh 0. A kit is the sum. Table 2.5:

| Kit | Weight | Armor | Resist | What it is for |
|---|---|---|---|---|
| Light | 8 | 10 | 15 | Never slows anyone (8 is under half of the smallest carry, 20); robes carry a little resist |
| Medium | 18 | 30 | 5 | Free from Strength 33; 28% slower on Strength 10 |
| Heavy | 32 | 60 | 60 | Takes 37% off physical damage and as much off magic; costs 35% of speed on a weak body and at least 30% on any body (its bulk), so the tank runs at 70 at C and S. Plate stops a bolt as it stops a blade: the cannon beats the tank on tempo (it acts 1.4 times as often as a tank in plate), Power and penetration. Its resist was 0 until round two of the simulation, then 20 (a third of its armor); at 20 the cannon won 0.95, 0.97 and 0.98 of duels at E, C and S, and resist alone needed about 80 to bring them in, because the tank's turns, not its resist, decide the duel (round four, `sim-log.md`). At 60 they are 0.65, 0.75 and 0.86 |

An item gains `weight` (0 to 50) and may carry `armor`, `resist`, `pen` and `penFlat` in place of `ac`. Rarity raises armor and resist by its index (common +0 to mythic +5 each), not by a multiple. Reason: armor is a share stopped, and a share that grows with rarity would make an S tank immune.

### 2.4 Monsters

A monster is built by the same `derive`: a monster of rank R is a hunter of R's first level with its creation points and level points split 2:1 by its archetype (no perks), in its archetype's kit, times its kind's factors. Archetypes: brute (Strength 2 : Vitality 1, medium), skirmisher (Agility 2 : Strength 1, light), caster (Power 2 : Control 1, light). Kinds: **normal** HP 0.6 and power 0.7, **elite** HP 1.5 and power 1, **boss** HP 3.2 and power 1.2, plus a stagger bar and a flat control resistance (section 4.3). Table 2.6 prints all 27.

Reasons: one curve for hunters and monsters keeps "a same-rank hit" the same yardstick at every rank (phase 4's finding); a normal monster is a weaker body so a party of three beats a pack of three; a boss has 3.2 bodies of HP with one turn. It was 4 bodies until the simulation (unit 5, `sim-log.md`): at 4 the S party needed 9.8 rounds, past the 8 a boss fight may last, because the tank spends most of its turns taunting; at 3.2 the C and S boss fights are 6.0 and 7.9 rounds. `rankTable` loses `hp`, `ac`, `atk`, `dmg` and `init` and keeps `dc`, `xp` and `breakDays`; the boss and elite factors replace `boss` and `elite`. A seed row becomes `[slug, name, rank, archetype, tweak, abilities, desc]`; `tweak` may scale HP and add to named stats, and carries no AC.

## 3. One use, end to end

### 3.1 The order of resolution

`resolve(ability, user, targets, places, rolls)` in `src/core/combat/resolve.ts` is pure. The edge first asks `needs(enc, by, abilityId, aim)` (as `initiativeNeeds` does today) for the dice to roll: the formula's dice once per target and one reaction d20 per combatant inside the shape's reach. It rolls them and sends `act`. The reducer refuses the whole use with a `refused` effect if any rule below refuses, and changes nothing.

1. **Turn.** `by` is `currentId`. (The GM may act for anyone with `act.force: true`, logged as such; a player's phone never sends `force`.)
2. **Taunt.** If `by` holds a taunt whose source is up and a legal target in range, an ability aimed at a foe must aim at the source or at a place whose shape holds the source.
3. **Cooldown.** `now >= readyAt[ability]`.
4. **Cost.** Fatigue and mana are `ceil(cost * (1 - costCut))`. Mana must be on hand; fatigue may go up to the capacity (at the capacity the user collapses at the end of the use, as today at 100). Both are paid here, before anything can miss.
5. **Range.** `dist(user, aim) <= range` with the 5-10-5 distance (section 5). A touch's range is its reach.
6. **Who is in the shape** at the moment of use, from the aim and the places: touch (the one target within reach), line (every tile on the line from the user to the aim, `width` tiles either side; a non-piercing line stops at the first body), radius (every tile within `radius` of the centre, and the ring to `ring.outer`). An ability marked `foesOnly` skips the user's side. Self and ally abilities skip to rule 10.
7. **Time to land.** `land = windup + dist / travel`, in rounds. `travel: 'instant'` means the wind-up alone. An ability with `delivery: 'direct'` has no land time and goes to rule 8b; `delivery: 'sure'` skips 8 and 9 (caught, no crit).
8. **Where each target ends.**
   a. Travel: the target's `can = floor(move * land * share)` whole tiles, where `share = clamp((d20 + edge) / 20, 0, 1)` and `edge = clamp(round(0.25 * (react - aim)), -6, 6)` (its Reaction against the user's Accuracy). A rooted target has `move` 0. Core picks the best tile within `can` steps that no body or wall fills: out of the shape, else in the ring, else the nearest to out; on a tie the fewest steps, then the lowest `y`, then `x`. If the outcome is out or ring, the token moves there (it dodged); if caught, it stays.
   b. Direct: resisted when `d20 + edge(will, aim) >= 12` or the d20 is 20. A resisted use deals `0.5` of its damage and applies no status. The DC of 12 (`resistDc`) resists 45% of uses at parity and 15% to 75% at the edge's cap, so the die decides even against a caster's best Control, as it does for a dodge. It was 15 until round four of the simulation: a C cannon's curse was resisted 10% of the time and an S one's only on a natural 20 (`sim-log.md`).
   The outcome is `caught`, `ring`, `out` or `resisted`.
9. **Crit.** Caught (or not resisted) and the target's d20 is at most the user's crit faces. The low faces of the target's die are the moments it froze; the user's Instinct widens them.
10. **The formula.** Evaluated once per target with the user's and target's stats and `Sheet`, the dice for that target in reading order, and `charge` (section 4.1). A heal or shield formula reads the same way.
11. **Multipliers.** Crit size; the ring's share; a resisted use's 0.5. In that order, no rounding yet.
    b. **Cover.** A target standing on a cover tile takes `coverShare` (0.25) less from a damaging use that travels to it across the ground: a line or an area with `delivery: 'travel'`. A touch takes nothing off: it reaches round the cover. Reason: the d20 table's three-quarters cover is +5 to hit, a quarter of the die, so a quarter less damage is the same weight in a game with no to-hit roll; half would make a shooter's turn against cover not worth taking.
12. **Defence.** Physical against armor, magical against resist: `def = max(0, def * (1 - pen) - penFlat)`, `dealt = max(1, round(max(0, raw - 0.03 * def) * 100 / (100 + def)))`. The flat part (`armorFlat`, 3% of what is left) is taken before the percentage, so a weak hit loses more than a strong one: "speed cannot get through armor". It mirrors penetration's flat part, and was added in round two of the simulation (`sim-log.md`). A heal or shield skips this.
13. **Shield.** The target's shield absorbs first (section 4.4); the rest is HP damage.
14. **HP.** At 0 a monster or shadow is down and `defeated` is emitted; a hunter goes to `dying` through `Vitals`, as today.
15. **Threat.** If the target keeps a threat table (a monster), add `dealt * user.threat` for the user (section 4.2).
16. **Stagger.** If the target has a bar, fill it (section 4.3).
17. **Channel.** If the target is channeling and the HP damage of this hit is at least `hold * hpMax`, the channel breaks and fires at once at half charge (section 4.1).
18. **Statuses.** Each op the ability applies goes on through `applyStatus` with the user as source. A control status (speed down, hold, root, taunt) lasts `duration * (100 + potency) / (100 + tenacity)`, times 0.5 on a boss and 0.75 on an elite.
18b. **A field.** An ability with a `zone` leaves it on its shape's tiles (the splash and the ring) where it landed, or around its user (an aura, section 4.8), owned by its user at its tier, sparing the user's side when the ability spares it (`foesOnly`) and the other side when it is aimed at an ally or its user, from now for its duration (section 4.7). With 16 zones on the ground it leaves none.
19. **Time.** The user's `at = now + round(1000 * cost / speed)`, then any `delay` op on the user, then any refund. `readyAt` is set from the cooldown.
20. **Log.** One line per use, naming every target's outcome and number.

### 3.2 The reaction roll

One d20 per target, rolled by the GM's phone (it holds the fight; section 5.5 says how a player can roll their own). Table 3.1 shows its spread: at edge 0 the target uses on average 52% of the land time and all of it 5% of the time; at the cap of 6 either way, the die still decides between a quarter and three quarters of the outcomes. Reason for the cap: the inventory showed a linear bonus making the d20 decide nothing by rank C; with a cap of 6 on a d20 the die always decides. The same die makes the crit, so every use against a foe rolls exactly one d20 and the user's damage dice.

### 3.3 Types

```ts
type Tick = number & { readonly __tick: true };            // fight time; 1000 a round
type Tiles = number & { readonly __tiles: true };          // a whole number of tiles
type Place = { readonly x: number; readonly y: number } & { readonly __place: true };
type Percent = number & { readonly __pct: true };          // 0 to 100
type AbilityId = string & { readonly __ability: true };
type DamageType = 'physical' | 'magical';
type Shape =
  | { kind: 'self' }
  | { kind: 'touch'; reach: Tiles }
  | { kind: 'line'; width: Tiles; pierce: boolean }
  | { kind: 'radius'; radius: Tiles; ring: { outer: Tiles; share: Percent } | null };
type Delivery =
  | { kind: 'travel'; windup: Tick; speed: number | 'instant' }   // tiles a round
  | { kind: 'direct' }                                           // no travel: Will resists
  | { kind: 'sure' };                                            // nothing avoids it
type AbilityKind = 'strike' | 'shot' | 'blast' | 'curse' | 'support';
type Cost = { fatigue: number; mana: number; time: number; cooldown: Tick };   // time in hundredths of a standard action
type Ability = {
  id: AbilityId; name: string; kind: AbilityKind; cost: Cost;
  aim: 'foe' | 'ally' | 'self' | 'place'; range: Tiles; shape: Shape; delivery: Delivery; foesOnly: boolean;
  effect: { type: DamageType; formula: Formula } | { type: 'heal' | 'shield'; formula: Formula } | null;
  ops: readonly Op[];                          // applied to each caught target, as today's `effects`
  channel: { growth: 'linear' | 'exponential'; max: number } | null;
  formulaEdited: boolean;                      // the maker's "edited" mark
};
type Avoid = 'caught' | 'ring' | 'out' | 'resisted';
type Outcome = {
  target: CombatantId; avoid: Avoid; to: Place | null; crit: boolean;
  raw: number; dealt: number; absorbed: number; type: DamageType | 'heal' | 'shield';
  statuses: readonly StatusKey[]; threat: number; stagger: number; channelBroken: boolean; down: boolean;
};
```

**One damage budget by cost.** A kind's default formula is scaled by its cost: a quick ability deals 0.7 of a standard's damage, a heavy one 1.5. Reason: without it a cheap action is strictly better, and the paper check showed exactly that (a speed build with a full-damage quick shot beat the tank it should lose to). What a cost buys is the shape of the turn, not damage per unit of time: a quick action is flexible and spreads damage, a heavy one front-loads it and hits an area.

`AbilityKind` gives the defaults the maker fills and the GM may change; the numbers among them (wind-ups, travel, ranges, radius and ring, fatigue, mana, cooldowns) are `RULES.fight.abilityKinds`, so a rule override reaches them, and `ability-kinds.ts` holds each kind's form: strike (touch reach 1, travel with wind-up 100 and `instant`, physical, standard), shot (line width 0, wind-up 100, travel 80, range 12, quick 70), blast (radius 2, ring 3 at 50%, wind-up 1000, `instant`, range 10, heavy), curse (direct, range 8, magical), support (ally, sure, no damage). Reason for each wind-up: a swing is over before a body can step out of reach (table 3.A: even a d20 of 20 gives 0 tiles); an arrow is dodged by a fast body about half the time and a normal one a fifth (table 3.B); a blast is a telegraph a fast body leaves and a slow one does not (table 3.C). The blast's wind-up was 600 until round three of the simulation: in 0.6 round the C speed build got out a quarter of the time, and two blasts killed it; at a full round, with Reaction from Agility, it is out 85% of the time and the C tank 10%.

New `Command` members (old ones in section 7.2): `start { openings: { id, d20, tie }[] }`, `act { by, ability, aim: Place | CombatantId, rolls: { dice: Record<CombatantId, number[]>, react: Record<CombatantId, number> }, force? }`, `move { by, to: Place, dash?: boolean }` (a dash, section 4.6), `endTurn { by }` (a pass: standard cost), `release { by }` (fire a channel), `setIntent { by, ability, aim }`, `place { id, to: Place }` (the GM's free drag, no time), `settle { id, key, dice: number[] }`, `undo`.

New `Effect` members: `vitals { hunterId, hp, life, mana, fatigue }` (the one write-back of a local hunter: the row is the fight's home for HP, mana, fatigue and statuses of every kind, and `send()` writes this to the sheet through `vitals.ts` in the same store update), `rollSettle { id, key, dice, share }`, `moved { id, to }` (the map animates), `channel { id, state }`, `staggered { id }`. `turnStarted`, `sendRemote`, `defeated`, `ended`, `refused` stay; `hunterHp`, `hunterMp`, `hunterFatigue`, `hunterStatuses`, `shadowHp` and `rollTick` fold into `vitals` and `rollSettle`.

New op kinds (each with `tiers` like phase 4, and `when` as today): `damage` and the per-round damage op gain `type: DamageType`; `speed { pct }` (signed); `delay { ticks }`; `hold { }` (a stun: the floor of section 1.3); `root { }` (move 0); `taunt { }` (forced target and a threat burst); `threat { amount }`; `shield { formula }`; `channel { mode: 'protect' | 'break' }`; `staggerRate { pct }`; `stat { key: StatKey, amount }` (up or down, through `derive`); `refund { pct }` (an extra-turn passive: `chance` in percent, rolled on the user's d20). The `mod` op on `ac`, `atk`, `dmg` and `check` is deleted with AC.

### 3.4 The formula

`src/core/formula.ts` owns `parseFormula(text): { ok: true; formula: Formula } | { ok: false; at: number; message: string }` and `evaluate(formula, scope, dice: number[]): number`, plus `diceOf(formula)` for `needs` and `average(formula, scope)` for the maker's preview.

```
expr   = term (("+" | "-") term)*
term   = unary (("*" | "/") unary)*
unary  = "-" unary | power           so -2^2 is -4
power  = atom ("^" unary)?           right-assoc; 2^-1 reads
atom   = number | dice | name | "target." name | ("min" | "max") "(" expr "," expr ")" | "(" expr ")"
dice   = int "d" int                 at most rules.dice limits, as today
name   = a stat key | a Sheet key | "charge"
```

It refuses only what it cannot read: an unknown name, a bad token, a dice size over the limit; never a strong formula. Division by 0 is 0. A `Formula` is the parsed tree, stored with its text, so a saved formula is parsed once at the save boundary and trusted after.

### 3.5 The worked examples

The script prints all three with every step: 3.A a sword swing at touch (a C bruiser deals 29 of a C skirmisher's 48 HP; no face of the d20 gets it out), 3.B an arrow at 8 tiles (a speed-100 target dodges on 17 or more, a speed-141 target, whose Agility gives it an edge of 6, on 6 or more), 3.C a slow blast with a ring (wound up a full round: the fast speed build, edge 4, is never caught, in the ring 15% and out 85%; the slow tank, edge -4, is caught 65%, in the ring 25% and out 10%).

## 4. The extras

### 4.1 Channel

A channel is a small machine on the combatant's row: `channel: { ability, aim, charge, state } | null`, with `state` one of `holding`, `fired`, `broken`. Its chart goes in `scripts/charts/channel.ts`.

| From | Event | To | What happens |
|---|---|---|---|
| none | `act` on an ability with `channel` | holding, charge 0 | The cost is paid once, at the start |
| holding | the channeler's turn starts | holding, `charge = min(charge + 1, 5)` | Growth is one a turn, so a fast channeler fills faster. The turn is spent: nothing else acts. Its threat follows its payoff: every foe's entry for the channeler is multiplied by what the charge multiplied the payoff by (1.45 exponential, `(1 + 0.5k) / (1 + 0.5(k - 1))` linear), and it does not fade while the channel holds |
| holding | `release` | fired | Resolves at the current charge, costs the ability's time |
| holding | charge reaches `max` | fired | It goes off by itself, so a channel is never a permanent threat |
| holding | a single hit of at least `hold * hpMax`, or a `hold` (stun), `root` or `taunt` op lands | broken then fired | It resolves at once at `floor(charge / 2)` (the owner's "fires early with a penalty") |
| holding | the channeler acts, moves or goes down | broken | Going down fires nothing |

`charge` is a name in the formula. The maker's tick writes `base * (1 + 0.5 * charge)` (linear) or `base * 1.45 ^ charge` (exponential). Reason for 1.45: at the cap of 5 an exponential channel is 6.4 times its base, which is 86% of a same-rank boss's HP (table 4.1), so the owner's "if a heavy power character can focus for 5 turns his next one should probably oneshot someone" holds against a normal monster and nearly against a boss, after five turns of doing nothing and surviving every attempt to break it. Linear at 5 is 3.5 times, the safe tick for a GM who does not want that.

Break thresholds are in table 4.2: a cannon's channel breaks to any single hit of 0.59 to 0.64 same-rank hits or more, an S support's needs 1.14. Reason for `hold` starting at 0.15: at 0.15 a weak chip hit (a status tick) never breaks a channel, and one real attack always does unless the channeler invested in Discipline. The simulation found that a lower `hold` changes nothing (every boss hit already breaks a cannon's channel); what decides how often a channel begun under a boss's aim completes is whether the boss keeps aiming at the channeler (round three, `sim-log.md`).

**A channel draws threat.** A wind-up every foe can see is a threat in itself, and a channeler is not idle, so while a channel holds its threat follows its payoff (the table above) and does not decay. Reason: round four of the simulation found the boss standing 1 or 2 tiles from a cannon that began a channel under its aim in 205 of 257 channels, and still turning to the bruiser and the speed build on 9 of its 10 turns, because a channeler deals no damage and its threat faded while theirs grew; 0.49 of those channels completed. With the rule the boss stays on the channeler on about half its turns, 0.12 complete, and a taunting tank still protects 0.72: the taunt is what makes a channel near a boss work, which is what the bound asks. The growth alone (with decay) gave 0.26, the no-decay alone 0.45.

### 4.2 Taunt and threat

A monster's row holds `threat: Record<CombatantId, number>`. Rule: on every use that damages the monster, `threat[user] += dealt * user.threat`. At the monster's turn start every entry falls 10% (`t *= 0.9 ^ (elapsed / 1000)`, so decay is in time, not turns). The suggested target is the highest entry, drawn on the monster's card with the list behind it; the GM may target anyone, and the log records when it did not follow the suggestion.

Table 4.3: three C hunters on one monster. The cannon leads from round 1 because it deals the most, which is what the rule is for. A `taunt` op adds twice the taunter's gap to the leader, so the taunter leads at once and stays ahead for several rounds after the forced window ends, and forces the target for 2 rounds before tenacity (table 4.4: 1.77 rounds on the C bruiser, the build with the most tenacity). Reasons: 2 rounds is one or two of the monster's turns, long enough to pull a monster off a dying hunter and short enough that a tank must keep taunting; the burst of twice the gap is the smallest rule that makes a taunt matter after it ends without a number the GM must tune. Decay of 10% a round means a hunter who stops attacking fades out of the table in about 7 rounds.

A monster of kind boss takes a `taunt` at half duration, and a `hold`, `root` or `speed` op at half as well (its flat resistance; an elite at 0.75).

### 4.3 Stagger

A bar on elites and bosses only: `stagger: { fill, max } | null`. `max` is 2.5 same-rank hits for an elite and 4 for a boss (table 4.5). Each hit adds its HP damage; a weak hit, under a third of a same-rank hit, adds 1.5 times its damage. Reason: the owner wants weak hits to fill it, and 1.5 pays a chip build without making chips the way to kill. When it fills, the boss's `at` moves to `now + 1500` ticks (1.5 rounds, so it misses one turn and part of another), the bar empties and `staggered` is emitted. A full bar needs 4 hits of a same-rank hit; a boss lives 17 to 24 hits (table 4.5), so an all-in party could fill it 4 to 6 times. **The bar refills to a `max` 75% larger after each stagger**, which brings a fight to one or two staggers, the bound in section 6. It was 50% until the simulation (unit 5, `sim-log.md`): at 50% the bars of an S boss fill at 4, 6 and 9 hits, and a party that deals about 24 same-rank hits filled the third in 3 fights of 10; at 75% they fill at 4, 7 and 12.3, and no boss fight at C or S had a third stagger. That is one more rule, and it is cheaper than a cooldown the GM must track.

### 4.4 Shields

`shield: { amount, until: Tick } | null` on the row. Damage takes the shield first; `absorbed` is on the outcome. **Two shields do not add: the larger amount holds, with the later expiry of the two.** Reason: stacked shields replace HP (the lead's note), and the larger-holds rule is the same stronger-wins rule statuses already use, so there is one rule in the codebase, not two. A support's shield is `sup * 1.5`, which absorbs 1.45 to 2.05 same-rank hits and is 26% to 35% of a tank's max HP (table 4.6), so a shield buys a turn and not a fight. Expiry is 2 rounds.

### 4.5 Intent

A monster's row holds `intent: { ability, aim } | null`, set by the GM (the `setIntent` command) and cleared when it acts. The encounter doc carries `intent: { name, target, reveal }`: players always see the ability's name and its target, and the numbers only when the GM taps Reveal. Reason: Slay the Spire's intent is what makes a turn a decision; hiding the numbers keeps the GM's room to improvise. A monster that is channeling shows its channel as its intent with the charge, because the table can see it winding up.

### 4.6 Movement

`move { by, to, }` costs `round(100 * tiles / 6)` hundredths of the mover's own standard action and at most a stride, `ceil(move / 2)` tiles. Table 4.7: everyone walks exactly their `move` tiles per round of absolute time, the same rate a dodge uses, so a tile costs the same fraction of a turn for everyone and speed is the only thing that makes a body faster. The path is tile by tile with the 5-10-5 distance; it cannot cross a body or a wall. A `root` op sets move to 0, which refuses the command; a `speed` op changes `move` through the `Sheet`, so a slow shortens a stride and a walk at the same time. Rough ground costs two steps a tile to enter (`TERRAIN`'s `enter`, section 5.3), on the same rule; a zone that slows is a speed op, so it shortens the stride instead.

**A dash** is `move` with `dash: true`: up to the whole `move` (rounded down) in one straight line, the centre line a line ability uses, measured by the 5-10-5 distance, with no body or wall on any tile of it; it costs `dashTime` (100, the time of a standard action) and `dashFatigue` (16, twice a strike's), fatigue rising to the capacity at most. A root refuses it as it refuses a walk. Reason: a charge is how a heavy fighter closes on an archer, and it costs breath. Every body may dash. Round three of the simulation found what the time means: a walk covers 6 tiles in a standard action's time at any speed (that is what `move` is), so a dash of `move` tiles for a standard action is quicker than walking only for a body faster than 100 (the C speed build runs 8 tiles where it walks 6) and slower for every heavy body (the C tank runs 4 where it walks 6). The tank's policy charges only when the charge is the quicker way in, so at 100 it never does; `sim-log.md` has the numbers at shorter times.

### 4.7 Zones (lasting fields)

A zone is tiles of the grid with an owner (a combatant, or none for the GM and the map), the side it spares (or none), an end in fight time (`until`, or none) and status ops (`zones.ts`). A body that stands in a zone holds its ops as a status, the zone's hold (`Status.zone`), which `zoneSync` puts on and takes off after every change of a place, a zone or the time. The rules, each with its reason:

- **A per-round op pays for the time inside**, through the statuses' own settle: at the body's turn start it is paid `rate * time inside since it last paid`, rounded as a status's running total, so the total over a span does not depend on how the span is split into turns. Reason: one rule for "something hurts each round", the status's, already tested by 2,500 random fights; a second settle would drift from it.
- **A standing op (speed, root, a stat, a hold) acts only while the body stands inside.** When it leaves, the hold keeps only its per-round ops, which settle up to the moment it left, and then it ends. Reason: mud slows who is in the mud, not who walked out of it.
- **Each entry pays the zone's on-entry part once** (its ops `when: 'use'`), and each entry is a new hold, so the time between two entries is never paid. Reason: a trap or spikes hurt on the step in; standing still in them is the per-round part's job.
- **A zone ends at its `until`, or when its owner goes down or leaves the fight if it ends with its owner** (the ability says so). The holds close at its end, paying up to it. Reason: a caster's ward that outlives the caster is a GM's call, so it is a tick in the maker, not a rule.
- **Zones do not react with each other, and two zones on one tile each apply**: each gives its own hold, and the stronger-wins rule of statuses applies per op kind (`modsOf`), so two slows do not stack (the strongest slow holds); two burns both burn, as two burning statuses of different keys do. Reason: the one rule statuses already have; a reaction table (fire on oil) is a GM's ruling, not a number.
- **Terrain that hurts (lava) is a zone with no end and no owner**, not a sixth terrain kind, so there is one rule for "the ground does something". A map's zones are its permanent ones.

The doc carries a zone's tiles the party sees, as runs of tile indices ("45+3,65+5"), its tone (from its ops: harm, help, hinder, plain) and its rounds left. A built-in that leaves one: Vulcan's Inferno leaves burning ground for 2 rounds, the built-in Burning's ops at Vulcan's tier (B: 4d10, 22 at mean a round). Its hit and one round of the ground on a B tank: 14 + 22 of 164 HP, 22%, inside the single-use bound of section 6 (60%), which tests/abilities.test.ts measures for every built-in blast that leaves a field.

### 4.8 Fields that move and spread, and the map's size

the owner, Nov 14: "What about if you give someone a radiating like sickness/spreading effect, how about like a player aura ability where it heals or does dmg surrounding them and they move? Also can we make it adaptable to make there be more or less tiles". Four rules answer it. Each keeps section 4.7's one rule for "a body stands in a zone", so a hold, its settle and its entry are the same code for all of them.

**A zone's ground is one of two kinds** (`Ground` in `zones.ts`): `tiles`, a fixed list (what the GM paints, a map's zones, a line's or a touch's field), or `around`, a radius around an anchor, with an optional growth. The anchor is a place (the centre of a blast's field) or a body (an aura). An `around` zone stores no tiles: `zoneTiles` works them out from the anchor, the radius at `now` and the grid each time `zoneSync` runs, which is after every change of a place, a zone or the time. So a field and its tiles cannot disagree, and a fixed zone and an anchored one are two members of one union that the compiler tells apart. A blast's field is `around` its centre from now on, with or without growth; a fixed list of the same tiles would be a second way to say it.

(a) **An aura** is a zone `around` a body.

- It moves with its anchor. Whatever moves the anchor (a walk, a dash, a dodge, a GM's drag) is a change of a place, so `zoneSync` lays the aura again on the next call. A body the aura moves onto has entered it and pays the entry once; a body that stays inside while the aura moves keeps its hold and pays nothing more. Reason: section 4.7's entry rule, unchanged. A trap does not care whether you stepped on it or it stepped on you.
- It ends with its anchor: when the anchor goes down or leaves the fight, and an aura a status gives off also when the anchor no longer holds that status. Reason: an aura of someone who is not there has nothing to be around.
- **Whether the anchor itself is inside** is decided by where the aura comes from. An aura an ability leaves around its user holds the user as any body (so "Mending aura" heals its caster too), and the zone's `spares` then decides as for every zone: a damage aura of an ability marked `foesOnly` spares the user's side, the user among it. An aura a status gives off never holds its bearer (the anchor field `status`, the status's key, is the flag). Reason: the status's own ops already act on its bearer; inside its own aura it would pay them twice.
- **It does not pass a wall.** Its tiles are those within its radius that its anchor `sees`, the blast's rule of section 5.3 (`tilesOf` of a radius shape). Reason: one rule for an area. A wall is where a party hides from a fireball and from a plague-bearer's breath alike, and a GM reads both with the same ruler.
- **An ability's field and its sides.** Rule 18b gains one case: a field left by an ability aimed at an ally or at its user spares the other side. Reason: a support's use reaches only its own side, so its field does too; without the rule "Mending aura" heals the monsters around its caster.
- **A status may give one off** through a new op, `aura { radius, on }` (`on`: all, allies or foes of the bearer). The aura holds the status's other ops, so a body near the bearer feels what the bearer feels; it is named for the status, read at the status's source tier, and lasts as long as the bearer holds the status. An op, not a field of `StatusDef`: every op is something the status maker offers through its effects editor (the op-kind recipe), so a GM's own status can carry an aura with no new form, and the round-trip test asks for it. The aura's ops are the status's own rather than a nested list because a GM then makes "Radiating sickness" once: the sickness and what it gives off are the same thing. An `aura` or a `spread` op of the status is not given off (an aura of auras would chain with no end). A status's first `aura` op counts; a second one does nothing.
- `zoneSync` keeps a status's aura in the fight's `zones` like any other: it adds the zone when the bearer holds the status, updates it when the status's def or source changes, and drops it when the status ends or the bearer goes down. With `MAX_ZONES` (16) on the ground it adds none, as rule 18b leaves none.

(b) **A field that grows.** An `around` zone may grow: its radius at `now` is `min(cap, radius + step * floor((now - from) / round))`, where `from` is when it was laid. A blast's field grows from its centre and an aura from its body. A fixed `tiles` zone does not grow: it has no centre, and a dilation of a painted shape is not something a GM can predict from the map. The new tiles count from the first call of `zoneSync` after the round's boundary, which is the next command or turn start. Nobody acts between two of those, so a body the field reaches in between pays from the moment the fight notices. That is less than a round, and the per-round ops then pay by time as section 4.7 says. The maker's growth is 1 tile a round (`RULES.fight.fieldGrow`). Reason: one ring a round is a pace a walker at `move` 6 always outruns, so a growing field pushes the party back rather than catching it. The cap is the ability's, at most `fieldRadiusMax`.

(c) **A sickness that spreads**: a status op `spread { range }`.

- At each settle of its bearer (its turn start) in which a new whole round of holding the status has begun since the last settle (counted from the status's `since`), every body within `range` tiles of the bearer that the bearer `sees`, that is up, that does not hold the status now and that has never held it in this fight makes a resist roll. On a fail it takes the same status, with the same def and the same source, for the status's original length (`until - since` of the bearer's copy; until removed stays until removed). Reason for "a new whole round": a fast bearer has more turns, and a sickness does not pass faster because its bearer acts faster. Reason for the original length: each new bearer is as sick as the first was.
- **The roll** is rule 8b's resist, `d20 + edge(target's Will, bearer's Accuracy) >= resistDc` or a 20 resists, the die a curse is resisted with, so the GM has no new number to learn. The bearer's Accuracy, not the first source's: the sickness passes from the one who has it, and the first source may be gone.
- **It ends.** The fight keeps the list of who has held each spreading status (`Fight.had`, by status key), marked by `reduce` after every command as it marks the fog. A body on it never catches that status again in this fight, so the status reaches each body at most once, a chain of catches is at most as long as the fight has rows (60), and two bodies cannot hand it back and forth for ever. The list keeps at most `MAX_SPREAD` (16) statuses; a seventeenth spreading status in one fight does not spread. A body that resisted may roll again in a later round while a bearer stays near it: it never held the status.
- **The work per settle** is bounded: for each of the bearer's statuses (at most `MAX_STATUSES`, 30) the first `spread` op, and for it each other row (at most 59) is measured once (`dist`, then `sees` over at most `spreadRangeMax` tiles). At most 30 x 59 = 1,770 measures and as many d20s, which the settle asks for as one `rollSettle` and the `settle` command pays, as a per-round op's dice are paid. The pending entry holds the targets, the def, the source, the length and the bearer's Accuracy, so it pays the same whatever happened between the ask and the dice.
- The default range is 1 (`spreadRange`): a body next to its bearer, diagonals too. Reason: a sickness passes by touch. Its most is `spreadRangeMax` (3): further than that it is an aura, which is the tool for "everyone near me".

(d) **The map's size in a fight under way**: a `resize { w, h }` command, the GM's, taking no time.

- Each side is 4 to 40 tiles, the saved map's bounds (`MAP_BOUNDS` of `registry/maps.ts`, held in `space.ts` as `GRID_SIDE` so the fight does not import a registry). Reason: those are the sizes a phone pans and a room doc carries (`DOC_TILES_MAX`).
- Growing adds floor at the right and the bottom. Nothing moves, since every place is counted from the top left. Reason: the GM extends the map past where the fight has gone, and no token jumps.
- Shrinking cuts the right and the bottom. **It is refused (`cutOff`) when it would cut off a body on the map, or a tile a channel or an announced intent aims at.** Reason: the fight never puts a body off its map, and a GM who wants the body gone removes it or drags it first; a silent move would decide where someone stands. A monster or shadow at 0, which is no longer on the map, is moved to the nearest tile inside. A fixed zone keeps its tiles inside and is gone with none left; a blast's field whose centre is cut off is gone; an aura moves with its body and is never cut. The fog's memory keeps what is inside.
- Nothing else about the fight changes: the turn order, the time and the statuses stay. The doc carries the new size, and the players' maps follow it.
- **The open arena's default size** is `RULES.fight.grid`, which the Rules screen's JSON overrides already reach (`{"fight":{"grid":{"w":30,"h":20}}}`), so it needs no new control. `openArena` keeps it inside `GRID_SIDE`: an override of 100 is read as 40, since a fight over 64 a side does not read back.

The numbers, each in `RULES.fight`:

| Rule | Value | Reason |
|---|---|---|
| `auraRadius` | 2 | The radius an aura the maker starts with: a blast's radius, so an aura and a blast read with the same ruler. Every tile next to a body next to the user is inside |
| `fieldRadiusMax` | 6 | The widest an aura or a growing field gets: 13 tiles across and 121 tiles, under half the default arena's 280. Much wider and there is nowhere on the map to stand outside it, which is the GM painting the whole floor, not a field. A radius of 6 is at most 169 tiles to measure (a 13 by 13 square) for each of 16 zones on each call of `zoneSync` |
| `fieldGrow` | 1 | Tiles of radius a growing field gains a round in the maker: a walker at `move` 6 outruns it |
| `spreadRange` | 1 | A sickness passes by touch |
| `spreadRangeMax` | 3 | Further than that it is an aura |

## 5. The map's data

### 5.1 The grid and a place

Square tiles, **one tile is 5 feet**. Reason: 21 monster abilities already say a distance in feet (inventory 3.5), and a phone screen in portrait fits about 20 by 14 tiles at a readable token size, which is 100 by 70 feet, the size of a room or a clearing. `move` 6 is 30 feet a round, the pace the old text assumes. A `Place` is `{ x, y }` branded, whole numbers, inside the grid.

**Distance is the 5-10-5 metric**: `max(dx, dy) + floor(min(dx, dy) / 2)`. Reason: Euclidean needs a square root and non-integer distances in a pure reducer, and Chebyshev makes a diagonal free, so a radius 2 is a 5 by 5 square and a fast build gains 41% of its movement by walking diagonally. The 5-10-5 metric is whole numbers, a radius looks round (table 5.1), and the tabletop already knows it.

### 5.2 A fight with no map

Every fight has places. With no map the party stands in a line at `y = 0` and the foes in a line at `y = 8` (40 feet, two or three turns of walking for a slow build, one for a fast one), one tile apart along `x` (table 5.2). The `add` command places a combatant at the first free tile of its side's line. The same data, so the GM may open the map mid-fight and see exactly those positions.

### 5.3 What the map stores

As built in milestone 6. A fight holds its `grid` (`{ w, h, tiles }`, tiles a terrain each or null for open floor), its `zones` (section 4.7) and its `fog` (`{ sight, seen }` or null). A saved map (`BattleMap`, `src/core/registry/maps.ts`, in the GM's `library.maps`, at most 50) holds its size (4 to 40 a side), its tiles as one character each (`.` floor, `#` wall, `o` cover, `~` rough ground, `_` a pit), its permanent zones, the tiles each side starts on (at most 12 a side), the party's sight and whether it has a fog. A gate names a map (`mapId`); a fight from it is made by `fightMapOf` and placed on the map's starts by the fight's `add`; a fight with no map named is made from `openArena` (the rules' 20 by 14 of floor, no zones, no fog) on the same path. One parser, `parseBattleMap`, reads a map from the library, a pack and the maker; a wrong field takes its default and only a map with no name is refused.

**Terrain is one table** (`TERRAIN` in `space.ts`): each kind's character, whether a body may stand on it, its cost to enter in steps (rough ground 2, so a stride across it is half as long, and a dash and a dodge pay it too), whether it stops a line (a shot, a blast's spread, sight) and whether it is cover. A wall stops a line and a body; a pit stops a body but not a shot or an eye; cover stops neither. **A blast does not pass a wall or go round a corner**: it takes each tile its centre sees, by the same centre line a line ability uses. Reason: the GM can read it off the map with a ruler, and a wall is where a party hides from a fireball. A touch needs a line to its target too, so a curse does not reach through a wall.

**The party shares one view** (`seenBy`): every tile any of its bodies that is up sees, out to `sight` tiles (25 by default, the whole default arena from a corner; a GM lowers it per map for a dark gate). Sight is mutual: the centre line one way or the other. With a fog the GM's phone builds the room's doc from that view: a foe on a tile the party does not see now is not in the doc at all (its row, its turn, its place in the order, its intent, the log lines that name it), nor a zone's tiles the party does not see. What the party has seen before is remembered in the fight (`fog.seen`, marked after every command) and sent as terrain only, so a wall seen once stays drawn and a creature does not. The memory is the fight's, not each phone's: the party shares one view, so a player who reloads or joins late sees what the rest see. The GM sees everything, with what the party does not see dimmed.

### 5.4 What the room doc carries

Per combatant: `id`, name, kind, side, place, `at`, speed, an HP band (a hunter's and shadow's exact HP as today), statuses with their `until`, shield, and for a monster its intent and stagger. The fight also carries `now`, the current id, the next 8 ids in order, the last 5 log lines. Table 5.3: 20 rows (4 hunters, 4 shadows, 12 monsters) is 5,240 characters, 32% of the server's 16,384 cap, and a place adds 11 characters a row. A worst-case row (a monster with a 60-character name and six statuses) is 492 characters, so 33 rows always fit. **The doc's row cap goes from 60 to 32** and the parser keeps its 60-combatant bound on the fight itself. Reason: a fight with more than 32 combatants cannot be drawn on a phone anyway, and a doc the server refuses with 413 is worse than a short list. A refused put is logged and retried once with the log lines dropped, then the pill shows "too big to share". Milestone 6 adds the map: its tiles as one character each and the party's lit tiles as a line of `0` and `1` (each at most 1,600 characters, a 40 by 40 map), and up to 16 zones as runs of tile indices, so the cap is 62,000 (the arithmetic is above `DOC_MAX` in `protocol.ts`).

### 5.5 What a player's phone sends

Two new `ownSheet` message types, each about the sender's own hunter, applied on the GM's phone as `used` is today (`APPLIERS` has `null` on a player's phone):

| Message | Payload | Bounds | What the GM's phone does |
|---|---|---|---|
| `step` | `{ to: { x, y }, at }` | `x` 0 to 63, `y` 0 to 63, `at` the `now` the player saw | Sends `move` for that hunter. Refused if it is not the hunter's turn, if `at` is not the current `now` (the player acted on a stale view), or if the path is blocked |
| `cast` | `{ ability, aim: { x, y } or a target id, react, dice }` up to 8 dice | ability id 40, dice 0 to 999 each, react 1 to 20 | Sends `act` with `by` as the remote hunter and those dice, so the player's own rolls are the numbers that resolve |

Both are refused unless the sender's hunter is `currentId`, which is also what makes them idempotent: a message replayed after the turn moved on is refused, and one replayed inside the turn is refused by the `at` check. Nothing else a player sends changes the fight.

## 6. Balance bounds, written before any run

The simulation (unit 9 in section 7) plays these rows on the real reducer with seeded dice and holds them to the share below. Every row has one lever, the constant a miss should move. The rows are `tests/fight-sim.test.ts`; what each run measured is `rw/sim-log.md`.

### The lead's decisions after round one

The first simulation (unit 5) showed the triangle reversed on two sides and the bounds below asking for what a short duel cannot give. The lead decided seven things, which replace the first table where they differ; the table below is already restated.

1. **The triangle's bound is a direction with room for the dice.** At C and at S the favoured build wins at least 60% and at most 90%, measured as the mean of two openings: the default lines (8 tiles apart) and adjacent. The 60 to 75% band is dropped because a duel of 5 to 15 uses a side is near all or nothing. Over 90% is still a miss: the other side must have a way to win with dice or play.
2. **A matchup must not flip with rank.** Tank against speed at 0.10 at C and 1.00 at S on the same rules is a defect of the curves, not a tuning miss. The ratio of the two sides' times to kill is made stable across E, C and S first (HP, damage a use, armor's share and turns a round each grow with rank at their own rate), and only then is the level tuned.
3. **At E every build wins between 25% and 75% against every other**, the mean of the two openings. A first session where any build plays.
4. **The unprotected channel's bound is measured on channels begun while the boss is aiming at the channeler:** 10 to 25% complete. Channels begun while it aims elsewhere are reported, not bounded.
5. **The speed party's rows use a pack that can hurt:** two skirmishers (ranged) and an elite brute.
6. **Mana:** the bound counts the blasts the mana allows a dungeon (2 or 3), not the blasts a careful cannon chose. Friendly fire stays: the owner asked for abilities grounded in reality.
7. **The numbers of an ability kind are rules.** The wind-ups, travel speeds, radius and ring, ranges, fatigue and mana costs and cooldowns of each kind are `RULES.fight.abilityKinds`, and the fatigue back after a fight is `RULES.fight.fightRest`, each with its reason, so a GM can override them and the balance can tune them. `ability-kinds.ts` keeps each kind's form and reads the numbers. The cost's share of the damage budget was already `RULES.fight.cost`.

### The lead's decisions for round three

Four rules and two numbers (`rw/brief-u7-triangle-3.md`; what each did is `sim-log.md`, "Round three"): Reaction fed by Agility as well as Instinct (section 2.2), a dash (section 4.6), a floor on a kit's load (tried, section 2.2), plate's resist at 30 (tried, section 2.3), `fightRest` and `holdBase` (sections 4.1 and the summary). And one on reading the rows: **the bound stays on the mean of the two openings, and each opening is printed beside it with its own standard error and no bound.** Who wins from which distance is something a GM should be able to read in the log, and at the table the party decides the distance.

### Round four

The simulation's builds play the built-in abilities (`registry/abilities.ts`: the Hunting Bow, Arc Bolt, Mutilation, Shield Wall, the archetype attacks), which made the cannon stronger. Four rules then brought every row inside (`rw/brief-u8-duels.md`; the numbers are `sim-log.md`, "Round four"): plate's bulk (section 2.2), a curse resisted on 12 (section 3.1 rule 8b), plate's resist at its armor (section 2.3) and a channel's threat that follows its payoff (section 4.1). The dash is unchanged (section 4.6): a dash is the full `move` for one action, and a heavy body's action lasts longer than a round, so it is a sprint for the fast and not a charge for the slow; making it a share of the walk's time would help the tank against the speed build at C, which is inside, and not against the cannon, whose duel is decided side by side.

### The bounds

| Row | The bound | Why that number | The lever |
|---|---|---|---|
| Speed against cannon, one on one, C and S | Speed wins 60 to 90%, the mean of the two openings | The fast build's whole purpose is to be where the slow blast is not. Over 90% and the cannon has no answer at the table; under 60% and dodging is a formality | the builds, the policies, the blast (wind-up, radius, mana) |
| Tank against speed, C and S | Tank wins 60 to 90%, both openings | A build that trades all damage for turns must lose to the build that trades all turns for defence (the owner's rock paper scissors) | the builds, the policies, a flat part of armor, the heavy kit |
| Cannon against tank, C and S | Cannon wins 60 to 90%, both openings | The cannon acts 1.4 times as often as a tank in plate and outranges it, and penetration goes past part of plate's resist. (Until round four the reason was that the tank's armor is physical and magic goes past it; with plate's resist at 20 that gave the cannon 0.97 to 0.98, `sim-log.md`) | the heavy kit's resist and bulk, `resistDc`, penetration |
| The same three at E | Each wins 25 to 75%, both openings | 12 creation points cannot separate builds at level 1. The triangle sharpens from D up, which gives a first session where any build plays | `creationPoints` |
| A party of three archetypes against a same-rank pack of three | 2 to 5 rounds, no hunter dying in more than 1 run in 10 | A pack is the fight the party should win on tempo; shorter than a boss fight by design | `MONSTER.normal` |
| The same party against a same-rank boss | 4 to 8 rounds, at most one hunter down in more than 1 run in 4, a death in under 1 in 20 | the owner's bound. A boss is the fight that needs the extras: taunt, shield, stagger | `MONSTER.boss` |
| The mixed party and a mirrored party of three speed builds, each against a pack that can hurt (two skirmishers and an elite brute) | The speed party clears it no faster than the mixed party, and its front hunter goes down at least twice as often | "If someone overindexes on speed they'll do no damage and have too little defense" | the quick cost's damage share (0.7) |
| Fatigue over three fights of 6 rounds | No build is at its capacity before the third fight, and the fastest is | Fatigue is the brake on the build that acts most. Collapse in fight three is a cost, collapse in fight one is a wall | `fightRest` |
| Mana over three fights | The mana a C cannon starts a dungeon with pays for 2 or 3 blasts | "Mana will only recover with potions/team abilities/after dungeon clear" | `manaBase`, `manaCap`, `abilityKinds.blast.mana` |
| A channel of 5 turns against a same-rank boss | Begun while the boss aims at the channeler, completes in 10 to 25% of tries with no protection; over 50% with a taunt holding the boss | A 6.4 times payoff should be rare and worth building a turn around | `holdBase` |
| Staggers in a boss fight | 1 or 2 | More and the boss never acts; none and the bar is decoration | `kinds.boss.stagger` and `staggerRegrow` |
| The best single use with no channel | At most 60% of a same-rank tank's max HP in expectation | A hunter must have a turn to answer. 60% means two hits down a tank, which is a threat and not a removal | the heavy share (1.5) and `critSizeCap` |

### The paper check

Closed-form expected values, before any simulation, in tables 6.1 to 6.6. The figures quoted below are the paper's at the first rules (unit 3); `bun scripts/rw-paper.ts` prints them at today's rules, and what the simulation measured, and changed, is `rw/sim-log.md` (round one and round two). Damage a round is the expected damage of the build's default attack (with the dodge chance and crit of section 3) times its turns a round; rounds to kill is the target's max HP over that. The margin is the loser's rounds over the winner's: 1.0 is a coin flip, and the simulation's win share grows with it.

- **The triangle holds at C and S** (table 6.1): speed over cannon 1.18 and 1.09, tank over speed 1.07 and 1.78, cannon over tank 1.81 and 1.09. Every row points the way the design says. The margins are smallest where the bound is loosest.
- **At E the rows are inside 1.1 and one of them points the other way** (speed over tank by 1.05). That is the stated E bound, not a miss.
- **A boss fight is 6.7, 6.5 and 8.2 rounds** at E, C and S against a party of three, with the tank going down at 5.5, 5.7 and 8.9 rounds, so the party needs its extras to hold the line. The S row is at the top of the 4 to 8 bound: the lever is `MONSTER.boss.hp`. (These are the paper's figures at a boss HP factor of 4; the simulation moved it to 3.2, see section 2.4.)
- **A pack is 3.0, 2.9 and 3.7 rounds**, inside the 2 to 5 bound.
- **The mirrored speed party** clears the pack in 2.5, 3.5 and 4.9 rounds against the mixed party's 3.0, 2.9 and 3.7, and its front hunter goes down in 1.7, 1.4 and 1.5 rounds against 2.6, 3.2 and 5.4. It is faster only at E and it dies about twice as fast everywhere (table 6.3).
- **Fatigue** (table 6.4): the speed build is at 73 of 100 after one fight at C and at its capacity in fight two; every other build settles at 31 to 48. The speed build is the one the brake is for, and `fightRest` is the one number to move if it bites too early. (These are the paper's figures at 50 back; round three of the simulation moved it to 55, because at 50 the speed build reached its capacity before the third fight in 15 dungeons of 100, and at 55 in 1, while it still reaches it in the third in 92.)
- **A channel** completes 13 to 17% of the time unprotected (table 6.5), at the bottom of the bound, so a taunt or a shield has to be part of the plan.
- **The single hit** (table 6.6): a cannon's mana blast is 48% of a C tank's max HP in expectation and 94% in the best case (every die on its top face and a crit, about 1 in 500 uses). At E the same blast is 59% expected and over a tank's whole bar in the best case, which leaves a hunter dying and not dead. That is the number closest to its bound, and the first one to check after the simulation runs.

## 7. The work

### 7.1 The build order

Each unit is one core module or one wiring step, ends in a check, and leaves the tree green. A unit's test file is named with it.

| # | Unit | What it is | Test | What it deletes |
|---|---|---|---|---|
| 1 | Rules and stats | `STAT_KEYS` of eight in `rules.ts` only, the new `rankTable`, the kind factors, the kits, `PAPER` lifted in as the new constants, `PERK_KEYS` without `ac` | `tests/rules.test.ts` | the second `STAT_KEYS` in `save.ts`, `mod`, `rankTable.ac/atk/dmg/init`, `boss.ac/atk` |
| 2 | `src/core/formula.ts` | the parser and the evaluator, `diceOf`, `average` | `tests/formula.test.ts` | nothing |
| 3 | `src/core/hunter/derive.ts` | `Sheet` for a hunter, a monster, a shadow; gear weight and the load factor | `tests/derive.test.ts` (the five builds at E, C and S against section 2's tables) | `derived()` in `hunter.js`, `bonuses` in `inventory.js`, the AC lines |
| 4 | `src/core/combat/space.ts` | `Place`, the 5-10-5 distance, shapes, the default lines, a path and its cost | `tests/space.test.ts` | nothing |
| 5 | `src/core/combat/timeline.ts` | `Tick`, `interval`, `opening`, `before`, `next`, `ahead`, the stun floor and the refund | `tests/timeline.test.ts` | `turnCmp`, `sortTurnOrder`, `forwardFrom`, `initiativeNeeds`, `InitRoll` |
| 6 | `src/core/combat/resolve.ts` | section 3's twenty rules, `needs`, `Outcome` | `tests/resolve.test.ts` (the three worked examples, numbers from the design) | `outcomesOf` in `use.ts`, `toHit` and the damage rolls in `combat.js` |
| 7 | The reducer | the new `Running`, the combatant row that carries everything, the new commands and effects, the one `vitals` write-back | `tests/encounter.test.ts`, `tests/encounter-model.test.ts` | `round`, `reached`, `prev`, `rollInitiative`, `setInitiative`, `setShareInit`, `syncRemote`'s AC, `HunterView` |
| 8 | Statuses | the new op kinds, `until` in ticks, pro rata settling, tenacity and potency | `tests/status.test.ts`, `tests/statuses.test.ts` | `ModStat` (`ac`, `atk`, `dmg`, `check`), `rounds` |
| 9 | The simulation | the three archetypes on the real reducer, the bounds of section 6 as tests | `tests/fight-sim.test.ts` | `tests/status-sim.test.ts`'s hard-coded `BUILD` |
| 10 | The save | `schema: 4`, the new `Hunter`, `Vitals` with mana, gear weight, no carry-over | `tests/save.test.ts` | `fromV1`, `fromV2`, schema 3 repair |
| 11 | The registries | eight-stat monsters and paths, items with weight and armor, abilities with kind, shape and delivery | the per-entry tests that exist | `ac` in every item, `S(...)` of six |
| 12 | The protocol | the new doc row, `step` and `cast`, the row cap of 32 | `tests/protocol.test.ts`, `tests/server-rooms.test.ts`, `tests/models/room-world.ts` | `codex` AC, the `hp` message's `mp` field |
| 13 | The fight view | draw and send only: the map, the order ahead, the cards, the intent | `tests/e2e/combat-turns.e2e.ts` | every roll and derived number in `combat.js` |
| 14 | The map view | the grid, tokens, tap to move, an ability's reach drawn | `tests/e2e/battle-map.e2e.ts` | nothing |
| 15 | The charts and `AGENTS.md` | `scripts/charts/channel.ts`, the fight chart on the new commands, the rows below | `tests/statecharts.test.ts` | the old fight chart's initiative arrow |

Units 1 to 6 are pure and can land in any order after 1. Unit 7 needs 3 to 6. Nothing in 13 or 14 starts before 9 is green, which is the owner's "the numbers hold first".

### 7.2 What is deleted, and when

| Thing | Where it dies |
|---|---|
| AC: `HunterView.ac`, the rows' `ac`, `ModStat` `ac`, the `ac` perk, `ItemBonus.ac`, `rankTable.ac`, `boss.ac`, the codex's `ac`, "(AC n)" in the pickers | units 1, 3, 7, 8, 11, 12 |
| `mod` and the linear stat curve | unit 1, replaced by `eff` and `capped` |
| The six stats and their 21 files | units 1, 3, 10, 11, and the views in 13 |
| The round counter, `reached`, initiative and `prev` | units 5 and 7 |
| Every roll and derived number in a view | units 3, 6 and 13; a new lint test says no view computes damage or a derived number, and only `space.ts` changes a place |
| The two homes for a hunter's fight state | unit 7: the row holds HP, mana, fatigue and statuses for every kind, and the `vitals` effect is the only write to a sheet |

### 7.3 The rows `AGENTS.md` will need

New "where things live" rows: a derived number (`derive.ts`, `tests/derive.test.ts`); who acts next (`timeline.ts`, `tests/timeline.test.ts`); a place, a distance or a shape (`space.ts`, `tests/space.test.ts`); what one use does (`resolve.ts`, `tests/resolve.test.ts`); a formula (`formula.ts`, `tests/formula.test.ts`).

New recipes: **an ability** (an entry in the registry with its kind, which fills cost, shape, delivery and the formula from the kind's defaults; the typecheck asks for the formula's text to parse); **a shape** (a member of `Shape` and its cell in `tilesOf`, which the typecheck asks for, plus a case in `tests/space.test.ts`); **a status op** (a member of `Op` and its case in `applyOp` and in `derive`, plus a row in `tests/status.test.ts`); **a terrain** (a character in the map's tile string, its cell in `stepCost` and in `blocksLine`); **a derived number** (a field of `Sheet`, its formula in `derive.ts`, its reason in this file's section 2 table, and its row in `tests/derive.test.ts`).

### 7.4 What was built, against the plan

Written by W9 after milestone 2 (commit range from `m2-start`). The core units landed as phase 3's u0 to u8, the wiring as milestone 2's P0 to P6 and W1a to W9 (`m2-plan.md`); each unit's notes are `notes-u*.md` and `notes-m2-*.md`.

| # | Planned | Built |
|---|---|---|
| 1 | Rules and stats, `STAT_KEYS` in `rules.ts` | `src/core/stats.ts` holds `STAT_KEYS`, `STAT_LABELS` and the curves; `rules.ts` imports them. `mod`, the six stats and AC are gone |
| 2 | `formula.ts` | As planned |
| 3 | `derive.ts` | As planned; a hunter's build (gear, title, path picks, passives) is read by the new `src/core/hunter/sheet.ts` (P2), and `derived()` in `hunter.js` is gone |
| 4 | `space.ts` | As planned; terrain is `TERRAIN` (floor and wall). No fight has a map yet: rows stand on the default lines |
| 5 | `timeline.ts` | As planned |
| 6 | `resolve.ts` | As planned; `inRange` and `whoIsIn` are its exports `fight-view.ts` calls |
| 7 | The reducer, in `encounter.ts` | A new `fight.ts` (with `fight-types.ts`, `fight-turn.ts`, `fight-parse.ts`, `fight-channel.ts`), tested by `fight.test.ts` and `fight-model.test.ts`; the hand edit `adjust` and the Status window's `status` added (P0). `encounter*.ts` deleted (W8) |
| 8 | Statuses in `status.ts` | `effect-ops.ts`; `status.ts` deleted (W8) |
| 9 | The simulation | `tests/models/fight-sim.ts` and `tests/fight-sim.test.ts`; rerun with the registries' real abilities is still owed (`m2-plan.md` risk 3) |
| 10 | The save at schema 4 | As planned, no carry-over: an old save is kept in the backups and a new campaign starts (W2) |
| 11 | The registries | As planned, plus `registry/abilities.ts` (P1); seeds restated by `m2-plan.md` section 3 |
| 12 | The protocol | The fight doc (`fight-doc.ts`, P4), `step`, `cast` and `vitals` (W3). The doc carries the last refused tap and the abilities on cooldown (W6b); its cap is `DOC_MAX` (31,200) |
| 13 | The fight view | `combat.js` (W5) and the players' HUD in `table.js` (W6, W6b) draw from `fight-view.ts` (P3) and roll with `src/edge/roll.ts` (P6). A move is Toward or Away a picked foe |
| 14 | The map view | Not built (milestone 3); no `battle-map.e2e.ts` |
| 15 | Charts and `AGENTS.md` | The fight chart on `fight.ts` and the channel chart (W8); `AGENTS.md` (W9) |
