# Unit 8 notes: the four open rows, with the real built-in abilities

Started 17:49 (box clock), worktree `.claude/worktrees/agent-a11acfcee5afa96c3`, from 7b3a7d3.

## Log

- 17:49 Read the brief, u6 and u7 briefs, helper rules, AGENTS.md, sim-log.md (three rounds), notes-u7, principles,
  attack-the-premise, explain-the-number, the owner's notes, design 2, 3, 4, 6, abilities.ts, notes-m2-P1, the sim player.
  Baseline `bun test tests/fight-sim.test.ts`: 60 pass, 4 todo, 15.3 s, every row as round three left it.
- Step 1 committed (446843e): the builds hold the built-ins (bow, Marked Shot, Strike, Shield Wall, Arc Bolt, Mutilation,
  the archetype attacks). Arc Bolt (`2d6 + mag`) put speed beats cannon at C (0.507) and cannon beats tank at S (0.929) out.
- Step 2 committed (209b787): `bulkSlow` 0.025 (plate's bulk). Tank beats speed at S 1.000 to 0.760. The drift was the
  tank's speed alone (factor table in sim-log). Policies now take the fight's rules as a fourth argument, so a scan with
  an override reaches the tank's charge.
- Scratch scan script (not committed): /tmp/claude-0/-home-user-systemgaming/206fb4c5-1ce1-5a23-85a3-ad4e77142f69/scratchpad/scan.ts
- Step 3 committed: `resistDc` 15 to 12 (a1fb5bf; speed beats cannon at C back in, 0.606), the chart's state count
  (a5cb1b1, `bun run charts`; resistDc changed the fight model's walk by 9 states), plate's resist 20 to 60 (fa5f616;
  cannon beats tank in at E, C, S). The premise "plate stops too little magic" was tested and is false: the tank's turns
  decide. tests/items.test.ts (outside the brief's list) had the Tower Shield's resist 3, from the old kit; now 9.
- Step 4 committed (96169c4): a channel's threat follows its payoff and does not fade. Under the boss's aim 0.494 to
  0.117; behind a taunt 1.000 to 0.723. Cause found: the boss stood 1 to 2 tiles from the cannon in 205 of 257 channels
  but aimed at it on 10% of its turns (threat), not range or time.
- Step 5: for-the-owner lines, the paper's table 3.1 header reads `resistDc` (was a literal 15), design 6 "Round four",
  sim-log "Where round four ends" (6d0ecac and the last commit).

## The final table

`bun test tests/fight-sim.test.ts` on the real `reduce`, seeded; 400 fights an opening for the triangle and E rows.

| Row | Value | se | Lines | Adjacent | Bound | State |
|---|---|---|---|---|---|---|
| speed beats cannon at C | 0.606 | 0.015 | 0.838 | 0.375 | 0.60 to 0.90 | test, near |
| tank beats speed at C | 0.798 | 0.012 | 0.598 | 0.998 | 0.60 to 0.90 | test |
| cannon beats tank at C | 0.751 | 0.014 | 0.940 | 0.563 | 0.60 to 0.90 | test |
| speed beats cannon at S | 0.659 | 0.012 | 0.998 | 0.320 | 0.60 to 0.90 | test |
| tank beats speed at S | 0.760 | 0.013 | 0.525 | 0.995 | 0.60 to 0.90 | test |
| cannon beats tank at S | 0.861 | 0.011 | 0.990 | 0.733 | 0.60 to 0.90 | test |
| speed against cannon at E | 0.520 | 0.018 | 0.545 | 0.495 | 0.25 to 0.75 | test |
| tank against speed at E | 0.619 | 0.015 | 0.365 | 0.873 | 0.25 to 0.75 | test |
| cannon against tank at E | 0.651 | 0.015 | 0.870 | 0.432 | 0.25 to 0.75 | test |
| pack at C / S (rounds) | 3.82 / 4.60 | 0.07 / 0.07 | | | 2 to 5 | test |
| boss at C / S (rounds) | 6.48 / 7.95 | 0.04 / 0.04 | | | 4 to 8 | test (S near) |
| hunter down / dies in a boss fight at S | 0.047 / 0.020 | 0.012 / 0.008 | | | 0.25 / 0.05 | test |
| staggers C / S | 2.00 / 2.00 | 0 | | | 1 to 2 | test |
| speed party's clear time ratio C / S | 1.095 / 1.131 | 0.022 / 0.024 | | | 1 or more | test |
| fatigue before fight 3 / speed build spent in fight 3 | 0.010 / 0.910 | 0.010 / 0.029 | | | at most 0.05 / at least 0.5 | test |
| channel under the boss's aim | 0.117 (257) | 0.020 | | | 0.10 to 0.25 | test, near |
| channel behind a taunting tank | 0.723 | 0.022 | | | over 0.5 | test |
| best single use E / C / S | 0.308 / 0.285 / 0.255 | 0.005 / 0.003 / 0.003 | | | at most 0.60 | test |

## Every change, old, new and why

| What | Old | New | Why |
|---|---|---|---|
| The sim's abilities | the test's own Shot, Strike, Bolt, Shield | the built-ins: Hunting Bow, Marked Shot, Strike, Shield Wall, Arc Bolt, Mutilation, the archetype attacks; the sim's own Blast, Focus, Taunt and the support's Bolt where no built-in exists | The brief's step 1. Arc Bolt (`2d6 + mag`) put speed beats cannon at C (0.507) and cannon beats tank at S (0.929) out |
| `bulkSlow` (new) | 0 | 0.025 | Strength lifts weight, not bulk: weight over 20 slows any wearer 2.5% a point. Only plate has bulk (30%), so a tank runs at 70 at C and S. The whole C-to-S drift of tank beats speed was the tank's speed (87 at S); tank beats speed at S 1.000 to 0.760 |
| `resistDc` | 15 | 12 | The die decides even against a caster's best Control (15% at the edge's cap, was a natural 20 alone). Speed beats cannon at C 0.507 to 0.606. 11 put the S boss past 8 rounds |
| `kits.heavy.resist` | 20 | 60 | Plate stops magic as it stops steel. The premise "plate stops too little magic" was tested and is false (a tank with no load wins its share at resist 20); resist is the one lever that touches only the cannon's side, and 60 is the value with a reason. Cannon beats tank E 0.945 to 0.651, C 0.969 to 0.751, S 0.982 to 0.861 |
| A channel's threat | faded like an idle hunter's | follows the payoff (times 1.45 a charge, exponential) and does not fade while holding | The boss stood next to the channeler but aimed at it on 10% of its turns. Under the boss's aim 0.494 to 0.117 |
| The sim's policies | read `RULES` | take the fight's rules as a fourth argument | So a scan with an override reaches the tank's charge and the cannon's channel |

Tried and not accepted (sim-log.md has the numbers): the flat part of armor at 0, plate's armor at 40 and a harder HP
cap for the S tank row (each takes C out first); a tank with Discipline third (two builds); plate's resist alone (needs
80); `resistDc` 11, 13 and 10; a curse's resisted share of 0.25 and 0; a channel's charge as a taunt's burst (the taunt
row falls to 0.26), as its hit's threat (every channel breaks), as no decay alone (0.45) or growth alone (0.26).

