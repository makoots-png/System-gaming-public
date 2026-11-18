# V5: the link's saves as steps

Goal: what the room link writes in the save is a set of named core steps with a table test, run by sync.ts and by the
room model alike. Problem: sync.ts wrote the room fields, the GM key ring, `serverOk` and a player's bind by hand inside
`store.update`, the bind twice (join and rebind) and the ring's drop twice (`save` and `forgetKey`); a view read the ring
to rejoin; "when a step happens" was written four times. Smallest change: src/core/sync/bind.ts, sync.ts calling it
through `store.apply`, the link finding its own key, and day.ts `stepTime` read by every dated step.

## Inventory (code at 755e40e)

| Row | Verdict | Where |
|---|---|---|
| N6 | still true | sync.ts:375 `heard`, 389-414 `save` (the ring's keep with `KEYS_MAX`, drop, gone), 537-545 `bindJoin`, 669-685 `switchTo` (the bind again; "view only" sets `activeHunterId` by hand), 812-816 `forgetKey` (the gone drop again) |
| N6 more | still true | gm.js:721 and room.js:184, 237 read `settings.sync.gmKeys[c]` to rejoin or to check a key is kept |
| N13 | still true | combat.js:398, hunter.js:115, gates.js:33, sync.ts:471 (each `dayKey(now, dailyResetHour \|\| 0)`); quests.js:258 a fifth (`dayKey(now, resetHour())`) |

## The rows

**N6.** Cause: the link's writes were hand mutations in the edge, so their rules (the ring's cap, which key a refusal
drops, the bind's outbox rebind) lived in two places each and nothing tested them. Change: src/core/sync/bind.ts
`linkSaved(save, fields, refused)` (the link's `save` effect), `ringKeep`, `ringDrop`, `ringGone` (also the forget of a
key), `serverSeen`, `atSync`, and `boundTo(save, hid, at)` (one step for a join and a rebind: active when held, bound,
joined at the server's time, its tombstone dropped). sync.ts calls each in one `store.apply`; "only view" is party.ts
`setActive`. A read-only tab's link now changes nothing in the save (`apply` refuses there; `update` wrote). The room
model runs the ring's steps in its copy of `save`. `rejoinGM(code, key?)` finds the kept key itself (`keyFor`), so no
view reads the ring; the Room view asks `gmRooms()` whether a key is kept. Tests: tests/bind.test.ts (the ring's cap
and order, a refused key against a typed one, a gone room, the save effect's fields, the bind and its tombstone),
tests/room-system-model.test.ts.

**N13.** Cause: each view built "now and today's day key at the reset hour" itself, with a `|| 0` the repair holds.
Change: day.ts `stepTime(save, now)` (added in V2 for the GM's award) is read by hunter.js, combat.js, gates.js,
sync.ts and quests.js's rollover; the copies and their `|| 0` are gone. Test: day.test.ts.

The store's new hunter's `lastCheckedKey` was a sixth copy (store.ts:278); it reads `stepTime` too, and a lint ("a
step's day is day.ts stepTime") refuses a `dayKey(` in a view or the edge.

Commits: a3bb46f (bind.ts, sync.ts, the model, the outbox lint's owner), 1ead41d (rejoin), 280bbc6, fe31195, ced90c6
(N13).

Lines in Lane A's files: combat.js and gates.js (fe31195: `dayNow` reads `stepTime`), one line each, and their imports.

Principles: separate-before-serializing-shared-state (the link's fields have one writer, the steps; a read-only tab no
longer writes them); subtract-before-you-add (the bind's and the drop's second copies deleted).

Left: the lint "only src/edge/sync.ts writes the room, cursor, last room and GM key" scans views and the edge, so
bind.ts (core) is outside its view; its words still name sync.ts, which is the steps' one caller.
