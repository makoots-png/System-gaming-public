# Brief, unit 7: the third balance round (four rules the log points at, then stop)

One helper (Opus, heavy-writer), in the main tree. Same rules as `brief-u6-triangle.md` (read its "Rules" and "Why" sections; they apply here word for word): commit each accepted change yourself, no AI attribution, no push, no helpers, no `bun run ci` or Playwright, never edit `.claude/skills`, never `git checkout` or `git stash` a file (to drop your own uncommitted edit, edit it back). Checks: `bun run typecheck`, `bun run test`, `bun scripts/rw-paper.ts`.

Read first, in full: `docs/agent-handoff/rw/sim-log.md` (all of it: rounds one and two, do not repeat an experiment), `docs/agent-handoff/rw/notes-u6.md`, `docs/agent-handoff/rw/brief-u6-triangle.md`, `docs/agent-handoff/rw/principles.md`, the skills `principle-attack-the-premise`, `principle-explain-the-number`, `principle-model-the-domain`, `docs/agent-handoff/later-phases/combat-rework-notes.md`, `docs/agent-handoff/rw/design.md` sections 2, 3, 4.6 and 6, `tests/models/fight-sim.ts`, `tests/fight-sim.test.ts`, `src/core/hunter/derive.ts`, `src/core/combat/fight.ts`, `src/core/combat/resolve.ts`, the `fight` key of `src/core/rules.ts`.

## Where it stands

After two rounds the pack, boss, stagger, single-use and speed-party rows hold. Open: speed beats cannon (C 0.300, S 0.346), tank beats speed at S (1.000), cannon beats tank at C (0.986) and at E (0.913), fatigue before the third fight (0.150), the channel begun under fire (0.619).

## The lead's decisions for this round (write each into `design.md` where its rule lives, with the reason)

1. **Reaction is fed by Agility as well as Instinct.** the owner's notes give Agility "speed and dodge" and Instinct "reacting first": noticing the blow is Instinct, and getting the body moving is Agility. Today a speed build has Reaction 10 and the cannon's Control cancels what is left, so the fastest body in the fight dodges no better than a mage. Feed Reaction from both through the capped curve (start with equal weights and say what you chose and why), then test it together with the pair round two pointed at: the cannon's default attack as a travelling bolt and a blast wind-up of 1000 ticks. Accept the smallest set of the three that brings speed beats cannon inside at C and S.
2. **A dash.** Design 4.6 left it undefined. The rule: `move` with `dash: true` goes up to the full `move` in a straight line (the 5-10-5 distance, no body or wall on the path) for the time of a standard action and a fatigue cost that is a number in `RULES.fight` (start at twice a strike's). Reason: a charge is how a heavy fighter closes on an archer, and it costs breath. It is a field on the existing command with its cell in the reducer and tests in `tests/fight.test.ts` and the model test's generator. Every build may dash; the tank's policy uses it to close.
3. **Plate is never free.** the owner: "Weight is good to help with the counterbalance, can't equip too much beefy stuff." Round two found a strong S tank wears plate at nearly no cost (speed 70 at C, 87 at S), which is the rest of the rank drift. A kit's load keeps a floor: however strong the wearer, a kit costs at least a named share of its full penalty (start at half; a number in `RULES.fight` with this reason). Re-measure tank beats speed at C and S and the drift ratio.
4. **Cannon against tank.** With the dash in, try the heavy kit's resist at 30 (round two measured 0.93 adjacent). The cannon must stay favoured (at least 0.60 at C and S). The same change should bring E inside 0.25 to 0.75; if E stays out and C and S are in, say what E's cause is and leave it `todo`.
5. **Fatigue and the channel.** Move `fightRest` until no build is at capacity before the third fight in more than 5% of dungeons while the speed build still is in fight three. Move `holdBase` until a channel begun under the boss's aim completes 10 to 25%.
6. **The bound stays on the mean of the two openings.** Print each opening beside it in the row's output, unbounded: who wins from which distance is something a GM should be able to read in the log, and in play the party decides the distance.

## Steps

1. Decisions 1 to 5 in that order, each as round two did it: one change, the row before and after, every other row re-measured, one commit per accepted change, a rejected try written in `sim-log.md` under "Round three" with its numbers. Two failures on one premise: write the premise and test it before a third.
2. Each row that is inside becomes a real test; a row still outside stays `test.todo` with its value.
3. Update what the changes touch: comments in `rules.ts`, `design.md`, the paper script's output, unit tests whose literals came from a changed table, the fight chart if `dash` adds an arrow (`bun run charts`), and append to `for-the-owner.md` under "From the rework's balance" one plain line for each change a GM would notice (Reaction from Agility, the dash, plate's floor, plate's resist, and round two's flat part of armor and HP curve if they are not there yet). `bun run typecheck`, `bun run test`, `bun run deps -- --write`.
4. `docs/agent-handoff/rw/notes-u7.md`: the final table of all rows (value, standard error, each opening, bound, state), every change with old, new and reason, and for each row still open one paragraph a GM can read: what it means at the table and which overridable number he would turn.

## Time

120 minutes; at 100 stop tuning and finish steps 2 to 4. Reply in at most 250 words: the commit range, the exact last line of `bun run test`, the nine triangle and E rows with each opening, each change accepted, each row still open.
