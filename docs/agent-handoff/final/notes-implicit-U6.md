# Notes: U6 of the implicit audit (windows, makers, onboarding)

Main tree, branch `claude/zen-pasteur-ov4cgd`, Playwright port 3241.

## Row 0 (added by the lead): a tap lost in the skill maker

Cause: the maker scrolled the focused field to the middle of the form 250 ms after it took focus (a `focusin`
handler with `setTimeout(…, 250)`, the sleep of audit row 10), so a tap made within 250 ms of a fill landed after the
form had jumped under the finger.

What the CI trace (push 26, `trace-26/trace.zip`) showed:

- `fill` of the formula field at 393 560 ms (trace time): the field takes focus, the timer starts.
- `selectOption('resonance')` at 393 755, then the chip's tap: Playwright scrolled the chip into view (the
  `.mk-scroll` scrollTop is 508 in the tap's input snapshot), computed the point (132, 388) and performed the touch
  at 393 811 to 393 837.
- The after snapshot of the tap has the `.mk-scroll` scrollTop at 213: the form moved up by 295 px during the tap.
  Nothing in the test scrolls; 393 566 + 250 = 393 816, inside the tap. The touch landed on whatever lay 295 px
  above the chip, the chip's handler never ran, and the field kept `0.6 * (2d6 + mag) * (1 + 0.15 * `.
- Not the suspects: no line came or went (the error and averages lines were already there before the tap, the
  `aria-invalid` flip is on the fill), the searchable pick did not redraw (the snapshot of the tap refers back to
  the earlier snapshot's nodes for the label and select, so they were unchanged), and the group was open (the
  summary tap ended 50 ms before).

Fix: the timer is gone. The maker moves its form only on the visual viewport's resize (`fit` in `openMaker`, the
keyboard opening or closing): when the focused field then lies outside the scroller's box, it is brought to the
middle. On a desktop or in a test no resize happens, so nothing moves under a tap. This is also row 10.

Sweep: `focusin`, and `setTimeout` or `requestAnimationFrame` beside `scroll`/`focus`, over `src/views`: the
maker's was the only delayed move. `gm.js:334` scrolls one frame after the GM's own tap on Award, not under a
later tap.

Tests (`tests/e2e/makers.e2e.ts`):

- "in the skill maker the form holds still after the GM types a formula, …": the clock is installed, the formula
  filled, the chip scrolled into view, the clock run a second; the chip's box must not move, and its tap puts
  `target.stacks(prone)` in. Fails without the fix (the faked 250 ms timer fires inside `runFor`).
- "when the phone's keyboard opens under a maker, the field … stays in view above it": the viewport shrinks to
  400 px under a focused Cooldown field at the bottom of the form; the field must be wholly in view.

Reproduction: `--repeat-each=10` of the Glas case beside four busy shell loops passed 10 of 10 (1.7 min). Under load
the steps are slower than 250 ms apart, so the scroll comes before Playwright measures the chip and the tap is right;
the bug needs the tap to start inside the 250 ms, which CI hit once. The clock test makes that timing exact: on the
old code it fails with the chip moved from y 366 to y 661, 295 px, the same distance as in the CI trace. The keyboard
case fails when `fit` leaves out its scroll, so it proves the new code.

Lint: "a view never scrolls on a timer" (`tests/lint.test.ts`): a `setTimeout(` on a line with a scroll. Empty.

