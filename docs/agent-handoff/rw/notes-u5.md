# Unit 5 notes: the balance simulation on the real fight

The player is `tests/models/fight-sim.ts`, the rows `tests/fight-sim.test.ts` (35 rows and 27 smoke tests, about 11 s),
and the log `docs/agent-handoff/rw/sim-log.md` (the first run, why each row misses, the two accepted changes, the bounds
I would change, what the table cannot show). Commits 0ba9e40 to the commit of this file.

## The final table

Every row runs seeded on the real `reduce`. "se" is the standard error; runs are fights (uses for the single-use rows,
channels begun for the channel rows).

| Row | Value | se | Runs | Bound | Lever | State |
|---|---|---|---|---|---|---|
| speed beats cannon at C | 0.207 | 0.020 | 400 | 0.60 to 0.75 | reactK, blast wind-up | todo |
| tank beats speed at C | 0.100 | 0.015 | 400 | 0.60 to 0.75 | armorK, heavy armor | todo |
| cannon beats tank at C | 1.000 | 0 | 400 | 0.60 to 0.75 | resistDisCap, heavy resist | todo |
| speed beats cannon at S | 0.135 | 0.017 | 400 | 0.60 to 0.75 | reactK, blast wind-up | todo |
| tank beats speed at S | 1.000 | 0 | 400 | 0.60 to 0.75 | armorK, heavy armor | todo |
| cannon beats tank at S | 0.993 | 0.004 | 400 | 0.60 to 0.75 | resistDisCap, heavy resist | todo |
| speed against cannon at E | 0.235 | 0.021 | 400 | 0.465 to 0.535 | creationPoints | todo |
| tank against speed at E | 0.010 | 0.005 | 400 | 0.465 to 0.535 | creationPoints | todo |
| cannon against tank at E | 1.000 | 0 | 400 | 0.465 to 0.535 | creationPoints | todo |
| mixed party clears a pack at C (rounds) | 3.30 | 0.07 | 150 | 2 to 5 | kinds.normal | test |
| a hunter down in a pack fight at C | 0.000 | 0 | 150 | at most 0.10 | kinds.normal | test |
| mixed party beats a boss at C (rounds) | 5.94 | 0.03 | 300 | 4 to 8 | kinds.boss | test |
| a hunter down in a boss fight at C | 0.000 | 0 | 300 | at most 0.25 | kinds.boss | test |
| a hunter dies in a boss fight at C | 0.000 | 0 | 300 | under 0.05 | kinds.boss | test |
| staggers in a boss fight at C | 2.00 | 0 | 300 | 1 to 2 | boss stagger, staggerRegrow | test |
| speed party's clear time over the mixed party's at C | 0.914 | 0.019 | 150 | 1 or more | cost.quick | todo |
| speed party's front hunter down, over the mixed party's, at C | neither goes down | | 150 | 2 or more | cost.quick | todo |
| mixed party clears a pack at S (rounds) | 4.20 | 0.06 | 150 | 2 to 5 | kinds.normal | test |
| a hunter down in a pack fight at S | 0.000 | 0 | 150 | at most 0.10 | kinds.normal | test |
| mixed party beats a boss at S (rounds) | 7.87 | 0.03 | 300 | 4 to 8 | kinds.boss | test (was 9.76) |
| a hunter down in a boss fight at S | 0.000 | 0 | 300 | at most 0.25 | kinds.boss | test |
| a hunter dies in a boss fight at S | 0.000 | 0 | 300 | under 0.05 | kinds.boss | test |
| staggers in a boss fight at S | 2.00 | 0 | 300 | 1 to 2 | boss stagger, staggerRegrow | test (was 3.00) |
| speed party's clear time over the mixed party's at S | 0.939 | 0.015 | 150 | 1 or more | cost.quick | todo |
| speed party's front hunter down, over the mixed party's, at S | 0.020 over 0 | | 150 | 2 or more | cost.quick | test |
| some build at fatigue capacity before fight 3 at C | 0.150 | 0.036 | 100 | at most 0.05 | FIGHT_REST | todo |
| speed build at capacity in fight 3 at C | 0.990 | 0.010 | 100 | at least 0.5 | FIGHT_REST | test |
| blasts a cannon casts in a dungeon at C | 1.83 | 0.04 | 100 | 2 to 3 | mana | todo |
| a cannon ends a dungeon with mana for another blast at C | 0.160 | 0.037 | 100 | at most 0.05 | mana | todo |
| an unprotected channel completes at C | 0.921 | 0.020 | 178 | 0.10 to 0.25 | holdBase | todo |
| a channel behind a taunting tank completes at C | 1.000 | 0 | 400 | over 0.5 | holdBase | test |
| best single use on a same-rank tank at E | 0.610 | 0.006 | 400 | at most 0.60 | cost.heavy, critSizeCap | todo |
| best single use on a same-rank tank at C | 0.489 | 0.004 | 400 | at most 0.60 | cost.heavy, critSizeCap | test |
| best single use on a same-rank tank at S | 0.311 | 0.003 | 400 | at most 0.60 | cost.heavy, critSizeCap | test |
| a status build beats a tank at C | 0.998 | 0.002 | 400 | none (measured) | per-round damage skips defence | test (no bound) |

## Every number changed

