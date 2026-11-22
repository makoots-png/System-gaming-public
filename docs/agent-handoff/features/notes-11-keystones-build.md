# Notes 11, build: keystones unit K1 (the rules and the pure rule)

Branch `keystones-1`. Design: `notes-11-keystones.md` sections A.2, A.3, A.5, row K1 of A.10.

## Progress

- Read the brief, helper rules, AGENTS.md, the design sections, the two principle skills, rules.ts, overrides.ts,
  stats.ts, jobs.ts, job-chain.ts, progress.ts `allocated`.
- Built K1 in one step: `RULES.fight.keystone`, the readers, `src/core/hunter/keystones.ts`, `Job.pair`, the tests.
  `flock /tmp/box.lock bun run test`: 5922 pass, 0 fail.

## What exists

- `RULES.fight.keystone` (`src/core/rules.ts`, after `kit`): `on`, `markShare` 0.3, `pairShare` 0.25, `apexShare` 0.55,
  `markRank` D, `pairRank` C, `apexRank` B, `monsterKinds` elite/boss/mythic, `budget` mark 2, confluence 3, apex 4. Each
  share and budget has a domain with its reason; the budgets share one domain, `KEYSTONE_SPEND` (0 to 30), declared
  with the other shared domains (one line outside the block).
- `src/core/overrides.ts` `READERS`: the three ranks read as one of `RANKS` (`oneRank`); `monsterKinds` entry by entry,
  each a key of `fight.kinds`. The generic tests of `tests/rule-domains.test.ts` and `tests/overrides.test.ts` walk the
  new numbers and the new list on their own; three named cases added (apex share 0.5, a rank that is not one, a kind
  that is not one).
- `src/core/hunter/keystones.ts`: `StatPair` (a type over `STAT_KEYS`, 28), `STAT_PAIRS`, `pairOf`, `statsOfPair`,
  `KeystoneKey`, `KeystoneBasis`, `sharesOf`, `keystonesOf`, `keystoneReach` (`StatReach` with `NextKeystone`), and
  `keystoneBasis(h)`, the one reader from a hunter.
- `Job.pair` on every job (`src/core/registry/jobs.ts`), each with its reason beside it.

## Each job's pair (from the stats that feed what the job does: derive.ts, item-budget.ts `FED_BY`)

| Job | Pair | Why |
|---|---|---|
| Fighter | str+vit | physical power, and HP and armor to stand in reach |
| Assassin | agi+ins | speed; the opening, Reaction and crit faces |
| Ranger | agi+ctl | speed and move to keep range; accuracy and crit size |
| Mage | pow+ctl | magical power and mana; accuracy, penetration, cost cut |
| Tanker | vit+dis | HP and armor; resist, will and tenacity: the guard on both sides |
| Healer | dis+pre | support power; will and channel hold to cast under fire |
| Necromancer | pre+pow | shadow capacity; the mana a summon costs |

All seven are different. Tanker could as well be vit+pre (Presence draws threat); I chose the guard over the threat.

## Where the design did not hold against the code, and what I built

1. **`above` is not "the score less the base".** Design A.2 writes `share(k) = above(stats[k]) / Σ above(...)` and
   calls `above` "the score less the base (10)". `stats.ts` `above` is the curved `eff(s) - base`. I followed the
   words ("share of the points spent"): a share counts raw points `max(0, score - statBase)`. With the curve, 60/40
   raw points would not be 60/40, and A.2's table would not hold.
2. **`StatPair` home.** A.3 puts `StatPair` in `src/core/registry/keystones.ts`, which is K2's file. K1's files do not
   include it, so `StatPair` lives in `src/core/hunter/keystones.ts` and `jobs.ts` imports its type. K2 may move it.
