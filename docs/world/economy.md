# The economy

`bun docs/world/prices.ts --write` prints every table between `<!-- prices:... -->` marks. The script reads three
things. The first is the shipped `RULES`: the loot gold, the break days and the XP. The second is the economy
design's ruled numbers: a sale at a quarter, grades at 1.5, a crystal at ten Clears, shared gate gold. The third is
the object `WORLD` in the script, which holds this world's assumptions with a reason beside each. To move the
anchor, change `WORLD`, rerun the script, and reread the sentences that quote a number.

Prices are in gold. One gold is 100 bits. States strike bits in nickel, because the System pays out only whole
coins.

## 1. The anchor: what one gold is

The game's anchor is one Clear, the gold one hunter of a party of four takes from a world gate of a rank. An E Clear
is 100 gold. The world adds one assumption to tie that to a wage:

**An unskilled labourer earns 0.3 of an E Clear a day, which is 30 gold. A plain hot meal from a street stall costs
one gold.**

The reason for 0.3 is the E-rank's place in the world. An E-rank is the weakest hunter and the easiest to replace.
If a Clear paid a month's wage, every E-rank would be rich and no guild could make them queue for a seat. If it paid
one day's wage, nobody would enter a gate. At three labourer-days a gate, an E-rank who gets one gate a month earns
less than a dock worker. An E-rank with a guild contract, four gates a month and a personal gate most days earns a little under the
median wage. The higher ranks follow from the game's ladder, where each rank's Clear is about 3.5 times the one
below.

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

Five numbers are enough to price most things at the table: a meal is 1 gold, a labourer's day is 30, the median
month is 1,000, an E Clear is 100, and an ordinary family flat is 120,000. One gold buys about what four or five US
dollars bought in the 2020s.

## 2. Where gold comes from

When a party clears a gate, the System puts gold in each hunter's Inventory. A hunter can take it out as coins. Each
coin weighs 8 grams and is identical to every other, and a hunter's window shows at once whether a coin is real. No
state or forger can make one, so nobody can add to the supply except by clearing gates.

By Year 8 every state had pegged its currency to gold or stopped issuing it. In Carrow's country the Ledger Act of
Year 17 made gold the legal unit of account. National banknotes still circulate as receipts for gold held in a bank.

The world's money supply therefore works like a game economy's:

| | In the world | In the game |
|---|---|---|
| Sources of gold | Clears of world gates and of personal gates | `loot[rank].gold`, shared; a personal gate's quarter |
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
| A plain street meal (noodles, a filled bread) | 1 | 0.03 | the anchor |
| Tea or coffee | 0.5 | 0.02 |  |
| A loaf of bread | 0.4 | 0.01 |  |
| A beer in a bar | 1.2 | 0.04 |  |
| A week of groceries, one adult | 23 | 0.75 | a quarter of an unskilled week |
| Dinner for two, a Saltmarket restaurant | 15 | 0.50 |  |
| Dinner for two in the Crown | 90 | 3 |  |
| A plate of monster meat (D-rank boar, from a licensed butcher) | 18 | 0.60 | reclaimers sell carcasses to butchers |

**Home**

| Thing | Gold | Labourer-days | Note |
|---|---|---|---|
| Stone-grid power, a household, a month | 30 | 1 |  |
| Water and waste, a month | 11 | 0.35 |  |
| A phone plan with Doorwatch alerts, a month | 9 | 0.30 |  |
| A phone | 360 | 12 |  |
| Work boots | 30 | 1 |  |
| A good suit or dress | 150 | 5 |  |
| A go-bag, packed to the Bureau's list | 60 | 2 | a household in an Amber zone keeps one for each person |

**Getting around**

