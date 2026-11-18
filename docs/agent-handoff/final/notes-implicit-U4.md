# Notes: implicit audit unit U4, "A fight's end and a gate's Clear" (rows 13, 39-44, 83-86)

Same helper and worktree as U2 and U3 (`worktree-agent-a99c3b2e548a857cf`, port 3271), after merging
claude/zen-pasteur-ov4cgd twice (cd38efb, 8624e5f).

## Goal

A GM who ends a fight or clears a gate never leaves it half paid: the gate paid and nobody given anything, or a player
offline then never getting the XP. The smallest change: one core step per settlement that answers the whole next save
(the gate, the log, each local hunter's grant, each player's award put in the outbox, the fight cleared), written by
one `store.apply`.

## Decision trail

1. Data shape first: an `EncounterPlan` (the fight's id, its gate, the XP, the award by `fightAward`, the share, the
   payees as a union of a local hunter and a player's sheet key) worked out from the ended fight before the GM chooses;
   `settleEncounter(save, plan, choice, posts, day)` writes it. The plan is worked out again from the fight as it ended
   (the GM confirmed it), so the window and the write read the same rule.
2. No machine was drawn: a settle has no states of its own. Its one in-between state is a legitimate one the fight
   already has, an ended fight not yet settled (the view ends it through the dispatcher, then settles). A reload there
   finds "Fight over" and End encounter settles it. A settled fight is gone, so a second settle is refused (`no-fight`);
   that is what made the `ending` flag unnecessary (row 43).
3. The players' awards are posted to the outbox inside the step (`atOutbox` with outbox.ts's `post`), so the gate's
   payment and the awards are one write. The events are made by the view (`sync.event`, which needs the device and a
   random part) from `encounterAwards(plan, choice)`, so the step stays pure; `sync.flush()` sends them after the write.
4. The fight's clear inside the step runs the reducer's `clear` (no effects), so the fight still changes only through
   `reduce`. The end stays a `send` in combat.js, since its effects (write-backs) are carried out there (row 13 left).
5. Weighed for who fought a gate (row 83): a closure Map (lost at a reload), the fight's rows (gone once cleared), or a
   field of the gate written by the settle. Chosen the field (`Gate.fought`, parsed by `parseGate`).
6. The fight's totals for a player (`sendVitals`) are posted keyed by the hunter, so while its phone is away only the
   latest totals wait (a newer one takes the place of a queued one). The room model's card rule needed a replaced
   message to count as never sent (answered with no seq) and to be owed no more.

## Rows

- 41. Cause: seven steps in a view. Change: `settleEncounter` (pay.ts, 0947e16) and combat.js's `endEncounter` on it
  (da1b333). Tests: tests/pay.test.ts (the plan, the gate covered, Award in one step, a second settle refused, a fight
  still on refused, End without XP, the input untouched); room model "the end of a fight" (a player offline, the GM's
  page reloading before the award went, the award lost on its way out, its answer lost); the browser case "the GM ends
  the fight while the GM's phone is offline" (table-turn.e2e.ts).
- 42. Cause: the XP split written twice and the gold split once more. Change: `splitAward`, used by `planEncounter` and
  `clearShares`. Test: pay.test.ts "one award over the payees", "the shares".
- 43. Deleted with 41: `ending`; the "fight is over" toast is for a fight that ended itself (`cmd.type !== 'end'`).
- 83. `Gate.fought` (0947e16, 4fb3d01); test: gate.test.ts "who fought it is kept".
- 84. The Gates view's redraw hung on its node (`_render`, `_open`) is a record in the module (`mounted`).
- 40. `extractDc` in core shadows.ts with `RULES.shadow.dcMin` (0b36463); test: shadows.test.ts.
- 86. gates.js spawns with roll.ts's `cryptoRandom` (08ce8ac). gm.js's roll tables are U10's.
- Clear (rows 41 and 42 for the gate): `clearShares` and `settleClear` (gates.js 4fb3d01); its sends posted, so
  gates.js left the lint's list; combat.js left it too (its only once-send was `sendVitals`). gm.js (U10) is the last.

## Left, and why

- 13 (combat.js `send` as one step for `store.apply`): combat.js is open in another helper's hands; the lead asked me to
  keep to the fight's end and its sends.
- 39 (a fallen monster's extraction attempts in the fight's row with a command): a new fight command touches fight.ts,
  its TABLE, the model's random play and the fight chart; not started in this time.
- 44 (the screen's `over` union) and 85 (the gate's mark inside the step that starts its fight, which lives in
  combat.js `startFlow`): combat.js, outside the fight's end.
- `src/core/sync/sent.ts` is used only by the room model and its test; combat.js keeps no per-card sends any more. Worth
  a look by whoever owns the GM's card.
- The room model's exhaustive walk takes about 37 s of its 60 s budget (the GM's settle move added one move); a walk
  bun times out stops at its next sequence (`still`).

## After the pause: merges, the full browser sweep, and three findings

- Merged claude/zen-pasteur-ov4cgd twice more (6e6ffad at push 28 with U9; 522fc34 at push 29). The merged lint "a view
  keeps no machine in flags" counted two new closure `let`s in gates.js (the Clear's gold and the settle's result):
  rewritten as consts (2bd7b35).
- gates-quests-dailies "a gate cleared after End encounter" failed in the full sweep. Cause: the settle emitted
  `combat:end` before queueing the rewards window, so the gate's "Encounter over" question came first and the rewards
  window then opened over the Clear panel. The rewards window is queued first again (7747dc5).
- phone.e2e's "gm bundle maker" controls at 43 px: the sweep measured a window still rising from 98% of its size
  (motion.ts `enter`); main's phone.e2e (push 29) waits for its animations. Main's copy (exported to a scratch folder)
  passed 4 of 4 on this box where this branch's older test failed 3 of 5; the merge brings the wait.
- layout.e2e.ts:104 (the U8 helper saw it fail twice; here 2 of 3): app.js draws a view before it shows its section,
  so the feed's paint on going to Combat saw itself hidden and marked nothing seen. The feed repaints on the app's
  `view` event for Combat and when the page is shown again (77689cb); four runs of the file pass.
- Postgres here stopped between sessions ("stale pid file", as U7 found); `pg_ctlcluster 16 main start` brought it back.

## The last full browser sweep (every file but feel, one at a time, port 3271, after 77689cb)

28 of 29 files pass whole. battle-map: 5 failed, 12 passed (the long press and drop, the slow tap, a pan, a monster's
attack picked, a double tap). Main's own copy at b312dc7 (exported with `git archive` to a scratch folder) fails the
same 5 on this box, so they come from main (the map's gesture work), not from this branch.
