# Notes: the worth bar and the simulation (brief-kits-worth.md)

Goal (poteto mode): the owner builds kits in the Workshop and reads the worth bar to know whether they are fair. The bar
and the balance simulation disagree on the same example (Bloodletting: the simulation needs 0.85 of a bolt, the bar
calls 0.85 over budget), so a GM who follows the bar builds kits the simulation shows are weak, and the examples he
copies were bent to the bar. The problem is one fact (what a thing is worth) kept in two places. The smallest change
expected: find each term of `worth.ts` that the simulation contradicts, correct it at its cause with a rule in
`RULES.fight.kit`, pin the bar to the simulation with a calibration test, and make the examples carry the simulation's
numbers.

## Log

- Start: main tree on `claude/zen-pasteur-ov4cgd`, clean, at db86114.

## Step 1: why the bar and the simulation disagree (before any change)

How it was measured. The bar is `abilityWorth` at C (and E, S), as the skill maker reads it. The simulation is the kits'
duels of tests/models/fight-sim.ts on the real reducer: each kit against the triangle's three builds, both openings,
200 fights an opening, less its plain build in the same fights (seeds 1 to 200). A scratch script, not committed,
printed both; the numbers below are its output. The noise floor of a difference of two win shares at 400 fights each is
about 0.03. Only the duel against the tank separates a kit from its plain build: against the speed build and the
cannon the bolt is cast 1.5 to 1.7 times a fight (blasts and the race decide them), so those two rows move by noise.

