# Notes of unit P0, the fight's missing pieces

Commits 0523fb2 (code and model) and ac76951 (tests, chart), on `claude/zen-pasteur-ov4cgd` in the main tree.

## Files outside the unit's list

- `tests/effect-ops.test.ts`, `tests/resolve.test.ts`, `tests/models/fight-sim.ts`: each builds a `Body` or a monster `Origin` by hand, so each gained `xp: 0` and `tweak: NO_TWEAK` (one line each, plus the import). Both fields are required.
- `tests/fight-model.test.ts`: a new invariant (every sheet heard of every change of its row's HP, mana, fatigue and status keys; a shadow's sheet, of its HP) and `shadowHp` in the effects random play must reach. With the `startTurn` fix below reverted, the invariant fails, so it can see the bug.
- `docs/state-machines.md`: `bun run charts`.

**For P1 (worktree, running beside this unit):** a `Body` or `NewRow` now needs `xp`, and a monster `Origin` needs `tweak` (`NO_TWEAK` from `derive.ts`). A test written before this unit lands fails the typecheck until it adds them.

## Choices where the plan was silent

- **`adjust` takes signed amounts, not totals.** Today's GM taps `+5`/`-5` and the Table feed's Apply sends a damage total (`setHp(c, delta)`, `applyDamage`), and W3's API is `adjust(cid, delta)`. Each amount is added and kept within 0 and its maximum. The view does no arithmetic. Totals stay on the write-backs (`vitals`, `sendRemote`, `shadowHp`), which is where a repeat must change nothing.
- **"Any phase" is setup and running.** The rows of an ended fight are the summary's record. After the fight the GM edits the sheet itself. `adjust` and `status` are `null` in `none` and `ended`.
- **A GM's status gets no tenacity or kind factor.** The GM typed its length. Its source is `{ id: null, tier }`.
- **`status` removes first, then adds,** so one command replaces a status (the window's "change the rounds").
- **A foe removed while down keeps its XP.** The old fight did this (`bankedXp`), and `combat-turns.e2e.ts:128` ("a removed defeated monster keeps its XP and a removed live one gives none") is to be rewritten by W5, not deleted. `Fight` gained `banked` (all three phases); `Summary.xp = banked + xp of every foe row down`.
- **`ShadowId`** is branded in `effect-ops.ts`, beside `Holder`. `ability-types.ts` was not in the unit's list.
- **The sheet hears of a status change** when a status goes on, comes off, or changes def, source or end. Rounds left are worked out at that moment. Time passing alone sends nothing, so the sheet's rounds are as of the last change.
- **A refusal `noChange`** for an `adjust` or `status` that changes nothing. A GM status past `MAX_STATUSES` (30) is refused `tooMany`, because `parseFight` refuses a row with more.

## Bugs found on the way

1. Random play: the GM healed a monster back from 0 after another body had taken its tile, and two bodies stood on one tile. Fix: a monster or shadow brought back onto the map by the GM needs its own tile free, else `taken`. The GM can `place` it first. Test: "a monster the GM brings back from 0 after another body took its tile is refused".
2. Random play: a slow put on a monster that was down rescaled its past turn time to a negative tick, and `parseFight` refused the fight. Fix in `withStatuses`: a body whose turn time is already past has no wait left to rescale. Test: "a slow the GM puts on a monster that is down leaves its turn time as it was".
3. Found while writing the status write-back: `startTurn` took `before` after `advance`, so a status that ended for a row other than the current one, and a max HP clamp that came with it, never reached the sheet. `before` is now taken before time moves. Test: "a status that runs out reaches the sheet".

Not fixed, outside the unit: `resolve`'s `applyStatus` has no `MAX_STATUSES` bound either. With more than 30 status keys on one row the fight could not be stored.

## What I made

- `fight-types.ts`: commands `adjust { id, hp?, mana?, fatigue? }` and `status { id, add?: StatusGrant, remove? }`; `StatusGrant { key, def, duration, tier }`; `Fight.banked`; `Summary.xp`; `vitals` and `sendRemote` carry `statuses: SheetStatus[]`; effect `shadowHp { hunterId, shadowId, hp }`; refusal `noChange`.
- `fight.ts`: `adjust`, `status` and their shared `gmChange` (in setup the sheet hears of the change; while running it goes through `after`, so a downed row is defeated, the fight may end and the current row loses a turn it can no longer take). Their cells in every row of `TABLE`. `removeFrom` banks a downed foe's XP.
- `fight-turn.ts`: `writeBack(before, after, now, ctx, fx)`, the one place a row's change becomes `vitals`, `sendRemote` or `shadowHp`; `ended` sums the XP; `startTurn` takes `before` before time moves.
- `effect-ops.ts`: `Body.xp`; `Holder` `shadow`; `ShadowId`, `shadowId`; `SheetStatus` and `sheetStatuses(list, now, R)` (W2's `Hunter.conditions` type); the monster `Origin` has `tweak`; `modified` reads it.
- `derive.ts`: `Tweak`, `NO_TWEAK`, `monsterStats(rank, archetype, R, tweak)`; `monsterSheet(..., mods, tweak)` multiplies max HP by `tweak.hp` and adds `tweak.stats` before the curves.
- `fight-parse.ts`: reads `tweak`, `xp`, the shadow holder, `banked` and `Summary.xp`.
- `tests/models/fight2-play.ts`: monsters with XP, the Imp with a tweak, Igris with a shadow holder, random `adjust` and `status` in setup and running.
- `scripts/charts/fight2.ts`: `adjust` and `status` may end a fight; the note names them.
- Tests: `tests/fight.test.ts` 15 new (38 to 53), `tests/derive.test.ts` 2 new.

Lines: 16 files, 469 added, 116 removed (`git diff a31d4d5 ac76951 --shortstat`). Nothing in these files became dead, so nothing was deleted.

## Which principle changed a choice

- model-the-domain: the hand edit and the Status window are commands with cells in `TABLE`, and the write-back is one function, `writeBack`, rather than an effect pushed by each handler.
- make-operations-idempotent: write-backs are totals with the status list as a whole; a hand edit is a delta because one tap is one change.
- test-behavior-not-implementation: expected numbers come from the rules (45 HP base, 1340 ticks is 1.3 rounds, half of the printed 324 is 162, a C brute's 69 points split 46 and 23). The model's new invariant was checked against the reverted bug.

## The checks

- `bun test tests/fight.test.ts tests/fight-model.test.ts tests/derive.test.ts tests/statecharts.test.ts`: `Ran 139 tests across 4 files. [40.83s]`, 0 fail.
- `bun run charts`: `wrote /home/user/systemgaming/docs/state-machines.md`.
- `bun run deps -- --write`: `wrote docs/dependency-map.md` (no change).
- `bun run build`: `Built 12 files into dist/ (build c00fc1335fd9)`.
- `bun run test`: `Ran 2032 tests across 53 files. [86.10s]`, 0 fail (4 todo, from before this unit).

Red after this unit: nothing.
