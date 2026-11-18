# Brief: skills that act, the `use` command, enemies with skills (customization, unit 2)

One helper (Opus, heavy-writer), in the main tree, on branch `claude/zen-pasteur-ov4cgd`. No other helper writes while you work. Unit 1 (`cz/notes-1-homes.md`) is merged: `parseItem`, `parseMonster`, `library.statuses`, the exported tier resolver.

Run `bun install` once. Read first: `AGENTS.md` (the recipe "A combat command"), `docs/agent-handoff/helper-rules.md`, `docs/agent-handoff/cz/design.md` (sections "Items", "Skills"), `docs/agent-handoff/cz/inventory.md` (sections 1 Ability and Enemy, 3 and 4), `docs/agent-handoff/cz/notes-1-homes.md`, the chart "A fight" in `docs/state-machines.md`. Principle skills: `principle-model-the-domain`, `principle-type-system-discipline`, `principle-make-operations-idempotent`, `principle-test-behavior-not-implementation`, `principle-explain-the-number`, and `unslop`.

Commit after every numbered step (name the files, plain messages, no AI attribution, no Co-Authored-By). This overrides the "do not commit" line of your built-in rules. Do not push. Do not start helpers of your own. Never edit anything under `.claude/skills`.

Browser runs: `E2E_CHROMIUM=/opt/pw-browsers/chromium E2E_PORT=3243 bunx playwright test tests/e2e/<file> --workers=1 --trace off --output=/tmp/pw-cz2`. Never run `playwright install`. Rerun a file once before reading anything into one failure.

Notes file (append a line after each commit): `docs/agent-handoff/cz/notes-2-skills.md`.

## Why (the owner's goal)

"The ability to make custom abilities, status effects, custom rewards, items, enemies, etc..." Today a skill spends MP, rolls its dice and shows a toast. It hits nothing and applies nothing, an item's damage only writes a line, and a monster's ability is text. A custom ability has to do something in a fight, for a hunter and for an enemy, through one path. This unit builds that path in the core and wires the smallest UI that proves it. The makers come in unit 4.

## The decided model (from `design.md`)

```ts
// Skill gains (save.ts): effects: Op[]; target: 'self' | 'other'; attack: boolean.
// dice stays: a roll the table reads.
// Item gains: target: 'self' | 'other' (default 'self').
// Monster gains: skills: Skill[]; statuses: { key: string; rounds: number | null }[];
//                loot: { gold: number; items: ItemTemplate[] }.   elite is already kept.
type Outcome =
  | { kind: 'damage' | 'heal' | 'mp' | 'fatigue'; n: number }
  | { kind: 'status'; key: string; rounds: number | null; def?: StatusDef }
  | { kind: 'cure'; key: string }
  | { kind: 'note'; text: string };
// Command gains:
{ type: 'use'; by: CombatantId; on: CombatantId; name: string; outcomes: Outcome[] }
```

## Steps

Each step: tests first, then the change, then `bun run test`, then commit.

