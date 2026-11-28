# Guide: machines and their charts

## Machines and their charts

`bun run charts` walks the real reducers with the event lists in `tests/models/` or each chart's own (the fight has no end of states, so its chart replays the random play of `tests/models/fight-play.ts`) and writes a local, gitignored `docs/state-machines.md` on demand. `tests/statecharts.test.ts` walks every machine directly from the source and fails when rendering breaks, a union state has no box, or a box cannot be reached. Read a machine's chart before you change it. A new machine gets a view in `scripts/charts/`, an entry in `MACHINES` in `scripts/statecharts.ts`, and a line here.

The fight:

- the fight and a channel (`fight.ts`, `fight-channel.ts`)
- a mythic's standing in its script (`combat/mythic.ts` `mythicStep`, `MYTHIC_TABLE`)
- a stacking status's count (`stacks.ts`), and a status's own life, active, owed or gone (`standing.ts` `statusStep`, chart in `scripts/charts/stacks.ts`)
- a trigger's limit (`triggers.ts`), a delayed effect (`delayed.ts`), a zone of the kits (`zones.ts`), a timed summon (`summons.ts`), a limited use (`uses.ts`)
- wave 2's reaction, edge, push, stealth, ward and turn extras (`fight-react.ts`, `standing.ts`, `space.ts`, `timeline.ts`; one file of views, `scripts/charts/wave2.ts`)
- a foe's life in a fight (`combat/row-life.ts`), a corpse's extraction (`combat/extraction.ts`), a run of the odds engine (`combat/odds.ts`)
- a player's turn held on this phone from the tap to the GM's answer (`combat/hold.ts` `turnHoldStep`, kept by `uses.js`)
- the battle map's life on the page (`combat/map-mount.ts`), the fight screen's map box (`mapSlot`) and who holds the Build drawer (`buildDrawer`, both in `map-mount.ts`, written by `combat.js`)
- a gesture on the map (`combat/gesture.ts`) and what it has chosen (`choose`, `map-view.ts`)

The room:

- the room link (`sync/link.ts`), a Create or Join tap from the tap to its answer (`sync/attempt.ts`), a message in the outbox (`sync/outbox.ts`), a room doc the GM publishes (`sync/publish.ts`), and the GM's serialized `_intro` doc writer (`sync/intro-write.ts`)
- a player's bind, the hunter it sends and its join of the room (`sync/bind.ts` `boundTo`, `playAs`), and the REMOVED FROM ROOM notice (`removedStep`, bind.ts)
- the Room view's code check and a GM's seat action (`sync/lobby.ts` `checkStep`, `seatStep`, through `lobbyStep`)
- the room server's database (`room-server.ts`)
- an offer in the room with the giver's, taker's and GM's records of it (`trade/offer.ts`)
- a word to the GM on the player's phone and the GM's record of it (`sync/word.ts` `wordStep`, `MINE`, `GM`)
- a reward the app would pay by itself, waiting for the GM's edit and approval, and where each seat sends it (`hunter/pending.ts` `pendingStep`, `ROUTE`)

Hunters:

- a hunter's life, up or dead (`hunter/vitals.ts`) and its collapse, its rests in a gate (`hunter/rests.ts`), its revive ladder (`hunter/revive-standing.ts` `standingStep`), its revive debt (`hunter/revive-standing.ts` `debtStep`), the penalty (`hunter/penalty.ts`), the Job Change chain (`hunter/job-chain.ts`), a shadow (`hunter/shadows.ts`)
- a hunter's points and their allocation (`hunter/progress.ts` `progressStep`, `PROGRESS_TABLE`) and its rank against its level (`hunter/record.ts` `rankStep`, `RANK_TABLE`)
- one item's wear, in the bag, worn or gone (gear: `hunter/inventory.ts` `TABLE`, `wearMove`)
- a quest (`hunter/quests.ts`) and the Quests view's quest form (`hunter/quest-form.ts`)
- a coin call and the GM's window for the calls (`coin.ts`)
- the Dice view's quick check DC (`dc-pick.ts` `dcPickStep`)
- a maker's Icon row (`icon-pick.ts` `iconPickStep`, kept by `maker.js` `iconField`)
- first-run setup (`onboarding.ts`)

Gates, feats and stories:

- a gate (`gates/gate.ts`), a gate's clear preset (`gates/preset.ts` `presetStep`), a gate's difficulty (`gates/difficulty.ts` `difficultyStep`), a hunter's personal gates (`gates/solo.ts` `soloTick`)
- a solo run on this phone from the tap to its window (`gates/solo-run.ts`), an ask waiting for the GM's phone, a solo run's or a stash ask's (`sync/asked.ts`), and what the GM's phone does with a run (`gates/solo.ts` `PLAN_TABLE`)
- a feat (`hunter/feats.ts`) and a hunter's inbox of facts (`chronicle.ts`, `noticed.ts`)
- the campaign's told memory, a feat, a personal gate or a room's gate from its window to told (`told.ts` `toldStep`, through `store.tell`)
- a story on the table (`story/run.ts`)

The app:

- the store's life (`store-life.ts`) and the app update (`upgrade.ts`)
- the windows on screen, waiting and going (`windows.ts`), a list's open "more info" detail (`detail-open.ts`)
- a view's part or a panel on the page (`panel.ts` `panelDrawn`, kept by `app.js`)
- a maker's form from open to close (`draft.ts` `draftStep`, held by `maker.js`)
