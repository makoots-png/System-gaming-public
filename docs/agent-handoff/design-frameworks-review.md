# Review of the design frameworks (branch `design-frameworks`)

Written Nov 19, 2026, against the working branch `claude/nifty-keller-3nvune` at 37e0d68f. The reviewed branch is nine commits by "Hunter Builder" on top of 04091a8c (Nov 17). Nothing from it is merged.

## For the owner, on a phone

Grok wrote eight proposals with code beside them. Nothing in play uses that code. My verdict on each:

1. Job kits, skills by job and rank. Keep the idea and rebuild it as content you make in the Workshop.
2. XP curve, each rank takes more fights per level. Take it without the level cap of 100.
3. Daily points cap and streak titles. The cap is your call. Drop the titles, because the feats Early Riser and Iron Routine already give them.
4. Failure costs. Drop the revive price, because it goes against your resurrection ruling. Rebuild the gate stakes, and the rest limit waits on a question already asked of you.
5. Monsters and boss phases. Take the 12 monsters after a solo odds check. Build boss phases as a trigger you can put on any monster.
6. Skill prices. Take it with changes. Taunt already works in fights and only needs a built-in skill.
7. Gates as rooms and a job board. Your call, and I would not build it. It goes against your rulings on solo runs and on stories you pace.
8. Check DCs, any hunter passes an easy check about half the time. Take it. It is 18 numbers in one table.

Do first, in this order:

1. Framework 8, the check DCs.
2. Three fixes where the Rules page or a rule says what the game does not do: the daily's points, red and double gates, old monster notes.
3. Framework 2, the XP curve, once you answer question 2.

Questions only you can answer, each with my default:

1. Should there be a top level? My default is no, as you ruled.
2. Should each rank take more fights per level than the one before? My default is yes.
3. Should the daily keep giving a point every day with no limit? My default is yes. You can already change it in the rules.
4. Should Necromancer stay on the list of starting jobs? My default is yes.
5. Should the app lay out each gate as rooms? My default is no. You run the inside of a gate.
6. Should the app itself make a red gate pay more and forbid leaving? My default is no, and the Rules page says it is your call.

## How this review checked each claim

Every claim below was checked against the working branch, not against the base the branch was cut from. I made two throwaway worktrees: `/home/user/sg-review` at origin/design-frameworks, and `/home/user/sg-review-now` at 37e0d68f with the branch's `src/core/design/`, `scripts/design-paper.ts` and `tests/design-*` copied in. In the second, the branch's own script printed its tables from today's rules. Only one table changed (framework 04's gold table, below). One claim about risk was measured on the odds engine (framework 05). "What I ran and read" at the end lists each command and its last lines.

Two faults run through the whole branch:

- **The docs have no tables.** Every doc's "Worked examples" block is empty (`<!-- paper:01 -->` on one line, `<!-- /paper:01 -->` on the next, in all eight). The script's pattern needs a newline after the open mark and another before the close mark (`scripts/design-paper.ts:165`), so it never matches an empty block. `--write` writes nothing, and `--check` and `tests/design-paper.test.ts` pass on every doc whatever the code says. The test that is meant to keep the docs current checks nothing. The tables in this review come from running the script.
- **The citations point at things that do not exist.** The README cites "the Deferred list in `GAME-UPDATE.md`" (README line 5). No such file exists, on the base or today. Frameworks 01 (line 25) and 03 (line 25) cite a deferred "Player lockdown" and "GM approval of quest completion" in `features/plan.md`. Neither is in plan.md, then or now. Each blast radius was written for the Nov 17 base and misses solo runs, the odds engine's measured numbers, the Resurrection Crystal, feats, stories and trade.

## 01. Job kits and skill levels

**1. The claim, and whether it is true.** A level gives 3 ability points and nothing else, a job changes no number, and a skill's level does nothing. Any player can add any built-in skill, and Necromancer is on the signup list although the owner ruled shadows rare. This is true today: `src/views/skills.js:312` lists every `SKILL_SEEDS` entry for any phone, `levelUpSkill` (`src/core/hunter/skills-held.ts:29`) moves a number that no formula reads (a search of `formula.ts`, `resolve.ts` and `rows.ts` finds no read of a skill's level), and `src/views/onboard.js:194` lists every `RULES.jobs` entry. One claim is false. The "Arise loophole" (doc line 94) does not exist: holding Arise gives no extraction, because `canExtract` reads the job (`src/views/shadows.js:17`, `src/views/combat.js:821`).

