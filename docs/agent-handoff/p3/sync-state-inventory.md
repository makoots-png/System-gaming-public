# sync.js state inventory (input for the link and push machine brief)

Read-only survey of `src/edge/sync.js` (658 lines) as it stands on Nov 12, with the room routes in `server.ts`. Every `:N` without a file name is a line in `src/edge/sync.js`. This file describes what exists. It proposes no design.

Short version. The link has 11 situations the code can be in, plus 3 membership outcomes, and I count 41 transitions. The push has 10 situations and 27 transitions. Polling has no backoff at all. `serverOk` is never set back to false. Push failures and send failures write the link's `failing` flag, so the two machines share one bit.

## 1. Every piece of state

All "module-level" variables live inside the `register(app)` closure, so there is one copy per tab.

### Variables in sync.js

| Name | Where | Meaning | Written at | Read at | Machine |
|---|---|---|---|---|---|
| `probe` | :36 | This tab talks to a server at all. Starts as `web && (tagged || stored serverOk)` | :36, true at :374 (create). Never set false | :72, :74, :233, :277, :280-283, :319, :332, :347, :466, :487, :532, :566, :651 | link |
| `serverOk` | :21 | A health or room request was answered in this tab | true at :237, :244, :374, :396, :512. Never set false | :72, :74, :296 | link |
| `failing` | :22 | The last request of some kinds failed | true at :270, :282, :308, :336, :354, :536. False at :237, :244, :269, :302, :335, :353, :374, :396, :512, :540 | :72, :74, :536, :540, :567 | link, but push (:302, :308), `send` and `putDoc` also write it |
| `upgrading` | :46 | The server answered 426 `upgrade`. Terminal for the tab | true at :62 | :51, :60, :228, :277, :294, :305, :319 | link |
| `pollP` | :27 | The one in-flight poll promise | :228 | :228 | link |
| `timer` | :27 | Poll `setInterval` id | :62, :276, :278 | :276 | link |
| `curMs` | :26 | Interval of the running timer | :276 | :264 | link |
| `creating` | :370 | In-flight create promise (single flight) | :371, :375 | :371 | link |
| `peeked` | :526 | `code -> {at, exists}` answers of `check()`, reused 30 s | :374, :539. Deleted at :269, :555, :586 | :531 | link (join pre-check) |
| `roomGone` | :27 | The "room no longer exists" toast was shown | true :268. False :374, :396, :512 | :268 | link (gone) |
| `lastOk` | :28 | ms of the last request the server answered, errors included | :66 | :570 | link (display only) |
| `pushTimer` | :27 | Pending push `setTimeout` (debounce or backoff) | :62, :293, :311, :319, :325, :396, :500, :567 | :311, :319, :326 | push |
| `pushing` | :291 | A sheet PUT is in flight | true :299. False :301, :305, :306, :307, :309, :315 | :295, :319, :322 | push |
| `pushAgain` | :291 | A change came in while the PUT was out | true :295, :319. False :301, :305-308, :316 | :301, :316 | push |
| `pushFails` | :291 | Failed pushes in a row | ++ :312. 0 at :302, :309, :325, :396, :567 | :311, :324, :325, :567, :569 | push |
| `failKind` | :291 | `'net'` (no HTTP answer), `'server'`, or null | :302, :306, :309, :310, :396 | :313, :324 | push |
| `lastPushed` | :27 | Last body the server accepted | :302. Reset to '' at :374, :396, :500, :512 | :298, :323, :569 | push |
| `rejected` | :291 | A body the server refused for good (400, 413, or 403 not your sheet) | :302, :306 (twice), :309, :396 | :298, :323 | push |
| `locked` | :28 | The server said another device owns our hunter | true :306. False :302, :374, :396, :500, :512, :563 | :570 | membership |
| `ownerWarned` | :426 | The "locked to another device" window was shown. Never reset | :428 | :428 | membership |
| `remote` | :23 | Sheets from the last poll, `{key: {at, from, data}}` | :30, :244, :410 | :339, :408 | neither (room data) |
| `docs` | :24 | Room docs (`_` rows) from the last poll | :30, :244, :352 | :274, :344 | neither (room data) |
| `presence`, `presenceOk`, `skew` | :27 | Last-poll times per device, GM only | :30, :244 | :341, :358, :579 | neither |
| `srvSkew` | :27 | Server clock minus local clock | :244, :364 | :401, :406, :423, :459, :572, :575 | neither (membership reads it) |
| `seen` | :25 | Ring of the last 200 hp/status event ids. Not cleared on room change | :181 | :181 | neither (event apply) |
| `flushing` | :475 | `flushForgets` is running | :479, :485 | :477 | neither (tombstone queue) |
| `pend` | :594-597 | `app.pendingRoom`, mirrored to sessionStorage `hunter-system-invite` | setter :597 | getter :596 | neither (onboarding) |
| `panelEl` | :630 | The Data panel element | :634 | :647 | neither |

