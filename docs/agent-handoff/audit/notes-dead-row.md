# A dead hunter's row raised in a fight: the design

Branch `dead-row`, from `dacd81ab`. The failing tests are commit `4a936852`. No product code yet.

The owner's goal: one obvious, explicit place for a hunter's life in a fight, so the row and the sheet can never disagree.

## 1. What happens today

A hunter row's HP is a plain number that every rule clamps to 0 and its maximum. The life machine (vitals.ts `lifeAfter`, states up, dying, stable, dead) lives on the sheet. The fight asks the machine only in two places, `writeBack` and `refill`, through `rowLife` (fight-turn.ts). Every other raise skips it. These raise a dead hunter's row:

1. The GM's hand heal. fight.ts `adjust`, the clamp `to(...)`. Also reached from hunter.js `heal` on a held hunter. Proved: "the GM's hand heal of a dead hunter's row leaves it at 0 HP" (the old `test.todo`).
2. An ability's heal on an ally. resolve.ts, the heal branch of a use's outcome, `healed(t, dealt)` (land.ts rule 14). Proved: "an ally's healing salve thrown at a dead hunter's row leaves it at 0 HP".
3. A paid heal op. fight-turn.ts `payDue`, case `heal`, which also pays a status's heal a round. Proved through a zone's entry heal (`grounded`, then `owe`, then `payDue`): "a healing ground the GM lays under a dead hunter's row".
4. A heal land op (land.ts `landOne`, case `heal`, from a use's ops, a trigger, a zone's end). Same `healed` as path 2. Not proved on its own.
5. The GM's Revive (combat.js `revive`, gm.js `sendRevive`) is an `adjust` of `REVIVE_HP`. It is the one raise that must pass.
6. A natural 20 on a death save (hunter.js `lifeInFight`) is an `adjust` too. Legit, since dying may rise.
7. Regen on the dead row itself does not raise it today. A row at 0 HP takes no turn, and its own statuses settle only at its turn start. The test "Regenerating on a dead hunter's row" passes and stays as a guard.

On the sheet side, the write-back hands the row's HP to the sheet as `setHp` (fight-save.ts `wroteBack`, grant.ts `totals`). A dead sheet ignores `setHp`, so the sheet stays dead while the row stands at 10 HP. The `vitals` effect already carries a `life`, but `wroteBack` never reads it.

For a player's hunter it is worse. `rowLife` asks `ctx.life` only for a hunter on this phone. For a player's hunter it guesses the life from the HP (0 reads as dying, never dead). The player's death saves in the GM's fight are written on the player's own sheet (hunter.js `life`, the `onTable` branch), so the row never hears of them. The GM's card says "Down" for a dead player's hunter.

The root cause: a hunter's life in a fight has two homes and two writers. The row holds the HP, the sheet holds the state, and each rule that changes HP runs its own clamp instead of the life machine.

Run: `flock /tmp/box.lock bun test tests/fight-save.test.ts`, last line `Ran 38 tests across 1 file.` with 35 pass and 3 fail (the three proved paths).

## 2. The data shape

