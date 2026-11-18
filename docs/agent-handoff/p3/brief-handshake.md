# Brief: build handshake (M2 unit 3)

Read `docs/agent-handoff/helper-rules.md` first. Where this brief and the rules differ, this brief wins.

You work in your own git worktree (your current directory), on your own branch. Run `bun install` there first. Commit there in small units as you go (plain commit messages, no AI attribution lines, no `.claude/`). Do not push. Do not touch `the repo root` itself.

Ports: run Playwright as `E2E_PORT=3231 bunx playwright test tests/e2e/<file> --workers=1 --output=/tmp/pw-handshake`. Port 3232 is yours for the extra server in test 3 below.

Notes file (write as you go, small increments): `docs/agent-handoff/p3/notes-handshake.md`.

## Why

The app is cached on phones by a service worker. After a deploy, a phone with the old app must not talk to the new server with an old wire format. The server refuses it, and the phone updates itself and reloads once.

## What exists

- `scripts/build.ts` builds the app. `buildApp()` returns `{ build, files }`. `build` is a 12-hex hash of every input file. The bundle and the worker get it as the compile-time constant `__BUILD__` (Bun `define`). `src/sw.js` already names its cache with it.
- `server.ts` builds once (`built()`) and serves the files. `api()` handles `/api/...`.
- `src/edge/sync.js` talks to the server. All requests go through `call()`. It registers the service worker near the bottom of the file.
- `tests/server-rooms.test.ts` calls `handler()` in process. `tests/e2e/room-sync.e2e.ts` and `tests/e2e/helpers.ts` are the browser test patterns.

## Design (decided, do not redesign)

1. **Client build id.** New file `src/edge/build.ts` (strict TS): `export const BUILD: string`, the value of `__BUILD__`, or `'dev'` when the constant is not defined (bun tests). Declare the global in `types/build.d.ts`.
2. **Header.** `call()` sends `X-Hunter-Build: <BUILD>` on every request to `/api/rooms...`.
3. **Server check.** Every `/api/rooms...` route (not `/api/health`, not `/healthz`) first compares the header with the server's own build. Missing or different: answer `426` with `{ error: 'upgrade', build: '<server build>' }` and do nothing else (no touch, no write, no presence). Same: carry on as today.
4. **Deploy seam.** `buildApp()` mixes `Bun.env.BUILD_SALT ?? ''` into the hash. A restart with a different salt is then a different build with the same code. Test 3 uses it.
5. **Pure decision.** New file `src/core/upgrade.ts` (strict TS, pure):
   `decideUpgrade(input: { clientBuild: string; serverBuild: string; reloadedFor: string | null }): 'current' | 'reload' | 'stuck'`.
   `current` when the builds match. `reload` when they differ and this tab has not yet reloaded for that server build. `stuck` when it already reloaded for that server build and is still behind.
6. **Edge.** New file `src/edge/upgrade.ts` (strict TS). One exported function that `sync.js` calls when a request fails with status 426 and reason `upgrade`. It reads and writes `sessionStorage['hunter-system-upgrade']` (the server build this tab last reloaded for), calls `decideUpgrade`, and then:
   - `reload`: store the server build in sessionStorage, ask the service worker registration to `update()` if there is one, wait until a new worker has taken control (`controllerchange`) or 4 seconds have passed, then `location.reload()`. It must work when there is no service worker at all.
   - `stuck`: no reload. Show one lasting banner through the store's notices or the existing banner area: "This app is out of date and could not update itself. Close every tab of it and open it again." Add that line to `docs/agent-handoff/copy-tasks.md` under a new heading "Phase 3 strings to review".
   While an upgrade is pending or stuck, `sync.js` sends no pushes and applies nothing. It must not treat the 426 as "room gone", "removed" or "locked", must not unbind the hunter, and must not change `settings.sync`. After the reload the phone is in the same room as before.
7. Keep `sync.js` changes small: the header, the 426 branch, and a flag that stops polling and pushing. M6 rewrites the rest of this file.

## Tests (write each test first, see it fail, then make it pass)

Bun, `tests/upgrade.test.ts`: `decideUpgrade` cases.

Bun, in `tests/server-rooms.test.ts` or a new `tests/server-handshake.test.ts` (the existing request helper needs the header, get the build from `buildApp()`):
- a request with no build header gets 426 and the server's build
- a request with another build gets 426
- a refused sheet PUT and a refused event POST leave the room unchanged (read it back with the right header)
- `/api/health` answers without the header

Browser, `tests/e2e/upgrade.e2e.ts`:
1. "a phone with an old app updates itself and is back in the room". GM and player in a room. The player device uses `blockServiceWorker: true`. With `page.route` rewrite the player's `X-Hunter-Build` header to an old value until the first 426 has come back, then stop rewriting. Expect: exactly one reload, the player is live in the same room, the hunter is unchanged, a change the player makes after that reaches the GM.
2. "a phone that cannot update says so and does not reload again". Same, but keep rewriting. Expect: exactly one reload, then the banner, and no second reload for 6 seconds (this fixed wait is allowed, nothing observable exists for "did not reload").
3. "after a deploy an open phone updates itself". The test starts its own server on port 3232 (`PORT=3232 bun server.ts` as a child process; add a narrow `node:child_process` declaration in `types/` if needed), opens the app with the service worker on, creates a room, then stops that server and starts it again with `BUILD_SALT=next`. Expect: the page reloads once, the page now runs the new build (the server's log line or `/api/health` is not enough: check what the page itself reports, for example a new service worker cache name through `caches.keys()`), the hunter is unchanged, and no console errors other than the ones you list in `allowConsole` with a reason. The room is gone after a restart (memory store), so the phone shows the existing "room is gone" state. Always stop the child server, also when the test fails.

Chromium logs a console error for every 426 response. Allow exactly that line in these tests with `allowConsole`.

## Done means

- `bun run test` passes (typecheck, bun tests, lint checks).
- `tests/e2e/upgrade.e2e.ts` passes three times in a row. `tests/e2e/room-sync.e2e.ts`, `tests/e2e/pwa.e2e.ts` and `tests/e2e/room-sync-fixes.e2e.ts` still pass.
- One mutation check per browser test (break the behaviour, see the test fail, restore), written down in the notes.
- Everything committed on your branch. Final reply under 200 words: branch name, commits, the last line of each command's output, anything unsure.

Stop and write notes if you are still going after 60 minutes of work.
