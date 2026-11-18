# Unit 2 notes: the eight stats, `RULES.fight`, `formula.ts` and `derive.ts`

## Progress

- Step 1: `src/core/stats.ts`, `RULES.fight` in `src/core/rules.ts`, the types of `src/core/hunter/derive.ts`. Typecheck green.
- Step 2: `src/core/formula.ts` and `tests/formula.test.ts` (33 tests). `bun test tests/formula.test.ts` green, typecheck green.
- Step 3: `sheetOf`, `monsterSheet` and their helpers in `derive.ts`; `tests/derive.test.ts` (61 tests), `tests/stats.test.ts`
  (7 tests) and the override case in `tests/rules.test.ts`. All green, typecheck green.
- Step 4: `scripts/rw-paper.ts` reads `RULES.fight` and calls `derive.ts`, `stats.ts`, `timeline.ts` and `space.ts`. Its output
  before and after, diffed: identical (`diff` printed nothing).
- Step 5: `bun run deps -- --write` regenerated `docs/dependency-map.md` (it also picked up unit 1's `space.ts` and
  `timeline.ts`, which the committed map lacked). `bun run test` ends with `Ran 1832 tests across 47 files. [30.33s]`
  (1832 pass, 0 fail).

## What each module exports

`src/core/stats.ts`

- `STAT_KEYS`, `StatKey`, `Stats`: the eight stats and a score for each.
- `STAT_LABELS`: Strength, Agility, Vitality, Instinct, Discipline, Presence, Power, Control.
- `CurveRules`: `statBase`, `effExp`, `half`. `RULES.fight` satisfies it.
- `baseStats(R)`: every stat at its base.
- `eff(s, R)`: `base * (s / base) ^ 0.8`, a score under 1 counted as 1.
- `above(s, R)`: the design's `x(s)`, `eff(s) - base`.
- `capped(x, cap, R)`: `cap * x / (x + half)`, and `cap * x / half` below 0.

`RULES.fight` in `src/core/rules.ts`, typed `FightRules`: time, stats, the Sheet, kits, monster kinds, defence, reaction,
channel, threat, stagger, shield and space, each number with its reason as a comment. It satisfies `TimelineRules` and
`SpaceRules` (a test assigns it to both). A GM's override goes through `parseOverrides` with no change to it.

`src/core/formula.ts`

- `Formula`: number, dice, `stat` and `sheet` (each with `whose`, the user or the target), `charge`, `negate`, `binary` (`+ - * / ^`), `min`, `max`.
- `parseFormula(text, rules)`: `{ ok: true, formula } | { ok: false, error }`. `rules` gives the dice limits (`Rules` satisfies `FormulaRules`).
- `evaluate(formula, env)`: `env` is `{ user, target, charge, dice }`, each side `{ stats, sheet }`.
- `diceOf(formula)`: the dice terms in reading order. `mean(dice)`: `count * (sides + 1) / 2`.
- `average(formula, scope)`: every dice term at its mean.
- `printFormula(formula)`: text with only the brackets it needs; parsing it gives the same tree.

`src/core/hunter/derive.ts`

- `Sheet`, `SheetKey`, `SHEET_LABELS`: the 26 numbers and their names. `SHEET_LABELS` is the one runtime list of `Sheet`
  keys: the typecheck asks for a label for a new field, and the formula parser reads its names from it.
- `Share` and `share()`: a branded 0 to 1 number, used for `pen`, `hold` and `costCut`. `stride` is `Tiles`.
- `GearPiece` (`weight`, `armor`, `resist`), `Bonus` (perks on stat or `Sheet` keys), `Build` (`stats`, `level`, `gear`, `perks`).
- `StatusMod`: `{ op: 'stat', key, amount } | { op: 'speed', pct }`, the seam for unit 8.
- `Archetype`, `ARCHETYPES`, `Kit`, `MonsterKind`, `DeriveRules`.
- `kitGear(kit, R)`, `pointsAt(level, R)`, `split(main, second, points, R)`: a kit as gear, a body's points, a 2:1 split.
- `sheetOf(build, R, mods = [])`: a hunter's sheet.
- `monsterSheet(rank, archetype, kind, R, mods = [])`: a monster's, and a shadow's (the sheet of the monster it came from).

## Where the design was silent or disagreed with itself, and what I chose

- **The paper's table against the design's words.** Design 2.4 says a monster has "no creation points", but table 2.6,
  which the design cites, gives it the creation points in its 2:1 split, and the design's normal power is 0.8 where
  `PAPER` has 0.7 (3.5's "a C skirmisher's 55 HP" is also stale; the table says 48). The brief makes `PAPER` the source,
  so the code follows the tables. design.md is not in my file list; its 2.4 and 3.5 text and its "the constants are the
  table `PAPER`" line need the lead's edit.
- **Stride.** 2.2 says `floor(move / 2)`, 4.6 and the script `ceil(move / 2)` with at least 1. The script's rule, as
  `strideShare: 0.5`, so the output did not change.
- **The parse error.** The brief's `{ ok: false, error }` over the design's `{ ok: false, at, message }`; the position
  is in the message. `parseFormula` takes a second argument with the dice limits, because a GM may override `dice`.
- **`-2^2`.** The design's grammar binds the minus before `^`, so `-2^2` is 4 (as a spreadsheet reads it, not as
  Python does). The test pins it. If the owner wants -4, the grammar line becomes `unary = "-" unary | power`.
