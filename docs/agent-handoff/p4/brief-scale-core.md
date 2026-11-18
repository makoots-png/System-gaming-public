# Brief: status scaling in the core (phase 4, unit A)

One helper (Opus, heavy-writer), in its own worktree. Another helper is working in the main tree on `src/core/protocol.ts`, `src/edge/sync.ts`, `src/views/combat.js` and the room model. Do not touch those files. If a step seems to need one, write why in the notes and leave it for unit B.

If `git log -1` in your worktree is not the commit your prompt names, run `git reset --hard <that commit>` first. Run `bun install` once.

Read first: `AGENTS.md`, `docs/agent-handoff/helper-rules.md`, `docs/agent-handoff/p4/design.md` (the decided model and every number), `docs/agent-handoff/p4/status-audit.md` (what exists, with lines). Principle skills for this unit: `principle-model-the-domain`, `principle-type-system-discipline`, `principle-boundary-discipline`, `principle-test-behavior-not-implementation`, `principle-explain-the-number`, `principle-migrate-callers-then-delete-legacy-apis`, and `tdd`. Where this brief and the rules differ, this brief wins.

Commit after every numbered step (name the files, plain messages, no AI attribution, no Co-Authored-By). Do not push. Do not start helpers of your own. Never edit anything under `.claude/skills`.

Browser runs: `E2E_CHROMIUM=/opt/pw-browsers/chromium E2E_PORT=3243 bunx playwright test tests/e2e/<file> --workers=1 --trace off --output=/tmp/pw-scale`. Never run `playwright install`. Rerun a file once before reading anything into one failure.

Notes file (append a line after each commit): `docs/agent-handoff/p4/notes-scale-core.md`.

## Why (the owner's goal)

"Make sure status effects scale a bit. It's ok for stronger ones to take the place of weaker ones as the game progresses, but even basic status effects should scale into the mid game at least a little." "The scaling should be largely decided by the strength of the user/item." "I don't mind some items/players/classes be death by a thousand effects rather than just damage output." And for the codebase: adding or changing a status must stay one table entry that one test checks.

## Steps

1. **Delete `checkMod`.** The built-ins write `{ op: 'mod', stat: 'check', value: -2 }`. Remove the field from `StatusDef`, the folding in `statusDef`, and every reader (`src/views/rulesref.js` has a "Check mod" column: print the status's `describe` lines there instead, which also puts the dice and the AC and attack numbers in that table). The browser test that overrides Poisoned (`tests/e2e/character.e2e.ts`, about line 244) writes its override as ops and keeps asserting the same attack and check numbers. `bun run test` and that browser file pass.
2. **Tests first for the type and the parser** (`tests/status.test.ts`): an op with `tiers` survives `sanitizeOps` only with exactly six valid entries (six quantities for a numeric op, six integers within the mod's existing bounds for a `mod`), and an op with a bad `tiers` is dropped whole, not kept flat; a quantity is a dice expression or `N%` with N from 1 to 100, and a percent is kept only on `damage` and `heal`; a flat op is unchanged. Then the type: `tiers` on an op and its flat number are not both required and cannot disagree (the type does not hold a tier 0 value twice). `MAX_TIER + 1` is the length.
3. **Tests first for resolution**: `statusDef(R, instance)` gives the ops at the instance's source tier, tier 0 with no source, and flat ops whatever the tier; `turnOps` and `mods` of a target follow; a def carried on the instance (with `tiers`) resolves at that instance's tier; `applyStatus` still keeps one instance per key with the higher tier winning, and the winner's numbers are the higher tier's. Then implement. The resolved op the rest of the code sees is a plain flat op, so no reader learns about tiers.
4. **Percent**: a pure function in `status.ts` that turns a resolved numeric op and the target's max HP into what to roll (a dice expression or a fixed whole number, at least 1 for a percent). Tests: 3% of 2000 is 60, 3% of 20 is 1, a dice op passes through. Do not wire it into the views: unit B does.
5. **`describe`**: an instance prints its tier's numbers, as today's wording. A definition with no instance prints all six ("1d6 / 2d6 / 3d8 / 4d10 / 5d12 / 7d12 damage at turn start, by rank E to S", or wording close to it: add the string to `docs/agent-handoff/copy-tasks.md` as TODO(copy)). A percent prints as "3% of max HP". Tests pin the numbers, not the exact sentence.
6. **The table** (`src/core/registry/statuses.ts`): the curves of `design.md`, exactly. Keep an entry one readable line where it fits; a small local helper for "the rank bonus, negative" is fine if it removes repetition, not if it hides the six numbers from someone reading the table. Extend `tests/statuses.test.ts` so every entry with `tiers` passes without a new test per entry: six values; a damage curve's averages never fall as the tier rises; a mod curve's size never falls; every tier 0 value equals the number in the status's description if it names one. Add the relationships the design states, each as one named test: the check, attack and AC penalties that follow the rank bonus equal `RULES.rankBonus` at every rank (Blinded is twice it); at every tier Burning's average is above Bleeding's and Bleeding's is at or above Poisoned's; Burning's average is between 0.4 and 0.7 of a same-rank hit at every tier, with the hits written in the test as the audit's numbers and a comment naming `p4/status-audit.md` section 3 as their source.
7. **The simulation** (`tests/status-sim.test.ts`), through the real `reduce` of `src/core/combat/encounter.ts` with seeded dice (copy how `tests/encounter-model.test.ts` and `tests/models/fight-play.ts` drive a fight and roll). Three ranks: E, C and S. A party of three of the audit's build against (a) that rank's boss and (b) one normal monster of that rank. Two parties: all three only attack; or two attack and one is the status hunter, who on each turn applies the first of Burning, Bleeding, Poisoned that the target does not have (3 rounds, as the status hunter's own source) and attacks only when all three are up. A third party: the status hunter keeps only Burning up and attacks otherwise. Measure rounds to kill, averaged over at least 200 seeded fights each. The bounds, decided before the run and not to be moved to fit: against the boss, each status party's rounds are within 0.8 to 1.25 of the attackers'; against the normal monster, no status party is faster than the attackers. If a bound fails, do not change a curve or a bound: write the measured table in the notes and reply. Print the table of results in the notes either way (the lead puts it in the report).
8. `bun run test` (typecheck, bun tests, lint rules), `bun run deps -- --write` if imports changed, `bun run charts`, and the browser files `tests/e2e/character.e2e.ts`, `tests/e2e/combat-turns.e2e.ts`, `tests/e2e/table-session.e2e.ts`. A browser test that asserted a flat number that now scales is updated to the number the rule gives, and listed in the notes. Update the "A status" recipe in `AGENTS.md` in one sentence (`tiers`, a percent quantity).

## Rules

- Every tier 0 value but Blinded's is today's value, so a fight between E-rank things plays as before. Say in the notes anything else a table would notice.
- No reader outside `status.ts` handles `tiers`. If you find yourself adding a tier parameter to a second module, stop and write why.
- Core stays pure (`tests/lint.test.ts`).
- You may not change a curve. If one looks wrong against the audit's numbers, say so in the notes.

## Done means

`bun run test` passes and the three browser files pass. Final reply under 200 words: the commit range and branch, the simulation's table in six lines or fewer, anything that failed a bound, anything you were unsure of.

If you are still going after about 80 minutes of work, commit what passes, write exactly where you are in the notes, and reply.
