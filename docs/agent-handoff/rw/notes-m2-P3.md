# Notes of unit P3, the fight screen's model

Worktree `/home/user/systemgaming/.claude/worktrees/agent-a8c7bed76d725cb1a`, branch `worktree-agent-a8c7bed76d725cb1a`, from 9ea4203. Commits 2a16e9c (the module), 2f5b9fa (the tests), and the commit holding these notes.

## For the lead first: rules 5 and 6 are restated, not called

`aims` needs resolve.ts's rule 5 (`inRange`) and rule 6 (`whoIsIn`) on rows that are not `Body`s (the room doc's rows). `inRange` is typed on `Body`, and `whoIsIn` is private. I tried the smallest change to `resolve.ts`: export `whoIsIn` as a generic over `{ side, place }` with the caller passing the bodies on the map, and widen `inRange` to `Pick<Ability, 'aim' | 'range'>` and `{ place }`. The permission check refused it, because my prompt names new files only. So `aims` restates both rules in a few lines, each naming its rule in a comment. A test holds them to the fight's own code: on a real fight, every strike `aims` marks out of range is refused by `reduce` for `range`, and the shot's `inShape` matches exactly the ids `needs` asks dice of. **Suggested follow-up:** make that change to `resolve.ts` and call it from `aims`. The test stays as it is.

Nothing outside the unit's files changed.

## What I made

`src/core/combat/fight-view.ts` (125 lines), pure, imports only from core:

- `order(f, n, R): Turn[]` gives the next `n` turns of a running fight with the current turn first: `ahead` over the rows that are up, each as `{ row, at, round }`, with `round` from `roundOf`, the log's `R` number. A fight in setup or ended gives `[]`.
- `cardOf(f, row, R): Card` gives HP, mana and fatigue with the sheet's maxima, the shield amount or null, the stagger bar rounded to whole points, the statuses as `sheetStatuses` gives them (rounds left in tenths, null until removed), and `down`.
- `Spot = { id, side, kind, place, down }` is what aims and steps read. `spotOf(body)` makes one from a fight row. A room doc row with these fields is a spot as it is.
- `aims(spots, by, ability, grid): AimAt<T>[]` lists the candidates nearest first, each with `{ target, dist, inRange, inShape }`. A self ability gives the user only. An ally ability gives the user's side on the map. A foe or place ability gives the other side on the map. The input type is generic, so `table.js` gets its own doc rows back. The ability parameter is `Pick<Ability, 'aim' | 'range' | 'shape' | 'foesOnly'>`.
- `stepToward` and `stepAway(spots, by, target, stride, grid): Reach | null` pick the tile nearest to or farthest from the target among `reachable` within the stride, around walls and the bodies on the map. Ties go to the fewest steps, then the lowest `y`, then `x`, because `reachable` is already in that order and only a strictly better tile replaces the best. The result is null when no tile beats standing still, so the view hides the button rather than sending a `move` the fight refuses as `noMove`.

`tests/fight-view.test.ts` has 24 tests. Lines added: 381 in 3 files (with these notes at the first count), none removed. Nothing in my files became dead.

## Choices where the plan was silent or differed

- **Signatures take the rules.** `order(f, n, R)` and `cardOf(f, row, R)`, not `order(f, n)` and `cardOf(row, now)`. `ahead` needs `R.fight` and the rounds left need `R.fight.round`. `cardOf` takes the fight rather than `now`, because a fight in setup has no `now` (the reducer reads it as 0) and otherwise the view would have to branch on the phase.
- **A spot has `kind`.** The plan says `{ id, side, place, down }`. A hunter that is down still lies on its tile and can be healed, but a monster or shadow that is down is gone from the map (`present` in fight-turn.ts, `alive` in resolve.ts), and `down` alone cannot tell them apart. The doc row of plan 1.3 has `kind`.
- **The card shows the row's shield as it is.** The reducer drops a shield at the first turn start after its end, and `now` moves only there, so a row never holds a shield that has ended. I first wrote a check on `until`, found no fight that could reach it, and removed it.
- **The card keeps a status that has ended but still owes a per-round payment**, at 0 rounds, as the sheet's write-back does. It goes at its bearer's next turn.
- **Stagger is rounded to whole points** (`Math.round` on fill and max). The fill of a weak hit is fractional (9 times 1.5 is 13.5). P4's doc also carries stagger. One of the two should call the other so the room shows the same number as the GM.
- **Taunt (rule 2) is not in `aims`.** A spot carries no statuses, so a taunted user's other targets show as aimable and `act` refuses them with `taunted`. W5 can show the refusal.
- **Aims are sorted by distance, then in the order given** (join order). The plan's tie rule is for tiles, not for a list of targets.

## For the units after this one

- **P4:** the doc's `ahead` (8 ids) can be `order(f, 8, R).map(t => t.row.id)`, so the GM's order and the players' order come from one function. The same goes for the stagger rounding above.
- **W5:** `aims(f.rows.map(spotOf), currentId, ability, f.grid)`, then `needs`. For a step use `stepToward(f.rows.map(spotOf), currentId, foeId, row.sheet.stride, f.grid)` and send `move { to: step.place }`. One test checks that the fight takes that move.
- **W6:** the doc carries no stride. A player's phone needs its own hunter's stride under its statuses (a slow shortens it). Either the doc row carries `stride`, or `table.js` works it out from `sheet.ts`, which would miss a slow from the fight. I suggest the doc row carries it (P4 or W3). The doc's grid is `{ w, h }`, so build a `Grid` as `openGrid(w, h)`.

## Principles that changed a choice

- **minimize-reader-load.** Each number has one source, named in the header and in each function's comment. I removed the shield's `until` check because no reader could ever see it act.
- **encode-lessons-in-structure.** The restated rules 5 and 6 are held by a test against `reduce` and `needs`, so a change to resolve.ts fails here, not on a phone.
- **test-behavior-not-implementation.** Expected values come from the rules: 9 from rule 12, 8 fatigue from the strike's rule number, 13.5 from a weak hit's 1.5, 1.3 and 0.3 rounds from 1340 ticks, 5-10-5 distances, steps worked out by hand from `reachable`'s rule. I broke the module eight ways on purpose: a tie keeping the later tile, no `foesOnly` filter, range by `<`, down rows in the order, every spot on the map, stagger floored, statuses read at time 0, and a step of 0 tiles offered as a step. Each made at least one test fail. The file was restored after each.

## The checks

- `bun test tests/fight-view.test.ts`: `Ran 24 tests across 1 file. [44.00ms]`, 0 fail.
- `bun run test`: `Ran 2106 tests across 57 files. [115.52s]`, 2101 pass, 4 todo (from before this unit), 1 fail. The typecheck step passed.
- The one failure is `tests/deps.test.ts` "the committed dependency map is what bun run deps -- --write writes". The cause is only the new module. `bun run scripts/deps.ts` diffed against the committed map shows only the `fight-view.ts` entry and its "Imported by" lines (97 modules, not 96). The lead regenerates the map after merging, as the prompt says, so I did not write or commit it.

Red after this unit: only `tests/deps.test.ts`, until the lead runs `bun run deps -- --write`.
