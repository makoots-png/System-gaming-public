# V10 A row's identity and who is in a fight

Goal: a fight row, a pin, a codex entry and an extraction each know whom they are about by an id or a field, never by a name parsed back, and "is this hunter in a fight" has one answer. Smallest change: each row's remedy in core (rows.ts, bestiary.ts, hunter/shadows.ts, effects.ts), the views read it.

## Inventory (code at 013d1d2)

| Row | Verdict | Where now |
|---|---|---|
| B2 | still true | core/bestiary.ts:29 `baseName` strips a trailing letter or number; bestiary.js:76 reads a fallen row's kind from `baseName(b.name)`; rows.ts:216-223 writes the letter into `name`; the monster origin has no name |
| B4 | still true | bestiary.js:98-111 builds the room codex merge and its records; `codexFromRoom` only writes them |
| C2 | still true | combat.js:687 pins keyed `${kind}:${name}` with `/ [A-Z]$/` cut; table.js:388 `hunter:${h.name}`; combat.js:979 cuts `/ A$/` for the toast; combat.js:1034 cuts names at 56 |
| C3 | still true | combat.js:798 and 1008 extract with `store.active()`; shadows.js:122 shows the panel by the active hunter |
| CU1 | still true | hunter.js:170 `fightOf`, custom.js:174 `inFight` (any running fight on this phone, whoever is in it), coin.js:48 `inFight` |
| SM1 | still true | rows.ts:135 `rarityIdx` beside effects.ts:26 `rarityTier`; forge.js:29 `gmSource` beside effects.ts:32; shadows.js:21 `GRADE` (boss rises as Knight) beside rows.ts:80 `SHADOW_KINDS` (grade to body) |
| S1 | still true | shadows.js:52, 77 check the cap; core/hunter/shadows.ts:28 `addShadow` adds whatever the cap |
| S2 | still true | shadows.js:59 `nat === 1 ? 'crumbled' : nat === 20 or total >= dc ? 'risen' : 'failed'` |
| SK1 | still true | skills.js:32 `idOf(name)`, kept only while the kind stays (143) |

## Rows

