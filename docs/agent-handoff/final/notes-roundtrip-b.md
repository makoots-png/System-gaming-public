# Notes: every save write a named core function, Helper B

Helper B of `brief-explicit.md` (widening `brief-roundtrip.md`), in the worktree
`/home/user/systemgaming/.claude/worktrees/agent-afaaa04af7623366e`, branch `worktree-agent-afaaa04af7623366e`, off
`0caeeef` (`claude/zen-pasteur-ov4cgd`). Views: `custom.js`, `quests.js`, `gates.js`, `bestiary.js`, `workshop.js`,
`forge.js`, `loot.js`, `reward-editor.js`, `map-maker.js`, `coin.js`, `io.js`, `onboard.js`, `room.js`, `table.js`,
`combat.js` (outside `send`), and any other view not on A's list.

## Log

- 15:00 started. `0caeeef` merged by fast-forward, `bun install`. A had not yet committed the store's apply form, so
  the round-trip table and the core functions come first.

## Writes counted at the start (store.update callbacks in my views)

| View | Calls | Notes |
|---|---|---|
| custom.js | 14 | identity, sound, loadouts (save, overwrite, rename, remove, swap), build (path, pick, respec, auto), build rule overrides (set, reset, room follow) |
| quests.js | 10 | issue, chain step, GM log of a player's update, delete, complete, fail, daily check, edit, progress, reopen |
| gates.js | 9 | spawn, advance day, encounter, enter, clear, world merge, close, delete, edit |
| bestiary.js | 7 | combatant ids (no write but `seq`), save monster, codex record, codex from room, codex merge, remove |
| workshop.js | 5 | status dup and delete, item delete, skill delete, dup of a list entry |
| coin.js | 5 | coin rolled, landed, called, GM's call taken, GM's ruling |
| io.js | 3 | pack merge, hunters added to the party, settings (reset hour, sound, hunter name) |
| onboard.js | 3 | decanon, onboarded, GM mode |
| combat.js | 3 | `send` (out of scope but has `shadowHp`), refusal republish (no write), encounter end (gate paid, log) |
| map-maker.js | 2 | save map, remove map |
| forge.js | 1 | save status |
| loot.js | 1 | save item |
| reward-editor.js, room.js, table.js, rulesref.js, map.js, ui.js, maker.js | 0 | no store write |

Total: 63.

## The apply form (A's, merged at 774ca63)

`store.apply(reason, step)` with `step: Save => Save | Refused` (src/core/save-step.ts), aimed with `atHunter`,
`atLibrary`, `atSettings`. My views use it as is. A step that needs a new id gets it from `store.id` before the step
runs (outside it), or from the save's `seq` inside core (`told` in session-log.ts takes a log line's id from `seq`,
as `store.id('l')` did). A step that answers more than the save (the broken gates of a day advance, a pack merge's
report) writes it to a variable of the view inside the step; the step's result is still only the next save.

## New core modules (Helper B)

| Module | Owns | Test |
|---|---|---|
| `src/core/library.ts` | the library's statuses, items, skills, maps: save by name or id, duplicate, delete, at their caps | `tests/library.test.ts` |
| `src/core/session-log.ts` | the session log: `told(save, stamp, ...lines)` | `tests/world.test.ts` ("the session log") |
| `src/core/gates/world.ts` | the world day and the gates list: spawn, advance, enter, fight start, close, delete, edit, Clear, merge, a fight's end | `tests/world.test.ts` |
| `src/core/coin.ts` (grown) | the save's `coins` and `calls` as steps | `tests/coin.test.ts` ("the save's coins and calls") |
| `src/core/settings.ts` | mode, onboarded, sound, reset hour | `tests/identity.test.ts` |
| `src/core/hunter/identity.ts` | name, emblem and colour, the neutral seed | `tests/identity.test.ts` |
| `src/core/hunter/imported.ts` | hunters added from a file, re-ided | `tests/identity.test.ts` |

