# Brief: the room link and the sheet push as two explicit machines (M6)

Two units, one helper each, one after the other. Unit A is the pure machines with their tests and model check. Unit B puts `src/edge/sync.js` on them. Your prompt says which unit is yours.

Read `AGENTS.md` and `docs/agent-handoff/helper-rules.md` first (its last section names the principle skills: for this task `principle-model-the-domain`, `principle-type-system-discipline`, `principle-make-operations-idempotent`, `principle-separate-before-serializing-shared-state`, `principle-test-behavior-not-implementation`, `principle-explain-the-number`). Also read `.claude/skills/statechart/SKILL.md` for how to lay a machine out. Where this brief and the rules differ, this brief wins.

Commit after every numbered step (name the files you add, plain messages, no AI attribution lines). Do not push. Do not start helpers of your own. Never edit anything under `.claude/skills`.

Notes file (append a line after each commit): `docs/agent-handoff/p3/notes-link.md`.

## Why (the owner's goal)

No implicit state machines, and a clear trace from every feature to what it depends on. `src/edge/sync.js` is the largest one left. `docs/agent-handoff/p3/sync-state-inventory.md` is an exact inventory of it, written for this unit: read all of it before anything else. In short: about 15 module-level variables; the connection shown to the user is an ordered ternary over four of them; "joining" has no flag at all; create, join, rejoin and leave each reset a different subset; the sheet push, `send` and `putDoc` all write the link's `failing` flag; a late network reply is checked against the room code or nothing, so leaving and rejoining the same room inside one request accepts a stale reply; and the link never backs off. Fourteen sync findings from an earlier review were deferred to this unit (inventory section 6).

Old rooms and old clients do not need to work. What a player or GM sees must stay the same except where this brief says otherwise.

## The model (decided; say in the notes if something cannot work)

Two files in `src/core/sync/`, strict TypeScript, pure: `link.ts` and `push.ts`. Each is a union plus one `reduce(state, event): { state, effects }`. No clock, no random numbers, no network, no storage: time arrives as events (`timerFired`), ids arrive in events, and everything outward is an effect the edge carries out.

**Link.** A union on `at`:

- `off`: this host has no room server.
- `idle`: not in a room. Carries what is known about the server (`unknown`, `ok`, `unreachable`) and `last: null | { code, why: 'left' | 'gone' | 'removed' }` (the room this phone was last in and why it is not in it now; this replaces `lastRoom.gone`, the `roomGone` flag and the unmarked "removed" case).
- `creating`, `joining` (with the code, whether as GM or player, and the step it is on): real states, so the pill and the buttons can show them and a second tap has a defined answer.
- `live`: in a room. Carries the room code, the role, the cursor, and `health: 'ok' | { failed: n }` (n failed polls in a row).
- `upgrading`: another build's server answered. Absorbing. `stuck` is true when the reload did not help.

Every request the link asks for carries a generation number `gen`. Entering `creating`, `joining`, `live` or `idle` takes a new `gen`. A reply whose `gen` is not the current one changes nothing. That is the whole late-reply rule, with no room-code comparisons.

Poll timing: while healthy, every 5 s (3 s during a fight, as today). After a failed poll the next try waits 5, 10, 20, then 30 s, and stays at 30 s. Reason for the number: a phone that lost the network should not wake the radio every 5 s for an hour, and 30 s is the longest a table waits for a phone to come back without anyone tapping. `online`, the page becoming visible and "Try now" retry at once and reset the wait.

**Push.** A union on `at`: `off` (not a player in a live room), `clean`, `waiting` (changed, a timer is set), `sending { changedSince: boolean }`, `backoff { fails, kind: 'net' | 'server' }`, `rejected { why: 'too-large' | 'room-full' | 'bad' }`, `locked` (not your sheet). Its requests carry the link's `gen`, so a reply from a room this phone has left changes nothing. Backoff stays 3, 6, 12, 24, 48, 60 s (today's numbers; say in a comment what each bound is for).

