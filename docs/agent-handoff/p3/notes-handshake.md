# Notes: build handshake (M2 unit 3)

Worktree: ./.claude/worktrees/agent-a4138a005b5691b9d, branch worktree-agent-a4138a005b5691b9d.

- The worktree was created at main (8b41075), not bb51420. bb51420 is a descendant, so I fast-forwarded the
  untouched branch to it (`git merge --ff-only bb51420`). Nothing was lost.
- Two existing browser tests call `/api/rooms` with `page.request` (room-sync-fixes.e2e.ts, customization.e2e.ts).
  They need the build header now. Plan: sync.js sets `hunterApp.build`, helpers.ts gets a helper that reads it.
- Banner goes through the store's notices: small `store.notify()` added to src/edge/store.js (not in the brief's file
  list, but the brief names "the store's notices" as the way).

## Progress
- Commit 1: server 426 check, BUILD_SALT, core/edge upgrade, sync.js header + flag, bun tests (saw them fail first: 6 fail + missing module, then 72 pass).
- Commit 2: tests/e2e/upgrade.e2e.ts (3 tests), helpers `roomHeaders(page)` and `onboardGM(page, path)`, header added to the two `page.request` calls.
- First e2e run: all 3 failed, for real reasons (not a pause):
  1. With workers blocked by Playwright `getRegistration()` never answers. The 4 s timer now covers the whole wait.
  2. `bun` on this box is a /bin/sh wrapper, so `child.kill()` left bun.exe running on 3232 (I killed that one leaked pid by hand). The test now spawns detached and stops the process group, and checks the port is free before start and after stop.
  3. Rewriting only the request header leaves client build == server build, so decideUpgrade says `current`. The edge treats a refusal with equal ids as "header did not arrive": same once-only guard (reload once, then stuck). UNSURE: this branch lives in src/edge/upgrade.ts, not in decideUpgrade, because the brief fixed the signature.
- After those fixes: 3 passed (59.0s).
- Copy line added to docs/agent-handoff/copy-tasks.md under "Phase 3 strings to review".

## Mutation checks (each restored afterwards, tree clean)
- Test 1: removed `location.reload()` in src/edge/upgrade.ts -> failed (loads expected 1, received 0).
- Test 2: reloadedFor() read a wrong sessionStorage key (guard forgotten) -> failed (loads expected 1, received 243).
- Test 3: server refused only a missing header, not a different build -> failed (loads expected 1, received 0).

## Verification
- upgrade.e2e.ts three runs in a row: 3 passed (55.5s), 3 passed (43.7s), 3 passed (43.7s).
- room-sync, pwa, room-sync-fixes, customization together: 18 passed, 1 failed (room-sync.e2e.ts, took 1.6m instead of ~30s: looks like a box pause). Rerun alone: 1 passed (33.9s). No waits changed.
- Not run: the other e2e files and `bun run ci`.
