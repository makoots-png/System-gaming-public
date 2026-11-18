# Feats, titles and unique rewards: an idea shelf

Written Nov 18 for feature 1 ("the System acts on its own") and for the GM who gives titles and rewards by hand. The owner asked for "a list of titles, feats, etc... as well as unique rewards", drawn from books and games. This file is ideas only. It changes no code and no rule.

## 1. What is here and how to read it

- Section 3: 99 feats the System can notice by itself, in seven groups.
- Section 4: 86 titles, from E rank to S rank, with drawbacks and jokes.
- Section 5: 51 unique rewards (items, boons, skills, statuses), eight of them built on the Resurrection Crystal ruling.
- Section 6: 19 hidden quests the System issues.
- Section 7: what the game cannot express yet, ordered by how many entries need it.
- Section 8: sources.

How to read an entry:

- A **condition** is written so code can check it. Where it names a fight event it uses the names in `src/core/combat/triggers.ts` (`kill`, `struck`, `critDealt`, `avoided`, `down`, `hitDealt`, `turnStart`). Where it names a solo run it uses the outcomes in `src/core/gates/solo.ts` (`won`, `lost`, `stalled`) and the life states (`up`, `dying`, `stable`, `dead`).
- **Hidden** means the feat shows nothing until it is earned. **Shown** means the player sees the name and a count from the start.
- The **window title** is the only line in the System's voice (copy-tasks.md). Everything else is plain.
- **Needs** says what the entry reads. `now` means the save already holds the fact (the daily streak, the level, the rank, a solo run's outcome, the life state, the penalty, a gate's break day). `N1` to `N12` are the missing capabilities of section 7.
- Ids (`F12`, `T30`, `R07`, `Q03`) cross-reference the sections. They are this file's, not the code's.
- Every title bonus uses the ten keys a title can carry today (`PERK_KEYS`: the eight stats, `hpMax`, `manaMax`). An entry that wants more is marked NEEDS NEW and gives the bonus it would carry until then.

Web research: partly worked. Web search answered. Page fetches did not: tvtropes.org, en.wikipedia.org, the fandom wikis, wiki.gg and bg3.wiki are outside this session's allowed network, so no wiki page was read in full. Section 8 says, for each source, whether it came from search summaries or from memory.