| Example | Bar now (E / C / S) | Simulation (kit less plain, tank duel, C / S) | What the bar gets wrong |
|---|---|---|---|
| Bloodletting at 0.7 of Arc Bolt (the example) | 1.09 / 1.01 / 0.97 | -0.175 / -0.085 (out at C) | counts the burst per stack linearly; the yardstick (below) |
| Bloodletting at 0.85 (the simulation's) | 1.27 / 1.17 / 1.13, over | +0.055 / +0.042 (inside) | as above |
| Bloodletting at 1.0 | 1.42 / 1.34 / 1.28 | +0.132 / +0.100 (out) | as above |
| Disaster Stroke at 0.75 | 1.14 / 1.06 / 1.01 | 0.000 / +0.013 | the burst lands whole, unlike the curse it is weighed against |
| Violence (perStack 0.06) | 1.00 / 1.00 / 1.00 | 1.31 to 1.33 strikes a use at 5 Pain or more (no duel reaches 5 Pain) | reads `spent` as 0 |
| Fester | 0.97 / 0.90 / 0.87 | no row | reads `target.stacks(resonance)` as 0 |
| Hemoplague, end 0.6 x (1d8 + mag) | 0.47 / 0.96 / 2.00 | no row | weighed against a physical curse; delay; no mode credit |
| Crimson Pact (half max HP) | -1.44 / -1.03 / -0.98 | no row | a mode's entry, priced as a price with nothing bought |
| Executioner's Cut | 0.85 / 0.87 / 0.86 | no row | nothing found |
| Parry | 0 | within the tolerance of no Parry (wave 2 rows) | `guard` and a reaction have no rule: 0 |
| Call Sprite | 0 | the summoner's boss row holds | a summon has no rule: 0 |
| Pain is Power | 0 (worn) | Pain's duels equal the bruiser's | a stack with no op of its own is 0, correctly |
| Arc Bolt, the plain cannon's bolt | 1.17 / 1.08 / 1.04, over at E and C | the triangle holds with it | the unit (below) |

The terms, each with its number:

1. **The yardstick of an ability with no formula of its own.** `abilityWorth` takes the type of the standard action
   from `a.effect?.type ?? (support ? 'shield' : 'physical')`, a literal guess. A curse with no effect (Hemoplague) is
   weighed against `1d8 + phys`, a cannon's weak side: its end's `1d8 + mag` reads as 1.61 SA at C, 0.78 at E and 3.3 at
   S. The kind's own type (`KINDS[kind].type`, magical for a curse) is the yardstick. This is a bug, not an estimate.
2. **Damage that lands outside the use lands whole.** A curse's own formula is resisted for half on 45% of uses at
   parity (`resistDc` 12, `resistedShare` 0.5), so a use delivers 0.775 of its average. The yardstick is a curse too,
   so the two cancel for the use's own formula. A threshold's burst, a trigger's hit and an end land at their averages
   (`landOps`), never resisted, so against the delivered yardstick they are worth 1 / 0.775 = 1.29 times what the bar
   gives them. The bar weighed them at 1.
3. **A threshold pays only in whole firings.** The bar gives a payoff of x at N stacks x / N for every stack. A fight
   ends with stacks short of a firing: over the reference fight of 6 uses landing 55% of the time, the expected whole
   firings of a binomial count are 0.70 of the linear count at N = 3 and 0.85 at N = 2 (design 3's paper counted them so;
   `worth.ts` did not).
4. **A delayed effect counted whole.** An end that lands `d` rounds after its use lands only if the fight lasts that
   long and nothing cures it first. At a uniform moment of a 6-round fight, a 3-round delay lands half the time.
5. **A mode gives no credit.** `abilityWorth` takes a `credit`, but the maker never passes one, so Hemoplague (gated on
   Crimson Pact) is judged without the Pact's price. The Pact itself shows its HP price as a negative worth.
6. **A count read at zero.** The bar reads a formula with `NO_KIT`: `spent`, `stacks`, `target.stacks`, `field`, `held`,
   `hits` and `kills` are 0, so Violence is a plain strike and Fester a weak curse. The value depends on how the kit is
   played (Violence at 5 Pain is 1.31 strikes; in a duel it is never used), which the bar cannot know.
7. **A block with no rule reads as 0.** Parry's guard, a reaction, a summon, a push and the other wave 2 ops add nothing,
   so the bar shows "Worth 0.00" for Parry and Call Sprite: a wrong number, not an estimate.

Two premises the brief states, tested:

- "The simulation says Bloodletting must be 0.85." It says 0.85 keeps the kit within 0.08 of a cannon casting Arc Bolt.
  Arc Bolt is `2d6 + mag` with no cooldown, which the bar already rates 1.08 SA at C (its tolerance edge) and 1.17 at E.
  So part of the gap is a unit: the simulation's lever is a share of Arc Bolt, the bar's unit is the standard curse.
  Bloodletting at 0.85 over Arc Bolt is 1.085 by the bar now, +0.055 by the simulation; the bar's error on the kit
  itself is the burst (terms 2 and 3), about 0.05 SA, not 0.17.
- "The bar is wrong where the simulation is right." The triangle holds with either curse: a cannon casting the standard
  `1d8 + mag` in place of Arc Bolt beats the tank 0.625 at C and 0.805 at S (bound 0.6 to 0.9), and loses to the speed
  build 0.698 and 0.795 (Arc Bolt: 0.760, 0.860, 0.637, 0.637; 200 fights an opening). The simulation does not say the
  standard curse is too weak; it says both sit inside, the standard near the cannon-over-tank floor.

Measured threshold discount, from the tank duel at C: the break-even share (kit equal to plain) lies between 0.7
(-0.175) and 0.85 (+0.055), at 0.81 by linear interpolation, so the burst is worth (1 - 0.81) x 1.08 = 0.20 SA where the
bar gives 0.254 (0.79 of it, give or take 0.1 from the noise). Terms 2 and 3 together predict 0.254 x 0.70 / 0.775 =
0.23. For Disaster Stroke the simulation's 0.000 against a bar of 0.976 of plain puts the mark's burst at about 1.1 of the
bar's; terms 2 and 3 predict 0.85 / 0.775 = 1.10.

## Step 2: the estimate corrected at its causes

Each correction is a rule in `worth.ts` with its reason beside it; the one new number is `kit.cleanse`.

- Term 1: the yardstick of an ability with no formula is its kind's type (`KINDS[kind].type`).
- Term 2: `deliveredShare` (0.775 for a direct use at parity, from `resistDc` and `resistedShare`); a part that lands
  outside the use's own roll is weighed against the delivered yardstick (`At.landed`).
- Term 3: `firings`, exact over the states (count, misses in a row): whole firings of the reference fight's uses, and
  the stacks lost when more uses in a row miss than their time allows (`lapseAfter`; the reducer drops a status at
  `until <= now`, so a stack of 2 rounds from a use a round apart lapses on one miss).
- Term 4: `delayedShare`, `1 - delay / referenceRounds`, times `(1 - kit.cleanse)` a round for an end a cleanse cancels;
  `kit.cleanse` is 0 (no built-in foe cures).
- Term 5: `gateCredit(a, others)` finds the mode's entry among the library's abilities and spreads its time and HP over
  the gated ability's uses in the mode's rounds (table 3.5's rule, no longer for the cannon alone).
- Terms 6 and 7: `Worth.unweighed` names a count read in a fight, a channel's charge, a reaction, a summon, a field, a
  move, a zone act, an end with no delay and every op kind with no rule; the line says "without ..., which it cannot
  estimate: test it in a fight", and the verdict is on the rest.
- The unit: a kind's budget is what a built-in skill of the kind with no cooldown holds, if more than one SA
  (`standardHeld`): the simulation's cannon casts Arc Bolt every turn and every row holds, so the bar no longer calls the
  game's own Mage over budget. Only the curse moves (1.17 at E, 1.08 at C, 1.04 at S); the line says "as Arc Bolt holds".
- The example's and the simulation's Resonance burst is now written in the scaler form `scalersOf` reads (`core * base *
  (1 + scale * max(0, min(1, ramp)))`, the same number): before, the bar read its execute as a plain formula at full HP,
  so the suggested base cut was charged and the execute's bonus never counted.

After (bar at C, its budget 1.08 as Arc Bolt holds; simulation as in step 1, tank duel):

| Example | Bar over Arc Bolt, less 1 | Simulation, kit less plain (C / S) | Verdicts |
|---|---|---|---|
| Bloodletting at 0.7 | -0.16 | -0.175 / -0.085 | both inside the warning (the bar warns only above) |
| Bloodletting at 0.85 | -0.006 (1.075 against a budget of 1.08) | +0.055 / +0.042 | both inside |
| Bloodletting at 1.0 | +0.14 | +0.132 / +0.100 | both over |
| Disaster Stroke at 0.75 | -0.065 | 0.000 / +0.013 | both inside |

The calibration test ("the bar agrees with the simulation on the example kits", tests/worth.test.ts) plays these on
the real reducer at C and S each run (150 fights an opening, seeded, about 7 s) and holds every pair within 0.1 and to
the same verdict. The bar now reads a little low on both bursts (about 0.06 of Arc Bolt): the reducer's stacks lapse
less than the strict reading of `until` predicts (a turn order a tick off a round lets a stack survive a miss). I left
the strict reading, the reducer's own rule, rather than fit a number to the run.

## Step 3: the examples carry the simulation's numbers

- Bloodletting reads `RULES.fight.kit.examples.blood.share` (0.85), the share the simulation's kit rows play; Disaster
  Stroke already read `mark.share`. A new case in tests/kit-examples.test.ts holds both formulas to those numbers.
- Hemoplague's end reads a new `examples.hemo.end`, 1.4 curses (design 3's number for it). It is not simulated: no
  build plays Crimson Pact (half max HP) yet, so "as simulated" is not met; the 0.6 it had was only the yardstick bug of
  term 1. The bar weighs it 0.50 SA at C against a budget of 1.08 plus the Pact's credit of 0.67.
- tests/kit-examples.test.ts weighs each example with the credit of the mode that opens it among the examples, as the
  skill maker now does (`gateCredit`). The simulation's rows and every old row read the same numbers as before (the
  burst's new text is the same formula).

## Step 4: the makers

Done:

- The worth bar is one part, `app.api.maker.worth(box)` in maker.js (its CSS moved there from skills.js), used by the
  skill maker, the status maker (`defWorth`: the def put on by a standard curse at its cap, held the reference fight) and
  the item maker (`wornWorth` of the status the item wears). Each reads "not estimated" where step 2 says so.
- The skill maker passes the credit of the mode that opens an ability (`gateCredit` over the library's skills, the
  active hunter's and the kits' examples), so Hemoplague is judged with Crimson Pact's price.
- Stack doubling (Glas's Sine Sanguis and Desecrate), weighed on paper. As an op `stackGain` (a share of the stacks the
  bearer applies, on itself or a target): (a) unbounded it is design 3.1's first loop, two doublers make four times and
  one use crosses a threshold; (b) bounded the only clean way (the strongest one counts, as share ops do, and an
  application never past `stackAdd`, 3) it gives at most +2 stacks a use while it holds, which a GM already builds as a
  mode: a second ability gated on the status that adds 2 stacks; (c) as a multiplier on the threshold's count (fire at
  n / 2) it is a new rule in the stack machine's table for a result (b) gives. Not built; for-the-owner.md says why and
  what to say to have it anyway.

