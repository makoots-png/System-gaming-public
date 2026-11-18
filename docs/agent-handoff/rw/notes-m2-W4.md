# W4, the sheet on eight stats: notes

Worktree `.claude/worktrees/agent-a0250cdbf868f64d4`, branch `worktree-agent-a0250cdbf868f64d4`, from 4ec7b55: commits
2a66d2e to the notes commit. Not pushed. `docs/dependency-map.md` is regenerated in the tree and not committed (the lead
regenerates it after merging).

## Files outside my list (smallest change each, with the reason)

- `src/core/hunter/sheet.ts`: `checksOf(h, { stats, sheet }, R)` answers `{ bonus, tired, penalty, dis }`. `dis` is the
  home of the old `fatigueDis` (P2 and W2 asked for one): fatigue at `disAt` percent of the capacity. `checkBonus` is
  now `checksOf(...).bonus[stat]`.
- `src/core/combat/rows.ts`: `shadowSheet(s, R)`, the sheet a shadow's row starts with, so the Shadows panel shows the
  max HP the fight uses. `shadowRow` reads its origin from the same helper. (sheet.ts could not hold it: rows.ts imports
  sheet.ts.)
- `src/core/effects.ts`: `gmSource(rank)` = `{ id: null, tier: rankIdx(rank) }`, beside `itemSource`. It replaces
  `encounter.ts`'s `gmSource` in hunter.js and gm.js. **W5 (combat.js) and W7 (forge.js) should import it from here.**
- `src/core/api.ts`: `HunterSheet` and `hunter.sheet(h)` in place of `Derived` and `derived`. `spendMana` in place of
  `spendMp`. `Bonuses`, `inventory.bonuses` and `skills.bonuses` are gone. `ExtractTarget`, what `shadows.extract` reads.
- `src/views/skills.js` (W6/W7): `bonuses` deleted (buildOf sums passives). Lines 35-36 call `spendMana` and
  `sheet(h).mana`, so `tests/deps.test.ts` does not list them.