**2. What it proposes.** Each of the seven jobs gets a signature skill at the Job Change and a pick of one skill from two at C, B, A and S rank (levels 20, 35, 50, 70). Eleven of those skills ship today and 50 are new names with one-line briefs and no fight ability. A skill point comes every 5 levels, each skill level adds 4% to its dice up to 1.36 times at level 10, and Necromancer leaves the signup list.

**3. Whether the numbers hold.** The script's numbers match the doc: skill points 0, 1, 3, 6, 9, 13 at levels 1, 10, 20, 35, 50, 70, and the factor 1.36 at skill level 10. The tests state the rule's arithmetic (tiers at the rank levels, `floor((level - 1) / 5)`), so they are written from the rule. They test only the design module, which nothing in play calls. The doc's claim that the fight simulation's bounds hold because its builds use level 1 skills is unmeasured, and the doc says so.

**4. Rulings.** It works against the owner's priority of customizability ("The ability to make custom abilities, status effects, custom rewards, items, enemies", START-HERE.md). `JOB_KITS` is a TypeScript table keyed by the built-in job names (`src/core/design/job-kits.ts:33`), while a GM's rules may name jobs of his own (`jobs: entries(text)`, `src/core/overrides.ts:114`). A GM's own job would get no kit and the GM could not change one. The Necromancer change reads "shadows are not going to be common... I'd rather that real estate be used elsewhere" (plan.md) as a ruling on signup. That ruling was about screen space and was "Done in PR 36". Whether shadows should be pickable at signup is still his to say. His intro story (plan.md, Nov 19) wants each hunter's class to come from what the player does in the story, "a lot to choose from", which a fixed job-to-kit table would narrow.

**5. Cost to wire today.** It touches `src/views/skills.js` (both the list and the player's own skill maker), `src/core/combat/resolve.ts` (a factor on every skill's dice, so every fight, the odds, solo runs, the worth bar and `tests/fight-sim.test.ts` move), `hunter/job-chain.ts`, `onboard.js`, `save.ts` (a `picks` field) and the sheet push. It adds a third way to grant a skill beside the GM's rewards, feats and story chapters, and a fourth if framework 06's starter kits by path also land (a Ranger on the seeker path gets Marked Shot from both). The browser tests that add a built-in skill from the list would fail.

**6. Verdict: take the idea and redesign it.** Two parts are worth doing. A skill's level should do something, as a rule number in `RULES.fight` with a GM override, gated by points. A job's kit, if the owner wants kits, should be a field of a job the GM makes and shares (a parser, a maker, a pack line), with the shipped jobs' kits as editable built-ins. Drop the 50 placeholder skills and the Arise reasoning. Necromancer at signup is question 4.

## 02. XP pacing and a level cap

**1. The claim, and whether it is true.** A level costs `100 × level` XP while a normal monster's XP triples each rank, so the last E level takes 36 E kills and one S kill is worth more than a level. Every gate's monsters are built at their rank's first level, so a level 34 hunter fights level 20 bodies. True: `xpPerLevel: 100` and the `rankTable` XP of 25, 75, 250, 800, 2500, 8000 (`src/core/rules.ts:19-31`), and `monsterStats` reads `pointsAt(R.rankLevels[rank])` (`src/core/hunter/derive.ts:206`). The branch's script on today's rules gives the kills to cross each rank today as 180, 193, 162, 79, 48 and 32 for E to S.

**2. What it proposes.** A level costs a number of same-rank normal kills times that monster's XP. The number rises inside each rank: E 3 to 6, D 6 to 10, C 8 to 12, B 10 to 14, A 12 to 16, S 14 to 20, rounded to two figures (75 XP at level 1, 450 at 10, 160,000 at 99). The game stops at level 100. A gate gets a band that builds its monsters at the start, a third or two thirds into their rank.

