# Notes of unit P5, rows from hunters, sheets, monsters and shadows

Worktree `.claude/worktrees/agent-af9587def05f147c3`, branch `worktree-agent-af9587def05f147c3`, from 9ea4203. Commits
c93d21a (`rows.ts`), 13ecc01 (`tests/rows.test.ts`), then these notes.

## Files outside the unit

None changed. `docs/dependency-map.md` is not committed (the lead regenerates it after merging), so `tests/deps.test.ts`
fails in this worktree for that reason alone. `bun run deps -- --write` adds only the `rows.ts` node and its import edges.
I ran it, read the diff, and put the committed file back.

## Choices (the plan is silent or differs)

1. **The signatures.** The plan's `monsterRows(m, n, ids, R)` carried the count twice. Here the count is `ids.length`.
   Each maker takes `now`, the fight's time (0 before it starts), because a status on a `NewRow` ends at a tick, not after a
   number of rounds: `hunterRow(h, id, now, R)`, `remoteRow(sheet, key, id, now, R)`, `monsterRows(m, ids, now, R)`. A
   shadow holds no statuses, so it is `shadowRow(s, owner, id, R)`.
2. **Inputs are structural types of the schema 4 fields** (`RowHunter`, `RowMonster`, `RowShadow`), as P2 did with
   `SheetHunter`, so W1b's and W2's types satisfy them with no change here. `RowHunter` is `SheetHunter` with `id`, `name`,
   `life`, `mana`, skills as `{ type: 'active', ability: Ability | null } | { type: 'passive', bonus }`, items with
   `name`, `dice?`, `attack?`, and conditions as `SheetStatus` (P0's type, rounds left).
3. **A start status's def comes from `R.conditions` by key** (a `StatusDefs` table), as P1 read Hasted and Stealth. Only
   `monsterRows` needs it, so only it takes `RowRules & { conditions }`. A key the table lacks is left out. Until W1a
   restates the statuses a caller passes `{ ...RULES, conditions }`; the test does that.
4. **The stagger bar's yardstick has a home in core now: `sameRankHit(rank, R)` in `rows.ts`.** It is the simulation's
   (`tests/models/fight-sim.ts`): the brute archetype's build as a hunter of the rank's first level, every perk of the
   tiers opened on its main stat, in its kit, striking a same-rank normal brute at mean dice through `resolve`, reaction 20
   (no crit). The test pins it equal to the simulation's at E, C and S. `fight-sim.ts` could import it and drop its own
   (not my file; for W8 or the lead).
5. **The weapon is the item in `equipped.weapon` with both `attack` and `dice`.** Anything else there gives `Strike`.
6. **Abilities: the default attack first, then the rest in list order; the first of each id; at most `MAX_ABILITIES` (12).**
   `parseFight` refuses a row with more than 12, and a second ability with an id already held could never be chosen.
   A GM ability with id `attack` on a monster is dropped for the archetype's attack.
7. **A pack is named with letters** ("Goblin A", "Goblin B"), as `toCombatant` does today, going on to "AA" past 26. One
   row keeps the plain name. The name is cut so the letter fits in 60.
8. **A shadow** is a monster origin at its rank and archetype with `NO_TWEAK` and the kind `SHADOW_KINDS[grade]` (exported,
   keyed by `ShadowGrade` so a new grade fails the typecheck). It has the archetype's attack only, no threat table and
   no stagger bar: both are tools against a foe, and `controlFactor` already treats a shadow as a hunter.
9. **Statuses beyond `MAX_STATUSES` (30) are cut**, again so `parseFight` can read the fight back.
10. **No row starts with `readyAt` from the sheet** (plan: `cdLeft` goes), a shield, a channel or an intent.

## What I made

`src/core/combat/rows.ts` (197 lines, pure, new):

- `RowRules`: `SheetRules & KindRules`. `StatusDefs`: start status defs by key.
- `RowSkill`, `RowItem`, `RowHunter`, `RowMonster`, `RowShadow`: the fields each maker reads.
- `SHADOW_KINDS`: a shadow's monster kind by grade (plan 1.2).
- `hunterAbilities(h, R)`: the worn weapon's attack (`weaponAttack`), then each active skill's ability. W6 can call it
  for the player's buttons.
- `hunterRow(h, id, now, R)`: party, hunter, origin `buildOf`, tier from rank, HP from `hpOf(life)`, mana and fatigue
  within the maxima the conditions leave, conditions as statuses from `now`, holder `local`.
- `remoteRow(sheet, key, id, now, R)`: the same with holder `remote`.
- `sameRankHit(rank, R)` and `staggerOf(rank, kind, R)`: the bar of design 4.3, `kinds[kind].stagger` hits or null.
- `monsterRows(m, ids, now, R)`: one foe per id, origin with the seed's tweak, full HP and mana, `xp`, threat `{}`, the
  bar, archetype attack then its own, start statuses with the row as source at its rank's tier.
- `shadowRow(s, owner, id, R)`: party, kind `shadow`, HP within the max, holder `shadow`.

`tests/rows.test.ts` (209 lines, 16 tests): hunter 6, remote 1, monster 5, shadow 2, names 1, and one where every kind of
row joins a fight, starts it, and `parseFight` gives it back unchanged. Expected values come from the rules by name
(`hpBase` 45, `manaBase`, `fatigueBase`, `speedBase` 100 slowed 25% at tier 1), the plan's grade table, the stagger
factors 2.5 and 4, and the simulation's same-rank hit. Hand mutations, each caught by at least one test: a Knight made a
boss, the bar at 1 hit, the weapon ignored, a start status with no source id, statuses not offset by `now`, HP not cut to
the max, no ability cap, an unknown status key kept.

Lines: 406 added, none removed (new files only). What these replace dies in the wave: `combat.js:146-170`'s factories in
W5, `monsterRow` and `monsterSource` (`monsters.ts:126-140`) in W1b or W5.

## For the next units

- **W1b / W2:** `Hunter`, `Shadow` and `Monster` of schema 4 must satisfy `RowHunter`, `RowShadow`, `RowMonster`. A
  `StartStatus` stays `{ key, rounds }`; its def is found in `R.conditions` at the time the row is made.
- **W5:** make rows with `hunterRow`, `remoteRow` (after `parseSheetHunter`), `monsterRows` and `shadowRow`; pass the
  fight's `now` (`f.phase === 'running' ? f.now : 0`) and `rulesOf(...)` for the GM's statuses.
- **W4:** a shadow's max HP on the Shadows panel is `monsterSheet(s.rank, s.archetype, SHADOW_KINDS[s.grade], R).hpMax`.

## Which principle changed a choice

- boundary-discipline: no check of any field; the save, `parseSheetHunter` and `parseMonster` are the boundary. The caps
  (12 abilities, 30 statuses, 60 characters) are the fight's own bounds, kept so a fight made here can be stored.
- minimize-reader-load: one `partyRow` for both hunter makers, so a local and a remote row differ only in the holder; a
  test asserts exactly that.
- test-behavior-not-implementation: the mutations above; the round trip through `reduce` and `parseFight` is the
  observable contract of a `NewRow`.

## Checks

- `bun test tests/rows.test.ts`: `Ran 16 tests across 1 file. [65.00ms]` (16 pass, 0 fail).
- `bunx tsc --noEmit`: no output.
- `bun run build`: `Built 12 files into dist/ (build 78a033133194)`.
- `bun run test`: `Ran 2098 tests across 57 files. [113.56s]` (2093 pass, 4 todo, 1 fail). The one fail is
  `tests/deps.test.ts`, "the committed dependency map is what bun run deps -- --write writes", because the map is not
  committed here by instruction.

Red after this unit: `tests/deps.test.ts` until the lead regenerates the map.
