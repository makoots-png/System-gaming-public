# The economy

Every table between `<!-- prices:... -->` marks is printed by `bun docs/world/prices.ts --write`. The script reads the
shipped `RULES` (the loot gold, the break days, the XP) and the economy design's ruled numbers (a sale at a quarter,
grades at 1.5, a crystal at ten Clears, shared gate gold), and holds the world's own assumptions in one object,
`WORLD`, each with its reason. Change the anchor there, rerun, and every price moves with it. The prose says why.

Prices are in gold. Small change is the bit: 100 bits to a gold, struck by states in nickel because the System mints
nothing smaller than a coin.

## 1. The anchor: what one gold is

The game's anchor is one Clear: what one hunter of a party of four takes from a world gate of a rank. An E Clear is
100 gold. The world needs one more fact to tie that to a life, and it is this:

**An unskilled labourer's day is 0.3 of an E Clear: 30 gold. So one gold is a plain hot meal from a street stall.**

Why 0.3. An E-rank is the weakest person who can walk into a gate and the easiest to replace. If a Clear paid a
month's wage, every E-rank would be rich and no guild could make them queue. If it paid a day's wage, nobody would
risk a gate. At three labourer-days for one afternoon that may kill you, an E-rank who gets one gate a month earns
less than the dockhand next door, and one who gets three and opens doors most days earns about what a teacher does.
That is the life the lore gives an E-rank: armed, licensed, and poor. Everything else follows from the game's own
ladder, which multiplies a Clear by about 3.5 a rank.

<!-- prices:anchor -->
| What | Gold | How it is derived |
|---|---|---|
| One E-rank Clear | 100 | the middle of `RULES.loot.E.gold`: the game's number |
| An unskilled labourer's day | 30 | 0.3 of an E Clear |
| A plain street meal | 1 | a labourer's day buys 30 |
| An unskilled month | 750 | 25 working days |
| The median month's wage | 1,000 | four thirds of the unskilled month |
| The median year | 12,000 | twelve months |
<!-- /prices:anchor -->

A feel for it, for a GM pricing on the fly: **1 gold a meal, 30 a labourer's day, 1,000 the median month, 100 an
E Clear, 120,000 an ordinary family flat.** A reader who wants a real-world handle can read a gold as four or five
US dollars of the 2020s.

## 2. Where gold comes from: the System is the central bank

Gold is not a metaphor. When a gate is cleared the System puts gold in each hunter's Inventory, and a hunter can draw
it out as coin: 8 grams, cool to the touch, every one the same, and every hunter's window names a false one at a
glance. Nobody else can mint it, so nobody can inflate it. By Year 8 every state had pegged or abandoned its own
money; the Ledger Act of Year 17 made gold the unit of account in Carrow's country, and national notes survive as
receipts for it.

That makes the world's money supply exactly a game economy's, and the people in it know it:

| | What it is in the world | What it is in the game |
|---|---|---|
| Faucets | Clears of world gates; personal doors; nothing else | `loot[rank].gold`, shared; a personal gate's quarter |
| Sinks | The Shop (every potion drunk, every item bought, every crystal used is gold gone from the world); the Shop's quarter buy-back; the System's fee to reshape a build | the shop, the three-quarter spread, used consumables, respecs |
| Transfers (no gold made or lost) | wages, rent, tax, the levy, guild shares, bribes, trades | trades between hunters |

Two consequences a GM can use. First, **hunters are the mint**: an unawakened economy of billions runs on coin that
only a few million people can bring into the world, which is the root of both the awe and the resentment. Second,
**the Shop is the only drain**: finance ministries watch potion sales the way they once watched interest rates, and a
year in which hunters hoard gold instead of spending it at the Shop is a year of rising prices for bread.

## 3. The Shop's band: a ceiling and a quarter floor

The Shop sells to any hunter, at one price, without limit, and buys anything back at a quarter. So:

- Nothing the Shop stocks can sell above the Shop's price for long. It is a ceiling.
- Nothing can sell below a quarter of it. It is a floor.
- Everything hunters trade among themselves lives in between, and that gap is where every fence, stallholder,
  runner and pawnbroker in the world makes a living. A fence pays 40%, a used stall sells at 70%, and only the
  desperate sell to the Shop.
