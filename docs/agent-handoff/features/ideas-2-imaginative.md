# Feats, titles and rewards, the second shelf: bolder ones, and awards for the GM to give by hand

Written Nov 18, after the owner read the first shelf (`ideas-feats-titles-rewards.md`) and said: "Meh have it create more, be more imaginative, reading wonderful books and exercising abstract thought. Give me some that I should administer on my own when I see instances of roleplay." This file is ideas only. It changes no code and no rule.

## 1. What is here, and how it differs from the first list

The first list was a good list of things a hunter does: kills, crits, streaks, gates, close calls. It counted what the dice already count. This one looks at what the dice do not count: what a hunter chose not to do, who it did it for, what it promised, what it lost, and what the table felt.

- Section 2: an essay for the owner, "What a title, a feat and a reward can be". Each idea in it points to entries below.
- Section 3: 62 awards for the GM to give by hand when he sees roleplay, sorted by the moment he just saw, then a one-page guide to giving them.
- Section 4: 64 feats the System notices by itself, about restraint, mercy, failure, patience, grief, loyalty, choices not taken and odd coincidences.
- Section 5: 44 titles that change, are shared, can be lost or refused, are inherited, or carry a duty.
- Section 6: 44 rewards that change a decision or a relationship rather than a number.
- Section 7: 13 stories the GM turns on and moves by hand, chapter by chapter (the owner's ruling: stories move only at the GM's pace).
- Section 8: making your own: a blank story and a page of advice.
- Section 9: 18 things the new capabilities would let us do, ranked by how much a table would feel each.
- Section 10: sources.

Ids are this file's own, so they do not collide with the first file: `A` an award, `S` a feat the System notices, `L` a title, `U` a unique reward, `C` a story the GM runs, `X` a forward idea. Where an entry leans on one from the first file it names it (`R19`, `F65`).

### The marks

Every entry in sections 3 to 7 carries one mark (section 7's stories are all GM ONLY today and NEEDS N23 in the app):

- **BUILDABLE TODAY**: the game can do it now. For an award, that means a bundle with its window's words (`RewardBundle.window`, built in unit 1 of feature 1) holding points, XP, gold, an item, a title, a skill, a status or a boon. For a feat, it means every fact it reads is already written into the chronicle (unit 1, `src/core/hunter/facts.ts`) and it waits only for the feat engine (unit 3), which is being built now.
- **NEEDS** a named capability. The first file's numbers are kept: N1 the tally (now the chronicle's tally, built), N2 a fight's summary for each row (unit 2, being built), N3 a solo run's facts kept, N4 the clock as facts, N5 the dice log as facts, N6 facts of the party and the room, N7 a title that does more than add (unit 8 gives a title a worn status), N8 a quest that counts by itself (unit 8), N9 a failure cost the app applies (unit 8), N11 a reward that takes away, N12 shop facts. This file adds:
  - **N13** A System window to the whole room: one message that opens the same window on every phone in the room.
  - **N14** A title that changes: stages, each with its own name and bonus, moved by a count or a fact.
  - **N15** A pair: a title or status that names another hunter and acts only with that one.
  - **N16** An heir: a dead or retired hunter's title, item or quest passed to a named hunter, with the line of holders kept.
  - **N17** A reward that arrives later: sealed, with the clause it carries, until the GM opens it. The System may show the GM a sign that it is ready, and never opens it by itself.
  - **N23** A story the GM runs: chapters with their words, rewards and quests, turned on for the table or a hunter, moved only by the GM's tap, each with an optional ready sign shown on the GM's phone alone (section 7).
  - **N18** A refusal: a player may refuse a feat's title or reward, and the refusal is a fact the System can count.
  - **N19** Facts of what was not done: a foe left standing by choice (`spared`), an extraction not tried, an item held unused for a number of sessions, a session with nothing but dailies.
  - **N20** The GM's own facts at the table: a ledger of promises, sessions run, awards given.
  - **N21** A title kept only while a condition holds: lost, or dimmed to no bonus, when it fails.
  - **N22** More state tests when a fact lands: the session number, unspent ability points, an item held, the worn title, and a count that starts only when its feat is shown.
- **GM ONLY**: the app gives the window and maybe a boon, but what it does lives in the GM's hands and the world's story.

Balance follows the first file's section 1: an E-rank title is 1 point, D and C 2, B 3, A 4, S 5, where 10 max HP or 1 max mana is a point. A small award is at most 1 ability point. A rare award says it is rare.

### Originality

Every name and line below was written for this game. The books and games in section 9 gave shapes only (a bargain with a hidden clause, a gift that must move on, a name that binds, a prophecy that can fail). No entry is one thing from one work with its name changed.

## 2. What a title, a feat and a reward can be

A game that counts will drift toward rewarding what is easy to count. Kills are easy to count. Kindness is not. The first shelf is a fine list of what is easy to count, and the risk of shipping only that list is that the System, which the players will come to treat as a character, turns out to be a scoreboard. The argument of this section is that the System is more interesting as a witness than as a scoreboard, and that a witness rewards different things.

### A title is a name the world gives you

Nobody in a saga picks their own byname. It is given by others, often in mockery, often for one day that the person would rather forget, and it sticks because it is true. A hunter who chooses its title from a menu is wearing a hat. A hunter who is named, and cannot easily take the name off, is wearing a reputation. So some titles here arrive unasked and unwelcome: L30 Unwanted Name is given for a moment of cowardice and only a later act of courage replaces it (A58). Some names are chosen by the table, not the player (A30 Running Gag).

A title can also be a **debt**. The name says you owe something, and the bonus is the advance on it. L24 Owed to the Deep gives strength now and the story C01 collects later, at the GM's pace. A title can be a **mask**: L15 Borrowed Name holds only while the hunter goes by another name, and is lost at the next rename. And a title can be a **prophecy that can fail**. L04 Foretold names a deed the System expects. If the hunter does it, the title becomes Fulfilled. If not, it becomes False Prophecy, and that one is better, because the hunter proved the System wrong (story C02). A System that can be wrong about a hunter is one the players will want to argue with, and arguing with the System is play.

Titles can belong to **two people** (L07 Two Halves of a Coin, L08 Sworn Kin) and to **the dead** (L17 Heir, L19 The Second Bearer). A title that outlives its holder is the cheapest way to make a death in this game matter beyond the sheet: the dead hunter is still named every time the heir's window opens.

### A feat nobody witnessed

The best feats in the old stories are the ones with no audience: the hero who lets an enemy go when nobody would know, the oath kept in an empty room. A System that watches a hunter is the only witness some deeds will ever have, and that is a beautiful thing for a System to be. So this file leans on feats of **restraint** (S01 The unspent hand, S04 Points in the pocket), **mercy** (S07 Left standing, S11 The dead left alone), **patience** (S22 Waited it out), and the **choice not taken** (S41 Declined, S44 Never changed the blade). Their windows say, in effect, "Nobody saw that. The System did." The player is the only one at the table who learns it, unless they choose to tell.

Most of these need facts of what did not happen (N19), and that is the most important new capability in this file. A fact like "the fight ended with a foe spared" or "a corpse that could have been extracted was left" is small to record and opens a whole moral axis the game cannot see today.

### Failure is the richer half

A table remembers the disaster longer than the victory. Pendragon pays a knight for acting on a passion even when it ruins him, and Blades in the Dark pays for a vice or a trauma that causes trouble. The lesson is that a game should pay for a weakness played honestly, not only for a strength used well. So: S12 Bottom of the ladder, S14 Bad day at the board, S17 Forgot the potion. Each pays a little and names the failure plainly. The System is not cruel about it. It is precise, which is worse and funnier.

### Rewards that are not a thing or a number

The most valuable rewards in fairy tales are almost never gold. They are:

- **A permission**: "you may enter", "you may leave", "you may ask". U03 The Unbarred Exit, U09 One Rule Broken.
- **A secret**: knowledge one player has and the others do not. U17 The Marked Gate, U18 The Locked Answer.
- **A question answered truthfully**: U01 The True Answer, and A35 Asked the Question, which turns a player's curiosity about another character into a reward for both.
- **A relationship**: a rival, a debtor, a friend. U11 A Rival Assigned, U12 Marker, U19 Split Token.
- **A place**: U04 A Room Upstairs, a place that is yours, where rest means more.
- **A rule broken once**: U09. One break of the rules, given by the GM, is worth more than any +2, because the whole table will watch for when it is spent.
- **A memory**: U08 Pinned, a moment from the chronicle that never ages out. And its opposite, **something taken away**: U06 Forgotten Fight removes a drawback title and erases the memory of how it was earned. The player decides whether they want to forget.
- **A promise the System makes**: U10 The System's Promise, U34 One True Thing. A promise is a reward the player carries and the System must keep.
- **A cost chosen**: U16 Pick the Price. Three drawbacks offered, one taken, and the choice tells the table who the hunter is.
- **A gift that must move on**: U02 The Passing Lantern, U39 The Rescuer's Coin. A gift that goes dark if kept turns generosity into a rule.
- **A bargain with a clause**: U05 Clause Seven. Three points now, and a clause the GM wrote down and sealed. Every bargain in the old stories has a clause the hero did not read, and the drama is the reading.
- **Something that arrives much later**: U14 The Long Letter, U15 Planted, U35 A Letter from the Dead. A reward sealed for five sessions keeps a player wondering for five sessions. That is a lot of play for the price of a sentence.

### What might a System want?

If the System watches, it might want something. The first file's System is fair and cold, and it should stay cold in its voice. But a cold voice can still have interests. Story C13 The System Grows Curious lets the GM point the System at a hunter whose record does not fit a type (many mercies, few kills), and the System starts asking it questions, one chapter at a time, when the GM opens each. X08 gives the System moods per hunter. The System's wants should never be stated. They should be inferred from what it rewards, the way a player infers a GM's taste. A table that argues about what the System wants is a table that is reading it as a character.

### Who the awards are for

The GM's awards in section 3 are not for the best actor. They are for the moment. A quiet player who says one line that lands should get the same window as a loud player's speech. The guide after section 3 is about that: how to spread them, and how to keep them from becoming a bribe.

## 3. Awards for the GM to give by hand

Each award is a bundle with its window's words, given in two taps from Give… on a hunter's card (`notes-1-feats.md` section 7). Thirty built-in bundles already ship in ten moments (`src/core/registry/bundles.ts`: hard, sacrifice, lie, kindness, speech, silence, owned, spotlight, comic, goodbye). None of their names is repeated here. Seven moments are new: rivalry, running joke, a mind changed, a secret, a promise, mercy and fear. Each is a new member of `MOMENTS` with its words in `MOMENT_WORDS`.

"Boon" is text the GM honors (`BoonGrant`). "Held reroll" is a boon that says "Once, roll one of your d20s again and keep the second roll." Rare and large ones are marked RARE. The window title is the only line in the System's voice. The one plain line of each window is left for the builder to write from the moment's sentence.

### 3.1 Staying in character through something hard