Row 10 is the same change (the maker's half); the store's flush is left as the audit says.

## Rows 4, 5, 6: one window stack

Cause (4): "is a window open" was two DOM selectors, `modalOpen` in app.js (five selectors, the dice sheet) and the one in
`news` (`.overlay.show` and `[data-over-map]`), which disagreed on the dice roller and the Fight tools.
Cause (5): the System queue's states (waiting, opening late, open, leaving) were a `queue` array, an `open` boolean,
`refreshCur` and a `setTimeout(next, LATE)`.
Cause (6): three window systems (the System queue, the maker's `open` array, onboarding's `root`) each put a capture
keydown listener on the document; `stopPropagation` does not stop another listener on the same node, so Escape on a
question over a maker closed both.

Change: the window stack in `src/views/ui.js`, one entry per window, `state: 'queued' | 'open' | 'leaving'` and
`kind: 'system' | 'maker' | 'onboard' | 'sheet'`. One document keydown listener hands each key to the top open window
that is not a sheet; `trapTab` is the one focus trap. `system` queues on it (a System window waits while another is
open, and the next opens a task after the last went, as before); `openWindow` and `closeWindow` are how the maker and
onboarding open and leave; `sheet(el, on)` is called by dice.js and combat.js when they draw their sheet (one line
each, the smallest change in files that are not mine). `windowOpen()` replaces `modalOpen` and the news selector; a
sheet counts only while drawn (its view shown), so a Fight tools sheet left open in a hidden view does not block keys.
Behaviour change in for-the-owner.md: news is a toast while the dice roller is open over a map; the tab keys do nothing
while the Fight tools are open over a map.

I kept the stack in ui.js, not core: it holds DOM nodes and key handlers, and the audit names ui.js. Its order rule is
small (a System window waits for the System window up); a core table would carry the same three lines.

Lint (kind 2 of the audit): "a window opens on the one window stack of src/views/ui.js": no view but ui.js takes
`querySelectorAll(FOCUSABLE)` or a document keydown for a window, and a view that draws `aria-modal` calls `openWindow`.

## Row 7: an edited maker asks before Escape or the backdrop drops it

Cause: the maker shell had no clean or edited state, so Escape and a press beside the window called `finish(null)`.

Change: the shell's form is `'clean' | 'edited'`; a trusted input, change or button tap inside the body makes it
`edited` (the search above a long list stops its events at itself; a group's summary is not a button). Escape and the
backdrop call `leave`, which on an edited form opens `confirm` "Discard changes?" over the maker; Cancel does not ask.
The audit said "a maker body answers `edited()`": I put it in the shell instead, so every maker (status, item, skill,
monster, reward, map) gets it with no line of its own and none can forget it.

Test: "a press beside an edited maker or Escape asks before it drops the GM's work; Escape on that question closes only
the question; an untouched maker just closes" (makers.e2e.ts). On the old code the first Escape on the edited form
closes it, so the question is never visible.

## Row 72: the starter campaign in one step, the seed hunter marked

Cause: `applyStarter` was about fifteen writes (hunters, then per pregen an item, a wear, a refill, then gates, quests,
a log line), and a throw part way left half a campaign under "Choose Blank instead"; the seed was told by
`h.name === 'Sung Jin-Woo'` and five field values.

Change: `src/core/starter.ts`: `starterCampaign(save, { hunters, gates }, stamp, R)` builds the pregens (job, stats,
skills, gear worn, full HP and mana, the arc's quests), drops the seed, sets the first active and the GM mode, spawns
the gates and logs, all in one answer; ids come from the save's `seq`. The view makes the hunters with
`store.newHunter` and rolls the gates with a new `gates.roll` (gates.js's `spawn` split into `roll` and the write: one
small change in a file not mine; `GatesApi.roll` in api.ts). The seed is `seed: true` on the hunter `starterHunter`
makes (save.ts: the type, the repair line `optional(h, 'seed', v => v === true)`, a case in save.test.ts);
`neutralSeed` drops it; `seedOf` and `ownSeed` read and own it. A change: `ownSeed` takes the seed whatever else is in
the party (before, only when it was the one hunter and its fields untouched); setup runs before any play, so the seed
is untouched there.

Tests: `tests/starter.test.ts` (the party, each pregen's job, stats, skills, gear worn, full HP and mana from the
sheet's maxima, the arc on each, the gates and monsters, fresh ids, the log line; a wrong number of hunters is
refused and nothing written), a seed case in `tests/save.test.ts`. Lint: "the seed hunter is told by its seed mark,
never by its name or its starting fields".

## Row 71: first-run setup as a machine

Cause: the steps were functions that swapped one overlay; `onboarded` was written at a different point per path
(`done()`, or `mark()` before the room offer); `setTimeout(start, 0)` stood for "after every module registered".

Change: `src/core/onboarding.ts`: `ONBOARD_STEPS`, `ONBOARD_EVENTS`, `TABLE` (every cell), `onboardStep` answering
`{ to, marks }`: a transition marks the save onboarded when it leaves the setup steps (into `room` or `done`).
onboard.js draws `DRAW[at]` and sends every button through `go(event, write)`, which writes the choice and the mark in
one `store.apply` (`both`). Start is the app's new `ready` event (events.ts, emitted once in app.js after the
modules registered and the first route drew). The room offer with no room server ends at once with `later`. Chart:
`scripts/charts/onboarding.ts`, in `MACHINES`, walked with `tests/models/onboarding-events.ts`.

Tests: `tests/onboarding.test.ts`: the paths, every loop-free way from a start to `done` marks exactly once, the GM is
marked on reaching the room offer, Back and other options never mark, `done` is reachable from every step and
answers nothing, a stale event is null.

## Commits and checks

e9c249a (rows 0 and 10), 63572bf (gates.roll, not my file), 305fb09 (rows 4 to 7, 71, 72), 92bff80 (dice.js and
combat.js call `ui.sheet`, not my files). Checks: `bun run typecheck` clean; `bun test` 3106 tests, 0 fail;
browser files, port 3241: makers 33 passed, room-onboarding 6 passed, kits 8 passed, combat-turns 14 passed. Not run:
feel.e2e.ts (the lead's), look and phone.

Left: the store's flush timing (row 10's second half) is left as the audit says. The window stack's order rule stays in
ui.js rather than a core table (see rows 4 to 6).
