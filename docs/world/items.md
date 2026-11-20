# Items, crafting and professions

`bun docs/world/prices.ts --write` prints the tables between `<!-- prices:... -->` marks. The owner set the direction
on Nov 20: consumables are not half the price of gear by default, some cost far less and some far more; there are
no scrolls and no charm that prevents a death; gate keys are very rare; every item can be traded or sold; seeds and
skill books can be bought; crafting exists, with rare materials and a skill tree for each profession.

This file proposes rules that the game does not have yet. `economy.md`, section 15, lists them for the lead.

## 1. Item types

| Type | What it does | Lasts | Where it comes from |
|---|---|---|---|
| Weapon, armor, accessory | Worn in one of ten slots. Has a rarity and a grade | Until sold | The Shop, drops, smiths and artificers |
| Staple | Restores HP, mana or fatigue, or removes one status | A moment | The Shop, alchemists |
| Tonic | Raises a stat or a resistance | One fight | The Shop, alchemists |
| Thrown item | A bomb, a net or a flare: damage or a status on a target, with no cast time | A moment, priced as one fight | Alchemists. The Shop sells only common ones |
| Food | A buff for the whole party | One gate | Cooks. The Shop sells none |
| Escape stone | Takes the party out of a gate that is not red | One use | The Shop, at the gate's rank or higher |
| Seed | Permanent stat points (E 1, D 1, C 2, B 3, A 4, S 5). Works only at its rank or below, up to 5 per rank, and respects a hunter's cap | For good | The Shop, artificers. Costs one Clear of its tier |
| Skill book | One ability, learned permanently | For good | The Shop for built-in abilities, artificers for others |
| Enhancement stone | Raises one piece of gear by one grade, or fails | One attempt | The Shop, artificers |
| Resurrection Crystal | Raises a dead hunter of its rank or lower within the hour after the free first revive and single debt revive. Must be bought before death (gold held after death does not help) | One use | The Shop only |
| Gate key | Opens a personal gate of the key's rank at once, untraceable by the Bureau and holding one rare material. Keys and the GM are the only ways to get a personal gate | One use | Boss drops only. About one Clear in two hundred drops one |
| Material | An ingredient: crystal, monster parts, rare finds | Until used | Gates, through reclaimers |
| Catalyst | The Shop's ingredient that every recipe needs | Until used | The Shop only |
| Keepsake | A memory the System took at a raising (`story.md`, section 3) | For good | Story only |

Three things do not exist, by the owner's ruling: a scroll that casts an ability once, a charm that prevents a
death, and an item that cannot be traded.

## 2. What a consumable costs

A consumable's price answers two questions. Which rank's power does it give? How long does that last? The price is
the Clear of that rank times a share for the duration.

<!-- prices:potions -->
| Rank of the power it gives | A moment: a staple | One fight: a tonic or a thrown item | One gate: food | Gets the party out: an escape stone | For good: a skill book | A seed | A staple through a runner | A staple, labourer-days |
|---|---|---|---|---|---|---|---|---|
| E | 10 | 50 | 100 | 200 | 1,000 | 100 | 12 | 0.8 |
| D | 33 | 163 | 325 | 650 | 3,250 | 325 | 39 | 2.7 |
| C | 125 | 625 | 1,250 | 2,500 | 12,500 | 1,250 | 150 | 10 |
| B | 500 | 2,500 | 5,000 | 10,000 | 50,000 | 5,000 | 600 | 42 |
| A | 1,900 | 9,500 | 19,000 | 38,000 | 190,000 | 19,000 | 2,300 | 160 |
| S | 7,500 | 37,500 | 75,000 | 150,000 | 750,000 | 75,000 | 9,000 | 630 |
<!-- /prices:potions -->

- **A staple is cheap.** A Health Potion costs a tenth of an E Clear, so a hunter can drink two in a gate without
  losing the gate's pay.
- **An item above the user's rank costs more than the user's own gear.** A C-rank bomb costs 625 gold. An E-rank
  who throws one spends six E Clears on one fight.
