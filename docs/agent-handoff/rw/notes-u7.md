# Unit 7 notes: the third balance round

Started 15:52, finished 16:20 (box clock). Commits 31e6e63 to the last commit of this unit (the notes).

## Log

- 15:52 Read the brief, the rules, AGENTS.md, u6's brief and notes, sim-log.md (rounds one and two), the principles,
  the owner's notes, design sections 2, 3, 4.6 and 6, the sim player and rows, derive.ts, fight.ts, resolve.ts, `RULES.fight`.
  Baseline `bun test tests/fight-sim.test.ts`: 64 tests, 13.7 s, every number as round two left it.
- Decision 1 committed (31e6e63): Reaction `10 + x(ins) + x(agi)` with the blast wound up 1000.
- Decision 2 committed (1279a94): the dash as the lead wrote it; the tank never charges at a standard action's time.
- Decisions 3 and 4 tried and not accepted; the log and the resist premise committed (e7bd7e0).
- Decision 5 committed (89858f2): `fightRest` 55; `holdBase` cannot lower its row.
- Decision 6 committed (993e724): each opening printed with its own se and no bound; the decisions in design.md.
- Step 3 and 4: for-the-owner.md lines, deps and charts (no change), this file, "Where round three ends" in sim-log.md.

## The final table

`bun test tests/fight-sim.test.ts`, seeded on the real `reduce`. Triangle and E rows are the mean of two openings, 400
fights each; each opening's se is about 0.02 where it is not near 0 or 1.

| Row | Value | se | Lines | Adjacent | Bound | State |
|---|---|---|---|---|---|---|
| speed beats cannon at C | 0.605 | 0.016 | 0.818 | 0.393 | 0.60 to 0.90 | test, near |
| tank beats speed at C | 0.798 | 0.012 | 0.598 | 0.998 | 0.60 to 0.90 | test |
| cannon beats tank at C | 0.986 | 0.004 | 1.000 | 0.973 | 0.60 to 0.90 | todo |
| speed beats cannon at S | 0.775 | 0.012 | 0.998 | 0.552 | 0.60 to 0.90 | test |
| tank beats speed at S | 1.000 | 0 | 1.000 | 1.000 | 0.60 to 0.90 | todo |
| cannon beats tank at S | 0.880 | 0.011 | 0.970 | 0.790 | 0.60 to 0.90 | test |
| speed against cannon at E | 0.576 | 0.017 | 0.557 | 0.595 | 0.25 to 0.75 | test |
| tank against speed at E | 0.619 | 0.015 | 0.365 | 0.873 | 0.25 to 0.75 | test |
| cannon against tank at E | 0.905 | 0.010 | 0.983 | 0.828 | 0.25 to 0.75 | todo |
| mixed party, pack, C / S (rounds) | 3.87 / 4.49 | 0.07 / 0.06 | | | 2 to 5 | test |
| hunter down in a pack fight, C / S | 0.007 / 0 | 0.007 / 0 | | | at most 0.10 | test |
| mixed party, boss, C / S (rounds) | 6.55 / 7.93 | 0.03 / 0.03 | | | 4 to 8 | test |
| hunter down / dies in a boss fight, C and S | 0 / 0 | | | | 0.25 / 0.05 | test |
| staggers, C / S | 2.00 / 2.00 | 0 | | | 1 to 2 | test |
| speed party's clear time over the mixed party's, C / S | 1.087 / 1.172 | 0.024 / 0.021 | | | 1 or more | test |
| speed party's front hunter down over the mixed party's, C / S | 7.0 / 18.3 | 3.2 / 10.7 | | | 2 or more | test |
| some build at capacity before fight 3, C | 0.010 | 0.010 | | | at most 0.05 | test |
| speed build at capacity in fight 3, C | 0.920 | 0.027 | | | at least 0.5 | test |
| blasts a C cannon's mana pays for | 2 (E 1, S 3) | 0 | | | 2 to 3 | test |
| blasts a careful cannon casts, C | 1.83 | 0.04 | | | none | measured |
| channel begun under fire completes, C | 0.533 (274 channels) | 0.030 | | | 0.10 to 0.25 | todo |
| channel begun while the boss aims elsewhere, C | 0.986 (211) | 0.008 | | | none | measured |
| channel behind a taunting tank, C | 1.000 (400) | 0 | | | over 0.5 | test |
| best single use on a tank, E / C / S | 0.430 / 0.382 / 0.309 | 0.007 / 0.004 / 0.004 | | | at most 0.60 | test |
| status build beats a tank, C | 0.998 | 0.002 | | | none | measured |

## Every change, old, new and why

