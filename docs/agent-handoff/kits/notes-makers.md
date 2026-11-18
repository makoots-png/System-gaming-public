# Notes: kits in the makers (brief-kits-makers.md)

Goal (poteto mode, read part-way through step 7): the owner, the GM, must be able to build his players' kits (Glas's
Resonance, Fester, Hemoplague, Crimson Pact, Hwei's mark, Einar's Pain) on his phone in the Workshop, with no manual and
no formula typed unless he wants to, and see each made thing's worth against its budget. The problem: the core holds
every kit block (stacks, triggers, ends, prices, gates, scalers, wave 2's ops), the makers offered none of them. The
smallest change: the parsers carry `worn` and starting stacks, the effects editor gains a row per new op, and one shared
part draws each block as a folded group in the makers that already exist, with no new maker.

## Log

- Start: main tree on `claude/zen-pasteur-ov4cgd`, clean, at 318b306 (the kits line merged).

## Step 1: parsers and packs (unit 15)

- `worn` on a passive skill (`SkillTemplate`'s passive arm) and on an item (`Item.worn`), each a `StatusDef` read by
  `parseStatusDef`, absent when none (a broken one reads as none, as a broken ability on an active skill reads as null).
  Only a passive carries one: design 5.1 puts the worn status in the passive skill maker.
- The worn status reaches the fight in `partyRow` (rows.ts): each passive's at the hunter's rank with the row as source,
  then each worn item's (in a slot) at the item's rarity from no combatant, under a key made from its label that no
  condition holds (`freeStatusKey`). A status is marked `worn: true` (a new optional field beside `zone`), and `onSheet`
  refuses it, so the write-back never puts "Pain is Power" on the sheet as a condition (it would come back twice next
  fight). `applyStatus` keeps the mark when a trigger re-applies the key; `parseFight` reads it.
- A monster's starting status gains `stacks` (2 to `kit.stackCap`, absent when 1); `monsterRows` passes it to the
  status, cut to the def's cap.
- Packs: the kinds are unchanged. `packOf` follows the status keys a def's triggers, threshold and end apply, and a
  worn status's, so a kit's statuses travel with it; Add's rekey reaches the same places. Not rekeyed: a key named
  inside a formula (`stacks(rot)`), a price's or a gate's key. Add renames a library status only when the other phone
  already holds that key or label, and a kit's statuses are mostly carried inline in the ability that applies them.

## Steps 2 and 3: the status maker and the ability form

- The effects editor (maker.js) has a row for each of wave 2's 16 op kinds (the round trip over `OP_KINDS` passes):
  `sheet` (a key select, its bound from the rules as `fight-parse.ts` clamps), `share` (dealt, taken, healing, by rank),
  the seven plain ones (`untargetable` ... `negate`), `edge`, `boost`, `shove`, `move`, `hasten` and `guard` (typed as
  percents), `dispel`. An Apply status row of a stacking status gains "Stacks it adds", a Cure row "Stacks it takes"
  (before, a stored op's `stacks` was lost by a form). A skill's ops gain the wave 2 use ops; a new kind of list,
  `land`, is what a threshold, a trigger or an end lands (no `refund` of time: a trigger's refund has no row yet).
- The kits' groups of a def are one part, `statusBlocks` in a new `src/views/kit-parts.js` (on `app.api.maker`), held by
  the status maker, a passive's worn status and an item's: Stacks (cap, how they leave, kept or gone, and "Something
  happens at a count": a count or a formula over the bearer, the bearer or an area, the land effects, spent or kept),
  When something happens (up to 4 triggers: the event, a tag or a status, how often, on whom, the land effects) and
  When it ends (the land effects, what a cleanse does). Each is a collapsed `.mk-group` with one line when set. A
  trigger's `need` has no control: an existing one is kept as it came.
- A nested editor is drawn only when its box is first ticked. Reason: the existing tests (and a GM) find "the" row 0 of
  a form; three editors in one form made `[data-row="0"]` match three rows, and a form that uses no kits block now
  costs nothing more to open.
- The ability form gains (kit-parts.js `abilityBlocks`): Costs more (HP flat or a share, stacks of a status from you or
  each target, n or all, a field one or all), Only when (holds a status on you or the target at least n, uses a fight or
  a long rest, inside a field), Tags, Moves (none, blink, swap; a zone act: moves or widens a field by n), Reaction (its
  moment and reach), Summons (name, body, rounds). They survive a change of kind. The formula field's "Build the
  formula" gains the scalers (up to `kit.scalers`: the eight of the family, start and scale as percents filled from
  `suggestedScaler`, Reset to suggested; `recommended` writes the base cut) and a fold "Insert a name" whose chips put
  `target.stacks(key)`, `stacks(key)`, `spent`, `field(key)`, `held(key)`, `target.missing`, `missing`, `hits` and
  `kills` at the cursor, the key from a status select. Roll20 dice were already read by `parseFormula`.
- The worth line is the skill maker's (`skills.js`, above the preview): a bar to one and a half budgets with a mark at
  the budget, and `worthLine`; gold past the tolerance, never a refusal. A passive's worn status shows `wornWorth`.
- Not built in the ability form: a field's upkeep, end and triggers (`ZoneSpec`'s kits parts), a summon's starting
  statuses (kept as they came), an edge or a held die on an ability itself (they are status ops: an ability applies a
  status that holds them), a trigger's refund.

## Step 4: items and monsters

- The item maker's "while worn" part gains "In a fight" (loot.js): ticked, the item wears a status named after it, with
  the effects editor and the status maker's groups (`statusBlocks`). Its lines join the preview as "In a fight: ...".
- The enemy maker's starting status row gains a Stacks field when the status stacks (its def's cap), and its line says
  "Starts with: 3 Pain (until removed)". A monster's reaction is an ability of the monster made in the skill maker with
  the Reaction group; arming it is the GM's fight card's (combat.js, the table unit), not the maker's.

## Step 5: the built-ins to open and copy

- `src/core/registry/kit-examples.ts`: five statuses (Resonance, a stacker with a bearer burst and the suggested
  execute; Signature, Hwei's mark that detonates on an area at 2; Pain; Crimson Pact, a mode; Hemoplague, a delayed hit)
  and ten skills (Bloodletting, Fester, Crimson Pact with an HP share price, Hemoplague gated on the Pact, Executioner's
  Cut with an HP price and the execute scaler, Disaster Stroke, Violence spending all Pain, Pain is Power a passive with
  a trigger, Parry a reaction, Call Sprite a summon once a fight). Not in a hunter's list or the pickers: the Workshop's
  status and skill sections each have a fold "Kit examples to copy" with Duplicate, which saves the example into the
  library (a status under its own key when free, so `target.stacks(resonance)` still names it).
- tests/kit-examples.test.ts checks every entry: it reads back unchanged, and its worth is not past the tolerance.
- Departures, to stay inside the budget the maker shows: Bloodletting is 0.7 of a bolt (the paper's share), not the
  simulation's 0.85 (`examples.blood.share`): worth.ts weighs it against a curse's standard (1.01 at 0.7, 1.17 at 0.85),
  the simulation against Arc Bolt. Hemoplague's delayed hit is 0.6 x (1d8 + mag): worth.ts weighs a delayed end whole
  (1.61 at 1d8 + mag), with no mode credit for its gate (`abilityWorth`'s `credit` is not passed by the maker).
- An example with no effect carries `formulaEdited: false`, as the skill maker writes it, so Edit then Save is equal.

## Step 6: the kits built through the UI (tests/e2e/kits.e2e.ts)

Each row below is made in the makers through taps and typing at 390 px and read back from the save; the ones marked
"played" are then run through the fight's reducer with the abilities the save holds (`reduce`, as makers.e2e.ts plays
its made abilities), and the foe's chip is read from `fightDoc`, what a player's phone receives.

| Kit | Name | Built through the UI | How | Played |
|---|---|---|---|---|
| Glas | Sanguine Resonance | yes | status maker: Stacks to 10, at `vit` (a formula over the bearer) 3d6, spent; When struck: heal 1d4 on the other | yes: one stack a Fester on the doc's chip, the burst at its Vitality empties them |
| Glas | Fester | yes | skill maker: a curse, `target.stacks(resonance)` put in with the name chip, applies Resonance 2 rounds | yes |
| Glas | Hemoplague | yes | status with When it ends 4d6; a curse gated "Holds Crimson Pact on you" that applies it 3 rounds | yes: refused before the Pact, lands after; the end lands when its 3 rounds pass |
| Glas | Crimson Pact | yes | a support on the user, Costs more: 50% of max HP, applies the Pact 3 rounds | yes: HP falls by `ceil(max / 2)` |
| Glas | an execute | yes | a strike, Add a scaler: Execute, start 50 and scale 100 suggested, base cut written | worth line inside |
| Glas | Celestial Rot, Vision | yes (not in a test) | stacking statuses: per-stack damage a round, a stat op; Vision's `exposed` sheet op, leaving on a crit taken | no |
| Glas | Wrath of the Aspect, Tides of Blood | yes (not in a test) | formula chips `field(rot)`; an HP price with `target.stacks` | no |
| Glas | Sine Sanguis, Descecrate (double stacks), Chronobreak, Recursion | no | doubling stacks and rewinds are not blocks (design 8.11) | |
| Einar | Pain is Power, Violence | yes | the examples (Duplicate), round-tripped through the skill maker; a passive's worn status with a trigger | the simulation's rows |
| Einar | Old Wounds (starts with 3 Pain) | yes | enemy maker: a starting status with 3 stacks (for a monster; a hunter's starting stacks are a condition on the sheet) | no |
| Einar | Boundaries (upkeep, end) | no | the ability form has no control for a field's upkeep, end or triggers yet | |
| Hwei | Signature mark and its detonation | yes | example Signature: at 2 an area of 2 on the bearer's friends, spent; Disaster Stroke applies it | the simulation's rows |
| Hwei | Mood (three triggers on `used` of a tag) | yes (not in a test) | a passive's worn status with `used` triggers, each curing the others and applying its own | no |
| Maro | Corruption from sword hits (Void Knight) | yes (not in a test) | a worn status: When its bearer deals a hit tagged sword, apply Corruption on the other | no |
| Maro | Sprite | yes | example Call Sprite: Summons a skirmisher for 5 rounds, once a fight | no |
| Nikolas | Brutalize | yes (not in a test) | status: share taken +33%, healing −50%, sheet armor and resist down | no |
| Any | Parry | yes | example Parry: a reaction before a hit, guard 30% | the simulation's rows |

What the test does not do: the fight is played by the reducer in the test, not on two phones' fight screens (the table
unit owns `table.js` and `combat.js`, which another helper was changing). The room doc is checked through `fightDoc`.
The share step copies the code on one GM's phone and Adds it on another's through the Data view.

## Step 7: close

- AGENTS.md: rows for the kits' maker parts (`kit-parts.js`), a worn status, and the kit examples; the op-kind recipe
  names `specOf`, `ROW_KINDS.skill` and `ROW_KINDS.land`; a new recipe for a kits field in a maker.
- `scripts/ui-shots.ts`: steps for the status maker's Stacks and a trigger, and the skill maker's scaler, cost and
  condition groups. tests/e2e/look.e2e.ts: at 360 and 390, both makers with every kits group open scroll only up and
  down and every button, field, select, check and summary is at least 44 px tall (measured by layout: a chip just
  tapped is mid press motion, a scale, and its drawn box reads 43.6).
- for-the-owner.md: what he can make and the defaults he would notice.

## What a GM would still find awkward

- A trigger's land effects start with a heal row and a count's with a damage row: a GM removes or changes them.
- The status pickers in the ability form and the triggers list every status, the built-ins first; with many statuses a
  select is long.
- A field's upkeep, end and triggers (Einar's boundaries) have no control; a summon's starting statuses neither.
- The worth bar sits in the skill maker only; the status maker shows no worth for a def alone.
- Inserting a name puts it at the cursor, which on a phone is often the end: the GM types the closing bracket.

## Which principle changed a choice

- experience-first: the nested editors are drawn only when ticked, so a plain status opens as fast as before; each
  group shows one line when closed.
- subtract-before-you-add: one `statusBlocks` part serves the status maker and both worn statuses, rather than three.
- prove-it-works: every example skill is opened in the skill maker and saved, and must come back equal (that found an
  example's `formulaEdited` the maker would have changed); the made Glas kit is played through the reducer.

## Decision trail (poteto mode)

The poteto-mode rules arrived during step 7; the trail below is written from the choices as they were made.

- Where the kits' groups live. Weighed: (a) each maker (forge, skills, loot) writes its own Stacks, When and When it
  ends groups; (b) maker.js grows them beside the effects editor; (c) one new module, `kit-parts.js`, with
  `statusBlocks` for a def and `abilityBlocks` for an ability, exposed on `app.api.maker`. Chosen (c): one reader that
  must give back exactly what `parseStatusDef` gives, used three times (a status, a passive's worn status, an item's),
  and maker.js was already past 800 lines.
- How a worn status reaches a fight and stays off the sheet. Weighed: (a) the hunter's conditions hold it (it would show
  as a condition out of a fight and come back twice); (b) the write-back skips keys the hunter's skills and items name
  (the fight does not see them at write-back); (c) a `worn` mark on the status, refused by `onSheet`. Chosen (c), the
  same shape as a zone's hold (`zone`), so every path that already keeps a hold off the sheet reads it the same way.
- Where the examples live. Weighed: (a) built-in statuses and `SKILL_SEEDS` (every hunter's add list and every status
  picker would list Pain and Parry); (b) a library seeded at a new campaign (a save field to migrate); (c) a registry the
  Workshop lists with Duplicate. Chosen (c).
- The two-phone fight of step 6: weighed driving the table's screens (owned by the table helper, changing at the same
  time) against playing the made abilities through `reduce` and reading the doc with `fightDoc`. Chose the reducer; the
  brief's two-phone part is left to the table unit. Flagged to the lead.
- Contested design to flag: the examples' numbers (Bloodletting 0.7, Hemoplague's 0.6) bend to the maker's worth
  rather than the simulation's (0.85). The worth rule gives no mode credit and weighs a delayed end whole; which of the
  two is right is a balance call for the lead.

## Principles applied, each with the choice it changed (each leaf read in this session)

- model-the-domain: the worn status is a mark on `Status`, not a list beside it; an op row's bound comes from one
  `specOf` over the rules, not a literal per kind.
- boundary-discipline: every form answers what its parser gives back (`canon` compare), and the examples are checked
  through `parseSkill` and `parseStatusDef`; nothing inside re-validates.
- test-behavior-not-implementation: the tests read the save and the fight (stacks on the doc's chip, HP paid, the
  burst, the end), with expected values from the rules (`ceil(max / 2)`, one stack a Fester), not from the code's run.
- laziness-protocol and subtract-before-you-add: one `statusBlocks` for three makers; nested editors drawn only when
  ticked rather than a scoped rewrite of the existing tests.
- experience-first: groups fold to one line; the scaler fills its suggestion; the name chips insert text.
- prove-it-works: every example is opened and saved in the skill maker and must come back equal (it found an example's
  `formulaEdited` the maker would change); the look case measures every control at 360 and 390.
- unslop: notes, for-the-owner.md and commit messages in plain sentences.

## Checks at the close

- `bun run deps -- --write` and `bun run charts`; `bun run typecheck` clean; `bun run test`: 2982 pass, 0 fail. The first
  full run had 4 failures, the dependency map's API tests: maker.js registered `app.api.maker` through a variable, which
  the map does not follow; it registers the object literal again.
- Browser files, one at a time on 3241: makers 30 passed, kits 6 passed, customization 9 passed, custom-skills 7
  passed, sharing 6 passed, look 13 passed. feel.e2e.ts not run (the brief leaves it to the lead).
- ui-shots: the 1280 and 390 shots of the new groups looked at; nothing cramped at 390 (the trigger box nests in its
  group with its own border and the land effects inside).