- **A skill book costs ten Clears,** the same as a Resurrection Crystal of its rank.
- **A seed costs one Clear.** the owner wants seeds bought often. To stop high-rank hunters from spamming 100-gold E
  seeds and to stop capped hunters from bypassing their cap, a seed works only for a hunter of its rank (or lower),
  cannot be absorbed by a hunter at their cap, is capped at five seeds of each rank tier, and scales its stat points
  with tier (E 1, D 1, C 2, B 3, A 4, S 5).
- **A key has no Shop price.** Keys sell at auction for about 1 to 2 Clears of the key's rank (proposed, needs
  the owner). Because a personal gate pays only a quarter Clear of gold, buyers pay for privacy from the Bureau, solo
  titles, and the one rare crafting material a keyed gate guarantees.

The built-in consumables under this rule: Health Potion, Mana Potion and Stamina Tonic 10 gold; Greater Health
Potion 33; Elixir of Life 500.

For Residents this makes medicine cheap. A Health Potion costs 12 gold through a runner, which is a
labourer's day. It still works at a tenth of its strength on a Resident, and a second one in a week still causes
potion sickness (`economy.md`, section 6).

## 3. Crafting

A crafter turns materials and one catalyst into an item. Four rules keep crafting inside the economy.

1. **Every recipe needs a catalyst from the Shop.** The catalyst costs a fifth of the Shop's price of the item
   made. It is the only part of a craft that destroys gold, and it keeps the Shop's drain on the money supply.
2. **A crafted item sells under the Shop's price and over a used one's.** A crafter charges about 85%.
3. **Materials are worth more than the Shop pays for the finished item.** Otherwise nobody would sell materials.
4. **A crafter can make what the Shop does not stock:** plus grades, food, thrown items above common, and
   legendary and mythic gear. Those recipes need rare materials.

<!-- prices:crafting -->
| Tier (rank) | Shop price, a middle item | Materials | Catalyst from the Shop | What the crafter charges | The crafter keeps | A used one at a stall |
|---|---|---|---|---|---|---|
| common (E) | 100 | 45 | 20 | 85 | 20 | 70 |
| uncommon (D) | 325 | 146 | 65 | 276 | 65 | 227 |
| rare (C) | 1,250 | 563 | 250 | 1,063 | 250 | 875 |
| epic (B) | 5,000 | 2,250 | 1,000 | 4,250 | 1,000 | 3,500 |
| legendary (A) | 19,000 | 8,550 | 3,800 | 16,150 | 3,800 | 13,300 |
| mythic (S) | 75,000 | 33,750 | 15,000 | 63,750 | 15,000 | 52,500 |
<!-- /prices:crafting -->

### Rare materials

