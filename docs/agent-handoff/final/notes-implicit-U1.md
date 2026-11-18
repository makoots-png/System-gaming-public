# Notes: implicit audit unit U1, "A reward lands whole" (rows 17, 18, 66)

Goal: a player never keeps half a reward. The problem: a reward and every GM change that reaches a player's phone is
written in several store writes after its event id is recorded as applied, so a throw or a reload part way leaves part
of it given and the rest never offered again. The smallest change that meets it: one pure core step per reward (and per
room message that changes a hunter), run with the event's id in one store write; the Job Change chain hears a level
change inside that same step.

Brief: `brief-implicit-unit.md`. Branch `worktree-agent-af167acb7d96e27bf`, from `claude/zen-pasteur-ov4cgd` at 4560cbd.

## Causes, one sentence each

- Row 17. `firstTime` in sync.ts recorded the event id in its own store update (`once(eid, () => {})`), then the
  applier changed the hunter in later updates, so the id said "applied" before anything was.
- Row 18. `applyRewards` in hunter.js gave points, title, job, build, skills and boons in one write, then each status,
  the gold, each item, the XP and the refill in writes of their own, so a throw after the first left part of a reward.
- Row 66. The Job Change level step heard a level change only through the `level` event, which two writers in
  hunter.js emitted after their own write; the level and the chain's step were two writes, and a writer that forgot the
  event (an import, a restore, a new writer) left the step behind.

## Data shape (before code)

- `Granted` (core, `src/core/hunter/grant.ts`): what one reward did to one hunter. The next save, the reward window's
  lines, the level-up (`LevelUp | null`), the parts the sheet does not hold while a fight does (`fight: { statuses,
  refill }`), and the chain's requests left for the app (`chain: ChainEffect[]`, a level step to complete). One value, so
  the view shows and sends exactly what the step did.
- Where a hunter's HP, mana, fatigue and statuses live is an argument of the step (`'sheet' | 'fight'`), answered by
  `fightOf` on the phone. The step never writes them on the sheet while a fight holds them.
- An applier that changes a hunter answers a `Landing`: a step on the save and what to tell once the step is written.
  `once(eid, step)` records the id and writes the step in one `store.apply`; the tell runs only when it wrote.

No new machine: a grant is a step, not a thing with states. The chain machine (`job-chain.ts`) keeps its table; only
who sends it `levelChanged` moves. So no statechart was drawn and `bun run charts` wrote no change.

## The rows

### Row 18: one core grant (commit d69fb85, view side in 9192dea)

- Change. `grant(save, hid, rewards, build, { at, R, vitals })` in the new `src/core/hunter/grant.ts` gives points,
  title, job, build, skills, boons, statuses, gold, items and XP, then the level-up refill, in one answer. `applyRewards`
  and `gainXP` in hunter.js run it in one `store.apply` (`give`) and show it with the new `hunter.granted` (the
  windows, the fight's parts, the level-up event). Deleted: `grantXP`, applyRewards' calls of `addCondition`,
  `inventory.addGold`, `inventory.addItem`, `api.refill`, and the four `store.id` reservations.
- Ids come from the save's `seq` inside the step (`idsFrom`), as `told` does, not from `ids` passed in as the audit's
  signature had it: the step then needs nothing reserved outside, and a refused grant burns no id.
- The fight. While a fight holds the hunter's vitals (`fightOf`), the statuses and the refill are not written on the
  sheet; `Granted.fight` hands them back and `granted` sends them to this phone's row (`combat.status`,
  `combat.refill`) or shows the GM's-fight refusal, as `vitalsEdit` did one call at a time.
- `sheetEdit(h, edit, R)` is the one function for the GM's and the fight's change of HP, mana, fatigue, life or a
  status. The hand edits in hunter.js (`lifeEvent`, `addC`, `delC`, `changeMana`, `changeFatigue`, `spendMana`,
  `setVitals`) call it, and so do the room's appliers, so the two paths cannot drift.
