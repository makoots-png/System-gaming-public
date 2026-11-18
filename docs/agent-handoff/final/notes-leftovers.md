# Notes: the leftovers (code), after the audit's fifteen units

Goal (the owner): "I want it perfect, I do not care about time", "Everything must be explicit. Everything.", "fix the
problem and not the symptoms". The problem: fifteen units each left a rule held by a view, a fact guessed, or a thing a
GM cannot make. The smallest change: each of the twelve rows done where AGENTS.md says that kind of thing lives, and
nothing else. Started 14:18 UTC on 4a311c3; no browser run and no whole `bun run test` before 14:49 (the lead's timed CI).

## Step 0: each row against the code (at 4a311c3)

1. Codex record (bestiary.js): already a named core step. `recordDefeat` in src/core/bestiary.ts:86, called through
   `store.apply('codex-record', ...)` at src/views/bestiary.js:83 (commit a57e0e0's unit, U13/U14). What U4 left is a
   second write after the fight's: it runs in the same task as `fought`'s write (combat.js:111 then :117 emits
   `combat:defeated`), and the store writes storage a frame later (store.ts `schedule`), so no reload falls between
   them. Changed shape: see row 1 below.
2. Lint for per-row state in a view's Map: still true. No such test in tests/lint.test.ts.
3. store.ts `load` ignores `pushBackup`'s false: still true, src/edge/store.ts:146. The same ignored false is at :189
   (`keepMine`), :200 (the daily backup), :207 (`replace`), and in src/views/io.js:98, :185 and :253 ("Backup saved."
   whatever the answer).
4. `isPlaceholder`: still true, src/views/combat.js:972.
5. Skill label "Lv.n": still true, src/core/hunter/skills-held.ts:33; the lint's allow-list at tests/lint.test.ts:1105.
6. `parseOverrides` keeps list overrides as written: still true, src/core/rules.ts:347 (`merge` with its cast at :354)
   and :413.
7. `MakerApi.open` answers `Promise<any>`: still true, src/core/api.ts:360; allow-list at tests/lint.test.ts:1129.
   `KitFields = any` at src/core/api.ts:354 is a second `any` the lint misses (its regex wants `: any`).
8. Save ids still `string`: still true (src/core/ids.ts `SaveIds` has h, q, t, sh, i, l, r only).
9. 23 type names exported twice: still true, tests/lint.test.ts:1174.
10. Einar's boundaries: changed shape. A field's upkeep and end got controls in 11f7d9f (src/views/maker.js:726, :773);
    a field's triggers (maker.js:774 "no control yet") and a summon's starting statuses (kit-parts.js:271 carries
    `sStatuses` with no control) are still not makeable.
11. Blocks the worth bar cannot estimate: still true, `Unweighed` in src/core/registry/worth.ts:162.
12. for-the-owner.md holds two sections twice: still true, lines 165/194 and 169/198.

## Rows (cause, change, test, commit)

1. Codex record. Cause U4 named: the record is a second write after the fight's. Finding: it is a named core step
   already (`recordDefeat`, bestiary.ts, through `store.apply`), refusing a row counted once (`codexSeen`), and it runs
   in the same task as the fight's write (combat.js `command` writes, then emits `combat:defeated` before it returns),
   while the store writes storage only after the next frame (store.ts `schedule`). A reload therefore keeps both writes
   or neither; only a throw between them could split them, and the end's `combat:end` records any row at 0 again.
   Folding it into `fought` was weighed: it needs the bestiary's list (seeds from the rules and custom monsters) and a
   new monster id inside the step, and the unlock toast needs the entry as it was, so the step would answer a record of
   what changed. That is more machinery for a split no reload can cause. No change; tests/bestiary.test.ts holds the
   step.
2. Per-row state in a view's Map. Cause: nothing named the containers a view keeps for the page, so `const tried = new
   Map()` (attempts by row id) looked like any UI value. Change: tests/lint.test.ts "every Map, Set, list or object a
   view keeps for the page is named here ..." (the `let` parser takes `const` too): every page-level container in
   src/views is listed with what it holds; the first case is the old `tried` line; 18 entries, each a screen choice, a
   drawing cache or a handle. Test: the rule's own sample (finds `tried`, `picks` and a module `{}`, not a function's
   Set) and the list matched against the views.
3. A failed backup at load. Cause: `pushBackup` answers false when storage is too full, and `load` ignored it, so the
   first write put a fresh save over the only copy of an unreadable or old text while the banner said it was in
   Backups. The same ignored false was in `keepMine` (another tab saved over this tab's unsaved change: the change was
   dropped from view and from storage while the banner said "is in Backups"), in `replace` (import, restore, reset went
   on and the toast said "Previous save kept in backups") and in io.js (Backup now said "Backup saved."). The daily
   backup's false is left: the save is still under its key, so nothing is lost. Change: the store's machine
   (store-life.ts) hears both answers. `Opened.backup` is `none | kept | failed`; a failed one opens `readOnly` with
   `loadUnkept` (no write, its own banner instead of the load's). `keepMine` is answered by `kept` or `keepFailed`
   from a new state `keeping`; only `kept` takes the other tab's save, `keepFailed` leaves the tab read-only showing
   its own (`mineUnkept`, banner: export it). `mayChange` is true only in `ready` and `noStorage`. The store's
   `importSave`, `restore` and `reset` answer `replaced` or `unkept` and change nothing on `unkept` unless called
   `anyway`; io.js asks "No backup saved ... anyway?" as hunter.js's Delete does. Tests: tests/store-life.test.ts (the
   two new reads, `keeping`, and the random model now lets a backup fail when storage is full: a change overwritten by
   another tab is in Backups or still shown under the `mineUnkept` banner); tests/e2e/save.e2e.ts three cases (a load
   with Backups refused leaves the text under its key; a second tab with storage full; Reset asking).
4. `isPlaceholder`. Cause: Add party guessed "never played" from the name "Hunter", level, XP, items and skills, so an
   unplayed hunter named otherwise joined the room's fight and a "Hunter" with gold, a job or quests was left out.
   Change: `untouched(h, R)` in src/core/party.ts: every field play changes equals what `newHunter(R)` makes; who the
   hunter is (id, name, emblem, color, seed mark), its change time and the daily quest every new hunter is given are
   not read. combat.js calls it; the name is never compared. The lead's rule kept: a better explicit one (a mark set
   where the GM makes a placeholder) has no place to be set, since the GM's spare hunter comes from first-run setup or
   from deleting the last hunter, both "a new hunter". Test: tests/party.test.ts "a hunter nothing was played on", a
   table of 13 rows (four untouched, nine played) and a key order case.
5. A skill label reading "Lv.n". Cause: whether a badge follows the level was read from the label's words with a regex
   in `levelUpSkill`; only the starter's skills carried "Lv.1", and the skill maker had no label control, so the fact
   had no maker. Change: the fact is where the skill is made. `label` is the GM's words, kept as written; null shows
   the level (registry/skills.ts's doc; the badge drawing in skills.js already read `label || Lv.n`). The starter's
   skills are made with no label (save.ts `starterHunter`), `levelUpSkill` changes only the level, and the skill maker
   has a Badge field (empty: its level; `parseSkill` already reads '' as null, the repair line). The lint's allow-list
   is gone and the old line is its third case. Tests: party.test.ts (Lv + leaves a label as written, "Lv.1" included,
   and no label stays none), save.test.ts (the starter's labels are null), lint.test.ts. A save made before keeps
   "Lv.1" as words on the starter's two skills (old saves need not keep working; the hunter does).
6. List overrides kept as written. Cause: `against` kept any list (and any null rule, and every entry of `rarities`)
   without reading its entries, so a GM's title with no name or a tier with an unknown bonus reached the game, and
   `merge`'s cast claimed a type nothing checked. Change: `parseOverrides` moved to src/core/overrides.ts (the reward
   readers it needs import the rules), with `READERS`: a reader per list rule (the rank DCs and the two-number ranges
   keep their length; titles, daily objectives, path tiers, jobs, slots, gate names, the daily reward's items, skills,
   statuses, boons, title and job; the rarities map, a new rarity needing both fields). An entry that is not the
   rule's shape is refused by its path (`titles.2`, reason `entry` or `length`), and gm.js words both. An optional
   field left out loads with its default (an objective's progress, a title's description and bonus). The daily
   template's rewards are typed `Rewards` in rules.ts (they were literal empties, `never[]`, so an override of them
   had no type at all). Not met: `merge`'s cast stays. A merge by key over a generic `T` cannot be typed without an
   assertion in TypeScript (writing `out[k]` of a `T` needs one, and `Reflect.set` or an overload only hides it), so
   the cast is now backed by a test: tests/overrides.test.ts walks RULES and fails on any list, null or open map with
   no reader. Tests: tests/overrides.test.ts (9 cases, the GM data without optional fields among them).
7. `MakerApi.open` answered `Promise<any>`. Cause: the shell's `save()` and `done()` were `unknown`, so the answer had no
   type to carry. Change: `MakerBody<T>`, `MakerShell<T>` and `MakerOptions<T>` in src/core/api.ts; `open<T>` answers
   `Promise<T | null>`, `T` being what the body's `save` gives; maker.js's `openMaker` is the same generic in JSDoc.
   The sweep found a second `any` the lint's regex missed, `export type KitFields = any`: it is now `{ stack?, triggers?,
   end? }` of the status def's own types. The lint's allow-list is empty and its regex sees a type alias to `any`; its
   cases are the old merge, the old `open` line and the old `KitFields` line. Test: tests/lint.test.ts "no any in
   src/core and src/edge", and the typecheck of the six makers' callers.
12. for-the-owner.md's two sections twice. Cause: a merge appended U2's and U3's sections a second time. Change: the
    second copies (they were the same text, checked with diff) deleted.
8. Save ids still `string`. Cause: U14 branded the ids its rows named; the rest kept `string`, so a skill's id and a
   loadout's, or a chain's and a fight row's (both made with the prefix `c`), could be passed for each other. Change:
   `SkillId`, `LoadoutId`, `BoonId`, `BundleId`, `ChainId` in ids.ts, and `MonsterId`, `GateId`, `MapId`,
   `CombatantId` moved there (each module that declared one re-exports it, as ability-types.ts already did with
   `HunterId`); `SaveIds` gains `s`, `lo`, `bn`, `rb`, `jc`, `m`, `g`, `mp`, so `store.id(prefix)` answers the brand.
   A chain's id now has its own prefix `jc` (quests.js and room-events.ts made it with `c`, the fight row's). Branded:
   `Skill.id`, `Loadout.id`, `Boon.id`, `RewardBundle.id`, `Monster.id`, a gate's `mapId`, `Quest.chainId`,
   `JobChain.id`, a shadow's `monster`, `CodexEntry.monsterId`, `codexSeen` (rows), `fightRefs` (a gate and
   rows to monsters), `Links`, `JoinRow.monsterId`, `Defeat`. At load each is read by its reader: a chain id by
   `parseSaveId<'jc'>`, a row id by the new `parseCombatantId` (the fight parser's own rule: a summon's row id is
   not in a save id's form), a gate and a monster reference by gate.ts's readers (`parseGateId`, now exported, and
   `monsterId`), a seed monster's id by the new `seedId`. One cast is left in a view: bestiary.js's card for a
   room codex entry no monster holds, with its reason. Test: the typecheck (tests/fixtures/ids.ts gains a reader
   per brand) and the existing tests of each module.
9. 23 type names exported by two modules. Cause: each module named its type for itself, so `Gate`, `Side`, `Sheet` or
   `Fired` meant two or three things and a reader had to check the import. Change: one thing is one export, `Stats`
   (stats.ts; save.ts's mutable copy deleted, the repair now builds the set with the new `statsBy` and keeps keys the
   types do not know, as the rest of the repair does). Two things get two names, the less used renamed for what it
   is: `FormulaBody`, `SheetBasis` (derive.ts; the save's `Build` is the build), `CodexDocEntry`, `CoinNatural`,
   `ReactionFired`, `TriggerFired`, `LandFired`, `AbilityGate`, `LinkHealth`, `PushedSheet`, `DrawnZone`,
   `GestureMode`, `LinkNotice`, `PushOff`, `LinkOff`, `PollPace`, `ParsedFormula`, `DueTurn`, `MoveReach`,
   `UseRefusal` (fight-types.ts already imported it under that name), `RoomSheet`, `CoinSide`, `HotbarSlot`,
   `StoredKeys`, `WorldParts`. The lint's list is empty. The renames were done by a script over each module and its
   importers; it also renamed three words inside strings and comments ("World day" in a log line, "Health" and
   "Stored" in comments), which I found in the diff and put back; the typecheck and the whole test run are the proof.
10. Einar's boundaries. Cause: the ability form had no control for a field's triggers (maker.js kept an existing one
    "as it came") nor for a summon's starting statuses (kit-parts.js carried `sStatuses` through untouched), so
    neither could be made on a phone; a field's upkeep and end were already made by 11f7d9f. Change: the trigger
    editor is one part, `triggerList` in kit-parts.js (taken out of `statusBlocks`, which now holds one), and the
    field group holds another ("When something happens to one inside it", fired for whoever holds the field, as
    kits design 1.3.2 says a zone's triggers are carried by its hold); the summon group lists its starting statuses
    (a status and its rounds, at most a row's `MAX_STATUSES`, each refused with words when its rounds are out of 1 to
    `summonRounds`). Tests: tests/e2e/kits.e2e.ts "a GM builds Einar's Harmony boundary ..." (a stacking Harmony made
    in the status maker; a field of 5 rounds whose turn-start trigger gives one inside a Harmony stack and whose end
    stuns; read back, the ability reader gives it back the same, and the maker opens it with its trigger and saves it
    equal) and "a GM gives a summon a status it starts with ..." (round trip as above). kits.e2e.ts: 10 passed.
    Not added to the kit examples: Einar's numbers (an upkeep in Aura, a size in feet) have no rule here, and an
    example's numbers are the simulation's.
11. The blocks the worth bar cannot estimate (`Unweighed`, worth.ts). Read the list (`UNWEIGHED_WORDS`); each block:
    - Weighed now, by a simple rule: `hasten` (its share), `delay` (its ticks over a standard action) and `extra` (1).
      The number: a standard action is the bar's unit by definition (1 SA), and the bar already weighs `refund`
      (time back to the user) as its share of an action. Time an ally gains or a foe loses is the same currency if
      that body does as much with an action as the user, which is the parity every budget of the bar is read at
      (design 3). What limits it: that parity. Against a foe much stronger than the user a delay is worth more, a
      weaker one less; the bar reads every block at parity, so this is the same error bar every other block has.
      Not tested against the simulation: no build of tests/models/fight-sim.ts plays a delay, a hasten or an extra
      action, and a calibration would need new kit rows whose numbers I would be choosing; the tests are the rule's
      (tests/worth.test.ts "time is weighed as a share of a standard action": 0.5 for a half hasten, a curse's land
      share for a delay of one action, 1 for an extra action, none named unweighed).
    - Left as "cannot estimate: test it in a fight", each because its worth is a fact of the fight the bar does not
      have: a count a formula reads (how many stacks, kills or rounds there will be), a channel's charge (how long it
      is held), a reaction (whether the hit it waits for comes), a summon (what a body the reducer plays does), a field
      and a zone act (who stands in it, for how long), a move (what the place is worth), an end with no delay (when it
      comes), a shield (how much damage comes while it holds), a hold, root or taunt (whether the held body's turn
      falls inside it; a hold shorter than its interval skips nothing), mana and fatigue (the rules give no exchange
      rate to an action), a cure and a dispel (the worth of what they remove), and the standing ops (a stat, a sheet
      change, a share, an edge, a guard, stealth, threat) whose payoff is the next roll's, which the bar does not see.
      For each, inventing a factor would put a number on the line no run backs.

## Decision trail

- Row 1: three shapes weighed. (a) Fold the codex record into `fought`'s `also`: one write, but the step needs the
  bestiary list, a monster id made inside it and an answer of what changed for the toasts. (b) Keep the event, one
  task with the write (chosen: the store writes storage a frame later, so no reload splits them). (c) Record in the
  reducer's effects: the fight would hold bestiary knowledge it has no business with.
- Row 3: what a failed backup at load leads to. (a) Open ready and tell (the first write destroys the only copy).
  (b) Open read-only with its own banner (chosen: nothing is lost, Reset is the explicit way past it). (c) Skip the
  write until the next change (the same loss one tap later). For `keepMine`, a transient `keeping` state rather than
  flags in the store, so the machine (not the edge) decides that a failed keep does not take the other tab's save.
- Row 4: the lead's rule, `untouched(h)`, was kept; a mark set where a placeholder is made has no maker (row 4 text).
- Row 5: a field `label` meaning the GM's words with null for the level, rather than a second boolean beside it (one
  field cannot disagree with itself).
- Row 6: readers in a table keyed by the rule's path, rather than a schema of RULES written again (the shipped value
  still reads every number, flag and text); a test walks RULES so a new list cannot slip past.
- Row 7: generic `open<T>`; the alternative (each maker its own `open` type) repeats the shell's signature six times.
- Row 8: a row id is not in a save id's form (a summon's is `c12~400-1`), so `CombatantId` is not in `SaveIds`; it
  has its own reader. Gate and monster references keep gate.ts's readers (tests and gates name `g-den`, `m-goblin`).
- Row 9: for each pair, rename the less used one for what it is; `Stats` was one thing twice and is now one export.
  The renames were scripted (TypeScript 7 ships no language service API here, so a rename tool on it was not
  possible); the script also changed three words in strings and comments, found in the diff and put back.
- Row 10: one trigger editor shared by statuses and fields rather than a copy for fields (subtract before you add).
- Row 11: only the time ops have a rule that does not need a fact of the fight.

## Principles that changed a choice

- principle-fix-root-causes: row 3 is fixed where the answer is dropped (the store's machine), and the same dropped
  answer was swept in `keepMine`, `replace` and io.js; row 5 deletes the regex rather than allowing it.
- principle-model-the-domain: row 3's `keeping` state and the two read-only reasons; row 5's one field.
- principle-type-system-discipline: rows 7, 8 and 9 (a generic over the body's answer, a brand per id kind, a name
  per thing); row 6 typed the daily template's rewards as `Rewards` (they were `never[]`).
- principle-boundary-discipline: row 6 reads each list entry at the boundary and row 8 brands each id at load.
- principle-subtract-before-you-add: row 10 extracted the trigger editor before adding the field's.
- principle-explain-the-number: row 11 names the limiter (parity) and does not invent a factor for the rest.
- principle-test-behavior-not-implementation: row 4's table states what play changes; row 11's expected values come
  from the unit's definition, not a run.
- principle-prove-it-works: kits.e2e.ts and save.e2e.ts run after their rows (10 and 17 passed, one finding below).

## Findings while checking

- save.e2e.ts's new full-storage case failed once: its check for "no Another tab saved banner" matched the new
  `mineUnkept` banner, whose words begin the same. The app was right; the check now names words only the Backups
  banner has ("is in Backups"). Commit 6b0a7d6.
- The first whole `bun run test` (started 14:53) had 88 failures, all in server-rooms.test.ts, every one a 426: the
  build id is a hash of src, and I edited src (row 10) while it ran, so the test's build and the server's differed.
  Rerun at the end with no edit beside it.
- Process: a whole `bun test` was started by mistake at about 14:44, five minutes inside the lead's quiet window
  (14:18 to 14:49). It could not be stopped from here; it finished on its own.

## Left, and why

- `merge`'s cast in rules.ts (row 6): TypeScript cannot type a merge by key over a generic `T` without an assertion;
  the cast is backed by tests/overrides.test.ts.
- The daily backup's failed push is not told: nothing is lost (the save stays under its key).
- The old saves' starter skills keep "Lv.1" as words (row 5); old saves need not keep working.
- The re-exports `export type { GateId, MonsterId }` (gate.ts), `MapId` (maps.ts) and `CombatantId` (ability-types.ts)
  stay so their 40 importers did not move in this unit; ability-types.ts already re-exported `HunterId` this way.

## Checks (after the lead's push landed, no edit running beside them)

- `bun run deps -- --write` and `bun run charts`: no change after the last code commit.
- `bun run typecheck`: `$ tsc --noEmit && tsc -p tsconfig.views.json --noEmit` (no errors).
- `bun run test`: `Ran 3358 tests across 89 files. [309.65s]`, 3355 pass, 3 skip, 0 fail.
- Browser sweep, every file but feel, one at a time, port 3232: 30 of 30 files passed whole, 306 cases, no failure
  and no flaky case.
