# Notes: the link and push machines (M6, unit A)

Worktree branch `worktree-agent-a355e3af141b7e2d0`, started at 712b707 (reset from 8b41075 as the prompt said).

## Step 1: the inventory mapped onto the model

### The two machines as written

Link (`src/core/sync/link.ts`), a union on `at`. Every state but `off` and `upgrading` holds `gen`:

- `off`
- `idle { server: 'unknown' | 'ok' | { unreachable: n }, last, next: 'timer' | 'polling' }`
- `creating { back }`, `joining { code, key, step: 'peek' | 'head', back }`. `back` is the state to return to when the attempt fails (`off`, `idle` or `live`).
- `live { code, as: 'gm' | 'player', cursor, health: 'connecting' | 'ok' | { failed: n }, last, next: 'timer' | 'polling' }`
- `upgrading { stuck }`

Push (`src/core/sync/push.ts`): `off`, `clean`, `waiting`, `sending { changedSince, fails }`, `backoff { fails, kind }`, `rejected { why }`, `locked { retrying }`. Every state but `off` holds the link `gen` it was started with.

### Situations

| Inventory | Model |
|---|---|
| L1 off | link `off` |
| L2 probing, no room | `idle { server: 'unknown' }` |
| L3 idle | `idle { server: 'ok' }`, `last` is the stored last room |
| L4 unreachable | `idle { server: { unreachable: n } }` |
| L5 creating | `creating` |
| L6 joining (had no flag) | `joining { step: 'peek' }` then `{ step: 'head' }` |
| L7 connecting | `live { health: 'connecting' }` (extension, below) |
| L8 live | `live { health: 'ok' }` |
| L9 reconnecting | `live { health: { failed: n } }`, now with the 5/10/20/30 s wait |
| L10 upgrade, reload pending | `upgrading { stuck: false }` |
| L11 upgrade stuck | `upgrading { stuck: true }` |
| M1 room gone | `idle { last: { code, why: 'gone' } }` plus `notify gone` |
| M2 removed by the GM | `idle { last: { code, why: 'removed' } }` plus `notify removed` |
| M3 locked out of our sheet | link `live`, push `locked` |
| P1 not eligible | push `off` |
| P2 idle, in sync | `clean` |
| P3 dirty, timer set | `waiting` |
| P4 dirty, nothing scheduled | not representable. A changed sheet in a live room is always `waiting`, `sending` or `backoff` (the model check asserts it) |
| P5 / P6 in flight | `sending { changedSince: false / true }` |
| P7 / P8 backing off | `backoff { kind: 'net' / 'server' }` |
| P9 rejected for good | `rejected { why }` |
| P10 locked | `locked`, its 30 s retry is the push's own timer |

### Link transitions (inventory section 2) as events

| Rows | Event |
|---|---|
| 1-3 | `boot(input)` (a function, not an event): `off`, `idle` polling health, or `live { connecting }` polling the room |
| 4, 8 | `timerFired { name: 'poll' }`: one request, `health` when idle, `poll` when live |
| 5, 6 | `healthOk { gen }`, `failed { gen, kind }` |
| 7, 17 | any reply with a stale `gen`: nothing |
| 9 | `polled { gen, cursor, more, fast }`: effect `apply` tells the edge to carry out the page |
| 10, 38, 39 | `removed { gen }`, raised by the edge from the `_kicked` check or a push 403 removed |
| 11 | `gone { gen }`, raised only for a 404 with `error: 'no such room'` (finding 3) |
| 12, 13 | `failed { gen, kind: 'net' | 'timeout' | 'server' }` |
| 14-16 | `upgrade { stuck }` from every state, no `gen` (a fact about the server, not about a room) |
| 18 | `offline` |
| 19-21 | `create`, `created { gen, code, key }`, `failed` |
| 22-30 | `join { code, key: null }`, `peeked { gen, exists }`, `headed { gen, cursor, gm, kicked }`, `failed`, `gone` |
| 26, 31-34 | `join { code, key }` (the edge looks the key up in the ring). `headed { gm: false }` is its own outcome, `keyRefused` (finding 4) |
| 35 | `leave` |
| 36 | `forget` |
| 37 | `retry` (Try now); `online` and `visible` do the same |
| 40 | "Rejoin when the GM allows" is `join { code, key: null }`: the head reply says `kicked`, which answers `notify notAllowedBack` |
| 41 | gone: `send` and `putDoc` no longer write the link (they are not link requests). A failed GM send is the caller's to show |