`drop()` (:30) clears `remote`, `docs`, `presence`, `presenceOk` and `skew`. It does not clear `srvSkew`, `seen` or any push variable.

### Fields under `settings.sync` in the save

Type at `src/core/save.ts:111-115`, default `newSyncSettings()` at save.ts:139, repair `fixSync` at save.ts:383.

| Field | Meaning | Written at | Read at | Machine |
|---|---|---|---|---|
| `room` | Code of the room this phone is in, or null | :269, :373, :392, :440, :511, :562 | :73, `roleOf` (src/core/role.ts) | link |
| `cursor` | Highest event seq applied | :249, :269, :373, :392, :440, :511, :562 | :241 | link |
| `serverOk` | A server answered once, ever. Only set true | :237, :257 (via `setSync`), :373, :392, :511 | :36 (boot `probe`), save.ts:457 (migration) | link |
| `gmKey` | GM key of the active room. Not cleared by leave, 404 or removal | :373, :391 (null), :511 | `isGM` :18 via `roleOf`, :242, :334, :350, :404, :416, :435 | membership (role) |
| `gmKeys` | Ring of up to 10 `{code: key}`, newest last | `ringKeep` :16 from :373 and :511, delete at :385 | :17, :78, :379, :529 | membership |
| `lastRoom` | `{code}` after Leave, `{code, gone:true}` after a 404 | :79, :80, :269, :373, :392, :440, :511, :562 | :78 | link |
| `boundHunterId` | The hunter this phone pushes | :288, :394, :499 | :287 | push |
| `deviceToken` | 32-char ownership secret, made on first body-carrying call | :41 | :53 | push (ownership) |
| `joinedAt` | Server-clock time of the player's join or rebind | :392, :499. Not written by `rejoinGM` or `create` | :459 | membership |
| `forgetQueue` | Tombstones still to send, `[{room, hid}]`, cap 20 | :394, :469, :482, :483, :499 | :478 | neither |

Also read: `settings.deviceId` (:105, :242, :250, :302, :343), `settings.activeHunterId` (:287 via `store.active()`, :389, :393-394), `settings.mode` (only through `roleOf`).

## 2. The link as it behaves today

### How the code tells the situations apart

`conn()` (:74) is an ordered ternary over `probe`, `room()`, `failing` and `serverOk`. `status()` (:72) is a second, coarser one over `probe`, `failing` and `serverOk`. The other situations live in flags that neither function reads.

| # | Situation | Variables that define it | `conn()` shows |
|---|---|---|---|
| L1 | Off (no server) | `probe` false | off |
| L2 | Probing, no room | `probe`, no room, `serverOk` false, `failing` false | ready (`status()` says offline) |
| L3 | Idle | no room, `serverOk`, not `failing`. `lastRoom` null, `{code}` or `{code, gone}` is data on top | ready |
| L4 | Unreachable | no room, `failing` | unreachable |
| L5 | Creating | `creating` set. No other flag | whatever it was (ready) |
| L6 | Joining | No flag at all. The code is inside an `await` of `joinRoom`, `join` or `rejoinGM` | whatever it was |
| L7 | Connecting | room set, `serverOk` false, not `failing`. Only reachable at boot with a remembered room, because `serverOk` never goes back to false | connecting |
| L8 | Live | room, `serverOk`, not `failing` | live |
| L9 | Reconnecting | room, `failing`. Polls keep the fixed 5 s (or 3 s) interval. There is no backoff on the link | reconnecting |
| L10 | Upgrading, reload pending | `upgrading` true | unchanged. In a room the 426 poll sets `failing`, so reconnecting |
| L11 | Upgrade stuck | `upgrading` true and `upgradeRefused` called `store.notify` (src/edge/upgrade.ts) | same as L10 |
| M1 | Room gone | becomes L3 with `lastRoom.gone`, `roomGone` true | ready |
| M2 | Removed by the GM | becomes L3 with `lastRoom` null and the REMOVED FROM ROOM window open. No stored marker | ready |
| M3 | Locked out of our sheet | L8 or L9 plus `locked` true, `rejected` = body | live or reconnecting |

"Reconnecting with backoff" from the brief does not exist. Only the push backs off.

### Transition table

Effects abbreviate: "reset A" means `serverOk = true; failing = false; roomGone = false; lastPushed = ''; locked = false; drop()`, which create (:374), join (:396) and rejoinGM (:512) each do, with differences noted. `changed()` (:76) is `emitStatus()` then `wake()` (restart the interval).

