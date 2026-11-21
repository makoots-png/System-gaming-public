# For the owner

A running list of what needs your call. The lead adds to it and strikes a line when you answer; your answer goes into the trail (`decisions.tsv`) in your words. Newest section first. Nothing here blocks work unless it says so.

## Open

### 1. The economy on the live site (asked Nov 21)

Grades and shared gate pay are on the working branch, not on `main`. The lead is holding the PR into `main` until the items lane lands, because a consumable still costs half there, which you have replaced. Say "merge now" if you want it live as it is.

### 2. Rule calls the state machines rest on (asked Nov 20)

Each machine is being built to behave as the app does today, with the row below named in its table, so your answer is a one-row change. Each line is Neon's proposal; the lead recommends yes unless it says otherwise. Answer "yes to all" or by number.

1. Does a dead hunter get nothing from a rest or a level-up (no mana, no Exhausted cleared, no uses back)?
2. Does taking off a status clamp HP, mana and fatigue to the new maxima at once, and is max HP at least 1?
3. Does a status stop counting the moment its time runs out, even when its last tick is still owed? (Built as yes, Nov 21: before, a hold, a taunt and the fight card stopped at once while wards and buffs lasted until the bearer's turn, so one answer had to be picked to make them agree. No is one word in `STATUS_COUNTS`, `src/core/combat/standing.ts`.)
4. Does a broken channel released on its user's own turn cost the user that turn?
5. Must the owed dice be rolled before a turn can end?
6. May a hunter who is down arm a reaction, and do a reaction's kills count?
7. Does lowering max fatigue to the current fatigue collapse the hunter at once, and is a hunter who reaches full fatigue in a fight collapsed in the fight too?
8. Are pending (unconfirmed) points handed back when the level drops, and does rank follow level unless the GM marks it as set by hand?
9. Does a day feat count a fact on the day it happened, not the day the fight ended?
10. Does a feat set to never show stay hidden after it unlocks, and does a feat with an extra condition unlock when the condition becomes true later?
11. Does a shadow at 0 HP leave the field and refuse to be summoned until healed?
12. Does using a consumable in a fight take the player's turn?
13. Does the Dice view's default DC follow the active hunter's rank?
14. Does a gate the GM closes to solo runs refuse a run already in flight?
15. When an urgent quest runs out on a player's phone, does the GM's room hear of it?
16. Does a quest with any hand-ticked objective keep its Complete button?
17. Does the world day only move forward, and does a gate past its break day break whatever edit put it there?
18. Does a held Give… wait for its own two seconds even when other notices arrive?
19. Is a System whisper to one hunter sealed from the other phones?
20. Does rule (d) mean that rewards the app pays by itself (a room solo clear, a counted quest, a feat, a Give… from the shelf) wait for the GM's edit and approval?
21. How do the free first revive and the revive on debt (rule a) appear in the app: a System raise, or a GM button that spends the step?
22. Does a Resurrection Crystal handed over by another hunter after death count as bought before the death?
23. Stealth, the lead's ruling to confirm (built in unit 2): by your ruling 1 a body is hidden only from sight of a lower level, and everyone's sight starts at 0, so a hide at level 0 would hide from nobody. A hidden status with no level written is level 1, and level 0 is not offered. Say if a plain hide should be something else.
24. Icons, to confirm: the first set is taken from one outside set (game-icons, CC BY 3.0), by your ruling that drawings may come from elsewhere if they look consistent. That licence asks for credit, so the Rules page's foot gets a credit line. Say if you would rather every icon were drawn here.
25. Tenacity (his idea of Nov 21, below under Answered): a true blend, the geometric mean of Strength and Discipline through today's curve and cap (the lead's default, built unless he says otherwise), or Discipline as the base with a smaller bonus from Strength? The blend lowers a pure-Discipline build's Tenacity against today.

### 3. The enemy balance pass and item stats (asked Nov 21)

Eight questions, each a line, in `features/enemies/balance-plan.md` under "Questions for the owner". The default is built if you do not answer: (1) flat magic penetration is named Unravel (or Spellbreak, Sever); (2) percent penetration comes from Control for armor and magic both, physical builds get theirs from items; (3) a mythic is beaten about half the time by four hunters at level 100, almost never at S's first level; (4) Construct, Ooze, Spirit and every mythic cannot be extracted; (5) a monster's type means nothing in a fight for now; (6) lifesteal and ability haste become new item stats, capped at 20% and 25%; (7) mana regen and slow resist are left out; (8) an item's bonus may pass a stat's curve cap.

