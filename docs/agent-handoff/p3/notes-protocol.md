# Notes: the room protocol (M5)

## Unit A

### What each event carries today (read at 8e71d04, before any change)

Senders (`grep -n "sync.send\|S.send\|sy.send" src`) and what `applyEvent` / `applyHp` / `applyStatus` and the GM's `sync:event` listeners read.

| type | senders | payload today | read by |
|---|---|---|---|
| system | gm.js doBroadcast | `{ tag, title, body, kind, to? }`. No eid, no v. `kind` from gm.js `SYS_KINDS` | applyEvent: tag, title, body, kind, lines (no sender sends lines), to |
| award | gm.js doAward, gates.js clear, custom.js gmMenu, combat.js end (via sendRoom) | `{ to: [key], rewards }`. gm: rewards `{xp, gold, points, items, titleName}`; gates: `{xp, gold, items}`; custom: `{build: 'respec' or {path} or {tier, pick}}`; combat: `{xp}` plus `eid, v: 2`. Only combat sends an eid | applyEvent: `rewards` (or the payload itself), xp, points, gold, items, then hunter.applyRewards, which also reads title, skills, job, build |
| quest | gm.js doIssue, quests.js save form | `{ to, quest }`. gm: quest `{kind, title, desc, from:'gm', objectives, rewards, penaltyText?, dueAt?}`, no eid; quests.js: `{kind, title, desc, objectives, rewards, dueAt, penaltyText}` plus `eid, v: 2` | applyEvent: `quest` (or top-level title/desc/kind/rewards/objectives), needs title; questWindow reads desc, objectives, rewards (xp, gold, points, items, title/titleName, job, skills), penaltyText, dueAt |
| gate | none | nothing sends it | nothing applies it |
| hp | gm.js sendHp, combat.js sendRemote | `{ eid, v: 2, to: [key], hp?, mp?, fatigue?, reason }` | applyHp: hp, mp, fatigue (clamped to 99999), reason or src (no sender sends src) |
| status | gm.js sendStatus, combat.js sendRemote | `{ eid, v: 2, to: [key], add?: [{key, rounds, def}], remove?: [key], reason? }` | applyStatus: add (key, rounds, def; an entry without a readable def is skipped), remove |
| roll | inventory.js sendItemRoll, table.js roll feed | `{ eid, v: 2, by, name, label, expr, total, rolls, crit, fumble, kind: 'item' or 'skill' or 'roll', dmg }` | table.js GM feed: eid, name, label, expr, total (must be a number), crit, fumble, dmg |
| questUpdate | quests.js sendUpdate | `{ eid, v: 2, by, name, questId, title, kind, status, objectives: [{label, progress, target}] }` | quests.js GM log (questId required, name, title, status, objectives); table.js feed |

Every `to` entry a sender writes is a sheet key `<deviceId>:<hunterId>` (gm board keys, combat `remote`, gates `r.key`, quests checkbox values, custom `key`).

Room docs written with `putDoc`: `encounter` (combat.js encDoc), `kicked` (sync.js), `codex` (bestiary.js), `build` (custom.js), `world` (gates.js). All five go in the `DOCS` table, because the server now refuses a doc name it has no parser for.

### Step 1: `src/core/protocol.ts` and `tests/protocol.test.ts`