Not done (time): a land effect still starts with a row filled in (the kits browser tests type into that row; making it
empty needs their steps changed with it), the searchable status and skill pick, and the field group's upkeep and early
end controls. Each is one unit of its own.

## Step 5: checks

- `bun run deps -- --write`, `bun run charts` (no machine changed; the chart file is the same).
- `bun run typecheck`: clean.
- `bun run test`: the first full run had 86 failures and a rerun of `bun test` none (a pause of the box while a browser
  file ran). The last full run: 3038 pass, 3 skip, 1 fail, the fight model's 2,500 random fights timing out at 120 s
  while three browser files ran beside it; alone it passes (5 pass, 0 fail, 105 s). It reads nothing this unit changed.
- Browser files, one at a time on 3241: customization 9 passed, look 15 passed, kits 5 passed and 1 failed then passed
  alone on its rerun (the Glas case timed out on its Fester step while `bun test` ran beside it). makers: 27 passed, 3
  failed: each puts a status on a monster from its fight card and waits for the card to show the status's per-round
  line ("3d8 magical damage a round"); the card shows "Frostbite · 3 rounds" without it. The card is combat.js's (the
  table unit merged at 685fe3b after this unit started); none of this unit's files draws it. Left to the lead.

## Decision trail (poteto mode)

