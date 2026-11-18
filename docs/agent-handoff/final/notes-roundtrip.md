# Notes: round trips and explicit writes (Helper A, main tree)

Briefs: `brief-roundtrip.md`, widened by `brief-explicit.md`. Helper A owns `src/edge/store.ts` and the views
hunter, inventory, skills, shadows, starter, gm, uses, dice, effects.

## The apply form (decided first, committed alone for Helper B)

- `store.apply(reason, step)`; `step: Step<Save>` is `(save) => Save | Refused` from `src/core/save-step.ts`.
- A refusal is `{ ok: false, why }` (`refuse(why)`, `isRefused`). It changes, stores and announces nothing; `apply` answers it.
- Aim a step at one part with `atHunter(hid, f)`, `atLibrary(f)`, `atSettings(f)`; chain with `both(...)` (all or nothing).
- The store writes the answer into the live save with `writeInto`: objects kept by identity or by `id` are written into,
  so a view that holds `h` keeps the live hunter (the views hold `h` across a render; replacing it would have left them
  writing a detached copy). Keys the answer lacks are deleted. A step copies what it changes and shares the rest.
- Why not `Object.assign(h, op(h))` in each view: it cannot delete a key, cannot refuse, and leaves the rest of the
  callback free to hold a rule again. One form is also one thing for the lint to look for.
- Lint: `tests/lint.test.ts`, "a view writes the save only through store.apply, with a step from core". Counts per file
  of `store.update(` plus writes on `h`, `hunter`, `save`, `draft`. Two blocks: `helperA` and `helperB`.
- Principles that changed a choice: boundary discipline (the step is pure, the store the thin shell), type-system
  discipline (a refusal is a typed value, not a throw or a `false`).

## Log

### Step 1: the allocation (progress.ts)

- Model chosen: `pending: Partial<Stats>` in place of `statsLocked`. `stats` are the confirmed stats; the sheet is built
  from `allocated(h)` = stats + pending (one line in `buildOf`). A pending point is not spent: `available` subtracts it,
  `confirm` moves it into the stat and into `spent`. Why: with two full lists, "unconfirmed" was `stats - statsLocked`
  and `spent` had to agree with it by hand; now any `(stats, pending, spent)` is a consistent state, so the wrong one
  cannot be written. `Progress` grew one field because `available` must see pending points.
