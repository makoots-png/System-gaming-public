UNIT left-sections DONE at 6e082ac: V2's held reward statuses written in the award's one write (last section)
UNIT V8 DONE at 67db788
UNIT M2 DONE at 1b7b889
UNIT V7 DONE at eb395d1
UNIT lane-A-leftovers DONE at eb395d1

# Closing the second audit (V7, V8, V9's M2, lane A's two leftovers, the Left sections)

Started 2026-11-16 01:57 UTC at bad9166 on `claude/zen-pasteur-ov4cgd`, main tree. No browser and no whole `bun run test` before 02:40 UTC (the lead's CI times frames).

Goal (the owner): "I want it perfect, I do not care about time." "Everything must be explicit. Everything." "For all things we must fix the problem and not the symptoms." The problem: the rows below are still a rule a view holds, a copy of a bound, a lint that does not hold what its name says, or a thing a player or GM can meet. The smallest change: each row's remedy as the audit judged it, done where AGENTS.md says that kind of thing lives, with a test that fails without it.

Principles read in full this session: fix-root-causes, model-the-domain, type-system-discipline, boundary-discipline, test-behavior-not-implementation, subtract-before-you-add, encode-lessons-in-structure, make-operations-idempotent. Each row below names the one that changed a choice.

## Unit 1: inventory
Read at bad9166, line numbers of bad9166. "True" means the code still holds what the row says.

| Row | Verdict | Where now |
|---|---|---|
| N11 | true | src/core/sync/sent.ts used by no file in src, only tests/sent.test.ts and tests/models/room-world.ts:25; `RemoteSheet.seen` made at sync.ts:691, read by nothing; comments api.ts:508-509, protocol.ts:686-688; lint "a view never keeps the time of its own send" (lint.test.ts:305-313) points at `freshFor` |
| N12 | true | api.ts:115 "The Table feed's Apply sends a player's damage roll this way" |
| N19 | changed shape | io.js no longer says "8 backups"; line 224 says "keeps your current save in the backups" with no number. Nothing left to fix; the class sweep (a rule value as a literal in a view) runs in unit 2 |
| N16 | true | abilities.ts:197 `itemOfAbility` reads the `item-` prefix (readers: combat.js:273, table.js:274, 323, fight-save.ts:45, map-view.ts:720-730); bestiary.js:50, 215, 220 read the `seed:` prefix. Low: to confirm by a failing test before a fix |
| R2 | true | reward-editor.js:158 `'Shadow Monarch'` literal; :112, :254 `9999` beside `ITEM_BOUNDS.qty`. The "200 bundles" literal is gone (V9 R1) |
| P1 | true | map.js:716 `pinned.length >= 4` beside map-view.ts:713 `PINS = 4` |
| C4 | true | combat.js:709 "16 zones", :959 "4 to 40 tiles" |
| C5 | true | combat.js:51-58 `REFUSED` (22 keys, `Refusal` has more: gated, noUses, hp, stacks, zone, seen, extra, offGrid, noChannel, noIntent, unknown, notMonster, nothingDue, notExtractor, ...); combat.js:124 shows the bare key when missing; table.js:22-29 the player's words, keyed by `TABLE_REFUSALS` but not typed against it |
| H7 | true | hunter.js:161 `rules().rankBonus[to] ?? 2` |
| B5 | true | bestiary.js:41, 189, 377 and combat.js:904, 986, 1028, 1037: `26` |
| ability-types.ts header | true | line 3 names `./ability.ts`, deleted |
| fight-doc.ts | true | :218-219 two doc comments on `inView`, the first stale |
| FP1 second half | true | save.ts:597-598 drops a fight `parseFight` does not read; `loadSave` (:709-725) answers it as a plain `save` with no notice and no backup |
| C3 second half | true | notes-V10.md: the Extract button is offered only for this phone's hunters; no room message gives a shadow |
| M2 | true | to read in unit 4 (maker.js `formulaField`, ability-kinds.ts `ticksOf`) |
| N15 | true | lint.test.ts:132-145 names three edge files; store.ts:110-111, 156-157, rules.ts, report.ts module lets are in no list |
| step 3 stale: role `mayRead` save.ts, store.ts | true | lint.test.ts:42; neither file matches the pattern now |
| step 3 stale: io.js `isy.gmKey` | true | lint.test.ts:151; io.js has no such line |
| step 3 stale: `notHunters` skills.js, shadows.js (level) | true | lint.test.ts:173; neither file writes `.level` |
| step 3 stale: `notHunters` shadows.js (HP) | true | lint.test.ts:203 |
| step 3 stale: `notRows` shadows.js | to read at V8 | lint.test.ts:425-450 |
| step 3 fix: coin lint owner | true | lint.test.ts:158-164 names coin.js and `.coins =`; the writer is coin.ts by spread (`coins:` at coin.ts:198, 206) |
| step 3 fix: `addSheetStatus` in the view import list | true | lint.test.ts:382 |
| step 3 stale: timer counts, closure counts | to recount at V8 | lint.test.ts:739-816 (gates.js's `queue` is gone since V6) |
| step 3 fix: combat.js pairs | true | combat.js:326 `let tableRefusal = null, refusals = 0;`, :332 `let lastBurst = null, bursts = 0;` |
| step 3 fix: the invite in sessionStorage | true | sync.ts:209, 212, catches that say "the store's banner says storage is off" |
| step 3 fix: draw lint and device `.write(` | done by V6 | lint.test.ts:647-648 holds the old `paintFeed` line as its case |
| step 3 fix: label lint and `.includes(` | done by V3 | lint.test.ts:1167-1171 |
| H8 | true | bestiary.js:467, combat.js:510, 880, 1198, dice.js:109, 208, gm.js:229, 231, 238, hunter.js:432, 746 (the dead `setActive` fallback), 758, onboard.js:103, 174, room.js:296, shadows.js:74, table.js:327, 517, 614 |
| M1 | true | map-maker.js:173 and bestiary.js:51 ignore `store.apply`'s answer |
| K1 | true | kit-parts.js:408 a regex on the error's words (now with `Rounds go`) |
| I3 | true | inventory.js:41, 268, custom.js:292, 294: `store.apply(…, s => ({ ...s, …` |
| X1 | true | room.js:61 `S`, bestiary.js:163 `f`, table.js:293 `hud`, gm.js:97 `open`; map.js `view` to read at V8 |

## Unit 2: V7, dead and wrong words, bounds read

### N11 (done)
Cause: the GM's fight card once took a player's numbers from the player's sheet, so the sheet carried `seen` (the poll cursor) and `sent.ts` judged whether a sheet held the GM's change; since the fight became the one writer of a row's numbers, nothing in src reads either, yet the room model tested the rule and two comments and a lint told the reader to use it.
Change: deleted `src/core/sync/sent.ts`, `tests/sent.test.ts`, the room model's cards (`Card`, `refreshCards`, `history`, `skipped`, `waits`, `lostChange` and the card check, the card scenario), `RemoteSheet.seen`, and the comments. I went one step past the audit's list, by subtract-before-you-add: the pushed sheet's `seen` on the wire (`PushedSheet`, `parseSheet`, `sendSheet`) and sync.ts's push after an event for the bound hunter that changed nothing (its only reason was to move `seen`) had no reader either, so they went too. A push still follows every change of the bound sheet (sync.ts's `change` handler). The lint "a view never keeps the time of its own send" keeps its rule; its advice now names the fight as the one writer.
Test: protocol.test.ts "the sheet a phone pushes comes through as it is: its hunter" (the old parser refused a sheet with no `seen`); the server and model tests run on the new wire shape (room model: 0 fail).

### N12 (done)
Cause: `CombatApi.adjust`'s comment named the Table feed's Apply, which U14 deleted; a comment has no reader to fail. Change: the sentence is gone; the callers today are gm.js's board edit and hunter.js's hand edit. No test: words only.

### The stale headers of ability-types.ts and fight-doc.ts (done)
Cause: words left from before a change: ability-types.ts said the monsters' text abilities stay in `./ability.ts` (deleted; monsters read `parseAbility`); fight-doc.ts had two doc comments on `inView` (the first from before the fog), said the doc drops log lines that "name" a hidden foe (FD1 made it by ids), and gave the bound as 16,384 characters where the bound is `DOC_MAX` (62,000). Change: each line now says what the code does. No test: words only.

### C5 (done)
Cause: the words of a refused fight command were two JS tables of strings (combat.js for the GM, table.js for a player) checked against neither `Refusal` nor `TABLE_REFUSALS`; the GM's lacked fourteen reasons, and `REFUSED[fx.reason] || fx.reason` showed the bare key ("noUses").
Change: `src/core/combat/refusal-words.ts` holds `REFUSAL_WORDS: { [R in Refusal]: string }` (the GM's) and `TABLE_REFUSAL_WORDS: { [R in TableRefusal]: string }` (a player's), so a new refusal does not typecheck until it has words; combat.js and table.js read them and keep no table. The existing words are as they were; the fourteen new GM lines are marked TODO(copy) (`gated`, `noUses`, `hp`, `stacks`, `extra` take the player's wording, in the third person where it differs). Two tables, not one, because the two audiences read different words for one reason ("It is not their turn." and "It is not your turn."). Principle: type-system-discipline (a table keyed by the union, not a string map with a fallback).
Test: fight.test.ts "the GM reads words for a use refused with no uses left, never the refusal's key": the fight refuses `noUses` and the GM's words are "No uses left." (the old table had no `noUses`: the toast read "noUses"); every refusal the table carries has a player's sentence.

### C4 and B5 (done; one commit, since both touch the same lines of combat.js)
C4 cause: the paint and resize refusals stated `16` zones and `4 to 40` tiles as literals beside `MAX_ZONES` (zones.ts) and `MAP_BOUNDS.size` (registry/maps.ts). Change: the words read the two bounds.
B5 cause: how many copies of one monster join at once (the letters A to Z rows.ts gives a pack) was a literal `26` in nine places of three views (bestiary.js's count box, its clamp and `toCombatant`; combat.js's count box, its clamp and the quick line; gates.js's roster count and its clamp), each clamping on its own, and no core bound named it. Change: `MONSTER_BOUNDS.copies` (26, why it is 26 beside it) and `copiesOf(v)`, the one clamp, in registry/monsters.ts; the views read both, and bestiary.js's `num` helper, now unused, is gone. Principle: model-the-domain (one named bound and one clamp instead of nine copies).
Test: monsters.test.ts "a typed count is 1 to 26, one row letter each from A to Z, and anything else is 1" (the expected 26 is the alphabet's length, the rule). The class lint at the end of this unit holds the old lines.
(417b674's test did not typecheck: `MONSTER_BOUNDS.copies` is the literal type 26; fixed in the next commit. From here every commit runs the typecheck first.)

### P1 (done)
Cause: the drawer greyed Pin at a literal `4` pinned (map.js), a copy of `PINS` in map-view.ts that the map lint rightly does not let map.js import. Change: `hotbar` answers `full` (`PINS` pinned) with the bar; map.js reads it. Test: map-view.test.ts "the bar is full at PINS pinned, so the drawer offers no more Pin, and one fewer leaves room" (no `full` before).

### R2 (done)
Cause: the reward maker's job list added `'Shadow Monarch'` by a literal (it is one of `rules().extractJobs`, not `rules().jobs`), so a GM's extract job was never offered; its item quantity box and clamp said `9999` beside `ITEM_BOUNDS.qty` (loot.js's box too, found by the sweep). The "200 bundles" literal the audit named is gone since V9. Change: `rewardJobs(R)` in rules.ts (the jobs, then each extract job they lack, once) read by the datalist through edge/rules.ts; the boxes and the clamp read `ITEM_BOUNDS.qty`. Test: rules.test.ts "a reward may name every job a hunter can hold..." (a GM's "Lich King" was missing before).

### H7 (done)
Cause: the re-evaluation window read `rules().rankBonus[to] ?? 2`, a default of its own, where the Derived panel reads the same table with none. The default was dead: `rulesOf` merges an override key by key, so every rank keeps a bonus whatever the GM overrides (checked: `merge` in rules.ts). Change: the `?? 2` is gone. Test: rules.test.ts "an override of one rank's bonus keeps every other rank's" (it passes before and after: it is the proof that the default was dead, not a bug the deletion fixes).

### N16 (done; confirmed first)
Cause: whether an ability is a bag item's use was read from its id's `item-` prefix (`itemOfAbility(id)`), and whether a monster is a built-in from its id's `seed:` prefix (three reads in bestiary.js). Confirmed for the item half: `parseAbility` keeps any id text, so a skill from a pack or a GM's gift whose ability id begins `item-` was taken for an item: `itemSpent` spent that item from the bag at each use (and refused the use "no item" when the bag lacked it), the hotbar filed it with the items, and combat.js hid it unless the bag held that item. fight-save.test.ts "a skill whose id happens to begin "item-" spends no item" failed before (it answered `{ item: 'i9' }`).
Change: `Ability.item?: ItemId`, set only by `itemAbility` (a consumable in a hunter's bag, whose id must read as an item id, rows.ts) and kept by the fight row's parser; `parseAbility`, the reader of skills and monsters, drops an `item` a skill or monster claims; `itemOfAbility(a)` reads the field. Its readers: `itemSpent` (the row's own ability, not the command's id), map-view's hotbar, combat.js's card, table.js's kit (the cast's ability looked up in the hunter's own list). `itemAbilityId` still makes the id unique. The bestiary half: who owns a monster is whether `save.monsters` holds its id, and a built-in is whether the registry's seeds hold it; no prefix is read (the `seed:` form stays ids.ts's one maker of a built-in's id). Principle: type-system-discipline (a field a reader trusts, set where the thing is made, instead of meaning parsed back out of an id).
Tests: fight-save.test.ts (above); abilities.test.ts "an ability read from a skill or a monster is never a bag item's use, whatever it claims; a fight row keeps the item its use spends". Two tests built an item's ability by its id alone (map-view's potion, the abilities ids); they now build it as the app does.

### N19 (changed shape, nothing to do)
io.js no longer states a number of backups ("keeps your current save in the backups"); the cap is read only by store.ts (`backupCap`).

### The sweep: a bound or a rule value as a literal in a view beside its owner (done)
Searched every view for `max="N"`, `Math.min(N`, a clamp's literal, `.length >= N`, `.slice(0, N)` and numbers in words, then read each hit (36 lines). Judged:
- A copy of a named core bound, fixed above or here: the copies (B5, nine), the item quantity (R2, three with loot.js), the zones and map size (C4), the pins (P1).
- A cut the room's reader already makes, and at a different number: quests.js's progress message cut labels at 80 where protocol.ts keeps 100, and names, titles and objectives at the reader's own numbers; uses.js's `used` message the same. Deleted: the view sends the field as it is (newEvent parses through `DEFS`, which cuts). Test: protocol.test.ts "the reader cuts a sent quest to its bounds" (60, 120, 10, 100).
- Left, with the reason: the makers' number boxes (maker.js, forge.js, skills.js's bonus) are audit 2's N18, left on purpose ("the maker's words for a bound are the parser's in effect today"); display cuts of a feed or a list (table.js feed lines, gm.js log rows, io.js slug) are how much a screen shows, not a rule; io.js's reset hour 0 to 23 and dice.js's modifier are the domain's own range, read again by the save's repair and `parseFormula`; the session log line's 120/500 in uses.js is `LOG_TITLE_MAX`/`LOG_TEXT_MAX` cut again by the log, kept since `logLine` does not cut (a later unit may move the cut into `logLine`).
Two lints hold the class: "a view reads a bound core names, never writes its number" (its first cases are the six old lines) and "a view sends a room message as it is" (its first case is the old progress line).

## Unit 3: lane A's two leftovers

### FP1's second half: a damaged fight dropped at load is told (done)
Read first: V13 made the parser keep at most the new maxima (`upTo` in `rowOf`), so a rule lowered under a running fight no longer drops it; what is left is a fight that is not one (damaged), which `repair` dropped with no word.
Cause: `parseSaveValue` answered a save whose fight the parser refused exactly as a sound one, so `loadSave` had nothing to tell and no text to back up; the player lost the fight in silence.
Data shape: `Parsed`'s `save` arm carries `fightLost: boolean` (the save held a fight and the repair dropped it); `Loaded.notice` is `LoadNotice` = `'unreadable' | 'old' | 'fight'`. Variants weighed: a list of everything a repair dropped (no other thing is dropped whole: a hunter, an item or a quest is repaired, not dropped, so a list would hold one kind); `loadSave` comparing the stored text's fight with the repaired save's (a second JSON parse of the whole save at every load). The flag on the parse's own answer is the smallest.
Change: `parseSaveValue` notes whether a fight was held before the repair; `loadSave` answers `notice: 'fight'` and the stored text as a backup ("a fight that could not be read"), as it does for an unreadable save; store.ts's `LOAD_TEXT` is keyed by `LoadNotice` (the typecheck asks for the words; new line TODO(copy)). An import's preview and another tab's save still drop a damaged fight without this notice: the import shows its preview of what it holds, and another tab's save is a save this app wrote. Principle: boundary-discipline (the parse at the boundary answers what it dropped; the edge only tells).
Tests: save.test.ts "a current save whose running fight is damaged opens without the fight, with the fight warning and the stored text to back up" (no notice and no backup before); save.e2e.ts "a save whose running fight is damaged opens without the fight, says so, and keeps the save as it was in the backups".

### C3's second half: a player's Necromancer on another phone extracts (done)
Cause: an extraction's roll, the DC and the army were this phone's hunter's (V10 made the fight's `extract` name the extracting row and offered one Extract per hunter of this phone), and nothing could put a shadow in a hunter's army on another phone: no room message carries one, and a reward has no shadow. So the GM's card never offered Extract for a player's Necromancer, though it stood in the fight.
Variants, weighed on paper (what each adds):
1. The player's phone rolls: an Extract button on the player's table, a new `extract` message (player to GM, `ownSheet`) with the roll, the GM's phone judging it and recording it, and a second message (GM to player) carrying the shadow; the fight doc must also carry, per corpse, whether it may be extracted and its attempts left. Two message types, a doc field, a table control.
2. The GM's phone rolls, a new `shadow` message gives the shadow: the GM's card offers Extract for every hunter row whose job may extract, a player's too (its sheet as the room holds it, read by `remoteSheets`); the GM's phone rolls with that hunter's own Presence bonus and rank (the DC); the fight's `extract` records the outcome; a risen shadow reaches the player as `shadow`, posted in the same write. One message type.
3. As 2, with the shadow as a field of the `award` message: no new type, but an award would then mean two things, its applier's window ("REWARD RECEIVED") and its grant run on an award that may carry nothing else, and the end of a fight already posts awards; a field that only one sender sets and that changes the message's meaning is a hidden second kind.
Picked: 2. It adds one kind of thing (the `shadow` message, by AGENTS.md's recipe), and it is the audit's own remedy ("the card offers one button per such row"). The roll is made in a view (the GM's) and its numbers are sent (the shadow); the fight's `extract` stays the one writer of the corpse's attempts. Possibly contested: a player may expect to tap Extract on their own phone (variant 1); flagged to the lead.
Data shape: `ShadowPayload = { eid, to: [SheetKey], shadow: ShadowOrigin }` (rank, archetype, grade, monster id or null, name), `gmOnly`, read by `shadowOrigin` (each choice from its table, a name cut to `NAME_MAX`). On the GM's phone, `Rose = { kind: 'local', step } | { kind: 'remote', event }` is what a risen shadow writes beside the corpse's outcome (api.ts), and `Beside.risen` (fight-save.ts) posts the message in `fought`'s one write, refused `no-room` when this phone is in none (the outcome is then not kept either, so no shadow is lost).
Change: `shadowRises(save, hid, origin, id, stamp, R)` in core/hunter/shadows.ts is the one step that puts a risen shadow in an army with its log line (refusing `army-full`); shadows.js's extraction and the GM's grant use it (their view-made `joined`, a store-made log id and a hand-built shadow, are gone), and the room's applier uses it with ids from the save's `seq` (`once: true`; an army at its cap takes none and the player is told, the id recorded so a repeat changes nothing). `shadows.extract(who, c)` takes the row's holder (`HunterRef`), not a hunter id; combat.js offers Extract for each hunter row whose hunter (this phone's, or a player's sheet) may extract. Principle: model-the-domain (a risen shadow is its own message with one core step for both phones, not an award with a hidden field); make-operations-idempotent (once by id, the cap judged on the receiving phone).
Tests: protocol.test.ts (`VALID.shadow`; one hunter; a rank, archetype and grade the tables hold, a monster id or none; a name cut to `NAME_MAX`); server-rooms.test.ts (a player cannot send it, the room unchanged; the GM can); applied.test.ts (it joins once with its log line however often it arrives; an army at its cap takes none, told, recorded); fight-save.test.ts (posted in the write that keeps the outcome; no room, nothing written); the room model's GM move `gm shadow <player>` (posted with no key, as `spent`); table-turn.e2e.ts "the GM extracts a fallen monster with a player's Necromancer, and the shadow that rises joins the army on the player's phone".

### Checks of units 2 and 3 (one run, at c46fcf7, which holds both)
- `bun run deps -- --write`, `bun run charts`: committed with each row; the charts did not move.
- `bun run typecheck`: `tsc --noEmit && tsc -p tsconfig.views.json --noEmit`, no error.
- `bun run test` at 02:40: `Ran 3497 tests across 92 files.` 3493 pass, 1 fail, 3 skip: the room model's exhaustive case past its 60 s budget, explained and fixed above (c46fcf7); `tests/room-system-model.test.ts` alone after: 21 pass, 0 fail.
- Every browser file but feel.e2e.ts, one at a time on port 3260: 30 of 30 files, 314 passed, no `failed`, no `flaky`, nothing that did not run.
- No `bun server.ts` of mine left running.

## Unit 4: V9's row M2, an ability that follows the recommended formula

Read first: notes-V9.md ("Left, and why"), maker.js `formulaField` and `buildAbility`, ability-kinds.ts `recommended`, `ticksOf`, `abilityOf`, abilities.ts `built`, the readers of `effect.formula` (resolve.ts `diceFor`, the use's evaluation and its dice count; fight-react.ts's reaction ops; fight-view.ts's ability lines; worth.ts; ability-kinds.ts's lines), fight-parse.ts's reader.
Cause: an ability that follows the recommendation stored the formula the rule gave when it was saved and `formulaEdited: false`; "follows" was worked out again on open by comparing printed text with `recommended(...)` over every stat (`ticksOf`). After a GM changes a rule the recommendation reads (`R.fight`: the cost shares, the power factor, the channel growth), every saved ability kept the old formula while marked as following it, and the maker then found no ticks that print the same text and showed "edited" for a formula the GM never typed.

### The data shape, before any code
```
// ability-types.ts
type RuleTicks = { scale: StatKey | null; gap: Gap | null; scalers: readonly Scaler[] }   // what the GM ticked
type AbilityEffect =
  | { type: EffectType; by: 'rule'; ticks: RuleTicks }    // worked out with the rules where it is read
  | { type: EffectType; by: 'hand'; formula: Formula }    // typed by the GM (or a built-in's own dice)
// Ability: `effect: AbilityEffect | null`; `formulaEdited` deleted (the arm says it)
// ability-kinds.ts: formulaOf(a, R): Formula | null, the one place a formula by the rule is worked out
```
The pace and the channel a recommendation reads are the ability's own fields (`cost.time`, `channel`), so `RuleTicks` does not hold them again (a fact kept twice); `formulaOf` reads them from the ability.
Variants weighed:
1. The union in the saved effect (above). Every reader asks `formulaOf`; nothing derived is stored; a rule change reaches every saved ability at its next read, a fight row's included; the maker's "edited" mark and Reset read the arm. Cost: each reader takes the rules (resolve.ts, fight-react.ts, fight-view.ts, worth.ts already do), and a by-rule effect is worked out at each read: `recommended` measured at about 12 µs a call on this box (`bun` loop of 20,000 calls, the box shared with the lead's CI), a few calls a use.
2. A row worked out from the rule where `formulaEdited` is false: keep the stored formula and the flag, store the ticks beside it, and have rows.ts work the formula out again at a join. The stored formula of a by-rule ability is then a stale copy every other reader (the skill list, the worth bar, the maker's preview) must remember to work out again: the derived value stored, which is the row's own finding.
3. The union only on content (a skill's and a monster's), the fight's rows holding a worked-out `{ type, formula }` type of their own: two ability types and a conversion at every place content becomes a row (hunterAbilities, monsterRows, shadowRow, summonRow, the doc's reader), for a saving of about 12 µs a use.
Picked: 1, the audit's remedy. A stored effect from before (no `by`) reads as typed by hand with its formula, the one-way repair, so a player's hunters keep their skills' abilities; the GM's Reset puts one back on the rule.
A finding at the first whole `bun run test` (02:40): the room model's exhaustive case ("every sequence of 3 moves") failed its 60 s budget (60,000 ms). Cause, from the counts: the new `gm shadow` move added one move to every step of the depth-3 enumeration, 16,386 sequences grew to 18,375 (measured alone: 48 s, against 39 s without it), and the whole suite runs it slower than alone. A shadow is posted exactly as a spent item is (in the write of a fight command, with no key, applied once by its id), so it adds no new interleaving of the room system. The fix keeps one move per way of posting in the exhaustive run (`gm shadow` left to `gm spent`, said in a comment there) and keeps `gm shadow` in the 2,000 random walks; the budget is unchanged. Alone after: 16,386 sequences, 39 s.

### M2 (done)
Change: `AbilityEffect` is the union above (`AbilityEffectType`, `Gap` and `RuleTicks` beside it in ability-types.ts; `formulaEdited` is deleted). `formulaOf(a, R)` (ability-kinds.ts) is the one place a by-rule effect becomes a formula: the kind's `recommended` of its ticks, the pace read from the ability's time and the channel from its own; `ticksOf(a, R)` reads the maker's ticks from the arm (the text compare over every stat is deleted); `ruleTicks` cuts the maker's ticks to what an effect keeps. `abilityOf` gives an effect by the rule unless the input types one; `built` and `itemAbility` (a built-in's own dice, an item's formula at its tier) are by hand. The readers ask `formulaOf`: resolve.ts (`diceFor`, the use's value, its dice count; `needs` and `diceFor` now take the rules, so do their callers), fight-react.ts, fight-view.ts (`abilityLines`, `intentOf`, `cardOf`), map-view.ts (`fightBodies`), worth.ts, detail.ts, rows.ts (`sameRankHit`), skills.js's list (with "(edited)" from the arm). fight-parse.ts reads the union (`effectOf`, `ruleTicksOf`, `gapRead`; scalers kept within `bounded`), and an effect from before `by` reads as typed by hand. ability-kinds.ts now imports `afterDefence` from land.ts, so resolve.ts may import ability-kinds.ts without a cycle. The maker: the field's "edited" mark and Reset read the arm (typing or inserting a name makes it the GM's, Reset gives it back to the rule); `effect()` answers the arm. A GM who types the recommended text by hand keeps it as typed until Reset: the mark says what the GM did, not what the text happens to equal.
Principle: model-the-domain and type-system-discipline (an arm that says how the formula is made, instead of a flag beside a stored copy and a text compare); boundary-discipline (the parser reads the arm once; the old shape is repaired there).
Tests: ability-kinds.test.ts "a GM's change of a rule the recommendation reads reaches an ability by the rule; one typed by hand stays as typed" (`powerK` 0.6 to 0.9: `1d8 + 6 * (agi / 10)^0.8` becomes `1d8 + 9 * ...` for the one by the rule, the typed one stays; before, the stored formula stayed for both) and "a saved ability by the rule reads back with its ticks ..."; save.test.ts "one by the rule is saved as its ticks", "one stored before `by` is read as typed by hand"; lint "whether a formula follows the rule is its effect's arm, never its text compared with the recommendation" (its first cases are the maker's old compare and `ticksOf`'s). Tests that built an effect as `{ type, formula }` now say `by: 'hand'`, and reads of `effect.formula` ask `formulaOf`.

### Checks of unit 4 (at 4c78fbd, the makers fixture fixed after)
- `bun run deps -- --write`, `bun run charts`: committed; the charts did not move.
- `bun run typecheck`: no error.
- `bun run test`: `Ran 3502 tests across 92 files.` 3499 pass, 0 fail, 3 skip.
- Every browser file but feel.e2e.ts on port 3260: 30 of 30 files, 313 passed, 1 failed: makers.e2e.ts "a GM makes Frost Lance in at most 9 taps ...". Cause, from its diff: the test's expected skill (`FROST_LANCE`) was written in the old shape, a formula with `formulaEdited: false`, and the maker now saves an ability made with the shot's own ticks as `{ by: 'rule', ticks: { scale: 'str', gap: null, scalers: [] } }`; my M2 commit had rewritten that fixture to `by: 'hand'`, which is what a typed formula would be, not what this one is. The fixture now says `by: 'rule'` with those ticks (the rule's: a shot with its own stat). makers.e2e.ts after: 35 passed.

## Unit 5: V8, the lints hold what they name

### M1 (done)
Cause: the map maker's `save()` and the bestiary's `saveMonster` ignored `store.apply`'s answer and answered the map or the id as saved; loot.js and `bundles.save` already read `.ok`. On a read-only tab (another tab took over, a newer save) the maker closed and the GM was told the monster or map was saved when nothing was.
Change: both read the answer: a refused write leaves the maker open with `NOT_SAVED` (ui.js, one sentence for every maker, TODO(copy)), and `saveMonster` answers null, which the generator and Duplicate also read (no "Duplicated" toast for a copy not made). Lint: "a maker's save reads the answer of its store.apply" (every `save*` function of a view; its first case is the old `saveMonster`).
Test: the lint (it fails on the old lines). A browser case of a read-only tab was not added: the store's refusal on a read-only tab is held by save.e2e.ts and store-life.test.ts, and the maker's reading of the answer by the lint.

### H8 (done)
Cause: guards on another module's api (`app.api.identity ?`, `A().build ?`, `app.api.combat?.isActive?.()`, `app.api.sync?.switchTo`, `app.keys && app.keys.add`, `sync()?.doc?.`, `S.myKey ?`) read as if a module may be absent, but the api table throws for a name read before or without its register, so none was ever false; hunter.js's fallback `setActive` beside `sync.switchTo` was a dead second way to switch hunter.
Change: the guards and the fallback are deleted in bestiary.js, combat.js, dice.js, gm.js, hunter.js, onboard.js, room.js, shadows.js, table.js (hunter.js no longer imports `setActive`); combat.js's keyboard block keeps its braces to scope its helpers, said in a comment. Lint: "a view reads another module's api without a guard" (its first cases are five old lines; a member read after the name passes).

### I3 (done)
Cause: four view writes were steps written in place as a spread (`store.apply('shop-edit', s => ({ ...s, shop: ... }))` twice in inventory.js, the GM's build switches and their reset in custom.js), rules with no name or test; the lint "a view writes the save only through store.apply, with a step from core" saw assignments and `store.update`, not a spread. (gm.js's line the audit named is gone.)
Change: `withShop(save, list | null)` in core/hunter/inventory.ts and `buildRuleSet`, `buildRulesReset` in core/hunter/build.ts; the views call them. The lint now refuses a spread step in `store.apply` (its first cases are the two old lines).
Tests: inventory.test.ts "the GM's shop list is set as one step ..."; build.test.ts "as steps of the save ..."; the lint.

### The two pairs in combat.js (done)
Cause: `tableRefusal` with `refusals` and `lastBurst` with `bursts` were a value and its counter that change together; the value already held the count (`n`), so the second let was the same fact kept twice. Change: each is one let, its count raised from the value it replaces; the let lint's list names two lets instead of four, so a counter let added back fails it ("name this let below").

### Step 3's stale permits and the coin lint (done)
Cause: permits that permitted nothing any more (the role lint's save.ts and store.ts, the room-fields lint's io.js `isy.gmKey`, the level lint's skills.js `k` and shadows.js `s`, the vitals lint's shadows.js `s`, the combatant lint's shadows.js `s`, the view import list's `addSheetStatus`) were room for a new writer to pass; and the coin lint named coin.js and saw only `.coins =`, while the writer is coin.ts by spread, so it held nothing.
Change: each stale permit is deleted; the role lint now fails when a permit matches no line ("a permit that permits nothing leaves the list"); the coin lint names coin.ts and sees `coins:` and `calls:` in an object literal (its first case is coin.ts's own spread line, as a view would write it).
Test: the lints themselves (73 pass); each deleted permit would now refuse the line it once permitted.

### Step 3's timer and closure counts (done)
Cause: both lints let each file's count "only fall", so a count above what a file held (quests.js 3 timers for 2, maker.js 1 for 0, onboard.js 2 for 1; eleven files' closure lets, shadows.js named with none) was room for new timers and lets with no reason read, and many reasons were a unit's name, not what the lets hold.
Change: each count is what the file holds, compared exactly (a file with fewer fails too: "a timer that is gone lowers its count"), and each reason says what its lets or timers hold; ui.js's `LATE` reason says why the next window waits a task (the closed one's leave runs first, 0 outside tests). Test: the lints (a stale count now fails them).

### N15 (done)
Cause: the lint that names the edge's state read three files (sync.ts, room-pill.ts, upgrade.ts); rules.ts's source and cache, store.ts's save, life, prefs, device and subscribers, and report.ts's `seen` were in no list, so a new flag there passed every lint.
Change: the lint reads every module of src/edge with the views' page reader (`pageLets`: a let at a module's top or its `register`'s, never a function's own) and names each let and each Map or Set with what it holds; a name that is gone leaves the list. Its first case is store.ts's `let state` beside a register's let and a function's own.
Test: the lint (it failed on its first run with the eight containers of sync.ts and upgrade.ts it had never seen, now named).

### X1 (done)
Cause: page state kept in a const object with fields (room.js's `S`: two server checks, a pick, open rows and a timer; bestiary.js's filters, table.js's HUD, custom.js's picker, gates.js's mount handles, the two `mapSource`s) escaped both page-state lints: the let lint counts lets, the container lint named only empty `{}`, `[]`, `Map` and `Set`.
Change: the container lint also takes an object literal with fields; an UPPER_CASE object is a constant table of words or values and is left out (the name says it is never written). The seven found are named with what they hold; room.js's `S` is renamed `view`, since a one-letter capital reads as a constant. Its first case is room.js's old object. gm.js's `open` (its value a `matchMedia` ternary that makes an object) is not seen by the pattern, which reads a declaration's first token; it holds which GM panels are open on this screen size, a UI value.
Test: the lint (it found 48 objects on its first run; 41 were UPPER_CASE tables).

### K1 (done)
Cause: which errors of the kits' blocks kit-parts.js showed again in the group's bottom line was a regex on their words (`/^(Pick|HP|A share|Stacks|At least|Uses|Write the field|Rounds go)/`), so the wording pass would show a reworded row error twice, and the summon's own "Rounds go from 1 to N." was hidden from the bottom line because a status row's error starts the same way.
Change: each error is pushed with where it is shown (`{ text, at: 'row' | 'group' }`, `rowErr` for a price, a gate or a summoned status's row, `groupErr` for the tags, the reach, the summon's name and rounds, the zone act); the bottom line shows the first group error, the answer's `err` the first of all. Lint: the label lint also refuses a regex of sentence starts tested against an error and `.test(` over an error or message (its first case is the old bottom line). What a GM sees: the summon's rounds error now shows in the bottom line; nothing else changes.

### The invite in sessionStorage (done)
Cause: sync.ts kept the invite in sessionStorage itself, with two catches that said "the store's banner says storage is off", false when storage is full (no banner then), and the storage lint permitted it.
Change: the invite is this tab's memory through `store.device('invite', 'tab')`, whose failed write is the store's `deviceFailed` banner; the catches and the storage lint's sync.ts permit are gone (the lint's "a file that no longer reads storage leaves the list" holds the list to what reads storage). Test: the storage lint; room-onboarding.e2e.ts and room-sync-fixes.e2e.ts carry an invite across a reload (run in this unit's checks).

### Checks of unit 5 (at 67db788)
- `bun run deps -- --write`, `bun run charts`: committed; the charts did not move.
- `bun run typecheck`: no error.
- `bun run test`: `Ran 3506 tests across 92 files.` 3503 pass, 0 fail, 3 skip.
- Every browser file but feel.e2e.ts on port 3260: 30 of 30 files, 314 passed, no `failed`, no `flaky`.

## Unit 6: the "Left" sections

Read once: notes-V1 to V6, V9 to V14, notes-lane-A.md, notes-lane-B.md, notes-leftovers.md, searched for left, skipped, partial, "for the lead", later, deferred, then read around each hit. Rows the first audit left on purpose (8) stay.

| Where | What was left | Verdict |
|---|---|---|
| V1 | two quick taps send two casts | done by design: the second is stale (`onTurn`) and turned down at no cost |
| V1 | a cast of an item the player no longer holds is taken and spends nothing | left, reason holds: the bag's one writer is the player's phone, whose Use refuses with none left; the GM's fight cannot see the count until a sheet arrives, and `spent` takes nothing it does not find |
| V2 | a held player's reward statuses and a local hunter's fight parts go to the fight after the award's write | a row of this unit: its reason was that the fight's file was another lane's, which no longer holds |
| V2 | combat.js's card toggle revives a row at a literal 1 HP (`adjust(r, { hp: k.down ? 1 : ... })`) | a row of this unit: `REVIVE_HP` (vitals.ts) owns that number |
| V4 | combat.js reads a remote sheet for the identity badge with `|| {}` guards | a row of this unit: the parsed sheet is trusted inside (N8's class); `holderHunter` (C3) answers the row's hunter |
| V4 | sync.ts `recentKicks` names a removed player "Hunter" | left, reason holds: the key has no sheet, so no name exists to show |
| V5 | the room-fields lint scans views and the edge, so bind.ts (core) is outside it | left, reason holds: bind.ts holds the pure steps, sync.ts their one caller, which the lint holds |
| V9 | M2 | done in unit 4 |
| V10 | C3's second half | done in unit 3 |
| V12 | no lint that a campaign file is written only through `exportedSave` | left, reason holds: io.js is its one writer; AGENTS.md adds a lint when a class shows up twice |
| V13 | the maker offers push and extra on a reaction | done since (V13's "after the unit": the skill maker refuses it on Save) |
| V13 | FP1's notice | done in unit 3 |
| V13 / audit 3 | K2, a zone named by its words | left, the audit's reason holds: abilities and zones are made apart, and a zone has no registry entry to link by key; a name is the one link a GM can type |
| V14 | the GM board and the HUD say nothing of the life | not a problem: a statement of scope |
| leftovers | `merge`'s one cast in rules.ts | left, reason holds: TypeScript cannot type a merge by key over a generic `T`; tests/overrides.test.ts backs the cast |
| leftovers | the daily backup's failed push is not told | left, reason holds: nothing is lost, the save stays under its key |
| leftovers | old saves' starter skills keep "Lv.1" | left: old saves need not keep working |
| leftovers | type re-exports (`GateId`, `MonsterId` from gate.ts, `MapId`, `CombatantId`) | left, with a reason that holds better than the one given ("their importers did not move in this unit"): each is the one type defined in ids.ts, passed through, so no second meaning exists; the type-name lint holds one definition |

### Unit 6 row: a row revived at a literal 1 HP (done)
Cause: the GM card's Revive for a monster's or a player's row adjusted the row by a literal `1` (`k.down ? 1 : -k.hpMax`), a copy of vitals.ts `REVIVE_HP`, which the fight's own `combat.revive` already reads. Change: the toggle reads `REVIVE_HP`. Test: combat-turns.e2e.ts and character.e2e.ts (18 and 24 passed); the number is the constant's own, so no bun test reaches a view's literal.

### Unit 6 row: the identity badge's guarded sheet read (done)
Cause: combat.js read a player's sheet for the badge with its own guards (`(remoteList().find(...) || {}).data || {}`), N8's class: the room's parser already read the sheet. Change: the badge reads `holderHunter(r)` (C3's one answer to "the hunter this row holds"); a player's row whose sheet left the room draws no badge. Test: the browser files above; the lint "a view reads a player's sheet as the room's parser left it" holds the class for names.

### Unit 6 row: a held player's reward statuses after the award's write (not done; where a next helper starts)
Cause, as V2 wrote it: Send award is one write (`gmAward`), but a player's reward statuses whose hunter this phone's fight holds go to the row afterwards, one `combat.status` per status (gm.js:405), and a local hunter's fight parts likewise (`hunter.granted`); a throw between leaves the award paid and logged with a status missing from a row. Its stated reason (the fight was another lane's file) no longer holds. Remedy: a fight command that puts statuses on several rows (`status` takes one row and one change today: a `statuses` command, or `status` with a list), sent once with the award's step as its `also`, so `fought` writes the fight, the award, the posts and the log line in one `store.apply`; the local hunter's fight parts ride the same command. Files: fight-types.ts (`Command`), fight.ts (`TABLE` and the reducer), fight-save.ts (nothing new: `also` exists), gm.js `sendAward`, scripts/charts/fight.ts (the command's word), tests/fight.test.ts, tests/award.test.ts, tests/e2e/reward-room.e2e.ts. Left for budget, not for a reason in the code.

### Checks at aa26c3c (unit 6's two rows in)
- `bun run deps -- --write`, `bun run charts`: no change.
- `bun run typecheck`: no error.
- `bun run test`: `Ran 3506 tests across 92 files.` 3503 pass, 0 fail, 3 skip.
- Every browser file but feel.e2e.ts on port 3260: 30 of 30 files, 314 passed, no `failed`, no `flaky`. No `bun server.ts` of mine left running.

## Where this run stopped
Units 1 to 5 are done and checked. Unit 6 is read and judged; two of its three rows are done; V2's held reward statuses is not (plan above). Nothing is half done in the tree; everything is committed. Contested designs to flag: C3's extraction rolls on the GM's phone (a player may expect to tap Extract on their own); M2's maker keeps a formula typed to the recommended text as typed until Reset.

## Held reward statuses in the award's one write (Nov 16, helper 2, from 25cce71)

Goal (the owner): "Everything must be explicit. Everything." "For all things we must fix the problem and not the symptoms." The problem: Send award is one write (`gmAward`), but a reward's statuses for a hunter that this phone's fight holds go to its row afterwards, one `combat.status` per status (gm.js `doAward`). A local hunter's fight parts go the same way (hunter.js `settle`, called from `hunter.granted`: a `combat.status` per status and a `combat.refill`). A throw or a reload between the two leaves the award paid and logged ("GM award: Burning → Kai") with the status missing from the row. The smallest change: the award and what it puts on the fight's rows are one `store.apply`.

Principles read in full: fix-root-causes, model-the-domain, type-system-discipline, boundary-discipline, test-behavior-not-implementation, make-operations-idempotent, prove-it-works.

### Cause
The fight's state has one writer, combat.js `send`, and each send is one command written by `fought` in one `store.apply`. A grant is another module's step. Before V2, each part of an award was its own write. V2 folded the award into one write but left the fight's part outside it, because `status` takes one row and one change, and fight.ts was another lane's file at the time. So the act "award these hunters" is spread over 1 + n writes, where n is a write per status per held row plus a refill. The first write records the whole act in the log.

### Variants weighed (fewest new kinds of thing wins)
1. A new command `statuses` that puts statuses on several rows: a new `Command` member, a column in all four rows of `TABLE`, its chart words and `randomCommand`. It does not cover a level-up's refill, which is an `adjust`, so either a second new command or a refill field inside this one (a command that does two things).
2. `status` taking a list: still one row per command, so an award to two held hunters is still two commands. Batching is needed anyway, and the refill is again left out.
3. No new command: the commands the award needs (a `status` per status per held row, an `adjust` for a refill) reduced in turn in one write, by one pure fold beside `reduce` (`reduceAll`), with the award's step as `fought`'s `also`. No new command, state or `TABLE` cell, and the chart does not change. It covers statuses and refills alike, for any number of rows.

Picked: 3. One rule comes with it: the batch is all or none. The first command the fight refuses refuses the whole write, award included. The log line names every status, so writing the award without a status the row refused would record something that did not happen. The GM is told the fight's reason ("too many statuses") and "Not saved: nothing was sent." Before, the award went through and only that status was refused, so this is a difference the GM can see (for-the-owner.md).

The commands are worked out before the write, from the grant's own answer: the step runs once on the save as it is (`Granted.fight`, the parts the sheet does not hold) and then again inside the write. The precedent is quests.js `complete`: "the step answers the same for the same save". The fight's parts depend only on the reward, the hunter's rank and its XP, and the fight's write-back changes none of those, so the two runs agree. `hunter.granted` then only shows what was written: the statuses the row took (`rowStatuses`, the same filter the commands use) and the refill. It no longer sends anything to the fight.

### The change (95f33df)
- `reduceAll` (fight.ts) reduces several commands in turn. The first one refused refuses them all, with the fight as it was.
- In fight-save.ts:
  - `HeldParts` is a row's statuses and refill.
  - `rowStatuses` gives the statuses a row takes: a def of its own or the rules', and never a state chip. `heldCommands` builds a `status` command per status and an `adjust` up to the row's maxima for a refill. `heldLines` gives the reward window's lines for those statuses.
- In combat.js:
  - `command` takes a list. `send(cmd)` is `sendAll([cmd])`.
  - `combat.held(parts, also)` writes the batch and the grant's step in one `fought`.
  - An item is spent only by a command sent alone, which is how a use is always sent.
- In hunter.js:
  - `grantWrite(why, step)` reads the step on the save as it is. It writes through `combat.held` when this phone's fight holds a part, else through `store.apply`.
  - `give` (XP, `applyRewards`) uses `grantWrite`.
  - `settle` no longer sends anything to the fight. It adds `heldLines` for a row and the refill to the level-up window, and toasts `gmHolds` for the GM's fight.
- gm.js `doAward`: the award, the posts, the log line and each held row's statuses go through `grantWrite`. The `combat.status` loop after the write is gone.

### The sweep (step 3): a view that writes the save and then sends a fight command for the same act
Every caller of a fight command outside combat.js:
- Same shape, fixed:
  - quests.js `complete`: the quest's write, then `hunter.granted` sent the reward's statuses to the row, then `hunter.refill` refilled it for the day's recovery. Both now ride `grantWrite`, and the recovery is a refill part.
  - hunter.js `lifeInFight`: the life event (Revive, a natural 20) was written on the sheet, then the row's HP was raised by its own `combat.adjust`. Now it is one `combat.adjust` with the life step as its `also`. `combat.adjust` takes an `also`, and `vitalsEdit` passes its sheet step to `onRow`, so the write stays inside a `vitalsEdit` call (the lint).
  - room-events.ts `landAward` (a player's phone): its `tell` called `hunter.granted`, which sent a held hunter's statuses to the phone's own stored fight after the land's write. That fight runs no command while the phone is a player in a room (`runsFight`). Writing the fight inside the land would make a second writer of the fight; I tried it and the lint "only the combat dispatcher writes the fight" refused it. So the land now refuses those parts with the `gmHolds` toast, as the room's `status` message already does for a held hunter (room-events.ts `status`). It is in for-the-owner.md.
- Not that shape, left:
  - gm.js `sendHp`, `sendStatus` and hunter.js `handEdit`, `addCondition`, `removeCondition`: one fight command and no save write beside it.
  - `combat.revive`, `combat.spend`, `combat.extracted`: these already carry their `also`.
  - bestiary.js `combat.add`: no write beside it.
  - combat.js `showParty` (the end of an encounter): the fight is ended, so `fightHold` answers the sheet.
- Deleted: `hunter.refill` and `combat.refill`. Nothing called them once quests.js stopped. The deps test "every registered app.api member is used" found it. character.e2e.ts used `hunter.refill` only as setup, to fill HP after a worn amulet raised the maximum. It now does that with `hunter.heal(hid, 999)`, and its assertion is unchanged.

### Tests
- tests/fight-save.test.ts, "an award to hunters this phone's fight holds is one write" (5 cases). It runs gm.js's pipeline on core: the plan, `heldCommands`, `reduceAll`, `fought` with the award as `also`, then the outbox's send.
  - One write holds the XP, the line, Kai's award post, Bleeding on both rows, this phone's row refilled and Kai's totals.
  - A reload after the write or after the flush finds all of it.
  - A reload before the write finds none of it.
  - A row at `MAX_STATUSES` refuses the award whole. The save is byte for byte unchanged.
  - `heldCommands` leaves out a status with no def and a state chip, and a full row gets no refill.

  Without the change the file does not load: `heldCommands` and `reduceAll` do not exist. In the old pipeline, a reload after the award's write found the award with no status. The refusal case fails under a "skip the refused one" fold.
- tests/e2e/reward-room.e2e.ts: "the GM awards Hasted to a player's hunter in the GM's running fight: the row shows it, in the same write as the award's log line". It passed alone (13.3 s). The row showed the status before this change too, only later, so this case checks the path and not the bug. The bug is between two writes, and only the core test can stop a reload there.
- Lint counts, lowered as the lint asks when a let goes: gm.js closure lets 8 to 7 (`doAward`'s `out` is gone). hunter.js stays at 3: `give`'s `g` became `grantWrite`'s `out`.

Principles that changed a choice:
- fix-root-causes: the fix is one write. I added no retry after the write.
- model-the-domain: no new command kind, because a grant's parts are commands the fight already has.
- subtract-before-you-add: deleted `refill` twice and settle's send path.
- test-behavior-not-implementation: the core test asserts what a reload finds, not which functions ran.

### Checks at 37700d3
- `bun run deps -- --write`: rewritten (the new members `combat.held`, `hunter.grantWrite`; `refill` gone). `bun run charts`: no change. The fight's `TABLE` is untouched.
- `bun run test`: `Ran 3512 tests across 92 files.` 3509 pass, 0 fail, 3 skip.
- Every browser file but feel.e2e.ts, one at a time on port 3260: 30 of 30 files, 315 passed, no `failed`, no `flaky`. No `bun server.ts` left running.
- Left: nothing of this row. A player's phone refusing a held hunter's reward statuses for a fight it ran alone is a choice, written in for-the-owner.md, and the lead may want a second opinion on it.
