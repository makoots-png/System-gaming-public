# Economy: design

Status: design only, no code changed. Written 2026-11-20 on branch `economy` from `2c5f7a86`; sections 2 to 8 revised the
same day to the owner's rulings 1 to 5 (section 10), then sections 2.2, 2.5, 4, 7, 8 and 9 to rulings 6 to 10 and to
finding E-1 of `docs/audit/2026-11-20-fable-review.md` (a rarity's price is computed from the loot table, not stored). Every number below is printed by
`bun docs/agent-handoff/features/economy/measure.ts`, which reads the shipped `RULES` and the built-in items, so a change
of a rule moves the tables when the script is rerun. Each table names the block of the script's output it comes from.

The owner, asked what a Common item's sale price should be: "Idk you should figure out economy." His standing rules:
explain every balance number, everything explicit, architecture first.

## 0. The goal, the problem, the anchor

The goal: gold means something at every rank. A hunter should always have a thing worth saving for, and the price of
every thing should be explainable in one sentence that names its anchor.

The problem today: the prices were set one by one (a hand price on each shop item, a rarity table, a hidden factor of
10, a sale of "half" written as `/ 2`, a crystal at a flat 100,000), and the income was set elsewhere (the loot gold
table). Nothing ties the two, so nobody can say whether a price is high or low.

**The anchor: one Clear.** A Clear is the mean gold one hunter takes from clearing a world gate of a rank in the party
the gate is made for: the middle of `RULES.loot[rank].gold`. It is the one number in `RULES` that already grows by rank
(E 100, D 325, C 1,250, B 5,000, A 19,000, S 75,000), and every source of gold can be read in it. Every price below is a
count of Clears of a named rank, and the rarity of an item names its rank: common is E, uncommon D, rare C, epic B,
legendary A, mythic S.

## 1. What the code pays today (measured)

### 1.1 Where gold comes from and where it goes

| Source | What it pays | Where |
|---|---|---|
| A world gate's Clear (the GM's Clear panel) | a gold roll, uniform in `loot[rank].gold`, to **each** payee whole (the split follows `xpSplit`, false); two item picks by rarity weight, both to one taker | `rollLoot(rank, boss: true)` in `gates/spawn.ts`; `clearShares` in `gates/pay.ts`; `clearGate` in `views/gates.js` passes `!!rules().xpSplit` |
| A personal gate cleared alone | the same gold roll as a world gate of its rank, whole, and one item pick | `lootOf(rank, boss: false)` in `views/gates.js`; `soloRan` in `gates/solo.ts` |
| A world gate opened to solo runs, cleared alone | a whole Clear (gold and two picks) to the one hunter | `soloAnswerBody`, `soloTaken` in `gates/solo.ts` |
| A fight's end | what the defeated monsters' bestiary entries drop. Every built-in monster drops 0 gold and no item | `Loot` in `registry/monsters.ts`; `settleEncounter` in `gates/pay.ts` |
| The daily quest | 25 XP, 1 point, **0 gold** | `RULES.dailyTemplate.rewards` |
| A GM's quest, award, bundle | whatever gold the GM types (default 0) | `Rewards.gold`, `grant` |
| Selling an item | half its price, rounded down, at least 1 (`/ 2` is a literal) | `sellPrice` in `hunter/inventory.ts` |

| Sink | What it takes | Where |
|---|---|---|
| The shop | an item's price: its hand `value`, else `baseValue × mult × 10` (the `× 10` is a literal) | `buy`; `valueOf`, `priceOf` in `registry/items.ts` |
| The buy-sell spread | half the price of anything bought and sold back | `sellPrice` |
| A respec | `respecGold × level²`, 5 × level² | `respecCost` in `hunter/build.ts` |
| A used consumable | its price, gone | `useItem` |

There is no upkeep, repair, fee or tax. Trades (`trade/goods.ts`) move gold between hunters and make or destroy none.

### 1.2 The session model (the assumptions, each stated)

| Assumption | Value | Why |
|---|---|---|
| A session | one evening at the table, a week apart | notes-2b-crystal.md section 3 counts "weekly sessions" |
| The world gate a session | one, of the party's rank, cleared, a party of 4 | the GM's game; a party that fails pays nothing and is not the reference |
| Items of a Clear | 2 picks to one taker, so 2 / 4 = 0.5 of an item a hunter on average | `rollLoot(boss: true)`, `clearShares` |
| A personal gate's clear share | 0.5 | measured: notes-2b-crystal.md section 3 (E and C builds, 100 plays a row). Not measured at D, B, A, S; assumed the same |
| A personal gate's rank | one below 25%, at 60%, one above 15%; E's below is E; an S gate is an A gate | `RULES.solo.ranks`; `pooled` in `gates/solo.ts` (no normal S seed) |
| Personal runs a session | **table player**: 3 (the gates held, played at the session). **Daily player**: 21 (3 a day, 7 days) | `solo.held` 3, `solo.hours` 8, `solo.stays` 24 |
| An item kept or sold | priced as if sold, so items read as gold | the floor of an item's worth to a hunter |

### 1.3 Today's income a session, one hunter, gold (block `[1.3 / 4.2] today`)

"A run" is one personal gate attempted (the clear share is in it). Items are at their sale price (half).

| Rank | Clear gold | Clear items, a hunter's share | A run's gold | A run's item | Table player | Daily player |
|---|---|---|---|---|---|---|
| E | 100 | 51 | 67 | 58 | 526 | 2,780 |
| D | 325 | 102 | 204 | 100 | 1,338 | 6,808 |
| C | 1,250 | 176 | 791 | 201 | 4,401 | 22,254 |
| B | 5,000 | 468 | 3,081 | 458 | 16,086 | 79,797 |
| A | 19,000 | 890 | 7,750 | 784 | 45,493 | 199,114 |
| S | 75,000 | 1,508 | 9,500 | 890 | 107,678 | 294,698 |

### 1.4 What is wrong today

1. **The personal gates are most of the income**: a gate of one or two normals pays a world gate's roll, so a table
   player takes about 70% of its gold from its 3 runs (E: 375 of 526), a daily player 94%.
