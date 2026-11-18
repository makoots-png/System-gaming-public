# W8, delete the old fight: notes

Worktree `/home/user/systemgaming/.claude/worktrees/agent-ac44a6e399f90b661`, branch `worktree-agent-ac44a6e399f90b661`, commits 94b0fd0..(this notes commit) on f3a51e8. Not pushed. `docs/dependency-map.md` is not committed (stale; the lead regenerates it).

## For the lead first

- **No W6b file had to keep an export for me.** At f3a51e8 none of `table.js`, `uses.js`, `skills.js`, `inventory.js`, `combat.js`, `fight-view.ts`, `protocol.ts`, `room-events.ts` imports anything I deleted, and I changed none of them. W6b's merge must still pass the five new lint rules (below): a view's `Math.random` (outside dice.js, gates.js, gm.js, inventory.js), an import of a fight calculation into a view (outside the list in the rule), a write to a row's `place`/`hp`/`shield`/`stagger`/`channel`/`threat`/`statuses` outside the fight's modules, or a bare number in `fight-view.ts` other than 0, 1, 2, 100 would turn `tests/lint.test.ts` red.
- **Files outside my list, smallest change each, to make the new lint rules hold on the tree:**
  - `src/views/hunter.js` (2 lines): the death save's fallback d20 is `rollDice({ count: 1, sides: 20 })` from `src/edge/roll.ts`, not `Math.random`.
  - `src/core/rules.ts` (1 line) and `src/core/hunter/derive.ts` (1 line): the 2:1 build split was `points * 2 / 3` in `split`; it is `RULES.fight.mainShare: 2 / 3` with its reason. A balance number (every monster, shadow and starter is built from it). A GM may now type over it, like every `fight` number.
  - `src/core/combat/resolve.ts`: `d20 * 5 <= chance` reads `d20 * 100 / 20 <= chance` (the same integers: a face is a twentieth of 100%).
  - `src/core/combat/effect-ops.ts`: `freeStatusKey` cuts at `STATUS_KEY_MAX` (40) in place of two bare 40s; `atTier` clamps at the tiers' last index (`v.length - 1`) in place of 5.
  - `src/core/combat/fight-turn.ts`: `startTurn`'s loop guard `4 * rows + 4` is `PASSES_PER_ROW * (rows + 1)`, a named constant that says it is a guard, not a rule.
- `tests/statecharts.test.ts` needed no rewrite: it reads `MACHINES`, so dropping the old machine was enough.

## Steps

1. 94b0fd0: deleted `encounter.ts`, `encounter-types.ts`, `encounter-parse.ts`, `use.ts`, `status.ts`, `ability.ts`, their six tests (`encounter`, `encounter-model`, `use`, `status`, `ability`, `status-sim`), `scripts/charts/fight.ts` and `tests/models/fight-play.ts`. `scripts/charts/fight2.ts` became `scripts/charts/fight.ts` (export `fight`, machine "A fight"; its "Who calls it" row is `send()` in `combat.js`). `tests/models/fight2-play.ts` became `tests/models/fight-play.ts` and defines the seeded `rng` itself, so the five tests that import `rng` from that path did not change. `monsters.ts` lost `monsterSource` (no caller left) and its imports of `encounter-types.ts` and `status.ts`. Comments that said the old modules stay until W8 are gone (`effect-ops.ts`, `fight-types.ts`, `abilities.ts`). `docs/state-machines.md` regenerated.
2. 397b9dc: `mod`, `STATS`, the `STAT_KEYS`/`StatKey` re-exports of `rules.ts` (`paths.ts` and `paths.test.ts` import from `stats.ts`), `formulaHpMax` and `formulaMpMax` (core and edge), `RULES.hp`, `RULES.mp`, and `mpOf`, `changeMp`, `setMp` in `vitals.ts`. A GM override of `hp` or `mp` is now refused as `unknown` (added to the removed-rules case in `rules.test.ts`); the override examples that used `hp` use `fatigue`. `PERK_LABELS.ac` was already gone (W1a).
3. 7282dfb: the lint rules below, the vitals rule on `mana` (field list, message `changeMana`/`setMana`, stale exceptions `o`, `out` and `encounter.ts` dropped), and the source changes listed above.

