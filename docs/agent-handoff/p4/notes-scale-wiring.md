# Notes: status scaling reaches every source and every screen (phase 4, unit B)

Base: 5e5f984.

## Step 0: the simulation's bounds

- `tests/status-sim.test.ts` bounds C and S by how long the attackers need for the target in the same run: 4 rounds or more, each status party within 0.8 to 1.25; under 3, no status party faster; 3 to 4, no bound. E is played and printed with no bound (one comment, pointing at `design.md`). No `test.failing` left; its declaration in `types/bun.d.ts` went with it. Curves unchanged.
- Today's run sorts C boss (6.2), S boss (25.6) and S normal (8.8) as long and C normal (2.3) as short: 8 tests, all pass. `bun run test`: 1359 pass.

## Step 1: the room carries the source

- `StatusGrant` holds `source`, required and read by `sanitizeSource`: every real sender has one (the fight's reducer always gives a row's status a source; the GM board builds one). A grant without a readable source is dropped. Tests: `VALID`, "a status without a readable source is dropped", "a source's tier is 0 to 5, its name at most 60 characters, and an empty id is none".
- `statusEntry(R, x)` (status.ts): the def as written, every tier kept. `sendRemote` and `remoteCombatant` now carry it instead of `defOf` (a copy resolved at one tier). Why it matters: `applyStatus` keeps the loser's def when the winner has none, so a frozen low-tier copy on the GM's row would have shown under a stronger source's chip. With the def as written, the instance's source decides the numbers on both phones.
- `gmSource(rank)` (encounter.ts): kind `gm` at the target's rank. The GM board's status to a remote hunter sends it now (the protocol needs a source), with the target sheet's rank; its fallback dialog sends `statusEntry` instead of an E-resolved copy. Step 4 does the rest of "by hand".
- Room model: its `STATUS` payload has a source (the server would refuse it otherwise). Its phones do nothing with a status, so nothing else changes there.
- `bun run test`: 1364 pass. `table-session.e2e.ts`: 6 passed.

## Step 2: a phone applies a received status through `applyStatus`

- `room-events.ts` hands the grant (key, rounds, def, source) to `addCondition`, which already merges through the core's `applyStatus`; the remove-then-add is gone. The "! Status" window describes the instance the hunter now holds (after the merge), so it shows that instance's tier.
- `addCondition(hid, status)` takes a `Status` now (api.ts, hunter.js, effects.js, the sheet picker). Source is optional in the type until steps 3 and 4 give every caller one.
- Tests (`tests/applied.test.ts`, the appliers' file in AGENTS.md's table): a weaker Burning does not replace a C-rank one, a stronger one does, a shorter one does not shorten it, the window shows the merged numbers, the same event twice applies once. The test phone's `addCondition` merges through `applyStatus` as hunter.js does; the five failed against the old applier.
- `bun run test`: 1369 pass.

## Step 3: an item is a source

- `itemSource(item)` (`src/core/effects.ts`): kind `item`, the item's id and name, tier = its rarity's index in `RARITIES`. Tests in `tests/items.test.ts`: the six rarities give E to S, and the source names the item.
- `inventory.use` calls `applyOps(hid, ops, { label: it.name, source: itemSource(it) })`; `applyOps` passes the source to `addCondition` (its `label` is the old `source` string, which only named the rolls). `api.ts` types the options.
- Found on the way: the item forge stored a status's def resolved at tier E (`sanitizeDef(statusDef(key))`), so an item's Burning would have ticked 1d6 whatever its rarity. `defFor` in `loot.js` now stores `statusEntry` (the def as written). An item forged before this keeps its E copy (old saves need not keep working).
- `bun run test`: 1371 pass.

## Step 4: by hand

