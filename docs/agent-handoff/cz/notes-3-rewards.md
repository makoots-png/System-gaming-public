# Notes: unit 3, rewards, boons, bundles, and telling the GM when one is used

Principles read: model the domain, boundary discipline, make operations idempotent, migrate callers then delete, test behaviour, explain the number, unslop.

## Step 1: parseRewards

- Home: a new `src/core/rewards.ts` (`Rewards`, `newRewards`, `REWARD_BOUNDS`, `parseRewards`, `titleReward`, `rewardLines`, `isEmptyReward`). save.ts re-exports `Rewards` and `newRewards`, as it does the item enums. It could not sit beside `Rewards` in save.ts: it needs `parseSkill` and `parseItem`, whose files import save.ts's types.
- `parseRewards` follows `parseItem`: a non-object is refused, any other wrong field takes the empty reward's value. XP and gold a billion either way, points 999 either way (the room bounds `givenRewards` had), items through `parseItem` (20), skills through `parseSkill` without `perk` (8), statuses with a status key that is not a state chip, rounds 1 to 999 or null, a def through `sanitizeDef` (8), boons with a name 60 and text 200 (8), a title with a name 60, description 200, the nine bonus keys inside 999, a job 60 trimmed (blank is null).
- `Rewards.skills` is `SkillTemplate[]` (the design wrote `Skill[]`): the parser answers a skill without its id, as with items.
- Migrated and deleted: `givenRewards` (protocol.ts), `cleanRewards` and the quest card's own `rewardLines` (quests.js), the save repair's reward lines. The save's quest repair (`questRewards`) turns an older `titleName` into the title the save's rules give that name, then runs `parseRewards`. room-events.ts's quest window and quests.js's card share `rewardLines` (core).
- `titleName` is gone: the Award form (`gm.js`) and the quest form build the title with `titleReward(rules, name)` (a built-in title brings its description and bonus); `applyRewards` takes the title as carried. The quest form keeps a title's bonus when its name is unchanged, and keeps the skills, statuses and boons it does not show. starter.js's Survivor is a title object.
- The quest form keeps its floor of 0 on XP, points and gold by clamping its inputs (`formRewards`). No test pinned it; it is the form's old behaviour. The Award form and the GM's Issue quest build rewards with `newRewards()`.
- `Item.tell?: true`, kept by `parseItem` only when true (step 1, since reward items go through `parseItem`), with a case in tests/items.test.ts.
- Changed expectations: protocol, an award amount that is not a number now reads as 0 (was refused); `newEvent` with `rewards: 'lots'` is the refused body (was `xp: 'lots'`). server-rooms, the refused award is one whose rewards are not an object. save, the fixtures' quests read back through `currentQuests`; a quest reward's unknown key (`fame`) is dropped (moved into its own test). job-chain, penalty: the reward literal has the new fields.
- Tests: tests/rewards.test.ts (round trip, the daily template's rewards unchanged, hostile input, every bound, a title by name, the words); save (titleName migrates, a quest's rewards through the parser).
- Commit 1: step 1.

## Step 2: applyRewards gives the new fields

- `Boon` (`id`, `name`, `text`, `at`) and `hunters[].boons` in save.ts, with `newBoon` and `LIMITS.boons` 50. The repair drops a boon without a name, cuts name 60 and text 200, and keeps the newest 50 (a new boon is added last, so the oldest go). Ids take the prefix `bn`. A sheet's `boons` list is cut to 100 like the others (`SHEET_LISTS`).
- `applyRewards` (hunter.js), in its one update: the title as carried (`giveTitle` with the object: a hunter with a title of that name keeps its own); each skill through `parseSkill`, replacing a skill of the same name (not the path skill) and keeping its id, else added with a new id; each status through `addC` (the hunter's `applyStatus` path) with `gmSource(h.rank)`; each boon with a new id and the time. The reward window lists "Skill acquired", "Status" (with its rounds) and "Boon" lines after the title and job.
- The title is added, not set active, as before. The browser test sets it active to see the +2 STR count.
- The Titles panel lists the hunter's boons under "Boons" (Redeem comes in step 5).
- Browser: `tests/e2e/rewards.e2e.ts`, the GM's award sent through `app.api.sync.send` (the test's name says so): the window's four lines, then the sheet shows "+2 STR" on the title, the skill, the "Hasted · 3r" chip and the boon. 1 passed, first run.
- Words in copy-tasks.md (new section for unit 3).
- Commit 2: step 2.

