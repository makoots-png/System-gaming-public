# Brief: the rules global leaves core (M3 unit D)

Read `AGENTS.md` and `docs/agent-handoff/helper-rules.md` first. Where this brief and the rules differ, this brief wins.

You work in your own git worktree (your current directory) on your own branch. First run `git log -1 --format=%H`: if it is not the commit your prompt names, run `git reset --hard <that commit>`. Then `bun install`. Commit after every numbered step (plain messages, no AI attribution lines, never `.claude/`). Do not push. Do not start helpers of your own.

Another helper is writing `src/core/combat/encounter.ts` and `tests/encounter*.test.ts` in the main tree at the same time. Do not create or edit those files, and do not edit `src/views/combat.js` beyond its import lines.

Browser runs: `E2E_CHROMIUM=/opt/pw-browsers/chromium E2E_PORT=3251 bunx playwright test tests/e2e/<file> --workers=1 --trace off --output=/tmp/pw-rules`. Do not run `playwright install`.

Notes file (append a line after each commit): `docs/agent-handoff/p3/notes-rules-edge.md`.

## Why

`src/core/rules.js` has a global: the store calls `bindState(() => state)` so that `rules()` can read the GM's overrides from the save. Core is meant to be pure (a function's answer depends only on its arguments), and a lint rule now forbids module-level `let` in core with `rules.js` as the one exemption. This unit removes the exemption.

## Steps

1. Convert `src/core/rules.js` to `src/core/rules.ts`, strict. Export `type Rules = typeof RULES` (declare `RULES` so its numbers and strings are widened, not literal, because a GM override can change any of them; keep `deepFreeze`). Keep `rulesOf(overrides): Rules`. Every helper that called the global takes the rules as its first argument: `xpToNext(R, level)`, `rankForLevel(R, level)`, `formulaHpMax(R, stats, level)`, `formulaMpMax(R, stats, level)`. Delete `bindState`, `getState`, `rules()` and the cache from core. Fix the core callers (`save.ts`, `combat/status.ts`, `registry/statuses.ts`, `effects.ts`): where they declared their own loose rules type, use `Rules`.
2. `src/edge/rules.ts`: `rules()` (the current rules: `rulesOf` of the save's overrides, cached on the overrides' JSON as today) and the same helpers bound to it under their old names and old signatures (`xpToNext(level)` and so on), so no view changes its calls. It reads the save through a `bindSave` that `src/edge/store.ts` calls, or directly from the store if that makes no import cycle. Re-export from it the constants views import from rules today (`RULES`, `RANKS`, `STATS`, `STAT_KEYS`, `TIERS`, `EMBLEMS`, and so on) so a view has one import.
3. Point every import of `core/rules.js` in `src/views`, `src/edge` and `src/app.js` at `edge/rules.ts`. Change import lines only. `app.rules` keeps working.
4. Remove the `rules.js` exemption from the module-level `let` lint rule in `tests/lint.test.ts` and from `AGENTS.md`. Update the AGENTS.md layout and "Where things live" lines that name `rules.js`.
5. `bun run test` passes. Run `character.e2e.ts`, `customization.e2e.ts` and `gates-quests-dailies.e2e.ts` (they cover GM rule overrides, level-ups and gate spawns).

## Done means

- `grep -rn "bindState" src tests` is empty because the function is gone, and core has no module-level `let`.
- No view logic changed: `git diff --stat` for `src/views` shows import lines only.
- Final reply under 200 words: what you made, the last line of `bun run test` and of each Playwright run, anything you were unsure of.

If a step turns out to be wrong or much larger than it reads, stop, write why in the notes file and reply. Do not widen the task.