**Between them.** The push never writes the link. The push is told when the link enters or leaves `live` as a player (events `linkLive`, `linkLost`) and when a poll succeeds. "Removed by the GM" is a link event, raised by the edge when a push or a poll says so. What the pill shows is one pure selector, `connection(link, push)`, so a sheet that could not be sent reads as that and not as "reconnecting".

**Effects** (one union per machine, exhaustive): requests with their `gen`, `setTimer { name, ms }` and `clearTimer { name }`, `save { fields }` (the stored room, cursor, last room, GM key), `notify` (toast or window, by id, text stays in the view), `status` (tell the views).

## Unit A: the machines (pure, no browser)

You work in your own git worktree (your current directory) on your own branch. First run `git log -1 --format=%H`; if it is not the commit your prompt names, `git reset --hard <that commit>`. Then `bun install`. Another helper is editing `src/edge/sync.js`, `src/core/protocol.ts` and views in the main tree: you create only `src/core/sync/*.ts`, `tests/link*.test.ts`, `tests/push*.test.ts` and your notes file, and you edit nothing else.

1. Read the inventory in full, then `src/edge/sync.js` where you need the detail. In the notes, map every inventory situation (L1 to L11, M1 to M3, P1 to P10) to a state of the model, and every transition row to an event. Anything that does not fit, say so before you write code.
2. `tests/link.test.ts` first, then `src/core/sync/link.ts`: one test per behaviour a player or GM relies on (create, join as player, rejoin as GM with a key, a wrong key, a room that is gone, removed by the GM and allowed back, leave, forget, the failing and recovering poll with its waits, upgrade). Name tests for what the person sees.
3. `tests/push.test.ts` first, then `src/core/sync/push.ts`: change then send, a change while sending, each failure and what comes next, Try now, locked and its retry, leaving the room mid-send.
4. The 14 deferred findings (inventory section 6), each as a named reducer test that would have failed on the old behaviour. Where a finding no longer applies, say why in the notes instead of writing an empty test.
5. A breadth-first model check in `tests/sync-model.test.ts` (no dependency; `principle-build-the-lever`): explore every reachable pair of link and push state from boot, over a finite alphabet of events (user taps, each kind of reply with a current and a stale `gen`, timers, online and offline), to a depth that finishes in under 20 s. Assert at every state:
   - a reply with a stale `gen` leaves both states unchanged;
   - at most one poll and at most one sheet send are outstanding for the current `gen`;
   - no dead ends: every state other than `off`, `upgrading`, `rejected` and `locked` has a timer set, a request outstanding, or is waiting for a tap that the UI offers there;
   - a changed sheet in a live room is sent or scheduled, and the time to the next attempt is never more than 60 s (this bounds the "change arrived 50 s late" report, bug 2 in `p3/bugs-found.md`);
   - after `leave`, no timer and no request of the old room remains, and the push is `off`;
   - `upgrading` is never left.
   When it finds a failure, print the shortest event sequence, fix the machine, and keep the sequence as a named test. List what it found in the notes.
6. Mutation check: break three rules by hand, one at a time, and confirm a test fails each time. Restore. List them in the notes.

Done means: `bun run test` passes. Final reply under 200 words: your worktree path and branch, commit hashes, test counts, the number of states and transitions the model check explored and what it found, anything in the inventory that did not fit the model.

## Unit B: the sync edge runs on the machines

You work in the repo root on the branch that is checked out. No other helper is running. Browser runs: `E2E_CHROMIUM=/opt/pw-browsers/chromium E2E_PORT=3241 bunx playwright test tests/e2e/<file> --workers=1 --trace off --output=/tmp/pw-link`. Do not run `playwright install`. If a browser test fails once, rerun that file once before reading anything into it.

Read first: this brief, `docs/agent-handoff/p3/notes-link.md` in full (the section "For unit B" is the contract the machines assume, and "What a player or GM will see differently" lists the accepted changes), `src/core/sync/link.ts`, `push.ts`, `connection.ts`, their tests, the inventory, then `src/edge/sync.js`. This is a refactoring: read `.claude/skills/poteto-mode/playbooks/refactoring.md` and `principle-migrate-callers-then-delete-legacy-apis`.