- `defaultSource(e, target, ctx)` in `encounter.ts`: in a running fight, whoever's turn it is (unchanged); otherwise the GM at the target's own tier (`sourceOf(target).tier`: a monster's or shadow's rank, a local hunter's sheet rank, a remote hunter's synced tier). `gmSource(rank)` is the same for a view that has a rank.
- The sheet's own picker (`hunter.js`) sends `gmSource(h.rank)`; the GM board already sent `gmSource(sheet rank)` since step 1. `addCondition`'s status now requires a source in `api.ts`, so every caller has one (room grant, item, picker).
- `tests/encounter.test.ts`: the existing "before the fight starts" test keeps the E-rank goblin (tier 0) and adds Mira (remote, tier 2) and Brakk (local, tier 1); a `gmSource` test for B, S and E. The other source tests are unchanged.
- Found on the way: the Status Forge's "Apply existing" chip and a typed known name stored `sanitizeDef(statusDef(key))`, a copy resolved at tier E, so the source's tier never showed on that instance. They now return `statusEntry` (as written). The forge's edit dialog read its def through `statusDef` too, which would have flattened a custom status's per-rank numbers on save; it reads `statusEntry` and keeps a per-rank op in "Also keeps".
- `bun run test`: 1372 pass. `customization.e2e.ts` and `character.e2e.ts`: 20 passed.

## Step 5: percent ticks

- The reducer works out what a tick rolls: `rollTick` carries `roll`, `rollFor(op, target's max HP)` (a monster's, a shadow's or a remote hunter's `hpMax`, a local hunter's from the sheet view). `combat.js` rolls `t.roll` through the new `effects.roll(q)`; `rollOps` is gone (its only caller was `rollTick`). The status simulation rolls `fx.roll` as the edge does, and its numbers are unchanged.
- Tests (`tests/encounter.test.ts`): 3% takes 3 from a 100 HP monster, 1 from a local hunter with 30 max HP, 2 from a remote hunter with 50; Burning from a C-rank source asks for 3d8. The existing rollTick test gained `roll: '1d6'`.
- Items: `applyOps` rolls a numeric op through `rollFor` with the hunter's max HP, so an item's `3%` heal heals 3% of the user's max HP. Not covered by a test of its own (`rollFor` is tested in `status.test.ts`; the item path is a view). An item's percent damage has no target on the user's phone: it shows "Deal 3% of the target's max HP" and sends no roll to the feed (TODO(copy)).
- Left out: an item op written with `tiers` (only a rules JSON could hold one; neither forge writes them) is not resolved at the item's rarity and still rolls 0. A shared `atTier` export would make it a few lines.
- `bun run test`: 1376 pass.

## Step 6: every screen (audit section 4, row by row)

