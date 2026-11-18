# Notes: U14, ids and kinds

The goal (the owner): "Everything must be explicit. Everything." and "fix the problem and not the symptoms". U14's
problem: an id, a kind or a result is carried as a bare string or worked out again from words on the screen, so the
compiler cannot tell a hunter's id from a room code and a view guesses a roll's kind from its label. The smallest change
expected to meet it: one brand for ids, the save's ids branded at load, and each fact of a roll (its hunter, kind, DC and
success) stored where it is made, with the regexes and name lookups that guessed it deleted.

Started 12:24 UTC Nov 15, main tree, branch claude/zen-pasteur-ov4cgd at e37b8f2. No browser before 12:59.

## Step 0: the inventory again (at e37b8f2)

| Row | Now |
|---|---|
| 23 | still true. dice.js:103 logs `who` (a name, or 'GM') and no hunter id; table.js:591 finds the roll's hunter by `x.name === entry.who`; coin.js:57 `byOf` finds the caller by `h.name === c.who`; save.ts:145 `RollEntry` has no hunter id |
| 24 | still true. table.js:17 `HEAL` and :594 `/damage|dmg|attack|strike/` on the label decide `dmg`; :613 the GM side runs `HEAL` again. No roll the app makes carries such a label (Dice view rolls have none; the others are checks, a death save, a d20 and `Extract <monster>`), so the only rolls that offered Apply were an extraction of a monster whose name holds attack or strike |
| 27 | still true. sync.ts:715 `event(type: string, body: unknown)` casts both `as never`; api.ts:505 types it so |
| 57 | still true. gm.js:87, 258, 275-276, 729: targets are 'l:<id>' and 'r:<key>' strings split by prefix |
| 59 | still true. gm.js:524 compares `l.at > seen` as ISO strings; bestiary.ts:52 and :80 order codex entries by `lastAt` strings |
| 78 | still true. dice.js:117 works out success (natural 20, natural 1, total against the DC) in the view |
| 79 | still true. dice.js:124 `verdict` is a closure value; the roll entry holds no DC or success |
| 87 | still true. ids.ts and ability-types.ts each declare a brand symbol (as do gate.ts, maps.ts, link.ts, fight-types.ts, effect-ops.ts, zones.ts, space.ts, timeline.ts, derive.ts, coin.ts); save.ts's hunter, item, quest, title, shadow and log ids and `SyncSettings.room`, `gmKey`, `deviceId` are `string` |
| 88 | still true. effect-ops.ts:27 `StatusKey` (a brand) and registry/statuses.ts:62 `StatusKey` (`keyof STATUSES`, imported as `BuiltInStatus` by monsters.ts and abilities.ts) |
| 89 | still true. imported.ts:32 casts each copied hunter `as unknown as Hunter`; it becomes one only when the store's repair runs |
| 90 | still true. rules.ts:342 `merge(base: any, ...): any` |
| U13's codex rule | still true. bestiary.js:64 `keyOf(name, rank)`, :129 `recFor(m)` by name, :79, :105, :136-137, :445, :485 look monsters up by name |
| U10's `lastAt` | still true (row 59's class), bestiary.ts:52, :80 |
| U5's `dueAt` | already done: 456d3b3 (U11) reads `dueAt` with `timeOf` at load, with cases in tests/save.test.ts. Quest ids are still `string` (row 87) |

## Rows (cause, change, test)

