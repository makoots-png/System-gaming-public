# Notes: implicit audit unit U9, "The map's choice and gestures" (rows 47, 48)

Goal: a tap, a drag, a pan or a pinch on the battle map does what the finger did, every time, on both phones, and the
map never sends a move or a use twice or one the scene did not offer. The problem: map.js tracked its gestures with
`g.kind`, `quiet`, `pts`, a hold timer and `brush` across five handlers, and its choice (select, pick, aim, confirm)
with `sel`, `picked`, `before`, `drawer`, `sentWay`, `lastWay` and `actorWas`; nothing tested either flow. The
smallest change that meets it: two pure machines in core (`src/core/combat/gesture.ts`, `choose` in
`src/core/combat/map-view.ts`), each a table with its chart and walk events, map.js feeding DOM events in and carrying
effects out, and a property test over random pointer sequences.

Brief: `brief-implicit-unit.md`. Main tree, branch `claude/zen-pasteur-ov4cgd`, from b0a27a8. Port 3241. No browser
run before 23:23 (a timed CI pass was using the box).

## Causes, one sentence each

- Row 48. The gesture was five handlers sharing `g`, `pts` and `quiet`, and a tap was the browser's `click`, which
  arrives after the gesture with nothing tying it to the press that made it; `quiet` stood for "the click that follows
  a gesture", and a gesture with no click after it (a touch pan) left `quiet` set for the next click on Grid or Paint.
- Row 47. The choice was a typed `sel` plus five loose values (`picked` beside `sel.ability`, `before`, `drawer`,
  `sentWay`, `lastWay`) reset in `draw`, `tap`, `go`, `pick`, `cancel` and the double tap's handler, so which value
  was current after a turn's change or a kit's change was read off the order of lines in `draw`.

## Data shape (before code)

- The gesture (`src/core/combat/gesture.ts`): `Gesture` is a union of seven states, `idle`, `maybe` (one finger, not
  past 8 px: a tap if it lifts now), `pan`, `drag` (the GM's lifted token, `far` once carried past 8 px), `pinch`,
  `paint`, `rest` (fingers still down after a pinch ended or a third finger came). The audit named six; `rest` is the
  seventh, the old code's "g is pinch and pts.size is not 2", which it handled by doing nothing in `pointermove`.
  Events: `down` (pointer id, frame point, what it touched as `Target` {tok, tile}, the pan and zoom then, the `Mode`
  `look`, `arrange` or `paint`), `move`, `up` (each with the tile under the finger), `cancel`, `hold`. Effects:
  `capture`, `timer`, `untimer`, `view`, `lift`, `carry`, `putBack`, and the three commands `tap`, `drop`, `paint`.
  `Mode` is one union where the old code read `brush` and `src.place` side by side.
- The choice (`choose` in map-view.ts): `Choice = { now: Chosen, taps, actor, drawer, sent }`; `Chosen` is `none`,
  `move {to}` or `aim {ability, at}` with the kit's own `Ability` inside (the old `picked` beside `sel.ability`). The
  table is keyed by `now.kind` and the events `seen`, `drawn`, `tap`, `double`, `pick`, `cancel`, `go`, `pass`,
  `more`; the effects `card`, `zone`, `refuse`, `offTurn`, `move`, `use`, `pass`, `along`.

## Variants weighed (on paper; a helper starts no helpers)

When a tap is decided:
1. At the browser's `click`, with `quiet` made a state of the machine ("the click after a gesture is swallowed").
   Keeps the platform's click, but a press whose click never comes (a long touch, the token's button moved by a redraw
   between down and up, a pointer captured elsewhere) is still a lost tap, and `quiet` still outlives a touch pan.
2. At the finger's lift, in the machine, from what the finger touched at `down`. The browser's `click` is then only a
   key on a token's button (`detail === 0`); a pointer's clicks are ignored. Every press ends in its `up` or `cancel`
   because the frame captures each pointer at `down`. Chosen.
