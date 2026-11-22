# Every League stat and item effect, and what the game takes (the owner, Nov 21)

the owner, Nov 21: "There should also be heal% increase, damage converted to shields, etc... do some research on the full
suite of league stats and implement as you see fit." Before it the same day: "And armor and resist, hp, shield buffs from
LoL, everything."; on attack and ability power, "I think that's hard to do" (they stay out); "No cap on life steal"; and
ability haste by League's formula (unit `haste-lol`, running: cooldown = base × 100 / (100 + haste)).

This file lists League of Legends' champion statistics and the item effects that recur across items, says what the game
already has for each, and plans the rest. `balance-plan.md` sections 9 and 10 are built (`BONUS_KEYS`, the four
penetrations, `drain`, `cooldownCut`, the `shielded` share, `Item.worn`); this file builds on them and changes none of
their rulings.

**Sources.** The pages are the League of Legends wiki's (wiki.leagueoflegends.com), named in each row. That host and the
fandom mirror are outside this session's network, so no page could be fetched; formulas marked (s) were read in search
results quoting the page, the rest (m) are from memory of the same page and are to be checked against it before a number
is copied into a rule. No number of this plan's rules is taken from League: each is ours, with its reason beside it.

## 1. The table

Plan: **built** (the game has it; how), **key** (a new bonus key, a sheet number; section 2), **event** (a new bearer
event a worn status's trigger answers; section 3), **out** (left out; the reason, and section 5).

| League stat or effect | League's formula (page) | In the game | Plan |
|---|---|---|---|
| Health | flat; grows by level (Champion statistic) | `hpMax`, bonus key | built |
| Armor, magic resist | taken × 100 / (100 + armor) for armor ≥ 0 (Armor (m)) | `armor`, `resist` (GearPiece), rule 12 `armorK` | built |
| Armor and magic penetration | order: flat reduction, % reduction, % penetration, flat penetration (Armor penetration (m)) | `armorPen`, `resistPen` (%), `armorPenFlat` (Lethality), `resistPenFlat` (Unravel) | built (section 9) |
| Lethality | flat armor penetration, one for one today (Lethality (m)) | `armorPenFlat` | built |
| Attack damage, ability power | flat damage stats | `phys`, `mag` from Strength and Power | out: the owner's word |
| Adaptive force | the larger of bonus AD and AP gets it (Adaptive force (m)) | none | out: rests on AD and AP |
| Attack speed | base × (1 + bonus %), at most 2.5 a second (Attack speed (m)) | `speed` (turns a round), clamp `speedMin` to `speedMax` | built |
| Move speed and its soft caps | past 415 a point counts 0.8, past 490 0.5 (Movement speed (m)) | `move`; the speed clamp is our cap | built |
| Attack range | flat, a few items raise it (Range (m)) | `sheet` op `range`, at most `kit.rangeAdd`, on a worn status | built |
| Critical strike chance, damage | chance 0 to 100%; a crit deals 175% (Critical strike (m)) | `critFaces` (of the d20), `critSize` | built |
| Ability haste | cooldown × 100 / (100 + haste) (Ability haste (s)) | `cooldownCut` | built by `haste-lol` |
| Life steal, physical vamp, omnivamp | heal = share × damage dealt after mitigation; omnivamp from all damage, cut against minions and monsters (Omnivamp (s)) | `drain`: a share of the HP a use or reaction took, any type, no cap (the owner) | built: one key is omnivamp |
| Heal and shield power | heals and shields the champion gives × (1 + power); not on its vamp or regeneration (Heal and shield power (m); Absorption shield (s): "can be increased by heal and shield power") | none: `healed` and `shielded` shares are what a bearer receives | **key** `healPower` |
| Damage converted to shields | Bloodthirster: life steal past full HP becomes a shield, to a cap growing by level (Bloodthirster (m)) | none | **key** `shieldDrain` |
| Tenacity | stacks multiplicatively: 1 − (1 − a)(1 − b); two 30% give 51% (Tenacity (s)) | `tenacity`; control lasts × (100 + potency) / (100 + tenacity) | built (sources add, our curve bounds it) |
| Slow resist | slow × (1 − resist): 50% resist makes a 40% slow 20% (Movement speed (s)) | none | out: tenacity covers |
| Health regeneration | HP per 5 seconds (Health regeneration (m)) | a worn status with a `heal` op `when: 'turn'` | built |
| Mana, energy and their regeneration | resource per 5 seconds (Mana (m)) | `manaMax`; mana comes back on a clear | regen out: by design (mana is the dungeon's brake) |
| Gold generation, experience | support quest, gold per 10 seconds (Gold (m)) | none in a fight | out: not a fight stat |
| Size, gameplay radius | units (Champion statistic (m)) | a body is a tile | out: the grid |
| Lifeline: shield at low HP | Sterak's Gage, Immortal Shieldbow, Maw of Malmortius: a hit under 30% HP gives a shield; one Lifeline at a time, the shields do not stack (Sterak's Gage (s), Maw of Malmortius (s)) | no event for "fell under a share of HP"; `lethal` reactions arm only at 0 | **event** `lowHp` |
| Shield on immobilise | Fimbulwinter and others: immobilising a champion gives a shield (Named item effect (m)) | `statusGained` is the target's event, not the user's | **event** `imposed` |
| Damage reflected (Thorns) | Thornmail, Bramble Vest: struck by a basic attack, deal magic damage of a flat number plus a share of bonus armor, and Grievous Wounds (Named item effect (s)) | a worn status: trigger `struck`, `to: 'other'`, `damage` op `3 + 0.1 * armor`, plus `applyStatus` of a healed cut | built |
| Grievous Wounds | healing received cut 40% (Grievous Wounds (m)) | a `share` op `on: 'healed'`, negative (Brutalize's −50%) | built |
| Spellblade | after an ability, the next basic attack deals bonus damage (Spellblade (m)) | trigger `used` (a tag) puts on a stack that leaves on `hitDealt`, with a `hitDealt` damage trigger | built (needs a tag on the abilities) |
| On-hit damage | flat or % of target HP on each attack (On-hit effects (m)) | trigger `hitDealt`, `to: 'other'`, `damage` reading `target.hpmax` | built |
| Slow or root on hit | Rylai's, Frozen Mallet (m) | trigger `hitDealt` with `applyStatus` | built |
| Armor shred, stacking | Black Cleaver: 5% armor a stack, 6 stacks (m) | a stacking status with a negative `sheet` armor op, put on by `hitDealt` | built (flat points, not %) |
| Stacking stats | Mejai's (per kill), Heartsteel (permanent HP), Manamune (m) | stacking status, `keep: 'sheet'`, `stat` ops per stack | built |
| Energized | moving and attacking fill a charge to 100; the next attack is stronger (Energized (m)) | a stacking status with a threshold | built |
| Heal on kill | Triumph and the like (m) | trigger `kill` with a `heal` op | built |
| Revive, stasis, spell shield, cleanse | Guardian Angel, Zhonya's, Banshee's, Quicksilver (m) | `lethal` reaction, `invulnerable` and `untargetable`, `negate`, `dispel` | built |
| Damage reduction | Plated Steelcaps (−12% from attacks), Randuin's (crits) (m) | a `share` op `on: 'taken'` | built (not by kind of hit) |
| Damage stored and taken later | Death's Dance: a share of damage taken becomes a bleed over 3 seconds (m) | none | out (section 5) |
| Shields add up | League shields stack (Absorption shield (m)) | two shields do not add: the larger holds (`shielded`) | out: our rule stands |

## 2. Two new bonus keys

Both go in `BONUS_KEYS` and `BONUS_HUNDREDTHS` (a point is a hundredth), so an item, a title, a path and the GM's grant
may hold them and every maker that loops the keys gets the row. Both come from bonuses alone, as `drain` does: no stat
feeds them. Neither is a `sheet` op key: a status that needs either is a later unit.

### 2.1 `healPower`: heal and shield power, the giver's side

**Shape.** `Sheet.healPower: Share`, `derive`: `healPower: share(Math.max(0, b('healPower')))`. No cap of its own, as
the owner ruled for lifesteal; the item budget prices it. Bonus label `% Heal and shield power`; sheet label `Heal and
shield power (share)`.

**Formula.** A heal or shield from a giver lands as

```
amount = raw × (1 + giver.healPower) × receiver's share      share = healShare or shieldShare (rule 11c, within kit.shareCap)
```

The giver's power and the receiver's share are two factors, each about one body: `healPower` is what the giver puts out,
`healed` and `shielded` are what the receiver takes in (Brutalize's cut, a blessing's boost). A cut to healing received
still cuts a strong healer's heal, as Grievous Wounds does in League. Only the receiver's share sits inside
`kit.shareCap`; the giver's power is outside it, since it is bought with an item's budget, not put on by a foe.

**What it does not raise** (League's rule, and the reading that keeps a key one thing): its own `drain`, its own
`shieldDrain`, and a status's per-round heal or shield whose source is no body or that is worn (`Status.worn`: an
item's `regenerating`; unit 4 makes a worn item's source its wearer, so the test is `worn`, not a null source). A status
put on by a body (a healer's regeneration) reads that body's power at its source's sheet as it settles.

**The one place.** A function `given(raw, giver)` in `combat/standing.ts` beside `healShare`, returning
`raw * (1 + giver.sheet.healPower)` (a null giver returns `raw`). Its callers, each a line: `resolve.ts` `shared` (the
`heal` and `shield` branches, with `user`), `land.ts` `landOne` (`heal` and `shield`, with `user`), `effect-ops.ts`
`statusShield` (with the source's sheet in `scope.user`), and the per-round `heal` of `fight-turn.ts` (line 67, with the
status's source row when it is in the fight). A lint is not needed: `tests/resolve.test.ts` checks each route.

**Weight.** `BONUS_COST.healPower = r => unfedCost(unitOf('healPower'), r)`: a support's standard heal a round is
about one standard action (`hpRate` reads 1.5 × `sup` HP as one), so a hundredth more of it is a hundredth of a standard
action a round. The wearer is assumed to heal every round, the reading that never undercharges.

### 2.2 `shieldDrain`: a share of damage dealt becomes a shield on the bearer

**Which kind.** A share of the HP the bearer's own uses and reactions take from other bodies (the same `lost` that
`drain` reads, after rule 14: a target's shield part and HP past 0 are not counted) becomes a shield on the bearer. Not
League's overheal (Bloodthirster turns only life steal past full HP into a shield): that one does nothing until the
bearer is full, and a key that works at any HP is the stat the owner named. A trigger's or a status tick's damage does not
feed it, as it does not feed `drain`.

**Shape.** `Sheet.shieldDrain: Share`, `derive`: `shieldDrain: share(Math.max(0, b('shieldDrain')))`, no cap of its
own. New rule `RULES.fight.kit.shieldDrainMax`, with its comment:

```
// The most shield a body holds from its own damage dealt (shieldDrain), a share of its max HP: a fifth, so a hard
// hitter holds at most one fifth of a bar more, about one same-rank hit, and the ceiling, not the share, bounds it.
shieldDrainMax: real(0.2, 0, 1, 'the most shield a body holds from its own damage: at 1 a second full bar'),
```

**Formula** (after `drain` heals, in the same call):

```
gain     = round(lost × shieldDrain × shieldShare(bearer))
ceiling  = round(kit.shieldDrainMax × hpMax)
live     = the bearer's shield amount if it has not ended, else 0
incoming = { amount: min(ceiling, live + gain), until: now + shieldLife × round }
shield   = shielded(current, incoming, now)              the larger holds: a bigger shield from elsewhere is kept
```

It grows with each hit up to the ceiling and lasts `shieldLife` (2 rounds) from the last gain. `shielded`'s rule (two
shields do not add) is untouched: the growth is one shield's, and a larger shield from a Lifeline or a support stays as
it is. `healPower` does not raise it.

**The one place.** `land.ts` `drained` (already called by `resolve.ts` after rule 14 and by `fight-react.ts` for a
reaction) takes both: it heals by `drain`, then grows the shield by `shieldDrain` through a new `shieldGrown(bearer, gain,
ceiling, until, now, R)` in `effect-ops.ts` beside `shieldOn`. `Resolved.drained` stays the HP healed; a new
`Resolved.stored` is the shield gained, and the fight's log line reads "Ana drains 4 and stores 6".

**Weight.** `BONUS_COST.shieldDrain = drainCost`'s rule with the key's unit: an HP of shield is weighed as an HP healed
(`hpRate`). The ceiling is not read, so the cost never undercharges.

## 3. Two new bearer events

Both are members of `BearerEvent` (triggers.ts), so a worn status on an item answers them with the trigger shape that
exists (limit, `to`, land ops). Each needs a rate in `kit.eventRates` so `wornWorth` weighs its trigger.

### 3.1 `lowHp`: the Lifeline

**Shape.** Raised on a body when HP damage takes it from at or above `kit.lowHpAt × hpMax` to under it while it is still
up (a body taken to 0 raises `down`, not this). New rules, each with its comment:

```
// The share of max HP under which a body is low (the Lifeline items' "under 30%"): a third of a bar, about one
// same-rank hit from down, so a shield given there buys a turn.
lowHpAt: real(0.3, 0.05, 0.9, 'the share of max HP under which a body is low: at 0.9 one scratch'),
// eventRates.lowHp: once a fight, as `down` (design 6's reference fight of 6 rounds, a round's share)
lowHp: of(0.17, EVENT_RATE),
```

`lowHp` is not a `Party` event (no other body); its trigger takes `to: 'self' | Reach`. A Lifeline is then a worn status:
trigger `{ on: 'lowHp', limit: { kind: 'fight', n: 1 }, to: 'self', ops: [{ op: 'shield', amount: '0.3 * hpmax' }] }`.
Two Lifelines firing on one hit keep the larger shield (`shielded`), which is League's "one Lifeline at a time" with no
new rule.

**The one place.** A helper `fellLow(before, after, R)` in `triggers.ts`, called at the three places that raise `struck`:
`eventsOf` (a use's hit, from its `before` and `after` rows), `fire` (a trigger's hit, line 204) and `fight-turn.ts`
line 296 (a status's tick).

**Since unit 2 (item-stats-2, the fix).** Raised from `struck`'s places, a burn, a bleed, a settled roll, a zone's hit and
an HP price never fired it. `lowHp` is about HP crossing the line, whatever lowered it, so it is read from the life's one
writer: `rowLifeAfter` (row-life.ts) keeps on a row the HP it had before the fight's damage no batch has read
(`Body.hurtFrom`), and `readHurt` in `fire` reads each fall with `fellLow(from, after, R)` and clears it, at the batch's
start (depth 1) and after each trigger's landing (one deeper, within `kit.depth`). `after` (fight.ts) always fires a batch,
as do `grounded` when the ground paid and a `turn` reaction, so no command ends holding unread damage (the fight model's
invariant). The GM's hand edit sets HP (`setHp`) and fires nothing: a correction is not an event of the fight.

### 3.2 `imposed`: the user put a harmful status on a foe

**Shape.** Raised on the user of a use for each harmful status (standing.ts `harmful`) the use put on a target of the
other side; a `Party` event (the other body is that target), so it may name a tag and `to: 'other'`. A shield on
immobilise is a worn status whose trigger answers `imposed` with a shield op on itself, limit once a round.
New rate `eventRates.imposed: of(1, EVENT_RATE)`, `statusGained`'s, of which it is the user's side: a curse build puts a
status on every action.

**The one place.** `eventsOf` in `triggers.ts`: beside `statusGained` for each `o.statuses` key, when `o.target !== by`,
the target is of the other side and the status in `after` is harmful. A trigger's own `applyStatus` raises it in `fire`
beside its `statusGained`.

**The words.** The status maker's trigger event list gains "falls under 30% HP" (the rule's share read into it) and "puts
a harmful status on a foe"; `fight-parse.ts` reads both (`lowHp` among the self events of line 434).

## 4. The units

Each lands alone with its tests and `bun run test` green. Units 1 and 2 change `derive.ts` and `rules.ts`, which
`balance-2` and `haste-lol` hold now: both wait for those two to land.

| # | Unit | Model | Files it may change | Tests | What a table sees |
|---|---|---|---|---|---|
| 1 | `healPower` and `shieldDrain` (section 2) | opus | `core/rules.ts` (`BONUS_KEYS`, `BONUS_HUNDREDTHS`, `BONUS_LABELS`, `kit.shieldDrainMax`), `hunter/derive.ts` (two fields, labels, formulas), `combat/standing.ts` (`given`), `combat/resolve.ts` (`shared`, `Resolved.stored`), `combat/land.ts` (`landOne`, `drained`), `combat/effect-ops.ts` (`statusShield`, `shieldGrown`), `combat/fight-turn.ts` (the per-round heal), `combat/fight-react.ts` (the stored shield), `combat/fight.ts` (the log line), `registry/item-budget.ts` (two costs) | `derive.test.ts` (both from bonuses only, never under 0); `resolve.test.ts` (a heal and a shield × 1.2 at power 20, then × a −50% healed share; no power on drain; a strike at shieldDrain 50 stores half its HP taken, a second strike grows it, the ceiling holds, a larger support shield is kept, the end is 2 rounds after the last gain); `effect-ops.test.ts` (`shieldGrown`, `statusShield` with a powered source); `item-budget.test.ts` (each cost from its rule, worked in the test); `rules.test.ts` | an item "+20% Heal and shield power" makes a support's heals stronger; an item "+30% Damage to shield" grows a shield as its wearer hits |
| 2 | `lowHp` and `imposed` (section 3) | opus | `combat/triggers.ts` (`BearerEvent`, `fellLow`, `eventsOf`, `fire`), `combat/fight-turn.ts` (the tick's `struck` site only), `combat/fight-parse.ts` (the event lists), `core/rules.ts` (`kit.lowHpAt`, two `eventRates`), the status maker's event list and words (`views/` file that lists `BEARER_EVENTS`; find it with `bun run deps -- BEARER_EVENTS`) | `triggers.test.ts` (fires once when HP crosses under 30%, not at 0, not when already under; `imposed` on a curse's harmful status on a foe, not on an ally's blessing); `worth.test.ts` (a Lifeline's worth from the rate); `fight-parse` cases for both events | a GM writes "Lifeline: under 30% HP, a shield of 30% max HP, once a fight" as an item's worn status |
| 3 | The recipes as items | sonnet | `registry/items.ts` (or its seed list) for four example items, `docs/guide/makers.md` (a recipe each), `tests/items.test.ts` | each item parses, its spend line is inside its grade | the library holds a Thornmail (reflect and a healing cut), a Lifeline, a Spellblade and a healer's charm, each built from shapes that exist |
| 4 | A worn item's source is its wearer; a worn shield lands (6.3) | opus | `combat/rows.ts` (`wornStatuses`, `partyRow`), `combat/fight.ts` (`joined` moves `shield.until`) | `rows.test.ts` ("what a hunter wears into a fight": an item's threshold damage `0.5 * str` reads the wearer's Strength, not each foe's; a worn shield `10 + 0.2 * hpmax` is on the row at hpMax 120 as 34 × its shields share); `fight.test.ts` (a row added at now 30 keeps its shield 2 rounds from 30) | a "Bulwark" ring's shield is up when the fight starts; an item's burst hits by its wearer's Strength |
| 5 | An amount in words, flat, scaling or both (6.4) | opus | `formula.ts` (`amountWords`), `combat/effect-ops.ts` (`opLine`, `opLines` take an optional wearer), `effects.ts` (`describeItem`), the item card's view (`bun run deps -- describeItem`) | `formula.test.ts` ("an amount in words": the owner's three, `5 + 0.3 * str`, `2d6 + str` falls back to its text, no "now" without a body); `effects.test.ts` (a card with and without a wearer) | the item card reads "Shield: 10 + 20% of max HP (now 34)" |
| 6 | `stat` and `sheet` ops take a formula (6.2) | opus | `combat/effect-ops.ts` (`Op`, `modsOf`, `modified`, `opLine`), `combat/standing.ts` (`withSheetOps`, `harmful`), `combat/fight-parse.ts` (`parseOp`), `formula.ts` (`signOf`), `views/maker.js` (the two rows move from `NUMBERS` to formula rows, bounds kept) | `effect-ops.test.ts` (armor `0.1 * hpmax` at hpMax 200 adds 20; a `stat` op on Vitality beside it does not change what it reads; the rule's clamp holds); `fight-parse` cases (a number still reads; `missing`, `charge`, `target.` and the kits' names refused with words); `standing` (`-0.1 * armor` is harmful, `0.1 * hpmax` not) | an item "+armor equal to 10% of max HP" |
| 7 | `Powers`: the active of an item or a title (6.1) | opus | `registry/powers.ts` (new: `Powers`, `parsePowers`), `registry/items.ts` (`Item & Powers`, `parseItem`), `rewards.ts` (`RewardTitle & Powers`, `title`), `hunter/hunter.ts` (`Title & Powers`, the repair at line 216), `size.ts` (`THING_MAX.item`), `registry/abilities.ts` (`wornAbilityId`), `combat/rows.ts` (`heldPowers`, `wornStatuses`, `hunterAbilities`), `hunter/inventory.ts` (`DISTINGUISHING`), `status-refs.ts` (the item and title walks) | `powers.test.ts` (each part read, a refused part dropped, past its size refused whole, `item` dropped); `items.test.ts` (kept on worn types, not on a consumable); `rows.test.ts` (a worn item and the active title give their active, a bag item and another title do not, two of one ring give one, a skill of the same id keeps both); `fight.test.ts` (cooldown under ability haste, a once-a-fight gate, no bag count spent; a shield `10 + 0.2 * hpmax` lands 34 at hpMax 120) | a player taps "Bulwark" on the hotbar, shields for 34, and waits 3 rounds; a title's active shows there too |
| 8 | The budget of scaling amounts and actives (6.5) | opus | `registry/worth.ts` (`bestScope`; `wornWorth` and `abilityWorth` take it; export `usesPerRound`), `registry/item-budget.ts` (`powersSpend`, called by `itemSpend`; `Unbudgeted`) | `worth.test.ts` (a Presence heal weighed on the support build, a Strength hit on the bruiser); `item-budget.test.ts` (each figure worked in the test from the rules: an active's points from its worth a use and its uses a round; a `sheet` armor op as `BONUS_COST.armor`; the spend line names an active it cannot weigh) | the spend line moves as a GM raises 20% to 40% |
| 9 | The item maker's rows (6.6) | sonnet | `views/loot.js` (the "Its wearer can use" group), `views/maker.js` (the "Grows with" row and the words line under a formula amount), `views/kit-parts.js` if the ability form needs a hook | `tests/e2e/makers.e2e.ts` (an item with a flat, a scaling and a combined amount and an active saves and reads back; the words line shows each); a 390 px look of the group | a GM makes the Bulwark in the Workshop on a phone |
| 10 | Recipes that scale | sonnet | as unit 3, two more items | as unit 3 | the library holds a Bulwark (active shield) and a Warden's Plate (armor from max HP) |
| 11 | A title's band and budget (6.7) | opus | `core/rules.ts` (`titleBudget`), `hunter/hunter.ts` and `rewards.ts` (`band`), `registry/item-budget.ts` (`titleSpend`, its line), `registry/feats.ts` and the rule titles in `rules.ts` (a band each, from the ideas file's section) | `item-budget.test.ts` (Still Standing's spend worked from `BONUS_COST` at E; a title with an active at D; over is said, not refused); `rewards.test.ts` (`band` read, absent is E); every built-in title inside its band | a feat's title "Last Light" gives a once-a-fight heal and its line says it fits rank C |
| 12 | The title editor's rows (6.7) | sonnet | `views/reward-editor.js` (Band chips, "Usable in fights", the spend line), `views/hunter.js` (the title card's powers) | `tests/e2e/feats.e2e.ts` or the reward editor's file (a title with a band and an active saves through a feat's reward and is worn into a fight); a 390 px look | the GM gives a title with a power from the feat maker on a phone |

The Lifeline Locket (a shield under 30% HP) waits for unit 2 (`lowHp`): a first-hit stand-in was a different, stronger item. Thornmail's healing cut returns when `itemSpend` prices a `share` op.

Order: 1 and 2 may run side by side once `balance-2` and `haste-lol` have landed: their only shared file is `rules.ts`,
in different blocks of `fight.kit` (unit 1 adds `shieldDrainMax` and the bonus lists, unit 2 `lowHpAt` and two rates), and
`fight-turn.ts`, in different functions (the per-round heal, the tick's events); the lead merges the second. Unit 3 after
both. The guide rows (`docs/guide/combat.md`, `makers.md`) and `docs/dependency-map.md` go with each unit.

Units 4, 5, 6 and 7 may run beside 1 to 3 now, 7 after 4: both change `wornStatuses` (4 its source, 7 where it reads
the powers). 6 shares `effect-ops.ts` with unit 1 (`modsOf` and `opLine` against `statusShield` and `shieldGrown`), 5 and 6
share `opLine` (5 first, or the lead merges). Unit 1's per-round heal reads `worn` (2.1) whichever of 1 and 4 lands
first. Unit 8 after 6 and 7 (it weighs their shapes) and after 1 (`BONUS_COST`). Unit 9 after 5 to 8. Unit 11 after
8, unit 12 after 11 and beside 9. Unit 10 last.

## 5. Left out, each overruled in a line

- **Attack damage, ability power, adaptive force**: the owner, Nov 21 ("I think that's hard to do"); power comes from stats.
- **Slow resist**: tenacity already shortens control; a second number on slows alone is a stat a player cannot feel on a
  grid where a slow is turns, not seconds.
- **Separate life steal and physical vamp**: `drain` reads every HP a use takes (League's omnivamp); a split by damage
  type is a second key for the same feel.
- **Bloodthirster's overheal**: `shieldDrain` gives a shield at any HP; overheal would only matter at full HP.
- **Death's Dance (damage taken stored and paid later)**: needs a store of damage per body and a new tick; a tank already
  has `taken` shares, a Lifeline and `shieldDrain`.
- **Shields that add up**: our rule that two shields keep the larger stands (design 4.4); changing it moves every
  support's balance.
- **Mana regeneration, energy**: mana comes back on a clear by design; fatigue is our energy.
- **Gold generation, experience**: not a fight number; the economy decides them.
- **Move speed soft caps, size, attack windup**: the speed clamp, the tile and the ability kinds already play those parts.
- **A crit-only damage cut (Randuin's)**: a `taken` share covers it; a cut by kind of hit is a new share axis.
- **`healPower` and `shieldDrain` uncapped**: as lifesteal (the owner); if either proves too strong, a cap is one rule.

## 6. Actives and passives that scale with stats

the owner, Nov 21, after League's stats: "And actives and passives that scale with stats", then "Or are flat or are a
combo of the two", then "Also titles/feats should have stat bonuses or extra powers attached to them." An item's passive
(a status while worn, its triggers) and active (an ability its wearer uses in a fight, with a cooldown) have amounts that
are flat (`12`), grow with the wearer's stats or sheet numbers (`0.2 * hpmax`), or both (`10 + 0.2 * hpmax`): each is one
`Formula` from `parseFormula`, so no amount type is added. A title holds the same powers in the same shape (6.1, 6.7).
Everything below was read in the code, not run.

### 6.0 What scales today

| Where an item holds an amount | Formula? | Whose numbers it reads |
|---|---|---|
| A use's `effects` (`damage`, `heal`, `mana`, `fatigue`) | `Tiered<Formula>` | the user: `amountOn` outside a fight (user and target the hunter), `itemAbility` then `resolve` in one |
| A worn status's per-round op (`when: 'turn'`) | `Tiered<Formula>` | the bearer as user and target (`dueAmount` with fight-turn.ts `scopeOf`); kits names read `NO_KIT`, so `missing` is 0 |
| A worn status's trigger ops (`LandOp`) | formulas (`shield` a plain `Formula`) | the bearer as user (`landOps`' hitter, design 1.3.9), the other body after `target.` |
| A worn status's threshold and end ops | formulas | the status's source; an item's is `itemSource` (id null), and a null hitter reads each target itself: **gap** |
| A worn status's `shield` op | `Formula` | lands nowhere: `statusShield` runs only as a status is put on (`landStatus`, the GM's add); `wornStatuses` builds with `statusOn`. The status maker offers it: **gap** |
| `stat`, `sheet`, `share`, `speed`, `threat`, `staggerRate`, `refund` | `Tiered<number>` | none: `modsOf`, `withSheetOps`, `sharesOf` read no body: **gap** for `stat` and `sheet` |

**The names** (formula.ts `NAMES`): the eight stats (`str` to `ctl`) and every `SHEET_LABELS` number lower-cased
(`hpmax`, `armor`, `resist`, `armorpen`, `armorpenflat`, `phys`, `mag`, `sup`, `drain` and the rest), the user's or after
`target.` the target's; `charge`; the kits' names. `healpower` and `shielddrain` come free when unit 1 adds them there.

**Works today.** Passive: a worn trigger `struck`, `to: 'other'`, `damage` `3 + 0.1 * armor` (the wearer's armor), or a
per-round `heal` `0.02 * hpmax`. Active: none. `hunterAbilities` (rows.ts) gives an ability only to a consumable in the
bag, and `Ability.item` means a use spends one (`fight-save.ts`, `play.ts`): the nearest is a potion `20 + 0.1 * hpmax`,
read on its drinker and used up. Words: `opLine` prints `Shield of 10 + 0.2 * hpMax`, no value on the wearer.

### 6.1 One shape for the powers a held thing gives: `Powers`

**Shape.** `Powers = { worn?: StatusDef; active?: Ability }` in a new `registry/powers.ts`: the passive (a status on the
holder's row in every fight, with its triggers) and the active (an ability the holder may use in a fight). `Item` and
`Title` (and `RewardTitle`) are each their own fields `& Powers`, flat, so a saved item's and title's `worn` read as they
are. The stat bonus stays each one's `bonus`, which already reaches the sheet (sheet.ts `SOURCES`: `gear`, `title`).

**One parser.** `parsePowers(v)` reads `v.worn` with `parseStatusDef` and `v.active` with `parseAbility` (the one parser
of an ability; it already drops `item`), each dropped when refused, the whole thing refused when either is past its size
(`statusTooLarge`, `abilityTooLarge`). Its callers, each a line: `parseItem` (worn types only; a consumable keeps its
`effects`), rewards.ts `title`, and the title repair of hunter.ts (line 216), which read `worn` each their own way today.
`THING_MAX.item` grows by `THING_MAX.ability`.

**One place the row reads.** `heldPowers(h)` in rows.ts: the active title's powers at the hunter's rank, then each worn
item's at its rarity's tier, in the slots' order. `wornStatuses` puts each `worn` on; `hunterAbilities` adds each
`active` after the skills', as `wornAbilityId(a.id)` (`worn-` and its id, cut to 40): never a skill's id, and two of one
ring give one active (League's "Unique"). No `item`, so no bag count is spent; its cooldown and `uses` gate are an
ability's. Its user is the holder at the holder's rank, as a skill's: formulas read the holder, `target.` the target.

### 6.2 Passives: `stat` and `sheet` take a formula

**Shape.** Both amounts become `Tiered<Formula>`. A plain number still reads (`parseOp` reads `12` as a number formula),
so a hunter's saved worn items keep their numbers.

**Whose.** The bearer's bare body: `modified` derives the origin once with no status mods, and `modsOf(statuses, bare)`
and `withSheetOps(sheet, statuses, bare, R)` read each amount on it (its tier, times its count), clamped as a number is
today. One pass, no feedback: a status raising Vitality does not change what `0.1 * hpmax` reads. The parser refuses in these two ops what a bare body lacks (`missing`, `charge`,
`target.`, the kits' names) with words: "A lasting change reads its bearer's own numbers: write hpmax, not target.hpmax."

**Harmful.** `harmful` reads a number's sign. A formula's is `signOf(f)` (formula.ts): its value with every name at 1
and each die at its mean, so `-0.1 * armor` lowers and `0.1 * hpmax` raises. One reading, said in its comment.

**Left numbers.** `share`, `speed`, `staggerRate` (a percent already grows with what it multiplies); `threat`, `refund`,
`delay`, `hasten`, `guard` (no League item scales them).

### 6.3 Every amount of a worn item reads its wearer

Unit 4 closes the two gaps of 6.0. `wornStatuses` gives an item's status the source `{ id: the wearer's row, tier: its
rarity's }`, as a passive skill's already has its row, so a threshold's and an end's ops read the wearer (`landThreshold`,
`landEnd`). An item is then its wearer's act: a foe's safeguard refuses its harmful status (`admitted` let a null source
through), and its `threat` ops credit the wearer. `partyRow` lands each worn `shield` op through `statusShield` (the
bearer as user and target, `shieldLife` from the start; `joined` moves `shield.until`). A consumable keeps `itemSource`.

### 6.4 The words a player sees

`amountWords(f, body | null)` in formula.ts, beside `printFormula`, the one place an amount becomes words. For a sum of
a number and terms `c * name` (a stat or a sheet number, the user's): a stat term reads `0.3 × Strength` (`STAT_LABELS`),
a sheet term `20% of max HP` (its `SHEET_LABELS` label, first letter lower-cased); with a body and at least one name it
ends `(now N)`, N the average on that body, rounded. Any other formula (dice, `min`, `target.`, the kits' names) is
`printFormula`'s text, with `(now N)` only when it rolls no dice. The owner's three, at max HP 120:

```
12                 Shield: 12
0.2 * hpmax        Shield: 20% of max HP (now 24)
10 + 0.2 * hpmax   Shield: 10 + 20% of max HP (now 34)
```

`opLine` reads every formula amount through it (`Shield: …`, `Heal each round: …`). The item card passes its hunter's
`hunterSheet` (core works the number out; the view only names the hunter); the maker's preview passes the sample wearer
of the rarity's rank and says so: `(34 on a sample rank C wearer)`.

### 6.5 What a scaling amount costs

Today `wornWorth` weighs a worn status's triggers on a bruiser of the rank and names every standing op unweighed. An
amount that scales costs what it gives on the body that gets the most from it: `bestScope(f, rank)` (worth.ts) is the
scope of the five paper builds of `rank` (`referenceBody`) on which `f` averages highest. Not `SAMPLE_WEARER` (Agility
and Strength, medium kit): on it a heal on Presence would cost nearly nothing and give a support its full size. This is
section 2's reading, the one that never undercharges. One weighing, `powersSpend(p, rank, R)` (item-budget.ts, points):
`itemSpend` adds it at the rarity's rank, `titleSpend` (6.7) at the title's band.

- A trigger's, a threshold's or a per-round op's formula: `formulaWorth` at `bestScope` when `powersSpend` asks
  `wornWorth(def, R, rank, { at: 'best' })`; a passive skill keeps the bruiser.
- A `stat` or `sheet` op: in `powersSpend`, its amount on `bestScope` times `BONUS_COST[key]`, as a bonus of that size
  (there, since item-budget.ts imports worth.ts, not the other way). It leaves `unweighed`.
- The active: `abilityWorth`'s worth a use at `bestScope`, times its uses a round, the fewest of `usesPerRound` (it takes
  an action; export it), `round / cooldown`, and `n / referenceRounds` for a `uses` gate (a rest's read as a fight's),
  times `r.strike / r.phys` as the worn status's. What `abilityWorth` cannot weigh adds `'active'` to `Unbudgeted`.

### 6.6 The item maker's rows (a 390 px phone)

The worn group of loot.js gains a tick "In a fight, its wearer can use an ability", drawing the skill maker's ability
form on first tick. Every formula amount keeps its one text field (typing `12` is the flat case) and gains two lines:

- `Grows with [Max HP ▾] [20] % [Add]`: a select of the stats and sheet numbers, a number, its unit (`%` for a sheet
  number, `×` for a stat), and Add, which appends ` + 0.2 * hpmax` to the field. One row: the select takes the room left
  by a 4.5em number and the button.
- The words line: `amountWords` on the sample wearer, so a GM sees `10 + 20% of max HP (34 on a sample rank C wearer)`.
  The `stat` and `sheet` op rows become formula rows with the same two lines.

### 6.7 Titles hold the same powers

**Today.** `Title` (hunter.ts) holds `bonus` (any bonus key, the sheet's `title` source while active) and `worn?` (on
the row at the hunter's rank); a feat's `RewardTitle` holds both, the built-in feats write only `bonus`. The reward
editor's title row (reward-editor.js, the feat maker's and the GM's) shows name, description, what it replaces, "Bonus
while the title is active" and "Worn in fights" (a library status). Missing: an active, a rank, and any bound.

**What a title needs.** `& Powers` (6.1), so it gives an active as an item does, read by `parsePowers` and put on the
row by `heldPowers`, nothing title-specific; and `band?: Rank`, the rank whose budget it fits (absent reads E, so an
old title is weighed against the smallest budget and shows over when it is more). A new rule, with its comment:

```
// What a title may spend, in points on the sample wearer of its band (item-budget.ts `titleSpend`): the top of each
// band of the ideas file (features/ideas-feats-titles-rewards.md section 4: E 1, D 2, C 2 to 3, B 3, A 4, S 5 and more).
titleBudget: { E: 1, D: 2, C: 3, B: 3, A: 4, S: 5 },
```

**One weighing.** `titleSpend(t, R)` = its bonus at `BONUS_COST` on the band's rates, plus `powersSpend(t, band, R)`,
the item's weighing (6.5). Its line, beside the item's: "Spends 1.2 of a rank E title's 1 point: over." Over is said,
not refused, as an item's spend line does: an S title "and more" is the GM's call.

**The editor** (the title row, 390 px): a Band row of six chips, E to S; "Usable in fights", a select under "Worn in
fights": None or a library active skill, its ability copied in (a kept one shows by name, as a worn status does); the
spend line. The title's card lists its powers, the active's amounts through `amountWords` on its holder.

### 6.8 Left out, each in a line

- **Bonus HP, bonus armor** (League's "bonus" scalings): the sheet holds totals, and totals are what a table sees.
- **An item's active outside a fight**: a second use path for worn gear; the bag's consumables do that.
- **`missing` in a per-round op**: reads 0 there (no kit snapshot); a regen that grows as HP falls is a later unit.
- **A passive skill's `worn` as `Powers`**: a skill is one of the two already (`type`); folding it in moves every skill.
- **Charges of an active** (League's refillable potion): a `uses` gate per fight or per rest is the charge.

## Build note: unit 11, a title's band and budget (Nov 22)

**What exists.** `band?: Rank` on `Title` (hunter.ts) and `RewardTitle` (rewards.ts), read by `parseBand` in the
reward's reader, the hunter's repair and a rule override's title reader (overrides.ts, where an absent band is E so the
rule titles' type keeps one), and copied by `giveTitle` (record.ts: a written title's, or the rule's by its key);
`bandOf` reads absent as E. `RULES.titleBudget` as designed (E 1, D 2, C 3, B 3, A 4, S 5). In
`registry/item-budget.ts`: `titleSpend` (the bonus at `BONUS_COST` plus `powersSpend`, both at the band's rank),
`titleFit` (the lowest band whose budget holds the title weighed at that band) and `titleLine` ("Spends 2.8 of a rank C
title's 3 points: fits rank C.", "...: over, it fits rank S.", "...: over, past every band, rank S's 5 points too.").
Every built-in title has a band from the ideas file's section 4 (Commended, the brief's own, E; the rule titles D, King
of Shadows S). No screen shows the line yet: unit 12 draws it.

**Proof.** `tests/item-budget.test.ts` ("what a title spends"), `tests/rewards.test.ts` ("a title's band"),
`tests/record.test.ts` ("a title's band"), `tests/overrides.test.ts` (a rule title's band); `bun run test` green at
`06784b2` (6233 pass, 0 fail). Files past the brief's list: `overrides.ts`, `hunter/record.ts`, `status-refs.ts` (the
reward title's walk names `band`), `tests/overrides.test.ts`, `tests/record.test.ts`, `docs/dependency-map.md`.

**Where the design did not hold.**
- The ideas file reads 10 max HP as a point. `BONUS_COST` weighs it at what the Vitality giving it costs: a Vitality
  point gives the sample wearer 0.6 max HP at E, 2.5 at S, so 10 max HP spends 16.7 at E and 4 at S. Still Standing
  (+10 max HP, E) was 16.7 against 1, Marathoner (+2 Vitality, +10 max HP, C) 11.1 against 3, and The One Who Overcame
  Adversity (+20 max HP) 33.3 at E and 8 at S, past every band. Each became the Vitality its band holds: Still Standing
  +1 Vitality, Marathoner +3 Vitality, Overcame Adversity +2 Vitality (its three neighbours are +2 on a stat, band D).
- "Last Light gives a once-a-fight heal and fits rank C" holds only for a small heal: a flat heal once a fight spends
  about 0.354 points an HP at C (its HP over the support's standard heal, 1.5 × 26.2, over the 6-round reference fight,
  times 83.4 points a standard action), so C's 3 points hold 8 HP (2.8 points) and 20 HP spends 7.1, past S's 5. Any
  title active a table would call strong is over; the line says so and refuses nothing.

**Calls the owner might have made otherwise.**
- Max HP titles moved to Vitality rather than kept and named as over. To undo: "keep the ideas file's max HP on Still
  Standing, Marathoner and Overcame Adversity and let their line say over".
- The line names the lowest band that holds the title, also when that is below its own band ("Spends 2.0 of a rank B
  title's 3 points: fits rank D."). To undo: "a title within its band's budget fits its band; name another band only when over".
- A title's actives are weighed on the item's scale, so they barely fit. To undo: "a title's budget for its active is
  its own number, not the stat points" (a rule for `titleBudget` per part, or a factor on `powersSpend` for titles).

## Build note: unit 12, the title editor's rows (Nov 22)

**What exists.** The reward editor's title row (`views/reward-editor.js`) gains "Usable in fights" (a select: None, or a
library active skill whose ability is copied in; a kept ability the library no longer holds shows by name), six Band
chips E to S, the title's powers in words and the spend line (`titleLine`), redrawn on every change; over shows gold.
`core/reward-rows.ts`: a title row holds `band` and `active` as fields (the old `rest` is gone, since nothing is left
over), written back only when set. `core/title-card.ts` (`titlePowerLines`) is the one place a title's powers become
lines: the worn status, then the active's name, its amount through `amountWords` on the holder ("Shields: 10 + 20% of max
HP (now 34)"), its ops, its wait and gates. The hunter's title card (`views/hunter.js`) lists them under the bonus, the
lines gold-edged on the active title. `ACTIVE_WORDS` in `rewards.ts`; `gateLine` exported from `ability-kinds.ts`.

**Proof.** `tests/title-card.test.ts`, `tests/reward-rows.test.ts` (a band and an active written, E and none left out),
`tests/e2e/rewards.e2e.ts` (a band C title with Second Wind saves through the Award form, shows on the card at 390 px,
and its ability is on the hunter's fight row as `worn-second-wind`); `bun run test` green, `rewards`, `makers`,
`reward-room` browser files green. Looked at at 390 px: both screens fit, nothing clipped.

**Calls the owner might have made otherwise.**
- The editor's preview ("The player sees") and the reward window do not name the active; only the card and the row do.
- Only library skills are offered as an active, not the built-in seeds.
- The card shows the active even when its title is not the active one (dim), so a player sees what Set active gives.

## Build note: items-small, Last Light, the Lifeline and Thornmail's healing cut (Nov 22)

**Last Light (decision 41).** No title the app ships has a heal, so none was at 20 HP: Last Light is only a case in
`tests/item-budget.test.ts` (8 HP once a fight, band C, 2.8 of C's 3 points) and the name a browser test types. The
pricing stands at about 0.354 points an HP once a fight at C; `titleBudget` is not moved. "Every built-in title has a
band and spends no more than its band's budget" already holds every seeded title. Nothing changed.

**A shield op is weighed.** `landWorth` (worth.ts) weighed a trigger's, a threshold's or an end's `shield` op as nothing
and named it. It is now its HP at `hpRate`, an HP of shield as an HP healed: the support's standard shield and heal are
both 1.5 times `sup`, an active's shield is weighed against it, and `shieldDrain` already reads a shield's HP so. Its
case: `tests/worth.test.ts` ("a trigger's shield is weighed as an HP healed").

**Second Wind (keystone, VIT mark) moved.** Unweighed, it was held only from above; weighed, A.6's 25% of max HP spends
7.3 against the mark's 10, under the 20% band the keystone test holds. It is 35% now (10.2): "a keystone far from its
tier moves" (rules.ts, `keystone.budget`). Danger Sense's 20% shield is weighed too and stays inside its band.

**The Lifeline Locket** (`RECIPE_ITEMS`, Rare+, neck): once a fight, when its wearer falls under 30% HP (`lowHp`), a
shield of `0.1 * hpmax`. Read on the tank (the most max HP), 0.1 × 114 HP at C's `hpRate` times `lowHp`'s 0.17 a
round times C's 83.4 points a standard action: 4.12 against Rare+'s 3.71 to 4.43. League's 30% spends 12.4, near three
times Rare+'s top; 15% spends 6.2. Proof: `tests/items.test.ts`, `tests/recipe-items-fight.test.ts` (a hit
under 30% gives a shield of round(10% of max HP); a hit that leaves it at 30% gives none).

**Thornmail's healing cut: left out, priced.** Heal power's cost reads a giver's whole heal a round as one standard
action, so a hundredth more is a hundredth of an action a round (`healPowerCost`, the reading that never undercharges).
The cut is its mirror on the receiver: a body that takes a support's standard heal a round loses `s` of an action a
round while it holds a cut of `s`. A `struck` trigger (1 a round) that puts a one-round cut on the striker holds it all
fight, so a cut of `s` spends `s` × B's 119.6 points a standard action: League's 40% is 47.8 points, past every grade
of every rarity. Thornmail has 0.59 points left in Epic+ (6.15 of 6.73), which holds a cut of 0.5%; with no reflect at
all, 4.8%. Neither is a cut a table feels, so it stays out. The honest price is lower (a monster seldom heals), but
what a foe heals a round has no rule: the fight simulation would have to measure it first. `statusWorth` still names a
`share` op as not weighed.
