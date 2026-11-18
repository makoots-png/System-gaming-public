# Brief, unit 6: make the triangle hold (the second balance round)

One helper (Opus, heavy-writer), in the main tree. Commit after each numbered step and each accepted change with `git commit -m "..." -- <paths>` (plain message, no AI attribution, no Co-Authored-By; this overrides "do not commit" in your built-in text). Do not push. Do not start helpers. Never edit `.claude/skills`. Do not run `bun run ci` or Playwright. Your checks are `bun run typecheck`, `bun run test` and `bun scripts/rw-paper.ts`.

Read first, in full: `AGENTS.md`, `docs/agent-handoff/rw/principles.md`, the skills `principle-attack-the-premise`, `principle-explain-the-number`, `principle-redesign-from-first-principles`, `principle-fix-root-causes`, `principle-laziness-protocol`, `docs/agent-handoff/later-phases/combat-rework-notes.md` (the owner's words on rock paper scissors, weight, taunt and "first principles, based in reality"), `docs/agent-handoff/rw/sim-log.md` and `notes-u5.md` in full (the first round: what was measured and why each row misses; do not repeat its experiments), `docs/agent-handoff/rw/design.md` sections 2, 3.3 and 6, `tests/models/fight-sim.ts`, `tests/fight-sim.test.ts`, the `fight` key of `src/core/rules.ts`, `src/core/registry/ability-kinds.ts`, `src/core/hunter/derive.ts`, `.claude/skills/unslop/SKILL.md`.

## Why (the owner's goal)

the owner, the GM: "I want to make it so that some classes will naturally beat others in a rock paper scissors. If someone overindexes on speed they'll do no damage and have too little defense. This is fine in parties if we have someone picking off the weaklings. We do need taunt effects or something of that nature. Weight is good to help with the counterbalance, can't equip too much beefy stuff." The lead's reading he accepted: speed beats the cannon (it acts first and is not where the blast lands), the tank beats speed (speed cannot get through armor), the cannon beats the tank (penetration and magic). The first simulation on the real fight shows the opposite on two of three sides and a foregone result on the third: speed beats the cannon 0.21 at C, the tank beats speed 0.10 at C and 1.00 at S, the cannon beats the tank 1.00. The screens do not move onto the new fight until this holds. This unit makes it hold, by the rules' own logic and not by a special case.

## The lead's decisions after round one (these replace design section 6 where they differ; write them into `design.md` section 6 in step 1)

1. **The triangle's bound is a direction with room for the dice**: at C and at S the favoured build wins at least 60% and at most 90%, measured as the mean of two openings, the default lines and adjacent. The old 60 to 75 band is dropped because a duel of 5 to 15 uses is near all or nothing (`sim-log.md`). Over 90% is still a miss: the other side must have a way to win with dice or play.
2. **A matchup must not flip with rank.** Tank against speed at 0.10 at C and 1.00 at S on the same rules is a defect of the curves, not a tuning miss. Find which numbers grow at different rates between E, C and S for the two sides (HP, damage per use, armor's share, turns per round) and make the ratio of times to kill stable across ranks first. Only then tune the level. Say in the log which curve caused the drift.
3. **At E**: every build wins between 25% and 75% against every other (mean of the two openings). A first session where any build plays.
4. **The channel's unprotected bound** is measured on channels begun while the boss is aiming at the channeler: 10 to 25% complete. Channels begun while it aims elsewhere are reported, not bounded.
5. **The speed party's rows** use a pack that can hurt: two skirmishers (ranged) and an elite brute.
6. **Mana**: the bound counts the blasts the mana allows a dungeon (2 or 3), not the blasts a careful cannon chose. Friendly fire stays: the owner asked for abilities grounded in reality.
7. **The numbers of an ability kind are rules.** Move the balance numbers of `KINDS` (wind-ups, travel speeds, radius and ring, ranges, the cost shares, fatigue and mana costs, cooldowns) and `FIGHT_REST` under `RULES.fight`, each with its reason, so a GM can override them and this unit can tune them. `ability-kinds.ts` keeps the shape of each kind and reads the numbers. One commit, no behaviour change, the paper output identical.

## The levers you may move, in this order, one at a time

Each accepted change is one commit with the row before and after and every other row re-measured, as in round one. A change that leaves its row outside the bound is not accepted, and after two failures on one premise you write the premise down and test it before a third.

a. **The archetypes' own builds.** A speed build with no Instinct has Reaction 10 and cannot react; the notes give Instinct "crit and reacting first" and Agility "speed and dodge". If the sensible speed build takes Instinct second, make it so, in the build table, and say why. The same question for each archetype's second and third stat. A build table that a real player would not pick is a setup error, not a balance fact.
b. **The policies.** A speed build that stands inside a blast's range and shoots is not how a fast character plays; one that keeps its distance or closes and circles is. A tank that walks 8 tiles in the open against an archer has no answer in reality either, so ask what a tank's real answer is before changing a number (see c). Keep each policy a short readable function.
c. **What a build can do.** If a melee build has no way to close on a ranged one, the rules lack something the owner already named or the design already has: the heavy kit's weight slowing the wearer (present), a tank's taunt (present, and it forces the target; check what it does to a ranged attacker in a duel), a charge or dash (design 4.6 left `dash` undefined; define it as the smallest rule: a move of up to the full `move` at a named cost, usable when the path is straight, if and only if the log shows the walk is the cause after a and b). Prefer a rule that exists over a new one, and a new op over a special case.
d. **Defence.** "It cannot get through armor": at C armor takes 43% of the speed build's shots and it still out-damages the tank's HP. Look at whether weak hits should lose more to armor than strong ones (a flat part of armor, taken before the percentage, is how many games make chip damage bounce; the owner's penetration already has "percent then flat", so the mirror exists in the design), at the heavy kit's armor, and at its resist of 0, which hands every magical build the duel (a plate kit with a third of its armor as resist is the lead's starting point; the cannon must still be favoured through penetration and Power, inside 60 to 90).
e. **The blast**: wind-up, radius and ring, mana cost, damage share.
f. **The curves and caps** of section 2 only if step 2's drift points at one.

## Steps

1. Write the lead's seven decisions into `design.md` section 6 and the rows table in `tests/fight-sim.test.ts` (the two openings, the new bounds, the pack that can hurt, the channel's split). Decision 7's move of the kind numbers into `RULES.fight`. First run of the new rows into `sim-log.md` under "Round two". Commit.
2. The rank drift (decision 2): the cause, the fix, the triangle's six rows before and after. Commit.
3. Levers a to f in order, as far as needed. Stop a lever when its rows are inside. Keep the pack, boss, stagger, fatigue and single-use rows inside while you go (re-measure all rows after each change; the test file runs in about 11 s).
4. Every row that is inside becomes a real test. A row still outside stays `test.todo` with its number, and `sim-log.md` says what you tried, the premise you tested and what you would do next.
5. Update what the changes touch: each number's comment in `rules.ts`, `design.md` (sections 2, 3, 4 and 6 say what the code does), `scripts/rw-paper.ts` output, unit tests whose literals came from a changed table, `for-the-owner.md` (append one plain line per change a GM would notice at the table, under "From the rework's balance"). `bun run typecheck`, `bun run test`, `bun run deps -- --write`. `docs/agent-handoff/rw/notes-u6.md`: the final table, every change with old, new and reason, rows still open, the exact last line of `bun run test`.

## Rules

- The simulation calls the real `reduce`. No rule in the player, no archetype named in core.
- A bound above is not loosened. If one is wrong, say so with evidence under "Bounds I would change" and leave its row `todo`.
- Run count and standard error with every number.
- A new rule (c, d) lands as the design says rules land: a type or a table entry, its cell in an exhaustive switch, a test in that module's test file with the expected value from the rule, a line in `design.md`. Smallest thing that works.
- Plain whole sentences; a GM should be able to read `sim-log.md`.

## Time

150 minutes. At 125 minutes stop tuning and do steps 4 and 5 with what holds. Reply in at most 250 words: the commit range, the exact last line of `bun run test`, the triangle's six rows and the E rows (value, standard error), what caused the rank drift, each rule or number changed, and the rows still open.
