# W1a, statuses and rules: notes

Commits b511d2f to the last one with "W1a" in its message, on `claude/zen-pasteur-ov4cgd` in the main tree. Not pushed.

## Files outside my list

- `src/core/save.ts` (5 lines): `Library.statuses` holds the new `StatusDef` of `effect-ops.ts`, and `statusLibrary` reads each def with `parseStatusDef(raw, BASE_RULES)` in place of `sanitizeDef`. Reason: `pack.ts` merges pack statuses into `Library.statuses` and `rulesOf` lays them over the built-ins, so with the old type there `pack.ts` and `edge/rules.ts` did not compile. The rest of `save.ts` (conditions, `export type { StatusDef }` of the old def, stats) is W2's and untouched.
- `docs/agent-handoff/copy-tasks.md`: the new words, appended.
- `docs/dependency-map.md`: `bun run deps -- --write`.

## Step 1: a missing named export stops `bun run build`

In a scratch copy outside the repo (`git archive HEAD`), `export const mod` in `src/core/rules.ts` renamed to `modRenamed`. `hunter.js` imports `mod` from `src/edge/rules.ts`, which re-exports core's with `export *`. `bun scripts/build.ts` exited 1:

```
error: No matching export in "src/edge/rules.ts" for import "mod"
    at .../src/views/hunter.js:3:52
```

So the plan's invariant rests on a fact, also through an `export *` re-export. Before the rename the same copy built (`Built 12 files into dist/`). Every export a view imports from my files is still there (`STATS`, `STAT_KEYS`, `PERK_KEYS`, `PERK_LABELS`, `mod`, `formulaHpMax`, `formulaMpMax`, `itemOps`, `itemSource`, `effectsOf`, `legacyOps`, `describeItem`, `FULL`, `BUILT_IN_STATUSES`, `chipDef`).

## Choices where the plan was silent (read these first)

