# Unit 1 notes: `space.ts` and `timeline.ts`

## Progress

- Step 1: the types of both modules, typecheck green.
- Step 2: `timeline.ts` functions and `tests/timeline.test.ts` (33 tests). Breaking the tie rule's speed or tie step, the
  slow's ratio, the refund floor or the opening's cap at 20 by hand each fails at least one test.
- Step 3: `space.ts` functions and `tests/space.test.ts` (29 tests). Breaking the 5-10-5 half, the second diagonal's
  cost of 2, the wall-corner rule, the y-then-x order, the non-piercing stop, out-before-ring or the radius bound by
  hand each fails at least one test. A new `Shape` member or a missing `TERRAIN` row fails the typecheck.
- Step 4: `bun run typecheck` is green, and `bun test tests/space.test.ts tests/timeline.test.ts tests/lint.test.ts`
  ends with `Ran 83 tests across 3 files.` (83 pass, 0 fail).

## What each module exports

`src/core/combat/timeline.ts`

- `Tick`, `Cost`: branded numbers for fight time and an action's cost in hundredths of a standard action. `tick`, `cost` make them.
- `Pace`: quick, standard or heavy. `paceCost(pace, rules)` is its cost.
- `TimelineRules`: `round` (1000), `cost` per pace (70, 100, 150), `moveCost` (100/6).
- `Clock`: what the timeline reads from a row: `id`, `at`, `speed`, `tie`. Every function is generic over a row that has these, so a later reducer passes its own rows and gets them back.
- `walkCost(steps, rules)`: the cost of walking that many tiles, `round(100 * steps / 6)`.
- `interval(speed, cost, rules)`: `round(1000 * cost / speed)`.
- `opening(now, speed, roll, rules)`: the first `at`, at the start or when joining at `now`. `roll` is the d20 plus the Instinct bonus.
- `before(a, b)`: the tie rule, as a boolean.
- `next(rows)`: the row whose turn starts next.
- `acted(row, now, cost, rules)`: `at = now + interval`.
- `ahead(rows, n, rules)`: the next `n` turns if everyone takes standard actions, each row as it is when its turn starts.
- `withSpeed(row, now, speed)`: a new speed, with the wait left rescaled by old over new.
- `stunned(row, now, duration)`: the floor `max(at, now + duration)`.
- `delayed(row, ticks)`: `at + ticks`.
- `refunded(row, now, spent, pct)`: the extra-turn refund, at least `now + 1`.
- `roundOf(now, rules)`: the round number for the log prefix.

`src/core/combat/space.ts`

- `Tiles`, `Percent`, `Place`: branded. `tiles`, `percent`, `place` make them. A `Place` has `x` and `y`; a `Grid` has `w` and `h`, so the two cannot be swapped.
- `Shape`: self, touch, line, radius with an optional ring, as design 3.3 has it.
- `Terrain` and `TERRAIN`: floor and wall, each with its map character, whether a body may stand on it and whether it stops a line. A new terrain is a member and a row; the typecheck asks for the row.
- `Grid`: `w`, `h` and `tiles` (row by row, or `null` for open floor). `openGrid(w, h)` makes an open one.
- `SpaceRules`: `tileFeet` (5) and `lineGap` (8).
- `Side`, `Cover` (`hit` and `ring` tiles), `Dodge` (caught, ring or out), `Reach` (a tile and its steps).
- `dist(a, b)`: the 5-10-5 distance. `feet(t, rules)`: tiles in feet.
- `tilesOf(shape, from, aim, grid)`: the tiles a shape covers, an exhaustive switch.
- `inShape(shape, from, aim, grid, bodies)`: the bodies in `hit` and in `ring`; a non-piercing line keeps only the first.
- `defaultPlace(side, taken, grid, rules)`: the first free tile of the side's line, or null.
- `reachable(from, limit, grid, bodies)`: every tile a walk reaches within `limit` steps, with its fewest steps.
- `pathCost(from, to, grid, bodies)`: the fewest steps to a tile, or null.
- `dodge(at, can, cover, grid, bodies)`: rule 8a, `{ avoid, to }`.

