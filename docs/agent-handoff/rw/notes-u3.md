# Unit 3 notes: the second line, abilities, statuses in ticks and `resolve.ts`

## Where a rule could not be written as stated

- **The party's second line.** The lead's rule puts the next line one tile behind the first, away from the other side. The
  party's front line is the grid's top row (`y = 0`), so there is no row behind it. `defaultPlace` fills the rows behind
  the front line in order and then the rows in front of it, toward the other side. For the foes (front line `y = 8`) the
  second and third lines are `y = 9` and `10`; for the party they are `y = 1` and `2`. It keeps going row by row to the
  grid's edge rather than stopping at a third line, so it returns null only when every row of the side is full.
- **`modified(sheet, statuses)`.** A sheet cannot be worked out again from itself: a stat change must go through the curves
  from the stat. So `modified(origin, statuses, R)` takes what `derive` builds from (`Origin`: a hunter's `Build`, or a
  monster's rank, archetype and kind) and returns `{ stats, sheet }`. It uses unit 2's seam (`StatusMod`) with no change
  to `derive.ts`. `Body` carries `origin` for this.
- **Speed changes multiply.** The seam sums speed percents. `modsOf` passes one speed mod that is the product of the
  strongest slow and the strongest haste (a 30% slow and a 20% haste give one mod of -16%), so derive gives 0.84.
- **Pro rata rounding.** Design 1.3 rounds each settle to a whole number. Table 1.6's speed-80 row pays 8.5 + 11.5, which
  rounds to 9 + 12 = 21, not the 20 the design says. The test checks that row's shares (0.85 and 1.15) and the speed-100
  and speed-200 rows' whole amounts. Rounding a running total would keep 20, but the dice are rolled afresh at each
  settle, so a running total has no fixed amount to round.
- **Cooldown.** Design 3.3 types `cooldown` as a `Tick`; 1.3 writes `readyAt = now + cooldown * 1000`. `cooldown` is in
  ticks and `readyAt = now + cooldown`.
- **The design's `Cost` type** clashes with timeline's `Cost` (the branded time). The ability's is `AbilityCost`, whose
  `time` is timeline's `Cost`.

## What each module exports

`src/core/combat/ability-types.ts` (types only)

- `AbilityId`, `CombatantId` (branded) and `abilityId`, `combatantId`.
- `DamageType`, `Delivery`, `AbilityKind`, `AbilityCost`, `AbilityEffect`, `Ability`, `Avoid`, `Outcome`, as design 3.3.

`src/core/registry/ability-kinds.ts`

- `KINDS`: each kind's defaults, with the reason for each wind-up as a comment.
- `Ticks`, `defaultTicks(kind)`, `Gap` and `gapOf(type)`: what the GM ticks in the maker.
- `recommended(kind, ticks, R)`: the recommended formula as text and as its parsed tree.
- `abilityOf(kind, input, R)`: an ability with every field the input leaves out filled from its kind.

`src/core/combat/effect-ops.ts`

- `Op` (every op kind), `UseOp` (what an ability's own `ops` may hold), `StatusDef`, `Status`, `Source`, `StatusKey`,
  `Tiers`, `Tiered`, `When`.
- `Body`, the reducer's row: `Clock` plus id, side, kind, origin, tier, stats, sheet, place, HP, mana, fatigue, shield,
  stagger, channel, threat, statuses and `readyAt`. Also `Origin`, `CombatantKind`, `Shield`, `Stagger`, `Channel`.
- `atTier(value, tier)`: a tiered number at a tier.
- `isControl(def, tier)`, `controlFactor(body, R)`, `lasting(def, duration, tier, potency, tenacity, factor)`: rule 18.
- `applyStatus(list, status)`, `removeStatus(list, key)`: one instance per key, stronger wins.
- `settle(statuses, now, R)` and `dueAmount(due, scope, dice)`: per-round ops paid pro rata at a turn start.
- `modsOf(statuses)`, `modified(origin, statuses, R)`, `withStatuses(body, statuses, now, R)`: what statuses do to a sheet.
- `shielded(current, incoming, now)`: the larger shield holds, with the later end.

`src/core/combat/resolve.ts`

- `Aim`, `Rolls`, `Needs`, `Refusal`, `Resolved`, `ResolveRules`.
- `needs(ability, user, bodies, aim, grid, now)`: the dice, reaction d20s and refund d20 the edge must roll.
- `resolve(ability, user, bodies, aim, grid, rolls, now, R)`: a refusal, or the outcomes and every body after the use.
  The rules are the functions `taunted`, `onCooldown`, `payCost`, `inRange`, `whoIsIn`, `landTime`, `edge`,
  `whereItEnds`, `crit`, `formulaValue`, `multiplied`, `defended`, `throughShield`, `hurt`, `threatened`, `staggered`,
  `channelBreaks`, `landOps` and `userTime`, each headed by its rule number.

`RULES.fight` gains `staggerWeakBelow: 1 / 3` and `staggerRegrow: 0.5`. Design 4.3 states both; unit 2 left them out.
`Sheet` gains `penFlat`, the sum of the gear's `penFlat`; `GearPiece` has an optional `penFlat`.

## Where the design was silent, and what I chose

- **`needs` takes `now`, not `rules`.** It reads which of the user's statuses are live, and nothing in it reads a rule number.
- **Ability ops.** Rule 18 puts every op of an ability on through a status. An ability's own `ops` are `UseOp`s:
  `applyStatus` (with its def carried on the op, so a custom status needs no registry here), `cureStatus`, `delay`,
  `threat`, `shield`, `channel` and `note`. Speed, stat, root, hold, taunt, refund, stagger rate and the per-round numbers
  act from inside a status.
- **Who gets the statuses.** Only a target that ends `caught`, so not one in the ring, out, or resisted.
- **A status's formula** reads its bearer as both user and target when it settles; the source's tier carries its strength.
- **Status `until` may be null** (lasts until removed), as today, for passives such as a refund.
- **Re-applying a status** keeps the old instance's `settledAt`, so no span is paid twice under the new strength.
- **Fatigue** never refuses a use: it rises to the capacity at most (rule 4's "may go up to the capacity").
- **Land time** uses the distance from the user to each target. A target that dodges takes the best tile by rule 8a
  (fewest steps, then lowest `y`, then `x`), and later targets of the same use see it there.
- **Down bodies.** A monster or shadow at 0 HP is in no shape; a hunter at 0 still is (it may be dying).
- **The refund's chance** lands when the user's d20 times 5 is at most the chance (20% lands on 1 to 4). Its roll is
  `rolls.refund`, separate from `react`, because the user may also be a target of its own blast. The largest refund of
  those that land applies.
- **The channel.** Rule 17 sets the target's channel to `broken` and reports `channelBroken`. A `channel { protect }` op
  on the target stops every break; a `channel { break }` op or a landed hold, root or taunt breaks it, as 4.1 says.
  Whether a dodge's move breaks the dodger's own channel (4.1: "moves") is left to the channel's machine in unit 4.
- **Stagger.** The bar holds `hit`, the same-rank hit a weak hit is measured against. A full bar uses the stun floor
  (`at = max(at, now + 1500)`). `Outcome` gains `staggered`, so the reducer can emit `staggered` without comparing bars.
- **`Outcome.type` is null** for an ability with no effect, such as a taunt alone.
- **Kind defaults the design does not state.** Fatigue and mana: strike 8, shot 6, blast 10 mana, curse 8, support 6 (the
  paper's examples). Cooldowns 0. `foesOnly` true for strike, shot and curse, false for blast and support. A curse is a
  touch of reach 8; a support a touch of reach 6, range 6, with the shield `1.5 * sup` of table 4.6. A blast aims at a
  place, the rest at a foe or an ally.
- **The recommended formula.** Dice plus the power of the type (`phys`, `mag`, `sup`), times the cost's share of the
  budget (`R.cost[pace] / R.cost.standard`), then the gap bonus, then the channel tick. The gap's defaults are the owner's
  example, 10% a point up to +100%, Strength over Vitality for physical and Power over Discipline for magical. The
  blast's dice are `2d8`, so its formula is `1.5 * (2d8 + mag)`, the same average as the paper's `3d8 + 1.5 * mag`. The
  paper's 3.B shot is `1d8 + phys` with no quick share; the resolve test types the paper's formula for that example.
- **Design text corrected beyond notes-u2's list.** Section 4's figures did not match tables 4.1, 4.2, 4.5 and 4.6
  (73% for 86%, 1.44 for 1.14, 17 to 32 hits for 17 to 24, 19% for 26%); they now read as the tables print.

## Which principle changed a choice

- type-system-discipline: `UseOp` narrows what an ability's own ops may be, so an ability cannot carry a bare `hold` that
  nothing would apply. `StatusKey`, `AbilityId` and `CombatantId` are branded.
- boundary-discipline: `resolve` validates nothing; a missing roll is its one refusal about input (`needsRoll`). A
  status's def travels on its `applyStatus` op, so the resolver needs no registry lookup.
- model-the-domain: one exhaustive switch over `Op` in `modsOf`, and one over `UseOp` in `landOps`; a new op kind fails
  the typecheck until it has a cell in each.
- subtract-before-you-add: the speed rule goes through the existing `StatusMod` seam, with no new parameter on `derive`.
- test-behavior-not-implementation: the worked examples' numbers are the paper's printed output (29 of 48, faces 17 and
  12, 55/20/25 and 95/5/0, 47/23 and 53/26), table 4.4's rounds and table 1.6's ticks. Two of my hand values were wrong
  the first time (the dodge tile and the taunt burst after the hit's own threat); I re-derived both from rules 8a and 15.

## Progress

- Step 1: the second line, and the lead's three additions (`-2^2`, design text, `penFlat`), each its own commit.
- Step 2: types and the kinds table, `tests/ability-kinds.test.ts`.
- Step 3: statuses in ticks, `tests/effect-ops.test.ts`.
- Step 4: `resolve.ts`, `tests/resolve.test.ts` (29 tests).
- Step 5: `bun run deps -- --write` and these notes. `bun scripts/rw-paper.ts` differs from before only by the new
  "Penetration (flat)" row (0 for every build) in tables 2.3.

## The check

`bun run typecheck` green. `bun run test`: `Ran 1900 tests across 50 files. [30.49s]` (1900 pass, 0 fail).
