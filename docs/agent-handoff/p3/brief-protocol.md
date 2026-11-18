# Brief: the room protocol, typed and validated (M5)

Two units, one helper each, one after the other. Unit A is the shared types, the parsers and the server. Unit B is the client. Your prompt says which unit is yours.

Read `AGENTS.md` and `docs/agent-handoff/helper-rules.md` first (its last section names the principle skills to read: for this task `principle-boundary-discipline`, `principle-type-system-discipline`, `principle-make-operations-idempotent`, `principle-test-behavior-not-implementation`). Where this brief and the rules differ, this brief wins.

You work in the repo root on the branch that is checked out. No other helper is running. Commit after every numbered step (name the files you add, plain messages, no AI attribution lines). Do not push. Do not start helpers of your own. Never edit anything under `.claude/skills`.

Browser runs: `E2E_CHROMIUM=/opt/pw-browsers/chromium E2E_PORT=3241 bunx playwright test tests/e2e/<file> --workers=1 --trace off --output=/tmp/pw-protocol`. Do not run `playwright install`. If a browser test fails once, rerun that file once before reading anything into it.

Notes file (append a line after each commit): `docs/agent-handoff/p3/notes-protocol.md`.

## Why (the owner's goal)

Adding or changing a feature must be easy, with a clear trace to what depends on it. A room message today is `{ type, payload }` where `payload` is anything. The server (`server.ts`, the `events` and `sheets` routes) checks only the type name and a size. Each sender in `src/views` builds its payload by hand (`grep -n "sync.send\|S.send\|sy.send" src`), and `applyEvent` in `src/edge/sync.js` (about lines 100 to 200) re-checks every field as it applies it. So adding a message means touching the server's list, a sender and the apply chain, with nothing that ties the three together, and a phone trusts whatever shape arrives. `hp` and `status` are applied once per event id; `award` and `quest` are not, so a replayed award pays twice.

Old rooms and old clients do not need to work: the build handshake (AGENTS.md) refuses any other build. Change the wire format freely.

## The model (decided; say in the notes if something cannot work)

`src/core/protocol.ts`, strict TypeScript, pure, imported by both `server.ts` and the client.

