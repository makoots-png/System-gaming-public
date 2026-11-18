# Notes, feel unit 2: redraw the fight in place, then hold 50 ms

## Taking over

The helper before me was stopped by a machine restart in step 1 and committed nothing. It left two edits. In `scripts/build.ts` it had turned `minify` off so a CPU profile names functions; I used that for the profiles below and set it back, so it is not committed. In `tests/e2e/feel.e2e.ts` it had added a CPU profile to `FEEL_PROFILE=1` (`busiestRuns`: the two longest runs of samples with no idle between them, by function, inclusive and self) and the fourth case step 5 asks for (a player's phone while the GM plays a turn). I kept both and committed them with step 1.

## Step 1: before any change

### The frames, ten runs

`E2E_PORT=3241 E2E_CHROMIUM=/opt/pw-browsers/chromium bunx playwright test tests/e2e/feel.e2e.ts --repeat-each=10 --workers=1 --trace off`, 4x CPU, moves on, the minified build as served, at the commit before this unit (038488a) plus the test's fourth case. The box was otherwise idle (load average 0.5 at the start, 4 cores).

| Scenario (4x CPU, 10 runs) | Worst frame per run, median (range) | Slowest tap, median (max) |
|---|---|---|
| A fight turn on the GM's phone | 83.3 ms (66.7 to 150) | 63.5 ms (102.6) |
| A player's phone during the GM's turn | 50.0 ms (33.3 to 66.8) | no tap |
| A maker opening | 41.7 ms (33.3 to 66.7) | 64.4 ms (92.9) |
| The sheet scrolling | 16.8 ms (all) | 9.8 ms (18.1) |

Two of the ten fight runs failed the limit of 8 frames that unit 1 set (150 and 133 ms), and one tap took 102.6 ms. Unit 1 measured the same test at a median of 66.7 ms (50 to 100); this box is slower today, which is noise neither side of a later comparison controls, so the after numbers are taken the same day on the same box.

### Where the worst frame's time goes

Three profiled runs of each of the two fight cases (`FEEL_PROFILE=1`, the unminified build, `--repeat-each=3`). The profiler samples every 0.1 ms and the trace runs with it, so every number below is inflated against an unprofiled run; the shares are what to read. Each fight run has two long stretches of work, the redraw after the use and the redraw after Next; both are in the table (six stretches). A blank is a function outside the profile's ten largest in that stretch. "Browser, after the script" is the CPU profile's `(program)`: the frame's style, layout and paint that run after the script returns.

The GM's phone, a fight turn (ms of CPU in the stretch, at 4x and profiled):

| Where | Use 1 | Next 1 | Use 2 | Next 2 | Use 3 | Next 3 |
|---|---|---|---|---|---|---|
| The whole stretch | 124.5 | 142.0 | 140.7 | 94.3 | 196.8 | 97.3 |
| Combat `render`, inclusive | 27.8 | 60.5 | 41.2 | 38.7 | 39.4 | 47.8 |
| of it, `slideTo` measuring the rows after the `innerHTML` (a forced style and layout, `getBoundingClientRect`) | 23.0 (17.0) | 36.9 (24.6) | 33.4 (26.1) | 20.0 (13.0) | 34.8 (24.1) | 27.0 (16.2) |
| of it, `render`'s own time (the markup strings, the `innerHTML` setters) | | 12.8 | 2.2 | 10.3 | | 11.0 |
| of it, `focus` (the focus put back on the rebuilt button) | 4.0 | 5.3 | 6.2 | 2.7 | 9.1 | 4.9 |
| The command: `send`, the reducer and `store.update` (its save repair 7 to 9 ms) | 14.5 | 13.7 | 16.2 | 6.5 | 21.8 | 10.1 |
| `burst` of the crit (16 particles, each its own `animate`) | 11.0 | | 14.0 | | 27.2 | |
| Browser, after the script | 54.5 | 61.1 | 53.3 | 43.5 | 78.6 | 36.4 |

The trace of the same runs puts the longest task at 63 to 117 ms: the redraw's animation frame callback (42 to 76 ms of script, with `ParseHTML` 2 to 5 ms), then `UpdateLayoutTree` (style) 13 to 22 ms, `Layout` 10 to 19 ms and `Paint` 5 to 21 ms. The style and layout are of the whole card and turn order, because `render()` replaces both by `innerHTML`; `slideTo` then asks for their places, which forces that style and layout inside the script. `matchMedia` takes 2 to 3 ms of self time in every stretch: `motion.reduced()` makes a new media query list on each move.

A player's phone while the GM plays (three runs, the longest stretch of each): 36 to 50 ms profiled, of which the room event's application (`runLink`, `apply`, the store update of the hunter's vitals) 11 to 33 ms, the redraw of the view the store change asks for (`renderView`) 8 to 13 ms, the HUD's own `paintHud` 4 to 10 ms, and the browser after the script 5 to 24 ms. The HUD rebuilds its whole markup on a change too, but it is small (a few rows and the hunter's bars), so its cost is a third of the GM's.

### What I expect each change to gain

- **The order and the card updated in place** (step 3): the `innerHTML` of the whole card and order goes, so `ParseHTML` (2 to 5 ms traced) goes, and style and layout run only for the nodes that changed: I expect `UpdateLayoutTree` and `Layout` together to fall from 23 to 41 ms traced to under 10, and the forced layout in `slideTo` with them (it is the same layout, asked for earlier). The tapped button is no longer rebuilt, so the `focus` put back (3 to 9 ms) goes. The markup strings of the parts that do change stay. I expect the redraw's task to fall by about half, and the worst unprofiled frame from 67 to 83 ms to about 33 to 50 ms.
- **`reduced()` reading one media query list** instead of making one per move: 2 to 3 ms profiled per redraw.
- **The crit's burst** runs in the frame after the redraw, not in it, so it bounds a frame only if it is the longest thing in its own frame: 11 to 27 ms profiled. Not changed unless step 5 shows it bounds the frame.
- **Not in this unit**: the store's save repair on every update (7 to 9 ms profiled per command, `src/core/save.ts` and `src/edge/store.ts`) and the room event's application on a player's phone. They are listed in step 5 if they bound the frame after.

## Step 2: how a fight screen updates

Three ways, judged by the frames on the slowed phone, how the owner adds a new thing to a card, how a move of `motion.ts` finds what changed, and how the map will use it.

- **(a) Keyed patching of descriptions.** A render gives each row and the card a description, a flat record of plain values (the card's numbers from `cardOf` in `fight-view.ts`, the view's words and controls beside them). Each row and card is drawn once from its template and keyed by its row id; on a change, `bind` compares the new description with the last one field by field and writes only the fields that changed, into the nodes bound to them by an attribute (`data-text`, `data-num`, `data-fill`, `data-attr`, and `data-part` for a list or something that comes and goes, written as markup). `keyed` keeps one element per row in the order ahead and moves only those out of place. Frames: style and layout run for the changed nodes only, and nothing is parsed but the parts that changed. A new thing on a card: a field of `Card` (or of the view's description, for what is not a fight number) and its node in the template. Motion: the bar, the number and the row are the same nodes before and after, so `fillTo` and `numberTo` read the old value off the node and `slideTo` moves the row that was there; the keyed memory feel unit 1 needed (`fillTo`'s `key`) can go. The map: a token is a keyed element with a description (its tile, its state), the same `keyed` and `bind`, and a slide along the path from the old node. The diff (`changed`, `plan`) is pure and unit tested.
- **(b) A setter per field of a card.** `setHp(id, n)`, `setStatuses(id, list)` and so on, called from `send()`'s effects. Frames are as good as (a) or better (nothing is compared), but each new thing on a card is a setter and a call in every path that changes it, and a path that forgets one shows a stale card: two places per thing and no single description to test. The map would need its own setters. Rejected on the owner's "one place".
- **(c) Keep the whole rebuild and move it off the tap's frame** (a `requestIdleCallback` or a `setTimeout` after the tap's frame). The tap answers at once, but the rebuild's 40 to 75 ms of style and layout still lands in one frame a moment later, so the worst frame does not change; the step-1 profile shows that frame is the problem, not the tap. Motion still animates across a rebuild by key. Rejected by the measurement.
- **(d) Morph the new markup onto the old DOM** (parse the whole template string each time, walk old and new nodes, patch what differs). Keeps every template a string, and nodes persist. But every change still parses the whole card and order (the 2 to 5 ms `ParseHTML` of step 1) and walks every node; a bar's trail element and a counting number would need exceptions so the walk does not undo what a move put there; and the diff is DOM against DOM, testable only in a browser.

Chosen: (a), as the lead leaned, with the description as plain data. `fight-view.ts` gives `Card` the fields a card had read off the row directly (`turn`, `speed`, `armor`, `resist`, `stride`), so every number on a card comes from `cardOf`. Laziness: the part (`data-part`) keeps the lists on a card (abilities, statuses, the move control) as the markup they were, rewritten only when their markup changes, which on a turn is rare; a finer binding for them would add code without a frame to show for it. Minimize reader load: one module, `src/views/patch.ts`, five binding attributes, three pure functions.

## Step 3: the fight on it

`src/views/patch.ts` (`bind`, `keyed`, and the pure `changed`, `plan`, `prepended`, with `tests/patch.test.ts`). The GM's screen (`combat.js`): the bar's head and buttons, each row of the order ahead and the one card are descriptions bound to templates; the log gains its new lines at the top instead of being drawn again (it holds up to 200 lines). The player's HUD (`table.js`): the round, "Your turn", each row, the hunter's bars, chips and actions the same way, the HP field and its message kept as they are. `fight-view.ts` gives `Card` the fields a card had read off the row (`turn`, `speed`, `armor`, `resist`, `stride`), with a test.

What the first profile after the change showed, and what I changed for it:

- **One card, not one per row.** With a card per focused row, every Next drew a new card (about 80 elements styled and laid out). The card is now one element that shows the focused row; a turn rewrites only what differs, and the static controls (the HP field, the quick buttons, Status, Remove) stay. A description names what it shows in `key`; when that changes, `bind` makes its bars and counted numbers draw at once (`motion.forget`), so a bar never drains from another row's HP.
- **A turn moved every row.** The first `plan` put each key in place from the top, so the order after Next (the first row to the bottom) moved every other row, and each moved row is styled and laid out again. `plan` now keeps the longest run of rows already in order (patience sorting) and moves the rest: after Next, one row moves. `tests/patch.test.ts` holds that.
- **The foes of the move control were worked out four times per redraw** (`foesOf` through `pickedFoe` and each `stepOf`); now once.
- **`reduced()`** keeps one media query list instead of making one per move.

Workarounds of feel unit 1 removed: `fillTo`'s `key` option and its map of 400 keys (a bar remembers what it showed on the node, which now persists), the HUD's markup comparison (`hud.sig`) and its put-back of the HP field's focus and value and of its message after each rebuild, and the GM's comparison of the whole screen's markup (`lastSig`) with its put-back of the amount field's value. `numberTo`'s `key` stays: the sheet's XP percentage in `hunter.js` is still drawn as new markup.

Checks at this commit, each file once, `E2E_PORT=3241 E2E_CHROMIUM=/opt/pw-browsers/chromium bunx playwright test tests/e2e/<file> --workers=1 --trace off`: combat-turns `14 passed (1.1m)`, table-session `7 passed (1.6m)`, table-turn `7 passed (2.3m)`, used `6 passed (1.3m)`, fight-vitals `3 passed (16.4s)`, layout `5 passed (23.6s)`, feel `4 passed (37.3s)`. Another helper's Playwright run shared the box during these (load average 1.3). `FEEL_PROFILE=1` also prints, for each long task, how many elements each style recalculation touched and how many layout objects were dirty: the numbers that showed the two faults above (a Next styled 112 to 179 elements and laid out 152 to 231 of about 420 objects).

## Step 4: the makers

The profile of the item maker opening (three runs, `FEEL_PROFILE=1`, unminified, 4x): the tap's click handler took 42 to 79 ms traced, of which the maker's `build` 7 to 15 ms (the markup and the effects editor), and `focus` 25 to 48 ms of self time: putting the focus in the first field forces the style and layout of the whole new window at once (105 elements styled, 116 of 586 layout objects). So the cost is drawing the whole form in the tap's frame, and building it is the smaller part.

The shell (`openMaker` in `maker.js`) now draws the window and the form's first fields in the tap's frame and each part a build marks `data-later` in the frames after, one a frame (the attribute hides it with `display:none`, so it is not styled or laid out; its fields are in the form, so the preview, `blocked` and Save read them as before and a maker's code finds them). The makers mark the part below the first screen: the item maker's second column (effects, Affects, preview, the two checkboxes), the skill maker's second column, the status maker's effects and colour, the monster maker's abilities, notes, starting statuses, loot and description. The first field has the focus in the tap's frame as before; `makers.e2e.ts` has a test that types the item's name the moment the window shows and then taps a quick effect from the part drawn later.

No other window was over budget in the profiles of this unit: the target picker of a use and the confirm windows are a title and a few buttons.

One thing a GM may see: a form shorter than the screen in its first frame grows by its later part in the next frame or two, while the window is still fading in (about a third of the way through its rise).

Checks at this commit: makers `22 passed (1.8m)`, customization `8 passed (1.2m)`, sharing `6 passed (41.3s)`, feel `4 passed (37.1s)` (that run: the maker's worst frame 16.7 ms and its tap 47.1 ms, against 33 to 67 ms and 58 to 93 ms before).

## Step 5: after the change

### A test that read the screen a frame early

`combat-turns.e2e.ts`'s Toward loop failed three runs in a row after a later change to the card's numbers, and the same with that change taken out again. A debug copy of the loop printed why: the test learns from the save that it is Brakk's turn (`currentName`) and then reads Brakk's card at once, but the screen draws in the next animation frame (`scheduleUpdate` in `app.js`), so for that frame the one card still shows the last row, whose Move list holds "Brakk Ironhide · 2 tiles" and so matches `.cmb-card.turn` with Brakk's name. It read that row's Toward as enabled, then the frame drew Brakk's card with Toward off, and the tap waited for 15 s. The old screen had the same frame of a stale card; which seeds hit it depends on where the openings put everyone. The loop now waits for the turn order on screen to name Brakk before it reads his card (what the GM sees), which is no retry and no fixed wait. Two runs after: `14 passed (1.1m)` each.

### The numbers

The same test as step 1, ten runs a side, `--repeat-each=10`, at the last code of this unit (a card's numbers bound by name, below). The box was otherwise idle for these runs (load average 0.5 to 0.7). The before column is step 1's.

| Scenario | 4x, moves on: worst frame per run, median (range) | before | 4x, slowest tap, median (max) | before | 1x, moves on | 1x, moves cut |
|---|---|---|---|---|---|---|
| A fight turn on the GM's phone | 50.0 ms (33.3 to 83.4) | 83.3 ms (66.7 to 150) | 58.6 ms (64.9) | 63.5 ms (102.6) | 16.8 ms (all) | 16.8 ms (16.7 to 16.8) |
| A player's phone during the GM's turn | 33.3 ms (16.8 to 50) | 50.0 ms (33.3 to 66.8) | no tap | | 16.8 ms (all) | 16.8 ms (all) |
| A maker opening | 33.3 ms (16.7 to 66.7) | 41.7 ms (33.3 to 66.7) | 55.1 ms (89.7) | 64.4 ms (92.9) | 16.8 ms (16.7 to 16.8) | 16.7 ms (all) |
| The sheet scrolling | 16.8 ms (all) | 16.8 ms (all) | 9.0 ms (18) | 9.8 ms (18.1) | 16.8 ms (all) | 16.8 ms (16.8 to 33.4) |

At 1x with every move cut the maker opens and settles in 3 or 4 frames, under the test's floor of 6 recorded frames, so those ten maker runs fail that floor; their frames were all one frame long. With moves cut at 4x (ten runs at the step-4 code): the fight 66.7 ms (50 to 83.4), the HUD 33.3 ms (16.8 to 66.7), the maker 33.3 ms (16.7 to 66.7). Cutting the moves does not lower the worst frame, so motion does not bound it. An earlier set of ten at 4x with moves on, at the step-4 code, had a fight median of 58.4 ms with one run at 116.7 ms (a 70 ms task); I report the last set because it is the code being committed, and say so here because the spread is that wide.

### What bounds the worst frame now, and the limits

50 ms held in every run for the sheet and for a player's phone during the GM's turn: their limit is 3 frames. It did not for the fight (nine of ten) or the maker (eight of ten), so their limits are the worst of the ten plus one frame: 6 frames (100 ms) for the fight, down from 8, and 5 frames (83 ms) for the maker, as before. TAP_MS stays 100.

The fight's longest frame, from the last profile (two runs, `FEEL_PROFILE=1`, traced and profiled at 4x): the redraw's task is 43 to 77 ms traced, down from 63 to 117. It styles 63 to 96 elements (was 112 to 179) and lays out 120 to 129 of about 420 objects (was 152 to 231). What is left: the card shows the next row on Next, so its head, its abilities and move control, its conditions and its numbers are new content, about 60 elements, which is the job of the frame; the forced layout in `slideTo` (11 to 22 ms profiled) is that same layout asked for inside the script; the command itself (`send`, the reducer and `store.update`, whose save repair costs 4 to 8 ms profiled on every command); and the page's `:has()` rules (`html:has(.overlay.show)`, `#view-combat:has(...)`, `.nav-bottom:has(...)`), which the invalidation trace showed are rechecked on each change inside the page (109 times in one fight turn).

What would close the gap, in the order I expect it to pay: the store's save repair skipped for a command the reducer made (it is already a valid save; `src/edge/store.ts` and `src/core/save.ts`, outside this unit); the `html:has()` rules replaced by a class the window and the dice sheet set on `<html>` (app-wide CSS, outside this unit); the order's slide measured from the rows' fixed height instead of a forced layout; and on the use, the target picker's close and the redraw in separate frames.

The maker's two long runs had a 71 and a 76 ms task; with the form split, the tap's task is the build and the first fields, and I did not profile those two runs, so I cannot say which part grew in them.

### The checks of step 5

- An 80 ms busy loop at the top of the combat view's click handler and of `make()` in `gm.js` (one run each, then removed): the fight failed (worst frame 116.7 ms, 7 frames against 6; slowest tap 151 ms) and the maker failed (116.7 ms, 7 frames against 5; tap 143.4 ms).
- Ten in a row: the 4x set above, `37 passed, 3 failed (6.2m)` with every limit at 3 frames; every one of its forty runs is inside the limits now committed (fight 83.4 ms is 5 frames of 6, maker 66.7 ms is 4 of 5).

### A card's numbers bound by name

To make "a thing on a fight card" one field and one node, `cardDesc` now passes every number of `Card` to the template by its name, and the stats line is nodes bound to them (`<span data-text="armor">`); a new directive, `data-show`, hides a node while its field is null or false (the shield, the mana and fatigue bars). The stagger stays a part: it is an object in `Card`.

## Step 6: checks and docs

`AGENTS.md`: two rows in "Where things live" (how a screen that changes often updates in place, `src/views/patch.ts`; how a maker opens without a long frame, `data-later`), the recipe "A thing on a fight card", and a line in the maker recipe. `bun run deps -- --write` rewrote `docs/dependency-map.md`.

Lines, from 038488a to the step-5 commit: the app (`src/`, `public/`) 352 added and 142 removed, of which `patch.ts` is 115 new lines and the fight's two screens 202 added and 122 removed; the tests 182 added and 10 removed (`tests/patch.test.ts` 64, the lag test's profile and fourth case, the maker test, the card's test).

Principles that changed a choice: explain-the-number and benchmark-checklist made me profile after the first version instead of measuring it, which found the two faults of step 3 (a card per row, a plan that moved every row) that the frame numbers alone did not show; laziness kept the card's lists as parts rewritten whole; minimize-reader-load kept one module and a handful of binding attributes instead of a setter per field.

Checks at the step-5 commit (b97e7df) with this step's docs: `bun run typecheck` no errors; `bun run test` `Ran 2197 tests across 55 files.` with `0 fail`; `bun run deps -- --write` left the map as committed. Every browser file once, one at a time, `E2E_PORT=3241 E2E_CHROMIUM=/opt/pw-browsers/chromium bunx playwright test tests/e2e/<file> --workers=1 --trace off`, all green on the first run: character 20, combat-turns 14, custom-skills 7, customization 8, feel 4, fight-vitals 3, gates-quests-dailies 21, layout 5, look 9, makers 22, pwa 3, reward-room 1, rewards 5, room-onboarding 6, room-sync-fixes 14, room-sync 1, room-view 9, save 7, sharing 6, table-session 7, table-turn 7, upgrade 3, used 6 (the last: `6 passed (1.3m)`).

Not done: the feel test was not run ten in a row with the committed limits (the ten-run set above ran with every limit at 3 frames; its forty runs all fall inside the committed limits). The sheet's XP percentage (`hunter.js`) still uses `numberTo`'s key, as the sheet is still drawn as new markup.
