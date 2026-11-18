# Brief: the room system model test (M8, unit 3)

Read `AGENTS.md` and `docs/agent-handoff/helper-rules.md` first (its last section names the principle skills: here `principle-prove-it-works`, `principle-build-the-lever`, `principle-make-operations-idempotent`, `principle-fix-root-causes`, `principle-test-behavior-not-implementation`, `principle-explain-the-number`). Read the section "State machines and formal methods" of `docs/agent-handoff/poteto-posts.md` (lines 221 to 281) for why this exists. Where this brief and the rules differ, this brief wins.

You work in your own git worktree (your current directory) on your own branch. Your prompt names the commit to start from. Then `bun install`. Commit after every numbered step (name the files you add, plain messages, no AI attribution lines). Do not push. Do not start helpers of your own. Never edit anything under `.claude/skills`.

Other helpers are changing hunter code and generated docs in other trees. You create `tests/room-system-model.test.ts`, helper modules under `tests/models/` and your notes file `docs/agent-handoff/p3/notes-room-system.md`. You change app code only in step 4, only to fix a bug the model found, and only after the failing sequence is a named test.

## Why (the owner's goal)

the owner wants an architecture that stays correct as features are added, checked by the code itself and not by a second document that can drift. Every machine in this app has a model test of its own, on one phone. Nothing explores what several devices do together: a GM phone, player phones and the server, with polls, sheet pushes and room messages arriving in any order, lost, repeated, and with a reload or a leave and rejoin in between. The bugs this app has had in rooms were of that kind. A formal spec (TLA+) could model it, but it would be a second description of the protocol. This test explores the real code instead: the real reducers and the real server handler, composed.

## What exists to compose

- `src/core/sync/link.ts`, `push.ts`: pure reducers, effects as data (requests with a `gen`, timers, save, apply, notify). `tests/sync-model.test.ts` and `tests/models/` show how one phone is driven and what the edge contract is (`docs/agent-handoff/p3/notes-link.md`, "For unit B").
- `server.ts` exports `handler(req: Request): Promise<Response>`, used in process by `tests/server-rooms.test.ts` and `tests/server-handshake.test.ts` (they show the build header and the memory store).
- `src/core/protocol.ts`: `parseRoomState`, `parseEvent`, `newEvent`, the `EVENTS` table. `src/core/applied.ts`: the applied ids ring. `src/edge/room-events.ts`: the appliers (they need app objects; see step 1 for how far to go).
- `src/edge/sync.ts` is the real effect runner but is tied to the browser. Do not import it. The test has its own small runner for the effects, which is the point: the runner in the test and the runner in the edge must honour the same contract, so write down in the notes every place where you had to decide what the edge does, and check each against `sync.ts`.

## What to build

1. A phone in the test: its `Link`, its `Push`, the part of the save the machines write (room, cursor, GM key, last room, applied ids), a hunter sheet reduced to a counter that "changes", and an inbox of outstanding requests and timers. Carrying out an effect means: a request becomes a pending call to the real `handler` whose answer is delivered later as the matching reply event; a timer becomes a pending "timer fires"; `apply` parses the poll page with the real `parseRoomState` and applies each targeted event through the real applied ids ring to a small ledger (how many times each event id took effect on this phone). You do not need the real DOM appliers: the ledger is what the rules read.
2. A scheduler that explores interleavings. A world is the server (the real handler over a fresh memory store) plus two or three phones (one GM, one or two players). The moves: a user action on a phone (create, join with the code, leave, rejoin, reload which keeps the save and drops everything in memory, change the sheet, GM sends an award or a status to a player, GM removes a player, GM allows them back); deliver one pending reply; drop one pending reply as a network error or a timeout; fire one pending timer. Because the handler is asynchronous and holds state, explore by replaying: a world is defined by its move sequence from the start, so depth-first or random-walk exploration re-runs sequences rather than cloning worlds. Use a seeded generator for random walks (thousands of sequences of bounded length) and, where it finishes in time, an exhaustive walk over a small alphabet to a small depth. Say in the test what the bounds are and why (the whole file should run in under about 30 s).
3. The rules, checked after every move and, for the convergence rules, after a "quiet" phase in which every pending reply is delivered and every timer fired until nothing is pending:
   - a GM event aimed at a phone takes effect on that phone at most once, whatever is repeated, reloaded or rejoined; and exactly once after quiet if the phone is still in the room;
   - a reply for a room a phone has left changes nothing on that phone;
   - a player the GM removed is, after quiet, not in the room on their own phone, and their sheet is not in the GM's roster; after "allow back" and a rejoin, they are in both;
   - two phones never both own the same sheet key on the server;
   - after quiet, every phone in the room has the same cursor position relative to the server and the GM's roster holds the latest version of every player's sheet that is still in the room;
   - a player's phone never takes the GM role and never has a GM-only request accepted;
   - no phone ends quiet in a state that needs a tap the UI does not offer (reuse the dead-end rule of `tests/sync-model.test.ts`).
   When a rule breaks, print the seed and the shortest failing move sequence you can find (shrink by removing moves while it still fails).
4. For each failure: decide whether the test's runner broke the edge contract (fix the runner) or the real code is wrong (a reducer, the handler, the ring). For real bugs: keep the sequence as a named test that fails, fix the code at the root (`principle-fix-root-causes`), confirm it passes, and add the bug to `docs/agent-handoff/p3/bugs-found.md` with the sequence in words a GM would understand. Run `bun run test`, and for any change to `server.ts` or the reducers also `tests/e2e/room-sync.e2e.ts` and `room-sync-fixes.e2e.ts` (`E2E_CHROMIUM=/opt/pw-browsers/chromium E2E_PORT=3281 bunx playwright test <file> --workers=1 --trace off --output=/tmp/pw-roomsys`; never run `playwright install`).
5. Mutation check: break three protocol rules in the real code by hand, one at a time (for example: the applied ids ring forgets an id; the link accepts a stale `gen`; the server accepts a GM-only event without the key), and confirm this test fails each time. Restore. List them in the notes. A mutation this test misses is a rule to add.
6. `AGENTS.md`: one row in "Where things live" (what the room as a whole must always do, and the test that checks it) and one line in the recipe "To add a room message" (add the message as a move here if it changes a hunter).

## Done means

- `bun run test` passes. Final reply under 200 words: your worktree path and branch, commit hashes, how many sequences and moves the test explores and in how long, each real bug found (one line each), the three mutations, and where the test's runner had to guess what the edge does.

If a step turns out to be wrong or much larger than it reads, stop, write why in the notes file and reply. Do not widen the task. If you are still going after about 75 minutes of work, commit what passes, write exactly where you are in the notes, and reply.
