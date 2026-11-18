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