3. At the lift, with the double tap timed in core (`up` with a time, a 300 ms window). Rejected: Playwright's
   `dblclick` sends `clickCount: 2`, so the browser's `dblclick` is the same in a test whatever the box does between the
   two clicks, and a window of our own would split a double tap on a paused box. The double tap stays the browser's
   `dblclick`; the choice keeps the last two taps (`taps`) so it puts back what both taps of the pair chose.

Where the stale-scene guard lives: `go` sends only when the scene it is given was drawn from the choice as it is now
(the same tile for a move; the same ability object and tile for a use). Alternatives: compute the scene inside `go`
(heavier input for every event), or keep the scene in the choice (a derived value stored, audit kind 4). The check is
two comparisons and the property test drives stale scenes.

## Findings while reading (the "perfect" rule: what could lose or misread a tap or a drag)

- A GM's slow tap on a token is lost. On the GM's map a press on a token starts a 450 ms timer; past it the press is a
  drag, and a drag let go where it began did nothing, and set `quiet`, so the click that followed was swallowed. On a
  paused box, Playwright's `touchscreen.tap` or `locator.tap()` on a token of the GM's map can take longer than 450 ms
  between its touch start and end. battle-map.e2e.ts taps tokens on the GM's map at lines 185 and 189 (the attack
  case) and 276 (the blast case), feel.e2e.ts at line 325. This is the likeliest cause of the one failure with no
  trace. Fixed: a press held and let go without moving past 8 px is a tap (`drag.up` with `far` false).
- After a touch pan, a pinch, a drag or a moved paint stroke, the first tap on Grid or Paint could do nothing: `quiet`
  was set at the gesture's end, a touch that moved gets no click to clear it, and a press on Grid or Paint returned
  before `quiet` was reset. Fixed by deleting `quiet`: the tools' clicks never pass through the gesture. (Read from the
  code; the browser case I wrote for it could not show it, see the next point.)
- Measured in the browser (event log in the page, old and new map.js alike): Chrome sends no `click` at all for a touch
  tap about 60 ms after a touch pan (pointerdown and pointerup arrive, click does not). The old map tapped on `click`, so
  a tap on a tile right after a pan was lost; the new map taps at the lift and keeps it. The browser case "right after
  a pan with a finger, a tap on a tile in the movement area chooses it" fails on the old map.js and passes on the new.
  The buttons that still act on `click` (Grid, Paint, the hotbar, Move and Use) keep that exposure; it is Chrome's tap
  suppression after a scroll gesture, and moving every button to the lift is outside this unit. Left, named here.
- A mouse press released outside the frame before it moved 8 px left its pointer in `pts` for good (no capture until a
  pan); every later press was then a second finger, a pinch. Fixed: the frame captures every pointer at `down`, and a
  lost capture is a `cancel`.
- Move or Use pressed twice before the next frame (two clicks in one frame on a slow phone) read `scene.focus` twice
  from the same stale scene and sent the command twice. Fixed: `go` puts the choice down in the same step and sends
  only for a scene drawn from the choice as it is now.
- A redraw between down and up (a doc arriving) cannot move a tap now: the target is read at `down`; a token's tap goes
  to that body's tile as drawn at the tap.
- The hotbar's own hold (`hold`, `swallow`, 350 ms, `--t-hold`) has the same exposure on a paused box: a hotbar tap held
  past 350 ms opens the ability's detail and does not pick. Left as designed: a hold there shows something (the detail),
  where the token's hold showed nothing. Named in the reply as a risk for a test on a paused box.

## Rows

### Row 48: the gesture machine

