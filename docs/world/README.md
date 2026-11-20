# The world of the Hunter System

This folder describes the game's setting: Earth, twenty years after the gates opened. A GM can run sessions from
it. It changes no rule and no code. `economy.md`, section 15, lists the places where the setting and the game's
numbers disagree.

## Files

| File | Contents | When to read it |
|---|---|---|
| `seeds.md` | A primer to read to players (section 3), twenty hooks, ten places | First |
| `history.md` | Day Zero, the Long Week, the Break Years, the Carrow Accord, the world in Year 20 | Before a first session |
| `power.md` | The window every human has, awakening, ranks and caps, the trial gate, lifespans, gates | When a player asks why something works as it does |
| `story.md` | For the GM only: what the game is, the campaign in six acts, the horror arcs, the ending | Before planning a campaign |
| `economy.md` | What one gold is worth, every price, income by rank, the table for the lead | When a player asks what something costs |
| `factions.md` | Six guilds, the state, three companies, three cults, the criminals, the unawakened | When the party needs an employer or an enemy |
| `careers.md` | Scouting, the reading, the model guild contract and eight traps in it, insurance, transfers, retirement | When a guild makes the party an offer |
| `fame.md` | Titles, rankings, media, sponsorship, celebrities | When the party does something in public |
| `sources.md` | What was read for this folder and what was taken from it | |
| `prices.ts` | The script that prints the price tables | When a rule or an assumption changes |

## The setting in ten points

1. In Year 0 gates opened across the world. The highest-ranked gates broke first, on the game's break days: the S
   gate on day 2 and the E gates on day 7. About one person in twenty died in the next three years.
2. About one person in five hundred awakens as a hunter after a three-day fever. A hunter gets a stronger body, an
   Inventory and access to the Shop.
3. The System pays hunters in gold. Nobody else can create gold, and it became the world's money.
4. One gold buys a street meal. A labourer earns 30 a day. The median wage is 1,000 a month. An E Clear is 100.
5. A gate pays the hunters who clear it in gold and drops. It pays whoever holds its rights in crystal and
   carcasses. Guilds buy rights and give their members seats.
6. Cities run on power from gate crystal. Rent depends on how fast hunters can reach a street.
7. A Resurrection Crystal raises a dead hunter for ten Clears of the hunter's rank. It does not work on an
   unawakened person. That difference is the main political conflict.
8. Every human has a System window. A Resident's reads level 0. A hunter levels up to the cap of the rank they
   awakened with and then stops. A higher level slows ageing, and an S-rank may live to about 240.
9. A trial gate removes a cap. Almost nobody knows this. The players' hunters pass one early in the campaign and
   can then rise through every rank. A very few other hunters have done the same and hide it.
10. The System has never stated a purpose. `story.md` tells the GM what the game is, who runs it and how the
    party ends it. The tone is bleak, with horror in every act.

## Names

- **Carrow** is the city, a port of six million people.
- **The Bureau** reads gates and hunters, licenses parties and auctions gate rights. Its hall is the Halfway House.
- **The guilds** are Ironwake, the Lantern Company, Aurelian, the Ninth Hour, the Gravewardens and Redline.
- **Helix** makes the city's power from crystal. **Paragon** sells insurance.
- **The Stair** sells illegal seats in gates and buys stolen drops.
- **The Once-Born League** campaigns for the unawakened.
- **A liner** is an ordinary guild raider.
- **A re-awakening** is a second awakening that raises a hunter's rank once. Fewer than thirty are on record.

## The owner's rulings

the owner answered the folder's five questions on Nov 20, and the files follow his answers.

1. Every human has the System, and the game was forced on them. Every hunter levels up to a cap set by their
   rank, and a special dungeon removes the cap. The party grows strongest, fights what the game was preparing them
   for, and then kills the people who run it. The story should be bleak and include horror.
2. A gate's XP is split as its gold is.
3. A dead hunter can be raised within an hour of the death. A crystal never expires. The GM applies the hour, and
   the app does not.
4. The daily quest's stat point is for the lead. The owner suggests raising the stat points that levels give.
5. The built-in names taken from Solo Leveling stay.

## Keeping the folder correct

- To change prices, edit `WORLD` in `prices.ts` or a rule in `src/core/rules.ts`, then run
  `bun docs/world/prices.ts --write`. Reread the sentences next to each table, because some quote a number.
- `history.md`, section 8, is the only timeline. `factions.md` is the only list of named people. Change a date or
  a name there first.