## Step 3: bundles

- `RewardBundle` (`id`, `name`, `rewards`) and `parseBundle` in rewards.ts; `library.rewards` in save.ts, at most 200 (`LIMITS.libraryRewards`), a name of 60 required, each `rewards` through `parseRewards`, ids with the prefix `rb` through `refill` as items and skills.
- `app.api.bundles` (`list`, `save`, `remove`; `BundlesApi` in api.ts) is registered in hunter.js, which owns `applyRewards`. `save` replaces a bundle of the same name.
- Callers in gm.js's Award form: a plain "Bundle" select fills XP, gold, points and the title, and keeps the bundle's other parts (more items, skills, statuses, boons, a job), listed under it as "Also gives: ...". "Save as bundle" asks a name and saves what the form holds; "Delete bundle" (shown while one is picked) removes it, so `remove` has a caller (the deps test requires one).
- Decided by the helper: the Award form builds its reward with one `formReward()` (fields over the picked bundle) used by both Send and Save; a bundle's title keeps its bonus while its name is unchanged in the field. The award's log line now lists `rewardLines`.
- Tests: save (bundles kept, a nameless one dropped, a repeated id replaced, rewards through the parser, the cap); browser, `tests/e2e/rewards.e2e.ts` "the GM saves the Award form as a bundle...": save through the prompt, pick a bundle with a boon (fields fill, "Also gives" line), award it to Brakk (gold and boon arrive). 2 passed, first run.
- Commit 3: step 3.

## Step 4: the used message

- `used` in protocol.ts: `{ by, who, what: 'item' | 'skill' | 'boon', name, text, target: 'self' | 'other', outcomes, tell }`. Not GM-only, `ownSheet`, applier `null` on a player's phone (room-events.ts). Bounds: who and name 60 (name required, not blank), text 200, at most 8 outcomes (`MAX_OUTCOMES`), each read by `parseOutcome`; a target and a tell left out are self and false.
- Decided by the helper: the payload has `who`, the hunter's name (60), beyond the design's shape, so the GM's log line names the hunter even when that phone's sheet is not on the GM's board yet. `questUpdate` and `roll` carry the name the same way (their `name`).
- `parseOutcome` in `src/core/combat/use.ts` (`OUTCOME_BOUNDS`): damage, heal and MP whole 0 to 99,999 (`MAX_HP` of a room message), fatigue -100 to 100, a status or cure with a key `STATUS_KEY_RE` accepts, rounds 1 to 999 or null, a def through `sanitizeDef` (left out when unreadable), a note's text trimmed to 120. Anything else is null.
- The server's "the sender owns this sheet" line is now the `ownSheet` flag in `DEFS`, exposed on `EVENTS` and read through `speaksFor(event)` (protocol.ts), which answers the event's `by` for an `ownSheet` type. `roll`, `questUpdate` and `used` set it.
- Tests: protocol (`VALID.used` with one outcome of each kind, nine message types, the `ownSheet` list and `speaksFor`, each bound of `used` and of an outcome); server-rooms (`used` sent by its own phone is taken, and roll, questUpdate and used from a phone that does not hold the sheet are refused with the room unchanged).
- Commit 4: step 4.

## Step 5: a player's phone sends used