For A: `session-log.ts` (`told`), `library.ts` (`saveNamed` is the skills maker's rule too) and `identity.ts`
(`renamed`, the sheet's rename rule) are there for hunter.js, skills.js, gm.js, uses.js and dice.js to use, so the
log, the library and a hunter's name each keep one writer.

## Findings so far

1. **A status or item made past the library's cap vanished.** The item maker at 200 library items closed as if it
   had saved and stored nothing; the status maker stored the 201st status and the next repair dropped it. Now the
   maker says "The library holds 200 ... at most" and stays open. Commit 89e7d33.
2. **Two rules for a hunter's name.** The sheet's rename collapsed runs of spaces, the Data view's did not. Both now
   go through `renamed` (identity.ts) once A converts hunter.js; the Data view's in 053ac14.
3. **Saving a monster would have recursed forever** (caught by `makers.e2e.ts` before commit of the next view, fixed in
   78a8851): my first bestiary commit imported core `saveMonster` while the view kept a function of the same name.
   Not in any commit a player ran; listed because the browser file, not the bun tests, caught it.
4. **An empty save write to publish a refusal.** combat.js wrote an empty `store.update(() => {})` so the room's fight
   doc would carry a player's refused tap. sync.ts already republishes after every poll's events, which is the only
   path that calls `turnDown`. Removed (bb6c081); `battle-map.e2e.ts` "It is not your turn." still passes.
5. **A player's reward and penalty on a quest were kept out only by a hidden field.** The quest form sent the GM's
   reward and penalty only when `app.isGM()`; core took whatever it was given. Now `questOf` gives a `self` quest no
   reward and no penalty, and `editQuest(h, qid, e, role)` keeps a quest's reward and penalty on a player's edit
   (36ec445). A player would have seen nothing different; a changed view could have let a player pay themselves.
6. **A respec was two writes.** A player's paid respec took the gold (inventory's `addGold`, one update, one store and
   one announce) and then cleared the build (a second). Both ran in the same task, so no player saw half of it; it is
   now one step that pays and clears together (`respec` in build.ts, 97c539d), so the rule cannot drift apart.

## Round trips (brief-roundtrip step 2), my views

Each case does then undoes on the core function and compares the whole value. Where the undo is not the identity the
difference is stated and asserted.

| Pair | Do (file:line) | Undo (file:line) | Case | Result |
|---|---|---|---|---|
| Workshop Duplicate / Delete | workshop.js:170 `dup` | workshop.js:125, 135 (item, skill), map-maker.js:198 | library.test.ts "a duplicate then its delete" | identity |
| A maker's Save / Workshop Delete | loot.js:168, forge.js:31, map-maker.js:173 | workshop.js:115, 125; map-maker.js:198 | library.test.ts "a saved new entry then its delete", "saved under a key, then deleted" | identity |
| Pack merged with Replace twice | io.js:124 | (the second merge) | pack.test.ts "the same pack replaced twice changes nothing the second time" | identity (existing case) |
| Quest issued / deleted | quests.js:120 | quests.js:219 | quests.test.ts "issued then deleted" | identity, plus the "Quest issued" log line |
| Objective + / − | quests.js:422 | quests.js:422 | quests.test.ts "a tick up then down" | identity |
| Quest Fail / Reopen | quests.js:256 | quests.js:534 | quests.test.ts "failed then reopened" | identity but the end time; a Job Change step is not reopened |
| Quest edit / edit back | quests.js (submitForm) | same | quests.test.ts "an edit ... edited back" | identity |
| Daily Complete / (none) | quests.js `complete` | no undo control | | Complete has no undo; the rollover resets a daily the next day |
| Gate spawned / deleted | gates.js:30 | gates.js:379 | world.test.ts "spawn then delete" | gates as before; the made monsters and the log line stay (stated) |
| Day +n / −n | gates.js:48 | same | world.test.ts "forward then back" | the day comes back, a broken gate stays broken (stated) |
| Monster saved / deleted | bestiary.js:50 | bestiary.js:150 | bestiary.test.ts "saved then deleted" | identity |
| Loadout saved / deleted, renamed / back | custom.js:180, 185 | custom.js:186, 185 | build.test.ts "saved then deleted, and renamed then renamed back" | identity |
| Gear off / loadout swap | (inventory unequip) | custom.js swap | build.test.ts "take off, swap, and the gear is as it was" | identity |
| Path chosen / respec | custom.js:260 | custom.js:263 | build.test.ts "a path chosen then the GM's respec" | identity for the GM; a player's costs `respecCost` gold (stated) |
| Builds on / off, players pick, Default rules | custom.js:297 | custom.js:300 | build.test.ts "set, then the default rules" | identity |
| Emblem picked / put back | custom.js:98 | same | identity.test.ts "picked and put back" | identity |
| Sound on / off | custom.js:150, io.js:321 | same | identity.test.ts "sound on then off" | identity |
| GM mode / player mode, a new hunter, the hunter shown (header) | app.js (`chooseMode`, `addHunter`, `setActive`, Helper A's) | same | customization.e2e.ts "alone, a player switches to GM mode and back..." (e4594a2) | through the buttons |
| Rename / rename back | io.js:322 (`rename`, record.ts) | same | Helper A's record.ts test | identity |
| Coin call | coin.js | no undo control | | none by design: a landed coin stays |
| A hunter added to a fight / removed | combat.js `send` (`add`) | combat.js `send` (`remove`) | fight-roundtrip.test.ts (14d8232) | rows and turn as they were, two log lines; the sheet heard each HP change by `vitals` as it happened, so leaving writes nothing back |
| A hunter made for a join / the join failed | sync.ts `settleAttempt` (`addHunter`) | sync.ts `settleAttempt` (`removeHunter`, `setActive`) | forget.test.ts "added, then taken out" (2cdaa2f) | identity |
| A tombstone queued / sent | forget-queue.ts `forget` (`queued`) | forget-queue.ts `flush` (`sent`) | forget.test.ts "queued then sent" | identity (a queue that did not exist comes back as an empty one) |

The buttons that call these are driven by the browser files that passed after each conversion: `makers.e2e.ts`,
`maps.e2e.ts`, `sharing.e2e.ts` (library, pack), `gates-quests-dailies.e2e.ts` (gates, quests, dailies),
`customization.e2e.ts` (loadouts, build, emblem), `coin.e2e.ts`, `save.e2e.ts`, `room-onboarding.e2e.ts`,
`combat-turns.e2e.ts` (a fight's end in a gate), `battle-map.e2e.ts` (a refused tap). No new browser case was written:
each moved rule already had a browser test through its buttons.

## Role branches and writes on events (brief-roundtrip step 3), my views

| Where | What differs or what fires it | Rule or accident | Now |
|---|---|---|---|
| custom.js Build: respec | the GM's is free, a player's pays | rule | `respec(h, R, role, inFight)`, build.ts, tested both ways |
| custom.js Build: pick | the GM always picks, a player while players-pick is on | rule | `mayPick`, `pickPerk(..., role)` |
| custom.js `sync:docs` | a player follows the GM's build switches | rule | `withBuildRule`, build.ts |
| custom.js `change` / `sync:status` (`roomMoved`) | a player who left a room drops the switches it followed | rule | `withoutFollowedSwitches`, build.ts |
| quests.js quest form | reward and penalty only from the GM | rule, held only by the form | `questOf`, `editQuest(..., role)` (finding 5) |
| quests.js delete | a player may not delete the quest a penalty holds | rule | penalty.ts through `deleteQuest(h, qid, role)` |
| quests.js rollover (`setInterval`, `visibilitychange`) | on the GM's phone a hunter who never did a daily is not penalized | rule | `tracked(h, gm)`, `rollover`; a timer-driven write that is the daily engine itself |
| gates.js `sync:docs` | the GM merges another GM phone's world | rule | `mergeWorld`, world.ts |
| bestiary.js `sync:docs` | a player takes the room's codex | rule | `codexFromRoom`, bestiary.ts |
| coin.js `sync:event` | the GM holds a player's call | rule | `callTaken`, coin.ts |
| combat.js `turnDown` | an empty write to publish | accident | removed (finding 4) |
| bestiary.js `toCombatant` | an update that only counted `seq` up | accident | removed: the ids still come from `store.id`, and the fight's add stores the save |

## Device state outside the save (named, not moved)

store.ts says it is the one module that touches localStorage; three views also keep this phone's own memory there:
`onWorld`'s `save` in gates.js (the gates a player has been told of, per room), `remember` in table.js (the cues already
shown) and `saveFeed` in table.js (the GM's Table feed, sessionStorage). None is the save. Moving them behind
`store.prefs` is a store.ts change, Helper A's.

## After the merge of Helper A's views (66150dc, 90268c3, 6941f6d)

Where A and I had each written the same rule, one copy was deleted: app.js uses A's `party.ts` (`addHunter`,
`setActive`) and `role.ts` `chooseMode`, so my `withNewHunter`, `withActive` and `withMode` went; the Data view renames
with A's `record.ts` `rename`, so my `renamed` went; the skills maker saves with my `library.ts` `saveNamed`, so A's
`saveLibrarySkill` went; a respec pays through A's `inventory.ts` `addGold`. `applyRewards` (hunter.js) now calls
`buildAward` (build.ts) and `app.api.build.reward` is deleted, which took custom.js off the lint's list. `sync.once`
takes a step, and quests.js gives it one.

Still two copies of one rule: the stack split of a worn item is in `equip` (inventory.ts) and in `swapLoadout`
(loadouts.ts). They differ in which slot a ring takes (equip picks the free ring slot, a set names its slot), so a
shared `takeOne(h, itemId, splitId)` in inventory.ts that both call is the next step; not done here.

The skills maker ignores a refused save at the library's cap (A's skills.js): finding 1 for skills. Not fixed here.

## The edge's own writes (the coordinator asked)

sync.ts and forget-queue.ts write the save in 13 places. The two that undo each other are now core steps with a round
trip each (table above). The rest are one-way bookkeeping of the room link, each kept by sync.ts's lints: the device
token, the server answering, the bound hunter, the join time, the applied ring (`once`), the GM keys. They have no undo
control and were not converted; they are `store.update` in edge code, which the views' lint does not cover.

## The end state

| Check | Last line |
|---|---|
| `bun run typecheck` | clean (no output after the two tsc runs) |
| `bun run test` | `Ran 2606 tests across 72 files.`, 0 fail |
| browser files, one at a time, port 3251 (after the merge of A's views: gates-quests-dailies, makers, customization, rewards, save, custom-skills, room-sync-fixes, room-onboarding, used; the others before it) | gates-quests-dailies 21 passed, makers 30, customization 9, coin 7, sharing 6, maps 9, save 7, room-onboarding 6, combat-turns 14, battle-map 15, character 21, rewards 5, reward-room 1, room-sync-fixes 14, custom-skills 7, used 6 |

Writes converted: the lint counted 82 writes in my views at the start (A's first count, `helperB`); 0 are left and the
`helperB` block holds only combat.js's `send` (1), which brief-explicit leaves out of scope: one fight command is one
update so the use frame of feel.e2e.ts keeps its one repair and one write. Of the 63 `store.update` callbacks in my
views, 62 are steps of core functions now; plus app.js's 3 and the edge's 4 undo-pair writes.

Machines added: a quest (`hunter/quests.ts` `TABLE`, its chart in state-machines.md, walk events in
`tests/models/quest-events.ts`). A gate already had one; the world day is a number, not a machine.

Not checked: feel.e2e.ts (not to be run); the edge's one-way writes (above); the GM's fight `send` (scope).
