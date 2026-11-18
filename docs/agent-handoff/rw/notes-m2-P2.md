# Notes of unit P2, the hunter's sheet

Worktree `.claude/worktrees/agent-ae261b6318179d378`, branch `worktree-agent-ae261b6318179d378`, from a31d4d5.

## A file outside the unit

`docs/dependency-map.md` is regenerated (`bun run deps -- --write`): the new core module adds a node and six import
edges, and `tests/deps.test.ts` fails on a stale map. P1 and P6 regenerate the same file, so the lead reruns the command
after merging instead of merging the text.

## What I made

`src/core/hunter/sheet.ts` (143 lines), pure, new file. Exported names:

- `SheetHunter`: the fields of a schema 4 hunter the file reads (`stats`, `level`, `rank`, `fatigue`, `penalty`,
  `hpAdj`, `manaAdj`, `titleId`, `titles`, `items`, `equipped`, `build`, `skills`, `conditions`). Structural, so W2's
  `Hunter` satisfies it unchanged.
- `SheetItem`, `SheetSkill`, `SheetCondition`: an item, a skill and a condition as the sheet reads them.
- `SheetPath`: a path as `{ alloc, tiers: readonly (readonly Bonus[])[] }`.
- `SheetRules`: `DeriveRules` plus `rankBonus`, `fatigue`, `penaltyCheck`, `build.enabled` and `paths` as `SheetPath`s.
  Today's `Rules` is assignable to it (a test passes `RULES`).
- `buildOf(h, R): Build`: the spent stats, the level, the worn items as `GearPiece`s, and one `perks` sum of the active
  title, the worn items' `bonus`, the path picks the rank has opened, the passive skills' `bonus`, and `hpAdj` and
  `manaAdj` as `hpMax` and `manaMax`.
- `hunterSheet(h, R): { stats, sheet }`: `modified` of the hunter's build under its conditions.
- `checkBonus(h, stat, R)`: `floor(x(stat) / 2) + rankBonus - fatigue penalty - daily penalty`, on the stat after perks
  and conditions.
- `autoSpend(h, path, R)`: today's `allocPlan` (`custom.js:274-279`) on the eight stats; answers points per stat.

`tests/sheet.test.ts`, 20 tests: buildOf 6, hunterSheet 6, checkBonus 5, autoSpend 3. Expected curve values are worked
by hand from design 2.1 (each with its working in a comment); rule numbers are read from `RULES` by name.

Lines: 143 added in `sheet.ts`, 169 in the test, none removed (new files only; `hunter.js`'s `derived` and `bonusOf`,
`inventory.js`'s and `skills.js`'s `bonuses` and `custom.js`'s `allocPlan` die in W4).

## Choices (the plan is silent here)

- **The path picks are read from `R.paths` inside `buildOf`** (the plan's signature has no path argument), through
  `SheetRules.paths`, typed as tiers of `Bonus`, not today's `Path`. A path the rules no longer have, or builds turned
  off (`R.build.enabled` false, as `perkSkill` treats it today), counts no perks. `autoSpend` takes the path itself, as
  the plan's signature says.
- **`autoSpend` takes the full `Rules`**, because the free points come from `available` in `progress.ts`, which takes
  `Rules`. When W2 adds the 12 creation points to `levelPoints`, Auto follows with no change here. The test's hunter
  spends `levelPoints(RULES, 1)` so it stays right after W2.
- **The fatigue penalty starts at `penaltyAt` percent of the sheet's `fatigueMax`** (plan 1.2's decision applied to the
  check). W2 owns `vitals.ts`; if it adds a "past the penalty share" function there, `checkBonus` should call it.
- **A condition becomes a `Status` with no fight time** (`until: null`, `since` and `settledAt` 0) to go through
  `modified`, which reads only `def` and `source`. A one-line change would remove the adapter: `modsOf` and `modified`
  in `effect-ops.ts` taking `readonly Pick<Status, 'def' | 'source'>[]`. Not mine to make.
- **Item fields `weight`, `armor`, `resist`, `penFlat` and `bonus` are optional in `SheetItem`**: a field the item lacks
  adds nothing. Plan 3.3 does not say whether a consumable carries them.
- **An item's equip ops are not read.** Today `inventory.js:79` adds old `mod` ops to the sum; plan 3.3 gives worn
  items only `bonus` and the new gear numbers. If W1b keeps a `stat` op on a worn item, `buildOf` needs a line for it.

## For the next units

- **W2: delete `perkSkill` (`save.ts:531-548`).** `buildOf` reads the path picks itself; a path's passive skill marked
  `perk` would count its bonus twice.
- **W4:** `derived().fatigueDis` (disadvantage from `disAt`) has no home here; `dice.js` still needs it. It belongs
  beside the fatigue penalty share in `vitals.ts`.
- **P5:** `buildOf(h, R)` is the hunter's `Origin` build: `{ kind: 'hunter', build: buildOf(h, R) }`.

## Principles

- boundary-discipline: no check of the hunter's fields; the save's parser is the boundary. The one `?? 0` per gear field
  is the meaning of an optional field, not a repair.
- minimize-reader-load: `buildOf` is the one sum of a hunter's bonuses (today four: `bonusOf`, two `bonuses`
  providers and the perk skill). It changed one choice: I read the path from the rules inside `buildOf` instead of
  adding a second path argument, so a caller never has to know where the perks come from.
- test-behavior: the expected values are hand-worked from the curve and the rules, and each test fails if its source
  of bonuses is dropped from the sum.

## Checks

- `bun test tests/sheet.test.ts`: `Ran 20 tests across 1 file. [14.00ms]` (20 pass, 0 fail).
- `bun run test`: `Ran 2035 tests across 54 files. [90.92s]` (2031 pass, 4 todo, 0 fail; the typecheck before it is
  clean).
- `bun run build`: `Built 12 files into dist/ (build a046934d3478)`.
