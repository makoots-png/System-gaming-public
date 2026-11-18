# Notes, M2 P6 (the dice)

Changed outside the unit's files: `docs/dependency-map.md`, rewritten by `bun run deps -- --write` because `tests/deps.test.ts` fails on any new file.

Made (`src/edge/roll.ts`, 44 lines; `tests/roll.test.ts`, 12 tests; nothing removed):
- `Random`: a function giving a number in [0, 1). `cryptoRandom`: the default, 32 bits from `crypto.getRandomValues`.
- `rollDice(d, random?)`: the total of `d.count` dice of `d.sides` faces.
- `rollNeeds(needs, random?)`: `Rolls`. One total per dice term per target, a d20 per `react` id, `refund` (a d20) only when `needs.refund`.
- `rollOpenings(ids, random?)`: `Opening[]`, a d20 and a d1000 tie each, in the order given.
- `rollSettle(dice, random?)`: one total per term, the `settle` command's `dice`.

Choices: the random source is a `() => number` in [0, 1), not a raw buffer filler, so a test passes a seeded generator. Tests assert faces and shape against the `Needs`, never a rolled value, except the two fixed-source extremes.
Check: `bun run test` green.
