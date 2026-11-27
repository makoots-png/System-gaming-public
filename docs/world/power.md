# Power: awakening, rank, lifespan, the System

`bun docs/world/prices.ts --write` prints the tables between `<!-- prices:... -->` marks from the game's numbers:
`xpPerLevel`, `rankLevels`, the daily quest's XP, a monster's XP by rank, and the body's growth by level.

Two rules shape this file. Every human has the System. A hunter's level is capped at the top of the rank they
awakened with. `story.md` gives the GM the reasons.

## 1. Everyone has a window

At 03:14 UTC on Day Zero every person on Earth saw a window that nobody else could see. It showed their name, the
word "Resident", "Level 0" and "Cap: 0". It has been there ever since. A child's window appears at birth.

A Resident's window does nothing most of the time. During a break nearby it shows a quest, usually "Survive:
10:00" with a timer. It names no reward.

People call the thing behind the window the System. It has never stated a purpose.

## 2. What makes a hunter

A person awakens after a fever that lasts three days. The temperature passes 40 degrees, and on the second day the
veins of the wrists turn blue. When the fever ends, the window has changed. It now shows a job, a rank, eight
stats and "Level 1". About one person in five hundred has awakened. Most awaken between fourteen and thirty. The
youngest known was six and the oldest was seventy-one.

Researchers have established three things about who awakens:

- Awakening is not inherited. The children of two hunters awaken no more often than other children.
- Awakening is more likely near a break. A person who survives a break within sight of it is about eight times as
  likely to awaken in the following year. Most researchers now link this to the "Survive" quest. Scarside is the
  poorest district in San Francisco and has the most hunters for its population. Some parents move toward Red zones for
  this reason, and some people walk toward a break siren.
- Awakening does not depend on fitness, religion or character.

A new hunter gets these things at once:

- A body that carries mana. It is stronger and faster than before, tires more slowly, and is harder to kill.
- An Inventory, which is a storage space that only the hunter can reach.
- Access to the Shop, which sells for gold.
- A level, quests and a daily quest (section 3).

## 3. What awakening costs

- **The fever kills about one person in sixty.** Older people die more often. No treatment works.
- **Registration.** A new hunter must report to a Bureau hall within 72 hours. The rank is public for life.
- **The call-up.** The state can order any registered hunter to a break. Refusing is a crime.
- **Insurance.** Ordinary life, health and motor policies end when the holder awakens.
- **Work and law.** No sports league accepts a hunter. A court treats a hunter's assault as armed assault. Many
  employers will not hire a D-rank or higher for work with the public.
