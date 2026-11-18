# Unit 4 notes: `fight.ts`, the new fight as one pure reducer

## Progress

- The lead's first addition: the party's front line is `lineBack` (2) rows from the top and the foes' is `lineGap` (8)
  below it, so on the 20 by 14 grid the party has 2 rows behind it and the foes 3. Every later line goes behind its
  front for both sides; `defaultPlace` returns null when the rows from the front back to the edge are full. Commit 60358a3.
- The lead's second addition: a status stores `since`, the time its per-round ops started paying, beside `settledAt`.
  A due carries `before` (rounds already paid) and pays `round(rate * (before + share)) - round(rate * before)`.
  Table 1.6's speed-80 row pays 9 + 11 = 20; a property test splits random spans. Commit 3dd9bb6.
- Step 1: `fight-types.ts`. `Body` gained `name`, `abilities`, `intent` and `holder` (unit 3's row, extended in place).
  `HunterId` and `RemoteKey` are branded in `ability-types.ts`. Commit 0eddd7b.
- Step 2: the channel's table in `fight-channel.ts` (none, holding, broken, fired). `resolve.ts` now exports `placeOf`,
  `taunted`, `onCooldown`, `payCost` and `inRange`, and `effect-ops.ts` exports `perRound`, for the channel's start,
  which checks a use's rules without resolving it. Commit 2b5c34d.
- Steps 3 and 4: `fight.ts` (the fight's `TABLE` and one handler per command), `fight-turn.ts` (`startTurn`, the time
  step for everyone, `consequences`, the end check) and `tests/fight.test.ts` (35 tests). Commit 3cae1d9.
- Step 5 and 6: `fight-parse.ts` (commit 3e3bb57), then `tests/fight-model.test.ts` and `tests/models/fight2-play.ts` with
  the fixes the model drove (commit ec6c9b8). 2,500 seeds of 10 to 49 commands, about 30 seconds.
- Step 7: `scripts/charts/fight2.ts` and `scripts/charts/channel.ts` in `MACHINES`, `bun run charts` (commit 265897e).
- Step 8: `bun run deps -- --write` and these notes.

## Commands

- `add`: rows join. From no fight they make a new setup on the command's `grid` (the rules' open 20 by 14 when left out).
  All or none: a duplicate id, too many rows or no free place refuses the whole command. While running each needs its
  opening roll and joins at `opening(now, speed, d20 + Instinct bonus)`.
- `remove`: a row leaves; its pending dues and its entries in threat tables go with it. Removing the current row starts
  the next turn; removing the last of a side ends the fight.
- `start`: every row's first `at` from its opening; both sides need someone up.
- `act`: a use by the current row, or by anyone with `force` (logged "(GM)"). A channel ability begins a channel;
  anything else goes through `resolve`.
- `move`: a walk of at most a stride around bodies and walls, costing `walkCost(steps)` of the mover's time.
- `endTurn`: a pass, a standard action's time. A holding channel keeps charging; a full one ends unspent.
- `release`: a holding channel on its user's turn (costs the ability's time), or a broken one at any time (costs none).
- `setIntent`: the GM sets a monster's next use, shown to players; cleared when it acts.
- `place`: the GM drags a row, no time, no path.
- `settle`: the dice for a per-round op that waits in `pending`.
- `end`: the GM ends the fight; `clear`: the summary closes and there is no fight.

## Effects

- `turnStarted { id, hunterId, now }`: a turn began.
- `rollSettle { id, key, dice, share }`: a per-round op paid for `share` of a round; with dice the edge rolls and sends `settle`.
- `vitals { hunterId, hp, life, mana, fatigue }`: the one write-back of a hunter on this phone.
- `sendRemote { remote, hp, mana, fatigue }`: the same totals for a hunter on another phone.
- `moved { id, to }`: a walk, a dodge or a drag.
- `channel { id, state, charge }`: a channel began, grew, broke, went off or ended (`state` null).
- `staggered { id }`, `defeated { id }`, `ended { summary }`, `refused { reason }`.

## What I added to units 1 to 3

