# Brief: the fight's 12 second grace window becomes data (sweep entry 3)

One helper (Opus, heavy-writer), in the repo root on the checked-out branch. No other helper writes app code in this tree.

Read `AGENTS.md` and `docs/agent-handoff/helper-rules.md` first (here `principle-model-the-domain`, `principle-make-operations-idempotent`, `principle-boundary-discipline`, `principle-test-behavior-not-implementation`, `principle-fix-root-causes`). Where this brief and the rules differ, this brief wins.

Commit after every numbered step (name the files you add, plain messages, no AI attribution lines, no Co-Authored-By). Do not push. Do not start helpers of your own. Never edit anything under `.claude/skills`.

Browser runs: `E2E_CHROMIUM=/opt/pw-browsers/chromium E2E_PORT=3241 bunx playwright test tests/e2e/<file> --workers=1 --trace off --output=/tmp/pw-seen`. Never run `playwright install`. If a browser test fails once, rerun that file once before reading anything into it.

Notes file (append a line after each commit): `docs/agent-handoff/p4/notes-seen.md`.

## Why (the owner's goal)

"No implicit state machines anywhere." "A very clear trace from each feature to what it depends on."

`src/views/combat.js` keeps `lastSent` (a Map from a remote hunter's key to the time the GM last sent that hunter a change) and `SENT_GRACE = 12000`. For 12 seconds after the GM changes a remote hunter's HP, MP or status, the `sync:sheets` handler ignores that player's pushed sheet, so a sheet the phone pushed before it applied the change does not undo the change on the GM's board. It is a timer standing in for the question "has this sheet seen my change?". It is wrong for a phone slower than 12 seconds (the stale sheet overwrites the GM's number until the next push) and it holds back a fresh sheet for up to 12 seconds for no reason.

## The decided model

The data already answers the question.

- The server gives every room event a `seq` and answers a send with `{ seq }` (`server.ts`).
- A phone keeps `settings.sync.cursor`, the seq it has polled through (`src/edge/sync.ts`).

So:

1. A player's pushed sheet says how far that phone has applied the room's events: a field `seen` (a non-negative integer, the cursor) next to the hunter in the sheet. `parseSheet` in `src/core/protocol.ts` reads it bounded; a sheet without it is refused or reads as 0, whichever the parser's existing style gives (old clients cannot connect, so there is no old shape to keep).
2. The GM's fight remembers, per remote hunter, the seq of the last event it sent that hunter (`lastSent: remote key -> seq`), taken from the send's answer. While a send is out and has no seq yet, that remote is pending.
3. The `sync:sheets` handler refreshes a remote hunter's proxy from a sheet only when the remote is not pending and `sheet.seen >= lastSent` (or nothing was sent). `SENT_GRACE` and every `Date.now()` in this path are deleted.

The safe direction matters. A sheet may claim less than it has applied (the GM waits one more push). It must never claim more: `seen` may reach N only when every event up to N that changes this hunter is already in the hunter the sheet carries. Step 1 checks which order `sync.ts` applies events and saves the cursor in, and where the sheet is built.

If step 1 finds that this model cannot hold (for example the cursor is saved before the appliers run and cannot be reordered, or a failed send never tells the caller), stop and write why in the notes. Do not fall back to a timer.

## Steps

1. Read only, then write the findings at the top of the notes file: where the cursor is saved relative to the appliers (`src/edge/sync.ts`, the `polled` and `apply` effects and `APPLIERS` in `src/edge/room-events.ts`); where a sheet is built and sent (`sendSheet`), and whether it reads the save at send time; what `app.api.sync.send` returns and what it does on a failed send (queued, retried, dropped); what `remoteList()` and `RemoteSheet` in `src/core/api.ts` hold; every caller of `sendRoom` in `combat.js`; the copy of `sendSheet` in `tests/models/room-world.ts`. Say in two lines whether the model above holds and what, if anything, must be reordered.
2. Failing tests first, committed red is fine for this one commit only if they are in the same commit as nothing else, otherwise commit them with step 3:
   - `tests/protocol.test.ts`: the sheet's `seen` in `VALID` and a case per bound.
   - `tests/models/room-world.ts` and `tests/room-system-model.test.ts`: a new invariant over every interleaving: the GM's view of a remote hunter (what the handler would write to the proxy) never goes back to a value older than the GM's last sent change. Model the GM's rule as the pure function of step 3, not a copy of it.
3. The rule as a pure function in `src/core/` (for example `freshFor(sent, seen)` beside the sheet push in `src/core/sync/`, or where the dependency map says it belongs), with unit tests: nothing sent, pending, seen below, seen equal, seen above.
4. Wire it: the sheet field in `protocol.ts`, `sendSheet` in `sync.ts` and its copy in the room model, `RemoteSheet` in `api.ts`, `sendRoom` and the `sync:sheets` handler in `combat.js`. Delete `SENT_GRACE`. If `sync.send` does not hand back the seq today, make it (typed in `AppApi`).
5. A browser test in the file that already covers the GM changing a remote hunter in a fight (grep `tests/e2e` for the HP change to a remote hunter): the GM sets a remote player's HP in a fight; the GM's card keeps the new number through the player's next pushes and the player's phone shows it. If an existing test already asserts exactly this, name it in the notes and add nothing. A test that waited out the 12 seconds loses its wait.
6. A lint rule in `tests/lint.test.ts` only if the bug class can come back by a grep-able pattern (a `Date.now()` compared against a sent time in a view is one). If no honest pattern exists, say so and add none.
7. `bun run test`, `bun run deps -- --write`, the browser files `tests/e2e/room-sync.e2e.ts`, `tests/e2e/room-sync-fixes.e2e.ts` and the one from step 5, then the full `E2E_CHROMIUM=/opt/pw-browsers/chromium bun run ci` once. Update the line about the fight in `AGENTS.md` only if something it says became untrue.

## Rules

- What a player or GM sees does not change, except that the GM's card follows a fresh sheet at once and is never overwritten by a stale one.
- No parallel old and new paths. No timer.
- A GM reload loses `lastSent` today and may still do so: say in the notes what the board shows then (the next sheet wins), and do not add saved state for it.

## Done means

`bun run ci` passes. Final reply under 200 words: what you made, the last lines of `bun run ci`, anything you were unsure of or left out.

If you are still going after about 75 minutes of work, commit what passes, write exactly where you are in the notes, and reply.