Originality: every name and line below was written for this game. Sources gave structures only (a hidden condition, a reward with a cost, a title that is a joke at the holder's expense). One thing noticed while reading the registries, outside this file's task: several shipped seeds carry names that belong to the game's inspiration (the five rule titles in `RULES.titles`, and items and monsters such as Knight Killer, Orb of Avarice and Kasaka). If the game is ever shown outside the table, those are worth a pass with the same rule.

Balance read from the code, and kept to:

| Thing | Shipped numbers |
|---|---|
| A rule title | +2 on one stat, or +20 max HP. The GM-only S title is +5 |
| Gear bonus by rarity | uncommon +1, rare +2, epic +2 to +5, legendary +3 to +4, mythic +5 and +5 |
| Mana | small numbers. A Mana Potion restores 4, a legendary neck piece gives +6 max mana |
| A daily | 25 XP and 1 ability point. A level is 3 ability points. Every 7th streak day gives a bonus point |
| Gate XP by rank | E 25, D 75, C 250, B 800, A 2,500, S 8,000 |
| Gold | E gate 50 to 150, S gate 30,000 to 120,000. A Resurrection Crystal is 100,000 |

So in this file a title is worth 1 point at E rank, 2 at D and C, 3 at B, 4 at A, 5 at S, where 10 max HP or 1 max mana counts as a point. A feat gives at most 1 ability point below B rank and at most 3 anywhere. An entry that goes past this says so.

## 2. What makes a good one

1. A feat rewards a story the table will retell. "Defeated the monster that put you down, in the same fight" is a story. "Dealt 10,000 damage" is a meter.
2. A hidden feat is found by playing, never by grinding. Its condition is something a hunter does once, in one fight or one day, and could do by accident. Counts are shown, with their number, so nobody grinds blind.
3. A count has three steps at most, and each step asks about ten times the one before (10, 100, 1,000). The last step is a title somebody at the table will actually reach.
4. A title is worn, one at a time. Its bonus is small enough that a player picks the title for what it says. If one title is always best, the list has failed.
5. A title says how you play, or what happened to you. The best ones are a little rude.
6. A drawback title is given for something the hunter chose (no gear, a crystal, a missed week). The drawback is the memory of it, and the bonus is larger than usual to pay for it.
7. A unique reward changes a decision. A status that makes monsters come for you first changes where you stand. Plus 2 Strength changes nothing.
8. A reward that is a trade is better than one that is a gift. Give something, take something, and let the player decide whether to wear it.
9. The System is fair and cold. It rewards the feat and it names the failure. It never explains a hidden feat before it is earned, and never takes away what it gave.
10. Failure is content. A streak lost one day short, a retreat, a death in an easy gate: each gets a window too, and some get a title. A player who laughs at a bad day comes back tomorrow.
11. Death stays the GM's. No feat, title or quest here brings a hunter back. A few lead to a Resurrection Crystal, and each of those is marked "GM decides" so the GM can strike it.
12. A feat is earned once per hunter. A reward the party earns together goes to every hunter who was up at the end.

## 3. Feats the System can notice

Every feat needs the feat engine itself (a condition, a hidden mark, a reward, a record that this hunter has it). The Needs column lists only what the condition reads beyond that.

### 3.1 In a fight

| # | Feat | Condition | Hidden | Grants | Window title | Needs |
|---|---|---|---|---|---|---|
| F01 | Thread's end | A fight the hunter's side won ends with this hunter up at 5% of max HP or less, and it never went down in that fight | Hidden | Title T01 Still Standing | YOU ARE STILL STANDING | N2 |
| F02 | Not a scratch | A won fight of 3 rounds or more against foes of the hunter's rank or higher, with no `struck` event on this hunter | Hidden | Title T04 Clean Hands | NOTHING TOUCHED YOU | N2 |
| F03 | Three in a breath | 3 `kill` events by this hunter between one `turnStart` and its `turnEnd` | Hidden | Title T27 Swarm Breaker and 1 ability point | THE ROOM WENT QUIET | N2 |
| F04 | Payback | This hunter's `kill` is on the foe whose hit raised its `down` earlier in the same fight | Hidden | Title T16 Debt Collector | DEBT COLLECTED | N2 |
| F05 | One was enough | This hunter's first use in a fight defeats a foe of its rank or higher that was at full HP | Hidden | 1 ability point | ONE WAS ENOUGH | N2 |
| F06 | Photo finish | The `kill` on a boss is this hunter's while it is at 10% of max HP or less | Hidden | Skill R24 Final Notice | IT FELL FIRST | N2 |
| F07 | Uphill | This hunter's `kill` is on a monster one rank above its own | Shown: "Defeat a monster above your rank" | Hidden quest Q04 Prove it again | A HIGHER RANK HAS FALLEN | now |
| F08 | Giant's shadow | The party wins a fight against a boss two or more ranks above its highest-ranked hunter | Hidden | Title T59 Uneven Trade, to each hunter up at the end | THIS WAS NOT SUPPOSED TO HAPPEN | N6 |
| F09 | The wall | 10 or more `struck` events on this hunter in one won fight, and no `down` | Hidden | Skill R21 Spite | YOU DID NOT MOVE | N2 |
| F10 | Dry well | A won fight ends with this hunter at 0 mana after 5 or more uses that cost mana | Hidden | Mana Potion ×2. Counts toward F24 | NOTHING LEFT TO SPEND | N2 |
| F11 | Walking symptom | This hunter holds 4 or more different harmful statuses at once and is up when the fight is won | Hidden | Title T15 Walking Symptom | YOU SHOULD SEE A HEALER | N2 |
| F12 | Before they moved | A fight of 2 or more foes is won before any foe has had a `turnStart` | Hidden | Title T25 Rude Awakening, to each hunter in it | OVER BEFORE IT STARTED | N2 |
| F13 | The long round | A won fight that lasted 20 rounds or more | Hidden | Title T86 Outlasted, and Stamina Tonic ×2 | YOU OUTLASTED IT | N2 |
| F14 | Not on my watch | A reaction of this hunter's fires before a killing hit on an ally, and the ally is still up after it | Hidden | Title T40 Not on My Watch | NOT ON YOUR WATCH | N2 |
| F15 | Twice, then again | 3 `critDealt` events in 3 uses in a row by this hunter | Hidden | 1 ability point | THE DICE AGREE WITH YOU | N2 |
| F16 | Lightning rod | In a won fight of 5 rounds or more, this hunter took half or more of all damage dealt to its side | Hidden | Title T41 Lightning Rod | THEY ALL CHOSE YOU | N2 |

### 3.2 Across fights

Counts are shown with their number once the first one lands ("Monsters defeated: 37 of 100").

| # | Feat | Condition | Hidden | Grants | Window title | Needs |
|---|---|---|---|---|---|---|
| F17 | Ratcatcher | 50 `kill` events on E-rank monsters | Shown | Title T07 Ratcatcher | SOMEONE HAS TO | N1 |
| F18 | A kind of expert | 100 `kill` events on monsters of one type (Humanoid, Beast, Insect, Construct, Demon, Giant) | Shown, one count a type | That type's title, T34 to T39 | YOU KNOW HOW THEY DIE | N1 |
| F19 | Red ledger | 10 bosses defeated in fights this hunter was up at the end of | Shown | Title T48 Red Ledger | TEN NAMES CROSSED OUT | N1 |
| F20 | Sharp eye | 100 `critDealt` events | Shown | Title T30 Sharp Eye | YOU SEE WHERE IT IS SOFT | N1 |
| F21 | Cold reader | 100 `avoided` events | Shown | Title T32 Cold Reader | YOU SAW IT COMING | N1 |
| F22 | Hex ledger | 100 harmful statuses put on foes by this hunter's uses | Shown | Title T33 Hex Ledger | EVERY CURSE IS COUNTED | N1 |
| F23 | Field medic | 500 HP healed on allies, in fights | Shown | Title T17 Field Medic | THEY WALKED OUT BECAUSE OF YOU | N1 |
| F24 | Empty well | 10 won fights ended at 0 mana | Hidden | Title T50 Empty Well | THE WELL GOT DEEPER | N1 |
| F25 | Stonewall | 200 `struck` events, counted only in fights this hunter ended up | Shown | Title T31 Stonewall | TWO HUNDRED BLOWS LATER | N1 |
| F26 | The anvil | This hunter went `down` in 5 fights its side still won | Hidden | Title T52 The Anvil | THEY WON OVER YOUR BODY | N1 |
| F27 | Clean sheet | 10 fights won in a row with no `down` on this hunter | Hidden | Title T81 Clean Sheet | TEN FIGHTS, NO FALLS | N1 |
| F28 | Four figures | 1,000 `kill` events | Shown after 100 | Title T65 Four Figures and 3 ability points. Strong on purpose: an A-rank reward | ONE THOUSAND | N1 |
| F29 | Never blocks | 10 won fights in which this hunter dealt the most damage on its side and ended under half HP | Hidden | Title T55 Never Blocks (a drawback title) | DEFENSE IS A RUMOR | N1, N2 |
| F30 | On your feet | 10 times, this hunter's heal brought a down ally back up | Shown | Title T56 On Your Feet | GET UP. AGAIN | N1 |
| F31 | Field naturalist | A `kill` on 5 different monster types | Hidden | Hidden quest Q11 Hunter's census | THE SYSTEM IS TAKING NOTES | N1 |

### 3.3 Solo runs and gates

| # | Feat | Condition | Hidden | Grants | Window title | Needs |
|---|---|---|---|---|---|---|
| F32 | First through the gate | The first gate this hunter was in a settled fight of (`Gate.fought`), or its first solo run `won` | Shown | Title T02 First Through the Gate | YOUR FIRST GATE IS CLOSED | now |
| F33 | Alone, once | The first solo run with outcome `won` | Shown | The rule title "The One Who Hunts Alone" (key `hunts-alone`), which exists today | NO PARTY WAS NEEDED | now |
| F34 | Quiet entry | 3 solo runs `won` | Shown | Title T13 Quiet Entry | NOBODY SAW YOU GO IN | N1 |
| F35 | Marathoner | 3 solo runs `won` with no long rest between the first and the third | Hidden | Title T29 Marathoner | THREE GATES, NO SLEEP | N3 |
| F36 | Long odds | A solo run `won` whose odds of winning, worked out at entry, were under 25% | Hidden | Title T28 Long Odds and 1 ability point | THE NUMBERS WERE WRONG | N3 |
| F37 | In and out | A solo run `won` in 3 rounds or fewer, on a gate of the hunter's rank or higher | Hidden | Title T43 In and Out | THE GATE BARELY OPENED | now |
| F38 | By a thread | A solo run `won` with the hunter `up` at 5% of max HP or less after it | Hidden | Greater Health Potion ×1 and 1 ability point | YOU WALKED OUT. BARELY | now |
| F39 | Unfinished business | A solo run with outcome `stalled` | Hidden | Hidden quest Q05 Unfinished business | THE GATE IS STILL OPEN | now |
| F40 | Trespasser | A solo run `won` on a gate one rank or more above the hunter's rank | Hidden | Title T42 Trespasser | YOU WERE NOT INVITED | now |
| F41 | Gate warden | A gate is cleared on the last world day before its break day, and this hunter fought it | Hidden | Title T47 Gate Warden | CLOSED WITH A DAY TO SPARE | now |
| F42 | Regular | 10 gates cleared (fought or solo) | Shown | Title T82 Regular | THEY KNOW YOU AT THE GATE | N1 |
| F43 | Gate closer | 100 gates cleared | Shown after 10 | Title T62 Gate Closer | ONE HUNDRED GATES | N1 |
| F44 | Alone at the top | A solo run `won` on an S-rank gate | Hidden | Title T66 Alone at the Top. GM decides: a Resurrection Crystal with it | THERE IS NO ONE ABOVE YOU | now |
| F45 | Clear the board | The hunter holds the most personal gates it may (`RULES.solo.held`, 3) and wins all of them within one day | Hidden | Item R16 Blank Gate Key | THE BOARD IS EMPTY | N3 |
| F46 | Do not disturb | 3 personal gates in a row close without the hunter entering any | Hidden | Title T11 Do Not Disturb (a joke, no bonus) | THE SYSTEM KNOCKED. THREE TIMES | N3 |
| F47 | Tourist | 3 solo runs with outcome `stalled` | Hidden | Title T23 Tourist (a joke) | YOU SAW THE SIGHTS | N1 |
| F48 | Stood at the break | This hunter is up at the end of a won fight in a gate whose status is broken | Hidden | Title T64 Stood at the Break | THE BREAK STOPPED HERE | now |

### 3.4 Dailies, streaks and the penalty

| # | Feat | Condition | Hidden | Grants | Window title | Needs |
|---|---|---|---|---|---|---|
| F49 | Early riser | `daily.streak` reaches 7 | Shown | Title T03 Early Riser, and hidden quest Q03 The quiet week | SEVEN DAYS | now |
| F50 | Iron routine | `daily.streak` reaches 30 | Shown after F49 | Title T14 Iron Routine | THIRTY DAYS | now |
| F51 | Hundred mornings | `daily.streak` reaches 100 | Shown after F50 | Title T49 Hundred Mornings. GM decides: hidden quest Q18 A crystal's worth | ONE HUNDRED MORNINGS | now |
| F52 | A year of mornings | `daily.streak` reaches 365 | Shown after F51 | Title T60 A Year of Mornings and 3 ability points | A YEAR. EVERY DAY | now |
| F53 | So close | The rollover resets a streak that stood one day short of a bonus day (6, 13, 20 and so on) | Hidden | Stamina Tonic ×1. No title. The window is the reward | ONE DAY SHORT | now |
| F54 | Late fee | 5 times, the last daily of the day was completed in the final hour before the reset | Hidden | Title T22 Late Fee (a joke) | CUTTING IT CLOSE. AGAIN | N4 |
| F55 | First light | 3 days in a row, every daily was done within an hour after the reset | Hidden | Hidden quest Q10 Night watch | THE SYSTEM NOTICED THE HOUR | N4 |
| F56 | Returned customer | 3 Penalty Zone quests completed | Hidden | Title T21 Returned Customer | THE ZONE REMEMBERS YOU | N1 |
| F57 | Marked by the zone | The days of all this hunter's penalties add up to 10 | Hidden | Title T54 Marked by the Zone (a drawback title) | THE ZONE LEFT A MARK | N1 |
| F58 | Reformed | A streak of 14 that began after a penalty was lifted | Hidden | Title T26 Reformed | THE DEBT IS FORGOTTEN | N4 |
| F59 | A full day | On one day: every daily done, a gate cleared and a level gained | Hidden | Boon R37 Excused Absence | NOTHING LEFT UNDONE | N4 |
| F60 | Runs on fumes | A daily is completed while the hunter's fatigue is 80 or more | Hidden | Title T44 Runs on Fumes (a drawback title) | REST WAS AN OPTION | now |

### 3.5 Death, near-death and coming back

No feat here revives anybody. A dead hunter earns a feat only after the GM's Revive or a Resurrection Crystal brought it back.

| # | Feat | Condition | Hidden | Grants | Window title | Needs |
|---|---|---|---|---|---|---|
| F61 | Unwritten | A death save of 20 puts this hunter up at 1 HP, and its side wins that fight | Hidden | Title T46 Unwritten | THE ENDING WAS CHANGED | N2 |
| F62 | Two down, three up | The hunter reaches 2 failed death saves and then becomes stable or gets up | Hidden | Boon R41 Toll Coin | IT WAS NOT YOUR TURN | now |
| F63 | Hard to finish | Stable by three successes in 3 different fights | Hidden | Title T72 Hard to Finish | YOU KEEP NOT DYING | N1 |
| F64 | Rounding error | A hit leaves this hunter at exactly 1 HP | Hidden | Title T10 Rounding Error (a joke, +1 max HP) | ONE | N2 |
| F65 | Borrowed time | The life machine's `revive` event, by a Resurrection Crystal | Hidden | Title T51 Borrowed Time (a drawback title), and hidden quest Q01 What was borrowed | YOU OWE THE SYSTEM | now |
| F66 | Second death owed | The life machine's `revive` event, by the GM's Revive | Hidden | Hidden quest Q17 Back where it happened | YOU HAVE BEEN RETURNED | now |
| F67 | Humbled | The hunter dies or goes down in a gate two or more ranks below its own | Hidden | Title T45 Humbled (a drawback title, and a joke) | THAT WAS AN E-RANK GATE | now |
| F68 | Reads the fine print | Level 20 reached with no `down` on record | Hidden | Title T83 Reads the Fine Print | NOT ONE FALL | N1 |
| F69 | Unbroken | Level 70 reached with no death on record | Hidden | Title T67 Unbroken. Strong on purpose: an S-rank title | NEVER ONCE | N1 |
| F70 | Right on time | A level gained in a fight restores a hunter that stood at 10% of max HP or less (`levelUpRestore`) | Hidden | 1 ability point | THE SYSTEM WAS WATCHING THE CLOCK | N2 |

### 3.6 The party and the room

| # | Feat | Condition | Hidden | Grants | Window title | Needs |
|---|---|---|---|---|---|---|
| F71 | Door holder | A won fight ends with this hunter the only one of its side up, and 1 or 2 allies down | Hidden | Title T19 Door Holder | SOMEONE HAD TO STAY UP | N6 |
| F72 | Carried them out | The same, with 3 or more allies down | Hidden | Title T61 Carried Them Out | YOU CARRIED ALL OF THEM | N6 |
| F73 | Team photo | A boss of the party's rank or higher is defeated and no hunter went `down` in that fight | Hidden | Title T84 Team Photo, to every hunter in it | EVERYONE IS IN THE PICTURE | N6 |
| F74 | The usual party | The same 3 or more hunters appear together in `Gate.fought` for 10 gates | Hidden | Title T57 The Usual Party, to each | THE SAME FACES AGAIN | N6 |
| F75 | Carry them home | An ally dies in a fight this hunter ends up in | Hidden | Hidden quest Q02 Carry them home | ONE OF YOU DID NOT COME BACK | N6 |
| F76 | Finishing touch | In a won fight this hunter has 3 or more `kill` events and dealt the least damage of the hunters in it | Hidden | Title T79 Finishing Touch (a joke) | THANK YOU FOR YOUR CONTRIBUTION | N2, N6 |
| F77 | In step | Every hunter in the room completes every daily on the same day, 7 days in a row | Hidden | 1 ability point to each | THE WHOLE ROOM, SEVEN DAYS | N6 |
| F78 | Open hand | 10 items given to other hunters (waits for feature 5, trading) | Shown | Title T85 Open Hand | YOU GAVE IT AWAY | N6 |

### 3.7 Odd and secret ones

All hidden. These are the ones a table finds by accident and talks about.

| # | Feat | Condition | Grants | Window title | Needs |
|---|---|---|---|---|---|
| F79 | The dice are watching | 3 natural 1s on this hunter's d20 checks in one session | Hidden quest Q16 The System is watching | THE SYSTEM HAS CONCERNS | N5 |
| F80 | Whiplash | A natural 1 and a natural 20 on two checks in a row | Boon R18 Loaded Coin | MAKE UP YOUR MIND | N5 |
| F81 | Called it wrong | 5 coin calls lost | Title T77 Called It Wrong (a joke) | THE COIN DISAGREES | N5 |
| F82 | The System blinks | 5 coin calls won in a row | Boon R19 The System Blinks | THE COIN LIKES YOU | N5 |
| F83 | Exact change | A purchase leaves the hunter with exactly 0 gold | Title T12 Exact Change (a joke) and 1 gold | NOT ONE COIN OVER | N12 |
| F84 | Bench warmer | 3 won fights in which this hunter dealt no damage, healed nothing and put on no status | Title T08 Bench Warmer (a joke) | THANK YOU FOR ATTENDING | N1, N2 |
| F85 | Overdressed | A hunter of C rank or higher wins a solo run on an E-rank gate | Title T20 Overdressed (a joke) | WAS THAT NECESSARY | now |
| F86 | No spare parts | A gate of A rank is cleared and this hunter wore no gear in any of its fights | Title T63 No Spare Parts (a drawback title) | YOU FORGOT SOMETHING | N2 |
| F87 | Pack mule | A fight is won while this hunter's gear weight is over what it can carry without a penalty | Title T06 Pack Mule (a joke) | YOU BROUGHT EVERYTHING | now |
| F88 | Potion sommelier | 25 potions used | Title T09 Potion Sommelier (a joke) | A REFINED PALATE | N1 |
| F89 | Floor inspector | 10 `down` events | Title T24 Floor Inspector (a joke) | THE FLOOR PASSED INSPECTION | N1 |
| F90 | Witness protection | The hunter is renamed 3 times | Title T75 Witness Protection (a joke, no bonus) | WHO ARE YOU TODAY | N1 |
| F91 | Seller's remorse | A legendary or mythic item is sold to the shop | Title T76 Seller's Remorse (a joke, no bonus) | NO REFUNDS | N12 |
| F92 | Paid in full | A Resurrection Crystal is bought at the shop's full price | Title T58 Paid in Full | THE PRICE WAS THE PRICE | N12 |
| F93 | Decorated | The hunter holds 10 titles | Title T74 Decorated | YOU ARE RUNNING OUT OF WALL | now |
| F94 | The System's mistake | The hunter has earned 25 hidden feats | Title T68 The System's Mistake. Strong on purpose: an S-rank title | THIS WAS NOT PLANNED FOR | now |
| F95 | Kept every promise | 100 quests completed and none ever failed | Title T69 Kept Every Promise | EVERY ONE OF THEM | N1 |
| F96 | Summit | The hunter's rank becomes S | Title T70 Summit | THERE IS NO NEXT RANK | now |
| F97 | Rank trial | The hunter's level reaches the level of the next rank (10, 20, 35, 50, 70) | Hidden quest Q09 Rank trial (shown as a quest once issued) | YOU ARE BEING MEASURED | now |
| F98 | Errand runner | 10 side quests completed | Title T05 Errand Runner | THE SYSTEM SENDS ITS THANKS | N1 |
| F99 | Graveside manner | 5 shadows risen by this hunter's extractions (only a job that may extract) | Title T53 Graveside Manner | THEY ANSWER WHEN YOU ASK | N1 |

That is 99 feats: 16 in a fight, 15 across fights, 17 on solo runs and gates, 12 on dailies and the penalty, 10 on death and near-death, 8 for the party and 21 odd ones.

## 4. Titles

A hunter wears one title at a time, and only the worn one's bonus counts. "Band" is the rank at which a hunter usually earns it, and it sets the size of the bonus (section 1). A title marked gmOnly should never come from a feat.

### 4.1 E rank (1 point)

| # | Title | For | Bonus | Description |
|---|---|---|---|---|
| T01 | Still Standing | F01 | hpMax +10 | Walked out of a fight with almost nothing left. |
| T02 | First Through the Gate | F32 | agi +1 | Closed a first gate. |
| T03 | Early Riser | F49 | dis +1 | Finished the daily quest seven days running. |
| T04 | Clean Hands | F02 | agi +1 | Won a fight without being struck. |
| T05 | Errand Runner | F98 | pre +1 | Did ten small things nobody else would. |
| T06 | Pack Mule | F87, a joke with a drawback | str +1, agi -1 | Won a fight carrying far too much. |
| T07 | Ratcatcher | F17 | ins +1 | Defeated fifty E-rank monsters. Someone has to. |
| T08 | Bench Warmer | F84, a joke | hpMax +5 | Was present for three victories. |
| T09 | Potion Sommelier | F88, a joke | vit +1 | Has opinions about potions. |
| T10 | Rounding Error | F64, a joke | hpMax +1 | Lived on exactly 1 HP. |
| T11 | Do Not Disturb | F46, a joke | none | Let three personal gates close unanswered. |
| T12 | Exact Change | F83, a joke | pre +1 | Paid with the last coin owned. |

### 4.2 D rank (2 points)

| # | Title | For | Bonus | Description |
|---|---|---|---|---|
| T13 | Quiet Entry | F34 | ins +2 | Cleared three gates alone. |
| T14 | Iron Routine | F50 | dis +2 | Thirty days without a missed daily quest. |
| T15 | Walking Symptom | F11 | vit +2 | Carried four afflictions at once and won anyway. |
| T16 | Debt Collector | F04 | str +2 | Defeated the monster that put you down, in the same fight. |
| T17 | Field Medic | F23 | pre +2 | Healed 500 HP on allies in fights. |
| T18 | Punching Up | Q04 | str +1, pow +1 | Defeated a higher rank twice, so it was not luck. |
| T19 | Door Holder | F71 | vit +2 | Was the last one up, and won. |
| T20 | Overdressed | F85, a joke | pre +1 | Brought a C-rank hunter to an E-rank gate. |
| T21 | Returned Customer | F56 | dis +1, hpMax +10 | Survived the Penalty Zone three times. |
| T22 | Late Fee | F54, a joke | agi +1 | Finishes the daily quest in the last hour. Every time. |
| T23 | Tourist | F47, a joke | agi +1 | Retreated from three gates. Quickly. |
| T24 | Floor Inspector | F89, a joke | vit +1 | Went down ten times. Knows the floor well. |
| T25 | Rude Awakening | F12 | agi +2 | Won a fight before the other side moved. |
| T26 | Reformed | F58 | dis +2 | Two clean weeks after a penalty. |
| T57 | The Usual Party | F74 | pre +2 | Ten gates with the same faces. |
| T77 | Called It Wrong | F81, a joke | ins +1 | Lost five coin calls. |
| T78 | The Dice Remember | Q16 failed, a joke | dis +1 | Rolled three natural 1s in a session and no 20 to answer them. |
| T79 | Finishing Touch | F76, a joke | ctl +1 | Did the least and got the kills. |
| T82 | Regular | F42 | ins +1 | Cleared ten gates. |
| T84 | Team Photo | F73 | pre +1 | Defeated a boss and nobody went down. |

### 4.3 C rank (2 to 3 points)

| # | Title | For | Bonus | Description |
|---|---|---|---|---|
| T27 | Swarm Breaker | F03 | pow +2 | Defeated three monsters in one turn. |
| T28 | Long Odds | F36 | ins +2, agi +1 | Cleared a gate alone at worse than one chance in four. |
| T29 | Marathoner | F35 | vit +2, hpMax +10 | Cleared three gates alone without a long rest. |
| T30 | Sharp Eye | F20 | ctl +2 | Landed a hundred crits. |
| T31 | Stonewall | F25 | vit +3 | Struck two hundred times and stayed up. |
| T32 | Cold Reader | F21 | agi +2 | Avoided a hundred attacks. |
| T33 | Hex Ledger | F22 | ctl +1, pow +1 | Put a hundred afflictions on foes. |
| T34 | Warren Cleaner | F18, Humanoid | str +2 | Defeated a hundred humanoid monsters. |
| T35 | Off the Leash | F18, Beast | agi +2 | Defeated a hundred beasts. |
| T36 | Exterminator | F18, Insect | ins +2 | Defeated a hundred insects. |
| T37 | Quarry Foreman | F18, Construct | vit +2 | Broke a hundred constructs into gravel. |
| T38 | Uninvited | F18, Demon | dis +2 | Defeated a hundred demons in their own halls. |
| T39 | Tall Order | F18, Giant | str +2 | Defeated a hundred giants. |
| T40 | Not on My Watch | F14 | pre +2 | Stopped a killing hit on an ally. |
| T41 | Lightning Rod | F16 | vit +2 | Took half of everything thrown at the party. |
| T42 | Trespasser | F40 | ins +1, agi +1 | Cleared a gate above your rank, alone. |
| T43 | In and Out | F37 | agi +2 | Cleared a gate alone in three rounds. |
| T44 | Runs on Fumes | F60, a drawback | vit +3, dis -1 | Trained while about to collapse. |
| T45 | Humbled | F67, a drawback and a joke | dis +3, pre -1 | Fell in a gate far below your rank. |
| T56 | On Your Feet | F30 | pre +2 | Got ten downed allies back up. |
| T81 | Clean Sheet | F27 | agi +2 | Ten fights won in a row without going down. |
| T83 | Reads the Fine Print | F68 | dis +2 | Reached level 20 without going down once. |
| T85 | Open Hand | F78 | pre +2 | Gave ten items away. |
| T86 | Outlasted | F13 | vit +2 | Won a fight that ran twenty rounds. |

### 4.4 B rank (3 points)

| # | Title | For | Bonus | Description |
|---|---|---|---|---|
| T46 | Unwritten | F61 | hpMax +30 | Got up on a 20 and won the fight. |
| T47 | Gate Warden | F41 | pre +3 | Closed a gate the day before it broke. |
| T48 | Red Ledger | F19 | str +3 | Stood at the end of ten boss fights. |
| T49 | Hundred Mornings | F51 | dis +2, hpMax +10 | A hundred days without a missed daily quest. |
| T50 | Empty Well | F24 | manaMax +3 | Ended ten fights with no mana left. |
| T51 | Borrowed Time | F65, a drawback | hpMax +50, dis -2 | Died, and came back on a crystal. The body remembers and the nerve does not. |
| T52 | The Anvil | F26 | vit +3 | Went down in five fights the party won. |
| T53 | Graveside Manner | F99 | pre +3 | Raised five shadows. |
| T54 | Marked by the Zone | F57, a drawback | hpMax +40, dis -1 | Spent ten days under penalty. |
| T55 | Never Blocks | F29, a drawback | str +5, vit -2 | Wins hurt. Every time. |
| T58 | Paid in Full | F92 | pre +3 | Bought a Resurrection Crystal at the full price. |
| T72 | Hard to Finish | F63 | hpMax +15 today. NEEDS NEW: advantage on death saves | Stabilized three times without help. |
| T73 | Known Face | GM's gift, for a hunter the Association trusts | pre +2 today. NEEDS NEW: a gate of your rank or lower shows its monsters before you enter | The gate clerks wave you through. |
| T74 | Decorated | F93 | pre +2 today. NEEDS NEW: +1 Presence for every 10 titles held | Holds ten titles. |

### 4.5 A rank (4 points)

| # | Title | For | Bonus | Description |
|---|---|---|---|---|
| T59 | Uneven Trade | F08 | str +2, pow +2 | Stood when a boss two ranks higher fell. |
| T60 | A Year of Mornings | F52 | dis +4 | A year without a missed daily quest. |
| T61 | Carried Them Out | F72 | vit +4 | Won alone with three allies down. |
| T62 | Gate Closer | F43 | ins +4 | Cleared a hundred gates. |
| T63 | No Spare Parts | F86, a drawback | agi +6, hpMax -20 | Cleared an A-rank gate wearing nothing. |
| T64 | Stood at the Break | F48 | pre +4 | Won a fight in a broken gate. |
| T65 | Four Figures | F28 | str +2, ctl +2 | Defeated a thousand monsters. |
| T71 | Haggler | GM's gift, or a quest from a shopkeeper | pre +2 today. NEEDS NEW: shop prices 10% lower, sales pay 60% | Never paid the first price. |

### 4.6 S rank (5 points and more)

These are deliberately strong. Each is earned once in a campaign, if ever.

| # | Title | For | Bonus | Description |
|---|---|---|---|---|
| T66 | Alone at the Top | F44 | agi +5 | Cleared an S-rank gate alone. |
| T67 | Unbroken | F69 | vit +5, hpMax +50 | Reached level 70 and never died. |
| T68 | The System's Mistake | F94 | ins +3, dis +3 | Earned 25 feats the System never announced. |
| T69 | Kept Every Promise | F95 | pre +5 | Completed a hundred quests and failed none. |
| T70 | Summit | F96 | hpMax +50, manaMax +3 | Reached S rank. |
| T80 | The Last Word | GM's gift only (gmOnly), for the hunter who ends the campaign's final fight | pow +5, str +3 | Ended it. |

### 4.7 No band (jokes with no bonus)

| # | Title | For | Bonus | Description |
|---|---|---|---|---|
| T75 | Witness Protection | F90 | none | Changed names three times. |
| T76 | Seller's Remorse | F91 | none | Sold something that cannot be bought back. |

That is 86 titles. Drawback titles: T06, T44, T45, T51, T54, T55, T63. Jokes: T06, T08 to T12, T20, T22 to T24, T45, T75 to T79.

## 5. Unique rewards

Each says what it is in the game's own terms, why a table cares, and how it is given. "Expressible today" means a GM can build it now in a maker. Check each against the maker before shipping it as a seed: the op names are from `effect-ops.ts`, read today, and a bound may have moved.

### 5.1 Around the Resurrection Crystal

The ruling: the way back is the GM's Revive or a Resurrection Crystal, an item. None of these revives by itself. Each is a way to earn a crystal, a lesser crystal, or the cost of having used one. The GM decides which exist in a campaign.

- **R01 Crystal Splinter** (item, material, epic). A piece of a crystal. It does nothing alone. The GM trades five for one Resurrection Crystal. Why: a crystal becomes something a party builds toward across five gates, and every splinter in a loot list is news. How: B-rank and higher gate loot, a boss's loot list, the reward of Q02. Expressible today as a material. Combining five needs the GM's hand (N10).
- **R02 Cracked Resurrection Crystal** (item, consumable, legendary, `revive: true`). It brings a dead hunter back, and the hunter returns with the status R03 Fractured. Why: a cheaper crystal with a price that lasts, so the party argues over who gets the whole one. How: A-rank gate loot, a quest reward, the shop at 30,000 gold. The revive is expressible today. Putting the status on in the same use is N10. Until then the GM puts Fractured on by hand.
- **R03 Fractured** (status, lasts until removed). `stat` ops: Vitality -4 and Discipline -4. Why: a hunter back from a cracked crystal is visibly not whole, and removing it is a quest (Q17). How: R02 puts it on, or the GM does after any revive the story says went badly. Expressible today.
- **R04 Association Escrow** (boon). Text: "The Association holds one Resurrection Crystal for you at 100,000 gold. Pay any amount toward it at any time. It is yours when paid." Why: a 100,000 gold price is unreachable as one purchase and a fine thing to chip at. How: a title's bundle, or a quest from the Association. Expressible today as a boon the GM keeps the count for. Automating it is N10.
- **R05 What Was Borrowed** (hidden quest Q01, with title T51). The debt for using any crystal. See Q01. Why: a crystal is never the end of a death, only the start of the next thing. How: feat F65.
- **R06 Mourning Band** (item, accessory, rare, given to each ally who was up when a hunter died). Worn status: a trigger on `down` of the bearer, once a fight, that heals allies within 2 tiles for 2d6 at B rank. Why: the party wears the death, and it does something the next time one of them falls. How: feat F75's bundle, beside Q02. Expressible today (an item's `worn` status with a trigger).
- **R07 Crystal Dust** (item, consumable, rare, 1,500 gold). Used on a hunter who is down and making death saves: that hunter becomes stable. It does nothing for the dead. Why: it is the crystal's small cousin and makes the real one feel rarer. How: the shop, C-rank loot. Stabilizing by an item is N10. Today only the GM stabilizes, so until then it is a boon the GM honors.
- **R08 A Second Name** (boon). Text: "You may use a Resurrection Crystal from your bag on another hunter." Why: today a dead hunter's own phone uses its own crystal, so this makes one hunter the party's keeper of the crystal, a role in the fiction. How: a Healer's job quest, the title T53's bundle. N10 to automate. Feature 5 (trading) may cover it.