**Row 87 and 88: one brand, the save's ids branded at load.** Cause: each of eleven modules declared its own brand
symbol, `RemoteKey` and `SheetKey` were one id under two names, and the save's ids were `string`, so a room code, a
hunter id and a quest id were one type to the compiler. Change: `src/core/ids.ts` holds the one `Brand<T, 'Name'>` and
`Id<'Name'>`; every module imports them (a codemod, scratchpad `brand.ts`). `RemoteKey` is gone (`SheetKey`); the
registry's `StatusKey` is `BuiltInStatus`. The save's hunter, quest, title, shadow, item, log and roll ids are
`HunterId`, `QuestId`, `TitleId`, `ShadowId`, `ItemId`, `LogId`, `RollEntryId`, made only by `saveId(prefix, n)` (the
store's `id`, the repair, the core id makers) and read by `parseSaveId`; `SyncSettings.room` is a `RoomCode`, `gmKey` a
`GmKey` (moved to ids.ts with `parseGmKey`), `deviceId` a `DeviceId`, each read by its parser at load. What names an
entity (active hunter, bound hunter, a log line's hunter, a chain's or penalty's quest, the tombstone's hunter) is a
branded id. Tests: tests/save.test.ts "the ids a save keeps are read at load"; the typecheck. Test ids come from
`tests/fixtures/ids.ts`, each through its parser, so a test holding an id the app refuses fails (it found `q-den`,
`qa`, `'none'`, a five-letter room code).

**Row 27: a typed `event`.** Cause: `sync.event(type: string, body: unknown)` cast both `as never`. Change:
`event<K extends EventType>(type: K, body: EventBody<K>)`. The typecheck then found five bodies the views had wrong:
a step without `dash`, awards with a partial `rewards` (combat.js's `encounterAwards` in core, gates.js, custom.js), a
build change typed loosely, and two `myKey(hid)` calls with a string. `myKey` takes a `HunterId` and answers a
`SheetKey` (`sheetKeyOf`); `remoteSheets` reads each key once with `deviceOf` and `hunterIdOf` (it had its own
`/^(d-[a-z0-9]+):(.+)$/`). `build.gmMenu(key, raw)`, where the key was a hunter id or a sheet key by whether `raw` was
given, takes a `HunterRef`.

**Rows 23, 24, 78, 79: a roll's hunter, kind, DC and success.** Cause: the roll entry held only `who` (a name), so
table.js found the roll's hunter by name and coin.js the caller by name; `dmg` was a regex on the label; a check's
success was worked out in dice.js and kept in a closure. Change: `RollEntry` holds `hid`, `kind` (`check`, `die`,
`other`, src/core/roll.ts) and `check: { dc, success } | null`, set by dice.js as it rolls; `checkResult` in core;
callers pass `hid` (a death save, the d20, an extraction) instead of `who`, and `who` is drawn from the hunter. The coin
holds its hunter as a `HunterRef` (`{ kind: 'local', hunterId }` on a player's coin, `{ kind: 'remote', remote }` on a
call the GM holds), so `byOf` reads it. The audit's `damage` and `heal` kinds: no roll the app makes is either (the
Dice view has no label; the labelled rolls are checks, a death save, the d20 and `Extract <monster>`), so the feed's
"Apply N" offered itself only for an extraction of a monster whose name held attack or strike. The `dmg` field, the two
regexes, the Apply control and `combat.targets` (its only caller) are deleted (for-the-owner). Tests: tests/check.test.ts
(new), tests/save.test.ts (the roll entry's repair, a coin without a hunter dropped), tests/coin.test.ts.

**Row 57: the GM's targets.** Cause: 'l:<id>' and 'r:<key>' strings split by prefix. Change: `targetList()` answers
each target as a `HunterRef` with the id its checkbox carries; `picked()` reads the refs back through the list.

**Row 59 and U10's `lastAt`: times compared as numbers.** Cause: ISO strings compared as text in gm.js, bestiary.ts
(twice) and, by the sweep, quests.js and gates.js. Change: `compareTimes` in src/core/day.ts. Test: tests/day.test.ts
(09:00 at UTC-2 is after 10:00 UTC, which the text says is earlier).

**Row 89: imported hunters.** Cause: `withImportedHunters` took raw records and cast them `as unknown as Hunter`. The
file was already read by `parseSave` (io.js passes `got.hunters`), so the step takes `Hunter[]` and renumbers typed
fields; no cast. Bug found on the way: the penalty's and the Job Change chain's quest ids were not moved with the
quests, so an imported hunter in a Penalty Zone lost the penalty at the next repair and one mid chain had it failed.
`penaltyMoved` (penalty.ts) and `chainMoved` (job-chain.ts) move them. Test: tests/identity.test.ts.

**Row 90: `merge` typed.** `merge<T>(base: T, ov): T` with one cast at its end, no `any`. Left: `parseOverrides` keeps
a list as written, without checking its entries against the rule's (below).

**U13's codex rule.** Cause: `keyOf(name, rank)` and `recFor` by name lived in bestiary.js. The codex key is a monster
kind across phones (the room's codex doc carries it), so a name and rank is its identity, not a guess: it is a
`CodexKey` with one maker `codexKey` in core, and `recordOf`, `recordKeyOf`, `monsterOfKind`, `playerShelf` are the
rule in src/core/bestiary.ts. Test: tests/bestiary.test.ts.

**U5's `dueAt`:** done by U11 (456d3b3); quest ids are branded above.

**U5's day key (left to U14 by U5's notes):** a day key is a `DayKey` (day.ts, `parseDayKey` at load). The rollover
compared `lastCheckedKey < today` as text; it is `dayGap(...) > 0` now. Commit faa3042.

## The class sweep

- Name lookups over hunters, monsters and rows (`.find(... .name ===`): table.js and coin.js (rows 23), none other.
  Titles, reward bundles and shop items are found by name on purpose: the rules' titles and the shop's items have no
  id, a name is their key (left). combat.js `isPlaceholder` (Add party skips a local hunter named "Hunter" at level 1
  with nothing) guesses "never played" from a name and fields; no fact records it, and which local hunters join a
  room's fight is a product call: left, flagged.
- A regex on a label or a name that decides behaviour: table.js's damage and heal regexes (row 24); spawn.ts's
  placeholder regex on a monster's name, fixed: a monster the spawn makes carries `placeholder: true` (parseMonster
  keeps it), so a GM's own monster named "C-rank Gate Monster" is the GM's own (tests/spawn.test.ts,
  tests/monsters.test.ts). Left: skills-held.ts lets a skill label that reads "Lv.n" follow the level; the label is
  the GM's words and only those words change (named in the lint's list).