- The unawakened cannot open the Shop. They buy through **runners**, licensed E-ranks who buy to order at a 20%
  markup. A hospital's potion budget is a runner's whole career.
- What the Shop never stocks (a named drop, a graded plus of a high tier, anything a maker made) has no ceiling.
  Those go to auction at Ledger Row, and that is where prices stop making sense.

## 4. Everyday prices

Each is a count of labourer-days in the script, so it scales with the anchor.

<!-- prices:everyday -->
**Food and drink**

| Thing | Gold | Labourer-days | Note |
|---|---|---|---|
| A plain street meal (noodles, a filled bread) | 1 | 0.03 | the anchor |
| Tea or coffee | 0.5 | 0.02 |  |
| A loaf of bread | 0.4 | 0.01 |  |
| A beer in a bar | 1.2 | 0.04 |  |
| A week of groceries, one adult | 23 | 0.75 | a quarter of an unskilled week |
| Dinner for two, a Saltmarket restaurant | 15 | 0.50 |  |
| Dinner for two in the Crown | 90 | 3 |  |
| A plate of gate meat (D-rank boar, licensed) | 18 | 0.60 | the carcass trade: a luxury that is also a trophy |

**Home**

| Thing | Gold | Labourer-days | Note |
|---|---|---|---|
| Stone-grid power, a household, a month | 30 | 1 |  |
| Water and waste, a month | 11 | 0.35 |  |
| A phone plan with Doorwatch alerts, a month | 9 | 0.30 |  |
| A phone | 360 | 12 |  |
| Work boots | 30 | 1 |  |
| A good suit or dress | 150 | 5 |  |
| A go-bag, packed to Bureau list | 60 | 2 | every household in an Amber zone keeps one a person |

**Getting around**

| Thing | Gold | Labourer-days | Note |
|---|---|---|---|
| A tram or bus ride | 0.3 | 0.01 |  |
| A month's pass | 15 | 0.50 |  |
| A taxi across town | 6 | 0.20 |  |
| Rail to the next city, armoured line | 30 | 1 | rail runs convoyed between cities |
| A flight inside the country | 120 | 4 |  |
| A flight abroad | 600 | 20 | few routes, each escorted |
| A bicycle | 60 | 2 |  |
| A used car | 2,400 | 80 |  |
| A new car, stone cell | 9,000 | 300 | about ten median months |
| A hired escort car with a D-rank guard, a day | 240 | 8 |  |

**Health (the unawakened)**

| Thing | Gold | Labourer-days | Note |
|---|---|---|---|
| A clinic visit | 12 | 0.40 |  |
| A night in a trauma ward | 90 | 3 |  |
| A birth, with a week's care | 300 | 10 |  |
| A year of health cover, one adult | 600 | 20 |  |
| A funeral | 540 | 18 |  |

**School and services**

| Thing | Gold | Labourer-days | Note |
|---|---|---|---|
| A year at a private school | 3,000 | 100 |  |
| A year at university | 3,900 | 130 |  |
| A year at a hunter academy (unsponsored) | 9,000 | 300 | nine median months: most are sponsored by a guild |
| A lawyer, an hour | 39 | 1.3 |  |
| A contract lawyer who reads guild paper, an hour | 120 | 4 |  |
| A wedding, Saltmarket | 3,900 | 130 |  |

**Wages (a month unless said)**

| Thing | Gold | Labourer-days | Note |
|---|---|---|---|
| An unskilled labourer, a day | 30 | 1 | the anchor |
| The median wage | 1,000 | 33 |  |
| A teacher | 1,100 | 37 |  |
| A nurse | 1,200 | 40 |  |
| A Bureau clerk | 1,100 | 38 |  |
| A soldier of the cordon | 900 | 30 |  |
| A doctor | 3,900 | 130 |  |
| A crystal cutter at Helix | 1,700 | 55 |  |
| A guild analyst | 2,600 | 85 |  |
| A reclaimer (carcass crew), a day in a gate | 75 | 2.5 | hazard pay when on a wage, not a lay |
<!-- /prices:everyday -->

What changed against the world we know: power is cheap (crystal reactors), anything that crosses open country is
dear (convoys, escorts, insurance), air travel is a luxury again, and a go-bag is a household item like a kettle.

## 5. Housing by district

