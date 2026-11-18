# Notes: kits, build wave 2 in core (brief-kits-build-3.md)

## Log

- Start: the worktree reset to `kits` (86cb82c, wave 1 units 1 to 14 and the dice notation). Branch
  `worktree-agent-afdfb377c7ca1e1c4`.
- Leftovers (one commit): `formulaOf` (fight-parse.ts) reads a dice node's `mods` through `diceModsOf` and a `fn` node, so
  an ability with `2d20kh1` and `floor(...)` survives the GM's skill library, a stored fight's row and an award's skill
  (tests/save.test.ts, tests/protocol.test.ts). `RULES.dice.maxDice` is 100 (the exact mean of the worst keep term it
  allows, `100d1000!kh50`, took 560 ms here, once, when typed). `sameRankHit` (rows.ts) prices its strike with `mean`.
  `describeStatus` says a def's triggers and end, `describeAbility` its prices, gates, tags and summon (design 5.1's
  sentences); a status key is named by its key in `describeAbility`, which has no condition table.
  `bun run test`: 2654 pass, 0 fail.
- Unit 18: wave 2's numbers in `RULES.fight.kit` (table 8.1) with `parry` 0.35 (table 8.10.3's lever, the built-in's
  guard). Departure: one `costCutMax` (0.25) for both costs; the paper's fatigue cut of 0.5 needs a second sheet number.
  Departure: Dispel and Purge are an op of their own, `dispel { which }`, not a `which` on `cureStatus`: an arm without a
  key would ripple through every reader of a cure's key. Departure: an extra action is an op, `extra`, not a refund of
  100 on the user (an ability's ops are `UseOp`s; a refund is a `LandOp` read only by triggers). A boost's fixed value is
  a `face` the GM writes (Mythical's 20); Expected Outcome's "a d20 rolled when it lands" is a die rolled at the use.
  The new `BearerEvent` `down` has the rate 0.17 (once in design 6's 6-round fight). Every new op parses with its bound
  clamped (tests/effect-ops.test.ts "wave 2's ops as data"). The status maker's round-trip e2e
  (tests/e2e/makers.e2e.ts, "every kind of op") fails for the 16 new kinds until unit 30 gives each its row in maker.js.
- Unit 19: a scaler in any damage formula (a threshold's, a trigger's, an end's, a per-round op's) is weighed as in an
  ability (`formulaWorth`); `Worth.against` and the worth line give packs and a boss.
- Unit 20: `standing.ts` (new, reads only): `withSheetOps` after `derive` in `modified`, `exposedOf` and
  `critFacesAgainst` at rule 9, `rangeWith` at rule 5 (`rangeFor`; fight-view.ts and map-view.ts still draw the plain
  range: the table unit should pass `rangeFor`), `damageShare` and `healShare` (rule 11c) in resolve, land.ts and
  `payDue` (which now takes the rules), `harmful`. `zoneTone` reads the new ops. `payDue` gained its rules argument.
- Unit 21: the wards. Departure: who has had a ward is the row's `warded`, not `Fight.warded`: a ward lands in resolve.ts
  and land.ts, which see rows, not the fight. A safeguard stops a harmful status from the other side's source; the GM's
  window is no side and is never stopped. Hiding is checked in the reducer (`seen`, a fight refusal and a table refusal)
  against the fog's sight or `fight.sight`. Reveals run in `consequences` after every change (`revealed`): HP lost, or a
  foe that is up within `hideReveal`. Acting on a foe or a place takes the user's untargetable and hidden off after the
  use. The targeting lists of fight-view.ts and map-view.ts still offer a concealed foe; resolve refuses it (`noTarget`).
- Unit 22: rule 7b is `keptFace` in resolve.ts: `edgeOn` (standing.ts) finds the edge, the kept face is `rollOf` of
  `withEdge(1d20, cut)` on the two faces, so "keep the higher" is written once, in formula.ts. A hidden user has the
  attack's edge (8.7.4). Departure: the second d20 rides in `Rolls.second` (by target) and held dice in `Rolls.boost`
  (by bearer), not as a second number in `react`: every reader of `react` stays as it was, and a use with no edge has
  neither field. An attacker's held die is rolled once a use and moves every target's face. `Needs.second` and
  `Needs.boost` are absent when empty; `rollNeeds` rolls them. A player's `cast` needs nothing new: the GM's phone rolls
  every d20 and held die with `rollNeeds` (combat.js already does), so tests/protocol.test.ts has no new case.
- Unit 23: `shovePath` (space.ts), rule 18c `pushed` and `swapped` in resolve.ts after every outcome, rule 5b `blinked`
  before rule 6. `Resolved.shoved` names the bodies a use moved; `after` passes them to `zoneSync` (`forced`), which
  gives them their holds and no on-entry part. A forced move breaks a holding channel (rule 17's broken, not a drop).
  `rooted` and `blocked` are use refusals now (the fight's union holds them through `UseRefusal`).
- Unit 24: `moved` (land.ts) moves stacks for a use (resolve.ts, after the target's ops) and a trigger (`landOps`); with
  `as`, onto the receiver's own status of that key when it holds one, else the moved def under that key (a `move` carries
  no def). `event` is the key of the status gained or ended, or, for any other event, the trigger's own status. The
  `down` event is raised for a use's and a trigger's kill (not for a per-round death at a settle). A trigger fires on its
  bearer's own `down` though it is down. `insideZone` (triggers.ts) reads a zone's open hold by the zone's name, for a
  trigger's need and the gate `inside`. `zoneActed` (zones.ts) shifts or grows the user's zone after the use; every body
  then pays no entry for that command.
- Unit 25: `extraNow` and `hastened` (timeline.ts) move a turn, never before `now + 1`. The row keeps `extras` (the
  round and the count, so `extraPerRound` above 1 works) and `hastened` (cleared at its turn start). A hasten on oneself
  does nothing (Transfer is an ally's). A second extra in a round is refused `extra` (a use refusal, and a table refusal).
- Unit 26: `fight-react.ts` (`reactStep`, its `TABLE`; `Body.armed` holds the ability, the named row of a `turn`
  reaction and `spent`). Rule 7c fires in the reducer before `resolve` (`beforeReactions`): each body the use may catch,
  in order, sets off the `before` reactions that protect it; its guard (a strike only) and negate go into `resolve` as
  `Answers`. Rule 13b is `Answers.lethal`, which `resolve` calls when a hit would take a body to 0, after the shield.
  Rule 19c fires after the use's triggers (`afterReactions`), aimed at the user. The `turn` reaction fires in
  `startTurn` before time moves to the named body's turn. Departures: (1) a reaction lands at its formulas' averages, as a
  trigger does (no dice in `needs` for it): it fires inside another's use, and its own dice would need a second round of
  rolls on the GM's phone for an aim the first use's dodges decide; (2) its prices other than mana and fatigue are not
  paid and its gates other than uses are not read (`mayFire`); (3) a `turn` reaction is restored when the named body's
  turn starts, not its reactor's: its reactor's turn comes at once after it fires, so restoring there let it fire again
  before the named body every time; (4) a `before` blink is not built (it needs a tile to go to); (5) a reaction raises
  no trigger events. The room message `arm` (`ownSheet`, applier none) and the fight's `arm` command; combat.js must turn
  the room's `arm` into the fight's (a view change, unit 30).
- Unit 27: the doc's `armed` names the party's rows whose reaction is armed and not spent (at most `doArmed`); a foe's
  is never in it. Its reader drops a bad id. The worst case with 12 ids: 54,877, 61,737 with the eighth.
- Unit 28: the six machines of 8.9 have tables: `reactStep` (fight-react.ts), `edgeStep`, `stealthStep`, `wardStep`
  (standing.ts), `shoveStep` (space.ts, stepped by `shovePath`), `extraStep` and `hasteStep` (timeline.ts); each is
  called where its rule runs. Their charts are one file, scripts/charts/wave2.ts, their walk events
  tests/models/wave2-events.ts. Random play gains two rows (Kai, a hunter with Parry, a lethal and a turn reaction, an
  extra action, a shove, a hasten, a blink and the Boundary he starts in; Shade, an elite foe with a hide, a riposte, an
  edge, a held die, a ward, a pull, a dispel, a swap and a zone shift) and the `arm` command; the old rows are as they
  were. Two kit blocks' coverage thinned with eleven rows: Kai starts holding a Boundary (so a zone price meets one) and
  holds the Pact with Hemoplague, and Hemoplague in random play lasts 800 ticks, not 1500. The model's new invariants
  (`wave2Wrong`): a reaction twice between its reactor's turns (proved by breaking `mayFire`: seed 1156 caught it), a
  concealed foe as an aim, a ward twice a fight, a moved turn before the next tick, extra actions past the rule.
- Unit 29: rows of 8.10 in tests/fight-sim.test.ts (`W2_ROWS`): Parry with the speed build against the tank and the
  bruiser at C and S (within 0.08 of plain: -0.030, -0.010, -0.013, 0.000), the cursed boss (5.26 rounds at C, 6.42 at
  S), Surge and Transfer (5.51, 6.41), Bow Expert measured (+0.077 v tank, +0.068 v cannon at C). Departure: Parry's
  guard is 0.30, not 0.35 (`kit.parry`; at 0.35 +0.082 at C and +0.168 at S; sim-log.md "Wave 2 of the kits", design.md
  corrected). The Transfer row has the bruiser give its turn to the cannon; given the other way it was 8.94 rounds at S,
  a policy giving away the better turn, not a rule. Every old row and wave 1's kit rows printed the same lines (63, line
  by line).
- Close: `describeAbility` says a blink, a swap, a reaction and a zone act (8.12's sentences); the fight's `start` takes
  `surprised` (8.7.5: a side's openings `kit.surprise` rounds later, an `alert` row's not), which random play does not
  send yet (one more draw would move every seed's play; the coverage of two kit blocks is already thin). AGENTS.md rows
  and recipes; design.md corrected where built otherwise.

## For the makers unit (30), the parsers unit (15) and the table unit (17)

Every field below is read by `parseOp` or `parseAbility` (fight-parse.ts) with the bound given, a number past it clamped;
each sentence is `describeStatus` or `describeAbility`'s (both have a `TODO(copy)` beside the words). The status maker's
round-trip e2e (makers.e2e.ts, "every kind of op") fails for these 16 kinds until each has its row in maker.js
(`KIND_LABEL`, then `NUMBERS`, `PLAIN_KINDS` or its own branch).

| Op (status maker or an ability's ops) | Fields and bounds | Sentence |
|---|---|---|
| `sheet` | key: armor, resist, pen, critFaces, exposed, critSize, costCut, range; amount (by rank allowed): armor and resist ±60 (`kit.armorOp`), pen ±0.4 (`penCap`), crit faces and exposed ±6, crit size ±0.5, cost cut ±0.25, range ±3 | "Armor +20", "Faces a foe crits it on +1" |
| `share` | on: dealt, taken, healed; pct ±100 (by rank allowed); the product held to 0.5 to 1.5 in a use | "Damage taken +25%" |
| `untargetable`, `invulnerable`, `safeguard` | none; they last a round at most (`wardRounds`), the first two once a fight | "Foes cannot aim at it or catch it, for a round, once a fight; acting on a foe ends it" |
| `edge` | side: attack or defend; keep: better or worse; tag: a tag or none (attack only); spend: yes or no | "Its next use against a foe: the target rolls twice and keeps the lower; spent once used" |
| `boost` | side; die: a die of 2 to 20 sides, or a fixed face 1 to 20 | "Its next use against a foe: each target's die is lowered by a d6" |
| `hidden`, `alert` | none | "Hidden: foes cannot aim at it ...", "Never surprised" |
| `shove` (an ability's ops) | dir: away or toward; from: user or aim; tiles 1 to 3 (`shoveMax`) | "Pulls each target 3 tiles toward you" |
| `move` (an ability's or a trigger's ops) | key: a status key, harmful or event; take 1 to 20 or all; from: user or target; as: a status key or none | "Moves all of the first harmful status to the target" |
| `hasten` | share 0 to 1 | "The target's next turn comes 100% of your action sooner" |
| `extra` | none; one a round (`extraPerRound`) | "Take another action at once, once a round" |
| `guard`, `negate` (a `before` reaction's) | guard: share 0 to 1 (Parry `kit.parry` 0.30) | "Takes 30% off the strike it answers", "The use it answers does nothing more" |
| `dispel` | which: first or all | "Cures the first harmful status" |

| Ability field | Bounds | Sentence |
|---|---|---|
| `move` | blink (its range read at most `blinkMax` 8) or swap | "Blinks to a tile you see within 8 tiles." "Swaps places with the body it is aimed at." |
| `react` | when: before, lethal, after, turn; reach 0 to `fieldRadiusMax` | "Reaction: before a foe's use lands on you, take 30% off a strike. Its time comes off your next turn." |
| `zoneAct` | act: shift (by 1 to 6) or grow (by 1 to 2); a zone's name or none | "Moves your Aura up to 6 tiles toward where it is aimed." "Widens your Aura by 2 tiles." |
| gate `inside` | a zone's name, at most 40 | "Only inside your Aura." |
| trigger `need` | holds a status key, or inside a zone's name | "Only while it holds Aura." "Only inside Wrath." |
| trigger event `down`, reach `most` | most: of HP, radius 1 to `fieldRadiusMax`, on all, allies or foes | "When its bearer goes down: ... on the one with the most HP of allies within 5 tiles" |
| a formula's scalers | as wave 1's notes say (`SCALER_CHOICES`, `suggestedScaler`); the worth line now names packs and a boss (`Worth.against`) | "Up to +100% against a target under half its HP." |

The table and the GM's views:
- Arm: a `.seg` of the hunter's abilities with `react`, None to disarm; send the room's `arm` (`{ by, ability, on }`; a
  `turn` reaction names a row). combat.js must take a player's `arm` (only from that hunter's phone: `ownSheet`) and send
  the fight's `arm` for that hunter's row, at any time (no `onTurn`); the GM's card arms any row with the same command.
- The doc's `armed` (party rows with a ready reaction): "Ready to react" on a teammate's card.
- `TABLE_REFUSALS` gained `extra` and `seen`: table.js needs their words.
- fight-view.ts `aims` and map-view.ts still draw an ability's plain range and offer a concealed foe as a target: pass
  `rangeFor` (resolve.ts) and filter with `concealed` (standing.ts) so the map offers only what resolve takes.
- The GM's Start window: Surprised (None, The party, The foes) sends `start` with `surprised`.
- The built-ins of 8.12 (Parry, Death's Grasp, Executioner's Cut) are not registry entries yet; Parry's guard is
  `RULES.fight.kit.parry`.

## Which principle changed a choice

- model-the-domain: each of 8.9's six things got its table beside the rule that runs it, and the rule calls it
  (`shovePath` steps `shoveStep`; the hide's refusal and the reveals read `stealthStep`), so a chart walks the real cell.
- type-system-discipline: a dispel and an extra action are op kinds of their own rather than optional fields that mean
  something else on an old kind; `Rolls.second` is a field of its own rather than `react` turning into number-or-list.
- explain-the-number: Parry's guard moved by a search with its table in sim-log.md, not by a bound; the Transfer row's
  first miss was traced to its policy before any number moved.
- prove-it-works: the reaction invariant was proved by breaking `mayFire` (seed 1156 caught it), and the old 63 rows
  were compared line by line after every unit's full run.

## Checks and files outside core

- No file under `src/views` changed. Two edge files did, each by its recipe: `src/edge/roll.ts` (`rollNeeds` rolls
  `Needs.second` and `Needs.boost`, unit 22) and `src/edge/room-events.ts` (the `arm` applier, none on a player's phone;
  the typecheck asks, unit 26).
- Every unit's commit was checked with the whole `bun run test` on a snapshot of the commit (git archive), all green but
  unit 20's commit, whose only failure was the stale dependency map, written in unit 21's commit. Unit 19 and the second
  commit of unit 22 were checked with the next unit's run.