- `as never`, `as any`, `as unknown as`, `any` in core and edge: sync.ts's `event` (row 27); land.ts read a tier
  through `Parameters<typeof atTier>[0]` (unknown) and cast `as never`: typed `Tiered<Formula>`. Left with reason:
  the tables' dispatch lines; save.ts `refill` and fight-parse's six-tier tuple (`as unknown as`, the boundary readers
  building a typed value from checked parts); `MakerApi.open` answers `Promise<any>` (each maker types its own answer;
  typing it is a generic over the maker body, the makers' unit).
- Two types with one name, or one id under two names: `RemoteKey`/`SheetKey`, two `StatusKey`, two `SheetKey`
  (derive.ts's is `SheetNumber` now), two `Rank` with two `RANKS` lists (save.ts re-exports rules.ts's), two `Random`.
  23 names stay exported twice for two things that never meet; the lint lists each with what each is.
- A time compared as text: gm.js, bestiary.ts (row 59), quests.js (finished quests' order), gates.js (another GM
  phone's world doc), the rollover's day keys. `RemoteSheet` parsed its key with its own regex: `deviceOf`, `hunterIdOf`.
- Found by the typed `event` (row 27): five room bodies the views built wrong (above).
- effects.js built an `outward` list of damage for "the room's roll feed", which nothing read: deleted (acbd203).

The kind 5 lint tests are at the end of tests/lint.test.ts, each with the old line as its first case.

## Decision trail

- The audit's roll kinds `damage` and `heal`: deleted the feed's Apply instead of adding a kind nothing sets. Three
  options weighed: (a) add a Damage choice to the Dice view that sets `kind: 'damage'` (a feature no row asked for);
  (b) keep `damage` in the union with no maker (a variant that cannot occur, the implicitness the unit removes);
  (c) delete the control no real roll reaches. (c), flagged to the lead and in for-the-owner with how to reverse it.
- The codex key: name and rank is the identity of a monster kind across phones (the GM's codex doc carries only it),
  so it is branded and made in one place rather than replaced by a monster id, which means nothing on a player's phone.
- `withImportedHunters` takes `Hunter[]`: the file is read by `parseSave` before it (io.js), so reading each hunter
  again inside the step (the audit's wording) would read it twice; the step renumbers typed values instead.
- `merge` keeps one cast: proving the overrides are a `DeepPartial<Rules>` needs `parseOverrides` to read each list's
  entries against the rule's; the lists are kept as written today (left).
- One code commit for the rows: save.ts, api.ts, sync.ts and the views each carry parts of several rows, and a commit
  by path cannot split a file. The lint, the docs and the later sweep fixes are their own commits.
- Principles read and applied: type-system-discipline (one brand, branded save ids, `HunterRef` for gm.js's targets,
  the coin's hunter and `gmMenu`'s key-or-id); model-the-domain (a roll's facts set where it is rolled; the codex rule
  as functions over the codex in core); boundary-discipline (ids parsed at load and at the room boundary, then
  trusted; test ids through the same parsers); fix-root-causes (the name lookups and label regexes deleted, not
  guarded; the import's lost penalty fixed at the renumbering); migrate-callers-then-delete (`RemoteKey`, the
  registry's `StatusKey`, `combat.targets`, `outward` deleted in the same change as their callers);
  prove-it-works (the checks below).

## Process

- At 12:36, inside the 35 minutes the lead asked to keep quiet, I started the whole `bun test` by mistake (chained
  after a typecheck); it ran to the end (5 minutes) and I could not stop it. No browser ran before 13:06.

## Browser sweep (13:06 to 13:50, every file but feel, one at a time, port 3231)

27 of 30 files passed whole on the first run. Each failure, with its cause named before anything changed:

- character.e2e "Taking XP back removes the ability points...": its `awardXp` tapped `input[data-sel="l:<id>"]`, the
  'l:' target string row 57 removes; the checkbox carries the hunter's id now. Selector updated (9298b48), with
  gates-quests-dailies' copy of it.
- gates-quests-dailies.e2e "ability points and the HP refill cannot be farmed...": the same selector. My edit of it
  landed while that file was starting, so the run read the old line (rerun below).
- coin.e2e "the player's phone holds nothing that tells a ruling from a flip": it pinned a stored coin's keys; a coin
  now holds `hunter` by design (row 23). The key list takes it, and a new line checks that it names only the hunter.
- table-session.e2e "a player's damage roll the GM applied from the Table feed stays applied...": the test of the
  Apply control this unit deletes; it injected a roll event with `dmg: true`, which no phone could send. Deleted with
  the control (bc688b8).
- battle-map.e2e ran before the day key commit (its server bundled the earlier tree): rerun below.

## Left, and why

- combat.js `isPlaceholder`: "Add party" skips a local hunter named "Hunter" at level 1 with nothing, when players
  are in the room. It guesses "never played" from a name and fields. No fact records it, and which of the GM's own
  hunters join a room's fight is a product call (for the lead).
- skills-held.ts: a skill label that reads "Lv.n" follows the level. Making it a fact means a skill stores whether its
  label is its level, a field of the skill maker's; named in the label lint's list.
- `parseOverrides` keeps a list override as written, without reading its entries against the rule's; so `merge` keeps
  one cast. Reading lists of objects (titles, path tiers, the daily template) against the first entry would refuse
  real GM data that differs in an optional field; it needs a reader per list.
- `MakerApi.open` answers `Promise<any>`: each maker types its answer; a generic over the maker body is the makers'
  work. Named in the `any` lint's list.
- Save ids still `string`: skill, loadout, boon, reward bundle, battle map, a GM monster (`Monster.id`; gate.ts has a
  `MonsterId` the save does not use yet), a quest's `chainId`, a shadow's `monster`, `codexSeen`, `fightRefs`. The
  audit named hunter, item, quest, title, shadow and log, done here with rolls; the rest follow the same recipe
  (a prefix in `SaveIds`), each a typecheck-led change.
- 23 type names stay exported by two modules for two things that never meet; the lint lists each with what each is.
- `sheetKeyOf` trusts that a device id and a hunter id fit the 40 characters a sheet key may have: this phone's ids
  (`d-` and six characters, `h` and a number) do; a hand-edited save with a long device id would be refused by the
  server, as before.

## Checks (14:10 UTC, on the last code commit)

- Reruns: character 23 passed, coin 7 passed, gates-quests-dailies 24 passed, table-session 6 passed, battle-map 20
  passed, combat-turns 17 passed (it started while the day key commit was being written).
- `bun run deps -- --write`: wrote docs/dependency-map.md. `bun run charts`: wrote docs/state-machines.md (unchanged).
- `bun run typecheck`: `$ tsc --noEmit && tsc -p tsconfig.views.json --noEmit` (no errors).
- `bun run test`: `Ran 3327 tests across 88 files.` 3324 pass, 3 skip, 0 fail.