The row carries its life. `Body.hp` goes away and `Body.life` takes its place. HP is read through one function, `rowHp(b)` (vitals.ts `hpOf` on the row's life and maximum).

1. A hunter row holds a `Life` (vitals.ts). It is built from the sheet's life when the row joins (rows.ts `hunterRow`, `remoteRow`). A dead hunter joins dead.
2. A monster, shadow or summon row holds a `FoeLife`, `{ at: 'up'; hp } | { at: 'dead' }`, run by its own small table (up takes damage, heal and the GM's set; dead takes only `revive`). Dead is defeated.
3. The type says which: `Body` is the shared fields and `{ kind: 'hunter'; life: Life }` or `{ kind: other; life: FoeLife }`. A monster that is dying cannot be written.
4. The one writer of `life` is the fight reducer, through the gate in section 3. While a fight holds a hunter, the sheet's life is written only by the fight's write-back (the `vitals` effect locally, the room's `vitals` message for a player).
5. `rowLife`, `Ctx.life` and every `ctx.life` closure (combat.js, pay.ts, solo.ts, play.ts, the tests) are deleted. `Ctx` is the rules alone.

Why the row and not a read of the sheet through `ctx` (the earlier lead's direction): the sheet's life is a snapshot from before the command, so a hit to 0 and a heal in one command read a stale "up". A player's sheet sits on another phone and reaches the GM only after a poll. Reading it would gate on old data, and the death saves would still have a second writer.

## 3. The one gate

`rowLifeAfter(b: Body, event: LifeEvent): Body` in a new `src/core/combat/row-life.ts`. It runs the row's life through its kind's table (`lifeAfter` for a hunter, the foe table for the rest) and answers the row. Every HP change calls it: `adjust` (damage or heal by the sign), `refill`, `hurt`, `healed`, `payDue`, the HP price (resolve.ts rule 4), the maxima fit in `withStatuses` (effect-ops.ts, as `maxChanged`), and the new `life` command.

What keeps a new raise from going around it:

1. The types. A row has no `hp` number to set. The only value that fits `life` is a `Life` or a `FoeLife`.
2. A lint in `tests/lint.test.ts`, "a row's life changes only in row-life.ts": a `life:` key in a spread of a row, or `.life =`, anywhere in `src/core/combat` but row-life.ts, rows.ts (new rows) and fight-parse.ts (the reader). It takes `hp` out of the field list of "only the fight changes a combatant's place, HP, shield..." and puts `life` in.
3. A test per path in `tests/fight.test.ts`, one describe "a row's life", so a new path has one to copy.

## 4. Revive as a fight command

Shape: `{ type: 'life'; id: CombatantId; event: RowLifeEvent }`, where `RowLifeEvent` is the life machine's events that are not HP: `{ type: 'revive' } | { type: 'stabilize' } | { type: 'deathSave'; roll: number }`. Its cell in every row of fight.ts `TABLE`: setup and running take it, none and ended refuse it.

It does: the gate with the event. Revive stands a dead row up at `REVIVE_HP` (hunter or foe). On a row whose life does not take the event it is refused with a new `Refusal`, `lifeCannot`, words in refusal-words.ts. No time passes. A row stood up rejoins the turns as a raise does today (`consequences`).

The sheet: the write-back carries the new life. Locally the `vitals` effect, which `wroteBack` writes as the life itself (grant.ts `totals` takes `life` in place of `hp`). The fact keeps its "Revived" count: a totals change from dead to up can only be a revive, so `howOf` reads it as the GM's.

Who sends it: only the GM's phone sends `revive` and `stabilize` (combat.js card, gm.js board, both behind `app.isGM()`). A death save comes from the hunter's own phone or the GM's card.

A player's phone: it hears the new life in the room's `vitals` message (section 5). The room's `revive` message stays only for a player's hunter no fight holds.

## 5. Life travelling with a player's sheet

Sent today:

1. Player to room: the whole hunter, `life` included, in its sheet (sync.ts push, `SHEET_MAX` 32768). The GM's phone has it in `remoteSheets()`.
2. GM to player: `vitals` with HP, mana, fatigue and statuses, no life. `revive` as its own message.

Missing: the GM's fight reads the player's life only once, as HP, when the row joins. The player's death saves never reach the row. The player's sheet hears HP, which a dead sheet ignores.

What changes:

1. `remoteRow` takes the sheet's whole `life` at join. Nothing new on the wire.
2. `sendRemote` and the room's `VitalsPayload` gain `life: Life`, read by `parseLife` (protocol.ts). At most 48 characters a message.
3. A new room message `save`, `{ by: SheetKey; roll: number }`, `ownSheet: true`. The player's death save tap in the GM's fight posts it, and combat.js applies it as the `life` command, as it does `cast`. The player's sheet changes only when `vitals` comes back.
4. The fight doc's hunter row gains `l`, the life state's index, absent while up, in place of `d`. A hunter row is shorter than a monster's, so the worst case (all monsters, protocol.ts `DOC_MAX` note) does not grow. 0 characters on the worst case, at most 6 on a hunter row.

## 6. The units, in order

Unit 0. Every read of a row's HP through `rowHp(b)` and `isUp(b)`. No behaviour change. Files: about 20 in `src/core/combat` (effect-ops.ts among them), combat.js, map.js, table.js, gates/solo.ts. Tests: `bun run test` passes unchanged. The table sees nothing. Shares effect-ops.ts.

Unit 1. `Body.life`, row-life.ts and its gate, the foe table, the `life` command, local write-back of life, `Ctx.life` deleted, the lint. Files: row-life.ts (new), effect-ops.ts (`Body`, `withStatuses`), fight.ts, fight-types.ts, fight-turn.ts, land.ts, resolve.ts, rows.ts, fight-parse.ts, fight-save.ts, grant.ts, refusal-words.ts, combat.js and hunter.js (Revive and a death save send `life`), pay.ts, solo.ts, play.ts. Tests: the three failing tests pass, the guard holds, a "a row's life" describe in fight.test.ts (each path, Revive of a hunter and of a monster, a refused Revive of a living row), the lint test, the row fixtures in the tests moved to `life`. The table sees: a heal never lifts a dead hunter, Revive still does, and this phone's dead hunter's card says Dead. Shares effect-ops.ts. A stored fight from before reads as no fight (old saves need not work); the hunters keep their sheets.

Unit 2. A player's life in the GM's fight. Files: protocol.ts (`vitals` with life, the `save` message), fight-turn.ts (`sendRemote` with life), room-events.ts (the `vitals` applier writes the life), hunter.js (the death save in the GM's fight posts `save`), combat.js (applies `save`, stops posting `revive` for a held hunter), gm.js `sendRevive`. Tests: protocol.test.ts, applied.test.ts, table-turn.e2e.ts (a player's death saves in the GM's fight, a Revive of a dead player's hunter from the card). The table sees: the GM's card knows a player's hunter is dead, the player's death saves move the GM's row, and a Revive reaches the phone through one message. Shares nothing with sync.ts, save.ts or effect-ops.ts as far as I read. Check sync.ts again at build time, since the outbox's `standsFor` keys `vitals`.

Unit 3. What each phone shows. Files: fight-doc.ts, protocol.ts (`l`), combat.js and table.js cards (Dying, Stable, Dead from the row; the card's Revive only when the life takes it). Tests: fight-doc.test.ts (the size test still passes), the e2e for the player's card. The table sees: every phone shows Dead or Dying, not Down, and Revive shows only on the dead.

## 7. Open questions for the owner

1. A defeated monster brought back. Today a GM's "+10" on it raises it. In the design only Revive does. Default: Revive only.
2. A player's death save while the GM's fight holds the hunter. It would be rolled on the player's phone and land when the GM's phone takes it, as a cast does. Default: that. The other choice is the GM rolls it.
3. Revive on a hunter who is dying, not dead. Today the card's Revive raises a dying player's hunter to 1 HP. The life machine refuses it. Default: the card offers Revive only on the dead, and Stabilize or a heal on the dying.
4. A fight running at the update. Default: dropped, as old saves need not work. The other choice is a one-way read of the old `hp` (0 for a hunter reads as its sheet's life).
5. Other players seeing a hunter as Dead rather than Down. Default: yes.

## Principles that changed a choice

`principle-fix-root-causes`: the gate is not a check in `adjust`. The second home of the life goes away. `principle-model-the-domain` and `principle-foundational-thinking`: the shape first, the row's life as a union by kind, so a dying monster cannot be written and a raise cannot skip the machine.
