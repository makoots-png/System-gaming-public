# Notes: implicit audit unit U15, "The app update" (rows 29 for sw.js, 30)

Goal: after a push to main, every open phone moves to the new build without losing its save and without sitting on a
stale one, and what the pill says on the way is true. The problem: the update was four files with no table of which
step follows which (src/sw.js's install, src/edge/upgrade.ts's 4 s wait, src/core/upgrade.ts's decision, the pill's own
`caching` listener), and the worker counted a file that failed to cache as done and took over without it. The smallest
change that meets it: one machine in core (`src/core/upgrade.ts`: none, installing with its count, ready, reloading,
stuck) whose first event is the existing decision, run by `src/edge/upgrade.ts` as its one writer and read by the pill;
sw.js counts a failed file as failed (through the same core count) and then fails its install, so the browser keeps
the old worker.

Brief: `brief-implicit-unit.md`. Worktree `.claude/worktrees/agent-a10bbf03b20f40128`, branch
`worktree-agent-a10bbf03b20f40128`, from `claude/zen-pasteur-ov4cgd` at b0a27a8. Playwright port 3291. No browser run
before 23:23 (a timed CI pass held the box).

## Causes, one sentence each

- Row 29 (sw.js). The install caught each `cache.add` failure with `.catch(() => {})` and counted it as done, then
  called `skipWaiting`, so a worker whose cache lacked a file took over and deleted the old, whole cache on activate;
  offline at the table the app then opened with that file missing.
- Row 30. The update's steps lived in four places that did not know of each other: after a refusal `newWorkerInControl`
  resolved on `controllerchange` or after a fixed 4 s, whatever the worker was doing, so a slow install was cut off
  mid-count by a reload (the percentage stops), and a tab whose new worker had already taken over (or that had no new
  worker) waited the whole 4 s, because `registration.update()` answering "nothing new" resolved nothing.

## Data shape (before code)

- `Update`, one union on `at`: `none` (the tab runs its build), `installing { build, count: Count | null }` (refused;
  the new worker is looked for and followed, its count null until its first word), `ready { build }` (every file
  cached, waiting for the takeover), `reloading { build }`, `stuck`. Nothing else is kept: the pill's percentage is
  the count in `installing`.
- `Count = { done, failed, of }`, the worker's answer per file. `installOf(count)` is `failed` from the first failed
  file, `cached` when `done === of`, else `counting`. The worker (sw.js) and the tab read the same function.
