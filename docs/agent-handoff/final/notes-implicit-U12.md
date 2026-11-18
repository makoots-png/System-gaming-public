# Notes: unit U12, swallowed errors (rows 1 to 3, 9, 29's sync.ts half, 80, 82 of the implicit audit, and the sweep)

Helper: Opus, worktree `.claude/worktrees/agent-ae64d58bee05aca75`, branch `worktree-agent-ae64d58bee05aca75` (off
`claude/zen-pasteur-ov4cgd` at 0b53311). Playwright port 3281.

## Goal

the owner wants nothing implied, and a player never to lose a reward, a report or a form to a failure nobody saw. The
problem of this unit: across the app a `try` turned a throw into a default (an empty list, null, false, a die of its
own, "offline"), so a bug looked like an empty screen and reached no console. The smallest change that meets it: delete
each wrapper whose call cannot fail but by a bug, so the throw reaches app.js, which draws the failed part and logs it
once per distinct failure; keep a catch only where something can be done (a typed failure the player is told, a
fallback the browser forces) and say why in it; then a lint over `src/` and `server.ts` so the class cannot come back.

## Decision trail

1. Read the brief, helper rules, AGENTS.md, START-HERE's "Everything explicit", "The problem, not the symptom" and
   "Every helper works in poteto mode", poteto-mode, the audit's rows 1 to 3, 9, 29, 80, 82 and the unit's entry, the
   notes of U7, U8, U10 and U15 that left work here, and the leaves principle-boundary-discipline,
   principle-fix-root-causes, principle-prove-it-works.
2. Took the inventory again (below). The lint, run on the starting tree (0b53311, extracted with `git archive` to a
   scratch folder), names 75 catches; on this branch it names none.
3. One log for a failure no player can act on: `reported(where, e)` in `src/edge/report.ts`, once per place and
   message, with the stack. "Logged once" (the lead's words) against "warns each time" (the audit's row 2): once per
   distinct message, so a throw on every frame is one line and a new failure at the same place is another. Row 2's
   bug was the second kind: `warnOnce` keyed by id hid every later, different failure.
4. Row 3, weighed on paper. (a) The audit's lint over `docs/dependency-map.md`: the map records which api a module
   uses, not whether `register` reads it while registering or a handler reads it later, so it would flag every later
   read (most are fine) or need a parser of each register's body. (b) Leave the convention and its comment. (c) Make
   `app.api` a table that throws for a name no module registered, saying whether the boot order or a failed register is
   the cause (`src/edge/api-table.ts`). Chosen: (c). It checks exactly the rule (a read during the boot of a module not
   yet registered), and every browser test boots the app with `device()` failing on a console warning, so the 30
   browser files prove the order on each run. It also turns row 3's other half ("a later module's `app.api.X` is
   undefined and its buttons do nothing") into a thrown error that reaches app.js. `App.api` is typed `AppApi`, no
   longer `Partial`. The audit's judgment differs; this is why.
5. Rows 1 and 2: a section and a panel are `{ el, state: 'new' | 'live' | 'failed' }` (a union, not `mounted: boolean`
   plus a warned set). A mount, update or `when` that throws draws the failed text and the part runs no more until a
   reload. A `when` that throws keeps its view listed and draws it failed (`asked` answers `'failed'`); a key's makes
   the key do nothing, logged.
6. Row 9: the bundle has no chunks (`Bun.build` without `splitting`), so ui.js's `import('../edge/store.ts')` could
   fail only by a bug, and its `.catch(() => {})` hid it; the chime was also off until the import landed. Static
   import. The same holds for room.js's `import('../core/qr.js')`: static too.
7. Row 29 (sync.ts half): the register's `.catch(() => {})` is `reported('sync:worker', e)`. A browser case makes the
   browser refuse the worker and reads the warning.
8. sync.ts beyond row 29: `failKind(e)` answers the network's kind for `NoAnswer` and logs anything else (a bug of the
   request), counting it as the server's failure so the link backs off as for a 500 rather than stalling or calling it
   offline. A Create or Join tap's promise rejects only with a `TapError` (now a class), so the views read its kind;
   anything else is logged and becomes `net`.
9. Row 82 (about thirty wrappers): deleted. The calls (inventory, bundles, effects, skills, loot, forge, sync, dice,
   combat) have no legitimate failure; each throw now reaches app.js. `|| []` defaults after them were dropped too,
   their types say they answer arrays.
10. Row 80: the death save's fallback die is deleted; the roll goes through the dice roller and its log.
11. hunter.js's Delete hunter called `backupNow` in a try, but `backupNow` never throws: it answers false when storage
    is full, and that answer was ignored while the window had promised a backup. Now a false asks "No backup saved ...
    Delete anyway?". A behaviour a player sees; a line in for-the-owner.md. Browser case in look.e2e.ts.
12. room.js's Share swallowed every refusal as "cancelled": now only `AbortError` (the share sheet closed) is quiet;
    any other refusal says "Use Copy link" on the button.
