# Notes: implicit audit units U2 "The outbox" (rows 19, 28, 31) and U3 "Players' sends" (rows 20, 21, 22, 50, 51, 70)

Helper: Opus, worktree `.claude/worktrees/agent-a99c3b2e548a857cf`, branch `worktree-agent-a99c3b2e548a857cf`, from
`claude/zen-pasteur-ov4cgd` at 626e835 (U1 merged). Playwright port 3271.

## Goal

A player never loses a message to the room: a use, a roll, a coin call, a quest's progress, a deleted hunter's
tombstone, and on the GM's side an award. The problem: every send to the room is one POST with no record; offline or
failing, the message is gone and only a toast (or nothing) says so. The smallest change that meets it: one outbox in the
save, a machine per entry (`queued`, `sending`, `sent`, `refused`), flushed after each good poll; the server takes an
event id once, so a resend after a lost answer is not a second message. Then U3 moves the players' senders onto it.

## Decision trail

(Newest last.)
1. Read the brief, helper-rules, AGENTS.md, START-HERE, poteto-mode, the statechart skill, the audit (U2, U3 and their
   rows), notes U1 and U7, and the leaves of model-the-domain, make-operations-idempotent, type-system-discipline,
   boundary-discipline, prove-it-works and fix-root-causes.
2. Data shape first: an entry is `{ id, room, letter, key }` with `at: queued | sending` or `at: refused, why`; a letter
   is a room event or a tombstone. `sent` and `dropped` leave the box. One entry per id, so posting twice is nothing.
3. Three ways weighed for "sent again after a lost answer is not a second message": (a) the sender asks the room
   whether the id is there before sending again (one more request, and a race between the check and the send); (b)
   every applier dedupes by id (the player's appliers do, through `once`, but the GM's feed, coin and log handlers each
   would need it); (c) the room takes an id once. Chosen (c): one place, it holds for every reader, and it makes the
   resend idempotent where the message is stored (make-operations-idempotent).
4. Postgres: U7 left the `MAX(seq) + 1` insert retried on a key clash. With (c) the id check and the seq must be one
   step, so a room's last seq is a column of `rooms` taken under the room's row lock (`SELECT ... FOR UPDATE` in a
   transaction), and `events.eid` has a unique index per room. Old rows: the counter is raised to the room's highest
   seq and each row's id read from its payload, the second copy of a repeated id kept without one, so the index can be
   built over a room that already holds the bug. Both statements change nothing when run again.
5. The statechart skill's TLC run needs mise and a download, which this box does not allow (as U7 found); the chart is
   the repo's walk of the real `TABLE` (scripts/statecharts.ts, the skill's view format).
6. Where an entry is sent from: after each good poll (`apply`), on `post` itself, and after each answer that was not a
   failure. No timer of its own: a failed send waits for the next good poll, which the link paces (row 28's sleep goes).
7. A refusal is kept (at most 10) with the room's reason, so a reload still knows; nothing shows the list yet (U3 says
   so to the player as it happens).
8. U1's leftover, "an event that throws is still lost once the poll cursor passes it": three ways weighed. (a) hold the
   cursor before the event: a bug that always throws then blocks every later message to that phone for good; (b) drop it
   with a warning (today); (c) keep it in the save (`settings.sync.held`, at most 20), let the cursor move on, and try it
   again after every good poll before that poll's events, warning each time. Chosen (c): nothing is lost, later messages
   still land, the bug stays loud. `once` makes the later try land whole or not at all.
9. The room model's exhaustive walk grew from 11337 sequences (23 s) to 14569 (31 s) of its 60 s budget. In one full
   `bun run test` (right after `bun run deps -- --write` and `bun run charts`) 11 server-rooms tests failed with "no such
   room". Cause (inferred, not reproduced: a rerun passed): a model test that bun times out keeps running in the background with `Date.now` replaced by its world
   clock, 31 days ahead, so rooms another file makes read as expired. Fixed at the cause in the harness: each long walk
   stops at its next sequence once its test is over (`still`). The GM's offline move was left out of the walk (the GM
   posts nothing through the outbox until U4 and U10) to keep it near the old size.

## U2 rows (cause, change, test, commit)

- Row 19. Cause: a message to the room was one POST with no record, so a failed send was lost and the GM's side was
  written as paid. Change: the outbox (`src/core/sync/outbox.ts`, chart "A message to the room"), `sync.post`, sent from
  sync.ts after each good poll; the room takes an id once (server.ts, both stores; Postgres counts seqs per room under
  the room's row lock, U7's leftover). Tests: tests/outbox.test.ts (every cell, post, order, coalescing, the full box,
  the save's reader, `callOf`); server-rooms "an event sent again with its id" and "events posted at the same moment"
  (both fail with the dedupe removed, on memory and on Postgres); room model "a message in the outbox" (offline, a lost
  answer, a reload; mutations: no dedupe fails 2 cases, no flush after a poll 3, no requeue at boot 1). The random walks
  did not catch these mutations on their own; the named cases and the depth-3 walk do. Commits 2d873ce, fba7549.
- Row 28. Cause: `setTimeout(flush, 500)` stood for "after the link is back". Change: deleted; the link polls on
  `online` and a good poll flushes. Test: the room model's offline case. Commit fba7549.
- Row 31. Cause: `quietCall` answered null for every failure. Change: `call` answers a `Call` (ok, offline, refused
  with the reason, server); kick, allowBack and release return it, and room.js says which (U8's file, its own commit
  9043cc8). Test: tests/outbox.test.ts "how the room answered a request".
- U1's leftover. Cause: `apply` caught an applier's throw and moved on, and the cursor moved past the event. Change:
  `applyAll` holds it in `settings.sync.held` and tries it after each good poll. Test: applied.test.ts "an award that
  throws on this phone is held ...". Commit fba7549.
- Lints (fba7549): "a view posts a room message through the outbox, never sends it once" (allow-list: combat.js and
  gates.js for U4, gm.js for U10; a file that stops sending must leave the list); "only src/edge/sync.ts writes the
  save's outbox".
- Lead's extra item: the fight's `vitals` effect's `used` reaches the sheet (`totals` in grant.ts, combat.js passes it).
  Cause: `totals` had no field for it. Test: fight.test.ts "round trip: a use a rest spent in a fight is still spent on
  the sheet after it, and a long rest gives it back". Commits 6701152, 654fa7a (combat.js). The room's `vitals` message
  still carries no `used` (a protocol message and its applier; left).

## U3 rows (commit c8edfcc)

- Row 20. Cause: the item left the bag, then one send whose failure was a toast. Change: uses.js posts `used` and
  `cast`; inventory.js takes the item once the cast is posted. Test: used.e2e.ts "a boon redeemed while the player's
  phone is offline waits on the phone, and reaches the GM's log once when the phone is back" (the old code toasted
  "Could not reach the room" and never sent it); the room model's `use` and `cast` moves now post.
