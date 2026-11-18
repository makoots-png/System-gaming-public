# Notes, the last unit (brief-final.md)

## Step 0: the use frame on the map

Baseline at 39bdfc4, the map case alone ("twenty tokens"), 10 runs at 4x, box idle (load 0.4):
a use's worst frame 50, 66.6, 66.7, 66.7, 83.4, 83.4, 100, 100.1, 116.6, 133.4 ms (2 of 10 over the 6-frame limit),
long tasks 54 to 88 ms.

What the use costs, read from a CPU profile of an unminified build (`FEEL_PROFILE=1`, `minify: false` in
`scripts/build.ts` for the run, then put back), a trace, and timers put round each part in the page for a few runs
(taken out again). All at 4x CPU; a part's spread between runs is the box.

The use is two tasks that usually fall into one frame gap: the tap on Use (its click handler) and the frame after it
(the screen's redraw in `requestAnimationFrame`, then the browser's style, layout and paint).

| Cost | Where | Before | After |
|---|---|---|---|
| The fight's reducer | `reduce` (resolve, zones, the party's fog) | 5 to 14 ms | same; most of it is the first `act` of the page compiling |
| The save repaired twice | the fight's write-back `hunter.setVitals` is a `store.update` inside the command's own, so the save was repaired, written and announced twice | 2 x 4 to 13 ms | once |
| The fight parsed again on each repair | `repairSave` read the reducer's own fight as outside data | about 2 ms | gone (`'kept'`) |
| The save written in the tap | `persist`: the whole save as text and `localStorage.setItem` | 2 to 4 ms | after the frame |
| A forced style and layout | `showEffects` asked for its frame from the tap, so it ran in the redraw's own frame after the redraw and read `getClientRects` and `getBoundingClientRect` of what it had just changed | 14 to 20 ms | in the frame after, where the page is laid out |
| The use's toast | built and animated in the tap's task | 2 to 7 ms (a style pass) | in the frame after the result |
| The hotbar rewritten whole | `drawHotbar` set `innerHTML` when a pressed state or a wait changed (a pick and a use both) | 1 to 4 ms of script, and the parse, style and layout of new buttons; 11 to 20 ms of a pick in the profile | in place (`keyed`, `bind`) |
| The fog, the move area and every outline | `mapScene`: a list of every tile as objects, a linear search of the stride for each dash tile, `outline` with string keys and a sort of every start corner for each loop | 0.69 ms at 1x in bun (2 to 13 ms in the page) | 0.35 ms at 1x |
| The builder's three lists and the list's order | `render` filled the hunter, monster and shadow lists and ordered the list while the Map view hides both | 1 to 3 ms | only while shown |
| The header's role pill | its text written every redraw, which lays the header out again | small | only when it changes |
| What is left of the redraw | the scene, 21 tokens' classes when the aim ends, the order, the dock | 15 to 24 ms | same |
| The browser's own | style of about 90 elements, layout, paint, layerize, a minor GC | 20 to 30 ms | same |