- The premise "the bar is wrong where the simulation is right" was tested before any fix (attack-the-premise): a cannon
  casting the standard curse still holds the triangle, so part of the gap was a unit (Arc Bolt), not an error.
- The unit: weighed (a) keep the standard curse as the budget and let the example warn, (b) bend the example to the bar
  (the old answer, two sources), (c) a kind's budget is what its no-cooldown built-in holds. Chose (c): the simulation's
  builds cast those every turn and hold every row, so the bar cannot call them over without contradicting the authority.
  Contested: it raises a curse's budget 8% at C and 17% at E. Flagged to the lead.
- Lapse of stacks: the reducer's strict `until <= now` makes a 2-round stack lapse on one miss; the simulation measures a
  milder lapse. Kept the reducer's rule rather than fit a number (explain-the-number: the residual, about 0.06 of Arc
  Bolt, is stated with the calibration test's tolerance of 0.1).
- The calibration test plays the reducer each run (about 7 s) rather than reading stored numbers, so the bar and the
  simulation cannot drift apart unseen (build-the-lever, prove-it-works).

## Principles applied (each leaf read this session)

- fix-root-causes: term 1 is a literal guess fixed at its line; the Resonance burst's text is fixed where it is written
  so `scalersOf` reads it, not special-cased in the bar.
- attack-the-premise: the standard-curse triangle run before the fix changed the plan from "discount the bar" to "fix the
  unit too".
- explain-the-number: every measured number carries its fights, its noise floor and what limits it (the tank duel is the
  only one the bolt decides).
- experience-first: the bar names what it cannot weigh in words a GM reads ("test it in a fight") rather than showing 0.
- unslop: notes, for-the-owner.md and the commit messages in plain sentences.
