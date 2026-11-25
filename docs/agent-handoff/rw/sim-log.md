# The balance simulation's log (unit 5)

The rows are `tests/fight-sim.test.ts`; the player is `tests/models/fight-sim.ts`. Each fight runs on the real reducer
with seeded dice, so a rerun prints the same numbers. The test file's header gives the noise floor and how each bound of
design section 6 is read. A share's standard error (se) is sqrt(p(1 - p) / n); a mean's is sd / sqrt(n).

## First run: the rows outside their bound

The first run used the rules as unit 4 left them and the policies as step 1 wrote them. 35 rows played in 13 seconds;
19 rows are outside their bound, and they are `test.todo` with the value below.

| Row | Measured | se | Runs | Bound |
|---|---|---|---|---|
| speed beats cannon one on one at C | 0.207 | 0.020 | 400 | 0.60 to 0.75 |
| tank beats speed one on one at C | 0.100 | 0.015 | 400 | 0.60 to 0.75 |
| cannon beats tank one on one at C | 1.000 | 0.000 | 400 | 0.60 to 0.75 |
| speed beats cannon one on one at S | 0.135 | 0.017 | 400 | 0.60 to 0.75 |
| tank beats speed one on one at S | 1.000 | 0.000 | 400 | 0.60 to 0.75 |
| cannon beats tank one on one at S | 0.993 | 0.004 | 400 | 0.60 to 0.75 |
| speed against cannon at E (speed's share) | 0.235 | 0.021 | 400 | 0.465 to 0.535 |
| tank against speed at E (tank's share) | 0.010 | 0.005 | 400 | 0.465 to 0.535 |
| cannon against tank at E (cannon's share) | 1.000 | 0.000 | 400 | 0.465 to 0.535 |
| three speed builds clear the pack no faster than the mixed party at C (ratio of rounds) | 0.914 | 0.019 | 150 | 1 or more |
| the speed party's front hunter goes down twice as often as the mixed party's at C | neither goes down | | 150 | 2 or more |
| the mixed party beats a same-rank boss at S (rounds) | 9.76 | 0.03 | 300 | 4 to 8 |
| staggers in a boss fight at S | 3.00 | 0.00 | 300 | 1 to 2 |
| three speed builds clear the pack no faster than the mixed party at S (ratio of rounds) | 0.939 | 0.015 | 150 | 1 or more |
| some build at its fatigue capacity before the third fight at C | 0.150 | 0.036 | 100 | at most 0.05 |
| blasts a cannon casts in a dungeon at C (mean) | 1.83 | 0.04 | 100 | 2 to 3 |
| a cannon ends a dungeon with the mana for another blast at C | 0.160 | 0.037 | 100 | at most 0.05 |
| an unprotected channel completes at C (share of channels begun) | 0.961 | 0.014 | 179 channels | 0.10 to 0.25 |
| the best single use on a same-rank tank at E (share of its max HP) | 0.610 | 0.006 | 400 uses | at most 0.60 |

The 16 rows inside their bound: the pack fights at C and S (3.3 and 4.2 rounds, no hunter down in 150 fights), the boss
fight at C (7.35 rounds), hunters down and dead in boss fights at C and S (0.030 and 0.010 down, 0.017 and 0.003 dead),
staggers at C (2.00), the speed party's front hunter at S (0.020 against 0, a ratio with no limit), the speed build at
its capacity in the third fight (0.99), the taunt-protected channel (1.00 of 400) and the best single use at C and S
(0.489 and 0.311 of a tank). The status build beats a tank at C in 0.998 of 400 fights (no bound; see below).

Two harness bugs were fixed before this run and are not misses: two setups shared a cache key, so the taunt-protected
channel row read the cannon-against-tank duels, and a ratio of two zero shares printed NaN.

## Why each row misses (step 3)

The counters below come from the player's tallies (`Tally` in `tests/models/fight-sim.ts`), 200 to 400 seeded fights a
row. No fight in any row reached the 40-round cap and no command was refused, so none of the misses is a stalled fight
or a use the rules threw away. The scripts that printed them read the same player; the numbers rerun the same.

### The triangle at C and S, and the coin flips at E

The design's bounds came from table 6.1's margins (the loser's rounds to kill over the winner's), with no opening
distance and no time lost walking. The duels show three things that table left out.

- **Tank against speed (0.10 at C, 1.00 at S, 0.01 at E).** The tank is melee and the duel starts on the default lines,
  8 tiles apart. At C the tank spends 3.0 of its 6.6 turns walking (stride 3, speed 70), so it strikes 3.6 times for
  18.7 each (67 in all) against the speed build's 81 HP. The speed build stands and shoots 13.8 times for 8.2 each (114)
  against the tank's 111; armor takes 43% of its damage, nothing is dodged. Started adjacent, the same duel is 0.79 at C,
  1.00 at S and 0.43 at E. So most of the miss at C and E is the opening distance, which every melee build pays and no
  ranged one does. At S the tank's 345 HP outlasts the walk, and it wins every fight. The paper's margins (1.07 at C,
  1.78 at S) already said the two ranks differ by far more than the 60 to 75% band allows.
- **Speed against cannon (0.21 at C, 0.14 at S).** The cannon wins with its two blasts. It aims at the target's tile,
  so the speed build must move 4 tiles to be out and 3 to reach the ring. In the 0.6-round wind-up it covers
  8.46 * 0.6 * share tiles, where share is (d20 + edge) / 20, and its edge is round(0.25 * (10 - 26)) = -4: its
  Reaction is 10 (no Instinct), the cannon's Accuracy 26 (Control is its second stat). It is out 4% of the time and in
  the ring 18%, so 78% of blasts land in full for 41.5. Two blasts are 83 against its 81 HP. In those 2.6 rounds it fires
  5.2 shots for 13.1 (68, against the cannon's 81 HP); the cannon dodges 20% of them. The paper's example 3.C centred
  the blast one tile from the target, which gave 55% caught; a cannon that aims at the target is the sensible play.
- **Cannon against tank (1.00 at C, 0.99 at S, 1.00 at E).** The heavy kit has resist 0, so the cannon's magic loses
  nothing to defence (0% taken off). The tank walks 2.9 of its 4.1 turns, but even started adjacent it wins only
  0.005 at C and 0.27 at S. The paper's margin was 1.81 at C. This row is the rules, not the setup.
- **The E rows** have the same three causes; the margins at E are 1.32, 1.05 and 1.93 on paper, and the walk adds to
  the second.

What the rows are measuring is right: each build plays as a table would, nothing is capped or refused, and the dice are
spread by the seed. What they show is that a win share moves far faster than the paper's margin. A duel is 5 to 15
uses a side, so a margin of 1.2 in rounds to kill is already about a 0.8 share, and the 60 to 75% band asks for margins
of about 1.05 to 1.15 at both C and S at once.

### The speed lever, tried twice (attack the premise)

The design's first lever for speed against cannon is `reactK` (the weight of Reaction against Accuracy). Two values,
everything else as shipped, 400 fights each:

| reactK | speed beats cannon at E | at C | at S | tank beats speed at C |
|---|---|---|---|---|
| 0.25 (shipped) | 0.235 | 0.207 | 0.135 | 0.100 |
| 0.1 | 0.310 | 0.360 | 0.255 | 0.100 |
| 0 (no Accuracy edge at all) | 0.310 | 0.485 | 0.507 | 0.100 |

Both fail the same bound, so per attack-the-premise I stopped before a third. The premise both shared: "the speed build
loses to the cannon because the cannon's Accuracy takes away its dodge." The test of it is the last line. With the edge
gone entirely the speed build is still a coin flip, not 60 to 75%. So the edge is part of it, and the rest is that a
radius-2 blast with a ring to 3 aimed at the target needs a 4-tile move to avoid it in full, which a 0.6-round wind-up
gives the speed build only on a high die, and that two of them kill it. The other lever the design names, the blast's
wind-up (600 ticks), is `KINDS.blast` in `src/core/registry/ability-kinds.ts`, not a number in `RULES.fight`, so this
unit may not move it. I left `reactK` at 0.25: a change that leaves the row outside its bound is not accepted.

### The speed party (clears 0.91 and 0.94 of the mixed party's time; front hunter down: neither)

Three speed builds clear a C pack in 3.01 rounds against the mixed party's 3.30, so they are faster, and neither
party's front hunter goes down in 150 fights. A normal brute at C deals little to anyone in the 3 rounds a pack lives,
and the brutes spend their first turns walking 8 tiles while the speed builds shoot. The bound assumed the pack reaches
the front hunter and hurts it. At S one speed hunter went down in 3 of 150 fights and no mixed hunter did.

### The boss at S (9.76 rounds; staggers 3.00)

The party wins every boss fight. At S the boss lives 9.8 rounds: the tank spends 6.8 of its 9 turns taunting to keep
the boss off the cannon, so the party deals damage with two hunters most of the time. The paper's 8.2 already sat at
the top of the bound. Its lever is the boss's HP factor (`kinds.boss.hp`). Three staggers at S follow from the length:
the bar fills at 4, 6 and 9 same-rank hits, 19 in all, and the party deals about 24 hits to an S boss.

### Fatigue (some build at capacity before the third fight in 0.15 of dungeons)

It is the speed build every time (15 of 100). It ends fight 1 at 71.7 fatigue on average and fight 2 at 93.2 (most
100), as the paper's table 6.4 said (73 and 95). Fights last the 6 rounds the reference asks for (6.1 on average; the GM
ends them). With 95 expected after fight 2, a few more shots than average reach 100. The lever is `FIGHT_REST`, which is
not in `RULES.fight`: today's short rest (`rules.rest.short.fatigue`) gives 25, and the sim uses the paper's 50.

### Mana (1.83 blasts a dungeon; mana for another left in 0.16)

A C cannon has 24 mana, enough for exactly two 10-mana blasts (the cost cut of 0.07 rounds back up to 10), so the mana
numbers allow what the bound asks. It casts 0.78, 0.71 and 0.34 blasts in the three fights because its policy never
blasts where the radius or the ring would catch an ally (the blast is not foes-only, and the tank and bruiser stand next
to the bosses after the first round). This row rests on that policy, not on `manaBase` or `manaCap`.

### The unprotected channel (0.96 of 179 channels complete)

No channel was broken: the cannon begins one only when the boss is aiming at someone else, and the boss then keeps its
target, because the channeling cannon deals no damage and its threat decays. The design's 10 to 25% assumed a boss that
aims at the channeler a third of the time. With a threat table and a suggested target the GM can see, a sensible cannon
picks its moment, so `holdBase` is never tested: no hit reaches the cannon. In 121 of the 300 fights the cannon never
began a channel, because its own bolts kept it at the top of the threat table.

### The best single use at E (0.610 of a tank's HP)

The cannon's blast on an E tank: 1.5 * (2d8 + mag) magical against resist 0, crits included, a tank that rarely gets
out (speed 65). Next is the cannon's bolt at 0.27. The paper's figure was 0.59 with no crit; the crits (1 face of 20,
1.5 times) add the rest. It is 1.7 standard errors over the line.

### The three rows closest to an edge

- **Staggers at C (2.00, every fight).** It sits on the top edge. The C boss lives about 17 same-rank hits; 4 and 6 hits
  fill the bar twice and the third bar (9 more) never fills. It is inside because the regrowth is exactly what stops a
  third, so the row would move with any change to boss HP.
- **A hunter dies in a C boss fight (0.017 of 300, se 0.007, bound 0.05).** 9 of 300 fights had a hunter down; 5 of
  those died on their saves. The tank's taunts keep the boss on it, and the tank is the one that goes down.
- **The boss fight at C (7.35 rounds, bound 8).** 0.65 rounds from the edge, and the same taunting tank sets it.

### The status build against a tank at C (the lead's addition)

A Power 2 : Control 1 build whose signature puts on Burning (phase 4's 3d8 a round at C, 3 rounds) and bolts in between
beats a C tank in 0.998 of 400 fights, in 4.5 rounds. Per-round damage skips armor and resist (unit 4's choice), but the
bolt is magical and the tank has resist 0 anyway, so against this tank the status build is a second cannon. It does not
make the tank row miss (the tank row is about speed) and the cannon row is already at 1.00 without it. What it shows is
that a status build is an answer to a tank, as the lead wanted, by a margin that hides any effect of skipping armor.

## Tuning (step 4)

Speed came first, as the design orders. `reactK` was tried at 0.1 and 0 and both left speed against cannon outside its
bound (above), so it stays at 0.25. Defence (`armorK`, the heavy kit, `resistDisCap`) would move the triangle rows,
whose misses rest on the premise above, not on one number; I did not move them. Resources: fatigue's lever,
`FIGHT_REST`, and the blast's mana are not in `RULES.fight`, and the mana row rests on the policy, so neither was moved.
Two changes were accepted, each re-measured on every row:

| Row | Lever | Old | New | Why, for a GM | Row before | Row after | Other rows |
|---|---|---|---|---|---|---|---|
| the mixed party beats a same-rank boss in 4 to 8 rounds at S | `kinds.boss.hp` | 4 | 3.2 | At 4 the S party needed nearly 10 rounds for a boss, because the tank spends most turns taunting; a boss of 3.2 bodies lasts 6 rounds at C and 8 at S | 9.76 (se 0.03) | 7.88 (se 0.03) | boss at C 7.35 to 5.95; hunters down in boss fights 0.030 to 0.003 (C), 0.010 to 0 (S); staggers at S 3.00 to 2.30; unprotected channel 0.96 to 0.88; none moved out |
| a boss fight has 1 or 2 staggers at S | `staggerRegrow` | 0.5 | 0.75 | Each stagger makes the next bar 75% bigger instead of 50%, so even the longest boss fight is staggered twice and not three times | 2.30 (se 0.03) | 2.00 (se 0) | boss rounds 5.95 to 5.94 (C) and 7.88 to 7.87 (S); unprotected channel 0.88 to 0.92; none moved out |

Each change also moved the number's comment in `rules.ts`, its text in `design.md` (sections 2.4 and 4.3, and the
summary's point 11), the boss rows of table 2.6 in `tests/derive.test.ts` (worked from the HP rule at 3.2) and the
regrowth test in `tests/fight.test.ts` (8 grows to 14). `scripts/rw-paper.ts` reads both numbers from `RULES.fight`,
so its tables 2.6, 4.1 and 4.5 print the new values. Its table 6.2 and the design's paper-check lines are the paper's
figures at the old factor, which section 6's text now says.

## Bounds I would change

Each of these stays `todo` with its measured value. Not one was loosened.

- **The triangle's 60 to 75% (six rows) and the E coin flips (three rows).** The reason given ("a build that trades
  all damage for turns must lose to the build that trades all turns for defence") survives; the band does not. A duel is
  5 to 15 uses a side, so its win share is close to all or nothing once one side's time to kill is 1.2 times the
  other's, and the builds' times to kill move apart by rank (tank against speed is 0.10 at C and 1.00 at S, on the same
  rules). No single number puts both ranks in a 15-point band. Two facts the band's paper margins left out also decide
  most fights: the 8-tile opening distance, which a melee build pays and a ranged one does not (tank against speed at C
  is 0.79 when they start adjacent), and the tank's resist of 0, which hands every magical build a 1.8 margin. I would
  restate the bound as a direction and a minimum, "the favoured build wins at least 60% at C and S", and add the
  opening distance to the setup the bound names. The evidence is the reactK table and the two duel distances above.
- **The unprotected channel's 10 to 25%.** The bound assumed a boss that aims at the channeler a third of the time. The
  threat table makes the boss's target visible and stable, so a cannon that begins its channel while the boss looks
  elsewhere completes 92% of them and no hit ever reaches it. `holdBase` is never tested (moving it 20% changed nothing).
  I would restate it against the case that matters: a channel begun while the boss is aiming at the channeler.
- **The speed party's two rows.** A same-rank pack of normal brutes reaches no one in the 3 rounds it lives, so "its
  front hunter goes down at least twice as often" compares 0 with 0 at C. The bound needs a pack that can hurt: a pack
  of skirmishers or casters (ranged), or an elite in it.
- **The cannon's blasts a dungeon.** It holds as a number (24 mana is two blasts); the miss is that a sensible cannon
  will not blast its own tank. The bound should count the blasts the mana allows, or the blast should be foes-only.

## What the table cannot show (step 5)

Moved 20% each (200 fights a setup at C): `holdBase` 0.15 to 0.18 changed no row; `threatDecay` 0.1 to 0.12 moved the
unprotected channel 0.92 to 0.90 and nothing else; `tauntBurst` 2 to 2.4 shortened the C boss fight 5.93 to 5.81 rounds;
`critSizeBase` 1.5 to 1.8 shortened it to 5.86; `armorK` 100 to 120 dropped tank against speed 0.09 to 0.05 and the boss
fight to 5.77. Cannon against tank (1.00) and speed against cannon (0.23) moved for none of them. So the channel's
`hold`, the crit's size and threat's decay are numbers this table cannot see; the triangle is set by HP, resist 0 and the
walk, not by any one rate.

What rests on the policy more than on the rules: the channel rows (when the cannon begins), the mana row (never blasting
an ally), the tank's taunting (it taunts whenever a monster looks elsewhere, which is what makes boss fights long), and
the speed build standing still (a speed build that kept 11 tiles from a cannon, out of the blast's range 10 and inside
its own 12, would win far more often than 0.21).

Three things to watch in a real session: whether a tank ever reaches a ranged build before it is dead (the walk);
whether a cannon's magic against plate (resist 0) feels like a hard counter or a foregone result; and how often the
boss's suggested target is someone other than the channeling cannon, which decides whether channels are ever broken.

# Round two (unit 6)

The lead restated section 6 after round one (design.md section 6, "The lead's decisions after round one"). Unit 6 makes
the triangle hold by the rules' own logic, one lever at a time. Every table below reruns from
`bun test tests/fight-sim.test.ts`; runs are fights unless a row says otherwise, and se is the standard error.

## First run of the new rows (step 1)

The rules as unit 5 left them. What changed in the rows, not in the rules: each triangle and E row is the mean of two
openings (the default lines and adjacent, 400 fights each), the triangle's band is 60 to 90%, the E band 25 to 75%, the
speed party fights a pack that can hurt (two skirmishers and an elite brute), the mana row counts the blasts a fresh
cannon's mana pays for, and the unprotected channel row reads only channels begun while the boss aimed at the cannon
(a cannon that bolts until the boss turns on it, then begins). 36 rows in 17 s.

| Row | Mean | se | Lines | Adjacent | Bound |
|---|---|---|---|---|---|
| speed beats cannon at C | 0.285 | 0.016 | 0.207 | 0.362 | 0.60 to 0.90 |
| tank beats speed at C | 0.446 | 0.013 | 0.100 | 0.792 | 0.60 to 0.90 |
| cannon beats tank at C | 0.998 | 0.002 | 1.000 | 0.995 | 0.60 to 0.90 |
| speed beats cannon at S | 0.343 | 0.015 | 0.135 | 0.550 | 0.60 to 0.90 |
| tank beats speed at S | 1.000 | 0 | 1.000 | 1.000 | 0.60 to 0.90 |
| cannon beats tank at S | 0.863 | 0.011 | 0.993 | 0.733 | 0.60 to 0.90 (in) |
| speed against cannon at E | 0.416 | 0.016 | 0.235 | 0.598 | 0.25 to 0.75 (in) |
| tank against speed at E | 0.220 | 0.013 | 0.010 | 0.430 | 0.25 to 0.75 |
| cannon against tank at E | 0.982 | 0.005 | 1.000 | 0.965 | 0.25 to 0.75 |

The other new rows:

| Row | Value | se | Runs | Bound |
|---|---|---|---|---|
| speed party's clear time over the mixed party's, against a pack that can hurt, at C | 1.126 (4.70 over 4.17 rounds) | 0.028 | 150 | 1 or more (in) |
| speed party's front hunter down over the mixed party's, same pack, at C | 22 (0.147 over 0.007) | 22 | 150 | 2 or more (in; the mixed party's tank went down once) |
| the same two at S | 1.070 (se 0.020); 0.127 over 0 | | 150 | in |
| the blasts a C cannon's mana pays for | 2 (E 1, S 3) | 0 | rule | 2 to 3 (in) |
| blasts a careful cannon casts in a C dungeon (no bound) | 1.83 | 0.04 | 100 | measured |
| a channel begun while the boss aims at the cannon completes, at C | 0.437 | 0.030 | 279 channels | 0.10 to 0.25 |
| a channel begun while the boss aims elsewhere completes, at C (no bound) | 0.921 | 0.020 | 178 channels | measured |

Every other row is as round one left it. Ten rows are outside and `todo`: five of the triangle, two at E, fatigue before
the third fight, the channel under fire and the single use at E.

## The rank drift (step 2)

Tank against speed was 0.10 at C and 1.00 at S on the same rules. To find which numbers grow at different rates I
played each side of the triangle 200 times per rank and opening and read the player's tallies: each side's HP, damage
a use after defence, uses a round, and from them the rounds each side needs to kill the other. The adjacent opening
takes the walk out, so it shows the curves alone. "Ratio" is the favoured side's lead: the loser's rounds to kill over
the winner's.

| Tank against speed, adjacent | E | C | S |
|---|---|---|---|
| tank's HP over speed's HP | 49 / 45 = 1.09 | 111 / 81 = 1.37 | 345 / 174 = 1.98 |
| tank's damage a use over speed's | 11.7 / 5.4 = 2.17 | 18.7 / 8.2 = 2.28 | 34.5 / 14.7 = 2.35 |
| speed's uses a round over tank's | 1.65 / 0.68 = 2.43 | 2.01 / 0.75 = 2.68 | 2.29 / 0.96 = 2.39 |
| ratio of rounds to kill | 0.98 | 1.17 | 1.93 |

Damage a use and turns a round keep their ratio within 10% from E to S. The HP ratio grows 1.8 times. Its cause is
the HP formula, `g * (45 + 0.5 * x(vit))`: Vitality's part is a share of the body's HP, and it was the one share in
design 2.2 not on the capped curve. A tank's effective Vitality points grow from 7 at E to 34 at C and 88 at S, so its
HP over a base body's went 1.09, 1.37, 1.98, while the speed build's own stat buys turns through `capped(x(agi), 90)`,
1.14, 1.41, 1.62. The same curve drives cannon against tank the other way: the tank's HP outgrew the cannon's damage,
and the ratio fell from 1.82 at C to 1.09 at S (cannon 0.995 adjacent at C, 0.733 at S).

The fix is the design's own rule for a share: `hpMax = g * 45 * (1 + capped(x(vit), 0.9))`. The cap is Agility's cap
on speed, so a main stat's own number grows on one curve whether it buys toughness or turns, and "Vitality adds up to
1.9 times" is now a cap that is never reached. It leaves C nearly where it was (a C tank 114 HP, was 111) and takes the
S tank from 345 to 282. Re-measured, 200 fights a cell:

| Ratio of rounds to kill, adjacent | E | C | S |
|---|---|---|---|
| tank against speed, before | 0.98 | 1.17 | 1.93 |
| tank against speed, after | 1.04 | 1.22 | 1.58 |
| cannon against tank, before | 1.72 | 1.82 | 1.09 |
| cannon against tank, after | 1.66 | 1.77 | 1.41 |
| speed against cannon (unchanged) | 0.96 | 0.89 | 0.91 |

The triangle's six rows, mean of the two openings, 400 fights an opening:

| Row | Before | After | Lines after | Adjacent after |
|---|---|---|---|---|
| speed beats cannon at C | 0.285 (0.016) | 0.285 (0.016) | 0.207 | 0.362 |
| tank beats speed at C | 0.446 (0.013) | 0.491 (0.012) | 0.117 | 0.865 |
| cannon beats tank at C | 0.998 (0.002) | 0.998 (0.002) | 1.000 | 0.995 |
| speed beats cannon at S | 0.343 (0.015) | 0.343 (0.015) | 0.135 | 0.550 |
| tank beats speed at S | 1.000 (0) | 0.975 (0.005) | 0.950 | 1.000 |
| cannon beats tank at S | 0.863 (0.011) | 0.978 (0.005) | 1.000 | 0.955 |

Cannon against tank at S leaves its band, but now for the reason it misses at C (the heavy kit's resist of 0), so one
lever can move both ranks. Tank against speed at E comes inside (0.220 to 0.274), and so does the best single use at E
(0.610 to 0.586, as the E tank has 51 HP, not 49). Boss fights are longer by a third of a round at C (5.94 to 6.32;
the boss is a brute with Vitality second, 324 HP, was 304) and shorter at S (7.87 to 7.75); every other row inside
stays inside.

What drift is left, and why I stop there: from C to S the tank's HP ratio still grows 1.15 times, as any stat's share
does when its points grow, and the tank's uses a round grow 1.11 times against the speed build's, because a stronger
tank carries the heavy kit with less load (speed 70 at C, 87 at S). That second one is the weight counterweight the owner
asked for working as meant. The larger difference between C and S on the default lines is the walk: 8 tiles cost the
tank about 2 rounds at C out of a 7-round fight and 1.5 out of 8 at S. That is levers a to c.

## Levers a to f (step 3)

### a. The builds: two tries, neither accepted

- **The speed build with Instinct second** (Reaction, crit and the opening, in place of Strength). It deals no damage:
  its physical power stays 6, so its shot is 7 against a tank's 74 armor. Speed beats cannon fell to 0.019 at C and
  0.000 at S, and the tank beat it in every fight. That is the owner's "overindexes on speed" build, not a duel build;
  the table's speed build (Agility then Strength) is the one a player picks to fight.
- **The cannon's attack as a travelling bolt** (a magical `shot`, the paper's bolt) in place of the curse, so a fast
  body can step out of its line. Speed beats cannon 0.300 at C, 0.280 at S (from 0.285 and 0.343). Adjacent, the cannon
  never blasts (the blast would catch itself), and the duel is bolt against arrow, near a coin flip (0.36 to 0.46):
  the speed build's 1.41 times the turns, with Strength second, buy the same damage a round as the cannon's one turn
  with Power main, and the cannon's Accuracy (Control second, 26 at C, 54 at S) takes 4 to 6 off the speed build's
  reaction d20, so it dodges an arrow no more often than the cannon does.

The builds are kept. Tank (Vitality, Strength for the plate's weight and its strike) and cannon (Power, Control) are
the second stats a player would pick.

### b. The policies: one try, not accepted

- **The speed build keeps out of every foe's blast range while it can still shoot** (a stride to a tile more than 10
  from the cannon and at most 12 from it). Speed beats cannon 0.330 at C and 0.385 at S, 200 fights an opening; it spends
  turns walking while the cannon walks after it, and the adjacent opening (no blasts at all) stays near a coin flip.

**The premise, written down after two failures on speed against cannon** (the cannon's bolt, the speed policy; round
one's two `reactK` values make four): "the speed build loses to the cannon because the blast lands on it". The test is
the adjacent opening, where the cannon never blasts: speed wins 0.36 to 0.46 there. So the blast is only half of it.
The other half is the damage race. Per round of time the two deal about the same (the speed build's 2.0 shots of 13 at
C against the cannon's 1.1 bolts of 27), and the cannon's Accuracy cancels the speed build's dodge. Speed beats the
cannon by the rules only if its turns buy more than the cannon's Power, or its dodge is not cancelled by Control.
Measured on the blast alone (200 fights an opening, all else as shipped): a wind-up of 800 ticks gives 0.42 at C and
0.37 at S, 1000 gives 0.47 and 0.42, a radius of 1 with a ring to 2 gives 0.44 and 0.41. None reaches 0.6, so lever e
is not enough alone either.

### d. Defence: the heavy kit's resist, accepted

| Number | Old | New | Why, for a GM | Row before | Row after | Other rows |
|---|---|---|---|---|---|---|
| `kits.heavy.resist` | 0 | 20 | Plate carries a third of its armor as resist (17% off magic), so the cannon wins through Power and penetration, not because plate stops nothing | cannon beats tank at S 0.978 (se 0.005) | 0.894 (se 0.010; lines 0.995, adjacent 0.792) | cannon beats tank at C 0.998 to 0.982, at E 0.978 to 0.929 (both still out); best single use at E 0.586 to 0.489, at C 0.476 to 0.404, at S 0.381 to 0.330; no row moved out |

It is inside by 0.6 of a standard error. Resist 30 gives 0.846 at S, 0.965 at C and 0.877 at E (400 fights an
opening), so the lead may prefer the margin. At C the row stays out on the default lines, where the tank walks 8 tiles
under fire and wins none of 400 at either value; adjacent it is 0.96 at 20 and 0.93 at 30.

### d. Defence: a flat part of armor, accepted

"It cannot get through armor": at C armor took 43% of the speed build's shots and the shots still out-damaged the
tank's HP. The new rule (design 3.1 rule 12, `armorFlat`): 3% of the armor or resist left after penetration comes off
each hit before the percentage, so a weak hit loses more than a strong one. It mirrors penetration's flat part.

| Number | Old | New | Why, for a GM | Row before | Row after | Other rows |
|---|---|---|---|---|---|---|
| `armorFlat` (new) | none (0) | 0.03 | A C tank's 74 armor takes 2.2 off every hit before its 43%: 15% more of a speed build's 14-point shot, 7% more of a bruiser's 30-point strike | tank beats speed at C 0.491 (se 0.012) | 0.798 (se 0.012; lines 0.598, adjacent 0.998) | tank against speed at E 0.274 to 0.619 (in); tank beats speed at S 0.975 to 1.000 (out, was out); boss fight at C 6.32 to 6.41 rounds; channel under fire 0.557 to 0.619 (out, was out); no row moved out |

The scan that chose 3% (200 fights an opening): 2% gives 0.64 at C, 3% 0.80, 4% 0.91, 6% 1.00, and 10% flips tank
against speed to 1.00 at every rank. A share a duel moves from 0.5 to 1.0 for a 4-point change in a rule number is the
all-or-nothing round one found; 3% is the middle of the band at C.

What it cannot do is bring the S row down. Tank beats speed at S was 0.975 and is 1.000: the ratio of rounds to kill
there is 1.58, and anything that helps the tank at C helps it at S. Capping Vitality's HP harder (0.5 in place of 0.9)
with 4% flat gave 0.73 at E, 0.60 at C and 0.90 at S, both edges at once, so I did not take it.

### c, e and f: not reached

Lever c (a dash) is what the log points at next for the two tank rows at C on the default lines, where the tank walks
8 tiles under fire (tank beats speed: lines 0.598, adjacent 0.998; cannon beats tank: lines 1.000, adjacent 0.973). A
taunt does nothing in a duel: it forces a target the ranged attacker already aims at, and nothing in it moves or slows
the attacker. I stopped tuning at the time limit before defining a dash. Lever e was measured but not changed (above);
lever f was not needed past step 2.

## Where round two ends

| Row | Value | se | Bound | State |
|---|---|---|---|---|
| speed beats cannon at C | 0.300 (lines 0.207, adjacent 0.393) | 0.016 | 0.60 to 0.90 | todo |
| tank beats speed at C | 0.798 (0.598, 0.998) | 0.012 | 0.60 to 0.90 | test |
| cannon beats tank at C | 0.986 (1.000, 0.973) | 0.004 | 0.60 to 0.90 | todo |
| speed beats cannon at S | 0.346 (0.140, 0.552) | 0.015 | 0.60 to 0.90 | todo |
| tank beats speed at S | 1.000 (1.000, 1.000) | 0 | 0.60 to 0.90 | todo |
| cannon beats tank at S | 0.893 (0.995, 0.790) | 0.010 | 0.60 to 0.90 | test (near the edge) |
| speed against cannon at E | 0.426 | 0.016 | 0.25 to 0.75 | test |
| tank against speed at E | 0.619 | 0.015 | 0.25 to 0.75 | test |
| cannon against tank at E | 0.913 | 0.010 | 0.25 to 0.75 | todo |

Every row of the pack, boss, stagger, single-use and speed-party sets is inside. Still `todo` besides the triangle:
fatigue before the third fight (0.150; `fightRest` is now a rule but I did not move it), and the channel begun under
fire (0.619 of 294 channels; `holdBase` not moved).

What I would do next, in order:

1. **Speed against cannon (both ranks).** The premise above held: without blasts the two trade evenly, and the
   cannon's Accuracy cancels the speed build's dodge. Two rules the design already names would change that without a
   special case: a travelling bolt for the cannon (tried, not enough alone) together with an edge that Agility feeds as
   well as Instinct (the owner's notes give Agility "speed and dodge"), or a longer blast wind-up (1000 ticks reached
   0.47 at C alone). I would test the pair, bolt plus wind-up 1000, first.
2. **The walk (tank rows at C).** Define `dash` as the brief's smallest rule (up to the full `move` in a straight line,
   at a named fatigue cost) and play the tank with it. Cannon beats tank at C is 0.973 adjacent at resist 20, so the
   dash alone will not bring it to 0.90; resist 30 (0.93 adjacent) with it might.
3. **Tank against speed at S (1.000).** The ratio of rounds to kill is still 1.58 there against 1.22 at C. What is
   left of the drift is the tank's HP share still growing (1.41 to 1.62 times) and its load lifting as Strength grows
   (speed 70 to 87). I would take the second to the owner: whether a strong S tank should wear plate nearly free.

## Bounds I would change (round two)

- **The triangle's 60 to 90%, as the mean of two openings.** Each opening is near all or nothing: a 1% change in the
  flat part of armor moved tank against speed at C from 0.64 to 0.80 to 0.91, and adjacent the tank wins 0.998. The
  mean of a near-0 and a near-1 opening can sit in the band while neither opening is close. I would keep the band and
  add that each opening alone is between 0.25 and 0.95, so a matchup the opening decides shows as a miss.
- **Cannon against tank at E (0.913, bound 0.25 to 0.75).** At E the cannon's blast is 0.48 of a tank's HP and the
  tank has 51 HP; the walk alone gives the cannon 0.998 on the lines. It is the same cause as at C, not a separate
  bound to tune.

# Round three (unit 7)

The lead's six decisions for this round are in `brief-u7-triangle-3.md`; each accepted change below is one commit, with
the row before and after and every other row re-measured by `bun test tests/fight-sim.test.ts` (400 fights an opening
for the triangle and E rows). The scans that chose a number ran the same player on seeds 1 to 200 an opening (a
scratch script, not committed), so their values differ from the rows' by the noise of 200 fights (se about 0.035).

## Decision 1: Reaction from Agility, with the blast's wind-up at a full round (accepted)

Reaction was `eff(ins)`. The rule now is `10 + x(ins) + reactAgi * x(agi)`. "Equal weights" can be read two ways, and I
measured both. As a mean (`10 + (x(ins) + x(agi)) / 2`) a C speed build has Reaction 26.8 against the C cannon's
Accuracy 26.0 and an S one 54.1 against 54.4: an edge of 0 at both ranks, which halves Instinct's part for a build that
took it. Counted once each (`reactAgi` 1) the speed build has 17.4, 43.6 and 98.3 at E, C and S, an edge of 1, 4 and 6
(the cap) against the cannon. I chose the second: Instinct keeps the weight it had, and Agility gets the same. I kept
Reaction on `eff` and not on the capped curve the brief names, because the edge compares it with Accuracy, which is
`eff(ctl)` with no cap: a capped Reaction against an uncapped Accuracy loses ground with rank (cap 40: an edge of +1 at
C and -4 at S), the drift round two removed from HP. The edge's own cap of 6 is what bounds it.

Speed beats cannon, every subset of the three changes, 200 fights an opening (mean, then lines and adjacent):

| Set | E | C | S |
|---|---|---|---|
| none (round two's rules) | 0.432 (0.280, 0.585) | 0.315 (0.220, 0.410) | 0.343 (0.135, 0.550) |
| Reaction as the mean | 0.458 | 0.453 (0.495, 0.410) | 0.538 (0.525, 0.550) |
| Reaction once each | 0.482 | 0.557 (0.705, 0.410) | 0.720 (0.890, 0.550) |
| travelling bolt | 0.343 | 0.280 (0.235, 0.325) | 0.340 (0.135, 0.545) |
| wind-up 1000 | 0.570 | 0.475 (0.540, 0.410) | 0.493 (0.435, 0.550) |
| bolt and wind-up 1000 | 0.470 | 0.443 (0.560, 0.325) | 0.490 (0.435, 0.545) |
| Reaction once each and bolt | 0.427 | 0.568 (0.810, 0.325) | 0.880 (0.905, 0.855) |
| Reaction as the mean and wind-up 1000 | 0.583 | 0.570 (0.730, 0.410) | 0.693 (0.835, 0.550) |
| **Reaction once each and wind-up 1000** | 0.593 | **0.630 (0.850, 0.410)** | **0.775 (1.000, 0.550)** |
| all three (Reaction once each) | 0.508 | 0.623 (0.920, 0.325) | 0.927 (1.000, 0.855) |

The travelling bolt is a `curse` with the shot's line and travel (wind-up 100, 80 tiles a round), so a bolt is dodged
and not resisted by Will. It lowers the adjacent opening (0.41 to 0.33 at C): at one tile a bolt lands in 0.11 round,
too soon to step out of, and it no longer loses half to the speed build's Will on 15 or more. So it is not in the set.
The smallest set inside at C and S is Reaction once each with the blast wound up 1000 ticks.

| Row | Before | After (lines, adjacent) |
|---|---|---|
| speed beats cannon at C | 0.300 (se 0.016) | 0.605 (se 0.016; 0.818, 0.393), inside, near the edge |
| speed beats cannon at S | 0.346 (se 0.015) | 0.775 (se 0.012; 0.998, 0.552) |
| speed against cannon at E | 0.426 | 0.576 (0.557, 0.595) |
| cannon beats tank at C / S / E | 0.986 / 0.893 / 0.913 | 0.986 / 0.880 / 0.905 |
| channel begun under fire | 0.619 | 0.533 |
| pack at C / S (rounds) | 3.46 / 4.18 | 3.87 / 4.49 (brutes step out of more blasts) |
| boss at C / S (rounds) | 6.41 / 7.87 | 6.55 / 7.93 |
| speed party: clear time ratio C / S | 1.152 / 1.093 | 1.087 / 1.172 |

Every other row is where it was; no row moved out. What decides the C row is the adjacent opening, which none of the
three moves: side by side the cannon never blasts (it would catch itself), its bolt is a curse that Reaction does not
touch, and the duel is the damage race round two measured (about 0.41 at C, 0.55 at S). On the lines the speed build
now leaves the blast and wins 0.82 at C and nearly every fight at S, which a GM will see in the log as "speed wins from
range, the cannon up close".

## Decision 2: the dash (a rule; no row moved)

The rule as the lead wrote it is in (`move` with `dash: true`, design 4.6, `dashTime` 100 and `dashFatigue` 16 in
`RULES.fight`, tests in `tests/fight.test.ts`, dashes in the fight model's generator). The tank's policy charges when a
dash puts its target within reach of its strike, and only when the dash is the quicker way in: a sensible player does
not spend breath to arrive later.

At the lead's time, a standard action, the tank never charges, and no row moved (every row equal to decision 1's run).
The arithmetic: `move` is the tiles a body walks in a round at its speed, and a standard action at speed `s` lasts
`100 / s` rounds, so in a standard action's time every body walks 6 tiles. A dash of `move` tiles for a standard action
is therefore quicker than a walk only for a body over speed 100: the C speed build runs 8 tiles where it would walk 6,
the C tank runs 4 where it would walk 6. The rule as written helps the fast and never the slow, the opposite of its
reason.

The tank against speed and cannon against tank rows, 200 fights an opening, by the dash's time (`dashTime` in
hundredths of a standard action; the tank charges only when quicker than walking):

| dashTime | tank beats speed E / C / S | cannon beats tank E / C / S |
|---|---|---|
| 100 (the lead's) | 0.633 / 0.785 (lines 0.570) / 1.000 | 0.902 / 0.982 (lines 1.000) / 0.857 |
| 100, the tank charging whenever a charge reaches | 0.522 / 0.655 (lines 0.310) / 1.000 | 0.907 / 0.982 / 0.875 |
| 60 | 0.633 / 0.813 (lines 0.625) / 1.000 | 0.902 / 0.982 / 0.853 |
| 50 | 0.633 / 0.857 (lines 0.715) / 1.000 | 0.902 / 0.982 / 0.843 |
| 40 | 0.662 / 0.897 (lines 0.795) / 1.000 | 0.902 / 0.980 (lines 0.995) / 0.833 |

A quicker dash helps the tank against the speed build at C, where it is already inside, and does nothing for cannon
against tank at C: on the lines the tank loses every duel to the cannon whether it walks or runs, because the cannon's
blasts and bolts kill it in about 4 rounds and resist 20 takes only 17% off them. So I left `dashTime` at the lead's 100
and did not tune it: no open row needs it, and the one it moves is inside. If the lead wants the dash to be the heavy
fighter's charge, the time should be a share of the walk it replaces (for example half the walk's time for the same
tiles), not a fixed action; that is a change to the rule's form, which I did not make.

## Decision 3: a floor on a kit's load (not accepted)

The rule tried: a kit slows its wearer by at least `loadFloor` of the slow it puts on a base body (Strength 10, carry
20), however strong the wearer: `load = 1 - max(slow(carry), loadFloor * slow(20))`. Every kit: plate's slow on a base
body is 35%, the medium kit's 28%, the light kit's 0. At half, the S tank runs at 83 instead of 87; the C tank (70)
already pays more than the floor; the bruiser and every brute in the medium kit, free from Strength 33 until now, slow
from 100 to 86.

Tank against speed adjacent, the ratio of rounds to kill (the loser's over the winner's, from the tallies, 200 fights a
rank; round two's method):

| loadFloor | E | C | S |
|---|---|---|---|
| 0 (today) | 1.35 | 1.45 | 1.73 |
| 0.5 | 1.35 | 1.45 | 1.64 |
| 0.75 | 1.35 | 1.45 | 1.48 |
| 1 | 1.35 | 1.36 | 1.28 |

(These are higher than round two's 1.04, 1.22 and 1.58 because round two measured before the flat part of armor.)

| loadFloor | tank beats speed C | tank beats speed S | cannon beats tank S | rows that move out |
|---|---|---|---|---|
| 0 | 0.798 | 1.000 | 0.880 | |
| 0.5 (400 an opening) | 0.798 | 0.998 (0.995, 1.000) | 0.926 | cannon beats tank at S, the speed party's clear time at C (0.986), the boss at S (8.34 rounds) |
| 0.75 (400 an opening) | 0.798 | 0.880 (in) | 0.976 | the same three (0.976, 0.987, 8.62 rounds) |
| 1 (200 an opening) | 0.613 | 0.605 | 0.995 | not run in full |

At half, the lead's start, the row does not move and three rows go out; at 0.75 the row comes in and the same three go
out. Not accepted. What it shows: a slower tank loses to everyone, so a floor that brings tank against speed down at S
takes cannon against tank at S up by as much. The speed build and the cannon both win by out-acting the tank, and its
turns a round are the one number both rows read. The bruiser and the brutes in the medium kit pay too, which lengthens
the S boss fight past 8 rounds.

## Decision 4: plate's resist at 30 (not accepted)

With the dash in (it changes nothing at a standard action's time), the heavy kit's resist 20 to 30, 400 fights an
opening:

| Row | At 20 | At 30 (lines, adjacent) |
|---|---|---|
| cannon beats tank at C | 0.986 | 0.969 (0.998, 0.940) |
| cannon beats tank at S | 0.880 | 0.827 (0.960, 0.695) |
| cannon against tank at E | 0.905 | 0.848 (0.968, 0.728) |
| best single use E / C / S | 0.430 / 0.382 / 0.309 | 0.394 / 0.353 / 0.288 |

The cannon stays favoured, S moves off its edge, and every other row is where it was, but C and E stay out, so it is
not accepted (the lead may take it for S's margin alone).

**The premise, written down after two tries on it** (round two's resist 20 and this 30): "the cannon beats the tank
because plate stops too little magic". The test: the default lines at each resist, 200 fights, from the tallies.

| Rank | Resist 20 | Resist 60 | Resist 100 | The tank's turns walking, of all its turns |
|---|---|---|---|---|
| E | 0.980 | 0.840 | 0.300 | 3.6 of 5.3 at 20 |
| C | 1.000 | 0.960 | 0.660 | 2.9 of 4.8 at 20 |
| S | 0.965 | 0.745 | 0.215 | 2.9 of 6.2 at 20 |

On the lines at C the cannon wins 96% of duels with resist as large as plate's armor: the tank spends 2.9 of its 4.8
turns walking (speed 70, 7 tiles at 4.2 a round), strikes 1.9 times for about 18 against the cannon's 81 HP, and is dead
in 4.2 rounds. Resist is part of it (adjacent the row falls 0.97, 0.94, 0.85 at 20, 30, 40) but the walk and the tank's
turns decide the C row, and the dash at a standard action does not shorten the walk. At S the same tank has 6.2 turns,
not 4.8, because a strong body carries plate at speed 87 and not 70; that is why the row is inside at S and not at C,
the same speed drift decision 3 found from the other side.

## Decision 5: the fatigue back after a fight (accepted) and the channel's hold (cannot move its row)

`fightRest`, 100 dungeons of three 6-round fights at C (the five builds against two bosses), seeds 1 to 100:

| fightRest | some build at capacity before fight 3 | the speed build at capacity in fight 3 | speed build's fatigue after fight 2 |
|---|---|---|---|
| 50 | 0.15 | 0.99 | 93.2 |
| 55 | 0.01 | 0.92 | 88.2 |
| 60 | 0 | 0.16 | 83.2 |
| 65 | 0 | 0 | 78.2 |

The speed build spends about 72 a fight, so the step from 55 to 60 takes it under its capacity in fight three (100 - 83
is more than most third fights cost). 55 is the one value of the four with both rows inside.

| Number | Old | New | Why, for a GM | Row before | Row after | Other rows |
|---|---|---|---|---|---|---|
| `fightRest` | 50 | 55 | A short breather after a fight gives back 55 fatigue: the archer who shot all fight is near spent going into the third fight and spent in it, and nobody is spent before it | 0.150 (se 0.036) | 0.010 (se 0.010) | the speed build at capacity in fight 3: 0.990 to 0.920 (in); every other row unchanged |

`holdBase`, the channel begun while the boss aims at the cannon (bruiser, speed and cannon against a C boss, 300
fights):

| holdBase | completes |
|---|---|
| 0.5 | 0.628 |
| 0.3 | 0.533 |
| 0.15 (today) | 0.533 |
| 0.1, 0.07, 0.05 | 0.533 |

A lower hold changes nothing, because every hit the boss lands on the cannon already breaks the channel (a C boss's
strike is far over 15% of a cannon's 81 HP). Of the 274 channels begun under the boss's aim, 146 complete, 44 are
broken and 84 end unspent when the fight ends first. So the boss reaches and hits the channeler in only one channel in
six. It is a brute: it must walk 8 tiles to the cannon on the back line while the bruiser in front of it and the speed
build keep adding to its threat table, and it turns to them. Threat decay does not move it either (0.1, 0.05, 0:
0.533, 0.507, 0.505). The row measures how often a melee boss reaches a back-line caster within five turns, which no
channel number decides; `holdBase` stays at 0.15 and the row stays `todo`.

## Where round three ends

| Row | Value (lines, adjacent) | se | Bound | State |
|---|---|---|---|---|
| speed beats cannon at C | 0.605 (0.818, 0.393) | 0.016 | 0.60 to 0.90 | test, near the edge |
| tank beats speed at C | 0.798 (0.598, 0.998) | 0.012 | 0.60 to 0.90 | test |
| cannon beats tank at C | 0.986 (1.000, 0.973) | 0.004 | 0.60 to 0.90 | todo |
| speed beats cannon at S | 0.775 (0.998, 0.552) | 0.012 | 0.60 to 0.90 | test |
| tank beats speed at S | 1.000 (1.000, 1.000) | 0 | 0.60 to 0.90 | todo |
| cannon beats tank at S | 0.880 (0.970, 0.790) | 0.011 | 0.60 to 0.90 | test |
| speed against cannon at E | 0.576 (0.557, 0.595) | 0.017 | 0.25 to 0.75 | test |
| tank against speed at E | 0.619 (0.365, 0.873) | 0.015 | 0.25 to 0.75 | test |
| cannon against tank at E | 0.905 (0.983, 0.828) | 0.010 | 0.25 to 0.75 | todo |
| fatigue: some build at capacity before fight 3 | 0.010 | 0.010 | at most 0.05 | test |
| a channel begun under the boss's aim completes | 0.533 (274 channels) | 0.030 | 0.10 to 0.25 | todo |

Every other row is inside. What is left is one cause seen from two sides: the tank's turns a round. A C tank wears
plate at speed 70 and an S tank at 87, because Strength lifts the load. At C the slow tank loses to the cannon on the
lines (it walks 2.9 of its 4.8 turns) and adjacent (0.97); at S the quicker tank beats the speed build in every duel
from both openings. A change to the tank's speed moves both rows the same way (decision 3's floor), and a change to
plate's resist moves only the cannon's (decision 4). What I would test next, in order:

1. **The tank's speed across ranks, and nothing else.** Make the load's slow depend on the kit's weight over the carry
   in a way that gives the tank nearly the same speed at C and S (the floor at about 0.75 gives 0.88 tank against speed
   at S), together with plate's resist at 30 to 40 for the cannon's side, and the bruiser left out of it (the medium
   kit's floor is what pushed the S boss past 8 rounds). That is a two-number change to measure as a pair, as decision 1
   was.
2. **The dash's time as a share of the walk it replaces**, if the lead wants the dash to be the heavy fighter's charge:
   at a standard action it is quicker than walking only for a body over speed 100.
3. **The channel row's setup.** A melee boss that must walk 8 tiles to a back-line caster seldom reaches it in five
   turns; a channel begun within the boss's reach, or a ranged boss, would measure what `hold` is for.

# Round four (unit 8)

The brief is `brief-u8-duels.md`: close the four open rows with the real built-in abilities, one lever at a time. Each
accepted change below is one commit, with every row re-measured by `bun test tests/fight-sim.test.ts` (400 fights an
opening for the triangle and E rows).

## Step 1: the builds play the built-in abilities

Until now each build used abilities the simulation made for itself. They now hold what `hunterAbilities`
(`src/core/combat/rows.ts`) would give the starter hunter of their kind (`src/views/starter.js`): the weapon's attack
first, then the built-in skills. Where no built-in exists the simulation's own stays.

| Build | Holds now | Was | What changed in play |
|---|---|---|---|
| speed | Hunting Bow (`0.7 * (1d8 + phys)`), Marked Shot | Shot, the same formula | nothing: Marked Shot (`0.7 * (1d6 + phys)`, cooldown 2 rounds) is never the better arrow, so the policy never takes it |
| tank | Strike (no weapon, `1d8 + phys`), Shield Wall, the simulation's Taunt | Strike, Taunt | nothing: Shield Wall's `1.5 * sup` is 9 at Presence 10, half a strike, so the policy never takes it. No built-in taunt exists |
| cannon | Strike, Arc Bolt (`2d6 + mag`), the simulation's Blast and Focus | Bolt (`1d8 + mag`), Blast, Focus | the bolt is 2.5 stronger on average: +17% of its raw damage at E (14.9 to 17.4), +8% at C (30.7 to 33.2), +4% at S (63.5 to 66.0). No built-in hunter blast or channel exists |
| bruiser | Strike, Mutilation (`2d6 + phys`, cooldown 3 rounds) | Strike | Mutilation whenever it is ready |
| support | Strike, Shield Wall, the simulation's Bolt | Shield (no cooldown), Bolt | its shield waits 3 rounds between casts. No built-in ranged attack for a Presence build exists |
| status | Strike, Ignite, Arc Bolt | Ignite, Bolt | its bolt is Arc Bolt, as the cannon's |
| monsters | the built-in archetype attacks (Strike, Shot, Curse) | the same formulas | nothing |

The passives of the starter hunters (Iron Skin's +2 Vitality, Trailsense, Mana Sense) are not abilities and are left out.

The rows that moved, 400 fights an opening (round three's end, then now; lines and adjacent after):

| Row | Round three | Built-ins (lines, adjacent) | Bound | State |
|---|---|---|---|---|
| speed beats cannon at C | 0.605 (se 0.016) | 0.507 (se 0.014; 0.820, 0.195) | 0.60 to 0.90 | moved out |
| tank beats speed at C | 0.798 | 0.798 (0.598, 0.998) | 0.60 to 0.90 | in |
| cannon beats tank at C | 0.986 | 0.990 (1.000, 0.980) | 0.60 to 0.90 | out |
| speed beats cannon at S | 0.775 | 0.613 (se 0.011; 0.998, 0.228) | 0.60 to 0.90 | in, 1.2 se from the edge |
| tank beats speed at S | 1.000 | 1.000 (1.000, 1.000) | 0.60 to 0.90 | out |
| cannon beats tank at S | 0.880 | 0.929 (se 0.009; 0.975, 0.882) | 0.60 to 0.90 | moved out |
| speed against cannon at E | 0.576 | 0.424 (0.497, 0.350) | 0.25 to 0.75 | in |
| tank against speed at E | 0.619 | 0.619 (0.365, 0.873) | 0.25 to 0.75 | in |
| cannon against tank at E | 0.905 | 0.975 (se 0.005; 1.000, 0.950) | 0.25 to 0.75 | out |
| mixed party, pack, C / S (rounds) | 3.87 / 4.49 | 3.71 / 4.40 | 2 to 5 | in |
| mixed party, boss, C / S (rounds) | 6.55 / 7.93 | 6.25 / 7.76 | 4 to 8 | in |
| hunter down / dies in a boss fight at S | 0 / 0 | 0.007 / 0.003 | 0.25 / 0.05 | in |
| speed party's clear time ratio C / S | 1.087 / 1.172 | 1.120 / 1.188 | 1 or more | in |
| speed build at capacity in fight 3 | 0.920 | 0.900 | at least 0.5 | in |
| channel begun under the boss's aim | 0.533 (274 channels) | 0.489 (276; 55 broken in all) | 0.10 to 0.25 | out |
| status build beats a tank at C (no bound) | 0.998 | 1.000 | none | measured |

Every other row is where it was. Why the cannon's rows moved so far for 2.5 points of dice: a duel is decided by whole
hits. Adjacent at C the speed build has 81 HP, and the cannon's bolt after the speed build's resist 15 and its Will
(it resists on 19 or 20, an edge of -4) is about 25 with `1d8` and 27 with `2d6`: three bolts kill it about half the
time with the old bolt and most of the time with Arc Bolt, in the 3 rounds the speed build needs for its 6.5 arrows.
Adjacent the cannon never blasts, so the bolt is its whole damage; that opening fell 0.393 to 0.195. On the lines the
speed build leaves the blast and the opening is unchanged (0.818 to 0.820). Against the tank the bolt is likewise the
cannon's damage between its two blasts.

Six rows are outside now: the four the brief names (cannon beats tank at C and E further out) and two that were inside
(speed beats cannon at C, cannon beats tank at S). The mage's own skill makes the cannon stronger against both other
builds, so the levers below have to bring two sides of the triangle back, not one.

## Step 2: tank beats speed at S (accepted: plate's bulk)

**What the speed build deals.** At S its Hunting Bow is `0.7 * (1d8 + 32.6)`, 26.0 raw. The S tank's armor is 81: the
flat part takes 2.4 (3% of 81), the rest loses 81 / 181, so a shot deals 13.0, 2.31 shots a round (speed 162, a quick
action of 70) with nothing dodged and 5% crits: 30.8 a round against 282 HP, 9.2 rounds. The tank's strike is
`1d8 + 32.6` against armor 10, 33.5, at 0.87 strikes a round (speed 87): 29.1 a round against 174 HP, 6.0 rounds. The
ratio of rounds to kill is 1.57. At C the same sums give 8.3 and 6.4 rounds, 1.30, and the C row is 0.79.

**Where the 1.57 against 1.30 comes from**, factor by factor from C to S (the ratio is the tank's HP over the speed
build's, times the tank's damage a round over the speed build's):

| Factor | C | S | S over C |
|---|---|---|---|
| tank's HP over speed's (Vitality's share, 1.41 then 1.62) | 1.41 | 1.62 | 1.15 |
| speed build's shots a round (Agility's share, 1.41 then 1.62, over 0.7) | 2.01 | 2.31 | 1.15 |
| tank's strike over the speed build's shot, after defence | 18.0 / 6.81 = 2.64 | 33.5 / 13.0 = 2.58 | 0.97 |
| tank's strikes a round (its speed in plate) | 0.70 | 0.87 | 1.24 |

The two shares grow alike by design (round two put HP on Agility's curve), so they cancel. What is left is the tank's
speed: an S tank's Strength (83) lifts plate's load from 30% to 13%. That is the whole drift. The brief's candidates,
each checked against that, 200 fights an opening (E, C, S):

- **The flat part of armor.** It takes 2.2 of a C shot's 14.1 (15.8%) and 2.4 of an S shot's 26.0 (9.4%). It already
  bites less at S, because armor barely grows with rank (74 to 81) while a shot nearly doubles; it scales with armor,
  not rank, and should stay so. At 0 the rows are 0.29, 0.48, 0.98: C falls out long before S comes in.
- **The heavy kit's armor.** Armor's share is 42.5% of a hit at C and 44.8% at S, nearly flat. Plate at 40 armor gives
  0.27, 0.45, 0.92: the same shape.
- **Penetration from Agility or the bow.** A share of armor ignored helps both ranks alike, since armor's share is the
  same at both (Agility's capped curve at 0.4 would add 12% to a C shot and 17% to an S one, 1.05 between them); a flat
  5 from the bow adds 4% at both. Neither touches the drift; not tried in the code.
- **The tank's HP share.** It is matched by the speed build's turns. Capping it harder (0.6) gives 0.56, 0.56, 0.93:
  the C row loses as much as S.

So the lever is the tank's speed at S and nothing else. Round three's floor on every kit's load did this and also
slowed the medium kit (the bruiser and every brute), which put the S boss fight and the speed party's clear time out.
The rule taken is narrower and has its own reason: **Strength lifts weight but does not shrink plate.** Weight over a
base body's whole carry (`carryBase`, 20) is bulk, and slows any wearer `bulkSlow` a point, at most `loadSlow`. Plate
(32) has 12 points of bulk; the medium kit (18) and the light kit (8) have none, so nobody else changes. The scan:

| bulkSlow | S tank's speed | tank beats speed E / C / S | cannon beats tank E / C / S |
|---|---|---|---|
| 0 | 87 | 0.633 / 0.785 / 1.000 | 0.975 / 0.985 / 0.915 |
| 0.02 (24%) | 76 | 0.633 / 0.785 / 0.925 | 0.975 / 0.985 / 0.980 |
| 0.025 (30%) | 70, as at C | 0.633 / 0.785 / 0.748 | 0.975 / 0.985 / 0.998 |

At 0.025 the S tank runs at the C tank's 70, and the S row lands where the C row is. The paper's table 6.1 margins are
now flat across ranks: tank over speed 1.23, 1.25, 1.24 at E, C, S; cannon over tank 1.48, 1.47, 1.46.

| Number | Old | New | Why, for a GM | Row before | Row after | Other rows |
|---|---|---|---|---|---|---|
| `bulkSlow` (new), in the load factor | none (0) | 0.025 | However strong, a body in full plate is 30% slower: Strength carries the weight, not the bulk | tank beats speed at S 1.000 (se 0) | 0.760 (se 0.013; lines 0.525, adjacent 0.995) | cannon beats tank at S 0.929 to 0.998 (was out); hunter down in an S boss fight 0.007 to 0.040 and dead 0.003 to 0.017 (in); best single use at S 0.309 to 0.328 (in); nothing at E or C moved, no row moved out |

The cannon's row at S now misses for the reason it misses at C (0.985): the S tank was beating the cannon on its speed
too. One cause is left on that side for all three ranks, which is step 3.

## Step 3: cannon beats tank at E, C and S, and speed beats cannon at C

After step 2 the cannon's side is out at every rank (E 0.975, C 0.985, S 0.998, 200 fights an opening) and Arc Bolt has
put speed beats cannon at C out (0.507). The brief's candidates for the cannon's side, in its order, 200 fights an
opening (E, C, S; mean, then lines and adjacent):

- **The duel's opening distance.** No rule says a duel starts 8 tiles apart, but adjacent alone the cannon already wins
  0.950, 0.970 and 0.995. A shorter opening cannot bring the mean under 0.90, so the setup is not what misses.
- **Discipline for the tank.** Two tanks that take it: Vitality 2 : Strength 1 : Discipline 1 (C: Vitality 52,
  Strength 27, Discipline 27; resist 29, Will 22) and the 2:1 build with every perk on Discipline (C: Discipline 17,
  resist 25, Will 15). Cannon against tank 0.975 / 0.992 / 0.998 and 0.968 / 0.972 / 0.995; tank against speed falls to
  0.51 / 0.27 / 0.27 with the first (the Strength it gives up slows it in plate and blunts its strike). A resisted curse
  is half of one bolt in ten more; it does not move the duel. Not a build a player in plate should take.
- **The dash at a shorter time** (round three, 400 fights: `dashTime` 40 left cannon beats tank at C at 0.980 and took
  tank beats speed at C to 0.897, the top edge). The adjacent number above says the walk is not what decides the C duel;
  it is not rerun.
- **Plate's resist**, alone (with bulk in):

| Heavy kit's resist | E | C | S |
|---|---|---|---|
| 20 (today) | 0.975 (1.000, 0.950) | 0.985 (1.000, 0.970) | 0.998 (1.000, 0.995) |
| 40 | 0.917 | 0.960 | 0.978 |
| 50 | 0.843 | 0.915 | 0.935 |
| 60 | 0.785 (0.950, 0.620) | 0.857 (0.975, 0.740) | 0.920 (1.000, 0.840) |
| 80 | 0.570 | 0.698 | 0.797 (0.985, 0.610) |

Resist alone needs about 80, more than plate's armor (60): plate stopping magic better than steel is not a rule a GM
would believe.

**The premise, written down** (round two's resist 20, round three's 30 and the Discipline tanks above make four tries
on it): "the cannon beats the tank because plate stops too little magic". The test: leave plate's resist at 20 and take
away the tank's slowness instead (no load and no bulk, the tank at speed 100). Cannon beats tank: 0.583 (0.700, 0.465)
at E, 0.708 (0.845, 0.570) at C, 0.762 (0.900, 0.625) at S, all inside; tank beats speed goes to 1.000 at C and S. So
the premise is false: the cannon wins on the tank's turns. In plate the tank acts 0.70 times a round to the cannon's 1.0
and deals 18 a strike to the cannon's 28 a bolt, so it deals 0.45 of the cannon's damage a round with 1.41 times its HP.
The tank's speed is the one number both of its rows read, in opposite directions (round three found the same from the
speed side): slower, it beats the speed build less and loses to the cannon more. A rule that helps the tank against the
cannon without speeding it must act on what only the cannon does, which is magic and curses.

**What only the cannon does: a curse no one resists.** A curse has no travel, so the target's Will resists it in place
of a dodge (`d20 + edge(will, aim) >= 15`, half damage). The edge is the target's Will against the user's Accuracy,
which the cannon's Control (its second stat) raises with rank while Will stays at 10 for every build that does not take
Discipline: edge -4 at C and -6 (the cap) at S, so a C cannon's curse is resisted on 19 or 20 (10%) and an S one's only
on a natural 20 (5%). That is the "the d20 decides nothing" design 3.2 caps the edge to avoid, and it is round three's
Reaction finding from the other side: Agility now feeds the dodge of an arrow or a blast, but the curse is the one
attack nothing but Discipline answers. The DC, 400 fights an opening for the rows:

| resistDc | speed beats cannon C / S | cannon beats tank E / C / S | boss at S (rounds) |
|---|---|---|---|
| 15 (today) | 0.507 / 0.613 | 0.975 / 0.990 / 0.998 | 7.73 |
| 13 | 0.574 / 0.634 | 0.960 / 0.976 / 0.991 | 7.85 |
| **12** | **0.606 / 0.659** | 0.945 / 0.969 / 0.982 | 7.95 |
| 11 (a coin flip at parity) | 0.640 / 0.690 | 0.926 / 0.961 / 0.974 | 8.05 (out) |
| 10 (200 fights) | 0.682 / 0.710 | 0.893 / 0.943 / 0.968 | not run |

At 11 the S boss (a brute with Will 10) resists enough of the cannon's bolts to last past 8 rounds; at 12 it is 7.95.
12 is the one value with speed beats cannon at C inside and no row out.

| Number | Old | New | Why, for a GM | Row before | Row after | Other rows |
|---|---|---|---|---|---|---|
| `resistDc` | 15 | 12 | A curse is shrugged off for half on 12 or more (with the Will edge): 45% at parity, and still 15% against the best caster's Control, so the die decides | speed beats cannon at C 0.507 (se 0.014) | 0.606 (se 0.015; lines 0.838, adjacent 0.375), inside, near the edge | speed beats cannon at S 0.613 to 0.659; at E 0.424 to 0.520; cannon beats tank E 0.975 to 0.945, C 0.990 to 0.969, S 0.998 to 0.982 (still out); boss at S 7.73 to 7.95 rounds (in, near the edge), at C 6.25 to 6.48; status build beats a tank 1.000 to 0.988; channel under fire 0.489 to 0.494; no row moved out |

### Plate's resist at its armor (accepted)

With the DC at 12 the cannon's side is 0.945, 0.969 and 0.982. Of the brief's candidates only plate's resist is left,
and the premise test above says what it is: a compensation for the tank's turns, not their cause. It is still the one
number that acts on what only the cannon does without touching the tank's speed, so it is the lever, and the question
is which value has a reason a GM would accept. The scan with the DC at 12, 400 fights an opening (mean; lines, adjacent):

| Heavy kit's resist | E | C | S |
|---|---|---|---|
| 50 | 0.761 (0.940, 0.583) | 0.845 (0.978, 0.713) | 0.904 (1.000, 0.807) |
| 55 | 0.724 (0.925, 0.522) | 0.797 (0.965, 0.630) | 0.881 (0.998, 0.765) |
| 60 | 0.651 (0.870, 0.432) | 0.751 (0.940, 0.563) | 0.861 (0.990, 0.733) |

50 leaves E and S out; 55 puts both within 1.5 standard errors of their edges. 60 is plate's armor: plate stops a bolt
as it stops a blade (37% off), which is a rule with a reason of its own, and every row is inside with room. The cannon
stays favoured at C and S because it acts 1.4 times as often as a tank in plate (100 against 70), outranges it on the
lines (where it wins 0.87 to 0.99) and its Control ignores 11% (C) to 21% (S) of the resist.

| Number | Old | New | Why, for a GM | Row before | Row after | Other rows |
|---|---|---|---|---|---|---|
| `kits.heavy.resist` | 20 | 60 | Plate stops magic as well as steel; a mage beats a knight by acting more often and from range, not because plate lets magic through | cannon beats tank at C 0.969 (se 0.006); at S 0.982 (0.005); at E 0.945 (0.008) | C 0.751 (se 0.014; lines 0.940, adjacent 0.563); S 0.861 (0.011; 0.990, 0.733); E 0.651 (0.015; 0.870, 0.432) | best single use on a tank E 0.430 to 0.308, C 0.382 to 0.285, S 0.328 to 0.255 (the blast is still the best); status build beats a tank 0.988 to 0.968; no other row moved |

The literals that came from the old resist moved with it: table 2.5's heavy kit (`tests/derive.test.ts`, 20 to 60),
example 3.C's blast on the C tank (`tests/resolve.test.ts`, 44 and 22 to 33 and 16, worked from the rule: a raw 52.7
against 60 resist less the cannon's 11.4% penetration, 53.1, less its 3% flat, times 100 over 153.1), and the Dented
Tower Shield's resist (`tests/items.test.ts`, 15% of the kit: 3 to 9).

## Step 4: the channel under the boss's aim (accepted: a channel draws threat)

The row: a C party of bruiser, speed build and cannon against a C boss (a brute); the cannon bolts until the boss's
suggested target is the cannon, then begins Focus (5 charges, exponential). 0.494 of 257 such channels completed (se
0.031). The brief's four suspects, from a scratch player that wraps the boss's and the cannon's policies and records,
for each channel begun under the boss's aim, the boss's distance to the cannon and whom the boss aims at on each of its
turns while the channel holds (300 fights, the same seeds as the row):

- **Range.** The boss is 1 tile from the cannon in 131 of 257 channels and 2 in 74; only 52 begin farther off. The boss
  has walked to the cannon by the time it aims at it, so range is not it, and round three's "the boss reaches the
  channeler in only 44" counted hits, not reach.
- **The boss's speed and the channel's time.** The boss has 2.98 turns on average while the channel holds, enough to
  break it two or three times over (any of its strikes is over the cannon's hold).
- **The threat table sends it elsewhere.** On those 2.98 turns the boss aims at the cannon 0.31 times: 10% of its turns.
  The moment the cannon begins, it deals no damage, its entry decays 10% a round, and the bruiser's and the speed
  build's hits pass it within a turn. That is the cause. The bound's premise (round one: "a boss that aims at the
  channeler a third of the time") is false under the rules as they were, not because of the setup.

So the rule is wrong, not the bound: a channel is the one action that shows every foe a growing threat, and the threat
table ignored it. The smallest rule that makes the premise true, measured in its parts (300 channels' fights, the same
seeds; taunt row 400 fights):

| Rule | under the boss's aim (10 to 25%) | aimed elsewhere (no bound) | behind a taunting tank (over 50%) | boss aims at the cannon, of its turns while holding |
|---|---|---|---|---|
| none | 0.494 | 0.967 | 1.000 | 0.31 of 2.98 |
| each charge bursts threat as a taunt does (`tauntBurst` times the gap to the leader) | 0.156 | 0.177 | 0.258 (out) | 1.14 of 2.51 |
| each charge adds the threat of its hit at that charge | 0.000 (out) | 0.005 | 0.323 (out) | |
| the channeler's entry does not decay while it holds | 0.447 (out) | 0.972 | 1.000 | |
| each charge multiplies the entry by the payoff's growth (1.45) | 0.261 (out, 0.4 se) | 0.963 | 0.825 | 0.98 of 2.68 |
| **both: the threat follows the payoff and does not fade** | **0.117 (se 0.020)** | 0.921 | 0.723 | 1.33 of 2.42 |

A burst like a taunt's outbids the tank's own taunt, and the tank (speed 70) cannot re-taunt as often as the cannon
charges, so a taunted boss is pulled back between taunts; a hit's worth of threat is far more than any bolt makes. The
rule taken is one sentence: while a channel holds, the channeler's threat with every foe follows its payoff (times 1.45
a charge for an exponential channel, `(1 + 0.5k) / (1 + 0.5(k - 1))` for a linear one) and does not decay, because a
channeler is not idle. No new number: the growth is the channel's own (`channelExp`, `channelLin`).

| Rule | Old | New | Why, for a GM | Row before | Row after | Other rows |
|---|---|---|---|---|---|---|
| A channel's threat (design 4.1; `startTurn` and `advance` in `fight-turn.ts`) | a channeler's threat faded like an idle hunter's | it grows with the payoff and does not fade | A boss sees the mage winding up and turns to it; only a taunt pulls it away | 0.494 (se 0.031) | 0.117 (se 0.020), inside, near the low edge | aimed elsewhere 0.967 to 0.921; behind a taunting tank 1.000 to 0.723 (in); no other row uses a channel, none moved |

It is near the low edge (0.8 se). The test is in `tests/fight.test.ts`: an entry of 100 is 200 at charge 2 of a linear
channel and 210.25 of an exponential one, with no decay over the two rounds.

## Where round four ends

`bun test tests/fight-sim.test.ts`, 400 fights an opening for the triangle and E rows. Every row is inside and is a
real test; no row is `todo`.

| Row | Round three | Round four (lines, adjacent) | se | Bound | State |
|---|---|---|---|---|---|
| speed beats cannon at C | 0.605 | 0.606 (0.838, 0.375) | 0.015 | 0.60 to 0.90 | test, near the edge |
| tank beats speed at C | 0.798 | 0.798 (0.598, 0.998) | 0.012 | 0.60 to 0.90 | test |
| cannon beats tank at C | 0.986 | 0.751 (0.940, 0.563) | 0.014 | 0.60 to 0.90 | test |
| speed beats cannon at S | 0.775 | 0.659 (0.998, 0.320) | 0.012 | 0.60 to 0.90 | test |
| tank beats speed at S | 1.000 | 0.760 (0.525, 0.995) | 0.013 | 0.60 to 0.90 | test |
| cannon beats tank at S | 0.880 | 0.861 (0.990, 0.733) | 0.011 | 0.60 to 0.90 | test |
| speed against cannon at E | 0.576 | 0.520 (0.545, 0.495) | 0.018 | 0.25 to 0.75 | test |
| tank against speed at E | 0.619 | 0.619 (0.365, 0.873) | 0.015 | 0.25 to 0.75 | test |
| cannon against tank at E | 0.905 | 0.651 (0.870, 0.432) | 0.015 | 0.25 to 0.75 | test |
| a channel begun under the boss's aim completes, C | 0.533 | 0.117 (257 channels) | 0.020 | 0.10 to 0.25 | test, near the edge |
| a channel behind a taunting tank completes, C | 1.000 | 0.723 | 0.022 | over 0.5 | test |
| the mixed party's boss fight at S (rounds) | 7.93 | 7.95 | 0.04 | 4 to 8 | test, 1.5 se from the edge |

Three rows sit close to an edge and are the first to watch when a number moves: speed beats cannon at C (0.006 over
0.60), the channel under fire (0.017 over 0.10) and the S boss fight (0.05 under 8 rounds; the curse DC of 12 lengthened
it from 7.73, since the boss resists more of the cannon's bolts).

Each opening is still near all or nothing in several rows (tank beats speed adjacent 0.995 to 0.998, cannon beats tank
on the lines 0.87 to 0.99, speed beats cannon on the lines 0.84 to 1.00): who wins from which distance is the party's
choice at the table, and round two's suggestion to bound each opening alone (0.25 to 0.95) would still fail these.

## The kits (kits build unit 14)

The three example kits of `docs/agent-handoff/kits/design.md` table 3.6 play as builds (`tests/models/fight-sim.ts`): the
blood stacker and the mark caster are the cannon with Arc Bolt replaced by Bloodletting or Disaster Stroke (a share of
Arc Bolt's `2d6 + mag`, and a threshold's burst), Pain is the bruiser with Pain is Power worn and Violence in place of
its strike from 5 Pain; a summoner is the cannon with a Sprite once a fight. Their numbers are `RULES.fight.kit.examples`.
Every old row is where it was (compared line by line with the run before the kits).

One number moved, Bloodletting's share of the bolt, 0.7 to 0.85. The paper weighs a kit over 6 rounds with its payoffs
as whole firings; a fight is a race, and a burst that would have come after the last blow is lost, so the kit's damage
arrives late where the plain bolt's arrives evenly:

| Bloodletting's share | blood v tank at C (kit less plain) | the S party with it on a pack (rounds) | the worst duel |
|---|---|---|---|
| 0.7 (the paper) | -0.195 | not run | -0.195, past -0.08 |
| 0.8 | -0.030 | 5.02 | past 5 rounds |
| 0.85 | +0.055 | 4.93 | +0.055 |
| 0.9 | +0.083 | 4.79 | +0.083, past +0.08 |

(100 to 200 fights an opening in the search; the rows play 200.) 0.85 is the one share inside every row; the kit's
duel against a C tank and the S pack fight are the first to watch. The mark caster needed nothing (its duels within
0.035; a stroke with its marks' bursts is half a blast's damage per standard action on a pack). Pain's duels are its
plain bruiser's to the fight: a duel ends before 5 Pain; in a boss fight it uses Violence 0.7 times, 28 a Violence
against 22 a strike.

## Wave 2 of the kits (kits build units 18 to 29)

The rows of kits design 8.10, played on the real reducer with wave 2's blocks: a speed build with Parry armed all fight
(a quick reaction before a strike, its guard `kit.parry`) against the tank and the bruiser at C and S, within the
tolerance of the plain speed build; the mixed party against a boss that holds a damage-taken curse of +100% all fight
(the cap of 1.5, which a boss takes at half the part above 1), 4 to 8 rounds; the mixed party whose bruiser holds an
extra action a round (Surge) and Transfer (its standard action given to the cannon), 4 to 8 rounds; and the speed build
with a worn attack edge (Bow Expert) against the tank and the cannon at C, measured with no bound, beside the maker's
warning. Every old row and every kit row of wave 1 printed the same line before and after (compared line by line, 63
rows).

One number moved, Parry's guard, the paper's 0.35 to 0.30 (`RULES.fight.kit.parry`). The paper weighed a parry as damage
taken off; the simulation plays its time too (its quick action comes off the parrier's next turn), and a duel is a race:

| Guard | speed with Parry v tank at C (less plain) | at S |
|---|---|---|
| 0.35 (the paper) | +0.082 | +0.168, past +0.08 |
| 0.30 | -0.030 | -0.013 |
| 0.25 | -0.083, past -0.08 | -0.133 |
| 0.20 | -0.140 | -0.190 |

(200 fights an opening, the two openings' mean, plain 0.160 at C and 0.220 at S.) The step from 0.30 to 0.35 is a
threshold, not a slope: at 0.35 a tank's swing falls under a hit the speed build lives through one more time. 0.30 is the
largest guard in steps of 0.05 inside every row. Against the bruiser the speed build loses with or without it.

The other rows, as measured: the cursed boss falls in 5.26 rounds at C and 6.42 at S (300 of 300 won); the party with
Surge and Transfer in 5.51 and 6.41. A first setup gave Transfer to the cannon for the bruiser and took 8.94 rounds at S:
the cannon's turn is worth more than the bruiser's, so that is the policy giving a turn away, not the rule; the row plays
the turn given the other way. Bow Expert lifts the speed build by 0.077 against the tank and 0.068 against the cannon at
C, under the tolerance in a duel; the worth's warning on a worn edge (kits design 8.10) stays, as a shot's damage a
standard action rises by more than that.

## A monster's body by rules (balance unit 2): measured, not retuned

Balance plan section 1, built: a monster wears its archetype's kit at its rank's tier (`kitAt`, six pieces of the rarity
whose index is the rank's, so its armor and resist rise by 6 a rank step), and its armor and resist are times its kind's
factor (normal 1, elite 1.25, boss 1.5, `RULES.fight.kinds`). The simulation's hunters wear `kitAt` too. Traits
(`RULES.fight.traits`) are on no row of the simulation. No number was moved: one lever brings back four of the eleven
rows out, and unit 4 retunes. Before is the unit before (the run of `cd02c91`), after is this unit; a row is listed when it
moved by more than twice its standard error or is out.

| Row | Bound | Before | After | Kit only (kind factors 1) |
|---|---|---|---|---|
| speed beats cannon one on one at C | 0.60 to 0.90 | 0.606 | **0.599** (se 0.016) | 0.599 |
| tank beats speed at S | 0.60 to 0.90 | 0.760 | 0.874 | 0.874 |
| tank against speed at E | 0.25 to 0.75 | 0.619 | 0.570 | 0.570 |
| mixed party clears a pack at C | 2 to 5 | 3.82 | 4.27 | 4.27 |
| mixed party clears a pack at S | 2 to 5 | 4.62 | **5.55** | 5.55 |
| mixed party beats a boss at C | 4 to 8 | 6.20 | 7.77 | 6.90 |
| mixed party beats a boss at S | 4 to 8 | 7.71 | **10.90** | 9.39 |
| staggers in a boss fight at S | 1 to 2 | 2.00 | **2.36** | 2.28 |
| a channel under the boss's aim completes at C | 0.10 to 0.25 | 0.117 | **0.080** | 0.127 |
| blood kit against cannon, less plain, at S | -0.08 to 0.08 | 0.000 | **0.118** | 0.118 |
| blood kit party beats a boss at S | 4 to 8 | 7.13 | **10.00** | 8.59 |
| blood kit party clears a pack at S | 2 to 5 | 4.95 | **5.86** | 5.86 |
| summoner party beats a boss at C | 4 to 8 | 5.54 | 7.31 | 6.34 |
| speed with Parry against the tank, less plain, at C | -0.08 to 0.08 | -0.030 | **-0.092** | -0.092 |
| speed with Parry against the tank, less plain, at S | -0.08 to 0.08 | -0.013 | **0.090** | 0.090 |
| cursed boss at S | 4 to 8 | 5.17 | 7.34 | 6.35 |
| Surge and Transfer party beats a boss at S | 4 to 8 | 6.53 | **8.79** | 7.91 |
| best single use on a same-rank tank at S | at most 0.60 | 0.255 | 0.215 | 0.215 |

What moved them. The kit at the rank's tier alone (the last column, kind factors set to 1 for one run) puts nine rows out;
the kinds' armor and resist add the channel row and the Transfer row. Every out row but two is at S, where the tier adds
30 armor and resist to both sides: a normal S brute's armor goes from 46 to 77 and its resist from 5 to 37, while the
party's damage grows with power, not with tier. The duel rows (Parry, blood kit against cannon) have no monster in them:
they moved because both hunters now wear the S set. The C rows that went out sit within a standard error or two of their
edge (speed against cannon 0.599 at 0.600).

One lever, measured: `kinds.boss.hp` 3.2 to 2.4 (one run, not kept) brings the boss at S to 8.26 (still out), its
staggers to 2.00, the blood kit's boss to 7.65 and Transfer's to 6.87, and leaves the cursed boss at C at 4.05, near its
floor of 4. Boss HP is a factor for every rank, and the drift is by rank, so it cannot bring S back without taking C
under. The levers the plan names, for unit 4: the boss's HP (`kinds.boss.hp`, plan section 1) and its armor and resist
factors (`kinds.boss.armor`, `.resist`); `kinds.normal` for the packs at S; for the duels and the S rows together, the
tier's step itself (one point a piece a rarity, `pieceAt`; the plan's "rise by 6 a rank step"), which no rule number
holds today; `kit.parry` for the Parry rows; `holdBase` for the channel row.

## The retune of unit 2's bodies (balance unit 4, its retune part): stopped at a rule for the owner

No rule moved. Every number below is one run of the rows' own setups and seeds (the runs and fights of
`tests/fight-sim.test.ts`, played by a scratch script on `tests/models/fight-sim.ts` with a rules patch; the script read
the same values as the test for the unpatched rules, row for row). After the merge of `lead-backlog` the unit pass shows
the same 11 rows out and nothing new.

**The cause.** Three changes of unit 2, each measured alone:

| What changed | Rows it moves | Evidence |
|---|---|---|
| A monster wears its rank's tier (+1 armor and resist a piece a tier, +30 at S) | every party row's length: pack at S 5.55, boss at S 10.9, the blood kit's and Transfer's boss and pack at S | monsters at tier 0 and hunters at their tier give the same party rows, to the hundredth, as nobody at a tier (pack S 4.62 and 4.65, boss S 8.31 and 8.33) |
| A hunter wears its rank's tier | the duels: Parry at C -0.092 and at S +0.090, blood kit against cannon at S +0.118 | with the six pieces summed to the kit exactly and no tier, every duel row returns to its value before unit 2 to the thousandth (speed against cannon at C 0.606, Parry -0.030 and -0.013, blood 0.000, tank against speed at S 0.760) |
| The six pieces of a kit each round half up | speed beats cannon at C, 0.606 to 0.599 | a full light set is armor 11 and resist 16 where the kit is 10 and 15, a medium set resist 7 where the kit is 5 |
| A boss's armor and resist 1.5 | the boss rows at C and S (and so the staggers at S), the channel under the boss's aim at C | no tier and boss HP 2.8: boss C 6.01, S 7.35 |

The tier's guard is defence with nothing beside it that hits harder by the tier: a same-rank hit fells a same-rank normal
brute in 2.90 hits at C and 3.67 at S with no tier, 3.21 and 4.40 with it. So "both sides rise together" (plan section 1)
keeps who wins and makes every fight at S about a fifth longer, and the additive step squeezes the kits (light 10 to 41,
heavy 60 to 90 at S), which is what moves the duels.

**The brief's questions, measured.**

- *Should the builds wear their tier's item budget?* No. All of it on the main stat (10 slots of `middleBudget`) breaks the
  triangle: tank against speed at S 0.098, cannon against tank at S 1.000 and at C 0.963, speed against cannon at C 0.473.
  One item's budget on the main stat leaves the boss at S at 10.43. A monster holds no budget, so a row with it on the
  hunters measures how a table spends its loot, not the rules; the P rows give one item's budget as a variant, as the
  plan says.
- *The hunters' own penetration at S:* the cannon 21% of both (Control's curve), every other build 0. Against the boss's
  armor 115 at S the bruiser and the tank carry none.
- *A boss's toughness split between HP and armor:* yes, the plan's own lever. Boss HP 2.8 holds the boss rows in every
  setting below that keeps the party rows (C 5.9 to 6.2, S 7.3 to 8.0).
- *Should a monster follow the tier at full value?* At full value with today's HP growth, no setting of the named levers
  holds; see below.

**Two settings that hold the party rows, and what each costs.**

| | Nobody at a tier (the rarity adds no guard), pieces summed exactly, boss HP 2.8 | Everybody at the tier, HP growth over 31 levels (`growthDiv` 24 to 31), boss HP 2.7, Parry's guard 0.28 |
|---|---|---|
| pack C, S | 3.82, 4.62 | 3.85, 4.73 |
| boss C, S | 5.90, 7.29 | 5.99, 7.78 |
| blood boss S, pack S | 6.84, 4.95 | 7.25, 5.01 (**out**, se 0.073) |
| Transfer boss S, cursed boss C | 6.07, 4.12 | 6.48, 4.10 |
| Parry at C, at S | -0.030, -0.013 | -0.052, +0.063 |
| blood kit against cannon at S | 0.000 | +0.043 |
| speed beats cannon at C | 0.606 | **0.574** |
| cannon beats tank at S | 0.861 | **0.909** (0.854 with plate's resist 66) |
| the channel under the boss's aim at C | **0.064** | **0.080** |
| What it changes | design 2.3's rule "rarity raises armor and resist by its index", and the economy's "a plain epic piece is better than a plain common one" | every hunter's and monster's max HP above level 1 (0.91 of today at level 20, 0.85 at 70) |

`growthDiv` 31 is the one value that explains itself: with the tier's guard it puts a same-rank hit's count to fell a
same-rank normal brute back where it was without the guard at every rank, within 1% (rms 0.6%; 30 and 32 are 1.7%).

**Where I stopped: Parry at C and at S.** With every hunter at its tier and HP growth as it is, no guard holds both rows
(800 runs each, the two openings' mean, plain speed 0.177 at C and 0.142 at S):

| `kit.parry` | at C | at S |
|---|---|---|
| 0.29 | -0.107 | +0.003 |
| 0.30 (today) | -0.092 | +0.090 |
| 0.31 | -0.087 | +0.090 |
| 0.315 | -0.065 | +0.185 |
| 0.32 | -0.052 | +0.185 |

The step at S is a threshold (a tank's swing falls under one more hit the speed build lives through), as round one of the
kits found at 0.35. Both rows hold only with HP growth moved (0.27 to 0.29 at `growthDiv` 31) or with no tier.

**The channel row is not `holdBase`'s.** Under the boss's aim at C it completes 0.064 at `holdBase` 0.15, 0.18 and 0.20
alike: every boss hit on the cannon is over any of those holds (about 26 on 81 HP), so a channel completes only when the
boss loses its turns, to a stagger or a miss. The boss's armor 1.5 makes each hit on it smaller, and its stagger bar is
counted in hits on a normal brute (`sameRankHit`, rows.ts), so it staggers later and the channel is hit first. The lever
is the bar's yardstick (a hit on the body that holds the bar) or `kinds.boss.stagger`, not the hold.

**For the owner.** Does a rarer armor piece carry free armor and resist (design 2.3: +1 a piece a tier, +30 a mythic set),
and does a monster's body wear it too (plan section 1)? If yes, every max HP above level 1 grows slower (`growthDiv` 31) and
Parry, the triangle's cannon against tank at S, speed against cannon at C and the blood kit's pack at S each need a retune
of their own. If no, a rarer piece is better only by its budget, and the rows hold with boss HP 2.8 and the pieces summed
exactly, leaving the channel row to the stagger bar. Default if he does not answer: no free guard by rarity (fewest moves,
every duel exactly as tuned before), but that reverses a written rule, so it is his.

## Package A (balance unit 4): no guard by rarity, a kit's pieces add up to it, boss HP 2.8, the bar on its own body

The lead picked package A from the entry above. Four moves, each a rule with its reason in the code:

| Rule | From | To | Why |
|---|---|---|---|
| A rarer armour piece's armor and resist (`piece`, `registry/items.ts`; design 2.3) | +1 each a rarity index, +30 a mythic set | none: a rarer piece is better by its tier's budget and price | the free guard rose on both sides with nothing that hit harder beside it (every S fight a fifth longer, the duels moved); the owner, Nov 21: a boss is tougher by its own numbers |
| A kit split over its six pieces | each piece rounded half up (light set 11 and 16 for a kit of 10 and 15) | the largest-remainder rule: each piece its share rounded down, each point left to the piece that lost the most (on a tie the larger share, then the slot order), so the six are the kit exactly | one set, one kit; `kitAt` and `pieceAt` go, and every body wears `kitGear` |
| `fight.kinds.boss.hp` | 3.2 | 2.8 | measured: with the boss's 1.5 times armor and resist, 3.2 takes the mixed party 6.71 rounds at C and 8.29 at S (out); 2.8 gives 5.90 and 7.29 |
| The stagger bar's yardstick (`sameRankHit`, `staggerOf` in `rows.ts`; design 4.3) | a brute's strike on a same-rank normal brute | the same strike on the monster that holds the bar | a bar of 4 hits is 4 hits on that boss: on the normal brute's armor an S boss's bar was more than 4 of the hits that land on it |

Every row that moved by more than twice its standard error or is out. Before is the unit 2 tree (`f2ef93e` merged with
`lead-backlog`), package A the first three rules (`4607e35`), last the fourth on top. One run of the test's own seeds each.

| Row | Bound | Before | Package A | With the bar on its own body |
|---|---|---|---|---|
| speed beats cannon one on one at C | 0.60 to 0.90 | **0.599** | 0.606 | 0.606 |
| tank beats speed at C | 0.60 to 0.90 | 0.824 | 0.798 | 0.798 |
| speed beats cannon at S | 0.60 to 0.90 | 0.621 | 0.659 | 0.659 |
| tank beats speed at S | 0.60 to 0.90 | 0.874 | 0.760 | 0.760 |
| cannon beats tank at S | 0.60 to 0.90 | 0.896 | 0.861 | 0.861 |
| tank against speed at E | 0.25 to 0.75 | 0.570 | 0.619 | 0.619 |
| mixed party clears a pack at C | 2 to 5 | 4.27 | 3.82 | 3.82 |
| mixed party clears a pack at S | 2 to 5 | **5.55** | 4.62 | 4.62 |
| mixed party beats a boss at C | 4 to 8 | 7.77 | 5.90 | 5.92 |
| mixed party beats a boss at S | 4 to 8 | **10.90** | 7.29 | 7.32 |
| a hunter goes down in a boss fight at C | at most 0.25 | 0.017 | 0.000 | 0.003 |
| staggers in a boss fight at S | 1 to 2 | **2.36** | 2.00 | 2.00 |
| a channel under the boss's aim completes at C | 0.10 to 0.25 | **0.080** | **0.064** | **0.079** (se 0.016) |
| best single use on a same-rank tank at C, at S (and the kits') | at most 0.60 | 0.263, 0.215 | 0.285, 0.255 | 0.285, 0.255 |
| blood kit party beats a boss at C | 4 to 8 | 7.48 | 5.76 | 5.72 |
| blood kit party clears a pack at C | 2 to 5 | 4.44 | 3.98 | 3.98 |
| blood kit against cannon, less plain, at S | -0.08 to 0.08 | **0.118** | 0.000 | 0.000 |
| blood kit party beats a boss at S | 4 to 8 | **10.00** | 6.84 | 6.85 |
| blood kit party clears a pack at S | 2 to 5 | **5.86** | 4.95 | 4.95 |
| the mark caster's stroke over a blast at C | at most 1 | 0.534 | 0.505 | 0.505 |
| summoner party beats a boss at C | 4 to 8 | 7.31 | 5.44 | 5.46 |
| the pain kit's Violence a boss fight at C (no bound) | none | 1.000 | 0.340 | 0.343 |
| Parry against the tank, less plain, at C | -0.08 to 0.08 | **-0.092** | -0.030 | -0.030 |
| Parry against the tank, less plain, at S | -0.08 to 0.08 | **0.090** | -0.013 | -0.013 |
| cursed boss at C | 4 to 8 | 5.23 | 4.12 | 4.21 |
| cursed boss at S | 4 to 8 | 7.34 | 4.95 | 5.06 |
| Transfer party beats a boss at C | 4 to 8 | 6.58 | 5.13 | 5.22 |
| Transfer party beats a boss at S | 4 to 8 | **8.79** | 6.07 | 6.51 |
| Bow Expert against the tank at C (no bound) | none | 0.023 | 0.077 | 0.077 |

Package A returns every duel to its value before unit 2 to the thousandth, as the entry above found. Ten of the eleven
rows out come back; the staggers at C and S are 2.00, on the bound's top edge, as before unit 2. The cursed boss at C
(4.21, se 0.025) is the row nearest an edge.

### The channel row: still out, stopped

**The bar's yardstick, measured.** Moving it onto the boss's own body takes the channel row from 0.064 to 0.079 and puts
the staggers back where they fell before unit 2: over 600 seeds the first stagger at 1.42 rounds and the second at 4.17,
against 1.50 and 4.27 for the bodies before unit 2 (boss HP 3.2, guard 1). It does not bring the row in.

**The row's value before unit 2 was its seeds'.** Over 1200 fresh seeds (301 to 1500, the row's setup and measure):

| Bodies | Aimed channels completed |
|---|---|
| before unit 2 (boss HP 3.2, armor and resist 1) | 0.097 (102 of 1056, se 0.009) |
| package A, bar on a normal brute | 0.062 (71 of 1144) |
| package A, bar on its own body (this branch) | 0.076 (87 of 1144, se 0.008) |

The 0.117 the row read before unit 2 was a good draw of seeds 1 to 300: the row was at its floor all along.

**What is left: the threat table.** A channel under the boss's aim completes only if the boss spends the five turns on
something else; every boss hit on the cannon (about 30) is over its hold (12). Traced over 600 seeds, the staggers come
after the channel begins as often as before; what changed is whom the boss aims at during a channel: the cannon in 515
of 896 of its acts (0.57), against 445 of 881 (0.51) before unit 2. Threat is damage dealt after defence
(`resolve.ts`, `dealt * sheet.threat`). A brute boss's 1.5 times its armor (39 to 58 at C) cuts the bruiser's and the
speed build's damage a fight (96 to 88, 93 to 80), and 1.5 times its resist (5 to 8) leaves the cannon's at 111, so the
cannon keeps the boss's aim longer. So the row moves with any armor on a physical boss: it is a consequence of the rule
the owner set (a boss tougher by its armor and resist), not of a mistake.

What would bring it in, none tried as a change: threat from damage before defence (a rule of the threat table, past this
unit's files); a channel's threat (`fight-turn.ts`, round four's lever); or reading the bound against 1200 seeds, where it
was 0.097 before unit 2 too. `holdBase` cannot (the entry above). The bound is untouched; the row stays out.

### The sweep after package A

`measure.ts --quiet`, 150 runs a fight, on the draft as it stands (unit 6 fits the rows). Inside of all, before (the unit
2 tree) and after:

| Rank | E | D | C | B | A | S |
|---|---|---|---|---|---|---|
| before | 15 of 56 | 5 of 59 | 7 of 59 | 6 of 58 | 1 of 53 | 0 of 81 |
| after | 15 of 56 | 6 of 59 | 4 of 59 | 7 of 58 | 3 of 53 | 0 of 81 |

By kind after: normal 29 of 174, elite 0 of 107, boss 6 of 62 (5 before), mythic 0 of 23. Rows outside for "rounds over"
fell from 180 to 143; "a hunter down" is the largest reason (269, 266 before), then a row's worth over its budget (172).

## Balance unit 2, step 1: threat counts the hit before defence

**The decision.** Threat counts a hit before the monster's armor or resist (after a Parry's guard), times the user's
threat multiplier: new rule `fight.threatBeforeDefence` (a share, 1; 0 is the old rule 15, `dealt * threat`), read in
one place (`threatOfHit`, `resolve.ts`), written through `threatened` as before. Why at the cause: whom a monster aims at
should follow what the party does to it, and a kind's armor is not something the party did. With threat after defence,
the boss's 1.5 times armor (package A, the owner's "more hp, armor, magic resist") cut the physical builds' threat and left
the cannon's, so the boss aimed at a channeling cannon in 57% of its acts (51% before the armor) and the channel row
fell under its bound. No bound and no other number moved.

**The channel row, over fresh seeds** (the row's own setup and measure, `vsBoss(['bruiser', 'speed', 'cannon'], 'C',
'aimed')`, seeds 10001 to 11200):

| Rule | Aimed channels completed | Fights where the cannon began one under the boss's aim |
|---|---|---|
| threat after defence (0) | 0.086 (98 of 1140, se 0.008) | 1140 of 1200 |
| threat before defence (1) | 0.208 (93 of 447, se 0.019) | 447 of 1200 |

The boss now turns to the cannon in fewer fights before its channel (the bruiser's and the speed build's swings count in
full), and when it does, the physical builds pull it back off during the channel more often. 0.208 is inside 0.10 to 0.25
by five standard errors at the floor and two at the ceiling.

**The eleven rows that were out before package A**, the same fresh seeds (10001 on; duels 400 a side and opening, the kit
and Parry rows 200 each, the boss and stagger rows 300, the pack rows 150):

| Row | Bound | After defence (0) | Before defence (1) |
|---|---|---|---|
| speed beats cannon one on one at C | 0.60 to 0.90 | 0.652 (se 0.015) | 0.652 |
| mixed party clears a pack at S | 2 to 5 | 4.444 (se 0.067) | 4.436 |
| mixed party beats a boss at S | 4 to 8 | 7.263 (se 0.036) | 7.257 (se 0.032) |
| staggers in a boss fight at S | 1 to 2 | 2.000 | 2.000 |
| a channel under the boss's aim completes at C | 0.10 to 0.25 | **0.086** | 0.208 (se 0.019) |
| blood kit against cannon, less plain, at S | -0.08 to 0.08 | -0.010 (se 0.035) | -0.010 |
| blood kit party beats a boss at S | 4 to 8 | 6.777 | 6.772 |
| blood kit party clears a pack at S | 2 to 5 | 4.735 | 4.712 |
| Parry against the tank, less plain, at C | -0.08 to 0.08 | -0.010 (se 0.024) | -0.010 |
| Parry against the tank, less plain, at S | -0.08 to 0.08 | 0.000 (se 0.025) | 0.000 |
| Transfer party beats a boss at S | 4 to 8 | 6.497 (se 0.078) | 6.549 (se 0.081) |

A duel has no threat table, so the duels are the same to the thousandth; the party rows move by under one standard error.

**Every row of the test, its own seeds** (`tests/fight-sim.test.ts`, before and after; only the rows that moved by more
than a rounding):

| Row | Bound | Before | After |
|---|---|---|---|
| a channel under the boss's aim completes at C | 0.10 to 0.25 | **0.079** (279 begun) | 0.214 (se 0.038, 117 begun) |
| a channel while the boss aims elsewhere completes at C (no bound) | none | 0.935 (201 begun) | 0.797 (271 begun) |
| a channel behind a taunting tank completes at C | 0.50 to 1 | 0.715 (se 0.023) | 0.848 (se 0.018) |
| a hunter goes down in a boss fight at S | at most 0.25 | 0.050 | 0.013 |
| a hunter goes down in a pack fight at S | at most 0.10 | 0.027 | 0.013 |
| Transfer party beats a boss at C | 4 to 8 | 5.216 | 5.275 |

All 73 rows inside; the unit pass is green on this rule alone. The taunt's channel rose, likely because a tank's swings
now count in full against the boss's armor, so its lead after a taunt holds longer (read, not traced). The cursed boss at C (4.196, se 0.026) is still
the row nearest an edge.

## Balance unit 2, step 2: the rows P1 to P3 (balance plan section 9)

**How they are read.** One build of the mixed party spends one item of its tier's middle budget (`middleBudget`: 3.45
points at C, 10.95 at S) all one way at the item budget's own prices (`itemSpend`, a penetration weighed on a same-rank
elite, `itemBudget.penFoe`), unrounded so the three ways spend the same; the other build stays on its main stat. The
bruiser holds the armor pair, the cannon the magic pair, each its own row (`spending`, `tests/models/fight-sim.ts`).
What a budget buys:

| Rank | Main stat | Bruiser: armor % | Bruiser: lethality | Cannon: magic % (Control's part first) | Cannon: flat |
|---|---|---|---|---|---|
| C | +3.45 | 11.2 | 5.2 | 11.4 + 28.1 = 39.5 | 5.0 |
| S | +10.95 | 13.6 | 7.5 | 21.0 + 45.2, capped at `penMax` 60 | 8.0 |

The bodies: a brute boss has armor 58 and resist 8 at C (69 and 8 at S), a normal brute 39 and 5 (46 and 5).

**P3's control.** The mixed party holds none (no built-in skill holds). The row gives the tank a plain one: a curse with no
damage that stuns for a round (the built-in Stunned, a hold, which Tenacity shortens and Will resists), back every
`itemBudget.cooldownRounds` (3), used on the boss when its next turn comes within a round (`controlPolicy`). The measure
is the share of the fight's time the boss's next turn was pushed by it, a stagger's push apart (`FightRecord.held`).

**The rows** (`tests/fight-sim.test.ts`, seeds 1 on; P1 the paired difference on the same seeds):

| Row | Bound | C | S |
|---|---|---|---|
| P1 armor, boss: flat's rounds less percent's | over 0 | 0.042 (se 0.010) | 0.020 (se 0.006) |
| P1 armor, pack: percent's rounds less flat's | over 0 | 0.002 (se 0.002) | 0.017 (se 0.009) |
| P1 magic, boss: flat's rounds less percent's | over 0 | **-0.080** (se 0.015) | **-0.119** (se 0.015) |
| P1 magic, pack: percent's rounds less flat's | over 0 | 0.019 (se 0.009) | 0.045 (se 0.016) |
| P2 armor, pack and boss: main's rounds over the faster variant's | at most 1.25 | 1.001, 1.007 | 1.002, 1.005 |
| P2 magic, pack and boss | at most 1.25 | 1.000, 1.004 | 1.000, 1.010 |
| P3 control's share of the boss's turns | 0.10 to 0.35 | **0.032** (se 0.003) | **0.025** (se 0.002) |
| the triangle's cannon beats tank at S (unchanged) | 0.60 to 0.90 | | 0.861 |

Four rows are out; they are `OPEN` (todo, with the value and the reason), so the unit pass stays green and names them.

**P1 magic at the boss: the arithmetic, not a price.** Percent takes a share of what is there; a brute boss's resist is 8.
At C the budget's 28.1 more percent takes 2.2 resist off and its 5 flat takes 5; at S the percent is at `penMax` and takes
3.1 off against 8 flat. Percent passes flat only above a defence of flat over the percent bought: 18 at C, 20 at S. The
plan's levers, in order:

- `itemBudget.penFoe` 'normal' (measured, 300 boss and 150 pack fights): magic at the boss -0.018 (se 0.011) at C and
  -0.119 at S, still out; and the armor pair's pack row at S goes to -0.001, out. Not moved.
- `fight.penMax`: binds only at S, where even all 45 points of percent would take 3.6 off resist 8. Cannot.
- `kinds.boss.resist`: from 1.5 to 3.6 at C and 4 at S would put a brute boss's resist (5 times it) over 18 and 20. It moves every boss row (the cannon
  is the party's main damage) and the owner set the boss's factors; not tried.

Or P1's magic row is read on a boss whose resist is its thick defence (a caster boss); that is a reading of the plan for
the lead. The armor pair holds P1 at both ranks, though its pack row at C (0.002, se 0.002) is one standard error over 0.

**P2 is far inside.** One item's budget is 3 to 10% of a build's main stat, so no way of spending it moves a fight by more
than 1%. P2 would bind only for a build that holds many such items.

**P3: about a fifth of a round a stun.** 0.99 stuns a fight at C over 6.1 rounds, 0.032 of the fight's time: 0.20 of a
round a use. A hold is a floor (`stunned`: the next turn moves to now plus the hold, if that is later), so a stun of a
round on a boss whose turn is half a round away moves it half a round, less Tenacity's cut, and a resisted one moves
nothing (read, not traced). The row measures a control the party does not have; the stun's numbers (its round, its
cooldown, who carries it) are the lead's to set before the row means anything.

## Balance unit 2, step 3: the sweep with threat before defence

`measure.ts --quiet`, 150 runs a fight, on the draft as it stands, 302 s. Inside of all, after package A (above) and with
`threatBeforeDefence` 1:

| Rank | E | D | C | B | A | S |
|---|---|---|---|---|---|---|
| package A | 15 of 56 | 6 of 59 | 4 of 59 | 7 of 58 | 3 of 53 | 0 of 81 |
| threat before defence | 14 of 56 | 6 of 59 | 4 of 59 | 7 of 58 | 3 of 53 | 0 of 81 |

By kind: normal 28 of 174 (29), elite 0 of 107, boss 6 of 62, mythic 0 of 23. The reasons outside: a hunter down 270
(269), worth over 172 (172), rounds over 142 (143), a death 30, the party's win share 23, rounds under 2. One normal row
at E crossed an edge; at 150 runs a share near its bound moves by that much between draws, so the threat rule moves the
sweep by nothing past its noise. The sweep is unit 6's to fit.

## No death saves (Nov 21): going down and dying are one event

the owner, Nov 21: "Let's do away with death saves entirely." A hunter at 0 HP is dead; only a revive brings it back. The
rows that spoke of a hunter going down and of one dying are restated as deaths (`tests/fight-sim.test.ts`, the header's
reading and `partyRows`):

- "a hunter goes down in at most 1 pack fight in 10" is now "a hunter dies in at most 1 pack fight in 10" (design 6: "no
  hunter dying in more than 1 run in 10").
- "a hunter goes down in at most 1 boss fight in 4" and "a hunter dies in under 1 boss fight in 20" cannot both stand
  when the two are one event. The row kept is the design's bound on a hunter lost: "a hunter dies in under 1 boss fight
  in 20". The 1-in-4 row is gone; under the death bound it could never bind.
- "the speed party's front hunter goes down at least twice as often" is now "dies at least twice as often".

Measured on the same seeds, before (`62d87ff`, the old rows) and after (this change):

| Row | Bound | Before | After |
|---|---|---|---|
| a hunter goes down / dies in a pack fight at C | at most 0.10 | 0.000 | 0.000 |
| a hunter goes down in a boss fight at C | at most 0.25 | 0.000 | (row gone) |
| a hunter dies in a boss fight at C | under 0.05 | 0.000 | 0.000 |
| front hunter, speed over mixed, at C | at least 2 | 8.200 (se 3.767; 0.273 over 0.033) | 8.200 |
| a hunter goes down / dies in a pack fight at S | at most 0.10 | 0.013 (se 0.009) | 0.013 |
| a hunter goes down in a boss fight at S | at most 0.25 | 0.013 (se 0.007) | (row gone) |
| a hunter dies in a boss fight at S | under 0.05 | 0.000 | 0.013 (se 0.007) |
| front hunter, speed over mixed, at S | at least 2 | 9.667 (se 3.992; 0.387 over 0.040) | 9.667 |

Every restated row is inside; none goes to `OPEN`, and no number in `RULES.fight` moved. The values equal the old "goes
down" shares because the play itself did not change: no policy heals or stabilizes an ally at 0 HP (`alliesOf` in
`policy.ts` reads only rows that are up), so a hunter who went down stayed at 0 to the fight's end before too. What
changed is after the fight: the old death row counted only hunters whose death saves, rolled with nobody to help, ended
at dead (0.000 at S); now each of those falls is a death, so the boss row at S reads the old down share, 0.013, five
standard errors under its 0.05.

## Balance unit 3, step 1: what takes P3's control away

P3 reads the share of a boss fight's time by which the tank's stun pushed the boss's next turn. It was 0.032 at C and
0.025 at S, where a one-round stun every three rounds would hold about a third. The counters below come from the row's
own fights: the mixed party against a same-rank brute boss, seeds 1 to 300. Each stun was traced by reading `resolve` on
the reducer's inputs and the boss's clock before and after it.

| Counter, at C (S) | Before | Stun before taunt |
|---|---|---|
| tank turns a fight | 4.32 (5.28) | 4.57 (5.50) |
| turns the stun was ready | 2.78 (3.59) | 1.96 (2.12) |
| of them, a taunt taken instead | 1.40 (1.91) | 0.03 (0.01) |
| of them, the boss's turn more than a round off | 0.40 (0.50) | 0 (0) |
| stuns a fight (the cooldown allows about 2.1 in 6.2 rounds) | 0.99 (1.18) | 1.93 (2.11) |
| stuns resisted (tank Aim 10 against boss Will 10, `resistDc` 12) | 0.46 (0.46) | 0.44 (0.45) |
| a landed stun's length after Tenacity (12 at C, 20 at S) | 0.89 (0.81) rounds | 0.89 (0.81) |
| the boss's turn already this far off when the stun landed | 0.54 (0.55) rounds | 0.48 (0.49) |
| how far a landed stun moved that turn | 0.36 (0.30) rounds | 0.45 (0.40) |
| P3 | 0.032 (0.025) | **0.079** (se 0.004) (**0.061**, se 0.003) |

Ranked by the share of the ideal third each one takes:

1. **The tank's turns went elsewhere** (the model). `controlPolicy` taunted first and stunned only when no taunt was
   due, so the stun sat ready on 1.4 turns a fight at C. This was the policy, not a rule, so it is fixed in the model:
   the tank now stuns when the stun is ready and the boss acts before the tank's next turn, and taunts otherwise.
   A stun left ready is control lost. Waiting while the boss's turn is past the tank's next one is still right,
   because a hold is a floor (below). Uses went from 0.99 to 1.93, 0.93 of what the cooldown allows. A death in the
   fight went from 0.000 to 0.000 at C and from 0.003 to 0.020 at S (300 fights, no bound on this setup), because a
   taunt goes later.
2. **How a hold counts** (a rule of the timeline, not a number). `stunned` in `timeline.ts` sets the next turn to the
   later of where it was and the stun's end, so a stun of a round on a boss whose turn is half a round off takes half
   a round. At the tank's turns the boss's turn is on average 0.48 rounds off, which leaves 0.45 of a 0.89-round stun.
   The counter (`held`, the push at the use) measures exactly that, so the counter is not the cause.
3. **The stun's resist roll.** The tank has base Aim, so the boss's Will resists 45% of tries (a d20 of 12 or more).
   A resisted stun lands nothing.
4. **The boss's Tenacity** takes 11% of a landed stun at C and 19% at S. It is the smallest of the four.

Check: 1.93 stuns × 0.56 landed × 0.45 rounds over 6.2 rounds ≈ 0.079.

**No one rule number lands it.** Tenacity at 0 would give about 0.089 and 0.075. The resist roll is the only number
large enough. Bringing S in needs a stun resisted about 10% of the time, which means `resistDc` 19. With `resistDc` 19
(every row measured, seeds as the file has them) P3 is 0.132 (se 0.004) at C and 0.105 (se 0.003) at S, but four rows
leave their bounds: speed beats cannon at C 0.476 (0.60 to 0.90), cannon beats tank at C 0.911 and at S 0.912 (at
most 0.90), and cannon against tank at E 0.893 (at most 0.75). Every curse lands more often, and Arc Bolt is the
cannon's main damage. `resistDc` stays at 12. The row stays in `OPEN` at its new values.

**Measured, not applied: the cannon carries the stun.** The cannon's second stat is Control, which gives it Potency 14
(26 at S) and Aim 26 (54). With the same rule (stun when ready and the boss acts first), its stun is resisted 26% of
the time (14% at S), lasts 1.02 rounds (1.05), and moves the boss's turn 0.59 rounds (0.64). P3 comes out at 0.152 at
C and 0.181 at S, both inside the bound. But each stun replaces a bolt, so the fight lasts 7.3 rounds at C and 8.9 at
S, past the boss row's 8. Who carries the party's control is the lead's call: the ruling named the tank. The rule
calls the row now waits on: whether a hold should add its length to a turn rather than set a floor (`stunned`), and
who carries the stun.

## Balance unit 3, step 2: P1's magic pair on a boss tough by resist

The lead's ruling: P1's magic pair is read on a boss whose thick defence is resist, the mirror of the brute, the same
way the armor pair is read on the brute. `kinds.boss.resist` does not change. The boss is built from pieces that
already exist: the **caster** archetype (Power and Control, the light kit) as a boss, with the **warded** trait
(`traits.warded`, resist 1.5). It is chosen as the most resist those pieces give a boss, and it was picked before
anything was measured. The bodies, read from `monsterSheet`:

| Boss at C (S) | Armor | Resist |
|---|---|---|
| brute (the armor pair's) | 58 (69) | 8 (8) |
| caster | 15 (15) | 23 (23) |
| caster, warded (the magic pair's) | 15 (15) | 34 (34) |

Section 9's arithmetic: percent passes flat above a defence of 18 at C and 20 at S. Resist 34 is above both. The
P1 row (`spendRuns`) is the cannon's flat rounds minus its percent rounds, paired on seeds 1 to 300, with the tank and
the bruiser on their main stats:

| P1 magic, boss: flat's rounds less percent's | Bound | C | S |
|---|---|---|---|
| on the brute boss (balance unit 2) | over 0 | -0.080 (se 0.015) | -0.119 (se 0.015) |
| on the warded caster boss | over 0 | **0.076** (se 0.014; 4.865 over 4.789) | **0.141** (se 0.016; 4.939 over 4.798) |

Both are inside, by 5 and 9 standard errors. The two rows leave `OPEN`. The magic pack row, P2, and the armor pair
are not touched (P2's boss is still the brute) and stay inside. No number moved.

## Balance unit 3, step 3: the mythic kind (M1)

the owner, Nov 21: "A mythic should be basically impossible to beat, like 5-10% odds for a party of 3." The balance plan
(section 4) makes it a fourth row of `fight.kinds`. Row M1 (`tests/fight-sim.test.ts`) plays the mixed party (tank,
bruiser, cannon) at S's first level against one S brute mythic, on seeds 1 to 600, with no fight capped. A share bounded
0.05 to 0.10 has se 0.011 at 600 fights.

**The numbers and the reason for each.**

| `kinds.mythic` | Value | Why |
|---|---|---|
| armor, resist | 2 | the plan's starting value: twice a normal, against the boss's 1.5 |
| power | 2 | the same 2, so a mythic is twice a normal body in everything but HP. One number free, not two |
| hp | 5.2 | measured by M1 (below): the middle of 5 to 10% |
| stagger | 4 | a boss's bar in same-rank hits on its own body, a default (no row bounds a mythic's staggers) |
| xp | 5 | about its HP factor, as the elite's (1.5 for HP 1.5) and the boss's (3 for 2.8) are |

**M1 against the mythic's HP** (power 2, armor and resist 2, 600 fights each, seeds 1 to 600):

| hp | Party wins | se | Rounds |
|---|---|---|---|
| 5.0 | 0.167 | 0.015 | 14.3 |
| 5.1 | 0.110 | 0.013 | 14.4 |
| **5.2** | **0.068** | 0.010 | 14.4 |
| 5.3 | 0.042 | 0.008 | 14.4 |
| 5.4 | 0.022 | 0.006 | 14.5 |
| 5.6 | 0.005 | 0.003 | 14.5 |

Power is a choice, so I measured other shapes at their fit as well, to see how wide each one's band is (600 fights
a point, seeds 1 to 600):

| Shape | Two points around the bound (hp: party wins) | The step in HP, and the wins it took away | Rounds | Hunters dead a fight |
|---|---|---|---|---|
| power 2 (chosen) | 5.1: 0.110, 5.3: 0.042 | 4%, 0.068 | 14.4 | 2.9 |
| the boss scaled (hp:power 2.8:1.2) | 5.04: 0.113, 5.18: 0.048 (power 2.16, 2.22) | 3% on both, 0.065 | 14.2 | 2.9 |
| power 3 | 4.4: 0.105, 4.6: 0.030 | 4.5%, 0.075 | 12.1 | 2.9 |
| power 4 | 3.0: 0.077, 3.2: 0.040 | 6.7%, 0.037 | 8.5 | 2.9 |

Every shape is steep. The cause is the fight's length against fixed builds: the dice average out over 8 to 14
rounds, so the result follows the mean. Power 4 has the widest band, about three times the others for each percent of HP, but it is a
mythic with only 3.0 bodies of HP against a boss's 2.8, hitting 3.3 times as hard as a boss. Power 2 keeps more HP,
armor and resist than a boss on every factor, the way the owner described a boss's toughness ("more hp, armor, magic
resist"). It is a default. Unit 6 or the lead can move it to power 4 if the narrow band costs more than the
shape is worth.

**What M1 measures, and what it does not.**
- It is fitted to the brute. The same kind as a caster lets the party win 0.713 (se 0.023, 400 fights, 9.4 rounds), and
  as a skirmisher 1.000 (10.2 rounds). The 23 mythic rows get their own tweaks in unit 6, and the sweep must hold
  them to 5 to 10% one row at a time.
- The band is narrow. Any rule that moves the party's damage by about 5% (a kit, a cap, the cost of an action) moves
  M1 out. When that happens, `kinds.mythic.hp` is the lever: near 5.2, 0.1 of it moves the row by 0.03 to 0.04.
- Every other row is unchanged. A mythic body appears in no other row, and the full unit pass is green with 88 rows
  inside.

**The tables the kind adds a row to** (the typecheck named them): the kill fact's kind (`facts.ts`); the shadow grade a
mythic rises as (`shadows.ts`: Marshal, the highest grade, on a boss's body); the bestiary's kind label (`bestiary.js`,
"Mythic"). Not changed: `fight-facts.ts` counts only kind `boss` as a boss defeated, so a mythic killed is not counted
there (the lead's call, since feats are another helper's).

## Balance unit 6, step 1: M1 for every archetype

The mythic kind (step 3 above) was fitted on a brute. Measured again before any change (seeds 1 to 100, the mixed
party at S against one S mythic): brute 0.06 of fights won in 14.5 rounds, caster 0.70 in 9.5, skirmisher 1.00 in
10.3. A caster boss fell in 5.1 rounds and a skirmisher boss in 5.2 against the brute boss's 7.3, so the gap is in
the body at every kind, not in the mythic row.

**Why the bodies differ** (`monsterStats`, `derive`, at S as a mythic):

| Body | HP | Armor | Resist | Power it hits with | Speed | Reaction |
|---|---|---|---|---|---|---|
| brute (Strength, Vitality, medium kit) | 1336 | 92 | 10 | phys 108 (strike) | 100 | 10 |
| caster (Power, Control, light kit) | 907 | 20 | 30 | mag 108 (curse, never dodged; Accuracy 54) | 100 | 10 |
| skirmisher (Agility, Strength, light kit) | 907 | 20 | 30 | phys 65 (shot, its quick share) | 160 | 90 |

Only the brute's split buys toughness: Vitality is its second stat (1.47 times the HP) and its kit and Vitality give it
armor. The skirmisher's main stat buys turns and dodges; its damage is its second stat's.

**A second cause, in the simulation's monster.** A dead hunter still lies on the map (land.ts `alive`, kept so a
crystal can revive it), and a shot is a line that does not pierce, so it stops at the first body. The sim's monster
policy shot at its suggested target whatever lay between: a skirmisher mythic with 1.5 times HP and 1.8 times power
killed the tank and the bruiser and then put its next 40 shots into the tank's body while the cannon, behind it, took
none and won the fight in 26.5 rounds (seed 1). Every such fit won the party 1.00 of fights with exactly 2 hunters dead.
A GM walks around a body. The policy now walks toward its target when a fallen hunter is first in its line
(`clearLine`, tests/models/fight-sim.ts). The brute's strike (touch) and the caster's curse (direct) do not travel a
line, so their rows did not move: brute 0.068 in 14.4 rounds at 600 fights, as before.

**The fix: `fight.archetypes`**, a factor on max HP and on power for each archetype, after the kind's (derive.ts
`monsterSheet`). The brute is 1 in both, as every kind was measured on it. Each other pair is fitted to two targets
on row M1's 600 fights: the brute's win share (0.068) and about its length (14.4 rounds), so the kind means the same
fight in odds and in length. HP moves the odds; power moves the length (a harder hitter ends the party sooner). The grid
(200 fights a point unless marked):

| Caster hp, power | Party wins | Rounds |
|---|---|---|
| 1.6, 0.8 | 0.180 (100 fights) | 13.4 |
| 1.7, 0.75 | 0.160 | 14.5 |
| 1.75, 0.75 | 0.105 | 14.5 |
| 1.8, 0.7 | 0.120 | 15.2 |
| **1.8, 0.75** | **0.078 (se 0.011, 600)** | **14.6** |
| 1.8, 0.8 | 0.050 (100 fights) | 13.7 |
| 1.9, 0.75 | 0.030 | 14.7 |

| Skirmisher hp, power | Party wins | Rounds |
|---|---|---|
| 1.6, 1.0 | 0.185 | 13.8 |
| 1.6, 1.1 | 0.055 | 12.8 |
| 1.65, 1.0 | 0.140 (600) | 13.8 |
| **1.7, 1.0** | **0.070 (se 0.010, 600)** | **13.9** |
| 1.8, 1.0 | 0.010 | 14.0 |

The caster needs less power than the brute: its curse cannot be dodged and its Control beats the party's Will. The
skirmisher keeps power 1: at 1.1 its fights end in 12.8 rounds. Both are as steep as the brute's fit (0.1 of HP moves
M1 by about 0.07), for the same reason: a 14-round fight between fixed builds averages its dice out.

**M1, the row now one per archetype** (`bun run test`, 600 fights each, seeds 1 to 600):

| Mythic | Party wins | se | Rounds |
|---|---|---|---|
| brute | 0.068 | 0.010 | 14.4 |
| skirmisher | 0.070 | 0.010 | 13.9 |
| caster | 0.078 | 0.011 | 14.6 |

**What else the factors move.** They act at every kind, since the cause is the body. At S, 100 fights each:

| Kind, S | brute | caster before, after | skirmisher before, after |
|---|---|---|---|
| boss, rounds | 7.3 | 5.1, 8.3 | 5.2, 7.8 |
| elite, rounds | 4.0 | 3.1, 4.8 | 3.3, 4.7 |
| normal, rounds | 1.8 | 2.3 (after) | 2.3 (after) |

A caster or skirmisher boss now lasts about a round longer than the brute boss, where it lasted two rounds less. No
row bounds those (design section 6's boss rows use the brute); the caster boss's 8.3 is past the brute row's 8, which
the lead may want a row for. Every simulation row is inside after the change (128 pass, the two P3 rows still open);
the warded caster boss of P1 now has 1.8 times the HP and 0.75 times the power and both its rows stay inside. Item
prices do not move: the item budget reads only a caster's resist (`penCost`).

Moved: `fight.archetypes` (new: skirmisher hp 1.7, caster hp 1.8 and power 0.75, brute 1 and 1). The design's table
2.6 and worked example 3.A take the new HP (tests/derive.test.ts, tests/resolve.test.ts: a C skirmisher has 82 HP, not
48). `kinds.mythic` is not moved.

## Balance unit 6, steps 3 to 5: the stun's rule, P3, every row again

**The stun (questionable decision 1) was not built.** `stunned` (timeline.ts) was a floor: no turn before `now + d`.
It now adds `d` to the target's next turn wherever it was (`stunned(row, d)`, its table of four cases in
tests/timeline.test.ts). A stagger's break keeps rule 16's floor (`notBefore`, `staggerCost`'s own words: "moves the
monster's next turn to now + 1.5 rounds"). No row but P3 moved: in the simulation only the tank of P3 holds a stun.

**P3, the party's control** (300 fights each, seeds 1 to 300; the tank stuns whenever it is ready, `controlPolicy`):

| Rank | Before (a floor) | Now (adds its length) | Stuns a fight | Held a stun, rounds | Rounds |
|---|---|---|---|---|---|
| C | 0.079 (se 0.004) | **0.153** (se 0.006) | 1.94 | 0.49 | 6.2 |
| S | 0.061 (se 0.003) | **0.128** (se 0.005) | 2.10 | 0.46 | 7.6 |

Why not double: the turns held per stun went from 0.45 and 0.40 rounds a landed stun to the full 0.89 and 0.81
(Tenacity 12 and 20 cut the one-round stun), which doubles the share; what keeps it from more is that 45% of the stuns
are resisted (Aim 10 against Will 10, `resistDc` 12), so "held a stun" averages 0.49 over every stun cast. Both rows
are inside 10 to 35% by 9 and 6 standard errors, and leave `OPEN`; the table is empty.

**Every row, measured again** (`bun run test`, after steps 1 to 4): 130 rows pass, none out, none open. The three M1
rows are 0.068, 0.070 and 0.078 (above). Rows near an edge (within one standard error):

| Row | Value (se) | Note |
|---|---|---|
| speed beats cannon one on one at C | 0.606 (0.015) | not moved by this unit (no monster in it) |
| the blood kit against tank within 0.08 of plain at C | 0.055 (0.027) | not moved (no monster) |
| a channel under fire completes 10 to 25% at C | 0.214 (0.038) | the brute boss, not moved |
| three speed builds clear a hurting pack no faster than the mixed party at C | 1.013 (0.021) | its two normal skirmishers now hold 1.7 times the HP: 7.07 over 6.98 rounds |

On the last: a side measure of the same setup (every fight's mean rounds, 150 fights) gave 0.971 at C with every
archetype at 1 and 1.005 with the factors, so the factors did not bring it to the edge; it sat there before. The
skirmishers' HP does make the pack hurt more: the speed party's front hunter died in 0.41 of fights at C, against 0.17
with the factors at 1 (the same side measure). That row (bound: twice the mixed party's) stays inside at 3.8.

Not done here: a mythic is extracted at a boss's DC only if `kind === 'boss'` (shadows.ts `bossDc`), so a mythic of a
type that may be extracted gets a normal's DC. The mythic rows' seeds will say not extractable (balance plan section
5), so it matters only for a GM's own mythic; it is one token, left for the lead.

## MY5: a mythic's script, rows B1 to B9 (notes-11-keystones.md, design B.8)

**Setup.** Each script on its seed's body (`plain` on row M1's brute mythic), made by `monsterRows` under scripts on
(`scriptsOn`; the shipped switch stays off until MY7), its HP its seed's times the script's `hp`. The party is M1's
mixed party at S, its tank holding P3's plain stun, which only an answer spends; every hunter answers first
(`answering`: `answerChoice`, then `keptOut`). 600 fights a row, seeds 1 to 600. The mythic plays `mythicPolicy`: the
landing from `sensible`, an act beat as M1's `monsterPolicy` with the first damaging use its phase names.

**Why not `sensible` for the mythic, as B.8 says.** On M1's own body and party (200 fights, today's rules) the party won
0.065 against `monsterPolicy` and 0.245 against `sensible`: `sensible`'s monster hits whoever is in reach when its
suggested target is not, so it spreads its damage (the cannon took 171 a fight against 203). The odds engine plays every
row on `sensible`, so the GM's odds of a mythic read rosier than the sim; that gap was there before MY5 and is the lead's.

**Why the tank holds a stun.** Six of the nine answerable omens are cancelled or weakened by a hold or a root, and no
build of the mixed party has one. Without it the interrupt answer is words.

**Two things the code does not do yet, worked around in the sim (both the lead's):**
- A script's `hp` is read by nothing in src (`MythicScript.hp` says it is a factor on the kind's HP). The sim puts it on
  the seed's tweak; `monsterRows` (rows.ts) needs the same one factor before MY7 turns scripts on.
- play.ts cannot play a landing turn: its `rollsFor` finds the ability on the row (the omen's move is not there) and asks
  `needs` on the taunted row (which asks no dice). The sim plays that turn itself (`landed`, fight-sim.ts); play.ts needs
  `omenNeeds` there, or the odds engine throws on a scripted mythic's first landing.

**`plain` alone, hp 1** (200 fights): 0.175, against M1's 0.065 on the same body. With its clock set to 40 it is 0.065,
M1 exactly, so the gap is the clock: past 14 rounds every other turn of the mythic announces, and its one doom lands on a
party that its focused strikes would have finished. With a hard clock the share is a cliff in HP: 600 fights each,
hp 1.00 won 0.147, 1.02 won 0.090, 1.03 won 0.072. **hp 1 → 1.03.**

**B6 read from the first doom's landing, not the first enraged turn.** An enraged omen is announced a turn ahead like any
other (B.4), so a party always has a round after the clock: `plain` at hp 1 won 25 of its 159 enraged fights in that
round. B6's risk is a party that outlives a doom; the row reads the fights in which one landed (`MythicTrace.dooms`: an
omen of the enraged rotation landing while enraged).

**Words moved for B6** (300 fights each at the hp that held B1):
- The Angel's Broken Note, **hits 0.7 → 1.2**: a party that broke the bar at every note outlived it, 14 wins of 300 after
  a doom; at 1.2, 1 of 299. Still smaller than the Final Note's 1.6.
- The Fourth Rider's Reaping, **one name → every name** (a field blast aimed at all, hits 2.5): taking one hunter a
  landing left the other two time to win, 9 of 286 after a doom; on every name, 0 of 286. The phase's line already reads
  "Every name is in it."
- Zaratan's It Goes Under held B6 as written (2 of 299).

**hp moved for B1** (300 fights each, then the 600 of the rows): the Angel 0.85 (0.395, the Broken Note at 0.7), 0.95
(0.110), 1.05 (0.050), with the Broken Note at 1.2: 0.9 (0.097); **0.85 → 0.9**. Zaratan 0.9 (0.385), 1.0 (0.083), 1.1
(0.013); **0.9 → 1**. The Rider with the Reaping on all: 0.8 (0.087), 0.9 (0.017); **0.85 → 0.8**.

**The rows** (`bun test tests/fight-sim.test.ts`, 600 fights each):

| Row | plain | Angel | Zaratan | Rider | Bound |
|---|---|---|---|---|---|
| B1 wins | 0.072 | 0.060 | 0.077 | 0.088 | 0.05 to 0.10 |
| B2 skips, mixed party | 0 | 0 | 0 | 0 | 0 |
| B2 skips, three cannons | 0 | **5** | **199** | 0 | 0 |
| B3 wins answering none | none | **0.078** | **0.042** | **0.053** | under 0.01 |
| B4 three cannons win | **0.380** | **0.248** | **0.783** | **0.157** | at most 0.15 |
| B5 without interrupt / stagger / burst, over B1 | none | **0.94 / 0.92 / 1.03** | **0.98 / 1.00 / 1.00** | 0.64 / **1.00 / 1.00** | at most 0.8 |
| B6 capped | 0 | 0 | 0 | 0 | 0 |
| B6 won after a doom | 0.002 | 0.006 | 0.006 | 0.000 | under 0.01 |
| B7 most first falls in one phase | one phase | 0.450 | 0.545 | **0.739** | at most 0.6 |
| B7 least, less its floor | one phase | 0.173 | **−0.043** (the Dive 0.007) | **−0.036** (the Pale Horse 0.064) | at least 0 |
| B8 median rounds | 15.3 | 13.9 | 16.1 | 12.3 | 10 to 20 |
| B9 | not measured | | | | |

The bold cells are in `OPEN` (tests/fight-sim.test.ts). What each would need, none of it a script's `hp`:
- **B3 and B5's stagger and burst** test a premise that does not hold: a stagger or a burst answer is met by the hits a
  party deals anyway, so taking it out of `answerChoice` leaves it met. Only an answer no ordinary turn makes (a hold, a
  step out of the tiles, a shield) is a decision. To hold B3, an omen's answers would be those, and an unanswered omen
  would drop a hunter. A one-script check: the Rider with Named at 2.5 and All Things End at 1.2 (hp 0.6) won 0.203
  answering and 0.237 not, so lethal omens alone do not make the answers count.
- **B5 interrupt** (the Angel, Zaratan): the stun is resisted near half the time (P3: 45%) and is back every 3 rounds, so
  most omens find it spent or shrugged off. The Rider's holds (0.64).
- **B2 and B4 with three cannons**: the gate holds HP, not turns. Three cannons push the Shore to its gate before Zaratan
  acts, and their hits held at the gate break its bar during the Dive and push its turn past the Dive's clock. A rule
  would bring it inside (a phase does not end before its mythic took a turn in it), in the reducer, which MY5 does not
  hold. B4 is played with no keystones: K4 and K5 have not landed.
- **B7**: the Dive's rising sea aims at the crowd's tile and every hunter steps out of it; the Rider's Pale Horse band
  (30% of its HP) falls in two or three of its turns, and The Book Opens takes the falls. A wider sea or the Pale Horse
  opening on Named would move them; not tried past one run each (rising hits 0.8: the Dive 0.040, 1.0: 0.043).

## MY5, second pass: B3 and B5's measure, the misses in OPEN

**Steps 1 and 2 moved no number.** play.ts plays the landing turn (`omenNeeds`) and `monsterRows` applies a script's
`hp`; B1 read 0.072, 0.060, 0.077, 0.088 after each, the same fights seed by seed.

### Step 3: what an answer costs (B3, B5)

**The premise, measured per window** (an omen's announce to its landing; 150 fights a script; the party answering
everything against the party answering nothing; HP taken in the window as a share of max HP):

| Omen | windows (all / none) | HP taken p50, p90 (none) | answers met by hits, answering all | the same, answering none |
|---|---|---|---|---|
| the Rider's Named | 478 / 472 | 0.042, 0.084 | stagger 30, burst 99 | stagger 32, burst 109 |
| the Angel's Breath | 136 / 128 | 0.074, 0.095 | stagger 27, burst 67 | stagger 10, burst 101 |
| the Angel's Note | 284 / 252 | 0.046, 0.148 | stagger 81 | stagger 87 |
| Zaratan's Trench | 89 / 49 | 0.047, 0.068 | stagger 13, burst 43 | stagger 7, burst 16, interrupt 15 |

A party that aims no answer meets a stagger or a burst answer as often as one that does: the bar breaks in 10 to 25% of
windows from the hits a party deals anyway, and the burst shares (5 to 8%) sit inside one round of ordinary damage
(p50 4 to 7%). Zaratan's Trench was also cancelled 15 times by the tank's own taunt, which its policy casts whenever the
mythic aims elsewhere.

**Tried: answers no ordinary turn meets, and a hit saved for them** (all in memory, 200 fights each):
- a stagger answer only by a break that takes at least 0.6 of the bar in one change (no ordinary hit; a crit of one
  neither), every burst share 0.12 (over p90 of ordinary windows), one hit answer per omen, and a party that saves the
  cannon's Focus for the window (begins it while calm, holds it, releases it when its average answers). The saving party
  lost to the one that answered nothing: the Rider at hp 0.6 won 0.145 against 0.225, Zaratan at 0.8 0.170 against
  0.270, the Angel at 0.7 0.405 against 0.375; saving for one kind alone was worse (the Rider without burst 0.085, the
  Angel without stagger 0.110). The held Focus is about as much damage as the bolts it replaces, but it comes late, and
  the clocks punish late damage: at hp 0.8 the Rider's saving party saw a doom in 87% of fights at a median of 7 rounds.
- omens that answering avoids hit harder (Stars Fall 1.0, the First Breath 1.1, the Sinking 0.9, the Sea Rises 0.8,
  Pale Wake 0.8): the Angel answering won 0.035, answering nothing 0.080. No separation.
- a stacking Dread (+20% or +40% damage each) on every omen that lands whole: no more separation than without it (the
  Rider 0.080 against 0.045, then 0.065 against 0.030; without it 0.088 against 0.053; the Angel 0.070 against 0.080).
- clocks about 1.6 times as long (the Angel 8, 6, 5; Zaratan 9, 3, 10; the Rider 8, 8, 6) with hp 1.0 and 1.2: fewer
  dooms (the Angel 23 to 72 of 200), still no separation (the Angel 0.035 against 0.050, Zaratan 0.125 against 0.075,
  the Rider 0.010 against 0.005).

**The cause.** In the rows' own fights 467 (plain) to 599 (the Angel, Zaratan) of B1's 600 fights reach an enraged turn,
and a fight a doom lands in is lost (B6: at most 0.009 won). The clocks decide a mythic fight. An answer cancels or
weakens a move, which saves HP; it buys no time, so a party that answers well and one that answers nothing lose the
same race. B3's bound is the owner's ("a party that ignores its warnings loses") and stays; no number of the omens moves
it while answers do not touch the clock.

**What would** (a design call, outside this unit's files): an answer met moves its phase's clock back
(`mythic.answerTime` rounds on the standing's `since`, carried by the `cancel` and `weaken` events), so answering buys
the time the fight is lost for want of. It is the one lever that ties the answer to what decides the fight.

**Kept:** Zaratan's Trench is no longer cancelled by a taunt (interrupt `hold`, `root`): the taunt answered it in
ordinary play. B1 Zaratan 0.077 → 0.075, B3 0.042 → 0.032, B5 interrupt 0.98.

| Row (600 fights) | Angel | Zaratan | Rider | Bound |
|---|---|---|---|---|
| B3 wins answering none | 0.078 | 0.032 | 0.053 | under 0.01 |
| B5 without interrupt / stagger / burst, over B1 | 0.94 / 0.92 / 1.03 | 0.98 / 1.00 / 1.00 | 0.64 / 1.00 / 1.00 | at most 0.8 |

### Step 4: the misses in OPEN

**B2 with three cannons (5 and 199 skips): a reducer rule, not a number.** `phaseOver` (mythic.ts) ended a phase at the
mythic's turn start whenever it was held at its gate or past a clock phase's clock, whether or not it had taken a turn
in the phase. The phase change spends the turn it happens on, so three cannons that took a band between that turn and
the next skipped the phase: the Angel's First Breath 5 times. In Zaratan's Dive their hits, held at the gate, still
fill its bar; a stagger pushed its first Dive turn past the 3-round clock, and the Dive ended on the turn it began
(199). The rule now: a phase ends only once the mythic has taken a turn in it (an act beat taken or an omen announced);
until then its HP stays held at the gate. Test: "a mythic pushed to its gate before its first turn in a phase takes that
turn before the next phase" (tests/fight.test.ts); without the rule the Angel goes from The First Breath to The Note
with no beat. B2: 0 for every script and both parties.

**B7, the Fourth Rider (The Book Opens 0.739 of first falls, the Pale Horse 0.064).** The Pale Horse's band was 30% of
its HP, which the party takes in two or three of its turns, so Named in the Book landed in it at most once. Measured,
600 fights at hp 0.8: The Book Opens from 0.6, falls 0.079 / 0.562 / 0.359 (B1 0.090); from 0.55, 0.226 / 0.539 /
0.235 (B1 0.100, the edge). **The Book Opens 0.7 → 0.55**, and **hp 0.8 → 0.83** for B1: 0.082, falls 0.330 / 0.501 /
0.169, B4 0.060 (three cannons now meet a Pale Horse long enough for Named to land on them).

**B7, Zaratan (the Dive 0.007).** The Sea Rises aimed at the crowd's tile, and every hunter stepped out of it, so nobody
was in danger in the Dive. Measured, 600 fights at hp 1: reach 3, 0.009; reach 4 and hits 0.6, 0.024; aimed at the
weakest with hits 0.6, 0.038; at the weakest with hits 0.9, 0.050 (the floor exactly); at the weakest with hits 0.8 and
the Dive's clock 4, 0.180 (B1 0.020). **The Sea Rises: crowd → weakest, hits 0.4 → 0.8; the Dive's clock 3 → 4; hp
1 → 0.93** (0.95 won 0.055, 0.97 0.037, 0.93 0.067). B1 0.067, falls 0.268 / 0.287 / 0.445, B8 median 20.0 (the
edge: the Dive's fourth round is a round more).

**B4, three cannons (plain 0.380, the Angel 0.243, Zaratan 0.710; the Rider now 0.060).** Measured with no script, 200
fights: today's brute mythic (M1's body) loses 0.435 to three cannons and 0.065 to the mixed party; Zaratan's brute
body 0.525 and 0.070; the Angel's caster body 0.040 and 0.030; the Rider's skirmisher body 0.000 and 0.040. So against
a brute body the miss is the body's, before any script: three cannons deal about a third more a round than the mixed
party (arc bolt 50 against the tank's strike 24 and the bruiser's 40, on the Rider) and a brute's resist is low.
Zaratan's Shell of armor and resist (30 each, then 20 each) at hp 0.8 to 1.0 still lost 0.42 to 0.80 to three cannons
while the mixed party fell to 0.000 to 0.25, and clocks about 1.5 times as long left plain at 0.447 and Zaratan at
0.660. The lever is the brute archetype or the mythic kind (`fight.archetypes`, `fight.kinds.mythic`), outside this
unit. The Angel's three cannons reach a doom in 370 of 600 fights where the mixed party reaches one in nearly all: the
clock race of step 3 again.

| Row (600 fights) | plain | Angel | Zaratan | Rider | Bound |
|---|---|---|---|---|---|
| B1 wins | 0.072 | 0.060 | 0.067 | 0.082 | 0.05 to 0.10 |
| B2 skips, mixed / three cannons | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 | 0 |
| B3 wins answering none | none | **0.078** | **0.048** | **0.060** | under 0.01 |
| B4 three cannons win | **0.380** | **0.243** | **0.710** | 0.060 | at most 0.15 |
| B5 without interrupt / stagger / burst, over B1 | none | **0.95 / 0.92 / 1.03** | **1.09 / 1.00 / 1.00** | 0.63 / **0.98 / 1.00** | at most 0.8 |
| B6 won after a doom | 0.002 | 0.006 | 0.004 | 0.000 | under 0.01 |
| B7 most / least less its floor | one phase | 0.450 / 0.173 | 0.445 / 0.168 | 0.501 / 0.069 | at most 0.6 / at least 0 |
| B8 median rounds | 15.3 | 13.9 | 20.0 | 14.4 | 10 to 20 |

## MY5, third pass: an answer winds its phase's clock back (decision 40); B3 and B5 measured

**The rule.** An answer met (a cancel or a weaken) winds its gate phase's clock back `fight.mythic.answerTime` rounds
(mythic.ts `answerBack`, carried by the `cancel` and `weaken` events), never past the phase's start and never in a clock
phase (the Dive's clock is the time the party must survive). Scripts stay off.

### Step 1: how far back (300 fights a script, before any `hp` moved; the party answering all / answering none)

| `answerTime` cancel / weaken | the Angel | Zaratan (hp 0.93) | the Rider (hp 0.83) |
|---|---|---|---|
| 0 / 0 (MY5b) | 0.070 / 0.070 | 0.093 / 0.057 | 0.083 / 0.060 |
| 1 / 1 | 0.083 / 0.073 | 0.140 / 0.067 | 0.107 / 0.063 |
| 2 / 2 | 0.080 / 0.073 | 0.143 / 0.067 | 0.113 / 0.063 |
| 4 / 4 | 0.080 / 0.073 | 0.167 / 0.083 | 0.113 / 0.063 |
| 2 / 2, no cap at the phase's start | 0.080 / 0.073 | 0.143 / 0.063 | 0.113 / 0.063 |
| 4 / 4, no cap | 0.080 / 0.073 | 0.167 / 0.080 | 0.113 / 0.063 |
| 4 / 0, no cap | 0.087 / 0.073 | 0.107 / 0.057 | 0.100 / 0.063 |

The effect is whole at 1 round and grows little past it, with or without the cap. The answering party gains 1 to 5
points, the party that answers none 0 to 2: no value takes it near B3's 0.01. **`answerTime` 1 / 1**, the least that
does all it does.

### Step 2: where the bought time goes (600 fights, the hp of step 3)

| | fights with no doom (won) | lost with no doom: the mythic's HP left, p10 / p50 / p90 |
|---|---|---|
| the Angel, `answerTime` 0 | 56 (33) | 0.19 / 0.21 / 0.23 |
| the Angel, 1 | 309 (45) | 0.06 / 0.09 / 0.19 |
| the Angel, 1, answering none | 336 (49) | 0.04 / 0.08 / 0.21 |
| Zaratan, 0 | 83 (19) | 0.34 / 0.46 / 0.50 |
| Zaratan, 1 | 112 (42) | 0.30 / 0.46 / 0.50 |
| Zaratan, 1, answering none | 106 (24) | 0.30 / 0.46 / 0.50 |
| the Rider, 0 | 191 (35) | 0.12 / 0.27 / 0.35 |
| the Rider, 1 | 325 (50) | 0.12 / 0.26 / 0.35 |
| the Rider, 1, answering none | 352 (20) | 0.12 / 0.25 / 0.31 |

The Angel's fights with no doom go from 56 to 309, and 12 more are won: a fight the clock no longer ends is lost in the
Note to its ordinary hits, the Angel at a tenth of its HP. **The premise of decision 40, "the clocks decide a mythic
fight", is half of it:** with the doom gone the same fights are lost a few rounds later to the HP race. And the party
that answers none is given as much time: it has as many fights with no doom as the party that answers all, or more.

### Step 3: why the party that answers none is given the time (answers met a fight, 600 fights)

| | interrupt | stagger | burst |
|---|---|---|---|
| the Angel, all / none | 0.34 / 0 | 0.98 / 0.91 | 0.67 / 0.85 |
| Zaratan, all / none | 0.07 / 0 | 0.09 / 0.12 | 0.20 / 0.07 |
| the Rider, all / none | 0.55 / 0 | 0.49 / 0.47 | 0.62 / 0.72 |

Its ordinary hits meet the stagger and burst answers as often as the answering party's aimed ones (MY5b's finding), and
each now winds the clock back for it too. Only the interrupt is the answering party's alone (the tank's stun, cast only
as an answer), and only the Rider's interrupt separates (B5 0.38). With the stagger or the burst answer taken out of the
policy, Zaratan's and the Rider's fights meet the same answers in the same numbers and end the same (B5 1.00): the
policy's stagger and burst choice, the strongest hit on the mythic, is the turn the party plays anyway.

### Step 4: B1 back inside

With answers buying time B1 rose for Zaratan (0.140) and the Rider (0.107). 600 fights: Zaratan hp 0.97 won 0.073, 1.0
won 0.048; the Rider 0.86 won 0.093, 0.89 won 0.083. **Zaratan hp 0.93 → 0.97, the Rider 0.83 → 0.89.** The Angel at
0.9 won 0.075 and `plain` has no answers; neither moved.

| Row (600 fights) | plain | Angel | Zaratan | Rider | Bound |
|---|---|---|---|---|---|
| B1 wins | 0.072 | 0.075 | 0.073 | 0.083 | 0.05 to 0.10 |
| B2 skips, mixed / three cannons | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 | 0 |
| B3 wins answering none | none | **0.082** | **0.040** | **0.033** | under 0.01 |
| B4 three cannons win | **0.380** | **0.242** | **0.685** | 0.032 | at most 0.15 |
| B5 without interrupt / stagger / burst, over B1 | none | **1.04 / 0.87 / 1.02** | **1.00 / 1.00 / 1.00** | 0.38 / **1.00 / 1.00** | at most 0.8 |
| B6 won after a doom | 0.002 | 0.000 | 0.004 | 0.000 | under 0.01 |
| B7 most / least less its floor | one phase | 0.526 / 0.102 | 0.399 / 0.184 | 0.580 / 0.029 | at most 0.6 / at least 0 |
| B8 median rounds | 15.3 | 14.4 | 19.9 | 15.3 | 10 to 20 |

B3 and B5 stay in `OPEN` with these values. What would separate them is not a number of `fight.mythic`: an answer
that only a chosen turn meets (MY5b tried stagger and burst out of ordinary reach, and the saving party lost more), or
an answering party whose answers cost it less than the HP race they lose it. Both are design calls (notes-11-mythic-build.md,
MY5 third pass).

## MY5, fourth pass: an omen is answered only by a turn the party chooses (decision 42)

**The rule.** A stagger or a burst answer counts only what lands after the omen's announce: `fight.mythic.answerReach`
same-rank hits of fill on its bar (`stagger`, counted from the bar the standing keeps as `barAt`, a break counting the
bar it emptied) or a share of its max HP (`burst`, from `hpAt`), one rule for every omen in place of each omen's burst
share. The party's policy (`answerChoice`) saves a damaging channel while the mythic's rotation holds an omen such an
answer meets, and releases it when that omen stands. Scripts stay off.

### Step 1: what ordinary play lands in an omen's window (100 fights a party, at MY5c's rules; a window is announce to landing or answer)

| | party turns p50 / p90 | its HP lost, p50 / p75 / p90 / p99 | its bar's fill as a share of the bar, p50 / p75 / p90 / p99 |
|---|---|---|---|
| the Angel, all / none | 3 / 5 | 0.054 / 0.073 / 0.119 / 0.170, none 0.060 / 0.074 / 0.112 / 0.178 | 0.29 / 0.48 / 0.69 / 1.51, none 0.34 / 0.50 / 0.85 / 1.59 |
| Zaratan, all / none | 3 / 5, none 2 / 4 | 0.022 / 0.065 / 0.072 / 0.151, none 0.044 / 0.069 / 0.090 / 0.151 | 0.22 / 0.41 / 0.98 / 1.37, none 0.25 / 0.41 / 0.76 / 1.31 |
| the Rider, all / none | 1 / 4 | 0.036 / 0.042 / 0.077 / 0.120, none 0.037 / 0.057 / 0.078 / 0.112 | 0.14 / 0.28 / 0.50 / 0.86, none 0.21 / 0.34 / 0.51 / 0.75 |

The bar held about 0.45 of itself at the announce (median), so ordinary windows broke it often. The burst shares of the
data (0.05 to 0.08) sit at the median of what ordinary play lands: half the windows met them with no choice made. Each use
of the mixed party at its average on each body (resolve.ts, middle dice): the bruiser's strike and Mutilation 2.1 to 3.9%
of max HP and 0.84 to 1.04 same-rank hits on the bar, the cannon's Arc Bolt 1.8 to 2.3% (0.48 to 0.94 hits; the Angel and
the Rider resist magic), the tank's strike 1.2 to 2.2%. Mutilation is no burst: 1.04 strikes. The one use a party can
save into a window is the cannon's Focus, a channel of 1.45 times a bolt for each turn held (6.4 at 5): 11 to 14% of
max HP held full.

### Step 2: the reach past ordinary play, the cannon saving Focus (300 fights a party, `answerReach` 4 hits and 0.13, MY5c's `hp`)

The reach is set at about the 90th centile of step 1's ordinary windows: 0.13 of max HP (p90 0.08 to 0.12) and 4
same-rank hits on the bar (a whole bar at the phase's start; ordinary windows land 1 to 2 hits at the median).

| | wins | fights with no doom | median rounds | answers met a fight |
|---|---|---|---|---|
| the Angel, all | 0.030 | 73 | 13 | stagger 0.74, interrupt 0.29, burst 0.19 |
| the Angel, none | 0.040 | 56 | 13.4 | stagger 0.24, burst 0.02 |
| the Angel, all but interrupt / stagger / burst | 0.000 / 0.003 / 0.037 | 51 / 9 / 63 | 12.4 / 8.1 / 13.3 | |
| Zaratan, all | 0.007 | 32 | 20.7 | burst 0.19, stagger 0.18, interrupt 0.08 |
| Zaratan, none | 0.027 | 52 | 13.6 | stagger 0.01 |
| Zaratan, all but interrupt / stagger / burst | 0.027 / 0.007 / 0.007 | | | the same answers without stagger or burst |
| the Rider, all | 0.007 | 84 | 8.5 | interrupt 0.50, stagger 0.28, burst 0.10 |
| the Rider, none | 0.013 | 143 | 14.2 | stagger 0.07, burst 0.02 |
| the Rider, all but interrupt / stagger / burst | 0.003 / 0.010 / 0.007 | | 7.4 / 8.5 / 8.5 | |

**The reach does what it was meant to:** the party that answers none meets a stagger or burst answer 0.03 to 0.26 times a
fight, against 0.37 to 0.93 for the party that saves Focus. **And the saving loses the fights:** the answering party wins
less than the one that answers none at every script, and against the Rider it is enraged in its first phase (8.5 rounds
against 14.2). Focus pays only at a high charge (1.45 times a bolt a turn held), so a cannon that holds it from one
omen to the next passes about every other turn, and the clocks, fitted to the party's whole damage, run out. Without
stagger in the policy the Angel's fights end at 8.1 rounds: the cannon holds for the burst omens it rarely meets.

### Step 3: is it the saving? (200 fights a party; `nosave` answers as `all` and never begins a channel to save it)

| `answerTime` | | all (saving Focus) | nosave | none |
|---|---|---|---|---|
| 1 | the Angel | 0.035 | **0.110** | 0.055 |
| 1 | Zaratan | 0.010 | **0.035** | 0.020 |
| 1 | the Rider | 0.010 (7.7 rounds) | **0.065** (14.7) | 0.015 (14.2) |
| 3 | the Angel | 0.040 | 0.110 | 0.055 |
| 3 | Zaratan | 0.010 | 0.045 | 0.020 |
| 3 | the Rider | 0.015 | 0.070 | 0.015 |

Answers met a fight without the saving: the Angel interrupt 0.32, stagger 0.37, burst 0.02; Zaratan interrupt 0.07,
stagger 0.03; the Rider interrupt 0.57, stagger 0.02. **With the reach out of ordinary play, a party that plays its turns
and answers with the ones it chooses (the stun, the step out of an area, the shield, the hits aimed while an omen
stands) wins two to four times as often as the party that answers none**, and saving Focus for the windows costs more
than every answer it meets, at 1 or 3 rounds bought. The stagger answers the answering party still meets come in
windows its stun lengthened (a held mythic lands later, so the party gets more turns in the window). `answerTime` 3
moves nothing past the noise (se about 0.017): **`answerTime` stays 1 / 1**, and **the policy saves no channel** (the
held use is the tank's stun, which only an answer spends).

### Step 4: `hp` for B1, and the omens a chosen step leaves (300 fights a party, no saving)

| | all | none | first falls of the losses, by phase (all) |
|---|---|---|---|
| the Angel, hp 0.9 | 0.090 | 0.040 | 0.30 / 0.26 / 0.44 |
| the Angel, hp 0.95 | 0.063 | 0.020 | 0.37 / 0.29 / 0.34 |
| the Angel, hp 0.9, its area moves' hits times 1.5 | 0.063 | 0.023 | 0.33 / 0.33 / 0.33 |
| Zaratan, hp 0.92 | 0.107 | 0.057 | 0.22 / 0.28 / 0.49 |
| Zaratan, hp 0.97, area hits times 1.5 | 0.013 | 0.007 | 0.38 / 0.26 / 0.36 |
| the Rider, hp 0.89 | 0.050 | 0.013 | 0.44 / 0.46 / 0.10 |
| the Rider, hp 0.89, area hits times 1.5 | 0.050 | 0.013 | the same |

The Rider at hp 0.89 without interrupt / stagger / burst: 0.013 / 0.050 / 0.050 (0.27 / 1.00 / 1.00 of all). Its
answering party met stagger and burst answers 0.01 times a fight.

**Harder area moves do not separate the parties more than more HP does** (the Angel 0.063 against 0.023 either way):
the party that answers none steps out of an area as rarely as the hits it takes are deadly, and the answering party
takes the same hits when the step cannot get it out. **The interrupt separates (the Rider's B5 0.27); the stagger and
burst answers, out of ordinary reach, are met by no turn this party chooses**, so taking them out of the policy changes
no fight. What would meet them is a use a party can hold for a window at no cost to the clock race: this kit has none
(Mutilation is a strike, the blast catches the melee allies beside the mythic, Focus pays only at a charge the windows
do not leave time for).

### Step 5: the rows at 600 fights (`hp` the Angel 0.9 → 0.93, Zaratan 0.97 → 0.92, the Rider 0.89 → 0.82)

Zaratan at 0.94 won 0.050 and the Rider at 0.86 won 0.047 (600 fights); the values below are at the final `hp`, except
where a cell names another.

| Row (600 fights) | plain | Angel | Zaratan | Rider | Bound |
|---|---|---|---|---|---|
| B1 wins | 0.072 | 0.065 | 0.082 | 0.060 | 0.05 to 0.10 |
| B2 skips, mixed / three cannons | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 | 0 |
| B3 wins answering none | none | **0.028** | **0.042** | **0.018** | under 0.01 |
| B4 three cannons win | **0.380** | **0.152** | **0.697** (hp 0.94) | 0.022 | at most 0.15 |
| B5 without interrupt / stagger / burst, over B1 | none | 0.46 / **1.03** / **1.00** | **0.98** / **1.00** / **1.00** (stagger and burst at hp 0.94) | 0.31 / **1.00** / **1.00** (stagger and burst at hp 0.86) | at most 0.8 |
| B6 won after a doom | 0.002 | 0.000 | 0.000 | 0.000 | under 0.01 |
| B7 most / least less its floor | one phase | 0.396 / 0.164 | 0.448 / 0.145 | 0.504 / 0.024 | at most 0.6 / at least 0 |
| B8 median rounds | 15.3 | 13.9 | 20.0 | 14.3 | 10 to 20 |

B3 falls at every script (0.082 → 0.028, 0.040 → 0.042 at a lower `hp`, 0.033 → 0.018), and B5's interrupt row now
holds for the Angel (1.04 → 0.46) and the Rider: with the stagger and burst answers out of ordinary reach, the stun is
the answer that separates. B3, B5's stagger and burst rows and Zaratan's interrupt row stay in `OPEN` with these values;
B4 stays open as before. Zaratan's median is at B8's edge (20.0).

## MY5, fifth pass: an omen answered by a turn that is not an attack (decision 43)

**The rule.** Each omen writes the outcome of five answer kinds (`ANSWERS` in mythic.ts): `step`, the tile it aims at
left with no hunter on it; `interrupt`; `shield`, a shield landing on the hunter it aims at; `stagger`; `burst`. The
type holds `shield` and `step` at `none` on an omen aimed at the mythic itself. No script's omen keeps a stagger or a
burst answer: decision 42's measure showed a hit is the turn a party plays anyway. The policy steps off the aimed tile
and shields the aimed hunter (`answerChoice`). Scripts stay off. Every number below is the mixed party at S, seeds 1 to
N, the same fights `tests/fight-sim.test.ts` plays; "all" answers every kind, "none" none, "-k" all but `k`.

### Step 1: the answers in the data, nothing else moved (200 and 300 fights, `answerTime` 1, the clocks of pass 4)

| | all | none | answers met a fight, all / none |
|---|---|---|---|
| the Angel (Stars Fall at the crowd, its first omen) | 0.120 | 0.060 | step 0.86, interrupt 0.85, shield 0.01 / step **0.74** |
| the Angel, Weighed first, Stars Fall second | 0.103 | 0.047 | step 0.44 / step 0.02 |
| Zaratan | 0.040 | 0.045 | step 1.46, interrupt 0.07 / step 0.26 |
| the Rider | 0.077 | 0.023 | interrupt 0.59, step 0.42, shield 0.16 / step 0.16 |

**The walk in answers a step omen announced before the party stands.** Stars Fall came at the Angel's second beat, while
the party walked up: the party that answered none left the aimed tile 0.74 times a fight. Announced after Weighed it
left it 0.02 times. The Angel at 300 fights without the step answer won 0.147 against 0.103 with it: the policy also
stepped out of every area it stood in, losing hits; it now steps out of an area only when the move would drop it (as the
shield rule asks), and off the aimed tile by the nearest tile, so a hunter in reach stays in reach.

### Step 2: what moves the party that answers none (300 fights)

- The omens' hits do not: Stars Fall 0.55 → 1.6, Pale Wake 0.3 → 1.6 left the none party's wins at 0.047 and 0.023.
  Its winning fights (the Rider, 7 of 300 traced) pass the Book Opens in 2 or 3 of the Rider's turns and see 3 or 4
  omens in all: they win on damage before the omens add up.
- `answerTime` at the old clocks does not: 1, 2 and 3 rounds left both parties' wins within 0.01 (Zaratan's dooms fell
  from 114 to 37 of 300, and its party died to its hits instead).
- **The clock with `answerTime` 3 does.** Decision 43's answers are turns the party plays only to answer, so the party
  that answers none buys no time (it met 0.00 to 0.17 answers a fight). With shorter clocks it runs out, and the
  answering party buys them back:

| `answerTime` 3, clocks | all | none |
|---|---|---|
| the Angel 4 / 4 / 2, hp 1.0 | 0.080 | 0.000 |
| Zaratan 4 / 4 / 5, hp 0.85 | 0.077 | 0.017 |
| Zaratan 5 / 4 / 5, hp 0.92, Sinking 1.0 and Trench 1.2 | 0.067 | 0.003 |
| the Rider 5 / 4 / 3, hp 0.75 | 0.073 | 0.023 |
| the Rider 5 / 3 / 3, hp 0.78 (600 fights) | 0.052 | 0.008 |
| the Rider 4 / 4 / 3, hp 0.82, no cap at the phase's start | 0.033 | 0.007 |

Dropping the cap at the phase's start moved nothing past the noise; it stays.

### Step 3: each kind's worth (B5), and the answers that were words (300 and 600 fights)

- The Angel's Weighed, answered by a stun or a shield, was met by the stun first: the shield 0.11 times a fight, B5
  shield 0.96. Weighed now answers to a shield alone (cancel), and the stun keeps the Breath and the Note: B5 shield 0.53.
- Stars Fall at the crowd: a party with no step answer still left the tile by walking (B5 step 0.90 at 300). At the
  farthest hunter (the cannon, who stands) and 1.0 of a hunter's HP: 0.54 at 300, 0.780 at 600.
- Zaratan's Trench shield answer was met 0.00 times a fight (its hunter is the farthest, past Shield Wall's 6 tiles);
  it is gone. Its step answer weakens it (0.58 a fight).
- The Rider's Pale Wake step answer changed no fight (B5 step 1.02 to 1.06, Pale Wake 0.3 or 0.9): it is gone, and the
  Wake is as before. Named in the Book's shield answer cancels, not weakens: B5 shield 0.771.

### Step 4: the rows at 600 fights (`answerTime` 3 and 3)

The scripts: the Angel `hp` 0.93 → 1.0, clocks 5 / 4 / 3 → 4 / 4 / 2, Weighed before Stars Fall, Stars Fall at the
farthest with hits 0.55 → 1.0; Zaratan clocks 6 / 4 / 7 → 5 / 4 / 5, Sinking 0.5 → 1.0, Trench 0.75 → 1.2; the Rider
`hp` 0.82 → 0.78, clocks 5 / 5 / 4 → 5 / 3 / 3.

| Row (600 fights) | plain | Angel | Zaratan | Rider | Bound |
|---|---|---|---|---|---|
| B1 wins | 0.072 | 0.068 (se 0.010) | 0.062 (se 0.010) | 0.058 (se 0.010) | 0.05 to 0.10 |
| B2 skips, mixed / three cannons | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 | 0 |
| B3 wins answering none | none | **0.000** | **0.002** (se 0.002) | **0.008** (se 0.004) | under 0.01 |
| B4 three cannons win | 0.380 | 0.187 (se 0.016) | 0.657 (se 0.019) | 0.018 | at most 0.15 |
| B5 without step, over B1 | none | 0.780 (se 0.179) | 0.135 (se 0.064) | none | at most 0.8 |
| B5 without interrupt, over B1 | none | 0.195 (se 0.075) | **1.08** (se 0.23) | 0.514 (se 0.146) | at most 0.8 |
| B5 without shield, over B1 | none | 0.561 (se 0.143) | none | 0.771 (se 0.193) | at most 0.8 |
| B6 won after a doom | 0.002 | 0.000 | 0.000 | 0.000 | under 0.01 |
| B7 most / least less its floor | one phase | 0.429 / 0.091 | 0.451 / 0.191 | 0.527 / 0.111 | at most 0.6 / at least 0 |
| B8 median rounds | 15.3 | 15.3 | 19.6 | 13.5 | 10 to 20 |

B3 holds at every script and leaves `OPEN`. B5's stagger and burst rows are gone: no omen answers by a hit. Every new
B5 row holds except Zaratan's interrupt (its Trench in its last phase, met 0.09 times a fight, as in pass 4). Four
values sit within one standard error of their bound: the Rider's B1 (0.058) and B3 (0.008), the Angel's B5 step (0.780)
and the Rider's B5 shield (0.771). B4 stays open for plain, the Angel and Zaratan.

## Mythic balance: Zaratan's stun and B4

**The rows asked for.** Zaratan's B5 interrupt row (1.08, se 0.23, against at most 0.8) and B4 (three cannons won
0.380 of 600 fights against plain, 0.187 against the Angel, 0.657 against Zaratan; at most 0.15). Scripts stay off.
Every number is the sim's own fights (seeds from 1, the setups of `tests/fight-sim.test.ts`); a script's data was
changed in memory for a probe and only the kept change written.

### Step 1: what three cannons do that the mixed party does not (measured before any change)

| Today's mythic, no script (400 fights) | the mixed party | three cannons |
|---|---|---|
| brute body (armor 92, resist 10) | 0.063 (se 0.012), 14.4 rounds | 0.450 (se 0.025), 8.7 rounds |
| caster body (armor 20, resist 30) | 0.075 (se 0.013) | 0.043 (se 0.010) |
| skirmisher body (armor 20, resist 30) | 0.077 (se 0.013) | 0.000 |

On the brute (200 fights): the party deals 79 a round (tank 4, bruiser 29, cannon 46) against three cannons' 148 (49,
49, 50); the mythic deals each about 57. What the hits keep after defence (100 fights): the tank's 0.49, the bruiser's
0.50, a cannon's 0.92. Three cannons with no blast (its mana cost made unpayable) won more, 0.840 against 0.447 (300
fights): Arc Bolt is the damage, not the blast.

**The bar.** A trace of Zaratan against three cannons (seed 1) broke its bar at rounds 0.4, 2.0, 4.0, 6.0, 8.0 and 9.9;
it landed two Jaws in 12 rounds, and the Sea Rises it announced in the Dive never landed. A mythic's bar is four
same-rank hits of a blade on its own armor (rows.ts `sameRankHit`), so on armor 92 it is small for a bolt that meets
resist 10. With no bar at all (kinds.mythic.stagger 0, 200 fights) both parties won 0.000 against plain, the Angel and
Zaratan: breaks are how any party beats a mythic, and on a brute body bolts get them cheap.

| A brute mythic's guard evened, no script (400 fights) | the mixed party | three cannons |
|---|---|---|
| armor 92, resist 30 (resist x6), hp 4.6 | 0.115 | 0.307 |
| armor 92, resist 50 (resist x10), hp 4.2 | 0.177 | 0.182 |
| armor 51, resist 51 (same sum), hp 4.9 | 0.087 (se 0.014) | 0.007 (se 0.004) |

**The cause on a brute body is one: its guard is split, and an all-magic party meets the small half twice**, in the
damage it keeps and in the bar it fills. The Angel's caster body has no such gap; its B4 is its script's (step 3).

### Step 2: where the fix goes

`fight.kinds.mythic` holds one armor factor and one resist factor for every body: raising its resist factor so the
brute's matches its armor would give a caster's and a skirmisher's resist 90 to 150 against armor 20, the same gap the
other way. `fight.archetypes` holds HP and power only, and an armor and resist pair there is read by derive.ts
(`monsterSheet`), which another unit holds. So the gap is closed in the script's data: `EVEN_GUARD`, a status every
phase of plain and Zaratan wears, two `sheet` ops read on the bare body that move armor and resist each half the gap
toward the other (92 and 10 become 51 and 51 on a brute; 20 and 30 become 25 and 25 on a caster). plain's body is any a
GM makes, so the guard is there whatever the body.

plain with the even guard (200 fights unless named): hp 0.95 B1 0.180, B4 0.025; 0.97 (600) 0.090 and 0.012; 1.0
0.030 and 0.005; **0.98 (600) 0.072 (se 0.011) and 0.010 (se 0.004)**.

### Step 3: the Angel (a caster body; B4 0.187)

Three cannons deal 124 a round to the mixed party's 92 and break the bar of the Note phase (bar 0.75) before the Note
is read (a trace, seed 3: the Angel took 7 turns in 12 rounds and never announced the Note in its last phase). They hold
no shield, so Weighed (cancelled by a shield on the hunter it names) always lands on them, but at 0.35 it cost little.

| The Angel (200 fights) | B1 | B4 |
|---|---|---|
| today | 0.075 | 0.170 |
| the Note first in its phase | 0.000 | 0.065 |
| the Note phase's bar 1 (was 0.75) | 0.025 | 0.090 |
| Weighed hits 0.8 | 0.075 | 0.130 |
| **Weighed hits 1.2** | **0.075** | **0.100** |

The mixed party shields Weighed 1.16 times a fight of 1.33, so its hit does not move B1; it moves the parties that hold
no shield: B4, B3 and B5 shield. Weighed's 1.2 is the same reasoning as the Sinking's 1.0 and the Trench's 1.2 (MY5 fifth
pass): an answer's worth is the hit it saves.

### Step 4: Zaratan (a brute body; B4 0.657, B5 interrupt 1.08)

**B4.** The even guard alone (200 fights): hp 0.92 B1 0.015, B4 0.275; hp 0.85 0.065 and 0.360. The rest is the Dive: its
HP does not move there, but its bar filled from each hit, so three cannons broke it under the waves. Its bar made
unbreakable in the Dive, with the even guard, hp 0.92: B1 0.010, B4 0.040; the Shell as 15 armor and 15 resist (was 30
armor) instead: 0.015 and 0.100. Kept: the Dive wears **Under the Waves**, one `staggerRate` op at -100 (land.ts
`barRate`), so no hit fills its bar, as no hit reaches its HP. Even guard and Under the Waves, hp 0.85: B1 0.050, B4
0.080, B3 0.000, B7 0.289 / 0.263 / 0.447, but B5 interrupt 1.10 (se 0.47).

**B5 interrupt: the stun dies with the tank.** A trace of the mixed party (seed 1) had the tank at 0 HP before the Island
Wakes, the one phase that announced the Trench. Every variant at 200 fights, with the even guard and Under the Waves:

| The Trench (hp) | stun meets it a fight | B1 | B4 | B3 | B5 interrupt | B7 last phase | median |
|---|---|---|---|---|---|---|---|
| the Wakes only (0.85) | 0.08 | 0.050 | 0.080 | 0.000 | 1.10 | 0.447 | 19.0 |
| also the Dive's second beat (0.85) | 0.22 | 0.025 | 0.020 | 0.000 | 1.20 | 0.462 | 18.9 |
| the Wakes only, no step answer (0.85) | 0.10 | 0.030 | 0.075 | 0.000 | 0.33 | 0.459 | 17.9 |
| the same (0.77) | | 0.075 | 0.125 | **0.025** | 0.60 | **0.622** | 18.6 |
| also the Shore's last beat (0.85) | 0.35 | 0.040 | 0.130 | 0.005 | 0.63 | **0.667** | **20.4** |
| also the Shore's second beat, clock 5 (0.92) | 0.56 | 0.065 | 0.095 | 0.000 | 0.31 | **0.658** | **20.9** |
| **also the Shore's second beat, clock 4 (0.92)** | 0.6 | 0.070 | 0.100 | 0.000 | 0.29 | 0.543 | 19.8 |
| the same, the Wakes' clock 4 (0.92) | | 0.045 | 0.050 | 0.000 | 0.22 | 0.555 | 19.4 |
| the same, no Sinking in the Wakes (0.92, 600) | 0.61 | 0.035 | 0.088 | 0.002 | 0.14 | 0.563 | 19.1 |

A stun-only Trench lands whole on the cannon whenever the tank is gone, so B1 fell and the `hp` that brought it back
let the party that answers none win (B3) and won fights after a doom (B6, 7 of 146). On the Shore the tank is alive: an
answered Trench there buys the Shore 3 rounds, so its clock goes from 5 to 4. A Sea Rises of 1.0 or 1.2 and a Waking
fury of 10% (B4 0.298: the fury is what kills three cannons in the last phase) were worse.

The Trench on the Shore's second beat, the Shore's clock 4, at 600 fights:

| hp | B1 | B4 | B3 | B5 step | B5 interrupt | B7 | median |
|---|---|---|---|---|---|---|---|
| 0.90 | 0.065 | 0.102 | 0.003 | 0.256 | 0.385 | 0.257 / 0.144 / **0.599** | 19.7 |
| 0.91 | 0.057 | 0.095 | 0.003 | 0.235 | 0.441 | 0.290 / 0.134 / 0.576 | 19.6 |
| **0.92** | **0.055** | **0.092** | **0.002** | **0.273** | **0.424** | **0.316 / 0.131 / 0.554** | **19.5** |

0.92, Zaratan's `hp` as it was: B7's last phase has the most room there. B1 (0.055, se 0.009) is within one standard
error of its floor.

### Step 5: every B row at 600 fights

| Row (600 fights) | plain | Angel | Zaratan | Rider | Bound |
|---|---|---|---|---|---|
| B1 wins | 0.072 (se 0.011) | 0.067 (se 0.010) | 0.055 (se 0.009) near | 0.058 (se 0.010) near | 0.05 to 0.10 |
| B2 skips, mixed / three cannons | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 | 0 |
| B3 wins answering none | none | 0.000 | 0.002 (se 0.002) | 0.008 (se 0.004) near | under 0.01 |
| B4 three cannons win | 0.010 (se 0.004) | 0.093 (se 0.012) | 0.092 (se 0.012) | 0.018 | at most 0.15 |
| B5 without step, over B1 | none | 0.775 (se 0.180) near | 0.273 (se 0.101) | none | at most 0.8 |
| B5 without interrupt, over B1 | none | 0.200 (se 0.077) | 0.424 (se 0.133) | 0.514 (se 0.146) | at most 0.8 |
| B5 without shield, over B1 | none | 0.275 (se 0.092) | none | 0.771 (se 0.193) near | at most 0.8 |
| B6 won after a doom | 0.000 | 0.000 | 0.000 | 0.000 | under 0.01 |
| B7 most / least less its floor | one phase | 0.430 / 0.091 | 0.554 / 0.081 | 0.527 / 0.111 | at most 0.6 / at least 0 |
| B8 median rounds | 15.2 | 15.2 | 19.5 | 13.5 | 10 to 20 |

The Rider's rows are pass 5's: no change here touches its script or body. Every B row but B9 holds; `OPEN` keeps only
B9. Today's brute mythic with no script (row M1's body) still loses 0.45 of its fights to three cannons: no row bounds
it, and once `fight.mythic.scripts` is on every mythic plays a script, plain at the least, which wears the even guard.

## Difficulty slider (unit difficulty-slider, Nov 23)

Three same-rank hunters (`tank`, `bruiser`, `cannon`) against one same-rank brute boss, calibrated to the owner's anchors
(level 1 = 95%, level 5 = 75%, level 10 = 5%, straight-line targets `[95, 90, 85, 80, 75, 61, 47, 33, 19, 5]`) using
`hp = k^0.35`, `dealt = k^0.65`, with `k = boss[level - 1] * rankScale[rank]`. Non-boss monsters and mythics use `pack`
centered at `1.00` on default level 5.

### Baseline before scaling (`k = 1.0`, `n = 300`) vs default level 5

| Rank | Before (`k = 1.0`) WR / any dead / rounds | Level 5 (`hp` / `dealt`) | After (level 5) WR / any dead / rounds |
|---|---|---|---|
| E | 100.0% / 0.0% / 5.8 r | 1.48x / 2.08x | 72.7% / 91.3% / 9.2 r |
| D | 100.0% / 0.0% / 5.9 r | 1.44x / 1.98x | 75.3% / 90.7% / 9.0 r |
| C | 100.0% / 0.0% / 5.9 r | 1.46x / 2.03x | 75.3% / 92.3% / 9.2 r |
| B | 100.0% / 0.0% / 6.2 r | 1.44x / 1.98x | 74.0% / 94.0% / 10.0 r |
| A | 100.0% / 0.7% / 6.7 r | 1.38x / 1.81x | 73.3% / 94.7% / 10.3 r |
| S | 100.0% / 1.3% / 7.3 r | 1.38x / 1.83x | 74.7% / 79.3% / 11.2 r |

### Pass 1 (design draft) -> Pass 2 (fitted)

| Lever | Draft | Fitted | Why |
|---|---|---|---|
| `boss` | `[2.55, 2.70, 2.82, 2.92, 3.02, 3.16, 3.30, 3.52, 3.88, 4.60]` | `[2.55, 2.71, 2.88, 2.93, 2.97, 3.09, 3.22, 3.38, 3.88, 4.91]` | Draft missed D3 E (0.150), D3 S (0.140), D4 C7 (0.375), D4 C8 (0.233); fitted brings all 16 D1 to D5 rows inside bounds (D1 0.727 to 0.753, D2 0.917 to 0.970, D3 E 0.095 / C 0.025 / S 0.033, D4 C3 0.883 / C7 0.472 / C8 0.313) |
| `pack` | `[0.72, 0.79, 0.86, 0.93, 1.00, 1.12, 1.24, 1.38, 1.54, 1.72]` | `[0.72, 0.79, 0.86, 0.93, 1.00, 1.15, 1.32, 1.52, 1.75, 2.05]` | Draft missed D5 C pack at 10 (anyDead 0.173 < 0.20); fitted reaches 0.260 (se 0.036) |
| `rankScale` | `{ E: 1.04, D: 0.95, C: 1.00, B: 0.95, A: 0.85, S: 0.85 }` | `{ E: 1.04, D: 0.96, C: 1.00, B: 0.96, A: 0.84, S: 0.85 }` | Centers D1 across all 6 ranks between 72.7% and 75.3% |

Added wall time for the 16 D1 to D5 rows: ~35.2 s (1.2 s to 3.1 s per row, well under `BUDGET_MS = 30,000`).

## Worldbreaker, the Strength apex (unit row-32, Nov 23)

the owner approved Neon's change on questionable-decisions row 32: restore damage to Worldbreaker (`KEYSTONES.apex.str` in
`src/core/registry/keystones.ts`) with a smaller stagger share inside the 25-point apex budget (20 to 30 band at rank B,
weighed by `itemSpend` / `powersSpend`).

### All 8 apexes measured at rank B (pack, difficulty-5 boss, duels) and rank S (all 4 mythic scripts)

Each apex is added to its natural party slot (`withApex` in `tests/models/fight-sim.ts`) and compared as a delta over
the same party without that apex. Pack: 3 normal brutes at B (200 fights, % fewer rounds). Boss D5: difficulty-5 brute
boss at B (300 fights, win rate delta). Mythics: mean win rate across all 4 scripts (`plain`, `angel-of-the-last-trumpet`,
`zaratan-the-island-that-wakes`, `the-fourth-rider`) at S (300 fights per script, 500 for the final pick). Duels: 1v1
against `tank`, `speed`, and `cannon` across both openings at B (600 duels).

| Apex (holder) | Budget (B) | Pack B rounds (fast%) | Boss D5 B WR (delta) | Mythic S mean WR (delta) | Mythic S (p / a / z / r) | Duel B WR (delta) |
|---|---|---|---|---|---|---|
| Baseline (`tank`, `bruiser`, `cannon`) | 0.0 | 3.85 r | 74.0% | 7.2% | 8.7 / 7.0 / 6.3 / 6.7 | 86.5% |
| STR Worldbreaker, **before** (`effect: null`, 0.50 stagger, cd 4) | 22.4 | 3.85 r (+0.0%) | 54.3% (-19.7pp) | 1.9% (-5.3pp) | 0.0 / 4.0 / 0.3 / 3.3 | 86.5% (+0.0pp) |
| STR Worldbreaker, **after** (`1.15 * strike`, 0.15 stagger, cd 6) | 27.4 | 3.78 r (+1.8%) | 88.0% (+14.0pp) | 9.7% (+2.5pp) | 14.3 / 10.7 / 5.7 / 8.0 | 87.7% (+1.2pp) |
| AGI Afterimage (`speed`) | 0.0 + worn | 3.31 r (+7.6%) | 91.3% (+39.7pp) | 13.4% (+12.9pp) | 37.3 / 8.0 / 7.7 / 0.7 | 86.0% (+48.7pp) |
| VIT Undying (`tank`) | 24.3 + worn | 3.85 r (+0.0%) | 77.3% (+3.3pp) | 12.6% (+5.4pp) | 23.3 / 9.7 / 7.7 / 9.7 | 78.8% (+28.0pp) |
| INS Foresight (`bruiser`) | 0.0 + worn | 3.86 r (-0.3%) | 75.3% (+1.3pp) | 7.5% (+0.3pp) | 8.3 / 9.7 / 5.0 / 7.0 | 91.3% (+4.8pp) |
| DIS Mind Fortress (`tank`) | 23.1 + worn | 3.85 r (+0.0%) | 74.0% (+0.0pp) | 6.2% (-1.0pp) | 8.7 / 7.0 / 1.7 / 7.3 | 50.8% (+0.0pp) |
| PRE Sovereign (`tank` in MIXED) | 0.0 + worn/shd | 3.57 r (+7.4%) | 89.3% (+15.3pp) | 16.1% (+8.9pp) | 31.0 / 18.3 / 7.7 / 7.3 | 67.7% (+16.8pp) |
| POW Cataclysm (`cannon`) | 29.9 + active | 3.60 r (+6.4%) | 73.7% (-0.3pp) | 7.9% (+0.7pp) | 8.3 / 9.7 / 6.7 / 7.0 | 56.5% (+2.8pp) |
| CTL Puppeteer (`status`) | 0.0 + worn | 4.37 r (+15.0%) | 96.7% (+0.0pp) | 54.3% (+0.0pp) | 93.7 / 43.0 / 32.7 / 47.7 | 67.5% (+0.0pp) |

### Worldbreaker candidate sweep (within the 20 to 30 point apex band, N=300; N=400/500 for the final four)

| Candidate | Budget (B) | Pack B fast% | Boss D5 B WR (delta) | Mythic S mean WR (delta) | Duel B delta |
|---|---|---|---|---|---|
| **1.15x + 0.15 stagger, cd 6 (kept)** | **27.4** | **+1.8%** | **87.5% (+12.7pp, N=400)** | **9.5% (+2.9pp, N=500)** | **+1.2pp** |
| 1.15x + 0.20 stagger, cd 7 | 24.8 | +1.8% | 88.3% (+13.5pp, N=400) | 11.3% (+4.8pp, N=500) | +1.2pp |
| 1.20x + 0.15 stagger, cd 8 | 21.3 | +1.9% | 89.5% (+14.7pp, N=400) | 9.8% (+3.3pp, N=500) | +1.2pp |
| 1.20x + 0.20 stagger, cd 8 | 22.4 | +1.9% | 90.3% (+15.5pp, N=400) | 10.0% (+3.4pp, N=500) | +1.2pp |
| 1.20x + 0.15 stagger, cd 6 | 28.4 | +1.9% | 91.0% (+17.0pp, N=300) | 11.2% (+4.0pp, N=300) | +1.2pp |
| 1.25x + 0.25 stagger, cd 8 | 24.3 | +2.0% | 93.7% (+19.7pp, N=300) | 12.3% (+5.1pp, N=300) | +1.5pp |
| 1.50x + 0.20 stagger, cd 8 | 26.9 | +2.9% | 95.7% (+21.7pp, N=300) | 15.5% (+8.3pp, N=300) | +1.8pp |

Why `1.15 * (1d8 + phys)` + `0.15` stagger on a 6-round cooldown:
- At rank B (`1d8 + phys` ≈ 29.9), `1.15x` deals 34.4 average damage, beating both Strike (29.9) and Mutilation (32.4), so a Strength hunter uses it on normal packs and in duels instead of skipping it.
- On a 4-round cooldown, 1.0 SA alone already spends 29.9 points, leaving no room for damage and stagger together; raising the cooldown to 6 rounds puts 1.15 SA damage + 0.225 SA stagger at 27.4 points (inside 25 ± 20%).
- Stays below Sovereign (+15.3pp) and Afterimage (+39.7pp) on difficulty-5 bosses, and below Undying (+5.4pp), Sovereign (+8.9pp), and Afterimage (+12.9pp) on mythics.

### New simulation rows (`tests/fight-sim.test.ts`, W1 to W3)

- `W1` (pack at B, paired over 150 runs): `0.069` rounds faster (se `0.027`, `3.879` over `3.809`), bound `0.010 to 0.500`.
- `W2` (difficulty-5 boss at B, 300 runs): `0.880` win share (se `0.019`, mean `9.5` rounds), bound `0.780 to 0.940`.
- `W3` (mean across all 4 mythics at S, 200 runs each = 800 fights): `0.101` win share (se `0.011`; `plain 0.145`, `angel 0.110`, `zaratan 0.075`, `rider 0.075`), bound `0.060 to 0.140`.

## Balance pass step 4: Angel's Stars Fall (branch bal-stars, Nov 25)

After R6 made `burning` meet Resist, a hunter who ignored the `Stars Fall` omen could still reaction-dodge out of the radius-2 blast on its 1-round wind-up, leaving the Angel's `B5 without step` row near its `0.800` ceiling. Setting `sure: true` on `stars-fall` (keeping `hits: 1` and reach 2) removes the last-second reaction dodge while keeping stepping off the center tile a full cancel and showing `Cannot be dodged or resisted.` on the omen banner.

### Sweep on 600 runs (exact `fight-sim.test.ts` seeds)

| Variant | B1 wins | B3 none | B4 3 cannons | B5 step (se) | B5 interrupt | B5 shield |
|---|---|---|---|---|---|---|
| Before (`sure: false, hits: 1.0`) | 0.083 (50) | 0.000 | 0.093 (56) | 0.760 (0.158) | 0.220 | 0.220 |
| **After (`sure: true, hits: 1.0`)** | **0.082 (49)** | **0.000** | **0.093 (56)** | **0.735 (0.156)** | **0.204** | **0.224** |
| `sure: true, hits: 1.2` | 0.082 (49) | 0.000 | 0.093 (56) | 0.735 (0.156) | | |
| `sure: true, hits: 1.4` | 0.080 (48) | 0.000 | 0.093 (56) | 0.750 (0.160) | | |
| `sure: true, hits: 1.6` | 0.080 (48) | 0.000 | 0.093 (56) | 0.750 (0.160) | | |

Raising `hits` past `1.0` does not cut `noStep` wins below `36 / 600` because `1.0 * hpS` plus burning already kills a Cannon caught in the blast. The remaining floor comes from Phase 1 ending before beat 4 (`Stars Fall`) lands (`10` of `36` `noStep` wins exit Phase 1 in under 5 turns). Every Angel row stays inside its bound: B1 `0.082` (0.05 to 0.10), B2 `0 / 0`, B3 `0.000` (under 0.01), B4 `0.093` (at most 0.15), B5 step `0.735` / interrupt `0.204` / shield `0.224` (at most 0.80), B6 `0` capped / `0.000` after doom, B7 max `0.448` / least minus floor `0.069`, B8 median `15.5` rounds.