The lead accepted every choice in the unit A notes. Decided on top of them:

- A GM whose key the server stopped accepting (a poll answers `gm: false` while the link is live as GM) is told so and leaves the room: add a `keyLost` reply to the link, tests first. Today the phone keeps acting as GM and every GM request fails without a word (open question 13).
- The invite parser (`parseInvite`, finding 10: "thanks buddy" is read as the code THANKS) moves to a pure `src/core/sync/invite.ts` with tests, and the bug is fixed there.
- Finding 1 (a peek renews a room's 30-day expiry) is a server test and a server fix in `server.ts`: a peek must not keep a dead room alive.
- Finding 8 stays half fixed (one last-room slot). Finding 12 (a pending invite and onboarding) and finding 14 (the Postgres store) are not this unit's: leave them, the lead tracks them.

Steps:

0. The pin. Before changing app code run `room-sync`, `room-sync-fixes`, `room-view`, `room-onboarding`, `table-session` and `upgrade` once and record the counts in the notes.
1. The three decided additions above, tests first, one commit each.
2. The edge. `src/edge/sync.js` becomes `src/edge/sync.ts` (strict). It holds exactly two pieces of state for the link and the push (the current `Link` and the current `Push`), one `dispatch(event)` for each that calls `reduce`, stores the result and carries out the effects, and an effect runner that honours the contract: one reply per request, `abort { gen }` drops that gen's requests (use `AbortController`), one timer per name, `apply` is the only place room data from a poll is applied, `save` is the only place the stored room fields are written, `status` emits `sync:status`. Every module-level variable the inventory's section 1 assigns to the link, the push or membership is deleted in the same commit that replaces it. If the whole file cannot move to TypeScript in this unit, split it by responsibility: the machines' edge in `sync.ts`, and what the machines do not own (the roster and presence helpers, the forget queue, the peek cache) in a second typed module, each with the state it owns named at the top. Say what you chose and why.
3. The public API on `app.api.sync` keeps its names and behaviour for the views (inventory section 7), now reading from the two states through selectors. `conn()` and `status()` are `connection(link, push)`. Map the new values (`notSent`, `locked`, `creating`, `joining`, `upgrading`) to the pill and the Room view with the plainest wording and list each new string in `docs/agent-handoff/copy-tasks.md`.
4. Lint rule in `tests/lint.test.ts`, named in `AGENTS.md`: `src/edge/sync.ts` has no module-level `let` other than the two machine states and what the notes list by name, and nothing outside it writes `settings.sync.room`, `cursor`, `lastRoom` or `gmKey`.
5. Browser tests. The pin files pass. Add tests named for what the person sees for the accepted changes that have none: a refused GM key ends the join with a message and does not join as a player; a sheet the server refuses shows as not sent while the room stays live; a GM whose key stops working is told and leaves the room; leave then rejoin of the same room never shows the old room's data. Bring the widened room waits in `customization`, `room-view` and `room-sync-fixes` back to the 15 s default (they were raised to 30 to 45 s for the old box; `p3/bugs-found.md` bug 2) and confirm the files still pass.
6. `AGENTS.md`: "Where things live" rows for the link, the push and the pill, and a recipe "To add a link state or a reply".

Rules for this unit: what a player or GM sees does not change beyond the accepted list. Do not touch the event applying and sending code that the protocol unit just wrote, except to route it through the `apply` effect and the typed `send`. No parallel old and new paths.

Done means: `bun run test` passes; the six pin files plus `customization`, `character` and `gates-quests-dailies` pass. Final reply under 200 words: what you made, the last line of each command, what stayed outside the machines and why, anything you were unsure of or left out.

If a step turns out to be wrong or much larger than it reads, stop, write why in the notes file and reply. Do not widen the task.