Splitting: the toast and the bursts moved a frame later; the frame they left is the one that shows the hit (the
token's HP ring, the number rising, the order).

After, twenty runs of the map case alone, 4x CPU (`--repeat-each=20`): `20 passed (2.4m)`. A use's worst frame per run:
33.4, 33.4, 50, 33.4, 50, 66.7, 83.3, 50.1, 33.4, 50, 50, 33.4, 33.3, 49.9, 66.6, 33.4, 50.1, 50, 49.9, 83.4 ms; median
50 (before 66.7 to 83), worst 83.4, which is the five-frame beat (five frames read 83.3 to 83.4 ms). The slowest tap 57.6 ms.
A pick: 16.7 to 50 ms. A first twenty with the toast still in the tap's frame: 19 of 20 at or under 66.7 ms and one at
116.7 ms (one 81 ms task); the toast's move took that run's margin back.

The whole feel file after: `5 passed (44.2s)`. `battle-map.e2e.ts`: `14 passed (4.2m)` (the hotbar is drawn in place
now). `save.e2e.ts`: `7 passed`. `bun run test`: 2371 pass, 0 fail.

Principles: subtract-before-you-add (each change removes work: a second repair, a second parse, a rewrite, a forced
read), boundary-discipline (the fight is parsed at the boundary, load, import and another tab, and trusted inside, where
its reducer is its one writer), prove-it-works (twenty runs, numbers above).

## Step 1: what the feel units left

- (a) The onboarding windows: each step's window rises through `enter` and the backdrop fades in once; leaving is
  `dismiss` (the window is out of the page at once, inert, fades, then is removed). The leaving copy changes its class
  from `.ob-overlay` to `.ob-gone` (same look), so a test that addresses `.ob-overlay` never finds one on its way out:
  `onboard.js`.
- (b) The dice sheet opens through `enter` and closes through a new move, `hide` (`motion.ts`): it leaves as `leave`
  does, is `hidden` after, and a tap that brings it back while it leaves keeps it (it was `leave` with a fill left on,
  which would have kept a reopened sheet invisible). While it leaves it is inert and counts as closed (`isOpen` in
  `dice.js`), so a second tap opens it again.
- (c) The app update shows a true percentage: `sw.js` posts `{ type: 'caching', done, of }` to every window as each
  file of the build's list is cached (a file that fails counts as done, as the install goes on without it), and the
  header pill reads "Updating 40%" (aria "Updating the app: 4 of 10 files"). The pill is in `src/edge`, which may not
  import `motion.ts` (a lint rule), so the number is its text, not a `progress` bar. Not checked in a browser: the
  update path needs a second build served (pwa and upgrade e2e pass, they do not reach the worker's install of a new build).
- (d) The quests' objective bars and the storage meter fill by `fillTo` (scaleX). The quest list is drawn whole, so the
  view keeps what each bar showed by quest and objective and fills from there. A status chip that arrives on the
  player's fight HUD pops; the chips already shown stay still (the chips are a part, drawn whole).
- (e) The Dice view's detail line ("1d20 [17]") is empty while the total tumbles and fades in when it lands; a newer
  roll during the tumble wins.

Checks: `bun test tests/lint.test.ts tests/motion.test.ts` 0 fail; browser files alone: room-onboarding 6 passed,
pwa 3, upgrade 3, look 10, feel 5, table-turn 8, gates-quests-dailies 21, character 20, coin 7.

## Step 2: the phone test

Not done in this session (time). No `tests/e2e/phone.e2e.ts` exists yet. Flows the brief lists that already have a
browser test: a room opened and joined by code (`room-onboarding.e2e.ts`, `room-sync.e2e.ts`), by an invite link
(`room-onboarding.e2e.ts`), a player's sheet on the GM's board (`room-sync.e2e.ts`, `feel.e2e.ts`), moves, a hotbar use
and End turn on the map (`battle-map.e2e.ts`, `table-turn.e2e.ts`), the fog and walls on a player's map (`maps.e2e.ts`),
the coin call (`coin.e2e.ts`), a reward arriving (`reward-room.e2e.ts`), a reload in a fight (`save.e2e.ts` covers
reloads; a mid-fight reload is not covered), offline and back (`room-sync-fixes.e2e.ts`). Not covered anywhere: the iPhone
and Android profiles with touch, landscape with the map and hotbar, the 360 and 390 sweep of every view for horizontal
scroll, 44 px targets, 12 px text and a maker's focused field over the bottom bar.

## Step 3a: the map's look (brief-map-look.md), what was done

- Item 6: Paint and Grid are plain buttons in one `.mp-tools` row at the frame's top right, at least `--control-h` each
  way, filled while pressed (`map.js`). A case in `look.e2e.ts` measures both and taps Grid.
- Item 7 (conservative): while a map is on screen in the shown view, the toast box moves to the top of the screen, as it
  already does while a window or the dice sheet is open (`public/app.css`), so a toast never sits on Use, Cancel or the
  hotbar. The lead's fuller ask, the fight's news as one log line over the map instead of toasts, is not built. The new
  look case's toast step passed with the CSS line taken out as well (at 390 the two short toasts happened to sit between
  the dock and the bottom bar), so it does not prove item 7; it holds that they do not overlap.
- Items 1 to 5, 8 and 9 are not done.

## Step 3: a last look

Not done (time).

## Step 4: the other frames, five runs of the whole feel file

`--repeat-each=5`: `25 passed (3.6m)`. Worst frame of each case over the five runs, and its slowest tap:

| Case | Worst frames per run (ms) | Limit | Within a fifth of it? | Slowest tap (limit 100) |
|---|---|---|---|---|
| A fight turn (list) | 66.6, 33.4, 83.3, 33.4, 50 | 6 frames, 100 | yes, 83.3 once | 58.7 |
| A player watching the GM's turn | 50, 33.3, 16.8, 16.8, 50 | 3 frames, 50 | yes, at the limit twice | none |
| A maker opening | 33.4, 50, 33.3, 16.8, 50.1 | 5 frames, 83 | no | 81.4 (within a fifth) |
| The sheet scrolling | 16.8 each | 3 frames, 50 | no | 9.6 |
| A pan and a pinch on the map | 16.8 each | 3 frames, 50 | no | 28.2 |
| An ability picked on the map | 33.4, 16.8, 16.8, 16.8, 16.8 | 3 frames, 50 | no | 62.8 |
| A use from the map | 50, 66.7, 50, 33.4, 33.3 | 6 frames, 100 | no | 52.3 |

Not treated in this session: the list's fight turn (one 83.3 ms run with two long tasks, 52 and 64 ms), the player
watching the GM's turn (50 ms twice), and the maker's tap (81.4 ms). The pick, which failed once in a run of step 0
(66.7 ms with the hotbar rewritten whole), stayed at or under 33.4 ms here with the hotbar drawn in place.

## Step 5: close (partial)

`bun run deps -- --write` (wrote docs/dependency-map.md), `bun run charts` (no change), the checks below. The whole
browser sweep, one file at a time, was not run in this session; the files run alone after the last change to each
area: feel 5 (x5), battle-map 14, maps 6, look 11, save 7, room-onboarding 6, pwa 3, upgrade 3, table-turn 8,
gates-quests-dailies 21, character 20, coin 7.

What cannot be checked without a real device: real touch latency, iOS Safari's own bars and keyboard over a field,
install to the home screen, notifications, and the update's percentage (it needs a second build served to a phone that
has the first).

