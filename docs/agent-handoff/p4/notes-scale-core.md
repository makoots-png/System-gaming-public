# Notes: status scaling in the core (phase 4, unit A)

Base: 4d8ca47 plus the cherry-picked docs commit (9303cb9 here).

## Step 1: checkMod deleted

- `StatusDef.checkMod`, its sanitizing and its folding in `statusDef` are gone. Poisoned, Frightened and Bloodlust write `{ op: 'mod', stat: 'check', value: -2 }` first in their ops, so Poisoned's card still reads "−2 to checks", "1d4 damage at turn start" in that order.
- The rules reference's Conditions table has a "Mechanics" column with the status's `describe` lines (dice, AC, attack and check) in place of "Check mod".
- `tests/e2e/character.e2e.ts` override of Poisoned is written as ops (`mod check -3`, `mod atk -1`); it still asserts attack −4 and check −3.
- A stored instance def that still holds `checkMod` loses it on load. Old saves need not keep working.
- `bun run test`: 1285 pass after `bun run deps -- --write`. `character.e2e.ts`: 12 passed.

## Step 2: the type and the parser

- `Op` is now `FlatOp | TieredOp`. A tiered op holds `tiers` (a `Tiers<T>`, a six-tuple) and declares `dice`, `amount`, `pct` and `value` as `never`, so the type rejects a flat number beside a list (the `@ts-expect-error` lines in `tests/status.test.ts` prove it). `TurnOp.op` and the `rollTick` effect's `op` are `FlatOp`, so no reader outside `status.ts` can receive a list.
- A quantity is a string: a dice expression (as `validDice`) or `N%`, N a whole 1 to 100, the percent only on `damage` and `heal`. A flat percent is `pct: N` on a damage or heal op (it replaces `dice`/`amount` when valid). I chose a separate field over `dice: '3%'` so no roller that reads `dice` meets a percent.
- `sanitizeOps`: `tiers` present means the list decides; a bad list drops the op whole, even with a valid flat number beside it; a valid list drops the flat fields. A mod list is six integers in -99..99, zeros allowed, not all zero.
- Until step 3, `statusDef` and `describe` skip tiered ops (no built-in has one yet).
- Principle that changed a choice: type-system discipline (the `never` fields, `FlatOp` for every reader).

## Step 3: resolution

- `statusDef(R, instance)` reads the tier from `instance.source.tier` (clamped 0..5; no source or a bare key is 0) and turns each tiered op into a flat one with `atTier`: a mod gives `value` (a 0 there drops the op), a quantity gives `dice`, or `pct` when it is a percent on damage or heal. `when` is kept. `mods`, `turnOps` and `tickStatuses` already went through `statusDef`, so they follow with no change. `applyStatus` uses the same `tierOf` (it now clamps an unsanitized tier too).
- Tests: Scorch, a custom tiered status, at tiers 0, 2, 3, 4, 5, carried as an instance def, and after a C-rank Scorch lands on an E-rank one.
- `bun run test`: 1299 pass.

## Step 4: percent

- `rollFor(op, maxHp)` in `status.ts`: a resolved numeric op's dice, else its amount, else `max(1, round(pct × maxHp / 100))`. Tests: 3% of 2000 is 60, 3% of 20 is 1, 5% of 150 is 8 (7.5 rounds up), dice and amounts pass through, and a tiered `3%` at tier S on a 6000 HP boss is 180.
- Not wired into the views (unit B): `rollNum` in `effects.js` and `rollTick` in `combat.js` read only `dice` and `amount`, so a `pct` op rolls 0 there until unit B calls `rollFor`.
- `bun run test`: 1302 pass.

## Step 5: describe

- `describe(R, x)` tells three inputs apart: a list (an item's ops: sanitized, a tiered op prints six), a definition `{ label, desc, ops }` (prints six), and an instance, any object with a `rounds` field (resolved through `statusDef`, prints its tier's numbers). A `ResolvedStatus` from `statusDef` is a definition with flat ops, so the hunter sheet and table chips that pass one keep printing the instance's numbers.
- Wording: "1d6 / 2d6 / 3d8 / 4d10 / 5d12 / 7d12 damage at turn start, by rank E to S", "−2 / −3 / … to checks, by rank E to S", "AC +2 / … , by rank E to S", "3% of max HP damage at turn start", "Heals 2% of max HP at turn start". Added to `copy-tasks.md` as TODO(copy).
- Fixed on the way: a tiered fatigue op would have read "Removes" (the old test was "no dice and no amount").
- Unit B: `room-events.ts` shows `describe(app.rules(), a.def)` in the "! Status" window, a definition, so a tiered def sent with a status would print all six there. Passing the instance (with its source) prints the tier's numbers.
- `bun run test`: 1306 pass.