Lines: `git diff --stat f3a51e8 | tail -1` before this notes file: `34 files changed, 410 insertions(+), 3311 deletions(-)`. Files deleted: 14 (3060 lines), `git diff --stat --diff-filter=D f3a51e8 | tail -1`: `14 files changed, 3060 deletions(-)`.

## The new lint rules (tests/lint.test.ts)

Each test's name is the rule; its comment says why, its message what to do instead; each has "the rule sees" cases on old lines.

1. **"a view rolls no fight die: the dice of a fight come from src/edge/roll.ts"**: no `Math.random` or `crypto.getRandomValues` in `src/views`, except an id (`Math.random().toString(36)`) and four files that roll no fight number, each named with its reason (dice.js the dice tray, gates.js a gate's spawn source, gm.js a roll table line, inventory.js a loot roll). It also fails when an allowed file stops rolling, so the list cannot go stale.
2. **"a view computes no fight number: from the modules that work one out it imports only names, constructors and the dice a use needs"**: for `formula.ts`, `derive.ts`, `resolve.ts`, `space.ts`, `timeline.ts`, `stats.ts`, `effect-ops.ts`, `fight-turn.ts`, `fight-channel.ts`, a view may import only the names listed (today's: `parseFormula`, `printFormula`, `SHEET_LABELS`, `needs`, `diceFor`, `place`, `tiles`, `openGrid`, `tick`, `roundOf`, the stat labels, `above`, `FULL`, `addSheetStatus`, `describeStatus`, `freeStatusKey`, `opLines`); `import * as` or `import()` of one fails. Reads whole files, so a multi-line import counts; JSDoc types are skipped.
3. **"only the fight changes a combatant's place, HP, shield, stagger, channel, threat or statuses"**: outside `src/core/combat/fight*.ts`, `resolve.ts`, `effect-ops.ts`, no assignment to or in-place list change of those fields, and no copy `{ ...x, <field>: }`. Not combatants: a saved shadow `s` (combat.js's shadowHp effect, shadows.js), the save repair's `x`, `library.statuses`, and protocol.ts's payloads and doc rows.
4. **"nothing imports a module deleted with the old fight"**: the eight deleted paths (six modules, the old chart name `fight2.ts`, the old model `fight2-play.ts`) must not exist, and no relative import in `src`, `scripts`, `tests` or `server.ts` resolves to one; each hit names what replaced it.
5. **"no balance number is a literal in the fight's rule modules: it is a rule in RULES.fight"**: in `fight*.ts` (but `fight-parse.ts`), `resolve.ts`, `effect-ops.ts`, `space.ts`, `derive.ts`, `sheet.ts`, a number other than 0, 1, 2 and 100 fails, outside strings, comments and lines that declare an UPPER_CASE constant (a named cap of data). One decimal place (`* 10) / 10`) and 20 on a line that names `d20` are allowed. Its limits, said here because a grep cannot hold them: a balance factor that is exactly 2 or 100 slips through, and so does one written as a named UPPER_CASE constant; `fight-parse.ts` is out (its numbers bound outside data); `timeline.ts` is out (its d20 is called `roll`, so its 20 cannot be told from a number) and `rows.ts` is out (it letters a pack with 26 and 65).

**How I checked each fails when broken**: I appended, all at once, `const nat = 1 + Math.floor(Math.random() * 20);`, `import { resolve } from '../core/combat/resolve.ts';` and `row.shield = null;` to `src/views/hunter.js`, `import { applyStatus } from './status.ts';` to `fight-doc.ts` and `const decay = (t: number) => t * 0.9;` to `resolve.ts`, ran `bun test tests/lint.test.ts`: `21 pass, 5 fail`, each new test failing on exactly its line (the deleted import named "now src/core/combat/effect-ops.ts"). Then `h.mana = 3;` in hunter.js failed the vitals rule. Restored from copies: `26 pass, 0 fail`.

Left out: "no arithmetic on HP, damage, speed, distance or a chance in src/views" as a text grep. A regex for an operator next to those names finds bar widths (`hp / hpMax`), the HP field's `a/b` text, the GM's "Mark defeated" (`hp: -hpMax`), the heal toast's difference and copy, and misses arithmetic on a renamed variable; it cannot be held without false alarms. Rule 2 holds the same boundary at the import: a view cannot reach a function that works a fight number out.

## The grep gate (plan 4.4, W8), each on `src`

Empty: `encounter\.ts|encounter-types|encounter-parse`, `combat/use\.ts`, `combat/status\.ts`, `combat/ability\.ts`, `\bmod\(`, `formulaHpMax`, `formulaMpMax`, `cdLeft`, `mpCost`, `\b(dex|con|int|wis|cha)\b\s*:|['"](dex|con|int|wis|cha)['"]|\.(dex|con|wis|cha)\b`, `-w ac` outside `src/edge/sync.ts` (an AbortController named `ac`).

Not empty, none of it the old thing:
- `derived\(`: `bestiary.js:334, 344, 349` call the monster maker's own local `derived()` (its HP · Armor · Resist · Speed line from `monsterSheetOf`), not `app.api.hunter.derived`.
- `\bbonuses\b`: words in `rulesref.js:124` and comments and a parameter in `sheet.ts`, `derive.ts`. No `Bonuses` type or `bonuses` API member is left.

Plan section 2 rows checked by grep, all gone: `hunter.derived`/`Derived` (the type; "Derived" is the panel's title), `capacityStat`, `skillDC`, `passivePerception`, `legacyOps`, `restoreMp` (one comment in items.ts tells the old field's mapping), `rankTable[..].hp/ac/atk/dmg/init`, `RULES.boss`/`elite`, the six-key `S(...)`. `newStats` stays (eight keys). `newMonster` stays: `bestiary.js:492` still calls it.

## Left for the lead or W9

- `monsters.ts:83`: the Steel-fanged Lycan's note says "bites ignore 2 AC of armor"; AC no longer exists (plan 3.2 wanted a strike with `pen`). Content of W1b's registry, a copy task.
- `rulesref.js:95` works a check's bonus out itself (`Math.floor(exX / 2)`, the `checkBonus` rule) and `:129` an armour example (`Math.round(100 - ...)`), both for the rules page's worked examples. Neither is a fight number on a fight screen, and rule 2 does not see arithmetic; W9 may move them to `checkBonus` and a `derive.ts` call.
- `forge.js:25` keeps its own `gmSource`, the same as `effects.ts`'s.
- `effects.ts`'s `itemOps(item, 'equip')` answers `[]` and only `items.test.ts` asks for `'equip'`; `inventory.js` (W6b's) calls it with `'use'`. Can become `effectsOf` once W6b is in.
- `RULES.rest.*.mpPct` is still named `mp` (a GM rule key; renaming refuses old overrides and touches `rulesref.js`, `vitals.ts`).
- AGENTS.md still describes the old fight, `use.ts` and `status.ts` (W9's).

## Principles that changed a choice

- subtract-before-you-add: `monsterSource` went with its last caller; the old model file's `rng` moved into the surviving model under the old file name rather than into a new helper file.
- explain-the-number: the 2:1 split became a rule with its reason rather than an allowlisted literal; the three structural numbers got names that say they are not rules.
- encode-lessons (lint): every rule has "the rule sees" cases taken from the old code, and the roll rule fails when its exception list goes stale.

## Checks (last lines)

- `bunx tsc --noEmit --pretty false 2>&1 | cut -d'(' -f1 | sort | uniq -c`: no output (no error anywhere).
- `bunx tsc -p tsconfig.views.json --noEmit --pretty false 2>&1 | cut -d'(' -f1 | sort | uniq -c`: no output.
- `bun run build`: `Built 12 files into dist/ (build 2996545288cb)`.
- `bun run charts`: `wrote .../docs/state-machines.md` (no change after step 1's commit).
- `bun test tests/statecharts.test.ts`: `15 pass`, `0 fail`.
- `bun test tests/lint.test.ts`: `26 pass`, `0 fail`.
- `bun test`: `2161 pass`, `1 fail`, `Ran 2162 tests across 53 files. [84.68s]`. `bun test 2>&1 | grep -E '^\(fail\)' | wc -l`: 1, "the committed dependency map is what bun run deps -- --write writes" (the map is the lead's). With `bun run deps -- --write` run, `tests/deps.test.ts` is `12 pass, 0 fail`; I put the committed map back afterwards.
- Red after W8: only that deps map test, until the lead regenerates the map. Browser files not run (the brief says not to).
