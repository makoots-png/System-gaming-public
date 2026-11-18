# Notes: implicit audit unit U10, "The GM view and the codex" (rows 53, 54, 56, 58 gm.js, 76, 77, 86 gm.js, GM sends of 19)

Helper: Opus, worktree `.claude/worktrees/agent-adda3724770fece92`, branch `worktree-agent-adda3724770fece92`, from
`claude/zen-pasteur-ov4cgd` at 827e9bf. Playwright port 3271.

## Goal

A GM never reads a log or a screen that says something happened when it did not, and a player never misses what the
GM sent. The problems: the session number is read back from a log that drops old lines; Start session swallows the
day's error and logs "Day advanced" either way; the GM view's awards, HP, statuses, broadcasts and quests to players go
out once with no record; the players' codex is cut at a quarter of what the room takes; a defeat's codex record is two
writes. The smallest change that meets it: a session counter in the save written by one core step with the day it
moves; `advanceDay` answering what it did and writing its own line; gm.js posting to the outbox; `codexDoc` in core cut
to `DOC_MAX`; the codex record and its auto-added monster in one step; the roll tables drawn through roll.ts.

## Decision trail

(Newest last.)

1. Read helper-rules, the brief, AGENTS.md, START-HERE, poteto-mode, the audit (U10's rows and entry), notes U2, U4,
   U5, rw/principles.md, and the leaves of model-the-domain, type-system-discipline, boundary-discipline,
   prove-it-works, make-operations-idempotent, subtract-before-you-add, test-behavior-not-implementation,
   fix-root-causes, unslop.
2. Data shapes before code. A codex doc is protocol.ts's `CodexDoc`; `codexDoc(codex, info, at, max)` builds it in
   core, the view passing only `info` (a monster's body needs the bestiary list and the rules). A move of the day is
   `DayMoved` (`save`, `day`, `by`, `broke`); a session is that plus `session`. No machine: none of the rows has states
   of its own (a session count is a number, a codex record a step).
3. Row 77, "one event". Read two ways: (a) one app event (drop `combat:end`'s handler, keep `combat:defeated`), or (b)
   one write and so one store change. (a) loses rows that go down without the fight's `defeated` effect: a monster set
   to 0 HP before the fight begins never passes through `consequences`, yet the fight's summary counts it. Chosen (b):
   the auto-added monster and the record are one step, which refuses a row counted already, so the second ask changes
   nothing (make-operations-idempotent). The view's own `codexSeen` check is deleted; the core step is the one rule.
4. Row 54's "advanceDay answers what it did": the "World day" line moved from gm.js into world.ts `advanceDay`, so the
   line is written in the same step as the move and says the days it really moved (a move back stops at day 1). This
   means the Gates view's day buttons now log a "World day" line too (for-the-owner.md). A move that leaves the day
   where it was is refused (it used to write the save and log "advanced").
5. Row 53: `sessionStarted` sits in world.ts, not session-log.ts as the audit's file list hints, because it moves the
   world day and its gates' breaks; the count is `world.session`. Gates.js runs it (`startSession`) so a session that
   breaks a gate shows the same Dungeon Break window as the day buttons.
6. Row 76's lint. The audit names "a number of four or more digits in src/views is an allowed bound or a rule". Read
   against the code: 45 such literals, nearly all unit conversions (1000 ms, 3600 s) or an input's `max`; the list
   would be as long as the hits and say nothing. Row 76's class is narrower: a length compared with a number written in
   place, a second copy of a bound core owns. The lint is that, over src/views and src/edge, with no allow-list.
7. Row 56: "the link's last room gone and the key ring answer it". A room the server no longer has kept its GM key in
   the ring, so gm.js kept a module set of dead rooms to stop offering it, lost at each reload. The link now drops the
   key when a room is gone (a join that finds no room, or a live room that went): a new ring effect `{ gone }`, which
   takes whatever key the ring holds for that code, beside `{ drop }`, which takes only the refused key (so a wrong
   typed key leaves a good stored one). Weighed: reuse `{ drop }` (a GM who typed a wrong key for a gone room would keep
   the stale stored key, and the strip would offer it again), or filter in the view (the bug's own shape). Chosen the
   new arm; the room model copies it.
8. Row 86: `pick` in roll.ts for a table's line. The audit's lint "Math.random only in src/edge/roll.ts" would have
   needed inventory.js's loot roll in an allow-list owned by no unit; two words in inventory.js (`cryptoRandom`) left
   the list empty. sync.ts's `Math.random` is an event id's random part, not a draw; the lint covers views and core.
9. Row 19: what the GM is told. Posted while connected: "Sent to Mira." as before. Posted while the room does not
   answer: "Mira gets it when the room answers." (uses.js says the same of a use). Not posted (no room, or a body the
   room refuses): said, and the award's log line names only those given or posted (it named everyone before, sent or
   not). `sync.send` stays for browser tests that replay a copy of an event; no view calls it (lint).

## Rows (cause, change, test, commit)

| Row | Cause | Change | Test that fails without it | Commit |
|---|---|---|---|---|
| 76 | bestiary.js cut the codex doc at a literal 15,500 characters; the room takes `DOC_MAX` (62,000) | `codexDoc` in core bestiary.ts, entries up to `CODEX_DOC_ENTRIES` (named in protocol.ts, read by `DOCS.codex`) and `DOC_MAX`, counted exactly; the literal and the five-at-a-time loop deleted | bestiary.test.ts "the doc goes whole while it fits the room: 160 entries" (the old cut kept about 70), "keeps the latest defeats, up to the last entry that fits"; lint "a view or the edge cuts nothing by a size of its own" | c55fafc, ef3758d |
| 77 | an auto-added monster and its codex record were two writes | `recordDefeat(save, d, made)` adds the monster and the record in one step; refuses a counted row and adds nothing | bestiary.test.ts "a monster the bestiary lacked is added with its first record, in the same step" | ef3758d |
| 53 | the session number was read back from log titles; the log keeps `logCap` lines | `world.session` in the save (its own commit, save.ts), `sessionStarted` in world.ts moves the count and the day in one step | world.test.ts "a session started" (four cases); save.test.ts "the count of sessions"; browser gates-quests-dailies "Start session counts on from the campaign's last session after its log has dropped the old lines" | 4d33a96, edb276f, 2c55685, 2a4368b |
| 54 | Start session swallowed `advanceDay`'s error and logged "Day advanced" whatever happened; spawn's error became "did not spawn a gate yet" | `advanceDay` writes its own line with the days it moved and answers what it did; a move that leaves the day is refused; `gates.advanceDay` and `gates.startSession` answer `DayMove`; gm.js has no try and no log line of its own | world.test.ts "the world day" (the line, the move back, the refusals) | edb276f, 2c55685, 2a4368b |
| 56 | a gone room kept its GM key in the ring; gm.js kept `deadRooms` for the session | link.ts `{ gone }` ring effect on notFound and on a live room gone; sync.ts and the room model write it; `deadRooms` deleted | link.test.ts (two cases); browser room-view "after a reload the lost room is still not offered" | 645b11c, b0eea86 |
| 58 (gm.js) | gm.js worked out a due time from hours itself | day.ts `dueAt` | lint "the day's clock is src/core/day.ts" (its list is empty now) | 5b29490 |
| 86 (gm.js) | the roll tables drew with `Math.random` in the view | roll.ts `pick`; inventory.js's loot roll on `cryptoRandom` (own commit) | roll.test.ts "a roll table's line"; lint "a view or core rolls nothing of its own" (no list) | 7041a36, f4d3a48 |
| 19 (GM) | gm.js sent awards, HP, revives, statuses, broadcasts and quests once, with no record | `sync.post` for each; the GM view says sent, waiting, or not posted | browser reward-room "an award the GM gives while the GM's phone is offline" (against the old gm.js: "Not sent to Mira Test: offline."); room model "the GM view's messages to a player" (two cases); lint (no list) | 9f03d9e, 667a26f |

## Left, and why

- `sync.send` stays, used only by four browser tests (battle-map, table-turn, rewards, used) that send a copy of an
  event once; named in deps.test.ts `UNUSED` as tests-only. Moving those four lines to `post` deletes it; battle-map
  and table-turn are open in the map helper's hands, so they were not touched here.
- gm.js's api wrappers that answer a default on a throw (`room()`, `remotes()`, `renderRoom`'s status read, the forge
  call in `addRemoteStatus`, the loot roll in `doRoll`) are row 82's (U12).
- gm.js's targets as `'l:hid'` and `'r:key'` strings (row 57) and the unseen uses compared as ISO strings (row 59) are
  U14's. `codexDoc` orders entries by comparing `lastAt` strings (ISO times from `toISOString`, so the order is the
  time's); row 59's one time helper would take it.
- The room model's GM card bookkeeping (`card`, `sent.ts`) models a combat.js card that no longer waits on its sends
  (U4's note); left to whoever owns the GM's card.
- Old campaigns count sessions from 1 again once (their count was never stored); old saves need not work.

## Principles that changed a choice

- principle-model-the-domain: the session count is a field of the world with one step that moves it, not a number
  read back from words in the log; a gone room is a ring effect of the link, not a set in the view.
- principle-make-operations-idempotent: the codex record refuses a row counted already, so the fight's two asks
  (`defeated`, the end) converge on one record and one auto-added monster.
- principle-fix-root-causes: the dead-room set was the symptom of the ring keeping a useless key; the fix is in the
  link, where the 404 is heard.
- principle-boundary-discipline: the codex doc is built within the bound the room's reader enforces
  (`CODEX_DOC_ENTRIES`, `DOC_MAX`), and the test reads it back through `DOCS.codex`.
- principle-type-system-discipline: `DayMove` is a union of what the move did and the refusal; the ring's `{ gone }`
  arm is its own member, so the "refused key only" rule of `{ drop }` cannot apply to it by mistake.
- principle-subtract-before-you-add: deleted `deadRooms`, the log parse, the 15,500 literal, the five-at-a-time loop,
  the view's `codexSeen` check, the two `try` around the day and the spawn, `roomSend`, and the allow-lists of three
  lints (the outbox, the day's clock, the rolls).
- principle-test-behavior-not-implementation: expected values from the rules (160 entries of about 210 characters is
  more than twice 15,500; day 3 back by 30 moves 2 days), and the offline award checked against the old gm.js, where it
  failed with "Not sent to Mira Test: offline."

## Checks

- `bun run typecheck`: `$ tsc --noEmit && tsc -p tsconfig.views.json --noEmit` (clean).
- `bun run test` (after the last code commit): "Ran 3242 tests across 84 files", 3239 pass, 0 fail, 3 skip. The
  first full run failed one case, deps.test "every registered app.api member is used by some module": `sync.send` had
  lost its last view caller (fixed in 3beb91f, see Left).
- `bun run deps -- --write` (map rewritten), `bun run charts` (no change: no machine's table changed; the ring's
  `gone` is an effect, which the link chart does not draw).
- Browser sweep, every file but feel, one at a time, port 3271 (scratch script `sweep-u10.sh`): 33 of 34 files pass
  whole. table-session.e2e.ts:66 failed once at its step "after another round": the player's HUD read "ROUND 30"
  where the test waits for "ROUND 3". The step's loop stops when the GM's head `startsWith('Round 3')`, which "Round
  30" also matches, and the banner check before it is `toContainText('Round 3')`, which "Round 30" passes too; so the
  GM's head went past round 3 without the loop seeing "Round 3". See the rerun below.
- The scratch folder is shared with the U11 helper: its sweep script overwrote mine in the middle of my first sweep
  (same file name), so that sweep was stopped and run again from a file and folder of U10's own name.
- table-session's cause, chased: passed 6 runs after the failure (the file once, then the case 5 times), so worked out
  from the rules instead. A pass costs a standard action, 100 at speed: an E brute (speed 87) waits 1,000 x 100 / 87 =
  1,149 ticks between turns, the Slowed hunter longer. Every row waits more than a round (1,000 ticks), so when all
  three act between ticks 1,851 and 1,999 their next turns all fall at 3,000 or later and round 3 holds no turn: the
  GM's head goes from "Round 2" to "Round 4", and the loop `startsWith('Round 3')` runs on until "Round 30" (the failed
  case took 1.0 min against 39 s). How the openings fall is rolled, so it fails now and then, on any branch; no U10 change
  touches the fight. Fixed in the test (its own commit): wait until the round number is at least 3 and expect that
  round on both phones. The file then passed: "7 passed (1.7m)".