| # | From | Event | To | Effects | Where |
|---|---|---|---|---|---|
| 1 | boot | `probe` false | L1 | pill renders empty | :36, :650 |
| 2 | boot | `probe`, no stored room | L2 | `wake()`, `poll()` | :651-653 |
| 3 | boot | `probe`, stored room | L7 | `wake()`, `poll()` | :651-653 |
| 4 | L2, L3, L4 | timer tick (visible), visibility, `online`, `pageshow` | same | `GET /api/health` (no build header, so never 426) | :233-234, :278-283 |
| 5 | L2, L4 | health ok | L3 | `serverOk`, `failing` false, store `serverOk: true`, emit `sync:status` | :237, :271 |
| 6 | L2, L3 | health error, timeout, `{offline:true}` | L4 | `failing = true`, emit `sync:status` | :236, :270-271 |
| 7 | L2-L4 | health answer after a room was set meanwhile | same as current | nothing written, loop polls again for the current room | :235, :228 |
| 8 | L7, L8, L9 | timer tick and the other poll triggers | same | `GET /rooms/CODE?after=cursor&d=deviceId`, GM key header when `isGM()` | :242 |
| 9 | L7, L8, L9 | room poll 200 | L8 | write `remote`, `presence`, `skew`, `srvSkew`, `docs`. Advance `cursor` before applying. Apply player events, emit `sync:event` for each foreign event. Page again while a page has 200 events. Emit `sync:sheets`, `sync:docs`. Player: `bindNow`, `checkKicked`. `resumePush` unless quiet. `flushForgets`. `wake()` if encounter speed changed. Emit `sync:status` | :244-264, :271 |
| 10 | L8, L9 | poll 200 and the `_kicked` doc names the bound hunter after `joinedAt` and under 10 min ago | M2 | `removed()` (row 27) | :262, :457-463 |
| 11 | L7, L8, L9 | poll 404, any body | M1 then L3 | first time in the tab, toast "This room no longer exists". Store `room: null, cursor: 0, lastRoom: {code, gone: true}`. `drop()`, `failing = false`, delete `peeked[code]`. Push timer, `locked`, `gmKey` untouched | :267-269 |
| 12 | L7, L8, L9 | poll 403 | L9 | the room GET never answers 403 (server.ts:213-229), so this only comes from a proxy. Treated as any error | :270 |
| 13 | L7, L8, L9 | poll network error, timeout (20 s), 5xx, `{offline:true}` | L9 | `failing = true`, emit `sync:status`. Next try is the next tick | :270-271 |
| 14 | any | any `/rooms` answer 426 `upgrade` | L10 or L11 | `upgrading = true`, clear poll interval and push timer, `upgradeRefused` reloads once per server build or shows the stuck notice. The poll that got it then sets `failing` (row 13) | :61-64, :270 |
| 15 | L10, L11 | any later `/rooms` call or answer | same | throws 426 at once, before or after the fetch | :51, :60 |
| 16 | L10, L11 | any poll trigger | same | `poll()` returns at once, `wake()` sets no timer | :228, :277 |
| 17 | L7-L9 | room poll answer after the room changed | current | nothing written, no `sync:status`, loop polls again | :243, :266, :228 |
| 18 | any with `probe` | `offline` window event | L4 or L9 | `failing = true`, `changed()` | :282 |
| 19 | L3 (or any) | Create tapped | L5 | `POST /rooms`. A second tap gets the same promise | :358, :371-372 |
| 20 | L5 | create 200 | L8 | store `room, cursor 0, serverOk, gmKey, lastRoom: null`, `ringKeep`. Reset A plus `probe = true`, `peeked[code] = exists`. `changed()`, `poll()`. Push variables other than `lastPushed`, `locked` untouched | :373-374, :358 |
| 21 | L5 | create error or 426 | previous | promise rejects. No `changed()`, no `poll()`, `failing` untouched. Callers show their own error | :358, :375 |
| 22 | L3, L4, L8, L9 | Join (Room view, onboarding) | L6 | `parseInvite`; `check()` (`GET /rooms/CODE?peek=1`, cached 30 s) | :544-547, :528-542 |
| 23 | L6 | check not reached | previous | throws kind `net`. If no room and not failing, `failing = true` and emit | :536, :548 |
| 24 | L6 | check says no room | L3 | `goneIf(code)` marks `lastRoom.gone` when it was that code, throws `notfound`. Save untouched otherwise | :549, :80 |
| 25 | L6 | check ok, room exists | L6 | may create a hunter from the typed name, then `join(code, hid, strict)` | :550-552 |
| 26 | L6 | `join` with a key in `gmKeys` | L6 | `rejoinGM` (row 31). 403 drops the ring entry and goes on as a player (finding 4). Any other error is rethrown | :379-387 |
| 27 | L6 | `headCursor` pages, kicked check passes | L8 | store `gmKey: null, room, cursor: head, serverOk, joinedAt, lastRoom: null`, active and bound hunter, drop that hunter from `forgetQueue`. Reset A, clear push timer, `pushFails 0`, `failKind null`, `rejected ''`, `schedulePush(200)`. Then `pendingRoom = null`, `changed()`, `poll()` | :388-396, :552 |
| 28 | L6 | strict join, bound key kicked < 10 min ago | previous | throws `removed`. Undo the made hunter | :389, :554, :556 |
| 29 | L6 | join 404 | L3 | undo made hunter, delete `peeked[code]`, `goneIf`, throw `notfound` | :555 |
| 30 | L6 | join other error | previous | undo made hunter, throw `net`. `failing` not set (finding 5) | :556 |
| 31 | L3 (GM tab) | Open as GM with key | L6 | `check()` first. Not found: `goneIf`, throw 404. Then `headCursor` with the key | :584-586, :509 |
| 32 | L6 | `r.gm` true | L8 | store `room, cursor, serverOk, gmKey, lastRoom: null`, `ringKeep`. Reset A. `changed()`, `poll()`. `joinedAt` not written, push untouched | :511-512, :586 |
| 33 | L6 | `r.gm` false | previous | throws 403 `bad key`. Ring entry kept when called from the GM tab | :510, :586 |
| 34 | L6 | rejoin 404 | L3 | delete `peeked[code]`, `goneIf`, rethrow | :586 |
| 35 | L7-L9 | Leave | L3 or L4 | store `room: null, cursor: 0, lastRoom: {code}`. `locked = false`, `drop()`, `changed()`. Push timer, `pushFails`, `lastPushed`, `gmKey` and `failing` stay. A stale `failing` shows Unreachable at once | :560-564 |
| 36 | L3 | Forget last room | L3 | store `lastRoom: null`, `changed()` | :79 |
| 37 | L9, L4 | Try now | after poll | `poll()`. Then, if not failing and a player with `pushFails`, clear backoff and `schedulePush(200)` | :565-568 |
| 38 | L8, L9 (player) | push 403 other than not your sheet | M2 then L3 | `removed()` (row 39) | :307 |
| 39 | L8, L9 (player) | `removed(hids)` | L3 | store `room: null, cursor: 0, lastRoom: null`, `drop()`, `changed()`, REMOVED FROM ROOM window. `locked`, push timer untouched | :437-443 |
| 40 | M2 | "Rejoin when the GM allows" | L6 | `GET /rooms/CODE?after=999999999` (no key). Kicked < 10 min: toast, window again. Else `join(code, hid)` non-strict, `changed()`, `poll()`, toast. Any error, 404 included: "Could not reach the server" toast, window again | :447-455 |
| 41 | any | send or putDoc result for the current room | L8/L9 or L3/L4 | `send` ok clears `failing`, error sets it. `putDoc` the same. Only `renderPill()`, no `sync:status` | :335-336, :353-354 |

