# notes-save (tests/e2e/save.e2e.ts, replaces save-compat.mjs)

5 tests: 4 run, 1 fixme. Fixtures copied to tests/fixtures/saves/: v1-save.json (0.7 KB, key hunter-system-v1), main-player.json (2 KB, key hunter-system-v2), main-gm-starter.json (16 KB, key hunter-system-v2), main-export.json (29 KB, an export file used through the Data panel import). None is over 60 KB. main-gm-starter.backups.json was not copied because nothing uses it now.
Fixture paths come from `test.info().project.testDir`, so no new node built-in was needed (readFile is already declared). types/bun.d.ts is unchanged.

## Old checks
- load:main-gm-starter: merged into test 1 as a step. It now compares only the short list a player cares about (name, level, xp, job, rank, stats, gold, item names and counts, skill names, quest titles and status) for every hunter, plus the active hunter on the Status sheet and Inventory. The deep diff of the whole save was dropped because it pins the internal shape.
- load:main-player: merged into test 1 as a step, same comparison.
- migrate:v1: merged into test 1 as a step. It checks name, level, xp, job, stats, items, skills and quests (text and done) on screen and in the save. Dropped: the check that the raw v1 key is untouched, the pre-migration backup and its contents, hpMax/mpMax derived and title, because all of these are internal or migration details.
- import:main-export (store.importJSON): dropped. The UI import covers it.
- import-ui:main-export: kept as test 2, step 1 (Data panel, preview, Replace campaign).
- export-roundtrip: kept as test 2, steps 2 and 3. The Export button download is imported on a fresh second phone, then the hunters are compared with the fixture. The diff of the whole export was dropped.
- restore:backup: dropped. It is covered by character.e2e "Restoring a backup keeps the skill cooldown..." and it is not the promise being pinned.
- junk-tolerance (unknown keys preserved): dropped, because the next milestone's one-way migration may drop unknown keys.
- walkViews / healthy (readOnly, saveOk flags): dropped as internal. The "no error window" check (no banner, no system window) replaces them. The console check comes from the device fixture.
- New: test 3, a save that is not JSON. New: test 5, a change survives a reload.

## Corrupt saves: what the app does today
- Not JSON, or JSON that is not an object (`[1,2]`, `null`): the app opens with the starter hunter "Sung Jin-Woo" and shows the banner "Your save was unreadable and has been moved to the backups...". The raw text is kept as a "corrupt" backup that is listed in the Data panel. This is sane, so test 3 asserts it. The backup cannot be restored, because restore parses it and fails quietly, but the text is not lost.
- An object of the wrong shape, e.g. `{"schema":2,"hunters":{"h1":{...}}}`: this is bad behaviour. normalize() drops the non-list hunters without a word, active() adds a starter hunter, and persist() overwrites the original. There is no banner and no backup. The io.js daily backup is taken after the normalize, so it holds the already-emptied save. This is silent data loss. Test 4 is `test.fixme` and asserts the sane outcome: a banner, and the original text kept somewhere in localStorage. Un-fixmed today it fails as expected (no banner).

## Verify
- `bunx tsc --noEmit` passes.
- `bunx playwright test tests/e2e/save.e2e.ts --workers=1 --output=/tmp/pw-save` passed 3 times in a row, plus a 4th run: "1 skipped, 4 passed (15.3s)".
- Flaky once, before those runs: in the first full run, test 1 timed out (120 s) in `page.goto(..., networkidle)` inside openApp for the main-gm-starter step. The same test passed alone right after, and in every later run. The cause is unknown, maybe load on the shared box. Watch it.
- Mutation check, all failed as expected and then restored: v1 quest status expectation (test 1), +1 gold on an expected hunter (test 2), expected name after reload (test 5), and the fixme run un-fixmed (test 4).

## Helpers to hoist
- `whatPlayersKeep(hunter)`, `expectSheetShows(page, ...)`, `importThroughDataPanel(page, file)`, `fixturePath(name)`. They are local to save.e2e.ts for now.
