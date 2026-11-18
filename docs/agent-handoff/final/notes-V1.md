# V1: a player's item in the GM's fight

Goal: an item leaves a bag exactly when what it does happens, in the same write. Problem: a player's potion leaves the
bag when the `cast` is posted, so a cast the GM's fight refuses costs the potion; a potion used out of a fight is
several writes and its "may this apply" rule is the view's; a boon redeemed is two writes. Smallest change: one core
step per use (the change and its report in one `store.apply`), and the GM's fight telling the player's phone when it
took the item.

## Inventory (code at 5b162ed)

| Row | Verdict | Where |
|---|---|---|
| N1 | still true | inventory.js:77-82 `throwOnTable`: `takeOne` after the post; table.js:409-413 (the map's `use`) the same; combat.js:345-369 refuses with `turnDown` and nothing tells the player's bag |
| N2 | still true | inventory.js:120-134: `can` in the view, `effects.applyOps` (one write per op through app.api.hunter), then `takeOne`, then `uses.report` |
| H5 | still true | hunter.js:623-631: `dropBoon` in one apply, then `uses.report` (a second write, `void`) |
| E1 | still true, narrower than the audit says | effects.js:36-45 reads the sheet before and after each api call; in a fight in setup (`fightOf` answers the row, `combat.useItem` needs a running fight, `loadouts.inFight` answers false for setup) the heal goes to the row and the line says "+0 HP" |
| C1 | still true | combat.js:300-305 `useAt`: the `act` in one apply, then `inventory.consume` in another |

Sweep of the class (a use that leaves the bag apart from what it does): inventory.js:69-75 `useOnOther` (consume, then
report), skills.js:58 (`applyOps` for a skill: one write per op), table.js:409-413 (the map's item use).

## The rows

**N1** (a player's item gone on a refused cast). Cause: the bag was written at the post (inventory.js `throwOnTable`,
table.js's map `use`), and nothing tells the player's phone what the GM's fight did with the cast. Change: the item
leaves the bag in the write where the fight takes the use. `itemSpent(f, cmd)` (fight-save.ts) says which item an `act`
spends; combat.js `command()` hands it to `fought`, which posts the new GM-only room message `spent` (`{ to: [key],
item }`) unkeyed in the act's write; the player's applier (`once: true`) takes one with `spendItem`. A refused act
writes nothing, so nothing is sent. Tests: fight-save.test.ts "an item used in the fight ..." (4 cases),
applied.test.ts (once, an item no longer held), protocol.test.ts (`VALID`, one hunter, a save id), server-rooms.test.ts
(GM only), the room model's GM move `spent`, used.e2e.ts "a player's Frost Bomb the GM's fight turns down stays in the
bag". Commits 3d7397c, dfbcd3f (combat.js), 838466c (table.js), db95afe.

The audit's remedy put the item on the `vitals` totals. Rejected on paper: `vitals` is posted under the hunter's key,
so a newer totals message replaces a waiting one in the outbox (outbox.ts `post`), and a delta riding on it is lost; as a
running total it needs the player's phone to remember per fight what it took (a new hunter field). A message of its own,
unkeyed and applied once by its id, needs neither. (Variant three, the fight doc naming the casts it took, is news for
one doc and lost across a reload, the class of row 45.)

**N2** (a consumable as several writes, `can` in the view). Cause: effects.js applied each op through app.api.hunter (a
write each), then `takeOne`, then the report. Change: `useItem(h, itemId, rolls, R)` in src/core/hunter/use.ts answers
the hunter with its ops applied, one item spent and the lines of what changed, or `nothing` / `no-item`; the rule of
which ops change something is the step's (a heal on a dead or full hunter, mana when full, a cure of a status not held
change nothing). The view rolls `useDice` first and writes the step and its report with `uses.told` in one
`store.apply`. Tests: tests/use.test.ts. Placed in use.ts, not inventory.ts as the audit named: the step needs
grant.ts `sheetEdit`, which imports inventory.ts.

**H5** (a boon redeemed in two writes). Cause: `dropBoon` then `uses.report`. Change: `uses.told(hid, why, change, use)`
(uses.js over src/core/use-told.ts `toldStep`) writes the change and the log line or the outbox post together; hunter.js
`redeem` is one call. Test: use.test.ts "a use told in the same write"; used.e2e.ts's boon cases.

**E1** ("+0 HP" in a fight). Cause: effects.js read the sheet before and after an api call that, in a fight, wrote the
row. Change: the lines come from `useOn`'s own before and after on the hunter it writes, and inventory.use asks
`hunter.fightOf` (the one answer of where vitals live) first: a row holds them, the use is the fight's (and in a fight
being set up, refused with words); `effects.applyOps` refuses while a fight holds the hunter.

**C1** (a GM's local hunter's item in two writes). Cause: combat.js `useAt` called `inventory.consume` after the act.
Change: as N1, `fought` takes the item from this phone's hunter in the act's write; an item no longer held refuses the
whole command (`no-item`), so a fight never heals for free. Commit dfbcd3f.

Sweep: inventory.js `useOnOther` (consume then report) is one `uses.told`; skills.js:58 goes through `applyOps`, now one
write; table.js's map `use` fixed (838466c). `inventory.consume` deleted with its last callers.

Lines in Lane A's files: combat.js (dfbcd3f: `command()` builds `spent`, `useAt` drops the consume), table.js (838466c:
the map's `use` drops the consume).

Principles: model-the-domain (the spend is a fact of the fight's write, not of the tap); boundary-discipline (the
`spent` payload is read once in protocol.ts, the applier trusts it); make-operations-idempotent (`spent` is a delta, so
it is unkeyed and applied once by its event id; a repeat takes nothing); subtract-before-you-add (`consume` and
`takeOne` deleted).

Left: a player's two quick taps on Use before the GM answers send two casts; the second is stale (`at` is the turn's
time, `onTurn`) once the first moved the fight on, so it is turned down and costs nothing. The remote row's item
ability does not count the bag (the GM's fight does not know the player's count until a sheet arrives); a cast for an
item the player no longer holds is taken and spends nothing. Left: the bag's count is the player's, and the player's
phone refuses Use with none left.
