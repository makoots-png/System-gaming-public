# Brief, unit 8: the four open balance rows, with the real built-in abilities (runs beside the wave)

One helper (Opus, heavy-writer), in your own git worktree. The same rules as `brief-u6-triangle.md` and `brief-u7-triangle-3.md` (read both, and their "Rules" apply word for word): one lever at a time, the row before and after, every other row re-measured, one commit per accepted change, a rejected try written down with its numbers, two failures on one premise mean you write the premise and test it before a third, no bound loosened, no archetype named in core, no AI attribution in commits, no push, no helpers, no `bun run ci` or Playwright, never edit `.claude/skills`.

The main tree is in the middle of a wave that moves the app onto the new fight, and it is red in places by design (typecheck errors in `save.ts` and old-fight tests, about 44 failing bun tests in save, protocol, applied, encounter and status files). That is not yours to fix. Your checks are `bun test tests/fight-sim.test.ts tests/fight.test.ts tests/fight-model.test.ts tests/resolve.test.ts tests/derive.test.ts tests/effect-ops.test.ts tests/abilities.test.ts tests/rows.test.ts tests/rules.test.ts` and `bun scripts/rw-paper.ts`, all green when you end, and no new typecheck error in a file you touch.

You may change only: the `fight` key of `src/core/rules.ts` (numbers and their comments, a new number where a rule needs one), `src/core/hunter/derive.ts`, `src/core/combat/resolve.ts`, `src/core/combat/fight.ts` and `fight-turn.ts`, `src/core/combat/effect-ops.ts`, `tests/models/fight-sim.ts`, `tests/fight-sim.test.ts`, the test files of a module you change, `scripts/rw-paper.ts`, `docs/agent-handoff/rw/design.md`, `docs/agent-handoff/rw/sim-log.md`, `docs/agent-handoff/for-the-owner.md` (append under "From the rework's balance"), and your notes `docs/agent-handoff/rw/notes-u8.md`. Do NOT commit `docs/dependency-map.md`. Keep each commit small and to these files, because the lead cherry-picks them onto a moving tree.

Read first, in full: `docs/agent-handoff/rw/sim-log.md` (three rounds; do not repeat an experiment), `docs/agent-handoff/rw/notes-u7.md`, `docs/agent-handoff/rw/principles.md`, the skills `principle-attack-the-premise` and `principle-explain-the-number`, `docs/agent-handoff/later-phases/combat-rework-notes.md`, `docs/agent-handoff/rw/design.md` sections 2, 3, 4 and 6, `src/core/registry/abilities.ts` and `docs/agent-handoff/rw/notes-m2-P1.md`, `tests/models/fight-sim.ts`.

## Why (the owner's goal)

the owner, the GM, wants a rock paper scissors between builds: speed beats the cannon, the tank beats speed, the cannon beats the tank, each by a margin the dice can still overturn. After three rounds the direction holds on all nine rows and four rows are outside their bounds. He was told and said to keep going; the lead is using a spare agent to close them while the screens move.

## The open rows

- Tank beats speed at S: 1.000 (bound 0.60 to 0.90).
- Cannon beats tank at C: 0.986 (0.60 to 0.90), and at E: 0.905 (0.25 to 0.75).
- A channel begun under the boss's aim completes 0.533 (0.10 to 0.25).

Round three's finding: the three tank rows share one cause, the tank's speed in plate (70 at C, 87 at S) over an 8 tile opening, and a load floor of 0.5 moved nothing while 0.75 put three other rows out.

## What to do

1. **Play the real abilities.** The simulation's builds use abilities made in the test's own table. Switch them to the built-in ones of `src/core/registry/abilities.ts` (the weapon attack by kit, the archetype attacks, the built-in skills a build of that kind would take) wherever one exists, and re-measure every row. Record the table under "Round four" in `sim-log.md`. Rows that were inside and move out are yours too. Commit.
2. **Tank beats speed at S.** The row is all or nothing from both openings. Explain what the speed build's damage per round is against an S tank's armor and HP, and what would give it between one win in ten and four in ten: candidates in order are the flat part of armor (3% of armor: what share of an S quick shot it removes compared with C, and whether it should scale with rank at all), the heavy kit's armor at S, penetration from Agility or from the weapon (the owner's notes list flat and percent penetration as derived numbers; a speed build that "cannot get through armor" at all is the design's intent at parity, but not 100 to 0), and the tank's HP share at S (1.62 times). Fix it with the lever the explanation points at.
3. **Cannon beats tank at C and E.** The cause is the walk under fire. Candidates in order: the fight's default opening distance for the duel rows is the party default (8 tiles), which no rule says a duel must use, but do not change a setup to pass a bound unless the rule itself is wrong; the tank's answer to a caster in the notes is taunt and Discipline, so measure what a resisted blast or curse does for a tank that takes Discipline third; the dash at speed below 100 (round three found it no quicker than walking: decide whether a dash should always cover the full `move` in one action whatever the speed, which is what "a charge" means, and say what else that moves); plate's resist. The cannon must stay favoured at C and S.
4. **The channel under the boss's aim.** The boss reaches the channeler in only 44 of 274 channels. Find out why (range, the threat table sending it elsewhere, the boss's speed, the time the channel takes), then decide with evidence whether the rule is wrong (for example a channeler should draw threat as it charges, so a boss is pulled toward a visible wind-up, which is also what makes a taunt matter) or the bound's setup is. Add the rule only if it is the smallest thing that makes the bound's premise true.
5. Each row inside becomes a real test; a row still outside stays `test.todo` with its number and a paragraph a GM can read. Update the comments in `rules.ts`, `design.md`, the paper script's output, `for-the-owner.md`. Notes: the final table, each change with old, new and reason, rows still open.

## Time

120 minutes; at 100 stop tuning and finish step 5. Reply in at most 250 words: your worktree path, branch and commit range (list the commits one per line with their subject), the exact last line of your test command, the four rows before and after with each opening, each change accepted, each row still open.