- Functions: `raise(h, stat, role, R)`, `lower(h, stat, role)`, `confirm(h)`, `raiseMany(h, plan, R)` (Auto, all or
  none), `setStat(h, stat, value)` (the GM's edit, confirms that stat: its pending points count as spent),
  `startingStats(h, stats)` (pregens), `plusPoint` (the GM's +1). `spend` and `refund` are deleted.
- The GM branch is now a rule in core: with no point free the GM's + and − edit the stat (`setStat`), a player's are
  refused (`no-points`, `confirmed`); the GM's − stops at `STAT_MIN` (1). The view decides disabled buttons by asking
  the same functions (`isRefused(lower(h, k, role))`).
- One-way repair in `fixHunter`: a stored `statsLocked` becomes pending points, which leave `spent`.
- `fitted(h, R)` in `sheet.ts`: HP, mana and fatigue brought down to the sheet's maxima after a build change (the old
  `fit(h)` of hunter.js, now a core step a view can chain with `both`).
- Touched `custom.js` (Helper B's) in one place: Build's Auto called the deleted `spend`; it now applies `raiseMany`.
  Its count in the lint's `helperB` block went from 23 to 21.
- Invariant "raise then lower is the identity": exact for a player and for the GM while a point is free. For the GM
  with no point free, + then − gives back the same sheet and the same points free, but the points that were pending on
  that stat end confirmed (the edit confirms the stat, as the old code did). Stated in the test.

### Views converted (Helper A)

New core modules, each with a header saying what it owns: `src/core/hunter/inventory.ts` (bag, worn gear, gold, buy
and sell, the GM's shop list), `record.ts` (name, job, rank, titles, boons), `conditions.ts` (statuses on the sheet),
`skills-held.ts` (skills a hunter holds, the library's skills), `shadows.ts` (the army), `src/core/party.ts` (hunters
on this phone, the active one), `src/core/session-log.ts` (the session log and the dice log). Added to existing owners:
`sheet.ts` `fitted`, `setMaximum`, `setAdjust`; `progress.ts` `addXp`, `atLevel`, `plusPoint`; `rewards.ts`
`saveBundle`, `removeBundle`; `rules.ts` `writeTable`, `resetTable`, `saveRuleNumbers`, `resetRuleNumbers`; `role.ts`
`chooseMode`; `save-step.ts` `orKeep`.

Counted by the lint at the start (`store.update(` plus writes on a draft name): hunter.js 55, inventory.js 23, shadows.js
9, skills.js 6, starter.js 6, gm.js 5, dice.js 2, uses.js 1; effects.js 0 (it writes through app.api.hunter). All are
now 0 and the `helperA` block is empty. Also converted outside the lists: `src/app.js` (the mode pill, the header's new
hunter and switch), one line of `custom.js` (Auto, which called the deleted `spend`).

Edge changes: `store.apply` (store.ts); `sync.once(eid, write)` now writes the save a step answers (sync.ts), and a
`write` that answers nothing still changes the save in place, so Helper B's quests.js works before and after its
conversion. Not converted (edge, not a view; outside both briefs' lists): the link's own writes in `src/edge/sync.ts`
and `src/edge/forget-queue.ts` (device token, server status, bound hunter, join's new hunter and its undo, rebind,
GM keys).

Things moved that changed nothing a player sees, kept as found:
- `api.hunter.fit` deleted from `AppApi` (its last caller was inventory.js; `fitted` in core replaces it).
- gm.js's fallback that advanced the world day when `gates.advanceDay` left it unchanged: deleted. It ran only when
  the day could not move (0 days, or day 1 going back), where it also could not move it.
- A step's ids are reserved by the store before the step runs (`store.id`), so a step does not touch `seq`.

## Step 2: the round-trip table (Helper A's views; lines as of the conversion commit)

"Exact" means the test compares the whole value after do then undo with the value before. Where the undo is not
exact, the rule says why and the test asserts the difference. All of these rules are now in core, so each test is a
bun test over core functions; one browser case (`character.e2e.ts`, "each control on the sheet and the one that undoes
it") drives equip/unequip, a status on and off, and (GM) a title granted and deleted through the buttons, on both
phones, comparing the whole hunter.

| Pair | Do (view) | Undo (view) | Core | Result | Test |
|---|---|---|---|---|---|
| + then − on a stat (both roles) | hunter.js:583 `stat` | same | progress.ts `raise`, `lower` | exact (GM with no point free: same sheet and points, that stat's pending points end confirmed) | progress.test.ts "the allocation", random walk |
| Confirm then − | hunter.js:585 | hunter.js:583 | `confirm`, `lower` | a player's − is refused after Confirm | progress.test.ts |
| Equip, unequip | inventory.js:109 | inventory.js:114 | inventory.ts `equip`, `unequip` | exact (one of a stack splits off: unequip leaves two entries of one) | inventory.test.ts |
| Buy, sell | inventory.js:138 | inventory.js:144 | `buy`, `sell` | item back; gold short by price − `sellPrice` (half, rounded down, at least 1) | inventory.test.ts |
| Add item, remove item | inventory.js:86 | inventory.js:271 | `putItem`, `removeItem` | exact | inventory.test.ts |
| Use an item | inventory.js `use` | none | `takeItems` | no undo by design | inventory.test.ts (taking the last) |
| Gold given, taken back (GM) | inventory.js:93 | same, negative | `addGold` | exact while gold stays at or above 0 | inventory.test.ts |
| Shop item added or edited, removed, reset | inventory.js:232, 280, 284 | | `writeShopItem`, `removeShopItem` | exact on the list | inventory.test.ts |
| Skill learned, forgotten | skills.js:245 | skills.js:286 | skills-held.ts | exact | party.test.ts |
| Title granted, deleted (GM) | hunter.js:680 | hunter.js:691 | record.ts | exact, also when it was active | record.test.ts, character.e2e.ts |
| Title set active, unset | hunter.js:677 | same | `toggleTitle` | exact | record.test.ts |
| Status put on, taken off the sheet | hunter.js:453 | hunter.js:458 | conditions.ts | exact | party.test.ts, character.e2e.ts |
| Boon given, taken back (GM) | `applyRewards` | hunter.js:648 | `giveBoons`, `dropBoon` | exact | record.test.ts |
| Shadow summoned, dismissed | shadows.js:90 | shadows.js:87 | shadows.ts `setSummoned` | army exact; the summon's mana is not given back (rule) | shadows.test.ts |
| Shadow joins, released | shadows.js:31 | shadows.js:139 | `addShadow`, `releaseShadow` | exact | shadows.test.ts |
| XP given, taken back (GM) | hunter.js `gainXP` | same, negative | progress.ts `addXp` | level and XP exact; the peak stays (so a regained level does not refill twice) | progress.test.ts |
| Points given, taken back (GM) | hunter.js:586, raw edit | raw edit, award | `grantPoints`, `setPoints` | exact while the points free cover the deduction | progress.test.ts |
| Level set up, down (GM) | hunter.js:772 raw edit | same | `atLevel` | level and XP exact; the peak stays | progress.test.ts |
| Max HP edited, edited back (GM) | hunter.js:450 | same | sheet.ts `setMaximum` | exact; HP above a lowered maximum comes down | sheet.test.ts |
| Job set, set back | hunter.js identity form | same | record.ts `setJob` | exact; a blank job is refused, so a job cannot be cleared | record.test.ts |
| Hunter created, deleted | hunter.js:738, app.js header | hunter.js:198 | party.ts | exact but for the active hunter, which goes back to the first left | party.test.ts |
| Switch hunter and back | hunter.js:742, app.js | same | `setActive` | exact | party.test.ts |
| GM mode, player mode (alone) | app.js:224 | same | role.ts `chooseMode` | exact | role.test.ts |
| Reward bundle saved, deleted | hunter.js:304 | hunter.js:306 | rewards.ts | exact | party.test.ts |
| Roll table written, reset (GM) | gm.js:432 | gm.js:435 | rules.ts `writeTable`, `resetTable` | exact (an emptied rank list stays as `{}` for the encounter table) | rules.test.ts |
| Rule numbers saved, reset | gm.js:488 | gm.js:495 | `saveRuleNumbers`, `resetRuleNumbers` | reset drops every number, keeps the roll tables (not a per-edit undo) | rules.test.ts |
| Dice log cleared | dice.js:235 | none | session-log.ts `clearRolls` | no undo by design | |

Not mine (Helper B's views, or another helper's code): a quest accepted and abandoned, a daily ticked and unticked, a
path perk picked and unpicked (custom.js), a hunter added to and removed from a fight (combat.js and the fight), a
Workshop entry duplicated and deleted, a pack merged with Replace twice (io.js, workshop.js), the room link's join that
makes a hunter and its undo (sync.ts).

## Step 3: role branches and silent commits (Helper A's views)

| Where | What differs by role | Rule or accident | Done |
|---|---|---|---|
| hunter.js stats panel (+, −, the minus and plus disabled states) | the GM edits a stat with no point free, a player is refused | rule | moved to progress.ts `raise`, `lower` with the role as an argument; the view asks the same functions for the disabled state |
| hunter.js GM raw stat edit | GM only, confirms the stat | rule | `setStat` |
| hunter.js +1 point, title add/edit/delete, boon remove, stabilize, revive | GM-only controls with a guard beside the button | show this button to the GM | left |
| hunter.js grant a seed title marked `gmOnly` | only the GM | show this button to the GM | left |
| skills.js Add skill | the GM's new skill goes through Give to (replaces a held skill of that name), a player's is learned (two of a name possible) | a GM-only feature (Give to); the duplicate on a player's phone is noted, not changed | left; noted below |
| dice.js a roll's `who` and `hid` | the GM's roll is "GM" and calls no coin | rule of the coin (a player's check calls it) | left |
| uses.js and inventory.js report | a player in a room sends, the GM or a phone alone logs | routing, not saved state | left |
| skills.js maker `library` default | the GM saves to the library by default | show this control to the GM | left |

Writes inside `app.on('view')`, `visibilitychange`, `pagehide` and timers in these views: none write the save
(hunter.js `fades`, gm.js's 5 s room redraw, dice.js closing its sheet are drawing only). The store's own `pagehide` and
`visibilitychange` flush the pending write and change nothing.

Noted, not changed: on a player's phone, Add skill with the name of a skill already held makes a second one; the GM's
Give to replaces it. Neither loses anything; the owner can say which he wants.

## Findings

1. **Selling, removing or using up worn gear healed on the way back** (commit after f87f04e). Unequipping fitted HP and
   mana to the lowered maximum; selling, the × remove, the item maker's edit and using up the last of a worn thing did
   not. A player at full HP with a +20 max HP amulet who sold it was shown 45 of 45 but stored 65; buying it back and
   wearing it showed 65 of 65, healed for nothing, where unequip-then-sell would have kept 45. Same for a passive skill
   with a max HP bonus forgotten. Root: the fit was a call each writer had to remember. Now every bag change and every
   skill change is fitted (inventory.js `onBag`, skills.js `onSkills`). Test: character.e2e.ts "removing a worn amulet
   ... brings HP down", which fails without the fix (checked).

## For Helper B (merge these before converting)

- 774ca63: `store.apply(reason, step)`, `src/core/save-step.ts`, the lint with the `helperA` and `helperB` blocks.
- 35eb105: the allocation. It touched one line of `custom.js` (Build's Auto now applies `raiseMany`; `spend` and
  `refund` are gone) and set `custom.js` to 21 in `helperB`.
- 45957d6: `src/core/session-log.ts` (`logged(logLine(...), R)`), for the log lines in quests.js, gates.js, coin.js.
- f87f04e: `sync.once(eid, write)` writes the save a step answers; a `write` that answers nothing still mutates in
  place, so quests.js works either way. `role.ts` `chooseMode` for onboard.js's GM choice. `writeInto` keeps
  entities (records with an `id`) and lists live and replaces records without an id, as an assignment did.

## Machines

- Added: a shadow (`hunter/shadows.ts`, `stepShadow`, chart "A shadow").
- Not added: an item (held, worn, used up). An item's next state depends on its count (the last one used goes, one of
  several stays), and equipping one of a stack makes a new item under a new id, so a table per item would have to
  carry the count and the split. Each move is guarded in its function (`equip` refuses what has no slot, `unequip` a
  word that is not a slot, `takeItems` what is not held) and each pair has its round trip. Said here rather than drawn
  as a chart that hides the count.

## Close

- `bun run test` (typecheck, then bun test): "2487 pass, 0 fail".
- Browser, one run, `--workers=1`: character, customization, rewards, reward-room, gates-quests-dailies, save, makers,
  table-turn, fight-vitals, combat-turns, used, custom-skills, room-onboarding: "139 passed (18.2m)". Earlier runs also
  passed coin and the same files. One failure on the way (fight-vitals, Revive in a fight): `writeInto` wrote into the
  hunter's `life` record, so `lifeInFight`'s copy of the old life changed with it and the row was never stood up. Fixed
  before any commit by replacing records without an id (save-step.ts, with a test); not a player-facing finding.
- `bun run deps -- --write` and `bun run charts` run; their tests pass.
- Counted: 107 writes by the lint's count in Helper A's views (55 + 23 + 9 + 6 + 6 + 5 + 2 + 1; 58 of them
  `store.update` callbacks), plus 3 in app.js and the custom.js Auto line, all converted; the `helperA` block is empty.
- Findings that reached a player: 1 (worn gear healing on the way back, 8031f3f). The allocation itself (the owner's
  report) was fixed before this unit (ab79803); step 1 made it a model that cannot hold that state.
- Checked and clean: every pair in the step 2 table; role branches and timers in the step 3 table.
- Not checked: Helper B's views (quests, dailies, perks, fights, Workshop, packs); the edge's own writes in sync.ts
  and forget-queue.ts (not views, and the join's new-hunter undo is the link's); the fight's add and remove of a
  hunter (another helper's code). Not changed, for the owner: a player's Add skill can make two skills of one name.
- The box: no pause hit a run that I saw; no test was rerun to pass.
- Principle skills that changed a choice: model-the-domain and type-system discipline (pending points instead of a
  second stat list; a refusal as a typed value), boundary discipline (pure steps, the store a thin shell), fix root
  causes (the fit is part of every bag change, not a call each writer remembers), prove it works (the amulet test was
  run against the code without the fix and failed).