# Second half (brief-final-2.md)

## Step 1: the map's look (brief-map-look.md items 1 to 5, 8, 9, and item 7's test)

Looked at after each change: the GM at 390 and 1280 and the player at 360 (`scripts/ui-shots.ts`, its map fixture
now puts the wall, the cover, the zone and a remembered strip near the fight, and no longer double taps the corner,
which opened a token's card once the map framed the fight).

- 1, framing. The scene has a `frame` (`frameOf`, map-view.ts): the bodies' box, grown by every terrain or zone tile
  within 3 tiles of it (a move's reach), so a wall across an empty map does not pull the view out; the whole grid when
  no body stands. The map opens there and a double tap goes back there, at a zoom where a token is 44 px at least
  (`MIN_FIT`). When the box is bigger than the screen at that zoom, the scene's `anchor` stays in sight (the body
  acting, else the viewer's own, else whose turn it is). A turn that comes to a body out of sight frames again, at
  the frame's size as last framed (reading the size there laid the page out mid-redraw: 15 ms in a profile). A strip
  of half a tile is left past the grid's edge, so an edge token's name and turn mark are not cut.
- 2, names. A name plate under each token (`shortOf`: a hunter's first name, a monster's last word with its pack
  letter, "Rat B"), the whole name on the body aimed at; gold for the viewer's own, filled with the side's colour for
  the body whose turn it is, which also gets a pointer above it and a wider ring. Shapes stay (round party, square
  foe). Names, zone names and an intent's words are 12 px in the world and are left out below zoom 1, so they never
  draw under 12 px.
- 3, fog. Never seen is an opaque grey-blue mist (lighter than the floor, so it reads as fog, not as a dark floor);
  seen before but not now is the same mist at 62%, the floor showing through; the GM's is the mist at 40%. Blur 4 px
  softens the stair-step of the outline.
- 4, zones. Each zone's name sits on its middle tile (`MapZone.at`) in a plate tinted by its tone; the area has a
  dashed edge in the tone; a tap says what it does by its tone and the rounds left ("Burning ground: hurts whoever
  stands in it, 2 rounds left."). The tone is what both phones hold; the GM's ops in words would need the doc (a wire
  change, and the auras helper's).
- 5, walls. A wall is one solid block: its tiles are filled flat and the scene's `walls` outline draws one lit edge
  round each run. Cover is the same block at half height with its lit top. The colours are tokens (`--wall-face`,
  `--wall-top`, `--wall-foot` in app.css), used by the map and the maker. The maker draws terrain as the map does,
  zones as a tinted fill with an edge, and starts as the token that will stand there (round cyan for the party,
  square red for a foe); each terrain and start brush shows its swatch.
- 7, its test. The look case now asserts the hotbar ends above the bottom bar with the page at its top, then raises
  the toasts with the page there. With the CSS line taken out it fails ("the toasts and this part of the dock do not
  overlap"); with it, it passes. Item 8 is what makes it a real test: the hotbar is now at the bottom of the screen.
- 8, the first screen. On a phone (under 900 px) the frame's height is what the first screen has left: the bottom
  bar's top, less the frame's top on the page, the dock and a one-row hotbar (at least 112 px) and a margin, at
  least 200 px. Read when the map first frames and on a window resize. A battle-map case at 360 by 640: the hotbar
  ends above the bottom bar, the frame is at least 200 px, both tokens are 44 px and in the frame, names "Kai", "Rat".
- 9, intents. A line stops at the edge of its target's token; lines that end on one body are numbered (`nth` of
  `of`, map-view.ts) and set apart sideways; a revealed intent's words (`MapLine.words`: the ability's name and its
  first line, "Curse / Magical damage 1d8 + mag") sit on the line a tile back from its end, kept inside the grid, and
  stack back along the line when two meet. Nothing before the reveal.
- Use and Cancel are one row now (words, Cancel, Use), so they cover less of the map's bottom while aiming.

Feel, the map case alone, twenty runs at 4x. Another helper was running Playwright on the box (15 Chromium processes
with none of mine, load 2.7 to 3.7), so the same twenty were run on the last commit's tree (`git archive HEAD` into
/tmp/base) at the same time of day:

| | a use, worst per run (ms) | failed of 20 |
|---|---|---|
| HEAD (before) | 66.7 66.7 33.4 100.1 50 66.7 50 83.3 100 83.3 50 66.6 33.4 33.5 66.6 116.7 50 (and 3 runs failed earlier at the pick or the pan) | 4 |
| after | 49.9 33.4 50.1 50 49.9 49.9 66.6 83.4 50.1 83.4 83.3 83.3 116.6 50.1 33.4 83.4 33.4 66.7 50.1 | 2 |

The 83 ms bar over twenty runs does not hold on this box today for either tree. What changed for the frames: the
ground (floor, terrain, walls, zones, fog) is a layer of its own (`.mp-ground`, will-change opacity), so a token's
change does not paint the blurred fog again and a pan moves its tiles; the fog's own `will-change` (tried first) made
the compositor blur it every frame of a pan and was taken out; the walls' drop shadow filter was taken out. A profile
of one use: the longest task 53.8 ms (the redraw 42.5, style 10.6 over 94 elements, layout 5.2).

## Step 2: the phone test (`tests/e2e/phone.e2e.ts`)

Profiles: an iPhone (390 by 844, Safari's user agent, touch), an Android phone (360 by 780 or 640, Chrome on a Pixel's
user agent, touch; `userAgent` is a new `device()` option in helpers.ts), a GM on a laptop (1280 by 800, a mouse) and
a GM phone. Seven tests, three runs in a row: `7 passed (2.7m)` each time.

- A laptop GM opens a room; an iPhone joins by the invite link, an Android phone by typing the code; both on the board.
- On Android a player plays a turn on the map: a step, Strike from the hotbar at the rat, End turn; the rat's turn on
  both phones.
- A player's page hidden and offline while the GM ends the hunter's turn comes back with the rat's turn, as the GM.
- A reload mid-fight is back on the map with the turn and the hotbar.
- Landscape (844 by 390): no sideways scroll, a frame of at least 200 px, Strike picked and used.
- The sweep, at 360 by 640 and 390 by 844, a player (Android) and a GM, out of a fight and in one, every view in the
  menu: no sideways scroll, no visible button, field, link or tab under 44 px either way (a box or a choice by its
  label), no text under 12 px (a map's text at its zoom), and each Workshop maker's last field, focused, not under the
  bottom bar or the window's own bar. It extends look.e2e.ts (which checks given screens) to every view.

What broke and was fixed:
- Small text: the browser's own `<small>` is .83 of its line, so under 13 to 14 px lines it drew 10.8 to 11 px (the path
  picker's perks on the sheet, the map's hotbar costs, the current turn's HP over the map). Fixed once in app.css
  (`small` is at least 12 px) and the hotbar's 11 px rule (742bfda).
- A tap lost without a word (c160509): the GM's phone takes one command per doc's `now`, and a player's phone polls the
  room about every 3 s, so a second tap (End turn after Strike) sent before the answer's doc arrived carried the old
  `now` and was dropped. The player's turn now waits from a sent command until the next doc arrives: the map draws no
  actor (no End turn, no move area) and the list's buttons are off; a tap meanwhile says "Waiting for the GM's phone to
  take your last move." A send that fails lets go at once. Found by the Android turn test.
- Found, not fixed: a player's own move shows on their phone only when the next poll brings the doc, up to about 3 s
  after the tap (api log: step POST 16.6 s, the GM's doc PUT 17.3 s, the player's GET 18.5 s). Faster would mean the
  player's phone asking right after its own event or drawing its own move ahead of the doc; both are sync.ts changes
  with their model (tests/models/room-world.ts) and were left.

Flows the brief lists that already have a test, not written again: a room opened and joined by code and by link
(room-onboarding.e2e.ts), a player's sheet on the GM's board (room-sync.e2e.ts), the player's moves, a hotbar use and
End turn on the map (battle-map.e2e.ts, table-turn.e2e.ts), a status with rounds landing and paid (a zone's fire in
maps.e2e.ts "a hunter who ends a turn in the fire takes its damage"), the fog hiding a monster behind a wall and showing
it once seen (maps.e2e.ts "a foe behind a wall"), the coin call on a natural 20 and the GM's ruling (coin.e2e.ts), a
reward arriving (reward-room.e2e.ts), offline and back in both directions (room-sync-fixes.e2e.ts).

## Step 3: a last look (short, for time)

Shots in /tmp/shots-final (131, no step failed). Looked at the player's fight list and map, the sheet's top, the quest
log, the GM's map and a monster's card at 390 and 360. Fixed:
- A status's time was "3r" or "2.8r" on every chip (the sheet, the GM's board and card, the player's HUD and token
  card): now "3 rounds", "1 round" (combat.js, gm.js, hunter.js, table.js; two tests read the chip).
- The daily warning had a long dash: "Daily quest incomplete. Penalty in 05:29." (quests.js).
Seen and left:
- In a map fight the toasts sit at the top (item 7's conservative fix): at the page's top they cover the app's header;
  scrolled down to the map they can cover the GM's Next. The fuller fix, the fight's news as one line over the map
  instead of toasts, changes where every combat toast goes and what about a dozen tests read; not done.
- A monster card's "Stride 4" has no unit (tiles), and the quest log shows two filled buttons (+ New quest and an
  objective's Complete). Not changed.
- When the bodies are farther apart than a phone shows at a thumb's zoom (a hunter at the top, monsters nine rows
  down), the map keeps the anchor in sight and the others are cut at the frame's edge; a pan shows them.
- The hand-played fight at 4x was not done.

## Step 4: the three frames near their limits, and the update's percentage

One profiled run of each (`FEEL_PROFILE=1`, 4x), the box shared with another helper's Playwright runs:

- The list's fight turn (limit 100): this run's worst frame 50.1 ms, slowest tap 46 ms. Its two longest tasks (43 and
  41.8 ms) are the redraw in a frame: the GM screen's `render` 24.7 ms of script, of which 13 ms is
  `getBoundingClientRect` in `motion.slideTo` (combat.js: the order's rows measured after `draw` so they slide), then
  style 7.6 to 8.2 ms over 64 to 82 elements, layout 6.5 ms, paint 3.8 to 6.6 ms. The measure is the FLIP slide's own;
  everything the frame writes is drawn before it, so it lays out once early rather than twice. Nothing of ours to take
  that would not drop the slide.
- A player watching the GM's turn (limit 50): 33.4 ms worst in this run (it was 50 twice in the first half's five).
  Its longest task, 37.9 ms, is the HUD's update from the doc (21 ms of script in the room's doc handler and the HUD's
  draw). Within its limit; not changed.