- `src/views/table.js` (W6): three calls of `derived` ask `sheet` (HP, mana and their maxima). W6 rewrites the HUD.
- `src/edge/store.ts`: `IMPORT_ERRORS` is exported, so io.js shows W2's words for an old file.
- `src/views/io.js` (the lead's addition): "Add hunters to party" refuses a file whose schema is not `SCHEMA`, with
  `IMPORT_ERRORS.old`. A new step in `tests/e2e/save.e2e.ts` drives it through the Data panel; with the check removed
  by hand the step fails (checked).
- `public/app.css` (1 selector): `.bar-mana` takes the mana colour of `.bar-mp` (the sheet's bar is now `data-bar="mana"`).
- `tests/e2e/helpers.ts` (W5's, 3 lines): `activeHunter` reads `hunter.sheet`; it still answers `hp` and `derived`
  (now the sheet's numbers and the stats after perks and conditions), so the room files read `derived.hpMax` unchanged.
- Bun tests: `tests/sheet.test.ts` (3 cases of `checksOf`), `tests/rows.test.ts` (`shadowSheet` per grade),
  `tests/items.test.ts` (`gmSource`).

## Choices (read first)

1. **`hunter.sheet(h)` answers `{ stats, sheet, hp, mana, checks }`.** The plan wrote `fatigue` and `check(stat)`:
   fatigue is the hunter's own field, and `checks` is data (`checks.bonus[stat]`, `checks.dis`), not a function.
   `maxima(h)` is the `Sheet` itself (it satisfies `Maxima`).
2. **Gear does not change in a running fight**, as the plan decided: `loadouts.swap`, `inventory.equip` and
   `inventory.unequip` are refused with the toast "Gear cannot change during a fight." `inFight` reads this phone's
   `save.fight` (phase `running`) or the room's `fight` doc (a row with the hunter's key). custom.js reads
   `fight.phase` rather than importing `stateOf`: importing fight.ts pulls it into the loose views typecheck, where
   two `if (!r.ok) r.reason` lines in fight.ts fail without strict nulls. **W5 will hit that when combat.js imports
   fight.ts** (write `r.ok === false`, as W3 did in fight-doc.ts).
3. **The Derived panel** shows Speed, Armor, Resist, Reaction, Accuracy, Will, Max mana, Fatigue capacity, Carry and
   Kit weight (`SHEET_LABELS`), then Rank bonus and Fatigue penalty, then the eight checks. A number is shown with at
   most one decimal. AC, Initiative, Skill DC and Passive Perception are gone (plan section 2).
4. **The stat cell's small number is the check bonus** (was the ability modifier; there is no `mod` now).
5. **Mana on the sheet** is `data-bar="mana"`, "Mana" (was `mp`, "MP"). The fatigue bar's maximum is the capacity.
6. **Shadows.** A new shadow is `{ rank, archetype, grade }` from the target's rank, archetype and kind (boss Knight,
   elite Elite, else Normal, as before), at full HP. Its card shows grade, archetype, HP of `shadowSheet(...).hpMax`
   and the summon cost in mana. The level buttons are gone (a shadow has no level). The army's size is the hunter's
   `sheet.shadows`; the extraction roll is the Presence check (`checks.bonus.pre`). **W5: `shadows.extract(hid, c)`
   takes an `ExtractTarget`** `{ id, name, rank, archetype, kind, monster, down, extractable, tried }`, built from the
   fallen row.
7. **A condition** is added with `addSheetStatus` (W3 asked): its def is the one sent, else the one held, else the
   rules'; its source is the one sent, else `gmSource(h.rank)`. The chip's card is `describeStatus(def, tier)`.
8. **Inventory**: an item's line shows weight, armor and resist, and a weapon's dice with its attack. The Equipment
   panel's summary is "Kit weight W of C carry · Armor A · Resist R" from the sheet (`bonuses` is gone; each worn
   item's line shows its own bonus). `use()` asks `sheet` for HP and mana (`op === 'mana'`); its outcomes part is W6's.
9. **Test 319** ("a cooldown on the sheet") is deleted, as the plan says; `rest` no longer clears `cdLeft`
   (skills.js's `resetCooldowns` still runs on the `rest` change, W6's).
10. **The rewritten browser tests** read numbers worked by hand from the rules (each with its working in a comment):
    Brakk's fatigue capacity 108 and HP 51 at level 1, 56 at level 3; Accuracy and Will 2.8 under an E-rank Poisoned or
    Frightened (8 points), 1.6 under the GM's Venom (12); the CTL and DIS checks -2 and -3.

## What I made (screens and what each reads)

- Status window (hunter.js): HP, Mana and Fatigue bars against `sheet.hpMax`, `manaMax`, `fatigueMax`; conditions on
  `addSheetStatus` and `describeStatus`.
- Attributes: the eight stats (`STAT_KEYS`, `STAT_SHORT`, `STAT_LABELS`), the effective score and its difference from
  the spent points, the check bonus, free points from `available`.
- Derived: section 3 above, from `hunterSheet` and `checksOf`.
- GM raw edit: the eight base stats and `manaAdj` (the `undefined` number-input warning that failed two
  room-view.e2e.ts tests came from `mpAdj`; both pass now).
- Dice (dice.js): a check's bonus and disadvantage are `checks.bonus[stat]` and `checks.dis`.
- Build (custom.js): Auto is `autoSpend`; the perk window's before and after read `sheet`.
- GM party card (gm.js): HP, Mana and Fatigue from `hunter.sheet`, condition labels from their def.
- Reward editor: a status without its def takes the rules'; a built-in skill is `skillOf(def, rules())`.
- Lines in `src tests public` since 4ec7b55: 365 added, 363 removed (hunter.js 83 added, 107 removed).

## Which principle changed a choice

- subtract-before-you-add: `derived`, `bonusOf`, both `bonuses` providers, `allocPlan`'s loop, the shadow level
  buttons and `baseHp` went in the commit that replaced them; nothing old is left beside the new in my files.
- minimize-reader-load: `checksOf` is the one answer to "what does a check add, and does it roll with disadvantage";
  the sheet, the dice and the shadows panel all read it.
- test-behavior-not-implementation: every expected number in the rewritten tests is worked from the rules by hand; the
  io.js refusal was checked by removing it (the step fails).

## The checks

- Own files, core: `bunx tsc --noEmit --pretty false 2>&1 | grep -E '^(src/core/(api|effects)\.ts|src/core/hunter/sheet\.ts|src/core/combat/rows\.ts|src/edge/store\.ts|tests/(sheet|rows|items)\.test\.ts|tests/e2e/)'`: no output.
- Own files, views: `bunx tsc -p tsconfig.views.json --noEmit --pretty false 2>&1 | grep -E '^src/views/(hunter|custom|dice|inventory|shadows|gm|reward-editor|ui|io)\.js\('`:
  4 lines, all `inventory.js` `use`/`useOnOther` (outcomes and `use.ts`, W6's `useItem` part).
- `bun test tests/sheet.test.ts tests/rows.test.ts tests/items.test.ts`: 0 fail. `bun test tests/lint.test.ts tests/statecharts.test.ts`: 0 fail.
- `bun run build`: `Built 12 files into dist/ (build a62c0dad636b)`.
- Browser, port 3241: `customization.e2e.ts` `8 passed (1.2m)`; `rewards.e2e.ts` 5 passed; `room-view.e2e.ts`
  `9 passed (1.2m)`; `save.e2e.ts` `7 passed (22.0s)`; `room-sync.e2e.ts` + `room-sync-fixes.e2e.ts` `15 passed (3.2m)`;
  `room-onboarding.e2e.ts` + `pwa.e2e.ts` `9 passed (43.5s)`; `character.e2e.ts` the W4 four (179, 212, 236, 384 now)
  and 88, 138, 329, 344 pass: `11 failed, 8 passed (4.1m)`; `gates-quests-dailies.e2e.ts` `6 failed, 15 passed (4.0m)`
  with 455 passing.

## Red after this unit

`bunx tsc --noEmit --pretty false 2>&1 | cut -d'(' -f1 | sort | uniq -c` (file lines; the indented lines are
continuation lines of those errors):

```
      1 tests/encounter.test.ts
      8 tests/status-sim.test.ts
```

`bun test 2>&1 | grep -E '^\(fail\)' | wc -l`: 13. `encounter.test.ts` 7 and `status.test.ts` 5 (W8), and
`tests/deps.test.ts` 1: "every app.api member a module uses is registered" lists `combat.js` 59, 70, 148, 153, 230,
251 and `effects.js` 47, 50 calling `hunter.derived`. Those lines are W5's and W7's rewrites (both running now); I
left them to avoid merge conflicts. `status-sim.test.ts` does not load (W8). `Ran 2331 tests across 59 files.`, 2317
pass, 14 fail, 1 error.

Views typecheck (file lines): `bestiary.js` 31, `combat.js` 34, `effects.js` 4, `gates.js` 5, `inventory.js` 4
(W6), `loot.js` 3, `skills.js` 47, `table.js` 7, `workshop.js` 7.

Browser, red and whose:
- `character.e2e.ts`: 120 (W5's 127, combat card), 249 (267 "GM Reset rules": `workshop.js` throws reading
  `m.skills.length` of a monster, W7), 301, 424, 453, 492, 517, 559, 569 (W7's 345 to 610), 578 and 602 (W6's 619, 643).
- `gates-quests-dailies.e2e.ts`: 101, 117, 151, 245, 290 (W5) and **167** ("clearing a gate lists the room player"),
  which runs a fight: the old `combat.js` calls `hunter.derived`, gone now. It is green once W5's combat.js lands.
- `reward-room.e2e.ts`: the one test passes every step up to the Workshop, then fails on the same `workshop.js` error (W7).
- Any browser test that runs the old fight or the old makers (W5 to W7 files) can now also fail on `hunter.derived`.

## For the next units

- **W5:** `app.api.hunter.sheet(h)` is `{ stats, sheet, hp, mana, checks }`; `maxima(h)` is the hunter's `Sheet`.
  `gmSource(rank)` is in `src/core/effects.ts`. `shadows.extract(hid, c)` takes an `ExtractTarget`. Delete
  combat.js's `derived` calls (deps test). `startGoblinDenFight` can keep `activeHunter` as it is.
- **W6:** inventory.js `use`/`useOnOther` still report outcomes and import `use.ts`; table.js and skills.js ask `sheet`
  for HP and mana (my three and two lines). skills.js's `resetCooldowns` runs on the `rest` change; nothing else calls
  it from hunter.js.
- **W7:** effects.js 47 and 50 call `hunter.derived`: `sheet(h).hp` and `.sheet.hpMax`. workshop.js reads
  `m.skills.length` on a monster, which fails character 267 and reward-room.
