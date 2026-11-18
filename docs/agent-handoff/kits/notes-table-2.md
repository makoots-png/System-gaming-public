# Notes: what the table unit left, at the cause (brief-table-followup.md)

Goal (poteto mode): the GM and players meet the kits at the table, and the table unit left six things whose cause was
not named: three makers cases the merge broke, two browser tests that failed once, a room doc 19 characters under its
cap, a GM's own status that a player's phone cannot describe, and the makers' leftovers. The problem is that each was
recorded as a symptom ("passed on a rerun", "fits with an eighth") rather than fixed where it starts. The smallest
change expected: find each cause and fix it in the one place AGENTS.md names; cut the doc's wire shape so the worst
case has room again, and use that room to carry the GM's status defs once per doc.

## Log

- Start: main tree on `claude/zen-pasteur-ov4cgd`, clean, at 0a8b699. 20:19 UTC. No browser run before 20:40 (a timed
  CI pass on the box).
- 20:35: the lead merged U1 (626e835) under me; deps and charts rewritten before the first `bun run test`.

## Step 0: the three makers cases

- Cause: the table unit (685fe3b) replaced the GM card's `.cmb-fx` list (each status's `describeStatus` lines under the
  chips) with the detail control, so "Frostbite: 3d8 magical damage a round" and "Slowed: Speed −40%" moved behind a
  tap. The three cases ("the card says 3d8", "Speed −40%", "Speed −30%") assert what a GM reads at a glance.
- Which side is right: the tests. A GM running a fight reads what each status does to each body each round without
  tapping every chip; the detail is for the rest. But the old list was all of `describeStatus`, which with the kits
  grew a status's cap, threshold, triggers and end: too long for a glance.