3. **"Its chain is done" is not stored.** A finished chain sets `jobChain` to null and grants the job; nothing else
   records it. `keystoneBasis` reads it from the quests: a done quest of kind `job`, with a `chainId`, whose reward
   is the hunter's job (the third step's quest, `stepQuest`). A hunter who deletes that quest loses `awakened`.
   No flag was added, as the design wants no keystone state; if the lead wants it durable, a chronicle fact or a
   `jobChain` "done" state is the place (outside K1's files).
4. **A stat under the base** (a GM edit to 1) spent no points, not negative ones: `max(0, ...)`.
5. **Ties.** The confluence's "two highest" sorts by share, a tie to the stat first in `STAT_KEYS` (JS sort is
   stable). Marks and the pair are "at least" their share; the apex is "over" its share, as A.2 says.
6. **`keystoneReach`** returns, per stat, its share and its next own keystone (mark, then apex) with the share and
   rank it asks and whether each is met. The confluence's reach ("Rank C opens your Confluence") is not per stat;
   K6 can read it from `keystonesOf` at the next rank. Not built here.
7. **Fight status test.** No row holds keystones yet (K4). "A fight status never changes one" is held on a hunter's
   `conditions` (the statuses a hunter carries into a fight): a `stat` op lowers the sheet's Strength by 15 and the
   mark stays. K4 should add the same on a row.

## Principles that changed a choice

- principle-type-system-discipline: `StatPair` is a type built over `STAT_KEYS`, not a hand list, so K2's
  `Record<StatPair, Keystone>` asks for every pair; the ranks in the rules are typed `Rank` and read by a reader that
  refuses any other text, rather than trusting a string.
- principle-model-the-domain: no keystone state; `KeystoneBasis` names the four inputs and nothing else, and
  `keystoneBasis` is the one place a hunter becomes one, so gear and titles cannot reach the rule.

# K3

The two ops of A.7: `{ op: 'stagger'; share }` (a use op and a land op) and `{ op: 'echo'; radius }` (a land op).
Proof: `flock /tmp/box.lock bun run test` ends `Ran 5937 tests across 134 files.` with 0 fail; the maker's browser file
is: `flock /tmp/box.lock env E2E_CHROMIUM=/opt/google/chrome/chrome E2E_PORT=4360 bunx playwright test
tests/e2e/makers.e2e.ts --workers=1 --output=/tmp/pw-k3` ends `61 passed (6.1m)` on the first run ("every kind of op
round-trips" saves both new ops).

## What was built

- **The bar has one place it fills.** `barFilled` in `land.ts` (rule 16's break: stun `staggerCost` rounds, empty,
  grow `staggerRegrow`) and `barRate` (the `staggerRate` statuses). Resolve's `staggered` (a hit) now computes its fill
  and calls `barFilled`; `staggerOp` (the op) computes `min(staggerOpMax, share * barRate) * max` and calls it. A use's
  outcome adds the op's fill to `stagger` and its break to `staggered`, so the card and log say it.
- **`kit.staggerOpMax`** 0.5 in `rules.ts`, domain 0 to 1, reason "half a bar, so no one op breaks a bar alone". The
  cap holds after the bearer's stagger rate too: a bar that fills twice as fast still takes half from one op, so the
  reason holds on every body. The parser holds a GM's larger share at the cap (the kits' clamp convention).
- **"As hits of that size would"**: read as "the bar fills by that much and breaks as a hit's fill does". A weak hit's
  1.5 weight is not applied: a share of the bar is not a hit measured against a same-rank hit.
- **Echo** lands in `echoed` (`land.ts`), once per op after the targets, on the nearest other body of the gainer's side
  within `radius` (held at `fieldRadiusMax`) that is up and lacks the status (a tie: the fight's order), from the same
  source, one stack, for the time the status had left at that moment (it was put on that moment, so that is the length
  it had when put on; `until - since` would be wrong for a refreshed status, whose `since` is the old one). It goes
  through rule 18's door like any status (`putFor`, split out of `landStatus` so the length is not shortened again by
  tenacity: a safeguard or a spent ward refuses it, a hold stuns, a channel breaks, a threshold crosses). It is told as
  a body that gained nothing, so it raises no `statusGained` and cannot chain.
