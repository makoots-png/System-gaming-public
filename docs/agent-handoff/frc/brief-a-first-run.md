# Brief A: first run and the room (heavy-writer)

Tree: `/workspace/sg-frc-a`, branch `frc-first-run`. Work only there. Browser tests on `E2E_PORT=3341`.
Notes file: `docs/agent-handoff/frc/notes-a.md` (write as you go). Read `design.md` in this folder first.

Where this brief and `docs/agent-handoff/helper-rules.md` differ, the brief wins: **you commit**, one commit per
numbered step below, each `git add <paths>` by path, a plain one-line message, no attribution lines. Never push, never
`--no-verify`, never touch `.claude/skills`, start no helpers. Work in poteto mode: read
`.claude/skills/poteto-mode/SKILL.md` and the principle skills helper-rules names for new state, tests and prose.

## What the owner asked for

1. Creating a room and joining a room are obvious from the first minute. Today a room is never explained and three
   doors lead to it. One concept, one path per role.
2. One plain sentence saying what the site is, under the Welcome window (the window keeps the System's voice), and the
   same line opening the ? guide.
3. A real first step after setup: a "Hunter created" confirmation with the role's next steps. Player: spend points,
   pick a path, join your GM's room. GM: create a room, invite players.

Out of scope: the Rules page and the 0 HP wording (brief B, another tree), the words on the role chooser, the store,
`src/core/combat/`, `src/core/gates/`.

## The shapes

### `src/core/onboarding.ts`: the setup machine

```
steps   welcome, role, invite, player, gm, hunterCreated, campaignReady, done
events  accept, player, gm, back, skip, more, joined, begun, starter, blank, sheet, join, later, created

welcome        accept -> role            skip -> done
role           player -> player          gm -> gm                  skip -> done
invite         more -> welcome           joined -> hunterCreated
player         back -> role              begun -> hunterCreated    skip -> done
gm             back -> role              starter -> campaignReady  blank -> campaignReady   skip -> done
hunterCreated  sheet -> done             join -> done
campaignReady  later -> done             created -> done
done           (nothing)
```

`AFTER` is `hunterCreated`, `campaignReady`, `done`: the save is marked onboarded on entering any of them, so a reload
on the confirmation does not start setup over. The old `room` step is gone (`campaignReady` takes its place). Every
other cell is `null`. Update the file's header comment, `tests/models/onboarding-events.ts`, the chart
(`scripts/charts/onboarding.ts`: a label per step, words per event, the note) and `bun run charts`.

### `src/core/first-run.ts`: the words and the next steps (new, pure)

```ts
export const ABOUT: string;                       // what the site is, one sentence
export const ROOM_IS: string;                     // what a room is, one sentence
export const ROOM_PATH: Readonly<Record<Role, string>>;   // each role's way to one, one sentence
export type NextKey = 'points' | 'path' | 'join' | 'create' | 'invite';
export interface NextStep { readonly key: NextKey; readonly words: string; readonly done: boolean }
export type FirstRunFacts =
  | { readonly role: 'player'; readonly points: number; readonly path: 'open' | 'picked' | 'closed';
      readonly rooms: boolean; readonly room: RoomCode | null; readonly joining: RoomCode | null }
  | { readonly role: 'gm'; readonly rooms: boolean; readonly room: RoomCode | null; readonly players: number };
export function nextSteps(facts: FirstRunFacts, R: Rules): readonly NextStep[];
```

Use the repo's own room-code type from `src/core/ids.ts` and `Role` from `src/core/role.ts`. `rooms` is whether this
build has a room server (`sync.conn() !== 'off'`); with none, no room step is listed. `path: 'closed'` (the rules
have builds off, or the player may not pick: `buildsOn`, `mayPick` in `hunter/build.ts`) lists no path step.
`points` is `available(h, R)` (`hunter/progress.ts`).

The steps, in order. A player: `points`, `path`, `join`. A GM: `create`, `invite`.

| key | not done | done |
|---|---|---|
| points | `Spend your 5 ability points: on the Status tab, tap + on a stat, then Confirm.` (the number is `points`; "1 ability point") | `points === 0`: `Ability points spent. Each level gives 3 more.` (the 3 is `R.pointsPerLevel`) |
| path | `Pick a path: <where the app has it>.` Name the place as the screen names it; find it in `src/views/custom.js` | `picked`: `Path picked.` |
| join | `Join your GM's room: ask the GM for the room code or an invite link.`; while `joining`: `Joining room ABC234.` | `In room ABC234.` |
| create | `Create a room.` | `Room ABC234 created.` |
| invite | `Invite your players: share the room's code, link or QR code.` | `players > 0`: `2 players joined.` ("1 player joined.") |

The three sentences, as drafts. Check every claim against the code before you keep it (what a room really shares is in
`src/core/protocol.ts`), and follow `docs/agent-handoff/copy-tasks.md` (plain words, no em dash, no exclamation mark,
"GM", "hunter", "room", "the room button at the top"):

- `ABOUT`: "A companion app for a tabletop role-playing game in the style of Solo Leveling: the GM runs the game, and
  each player keeps their hunter's sheet, quests and dice on their own phone."
- `ROOM_IS`: "A room links the GM's phone and the players' phones: the GM sees every hunter, and everyone follows the
  same fights, quests and rewards."
- `ROOM_PATH.gm`: "Create a room, then share its code, link or QR code with your players."
- `ROOM_PATH.player`: "Your GM creates the room and gives you its code or an invite link."

### `src/views/onboard.js`: the windows

- **Welcome.** The window is unchanged. `ABOUT` is drawn below the window on the backdrop, plain text (not the System's
  voice), at least 12 px, and the dialog names it with `aria-describedby`. At 360 by 640 the window and the sentence
  both show without scrolling. Only the Welcome step shows it.
- **Name your hunter** (`player`). The room field's label becomes "Room code from your GM (optional)" with a help line
  under it: "No code yet? Begin without one and join later with the room button at the top." `Begin` raises `begun`,
  the window becomes Hunter created, and a typed code is joined behind it as today.
- **Join a room** (`invite`). `Join` raises `joined`, the window becomes Hunter created, the join runs behind it. No
  navigation happens under the window: a failed join is the toast it is today and the join step stays not done.
- **Hunter created** (`hunterCreated`). Tag `! System`, title `Hunter created`, a line naming the hunter (and its job
  when it has one), then "Next steps" as a list from `nextSteps` (a done step is marked done for the eye and for a
  screen reader, not by colour alone). Buttons: primary `Open my sheet` (`data-obsheet`, raises `sheet`, lands on
  `status`); `Join a room` (`data-objoin`, raises `join`, lands on `room`), shown only while the join step is listed,
  not done and not joining. Escape is `sheet`. The window redraws its list when the room changes (`sync:room`,
  `sync:status`) and stops listening when it closes.
- **Campaign ready** (`campaignReady`). Tag `! GM`, title `Campaign ready`, one line saying what was loaded (the
  starter campaign, or an empty one), then `ROOM_IS` and the GM's next steps. Buttons: primary `Create room`
  (`data-obcreate`, creates the room, raises `created`, lands on `room`, where the invite is) and `Later`
  (`data-oblater`, raises `later`). With no room server, or with an invite pending (`invited()`), there is no Create
  button and no room step: the window is the confirmation and `Continue` (`data-oblater`). Escape is `later`. A failed
  create says why in the window, as today.
- **The ? guide** (`quickstart`). Title stays. First `ABOUT`. Then "Next steps" from `nextSteps` with this phone's
  facts now (so it is a list that fills in), then this role's tips only (`app.isGM()`): no GM list for a player, no
  player list for a GM. Rewrite the tips so each role's room line uses its verb (create or join) and none says "open a
  room".
- A view writes nothing while drawing; the facts are read, not stored. Every new page-level `let`, Map or Set needs its
  line in `tests/lint.test.ts` ("every let a view keeps"), and prefer none.

### The one door

- `src/edge/room-pill.ts`: delete the Data view's "Campaign Room" panel (`registerPanel({ id: 'sync', ... })`, its
  `panelEl`, `panelUpdate`, its CSS, and the `'room-pill.ts panelEl'` line in `tests/lint.test.ts`). The button at the
  top, with no room: a player `Join room` (label "Join a room"), a GM `Create room` (label "Create a room"); creating
  reads `Creating`. It still leads to the Room view and still shows the code in a room. Its width rule (96 px, it
  wraps) stays.