| Thing | Gold | Labourer-days | Note |
|---|---|---|---|
| A tram or bus ride | 0.3 | 0.01 |  |
| A month's pass | 15 | 0.50 |  |
| A taxi across town | 6 | 0.20 |  |
| Rail to the next city | 30 | 1 | trains between cities run armoured and escorted |
| A flight inside the country | 120 | 4 |  |
| A flight abroad | 600 | 20 | few routes, each with a hunter escort |
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
| A year at a hunter academy (unsponsored) | 9,000 | 300 | nine median months; a guild sponsors most students |
| A lawyer, an hour | 39 | 1.3 |  |
| A lawyer who specialises in guild contracts, an hour | 120 | 4 |  |
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
| A reclaimer (carcass crew), a day in a gate | 75 | 2.5 | when paid a wage; most crews take a quarter of the harvest |
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
| The Crown | Green. The city centre. Response time four minutes | 960 | 2,400 | 480,000 | 40.0 |
| Ledger Row | Green. The guild halls and the Bureau are here | 660 | 1,700 | 330,000 | 27.5 |
| Saltmarket | Amber. Where most of the city lives | 240 | 600 | 120,000 | 10.0 |
| Northfield | Amber. A suburb of houses, forty minutes by tram | 200 | 510 | 100,000 | 8.5 |
| Tidewall | Amber. The port and its warehouses | 180 | 450 | 90,000 | 7.5 |
| Scarside | Red. Beside the Scar. No insurer sells break cover here | 72 | 180 | 36,000 | 3.0 |

A floor of a guild tower in Ledger Row rents for 39,000 a month. The last S-rank's estate sold in the Crown went for 30,000,000.
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

A bank requires break cover before it lends, and Paragon Mutual sells no break cover in Red. Buyers in Scarside
therefore pay the whole price in coin, and most Scarside flats are rented. A couple on two median wages buys a
Saltmarket flat on a twenty-five-year mortgage.

## 6. Medicine and potions

A consumable costs half the price of an item of its tier (the design's `usedUpShare`), so one Clear buys two
potions of its rank.

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

A Health Potion closes a hunter's wound within seconds. On an unawakened person it works at about a tenth of that
strength, and a second potion in the same week causes fever and then organ damage. Hospitals therefore still exist.
Deaths from blood loss have become rare, because every ambulance carries two Health Potions. A runner charges 60
gold for each, which is two days of a labourer's wage, and who pays for them is the main dispute in health policy.

An Elixir of Life saves an unawakened patient from most injuries and from some cancers. Through a runner it costs
3,000 gold, or three median months. Many families sell a car to buy one.

The game has no consumable above epic and none at rare. The table prices the missing tiers by the same rule, so a
GM who makes an A-rank potion can take its price from the legendary row.

## 7. Gear by rarity and grade

The table follows the design. A middle item of a tier costs one Clear of that tier's rank, a minus costs two
thirds of that, a plus costs one and a half times it, and the Shop buys at a quarter.

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

The last column shows who can afford gear from a wage. A labourer can save for a common sword in a week. A full
legendary set costs sixteen years of the median wage, so no wage earner can equip an A-rank. Hunters buy gear above
rare with gate gold or on a guild's credit, and the guild keeps a lien on gear bought on credit (`careers.md`,
section 4).

## 8. Gates: the entry fee, rights, the levy, the harvest

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
| E | 7 | 400 | 100 | 10 | 600 | 150 | 120 | 330 | 200 | 900 |
| D | 6 | 1,300 | 325 | 33 | 1,950 | 488 | 390 | 1,073 | 640 | 2,925 |
| C | 5 | 5,000 | 1,250 | 130 | 7,500 | 1,875 | 1,500 | 4,125 | 2,500 | 11,250 |
| B | 4 | 20,000 | 5,000 | 500 | 30,000 | 7,500 | 6,000 | 16,500 | 9,900 | 45,000 |
| A | 3 | 76,000 | 19,000 | 1,900 | 114,000 | 28,500 | 22,800 | 62,700 | 38,000 | 171,000 |
| S | 2 | 300,000 | 75,000 | 7,500 | 450,000 | 112,500 | 90,000 | 247,500 | 150,000 | 675,000 |
<!-- /prices:gates -->

Carrow has 6 million people, 12,000 hunters and 600 world gates a month:

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

If seats were shared equally, a hunter would get a seat in a gate of their own rank about once in five months.
Guilds hold most of the seats. An unsigned hunter therefore gets about one gate a month and earns mainly from personal gates, and a party that gets a world gate every week draws
attention from guilds and from the Bureau.

