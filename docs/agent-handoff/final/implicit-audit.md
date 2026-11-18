# The audit of everything implicit

Brief: `brief-implicit-audit.md`. Read only: no code or test was changed. Every file was read as committed (`HEAD`
edd9d99); `src/views/forge.js`, `src/views/maker.js` and `src/core/api.ts`, which another helper was editing, were
read with `git show HEAD:<path>`, and their line numbers are marked (HEAD). Line numbers of every other file are
those of edd9d99; files the kits helper began editing during the audit (bestiary.js, loot.js, skills.js, workshop.js)
were checked against `HEAD`.

## Summary

90 findings. By kind:

| Kind | Rows | Count |
|---|---|---|
| 1 a machine written as flags | 5, 8, 12, 37, 43-45, 47-50, 61, 68 | 13 |
| 2 a lifecycle with no table | 7, 19, 20, 30, 32, 41, 71 | 7 |
| 3 a rule held by convention | 3, 13, 14, 17, 18, 35, 38, 40, 42, 46, 58, 63, 65, 66, 70, 72, 74, 76-78, 81, 84-86 | 24 |
| 4 a fact kept twice, or a derived value stored | 4, 6, 15, 26, 34, 39, 52, 53, 56, 62, 69, 79, 83 | 13 |
| 5 stringly or loosely typed | 23, 24, 27, 36, 57, 59, 73, 87-90 | 11 |
| 6 an effect of looking | 11, 25, 51, 55, 60, 67, 75 | 7 |
| 7 an error swallowed | 1, 2, 9, 16, 22, 29, 31, 33, 54, 80, 82 | 11 |
| 8 timing by sleep | 10, 21, 28, 64 | 4 |

Of the 90, 8 are left with their reason (8, 14, 45, 49, 55, 60, 61, 81) and the rest go to fifteen units. Six new
machines come out of it: the outbox, the store's life, the app update, onboarding, the map's choice and the map's
gestures. The explicit core (the fight, the link, the push, the gate, the life, the penalty, the chain, the coin, the
shadow, the quest) held up: almost every finding is in a view, the edge or the server, at a seam between two of
those machines or between a machine and the network.

### The ten most likely to bite a player

1. Row 19: a reward, quest or HP change for a player's phone is sent once. When the player is offline at a fight's
   end or a gate's Clear, the XP never arrives, the GM's log says it was paid, and nothing sends it again. (U2, U3,
   U4, U10)
2. Rows 17 and 18: a reward is applied in five or more writes after its event id is recorded as applied. A throw part
   way leaves half a reward, and the room never offers the rest. (U1)
3. Row 41: ending an encounter is seven steps in a view. A reload or a throw between them leaves the gate paid and
   no XP given, or the fight cleared and its loot never offered. (U4)
4. Row 7: Escape or a press beside a maker or form window closes it and drops every field: a half-built monster or
   reward is gone. (U6)
5. Row 20: an item used on another leaves the bag before the GM is told; a failed send only says so in a toast, and
   the GM never hears of it. (U3)
6. Row 62: the daily countdown and the penalty use two rules for when the day resets; on a daylight-saving day they
   are an hour apart. (U5)
7. Row 39: a fallen monster's extraction attempts live in the GM screen's memory; a reload gives every corpse its
   tries back. (U4)
8. Row 53: the session number is read back from a log that keeps 200 lines; a long campaign's next session is
   "Session 1" again. (U10)
9. Row 46: Remove from room takes the player out of the fight before the server agrees; offline, the player is out
   of the fight and still in the room. (U8)
10. Row 33: with `DATABASE_URL` set, a Postgres that is not up yet when the server starts makes it run on memory
    with one console line; every room is gone at the next restart. Sure: medium, it needs the race. (U7)

Close behind: rows 22 (rolls past two a second never reach the GM's feed), 76 (the players' codex is cut at a
quarter of what the room takes), 51 (the GM's "N new" never shows on a desktop) and 82 (about thirty swallowed api
errors that turn a bug into an empty list).

### The units in order

U1 A reward lands whole; U2 The outbox; U3 Players' sends; U4 A fight's end and a gate's Clear; U5 The day's clock;
U6 Windows, makers, onboarding; U7 The room server; U8 The room view and the room's build; U9 The map's choice and
gestures; U10 The GM view and the codex; U11 The store; U12 Swallowed errors; U13 The seat; U14 Ids and kinds; U15
The app update. U1, U7 and U9 can start at once; the table under step 2 gives each unit's files, tests and what it
waits for. U6 and U10 wait for the kits helper's work on maker.js and bestiary.js.

### What I did not read, and why

- `src/views/motion.ts` and `src/views/patch.ts` past their `let`s and timers: they are the motion and patch
  systems, each with its tests and lints.
- Read only around the hits and the regions cited: rulesref.js (static text), effects.js, workshop.js, loot.js,
  reward-editor.js, map-maker.js, skills.js, inventory.js, bestiary.js, shadows.js, custom.js, io.js, the CSS
  strings in every view.
- `src/core` was searched for kinds 3, 4 and 5 (the clock, randomness, `any`, forced casts, id types, a name defined
  twice) and read where a hit led (ids.ts, imported.ts, rules.ts, save.ts's types, quests.ts's rollover). The fight's
  modules in `src/core/combat` were not read line by line: they are charted tables with model tests.
- The kits helper's uncommitted files (kit-parts.js, kit-examples.ts, the kits tests): not in `HEAD`.
- `scripts/` and the tests: outside the brief's list.

Principles that changed a choice: model-the-domain (one outbox machine for every send, the tombstone queue folded
into it, rather than a retry flag per sender), type-system discipline (the seat as a three-way union; branded save
ids), boundary discipline (the import preview reads what `parseSave` answers, not the file a second way).

## Step 1: the inventory

