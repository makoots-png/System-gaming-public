# Notes: unit U7, the room server (rows 32 to 37 of the implicit audit)

Helper: Opus, worktree `.claude/worktrees/agent-a893e709f45066be1`, branch `worktree-agent-a893e709f45066be1` (off
`claude/zen-pasteur-ov4cgd` at 4560cbd). Playwright port 3281 (not needed: no browser file is in this unit).

## Goal

the owner wants every rule and every state of the app said once and in one place, so that a player never loses a room,
a removal or a sheet to something implied. The room server (`server.ts`) held six implied things: a room's expiry
written five times, a Postgres outage that silently turned into a memory store, a removal kept twice, a branch for
"old clients" with no token, untyped store calls and rows, and a presence map that only grows. The smallest change
that meets it: one expiry rule and one sweep; no memory store under `DATABASE_URL` (a database that is down is a state
the health route and the log say); the `_kicked` doc as the only record of a removal; a token on every non-GM write;
a store typed by `RoomCode`, `SheetKey` and `DeviceId` whose Postgres rows go through the protocol parsers; presence
kept by the store and swept with its room.

## Decision trail

(Kept as I go. Newest last.)

1. Read the brief, the audit, AGENTS.md, START-HERE (main tree, with "Every helper works in poteto mode"), poteto-mode,
   the statechart skill and the principle leaves named below. Baseline: `bun test tests/server-rooms.test.ts
   tests/server-handshake.test.ts` passes 87 of 87 on memory and on a local Postgres 16 (`hunter_u7`).
2. Postgres outage at start: three ways weighed on paper (no second agent; the lead decides if it wants one).
   - A: exit with an error. The log is loud. Railway restarts the process under its restart policy and, once the
     retries run out, the whole site (the solo app too) is down until someone redeploys. A new deploy fails its health
     check and the old one keeps serving.
   - B: listen, answer `/api/health` 503 and every room route 503, never try again. Loud, the solo app keeps loading,
     but a running instance that started in an outage stays roomless until a redeploy, and Railway does not restart a
     process that runs.
   - C: as B, and open Postgres again every `DB_RETRY_MS`. The site loads, rooms answer 503 (the app shows the server
     as failing, never "this room no longer exists"), and rooms come back by themselves when Postgres does.
   Chosen: C. It is the only one where a player loses nothing and nobody has to act. The audit's words "the server does
   not start" are kept for the rooms: no room route answers while the database is down. The reopen is a state of an
   explicit machine (below), not a retry hiding a bug: the database is outside the process and may come up later.
3. The database's life is a machine: `opening`, `ready`, `down`, events `opened` and `failed`. Drawn with the repo's
   chart tool (`scripts/statecharts.ts`, the statechart skill's view format over the real reducer). The skill's own
   TLC run needs mise and a download; this box allows neither, so the model check is the walk of the real `TABLE`.

4. Data shape first (`principle-foundational-thinking`, `principle-model-the-domain`): the `Store` interface was typed
   before any route moved. It takes `RoomCode`, `SheetKey`, `DeviceId`, a parsed `Sheet` or `DocOf<K>`, and the
   request's `now`; it answers the protocol's own `StoredEvent`, `Stored<Sheet>` and `RoomDocs`, so the poll answer is
   built with no cast. Presence moved into the store (kept in the process, never written, as S04 wants), so a room
   and everything about it leave in one sweep.
5. Every row was written in one pass over `server.ts`, because each row changes the `Store` interface the others use.
   So the rows share commit bee5b2f rather than one commit each; the two lines outside my files are their own commits.
6. While checking row 36 against Postgres, every sheet came back unreadable. Root cause (`principle-fix-root-causes`,
   reproduced with a probe script and `jsonb_typeof`): Bun binds a JS string as a JSON string, so `${JSON.stringify(x)}::jsonb`
   stored a string of JSON, not an object. The old `json()` helper on read hid it. Fixed where it starts: the value is
   bound as itself (`${data}::jsonb`). Rows an older build wrote are unwrapped once by an idempotent `UPDATE ... WHERE
   jsonb_typeof(...) = 'string'` at each start (`principle-make-operations-idempotent`), so a room live across the deploy
   keeps its sheets and events.
7. Postgres on this box died once between sessions (the cluster said "stale pid file"). The first Postgres run after
   the break failed with ERR_POSTGRES_CONNECTION_REFUSED, which happened to show the new down state working; after
   `pg_ctlcluster 16 main start` the runs pass.
8. The old server was run beside the new (a scratch copy, deleted after) to show the token and fallback tests fail
   without the change: under a dead DATABASE_URL it answered health `200 {ok:true, db:'memory'}`, and a sheet PUT, a
   roll POST and a write for a phone id not of the `d-` form, all with no token, each answered 200.

## Rows

(Each: the cause, the change, the test, the commit. All in bee5b2f unless named.)

**32. A room's life.** Cause: the expiry was `Date.now() - touched > TTL` in the memory store's `live`, `touched < cutoff`
in four Postgres deletes, and `touched >= now - TTL` in two Postgres reads; the memory store also deleted lazily on
read. Change: `ROOM_TTL_MS`, `liveSince` and `roomLive` in `src/core/room-server.ts`; both stores read them; `sweep(now)`
is a `Store` method and the create route is its one caller; the memory store's reads no longer delete. Tests: "a room
lives 30 days after its last use, to the millisecond" (room-server.test.ts); "a room used 30 days ago is still there; a
millisecond later the sweep removes it, its sheets with it" and "creating a room sweeps the expired ones" (on both
stores).