- Cause: above.
- Change: `src/core/combat/gesture.ts` (new): `Gesture`, `GestureEvent`, `GestureFx`, `TABLE` (seven states by five
  events; null where an event does not apply), `gesture(g, e)`, `fingers(g)`, `zoomAbout` (the wheel's and the pinch's
  arithmetic, with the zoom's bounds). The dispatcher holds one rule for every state: a move, lift or cancel of a
  finger the gesture does not hold, and a second down of one it holds, change nothing. map.js's `feed` turns each
  pointer event into an event (the frame's place read once at a gesture's first finger, the tile under the finger
  worked out from the pan and zoom), and carries out the effects. Deleted from map.js: `pts`, `quiet`, the old `g` with
  its expando `timer`, `tileAt`'s layout read per call, the four gesture handlers' branches, `HOLD_MS` and the pinch's
  arithmetic. A tap is decided at the lift; the frame's `click` taps only for a key on a token's button.
- Tests: `tests/gesture.test.ts` (new): a tap, the 8 px slop, a pan, a cancel, a hover, a player's press never lifted;
  the GM's hold, carry and drop once, a slow tap, a token brought back, a pan before the hold, a second finger on a
  lifted token; a pinch keeps the world's spot under the fingers' middle (worked by hand: (150, 100) at zoom 0.5 is world
  (300, 200), and at zoom 1 must sit under (200, 100)); the zoom's bounds; a paint stroke, a cancelled one, one turned
  into a pinch. The last case walks 400 seeded sequences of 60 random pointer events on three fingers in every mode and
  checks after each event: the gesture holds exactly the fingers down; one command a gesture, a tap on what the first
  finger touched, a drop only in arrange mode onto another tile, a paint only in paint mode; a lifted token put back
  once; no hold timer running with no finger down; the map moves only in a pan or a pinch. A mutation (the lift of a
  press not clearing the hold timer) fails it.
- Browser: battle-map.e2e.ts "the GM's slow tap on a monster ... opens its card and moves nothing" and "right after a
  pan with a finger, a tap on a tile in the movement area chooses it". Both fail on the old map.js (written back into
  the tree for one run, then the new one restored) and pass on the new.

### Row 47: the choice machine

- Cause: above.
- Change: `choose` in `src/core/combat/map-view.ts`: `Chosen`, `Choice`, `ChoiceEvent`, `ChoiceFx`, `CHOICE_TABLE`
  (three kinds of choice by nine events). map.js's `act` gives it the events and carries out the effects, and `draw`
  gives it `seen` (whose turn, the kit, whether a move waits) before the scene and `drawn` after. Deleted from map.js:
  `sel`, `picked`, `before`, `drawer`, `actorWas`, `sentWay`, `lastWay`, `tap`, `cancel`, `go`, and the second
  `mapScene` call in `draw` (a move the scene no longer offers drew the same scene as none: a move focus with no path
  shades the stride and dash only, and `tapOn` reads it as none).
