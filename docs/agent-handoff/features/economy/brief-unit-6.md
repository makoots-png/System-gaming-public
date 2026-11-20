# Brief: the economy, unit 6 (a world gate's gold and XP are shared)

## The goal, in the owner's words

"Each hunter should share, but that might mean we have to bump up the gate pay. I want to incentivize them taking
risks (less players per run and if they brute force it with more players they should get less reward)". And: "XP
should be split as well." His standing words: "I want it perfect", "everything must be explicit", "architecture
first", "fix the problem and not the symptoms".

The problem: a world gate pays its whole gold roll to every hunter, so a crowd is paid as well as a pair. Unit 6
shares one pot among the hunters of a Clear, by the rule `gateParty` (already in `RULES`, unit 1), for gold and XP.

## What to build

`design.md` section 7.3, row 6, exactly: `shareEach(amount, n, party)` in `pay.ts` in place of `splitAward`;
`clearShares` shares the gold roll and the XP due by it; `planEncounter` the XP of a fight linked to a gate (a
fight with no gate pays each the whole); `xpSplit` deleted with its readers; a world gate's solo run is n = 1; the
Clear panel's note says gold and XP each for the hunters ticked; the Rules page's lines. Add no rule to `RULES`;
in `rules.ts` only delete `xpSplit`.

Order: failing tests first (expected values worked out from the rule, not from running the code), then the code,
one commit a step. Proof: the split test at 1, 4 and 6 payees, gold and XP; a solo run's four rolls and four times
the XP. Personal gates (`spawn.ts`, `solo.lootShare`) are unit 5 and not yours: leave them.

The Clear panel's note changes: take one 390 px wide screenshot of it, read it yourself, and keep or add a browser
test that it fits. Commit no image.

## Read only this

- `.claude/skills/poteto-mode/SKILL.md` and its `playbooks/feature.md`; the leaf
  `principle-test-behavior-not-implementation`.
- `docs/agent-handoff/features/economy/design.md`: sections 4.1, 4.4, 7.1 (the rows on `gateParty` and `xpSplit`),
  7.3 row 6, and rulings 5 and 7 of section 10.
- `docs/guide/gates-solo.md`: grep `splitAward`, `clearShares`, `planEncounter`, `xpSplit` and read those rows
  only. The header of each source file before its code.

## Files you may change

`src/core/gates/pay.ts`, `src/core/gates/solo.ts`, `src/core/rules.ts` (the deletion only), `src/views/gates.js`,
`src/views/combat.js`, `src/views/rulesref.js`, `src/core/rules-text.ts` (the gate's lines only), `tests/pay.test.ts`,
`tests/solo.test.ts`, `tests/rules.test.ts`, `tests/rule-domains.test.ts`, `tests/rules-text.test.ts`,
`tests/e2e/gates-quests-dailies.e2e.ts`, the guide row you make untrue, and the generated docs (`bun run deps --
--write`, `bun run charts`). Another helper holds `src/core/registry/items.ts`, `src/core/hunter/inventory.ts`,
`src/views/loot.js`, `src/core/effects.ts`: if you need one of them or any other file (a reader of `xpSplit`
outside this list counts), stop and say which and why.

## The box

Work only in your worktree. Wrap every test run in `flock /tmp/box.lock`. `bun run test` must be green at the
end. Browser tests: `E2E_CHROMIUM=/opt/google/chrome/chrome`, one file at a time, `E2E_PORT=3232`. No push, no
AI attribution in a commit. Commit each step. Report: the commits, what a table sees, anything you stopped at.