- Branded ids, made only by the parsers: `RoomCode`, `DeviceId`, `EventId`, `SheetKey` (`<deviceId>:<hunterId>`).
- `RoomEvent` is a union on `type` (`system`, `award`, `quest`, `gate`, `hp`, `status`, `roll`, `questUpdate`), each with its own typed payload. Every event has an `eid`. The `v: 2` field goes. Payloads reuse core types where they exist (`Status` and `StatusDef` from `src/core/combat/status.ts`, rewards and quest shapes from `src/core/save.ts`); do not declare a second copy of a shape.
- One table, `EVENTS`, typed so that an event type missing from it fails the typecheck: per type, `gmOnly` (who may send it) and `parse(payload)` (unknown in, typed payload or `null` out, every string and list bounded). `parseEvent(type, payload): RoomEvent | null` is the only door. The server calls it before it stores an event; the client calls the same function on every event it receives. Inside the system the typed event is trusted and nothing re-checks fields.
- Room documents the same way: `DOCS` table with `encounter` (what `encDoc()` in `src/views/combat.js` publishes and `src/views/table.js` reads), plus `parseSheet` for a hunter sheet a phone pushes (it may reuse the save's hunter repair; say what you chose). The server validates a doc or sheet by its key before storing it.
- The poll answer (`GET /api/rooms/:code`) has a type, `RoomState`, and the client parses it with `parseRoomState`.
- Applying an event is idempotent on every phone: any event that changes a hunter (`award`, `quest`, `hp`, `status`) is applied at most once per phone, by `eid`, and that stays true across a reload and across leaving and rejoining the room. Decide where the applied ids live (a bounded ring in the save's sync settings is the obvious place) and why, in the notes.

## Unit A: types, parsers, server

1. `tests/protocol.test.ts` first, then `src/core/protocol.ts`: for each event type a valid payload round-trips and the hostile cases are refused or bounded (wrong types, a 10 MB string, 10,000 list entries, `__proto__` keys, numbers out of range, a missing `eid`, a status def with nested ops four levels deep). The same for the encounter doc, a sheet and the room state. Expected values come from the rule, not from running the parser.
2. `server.ts`: the `events` route stores only what `parseEvent` accepts (400 with a reason code otherwise), `gmOnly` comes from the table (delete `TYPES_OK` and `GM_TYPES`), the `sheets` route validates a sheet or a doc with its parser. Add hostile-input cases to `tests/server-rooms.test.ts` through the handler: each refused request leaves the room unchanged.
3. Make the existing senders produce payloads the server now accepts, with the smallest change (add the `eid` where it is missing, drop `v`). Unit B types them properly. Run `room-sync`, `room-sync-fixes`, `table-session`, `gates-quests-dailies`.
4. `AGENTS.md`: a "Where things live" row for the room protocol.

## Unit B: the client

0. Three changes the lead decided after reviewing unit A, tests first, one commit:
   - Delete the `gate` event type everywhere (the union, `EVENTS`, tests). Nothing sends it, and a message nobody sends is dead weight (`principle-subtract-before-you-add`).
   - The server refuses a `roll` or `questUpdate` whose `by` key does not belong to the sending device (`by` must start with the request's `from` device id). Today any player can post a roll in another player's name. Add the hostile case to `tests/server-rooms.test.ts`.
   - Unit A decided the applied ids: a ring of at most 200 at `settings.sync.applied` in the save, for `award`, `quest`, `hp` and `status`, recorded before the event is applied. Build that. The ring lives in a small pure function in core with a bun test.

1. Read `docs/agent-handoff/p3/notes-protocol.md` and `src/core/protocol.ts` first.
2. In `src/edge/sync.js`, received events go through `parseEvent` once, then to one typed registry of appliers: an object with one function per event type, written in a small typed module (`src/edge/room-events.ts` or similar) so a new event type without an applier fails the typecheck. Delete the field re-checks inside `applyHp`, `applyStatus` and `applyEvent` that the parser now does. Do not restructure the rest of `sync.js` (the link and push code is the next milestone's).
3. One typed `send(event)` for every sender in `src/views` (`combat.js`, `gm.js`, `gates.js`, `custom.js`, `quests.js`, `inventory.js`, `table.js`): the event is built by a small constructor in `protocol.ts` that makes the `eid`, so no view writes an event id or a payload shape by hand.
4. Idempotent apply as decided in unit A, with tests first: a bun test for the applied-ids ring, and a browser test in `room-sync-fixes.e2e.ts` named for what the player sees (an award the GM sent once is paid once, even when the player reloads and when the player leaves and rejoins the room).
5. The poll answer goes through `parseRoomState`. `table.js` reads the typed encounter doc.
6. Lint rule in `tests/lint.test.ts`, named in `AGENTS.md`: no view calls the raw send with a string type, and nothing outside `protocol.ts` builds an event id. AGENTS.md recipe "To add a room message" (the union member, the `EVENTS` entry, the applier, the constructor, the tests to copy).
7. Run every room browser file: `room-sync`, `room-sync-fixes`, `room-view`, `room-onboarding`, `table-session`, `gates-quests-dailies`, `customization`, `character`.

## Rules for both units

- What a GM or player sees does not change, except that a replayed award or quest is no longer applied twice.
- Views stay JavaScript. Do not restyle them.
- A parser that guesses is worse than one that refuses: when a field is wrong, refuse the event (or drop the one list entry) and say which in the notes. Do not coerce a wrong type into a default.

## Done means

- `bun run test` passes and the browser files your unit names pass.
- Final reply under 200 words: what you made, the last line of each command, what you decided about the applied ids, anything you were unsure of or left out.

If a step turns out to be wrong or much larger than it reads, stop, write why in the notes file and reply. Do not widen the task.