Before V10: merged claude/zen-pasteur-ov4cgd (e69d7e8, docs only) as 17099a4; typecheck clean; `bun run test` with S1, S2, SM1 in: 3375 pass, 1 fail (the dependency map, stale from S1's new imports; redrawn), then deps test passes.

### S1 (done)
Cause: "the army is full" was checked only in shadows.js; `addShadow` added a shadow whatever the cap, so two quick Extract taps or a cap lowered by a rule or a lost level put a shadow past it.
Change: `armyCap(h, R)` (the sheet's shadow capacity) and `addShadow(h, s, R)` refuses `army-full` at the cap (core/hunter/shadows.ts); the extraction's and the GM grant's step is that call, so a refused add refuses the whole write (the fight's extraction outcome too). shadows.js reads `armyCap` for its pre-roll check. Test: shadows.test.ts "a hunter's army takes no shadow past its cap" (a third shadow joined a cap of 2 before).

### S2 (done)
Cause: the extraction's outcome (natural 1 crumbles, natural 20 or the DC rises, else fails) was the view's rule. Change: `extractOutcome(roll, dc)` in core/hunter/shadows.ts; shadows.js calls it. Test: shadows.test.ts "an extraction roll" (a table of four rolls).

### SM1 (done)
Cause: three small rules kept twice: an item's rarity tier (rows.ts `rarityIdx` beside effects.ts `rarityTier`), the GM's source of a status (forge.js beside effects.ts `gmSource`), and the grade a kind rises as (shadows.js `GRADE`, while core kept grade to body). Change: rows.ts reads effects.ts `itemSource`; forge.js imports `gmSource`; `risesAs(kind)` in core/hunter/shadows.ts is the kind-to-grade table, shadows.js reads it. Test: shadows.test.ts "a boss rises as a Knight ..."; the rarity tier copies agreed on every rarity, so no test failed before for them.

### CU1 (done)
Cause: "is this hunter in a fight" had three answers: hunter.js `fightOf` (a row of this phone's fight, set up or running, or the GM's fight on a player's phone), custom.js `inFight` (any running fight on this phone whoever is in it, or the room's doc) and coin.js `inFight` (a row in a running fight, or the GM's table). While the GM ran a fight on this phone, a hunter of this phone not in it could not change gear or respec and was told "during a fight"; a fight in setup counted for one answer and not the others.
Change: `fightHold(fight, who, room)` in core/combat/fight-save.ts is the one answer (`row`, `gm` or null); hunter.js `fightOf` calls it, and custom.js (gear, loadouts, respec, the Skills panel through `loadouts.inFight`) and coin.js ask `app.api.hunter.fightOf`. `combat.rowFor`, its old half, is deleted from combat.js and api.ts. A fight in setup holds its rows for all three now.
Tests: fight-save.test.ts "who a fight holds": a hunter no row holds is not in a fight though this phone runs one (custom.js answered yes), setup holds, the GM's doc on a player's phone holds by key only.

### B2 and C2 (done, one change)
Cause: rows.ts writes a pack's letter into a row's `name` ("Goblin B") and kept no other record of the monster, so four readers parsed it back out: the codex (`baseName`, so "Unit 7" was recorded as "Unit" and two monsters differing by such a suffix shared an entry), the GM hotbar's pins (`kind:name` with `/ [A-Z]$/` cut, so two hunters of one name shared pins and a rename lost them; the player's HUD keyed `hunter:${name}`), the "added" toast (`/ A$/`) and the quick line (names cut at 56 to leave room for the letter).
Change: a monster origin holds `name`, its monster's own name (effect-ops.ts `Origin`, set by `monsterRows`, `shadowRow` and `summonRow`, read by the parser); the codex reads `origin.name`, and `codexKey` keys the name as written (lower case, spaces collapsed); `baseName` is deleted. `pinKeyOf(row)` in map-view.ts keys a hunter's pins by its hunter id (a player's by its sheet key), any other row's by its kind and its monster's own name; the player's HUD uses `myPinKey(h.id)`, the same key. The toast reads `origin.name`; the quick line leaves the bound to `parseMonster` and the letter's room to rows.ts.
Tests: rows.test.ts "a pack's rows carry their monster's own name in their origin" and "a hotbar's pins key on a hunter's id and a monster's own name". bestiary.test.ts's key test said "without the fight's row number": the rule it held is the one removed, so it now says a name ending in a letter or number is its own kind ("Unit 7", "Type A"). Origins in tests carry a name.
For the GM: pins saved under the old keys (by name) are not read; a hotbar shows its default pins until pinned again. In for-the-owner.md.

## Left at the first session's end (all three done since, below)

- C3 (med): who extracts a fallen monster is `store.active()` (combat.js extract button and `A().shadows.extract(store.active().id, ...)`), not a hunter row of the fight. Remedy as the audit says: the fight's `extract` command names the extracting row (a hunter row whose job may extract) and the card offers one button per such row; the DC from that hunter. Touches fight-types.ts (`extract` command), fight.ts, combat.js, shadows.js (lane B's V14 file for the summon only).
- SK1 (med): a skill's ability id is made from its name (skills.js `idOf`), so a rename with a kind change gives it a new id (its pins and cooldowns go) and two of one name share an id. Remedy: the id made by `store.id` where the skill is made and kept across edits, with the leftovers' branded ids.
- B4 (med): the room codex merge (which entry replaces this phone's, and the record's shape) is built in bestiary.js; remedy `codexFromRoom(save, doc)` answering the save and the fresh entries, with a test. bestiary.js is lane B's V9 file.
These were left when the session's budget ran short, not for a reason in the code; the next helper takes them first.

### B4 (done)
Cause: which room codex entry replaces this phone's (`!o || (o.room && o.kills !== e.kills)`) and the record's shape were built in bestiary.js; `codexFromRoom` only wrote them, so nothing tested the merge. Change: `codexFromRoom(save, doc)` in core/bestiary.ts takes the room's doc and answers the save and the fresh entries (the same save when nothing changed); bestiary.js applies it and tells the fresh ones (lane B's file, its own commit). Test: bestiary.test.ts "the room's codex doc lays over a player's" (new kinds added and told, a room entry whose kills moved replaced, this phone's own kept, nothing changed answers the same save).

### SK1 (done)
Cause: an active skill's ability id was made from its name (`idOf`), kept only while the kind stayed the same, so a rename with a new kind gave it a new id (the fight's cooldowns and uses and the hotbar's pins key on it) and two abilities of one name on one body shared an id. Change: the skill maker makes the id once with `store.id('ab')` when the skill is made and keeps it across every edit (`ownId` in skills.js); `idOf` is deleted. Test: makers.e2e.ts "a skill renamed and given another kind in the skill maker keeps its ability's id" (the old code gave `frost-spear`); the Frost Lance case now expects a made id, the same on Brakk's copy.

### C3 (done for this phone's hunters)
Cause: who extracts a fallen monster was this phone's active hunter (`store.active()`), not a hunter in the fight: a GM whose active hunter is not the Necromancer saw no Extract, and the DC was worked from a hunter who did not fight. Change: the fight's `extract` names the extracting row (`by`, a hunter row of the fight, else refused `notExtractor`, fight-types.ts and fight.ts; its log line is about both rows); the GM's card offers one Extract per hunter of this phone the fight holds whose job may extract ("Extract (name)" when several, TODO(copy)), and the roll, the DC and the army are that hunter's (`ExtractTarget.by`, `combat.extracted(cid, by, ...)`). The fight model's extract names the first hunter row without a new draw, so every seed plays as before (the charts did not move).
Test: fight.test.ts "an extraction is made by a hunter row of the fight" (any `by` passed before; no `by` existed).
Left: a player's Necromancer on another phone. Its army is on its own phone and no room message gives a shadow (a reward has no shadow); the remedy is a room message (or a reward field) that adds the shadow there, with its applier. Named for the lead.
A finding on the way: one combined run of fight.test.ts and fight-model.test.ts failed the 2,500-fight case by its 120 s timeout (125 s) while the lead's CI timed frames on the box; run alone it passed in 109 s with every invariant. Its cause is the busy box against a fixed timeout, not an invariant; the case is unchanged.

## Checks

At e8779fd (all of V10 and V13's leftovers): `bun run test` 3430 pass, 0 fail; browser files 28 of 30 passed, two failed, each a test fault found from evidence and fixed in e6bc7bd:
- customization.e2e.ts, two steps ("during a fight a set does not swap…", "respec is refused during a fight"): the test's fight held only a goblin, so it asserted the CU1 bug itself (a hunter no row holds refused gear and a respec). Its `startLocalFight` now puts the active hunter's row in the fight, and a new step checks that a fight holding no row of the hunter leaves its gear free (it fails on the old `inFight`, which answered yes for any running fight).
- table-turn.e2e.ts "a player's blast at two rats…" (V13's leftover test, mine): the test's Boom had `shape: { kind: 'radius', radius }` without `ring`, which `parseAbility` refuses (ring is null or a ring, never absent), so the store kept the skill with no ability and the player's card had no Boom button. The shape now carries `ring: null`; the test passes and the file passes 10 of 10.
After the merge of claude/zen-pasteur-ov4cgd (ffd5aca) as a52df49: typecheck clean; `bun run test` 3445 pass, 0 fail (`Ran 3448 tests across 92 files`); the browser files at a52df49 are in notes-lane-A.md.