Kinds (the brief's): 1 a machine written as flags, 2 a lifecycle with no table, 3 a rule held by convention, 4 a stored
value that is derived or a fact kept twice, 5 a stringly or loosely typed thing, 6 an effect of looking, 7 an error
swallowed, 8 timing by sleep. Sure: high (read, and the failure follows from the code), med (read, the failure needs
a timing or an input I did not build), low (internal, or a guess at what is seen). Every row was read around its hit.

### The shell, windows and the store

| # | Where | Kind | The hidden states or the rule | What a player or GM sees if it goes wrong | Sure |
|---|---|---|---|---|---|
| 1 | src/app.js:43, 79, 94, 102 | 7 | `safe()` turns a `when` that throws into a default (true for a view or panel, false for a key) | a tab or panel that should be hidden shows, or a key does nothing, with no word | med |
| 2 | src/app.js:123, 137-138 | 7 | a view's or panel's `update` that throws is warned to the console once per id; later throws are not logged | the screen stops changing and nothing says why | high |
| 3 | src/app.js:264-267 | 3 | "a module may use the api of any module listed before it": the order of `MODULES` is the dependency order; a `register` that throws is warned and the rest run without its api | a later module's `app.api.X` is undefined and its buttons do nothing | high |
| 4 | src/app.js:74-77; src/views/ui.js:95 | 4 | "is a window open" is two DOM selectors: `modalOpen` lists five, `news` lists two | a key works under a window, or fight news is a toast over a sheet | med |
| 5 | src/views/ui.js:100-209 | 1 | the window queue is `queue`, `open`, `refreshCur` and a `setTimeout(next, LATE)`: queued, opening, open and leaving are implied | nothing today; nothing tests the order | low |
| 6 | ui.js:120-209; maker.js:698-716 (HEAD); onboard.js:46-67 | 4 | three window systems, each with its own focus trap, Escape and backdrop: the `ui.system` queue, the maker's `open` stack, onboarding's `root` | Escape or Tab reaches the wrong window when two kinds are up | med |
| 7 | maker.js:698, 724 (HEAD); ui.js:203 | 2 | a maker or form window has no clean or edited state: Escape or a press on the backdrop closes it and drops every field | a GM who misses the window by a few pixels loses a half-built monster, status or reward | high |
| 8 | ui.js:51-81 | 1 | a toast's life is the class `m-leaving`, an expando timer `_t` and `dataset.amount` | nothing | low |
| 9 | ui.js:19 | 7 | ui.js reaches the store by a dynamic import whose failure is swallowed; the chime is off until it lands | no sound | low |
| 10 | maker.js:747 (HEAD); store.ts:141-142 | 8 | a 250 ms sleep stands for "the keyboard has opened"; the save's write waits a frame plus a task, or 1 s | on a slow phone a field stays under the keyboard | low |
| 11 | src/edge/store.ts:196-205 | 6 | `store.active()`, a read, pushes a starter hunter and persists when there is none, and announces nothing | views drawn before the next change show a save the subscribers were not told of | med |
| 12 | store.ts:97-99 | 1 | five flags (`readOnly`, `freshInstall`, `saveOk`, `depth`, `unsaved`) are the store's life: loading, read-only, failing, dirty | in a read-only (newer) save every tap still changes the screen, and the change is gone after a reload | med |
| 13 | store.ts:174-183 | 3 | an `update` inside another is "part of the outer one's change" by a depth counter; `combat.js` `send` relies on `setVitals` running inside it | internal | med |
| 14 | store.ts:195, 208-215 | 3 | `store.id` and `newHunter` raise `seq` outside any update | nothing | low |
| 15 | store.ts:260-267 | 4 | another tab's save replaces `state` whatever this tab has unsaved; a text that is not a save is ignored without a word | with two tabs open, a change in one is undone by the other | med |
| 16 | store.ts:244 | 7 | a prefs write that fails is swallowed | pins or the fight view are not kept across a reload | low |

### The room, the edge and the server

| # | Where | Kind | The hidden states or the rule | What a player or GM sees if it goes wrong | Sure |
|---|---|---|---|---|---|
| 17 | src/edge/room-events.ts:155-163; sync.ts:408, 432 | 3 | an event's id is recorded as applied in one write (`firstTime`), and the change is made in later writes; an applier that throws is a console warning | a GM award that fails part way is marked applied and never comes again: the player keeps half a reward | high |
| 18 | src/views/hunter.js:236-273 | 3 | `applyRewards` is five or more writes (record parts, each status, gold, each item, XP, the refill), though AGENTS.md says one update | a throw part way leaves part of a reward; `once` cannot cover it | high |
| 19 | gm.js:336-357; gates.js:105-108; combat.js:155-158, 392; custom.js:288 | 2 | an award, quest, HP, status or build change for a player's phone is sent once with no outbox; the GM's log, the gate's Clear and the fight's end are written as paid either way | a player offline when the fight ends never gets the XP, and nothing offers to send it again | high |
| 20 | uses.js:36-48; inventory.js:68-74; skills.js:55-57 | 2 | a use told to the GM: the item leaves the bag, then one send; a failed send is a toast | the GM never hears of the potion the player drank | high |
| 21 | quests.js:183-195 | 8 | a player's quest progress waits 1.5 s in a per-quest timer, is sent once and its answer is ignored | the GM's view misses progress when the page closes or the send fails | med |
| 22 | table.js:512-518, 526 | 7 | rolls past 2 a second are dropped and any error of the feed send is swallowed | the GM's Table feed misses a roll and the player is not told | high |
| 23 | table.js:520; coin.js:61; dice.js:107; save.ts:140 | 5 | a roll and a coin call name their hunter by `who`, a name, and the hunter is found by name; the GM's is the word 'GM' | two hunters of one name, or a renamed one, send under the wrong hunter's key | med |
| 24 | table.js:523, 543 | 5 | whether a roll is damage (the feed's Apply to) is a regex on its label (damage, dmg, attack, strike, minus a heal regex) | a damage roll labelled "Hit" offers no Apply | med |
| 25 | sync.ts:118-127, 344, 493 | 6 | reading the device token writes it; each poll writes `serverOk` and the bound hunter when they differ | nothing | low |
| 26 | sync.ts:492, 575, 582; app.js:214 | 4 | the hunter the sheet push sends falls back to the active one when `boundHunterId` names no hunter: two ids for one fact, with three writers of `activeHunterId` | a player who deleted the bound hunter pushes whichever hunter is shown | med |
| 27 | sync.ts:616 | 5 | `event(type: string, body: unknown)` casts both `as never`; a wrong type or body is null at run time | a send that does nothing, with a console warning | med |
| 28 | sync.ts:802 | 8 | `setTimeout(flush, 500)` after `online` stands for "after the link is back" | nothing (the next poll flushes too) | low |
| 29 | sync.ts:820-821; src/sw.js:16, 34 | 7 | the worker's register, a shell file that failed to cache and a cache put are swallowed; a failed file counts as done | offline at the table, the app opens with a file missing | med |
| 30 | src/sw.js:10-18; upgrade.ts:23-43; room-pill.ts:30-36; link `upgrading` | 2 | the app update (installing with a count, waiting for the worker, reloading, stuck) is spread over four files with no table of which follows which | the pill shows a percentage that stops, then a reload up to 4 s later | low |
| 31 | sync.ts:162-168 | 7 | `quietCall` answers null for every failure (no network, 403, 500) | Remove, Allow back and Release say "offline?" whatever the cause | med |
| 32 | server.ts:47-63, 94-111 | 2 | a room's life (made, live, expired) is `touched` against `TTL` in five places; the memory store sweeps only on create | none seen; a room's end is not in one place | low |
| 33 | server.ts:147 | 7 | Postgres failing at start falls back to the memory store with one console line | on the deploy every room vanishes at the next restart: "This room no longer exists" | med |
| 34 | server.ts:167-171 | 4 | "removed" is kept twice: the in-memory `KICKS` (20 s) and the `_kicked` doc (10 min) | after a server restart a removed player's sheet may push again for 20 s | low |
| 35 | server.ts:198-206 | 3 | "no token and no owner is an old client: allowed as before"; old clients need not work | any phone can write the sheet of a device that never sent a token | med |
| 36 | server.ts:29-43, 81, 119-129 | 5 | the store takes `code: string` and `hid: string`; Postgres rows are `any` | internal | low |
| 37 | server.ts:155-165 | 1 | the presence map `lastSeen` keeps every room code it has seen | memory only grows | low |

### The fight, the map and the table

| # | Where | Kind | The hidden states or the rule | What a player or GM sees if it goes wrong | Sure |
|---|---|---|---|---|---|
| 38 | combat.js:58-60; table.js:34-37; inventory.js:69; skills.js:55; uses.js:28, 38; bestiary.js:120; quests.js:182-192; coin.js:48 | 3 | the seat (alone, GM in a room, player in a room) is worked out from `app.isGM()` and `sync.room()` in twelve places, several inside a try that answers false; "solo play runs its own fight, in a room only the GM does" is a view's rule | a copy that differs shows a control to the wrong phone | high |
| 39 | combat.js:80, 475, 737; shadows.js:24 | 4 | a fallen monster's extraction attempts are a `Map` in combat.js's closure | after a reload every corpse has its tries back | high |
| 40 | shadows.js:20 | 3 | the extraction DC (at least 5, base plus a step per rank, plus the boss's) is worked out in the view, the 5 a literal | a rule change in `RULES.shadow` misses this copy | high |
| 41 | combat.js:354-405 | 2 | the end of an encounter is seven steps in a view behind an `ending` flag: `end`, the gate's payment, room awards, party awards, `combat:end`, `clear`, the loot window | a reload or a throw between steps leaves the gate paid and no XP given, or the fight cleared and the loot never offered | high |
| 42 | combat.js:367; gates.js:94-97 | 3 | the XP split (`xpSplit`, the award over the party, rounded down) is written twice, and the gold split once more | the two splits can drift | high |
| 43 | combat.js:90, 119 | 1 | `ending` both blocks a second End and hides the "fight is over" toast | nothing | low |
| 44 | combat.js:612-614, 650, 861-864, 1026-1028, 1037, 1103 | 1 | what is open over the GM's map is two booleans (`sheet`, `tools`) cleared in six places; the Build drawer's open state is `dataset.auto` and `dataset.touched` | a card and the Fight tools both open | low |
| 45 | combat.js:295-302 | 1 | the last refused player tap lives in a closure (`tableRefusal`, `refusals`) until the next publish | after a GM reload the player is not told why a tap failed | low |
| 46 | room.js:276-281 | 3 | Remove from room takes the player's row out of the fight before the server's DELETE | when the DELETE fails, the player is out of the fight and still in the room | high |
| 47 | map.js:195-202, 276-301, 394, 401, 415, 424, 688-696 | 1 | select, pick, aim, confirm: `sel` (a typed union) plus `picked` (the same ability again), `before`, `drawer`, `sentWay`, `lastWay`; `draw` resets the choice when the actor changes or the ability leaves the kit, and works the scene out twice | a tap at a turn's change can keep an aim the new actor cannot use; the flow has no test of its own | med |
| 48 | map.js:320-406 | 1 | the gestures: `g.kind` (maybe, pan, drag, pinch, paint), `quiet` (swallow the next click), `pts`, a hold timer that turns maybe into drag, and `brush`, across five handlers | a pan that ends on a token is taken as a tap, or a drag survives a cancelled pointer | med |
| 49 | map.js:215, 249, 269 | 1 | `far`, `seen`, `sized` are caches of the last frame | nothing | low |
| 50 | table.js:214-221 | 1 | a player's sent command waits while `sentFrom` equals the doc's `at` | a doc that never comes leaves the turn's buttons off | med |
| 51 | table.js:563-568, 616 | 6 | painting the Table feed marks every row seen when it is open or the screen is wide, and it paints on every save change while the GM is on another view | on a desktop the "N new" count never shows | high |
| 52 | table.js:42-43, 530-533; gates.js:154-160 | 4 | device memory beside the store: cues fired, the feed and its `applied` flags (sessionStorage), the gates told of per room | a new tab offers Apply again for a roll already applied | med |
| 53 | gm.js:406 | 4 | the session number is read back from "Session N began" titles in a log that keeps 200 lines | after 200 lines the next session is numbered 1 again | high |
| 54 | gm.js:404-421 | 7 | Start session swallows `advanceDay`'s error and logs "Day advanced" whatever happened; spawn's error becomes "did not spawn a gate yet" | the log says the day moved when it did not | med |
| 55 | gm.js:326-335 | 6 | a reward for the Award form waits in `pendingAward` until the GM view is drawn | nothing | low |
| 56 | gm.js:66 | 4 | `deadRooms`, a module set of rooms the server said 404 for, beside the link's last room `why: 'gone'` | nothing | low |
| 57 | gm.js:87, 273-277 | 5 | the targets are strings 'l:hid' and 'r:key' split by prefix | nothing | low |
| 58 | gm.js:395; quests.js:397-399 | 3 | a quest's due time from hours is worked out in two views | the two forms can disagree | med |
| 59 | gm.js:512 | 5 | unseen uses compare ISO strings | nothing | low |
| 60 | gm.js:519-522 | 6 | opening the log at its uses marks every use seen | by design: a tap | low |
| 61 | gm.js:443, 491, 500 | 1 | a textarea's dirty state is `dataset.dirty` | nothing | low |

### Quests, the day, the room view, onboarding and the rest

| # | Where | Kind | The hidden states or the rule | What a player or GM sees if it goes wrong | Sure |
|---|---|---|---|---|---|
| 62 | quests.js:103-107; src/core/rules.ts:465-469 | 4 | when the day resets is two rules: core `dayKey` subtracts the reset hours from the time, the view's `nextReset` sets the local hour | on a daylight-saving day the countdown ends an hour before or after the penalty lands | high |
| 63 | rules.ts:465 | 3 | `dayKey` reads the clock in core by default | internal | low |
| 64 | quests.js:558-561, 590-592 | 8 | the rollover is driven by three clocks (1 s inside the view, 60 s, page shown) | nothing | low |
| 65 | quests.js:303, 532 | 3 | "overdue" is checked against the clock in the view, and "an overdue urgent quest needs a new due time" before Reopen is a view's rule, not `reopenQuest`'s | the card shows overdue up to a minute before the quest fails | med |
| 66 | quests.js:158; hunter.js:127, 790 | 3 | the Job Change's level step hears the level only by the `level` event two hunter.js writers emit | after an import or a restore the step stays open until the next level change | med |
| 67 | room.js:58, 297-299 | 6 | `S.busy` copies the link's creating and joining; drawing compares `S.pc` with the connection to clear errors, and drops the invite with a toast | the toast "already in room" fires from a redraw | med |
| 68 | custom.js:300-310 | 1 | leaving a room is found by diffing `wasRoom` and `wasGM` on every change, though the link knows each leave | a player keeps the old GM's build switches, or loses their own | med |
| 69 | custom.js:311-318 | 4 | a player copies the GM's build switches into their own `rulesOverrides` on each doc; leaving drops them, the player's own too | after a room a player's own Builds setting is gone | med |
| 70 | custom.js:288-290 | 3 | a branch for "a player on an older app" (no `build` key); old apps need not work | a warning toast nobody needs | low |
| 71 | onboard.js:46-67, 145-265 | 2 | onboarding's steps are functions that swap one overlay; `onboarded` is written at different points per path; `setTimeout(start, 0)` stands for "after every module registered" | a reload part way repeats or skips a step | low |
| 72 | starter.js:37-56; onboard.js:226 | 3 | the starter campaign is about fifteen writes; a throw part way is caught and says "choose Blank" over half a campaign; the seed hunter is told by its name and field values | a GM sees a partial starter and a message to pick Blank | med |
| 73 | io.js:41-56 | 5 | the import preview reads a save file on its own (schema 2, a lone old hunter by `'name' in p`), apart from `parseSave` | the preview offers Add or Replace for a file the import then refuses | med |
| 74 | io.js:217-224 | 3 | the GM key is put into an imported file by the view; its JSON error falls into an empty `catch {}` | nothing | low |
| 75 | io.js:173-177 | 6 | registering the Data view takes the day's backup | nothing | low |
| 76 | bestiary.js:115 | 3 | the codex doc is cut at a literal 15500 characters; the room takes `DOC_MAX`, 62000 | players see fewer codex entries than the room could carry | high |
| 77 | bestiary.js:80-99 | 3 | a defeat's codex record is `saveMonster` then `recordDefeatStep`, two writes, fired by both `combat:defeated` and `combat:end` | nothing | low |
| 78 | dice.js:121 | 3 | a check's success (a natural 20 succeeds, a 1 fails, else the total against the DC) is worked out in the view | a rule change misses it | med |
| 79 | dice.js:128 | 4 | the last check's verdict is a closure value, not part of the roll entry | the log cannot say success or failure; a reload drops it | low |
| 80 | hunter.js:484 | 7 | a death save whose roll throws rolls its own d20 instead, unlogged | a death save missing from the roll log | low |
| 81 | hunter.js:486; store.ts:186-193 | 3 | after `api.life` the view reads the hunter it held, right only because the store writes into live objects (`writeInto`) | internal: a view that copies the hunter reads the old life | med |
| 82 | gm.js:97-98, 226-234, 315, 415, 449; table.js:34-35, 51, 137-139, 206, 548; reward-editor.js:39-43, 104-105, 183, 193; workshop.js:34; loot.js:175; forge.js:19 (HEAD); combat.js:58-59, 168, 181, 342 | 7 | about thirty calls of another module's api are wrapped to answer an empty list, null or false on any throw | a bug in effects, sync or inventory shows as an empty list or "no rewards", and nothing reaches the console | high |
| 83 | gates.js:86 | 4 | who fought a gate's last encounter is a closure `Map` | after a reload the Clear panel's boxes are not pre-checked | low |
| 84 | gates.js:176 | 3 | gates.js redraws its view through a function hung on the DOM node (`sec._render`) | nothing | low |
| 85 | gates.js:63-73 | 3 | a gate's fight starts, then the gate is marked in a second write | nothing seen | low |
| 86 | gm.js:455; gates.js:32 | 3 | roll tables and a gate's spawn use `Math.random` in views, outside `src/edge/roll.ts` | no test can seed them | low |

### Core (kinds 3, 4 and 5)

| # | Where | Kind | The hidden states or the rule | What a player or GM sees if it goes wrong | Sure |
|---|---|---|---|---|---|
| 87 | src/core/ids.ts:3-12; combat/ability-types.ts:13-23; save.ts:91-160 | 5 | two brand symbols; `hunterId()` and `combatantId()` brand any string; the save's ids (hunter, item, quest, title, shadow, log) and `SyncSettings.room`, `gmKey`, `deviceId` are plain `string`, so sync.ts parses the room again on each read | internal: one id passed where another is meant compiles | med |
| 88 | combat/effect-ops.ts:26; registry/statuses.ts:62 | 5 | two types named `StatusKey` (a brand, and `keyof STATUSES`) | nothing | low |
| 89 | hunter/imported.ts:33 | 5 | imported hunters are cast to `Hunter` and become valid only when the store's repair runs after the step | a step's result type is wrong until the repair | med |
| 90 | rules.ts:335 | 5 | `merge(base: any, ...)`: the GM's overrides are merged untyped | internal | low |

## Step 2: the judgment

Remedies: **machine** (a `TABLE` in core with a chart, as the others), **union** (a typed union in place of flags),
**step** (a pure core function with a test), **lint**, **delete**, **leave** (with the reason). The unit is the one
below that does it; "U4 after U11" means the view's half waits for that unit's core half.

| # | Remedy | Unit |
|---|---|---|
| 1 | delete `safe`: a `when` that throws is a bug, shown as a failed view, logged each time | U12 |
| 2 | delete the silence: an `update` that throws draws the failed panel as `mount` does, and warns each time | U12 |
| 3 | lint: a test reads `docs/dependency-map.md` and fails when a module's `register` reads the api of a module listed after it in `MODULES` | U12 |
| 4 | union: one answer, `ui.windowOpen()`, from the window stack; delete `modalOpen` and the `news` selector | U6 |
| 5 | union: each entry of the window stack is `queued`, `open` or `leaving` | U6 |
| 6 | delete two of three: one window stack in ui.js; the maker and onboarding open through it | U6 |
| 7 | step: a maker body answers `edited()`; Escape or the backdrop on an edited form asks "Discard changes?" | U6 |
| 8 | leave: a toast has one writer and nothing reads its state; a UI value, not a machine | none |
| 9 | delete the dynamic import: the sound setting comes from the app, as every view reads it | U12 |
| 10 | maker: scroll on the visual viewport's resize, not after 250 ms (U6); the store's flush: leave, it is a frame-aligned write, not "after that finishes" | U6 |
| 11 | step: "a save holds a hunter" is `repairSave`'s rule; `active()` only reads | U11 |
| 12 | machine: the store's life (`ready`, `readOnly`, `noStorage`) by its write (`clean`, `dirty`, `failing`); a read-only save refuses `apply` with its notice | U11 |
| 13 | step: combat.js `send` answers one step (the fight and its write-backs) for `store.apply` (U4); then the depth counter goes (U11) | U4, U11 |
| 14 | leave: ids reserved before a step are documented in notes-roundtrip; a gap in `seq` changes nothing | none |
| 15 | union: another tab's save is taken only when this tab is `clean`; else this tab turns read-only with a notice | U11 |
| 16 | step: a failed prefs write raises a notice as a failed save does | U11 |
| 17 | step: an applier that changes a hunter answers a step, run inside `once` with its id: one write or none | U1 |
| 18 | step: one core grant (`grant(save, hid, rewards, ids, at, R)`: points, title, job, build, skills, boons, statuses, gold, items, XP, the level-up refill) | U1 |
| 19 | machine: the outbox (`queued`, `sending`, `sent`, `refused`) in the save, flushed after each good poll; the senders post to it | U2, U3, U4, U10 |
| 20 | as 19: a use is posted; the toast says "sent when the room answers" | U3 |
| 21 | as 19: progress is posted and coalesced by quest id; delete the 1.5 s timer | U3 |
| 22 | as 19: a roll is posted; a roll the outbox drops says so; delete the try | U3 |
| 23 | union: a roll entry and a coin hold the hunter's id (`HunterId`), `who` stays the words | U14 |
| 24 | union: the roll's `kind` (`damage`, `heal`, `check`, `die`, `other`) is set where it is rolled; delete the regexes | U14 |
| 25 | step: the device token is made at load beside the device id (save.ts); the poll's `serverOk` and bind writes: leave, the link's bookkeeping with one writer | U11 |
| 26 | delete the fallback: `bound()` answers the bound hunter or none; deleting it is a link event that rebinds | U8 |
| 27 | union: `event<K>(type: K, body: PayloadOf<K>)` in `SyncApi` | U14 |
| 28 | delete the sleep: the outbox flushes on the link's `online` and after a poll | U2 |
| 29 | sw.js: a file that fails is counted as failed and the worker does not take over (U15); sync.ts's register: logged (U12) | U15, U12 |
| 30 | machine: the app update (`none`, `installing` with its count, `ready`, `reloading`, `stuck`), with upgrade.ts's decision as one of its events | U15 |
| 31 | union: a call answers `ok`, `offline`, `refused` (with the reason) or `server`; the views say which | U2 |
| 32 | step: one `roomLive(touched, now)` and one sweep for both stores | U7 |
| 33 | delete the fallback: with `DATABASE_URL` set and Postgres down the server does not start | U7 |
| 34 | delete `KICKS`: the `_kicked` doc's time is the one record; the 20 s refusal reads it | U7 |
| 35 | delete the old-client branch: a sheet write carries a token | U7 |
| 36 | union: the store takes `RoomCode` and `SheetKey`; rows are read through the protocol parsers | U7 |
| 37 | step: presence is swept with the room's expiry | U7 |
| 38 | step: `seatOf(settings, room)` in role.ts answers `alone`, `gm` or `player`; `app.seat()`; the twelve copies go | U13 |
| 39 | step: a row's extraction attempts are a field of the fight's row, set by a command with its cell in `TABLE`; delete the `Map` | U4 |
| 40 | step: `extractDc` in core shadows.ts, its floor in `RULES.shadow` | U4 |
| 41 | step: `settleEncounter(save, fight, choice, R)` answers the next save (gate paid, shares given, fight cleared) and what to tell (windows, posts); the view shows and applies it once | U4 |
| 42 | step: one `splitAward` in core for the fight's end and the gate's Clear | U4 |
| 43 | delete with 41 | U4 |
| 44 | union: `over: 'none', 'card' or 'tools'`, one writer; the Build drawer's state the same | U4 |
| 45 | leave: a refusal is news for the next doc; after a reload there is nothing left to explain | none |
| 46 | step order: the DELETE first, the fight's `remove` only when it was taken | U8 |
| 47 | machine: `choose(selection, event)` in map-view.ts (none, move, aim; events tap, pick, cancel, go, doubleTap, turnChanged, kitChanged), the picked ability inside the selection | U9 |
| 48 | machine: a gesture reducer in core (idle, maybe, pan, drag, pinch, paint; the hold timer is an event the view raises) | U9 |
| 49 | leave: caches of the last frame, rebuilt by any draw | none |
| 50 | union: `{ at: 'free' }` or `{ at: 'sent', from }`, released by a doc of another `at` or the outbox's refusal | U3 |
| 51 | step: feed rows are seen only while the feed is on screen in the combat view | U3 |
| 52 | step: device memory through the store (`store.device(name)`), so store.ts is the one module on storage (U11); table.js and gates.js adopt it after | U11, U3, U4 |
| 53 | step: a session counter in the save (`world.session`), `sessionStarted(save, at)` one step | U10 |
| 54 | step: `advanceDay` answers what it did; the log line says that; no try | U10 |
| 55 | leave: a hand-off to the next draw of one form; nothing is saved | none |
| 56 | delete: the link's last room `gone` and the key ring answer it | U10 |
| 57 | union: a target is `{ local: HunterId }` or `{ remote: SheetKey }` | U14 |
| 58 | step: `dueAt(hours, now)` in core quests.ts (U5); gm.js adopts it (U10) | U5, U10 |
| 59 | step: times compared as numbers in one core helper | U14 |
| 60 | leave: the tap that opens the uses is the act of seeing them | none |
| 61 | leave: a form field's dirty mark with one writer, a UI value | none |
| 62 | step: `nextReset(now, hour)` beside `dayKey(now, hour)` in one core module, from one rule, tested on both daylight-saving days | U5 |
| 63 | step: `dayKey` takes the time; no default | U5 |
| 64 | delete two clocks: one timer set for the next reset, and the page shown | U5 |
| 65 | step: `overdue(q, now)` in core; `reopenQuest` refuses an overdue urgent quest | U5 |
| 66 | step: the chain's level step runs in the same step as any level change (`addXp`, `atLevel`, a grant); delete the `level` listener | U1 |
| 67 | union: busy is read from `conn()`; the link drops the invite when it is live in that room; drawing writes nothing | U8 |
| 68 | delete: the link announces `sync:room` (from, to, role); custom.js listens to it | U8 |
| 69 | derived: the player's own build switches stay theirs; the room's build doc is laid over them in `rules()` while in the room; nothing is copied | U8 |
| 70 | delete the old-app branch | U3 |
| 71 | machine: onboarding's steps in core with a chart; `onboarded` set in one transition; started by an app `ready` event | U6 |
| 72 | step: the starter campaign is one core step; the seed hunter carries `seed: true` from its making | U6 |
| 73 | delete: the preview counts what `parseSave` answers; the old-format branches go | U11 |
| 74 | step: `keepGmKey(parsed, sync)` on the parsed save; no catch | U11 |
| 75 | step: the day's backup is the store's, at load | U11 |
| 76 | step: `codexDoc` in core, cut to `DOC_MAX`; delete the literal | U10 |
| 77 | step: the monster and its record in one step; one event | U10 |
| 78 | step: `checkResult(roll, dc)` in core | U14 |
| 79 | union: the roll entry holds its `dc` and `success` | U14 |
| 80 | delete the fallback die | U12 |
| 81 | leave: `writeInto` keeps held objects live by design (save-step.ts and its test); say so in the view lint's message | none |
| 82 | delete the wrappers; a throw reaches app.js's warning (row 2) | U12 |
| 83 | derived: who fought a gate is in the fight's end step's answer, kept on the gate | U4 |
| 84 | delete the expando: the view redraws on `change` | U4 |
| 85 | step: the gate's mark is part of the step that starts its fight | U4 |
| 86 | step: a seeded `pick` in roll.ts; views stop calling `Math.random` | U4, U10 |
| 87 | union: one `brand`; the save's ids branded at load; `SyncSettings` holds `RoomCode` and `DeviceId` | U14 |
| 88 | delete one `StatusKey` | U14 |
| 89 | step: each imported hunter is read by save.ts's hunter reader inside the step | U14 |
| 90 | union: `merge` typed over the rules | U14 |

### The units, in the order a player would notice them

"Files" are the files the unit may change; two units that share a file are in the "After" column. Each unit also
runs `bun run deps -- --write` and `bun run charts` when the recipe in AGENTS.md asks.

| Unit | Rows | What it makes, what it deletes | Files | Tests | After | Hours |
|---|---|---|---|---|---|---|
| U1 A reward lands whole | 17, 18, 66 | a core `grant` step; appliers that change a hunter answer steps run inside `once`; the chain hears levels in the level step. Deletes the empty `once` write, applyRewards' extra writes, the `level` listener | src/views/hunter.js, src/edge/room-events.ts, src/edge/sync.ts (`firstTime`, `once` only), src/core/rewards.ts, src/core/hunter/progress.ts, src/core/hunter/job-chain.ts, src/views/quests.js (line 158) | tests/rewards.test.ts, tests/applied.test.ts, tests/job-chain.test.ts, tests/e2e/reward-room.e2e.ts | none | 3 |
| U2 The outbox | 19, 28, 31 | machine `src/core/sync/outbox.ts` with its chart, the save's `settings.sync.outbox`, `sync.post`; the tombstone queue becomes an outbox kind. Deletes forget-queue.ts and core/sync/forget.ts, `quietCall`'s null | src/core/sync/outbox.ts (new), src/core/save.ts, src/edge/sync.ts, src/edge/forget-queue.ts, src/core/sync/forget.ts, src/core/sync/connection.ts, src/edge/room-pill.ts, src/core/api.ts, scripts/charts/outbox.ts (new), scripts/statecharts.ts, tests/models/room-world.ts | tests/outbox.test.ts (new), tests/forget.test.ts, tests/room-system-model.test.ts, tests/statecharts.test.ts | U1 | 4 |
| U3 Players' sends | 20, 21, 22, 50, 51, 70 | uses, items, skills, quest progress, rolls and coins post to the outbox; the HUD's wait is a union; feed rows seen only on screen. Deletes the 1.5 s timer, coin.js's `unsent`, the feed's swallowing try, the old-app branch | src/views/uses.js, src/views/inventory.js, src/views/skills.js, src/views/quests.js, src/views/table.js, src/views/coin.js, src/views/custom.js | tests/e2e/used.e2e.ts, tests/e2e/coin.e2e.ts, tests/e2e/room-sync-fixes.e2e.ts (a use made offline reaches the GM after the room is back) | U2, U1 | 3 |
| U4 A fight's end and a gate's Clear | 13, 39-44, 83-86 | `settleEncounter`, `splitAward`, `extractDc`, a row's attempts in the fight, one step per `send`, the screen's `over` union. Deletes `ending`, `tried`, `fought`, `_render`, both split copies, the view's DC | src/views/combat.js, src/views/gates.js, src/views/shadows.js, src/core/gates/world.ts, src/core/hunter/shadows.ts, src/core/combat/fight.ts, src/core/combat/fight-types.ts, src/core/combat/fight-parse.ts, src/edge/roll.ts, tests/models/fight-play.ts, scripts/charts/fight.ts | tests/world.test.ts, tests/fight.test.ts, tests/shadows.test.ts, tests/e2e/combat-turns.e2e.ts, tests/e2e/gates-quests-dailies.e2e.ts | U2 | 4 |
| U5 The day's clock | 58 (core), 62-65 | one module for the day (`dayKey`, `nextReset`, `dueAt`, `overdue`), one timer. Deletes the view's `nextReset`, two clocks, the view's reopen rule | src/core/day.ts (new), src/core/rules.ts, src/core/hunter/quests.ts, src/views/quests.js, src/edge/store.ts (import only) | tests/day.test.ts (new: both daylight-saving days, reset hours 0 and 4), tests/quests.test.ts, tests/e2e/gates-quests-dailies.e2e.ts | U3 | 2 |
| U6 Windows, makers, onboarding | 4-7, 10, 71, 72 | one window stack with a union per window and `ui.windowOpen()`; a maker's `edited()` and the discard question; onboarding's machine and chart; the starter as one step. Deletes the maker's and onboarding's own traps, `modalOpen` | src/views/ui.js, src/views/maker.js, src/views/onboard.js, src/views/starter.js, src/app.js (`modalOpen` only), src/core/onboarding.ts (new), src/core/starter.ts (new), scripts/charts/onboarding.ts (new) | tests/e2e/makers.e2e.ts (a backdrop press on an edited form asks first), tests/e2e/room-onboarding.e2e.ts, tests/e2e/feel.e2e.ts, tests/onboarding.test.ts (new) | the kits helper's maker.js work | 4 |
| U7 The room server | 32-37 | one room expiry rule and sweep; no memory fallback under `DATABASE_URL`; one record of a removal; tokens required; typed store | server.ts | tests/server-rooms.test.ts, tests/server-handshake.test.ts | none | 2 |
| U8 The room view and the room's build | 26, 46, 67-69 | `sync:room` from the link; `bound()` without fallback; the room's build doc laid over the player's rules; Remove after the DELETE. Deletes `wasRoom`, `wasGM`, `S.busy`, the copied switches | src/edge/sync.ts, src/core/events.ts, src/views/room.js, src/views/custom.js, src/edge/rules.ts, src/core/hunter/build.ts | tests/build.test.ts, tests/link.test.ts, tests/e2e/room-sync-fixes.e2e.ts, tests/e2e/customization.e2e.ts | U2, U3 | 3 |
| U9 The map's choice and gestures | 47, 48 | two machines in core with charts. Deletes `picked`, `before`, `quiet`, the gesture branches in map.js | src/views/map.js, src/core/combat/map-view.ts, src/core/combat/gesture.ts (new), scripts/charts/ (two new) | tests/map-view.test.ts, tests/gesture.test.ts (new), tests/e2e/battle-map.e2e.ts, tests/e2e/feel.e2e.ts | none | 4 |
| U10 The GM view and the codex | 53, 54, 56, 58 (gm.js), 76, 77, 86 (gm.js), GM sends of 19 | a session counter, `advanceDay`'s answer, `codexDoc` in core, the GM's sends posted. Deletes `deadRooms`, the log parse, the 15500 literal | src/views/gm.js, src/views/bestiary.js, src/core/session-log.ts, src/core/bestiary.ts, src/core/save.ts (field `world.session`) | tests/world.test.ts (session), tests/bestiary.test.ts, tests/e2e/gates-quests-dailies.e2e.ts | U2, U4, U5, the kits helper's bestiary.js work | 3 |
| U11 The store | 11, 12, 15, 16, 25, 52 (store), 73-75, 13 (store) | the store's machine with its chart; `store.device(name)`; the preview from `parseSave`; the day's backup at load. Deletes the write in `active()`, `depth`, the preview's old formats | src/edge/store.ts, src/core/store-life.ts (new), src/core/save.ts, src/views/io.js, scripts/charts/store.ts (new) | tests/store-life.test.ts (new), tests/save.test.ts, tests/e2e/save.e2e.ts | U2, U4, U10 | 3 |
| U12 Swallowed errors | 1-3, 9, 29 (sync.ts), 80, 82 | Deletes `safe`, about thirty api wrappers, the fallback die, the dynamic import; adds the registration-order test | src/app.js, src/views/ui.js, and the wrapper lines in gm.js, table.js, reward-editor.js, workshop.js, loot.js, forge.js, combat.js, hunter.js, src/edge/sync.ts | tests/lint.test.ts, tests/deps.test.ts | all of U1 to U11 (a sweep) | 3 |
| U13 The seat | 38 | `seatOf` in role.ts, `app.seat()`. Deletes twelve copies | src/core/role.ts, src/app.js, src/views/app.ts, the twelve call sites | tests/role.test.ts, tests/lint.test.ts | U12 (a sweep) | 2 |
| U14 Ids and kinds | 23, 24, 27, 57, 59, 78, 79, 87-90 | one brand, branded save ids, a typed `event`, a roll's hunter id, `kind`, `dc` and `success`, `checkResult`. Deletes the label regexes, the name lookups, one `StatusKey` | src/core/ids.ts, src/core/combat/ability-types.ts, src/core/save.ts, src/core/api.ts, src/core/combat/effect-ops.ts, src/core/registry/statuses.ts, src/core/hunter/imported.ts, src/core/rules.ts, src/core/coin.ts, src/views/dice.js, src/views/table.js, src/views/coin.js, src/views/gm.js | tests/save.test.ts, tests/coin.test.ts, tests/check.test.ts (new), the typecheck | U13 (a sweep) | 4 |
| U15 The app update | 29 (sw.js), 30 | machine `src/core/update.ts` with its chart, joining `decideUpgrade`; a failed shell file stops the takeover | src/sw.js, src/edge/upgrade.ts, src/core/upgrade.ts, src/edge/room-pill.ts, scripts/charts/update.ts (new) | tests/upgrade.test.ts, tests/statecharts.test.ts | U2 (room-pill.ts) | 2 |

Lanes that can run side by side from the start: U1, U7 and U9. Then U2; then U3, U4 and U15 together (no shared
file); then U5 and U8; then U6 (after the kits helper), U10 and U11; then the three sweeps U12, U13, U14 one after
another.

### The lint tests that keep each class from coming back

Each goes in `tests/lint.test.ts` with the old line it would have caught as its first case, as the others do.

- Kind 1. A register-level or module-level `let` in `src/views` is named in an allowed list per file with its reason,
  as sync.ts's state is today; a new one fails. Two `let` booleans declared together fail outright.
- Kind 2. A view calls `sync.post`, never `sync.send` (after U3, U4, U10). A window with `aria-modal` or a focus trap
  is made only in `src/views/ui.js` (after U6).
- Kind 3. No view line names both `isGM(` and `room(` (after U13). `Math.random` only in `src/edge/roll.ts` (after
  U4, U10). A number of four or more digits in `src/views` is an allowed bound or a rule (row 76's class).
- Kind 4. `localStorage` and `sessionStorage` only in `src/edge/store.ts`, `src/edge/sync.ts` (the invite) and
  `src/edge/upgrade.ts` (after U11).
- Kind 5. No `.find(... .name ===` over hunters in `src`; no `as never` outside a core table's dispatch; no `any` in
  `src/core` and `src/edge`.
- Kind 6. The body of a view's `render`, `paint*`, `draw` or `update` holds no `store.apply`, `setPrefs`,
  `dropInvite` or storage write (the brace matching of the `vitalsEdit` lint).
- Kind 7. No empty `catch` and no `catch { return ... }` in `src/views`, `src/edge`, `src/sw.js` and `server.ts`,
  except a list naming the browser call each guards (storage, clipboard, `navigator.share`, `setPointerCapture`,
  `vibrate`, audio).
- Kind 8. No `setTimeout` in `src/views` outside `motion.ts` and a named list (the toast's life, a typed code's
  check); the edge's timers are the machines' (`setTimer` effects).
