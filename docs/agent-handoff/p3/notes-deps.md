# Notes: the dependency map (brief-deps.md)

Base commit 8cd8a0f. Worktree branch `worktree-agent-a525bb2260e5a03e2`.

## Patterns found by grep, before writing the script

Files read: every `.ts` and `.js` under `src/` (44 files) and `server.ts`.

Imports:
- `import ... from '<path>'` on one line, and `import {` spread over several lines (encounter.ts, encounter-parse.ts).
- `import type ...` (protocol types in server.ts and edge).
- Dynamic `import('<path>')`: `src/views/ui.js:14` (store.ts) and `src/views/room.js:54` (qr.js).
- server.ts imports `./scripts/build.ts` and `./src/core/protocol.ts`.

How a module registers its API (all inside `register(app)`):
- `app.api.<name> = { ... }` (sync, dice, onboard, forge, effects, bestiary, skills, starter, gates, loot).
- `const api = app.api.<name> = { ... }`: the module then calls itself through `api.x` (hunter, quests, inventory).
- `A().<name> = { ... }` with `A = () => app.api` (combat, shadows, custom's `identity` and `prefs`).
- `const LO = A().loadouts = { ... }`, `const BD = A().build = { ... }` (custom.js; self calls through `LO.x`, `BD.x`).
- Keys in the literal: shorthand (`roll,`), `name: value`, methods (`check(...) {`, `async deleteHunter(...) {`), constants (`AMT_PLACEHOLDER: '7 or +5'`).
- No module adds a function later with `app.api.<name>.<fn> = ...`.

Aliases for `app.api` (each file declares its own; the same letter means different things in different files):
- `A = () => app.api` (combat, gm, shadows, custom). `A = app.api` (starter). `api = app.api` (gates).
- `A = app` (effects.js), `let A = null` then `A = app` (forge.js): `A.api.<name>`.
- `Y = () => app.api.sync`, then `const A = Y()` (room.js). In room.js `S` is local view state, not the API.
- `S = app.api.sync` (bestiary), `S = A().sync` (combat, custom). bestiary.js also has a top-level `S` that builds stat lines.
- `sy = app.api.sync` (quests, inventory, onboard), `sy = A().sync || {}` (gm). In edge/sync.ts and room.js `sy` is the save's sync settings.
- `sync = () => app.api.sync` (table), `sync = () => api.sync || {}` (gates).
- `E = app.api.effects` (inventory), `E = () => app.api.effects` (loot), `E = A.api.effects` (forge). In rulesref.js `E` is something else.
- `api = A.api.hunter` (effects.js).
- Member chains use `.`, `?.` and the TypeScript `!.` (`app.api.quests!.issue` in sync.ts).

Things the patterns cannot follow:
- `src/views/hunter.js:84` `app.api[n].bonuses` with `n` from a loop over `['inventory', 'skills']` one line above.
- `src/edge/sync.ts:386` `get hunter() { return app.api.hunter!; }` hands the whole hunter API to the room-event appliers in `src/edge/room-events.ts`, which call `app.hunter.applyRewards`, `damage`, `heal`, `derived`, `addCondition`, `removeCondition` on it under the name `app` (an `ApplyDeps`, not the app).

Events:
- `app.emit('<name>', payload)` with a string literal, everywhere (app.js, sync.ts, views).
- `app.on('<name>', fn)` with a string literal.
- `for (const ev of ['sync:status', 'sync:sheets', 'sync:docs', 'change']) app.on(ev, sched);` in room.js:260: a loop over a literal list on the same line.
- No `app.off` call outside app.js. `src/edge/store.ts` has its own local `emit(change)` for subscribers; app.js turns that into the `change` event.
- `on(`/`emit(` inside the `SyncApp` type in sync.ts and the definitions in app.js are not calls.

Saved fields: `store.update(d => { d.<key>... }, 'reason')`, `store.update(s => ...)`, `app.store.update(...)`, and `store.update(() => { h.points = ... })` where the callback changes an object it already holds (the key cannot be read off).

Comments mention `app.api.X` (gm.js:2) and `app.api.onboard = {...}` (onboard.js:1, loot.js:1), so the script blanks comments first.

## Step 1: scripts/deps.ts

- A small lexer blanks comments, and a second copy blanks string, template and regex text, so brackets can be matched and a pattern inside a string is not read as code. Offsets and lines are kept.
- Aliases are block-scoped. The first version gave each name one meaning per file, and `const e = A().effects` in one gm.js block turned every `e.key` and `e.target` of the file's event handlers into uses of `effects`. Now a `const` alias holds in its `{ ... }` block; an assignment without `const` (`A = app` in forge.js) holds in the whole file.
- Two regex bugs found by checking against grep: the lookbehind refused `...api.bestiary.statBlock(...)` (spread), and the alternation `(e|eff|...)` matched `e` at the start of `eff`. Both fixed (`(?<![^.]\.)` and `(?![\w$])`).
- Check by hand: a scratch script listed, for every registered member, the files outside its owner whose text has `.member`, and compared them with the map's users. Every difference left is a property of the same name (`r.current`, `e.item`, `d.mods`, `app.isGM()`, `applier.apply`) or one of the two unresolved routes (room-events.ts through `deps.hunter`, hunter.js:84 `app.api[n].bonuses`).
- "Used by" counts any reference to a member, a call or an `if (app.api.x?.y)` check. The map does not say which.
- Line numbers are only in the Unresolved section and in the single-entry output. The rest of the committed map names files only, so an edit that moves lines does not change it. The Unresolved lines do move, which means an edit above `src/views/hunter.js:84` or `src/edge/sync.ts:386` needs `bun run deps -- --write`.
- Principles: `principle-build-the-lever` made the check against grep a script rather than a by-eye pass; `principle-minimize-reader-load` decided files-not-lines in the committed map.

## Step 3: problems the map found today (not fixed; in the allow lists of tests/deps.test.ts)

Counts: 49 modules, 19 `app.api` names with 150 members, 18 events, 2 unresolved.

Events emitted that no module hears:
- `daily:reset` at src/views/quests.js:320
- `day` at src/views/gates.js:87 and src/views/gm.js:444
- `quest:failed` at src/views/quests.js:278 and :328
- `xp` at src/views/hunter.js:161

No module hears an event nobody emits. No module uses an `app.api` member that is not registered.

Members registered that no module in `src/` uses (41). Four of these are used by browser tests (`combat.addStatus`, `gates.xpFor`, `quests.checkDaily`, `sync.joinDialog`) and carry that reason. `skills.bonuses` is reached through the computed `app.api[n].bonuses` in hunter.js:84, so it is used, but not in a way the map can see. The rest carry "found by the map, to be fixed in the typed API unit":
bestiary.codex, bestiary.keyOf (bestiary.js:218); build.allocPlan (custom.js:281), build.respecCost, build.respecBlock (custom.js:293); combat.removeStatus (combat.js:506), combat.current (:508), combat.rollInitiative, combat.next, combat.prev (:511); effects.FULL, effects.legacyOps (effects.js:72), effects.turnOps (:75); gates.startEncounter, gates.clear (gates.js:507); hunter.AMT_PLACEHOLDER (hunter.js:218), hunter.AMT_TITLE (:219), hunter.eligibleRank, hunter.canReeval, hunter.reevaluate (:284), hunter.grantTitle (:285), hunter.hasCondition (:289); identity.colorOf (custom.js:86); loot.saveToLibrary (loot.js:233); onboard.start (onboard.js:250); prefs.get, prefs.set, prefs.buzz (custom.js:110); quests.complete (quests.js:169), quests.fail (:170), quests.nextReset (:171); shadows.grant, shadows.summon, shadows.capacity (shadows.js:88); skills.tickCooldowns (skills.js:59); starter.apply (starter.js:64).

Unresolved (the typed API must remove both):
- src/edge/sync.ts:386 hands the whole hunter API to the room-event appliers. src/edge/room-events.ts then calls `applyRewards`, `damage`, `heal`, `derived`, `addCondition` and `removeCondition` on it, and the map cannot see those calls.
- src/views/hunter.js:84 `app.api[n].bonuses` for `n` in `['inventory', 'skills']`.

Other things seen, outside the brief:
- `app.pendingRoom` is another field on the shared `app` object. sync.ts defines it, and onboard.js and room.js read and write it. The map does not track `app.*` fields other than `api`.
- src/views/onboard.js imports src/views/starter.js directly and calls `applyStarter`, so `app.api.starter.apply` is unused.
- The brief says `combat:turn` is heard in three other modules. The map and grep both find two listeners (custom.js:122, skills.js:60) and two emitters (combat.js:80, table.js:233).

The test also checks that each allow list matches exactly. A fixed entry fails the test until it is removed from its list.

## Step 4: three known cases, checked against grep

`bun scripts/deps.ts combat:turn`:
```
- emitted by src/views/combat.js:80; src/views/table.js:233
- heard by src/views/custom.js:122; src/views/skills.js:60
```
`grep -rn "combat:turn" src` gives the same four lines, plus a comment at combat.js:1.

`bun scripts/deps.ts app.api.combat.add`:
```
Registered in src/views/combat.js:503.
- add: defined at src/views/combat.js:508; used at src/views/bestiary.js:345
```
`grep -rnE "combat\??\.add\b" src` gives bestiary.js:345 and a comment at bestiary.js:68. gates.js starts its fights with `combat.startFlow`, not `add`.

`bun scripts/deps.ts src/views/gates.js` (shortened):
```
Depends on:
- imports src/core/gates/gate.ts
- uses app.api.bestiary.get (29), .list (45, 376), .statBlock (53), .toCombatant (103, 104)
- uses app.api.combat.awardParty (154, 155), .startFlow (107)
- uses app.api.hunter.applyRewards (160), app.api.inventory.rollLoot (136)
- uses app.api.sync .doc (219), .event (151), .isGM (125), .putDoc (182), .remoteSheets (125), .room (167), .send (151)
- hears 'change' (213, from app.js:246), 'combat:end' (493, from combat.js:397), 'sync:docs' (215), 'sync:status' (214)
Depended on by:
- imported by src/app.js
- app.api.gates.advanceDay used at src/views/gm.js:443
- app.api.gates.spawn used at src/views/gm.js:438; src/views/starter.js:54
- app.api.gates.clear, .startEncounter, .xpFor: used by nobody
- emits 'day' at src/views/gates.js:87, heard by nobody
Changes in the save: gates, monsters, world (and 3 store.update calls whose keys cannot be read off)
```
By hand: `grep -noE "(api\.\w+(\.\w+)?|sync\(\)\.\w+|app\.(on|emit)\('[^']+')" src/views/gates.js` lists the same members on the same lines. `sync()` is the file's `() => api.sync || {}`. `grep -rnE "api\.gates|A\(\)\.gates|A\.gates" src` finds only gm.js:438, gm.js:443 and starter.js:54 outside gates.js.

Commits:
- step 1 3c5ab56: scripts/deps.ts and the `deps` script in package.json.
- step 2 26503f1: docs/dependency-map.md.
- step 3 ebab6c7: tests/deps.test.ts.
- step 4 f0c593d: notes on the three cases.
- step 5: AGENTS.md section "Finding what depends on what". `bun run test`: 634 pass, 0 fail.