- Parser policy (one rule, in the comment above the readers): a wrong type is refused; a missing optional field takes its default (missing is not wrong: gm.js leaves out `penaltyText` and `dueAt`); a string is cut to its length; a list is cut to its count and a bad entry is dropped; a number outside its range is clamped; an id or key that is malformed or too long is refused (a cut id names something else).
- `eid` lives in the payload (the brief's `parseEvent(type, payload)` signature). `v` is dropped by every parser.
- `to` is required and non-empty for award, quest, hp, status. For system it is optional: absent means every player (it stays absent in the parsed payload, because today's `targets()` treats `undefined` as everyone and `null` as no one).
- Award and quest rewards: `GivenRewards` = the save's `Rewards` with typed items (`Omit<Item, 'id'>`). Award adds `build?: BuildChange`. `title` and `skills` are not on the wire: no sender sends them (applyRewards still reads them for local rewards).
- `gate`: nothing sends it. I typed it minimally (`gateId`, `status`) so the table stays complete as the brief asks. Recommend unit B or the lead delete it (subtract before adding).
- hp: a missing hp, mp or fatigue is 0. An all-zero hp event is accepted (refusing it would make combat show "phone could not be reached").
- DOCS has all five docs the app publishes (encounter, kicked, codex, build, world), not only encounter: the server now refuses a doc name it has no parser for. The parsed encounter doc gains `ended: false` on a running fight (a union on `ended`).
- Sheets: `parseSheet(key, data)` is a tombstone `{deleted: true}` or `parseSheetHunter` (new export in save.ts): the save's own hunter repair (fill by example + fixHunter), run on a JSON copy with `__proto__` keys removed and each list cut to 100. Two differences from a save: the build path and perk skill are kept as the phone sent them (the sending phone's rules give them meaning; the server has none), and inner ids are not renumbered. The hunter's id must equal the hunter part of the key. Chose reuse over a new hunter parser, so a sheet and a save cannot disagree about what a hunter is. Note this follows the save's repair policy (a wrongly typed field takes its default), unlike the event parsers.
- RoomState carries `next` (the cursor to ask from) and `more` (page was full), set by the server, so a client that drops a bad event still moves its cursor past it.
- Principle that changed a choice: type-system-discipline (branded ids made only by parsers; DEFS mapped type so a missing type fails tsc); boundary-discipline (the server stores the parsed value, not the raw one).

### Step 2: server.ts

- `TYPES_OK` and `GM_TYPES` are gone; `gmOnly` comes from `EVENTS`. Order on POST events: sender (`parseDeviceId`) then type (400 `{error:'bad event', reason:'sender'|'type'}`), then GM key (403), then device owner (403), then `parseEvent` (400 reason `payload`). The GM check stays before the payload check, so a player's award is still 403 `gm only` whatever its payload.
- The store holds the parsed event, sheet or doc, never the raw body. `Ev` is `RoomEvent & {seq, at, from}`.
- Sheets route: a hunter key must be a `SheetKey` (`<deviceId>:<hunterId>`; a bare `h1` is 400 `bad hunter id`). A doc name must be in `DOCS` (else 400 `bad doc`). Size check (413) still runs before the parser. A sheet must carry its own `id` equal to the key's hunter part (added to `parseSheet` in this step: without it the save's fill gave a missing id the default `h1`).
- GET answer is typed `RoomState` and now carries `next` and `more`. The rows read back from the store are cast to the typed shape with a comment (only parsed values are written; a Postgres row from an older build would not be, and the client parses the answer again anyway).
- Tests: `tests/server-rooms.test.ts` has 10 refused events and 4 refused sheets and 4 refused docs, each checking the room is unchanged after, plus "the room keeps the parsed event" and "keeps the repaired sheet". `tests/server-handshake.test.ts` setup sheets got an `id` (they were refused for that, not for the build).
- Not done, possible follow-up: the server does not check that a player's roll or questUpdate `by` key belongs to the sending device.

### Step 3: senders

- Smallest change: `v: 2` dropped everywhere; an `eid` added to gm.js award, system and quest (its existing `eid()`), and inline to custom.js and gates.js awards (same format as the other views; unit B replaces all of these with the constructor). gm.js system now always sends `{eid, ...b}` and adds `to` only for "selected hunters".
- protocol.ts: a row status whose color is not `#rrggbb` keeps the status and leaves out the color (a GM rules override may put any text in a status color; refusing the row would hide the status from the table). Test added.
- Browser runs (E2E_PORT=3241): room-sync 1 passed; room-sync-fixes 8 passed; table-session 4 passed; gates-quests-dailies first run 1 failed (Job Change chain, no room in it: a System window covered the Active tab; run took 3.8 min against 1.9 min, so a box pause), rerun 15 passed, 1 skipped (the existing fixme).

### Step 4: AGENTS.md

- One "Where things live" row for the room protocol. The "To add a room message" recipe and the lint rule are unit B's (step 6).

### Decision for unit B: where applied event ids live