## Where the design was unclear, and what I chose

- **Rule 8a's "else the nearest to out".** The same rule ends with "if caught, it stays". So the tile nearest to out is never used: a caught target does not move. I left that ranking out (laziness-protocol), and `dodge` answers `{ avoid: 'caught', to: at }`. If a later unit wants to draw where a caught target leaned, the ranking is one more sort key in `dodge`.
- **Rule 8a ranks ring tiles only by steps, y and x**, not by how near they are to out. I followed the words.
- **How a line is drawn on tiles.** The design says "every tile on the line from the user to the aim". I take one tile per step along the longer axis and round the shorter axis, with a half rounding up (`Math.round`). The line starts on the tile after the user and ends on the aim. `width` spreads across the shorter axis. A wall tile stops the line (design 5.3, "a wall blocks a line").
- **The first body on a wide non-piercing line.** The first body in the line's order from the user. On one step of the line with two bodies side by side, the one at the lower `x` or `y` comes first.
- **A diagonal step between two walls.** The design says a walk "cannot cross a body or a wall" and says nothing about corners. Without a rule a wall drawn on a diagonal would leak. I forbid a diagonal step when both tiles beside it are walls; one wall at a corner does not stop it. Bodies never block a corner.
- **Walking cost with obstacles.** Steps are counted as the 5-10-5 distance counts them (every second diagonal costs 2). The search keeps whether the walk has made an odd number of diagonal steps, so on open floor a walk costs exactly `dist` (a property test checks this).
- **Bodies.** Every function that walks takes the other bodies' places; the mover's own place is not in that list.
- **A full default line.** `defaultPlace` returns null when the side's line has no free walkable tile (more than 20 on a side on the default grid). The design does not say where the 21st stands. The reducer or the GM decides.
- **A radius ignores walls.** No line of sight (the brief's laziness rule). A wall tile inside a blast is listed in `hit`; nothing stands on it.
- **The speed clamp of 40 to 250** is not in `withSpeed`. Design 2.2 puts it in `derive`, which hands the timeline a speed that is already clamped.
- **The opening roll.** The design's formula caps `d20 + bonus` at 20 and has no floor; the paper script also floors the d20 at 1. A d20 is at least 1 and the bonus at least 0, so I kept the design's formula.
- **`Percent` lives in `space.ts`** because `Shape`'s ring needs it. `refunded` takes its percent as a plain number to keep the timeline from importing a type it has no other use for. `timeline.ts` imports only the `Tiles` type from `space.ts`, for `walkCost`.

## Which principle changed a choice

- type-system-discipline: `Cost` is branded as well as `Tick`, so `interval(speed, cost, rules)` cannot take its two numbers in the wrong order. `Place` is branded, and `Grid` uses `w` and `h`, so a size is never read as a place.
- model-the-domain: terrain is one table, `TERRAIN`, with a row per kind (walk, stops a line, map character), not two functions that each switch on the kind. The test's drawn maps read their characters from it.
- foundational-thinking: every timeline function is generic over `Clock`, so the reducer of unit 7 passes its own combatant rows and keeps every other field without a second type.
- boundary-discipline: no function checks that a place is inside the grid or a speed is positive. The tests build their inputs with the trusted constructors.
- laziness-protocol: the nearest-to-out ranking and a wrap of a full default line onto a second row are left out. `SpaceRules` has no grid size, because nothing here reads it.
- test-behavior-not-implementation: every expected number is typed in from the design or the paper script's tables (1.1 to 1.5, 4.7, 5.1, 5.2) or worked by hand from the rule. One hand-drawn picture was wrong the first time (the corner blast); I re-derived it from the distance rule, not from the output.
