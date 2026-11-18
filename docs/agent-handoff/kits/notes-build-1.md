# Notes: kits, build units 1 to 6 (brief-kits-build-1.md)

## Log

- Start: the worktree was at 8b41075; fast-forwarded to e26b69a (`claude/zen-pasteur-ov4cgd`), which holds the brief.
  Baseline `bun run test`: 2417 pass, 0 fail, 155 s.
- The precise reference numbers of the scalers (the party's rounds of table 3.2, the max-HP ratios of table 8.0.1) were
  printed from a scratch copy of `scripts/kits-paper.ts` (deleted after): E pack 3.140 boss 5.522, bruiser 0.604 / 3.188,
  light 0.644 / 3.400; C 3.200 / 5.665, 0.604 / 3.208, 0.753 / 4.000; S 3.799 / 6.760, 0.599 / 3.198, 0.885 / 4.724.

## Choices where the design was silent or had to bend

- Unit 1, absent is none. Design 1.0 wrote `triggers`, `end` and `stack` as required on every def (`stack: null` on a
  plain one), a `kind` on every status, and `tags`, `prices`, `gates`, `summon` as required on every ability. Built as
  optional fields that are absent when there are none (`stack?: never` on a plain def, `stacks?: never` on a plain
  status). Reasons: the status, item, skill and monster makers (views I may not touch) compare what they wrote with what
  the parser gives back and log a console error on any difference (`canon(def) !== canon(form)` in forge.js, loot.js,
  skills.js, bestiary.js), and every e2e device fails on a console error; a parser that added `stack: null` would break
  every maker test. The codebase already does this for `Ability.zone` and `StatusDef.color`. The compiler still refuses
  `stacks` on a plain status and a threshold on a plain def. A status from a def core did not write itself is built by
  `statusOn(def, fields, stacks)` (seven sites in core, three test helpers). design.md 1.0 corrected.
- Unit 1, the scalers' rules. Beside `SCALE` (start, pairFull, scaleCap, step, scalers) the block holds `reference`, the
  reference dungeon at E, C and S (the party's pack and boss rounds, a normal brute's and a boss's max HP over the user's
  body), so the suggestion and the worth of a scaler a GM typed are worked out in core rather than copied from the
  paper's table. `bound` (design 6's single-use bound) is not a rule here: the paper finds it never binds a suggestion
  (best uses 5 to 25% of a C tank), so the suggestion leaves it out (unit 3). `hpShareMin` (0.01) is table 1.1's floor.
- Unit 1, `Tag` lives in ability-types.ts beside the ability that carries it; triggers.ts imports it.

- Unit 2, the machine has its own module, `stacks.ts` (design 1.10 put `stackStep` in effect-ops.ts, which is past 600
  lines): `Stack` (absent, held n), `StackEvent`, `TABLE`, `stackStep`. effect-ops.ts calls it from `applyStatus`,
  `cureStatus` and `settle`. "Firing" is not a state: a step returns `fired`, as design 2's sketch has it transient.
- Unit 2, `applyStatus` reads no threshold (`at: null`): it is the merge every path uses (the GM's window, a spread, a
  sheet). A use's threshold is read in resolve.ts (unit 6, rule 18a) with the same `stackStep`, so the GM's window adding
  stacks does not set a threshold off. The next unit that wants it there (the GM's `status` command, a spread) calls
  `stackStep` with the threshold's count.
- Unit 2, rule 1.1.7 and the round leave in one settle: the per-round ops pay at the count held as the settle starts,
  then the round's stacks leave. A count the round leave takes to 0 is `spent` (a new list `settle` answers beside
  `expired`), so a future end does not land for it (table 2.2: spent is not ended); the log says "the last X wears off".
- Unit 2, `keep: 'fight'` is enforced at the write-back: `writeBack` sends only `onSheet` statuses to a hunter's sheet,
  while the card (`sheetStatuses` in fight-view.ts) still shows every status with its count.
- Unit 2, parser: a stack rule's numbers are clamped (cap 1 to `stackCap`, a threshold's count 1 to the cap, an area's
  radius 1 to `fieldRadiusMax`, an op's `stacks` 1 to `stackAdd`, a refund 1 to 100%); an unknown leave, keep, then or
  reach refuses the def, as an unknown op does today. A threshold keeps its first `triggerOps` ops.

- Unit 3, `KitScope` rides on the formula's `Scope` as an optional `kit`; absent it reads as `NO_KIT` (no stacks,
  full HP, no kills). Every existing scope (the maker's preview, a status's shield, a settle) keeps its shape; resolve.ts
  fills it for a use at rule 6b (unit 6). The bounds of table 1.5 are applied where the snapshot is built, not in
  `evaluate`, which has no rules.