- **Worth**: a stagger is `share * breakWorth`, a break being `staggerCost` rounds of the monster's turn weighed as a
  delay's time (`staggerCost * round / cost.standard` = 1.5 SA). An echo stays unweighed (named in `unweighed`): its
  worth is the status it copies, which the trigger's key names and `landWorth` cannot see.
- **Maker** (`maker.js`): "Fill the stagger bar" (a percent of the bar, 0 to 50, with a line that only an elite or a
  boss has one) in the skill and land rows; "Echo to the nearest" (tiles, 1 to the widest field, with a line on when it
  acts) in the land rows; both in the status rows through `OP_KINDS`.

## What did not hold against the code, and what I built instead

1. **`imposed` is not built** (item-stats). Echo is built against `statusGained`: `fire` (`triggers.ts`) passes a
   trigger's `landOps` the status gained that set it off (`Gained`: who gained it and its key), and echo reads only
   that. With `statusGained` the trigger's bearer is the one that gained the status, so "the foe nearest the trigger's
   other body" becomes "the body nearest the gainer, on the gainer's side". When `imposed` lands, its line in `fire`
   passes `{ holder: e.other, key: e.key }` and echo needs no change. The shape a GM can make today: a status whose own
   trigger is "when its bearer gains this status: echo". Puppeteer (an echo of whatever its hunter imposes) needs
   `imposed`.
2. **Where echo may stand.** The design says echo is an op of an `imposed` trigger. The trigger maker in
   `kit-parts.js` (outside K3's files) gives every trigger, threshold and end one list of land ops, so a parser that
   refused echo elsewhere would let a GM build a status the save then refuses. Echo is read everywhere a land op is
   and does nothing where no status gained set it off, as `move` with `key: 'event'` does in an end. If the lead wants
   it refused elsewhere: `kit-parts.js` passes the trigger's event to `M.effects`, and the parser refuses echo outside
   a `statusGained` trigger.
3. **Files outside the brief's list that the compiler or the behaviour asked for**: `src/core/combat/triggers.ts` (the
   one line that passes `gained`), `src/core/status-refs.ts` (`opWalk`), `src/core/registry/icon-defaults.ts`
   (`OP_ICON`: both `status`), `tests/icons.test.ts` (`SAMPLE` and `OP_PICTURE`). None is another helper's.
4. **"A mythic's bar takes `mythic.staggerTaken` of it"** is design B's and not built (no such rule yet).

## Principles that changed a choice

- principle-model-the-domain: the bar's fill and break had one copy inside resolve.ts; a second for the op would have
  been two writers of one machine. Both now go through `barFilled`.
- principle-test-behavior-not-implementation: the echo test places a third foe one tile from the echoed one, so an
  echo that raised `statusGained` would put the status there; I checked it fails when the echo is told as gained.

# K2

The registry: `src/core/registry/keystones.ts`, the 44 keystones of A.6 and the awakened powers of the seven pairs the
jobs name. Tests in `tests/keystones.test.ts`: "every keystone parses as Powers", "every keystone spends within its
tier's budget", "every pair a job names is awakened, and no other keystone is".
Proof: `flock /tmp/box.lock bun run test` ends `Ran 6037 tests across 136 files.` with 0 fail.

## What was built

- **Shape.** `KEYSTONES` holds a maker for each keystone, `(R) => Keystone`, in three tables typed over `StatKey` and
  `StatPair` (a new stat asks for its Mark, Apex and seven confluences). A maker, not a value, as the kits' examples:
  a round's ticks and a kind's costs are the rules the keystone is read under. `keystoneOf(key, R)` makes one; K4 reads
  it. `Keystone` is A.3's: `Powers` with `name`, `line`, `bonus`, `awakened`. `StatPair` and `KeystoneKey` stay in
  `hunter/keystones.ts` (K1's home; moving them is outside K2's files).