### 4. Enemy armor by rank: which of two ways (asked Nov 21)

Making an enemy's body come from rules gave every body free armor and resist by its rank's gear tier (+30 at S for a full set) with nothing that hits harder beside it. An S boss then takes 10.9 rounds (the bound is 8) and 11 simulation rows are out, so the unit (`balance-2`) is not merged. No setting of the other numbers brings all rows back; the two that nearly do:

- **A. Drop the free armor by rarity tier** (a written design rule goes), make the six armor pieces add up to the kit exactly, boss HP at 2.8 times: every row is back inside but one (the boss's channel being broken, 0.064 against its bound).
- **B. Keep the tier's armor and slow HP growth by level** (`growthDiv` 24 to 31): the hits to fell a same-rank brute are as before at every rank, but every hunter's and monster's max HP drops, and five rows stay out (three duels, the blood kit's pack at S, the channel).

The lead's pick if you say nothing: A. It moves one rule and leaves everyone's HP alone, and a boss is still tougher by HP, armor and resist through its kind, as you ruled. The numbers are in `rw/sim-log.md` on the branch `balance-2`.

### 5. The coin: does the player see anything of the landing? (asked Nov 21)

You typed (Nov 21): "Also with coin flips, the point is they call heads or tails, and I flip it.  Only I know the result, not them.  I should be able to pick the result based off the coinflip or my own discretion." Today: a natural 1 or 20 on a check outside a fight calls the coin; the player calls heads or tails; your phone gets a window with Right, Wrong, or let the coin decide; the player's phone then shows the coin land on a side that agrees with your ruling (never the true flip when you ruled by hand), so the player learns whether the call was right. Your second sentence is built. The first is the question: should the player's phone show (a) the side, as today, (b) only that the coin was flipped, with no side and no right or wrong, and you say the outcome at the table? Nothing changes until you answer.

### 8. The coin's Chronicle fact in a room (asked Nov 21)

A player's phone no longer learns how the coin landed, so in a room it can no longer record "called the coin right" or "wrong" in the Chronicle (it would tell the player the outcome). Built default: a coin you rule in a room records no coin fact; a coin flipped alone still does. Say if you want the fact kept another way (for one: recorded when you choose to reveal it).

### 9. The fudge factor: four defaults the build uses (asked Nov 21)