- A bounded ring in the save: `settings.sync.applied: EventId[]`, newest last, at most 200 (one poll page). An optional field on `SyncSettings` in save.ts, with a repair line that keeps only strings `parseEventId` accepts and cuts to 200, and a case in tests/save.test.ts.
- Why the save: the cursor already stops a replay within one room link, but a reload of an old page, a rejoin (the cursor is reset) or a GM resending after a timeout that did land all bring an event back. Only something persisted on the phone survives a reload and a leave and rejoin; `leave()` and `join()` rewrite `room` and `cursor` but leave the rest of `settings.sync` alone.
- Why one ring and not one per room: an eid is the sender's device id plus a time and a random part, so it does not repeat across rooms. One list is simpler and bounded.
- Why 200: a replay comes from the last page or a resend seconds later. An event older than 200 hunter-changing events is not caught; that is accepted.
- Order: record the eid in its own `store.update` first, then apply (as the cursor does: "advance first"). That is at most once even if the tab dies in between, which is what the brief asks for.
- Only award, quest, hp and status go in the ring (the ones that change a hunter). system, roll, questUpdate and gate do not.

Unit A done at this commit. `bun run test`: 534 pass, 0 fail.

## Unit B

### Step 0: the lead's three changes

- `gate` event deleted from the union, `EVENTS` and both test files. Nothing sent or applied it.
- Server: a `roll` or `questUpdate` whose `by` sheet key's device part is not the request's `from` is 403 `not your sheet` (the answer the server already gives for another device's sheet), checked after the payload parses. Tests: another player's name, and a device id that is only a string prefix of the key's device (`d-player` posting for `d-player1:h1`).
- Applied ids: `src/core/applied.ts` (`recordApplied`, `parseApplied`, `APPLIED_MAX = 200`), `tests/applied.test.ts`, `settings.sync.applied?: EventId[]` in save.ts with a repair line (not a list: removed; else only event ids, newest 200) and two save test cases.
- To let save.ts use `parseEventId` without an import cycle (protocol.ts imports save.ts), the branded ids and their parsers moved to `src/core/ids.ts`, which imports nothing; protocol.ts re-exports them, so no importer changed. Added `deviceOf(key)` beside `hunterIdOf`.
- `bun run test`: 539 pass, 0 fail.

### Step 2: the applier registry

- `src/edge/room-events.ts`: `APPLIERS`, typed `{ [K in EventType]: Applier<K> | null }`, so a new event type without an entry fails tsc. `null` (named `GM_ONLY_READS`) is for roll and questUpdate: a player's phone applies nothing, the GM's views read them from `sync:event`. Each applier has `once` (applied at most once per event id); in this step only hp and status, as before, with sync.js's session ring.
- `applyRoomEvent(ev, deps, firstTime)` finds the phone's hunters in `to` (`targets`: a sheet key of this device whose hunter is here; no `to` means every hunter), asks `firstTime` only for a `once` event that is for one of them, then applies.
- sync.js: each received event goes through `parseEvent` once (a malformed one is dropped, its seq still passes the cursor), then `sync:event` carries the parsed event, then the registry. Deleted from sync.js: `targets`, `targetsStrict`, `keyOk`, `str`, `cleanDef`, `labelOf`, `describe` and its legacy fallback, `applyHp`, `applyStatus`, `applyEvent`, `questWindow`, `PLAYER_TYPES` (about 120 lines). The appliers use core's `statusDef` and `describe` with `app.rules()` instead of the `app.api.effects` wrappers (the same functions).
- Dropped with the re-checks: the `lines` of a system event, a quest's top-level fields, `src` on hp, `title` and `skills` objects in quest rewards. No sender sends any of them, and the parser drops them.
- room-sync 1 passed, room-sync-fixes 8 passed. `bun run test` 539 pass.

### Step 3: one constructor, one send

- `newEvent(type, body, stamp)` in protocol.ts is the only place an event id is made: `<device>-<time base 36><4 random base 36>`, the device part cut so the id stays within 40. It returns the event as `parseEvent` reads `{...body, eid}`, or null when the server would refuse it, so a JS view that builds a wrong body finds out on its own phone. The clock and the random number come in as `stamp` (core stays pure). Tests in tests/protocol.test.ts: each type round-trips with the parser and matches the VALID table, two ids in one ms differ, a sender's own eid is replaced, a 40-character device id still gives an accepted id, a bad body makes no event.
- sync.js: `app.api.sync.event(type, body)` stamps with the device id, `Date.now()` and `Math.random()`; `send(event)` posts `{from, type, payload}` of a built event. `send(null)` warns in the console (the e2e fixture fails on it) and answers false.
- Senders: combat.js `sendRoom(type, body, ...)` and a `roomSend(type, body)` helper in gm.js call `send(event(type, body))`; custom, gates, inventory, table and quests call it inline. The five `eid` makers in views are gone. quests.js changed only at its two send call sites and the `eid` helper they used.
- table-session 4 passed, room-sync 1 passed; `bun run test` 550 pass.

### Step 4: idempotent apply

- award and quest are `once` in `APPLIERS` now, beside hp and status. sync.js's `firstTime` records the eid with `recordApplied` in its own `store.update` ('sync-applied') before the applier runs; the session ring (`seen`, `RING`) is gone. An event for none of this phone's hunters is not recorded.
- Browser test in room-sync-fixes: "an award the GM sent once is paid once, even when the player reloads and when the player leaves and rejoins the room". The award is sent through the GM screen. A replay needs the phone's cursor behind the award (the cursor already stops a replay within one link, and a join starts at the room's head), so the test rewinds `settings.sync.cursor` to 0 through the store as setup, reloads, and waits until the cursor is back at the award's seq (the page with the award was read again) before reading the gold. Run before the change: failed, gold 50 against 25. After: room-sync-fixes 9 passed.

