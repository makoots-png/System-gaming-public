# Brief: finish the link unit and harden the browser tests (M6, last unit)

Read `AGENTS.md` and `docs/agent-handoff/helper-rules.md` first (its last section names the principle skills: here `principle-fix-root-causes`, `principle-build-the-lever`, `principle-test-behavior-not-implementation`, `principle-prove-it-works`). Where this brief and the rules differ, this brief wins.

You work in the repo root on the branch that is checked out. Commit after every numbered step (name the files you add, plain messages, no AI attribution lines). Do not push. Do not start helpers of your own. Never edit anything under `.claude/skills`.

Another helper is changing leveling and ability points in a separate worktree (`src/core/hunter/progress.ts`, the hunter part of `src/core/save.ts`, points writers in `src/views/hunter.js`, `quests.js`, `gm.js`, and the ability-point test at the end of `tests/e2e/gates-quests-dailies.e2e.ts`). Do not edit those app files, and in that test file touch only what step 3 needs.

Browser runs: `E2E_CHROMIUM=/opt/pw-browsers/chromium E2E_PORT=3241 bunx playwright test tests/e2e/<file> --workers=1 --trace off --output=/tmp/pw-link`. Do not run `playwright install`.

Notes file (append a line after each commit): `docs/agent-handoff/p3/notes-link.md`, under a new heading for this unit.

## Why (the owner's goal)

The test suite is the safety net for a large refactor and for every feature added later, so a hole in it costs more than the code it guards. The sync edge now runs on two model-checked machines (`src/edge/sync.ts`, `src/core/sync/`), and the previous helper ran out of time before the last browser tests. Separately, one browser test failed now and then because its helper looked for a popup before the app had opened it (`docs/agent-handoff/p3/notes-jobchange-flake.md`); about 60 other call sites may have the same gap.

Read first: `docs/agent-handoff/p3/brief-link.md` (unit B, steps 5 and its rules), the section "Where unit B stopped" in `docs/agent-handoff/p3/notes-link.md`, and `docs/agent-handoff/p3/notes-jobchange-flake.md`.

## Steps

1. The rest of unit B's step 5: the three browser tests that are missing (the notes say which of the four exist), named for what the person sees: a sheet the server refuses shows as not sent while the room stays live; a GM whose key stops working is told and leaves the room; leaving and rejoining the same room never shows the old room's data. Then bring the widened room waits in `customization`, `room-view` and `room-sync-fixes` back to the 15 s default and confirm each file passes twice.
2. The open issue from the notes: "Replace campaign" in `src/views/io.js` replaces the save without the link knowing until a reload. Reproduce it as a failing browser test first (`tdd`). Fix it at the root: the link learns that the stored room changed through an event of the machine (add one to `src/core/sync/link.ts`, with a reducer test, and let the model check send it), not through a reload and not through a guard in the view.
3. Harden the suite against the popup gap, with a lever, not by hand:
   - In `playwright.config.ts` set `actionTimeout` to 15 s, so a tap blocked by a window fails in 15 s and its error names what is in the way.
   - Add a test-only lever that delays every System window and confirm dialog by 100 ms (the flake notes describe the lever that was used; make it an env variable read in one place, off by default, documented in AGENTS.md under "Tests").
   - Run the whole suite once with the lever on (`E2E_PORT=3241`, 2 workers is fine for this run). Every failure is a place where a test taps past a window it did not wait for. Fix each in the test by waiting for the window the player sees, or by fixing the shared helper in `tests/e2e/helpers.ts` when the gap is there (for example a `dismissAll` that should wait for a named window first). No fixed waits, no retries, no wider timeouts. If a failure turns out to be an app race a player could hit, stop and describe it in the notes instead of papering over it in the test.
   - Run the suite again with the lever on until it passes, then once with it off. Record the three results (failures before, after, and the normal run) in the notes.
4. Run `bun run test` and the full `bun run ci` (`E2E_CHROMIUM=/opt/pw-browsers/chromium bun run ci`, it uses port 3218) once at the end and quote its last lines.

## Done means

- `bun run ci` passes. Final reply under 200 words: what you made, how many popup gaps the lever found and where, the last lines of `bun run ci`, anything you were unsure of or left out.

If a step turns out to be wrong or much larger than it reads, stop, write why in the notes file and reply. Do not widen the task. If you are still going after about 70 minutes of work, commit what passes, write exactly where you are in the notes, and reply.