Membership side paths that do not move the link: push 403 not your sheet sets M3 (push table row 13). `switchTo` "Play as" rebinds and pushes (push table row 22).

## 3. The push as it behaves today

The push only runs for a player in a room (`schedulePush` :319 and `pushSheet` :296 both check `room()`, `isGM()`, and `probe` or `serverOk`).

### Situations

| # | Situation | Variables |
|---|---|---|
| P1 | Not eligible | no room, GM, `!probe`, `!serverOk` or `upgrading` |
| P2 | Idle, in sync | no timer, not pushing, body equals `lastPushed` |
| P3 | Dirty, debounce timer set | `pushTimer` set, `pushFails` 0 |
| P4 | Dirty, nothing scheduled | body differs from `lastPushed`, no timer. Happens after `pushSheet` returned on `!serverOk` (:296), or after a quiet poll |
| P5 | In flight | `pushing` true |
| P6 | In flight, newer change waiting | `pushing`, `pushAgain` |
| P7 | Backing off, no HTTP answer | `pushFails > 0`, `failKind 'net'`, `pushTimer` |
| P8 | Backing off, server answered with an error | `pushFails > 0`, `failKind 'server'`, `pushTimer` |
| P9 | Rejected for good (400, 413 too large, 413 room full) | `rejected` = that body |
| P10 | Locked (403 not your sheet) | `rejected` = body, `locked`, an untracked 30 s timer |

Removed (403) leaves the push and moves the link (row 38 above). Upgrade (426) stops the push for the tab.

### Transitions

