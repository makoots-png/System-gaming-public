# The world of the Hunter System

A world bible for the game: Earth, twenty years after the gates opened. Written to be run from at a table. It
changes no rule and no code; where it strains against the game's numbers it says so (`economy.md` section 15).

## Read in this order

| File | What it holds | Read it when |
|---|---|---|
| `seeds.md` | A primer to read aloud (section 3), twenty hooks, ten places | First. The primer is the whole world in three minutes |
| `history.md` | Day Zero, the Long Week, the Break Years, the Accord, the Speaking, the world now | Before a first session |
| `power.md` | The Kindling, what a rank means, the three roads up, lifespans, gates, five truths about the System | A player asks "why" |
| `economy.md` | The anchor, every price, incomes by rank, the table for the lead | A player asks "how much" |
| `factions.md` | Six guilds, the state, three companies, three cults, the criminals, the unawakened | The party needs someone to work for, or against |
| `careers.md` | Scouting, the Reading, the model contract and its nine traps, insurance, transfers, retirement | A guild makes an offer |
| `fame.md` | Titles, rankings, media, sponsorship, celebrities | The party does something in daylight |
| `sources.md` | What was read and what was taken from it | |
| `prices.ts` | Prints every price table. `bun docs/world/prices.ts --write` refills them | The anchor or a rule changes |

## The world in ten lines

1. **Year 0:** gates open. The worst broke first (S on day 2, E on day 7: the game's break days). One in twenty died.
2. **One person in five hundred kindles** into a hunter: a fever, then a window, an Inventory and the Shop.
3. **The System pays in gold**, which only hunters can bring into the world. It became the world's money.
4. **One gold is a street meal.** A labourer's day is 30. The median month is 1,000. An E Clear is 100.
5. **A gate pays twice:** gold and drops to the hunters, crystal and carcass to whoever holds the rights. Guilds
   exist to hold rights and hand out seats.
6. **Crystal lights the cities.** Rent is priced on how fast a hunter reaches your street.
7. **A Resurrection Crystal works on hunters only**, at ten Clears of their rank. Death is a bill. The unawakened
   cannot pay it at any price, and politics starts there.
8. **Year 17, the Speaking:** the System, silent until then, gave hunters levels, the Daily, personal doors and
   titles. Rank, fixed for seventeen years, became a ladder. Levels slow ageing: an S-rank may live 240 years.
9. **Year 20, now:** there are about 1,400 S-ranks. On the game's own XP numbers a steady guild hunter climbs from
   E to S in six years. The first of them arrive around Year 23, and nobody is ready.
10. **Nobody knows what the System is.** `power.md` gives the GM five answers.

## Names to know

Carrow (the city). The Bureau (reads, licenses, auctions). The Halfway House (where you were read). Ironwake, the
Lantern Company, Aurelian, the Ninth Hour, the Gravewardens, Redline (guilds). Helix (crystal power). Paragon
(insurance). The Stair (seats and fences). The Once-Born (the unawakened's movement). The Patient (the Daily and
nothing else). The Fixed and the Risen (S-ranks from before and after the Speaking). A climber (a hunter rising
fast: the party).

## What is the owner's to rule

The five decisions the bible most needs are at the end of the hand-off message and in `economy.md` section 15:
the Speaking as canon, XP in a crowd, the crystal's limits, the daily's stat point, and the borrowed names of the
built-in items.

## Keeping it true

- Prices: change `WORLD` in `prices.ts` or a rule in `src/core/rules.ts`, run `bun docs/world/prices.ts --write`,
  then read the prose beside each table; a few sentences quote a number.
- Names and dates: `history.md` section 8 is the one timeline; `factions.md` is the one cast list.