## 9. Mana crystal and who buys it

Gold stays in circulation, but crystal is burned for power. A boss's core is worth about one Clear of its gate's
rank at assay. The rest of a harvest is wall crystal and carcass.

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

Helix Manaworks buys nine tenths of Carrow's crystal and burns it in the reactors that power the city. The Bureau's
exchange on Ledger Row pays a little less, pays at once, and asks for no paperwork. A fence pays less than the
exchange and asks no questions. The Shop pays a quarter, so nobody sells crystal to the Shop.

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
  the rank. Most guilds pay it as a crystal that the guild holds for the hunter. An E-rank or a D-rank signs for
  two Clears.
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
| Guild clerk, a month | 1,100 |
| Analyst, a month | 2,600 |
| Scout (a retired C-rank), a month | 4,500 |
| Contract lawyer, a month | 7,800 |
| Press officer, a month | 3,300 |
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
| Fine: under-declared gold | 0.3 | three times the levy dodged, on each Clear of the hunter's | 30 | 98 | 380 | 1,500 | 5,700 | 23,000 |
| Bail for a hunter | 8 | the hunter's | 800 | 2,600 | 10,000 | 40,000 | 150,000 | 600,000 |
<!-- /prices:law -->

<!-- prices:insurance -->
| Rank | Crystal cover, a year | A crystal on credit: interest a month |
|---|---|---|
| E | 50 | 30 |
| D | 163 | 98 |
| C | 625 | 375 |
| B | 2,500 | 1,500 |
| A | 9,500 | 5,700 |
| S | 37,500 | 22,500 |
<!-- /prices:insurance -->

Crystal cover is an insurance policy. A crystal raises a hunter only within an hour of the death, so the party
must carry the crystal into the gate. The policy repays the price of one crystal a year that was used on the
hunter. The premium is a twentieth of the crystal's price a year. The policy excludes a death in a personal gate and a death in a world gate entered alone.

## 13. Resurrection Crystals

A crystal costs ten Clears of the rank it raises, as the design rules. The Shop sells crystals to any hunter.

<!-- prices:crystals -->
| Crystal | Shop price | Median months of wage | A clinic's price to raise a hunter | From the Stair, with no record | Months of a guild liner's net income | Months of a freelancer's |
|---|---|---|---|---|---|---|
| E | 1,000 | 1.0 | 1,100 | 1,500 | 1.1 | 1.8 |
| D | 3,250 | 3.3 | 3,575 | 4,875 | 1.3 | 2.2 |
| C | 12,500 | 12.5 | 13,750 | 18,750 | 1.5 | 2.4 |
| B | 50,000 | 50.0 | 55,000 | 75,000 | 1.5 | 2.6 |
| A | 190,000 | 190.0 | 209,000 | 285,000 | 1.9 | 3.7 |
| S | 750,000 | 750.0 | 825,000 | 1,125,000 | 2.6 | 8.3 |
<!-- /prices:crystals -->

An E crystal costs one median month's wage and raises a dead hunter of rank E. It must be used within an hour of
the death. An unused crystal keeps for any length of time. No crystal raises an unawakened person. The usual
explanation is that the System holds a record of each hunter and holds none of anyone else. These prices have four
effects on the world.

- A guild party carries a crystal, so a guild hunter survives most deaths in a gate. An unsigned party usually
  carries none, because an E crystal costs ten E Clears. Poor hunters therefore die for good more often.
- A guild that raises a hunter charges the hunter for the crystal. The usual terms are ten Clears at three percent
  a month, and many hunters never repay it.
- Each state keeps a stock of A and S crystals, and other states estimate its size as they estimate its army.
- The unawakened are 499 of every 500 people. Their dead stay dead while hunters are raised. This difference is
  the largest political grievance in every country.

## 14. Income against prices

The tables show a month of income for four ways of working, using the design's measured shares. The costs taken
from the gross are the state's tenth of System gold, one potion of the hunter's rank for every two world gates,
entry fees for unsigned hunters, and crystal cover. Every hunter has personal gates, and the tables include them.

<!-- prices:incomes -->
**Occasional freelancer** (one world gate every four months, one personal gate a week, and a day job)