| Number | Old | New | Reason |
|---|---|---|---|
| `RULES.fight.kinds.boss.hp` | 4 | 3.2 | At 4 the S party needed 9.8 rounds for a boss, past the 8 a boss fight may last, because the tank spends most turns taunting. Now 7.9 at S, 5.9 at C. |
| `RULES.fight.staggerRegrow` | 0.5 | 0.75 | At 50% the S boss fight filled a third stagger bar in 3 fights of 10. Now every boss fight at C and S has 2. |

Each moved the number's comment in `rules.ts`, `design.md` (sections 2.4, 4.3 and the summary's point 11), the boss rows
of table 2.6 in `tests/derive.test.ts`, and the regrowth literals in `tests/fight.test.ts` (8 to 14) and
`tests/resolve.test.ts` (88 to 154). The last one I missed in the regrowth commit; `bun run test` caught it, and it has its
own commit.

## The rows still `todo`, and why

- The six triangle rows and three E rows: the premise of the 60 to 75% band (a share follows the paper's margin
  gently) does not survive. A duel's share is near all or nothing at a margin of 1.2, the margins differ by rank, the
  8-tile opening costs only the melee build, and the heavy kit's resist of 0 hands every magical build the duel. Two
  values of `reactK` (0.1 and 0) both left speed against cannon outside, so I stopped there (attack-the-premise).
  `sim-log.md`, "Bounds I would change".
- The speed party's rows at C and its clear time at S: the pack of normal brutes reaches no one, so the bound has
  nothing to compare.
- Fatigue before fight 3: the speed build, as the paper's own 95 after fight 2 predicted. Its lever `FIGHT_REST` is not
  in `RULES.fight` (the sim uses the paper's 50; today's short rest is 25), so this unit could not move it.
- The two mana rows: they rest on a policy that never blasts an ally, not on the mana numbers.
- The unprotected channel: the threat table keeps the boss off a channeler that picks its moment, so `hold` is never
  tested.
- The single use at E: 0.610, 1.7 se over the line, from the blast's crits on a resist-0 tank. Its levers (the heavy
  share, `critSizeCap`) are next in line after the triangle, which is where the design's order stopped.

## Choices the brief left open

- The cannon's default attack is a `curse` (direct, Will resists for half). The paper's was a travelling bolt (land
  0.25) that no kind has exactly. The support's is a `curse` too; the status build's signature is Burning at phase 4's
  tier curve. A per-round formula reads its bearer, so the status's dice are by the source's tier, not by its Power.
- The cannon's channel is Focus, a `curse` with the exponential tick, so it never catches an ally. The design's table 4.1
  channels a blast.
- A monster's suggested target is the top of its threat table among hunters up, else the nearest; a taunt overrides it.
- Death is measured after the fight: a hunter left at 0 rolls death saves through `lifeAfter` with nobody to help.
- The stagger bar of a boss is `kinds.boss.stagger` same-rank hits, the hit worked out by `resolve` (the bruiser's
  strike at average dice on a same-rank normal brute), as the paper's `sameRankHit`.
- The counters read `resolve` on the reducer's own inputs; no rule is worked out in the player.

## Bugs found in `fight.ts` and the rule modules

None. No command was refused in any row and no fight reached the 40-round cap. The two bugs found were in my own
harness (a shared cache key, a NaN ratio) and were fixed before the first logged run.

## What bounds the fight model test's time (the lead's addition)

A profile, not a guess. `bun test` writes no CPU profile, so I played the model test's 2,500 seeds (73,570 commands)
through `randomCommand` and `reduce` in a script under `bun --cpu-prof`, with and without its parse check:

- Generating commands: 0.2 to 0.3 s. `reduce`: 1.8 to 2.0 s.
- The parse invariant (`parseFight(JSON.parse(json(after)))` after every command): 10.9 to 11.9 s. In the profile,
  `JSON.parse` is 26% and `JSON.stringify` 23% of all samples, and `parseFight` 34% inclusive, of which `modified`
  (working each row's sheet out again from its origin) is 19%.
- The rest of the test's 29.6 s is its own checks: `deepFreeze` of the fight and command, and `same()` on the round trip.

43% of the commands (31,530) return the very same fight object, refused or a no-op. The parse check on those repeats
the check of the same object one command earlier. Skipping it when `after === before` weakens no invariant and keeps the
2,500 fights, but it gives back about a fifth of the time, not most, so I did not change the test. The one change that
would give back most is checking the round trip on a sample of commands. That weakens the invariant, so it is the lead's
call.

## Which principle changed a choice

- explain-the-number: the counters (turns, walks, avoided, reduced) went into the player before any change, and they
  found the opening distance, which no lever names.
- attack-the-premise: after two `reactK` values failed the same row I wrote the premise down and tested it (the edge at
  0), which showed the band, not the number, is what fails.
- build-the-lever: every figure in the log reruns from `tests/fight-sim.test.ts` or a few lines over the same player.
- test-behavior-not-implementation: the changed literals in `derive`, `fight` and `resolve` tests were worked from the
  rules (HP at 3.2 from the HP formula, 8 and 88 times 1.75), not read from a run.
- model-the-domain: builds, monsters and rows are tables; a class or a bound is a row.

## The checks

`bun run typecheck` green. `bun scripts/rw-paper.ts` runs; its tables 2.6, 4.1 and 4.5 show the new numbers.
`bun run deps -- --write` changed nothing (the map covers `src`). `bun run test`, last line:
`Ran 2007 tests across 53 files. [84.38s]` (1990 pass, 17 todo, 0 fail).
