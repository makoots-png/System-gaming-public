# Architecture check, principle by principle

- **Date:** 20 November 2026.
- **Read at:** `511a58b` (branch `arch-check`).
- **Goal (the owner):** "reread the pstack skills and see if there's anything useful to apply them to to check our architecture." Architecture first, everything explicit, and a mistake obvious where it happened and how to fix it.
- **Method:** for each principle skill, one or more checks a script runs over `src/` and `server.ts`. The scripts are in `docs/audit/arch-check/`; each says at its top what it looks for. `bash docs/audit/arch-check/run-all.sh` runs them all. Each hit was read. Before a finding was kept, `docs/audit/2026-11-20-ranked.md` and `docs/audit/2026-11-20-fable-review.md` were grepped for its file, function and behaviour; a finding already there is named, not repeated.
- **Scale:** `docs/audit/2026-11-20-ranked.md`. 10 breaks the site. 0 changes nothing a user sees. Only 6 and above get fixed. An architecture finding with no symptom of its own scores 0 or 1; one that causes a scored bug takes that bug's score.
- **Ran** means a script called the real code and printed the fault. **Read** means inferred from the code.
- **Baseline:** `bun run test` with the scripts in place ends `4562 pass, 0 fail` (the scripts are typechecked with the rest).

## Result

No finding scores 6 or above. The code is in good shape on most principles: the room server, the room messages and the publish machine are idempotent and separated; JSON is parsed at boundaries; no core module with five or more importers lacks a unit test.

The one pattern worth fixing is that a held copy of a thing (a skill, an item, a shop item, a written title) does not record what it was made from, so the code matches copies by their words. That gives three new bugs here (BN-1 to BN-3) and is also the root of two ranked ones (BUG-rules-27, AW-gates-5). The lint that holds "found by its id" covers hunters only.

| Score | Count | Findings |
|---|---|---|
| 4 | 2 | BN-1, MD-1 (the root of BN-1 to BN-3; one fix closes all three) |
| 3 | 2 | BN-2, BD-1 |
| 2 | 2 | BN-3, SS-1 |
| 1 | 3 | BN-4, TY-1, LV-1 |
| 0 | 6 | BN-5, MD-2, BD-2, RL-1, LG-1, SB-1 |

## The required check: things found by their words

**Check:** `bun docs/audit/arch-check/by-name.ts`. It finds every line that compares, keys, lists or builds a key from a `name`, `title` or `label`. A hit is cleared only in its `CLEARED` table, with the reason: a name clash refused or suffixed on save or import, a search box, a typed name read once, a parser, a compile-time name union, or a DOM or token field. A hit that is a finding is named in its `FINDINGS` table. A new hit prints as `NEW, not judged yet`. Today: 16 hits to judge, all named below; 45 cleared.

`bun docs/audit/arch-check/demo-by-name.ts` runs the real core functions for BN-1, BN-2 and BN-3 and prints `FAULT` for each.

Cleared by design, with the reason in the script: the codex key (`bestiary.ts:29`, a room-wide monster kind made of name and rank, since ids differ per phone; an entry naming a monster by id wins), a zone act picking among its own user's zones by the name the GM gave the act (`zones.ts:314`, `:365`), and a typed title name that brings a built-in title's key (`rewards.ts:131`). A monster row's pins are keyed by its monster's name (`map-view.ts:739`); its comment says so on purpose, so a pack's rows share pins.

Already in the ranked list, not repeated: `pack.ts:237` (AW-gates-5; `mergeNamed` does the same for items, skills, rewards, stories and monsters, not only maps) and the bag's stacking key (BUG-rules-27).

### BN-1. A given skill replaces a held one of the same name. Score 4. Ran.