1. **`describeStatus(def, tier, R)` takes the rules as a third argument.** A duration is ticks and reads as rounds through `R.fight.round`, and `cureStatus` carries only a key, whose label is in `R.conditions`. `R` is `DescribeRules = { fight: { round }, conditions }`, which `Rules` satisfies. `tier` null reads every rank ("−20% / −25% / … , by rank E to S"), what the old `describe(R, def)` did for a picker's card. `opLines(ops, tier, R)` is the same for a bare op list (an item card).
2. **`StatusDef` gained `color?`** (a GM's chip colour, `#rrggbb`, kept in lower case by `parseStatusDef`). The old def had it and the GM's status maker sets it; dropping it would lose a kept feature. A colour that is not `#rrggbb` refuses the def, as every field of `fight-parse.ts` does. `fight-doc.ts` does not carry it yet (P4's notes: one line in `docRow` and one field in `DocStatus`, for W3).
3. **New homes in `effect-ops.ts` for what `pack.ts`, `rewards.ts` and `effects.ts` took from `status.ts`:** `STATUS_KEY_RE` and `isStatusKey`, `freeStatusKey(label, taken)` (was `slug`), `FULL`. `status.ts` keeps its own copies until W8 deletes it; the views and `save.ts`, `monsters.ts`, `items.ts`, `skills.ts` still import those.
4. **Rewards and packs read a status def with the shipped rules' dice limits** (`parseStatusDef(v, RULES)`): `parseRewards` and `parsePack` take no rules, and a reward is read before any GM's rules are known (as `parseSheetHunter` reads with the base rules).
5. **`effects.ts`:** an item's ops are what it does when used (`effectsOf(item)`); worn, an item adds its fields, which `sheet.ts` reads. `itemOps(item, 'equip')` answers none, kept for `inventory.js` and `combat.js` until W5 and W6. `legacyOps` turns `heal`, `restoreMp` (a fifth, at least 1, as plan 3.3) and `fatigue` into new ops; it goes with the fields in W1b. `itemSource` is the new `Source` `{ id: null, tier }`. `ItemEffects` is a structural input, so W1b's `Item` satisfies it with no change.
6. **Rules removed in this unit:** `rankTable`'s `hp`, `ac`, `atk`, `dmg`, `init`; `boss`; `elite`; `shadow.capacityStat`. `fight.kinds.*.xp` holds the XP factors (normal 1, elite 1.5, boss 3). A GM override of a removed key is refused as `unknown` at load (`rules.test.ts`). Kept for W8 to delete: `mod`, `RULES.hp`, `RULES.mp`, `formulaHpMax` and `formulaMpMax` (they now read `vit` and `pow`, the stat map's places for `con` and `int`, so `save.ts` and `hunter.js` keep a number until W2 and W4).
7. **`PERK_LABELS` has no `ac` and says `manaMax: 'Mana'`.** The plan's W8 list names `PERK_LABELS.ac` as a leftover; it is a property, not an export, so the build does not need it, and it is dead with `PERK_KEYS`' `ac`.
8. **The titles are restated here** (plan 3.6: Demon Hunter `pre 2`, The One Who Hunts Alone `agi 2`, King of Shadows `pow 5`), because they live in `rules.ts`, which W1b does not own.
9. **The status toast** (`room-events.ts`) reads what a status does from the phone's rules (`R.conditions`, built-ins and the GM's library) at the source's tier. The `status` message's own def is still the old shape until W3; the toast takes only its label for a key the rules lack.
10. **Statuses in plan 3.1, taken as the table gives them:** Poisoned lowers Control (the table), not Discipline (the rule's "checks"). Blinded was twice the rank bonus, so `stat ctl` is 8N: -16 to -64. Bloodlust's damage is `stat str` and `stat pow`, each `round(N / 0.6)`: -2, -5, -8, -15, -22, -32.

## What I made

- `stats.ts`: `STAT_SHORT`, the eight three-letter labels.
- `rules.ts`: `STAT_KEYS` and `StatKey` re-exported from `stats.ts`; `STATS` built from `STAT_KEYS`, `STAT_SHORT`, `STAT_LABELS`; `PERK_KEYS` the eight, `hpMax`, `manaMax`; `PerkKey`; `PERK_LABELS` from `STAT_SHORT`; the removed rules above; titles on the eight stats.
- `registry/statuses.ts`: the 14 statuses as `effect-ops.ts` defs (plan 3.1), with the 4N rule as a comment; the chip defs with `ops: []`.
- `effect-ops.ts`: `StatusDef.color?`, `STATUS_KEY_RE`, `isStatusKey`, `freeStatusKey`, `FULL`, `DescribeRules`, `opLines`, `describeStatus`. `opLine` has a `case` per op kind (`satisfies never`), so a new op asks for its words.
- `fight-parse.ts`: `parseStatusDef(v, R)`, and a def's colour.
- `chips.ts`, `edge/rules.ts`: the new `StatusDef` type.
- `effects.ts`: rewritten on the new `Op` (above).
- `rewards.ts`: `RewardStatus = { key: StatusKey, rounds, def?: StatusDef }`; `RewardRules`; the label falls back from the def to the rules to the key.
- `pack.ts`: statuses read by `parseStatusDef`, walked and re-keyed on the new ops; renamed keys by `freeStatusKey`.
- `room-events.ts`: the status toast (above).

Lines (`git diff m2-start --numstat -- src tests`): 16 files, 555 added, 241 removed. Deleted in my files: the old statuses' `mod` ops, `rankTable`'s five columns, `boss`, `elite`, `capacityStat`, the six-key `STAT_KEYS` and `STATS` table, `PERK_LABELS.ac`/`mpMax`, the old `legacyOps`/`effectsOf`/`itemOps`/`describeItem` bodies, the `HIT` and rankBonus-curve cases of `statuses.test.ts` (the phase 4 d20 audit), the `mean(dmg)` and monster-column cases of `rules.test.ts`.

## For the next units

- **W1b:** `pack.ts` still walks and re-keys an item's and a skill's effects as the old ops (`itemOpKeys`, `itemRekey`, the `ItemOp` import from `status.ts`). When items carry the new ops and skills carry abilities, delete those three and walk them with `opKeys` and `rekeyOps` (a skill's statuses are in `ability.ops`). `tests/pack.test.ts` builds `SHARD`, `LANCE` and `WARDEN` in the old item, skill and monster shapes; they need the new ones. `FULL` now comes from `effect-ops.ts` (or `effects.ts`). `PERK_KEYS` has no `ac` and says `manaMax`; `paths.ts` is all of the 61 tsc errors in a W1b file that is not in the plan's red list. A start status's def is `R.conditions[key]`, now the new def.
- **W2:** `Library.statuses` is already the new def (above). `fixConditions` and `Condition` are still the old ones.
- **W3:** `applied.test.ts` "the player is told in a toast" now reads `'Burning: 3d8 magical damage a round · 3 rounds'` (the same tier, the new words); its two `turnOps` cases test `status.ts`. When the `status` message carries the new def, the toast can read `a.def` first. `fight-doc.ts` may carry `color` (choice 2).
- **W4 to W7:** `describeStatus(def, tier, R)` replaces `describe`, `statusDef` and `mods`; `RULES.shadow.capacityStat`, `rankTable[r].hp/ac/atk/dmg/init`, `RULES.boss` and `RULES.elite` are gone, so `shadows.js`, `combat.js`, `bestiary.js`, `rulesref.js` read `undefined` there until moved.

## Which principle changed a choice

- subtract-before-you-add: the removed rule keys go now, with the test that a GM's old override of one is refused, rather than staying beside `fight.kinds`. `PERK_LABELS.ac` goes with `PERK_KEYS`' `ac` instead of waiting for W8.
- explain-the-number: the 4N rule and `round(N / 0.6)` are comments beside the tables, and the tests compute the expected numbers from `RULES.rankBonus` and `RULES.fight.powerK` as the plan's rule states them.
- test-behavior-not-implementation: the restated statuses are tested through `modified` (Slowed takes 20% of speed 100, Prone at C takes 16 Agility, Paralyzed moves 0), not by reading the table back.
- boundary-discipline: `effects.ts` trusts an item's ops (the save and `parseItem` read them); only rewards and packs, which read outside data, call `parseStatusDef`.

## The checks

- `bunx tsc --noEmit --pretty false 2>&1 | grep -E '^(<own>)\(' ; test $? -eq 1` with my 11 source files and 4 test files: no output, exit 1 of grep.
- `bun test tests/statuses.test.ts tests/rules.test.ts tests/rewards.test.ts tests/pack.test.ts`: `Ran 155 tests across 4 files. [74.00ms]`, 0 fail.
- `bun test tests/deps.test.ts tests/statecharts.test.ts`: `Ran 29 tests across 2 files. [6.97s]`, 0 fail.
- `bun run deps -- --write`: `wrote docs/dependency-map.md`.
- `bun run build`: `Built 12 files into dist/ (build 9425c43589ce)`.

## Red after this unit

`bunx tsc --noEmit --pretty false 2>&1 | cut -d'(' -f1 | sort | uniq -c` (file lines only):

```
     17 src/core/registry/items.ts
     12 src/core/registry/monsters.ts
     61 src/core/registry/paths.ts
      1 src/core/save.ts
     13 tests/items.test.ts
      2 tests/paths.test.ts
      8 tests/status-sim.test.ts
```

`protocol.ts` and `api.ts` have none yet. `paths.ts` and `paths.test.ts` are W1b's (eight stats, no `ac`/`mpMax` perk); `status-sim.test.ts` is W8's.

`bunx tsc -p tsconfig.views.json --noEmit` adds: `combat.js` 4, `effects.js` 1, `hunter.js` 1, `inventory.js` 9, `loot.js` 2, `shadows.js` 2, `skills.js` 2, `starter.js` 3.

`bun test 2>&1 | grep -E '^\(fail\)' | wc -l`: 105. By file: `items.test.ts` 55 and `paths.test.ts` 18 and `skills.test.ts` 1 (W1b: bonus keys `ac`, `mpMax`, the six stats), `save.test.ts` 14 (W2), `protocol.test.ts` 3 (an award item's `ac` bonus, W1b; a pushed sheet's stats, W2), `applied.test.ts` 3 (W3, above), `encounter.test.ts` 6 and `status.test.ts` 5 (old modules on the new statuses, W8).

Browser files: none run (the unit names none). Expected red until their units: anything that shows a status's mechanics or rolls a status tick (the old `status.ts` reads the new defs as having no ops), the Shadows panel's capacity, the bestiary and the rules reference's monster table, the build screen's AC and MP perks (W4 to W7).