- **Status keys** are `keystone-<name>`, so a GM's library status of the same name never merges with one on a row.
- **Awakened** (my design, A.6 wrote two examples for pairs no job names): Fighter (Juggernaut) heals 2.8% of max HP on
  a kill; Assassin (Riposte) strikes again on a crit; Ranger (Hamstring) pushes the foe's next turn back on a hit, once
  a round; Mage (Archmage) gets 5% of its turn back when a spell kills, once a round (the parser holds time back to once a round); Tanker (Stonewall) taunts the foe that hits it,
  once a round; Healer (Oathkeeper) dispels allies within 2 tiles on a support use, once a round; Necromancer
  (Conduit) heals allies within 3 tiles on a kill. Each awakened set is held to the confluence's budget.
- **The budget test** weighs each keystone at its tier's rank (`markRank`, `pairRank`, `apexRank`) with its bonus, as an
  accessory of that rank's rarity (`itemSpend` = the bonus plus `powersSpend`), and holds it within `budget` ± 20%
  (A.8). A part worth.ts has no rule for is named, so such a keystone is held only from above.
- **Echo's worth**: not given. Puppeteer is echo alone, so it is held only from above like every unweighed keystone;
  the test does not need a number, and an echo's worth is the status it copies, which the trigger cannot see (K3's
  reasoning holds). `worth.ts` is unchanged.

## What did not hold against the code

1. **The budget is about a fifth of A.6's amounts.** `RULES.fight.keystone.budget` is 2, 3 and 4 points ("a title's
   band"). Weighed by `powersSpend`, A.6's amounts are far over it: Follow Through 10.2 points for a budget of 2,
   Slip Away 6.5, Rally 8.7, Executioner 17.8 (3), Riposte 12.8, Vanguard 16.7, Endless Stride 12.4, Archmage 40.2,
   Blood Magic 44.5, Undying's heal 24.3 (4), Cataclysm 29.9, Worldbreaker 284, Spellblade 343. A point is small: one
   standard action a round is 58 points at D, 83 at C, 120 at B (the strike over what a Strength point adds to it).
   I cut every weighed amount to the budget, by one factor each, so the shapes are A.6's and only numbers moved. The
   cuts make some keystones near nothing (Worldbreaker 3% of a strike and 0.7% of a bar; Spellblade 0.44% of Power;
   Cataclysm 13% of a blast). A budget that holds most of A.6 as written is about five times today's (mark 10,
   confluence 15, apex 20, inside `KEYSTONE_SPEND`'s 0 to 30). That is a call for the owner (below).
2. **Parts the bar cannot weigh keep A.6's amounts**: shields, damage shares, speed, edges, auras, dispels, wards,
   alert, channel guard, root, taunt, mana. Second Wind's 25% shield and Juggernaut's -10% taken / +20% dealt are held
   by nothing until K5's sim. Against the cut amounts beside them they are likely strong.
3. **worth.ts weighs a delay and a stagger ten times over.** `landWorth` divides a delay's ticks by `cost.standard`
   (100); a standard action at base speed is `round` ticks (1000, timeline.ts `interval`). `breakWorth` has the same
   unit: 1.5 rounds weigh 15 SA, not the 1.5 its comment says. `tests/worth.test.ts` ("a curse that puts a foe's next
   turn one standard action later") writes the same assumption into its expected value. Lockdown (3 ticks), Hamstring
   awakened (4 ticks) and Worldbreaker's stagger are fitted to the bar as it weighs today; with the fix each is ten
   times larger. The fix is outside K2's files: divide by `interval(speedBase, paceCost('standard'))` in both, and the
   worth test's ticks become `round`.
4. **Check: an ability's kind among its tags. Does not hold.** `abilityOf` sets no tags and `eventsOf` raises only the
   ability's own `tags`, so a trigger on tag `strike`, `blast`, `curse` or `support` fires only for an ability a GM
   tagged so, and `used` is raised only for an ability with tags. K0 did not build it. Follow Through, Rally, Arcane
   Surge, Executioner, Spellblade, Bonebreaker, Quickcast, Searing Insight, Channeler, Conduit and two awakened sets
   are written with the kind tags as A.6 says; they do nothing in a fight until the kind is a tag. The fix (K0's, in
   `triggers.ts` `eventsOf` or `ability-kinds.ts`): an ability's tags are its kind, then its own.
5. **Check: a channel as a tag. Does not hold** (same cause). Channeler takes A.6's fallback: after a spell (`used` on
   `blast` and on `curse`, since a trigger names one tag and `used` needs one), the next hit deals 20% more.
