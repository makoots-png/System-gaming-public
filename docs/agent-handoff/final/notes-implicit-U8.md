# Notes: implicit audit unit U8 "The room view and the room's build" (rows 26, 46, 67, 68, 69)

Helper: Opus, worktree `.claude/worktrees/agent-ac8ac6897a872d85c`, branch `worktree-agent-ac8ac6897a872d85c`, from
`claude/zen-pasteur-ov4cgd` at b0a27a8, then merged with the local branch `u2` at 7b6fc17 (U2 and U3, not yet in the
main line) in 482d956, because row 46 reads the `Call` that `sync.kick` answers since U2. Playwright port 3281.

## Goal

The Room view and the room's build switches hold no state of their own that the link or the save already holds. The
problem: the view copies the link's busy state, drops the invite while drawing, removes a player from the fight before
the server agrees, a player's own build switches are overwritten by the room's and dropped after it, and the sheet the
phone sends falls back to whichever hunter is shown. The smallest change: read busy from `conn()`, let the link spend
the invite and announce a room change, lay the room's build doc over the player's rules in `rules()` instead of copying
it, remove from the fight only after the DELETE is taken, and let `bound()` answer the bound hunter or none.

## Decision trail

(Newest last.)
1. Read helper-rules, the brief, poteto-mode, START-HERE's two sections, AGENTS.md, the audit (summary, rows 26, 46,
   67-69, U8's entry and the lint list), notes U2, and the leaves of model-the-domain, type-system-discipline,
   boundary-discipline, prove-it-works, fix-root-causes, subtract-before-you-add and unslop.
2. Merged `u2` into this branch (482d956): U2 changed `kick` to answer a `Call` and room.js to say why. Conflicts were
   docs only (AGENTS.md, for-the-owner, the chart list, the dependency map, regenerated). One slip: I took u2's
   dependency map with `git checkout --theirs` before regenerating it; the file was regenerated at once, so nothing of
   it is left.