| # | From | Event | To | Effects | Where |
|---|---|---|---|---|---|
| 1 | P2, P4, P9, P10 | app `change` | P3 | `pushTimer = setTimeout(pushSheet, 3000)`. Not a debounce. Later changes inside the 3 s ride along | :328, :319 |
| 2 | P3, P7, P8 | app `change` | same | nothing, a timer exists | :319 |
| 3 | P5 | app `change` | P6 | `pushAgain = true` | :319 |
| 4 | P1 | app `change` | P1 | nothing | :319 |
| 5 | P3, P7, P8 | timer fires, `!serverOk` or not eligible | P4 or P1 | nothing scheduled. Waits for `resumePush` | :293-296 |
| 6 | P3, P7, P8 | timer fires, body equals `lastPushed` or `rejected` | P2, P9 or P10 | nothing | :298 |
| 7 | P3, P7, P8 | timer fires, new body | P5 | `PUT /rooms/CODE/sheets/<deviceId>:<hid>` with `X-Device-Token` | :299, :302 |
| 8 | any | timer fires while `pushing` | P6 | `pushAgain = true` | :295 |
| 9 | P5, P6 | 200 | P2, or P3 when `pushAgain` | `lastPushed`, `failing = false`, `pushFails 0`, `failKind null`, `rejected ''`, `locked false`. `pushAgain` schedules at 3 s. `renderPill()` only, no `sync:status` | :302, :315-317 |
| 10 | P5, P6 | any answer after the room changed | P1 or P3 | `pushing = false`. `pushAgain` schedules at 200 ms. Nothing else | :301-304 |
| 11 | P5, P6 | 426 | P1 (dead) | `pushing`, `pushAgain` false. `upgrading` set in `call()` | :305, :61-64 |
| 12 | P5, P6 | 403 removed (server.ts:262) or any other 403 | link M2 | `pushing`, `pushAgain` false, `removed([h.id])` | :307 |
| 13 | P5, P6 | 403 `not your sheet` (server.ts:269) | P10 | `rejected = body`, `locked = true`, window once per tab, emit `sync:status`. After 30 s: `rejected = ''`, `schedulePush(200)` | :306, :427-430 |
| 14 | P5, P6 | 400 or 413 | P9 | `failing = true` (link shows reconnecting until the next good poll), `rejected = body`, `pushFails 0`. The newer change in `pushAgain` is dropped until the next change | :308-309 |
| 15 | P5, P6 | 5xx or 404 or other status | P8 | `failing = true`, `pushAgain = false`, timer `min(60, 3 * 2^pushFails)` s, `pushFails++` | :308, :310-312 |
| 16 | P5, P6 | network error, timeout, offline | P7 | as row 15, plus `poll(true)` | :310-313 |
| 17 | P4, P7 | non-quiet poll 200, body unsent, `failKind` net | P3 | clear timer, `pushFails 0`, schedule at 400 ms | :263, :321-326 |
| 18 | P8 | non-quiet poll 200 | P8 | nothing. Server backoff is kept | :324 |
| 19 | P4 | non-quiet poll 200, `pushFails` 0 | P3 | schedule at 400 ms | :326 |
| 20 | P7, P8 | Try now, poll ok | P3 | clear timer, `pushFails 0`, schedule at 200 ms | :567 |
| 21 | any | join (player) | P3 | clear timer, reset `pushFails`, `failKind`, `rejected`, `lastPushed`, `locked`. Schedule at 200 ms. `pushing`, `pushAgain` not reset | :396 |
| 22 | any | `switchTo` "Play as" | P3 | store bound and active hunter, `joinedAt`. Clear timer, `lastPushed ''`, `locked false`. Tombstone the old hunter (or queue it). Schedule at 200 ms. `pushFails`, `failKind`, `rejected` kept | :497-501 |
| 23 | any | create or rejoinGM | P1 | `lastPushed ''`, `locked false`. Timer untouched (fires and returns on `isGM()`) | :374, :512 |
| 24 | any | leave, poll 404, removed | P1 | nothing in the push. Timer fires later and returns at :296 | :269, :440, :562 |
| 25 | any | 426 on any request | P1 (dead) | `clearTimeout(pushTimer)` | :62 |
| 26 | P10 | 30 s timer, after leave or a join elsewhere | P3 or P1 | clears `rejected` even when it now holds a 400/413 body | :306 |
| 27 | P5 | quiet poll joins a running non-quiet poll, or the reverse | n/a | `poll()` returns the shared `pollP` and ignores the `quiet` argument of the second caller | :228 |

### How push and link affect each other

- Push writes the link's `failing` at :302 (clear) and :308 (set). A 5xx or 413 on the PUT shows "reconnecting" while polls succeed. Neither write emits `sync:status`, so views that listen for it (room.js :254 also listens to `change`) may lag.
- A push network error starts a quiet poll (:313). A good non-quiet poll calls `resumePush` (:263).
- The push needs `serverOk` (:296), the link's "a server answered once" bit.
- A push 403 ends the room membership through `removed()` (:307). A push 404 does not. It backs off and the next poll reports the room gone.
- `send()` and `putDoc()` also write `failing` (:335-336, :353-354), so a GM's failed event send shows reconnecting.