6. **A stack that leaves on a hit dealt goes with the hit that put it on.** `fire` runs the leaves after the event's
   triggers, so A.6's Surging (put on by Surge's threshold on a hit) would leave at once. Surging and Spellblade's
   Charged instead go by their own trigger (`cureStatus` on a hit dealt), which reads the def list from before the
   event. Momentum, Resolve, Gathered and Stillness keep A.6's leave: they are put on by another event.
7. **A spell is two triggers.** A trigger names one tag; each "spell" trigger is written once for `blast` and once for
   `curse`. The bar counts both at their full rate, which doubles a spell keystone's weight.
8. **Small departures.** Read the Opening is a plain status of `exposed` 1 (exposed sums the op, so one stack is one
   face; A.6's two stacks of a 0.5 op are the same). Sovereign's shadow is `bonus.shadows` (a `Bonus` key, not a
   `BONUS_KEYS` one: no item carries it, so the budget names it unweighed). Deadeye drops its crit face (10 points at
   C alone, and a face is whole); Blood Magic drops its 20 mana (40 points) and Archmage its cost cut (38 points), and
   Archmage's resist pen is 25% instead. Unbroken Focus and Mind Fortress keep tenacity at 1 (2.3 and 2.6 points).
   Lines that say "your next strike" for a stack that leaves on any hit now say "your next hit".
9. **Commander chains on itself.** Marked is harmful, so putting it on raises `imposed` again and Commander fires
   until `kit.depth`. Bounded, but it spends `kit.fires`. A limit of once a round would stop it; A.6 has none.

## Calls the owner might have made otherwise

- The budget scale (point 1). Undo: raise `RULES.fight.keystone.budget` (rules.ts), then restore A.6's amounts, each
  named in the row's comment and above.
- Awakened sets held to a confluence's budget (an awakened pair is at most a second confluence). Undo: the test's
  awakened row.
- The seven awakened powers themselves.

## Principles that changed a choice

- principle-model-the-domain: a maker per keystone in `Record`s over the stats and pairs, so the compiler asks for every
  keystone, and the rules a keystone is read under are a parameter, not a copy of `RULES`.
- principle-subtract-before-you-add: where a part could not fit the budget as a whole number (a crit face, the cost
  cut, the mana), it was dropped, not kept as a fraction no player can read.

## K2, second pass: the three gaps closed

The lead's rulings on points 1, 3 and 4/5 above, built on branch `keystones-2`. Proof: `flock /tmp/box.lock bun run test`
ends `Ran 6044 tests across 136 files.` with 0 fail.

### 1. A delay's and a break's worth (point 3 above): fixed at the cause

Checked against the rule first. `timeline.ts` `interval(speed, cost)` is `round * cost / speed`: a standard action at
base speed (100) takes `round` ticks, 1000. `cost.standard` (100) is the action's cost in hundredths of a standard
action, not a span of time. `landWorth` divided a delay's ticks by `cost.standard`, and `breakWorth` divided a break's
rounds of ticks by it, so both weighed time ten times over: a break was 15 SA, not the 1.5 its comment said.

The fix is one reader, `actionTicks` in `worth.ts` (`interval(speedBase, paceCost('standard'))`), that both divide by.
`tests/worth.test.ts` now puts a foe's turn back `round` ticks (one standard action, from the rule's own words in
rules.ts) and expects one action at the share a curse lands; a new case holds a break at `staggerCost` actions and a
half-bar stagger at half of that.

