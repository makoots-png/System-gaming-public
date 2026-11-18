# Kits like Glas: the design on paper

Every number below is printed by `bun scripts/kits-paper.ts` under the same section number. The rule numbers it proposes are the block `KIT` at the top of the script, to become `RULES.fight.kit`; section 3 works out the rest from `RULES.fight` and writes them into the same block. Sources: the owner's words (`kits/owner.md`), the four kits and the conditions table (`kits/nikolas-einar.md`, `kits/m-hwei.md`), the fight's design (`rw/design.md`, "design 3.1" below means its section 3.1) and the auras' notes (`final/notes-auras.md`). Sections 1 to 7 took Glas from the first brief's words only (Resonance, Rot and Vision as stacks, an execute, Crimson Pact, Hemoplague, delayed damage); his summary, `kits/glas.md`, came after, and section 8.11 maps it. Section 8 is the second wave (`brief-kits-design-2.md`) and the owner's word of Nov 14 on the execute.

## The summary: every decision on one page

1. **Nine blocks**, each an extension of a thing the fight has: a stack count on a status (1), a threshold on a stacking status (2), a trigger on a status def (3), prices and gates on an ability (4), seven formula names (5), an end on a status (6), a mode that is a status and a gate (7, no new type), upkeep, a cap and an end on zones (8), a timed summon on the shadow's row (9).
2. **A status is a plain or a stacked union**; `stacks` and a threshold cannot be written on a plain one. Stacks add (1 to 3 an op), never multiply; every number of the ops is per stack; a per-round op pays at the count at settle (1.1).
3. **A threshold fires on the crossing**, with no stored flag; spend or keep. **Nothing kills outright** (the owner, Nov 14): an execute is one of eight conditional scalers on damage, with a suggested start and scale that keep it neutral over a fight (8.0).
4. **Triggers live on a status def only**; a passive skill and an item carry a `worn` status, a zone its hold. They fire after the whole use (rule 19b), at their formulas' averages, to depth 2 and 16 a command, with each, once a round or n a fight limits counted on the row (1.3).
5. **Prices** in HP (never the killing blow), stacks (yours or each target's: `spent`) and zones; **gates** on a held status or stacks and on uses a fight or a long rest (1.4).
6. **Formula names** `stacks()`, `field()`, `missing`, `held()`, `hits`, `kills`, `spent`, each bounded, read from a snapshot at rule 6 (1.5).
7. **A delayed effect** is a status's `end`; a cleanse cancels it unless the def says it sets it off; it is never written to a sheet (1.6).
8. **Zones**: an upkeep a round, 3 an owner (a fourth evicts the oldest), an end that pays only after a round (1.8). **Summons**: 2 an owner, 1 to 5 rounds, commanded by the owner's phone, never keeping a side up (1.9).
9. **The room doc** carries stacks, uses left and a summon's row; `DOC_ROWS` goes from 32 to 30 to keep an eighth spare (1.11).
10. **Six machines** with tables and charts: stacks, a delayed effect, a limited use, a summon, a trigger's limit, a zone with upkeep (2).
11. **The budget's unit is the standard action**; the maker warns past 1.08 times a pace's budget, 8% being the triangle's closest margin (3). The three example kits are 0.96 to 1.08 of their plain builds at 6 rounds, their best use under 37% of a tank (table 3.6).
12. **96 of 200 names are makeable** (55% of what the sheet defines); every block is used by two or more (4).
13. **The makers** gain one collapsed group a block and a worth line; three built-ins to copy; 17 units to build, the simulation green before the makers (5).

**Wave 2 (section 8)**, on one page:

14. **No instant kill** (the owner, Nov 14). Eight conditional scalers on any damage: Execute, Opener, Desperate, Steady (an HP share under or over a start), Giant slayer, Cull, Underdog, Bully (the target's part of two max or current HPs). Formula text a tick writes; suggested start 0.5, scale 1 for a share (base cut to 0.8, neutral against every foe, bosses too) and 0.25 to 0.5 for a pair (bounded by the tolerance against the foe it favours) (8.0).
15. **Five new ops** (`sheet`, `share`, `untargetable`, `invulnerable`, `safeguard`); Dispel and Purge are a `cureStatus` selector; Proliferate a trigger with `move`; reflection two trigger-only formula names. A damage-dealt-and-taken product stays in 0.5 to 1.5, half of its upside on a boss (8.1).
16. **Advantage** is on the target's one d20: the attacker's makes it keep the lower of two, the defender's the higher; they cancel, never add. A spent edge is worth 1.02 of a strike to 1.72 of a blast (8.2, table 8.10.2).
17. **Forced moves** stop before walls, pits and bodies, deal nothing, and pay no zone entry; a blink goes to a seen tile within 8 (8.3). **Reactions are armed ahead**, fire by rule once between two of the reactor's turns, and take their time off its next turn; Parry takes 0.30 off a strike (8.4, table 8.10.3; the paper's 0.35, moved by the simulation).
18. **Stacks and zones move** (`move`, shift, grow); **turns** move (one extra action a round, a hasten the giver pays for, React that goes first and adds none): 3.74 turns at most between two of the tank's (8.5, 8.6). **Stealth** is a status the fog already half gives; surprise pushes a side's openings a round; flight stays not now (8.7).
19. **138 of 200 names are makeable** (79% of what the sheet defines), up from 96; 36 still not now, most outside the fight. 13 more units, the core beside or after wave 1's resolve, the makers after the simulation (8.11, 8.12).

## 1. The blocks

Nine blocks make every kit in the summaries that is not "not now". Each one extends a thing the fight already has (a status, an op, an ability, a zone, a row) instead of adding a parallel thing.

### 1.0 The types, in one place

```ts
// effect-ops.ts (as built: an absent field is none, so a def, a status and an ability written before the kits read as they
// were and the makers' round trip through the parsers holds; build-1 notes)
type StatusDef = PlainDef | StackDef;                        // a non-stacking def has no stack rule, so its status has no `stacks`
type DefBase = {
  readonly label: string; readonly desc: string; readonly ops: readonly Op[]; readonly color?: string;
  readonly triggers?: readonly Trigger[];                    // block 3: at most `triggers` (4); absent is none
  readonly end?: End;                                         // block 6; absent is none
};
type PlainDef = DefBase & { readonly stack?: never };
type StackDef = DefBase & { readonly stack: StackRule };
type StackRule = {
  readonly cap: number;                                       // 1 to `stackCap` (20)
  readonly leave: { readonly kind: 'never' } | { readonly kind: 'round' } | { readonly kind: 'event'; readonly event: BearerEvent };
  readonly keep: 'fight' | 'sheet';                           // a fight's count, or written back to the sheet
  readonly threshold: Threshold | null;                       // block 2: exists only on a StackDef
};
type Threshold = {
  readonly at: { readonly kind: 'count'; readonly n: number } | { readonly kind: 'formula'; readonly formula: Formula };
  readonly to: Reach; readonly ops: readonly LandOp[]; readonly then: 'spend' | 'keep';
};
type Reach = { readonly kind: 'bearer' } | { readonly kind: 'area'; readonly radius: Tiles; readonly on: AuraOn };
type End = { readonly ops: readonly LandOp[]; readonly cleanse: 'cancel' | 'land' };
type Status = PlainStatus | StackStatus;                      // the def's `stack` tells them apart (`stacked(s)`); `statusOn(def, ...)` picks the arm
type PlainStatus = StatusCommon & { readonly def: PlainDef; readonly stacks?: never };
type StackStatus = StatusCommon & { readonly def: StackDef; readonly stacks: number };
// What a trigger, a threshold or an end lands: an ability's own ops, plus a hit, a heal, and time back on self. A hit's
// formula may carry the scalers of 8.0 (an execute among them); there is no op that kills outright.
type LandOp = UseOp | Extract<Op, { op: 'damage' | 'heal' }> | { readonly op: 'refund'; readonly pct: number };
// UseOp's applyStatus gains `stacks` (1 to `stackAdd`, 3), cureStatus gains `stacks` (1 to 3, or absent for all).

// triggers.ts (new, pure; `Tag` is ability-types.ts's, beside the ability that carries it)
type BearerEvent = 'hitDealt' | 'struck' | 'critDealt' | 'critTaken' | 'kill' | 'avoided' | 'turnStart' | 'turnEnd' | 'moved';
type Party = 'hitDealt' | 'struck' | 'critDealt' | 'critTaken' | 'kill' | 'avoided';   // events with another body in them
type Trigger = { readonly limit: Limit; readonly ops: readonly LandOp[] } & (
  | { readonly on: Party; readonly tag: Tag | null; readonly to: 'self' | 'other' | Reach }   // tag: only a hit of an ability with it
  | { readonly on: Exclude<BearerEvent, Party>; readonly to: 'self' | Reach }
  | { readonly on: 'statusGained' | 'statusEnded'; readonly key: StatusKey; readonly to: 'self' | Reach }
  | { readonly on: 'used'; readonly tag: Tag; readonly to: 'self' | Reach });
type Limit = { readonly kind: 'each' } | { readonly kind: 'round' } | { readonly kind: 'fight'; readonly n: number };
type Tag = string & { readonly [brand]: 'Tag' };              // a GM's word: "disaster", "ultimate", "sword"

// ability-types.ts (each absent when none, as `zone` is)
type Ability = /* today's fields */ & {
  readonly tags?: readonly Tag[]; readonly prices?: readonly Price[]; readonly gates?: readonly Gate[]; readonly summon?: Summon;
};
type Price =
  | { readonly kind: 'hp'; readonly amount: { readonly kind: 'flat'; readonly n: number } | { readonly kind: 'share'; readonly share: number } }
  | { readonly kind: 'stacks'; readonly key: StatusKey; readonly from: 'self' | 'target'; readonly take: { readonly kind: 'n'; readonly n: number } | { readonly kind: 'all' } }
  | { readonly kind: 'zone'; readonly name: string | null; readonly take: 'one' | 'all' };
type Gate =
  | { readonly kind: 'holds'; readonly key: StatusKey; readonly on: 'self' | 'target'; readonly atLeast: number }
  | { readonly kind: 'uses'; readonly per: 'fight' | 'rest'; readonly n: number };
type Summon = { readonly name: string; readonly archetype: Archetype; readonly rounds: number; readonly statuses: readonly { readonly key: StatusKey; readonly rounds: number }[] };

// zones.ts: ZoneSpec and Zone gain
//   upkeep: { fatigue: number; mana: number } | null; end: readonly LandOp[]; triggers: readonly Trigger[]
// effect-ops.ts Body gains
//   used: Record<AbilityId, number>; trips: Record<TripKey, Trip>; kills: number; owner: CombatantId | null; until: Tick | null
//   and CombatantKind gains 'summon'
// formula.ts Formula gains
//   | { kind: 'stacks'; whose: Whose; key: StatusKey } | { kind: 'field'; key: StatusKey } | { kind: 'missing'; whose: Whose }
//   | { kind: 'held'; key: StatusKey } | { kind: 'count'; name: 'hits' | 'kills' | 'spent' }
```

### 1.1 A stack count on a status

1. A status def is plain or stacking. A stacking def has a `stack` rule: a cap (1 to 20), how stacks leave, whether the count is a fight's or the sheet's, and an optional threshold.
2. A body still holds one instance per key. A stacking instance holds `stacks`, 1 to its cap.
3. An `applyStatus` op adds `stacks` (1 by default, at most 3) to what the instance holds, up to its cap. The end, the source and the def follow today's rule: the later end, and the higher tier's source and def. A `cureStatus` op takes `stacks` (1 to 3) or, with none given, the whole status.
4. Every number of the def's ops is per stack: a `damage` or `heal` amount, a `stat` amount, a `speed` percent, a `staggerRate` percent and `threat` are multiplied by `stacks`. An op with no number (`hold`, `root`, `taunt`, `aura`) acts from one stack. The speed clamp (40 to 250) still bounds the result.
5. Stacks leave in one of three ways: `never` (only with the status: its end, a cure, a price that takes them), `round` (one at the bearer's settle for each whole round held since `since`, as a spread counts its rounds), or `event` (all of them when the bearer has the named event: it crits, is struck, moves).
6. `keep: 'fight'` drops the status when the fight ends and never writes it to a sheet (Pain, Baangs, Haste). `keep: 'sheet'` writes it back with its stacks (Mercy, Cold).
7. A per-round op of a stacking status pays at the count it holds when its bearer settles.
8. A counter that is a resource (Baangs, Pain, Haste, Trick, Mercy) is the same thing on its owner: a stacking status the owner's own abilities and triggers add to and spend.

Where stacks live, three variants. (a) One instance per stack, many entries under one key: it breaks "one instance per key" that `applyStatus`, the doc and the sheet all rely on, multiplies the settle's work by the cap, and makes the doc 20 rows of the same chip. (b) A separate `counters` map on the body beside its statuses: two homes for one thing, since a counter with ops, an end and a source is a status, and the cure, the doc and the write-back would each need a second path. (c) A count inside the one instance, with the status a union of a plain and a stacked arm. **Chosen: (c).** The compiler refuses `stacks` on a plain status and a threshold on a plain def; every other path (cure, doc, sheet, aura, spread) keeps reading one instance per key.

Rule 7, three variants. Paying by the count at settle (chosen), by the count at the last settle (one more stored number, `paidStacks`), or by time-weighted stacks (a stored integral). The over-pay of the chosen rule is at most `(cap - 1) * rate` for the span between two settles of the bearer, and the budget (section 3) already prices a per-round op of a stacking status at its cap, so the warning covers it. The chip shows one number and pays by that number.

### 1.2 A threshold on a stacking status

1. A threshold exists only on a stacking def (the type). Its count is a number, or a formula over the bearer (`vit / 2`), read at the moment and clamped to 1 to the cap.
2. It fires on the crossing: when one change takes the count from below its threshold to at or above it. Nothing is stored for "already fired", so a `keep` threshold fires again only after the count falls below and climbs back.
3. Its ops land once, on the bearer or on the area around it (`to`), from the status's source, at their formulas' average (rule 1.3.6). Then `spend` takes the threshold's count off (the rest stays), or `keep` leaves the count as it is.
4. **No execute op** (the owner, Nov 14, which replaces the first design's kill at 35% and 25%): a threshold's, a trigger's or an end's damage, like an ability's, may carry the conditional scalers of section 8.0, an execute (more damage the lower the target's HP) among them. Nothing in a fight takes a body to 0 except damage.

The alternative to rule 2 was a stored `fired` flag per instance: a second field that must agree with the count. The crossing is computed from the count before and after the change in the same function, so it needs none.

### 1.3 A trigger: when an event, then ops

1. A trigger is an event, a limit, a reach and ops (`Trigger`). Its events are a closed union: a hit dealt, struck, a crit dealt, a crit taken, a kill, an avoid (out or resisted: the owner's Parry and Retribution), a turn's start, a turn's end (after the command that spent the turn), a move, a status of a named key gained or ended, an ability of a named tag used. A hit, a crit or a kill may name a tag too: then only one dealt by an ability with that tag fires it (Void Knight's sword, Spirit Archer's bow, Rend's killing blow). Entering a zone is not a trigger event: a zone's on-entry ops already are (design 4.7).
2. **A trigger lives on a status def, and nowhere else.** A passive skill and an item get one through a new field `worn: StatusDef | null`, put on its holder's row at the fight's start until removed, from the hunter at its rank (an item at its rarity, as `itemSource` does). A zone gets one through `ZoneSpec.triggers`, copied into its hold's def. So one reader, one place a trigger fires from, four ways to carry one.
3. Its limit is `each` (every event), `round` (once in a round of fight time, `floor(now / round)`), or `fight` (n times, 1 to 10). The count is the row's `trips`, keyed by status key and trigger index, so a cure and a fresh copy of the status do not reset a once-a-fight trigger.
4. Its reach is self, the other body of the event (the one hit, the striker, the one killed), or an area around the bearer (`Reach`). The type allows `other` only on events that have one.
5. **Order (new rule 19b).** A use resolves whole, rules 2 to 19. Then the events it raised fire in order: by outcome (each target in the order resolve took them), and in each outcome the user's events before the target's; within a body, its statuses in list order and each def's triggers in order. A settle's events (turn start, a status ended, a delayed hit) fire after the settle the same way.
6. A trigger's, a threshold's and an end's numbers are their formulas' averages: no dice are asked for. Reason: the dice of a use arrive inside the command (design 3.1), and what a trigger will need cannot be known before the use resolves. `statusShield` already reads a formula's average for the same reason.
7. **The chain is bounded.** The use is depth 0, its triggers depth 1, the events their ops raise depth 2, and nothing fires past 2 (`depth`). At most 16 triggers fire in one command (`fires`). Reason for 2: the deepest chain the kits write is Parry, then Retribution's counter-hit, then Void Knight's Corruption stack on that hit. A third level multiplies the worst case by the triggers a row can hold (4), and no kit asks for it.
8. A trigger with a `refund` op (time back, as Rend's "regain the AP of the killing blow") has the limit `round` at most: the parser lowers `each` to `round`, so a kill cannot buy a turn that buys a kill without end.
9. A trigger's damage is a hit dealt by the bearer for rule 12 (defence) and for its events. A price in HP (1.4) is not damage: it raises no `struck`, so an HP cost never feeds a Pain stack.

Trigger order, three variants. (a) Inline, as part of the hit (between rules 14 and 15): the hit's threat, stagger and channel rules then see a body its own trigger changed, and an area's later targets see the earlier targets' triggers, so the order of targets changes the numbers. (b) After the whole use, as a queue (chosen). (c) At the next turn start: Retribution's counter and Rend's refund would come a turn late. **Chosen (b)**: a use's outcome never depends on its own triggers, the log reads in order, and the queue is where the depth and the count are enforced.

### 1.4 Costs and gates on an ability

1. **A price in HP**, flat (1 to 999) or a share of max HP (0.01 to 0.5), is paid in rule 4 with the mana. It is refused (`hp`) when the user's HP is at or under it: a price is never the killing blow. It skips the shield.
2. **A price in stacks** takes `n` or `all` of a named status from the user (rule 4) or from each target (new rule 10a, before the formula). A user who holds fewer than `n` is refused (`stacks`); a target gives what it holds, up to `n`. What a target gave is the formula's `spent` (1.5).
3. **A price in zones** ends one of the user's zones of that name (the one under the aim, else the oldest) or all of them (Pact Redux, Soul Shatter). It is refused (`zone`) when the user holds none.
4. **A gate** is checked in new rule 3b, after the cooldown: `holds` (a status on the user or on the aimed target, at least `atLeast` stacks; 1 for a mode) or `uses` (n a fight or n a rest, 1 to 10). A use the gate refuses changes nothing (`gated`, `noUses`).
5. A `uses` count is the row's `used`. A `rest` count is also the hunter's: `Vitals.used`, written back with `vitals` and cleared by a long rest in `vitals.ts`. A "per day" in the sheet reads as per long rest: the table rests once a day.

### 1.5 New inputs to a formula

| Name | Reads | Bound | The parser refuses |
|---|---|---|---|
| `stacks(key)`, `target.stacks(key)` | the stacks of a status on the user or target (0 if none) | the def's cap, at most 20 | a key that is not a status key's form |
| `field(key)` | the stacks of a status on every body that is up | 60 (`fieldStacks`) | `target.field` |
| `missing`, `target.missing` | `1 - hp / hpMax` of the user or target | 0 to 1 | nothing more |
| `hits` | bodies in the shape at rule 6 | 16 (`hits`) | `target.hits` |
| `kills` | the user's kills this fight (the row's `kills`) | 10 (`kills`) | `target.kills` |
| `held(key)` | rounds the user has held a status (`(now - since) / round`) | 10 (`held`) | `target.held` |
| `spent` | stacks this use's price took: from this target (rule 10a), or from the user (rule 4) | the price's key's cap | `target.spent` |

The key inside the brackets is read as a status key (`a-z`, digits, hyphens), so `stacks(hemo-plague)` is not a subtraction. A status's own ops and a trigger's read the same names, with the bearer as user and as target where no use is under way.

Snapshot or live, three variants. (a) Live per target, as resolve walks them: a target's stacks would include what an earlier target's chain changed, so an area's numbers depend on the order of targets. (b) A snapshot at rule 6, when the shape's bodies are known (chosen). (c) A snapshot at the start of the command, before the price: then `stacks(pain)` on a use that spends Pain reads what is about to go. **Chosen (b)**: `hits` exists only then, every target reads the same field, and `spent` says what the price took, so a formula never needs to read the stacks after it.

### 1.6 A delayed effect

1. A status def may have an `end`: ops that land on the bearer from the source when the status's time runs out, at its settle (design 1.3: a status leaves at the first turn at or after its end), times its stacks if it stacks.
2. A cure does what `end.cleanse` says: `cancel` (nothing lands; the default, so a cleanse saves you) or `land` (it lands at once: a detonation).
3. A bearer that goes down, a price that spends it to 0 and the fight's end void it: nothing lands, and a status with an end is never written to a sheet.
4. "After n rounds" is a status of n rounds with no ops and an end (a rend, a bomb). Hemoplague is per-round damage and an end.

### 1.7 A mode

A mode needs nothing new. It is a status on its user (a plain one, or stacking with a cap of 1 when something counts it), put on by an ability aimed at its user that has a price (Crimson Pact: 10% of max HP), and read by other abilities' `holds` gates. A stance that excludes another is an ability whose ops are `cureStatus` of the others, then `applyStatus` of its own. Hwei's mood is a worn status with three triggers, `used` of tag `disaster`, `torment` and `serenity`, each curing the other two moods and applying its own. Leaving a mode is its time, a cure, or an ability that cures it.

### 1.8 Zones

1. **Upkeep.** A `ZoneSpec` may have an upkeep in fatigue or mana a round, paid by its owner at its turn start for the time since it last paid, as a per-round op pays. An owner who cannot pay loses the zone at once, with no end.
2. **A cap per owner.** One owner holds at most 3 zones (`zonesPerOwner`, Einar's starting boundaries). A fourth ends the oldest with no end.
3. **An end for a payoff.** A zone may have `end` ops, landing on whoever stands in it when it ends by its time or by its owner's zone price, at least a round after it was laid (`zoneAge`). It pays nothing when it lapses, is evicted by the cap, or its owner goes down. Reason for the age: placing and ending a zone in one turn would be a blast with no wind-up.
4. Growth stays design 4.8's.

### 1.9 A timed summon

1. An ability may `summon` (new rule 18d): a new row on the user's side, of the user's rank, with the archetype's body and attack (`monsterRows`' recipe, kind normal), its starting statuses, `owner` the user and `until` now plus 1 to 5 rounds. It places at the first free tile next to the user (`defaultPlace`'s search from the user).
2. It acts on its own turns: `at = now + interval(speed)`, no opening die. A player's phone commands the summons of its hunter: `onTurn` (protocol.ts) accepts a `step`, `cast` or `pass` for a row whose `owner` is the sender's hunter.
3. It leaves at its turn start at or after `until`, when its owner goes down or leaves, at 0 HP, or when a third summon of the same owner arrives (the oldest leaves, `summons` 2). It gives no XP, writes back to no sheet and does not keep its side up (`overIf` skips it): a fight is not held by a sprite.
4. It is the shadow's row with a different `kind` and no holder. Reason: one row recipe for every body the party did not bring.

### 1.10 Where each block lives and the new rule numbers

| Block | Module | Rule in design 3.1, or the settle |
|---|---|---|
| Stacks, threshold, end | `effect-ops.ts` (`StackRule`, `endOf`), the count's machine in `stacks.ts` (`stackStep`, as built), parsed by `parseStatusDef` (`fight-parse.ts`) | Rule 18 adds stacks; 18a the threshold check after each application; the settle (S1) takes `round` stacks, then (S2) lands ends of statuses that ran out |
| Triggers | new `combat/triggers.ts` (`eventsOf`, `fire`), called by `fight.ts` after `resolve` and by `startTurn` | 19b, after rule 19; at the settle (S3) the turn start's |
| Prices and gates | `resolve.ts` | 3b gate; 4 HP, self stacks and zone prices with mana (after it, as built: a use the mana refuses is refused for mana); 10a target stacks, after the avoid. As built in unit 6: the `uses` gate waits for the row's `used` (unit 11) and the zone price for the fight's zones (unit 9); a use's thresholds come back in `Resolved.bursts` |
| Formula inputs | `formula.ts` (names), `resolve.ts` (the snapshot `KitScope`) | 6b the snapshot after rule 6 |
| Scalers (8.0) | the formula's text, written by a tick (`registry/ability-kinds.ts`) | 10, inside the formula |
| Zone upkeep, cap, end | `zones.ts` (`zoneSync`), `fight-turn.ts` | 18b's cap; the settle (S4) the owner's upkeep |
| Summon | `rows.ts` (`summonRow`), `resolve.ts` | 18d; the settle (S0) sends away a summon whose time is up |
| Limits | the row's `used` and `trips` | 3b and 19b |

### 1.11 The caps and the room doc

Table 1.1 is every cap, in one block of rules (`RULES.fight.kit`), each with what a parser or the reducer does past it. A parser gives a wrong field its default, as `parseItem` does, and refuses only what has no name. As built, the same block also holds `hpShareMin` (0.01, the share's floor the table names), the tolerance (0.08, section 3), the scalers' numbers of 8.0 (`scalers`, `scaleCap`, `scalerStart`, `scalerStep`, `pairFull`) and the reference dungeon they are weighed over (`reference`: tables 3.2 and 8.0.1 at E, C and S).

The room doc carries for a player's phone: a stacking status's `stacks` beside its `left`; the current row's uses left for each limited ability (`left`, beside `ready`); a summon as a row of kind `summon`. A threshold, a trigger, an end and an upkeep are not in the doc: a player sees what they did in the log. Table 1.2 rebuilds the worst case of `tests/protocol.test.ts`: today it is 54,777 characters, 61,625 with an eighth to spare, under `DOC_MAX` 62,000. Six stacking statuses on each of 32 rows and the uses left make it 57,642, over (64,848). **`DOC_ROWS` goes from 32 to 30.** A worst-case row is 1,426 characters, so the doc is 54,790 and 61,639 with the eighth. Reason: 30 rows is still 4 hunters, 4 shadows, 4 summons and 18 monsters, more than a phone draws, and dropping the spare or the six statuses a row would hide the next addition's cost.

## 2. The state trees

Six things have states. Each becomes a `TABLE` typed as the fight's is (`{ [S in State]: { [E in Event]: Cell | null } }`, so the typecheck asks for every cell), a chart view in `scripts/charts/` and an entry in `MACHINES` (`scripts/statecharts.ts`), with its events in `tests/models/`. A mode is not a machine of its own: it is table 2.1 with a cap of 1. A threshold is a cell of 2.1, not a machine: it has no state between two changes. The tables are the script's `MACHINES`; a pair of state and event not listed changes nothing.

The charts, as sketches (`[x]` is a state, `--e-->` an event):

```
2.1 stacks   [absent] --apply k--> [held n] --apply k--> [held min(n+k, cap)] --crossing--> (firing) --spend--> [held n-N | absent]
                                   [held n] --a round | a price--> [held n-m | absent]          (firing) --keep--> [held n]
                                   [held n] --its event | time ends | cure | fight ends (keep: fight)--> [absent]
2.2 delayed  [absent] --apply--> [armed] --apply--> [armed] --settle at until | cure (land)--> [landed]
                                 [armed] --cure (cancel) | spent to 0--> [cancelled]    [armed] --down | fight ends--> [void]
2.3 uses     [ready k] --used--> [ready k-1] ... --used--> [spent] --fight ends (per fight) | long rest (per rest)--> [ready n]
2.4 summon   [absent] --summon--> [present] --turn at or after until | owner down | HP 0 | a third | fight ends--> [gone]
2.5 trigger  [ready] --event (round)--> [tripped] --a later round--> fires;   [k of n] --event--> [k+1 of n] ... [spent]
2.6 zone     [laid] --paid--> [laid] --unpaid--> [lapsed];  [laid] --a fourth--> [evicted];  [laid] --time | price, a round old--> [ended, end lands]
```

Table 2.1: A stacking status on one bearer (`TABLE` in stacks.ts `stackStep`, as built). A per-round op pays at the count held as the settle starts, then the round's stacks leave; a count taken to 0 by a round, an event, a price or a spend is spent, not ended (`settle` answers it in `spent`).

| From | Event | To | What happens |
|---|---|---|---|
| absent | apply k | held min(k, cap) | Source, end and `since` as `applyStatus` sets them today; then the threshold check |
| held n | apply k | held min(n + k, cap) | The later end, the higher tier's source and def; then the threshold check |
| held n | crossing (n before < N <= n after) | firing | N is the threshold's count, or its formula over the bearer, clamped 1 to cap |
| firing | then spend | held n - N, or absent at 0 | The threshold's ops land on the bearer (or its area) once, from the status's source |
| firing | then keep | held n | Fires again only after the count falls below N and climbs back |
| held n | a whole round (leave: round) | held n - 1, or absent at 0 | Counted at the bearer's settle from `since`, as a spread counts its rounds |
| held n | the named event (leave: event) | absent | All stacks leave: the bearer crits, is struck, moves |
| held n | a price takes m | held n - m, or absent at 0 | Going down never fires a threshold |
| held n | time ends | absent | Its end lands if it has one (2.2) |
| held n | cure (a cleanse, the GM) | absent | All stacks at once, as the sheet's Dispel says |
| held n | the fight ends (keep: fight) | absent | Not written to the sheet: Pain, Baangs, Haste are a fight's count |
| held n | the fight ends (keep: sheet) | held n on the sheet | Written back with its stacks and rounds left: Mercy, Cold |

Table 2.2: A delayed effect (a status with an end) (`TABLE` in effect-ops.ts `settle` and `endOf`).

| From | Event | To | What happens |
|---|---|---|---|
| absent | apply | armed | Its `until` is the applying op's duration |
| armed | apply again | armed | The later end: a second Hemoplague pushes the hit back, and a stacking one grows it |
| armed | the bearer's settle at or after `until` | landed | The end's ops land on the bearer from the source, at their average, times the stacks |
| armed | cure, end: cancel | cancelled | Nothing lands (the default: a cleanse saves you) |
| armed | cure, end: land | landed | It lands at once (a detonation: Ceremony, a rend) |
| armed | a price spends it to 0 | cancelled | Spent is not ended |
| armed | the bearer goes down | void | Nothing lands; a hunter at 0 keeps it (it is dying, not gone) |
| armed | the fight ends | void | Dropped, never written to a sheet |

Table 2.3: A limited use (an ability with uses a fight or a rest) (`TABLE` in resolve.ts rule 3b, the row's `used`).

| From | Event | To | What happens |
|---|---|---|---|
| ready k left | used | ready k - 1, or spent at 0 | Counted when the use resolves, not when it is refused |
| spent | used | spent | Refused: `noUses` |
| ready or spent (per fight) | the fight ends | ready n | The row is gone; the next fight's row starts at n |
| ready or spent (per rest) | the fight ends | the sheet keeps k | Written back with `vitals` (`Vitals.used`) |
| ready or spent (per rest) | a long rest | ready n | vitals.ts `rest` clears `used` |
| any | the GM sets it | ready k | The fight's `adjust` gains `used` |

Table 2.4: A timed summon (`TABLE` in fight-turn.ts `startTurn`, resolve.ts rule 18d).

| From | Event | To | What happens |
|---|---|---|---|
| absent | a use with `summon` | present until now + rounds | A new row on the user's side, `at = now + interval`, owned by the user |
| present | its turn starts before `until` | present | Its owner's phone commands it (the GM's for a monster's) |
| present | its turn starts at or after `until` | gone | Removed before it acts: a summon of 2 rounds acts in 2 rounds of time |
| present | its owner goes down or leaves | gone | A sprite with nobody to will it |
| present | HP 0 | gone | As a monster at 0 |
| present | a third summon of the same owner | gone (the oldest) | Two at once (`summons`) |
| present | the fight ends | gone | Never written to a sheet |

Table 2.5: A trigger's limit (one trigger of one status on one bearer) (`TABLE` in the row's `trips`, fight-turn.ts `fire`).

| From | Event | To | What happens |
|---|---|---|---|
| ready | its event (limit: each) | ready | Its ops land; counted against `fires` and `depth` |
| ready | its event (limit: once a round) | tripped this round | The round is `floor(now / round)` |
| tripped this round | its event, same round | tripped this round | Nothing |
| tripped this round | its event, a later round | tripped this round | Fires: the round moved on |
| ready (k of n a fight) | its event | ready k + 1, or spent at n | The count lives on the row, so a cure and a new copy of the status do not reset it |
| any | past depth 2 or 16 firings | unchanged | Skipped, not counted |

Table 2.6: A zone with an upkeep (`TABLE` in zones.ts `zoneSync`, fight-turn.ts `startTurn`).

| From | Event | To | What happens |
|---|---|---|---|
| laid | its owner's turn starts | laid | The owner pays the upkeep for the time since it last paid, as a per-round op pays |
| laid | the owner cannot pay | lapsed | Gone at once, no end payoff |
| laid | a fourth zone of the owner | evicted (the oldest) | Gone, no end payoff |
| laid | a price ends it, at least a round old | ended | Its end ops land on whoever stands in it |
| laid | a price ends it, younger | ended | Nothing lands (`zoneAge`) |
| laid | `until` passes | ended | Its end ops land (Harmony's stun) |
| laid | its owner goes down (ends with owner) | ended | Nothing lands: the owner is not there to close it |

## 3. The budget

**The unit is the standard action (SA)**: the average of the recommended standard formula, `1d8 + power`, read by the user (`recommended` in `registry/ability-kinds.ts`). A quick ability's budget is 0.7 SA and a heavy one's 1.5 (`RULES.fight.cost`), and design 6's single-hit bound and its triangle are in the same unit. Each block is priced in SA so the maker can add up a made ability or status and show the sum against its pace's budget, and warn (never refuse) past it.

**The tolerance is 0.08**: the maker warns past 1.08 times the budget. Reason: on paper the closest row of the triangle at C and S is the cannon over the tank by 1.08 (table 3.1, design table 6.1's closed form), so a kit that adds more than 8% to its plain build can flip that row by itself.

| Row | C | S |
|---|---|---|
| speed over cannon | 2.84 | 5.87 |
| tank over speed | 1.25 | 1.24 |
| cannon over tank | 1.08 | 1.14 |

**There is no execute share.** Table 3.2 is the party's rounds against a pack and a boss on paper (E 3.14 and 5.52, C 3.20 and 5.66, S 3.80 and 6.76), which weigh the reference dungeon of section 8.0. Until the owner's word of Nov 14 it chose a share at which an execute killed outright; an execute is now a scaler on damage, priced in 8.0.

**What each block is worth** (table 3.4 prints the rules with C numbers):

- A per-round op of a stacking status: its amount times the rounds it is held, times the stacks: at the cap when the status maker shows a def alone (rule 1.1.7 pays at the count at settle, so the cap is the honest upper bound), and per stack added when an ability applies it (as built: `worth.ts` `statusWorth`, so a 1-stack Rot is not charged five stacks a use).
- A threshold payoff of x SA at N stacks: x / N for each stack an ability applies, times the share of its uses that land (a curse resisted applies no status).
- A trigger: its ops' worth times its event's rate a round (table 3.3: at C a speed build deals 1.61 hits a round, a tank 0.70, a cannon 0.85; any build is struck about once a round by one brute; crits are 0.03 to 0.09 a round; kills 0.11 to 0.47). A passive skill's or an item's worn status may be worth at most the tolerance, 0.08 SA a round: the same rule as a kit, since a passive is a kit with no ability.
- An HP price: HP / (a same-rank support's heal in one action, `1.5 * sup`) SA. Reason: an HP price is worth what the party spends to heal it back. 10% of a C cannon's max HP is 0.21 SA, of a C bruiser's 0.26.
- A delayed hit of x SA: x, with no discount for the wait, so the warning comes early rather than late.
- A scaler (8.0): its mean bonus over the reference dungeon, which the suggested base cut pays back, so a suggested one is worth nothing more.
- A mode (table 3.5): its price (the standard action that enters it plus its HP at the rate above) spread over the uses it lasts is the credit each ability it gates may carry above its pace's budget. Crimson Pact (10% of max HP, 3 rounds) gives each gated use 0.40 to 0.43 SA more.

| C build | Turns | Hits dealt | Struck | Crits dealt | Kills |
|---|---|---|---|---|---|
| speed | 2.01 | 1.61 | 1 | 0.08 | 0.27 |
| tank | 0.70 | 0.70 | 1 | 0.03 | 0.16 |
| cannon | 1 | 0.85 | 1 | 0.04 | 0.42 |
| bruiser | 1 | 1 | 1 | 0.05 | 0.35 |
| support | 1 | 1 | 1 | 0.05 | 0.47 |

| Rank | Price (SA) | Uses in the mode | Credit per gated use (SA) |
|---|---|---|---|
| E | 1.29 | 3 | 0.43 |
| C | 1.21 | 3 | 0.40 |
| S | 1.20 | 3 | 0.40 |

**Three example kits** (table 3.6), each against the plain build of the same body (a curse of `1d8 + mag` every turn for the cannon, a strike for the bruiser), on the speed, tank and cannon builds at E, C and S over 4, 6 and 8 rounds. Payoffs count as whole firings of a binomial count of stacks, so a 4-round fight often has none. Each kit's one lever was searched as the largest that keeps it within the tolerance at 6 rounds (design 6's reference fight):

- **Blood stacker (Glas)**: Bloodletting, a curse at 0.7 of the standard budget, adds a Resonance stack when it is not resisted; at 3 stacks Resonance bursts for **1.6 SA** and spends (its execute scaler, 8.0, is neutral by its base cut and is not in the closed form). 0.96 to 1.08 of the plain build at 6 rounds; its best use is 34 to 37% of a same-rank tank's HP.
- **Signature (Hwei)**: Disaster Stroke, a curse at 0.75, adds a mark; at 2 marks the mark bursts for **0.82 SA** on every foe within 2 tiles, and spends. 0.96 to 1.08 alone; with two more foes in the burst 1.56 to 1.75 (table 3.7), under the 3 SA a standard action of time that a heavy blast on three bodies is worth, so it is inside the area kind's budget.
- **Pain (Einar)**: a worn status adds a Pain stack (cap 10, `keep: fight`) on each hit dealt; Violence, a strike used at 5 stacks, takes all of them and is worth `1 + 0.06 * spent` strikes. 1.00 to 1.07. Its worth per action is `1 + 0.06 x` the share of strikes that land whatever the cycle, so the lever is the per-stack factor and the tolerance bounds it directly.

| Kit | Rank | Target | 4 rounds (kit / plain) | 6 rounds | 8 rounds | Kit over plain at 6 | Bound |
|---|---|---|---|---|---|---|---|
| Blood stacker (Glas) | E | speed | 39 / 42 | 61 / 63 | 83 / 84 | 0.96 | inside |
| Blood stacker (Glas) | E | tank | 25 / 27 | 39 / 40 | 54 / 53 | 0.99 | inside |
| Blood stacker (Glas) | E | cannon | 39 / 42 | 61 / 63 | 83 / 84 | 0.96 | inside |
| Blood stacker (Glas) | C | speed | 100 / 97 | 152 / 146 | 209 / 195 | 1.04 | inside |
| Blood stacker (Glas) | C | tank | 70 / 69 | 106 / 103 | 146 / 137 | 1.03 | inside |
| Blood stacker (Glas) | C | cannon | 100 / 97 | 152 / 146 | 209 / 195 | 1.04 | inside |
| Blood stacker (Glas) | S | speed | 231 / 216 | 350 / 324 | 472 / 432 | 1.08 | inside |
| Blood stacker (Glas) | S | tank | 172 / 162 | 261 / 243 | 352 / 324 | 1.07 | inside |
| Blood stacker (Glas) | S | cannon | 231 / 216 | 350 / 324 | 472 / 432 | 1.08 | inside |
| Signature (Hwei) | E | speed | 40 / 42 | 62 / 63 | 83 / 84 | 0.97 | inside |
| Signature (Hwei) | E | tank | 25 / 27 | 38 / 40 | 52 / 53 | 0.96 | inside |
| Signature (Hwei) | E | cannon | 40 / 42 | 62 / 63 | 83 / 84 | 0.97 | inside |
| Signature (Hwei) | C | speed | 100 / 97 | 153 / 146 | 206 / 195 | 1.05 | inside |
| Signature (Hwei) | C | tank | 69 / 69 | 105 / 103 | 141 / 137 | 1.02 | inside |
| Signature (Hwei) | C | cannon | 100 / 97 | 153 / 146 | 206 / 195 | 1.05 | inside |
| Signature (Hwei) | S | speed | 231 / 216 | 350 / 324 | 470 / 432 | 1.08 | inside |
| Signature (Hwei) | S | tank | 171 / 162 | 258 / 243 | 346 / 324 | 1.06 | inside |
| Signature (Hwei) | S | cannon | 231 / 216 | 350 / 324 | 470 / 432 | 1.08 | inside |
| Pain (Einar) | E | speed | 40 / 40 | 67 / 67 | 99 / 93 | 1 | inside |
| Pain (Einar) | E | tank | 25 / 25 | 41 / 41 | 60 / 57 | 1 | inside |
| Pain (Einar) | E | cannon | 40 / 40 | 67 / 67 | 99 / 93 | 1 | inside |
| Pain (Einar) | C | speed | 115 / 115 | 182 / 172 | 240 / 230 | 1.06 | inside |
| Pain (Einar) | C | tank | 66 / 66 | 106 / 99 | 139 / 132 | 1.07 | inside |
| Pain (Einar) | C | cannon | 115 / 115 | 182 / 172 | 240 / 230 | 1.06 | inside |
| Pain (Einar) | S | speed | 234 / 234 | 372 / 351 | 489 / 468 | 1.06 | inside |
| Pain (Einar) | S | tank | 139 / 139 | 221 / 209 | 291 / 279 | 1.06 | inside |
| Pain (Einar) | S | cannon | 234 / 234 | 372 / 351 | 489 / 468 | 1.06 | inside |

| Kit | Rank | Best single use on a tank | Tank max HP | Share | Under 60% |
|---|---|---|---|---|---|
| Blood stacker (Glas) | E | 18.6 | 51 | 36% | yes |
| Blood stacker (Glas) | C | 42.7 | 114 | 37% | yes |
| Blood stacker (Glas) | S | 95.9 | 282 | 34% | yes |
| Signature (Hwei) | E | 11.6 | 51 | 23% | yes |
| Signature (Hwei) | C | 27.5 | 114 | 24% | yes |
| Signature (Hwei) | S | 63.9 | 282 | 23% | yes |
| Pain (Einar) | E | 13.4 | 51 | 26% | yes |
| Pain (Einar) | C | 27.7 | 114 | 24% | yes |
| Pain (Einar) | S | 56.4 | 282 | 20% | yes |

| Rank | Kit over plain at 6, alone | With two more in the burst |
|---|---|---|
| E | 1.03 | 1.56 |
| C | 1.06 | 1.66 |
| S | 1.09 | 1.75 |

### 3.1 The degenerate loops and the rule that stops each

| Loop | The rule that stops it |
|---|---|
| Doubling stacks twice (Anchor on Inertial Storage, twice) | Stacks only add, never multiply: an op adds 1 to 3 (`stackAdd`), and the cap holds. Two "twice as fast" add 2 and 2 |
| A trigger that feeds itself (gaining X applies X; a hit's trigger hits) | Depth 2, at most 16 firings a command, each trigger's limit. A trigger's ops at depth 2 raise no events |
| An execute on a boss | There is no instant kill. An execute is a scaler whose suggested base cut makes it neutral against every foe, a boss too (8.0); past the suggestion the maker warns |
| HP price with a full heal | The price is worth what a heal costs the party (an action of its support), not nothing; an HP price raises no `struck`, so it feeds no Pain; it is refused at the HP it would kill |
| Kill, refund the turn, kill again (Rend) | A trigger with a `refund` op has the limit `round` at most (the parser lowers `each` to `round`) |
| Place a zone and end it at once for its payoff | `zoneAge`: a zone younger than a round ends with no payoff; a fourth zone evicts the oldest with none |
| A field of stacks read by `field(key)` | Read at most 60 |
| A delayed hit stacked to its cap | Its end scales by stacks, which the budget prices at the cap; the cap is 20 at most |
| Reapplying a once-a-fight trigger's status | The count lives on the row (`trips`), not on the status |

### 3.2 The rows the simulation must gain

`tests/models/fight-sim.ts` gains the three kits as builds (`blood`, `mark`, `pain`, each with its policy: build to the threshold, then spend; Violence at 5 stacks) and `tests/fight-sim.test.ts` gains these rows, each with its lever:

| Row | The bound | Lever |
|---|---|---|
| Each kit against its plain build's opponents (the triangle's three), C and S | Its win share within 0.08 of the plain build's, the mean of the two openings | the kit's searched lever (table 3.6) |
| A party with the Blood stacker in place of the cannon, against a boss | Still 4 to 8 rounds with Resonance's execute scaler at its suggestion | `SCALE.start` |
| The same party against a pack | Still 2 to 5 rounds | `SCALE.start` |
| A party of the three kits | Every trigger chain stops at depth 2 and 16 firings (an invariant of `fight-model.test.ts`) | `depth`, `fires` |
| The Signature caster in a pack | Its damage a round at most a blast's per standard action of time on the same pack | the mark's burst |
| A summoner against a boss | Its summon never keeps a side up; the fight is still 4 to 8 rounds | `summonRounds` |

## 4. The mapping

Table 4.1 is every ability, tracker, passive and item the summaries name, by kit and verdict, with the blocks (section 1's numbers) that make it. It is the script's `MAPPING`, so the counts below are counted, not written. "Made, with a named difference" means the blocks make it and the cell names what the sheet asks that they do not. "Not now" gives the reason; section 6 lists the classes.

| Kit | Verdict | Abilities (blocks): how |
|---|---|---|
| Shared (Nikolas, Einar, Maro) | Makeable today | Dash: a self ability giving a speed status for a round |
| Shared (Nikolas, Einar, Maro) | Not now | Disengage: the fight has no opportunity attack to avoid; Parry: a reaction on another's turn; its follow-up (Retribution) is a trigger on avoid; Transfer: giving one's turn to an ally; React: acting before another combatant, out of turn |
| Glas (from the brief) | Made by the blocks | Resonance (1, 2): stacks on a target, a threshold that bursts, its damage with an execute scaler (8.0); Rot (1): stacks with per-round damage per stack; Vision (1): stacks on self, a stat per stack; Crimson Pact (4, 7): a mode for 10% of max HP; Hemoplague (1, 6): per-round damage and an end; Delayed damage (6): a status with no ops and an end; The execute (2): an execute scaler on a threshold's damage (8.0) |
| Nikolas | Made by the blocks | Anchor, Unbound (1, 3): a 3-round status whose turn-start trigger adds a second stack; Baangs, Manifest Baang (1): stacks on self, cap 9 (the GM raises the def's cap with each Body title); Detonate (4): a blast with a price of one Baang; Gravity Surge (1, 4, 7): two abilities, each gated on one aura held, applying Weak or Fragile; Stormfront (4, 8): a zone, one use a rest; Heartstone Amulet (4): a heal with an HP price, one a round; Permafrost (1, 3): a weapon-tagged hit adds a Cold stack |
| Nikolas | Made, with a named difference | Inertial Storage (1, 3, 7): a stack a turn start, all leave on a move; its armor is read as Vitality (no armor op); Momentum's Edge (1, 3, 7): a stack on each move; "all your movement" is read as any move; Starcaller's Wrath (4, 8): a zone, one use; its end when every foe has left is not now; Brutalize: today's stat ops; healing -50% and damage taken +33% have no op; Cataclysm (8): a zone whose end lands after a round; its scaling by constellations is not now; Distortion World (1, 3): a stack of Gathering Storm a round; its cost change is not now; Eclipse (1, 3): a stack a hit that leaves at the turn's end, as a stat; "on a single enemy" is not read; Agnet of Focus (4): one use a fight of a quick self ability giving Haste; a whole extra action is not an op |
| Nikolas | Makeable today | Starry Sky: a zone; Kneel: a note: what a body at 0 does is the GM's; Titles that give an ability: the GM gives the skill |
| Nikolas | Not now | Paradox of Motion: an op that sets one status's stacks from another's; Supernova: a trigger that reads where its bearer stands; Orbital Laser: moving a zone; Constellations, Zodiac, Cosmic Creator: collectable sets; Trick, Cunning: a bonus to a check outside the fight; Hover, Earthbound: flight; Create Portal, Blink, Rendwalk: teleports and portals; Death's Grasp: forced movement (a pull); Singularity: a cost of all remaining mana; Vector Strike: a reroll; Proximity Fold, Zone Stretch: an op on another rule's range or size; Loveblight: an op on the crit size; Fateshaper (Lifebound): a trigger whose amount is the hit it answers; Weighted Step, Spatial Awareness, Crush: knockback and surprise are not rules of the fight; Crush is a formula on Power today |
| Nikolas | Undefined in the sheet | Baang Release: a damage row and no ability row; Gathering Storm, Rising Moon: columns with no rule; Dimensional Cascade, Folded Tether, Split Fold, Zero Zone: no outcome or no text |
| Einar | Made by the blocks | Boundaries (8): zones, three an owner (3 to 5 with the perks); Harmony (1, 3, 8): a stack a turn inside the zone (its trigger), a stun as its end; Stack of Pain (1, 3): a stack on each hit dealt; Fuel the Flesh (1, 4): a price of 2 Pain for fatigue back; Truth in Pain (1, 4): a gate of 10 Pain, a price of all, a hold; Reveal, Spirit Archer (1): the bow's ops add a stack; Spirit Shackle (1, 4): a price of 5 Reveal on the target, a root; Mercy (1, 3): a kill by an Eternal Peace-tagged use adds a stack (keep: sheet); Ruthless, Diplomacy (stacks) (1, 3): stacks from kills or hits; Haste (1, 3): Limber starts it at 1 (worn), Savage adds one on a crit, speed per stack; Soul Shatter (4, 8): a price of all zones, each zone's end lands; Pact Redux Silver (4, 5, 8): a price of one zone, one a fight, a heal of `target.missing * target.hpMax / 4`; Celestial Sea (4, 8): a healing zone, one use a rest |
| Einar | Made, with a named difference | Confrontation (1, 8): stacks with damage a round per stack; "highest base stat" is read as a named stat; Violence Begets Violence (1, 3): struck: one Pain off, a stat down on the striker (no armor op); All Shall Suffer (4, 5): damage by field(pain), a price of the user's own; the others' stacks stay; Certain Death (5): target.stacks(reveal) as damage; "+1 to the roll" has no roll to add to; Draconic Avatar (9): a summon; its Dissolved on contact is not defined; Pain's Whip Tail (3): a hit roots the target; the advantage is not now; Osteoporosis (1, 2, 3): three hits a fracture, three a break (threshold); the rib on a miss is not now |
| Einar | Makeable today | Vacuum: a zone with a note; Eternal Peace: `target.hpMax * 1d20 / 100`; Soul-Eye, Bow Master, Spectral Shot: a direct bow, a quick bow, a bow with a cost |
| Einar | Not now | Moving, doubling, boundless: moving or resizing a zone; Hyperbole: hours of downtime outside the fight; Ceremony: a cost change; Sustained through Suffering: an extra action from an ability; Lamb's Respite: a reaction, and invulnerable; Stealth stacks, Shade Step: stealth, passing through objects, reactions; Silentum Perpetuum: a permanent loss from a fight (a GM reward line); Mourning's Light, Diplomacy (check), Guidance: checks and death saves outside the fight's rules; Shinsuu Reversal: a reaction that negates a spell; Pact Redux Bronze, Gold, Platinum: a terrain change, a cure of every harmful status, invulnerable; Bow Expert, Mythical, Assassination, Crown of Dusk: advantage, a natural 20, surprise and invisibility; Ceaseless Pursuit: a chain of rolls against a rising DC; Speaker of the Land, Puzzlebox: an extra action and a cost change; Harmonious Reverberance: nobody may attack: a rule over the turn |
| Einar | Undefined in the sheet | Lesson in Pain: Suppress is not defined; Wolf's Hunt, Severance, Vicious: named, no rule; Abyssal Whirlpool, Overcome, Catastrophe, Corroded, Dissolved: Corroded, Negate and Ruin are not defined ("FIX"); Echoes of the Fallen, Orb of Draconic Might, Villainous Robes, Ring of Mosaic: no rule, or a permanent gain (a GM reward line) |
| Maro | Made by the blocks | Corruption (1, 3, 8): stacks; the aura's hold adds one at each turn start inside; Aura of Corruption (8): an aura with an upkeep of 20 (the list; the tree says 10); Void Knight (1, 3): a sword-tagged hit adds a stack; Purify (5): damage by target.stacks(corruption); Endless, Eternity (5): a worn status: fatigue back a round by field(corruption); Smite (3): a blast tagged "ultimate" for Hatefog; Summon Sprite (9): a summon of 2 rounds; Retribution (3): on avoid, a hit on the other; Rend (3): a sword-tagged kill refunds the turn (once a round) |
| Maro | Made, with a named difference | Doom: a hold today; "inside his Aura" as a gate is not now; Special Sprites (4, 9): summons, one a rest; once a week is not now; Malignance (Hatefog) (3): used "ultimate": a 3-round status with an aura of damage; it moves with Maro |
| Maro | Makeable today | Sever, Sword Master, Weapon Attack: a quick strike, a strike; Ignite, Beacon, Demoralize: a support or curse giving a status; Nature's Corruption: a zone that spares its owner |
| Maro | Not now | The Cycle Continues: a kill that moves a count to the foe with the most HP; Essence Transfer, Celestial Tether: moving a status between bodies; a reaction; Deliverance, Sword Expert, Grasswhistle: advantage and free parries; Relic Sense, Old Stories, Fated Meeting, Sacred Bond, Champion, Backlash, Wingstalker: outside the fight, or barriers that reflect |
| Maro | Undefined in the sheet | Supress, Devour, Alrender, relic counters, Aegis: Domain, the effect, the "?" and the cost are not written |
| Hwei | Made by the blocks | Baang, Manifest Baang (1): stacks on self, cap 3 then 5; Easel of the Master (1, 3): two stacks at each turn start; Baang Release (4, 5): a price of all Baangs, damage or a heal by spent; Detonate Baang (4): a blast with a price of Baangs; Signature of the Visionary (1, 2): a mark that bursts in an area at 2; Energize, Kindle, Vitalize (1, 3): a painting's tag adds a stack; Billowing Robes (3): a turn start, once a fight: Animated for a round; Illusory Double (3, 9): a summon whose worn status ends it when struck |
| Hwei | Made, with a named difference | Stirring Lights (1, 4): flares spent by an ability; "the next attack" is not read; Spiraling Despair: a blast; its two rounds of marks bursting at once are not now; Severing Bolt (5): more damage by target.stacks of a named control; the chain is not now; Sea of Shadows (4): one a fight; untargetable is not now |
| Hwei | Makeable today | Molten Eruption, Moonlit Reflection: zones; Gaze of the Abyss, Grim Visage, Inviting Allure: curses with a status; Devastating Fire: a sure use of `target.hpMax` |
| Hwei | Not now | Shattered Canvas, Cracks in the Frame: advantage on the next roll; The Muses: moving stacks to an ally; Crushing Maw, Fleeting Current: a pull, a terrain change; Reap what is Sown: an op that blocks statuses; Font of Inspiration: painting anything into reality is the GM's; Colors of Frustration, Nostalgia, Resilience: a trigger on the order of abilities; Slime Crown, Mercy's Cape, Imagined Reverie: a defence against areas, non-lethal by choice, "???" |
| Hwei | Undefined in the sheet | Mood (3, 7): a mode the last tag sets (makeable); what a mood does is not written |

| Verdict | Names | Share of all | Share of those the sheet defines |
|---|---|---|---|
| Made by the blocks | 52 | 26% | 30% |
| Made, with a named difference | 22 | 11% | 13% |
| Makeable today | 22 | 11% | 13% |
| Not now | 78 | 39% | 45% |
| Undefined in the sheet | 26 | 13% |  |

Makeable: 96 of 200 (48%); of the 174 the sheet defines, 55%. With the blocks and no difference: 52. The not-now names fall in a few classes (section 6): reactions on another's turn, advantage and rerolls, moving bodies or zones (teleports, pulls, portals), changes to another rule (costs, ranges, crit size, healing taken), sets and trees, and what lies outside the fight.

| Block | Name | Abilities that use it |
|---|---|---|
| 1 | stacks | 38: Resonance; Rot; Vision; Hemoplague; Inertial Storage; Momentum's Edge; Anchor, Unbound; Baangs, Manifest Baang; Gravity Surge; Distortion World; Eclipse; Permafrost; Confrontation; Harmony; Stack of Pain; Fuel the Flesh; Violence Begets Violence; Truth in Pain; Reveal, Spirit Archer; Spirit Shackle; Mercy; Ruthless, Diplomacy (stacks); Haste; Osteoporosis; Corruption; Void Knight; Baang, Manifest Baang; Easel of the Master; Signature of the Visionary; Energize, Kindle, Vitalize; Stirring Lights |
| 2 | threshold | 4: Resonance; The execute; Osteoporosis; Signature of the Visionary |
| 3 | trigger | 28: Inertial Storage; Momentum's Edge; Anchor, Unbound; Distortion World; Eclipse; Permafrost; Harmony; Stack of Pain; Violence Begets Violence; Mercy; Ruthless, Diplomacy (stacks); Haste; Pain's Whip Tail; Osteoporosis; Corruption; Void Knight; Smite; Retribution; Rend; Malignance (Hatefog); Easel of the Master; Energize, Kindle, Vitalize; Billowing Robes; Illusory Double |
| 4 | price or gate | 19: Crimson Pact; Detonate; Starcaller's Wrath; Gravity Surge; Stormfront; Heartstone Amulet; Agnet of Focus; Fuel the Flesh; Truth in Pain; All Shall Suffer; Spirit Shackle; Soul Shatter; Pact Redux Silver; Celestial Sea; Special Sprites; Baang Release; Detonate Baang; Stirring Lights; Sea of Shadows |
| 5 | formula input | 8: All Shall Suffer; Certain Death; Pact Redux Silver; Purify; Endless, Eternity; Baang Release; Severing Bolt |
| 6 | delayed | 2: Hemoplague; Delayed damage |
| 7 | mode | 4: Crimson Pact; Inertial Storage; Momentum's Edge; Gravity Surge |
| 8 | zone additions | 11: Starcaller's Wrath; Cataclysm; Stormfront; Boundaries; Confrontation; Harmony; Soul Shatter; Pact Redux Silver; Celestial Sea; Corruption; Aura of Corruption |
| 9 | summon | 4: Draconic Avatar; Summon Sprite; Special Sprites; Illusory Double |

**Every block is used by at least two abilities.** Two are close to the line, and neither is cut:

- **The mode** (block 7) is used by 4 (Crimson Pact, and Nikolas's two auras that Gravity Surge reads), with Hwei's mood undefined. It costs no code: it is a status, a price and a gate (1.7). It stays as a recipe, a built-in example in the maker (section 5) and a row of the budget (table 3.5), not as a type.
- **The delayed effect** (block 6) is used by 2, both Glas's (Hemoplague and his delayed damage), and the owner asked for it by name ("delayed dmg is good though"). It is one field on a def (`end`) that the settle already reaches, and Cataclysm, a rend and a bomb are the same field once their other parts come.

## 5. The makers and the build order

### 5.1 What each maker gains

Each block is a collapsed `.mk-group` on a 390 px phone, closed until the GM opens it, below the first screen and marked `data-later`, with its sentences in the preview. No rule goes in `maker.js`: the sentences are `describeStatus` and `describeAbility`, the worth is a new `worthOf` in `src/core/registry/worth.ts` (section 3's rules), and `save` runs the kind's parser.

| Maker | New group | Fields and rows | Preview sentence |
|---|---|---|---|
| Status (`forge.js`) | Stacks | A switch; Cap (1 to 20); Stacks leave (`.seg`: Never, One a round, On an event, with the event's select); After the fight (`.seg`: Gone, On the sheet) | "Stacks to 5. One leaves each round. Each stack: 4 magical damage a round." |
| Status | At a count (inside Stacks) | At (a number, or a formula field over the bearer); Lands on (`.seg`: The bearer, An area, with tiles and side); the effects editor of its ops (a damage op's formula field has the scaler tick, 8.0); Then (`.seg`: Spend, Keep) | "At 3 stacks: 1.3 x (1d8 + mag) magical damage, up to +100% against a target under half its HP. The stacks are spent." |
| Status | When something happens | Up to 4 trigger rows: When (a select of the events); Tag (a chip, for a hit, crit, kill or use); Status (for gained or ended); How often (`.seg`: Every time, Once a round, A number a fight); On (`.seg`: Its bearer, The other, An area); the effects editor | "When its bearer deals a hit with a sword: 1 Corruption on the one hit, every time." |
| Status | When it ends | The effects editor; A cleanse (`.seg`: Saves you, Sets it off) | "When it ends: 2 x (1d8 + mag) magical damage. A cleanse saves you." |
| Ability form (`skills.make`) | Costs more | Up to 2 rows: HP (a number or a share), Stacks (a status, from you or the target, a number or all), A zone (a name, one or all) | "Costs 10% of your max HP; refused at that HP or less." |
| Ability form | Only when | Up to 3 rows: Holds (a status, on you or the target, at least n); Uses (n, a fight or a rest) | "Only while you hold Crimson Pact. 1 use a rest." |
| Ability form | Tags | Up to 3 chips (`.mk-chip`) | "Tags: sword, ultimate." |
| Ability form | Summons | Name; Archetype (`.seg`); Rounds (1 to 5); its starting statuses | "Summons a Sprite (skirmisher, your rank) for 2 rounds. Two at most." |
| Ability form | The formula field | A tick "Grows with stacks" (a status; yours, the target's, or the ones this use spent; per stack): writes `(...) * (1 + per * stacks(key))` or `spent` (a field of `Ticks`, the tick recipe); the name hints list the new names | the averages at E, C and S at 0 stacks and at the cap |
| Ability form | Leaves a field | Upkeep (fatigue, mana a round); When it ends (effects editor); While inside (trigger rows, as the status maker's) | "Costs 20 fatigue a round to keep. When it ends: a stun on everyone inside." |
| Skill (passive) and item (`loot.js`) | In a fight | The status maker's groups for its `worn` status, inline | "In a fight: ..." the worn status's lines |
| Monster (`bestiary.js`) | Starting statuses | A stack count on a stacking status | "Starts with 3 Pain." |

Every maker shows one worth line under the preview: "Worth 1.04 of a standard action (budget 1.00)", and past 1.08 times the budget a warning in the same line, never a refusal: "Stronger than its pace allows by 12%: a kit this strong can flip a matchup by itself."

### 5.2 Three built-ins a GM can open and copy

Each is an entry of the registry the maker's Duplicate copies, with its worth inside the tolerance (section 3).

```ts
// registry/statuses.ts: Resonance, a stacker whose burst has an execute scaler (Glas)
{ label: 'Resonance', desc: 'Blood that answers its caller.', ops: [], triggers: [], end: null,
  stack: { cap: 3, leave: { kind: 'never' }, keep: 'fight',
    threshold: { at: { kind: 'count', n: 3 }, to: { kind: 'bearer' }, then: 'spend',
      ops: [{ op: 'damage', type: 'magical', when: 'use',                 // 1.6 SA cut by the execute's base 0.8 (8.0)
        amount: f('1.28 * (1d8 + mag) * (1 + max(0, min(1, (target.missing - 0.5) / 0.5)))') }] } } }
// with the skill Bloodletting: a curse of 0.7 * (1d8 + mag) that applies Resonance (1 stack, 2 rounds)

// registry/skills.ts: Pain is Power (a passive, Einar) and Violence (its spender)
worn: { label: 'Pain is Power', ops: [], end: null, stack: null,
  triggers: [{ on: 'hitDealt', tag: null, to: 'self', limit: { kind: 'each' },
    ops: [{ op: 'applyStatus', key: 'pain', stacks: 1, duration: null, def: PAIN }] }] }   // PAIN: cap 10, never leaves, keep: fight
Violence: abilityOf('strike', { prices: [{ kind: 'stacks', key: 'pain', from: 'self', take: { kind: 'all' } }],
  ticks: { perStack: { key: 'pain', whose: 'spent', per: 0.06 } } })                   // (1d8 + phys) * (1 + 0.06 * spent)

// registry/skills.ts: Crimson Pact, a mode, and Hemoplague, an ability it gates (Glas)
CrimsonPact: abilityOf('support', { aim: 'self', effect: null, prices: [{ kind: 'hp', amount: { kind: 'share', share: 0.1 } }],
  ops: [{ op: 'applyStatus', key: 'crimson-pact', duration: 3 rounds, def: { label: 'Crimson Pact', ops: [], stack: null, ... } }] })
Hemoplague: abilityOf('curse', { gates: [{ kind: 'holds', key: 'crimson-pact', on: 'self', atLeast: 1 }],
  ticks: { share: 1.4 },                                                                // the mode's credit, 0.40 SA a use (table 3.5)
  ops: [{ op: 'applyStatus', key: 'hemoplague', duration: 2 rounds, def: { label: 'Hemoplague', ops: [/* a bleed a round */],
    end: { ops: [{ op: 'damage', type: 'magical', amount: f('1d8 + mag'), when: 'use' }], cleanse: 'cancel' }, ... } }] })
```

### 5.3 The build order

Each unit is one module or one wiring step, ends in its test file, and leaves the tree green. Units on one line may run in parallel.

| # | Unit | What it is | Test | After |
|---|---|---|---|---|
| 1 | Rules and types | `RULES.fight.kit` (table 1.1, the tolerance), the `StatusDef` and `Status` unions, `LandOp`, `Trigger`, `Price`, `Gate`, `Summon` types; `DOC_ROWS` 30 | `tests/rules.test.ts` | |
| 2 | Stacks | `applyStatus` with stacks, `modsOf` per stack, the round leave in `settle`, `stackStep` and its `TABLE` (2.1), `sheetStatuses` with stacks; `parseStatusDef` reads `stack` | `tests/effect-ops.test.ts`, `tests/statuses.test.ts` | 1 |
| 3 | Formula names | `stacks()`, `field()`, `missing`, `held()`, `hits`, `kills`, `spent`; `KitScope` | `tests/formula.test.ts` | 1 |
| 4 | Rest uses | `Vitals.used`, `rest` clears it, the save's repair line | `tests/vitals.test.ts`, `tests/save.test.ts` | 1 |
| 5 | Worth | `worth.ts` (`worthOf`), section 3's numbers as expected values | `tests/worth.test.ts` | 1 |
| 6 | Resolve | rules 3b, 4, 6b, 10a, 18 (stacks), 18a (threshold); `needs` unchanged | `tests/resolve.test.ts` | 2, 3 |
| 7 | Triggers | `triggers.ts` (`eventsOf`, `fire`, depth, `trips`, its `TABLE` 2.5), rule 19b in `fight.ts`, the settle's events | `tests/triggers.test.ts`, `tests/fight.test.ts` | 6 |
| 8 | Delayed | `end` at the settle and on a cure, its `TABLE` (2.2) | `tests/fight.test.ts` ("a delayed effect") | 6 |
| 9 | Zones | upkeep, the cap per owner, `end`, `zoneAge`, a zone's triggers on its hold, its `TABLE` (2.6) | `tests/fight.test.ts` ("a zone on the ground") | 6 |
| 10 | Summons | `summonRow`, rule 18d, `onTurn` for an owner's summon, `overIf`, its `TABLE` (2.4) | `tests/rows.test.ts`, `tests/fight.test.ts`, `tests/protocol.test.ts` | 6 |
| 11 | Limited uses | the row's `used`, its `TABLE` (2.3), `adjust` gains `used` | `tests/fight.test.ts` | 6, 4 |
| 12 | Doc | `DocStatus.stacks`, `left`, a summon's row, the worst case at 30 rows | `tests/fight-doc.test.ts`, `tests/protocol.test.ts` | 2, 10, 11 |
| 13 | Machines | the six charts in `scripts/charts/`, `MACHINES`, the events in `tests/models/`; `randomCommand` plays the blocks; the model's invariants (depth, fires, a summon never keeps a side up) | `tests/statecharts.test.ts`, `tests/fight-model.test.ts` | 7 to 11 |
| 14 | Simulation | the three kits as builds and the rows of 3.2 | `tests/fight-sim.test.ts` | 13 |
| 15 | Parsers and packs | `worn` on a skill and an item, a monster's starting stacks, the pack's kinds unchanged | `tests/skills.test.ts`, `tests/items.test.ts`, `tests/monsters.test.ts`, `tests/pack.test.ts` | 2, 7 |
| 16 | Makers | the groups of 5.1, the built-ins of 5.2 | `tests/e2e/makers.e2e.ts` | 5, 15 |
| 17 | The table | stacks on a card and a chip, uses left, a summon's card on the map | `tests/fight-view.test.ts`, `tests/e2e/map-extras.e2e.ts` | 12 |

In parallel: 2, 3, 4 and 5 after 1; 7, 8, 9, 10 and 11 after 6; 15 and 17 beside 13. Nothing in 16 or 17 starts before 14 is green: the numbers hold first.

**`AGENTS.md` rows**: a stacking status, its threshold and its end (`effect-ops.ts`, `tests/effect-ops.test.ts`); a trigger (`triggers.ts`, `tests/triggers.test.ts`); a price or a gate (`resolve.ts` rules 3b, 4 and 10a, `tests/resolve.test.ts`); a summon (`rows.ts` `summonRow`, `tests/rows.test.ts`); a made thing's worth against its budget (`worth.ts`, `tests/worth.test.ts`). **Recipes**: a trigger event (a member of `BearerEvent`, its line in `eventsOf`, its word in the maker's select, a case in `tests/triggers.test.ts`, the typecheck asks for its cells); a price or gate kind (a member of `Price` or `Gate`, its check in rule 3b or 4, its row in "Costs more" or "Only when", its worth in `worthOf`); a formula input (a member of `Formula`, its name in `NAMES`, its bound in `RULES.fight.kit`, its value in `KitScope`).

## 6. Not now

Wave 2 (section 8) takes up the reactions, the retried action as advantage, moving bodies and zones, and the ops on another rule; what stays not now after both waves is section 8.8 and table 8.11.4.

| Left | Why |
|---|---|
| A rewind to an earlier state | the owner: "the rewind is unnecessary for now". The fight's `undo` is the GM's, not a player's power |
| A retried action (Vector Strike, Mythical, advantage) | A reroll needs the dice of a use rolled twice and one kept, a second path through `needs` and the room's `cast` |
| Permanent stats from kills (Villainous Robes, Silentum's loss) | A reward line the GM gives after the fight: the reward editor already holds a stat bonus as a title's |
| Collectable sets (Constellations) | A set of n with partial payoffs is a machine of its own over many fights, used by one kit |
| Perk trees with prerequisites | Paths are six tiers of two (`paths.ts`); a tree is a different structure, and the GM gives the skill meanwhile |
| A trigger on the order of abilities in a round (Colors of ...) | It needs the round's history on the row; Hwei's mood (the last tag) is makeable without it |
| Reactions on another's turn (Parry, React, Transfer, Shinsuu Reversal, Lamb's Respite) | The timeline has one actor at a time; a reaction is a command from a body whose turn it is not |
| Moving bodies and zones (teleports, portals, pulls, moving or resizing a zone) | A forced move needs a path rule for being moved and its dodge; the GM's free drag does it today |
| Ops on another rule (costs, ranges, crit size, healing and damage taken, invulnerable, blocking statuses) | Each is a new `Sheet` number or a new rule step; none is used by two kits the same way |

## 7. For the owner

**What you can make once this is built**: counters that abilities build on a target and read (Resonance, Corruption, Reveal), counters on yourself that you spend (Pain, Baangs, Haste), a count that sets something off (Resonance's burst, Cold's deafness, Hwei's mark), passives and items that react to hits, crits, kills, dodges, turns and tags (Void Knight, Rend, Retribution), costs in HP or in stacks, abilities that only work in a mode or with enough stacks, uses a fight or a rest, damage from missing HP, kills, stacks on the field, delayed damage (Hemoplague), zones that cost upkeep and pay off when you end them (Einar's boundaries), and summons for a few rounds (Sprites). About half of the four kits and Glas (96 of 200 names), and 55% of what the sheet defines.

**What you cannot make yet**: rewinds and retries, collectable sets, perk trees, the order of paintings in a round, flight, portals, a longer reach or a larger area from a status. (Wave 2, below, makes advantage, reactions, teleports and pulls, cheaper costs and bigger crits.) 26 names in the sheet have no rule yet (Gathering Storm, Suppress, Corroded, what a Mood does): write them and they map.

**Defaults you might want otherwise**, and what to say:

| Default | Say this to change it |
|---|---|
| The maker warns when something is more than 8% stronger than its pace allows | "Let kits run 15% hot" |
| Nothing kills outright; an execute is more damage the lower the target's HP (8.0) | Type over the suggested start and scale in the formula field |
| A trigger's chain stops two steps deep | "Let triggers chain three deep" |
| A trigger, a threshold and a delayed hit use the average of their dice, no roll | "Roll the dice for triggers" (it costs a wait for the dice after each use) |
| An HP cost is refused if it would drop you to 0 | "HP costs can kill" |
| A cleanse removes a delayed hit without it landing | "Cleansing sets delayed hits off" (each status can say otherwise already) |
| One body holds 3 zones and 2 summons; a summon lasts at most 5 rounds | "Einar holds 5 boundaries" |
| "Once a day" is once a long rest | "Track real days" |
| A stack pays at the count it has when its bearer's turn starts | "Pay stacks by the time held" |
| The room shows 30 combatants at most (it was 32) | Nothing to say: the stack counts took the room |

**Wave 2, once built** (section 8): an execute that does more damage the lower the target's HP, and its counterparts (higher HP, a bigger or smaller target, you low or high on HP), each with a suggested start and scale you can type over; armor, resist, crit and cost changes, damage taken and healing received by a share, untargetable, invulnerable, safeguard, Dispel and Purge; advantage and held dice (Rouse, Expected Outcome, Mythical); pushes, pulls, blinks and swaps; reactions armed ahead (Parry, React, Lamb's Respite, Shinsuu Reversal); stacks handed to an ally (The Muses), zones moved and grown (Einar's boundaries, Orbital Laser); an extra action and giving your turn (Transfer); stealth and surprise. 138 of the 200 names, 79% of what the sheet defines.

| Default (wave 2) | Say this to change it |
|---|---|
| An execute starts at half HP and adds up to +100%, the rest of the ability cut to 0.8 so it is even over a fight | Type over the start and scale in the formula field, or "suggest executes from a third" |
| A giant slayer adds up to +25% (whole at 4 times your max HP) | "Let giant slayers run hotter against bosses" (it moves the tolerance it is bound by) |
| Parry takes 30% off a strike (your sheet: 25% or 75% by a roll) | "Parry like the sheet" (the speed build then beats the tank by 30 to 40% more) |
| A reaction fires at most once between two of your turns, and its time comes off your next turn | "Reactions are free" (a parrying speed build would never be hit for full) |
| One extra action a round at most | "Two extra actions" (the speed build would take four turns between two of the tank's) |
| Untargetable and invulnerable last a round and reach a body once a fight | "Sea of Shadows lasts three turns" |
| Damage taken and dealt multiply to at most 1.5; a boss takes half the upside | "Let Brutalize stack" |
| A push stops at a pit; nothing falls in | "Pits kill" (that is the instant kill you turned down) |
| Nobody can hide in the open: hiding needs a foe not to see you | "Let stealth work in the open arena" |
| Flight is not made | "Make flight" (it needs heights on the map and an answer for the strike builds) |

## 8. The second wave: what the first left as "not now"

Two sources: the seven families of `brief-kits-design-2.md`, and the owner's word of Nov 14 that replaces the execute (8.0). Every number is the script's part 8 (`KIT2`, `SCALE`). Wave 2's blocks are numbered 10 to 18 beside wave 1's 1 to 9: block 10 + k is section 8.k (10 scalers, 11 ops, 12 advantage and held dice, 13 forced movement, 14 reactions, 15 moving counts and zones, 16 turn economy, 17 stealth and surprise, 18 a condition on where).

### 8.0 Conditional scalers, in place of the execute (block 10)

the owner: "execute just does more dmg the lower health people are... There should be a counterpart for when people are higher hp. Also one for higher max hp than the player, lower max hp than the player, etc."

1. Nothing in a fight kills outright. Any damage formula (an ability's, a threshold's, a trigger's, an end's, a per-round op's) may carry up to 2 scalers (`scalers`).
2. A scaler is a measure, a direction, a start and a scale. Each measure is a number from 0 to 1: the target's HP share, the user's HP share, the target's part of the two max HPs (`T / (T + U)`, 0.5 for equal bodies), the target's part of the two current HPs. With the two directions that is a closed family of eight: Execute (target's share under), Opener (over), Desperate (user's share under), Steady (over), Giant slayer (target's max HP part over), Cull (under), Underdog (target's current HP part over), Bully (under).
3. Its bonus is 0 at the start and `scale` at the end, linear between. A share ends at 0 (under) or 1 (over); a pair at 0.2 or 0.8, a ratio of 4 to 1 (`pairFull`): a same-rank boss is 2.8 to 4.7 times a paper build's max HP (table 8.0.1), so a giant slayer is near its whole against a boss and not past it. The damage is multiplied by `1 + the sum of the bonuses`. The scale is 0 to 1 (`scaleCap`: at most double, a crit's largest size); the start lies strictly between the ends.
4. It is text in the formula, written by a tick and read back by `ticksOf` (the tick recipe): an execute from half HP with scale 1 is `* (1 + 1 * max(0, min(1, (target.missing - 0.5) / 0.5)))`. It needs only wave 1's `missing` and today's `hpmax`, `min` and `max`; a pair's current HP is `hpmax * (1 - missing)`. A GM who types the same text gets the same tick back.
5. It is read at rule 10 against wave 1's snapshot (rule 6b), so each target of an area reads its own HP and a use's first hit does not raise the bonus of its next.
6. `describeAbility` gives each its line: "Up to +100% against a target under half its HP"; "Up to +25% against a target with more max HP than yours, all of it at 4 times yours".

```ts
// registry/ability-kinds.ts: Ticks gains `scalers` (default [], at most 2)
type Scaler = { readonly measure: 'target' | 'user' | 'maxPair' | 'hpPair'; readonly dir: 'under' | 'over'; readonly start: number; readonly scale: number };
```

**The suggestion.** The maker fills the start (0.5: half the HP, or two equal bodies) and the kind's suggested scale, and cuts the base by `1 / (1 + mean)`, so the use is worth its plain budget over a fight. For a share the mean has a closed form: the share is uniform over 0 to 1 (a body takes about equal hits over its life, and design 6's boss fight takes the tank near 0 at its end), so `mean = scale * w / 2`, `w` the window (the start for under, 1 less the start for over): at 0.5 and scale 1 the mean is 0.25 and the base 0.8. A pair is fixed by the two bodies, so its mean is taken over the reference dungeon, a pack fight and a boss fight weighted by their rounds (table 3.2). The scale is the largest, in steps of 0.05, with which the use against packs alone and against a boss alone stays within the tolerance (1.08 of plain) and its best use on a same-rank tank under 60% (table 8.0.2):

| Scaler | Suggested scale | Base | Against packs, against a boss |
|---|---|---|---|
| Execute, Opener, Desperate, Steady | 1 on every kind | 0.80 | 1, 1 |
| Giant slayer | 0.25 | 0.86 to 0.88 | 0.86, 1.07 to 1.08 |
| Cull | 0.30 (strike), 0.35 (the rest) | 0.96 to 0.97 | 1.05 to 1.08, 0.96 to 0.97 |
| Underdog | 0.50 | 0.78 to 0.80 | 0.86, 1.08 |
| Bully | 0.30 (strike), 0.35 (the rest) | 0.93 to 0.95 | 1.07 to 1.08, 0.96 |

As built (`registry/scalers.ts` `suggestScaler`, from `RULES.fight.kit.reference`), the search uses the rule's tolerance of 0.08, not the paper's unrounded 0.081, so the bully on a strike is 0.30: at 0.35 the S bruiser against a normal brute is 1.0801. The single-use bound never binds: the best use is 5 to 25% of a C tank's max HP, so the code does not search it. **Bosses need no special case**: a share scaler with its cut is neutral against a boss as against anything, since it averages the boss's whole life, and a pair scaler's scale is bounded by the tolerance against a boss directly. A GM who types over both is warned past 1.08 against either reference foe, never refused. The worth line shows the larger of the two.

Three homes were weighed: a field on `Ability.effect` and on the damage op (two places, and a threshold's damage a third); a new formula function `ramp(x, a, b)` (shorter text, a new formula kind for what `min` and `max` already write); the formula's own text (chosen: every damage flows through one parser, and the GM sees and edits it).

### 8.1 Ops the status table lacks (block 11)

**Five plain new members of `Op`**, each by the op recipe (`OP_KIND_SET`, `modsOf`, `opLine`, `parseOp`, the maker's row):

- `sheet { key, amount }`, the key one of `armor`, `resist`, `pen`, `critFaces`, `exposed`, `critSize`, `costCut`, `range`. It changes the bearer's `Sheet` after `derive`; ops of one key add, as `stat` ops do. Bounds (table 8.1): armor and resist within plus or minus 60 an op (a suit of plate), pen within `penCap`, crit faces plus the target's `exposed` faces at most 6 (design 2.2's 30%), crit size 1.5 to 2, the cost cut at most 0.25 (`costCutMax`; the sheet holds one cut for both costs, so the paper's 0.5 on fatigue is not built: mana is the dungeon's brake on blasts), range plus or minus 3 on abilities of range 2 or more. `exposed` is faces any attacker's crit gains against the bearer (Vision: 0.5 a stack, the sum rounded down).
- `share { on: 'dealt' | 'taken' | 'healed', pct }`. New rule 11c: a damaging use is multiplied by the user's dealt and the target's taken; of each, the strongest increase and the strongest decrease apply and multiply (the speed rule of `modsOf`); the product stays in 0.5 to 1.5 (`shareCap`), and on an elite or a boss the part above 1 is multiplied by its kind's control factor (0.75, 0.5). `healed` multiplies every heal the bearer gets, a per-round one too, within the same bounds. Per-round damage reads `taken` at `payDue`.
- `untargetable`: a foe's use cannot aim at the bearer and its shape does not catch it. It ends when the bearer uses an ability against a foe or a place.
- `invulnerable`: HP damage does not take the bearer under 1; a shield still absorbs first.
- `safeguard`: an `applyStatus` of a harmful def from the other side does nothing on the bearer (a log line).

The three wards last a round at most (`wardRounds`), and untargetable and invulnerable reach a body once a fight (as built, the row's `warded`, marked where a status lands in resolve.ts and land.ts, which see rows and not the fight). Reason: each takes a body out of the fight for its round; twice is a body the foes cannot fight. **Harmful** is one rule, `zoneTone(def.ops)` of harm or hinder, extended so a `sheet` op that lowers, `exposed` that raises, and a `share` that raises taken or lowers dealt or healed are hinder.

**Not ops.** Dispel and Purge are a cure of the harmful (as built, an op of its own, `dispel { which: 'first' | 'all' }`: an arm of `cureStatus` without a key would reach every reader of a cure's key) (first: the earliest in the list, which is the order of application; all its stacks). Proliferate is a trigger on `statusGained` of any helpful status landing `move` (8.5) of that status to the nearest ally within 2 tiles. Reflection (Fateshaper, Glas's stored damage) is two formula names, `taken` and `dealt`, the HP damage of the hit that raised the event, read only in a trigger on `struck` or `hitDealt`; the parser refuses them elsewhere. **A reach or a radius changed** (Proximity Fold, Zone Stretch) stays not now: a reach of 12 makes a strike a shot nothing dodges, and an area grows as the square of its radius, a new area budget.

The doc needs nothing: the wards are statuses, the chip names them, and a cast at an untargetable body is refused (`noTarget`) with the doc's `refused` saying why. A flag a row would not fit beside the armed list (table 8.2).

### 8.2 Advantage and held dice (block 12)

1. The fight's one roll is the target's reaction d20 (rules 8 and 9). **The attacking side's advantage**: the target rolls two and keeps the lower (more crits, less dodge, fewer resists). **The defending side's**: it keeps the higher. Disadvantage is the reverse. An advantage and a disadvantage on one die cancel; two of one kind do not add (the rule players know, and it caps advantage with crit stacks).
2. A status op `edge { side: 'attack' | 'defend', keep: 'better' | 'worse', tag, spend }`: attack reaches each target's die of the bearer's uses against foes (only a use with the tag, if one is named); defend reaches the bearer's own die. With `spend` the status loses a stack (or ends, a plain one) after the first use whose die it changed, one a use however many targets; without it, it holds (Bow Expert's worn status).
3. A held die, `boost { side, die }`, the die a size up to d20 or a value fixed when the status lands (Expected Outcome's d20, Mythical's 20): attack lowers each target's face by its roll, defend raises the bearer's, the face kept within 1 to 20 and read as the face by rules 8 and 9 alike. It always spends.
4. New rule 7b, before rule 8: the kept face. `needs` asks for each target's second d20 when its die has an edge after cancelling, and each boost die; they come in `rolls.second` (the second d20, by target; as built, beside `rolls.react` so every reader of `react` stays as it was) and `rolls.boost` (by bearer). The GM's phone rolls them with `rollNeeds`, as it rolls every reaction d20 of a player's `cast`.
5. A monster gains them the same way; the GM's phone rolls its dice. Worth: table 8.10.2.

### 8.3 Forced movement and placement (block 13)

1. A `shove { dir: 'away' | 'toward', from: 'user' | 'aim', tiles }` op lands at rule 18 on a caught target only. 1 to 3 tiles (`shoveMax`, half a round's walk); an elite or a boss moves tiles times its control factor, rounded down.
2. It goes tile by tile on the centre line from its anchor through the target, as a line ability's line, and stops before a wall, a pit, the map's edge or a body; a pull stops next to its anchor. A stop deals nothing: a collision hit is a second damage source each map would price. A pit stops it too: a kill by geometry is the instant kill the owner turned down.
3. Several bodies of one use move in order: for a push the farthest from the anchor first, for a pull the nearest; then by `y`, then `x`, so a crowd packs.
4. A rooted body is not moved. A moved channeler's channel breaks, as when it moves itself. A forced move is a change of place, so `zoneSync` opens and closes holds, but **a forced entry pays no on-entry part**: an entry is a body's own step (design 4.7). The per-round part holds from then. Reason: a pull into spikes every turn would be two hits for one action.
5. **A blink**: an ability with `move: { kind: 'blink' }` aimed at a tile within its range (at most 8, `blinkMax`) that the user sees, may stand on and is free; the user stands there before rule 6, so the use hits from the new tile. A root refuses it (`rooted`). **A swap** (`move: { kind: 'swap' }`) aimed at a body exchanges the two places when each may stand on the other's; against a foe it is a use against it, dodged or resisted as its delivery says.
6. A blink out of a zone is a step out: the hold pays its per-round part to that moment.

### 8.4 Reactions (block 14)

Three ways were weighed. (a) A prompt: the GM's phone holds the use while a player's phone is asked. The room polls, a hidden page every 30 s, so a hit waits seconds to half a minute, and a blast on four hunters waits for four. (b) **Pre-armed** (chosen): the player chooses ahead, and the fight fires it by rule. (c) The GM taps it for the player when the table says so: the choice moves to the GM's phone; (b) keeps that as the GM's arming of anyone.

1. A reaction is an ability with `react: { when, reach }`: `before` (a foe's use is about to land on the reactor or an ally within `reach`: new rule 7c, after the shape, before the dodge), `lethal` (a hit is about to take one of them to 0: rule 13b, after the shield), `after` (a foe's use landed on one of them: rule 19c, after the use and its triggers), or `turn` (a named body's turn is about to start: in `startTurn`, before it begins).
2. A player arms one of its hunter's reactions with the room message `arm { ability | null }` (`ownSheet`, taken at any time, since it changes nothing but its own row); the GM arms anyone's with the command `arm { by, ability }`. A row holds one armed reaction at most.
3. It fires when its moment comes if the reactor is up and not held, the ability is ready (cooldown, gates, prices) and paid for, and it has not fired since the reactor's last turn began. It stays armed after: restored at the reactor's next turn.
4. Its fatigue, mana and prices are paid at once; **its time comes off the reactor's next turn** (`at += interval(cost)`). A reaction is an action taken early, never a free one.
5. It is a use at the reactor's tier on its own aim (itself, the ally, or the attacker for `after`). Two ops are a `before` reaction's alone: `guard { share }` (the share taken off the triggering use's damage to the one it protects, a strike only: Parry, 0.30 by table 8.10.3 as the simulation moved it) and `negate` (the triggering use does nothing more; its user has paid: Shinsuu Reversal). A `before` blink moves the reactor before rule 8, out of the shape if it can.
6. A reaction answers only a command's own use or a turn, never another reaction or a trigger's ops; at most 4 a use (`reactionsPerUse`), in outcome order. Its triggers fire at depth 1.
7. Dice: `needs` sees the armed reactions a use can set off and asks for their dice. A player's `cast` carries its own use's dice; the GM's phone rolls the rest as it turns the cast into `act`, so a monster's armed reaction stays the GM's secret. As built, a reaction lands at its formulas' averages, as a trigger does (no dice): it fires inside another's use, whose dodges decide its aim, and its own dice would need a second round of rolls. A `turn` reaction is restored when the named body's turn starts, not its reactor's (its reactor's turn follows at once); a `before` blink is not built.
8. The doc carries `armed`, the party's row ids that hold one (at most 12); a monster's is shown to nobody. With the ability's id the doc goes over (table 8.2: 62,325 against 62,000); a player's phone knows what it armed.

### 8.5 Moving counts and zones (block 15)

1. An op `move { key, take, from, to, as }` (a `UseOp` and a `LandOp`): up to `take` stacks (or `all`; a plain status whole) of the status `key` leave one body for the other (user or target), with the same def and source and the rest of their time from now (`since` and `settledAt` now, so no span is paid twice), up to the receiver's cap; stacks past it are lost. `key` may be `harmful` (the first harmful status: Essence Transfer) or `event` (the status that raised the trigger: Proliferate). `as` puts them on as another status key (Paradox of Motion: Inertial Storage into Momentum's Edge). A receiver's safeguard refuses a harmful one, which then stays.
2. A move changes two counts, so both bodies' thresholds check for a crossing.
3. A trigger event `down` (the bearer goes down) and a reach `{ kind: 'most', of: 'hp', radius, on }`: The Cycle Continues is Corruption's trigger, on `down`, moving all of it to the foe of its source with the most HP within the aura's radius.
4. An owner acts on its own zone with an ability's `zoneAct`, naming the zone (the one of that name nearest the aim, else the oldest): `shift` moves a fixed zone's tiles by the vector from their centre to the aim (at most 6, `zoneMove`; tiles off the map or on a wall drop) or an around-place zone's anchor; `grow` adds 1 or 2 to an around zone's radius (`zoneGrow`, to `fieldRadiusMax`); a fixed zone does not grow (design 4.8b). Detonating is wave 1's zone price.
5. A shifted or grown zone pays no on-entry part to the bodies it reaches, as a forced move pays none (8.3.4). Reason: a zone moved onto a body is a blast with no wind-up and no dodge. A moving aura's entry (design 4.8a) stays as it is, since its body walks a stride.

### 8.6 Turn economy (block 16)

1. **An extra action** is a refund to now: after the use, `at = now + 1` (as built, an op of its own, `extra`, on the user: an ability's ops are use ops, and wave 1's refund is a trigger's land op). A body takes at most one a round of fight time (`extraPerRound`, counted on the row by `floor(now / round)`); a second is refused (`extra`). Sustained through Suffering (a price of 5 Pain), Agnet of Focus (one use a fight).
2. **Giving a turn**: an op `hasten { share }` moves the target's next turn earlier by `share` times the user's own interval for a standard action, never before `now + 1`. Transfer is an ally ability of standard time with `hasten 1`: what the ally gains, the giver paid, so passing turns round a party adds none. A body is hastened at most once between two of its turns (`hastened`, cleared at its turn start).
3. **Acting before another** is a reaction with `when: 'turn'` naming the body when it is armed: before that body's turn the reactor's `at` becomes that body's `at` less 1 tick (never before `now + 1`), so it goes first. It moves the reactor's next turn earlier and adds none (React).
4. The bound is design 2.2's: the fastest build never takes four turns between two of the slowest's (table 8.10.4).

### 8.7 Stealth, surprise and flight (block 17)

1. The fog and `sees` give a foe a hiding place already: one on a tile the party does not see is not in the doc (design 5.3). They do nothing for a hunter, since the GM sees everything and plays the foes. So stealth is a status op, `hidden`: the other side cannot aim at the bearer and its shapes do not catch it, and a hidden foe is left out of the doc as if unseen.
2. Hiding is a use that puts `hidden` on its user. It is refused (`seen`) while any body of the other side that is up sees the user's tile within the sight (25 with no fog): in the open arena nobody hides, and a wall or the dark is what hides you.
3. It ends when the bearer uses an ability against a foe or a place (after that use resolves), when a foe that is up stands within 1 tile after any move (`hideReveal`), when it takes HP damage, or at its time.
4. The use that ends it has the attack's advantage (8.2), so an attack from hiding is worth the advantage of its kind (table 8.10.2).
5. **Surprise**: the GM's `start` may name a side surprised; each of its rows' openings is a round later (`surprise`). A body holding a status with an `alert` op (Spatial Awareness, the Alert condition) is not surprised.
6. **Flight stays not now**: a height the map does not draw, and with touch reaching no flier, the tank and the bruiser would have no answer but a shot. Two names of one kit ask for it (Hover, Earthbound).

### 8.8 A condition on where (block 18), and what is still not now

One cheap addition fell out of the mapping: a trigger's `need` and a gate kind `inside`. A trigger fires only while its bearer holds a named status or stands in a zone of a named name (it holds that zone's hold); a gate `inside { zone }` refuses a use outside one. It makes Doom ("inside his Aura"), Supernova (Baangs inside Starcaller's Wrath), Blink's swap while Domain is up, and Colors of Frustration as "a Torment painting while in the Disaster mood".

Still not now, with the reason: collectable sets (a machine across fights, one kit); perk trees with prerequisites (paths are six tiers of two, and the GM gives the skill); a trigger on the order of abilities in a round (the mood and `need` make Colors without "the first two in a round"); rewinds (the owner: "unnecessary for now"); permanent growth from kills (a reward line the GM gives); flight (8.7); a reach or a radius changed (8.1); portals that last and link (a ground of its own with movement rules, one kit).

### 8.9 The state trees of wave 2

Six things have states. Each becomes a `TABLE` typed as the fight's (the typecheck asks for every cell), a view in `scripts/charts/` and an entry in `MACHINES`, with its events in `tests/models/`. Their cells are the script's `MACHINES2`, printed under 8.9 (`bun scripts/kits-paper.ts`); this file keeps the sketches to stay near its length. A scaler has no state (a function of the snapshot), a moved count is table 2.1's "apply" and "a price takes m", a moved zone is table 2.6's "laid", and an advantage that cancels is a cell of 8.9.2, not a machine.

```
8.9.1 reaction  [unarmed] --arm--> [armed] --its moment, may fire--> [fired] --resolves--> [spent] --its turn starts--> [armed]
                [armed | spent] --disarm | down | fight ends--> [unarmed];   [spent] --its moment--> [spent]
8.9.2 edge      [absent] --lands--> [held n] --a die it reaches--> (used) --spend--> [held n-1 | absent];  (used) --worn--> [held n]
8.9.3 shove     [standing] --lands caught--> [moving k] --free tile--> [moving k-1] --wall | pit | edge | body | anchor | k=0--> [landed] --zoneSync--> [standing]
8.9.4 stealth   [seen] --hide, unseen by foes--> [hidden] --acts on a foe | a foe within 1 | HP damage | time--> [revealed] --> [seen]
8.9.5 ward      [never] --lands--> [warded] --a round | acts on a foe (untargetable) | cure--> [spent] --lands again--> [spent]
8.9.6 extras    [plain] --extra action--> [extra taken] --a later round--> [plain];   [waiting] --hastened--> [hastened] --its turn--> [waiting]
```

The cells a reader may not guess: a reaction that may not fire stays armed and says nothing (a player is not told why every hit passed); a reaction is spent until its reactor's next turn, not for a round, so a slow reactor reacts less often in fight time; an edge and an opposite edge on one die cancel and both spend; a dodge is not a push (8.9.3: out, ring and resisted leave a body standing); a stealthy body revealed may hide again at once if no foe sees it; a ward that lands a second time in a fight does nothing and logs it.

### 8.10 The budget of wave 2, the loops and the simulation's rows

Every worth is in section 3's unit, the standard action (SA), so the maker adds wave 2's parts to wave 1's and warns past 1.08 times the pace's budget. Each table is the script's under 8.10.

- **A scaler** (8.0): its mean bonus over the reference dungeon, which the suggested base cut pays back; a suggested scaler is worth nothing more, and the worth line shows the larger of its worth against packs and against a boss.
- **A share op** (table 8.10.1): with every use of the party at the cap of 1.5 the whole fight, a pack lasts 2.09 to 2.53 rounds (floor 2) and a boss 3.68 to 4.51 without the kind factor, under the floor of 4 at E and C. With the factor (a boss takes half the part above 1) it lasts 4.42 to 5.41. That is the reason for the factor. A share's worth is its percent times the uses it reaches.
- **An edge** (table 8.10.2) on one use: the attack's edge is worth 1.02 to 1.03 of a strike (nothing dodges a swing, so only its crits change), 1.22 of a shot, 1.10 to 1.19 of a curse and 1.53 to 1.72 of a blast on a tank, which is 0.80 to 1.08 SA: a spent edge on a blast is worth about a standard action. The defending side's is the mirror. A held d6 is worth a little more than an edge (1.09 to 1.85). A worn edge that never spends is that change on every use: on a shot or a curse it is past the tolerance, and the maker warns (Bow Expert, Sword Expert).
- **Advantage with crit stacks** (table 8.10.2b): a heavy strike at the crit caps (6 faces, size 2) with the attack's edge takes 28 to 38% of a same-rank tank's max HP in expectation, under design 6's 60%.
- **A reaction** (table 8.10.3): Parry's guard was searched as the largest share taken off a parried strike with which no build armed with it all fight improves a duel against a striker (tank, bruiser) by more than the tolerance at C and S: **0.35** on paper, **0.30** in the simulation (sim-log.md, wave 2: at 0.35 the speed build beat the tank 0.08 more at C and 0.17 at S, since a duel is a race). The sheet's own Parry (0.25 of the hit on a success, 0.75 on a fail) takes about 0.5 off at parity, which lifts the speed build over the tank by 1.30 to 1.40; at 0.35 that is 1.00 to 1.07, and every other build that parries loses more turns than it saves. A reaction's worth is its use's, less nothing: its time is real.
- **Turns** (table 8.10.4): the fastest paper build takes 1.75 to 2.31 turns between two of the plate tank's, and 3.29 to 3.74 with an extra action every round, under design 2.2's four. An extra action is worth 1 SA; a hasten of share s is worth s of the giver's action and costs the giver the same.
- **Forced movement** (table 8.10.5): a push of n tiles costs its target n / 6 of an action (0.5 at 3), on an elite and a boss less (a 1-tile push moves neither). A blink saves r / 6 actions of walking less its cost: a quick blink is slower than walking under 5 tiles, so its worth is crossing what a walk cannot (a wall's corner, a body, a root's zone).
- **A ward** (table 8.10.6): one round of being struck, 10 to 24% of a C body's max HP, once a fight.

**The degenerate loops and the rule that stops each:**

| Loop | The rule that stops it |
|---|---|
| Extra turns (a refund every use, Transfer back and forth, React every turn) | One extra action a round (`extraPerRound`); a hasten moves only what the giver paid and reaches a body once between its turns; React moves a turn earlier and adds none. The fastest build takes 3.74 turns between two of the tank's (table 8.10.4) |
| Damage taken stacking, with what was the execute | Of each side only the strongest increase applies; the product stays at most 1.5, and a boss takes half the part above 1 (table 8.10.1). There is no execute to stack with: a scaler is neutral by its base cut (8.0) |
| Advantage with crit stacks | Edges do not add; crit faces with exposure stay at most 6 and crit size at most 2; the worst heavy strike is 38% of a tank (table 8.10.2b) |
| Teleport out of zones, pull into them | A blink out is a step out, which pays the per-round part to that moment; a forced move and a shifted zone pay no on-entry part; a root refuses a blink |
| A reaction chain (Parry, its counter, the counter's parry) | A reaction answers only a command's own use or a turn, once between two of its reactor's turns, at most 4 a use, its time off the reactor's next turn |
| Stacks moved round a threshold (The Cycle Continues into a burst into a kill) | Wave 1's depth 2 and 16 firings; the cap holds on the receiver; a move checks each threshold once |
| A ward every round | Untargetable and invulnerable reach a body once a fight (the row's `warded`) |
| Hiding every turn | Hiding is refused while a foe sees the tile; acting reveals; the attack from hiding is one edge |

**The rows the simulation gains** (`tests/models/fight-sim.ts`, `tests/fight-sim.test.ts`), each with its lever: a speed build with Parry armed against the tank and the bruiser at C and S, its win share within 0.08 of without (`kit.parry`, 0.30); the party against a boss with a damage-taken curse kept on it, still 4 to 8 rounds (`shareCap` and the kind factor); the triangle with a worn attack edge on the speed build's shot, reported, not bounded, so the maker's warning has a measured number beside it; the party with Transfer and Sustained through Suffering, a boss still 4 to 8 rounds (`extraPerRound`). **The model's invariants** (`tests/fight-model.test.ts`): a reaction never fires twice between two of its reactor's turns; a forced move never ends on a wall, a pit or a body; a hidden or untargetable body is never in a foe's outcome; a ward reaches a body once a fight; no `at` is set before `now + 1`; no body takes two extra actions in a round.

### 8.11 The mapping again

The script's `WAVE2` gives each entry of wave 1's `MAPPING` that wave 2 changes its new verdict and blocks; a group may split and keeps its names, so the total stays 200. Table 8.11.1 lists the 50 entries that changed; table 8.11.4 lists what is still not now; table 8.11.5 maps Glas's own summary (`kits/glas.md`), which came after the 200 and is counted apart.

| Verdict | Wave 1 | Both waves |
|---|---|---|
| Made by the blocks | 52 | 83 |
| Made, with a named difference | 22 | 32 |
| Makeable today | 22 | 23 |
| Not now | 78 | 36 |
| Undefined in the sheet | 26 | 26 |

**Makeable: 138 of 200 (69%), 79% of the 174 the sheet defines**, up from 96 (55%). With no difference: 83. Glas's summary: 22 of 31 names, 73% of what his sheet defines.

Every wave-2 block is used by two or more names (table 8.11.3): scalers 3 (Resonance, the execute, Sanguine Resonance; the owner asked for the family by name), ops 21, advantage and held dice 15, forced movement 7, reactions 10, moving counts and zones 8, turn economy 7, stealth and surprise 5, a condition on where 8.

**Still not now** (36 names), by class: outside the fight or the GM's to rule (checks, downtime, relics, painting anything into being: Trick, Cunning, Hyperbole, Mourning's Light, Diplomacy's check, Guidance, Font of Inspiration and Maro's seven relic names, 14); collectable sets (Constellations, Zodiac, Cosmic Creator); a defence against areas only, non-lethal by choice, and an undefined cape (Slime Crown, Mercy's Cape, Imagined Reverie); flight (Hover, Earthbound); portals (Create Portal, Rendwalk); a reach or a radius changed (Proximity Fold, Zone Stretch); a change of terrain for allies (Pact Redux Bronze, Fleeting Current); and one name each: Disengage (no opportunity attack), Singularity (a cost of all mana), Weighted Step (resisting a push), boundless (a zone of the whole map), Silentum Perpetuum (a permanent loss: a reward line), Ceaseless Pursuit (a chain of rolls on a rising DC), Harmonious Reverberance (a turn on which nobody may attack), Celestial Tether (a redirect of an aimed use). Of Glas's summary, his rewind and retry, his doubled stacks, Second Impact, Consume and the day's mark stay not now.

### 8.12 The makers and the build order of wave 2

Each group is a collapsed `.mk-group` marked `data-later`, its sentences from `describeStatus` and `describeAbility`, its worth from `worthOf` (wave 1's `worth.ts`); no rule in `maker.js`.

| Maker | Group or row | Fields | Preview sentence |
|---|---|---|---|
| Ability form | The formula field: Scales | Up to 2 rows: a select of the eight; Start (a percent, filled 50); Scale (a percent, filled with the kind's suggestion, table 8.0.2); the base cut written with them | "Up to +100% against a target under half its HP." and the worth against packs and a boss |
| Status maker | The effects editor | Sheet (a key select, an amount); Share (dealt, taken or healed, a percent); Untargetable, Invulnerable, Safeguard (no fields, "a round, once a fight"); Edge (attack or defend, better or worse, a tag chip, Spends); Held die (attack or defend, a die or a fixed face); Hidden; Alert | "Takes 25% more damage." "Your next use against a foe: the target rolls twice and keeps the lower." |
| Ability form | Moves | A `.seg`: None, Blink, Swap; Shove rows in its ops (away or toward, from you or the aim, 1 to 3 tiles); Zone act (Shift, Grow, Detonate, the zone's name) | "Blinks to a tile you see within 8." "Pulls each target 3 tiles toward the centre." |
| Ability form | A reaction | A switch; When (`.seg`: Before a hit, Before a killing hit, After a hit, Before a turn); Reach (tiles); Guard (a percent) or Negate | "Reaction: before a strike lands on you, take 30% off it. Its time comes off your next turn." |
| Ability form and status maker | Wave 1's groups | Only when gains Inside (a zone's name); When something happens gains Down, Need (holds, inside) and the reach Most HP; the effects editor gains Move, Hasten and Cure harmful (first, all) | "Only inside your Aura of Corruption." "Moves 2 Energize to the target." |
| The table (`table.js`) | Arm | The hunter's reactions as a `.seg`, None to disarm; teammates' cards show "Ready to react" from `armed` | "Armed: Parry" |
| The GM's Start window | Surprised | A `.seg`: None, The party, The foes | "The foes are surprised: their first turns come a round later." |

**Three built-ins to copy**: Parry (a quick reaction, before a strike, guard `kit.parry`, 0.30); Death's Grasp (a standard line that pulls 3 toward its user); Executioner's Cut (a strike with the suggested Execute: `0.8 * (1d8 + phys) * (1 + max(0, min(1, (target.missing - 0.5) / 0.5)))`).

**The build order**, numbered after wave 1's 17. Each unit is one module or one wiring step and ends in its test file.

| # | Unit | What it is | Test | After |
|---|---|---|---|---|
| 18 | Rules and types | `KIT2` and `SCALE` into `RULES.fight.kit`; the new `Op`, `UseOp` and `LandOp` members; `cureStatus`'s `which`; `Ability.move`, `react`, `zoneAct`; a trigger's `need`, the gate `inside` | `tests/rules.test.ts` | wave 1's 1 |
| 19 | Scalers | `Ticks.scalers`, `recommended`, `ticksOf`, the lines of `describeAbility`, the suggestion in `worth.ts` | `tests/ability-kinds.test.ts`, `tests/worth.test.ts` | 18; wave 1's 3, 5 |
| 20 | Sheet and share ops | the `sheet` op after `derive`, rule 11c, `healed`, `payDue` reading taken, harmful in `zoneTone` | `tests/effect-ops.test.ts`, `tests/resolve.test.ts` | 18; wave 1's 2, 6 |
| 21 | Wards and stealth | the three wards, `warded`, `hidden` and its reveals, a hidden foe out of `fightDoc` | `tests/fight.test.ts`, `tests/fight-doc.test.ts` | 20 |
| 22 | Edges and held dice | rule 7b, `needs` asking for the second d20 and the boost, `cast` carrying them | `tests/resolve.test.ts`, `tests/roll.test.ts`, `tests/protocol.test.ts` | 18; wave 1's 6 |
| 23 | Forced movement | `shovePath` in `space.ts`, blink and swap, no on-entry part on a forced entry | `tests/space.test.ts`, `tests/fight.test.ts` | 18; wave 1's 6 |
| 24 | Moving counts and zone acts | `move`, the `down` event, the reach Most HP, shift and grow | `tests/triggers.test.ts`, `tests/fight.test.ts` | wave 1's 7, 9 |
| 25 | Turn economy | the extra action a round, `hasten`, `hastened` | `tests/timeline.test.ts`, `tests/fight.test.ts` | 18; wave 1's 6 |
| 26 | Reactions | `fight-react.ts` (table 8.9.1), the `arm` command and message, rules 7c, 13b and 19c, the turn reaction in `startTurn`, `needs` | `tests/fight.test.ts`, `tests/protocol.test.ts`, `tests/server-rooms.test.ts` | 22, 23, 25 |
| 27 | Doc | `armed` | `tests/fight-doc.test.ts`, `tests/protocol.test.ts` | 21, 26; wave 1's 12 |
| 28 | Machines and model | the six charts of 8.9, `MACHINES`, the invariants of 8.10 | `tests/statecharts.test.ts`, `tests/fight-model.test.ts` | 21 to 26 |
| 29 | Simulation | the rows of 8.10 | `tests/fight-sim.test.ts` | 28; wave 1's 14 |
| 30 | Makers and the table | the groups above, the built-ins, Arm, Surprised | `tests/e2e/makers.e2e.ts`, `tests/e2e/table-turn.e2e.ts` | 29; wave 1's 16, 17 |

**Beside wave 1**: 18 once wave 1's 1 is in; 19 beside wave 1's 6 to 11, since it touches only `ability-kinds.ts` and `worth.ts`. **After wave 1**: 20, 22, 23 and 25 need wave 1's resolve (6) and run beside each other; 24 needs wave 1's triggers and zones (7, 9); 26 needs 22, 23 and 25. Nothing in 30 starts before 29 is green.

**`AGENTS.md` rows**: a scaler (`Ticks.scalers` in `registry/ability-kinds.ts`, `tests/ability-kinds.test.ts`); a reaction (`fight-react.ts`, `tests/fight.test.ts` "a reaction"); a forced move (`shovePath` in `space.ts`, rule 18 in `resolve.ts`); a ward and stealth (`effect-ops.ts`, `fight-turn.ts`). **Recipes**: a scaler (a member of the measure or direction, its text in `recommended`, its reading in `ticksOf`, its words, a row of table 8.0.2); a reaction moment (a member of `when`, its rule in `resolve.ts` or `startTurn`, its `.seg` button, its cells in table 8.9.1).