1. **`parseSkill` in core and the skills table.** `src/core/registry/skills.ts`: the eight seeds moved from `src/views/skills.js`, typed, and `parseSkill(unknown): Skill | null` with bounds (name 60, level 1 to 10, mpCost and cooldown as the form clamps them today, `dice` checked as a dice expression or empty, `effects` through `sanitizeOps`, `target` and `attack` with defaults `self` and `false`, the bonus as today). The save repair and the skill form call it; the form's silent roll check goes. Give a seed effects where its description already promises a mechanic the ops can say (for example a seed that says it applies a built-in status applies that status, by the constant from `registry/statuses.ts`); change no seed's numbers, and list each seed's effects in the notes with the sentence of its description it comes from. `tests/skills.test.ts`: every seed passes the parser unchanged, hostile input, bounds. `library.skills: Skill[]` in the save (cap 200, through `parseSkill`), with a case in `tests/save.test.ts`. The perk skill rebuilt at repair keeps working.
2. **`outcomesOf` in core** (`src/core/combat/use.ts`): `outcomesOf(ops, tier, target: { hpMax: number }, roll: (dice: string) => number): Outcome[]`. It resolves `tiers` at `tier` (the exported resolver), reads a `pct` against the target's max HP (`rollFor`), rolls dice through the injected `roll`, and maps: `damage`, `heal`, `mp`, `fatigue` to their outcome with a whole number of at least 0; `applyStatus` to `status` (carrying a `def` when the op has one); `cureStatus` to `cure`; `note` to `note`; `mod` to nothing (a mod belongs to a status or a worn item). Only ops whose `when` is `use` or the default for a used thing count. Tests in `tests/use.test.ts` with a fixed roller: one case per op, `tiers` at two tiers, `pct` of 200 max HP, the full-heal amount.
3. **The `use` command** in `encounter-types.ts` and `reduce` (the recipe in `AGENTS.md`; the typecheck asks). It applies each outcome to `on` exactly as the existing commands do (`changeHp`, `changeMp`, `changeFatigue`, `applyStatus` with `sourceOf(by)`, `removeStatus`), so death, the remote-hunter effects and the status stacking rule are the ones those commands have: reuse their code paths inside the reducer, do not copy them. One log line: "X uses N on Y: 7 damage, Poisoned (3 rounds)" (add the wording to `docs/agent-handoff/copy-tasks.md`). It refuses, with a `refused` effect, a `by` or `on` the fight does not have, a fight that is not running, and more than 8 outcomes. `mp` and `fatigue` on a combatant that has neither change nothing. Tests in `tests/encounter.test.ts`: damage drops HP and can defeat; a status lands with the user's rank tier as its source and replaces a weaker one; heal on a hunter; each refusal; the effects it emits for a remote hunter equal those of the single commands. Add `use` to the random play in `tests/models/fight-play.ts` so `tests/encounter-model.test.ts` covers it, and give it its label in `scripts/charts/fight.ts` only if it moves between phases (it should not). `bun run charts`.
4. **A monster with skills, starting statuses and loot.** `parseMonster` reads `skills` (each through `parseSkill`, at most 12), `statuses` (key a slug, rounds 1 to 999 or null, at most 8) and `loot` (gold 0 to 1e9, items through `parseItem`, at most 20). The combat row of a monster (`Monster` in `encounter-types.ts`) carries `skills`; `toCombatant` in `bestiary.js` passes them and adds the starting statuses with the monster as source. Tests: `tests/monsters.test.ts` (parser), `tests/encounter.test.ts` (a monster row built with a starting status has it at round 1 with the monster's rank tier).
5. **Wire a hunter's skill in the GM's fight** (`src/views/combat.js`, `src/views/skills.js`). On the GM's phone, a local hunter's active skill used on its turn: `skills.use` still pays MP and sets the cooldown and rolls `dice`. When the skill has effects: `target: 'self'` sends `use` with `by` and `on` the hunter; `target: 'other'` asks for the target with the picker the monster abilities already use, and, when `attack` is on, rolls the hunter's attack against the target's AC first with the hunter's existing attack numbers (`hunterAttack`'s) and sends a `note` on a miss instead. The view builds outcomes with `outcomesOf` at the hunter's rank tier and the app's dice roller. Outside a fight a `self` skill applies its outcomes to the hunter through the hunter API as an item's use does (find `applyOps`), and an `other` skill shows the outcomes in the toast for the GM to rule on.
6. **Wire an item with `target: 'other'`** the same way: used from a local hunter's card in a fight, it asks for the target and sends `use` at the item's rarity tier. `target: 'self'` is unchanged. An item's `damage` op with `target: 'self'` keeps today's behaviour (a line). Do not touch what a player's phone in a room sends: unit 3 replaces it.
7. **Wire a monster's skills on its card**: each skill of a monster row is a button beside its text abilities (same look as the ability buttons). A tap picks the target (default the current target as abilities do), rolls to hit with the monster's attack bonus when `attack` is on, and sends `use` at the monster's rank tier. A skill's cooldown and cost are shown as text only.
8. **Browser tests**, in a new `tests/e2e/custom-skills.e2e.ts` (copy `tests/e2e/combat-turns.e2e.ts`; set content up through the store, drive the use through the UI): (a) a GM's local hunter uses a skill with `target: 'other'`, a fixed `damage` amount and a status, on a monster: the monster's HP drops by that amount and its card shows the status; (b) a monster with a skill that applies Poisoned uses it on the hunter: the hunter's card shows Poisoned and the log has the line; (c) a monster with a starting status shows it when the fight starts; (d) an item with `target: 'other'` and a fixed damage hurts the picked monster and its quantity drops by one.
9. `bun run test`, `bun run deps -- --write`, `bun run charts`, then every browser file that touches a fight or a sheet: `grep -l "combat\|skill\|bestiary\|inventory" tests/e2e/*.e2e.ts` and run each. `AGENTS.md`: a "A skill" recipe (the table, `parseSkill`, effects, target, attack), the Monster recipe (skills, statuses, loot), a line in "Where things live" for a use (`src/core/combat/use.ts`, `tests/use.test.ts`).

## Rules

- No number of a built-in changes. A seed gains effects only where its text already promises them.
- The reducer stays pure and never throws; rolling happens in the view.
- A use applies once: a double tap must not apply twice. Say in the notes how the view prevents it (the button's own disabled state while the picker is open is enough; no timers).
- Loot on a monster is only stored and parsed in this unit. Unit 4 offers it at the end of a fight.
- Core stays pure. Views stay JavaScript and pass `tsconfig.views.json`.
- If a step needs a decision the design does not make, choose the smaller option, write it in the notes under "Decided by the helper", and go on.

## Done means

`bun run test` passes and the browser files of step 9 pass. Final reply under 200 words: the commit range, the counts, each seed's new effects in one line, what you decided yourself, anything unsure.

If you are still going after about 80 minutes of work, commit what passes, write exactly where you are in the notes, and reply.
