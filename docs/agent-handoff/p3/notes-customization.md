# notes: tests/e2e/customization.e2e.ts (8 tests)

custom-check.mjs
- 1 device prefs: kept (test 1: accent, text size, reload, export carries nothing; motion/haptics/sound toggles dropped as thin; --vib count dropped)
- prefs malformed/unparseable repair: kept (test 2, seeded devices)
- first-frame inline script probes, spike :3202 comparison, leaked globals: dropped (timing/old build)
- 2 identity picker: kept (test 3). Hostile emblem normalize, raw-remote badge escaping: dropped (internal normalize/XSS probe)
- 3 loadouts: kept merged (test 4): save, swap + sheet numbers, rename, cap lowered by GM rule keeps sets, unavailable item toast, fight rule (local encounter set via store; not a room fight). Overwrite/delete/malformed/dangling: dropped (internal shape)
- 4 build paths/perks: kept (test 5): choose, perk before/after, STR +2 / +5, AC +1, rank-B locked, auto-place, paid respec (cost, short gold, fight refusal, pay), respecGold and playerPick overrides. Tamper/normalize and picks-above-rank checks: dropped (internal)
- GM mode switches/override/free respec: kept (test 6)
- room-fight respec refusal (stubbed sync.doc): dropped, needs stubbing; local-fight refusal is covered
- gmMenu remote award, applyRewards, gm card path: kept via a real room (test 7). Old-app warning toast, hostile remote sheet cards, XSS: dropped (stubs / not player-visible)
- haptics, sheet bytes, 360px scroll, view walk, sizing, screenshots: dropped (layout/measurement)
prefs-leak.mjs: kept inside test 1 (second phone imports export, stays cyan/normal text).
fix3-build-doc-room.mjs: a (room doc published, default) and b/c kept in test 8 via UI (builds off reaches room, player follows, leaving restores defaults, GM keeps own). Dropped: "published once, not on every poll" (PUT count, 12s sleep), move to a room without a doc (needs bare POST + api join).

helpers to hoist: cssVar, tapWin, patchHunter, setRules, startLocalFight/endLocalFight, openDevice, openBuild.

Flaky: test 7 failed once in ~8 runs, twice with default 15-20s timeouts (card for Kai Test not appearing; once "Vanguard 0/6/1/6" on the GM card). Widened the sync waits to 45s, then 4/4 and a full run passed. No retries.
Mutation checks: test 5 (str +2 -> +3) and test 4 ('Full (2)' -> 'Full (3)') failed as expected, then restored.
No fixme.