**3. Whether the numbers hold.** The arithmetic matches the doc (kills to cross each rank become 40, 80, 150, 180, 280 and 513). The tests check the spans and the order of ranks from the goals, not from the code's output. Two errors:

- The blast radius says `gainXp` is the one caller. `lifetimeXp` in `src/core/hunter/progress.ts:86` writes the linear curve out again (`R.xpPerLevel * level * (level - 1) / 2`), and the GM's level edit (`setLevel`) depends on it. Swapping only `xpToNext` would make the GM's level edit give wrong XP. `src/views/rulesref.js:92` has its own copy of the formula, and line 134 states it in words.
- S has no normal monster today (framework 05 counts it), and personal gates at S draw from the nearest rank that has normals (`pooled`, `src/core/gates/solo.ts:70`). So "S kills" are A kills in solo play, and an S level would cost 44 to 64 A kills.

**4. Rulings.** The cap contradicts "Every hunter can rise in rank and level, as the app has it. No ceiling is built." (plan.md, rulings of Nov 19, late) and the trail's "no rank ceiling (every PC can rise in rank and level)" (decisions.tsv, 2026-11-19T14:00Z). The curve itself contradicts nothing, and `xpPerLevel` is a GM override today, so the kills table must stay one.

**5. Cost to wire today.** `rules.ts` (`xpToNext`, the kills table in `RULES` with its reader in `overrides.ts`), `progress.ts` (`gainXp`, `lifetimeXp`, `MAX_LEVEL`), `rulesref.js`. The bands touch `derive.ts`, `rows.ts`, `GateFields` and `parseGate`, the world doc and its size arithmetic, the solo doc, and every measured number of solo runs and the odds (`features/notes-2-solo.md` section 16). The doc already warns that the S pack row sits at 4.93 rounds against a bound of 5 (`rw/sim-log.md:936`).

**6. Verdict: take with changes.** Take the curve as rules data that a GM can override, with one cost function that both `xpToNext` and `lifetimeXp` read. Keep no cap, and let S levels past 99 keep costing 20 kills. Leave bands for a later unit after a simulation run. Question 2 decides whether to start.

## 03. Daily points, daily XP, streak titles

**1. The claim, and whether it is true.** Perfect dailies give 8 ability points a week (1 a day and 1 more every 7th day of a streak), while a level gives 3. Daily XP is a flat 25 at every level, and `RULES.dailyRewardPoints` changes only the Rules page's words. True: `DAILY_REWARDS` points 1 (`rules.ts:11`), `STREAK_BONUS_POINTS = 1` (`src/core/hunter/grant.ts:216`, given at line 244), and `dailyRewardPoints` is read only by `src/views/rulesref.js:136`. The last is a real live fault: one number in two places, and a GM who changes the one the page reads changes nothing in play. Since the base, the feats Early Riser (7 days, a title with +1 Discipline) and Iron Routine (30 days, +2 Discipline) also reward the streak (`src/core/registry/feats.ts:100-104`). Whether dailies outrun fights depends on how many levels a table gains a week. The script assumes 2 to 12 weeks per rank and labels that an assumption (`scripts/design-paper.ts:66`).

**2. What it proposes.** Daily points stop at a cap per rank (3, 3, 4, 4, 5, 5), counted by rank so a rank-up opens the next cap. Daily XP becomes 5% of the level's cost, at least 25. The 7-day bonus point goes, and streaks of 7, 30 and 100 days give titles with no stat bonus.

**3. Whether the numbers hold.** The arithmetic matches. Two errors. The doc says daily XP "follows this curve" (framework 02), but the code reads today's `xpToNext` (`src/core/design/daily-rewards.ts:35`). Under 02, the 5% would be 8,000 XP a day at level 99, one S kill a day, and no doc says so. The table row "Days of dailies per level" (`scripts/design-paper.ts:78`) divides today's cost by the proposed XP, which is 20 by construction at every level past the floor.

**4. Rulings.** The streak titles duplicate the shipped feats, which a GM can edit, turn off and share in the Workshop. "Titles with no stats" contradicts what ships. The cap meets no ruling, but it changes the game's daily quest, the hook of its source material. A GM can already set the daily's points to 0 in the rule overrides.