- Fix: `statusGlance(def, tier, R)` in `src/core/detail.ts` (the ops' lines at the source's tier, "Each stack: ..." on a
  stacking one; the cap, threshold, triggers and end stay in the detail) and the `.cmb-fx` list back in `cardTemplate`
  over it. Tests: tests/detail.test.ts ("statusGlance": Slowed at A is Speed −40%, from statuses.ts's table; a stacking
  status's lines are per stack and its triggers and end are not in it).

## Step 1: the tests that failed once

### coin.e2e.ts "alone on a 360 px phone"

- Reproduced: a throwaway copy of the case's measurement, ten runs beside four busy loops on the 4-core box: 2 of 10
  failed (629.15 against 628.93; 630.03 against 629.49). Each failing run also read different heights for the two
  buttons (70.31 and 70.35), and the card had a running animation at the measure (`moving: 1`); the one run whose card
  was still read 628.61 for both.
- Cause: the coin card rises into place with `enter` (motion.ts: `translateY(10px) scale(.98)` to none), and the test
  read the two buttons' boxes in two separate `boundingBox` calls, a frame or more apart, while the scale and the
  translate moved. The layout was never wrong; the two numbers were taken at two moments of a move. The same read could
  also fail the 44 px check: at the start of the move a 44 px button is drawn 43.1 px tall.
- Fix: the test waits until the card has no running animation, then reads both boxes in one `evaluate` (one frame). Ten
  runs under the same load: 10 passed. It still fails if the buttons wrap onto two lines or shrink below 44 px.
- Not an app change: a thumb meets the buttons where they are drawn, and both move together.

### battle-map.e2e.ts (the table unit's one failure)

- The case is not named in notes-table.md ("the hotbar's first tap"), and no trace was kept (its output folder,
  /tmp/pw-table-bm, holds only the rerun's pass). The lead's token tap fix (13659c2) was already in the table unit's base
  (318b306), so it is not that.
- Tried: the whole file `--repeat-each=5` with traces kept on failure, beside four busy loops on the 4-core box, and for
  part of it a whole `bun test` as well: 75 passed in 19.4 minutes (12 to 22 s a case against about 5 idle). No failure
  to read.
- Not reproduced. I did not add a wait or a retry. The hotbar cases each wait on what the player sees before a tap
  (`expect(...).toBeVisible`, the doc's `at`), and the map's tap reads the token, not the screen, since 13659c2.

### kits.e2e.ts, the Glas case (failed once, by the worth unit's notes)

- Its failure was a test timeout (120 s) on the Fester step "while bun test ran beside it". The same unit's notes say its
  first full `bun test` of that hour had 86 failures and a clean rerun: the box paused then.
- Tried: the case five times beside four busy loops and `bun test` of the fight model and simulation: 5 passed, 12.9 to
  13.6 s each (10.6 s idle). A 120 s timeout needs a stall of over 100 s, which no load here comes near; a pause of the
  box fits it. The whole file passes (8 of 8) with this unit's two new cases.

## Step 2: the room doc's budget

Where the size went (the worst case `tests/protocol.test.ts` builds, before; a scratch print of `JSON.stringify` by
part): total 55,094. rows 42,781 (30 rows of 1,425: statuses 395, intent 472, channel 181, name 62, the rest numbers and
keys), zones 5,729, grid 3,235 (tiles 1,600, lit 1,600), log 1,516, ready 613, left 553, burst 107, armed 85, spent
85, the rest 166. Of a row's 1,425, about 480 were key names (`"shieldLeft":` is 13 characters for a 4-character
number) and 138 the six statuses' labels.

Three ways weighed:
- (a) Raise `DOC_MAX`: the server's 64 KiB body is the wall (`DOC_MAX`'s comment), and it moves the cause along.
- (b) Cut content (fewer rows or statuses, shorter intent lines): a GM would notice; the brief says the same content.
- (c) The same content in a shorter wire shape, read back to the same core types. Chosen.

What (c) is, in `fightWire` (fight-doc.ts) and the reader (protocol.ts `fightDocOf`):
- one or two letter names below the top level (the top level keeps its names: sync.ts `shorter` drops `log` by name);
- a field at its default left out (null, false, an empty list, tier 0);
- a place `[x, y]`, a band its index in `BANDS`;
- the lit line packed six tiles a character (`packBits`, base64url; 1,600 to 267). Run-length would not help the worst
  case (alternating tiles); a fixed six to one does. The tile text stays one character a tile (1,600): packed at
  three bits a tile it would save about 1,000 more, left for when the budget needs it;
- a status's def sent once in the doc's `defs` table (step 3) and the label then left off the status.

The server: it stores what `DOCS` read, so it now keeps the parsed doc and sends it back through `WIRES` (protocol.ts;
the fight's is `fightWire`, the rest as they are), both from the memory store (`wireDocs` in the room's answer) and
Postgres (`putDoc` stores the wire shape, which `board` reads with `DOCS`).

After: the same content plus each status's tier and the six built-ins' defs once: 44,557 (rows 32,821 at 1,093 a row,
zones 5,425, grid 1,902, log 1,516, defs 1,052). The other shape, the defs table full at `DOC_DEFS_MAX` (6,000) and every
other status named inline: 52,416, 58,968 with the eighth, 3,032 to spare. The test ("the worst-case doc on the wire,
in either shape ...") prints both by part and fails over eight ninths of `DOC_MAX`; `DOC_MAX`'s comment has the
arithmetic.

## Step 3: a GM's own status on a player's phone

- Data shape: the doc's `DocStatus` carries its source's `tier` and its `def` as the GM's phone holds it; on the wire
  each def goes once in the doc's `defs` by key (current row first, then the rows' order, at most `DOC_DEFS_MAX`), and a
  status whose def is the table's has no label of its own. A status whose def did not fit, or differs from the one the
  table holds under its key (an ability's def as written can share a key with another), carries its label and no def.
  The reader parses each def with `parseStatusDef` (the boundary) and puts it back on every status that names it, so
  table.js's chips (which already read `s.def`) need only the tier.
- Every status sends its def, built-ins too, rather than only the GM's own: the player's phone then says what the GM's
  phone holds even for a built-in the GM edited, and there is no "is it a built-in" rule to keep.
- Tests: tests/fight-doc.test.ts ("a status carries its def and its source's tier, and on the wire its def is sent
  once"), tests/protocol.test.ts (both worst-case shapes read back), tests/e2e/map-extras.e2e.ts ("the GM makes a status
  of their own on the rat's card, and the player opens it on the rat's token and reads what it does", and the stack case
  now reads "1 of 5 stack." and "At 2 stacks").

## Step 4: the rest

- A land effect row starts empty (kit-parts.js: a threshold's, a trigger's and an end's), so what lands is what the GM
  chose; the existing "Add what lands" errors already hold an empty one. The kits tests tap a quick chip first; the
  Resonance case asserts the empty list and its error.
- A searchable pick: `searchable` and `watchPicks` in maker.js. A `select[data-pick]` with more than 14 options (a 640 px
  screen at 44 px a row) gets a search field above it that hides the options it does not match, never the chosen one.
  A MutationObserver lays it on each such select as it reaches the page, so the effects editor, the kits' parts and the
  enemy maker get it with one attribute. Marked: every status select of the makers and the enemy maker's ability (a
  skill) and status adds. Its typing stops at the field, so no form reads it. Test: kits.e2e.ts ("a status list longer
  than a phone shows has a search ...").
- A field's upkeep and its end in the ability form's field group (maker.js): fatigue and mana a round (0 to `kit.hpFlat`,
  the parser's bound) and "Something lands when it ends, on time or early" with an empty land editor drawn when ticked.
  "Early end" is read as the zone's `end` ops, which land whenever the field ends (zones.ts `ZoneKit.end`,
  fight-turn.ts `zoneEnds`). Before, an edit dropped a saved field's upkeep, end and triggers; triggers have no control
  yet and are now kept as they came. Test: kits.e2e.ts ("a GM gives a field an upkeep ...").
- The Skills panel's card: its name is the detail control (an active skill's ability; a passive's worn status; a passive
  with none has no control, its card already says its bonus). Test: custom-skills.e2e.ts ("a skill's name on the Skills
  panel opens what it does ...").
- A `turn` reaction on the GM's card: offered with the others; arming it names the row it waits for (the one it waits for
  now, else the first of the other side still up), and a "Before the turn of" select changes it (combat.js `armRow`).
  Test: custom-skills.e2e.ts ("the GM arms a hunter's reaction that waits for a body's turn ...").
- Not done: the `vitals` effect's `used` to the sheet. The core step is `sheetEdit`'s `totals` in
  src/core/hunter/grant.ts (one field, `used`, and its line), with `setVitals` in hunter.js; both are on the reward path
  this round's brief told me to keep out of, and the edit was refused when tried. What it needs: `used` on `totals`
  (replacing the sheet's, as the row holds all of the hunter's rest-limited uses), `used: fx.used ?? {}` in combat.js's
  `vitals` line, `AbilityId` in api.ts's `setVitals`, and a test in tests/fight.test.ts beside "one a rest is written
  back": the effect's `used` through `sheetEdit` gives a hunter whose next row refuses the use, and `rest(..., 'long')`
  gives one whose row takes it. A remote hunter's uses would also need `used` on the room's `vitals` message and its
  applier (room-events.ts).

## Step 5: close

- `bun run deps -- --write` (in each commit), `bun run charts` (no change: no machine changed).
- `bun run typecheck`: clean. `bun run test`: "Ran 3066 tests across 78 files", 3063 pass, 0 fail.
- Browser files, one at a time on 3241, after the last code commit: makers 30 passed, coin 7, battle-map 15, table-turn
  8, map-extras 10, kits 8, custom-skills 9, look 15, phone 8; feel 5 passed, last. Feel was not alone on the box:
  another worktree's Playwright run (agent-a99c3b2e) started at the same minute. Its frames: a fight turn worst 100 ms
  (tap 86.7), a player watching 49.9, a maker opening 33.4 (tap 59.8), the sheet scrolling 16.8, a pan and a pinch 16.8,
  an ability picked 50 (tap 73.4), a use from the map 66.8 (tap 46.2). The fight turn's 100 against the table unit's
  83.4 is one run beside another browser; the lead's alone run decides it.
- AGENTS.md: the doc's row names `tier` and `def`; a row for the doc on the wire (`fightWire`, `WIRES`, the worst-case
  test); `statusGlance` in the detail row; the searchable pick in the makers row; the GM card's turn reaction.

## Principles that changed a choice (each leaf read this session)

- fix-root-causes: step 0's cause was named (the list moved behind a tap) before choosing a side; step 2 cut the doc
  where the characters went (key names, labels per row, the lit line) rather than at the cap.
- attack-the-premise: "the coin test failed on a timing of the measurement" was tested by reproducing it with the
  animation state printed beside each measure, before any change.
- prove-it-works: each fix was shown failing or measured before and after (the coin 2 of 10 then 10 of 10; the doc
  55,094 then 44,557 by part, printed by the test).
- benchmark-checklist and explain-the-number: the doc's sizes are characters of JSON of a stated worst case, with
  both of its shapes; the feel numbers are one run with another browser beside it, said so.
- unslop: notes and commit messages in plain sentences.

## Decision trail

- Step 0, which side: the tests (a GM reads per-round effects at a glance), but only the ops, not the kits' sentences.
  Weighed: the old list whole (too long with kits), detail only (the tests' complaint), the ops line. Chose the ops.
- Step 2, where to cut: (a) raise the cap, refused by the server's body limit; (b) cut content; (c) a wire shape read
  back to the same types. Chose (c). The server had to learn it: it stored the parsed doc and served it to be parsed
  again, so a wire shape needs `WIRES` on the way out.
- Step 3, which defs travel: only the GM's own (needs a "same as built-in" compare) or every one (simpler, and a GM's
  edited built-in reads right). Chose every one, bounded by `DOC_DEFS_MAX`; the label goes inline only when the def
  did not fit or differs from the table's under its key.
- Step 4, the searchable pick: a component each view calls after drawing, or one observer that lays it on a marked
  select wherever it appears. Chose the observer: one attribute per select, no call to forget in a redraw.
- Contested, for the lead: the doc's `defs` makes a typical doc larger (each status's def once, 1,052 for the six
  built-ins) for a player's detail; the vitals `used` item left undone because its step is in grant.ts.

## Left

- The `vitals` effect's `used` to the sheet (step 4's last item): what it needs is under Step 4.
- battle-map's one failure was not reproduced in 75 runs under load; nothing changed for it.
- A field's triggers have no control in the ability form (kept as they came).
- "1 of 5 stack." in detail.ts reads oddly for a count of a cap; a copy task.
