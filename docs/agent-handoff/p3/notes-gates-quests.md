# gates-quests-dailies.e2e.ts notes

- Ported game-check-b 1a-1d, 2a, 2b, 3a, 3b, 4a, 4b, 10, 12 and ga-level-hole as 13 tests (12 run, 1 fixme).
- FIXME (app bug, still present): ga-level-hole. Start Lv1 STR 14. Award +500 XP -> Lv3, 6 points. Spend 6 on STR -> STR 20, 0 points.
  Award -500 -> Lv1. Award +500 again -> Lv3, STR 20 and 6 unspent points again: 6 free points. The test expects STR + points unchanged (20).
- Timezone: the device fixture has no timezone option, so the test sets America/New_York through a CDP session (Emulation.setTimezoneOverride) and page.clock.install.
- Run with --output <private dir> when other helpers run Playwright at once: a shared test-results dir gets cleaned under you (ENOENT on trace files).
- helpers.ts not changed.
