# room-onboarding.e2e.ts notes

Kept (6 tests):
- og-onboard 1 (invite link, real room): kept as test 1; merged with og-gm 8 (GM board shows the player).
- og-onboard 2 (no such room): kept as test 2 (error, name kept, button relabels, save unchanged, continue solo).
- og-onboard 4 (paste link into code field): kept as test 3.
- og-onboard 4b (wrong code, clear field): kept as test 4.
- og-onboard 6 geometry-adjacent "other options" path plus Back: test 5 (new scenario, back out of invite).
- og-gm 9 (leave and rejoin from GM tab, player still on board): test 6; also covers og-gm 7/8 create and board card.

Dropped:
- og-onboard 3 (server unreachable): needs page.route and service worker blocking; not in the requested list.
- og-onboard 5/5b (GM onboarding "Open a room" step, conn off): reads sync.conn internals; not requested.
- og-onboard 6, og-gm 10 (geometry, 44 px targets), screenshots: layout.
- og-gm 7 strip text, invite calls go(room), status-off strip empty: wrapped go()/sync.status internals.
- Removed-main comparisons: none present.

Mutation checks done: test 1 (card count 2) and test 2 ('Try againX') both failed, restored.

Flaky: none in 3 runs plus 1 more. Test 1 took 52 s once (cold start of first run), 9 s otherwise.

tsc: my file is clean. `bunx tsc --noEmit` currently fails only in tests/e2e/room-sync-fixes.e2e.ts (another helper's file: Page not exported from helpers.ts, implicit any).

Helpers to hoist: gmWithRoom, openInvite, toPlayerStep, rawSave (top of the file). `Page` should be exported from helpers.ts.
