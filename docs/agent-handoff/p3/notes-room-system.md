# Notes: the room system model test (M8, unit 3)

Worktree `/home/user/systemgaming/.claude/worktrees/agent-ad01829935a9be026`, branch `worktree-agent-ad01829935a9be026`, started at a11987b.

## Start
- `bun run test` at a11987b: 747 pass, 0 fail (23 files). Nothing outside my files failed.
- One handler call (a GM poll of a small room) costs about 35 µs in process (1000 calls, one run), so thousands of replayed sequences fit in the time bound.

## Log
- steps 1-3 (commit 2cd7e20): `tests/models/room-world.ts` (phones, runner, moves, quiet), `tests/room-system-model.test.ts` (rules, random walks, exhaustive walk, shrinking), `tests/models/dead-ends.ts` (the no-dead-end rule moved out of `tests/sync-model.test.ts`, which now calls it; still 12,716 states). Runner bugs fixed on the way: "a reply for a room the phone left" first compared room codes, so a join's own peek counted as left (it now means: the link has another gen); the 1 ms clock tick ran before a move picked its request, so a request at its timeout's edge vanished. The exhaustive walk found one real bug (two sequences, kept as named tests that fail at this commit).
- step 4 (commit f6bb397): real bug, root fix in `server.ts` (DELETE sheet and DELETE kicks write `_kicked` and answer it; a client PUT of `_kicked` is 403 `server doc`), `src/edge/sync.ts` (`kickSheet` and `allowBack` are one request each; `showKicked` shows the answered doc), `REMOVED_MS` in `src/core/protocol.ts`. Two server tests added. `bun run test` 754 pass; `room-sync` and `room-sync-fixes` 14 passed (2.9 min). Entry in `bugs-found.md`. `principle-fix-root-causes` decided this: a retry or a check on the GM's side would still leave a window, so the removal and its record are now one write by the one owner.
- step 5 (mutation check): each mutation applied by a script (text replace, `bun test tests/room-system-model.test.ts`, file restored; `git diff -- src server.ts` empty after):
  1. `recordApplied` forgets an id (its `includes` check removed): caught by the exhaustive walk, "GM event ... took effect 2 times on p1" (award, the network repeats the GM's POST, both copies polled).
  2. The link accepts a reply of a stale gen (the gen check in `step` removed): MISSED on the first run. The runner drops an aborted request's answer as the edge does, so no stale reply ever reached the reducer. Rule added: when a request the phone dropped is still answered on the wire (`late`), every reply kind of its gen is probed against the phone's link and push and must change nothing (a probe on the pure reducers; nothing is carried out, so the runner still honours the edge contract). Now caught by all five tests ("a stale keyLost for gm's dropped health changed its link").
  3. The server accepts a GM-only event without the key (the `gmOnly` check removed): caught by the exhaustive walk, "the server took a GM-only event award from p1".
  Limit: the random walks catch only mutation 2. Uniform choice over enabled moves rarely builds a live room and then a repeat or a forbidden send within 40 moves; the exhaustive walk from a live room is what catches 1 and 3. Biasing the walks (start from the live room, weight network moves) is the next improvement.
- step 6: AGENTS.md row in "Where things live" (the room as a whole, `tests/room-system-model.test.ts`) and step 5 in "To add a room message".

## The bounds (as in the test)
- 2 or 3 phones (a GM and 1 or 2 players; seeds alternate). 2000 random walks of 40 moves from nothing (80,000 moves, about 3 s). Exhaustive: every 3-move sequence from a live room with the GM and one player, 18 setup moves each (4,247 sequences, about 9.5 s). Quiet: 4 rounds (the longest chain, Allow back, Rejoin, first push and the GM's next poll, takes 3). Whole file about 13 s.
- Time: one virtual clock (Date.now replaced while a world runs). A move takes 1 ms, a timer moves the clock to its due time, a lost answer to its timeout. A request reaches the server only within its timeout. Each world starts 31 days after the last, so earlier rooms have expired (the memory store keeps at most 2000).

## Where the runner decides what the edge does (each checked against `src/edge/sync.ts`)
1. A request is two steps, out then back. A dropped `out` is `failed net`, a dropped `back` is `failed timeout` (the server did it). `fetchApi` gives net or timeout the same way; it cannot tell the two cases apart, and neither can the model.
2. `abort { gen }` marks the link's and the push's requests of that gen as dropped; GM calls (`quietCall`) are never aborted. This matches `track`/`abortGen`, and `quietCall` takes no signal. A dropped request can still reach the server later (`late`), which the edge cannot prevent.
3. A reload drops every request of the page and boots the link from the save, with the push off and nothing shown. That is what a new page does; `serverOk` is taken as true (the page was served by the room server).
4. The store's change signal runs after every write the runner makes (link `save`, applied ring, `bindJoin`, a sheet edit, a hunter changed by an applier) and raises `changed` when the sheet text differs from `sheetText`, as `app.on('change')` does. `bindJoin` writes, then clears `sheetText`, in that order.
5. `sendSheet` with a link of another gen queues `sent` after the current drain; the edge uses a microtask. Never reached in the runs.
6. Appliers: the real `applyRoomEvent` with a stub app. Any hunter method it calls counts as one effect of that event in the ledger, and the hunter's counter goes up (so the push sends it). The real `firstTime` with `recordApplied`.
7. The GM's moves call the edge's `send`, `kickSheet` and `allowBack` as rewritten in step 4, and only for keys the GM's screen shows (the roster, or the Recently removed list). A player's "forbidden" move posts an award with no key, which no view does: it stands for any GM-only request from a player phone.
8. Not modelled: Try now, online, offline, visible, upgrade and replaced (the single-phone model covers them), Play as and tombstones, the 30 s peek cache, presence, a head of more than one page (the runner throws).
- final: `bun run test`: 754 pass, 0 fail across 24 files.