| # | Award | The moment | Gives | Window title | Mark |
|---|---|---|---|---|---|
| A01 | No Seam | The player kept playing the hunter's fear, grief or pride when stepping out of it would have been easier | Boon "No Seam": once, pass one check of fear or despair without rolling | THE SYSTEM COULD NOT FIND THE SEAM | BUILDABLE TODAY |
| A02 | Brought It Home | The hunter carried a wound from an earlier scene into a new one without being asked | 1 ability point | IT CAME WITH YOU | BUILDABLE TODAY |
| A03 | Second Skin | The player answered as the hunter would, against their own interest at the table | Title Second Skin (E, ins +1): "Plays the hunter, not the sheet." | WHICH OF YOU IS SPEAKING | BUILDABLE TODAY |
| A04 | Worn Smooth (RARE) | A trait the player chose (a vow, a phobia, a grudge) was held through a whole arc and cost the hunter in play more than once | Title Worn Smooth (A, dis +2, pre +2) and a passive skill the GM writes for that trait | THE ROLE HAS BECOME THE HUNTER | BUILDABLE TODAY (the GM makes the skill once) |

### 3.2 A sacrifice

| # | Award | The moment | Gives | Window title | Mark |
|---|---|---|---|---|---|
| A05 | Weight Moved | The hunter gave up an item, a share of loot or a chance for someone else | Boon "First Pick": at the next loot roll for your party, take one item before anyone else | A WEIGHT WAS MOVED FROM ONE SIDE TO THE OTHER | BUILDABLE TODAY |
| A06 | The Door | The hunter chose to hold the danger so others could get out | Boon "Doorframe": in your next fight, the GM gives you a shield of twice your level at its start | SOMEONE HAS TO BE THE DOOR | BUILDABLE TODAY |
| A07 | Paid in Advance | The player picked the worse outcome for the hunter on purpose, because the story wanted it | 1 ability point and boon "Credit": once, ask the GM to soften one consequence, and he must | PAYMENT RECEIVED BEFORE DELIVERY | BUILDABLE TODAY |
| A08 | Ash on the Hands (RARE) | A sacrifice that changed the campaign: a crystal given away, a hunter who stayed behind in a breaking gate | Title Ash on the Hands (B, vit +2, pre +1) and boon "One Return": the GM will Revive you once, with no crystal | THE SYSTEM WILL CARRY THIS ONE | BUILDABLE TODAY (the Revive is the GM's, as the ruling says) |

### 3.3 A lie told well

| # | Award | The moment | Gives | Window title | Mark |
|---|---|---|---|---|---|
| A09 | Two Versions | A lie a nonplayer believed, and that half the table believed too | Boon "Stalling Tongue": once, a lie told to a monster that speaks buys a round before it acts | TWO VERSIONS HAVE BEEN LOGGED | BUILDABLE TODAY |
| A10 | Borrowed Face | The hunter passed as someone else for a whole scene | Title Borrowed Face (E, agi +1): "Was someone else for a scene, and nobody asked." | IDENTITY UNCONFIRMED | BUILDABLE TODAY |
| A11 | Every Word True | The hunter deceived using only true statements | 1 ability point | EVERY WORD WAS TRUE | BUILDABLE TODAY |
| A12 | Interest Accrues | A lie so good it will come back | 1 ability point and boon "Interest", with a clause: the GM may once make that lie come true at the worst time | THE LIE HAS BEGUN TO ACCRUE | BUILDABLE TODAY |

### 3.4 A kindness that cost something

| # | Award | The moment | Gives | Window title | Mark |
|---|---|---|---|---|---|
| A13 | A Stranger's Lamp | A kindness to someone who could give nothing back | Boon "A Stranger's Lamp": once in a gate, someone you helped appears with one piece of help the GM picks | A STRANGER HAS YOUR NAME | BUILDABLE TODAY |
| A14 | Mended | The hunter spent its own rest, gold or potion to mend someone else | 1 ability point and Health Potion ×1 | SOMETHING WAS MENDED. THE SYSTEM REPLACED WHAT IT COST | BUILDABLE TODAY |
| A15 | Kindling | Kept others warm and went cold for it, over a whole scene | Title Kindling (E, pre +1) | THE SYSTEM DOES NOT FOLLOW THE ARITHMETIC | BUILDABLE TODAY |
| A16 | The Turned (RARE) | A kindness to a foe, a monster or a rival hunter, turned it | Item Token of the Turned (material, epic, `tell: true`): used, the GM brings that creature into the next fight on your side for 3 rounds | AN ENEMY HAS CHANGED SIDES | GM ONLY (the creature's arrival) |

### 3.5 A great speech

| # | Award | The moment | Gives | Window title | Mark |
|---|---|---|---|---|---|
| A17 | Quoted Back | A speech the table will repeat | Boon "Quoted": in a later session, a nonplayer the GM picks quotes your speech back to you | THE WORDS ARE STILL MOVING | BUILDABLE TODAY |
| A18 | Banner | A speech before a fight | Boon "Banner": in that fight, every ally starts Hasted for 1 round (the GM puts it on) | THEY WILL MARCH ON THAT | BUILDABLE TODAY |
| A19 | Eulogist | A speech for someone gone | Title Eulogist (E, dis +1): "Spoke for the dead, and they were in the audience." | THE DEAD WERE LISTENING | BUILDABLE TODAY |
| A20 | Repeated | One line of a speech that should be heard again | The System opens a window on every phone in the room, its body the line the GM types | THE SYSTEM REPEATS | NEEDS N13 |

### 3.6 A perfect silence

| # | Award | The moment | Gives | Window title | Mark |
|---|---|---|---|---|---|
| A21 | Withheld | The hunter refused to answer, and the refusal said everything | Boon "Withheld": once, refuse a question in character, and no check may make you answer | THE SYSTEM RECEIVED NO INPUT | BUILDABLE TODAY |
| A22 | Enough | A look or a gesture did the work of a line | 1 ability point | NOTHING WAS SAID. IT WAS ENOUGH | BUILDABLE TODAY |
| A23 | The Unanswered | Someone asked the hunter a question that hurt, and the player let the silence answer | Title The Unanswered (E, ins +1): "Holds a question longer than most." | THE QUESTION IS STILL IN THE ROOM | BUILDABLE TODAY |

### 3.7 A rivalry

| # | Award | The moment | Gives | Window title | Mark |
|---|---|---|---|---|---|
| A24 | Measured Against | Two hunters made a rivalry visible at the table. Given to both | Each gets boon "Answer": once, when your rival succeeds at something, try the same thing at once | THE SYSTEM HAS STARTED A SECOND COLUMN | BUILDABLE TODAY |
| A25 | Second Place | A hunter lost to its rival and played the sting | 1 ability point | SECOND PLACE IS STILL A PLACE | BUILDABLE TODAY |
| A26 | Two Edges | A rivalry that makes both better. Given to both | Title Two Edges (E, str +1) to each. Linked, it gives +1 more while the rival is in the same fight | ONE BLADE SHARPENS THE OTHER | BUILDABLE TODAY (two titles), NEEDS N15 (the link) |
| A27 | Settled Account (RARE) | A rivalry ends in a scene: a handshake, a duel, a funeral | Both get title Settled Account (C, pre +2, str +1) and 2 ability points | THE SECOND COLUMN IS CLOSED | BUILDABLE TODAY |

### 3.8 A running joke that pays off

| # | Award | The moment | Gives | Window title | Mark |
|---|---|---|---|---|---|
| A28 | Callback | A joke from sessions ago lands again, at the perfect time | 1 ability point | THE SYSTEM REMEMBERED THE SETUP | BUILDABLE TODAY |
| A29 | Made True | The joke is good enough to become a fact of the world (a shop, a monster's name, a rule of a gate) | Boon "Made True": the GM writes the joke into the world | THIS IS NOW TRUE | GM ONLY |
| A30 | Running Gag | A joke that has followed one hunter for weeks | A title with no bonus whose name the other players choose | THE SYSTEM HAS BEEN FORCED TO ACKNOWLEDGE THIS | BUILDABLE TODAY |
| A31 | The Punchline (RARE) | A joke carried all campaign becomes the lever of a real scene | Item The Punchline (accessory, legendary). Worn status: once a fight, the first hit on the bearer is shielded in full | IT WAS FUNNY. NOW IT IS ALSO USEFUL | BUILDABLE TODAY (a worn status with a trigger on `struck`) |

### 3.9 Making another player's moment bigger

| # | Award | The moment | Gives | Window title | Mark |
|---|---|---|---|---|---|
| A32 | Feed Line | A player set up another's moment and stepped back | Boon "Feed Line": once, describe how another hunter succeeds at a roll that missed by 2 or less | THE SYSTEM CREDITS THE ASSIST | BUILDABLE TODAY |
| A33 | Gave the Kill | In a fight, a hunter set up the finishing blow for another and said so in character | 1 ability point | TWO NAMES ON ONE KILL | BUILDABLE TODAY |
| A34 | Lent the Floor | A player gave up their turn in a scene so another could finish theirs | Held reroll | THE FLOOR WAS LENT. IT IS RETURNED WITH INTEREST | BUILDABLE TODAY |
| A35 | Asked the Question | A player asked another's hunter the question that opened its past | To the asker, boon "Confidant": once, the other hunter's player tells you one secret of its past, privately | A DOOR OPENED IN SOMEONE ELSE | BUILDABLE TODAY |

### 3.10 A hunter changing its mind

| # | Award | The moment | Gives | Window title | Mark |
|---|---|---|---|---|---|
| A36 | File Updated | A hunter dropped a belief it held, on screen, for a reason the table saw | 1 ability point | THE SYSTEM HAS UPDATED YOUR FILE | BUILDABLE TODAY |
| A37 | New Shape | A change of mind that changes how the hunter fights | Boon "New Shape": one respec at no gold, taken before the next session or lost | THE OLD SHAPE NO LONGER FITS | BUILDABLE TODAY |
| A38 | Renounced (RARE) | The hunter gives up a title it holds, in front of the table, to become someone else | The old title is removed. The player writes a new one, which the GM gives at B rank (3 points) | THE OLD NAME IS RETURNED | NEEDS N11 (the title taken away). Today the GM deletes it by hand |

### 3.11 A failure owned

| # | Award | The moment | Gives | Window title | Mark |
|---|---|---|---|---|---|
| A39 | Fell Forward | A failure the player built on instead of hiding | Boon "Lesson Kept": on the next check of the same kind, roll twice and keep the better | THE SYSTEM KEEPS THE LESSON ON FILE | BUILDABLE TODAY |
| A40 | Scuffed | A failure told so well the table asked for it again | Title Scuffed (E, agi +1, a joke): "Fell on the way in, and told it well." | THE SYSTEM REQUESTS A REPLAY | BUILDABLE TODAY |
| A41 | Worse Than Rolled | The player narrated a failure worse than the dice asked for | 1 ability point | THE SYSTEM DID NOT ASK FOR THIS | BUILDABLE TODAY |

### 3.12 Comic timing

| # | Award | The moment | Gives | Window title | Mark |
|---|---|---|---|---|---|
| A42 | Pause | A line so well timed the game stopped | The System opens a window on every phone with no body at all | THE SYSTEM WILL WAIT | NEEDS N13 |
| A43 | Pratfall Clause | A natural 1 played for laughs | Boon "Pratfall Clause": once, after a natural 1, describe a funny failure and the GM makes it cost nothing | THE FALL WAS INSURED | BUILDABLE TODAY |
| A44 | Deadpan | A joke delivered with no expression at all | Title Deadpan (E, ins +1, a joke) | THE SYSTEM ALSO KEEPS A STRAIGHT FACE | BUILDABLE TODAY |

### 3.13 A goodbye

| # | Award | The moment | Gives | Window title | Mark |
|---|---|---|---|---|---|
| A45 | Way Back Marked | A goodbye to a place or a person the hunter will not see again | Boon "Way Back": once, ask the GM for one scene back in a place you left | THE PATH BACK IS MARKED | BUILDABLE TODAY |
| A46 | Keepsake | A goodbye with a thing exchanged | Item Keepsake (material, common, sells for 0). The player names it and writes its description | THE SYSTEM WILL NOT APPRAISE THIS | BUILDABLE TODAY |
| A47 | What They Carried (RARE) | A goodbye to a dying hunter, played in full | To the survivor, the dead hunter's worn title, as its heir (L17) | WHAT THEY CARRIED IS YOURS | NEEDS N16. Today the GM copies the title by hand |

### 3.14 A secret kept

| # | Award | The moment | Gives | Window title | Mark |
|---|---|---|---|---|---|
| A48 | Locked Box | A hunter's secret held under pressure | Boon "Locked Box": once, the GM asks you privately whether to reveal it. Either answer pays 1 ability point | THE SYSTEM SEES THE LOCK. NOT THE KEY | BUILDABLE TODAY |
| A49 | Knew and Did Not Know | A player knew another hunter's secret at the table and played as if the hunter did not | 1 ability point | YOU KNEW. YOUR HUNTER DID NOT | BUILDABLE TODAY |
| A50 | Second Ledger | A secret that the player has kept for more than three sessions | Title Second Ledger (E, ins +1): "Keeps an account nobody has seen." | THE SYSTEM KEEPS A SECOND COPY | BUILDABLE TODAY |

### 3.15 A promise made at the table

| # | Award | The moment | Gives | Window title | Mark |
|---|---|---|---|---|---|
| A51 | Witnessed | A hunter makes a promise out loud | The promise becomes a quest on the hunter's phone with no reward. Failing it gives the title Forsworn (L25) | THE SYSTEM HAS WITNESSED THIS | BUILDABLE TODAY (the quest). The failure title NEEDS N9 |
| A52 | Hand on It | Two hunters promise each other something | Both get boon "Bond Held": while the promise stands, once, either may take a hit meant for the other | TWO SIGNATURES. ONE LINE | BUILDABLE TODAY |
| A53 | Late but True (RARE) | A promise made many sessions ago is kept now | 3 ability points and title Late but True (B, dis +2, pre +1) | THE SYSTEM HAD STOPPED WAITING | BUILDABLE TODAY |

### 3.16 Mercy

| # | Award | The moment | Gives | Window title | Mark |
|---|---|---|---|---|---|
| A54 | Spared One | The hunter let a beaten foe live | Boon "Spared One", with a clause: the one you spared returns once, at a time the GM picks, for good or ill | IT WILL REMEMBER YOUR FACE | BUILDABLE TODAY |
| A55 | Mercy Pays Odd | Mercy that cost the party the foe's XP | 1 ability point. The window says the XP was given up | THE SYSTEM DID NOT REQUIRE THAT | BUILDABLE TODAY |
| A56 | Open Palm (RARE) | Mercy to a boss | Title Open Palm (A, pre +3, dis +1), and the spared boss becomes a person in the world | THE SYSTEM HAS NO CATEGORY FOR THIS | BUILDABLE TODAY (the title). The boss's life after is GM ONLY |

### 3.17 Fear played honestly

| # | Award | The moment | Gives | Window title | Mark |
|---|---|---|---|---|---|
| A57 | Shaking Hands | The player played the hunter's fear before a fight | Boon "Courage Owed": in the next fight, the first check against fear rolls twice and keeps the better | FEAR IS DATA | BUILDABLE TODAY |
| A58 | Came Back | The hunter fled, then returned | 1 ability point | YOU CAME BACK. THAT IS THE PART THAT COUNTS | BUILDABLE TODAY |
| A59 | Said Its Name | The hunter said aloud what it is most afraid of | Title Knows Its Name (E, dis +1) | THE FEAR HAS A NAME NOW | BUILDABLE TODAY |
| A60 | Walked In Anyway (RARE) | The hunter entered the gate it was most afraid of | Title Walked In Anyway (B, dis +2, vit +1) and 2 ability points | THE DOOR WAS OPEN. YOU USED IT | BUILDABLE TODAY |

### 3.18 Any moment

| # | Award | The moment | Gives | Window title | Mark |
|---|---|---|---|---|---|
| A61 | The Table Agrees | The GM asks the other players who earned the session's moment, and gives it to whoever they name | 1 ability point | THE SYSTEM DEFERS TO THE WITNESSES | GM ONLY (the vote is spoken) |
| A62 | Seen | Any small moment from a player who has had none in a while | No reward. The window is the reward | THE SYSTEM SAW THAT | BUILDABLE TODAY |

That is 62 awards. Rare and large: A04, A08, A16, A27, A31, A38, A47, A53, A56, A60. Lines to the whole room: A20, A42.

### 3.19 A guide for the GM

**How often.** One small award per player per session is the steady rate, and about four to six a session at a table of four. Fewer, and players stop looking for them. More, and they stop meaning anything. A rare award is once an arc, roughly once every five or six sessions for the whole table. If you have given two rare ones in one session, one of them was not rare.

**Give it at once.** An award given at the end of the session rewards a memory. An award given within ten seconds of the moment rewards the moment, and the whole table learns what you value. Two taps is the point. Do not save them up.

**Spread across quiet and loud players.** Loud players will give you ten moments a session and quiet players one. Give the quiet player's one moment an award every time, and give the loud player's best moment of the ten. Keep a mental note, or use the spotlight line in section 8 (X03) when it exists: a player with no award in two sessions is the first one you watch for. Some moments only quiet players make: silence (3.6), a secret kept (3.14), a look instead of a line (A22). Those sections exist for them.

**Reward the moment, not the player.** "That line" not "you are good at this". The window titles are written about what happened, never about the person's talent. A player should be able to earn A41 Worse Than Rolled on their first night.

**Keep it from becoming a bribe.**
- Never announce what an award is for before the moment. If a player asks "what do I get for a speech", the answer is "I do not know yet".
- Never give one for a moment a player performs at you. A speech made to win the award is not a speech. If it feels angled, give nothing and wait for the next real one.
- Prefer awards whose reward is a boon or a window over ones that give a number. The stat bonuses are small on purpose. A table that starts doing the math has stopped playing.
- Give A62 Seen sometimes: a window with nothing in it. It teaches the table that the window is the point.

**Keep it from becoming a scoreboard.**
- Do not show a count of awards per player on any shared screen. The chronicle keeps them, privately.
- Rotate the moments. If one player wins every speech award, look for that player's silences and that other player's speeches.
- Give awards for moments that made someone else's moment bigger (3.9) at least as often as for the moment itself. That is the one that turns a table from competitors into a cast.

**When you are unsure, give the smallest one.** A point given lightly costs nothing. A rare award given lightly costs every rare award after it.

## 4. Feats the System notices by itself

The condition is written so it can be built as the design's feat rule: one fact kind, up to four tests of its fields, what to count, the number that earns it, a window, and tests of the hunter's state (`notes-1-feats.md` 5.1 and 5.2). Fact kinds and their fields are the design's (`fight`, `kill`, `used`, `solo`, `gate`, `closed`, `quest`, `daily`, `streakLost`, `penaltyIssued`, `penaltyLifted`, `life`, `level`, `rank`, `title`, `feat`, `given`, `roll`, `coin`, `shop`, `rest`, `shadow`). Every feat here is hidden unless it says Shown. Feats about what was not done mostly need N19.

### 4.1 Restraint

| # | Feat | Condition | Grants | Window title | Mark |
|---|---|---|---|---|---|
| S01 | The unspent hand | A `fight` fact: outcome won, rounds 3 or more, dealt 0, healed 20 or more | Title L31 The Listener | YOU DID NOT STRIKE ONCE | NEEDS N2 |
| S02 | Full well | A `fight` fact: outcome won, onlyWeapon true, manaUses 0, foeTop 0 or more, kills 1 or more | 1 ability point | THE MANA WAS NEVER TOUCHED | NEEDS N2 |
| S03 | Kept in reserve | The hunter holds a Resurrection Crystal through 10 sessions and never uses one | Boon U34 One True Thing | THE SYSTEM NOTES WHAT YOU DID NOT USE | NEEDS N19 |
| S04 | Points in the pocket | The hunter starts 3 sessions in a row with 9 or more unspent ability points | Title L27 Slow Hand | THE POINTS ARE STILL THERE | NEEDS N22 |
| S05 | No crutch | A `solo` fact: outcome won, odds under 50, and no `used` fact in that run | Boon "No Crutch" (a held reroll) | NOTHING WAS DRUNK. NOTHING WAS NEEDED | NEEDS N3 |
| S06 | Closed purse | 10 sessions in a row with no `shop` fact while the hunter's gold is 5,000 or more | Title L35 Keeper of Small Things | THE SYSTEM WONDERS WHAT YOU ARE SAVING FOR | NEEDS N22 |
| S07 | Left standing | A `fight` fact: outcome ended (the GM ended it, no winner), the hunter up, a foe spared | Award A54's boon Spared One, from the System | YOU LEFT IT BREATHING | NEEDS N2, N19 |

### 4.2 Mercy

| # | Feat | Condition | Grants | Window title | Mark |
|---|---|---|---|---|---|
| S08 | Mercy in numbers | 5 `fight` facts with a foe spared | Title L26 The Spared One's Shadow | FIVE LEFT ALIVE. THE SYSTEM IS COUNTING THEM | NEEDS N2, N19 |
| S09 | The breath before | The hunter had a foe at 10% HP or less on its own turn and used no damage on it, and the fight ended with that foe spared | 1 ability point | YOU HAD IT. YOU STOPPED | NEEDS N2, N19 |
| S10 | Spared above | A spared foe of a rank above the hunter's | Title L26, or 1 ability point if held | IT WAS STRONGER THAN YOU. YOU LET IT GO ANYWAY | NEEDS N2, N19 |
| S11 | The dead left alone | A hunter whose job may extract leaves 10 fallen monsters unextracted that it could have tried | Title "Leaves Them Be" (C, dis +2) | THE DEAD WERE ASKED NOTHING | NEEDS N19 |
| S12 | Bottom of the ladder | 3 `solo` facts with outcome lost, in a row | Boon "Hand Down": the GM picks your next personal gate's rank, one below yours | THE LADDER HAS A BOTTOM. YOU FOUND IT | BUILDABLE TODAY |

S12 is filed here because the System's answer is a mercy. The rest of the failures follow.

### 4.3 Failure

| # | Feat | Condition | Grants | Window title | Mark |
|---|---|---|---|---|---|
| S13 | First step, first fall | A `solo` fact with outcome lost, and the hunter's level is 1 | Health Potion ×2 | EVERYONE FALLS ON THE FIRST STEP | BUILDABLE TODAY |
| S14 | Bad day at the board | 3 `quest` facts with end failed, in one session | 1 ability point | THE BOARD WINS TODAY | BUILDABLE TODAY |
| S15 | Thirty, gone | A `streakLost` fact with streak 30 or more | No reward. Shows S16 | THIRTY DAYS. ZERO DAYS | BUILDABLE TODAY |
| S16 | Built it again | Shown after S15. A `daily` fact with streak 30 or more, counted from S15's earning | Title "Rebuilt" (C, dis +2, vit +1) | THE SYSTEM DID NOT EXPECT THE SECOND THIRTY | NEEDS N22 (the count starts at S15) |
| S17 | Forgot the potion | A `fight` fact where the hunter went down, and it held a healing consumable it never used in that fight | Title "Saving It for Later" (E, a joke, vit +1) | IT WAS IN YOUR BAG THE WHOLE TIME | NEEDS N2, N22 |
| S18 | Ten tails | 10 `coin` facts with won false, in a row | Boon "The Coin Owes You": the next coin call, you choose the side | THE COIN IS EMBARRASSED | BUILDABLE TODAY |
| S19 | Well known floor | 3 `life` facts of going down in one session | Stamina Tonic ×1 and 1 ability point | THE FLOOR KNOWS YOUR NAME NOW | BUILDABLE TODAY |
| S20 | Lost the wager | A `solo` fact with outcome lost whose odds at entry were 90 or more | Title "Sure Thing" (E, a joke, ins +1) | IT WAS NINE IN TEN | NEEDS N3 |
| S21 | Unfinished everywhere | 3 active quests are past due at once | 1 ability point and the window | EVERYTHING IS LATE | NEEDS N22 |

### 4.4 Patience

| # | Feat | Condition | Grants | Window title | Mark |
|---|---|---|---|---|---|
| S22 | Waited it out | A `fight` fact won where the hunter's first use came in round 3 or later and it defeated the boss | Title "The Late Blade" (C, ctl +2) | THE SYSTEM WAS STARTING TO WORRY | NEEDS N2 (a new field: first use's round) |
| S23 | Late bloomer | A `level` fact of 10 or more in session 20 or later | 2 ability points | NO ONE WAS RUSHING YOU | NEEDS N22 |
| S24 | Only mornings | 10 sessions in a row where the hunter's only facts were `daily` ones | Title "Only Mornings" (C, dis +3) | NOTHING HAPPENED. YOU KEPT DOING IT | NEEDS N19 |
| S25 | Rested well | 10 `rest` facts with long true, each with fatigue under 10 when taken | Title "Sleeps Like Stone" (E, vit +1) | YOU REST BEFORE YOU NEED TO | NEEDS N22 (fatigue at the rest) |
| S26 | The long hold | The hunter keeps one item in its bag for 30 sessions without using, selling or wearing it | The item gains a line in its description that the System writes: "Carried for 30 sessions." | IT HAS BEEN WITH YOU A LONG TIME | NEEDS N19, and an item's words changed by the System |
| S27 | One shot | A `solo` fact: won, rounds 1 | Title "One Breath" (C, agi +2) | THE SYSTEM DID NOT FINISH LOADING | BUILDABLE TODAY if the built `solo` fact keeps its rounds, else NEEDS N3 |
| S28 | Paid in full, late | A `penaltyLifted` fact for a penalty of 3 or more days with no daily missed after it for 30 days | Title L13 Unbowed | THE DEBT AND THE DAYS ARE SQUARE | NEEDS N22 |

### 4.5 Grief

| # | Feat | Condition | Grants | Window title | Mark |
|---|---|---|---|---|---|
| S29 | One fewer | A `fight` fact with alliesDead 1 or more and the hunter up | No reward. Shows S30, and tells the GM that story C03 may begin | ONE OF YOU STAYED IN THE GATE | NEEDS N2 |
| S30 | Kept the mornings | Shown after S29. 7 `daily` facts in a row, counted from S29 | 1 ability point and title "Kept the Mornings" (D, dis +2) | GRIEF DID NOT STOP THE MORNINGS | NEEDS N2, N22 |
| S31 | Their rank | Reach the rank the dead ally held at its death | Title L19 The Second Bearer, if an heir title is held | YOU ARE WHERE THEY WERE | NEEDS N16 |
| S32 | Returned twice | 2 `life` facts of a revive | Title L32 Twice-Named | THE SYSTEM HAS OPENED A SECOND FILE | BUILDABLE TODAY |
| S33 | A quiet session | The first session after an ally's death holds no `fight` and no `solo` fact for this hunter | 1 ability point | THE SYSTEM DID NOT ASK YOU TO FIGHT | NEEDS N19 |
| S34 | The empty chair | A hunter of this room dies, and this hunter completes a daily on the same day | No reward. The window only | THE MORNING CAME ANYWAY | NEEDS N6 |

### 4.6 Loyalty

| # | Feat | Condition | Grants | Window title | Mark |
|---|---|---|---|---|---|
| S35 | Never alone | A `level` fact of 20 or more with the tally's solo runs won and lost both 0 | Title "Never Alone" (C, pre +2) | YOU HAVE NEVER WALKED IN BY YOURSELF | BUILDABLE TODAY |
| S36 | Same shoulder | The hunter brought the same ally up from down 3 times | Both get title L08 Sworn Kin | THE SAME HAND. THE SAME HUNTER | NEEDS N2, N6, N15 |
| S37 | Same company | 20 fights, every one with the same ally in it | Title "Same Company" to both (D, pre +2) | TWENTY FIGHTS. ONE FACE BESIDE YOU | NEEDS N6 |
| S38 | Last potion | The hunter used its last healing consumable on another hunter | 1 ability point | THAT WAS YOUR LAST ONE | NEEDS N2 (a used fact's target) |
| S39 | The same name | The hunter wore one title for 15 sessions | The title gains +1 on its largest stat | THE NAME HAS SETTLED ON YOU | NEEDS N22, N14 |
| S40 | Answered every call | 10 world gates in a row that the party fought, with this hunter in every one (`Gate.fought`) | Title "Answers the Bell" (C, vit +2) | YOU ALWAYS COME | NEEDS N6 |

### 4.7 A choice not taken

| # | Feat | Condition | Grants | Window title | Mark |
|---|---|---|---|---|---|
| S41 | Declined | The hunter refuses a title a feat offered | Title L14's refusal arm, "Declined" (C, dis +1, ins +1) | THE SYSTEM OFFERED. YOU SAID NO | NEEDS N18 |
| S42 | Two refusals | 2 refusals of a title | Title "Unnamed by Choice" (B, ins +3), which cannot be refused | THE SYSTEM HAS STOPPED OFFERING | NEEDS N18 |
| S43 | The job unchanged | 3 sessions at or past the Job Change level without starting the chain | Boon "Your Own Way": once, the GM lets you skip one step of the chain later, or keep this boon forever | THE PATH WAITED. YOU DID NOT TAKE IT | NEEDS N22 |
| S44 | Never changed the blade | 50 won fights with the same weapon worn | The weapon's dice rise one step (the GM edits it) | THE SAME BLADE, FIFTY TIMES | NEEDS N2 (gear worn in the fight fact) |
| S45 | Never respecced | Level 40 with no respec | Title "Set in Stone" (A, vit +2, dis +2) | YOU NEVER UNDID YOURSELF | NEEDS N1 (a tally key: respecs) |
| S46 | The envelope held | A hidden quest item (first file R17) carried 5 sessions unopened | The quest inside pays double | THE SYSTEM KNOWS YOU HAVE NOT LOOKED | NEEDS N19 |
| S47 | Walked past the crown | A personal gate above the hunter's rank closes unentered while the hunter was at full HP and no fatigue | 1 ability point | YOU COULD HAVE. YOU DID NOT | NEEDS N22 |

### 4.8 Odd coincidences

| # | Feat | Condition | Grants | Window title | Mark |
|---|---|---|---|---|---|
| S48 | Sevens | A `daily` fact with streak 7 while the hunter's level is 7 | 7 gold and 1 ability point | THE SYSTEM CHECKED TWICE | BUILDABLE TODAY |
| S49 | Lucky change | A `shop` fact with goldAfter exactly 777 | Title "Lucky Change" (E, a joke, pre +1) | THE CHANGE IS CORRECT | BUILDABLE TODAY |
| S50 | Birthday | A `level` fact whose level equals the session number | 1 ability point | THE SESSION AND THE LEVEL AGREE | NEEDS N22 |
| S51 | Thirteen | The 13th gate cleared falls in session 13 | Title "Thirteen" (D, ins +2) | THE SYSTEM DOES NOT BELIEVE IN OMENS. IT NOTED THIS ONE | NEEDS N22 |
| S52 | Double twenty | 2 `roll` facts with natural 20, in a row of rolls with no other roll between | Held reroll | THE DIE IS HAVING A GOOD DAY | NEEDS N5 (every roll as a fact, so "in a row" is exact) |
| S53 | Even trade | A `fight` fact won where dealt equals taken, both 20 or more | 1 ability point | YOU GAVE EXACTLY WHAT YOU GOT | NEEDS N2 |
| S54 | Round trip | A `fight` fact won where the hunter ended at the same HP it started with, after taking damage | Title "Round Trip" (E, hpMax +10) | ALL OF IT CAME BACK | NEEDS N2 (a new field: HP at the start) |
| S55 | Namesake | A `kill` fact on a monster whose name is the hunter's name | Title "Namesake" (E, a joke, str +1) | THERE CAN BE ONLY ONE OF THAT NAME NOW | NEEDS N22 (a test that compares a field with the hunter's name) |
| S56 | In step | Two hunters in the room reach the same level in the same session | Both get 1 ability point | TWO CLOCKS STRUCK THE SAME HOUR | NEEDS N6 |
| S57 | Same breath | Two hunters earn the same feat in the same write | Both get title "Same Breath" (E, agi +1) | THE SYSTEM WROTE THE SAME LINE TWICE | NEEDS N6 |
| S58 | First and last | The hunter's first `kill` and its 100th are the same monster name | Title "Old Acquaintance" (D, ins +2) | IT WAS THERE AT THE START TOO | NEEDS N22 (a kill fact read beside the first) |
| S59 | Heads all week | 7 `coin` facts won, one on each of 7 world days in a row | Boon "The Coin Owes You" | THE COIN HAS A FAVORITE | NEEDS N4 |

### 4.9 Odd ones

| # | Feat | Condition | Grants | Window title | Mark |
|---|---|---|---|---|---|
| S60 | Given thrice | 3 `given` facts in one session (any bundle the GM gave by hand) | 1 ability point | THE SYSTEM IS NOT THE ONLY ONE WATCHING | BUILDABLE TODAY |
| S61 | The same moment twice | 2 `given` facts of the same bundle key in one session | Held reroll | THE SAME MOMENT. AGAIN | BUILDABLE TODAY |
| S62 | Every kind | `given` facts of 10 different bundle keys | Title "Many-Sided" (C, pre +1, ins +1) | THE SYSTEM CANNOT SUMMARIZE YOU | BUILDABLE TODAY |
| S63 | Nothing to report | A whole session with no fact at all for this hunter, while its player was at the table | Title "Background Character" (E, a joke, agi +1) | THE SYSTEM HAS NOTHING TO REPORT | NEEDS N19, N20 (who was at the table) |
| S64 | The System's favorite | The hunter has 5 more `given` facts than any other hunter in the room | No reward. A window only, and the GM is told | THE SYSTEM HAS NOTICED THE GM'S FAVORITE | NEEDS N6 |

That is 64 feats. Buildable with unit 1's facts and the feat engine: S12 to S15, S18, S19, S32, S35, S48, S49, S60 to S62. Most of the rest wait for the fight's facts (N2, being built) or for N19 and N22, the two new capabilities this file argues for most.

S64 is on purpose. It is the System telling on the GM, and it is the cheapest check on awards becoming favoritism (3.19).

## 5. Titles

Bonuses use the ten keys a title carries today (`PERK_KEYS`). "Worn" is a status the title puts on its hunter's row in a fight, which unit 8 builds (N7). A title with stages names its stages in order.

### 5.1 Titles that change over time

| # | Title | How it is earned | What it does | Mark |
|---|---|---|---|---|
| L01 | Unlit, then Ember, then Brand, then Beacon | Unlit is given at a hunter's first daily | Unlit has no bonus. Each 10 dailies done moves it a stage: Ember dis +1, Brand dis +2, Beacon dis +3. A lost streak moves it back one stage | NEEDS N14 |
| L02 | Stranger, then Familiar Face, then Fixture | Given on joining a room | Moves a stage for every 10 sessions with the same party: none, pre +1, pre +2 | NEEDS N14, N6 |
| L03 | Unweighed | Given at creation | No bonus. At each rank up, it takes +1 on the stat behind the hunter's largest lifetime number (kills to str, healed to pre, avoided to agi). At S rank it is fixed and renamed by the GM | NEEDS N14 |
| L04 | Foretold, then Fulfilled or False Prophecy | Given by the System with a deed written into it ("will close a gate above its rank") | Foretold: ins +1. When the GM closes it (story C02): Fulfilled, ins +2, pre +1, if the deed was done. If not, False Prophecy: ins +3, pre -1, because the hunter proved the System wrong | NEEDS N14, N17 |
| L05 | Tide-Marked | A GM's gift | Its bonus swaps every world day between str +2 and dis +2. The player checks which day it is | NEEDS N14 |
| L06 | In Arrears, then Square | Given with a debt (U25, story C01) | In Arrears: pre -1, str +2. When the debt is paid, Square: str +2 and nothing taken | NEEDS N14 |
| L30 | Unwanted Name, then Came Back | Given by the GM for a moment of cowardice played well | Unwanted Name has no bonus and the GM picks the name. It turns into Came Back (D, vit +2) the first time the hunter earns A58 | NEEDS N14. Today the GM swaps it by hand |
| L43 | Weathervane | Earned at 10 fights | Its bonus is +2 on the stat the hunter's most-used ability reads, worked out at each session's start | NEEDS N14, N2 |

### 5.2 Titles two hunters share

| # | Title | How it is earned | What it does | Mark |
|---|---|---|---|---|
| L07 | Two Halves of a Coin | Two hunters, given together by the GM | Each gets pre +1. While the other is within 3 tiles in a fight, each gets +1 Agility more (worn, an aura that reads the pair) | NEEDS N15 |
| L08 | Sworn Kin | S36, or a GM's gift after a promise made at the table (A52) | vit +2 each. Worn: when the other goes down, the bearer gets a shield of 2d8 at once, once a fight | NEEDS N15 |
| L09 | Rival's Mark | A24 given twice to the same pair | Whichever of the two has more kills this session has ins +2. The other has none | NEEDS N15, N6 |
| L10 | Last Ones Up | Shared by every hunter who was up when the rest of the party went down in a won fight | pre +2 each. When one of them dies, the others' titles become In Their Place (L17) | NEEDS N15, N6 |
| L11 | Back to Back | Two hunters who avoid attacks side by side for 5 fights | Worn: when either avoids an attack, the other's next attack has advantage | NEEDS N15 |
| L40 | Same Gate, Same Day | Every hunter who cleared a gate together on its break day | pre +1 each, and a line in each chronicle naming the others | NEEDS N15 |

### 5.3 Titles that can be lost or refused

| # | Title | How it is earned | What it does, and how it goes | Mark |
|---|---|---|---|---|
| L12 | Clean Record | 10 quests done and none failed | pre +2. Lost at the first failed quest, and the window says which | NEEDS N21 |
| L13 | Unbowed | S28 | dis +2. Lost forever at the next penalty. The title list keeps it struck through | NEEDS N21 |
| L14 | The Offered Crown, or Declined | The System offers it at an S-rank feat | Taken: pre +4, and worn: monsters come for the bearer first (`threat` up). Refused: Declined (C, dis +1, ins +1), which the System names as the better choice in its window | NEEDS N18 |
| L15 | Borrowed Name | A10 Borrowed Face, twice | agi +2. Lost when the hunter is renamed | NEEDS N21 |
| L16 | Spotless, then Once Spotless | Level 10 with no fall | vit +2. After the first fall it stays as Once Spotless with no bonus | NEEDS N21, N14 |
| L39 | Fair Weather | 7-day streak | agi +2 only on days the day's dailies are done. On other days it reads "Fair Weather (clouded)" | NEEDS N21 |
| L41 | Kept Your Seat | GM's gift, to the player who ran an absent player's hunter for a session | pre +1. It leaves when the absent player returns and is given to them as Was Kept (no bonus, a thank you) | GM ONLY |

### 5.4 Titles the dead leave

| # | Title | How it is earned | What it does | Mark |
|---|---|---|---|---|
| L17 | In Their Place | The heir a dead hunter's player names | It carries the dead hunter's name in its description and half of the dead hunter's best title's bonus, rounded up | NEEDS N16 |
| L18 | Keeper of the Unfinished | The heir takes the dead hunter's open quests | dis +2 while one of them is open. When the last is done, it becomes Finished For Them (pre +2) | NEEDS N16, N14 |
| L19 | The Second Bearer, then Third, then Fourth | An heir to an item that has been passed before (U26) | Its number counts the holders. Each bearer after the first gets +1 more on the item's main stat, up to +3 | NEEDS N16, N14 |
| L20 | Witness | Every hunter up in the fight when another died | ins +1, and a duty: at the next session's start, the witness tells the table how it happened, in character | BUILDABLE TODAY (the GM gives it). The duty is GM ONLY |
| L32 | Twice-Named | S32 | hpMax +20, dis -1. The chronicle opens a second chapter with the hunter's second name | BUILDABLE TODAY |

### 5.5 Titles with a drawback or a duty

| # | Title | How it is earned | What it does | Mark |
|---|---|---|---|---|
| L21 | Gate-Sworn | A GM's gift for a hunter who swore to close gates | vit +3. Duty: enter every personal gate within a day of its spawn. A gate that closes unentered takes the title | NEEDS N21 |
| L22 | Fate's Plaything | Three feats of bad luck earned (any three of S13, S14, S18, S19, S20) | dis +2, ins +1. The GM may, once a session, call one of the hunter's d20s a natural 1 before it is rolled | GM ONLY (the call) |
| L23 | Lamp-Bearer | A GM's gift in a dark gate | Worn: `alert` (hidden foes near the bearer are seen) and `threat` up. The light draws them | NEEDS N7 |
| L24 | Owed to the Deep | Taken in a bargain (story C01) | str +4, pre -2. The story collects, when the GM moves it | BUILDABLE TODAY (the title). The collecting is C01 |
| L25 | Forsworn | A51's promise failed | str +2, dis -2. A quest given with it, Mend the Word, removes it when done | NEEDS N9, N11 |
| L26 | The Spared One's Shadow | S08 | ins +2. Duty: the GM may bring back one of the spared foes in any gate. The hunter cannot refuse to meet it | GM ONLY (the return) |
| L27 | Slow Hand | S04 | ctl +3. Worn: speed -10% | NEEDS N7 |
| L28 | Glass Crown | A GM's gift after a reckless win | pow +4, hpMax -30 | BUILDABLE TODAY |
| L29 | The One Who Stays | A GM's gift, after A06 twice | vit +3. Duty: the hunter cannot leave a fight while an ally is down | GM ONLY (the duty) |

### 5.6 Other names

| # | Title | How it is earned | What it does | Mark |
|---|---|---|---|---|
| L31 | The Listener | S01 | ins +2 and pre +1. "Was in the fight. Hit nothing. Kept everyone up." | BUILDABLE TODAY |
| L33 | Unwitnessed | A solo run won at worse than 1 in 4 odds, between midnight and the reset | ins +2. Its description is blank, as the deed had no witness | NEEDS N3, N4 |
| L34 | Seldom Seen | A hunter with no `fight` fact in 5 sessions that still wins a solo run in each | agi +2 | NEEDS N19 |
| L35 | Keeper of Small Things | S06, or 10 keepsakes held (A46) | pre +1, hpMax +10 | BUILDABLE TODAY (the GM gives it). NEEDS N22 for the count |
| L36 | Footnote | A hunter whose name appears in another hunter's chronicle 20 times | pre +1. A joke with a point: someone else's story is partly yours | NEEDS N6 |
| L37 | The Name the System Forgot | A GM's gift, once a campaign | agi +2, ins +3. Every System window to this hunter shows "???" in place of its name | NEEDS a window's words per hunter (X08) |
| L38 | Thirteenth Gate | S51 | ins +2 | NEEDS N22 |
| L42 | Promise of Session 9 | A53, named for the session the promise was made in | dis +2, pre +1 | BUILDABLE TODAY |
| L44 | Unclaimed | A feat's title left unworn for 20 sessions | No bonus. "Has more names than it uses." | NEEDS N22 |

That is 44 titles. Changing: L01 to L06, L16, L18, L19, L30, L43. Shared: L07 to L11, L40. Lost or refused: L12 to L16, L39, L41, plus L21 and L25. Inherited: L17 to L20, L32. Drawbacks or duties: L21 to L29.

## 6. Unique rewards that change a decision or a relationship

### 6.1 Permissions, secrets and answers

| # | Reward | What it is | Why it changes a decision | Mark |
|---|---|---|---|---|
| U01 | The True Answer | Boon: ask the GM one yes-or-no question about anything in the campaign. The answer is true. He may ask you one back, and you answer in character | Every player at the table will lobby for what to ask | BUILDABLE TODAY |
| U03 | The Unbarred Exit | Boon: once, the whole party walks out of a fight in a gate, and the gate does not close or break for 1 world day | A retreat becomes a plan, and the party argues when to spend it | GM ONLY |
| U09 | One Rule Broken | Boon: once, break one rule of the game the GM names when giving it (act twice, move after acting, ignore one refusal) | The most watched boon at the table | GM ONLY |
| U17 | The Marked Gate | The GM tells the hunter privately which gate on the board holds something unusual, and nothing else | One player knows, the others do not. Does it say? | GM ONLY |
| U18 | The Locked Answer | Another hunter's player tells this hunter's player one true thing about its past, privately | A relationship begins with a secret | BUILDABLE TODAY (a boon) |
| U31 | A Second Hearing | Boon: once, when the GM rules against you, another player may argue the case and the GM must reconsider out loud | It makes another player your advocate | GM ONLY |
| U33 | Scout's Word | Boon: before one gate, the GM shows its monsters to this hunter only | Whether to share is the decision | BUILDABLE TODAY (a boon) |
| U34 | One True Thing | Boon: the next time you go down, the GM tells you one true thing about this gate before your first death save | It makes going down worth something, and it is told at the most tense moment | BUILDABLE TODAY |

### 6.2 Bargains with a clause

| # | Reward | What it is | Why it changes a decision | Mark |
|---|---|---|---|---|
| U05 | Clause Seven | 3 ability points now. The GM writes a clause and seals it. The clause is revealed when it fires | Every player who is offered one must decide whether to sign without reading | NEEDS N17. Today the GM writes it on paper |
| U16 | Pick the Price | A stat gets +4. The player picks one of three costs: speed -10%, hpMax -20, or pre -2 | The cost chosen says who the hunter is | BUILDABLE TODAY (as a title the GM builds from the pick) |
| U22 | Debt to the Gate | The hunter leaves a gate with its loot early, and owes the gate a return within 3 sessions. If it does not return, the gate breaks | The loot is in hand. The clock is real | GM ONLY |
| U32 | Hostage Gold | 10,000 gold that cannot be spent until a quest is done. If the quest fails, the gold goes to another hunter the player names | The player picks who would profit from their failure | NEEDS N9, N17 |
| U44 | The Weight of a Crown | A mythic item with large bonuses. While it is worn, a nonplayer of authority makes one demand a session. Refusing a demand takes the item | Power with a voice attached | GM ONLY (the demands). The item is BUILDABLE TODAY |
| U13 | Heavy Purse | 2,000 gold that must be spent on another hunter before the next session, or it is gone | A gift that is really a choice of who | NEEDS N17 |
| U21 | Two Doors | The GM offers two sealed rewards. The player picks one. The other is given to another hunter of the GM's choice, and both are opened together | A choice whose cost lands on a friend | GM ONLY |

### 6.3 Gifts that must be passed on

| # | Reward | What it is | Why it changes a decision | Mark |
|---|---|---|---|---|
| U02 | The Passing Lantern | Accessory, rare. Worn: `alert`. It must be given to another hunter within 3 sessions, or it goes dark (no status). Each holder writes one line in its description | Who gets it next is a statement | NEEDS N17, feature 5 (trading) |
| U26 | The Echo Blade | A weapon. Each time it passes to a new holder, every past holder alive gets 1 ability point, and its line of holders grows | Passing it on pays the past | NEEDS N16, feature 5 |
| U39 | The Rescuer's Coin | A coin the hunter must give to whoever next saves its life. The receiver gets 1 ability point and must pass it on in turn | It turns being saved into a ritual | BUILDABLE TODAY with the GM's hand. Feature 5 automates it |
| U30 | Lent Strength | Give 2 of your ability points to another hunter for good. The GM repays 3 when he judges the loan has mattered, with a sign after 3 sessions | Generosity with a delay | NEEDS N17 |
| U42 | The Unasked Help | Boon: the GM sends help once, without being asked, at the moment the GM thinks worst | The player gives up the choice of when | BUILDABLE TODAY |

### 6.4 Debts

| # | Reward | What it is | Why it changes a decision | Mark |
|---|---|---|---|---|
| U12 | Marker | An item (material, `tell: true`): a nonplayer's debt to the hunter, which can be sold or given to another hunter. Used, the GM has the debtor pay | A debt is a thing you can trade | BUILDABLE TODAY |
| U25 | Inherited Debt | A dead hunter's item, passed with its debt: pay 5,000 gold, or wear the title In Arrears (L06) | Taking an inheritance means taking its weight | NEEDS N16 |
| U36 | Forgiveness | The hunter's penalty record is cleared: the tally's penalties go to 0, and the System says so | Something taken away is the reward | NEEDS N11 |
| U40 | A Truce | The GM promises one gate where no monster of one type attacks first | A debt the world owes, spent on a choice of gate | GM ONLY |

### 6.5 Places, memories and promises

| # | Reward | What it is | Why it changes a decision | Mark |
|---|---|---|---|---|
| U04 | A Room Upstairs | A room in the Association's building. Once a session, a long rest there also ends one status | The party plans its rests around one hunter's room | BUILDABLE TODAY (a boon) |
| U06 | Forgotten Fight | One drawback title is removed, and the fight that earned it leaves the chronicle | The player chooses whether to forget | NEEDS N11 |
| U07 | Name Day | The hunter names its weapon. At its 10th kill under that name, its dice rise one step | A weapon becomes a companion to keep | NEEDS N1, N7 |
| U08 | Pinned | One kept fact of the player's choice is pinned in the chronicle and never ages out | Players pick what they want remembered | NEEDS a pinned fact (X05) |
| U10 | The System's Promise | Your next level comes with a gift chosen from what you did most since the last one | It makes the player watch their own habits | NEEDS N17, N1 |
| U23 | A Name for the System | The hunter may name the System. Its windows to this hunter then use that name | The player's relationship with the System becomes personal | NEEDS a window's words per hunter (X08) |
| U29 | The Day Off | One day's dailies excused with the streak kept, if the player tells the table what the hunter did instead | A rest that becomes a scene | BUILDABLE TODAY (a boon the GM honors) |
| U35 | A Letter from the Dead | The player of a dead hunter writes a letter, sealed, to be opened at a moment the GM picks | A death that speaks again, later | NEEDS N17 |
| U37 | The Empty Slot | Leave one gear slot empty for good, and get +2 on a stat the GM picks while it stays empty | A permanent choice about gear | NEEDS N21 |
| U41 | Vow Vessel | An empty item the player writes a vow into. While unbroken, dis +1. Broken, it becomes Cracked Vessel (no bonus, sells for 0) | The vow is carried in the bag | NEEDS N21 |

### 6.6 Relationships and later arrivals

| # | Reward | What it is | Why it changes a decision | Mark |
|---|---|---|---|---|
| U11 | A Rival Assigned | The GM makes a rival hunter, a nonplayer at the hunter's rank, who appears in its gates. Beating it once pays a title | A relationship as loot | GM ONLY |
| U14 | The Long Letter | A sealed reward the GM writes now and opens when he chooses. The System shows him a sign after 5 sessions | Five sessions of wondering for one sentence | NEEDS N17 |
| U15 | Planted | An item. Use it to plant it. When the GM decides it has grown (a sign shows him after 10 world days), it becomes an item one rarity higher, picked by the GM | Planting it means not using it | NEEDS N17 |
| U19 | Split Token | Two halves, given to two hunters. While both are held by different hunters, each has +1 on one stat. If one half is sold, both go dark | Two players are now responsible for each other | NEEDS N15 |
| U20 | Grave Goods | A hunter buries an item with a fallen ally. In a later gate the GM gives one of the same rarity, "returned by the dead" | Giving something up becomes a promise | GM ONLY |
| U24 | A Monster's Favor | A speaking monster spared (A54, S07) gives its favor: once, monsters of its type ignore this hunter for a fight | Mercy that pays in the same coin | GM ONLY |
| U27 | Undo One Scene | Once, the GM rewinds one scene of the last session and lets the hunter choose again | The rarest reward in the file | GM ONLY |
| U28 | A Seat on the Other Side | The player plays one scene as a nonplayer the GM controls, a villain included | Players remember the night they played the monster | GM ONLY |
| U38 | The Gate That Remembers | A personal gate with the hunter's name, which the GM reopens when he likes, with the same monsters one step harder each time | A place the hunter keeps coming back to | NEEDS N3 |
| U43 | Heirloom Seed | An item that does nothing in the hunter's life. On its death, it becomes a legendary item for its heir | A reward for someone else, later | NEEDS N16 |

That is 44 rewards (U01 to U44).

## 7. Stories the GM runs

the owner's ruling (Nov 18): "the story modes have to be active table by me. They should [move] entirely at the GM pace and I should be able to make my own stories." So every arc here is a **story**: the GM turns it on, for the whole table or for one hunter, and moves it from one chapter to the next by hand. Nothing in a story starts by itself, and nothing in it moves by itself. A clock, a count or a fact never advances a chapter.

What the System may do is notice. A chapter may carry a **ready sign**: something the System can see in the facts (a gate cleared, a hunter down twice), shown only to the GM as a quiet line ("C04, chapter 2: ready. Brakk spared a foe in session 12."). The GM decides whether that means the chapter is over. A sign is a hint, never a trigger. A chapter with no sign is moved when the GM says so.

The single feats of section 4 are unchanged: they stay automatic, because each is one moment, not a story.

How to read a story:

- **For**: the table, one hunter, or two.
- **Turn it on when**: the moment the GM might start it. A suggestion, not a condition.
- Each chapter has **Told** (what the players read in the System's window when the GM opens the chapter: the window title in the System's voice, then plain words), **Gives or asks** (the quest it issues, the reward, or the choice it puts to the players) and **Ready sign** (optional, for the GM's eyes only).
- A chapter's quest is an ordinary quest. Its objectives may count themselves (N8) or be ticked by hand, but completing it does not open the next chapter. The GM does.
- A story can be paused, skipped ahead, rewritten mid-way or ended early. The GM may also open a chapter's words to one hunter only.

Mark for every story: **GM ONLY today**, run by hand with the quest form, bundles and titles that exist. **NEEDS N23** to run from the app: a story as content (a name, who it is for, chapters with their words, rewards and quests, a sign each), turned on by the GM for the table or a hunter, moved by the GM's tap, with its signs shown on the GM's phone only. Where a chapter also needs another capability, it says so.

The same ruling covers everything else in this file that unfolds over time. A sealed reward (U05, U14, U35), a prophecy title's check (L04), the System's question (X17) and a title's next stage when it is a story's (L18, L19, L30) open when the GM opens them, with a ready sign at most. N17 is read that way throughout: a reward sealed until the GM opens it.

### C01 The deep keeps accounts

For one hunter. Turn it on when: the hunter is at its lowest, down twice in a session or broke after a lost gate.

| Chapter | Told | Gives or asks | Ready sign (GM only) |
|---|---|---|---|
| 1. The offer | THE DEEP HAS NOTICED YOU. Something below the gates offers strength now, and says it will ask for something later. It does not say what | Asks: accept or refuse. Accept gives the title Owed to the Deep (L24, str +4, pre -2). The GM writes the clause on paper, sealed. Refuse ends the story, and the deep never offers again | None |
| 2. The quiet | THE DEEP IS PATIENT. Nothing is asked. The title is worn | Nothing. The GM leaves it running for a few sessions, long enough that the table forgets | Three sessions have passed since chapter 1 |
| 3. The first ask | THE DEEP ASKS FOR A GATE. A gate of your rank, alone | A quest: win one solo run of your rank | A solo run of the hunter's rank won since the chapter opened |
| 4. The clause | THE DEEP READS YOU THE CLAUSE. The GM reads the sealed clause aloud | Asks the hunter to pay what it says (the GM's choice: a stat point, an item, a promise, a gate entered for someone else). Paying turns the title into Square (L06). Refusing keeps the title and opens chapter 5 | None |
| 5. Collection (only if refused) | THE DEEP COLLECTS. It takes 1 ability point each session until one gate of the hunter's rank is cleared | A quest: clear a gate of your rank. The GM takes the points by hand until it is done | A gate of the hunter's rank cleared |

### C02 The foretold

For one hunter. Turn it on when: a rank up, or a first session at a new table.

| Chapter | Told | Gives or asks | Ready sign (GM only) |
|---|---|---|---|
| 1. The naming | THE SYSTEM HAS READ AHEAD. It names one deed the hunter will do ("will close a gate above its rank", "will carry an ally out") | Title Foretold (L04, ins +1). A quest with the deed as its one objective and no reward line | None |
| 2. The waiting | THE PROPHECY STANDS. A line, nothing more | Nothing. The GM runs the campaign as usual | The deed's fact appears in the hunter's chronicle |
| 3a. Fulfilled | THE SYSTEM WAS RIGHT. The deed is done | The title becomes Fulfilled (ins +2, pre +1) | None |
| 3b. False | THE SYSTEM WAS WRONG. RECORDING THE ERROR. Opened instead of 3a when the GM decides the time has run out | The title becomes False Prophecy (ins +3, pre -1). The GM may start this story again at the next rank with a harder deed | Ten sessions since chapter 1 with no sign from chapter 2 |

### C03 Carry the name

For the table. Turn it on when: a hunter dies (feat S29 tells the GM it happened).

| Chapter | Told | Gives or asks | Ready sign (GM only) |
|---|---|---|---|
| 1. The empty place | ONE OF YOU STAYED IN THE GATE. The dead hunter's name, its rank, and the session | Asks the dead hunter's player to name an heir among the living, or none. Witness (L20) to every hunter who was in the fight | None |
| 2. The last gate | THEIR LAST GATE IS STILL OPEN. The gate the dead hunter fell in, or one it had marked | A quest: clear that gate. Every hunter of the table may count toward it | That gate cleared |
| 3. The inheritance | WHAT THEY CARRIED IS YOURS. To the heir | The heir gets In Their Place (L17) and the open quests of the dead (L18). The heirloom item, if any, passes | None |
| 4. The letter (optional) | A LETTER WAS LEFT. The dead hunter's player reads a letter they wrote in chapter 1, to the table | Nothing but the scene. The GM picks the moment | None |
| 5. Finished | THE NAME IS CARRIED. When the heir has finished the dead hunter's quests | Finished For Them (pre +2) to the heir, and a last line in the dead hunter's chronicle the heir's player writes | The heir has no open quest it inherited |

Needs also: N16 (the heir's titles and quests). Today the GM copies them by hand.

### C04 What was spared returns

For one hunter. Turn it on when: the hunter spares a foe that can speak (A54, or feat S07).

| Chapter | Told | Gives or asks | Ready sign (GM only) |
|---|---|---|---|
| 1. Let go | IT WILL REMEMBER YOUR FACE. The foe's name, if it gave one | Nothing yet. The GM notes the foe | None |
| 2. Rumor | SOMETHING YOU SPARED HAS BEEN SEEN. Where, roughly | A quest with one objective: find it. No due time | None |
| 3. The meeting | IT IS HERE. The foe appears in a gate, changed | Asks the hunter, in the scene: fight, talk, or leave. The GM decides what the foe wants | None |
| 4a. An ally | IT CHOSE YOUR SIDE | A Monster's Favor (U24) | None |
| 4b. A second mercy | YOU LET IT GO TWICE | The foe becomes a person in the world, with a name the player gives it. Title The Spared One's Shadow (L26) | None |

### C05 The second name

For one hunter. Turn it on when: the hunter reaches level 10, or its player says they want to know who it really is.

| Chapter | Told | Gives or asks | Ready sign (GM only) |
|---|---|---|---|
| 1. Unweighed | THE SYSTEM HAS NOT DECIDED WHAT YOU ARE | Title Unweighed (L03), no bonus. The GM writes four lines of a hidden description, sealed | None |
| 2 to 4. A line each | THE SYSTEM HAS WRITTEN ONE MORE LINE. One sealed line read out | +1 on the stat behind the hunter's largest lifetime number, added to the title each time | The hunter ranked up since the last chapter |
| 5. The name | THE SYSTEM HAS NAMED YOU. The last line is a name | Asks: take the name as the title, or refuse it and keep Unweighed forever (N18 records the refusal) | The hunter reached the next rank |

### C06 Seven doors

For the table. Turn it on when: a season of play begins, or the party has outgrown the board.

| Chapter | Told | Gives or asks | Ready sign (GM only) |
|---|---|---|---|
| 1. The doors | SEVEN DOORS HAVE APPEARED. Each is named for a virtue: restraint, mercy, patience, loyalty, honesty, courage, grief | The GM places seven gates on the board as the story goes, one at a time, in the order he likes | None |
| 2 to 8. One door each | THE DOOR OF (VIRTUE) IS OPEN. What it asks, in a line | A gate whose quest asks that virtue in play: win without striking (restraint), spare its boss (mercy), wait three rounds before acting (patience), bring everyone out (loyalty), tell the truth when asked (honesty), go in at worse odds (courage), finish a dead hunter's task (grief). A door passed gives the table a title of that door (D, +2 on one stat) | The feats that match each door: S01, S07, S22, S37, A11 given, A60 given, S30 |
| 9. The last room | ALL SEVEN ARE OPEN. Behind them, a room | An A-rank title the table names together. Doors failed stay closed, and the story still ends here | None |

### C07 The one behind you

For one hunter. Turn it on when: the hunter starts to pull ahead of the party, or gets comfortable.

| Chapter | Told | Gives or asks | Ready sign (GM only) |
|---|---|---|---|
| 1. A name on the list | ANOTHER HUNTER IS FOLLOWING YOUR RECORD. The rival's name | The GM makes a rival hunter, a nonplayer, at the hunter's rank (U11) | None |
| 2. One step behind | IT IS ONE GATE BEHIND YOU. The rival appears in a gate or a town scene and talks about the hunter's record | Nothing. The rival is a voice | None |
| 3. Passed | IT IS AHEAD NOW. Opened when the GM judges the hunter has stalled | A quest: catch up (a gate of the rival's rank, or the deed it bragged of) | Two sessions with no gate cleared and no kill by the hunter |
| 4. The meeting | IT IS WAITING AT THE GATE | Asks: duel, alliance, or walk away. A duel won gives a title the GM writes. An alliance gives the rival as a nonplayer ally once | None |

### C08 The wager

For one hunter. Turn it on when: the hunter brags, or wins a coin call it should have lost.

| Chapter | Told | Gives or asks | Ready sign (GM only) |
|---|---|---|---|
| 1. The bet | THE SYSTEM WILL TAKE THAT BET. You will not win your next three solo runs | Asks: take the bet, staking 1 ability point a run, or refuse and nothing happens | None |
| 2. The runs | THE SYSTEM IS WATCHING THE NUMBERS. A line after each run, opened by the GM | Each run lost, the stake is taken | A solo run finished since the last line |
| 3a. Won | THE SYSTEM PAYS. 5 ability points and the title Beat the House (C, ins +2) | None | Three solo runs won |
| 3b. Lost | THE HOUSE KEEPS THE STAKE. DOUBLE OR NOTHING | Asks: one more run for double. Won, the System's only annoyed window. Lost, the story ends | A solo run lost |

### C09 The quiet year

For one hunter. Turn it on when: a hunter has been doing dailies and little else, often because its player has less time.

| Chapter | Told | Gives or asks | Ready sign (GM only) |
|---|---|---|---|
| 1. Unlit | THE SYSTEM HAS NOTICED THE MORNINGS | Title Unlit (L01). The GM moves its stages as chapters, not by count | None |
| 2 to 4. Ember, Brand, Beacon | THE LIGHT IS GROWING. One line about a gate the hunter did not enter | The next stage of L01 | Ten dailies done since the last chapter |
| 5. The kept room | THE SYSTEM KEPT THIS FOR WHOEVER WAITED | A gate only that hunter sees: no monsters, a room, a chest. Inside, Naming Rights (first file R39) and one item the GM chooses | None |

### C10 The heir

For one hunter's line. Turn it on when: a hunter retires, or its player leaves the table and names someone to carry on.

| Chapter | Told | Gives or asks | Ready sign (GM only) |
|---|---|---|---|
| 1. The naming | THE LINE PASSES. The old hunter names its heir, in character if possible | In Their Place (L17) to the heir | None |
| 2. The objects | THESE WERE THEIRS. Each heirloom item named | The items pass. Each one's holder count begins (L19) | None |
| 3. The unfinished | THEIR WORK IS YOURS. The old hunter's open quests | The heir takes them (L18) | None |
| 4. Done | THE LINE IS SQUARE | Finished For Them (pre +2) and the old chronicle's last line | The heir has no inherited quest open |

Needs also: N16.

### C11 The mirror gate

For one hunter. Turn it on when: a hunter holds three drawback titles, or keeps repeating one mistake.

| Chapter | Told | Gives or asks | Ready sign (GM only) |
|---|---|---|---|
| 1. A gate only you see | THIS GATE IS FOR YOU ALONE | The GM makes a gate whose monsters are named for the hunter's worst facts ("The Forgotten Potion", "Ten Tails") | None |
| 2. The run | THE MIRROR IS WAITING | A solo run against it, or a fight the GM runs with the hunter alone | The run or fight finished |
| 3a. Won | THE MIRROR CRACKED | One drawback title of the player's choice removed (N11, or by hand) | None |
| 3b. Lost | THE MIRROR KEEPS YOUR FACE | The gate stays on the board. The GM may add one monster before the next try | None |

### C12 The unfinished map

For the table. Turn it on when: the party is about to split up, or one player keeps carrying the others.

| Chapter | Told | Gives or asks | Ready sign (GM only) |
|---|---|---|---|
| 1. The pieces | THE MAP WAS TORN. EACH OF YOU HAS A PIECE | Each hunter gets a quest only it can finish, written by the GM for that hunter | None |
| 2. The pieces fit | PIECES FOUND: (count) | The GM opens this chapter again as each piece is finished, so the table sees the count rise | A piece's quest completed |
| 3. The gate | THE MAP IS WHOLE | A gate one rank above the party, loot one rank better, and Same Gate, Same Day (L40) to all who clear it | Every piece's quest completed |

If a hunter dies before its piece is done, the piece passes to its heir (C03 or C10).

### C13 The System grows curious

For one hunter. Turn it on when: the GM finds a hunter whose record does not fit a type (many mercies, few kills, or many falls and no deaths).

| Chapter | Told | Gives or asks | Ready sign (GM only) |
|---|---|---|---|
| 1. A question | THE SYSTEM HAS A QUESTION. One question about a choice, picked by the GM ("WHY DID YOU STOP") | Asks the player to answer in character. The answer is kept as a fact | None |
| 2 to 4. More questions | THE SYSTEM HAS ANOTHER QUESTION | One question each, opened when the GM likes | The hunter made a choice the System's record calls unusual (a spared foe, a refusal, a gate left closed) |
| 5. The test | THE SYSTEM WANTS TO SEE IT AGAIN | A quest: do the thing the System least expects, the GM's pick | None |
| 6. Filed | THE SYSTEM CANNOT CLASSIFY YOU. Or, if the GM ends it the other way: THE SYSTEM HAS FILED YOU AS ORDINARY | Unclassified (A, ins +2, dis +2), or nothing | None |

That is 13 stories.

## 8. Making your own

### 8.1 A blank story

```
Name:
For: the table / one hunter (name) / two hunters (names)
Turn it on when: (a suggestion to yourself, not a rule)
Ends when: (the last chapter, or "when I say so")

Chapter 1. (name)
  Told: WINDOW TITLE IN THE SYSTEM'S VOICE. One or two plain lines.
  Gives or asks: (a quest, a reward, a title, a choice put to the players, or nothing)
  Ready sign (optional, mine only): (a fact the System can see)

Chapter 2. (name)
  Told:
  Gives or asks:
  Ready sign:

Chapter 3a / 3b. (a branch, if the players' choice in chapter 2 splits it)
  Told:
  Gives or asks:
  Ready sign:
```

Every part of a chapter but its window title may be left empty. A story of one chapter is fine. It is a window you send when you choose.

### 8.2 Writing a good one

**Start from a moment, not a plot.** The best stories here begin with something a player did (spared a foe, made a bet, lost a friend) and ask what would follow. Write the first chapter, then stop. Write the second after the table has played the first.

**A chapter is one session's worth of pressure, at most.** Most chapters should be told in a minute and lived in one or two sessions. If a chapter has not moved in three sessions, either the table does not care about it or you made it too hard. Open the next one, or end the story.

**End a chapter when the table has answered it, not when the objective is done.** The ready sign tells you something happened. Whether the chapter is over is whether the players have made their choice about it. A quest finished with no feeling can wait. A quest half-finished with a great scene can close.

**Ask, do not only give.** A chapter that only gives a reward is a gift. A chapter that asks a question ("accept or refuse", "fight or talk") is a story. Aim for every other chapter to ask something.

**Leave room for what the players do.** Write what the System says, never what the hunters do. Give a chapter a branch only where the players choose, and keep each branch short. If the players do something you did not write, write the next chapter around it. That is the point of moving it by hand.

**Keep the words short and cold.** The window title is the only line in the System's voice. The body is one or two plain sentences: what happened, what is asked. Players read it on a phone in the middle of a game.

**Keep the rewards small until the end.** A point or a boon per chapter, a title at the end. A story's last chapter can be as large as the rare awards in section 3.

**Run at most two at once for the table, and one per hunter.** More, and the table cannot tell them apart.

**Let a story fail.** Some of the best ones here (C02's False Prophecy, C08's lost wager) are better when they go wrong. Write the failure chapter as carefully as the success.

**Steal from your own table.** A running joke, a nonplayer the players love, a promise from session 3. Those make better stories than anything in this file.

## 9. What the new capabilities would let us do

The game is gaining a chronicle per hunter (facts, a tally, the last 40 facts kept), feats as content, quests that count themselves, titles that carry statuses, and two-tap awards from the GM. Section 11 of `notes-1-feats.md` lists 13 uses. This list goes further, and repeats only where it adds something. Ranked by how much a table would feel each.

| Rank | # | What becomes possible | What it needs | Why a table feels it |
|---|---|---|---|---|
| 1 | X01 | **A recap at a session's start.** Sent when the GM starts the session. The System's "LAST TIME" window on every phone, a line per hunter from its kept facts of the last session, plus the awards the GM gave | `recapOf` in core, N13 | The first minute of every session, and the GM stops writing recaps |
| 2 | X02 | **Beliefs a player writes.** A player writes what its hunter believes ("I will not leave anyone in a gate"). It is a quest with no objective that the GM taps "tested" when play challenges it. A belief tested and kept pays a point. Tested and broken, the player rewrites it and gets a point too | A quest kind `belief`, the award's tap on it, a `belief` fact | It turns roleplay into the main loop, at the player's own initiative |
| 3 | X03 | **A spotlight line for the GM.** On the board: sessions since each hunter's last award and since its last kept fact. "Eldrin: nothing in 3 sessions." | The session of the last `given` fact beside the tally | It answers the owner's own ask from the other side: who has not had a moment |
| 4 | X04 | **A ledger of promises.** Every promise the GM marks at the table (A51) listed with who made it, to whom, and the session. Kept or broken is a tap, and the System counts them | N20, a `promise` fact | Promises made in play are the threads players forget, and the GM can pull them months later |
| 5 | X05 | **The chronicle as prose.** The System's account of a hunter, by session, in its cold voice, shareable. Players pin facts they want kept (U08) | Sentences per fact kind in core, a pinned flag | Players read about themselves, and share it |
| 6 | X06 | **A window to the whole room.** A feat earned, a rare award, a death: told to every phone at once, with a sound | N13 | The table goes quiet together |
| 7 | X07 | **Legends and heirs.** A dead or retired hunter's record as an entry on a Legends list, with its titles, feats and last facts. Heirs name it in their titles | A `legends` list on the save, N16 | Deaths are rare and should be remembered as more than a deleted row |
| 8 | X08 | **A System with moods.** The System's window lines vary per hunter with its record: colder to the reckless, almost warm to the patient, mocking to a bench warmer. A hunter may give it a name (U23) | A words table in core keyed by tally ratios, a window's words per hunter | The System becomes a character each player knows differently |
| 9 | X09 | **Rivalries the System notices.** Two hunters whose numbers stay close for 3 sessions are named rivals in a window. Overtaking is a fact | N6 on the GM's phone | Friendly competition with no one having to declare it |
| 10 | X10 | **Sealed rewards and prophecies.** A reward the GM opens when he chooses, with a sign on his phone when its moment may have come | N17 (the GM opens each) | Wondering is play. It costs a sentence |
| 11 | X11 | **Anniversaries.** "TEN SESSIONS AGO, TODAY" windows from kept facts: a first gate, a death, a promise | The kept facts with their session, a rule for which to recall | Memory is what a long campaign is for |
| 12 | X12 | **Epithets.** The System names each hunter by its most unusual lifetime number compared to the room ("the one who heals", "the one who falls"), shown under the name | N1 and N6 | A reputation nobody chose |
| 13 | X13 | **The road not taken.** After a loss, the odds engine plays the fight again many times and says how often it went the other way, and what changed in those plays | The odds engine on a saved fight, a summary of differences | It makes a loss into a conversation instead of a sulk |
| 14 | X14 | **The table's moment, voted.** At a session's end, each player taps the moment they liked best from the session's facts and awards. The GM confirms. The winner gets A61 | A vote message, a short window | The players reward each other, which no GM can do as well |
| 15 | X15 | **Feats for the GM.** Sessions run, awards given, hunters lost, promises kept. A title for the GM the players vote on | A chronicle for the GM's seat (N20) | the owner is a player too |
| 16 | X16 | **A campaign timeline.** Every hunter's kept facts and the GM's marks laid out by session and world day, and the GM may add a period or an event by hand | A merged view of chronicles, a GM note fact | A shared history to point at |
| 17 | X17 | **The System asks.** At a session's end, the GM may have the System ask one player one question from its record ("WHY DID YOU SPARE IT"). The answer is kept as a fact and read back in the recap | A question picked by core from the session's facts, an `answer` fact | The table hears a player explain a choice in character |
| 18 | X18 | **Contracts between players.** One hunter offers another a counted quest with a stake in gold (feature 5's trading). The System holds the stake | N8, feature 5 | Players make their own stories with stakes |

The three I would build first: X01 (the recap), X02 (beliefs a player writes) and X03 (the spotlight line). Close behind is N23, the stories of section 7 as content, since the owner asked to make his own. Each sits on what is being built now, each is felt every session, and together they make the System a witness of roleplay rather than a counter of kills.

## 10. Sources

"Search" means a web search's summary was read this session. Page fetches were not tried, since the first file found them blocked. "Memory" means the note is from what the writer already knew. No text, name or character from any work is used. Each gave a shape.

| Source | How read | The one structure or feeling taken |
|---|---|---|
| Burning Wheel (beliefs, instincts, traits, artha) | Search, forum summaries | Pay for acting on a belief, and pay again for changing it when play tests it. X02, A36 |
| Pendragon (passions, inspiration, madness) | Search, forum and design journal summaries | A passion can be called on for strength, and failing it scars. L24, L25, the failure feats |
| Blades in the Dark (vice, trauma, XP triggers) | Search, the Roll20 compendium's summary | Experience for a weakness that caused trouble, not for a strength used well. Section 4.3 |
| Ten Candles (truths, moments, brinks, the hope die) | Search, review summaries | A moment written ahead that pays when it happens, and a resource burned whether it works or not. U34, A48 |
| Apocalypse World | Memory | Moves that trigger from the fiction, and experience marked by relationships. A24 to A27 |
| Fiasco | Memory | Relationships and needs as the engine, and things going badly as the fun. U21, U32 |
| Microscope | Memory | A history built in periods and events, by anyone at the table. X16 |
| Gilgamesh | Memory | A friend's death that sends the survivor on a long walk. C03 |
| The Odyssey | Memory | A name hidden and a name revealed, and the cost of boasting it. L37, A10 |
| The Mahabharata | Memory | Vows that bind beyond reason, and duty that costs. L21, L29 |
| The Norse sagas and the Eddas | Memory | Bynames given by others, often for one day, and inheritance of feuds and swords. L30, L19, U26 |
| The Mabinogion | Memory | Prohibitions that shape a life and gifts with conditions. L21, U37 |
| Journey to the West | Memory | A long road of trials, each a test of a different virtue. C06 |
| Fairy tales and their bargains | Memory | The bargain with a clause unread, the third choice, the gift that must be returned. U05, U21, U02 |
| The Arabian Nights | Memory | Stories nested in stories, and a teller who survives by telling. L20, X17 |
| Ovid, Metamorphoses | Memory | A person changed into a name for what they did. L03, C05 |
| Dante | Memory | A walk through ordered rooms of consequence. C11 |
| Milton | Memory | Pride offered a crown, and the refusal as the stronger act. L14 |
| Melville | Memory | A single obsession that costs a crew. C07 |
| Dostoevsky | Memory | A crime confessed, and the weight of a secret carried. A48 to A50 |
| Borges | Memory | A record that holds everything, and the impossibility of reading it all. X05, X12 |
| Calvino | Memory | A city described as a list of what it remembers. X11 |
| Le Guin | Memory | True names that give power to whoever knows them. L37, U23, C05 |
| Gene Wolfe | Memory | A narrator who remembers everything, and the unreliable record. X05, L04 |
| Tolkien | Memory | Oaths that doom the swearer's line, and a burden that must be carried by someone. L25, U43 |
| Pratchett | Memory | A personified force with a dry voice and a soft spot nobody admits. X08, C13 |
| Peake | Memory | Ritual duties in a house nobody remembers the reasons for. L20, L21 |
| Susanna Clarke | Memory | A bargain with an old power that takes something no one thought to protect. C01 |
| Ted Chiang | Memory | Knowing the future and choosing it anyway. L04, C02 |
| Ishiguro | Memory | Duty kept long past its meaning, and memory as a choice. U06, L29 |
| Cormac McCarthy | Memory | Carrying a fire, a coin flip that decides a life. U39, S18 |
| Miyazaki's films | Memory | Mercy toward monsters, and a monster that becomes a friend. A54, A56, C04 |

What the first file already took is not repeated here: no entry is built on Solo Leveling, the litRPG series or the video games its section 8 lists.