| What | Old | New | Why |
|---|---|---|---|
| Reaction | `eff(ins)` | `10 + x(ins) + reactAgi * x(agi)`, `reactAgi` 1 | Noticing the blow is Instinct, moving the body is Agility; each counts once (the weight Instinct had), on Accuracy's curve. Speed beats cannon C 0.300 to 0.605, S 0.346 to 0.775 together with the next line |
| `abilityKinds.blast.windup` | 600 | 1000 | The smallest set of the three (Reaction, bolt, wind-up) that brings speed beats cannon in at C and S; Reaction alone gave 0.557 at C |
| A dash (new) | none | `move { dash: true }`, `dashTime` 100, `dashFatigue` 16 | The lead's rule: the whole move in a straight line for a standard action and twice a strike's fatigue. No row moved: at a standard action a dash is quicker than walking only over speed 100 |
| `fightRest` | 50 | 55 | Some build at capacity before fight 3: 0.150 to 0.010; the speed build still at capacity in fight 3 (0.920) |
| Rows' output | each opening in the note | each opening with its own se, "no bound" | Decision 6 |

Tried and not accepted (sim-log.md has the numbers): Reaction as the mean of the two stats; the cannon's travelling bolt;
a floor on a kit's load at 0.5 and 0.75 (three rows move out each time); plate's resist 30 (C and E stay out);
`holdBase` lower than 0.15 (no effect); threat decay (checked only to name the lever, not changed).

## The rows still open, for a GM

- **Cannon beats tank at C (0.986; lines 1.000, adjacent 0.973).** At the table: a C mage kills a C knight in plate
  nearly every time, from range or up close. The knight spends most of its first turns walking (speed 70 in plate) and
  the mage's magic loses only 17% to plate. The numbers to turn: `fight.kits.heavy.resist` (30 gives 0.969, 60 gives
  0.96 on the lines alone) and, more, how much plate slows a C body (`fight.loadSlow`, `fight.freeLoad`).
- **Tank beats speed at S (1.000 from both openings).** At the table: an S archer never beats an S knight. The S knight
  carries plate almost freely (speed 87) and has 282 HP; the archer's 13-point shots lose most of their bite to 81 armor.
  The numbers to turn: `fight.armorFlat` (the flat part of armor; it is what lets a knight shrug off small hits) or how
  much plate slows a strong body. A floor on plate's slow of 0.75 brought it to 0.88, but made the S mage win 0.98 against
  the same knight and the S boss fight run past 8 rounds.
- **Cannon against tank at E (0.905; lines 0.983, adjacent 0.828).** At the table: in the first session a mage beats
  a knight 9 times in 10. Same cause as at C: at E the knight walks 3.6 of its 5.3 turns. The number to turn:
  `fight.kits.heavy.resist` (30 gives 0.848) or the opening distance the GM sets.
- **A channel begun under the boss's aim completes 0.533.** At the table: a mage who starts a five-turn channel while a
  melee boss glares at it from across the room usually finishes, because the boss turns to the fighters in front of it
  before it gets there. Only 44 of 274 channels were hit at all. No channel number changes this (`fight.holdBase` lower
  does nothing); the GM's own choice of the boss's target does, and a ranged boss would.

## Which principle changed a choice

- attack-the-premise: after resist 20 (round two) and 30 failed cannon against tank at C, I tested "plate stops too
  little magic" on the lines at resist 60 and 100 and found the walk decides the C duel; after the floor, I saw that the
  tank's turns a round drive both tank rows the same way, and stopped instead of a third try.
- explain-the-number: the dash moved nothing, and the reason is arithmetic (6 tiles a standard action at any speed), not
  noise; `holdBase` moved nothing, and the reason is in the tallies (16% of channels hit at all, 31% end unspent).
- model-the-domain: the dash is a field on the existing `move` command with its one cell in the reducer and one path
  function in `space.ts`, not a new command.

## Unsure

- "Equal weights" for Reaction: I read it as each stat counted once (Instinct keeps its old weight) and kept it on
  `eff`, not on the capped curve the brief names, because Accuracy is uncapped `eff` and a capped Reaction drifts with
  rank. The mean was measured and is short of the bound at C (0.570 with the wind-up).
- `dashTime` is a rule number the brief did not ask for; I added it so the time of a dash is overridable and the scan
  could run. At the lead's 100 the tank never dashes.
- Speed beats cannon at C is inside by 0.3 se.

## The checks

`bun run typecheck` green. `bun scripts/rw-paper.ts` runs; table 3.C prints the 1000-tick blast (speed 0/15/85, tank
65/25/10) and table 6.4 the 55 back. `bun run deps -- --write` and `bun run charts` leave nothing to commit after the
dash commit. `bun run test`, last line: `Ran 2015 tests across 53 files. [85.12s]` (2011 pass, 4 todo, 0 fail).