- Unit 3, a keyed name (`stacks(key)`, `field(key)`, `held(key)`) is one token whose key is read whole, lower case,
  `a-z`, digits and hyphens, at most 40; `Stacks(pain)` is refused with "Write stacks(key)". Only `stacks` has a
  `target.` form; `target.field`, `target.held`, `target.hits`, `target.kills` and `target.spent` are refused.
- Unit 3, the scalers live in a new `registry/scalers.ts` (the family, its text, `scalersOf` reading it back from the
  tree, the means over the reference dungeon, `baseOf`, `againstEach`, `suggestScaler`, `scalerLine`);
  ability-kinds.ts gains `Ticks.scalers`, `suggestedScaler` and `SCALER_CHOICES` and writes the text in `recommended`:
  `core * base * (1 + term + term)`. The base is worked out at C (design table 8.0.2's base column); `ticksOf` reads
  the scalers from the tree first and then checks the whole text as before.
- Unit 3, departure: the bully on a strike is suggested at 0.30, not the design's 0.35. The paper searched with the
  unrounded tolerance (0.081); with the rule's 0.08 the S bruiser against a normal brute is 1.0801 at 0.35, past it. The
  rest of table 8.0.2's suggested column comes out as the design has it. design.md 8.0 corrected.
- For the maker unit (not mine): the formula field needs a "Scales with" control per `SCALER_CHOICES` (at most
  `RULES.fight.kit.scalers`), filled from `suggestedScaler(kind, name, R)`, its start and scale typed over and passed
  in `Ticks.scalers`; the warning reads `againstEach(scalers, kind, rank, R)` at E, C and S against `1 + tolerance`;
  `describeAbility` now needs the ability's `effect` to say the scalers' lines (skills.js already passes the ability).

- Unit 5, the yardstick is the kind's own recommended standard formula read by the kind's paper build (`BUILD_OF`:
  strike the bruiser, shot the speed build, curse and blast the cannon, support the support) on a same-rank normal
  brute, at C by default. So a recommended ability is worth exactly its pace's share, a support's `1.5 * sup` included
  (design 3 names `1d8 + power`, which is the damage kinds' standard). `referenceBody` copies the paper's `sheet()`
  (points split two to one, the rank's perk points on the main stat); the mode credit (0.43, 0.40, 0.40) and the HP
  rate (0.064, 0.025, 0.011) come out as table 3.5 and 3.4 print them, which checks it.
- Unit 5, departure on a stacking per-round op: an ability is charged per stack it adds (`statusWorth(def, k, ...)`),
  not at the def's cap; the cap is what the status maker passes when it shows a def alone (design table 3.4's "the
  maker shows it at the cap"). Charging every 1-stack application at the cap would put Rot at 2 SA a use. design 3
  corrected.
- Unit 5, rules added: `kit.referenceRounds` (6, design 6's reference fight, for a status that lasts until removed) and
  `kit.eventRates` (table 3.3's C bruiser row, with upper bounds where the table has no row). A status's stat, speed,
  hold and the other ops without a worth rule in design 3 add nothing; a land share at parity is 0.55 for a direct use
  (`resistDc`) and 1 for travel and sure (an upper bound).

- Unit 6, what resolve does now: rule 3b `gated` (the `holds` gates; the body at the aim for `on: 'target'`, refused
  when nobody stands there); rule 4 `payPrices` after the mana (HP, refused at `hp <= price`, past the shield; the
  user's own stacks, refused under `n` or with none for `all`); rule 6b `snapshot` after the prices (each body's stacks
  and lost share, the field, rounds held, bodies hit, all clamped to their rules); rule 10a `targetPrices` after the
  avoid, so a target that got out gives nothing; rule 18 adds an op's stacks and a cure takes its `stacks`; rule 18a
  `crossed` then `landThreshold`. `Resolved` gains `bursts` (who, which status, what each body took), and fight.ts logs
  them in the use's line. New refusals: `gated`, `hp`, `stacks`.
- Unit 6, left for the units that own the state: the `uses` gate counts on the row's `used` (unit 11: no `Body.used`
  yet, so it does not refuse); a zone price needs the fight's zones and ends with a payoff (unit 9); `kills` reads 0
  until a row counts its kills (`Body.kills`, with the triggers unit 7). The doc's `TABLE_REFUSALS` does not list the
  three new refusals yet (unit 12), so a player's phone sees no reason for them. A channel pays its prices on release
  (begin pays mana and fatigue only), once.
- Unit 6, `spent` with both kinds of stack price is the sum of what the user's and this target's prices took (design 1.5
  says "from this target, or from the user"; the sum is the reading that holds when an ability has both).
- Unit 6, a threshold's ops land at their averages from the status's source: a hit through defence (rule 12) and the
  shield (13), no threat, stagger or channel rule; a status it puts on sets off no further threshold here (the
  triggers unit owns a chain's depth); a refund is not read (time back belongs to the bearer's own turn). An area
  threshold's side is read from the bearer's, and the bearer is inside when its side is named (Hwei's mark lands on the
  marked foe and its friends within 2).

## Unit log

- Unit 1 (rules and types): `RULES.fight.kit`; `StatusDef` and `Status` unions, `StackRule`, `Threshold`, `Reach`, `End`,
  `LandOp` (effect-ops.ts); `Trigger`, `BearerEvent`, `Party`, `Limit` (new triggers.ts, types only); `Tag`, `Price`,
  `Gate`, `Summon` (ability-types.ts); `DOC_ROWS` 30 (the doc test's row count now follows it). Test: tests/rules.test.ts,
  "the kits' rules".
- Unit 6 (resolve): rules 3b (`gated`), 4 (`payPrices`), 6b (`snapshot`, `kitFor`), 10a (`targetPrices`), 18 (stacks)
  and 18a (`crossed`, `landThreshold`, `Burst`) in resolve.ts; fight.ts logs a burst. Test: tests/resolve.test.ts ("the
  kits' rules of a use").
- Unit 5 (worth): registry/worth.ts (`referenceBody`, `hpRate`, `hpPriceWorth`, `modeCredit`, `thresholdWorth`,
  `landShare`, `statusWorth`, `abilityWorth`, `wornWorth`, `worthLine`); rules `kit.referenceRounds`, `kit.eventRates`.
  Test: tests/worth.test.ts (tables 3.4 and 3.5 as expected values).
- Unit 4 (rest uses): `Vitals.used` (ability id to uses spent this rest), kept by every vitals change, cleared by a
  long rest, `usedOf`, `parseUsed` (clamped 1 to `fightUses`, at most 60 ids) and its repair line in save.ts `fixVitals`.
  Tests: tests/vitals.test.ts ("uses spent this rest"), tests/save.test.ts.
- Unit 3 (formula names and scalers): `stacks()`, `field()`, `missing`, `held()`, `hits`, `kills`, `spent` (formula.ts,
  `KitScope`, `NO_KIT`; fight-parse.ts reads them); registry/scalers.ts and `Ticks.scalers`. Tests:
  tests/formula.test.ts ("the kits' names"), tests/ability-kinds.test.ts ("the conditional scalers").
- Unit 2 (stacks): stacks.ts and its chart (scripts/charts/stacks.ts, `MACHINES`, tests/models/stack-events.ts);
  `applyStatus` adds stacks, `cureStatus` takes n, `modsOf` and staggerRate per stack, `Due.stacks` and `dueAmount`,
  the round leave in `settle`, `SheetStatus.stacks`, `addSheetStatus`, `onSheet`; `parseStatusDef` reads `stack`,
  `parseOp` an apply's and a cure's `stacks`, `parseSheetStatus` and a row's status their count; a hunter's row and
  sheet carry a condition's stacks; `describeStatus` says how it stacks. Tests: tests/effect-ops.test.ts ("a stacking
  status", "the stack machine, cell by cell").
- Close: AGENTS.md rows (the kits' formula names, the scalers, worth, a stacking status, prices and gates) and recipes
  (a formula input, a price or gate kind, a scaler), the machines line names stacks.ts; `bun run deps -- --write`,
  `bun run charts`.

## Which principle changed a choice

- type-system-discipline: a plain def cannot hold `stack` and a plain status cannot hold `stacks` (`never`), and
  `statusOn` is the one constructor from an unknown def; a `Tag` is branded.
- model-the-domain: the count is a machine with a `TABLE` (stacks.ts) that every path calls, and a threshold is a cell
  of it, so "fired" is never stored.
- explain-the-number: the scalers' suggestions are searched in core from the reference dungeon's numbers, not copied
  from the paper's table, which is how the bully-on-a-strike difference (0.30 against 0.35) came out with its cause;
  the worth's mode credit and HP rate reproduce tables 3.4 and 3.5, which checks the reference bodies.
- prove-it-works: the balance rows are the baseline's to the third decimal after every unit (speed over cannon at C
  0.606, the C boss fight 6.476 rounds, the status build 0.968): nothing built in uses the new blocks.

## Checks at the end

- `bun run typecheck`: clean. `bun run test`: see the reply (the last line of the full run).
- The balance simulation: every row as at the start (above).