**5. Cost to wire today.** `grant.ts` (`finishQuest`), `quests.ts`, `quests.js` (the bonus text), `rulesref.js`, `overrides.ts`, a new `daily.earned` hunter field with its repair and the sheet push. A second streak reward would sit beside the feats that count `daily` facts.

**6. Verdict.** Fix the double number now: one daily-points rule that both the grant and the Rules page read. Drop the streak titles. Hold the cap for the owner (question 3). Take the XP share only together with framework 02, with its numbers worked out on 02's curve.

## 04. Failure: revive costs, gate stakes, rest limits, retreat, breaks

**1. The claim, and whether it is true.** Losing costs nothing. The GM's Revive is free, a broken gate lets nothing out, red and double gates are only words, short rests are unlimited, nothing allows or forbids a retreat, and gold stops mattering at S. Mostly true, with two changes since the base:

- Red and double gates change nothing in play. The red banner (`src/views/gates.js:404`) and the Rules page (`rulesref.js:193`: "No exit until the boss dies. DCs inside +3. Time inside runs ×10.", "A hidden second dungeon") state rules the code does not play. No code reads `gateSpawn.redDcBonus` except those two views. A broken gate is a status and a line ("Broke on day N. Monsters are loose", `src/core/gates/gate.ts:179`). Rests are unlimited (`src/core/hunter/vitals.ts:178`).
- The GM's Revive is free on purpose, by the owner's ruling of Nov 18. Gold now has a sink at S: the Resurrection Crystal costs 100,000 (`src/core/registry/items.ts:99`). Run on today's rules, the doc's gold table becomes 1.3 S clears for the priciest item (the doc says 0.3, or "four times over" at line 165), and 1,000 clears at E.

**2. What it proposes.** A revive costs half the least gold a gate of the hunter's rank drops (25 at E, 15,000 at S) and a day of a new Weakened status. A table of stakes by gate type: no retreat from red and break gates, and a retreat costs 25 fatigue elsewhere. Red pays 1.5 times and adds 3 to DCs, double pays 1.25 times with a hidden room, a party takes two short rests a gate, and a gate left to its break day lets out a break gate with half of each roster line and the boss.

**3. Whether the numbers hold.** The revive arithmetic matches. The tests mostly restate the tuning table (25 fatigue, 1.5 times). The TLA+ model proves less than the doc says. Its invariants restate the actions' own guards. `NoRetreatFromRed` holds because `Retreat` requires `~red`, and `BreakOnlyOutside` checks only `day = MaxDays` (`GateRun.tla:12, 16, 21, 24`). The model lets days pass only while the party is outside (`GateRun.tla:16`), but the live gate machine breaks a gate while a party is raiding it (`raiding: { ... dayAdvanced: breaks }`, `src/core/gates/gate.ts:93`). I could not run TLC: no `tla2tools.jar` on this box.

**4. Rulings.** The revive price contradicts "So GM determines resurrection. There should be a resurrection crystal but they should be incredibly expensive to buy." and the lead's reading of it: "no System resurrection for a price in XP, and none for free. The way back is the GM's Revive, as today, or a Resurrection Crystal" (plan.md, Resurrection). The doc's line "a solo death uses the same revive price" (line 174) contradicts it too. On rests, the gap the owner was asked about is the long rest: "Not asked yet: a long rest is a tap on the sheet and undoes a run's HP, mana and fatigue at once. Say 'limit long rests'" (for-the-owner.md, Solo runs). The framework limits short rests inside a gate run and leaves the long rest alone, so it misses that gap.

**5. Cost to wire today.** The revive price touches `vitals.ts`, `protocol.ts` (`RevivePayload`), `inventory.ts`, a new status, and the solo path (`soloRan`). The stakes touch `rules.ts`, `overrides.ts`, `pay.ts` (factors on XP and loot), `gates.js` and `rulesref.js`. The break gate touches `world.ts` on the GM's Advance day and the world doc. The rest cap needs a gate run, which is framework 07.

