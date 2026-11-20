# Brief: the economy, unit 1 (the rules and the ladder)

## The goal, in the owner's words

"Idk you should figure out economy." Then, on the design: "There should be variation in strength within tiers. Some
items should be like B+ or B-, so the cost should also change accordingly. A quarter. A quarter." And on its two
questions: "Keep them. XP should be split as well." His standing words: "I want it perfect", "everything must be
explicit", "architecture first", "fix the problem and not the symptoms".

The problem: a thing's price, what a sale pays and what a gate pays are numbers set apart from each other, some as
literals in code. Unit 1 puts every economy number in `RULES` with its domain, so the later units only read them.

## Step A: the design first (one commit, docs only)

`docs/agent-handoff/features/economy/design.md` sections 2.5, 4 and 7 still say answers the owner has since changed.
Read sections 0, 2.2, 2.5, 4, 7 and 10, and revise 2.5, 4 and 7 (and one line of 8 and 9 where they now mislead) to:

1. **Ruling 6** (section 10): the six built-in items stronger than any grade of their tier are kept as they are,
   priced as their tier's plus, and named by id as the allowed exceptions of unit 3's budget test. No fix table.
2. **Ruling 7**: a gate's XP is split as its gold is. Section 4 says the rule for XP, what it does to the pace of
   ranks (4.4), and how a gate's XP is raised so the party a gate is made for levels as today. Section 7.1 gains
   the rule or rules it needs; unit 6's row builds it. `xpSplit` is no longer "unchanged": say what becomes of it.
3. **E-1** of `docs/audit/2026-11-20-fable-review.md` (grep `E-1`, read that one entry): a rarity's price is
   computed from the middle of `loot[rank].gold` through a rarity to rank table that is itself a rule, so a GM's
   edit of `loot.C.gold` moves the rare price. `rarities.*.mult` and `baseValue` as stored results go, or you say
   in the doc exactly why one stays. Rewrite 7.1's rows, their tests and unit 1's and unit 8's rows to match.

4. **Rulings 8, 9 and 10** (section 10): no time limit on a crystal in the app; a raising costs levels by a rule
   `reviveLevelShare`, which 7.1 gains and unit 4's row builds (settle there what becomes of the lost levels'
   points, and say it); no level cap.

Rerun `bun docs/agent-handoff/features/economy/measure.ts` if a number of the doc moves. Change no ruling.

## Step B: unit 1, as section 7.3's row 1 reads after step A

Every rule of 7.1 with its domain in `src/core/rules.ts`, including the rules later units read (they add no rule).
`priceOf` with no `× 10` and computed as step A says; `sellPrice` by `saleShare`; an unpriced consumable by
`usedUpShare`; the built-in items lose their hand values where the ladder now prices them; `saleLine` and the
Rules page's table follow. A rule a later unit reads but nothing reads yet must not break a lint: if one does,
stop at that edge and report it.

Order: the failing tests of 7.1 that belong to unit 1 first (expected values worked out from the rule, not from
running the code), then the code, one commit a step. Then grep the tests and `tests/e2e/` for the old prices and
move each to a value computed from the rules, not a new literal.

## Read only this

- `.claude/skills/poteto-mode/SKILL.md`, its `playbooks/feature.md`, and the leaves `principle-model-the-domain`
  and `principle-test-behavior-not-implementation`. Another leaf only when you apply it.
- `docs/guide/combat.md` and `docs/guide/hunters.md`: grep for `priceOf`, `sellPrice`, `RULES`, "rule" recipes and
  read those rows only. The header of each source file before its code.
- The design's sections named above. The code you change and the test file you copy.

## Files you may change

`docs/agent-handoff/features/economy/design.md` and `measure.ts`; `src/core/rules.ts`, `src/core/registry/items.ts`,
`src/core/hunter/inventory.ts`, `src/core/rules-text.ts`, `src/views/rulesref.js` (only if the table's columns
must change); `tests/items.test.ts`, `tests/inventory.test.ts`, `tests/rules-text.test.ts`,
`tests/rule-domains.test.ts`, and any test that reads an old price. The generated docs by `bun run deps -- --write`.
If the work needs another source file, stop and say which and why.

## Rules of the work

- Your worktree and branch are in the lead's prompt. `bun install` there. Commit each step. Do not push.
  Do not touch `.claude/skills/`. No `Co-Authored-By` line in a commit.
- Wrap every test run in `flock /tmp/box.lock`. `bun run test` green at the end. No Playwright install: for a
  browser test set `E2E_CHROMIUM=/opt/google/chrome/chrome` and run only the files whose prices you changed.
- If the Rules page's sale table changes, take a 390 px screenshot of it, read it yourself, and keep
  `tests/e2e/rules-loot.e2e.ts` holding that it fits.
- A failed test is a finding: name its cause from its trace before you change anything. Change no test's bound,
  wait or retry to pass.

## Report (under 300 words)

What a table sees differently; each commit; what step A decided on E-1 and ruling 7 and why; every old price you
moved; any edge you stopped at; anything you found and did not fix, with a score from 0 to 10 by the owner's scale.