## 4. Timers and numbers

| Name or literal | Where | Value | For |
|---|---|---|---|
| `POLL_MS` | :3 | 5000 | poll interval |
| `POLL_FAST_MS` | :3 | 3000 | poll interval while `_encounter` doc is active (:274) |
| `PUSH_MS` | :3 | 3000 | delay from a change to the PUT |
| `RING` | :3 | 200 | hp/status event ids remembered per tab |
| `DOC_MAX` | :3 | 16384 | client cap on a doc body (server.ts:175 same) |
| `REQ_MS` | :4 | 20000 | abort for every request, any method, any size |
| page size | :246, :366 | 200 | literal, must match server `PAGE` (server.ts:21) |
| `KEYS_MAX` | :15 | 10 | GM key ring size |
| token | :41 | 24 bytes, 32 chars, min 16 | device token |
| push backoff | :311 | `min(60, 3 * 2^n)` s: 3, 6, 12, 24, 48, 60, 60 | server or network PUT failure |
| `schedulePush(200)` | :301, :396, :501, :567 | 200 ms | push soon after join, rebind, Try now, stale reply |
| locked retry | :306 | 30000 | try the PUT again after not your sheet |
| `resumePush` | :326 | 400 ms (or 3000, which is moot because `schedulePush` returns when a timer exists) | push after a good poll |
| kick window | :366, :407, :424, :452, :462 | 600000 (10 min) | client reading of `_kicked` |
| `peeked` | :531 | 30000 | `check()` answer cache, positive and negative |
| forget queue | :469 | 20 | tombstones kept |
| online flush | :487 | 500 ms | tombstone retry after `online` |
| presence | :579 | 15000 | roster online or away |
| copy label | :625 | 1800 | button text reset |
| `WORKER_WAIT_MS` | src/edge/upgrade.ts | 4000 | wait for a new service worker before reload |
| `KICK_MS` | server.ts:159 | 20000 | server refuses a removed sheet's PUT (403 removed) |
| `TTL` | server.ts:21 | 30 days | room expiry, renewed by every touch, peek included |
| `MEM_EVENTS`, `ROOM_SHEETS`, `SHEET_MAX`, `MAX_BODY` | server.ts:21, :175 | 2000, 24, 32768, 64 KB | 413 sources |
| room.js tick | src/views/room.js:145 | 1000 | "Last sync" text |

Waits that can add up to about 45 to 55 s on a join or first poll. None is a single fixed delay of that size.

- `REQ_MS` twice. One poll hangs to the 20 s abort, `pollP` blocks every other poll trigger meanwhile (:228), the next tick hangs again: 40 s, then a normal poll and push of about 8 s gives 48 s. A join itself fails rather than succeeding late when its peek or `headCursor` times out.
- Push backoff: 3 + 6 + 12 + 24 = 45 s before the fifth try, and the fifth step alone is 48 s. Only for server errors, since a good poll cuts a network backoff short (:325).
- Locked retry 30 s plus one 20 s abort is 50 s.
- `headCursor` (:362-368) pages without a cap. A room with 2000 events is 10 sequential GETs, each with its own 20 s limit.

`docs/agent-handoff/p3/stall-investigation.md` found both renderers, the test driver and the server stopped for 512 s at the same instant, and a shell heartbeat recorded box pauses of 179 to 1071 s. Its conclusion is that bug 2 is the box pausing. The 52 to 54 s joins in `bugs-found.md` were not instrumented, so the timers above are not ruled out by evidence, only by that conclusion.

## 5. Late replies