**6. Verdict: take the idea and redesign it.** Drop the revive price and Weakened. Make the Rules page true now: either a type's rules become a `RULES` table the game plays (pay factors, a DC bonus the dice tray offers inside such a gate), or the page says the GM rules a red gate's exit and a double gate's reveal. Question 6 picks which. A break gate made by the GM's Advance day is a sound small unit. Leave the rest limit to the owner's answer on long rests.

## 05. Enemy variety and boss phases

**1. The claim, and whether it is true.** The bestiary has gaps: from B up every normal monster is a brute, S has no normal or elite monster, and E has no boss. Notes on 17 monsters name rules the game dropped (AC, advantage, feet), and no boss changes during a fight. True on today's code: the branch's script gives the same 11 gaps and 30 dead terms in 17 monsters on the working branch. A GM cannot build a phase today either, because no trigger fires on an HP share (`BearerEvent` and `Need` in `src/core/combat/triggers.ts:19, 37`).

**2. What it proposes.** Twelve new built-in monsters, one for each gap and an E boss, written in the bestiary's own row type. Each dead note is cut, or built for four bosses (Cerberus, Beru, Baran, Igris). Every boss gets a default phase at half HP: 1.15 times the damage, 10 more speed and 2 same-rank normals once. Three maps are to be made in the map maker.

**3. Whether the numbers hold.** Each proposed ability builds under today's rules (the branch's test). The phase numbers (1.15, +10, 2 adds) were never simulated, and the doc says to run the simulation first. The new monsters were not run against `tests/monsters.test.ts`'s single-hit cap. I measured the one risk the doc leaves out, the solo pools. The proposed E Goblin Brute against each starter pregen, alone, 200 plays on the odds engine (seed 7):

| Pregen | One shipped Goblin: won, dead | One proposed Goblin Brute: won, dead |
|---|---|---|
| Brakk Ironhide (tank) | 94%, 4% | 84%, 8% |
| Mira Vale (ranger) | 90%, 6% | 97%, 2% |
| Eldrin Voss (mage) | 97%, 1% | 100%, 1% |

A new hunter's first personal gate is one monster of its rank, chosen because it is "the fight every pregen clears in 95 to 99% of plays" (`src/core/gates/solo.ts:79`). A Goblin Brute in the E pool would make that gate twice as deadly for a tank.

**4. Rulings.** None contradicted. The owner's priority is that the GM makes monsters in the maker. A default phase hard-wired into every boss gives him less control than a trigger he can put on any monster.