## Rows still open

None. Three are near an edge (speed beats cannon at C, the channel under fire, the S boss fight); see sim-log.md.

## Which principle changed a choice

- explain-the-number: the S tank row was taken apart factor by factor (HP share, turns share, hit over shot, the tank's
  turns) before any lever moved; it showed the drift was the tank's speed alone, so the flat part, the armor and the HP
  cap were each shown to take C out first rather than tried blind.
- attack-the-premise: after resist 20, 30 and two Discipline tanks failed the cannon's side, I wrote "plate stops too
  little magic" and tested it by removing the tank's load instead: every rank came inside. The cause is the tank's turns,
  so the accepted rules (the DC, plate's resist) act on what only the cannon does, and the walk (the dash) was left.
- model-the-domain: the channel's threat is one rule in the two places a threat table changes in time (`advance`, the
  charge in `startTurn`), with the channel's own growth, and no new number.

## Unsure

- Plate's resist at 60 reverses the design's first reason for the cannon beating the tank ("magic goes past plate"). The
  cannon still wins 0.65 to 0.86, but now through tempo, range and penetration. A lead may prefer 55 (E 0.724, S 0.881,
  both near their edges).
- `resistDc` 12 makes the S boss fight 7.95 rounds (bound 8); any later change that lengthens boss fights will put it out.
- tests/items.test.ts and docs/state-machines.md are outside the brief's list: the Tower Shield's resist literal (3 to
  9, from plate's resist) and the fight chart's state count (38294 to 38285, from the DC) had to move with the rules.
- The dash was left as it is; the decision and its reason are in design 6 "Round four".

## The checks

`bun test tests/fight-sim.test.ts tests/fight.test.ts tests/fight-model.test.ts tests/resolve.test.ts tests/derive.test.ts
tests/effect-ops.test.ts tests/abilities.test.ts tests/rows.test.ts tests/rules.test.ts`, last line:
`Ran 304 tests across 9 files. [46.88s]` (304 pass, 0 fail, 0 todo). `bun scripts/rw-paper.ts` exits 0. The typecheck
has no error in a file this unit touched (20 elsewhere, the wave's). The whole `bun test` fails 44 tests, every one of
them in the save, protocol, applied, encounter and status files the brief names, and none this unit added (the fight
chart's count was the one this unit caused, fixed in a5cb1b1). `docs/dependency-map.md` was not regenerated or committed.