- A new view module `src/views/uses.js` owns a use reaching the GM, `app.api.uses.report(hid, use)` (`UsesApi`, `UseReport` in api.ts; listed in `MODULES`). A player's phone in a room sends `used` for a told use or one on another; any other phone (out of a room, or the GM's own phone) writes a told use to its own session log (kind `use`, step 6's words from `usedLine` in use.ts). Decided by the helper: a module of its own rather than spreading the send over inventory.js, skills.js and hunter.js.
- Inventory Use (and the Table kit, which calls it):
  - An item with `target: 'other'` and use effects never touches its user. On the GM's phone with the hunter up in a running fight, `combat.useItem` (new, combat.js) asks for the target with the card's picker and sends `use`. Anywhere else one leaves the bag, its outcomes are rolled at its rarity's tier with `outcomesUnseen` (new, use.ts: `outcomesOf`, except that a percent or a full heal, which need the target's max HP, is a note in words), the toast says them, and `report` sends them (a player in a room) or logs them when told.
  - An item with `tell` used on oneself rolls its outcomes once with `outcomesOf`, applies them through `applyOps` as fixed amounts (`outcomeOp`, new, use.ts), and reports the same outcomes, so the GM reads the numbers the sheet got.
- The Skills panel's Use (and the Table kit) for an `other` skill with effects: the toast as before (now from `outcomesUnseen`), and `report` sends them to the GM (tell false).
- Boons: a "Redeem" button on each boon in the Titles panel, a confirm, the boon leaves the hunter, a toast, and `report` with `tell: true`.
- Deleted: `sendItemRoll` and its name-and-description heal regex (inventory.js), the skill-name matching and the skill's description in table.js's roll feed, and the `kind` field of `roll` with `ROLL_KINDS` (protocol.ts). A roll still goes out for every dice roll a player makes, as before: `skills.pay` rolls a skill's `dice` through `app.api.dice.roll`, which emits `roll`, and table.js sends it with the dice view's label; `dmg` is now read from that label alone ("damage", "attack", "strike", not a heal word). A skill's own dice thus still reach the Table feed as a plain roll.
- An item that targets its user and has a damage op (none of the built-ins) no longer sends a feed row; its user's toast still says "Deal N".
- Changed expectations: protocol, the roll payload has no `kind`; a `kind` field is dropped (was: an unknown kind refused).
- Tests: use.test.ts (`outcomesUnseen`); browser, custom-skills.e2e.ts: a bomb from the bag in a running fight asks the GM for the target and the goblin loses 5 HP; with no fight and no room the toast says "On the target: 5 damage, Blinded (1 round)." and Brakk is unchanged but for one bomb. character and custom-skills: 24 passed.
- Commit 5: step 5.

## Step 6: the GM's phone receives it

- How the GM's phone kept `questUpdate` from being written twice: only the poll cursor. The link saves the new cursor in the same step that hands the page's events to the views (`saves` comes before `apply` in `reduce`, and the store writes synchronously), so a reload or a repeated poll does not hand an event over again. Nothing is keyed by the event id: a `used` POSTed twice (the server keeps both copies under new seqs), or a save restored with an older cursor, would write the line again. So the `used` line is keyed by its event id in the ring `src/core/applied.ts` owns (`settings.sync.applied`): `app.api.sync.once(eid, write)` (new, sync.ts) records the id and runs the write in one store update, and does nothing (no update) when the id is in the ring. sync.ts's own `firstTime` for a player's appliers is now `once(eid, () => {})`. `questUpdate` is left on the cursor alone.
- `uses.js` on the GM's phone, on `sync:event` of a `used` with `tell`: one session log line of the new kind `use` (`LOG_KINDS` in save.ts; gm.js now reads `LOG_KINDS` from save.ts for the Session log's Kind filter instead of its own copy), "Mira used Boon: Free resurrection" with the text and the outcomes (`usedLine`, use.ts), and a toast. `hunterId` is null: the hunter is on another phone.
- table.js's Table feed: a row for every `used` (told or not), "Mira used Item: Flash Bomb · 5 damage". For `target: 'other'` with outcomes and a fight with anyone up, "Apply to…" opens a list of the fight's combatants; the pick goes to `combat.applyUse(key, on, name, outcomes)` (new, combat.js), which sends `use` with `by` the player's card. It answers false when the player has no card in the running fight, and the feed toasts "Mira is not in the fight." The row then says "Applied" (kept in the feed's sessionStorage as before).
- Solo: step 5's `report` writes the same line on the phone that used it.
- Tests: use.test.ts (`usedLine`, `outcomeOp` and that its ops give back the same outcomes without a roll); browser, `tests/e2e/used.e2e.ts`: a player redeems a boon, the GM gets the toast and one Session log line (Kind "use"), then the GM's cursor is set back to 0 and the page reloaded: the replayed event writes nothing more; a player in the GM's fight throws a bomb from the bag (their HP unchanged), the feed row's Apply to picks the rat, the rat loses 5 HP and the row says Applied; out of a room a redeemed boon is in the phone's own log. 3 passed, first run.
- Commit 6: step 6.