- `src/views/room.js`, not in a room: `ROOM_IS` once above the sections. A player's first section is "Join a room"
  with `ROOM_PATH.player` under its heading; its create section is headed "Create a room", says "Only the GM creates a
  room. Creating one makes this phone the GM's.", and keeps `Create room as GM`. A GM's first section is "Create a
  room" (was "Run a room") with `ROOM_PATH.gm` under it. In a room, the GM's share box is headed "Invite players" and
  says in one line how a player joins (the code, the link or the QR code). `STATE.creating` reads "Creating a room" /
  "Creating a new room."
- Everywhere else in `src/` and `public/`: a GM creates a room, a player joins one. Grep for "open a room", "Open a
  room", "Run a room", "Opening" and fix what a person reads; "Open ABC234 as GM" stays (it reopens a room that
  exists). `src/views/gm.js`: words of the room strip only, if any need it.

## Tests (behaviour a person sees; expected values from the rule, not from running the code)

- `tests/onboarding.test.ts`: the table above, row by row; every way through marks the save onboarded exactly once
  (the existing walk); a player reaches `hunterCreated` from `begun` and from `joined`; a GM reaches `campaignReady`
  from `starter` and `blank`; `skip` ends at `done` from every step that has it; a stale event answers `null`.
- `tests/first-run.test.ts` (new): `nextSteps` for a player with 5, 1 and 0 points; path open, picked, closed; no room
  server; not in a room, joining, in a room; a GM with no room, a room and no players, one and two players. The three
  sentences obey the copy rules a test can check (one sentence, no em dash, no exclamation mark).
