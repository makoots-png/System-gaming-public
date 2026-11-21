# Plan: every implicit state machine made explicit (38 SMX machines in 24 units)

Short paths: `c/` = src/core/, `v/` = src/views/, `e/` = src/edge/, `t/` = tests/, `ch/` = scripts/charts/, `m/` = tests/models/.

## Files no helper owns

These files are left out of every helper's list:
- `scripts/statecharts.ts` (the `MACHINES` list)
- `docs/state-machines.md` (generated)
- `docs/guide/machines.md` and the other `docs/guide/<area>.md` files
- `tests/lint.test.ts` (the one-writer rules)

A helper may run `bun run charts` locally to check its work, but does not commit those files.

When the lead merges a unit that changes an already-charted machine, it runs `bun run charts` after the merge. That file is generated, so regenerating it settles any conflict.

U24 runs last. It:
- adds the new machines to `MACHINES`;
- writes their guide and machines.md lines;
- adds one-writer lint rules for every new state type.

## Units

| Unit | Machines | Core module | Files it may change | Wave | Depends on |
|---|---|---|---|---|---|
| U1 life | rules-1, rules-6 | c/hunter/vitals.ts | c/hunter/vitals.ts, c/hunter/grant.ts **[ECON]**, c/hunter/sheet.ts, c/combat/row-life.ts, v/hunter.js, t/vitals.test.ts, t/sheet.test.ts, t/rewards.test.ts, ch/life.ts, m/life-events.ts, t/e2e/fight-vitals.e2e.ts | 1 | — |
| U2 reactions+channel | rules-3, rules-4 | c/combat/fight-react.ts, c/combat/fight-channel.ts | c/combat/fight.ts, fight-react.ts, fight-channel.ts, fight-turn.ts, fight-doc.ts, t/fight.test.ts, t/fight-doc.test.ts, ch/wave2.ts, ch/channel.ts, m/wave2-events.ts, t/e2e/combat-turns.e2e.ts | 1 | — |
| U3 statuses | rules-2 | c/combat/fight-turn.ts (a status's own life) | c/combat/fight-turn.ts, effect-ops.ts, standing.ts, land.ts, resolve.ts, t/effect-ops.test.ts, t/resolve.test.ts, ch/stacks.ts, ch/delayed.ts, m/stack-events.ts | 2 | U2 (fight-turn.ts) |
| U4 body kinds | rules-8 | c/combat/effect-ops.ts (`Body`) | all of src/core/combat/, t/fight-*.test.ts, t/rows.test.ts | 3 | U2, U3 |
| U5 loot+held | gates-1, gates-5 | c/gates/pay.ts (loot); new c/held.ts | c/gates/pay.ts, c/save.ts, c/award.ts, c/held.ts, v/gm.js, v/combat.js, v/ui.js, v/stories.js, v/give-shelf.js, t/pay.test.ts, t/save.test.ts, t/award.test.ts, t/held.test.ts, t/e2e/rules-loot.e2e.ts, t/e2e/rewards.e2e.ts, t/e2e/stories.e2e.ts | 1 | — |
| U6 solo | gates-2, gates-10 | c/gates/solo.ts, c/gates/solo-wait.ts | c/gates/solo.ts, solo-wait.ts, personal.ts, v/gates.js, e/room-events.ts, t/solo.test.ts, t/solo-wait.test.ts, ch/solo.ts, ch/solo-run.ts, m/solo-events.ts, t/e2e/solo.e2e.ts | 1 | — |
| U7 feats | rules-9 (+gates-6) | c/hunter/feats.ts, c/hunter/noticed.ts | c/hunter/noticed.ts, feats.ts, counts.ts, chronicle.ts, chronicle-view.ts, v/feats.js, t/feats.test.ts, t/chronicle.test.ts, t/chronicle-view.test.ts, ch/feat.ts, m/feat-events.ts, t/e2e/feats.e2e.ts, t/e2e/feats-room.e2e.ts | 1 | — |
| U8 quests | gates-3, gates-4, views-4 (gates-9, quest-form half) | c/hunter/quests.ts; new c/hunter/quest-form.ts | c/hunter/quests.ts, quest-rights.ts, penalty.ts, counts.ts, noticed.ts, grant.ts **[ECON]**, quest-form.ts, v/quests.js, t/quests.test.ts, t/quest-rights.test.ts, t/penalty.test.ts, ch/quest.ts, m/quest-events.ts, t/e2e/gates-quests-dailies.e2e.ts | 2 | U1 (grant.ts), U7 (noticed.ts, counts.ts) |
| U9 forms | views-2, views-1 (gates-9, story half) | new c/draft.ts | c/draft.ts, v/maker.js, v/map-maker.js, v/story-maker.js, v/quest-fields.js, v/reward-editor.js, t/draft.test.ts, t/e2e/makers.e2e.ts, t/e2e/maps.e2e.ts, new t/e2e/story-maker.e2e.ts | 1 | — |
| U10 gear | rules-5 | c/hunter/inventory.ts | c/hunter/inventory.ts, hunter.ts, loadouts.ts, v/inventory.js, t/inventory.test.ts, new ch/gear.ts, new m/gear-events.ts | 1 | — (see the economy note under U10) |
| U11 progress | rules-7 | c/hunter/progress.ts, c/hunter/record.ts | c/hunter/progress.ts, record.ts, build.ts **[ECON-8]**, sheet.ts, t/progress.test.ts, t/record.test.ts, t/build.test.ts | 2 | U1 (sheet.ts), economy unit 8 (build.ts) |
| U12 shadows | rules-10 | c/hunter/shadows.ts | c/hunter/shadows.ts, v/shadows.js, t/shadows.test.ts, ch/shadow.ts, m/shadow-events.ts | 1 | — |
| U13 server | sync-5, sync-7 | new c/sync/owner.ts; c/room-server.ts | server.ts, c/room-server.ts, c/sync/owner.ts, t/server-rooms.test.ts, t/server-handshake.test.ts, t/server-start.test.ts, t/room-server.test.ts, ch/db.ts, m/db-events.ts | 1 | — |
| U14 flights | sync-3, sync-4 | c/sync/publish.ts, c/sync/outbox.ts | c/sync/publish.ts, c/sync/outbox.ts, e/sync.ts, t/publish.test.ts, t/outbox.test.ts, ch/publish.ts, ch/outbox.ts, m/publish-events.ts, m/outbox-events.ts, t/e2e/room-sync.e2e.ts | 1 | — |
| U15 store+link | sync-1, sync-9, sync-12 | c/store-life.ts, c/sync/link.ts | c/store-life.ts, c/role.ts, c/sync/link.ts, c/sync/attempt.ts, e/store.ts, e/sync.ts, t/store-life.test.ts, t/role.test.ts, t/link.test.ts, t/link-findings.test.ts, t/attempt.test.ts, ch/store.ts, ch/link.ts, m/store-events.ts, t/e2e/refused-writes.e2e.ts, t/e2e/save.e2e.ts | 2 | U14 (e/sync.ts) |
| U16 binding | sync-2, sync-8, sync-5.3 | c/sync/bind.ts | c/save.ts, c/sync/bind.ts, c/party.ts, e/sync.ts, t/bind.test.ts, t/party.test.ts, t/e2e/room-sync-fixes.e2e.ts | 3 | U15 (e/sync.ts), U5 (c/save.ts) |
| U17 update | sync-6 | c/upgrade.ts | c/upgrade.ts, e/upgrade.ts, v/room-pill.ts, t/upgrade.test.ts, ch/upgrade.ts, m/upgrade-events.ts, t/e2e/upgrade.e2e.ts | 1 | — (if e/sync.ts `upgrade()` must change, it moves to wave 2 with U15) |
| U18 lobby | sync-11 (+views-10) | new c/sync/lobby.ts | c/sync/lobby.ts, v/room.js, t/lobby.test.ts, t/e2e/room-view.e2e.ts | 1 | — |
| U19 turn hold | views-5 | new c/combat/hold.ts | c/combat/hold.ts, v/table.js, v/uses.js, t/hold.test.ts, t/e2e/table-turn.e2e.ts | 1 | — |
| U20 combat screen | views-8 | c/combat/map-mount.ts | c/combat/map-mount.ts, v/combat.js, v/map.js, t/map-mount.test.ts, ch/map-mount.ts, m/map-mount-events.ts, t/e2e/battle-map.e2e.ts | 2 | U5 (v/combat.js) |
| U21 windows+panels | views-6, sync-10 (+views-9) | c/windows.ts; new c/panel.ts | c/windows.ts, c/panel.ts, src/app.js, v/ui.js, v/dice.js, v/combat.js, v/table.js, t/windows.test.ts, t/views.test.ts, ch/windows.ts, m/window-events.ts, t/e2e/windows.e2e.ts, t/e2e/failed-view.e2e.ts | 3 | U5 (ui.js, combat.js), U19 (table.js), U20 (combat.js), U23 (dice.js) |
| U22 coin | views-7 | c/coin.ts | c/coin.ts, v/coin.js, t/coin.test.ts, ch/coin.ts, m/coin-events.ts, t/e2e/coin.e2e.ts | 1 | — |
| U23 dice DC | views-13 | new c/dc-pick.ts | c/dc-pick.ts, v/dice.js, t/dc-pick.test.ts, t/e2e/dice.e2e.ts | 1 | — |
| U25 onboarding | views-12 | c/onboarding.ts | c/onboarding.ts, v/onboard.js, t/onboarding.test.ts, ch/onboarding.ts, m/onboarding-events.ts, t/e2e/room-onboarding.e2e.ts | 1 | — |
| U26 world+told | gates-7, gates-8 | c/gates/world.ts; new c/told.ts | c/gates/world.ts, c/gates/gate.ts, c/told.ts, v/gates.js, v/feats.js, v/quests.js, e/store.ts, t/world.test.ts, t/gate.test.ts, t/told.test.ts, ch/gate.ts, m/gate-events.ts | 3 | U6 (gates.js), U7 (feats.js), U8 (quests.js), U15 (store.ts) |
| U24 close | — | — | scripts/statecharts.ts, docs/state-machines.md, docs/guide/*.md, t/lint.test.ts | 4 | all |

All 38 machines are placed:
- **rules-1 to rules-10:** U1, U2, U3, U4, U10, U11, U7, U12.
- **sync-1 to sync-12:** U15, U16, U14, U13, U17, U21, U18.
- **views-2, 5, 6, 7, 8, 12 and 13:** U9, U19, U21, U22, U20, U25, U23.
- **gates-1 to gates-10 (no gates-6, which is folded into rules-9):** U5, U6, U8, U9, U26.

gates-9 is split between U8 and U9. It is two separate forms (the Story Maker's accordion and the quests page's inline form) with no shared state.

**Waves:**
- **Wave 1:** U1, U2, U5, U6, U7, U9, U10, U12, U13, U14, U17, U18, U19, U22, U23, U25. No two share a file.
- **Wave 2:** U3, U8, U11, U15, U20.
- **Wave 3:** U4, U16, U21, U26.
- **Wave 4:** U24.

**Overlap with the economy work:**
- **grant.ts:** U1 (wave 1) and U8 (wave 2) change it. Neither may run beside a later economy unit that also changes grant.ts.
- **build.ts:** U11 changes it and waits for economy unit 8 to land.
- **protocol.ts:** U13 must not touch it. The whisper-sealing part of sync-5 (sync-5.2) waits on a ruling, and its row is left for when protocol.ts is free.
- **spawn.ts:** U6 only imports it (`soloTick`). If the personal-gate clock needs a change there, U6 collides with the later economy unit.
- **use.ts:** no unit changes it. The crystal-after-death ruling would land there.
- **items.ts:** no unit changes it.

## The design of each unit

**U1 life.** The four life states stay (`up`, `dying`, `stable`, `dead`). One `vitalStep(v, VitalEvent, m, R)` with a full table takes `hit`, `heal`, `refill`, `rest(short|long)`, `maxChanged`, `fatigue`, `fightTotals` and `revive(gm|item)`. Collapse becomes a state, `fresh | tired | collapsed`, not a boolean beside the fatigue number. Every path in grant.ts `grant`, `sheetEdit` and sheet.ts `setMaximum` goes through `vitalStep`, so no edit can skip the clamp. The rows that wait on a ruling keep today's behaviour and are named in the table:
- `dead × rest` and `dead × refill`: allowed today (rules-1.2).
- `put/drop × maxChanged`: not chained today (rules-1.3).
- `fightTotals → collapsed`: latches today (rules-6.2).
- fitting fatigue to a lower maximum: does not collapse today (rules-6.1).

**U2 reactions and channel.**
- A channel keeps where it was released from: `released{from: 'holding' | 'broken'}`. Whether the release costs time reads that state, no longer `cmd.by === currentId`. A broken release keeps today's cost on its user's own turn as the named row `broken × ownTurn` (rules-3.1).
- `Running` gets an explicit sub-state, `acting | owing(Owed[])`. The owed-dice ruling (rules-3.2) is the single cell `owing × endTurn`, allowed today.
- The reaction machine gains `fired` and `spent` as separate states, and every call site fires a reaction through one `react()`.
- `down × arm` (rules-4.3a) and the kill-count rows (rules-4.2) wait on the ruling. Today's behaviour is built as named rows.

**U3 statuses.** A status on a row is `active | owed(lastTick) | gone`. Every reader (standing.ts, `modsOf`) asks `counts(s)`, so no reader can forget the expiry check. Whether an `owed` status still counts (rules-2.1) is one predicate row, true today. Decay and expiry run in one order inside `settle`. The land and dispel edges (rules-2.3b) become events of the same type.

**U4 body kinds.** `Body` becomes a union of four kinds (hunter, monster, shadow, summon), each with only its own fields, so a row holding another kind's fields cannot be built. `rowOf` in fight-parse.ts parses each kind separately. The change is wide, so U4 runs last in the fight chain.

**U5 loot and held writes.**
- `Save.dropped` becomes `Loot = {at: 'none'} | {at: 'waiting', drops: Dropped[]}`, so a settle adds a drop and never overwrites one (gates-1.3, scored 6).
- The award form's tie to a drop becomes core state, `AwardDraft = blank | fromDrop(i)`. A send deals only the drop it names, and only once it succeeded (gates-1, 1.1, 1.2). This replaces `dataset.drop` and `pendingAward`.
- c/held.ts holds the held writes, `holding(until) | committed | undone`, keyed by kind and run, so a second End story on the same run is refused.
- Today a held write commits when two other toasts push it off. That stays as the named row `holding × crowded → committed`, which the "own two seconds" ruling (gates-5.1) would change.
- The shelf has no edit step today (gates-5.2). This stays as the row `pick → holding`, which the ruling would route through a draft first.

**U6 solo.**
- `SoloGate` records its route when the run starts, `{route: 'local' | {room}}`, and `soloKey` includes it. `soloRan` settles by that route and no longer reads the live seat (gates-2.1).
- The wait table gets `taken × dismiss` (gates-2.4).
- The GM unticking "Open to solo runs" mid-run (gates-2.2) and GM approval of the pay (gates-2.3) are named rows, allowed today.
- The personal clock becomes `off | on(next) | full(next)`, so the three-gate cap is a state. Whether a loss keeps the gate is the row `run lost → gate kept` today (gates-10.1 waits on its ruling).

**U7 feats.**
- An inbox fact is stamped when it happens, not when the inbox drains. Today's drain-time day stays as the named stamping row (rules-9.1 waits on the day ruling).
- A `broke` event clears the distinct values in both noticed.ts and counts.ts (rules-9.2).
- `hidden × unlocked` keeps its target, `shown` today. The "never show" ruling (gates-6.2) is that one cell.
- A feat's extra condition is checked again on any fact (gates-6.1, waits): row `full × alsoTrue`, ignored today.

**U8 quests.**
- A quest is `active | done(told: boolean) | failed`. Whether its window was told moves into the quest itself, out of the bare-id device memory, so a daily that resets in place is told again (gates-4.2).
- The rollover goes through one step. A refused write does not show PENALTY or QUEST FAILED, and an urgent quest that runs out emits the room event (gates-3.2, gates-3.3; the room-event part waits on its ruling).
- The Complete button reads `completer: 'system' | 'hand' | 'mixed'`. The hand-ticked ruling (gates-4.1) is the `mixed` row.
- c/hunter/quest-form.ts: `closed | new{role, hid} | editing{hid, qid}`. The form is captured when it opens, so a hunter or role switch closes it (views-4).

**U9 forms.** One draft machine in c/draft.ts, `clean | edited | asking`, with an event `painted` for map tiles (views-2.1). For the Story Maker, a chapter draft holds the whole quest, `onFail` included. Every chapter's `check` runs at Save, open or folded, so dropping a field or skipping a folded chapter cannot happen (gates-9.1, scored 6; gates-9.2).

**U10 gear.**
- `equipped` is read through one parse that rejects an item in two slots, a stack, or a wrong slot (fixHunter).
- `editItem` and `equip` go through `wearStep(slot, ev)`: changing a worn item's slot or making it a stack unwears it, and equipping a worn ring does nothing.
- Selling, deleting or editing a worn item in a fight is refused in core, as loadouts.ts already does for a swap (rules-5.3c).
- Economy note: check that the stack key (`DISTINGUISHES`) is not also being changed by an economy unit.

**U11 progress.**
- Rank becomes `{at: 'follows'} | {at: 'set', rank}`. Following level is the named row that the rank ruling (rules-7.2) would make the default on a level drop; today a level drop keeps the rank.
- Pending points become an explicit `allocating{pending}` state. Handing them back on a level drop (rules-7.1) is a waiting row, kept as today.
- A non-finite number is refused at `setPoints`.

**U12 shadows.** The shadow's HP joins its state: `resting{hp} | summoned{hp} | released`. Whether a shadow at 0 HP is dismissed and refused a summon (rules-10.1) is the cell `summoned × fell`, which stays summoned today, plus the guard `resting(0) × summon`, allowed today.

**U13 server.**
- c/sync/owner.ts makes each device's slot `free | bound(hash)`, moved only by `join`, `write` and `release`. A GET poll cannot bind a device.
- Removing one sheet frees the device's slot only when no other sheet of that device is left.
- `Db<S>` gains `closed`, which takes no event. That replaces server.ts's own `let retry` and `let closed` (sync-7).

**U14 flights.**
- Every request is tied to the link stretch (`gen`) it was sent in. A `left` event aborts it, so an answer to a request from an old room is ignored.
- `roomGone` now catches messages being sent, not only queued ones (sync-4.1).
- Overflow emits `dropped` (sync-4.3), which U19 listens for.
- `Publish.tooBig` clears on `left` (sync-3.2).
- Leaving a room calls `runsGone` (gates-2, the leave part).

**U15 store and link.**
- The store's read-only state is part of the link and the seat: a read-only tab holds its room cursor and never acts as GM. `seatOf` reads the link's key, not settings (sync-1).
- A load whose fight is broken becomes its own `LoadNotice` state, distinct from a failed backup (sync-9.2).
- One flush timer state, `idle | frame | fallback`, replaces the three loose handles (sync-9.1).
- Leaving a room clears the GM key (sync-12.1).

**U16 binding.**
- `sync.joinedAt` (when this phone joined the room) and a new `boundAt` (when it bound to a hunter) become separate fields, so a hunter switch does not move the join time (sync-2.2, 2.4).
- Deleting the bound hunter goes through `bind`.
- A "removed" notice becomes `{room, at: 'told' | 'rejoining'}`, tied to its room. A Rejoin from an old notice can no longer act on a new room, and there is no retry loop (sync-8).
- The device id in a release is parsed in core, not by the regex in sync.ts (sync-5.3).

**U17 update.** The update runner's state moves into core: `idle | checking | waiting(reg) | reloading(note)`. A second `send` while one is running is refused, and `registration.waiting` is read as its own state (sync-6).

**U18 lobby.**
- The code check becomes `idle | checking(code, timer) | known`; Join and a room change cancel it.
- Each GM seat action (Release, Allow back, Remove name) is `busy{room, key}` while in flight, so it cannot be sent twice or applied to another room.

**U19 turn hold.** The hold becomes `free | picking | sent{from, id} | refused`; the target picker is a state, not an await. Whether a consumable takes the turn (views-5.1) is one row, `use(consumable)`, which goes to `free` today. A dropped outbox message releases the hold.

**U20 combat screen.**
- The map's life on the page gains `mounted × hidden → destroyed`, so a hidden map is taken down (views-8.1).
- The build drawer is `screen | hand` and returns to `screen` when a fight ends or a new one starts.
- Each map's detail list has its own key.

**U21 windows and panels.**
- In windows.ts a sheet is a window kind that takes Escape, and every open sheet is listed there (Quick Roll, Fight tools, the phone card).
- c/panel.ts gives a panel `asked → live | failed`; a panel whose check failed is never mounted (sync-10).
- `go(sameView)` is an explicit event.

**U22 coin.** The GM's prompt for a coin call becomes `idle | asking(id) | deferred(ids)`, so closing the window defers the call and does not reopen it.

**U23 dice DC.** The Dice view's check difficulty (DC) choice becomes `defaulted(rank) | chosen(key)`. Whether it follows the active hunter's rank (views-13.1) is the cell `defaulted × hunterChanged`, which stays unchanged today.

**U25 onboarding.** The trigger, the invite failure and the Create in flight become sub-states of `at` in onboarding.ts. Skip can be refused, and a closed window cancels its Create.

**U26 world and told.**
- The world day is `day: number` with an explicit event `moved(+n | -n)`. The reconcile rows that wait (gates-7.1, gates-7.2) keep today's behaviour as named rows.
- `editGate` and `mergeWorld` re-run the break-day check.
- c/told.ts gives each campaign one "told" memory for feats, quests, personal gates and gates seen, cleared by a reset (gates-8.1). The 3-per-poll cap on new gate news becomes a queue (gates-8.2).

## Audit claims that are false or stale today

- The audit says `dailyTemplate.recover` defaults to true at `rules.ts:152`. The field is gone (grep finds no `recover` in rules.ts), and `finishQuest` does no refill. The world cross-check rows that say the app refills on a daily are stale.
- The audit says fight-parse.ts caps hunter level at 200. It now uses `parseLevel`, bounded at 9999.
- The audit says a same-room GM rejoin is rejected (`link.ts:399`). That is fixed.
- The audit's line numbers have moved since it was written: `settleEncounter` is now at pay.ts:127, `editItem` at inventory.ts:87, `release` at fight.ts:354. Helpers should search by function name.
- These claims were read and still hold:
  - a dead hunter's row gets its mana back on a fight refill (`refilledRow`);
  - `arm` has no check that the row is up;
  - `roomGone` takes only queued messages;
  - `seatOf` reads the saved GM key;
  - the shadow table ignores HP;
  - `featStep` turns a never-show feat to `shown`.

### Critical Files for Implementation
- /home/user/systemgaming/scripts/statecharts.ts
- /home/user/systemgaming/src/core/hunter/vitals.ts
- /home/user/systemgaming/src/core/hunter/grant.ts
- /home/user/systemgaming/src/edge/sync.ts
- /home/user/systemgaming/src/core/combat/fight.ts