2. **Everything is cheap**: an own-rank item costs 0.09 to 0.19 of a table session. 3. **The crystal's flat 100,000**
   is 190 table sessions at E and 0.9 at S. 4. **Hidden literals**: `baseValue` 10 times a literal 10, a sale of `/ 2`.
5. **Hand prices off the ladder**: Knight Killer (rare) 5,000 where a rare is 500; Ring of Vitality 20,000.
6. **Nothing rewards a small party**: each payee takes the whole roll, so six hunters take six rolls from one gate.
7. **The items were never weighed against each other**: inside mythic the Scepter spends five times the Crown (2.5).
8. **A GM's price edit reaches only the GM's phone**: the room's `rules` doc (`roomRulesOf`) carries no economy number.

## 2. Items: tier, grade, budget, price

### 2.1 The shape: a grade beside the rarity

**Decision: a grade is a field of the item beside its rarity, three values the compiler checks:
`GRADES = [-1, 0, 1] as const`, `grade?: Grade`, absent the middle.** Shown as the rarity's word with a sign: Epic−,
Epic, Epic+ (epic is B's tier, so the owner's "B−, B, B+").

Three values, not a free number: the owner named three, a number invites a fourth grade nobody priced, and a union lets
`priceOf` and the maker's chips be total over it. Numbers, because the price reads the grade as an exponent. Optional, as
`value` is, so every held item and old save reads as the middle with no migration. `parseItem` keeps only 1 or -1;
`DISTINGUISHES` gains `grade: true` (the typecheck asks), so an Epic+ and an Epic of one name are two stacks.

**The price follows the grade:** price = Clear of the rarity's rank × `gradeStep` ^ grade. `gradeStep` is 1.5, from the
ladder: three grades make one tier, and a tier is a factor of 3.25 to 4 (section 2.2), so one grade is about the cube
root, 3.25^(1/3) = 1.48 to 4^(1/3) = 1.59. At 1.5 a tier's plus sits under the next tier's minus because 1.5² = 2.25 is
less than 3.25, the smallest tier factor (E to D). The domain of `gradeStep` is 1 to 1.8 for that reason
(1.8² = 3.24). Block `[2.1]`:

| Rarity (rank) | Minus | Middle | Plus | Sells for (a quarter) | Price today |
|---|---|---|---|---|---|
| common (E) | 67 | 100 | 150 | 16 / 25 / 37 | 100 |
| uncommon (D) | 217 | 325 | 488 | 54 / 81 / 122 | 200 |
| rare (C) | 833 | 1,250 | 1,875 | 208 / 312 / 468 | 500 |
| epic (B) | 3,333 | 5,000 | 7,500 | 833 / 1,250 / 1,875 | 1,500 |
| legendary (A) | 12,667 | 19,000 | 28,500 | 3,166 / 4,750 / 7,125 | 5,000 |
| mythic (S) | 50,000 | 75,000 | 112,500 | 12,500 / 18,750 / 28,125 | 20,000 |

Every plus is under the next minus: 150 < 217, 488 < 833, 1,875 < 3,333, 7,500 < 12,667, 28,500 < 50,000.

### 2.2 The ladder

**Rule: a middle item of a rarity costs one Clear of that rarity's rank.** The price is computed, never stored: each
rarity names its rank (`rarities.*.rank`, a rule), and its price is that rank's Clear, the middle of `loot[rank].gold`:
E 100, D 325, C 1,250, B 5,000, A 19,000, S 75,000. Today it is `baseValue` 10 × `rarities.*.mult` (1, 2, 5, 15, 50,
200) × a literal 10; all three go (review E-1), so a GM's edit of `loot.C.gold` moves the rare price with the Clear.

Why one Clear: a hunter has 10 slots (`RULES.slots`), so a full set of its own rank's middle gear is 10 Clears. A table
player earns in a rank (sessions at the rank from section 4.4, times income a session) about E 39, D 34, C 27, B 13, A 7
Clears: enough for the set at E to B, with drops filling slots too. At two Clears an item the set would take more than a
rank's gold at B; at half a Clear, gold piles up again. Why the factor grows faster than today's: once the personal
gates pay a quarter (section 4.2), income grows by 3 to 4 a rank, so an own-rank item stays at 0.5 to 0.9 of a table
session at every rank (section 6).

**Consumables cost half** (`usedUpShare`, 0.5): a Clear buys two potions of its rank. Health Potion and Mana Potion 50
(unchanged), Stamina Tonic 50 (was 30), Greater Health Potion 163 (was 300), Elixir of Life 2,500 (was 2,000). A
consumable has no grade and no budget: what it is worth is one use, which the budget below does not weigh.

**Hand prices go.** Every built-in item is priced by the rule (the crystal too, section 5). Mana Crystal Shard
is a common material, 100, selling for 25. A GM's own item keeps the Value the GM typed; a hand value wins over the rule,
as today.

### 2.3 The budget: what a tier and a grade may hold

the owner's addition: two items of one tier and grade need not be strong in the same way; one may hold lower stats and a
better effect. So an item's worth is a **budget it spends**, and the price follows the grade, never the mix.

**The unit is the point**: one point on a stat, what a level hands out three of (`pointsPerLevel`). Everything an item
carries is converted to points on the item maker's sample wearer (`SAMPLE_WEARER`, the body the maker already weighs
gear on: Agility and Strength 2:1, medium kit), at its tier's rank's first level. What each thing costs:

| What the item carries | Its cost in points | Why |
|---|---|---|
| A bonus point on any of the eight stats | 1 | the unit |
| 1 max HP | 1 / (max HP one Vitality point gives) | what the points would buy |
| 1 max mana | 1 / (max mana one Power point gives) | the same |
| A weapon's mean damage above its free die | 1 / (physical power one Strength point gives), a point of damage | a strike is its die plus `phys` |
| Armor or resist typed above `piece`'s | 1 / (armor one Vitality point gives) | the same |
| A worn status (a passive: `Item.worn`) | `wornWorth` × one standard action's damage ÷ the damage a Strength point gives | `wornWorth` (`registry/worth.ts`) is already in standard actions a round; one standard action is the bruiser's reference strike, `1d8 + phys` |
| An ability the item grants | `abilityWorth` the same way, once items can grant one (no such field today) | the kits' measure |
| Armor ignored (`penFlat`), a worn status's standing ops | **not weighed**, named on the maker's line ("test it in a fight"), as `worth.ts` names what it cannot weigh | no measure exists; a 0 would hide it |