**5. Cost to wire today.** `src/core/registry/monsters.ts` (rows, checked by its table test), `gates/spawn.ts`, and also `gates/solo.ts` and `gates/personal.ts`, which the blast radius misses. At S, personal gates would draw S monsters instead of A ones, and the measured solo numbers move. A boss phase in the reducer touches `fight.ts`, `summons.ts`, the fight doc, the charts and the fight model. Built as a trigger it is one recipe of AGENTS.md (a trigger event: `BEARER_EVENT_SET`, `eventsOf`, `LEAVE_TEXT`, the maker's select, `eventRates`).

**6. Verdict: take with changes.** Cut or rewrite the dead notes now (a copy task, no rule changes). Add the monsters after the solo pools are measured again and `notes-2-solo.md` section 16 is updated, keeping the even gate even. Build the phase as a trigger on an HP share ("when HP first falls to half"), let the built-in bosses use it, and simulate the boss rows. Making maps needs no code and can happen any time.

## 06. Skill prices

**1. The claim, and whether it is true.** The worth bar gives a skill with a cooldown the same budget as one without, so cooldown skills are weaker than a plain attack and never chosen. No built-in skill costs mana, none taunts, and one heals. Partly true. The bar's budget has no cooldown term (`standardHeld`, `src/core/registry/worth.ts:294-306`), and the simulation log records that Marked Shot and Shield Wall are never taken (`rw/sim-log.md:661-662`). The taunt part is false. The `taunt` op exists (`src/core/combat/effect-ops.ts:141`, worded "Must attack the one who taunted it" at line 698), the policy obeys it (`src/core/combat/policy.ts:115`), the simulation's tank uses one (`tests/models/fight-sim.ts:87`), and `RULES.fight.tauntRounds` exists. A GM can make a Taunt skill in the maker today. Only a built-in skill is missing, so it is not "the largest new mechanic here" (doc line 81).

**2. What it proposes.** A priced skill must be worth its budget plus 10% per round of cooldown and 3% per point of mana. An audit of the built-ins finds every cooldown skill under that target, and the fix is bigger numbers rather than shorter cooldowns. Mage and Healer skills get mana costs, and each build path starts with a kit of two skills, the warden's with Taunt.

**3. Whether the numbers hold.** The premium arithmetic is right. The audit's one "fair" row is fair by construction. A curse's budget is defined as what Arc Bolt holds ("A curse's is Arc Bolt", `worth.ts:297`), so Arc Bolt's worth equals its budget (1.08 against 1.08). The doc offers that row as evidence (line 73). The worked example (Marked Shot at 2d6 reaching 0.79) is not computed by any code or test. The one heal, Mending Aura, is "not weighed", so the audit says nothing about heals. The 10% is labelled a guess.

**4. Rulings.** None contradicted. The premium changes the worth line every GM sees in the skill, status and item makers, so it belongs in `RULES.fight.kit` where he can override it. Starter kits by build path overlap framework 01's kits by job.

**5. Cost to wire today.** `worth.ts` (the worth line in three makers; `tests/worth.test.ts` "the bar agrees with the simulation" must hold), the numbers in `registry/abilities.ts` (the simulation, the odds and the solo measurements move), `starter.ts` and `onboard.js` for the kits.

**6. Verdict: take with changes.** Put the premium in `RULES.fight.kit` and show it on the worth line. Ship a built-in Taunt skill that uses the existing op. Raise Marked Shot and Shield Wall by a simulation run, not by the audit. Drop the starter kits by path unless the owner takes job kits, and then make one kit system.

## 07. A gate as rooms

**1. The claim, and whether it is true.** A gate is a name, a rank, a type, a roster and a boss, and play inside it is whatever the GM improvises. Nothing records how far a party got, and no Association hands out work. True of the data (`GateFields`, `src/core/gates/gate.ts:24`). The GM's play inside a gate is the design of this app, which the owner runs at his table. Since the base he has also gained stories that he paces chapter by chapter (`src/core/story/`).

**2. What it proposes.** A gate becomes 2 to 6 rooms before its boss (fight 50, trap 20, treasure 15, rest 15 by weight), dealt from its roster by a stored seed, with a hidden room in a double gate and no rest rooms in red or break gates. The party's place in the run is a machine stored on the gate. Later, an Association board of contracts is filled by the System, and two skills show the room kinds before entering.

**3. Whether the numbers hold.** The room shares hold over 1,000 seeds (fights 51% to 57%), and the tests replay the run's paths, written from the rule. Three faults in the design:

- The hidden room has no content. `{ kind: 'hidden' }` carries no monster, so the double gate's "second boss" has nothing to fight (`src/core/design/gate-plan.ts:26, 82`).
- The run breaks only while the party is outside, but the live gate machine breaks a raiding gate (`gate.ts:93`).
- `down` then `revived` revives the whole party at once. Today revival is per hunter, by the GM's Revive or a crystal, and a down hunter may be dead.

**4. Rulings.** Running solo runs room by room until the first loss (open decision 3, line 114) contradicts "A solo run always resolves; the odds set the cost... No fight is played out on screen" and "resolves in one step from the odds" (plan.md). An Association filled by the System contradicts "a story... never starts by itself. The GM turns a story on for the table, each of its steps happens when the GM says so" (plan.md, Stories) and the feats' default that the owner accepted, "No feat issues a quest or moves anything along by itself... Quests and stories stay yours to start" (for-the-owner.md). "A gate plays without a GM preparing it" (line 17) is the same direction.

**5. Cost to wire today.** This is the largest change of the eight. It touches `gate.ts` (two fields, its table and lint), `parseGate`, the world doc and the size arithmetic in `protocol.ts`, the solo doc, `gates.js` (its largest screen change), `combat.js` (a fight per room), `pay.ts` (a clear that pays what is left) and `solo.ts`. It would add a second way to sequence play beside stories.

**6. Verdict: hold for the owner (question 5).** If he says yes, the smallest useful form is a room list the GM can reroll and read as a suggestion, with no run state on the gate and no System board. My recommendation is no.

## 08. Check DCs

**1. The claim, and whether it is true.** A check is d20 plus half a stat's effective points above base plus the rank bonus, and its DC is the gate rank's. The DCs climb with a trained main stat, so from B up a stat nobody trained passes only on a natural 20. True. The branch's functions on today's rules give the same table: an untrained hunter of the gate's rank passes the C easy check 25% of the time and every B, A and S check 5% of the time. `statBonus` and `checksOf` (`src/core/hunter/sheet.ts:170, 180`) and `rankTable` (`rules.ts:26-31`) are unchanged since the base.

**2. What it proposes.** Each rank's DCs are set from what a hunter of that rank rolls. Easy is 10 over an untrained stat's bonus, hard is 10 over a built main stat's bonus, and standard sits between them. The new DCs are E 12/14/15, D 13/17/21, C 14/21/28, B 15/26/37, A 16/31/46 and S 18/38/58. An assist from a second hunter is advantage.

**3. Whether the numbers hold.** The table matches the doc (C hard stays 28, S hard goes from 55 to 58). The tests that say 55% at every rank cannot fail while `over` is 10, because a DC 10 above the bonus is 11 faces of 20 by construction (`check-dc.ts:38`). The test of today's DCs reads the live table and is real evidence. The trained bonus leaves out path perks, gear and titles (`check-dc.ts:59-61`), so a real built hunter is a few points higher. Under the new numbers a trained hunter passes standard 90% to 95% from C up (75% to 85% today), so standard is close to automatic for the specialist. That is a choice to make knowingly.

**4. Rulings.** None contradicted. A GM's override of `rankTable.*.dc` keeps winning.

**5. Cost to wire today.** The 18 numbers in `rules.ts`, `checkExample`'s E standard example in `src/core/rules-text.ts:30` (13 becomes 14) and its test. The dice tray (`src/views/dice.js:215`) and the Rules page read the table unchanged.

**6. Verdict: take with changes.** Write the numbers into `RULES.rankTable` with the rule in a comment. Do not ship `check-dc.ts` as live code beside the table it would derive. Test the behaviour from `checksOf` on built hunters (untrained easy about half, trained hard about half). Put the assist on the Rules page as a table rule.

## Over all eight

**What to do first, for the most play at the least risk:**

1. **Framework 08, the check DCs.** It is one table of numbers that GM overrides keep reaching, and every non-combat check at C and above becomes playable for the whole party.
2. **The three truth fixes.** One daily-points rule read by both the grant and the Rules page (03). The red, double and break gate lines on the Rules page and the red banner, made true one way or the other (04, question 6). The dead monster notes rewritten or cut (05). Each is small, and each removes words that tell a table a rule the app does not play, the same class of fault the first-run pass fixed on the Rules page.
3. **Framework 02, the XP curve, without a cap.** It changes pacing the most and touches more (progress, the GM's level edit, solo measurements), so it waits for the owner's answer to question 2. The boss phase as a trigger (05) is the next best after these.

**What the owner decides before any of it is built:** questions 1 to 6 in the first section. Question 2 gates the XP curve, 3 the daily cap, 4 the signup list, 5 framework 07, and 6 how framework 04's gate stakes are made true. The long-rest limit is already on his list in `for-the-owner.md` and decides framework 04's rest part.

**What should not be merged, whatever he decides:**

- `src/core/design/*.ts`. Each restates a live rule beside its owner: `xp-curve.ts` beside `xpToNext`, `check-dc.ts` beside `rankTable`, `failure.ts`'s stakes beside `gateSpawn.redDcBonus`, `kit-economy.ts` beside `worth.ts`, `enemy-roster.ts`'s rows beside `SEEDS`. AGENTS.md wants one place per rule. A framework that is taken moves its numbers into `RULES` and its rows into the registries in its own unit, and the design module never exists in play code.
- `scripts/design-paper.ts` and `tests/design-paper.test.ts`. The check passes on empty blocks (`design-paper.ts:165`).
- `tests/design-*.test.ts`. They test code that play does not call. Where a framework is taken, its tests are written against the live function.
- The TLA+ model in `docs/design/frameworks/models/gate-run/`. Its invariants restate its guards, and it disagrees with the live gate machine on breaks.
- The widened parameter types in `src/core/rules.ts`. They exist only for the design modules. They are harmless, but the branch's design code fails `tsc` without them (5 errors on today's tree).
- `docs/dependency-map.md`. It conflicts on merge, and `bun run deps -- --write` regenerates it.

The eight docs can stay on the branch as the owner's material. If they are kept in the repo, they need their stale facts marked (the missing tables, the false citations, the false taunt and Arise claims, the gold table before the crystal). This review is the record of the decision, and each part taken starts as a fresh unit on the working branch.

## What I ran and read

Read in full: `.claude/skills/poteto-mode/SKILL.md`, `docs/agent-handoff/START-HERE.md`, `docs/agent-handoff/features/plan.md`, `docs/agent-handoff/handoff.md` sections 1 to 4, `AGENTS.md` (the tables of where things live and the recipes), `docs/agent-handoff/copy-tasks.md`, `docs/agent-handoff/for-the-owner.md`, `.claude/skills/unslop/SKILL.md`, the pattern list of `.claude/skills/humanizer/SKILL.md`, and every file of `git diff 04091a8c origin/design-frameworks` but `docs/dependency-map.md` (read only for its merge). I searched `decisions.tsv` for the rulings quoted above. Live code read to check claims: `rules.ts`, `progress.ts`, `derive.ts`, `sheet.ts`, `skills.js`, `skills-held.ts`, `onboard.js`, `shadows.js`, `grant.ts`, `feats.ts` (registry), `gate.ts`, `gates.js`, `rulesref.js`, `vitals.ts`, `items.ts`, `solo.ts`, `spawn.ts`, `triggers.ts`, `effect-ops.ts`, `policy.ts`, `worth.ts`, `fight-sim.ts`, `rw/sim-log.md`, `lead-report.md` section 6.

Commands, each with its last lines:

```
git worktree add --detach /home/user/sg-review origin/design-frameworks
  HEAD is now at 53f21fd0 Design frameworks index: one row per gap, the dependency map, and where each number lives
bun install                      (in /home/user/sg-review)
  5 packages installed [18.00ms]
bun test tests/design-*          (branch)
   56 pass
   0 fail
  Ran 56 tests across 9 files. [152.00ms]
bun scripts/design-paper.ts --check
  (no output, exit 0)
bun scripts/design-paper.ts --write; git status --short
  (no change to any doc)
bun -e '<the script's pattern against an empty block>'
  false
bunx tsc --noEmit                (branch)
  tsc exit 0
bun scripts/design-paper.ts      (branch, 226 lines)
  | A | S | 5% | 18: 45% | 70% | 95% |
git worktree add --detach /home/user/sg-review-now HEAD   (37e0d68f, the branch's design files copied in)
bun scripts/design-paper.ts, then diff against the branch's output
  only framework 04's gold table differs: (20000) becomes (100000), S 0.3 becomes 1.3
bun test tests/design-*          (today's tree)
   56 pass
   0 fail
bunx tsc --noEmit                (today's tree with the design files, without the rules.ts widening)
  src/core/design/xp-curve.ts(50,112): error TS2740: Type 'CurveRules' is missing the following properties ...
  (5 errors)
git merge-tree --write-tree HEAD origin/design-frameworks
  CONFLICT (content): Merge conflict in docs/dependency-map.md
  Auto-merging src/core/rules.ts
bun <scratchpad>/brute-odds.ts 200    (the odds engine, 200 plays, seed 7, today's tree)
  Eldrin Voss vs Goblin (shipped) x2: won 3%, down 97%, dead 42%
  Eldrin Voss vs Goblin Brute (proposed) x2: won 11%, down 90%, dead 42%
  (the one-monster rows are the table in framework 05)
which java; find / -name tla2tools.jar
  /usr/bin/java ; no tla2tools.jar, so TLC was not run
```

Not run: the whole test suite, any browser, `tests/fight-sim.test.ts` (other helpers share this box), and TLC.
