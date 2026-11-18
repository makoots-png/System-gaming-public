# Brief: one GM role (M2 unit 5, audit item 7)

Final (fourth phase 3 lead, Nov 12). The save parser (`src/core/save.ts`) is being written by another helper at the
same time and is not in your tree: define a small local structural type for the `roleOf` input in `role.ts`.

You work in your own git worktree (your current directory), on your own branch. The worktree may start at `main`:
if `git log -1` is not the commit named in your prompt, run `git reset --hard <that commit>` on your own branch first.
Run `bun install`. Commit in small units as you go (plain messages, no AI attribution lines, no `.claude/`). Do not
push. Do not touch `the repo root` itself. Do not touch `src/edge/store.js` (another unit rewrites it).

Read `docs/agent-handoff/helper-rules.md` first. Where this brief and the rules differ, this brief wins.

Ports: `E2E_PORT=3251`. Notes: `docs/agent-handoff/p3/notes-role.md`.

## Why

Today "is this phone the GM" is answered in three ways that can disagree:

- `settings.mode` (`'gm' | 'player'`), which the player can flip with the mode pill,
- `isGM()` in `src/edge/sync.js:16` (`mode === 'gm'` and, in a keyed room, holding the GM key),
- `mode() === 'gm'` in `src/app.js` (lines 33, 47, 67, 82, 85, 90, 148, 176, 180, 202), which ignores the room.

To keep them in step, sync writes `settings.mode` when a room is created, joined or reopened (`sync.js` lines about
357, 375, 501) and a change listener forces it back to `player` with a "GM MODE BLOCKED" window (about 598 to 605).
That is a stored value being corrected after the fact. Past bugs came from it (a GM whose key request failed turned
into a player of their own room; a player holding a stale key acted as GM).

## Design (decided)

The role is derived, never stored for a room.

`src/core/role.ts` (strict, pure):

```ts
export type Role = 'gm' | 'player';
/** In a room the role comes from the room: the phone that holds its GM key is the GM. Alone, the phone chooses. */
export function roleOf(settings: Pick<Settings, 'mode' | 'sync'>): Role {
  const { room, gmKey } = settings.sync;
  return room ? (gmKey ? 'gm' : 'player') : settings.mode;
}
```

- `settings.mode` keeps one meaning: what this phone chose while not in a room.
- `app.isGM()`, `mode()` in `app.js`, the header pill, `document.body.dataset.mode`, the bottom nav and `renderPill`
  in `sync.js` (line 78) all call `roleOf(store.get().settings)`. No other code reads `settings.mode` to decide what
  to show. `src/views/io.js` (the settings field) and `onboard.js`/`starter.js` (first run, no room) may still write
  it.
- Delete the three writes of `d.settings.mode` in `sync.js` and the `mode-blocked` listener with its window.
- In a room, tapping the mode pill does not change anything. It says where the role comes from: "You are the GM of
  this room." or "You are a player in this room. The GM is the phone that opened it." Add both lines to
  `docs/agent-handoff/copy-tasks.md` under "Phase 3 strings to review".
- Every room has a GM key (decided). Old rooms and old saves do not need to work, so remove the idea of an unkeyed
  room:
  - `server.ts`: `POST /api/rooms` always issues a key (drop the `v: 2` body check, about line 204) and the room
    reply drops `keyed` (about line 228). Update `tests/server-rooms.test.ts` and `tests/server-handshake.test.ts`
    (no `v: 2` body, no `keyed` assertion; add "a room is always created with a GM key"). If the server has branches
    for a room without a key hash that are now dead and removing them is a few lines, remove them; otherwise leave
    them and list them in the notes for M5.
  - Client: delete `settings.sync.keyed` everywhere (`grep -rn keyed src`), including the `sync-keyed` write in the
    poll and the `keyed` result of `headCursor`. `rejoinGM` only needs `gm`.
  - Delete the two "older client" repairs at the end of `sync.js` (`gmKeyLoose`, about lines 510 to 513, and "old
    saves: fold the single gmKey into the ring"), the `loose` branch in `join` (about 380 to 386), the
    `data-loosehint` paragraph and its two uses in `src/views/room.js`. A save from before the update loses its room
    link in the migration, so nothing can produce these states any more.
- Leaving a room: the phone goes back to `settings.mode`. A GM who leaves is a GM alone again, a player who leaves
  is whatever they were before joining. Check the existing tests agree.

## Tests

`tests/role.test.ts` (bun, table of cases): no room + mode gm → gm; no room + mode player → player; room + key → gm
whatever `mode` says; room + no key → player whatever `mode` says.

Lint rule in `tests/lint.test.ts`: "only src/core/role.ts decides the role". It fails on a READ of
`settings.mode` or `.mode === 'gm'` outside `src/core/role.ts`, `src/core/save.ts`, `src/edge/store.js` (or
`store.ts`) and the settings field in `src/views/io.js`. Mutation-check it. Do not edit AGENTS.md (the lead adds the
rule's line there).

Browser: `tests/e2e/room-sync-fixes.e2e.ts` already has "a GM whose key request fails does not turn into a player of
their own room" and "a player who joins a room is a player there, even holding a GM key that the server does not
accept". They must still pass. Add one: "in a room the mode pill explains the role and does not change it" (player
phone taps the pill, still sees the player nav, the GM phone likewise).

## Done means

- `bun run test` passes. `room-sync-fixes.e2e.ts`, `room-onboarding.e2e.ts`, `room-view.e2e.ts`, `room-sync.e2e.ts`
  and `table-session.e2e.ts` pass.
- `grep -n "settings.mode" src/edge/sync.js src/app.js` is empty.
- `grep -rn "keyed\|gmKeyLoose\|mode-blocked" src` is empty.
- Mutation checks for the lint rule and the new browser test, listed in the notes.
- Committed on your branch. Reply under 200 words: branch, commits, last line of each command, anything unsure.

Stop and write notes if you are still going after 60 minutes of work.