Say only what you want otherwise (`features/notes-8-fudge.md` section 6, numbers 10 to 13):
- a. Your own roll outside a fight (your phone's dice tray, no hunter) is not weighted. "My own rolls" are the foes' in a fight.
- b. The weight you set outside a fight does not carry into a fight, and a fight's does not carry out: a fight starts at 0, the table's weight stays until you set it to 0.
- c. The shadow extraction's Presence check is not weighted while your phone rolls it.
- d. +2 means 2 faces on every die, a d4's the same as a d20's.

## Answered

- Nov 20: consumables priced by rank and how long they last (staple 0.1, one fight 0.5, one gate 1, escape stone 2): "Sure yes."
- Nov 20: crafting, professions and new item types after trade unit 2: "2.  Ok"
- Nov 20: more than two helpers when their code does not overlap: standing rule.
- Nov 20: every implicit state machine is made explicit, no scoring.
- Nov 21 (typed in the lead's session, to "a blast aimed straight at a hidden body its user can already see hits it but does not reveal it; say if every area hit should reveal"): "Yes it should hit". The lead reads it as: every area hit reveals, whoever it was aimed at.
- Nov 21 (to the ambush at 1.5 and 1.25 against a boss): "I mean the goal is that stealth will do more dmg.  Also for bosses, I don't want them to halve or quarter effects.  The goal is that they just have more hp, armor, magic resist, etc... than other enemies." So the ambush stays a damage multiplier, and a monster's kind no longer shortens or weakens what lands on it (`fight.kinds.*.control` goes): a boss or an elite is tougher by HP, armor and resist.
- Nov 21 (typed in the lead's session, after the ruling on bosses): ".  Maybe we add a stat called tenacity which works just like league tenacity, I'd probably make it a product of strength and discipline or something.  Idk maybe throwing more of a bone to those stats." Tenacity exists (derive.ts: from Discipline, cap `fight.tenacityCap` 60; effect-ops.ts `lasting`: a control status lasts duration * (100 + potency) / (100 + tenacity)); the lead told him so and proposed feeding Strength in by the geometric mean of the two stats. To build as a small unit after `rulings-1121`, measured with it by the simulation (both move how long control lasts on a boss).
- Nov 21 (typed in the old lead's session after its hand-over, relayed by that session, not yet confirmed by him in the new lead's): "Ok I think we should add in all the LoL stats.  Lethality, armor pen %, magic pen (we should give it a name like lethality), and % magic pen.  Thoughts?  Questions?" Asked which stat feeds each, whether monsters get them and whether today's flat-penetration gear becomes Lethality: "I think we should figure that out during our balance run." Then: "But I do like the idea of being able to get more % pen on items, or flat pen on items, etc..." So today's two penetration stats (`derive.ts` `pen`, a share from Control, and `penFlat`, flat, gear only, each against armor or resist, whichever the hit meets) become four (flat and percent, for armor and for resist), an item may hold each of the four, and their sources, names and numbers are settled in the enemy balance pass (`features/enemies/README.md`, item 9). A name proposed for flat magic penetration: Unravel.
- Nov 21 (the same relay, after his line on percent and flat penetration on items): "And armor and resist, hp, shield buffs from LoL, everything." Read as: an item may hold the whole set of stats a League of Legends item can (the four penetrations, armor, resist, max HP, shield effects, and the rest of that set, to be listed in the balance pass's plan and ruled on by him). Today a worn item holds weight, armor, resist, flat penetration, a stat bonus while worn and a worn status. Goes into `features/enemies/balance-plan.md`.
- Nov 21 (the same relay, on what "everything" includes): "Idk about attack and ability power.  I think that's hard to do." So physical, magical and support power are not stats an item may hold; an item raises power through the base stats it can already raise. `balance-plan.md` section 10 is changed to say so, and unit 1 leaves `phys`, `mag`, `sup` out of `BONUS_KEYS`.
- Nov 21 (typed in the lead's session, answering Open 3 question 6): "No cap on life steal, no make haste work like it does in LoL now, where cdr adds in a way that's not purely additive.  Look up their formula and use it." So lifesteal has no cap, and ability haste is LoL's: a cooldown is its base times 100 / (100 + haste), haste adds point by point and each point gives the same number of extra uses, so no amount brings a cooldown to 0 (looked up on the League wiki, which names a ceiling of 500 haste). Built as the unit `haste-lol`.
- Nov 21 (typed in the lead's session): "There should also be heal% increase, damage converted to shields, etc... do some research on the full suite of league stats and implement as you see fit." So the lead decides which of League's stats and item effects the game takes; a planner researches the full set and writes `features/enemies/item-stats.md` (what exists under another name, what is new, what is left out and why), then it is built in units.
- Nov 21 (typed in the lead's session, right after the League stats): "And actives and passives that scale with stats". So an item's passive (its worn status, a trigger) and an item's active (an ability the item gives while worn, with its cooldown) may each have amounts that scale with the wearer's stats and sheet numbers. A planner adds it to `features/enemies/item-stats.md` as section "Actives and passives that scale" with what exists and the units.
- Nov 21 (the next line): "Or are flat or are a combo of the two". So one amount of an item's active or passive may be flat, scale with a stat, or be both (10 + 20% of max HP). The `item-scaling` planner has it.
- Nov 21 (typed in the lead's session): "When we do our balance pass let's look at how league does stats.  Their balance system is pretty good, but that's like for a tier.  There should be some variation in how strong or weak an item is.  Let's also determine what the strongest stats are in that balance run, so we can decide how rare to make them.  Things like lifesteal are ok to be on the stronger side because they should be rare to gain.  Also titles/feats should have stat bonuses or extra powers attached to them." Recorded as items 10 to 12 of what the balance pass must decide (`features/enemies/README.md`); titles and feats holding powers is in the `item-scaling` plan (a title holds a bonus today, no power).
- Nov 21 (typed in the lead's session, answering Open 3 question 3 and adding a feature): "A mythic should be basically impossible to beat, like 5-10% odds for a party of 3. There's something else I want to add, a \"fudge factor\" where I can click it and give a weight to their rolls.  Either lowering them or raising them.  This should NOT be visible to the players.  Like if they encounter a mythic I want to be able to raise their rolls to give them a chance." The mythic bound is in `balance-plan.md` section 4 and the sweep (three hunters at S win 5 to 10%). The fudge factor is feature 8, designed in `features/notes-8-fudge.md`.
- Nov 21 (the next line, on the fudge factor): "Also I should be able to \"fudge factor\" my own rolls". So the GM's hidden weight also covers the GM's side (the monsters' rolls, the GM's own), up or down. The `fudge` designer has it as one mechanism with a scope.
- Nov 21 (typed in the lead's session, on his "B." and on Open 4): "B for the fudge factor.  I honestly don't know the correct way to approach balancing, you have a better view of the numbers.  The only way I can give you balancing ideas is through results." The lead's reading, told to him: his B is Open 5's b (the player's phone shows only that the coin was flipped, no side and no right or wrong; he says the outcome at the table), and Open 4 (enemy armor) is the lead's call: package A (the free armor by rarity tier goes, the six pieces add up to the kit, boss HP 2.8). **Standing from this**: a balance number is the lead's to set and explain; the owner gives results he wants at the table (a mythic at 5 to 10% for a party of 3) and the lead turns each into a bound of the simulation. Balance questions are no longer asked of him as numbers; Open 3's defaults stand.
- Nov 21 (answering Open 6, the fudge factor's nine defaults): "It absolutely can touch damage dice.  It does reset to 0.  Sure that works.  Let's do away with death saves entirely.  I don't know what this means.  No bound -- Have an option to force either a 1 or a 20 just for the next roll. Fine.  Fine.  Yes." Recorded as the last section of `features/notes-8-fudge.md`; the two that need more of him are Open 7.
- Nov 21 (on what replaces death saves): "Youre dead.  You need to be ressed.  Btw when a res crystal is used, you cleanse all status effects.  Like a poison doesn't immediately re-kill you." So a hunter at 0 HP is dead: no dying, no stable, no death save, no getting up on a 20; only a resurrection brings it back (the Resurrection Crystal, the GM's own raise). A resurrection removes every status on the hunter. A unit of its own, `no-death-saves`, built after `balance-2` lands (the simulation's "goes down" and "dies" bounds change meaning with it): `src/core/hunter/vitals.ts` (the life machine: up, dead), `row-life.ts`, `rules-text.ts` (`downLine`), the crystal's use, the charts, the simulation's bounds restated as deaths.
- Nov 21 (answering the fudge factor's number 5): "5.  Just have my fudge factor affect how their dice rolls." So the weight also applies to a player's rolls outside a fight (a stat check, the dice roller on their phone). In `features/notes-8-fudge.md`, ruling 5.
- Nov 21 (what a player sees of a weighted roll): "Ok so they will click a roll or whatever, they will have the dice rolling animation or whatever, it'll show what they get.  That should already be pre-weighted by whatever fudge factor I put on, + whatever bonuses they get.  So ideally it like shows a dice face + bonus number = final number.  Make sure this works for advantage and disadvantage and stuff." In `features/notes-8-fudge.md`, the part after the rulings.
- Nov 21 (how hidden the weight must be): "Idc if the data is on their phone, they just need to not be able to see it on the website." So the weight may be on a player's phone and applied there; no screen shows it. In `features/notes-8-fudge.md`, ruling 5.
- Nov 21 (typed in the lead's session, answering the lead's question whether to open and merge a PR into `main`): "When this is done feel free to commit/push/merge/deploy whatever". So a lead opens a PR into `main` and merges it as units land on the working branch, without asking; "Merge as they land" stands. The live site follows `main`.
- Nov 21 (typed in the lead's session): "Ok for our balance pass, also have it look at how good the stats are if they aren't planning to already, and where we should source things like % pen, lethality, tenacity, etc..." Item 13 of what the balance pass must decide (`features/enemies/README.md`): each of the eight stats measured for what it is worth, and a table of where each derived number comes from.
- Nov 21 (the result he wants from the stats): "The stats should be roughly equal in strength, with benefits to pushing towards a single or a few stats in particular as a class." Two bounds in item 13 of the balance pass's README. Today's curve (`effExp`) makes spread points worth about as much as stacked ones, so it is measured and then moved, or a class is rewarded another way.
- Nov 21: "Specializing should pay off for sure." Item 13's second bound must hold.
