# Notes: implicit audit unit U11, "The store" (rows 11, 12, 13 (store), 15, 16, 25, 52 (store), 73-75), plus row 53 and U5's due time

Goal. A save is what a player cannot afford to lose. The store (`src/edge/store.ts`) kept its life in five loose flags
(`readOnly`, `freshInstall`, `saveOk`, `depth`, `unsaved`): a read-only tab still changed the screen and lost it at the
reload, another tab's save replaced this tab's unsaved change without a word, a failed prefs write was swallowed. The
smallest change that meets it: the store's life as one machine in core (`src/core/store-life.ts`, a `TABLE` with its
chart), the store running it, the notices derived from its state, and each row's step in core. Plus two rows other units
left: a quest's due time read as a time at load (U5's note), and the session number counted in the save (row 53, U10's
row in the audit).

Worktree: /home/user/systemgaming/.claude/worktrees/agent-a3bd2c5f45842d09a, branch worktree-agent-a3bd2c5f45842d09a,
started at 827e9bf.

## Decision trail

1. Read the brief, helper-rules, AGENTS.md, START-HERE ("Every helper works in poteto mode"), poteto-mode, the
   principle skills named, statechart, unslop, the audit (summary, rows 11-16, 25, 52, 53, 73-75, the U11 entry).
2. The statechart skill's TLC run needs mise and a download, which this box does not allow (U2 and U15 found the
   same). The chart is drawn on paper below first, then the repo's walk of the real `TABLE` (scripts/statecharts.ts).

## Rows

- Row 11. Cause: `store.active()`, a read, pushed a starter hunter and wrote the save when there was none, and told no
  subscriber. Change: "a save holds a hunter" is the repair's rule (save.ts `repair`: a save read with none gets the
  starter, active); `freshSave` is the repair of `{}`; `active()` only reads; `importJSON` no longer adds one itself.
  Deleted with it: the store's `freshInstall`, which nothing read. Test: save.test.ts "a save with no hunter, or a
  hunters list of null, a number and a text, opens with the starter hunter active" (it opened with none before).
  Commit 1564346.
- Row 25. Cause: `devToken()` in sync.ts wrote the token into the save the first time a request read it. Change: the
  token is made at load beside the device id (`ParseEnv.newDeviceToken`, save.ts `repair`, `DEVICE_TOKEN_MIN`);
  `SyncSettings.deviceToken` is required; sync.ts reads it. The poll's `serverOk` and bind writes are left, as the
  audit says (the link's bookkeeping, one writer). Test: save.test.ts "a save is given this phone's device token at
  load". Commit 1733ee6.
- U5's row (notes-implicit-U5.md, "save.ts's repair keeps `dueAt` as any string"). Cause: the repair kept a quest's
  `dueAt` as any text, so `dueMs` in quests.ts guarded against a due time that is no time, and the card drew "Due
  Invalid Date" for one. Change: `timeOf` in day.ts (the ISO text of a time a date can hold, else null), read by the
  repair, `questOf` and `editQuest`; `dueMs` trusts it. Tests: save.test.ts "a quest's due time that is no time opens
  as no due time", quests.test.ts "an edit that gives a due time that is no time leaves the quest with none" (the edit
  kept 'tomorrow-ish' before). Commit 456d3b3.