Safety is what land is priced on. The Bureau publishes a response time for every block: the minutes until a ranked
party stands at a break there. Green is under ten minutes, Amber under forty, Red is "best effort". A family flat's
rent is set in the script by district; a room is 40% of it; a price is 200 months' rent.

<!-- prices:housing -->
| District | What it is | One room, a month | Family flat, a month | Family flat, to buy | Median years of wage to buy |
|---|---|---|---|---|---|
| The Crown | Green core, under the Ninth Hour's tower: a response in four minutes | 960 | 2,400 | 480,000 | 40.0 |
| Ledger Row | Green, the guild quarter: more hunters a street than anywhere | 660 | 1,700 | 330,000 | 27.5 |
| Saltmarket | Amber ring: the ordinary city | 240 | 600 | 120,000 | 10.0 |
| Northfield | Amber suburb: houses, a long tram, a cordon post | 200 | 510 | 100,000 | 8.5 |
| Tidewall | Amber port: loud, working, half its sirens tested monthly | 180 | 450 | 90,000 | 7.5 |
| Scarside | Red fringe along the Scar: uninsurable, never empty | 72 | 180 | 36,000 | 3.0 |

Above the table: a guild tower floor in Ledger Row rents for 39,000 a month; an S-rank's estate in the Crown last sold for 30,000,000.
<!-- /prices:housing -->

<!-- prices:break-cover -->
| District | Rate a year, of the flat's price | Break cover a year, a family flat |
|---|---|---|
| The Crown | 0.4% | 1,900 |
| Ledger Row | 0.4% | 1,300 |
| Saltmarket | 1.5% | 1,800 |
| Northfield | 1.5% | 1,500 |
| Tidewall | 2.0% | 1,800 |
| Scarside | refused | none sold |
<!-- /prices:break-cover -->

A mortgage needs break cover, and Paragon Mutual sells none in Red. So Scarside is bought in coin, by people who have
some and cannot say where from, and rented by people with nowhere else. An ordinary couple on two median wages buys
in Saltmarket over twenty-five years, as their parents did, and drills the children on the stairs.

## 6. Medicine and potions