| Material | Where it is found | What needs it |
|---|---|---|
| Boss core | One in every cleared gate | Epic, legendary, and mythic (B, A, S) middle gear and signature boss items (common to rare middle gear uses wall crystal and standard parts, leaving Helix its 90% share of Carrow's crystal |
| Red bloom | Only in red gates, on the walls near the boss | Plus-grade weapons and thrown items |
| Second-area relic | Only in the second area of a double gate | Plus-grade armor and accessories |
| Standing silt | Only in gates that never close | Skill books |
| Break ash | The street where a break was contained, for a day afterwards | Seeds |
| Named parts | A boss of a named kind: a scale, a fang, a heart | That boss's signature item |
| Ripe crystal | A harvest cut on a gate's last day | Enhancement stones |

Two of these pull a party toward danger on purpose. Break ash rewards being at a break. Ripe crystal rewards
holding a gate to its last day.

## 4. Professions

A hunter can learn two professions. A Resident can learn Reclaimer or Cook. A profession has its own level and six
tiers. The tier decides the rarity of what the crafter can make. A profession's level is not capped by the
hunter's rank, so a capped E-rank can become a Grandmaster. This is the only ladder in the world that a cap does
not stop.

| Tier | Makes items up to | Typical time to reach |
|---|---|---|
| Apprentice | common | at once |
| Journeyman | uncommon | three months |
| Adept | rare | a year |
| Expert | epic | three years |
| Master | legendary | eight years |
| Grandmaster | mythic | fifteen years, and a named part for the masterwork |

Each profession has three branches. A crafter picks one branch at Adept and gains its perks at Adept, Expert and
Master.

| Profession | Branch | What it makes | Perk at Adept | Perk at Expert | Perk at Master |
|---|---|---|---|---|---|
| **Reclaimer** | Cutter | Crystal | A tenth more crystal from a harvest | Can cut ripe crystal without spoiling it | Finds the boss core in half the time |
| | Flenser | Monster parts | One more part from each carcass | Can take named parts | Parts keep for a month, not a week |
| | Prospector | Rare finds | Senses red bloom from outside the boss's room | Can gather in a gate that is not yet cleared | Finds standing silt |
| **Alchemist** | Apothecary | Staples and status removers | A batch of three from one catalyst | A remover that clears two statuses | Staples at the plus grade |
| | Brewer | Tonics | A tonic lasts two fights | Two stats in one tonic | A tonic for the whole party |
| | Grenadier | Thrown items | A larger radius | A thrown item one rank above the crafter's tier | A thrown item that leaves a zone |
| **Cook** | Butcher | Cuts from carcasses | Meat from E to C monsters is safe to eat | Meat from B and A monsters | Meat from S monsters and named bosses |
| | Chef | Food for one hunter | Two buffs in one meal | A meal that lasts two gates | A meal that grants an ability for a gate |
| | Provisioner | Food for a party | One meal feeds four | Feeds eight | The buff survives a death and a raising |
| **Smith** | Weaponsmith | Weapons | Can forge minus and middle grades | Can forge the plus grade | Can add one status to a weapon |
| | Armourer | Armor and shields | Minus and middle grades | The plus grade | A piece at two thirds of its weight |
| | Fitter | Repairs and refits | Moves a status from one item to another | Refits an item to another slot of its kind | Salvages half the materials from any item |
| **Artificer** | Jeweller | Rings and necklaces | Minus and middle grades | The plus grade | A second bonus on one accessory |
| | Stonecutter | Enhancement stones | A stone from ripe crystal | A stone that works three times in five | A stone that works two times in three, still lost on failure |
| | Binder | Seeds and skill books | Seeds, from break ash | Skill books, from standing silt | A book for an ability the Shop does not sell |

## 5. Enhancement

An enhancement stone raises one piece of gear by one grade: minus to middle, or middle to plus. It is a gamble,
by the owner's ruling, and works half the time. When it fails, the stone is lost and the item is unchanged. A stone must be of the item's tier.

<!-- prices:enhancement -->
| Tier (rank) | A stone | Chance it works | Expected cost of one grade | What a grade adds to the Shop price (middle to plus) |
|---|---|---|---|---|
| common (E) | 50 | 50% | 100 | 50 |
| uncommon (D) | 163 | 50% | 325 | 163 |
| rare (C) | 625 | 50% | 1,250 | 625 |
| epic (B) | 2,500 | 50% | 5,000 | 2,500 |
| legendary (A) | 9,500 | 50% | 19,000 | 9,500 |
| mythic (S) | 37,500 | 50% | 75,000 | 37,500 |
<!-- /prices:enhancement -->

On average a grade costs two stones, which is one Clear. That is more than the grade adds to the item's Shop
price. Hunters still buy stones, because the Shop sells no plus grade above rare and because a favourite item
cannot be bought again. `machines.md` charts a piece of gear's grade.

## 6. What this does to the economy

- The Shop destroys about 71% of the gold that gates create. Catalysts, stones, seeds, skill books, and escape stones
  replace part of what cheaper potions lost.
- Residents buy more Shop goods, because staples cost a fifth of what they did.
- A capped hunter has a second career. Carrow's E-ranks and D-ranks are most of its alchemists and cooks.
- A-ranks and S-ranks now have things to buy: seeds, skill books and stones at their own tier.

## 7. The owner's rulings (Nov 20)

- Personal gates are not timed. The GM grants them, or a key opens one.
- Enhancement is a gamble.
- A hunter can learn two professions.
- Seeds stay, beside the daily quest's stat point. This file prices a seed at one Clear so that hunters buy them.