| Reply | Check before applying | Compares | Stale reply accepted when |
|---|---|---|---|
| health (`pollOnce`) | :235, :266 | `room()` before and after | never matters (no room data) |
| room GET (`pollOnce`) | :243, :266 | room code | leave then rejoin the same code during one request (up to 20 s). The old reply's `after` was the old cursor. Join set the cursor to the head, the reply writes `cursor: top` (:249), which can be lower, and applies events join meant to skip. A late 404 evicts the new membership. Events inside one page are applied with no check, but only microtasks run between them (`applyEvent` awaits nothing real), so a user action cannot interleave |
| sheet PUT (`pushSheet`) | :301, :304 | room code | leave then rejoin the same code. A late 403 calls `removed()` on the new membership, a late not your sheet sets `locked`, a late 200 sets `lastPushed` |
| `send` | :335-336 | room code, only for `failing` | returns true or false either way |
| `putDoc` | :351, :354 | room code | same code rejoin merges a doc written before the leave (harmless) |
| `kickSheet` | :405 | room code after DELETE, not after `putDoc` | `delete remote[key]` and `sync:sheets` after `putDoc` (:410) run with no check |
| `allowBack` | :417 | room code | same code rejoin |
| `releaseSheet` | none | nothing | writes no local state |
| `check` | none | nothing. Toggles `failing` only when out of a room (:536, :540) | room.js drops an answer whose code no longer matches the field (room.js:269, :286) |
| `create` | none | nothing | a create that resolves after a join or leave overwrites the room |
| `join`, `headCursor` | none | nothing | a leave or create during `headCursor` is overwritten when the join writes. Two joins at once: last write wins. room.js guards with `S.busy` |
| `rejoinGM` | none | nothing | same as join |
| `showRemoved` rejoin | none | nothing | same as join |
| `flushForgets` | captured code | queue entries carry their room | none found |
| locked 30 s timer | none | nothing | clears `rejected` and schedules in whatever state the tab is in |
| any reply after a 426 | :60 | `upgrading` | none, all refused |

No reply is checked against a counter. Every check is a room-code compare or nothing.

## 6. The 14 deferred findings

Source: `docs/agent-handoff/lead-report.md` section 9.

| # | Finding | State or transition | A reducer test would assert |
|---|---|---|---|
| 1 | The peek renews the room's 30-day expiry (server.ts:211 calls `st.touch`) | server, link row 22 | outside the reducer. A server test asserts a peek leaves `touched` unchanged |
| 2 | Pill alternates Offline and Join every 5 s when peeks fail with 5xx and health answers | `failing` set by `check` (:536), cleared by health (:237). L3 and L4 | a peek answered 5xx while out of a room does not move the link to unreachable, and the re-check is driven by an event, not by "state is ready" |
| 3 | Any 404 on the room GET evicts and saves `lastRoom.gone` | link row 11, also rows 29, 34 | a 404 without `reason: 'no such room'` keeps the room and counts as a failure. Only that reason leads to gone |
| 4 | A GM key refused with 403 becomes a quiet player join | link row 26 | a refused key yields its own outcome (key invalid) and never a player join in the same transition |
| 5 | A failed join out of a room leaves "Could not reach the server" on screen with conn `ready` | link row 30, `failing` not set | a failed join while out of a room ends in the same state as a failed health poll, and the next good health clears it |
| 6 | One 20 s limit for every request | `REQ_MS` :4 | the request-timeout effect carries a limit per request kind, and a timeout on a body-carrying request keeps the push in backoff, not restart from zero |
| 7 | Invite re-check on reconnect only tested out of a room | room.js:278, :286, link L9 to L8 | the reconnect transition from reconnecting to live emits the same "back" effect as unreachable to ready |
| 8 | Switching rooms forgets the previous room | rows 20, 27, 32 write `lastRoom: null` | joining B while in A records A as the last room |
| 9 | A player who leaves stays on the GM board as away | row 35 sends no tombstone | design choice. A test pins that leave emits no tombstone request, or the new "left" mark if added |
| 10 | `parseInvite` turns "thanks buddy" into `THANKS` | pure function :519 | outside the machines. A unit test on the parser |
| 11 | `check()` caches "no such room" 30 s | `peeked` :531 | rejected as a bug. A test pins that a cached answer is reused within 30 s |
| 12 | A pending invite survives skipping onboarding | `pend` :594 | outside the machines |
| 13 | Mixed old and new clients went silent for minutes | likely box pauses | outside the reducer. The 426 handshake now refuses old clients. A test asserts a 426 moves the link to upgrading from every state |
| 14 | The Postgres store never ran | server.ts:75-132 | outside the reducer |

## 7. What the rest of the app calls

`app.api.sync` is assembled at :358, :506, :582-587 and :627. Callers found by grep in `src/views` and `src/app.js`.