A consumable costs half an item of its tier (the design's `usedUpShare`): one Clear buys two potions of its rank.

<!-- prices:potions -->
| Tier (rank) | Built-in | Shop price | Sells to the Shop | A runner's price to the unawakened | Labourer-days |
|---|---|---|---|---|---|
| common (E) | Health Potion, Mana Potion, Stamina Tonic | 50 | 12 | 60 | 1.7 |
| uncommon (D) | Greater Health Potion | 163 | 40 | 200 | 5.4 |
| rare (C) | (none built in) | 625 | 156 | 750 | 21 |
| epic (B) | Elixir of Life | 2,500 | 625 | 3,000 | 83 |
| legendary (A) | (none built in) | 9,500 | 2,375 | 11,000 | 320 |
| mythic (S) | (none built in) | 37,500 | 9,375 | 45,000 | 1,300 |
<!-- /prices:potions -->

A Health Potion closes a hunter's wound in a breath. On a body with no mana it works **thin**: about a tenth as
well, and more than one a week brings potion sickness (fever, then organ strain). So potions did not end hospitals.
They ended deaths from bleeding: every ambulance carries two, at 60 gold each through a runner, two days of a
labourer's wage, and the fight over who pays for them is the whole of health politics. An Elixir of Life, thin, will
pull an unawakened patient back from most traumas and a few cancers. At 3,000 gold through a runner it is three
median months, which is to say: within reach of a family that sells the car, and the reason families sell the car.

The game stocks no consumable above epic and none at rare. The world prices the missing tiers by the same rule (the
table), and a GM who makes an A-rank potion can price it from the row.

## 7. Gear by rarity and grade

The design's ladder: a middle item of a tier costs one Clear of that tier's rank; a minus is two thirds, a plus one
and a half; the Shop buys at a quarter.

<!-- prices:gear -->
| Tier (rank) | Minus | Middle | Plus | The Shop buys at | A fence pays | Used, at a stall | A set of ten, middle | Median months for the set |
|---|---|---|---|---|---|---|---|---|
| common (E) | 67 | 100 | 150 | 25 | 40 | 70 | 1,000 | 1.0 |
| uncommon (D) | 217 | 325 | 488 | 81 | 130 | 227 | 3,250 | 3.3 |
| rare (C) | 833 | 1,250 | 1,875 | 312 | 500 | 875 | 12,500 | 12.5 |
| epic (B) | 3,333 | 5,000 | 7,500 | 1,250 | 2,000 | 3,500 | 50,000 | 50.0 |
| legendary (A) | 12,667 | 19,000 | 28,500 | 4,750 | 7,600 | 13,300 | 190,000 | 190.0 |
| mythic (S) | 50,000 | 75,000 | 112,500 | 18,750 | 30,000 | 52,500 | 750,000 | 750.0 |
<!-- /prices:gear -->

Read the last column as the wall between the classes. A labourer could save for a common sword. No wage earner alive
could kit an A-rank: the set is sixteen years of the median wage. Gear above rare is bought with gate gold or with a
guild's credit, and a guild's credit comes with a lien (see `careers.md`).

## 8. Gates: the door fee, rights, the levy, the harvest

A gate pays twice. The System pays the hunters who clear it in gold and drops: that is the game's Clear, and it is
the hunters' own. The gate's body pays whoever holds its **rights**: the mana crystal in its walls and the carcasses
on its floor, cut out by a crew of reclaimers between the Clear and the day the gate would have broken, when a
cleared gate closes for good (the Ebb).

- **A public gate.** The Bureau holds the rights. A licensed party pays a door fee a head (a tenth of the gate's
  Clear), keeps its gold and drops, and walks away. The Bureau's own crews take the harvest. This is the game as it
  plays today: no harvest is paid to the party, and none should be.
- **A gate at auction.** The Bureau sells the rights of about half of all gates within hours of the Reading. The
  holder pays the bid, sends its own hunters (no door fee), hires a crew for a quarter lay, pays the state a fifth of
  the harvest, and keeps the rest. Bids settle near 60% of the expected net, because some raids fail.
- **Ripening.** The crystal in a gate thickens as its break day nears: a harvest on the last day is worth half again
  what it is on the first. Every holder is paid to wait. Every neighbour is paid to hope they do not.

<!-- prices:gates -->
| Gate | Breaks on day | Gold pot (party of 4) | One Clear | Door fee a head | Harvest | Crew's quarter | State levy | Holder nets | Rights at auction | Harvest if ripe (last day) |
|---|---|---|---|---|---|---|---|---|---|---|
| E | 7 | 400 | 100 | 10 | 600 | 150 | 120 | 330 | 200 | 900 |
| D | 6 | 1,300 | 325 | 33 | 1,950 | 488 | 390 | 1,073 | 640 | 2,925 |
| C | 5 | 5,000 | 1,250 | 130 | 7,500 | 1,875 | 1,500 | 4,125 | 2,500 | 11,250 |
| B | 4 | 20,000 | 5,000 | 500 | 30,000 | 7,500 | 6,000 | 16,500 | 9,900 | 45,000 |
| A | 3 | 76,000 | 19,000 | 1,900 | 114,000 | 28,500 | 22,800 | 62,700 | 38,000 | 171,000 |
| S | 2 | 300,000 | 75,000 | 7,500 | 450,000 | 112,500 | 90,000 | 247,500 | 150,000 | 675,000 |
<!-- /prices:gates -->

The supply, in Carrow (6 million people, 12,000 hunters, 600 world gates a month):

<!-- prices:gate-count -->
| Rank | Hunters in Carrow | World gates a month | Seats a month (parties of 4) | Seats a hunter of the rank a month |
|---|---|---|---|---|
| E | 4,800 | 270 | 1,100 | 0.23 |
| D | 4,000 | 180 | 720 | 0.18 |
| C | 2,200 | 93 | 370 | 0.17 |
| B | 840 | 42 | 170 | 0.20 |
| A | 240 | 15 | 60 | 0.25 |
| S | 1.2 | 0.03 | 0.12 | 0.10 |
<!-- /prices:gate-count -->

A seat in a world gate of your own rank comes round about once in five months if seats were shared evenly. They are
not. Guilds hold most of them, and that single fact is why guilds exist, why an unsigned hunter lives on personal
doors, and why a party that somehow gets a gate a week is the talk of the district.

## 9. Mana crystal and who buys it

Crystal is the other thing gates make, and unlike gold it is burned. A boss's core assays at about one Clear of its
gate's rank; the rest of a harvest is wall crystal and carcass.

<!-- prices:crystal-trade -->
| Crystal of a gate | Assay value of one boss core | Helix pays | The Bureau exchange pays | A fence pays | The Shop pays | Households it powers for a month |
|---|---|---|---|---|---|---|
| E | 100 | 90 | 85 | 70 | 25 | 5 |
| D | 325 | 293 | 276 | 227 | 81 | 16 |
| C | 1,250 | 1,125 | 1,063 | 875 | 312 | 63 |
| B | 5,000 | 4,500 | 4,250 | 3,500 | 1,250 | 250 |
| A | 19,000 | 17,100 | 16,150 | 13,300 | 4,750 | 950 |
| S | 75,000 | 67,500 | 63,750 | 52,500 | 18,750 | 3,800 |
<!-- /prices:crystal-trade -->

Helix Manaworks buys nine tenths of the city's crystal and burns it in the reactors that light the city. The Bureau's
exchange on Ledger Row pays a little less, at once, with no forms. A fence pays less again and asks nothing. The Shop
pays a quarter, which is how everyone learned that the System does not want crystal back.

## 10. Mercenaries

A mercenary's day is half a Clear of their own rank, whatever the work.

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

Three ways to hire: by the day (a guard, an escort, standing by at a gate's mouth in case it breaks); for a gate with
a share (the fee up front, then an equal share of the gold, and they roll for drops with the party); or flat (two
days' fee and a Clear, and every drop is the hirer's). A red gate doubles the flat price, because a red gate cannot
be left until it is cleared. A healer costs half again, in every city on Earth, and is booked.

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

How to read it. A guild pays a **retainer** every month whether or not it finds the hunter a gate (one and a half
Clears of the hunter's rank). It takes a **house share** of the System gold from its own gates (a quarter: the
hunter declares the Clear, the guild's clerk is in the room). The hunter keeps every drop. The guild keeps the
harvest. A **signing bonus** is ten Clears from C up, which is exactly the price of a Resurrection Crystal of the
rank, and is usually paid as one, held by the guild. E and D sign for two Clears and a locker. The **death benefit**
is twenty Clears to a named person, paid only when the hunter stays dead. A **transfer fee** is what one guild pays
another to buy out a contract.

By role (the multiple is on the retainer only):

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
| Gate porter (unawakened), a gate: 0.3 of the gate's Clear | see the line |
| Reclaimer on a lay: the crew splits a quarter of the harvest | see the line |
| Guild clerk, a month | 1,100 |
| Analyst, a month | 2,600 |
| Scout (a retired C-rank), a month | 4,500 |
| Contract lawyer, a month | 7,800 |
| Press officer, a month | 3,300 |
<!-- /prices:guild-staff -->

A guild's books on one gate, four line hunters, a three-gate month:

<!-- prices:guild-books -->
| Gate | Harvest net | House share | Rights paid | Retainers (4 hunters, a third of a month) | Left for the house |
|---|---|---|---|---|---|
| E | 330 | 100 | 198 | 200 | 32 |
| D | 1,073 | 325 | 644 | 650 | 104 |
| C | 4,125 | 1,250 | 2,475 | 2,500 | 400 |
| B | 16,500 | 5,000 | 9,900 | 10,000 | 1,600 |
| A | 62,700 | 19,000 | 37,620 | 38,000 | 6,080 |
| S | 247,500 | 75,000 | 148,500 | 150,000 | 24,000 |
<!-- /prices:guild-books -->

The margin is thin: about a third of a Clear a gate, before the tower, the lawyers and the crystals in the vault. A
guild lives on volume, on ripe harvests, and on never paying a death benefit. All three push it the same way: more
gates, held longer, with the crystal cover kept current.

## 12. Bribes, fines, insurance

Law prices everything in Clears, so a fine hurts the same at every rank.

<!-- prices:law -->
| What | Clears | Of which rank | E | D | C | B | A | S |
|---|---|---|---|---|---|---|---|---|
| Bribe: a clerk moves your party up a gate's queue | 0.5 | the gate's | 50 | 160 | 630 | 2,500 | 9,500 | 38,000 |
| Bribe: an assessor "rounds down" a gate's rank | 4 | the gate's true | 400 | 1,300 | 5,000 | 20,000 | 76,000 | 300,000 |
| Bribe: a Reading is filed a rank low (to dodge the Corps) | 5 | the hunter's | 500 | 1,600 | 6,300 | 25,000 | 95,000 | 380,000 |
| A forged licence | 3 | the licence's | 300 | 980 | 3,800 | 15,000 | 57,000 | 230,000 |
| A black-market seat in a gate (XP only, no gold, no drops) | 2 | the gate's | 200 | 650 | 2,500 | 10,000 | 38,000 | 150,000 |
| Smuggling a hunter over a border | 10 | the hunter's | 1,000 | 3,300 | 13,000 | 50,000 | 190,000 | 750,000 |
| Fine: entering a gate without licence or fee | 2 | the gate's | 200 | 650 | 2,500 | 10,000 | 38,000 | 150,000 |
| Fine: selling a seat | 10 | the gate's | 1,000 | 3,300 | 13,000 | 50,000 | 190,000 | 750,000 |
| Fine: a gate declared late (found, not reported in a day) | 5 | the gate's | 500 | 1,600 | 6,300 | 25,000 | 95,000 | 380,000 |
| Fine: a hunter unregistered past the 72 hours | 3 | the hunter's | 300 | 980 | 3,800 | 15,000 | 57,000 | 230,000 |
| Fine: under-declared gold | 0.3 | three times the levy dodged, on each Clear of the hunter's | 30 | 98 | 380 | 1,500 | 5,700 | 23,000 |
| Bail for a hunter | 8 | the hunter's | 800 | 2,600 | 10,000 | 40,000 | 150,000 | 600,000 |
<!-- /prices:law -->

<!-- prices:insurance -->
| Rank | Crystal cover, a year | With the door rider | A crystal on credit: interest a month |
|---|---|---|---|
| E | 50 | 150 | 30 |
| D | 163 | 488 | 98 |
| C | 625 | 1,875 | 375 |
| B | 2,500 | 7,500 | 1,500 |
| A | 9,500 | 28,500 | 5,700 |
| S | 37,500 | 112,500 | 22,500 |
<!-- /prices:insurance -->

Crystal cover is a policy that buys and delivers a crystal of your rank if you die inside the three dawns (see
`power.md`): a twentieth of the crystal's price a year. It does not cover a personal door, because nobody can carry
your body out of one. The **door rider** triples the premium and pays for the crystal you carried in yourself.

## 13. Resurrection Crystals

Ten Clears of the rank it raises (the design's ruling). The Shop sells them to any hunter.

<!-- prices:crystals -->
| Crystal | Shop price | Median months of wage | A clinic's raising (crystal and rite) | On the Stair, no questions | Months of a guild liner's net income | Months of a freelancer's |
|---|---|---|---|---|---|---|
| E | 1,000 | 1.0 | 1,100 | 1,500 | 1.3 | 2.0 |
| D | 3,250 | 3.3 | 3,575 | 4,875 | 1.6 | 2.5 |
| C | 12,500 | 12.5 | 13,750 | 18,750 | 1.8 | 2.7 |
| B | 50,000 | 50.0 | 55,000 | 75,000 | 1.9 | 2.9 |
| A | 190,000 | 190.0 | 209,000 | 285,000 | 2.4 | 4.4 |
| S | 750,000 | 750.0 | 825,000 | 1,125,000 | 3.7 | 12.6 |
<!-- /prices:crystals -->

This table is the most important one in the world. An E crystal costs one median month. It raises any dead hunter of
rank E. It raises no unawakened person at any price: the System keeps no record of them to restore. So:

- A hunter with cover does not die of an ordinary death in a gate. A hunter without it does. Among hunters, death is
  a bill, and the poor cannot pay it.
- A guild that raises you owns the debt. Ten Clears at three percent a month is the commonest chain in the trade.
- A state's vault of A and S crystals is a strategic reserve, counted by its rivals.
- The unawakened, who are 499 in every 500 people, bury their dead and watch hunters come back. Every politics in
  the world is downstream of that.

## 14. Income against prices: the life each rank lives

Four ways of working, a month of each, from the design's measured shares. Out of the gross come the state's tenth of
System gold, one potion of the rank a world gate, door fees for the unsigned, and crystal cover.

<!-- prices:incomes -->
**Door-shy freelancer** (a world gate a season, a door a week, a day job)

| Rank | Gross a month | Levy, potions, fees, cover | Net a month | Times the median wage | Months of net for a set of own-rank gear | Years of net for a Saltmarket flat |
|---|---|---|---|---|---|---|
| E | 135 | 29 | 106 | 0.1 | 9.5 | 94.6 |
| D | 366 | 93 | 273 | 0.3 | 11.9 | 36.6 |
| C | 1,299 | 357 | 942 | 0.9 | 13.3 | 10.6 |
| B | 4,959 | 1,417 | 3,542 | 3.5 | 14.1 | 2.8 |
| A | 13,999 | 4,956 | 9,042 | 9.0 | 21.0 | 1.1 |
| S | 30,397 | 17,279 | 13,118 | 13.1 | 57.2 | 0.8 |

**Freelancer** (a public gate every other month, a door most days)

| Rank | Gross a month | Levy, potions, fees, cover | Net a month | Times the median wage | Months of net for a set of own-rank gear | Years of net for a Saltmarket flat |
|---|---|---|---|---|---|---|
| E | 582 | 76 | 506 | 0.5 | 2.0 | 19.8 |
| D | 1,551 | 238 | 1,313 | 1.3 | 2.5 | 7.6 |
| C | 5,497 | 919 | 4,579 | 4.6 | 2.7 | 2.2 |
| B | 20,850 | 3,627 | 17,223 | 17.2 | 2.9 | 0.6 |
| A | 55,194 | 11,641 | 43,553 | 43.6 | 4.4 | 0.2 |
| S | 94,048 | 34,521 | 59,527 | 59.5 | 12.6 | 0.2 |

**Guild liner** (three guild gates a month, a door most days)

| Rank | Gross a month | Levy, potions, fees, cover | Net a month | Times the median wage | Months of net for a set of own-rank gear | Years of net for a Saltmarket flat |
|---|---|---|---|---|---|---|
| E | 964 | 221 | 743 | 0.7 | 1.3 | 13.5 |
| D | 2,725 | 709 | 2,016 | 2.0 | 1.6 | 5.0 |
| C | 9,762 | 2,731 | 7,031 | 7.0 | 1.8 | 1.4 |
| B | 37,743 | 10,877 | 26,866 | 26.9 | 1.9 | 0.4 |
| A | 118,779 | 39,191 | 79,588 | 79.6 | 2.4 | 0.1 |
| S | 343,420 | 143,271 | 200,149 | 200.1 | 3.7 | 0.0 |

**Climber (a table's party)** (a gate a week at rank, three doors: the design's table player)

| Rank | Gross a month | Levy, potions, fees, cover | Net a month | Times the median wage | Months of net for a set of own-rank gear | Years of net for a Saltmarket flat |
|---|---|---|---|---|---|---|
| E | 845 | 329 | 515 | 0.5 | 1.9 | 19.4 |
| D | 2,430 | 1,065 | 1,365 | 1.4 | 2.4 | 7.3 |
| C | 8,662 | 4,098 | 4,564 | 4.6 | 2.7 | 2.2 |
| B | 33,696 | 16,364 | 17,331 | 17.3 | 2.9 | 0.6 |
| A | 112,644 | 60,900 | 51,744 | 51.7 | 3.7 | 0.2 |
| S | 367,742 | 233,538 | 134,205 | 134.2 | 5.6 | 0.1 |
<!-- /prices:incomes -->

What the numbers say, rank by rank, for a signed liner:

| Rank | Net against the median wage | The life |
|---|---|---|
| E | 0.7 | A room in Tidewall or a shared flat in Saltmarket. A second job, or a partner with one. Common gear bought used. Crystal cover is 50 gold a year and a third of E-ranks let it lapse. |
| D | 2 | A flat in Saltmarket on a ten-year mortgage. A car. The first rank where hunting is a living and not a hope. |
| C | 7 | A surgeon's income. A flat in Ledger Row, parents moved out of Amber, children in a private school. Rare gear costs under two months' net. Recognised in the street in their own district. |
| B | 27 | Rich. The Crown, staff, an agent. A full epic set in two months. A transfer fee of 100,000 on their head, so their guild watches who they dine with. |
| A | 80 | Half a year's net buys a family flat in the Crown. Known nationally. Sponsorship (see `fame.md`) can match the hunting income. The state knows where they sleep. |
| S | 200 and up | Not an income, a balance sheet: 2.4 million a year from the work alone, more from the name. Paid by a city to live in it. An S crystal is under four months of it. |

And for the unsigned, the same ladder two rungs down: a freelancer at C lives like a liner at D. A door-shy E-rank
earns 106 gold a month from the System and is, in every way that matters, a labourer with a licence. The climber's
row is the table's party: it grosses nearly what a liner does and keeps far less, because a gate a week at rank
drinks a potion a week. Climbing is expensive. It is also the only row that changes rank within the year.

## 15. Where the world disagrees with the game (for the lead)

The game's numbers are the owner's to change. This is where the world, built to make sense around them, strains.

| # | The game today, or the ruled design | What the world needs or implies | A way to close it |
|---|---|---|---|
| 1 | `xpSplit` false: each hunter in a gate takes the whole XP, whatever the crowd and whatever their level | A seat in a gate is the most valuable thing in the world: a level 1 hunter leaves one B gate at level 11. The world treats seat-selling as its largest crime (`factions.md`, the Stair). It works as fiction, but gold now punishes a crowd and XP rewards one | Split XP past `goldParty` as gold is split, or pay a hunter two ranks under a gate a share of its XP. Design question 2 already asks |
| 2 | Levelling is fast: 95 own-rank gates, or 69 table sessions, from E to S; a liner with 1.5 gates a month gets there in about six years | A world twenty years old would be full of S-ranks. The bible's answer is a piece of canon, not a number: **levels began three years ago** (the Speaking, Year 17); before it a hunter's rank was fixed. It needs the owner's yes | Keep the canon, or slow the top steps (A to S is 7 gates) |
| 3 | The daily gives 1 stat point (and 25 XP) a day | 365 points a year from push-ups against 219 from all seventy levels: in the world a patient C-rank out-stats a climbing S within two years. The bible speaks only of the Daily's XP | If "points" are stat points, a lower rate or a cap by level |
| 4 | A Resurrection Crystal has no time limit, and a dead hunter uses it | The world says three dawns and "only the awakened". The game enforces neither, and should not need to; but an E crystal at one median month makes death cheap for anyone insured, which the world leans into | None needed. A GM's option "crystals fail after N days" if a table wants death to bite |
| 5 | No consumable above epic, none at rare | A and S hunters stop buying potions, so the Shop stops being a sink at the top. The world prices rare 625, legendary 9,500, mythic 37,500 by `usedUpShare` | Four built-in potions at the missing tiers |
| 6 | Mana Crystal Shard: shipped 40 (sells for 20); design 100, selling at a quarter (25) | In the world crystal is the one drop nobody keeps, and it sells at 85 to 90% of assay. A quarter fits worn gear, not a raw material | A `materialShare` (0.85) beside `saleShare`, for items of type material |
| 7 | A gate pays gold and two picks; its carcass and crystal pay nobody | The world's guilds live on the harvest: 1.5 times the gold pot, of which a rights holder nets 55% | Nothing in rules. A GM who lets a party buy a gate's rights (the table in section 8) pays the holder's net as a quest reward |
| 8 | No fee, tax or upkeep | The world has a door fee (10% of a Clear), a levy (10% of System gold) and a house share (25%) | Optional rule numbers a GM can switch on; off by default, as now |
| 9 | `gateSpawn.rank.S` is 1 in 100 | In the world an S gate is 1 in 20,000: Carrow sees one in three years | Nothing: a table rolls the gates worth a session, not the city's |
| 10 | Shipped prices: `baseValue` 10 with a literal 10, rarity factors 1 to 200, a sale at half, a crystal at a flat 100,000 | This bible prices by the ruled design (a Clear a tier, a quarter, ten Clears). Until the design's unit 1 ships, the app's prices above common are lower than these tables | Ships with the economy units |
| 11 | Built-in item, title and job names (Kasaka's Venom Fang, Baruka's Mana Ring, Kamish's Wrath, Shadow Monarch, King of Shadows) | They come from a published series. The world bible uses none of them and names nothing after another work | the owner's call, and it matters most for the public repository |
| 12 | A world gate cleared alone pays four Clears | The world agrees, and the Bureau hates it: "soloing" is legal, lucrative, and the leading cause of a hunter staying dead | None |