## Step 6: the table

- `statuses.ts` holds the design's curves as literal six-number lists, one op per line where it fits. No helper for "the rank bonus, negative": `statuses.ts` cannot import `rules.ts` (rules imports the table), and a named constant would hide the six numbers. A comment over the table says the lists are E D C B A S and that check, attack and AC follow `rankBonus`; the test checks it against `RULES.rankBonus`.
- `tests/statuses.test.ts`, per entry with no new test: six values, a damage curve's average never falls, a mod's size never falls, a number the description names (`-2 AC`, `+2 AC`) is the E number. Named tests: the penalties equal the rank bonus at every rank (Blinded twice, Hasted plus); Burning > Bleeding ≥ Poisoned at every rank; Burning is 0.4 to 0.7 of a same-rank hit, with the hits written in the test from `p4/status-audit.md` section 3.
- The tests read the numbers through `mods` and `turnOps` of an instance at each tier, not by reading the table's lists, so they check what a fight sees.
- What a table at E would notice besides Blinded (−2 to −4 attack): **Bloodlust now takes 1 damage off every hit at E** (the design's `dmg` curve starts at −1; it had no damage op before). Everything else at E is as it was.
- Slowed's and Hasted's descriptions still say "-2 AC" and "+2 AC", which is now the E number only. I left the words (a copy change); the test pins that the named number is the E one.
- `status.test.ts` "the status card lists each mechanic" now describes a Poisoned instance with no source (tier E) for the old two lines, since the definition prints six.
- `bun run test`: 1337 pass.

## Step 7: the simulation (`tests/status-sim.test.ts`)

How it plays: three hunters (kind `hunter`, sheet tier = the rank's index) and one monster from `RULES.rankTable` (boss: HP ×3, AC +2) go through the real `reduce`: `add`, `rollInitiative` with seeded d20s, then `next` turn by turn. On a hunter's turn the sim attacks (d20 + the audit's attack bonus against the live AC, natural 1 misses, natural 20 hits, damage = the audit's dice, sent as `changeHp`) or sends `applyStatus` with `sourceOf(hunter)` and 3 rounds. Each `rollTick` effect on the monster is rolled through `rollFor` and sent back as `changeHp`, as the edge does. The result is the round in which the monster falls. 400 seeded fights per row (seeds 1 to 400, mulberry32 from `tests/models/fight-play.ts`). The monster does not attack: nothing in these parties reacts to hunter HP, so its attacks would not move the rounds.

Builds (audit section 3): E +3, 1d8+1; C +26, 1d10+22; S +85, 2d6+77.

Mean rounds to kill (sd), and the ratio to the attackers:

| Rank, target | Attackers | Three statuses | Burning only |
|---|---|---|---|
| E boss (60 HP, AC 15) | 8.70 (2.12) | 5.91 (0.96) ×0.68 | 6.81 (1.37) ×0.78 |
| E normal (20 HP, AC 13) | 2.86 (0.97) | 2.67 (0.69) ×0.93 | 2.54 (0.68) ×0.89 |
| C boss (450 HP, AC 26) | 6.20 (0.40) | 6.81 (0.47) ×1.10 | 6.08 (0.29) ×0.98 |
| C normal (150 HP, AC 24) | 2.25 (0.43) | 2.96 (0.23) ×1.32 | 2.48 (0.50) ×1.10 |
| S boss (6000 HP, AC 52) | 25.57 (0.72) | 27.09 (0.69) ×1.06 | 23.98 (0.62) ×0.94 |
| S normal (2000 HP, AC 50) | 8.80 (0.48) | 9.63 (0.52) ×1.09 | 8.48 (0.51) ×0.96 |

Ticks the fights rolled: Burning E 1d6, C 3d8, S 7d12; Bleeding E 1d4, C 2d6, S 4d8; Poisoned E 1d4, C 1d6, S 1d12 (printed by the test), so the statuses ticked at the hunters' rank.

**Five cases fail their bound** (bounds and curves unchanged):

- E boss, three statuses ×0.68 and Burning only ×0.78: below 0.8.
- E normal, three statuses ×0.93 and Burning only ×0.89: faster than the attackers.
- S normal, Burning only ×0.96: faster than the attackers.

Why, checked against arithmetic (so the numbers measure what they claim):

- Attackers match the audit: E boss 3 × 0.45 × 5.5 = 7.4 a round → 8.1 rounds, measured 8.70 (a fight is counted in whole rounds and the last hit overkills, about +0.5). C boss 450 / (3 × 0.95 × 27.5) = 5.7 → 6.20. S boss 6000 / 239.4 = 25.1 → 25.57. S normal 8.35 → 8.80.
- E: the E numbers are today's (the design keeps them). An E hunter hits AC 15 45% of the time for 5.5, so an attack is worth 2.5 a turn, while Burning is a sure 3.5 for three turns and all three statuses are 8.5 a round. A status hunter at E is worth over three attackers against a boss. The curves cannot fix this without changing an E value, which the brief forbids. It is the audit's own number: Burning is 1.16 of an attack at E.
- S normal: the monster lives 8.8 rounds. The design says a hunter who keeps Burning up deals about 1.2 of an attacker's damage on a target that lives four rounds or more: (2/3 × 79.8 + 45.5) / 79.8 = 1.24, so the party is 0.94 of the attackers' rounds on any long-lived target. The design's arithmetic and the brief's "a normal monster is never faster" bound disagree for an S normal monster, which is a long fight, not a pack fight. The bound reads as written for a target that dies in about two rounds (C normal passes at ×1.10).
- Noise: the standard error of a mean is sd / √400, at most 0.11 rounds (E boss attackers); the S normal gap (0.32 rounds) is about nine standard errors, the E gaps far more. Not noise.
- The five cases are `test.failing` in `tests/status-sim.test.ts` (list `OUTSIDE_BOUND`), so `bun run test` passes with the bounds as written, the miss is printed in the test names, and a change that brings a case inside its bound makes that test fail until it is taken off the list. `types/bun.d.ts` declares `test.failing`. The lead may prefer a plain failing test; it is a one-line change.
- Principle that changed a choice: explain-the-number (the attackers' rows checked against the audit's arithmetic, the tick dice printed, the standard error before calling a gap real).

## Step 8: checks and the recipe

- `bun run test`: 1349 pass, 0 fail (the five `test.failing` cases count as passes). `bun run deps -- --write` and `bun run charts` leave both files unchanged.
- Browser files, each run once: `character.e2e.ts` 12 passed, `combat-turns.e2e.ts` 11 passed, `table-session.e2e.ts` 5 passed. No browser test asserted a number that now scales: Poisoned on the sheet is added by the hunter's picker with no source, so it is tier E (−2, 1d4) as before. The only browser test changed is the Poisoned override in step 1.
- `AGENTS.md`, "A status" recipe: one sentence on `tiers` and the percent quantity.

## For unit B (found while doing this, not changed here)

- **Copies freeze tier E.** `statusDef(R, key)` with a bare key now resolves at tier E, and these paths store that resolved def on the instance, so the status never scales after: forge "Apply existing" and typed known name (`forge.js:128,141`, `cleanDef(E.statusDef(key))`), the item forge (`loot.js:67`, `sanitizeDef(e.statusDef(key))`), the GM board dialog (`gm.js:324`). A built-in needs no def on the instance (the rules know it); a custom one should copy the rules' entry as written, with its `tiers`. `combat.js:39` `defOf` copies the def resolved at the instance's tier, so a remote phone gets the right numbers but frozen at that tier.
- `rollFor` is not called yet: `rollNum` (`effects.js:28`) and `rollTick` (`combat.js:99-109`) read `dice` and `amount` only, so a `pct` op rolls 0 there.
- `room-events.ts:72` describes `a.def` (a definition); pass the instance to print its tier's numbers.
- An item's ops may now hold `tiers` (the forge could write them); nothing resolves an item op by rarity, so `effects.js` would skip such an op.
- Design point 5 (a status the GM applies with nobody acting takes the target's rank) is not done: `defaultSource` in `encounter.ts` still gives `{ kind: 'gm', tier: 0 }`. Not in this brief's steps.