### 5.2 Items

- **R09 Ledger Ring** (accessory, rare). Worn status: on `kill`, heal the bearer 1d6 (by rank). Why: it pays the hunter who finishes foes, so the party talks about who gets the last hit. How: C-rank loot, F19's bundle. Expressible today.
- **R10 Coward's Boots** (armor, feet, uncommon). Worn status: on `struck`, once a fight, the bearer is Hasted for 1 round. Why: the first hit of every fight is a free retreat or a free charge, and the name dares the player to wear them. How: D-rank loot, the title T23's bundle. Expressible today.
- **R11 Glass Fang** (weapon, epic, dice two steps above its rank's). Worn status: `share` on `taken`, +15%. Why: the best damage at its rank and the wearer takes more of everything. How: a hidden gate's loot (R35). Expressible today.
- **R12 Hourglass Sand** (consumable, epic, 3,000 gold). Its use gives the `extra` op: one more action now. Why: one use, saved for the turn that decides the fight. How: B-rank loot, never the shop. Expressible if an item's effects take `extra` (check the item maker).
- **R13 White Flag** (consumable, uncommon). Puts a status on the user for 1 round: `untargetable`, with `hold`. Why: it saves a life at the cost of a turn, and waving it in front of a boss is a table moment. How: the shop at 400 gold. Expressible today.
- **R14 Lantern of the Last Room** (accessory, rare). Worn status: `alert`, so hidden foes near the bearer are seen. Why: it changes who walks in front. How: loot of a gate whose monsters hide. Expressible today.
- **R15 Tin Whistle** (consumable, uncommon). Its use puts `taunt` on the user for 2 rounds and a `shield` of 2d8. Why: anyone can be the tank for one round, at a price. How: the shop at 250 gold. Expressible today.
- **R16 Blank Gate Key** (item, material, epic, `tell: true`). Used, it tells the GM, who opens one personal gate of the hunter's rank at once. Why: the player chooses when the next gate comes, so they can stack it with a quest. How: feat F45. Expressible today with the GM's hand. Opening the gate by itself is N3.
- **R17 Black Envelope** (item, consumable, rare, `tell: true`). A hidden quest not yet opened. Used, it tells the GM, who issues the quest written for it. Why: a quest as loot. The party can hold it, argue over who opens it, and open it at the worst time. How: any loot list, a title's bundle. Expressible today.
- **R18 Loaded Coin** (boon). Text: "Once, when the coin is called for you, you choose the side it lands on." Why: it uses the coin call the game already has and turns a natural 1 into a story. How: feat F80. Expressible today as a boon.
- **R19 The System Blinks** (boon). Text: "Once, after you see a d20 you rolled, roll it again and keep the second." How: feat F82, Q16's reward. Expressible today as a boon.
- **R20 Borrowed Sleep** (consumable, rare). `fatigue` op: removes all fatigue. It also puts on R29 Gate Sickness until the next long rest. Why: a third gate today, paid for tomorrow. How: the shop at 600 gold, F35's bundle. Expressible today.
- **R31 Heirloom Whetstone** (item, material, legendary). The GM raises one weapon's dice by one step (1d8 to 1d10) and the stone is spent. Why: a player keeps the weapon they named instead of replacing it. How: an A-rank boss's loot. The GM edits the item today. An upgrade step in the app is N10's neighbor and is listed under N7 as "an item that changes another item".
- **R35 Map Fragment** (item, material, rare). Three make a hidden gate: the GM spawns a gate one rank above the holder, marked solo, with loot one rank better. Why: a collection the whole party contributes to and one hunter cashes in. How: any gate's loot, 1 in 10. Expressible today with the GM's hand. See Q18b in section 6.
- **R44 Bounty Tag** (item, material, uncommon, sells for the monster's XP in gold). Dropped by a named monster the GM marked. Why: a reason to hunt one monster on purpose. How: the monster's loot list. Expressible today.
- **R45 First Trophy** (item, material, rare, sells for 1 gold). The hunter's first boss, as an object with the boss's name in its description. It does nothing. Why: players keep it for the whole campaign, and F91-style jokes follow anyone who sells it. How: the first boss `kill`. Expressible today.

### 5.3 Skills

- **R21 Spite** (passive skill, with a worn stacking status). Stacks to 5. One stack on each `struck`. Each stack: `stat` Strength +2. All leave when the bearer deals a hit (`leave: hitDealt`). Why: the hunter wants to be hit before swinging, so the turn order matters to them. How: feat F09. Expressible today (kits design 1.2).
- **R22 Second Verse** (passive skill, worn status). A trigger on the bearer's `down`, once a fight: heal allies within 2 tiles (the `area` reach on `allies`). Why: going down stops being only a loss. How: Q14's reward. Expressible today.
- **R23 Executioner's Patience** (passive skill, worn stacking status). Stacks to 4. One stack at each `turnEnd`. Each stack: `sheet` op `critSize` up. All leave on `hitDealt`. Why: it pays for waiting, so the hunter passes a turn on purpose. How: Q13's reward. Expressible today.
- **R24 Final Notice** (active skill, a strike). A `uses` gate of 1 a long rest, and the execute scaler (more damage the lower the target's share of HP, `scalers.ts`). Why: one use a day, so the party sets it up. How: feat F06. Expressible today.
- **R25 Not Today** (active skill, a reaction). Armed ahead. It fires before a killing hit on the bearer (`ReactWhen`) and lands `negate`. A `uses` gate of 1 a long rest. Strong on purpose: A rank. Why: the player decides at the start of each fight whether to arm it. How: T46's bundle, or a GM's gift after a near death. Expressible today.
- **R26 Stand-in** (active skill, a reaction). Fires before a use lands on an ally within 2 tiles and puts `guard` on that ally, share 50%, for that use. Why: the tank's skill for a hunter who is not a tank. How: F14 or F71's bundle. Expressible today.
- **R27 Echo of the First** (active skill with `Ability.summon`). A timed summon, 3 rounds, of a weaker copy of the first boss the hunter defeated. A `uses` gate of 1 a fight. Why: every hunter's is a different monster, and it is the one they already tell stories about. How: the GM builds it per hunter at B rank. Expressible today, one skill a hunter.
- **R28 Blood Tithe** (active skill, a strike). An HP `Price` of 10% of max HP, and damage one rank above the hunter's. Why: the hunter spends the healer's work to hit harder. How: T55's bundle. Expressible today.
- **R42 The Unlisted Skill** (active or passive skill, its `label` set to "???"). Its description says only "The System has not named this yet." After ten uses the GM renames it and writes what it always did. Why: a mystery the player solves by using it. How: a hidden quest's reward. Expressible today with the GM's edit. Revealing by itself is N8.
- **R43 Small Mercies** (passive skill, worn status). An `aura` of radius 1 on allies with a `heal` each round, 1 at E rank to 4 at S. Why: it rewards standing together and is weak enough to give early. How: T17's bundle. Expressible today.

### 5.4 Statuses

A status a reward gives with `rounds: null` stays on the sheet until removed.

- **R29 Gate Sickness** (status, until the next long rest). `stat` Discipline -4 and `speed` -10%. Why: the cost of pushing through gates without rest (R20, Q05). Expressible today. Ending at a long rest by itself is N11.
- **R30 Marked by the System** (status, permanent, a trade). `edge` on `attack`, keep `better`, and `threat` up. The bearer aims better and every monster comes for it first. Why: it changes where the hunter stands in every fight. How: a title's bundle at C rank, or a GM's gift. Expressible today.
- **R32 Momentum** (status, 3 rounds, given at a 7-day streak). `speed` +20%. Why: the first fight after a clean week starts fast. How: beside F49. Expressible today.
- **R33 Hunted** (status, permanent until its quest ends, no ops, a `note`). "Something from the last gate is following you." The GM adds one named monster to the hunter's next gates until it is defeated. Why: a recurring foe with a name. How: Q06. Expressible today as a note.
- **R34 Shared Pulse** (a pair of statuses, one on each of two hunters). Each holds `guard` for the other, share 25%, while within 3 tiles. Why: two players plan their movement together. How: Q14, or the GM for two hunters who keep saving each other. Expressible today.
- **R36 Overdue** (status, until a Penalty Zone quest is done). `stat` Presence -4. Why: a heavier penalty the GM can add for a second miss in a week. How: the GM's hand. Expressible today.
- **R46 Grudge** (status, permanent until used). `boost` on `attack`, a held d6, spent on the next attack against the monster type that last put the hunter down. Why: a small promise that the next one goes better. How: beside F89 or after any `down`. The held die is expressible today. Tying it to a monster type is N7.

### 5.5 Boons and other gifts

A boon is text the GM honors, so each of these works today.

- **R37 Excused Absence** (boon). "The GM deletes one Penalty Zone quest of yours." The GM's delete already lifts the penalty. Why: a streak saver the player chooses when to spend. How: feat F59.
- **R38 Double or Nothing** (boon). "Before a gate, declare it. If nobody in the party goes down, its gold is doubled. If anybody does, the gate pays no gold." Why: the whole party votes on one hunter's boon. How: Q12, F73.
- **R39 Naming Rights** (boon). "Name the next gate the GM spawns, or one monster in it." Why: free, and players remember the gate they named. How: any feat that needs a small reward.
- **R40 Blank Title** (boon). "Write a title for yourself. The GM gives it +2 on one stat." Why: the best title names come from the table. How: T74's bundle.
- **R41 Toll Coin** (boon). "Once, turn one failed death save into a success." Why: it is spent at the most tense roll in the game. It saves nobody who is already dead. How: feat F62.
- **R47 Respec Writ** (boon). "One respec at no gold." A respec costs 5 gold times level squared today. How: a rank trial's reward (Q09).
- **R48 Rank Writ** (boon). "The GM raises your rank one step when you next ask, whatever your level." Strong on purpose: a B-rank reward at the least. Why: rank is the game's social fact, and holding an unspent writ is a decision. How: a campaign's big quest.
- **R49 Association Favor** (boon). "One shop item at half price." How: T71's bundle, Q11.
- **R50 A Seat at the Table** (boon). "Ask the GM one question about the next gate. The answer is true." Why: information as a reward costs the game's balance nothing. How: T73's bundle, Q10.
- **R51 Unsigned Contract** (boon). "Skip one step of a Job Change chain." Strong: C rank and above. How: a hidden quest tied to the job.

That is 51 rewards. The R numbers are not in order within a group because the groups were made after the numbering.

## 6. Hidden quests the System issues

A quest's failure cost today is its `penaltyText`, words the GM honors, and an urgent quest's due time. A cost the app applies by itself is N9.

| # | Quest | Issued when | Objectives | Reward | Failing costs |
|---|---|---|---|---|---|
| Q01 | What was borrowed | F65: a Resurrection Crystal brought the hunter back | Clear 5 gates of your rank or higher. Due in 14 days | The drawback of T51 is removed (the GM edits the title to hpMax +30) and 2 ability points | The title stays as it is, and R36 Overdue until the next gate is cleared |
| Q02 | Carry them home | F75: an ally died in a fight you ended up in | Clear 3 gates of the fallen hunter's rank. Due in 7 days. Every hunter who holds the quest shares the count | Crystal Splinter ×5 to the party (one crystal's worth). GM decides | Nothing is taken. The quest ends and the window says so |
| Q03 | The quiet week | F49: a 7-day streak | Keep the streak 7 more days and win 1 solo run in them | 2 ability points and R32 Momentum | Nothing beyond the lost streak |
| Q04 | Prove it again | F07: defeated a monster one rank above | Do it again within 3 days | Title T18 Punching Up | Nothing. The log says "Once was luck." |
| Q05 | Unfinished business | F39: a solo run stalled | Win a solo run on a gate of that rank or higher within 24 hours | That gate's XP again as a bonus | R29 Gate Sickness |
| Q06 | The one that got away | A fight ends with a boss still standing and the party up | Defeat that monster. No due time | Its loot list rolled twice | Until it is done the hunter holds R33 Hunted, and the monster returns as an elite |
| Q07 | Empty hands | A gate is cleared and this hunter used no consumable in it | Clear 3 gates in a row with no consumable used | Item R09 Ledger Ring | Nothing. Using a consumable resets the count |
| Q08 | The long shift | F56 is one short: a second Penalty Zone quest is issued | Survive 8 hours, not 4 | 1 ability point and the title T21 early | The penalty stays as any other |
| Q09 | Rank trial | F97: the level of the next rank is reached | Clear one gate of the new rank. The GM says whether alone | The rank (the GM's reevaluate), and R47 Respec Writ | Nothing. It may be tried again after a long rest |
| Q10 | Night watch | F55: dailies done in the first hour, 3 days running | Win 1 solo run within an hour of the reset, on 3 different days | Boon R50 A Seat at the Table and 1 ability point | Nothing |
| Q11 | Hunter's census | F31: 5 monster types defeated | Defeat one monster of every type in the bestiary | Boon R49 Association Favor and 2 ability points | Nothing. No due time |
| Q12 | The wager | A coin call is won | Win your next solo run without dropping under half HP | Boon R38 Double or Nothing | The next gate's gold is halved |
| Q13 | One tool | A fight is won in which this hunter used only its weapon's attack | Win 3 fights using only your weapon's attack | Skill R23 Executioner's Patience | Nothing. Any other ability resets the count |
| Q14 | Guardian's due | An ally goes down within 1 tile of this hunter while it is up | In your next 3 fights, no ally goes down | Skill R22 Second Verse, or R34 Shared Pulse with that ally | Nothing. An ally going down resets the count |
| Q15 | Break day | A gate this hunter has fought in is 1 world day from its break day | Clear it before it breaks | Title T47 Gate Warden | The gate breaks, as it would |
| Q16 | The System is watching | F79: 3 natural 1s in a session | Roll a natural 20 before the session ends | Boon R19 The System Blinks | Title T78 The Dice Remember. It is a joke and it has a bonus, so failing is fine |
| Q17 | Back where it happened | F66: the GM's Revive brought the hunter back | Clear a gate of the rank that killed you | R03 Fractured is removed if held, and Greater Health Potion ×2 | Nothing. No due time |
| Q18 | A crystal's worth | F51: a 100-day streak. GM decides | Keep the streak to 130 and clear a gate of your rank alone | Crystal Splinter ×5. GM decides | The splinters are not given. The streak's own titles stay |
| Q18b | The gate nobody mapped | The hunter holds 3 Map Fragments (R35) | Enter the hidden gate alone | Its loot, one rank better than the gate's | The fragments are spent either way |

## 7. What the game cannot express yet

Ordered by how many entries above need each. The counts are of the feats (99), titles, rewards (51) and quests (19) that name the code.

| # | Capability | What it is | Entries |
|---|---|---|---|
| N1 | A tally on the hunter | Counts kept across fights and days: `kill` by rank, type and kind, `critDealt`, `avoided`, `struck`, `down`, statuses put on, HP healed on allies, potions used, gates cleared, quests done and failed, penalty days, renames, "in a row" counts that a failure resets. One generic counter keyed by a name covers all of them | 31 feats |
| N2 | A fight's summary for each row | Facts of one fight read at its end: lowest HP share, times struck, damage dealt and taken, kills by turn, statuses held at once, mana at the end, whether it went down and by whom, the rounds, gear worn, abilities used | 21 feats |
| N6 | Facts about the party and the room | Who else was in the fight and how each ended, the same hunters across `Gate.fought`, a feat given to every hunter in a fight, every hunter's dailies on one day, an item given to another hunter (feature 5) | 9 feats, 2 quests |
| N10 | Crystal variants | A revive item that also puts a status on, an item that stabilizes, a crystal used on another hunter, five splinters that become a crystal, a price paid in parts | 5 rewards |
| N5 | The dice log as facts | Natural 1s and 20s by session and in a row, coin calls won and lost. `RollEntry` holds the roll. Nothing counts them | 4 feats, 1 quest |
| N4 | The clock as facts | The hour a daily was completed, the day a penalty was lifted, several things on one day | 4 feats |
| N3 | A solo run's facts kept | The odds at entry stored with the run, long rests timestamped so "without a rest between" can be read, personal gates that closed unentered, a gate opened by an item | 4 feats, 1 reward |
| N7 | A title or status that does more than add to a stat | A title with a worn status, advantage on death saves, a shop price change, a bonus that counts something the hunter holds, a held die tied to a monster type, an item that changes another item | 4 titles, 2 rewards |
| N8 | A quest that counts by itself | Objectives the tally moves, a quest issued by a feat with no GM tap, a reward revealed later. Today `setProgress` is a person's tap | all 19 quests work better with it, 1 reward |
| N12 | Shop facts | Gold after a purchase, what was sold and bought and at what price | 3 feats |
| N9 | A failure cost the app applies | A status, a gold loss or a title on a quest's failure. Today it is `penaltyText` | 5 quests |
| N11 | A reward that takes away | A title's drawback removed, a status ended by a quest or a long rest | 2 quests, 1 reward |

What works with nothing new once the feat engine exists: 26 feats marked `now` (streaks, level, rank, solo outcomes, life events, break days, fatigue), every title but four, and 41 of the 51 rewards.

A suggestion on order, for the builder to weigh: N1 and N2 together unlock 50 of the 99 feats and are one design (a tally the fight's end writes into, in the same write as the fight's write-back). N8 follows from N1 at little cost.

## 8. Sources

"Search" means the web search's summaries of guides and wikis were read this session. "Memory" means no page was reached and the note is from what the writer already knew. No page was fetched whole.

| Source | How read | The one thing taken |
|---|---|---|
| Solo Leveling (web novel and comic) | Memory. The search found nothing useful | The System is cold and fair, a hidden condition is revealed only by meeting it, and a missed daily is punished with something survivable |
| Dungeon Crawler Carl (novels) | Search | An announcer that mocks the feat it rewards, and achievements whose reward is "none". The joke titles and F53 come from that feeling |
| Omniscient Reader's Viewpoint (web novel) | Search, thin. Mostly memory | Someone is watching and pays for a good story. Hence rule 1, and feats that reward the retellable moment |
| The Wandering Inn (web serial) | Search | The system grants what fits what the person has been doing. Hence titles that say how you play, and R42, a skill named after its use |
| He Who Fights With Monsters, Cradle, Overgeared, The Beginning After the End | Memory | Progress is gated by a trial at each rank, not by a number alone (Q09). A title can be an embarrassment its holder keeps |
| World of Warcraft, Feats of Strength | Search | A category of feats worth no points, kept only because few have them. Hence titles with no bonus (T11, T75, T76) |
| Baldur's Gate 3, inspiration | Search | Goals that are hidden and tied to who the character is, found by playing in character. Hence rule 2 |
| Darkest Dungeon, quirks | Search | What happens to a hero leaves a lasting mark, good or bad, and a bad one left alone sets in. Hence the drawback titles and R03 |
| Slay the Spire, boss relics | Search | A large upside with a real downside, so taking the reward is the decision. Hence rule 8, R11, R30 |
| Disco Elysium, the Thought Cabinet | Search | A cost first and the benefit after. Hence Q01, where a drawback title is worked off |
| Hades, the list of prophecies and the keepsakes | Search for the list, memory for keepsakes | A shown list of small goals beside hidden ones, and a small worn thing from a person that marks a bond. Hence shown counts, and R06 |
| Monster Hunter, guild card titles | Search | Titles in tiers by hunt count for each kind of monster. Hence F18 and T34 to T39 |
| Dungeons and Dragons 5e, the Dungeon Master's Guide's other rewards | Search | Rewards that are not treasure: a blessing, a charm with uses, a mark of standing. Hence boons that are favors and information (R48 to R50) |
| Dark Souls and Elden Ring | Memory | An item whose description is its whole story, and a way back from death that costs something each time. Hence R45 and the cracked crystal |
| Final Fantasy XIV, titles | Memory. The search returned nothing | A title for doing group content alone, worn as a boast. Hence T66 |
| Path of Exile and Diablo, unique items | Memory | A unique item is a rule change with a cost, not a bigger number. Hence rule 7 |
| Dwarf Fortress | Memory. The search returned nothing | A name earned from what a person did, recorded and never explained. Hence the jokes that are only a record (T10, T24) |
| Pathfinder, hero points | Memory | A single spendable point that turns one roll. Hence R19 and R41 |