What moved: only what holds a `delay` or a `stagger` op. No built-in item, kit, monster or skill holds either (grep of
`op: 'delay'` and `op: 'stagger'` in src), so no item budget and no built-in worth line moved; the maker's worth line
for a GM's own delay or stagger is now a tenth of what it said. No browser test reads such a line (grep of tests/e2e).
In the registry, Lockdown, Hamstring awakened and Worldbreaker's stagger were fitted to the old weighing; the first
commit made them ten times larger so they weighed the same, and the third restored A.6's.

### 2. An ability's kind and its channel are tags (points 4 and 5 above)

`tagsOf(a)` in `ability-kinds.ts` is the one list of an ability's tags: its kind (`KIND_TAG`), `spell` for a blast or
a curse (`SPELL_TAG`), `channel` when its `channel` is set (`CHANNEL_TAG`), then the GM's own `tags` not already among
them. It is worked out where it is read, never stored, so the GM's `kit.tags` limit counts only the GM's words and a
kind changed in the maker changes the tags with it. `eventsOf` (triggers.ts) reads it for every event, and now raises
`used` for every use (before, only for an ability with tags).

`spell` is mine, not K0's: A.6 writes every spell keystone as two triggers, one on `blast` and one on `curse`, and the
bar counted both (point 7 above), doubling each spell keystone's weight. With `spell` each is one trigger.

Tests: `tests/ability-kinds.test.ts` "an ability's kind is one of its tags" and three beside it (spells, channels, the
GM's tags once and unstored); `tests/triggers.test.ts` "a trigger tagged with a kind fires on every ability of that
kind, with no tag the GM typed" (a strike trigger fires on an untagged strike and not on a curse, a curse trigger the
other way) and "a spell is a blast or a curse, and a channelled ability is a channel".

Channeler drops its fallback: its trigger is `used` on `channel`. Its line says what the op does: after you release a
channel, your next hit deals 20% more. `used` is raised after the use's hits (rule 19b), so the 20% reaches the hit
after the channelled spell, not the spell itself; no op today makes one use's own hit larger by its tag.

**Left, outside my files:** `src/core/combat/standing.ts` line 389 matches an `edge` op's tag against `a.tags`, the
GM's own only. An edge on `attack` tagged `strike` answers no strike until it reads `tagsOf`:

```ts
if (o.op !== 'edge' || o.side !== side || (side === 'attack' && o.tag !== null && !tagsOf(a).includes(o.tag))) continue;
```

with `import { tagsOf } from '../registry/ability-kinds.ts';` and its `a` typed with `kind` and `channel` (the callers
pass whole abilities). No keystone needs it today (every keystone edge has `tag: null`).

The built-in item Spellblade (items.ts) readies on `used` tagged `spell`: every blast and curse now readies it, as its
name says, with no GM tag. Its comment ("A GM tags a skill 'spell' for it to ready the blade") and its desc could say
so; items.ts is outside my files. Its worth does not move (a `used` trigger is weighed at one a round either way).

### 3. The budget is A.6's weight, and A.6's amounts are back

`RULES.fight.keystone.budget` is mark 10, confluence 15, apex 25 (was 2, 3, 4). Each is what A.6's keystones of the tier
weigh as written, by `powersSpend` at the tier's rank: marks Follow Through 10.2, Rally 8.7, Lockdown 11.6; confluences
Executioner 17.8, Vanguard 16.7, Conduit 16.7, Riposte 12.8, Endless Stride 12.4; apexes Undying 24.3, Cataclysm 29.9.
The apex is 25, not the lead's 20: at 20 both apexes A.6 weighs would leave the band, and an apex at two and a half
marks is the ratio A.8 asks (K1's mark gain 3 to 8 points of win share, K8's apex 8 to 15). A point is a stat point's
worth; a rank gives 30, so a mark is a third of a rank of points, a confluence half, an apex most of one.

Every amount is A.6's except these, each moved because it weighed far from its tier (the budget did not move for them):