**33. Postgres down at start.** Cause: `getStore` caught the failure, warned once and returned the memory store, so on
the deploy every room lived until the next restart and then answered 404 "no such room". Change: `database(url)` in
server.ts holds a `Db` (machine in room-server.ts: `opening`, `ready`, `down`); under `DATABASE_URL` it is Postgres or
nothing. While down, every room route answers 503 `{ error: 'no database' }` (never 404, so no phone marks its room
gone), `/api/health` answers 503 `{ ok: false, db: 'postgres', since, error: <code> }`, the log has one `console.error`
line per try, and the start line says `NO ROOMS: Postgres does not answer`. It opens Postgres again every
`DB_RETRY_MS` (10 s). A ready store's health also runs `SELECT 1`, so health is 503 during a later outage too.
Tests: the machine's cells and `dbHealth` (room-server.test.ts); "rooms are not kept in memory: every room route
answers 503..." and "when Postgres answers again, rooms are served without a restart" (server-rooms.test.ts);
"the server started with DATABASE_URL and no Postgres listens, says so loudly, and its health answers 503"
(server-start.test.ts spawns `bun server.ts` against a closed port). Chart: a01de39.

What the deploy will do on a database outage at start (Railway, `railway.json`: start `bun server.ts`, health check
`/api/health`):
- The process starts and listens. Its log shows `[server] DATABASE_URL is set and Postgres does not answer (<message>).
  No room is served and /api/health answers 503 until it does. Trying again in 10 s.` and then `The Hunter System
  (build ...) listening on :PORT; NO ROOMS: Postgres does not answer, see above`, and the first line again every 10 s.
- `/api/health` answers 503. For a new deployment, Railway's health check therefore fails; as I read Railway's
  documentation (not checked against the live service), the deployment is marked failed after the health check
  timeout (300 s by default) and the previous deployment keeps serving. If Postgres answers within that window, the
  next try (within 10 s) makes health 200 and the deploy goes through.
