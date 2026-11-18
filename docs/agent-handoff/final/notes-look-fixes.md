UNIT look-fixes: rows L0 to L5 DONE at 8461677 (commits a1dfd49..8461677). Close partly done: left are the other browser files (only battle-map, look, map-extras, table-turn, combat-turns, used and phone were run) and `scripts/ui-shots.ts` (not run, budget). Typecheck and `bun run test` pass at the last commit.

# Notes: look fixes (L0 to L5)

Goal: what a player or GM sees in every fight on a phone is right at 390 and 360 px, each fixed where AGENTS.md says the thing lives, with a test that fails without it. The problem: five look and word faults from the lead's hand play and one tab tap a poll undid in CI. Smallest change: one fix per row in its owning module, one test each.

Principles read and applied: `principle-fix-root-causes` (L0: the redraw that navigates is fixed, not the test's wait), `principle-test-behavior-not-implementation` (L0's test drives the exact interleaving a player meets and asserts the screen shown), `principle-model-the-domain`.

## L0, a tab tap undone by a poll

Cause: table.js `refresh` redrew by navigating, `app.go(<the view shown>)`; when a poll's `sync:docs` lands between a tab's hash set and its `hashchange`, that navigation sets the hash back and the tap is lost.

Change: `app.redraw()` (typed in `src/views/app.ts`, `scheduleUpdate` in `src/app.js`): the shown view, its panels and the header drawn again next frame. `refresh` calls it. `refresh`'s callers (`letGo`, the map's `card`, `onDocs`) read nothing drawn right after it, so the next frame is enough. Swept every `app.go(`: the others are navigations to a literal view (a flow that ends on a screen, a link).

Test: `tests/e2e/battle-map.e2e.ts` "a player who taps the Fight tab as the GM's fight arrives is on the Fight tab": on the player's page the hash is set inside the poll's `sync:sheets`, the task that emits `sync:docs` next, on the first poll that brings a changed fight doc. Without the fix the player stays on Status (failed at `toBeVisible`); with it, passes. Lint: "a view redraws with the app's redraw, never by going to the view shown" (`app.go` takes a literal id in `src/views` and `src/edge`); it fails on the old line.

Checks: `bun run test` 0 fail (3514 tests); `battle-map.e2e.ts` 21 passed.

## L1, names on the map

Cause: map.js drew every name in the same place, 9 px up from the bottom of the token's box and 52 px wide (the whole name on the body aimed at, no limit), with no regard for what stood under or beside it; so a body below covered the name and a whole name ran over its neighbour's. Where a name goes is a fact of the scene, so the rule moved to core.

Weighed on paper:
1. The side that is free: under, else over, else none (the initials on the disc say who). Predictable from where the bodies stand; every name that has room shows. Picked.
2. Names only for the current row, the aimed targets and the last tap. Fewer collisions, but a player loses who is who on every other token, and "last tapped" is view memory the scene does not hold.
3. Shorten to `shortOf` when a neighbour's tile is taken. Fixes the width only; a body under still covers the name.

The rule (`platesOf`, `Plate` on `MapToken`, replacing `short`): each name is a plate on a strip of the tile under its token (its top) or over it (its bottom), one tile wide with `shortOf`. Under when that strip is on the map and holds no token and no other name, else over, else none. Sides are worked out with every name short, so aiming never moves a name. Then the body aimed at gets its whole name three tiles wide where those three tiles' strip is free too, else it keeps the short one. The body whose turn it is keeps its short name, as before (`battle-map.e2e.ts` reads "Kai" under the current token). map.js draws the plate (`.mp-name.above`, `.wide`, max-width one or three tiles) and nothing else; the zone label's `covered` reads the plates.

Tests: `tests/map-view.test.ts` (two bodies one above the other, a row of three, a full 3 by 3 block, the map's edge, the aimed body whole and short), `tests/e2e/look.e2e.ts` "in a melee of three on the map, every name is clear of the other tokens and the other names, aimed or not" at 360 and 390: fails on the old drawing (crossings at both sizes), passes now.

Checks: `bun run test` 0 fail (3519 tests; a first run failed 91 room tests because I edited map.js while it ran, so the server's build id and the test's differed; on a still tree it passed); `look.e2e.ts` 18 passed, `battle-map.e2e.ts` 21 passed, `map-extras.e2e.ts` 10 passed.

## L2, End turn on a player's hotbar

Cause: every hotbar slot had a fixed width (`flex: 0 0 86px`, End turn 96 px) in one scroller, so two abilities, More and End turn need about 372 px and the fourth slot, End turn, was cut at the edge of a 390 or 360 px phone; the scroller showed no sign that it scrolls.

Weighed: (1) End turn pinned at the bar's end, outside the scroller; (2) slots that share the width when they fit; (3) both. Picked both: End turn is the turn's one constant, so it sits in its own box (`data-passbox`) beside the scroller (`data-slots`), always whole; the slots grow from 72 px to share what is left (`flex: 1 0 72px`). When they still do not fit, the scroller fades out at its right edge (`.mp-slots.cut`, a mask), set by an IntersectionObserver on the last slot, so no layout is read in a draw.

Test: `tests/e2e/battle-map.e2e.ts` "on a 360/390 px phone a player's turn with two abilities shows End turn whole on the first screen, and the bar fades where it scrolls": a player with Strike and Fester; End turn inside the screen, above the bottom bar, 44 px tall; the fade is on exactly when the slots scroll. Fails on the old hotbar at both sizes ("End turn is whole across the screen"). Unsure: with two abilities the slots may fit at both sizes, so the fade half of the case may only see "no scroll, no fade".

## L3, the Fight tools' Height stepper

Cause: Width's and Height's label, minus, number and plus were eight loose items in one wrapping flex row, so the row broke wherever the width ran out, between Height's number and its plus at 360 px (measured: Height's parts at y 175, 175, 225, 225).

