# Brief: the economy, unit 8 (the room carries the economy)

## The goal, in the owner's words

"Idk you should figure out economy." His standing words: "I want it perfect", "everything must be explicit",
"architecture first", "fix the problem and not the symptoms".

The problem: a GM can edit the economy's rules (a rank's loot gold, the sale share), but a player's phone in the
room prices by its own rules, so the GM's shop and the player's shop can show two prices for one item. Unit 8 puts
the economy's rules in the rules the room carries, laid over a player's rules.

## What to build

`design.md` section 7.3, row 8, exactly: `RoomRules` gains `rarities` (each with its rank), `gradeStep`,
`saleShare`, `usedUpShare`, `reviveClears`, `reviveLevelShare`, `solo.lootShare`, `gateParty` and `loot`;
`withRoomRules` lays them over a player's rules. Every rule already exists in `RULES` (unit 1): add none. A value
that arrives from the room is parsed at the boundary (a wrong shape is refused, not trusted).

Order: failing tests first, then the code, one commit a step. Proof: a player's shop price follows the GM's edit of
`loot.C.gold` (`tests/build.test.ts`), and the protocol test of the new fields.

Two things other work will change, so keep each field its own line and easy to remove: `usedUpShare` is to be
replaced by shares by duration, and `xpSplit` is being deleted by another helper (do not carry it).

## Read only this

- `.claude/skills/poteto-mode/SKILL.md` and its `playbooks/feature.md`; the leaf `principle-model-the-domain`.
- `docs/agent-handoff/features/economy/design.md`: sections 7.1, 7.2, 7.3 row 8.
- `docs/guide/room-sync.md`: grep `RoomRules`, `withRoomRules`, "rules doc" and read those rows only; its recipe
  for adding a field the room carries, if it has one. The header of each source file before its code.

## Files you may change

`src/core/protocol.ts`, `src/core/hunter/build.ts`, `tests/protocol.test.ts`, `tests/build.test.ts`, the guide row
you make untrue, and the generated docs (`bun run deps -- --write`, `bun run charts`). Two other helpers hold
`src/core/rules.ts`, `src/core/rules-text.ts`, `src/core/registry/items.ts`, `src/core/hunter/inventory.ts`,
`src/core/gates/`, and the views: if you need one of them or any other file (the place that sends the rules doc,
`server.ts`), stop and say which and why.

## The box

Work only in your worktree. Wrap every test run in `flock /tmp/box.lock`. `bun run test` must be green at the
end. If you run a browser test: `E2E_CHROMIUM=/opt/google/chrome/chrome`, one file, `E2E_PORT=3233`. No push, no
AI attribution in a commit. Commit each step. Report: the commits, what a table sees, anything you stopped at.