- `tests/e2e/helpers.ts`: `onboardPlayer` taps `Open my sheet` and `onboardGM` taps `Later`, so every other test lands
  where it did. Wait for the window by its title before tapping past it.
- `tests/e2e/room-onboarding.e2e.ts`: update the six tests for the new window (they assert the overlay is gone right
  after Begin or Join), and add:
  1. the Welcome window shows what the site is, below the window, without scrolling at 360 by 640;
  2. a new player who names a hunter sees Hunter created with the three next steps, and Open my sheet lands on Status;
  3. a player who typed the GM's room code sees the join step done with the code, and no Join a room button;
  4. a player who did not join taps Join a room and lands on the Room page, which says what a room is and offers Join
     first;
  5. a new GM sees Campaign ready, taps Create room and lands on the room's invite (code, QR, link);
  6. the button at the top says Join room on a player's phone and Create room on a GM's, and the Data page has no room
     panel;
  7. the ? guide on a player's phone lists the player's next steps and no GM tips, and the reverse on a GM's.
- Fix every other test your change breaks (`grep -rn "Run a room\|data-openroom\|Campaign Room\|none open" tests/`),
  and `scripts/ui-shots.ts` if it taps through setup.

## Steps: commit each when its check passes

While `pgrep -f scripts/ci.ts` prints a pid, the lead's CI is running: run no browser and no whole `bun test` then
(typecheck and single test files are fine). Check before each browser run.

1. The machine: `onboarding.ts`, its model events, chart, `tests/onboarding.test.ts`, and the smallest change to
   `onboard.js` that keeps the typecheck green. Check: `bunx tsc --noEmit && bunx tsc -p tsconfig.views.json --noEmit
   && bun test tests/onboarding.test.ts tests/statecharts.test.ts` (after `bun run charts`).
2. `first-run.ts` and `tests/first-run.test.ts`. Check: that test file, both typechecks.
3. The windows in `onboard.js`, the e2e helpers, `room-onboarding.e2e.ts`. Check:
   `E2E_PORT=3341 bunx playwright test tests/e2e/room-onboarding.e2e.ts --workers=1 --output=/tmp/pw-frc-a`.
4. The one door: `room-pill.ts`, `room.js`, the verbs, their tests. Check: `room-view.e2e.ts`,
   `room-sync-fixes.e2e.ts`, `room-onboarding.e2e.ts`, `look.e2e.ts`, `phone.e2e.ts` the same way.
5. The docs a reader needs: the AGENTS.md rows that name these things (first-run setup; what the room pill and the
   Room view show; add where `ABOUT`, `ROOM_IS` and `nextSteps` live), the new words in
   `docs/agent-handoff/copy-tasks.md` as that file asks, `bun run deps -- --write`, `bun run charts`. Check:
   `bun run test` (whole; only when no CI runs).
6. Every browser file once, three workers (the one run where more than one worker is allowed):
   `E2E_PORT=3341 E2E_FEEL=skip bunx playwright test --workers=3 --output=/tmp/pw-frc-a 2>&1 | tail -40`
   (`E2E_FEEL=skip` leaves out the lag test, which the lead's CI runs alone). A file that fails once is rerun once
   with `--workers=1` before you read anything into it (the box pauses). Fix what your change broke; a failure that
   is not yours goes in the notes with its output.

Reply in at most 200 words: what you made, each check's last line, the commits, what you were unsure of. Anything
longer goes in `notes-a.md`, which you commit too.