3. Data shapes first. Row 69: the rules in force on a player's phone are a function of two sources, the save's
   overrides and the room's `BuildDoc` (`{ enabled, playerPick }`), so the room's doc is an argument of `rules()`, not a
   field of the save. Row 67: "a create or join is under way" is the link's `creating | joining`; which button shows
   busy is the join's target (`detail().joining`), so the view keeps no copy. Row 26: the bound hunter is `HunterId |
   none`, with the invariant "a save in a room binds one of its hunters" held at the boundary (save.ts) and by the
   three steps that rebind (join, Play as, delete).
4. Row 69, three ways weighed for how the player's phone plays by the room's switches. (a) Copy them into the save on
   each doc and drop them after the room (today): two writers of one field, the player's own switch lost on leaving.
   (b) Keep the room's doc in the save as its own field (`settings.sync.roomBuild`): no clobbering, but a derived value
   stored, and it must be cleared on every way out of a room. (c) Lay the live doc over the save's rules inside
   `rules()` (edge/rules.ts, `bindRoom` from sync.ts, `withRoomBuild` in build.ts): nothing stored, nothing to clear,
   the GM's phone unaffected. Chosen (c), the audit's judgment. Its cost: the views redraw only on a save change, and
   the doc changes no save, so app.js redraws when `rules()` answers another object after `sync:docs` or `sync:status`
   (the answer is cached by its sources, so identity is the comparison). That is one line in app.js, not my file.
5. Row 68: with (c) custom.js has nothing to drop on leaving, so its `wasRoom`/`wasGM` diff and the listener go with no
   replacement there. `sync:room { from, to }` is still made (the audit's remedy), because the Room view had the same
   diff (`S.pcode`) to clear its old errors; it listens to that now. `role` from the audit's payload is left out: no
   reader needs it (subtract-before-you-add).
6. Row 67: the link already said when the server came back (`status.serverBack`, link.ts) and the edge dropped it; the
   Room view worked it out again from its last `conn`. `sync:status` now carries it, and the view's recheck and error
   clearing run in its listeners, out of `render`. The invite is spent by sync.ts (`spendInvite`) after each link step
   and at the page's start, so the "already in room" toast comes from the link, once, and only when no tap joined it.
   The invite's first check moved from `render` to `mount` (an invite comes only with the page's address, before the
   view exists).
7. Row 26: the fallback hid a missing state that the save could hold (a save in a room whose bound hunter is gone,
   from an import or a hand-made file). Fixed at the boundary: save.ts drops a bound id naming no hunter and binds the
   active one when the save is in a room. Then `bound()` answers the bound hunter or none, and `bindNow` (which wrote the
   fallback into the save after every poll, a third writer) is deleted. The delete's rebind was already a core step
   (party.ts `removeHunter`, tested in party.test.ts). The audit called the rebind "a link event"; the link machine
   knows no hunters, so the step stays in party.ts. The rebound hunter is pushed on the next change (the push compares
   the bound sheet's text), as before.

## Rows (cause, change, test, commit)

- Row 46. Cause: `kick` removed the player's fight row before it asked the server, so a refused or lost DELETE left the
  player out of the fight and still in the room. Change: the DELETE first; `removeRemote` only when its `Call` is ok.
  Test: room-sync-fixes.e2e "a removal the server does not take leaves the player in the fight as in the room, and the
  next one that it takes removes both" (the DELETE aborted, then let through). Commits fe8082f (room.js), eba4760.
- Rows 68, 69. Cause: a player's phone copied the room's build switches into its own `rulesOverrides` on each doc, and
  found a leave by diffing `wasRoom` and `wasGM` on every change, then dropped the switches, its own with them. Change:
  `withRoomBuild` (build.ts) laid over the save's rules in `rules()` while a player is in a room (`bindRoom`, sync.ts);
  the follower, `roomMoved`, `wasRoom`, `wasGM` and `withoutFollowedSwitches` deleted; app.js redraws when the rules
  move. Tests: build.test.ts "in a room a player plays by the room's switches, and by their own again once out of it";
  customization.e2e "build switches a GM sets reach the room, a player plays by them while their own stay as they were,
  and leaving the room gives the player their own back" (the player's own players-pick off is kept in the save through
  the room; the old code wrote the GM's over it and dropped it on leaving). Commits bcaf288, 013cade (app.js).
- Row 67. Cause: the Room view kept its own copy of "a create or join is under way" (`S.busy`), set and cleared around
  its own taps, so a join started from another window (onboarding, the REMOVED window's Rejoin) left its buttons live;
  and it compared the last `conn` and room while drawing to clear errors, recheck, and drop the invite with a toast.
  Change: busy is `conn()`; the busy button is the one whose room is `detail().joining`; the invite is spent by sync.ts
  (`spendInvite`) after each link step and at the page's start; old errors clear on `sync:room` and on `sync:status`'s
  `serverBack`, which also asks again the checks the server could not answer. Deletes `S.busy`, `S.pc`, `S.pcode`, the
  render's drop and recheck, the lobby's reconnect nudge. Tests: room-view.e2e "a join under way from another window
  keeps the Room view from starting a second one until it ends" (Join and Create disabled, Join `aria-busy`, while the
  server's answer is held; the old view left them enabled), and the invite case now asserts the "already in room"
  word comes once and a redraw adds none. Lint: "a view draws without changing anything" (kind 6), whose first case is
  the old render's line; it found nothing else in src/views. Commits 2591ebc (sync.ts, events.ts, api.ts), 44448e6
  (room.js), be434a8.
- Row 26. Cause: `bound()` fell back to the active hunter when the bound id named none, and `bindNow` wrote that
  fallback into the save after every poll: two ids for one fact and a third writer. The state it covered (a save in a
  room whose bound hunter is gone) can only come from outside data. Change: save.ts repairs it at the boundary (a bound
  id naming no hunter is dropped; a save in a room binds its active hunter); `bound()` answers the bound hunter or none;
  `bindNow` deleted; room.js names the join's default (`joinPick`: the hunter last played, else the one shown) instead
  of reading it from `bound()`. Test: save.test.ts "the hunter a player's phone sends its room is one of the save's"
  (fails without the repair: the gone id stays bound). Commits 0ca3196 (save.ts, not my file: one repair line),
  2591ebc, 44448e6.

## Left, and why

- The kind 1 lint (every register-level `let` in a view named in a list with its reason; two flags declared together
  fail). Today 67 such lines in src/views; a per-file list of them is the sweep's work (U12), and "two flags together"
  would not have caught `let wasRoom, wasGM = false` by its initializers (wasRoom held a room code). Kind 4's storage
  lint waits on U11, as the audit says.
- tests/link.test.ts: link.ts did not change (its `serverBack` was already tested); the edge now passes it on.
- The audit's `role` in `sync:room`: no reader.

## Checks (last run, after the last code commit)

- `bun run typecheck`: `$ tsc --noEmit && tsc -p tsconfig.views.json --noEmit` (clean).
- `bun run test`: "Ran 3147 tests across 81 files", 3144 pass, 0 fail, 3 skipped. The run before it failed once on the
  stale dependency map, regenerated in 4e72285.
- `bun run deps -- --write` and `bun run charts`: the map regenerated, the charts unchanged.
- Browser, port 3281, every file but feel, one at a time: 26 files all passed; 3 cases failed and failed again on a
  rerun: character.e2e:351 and look.e2e:67 (the Penalty Zone window after a missed daily does not show) and layout.e2e:104
  (U3's feed case: the roll stays unseen after the GM opens Combat). None is U8's: the same three fail on 482d956 (the
  u2 merge before any U8 change); character:351 and look:67 also fail on the main line b0a27a8 alone and pass on u2
  alone; layout:104 fails on u2 alone (7b6fc17). Each tree was exported with `git archive` to the scratchpad and run on
  port 3281. Not chased further: neither touches a U8 file (quests.js and table.js belong to U5 and U3).
- The new removal case first failed because the aborted DELETE went through the service worker, which a page route
  does not see; it now blocks the service worker as the GM-key case beside it does (22821b0). With the old order in
  room.js put back by hand, it fails on "the fight keeps the hunter the room kept"; restored, it passes.
- The scratchpad is shared with the U2 helper: my run script was overwritten by theirs while it ran; the loop had
  already been read, and its summary is complete (29 files).
