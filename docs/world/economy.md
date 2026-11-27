# The economy

`bun docs/world/prices.ts --write` prints every table between `<!-- prices:... -->` marks. The script exits with an
error if any check in the next section fails, so a change that breaks the economy cannot be written into this file
unnoticed.

Prices are in gold. One gold is 100 bits. States strike bits in nickel, because the System pays out only whole
coins.

## How the numbers are derived

Every number in this file comes from one of three places, and the script keeps them apart.

1. **The game.** `RULES` gives the gold a gate pays by rank, the break days and the XP. The owner's rulings give the
   economy rules: an item costs one Clear of its tier, a sale pays a quarter, consumables scale by rank and how long
   they last (`items.md`, section 2), a crystal costs ten Clears (after a free first revive and one revive on debt),
   and a gate's gold is shared.
2. **Assumptions about the world.** The object `WORLD` in the script holds them, each with a comment that gives
   its reason. Examples are the number of gates a month in San Francisco, the share of hunters who carry a crystal, and
   the chance of dying in a gate.
3. **Derived numbers.** Everything else is computed from the first two. The script derives the head-counts, the
   gold created and destroyed each month, insurance premiums and every price table.

### The order of derivation

- **Shop prices are fixed in gold.** The game sets them, and nobody in the world can change them. They are the
  only prices that do not float.
- **The wage floats.** Wages, rents and food prices settle wherever the supply of gold puts them. Two separate
  conditions fix the labourer's wage at 12 gold, and the script checks both (section 1).
- **Head-counts follow from seats.** A gate has four seats. The number of gates fixes how many hunters can work
  in guilds and how many unsigned hunters get a public gate.
- **Gold created and destroyed follows from head-counts.** Each kind of hunter clears a known number of gates and
  buys a known number of potions.
- **Premiums follow from death rates.** Crystal cover and break cover are the expected loss plus the insurer's
  margin.

### Who is in San Francisco