- **The daily quest.** The System sets every hunter one quest a day. The standard quest is a hundred push-ups, a
  hundred sit-ups, a hundred squats and a ten-kilometre run. A hunter who finishes it gains XP. Completing the daily
  quest never heals HP, restores mana, or clears fatigue (the owner's ruling). A hunter who misses it is Penalized and
  takes a penalty on every check until they finish the Penalty Zone quest (`machines.md`, `The daily quest`). A
  hunter cannot turn it off. A hunter at their cap gains nothing from it and is still Penalized for missing it.

- **The cap.** Two hunters in five awaken as E-ranks and will never pass level 9.
- **Family.** A hunter above E rank ages more slowly than their Resident relatives (section 6).

## 4. Rank, level and the cap

`machines.md` charts the states a person passes through, from Resident to uncapped.


The window shows a level and a line that reads "Cap:" with a number. The rank a hunter awakens with sets the cap.
A hunter gains XP from kills and quests and rises to the cap. At the cap the XP bar stops.

| Rank | Levels | Share of hunters | What a hunter of this rank can do |
|---|---|---|---|
| E | 1 to 9 | 40% | Stronger than any athlete. An E-rank monster the size of a dog can still kill one. |
| D | 10 to 19 | 33% | Survives small-arms fire in good gear. |
| C | 20 to 34 | 18% | Can fight a platoon of soldiers alone. Most states refuse exit permits from this rank up. |
| B | 35 to 49 | 7% | Can break through a concrete wall. The police know every B-rank in the city by name. |
| A | 50 to 69 | 2% | Can stop a C break alone. San Francisco has about thirty. |
| S | 70 and up | 1 in 10,000 | About fourteen hundred in the world. Nobody has found an S-rank's cap. |

A hunter awakens at the first level of their rank. Most working hunters reach their cap within a few years and
stay there for life. Guilds price a hunter by rank and treat the level inside the rank as experience.

The table shows how fast a hunter gains XP, from the game's numbers. A gate's XP is split among the party as its
gold is, so a hunter who clears a gate alone takes four shares. For a capped hunter only the row for their own
rank matters, and only until the cap.

<!-- prices:roads -->
| Step | XP needed | The daily quest alone | Own-rank world gates in a party of four | Own-rank world gates alone (four shares) | One own-rank gate a week in a party of four, and the daily quest |
|---|---|---|---|---|---|
| E to D (level 1 to 10) | 4,500 | 0.5 years | 26 | 7 | 3.0 months |
| D to C (level 10 to 20) | 14,500 | 1.6 years | 28 | 7 | 4.8 months |
| C to B (level 20 to 35) | 40,500 | 4.4 years | 24 | 6 | 4.9 months |
| B to A (level 35 to 50) | 63,000 | 6.9 years | 12 | 3 | 2.5 months |
| A to S (level 50 to 70) | 119,000 | 13.0 years | 7 | 2 | 1.6 months |

E to S takes 241,500 XP. By the daily quest alone that is 26.5 years.
<!-- /prices:roads -->

**Personal gates.** A personal gate is a gate that only one hunter can enter. The System does not open them on a
schedule. One opens when a hunter uses a gate key, and the System opens one for a hunter on rare occasions for
reasons it does not give. In the game the GM decides when. A personal gate stays for a day. It holds one or two
monsters and no boss, and it pays a quarter of one hunter's share of a world gate of its rank. Nobody else can
enter, so a hunter who dies in one is raised only if they carried their own crystal. Most hunters never see one.
A gate key drops from about one Clear in two hundred and sells for about 1 to 2 Clears of its rank (`items.md`,
section 2).

**Re-awakening.** Fewer than thirty hunters on record have risen past their cap. Each reported a second fever and
then read one rank higher. The Bureau calls this a re-awakening and cannot explain it.

## 5. The trial gate and the party

In the app, XP math never enforces a level cap (`gainXp` never reads `capDisplay`, and `src/core/hunter/level.ts` keeps
only `MIN_LEVEL` and `MAX_LEVEL`). Instead, each hunter carries a per-hunter, display-only cap chip (`Cap: 9`,
`Cap: 19`, `Cap: none`, or hidden) derived from `RULES.rankLevels` so the screen reflects the story state the GM runs
(`story.md`, section 4).


This section is for the GM.

A cap can be removed or raised. Normally, the System opens a personal gate of an unusual color for a hunter who is
at their cap. Hunters have no name for it, because almost nobody has seen one. This file calls it a trial gate.
Passing any trial triggers a brief second fever as the body's mana ceiling breaks, which is why clinics and guild
scouts watch for second fevers.

The Hosts run two kinds of scheduled trial:

- **A step trial** raises the hunter's cap by one rank. The fewer than thirty recorded re-awakenings were step trials
  (such as Pavel Dunmore of the Lantern Company, `factions.md`, section 2).
- **An open trial** removes the cap completely so the window reads `"Cap: none"`. Sabine Okoro and Marek Osei passed
  scheduled open trials.

**The party's off-schedule trial (Mission 1):** the players' party does not wait until level 9 for a Host-scheduled
open trial. In Mission 1 (`The Empty Seat`, `story.md`, Act 1), a rogue sponsor (`The Bettor`, `story.md`, section 7)
pays a Season 12 Host off the books to stage an old-format open trial inside a routine E-rank Bureau gate (`Tidewall
Cannery Gate`). Clearing it lifts the party's cap (`Cap: none`) with a brief second fever at level 3 and grants Wave 1
unique class access. Because this trial is an off-schedule exception paid for by one buyer rather than routine Host
casting, Sabine Okoro, Marek Osei, and Pavel Dunmore remain rare. Crossing into D-rank at level 10 forces an Act 1
cover-up, and crossing into C-rank at level 20 breaks the single re-awakening story (`no recorded hunter has
re-awakened twice`), triggering the Hosts' formal wrong-colored gate as a **Network Audit** (`story.md`, Act 2).

**Who else has passed an open trial.** A very few hunters are fully uncapped and hide it. Two are named in this
folder: Sabine Okoro (`fame.md`, section 7) and Marek Osei of the Stair (`factions.md`, section 6).

**What the world sees.** Nobody can see another person's window. Other people see only the result: a hunter
registered as E who fights like a D a few months later.

**What the world believes.** People explain an uncapped hunter in one of four ways:

- **Re-awakening.** This is the Bureau's working explanation. It fails after the second rise, because no recorded
  hunter has re-awakened twice.
- **A false first reading.** Guild scouts assume the hunter bribed an assessor to read low and avoid the call-up.
  The bribe exists and costs five Clears (`economy.md`, section 12).
- **An item.** Rivals assume the hunter owns a drop that raises stats, and some will try to steal it.
- **"Growth type".** Hunters' forums use this term for a hunter who keeps getting stronger. Most hunters treat it
  as a rumour. The Bureau's watch desk keeps a file under that name.

**What happens if the truth is known.** Every capped hunter in the world would want to know how. A GM can use any
of these reactions:

- A guild offers a contract at several times the rate for the hunter's rank, with a clause that binds the hunter
  for twenty years.
- The Bureau orders monthly readings and restricts travel.
- A foreign state offers citizenship, or sends someone to take the hunter abroad.
- A rival guild, or an S-rank who does not want a new peer, pays to have the hunter killed while still weak.
- Capped hunters gather outside the hunter's home. Some ask where the gate was. Some have been at level 9 for
  twenty years and do not ask politely.

## 6. How long each rank lives

Mana slows ageing. A hunter's body holds more mana at a higher level, in the same proportion as the game's growth
factor, which is 1 + (level − 1) / 24. A hunter with a growth factor of 2 ages one year in every two. Clinics that
measure the age of cells have recorded this for twenty years. The table uses the first level of each rank. A
hunter at the top of a rank ages a little more slowly than the table shows.

<!-- prices:lifespan -->
| Rank | First level | Growth (the game's g) | Time to age one year | Awakened at 25 and at this rank from then on: lives to about | Ageing over ten years at this rank |
|---|---|---|---|---|---|
| E | 1 | 1.00 | 1.0 years | 80 | 10.0 years |
| D | 10 | 1.38 | 1.4 years | 101 | 7.3 years |
| C | 20 | 1.79 | 1.8 years | 124 | 5.6 years |
| B | 35 | 2.42 | 2.4 years | 158 | 4.1 years |
| A | 50 | 3.04 | 3.0 years | 192 | 3.3 years |
| S | 70 | 3.88 | 3.9 years | 238 | 2.6 years |
<!-- /prices:lifespan -->

The fifth column assumes that nothing kills the hunter. A GM should also know the following:

- The figures are projections from twenty years of measurements. The oldest S-rank alive is ninety-one. She
  awakened at seventy-one and has aged five years in the twenty years since.
- A Resident lives to about 74 on average. That is lower than before the gates, because of breaks and shortages
  of medicine.
- An E-rank at level 9 ages one year in every sixteen months. Half of the E-ranks who keep hunting are dead by 58.
- An uncapped hunter ages at the rate of their current level, so each level adds to their expected life.

Longer lives cause practical problems. A life sentence for a B-rank could last a hundred and thirty years, and no
state has a prison that holds a B-rank. Pension funds refuse hunters. S-ranks expect to be alive in two hundred
years, and they plan further ahead than any elected government.

## 7. Jobs, shadows, titles and feats

**Jobs.** The window names each hunter's job: Fighter, Assassin, Mage, Tanker, Healer, Ranger or Necromancer. About
one hunter in eight is a Healer. Every party wants one, so guilds pay a healer one and a half times the retainer.
About one hunter in three hundred is a Necromancer.

**Unique classes (Epic and Mythic).** Beyond the seven standard jobs sit unique classes held by only one hunter at a
time. In Mission 1 (`The Empty Seat`, `story.md`, Act 1), the buyer prepays a Wave 1 seed package from the Hosts'
vault: three Mythic classes (`Hemomancer`, `Bladefiend`, `Rifthunter`) and three Epic classes (`Seraph`, `Ironclad`,
`Stormcaller`). High-depth nodes on Mythic and Epic trees cost heavy gold (`src/core/hunter/classes.ts`), so level-3
E-ranks holding unique classes still have E-rank HP, E-rank gear, and an E-rank Bureau license. *GM lore notes
(proposed, needs the owner):* player screens stay literal (`"Six classes are open"`, never `"vacant"`), preserving
Act 4's reveal. The owner still needs to rule on (1) whether unique classes are windows vacated by earlier seasons'
hunters, and (2) what a Bureau crystal reading shows for a hunter holding a Mythic or Epic class.

**Shadows.** A Necromancer can extract a shadow from a monster they have killed. The shadow then fights for them.
A Necromancer gets three attempts on each corpse. Extraction is harder when the monster outranks the Necromancer,
and harder again for a boss. The law sets three rules:

1. A Necromancer needs a licence to extract.
2. The Gravewardens record every shadow in a register.
3. Nobody may extract a shadow from a human body.

The System has never stopped a Necromancer from extracting a human shadow. Only the law forbids it.

**Titles and feats.** The System records certain acts as feats in a hunter's Chronicle. For some feats it grants a
title, and a title gives a small bonus. Nobody can buy or forge a title. A hunter can choose to show their titles
to another hunter, window to window, and cannot show a title they do not hold. A title is therefore the only proof
of what a hunter did inside a gate, where cameras do not work (`fame.md`, section 1).

`economy.md` covers the Shop and the Inventory.

## 8. Gates and crystals

`machines.md` charts the states of a world gate, a break, a personal gate and a death. This section gives the rules
behind them.


- **World gates.** A world gate opens at a fixed place, and any licensed party can enter it. The Bureau reads its
  rank, posts it, and then licenses a party or sells the rights. The inside is a different place each time, such as
  a cave system, a flooded temple or a fortress. It holds a pack of monsters and a boss. The gate is cleared when
  the boss dies.
- **The break day.** A gate that nobody clears breaks, and everything inside comes out. An E gate breaks on day 7,
  D on day 6, C on day 5, B on day 4, A on day 3 and S on day 2. A cleared gate does not break. It stays open and
  empty until its break day and then closes. Reclaimers work during that time.
- **Holding a gate.** The crystal grows as the break day approaches, and the boss grows more dangerous without
  changing rank. A rights holder earns more by clearing late (`economy.md`, section 8).
- **Red gates.** About one gate in ten is red. It seals behind the party. Nobody can leave or enter until the boss
  or the party is dead, and every check inside is harder. From outside, a red gate looks like any other.
- **Double gates.** About one gate in twenty has a second area beyond the boss's room. The second area can have a
  different rank, and the Bureau's reading does not show it. Guilds have a standing rule: when a cleared gate has
  another door, the party votes before anyone opens it.
- **Personal gates.** Section 4 describes them. They are rare. The Bureau cannot read, sell or tax one. It contains
  no crystal to harvest. A cleared one pays gold and, one time in four, an item.
- **A world gate cleared alone.** One hunter takes the whole pot, which is four Clears, and four shares of the XP.
  This is legal. Guild contracts forbid it.
- **Gates that never close.** The S gate in Port Sarn has stayed open for twenty years. A few other gates have
  also stayed open, and nobody knows why. One is a B gate in a flooded car park in the Scar (`seeds.md`).
- **Death and Resurrection Crystals.** Death follows the owner's revive ladder (`machines.md`, `Revive standing` and
  `A death`): a hunter's first revive within an hour is free of gold cost; the second is one revive on debt (ten
  Clears); after that, no System revive is offered. From the third death on, only a GM grant or a Resurrection
  Crystal of the hunter's rank or higher, bought before the death and used within an hour, brings the hunter back.
  Gold held after death does not help, because a dead hunter cannot open the Shop. An unused crystal keeps for any
  length of time. None of this works for a Resident. The app does not enforce the hour, and the GM applies it. Every
  raising also costs the hunter collateral that is not gold (`story.md`, section 3).

## 9. What people think the System is

In San Francisco's polls a third of people say the System is a machine that someone else left behind. A quarter say it
is a god. A fifth say it is the Earth. The rest give other answers or none. Millions of people have asked their
window what it is. It has never answered.

Every hunter knows these things from experience:

- Its numbers are always correct and its payments are never late.
- A quest pays exactly the reward it named, and a penalty is exactly the penalty it named. Every System rule is
  honored literally.
- It speaks in plain words, in the person's first language, with no sign of emotion.
- It pays more for risk. A smaller party gets more gold and more XP for each hunter.
- It has never said why anyone is capped.
- Hunters who have returned from death often develop small blank spots in their memory, failing to recognise a
  childhood song, a recipe, or a familiar photograph. Doctors call it first-return amnesia and blame oxygen loss.

`story.md` has the truth, the order in which the party learns it, and the clues to plant.