| Function | Callers | What it does |
|---|---|---|
| `status()` | onboard.js:157, gm.js:219 | off, offline or connected |
| `conn()` | room.js, onboard.js, gm.js | off, ready, unreachable, connecting, live or reconnecting |
| `room()` | quests, custom, room, onboard, combat, bestiary, gates, inventory, table, io | current code or null |
| `isGM()` | quests, custom, combat, gates | `roleOf` of the settings (also `app.isGM`, app.js:48) |
| `detail()` | room.js:145, :335 | conn, room, gm, `lastOk`, online, unsent, locked |
| `send(type, payload)` | quests, combat, gates, inventory, table | POST an event with the GM key. Returns true or false |
| `remoteSheets()` | quests, combat, gates | sheets with device, hunter and presence, tombstones dropped |
| `myKey(hid)` | quests, custom, combat, inventory, table | `<deviceId>:<hid>` |
| `doc(name)`, `putDoc(name, data)` | custom, bestiary, gates, table | read or write a room doc (GM writes) |
| `inviteLink()`, `copyInvite()` | room.js (`inviteLink`). `copyInvite` has no caller | link with `?room=CODE`, share or copy it |
| `create()` | room.js, onboard.js:232 | make a room, then `changed()` and `poll()` |
| `parseInvite`, `check`, `joinRoom` | room.js, onboard.js | parse a code, peek, join |
| `rejoinGM(code, key)` | room.js | reopen a room as GM |
| `join(code, hid)` | none in src | non-strict join |
| `joinDialog(code)` | tests/e2e/room-view.e2e.ts:186 only | set `pendingRoom`, go to the Room view |
| `presenceInfo()` | none | presence ok and skew |
| `leave`, `retry`, `forgetLast`, `lastRoom` | room.js. `lastRoom` also gm.js:223 | as in section 2 |
| `roster()` | room.js, gm.js:227 | GM list of sheets with online, away or unknown |
| `gmRooms()` | gm.js:223 | codes in the key ring, newest first |
| `kick`, `allowBack`, `recentKicks`, `release` | room.js | GM removal, lifting it, the list, releasing a device binding |
| `forget(hid)` | hunter.js:193 | tombstone a deleted hunter, queue on failure |
| `switchTo(hid)` | room.js, hunter.js:664, app.js:198 | change active hunter, ask whether it takes the room slot |
| `bound()` | room.js | the hunter this phone pushes |

Also set by sync.js: `app.build` (:47) and the `app.pendingRoom` accessor (:596).

Events emitted and their listeners:

| Event | Emitted at | Listeners |
|---|---|---|
| `sync:status` `{status, room, conn}` | :75 (every `emitStatus`) | custom.js:367, combat.js:490, gates.js:214, gm.js:731, room.js:254, sync.js:647 |
| `sync:sheets` `{sheets}` | :259, :410 | quests.js:544, combat.js:493, gm.js:732, room.js:254 |
| `sync:docs` `{docs}` | :260, :353 | custom.js:368, bestiary.js:176, gates.js:215, table.js:156, table.js:245, room.js:254 |
| `sync:event` `{event}` | :253 | quests.js:220, table.js:274 |

sync.js listens to app `change` (:328), `sync:status` (:647), and window `visibilitychange` (:280), `online` (:281, :487), `offline` (:282), `pageshow` (:283), and document `click` on the pill (:592).

## 8. Open questions

1. `serverOk` is never set to false (:21, writes at :237, :244, :374, :396, :512). So `connecting` (:74) only appears at boot. Was a failure meant to reset it?
2. Two classifications of the link, `status()` (:72) and `conn()` (:74). With no room and no health answer yet, `status()` says offline and `conn()` says ready. onboard.js:157 and gm.js:219 use `status()`. Which one is the truth?
3. `probe` (:36) never turns false. A static-host tab whose save has `serverOk: true` probes `/api/health` forever. Is a page served from the service worker tagged with `hunter-api` in `serverTiming`? I could not tell.
4. :308 sets `failing = true` before the 400/413 branch at :309. A permanent rejection then shows reconnecting until the next poll. Intended?
5. :326 `schedulePush(pushTimer ? PUSH_MS : 400)`. When `pushTimer` is set, `schedulePush` returns at :319 and the `PUSH_MS` argument is never used.
6. :306 the 30 s timer after not your sheet is not stored, so leave, join and switch cannot cancel it, and it clears `rejected` whatever it holds.
7. `ownerWarned` (:426) is never reset. A second lock in another room in the same tab shows no window, only the Room view line.
8. Poll 404 (:269) and `removed` (:440) leave `gmKey` in the save. Harmless while `room` is null, since `roleOf` ignores it, but I could not tell whether that is deliberate.
9. `leave` (:560-564) does not reset `failing`. A leave during reconnecting lands in `unreachable` until the next health poll.
10. `poll(quiet)` (:228) returns a shared promise and drops the second caller's `quiet` value.
11. `create` (:373-374) does not clear `pushTimer`, `pushFails`, `failKind` or `rejected`. Harmless because a GM never pushes, but a later player join resets them anyway (:396).
12. `showRemoved` rejoin (:454) reports "Could not reach the server" for every error, a 404 included.
13. The room GET never answers 403 (server.ts:213-229) and a wrong GM key on the poll just returns `gm: false` (server.ts:222). A GM whose key stopped working keeps `isGM()` true and is never told. The brief's "poll 403" event has no source today.
14. Push 404 (room gone) is treated as a server error with backoff (:310), not as gone. Only the next poll notices.