- `space.ts`: `SpaceRules.lineBack`; `defaultPlace` fills only from the front back. `RULES.fight.lineBack: 2`.
- `effect-ops.ts`: `Status.since`, `Due.before`, `dueAmount` on the running total, `perRound` exported, `Holder`,
  `Intent`, and `Body` gains `name`, `abilities`, `intent`, `holder`. `withStatuses` keeps HP, mana and fatigue within
  the new maxima (the model's first finding), with a test in `tests/effect-ops.test.ts`.
- `ability-types.ts`: `HunterId`, `RemoteKey` and their constructors.
- `resolve.ts`: `placeOf`, `taunted`, `onCooldown`, `payCost` and `inRange` exported for a channel's start.

## Where the design was silent, and what I chose

- **An ended phase.** The brief writes `Fight = Setup | Running`, but the fight's machine has an ended state and an ended
  fight must differ from no fight, so `Ended` keeps the rows, log and `Summary` until `clear` (a command I added).
- **The table is the switch.** `TABLE[state][command]` holds the handler or null, as `gate.ts` does. Its mapped type asks
  for every cell, which is the exhaustive check a `never` default would give, so `reduce` is the lookup.
- **No `undo`.** Design 1.4 says an undo keeps the previous `Running`, but not what it does to effects already carried
  out: a `vitals` written to a sheet, a remote phone told, dice rolled for a settle. Left out.
- **No `dash`.** Design 3.3 names `move { dash }`; 4.6 gives it no rule.
- **Every action ends the turn.** After `act`, `move`, `endTurn` or a release on its own turn, the lowest `at` acts next,
  which after a short walk is often the same row again.
- **Places at `add`, not at `start`.** The same tiles, and a setup screen can draw them.
- **The channel's two kinds of broken.** Design 4.1 says broken for both "a hit breaks it, it fires at half" and "it
  acts, moves or goes down, nothing fires". The row's `broken` is the first, waiting for its dice; the second is `null`.
  Going off needs dice, so the reducer cannot fire it alone: a broken channel goes off on `release` at any time (the GM's
  phone sends it at once), and a full one is released on its turn or lost on a pass. A channel goes off where it was
  aimed whatever the range is then. The cost (fatigue, mana, time) is paid at the start; the cooldown starts when it fires.
- **Per-round damage** takes the shield, then HP, with no armor (table 1.6 counts 10 a round as 20 dealt), and adds no
  threat, stagger or channel break.
- **Threat decays everywhere when time moves**, by `0.9 ^ (elapsed / 1000)`. A monster reads the same table at its turn
  start as with decay there, and no row needs a "last decayed" time.
- **Expiry for everyone** drops statuses and shields whose end has come, except a status that still owes per-round ops:
  it waits for its bearer's turn, so it settles in full (design 1.3).
- **Up, present, held.** Up is HP above 0. A hunter at 0 is not up but stays on the map and can be healed; a monster or
  shadow at 0 leaves it. A row with a live hold status loses its turn (a standard interval). A row that comes back up
  waits from `now`. A current row that a use out of turn downs, holds or pushes past `now` loses the turn.
- **`sendRemote` carries totals**, so a repeat changes nothing. `vitals.life` is the hunter's life (from `ctx.life`)
  after a `setHp` to the fight's HP.
- **Not done**: XP in the `Summary` (a row has no XP yet), a shadow's HP write-back (design folds `shadowHp` into
  `vitals`, but `vitals` names a hunter), and the GM's hand edits of HP and statuses. All belong to the wiring unit.
- **An aim** must be a row or a tile of the grid; a wall tile is a fair aim for a blast. The reducer refuses one off the
  grid because the grid is the fight's own data, not the command's shape.
- **`parseFight(raw, rules)`** takes the rules: dice limits for formulas, and the sheet of each row is worked out again
  from its origin and statuses rather than read.

## Bugs the model test found

1. Seed 19: a status lowering Vitality left the Ogre at 375 HP of a max of 331. Fixed in `withStatuses`. Replay: "a status
   that lowers a full monster's max HP leaves its bar full at the new max, not over it".
2. Seed 89: a channel aimed at a tile off the map was accepted, and `parseFight` then refused the fight, so it could not
   be stored or shared. Fixed: an aim off the grid is refused. Replay: "a channel aimed past the edge of the map is
   refused, and the fight can still be stored".
3. Seed 596: a forced stun on the current hunter left the turn with a held row. Fixed: the current row loses the turn
   when held, down or pushed past `now`. Replay: "a hunter stunned by the GM on its own turn loses that turn, and its
   next one starts when the stun ends".

The model's own first mistake: it counted settled time for statuses with no per-round op, whose `settledAt` moves with
nothing paid. The check now covers only statuses with a per-round op.

## Which principle changed a choice

- model-the-domain: the fight's states and the channel's are tables of handlers; stagger, shields and threat stay data
  with one rule each; "what changed on a row" is one function (`consequences`) instead of an effect pushed beside each write.
- boundary-discipline: the parser recomputes each sheet from its origin, so a stored sheet can never disagree with it.
- make-operations-idempotent: `sendRemote` sends totals; a second `settle` for the same due is refused (`nothingDue`).
- test-behavior-not-implementation: every number in `tests/fight.test.ts` is worked from the design's rules (the
  interval, the opening, 1.5 rounds of stagger and 50% regrowth, 0.9 squared, the stride of 3 and 50 hundredths for
  3 tiles). Two of my hand values were wrong the first time (the shield test's turn order, and a broken channel that I
  expected out of turn when the channeler's own turn came next); I re-derived both from the tie rule and the intervals.

## The check

`bun run typecheck` green. `bun run charts` wrote the two new charts; `tests/statecharts.test.ts` green.
`bun run test`: `Ran 1945 tests across 52 files. [68.08s]` (1945 pass, 0 fail).
