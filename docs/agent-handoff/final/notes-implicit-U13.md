# Notes: implicit audit unit U13, the seat

Helper, main tree on `claude/zen-pasteur-ov4cgd`, Playwright port 3241. Brief `brief-implicit-unit.md`, poteto mode.

## Goal

the owner wants every rule explicit. The seat (this phone is alone, the room's GM, or a player in a room) was worked out
in about a dozen views by their own test: `app.isGM()` beside `sync.room()`, `sync.isGM()`, a `try` that answers
false. A copy that differs shows a control to the wrong phone. The smallest change that meets it: one pure
`seatOf(settings, room)` in `src/core/role.ts`, `app.seat()`, every copy replaced by it, every rule that differs by
seat taking the seat as an argument in core, and a lint that refuses a new copy.

Principles read this session: poteto-mode, model-the-domain, type-system-discipline, boundary-discipline,
subtract-before-you-add, migrate-callers-then-delete-legacy-apis, encode-lessons-in-structure, prove-it-works,
test-behavior-not-implementation, unslop.

## Decision trail

1. Which room the seat reads. Two answers existed: `roleOf` read the save's `settings.sync.room`; the views read the
   link's `sync.room()`. The link writes the save's room in every state but `off` (a page with no room server) and
   `upgrading` (where `sync.room()` reads the save anyway). So they differ only on a page with no room server whose
   save holds a room (a campaign file with a room, imported on a static host): `roleOf` said "player in a room" with no
   way to leave (a `leave` does nothing while `off`), while the views said "alone". The seat now reads the link's room,
   as the audit's signature `seatOf(settings, room)` says, and the role is derived from the seat
   (`roleOf(settings, room)`: alone, the phone's own choice; in a room, the seat). One answer for every reader.
   Model-the-domain changed this: one source for "in a room", not two that agree by accident.
2. The seat is a three-way union `'alone' | 'gm' | 'player'` (type-system discipline): `{ role, inRoom }` pairs in
   `quest-rights.ts` and `{ inRoom, gm }` in `coin.ts` could hold a GM-in-a-room with no room; both now take the seat.
3. The role stays (`app.isGM()`): a GM alone runs the GM's tools on its own phone. A view asks the role for "may this
   phone use GM tools" and the seat for anything that depends on a room.
4. Where the players' sheets come from. Four views gated `sync.remoteSheets()` on "this phone is the GM" by hand
   (combat, gates, quests by `sync.isGM()`, skills by the room alone). `roster` in sync.ts already answered only on the
   GM's link. The cause is one fact (a player's phone has no use for the others' sheets) held in four views; it now
   holds in `remoteSheets` itself (`gmRoom()`), and the four gates go. Subtract-before-you-add: no new API member.
5. "Sent to the GM" was the view's own guess (`!isGM() && room()`) beside `uses.report`, which decides the route by the
   same test. The toast now reads report's answer, and the route is `useRoute(seat, use)` in protocol.ts.
6. Three variants weighed for where `runsFight` lives: role.ts (the seat's own rules), fight.ts (the reducer, which
   knows nothing of rooms), a new module (one function). role.ts: the rule is about which phone owns the fight, a seat
   question, and the reducer stays free of rooms.

## The inventory (taken again at c7317a9, thirteen units after the audit)

Every place in src/ that worked out the seat by its own test, and its fix. Commits: 6beba3e (core, app, non-fight
views), dafba9e (combat.js), f329738 (table.js), e0ccc29 (sync.isGM gone, the lint), 2b54b54 (remoteSheets, useRoute),
03e8b87 (combat.js remoteList), and the browser case in room-sync-fixes.e2e.ts.

| Where | The copy | Fix |
|---|---|---|
| app.js `role()`, header pill, pill tap | `roleOf(settings)` read the save's room; the pill read `settings.sync.room` | `seatOf`/`roleOf(settings, sync.room())`; `app.seat()`; the pill asks the seat |
| sync.ts `isGM` (storedRoom, `detail().gm`, the API's `isGM`) | `roleOf` of the save | storedRoom reads the save's key; `detail().gm` and `sync.isGM` deleted (no reader left) |
| combat.js:58-60 `inRoom`, `canRun`, `inRoomAsGM` | room and role in a `try` answering false | `runsFight(app.seat())`, `app.seat() === 'gm'` |
| combat.js:175 `remoteList` | `S.isGM()` in a `try` | `sync.remoteSheets()` (GM only in sync.ts) |
| combat.js:928 local dismiss | `!inRoom()` | `app.seat() !== 'player'` |
| table.js:36-39, 609 | `isGM`, `room` in `try`s, `inRoomPlayer`, `inRoomGM` | both read `app.seat()` |
| uses.js:28 `tableOf`, :38 `report` | `!isGM() && room()` | `app.seat() !== 'player'`; the route is `useRoute(seat, use)` |
| inventory.js:70, skills.js:58 | `player = !isGM() && room()` for "Sent to the GM" | the toast reads `report`'s answer |
| skills.js:226 `receivers` | `room ?` the players' sheets | `remoteSheets()` (GM only) |
| bestiary.js:110 codex from the room | `!S.room() \|\| isGM()` | `app.seat() !== 'player'` |
| bestiary.js:482-494 | `!gm && inRoom`, `!inRoom \|\| gm` | `seat === 'player'` (codexOnly), `runsFight(seat)` |
| quests.js:170-176 `sendUpdate` | `q.from !== 'gm' \|\| isGM() \|\| !inRoom()` | `reportsProgress(q, seat)` in quest-rights.ts |
| quests.js:202 `mayChange` | `{ role, inRoom }` | `mayChangeQuest(q, seat)` |
| quests.js:374 `remotes` | `sy.isGM()` | `remoteSheets()` (GM only) |
| coin.js:48 `deciderNow` | `{ inRoom, gm }` | `decider(app.seat())` |
| coin.js:61 `sendCall` | `!S.room()` | dead (only a player in a room calls): deleted |
| gates.js:108 `remotes` | `sync.isGM()` in a `try` | `remoteSheets()` (GM only) |
| gates.js:160 `mergeWorld`, :174 `sync:docs`, :177 `sharedWorld` | `!code \|\| !isGM()`, `!isGM()`, `isGM() \|\| !room()` | `app.seat()` |
| room.js:176, 217 | `Y().room()` as "in a room" | `app.seat() !== 'alone'` |
| room.js:312 render | `gm = isGM()` beside the code | `seat`; the lobby (alone) keeps `isGM()` |
| room-pill.ts:27 | `{ room, gm: isGM() }` read together | the room and, in the idle pill only, the role |
| custom.js:175 `inFight` | `S.room() ?` before `S.doc('fight')` | dead (a doc is null outside a live room): deleted |

Rules that differ by seat and were in a view: "solo play runs its own fight, in a room only the GM does" (`runsFight`),
who may change a quest (`mayChangeQuest`), whose quest progress the GM hears (`reportsProgress`), who picks the coin's
side (`decider`), where a use goes (`useRoute`), whose phone lists the players' sheets (`remoteSheets`). Each has a
case per seat in its bun test.

Left, with the reason:

- sync.ts `playerRoom`, `gmRoom`, `link.key === null`: they read the link machine, the source of the seat, and are
  live-only on purpose (only a live link sends or binds the room's build).
- bestiary.js render: what a player in a room sees of the bestiary (the monsters the codex records, plus the room's
  codex entries) is a rule in the view. Its parts (`keyOf` by name, `recFor` by name) are the name lookups U14 replaces;
  moving them to core now would move code U14 deletes. The seat it reads is now `app.seat()`. For U14 or after it.
- gates.js `sync:docs`: a player is told of the GM's world (`onWorld`: windows and device memory, no save write), a GM
  merges another GM phone's (`mergeDoc`, core). The view picks one by the seat.
- room.js `showPA`: the Play as row's place is drawing, read from the seat.
- dice.js `who` and `hid`: the GM's roll is "GM" and calls no coin. A role rule (a GM alone too), left by the
  roundtrip unit for the coin; not a seat.
- Every other `app.isGM()`: GM tools (a button, a guard beside it, a core function's role argument), which a GM alone
  uses too. The lint lets `isGM()` alone stand and refuses it beside the room.

## The lint

`a view asks app.seat() whether this phone is in a room, and as what` (tests/lint.test.ts): in src/views and
src/edge (sync.ts, the link's owner, aside) no line tests the room as a yes or no (`!room()`, `room() ?`,
`room() &&`, `if (x.room())`, a view's own `inRoom()`) nor names `isGM(` and a `room(` together. Its first cases are
six old lines; three uses of the room's code pass. Run against c7317a9 it finds 23 lines; against this unit, none.
`sync.isGM` is gone from `SyncApi`, so the typecheck refuses it.