<!-- prices:model-people -->
| Who | How many | How the number is found |
|---|---|---|
| Hunters in San Francisco | 1,600 | one person in 500 |
| Seats in world gates a month | 1,600 | 400 gates, four seats each |
| Guild members | 213 | the four raiding guilds of `factions.md` |
| Liners (a guild's first teams) | 200 | the guilds' half of the seats, at 4 gates a month each |
| Guild members on the bench | 13 | members less liners |
| Unsigned hunters with a public gate a month | 604 | what the public seats allow, after the rest take one gate in four months |
| Unsigned hunters with one gate in four months | 783 | the rest |
| Gate keys dropped a month | 2 | one cleared gate in 200; each opens one personal gate |
| Reclaimers | 1,164 | a quarter of the harvest, at a reclaimer's wage |
| Full-time runners | 250 | the 20% markup on Residents' Shop medicine, at an unskilled month's wage |
| Regular hunters who die for good in a year | 6 (0.8% of regulars) | red-gate wipes, lost bodies, and 3rd+ deaths without a crystal |
| All hunters who die for good in a year | 8 (1 occasional) | regulars plus occasional hunters |
| Breaks a year | 4.8 | 0.1% of world gates |
<!-- /prices:model-people -->

Two rows matter at the table. About 800 of 1,600 hunters have a regular seat in world gates: 200 in guilds at
four gates a month and 600 unsigned at one. The other 800 get one gate in four months and live on other jobs.

### Gold created and destroyed each month

<!-- prices:model-flows -->
| Gold a month in San Francisco | Gold | Share |
|---|---|---|
| Minted: world gates | 1.9 million | 100% of the mint |
| Minted: personal gates (from keys) | 0.0 million | 0% of the mint |
| Destroyed: hunters' staples, tonics, food catalysts and escape stones | 0.3 million | 15% of the mint |
| Destroyed: hunters' gear, bought new or as catalysts | 0.2 million | 13% of the mint |
| Destroyed: enhancement stones (Shop and catalysts) | 0.1 million | 5% of the mint |
| Destroyed: seeds and skill books (Shop and catalysts) | 0.2 million | 11% of the mint |
| Destroyed: debt revives and pre-bought crystals used | 0.0 million | 0% of the mint |
| Destroyed: Residents' medicine through runners (ER, homes, trauma, Elixirs) | 0.4 million | 20% of the mint |
| Left in circulation | 0.7 million | 35% of the mint |
| All income in the city | 266.7 million | for scale: the mint is 0.7% of it |
| The harvest (crystal and carcass) | 2.8 million | 24% of the city's power bill |
| Gold accumulated in San Francisco over 20 years | 110 million | 8.6% of notes and deposits |
| Gold needed for the 3% Tide alone | 0.3 million | the rest (4.2%/yr) rebuilds thin bank reserves and adds mild inflation |
| Notes and deposits, with the gold | 1 billion | a year's income changes hands 2.5 times |
<!-- /prices:model-flows -->

World gates create nearly all the gold, apart from the few personal gates that keys open. The Shop destroys about
71% of it (about 31% through hunters and 40% through Residents' medicine). The remaining 29% stays in circulation.

**No GDP share is fitted.** Resident Shop spending is built from four concrete medical rates: emergency-room Health
Potions (a quarter of 0.25 visits per person a year), one household Health Potion a year for accidents and go-bags,
Greater Health Potions for severe trauma (0.5% of people a year), and Elixirs of Life for a third of critical
illnesses (0.5% of people a year). Bank gold reserves are not assumed at steady state either: integrating twenty
years of net minting (with lower clearing during the Break Years and 3% annual Tide growth since Year 5) puts
San Francisco's accumulated gold stock at about 110 million, or 8.6% of notes and deposits. Because the gold supply is only
twenty years old, net minting grows that stock faster than the 3% Tide; the extra 4.2% a year goes into bank reserves and into mild price inflation.

### What moves the wage

The table shows the wage that would balance the books if one input changed. It answers why a labourer earns 12
gold and not 60.

<!-- prices:model-sensitivity -->
| If this changed, and nothing else | The wage that holds today's balance | Against today's |
|---|---|---|
| Nothing | 12 | 1.00 times |
| Every hunter is given one personal gate a week | 24 | 2.02 times |
| Residents buy twice the medicine | 8.8 | 0.73 times |
| Residents buy half the medicine | 15 | 1.22 times |
| The Tide doubles to 6% a year | 7.3 | 0.61 times |
| A tenth of hunters stop hunting | 9.8 | 0.82 times |
<!-- /prices:model-sensitivity -->

These rows are usable at the table. Personal gates are the largest lever. If every hunter were given one a week,
the gold created would more than double and every wage and price in the city would follow within a few years, while
Shop prices stayed fixed. This is why the world has so few of them. If the Tide doubles, the city needs more gold
than the gates supply, and wages fall.

### The checks

Each row is a rule that the economy must satisfy and the value the script computed. The script fails if any row
does not hold.

<!-- prices:model-checks -->
| Check | Value | The rule | Holds |
|---|---|---|---|
| The anchor: the owner's rule for an E-rank | 418 gold a month against a labourer's 300 | an E-rank with a regular seat nets 1.1 to 1.6 times a labourer's month for four gates: "only a bit richer than a day laborer despite not having to work as often" (the owner, Nov 20) | yes |
| Shop sinks leave healthy growth | 35% of the mint left | bottom-up hunter and Resident sinks leave 15% to 40% of minted gold in circulation, with no fitted GDP share | yes |
| Twenty-year gold stock is sound | 110M gold (8.6% reserve, +4.2%/yr above Tide) | gold is money: 20 years of net minting is 5% to 40% of notes and deposits (under 5% a bank run empties the vaults, over 40% no bank is needed), and it grows under 5% a year faster than the Tide | yes |
| Guild seats | 200 liners of 213 members | the guilds' seats give at least a third and at most all of the members a liner's gates | yes |
| Public seats | 604 of 1,387 unsigned | the public seats are neither oversubscribed nor left empty | yes |
| Signing pays | 5.3, 5.5, 5.7, 5.7, 5.7, 5.8 | a liner nets more than a freelancer at every rank, or nobody signs | yes |
| A guild survives | 0.82 Clears a gate (same at every rank) | a guild keeps something from a gate, and under two Clears, or a rival bids rights up | yes |
| A mercenary's day | 2.4, 2.6, 2.8, 2.9, 2.9 | from E to A, a day rate is 1 to 3 times a liner's net working day | yes |
| Retired scouts do not out-earn liners | 1,200 against 4,394 net | a retired C-rank scout earns less than an active C-rank liner nets | yes |
| Regular hunters die | 0.8% a year (6 of 804) | between 0.5% and 3% of regular hunters die for good in a year, matching numerator and denominator | yes |
| The harvest powers the city | 24% of the power bill | fuel is 5% to 40% of what the city pays for power | yes |
| Boss cores leave Helix its share | 17 of 38 B/A/S cores (4.1% of all gates) | high-tier crafted gear uses fewer cores than B/A/S gates supply and under 10% of San Francisco's total cores | yes |
| Reclaimers can live | 1,164 crew | the quarter of the harvest pays at least a few hundred reclaimers a reclaimer's wage | yes |
| Fines deter: unlicensed entry | 1.0 Clears expected | the law table's fine times the catch chance is at least the Clear gained | yes |
| Fines deter: under-declared gold | 1.2 times the levy | the law table's fine multiple times the catch chance exceeds the levy dodged | yes |
| Table party pace | 1.2 to 1.6 sessions per item; 3.0 to 4.0 per pooled crystal | at every rank, an own-rank item takes 0.5 to 2 sessions and a 4-way pooled crystal takes 2 to 6 sessions | yes |
| The Shop's band (guard) | 0.25 < 0.4 < 0.7 < 1 | a fence pays more than the Shop, a stall sells for more than a fence pays, and both stay under the Shop | yes |
| A crafter undercuts the Shop (guard) | 0.7 < 0.85 < 1 | a crafted item sells under the Shop and above used gear | yes |
| A crafter can live (guard) | 20% of the Shop price | a crafter keeps 10% to 30% of the Shop price after materials and catalyst | yes |
| Materials are worth selling (guard) | 0.45 of the Shop price | materials are worth more than the Shop buys finished gear for | yes |
| A stone is not a bargain (guard) | 1.0 Clears a grade | raising a grade with stones costs at least what the grade adds to the Shop price | yes |
| Staples are cheap, lasting things dear (guard) | 0.1 < 0.5 < 1 < 2 < 10 | each longer-lasting consumable costs more than the one before | yes |
| Crystal buyers (guard) | 0.7 < 0.85 < 0.9 < 1 | each buyer pays less than the one that asks more questions, and all beat the Shop | yes |
<!-- /prices:model-checks -->

## 1. The anchor: what one gold is

The game's anchor is one Clear, the gold one hunter of a party of four takes from a world gate of a rank. An E Clear
is 100 gold. The world adds one assumption to tie that to a wage:

**An unskilled labourer earns 0.12 of an E Clear a day, which is 12 gold. Gold replaced the dollar, and every wage
and price in the world is paid in it.**

the owner set the rule on Nov 20: hunters tend to be richer than other people, and an E-rank is only a bit richer
than a day labourer despite working less often. Two conditions fix the wage at 12, and the script checks both.

- **The E-rank's income.** An E-rank with a guild seat clears four gates a month and nets 418 gold after the house
  share, the levy and consumables. A labourer works 25 days for 300. The E-rank is 1.4 times as well off for four
  days of work that can kill them. At a wage of 30 the same E-rank would earn half of a labourer's month, which
  breaks the rule. At a wage of 5 the E-rank would be rich.
- **The supply of gold.** For gold to be everyone's money, the gold that gates have created must be a sound
  reserve for the city's notes and deposits. At a wage of 12, twenty years of gates have left 110 million gold in
  San Francisco, which is 8.6% of the city's money. At a wage of 30 the same gold would be 1.4%, too little to stand
  behind a currency.

The higher ranks follow from the game's ladder, where each rank's Clear is about 3.5 times the one below. A guild
hunter nets 1 times the median wage at E, 3 at D, 11 at C, 43 at B and 160 at A.

<!-- prices:anchor -->
| What | Gold | How it is derived |
|---|---|---|
| One E-rank Clear | 100 | the middle of `RULES.loot.E.gold`: the game's number |
| An unskilled labourer's day | 12 | 0.12 of an E Clear |
| A plain street meal | 0.4 | a labourer's day buys 30 |
| An unskilled month | 300 | 25 working days |
| The median month's wage | 400 | four thirds of the unskilled month |
| The median year | 4,800 | twelve months |
<!-- /prices:anchor -->

Five numbers are enough to price most things at the table: a meal is 0.4 gold, a labourer's day is 12, the median
month is 400, an E Clear is 100, and an ordinary family flat is 48,000. One gold buys about what ten US dollars
bought in the 2020s, so an E Clear is about a thousand dollars and a Health Potion about a hundred.

## 2. Where gold comes from

When a party clears a gate, the System puts gold in each hunter's Inventory. A hunter can take it out as coins. Each
coin weighs 8 grams and is identical to every other, and a hunter's window shows at once whether a coin is real. No
state or forger can make one, so nobody can add to the supply except by clearing gates.

By Year 8 every state had pegged its currency to gold or stopped issuing it. In San Francisco's country the Ledger Act of
Year 17 made gold the legal unit of account. National banknotes still circulate as receipts for gold held in a bank.

The world's money supply therefore works like a game economy's:

| | In the world | In the game |
|---|---|---|
| Sources of gold | Clears of world gates, and of the rare personal gate | `loot[rank].gold`, shared; a personal gate's quarter |
| Where gold is destroyed | The Shop. A potion drunk, an item bought and a crystal used each remove gold. So does the Shop's buy-back at a quarter | the shop, the three-quarter spread, used consumables, respecs |
| Transfers, which make and destroy no gold | wages, rent, tax, the levy, guild shares, bribes, trades | trades between hunters |

Two results matter at the table:

- A few million hunters create all the money that eight billion people use. The unawakened depend on hunters for
  it and resent them for it.
- The Shop is the only place gold leaves the world. Finance ministries track potion sales as they once tracked
  interest rates. When hunters save gold and do not spend it at the Shop, the supply grows and the price of bread
  rises within the year.

## 3. The Shop sets a ceiling and a floor

The Shop sells to any hunter at one fixed price with no limit on stock, and it buys any item back at a quarter of
that price. Four things follow.

- An item the Shop stocks cannot sell for more than the Shop's price, because a buyer can go to the Shop.
- No item sells for less than a quarter of the Shop's price, because the seller can go to the Shop.
- Hunters trade with each other between those two prices. A fence pays 40% of the Shop's price. A used-gear stall
  sells at 70%. A hunter sells to the Shop only when they need gold the same hour.
- The unawakened cannot open the Shop. They buy through runners, who are licensed E-ranks that buy to order and add
  20%. A runner with one hospital's potion contract needs no other customer.

The Shop does not stock named drops, the plus grade of the high tiers, or items a maker made. Those have no
ceiling. They sell at auction on Ledger Row, often for several times the price of their tier.

## 4. Everyday prices

The script stores each price as a number of labourer-days, so the prices move with the anchor.

<!-- prices:everyday -->
**Food and drink**

| Thing | Gold | Labourer-days | Note |
|---|---|---|---|
| A plain street meal (noodles, a filled bread) | 0.4 | 0.03 | the anchor |
| Tea or coffee | 0.2 | 0.02 |  |
| A loaf of bread | 0.2 | 0.01 |  |
| A beer in a bar | 0.5 | 0.04 |  |
| A week of groceries, one adult | 9 | 0.75 | a quarter of an unskilled week |
| Dinner for two, a Saltmarket restaurant | 6 | 0.50 |  |
| Dinner for two in the Crown | 36 | 3 |  |
| A plate of monster meat (D-rank boar, from a licensed butcher) | 7.2 | 0.60 | reclaimers sell carcasses to butchers |

**Home**

| Thing | Gold | Labourer-days | Note |
|---|---|---|---|
| Crystal-grid power, a household, a month | 18 | 1.5 | fuel is under a fifth of the bill; the rest is the grid and Helix |
| Water and waste, a month | 4.2 | 0.35 |  |
| A phone plan with Doorwatch alerts, a month | 3.6 | 0.30 |  |
| A phone | 140 | 12 |  |
| Work boots | 12 | 1 |  |
| A good suit or dress | 60 | 5 |  |
| A go-bag, packed to the Bureau's list | 24 | 2 | a household in an Amber zone keeps one for each person |

**Getting around**

| Thing | Gold | Labourer-days | Note |
|---|---|---|---|
| A tram or bus ride | 0.1 | 0.01 |  |
| A month's pass | 6 | 0.50 |  |
| A taxi across town | 2.4 | 0.20 |  |
| Rail to the next city | 12 | 1 | trains between cities run armoured and escorted |
| A flight inside the country | 48 | 4 |  |
| A flight abroad | 240 | 20 | few routes, each with a hunter escort |
| A bicycle | 24 | 2 |  |
| A used car | 960 | 80 |  |
| A new car, stone cell | 3,600 | 300 | about ten median months |
| A hired escort car with a D-rank guard, a day | 96 | 8 |  |

**Health (the unawakened)**

| Thing | Gold | Labourer-days | Note |
|---|---|---|---|
| A clinic visit | 4.8 | 0.40 |  |
| A night in a trauma ward | 36 | 3 |  |
| A birth, with a week's care | 120 | 10 |  |
| A year of health cover, one adult | 240 | 20 |  |
| A funeral | 220 | 18 |  |

**School and services**

| Thing | Gold | Labourer-days | Note |
|---|---|---|---|
| A year at a private school | 1,200 | 100 |  |
| A year at university | 1,600 | 130 |  |
| A year at a hunter academy (unsponsored) | 3,600 | 300 | nine median months; a guild sponsors most students |
| A lawyer, an hour | 16 | 1.3 |  |
| A lawyer who specialises in guild contracts, an hour | 48 | 4 |  |
| A wedding, Saltmarket | 1,600 | 130 |  |

**Wages (a month unless said)**

| Thing | Gold | Labourer-days | Note |
|---|---|---|---|
| An unskilled labourer, a day | 12 | 1 | the anchor |
| The median wage | 400 | 33 |  |
| A teacher | 440 | 37 |  |
| A nurse | 480 | 40 |  |
| A Bureau clerk | 460 | 38 |  |
| A soldier of the cordon | 360 | 30 |  |
| A doctor | 1,600 | 130 |  |
| A crystal cutter at Helix | 660 | 55 |  |
| A guild analyst | 1,000 | 85 |  |
| A reclaimer (carcass crew), a day in a gate | 30 | 2.5 | when paid a wage; most crews take a quarter of the harvest |
<!-- /prices:everyday -->

Compared with the world before the gates, electricity costs less, because crystal reactors make it. Anything that
crosses open country costs more, because it travels in a guarded convoy and is insured against breaks. Few people
can afford to fly. Every household in an Amber zone keeps a packed go-bag for each person.

## 5. Housing by district

The Bureau publishes a response time for every block, which is the number of minutes before a ranked party reaches
a break there. Green means under ten minutes. Amber means under forty. Red means the Bureau promises no time. Rent
follows the response time more closely than it follows floor area. The script sets a family flat's rent by district.
One room rents for 40% of that. A flat sells for 200 months' rent.

<!-- prices:housing -->
| District | What it is | One room, a month | Family flat, a month | Family flat, to buy | Median years of wage to buy |
|---|---|---|---|---|---|
| The Crown | Green. The city centre. Response time four minutes | 380 | 960 | 190,000 | 40.0 |
| Ledger Row | Green. The guild halls and the Bureau are here | 260 | 660 | 130,000 | 27.5 |
| Saltmarket | Amber. Where most of the city lives | 96 | 240 | 48,000 | 10.0 |
| Northfield | Amber. A suburb of houses, forty minutes by tram | 82 | 200 | 41,000 | 8.5 |
| Tidewall | Amber. The port and its warehouses | 72 | 180 | 36,000 | 7.5 |
| Scarside | Red. Beside the Scar. No insurer sells break cover here | 29 | 72 | 14,000 | 3.0 |

A floor of a guild tower in Ledger Row rents for 16,000 a month. The last S-rank's estate sold in the Crown went for 12,000,000.
<!-- /prices:housing -->

<!-- prices:break-cover -->
| District | Zone | Chance a home is lost in a year | Premium, of the flat's price | Break cover a year, a family flat |
|---|---|---|---|---|
| The Crown | Green | 0.13% | 0.20% | 390 |
| Ledger Row | Green | 0.13% | 0.20% | 270 |
| Saltmarket | Amber | 0.45% | 0.67% | 320 |
| Northfield | Amber | 0.45% | 0.67% | 280 |
| Tidewall | Amber | 0.45% | 0.67% | 240 |
| Scarside | Red | 1.80% | refused | none sold |
<!-- /prices:break-cover -->

A bank requires break cover before it lends, and Paragon Mutual sells no break cover in Red. Buyers in Scarside
therefore pay the whole price in coin, and most Scarside flats are rented. A couple on two median wages buys a
Saltmarket flat on a twenty-five-year mortgage.

## 6. Medicine and potions

`items.md`, section 2, gives the rule. A consumable costs the Clear of the rank whose power it gives, times a
share for how long it lasts.

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

A Health Potion closes a hunter's wound within seconds. On a Resident it works at about a tenth of that strength,
and a second potion in the same week causes fever and then organ damage. Hospitals therefore still exist. Deaths
from blood loss have become rare, because every ambulance carries Health Potions. A runner charges 12 gold for
one, which is a labourer's day. A household keeps one or two. The weekly limit matters more than the cost.

An Elixir of Life saves a Resident from most injuries and from some cancers. Through a runner it costs 600 gold,
one and a half median months. Most families can pay that once, by borrowing. The same weekly limit applies, so a patient
who needs a second one does not get it in time.

## 7. Gear by rarity and grade

The table follows the design. A middle item of a tier costs one Clear of that tier's rank, a minus costs two
thirds of that, a plus costs one and a half times it, and the Shop buys at a quarter.

<!-- prices:gear -->
| Tier (rank) | Minus | Middle | Plus | The Shop buys at | A fence pays | Used, at a stall | A set of ten, middle | Median months for the set |
|---|---|---|---|---|---|---|---|---|
| common (E) | 67 | 100 | 150 | 25 | 40 | 70 | 1,000 | 2.5 |
| uncommon (D) | 217 | 325 | 488 | 81 | 130 | 227 | 3,250 | 8.1 |
| rare (C) | 833 | 1,250 | 1,875 | 312 | 500 | 875 | 12,500 | 31.3 |
| epic (B) | 3,333 | 5,000 | 7,500 | 1,250 | 2,000 | 3,500 | 50,000 | 125.0 |
| legendary (A) | 12,667 | 19,000 | 28,500 | 4,750 | 7,600 | 13,300 | 190,000 | 475.0 |
| mythic (S) | 50,000 | 75,000 | 112,500 | 18,750 | 30,000 | 52,500 | 750,000 | 1875.0 |
<!-- /prices:gear -->

The last column shows who can afford gear from a wage. A labourer can save for a common sword in a month. A full
legendary set costs forty years of the median wage, so no wage earner can equip an A-rank. Hunters buy gear above
rare with gate gold or on a guild's credit, and the guild keeps a lien on gear bought on credit (`careers.md`,
section 4).

## 8. Gates: the entry fee, rights, the levy, the harvest

`machines.md` charts the states of a world gate. This section prices each of them.


A gate produces two kinds of income. The System pays the hunters who clear it in gold and drops. That is the game's
Clear, and it belongs to the hunters. The gate also holds mana crystal in its walls and monster carcasses on its
floor. That is the harvest, and it belongs to whoever holds the gate's **rights**. A crew of reclaimers cuts the
harvest out after the Clear. They must finish before the day the gate would have broken, because a cleared gate
closes on that day.

There are two kinds of gate.

- **A public gate.** The Bureau holds the rights. A licensed party pays an entry fee for each hunter, equal to a tenth
  of the gate's Clear. The party keeps its gold and drops. The Bureau's own crews take the harvest. The game plays
  this way today: a Clear pays the party no harvest.
- **An auctioned gate.** The Bureau sells the rights to about half of all gates within hours of reading them. The
  holder pays the bid and sends its own hunters, who pay no entry fee. The holder pays a crew a quarter of the
  harvest and pays the state a fifth. The rest is the holder's. Winning bids average 60% of that expected net,
  because some raids fail and the holder still owes the bid.

The crystal in a gate grows as the break day approaches. A harvest cut on the last day sells for one and a half
times a harvest cut on the first day. Holders therefore profit by waiting, and the people who live near the gate
carry the risk of the wait.

<!-- prices:gates -->
| Gate | Breaks on day | Gold pot (party of 4) | One Clear | Entry fee for each hunter | Harvest | Crew's share | State levy | Holder nets | Rights at auction | Harvest if ripe (last day) |
|---|---|---|---|---|---|---|---|---|---|---|
| E | 7 | 400 | 100 | 10 | 600 | 150 | 120 | 330 | 198 | 900 |
| D | 6 | 1,300 | 325 | 33 | 1,950 | 488 | 390 | 1,073 | 644 | 2,925 |
| C | 5 | 5,000 | 1,250 | 125 | 7,500 | 1,875 | 1,500 | 4,125 | 2,475 | 11,250 |
| B | 4 | 20,000 | 5,000 | 500 | 30,000 | 7,500 | 6,000 | 16,500 | 9,900 | 45,000 |
| A | 3 | 76,000 | 19,000 | 1,900 | 114,000 | 28,500 | 22,800 | 62,700 | 37,620 | 171,000 |
| S | 2 | 300,000 | 75,000 | 7,500 | 450,000 | 112,500 | 90,000 | 247,500 | 148,500 | 675,000 |
<!-- /prices:gates -->

San Francisco has 800,000 people, 1,600 hunters and 400 world gates a month:

<!-- prices:gate-count -->
| Rank | Hunters in San Francisco | World gates a month | Seats a month (parties of 4) | Seats a hunter of the rank a month |
|---|---|---|---|---|
| E | 640 | 180 | 720 | 1.13 |
| D | 530 | 120 | 480 | 0.91 |
| C | 290 | 62 | 250 | 0.86 |
| B | 110 | 28 | 110 | 1.00 |
| A | 32 | 10 | 40 | 1.25 |
| S | 0.2 | 0.02 | 0.08 | 0.50 |
<!-- /prices:gate-count -->

If seats were shared equally, a hunter would get a seat in a gate of their own rank about once in two months.
Guilds hold most of the seats. An unsigned hunter gets between one gate a month and one in four months, and a party that gets a world gate every week draws
attention from guilds and from the Bureau.

## 9. Mana crystal and who buys it

Gold stays in circulation, but crystal is burned for power. A boss's core is worth about one Clear of its gate's
rank at assay. The rest of a harvest is wall crystal and carcass.

<!-- prices:crystal-trade -->
| Crystal of a gate | Assay value of one boss core | Helix pays | The Bureau exchange pays | A fence pays | The Shop pays | Households it powers for a month |
|---|---|---|---|---|---|---|
| E | 100 | 90 | 85 | 70 | 25 | 23 |
| D | 325 | 293 | 276 | 227 | 81 | 74 |
| C | 1,250 | 1,125 | 1,063 | 875 | 312 | 290 |
| B | 5,000 | 4,500 | 4,250 | 3,500 | 1,250 | 1,100 |
| A | 19,000 | 17,100 | 16,150 | 13,300 | 4,750 | 4,400 |
| S | 75,000 | 67,500 | 63,750 | 52,500 | 18,750 | 17,000 |
<!-- /prices:crystal-trade -->

Helix Manaworks buys nine tenths of San Francisco's crystal and burns it in the reactors that power the city. The Bureau's
exchange on Ledger Row pays a little less, pays at once, and asks for no paperwork. A fence pays less than the
exchange and asks no questions. The Shop pays a quarter, so nobody sells crystal to the Shop.

The city burns its whole harvest. Fuel is 18% of what the city pays for power, and the rest pays for the grid,
the reactors and Helix's profit. The last column of the table follows from that: it is the number of households
in San Francisco divided by the gold value of a month's harvest.

## 10. Mercenaries

A mercenary charges half a Clear of their own rank for a day, whatever the work.

<!-- prices:mercs -->
| Mercenary's rank | A day (guard, escort, standby) | A gate of their rank (fee, plus an equal share) | A gate, flat (no share, drops to the hirer) | A red gate, flat | A month's retainer | A healer, a day |
|---|---|---|---|---|---|---|
| E | 50 | 50 | 200 | 400 | 600 | 75 |
| D | 163 | 163 | 650 | 1,300 | 1,950 | 244 |
| C | 625 | 625 | 2,500 | 5,000 | 7,500 | 938 |
| B | 2,500 | 2,500 | 10,000 | 20,000 | 30,000 | 3,750 |
| A | 9,500 | 9,500 | 38,000 | 76,000 | 114,000 | 14,250 |
| S | 37,500 | 37,500 | 150,000 | 300,000 | 450,000 | 56,250 |
<!-- /prices:mercs -->

A hirer can pay in three ways.

1. By the day, for guard work, escort work, or standing by at a gate in case it breaks.
2. For a gate with a share. The hirer pays one day's fee before the gate. The mercenary then takes an equal share of
   the gold and rolls for drops with the party.
3. For a gate at a flat price of two days' fee plus one Clear. The hirer keeps every drop.

A red gate costs twice the flat price, because a party cannot leave a red gate until the boss is dead. A healer
costs one and a half times the rate in every city, and healers are usually booked weeks ahead.

## 11. Guild pay

<!-- prices:guild-pay -->
| Rank | Retainer a month (line hunter) | House share of gate gold | Signing bonus | Death benefit | Transfer fee | Pension a month (after ten years) |
|---|---|---|---|---|---|---|
| E | 150 | 25% | 200 | 2,000 | 2,000 | 75 |
| D | 488 | 25% | 650 | 6,500 | 6,500 | 244 |
| C | 1,875 | 25% | 12,500 | 25,000 | 25,000 | 938 |
| B | 7,500 | 25% | 50,000 | 100,000 | 100,000 | 3,750 |
| A | 28,500 | 25% | 190,000 | 380,000 | 380,000 | 14,250 |
| S | 112,500 | 25% | 750,000 | 1,500,000 | 1,500,000 | 56,250 |
<!-- /prices:guild-pay -->

The columns mean the following.

- **Retainer.** The guild pays one and a half Clears of the hunter's rank every month, whether or not it finds the
  hunter a gate.
- **House share.** The guild takes a quarter of the System gold from its own gates. The hunter declares the gold to
  the guild's clerk at the gate. The hunter keeps every drop, and the guild keeps the harvest.
- **Signing bonus.** From C upward the bonus is ten Clears, which is also the price of a Resurrection Crystal of
  the rank. Most guilds pay it as a pre-bought crystal held in the guild vault for when the hunter passes their debt
  revive. An E-rank or a D-rank signs for two Clears.
- **Death benefit.** The guild pays twenty Clears to a person the hunter names, and only if the hunter is not
  raised.
- **Transfer fee.** Another guild pays this to buy out the contract.

The role multiplies the retainer only:

<!-- prices:guild-roles -->
| Role | Retainer, times the line hunter's | E | D | C | B | A | S |
|---|---|---|---|---|---|---|---|
| Raid leader | 1.5 | 225 | 731 | 2,813 | 11,250 | 42,750 | 168,750 |
| Healer | 1.5 | 225 | 731 | 2,813 | 11,250 | 42,750 | 168,750 |
| Tanker | 1.2 | 180 | 585 | 2,250 | 9,000 | 34,200 | 135,000 |
| Licensed extractor (Necromancer) | 1.3 | 195 | 634 | 2,438 | 9,750 | 37,050 | 146,250 |
| Line hunter | 1 | 150 | 488 | 1,875 | 7,500 | 28,500 | 112,500 |
| Bench | 0.5 | 75 | 244 | 938 | 3,750 | 14,250 | 56,250 |
<!-- /prices:guild-roles -->

<!-- prices:guild-staff -->
| Staff | Gold |
|---|---|
| Gate porter (unawakened), for one gate: 0.3 of the gate's Clear | as described |
| Reclaimer on a share: the crew splits a quarter of the harvest | as described |
| Guild clerk, a month | 430 |
| Analyst, a month | 1,000 |
| Scout (a retired C-rank), a month | 1,200 |
| Contract lawyer, a month | 3,100 |
| Press officer, a month | 1,300 |
<!-- /prices:guild-staff -->

The next table is a guild's income and costs on one gate, with four line hunters who each get four gates a month:

<!-- prices:guild-books -->
| Gate | Harvest net | House share | Rights paid | Retainers (4 hunters, a quarter of a month) | Left for the house |
|---|---|---|---|---|---|
| E | 330 | 100 | 198 | 150 | 82 |
| D | 1,073 | 325 | 644 | 488 | 267 |
| C | 4,125 | 1,250 | 2,475 | 1,875 | 1,025 |
| B | 16,500 | 5,000 | 9,900 | 7,500 | 4,100 |
| A | 62,700 | 19,000 | 37,620 | 28,500 | 15,580 |
| S | 247,500 | 75,000 | 148,500 | 112,500 | 61,500 |
<!-- /prices:guild-books -->

A guild keeps about four fifths of a Clear from each gate. Out of that it pays for its hall, its lawyers and the
crystals in its vault. A guild earns more by taking more gates, by holding each gate longer for a larger harvest,
and by raising its dead so that it pays no death benefit.

## 12. Bribes, fines, insurance

The law sets fines in Clears, so a fine costs a hunter of any rank the same share of their income.

<!-- prices:law -->
| What | Clears | Of which rank | E | D | C | B | A | S |
|---|---|---|---|---|---|---|---|---|
| Bribe: a clerk moves your party up a gate's queue | 0.5 | the gate's | 50 | 160 | 630 | 2,500 | 9,500 | 38,000 |
| Bribe: an assessor "rounds down" a gate's rank | 4 | the gate's true | 400 | 1,300 | 5,000 | 20,000 | 76,000 | 300,000 |
| Bribe: an assessor files a reading one rank low (to avoid the call-up) | 5 | the hunter's true | 500 | 1,600 | 6,300 | 25,000 | 95,000 | 380,000 |
| A forged licence | 3 | the licence's | 300 | 980 | 3,800 | 15,000 | 57,000 | 230,000 |
| An unlicensed seat in a gate, bought from the Stair | 0.5 | the gate's | 50 | 160 | 630 | 2,500 | 9,500 | 38,000 |
| Smuggling a hunter over a border | 10 | the hunter's | 1,000 | 3,300 | 13,000 | 50,000 | 190,000 | 750,000 |
| Fine: entering a gate without licence or fee | 2 | the gate's | 200 | 650 | 2,500 | 10,000 | 38,000 | 150,000 |
| Fine: selling an unlicensed seat | 10 | the gate's | 1,000 | 3,300 | 13,000 | 50,000 | 190,000 | 750,000 |
| Fine: a gate declared late (found, not reported in a day) | 5 | the gate's | 500 | 1,600 | 6,300 | 25,000 | 95,000 | 380,000 |
| Fine: a hunter unregistered past the 72 hours | 3 | the hunter's | 300 | 980 | 3,800 | 15,000 | 57,000 | 230,000 |
| Fine: under-declared gold | 0.30000000000000004 | three times the levy dodged, on each Clear of the hunter's | 30 | 98 | 380 | 1,500 | 5,700 | 23,000 |
| Bail for a hunter | 8 | the hunter's | 800 | 2,600 | 10,000 | 40,000 | 150,000 | 600,000 |
<!-- /prices:law -->

<!-- prices:insurance -->
| Rank | Crystal cover, a year | A crystal on credit: interest a month |
|---|---|---|
| E | 53 | 30 |
| D | 172 | 98 |
| C | 660 | 375 |
| B | 2,640 | 1,500 |
| A | 10,032 | 5,700 |
| S | 39,600 | 22,500 |
<!-- /prices:insurance -->

Crystal cover is an insurance policy. Under the revive ladder (section 13), a hunter's first revive is free and the
second is on debt; from the third death on, only a pre-bought Resurrection Crystal used within an hour (or a GM
grant) raises the hunter, so veteran parties carry a crystal into the gate. The policy repays the price of one
pre-bought crystal a year used on the hunter. The premium is 5.3% of the crystal's price a year. A liner enters 48
world gates a year, and one seat in a thousand ends in a fatal down, which gives a 4.8% chance of a claim. The
insurer adds a tenth. The policy excludes a death in a personal gate, a death in a world gate entered alone, an
unlicensed gate, and a death caused by another hunter.

## 13. Resurrection Crystals and the revive ladder

the owner's revive ladder governs every hunter's deaths (`machines.md`, `Revive standing` and `A death`):

1. **First revive: free.** The System raises a dead hunter once within an hour at no gold cost (though the System
   still takes collateral; `story.md`, section 3).
2. **Second revive: one revive on debt.** On a second death, the hunter can return once within the hour on debt for
   ten Clears of their rank. No second debt revive exists.
3. **Third death and after: pre-bought crystal or GM grant only.** After the debt revive is spent, the System offers
   no return. The hunter stays dead unless the GM grants a revive or a Resurrection Crystal of the hunter's rank or
   higher, bought before the death, is used within the hour. **Gold held after death does not help**, because a dead
   hunter cannot open the Shop.

A Resurrection Crystal costs ten Clears of the rank it raises, as the design rules. The Shop sells crystals to any
hunter before death, and never buys them back.

<!-- prices:crystals -->
| Crystal | Shop price | Median months of wage | A clinic's price to raise a hunter | From the Stair, with no record | Months of a guild liner's net income | Months of a freelancer's |
|---|---|---|---|---|---|---|
| E | 1,000 | 2.5 | 1,100 | 1,500 | 2.4 | 12.7 |
| D | 3,250 | 8.1 | 3,575 | 4,875 | 2.6 | 14.3 |
| C | 12,500 | 31.3 | 13,750 | 18,750 | 2.8 | 16.1 |
| B | 50,000 | 125.0 | 55,000 | 75,000 | 2.9 | 16.5 |
| A | 190,000 | 475.0 | 209,000 | 285,000 | 2.9 | 16.8 |
| S | 750,000 | 1875.0 | 825,000 | 1,125,000 | 3.0 | 17.1 |
<!-- /prices:crystals -->

An E crystal costs two and a half median months' wages and raises a dead hunter of rank E. It must be bought before the death
and used within an hour. An unused crystal keeps for any length of time. No crystal raises an unawakened person. The
usual explanation is that the System holds a record of each hunter and holds none of anyone else. These prices and
the revive ladder have four effects on the world.

- Guilds prefer hunters who still have their free and debt revives, and carry a pre-bought crystal in the raid
  leader's pack for veterans past their second death. An unsigned party past its debt revives seldom carries a
  crystal, because an E crystal costs ten E Clears, so poor veterans die for good more often.
- A hunter who takes their one debt revive owes ten Clears. Guilds and lenders (the Ledger, the Stair) buy out that
  System debt at 2% to 5% a month in exchange for binding terms, and many hunters take years to clear it.
- Each state keeps a stock of pre-bought A and S crystals, and other states estimate its size as they estimate its
  army.
- The unawakened are 499 of every 500 people. Their dead get no free return, no debt return, and no crystal. This
  difference is the largest political grievance in every country.

## 14. Income against prices

The tables show a month of income for four ways of working, using the design's measured shares. The costs taken
from the gross are the state's tenth of System gold, one staple and a fifth of a tonic for each world gate, entry
fees for unsigned hunters, and crystal cover. No table includes personal gates, because the System opens one only
when a hunter uses a key or the GM grants one.

<!-- prices:incomes -->
**Occasional freelancer** (one world gate every four months, and a day job)

| Rank | Gross a month | Levy, consumables, entry fees, crystal cover | Net a month | Times the median wage | Months of net for a set of own-rank gear | Years of net for a Saltmarket flat |
|---|---|---|---|---|---|---|
| E | 31 | 14 | 16 | 0.0 | 61.2 | 244.6 |
| D | 93 | 47 | 46 | 0.1 | 70.3 | 86.6 |
| C | 333 | 180 | 153 | 0.4 | 81.8 | 26.2 |
| B | 1,314 | 720 | 594 | 1.5 | 84.1 | 6.7 |
| A | 4,934 | 2,736 | 2,198 | 5.5 | 86.5 | 1.8 |
| S | 19,312 | 10,800 | 8,512 | 21.3 | 88.1 | 0.5 |

**Freelancer** (one public gate a month)

| Rank | Gross a month | Levy, consumables, entry fees, crystal cover | Net a month | Times the median wage | Months of net for a set of own-rank gear | Years of net for a Saltmarket flat |
|---|---|---|---|---|---|---|
| E | 123 | 44 | 79 | 0.2 | 12.7 | 50.9 |
| D | 372 | 144 | 228 | 0.6 | 14.3 | 17.6 |
| C | 1,331 | 555 | 776 | 1.9 | 16.1 | 5.2 |
| B | 5,257 | 2,220 | 3,037 | 7.6 | 16.5 | 1.3 |
| A | 19,734 | 8,436 | 11,298 | 28.2 | 16.8 | 0.4 |
| S | 77,249 | 33,300 | 43,949 | 109.9 | 17.1 | 0.1 |

**Guild liner** (four guild gates a month (S-ranks clear A gates locally; the S row shows the rate when an S gate opens))

| Rank | Gross a month | Levy, consumables, entry fees, crystal cover | Net a month | Times the median wage | Months of net for a set of own-rank gear | Years of net for a Saltmarket flat |
|---|---|---|---|---|---|---|
| E | 542 | 124 | 418 | 1.0 | 2.4 | 9.6 |
| D | 1,651 | 404 | 1,246 | 3.1 | 2.6 | 3.2 |
| C | 5,949 | 1,555 | 4,394 | 11.0 | 2.8 | 0.9 |
| B | 23,528 | 6,220 | 17,308 | 43.3 | 2.9 | 0.2 |
| A | 88,436 | 23,636 | 64,800 | 162.0 | 2.9 | 0.1 |
| S | 346,496 | 93,300 | 253,196 | 633.0 | 3.0 | 0.0 |

**A table's party** (one own-rank gate a week, unsigned. Personal gates the GM grants are extra)

| Rank | Gross a month | Levy, consumables, entry fees, crystal cover | Net a month | Times the median wage | Months of net for a set of own-rank gear | Years of net for a Saltmarket flat |
|---|---|---|---|---|---|---|
| E | 533 | 178 | 355 | 0.9 | 2.8 | 11.3 |
| D | 1,612 | 578 | 1,034 | 2.6 | 3.1 | 3.9 |
| C | 5,768 | 2,222 | 3,546 | 8.9 | 3.5 | 1.1 |
| B | 22,780 | 8,887 | 13,894 | 34.7 | 3.6 | 0.3 |
| A | 85,514 | 33,769 | 51,745 | 129.4 | 3.7 | 0.1 |
| S | 334,746 | 133,300 | 201,446 | 503.6 | 3.7 | 0.0 |
<!-- /prices:incomes -->

The next table describes the life a signed liner can afford. A capped liner keeps this rank for life.

| Rank | Net income, times the median wage | What that buys |
|---|---|---|
| E | 1 | 1.4 times a labourer's income for four gates a month. A flat in Tidewall and common gear bought used. Many E-ranks also work a profession (`items.md`, section 4). |
| D | 3 | A flat in Saltmarket bought in a few years, and a car. |
| C | 11 | More than a surgeon earns. A flat in Ledger Row, private school for the children. A full rare set costs three months' net. |
| B | 43 | A flat in the Crown, household staff and an agent. The model transfer fee for a B-rank is 100,000 gold, so the guild pays attention to which other guilds the hunter talks to. |
| A | 160 | Three months' net buys a family flat in the Crown. Sponsorship (`fame.md`, section 5) often pays as much as hunting. The state tracks where each A-rank lives. |
| S | 630 (when S gates exist) | San Francisco gets about one S gate every four years, so an S-rank's regular clears are A gates (about 780,000 a year), topped up by San Francisco's 4 million residency payment and sponsorship. The S-liner row shows the rate per S gate when one opens. |

An unsigned hunter with one public gate a month nets 79 gold at E, which is a quarter of a labourer's month, and
776 at C, which is twice the median wage. An unsigned E-rank or D-rank needs other work.

### Is this healthy for a table's party

The fourth table is a table's party: one own-rank gate a week, unsigned, with no personal gates. Item drops shrink as
a share of a Clear from E (23%) to S (3%), so net income per session falls from 0.82 Clears at E to 0.62 Clears at S.
Every goal therefore takes about a third more sessions at S than at E:

<!-- prices:party-goals -->
| What the party member wants | Clears | E (82/sess) | D (239/sess) | C (818/sess) | B (3,206/sess) | A (11,941/sess) | S (46,487/sess) |
|---|---|---|---|---|---|---|---|
| A staple potion | 0.1 | 0.1 | 0.1 | 0.2 | 0.2 | 0.2 | 0.2 |
| An enhancement stone (one try) | 0.5 | 0.6 | 0.7 | 0.8 | 0.8 | 0.8 | 0.8 |
| A tonic or thrown item | 0.5 | 0.6 | 0.7 | 0.8 | 0.8 | 0.8 | 0.8 |
| A used middle item | 0.7 | 0.9 | 1.0 | 1.1 | 1.1 | 1.1 | 1.1 |
| A crafted middle item | 0.85 | 1.0 | 1.2 | 1.3 | 1.3 | 1.4 | 1.4 |
| A Shop middle item, or a seed | 1 | 1.2 | 1.4 | 1.5 | 1.6 | 1.6 | 1.6 |
| Party food (one hunter's quarter share) | 0.25 | 0.3 | 0.3 | 0.4 | 0.4 | 0.4 | 0.4 |
| A crafted plus item | 1.275 | 1.6 | 1.7 | 1.9 | 2.0 | 2.0 | 2.1 |
| An escape stone (one hunter's quarter share) | 0.5 | 0.6 | 0.7 | 0.8 | 0.8 | 0.8 | 0.8 |
| A Resurrection Crystal (party of 4 pooling one) | 2.5 | 3.0 | 3.4 | 3.8 | 3.9 | 4.0 | 4.0 |
| A full set of ten middle items | 10 | 12.2 | 13.6 | 15.3 | 15.6 | 15.9 | 16.1 |
| A skill book (solo) | 10 | 12.2 | 13.6 | 15.3 | 15.6 | 15.9 | 16.1 |
| A Resurrection Crystal (solo) | 10 | 12.2 | 13.6 | 15.3 | 15.6 | 15.9 | 16.1 |
<!-- /prices:party-goals -->

Three practical lessons follow for a GM:

- **Every session buys progress.** One to two sessions buys a used, crafted, or Shop item, a seed, or an enhancement
  attempt. Split four ways, party food costs under half a session and an escape stone under one.
- **Pool crystals as a party.** Buying a Resurrection Crystal alone takes 12 to 16 sessions, and by B and A rank an
  uncapped party levels up in about 11 and 7 sessions (`power.md`, section 4), outrunning a solo crystal before it is
  paid for. Pooling four ways puts one shared pre-bought crystal in reach in 3 to 4 sessions at every rank.
- **Solo 10-Clear skill books at B and A need extra income.** Because an uncapped party spends fewer than 12 sessions
  in B and A rank, solo B and A skill books are bought with sponsor tips, scenario payouts, or guild retainers, or
  saved into S rank.

A personal gate that the GM grants pays about a quarter of a gate, so one a session raises income by a quarter.

## 15. Where the world disagrees with the game (for the lead)

The game's numbers are the owner's to change. Each row is a place where the world needed something the game's numbers
do not give, or where the numbers have a result that the world had to explain.

| # | The game today, or the ruled design | What the world needs or implies | A way to close it |
|---|---|---|---|
| 1 | Ruled since: a gate's XP is split as its gold is | The world no longer needs a trade in seats for XP. The Stair now sells unlicensed seats for gold | Closed by the owner's ruling |
| 2 | `RULES.solo`: the System opens a personal gate for each hunter every eight hours | the owner, Nov 20: "I should administer the personal gates myself, or through keys." The world has no timed personal gates. A key drops from about one Clear in 200 | Turn timed spawns off by default (`solo.personal`), keep the GM's grant, and add the key as an item |
| 3 | Levelling is fast. E to S takes 95 own-rank gates in a party of four, or 69 table sessions | the owner's ruling: every hunter levels up to the cap of their rank, and a trial gate removes the cap. The game has no cap and no trial gate | A level cap by rank that a GM can lift for a hunter, if the owner wants the app to hold NPC hunters or new characters to it |
| 4 | The daily gives 1 stat point and 25 XP a day, and does not heal or restore a hunter | A year of dailies gives 365 points (70 levels give 219). The owner also ruled: "Dailies should not recover you." | Keep dailies free of HP, mana, or fatigue recovery; the owner suggests raising stat points from levels (the lead decides) |
| 5 | Ruled since: revive ladder (first revive free, second on debt, third+ only GM grant or pre-bought crystal within an hour; gold held after death does not help); crystal never expires | The bible uses the revive ladder and the one-hour limit. A dead hunter cannot buy a crystal from the Shop; veteran parties carry one | Track revive standing (free / debt / crystal-only) in core; keep the one-hour rule with the GM |
| 6 | `usedUpShare`: every consumable costs half an item of its tier. The game has no consumable above epic and none at rare | the owner, Nov 20: the half rule is wrong. `items.md` prices a consumable by the rank of its power and how long it lasts: a staple a tenth of a Clear, a tonic half, food one, an escape stone two, a skill book ten, a seed one. Health Potion 10, Greater Health Potion 33, Elixir of Life 500 | Replace `usedUpShare` with a share by duration. Add staples at every tier |
| 7 | Mana Crystal Shard ships at 40 and sells for 20. The design prices it at 100, selling for 25 | In the world a hunter sells crystal for 85 to 90% of its assay value. A quarter suits used gear and does not suit a raw material | Add a `materialShare` of 0.85 beside `saleShare`, for items of type material |
| 8 | A gate pays gold and two item picks. Its crystal and carcasses pay nobody | The world's guilds earn most of their margin from the harvest, which is 1.5 times the gold pot. A rights holder nets 55% of it | No rule change. A GM who lets a party buy a gate's rights (section 8) can pay the holder's net as a quest reward |
| 9 | The game has no fee, tax or upkeep | The world has an entry fee of 10% of a Clear, a levy of 10% of System gold and a house share of 25% | Optional rule numbers that a GM can turn on, off by default |
| 10 | `gateSpawn.rank.S` is 1 in 100 | In the world 1 gate in 20,000 is an S gate, so San Francisco gets about one S gate every four years (0.24 a year at 400 gates a month) | No change. A table rolls for the gates worth a session |
| 11 | Shipped prices: `baseValue` 10 times a literal 10, rarity factors 1 to 200, a sale at half, a crystal at a flat 100,000 | The bible uses the ruled design: one Clear for a tier's middle item, a sale at a quarter, a crystal at ten Clears. Until the design's unit 1 ships, the app's prices above common are lower than the bible's | Ships with the economy units |
| 12 | Some built-in item, title and job names come from Solo Leveling | the owner's ruling: the names stay, and the setting is Solo Leveling's world | Closed by the owner's ruling |
| 13 | A world gate cleared alone pays four Clears | The world agrees. Guild contracts forbid it and insurers exclude it | No change |
| 14 | Ruled since: a raising costs 3.33% of the hunter's level, rounded up (design ruling 9) | The story uses it beside the System's collateral (`story.md`, section 3) | Closed by the owner's ruling |
| 15 | The game has no crafting, professions, materials beyond one shard, enhancement, seeds, skill books, food, thrown items, escape stones or gate keys | the owner said yes to all of them on Nov 20, and no to scrolls and to charms that prevent a death. `items.md` gives the types, prices, five professions with a skill tree each, and the crafting rules | New item types and a crafting system. `items.md` section 7 lists the open proposals |
| 16 | Automatic System messages and rewards | the owner's ruling: every System message and every reward must be editable and approved by the GM before players see it | Route every System text and reward (including sponsor tips and scenarios) through a GM edit-and-approve queue |