| Rank | Gross a month | Levy, potions, entry fees, crystal cover | Net a month | Times the median wage | Months of net for a set of own-rank gear | Years of net for a Saltmarket flat |
|---|---|---|---|---|---|---|
| E | 135 | 23 | 112 | 0.1 | 8.9 | 89.3 |
| D | 366 | 72 | 294 | 0.3 | 11.1 | 34.0 |
| C | 1,299 | 279 | 1,021 | 1.0 | 12.2 | 9.8 |
| B | 4,959 | 1,105 | 3,854 | 3.9 | 13.0 | 2.6 |
| A | 13,999 | 3,769 | 10,230 | 10.2 | 18.6 | 1.0 |
| S | 30,397 | 12,592 | 17,805 | 17.8 | 42.1 | 0.6 |

**Freelancer** (one public gate a month and five personal gates a week)

| Rank | Gross a month | Levy, potions, entry fees, crystal cover | Net a month | Times the median wage | Months of net for a set of own-rank gear | Years of net for a Saltmarket flat |
|---|---|---|---|---|---|---|
| E | 643 | 86 | 557 | 0.6 | 1.8 | 18.0 |
| D | 1,737 | 270 | 1,467 | 1.5 | 2.2 | 6.8 |
| C | 6,163 | 1,044 | 5,119 | 5.1 | 2.4 | 2.0 |
| B | 23,479 | 4,127 | 19,352 | 19.4 | 2.6 | 0.5 |
| A | 65,061 | 13,541 | 51,520 | 51.5 | 3.7 | 0.2 |
| S | 132,672 | 42,021 | 90,651 | 90.7 | 8.3 | 0.1 |

**Guild liner** (four guild gates a month and five personal gates a week)

| Rank | Gross a month | Levy, potions, entry fees, crystal cover | Net a month | Times the median wage | Months of net for a set of own-rank gear | Years of net for a Saltmarket flat |
|---|---|---|---|---|---|---|
| E | 1,062 | 181 | 881 | 0.9 | 1.1 | 11.4 |
| D | 3,016 | 579 | 2,436 | 2.4 | 1.3 | 4.1 |
| C | 10,781 | 2,231 | 8,550 | 8.5 | 1.5 | 1.2 |
| B | 41,750 | 8,877 | 32,873 | 32.9 | 1.5 | 0.3 |
| A | 133,763 | 31,591 | 102,172 | 102.2 | 1.9 | 0.1 |
| S | 401,919 | 113,271 | 288,649 | 288.6 | 2.6 | 0.0 |

**A table's party** (one own-rank gate a week and three personal gates a week, the design's table player)

| Rank | Gross a month | Levy, potions, entry fees, crystal cover | Net a month | Times the median wage | Months of net for a set of own-rank gear | Years of net for a Saltmarket flat |
|---|---|---|---|---|---|---|
| E | 845 | 221 | 623 | 0.6 | 1.6 | 16.0 |
| D | 2,430 | 713 | 1,717 | 1.7 | 1.9 | 5.8 |
| C | 8,662 | 2,745 | 5,917 | 5.9 | 2.1 | 1.7 |
| B | 33,696 | 10,952 | 22,744 | 22.7 | 2.2 | 0.4 |
| A | 112,644 | 40,333 | 72,312 | 72.3 | 2.6 | 0.1 |
| S | 367,742 | 152,350 | 215,392 | 215.4 | 3.5 | 0.0 |
<!-- /prices:incomes -->

The next table describes the life a signed liner can afford. A capped liner keeps this rank for life.

| Rank | Net income, times the median wage | What that buys |
|---|---|---|
| E | 0.9 | One room in Tidewall, or a share of a flat in Saltmarket. About half of that income comes from personal gates. They buy common gear used. |
| D | 2.4 | A flat in Saltmarket on a ten-year mortgage, and a car. D is the lowest rank at which hunting alone supports a household. |
| C | 8.5 | More than a surgeon earns. A flat in Ledger Row and private school for the children. A full rare set costs six weeks' net. |
| B | 33 | A flat in the Crown, household staff and an agent. The model transfer fee for a B-rank is 100,000 gold, so the guild pays attention to which other guilds the hunter talks to. |
| A | 100 | Five months' net buys a family flat in the Crown. Sponsorship (`fame.md`, section 5) often pays as much as hunting. The state tracks where each A-rank lives. |
| S | 290 | 3.5 million gold a year from hunting, and usually more from sponsorship and a city's residency payment. An S crystal costs under three months' net. |

