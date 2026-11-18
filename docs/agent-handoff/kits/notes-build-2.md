# Notes: kits, build units 7 to 14 (brief-kits-build-2.md)

## Log

- Start: the worktree reset to `kits` (221a979, units 1 to 6). Baseline `bun run test`: 2474 pass, 0 fail, 160 s; the
  balance rows as notes-build-1 has them (speed over cannon at C 0.606, the C boss fight 6.476 rounds, the status build 0.968).

## Choices where the design was silent or had to bend

- Unit 7, `land.ts`. A threshold's, a trigger's and an end's ops land through one function, `landOps` (a new module,
  src/core/combat/land.ts), which also holds rule 12 to 15's helpers that resolve.ts used privately (`afterDefence`,
  `throughShield`, `hurt`, `healed`, `threatened`, `crossed`, `landThreshold`). resolve.ts re-exports `afterDefence` and
  `Burst`, so its importers did not change. A trigger's hit reads the bearer as the user (design 1.3.9); a threshold's
  and an end's read the status's source.
- Unit 7, the events. `eventsOf` (triggers.ts) lists a use's events by outcome, the user's before the target's: a hit
  dealt and struck (a damaging outcome not out of the shape that dealt more than 0), a crit dealt and taken, a kill (the
  outcome's `down`), an avoid (out of the shape or resisted), a status gained (each key the use put on), a status ended
  (a cure op that took the status whole). The use itself (`used`) comes last, once, when the ability has tags. The fight
  raises `moved` for a walk or a dash (not a dodge, not the GM's drag), `turnEnd` in `after` when the current row spent
  its turn (act, move, endTurn, release), `turnStart` after the settle of the row whose turn starts (held or not), and
  `statusEnded` for every status that runs out (dropped by `advance` for any row, or ended at its bearer's settle). A
  zone's hold raises nothing.
- Unit 7, firing. A trigger's bearer must be up (HP over 0). A trigger whose stacks leave on the same event fires
  first and then the stacks leave (so "on a move, deal per stack, then they go" works); the leave on an event is wired
  here (stacks.ts's `event` cell had no caller). A status a trigger puts on checks its threshold, which lands at once and
  raises no events. A `refund` op gives back `pct` of the wait left to the bearer's next turn (`refunded`), never before
  `now + 1`; a threshold still ignores a refund (unit 6's choice). Kills count on the killer's row (`Body.kills`) for a
  foe of the other side, from a use's `kill` events and from a trigger's damage at any depth; `snapshot` reads them.
- Unit 7, rows. `Body.trips` (by `tripKey(status, index)`) and `Body.kills` are optional, absent when none, as unit 1
  built the defs: every test's row helper and every view's row stay as they were. A trip of a limit `every time` is
  never stored. A zone's hold has a key per entry, so a once-a-fight trigger on a zone's hold counts per entry.
- Unit 7, the parser. `parseStatusDef` now reads `triggers` (its first `kit.triggers`, each with its first `triggerOps`
  ops) and `end`; `parseAbility` reads `tags`, `prices`, `gates` and `summon` (each bound by table 1.1, a number past its
  bound clamped); `parseFight` reads a row's `trips` and `kills`. Before, a fight holding any of them did not come back
  from `parseFight` the same (the model test's round trip) and the GM's library lost them at load.
- Unit 8, the machine has its own module, `delayed.ts` (`Delayed`, `DelayedEvent`, `TABLE`, `endStep`), as unit 2 gave
  the count `stacks.ts`; effect-ops.ts stays under its size. An end lands at its bearer's first settle at or after its
  `until` (S2), from the source (its sheet as the user, against the bearer's defence; a source gone from the fight reads
  the bearer), at its averages times its stacks: every amount (damage, heal, mana, fatigue, shield) is multiplied, a
  status it puts on is put on once. `advance` keeps a status with an end past its `until` until its bearer settles (as
  it keeps one that owes per-round ops). A landed end that dealt damage raises `struck` on the bearer with its source as
  the other body, after its `statusEnded`.
- Unit 8, a cure of a status whose cleanse is `land` sets it off at once in a use (rule 18; resolve.ts lists it in
  `Resolved.bursts`, so the log names it) and in a trigger's or a threshold's cure (land.ts `landOps`). The GM's Status
  window removing it lands nothing: that is the GM's edit, not a cleanse. A down bearer has no settle, so nothing lands
  (a hunter at 0 keeps it and it lands at its first settle after it is up again). `onSheet` refuses any status with an
  end, so `writeBack` never sends one and the fight's end voids it.
- Unit 9, a zone's kit parts are optional fields (`ZoneKit`: `upkeep`, `end`, `triggers`, `laid`, `paid`), absent on a
  zone the GM or a map put down and on an ability's zone that has none, so the zones before the kits and their tests are
  as they were. `laid` is set only on a zone with an upkeep or an end (the two things that read it). A zone the GM or a
  map put down has no age: its end lands when its time passes. The life is `zoneStep` and its `ZONE_TABLE` in zones.ts
  (table 2.6), with `placeZone` (the cap: a fourth evicts the oldest the owner holds; an aura a status gives off is the
  status's and does not count), `payUpkeep` (S4, after the settle and before the turn's triggers) and `pricedZones`.
- Unit 9, the zone price is checked in the reducer (`act`), before `resolve`, and refused `zone` (a fight refusal):
  resolve.ts does not hold the fight's zones. So a use with a zone price and another fault is refused for the zone
  first. It is not read on a channel (a channel pays its prices on release, unit 6's note; a channel's release has no
  zone price). The zones a price takes land their ends (when a round old) before the use's own zone goes down, on the
  rows as they stood before the use, from the zone's owner at its tier.
- Unit 9, an upkeep's amounts are rounded per payment (`round(rate * span)`), not the running total `dueAmount` keeps;
  an upkeep is a price, and its rounding drift is at most half a point a turn. A zone whose time passes lands its end on
  whoever held an open hold on it just before (`grounded`, from the rows before `zoneSync`).
- Unit 9's first full run had 83 failures in the room-server files alone (server-rooms, the room model); each passed when run again alone and the whole suite passed on the rerun: a pause of the box (helper-rules).
- Unit 10, the machine is `summons.ts` (`summonStep`, `dismissed`, `timeUp`, `crowded`); the row is `summonRow` in
  rows.ts; rule 18d is `summoned` in fight.ts, after the use's zone and before its triggers. `CombatantKind` gains
  `summon`; `Body.owner` and `Body.until` are optional, set only on a summon. It stands on the free tile nearest its user
  (distance, then `y`, then `x`; none free, or `MAX_ROWS`, and nobody comes), its first turn a standard interval from
  now. A summon whose HP reaches 0 is taken off the fight (`sentAway` in `consequences`), not left down as a monster is:
  table 2.4 says gone, and it gives no XP. One on the foes' side keeps a threat table. `holdsSide` (an up row that is
  not a summon) decides `overIf` and the GM's `end`; `start` still needs a row up on each side (no summon exists then).
- Unit 10, `onTurn` (protocol.ts) takes a player's `step`, `cast` or `pass` for the current row when it is a summon whose
  owner is the sender's hunter. The doc's row kind gains `summon` in the hunter and shadow arm (HP, stride, move) so the
  doc and its reader compile; unit 12 adds its owner.
- Unit 11, the machine is `uses.ts` (`Uses`, `usesStep`, `usesOf`, `counted`, `restUsed`). `Body.used` (optional) counts
  each limited ability's uses: this fight's, and for one limited a rest also the rest's before the fight, which
  `hunterRow` takes from the hunter's `Vitals.used` (`RowHunter.used`). One map for both: an ability with a gate of each
  kind counts its rest's uses against its fight gate too (no kit writes both). Rule 3b's `gated` now answers `gated`,
  `noUses` or null; the reducer counts a use when it resolved (a channel when it begins, and the begin now checks rule
  3b's gates too: it checked none before). `adjust` gains `used: { ability, spent }` (refused `unknownAbility` for an
  ability with no uses gate). The `vitals` effect carries `used` (the rest-limited counts) when there are any.
- For the table unit: `combat.js` passes `vitals` to `hunter.setVitals` without `used`, so a rest's uses spent in a
  fight do not reach the sheet yet. The one change: pass `used: fx.used` and have `setVitals` write it to `Vitals.used`
  (a view change I may not make; `sendRemote` does not carry it either).
- Unit 12, the doc. `DocStatus.stacks` (absent on a plain status), the doc's `left` (the current row's limited abilities,
  uses left by id, 0 for a spent one; absent when it has none, beside `ready`) and a summon's row (kind `summon`, the
  shadow's fields and its `owner`) are read by `DOCS.fight` with their bounds: a count past the cap reads as the cap and
  a `left` past `fightUses` as `fightUses` (the reader's `int` clamps, as it does a row's numbers). `TABLE_REFUSALS`
  gains `gated`, `noUses`, `hp`, `stacks` and `zone`; the player's words for them are table.js's (the table unit). The
  worst case with the stacks and the uses left is 54,790 characters, the design's figure (a row 1,425), under eight
  ninths of `DOC_MAX`; a worst-case summon row is shorter than a monster's (the test checks both).
- Unit 13, the six machines of design section 2 each have a `TABLE`, a chart, an entry in `MACHINES` and walk events,
  built with their units: stacks (unit 2), a trigger's limit (`trips`, unit 7), a delayed effect (unit 8), a zone (unit 9),
  a summon (unit 10), a limited use (unit 11). The random play of tests/models/fight-play.ts now carries every block:
  Brakk holds Pain is Power and 2 Pain and has Violence (a price of all Pain, gated on 1); Sela starts in Crimson Pact and
  has Bloodletting (2 Resonance), Pact (an HP price) and Hemoplague (gated on the Pact, 2 a fight, a delayed hit);
  Mira has a Boundary (an upkeep and an end), Shatter (a zone price) and a Sprite (a summon, 1 a rest); Igris an Easel
  (a turn start trigger, stacks that leave on a move); Wolf A and the Ogre hold 1 Resonance, Wolf B Retribution, the
  Ogre Thorns; the GM's adjust sets uses now and then. The model's new invariants: no count past its cap, at most
  `summons` summons an owner on its side for at most `summonRounds`, at most `zonesPerOwner` zones, no limited ability
  past its uses, an HP price never at the HP it would take, and no fight runs on with a side holding only summons; the
  sheet's keys are compared through `onSheet`. A separate seeded test fires 2,000 random tables of feeding triggers
  (`fire` answers `deepest`) and checks depth 2 and 16 firings.
- Departure, unit 13: the 16 firings are counted per batch of events (`fire` is called once for a use's events, once for
  a turn's end, once for each turn's start), not per command: a command that ends a turn and starts the next can fire
  16 in each. Each batch is bounded, and a command holds a bounded number of batches (its turn's end and the turn starts
  `startTurn` loops through), so a chain still stops. Counting across batches would thread a counter through `after`
  and `startTurn`; no kit comes near either bound.
- Unit 13, random play found a bug: the GM removing a summoner while its summon's turn ran left the fight's current row
  missing (the summon left with its owner). `removeRunning` now starts the next turn when the current row is gone, and
  `startTurn` skips a row its own settle sent away; a case in tests/fight.test.ts ("a timed summon").
- The balance rows after unit 13 are the baseline's, every one (the simulation's printed table, compared line by line).
- Unit 14, the kits are builds of the simulation (`blood`, `mark`, `pain`, `summoner` in `BUILDS`, `KIT_BUILDS`,
  `PLAIN_OF`), each its plain build's body with one ability in its place: the casters' Arc Bolt (`2d6 + mag`), Pain's
  strike. The design's shares were of `1d8 + mag`, the paper's standard curse; the sim's cannon bolts with Arc Bolt, so a
  kit is weighed against what its body plays, and its numbers are shares of that ability (`RULES.fight.kit.examples`).
  A threshold's, a trigger's and an end's formula now read the kits' names (`kitOf`, land.ts): before, Resonance's
  execute read `target.missing` as 0 outside a use. A threshold's burst counts as its user's damage in the sim's tally
  (`byAct`); a summon plays the monster's policy. The old best-use row reads the old builds only (`PLAIN_BUILDS`); the
  kits have their own row, which skips a use with a price (Violence holds no Pain on a fresh body).
- Departure, unit 14: Bloodletting's share is 0.85, not 0.7 (`kit.examples.blood.share`, its reason at the rule and in
  sim-log.md): at 0.7 the kit won 0.195 fewer duels than its plain cannon against a C tank; 0.85 is the one share with
  every kit row inside. The mark caster and Pain needed nothing. Pain's duels are its plain bruiser's exactly: a duel
  ends before 5 Pain, so its rows measure nothing yet; its boss fights use Violence 0.7 times (a measured row).
- Departure, unit 14: the party of the three kits' row (chains stop at depth 2 and 16) is the model's invariant and its
  2,000-table chain test (unit 13), not a simulation row.

## The kits' rows (unit 14), kit less plain build, mean of the two openings, 200 fights an opening

| Kit | C v speed | C v tank | C v cannon | S v speed | S v tank | S v cannon |
|---|---|---|---|---|---|---|
| blood | -0.023 | +0.055 | -0.033 | +0.015 | +0.042 | 0.000 |
| mark | -0.010 | 0.000 | -0.005 | +0.035 | +0.013 | +0.020 |
| pain | 0.000 | 0.000 | 0.000 | 0.000 | 0.000 | 0.000 |

The blood party (tank, bruiser, blood) on a boss: 6.28 rounds at C, 7.30 at S; on a pack: 3.97 and 4.93. The mark
caster's stroke with its bursts is 0.51 of a blast a standard action on a pack. A summoner's party beats a C boss in
5.90 rounds, none capped. The kits' best single use: 0.285 of a C tank, 0.255 at S (a blast). Every old row as at the
start.

## For the makers unit (16) and the parsers unit (15)

- The parsers now read every kit field (`parseStatusDef`: `stack`, `triggers`, `end`; `parseAbility`: `tags`, `prices`,
  `gates`, `summon`, a zone's `upkeep`, `end`, `triggers`), each absent when it has none, so a maker that writes none
  round-trips as before. A trigger with a refund comes back with the limit `round` when written `each` (a maker should
  offer only `round` and `fight` there, or its round trip shows a difference).
- `worn` on a skill and an item is not built (unit 15): a passive's trigger is carried today only by a status on the row
  (the sim's Pain puts its worn status in the row's statuses); `hunterRow` should add each worn status from the hunter's
  skills and worn gear, at its rank (`itemSource` at an item's rarity).
- `describeStatus` says nothing yet of `triggers` or `end`, nor `describeAbility` of `prices`, `gates`, `tags` or
  `summon` (design 5.1's sentences); the worth line is `worth.ts`'s (unit 5).
- The kits' example abilities and statuses live in tests/models/fight-sim.ts (`kitAbilities`, `PAIN`, `painIsPower`);
  design 5.2's built-ins for a GM to copy should be registry entries made from the same numbers
  (`RULES.fight.kit.examples`): Bloodletting at 0.85 of the bolt, not 0.7.

## For the table unit (17)

- The doc carries `stacks` on a status, `left` (the current row's uses left) and a summon's row with `owner`; a player's
  phone should draw them and command its hunter's summon (`onTurn` already takes its moves). `TABLE_REFUSALS` gained
  `gated`, `noUses`, `hp`, `stacks`, `zone`: table.js needs their words.
- `combat.js` must pass the `vitals` effect's `used` to `hunter.setVitals` (and it must write `Vitals.used`), else a
  rest's uses spent in a fight never reach the sheet. The GM's card has no control for `adjust`'s `used` yet.
- A summon is a row of kind `summon` with `holder` null: the GM's card and the map show it with its owner's side; it
  leaves with a log line ("Sprite leaves: its time is up", "fades").

## Checks at the end

- `bun run typecheck`: clean. `bun run test`: 2571 pass, 0 fail (the last full run, unit 14).
- No file under `src/views` changed. `src/core/formula.ts` and `src/edge/roll.ts` were not touched.
