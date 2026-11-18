# room-view.e2e.ts notes (8 tests)
Sources: r-view.mjs, rv-ui.mjs.
Kept/merged:
- r-view 1 (create, code, QR visible, enlarged QR, copy feedback) -> test 1. QR decode, whole-pixel checks dropped (qr.test.ts + layout). Share button only-if-navigator.share dropped (env dependent).
- r-view 2 (wrong code, fix, join, roster) -> test 2. r-view 3 (paste, Enter) -> test 3.
- r-view 7 (manage, remove, allow back) -> test 4. r-view 9 (several hunters) -> test 5.
- r-view 4 + 11 (invite card, Data panel openroom, joinDialog card) -> test 6. joinDialog is called as a setup helper only.
- r-view 5, 8, 6 (leave/rejoin last, offline, gone notice) -> test 7.
- rv-ui F5a, F8 (GM strip) -> test 8.
Dropped: r-view 10 layout; recentKicks/roster()/bound() internals (asserted on screen); rv-ui F1,F3,F4,F6,F7,F9,F10,F11,F13 and F2, F5b (onboarding/caret/focus/busy/sync.js internals; F4/F6/F7 are timing heavy, F7A needs a 31s wait). Kicked message kept in test 4. The "locked" message needs two devices claiming one hunter: not in old scripts, not added.
Mutation checked: test 2 (No room text), test 4 (removed window title), test 8 (POST count): all failed, restored.
Flaky: test 3 took 54s once on the first run (passed), 8s on the next runs. Cause not found. Runs 2 and 3 clean.
tsc: my file is clean; errors are in tests/e2e/room-onboarding.e2e.ts (another helper).
Helpers to hoist: gmCreatesRoomInView, playerJoinsInView, openRoomView.