- A maker's tap (limit 83): the click's task 59.2 ms, of which `focus` is 32.4 ms: focusing the first field in the
  tap's task lays the new window out there. Moving the focus a frame later was tried and measured, ten runs each on
  this tree and the earlier one at the same time: taps 47 to 75.5 ms (median 53) against 47 to 72 ms (median 53), and
  worse worst frames (up to 66.6 ms against 50), as the next frame then lays the window out. Put back; the layout is
  the window's own and is paid in one frame or the next.

The update's percentage in a browser: not done. Two tries in pwa.e2e.ts, both taken out: (1) serving a changed
`sw.js` through a context route and refusing the room's requests with a 426, and (2) unregistering the worker and
reloading under the 426, the new worker's file fetches slowed by a route so the count would be seen. A page the worker
controls sends its room requests through the worker; with `PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS=1` the 426
reached the page (the pill said "Updating") but the worker script's update fetch was not routed, so no new worker
installed; in (2) the page came back controlled and live. What would work: a second server on another port built with
a different build id, which this test file cannot start.

## Step 5: close

- `bun run deps -- --write` and `bun run charts`: no change to either file. `bun run typecheck` clean; `bun run test`:
  `2377 pass, 0 fail`.
- Every browser file alone, one at a time (`/tmp/sweep.log`), all passed: battle-map 15, character 20, coin 7,
  combat-turns 14, custom-skills 7, customization 8, fight-vitals 3, gates-quests-dailies 21, layout 5, look 11,
  makers 30, map-extras 6, maps 6, phone 7, pwa 3, reward-room 1, rewards 5, room-onboarding 6, room-sync-fixes 14,
  room-sync 1, room-view 9, save 7, sharing 6, table-session 7, table-turn 8, upgrade 3, used 6. Then feel alone:
  `5 passed (47.7s)` (a use 33.4 ms, a pick 33.3, a pan 33.3, the list's turn 50, the watched turn 33.3, a maker 50).
- The map case twenty times on a quiet box (load 0.2 before): `20 passed (3.0m)`, but a use's worst was 100 ms twice
  (66.7 50 50 50.1 66.8 83.5 66.7 66.6 50 66.8 66.6 50 33.4 100 50 50 83.4 100 50 50). The ground's own composited
  layer (`will-change` on `.mp-ground`, added in step 1 against the busy box) and the fog's blur of 4 px were taken out
  again (blur back to 2.5 px): twenty runs then, use 66.7 33.3 50 50 33.4 83.4 50 66.6 83.3 50 50.1 66.7 50 83.4 50 50
  66.6 33.4 33.4 (worst 83.4, the five-frame beat; one run failed earlier, at the pick, 66.7 ms against 50, which the
  earlier tree also did on this box). `19 passed, 1 failed`. The pick's limit is the thing nearest to failing now.
- AGENTS.md rows: the scene's framing, names, walls and zone tiles; the map's framing and height; the phone test and
  the sweep; the player's wait after a move. for-the-owner.md: the framing, the camera following a turn, names, the mist,
  the player's wait, rounds as words, each with what to say to reverse it.

What cannot be checked without a real device: real touch latency and how a 44 px token feels under a thumb; iOS
Safari's own bars and its keyboard over a maker's field (the sweep checks the bottom bar and the window's bar, not the
keyboard); install to the home screen; notifications; the update's percentage (no browser case, step 4); how the mist
and the wall's edge read on a phone's screen in daylight.

# The merge of the auras branch (brief-merge.md)

## Step 1: the merge

Conflicts settled (059d4a1): for-the-owner.md keeps both lists; ui-shots.ts writes the auras' zone shape (`ground`) on
the main tree's tiles; `MapZoneIn` has the anchor and `MapZone` has the name's tile (`at`) and the grown edge (`grew`);
map.js keeps the main tree's zone look (dashed edge, tint 24%, name plates) and the branch's grown edge, now a solid
stroke in the zone's tone over the dashed area, so it reads as new ground. An aura's name plate goes along with its
outline (the plate's `span` moves, the box's transform is its place). `bun run test` 2409 pass, 0 fail.

Browser files alone: maps 9, battle-map 15, makers 30, map-extras 6, phone 7, look 11, combat-turns 14, table-turn 8.

Looked at an aura and a growing field on the GM's map at 390 (a throwaway script, deleted). Found: an aura's name sat
on its body's own tile, under the token. The name now goes on the tile nearest the middle that no token or name plate
covers, across counting double (a name is wider than a tile), so an aura's name is written just above its body
(`middleOf`, map-view.ts; case "an aura's name is written above its body"). The grown ring of Embers draws its new edge
solid red over the dashed outline; the inner line of the ring shows where the field was.

## Step 2: the fight's news over the map

`ui.news(msg, kind)` (ui.js) is the fight's news: a map offers its line (`ui.newsLine`), and the line takes the news
while its view is shown, a turn runs and no window or the Fight tools sheet (`data-over-map`) is over it; otherwise it
is the toast it was. The line is `[data-news]` in map.js: inside the frame, under Paint and Grid, full width, the same
words, kept for a toast's time (`ui.TOAST_MS`) and then hidden through `motion.hide`. Callers moved: combat.js's `toast`
helper, map.js (Out of reach, a zone's tap), table.js's fight toasts, uses.js's turn and reach refusals and a cast that
did not reach the room. The fight's log already holds every use line in full; refusals were never in it. The CSS that
lifts the toasts to the top while a map shows stays, for news that is not the fight's.

Case: look.e2e.ts, the 390 px map case, now drives a use through the map: the use's line is in the news line, no
toast is up, and the line overlaps neither Next, the hotbar nor Use and Cancel. With `ui.news` sending everything to a
toast it fails (the line never gets the words). battle-map.e2e.ts reads "Out of reach." and "It is not your turn." from
the line on each phone and finds no toast. Passed alone: look 11, battle-map 15, custom-skills 7, combat-turns 14,
table-turn 8, phone 7, table-session 7, used 6, fight-vitals 3. `bun run test` 2410 pass.

## Step 3: a player's own move shows at once

Where the wait was (api log of a step, before): the player's POST, then the GM's phone took it at its next poll (every
3 s in a fight, every 5 s before its first poll saw the fight), put its fight doc 0.8 s later (`PUBLISH_MS`), and the
player's phone saw it at its next poll (every 3 s): 1 to 7 s, typically 3 to 4.

What changed, each by the link's recipe (link.ts, its tests, the model's alphabet, the chart):
- A player's chase: `send` (sync.ts) raises `sent { from }` after a `step`, `cast` or `pass` the room took, `from` the
  fight doc's `at` it was sent from. The link (`Live.chase`) polls at once, then every `CHASE_MS` (300) while the doc's
  `at` is still `from`, at most `CHASE_POLLS` (10, 3 s); a failed poll ends it.
- The room's pace: `polled` carries `pace` (`paceOf`: `table`, `fight`, or `turn` on a GM's phone while a hunter of
  another device has the turn) instead of `fast`; `turn` polls every `POLL_TURN_MS` (1 s). A GM's fight doc put raises
  `paced`, so the wait starts again at the new pace when a player's turn comes (found by the browser case: the GM's
  first poll after the fight began was 5 s later, at the pace from before the fight).