| Place | What I found | What I did |
|---|---|---|
| Combat card, condition chips | label, rounds, `desc` tooltip; no numbers | nothing |
| Combat card, stat line | `modsOf` → `effects.mods` → `mods` → `statusDef` of each instance | nothing (scaled already) |
| Combat card, monster Attack button | the same mods | nothing |
| Combat card, ability Apply chip | label and rounds; the tier is the combatant's | the numbers at that combatant's rank follow the chip, "(4d10 damage at turn start)", from `describe` of `{ key, rounds, source: sourceOf(c) }` |
| Combat fallback picker | labels | nothing |
| Combat log | label, rounds, the rolled number | left as it is (brief) |
| Room table row | label, rounds, color | nothing |
| Status Forge, Apply existing chips | label, `desc` tooltip | tooltip adds the definition's lines (six per rank) |
| Status Forge, extra effects line | `describe` of a definition | nothing (six per rank) |
| GM Status library panel | `describe` of a definition | nothing (six per rank) |
| Hunter sheet chips and open chip | `describe(statusDef(instance))`: a flat def resolved at the instance's tier | nothing (prints the instance's numbers) |
| Hunter sheet Add condition picker | labels | nothing |
| Player table view, own chips | as the sheet | nothing |
| Remote phone "! Status" window | described a definition | step 2: describes the instance the hunter holds |
| GM board, remote hunter chips | label | nothing |
| GM board, fallback status dialog | labels | nothing (step 1 changed what it sends) |
| Item card (inventory) | "Applies Burning (3 rounds)" | `describeItem`: "Applies Burning (3 rounds): 3d8 damage at turn start" at the item's rarity |
| GM award item card | the same | `describeItem` |
| Item forge, apply and cure rows | labels | nothing; its library list uses `describeItem` |
| Item use toast | "Status applied: Burning (3 rounds)" | nothing (an instance's label, like the log) |
| Rules reference, conditions list (GM cheat-sheet) | label and `desc` | adds the definition's lines (six per rank) |
| Rules reference, conditions table | Mechanics column from unit A, `describe` of the definition | nothing (six per rank) |
| Bestiary card, editor, Codex window | raw ability text | nothing |

- Core: `describe(R, ops, from?)` takes the source a list of ops is applied from; an `applyStatus` line then adds that status's lines at the source's tier. `describeItem(R, item, ops?)` in `effects.ts` passes `itemSource(item)`; `effects.describeItem` in the API. Tests in `tests/items.test.ts`: a rare item's Burning shows 3d8, a common one 1d6, a mythic Poisoned "−8 to checks; 1d12".
- New strings in `copy-tasks.md`.
- `bun run test`: 1378 pass.

## Step 7: browser tests

- `combat-turns.e2e.ts`: "a C-rank monster's Burning takes 3d8 from a hunter at the start of the hunter's turn, and an E-rank monster's takes 1d6" (Math.random 0.45: d8 4, d6 3, so 12 and 3; the chips read "(3d8 …)" and "(1d6 …)").
- `table-session.e2e.ts`: "a status the GM puts on a remote hunter in a fight shows the same scaled numbers on the player's phone as on the GM's card" (a B-rank monster's Burning: 4d10 on the GM's chip, in the player's window and on the player's open chip). This one would also have passed before this unit: the old frozen copy was resolved at the GM's instance tier. It pins the behaviour; the source travelling is pinned by `tests/applied.test.ts` and `tests/protocol.test.ts`.
- `character.e2e.ts`: "An item of a higher rarity applies a stronger status than a common one" (card text 1d6 vs 4d10, then one Burning chip that turns from 1d6 to 4d10); "A GM override of a built-in's ops with a flat number is flat at every rank, and a forged custom status is unchanged" (Burning overridden to 1d4: 1d4 at C and S on the chips and a 2-point tick from the S-rank monster; a forged Ember Mark 1d6 at both); "The rules reference shows a scaled status's six values, E to S".
- I put the override and rules reference tests in `character.e2e.ts`, beside the existing Poisoned override test, and none in `room-sync.e2e.ts` or `customization.e2e.ts` (no case there fit better).
- Three files, one run each: 34 passed. `bun run test`: 1378 pass.

## Step 8: checks

- `bun run deps -- --write` and `bun run charts` left both files as committed (the map was rewritten at each step).
- `AGENTS.md`, the status recipe: the sources (`sourceOf`, `gmSource`, `itemSource`), the def that travels as written (`statusEntry`), and the tick's `roll`. The fight recipe ("roll in the view and send the numbers") is still true.

## For later

- **A tier picker for the GM** is a few lines: the forge dialog would return `source: gmSource(pickedRank)`; `combat.js`'s `addStatus` already passes a source to the reducer when given one, and `gm.js` already sends one. Customization phase.
- An item op written with `tiers` is not resolved at the item's rarity (step 5).
- A hunter's tier is still `h.rank`, which moves only on re-evaluation (audit path 7); a quick-line monster with no rank is E (audit path 6). Not in this brief.
- Instances stored before this unit (forge and item-forge copies resolved at E) keep their E numbers.

## Principles that changed a choice

- Model the domain: a status that travels carries its def as written and its source, so one fact (the tier) decides the numbers on every phone; no copy resolved at a tier. `addCondition` takes a `Status` with a required source instead of more positional arguments.
- Fix root causes: the frozen copies were the cause of "the source's tier never shows" in four places (sendRemote, remoteCombatant, the forge, the item forge); I fixed the copy, not the readers.
- Boundary discipline: the room grant's source is read once by `sanitizeSource` in the protocol and trusted after; the tick's max HP is worked out in the reducer, so the view does not compute it.
- Idempotent operations: the applier still goes through the applied-id ring, and `applyStatus` makes a repeated grant converge.
- Full `E2E_CHROMIUM=/opt/pw-browsers/chromium bun run ci`, once: bun test 1378 pass; Playwright 106 passed (8.2m); "CI passed".
