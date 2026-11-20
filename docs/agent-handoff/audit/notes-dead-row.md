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

## 8. Unit 1 as built

the owner's rulings (section 7 defaults): only Revive brings a defeated monster back; Revive is accepted only on the dead, a dying hunter takes Stabilize or a heal; a fight stored before this reads as no fight.

What is where:

1. `Body = Clock & BodyLife & {...}` (effect-ops.ts). `BodyLife` is `{ kind: 'hunter'; life: Life } | { kind: monster, shadow or summon; life: FoeLife }`. `HunterRow` is the hunter member. `NewRow` omits on each member (`OmitEach`, fight-types.ts), so a row's kind keeps its life.
2. `src/core/combat/row-life.ts`: `FoeLife`, `FOE_TABLE` (up: damage, heal, setHp, maxChanged; dead: revive), `foeLifeAfter`, `rowLifeAfter` (the one writer; the same row back when nothing changed), `rowLifeTakes`, `refilledRow` (vitals.ts `refilled` on a hunter row), `sameLife`.
3. Writers moved to it: `hurt` and `healed` (land.ts), `payDue` (fight-turn.ts), the HP price (charge.ts), `withStatuses` (`maxChanged`), `adjust` (`hpChange` of the delta), `refill` (`refilledRow`), the new `life` command (fight.ts).
4. `rowHp` and `isUp` (row-hp.ts) read the life. Up's HP, else 0. No clamp on read: the writer keeps the life within the row's maximum.
5. The `life` command: `{ type: 'life'; id; event: RowLifeEvent }`, `RowLifeEvent` the life machine's revive, stabilize and deathSave. Setup and running take it. Refused `lifeCannot` (words in refusal-words.ts) when the row's life does not take the event. It goes through `gmChange`, so a row stood up rejoins the turns and a revived monster on a taken tile is refused `taken`.
6. Write-back: `writeBack` compares lives (`sameLife`) and the `vitals` effect carries `life` and no `hp`. `SheetEdit` `totals` takes `life` (vitals.ts `withLife`, within the sheet's maximum) or, for the room's `vitals` message only, `hp`. `howOf` reads a fight's totals: dead to up is the GM's, a change while dying that leaves the hunter down is a death save, the rest the fight's.
7. `Ctx` is `{ rules }`. `rowLife` and every `ctx.life` closure are gone (combat.js, pay.ts, solo.ts, play.ts, the tests).
8. A solo run writes the hunter row's life back (`RowEnd.lifeLeft`), then its death saves on the sheet as before.
9. Views: combat.js `revive` sends `life` revive for every row this phone's fight holds the life of (this phone's hunter, a monster, a shadow); a player's hunter keeps `adjust` plus the room's `revive`. `combat.life(cid, event)` is new on the API. hunter.js `api.life` in this phone's fight sends `combat.life`; `lifeInFight` is gone.
10. Charts: the `life` command is in the random play (`gmLife`, tests/models/fight-play.ts) and in the fight chart's step words; a foe's life has its own chart (scripts/charts/foe-life.ts, in `MACHINES`).
11. Lint: "a row's life changes only in row-life.ts" scans all of `src` but `src/core/hunter/` (the sheet's life, vitals.ts's), with one named exception, odds.ts's `RowEnd.life` (a life state, not a row). `hp` left the field list of "only the fight changes a combatant's place, ...".

Where unit 1 left the design, and why:

1. The design's lint scope was `src/core/combat`. It is all of `src` but the sheet's own modules, so a view cannot write a row's life either.
2. `totals` keeps an `hp` arm for the room's `vitals` message, since unit 1 does not touch `src/edge/room-events.ts`. Unit 2 deletes the arm when `vitals` carries a life.
3. `rowHp` reads the life's HP without the maximum: the one writer already keeps it within, so a clamp on read would hide a writer's bug.
4. Row fixtures in tests take a starting HP through `tests/fixtures/life.ts` (`lifeAt`, `atHp`, `RowPatch`): a hunter at 0 is dying with no saves, a foe at 0 dead. The e2e `fightRow` helper adds `hp` read from the life.

Expectations changed: the `vitals` effect lost `hp` (its life holds it); "a monster the GM brings back from 0..." now revives it with the `life` command (ruling 1), still refused `taken`. The e2e setups of a player's hunter row at 0 HP (table-turn.e2e.ts) set it dying, as the GM's row read it before.