- Tests: tests/map-view.test.ts, "what the map has chosen": a tile tapped and Move sent once, a second press on the
  stale scene sends nothing; a sent move's way and its `along` once; a double tap puts back what its two taps chose; a
  new turn; an ability that leaves the kit and one that changed (the kit's own is sent); Use from a scene drawn before
  the last tap sends nothing; off the turn; a tile no longer offered. The last case walks 300 seeded sequences of 50
  random events, with Move and Use given the fresh scene or one up to three events old, and checks that each command
  sent is exactly the fresh scene's offer for the choice and that the viewer chose again between two commands. Two
  mutations (`go` not putting the choice down; `go` not checking the scene against the choice) each fail it.

### Charts

`scripts/charts/gesture.ts` and `scripts/charts/choice.ts`, walk events in `tests/models/gesture-events.ts` and
`tests/models/choice-events.ts`, both in `MACHINES`. The statechart skill's TLC run needs mise and a download, which this
box does not allow (as U7 found); each machine was drawn on paper first (the state and arrow lists above under Data
shape) and its chart is the repo's walk of the real table. The gesture chart: 9 boxes, 27 arrows, none hidden. The
choice chart: 5 boxes, 23 arrows, the double tap hidden (it can lead from any box to any other).

### The lint

tests/lint.test.ts "a view keeps no machine in flags: its closure state is counted per file, and two booleans in one let
fail" (audit kind 1). Each view file's count of `let` lines four spaces in or less is named with its owner; the count
may only fall. Two booleans in one `let` fail outright, with an empty allow-list. The map import lint now names the two
machines' exports and no longer `tapOn`.

## Timeline

- 23:18: the lead asked for no browser run for 35 minutes (a timed CI pass). The browser files wait until after 23:53.
- 01:20: resumed after the usage reset. battle-map.e2e.ts: 16 of 17 passed; the Grid case failed. Its event log showed
  Chrome sends no click for that tap (old map.js the same), so the case became the tile-tap case above.
- 01:28 to 02:05: every browser file but feel, one at a time on port 3241, nothing else of mine running: all passed
  but phone.e2e.ts, whose 360 by 640 sweep failed twice in the whole file (passed once alone): every control of the GM's
  item maker measured 43 px. Cause: the sweep measured the maker while its window still rose in from 98% of its size
  (motion.ts `enter`, `scale(.98)`); 44 x 0.98 is 43.1. Not U9's code. Fix, in its own commit in a file outside the
  unit: the sweep waits for the window's animations to finish (`getAnimations` ... `finished`) before it measures. Then
  phone.e2e.ts: 8 passed.
- 02:14: tests/e2e/feel.e2e.ts alone of my runs, 5 passed. Not a quiet box: two other helpers' Playwright runs were going
  (U15's phone.e2e.ts in its worktree, and a table-turn.e2e.ts sweep), 33 Chromium processes. The map case: a pan and a
  pinch worst 16.8 ms (one frame, as in the file's baseline), an ability picked worst 33.4 ms (as before), a use worst
  50 ms (at or under 83.4).

## Commits

- e602b0b: the two machines, map.js wired to them, charts, walk events, tests, the lints, AGENTS.md.
- b708244: the two browser cases, for-the-owner.md, these notes.
- 771e42d: phone.e2e.ts waits for a maker's opening motion before it measures (outside the unit, its own commit).
- this notes commit.

## Left, and why

- (Done in the second round, below: the hotbar's hold and the map's buttons.)
- The kind 1 lint names every view file's closure `let` count as of this unit; a helper in another worktree that adds a
  closure `let` to a view will see it fail on merge, by design.

Principles that changed a choice: model-the-domain (two tables in core, effects out, in place of nine flags);
type-system-discipline (`Mode` one union where `brush` and `src.place` were read side by side; `Chosen` holds the
kit's own `Ability`, so `picked` beside `sel.ability` could go); boundary-discipline (the DOM event is read once into a
`GestureEvent`, the tile under the finger worked out at that moment; core trusts it); fix-root-causes (the slow tap and
the post-pan tap fixed where the tap is decided, not by a longer hold or a retry); test-behavior-not-implementation
(the random walks check what a player sees, a command once and only the one offered; mutations show they fail);
subtract-before-you-add (the second `mapScene` call deleted after showing it drew the same scene).

## Second round (the lead: "perfect": the two leftovers are not left)

Cause, one sentence: the map's buttons acted on the browser's `click`, which Chrome does not send for a tap that comes
right after a fast touch pan on the map, and the hotbar's hold was a second press machine in the view (`hold`,
`swallow`, its own timer) beside the map's.

- Change (9d0b140 and the next commit): the gesture machine has two more states, `press` (a finger on a control, `timed`
  while a hotbar slot's hold runs) and `held` (its detail shown; the lift does nothing), and two more ends, `press` and
  `detail`. `Press` (the down's `press`) is a union: on the map, or on a control with its hold time. `up` carries the
  control under the finger, so a press acts only when the finger lifts on the control it came down on. map.js listens
  on the whole map component: `controlOf` names the control (Grid, Paint, a slot `ab:` or `arm:`, Move or Use `go`,
  Cancel, More, a brush, Release, End turn, a Pin, the detail `dt`), `run` does what it does; a key's click (`detail`
  0) still runs it. Deleted: `hold`, `swallow`, `letGo`, the view's `SLOP`, the hotbar's own timer and listeners, the
  click handlers of the frame and the component. A finger on the map is captured by the frame (so a double tap's
  `dblclick` still reaches it), one on a control by the component.
- A finding on the way: with every pointer captured by the component, the browser sent a mouse double tap's `dblclick`
  to the component, not the frame, and four mouse cases of battle-map.e2e.ts failed (the map was never framed again, so
  a tile sat outside the frame). Fixed by capturing a map finger on the frame.
- Tests: tests/gesture.test.ts "a control of the map" (a press once, a slide off, a scroll the browser takes, a hold
  and its lift, a slide that ends the hold but still picks, a press right after a pan, a second finger), and the random
  walk now presses controls (a press only of the control first touched and lifted on, a detail only of a held one, one
  end a gesture). Browser: battle-map.e2e.ts "right after a pan with a finger, a tap on Use sends the use once" (the
  fight's log holds one Strike); it fails with the click-based map.js and gesture.ts of c2d86a3 and passes now.
- The lints: map.js's timers named fall from 3 to 2 and its closure `let` lines from 16 to 15.

### Measured: does Chrome drop a click after a touch drag elsewhere?

A scratch Playwright case (not committed; in the scratchpad), GM phone 390 by 844 with touch: a drag by CDP touch
events on the surface, then a tap on a control at once, the click recorded in the capture phase. "Fast": four moves
back to back (a flick). "Slow": moves 60 ms apart and a 300 ms rest before the lift.

| Surface, then the control | Fast | Slow |
|---|---|---|
| The page scrolled (Workshop), then a button | click | click |
| A maker's form scrolled (the item maker), then a chip | click | click |
| The Fight tools sheet scrolled, then a button | click | click |
| The turn order strip dragged (it does not scroll), then a hotbar slot | click | click |
| The hotbar scrolled sideways, then a slot | click, picked | click, picked (see below) |
| The map panned (touch-action none), then Grid | no click; Grid toggled (the lift) | click; Grid toggled |

So Chrome drops the click only after a flick on the map's frame, which has `touch-action: none`: the flick ends in a
fling Chrome cannot run, and the next tap is taken as the one that stops it. A native scroller (the page, a form, the
sheet) delivers the click after the same flick. Nothing outside the map needed a fix. (In the slow row the slot read
not picked because the case before it had tapped the same slot with the click stopped, and the map's lift had picked
it already; the pick toggled off. A measurement artefact, not a dropped tap.)

## Third round: a tap read as a hold on a busy page (the lead's finding)

Finding: the outbox helper saw battle-map.e2e.ts fail 5 cases under load, on its branch and on c2d86a3; quiet CI passed.

- Reproduced, step by step. Four busy shell loops on the 4-core box: 18 passed (Chrome kept its share). CPU throttle
  10x on both phones: 18 passed. A page block: a 900 ms task 30 ms after the press, with the lift sent by CDP at
  100 ms, so the lift waits behind the task: the GM's token tap passed (the slow-tap rule of the first round makes a
  held-but-unmoved token a tap), the hotbar tap failed. Trace of the gesture: `down@6796`, then the timer's
  `hold` heard at 7812, then `up@6915` heard at 7815: the lift happened 119 ms after the press, inside the 350 ms hold,
  and was heard after the timer. On c2d86a3 the hotbar's own `setTimeout` and `swallow` did the same, and five cases
  of battle-map pick from the hotbar; that fits the 5 failures (inferred: their traces were not kept).
- Cause, one sentence: a hold was decided by which callback the page ran first, the timer or the lift, not by when the
  finger did each thing.
- Fix (gesture.ts): every pointer event carries `t`, its `PointerEvent.timeStamp`; the timer's end only says "look". A
  hold stands until an event timed inside the hold window says otherwise: in `held`, a lift timed before `t0 + hold`
  takes the detail back (`undetail`) and presses the slot; a slide timed before it takes the detail back and is a press
  that is no longer a hold. In `drag`, a move past 8 px timed before `t0 + HOLD_MS` was a pan: the token is put back and
  the map pans (it can never be dropped); a lift without a move was already a tap.
- A second cause the trace showed: the slot's press was read at the lift by `elementFromPoint`, and by then the detail
  that the early timer opened had pushed the hotbar down, so the lift was "on" the detail. Now a control's box is read
  when the finger comes down (`Press.area`) and the lift presses when it is inside that box, so a redraw or a detail
  before the lift is heard cannot move the control from under the finger. A slot that is off (not ready) is `off`: held
  for its detail, never pressed (the browser never clicked a disabled button).
- Tests: tests/gesture.test.ts "a page too busy to hear a finger in time" (a lift timed in the window, heard after the
  hold: detail taken back and the slot picked; a lift after the window: the hold stands; a GM's move timed before the
  hold, heard after: a pan, nothing dropped; a GM's lift in the window: a tap), a slot that is off; the random walk's
  events carry increasing times and check that only a shown detail is taken back. Browser: battle-map.e2e.ts "on a page
  too busy to hear a quick tap on a hotbar slot before its hold time, the tap still picks it" (failed before the fix,
  passes after) and the GM's monster case.
- The chart: 12 boxes, 34 arrows; hidden, a second finger on any one-finger gesture but the map press.
- 04:26 to 05:08, on 60168d4 (with U15, U2 to U4 and U8 merged in), every browser file but feel, one at a time on port
  3241: all passed (battle-map 20, character 23, coin 7, combat-turns 14, custom-skills 9, customization 9, dice 5,
  fight-vitals 3, gates-quests-dailies 23, kits 8, layout 6, look 15, makers 33, map-extras 10, maps 9, phone 8, pwa 3,
  reward-room 1, rewards 5, room-onboarding 6, room-sync-fixes 15, room-sync 1, room-view 10, save 7, sharing 6,
  table-session 7, table-turn 9, upgrade 6, used 7).
- The map's sends after the outbox merge: map.js still sends only through its choice (`go`, `pass`) and the phone's
  `MapSource` (`src.move`, `src.use`, `src.pass`), which combat.js and table.js now back with the outbox; nothing of
  mine conflicts with it.
- Push 30 was refused on "on a page too busy to hear a quick tap on a hotbar slot ...": aria-pressed stayed false.
  Cause, from the test, not the app: the case made the tap's duration by a real 100 ms wait between two CDP touches
  and the page busy by a 900 ms loop, so on a loaded box (CI runs two workers) the lift could truly come past the
  350 ms hold, and the machine, reading the events' own times, rightly took it as a hold. Fixed in the test: the
  touches carry their times (`timestamp` of `Input.dispatchTouchEvent`; a probe showed Chrome's `timeStamp` follows
  it: a lift sent 600 ms after the press read 100 ms), and the lift is sent only once the page shows it ran the hold
  (the detail open, or the GM's token lifted), so the page hears the lift late every time and its time is inside the
  window every time. The busy loop is gone. Checks: the two cases `--repeat-each=10` alone, 20 passed; beside four busy
  shell loops, 20 passed; on 33fb5fb's map.js and gesture.ts (holds by the timer) the hotbar case fails and the GM's
  passes (that one was already a tap by the first round's rule).
- The first full `bun run test` after this had 10 room-model failures; the tree moved under it (U10 merged as e471f75 mid-run: 3248 tests then, 3271 after). Rerun: `Ran 3271 tests across 85 files`, 0 fail.
- 08:08 to 08:47 on f168c82: every browser file but feel, one at a time, all passed (battle-map 20, gates-quests-dailies 24, save 14, reward-room 2, the rest as before). Then feel.e2e.ts, 5 passed; 13 Chromium processes of other helpers were up. Map case: pan and pinch worst 16.8 ms, pick 16.8 ms, use 66.7 ms (at or under 83).