What is free, the slot's own: an armor piece's `piece` numbers (its kit's share plus the rarity's index, the rule that
already makes a plain epic piece better than a plain common one), a weapon's die up to the reference strike's 1d8 plus
`weaponStep` (1) mean damage a tier above common (the same idea as `piece`'s rarity index: common 4.5, mythic 9.5), and
weight. Block `[2.3]`, the conversions:

| Rank | Max HP a Vitality point | Max mana a Power point | `phys` a Strength point | One standard action, damage | 1 max HP costs | 1 max mana costs | 1 damage costs | A worn status at the kits' tolerance (0.08) costs |
|---|---|---|---|---|---|---|---|---|
| E | 0.60 | 0.50 | 0.423 | 14.9 | 1.67 | 2.00 | 2.36 | 2.8 |
| D | 0.90 | 0.50 | 0.391 | 22.7 | 1.11 | 2.00 | 2.56 | 4.6 |
| C | 1.10 | 0.50 | 0.368 | 30.7 | 0.91 | 2.00 | 2.72 | 6.7 |
| B | 1.50 | 0.50 | 0.344 | 41.1 | 0.67 | 2.00 | 2.91 | 9.6 |
| A | 1.90 | 0.50 | 0.327 | 51.2 | 0.53 | 2.00 | 3.06 | 12.5 |
| S | 2.50 | 0.50 | 0.311 | 63.5 | 0.40 | 2.00 | 3.22 | 16.3 |

So an item may trade: at C a worn status the size of the kits' tolerance costs 6.7 points, the same as +2 Power and
+2 max mana, or a die 2.5 damage bigger. That is the owner's "lower stats but better abilities" with one yardstick.

### 2.4 The budget of each tier and grade

**Anchor: a full set of ten own-rank middle items adds half the points a hunter of that rank has** (`itemBudget.share`,
0.5), so gear is a third of what the hunter fights with. The middle budget is share × `pointsAt(rank's first level)` /
10 slots. A tier's span on a log scale runs halfway to its neighbours (E's and S's outer edges mirrored), so the spans
tile: every spend falls in one tier. Each span is cut in three on the log scale: minus, middle, plus. Block `[2.4]`:

| Rank | Hunter's points | Middle budget | Minus | Middle | Plus | Top of the tier |
|---|---|---|---|---|---|---|
| E | 12 | 0.6 | below 0.5 | 0.5 to 0.7 | 0.7 to 1.1 | 1.1 |
| D | 39 | 1.9 | below 1.4 | 1.4 to 1.9 | 1.9 to 2.6 | 2.6 |
| C | 69 | 3.5 | below 3.1 | 3.1 to 3.7 | 3.7 to 4.4 | 4.4 |
| B | 114 | 5.7 | below 5.1 | 5.1 to 5.9 | 5.9 to 6.7 | 6.7 |
| A | 159 | 8.0 | below 7.5 | 7.5 to 8.4 | 8.4 to 9.3 | 9.3 |
| S | 219 | 10.9 | below 10.4 | 10.4 to 11.6 | 11.6 to 12.9 | 12.9 |

The minus grade is open below: an item weaker than its tier's middle is allowed, and it is cheap. What is never allowed
is the other way: an item spending past its grade's top is stronger than its price.

**How a maker spends it.** The item maker shows the spend under the preview, as the ability maker shows worth:
"Spends 4.2 points. Rare+ holds 3.7 to 4.4." It suggests the grade whose band holds the spend, and warns (never refuses)
when the chosen grade is under it. The grade is the maker's chip, because some things are not weighed; the price reads
the chip.

**How a loot roll spends it.** It does not. A roll picks a rarity by weight and an item of it, as today, and the item
comes with the grade it was made with. A roll that built items from a budget would be a generator, which nobody asked
for; the pool's mix of grades sets the mean price of a pick, which `measure.ts` reads.

### 2.5 The built-in items against the budget (block `[2.5]`)

Each built-in's grade is read from its spend. One claims more: Knight Killer's 5 armor ignored is not weighed, so it is
Rare+ (its d10 and +2 Strength alone spend −0.7). A grade above the spend is allowed only with a block the budget cannot
weigh.

| Rarity | Minus | Middle | Plus | Past the tier's top |
|---|---|---|---|---|
| common | Iron Dagger −4.7, Goblin Shortbow −2.4, Steel Longsword 0, Hunting Bow 0, Hunter's Leather 0, Padded Cap 0, Dented Tower Shield 0 | | Worn Hunter Boots 1.0 | |
| uncommon | Orc Warrior's Cleaver 1.0, Reinforced Hunter Vest 0, Ironhide Gauntlets 1.0, Swift Runner Greaves 1.0 | | Mana Talisman 2.0 | |
| rare | Kasaka's Venom Fang −6.2, Ice Elf's Cloak 1.0 | | Knight Killer (claimed) | Mage Circlet 6.0, Baruka's Mana Ring 6.0 |
| epic | Ring of Vitality 5.0, Frost Giant Hammer 1.5, Knight's Aegis 1.0, Cloak of the Shadow Hunter 2.0, Helm of the Iron Knight 2.0 | | | |
| legendary | Armor of the Black Knight 3.0, Boots of Shadow Step 4.0 | | | Kamish's Wrath 21.3, Orb of Avarice 16.0 |
| mythic | Crown of the Shadow Sovereign 10.0 | | Ring of the Monarch's Will 12.0 | Monarch's Scepter 53.4, Armor of the Absolute Being 45.0 |

What it says: most built-in gear is plain (its slot's free numbers and a point or two), so it is its tier's minus and
costs two thirds of a Clear. Six items are past any grade of their tier, by mana (2 points each) and by dice and HP.

**Ruled: the six are kept as they are** (ruling 6). None moves a tier and none loses a number. Each is priced as its
tier's plus, the dearest price its tier has (block `[2.5] kept`; the tier's top spend from block `[2.4]`):

| Item | Rarity | Spend | Its tier's top | Price, as the tier's plus |
|---|---|---|---|---|
| Mage Circlet | rare | 6.0 | 4.4 | 1,875 |
| Baruka's Mana Ring | rare | 6.0 | 4.4 | 1,875 |
| Kamish's Wrath | legendary | 21.3 | 9.3 | 28,500 |
| Orb of Avarice | legendary | 16.0 | 9.3 | 28,500 |
| Monarch's Scepter | mythic | 53.4 | 12.9 | 112,500 |
| Armor of the Absolute Being | mythic | 45.0 | 12.9 | 112,500 |

Unit 3's budget test ("no built-in item spends past its grade's top") names these six as its allowed exceptions, one by
one by name (a built-in item's only key), with ruling 6 as the reason, so a seventh item past its top still fails it.
Their grade is plus, written on each in `items.ts`, and the budget is not stretched to fit them: a GM's item past its
tier's top is still shown as past it by the item maker's spend line. They stay the strongest things a hunter can find
at their rarity, at the dearest price that rarity has.

The shop after unit 1 (no grades yet, every item its tier's middle): Iron Dagger 100 → 100, Hunter's Leather 150 → 100,
Steel Longsword 400 → 100, Knight Killer 5,000 → 1,250, Ring of Vitality 20,000 → 5,000. After units 2 and 3 (block
`[2.2]`): 67, 67, 67, 1,875 (Knight Killer's claimed plus), 3,333. The first design moved three of these up a rarity to
keep their hand prices; the budget says they are plain for their tier, so they keep their rarity and take the minus
price.

## 3. The sale ratio

**Ruled: an item sells for a quarter of its price** (`saleShare`, 0.25), rounded down, at least 1 (2.1 lists it).

Why it holds: gold comes from gates and items are worn. A pick of E's table is priced 188 on average (block
`[1.3 / 4.2] design`), so selling one pays 47, under half a hunter's gold from the gate, and less above E (block `[3]`:
D 0.29, C 0.13, B 0.10, A 0.08, S 0.06). An own-rank middle item sells for a quarter Clear, what a cleared personal gate
pays (4.2). Buy then sell loses three quarters, so the shop is not a bank. The crystal is never bought back.

## 4. Income after the change

### 4.1 World gate gold and XP are shared, and a crowd is paid less

**Formula.** A world gate is made for a party of `gateParty` hunters, 4 (the session model's party). What it pays, its
gold roll and its XP alike (ruling 7), is a pot of `gateParty` times the amount, and past that party the pot shrinks by
party / n. Each of n hunters takes an equal share, rounded down:

- pot(n) = amount × gateParty × min(1, gateParty / n)
- each(n) = floor(pot(n) / n): amount × 4 / n up to 4 hunters, amount × 16 / n² past 4

Up to the party the total holds and fewer hunters split it; past it the total falls too. Block `[4.1]`, mean gold:

| Rank | Each: 1 / 2 / 3 / 4 / 5 / 6 hunters | Total: 1 / 2 / 3 / 4 / 5 / 6 hunters |
|---|---|---|
| E | 400 / 200 / 133 / **100** / 64 / 44 | 400 / 400 / 399 / 400 / 320 / 264 |
| D | 1,300 / 650 / 433 / **325** / 208 / 144 | 1,300 / 1,300 / 1,299 / 1,300 / 1,040 / 864 |
| C | 5,000 / 2,500 / 1,666 / **1,250** / 800 / 555 | 5,000 / 5,000 / 4,998 / 5,000 / 4,000 / 3,330 |
| B | 20,000 / 10,000 / 6,666 / **5,000** / 3,200 / 2,222 | 20,000 / 20,000 / 19,998 / 20,000 / 16,000 / 13,332 |
| A | 76,000 / 38,000 / 25,333 / **19,000** / 12,160 / 8,444 | 76,000 / 76,000 / 75,999 / 76,000 / 60,800 / 50,664 |
| S | 300,000 / 150,000 / 100,000 / **75,000** / 48,000 / 33,333 | 300,000 / 300,000 / 300,000 / 300,000 / 240,000 / 199,998 |

**How much the gate's pay rises.** Shared as it is rolled today, a party of 4 would take a quarter of a roll each. The
pot is four rolls, so the gate's base gold rises four times and the party it is made for takes exactly what each hunter
takes today: one Clear. `loot[rank].gold` keeps its numbers and its meaning (one hunter's share at the party), so the
anchor and every price stay put.

**Why the square past the party.** Up to the party, risk grows as the party shrinks and the share grows with it.
Past it an extra hunter adds only safety, so the total falls by party / n: a crowd of 6 takes 2.7 rolls, not 4. A fixed
pot past 4 would pay a crowd the same in total (not "paid less"); a steeper cut punishes a party of 5 for one friend.

**A solo run of a world gate** (a GM's gate opened to solo runs) is n = 1: four Clears, the most each. That is the
risk the owner asks to reward: one hunter against a pack and a boss made for four.

**XP is shared the same way** (ruling 7: "XP should be split as well"). The amount is the XP the gate pays: what each
fight linked to the gate pays of it (`fightAward`) and the rest at its Clear (`xpDue`), each shared among the hunters
paid by the formula above. How the gate's XP is raised: the factor `gateParty` in the pot is the raise, as it is for
gold. A gate's XP keeps its numbers and its meaning (`rankTable.*.xp` a normal monster, `fight.kinds.boss.xp` a boss,
what one hunter of the party takes), so each of the party of 4 takes exactly the XP each payee takes today and levels as
today (section 4.4). Block `[4.2]`, a world gate's XP each at the party of 4: E 125, D 525, C 1,750, B 5,600, A 17,500,
S 56,000; at 2 hunters each takes twice that, alone four times, in a crowd of 6 sixteen thirty-sixths.

What it reaches and what it does not. A fight linked to no gate is the GM's own scene, sized by the GM for the hunters
in front of them: it pays each hunter the whole XP of what went down, as today's default. A personal gate's XP stays
whole to its one hunter (its pack is already sized for one, section 4.2). `xpSplit` goes: the split is no longer a
switch but the rule of a world gate, and "split evenly" (floor(XP / n), which paid a party of 4 a quarter of today) is
not a pace anyone asked for. Unit 6 deletes it with its readers.

**Item drops stay two picks to one taker.** A thing cannot be shared, and each hunter's chance of a drop is already
2 / n, so a small party already takes more items each.

### 4.2 Personal gates pay a quarter

**Ruled: a quarter** (`solo.lootShare`, 0.25): a cleared personal gate pays a quarter of one hunter's share of a world
gate of its rank (a quarter of the loot table's gold roll, not of the four-roll pot), and its one item pick happens one
time in four. Why per hunter: a personal gate is one hunter against 1.5 normal monsters on average (`solo.pack` 1 to 2);
one hunter of a world gate's party fights 4 normals and a boss worth 3 (`fight.kinds.boss.xp`), 7 in all, whose XP each
takes whole: 1.5 / 7 = 0.21 (E's pack is 1 to 3: 1.5 / 5 = 0.30). A quarter sits between.

### 4.3 Income a session, one hunter, gold (block `[1.3 / 4.2] design`)

The party of 4 of the session model, the built-in items priced by their grades of section 2.5 (the six past their
tier's top at its plus, ruling 6).

| Rank | Clear gold each | Clear items, a hunter's share | A run's gold | A run's item | Table player | Daily player | Daily / table |
|---|---|---|---|---|---|---|---|
| E | 100 | 23 | 17 | 7 | 194 | 617 | 3.2 |
| D | 325 | 47 | 51 | 12 | 560 | 1,686 | 3.0 |
| C | 1,250 | 81 | 198 | 25 | 1,998 | 6,001 | 3.0 |
| B | 5,000 | 257 | 770 | 71 | 7,781 | 22,925 | 2.9 |
| A | 19,000 | 734 | 1,938 | 154 | 26,007 | 63,648 | 2.4 |
| S | 75,000 | 2,249 | 2,375 | 183 | 84,924 | 130,977 | 1.5 |

The table's Clear is now 64% (E) to 91% (S) of a table player's gold. A party of 2 doubles its Clear gold each (E: 200,
and its item share doubles, so a table player's 194 becomes about 318); a party of 6 takes 44 of E's 100.

### 4.4 Quests and the pace of ranks

The daily stays at 0 gold (one flat number: a lot at E, nothing at S). A GM's quest pays what the GM types; the Rules
page's guidance is one Clear of the party's rank. Sessions at a rank by XP (block `[4.2]`, the party of 4, whose share
of the world gate's XP is today's whole XP): table player E 20, D 19, C 17, B 8, A 5; daily player E 6, D 7, C 6, B 3,
A 2. The split leaves these as they are.

What the split does to the pace is a function of the party. Block `[4.4]`, table sessions at a rank when the world gate
is cleared by 1 / 2 / 3 / 4 / 5 / 6 hunters (personal runs and the daily as in the session model, whole):

| Rank | 1 | 2 | 3 | 4 | 5 | 6 |
|---|---|---|---|---|---|---|
| E | 7.5 | 12.9 | 17.0 | **20.2** | 25.3 | 29.4 |
| D | 6.2 | 11.4 | 15.7 | **19.3** | 25.9 | 31.7 |
| C | 5.3 | 9.7 | 13.5 | **16.7** | 22.6 | 27.9 |
| B | 2.6 | 4.7 | 6.6 | **8.2** | 11.1 | 13.8 |
| A | 1.6 | 3.0 | 4.2 | **5.4** | 7.5 | 9.5 |

A pair ranks up in 56% to 64% of the party's sessions, a crowd of 6 needs 1.5 to 1.8 times as many: the risk of a
small party is paid in pace as it is in gold. A lone hunter's world gate is a GM's choice (a gate opened to solo runs,
section 4.1), so the 1 column is a bound, not a pace.

**A raising costs levels** (ruling 9, `reviveLevelShare` 1/30): at level L a raising takes ceil(L / 30) levels, never
below level 1, so level 1 loses none, levels 2 to 30 one, 31 to 60 two. Block `[4.4] a raising`, its cost in table
sessions of XP at the party of 4 (the XP of the lost levels over the XP a table session pays at the rank):

| Level (rank) | 5 (E) | 10 (D) | 20 (C) | 30 (C) | 35 (B) | 50 (A) | 60 (A) |
|---|---|---|---|---|---|---|---|
| Levels lost | 1 | 1 | 1 | 1 | 2 | 2 | 2 |
| Table sessions of XP | 1.8 | 1.2 | 0.8 | 1.2 | 0.9 | 0.4 | 0.5 |

More levels the higher a hunter is, as the owner asked; in sessions it costs less at A, where a session pays the most XP.
What becomes of the lost levels' points: they go with the levels (ruling 9's default). The points a hunter holds are
not a counter but what its levels give (`progress.ts` `balance`), so the lower level holds fewer. Stats already
confirmed stay where they are; the points free fall by the lost levels' points, and when that goes below 0 the next
levels gained pay it back before any point is free again. The peak level stays, so regaining a lost level refills
nothing.

## 5. The Resurrection Crystal, tiered

**Ruled: a crystal has a rank, revives only a hunter of its rank or lower, and its price follows its rank.**

**The shape: the crystal's rank is its rarity's rank.** The item keeps `revive?: true`; its rarity's rank
(`rarities.*.rank`, common E … mythic S, the rule the price ladder reads, section 7.1) names the rank it revives up to. Weighed against a field `revive?: Rank`: that field could say "a common crystal that revives S", a state
with two prices (its rarity's and its rank's); reading the rank from the rarity makes it unrepresentable and needs no new
field, no parser change and no migration. Today's held crystals are mythic, so they become S crystals and still revive
anyone. A crystal has no grade.

**The price: `reviveClears` Clears of its rank, 10**: the price of a full set of its rank's middle gear. So a reviving
item's rule price is `reviveClears` × its rarity's price; a hand Value still wins. Block `[5]`:

| Crystal | Rarity | Price | Table sessions at its rank | Daily sessions | Today's 100,000 in table sessions |
|---|---|---|---|---|---|
| E | common | 1,000 | 5.2 | 1.6 | 190 |
| D | uncommon | 3,250 | 5.9 | 2.0 | 75 |
| C | rare | 12,500 | 6.3 | 2.1 | 23 |
| B | epic | 50,000 | 6.4 | 2.2 | 6.2 |
| A | legendary | 190,000 | 7.3 | 3.0 | 2.2 |
| S | mythic | 750,000 | 8.8 | 5.7 | 0.9 |

A hunter saves five to nine weeks at the table for one of its own rank; a lower one is cheap and useless to it. The shop
stocks one of each rank (six rows named "Resurrection Crystal (E)" to "(S)"). It is never sold back, never in a loot roll,
and a GM gives one in any reward, as today.

**The use checks the rank.** `revives(item, rank)` in `hunter/use.ts`: true when the item revives and the hunter's rank is
at or below its rarity's rank (`R.rarities[item.rar].rank`). `useItem` refuses a crystal too low with `too-low`, before any write, nothing
spent. Its words (`USE_WORDS`, copy-tasks.md: why, and the way out): "Resurrection Crystal (C) brings back a hunter of
rank C or lower. Mina is rank B. You still have it. A B-rank crystal or higher, or the GM's Revive, brings Mina back."

**A trade checks and tells, never refuses.** A hand-over (`handOver`) or an offer of a crystal to a dead hunter reads
the same `revives`; when it is false, `tooLowLine` (use.ts) says "Resurrection Crystal (C) cannot bring back Mina
(rank B)." for the giver's confirm; no screen confirms a trade yet (no view calls `handOver`), so it waits in core. It
does not refuse: the goods are the receiver's to keep or pass on, and a trade's refusals are about goods, not their use.

## 6. Sinks, sources and what a thing costs in sessions

Sources: the shared world Clear, personal gates, a world gate run alone, sold items, the GM's hand. Sinks: the shop,
the spread (three quarters), respecs, used consumables. **Does income outrun prices as rank rises?** Not on the
ladder: an own-rank middle item costs 0.5 to 0.9 of a table session at every rank, the next rank's 1.7 to 2.9. A respec
(5 × level²) falls behind (1.0 session at C, 0.3 at S); the New Shape boon already gives it free. No consumable exists
above epic, so at A and S potions stop being a sink: content for later. Block `[6]`, table player:

| Rank | Own-rank middle item | Next rank's item | Two own-rank potions | Own-rank crystal | Respec at the rank's first level | Daily / table |
|---|---|---|---|---|---|---|
| E | 0.5 | 1.7 | 0.5 | 5.2 | 0.0 (5 gold) | 3.2 |
| D | 0.6 | 2.3 | 0.6 | 5.9 | 0.9 | 3.0 |
| C | 0.6 | 2.5 | 0.6 | 6.3 | 1.0 | 3.0 |
| B | 0.6 | 2.4 | 0.6 | 6.4 | 0.8 | 2.9 |
| A | 0.7 | 2.9 | 0.7 | 7.3 | 0.5 | 2.4 |
| S | 0.9 | | 0.9 | 8.8 | 0.3 | 1.5 |

## 7. What changes in code

### 7.1 Rules in RULES

Each number is a rule with its domain beside it, so the domain lint ("every rule number has its domain beside it") and
`tests/rule-domains.test.ts` hold that it has one; no balance number is a literal in code. The test named holds its
meaning, the expected value worked out from the rule, not from running the code.

| Rule | Today | Design | Domain | Test that holds it |
|---|---|---|---|---|
| `rarities.*.rank` | none (a rarity's rank is its place in a list, in `measure.ts` only) | common E, uncommon D, rare C, epic B, legendary A, mythic S | a `Rank`: not a number, its type is its domain | `tests/items.test.ts`: each rarity's unpriced price is the middle of `loot[rank].gold` of its rank; an edit of `loot.C.gold` moves the rare price and no other |
| `baseValue` | 10 (× a literal 10) | goes: the common price is E's Clear, computed | | the row above |
| `rarities.*.mult` | 1, 2, 5, 15, 50, 200 | goes: each price is its rank's Clear, computed | | the row above |
| `gradeStep` | none | 1.5 | real 1 to 1.8 (1.8² is under 3.25, the shipped ladder's smallest step, so a plus stays under the next tier's minus) | `tests/items.test.ts`: a grade multiplies the price by `gradeStep`^grade; every tier's plus is under the next tier's minus |
| `saleShare` | a literal `/ 2` | 0.25 | `SHARE` | `tests/inventory.test.ts`: a sale pays `floor(price × saleShare)`, at least 1; buy then sell leaves `price − sellPrice` |
| `usedUpShare` | none | 0.5 | `SHARE` | `tests/items.test.ts`: an unpriced consumable costs `usedUpShare` of its rank's Clear, rounded |
| `itemBudget.share` | none | 0.5 | real 0 to 2 | `tests/item-budget.test.ts`: the middle budget is share × `pointsAt` / slots; the spans tile |
| `itemBudget.weaponStep` | none | 1 | real 0 to 10 | `tests/item-budget.test.ts`: a plain weapon with the free die of its tier spends 0 |
| `solo.lootShare` | none | 0.25 | `SHARE` | `tests/spawn.test.ts`: a personal gate's gold is `lootShare` of the roll; its pick is drawn with that chance (seeded) |
| `gateParty` | none (each payee whole) | 4 | whole 1 to 12 | `tests/pay.test.ts`: each of n payees takes floor(amount × party × min(1, party / n) / n) of a world gate's gold roll and of its XP; a party of `gateParty` takes the amount each, one hunter `gateParty` times it, the total past the party falls; a fight with no gate pays each the whole XP |
| `reviveClears` | none (`value: 100000`) | 10 | whole 1 to 1000 | `tests/items.test.ts`: an unpriced reviving item costs `reviveClears` × its rank's Clear |
| `reviveLevelShare` | none | 1/30 | `SHARE` | `tests/use.test.ts`: a raising at level L leaves level max(1, L − ceil(L × share)): 1 stays 1, 30 goes to 29, 31 to 29; a crystal and the GM's Revive alike; the points free fall by the lost levels' points |
| `xpSplit` | false (each payee the whole XP) | goes in unit 6, with its readers: a world gate's XP is shared by `gateParty` (section 4.1) | | the `gateParty` row |
| `loot.*`, `dailyTemplate.rewards.gold`, `build.respecGold` | | unchanged | | |

**The price, computed.** `clearOf(R, rank)` in `rules.ts`, the middle of `loot[rank].gold`, is the one reader of the
anchor. `priceOf` reads it through the rarity's rank and rounds once to whole gold: round(Clear × `gradeStep`^grade, ×
`usedUpShare` for a consumable, × `reviveClears` for an item that revives). No stored result stays: `baseValue` was the
common price and `mult` each rarity's ratio to it, and both are now the loot table read through the rank, so keeping
either would be the second home E-1 names. A rarity's rank sits in its `rarities` entry beside its color, since it is a
fact of the rarity; the GM's reader of a rarity (`overrides.ts` `rarity`) reads `rank` as one of `RANKS` (`oneOf`) where
it read `mult`, and a GM's new rarity needs a color and a rank where it needed a color and a factor. The Rules page's
sale table lists the six rarities of `RARITIES`, the ones an item can carry.

New, not rules: `clearOf` (`rules.ts`); `GRADES` and `Grade` (`registry/items.ts`); `itemSpend` and `gradeBand`
(`registry/item-budget.ts`, beside `worth.ts`); `revives` and the refusal `too-low` (`hunter/use.ts`), which read a
crystal's rank from `rarities.*.rank` (no table of their own). Two more tests: `tests/item-budget.test.ts` "no built-in
item spends past its grade's top, and none claims a grade above its spend without a block the budget cannot weigh",
whose allowed exceptions are the six items of ruling 6 by name, and `tests/use.test.ts` "a crystal revives a dead hunter
of its rank or lower and refuses a higher one, spending nothing".

### 7.2 What a GM can edit

Every number in 7.1, and each rarity's rank, is GM-editable in the Rules editor (`parseOverrides`). Today such an edit
reaches only the GM's phone (finding 8); unit 8 carries the economy rules in the room's `rules` doc so one edit reaches
every phone. A grade and a hand price stay per item in the item maker.

### 7.3 Units

Each is one commit that ends in `bun run test` green. Unit 1 puts every rule in `RULES`, so the later units only read
them and the file the domain lint watches gains nothing after it (unit 6 only deletes `xpSplit`). After it, three lanes
can run side by side; inside a lane the units are in order.

| # | Lane | Unit | Files | Proof |
|---|---|---|---|---|
| 1 | first | The rules and the ladder: every rule of 7.1 with its domain, `rarities.*.rank` among them; `clearOf`; `priceOf` from the Clear of the rarity's rank, with no `baseValue`, `mult` or `× 10`; an unpriced consumable by `usedUpShare`; `sellPrice` by `saleShare`; the built-in items lose their hand values but the crystal's (unit 4 prices it); the GM's reader of a rarity reads `rank` in place of `mult`; `saleRows` over `RARITIES`, `saleLine` | `src/core/rules.ts`, `src/core/registry/items.ts`, `src/core/hunter/inventory.ts`, `src/core/rules-text.ts`, `src/core/overrides.ts`, `tests/items.test.ts`, `tests/inventory.test.ts`, `tests/rules-text.test.ts`, `tests/rule-domains.test.ts`, `tests/overrides.test.ts`, `tests/rules.test.ts`, `measure.ts` (its "today" kept as constants), e2e cases that read a shop price (grep the old prices) | the ladder and sale tests; an edit of `loot.C.gold` moves the rare price; the Rules page's sale table |
| 2 | items | The grade: `GRADES`, `grade?` on `Item` and `ItemDef`, `itemOf`, `parseItem`, `DISTINGUISHES`; `priceOf` reads it; the item maker's grade chips and its price placeholder (which then prices a consumable by `usedUpShare` too); the label "Epic+" in the item's detail line (`describeItem`) | `src/core/registry/items.ts`, `src/core/hunter/inventory.ts`, `src/views/loot.js`, `src/core/effects.ts`, `tests/items.test.ts`, `tests/inventory.test.ts` | a graded price; an Epic+ and an Epic are two stacks |
| 3 | items | The budget: `itemSpend`, `gradeBand`; the item maker's spend line; the built-ins' grades of 2.5, the six past their tier's top at plus and named in the test as its allowed exceptions (ruling 6) | `src/core/registry/item-budget.ts` (new), `src/core/registry/items.ts`, `src/views/loot.js`, `tests/item-budget.test.ts` (new) | the built-ins test, which fails on a seventh item past its top; the maker's line on a weighed and an unweighed item |
| 4 | items | The tiered crystal and the cost of a raising: `revives` (a crystal's rank is its rarity's `rank`), `too-low` and its words; a reviving item's price by `reviveClears`; six shop crystals; `tooLowLine`; the level loss by `reviveLevelShare` in the life's `revive` of `sheetEdit`, where the crystal and the GM's Revive both pass, with its words where the raising is told and in `downLine` | `src/core/registry/items.ts`, `src/core/hunter/use.ts`, `src/core/hunter/grant.ts`, `src/core/rules-text.ts` (`downLine` only), `tests/use.test.ts`, `tests/items.test.ts`, `tests/rules-text.test.ts`, `tests/e2e/crystal.e2e.ts` | the use test at each side of the rank; a raising at level 31 leaves level 29 by a crystal and by the GM; the e2e buy of a C crystal at 12,500 |
| 5 | gates | Personal gates' share: `rollLoot` takes a share (gold times it, its pick drawn with that chance); a personal run passes `solo.lootShare`; `soloLines` says it | `src/core/gates/spawn.ts`, `src/views/inventory.js` (`rollLoot`), `src/views/gates.js` (`lootOf`), `src/core/rules-text.ts`, `tests/spawn.test.ts`, `tests/rules-text.test.ts` | the share test; a world gate's roll unchanged |
| 6 | gates | Shared world gold and XP: `shareEach(amount, n, party)` in `pay.ts` in place of `splitAward`; `clearShares` shares the gold roll and the XP due by it, `planEncounter` the XP of a fight linked to a gate (a fight with no gate pays each the whole); `xpSplit` deleted with its readers; a world gate's solo run is n = 1; the Clear panel's note says gold and XP each for the hunters ticked; the Rules page's lines | `src/core/gates/pay.ts`, `src/core/gates/solo.ts`, `src/core/rules.ts` (the deletion only), `src/views/gates.js`, `src/views/combat.js`, `src/views/rulesref.js`, `src/core/rules-text.ts`, `tests/pay.test.ts`, `tests/solo.test.ts`, `tests/rules.test.ts`, `tests/rule-domains.test.ts`, `tests/e2e/gates-quests-dailies.e2e.ts` | the split test at 1, 4 and 6 payees, gold and XP; a solo run's four rolls and four times the XP |
| 7 | after 1 to 6 | `measure.ts` reads `RULES`, `clearOf` and `itemSpend` in place of its `DESIGN` constant, its own copy of the spend and its rank by a rarity's place | `docs/agent-handoff/features/economy/measure.ts` | its tables unchanged |
| 8 | room | The room carries the economy: `RoomRules` gains `rarities` (each with its rank), `gradeStep`, `saleShare`, `usedUpShare`, `reviveClears`, `reviveLevelShare`, `solo.lootShare`, `gateParty` and `loot`, laid over a player's rules | `src/core/protocol.ts`, `src/core/hunter/build.ts`, `tests/protocol.test.ts`, `tests/build.test.ts` | a player's shop price follows the GM's edit of `loot.C.gold` |

Lanes: items (2, 3, 4), gates (5, 6) and room (8) share one file after unit 1, `src/core/rules-text.ts`, where unit 4
changes only `downLine` and units 5 and 6 only `soloLines` and the gate's lines, so a merge of it is by function. The
rulings settle every unit; none waits on a question.

## 8. Questions for the owner

Both were answered on Nov 20: keep the six (ruling 6) and split XP as gold (ruling 7). The questions as they were asked:

1. **Six built-in items are stronger than any grade of their tier** (section 2.5: Mage Circlet and Baruka's Mana Ring
   move up to epic; Kamish's Wrath, Orb of Avarice, Monarch's Scepter and Armor of the Absolute Being lose dice, mana or
   HP). Fix them as the table says, or keep them and price them as their tier's plus? Recommended: fix.
2. **XP and a crowd.** Gold now pays a small party more and a crowd less. Should a gate's XP do the same, or stay whole
   to each hunter as now? Recommended: whole (the pace of ranks is set on it; the gold carries the reward for risk).

## 9. Rerunning the numbers

`measure.ts` prints every table above; the design's numbers live in its `DESIGN` and `CLAIMED` until the
units put them in `RULES` and `items.ts` (unit 7). What would move them: a measured personal clear share far from 0.5 at D, B, A or S (only E and C were
measured); a GM's world sessions holding more than one gate; `loot.*.gold` changed, which moves every price with it (in
the game too, from unit 1); a change to the body's curves (`RULES.fight.stat`), which moves the conversions of section
2.3 and every item's spend.

## 10. The owner's rulings (Nov 20, typed in the lead's session). They win over the sections before them.

His words, answering section 8: "There should be variation in strength within tiers. Some items should be like B+ or B-, so the cost should also change accordingly. A quarter. A quarter. Let's make resurrection crystals tiered too. You have to use one greater or equal to the rank you're trying to res. Each hunter should share, but that might mean we have to bump up the gate pay. I want to incentivize them taking risks (less players per run and if they brute force it with more players they should get less reward)"

1. **Prices by rank: yes, and with grades inside a tier.** An item can be stronger or weaker than its tier's middle (B+, B, B-), and its price moves with its grade.
   His addition, in his words: "Yes, and even then there should be variation between. Like some items lower stats but better abilities. Statuses, passives, etc..." So two items of one tier and grade need not be strong in the same way: an item spends a budget across stats and what it does, and the price follows the grade, not the mix (section 2.3).
2. **The sale: a quarter.**
3. **Personal gates: a quarter** of a world gate's loot.
4. **The crystal is tiered.** A crystal has a rank, and it revives only a hunter of its rank or lower. Its price follows its rank.
5. **World gate gold is shared** among the hunters of a Clear, not paid whole to each. The gate's pay may rise to make up for it. A smaller party must earn more each than a larger one: taking the risk with fewer hunters is rewarded, and brute force with many is paid less.

Sections 2 to 8 were revised to these on Nov 20.

6. **The six built-in items stronger than any grade of their tier are kept as they are** (the owner, Nov 20, answering section 8: "Keep them."). They are not moved up a tier and lose nothing; each is priced as its tier's plus, and the budget test of unit 3 names them as the allowed exceptions, by id, with this ruling as the reason.
7. **A gate's XP is split as its gold is** (the owner, same answer: "XP should be split as well."). Section 4's rule for gold (a pot shared among the hunters of a Clear, a small party earning more each, a crowd paid less) applies to XP too. The unit that builds the shared gold builds the XP split with it and says what it does to the pace of ranks (section 4.4), raising a gate's XP as the gold is raised so the party the gate is made for levels as today.
8. **A dead hunter can be resurrected within an hour of dying; a crystal itself never expires** (the owner, Nov 20, answering the world bible's question on a crystal's time limit: "Oh for a player to be resurrected? An hour. But the crystals themselves don't expire."). **The hour is lore only** (the owner, same day, relayed by the previous lead's session: "Ehh I mean just canonically. I'll administer that myself as the gm."): the app enforces no time limit on a crystal and none is built.
9. **A raising costs levels** (the owner, Nov 20, typed in the lead's session, on the world bible's row 13, death should cost a lot: "Sure, losing levels is good. Probably more the higher you are, maybe 3.33% of your total level."). A hunter raised from death loses a share of their level: a rule `reviveLevelShare` (1/30, domain `SHARE`), the loss being the level times the share rounded up, so at least one level, and a level never under 1. The lead's defaults, his to change: it applies to every raising (a crystal and the GM's Revive alike), and the points of the lost levels go with them. Unit 1 puts the rule in `RULES`; unit 4 builds the loss with the tiered crystal and its words on the screen.
10. **No level cap for the players' hunters** (the owner, same message: "No level cap for my players. They'll rank up."). The world's cap by rank is lore for other hunters; the app holds no cap and builds no trial gate.
