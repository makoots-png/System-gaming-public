# Milestone 4, the makers: notes

Worktree `/home/user/systemgaming/.claude/worktrees/agent-ad02ee0c9f69c4e44`, branch `worktree-agent-ad02ee0c9f69c4e44`, from 9bb9b11. Not pushed.

## Plan (written first)

1. Core: `Ticks` gains `scale` (a stat of the eight, or none) in place of `scales`, and `pace` (the cost's share follows the
   time the GM picks). `ticksOf` reads the ticks back from a saved formula so an unedited one reopens with its ticks.
   `checkGap` insists on a cap. `averages` gives the preview's E, C and S numbers against a sample target. View: the
   formula field in `maker.js` (ticks, the text, "edited" and Reset, the parser's error, the averages line).
2. The ability form in `maker.js`, used by the skill maker and, through the skill maker, by the enemy maker's abilities.
3. The effects editor offers every `Op` kind (`OP_KINDS` in effect-ops.ts, a record the typecheck checks against `Op`).
4. Items: the worn speed of a sample hunter.
5. Tests. The fight steps run the saved ability or status through the real reducer in the test process.
6. Docs.

## Log
- Step 1 (commit "M4 step 1"). Core: `Ticks.scale` (a stat or none) replaces `scales`; a stat that is not the type's own
  writes the power curve out (`6 * (ins / 10)^0.8`), so a point of Instinct buys what a point of Strength buys in `phys`.
  `Ticks.pace` sets the budget share and `abilityOf`'s time. `ticksOf`, `checkGap`, `sampleBody`, `averages`,
  `describeAbility`, `paceTime`, `paceOf` in ability-kinds.ts; `afterDefence` exported from resolve.ts (rule 12, one copy).
  View: `app.api.maker.formula` (the field) and `app.api.maker.ability` (the form, groups collapsed). The skill maker uses
  both; the cooldown moved into the Cost group. The lint's view imports allow `percent` (a constructor).
  `tests/deps.test.ts` fails on the stale dependency map (the lead regenerates it).
- Step 2. The ability form's groups (Cost: time, fatigue, mana, cooldown; Reach: range, one target, a line with width
  and pierce, an area with its ring and share; Avoided: can be dodged with a wind-up in rounds and a speed, resisted by
  Discipline, cannot be avoided; Channel: linear or exponential, the most charge) are collapsed `<details>` with a
  summary line. "What it does" (Armor, Resist, Heals, Shields, Nothing) is the effect's type and the "aimed at" tick in
  one control. The preview adds `describeAbility`. The enemy maker's ability rows have Edit, which opens the skill maker
  on that ability (one form). A new kind redraws the form from the kind (a typed formula is not kept across a kind change).
- Step 3. The effects editor offers every kind of `Op` to a status (`OP_KINDS` in effect-ops.ts, a record keyed by
  `OpKind`, so a new kind fails the typecheck there and the round-trip browser test until it has a row). New rows: shield
  (one formula), delay (rounds, kept in ticks), taunt, threat, channel (protect or break), stagger fill %, refund (percent
  and chance). Damage, heal, mana and fatigue choose "Each round" or "Once, as it lands" in the status maker. "Flat" is
  now "Same at every rank". A skill's rows offer every `UseOp` kind. A flat formula row shows the averages line. Still
  kept as a read-only row: an `applyStatus` whose duration is by rank (no built-in has one; the row keeps it and the GM
  can remove it). Core: a status's `shield` op gave nothing before (only an ability's own shield op did); `statusShield`
  now gives the bearer a shield of the formula's average as the status lands, from the GM's Status window and from an
  ability's `applyStatus`, lasting as long as the status (the shield life for one until removed). The average, because
  the Status window rolls no dice. A case in tests/fight.test.ts.
- Step 4. `wornSpeed` (registry/items.ts): a C-rank hunter, points 2:1 in Agility and Strength, in the medium kit,
  with and without the piece; the item maker's preview shows both. Weight, armor, resist, attack kind and dice were
  already in the maker.
- Step 5. Six browser tests at the end of makers.e2e.ts. The fight steps put what the maker saved through `reduce` in
  the test's own process (the reducer is the fight; the fight screens are another helper's this milestone), except the
  slow-and-root test, which applies the status from the GM's Status window on the fight screen and reads the row.

## Which principle changed a choice

- boundary-discipline: the formula field reads the GM's text with `parseFormula` once per keystroke and keeps the
  saved tree while the text is unchanged; the ability is checked by `parseSkill` at save (the existing canon check).
- model-the-domain: one table of op kinds (`OP_KIND_SET`) keyed by the union, so "a new op without a maker row" is a
  failing test instead of a reviewer's catch. The effect's type and the "aimed at" tick are one control, not two.
- test-behavior-not-implementation: the expected numbers come from the rules (0.7 of the speed, move 0, 1.45 a charge,
  the 1d6 average of 3.5, the C builds' 8 and 4 tiles a round), not from a run.
- experience-first and the brief's "keep the common case short": every new group is a collapsed `<details>` with a
  summary of its values; the four tap counts did not move.

## Tap counts (from the tests, before and after)

| Thing | Before | After |
|---|---|---|
| Status (Frostbite, from the Make row) | 6 | 6 |
| Item (Bottled Storm) | 7 | 7 |
| Enemy (Ice Warden) | 9 | 9 |
| Frost Lance skill (from the Skills panel) | 8 (asserted at most 9) | 8 |

## Checks (last lines, after the last code change)

- `bun run typecheck`: passes (no output after the tsc lines).
- `bun run test`: `2293 pass`, `1 fail`: tests/deps.test.ts "the committed dependency map is what bun run deps -- --write
  writes" (the map is the lead's to regenerate; not committed, as the brief says).
- `makers.e2e.ts`: `28 passed (2.4m)` (22 before plus the six new ones).
- `customization.e2e.ts` `8 passed (1.3m)`, `sharing.e2e.ts` `6 passed (41.5s)`, `custom-skills.e2e.ts` `7 passed (28.2s)`,
  `character.e2e.ts` `20 passed (2.0m)`, `look.e2e.ts` `9 passed (27.8s)` (run before the last lint fix, which renamed a
  row field in maker.js and dropped the unused `maker.formula` API member; makers.e2e.ts ran again after it).
- `feel.e2e.ts -g "maker opens"`: `1 passed`, worst frame 33.3 ms, worst tap 63.5 ms at 4x.
- Not done: a screenshot pass with `scripts/ui-shots.ts` (no new screen; the makers gained collapsed groups), and a
  unit for `ticksOf` against a GM override of `channelExp` (an override changes the recommendation, so an unedited
  formula saved before reopens as edited, which is the honest reading).