| Keystone | A.6 | Weighed | Now | Weighs |
|---|---|---|---|---|
| Slip Away | a quarter sooner | 6.5 | a third sooner | 8.6 |
| Unbroken Focus | tenacity 15 | 35 | tenacity 4 | 9.2 + the guard |
| Worldbreaker | double strike, half a bar | 82 | a blow (no damage) that fills half a bar | 22.4 |
| Mind Fortress | tenacity 40 | 103 | tenacity 9 | 23.1 + the dispel |
| Spellblade | half of Power (31 at C, a whole strike) | 171 | an eighth of magic power | 17.8 |
| Blood Magic | drain 10, mana 20 | 44.5 | drain 10, mana 5 | 14.5 |
| Archmage | resist pen 15, cost cut 15% | 40.2 | resist pen 15, cost cut 5% | 14.6 |
| Tactician | on a crit, 15% sooner | 0.6 | on a hit (once a round), 15% sooner | 12.5 |
| Searing Insight | on a crit spell, burn 0.2 mag | 1.4 | on a spell's hit, burn 0.1 mag | 14.2 |

Tactician and Searing Insight moved from a crit to a hit: a crit is 0.05 a round on the bar, and a hasten is at most a
whole turn, so no amount on a crit reaches the band. A keystone that fires once in twenty rounds is also one a table
does not feel. Worldbreaker keeps the half bar, the apex A.7 built its op for, and loses the damage.

The awakened sets are held to the confluence's budget (15), each scaled from the first pass by the budget's factor of
five: Juggernaut heals 14% on a kill (15.2), Riposte's crits strike for 4 times physical power (14.2), Hamstring pushes
the foe's turn back a fifth of a round once a round (16.7), Conduit heals allies 14% on a kill (15.2), Archmage gets
half its turn back when a spell kills, once a round (14.6, one trigger now that `spell` is a tag).

### What I expect K5 to move (a guess from the bar's limits, not a run)

- **Spellblade, down from the bar or up in play.** The bar counts Charged's strike for both its rounds; the cure ends it
  at the first, so it plays about half its 17.8.
- **Searing Insight**, the same way: Seared on each spell's hit refreshes, it does not stack, so it plays under its 14.2.
- **Worldbreaker, Cataclysm**: an active's whole worth is charged, though it takes the turn a strike would have. Both
  likely play under their weight.
- **The crit keystones left on a crit (Bonebreaker, Riposte awakened)**: the bar reads a crit at 0.05 a round; an
  Insight build crits more, so they may play over.
- **The unweighed ones held only from above**: Second Wind and Danger Sense's shields, Juggernaut's -10% taken and +20%
  dealt, Stonewall, Guardian, Sovereign's aura, Afterimage's 20% speed, Momentum, Unyielding Vow, Commander, Puppeteer,
  Deadeye's range, Oathkeeper's aura reach. At the tier's new budgets these sit beside amounts five times the first
  pass's, so they are no longer the strong ones by comparison; the sim decides.
- **Unbroken Focus and Mind Fortress**: tenacity 4 and 9 read small; if the guard and the dispel play weak, K5 may raise
  the tenacity, and the bar will say so.
- **Commander still chains on itself** (point 9 above), within `kit.depth`.

### Calls the owner might have made otherwise (second pass)

- The apex budget at 25, not 20 (above). Undo: `keystone.budget.apex` and cut Undying and Cataclysm into its band.
- `spell` as a tag of a blast and a curse. Undo: `SPELL_TAG` in `tagsOf`, and write each spell keystone twice again.
- Tactician and Searing Insight on a hit, not a crit; Worldbreaker a blow with no damage. Each row says why.

### Principles that changed a choice

- principle-fix-root-causes: the delay's unit was fixed in `worth.ts`'s one reader of a turn's ticks, not by fitting
  the keystones to the wrong weight; and the kind became a tag in `tagsOf`, read where the events are made, not by GM
  tags written onto each keystone ability.
- principle-test-behavior-not-implementation: the worth test's expected value is the rule's ("a speed-100 combatant
  needs `round` ticks for one standard action"), and the trigger test plays a fight where a strike trigger fires on an
  untagged strike and not on a curse.
- principle-explain-the-number: each budget is named with the keystones that set it, and each moved keystone with what
  it weighed before and after.