- **Where:** `src/core/hunter/skills-held.ts:26` (`giveSkill`), called by `src/core/hunter/grant.ts:160` for each skill of a reward.
- **What a player sees:** a hunter raised "Iron Will" to Lv 5 with Lv + and gave it a badge. The GM's reward (a bundle, a quest, an award) gives "Iron Will" from the library. The skill goes back to Lv 1, loses its badge, takes the library's words and spelling. Nothing says so. Demo output: `s1 iron will Lv1 badge=null`.
- **Why 4:** a GM reusing a bundle for a party where one hunter already learned its skill is a real session. Lv + is a free tap, so the level can be put back by hand, but the player must notice first.
- **Fix:** architecture, MD-1 (a held skill records the library id or built-in key it came from; a gift of the same source raises nothing and keeps the hunter's level and badge, or the GM is asked). Types: `Skill.from: SourceRef`. Lint: by-name.ts as a test.

### BN-2. A shop item is edited by its name. Score 3. Ran.

- **Where:** `src/views/inventory.js:218` passes `item.id || item.name` (a shop template has no id) to `src/core/hunter/inventory.ts:160` (`writeShopItem`), which finds the first item of that name. Remove and Buy use the row's index.
- **What a GM sees:** the shop holds two items called "Ration" (a common and a rare one; the shop lets the GM add a second of a name). The GM taps Edit on the rare one and sets its price. The common row is overwritten with the edit; the rare row the GM tapped is unchanged. Demo output: `rare 999, rare 200`.
- **Why 3:** needs two shop items of one name. Easy to see and to undo.
- **Fix:** architecture: a shop item gets an id like every other library list (`ItemTemplate` in the shop becomes `ShopItem` with `id`). Types: `writeShopItem(shown, id: ShopItemId | null, it)`. Lint: by-name.ts.

### BN-3. A written title is held, and replaced, by its words. Score 2. Ran.

- **Where:** `src/core/hunter/record.ts:64` (`holdsTitle`) and `:71-72` (`titleNamed`). A rule title is found by its key since H6; a GM's written title has no key.
- **What a player sees:** a reward gave "Slayer" (+1 STR). A later reward gives "Slayer" with +2 STR. The second does nothing: the hunter keeps +1, and nothing says the title was not changed. A `replaces` that names a title by words also hits the first of that name. Demo output: `t1 Slayer {"str":1}`.
- **Why 2:** needs a GM to reuse a title's name with new words.
- **Fix:** architecture, MD-1: a written title records the reward or bundle it came from, as a rule title records `seedKey`. Lint: by-name.ts.

### BN-4. Zones are matched by exact name. Score 1. Read.

- **Where:** `src/core/combat/triggers.ts:133` (`insideZone`): a trigger's "stands in a zone of the name" matches any zone of that exact name, case and all, whoever made it. `src/views/map.js:758`: the legend shows one row for two zones of one name.
- **What a GM sees:** a trigger written for "Burning Ground" never fires in the maker's default "Burning ground", with no warning; two skills that both make "Fog" each set off the other's triggers.
- **Why 1:** a trigger's zone condition has no maker field today (`src/views/kit-parts.js:66` carries `need` through as it came), so only a pack or a hand edit sets one.
- **Fix:** types: a zone carries the id of the ability part that made it, and a trigger names that, chosen from a list. Lint: by-name.ts.

### BN-5. Built-in items have no key. Score 0. Ran (by the tests).

- **Where:** `src/core/registry/bundles.ts:71` and `src/core/registry/feats.ts:20` find a shop item by its literal name with `!`; `src/core/save.ts:555-556` list the starter's skills and items as `readonly string[]` of names; `src/views/skills.js:311,315` and `src/views/bestiary.js:260,321` carry a built-in skill in a picker as `seed:<name>` though `SKILL_SEEDS` has keys.
- **What the next engineer trips on:** a rename of "Health Potion" or "Sprint" in the registry. The test suite catches it today (`tests/save.test.ts:245`, and a module-load throw), so no user sees it.
- **Fix:** types: `SHOP_ITEMS` and `LOOT_ITEMS` become records keyed like `SKILL_SEEDS`; the starter lists become `readonly (keyof typeof SHOP_ITEMS)[]`; pickers carry the key.

## Model the domain

**Checks:** `bun docs/audit/arch-check/model-domain.ts`. (1) Each discriminant value (`x.kind === 'remote'`) and how many files branch on it. (2) Each core type with three or more boolean fields. (3) Each state-like field of core typed as a plain string. Plus the by-name check above, which is a model question: what is a thing's identity.

### MD-1. A held copy does not record what it was made from. Score 4 (BN-1). Ran.

- **Where:** `Skill` (`src/core/registry/skills.ts:32`), `Item` and `ItemTemplate` (`src/core/registry/items.ts:142`), the shop's templates, and a written `Title` (`src/core/hunter/record.ts`). Only a rule title records its source (`seedKey`).
- **What it causes:** the code needs to know "is this the same thing?" in five places and answers by words: BN-1 (gift of a skill), BN-2 (shop edit), BN-3 (titles), BUG-rules-27 (a bag stack, ranked 6) and AW-gates-5 (pack Replace, ranked 2). The next feature that asks the same question (trading an item, a party stash) will add a sixth.
- **Fix:** architecture: one `SourceRef` (`{ kind: 'builtIn', key } | { kind: 'library', id }`) set where a copy is made (`learnSkill`, `itemOf`, `giveTitle`, `writeShopItem`), and every "same thing" question asks it. Types: a branded id per library list (most exist in `src/core/ids.ts`). Lint: by-name.ts turned into a test of `tests/lint.test.ts`, its `CLEARED` table the list of allowed reasons. The ranked BUG-rules-27 fix should use the same field, or it will invent a second answer.

### MD-2. Views branch on union kinds with no exhaustiveness. Score 0. Ran.

- **Where:** `.kind === 'hunter'` in 18 files, a holder's `'remote'` in 16 and `'local'` in 14, a reaction's `.state === 'holding'` in 9 (three of them views: `combat.js`, `map.js`, `table.js`).
- **What the next engineer trips on:** a new row kind or holder kind. Core can be made to fail at compile time with a `switch` and `never`; the views are JavaScript and fall silently into an `else`.
- **Fix:** architecture: a view asks core one derived question (`rowFacts(row)`: whose it is, who commands it, what it shows) instead of testing `kind` itself.

Nothing else found. The booleans that look like a pair (`adv` and `dis`) are resolved in one place (`src/views/dice.js:92`); none of the state-like string fields holds a machine's state.

## Type system discipline

**Checks:** `bun docs/audit/arch-check/types.ts`. (1) A parameter or field named for an id of a branded kind (`hid`, `qid`, `itemId` and so on) typed as `string`. (2) Casts per core file. (3) A lookup asserted present with `!`.

### TY-1. Ids of branded kinds are plain strings at core function boundaries. Score 1. Ran.

- **Where:** 111 hits. `src/core/api.ts` 47 (every `hid: string`), `src/core/hunter/quests.ts` 9, `src/core/gates/pay.ts` 8, `src/core/hunter/grant.ts` 7, `src/core/hunter/inventory.ts` 5. For example `finishQuest(save, hid: string, qid: string, ...)` at `grant.ts:236`.
- **What the next engineer trips on:** `finishQuest(save, qid, hid)` compiles. `src/core/ids.ts` already brands `HunterId`, `QuestId`, `ItemId` and the rest; the brand stops at the function that should check it. No swap was found today.
- **Fix:** types: these parameters take the brand. Lint: "an id parameter is typed with its brand" (check 1 of types.ts, with its table of names).

Casts: 5 `as unknown as` and 221 `as X` in 82 core files, mostly ids being made in `ids.ts` and parsers; nothing found to act on. The `!` lookups are on maps built from the same rows a line before, and safe; `src/core/gates/solo.ts:328` and `:337` find again what `soloReady` already found (RL-1).

## Boundary discipline

**Checks:** `bun docs/audit/arch-check/boundary.ts`. (1) Every `JSON.parse`. (2) Shape guards in views on data the api already typed. (3) Views that import the wire module. (4) Shape tests in core modules that are not parsers.

### BD-1. Parsers read the shipped rules; the game reads the GM's. Score 3. Ran.

- **Where:** the library's statuses at load (`src/core/save.ts:323`, `BASE_RULES`), a room doc's status defs (`src/core/protocol.ts:736`, `:949`), an item's or skill's worn status and ability (`src/core/registry/items.ts:250,255`, `src/core/registry/skills.ts:95-100`), a reward's status (`src/core/rewards.ts:82,93`), a monster's start stacks (`src/core/registry/monsters.ts:258`) and a pack (`src/core/pack.ts:168,175`). The Forge reads with the GM's rules (`src/views/effects.js:39`).
- **What a GM sees:** the GM raises "the most stacks a def holds" from 20 to 40 (its domain is 1 to 99) and makes "Rage" with a cap of 30. It works until the page reloads; then Rage's cap is 20. A player's phone reads it as 20 at once from the fight doc's defs. The same holds for each kit bound a parser reads with the shipped rules (for example `fightUses` at `protocol.ts:889`). Demo: `bun docs/audit/arch-check/demo-rules-bound.ts` prints `Rage cap in the Forge: 30; after a reload: 20`.
- **Why 3:** a GM must raise a kit bound, which is rare; the result is wrong but visible.
- **Fix:** architecture: split the two meanings. A parser's bound is a hard limit of the data (a `LIMITS` table, constant, like `repair.ts LIMITS`); a GM's rule is a game number inside it, and each kit bound's domain ends at its limit. Types: parsers take `Limits`, not `Rules`, so `parseStatusDef(v, RULES)` cannot be written. Lint: no parser module imports the value `RULES`.

### BD-2. Two guards in a view re-check typed data. Score 0. Ran.

- **Where:** `src/views/quests.js:411` (`typeof r.data === 'object'`) and `:477` (`Array.isArray(sh.data.quests)`, `typeof q.title === 'string'`). `RemoteSheet.data` is a parsed `Hunter` (`src/core/api.ts:596`).
- **What the next engineer trips on:** the guards suggest the room's sheet is not parsed, and a reader goes looking for a second parser.
- **Fix:** delete the guards.

Nothing else found. Every `JSON.parse` either hands its value to a parser on the next line (`gm.js:579` to `parseOverrides`, `io.js:169` to `store.read`, `server.ts:430`) or is a deep copy. The five views that import `protocol.ts` take a constant or a pure rule (`DOC_MAX`, `onTurn`, `useRoute`), not a wire shape. The shape tests in core sit in each module's own parser.

## Minimize reader load

**Checks:** `bun docs/audit/arch-check/reader-load.ts`. (1) Api members that hand the same arguments on to one function. (2) Modules over 600 lines with their `let`s and functions. `bun docs/audit/arch-check/map-checks.ts` part 4 lists the 85 api members one module calls.

### RL-1. `soloRan` finds again what `soloReady` found. Score 0. Read.

- **Where:** `src/core/gates/solo.ts:328` and `:337` look up the gate with `find(...)!` after `soloReady` (`:309`) checked it.
- **What the next engineer trips on:** two lookups of one gate, one asserted; a reader must check they agree.
- **Fix:** `soloReady` answers the gate it found.

Nothing else new. Only two members pass through (`quests.complete`, declared test-only in `tests/deps.test.ts:22`, and the maker's `value`). The big view files are AW-views-4 (ranked).

## Separate before serializing shared state

**Checks:** `bun docs/audit/arch-check/shared-docs.ts`: each room doc, its publisher and its readers, and each device memory key named by more than one file. The server's write path was read: a room's events take a seq under the room's row lock and an event id is held once (`server.ts:271-281`); sheets are keyed by device and hunter.

### SS-1. Two GM phones overwrite each other's codex, rules, feats and solo docs. Score 2. Read.

- **Where:** `src/edge/sync.ts:808-818` (`publishNow` puts a doc whenever this phone's copy differs from the room's) with `src/core/sync/publish.ts:5-6` (a put is tried again at the next change or poll). The world doc has a merge on a GM phone (`src/views/gates.js:167`; its same-millisecond case is SM-gates-3) and the fight has a confirm (`src/views/combat.js:225`). The codex (`bestiary.js:97`), rules (`custom.js:301`), feats (`feats.js:36`) and solo (`gates.js:164`) docs have neither.
- **What a player sees:** with two GM phones in one room, each poll each phone puts its own copy, and players' codex, feats and rule switches flip between the two.
- **Why 2:** needs two GM phones live in one room.
- **Fix:** architecture: one writer per doc. The room records which GM device holds the docs (a lease the first GM device takes), and the server refuses a doc put from another device, which then reads. Lint: none needed once the server refuses it.

Nothing else found. No device memory key is shared (`table-cues` is named in `table-news.ts` only in a comment).

## Make operations idempotent

**Checks:** `bun docs/audit/arch-check/idempotent.ts`: each view handler of a room message and the guard in its first lines; and where `room-events.ts` lands its appliers. Read: the server's event insert.

Nothing found. Every room message applier in `src/edge/room-events.ts` is a row of `APPLIERS` (line 93) landed by `appliedOnce` (line 410). Each view handler is guarded: `once(` (soloRun, questUpdate, used), `wasApplied(` (deathSave), `onTurn(` (step, cast, pass: a turn is one `now`), a held call (coinCall), the feed's id (roll). The one the script marks unguarded, `arm` (`combat.js:368`), is a set: the fight refuses it as `noChange` when it is armed already (`src/core/combat/fight.ts:330`). The server answers an event sent twice with its first seq and refuses a different one under the same id.

## Migrate callers, then delete legacy

**Checks:** `bun docs/audit/arch-check/legacy.ts` part 1: comments that say a shape is old.

### LG-1. The server converts rows of older builds at every start. Score 0. Read.

- **Where:** `server.ts:220-231`: three table-wide `UPDATE`s and a column add, run at each start to convert rooms and events written by builds before the event id and JSON fixes.
- **What the next engineer trips on:** code that must be read and kept for rows that need not work (old rooms do not need to keep working). It is idempotent, so it costs only start time.
- **Fix:** delete it once the deploy has started once with it.

The other old-shape readers are a hunter's (`hunter.ts:276`, `job-chain.ts:132`, `chronicle.ts:147`), which the owner's rule keeps.

## Subtract before you add

**Checks:** `bun docs/audit/arch-check/legacy.ts` part 2: each export no other file of `src/`, `server.ts`, `scripts/` or `tests/` names. `map-checks.ts` part 3: api members no module calls.

### SB-1. Eight exports are used nowhere. Score 0. Ran.

- **Where:** `CHANNEL_EVENTS` (`combat/fight-channel.ts:27`), `tilesText` (`combat/space.ts:47`), `canStack` (`combat/stacks.ts:91`), `CHIP_REFUSAL` (`hunter/chips.ts:34`), `earnedIn` (`hunter/noticed.ts:172`), `builtInBundle` (`registry/bundles.ts:289`), `NO_PICK` (`trade/goods.ts:30`), `STATE_WORDS` (`trade/offer.ts:503`).
- **Fix:** delete them. 109 more exports are used only in their own file; dropping `export` from them shrinks each module's surface.

The trade machine (`src/core/trade/offer.ts`, 549 lines) has no caller but the save's parser. It is feature 5, built core first (`docs/agent-handoff/features/brief-5-trade.md`), so it is not dead; it is listed so nobody deletes it as such.

## Encode lessons in structure

**Checks:** `bun docs/audit/arch-check/lessons.ts`. (1) Each audit finding a source comment cites, and whether a test names it. (2) Which lists the "found by its id" lint covers.

The lesson "find a thing by its id" was learned for hunters (audit row 23) and for rule titles (H6), and is held by a lint for lists named `hunters`, `monsters`, `rows`, `remotes()` and `list()` only (`tests/lint.test.ts:1566`). It has come back on skills, the shop, written titles, bag stacks and packs. That is MD-1; its lint is by-name.ts as a test.

15 of 34 audit findings cited in comments are named by no test. A test may hold the rule without naming it, so this is a list to read, not a finding.

## Build the lever

**Checks:** `bun scripts/deps.ts --check` and `bun scripts/statecharts.ts --check` (both current). `bun docs/audit/arch-check/map-checks.ts` part 1: save keys by writing module.

### LV-1. The dependency map lists no save key for any module. Score 1. Ran.

- **Where:** `scripts/deps.ts:266-277` reads save keys only from `store.update` callbacks. Views now write through `store.apply` (92 calls in `src/views`), so the map's "Changes in the save" is empty for every module: `map-checks.ts` prints `0 of 0 save keys`, and `bun run deps -- src/views/inventory.js` shows no save key though it writes the shop and the bag. `AGENTS.md` says the map lists each file's save keys.
- **What the next engineer trips on:** "what writes `shop`?" has no answer in the map the owner asked for as the trace from a feature to what it depends on.
- **Fix:** the map reads each `store.apply('<step>', <expr>)` and the core step functions in it, and a core step's save keys come from its parameter type (`Step<Pick<Save, 'shop'>>`). A case in `tests/deps.test.ts`: a module that calls `store.apply` shows a save key.

## Blast radius

**Checks:** `bun docs/audit/arch-check/map-checks.ts` part 2: the modules most others import, and how many unit tests import each.

Nothing found. Every core module with five or more importers has a unit test that imports it. The most imported are `ids.ts` and `rules.ts` (75 importers each, 19 and 69 test files).

The one fact MD-1's fix is safe because of: every place that asks "is this the same thing?" by words is in by-name.ts's list, so a `SourceRef` change can be checked site by site. Level 4: the script runs and lists them; a new site prints as `NEW`.

## Three lints to add

1. **"A saved or shared thing is found by its id; a name is compared only to refuse a clash or read a typed name."** by-name.ts as a test, its `CLEARED` reasons the allowed list. It generalizes the hunter lint and would have caught BN-1 to BN-3, BUG-rules-27 and AW-gates-5.
2. **"A parser reads the data's hard limits, never the rules."** No parser module imports the value `RULES` (BD-1), or better, parsers take a `Limits` type.
3. **"An id parameter is typed with its brand."** types.ts check 1 as a test (TY-1): a mistake shows at the call that made it, not three modules later.