- The fight doc goes out 0.2 s after a change (`PUBLISH_FIGHT_MS`), the other docs still 0.8 s.
- The pending state, drawn in the frame after the tap: the map keeps the move's way (`MapInput.sent`, a `way` shade) and
  shows "Sending to the GM" with `motion.progress`'s waiting form (`[data-sending]`) while `MapSource.waiting()`; End
  turn and Release now redraw in the next frame as Move and Use do; when the answer comes the token goes along its way.
- No optimistic write: the player's phone draws only the GM's doc.

Found on the way and fixed (table.js): the player's wait compared the doc object, and every poll parses the doc again,
so with polls 0.3 s apart the wait let go on a poll that brought the same doc, and End turn was sent at the same `now`
as Strike and dropped by the GM's phone (phone.e2e.ts's Android turn failed twice). The wait now compares the doc's `at`.

Case: phone.e2e.ts "a player's step shows as sending with its way in the frame after the tap, and the token stands on
the new tile within 2.5 s" (the bound: the GM's 1 s poll, its doc 0.2 s later, the player's next quick poll, and room).
Measured three runs: 941, 942, 942 ms. Before, it failed at 5,797 ms, and the sending mark did not exist.

The model check: 68,538 states (two of the three paces in its alphabet), about 20 s; its timeout is 60 s now. Its
first run with all three paces was 94,770 states and 26 s of a 30 s timeout. `bun run test`: 2417 pass, 0 fail (one
earlier run had every server-rooms case fail at under 1 ms each and passed alone and in the next whole run; not seen again).
Browser files alone: phone 8 (twice), table-turn 8, battle-map 15, maps 9, room-sync-fixes 14.