13. table.js (the fight screen helper's file, catch sites only): its cue and feed memory sat in localStorage and
    sessionStorage behind swallowed writes; moved to `store.device` (a failed write is the store's banner), which also
    takes table.js off the storage lint's list as U11 planned. The keys change (`hunter-system-table-cues`,
    `hunter-system-table-feed`); layout.e2e.ts reads the new one.
14. The lint (kind 7): every `catch` block and `.catch(...)` in `src/` and `server.ts` reads its error, throws again,
    or has a comment of four words or more from it to the end of the line where it ends. Four words, so `ignore`,
    `optional`, `gone` and `cancelled` are not reasons. It replaces the sw.js-only rule (its old line is one of the
    cases); the stricter server.ts rule stays. Allow-list empty.
15. The kind 1 lint U8 left here: every `let` a view keeps for the page (at its top or at the top of `register`) is
    named with what it holds, and two flags in one declaration fail. TypeScript here is 7.0 (no JS API), so the lint
    reads the source with a small scanner that steps over strings, templates, comments and regex literals; a sample in
    the test proves it sees a page let, two flags together, and not a function's own let. 63 names today, none with two
    flags in one statement.

Principles that changed a choice: boundary-discipline (the tap's error typed at sync.ts's edge, so views trust its
kind; the wrappers deleted because the calls are inside the system), fix-root-causes (`backupNow`'s ignored false and
the swallowed share refusals handled where they happen, not hidden; the setSelectionRange tries deleted after reading
that the inputs are text, where it cannot throw), prove-it-works (each browser case run against the old app.js and
seen to fail; the lint run on the starting tree).

## Inventory (every catch the lint names on 0b53311, and what became of it)

What fails there / what the player should learn / the fix. "Told" is on screen, "logged" is `reported`, "reason" is a
comment in the catch.

| Site | What fails | Player learns | Fix |
|---|---|---|---|
| app.js:44 `safe` | a view's, panel's or key's `when` throws (a bug) | the part says it failed; logged | deleted; `asked` (row 1) |
| app.js update/mount (uses e) | a part throws | failed text in place; logged per message | `mountPart`/`updatePart` (row 2) |
| app.js register (uses e) | a module's register throws | logged; its api reads throw | `apiTable` (row 3) |
| core/protocol.ts:657 | a value too deep to copy | its reader refuses null | reason |
| core/save.ts:590 | a text that is not JSON | the caller says why | reason |
| edge/notify.ts:18, 31 | an old Safari's permission call; a notification refused | the switch shows the state; logged | `reported` |
| edge/pack-code.ts:79 | bytes that do not inflate | "damaged" in the Data view | reason |
| edge/store.ts:77, 81, 140, 318 | storage full or blocked; a damaged memory | the store's banners; the meter says unknown | reasons |
| edge/sync.ts:141, 143 | no HTTP answer; a body that is not JSON | the link's offline states | reasons |
| edge/sync.ts:163, 721, 822, ask, sendSheet | a request that threw: the network, or a bug | the call's `offline` or `server`; a bug logged | `failKind` |
| edge/sync.ts:193, 196 | session storage off | the store's banner | reasons |
| edge/sync.ts:584 showRemoved | a rejoin that failed | its toast by kind; a bug logged | `reported` for a non-tap error |
| edge/sync.ts:905 `/* ignore */` | nothing that can throw but a bug | n/a | try deleted |
| edge/sync.ts:912-913 register | the browser refuses the worker | nothing (cannot act); logged | `reported('sync:worker')` (row 29) |
| sw.js:41, 48 | no network | the offline answer, the cached copy | reasons |
| views/combat.js 58, 59, 175, 188, 377, 1155 | only a bug | failed part; logged | deleted (commit 1d540f7) |
| views/custom.js:114 | `vibrate` never throws | n/a | try deleted |
| views/forge.js:20, loot.js:200, workshop.js:35 | only a bug in effects or skills | failed part; logged | deleted |
| views/gates.js:108, 149 | only a bug in sync | failed part; logged | deleted |
| views/gm.js 97, 98, 226, 235, 324, 462 | only a bug in sync, forge, inventory | failed part; logged | deleted |
| views/gm.js 253, 660 | `setSelectionRange` on a text input, `focus` | n/a | try deleted |
| views/hunter.js:220 | `backupNow` answers false when full | "No backup saved", asked again | handled |
| views/hunter.js:222 | `sync.forget` posts to the outbox | n/a | try deleted |
| views/hunter.js:476 | only a bug in the roller | failed part; logged | fallback die deleted (row 80) |
| views/hunter.js:568 | only a bug in dice.check | failed part; logged | "Dice are unavailable" deleted |
| views/io.js:122, 160 | clipboard refused; a file that is not JSON | "Select and copy"; Import failed | reasons |
| views/map-maker.js:131 | a pointer already lifted | n/a | reason |
| views/onboard.js:248 (and 163, 208) | the room call; a bug after it was swallowed with it | WHY by kind | try narrowed to the call |
| views/reward-editor.js 39-43, 104-105, 183, 193 | only a bug | failed part; logged | deleted |
| views/room.js:56 dynamic QR import | only a bug (no chunks) | n/a | static import |
| views/room.js 244, 248, 264 | clipboard refused | "Select and copy" | reasons |
| views/room.js:250 share | a closed sheet, or a refusal | refusal: "Use Copy link" | handled |
| views/table.js 36-53, 138, 139, 222, 333, 602-619 | only a bug; storage | failed part; the store's banner | deleted; store.device (commit a1ce328) |
| views/ui.js:19, 21, 36 | the store import (row 9); audio refused | no chime; logged | static import; `reported('ui:sound')` |
| server.ts:371, 500 | a body that is not JSON; a broken escape | 400 | reasons (the server rule already held them) |

Fallbacks without a catch, read and left: `|| []` after the deleted wrappers is gone; the many `app.api.x?.y?.()`
optional calls in views are harmless now that a missing name throws, and are not swept (334 lines, no failure hides
behind them that the deps test does not already name).

## Rows

| Row | Cause | Change | Test | Commit |
|---|---|---|---|---|
| 1 | `safe()` turned a throwing `when` into a default | `asked`: yes, no or failed; failed draws the part failed, logged | failed-view.e2e "a screen whose rule for showing breaks" (fails on the old app.js) | 8aaffee |
| 2 | an update's throw was warned once per id and the part kept its stale DOM | parts are `new`, `live`, `failed`; a throw draws the failed text, logged per message | failed-view.e2e "a screen whose update breaks" (fails on the old app.js) | 8aaffee |
| 3 | the order of `MODULES` was a convention; a missing api was undefined | `apiTable`: a read of a name not registered throws, naming the cause | tests/api-table.test.ts; every browser file boots through it | 8aaffee |
| 9 | ui.js reached the store by a dynamic import whose failure was swallowed | static import | the lint ("the rule sees each old swallow") | 8aaffee |
| 29 (sync.ts) | the worker's register `.catch(() => {})` | `reported('sync:worker')` | failed-view.e2e "a phone whose service worker does not register" | bea36b9 |
| 80 | a throwing roll fell back to an unlogged d20 | deleted | the lint | 8ab5ad4 |
| 82 | about thirty wrappers answered a default on any throw | deleted (combat.js and table.js in their own commits) | the lint | 8ab5ad4, 1d540f7, a1ce328 |
| sweep | 75 catches without a use, a throw or a reason | the table above | lint "no error is swallowed" | 9d39882 |
| kind 1 (U8) | page lets with no stated meaning; flags side by side | lint naming each, two flags together fail | lint "every let a view keeps" | 53c242b |

## Lines in files not mine

- src/views/combat.js (fight screen helper): commit 1d540f7, catch sites only (6 sites).
- src/views/table.js (fight screen helper): commit a1ce328, catch sites only (12 sites; its storage to `store.device`).
- src/views/map.js (map helper): none. Its one catch (`setPointerCapture`) already names its reason.

## Left, and why

- store.ts's `load` ignores `pushBackup`'s false: a text that is not a save, under the save's own key, is "kept in the
  backups" by the notice even when storage is too full to keep it. Found in the sweep; a notice of its own in
  store-life.ts is U11's machine, so it is named here, not done.
- The 334 optional calls `app.api.x?.y?.()` in views: harmless with the api table, but they read as if a module could
  be absent. A sweep that deletes them is mechanical and touches the other helpers' files.

## What the api table found

coin.e2e's "a reload on either phone while the coin is in the air" failed on the first pass: `[register:dice] app.api.coin
is read before its module registered it`. dice.js drew its quick dice sheet inside `register`, and with a roll in the
log the draw read the coin's api, listed after dice in `MODULES`; before, it read undefined and drew the roll without
its coin. Fix (bb6c559): the sheet is drawn when it opens and the view after its mount, never inside register. coin.e2e
passes after it. This is row 3's bug, met in the wild by the first browser pass.

## Checks

- `bun run typecheck`: `$ tsc --noEmit && tsc -p tsconfig.views.json --noEmit` (clean).
- `bun run test`: "Ran 3275 tests across 86 files", 3272 pass, 3 skip, 0 fail. The baseline run I started at the
  beginning showed 88 failures in the server tests; it ran while I was editing app.js (server-handshake builds the
  app), and neither later run repeats them.
- `bun run charts`: no change. `bun run deps -- --write`: the map gains report.ts and api-table.ts.
- Every browser file but feel, one at a time on port 3281: 29 of 30 passed on the first pass; coin failed as above and
  passed after the fix. The lead's no-browser window stopped the first pass during room-sync-fixes (stopped with
  SIGINT, its server went with it); the second pass ran coin and the nine files left, all passed. battle-map,
  character, combat-turns, custom-skills and customization ran before the dice.js fix (it only removes a draw inside
  register).
- Each new browser case was run against the old app.js (copied in from HEAD, then put back) and failed there.