- **A non-finite step.** The design says only "division by 0 is 0". One rule covers it: any step whose result is not a
  finite number (x / 0, 0 / 0, a root of a negative number, an overflow) is 0, and the rest of the formula still counts.
- **Dice in `env`.** The design does not say whether a dice term gets one number per die or its total. One number per
  dice term, its total, in reading order. Limits as `dice.js` has them today: 1 to `maxDice` dice of 2 to `maxSides` sides.
- **Names.** Read without regard to case (`STR`, `Target.HPMAX`). `target.charge` is refused: charge is the user's
  channel. `d6` alone is refused with "write 1d6".
- **The Sheet's fields.** The 26 of the paper's `Sheet`. `weight` is in (the sheet shows it against `carry`); the load
  factor is not, since nothing outside `derive` reads it. The design's table has the load factor and no weight row.
- **Monster kinds.** One row per kind: `hp`, `power`, `stagger` (the bar in same-rank hits, 0 for none) and `control`
  (1, 0.75, 0.5, from 3.1 rule 18 and 4.2; the script had 0.75 and 0.5 written in table 4.4). A kind's power factor
  scales `sup` as well as `phys` and `mag`; the script left `sup` unscaled, and nothing it prints reads a monster's `sup`.
- **What stays out of `RULES.fight`.** `GAUGE_STEP` (variant (a), not chosen), `BODY` (nothing read it; deleted),
  `DOC_MAX` (server.ts's own constant; the script keeps a copy with the citation), and `FIGHT_REST`, `BLAST_MANA`,
  `FIGHT_ROUNDS`, `TARGET_SHARE` (section 6 only; rest and ability costs belong to later units). `LEVEL`,
  `POINTS_PER_LEVEL` and `TIER_BUDGET` already had homes (`RULES.rankLevels`, `RULES.pointsPerLevel`, `TIER_BUDGET` in
  `registry/paths.ts`), and the script reads those. The stagger rules not in `PAPER` (a weak hit is under a third of a
  same-rank hit, the bar regrows 50%) wait for the unit that uses them. `statBase: 10` is new: "every stat starts at 10",
  and the curves read it.
- **The status seam.** Design 3.3 defines `stat { key, amount }` and `speed { pct }` and says both work through
  `derive`, so `StatusMod` has those two and `derive` applies them: a stat change adds to the stat, and speed percents
  add up and multiply the speed before the clamp (summing is my choice). `root` is not in it; the design does not route
  it through `derive`.
- **Perks.** A `Bonus` on a stat key adds to the stat; one on a `Sheet` key adds where that number is worked out,
  before it is rounded or clamped and before any number that reads it (a carry perk lifts a heavy kit's speed).
- **No rank in `Build`.** Nothing in `derive` reads it; the rank decides which perks are open, and the caller sums them.
- **The shadow.** The design gives no body for a shadow. Its sheet is the sheet of the monster it was extracted from,
  so there is no separate function. Today's 10% HP a shadow level is not carried over.
- **Gear penetration.** 2.3 lets an item carry `pen` and `penFlat`, but 2.2 has no `Sheet` field for flat penetration
  and no rule for how an item's `pen` meets the Control cap of 0.4. `GearPiece` has weight, armor and resist only.
  Rule 12 of 3.1 needs the user's `penFlat`; unit 6 or 11 has to decide where it lives.
- **Floors from the script.** A score under 1 counts as 1 in `eff`. Crit faces, crit size, the opening bonus and the
  cost cut never fall below their base when a stat is lowered; the other capped numbers do, as 2.1 says.

## Which principle changed a choice

- model-the-domain: the monster kinds are one table with a row per kind, not the paper's separate `MONSTER` and `STAGGER`.
- type-system-discipline: `Share` for the three shares and `Tiles` for the stride. A formula name is resolved at parse
  time into a `stat` or `sheet` node with a typed key, so `evaluate` indexes the body with no string lookup.
- foundational-thinking: `SHEET_LABELS` is the one table of `Sheet` keys; the parser, the paper script and the tests read it.
- boundary-discipline: `evaluate` checks nothing; the parser is the boundary. The one `?? 0` is for a dice entry the
  type cannot promise.
- subtract-before-you-add: the script's own `eff`, `capped`, `derive`, `Sheet`, `STAT_KEYS`, `interval`, `opening`,
  tie rule, distance and default places are gone, and `PAPER` keeps six numbers that have no home in `src/core`.
- laziness-protocol: no `shadowSheet`, no rank in `Build`, no `root` in the seam, no load factor field.
- test-behavior-not-implementation: the tables are typed in from the paper's printed output. Two hand values were wrong
  the first time (mana at Power 33 is 19, not 20; the speed build's 60% is its physical power, not its hit with dice);
  I re-derived both from the rule, not from the code's output.
- explain-the-number: each `RULES.fight` number carries its reason from the design.

## The check

`bun run typecheck` green. `bun run test`: `Ran 1832 tests across 47 files. [30.33s]` (1832 pass, 0 fail).
Paper diff: `bun scripts/rw-paper.ts` before step 4 and after, `diff` printed nothing.
