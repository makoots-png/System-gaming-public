# First-run clarity: progress (the lead's working file)

Written at the lead's second context compaction, as the run's prompt asks. A lead who starts cold reads this file, then
`design.md`, then the two briefs. Last updated: Nov 17, 23:45 local. **The run is finished: PR 37 is open.**

## Where the run is

| Step | State |
|---|---|
| Read the handoff docs, find what is in flight | Done. The other lead's next unit is feature 2 (solo runs), not started |
| Commit the two review files under `fresh-eyes/` | Done, de7bb8c3 |
| Baseline `bun run ci` | Done through the hook on an unchanged app (the push of this file, refused): `bun test` 3534 pass, 3 skip, 0 fail; browser 328 of 329 after the rerun; one test fails on this box with the headless shell and passes with the full Chromium, below. The lag test did not run. Nothing is on origin yet |
| Design | Done: `design.md` |
| Unit A (items 1 to 3), heavy-writer | Done and merged (132929b4): `notes-a.md`. Its own run of every browser file: 334 passed, 2 failed, both known (the notifications test without `E2E_CHROMIUM`, and the daily check below) |
| Unit B (item 4), writer | Done and merged: `notes-b.md`. The lead's review fixes are 2285a871 (the stat line stated once, the room's fall toast and the pips' label say down) |
| The daily check at register (found by both helpers as `save.e2e.ts:184`) | Fixed, cf1cea0e: the Quests view's first check runs on the app's `ready`; a browser test opens a save three days old |
| Before screenshots (from e7e68735) | Done, c894f562: `shots/before-*.png`, taken by `scripts/first-run-shots.ts` |
| Merge, deps map, charts | Done: both typechecks clean, `bun run test` green after the merge |
| After screenshots, the lead's look at each screen | Done: `shots/after-*.png`, each one read by the lead |
| Handoff docs (`handoff.md` section 8, `START-HERE.md`, `lead-report.md` section 14, `for-the-owner.md`, the trail) | Written |
| Push through the hook, PR into `claude/zen-pasteur-ov4cgd` | Done: PR 37, https://github.com/the-owner/systemgaming/pull/37, open and not merged. CI passed on a9deec6a through the hook: `bun test` 3574 pass, 3 skip, 0 fail; browser 339 passed; the lag test 6 passed. Two pushes were refused first, each by one test's own setup (`lead-report.md` section 14, "Checks"): fa7bceea, a9deec6a |

## The baseline CI's one failure, and its fix

`tests/server-start.test.ts` started the server as `bun server.ts` with `PORT=0`. Two faults, both in the test's setup:

- On this box `bun` on the path is a shell script that starts the real binary and waits. The test's `child.kill()`
  ended the script and left the server running, so every `bun test` left one server behind.
- `server.ts` read the port as `Number(PORT) || 3000`, so `PORT=0` meant 3000, not any free port. The server left
  behind held 3000, and the next `bun test` failed there with nothing wrong in the app.

The first CI pass failed one model test across a 119 s pause of the box, `ci.ts` ran the step again as it should, and
the second pass met the first pass's leftover server. Fixed: the test starts `process.execPath`, and `server.ts` takes
`PORT=0` as "any free port". Run twice in a row, the test passes and leaves nothing.

## This box needs `E2E_CHROMIUM` for one test

`tests/e2e/used.e2e.ts:220` (a GM who allowed notifications) fails here every time with Playwright's default browser,
the headless shell: `Notification.requestPermission()` answers `denied` there even after `grantPermissions`, so the GM
view reads "Blocked in this browser's settings." With the full Chromium Playwright also installed it passes:

```
export E2E_CHROMIUM=/opt/google/chrome/chrome
```

(Until 21:50 local on Nov 17 this was `~/.cache/ms-playwright/chromium-1148/chrome-linux/chrome`. The box was then
rebuilt: `node_modules`, `/tmp` and Playwright's downloaded browsers were gone. `bun install` brought the first back;
the box's own Chrome at `/opt/google/chrome/chrome` passes the notifications test, so nothing is downloaded.)

Set it for every Playwright run, `bun run ci` and `git push` on this box (AGENTS.md's rule for a machine with its own
Chromium). The hook's first CI ran without it: 5 browser tests failed across pauses of up to 3347 s, the rerun passed 4
and failed this one, so the push was refused.

## The design in short

`design.md` holds it. The calls: one room sentence and one About sentence in core (`src/core/first-run.ts`); a GM
creates a room, a player joins one, no other verb; the Room view is the one door and the Data view's room panel goes;
two new setup states, `hunterCreated` and `campaignReady`, show the confirmation and the role's next steps; 0 HP is
"down" everywhere; the Rules page's contradicted lines come from `src/core/rules-text.ts`, pinned by a test against
the game's own functions; the GM quick card is for a GM only.

## How the work is split

- Unit A works in `/workspace/sg-frc-a` on branch `frc-first-run`, browser tests on `E2E_PORT=3341`.
- Unit B works in `/workspace/sg-frc-rules` on branch `frc-rules`, browser tests on `E2E_PORT=3361`.
- The lead's tree `/workspace/sg-frc` stays clean so the pre-push hook can run. The lead merges both branches, then
  runs `bun run deps -- --write` and `bun run charts`.
- No helper runs a browser or the whole `bun test` while a `bun run ci` runs. Check with `pgrep -f "[s]cripts/ci.ts"`:
  without the brackets the check matches its own shell and always prints a pid. Both helpers were told at 20:30.

## What is left

Nothing of the run. The PR waits for the owner or the working-branch lead to merge it. The helpers' worktrees
(`/workspace/sg-frc-a`, `/workspace/sg-frc-rules`) are removed; their branches are merged.

The after screenshots were taken with `PORT=3301 bun server.ts &` in this tree, then
`bun scripts/first-run-shots.ts --url http://localhost:3301 --out docs/agent-handoff/frc/shots --tag after`
with `E2E_CHROMIUM`, the server stopped after.

## Rules of this run that are easy to lose

- Never `--no-verify`. No attribution lines in a commit or the PR body.
- Before any `bun run ci` or push: `ss -ltnp | grep -E ':(3000|3218|3233)\b'` and end what listens there and is
  this run's (other sessions keep servers on other ports: leave them), and export `E2E_CHROMIUM` as above.
- Nothing under `.claude/skills` is edited. No new dependency. No `playwright install`.
- Do not push to `claude/zen-pasteur-ov4cgd` or `main`.
