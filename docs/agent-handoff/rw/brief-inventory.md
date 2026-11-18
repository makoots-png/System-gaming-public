# Brief: inventory for the combat and stats rework (read only, one file)

One helper (Opus, heavy-writer), in the main tree. You change no app code, no test and no script. You write `docs/agent-handoff/rw/inventory.md` and `docs/agent-handoff/rw/notes-inventory.md`, and you commit after each numbered step with `git commit -m "..." -- <the paths>` (plain message, no AI attribution, no Co-Authored-By; this overrides "do not commit" in your built-in text). Do not push. Do not start helpers of your own. Never edit anything under `.claude/skills`. A baseline `bun run ci` may be running on port 3218 when you start: do not run `bun run ci` or Playwright at all. `bun test tests/<file>` for one file is fine.

Read first, in full: `AGENTS.md`, `docs/agent-handoff/later-phases/combat-rework-notes.md` (the owner's words; it is the source for everything here), `docs/state-machines.md` section "A fight", `docs/agent-handoff/p4/design.md` (the model for how a number is explained), `.claude/skills/principle-model-the-domain/SKILL.md`, `.claude/skills/principle-redesign-from-first-principles/SKILL.md`, `.claude/skills/principle-explain-the-number/SKILL.md`, `.claude/skills/unslop/SKILL.md`.

## Why (the owner's goal)

the owner runs a tabletop game with this app, he as GM on one phone and his players on theirs. He wants the fight to be "more dynamic": turns that come from speed, eight stats, Armor and Resist in place of AC, damage worked out from where a target's speed puts it, typed formulas a GM can overwrite, channeling, taunt and threat, stagger, shields, monster intent, and a battle map with positions in the fight's data from the start. His bar: "Idc if it's big changes so long as the architecture remains ROCK solid", and "everything is defined, easy to find". The first milestone is a design on paper and a balance simulation on the real fight code, with no screen change.

The lead writes the design from your inventory without opening the code. So the inventory must be complete, exact and short. Every fact names its `file:line`. Where you are unsure, say "not checked" and why.

## Steps

1. **The fight today.** In `inventory.md`, section 1: the shape of `Encounter` and each combatant (every field, its type, who writes it), every member of `Command` and `Effect` with one line on what it does, how the turn order is made and advanced (`Order`, `turnCmp`, the `turnStarted` rule, rounds), where dice are rolled (view or core) and what numbers a command carries. Then how one ability use becomes damage today, as a traced path from the tap in `src/views/combat.js` through `src/core/combat/use.ts` (`outcomesOf`) to the reducer: the attack roll, AC, saves, crits, damage types if any, what a skill, an item and a monster ability each hold (`ability.ts`, the skill and item shapes in `save.ts`, `parseAbility` and `SEEDS` in `registry/monsters.ts`). Commit.
2. **Stats and derived numbers.** Section 2: every place a stat key is named or read (the two `STAT_KEYS`, the 16 or so files), what each stat feeds today (HP, MP, AC, to-hit, damage, saves, carried weight, initiative), every formula with its `file:line` written as a formula, the perk keys and what each changes, how equipment changes numbers (slots, weight if any, AC), how a monster's stat block is built by rank (`statBlock`), how level, rank and points grow a hunter (`progress.ts`, the tables in `rules.ts`). A table of the hunter's numbers at ranks E, C and S for a typical build and of a typical monster at the same ranks, computed from the rules by a throwaway script you do not commit (say how you computed them). Commit.
3. **Statuses and resources.** Section 3: the status op kinds and what each can change (`status.ts`, `registry/statuses.ts`), how duration, stacking and the stronger-wins rule of phase 4 work, how rank scales a status, where a status is drawn (the four drawings the handoff names, with `file:line`). `Vitals`: HP, MP, fatigue, the rest rule, death saves, what spends and restores each. Which built-in statuses, skills, items and monsters name AC, a stat, initiative or MP (counts and the list of keys), since each needs a new number. Commit.
4. **What the room carries.** Section 4: how a fight reaches player phones (which room messages or doc fields in `protocol.ts` carry fight state, their bounds, what a player's phone may send during a fight), and what the bounds mean for adding a position per combatant, a gauge value, a channel count, a shield and a threat table. The save: where the fight, the hunter's stats and custom content (skills, statuses, items, enemies made in the Workshop) are stored and parsed in `save.ts`, and what a new campaign with new stat keys must change (old saves need not carry over). Commit.
5. **The tests and tools that exist.** Section 5: what `tests/encounter.test.ts`, `tests/encounter-model.test.ts`, `tests/use.test.ts`, `tests/status*.test.ts` and `docs/agent-handoff/p4/status-sim.test.ts` (and any simulation under `tests/`) each prove, how the phase 4 simulation plays a fight (does it call `reduce`, how does it roll, how long does it take), and what a three-archetype simulation (speed, tank, cannon, against each other and against monsters at E, C and S) can reuse. Which lint rules in `tests/lint.test.ts` guard the fight. Which e2e files drive a fight (names and counts only). Commit.
6. **Where the rework cuts.** Section 6, at most one page: for each part of the rework (the timeline by speed; positions and movement; the land-time avoidance rule; eight stats; Armor, Resist and penetration; fatigue and mana; typed formulas; channels; taunt and threat; stagger; shields; intent), the files and types it must change, what can stay as it is, and anything in today's design that fights it (for example a rule that assumes rounds, a view that computes a number, a message bound). List every place a view computes or rolls something the new rules would need in core. No design proposals: the facts a designer needs and the traps. Then put a ten line summary at the top of the file. Commit.

## Rules

- Facts, with `file:line`. No proposals beyond section 6's "what fights it".
- Plain whole sentences (unslop). No long dashes. Tables where they are shorter than prose.
- `inventory.md` should stay under about 500 lines. Depth goes to sections 1, 2 and 6.
- Notes file `notes-inventory.md`, written as you go: what you could not check and why.

## Done means

`inventory.md` has its six sections and the summary, everything committed in six or seven commits, the tree clean.

## Time

60 minutes. Reply in at most 200 words: the commit range, and the five facts most likely to change the design.