### Push transitions (inventory section 3) as events

| Rows | Event |
|---|---|
| 1-4 | `changed` (the edge raises it when the bound sheet's text differs from the last it reported) |
| 5-8 | `timerFired { name: 'push' }` |
| 9-16 | `sent { gen }`, `failed { gen, kind }`, `refused { gen, why: 'too-large' | 'room-full' | 'bad' }`, `notYours { gen }`. 403 removed and 426 go to the link, which then tells the push `linkLost` |
| 17-20 | `pollOk { gen }` (forwarded by the link), `retry` |
| 21 | `linkLive { gen }` |
| 22 | `rebound` ("Play as") |
| 23-25 | `linkLost` |
| 26, 27 | gone: the locked retry is the push's one timer, and there is no shared poll promise |

### What does not fit, and the smallest extension chosen

1. Connecting (L7) is something a player sees at boot with a remembered room. `health: 'ok' | { failed }` cannot say "no answer yet", so `health` has a third value `'connecting'`.
2. The idle health poll needs the same backoff as the room poll (the brief's reason for the wait applies out of a room too), so `idle.server` carries the count: `{ unreachable: n }` rather than a bare `'unreachable'`.
3. `idle` and `live` carry `next: 'timer' | 'polling'`: without it the reducer cannot keep "at most one poll" (Try now during a poll) and the no-dead-end rule is not visible in the state.
4. A failed join or create returns to where it started, which can be a live room (join B from A). `creating` and `joining` carry `back`.
5. Applying a poll page is room data, not link state, but only a current reply may be applied. The reducer answers an `apply` effect for a current `polled` or `headed`, so the edge never compares gens itself. Also an `abort { gen }` effect when the gen changes, so the edge can drop the old room's requests, and a `push` effect that carries `linkLive`, `linkLost`, `pollOk` and `retry` to the push.
6. A sheet PUT that times out is not a dead network: a good small poll would cut it short and the next PUT would time out again forever (finding 6). Push failure kinds are `'net' | 'timeout' | 'server'`; only `net` is cut short by a good poll.
7. Page visibility: a poll timer that comes due while the page is hidden fires when the page shows (the edge's timer contract). `visible` then polls at once. No visibility flag in the machine.
8. "Try now, online and visible reset the wait": read as "cut the current wait short and poll now". The failure count stays, so a phone that is still offline keeps backing off.

### What a player or GM will see differently (each a choice, for the lead to accept or undo)

- A failed poll waits 5, 10, 20, then 30 s (the brief). Out of a room the health poll waits the same way.
- A GM key the server refuses ends the join with "key refused" and drops that ring entry. It no longer turns into a player join (finding 4).
- A sheet the server refused (400, 413) reads as "not sent", not "reconnecting". A failed `send` or `putDoc` no longer flips the pill.
- While locked, an edit no longer sends at once: the 30 s retry sends the latest sheet. The locked window opens once per lock, not once per tab.
- A push network error no longer starts a poll of its own; its first retry is 3 s away anyway.
- A peek answered with a server error out of a room leaves the pill as it was (finding 2). A join that cannot reach the server out of a room shows Offline, as a failed health poll does (finding 5).

### Principles that changed a choice

- `principle-model-the-domain`: P4 (dirty, nothing scheduled) is gone as a state rather than guarded.
- `principle-type-system-discipline`: `Gen` and `GmKey` are branded; the link's requests and the push's requests are separate unions.
- `principle-make-operations-idempotent`: a second tap on Create or Join, and a reply delivered twice, change nothing (tests pin both).
- `principle-separate-before-serializing-shared-state`: the shared `failing` bit is split: the link owns `health`, the push owns its own failure, and `connection()` merges them only at the read.

## Log
- step 1: mapping written (this file). Commit 7ee8e09.
- step 2: `src/core/sync/link.ts` and `tests/link.test.ts` (30 tests). Commit 1edc3e4. The stored `serverOk` hint and `joinedAt` stay with the edge: the first is "a server answered once", written on any answer; the second goes with the save that sets `room` with `gmKey: null`.
- step 3: `src/core/sync/push.ts`, `src/core/sync/connection.ts` (the pill selector, a third file so neither machine reads the other) and `tests/push.test.ts` (19 tests). Commit ca2fe1b. `connection()` adds `notSent`, `locked`, `creating`, `joining` and `upgrading` to today's six values; unit B maps them to the pill.
- step 4: `tests/link-findings.test.ts`, one test each for findings 2, 3, 4, 5, 6, 7, 8, 9, 13. Commit f2ef0ef. Not here, and why:
  - 1 (peek renews the 30-day expiry): `server.ts` calls `touch`. A server test, not a reducer one.
  - 10 (`parseInvite` reads "thanks buddy" as THANKS): a pure parser in the edge, not a state.
  - 11 (the 30 s peek cache): the Room view's live code check uses it as a lookup; it is not link state. Unit B keeps it in the edge (or moves it to a pure helper) and pins the reuse there.
  - 12 (a pending invite survives skipping onboarding): `app.pendingRoom`, onboarding state.
  - 14 (the Postgres store never ran): server storage.
  - 8 is only half fixed: the link records A while in B, but there is one last-room slot, so after leaving B the Room view offers B. Offering A then needs a list, which the brief's `last` is not.
- step 5: `tests/sync-model.test.ts`. Commit 60abd9d. Breadth-first from four boots (no server; server, no room; remembered room as player; remembered room as GM with a last room). Alphabet: 14 taps (create, join A as player, join A with a key, join B, leave, forget, Try now, online, offline, visible, upgrade, upgrade stuck, a sheet change, Play as), each timer that is set, and every kind of answer to each request that is out (35 kinds, plus "a poll page that says removed"). Every reply kind is also probed with a stale gen at every state. States that act the same share a key: gens relative to the link's, failure counts capped where the wait stops growing (4 polls, 6 sends). Result: 12,104 states, 248,636 transitions, closed at depth 30 with nothing left, about 2.6 s. The depth bound (60) is a guard; the test fails if the search ever stops on it.
  - Rules checked at every state: a stale reply changes neither machine and asks for nothing; no request of an earlier gen is out (stronger than "after leave"); at most one link request and one sheet send out; idle and live have their poll timer or poll out, creating and joining a request out, no other state a poll timer; push waiting, backoff and locked have a timer of at most 60 s, sending has its send out, no other push state a timer; the push runs exactly while the link is live as a player, on the link's gen; after Leave from a room the push is off with no timer and nothing is out; upgrading is never left.
  - Found: one. My first model raised "removed" from a poll instead of the poll answer. For a GM the link ignores `removed`, so it waited for a poll it had already been answered: a dead end. The machine is right and the model was wrong, but it is a real contract for unit B: a poll answer is always `polled`, `failed` or `gone`, and `removed` comes after it, never instead. Kept as the named test "a GM whose poll page names a removed sheet keeps polling the room".
- step 6: mutations, each applied by a script, `bun test` run, then restored (the script restores the file text; nothing committed broken):
  1. Remove the stale-gen check in the link's `step`: 2 tests fail (the model check, and "a poll answer from before a Leave and a rejoin of the same room changes nothing").
  2. Remove the push backoff's 60 s cap (`3000 * 2 ** (fails - 1)`): 2 fail (the model check, "... tried again after 3, 6, 12, 24, 48, then 60 s").
  3. Drop the `abort` effect when the link leaves a state: 2 fail (the model check, "Leave puts the player out of the room ...").

## For unit B

- The edge contract the model assumes: one reply per request (`failed { kind: 'timeout' }` when its `timeoutMs` passes); `abort { gen }` drops every request of that gen, the push's included; one timer per name, `setTimer` replaces it, a cleared timer never fires; a poll timer that comes due while the page is hidden fires when it shows; each `push` effect of the link goes to `push.reduce` at once.
- A 404 is `gone` only with `error: 'no such room'`. A 403 removed on a send and a `_kicked` doc naming the bound sheet are both `removed` for the link (after the poll answer). A 426 from any request is `upgrade { stuck: decideUpgrade(...) === 'stuck' }`.
- `apply` means "carry out the reply just given": the poll page's events, sheets and docs, or the head's server time. Nothing else applies room data.
- Not modelled, still edge: the 30 s peek cache for the Room view's code check, the forget queue, `seen`, presence, and the hunter a join makes from a typed name (undo it when the link leaves `joining` for anything but `live`).
- Open question 13 stays open: a GM whose key stopped working gets `gm: false` on the poll and is never told. The machine could take a `keyLost` reply; nothing raises it today.

Done. `bun run test`: 594 pass, 0 fail across 17 files.

# Unit B: the sync edge runs on the machines

Branch `claude/zen-pasteur-ov4cgd`, started at 2c5b930.

## Log
- step 0 (pin), before any app change: 31 passed, 0 failed. room-sync 1, room-sync-fixes 9, room-view 8, room-onboarding 6, table-session 4, upgrade 3 (5.9 min).
- step 1a: `keyLost { gen }` on the link (tests first: three in `tests/link.test.ts`, and the model check sends it after a poll answer like `removed`). A GM is sent to idle with `last: left`, the ring entry is dropped, notice `keyLost`. A player ignores it. Commit caef31a.
- step 1b: `src/core/sync/invite.ts` (`parseInvite`, `codeOf`, `CODE_RE`) with `tests/invite.test.ts`. Finding 10 fixed: in a text of more than one word only a word written like a code (capitals or a digit) counts; one word alone is read in any case. Commit 8b13fea.
- step 1c: server peek uses a new `Store.exists` (no touch). `tests/server-rooms.test.ts` "a room nobody polls for 30 days is gone, even when someone checked its code meanwhile" fails on the old `touch` (checked by hand, then restored). Commit 8ab5249.
- step 2 (the edge): `src/edge/sync.js` deleted, `src/edge/sync.ts` (strict) in its place. Commit 3229238. `room-sync` 1/1, `room-onboarding` 6/6, `room-sync-fixes` 9/9 on it. Details:
  - Whole file moved to TypeScript; no split was needed. The state it owns is named at its top: `link`, `push`, and the edge's own `attempt` (the Create or Join tap whose promise answers the view), `shown` (room data of the last applied poll, tagged with its link gen), `srvSkew`, `lastOk`, `sheetText` (the sheet as last sent, to tell a sheet change from any change), `flushing` (forget queue), `running` (effects are being carried out), `panelEl`; containers `queue`, `inflight` (AbortControllers by gen), `timers`, `peeked`.
  - Dispatch: `linkDo`/`pushDo` queue the event; `drain` reduces, stores, runs the effects. An event raised while effects run (a `removed` after a poll answer, a reply) waits its turn, so each event's effects run whole and in order. The link's `push` effects go to the push at once.
  - Deleted variables: `probe`, `serverOk` (memory), `failing`, `upgrading`, `pollP`, `timer`, `curMs`, `creating`, `roomGone`, `pushTimer`, `pushing`, `pushAgain`, `pushFails`, `failKind`, `lastPushed`, `rejected`, `locked`, `ownerWarned`, `remote`, `docs`, `presence`, `presenceOk`, `skew`. `drop()` is gone: the views read room data through `view()`, which is empty unless `shown.gen` is the live link's gen (so leave and rejoin of the same room shows nothing old).
  - `upgrade`: any 426 room answer dispatches `upgrade { stuck: false }`, then `upgradeRefused` dispatches `stuck: true` when it gives up; the link's `upgradeStuck` notice shows the stuck text.
  - Save: `LastRoom` is now `{ code, why: 'left' | 'gone' | 'removed' }`; the repair reads an older `{ code, gone }` as gone and a missing reason as left (test in `tests/save.test.ts`). `lastRoom()` hides a `removed` last room, as before (no one-tap return after a removal).
  - `RoleSettings.sync.gmKey` became optional so `roleOf(store.get().settings)` typechecks from TS.
  - Membership the machines do not own stays in the edge: the hunter a join makes from a typed name (made when the peek says the room exists, undone when the tap fails), binding the joined hunter, `switchTo` (now `rebound`), tombstones and the forget queue, kick, allow back, release, the removed window (its Rejoin is a normal join whose head answers `kicked`).
  - `forgetKey(code)` on the API: room.js no longer writes `gmKey`. Forgetting the key of the room this GM is in leaves the room (it said "You stop being GM of this room now"; the link cannot drop a key while live).
  - Accepted change pinned in the browser: `room-sync-fixes` "a player who joins ... even holding a GM key that the server does not accept" pinned finding 4's old behaviour; it is now "a GM key the server refuses ends the join with a message and does not join as a player". The gone-room test's last-room setup now reloads the page (the link reads the save at boot, not behind its back).
  - A ring drop removes the key only when it is the one refused, so a wrong typed key does not delete a good stored one.
- step 3: the pill, the Room view card and the Data panel map `notSent`, `locked`, `creating`, `joining`, `upgrading` (in the edge commit, since the pill must render every value); strings listed in `docs/agent-handoff/copy-tasks.md`. `status()` is 'off' | 'offline' | 'connected' over `connection()`. Commit of the copy list: see log.
- step 4: two lint rules in `tests/lint.test.ts`, named in AGENTS.md. Allowed `let`s: link, push, attempt, shown, srvSkew, lastOk, sheetText, flushing, running, panelEl. io.js is exempt by line: it writes the GM key into a file being imported, not into the save. Both rules fail on a planted violation (checked, restored).
- step 1b follow-up: `room-view` 'pasting ... a sentence' pastes a lower-case code in a sentence; a code with no digit (about 18% of codes) then read as a word. The server now makes every code with a digit (`newCode`, test in server-rooms), so the parser rule is exact for every code it makes.
- pin files on the new edge: table-session 4/4 first run. room-view failed 2: the paste test (a code with no digit, fixed by the digit rule above) and "a dropped link recovers", whose route answered a 404 `not found` (finding 3: only `no such room` is gone; the route now answers as the server does). upgrade failed 1: `room()` was null while upgrading; it now reports the saved room, which the reloaded app opens. After the fixes room-view 8/8, upgrade 3/3.
- step 6: AGENTS.md rows for the link, the push, the pill and the invite parser, and the recipe "To add a link state or a reply". Commit 7d3ef01.

## Where unit B stopped (for the next helper)
Steps 0 to 4 and 6 are done and committed. Step 5 is half done:
- done: "a GM key the server refuses ends the join with a message and does not join as a player" (`room-sync-fixes`).
- not written yet: "a sheet the server refuses shows as not sent while the room stays live" (idea: set a hunter text field over 32 KB as setup, so the PUT gets 413; expect the pill `data-conn="notSent"` and the Room card line "Live. The server has not taken your latest sheet.", and `room()` still the code); "a GM whose key stops working is told and leaves the room" (setup: write a wrong `gmKey` and ring entry to the save and reload; the first poll answers `gm: false`, so the toast "The GM key for room CODE no longer works. Left the room." shows and the lobby offers the room); "leave then rejoin of the same room never shows the old room's data" (a MutationObserver on the GM's roster after Rejoin: it never lists the name the player had before the GM left).
- not done: bringing the widened waits in `customization`, `room-view` (the 30 s waits at lines 230 and 239) and `room-sync-fixes` back to the 15 s default, and the runs of `customization`, `character` and `gates-quests-dailies`.
- open: the io.js "Replace campaign" import replaces the save, room fields included, behind the link; the link keeps its room until a reload. Not new, but now visible as two owners. A reboot of the link after an import would close it.

# Finish the link unit and harden the browser tests against the popup gap

Branch `claude/zen-pasteur-ov4cgd`, started at 954cb7e.

## Log
- step 1: three browser tests in `room-sync-fixes`: "a sheet the server refuses shows as not sent while the room stays live", "a GM whose key stops working is told and leaves the room", "a GM who leaves and rejoins the same room never sees the room as it was before leaving". Waits of 30 to 45 s in `customization`, `room-view` and `room-sync-fixes` are back to the 15 s default. The three files run twice (`--repeat-each=2`): 56 passed, 9.8 min. Commit b906d98.
  - The unit B idea for the refused sheet (a text field over 32 KB) cannot work: the save repair cuts every string to 500 characters. The test routes the sheet PUT to a 413 `too large` and makes the change by tapping HP on the Status tab.
  - The rejoin test first used a MutationObserver alone and still passed with the gen check removed from `view()`: the hidden roster keeps its old text, so stale data renders no mutation. It now also samples the visible roster text every frame. With `view()` ignoring the gen it fails (it saw "Kai Test" five times), and with the code as it is it passes.
- step 2: `replaced { room, last }` on the link (`src/core/sync/link.ts`): from idle, creating, joining or live it drops the old gen's requests and starts again from the room the save now holds, as at boot (live and connecting, or idle with what it knew of the server). Off and upgrading ignore it. Five reducer tests in `tests/link.test.ts`; the model check sends it in three forms (a file in room B as player, in room A as GM, in no room) and still closes: 12,716 states, 304,484 transitions, depth 28. The store marks a whole-save swap as `{ reason, replaced: true }` (`replace()` in `src/edge/store.ts`, used by import, restore and reset), and the sync edge sends `replaced` on that change. `io.js` is unchanged. Browser test "replacing the campaign with a file from another room moves the phone to that room without a reload" failed before the edge change (the pill still named room A after 15 s) and passes after. `bun run test`: 631 pass. Commit c6984c0.
  - Restore and reset had the same gap as import; one event fixes all three. A save written by another tab (`storage`) is not a `replaced`: two tabs each run a link, and which one owns the room is a separate question.
  - A Create or Join tap still in progress when the save is replaced ends with "Could not reach the server". Rare; left.
- step 3 (commit f16bd03): `actionTimeout: 15_000` in `playwright.config.ts`. The lever is `E2E_POPUP_DELAY=<ms>`, read once in `tests/e2e/helpers.ts`: the `device()` fixture puts it on the page before the app loads, and `system()` in `src/views/ui.js` then opens every window (the first one too, not only the next in the queue) that many ms late. With it off `system()` behaves exactly as before. Documented in AGENTS.md under "Tests".
  - Run 1, lever on (100 ms, 2 workers): 4 failed, 82 passed, 1 skipped (the existing fixme), 6.7 min. All four were popup gaps, and each failed every time with the lever:
    1. `combat-turns` "a removed defeated monster ...": after Mark defeated, `dismissAll` looked before MONSTER INFO UNLOCKED opened, so the Remove confirm queued behind it and its button never came.
    2. and 3. `character` "GM Reset rules ..." and "Restoring a backup ...": `confirmDanger` was "tap the danger button if it is on screen", so with the confirm a moment late it tapped nothing and the reset or restore never happened.
    4. `character` "The skill form accepts mixed dice ...": `dismissAll` after saving a skill missed "Skill acquired", which then covered the next Save tap (the new 15 s action timeout named the window in the way).
  - Fixes are all in tests: a shared `answerWindow(page, title, label?)` in `helpers.ts` (wait for the window by its title, tap its button, wait until it closes) used for 1 and 4; `confirmDanger` now waits for the danger button. No fixed waits, retries or wider timeouts were added.
  - Run 2, lever on: 1 failed, 85 passed. `room-onboarding` "opening an invite link ...": not a window. It read `location.hash` once, and the app routes to Status only after the join answers. It failed 3 of 5 runs without the lever too, so it is a test race that was already there and the slower box exposed it. It now waits for the URL (`toHaveURL`), and passed 5 of 5. Not an app race: the Status tab is on screen the whole time.
  - The ~60 `dismissAll` calls the flake notes counted are mostly safe. `tapIfShown` waits 300 ms after each tap, which covers the next queued window, and most calls are followed by a wait on something the player sees. Only the five above went wrong under the lever.
  - Run 3, lever on: 86 passed, 0 failed, 1 skipped (6.1 min). The normal run with the lever off is the `bun run ci` of step 4.
- step 4: `bun run test`: 631 pass, 0 fail. `E2E_CHROMIUM=/opt/pw-browsers/chromium bun run ci` (lever off, the normal run): "1 skipped / 86 passed (7.5m) / CI passed". No pause was noticed during these runs.
