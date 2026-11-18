# Notes: the fight screen's rows of the implicit audit (U4's 13, 39, 44, 85; U11's 13; U11's table.js storage; U10's `sync.send`)

Worktree /home/user/systemgaming/.claude/worktrees/agent-a0ef48cd61077f638, branch worktree-agent-a0ef48cd61077f638,
started at 0b53311 (claude/zen-pasteur-ov4cgd). Playwright port 3271.

## Goal

The GM's fight screen keeps nothing a reload can lose and does nothing twice. `send()` in combat.js stored the fight in
one `store.update` with a nested `apply` inside it (the store's `depth` counter existed for that one caller), so a
read-only tab still changed the fight in memory; a fallen monster's extraction attempts were a `Map` in the view, so a
reload gave every corpse its tries back; what is open over the map was two booleans cleared in six places; a gate's
fight started in one write and the gate was marked in a second. The smallest change: one core step per fight command
(the fight, what it came from, each write-back, each player's totals in the outbox, a gate's mark), written by one
`store.apply`; then what reaches outside in a stated order; the extraction attempts a field of the row set by a fight
command; `over` one union.

## Decision trail

1. Read: helper-rules, the brief, AGENTS.md, poteto-mode and START-HERE's section, the audit rows 13, 39, 44, 85 and
   U4's entry, notes U4, U11, U10, the principle skills model-the-domain, type-system-discipline, boundary-discipline,
   prove-it-works, make-operations-idempotent, subtract-before-you-add, migrate-callers-then-delete-legacy-apis.
2. Subtract first: `sync.send` (U10's leftover) and table.js's own storage went before anything was added.
3. Row 13, data shape: a command's write is `fought(save, r, beside, R)`: the reducer's answer `r` (worked out by
   `send` from the save's fight in the same task, as U11's note suggested) and what it writes beside the fight (`Beside`:
   the links, the room, the players' totals as events the view made, the time for a log line). Three shapes weighed:
   | Shape | One write? | Pure? | Chosen |
   |---|---|---|---|
   | A. `fought` runs `reduce` inside the step | yes | the players' totals need an event id (device, random), so the step would take an id maker | no |
   | B. `send` reduces, `fought` writes the answer | yes | yes; the events are made before the step, as pay.ts `settleEncounter` takes its awards | yes |
   | C. keep `store.update`, move only `setVitals` into it | yes | no core step; a read-only tab still changes the fight | no |
4. What follows the write, and the order: (1) `flush` of the outbox, (2) the news, (3) the dice still owed. The dice
   used to follow the command's effects (`rollSettle`, `channel` broken), so a page that stopped between the write and
   the settle left a per-round op unpaid for ever. Now they are read from the fight (`owed` in fight.ts: each pending
   entry, then each broken channel of a body still up) after each write and when the app opens (principle
   make-operations-idempotent: derive the step from the state that exists). The `rollSettle` effect stays: the reducer's
   tests and the simulation read it as the record of what a command asked.
5. In the browser the three parts after the write run in the same task as the write, and storage is written a frame
   later, so a reload falls before all or after all of them; what separates two of them is a throw between them. The
   test is therefore a bun test of a GM phone that follows `send` part by part (tests/fight-save.test.ts), stopping after
   each part and loading the save again from its text through `loadSave`.
6. `writeInto` writes a fight with the same id into the stored one in place, so the old fight object a view held changes
   under it: `showEffects` now takes the ids of rows with a ready reaction from before the command (`readyWas`), and
   `drawLog` keeps a copy of the lines it drew (it compared the log array by identity, which would never see a change).

## Rows

- Row 13 (U4's view half and U11's store half). Cause: `send` changed the fight in a `store.update` and wrote each
  hunter's totals with `hunter.setVitals`, an `apply` nested inside it, so the store kept a `depth` counter for that one
  caller and a read-only tab still changed the fight in memory. Change: `src/core/combat/fight-save.ts` `fought`, the one
  step; `send` reduces, makes the players' totals' events, and writes with one `store.apply`; `sendVitals`,
  `writeSheet`, `hunter.setVitals` and the store's `depth` deleted; `owed` and `payOwed` for the dice. Lints: "only the
  combat dispatcher writes the fight" now sees the old `d.fight = r.fight;` and asks that `fought` is called only by
  combat.js inside `store.apply`; "a view writes the save only through store.apply" has no list left; the shadow HP
  allowances for combat.js are gone. Tests: tests/fight-save.test.ts (the writes of one step; a refusal writes nothing; a
  reload after each of the four parts loses nothing and pays nothing twice; without the payment at load three of the
  four reload cases fail, checked by hand).
- Row 85. Cause: gates.js marked the gate in a write of its own after `startFlow` answered. Change: the links' `gate`
  marks it inside `fought` (world.ts `gateFightStarted`), so the add that starts a gate's fight and the gate's mark and
  log line are one write; gates.js's write is deleted. Test: fight-save.test.ts "a gate's fight starting writes the
  fight, its links and the gate's mark with its log line together".
- Row 39. Cause: a fallen monster's extraction attempts were a `Map` in combat.js's closure that shadows.js set through
  `combat.setExtractTried`, so a reload gave every corpse its tries back; and a shadow that rose joined the army only
  after the ARISE window answered, so a page left in that window lost the shadow and kept the corpse spent. Change: a
  machine, `src/core/combat/extraction.ts` (`Extraction`: open with the attempts made, or gone: risen, crumbled,
  spent; `extractionStep` over its `TABLE`; drawn as "A fallen monster's extraction" in docs/state-machines.md), on the
  row's `extraction`, moved only by the fight's new `extract` command (cells in setup, running and ended; refusals
  `notMonster`, `notNow`, `noAttempts`), read back by fight-parse.ts. `combat.extracted(cid, outcome, also)` sends it
  with the shadow's join as `fought`'s `also`, so the corpse's outcome and the new shadow are one write; the ARISE
  window then renames a shadow already in the army. The `Map` and `setExtractTried` deleted; `ExtractTarget.tried`
  became `left`. Random play: an ended fight's turn (always refused) became an extraction on any row, its outcome from
  the log's length, so every seed draws as before (adding a new pick changed the streams and lost the rare "delayed
  end" from the coverage); the model holds the machine's invariants and its coverage asks for an extraction line.
  Tests: fight.test.ts "a fallen monster's extraction" (the machine's cells, the row kept and read back, the
  refusals, after the end); combat-turns.e2e.ts "a goblin's corpse that crumbled on a natural 1 stays crumbled after
  the GM's page reloads" (with the old Map, Extract came back after the reload) and "a goblin that rises on a natural
  20 joins the Necromancer's army as the corpse is spent" (the army holds it while ARISE asks its name). No test drove
  an extraction in a browser before.
- Row 44. Cause: what is open over the GM's map was two booleans (`sheet`, `tools`) set in six places, `render` itself
  cleared `tools` when the screen left Map view, and the Build drawer's "the GM toggled it" was `dataset.auto` and
  `dataset.touched` on the element. Change: `over`, one union (`none`, `card`, `tools` of a fight's id), written only by
  `overTo`; the tools show while that fight runs in Map view (`toolsShown`), so `render` writes nothing and a new fight
  never opens on a stale tools sheet. The drawer: `build` is `screen` or `hand`; the screen's wish is a function of the
  fight and the layout (`buildWanted`: open, but folded on a desktop once a fight is under way), so `wasActive` went; a
  toggle to other than what the screen wants is the GM's hand. Weighed: a machine in core for a UI-only value no rule
  reads (no: nothing outside the view asks), two booleans kept exclusive by hand (the bug class), the union (chosen).
  One line the map helper may touch changed: `mapSource.card` is now `sel = id; overTo({ at: 'card' });` (same effect).
  A list pick while the tools are open now closes them, as a token's tap always did (on a phone the list is hidden in
  Map view; on a wide screen the tools panel covers it). Test: no browser case fails on the old code: every reachable
  writer kept the two exclusive by hand, and the union makes both open unwritable. Added combat-turns.e2e.ts "on a wide
  screen Build encounter folds away when the fight starts, and once the GM opens it by hand it stays open" (no test
  drove the drawer before); battle-map.e2e.ts's Fight tools case covers the sheet. The flags lint's count for combat.js
  fell from 11 to 10, its reason rewritten.
- U11's "table.js storage". Cause: table.js read and wrote localStorage (the cues fired) and sessionStorage (the Table
  feed) itself, each with a swallowed failure. Change: `store.device('table')` and `store.device('table-feed', 'tab')`;
  the storage lint's list is the edge's three files only (commit 440a4e5). layout.e2e.ts reads the feed under its new key.
- U10's `sync.send`. Cause: kept only for four browser tests that sent a copy of an event once. Change: those tests post
  it through the outbox (battle-map, table-turn: a replayed `pass` and `cast`; used: the GM's quest; rewards: the GM's
  award), and `send` is deleted from sync.ts, `SyncApi` and deps.test's `UNUSED` (commit c015239).

## Principles that changed a choice

- principle-make-operations-idempotent: the dice a fight waits for are read from the fight (`owed`), not from the
  command's effects, so a second look pays nothing and a page that stopped pays at its next look.
- principle-model-the-domain: the corpse's attempts are a machine with a table on the row; `over` is a union.
- principle-type-system-discipline: `Extraction` cannot hold an open corpse that rose; `over` cannot be card and tools.
- principle-subtract-before-you-add: `sync.send`, `setVitals`, `writeSheet`, `sendVitals`, `depth`, `tried`,
  `setExtractTried`, `wasActive`, `dataset.auto` and `dataset.touched` went.
- principle-migrate-callers-then-delete-legacy-apis: `send` and `setVitals` lost their callers and went in the same unit.
- principle-test-behavior-not-implementation: the reload cases compare what the player keeps (Kai's HP, one settle
  line, one message under Kai's key) with the run without a reload, not the internals.

## Left, and why

- Kind 1 lint for this class: the closure `let` count lint already covers combat.js (now 10); a lint for "per-row fight
  state in a view's Map" was not added: combat.js's two Maps left (`picks`, `amounts`) are UI values (the foe the move
  control is on, the typed HP amount) and no pattern tells them from fight state.
- The `rollSettle` effect stays though combat.js no longer reads it (the reducer's tests and the simulation do).
- The codex record of a `defeated` monster is bestiary.js's own write after the fight's; a reload between them is
  caught at the end (`combat:end` records every row at 0, refusing a counted one), except a defeated row removed before
  the end. Folding it into `fought`'s `also` needs bestiary.js's entry lookup; bestiary.js is not this unit's file.
- `src/core/sync/sent.ts` and the room model's GM card bookkeeping (U4's and U10's notes) were not looked at.

## Checks

- `bun run typecheck`: clean.
- `bun run test` (at f8603ea): "Ran 3287 tests across 86 files", 3284 pass, 3 skip, 0 fail.
- `bun run deps -- --write` and `bun run charts`: no change after f8603ea.
- combat-turns.e2e.ts and battle-map.e2e.ts together at f8603ea: 37 passed (5.4m).
- The lead asked for no browser run between 08:47 and 09:22 UTC (a timed CI pass); the sweep started after.
- Full browser sweep (every file but feel, one at a time, port 3271, at 3d3980d, after 09:23 UTC): 29 of 29 files
  passed whole, 300 cases (battle-map 20, character 23, coin 7, combat-turns 17, makers 33, table-turn 9, used 7, the
  rest as logged). No failure to chase.