### Step 5: the poll answer

- sync.js `getRoom(path, key)`: every `GET /api/rooms/:code` answer goes through `parseRoomState`; an answer that is not one throws like a lost request (no status, so the link shows reconnecting). Used by the poll, `headCursor` (join) and the removed window's check. The poll takes `next` as the cursor and `more` for paging, so an event the parser dropped is still passed; the per-event `parseEvent` of step 2 is gone because `parseRoomState` already parsed each one. `headCursor` uses `next` and `more` instead of reading the last event's seq.
- table.js reads the typed `EncounterDoc`: an ended fight has no list or round, so `rowsOf` and the HUD branch on `ended`; the row, band, HP, round and name re-checks are gone, and so are the try/catch wrappers around them. The GM's roll feed listener reads the typed roll and questUpdate payloads (its `try`, number and status checks are gone). quests.js's own `sync:event` listener still re-checks its fields: the prompt keeps that file to its send call sites.
- On the GM's own phone `doc('encounter')` is still the raw body `putDoc` stored locally, not a parsed one (putDoc is the room link's code). The table reads it only for a player, so nothing depends on it today.
- room-sync 1, room-view 8, table-session 4 passed; `bun run test` 550 pass.

### Step 6: lint rules and AGENTS.md

- tests/lint.test.ts: "a view sends a room event made by the constructor" (no `.send('...` with a string in src/views) and "only src/core/protocol.ts makes a room event id" (in TS a cast `as EventId` outside protocol.ts and ids.ts; in JS an `eid` key or shorthand in an object literal, or an `eid = () =>` maker). `eid` also names an encounter id in combat core, so the rule looks for an id being made, not the word. Checked against the senders at 6e02ec0: the first rule finds 8 lines in gm.js, quests.js and table.js, the second 11.
- AGENTS.md: a "Where things live" row for the appliers and the applied ids, `newEvent` and `parseRoomState` in the protocol row, the recipe "To add a room message", and the lint rule.
- Another helper (the link and push machines) commits on this branch in the same tree; their files (`src/core/sync/*`, `tests/link*.test.ts`, `tests/push.test.ts`, `tests/sync-model.test.ts`) are why `bun run test` now counts 612 tests across 18 files. I did not touch them.

### Step 7: every room browser file (E2E_PORT=3241, one run per file)

- room-sync 1 passed; room-sync-fixes 9 passed; room-view 8 passed; room-onboarding 6 passed; table-session 4 passed; gates-quests-dailies 15 passed, 1 skipped (the existing fixme); customization 8 passed; character 10 passed. No reruns needed.
- `bun run test`: 612 pass, 0 fail (18 files, the link helper's included).

Unit B done. Principles that changed a choice: subtract-before-you-add (deleted `gate`, the session ring and about 150 lines of re-checks in sync.js and table.js); type-system-discipline (a mapped `APPLIERS` type so a new event type needs an applier; ids moved to `ids.ts` to keep one parser for an event id in the save); make-operations-idempotent (the eid is recorded in its own store update before the applier runs); test-behavior-not-implementation (the paid-once test was run first and failed with gold 50 against 25).
Left out: putDoc still keeps the raw doc body locally on the GM's phone (room link code); quests.js's own `sync:event` listener still re-checks fields (outside what the prompt let me change there).
