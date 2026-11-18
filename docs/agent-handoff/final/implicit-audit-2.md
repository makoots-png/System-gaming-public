# The second audit of everything implicit

Brief: `brief-implicit-audit-2.md`. Read only: no code or test was changed. Every file was read as committed at `HEAD`
4a311c3 (`git status` showed no file modified while I read). Line numbers are those of 4a311c3.

## Summary

The honest answer is that little is left. Of the first audit's 90 rows, 75 are done, with a lint or a test that would
catch their return in most cases. 7 are done in part, and 8 were left on purpose, each for a reason that still holds.
None is not done. What remains is small and has its own causes: a player's send that is acted on before the GM's
fight takes it, three GM actions written as several writes in a view after the fight's end and the Clear became one step
each, one rule read again in a view, and lints that guard the old shape of a thing.

Counts. Step 1: 5 parts are new work (41, 42, 51, 57, 84) and 2 belong to the leftovers (87, 90). Step 2: 19 new
findings, by kind (a finding of two kinds counts in both): 1 a machine as flags 1 (N15); 2 a lifecycle with no table 2
(N1, N7); 3 a rule by convention or written twice 9 (N2, N3, N4, N6, N8, N9, N13, N18, N19); 4 a fact kept twice or
stored derived 5 (N6, N11, N12, N14, N20); 5 loosely typed 4 (N5, N9, N16, N17); 6 an effect of looking 0 (row 51 is
the one left); 7 an error swallowed 0 (the invite's false reason is step 3's); 8 timing by sleep 0 (row 84 is the one
left). Step 3: 9 allow-list entries or gaps to fix instead, 8 stale.

### The ten most likely to bite a player

1. N1: a potion used in the GM's fight leaves the bag when it is posted. When the GM's fight refuses the use (not the
   turn, out of reach), the potion is gone and nothing happened. (V1, sure: high)
2. N14: a player's quest progress on the GM's phone is logged under the GM's own active hunter, so the log names the
   wrong hunter on every such line. (V2, high)
3. Row 41: the loot a fight dropped is offered once, in a window after the fight is cleared; a reload or a closed tab
   while it waits loses the offer for good. (V3, high)
4. N3: Send award is a write per hunter, a post per group, a fight status per held player and a log line, from a view;
   a throw part way pays some, and a second tap pays them twice. (V2, med)
5. N9: a failed Create on the GM view says "Could not reach the server" for every failure, another tab's takeover and
   a busy link included; room.js and onboarding word the same failures differently. (V4, med)
6. Row 42: the Clear panel's "each selected hunter gets N XP" is worked out by the view, apart from the split that
   pays. (V3, high that it is a copy; nothing differs today)
7. N8: one player's name is "Hunter", "hunter" or "Player" and cut at 60 or 40 characters, by screen, because eleven
   reads guard a sheet the parser already read. (V4, high)
8. N2: a potion used on oneself is several writes and its "may this be used" rule is the view's: a throw between leaves
   the heal given and the potion kept. (V1, med)
9. N4: Revive to a player in the fight is a post, a row edit and a log line; the log says Revive for a post the
   outbox let go. (V2, med)
10. N19: the Data view says 8 backups are kept whatever the rule says. (V7, med)

### The units in order

V1 A player's item in the GM's fight; V2 The GM view's actions in one step; V3 The fight's end and the Clear panel; V4
One player, one name, one target; V5 The link's saves as steps; V6 The Table feed and the gates' news; V7 Dead and wrong
words; V8 The lints hold what they name. All wait for the leftovers helper, which is changing combat.js, api.ts, maker.js
and lint.test.ts now. V1 and V2 can then run side by side; the table at the end gives each unit's files, tests and order.

### What I did not read, and why

- Read in full: app.js, ui.js, store.ts, room-events.ts, sync.ts, sw.js, edge/upgrade.ts, uses.js, patch.ts,
  lint.test.ts, and the regions cited of combat.js, gates.js, gm.js, table.js, quests.js, inventory.js, room.js,
  coin.js, custom.js, skills.js, maker.js, io.js, server.ts. Everything else in src was searched for the eight kinds
  (`let`, timers, `catch`, casts and `any`, the clock, `Math.random`, `store.apply` and `store.update`, `app.on`, string
  prefixes, `=== '`) and read only around a hit.
- Not read line by line: the fight's modules in src/core/combat (charted tables with model tests; searched for casts,
  the clock and randomness, and for brand constructors), motion.ts past its state and its exports, kit-examples.ts,
  worth.ts, rulesref.js, detail.js, effects.js, workshop.js, loot.js, reward-editor.js, forge.js, map-maker.js,
  shadows.js, starter.js, most of hunter.js and bestiary.js. The reason is time against a tree of about 34,000 lines:
  the searches cover every file for every kind, and the reading went where the merges and the hits pointed.
- scripts/: only the two that write checked files (statecharts.ts, deps.ts); each has a test that fails when its file is
  stale. tests/ other than lint.test.ts: read only to find the guard of a step 1 row.