- Events: `refused { decision }` (`decideUpgrade`, now also given `noted`, so "a tab that cannot keep its note is
  stuck" is core's rule and not an edge `||`), `looked { installing }` (the registration's update check), `caching
  { count }`, `controlled` (controllerchange), `quiet` (no word for `UPDATE_QUIET_MS`).
- Effects: `look`, `wait` (restart the quiet timer), `reload`, `stuck`. The edge carries them out.

Chart drawn before the table (on paper; the TLA+ run of the statechart skill was not used: it needs Java and the
network, and the walk of the real reducer by `bun run charts` draws the same graph from the code):

```
none --refused(reload)--> installing --caching(cached)--> ready --controlled|quiet--> reloading
none --refused(stuck)--> stuck
installing --looked(no worker) | caching(failed) | controlled | quiet--> reloading
```

## Variants weighed (on paper; a helper starts no helpers)

1. Keep a fixed wait, but longer (say 15 s). Rejected: still cuts a slower phone off, and makes the common case (no
   new worker, or one already in control) wait longer. The wait was standing in for "the worker is still working".
2. Wait only for `controllerchange`, no timer. Rejected: where workers are blocked `getRegistration()` may never
   answer, and a worker that dies silently would leave the tab on "Updating" for good.
3. (Chosen) A quiet timer restarted by every word of the worker, plus the registration's answer: reload at once when
   no worker installs, at the takeover when one does, at a failed file, or after 4 s of silence.

For the failed file: (a) the install goes on without it (the old behaviour), (b) the worker retries the file, (c) the
install fails and the browser keeps the old worker (chosen). (b) repeats what the browser already does at the next
load; (c) uses the browser's own rule that a rejected `waitUntil` discards the worker. The worker deletes its partial
cache before failing so nothing half-installed stays on the phone. The tab still reloads after a failed install: the
server refuses its build, and the reload fetches the new app from the network through the old worker (network first).

Where the audit was not followed to the letter: it named a new `src/core/update.ts`. The machine went into
`src/core/upgrade.ts`, beside the decision it absorbs, so the core and edge halves keep the one name that
`src/edge/sync.ts` (another helper's file) already imports; no file outside this unit changed. The chart file is
`scripts/charts/upgrade.ts` for the same reason.

## Principles that changed a choice

- principle-model-the-domain: the pill's own `caching` listener and the edge's promise-plus-timer became one union
  with one writer; the pill reads it (`updateNow`, `onUpdate`) instead of listening to the worker.
- principle-type-system-discipline: `Decision` is a union (`reload` carries its build), `Update` cannot hold a count
  outside `installing`, and the table's type asks for every cell.
- principle-boundary-discipline: the worker's message is read once by `countOf` at the edge; inside, `Count` is trusted.
- principle-fix-root-causes: the root of row 29 was the install's `.catch(() => {})`, not the activate that deleted
  the old cache; the fix is at the catch (count it as failed, fail the install), and a lint keeps the catch out.
- principle-test-behavior-not-implementation: `tests/sw.test.ts` runs the built sw.js (the bytes the server serves),
  not a copy of its logic, and checks what the browser can observe: what it posts, whether `waitUntil` rejects,
  whether it called `skipWaiting`, what is left in its cache.
- principle-prove-it-works: the bug of row 29 was reproduced first: the same test on the old sw.js answers
  `resolved` for an install with a failed file (Expected "rejected", Received "resolved").

## Rows

- Row 29 (sw.js). Cause above. Change: the install counts each file with `counted` (src/core/upgrade.ts), posts
  `{ type: 'caching', done, failed, of }`, waits for every file (`allSettled`, so the count reaches `of`), and when
  `installOf` is not `cached` deletes its own cache and throws, so `skipWaiting` is never called and the browser
  discards the worker. A failed offline copy in the fetch handler is now a `console.warn` in the worker, not silence.
  Test: `tests/sw.test.ts` runs the built sw.js with one file failing (fails on the old sw.js: the install resolved);
  lint "the service worker swallows no error". Commit 48bb310 (code), 7edeb63 (lint).
- Row 30. Cause above. Change: the machine in src/core/upgrade.ts with its chart (`scripts/charts/upgrade.ts`, in
  `MACHINES`, walked with `tests/models/upgrade-events.ts`); `src/edge/upgrade.ts` is its one writer and the one
  listener to the worker; `newWorkerInControl` and its fixed 4 s are deleted; the pill's `caching` let is deleted and
  the pill reads `updateNow`. Tests: `tests/upgrade.test.ts` (each rule, and a seeded walk of 2000 event orders: at
  most one reload, at most one stuck, never both); lint "only src/edge/upgrade.ts listens to the service worker".
  Commits 48bb310, 7edeb63.
- Row 29's other half (sync.ts's `register(...).catch(() => {})`) is U12's and in sync.ts, which this unit does not
  own: left.

## The browser proof, and what it does and does not prove

The earlier helper could not route the worker's own fetches. Two things made it possible here:

- Two builds from the test's own server: `bun server.ts` with `BUILD_SALT` '' then 'next' on `E2E_PORT + 15`, so the
  page is refused for real and the browser installs the new build's real sw.js (`tests/e2e/upgrade.e2e.ts`).
- Chromium's service worker network events (`PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS=1`, read by Playwright
  1.49's `crServiceWorker.js` when a worker starts): with it, `context.route` sees each request the worker makes, and
  `request.serviceWorker()` tells it apart. Each test that routes sets it and puts it back. The update check's own
  fetch of sw.js is still not routed; nothing here needs it.

Three new cases, each run on the old code first (its four files put back by hand, then mine restored):

| Case | Old code | New code |
|---|---|---|
| after a deploy the pill counts the new app's files up to 100% before the phone reloads | fails on its order check; inferred from the slow case's output, the same stale "Updating 100%" (the first install's count, kept since the page opened) came before 0 | passes |
| a phone whose new worker is slow keeps counting and reloads only once every file is cached (files 800 ms apart, 7.2 s in all) | fails: "the pill showed 100, 0, 10, 20, 30, 40, 50", the reload at 4 s cut the count at 50% | passes |
| a new worker that cannot cache a file (app.css aborted for the worker only) does not take over | fails: the old worker counted the failure as done, showed 100% and took over | passes: the page reloads into the new build, `caches.keys()` is the old build's cache alone, and once the file can be fetched the next load installs the new worker whole |

Proven: the pill's words follow the real worker's count to 100%; a slow install is not cut off; a failed file leaves
the old worker and its cache in place and the tab still reaches the new build; the browser drops a worker whose install
rejects (seen, not assumed). Not proven in a browser: the stuck path with a real worker (the two older cases cover it
with workers blocked), a worker that dies silently (only the quiet timer covers it, tested in core), and Safari or
Firefox, which Playwright's routing of worker requests does not reach.

A first run of the slow case failed through my test, not the app: the delays were counted from each request's arrival,
and Chromium sends the worker's requests a few at a time, so the gaps grew past 4 s and the quiet timer rightly
reloaded. The delays are now counted from the first request, and only a file's first request (the install's) is held.
Commit 3feedc3.

## Every browser file, one at a time (the lead's rule of Nov 15)

All 31 files but feel.e2e.ts, each alone on port 3291 (`--workers=1 --trace off`). 28 passed whole. Three failed, each
run again once:

- `character.e2e.ts:351` ("A missed daily shows one Penalized chip...") and `look.e2e.ts:67` (the Poisoned, Penalized
  hunter at 360 px) fail the same way twice: after the test sets `daily.lastCheckedKey` and reloads, no "Penalty Zone"
  window opens within 15 s. The first also fails with this unit's four source files put back as they were at b0a27a8,
  so it is not this unit's: it was already failing at the branch head. Not chased here (the day's clock is U5's, the
  window stack U6's); flagged to the lead.
- `phone.e2e.ts:298`, the 44 px sweep, failed 3 times in 10 runs on this branch (every control of one maker window
  read 43 px) and 0 in 7 with the four files put back. Cause: the sweep measured a maker while it was still coming in
  (`enter(win)` in `openMaker`, motion.ts's `below`, `scale(.98)`: 44 px reads 43). It waited only for the window to be
  visible. Whether this branch made it likelier (the runs on the old files were at another time of the box) is not
  known. The fix is in the test: wait for every finite motion on the page to end before measuring a maker. A file
  outside this unit, in its own commit.
