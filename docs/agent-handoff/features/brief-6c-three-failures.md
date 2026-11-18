# Brief: three browser tests failed once in the push of feature 6

One helper (Opus, heavy-writer) in the main tree, on `claude/zen-pasteur-ov4cgd` at the commit the lead names, alone in the tree. Read `AGENTS.md`, `START-HERE.md` (the owner: "For all things we must fix the problem and not the symptoms"; a test that fails once is a finding about the app until shown otherwise), `final/brief-implicit-unit.md` (poteto mode, the cause written before a change, a test that fails without the fix, a commit by path with a plain message and no attribution line, no push, no helpers, never `git checkout`, `stash` or `reset` a file, never edit `.claude/skills`), and how the last such finding was read from its trace (`final/brief-look-fixes.md`, row L0: the request log, then the docs each request carried, then the page).

## What happened

The hook's CI on commit 182dabb: 326 browser tests passed and three failed, each once. The run before it (the same code but for the odds engine's first-frame fix, f17e605) passed all of them. The traces and the whole log are kept in the lead's scratchpad: `/tmp/claude-0/-home-user-systemgaming/92775296-016c-5fb1-b771-04765cc647d8/scratchpad/fail49/` (one folder a test, each with `trace.zip` and its `api-requests` attachment; `ci.log`).

1. `tests/e2e/map-extras.e2e.ts:286`, "a player holds an ability on the hotbar to read what it does, and it is not picked". The detail that opened was Parry's; the test then read the first slot's name and it was Strike. So the slot held and the slot read were not the same one. This test also failed once in the look-fixes unit (`final/notes-look-fixes.md`: "failed once on the hotbar hold test, no trace was kept"), after that unit changed the hotbar's layout (End turn out of the scrolling row, the slots sharing the width, a fade when it scrolls). Twice is a class: find whether the bar's order or scroll changes under a finger (a redraw between the press and the hold's end, a scroll snap, an armed reaction moving a slot), which a player meets as the wrong ability's detail, or a wrong pick.
2. `tests/e2e/reward-room.e2e.ts:130`, the award given while the GM's phone is offline: back online, the player never saw REWARD RECEIVED in 20 s.
3. `tests/e2e/rewards.e2e.ts:25`, a GM's award posted to the room: the player never saw REWARD RECEIVED in 15 s.
   Tests 2 and 3 ran side by side (numbers 234 and 235) and failed the same way, so first learn whether they share one cause: read each request log for whether the award's event reached the room, whether the player's poll returned it, and whether the page applied it (the applier, `sync.once`, the window queue in `ui.js`: a System window waits behind one already open). A box that stalled for 20 s would show in every request's gaps: say whether it did. Feature 6 changed `src/edge/roll.ts` (the dice now drawn through `src/core/draws.ts`) and `combat.js`: say whether either can touch an award's path.

## What to do

For each: the cause, named from the trace's evidence and then reproduced by hand (a throwaway script or a test that fails without the fix, as L0's does). Then the fix where it starts, and a sweep for the same shape. If a cause is the test's own race, show it from the trace and by hand before the test changes, and change only that. If the evidence shows the machine stalled and nothing in the app or the test is wrong, say exactly what shows it (the gaps, across both phones and the server) and change nothing: the lead decides. Never retry, lengthen a wait, loosen a bound or a lint, or change a test to pass.

Notes in `features/notes-6c-three-failures.md`, a section a test. Close: typecheck, the whole `bun run test`, then every browser file one at a time except `tests/e2e/feel.e2e.ts` on `E2E_PORT=3260` (the loop in `final/brief-close-audit.md`, keeping every `failed` or `flaky` line), and the three files of the failures five times each. Environment: `E2E_CHROMIUM=/opt/pw-browsers/chromium`; never `playwright install`; never ports 3218 or 3233. Leave no `bun server.ts` running.

## Final reply (at most 200 words)

The commit range; for each failure the cause in two sentences and what a player would have met; the fix; each check's last line; what is left and why.