- Not run: anything (the lead's CI is timing frames on this box). No claim here is from a run.

Principles that changed a choice: model-the-domain (N1 rides the fight's existing `vitals` totals rather than a new
undo for the bag), boundary-discipline (N8: a parsed sheet is trusted inside, so the remedy deletes guards rather than
unifying them), subtract-before-you-add (N11 and the stale permits are deletions, not new rules).

## Step 1: the first audit's rows, checked

Verdicts: **done** (the implicit thing is gone, and the guard named would catch its return), **part** (what is left,
with file and line), **not done**, **left** (the first audit's reason, checked against the code now). "Guard" is the lint
test (by its name's first words) or the test that fails if the thing comes back; "none" means only the code holds it.

| # | Verdict | What the code holds now | Guard |
|---|---|---|---|
| 1 | done | `asked()` in app.js answers `failed`, the part draws failed and the throw is `reported` | lint "no error is swallowed" |
| 2 | done | `updatePart` marks a throwing part failed and reports each new message (report.ts, once per place and message) | lint "no error is swallowed" |
| 3 | done | `apiTable` throws for a name read before its module registered, or after a failed register | runtime throw; browser tests fail on the warning |
| 4 | done | `ui.windowOpen()` over the stack; app.js and `news` ask it | lint "a window opens on the one window stack" |
| 5 | done | each stack entry is `queued`, `open` or `leaving` (`WindowState`) | the same lint (structure only) |
| 6 | done | one stack; the maker and onboarding open with `openWindow` | the same lint |
| 7 | done | the maker's `form` is `clean` or `edited`; Escape or the backdrop on an edited form asks "Discard changes?" | makers.e2e.ts |
| 8 | left, holds | a toast's `_t` and `dataset.amount` have one writer (ui.js) and no reader outside it | none needed |
| 9 | done | ui.js imports the store statically; the chime reads `settings.sound` | none |
| 10 | done | the maker fits on the visual viewport's resize (maker.js:916-923) | lint "a view never scrolls on a timer"; but the timer lint still names maker.js with 1 timer it no longer has (step 3) |
| 11 | done | `store.active()` only reads; the repair gives every save a hunter | none |
| 12 | done | `store-life.ts` machine with its chart ("The store"); a read-only tab refuses `apply` | tests/store-life.test.ts, statecharts |
| 13 | done | `fought` (fight-save.ts) is one `store.apply`; `depth` is gone | lint "only the combat dispatcher writes the fight" |
| 14 | left, holds | `store.id` and `newHunter` raise `seq` outside a write (store.ts:252, 260); a gap changes nothing | none needed |
| 15 | done | another tab's save is the life's `otherTab` event (store.ts:328-334) | store-life tests |
| 16 | done | a failed prefs or device write is the `deviceFailed` banner (store.ts:111-115) | store-life tests |
| 17 | done | `once(eid, step)` writes the change and the id together (`appliedOnce`) | lint "a room event id is recorded only by appliedOnce" |
| 18 | done | one `grant` per hunter inside one `once` (room-events.ts:128-141) | tests/grant.test.ts, applied tests |
| 19 | done | the outbox machine, posted by every sender; the GM's log is written with the post | lint "a view posts a room message through the outbox" |
| 20 | done | `uses.report` posts; the item leaves the bag in the inventory step | the same lint |
| 21 | done | quest progress posts under a key, so a newer one replaces one waiting (quests.js:174-181); the 1.5 s timer is gone | the same lint |
| 22 | done | every roll posts (table.js:586-592); no rate limit, no try | the same lint |
| 23 | done | a roll entry holds `hid`, a coin its `HunterRef` | lint "a hunter is found by its id" |
| 24 | done | a roll's `kind` is set by the tray; the feed's Apply went | lint "no behaviour is decided by a regex on a label" |
| 25 | done | the device token is made at load (`ParseEnv.newDeviceToken`); `heard()` writing `serverOk` stays as the link's bookkeeping | none |
| 26 | done | `bound()` answers the bound hunter or null (sync.ts:533) | tests/party.test.ts (rebind on delete) |
| 27 | done | `event<K>(type, body: EventBody<K>)` (sync.ts:718) | lint "no as never" |
| 28 | done | `online` is a link event; a good poll flushes | none |
| 29 | done | sw.js fails the install on a file that did not cache; sync.ts logs a failed register | lint "no error is swallowed" |
| 30 | done | the update machine (core/upgrade.ts) with its chart; edge/upgrade.ts its one writer | lint "only src/edge/upgrade.ts listens to the service worker" |
| 31 | done | `call` answers a `Call` union (`ok`, `offline`, `refused` with the reason, `server`) | tests/outbox.test.ts |
| 32 | done | `roomLive` and one `sweep` per store (server.ts:126, 205) | tests/server-rooms.test.ts |
| 33 | done | with `DATABASE_URL` set and Postgres down no room is served and health says so | lint "server.ts swallows no error" |
| 34 | done | `KICKS` is gone; `_kicked` is the one record | lint "server.ts keeps no room state of its own" |
| 35 | done | a sheet write needs the key or the device token | tests/server-rooms.test.ts |
| 36 | done | the store takes `RoomCode`, `SheetKey`, `DeviceId`; rows are parsed | lint "server.ts has no any" |
| 37 | done | presence lives in each store's `presenceBook` and goes with its room | lint "server.ts keeps no room state" |
| 38 | done | `seatOf` and `app.seat()`; rules by seat in core (`runsFight`, `useRoute`) | lint "a view asks app.seat()" |
| 39 | done | a corpse's attempts are in the fight (core/combat/extraction.ts, chart "A fallen monster's extraction") | tests, statecharts |
| 40 | done | `extractDc` in core/hunter/shadows.ts:76, its floor a rule | tests/shadows.test.ts |
| 41 | part | `settleEncounter` pays in one step. Left: the loot window after it (combat.js:444-448) is the only offer of the loot; a reload or a tab closed while it waits loses the offer, and nothing in the save remembers the fight dropped anything | none |
| 42 | part | `splitAward` (pay.ts:29) pays both ends. Left: the Clear panel's preview works the split out again, `perHunter` (gates.js:319, used at 326 and 413) | none |
| 43 | done | `ending` is gone with the settle step | none |
| 44 | done | `over` is one union (combat.js:666) | lint "every let a view keeps" names it |
| 45 | left, holds | `tableRefusal` is news for the next doc; after a reload nothing is left to explain (combat.js:326) | none needed |
| 46 | done | Remove asks the server first and takes the row out only when it was taken (room.js:291) | room-sync-fixes.e2e.ts |
| 47 | done | `choose` in map-view.ts with its chart | tests/map-view.test.ts |
| 48 | done | gesture.ts with its chart | tests/gesture.test.ts |
| 49 | left, holds | `far`, `seen`, `sized` are caches of the last frame | none needed |
| 50 | done | `hold` is `{ at: 'free' }` or `{ at: 'sent', from, id }`, let go by the outbox's refusal (table.js:227-240) | none |
| 51 | part | rows are seen only while the feed is on screen. Left: `paintFeed` writes device memory while drawing (table.js:633); the draw lint does not see a `store.device(...).write` | lint "a view draws without changing anything" misses it (step 3) |
| 52 | done | device memory is `store.device(name)` | lint "the browser's storage is read and written only in src/edge/store.ts" |
| 53 | done | `world.session`, `sessionStarted` | tests/world.test.ts |
| 54 | done | `advanceDay` answers what moved; Start session says so (gm.js:422-427) | none |
| 55 | left, holds | `pendingAward` (gm.js:341) hands one reward to the next draw; nothing is saved | none needed |
| 56 | done | `deadRooms` is gone | none |
| 57 | part | gm.js's targets are `HunterRef`s (gm.js:262). Left: the same `'l:'`/`'r:'` prefix strings in quests.js:153, 159 (the Job Change picker), skills.js:226, 231-232 (giving a skill) and combat.js:1116 (the GM's hunter select) | none |
| 58 | done | `dueAt` in day.ts, read by gm.js and quests.js | lint "the day's clock is src/core/day.ts" |
| 59 | done | `compareTimes` | lint "two stored times are compared with compareTimes" |
| 60 | left, holds | opening the uses is the tap that sees them (gm.js:541) | none needed |
| 61 | left, holds | a textarea's `dataset.dirty` has one writer | none needed |
| 62 | done | `dayKey` and `nextReset` in day.ts from one rule | tests/day.test.ts, lint "the day's clock" |
| 63 | done | `dayKey` takes the time | the typecheck |
| 64 | done | one timer set for `nextWake` (quests.js:259); the 1 s interval only redraws the countdown | lint "a view waits on a timer only where this list names it" |
| 65 | done | `overdue` and the Reopen refusal in quests.ts | tests/quests.test.ts |
| 66 | done | every level move in grant.ts runs `levelled` | lint "a hunter's level moves only in src/core/hunter/grant.ts" |
| 67 | done | `busy` reads `conn()`; the link spends the invite (`spendInvite`) | lint "a view draws without changing anything" |
| 68 | done | the link emits `sync:room`; `wasRoom`, `wasGM` are gone | none |
| 69 | done | a player's rules lay the room's build doc over its own (`bindRoom`); nothing is copied | tests/build.test.ts |
| 70 | done | the old-app branch is gone (custom.js) | none |
| 71 | done | onboarding.ts machine with its chart, started on `ready` | tests/onboarding.test.ts |
| 72 | done | `starter.ts` one step; the seed carries `seed` | lint "the seed hunter is told by its seed mark" |
| 73 | done | the preview reads `store.read` (`parseSave`) | none |
| 74 | done | `keepGmKey` on the parsed save (io.js:182) | tests/save.test.ts |
| 75 | done | the day's backup is the store's, at load (store.ts:199-200) | none |
| 76 | done | `codexDoc` in core within `DOC_MAX` | lint "a view or the edge cuts nothing by a size of its own" |
| 77 | done | the monster and its record in one step (`recordDefeat`) | tests/bestiary.test.ts |
| 78 | done | `checkResult` in core/roll.ts | tests/check.test.ts |
| 79 | done | the roll entry holds its `check` | tests/save.test.ts |
| 80 | done | the death save rolls through the dice api only; the fallback die is gone | lint "no error is swallowed" |
| 81 | left, holds | `writeInto` keeps held objects live by design (save-step.ts and its test) | tests/save-step.test.ts |
| 82 | done | the api wrappers are gone | lint "no error is swallowed" |
| 83 | done | who fought is the gate's `fought` | tests/pay.test.ts |
| 84 | part | the `_render` expando is gone. Left: the Clear panel opens from `setTimeout(() => openClear(g.id), 0)` after `app.go` (gates.js:452), through `mounted.open`, a function the mount hangs on a module object | the timer lint names it, which is the permit (step 3) |
| 85 | done | the gate's mark is part of `fought` | lint "only the combat dispatcher writes the fight" |
| 86 | done | roll tables and spawns draw from roll.ts | lint "a view or core rolls nothing of its own" |
| 87 | part | one brand; hunter, item, quest, title, shadow, log and room ids branded. The rest is the leftovers' row 8 (not repeated here) | lint "one brand" |
| 88 | done | one `StatusKey` | lint "a type name is exported by one module" |
| 89 | done | imported hunters are read by the save's hunter reader | tests/save.test.ts |
| 90 | part | `merge` is typed. List overrides kept as written are the leftovers' row 6 (not repeated) | lint "no any in src/core and src/edge" |

**Tally.** Done 75 (row 10 counted done: its only trace is a stale permit, step 3). Part 7: 41, 42, 51, 57 and 84 are
work no unit or leftover row owns; 87 and 90 are the leftovers' rows 8 and 6. Not done 0. Left 8, and each reason still
holds: 8 (a toast is a UI value), 14 (an id gap changes nothing), 45 (a refusal is news for one doc), 49 (caches of the
last frame), 55 (a hand-off to one draw), 60 (the tap is the seeing), 61 (one writer's dirty mark), 81 (`writeInto` by
design).

## Step 2: the inventory again, on the code as it is

The same eight kinds: 1 a machine written as flags, 2 a lifecycle with no table, 3 a rule held by convention (or written
twice), 4 a fact kept twice or a derived value stored, 5 stringly or loosely typed, 6 an effect of looking, 7 an error
swallowed, 8 timing by sleep. Sure: high (read, and the failure follows from the code), med (read, the failure needs a
timing or an input I did not build), low (internal, or a guess at what is seen). Each row was read around its hit. The
parts of step 1 (rows 41, 42, 51, 57, 84) are not repeated here.

What the suspect merges show. The combined diffs of 7207cef, eb029ab and e471f75 resolve only app.js's imports, the
`sync` api's member list (`send` and `isGM` both gone, as their units meant), combat.js's `remoteList` and three doc
files; none kept two copies of a rule. 7cbdf42 merged with no conflict. U14 (977c46d..e8504bf) finished what it touched;
what it left is in its notes and in the leftovers' brief, except the prefix targets of row 57 in three views it did not
open, and the stale comment in N12. The new findings are mostly at the seams those merges joined: a player's sends
against the GM's refusals (N1), the GM view's actions against the one-step rule (N3, N4), and the link's own saves (N6).

### A player's phone

| # | Where | Kind | The hidden state or rule | What a player or GM sees if it goes wrong | Sure |
|---|---|---|---|---|---|
| N1 | src/views/inventory.js:76-82 | 2 | an item used in the GM's fight leaves the bag when the `cast` is posted, not when the GM's fight takes it; a refusal (`turnDown` in combat.js:334-339: not the turn, out of reach, unknown ability) gives nothing back | "Potion used. Sent to the GM.", then "Not your turn" on the next doc, and the potion is gone with no effect | high |
| N2 | src/views/inventory.js:120-134 | 3 | a consumable used on oneself is `effects.applyOps` (one write per op through the hunter api), then `takeOne`, then the report: several writes for one use; and `can` (which ops apply: no heal when dead or full, a cure only for a held status) is a rule in the view | a throw between the writes leaves the effect given and the item still in the bag; a change to the heal rule in vitals.ts misses this copy | med |
| N5 | src/views/combat.js:298-306 | 5 | after a use, the toast finds the use's log line by text, `l.includes(\`${u.name} uses ${a.name}\`)`; the label lint sees `.test(` only | a reworded fight log line, or a row and an ability whose names make another line match, toasts nothing or the wrong line | med |
| N7 | src/views/gates.js:176-200 | 2 | a gate is marked "told" in device memory when its window is queued, not when the player has seen it; the windows wait on gates.js's own promise chain beside ui.js's queue | a reload while "A GATE HAS APPEARED" waits behind another window never shows it | low |

### The GM's phone

| # | Where | Kind | The hidden state or rule | What a player or GM sees if it goes wrong | Sure |
|---|---|---|---|---|---|
| N3 | src/views/gm.js:351-370 | 3 | Send award is one `applyRewards` write per local hunter, one outbox post per group of players, one fight `status` per held player, then `addLog`: four kinds of write in a view for one award, where the fight's end and a gate's Clear are each one core step (`settleEncounter`, `settleClear`) | a throw part way pays some hunters and posts to some players with no log line; a GM who taps again pays the first ones twice | med |
| N4 | src/views/gm.js:301-315 | 3 | a remote hunter's HP or Revive is the post and then `addLog` (two writes); Revive in the fight is also `combat.adjust(cid, { hp: 1 })`, so "revive puts a row in the fight at 1 HP" is a rule of the view | the log says "Revive" for a revive the outbox let go; the row's 1 HP follows the view, not vitals.ts | med |
| N14 | src/views/quests.js:191 | 4 | a player's quest progress, logged on the GM's phone, is written under `store.active().id`, the GM's own active hunter; uses.js writes the same kind of line with no hunter (uses.js:77) | the GM's session log shows "· <the GM's hunter>" beside "Mira COMPLETED Wolf Hunt" | high |
| N9 | src/views/room.js:187, 199, 233; gm.js:692-695; onboard.js:163, 209, 250; src/edge/sync.ts:101-117 | 3, 5 | a failed Create or Join is a `TapError` whose `kind` is a bare `string`; four views turn it into words, two by `kind`, two by `status` (404, 403), and gm.js's Create says "Could not reach the server." for every kind, `replaced` and `busy` included, where room.js says nothing for `replaced` | the same failure reads three ways on three screens; a GM whose create was replaced by another tab is told the server is down | med |

### The edge

| # | Where | Kind | The hidden state or rule | What a player or GM sees if it goes wrong | Sure |
|---|---|---|---|---|---|
| N6 | src/edge/sync.ts:375, 389-414, 537-545, 669-685, 812-816 | 3, 4 | the link's writes of the save are hand mutations in `store.update`, not core steps: `serverOk`, the GM key ring (its cap `KEYS_MAX`, drop, gone, and `forgetKey` doing the drop again), and the bind (`activeHunterId`, `boundHunterId`, `joinedAt`, the outbox's `rebound`) written twice, in `bindJoin` and in `switchTo`; `switchTo`'s "view only" sets `activeHunterId` by hand while app.js and party.ts set it with `setActive` | the bind's two copies can drift (one rebinds the outbox, the other not); a read-only tab's link changes its memory (store.ts:226-230 says so); nothing tests the ring's rules | med |
| N8 | src/views/gates.js:119, 311; gm.js:263, 298, 329, 366, 703; combat.js:1116; quests.js:375; skills.js:226; custom.js:279-281; src/edge/sync.ts:867-868 | 3 | a player's sheet is parsed at the boundary as a `Hunter` (protocol.ts:672-682, `RemoteSheet.data: Hunter`), yet eleven reads guard it again in the view, each with its own default and cut: `'Hunter'`, `'hunter'`, `'Player'`, 60 or 40 characters, rank `'E'`, `isObj(h.build)` ("raw sheets are read defensively") | one player is "Hunter" on one screen and "Player" on another; the guards read as if the parser could let a bad sheet through, so nobody trusts it | high |
| N11 | src/core/sync/sent.ts; tests/sent.test.ts; src/core/api.ts:492; src/core/protocol.ts:657; tests/lint.test.ts:305 | 4 | `sent.ts` (`freshFor`: has a sheet seen my change) is used by no file in src, only by the room model and its test; `RemoteSheet.seen` is made and read by nothing; two doc comments and the lint "a view never keeps the time of its own send" tell the reader to use it | nothing today; a reader trusts a guard that is not there, and the model tests a rule the app does not run | high |
| N12 | src/core/api.ts:108 | 4 | `CombatApi.adjust`'s comment says the Table feed's Apply sends a player's damage roll through it; U14 deleted that Apply | nothing: internal | high |
| N13 | src/views/combat.js:396; hunter.js:115; gates.js:33; src/edge/sync.ts:471 | 3 | "when a step happens" (now, today's day key at the save's reset hour, the rules) is written four times, each with a `|| 0` the save's repair already holds | nothing today; a fifth copy that differs gives one step another day | med |
| N15 | src/edge/rules.ts:12-19; store.ts:101-109, 151-152; report.ts:6 | 1 | the module-level `let`s of the edge outside sync.ts, room-pill.ts and upgrade.ts (the rules' source and cache, the store's `state`, `life`, `prefs`, `device`) are named in no list; the lint that names edge state covers three files | nothing today; a new flag in store.ts or rules.ts passes every lint | low |

### Core and the content

| # | Where | Kind | The hidden state or rule | What a player or GM sees if it goes wrong | Sure |
|---|---|---|---|---|---|
| N16 | src/core/registry/abilities.ts:197; views/bestiary.js:52, 224, 231 | 5 | whether an ability is an item's is read from its id's `item-` prefix (`itemOfAbility`), and whether a monster is a built-in from its id's `seed:` prefix, written three times in bestiary.js | a GM monster or skill id that ever takes the prefix is treated as built-in or as an item (ids today are `m…` and `k…`, so none does) | low |
| N17 | src/core/combat/fight-types.ts:18, 69; effect-ops.ts:28, 293; zones.ts:20 | 5 | `fightId`, `statusKey`, `shadowId`, `zoneId` brand any string with no parse, and `spreadKey` makes a key whose meaning is its `-spread` suffix (row 87's class, outside ids.ts) | nothing: internal | low |
| N18 | src/views/kit-parts.js:118-151; maker.js (the ability form) | 3 | the kit blocks' bounds (times a fight, an area's radius, a threshold's count) are checked in the maker with its own words, then again by fight-parse.ts | a bound changed in one place lets the maker save what the parser drops or clamps, with no word to the GM | low |
| N19 | src/views/io.js:224 | 3 | "The newest 8 backups are kept" is a literal; the cap is `backupCap`, a rule a GM may override | after an override the Data view states the wrong number | med |
| N20 | src/views/motion.ts:306 | 4 | `lastShown`, a module `Map` by key that is never pruned | memory grows by one number per key shown | low |

(N10 was the Clear panel's split, which is step 1's row 42; the number is not used.)

## Step 3: every lint allow-list

Each allow-list of tests/lint.test.ts, entry by entry. **Holds**: the reason is true and the thing allowed is not a
hidden state. **Stale**: the entry permits something the code no longer does, so it is room for a new one to pass.
**Fix instead**: the entry is an implicit thing with a permit. Entries the leftovers' brief already owns (the label
lint's skills-held.ts, the `any` lint's api.ts, the 23 names of the type-name lint) are not judged again.

| Lint (first words) | Entry | Verdict | Why |
|---|---|---|---|
| only src/core/role.ts decides the role | `mayRead`: save.ts, store.ts | stale | neither file matches the rule's pattern now (save.ts repairs `st.mode`, store.ts reads no mode); only role.ts needs the permit |
| src/edge/sync.ts keeps its state | the nine sync.ts lets, room-pill's `panelEl`, upgrade's `update` and `quiet` | holds | each is present and named at the top of its file |
| src/edge/sync.ts keeps its state | the files it reads: three | fix instead | the edge's other module lets (rules.ts's source and cache, store.ts's `state`, `life`, `prefs`, `device`, report.ts's `seen`) are in no list (N15); make the list cover every file of src/edge |
| only src/edge/sync.ts writes the room, cursor | `notTheSave`: io.js `isy.gmKey =` | stale | io.js has no such line since `keepGmKey` moved the rule to save.ts |
| only src/views/coin.js writes the save's coins | owner coin.js; the pattern `.coins =` | fix instead | the writer is core/coin.ts by spread (`{ ...save, coins: ... }`, coin.ts:198, 206, 220), which the pattern cannot see: the lint holds nothing. Name coin.ts the owner and catch `coins:` and `calls:` in an object literal, as the gate and penalty lints do |
| only progress.ts changes a hunter's level | `notHunters`: skills.js `k`, shadows.js `s` | stale | neither file writes a `level` now |
| only vitals.ts changes HP | `notHunters`: shadows.js `s` | stale | shadows.js writes no `s.hp`; core shadows.ts does |
| only the fight changes a combatant | `notRows`: shadows.js `s` | stale | as above; save.ts `x` holds (the shadow repair, save.ts:483) |
| only the fight changes a combatant | `notCopies`: protocol.ts, library.ts, hunter/shadows.ts, grant.ts | holds | each builds a doc, a status library, a shadow or a reward's statuses, never a row |
| a view computes no fight number | `mayImport` effect-ops.ts `addSheetStatus` | fix instead | no view imports it, and it is a write of a sheet's statuses: the permit lets a view put a status on a hunter outside vitalsEdit. Delete the name |
| a view computes no fight number | the other names | holds | each is a name, a constructor or the dice a use needs, imported by a view today |
| a view waits on a timer | quests.js 3 ("a player's progress sent after 1.5 s") | stale | 2 timers; U3 deleted the 1.5 s one. Set 2 and drop the reason |
| a view waits on a timer | maker.js 1 ("a focused field scrolled after the keyboard opens") | stale | 0 timers; the reason names what the scroll lint now refuses. Delete the entry |
| a view waits on a timer | onboard.js 2 ("the start after every module registered") | stale | 1 timer; the start is the `ready` event. Set 1 |
| a view waits on a timer | gates.js 1 ("the Clear panel opened after app.go draws the Gates view") | fix instead | kind 8: a task's delay stands for "after the view drew" (row 84). `app.go` then the view's own mount or update opening a panel it was asked for (an open request the view reads when it draws) needs no timer |
| a view waits on a timer | ui.js 4: two toast lives, `LATE` twice | holds, one doubt | the toast lives and the test lever hold. `closeWindow`'s `setTimeout(openNext, LATE)` with `LATE` 0 is "a task after the close": the next window waits for nothing observable. Low; say why in the reason or open it at once |
| a view waits on a timer | room.js 3, map.js 2, gm.js 1, io.js 2, onboard.js 1 | holds | a label put back, a clock drawn each second or 5 s, a typed code's pause, the gesture's hold (its end is the machine's `hold` event), a download's URL revoked |
| a view keeps no machine in flags (counts) | eleven files above their count: bestiary 6 (has 3), combat 10 (9), gm 9 (7), dice 5 (4), io 5 (3), ui 5 (4), hunter 4 (3), room 3 (1), skills 3 (2), custom 2 (1), shadows 1 (0) | stale | "may only fall" counts that did not fall leave room for 1 to 3 new closure lets each, with no reason read. Set each count to what the file has; delete shadows.js. Many reasons are a unit's name ("the GM view (U10)"), not what the lets hold |
| every let a view keeps is named | combat.js `tableRefusal` with `refusals`, `lastBurst` with `bursts` | fix instead | each pair changes together (a value and its count, combat.js:326, 332, 120, 338): by the lint's own rule a pair that changes together is one value, `{ refusal, n }` |
| every let a view keeps is named | gates.js `queue` | fix instead | a second queue of windows beside ui.js's stack (N7); ui.system already opens one at a time |
| every let a view keeps is named | gm.js `pendingAward` | holds | row 55, left with its reason |
| every let a view keeps is named | the rest (handles, what was drawn, a choice on screen, `hold`, `asking`, `wake`, `at`) | holds | one writer each, or the view's hold of a core machine's value |
| the browser's storage only in store.ts | sync.ts: the invite in sessionStorage | fix instead | its two catches say "the store's banner says storage is off", which is false when storage is full (no banner then; sync.ts:209, 212). `store.device('invite', 'tab')` gives it the store's banner and takes it off the list |
| the browser's storage only in store.ts | upgrade.ts: the reload note | holds | the note is read back to prove it was kept (`noteReload`), which `store.device` does not answer |
| no error is swallowed | `allowed`: empty | holds | the four-word reason is the escape; the one reason found false is the invite's (above) |
| server.ts swallows no error | the database's `failed` state | holds | it is a state the health route shows |
| a view draws without changing anything | (no list; a gap) | fix instead | the pattern sees `store.apply`, prefs, the invite and storage, not a `store.device(...).write`: table.js `paintFeed` writes the feed's seen marks while drawing (row 51). Add `.write(` on a device memory to the pattern, and move the mark to the feed's open and shown events |
| no behaviour is decided by a regex on a label | (the pattern; a gap) | fix instead | it sees `.test(label)`, not `.includes(...)` over a log line (N5) |
| a view or the edge cuts nothing by a size of its own | (the pattern; a gap) | holds for its class | it sees four-digit lengths; the 60 and 40 character cuts of N8 are the parser's bounds read again, a class of their own |

## Step 4: the judgment

Remedies as the first audit's: **machine**, **union**, **step** (a pure core function with a test), **lint**, **delete**,
**leave** (with the reason).

| Finding | Remedy | Unit |
|---|---|---|
| N1 an item gone on a refused cast | step: the item leaves the bag when the GM's fight takes the use. The GM's fight already sends a player its totals (`vitals`, posted under the hunter's key); it carries the items the row used (U2's note named this field), applied once by a core step on the player's phone. Delete `takeOne` after the post | V1 |
| N2 a consumable as several writes | step: `useItem(h, itemId, R)` in core/hunter/inventory.ts answers the next hunter (the ops through `sheetEdit`, the item taken) or a refusal; `can` moves into it | V1 |
| N14 the GM's hunter on a player's line | step: the GM's line for a `questUpdate` built in core/session-log.ts with no local hunter, as uses.js writes a told use; a test that the line names no hunter of this phone | V2 |
| N3 Send award as four kinds of write | step: `gmAward(save, picked, rewards, posts, stamp, R)` (the shape of `settleClear`): local grants, players' posts, the log line, in one `store.apply`; the fight rows' statuses as its `also` through combat.js `send` | V2 |
| N4 HP and Revive to a player | step: the post and the log line in one step; "a revive puts the row at 1 HP" as a fight command's rule, not the view's | V2 |
| 41 the loot offer lost | step: `settleEncounter` keeps the fight's drop on the save (a field the Award form clears when it sends it, or the GM dismisses), so the offer survives a reload; a test of the settle and of the dismiss | V3 |
| 42 the Clear preview's split | step: the preview reads `clearShares` or `splitAward` (pay.ts); delete `perHunter` | V3 |
| 84 the Clear panel opened after a task | delete the timer: the Gates view holds an open request it reads when it next draws | V3 |
| N5 the use's toast found by text | union: the fight's `act` answers the line it logged as part of its effect; delete the `includes`; the label lint sees `.includes(` | V3 |
| 57 the prefix targets | union: the three pickers carry a `HunterRef`, as gm.js does; delete `'l:'`, `'r:'` and their `slice(2)` | V4 |
| N8 a player's sheet guarded again | delete the guards: read `r.data.name` as the parser left it; one `remoteName` where a view needs a fallback for no sheet at all | V4 |
| N9 a failed tap's words | union: `TapKind` (the kinds `TAP_ERRORS` and `tapError` make) and one words table read by room.js, gm.js and onboard.js; delete the `status` reads | V4 |
| N6 the link's hand-made saves | step: the bind (`boundTo(save, hid, at)`, used by `bindJoin` and `switchTo`), the key ring (`ringKeep`, `ringDrop`, `ringGone`, `forgetRoomKey`) and `serverSeen` as core steps beside link.ts with a table test; `switchTo`'s "view only" uses party.ts `setActive` | V5 |
| N13 "when a step happens" four times | step: one function in day.ts over the save's reset hour and a time; delete the four copies and their `|| 0` | V5 |
| 51 the feed marked seen while drawing | step: mark seen on the feed's open, the view shown and the page shown, never in `paintFeed`; lint below | V6 |
| N7 a gate's news marked before it is seen | step: mark a gate told when its window is answered; delete gates.js's `queue` (ui.system already opens one window at a time) | V6 |
| N11 sent.ts and `seen` read by nothing | delete: sent.ts, tests/sent.test.ts, the room model's card bookkeeping, `RemoteSheet.seen`, the two doc comments, and the lint's advice to use `freshFor` (the lint's rule itself holds) | V7 |
| N12 the deleted Apply in a comment | delete the sentence | V7 |
| N19 "8 backups" | step: the line reads `rules().backupCap` | V7 |
| N16 kinds read from id prefixes | union: an item ability holds its item id as a field; a built-in monster carries a mark from the registry. Low: no id today takes either prefix | V7 |
| N15, and step 3's "fix instead" and "stale" rows | lint: the edge-state list covers every file of src/edge; the coin lint names coin.ts and sees `coins:`; the draw lint sees a device memory's `.write(`; the counts and timers set to what the files hold; the stale permits and `addSheetStatus` deleted; the two pairs in combat.js made one value each; the invite through `store.device('invite', 'tab')` | V8 |
| N17 brand constructors outside ids.ts | leave for the leftovers' row 8, which brands the save's other ids by U14's recipe: the four constructors and `spreadKey` go with it | none |
| N18 the kit blocks' bounds in the maker | leave: the maker's words for a bound are the parser's in effect today; when the leftovers' row 10 adds Einar's controls, have the maker ask the parser for its refusal instead of adding more bounds | none |
| N20 motion's `lastShown` | leave: it grows by one number per row key shown, a few hundred a session; not a state any rule reads | none |

### The units, in the order a player would notice them

Every unit waits for the leftovers helper (`brief-leftovers.md`), which is changing combat.js, api.ts, maker.js, ids.ts
and lint.test.ts now. "Files" are what the unit may change; units with no file in common can run side by side.

| Unit | Findings | Files | Tests | After |
|---|---|---|---|---|
| V1 A player's item in the GM's fight | N1, N2 | src/views/inventory.js, src/core/hunter/inventory.ts, src/core/protocol.ts (the `vitals` field), src/edge/room-events.ts, src/core/combat/fight-save.ts (what the row used, for the totals), tests/models/room-world.ts | tests/inventory.test.ts, tests/protocol.test.ts (`VALID` and its bound), tests/room-system-model.test.ts, tests/e2e/used.e2e.ts (a cast the GM refuses keeps the potion) | the leftovers |
| V2 The GM view's actions in one step | N3, N4, N14 | src/views/gm.js, src/views/quests.js (line 191 only), src/core/gates/pay.ts or a new src/core/award.ts, src/core/session-log.ts | tests/award.test.ts (new), tests/e2e/reward-room.e2e.ts | the leftovers |
| V3 The fight's end and the Clear panel | 41, 42, 84, N5 | src/views/combat.js, src/views/gates.js, src/core/gates/pay.ts, src/core/save.ts (the drop's field), src/core/combat/fight.ts (the act's line), tests/lint.test.ts (the label pattern) | tests/pay.test.ts, tests/save.test.ts, tests/fight.test.ts, tests/e2e/combat-turns.e2e.ts, tests/e2e/gates-quests-dailies.e2e.ts | V2 (pay.ts) |
| V4 One player, one name, one target | 57, N8, N9 | src/views/quests.js, skills.js, gates.js (names only), gm.js (names only), custom.js, room.js, onboard.js, src/edge/sync.ts (`TapError`, the roster), combat.js line 1116 | tests/lint.test.ts (no `'r:'` target, no view-side default on a parsed sheet), tests/e2e/room-sync-fixes.e2e.ts | V2, V3 (gm.js, gates.js, combat.js) |
| V5 The link's saves as steps | N6, N13 | src/edge/sync.ts, src/core/sync/bind.ts (new), src/core/party.ts, src/core/day.ts, the four `dayNow` copies | tests/bind.test.ts (new), tests/day.test.ts, tests/room-system-model.test.ts (the model copies sync.ts function by function) | V4 (sync.ts) |
| V6 The Table feed and the gates' news | 51, N7 | src/views/table.js, src/views/gates.js | tests/e2e/table-session.e2e.ts, tests/e2e/gates-quests-dailies.e2e.ts | V3, V4 (gates.js) |
| V7 Dead and wrong words | N11, N12, N19, N16 | src/core/sync/sent.ts (delete), tests/sent.test.ts (delete), tests/models/room-world.ts, src/core/api.ts, src/core/protocol.ts (comments), src/views/io.js, src/core/registry/abilities.ts, src/views/bestiary.js | the typecheck, tests/room-system-model.test.ts | V1 (room-world.ts) |
| V8 The lints hold what they name | N15, step 3 | tests/lint.test.ts, src/edge/sync.ts (the invite only), src/views/combat.js (the two pairs) | the lints themselves, each with the old line as its first case | all of V1 to V7 (a sweep) |

Each unit runs `bun run deps -- --write` and `bun run charts` where AGENTS.md's recipe asks, and writes for-the-owner.md
for a change a player or GM sees (V1, V2, V3, V4).
