# Brief: status registry and typed status core (M3 unit A)

Read `AGENTS.md` and `docs/agent-handoff/helper-rules.md` first. Where this brief and the rules differ, this brief wins.

You work in the repo root on the branch that is checked out. No other helper is running. Commit after every numbered step (plain messages that say what changed, no AI attribution lines, never `.claude/`). Do not push. Do not start helpers of your own.

Browser runs: `E2E_CHROMIUM=/opt/pw-browsers/chromium E2E_PORT=3241 bunx playwright test tests/e2e/<file> --workers=1 --trace off --output=/tmp/pw-status`. Do not run `playwright install`.

Notes file (append a line after each commit): `docs/agent-handoff/p3/notes-status.md`.

## Why

Statuses (Poisoned, Burning and so on) are plain objects in `RULES.conditions` inside `src/core/rules.js`, and the code that reads them is untyped `src/core/effects.js`, which also holds a store-writing function and reads rules from a global. The owner adds statuses often. He wants one typed place for a status, a test that every status must pass, and a recipe. The combat reducer (the next unit) and phase 4 (status scaling by the strength of whoever applied the status) build on the types you write here.

## Decisions already made (do not reopen)

- A status instance carries its source: `{ kind: 'hunter' | 'monster' | 'shadow' | 'item' | 'gm', id: string | null, name: string, tier: number }`. `tier` is 0 to 5 and is a snapshot taken when the status is applied: a hunter's or monster's rank index (E=0 to S=5), an item's rarity index (common=0 to mythic=5), 0 for the GM. Nothing scales by tier yet. Phase 4 does that.
- Stacking: one instance per status key per target. Applying a key the target already has keeps one instance: the source with the higher tier wins (a tie goes to the new one, and its `def` comes with it), and `rounds` is the longer of the two (`null`, until removed, beats any number). Different keys stack freely. Reason: phase 4 lets a stronger source's status take the place of a weaker one, one instance per key keeps a turn readable, and many different statuses on one target is a build the owner wants to work.
- Core functions take the rules as an argument (`R`). They never call the global `rules()`.

## Steps

1. `src/core/combat/status.ts`, strict TypeScript, pure. Types: `Op` (a union with one member per op: `heal`, `mp`, `fatigue`, `damage`, `mod`, `applyStatus`, `cureStatus`, `note`, each with optional `when: 'use' | 'equip' | 'turn'`), `StatusDef`, `Source`, `Status = { key: string; rounds: number | null; def?: StatusDef; source?: Source }`. Functions, ported from `effects.js` with the same behaviour, each taking `R` where it needs rules: `sanitizeOps`, `sanitizeDef`, `statusDef(R, statusOrKey)`, `mods(R, statuses)`, `turnOps(R, statuses)`, `slug(R, label, taken)`, `describe`. New functions:
   - `sanitizeSource(value): Source | null`.
   - `applyStatus(list, incoming): Status[]` (the stacking rule above, returns a new list).
   - `removeStatus(list, key): Status[]`.
   - `tickStatuses(R, list): { statuses: Status[]; ops: TurnOp[]; expired: Status[] }`: what a turn start does. Per-turn ops are collected before the countdown, so a 2-round status ticks twice. Then every numbered `rounds` goes down by one and a status at 0 leaves. This is today's `begin()` in `src/views/combat.js`, lines 80 to 93.
   - `resolveStatusKey(R, typedName): string | null`: the key of the status whose label equals the typed name, ignoring case and extra spaces. Built-in or custom.
   Write `tests/status.test.ts` first for the new functions and the stacking rule (name each test after what a GM or player sees). Port any behaviour from `effects.js` that `tests/` already covers.
2. `src/core/registry/statuses.ts`: the built-in statuses as one typed table, moved out of `rules.js` (`RULES.conditions` now refers to it, so GM overrides in `rulesOverrides.conditions` keep working). Export `StatusKey` (the union of built-in keys) and named constants for the keys code refers to by name (`unconscious`, `penalized`, `exhausted`). Add `tests/statuses.test.ts`: one table test that every built-in must pass (has a label and a description, its ops survive `sanitizeOps` unchanged, `describe` gives a line for each mechanical op). This is the test a new status copies.
3. Split `src/core/effects.js`. Item effects (`legacyOps`, `effectsOf`, `FULL`) go to `src/core/effects.ts`, typed. `applyOps`, `rollOps` with the app roller, the `A` global and `register` are not core (they write the store and call the dice view): move them to `src/views/effects.js`, which registers `app.api.effects` with the same surface as today by passing the current rules into the core functions. Views keep calling `app.api.effects.*` unchanged. Fix every import (`src/core/save.ts` wraps effects.js today: use the typed functions directly and make `Condition` in `save.ts` the `Status` type; the old `src?: string` field goes, check with grep that nothing writes it). Delete `src/core/effects.js`. `bun run test` passes.
4. The save carries the source. `save.ts` repair keeps a valid `source` on a hunter's status and drops a malformed one. Add cases to `tests/save.test.ts`.
5. Bug 4 (`docs/agent-handoff/p3/bugs-found.md`), both halves, in `src/views/forge.js`:
   - On a phone the Status window's "Apply existing" list has height 0. Fix the CSS.
   - Typing the name of an existing status with no mechanics chosen applies that status (use `resolveStatusKey`), not a second `poisoned-2`. A typed name with mechanics chosen is still a new status.
   Remove the `fixme` in `tests/e2e/table-session.e2e.ts` and make that test pass. Add a browser test for the typed name if the file has none. Run `table-session.e2e.ts` and `character.e2e.ts`.
6. Add to `AGENTS.md`: a row in "Where things live" for statuses, and a short recipe "To add a status" (the registry entry, the test, the command). Add the lint rule in `tests/lint.test.ts` and name it in `AGENTS.md`: `src/core` has no module-level `let` (a global there is hidden state; `effects.js` had one). If `rules.js` still needs its `bindState` global, exempt exactly that file with a comment that says another unit removes it.

## Done means

- `bun run test` passes. The two browser files pass.
- `src/core/effects.js` is gone and nothing in `src/core` reads rules from a global except `rules.js` itself.
- Your final reply is under 200 words: what you made, the last line of each command you ran, anything you were unsure of or left out.

If a step turns out to be wrong or much larger than it reads, stop, write why in the notes file and reply. Do not widen the task.
