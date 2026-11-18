# Shared brief for the M1 port helpers (round 2 of ports)

Phase goal in one line: the app is about to be restructured (TypeScript core, explicit state machines, new sync link machine, new save format), and these tests are the safety net that must keep passing through it.

FIRST read `docs/agent-handoff/helper-rules.md` and follow it.

## Your job

Port an old one-off check script (Playwright driven from plain node, lives in `docs/agent-handoff`) into a committed test file in `./tests/`. Your task line names the source script(s), the target file and the cap on the number of tests.

## What to keep and what to drop

The owner asked for a small safety net, not a full port. Be strict.

Keep a check when a player or GM at the table would notice it breaking: the wrong number, a lost change, a join that fails, a button that does nothing, data that vanishes.

Drop a check when it:
- measures pixels, overflow, tap-target size or layout (a screenshot script covers those),
- compares against the old `main` build on `:3100` or an old server,
- reads internal fields that the rewrite will change (`encounter.turn`, `encounter.begun`, `gate.xpPaid`, module variables in `sync.js`, the service worker cache name) when the same thing can be asserted on screen. Assert on screen instead, or drop it,
- is already covered. Existing tests are listed in `docs/agent-handoff/p3/existing-tests.txt`. Read the existing file if a name looks close.

Stay under the cap in your task line. Fewer good tests beat many thin ones. Merge related old checks into one scenario with `test.step`.

## Files

- Write only your target file and your notes file. Do not edit `tests/e2e/helpers.ts`. If you need a new shared helper, define it at the top of your own file and list it in your notes under "helpers to hoist".
- Notes file: `docs/agent-handoff/p3/notes-<target-name>.md`. Write it as you go: each old check and whether you kept, merged or dropped it and why (one line each), any `fixme`, anything flaky.

## Verify

- `cd the repo root && bunx tsc --noEmit` passes.
- Browser tests: `bunx playwright test tests/e2e/<file> --workers=1 --output=/tmp/pw-<name>` passes three times in a row. If a test fails once in three, say so in the notes with the failure text. Do not add retries.
- Mutation check for at least two tests: temporarily change the expected value (or the action) and see the test fail, then restore it. A test that cannot fail is worth nothing. Note which ones you checked.

## Reply

At most 200 words: tests kept and dropped (counts), the command and its last output line, any `fixme`, anything unsure.