For unit 2: the remote row joins with the sheet's whole life already (rows.ts `partyRow` is shared). A player's death saves still land on the player's sheet only; `sendRemote` still sends `hp`; the card's Revive of a player's hunter still sends `adjust` plus `revive`, which raises a dying row (a heal) but is refused on a row that joined dead. The `totals` `hp` arm and `hpChange` on the room's path go with the wire change. The card's Revive is still offered on any down row; on this phone's dying hunter it is refused with the `lifeCannot` words until unit 3 offers it only on the dead.

## 9. Unit 2 as built, and what unit 3 must know

the owner's rulings taken (section 7 defaults): a player's death save in the GM's fight is rolled on the player's phone and sent to the GM's fight, as a cast is; Revive is offered and accepted only on the dead.

What is where:

1. The wire. `VitalsPayload` (protocol.ts) carries `life: Life` in place of `hp`, read by `parseLife` (vitals.ts) with `MAX_TOTAL` as the HP cap. The `sendRemote` effect (fight-types.ts) carries `life`, and `writeBack` (fight-turn.ts) sends the row's own life for a player's hunter as it does for this phone's. combat.js builds the message from it.
2. The sheet. `SheetEdit` `totals` takes only `life` (grant.ts); the `hp` arm and its `setHp` path are gone. The `vitals` applier (room-events.ts) writes the life and tells what it did through `fightLifeTold` (`lifeNews`): down, each save with its count, stable, dead, up again, revived.
3. The death save. New message `deathSave`, `{ by: SheetKey; roll: 1..20 }`, `ownSheet`, applier `null`. hunter.js `deathSave` in the GM's fight rolls the d20 and posts it through `api.life`'s table branch (`saveToTable`); any other life event there is the GM's (`gmHolds`). combat.js takes it on the GM's phone: the row whose holder is `by`, in setup or running; once by its id (`wasApplied` in applied.ts, then the `life` command with `appliedOnce(eid)` as its `also`, so the id is recorded in the command's own write); a row whose life does not take a save records the id alone. sync.ts chases the answer after it (`FIGHT_MOVES`).
4. Revive. combat.js `revive(r)` is the `life` command for every row; the `adjust` plus `revive` branch and its log line are gone, so a row that joined dead stands up. gm.js `sendRevive` sends the room's `revive` only when no fight on this phone holds the hunter. The `revive` applier writes nothing on a hunter a fight holds, so a Revive posted before the hunter joined a fight cannot raise the sheet under a dead row.
5. The join. A player's hunter's row tells its phone its life and totals as it joins (fight-turn.ts `joinedBack`, from fight.ts `add` through `joinFx`), even unchanged. The row is built from the sheet the GM's phone last read, which can be a poll behind: `character.e2e.ts` ("a player in a room at 0 HP ...") added the hunter up at 45 HP a moment after the player fell, so the row was up and the sheet dying, and the player's death saves were refused by the row. From the join the row is the one writer, so the sheet now takes the row's life at once. That test now waits for the GM's phone to read the dying sheet before the GM adds the hunter.
6. The outbox. `standsFor` for `vitals` is `vitals <to>` (protocol.ts), unchanged: a later total holds the whole life, so it stands for an earlier one. `deathSave` stands for itself, so three saves queued offline are three saves.

Where unit 2 left the design, and why:

1. The message is named `deathSave`, not `save`. In this code `save` is the stored save everywhere (`Save`, `store.apply`, a save step); `deathSave` is the life event's own name.
2. Its roll is refused off the d20, never clamped (`d20Face` in protocol.ts). The shared `int` reader clamps: a 0 would read as 1, two failures.
3. The GM's phone takes a death save at any time while the row's life takes it, not only on that hunter's turn: unit 1's `life` command has no turn rule, and a replay is stopped by the event id instead of `onTurn`.
4. The design's `hpChange` on the room's path stays in `landHp`: it is the GM board's change to a hunter no fight holds, a delta, not a total.
5. The join write-back (item 5 above) is new: the design had the row take the sheet's life at join and said nothing on the wire then. The browser test showed the two homes disagreeing from the join until the row's first change.
6. The room's `revive` applier now refuses a held hunter, which the design did not list. Without it a Revive sent while no fight held the hunter, landing after the hunter joined one, would give the life two homes again.

The wire: a `vitals` message grows by 19 characters for an up life at 5 digits of HP, 14 for dead, 16 for stable, and 42 at most (dying with its saves); the `life` field is 48 characters at most, the design's bound. A `deathSave` body is the id, the key and `"roll":20`.

Known edge: the outbox keeps one `vitals` per hunter while the room is away, so a death followed by a Revive can reach the sheet as dying to up. grant.ts `fightHow` reads that as the fight's raise, not the GM's revive, so the Chronicle's fact says "fight". The life itself is right.

For unit 3 (what each phone shows):

1. A player who fell a moment before the GM added them can see their sheet go back up at the join: the row joined from the GM's older read and the sheet follows the row. The GM's card shows what the row holds; the GM fixes it with a hand edit. Unit 3 may want the add window to show the life it adds the hunter with.
2. The player's sheet now holds the row's life, so the sheet's death panel, the HUD's death save (`[data-tbdsave]`) and the GM board's card (remote sheet's `life`) already show Dying, Stable and Dead from the row, one poll late. The GM's combat card still reads a player's row through `cardOf` (`down`); the fight doc still has no life (`l` is unit 3's).
3. The GM's card still offers Revive on any down row (`cardOf(...).down`, combat.js `[data-defeat]`); on a dying row it is now refused with the `lifeCannot` words for every row, a player's too. Unit 3 offers it only on the dead (`rowLifeTakes(r, 'revive')`).
4. A player's death save toasts "You rolled N. It counts when the GM's fight takes it." on tap, then the `vitals` applier's words when the row's life comes back. hunter.js `deathSave` keeps its own words for this phone's fight; the two lists could be one table in vitals.ts.
5. The death save button stays enabled while a save is on its way, so a second tap sends a second save. That is a roll the player made; if unit 3 wants one at a time, hold it as table.js holds a turn (`hold`, the `sync:outbox` event).
6. In a fight the party loses when nobody on its side is up (fight-turn.ts `overIf`), so death saves happen in the GM's fight only while someone else stands. The e2e adds the GM's own hunter (`fight(..., { ally: true })`).

Principles that changed a choice: `principle-fix-root-causes` (the `revive` applier refuses a held hunter, the same second home from the other side); `principle-boundary-discipline` (the d20 is refused at the reader, not clamped, and the GM's phone trusts the parsed roll); `principle-model-the-domain` (Revive of a player's hunter is the same `life` command as every row's, so its own branch was deleted).

Checks of unit 2 (each under `flock /tmp/box.lock`): `bun run typecheck` clean; `bun run test` 4510 pass, 0 fail, 4513 tests across 115 files (3 todo or skipped); browser files with `--workers=1`, port 3281, the box's Chrome: table-turn 15 passed, fight-vitals 3, character 26, combat-turns 19, maps 11, customization 9, gates-quests-dailies 27, phone 9. `feel.e2e.ts` was not run; it typechecks.

## 10. Unit 3 as built: what each phone shows

Started from `42def087` with `claude/festive-fermat-tvpykj` merged in (no conflict; deps map and charts regenerated, unchanged). Baseline: `bun run typecheck` clean, `bun run test` 4521 pass, 0 fail.

Plan (written before the code, in case the stream drops):

1. One home for the words: `lifeWord` in row-life.ts, over a row's kind and its life's state. A hunter: Dying, Stable, Dead. Any other row: Defeated. Up: none. `LIFE_TAG` (vitals.ts, "Down" and "Down, stable") goes; the sheet's death panel and chip read `lifeWord` too.
2. The doc: `down` leaves the doc row; each row carries `life: { at }` (a hunter's `LifeState`, any other row's `FoeLifeState`), on the wire `d`, the state's index in `LIFE_STATES`, absent while up.
3. The cards: combat.js card and order, gm.js board for a hunter this phone's fight holds, table.js order and token card, the map's token label, all through `lifeWord`. The card's life button: Revive only where the row's life takes `revive`, Stabilize where it takes `stabilize`, Mark defeated only while up.

What is where (as built):

1. Words. `lifeWord(x: LifeAt)` in row-life.ts, over `{ kind, life: { at } }` (a `Body`, a doc row, or a sheet as `{ kind: 'hunter', life }`): a hunter Dying, Stable, Dead; a monster, shadow or summon Defeated; null while up. `LIFE_TAG` is deleted. chips.ts `chipDef` reads it (`ofLife` names the chips drawn from the life, so the GM board colors them); hunter.js's death panel reads it.
2. The doc. `down` left `DocRowBase`; each member carries `life: { at }` by its kind (`hunter` `LifeState`, the rest `FoeLifeState`; `hunter` and `shadow` are now two members). `rowWire` writes `d`, the index in `LIFE_STATES`, absent while up; `wireLife` (protocol.ts) reads it by the kind's table and refuses the rest (a dying monster, 0, 4, `true`, a word), which drops the row. `isUp` takes any `{ life: { at } }`, so it reads a doc row; `docSpots` derives `down`. `MapBody` and `MapToken` gained `word`.
3. Cards. combat.js card tag and order chip read `lifeWord(r)` from the row for every row (a player's hunter too), styled by `data-life-at`; the death save button reads `rowLifeTakes(r, 'deathSave')`; `lifeActHtml` draws Mark defeated while up, Stabilize while dying, Revive once dead, nothing while stable. gm.js board reads the held row's life (`heldRow`, through `hunter.fightOf`) for its chips and Revive, and offers Stabilize where it can be sent (the fight's row, or a hunter of this phone). table.js: the order row's word, the HUD's life line (the row's word; Roll death save while both the row and the sheet take it), the token card. map.js: the token label says the word.
4. Look. app.css `.lw` with `[data-life-at]`: dying warm (`--warm`), stable quiet (`--cyan-dim`), dead red and filled. A dying row in the order is dimmed, a dead one dimmed more and struck through.

Where unit 3 left the design, and why:

1. The doc's field is `d`, not `l`: a summon's row already has `l` (rounds left), and one field for every kind keeps one reader.
2. A defeated monster reads Defeated everywhere its life shows. Its card already said Defeated; the order chip and the players' list said Down. One state, one word; combat-turns.e2e.ts and layout.e2e.ts expect Defeated now. If the owner wants Down back for monsters, it is `LIFE_WORDS.foe.dead`, and the card then says Down too.
3. The sheet's own words changed with the cards' (the panel and the chip read Dying and Stable, not Down and Down, stable): one home. character.e2e.ts and statuses.test.ts expect the new words.
4. The GM board gained Stabilize, which the design did not list, so the board and the card offer the same life actions.

The doc's size: a row that is not up is 3 characters shorter (`"d":1` for `"d":true`; measured 110 against 104 for an up hunter row, and the old flag was 9 with its comma); an up row is unchanged, so the worst case (every monster up) is 45,818 and 53,627 before and after (the protocol test's print, run at `42def087` and at unit 3).

The two leftovers:

1. A player who fell while the GM's phone had not read it, added to the fight: reproduced (table-turn.e2e.ts, the GM's phone offline while the player falls; the row joins up at 45 and the join's write-back stands the sheet up). Left as `test.fixme`. Why it needs a call: the GM's phone has no way to know its read is stale. Two ways: (a) the join waits for a fresh read of the room's sheets (and refuses a remote join while the room is away), or (b) the GM's phone, reading a sheet pushed before the join that differs from the row, re-seats the row's life (a new fight command, and the player's phone has already been told the stale life, so its Chronicle records a raise and a fall that never happened unless the join's write-back is held until then). (a) is smaller; (b) keeps offline adds.
2. A death then a Revive arriving as one update: reproduced (applied.test.ts, the outbox's `post` with `standsFor` keeps only the up total, and the sheet records one fact, raised by the fight). Left as `test.todo`. Why it needs a call: the fix is a `standsFor` per life state (`vitals <to> <at>`), which undoes unit 2's "a later total stands for an earlier one" (protocol.test.ts says so) and lets an older held total land after a newer one on a phone whose applier threw (applied.ts `replaced`); or the message carries how its life moved, which still loses the death.

Seen at 390 px (deviceScaleFactor 1, a throwaway script, deleted): the GM's card header wraps the life tag to its own line under the name, the order row keeps name, word and HP on one line with the name cut by its ellipsis, the player's list and HUD fit. Dying (orange outline), Stable (pale outline) and Dead or Defeated (red, filled) read apart at a glance. The GM board's Revive was cut to "Reviv" in the quick HP row (before this unit too); its life button now keeps its natural width and the row wraps.

Also seen, not this unit's: on Mira's phone a toast "You are up again at 45 HP." showed around her join, before "You are down." Worth a look by whoever owns the `vitals` applier's words (room-events.ts `fightLifeTold`).

Principles that changed a choice: `principle-model-the-domain` (the doc row carries the life's state by its kind, the same `{ kind, life: { at } }` shape as a row, so `isUp` and `lifeWord` read both, and `down` is derived, not a second field); `principle-experience-first` (a button the fight would refuse is not drawn, and each life state has its own color so the GM tells the dead from the dying without reading).

Checks of unit 3 (each under `flock /tmp/box.lock`, port 3281, the box's Chrome, `--workers=1`): `bun run typecheck` clean; `bun run test` 4528 pass, 3 skip, 1 todo, 0 fail, 4532 tests across 118 files; table-turn 18 passed and 1 skipped (the leftover's fixme), fight-vitals 3, character 28, combat-turns 19, battle-map 27, solo 9, look 41, and layout 6 (its words changed). `feel.e2e.ts` was not run; it typechecks.
