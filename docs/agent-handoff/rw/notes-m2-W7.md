# W7, makers, bestiary and the rules reference: notes

Worktree `/home/user/systemgaming/.claude/worktrees/agent-a2967f7117ae8aa1f`, branch `worktree-agent-a2967f7117ae8aa1f`, commits e6fb073 to the last one with "W7" in its message, from 4ec7b55. Not pushed. Run beside W4 and W5. `docs/dependency-map.md` was not regenerated or committed (the lead's).

## Files outside my list (smallest change each, with the reason)

- `src/core/api.ts`: `EffectsApi` (the `Op`, `Source`, `StatusDef` of effect-ops.ts; `mods` gone; `describe(def, tier)`; `statusDef` takes a key or `{ key, def? }`), `ForgeApi` (the answer's `def` is the new def and is always there), `MakerEffects.ops`, `SkillsApi.lines`' `Source`, `BestiaryApi.statBlock` (takes `archetype` and `kind`; `boss` and `elite` still read, because gates.js, W5's, passes `boss`). The old `status.ts` import is gone from api.ts. W4 and W5 change other types in this file; the hunks should not overlap.
- `src/core/effects.ts` (W1a's): `legacyOps` and the old fields of `ItemEffects` deleted (loot.js was the last caller); `amountDice` and `amountOn` added, so effects.js rolls an op's dice through `src/edge/roll.ts` and core evaluates the formula (no view evaluates a formula, W8's lint).
- `docs/agent-handoff/copy-tasks.md`: appended.

## Choices (read first)

1. **The effects editor** offers per maker: a status damage (physical or magical), heal, mana, fatigue, speed %, stat, cannot act (`hold`), cannot move (`root`), cure, note; an item damage, heal, mana, fatigue (each `when: 'use'`), apply, cure, note; a skill apply, cure, note (its damage is the ability's formula). The plan's list plus `hold` and `root`, because Stunned, Paralyzed and Restrained hold them and an edit of a built-in must not drop them. Any op the rows cannot edit (Hasted's `refund`, a duration by rank, a taunt) is a row that keeps the op as it is and shows its words; the GM can remove it. Amounts are Flat or By rank (By rarity for an item); the old "% of max HP" mode is gone, because a formula says it (`0.05 * hpMax`). An amount's text is read by `parseFormula` and its error is the row's. A row keeps the tree it was opened with while its text is unchanged (printing `-10` and reading it back gives a negation of 10: the same number, another tree).
2. **The skill maker**: Kind is Strike, Shot, Blast, Curse, Support or "No fight use" (Arise and Shadow Exchange have `ability: null`). A support asks An ally or The user (the user: `aim self`, shape self, range 0). The formula is read only: the kind's `recommended` with default ticks through `abilityOf`, or the skill's own when it keeps its kind (its range, cost and an edited formula stay). Cooldown is in rounds. The ability's id is the slug of the name (never `attack`, the default attack's id).
3. **The enemy maker**: rank, archetype and kind chips, Extractable, XP (the rule's `xpOf` until typed), an HP factor (the tweak's `hp`; the tweak's stat points are kept as they were), the derived line "HP · Armor · Resist · Speed" from `monsterSheetOf`. Abilities are added from a skill's ability (built-in, library or a new skill); text lines are Notes. Its preview reads each ability at the monster's rank.
4. **The item maker**: a weapon has its dice, Strike or Shot, and "Armor ignored on a hit" (`penFlat`); a worn item has weight, armor and resist fields, and "Fill from a kit" fills them with `piece(kit, slot, rarity)` for an armour slot; a weapon's weight follows `weaponWeight(dice)` until typed. The bonus fields are the ten `PERK_KEYS`.
5. **The codex** keys a defeated fight row by its name (without a pack letter) and its origin's rank; a monster the bestiary lacks is saved from the row (archetype, kind, tweak, its abilities but the default attack, XP). It listens to `combat:defeated { body }` and `combat:end { fight }` (a row with HP 0). The codex doc carries `hpMax`, `armor`, `resist`, `speed` and 4 ability names.
6. **The bestiary card** shows HP, Armor, Resist, Speed and XP from `monsterSheetOf`, the archetype attack and each ability with its first line, and the notes. The six-stat grid is gone (a monster's stats are derive's; no view calls it).
7. **The rules reference** reads `rules().conditions` unguarded: `guard` compared each status's ops with the built-in's and put back the built-in when the shape differed (a flat 1d4 over Burning's six values), so a GM's edited status showed the built-in. The worked check uses `above` from stats.ts, the curve the page explains.
8. **Outside a fight** (`effects.applyOps`), an amount is worked out with the hunter as user and target; a damage op goes to `outward` with its number.
9. **A monster's ability numbers at its rank** (design A12): the lines print the formula (`1d8 + phys`), not a number; a number needs a user's sheet, which is the fight's.

## What I made

- maker.js: the effects editor on effect-ops' `Op` (above); the ten bonus fields.
- effects.js: `applyOps` on the new ops with dice from roll.ts; `describe(def, tier)`, `describeItem`, `statusDef`, `sanitizeDef` (`parseStatusDef`), `slug` (`freeStatusKey`), `roll` (the dice view, no Math.random).
- forge.js: the new `StatusDef`; the GM's source `{ id: null, tier }`; a typed name with no ops is the status of that key or label.
- loot.js: the new item fields (above).
- skills.js (maker part only): `make`, `lines` (kind, pace, aim and range; cost and cooldown in rounds; the formula; each op at the source's tier or every rank), the panel card's meta lines, Add from list with `skillOf(seed, rules)`. Left to W6: `pay`, `use`, `outcomes`, `bonuses`, the cooldown tick and reset, the card's cooldown and Use button (28 view-typecheck errors there).
- bestiary.js (all but `toCombatant`, W5's): above.
- workshop.js: the monster and status rows, the empty lines.
- rulesref.js: the eight stats, the curves, Armor and Resist, monsters by kind, the turn order by speed, abilities; rank table without HP/AC/attack; rests and fatigue as shares of the capacity; shadows on Presence.
- scripts/ui-shots.ts: the skill and enemy maker steps on the kind and archetype chips.
- Tests: makers.e2e.ts (19 of 21 rewritten or new; the "Heals HP 10" and "HP set by rank" cases deleted with their fields, as the plan says), sharing.e2e.ts (fixtures on the new shapes; the first test ends on the item's card, see below), character.e2e.ts (345, 465, 494, 533, 558, 600, 610 rewritten, one new rules-reference test).
- Lines: `git diff 4ec7b55 --shortstat -- src tests scripts`: 14 files changed, 870 insertions(+), 801 deletions(-).

## Which principle changed a choice

- boundary-discipline: every maker builds its thing and checks it with the kind's one parser (`parseStatusDef`, `parseItem`, `parseSkill`, `parseMonster`, `parseOp`); a difference is logged as a bug of the form.
- subtract-before-you-add: `legacyOps`, the % mode, the item "Worn:" quick chips, the bestiary's six-stat grid and AC/attack/damage fields went in the commit that made them dead.
- test-behavior-not-implementation: expected numbers come from the rules (the heavy kit's tenth plus the rarity index, boss/normal HP 3.2/0.6, Slowed's −40% at A, the shot's 0.7 share), not from a run.
- explain-the-number: each such number has its reason as a comment in the test.

## Red after this unit, and why

- `bunx tsc --noEmit --pretty false 2>&1 | cut -d'(' -f1 | sort | uniq -c`: `1 tests/encounter.test.ts`, `8 tests/status-sim.test.ts` (W8), as before.
- `bunx tsc -p tsconfig.views.json --noEmit` (file lines): combat.js 31, custom.js 6, gates.js 5, hunter.js 22, inventory.js 9, reward-editor.js 2, shadows.js 16, skills.js 28 (the use part, W6), table.js 7. No error in maker.js, effects.js, forge.js, loot.js, bestiary.js, workshop.js, rulesref.js.
- `bun test 2>&1 | grep -E '^\(fail\)' | wc -l`: 14. encounter.test.ts 7 and status.test.ts 5 (W8); deps.test.ts 2: the committed map is stale (the lead regenerates it), and `src/views/combat.js:49` calls `app.api.effects.mods`, which is gone (W5's rewrite removes the caller).
- `bun run build`: `Built 12 files into dist/`.
- Browser, port 3243 (each file run twice where it failed):
  - makers.e2e.ts: 14 passed, 7 failed. Four need W5's fight screen (they set up through `startGoblinDenFight` and read `fight.rows`): Frostbite's C-rank card step, Slowed at A, Poisoned in one tap, Ice Warden's "added to a fight it starts Hasted". One needs W4's `app.api.hunter.sheet` (the gauntlets' armor). Two fail only on W4's console warning `The specified value "undefined" cannot be parsed` from the Status view (Ember Step to a player, Frost Lance on Brakk). **Run makers.e2e.ts after the W4 and W5 merges.** The fight steps are written to the plan's W5 screen with the old selectors (`.cmb-row`, `.cmb-pick`, `.cmb-card`, `[data-cforge]`); if W5 renamed them, they change in `statusOn` and `card` at the top of the file only.
  - sharing.e2e.ts: 5 passed, 1 failed on the same W4 warning (the first test). Its old last step (Brakk throws the Frost Bomb in the GM's fight) is gone: an item used in a fight is W6's `act`/`cast`; the step now reads the item's card on the second phone. W6 should cover the thrown item in its own tests.
  - character.e2e.ts (mine): 600, 610, the new rules test and the Burning edit pass. 345, 494 (W4's `hunter.sheet`), 465 (W4's chip card) and 533 (W4's console warning) are written to W4's screen and fail before its merge; 533's own assertion passes.
- Not covered any more by a makers test, for W5 to own: a monster's ability used on a hunter from its card, and the loot of a defeated monster going to the Award form (the old Ice Warden steps).

## Checks (last lines)

- `bun run build`: `Built 12 files into dist/ (build 918bbb57e609)`.
- `E2E_CHROMIUM=/opt/pw-browsers/chromium E2E_PORT=3243 bunx playwright test tests/e2e/makers.e2e.ts --workers=1 --trace off --output=/tmp/pw-w7-makers`: `7 failed`, `14 passed (1.9m)`.
- sharing.e2e.ts: `1 failed`, `5 passed (45.0s)`.
- character.e2e.ts, my tests: `4 passed` of the rules and Burning tests; the four W4-bound fail as above.
