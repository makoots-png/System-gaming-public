# V6 The Table feed and the gates' news

Goal: what a gate's Clear rolls, what the room's world doc holds, a gate's words for the GM and a player, and what a player's phone has told of the fight are each one rule in core; nothing is marked seen or told before it was shown.

## Inventory (code at 63a906a)

| Row | Verdict | Where now |
|---|---|---|
| 51 | to check | table.js `paintFeed` writes the feed's seen marks while drawing |
| N7 | to check | gates.js marks a gate told when its window is queued; gates.js `queue` |
| G1 | to check | gates.js builds the room's world doc with its own cuts (40 gates, names at 60) |
| G2 | to check | gates.js and gm.js write the spawn types (normal, red, double) and a gate's countdown words twice |
| G3 | still true | gates.js:121 and gm.js:505 tell a loot entry apart by its fields (`e.gold`, else `e.item`) |
| I2 | still true | inventory.js `rollLoot`: the loot rule in the view, untestable |
| T1 | to check | table.js keeps the armed reaction in device memory beside the GM's fight |
| T2 | to check | table.js's told news is an untyped object of composed keys |

## Rows

### I2 and G3 (done, one change)
Cause: the loot roll (gold in the table's span, one pick by rarity weight, two for a boss, an item of that rarity) was inventory.js's rule, where no test could seed it, and its answer told gold from an item by which field was set, read that way in gates.js and gm.js. Change: `rollLoot(R, rank, boss, pool, rand)` in core/gates/spawn.ts beside `rollGate`, answering `LootDrop` (`{ kind: 'gold' } | { kind: 'item' }`); inventory.js passes the built-in items and `cryptoRandom`; gates.js and gm.js read `kind` (gm.js is lane B's file: two lines). Test: spawn.test.ts "a loot roll" with a seeded draw (the lowest and highest gold, each rarity, a rarity the pool lacks).

### G1 (done)
Cause: the room's world doc was built in gates.js with its own cut (40 gates, names at 60), the parser's bounds written again, as the codex doc once was. Change: `worldDoc(save, day)` in core/gates/world.ts within `WORLD_GATES` and `WORLD_NAME_MAX`, now named in protocol.ts and read by `DOCS.world`; a cleared gate carries its `clearedDay` (`WorldGate` is a union like `Gate`), so a player reads the same countdown as the GM. Tests: world.test.ts "the room's world doc" (bounds, order, the reader takes it whole), protocol.test.ts "a cleared gate in the world carries the day it was cleared".

### G2 (done)
Cause: the types a GM may spawn (`normal, red, double`) were written twice (gates.js `TYPES`, gm.js), apart from `GATE_TYPES`; the edit form offered only those three, so saving a `break` gate made it `normal`; and the countdown's words and its soon (two days) and over marks were written twice and differed (the GM's card marked a cleared gate past its day as over and said "Breaks today" for nothing). Change: `SPAWN_TYPES` and `countdown(g, day)` (with `SOON_DAYS`) in gate.ts; both cards read `countdown` (the GM's adds a red gate's inside time), the spawn form and gm.js's offer `SPAWN_TYPES`, the edit form offers `GATE_TYPES`. Tests: gate.test.ts "a gate's countdown, one rule for the GM and a player" (a cleared gate's tone is none; the GM's copy said over) and the spawn types.

A lint failed after 857234d ("only src/core/gates/gate.ts changes a gate's status, cleared day or XP paid"): world.ts and protocol.ts wrote `clearedDay:` in the shown gate. Fixed in the next commit by making the shown gate in gate.ts (`ShownGate`, `shownGate`, `shownOf`), which the world doc and its reader call; the lint holds with no permit.

### N7 (done)
Cause: a gate was marked told in device memory when its window was queued, not when the player had seen it, and the windows waited on gates.js's own promise chain beside ui.js's one window stack: a reload while "A GATE HAS APPEARED" waited behind another window never showed it. The fourth and later new gates were marked told and never shown. Change: `gateNews(told, gates)`, `toldGate` and `parseGateTold` in core/gates/world.ts (a first sight takes every gate as told; at most 3 of each kind at once, the rest wait); gates.js asks `ui.system` for each (which shows one at a time), marks it told when the player answers, and keeps the windows asked and not answered in `asking` so a second doc does not ask again; `queue` is deleted (its lint entry too, `asking` named instead). Tests: world.test.ts "a player's gate news" (a gate stays news until answered; the rest wait instead of being marked told unseen).

### T1 (done)
Cause: a player's armed reaction was kept twice: the GM's fight holds `armed.ability`, and the player's phone kept its own copy in device memory (`armed:<fight>`), written before the post was taken, while the doc said only "armed" or "spent": the HUD could say "B armed" while the GM's fight held A (B refused or not taken), and the `armed:` keys were never pruned. Change: the fight doc names each armed or spent row's reaction (`reacts`, fight-doc.ts `armedOf`, read by protocol.ts `docReacts`, on the wire as is); table.js reads its own row's from there and keeps nothing; the doc's size comment says what the field costs (the worst case 45,768 and 53,627 measured, 1,821 to spare). A teammate's card still says only "Ready to react". Test: fight-doc.test.ts "the doc names each armed or spent row's reaction"; the worst-case doc in protocol.test.ts carries a full `reacts`.

### 51 (done)
Cause: the Table feed's rows were marked seen inside `paintFeed`, a draw, writing device memory: what is seen depended on when a draw happened, not on the GM seeing it, and the draw lint did not see a device memory's `.write(`. Change: `markSeen` marks them when they come in front of the GM: the feed opened, the Combat view shown, the page shown, a row arriving while it shows; `paintFeed` only draws; `saveFeed` is inlined so every write is a `.write(` the lint reads. Lint: "a view draws without changing anything" also refuses `.write(` in a draw (its new first case is the old paint).

### T2 (done)
Cause: what a player's phone had told of the GM's fight (`seenActive`, `endedToast`, `cue`, `burst`, `refused`, and `armed:<fight>` per fight) was one untyped object in device memory with composed string keys, written field by field from table.js; `seenActive` and `endedToast` made a small machine (seen running, then told ended), and the `armed:` keys were never pruned. Change: `TableTold` and `toldAfter(doc, told, mine)` in core/combat/table-news.ts (a new module) answer the news of one doc (`turn`, `refused`, `burst`, `ended`) and the record after it; each field names its fight, so a new fight needs no pruning; `parseTold` reads the stored record. table.js reads the record, writes it when it changed and tells the news; `mem` and `remember` are gone (the armed copy went with T1). Tests: tests/table-news.test.ts (once per turn, a reload reads it back, the end only for a fight seen running).

## Sweep and left

Sweep: device memory written in a draw: none left in the views (the draw lint now sees `.write(`). News marked before it is shown: the gate news and the fight news are marked when answered or by the doc read, not by a window queued. Copies of a gate rule: the GM view's spawn form reads `SPAWN_TYPES`.
Left: nothing of the unit's rows. The gate news windows still each say "Understood"; the wording pass owns their words.
