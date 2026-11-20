# Brief: the economy, unit 2 (the grade)

## The goal, in the owner's words

"There should be variation in strength within tiers. Some items should be like B+ or B-, so the cost should also
change accordingly." And: "Like some items lower stats but better abilities." His standing words: "I want it
perfect", "everything must be explicit", "architecture first", "fix the problem and not the symptoms".

The problem: an item has a rarity and nothing inside it, so two items of one tier cost the same whatever they hold.
Unit 2 gives an item a grade (minus, middle, plus) that its price reads. The budget (unit 3) is not yours.

## What to build

`design.md` section 7.3, row 2, exactly: `GRADES`, `grade?` on `Item` and `ItemDef`, `itemOf`, `parseItem`,
`DISTINGUISHES`; `priceOf` reads the grade by the rule `gradeStep` (already in `RULES`, unit 1); the item maker's
grade chips and its price placeholder (which prices a consumable by `usedUpShare` too); the label such as "Epic+"
in the item's detail line (`describeItem`). Add no rule to `RULES`.

Order: failing tests first (expected values worked out from the rule, not from running the code), then the code,
one commit a step. Proof: a graded price; an Epic+ and an Epic are two stacks; an item with no grade is the middle.

The maker's screen changes: take one 390 px wide screenshot of the item maker with the grade chips, read it
yourself, and add a browser test that the row fits the screen (copy the fit test of the sale table: grep
`scrollWidth` in `tests/e2e/`). Commit no image.

## Read only this

- `.claude/skills/poteto-mode/SKILL.md` and its `playbooks/feature.md`; the leaf `principle-model-the-domain`.
- `docs/agent-handoff/features/economy/design.md`: sections 2.1, 2.2, 7.1 (the rows on the grade), 7.3 row 2, and
  ruling 1 of section 10.
- `docs/guide/makers.md` and `docs/guide/hunters.md`: grep `itemOf`, `parseItem`, `DISTINGUISHES`, "item maker"
  and read those rows only. The header of each source file before its code.

## Files you may change

`src/core/registry/items.ts`, `src/core/hunter/inventory.ts`, `src/views/loot.js`, `src/core/effects.ts`,
`public/app.css` (the chips only, if needed), `tests/items.test.ts`, `tests/inventory.test.ts`, one e2e file for
the maker, and the generated docs (`bun run deps -- --write`, `bun run charts`). Another helper holds
`src/core/gates/`, `src/core/rules.ts`, `src/core/rules-text.ts`, `src/views/gates.js`, `src/views/combat.js`,
`src/views/rulesref.js`: if you need one of them or any other file, stop and say which and why.

## The box

Work only in your worktree. Wrap every test run in `flock /tmp/box.lock`. `bun run test` must be green at the
end. Browser tests: `E2E_CHROMIUM=/opt/google/chrome/chrome`, one file at a time, `E2E_PORT=3231`. No push, no
AI attribution in a commit. Commit each step. Report: the commits, what a table sees, anything you stopped at.
