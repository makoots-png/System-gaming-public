# Notes, brief A (first run and the room)

## Step 1: the machine (8667176f)

- `TABLE` rows are written as `{ ...NONE, <cells> }`: `NONE` lists every event once, so a new event still fails the
  typecheck until `NONE` has it, and each row reads as the brief's table.
- `tests/onboarding.test.ts` writes the brief's table out as `SPEC` and checks each step against it, cell by cell.
- `tests/models/onboarding-events.ts` needed no change: it walks `ONBOARD_EVENTS`, which now holds `sheet` and `join`.
- onboard.js at this step: `hunterCreated` sent `sheet` at once (the old silent end); `campaignReady` drew the old room
  offer.
- Check: `bunx tsc --noEmit && bunx tsc -p tsconfig.views.json --noEmit && bun test tests/onboarding.test.ts
  tests/statecharts.test.ts`: `Ran 79 tests across 2 files.` (79 pass, 0 fail).

## Step 2: first-run.ts (910009bb)

- `ROOM_IS` changed from the draft. The draft said everyone follows "the same fights, quests and rewards". In
  `src/core/protocol.ts` quests and rewards are messages the GM sends to chosen hunters (`quest`, `award`), and the shared
  docs are the fight and the world (gates, the day). Now: "A room links the GM's phone to the players' phones: the GM
  sees each player's hunter and sends quests and rewards, and everyone follows the same fights and gates."
- The points step names the button as the screen does: "Confirm allocation" (hunter.js), not "Confirm".
- The path step: "Pick a path: on the Status tab, in the Build panel." (custom.js registers the panel `build`,
  title "Build", on the `status` view.)
- `ABOUT`, `ROOM_PATH` kept as drafted (the manifest already says "Solo Leveling-style").
- Check: `bun test tests/first-run.test.ts`: `Ran 15 tests across 1 file.` (15 pass); both typechecks clean.

## Step 3: the windows

- first-run.ts gained three more word sets, so no new sentence lives in onboard.js: `createdLine` (Hunter created's
  line), `LOADED` (Campaign ready's line: starter or blank; the starter's counts read `PREGENS`, `STARTER_GATES`, `ARC`)
  and `TIPS` (the ? guide's tips per role, moved out of onboard.js and rewritten with create and join).
- The blank campaign keeps the seed hunter "Hunter" (`owned('Hunter')`), so its line does not say "no hunters".
- The windows listen to `sync:room` and `sync:status` once, at register, through `freshen`. The bus has no `off`, so
  "stops listening when it closes" is done by state: `freshen` does nothing unless the open window has a next-steps
  list. No new page-level `let`.
- A done step: a check mark (shape, not colour) hidden from a screen reader, and "Done: " in `.sr-only` for one.
- `DRAW[at](event)`: Campaign ready reads the event that led there (starter or blank).
- The toast "Starter campaign loaded." is gone: Campaign ready says it. "Joined room X." stays as a toast.
- `dismissAll` (helpers.ts) also taps Open my sheet and Later/Continue, so a test that only clears windows still lands.
- `scripts/ui-shots.ts` shoots Hunter created and Campaign ready; `scripts/maker-shots.ts` and `phone.e2e.ts` tap
  past Hunter created.
- Check: `E2E_PORT=3341 bunx playwright test tests/e2e/room-onboarding.e2e.ts --workers=1 --output=/tmp/pw-frc-a`:
  `11 passed (54.3s)`. The new tests 4 and 6 (Join a room lands on the Room page; the room button's words) came with
  step 4, since they read its words.

## Step 4: the one door

- room-pill.ts keeps no state now: the Data view's panel and its `let panelEl` are gone (and its lint line). The Data
  view had no other panel, so the Data page is only its own view's content.
- Out of a room the button reads `Join room` (label "Join a room") for a player, `Create room` (label "Create a room")
  for a GM; `Creating` while a create runs; "creating a new room" in its label when one runs from a room.
- room.js: `ROOM_IS` above the lobby (`data-roomis`); Join a room carries `ROOM_PATH.player` (player only); the create
  section is headed "Create a room" with `ROOM_PATH.gm` for a GM, or "Only the GM creates a room. Creating one makes
  this phone the GM's." for a player. In a room, the GM's share box sits under "Invite players" with one line on how a
  player joins. `STATE.creating`: "Creating a room" / "Creating a new room."
- gm.js: two refusal lines said "open a room with the room button at the top" (an award or a broadcast with no room);
  they now say "create a room". They are not the room strip the brief named, but they are the verb the brief removes, so
  I changed the words only. The strip's "No room open." stays beside "Open ABC234 as GM" (it reopens a room).
- `scripts/charts/link.ts`: the chart's "Opening or joining a room" box is "Creating or joining a room".
- room-view.e2e.ts: the step that tapped the Data panel's Open room now taps the room button at the top from the
  Data page.
- Check: `E2E_PORT=3341 bunx playwright test tests/e2e/room-view.e2e.ts tests/e2e/room-sync-fixes.e2e.ts
  tests/e2e/room-onboarding.e2e.ts tests/e2e/look.e2e.ts tests/e2e/phone.e2e.ts --workers=1 --output=/tmp/pw-frc-a`:
  `69 passed (8.7m)`.

## Step 5: the docs

- AGENTS.md: the first-run row names Hunter created and Campaign ready and when the save is marked; a new row says
  where `ABOUT`, `ROOM_IS`, `ROOM_PATH`, `nextSteps` and the rest live; the room pill row says the Room view is the one
  door and which verb each role reads.
- copy-tasks.md: a glossary row (a GM creates a room, a player joins one, "Open ABC234 as GM" reopens) and a line in
  "Where the words live" for first-run.ts.
- `bun run deps -- --write` and `bun run charts` (the link chart's box name changed in step 4).
- Check: `bun run test`: `Ran 3563 tests across 94 files.` (3560 pass, 3 skip, 0 fail).

## Step 6: every browser file, three workers

- `E2E_PORT=3341 E2E_FEEL=skip bunx playwright test --workers=3 --output=/tmp/pw-frc-a`: `2 failed`, `334 passed (15.9m)`.
  (A first try ran inside a 10-minute background limit of mine and was stopped; the run above is the second.)
- `used.e2e.ts:220` (the GM's notifications): the known failure on this box (its Chromium blocks notifications).
- `save.e2e.ts:184` ("a save whose running fight is damaged opens without the fight"): fails again alone with
  `--workers=1`. Not from this change, I believe: the console error is
  `[register:quests] app.api.sync is read before its module registered it`, thrown from the Quests view's daily check
  at register (`quests.js`, `store.apply('daily-check', ...)` with `gm: app.isGM()`), which reads `sync.room()` before
  sync.ts has registered. This change touches neither quests.js, app.js's `MODULES`, nor the save. It likely depends on
  the save the test seeds needing a daily check when the test runs. Left for the lead.