Left: the list view (no map) shows the wait only as its buttons off, as before. The GM's poll every second on a player's
turn is a page with every sheet in it; a phone on mobile data pays that while players think.

## Step 4: the lag test

The box was quiet (load 1.0 before, nothing else running). Worst frame per run, ms, 4x CPU:

- The map case alone, twenty runs (`--repeat-each=20`, after steps 2 and 3): `20 passed (2.8m)`.
  - a use: 33.4 50 66.6 50 50 50 50 50 66.7 33.5 50 33.4 50 83.4 33.4 33.3 49.9 66.6 33.4 50 (limit 100); slowest tap 55.9.
  - a pick: 33.3 50 16.8 33.4 33.4 33.3 33.4 33.4 16.8 16.8 33.3 16.7 33.4 33.4 16.8 16.8 33.4 33.3 16.8 33.3 (limit 50).
  - a pan and a pinch: at most 33.3 (limit 50).
- The whole file five times: `1 failed, 24 passed`. The failure: a pick at 66.6 ms (4 frames, limit 3), its tap 90.1 ms.

Profiled (`FEEL_PROFILE=1`, unminified build for the run, then put back), three runs of the map case. The pick's click
task is 35 to 42 ms: our script 12 to 20 (the map's `draw`: `mapScene` 2.5, the tokens' `bind` 2 to 3, the focus 1.5),
style 4 to 12 over about 48 elements, layout 3 to 4, paint 2 to 8. The busiest runs inside every measured window,
the pick's included, were Playwright's own: `captureSnapshot`/`visitNode`, tasks of 35 to 110 ms, one with a 30 ms
major GC. That is the trace's snapshot of the page at each action (`trace: 'retain-on-failure'` traces every test),
not the app. `feel.e2e.ts` now runs with `test.use({ trace: 'off' })`, with that reason at its top; the limits did not move.

After (trace off):
- The map case alone, twenty runs: `20 passed (2.4m)`. Use 50 50 50 49.9 50 66.7 50 33.4 50 50 50 50.1 83.3 50 50 33.4
  50 100 66.7 66.6 (one at the limit, six frames); pick 16.8 16.7 16.7 49.9 16.8 16.8 33.3 16.8 33.3 16.8 16.8 16.8
  16.8 16.8 16.8 16.8 33.4 50 33.4 16.8; pan and pinch at most 33.3.
- The whole file five times: `25 passed (3.2m)`. Worst per run: a fight turn 50 33.4 50 66.7 50 (limit 100, tap 59.8);
  a player watching 16.8 16.8 33.4 33.4 33.3 (limit 50); a maker 33.3 66.7 50 16.8 33.3 (limit 83, tap 86.3 against
  100); the sheet's scroll 16.8 16.8 33.4 16.8 16.8; pan and pinch 16.8 each; a pick 16.8 33.3 16.8 33.3 33.3; a use
  33.4 66.6 50 83.3 33.4 (tap 58.1).

Not changed: the pick's own 12 to 20 ms of script. A use at 100 ms once in twenty is at its limit; the maker's tap at
86.3 is within a fifth of 100.