An unsigned hunter with one public gate a month and five personal gates a week nets about two thirds of a liner's
income up to B rank. At E that is 557 gold a month, which is less than a labourer earns.

The fourth table is a table's party: one own-rank gate a week and three personal gates. The party nets less than
a liner, because it buys more potions and has no retainer.

## 15. Where the world disagrees with the game (for the lead)

The game's numbers are the owner's to change. Each row is a place where the world needed something the game's numbers
do not give, or where the numbers have a result that the world had to explain.

| # | The game today, or the ruled design | What the world needs or implies | A way to close it |
|---|---|---|---|
| 1 | Ruled since: a gate's XP is split as its gold is | The world no longer needs a trade in seats for XP. The Stair now sells unlicensed seats for gold | Closed by the owner's ruling |
| 2 | Levelling is fast. E to S takes 95 own-rank gates in a party of four, or 69 table sessions | the owner's ruling: every hunter levels up to the cap of their rank, and a trial gate removes the cap. The game has no cap and no trial gate | A level cap by rank that a GM can lift for a hunter, if the owner wants the app to hold NPC hunters or new characters to it |
| 3 | The daily gives 1 stat point and 25 XP a day | A year of dailies gives 365 points. Seventy levels give 219. The bible mentions only the daily's XP | the owner suggests raising the stat points from levels. The lead decides |
| 4 | Ruled since: a dead hunter can be raised within an hour of the death, a crystal never expires, and the app does not enforce the hour | The bible uses the hour. A party must carry its crystal into the gate | Closed by the owner's ruling |
| 5 | The game has no consumable above epic and none at rare | A-ranks and S-ranks have no potion to buy, so the Shop removes little of their gold. The world prices rare at 625, legendary at 9,500 and mythic at 37,500 by `usedUpShare` | Add four built-in potions at the missing tiers |
| 6 | Mana Crystal Shard ships at 40 and sells for 20. The design prices it at 100, selling for 25 | In the world a hunter sells crystal for 85 to 90% of its assay value. A quarter suits used gear and does not suit a raw material | Add a `materialShare` of 0.85 beside `saleShare`, for items of type material |
| 7 | A gate pays gold and two item picks. Its crystal and carcasses pay nobody | The world's guilds earn most of their margin from the harvest, which is 1.5 times the gold pot. A rights holder nets 55% of it | No rule change. A GM who lets a party buy a gate's rights (section 8) can pay the holder's net as a quest reward |
| 8 | The game has no fee, tax or upkeep | The world has an entry fee of 10% of a Clear, a levy of 10% of System gold and a house share of 25% | Optional rule numbers that a GM can turn on, off by default |
| 9 | `gateSpawn.rank.S` is 1 in 100 | In the world 1 gate in 20,000 is an S gate, and Carrow gets one about every three years | No change. A table rolls for the gates worth a session |
| 10 | Shipped prices: `baseValue` 10 times a literal 10, rarity factors 1 to 200, a sale at half, a crystal at a flat 100,000 | The bible uses the ruled design: one Clear for a tier's middle item, a sale at a quarter, a crystal at ten Clears. Until the design's unit 1 ships, the app's prices above common are lower than the bible's | Ships with the economy units |
| 11 | Some built-in item, title and job names come from Solo Leveling | the owner's ruling: the names stay, and the setting is Solo Leveling's world | Closed by the owner's ruling |
| 12 | A world gate cleared alone pays four Clears | The world agrees. Guild contracts forbid it and insurers exclude it | No change |
| 13 | A raising costs only the crystal | the owner wants death to cost a lot. The story adds a cost that is not gold (`story.md`, section 3) | Optional rule: a raising also costs the hunter one level. The owner decides |