- For a running deployment restarted by Railway during the outage: the process stays up (Railway does not restart a
  running process for a 503), the app loads and solo play works, every phone in a room sees the server as failing
  (the link's `failed: server`, never "This room no longer exists"), and the rooms come back by themselves within
  10 s of Postgres answering. No room data is lost: it was never anywhere but Postgres.
- Postgres failing after a good start: each room request that reaches it is a 500 with a `[server]` line in the log,
  `/api/health` is 503 with the error's code, and Bun's pool connects again on the next query.

**34. One record of a removal.** Cause: a removal was kept twice, `KICKS` (in-process, 20 s, lost at a restart) and the
`_kicked` doc (in the store, 10 minutes). Change: `KICKS` deleted; the 20 s refusal is `keptOut(doc, key, now)` in
room-server.ts, reading the doc's time (`REPUSH_MS`); Allow back lifts the doc entry and with it the refusal. Tests:
"a removed hunter's phone may not push its sheet for 20 seconds after the removal, then may" (room-server.test.ts);
"a server started again over the same rooms still refuses the removed sheet for 20 seconds, then takes it"
(server-rooms.test.ts; under DATABASE_URL the second server opens its own Postgres pool). Honest limit: in one process
the old module-level `KICKS` would also pass that test; the lint "server.ts keeps no room state of its own" is what
fails on it (its first case is the old `KICKS` line).

**35. A token on every phone's write.** Cause: `ownerOk` let a write with no token through when the phone had no owner
yet ("an old client"), and skipped ownership for any phone id not of the form `d-...`. Change: `mayWriteFor`: the GM's
key, or the phone's token (16 to 128 characters), bound on first use; no exemption by id form. Every phone of this
build sends its token (`fetchApi` in src/edge/sync.ts, `X-Device-Token` on every body without the GM key). Tests: "a
sheet pushed with no device token is refused", "a roll posted with no device token is refused", "a phone whose id is
not of the app's form needs a token too", "the GM's key writes without a token". The old server answered 200 to the
first three (decision 8).

**36. A typed store.** Cause: the store took `code: string` and `hid: string`, Postgres rows were `any`, and a row went
to the players as it was stored. Change: `Store` takes `RoomCode`, `SheetKey`, `DeviceId` and parsed values; Postgres
rows go through `parseEvent`, `parseSheet` and `DOCS` on the way out, and a row no parser reads is left out with a
`[server]` warning (never silent); `deviceOf` answers a `DeviceId` (4044a9f). This found the stored-as-string bug of
decision 6. Tests: the typecheck; "a sheet and an event are kept as JSON objects", "a row an older build wrote as a
string of JSON is read again after a start", "a row no parser of this build reads is left out, and the room still
answers" (Postgres only, skipped without DATABASE_URL).

**37. Presence.** Cause: `lastSeen`, a module Map, kept every room code it saw for the life of the process. Change:
presence is the store's (`see`, `presence`), kept in the process and never written (S04), and its `sweep` drops the
presence of the rooms it removes. Test: "a new room under the code of one that expired shows the GM none of the old
room's phones as present" (both stores).

**The lint (593d476).** Three rules on server.ts, each with the old line as its first case: no module-level `let`, `Map`
or `Set` (rows 34 and 37); every `catch` rethrows, answers with `J(...)`, or is named with the state it shows (one
entry: the database's down state) (row 33, the audit's kind 7, scoped to server.ts; widening it to `src/views`,
`src/edge` and `src/sw.js` is U12's); no `any` (row 36, kind 5).

## Checks

- `bun run typecheck`: passes.
- `bun test tests/server-rooms.test.ts tests/server-handshake.test.ts tests/room-server.test.ts tests/room-system-model.test.ts`
  on the memory store: `118 pass, 3 skip, 0 fail` (the 3 skipped are the Postgres-only rows).
- The same two room files with `DATABASE_URL=postgres://postgres:pg@localhost/hunter_u7` (local Postgres 16.15):
  `100 pass, 0 fail`.
- `bun test tests/server-start.test.ts`: `1 pass`.
- Browser: `tests/e2e/room-sync.e2e.ts` on memory, `1 passed`; `room-sync.e2e.ts` and `room-sync-fixes.e2e.ts` with the
  server on Postgres, `15 passed (3.3m)` (19 rooms written to `hunter_u7` in that run, so the server did use it).
- `bun run test`: 3002 pass, 3 skip, 4 fail, all four in tests/deps.test.ts about `app.api.maker` in src/views/maker.js ("set to
  something other than an object literal"), a file this unit did not touch; it is in the base commit 4560cbd's area
  (the kits makers). Not mine to fix; flagged to the lead.

## Principles that changed a choice

- `principle-model-the-domain`: the database's life became a machine with a chart instead of a `try` around the open;
  presence moved into the store so one sweep removes a room and all it holds.
- `principle-type-system-discipline` and `principle-boundary-discipline`: the store takes branded ids and parsed
  values; Postgres is a boundary, so its rows are parsed on the way out, not trusted.
- `principle-fix-root-causes`: the unreadable Postgres rows were traced to the bind, not patched on read (decision 6).
- `principle-subtract-before-you-add`: `KICKS`, `kick`, `kicked`, `lastSeen`, `seen`, `DEV_RE`, `OWN_RE`, `TTL`,
  `CODE_RE`, `getStore`, the module `let`s and the `json()` reader are gone.
- `principle-make-operations-idempotent`: the unwrap of old rows runs at every start and changes nothing the second time.
- `principle-test-behavior-not-implementation` and `principle-prove-it-works`: the tests drive the HTTP handler and a
  spawned server; the expected values come from the rules (30 days, 20 s, 503 never 404), and the old server was run to
  show the new tests catch it.

## Left, and why

- `addEvent` in Postgres still picks `MAX(seq) + 1` and tries again on a key clash (five times). It is concurrency
  control, not a hidden bug, but a per-room counter row would remove the loop. Not in this unit's rows.
- A sheet PUT does not check that its `from` is the key's phone; the token is checked for the key's phone, which is
  what protects the sheet. Not in this unit's rows.
- `setRemoved` is a read then a write of the `_kicked` doc; two removals at the same instant could lose one. Not new,
  not in this unit's rows.
- The statechart skill's TLC run needs mise and a download, which this box does not allow; the chart is the repo's walk
  of the real `TABLE` (`scripts/statecharts.ts`), which follows the skill's view format.
