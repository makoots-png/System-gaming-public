# The last writers of a hunter's vitals beside the fight: notes

Worktree `.claude/worktrees/agent-a65e638815890f89e`, branch `worktree-agent-a65e638815890f89e`, from 935d7f5. Not pushed.

## Step 1: reproduce

New file `tests/e2e/fight-vitals.e2e.ts`.
Three tests, each on one GM phone in the starter's Goblin Den fight, all red at 935d7f5:
- "a status the GM awards to a hunter in the fight shows on the fight's card, ...": `Expected value: "hasted"`,
  `Received array: []` (the award wrote `h.conditions`; the row never held it, so the next `vitals` drops it).
- "a hunter in the fight who levels up from an award is back to full HP on the fight's card, ...": `Expected: 51`,
  `Received: 46` (the level-up refilled the sheet; the row stayed 5 down).
- "a dead hunter in the fight whom the GM revives from the sheet stands at 1 HP ...": `Expected: 1`, `Received: 0`
  (the sheet stood up at 1 HP; the row stayed at 0, so it had no turn, and its next `vitals` with HP 0 put the sheet down again).

## Step 2: the fix (9014a6c)

Root cause: each writer decided for itself whether the hunter was in a fight (W9's `handEdit`, gm.js's `fightRowOf`), and
the ones that did not ask (a reward's statuses, the level-up refill, a daily's recovery, every life event) wrote the
sheet. Now one function answers "where do this hunter's HP, mana, fatigue, life and statuses live":
`fightOf({ hid } | { key })` in `hunter.js`, published as `app.api.hunter.fightOf` (`{ at: 'row', cid }`, `{ at: 'gm' }`
or null). `vitalsEdit(hid, why, onSheet, onRow, onTable)` is the one writer that asks it; `handEdit` is its `adjust` form.

Every writer found (grep for vitals.ts writers, `addSheetStatus`, `.conditions`, `setVitals`, `life(`, `applyRewards`,
`refill`) and what it does now:
- `damage`, `heal`, `changeMana`, `changeFatigue`, `spendMana`, the sheet's step buttons: `handEdit` (W9's, now on vitalsEdit).
- `addCondition`, `removeCondition` (sheet, GM board, `status` message, effects.js): vitalsEdit; the row's status takes the
  rules' def when the status names a built-in by key (`statusToRow`).
- `applyRewards`' statuses: out of its update, through `addCondition`, so in a fight they go to the row; on a player's
  phone in the GM's fight they are refused with W9's toast and left out of the window's lines.
- The level-up refill (`grantXP`): `hunter.refill` (new), which in a fight is `combat.refill` (new: the row's HP and mana
  to the row's maxima, nothing sent when full, so no "Nothing to change." toast). Refused in the GM's fight; the level-up
  window then drops "HP and mana fully restored".
- A daily's recovery (`quests.js`) and the starter's fill (`starter.js`): `hunter.refill`; both lost their `refill` import.
- `life` (sheet's Revive and Stabilize, the GM board's Revive, the `revive` message, every death save): vitalsEdit. The row
  has no life (the fight reads the sheet's through `ctx.life`), so in this phone's fight the event goes on the sheet and the
  HP it raises from 0 (Revive, a natural 20) goes to the row (`lifeInFight`). On a player's phone in the GM's fight the life
  event goes on the sheet (the GM's phone sends the HP).
- The fight card's Revive on a local hunter whose sheet says dead: `hunter.life(revive)` (it was `adjust { hp: 1 }`, which
  stood the row up while `setHp` left the sheet dead).
- The GM board's Revive of a player in this phone's fight (`gm.js` `sendRevive`): the `revive` message, then `adjust { hp: 1 }`
  on the row; either order of the two on the player's phone ends at 1 HP.
- The GM's award to a player in this phone's fight (`gm.js` `doAward`): its statuses go to the row (`combat.status`), the
  `award` message carries the rest (none sent when nothing is left).
- `gm.js` `fightRowOf` now asks `hunter.fightOf({ key })`.
- `setVitals`: the fight's own write-back (`writeSheet` in combat.js, the `vitals` applier). Unchanged.
- `hunter.maxima` lost its last callers (quests, starter) and was removed from the API.

Not changed, listed:
- `fit` (hunter.js): brings HP and mana down to a lowered maximum in the update that lowers it (a title, points, gear;
  gear is refused in a fight). The row keeps the maximum it joined with; the next `vitals` sets HP within the sheet's.
- The sheet's max-HP and max-mana edit (`hpAdj`, `manaAdj`): a maximum, not HP; same as `fit`.
- A shadow's heal in the Shadows panel (`shadows.js`): a shadow, not a hunter; its row's HP comes back through `shadowHp`.
- A player's natural 20 on their own phone in the GM's fight: the sheet stands at 1 HP, the GM's row stays at 0 until the
  GM heals the card; the row's next `vitals` puts the sheet down again. Needs a room path from the player (a protocol change).
- A level-up from an award on a player's phone in the GM's fight: the refill is refused with the toast (no room path).
- The fight card's Revive on a remote row whose player is dead: `adjust { hp: 1 }` only; the player's `setHp` leaves the
  sheet dead. The board's Revive does it right; the card would need the remote's life (from its pushed sheet).
- A heal op landing on a dead local hunter's row in a fight raises the row, while `setHp` leaves the sheet dead (core).

## Step 3: the lint (fd9620c)

`tests/lint.test.ts` "a hunter's HP, mana, fatigue, life and statuses are written only inside a call of vitalsEdit in
hunter.js, ...": outside hunter.js no view or edge line calls a vitals.ts writer or `addSheetStatus` or writes
`.conditions`; in hunter.js every call of a writer (`hit`, `changeMana`, `setMana`, `setFatigue`, `changeFatigue`,
`refill`, `rest(Of)`, `fitMaxima`, `lifeEvent`, `addC`, `delC`) sits inside the brackets of a `vitalsEdit(` or
`handEdit(` call, in `setVitals`, or on the one-line `lifeEvent`/`fit` helpers. Broken by hand twice (a Revive written
with `store.update` in `life`, a daily's recovery clearing `h.conditions` in quests.js): it named both lines; reverted.
On the way it also caught `{ ...rw, statuses: [] }` in gm.js under the combatant lint; the award now drops the field by
destructuring.

## Checks (last lines)

- `bun run typecheck`: `$ tsc --noEmit && tsc -p tsconfig.views.json --noEmit` (no error).
- `bun run test`: `Ran 2175 tests across 53 files.` 2175 pass, 0 fail. Needs `bun run deps -- --write` first; the map is
  regenerated in the worktree and NOT committed, as the brief says.
- Browser, port 3244, one at a time: fight-vitals `3 passed (17.0s)`, rewards `5 passed (54.4s)`, reward-room
  `1 passed (37.6s)`, character `20 passed (2.1m)`, table-session `7 passed (1.5m)`, combat-turns `14 passed (1.1m)`,
  table-turn (not asked; W9's player-phone refusals) `7 passed (2.4m)`. No pause seen.

## Which principle changed a choice

- fix-root-causes: the fix is the one question every writer asks (`fightOf`) and one writer that asks it, not a guard
  against the next `vitals`; the same class was then found in the daily's recovery, a natural 20 and the card's Revive.
- separate-before-serializing-shared-state: the row and the sheet each keep what only they hold (the row HP, mana,
  fatigue and statuses; the sheet the life machine the fight reads), so Revive is a life event on the sheet plus HP on
  the row, not a second HP writer. The lint holds the single path.
