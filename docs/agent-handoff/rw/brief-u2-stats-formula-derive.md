# Brief, unit 2: the eight stats, the fight's rule numbers, `formula.ts` and `derive.ts`

One helper (Opus, heavy-writer), in the main tree. Commit after each numbered step with `git commit -m "..." -- <paths>` (plain message, no AI attribution, no Co-Authored-By; this overrides "do not commit" in your built-in text). Do not push. Do not start helpers. Never edit `.claude/skills`. Do not run `bun run ci` or Playwright (a push may hold port 3218). Your checks are `bun run typecheck` and `bun run test`.

Read first, in full: `AGENTS.md`, `docs/agent-handoff/rw/principles.md` and the leaf skill of each row you touch (foundational-thinking, model-the-domain, type-system-discipline, boundary-discipline, laziness-protocol, explain-the-number, test-behavior-not-implementation), `docs/agent-handoff/rw/design.md` (the summary, sections 2, 3.3, 3.4 and 7), `scripts/rw-paper.ts` in full (its `PAPER` table is the source of every number; your code must print the same tables), `src/core/rules.ts`, `src/core/combat/timeline.ts` and `space.ts` (the style and the `TimelineRules` and `SpaceRules` types you must satisfy), `docs/agent-handoff/rw/notes-u1.md`, `.claude/skills/unslop/SKILL.md`.

## Why (the owner's goal)

the owner is the GM of a tabletop game played on phones. He is reworking the fight: eight stats, Armor and Resist in place of AC, formulas he can type over ("Give me a recommendation for a formula based off things I tick, but give me the ability to overwrite it. If I want to break the game balance I can do so."), with an architecture that stays "ROCK solid". The design is `rw/design.md`. This unit makes its section 2 and 3.4 real code: one place for the stats, one for the numbers, one formula parser, one function from a build to its `Sheet`. A reducer and a balance simulation come next and call these. No screen changes.

## How this unit sits beside the old code (the lead's decision)

The old fight, the six stats and AC stay as they are until one later wiring unit deletes them, because every push must pass the whole CI and no screen changes until the balance bounds hold. So you add, and change no behaviour:

- The eight stats live in a new `src/core/stats.ts` (`STAT_KEYS`, `StatKey`, labels, `eff`, `capped`). Do not touch the six in `rules.ts`. To keep the two apart for a reader, the old names stay as they are and nothing new imports them.
- The rule numbers go into `RULES` in `src/core/rules.ts` under one new key, `fight`, typed, with each number's reason as a short comment taken from the design (this is where "explain the number" lives in code). A GM's override of a `fight` number must work through the existing `parseOverrides` with no new code; add a case to `tests/rules.test.ts` that shows it. `RULES.fight` must satisfy `TimelineRules` and `SpaceRules` (a test assigns it to both types).
- New files otherwise: `src/core/formula.ts`, `src/core/hunter/derive.ts`, `tests/stats.test.ts`, `tests/formula.test.ts`, `tests/derive.test.ts`.

## Steps

1. **Types and tables first.** `stats.ts` with the eight keys and the curve functions. `RULES.fight` holding every constant of `PAPER` that sections 1, 2, 3, 4 and 5 of the design use (group them as the design's sections do: time, stats, defence, reaction, kits, monster kinds, channel, threat, stagger, shield, space). `Sheet` in `derive.ts` as the design's section 2.2 lists it, every field named and typed (a share is not a bare number if the design distinguishes it), plus the input types: a `Build` (stats, level, rank, the kit or gear weights and bonuses, perks as bonuses on `Sheet` or stat keys) and the monster input (rank, archetype, kind). `bun run typecheck`. Commit.
2. **`formula.ts`.** `parseFormula(text): { ok: true, formula: Formula } | { ok: false, error: string }` where `Formula` is a tree (a discriminated union: number, dice, a name read from the user or the target, a binary op, `min`, `max`, `charge`), and `evaluate(formula, env)` where `env` gives the user's and target's stats and `Sheet`, the dice numbers in reading order and the charge. Also `diceOf(formula)` (which dice the edge must roll) and `average(formula, env)` (dice at their means, for previews and the simulation's paper check). Grammar exactly as design 3.4. The parser refuses only what it cannot read (an unknown name, a broken expression) with a message a GM can act on; it never refuses a formula for being strong. Names are checked against `STAT_KEYS` and the keys of `Sheet` through one table, so adding a `Sheet` field makes it a legal name with no parser change (a test shows it). `evaluate` trusts its tree (boundary-discipline): no validation inside. Division by zero and a non-finite result have one stated rule from the design; if the design is silent, the result is 0 and you say so in the notes. `tests/formula.test.ts`: each grammar rule with a literal expected value worked by hand, precedence and associativity (`2^3^2`, `-2^2`, `2+3*4`), the design's example formulas, every refusal with the name it could not read, `diceOf` and `average`, and a round trip (a parsed formula printed and parsed again is the same tree) if you write a printer; write one only if the maker will need it (it will: the maker shows a recommended formula as text). Commit.
3. **`derive.ts`.** `sheetOf(build, rules)` for a hunter, `monsterSheet(rank, archetype, kind, rules)` and the shadow's, all through the same formulas (a monster is a hunter of its rank's level, design 2.4). Gear weight and the load factor as design 2.3. Status ops that change a stat or a derived number are applied by a later unit; leave one clearly typed seam for them (a list of modifiers the function takes, empty for now) only if the design's section 2 or 3.3 already defines its shape; otherwise leave it out and say so. `tests/derive.test.ts`: the five builds at E, C and S against the tables `bun scripts/rw-paper.ts` prints for section 2, typed in as literals (not imported from the script), the monsters by rank and kind, the three kits, and the bounds the design states for the curves (for example the fastest S build's speed over the slowest's is at most the design's N; raising a stat never lowers a number it feeds; no share passes its cap for any stat from 0 to 1000). Commit.
4. **One source for the paper.** Now that the constants are in `RULES.fight`, make `scripts/rw-paper.ts` read them from there and call `derive.ts`, `timeline.ts` and `space.ts` where it has its own copy of a rule, deleting the copy (subtract-before-you-add: one home for each number). Its printed output must not change: save the output before and after and `diff` them; put the diff's result in the notes. If a table differs, the code or the script has a bug: find which against the design's stated rule and fix it, and list it in the notes. Commit.
5. **Check and notes.** `bun run typecheck`, `bun run test` (all of it, the lint tests included), `bun run deps -- --write` and commit what it changes. Notes in `docs/agent-handoff/rw/notes-u2.md`: the exported names with one line each, every place the design was silent and what you chose, which principle changed a choice, the exact last line of `bun run test`.

## Rules

- Pure core TypeScript, strict, no `any`, no dependency, no module-level `let`, no browser API.
- No view, no edge file, no save shape, no existing test's expectations change (except the one new case in `tests/rules.test.ts`). If the rules' shape check (`parseOverrides`) needs a change to accept the nested `fight` key, make the smallest one and say so.
- A test's expected value comes from the design or the paper tables, never from running the code under test.
- No field on `Sheet` and no constant in `RULES.fight` that no rule in the design reads.
- Plain whole sentences; comments only for a why (a number's reason is a why).

## Done means

The three modules, `RULES.fight`, three new test files, the paper script reading the real code with unchanged output, typecheck and `bun run test` green, five or six commits, the tree clean.

## Time

75 minutes. Reply in at most 200 words: the commit range, the exact last line of `bun run test`, the result of the paper diff, and what the design left for you to decide.
