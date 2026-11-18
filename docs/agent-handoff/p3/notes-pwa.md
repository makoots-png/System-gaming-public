# notes: pwa.e2e.ts (3 tests)
- Fixture: `device` creates contexts with serviceWorkers 'allow' unless blockServiceWorker is set, so no own context was needed. helpers.ts untouched.
- Installable (manifest linked, name, start_url, display, icons load, one >=512): kept as test 1. Merged old (a) and (d).
- Offline boot shows the hunter: kept as test 2 (old (c)); asserts name field on the sheet.
- Offline change survives reload: new test 3 (job text + HP -5 offline, reload offline).
- Dropped: cache name, SHELL list, cache contents (b), icon declared-size equality, CDP installability errors (Chromium-internal), console error check (fixture does it), injecting proxy.
- Mutation checked: changed expected name and job values; tests 2 and 3 failed, restored.
- Runs: 3 of 3 passed. Test 1 icon check requires width >= 144 (no exact size).
- Helpers to hoist: installedAndControlling, reloadOffline (local to file).