- Row 21. Cause: progress waited 1.5 s in a timer per quest, was sent once and its answer ignored. Change: posted with
  the key `quest <hid> <qid>`, so a newer one replaces one still waiting (outbox.test.ts "a newer message with the same
  key"); the timer is gone.
- Row 22. Cause: rolls past two a second were dropped and the feed's errors swallowed. Change: every roll is posted;
  the rate limit and the try are gone; a full outbox says what it let go.
- Row 50. Cause: `sentFrom` was released only by a doc of another `at` or a failed send. Change: `hold` is `{ at:
  'free' }` or `{ at: 'sent', from, id }`, let go by a doc of another `at`, a post that did not happen, or the outbox's
  refusal of that entry (`sync:outbox`).
- Row 51. Cause: painting the feed marked every row seen whenever it was open or the screen wide, even with another
  view shown. Change: `feedShown` (the panel not under a hidden section, the page visible). No browser case yet.
- Row 70. Cause: a branch for players on an older app. Change: deleted.
- coin.js: its `unsent` set and resend after each poll are deleted; a call and a landing are posted keyed by roll. The
  room model's coin rule is now stronger: a landing reaches the player even across a reload of the GM's page.

## Left, and why

- combat.js, gates.js and gm.js still `send` once (U4, U10), named in the lint's allow-list.
- The room's `vitals` message carries no `used` for a hunter on another phone (needs a protocol message field and its
  applier).
- Nothing lists the refused messages the outbox keeps; the player is told once, as it happens.
- Two tabs of one save share the outbox: an entry marked `sending` by a tab that closed waits until the other tab
  reloads (U11's store work on other tabs).
- The memory store's id check covers the room's last 2000 events (`MEM_EVENTS`); Postgres checks every event.
- api.ts's `Posting` type and the dependency map of U3 went into commit 6701152 with the vitals item (one file touched
  by both at once).

## Principles that changed a choice

- principle-make-operations-idempotent: the room takes an id once, so the outbox may send again without asking.
- principle-model-the-domain: one machine per message instead of a retry flag per sender (coin.js's `unsent`, the
  tombstone queue and the quest timer all folded into it).
- principle-fix-root-causes: the lost events were fixed where they were lost (the cursor past a throw; the send with no
  record), and the flaky server tests at the harness's leaked clock, not by a longer timeout.
- principle-type-system-discipline: `Call` and `Entry` are unions a view cannot read wrong; `hold` replaces a nullable.
- principle-boundary-discipline: the save's box and held events are read again through the room's own event parser.
- principle-subtract-before-you-add: forget-queue.ts, core/sync/forget.ts, quietCall, the 500 ms sleep, the quest
  timer, the roll rate limit, coin.js's resend and the old-app branch are deleted.

## Checks of the Postgres upgrade (scratch, not committed)

An older build's tables (no `rooms.seq`, no `events.eid`) with one room holding the id `d-gm-x1` twice (seqs 1 and 2)
and `d-gm-x2` at seq 3, opened by this build twice in a row: both times `d-gm-x2` sent again answered 3 and stored
nothing, and a new id took the next seq (4, then 5). So the unique index builds over a room that already holds a
repeat, and the start changes nothing the second time.

## Checks (last run, after the last code commit)

- `bun run typecheck`: `$ tsc --noEmit && tsc -p tsconfig.views.json --noEmit` (clean).
- `bun run test`: "Ran 3102 tests across 78 files", 3099 pass, 0 fail (3 skipped: Postgres-only rows).
- `DATABASE_URL=postgres://postgres:pg@localhost/hunter_u2 bun test tests/server-rooms.test.ts tests/server-handshake.test.ts`: 102 pass.
- Browser, port 3271, one file group at a time, after the lead's hold: used + coin + layout 20 passed (layout's new
  case failed once on a wait for the toggle, which at 1280 is hidden: fixed the wait; its mutation fails it);
  table-turn + room-sync-fixes + room-sync 23 passed (table-turn's Strike case watched `sync.send`; now `post`);
  battle-map + gates-quests-dailies 36 passed (battle-map's pass watched the same way, fixed); customization +
  reward-room + phone 17 passed, 1 failed: phone.e2e's 390 by 844 sweep, "gm bundle maker" controls 43 px tall (the
  reward bundle maker's CSS; no file of these units touches it). Not feel.e2e (the lead's).
- An aborted browser run (stopped for the lead's hold) left its server on 3271 running; I stopped that one process.