## Step 7: the room model

- `tests/models/room-world.ts`: a player move `use` (enabled while the player is live) posts a told `used` the way sync.ts `send` does, on the lane of requests outside the machines (never aborted; `dup` posts it twice, as a resend would). The GM's `apply` runs `tellOne`, a copy of uses.js's handler with sync.ts `once`: the line is written only when the event id goes into the applied ring, in the same write. Each phone counts its lines per event id in `told` (part of the save, so a reload keeps it). The server-took-a-GM-only-request check lets `event used` from a player through.
- `tests/room-system-model.test.ts`: after every move, no told use is in a session log twice; after quiet, every told use in the GM's room after the seq the GM entered it at is in the GM's log exactly once. A fixed sequence: the player posts it twice (`dup`), the GM polls, reloads and polls again: one line.
- Broke the guard by hand (the model's `tellOne` wrote the line without checking the ring): the fixed sequence failed and the exhaustive walk failed with "the told use ... is in gm's session log 2 times" (the 2000 random walks did not find it). Restored; 7 pass.
- Commit 7: step 7.

## Step 8: notifications

- `src/edge/notify.ts`, the one module that touches the Notification API: `notifyState` (granted, denied, default, unsupported), `notifying`, `askToNotify` (`Notification.requestPermission`), `notifyHidden(title, body, tag)`, which asks the service worker's registration to `showNotification` only when the page is hidden and permission is granted, tagged with the event id so a repeat replaces it.
- uses.js, after the once-guard wrote the log line on the GM's phone: `notifyHidden` with the log line's words. So a notification is asked for at most once per event id too.
- src/sw.js: a `notificationclick` handler closes the notification and focuses an open window of the app, else opens one.
- The GM view's Session log section: "Notify me when a player uses a reward" calls `askToNotify` and shows the state beside it. Decided by the helper: the button stays shown when granted (tapping it again asks nothing new); it hides only where the browser has no notifications.
- The hidden poll: `HIDDEN_POLL_MS` (30 s) and `hiddenWait(link, ms, notifying)` in src/core/sync/link.ts, beside `POLL_MS` and `POLL_WAITS`. A GM in a live room with notifications granted gets `max(ms, 30 s)`; anything else gets null (no poll until `visible`). sync.ts `setTimer` uses it for a poll timer set while hidden, and asks it again when the timer fires on a hidden page. No new state in sync.ts. Tests in tests/link.test.ts. The link chart's note says it (`bun run charts` rewrote docs/state-machines.md).
- Why 30 s: one poll is one small request, and browsers slow a hidden page's timers to about one a minute anyway; the number is the design's, not measured. A locked phone gets nothing until it is opened, when the feed and the log catch up. There is no push service.
- Browser, tests/e2e/used.e2e.ts: the GM's context grants notifications, the GM taps the button (state "On:"), `ServiceWorkerRegistration.prototype.showNotification` is stubbed to record and the page's `visibilityState` reads hidden (a `visibilitychange` dispatched; no existing test did this). The player redeems a boon: the GM's hidden page polls (the 30 s rule; its first wait was set while visible) and asks for one notification, "Mira Test used Boon: Free resurrection", tagged with the event id. Without permission, the page hidden and an `online` event to make it poll: the log line appears and nothing is asked for. 2 passed after one fix (the button had been hidden once granted).
- Commit 8: step 8.

## Step 9: the chain message

- `chain` in protocol.ts: `{ to, job, kind: 'issue' | 'reissue' | 'abandon' }`, GM-only, `job` read by `isJobName` (anything else refuses the message), `to` 1 to 24 sheet keys.
- Applier `once: true` (room-events.ts): `chainFromGM(hid, job, kind)` (new in `ApplyDeps`, filled by sync.ts from `quests.chainFromGM`, typed in `QuestsApi`). `issue` runs `quests.issueJobChain` and shows a window; `reissue` and `abandon` raise the chain machine's `reissued` and `abandoned` events with `by: 'gm'` (the server took the message only from the GM's key), and a toast. The machine refuses what does not apply (a second chain, a reissue of a chain that has not failed): nothing happens then.
- quests.js: `pickChain` lists the GM's remote sheets after the phone's hunters ("NAME (player)") and sends `chain` for one (`sendChain`). Decided by the helper: a player's failed chain shows in the GM's Party quests (read from the sheet's `jobChain`) with Reissue and Abandon, which send `chain` with that kind, so the two kinds have a sender.
- Tests: protocol (`VALID.chain`, the ten message types, GM-only list, a job the table lacks or in the wrong case, a kind, the `to` bounds); server-rooms (a player's valid `chain` is refused as GM-only, the room unchanged; `chain` in the GM-only loop); the room model (a GM move `gm chain p1`, applied through the real applier and ring; the convergence rule checks it took effect exactly once like `award` and `status`); browser, rewards.e2e.ts: the GM issues Ranger to the player's hunter from the Quests view, the player sees the window and step 1's card in Quests. 1 passed, first run.
- Commit 9: step 9.

## Step 10: checks and AGENTS.md

- `bun run test`: 1627 pass, 0 fail. `bun run deps -- --write` and `bun run charts` left their files as the earlier commits wrote them.
- Browser files from the brief's grep (character, custom-skills, customization, gates-quests-dailies, rewards, room-onboarding, room-sync-fixes, room-sync, room-view, save, table-session, upgrade, used), one run: 108 passed, 0 failed (15.3 min), no pause seen.
- AGENTS.md: "Where things live" rows for what a reward may hold (`parseRewards`, `applyRewards`, `app.api.bundles`) and a use reaching the GM (`uses.js`, `used`, the log kind, `sync.once`, the Table feed, `notify.ts`, `hiddenWait`); the room-message recipe names `ownSheet`; the saved-field recipe says where a reward field goes.
- Process: in step 5, to keep `sync.once` out of that commit (the deps test fails on an API member with no caller), I restored my own uncommitted edit of sync.ts with `git checkout -- src/edge/sync.ts` and wrote it again in step 6. Nothing else was touched.
- Commit 10: step 10.

## Decided by the helper

- `parseRewards` lives in a new `src/core/rewards.ts`; `Rewards.skills` is `SkillTemplate[]`.
- An award amount that is not a number reads as 0 (the parsers' style), where the room used to refuse it.
- An old quest reward's `titleName` becomes a title with the save's rules' description and bonus at load.
- The quest form keeps its floor of 0 by clamping its inputs; the Award form and Issue quest do not floor (a GM may take away).
- A reward skill never carries `perk`; a skill of the same name replaces the hunter's (not the path skill) and keeps its id.
- The bundle API lives on hunter.js (`app.api.bundles`); the Award form gained "Delete bundle" so `remove` has a caller.
- `used` carries `who`, the hunter's name.
- A new view module `uses.js` owns reporting a use and the GM's log line, toast and notification.
- A told self item rolls its outcomes once, applies them as fixed amounts and reports the same numbers.
- `outcomesUnseen`: what needs the target's max HP (a percent, a full heal) is a note in words.
- The roll message lost its `kind`; `dmg` is read from the roll's label alone.
- The GM's once-guard is the applied ring through `app.api.sync.once`; `questUpdate` stays on the cursor alone.
- The notify button stays shown once granted.
- A player's failed chain shows in the GM's Party quests with Reissue and Abandon.

## Unsure

- `questUpdate` is still guarded only by the cursor: a duplicated post or a restored backup writes its log line twice. Moving it to `sync.once` is one line, but its progress updates would share the 200-id ring with `used`.
- An item that targets its user and has a damage op no longer sends a feed row (none of the built-ins has one).
- A GM's hidden page polls on the first 5 s timer after it hides, then every 30 s; browsers may slow it further.
- The applied ring is 200 ids; a GM who receives more than 200 told uses between a replay's two copies would log one twice. The replays the room produces come seconds apart.