- Rows 12, 15, 16 (and 75). Causes: row 12, five flags were the store's life, so a read-only tab still took every
  change on screen and dropped it at the reload, and a write that failed cleared `unsaved`, so the page hidden or left
  never tried it again (the change was lost at the reload even with room again); row 15, the `storage` event replaced
  `state` whatever this tab had not yet written, and ignored a text that was not a save; row 16, a failed prefs write
  was swallowed; row 75, the Data view's register took the day's backup. Change: `src/core/store-life.ts`, one machine.
  States `ready` (write `clean`, `dirty`, `failing`, `retrying`), `readOnly` (`newer`, `otherTab`), `noStorage`; events
  `changed`, `due`, `leaving`, `wrote`, `writeFailed`, `otherTab` (theirs: save, newer, unreadable), `replaced`; effects
  `schedule`, `write`, `take`, `keepMine`. `noticesOf` derives the banners from the state (the `newer` notice left
  `loadSave`'s answer, where it duplicated `readOnly`); `mayChange` is what `store.apply` refuses (`read-only`). The
  device memory (prefs and `store.device`) is one value, `kept` or `failing`, told by `deviceFailed`. `dailyBackupDue`
  is the day's backup rule, run by the store at load. Chart: scripts/charts/store.ts, "The store" in
  docs/state-machines.md. Tests: tests/store-life.test.ts (every cell named above; a model of a tab, its storage and its
  backups walked over 400 random runs: a clean tab shows what storage holds, a save storage does not hold is told or has
  a write coming, a change another tab overwrites is in the backups, a tab that may not write never writes; dropping
  `keepMine` fails two cases, checked by hand), tests/e2e/save.e2e.ts (storage full on a write; the same change saved at
  the reload with room again, which failed before; a reload between a change and its write, the life at the reload read
  back to show the reload came first; another tab's save taken while clean; another tab's save over a change storage
  refused, with the banner, the backup, a refused change and the restore; no storage; a failed prefs write; the newer
  save refusing a rename). Commit 83f06d5.
- Rows 73, 74. Causes: io.js's preview read a file on its own (schema 2, a lone hunter by `'name' in p`) and offered
  Add or Replace for an old file the import then refused; the GM key went into the file's text by the view, with an
  empty `catch {}`. Change: `store.read(text)` answers what `parseSave` reads (the save and `fileKind`) or the words of
  why not, and the preview counts that save; Replace is `store.importSave(keepGmKey(save, mine))`, Add reads the parsed
  hunters (`importJSON` and the old-format branches deleted). Tests: save.e2e.ts "an old campaign file chosen in the
  Data panel is refused before any preview" (the preview showed first before); save.test.ts "a save file brought in
  from the Data view" (keepGmKey, fileKind). Commits 83f06d5, 12d7f79.
- Row 52 (store's half). Cause: device memory beside the store in dice.js, gates.js and table.js, each with its own
  swallowed failure. Change: `store.device(name, where)` (key `hunter-system-<name>`, so the storage meter counts it,
  a failed write told), `store.used()` for the meter; dice.js and gates.js adopt it. The lint "the browser's storage is
  read and written only in src/edge/store.ts" lists sync.ts (the invite), upgrade.ts (the reload note) and table.js
  (see Left). Commit 5f144a5.
- Row 53 (U10's row in the audit, given to U11 by the lead as one of the top ten). Cause: gm.js read the next session's
  number back from "Session N began" titles in a log that keeps 200 lines. Change, core half: `world.session` in the
  save (default 0, repaired to a whole number of 0 or more) and `sessionStarted(save, stamp)` in session-log.ts, which
  counts and writes the line. Test: session-log.test.ts "the sessions the GM starts are counted by the save" (a log cut
  at its cap and still "Session 6"). Commit fb6124a. gm.js is not changed (see Left).

## Design: three shapes weighed for the store's life

| Shape | A wrong combination writable? | Notices | Chosen |
|---|---|---|---|
| A. One union: `ready` with its write, `readOnly` with why, `noStorage` | no: a read-only tab has no write state | derived from the state | yes |
| B. Two regions, access x write | yes (read-only and dirty) | derived | no |
| C. Six flat states | no | derived | no: "may this tab write" becomes a list of four names, where A asks `at === 'ready'` |

`failing` and `retrying` are two states, not one with a flag: a change in `failing` must schedule its write once, and
`retrying` is "failing with a write coming", so a second change schedules nothing more. Another tab's save while this
tab is behind turns it read-only (the audit's judgment) rather than taking theirs and going on: going on would let two
busy tabs fill the eight-entry backup ring with conflicts and push real backups out; read-only stops at one.

## Principles that changed a choice

- principle-model-the-domain: the store's flags became one union with a table; the notices became a function of it,
  so a banner cannot outlive its cause (the `newer` banner used to stay after an import replaced the newer save).
- principle-type-system-discipline: `SyncSettings.deviceToken` and `World.session` required, so a save without them
  does not compile; `Read` is a union the view narrows; `LIFE_TEXT` is keyed by `LifeNotice`, so a new notice without
  words fails the typecheck.
- principle-boundary-discipline: a due time is read as a time at the save's boundary (`timeOf`), and `dueMs` trusts
  it; an import is read once by `parseSave` and the view never reads the file a second way.
- principle-fix-root-causes: the lost change at the reload came from `persist()` clearing `unsaved` before it tried;
  the fix is the `failing` state the page's `leaving` writes from, not a retry timer.
- principle-subtract-before-you-add: `freshInstall` (read by nothing), `devToken`'s write, `importJSON`, io.js's
  `preview`, `storageUsed` and its daily backup went before the machine came.
- principle-test-behavior-not-implementation: the e2e cases read the stored text and the banners, and make the failure
  happen with the browser's own `setItem` throwing `QuotaExceededError`.

## Left, and why

- Row 13 (the depth counter). combat.js `send` writes a hunter's totals with `hunter.setVitals` (an `apply`) inside its
  own `store.update`, so `depth` stays, named for that one caller. The lead keeps this unit out of combat.js (the map
  helper's file). Done here first and taken back: a core step `fought(save, r, links, R)` in a new
  `src/core/combat/fight-save.ts` (the fight, the refs, the write-backs through `sheetEdit` totals), and `send` as
  `const r = reduce(was, cmd, c); const effects = store.apply(..., s => fought(s, r, links, c.rules)).ok ? r.effects : [];`.
  Two things to carry with it: `showEffects` compares the rows' `armed` before and after, and `writeInto` writes the new
  fight into the old object, so the "before" must be a set of ready row ids taken ahead (`readyWas`); and the lint "only
  the combat dispatcher writes the fight" names the dispatcher line, which moves. Then `hunter.setVitals` and `depth`
  go, and a read-only tab refuses the GM's fight as it refuses the rest (today the fight still changes in its memory).
- Row 52, table.js: its cues memory and the Table feed (sessionStorage) still read storage themselves; table.js is the
  map helper's file during this unit. Two lines each to `store.device('table')` and `store.device('table-feed', 'tab')`;
  then it leaves the lint's list.
- Row 53, gm.js: `startSession` should call `store.apply('session', s => sessionStarted(s, { at, cap: app.rules().logCap }))`
  after the day moves, in place of line 406's log parse and line 408's `addLog`, and read the number from
  `S().world.session`. gm.js is the GM-view helper's file (U10), which rewrites `startSession` for row 54.
- A campaign file with no hunter now previews and adds the starter hunter (the repair gives every save one). A file
  like that comes only from a hand-made file; not worth a field.
- In a read-only tab the room link's bookkeeping (`store.update` in sync.ts) still changes memory. It is the link's,
  dropped at the reload, and the stored cursor replays what it missed.

## Checks

- `bun run test` (after aa2ad7d): 3247 pass, 3 skip, 0 fail across 85 files.
- tests/e2e/save.e2e.ts: 14 passed.
- The first full browser sweep was stopped at its first file: its log folder had the same name as another helper's in
  the shared scratchpad. Stopping it left this unit's server on 3281 running; that one process was stopped by hand
  before the sweep ran again from a folder of its own.
- Full browser sweep (every file but feel, one at a time, at 5caec81): every file passed but customization.e2e.ts,
  whose first case imported a campaign through `store.importJSON`, which this unit deleted (row 73). The case now reads
  the file with `store.read` and imports it with `store.importSave` (8889fb7); the file is run again below.
- customization.e2e.ts after 8889fb7: 9 passed (1.4m).
