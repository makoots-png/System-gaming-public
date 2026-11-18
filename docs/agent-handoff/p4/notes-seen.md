# Notes: the sheet's `seen` replaces the fight's 12 s grace

## Step 1 findings (read only)

- Cursor vs appliers. A poll answer becomes the link event `polled`. `reduce` in `src/core/sync/link.ts` answers
  `[...saves(link, next), ...step effects, status]`, so the effects run in this order: `save { cursor }` (the store write),
  then `apply` (sync.ts `apply`, which runs `applyRoomEvent` for every event of the page in seq order), then the `push`
  news `pollOk`. The in-memory `link.cursor` is set before any effect runs. So the cursor is saved before the appliers.
- That order does not break the model, because nothing can build a sheet between the save and the appliers. `drain` sets
  `running`; the save's `change` signal raises `pushDo({ type: 'changed' })`, which waits in `queue` until the whole
  `polled` step is carried out. The push timer is a `setTimeout`, so it never fires inside a synchronous drain. The only
  synchronous path into `sendSheet` from a link step is the `push` effect, and in `polled` it comes after `apply`. So at
  every moment `sendSheet` can run, every event up to the cursor has been through the appliers. Nothing to reorder.
- Where the cursor can claim more than the hunter holds: (1) a join reads the head (`headed`) and starts at the room's
  last seq without applying the history; (2) an applier that throws is caught and logged, and the cursor moves on;
  (3) `ev.from === device` events are skipped (a player never sends events to its own hunter). In (1) and (2) the phone
  will never apply those events, so the sheet is the hunter's truth and the GM taking it is right. Today's code has the
  same skip.
- `sendSheet` (sync.ts) builds the body at send time from `bound()`, the store as it is now. It reads no cursor today.
  `sheetText` is the hunter JSON last sent; the `change` handler raises `changed` only when the hunter JSON differs.
- `app.api.sync.send` returns `Promise<boolean>`: `quietCall` POSTs once, 20 s timeout, no queue and no retry; false on
  no answer, a non-2xx, or a link that is upgrading. The server answers `{ seq }` (server.ts line 276), and `send`
  throws it away today. So a failed send does tell the caller, and the seq is one parse away.
- `remoteSheets()` / `RemoteSheet` (api.ts): `{ key, seen, deviceId, hunterId, at, from, data: Hunter }`, where `seen` is
  the device's last poll time from the GM's presence list. That name collides with the new field; only sync.ts `roster`
  reads it, so it is renamed `polledAt` and `seen` takes the new meaning.
- `sendRoom` callers in combat.js: `sendRemote` (an `hp` event and a `status` event, from the reducer's `sendRemote`
  effects) and the end-of-fight XP `award` to each proxy (line 393). All three set `lastSent` for the remote.
- The room model's `sendSheet` copy (tests/models/room-world.ts) builds `{ from, data: hunter }` from `sheetJson(p)` at
  send time; its `apply` copies sync.ts apply. It has no GM view of a proxy yet.
- Liveness gap found while reading: the push sends only when the hunter JSON changes. An event for this hunter that
  changes nothing on the phone (a status re-added as it was, a heal at full HP) would leave the last pushed sheet with a
  `seen` below the GM's send, and the GM's card would hold its own number until the player next changed something.
  Fix at the root: `apply` tells the push `changed` when it processed an event addressed to the bound hunter, so the
  next send carries a `seen` that covers it. Putting `seen` into the change check instead would push after every room
  event (every roll), doubling PUTs in a fight.

The model holds. Nothing must be reordered; `send` must hand back the seq, and the push must also fire after an event
addressed to the bound hunter.

## Log

- 00d9055 step 1 findings; cf8b58f step 2 red tests (protocol sheet seen, model cards + lostChange rule); step 3 src/core/sync/sent.ts + tests/sent.test.ts (9 pass).
- 9937c04 step 4 wiring. Sheet shape `{ seen, hunter }` (protocol.ts `HunterSheet`); server.ts kick name reads `sheet.hunter.name`; `sync.send` answers `number | null` (gates.js `ok === false` check became `seq === null`; the other callers test truthiness); `RemoteSheet.seen` is the new number, presence time renamed `polledAt`; combat.js `sent` Map keyed by `room remote` (a key alone would carry a seq from an old room into a new one, where seqs restart at 1). `bun run test`: 1298 pass.
- Mutation checks: `freshFor` always true fails the model's directed test and the depth-3 walk (lostChange); removing the addressed push from the model's `apply` fails the depth-3 walk with "card shows sheet #1, but its sheet is #2" (a duplicated GM send: the second copy is skipped by the applied ring and changes nothing, so only the addressed push brings `seen` past it).
- Step 5: no existing test asserted this exactly (the table-session poison tick checks the card but no push with a stale `seen` is forced), so added one in tests/e2e/table-session.e2e.ts. It holds the player's polls with page.route (needs `blockServiceWorker`). It fails with an always-fresh `freshFor` (card shows 24/24 instead of 19). It does not by itself tell the new rule from the old 12 s timer, since the stale push lands within 12 s; the model is the proof of the rule. No test in tests/e2e waited out the 12 s.
- Once, while restoring sent.ts after a mutation, I ran `git checkout src/core/sync/sent.ts` (my own committed file, no other changes in it). Later restores used a scratch copy.
- e89d56c step 6 lint rule: a line in src/views with Date.now() and a send/sent name. Honest only for the storing half (the old compare used a `now` alias); it sees the old grace stamp. AGENTS.md left as is: its fight and sheet push lines are still true.

## Decisions and what the board shows

- A GM reload: combat.js's `sent` Map is in memory and is lost, as `lastSent` was. The fight's remote rows are in the save, so the card keeps its number until the first poll after the reload; then the next sheet wins whatever its `seen`, so a sheet pushed before the player applied the GM's last change may show the old number until the player's following push (which the addressed-event push makes come within one push after the player's next poll). No saved state added.
- A failed send (`seq` null): the remote stops being pending and keeps the highest seq it had, so the next sheet is the truth. If the server did store the event and only the answer was lost, the card may show the old number until the player applies it and pushes; the GM was told "could not be reached" in that case. Recovering the seq from the GM's own events in its next poll (by eid) would close that, at the cost of one more piece of state; not done.
- `seen` is required in a sheet (missing or not a number: refused, as `parseSheet` refuses any other wrong field); out of range is clamped (below 0 reads 0). Sheet shape is `{ seen, hunter }` rather than a field on the hunter, so the hunter type and the save stay as they are.
- Principles that changed a choice: model-the-domain (a `Sent` record with pure `sending`/`answered`/`freshFor` instead of a timestamp map), make-operations-idempotent (`answered` keeps the max seq, so answers in any order converge; keyed by room so a new room's seqs never meet an old seq), fix-root-causes (the no-op event push in `apply`, found by the model, instead of putting `seen` into the change check), test-behavior-not-implementation (the model rule is stated on the card's contents against the phone's applied events, not on `freshFor`'s inputs; both mutation checks fail it).
- Step 7: three named browser files 21 passed; full `E2E_CHROMIUM=/opt/pw-browsers/chromium bun run ci` passed on e89d56c (101 Playwright passed, last line "CI passed"). No pause hit.
