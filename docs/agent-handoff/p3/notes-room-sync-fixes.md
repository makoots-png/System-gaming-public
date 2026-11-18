# room-sync-fixes notes
Target: tests/e2e/room-sync-fixes.e2e.ts, 7 tests, all through the Room/GM tab UI.

rv-sync.mjs
- F5 create() twice makes one room: dropped (calls sync.create() directly twice; no UI path, double-tap is guarded by a busy flag).
- S2 parseInvite cases: dropped (pure function call on sync.js; belongs in a unit test, not a browser test).
- S1 failed GM-key request must not make GM a player: kept (test 4, 502 on keyed GET via Join; asserts lobby, mode gm, no sheet in the server room, retry works). abort variant and exported join() variant merged/dropped.
- S1e wrong key still joins as player: kept (test 5; asserts no GM tools/roster, isGM false; ring entry removal not asserted, internal).
- S4 locked survives leave/create/rejoinGM: kept in reduced form (test 6: claimed note shown, gone after leave + Create room). rejoinGM variant dropped.
- S3 rejoinGM on a gone room: kept (test 2: typed key, GM tab Open as GM, last-room "is gone"). Peek-only request count and cached-found check dropped (request internals); the fixture's console check covers "no console error".
- S7 hanging requests -> reconnecting -> live: dropped (cap); setOffline in test 7 covers reconnecting/live.
- F3 invite code survives reload: dropped (sessionStorage internals, pendingRoom).
sync-test.mjs: all steps already in room-sync.e2e.ts. Added from the same area: kick/allow back (test 1), GM leave/rejoin (3), offline both ways (7), player leave/rejoin (6).

Mutation checks: test 7 (hp-5 instead of hp-10) and test 4 (sheets toEqual ['x']) both failed; restored.

Flaky/slow: three runs, 21/21 passed. Test 4 took 1.6 min once (run 2) and test 6 20 s, box was shared; passed anyway. Test 7 waits up to 40 s for live after setOffline(false).
Helpers to hoist: gmWithRoom, playerInRoom, gmKey, sheetsInRoom, removedWindow, kaiCard.