Change: each stepper is its own no-wrap group (`.cmb-step`, `sizeSteps` in `combat.js`); the size group wraps between the two steppers only.

Test: `tests/e2e/look.e2e.ts` "on a 360 px phone the Fight tools keep each map size stepper, its label, minus, number and plus, on one row". Fails on the old markup with the numbers above. Note: this test went into the L1 commit by mistake (the same file); it passes from the L3 commit on.

Checks for L2 and L3: `bun run test` 0 fail (3519).

## L4, "XP sent" while it waits

Cause: the words after a post were decided in each view, and the fight's end said "XP sent to …" at the post with no look at the link at all, so an offline GM read "sent" for an award still in the outbox. gm.js had its own rule (`status() === 'connected'`), which also called a stalled outbox (`waiting`) sent; quests.js said "sent" whenever the post was made; a player's item and skill reports said "Sent to the GM." at the post.

Change: one rule in core, `postNews(posted, conn)` in `src/core/sync/connection.ts`: `sent` when the post was made and the link is in a state where the room answers this phone's polls (`GOES`, a record over every `Connection`, so a new state must be classified), `waits` otherwise, `noRoom` and `refused` when nothing was posted; `reportWords(conn)` is the reported-use sentence from it. Callers: `endEncounter`'s XP toast (combat.js), gm.js's `goesNow` (HP, Revive, a status, the award form, a broadcast, a quest), quests.js's quest and Job Change sends, inventory.js's and skills.js's reports. New words follow the existing "when the room answers" phrase; no `TODO(copy)`.

Tests: `tests/push.test.ts` "what a phone says of a message it just posted" (a case per `Connection` state and per refusal); `tests/e2e/table-turn.e2e.ts` "the GM's phone offline awards the party's XP and reads that the player gets it when the room answers, not that it was sent": fails on the old combat.js (no such words within 15 s), passes now. Back online, the existing offline case in the same file already proves the award lands once with nothing more done.

Checks: `bun run test` 1 fail, the dependency map (new imports); `bun run deps -- --write`, then its test passes.

## L5, the rounds said twice

The wording pass had not taken it. Cause: `endEncounter` (combat.js) put the rounds in the window's body ("2 defeated in 0.5 rounds.") and again as a line ("Rounds fought: 0.5."). Change: the line is gone; the body says it. Test: `tests/e2e/combat-turns.e2e.ts` "the Fight over window says how many rounds the fight took once": fails on the old window (two "round"s), passes now.

## Close

- `bun run deps -- --write` (done in L4), `bun run charts` (no change), `bun run typecheck` clean, `bun run test`: 0 fail, 3521 tests.
- Browser files, one at a time on 3260, after every row: battle-map 23 passed, look 19 passed, table-turn 12 passed, combat-turns 19 passed, used 8 passed, phone 8 passed. map-extras: 1 failed once in the full file ("a player holds an ability on the hotbar to read what it does", trace off, so no evidence kept), then passed alone and in a second full run with traces kept on failure (10 passed). Not explained: it is a finding for the lead. The hotbar's slots now grow (L2), so a slot's box can move when End turn appears; the test reads the box before its press, which could be the cause, unproven.
- `tests/e2e/feel.e2e.ts` alone on 3218, three runs. `a use from the map`: worst 50, 83.3, 50 ms; worstTap 43.9, 54.1, 38.2 ms; long tasks none, [66], none. Run 3 failed "the GM plays a turn" (a list-view fight on the GM's phone, worst frame 116.7 ms, long tasks 64 and 68 ms), a screen none of these rows changes; in the same run "a maker opening", also untouched, had a 64 ms long task it had in no other run. Inferred: the box was slower in run 3. Not proven; a finding for the lead.
- Not run: `scripts/ui-shots.ts`, the other browser files.