- Tests. `tests/rewards.test.ts` "a reward given": every part in one save and the input unchanged, new ids from seq, a
  held title not given twice, the level-up refill on the sheet, the fight's parts left for the fight, a missing hunter.

### Row 17: an applier's change and its id in one write (9192dea)

- Change. `appliedOnce(eid, write)` in `src/core/applied.ts` is a step: refused when the ring holds the id, else the
  write's save with the id recorded (a refusal records the id alone). `sync.once` is `store.apply('sync-applied',
  appliedOnce(eid, write))`; the step is worked out before anything is written, so a throw writes nothing, the id
  included. `once` now takes a `Step<Save>` only (api.ts); the mutate-in-place form had no caller left.
- Every applier with `once: true` answers a `land`: a pure step plus a `tell` run only when the step was written.
  award (one grant a hunter, all in one write), quest (`issueQuest` with its log line), hp and status (`sheetEdit`,
  refused with `gmHolds` while a fight holds the vitals), vitals (`sheetEdit` totals), revive, chain (`chained` with
  its log line). Deleted: `firstTime` and its empty write, the `hunter` writers in `ApplyDeps`, `issueQuest` and
  `chainFromGM` deps, `QuestsApi.chainFromGM` and its body in quests.js (the chain's words moved to room-events.ts).
- Tests. `tests/applied.test.ts` now runs the appliers on a real save with `once` as sync.ts runs it. New cases: an
  award lands whole with its id; the same award twice is given once; an award that throws part way (the rules break
  after the points are worked out) gives nothing and is not marked applied, and its next delivery gives it whole; a
  status in the GM's fight is refused with the toast and not tried again; the chain applier issues step 1 in one write.
  Mutation check: making `appliedOnce` swallow a throwing write and record the id fails the part-way case (1 fail of
  25), then reverted.
- The room model (`tests/models/room-world.ts`) runs the real appliers' steps through a `once` like sync.ts's; its
  invariant (each GM event takes effect once) holds.

### Row 66: the chain hears the level in the level step (d69fb85, 9192dea)

- Change. `levelled(from, after)` runs the chain's `levelChanged` when the level moved and answers the hunter and the
  level steps reached (`complete`). `grant` runs it after XP; the GM's level and XP edit runs `levelEdit`. The `level`
  event, its two emits in hunter.js and the listener in quests.js are deleted.
- First pass: the chain's `completeQuest` request was carried out after the write, through quests.js `complete`.
- After the merge with main (the lead's follow-up): a level step the level reaches is completed in the same step.
  `stepsReached(h, effects, day, next)` runs quests.ts `completeQuest` for each request (which tells the chain
  `stepCompleted` and opens the next step), so the level, the step's completion, the next step and their log lines
  are one write. `levelled`, `grant` and `levelEdit` (now a step on the save) take a `Day` (`at`, `today`, `R`); the
  room's chain applier uses `stepsReached` too, for a chain issued at level 10. The windows and `quest:done` come after
  the write from `Granted.done` through the new `quests.stepsDone`. Left: quests.js's own Issue on the GM's phone
  still completes a reached step through `complete` after its write (`completeAsked`).
- Tests. `tests/job-chain.test.ts` "the level step hears every level change in the same step": an XP reward 7 to 9
  moves the step to 9/10; one to 10 completes step 1, opens step 2, writes both log lines with distinct ids; the GM's
  edit down to 4 moves it to 4 and up to 12 completes it; a change that keeps the level leaves the chain alone.
  `tests/applied.test.ts`: a chain started at level 10 completes step 1 in the same write. Mutation check: a
  `stepsReached` that completes nothing fails all three completion cases.

## Lints (c8764b3)

- "a room event id is recorded only by appliedOnce, in the same write as the change it records": nothing but
  applied.ts and save.ts writes `sync.applied`. First case: the old `d.settings.sync.applied = ring;`.
- "a hunter's level moves only in src/core/hunter/grant.ts": `addXp`, `atLevel`, `setLevel`, `gainXp` are called
  only in progress.ts and grant.ts. First case: the old `both(x => addXp(x, n, rules()), fit)`.
- The combatant rule's copy list names grant.ts: a reward's `statuses` are a sheet's, never a row's.

## Behaviour a player sees that changed (in for-the-owner.md)

- In the GM's fight, a board HP change or a status for a player shows only the refusal toast; before it also showed
  "-5 HP" or the status, though nothing changed (the old applier toasted whatever the write answered).
- "QUEST COMPLETE" for a level step a reward reached opens after the reward and level-up windows.
- A player's phone with a stale fight of its own while in a room: a GM's HP or status message is refused with the
  toast instead of going to the stale row. In a room only the GM runs a fight (`canRun` in combat.js), so the row
  could not be played anyway.
- In this phone's own fight, a reward's status lines come after the boons in the window (they are added once the row
  took them).

## Left, and why

- deps.test.ts has four failures at HEAD 4560cbd that are not this unit's: `app.api.maker = api` in maker.js (the
  kits helper's work) is not an object literal, so the map cannot read the maker's members. character.e2e.ts has two
  failures on `.ws-built summary` matching two or three elements, from the Workshop's new kit examples. Neither file
  was touched here.
- The vitals lint ("written only inside vitalsEdit") does not see `sheetEdit` calls in room-events.ts. They ask
  `fightOf` before writing, as vitalsEdit does; folding them into the lint needs the lint to know a second writer.
- A room event that throws is still lost for this session once the poll cursor passes it (now with nothing written);
  getting it again is the outbox's and the cursor's work (U2).

## Principles that changed a choice

- principle-model-the-domain: the applier became a `land` (step plus tell) rather than a list of writes, so "written"
  and "told" cannot disagree.
- principle-boundary-discipline: `give` reads a view's loose reward with `parseRewards` once; `grant` trusts it.
- principle-fix-root-causes: the root was recording the id apart from the change, so the fix is in `once`, not a
  try/catch around appliers.
- principle-make-operations-idempotent: a repeat of a delivered award finds the id and writes nothing; a failed one
  left no state behind, so the next delivery converges.
- principle-subtract-before-you-add and principle-migrate-callers-then-delete-legacy-apis: `firstTime`, `grantXP`,
  the `level` event and `chainFromGM` are deleted in the same commit that moved their callers.
- principle-test-behavior-not-implementation: the applier tests read the save back, not which helper was called; the
  old harness counted calls of fake hunter writers.

## Checks

- `bun run typecheck`: `$ tsc --noEmit && tsc -p tsconfig.views.json --noEmit` (no errors).
- `bun run test`: 2997 pass, 4 fail (the four deps.test.ts maker failures above, present at HEAD).
- Browser, port 3271: reward-room 1 passed, gates-quests-dailies 21 passed, rewards 5 passed, fight-vitals 3 passed,
  room-sync 1 passed, used 6 passed, room-sync-fixes 14 passed; character 21 passed, 2 failed (the Workshop locator
  above).

## Decision trail

| ts | phase | decision | why | evidence | result |
|---|---|---|---|---|---|
| 2026-11-14 | design | one `grant` step in a new core module, not in rewards.ts | it imports the hunter modules and quests.ts; rewards.ts stays the reader | src/core/hunter/grant.ts | done |
| 2026-11-14 | design | ids from the save's seq inside the step | the core pattern (`told`); no reserved ids | grant.ts `idsFrom` | done |
| 2026-11-14 | design | appliers answer a step and a tell | the id and the change in one write; tell only when written | room-events.ts `Land` | tests green |
| 2026-11-14 | design | a level step reached is completed after the write | the quest's own transition and window | notes, row 66 | done |
| 2026-11-14 | merge | a level step reached is completed in the same write (stepsReached) | the lead's follow-up after the merge with main | grant.ts stepsReached | tests green, mutation caught |
| 2026-11-14 | verify | mutation of appliedOnce caught by the part-way test | the test must fail when the behaviour breaks | tests/applied.test.ts | 1 fail, reverted |
