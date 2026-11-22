# Notes 11: keystones and mythic encounters (design, no code)

Two designs the owner asked for on Nov 22. Neither changes code. Each ends with its units in build order. The calls
the owner might have made otherwise are in the last section, each with the words that undo it.

His words this serves:

- "be bold my friend, unreasonably ambitious in your game design." "Just remember architecture first. Everything explicit."
- "The stats should be roughly equal in strength, with benefits to pushing towards a single or a few stats in particular
  as a class." "Specializing should pay off for sure."
- "A mythic should be basically impossible to beat, like 5-10% odds for a party of 3."
- "titles/feats should have stat bonuses or extra powers attached to them."
- "Things like lifesteal are ok to be on the stronger side because they should be rare to gain."
- Standing rules: no implicit state machines; adding a feature is easy, with a clear trace from each feature to what it
  depends on; every balance number is a rule with its reason and a bound in the simulation; plain, literal words on screen.

What was read to ground it: `docs/guide/combat.md`, `docs/guide/hunters.md` (stats, the sheet, level),
`features/enemies/item-stats.md` sections 1, 3 and 6, `features/enemies/README.md` item 13, `derive.ts` (how `effExp`
and the sheet read the stats), the `Op` type in `effect-ops.ts`. Nothing else, so a claim about code outside those is
marked "check" where a unit must confirm it.

---

# Design A: keystones (how specialising pays)

## A.1 The problem, measured from the code

Every sheet number reads one stat through one curve (`derive.ts`): `eff(s) = 10 × (s / 10) ^ 0.8` for the powers
(`phys`, `mag`, `sup`, `aim`, `will`), and `capped(above(s))` for the rest. Both bend down, so the tenth point in a
stat buys less than the first. The Rules page says it: points spread over several stats are worth about as much as
points put in one. README item 13 sets two bounds: (i) ten points of any stat are worth about the same, and (ii) a
build that puts its points into one or a few stats beats an even spread at what its class does, by a clear and bounded
margin. Today nothing gives (ii).

## A.2 The idea

**A keystone is a power a body earns when one stat, or two together, hold a large share of the points it spent.**
It is a `Powers` value (`registry/powers.ts`: a worn status with its triggers, and an optional active ability), plus
an optional `bonus`, the same shape items and titles hold. So a keystone is data. It reaches a fight through
`heldPowers` (rows.ts), the one place a row's held powers are read, and reaches the sheet through `bonus`.

There are three tiers:

| Tier | Earned when | At most | Feels like |
|---|---|---|---|
| **Mark** of a stat | rank D or higher, and the stat holds at least 30% of the points spent | 3 (30% × 3 = 90%) | a habit: the stat starts doing something the sheet number cannot |
| **Confluence** of two stats | rank C or higher, both hold at least 25%, and they are the two highest (the job's pair first, A.5) | 1 | a style: Strength with Discipline plays unlike Strength with Agility |
| **Apex** of a stat | rank B or higher, and the stat holds more than 55% | 1 (55% is over half) | a class of its own: one big, visible power |

The curve stays as it is. `effExp` keeps the sheet fair to spread points, so a spread build loses nothing it has
today; keystones are what a focused build gains on top.

What each shape of build earns at rank B or higher:

| Build (share of spent points) | Marks | Confluence | Apex | Count |
|---|---|---|---|---|
| Even over 8 (12.5% each) | 0 | 0 | 0 | 0 |
| Even over 4 (25% each) | 0 | top two | 0 | 1 |
| Three stats (34/33/33) | 3 | top two | 0 | 4 |
| Two stats (60/40) | 2 | the pair | 1 | 4 |
| One stat (100) | 1 | 0 | 1 | 2 |

The two-stat build earns the most keystones; the one-stat build has the biggest sheet number in its stat and the Apex.
Row K7 (A.8) bounds the two against each other so neither shape is the only good one.

### Why "share of points spent", and what it counts

- `share(k) = above(stats[k]) / Σ above(stats[j])`, where `above` is the score less the base (10), and `stats` are the
  allocated stats (`allocated` in progress.ts: confirmed plus pending, so the allocation screen previews a keystone
  before Confirm). A total of 0 spent points earns nothing.
- **Gear, titles, perks and fight statuses never count.** A keystone says how the hunter was built, so it does not
  flicker when a ring comes off or a curse lands. A `stat` op in a fight changes the sheet number, not the keystones.
- The ranks gate the tiers so the first sessions teach the sheet before keystones arrive, and so the words are plain:
  "at rank D", not "at 240 points".
- A row's keystones are read once, when the row is made (`hunterRow`, `monsterRows`), and held for the fight.

**There is no keystone state.** Keystones are a pure function of `(stats, rank, job, chain done)`. Nothing is saved,
so nothing migrates, no machine is needed, and a respec or a GM's stat edit changes them on the next sheet. This is
the explicit choice: the only state is the points, which `progress.ts` already owns.

## A.3 Data shape and where it lives

```ts
// src/core/registry/keystones.ts: every keystone, once.
/** Two stats in STAT_KEYS order: 'str+agi' | 'str+vit' | ... (28 members). Built by a type over STAT_KEYS, so a new stat asks for its pairs. */
export type StatPair = PairOf<typeof STAT_KEYS>;
export type KeystoneKey =
  | { readonly tier: 'mark'; readonly stat: StatKey }
  | { readonly tier: 'apex'; readonly stat: StatKey }
  | { readonly tier: 'confluence'; readonly pair: StatPair };
export type Keystone = Powers & {
  /** What every screen calls it: "Follow Through". */
  readonly name: string;
  /** The one sentence a player reads, in plain words. The ops' own words come from `opLine`. */
  readonly line: string;
  /** Points on BONUS_KEYS, added to the sheet as the `keystone` source; {} for none. */
  readonly bonus: Bonus;
  /** A confluence only: powers added when the hunter's job names this pair and its Job Change chain is done (A.5). */
  readonly awakened: Powers | null;
};
export const KEYSTONES: {
  readonly mark: Readonly<Record<StatKey, Keystone>>;
  readonly apex: Readonly<Record<StatKey, Keystone>>;
  readonly confluence: Readonly<Record<StatPair, Keystone>>;
};
```

The three `Record`s mean the typecheck asks for every stat's Mark and Apex and all 28 confluences. A new stat asks for
its Mark, its Apex and its seven new pairs: adding a stat cannot leave a hole.

```ts
// src/core/hunter/keystones.ts: who earns what. Pure.
export type KeystoneBasis = { readonly stats: Stats; readonly rank: Rank; readonly pair: StatPair | null; readonly awakened: boolean };
/** The keystones a body holds, in a fixed order: marks in STAT_KEYS order, the confluence, the apex. */
export function keystonesOf(b: KeystoneBasis, R: KeystoneRules): readonly KeystoneKey[];
/** For the sheet's words: each stat's share, the next tier it could reach and what it needs (share, rank). */
export function keystoneReach(b: KeystoneBasis, R: KeystoneRules): readonly StatReach[];
```

The rules, each with its reason, in `RULES.fight.keystone` (so a GM override is read in its domain like any rule):

```ts
keystone: {
  // A room's switch (RoomRules, the build switches): off, no body holds a keystone and the sim's old rows hold.
  on: true,
  // At most three stats can hold 30%, so a mark names one of the hunter's few stats, never one of many.
  markShare: real(0.3, 0.2, 0.5, 'the share of spent points that earns a stat its mark: at 0.2 five stats hold one'),
  // A quarter each: two stats holding half the points. Four even stats still earn their top pair.
  pairShare: real(0.25, 0.15, 0.5, 'the share each of two stats needs for their confluence'),
  // Over half, so one stat at most: two stats at 50% earn no apex.
  apexShare: real(0.55, 0.51, 0.9, 'the share that earns an apex: at 0.5 two stats could hold one each'),
  // One power for each rank step after E: the first sessions teach the sheet before keystones arrive.
  markRank: 'D', pairRank: 'C', apexRank: 'B',
  // A normal monster stays quick to run at the table; elites and up carry keystones (A.5).
  monsterKinds: ['elite', 'boss', 'mythic'],
  // What one keystone may spend, in points on the sample wearer of its rank (item-budget.ts `powersSpend`, as a
  // title's band): a mark a rank D title, a confluence a rank C title, an apex a rank A title (titleBudget D 2, C 3, A 4).
  budget: { mark: 2, confluence: 3, apex: 4 },
}
```

## A.4 How it is earned, shown and chosen

**Earned.** By the points, with no tap: crossing a share at a rank earns it, falling back under loses it. Nothing is
chosen except where the build already chooses: the points, and the job (A.5).

**Shown.** All words come from core (`keystoneLines` in `rules-text.ts`, `keystoneReach`); the views lay them out.

- The allocation screen: each stat row says its share, `STR 34 · 31% of your points`. When a pending point crosses
  a share, the Confirm bar says `Confirm to earn Follow Through (Mark of Strength)`. When lowering one drops a share
  under, it says `Confirming loses Follow Through`.
- The sheet: a Keystones section under the stats. Earned ones list their name, tier and line. Under them, the nearest
  one not earned: `Strength holds 27% of your points. At 30% you earn Follow Through.` or
  `Rank C opens your Confluence: Strength and Discipline, Unyielding Vow.`
- The fight: a keystone's worn status is a chip like any worn status, its label the keystone's name, grouped after
  the title's and the items' chips. Its active is a hotbar slot.
- The codex: a Keystones page lists all 44 with the condition for each, so a player can plan a build.
- The Rules page: the sentence on spread points becomes `Points spread over several stats are worth about as much as
  points put in one on the sheet. A stat that holds 30% of the points you spent earns its Mark at rank D. Your two
  highest stats, at 25% each, earn their Confluence at rank C. A stat over 55% earns its Apex at rank B.` Each number
  is read from the rules (`keystoneLines(R)`), so an override changes the words.
- A monster's card and codex entry list its keystones by name, so a party can read "this Ogre has Unbroken".

## A.5 Monsters, jobs and shadows

**Monsters.** `keystonesOf` is the one rule for every body. A monster's stats are its rank's points split 2:1 by its
archetype plus its seed's tweak (`monsterStats`): its main stat holds 67% (Mark and Apex at rank B or higher) and its
second 33% (Mark, and the pair's Confluence at rank C or higher). Only kinds in `monsterKinds` hold them. So an elite
or boss reads as a class too, and the GM sees on its card what it will do. A mythic's script (design B) may name
keystones it does not hold by its stats (`Phase.worn` can be any status), but it never loses its own.

**Jobs.** A job names one pair it leans to (`Job.pair: StatPair` in `registry/jobs.ts`). Two effects, both explicit:

1. When the job's pair qualifies (both at 25%, rank C), it is the hunter's confluence even if two other stats are
   higher. The job is the one choice that bends the rule; ties among other pairs break in `STAT_KEYS` order.
2. When the job's Job Change chain is done, the pair's confluence adds its `awakened` powers. A test asserts every
   pair a job names has `awakened` written; a pair no job names may leave it null.

**Shadows** hold no keystones: an army of ten each with four keystones is forty chips no GM can run.

**Titles and items** are untouched; a title's or item's `stat` bonus never earns a keystone (A.2). A title may still
hold a keystone's status as its own `worn` (the reward editor's library status), which is how a GM gives a hunter a
keystone it did not earn: as a title, weighed by `titleSpend`, never through this rule.

## A.6 The keystones (44)

Each row: the name, the line a player reads, and how it is written in ops that exist today. "Trigger" is a worn
status's trigger (event, limit, `to`, land ops). A tag in a trigger is the ability's kind; **check** that `abilityOf`
puts the kind among an ability's tags; if not, unit K0 does. Three items-stats parts are needed and are not new
here: the events `lowHp` and `imposed` (item-stats 3.1, 3.2) and the key `healPower` (2.1); unit K0 confirms each is
built or builds it first. Two keystones need a new op (A.7), marked **new op**.

Amounts are first guesses, held by the budget test (`budget` above) and the sim rows (A.8), not by feel.

### Marks (rank D, 30% of spent points)

| Stat | Name | What a player reads | How it is written |
|---|---|---|---|
| STR | Follow Through | When your strike downs a foe, you get half your turn back (once a round). | trigger `kill`, tag `strike`, limit round 1, `to: self`: `refund { pct: 50 }` |
| AGI | Slip Away | When a foe's attack misses you, your next turn comes a quarter sooner (once a round). | trigger `avoid`, limit round 1, `to: self`: `hasten { share: 0.25 }` |
| VIT | Second Wind | The first time you fall under 30% HP in a fight, you gain a shield of 25% of your max HP. | trigger `lowHp`, limit fight 1, `to: self`: `shield '0.25 * hpmax'` |
| INS | Read the Opening | A foe you hit is Read for a round: everyone's crits against it come on one more face. | trigger `hitDealt`, `to: other`: `applyStatus` Read (stacking, cap 2, `sheet exposed` 1 a stack, 2 stacks put on: one face), 1 round |
| DIS | Unbroken Focus | Hits cannot break your channels, and control on you is shorter. | worn `channel { mode: 'protect' }`; `bonus: { tenacity: 15 }` |
| PRE | Rally | When you use a support ability, allies within 2 tiles get their next turn 15% sooner. | trigger `used`, tag `support`, `to: { kind: 'area', radius: 2, on: 'allies' }`: `hasten { share: 0.15 }` |
| POW | Arcane Surge | Each hit of magic gives a Surge (up to 5). At 5, your next spell deals 30% more. | stacking Surge (cap 5, leave never, keep fight), trigger `hitDealt` tag `blast` and one tag `curse` add 1; threshold at 5, spend: `applyStatus` Surging (`share dealt +30`, leaves on `hitDealt`) |
| CTL | Lockdown | When you put a harmful status on a foe, its next turn is pushed back a little (once a round). | trigger `imposed`, limit round 1, `to: other`: `delay` 20% of a round's ticks |

### Apexes (rank B, over 55% of spent points)

| Stat | Name | What a player reads | How it is written |
|---|---|---|---|
| STR | Worldbreaker | Once every 4 rounds, Shatter: a strike for double damage that fills half a stagger bar. | active: a strike, formula 2 × the kind's, cooldown 4 rounds, ops `stagger { share: 0.5 }` (**new op**) |
| AGI | Afterimage | You take 20% more turns. When you avoid a hit, foes cannot aim at you until you act. | worn `speed { pct: 20 }` (kept by `speedMax`); trigger `avoid`, `to: self`: `applyStatus` Afterimage (`untargetable`), 1 round |
| VIT | Undying | Once a fight, when you fall under 30% HP, you cannot drop below 1 HP until your next turn ends, and you heal 10% of max HP each round for 3 rounds. | trigger `lowHp`, limit fight 1, `to: self`: `applyStatus` Undying (`invulnerable`, 1 round) and Mending (`heal when: 'turn' '0.1 * hpmax'`, 3 rounds) |
| INS | Foresight | You are never surprised. At the start of each of your turns you gain advantage on your next defence roll. | worn `alert`; trigger `turnStart`, `to: self`: `applyStatus` Foresight (stacking, cap 1, `edge { side: 'defend', keep: 'better', spend: true }`) |
| DIS | Mind Fortress | At the start of each of your turns your oldest harmful status ends. Control on you is much shorter. | trigger `turnStart`, `to: self`: `dispel { which: 'first' }`; `bonus: { tenacity: 40 }` |
| PRE | Sovereign | Allies within 3 tiles of you deal 10% more damage. You can lead one more shadow. | worn `aura { radius: 3, on: 'allies' }` with `share dealt +10`; `bonus: { shadows: 1 }` |
| POW | Cataclysm | Once a fight: a 3-tile blast of magic, and the ground burns for 2 rounds. | active: a blast, radius 3, `uses` fight 1, its `zone` a burning field (`damage magic when: 'turn'`), 2 rounds |
| CTL | Puppeteer | When you put a harmful status on a foe, it also lands on the foe nearest to it, within 2 tiles (once a round). | trigger `imposed`, limit round 1: `echo { radius: 2 }` (**new op**) |

### Confluences (rank C, two highest stats at 25% each)

| Pair | Name | What a player reads | How it is written |
|---|---|---|---|
| STR+AGI | Momentum | Each move gives Momentum (up to 3). Your next strike deals 10% more for each, then it is spent. | stacking Momentum (cap 3, leaves on `hitDealt`), trigger `move` adds 1; `share dealt +10` a stack |
| STR+VIT | Juggernaut | You take 10% less damage. Once you fall under 30% HP you deal 20% more for the rest of the fight. | worn `share taken -10`; trigger `lowHp`, limit fight 1, `to: self`: `applyStatus` Rage (`share dealt +20`, no end) |
| STR+INS | Executioner | Your strikes deal more the lower the foe's HP: up to 40% more on a foe near death. | trigger `hitDealt`, tag `strike`, `to: other`: `damage` physical, the execute family of `scalers.ts` on `0.2 * phys` |
| STR+DIS | Unyielding Vow | Each hit you take gives Resolve (up to 5): 8% more damage and 2 Discipline each. Your next strike spends it all. | stacking Resolve (cap 5, leaves on `hitDealt`), trigger `struck` adds 1; a stack: `share dealt +8`, `stat dis +2` |
| STR+PRE | Warlord | When you down a foe, allies within 3 tiles deal 15% more damage for 2 rounds. | trigger `kill`, `to: area 3 allies`: `applyStatus` Warcry (`share dealt +15`), 2 rounds |
| STR+POW | Spellblade | After you cast a spell, your next strike adds magic damage of half your Power. | trigger `used` tag `blast` (and one for `curse`), `to: self`: `applyStatus` Charged (cap 1, leaves on `hitDealt`, its trigger `hitDealt`, `to: other`: `damage` magic `0.5 * pow`) |
| STR+CTL | Bonebreaker | Your critical strikes break armor: the target loses 15 armor for 3 rounds, stacking twice. | trigger `crit`, tag `strike`, `to: other`: `applyStatus` Broken (cap 2, `sheet armor -15` a stack), 3 rounds |
| AGI+VIT | Endless Stride | The first time you move each round, you heal 4% of your max HP. | trigger `move`, limit round 1, `to: self`: `heal '0.04 * hpmax'` |
| AGI+INS | Riposte | When a foe's attack misses you, you strike back for 40% of your physical power (once a round). | trigger `avoid`, limit round 1, `to: other`: `damage` physical `0.4 * phys` |
| AGI+DIS | Flowing Water | The first time you move each round, your oldest harmful status ends. | trigger `move`, limit round 1, `to: self`: `dispel { which: 'first' }` |
| AGI+PRE | Vanguard | When you move, allies next to you get their next turn 20% sooner (once a round). | trigger `move`, limit round 1, `to: area 1 allies`: `hasten { share: 0.2 }` |
| AGI+POW | Quickcast | Each spell you cast makes you 10% faster for a round, up to 30%. | trigger `used` tag `blast` (and `curse`), `to: self`: `applyStatus` Quickened (cap 3, leaves a stack a round, `speed +10` a stack) |
| AGI+CTL | Hamstring | Your hits slow a foe 15% for a round. A foe slowed three times is rooted. | trigger `hitDealt`, `to: other`: `applyStatus` Hobbled (cap 3, `speed -15` a stack, threshold at 3, spend: `applyStatus` rooted 1 round) |
| VIT+INS | Danger Sense | You are never surprised. When you fall under 30% HP you gain a shield of 20% of max HP and advantage on your next defence roll. | worn `alert`; trigger `lowHp`, limit fight 1, `to: self`: `shield '0.2 * hpmax'`, `applyStatus` Braced (`edge defend better`, spend) |
| VIT+DIS | Stonewall | You take 10% less damage. Each round, the first hit you take gives you a shield of 5% of max HP. | worn `share taken -10`; trigger `struck`, limit round 1, `to: self`: `shield '0.05 * hpmax'` |
| VIT+PRE | Guardian | Allies next to you take 15% less damage. | worn `aura { radius: 1, on: 'allies' }` with `share taken -15` |
| VIT+POW | Blood Magic | You heal 10% of the damage you deal, and you have 20 more mana. | `bonus: { drain: 10, manaMax: 20 }` (lifesteal is rare: a confluence is one of the few ways to get it) |
| VIT+CTL | Briar | A foe that hits you is slowed 20% for a round. | trigger `struck`, `to: other`: `applyStatus` slowed (`speed -20`), 1 round |
| INS+DIS | Stillness | At the end of each turn you gain Stillness: advantage on your next attack. Moving ends it. | trigger `turnEnd`, `to: self`: `applyStatus` Stillness (cap 1, `edge attack better`, spend); trigger `move`, `to: self`: `cureStatus` Stillness |
| INS+PRE | Tactician | When you crit, allies within 3 tiles get their next turn 15% sooner (once a round). | trigger `crit`, limit round 1, `to: area 3 allies`: `hasten { share: 0.15 }` |
| INS+POW | Searing Insight | Your critical spells set the target burning: magic damage each round for 2 rounds. | trigger `crit`, tag `blast` (and `curse`), `to: other`: `applyStatus` Seared (`damage magic when: 'turn' '0.2 * mag'`), 2 rounds |
| INS+CTL | Deadeye | Your ranged abilities reach 2 tiles further, and you crit on one more face. | worn `sheet range 2`, `sheet critFaces 1` |
| DIS+PRE | Oathkeeper | Allies within 2 tiles of you have 10 more Discipline. | worn `aura { radius: 2, on: 'allies' }` with `stat dis +10` |
| DIS+POW | Channeler | Hits cannot break your channels, and a channelled spell deals 20% more. | worn `channel protect`; trigger `used` tag `channel`, `to: self`: `applyStatus` Gathered (`share dealt +20`, leaves on `hitDealt`). **Check** a channel is a tag; if not, Gathered goes on with every `used` and the line says "your next spell" |
| DIS+CTL | Inquisitor | When you put a harmful status on a foe, your oldest harmful status ends (once a round). | trigger `imposed`, limit round 1, `to: self`: `dispel { which: 'first' }` |
| PRE+POW | Conduit | Your heals and shields are 20% stronger, and each support ability you use gives you 10 mana. | `bonus: { healPower: 20 }`; trigger `used` tag `support`, `to: self`: `mana 10` |
| PRE+CTL | Commander | A foe you put a harmful status on takes 10% more damage from everyone for a round. | trigger `imposed`, `to: other`: `applyStatus` Marked (`share taken +10`), 1 round |
| POW+CTL | Archmage | Your spells ignore 15% of resist and cost 15% less. | worn `sheet resistPen 15`, `sheet costCut 0.15` (each within its cap) |

Strength with Discipline (Unyielding Vow) wants to stand and be hit, then answers with one heavy strike. Strength with
Agility (Momentum) wants to move every turn and never stands still. The same Strength score plays two ways.

**Two awakened examples** (the rest are written in unit K2 for the pairs the job list names):

- Unyielding Vow, awakened: Resolve's cap is 8, and at 8 your next strike stuns for half a round (threshold at 8,
  spend: `applyStatus` stunned).
- Momentum, awakened: your strike that spends 3 Momentum hits every foe next to the target (an active: a strike with
  `uses` round 1 and `gate` on Momentum at 3 stacks, blast radius 1 at the target).

## A.7 What needs new code

| Need | Kind | What it is | Who uses it |
|---|---|---|---|
| `stagger` | **new op** (a use op and a land op) | `{ op: 'stagger'; share: number }`: fills `share` of the target's stagger bar, as hits of that size would; a body with no bar ignores it. Capped by a new rule `kit.staggerOpMax` (0.5: "half a bar, so no one op breaks a bar alone"). A mythic's bar takes `mythic.staggerTaken` of it (design B). Its worth in `abilityWorth` is its share times the worth of a break (`worth.ts`) | Worldbreaker; a mythic's telegraph answer (B.4); any GM ability |
| `echo` | **new op** (a land op) | `{ op: 'echo'; radius: number }`: in a trigger raised by `imposed`, the status that raised it goes on the foe nearest the trigger's other body within `radius` tiles that does not hold it, from the same source, for the length it had when put on. A status put by `echo` raises no `imposed`, so it cannot chain (the same rule as `auraOps` leaving out `aura` and `spread`) | Puppeteer; any GM item |
| `keystone` bonus source | sheet.ts `SOURCES` | the keystones' `bonus`, added after the curve as every bonus is | Mark of DIS, Apex of DIS, PRE, Blood Magic, Conduit |
| `keystonesOf`, `keystoneReach` | new pure module | A.3 | the sheet, `heldPowers`, the views |
| `heldPowers` | one line | the keystones' powers after the title's and the items' (each at the body's rank tier) | every row |
| `Job.pair` | a field | A.5 | `keystonesOf` |

42 of the 44 are data on shapes that exist (after item-stats' `lowHp`, `imposed` and `healPower`). Two need a new op.

## A.8 The simulation's bounds

All in `tests/fight-sim.test.ts`, built in `tests/models/fight-sim.ts`, each move logged in `rw/sim-log.md`. Every row
runs at ranks C and S, keystones on. "Win share" is the party's share of wins in the design 6 reference fight of its
rank; "class measure" is: cannon, damage a round; tank, rounds survived against the rank's boss alone; support, HP
healed plus shielded a round; controller, foe turns lost a round; skirmisher, damage a round taken against the
monster's own threat target. A build's points come from the sample builds of the sim at that rank.

| Row | What it checks | Bound | Why this bound |
|---|---|---|---|
| **S1** stat parity | README 13 (i): ten more points of each stat, with keystones off, change win share | each within a quarter of the mean of the eight | the owner: "roughly equal in strength" |
| **K1** mark parity | each Mark added to a build of its class: the gain in win share | each within a quarter of the eight marks' mean; the mean between 3 and 8 points | marks of different stats are worth about the same; a mark is felt but not a rank |
| **K2** specialising pays | Focused (the class's pair at 60/40) against Spread (the same points over 8) at the class measure | Focused ahead by 25% to 60% | the owner: "Specializing should pay off for sure"; the top keeps a spread party in the game |
| **K3** spread is not worthless | a party of two Focused and one Spread against three Focused, win share | the first at least 80% of the second | a player who spreads still helps the table |
| **K4** no mandatory keystone | for each class, its best build with its most-earned keystone taken away, at the class measure | within 15% of its best build | no keystone is a tax every build must pay |
| **K5** no pair breaks a boss | a party of three Focused builds, each pair in turn, against the rank's boss and against each mythic | boss inside design 6's bound; mythic inside B's 5% to 10%; no one keystone moves a mythic's win share more than 3 points | a mythic stays a mythic whatever the party holds |
| **K6** monsters with keystones | design 6's boss and elite rows, re-run with `monsterKinds` on | inside their bounds today | the existing bounds hold when foes earn keystones too |
| **K7** pure against pair | the one-stat build (100) against the two-stat build (60/40) at the class measure | within 20% of each other | neither shape is the only good one |
| **K8** apex parity | each Apex, as K1 | within a third of the eight apexes' mean; the mean between 8 and 15 points | an apex is a class of its own, not a rank |

With `keystone.on: false` every row of today's sim is unchanged; unit K5 asserts it.

Static guard before the sim: `tests/keystones.test.ts` ("every keystone spends within its tier's budget") weighs each
keystone with `powersSpend` (item-stats 6.5) at its tier's rank and asserts it is within `budget` ± 20%. A keystone
over budget fails here before any fight is played.

## A.9 What could go wrong, and the guard for each

| Risk | Guard |
|---|---|
| One keystone every build must take (Second Wind on every tank, Blood Magic on every caster) | row K4; the budget test; a keystone over K4's bound is cut, never the others raised |
| A pair breaks a boss or a mythic (Worldbreaker's stagger plus Puppeteer's echoed stun) | row K5; `kit.staggerOpMax` and `mythic.staggerTaken`; a mythic's phase gate (B.3) holds HP at each threshold whatever the damage |
| Endless sustain (Blood Magic with Undying and Endless Stride) | K5 at the mythic, whose enrage clock (B.3) ends a fight that lasts; drain has no cap by the owner's rule, so the guard is the clock, not a cap |
| Trigger chains (Hamstring's root raising another's `statusGained`, an echo echoing) | the kits' `kit.depth` and `kit.fires` already bound every chain; `echo` raises no `imposed` |
| Keystones flicker in a fight | `keystonesOf` reads allocated points only, never gear or `mods`; the row holds them from joining |
| Elite and boss monsters get much harder at rank B (their 2:1 split earns an apex) | row K6; `monsterKinds` is a rule a GM can set to none |
| Too many chips on a phone | at most 4 keystones a body (A.2's table); their chips are grouped and labelled by keystone name |
| The fight doc grows past `DOC_MAX` | each keystone status's def is sent once in `defs`; the worst-case doc arithmetic in `tests/protocol.test.ts` gains 4 keystone defs for each of the largest party's hunters |
| A GM's rules turn keystones off mid-campaign | nothing is saved; the next sheet has none and the Rules page says so (`keystoneLines` reads `on`) |
| An old save | nothing to migrate: keystones are derived from the points every save already holds |

## A.10 Units of design A, in build order

| Unit | What it builds | Files it may change | Named tests | What a table sees | Model |
|---|---|---|---|---|---|
| **K0** | Confirm or build the parts A needs from elsewhere: `lowHp`, `imposed`, `healPower` (item-stats units), an ability's kind among its tags | per item-stats section 4's units; `registry/ability-kinds.ts` for the tag | the item-stats units' tests; `tests/ability-kinds.test.ts` "an ability's kind is one of its tags" | nothing new | opus |
| **K1** | the rules and the pure rule: `RULES.fight.keystone`, `StatPair`, `keystonesOf`, `keystoneReach`, `Job.pair` | `src/core/rules.ts`, `src/core/hunter/keystones.ts` (new), `src/core/registry/jobs.ts`, `src/core/overrides.ts` (`READERS` for `monsterKinds`) | `tests/keystones.test.ts`: "a stat holding 30% of a rank D hunter's points earns its mark", "an even spread earns none", "no body holds two apexes", "the confluence is the two highest stats", "the job's pair is the confluence when it qualifies", "gear and titles never earn a keystone", "a fight status never changes one"; `tests/rule-domains.test.ts` covers the new domains | nothing yet | opus |
| **K2** | the registry: 44 keystones and the awakened powers for every pair a job names | `src/core/registry/keystones.ts` (new) | `tests/keystones.test.ts`: "every keystone parses as Powers", "every keystone spends within its tier's budget", "every pair a job names is awakened" | nothing yet | opus (the numbers), sonnet may type the rows from A.6 |
| **K3** | the two new ops, `stagger` and `echo` | `src/core/combat/effect-ops.ts`, `fight-parse.ts`, `land.ts`, `resolve.ts`, `worth.ts`, `rules.ts` (`kit.staggerOpMax`), the status maker's op rows (`src/views/maker.js`) | `tests/effect-ops.test.ts` "the stagger op fills half a bar and no more", `tests/triggers.test.ts` "an echoed status lands on the nearest other foe and does not echo again" | a GM can make a status or ability that staggers or echoes | opus |
| **K4** | the rows and the sheet: `heldPowers` adds keystones; monsters of `monsterKinds` hold theirs; the `keystone` bonus source | `src/core/combat/rows.ts`, `src/core/hunter/sheet.ts` | `tests/rows.test.ts` "a hunter's row wears its keystones", "a normal monster holds none"; `tests/sheet.test.ts` "a keystone's bonus is on the sheet" | keystone chips and actives in every fight | sonnet |
| **K5** | the sim rows S1, K1 to K8 and the Focused and Spread builds | `tests/models/fight-sim.ts`, `tests/fight-sim.test.ts`, `docs/agent-handoff/rw/sim-log.md`, `src/core/registry/keystones.ts` (amounts only) | the rows of A.8 by name; "with keystones off the old rows are unchanged" | nothing; the numbers move | opus |
| **K6** | the words and screens: allocation shares and the Confirm line, the sheet's section, the codex page, the Rules page sentence, the room switch | `src/core/rules-text.ts`, `src/core/protocol.ts` (`RoomRules`), `src/views/hunter.js`, the codex view, `src/views/custom.js` | `tests/rules-text.test.ts` "the Rules page states each keystone share from the rules"; `tests/protocol.test.ts` "the room carries the keystone switch"; `tests/e2e/keystones.e2e.ts` "a player who puts a third of their points in Strength reads Follow Through on their sheet", "the Confirm bar says which keystone a point earns" | the whole feature | sonnet |
| **K7** | the fight doc: keystone defs in `defs`, the worst case | `src/core/combat/fight-doc.ts`, `src/core/protocol.ts` | `tests/protocol.test.ts` "the worst-case doc on the wire" with keystones | a player's phone shows its keystone chips | sonnet |

---

# Design B: a mythic as an encounter in phases

What was read for B, beyond A's list: `src/core/combat/` (`fight-types.ts`, `fight.ts` its `TABLE` and `runningState`,
`fight-turn.ts` `startTurn` and `consequences`, `fight-channel.ts`, `row-life.ts`, `resolve.ts` `landUse` and
`staggered`, `land.ts` `channelBreaks`, `effect-ops.ts` the row's kinds, `rows.ts` `staggerOf`, `fight-view.ts`
`intentOf`, `policy.ts`), `rules.ts` `fight.kinds`, `registry/monsters.ts` and `registry/abilities.ts` `MonsterSpec`,
`tests/fight-sim.test.ts` row M1, `docs/guide/machines.md`, `scripts/charts/channel.ts`, balance plan section 4 and
`features/enemies/mythic.json`. A claim about code not in that list is marked **check**.

A name: design A writes `Phase.worn`. `Phase` is already the fight's own type (`fight-types.ts`: setup, running,
ended), and the lint gives each exported type name one meaning, so B's phase is `MythicPhase` and A's `Phase.worn` is
`MythicPhase.worn`. Every promise A makes to B is kept under that name: the gate that holds HP at each threshold
(B.3), the enrage clock (B.3), `mythic.staggerTaken` (B.3, the rules), and the stagger answer to a telegraph (B.4).

## B.1 The problem, from the code

- **A mythic is a bag of HP.** `RULES.fight.kinds.mythic` (rules.ts) is 5.2 bodies of HP, power 2, armor and resist 2,
  a stagger bar of 4 same-rank hits. In a fight it is any monster: `monsterChoice` (policy.ts) uses its intent if the
  GM set one, else its strongest use on the target its threat table suggests. Nothing changes from its first round to
  its last.
- **Its odds sit on a cliff of one number.** Row M1 (`tests/fight-sim.test.ts`) holds 5 to 10% by the HP factor alone.
  The rules' own comment gives the slope: 5.0 bodies won 0.167, 5.1 won 0.110, 5.2 won 0.068, 5.3 won 0.042, "that
  narrow because a 14-round fight between fixed builds averages its dice out". A tenth of a body moves the share by
  about 4 points. One keystone or one item that adds 2% to the party's damage can move a mythic out of its band, and
  A's row K5 allows a keystone at most 3 points.
- **The party has no decision to make.** Against a bag of HP the best play every turn is the most damage. The win is
  decided by the builds before the fight starts.
- **The parts of a plan exist and are not joined.** An intent the GM sets and reveals (`setIntent`, `reveal` in
  fight.ts), a channel that a stun, root, taunt or hard hit breaks (land.ts `channelBreaks`), a stagger bar whose break
  pushes the monster's turn (resolve.ts `staggered`), shields, and areas aimed at a tile that a body can walk out of.
  A mythic uses none of them as a plan.
- **The draft's words have no home.** The 23 rows of `mythic.json` each have an "unbeatable" line ("a countdown to one
  note", "it can dive", "a hunter he names should die"). Balance plan section 4 sends each to a GM note.
- **No mythic is a seed yet.** `SEEDS` in `registry/monsters.ts` holds no row of kind `mythic` (grep finds none); the
  sim's mythic is a brute body of kind mythic with no abilities of its own.

## B.2 The idea

**A mythic is a fight in phases, written as one row of data: a `MythicScript`.** Each phase holds a band of its HP,
what it wears and what it does in a fixed rotation of turns. Once or more a phase it announces a big move a
turn ahead, an **omen**, and the party's answer (a stun, a broken stagger bar, a burst of damage, a step out of the
marked tiles, a shield) decides whether the move lands whole, weakened or not at all.

The parts, each named once:

| Part | What it is | Stored or derived |
|---|---|---|
| **Script** | the data of one mythic's fight: its phases, omens, moves and its balance lever `hp` | data in a registry |
| **Phase** | a band of HP (or a stretch of rounds) with its own worn statuses, acts, rotation, clock and stagger bar size | its index is stored |
| **Gate** | the HP the current phase cannot be pushed below: the next phase's start. Damage past it is lost | derived from the phase and max HP |
| **Held at the gate** | its HP is at the gate. On its next turn it enters the next phase, and that turn is spent | derived from HP |
| **Rotation and beat** | a phase's turns in order: an `act` beat is a normal turn, an `omen` beat announces an omen | the beat's index is stored |
| **Omen** | the announced move, its aim, and the answers that change it | stored while it stands |
| **Answer** | a stun or root or taunt that lands on it, its stagger bar breaking, or a share of its max HP dealt, while the omen stands. Each omen says what each one does: cancel, weaken or nothing. Moving and shields answer by the move's shape | detected by the reducer, never stored |
| **Clock** | the rounds a phase may last. A gate phase past its clock is **enraged**: its rotation becomes the script's enraged rotation (its doom, every other turn). A clock phase (a phase to survive) ends when its clock runs out | the phase's start time is stored; enraged is derived |

Why this holds 5 to 10% better than HP alone: the win is decided by a handful of discrete moments (each omen) that
the party can win or lose, and each is a roll the party can stack in its favour (a stun lands on a Discipline resist
roll; a stagger break needs the big hits saved for it). A party that answers well wins about one fight in ten; a party
that answers nothing wins almost never (row B3, B.8). The script's `hp` is still the one lever the sim moves, but the
share it sets is no longer the only thing a party can change.

The gate is the guard against burst: whatever the damage, a phase is entered and lasts at least one turn of the
mythic, because HP stops at the gate and only the mythic's own turn moves the phase on.

## B.3 The data shape and the machine

### The script, as data

```ts
// src/core/combat/mythic-types.ts: what a mythic's script is. Types only.
export type MythicScriptId = Id<'MythicScriptId'>;
export type OmenKey = Id<'OmenKey'>;
export type MoveKey = Id<'MoveKey'>;

/** One mythic's fight, as data. A new mythic is one of these in `MYTHICS` (registry/mythics.ts) and one test to copy. */
export type MythicScript = {
  readonly id: MythicScriptId;
  /** What the codex and the card call the fight: "The Angel of the Last Trumpet". */
  readonly name: string;
  /** One sentence for the codex: what kind of fight it is ("A countdown: every phase is short, and the clock ends it."). */
  readonly shape: string;
  /** A factor on `fight.kinds.mythic.hp`: the script's one balance lever, moved by the sim until B1 holds (B.8). */
  readonly hp: number;
  /** The moves its omens land, by key. Its act beats use the monster's own abilities (`MythicPhase.acts`). */
  readonly moves: Readonly<Record<MoveKey, MythicMove>>;
  readonly omens: Readonly<Record<OmenKey, Omen>>;
  /** Its phases in order, within `mythic.bounds.phases` (one only for `plain`). The first starts at full HP; the last ends at 0 HP. */
  readonly phases: readonly [MythicPhase, ...MythicPhase[]];
  /** The rotation of any gate phase whose clock ran out: its doom, usually one omen beat. */
  readonly enraged: Rotation;
};

export type MythicPhase = {
  /** "The First Breath": the card's and the log's name of the phase. */
  readonly name: string;
  /** One sentence a player reads when it begins: "It draws breath. It is faster, and the note is closer." */
  readonly line: string;
  /** The share of max HP it begins at: 1 for the first phase; each later phase lower or, after a clock phase, equal. */
  readonly from: number;
  /** How it ends: `gate`, its HP held at the next phase's `from`; `clock`, its clock runs out (a phase to survive). */
  readonly ends: 'gate' | 'clock';
  /** Rounds: a gate phase is enraged past it, a clock phase ends at it. */
  readonly clock: number;
  /** Statuses it wears for the phase (A's `Phase.worn`), put on as the phase begins and taken off as it ends. */
  readonly worn: readonly MythicStatus[];
  /** The names of its own abilities an act beat may use in this phase (the GM's hotbar and the policy's choice); `every`: all of them (the `plain` script). */
  readonly acts: readonly string[] | 'every';
  readonly rotation: Rotation;
  /** The stagger bar's size in this phase, a factor on its kind's bar (`staggerOf`). The bar empties as the phase begins. */
  readonly bar: number;
};
export type MythicStatus = { readonly key: StatusKey; readonly def: StatusDef };
/** A phase's turns, in order, read at `beat` modulo its length. */
export type Rotation = readonly [Beat, ...Beat[]];
export type Beat = { readonly kind: 'act' } | { readonly kind: 'omen'; readonly omen: OmenKey };

/** Who an omen aims at, chosen by the reducer when it is announced (`omenAim`, mythic.ts). Ties go to row order. */
export type OmenAim =
  | 'threat'    // the body its threat table suggests
  | 'weakest'   // the party body up with the lowest share of its max HP
  | 'farthest'  // the party body up farthest from it
  | 'crowd'     // the tile, among the party's tiles, whose area catches the most party bodies
  | 'self'      // its own tile: an area around itself
  | 'all';      // every party body: the move's reach is the whole field, aimed at itself
export type AnswerOutcome = 'cancel' | 'weaken' | 'none';
export type Interrupt = 'hold' | 'root' | 'taunt';
export type Omen = {
  /** The banner's name: "Stars Fall". */
  readonly name: string;
  /** The move that lands when nothing answered it, and the one that lands when it was weakened (null: none can weaken it). */
  readonly full: MoveKey;
  readonly weak: MoveKey | null;
  readonly aim: OmenAim;
  /** A status with one of these ops landing on it while the omen stands (a stun holds, a root roots, a taunt taunts). */
  readonly interrupt: { readonly by: readonly Interrupt[]; readonly outcome: AnswerOutcome };
  /** Its stagger bar breaking while the omen stands. */
  readonly stagger: AnswerOutcome;
  /** This share of its max HP taken from it while the omen stands (HP it healed counts against it). */
  readonly burst: { readonly share: number; readonly outcome: AnswerOutcome } | null;
};

/** A move an omen lands. Built into an `Ability` when the row is made (`mythicMove`), never saved as one. */
export type MythicMove = {
  readonly name: string;
  readonly kind: 'strike' | 'shot' | 'curse' | 'blast';
  readonly type: DamageType;
  /** Tiles: a blast's radius at its aim, or `field`, every tile (with aim `all`). */
  readonly reach: number | 'field';
  /** Tiles from the mythic to its aim. */
  readonly range: number;
  /** Its damage as a share of the sample S hunter's max HP before armor and resist (0: a move of statuses only). */
  readonly hits: number;
  /** Nothing avoids it (`delivery: sure`): only a shield, an HP pool or being out of its reach answers it. */
  readonly sure: boolean;
  readonly applies: { readonly status: BuiltInStatus; readonly rounds: number } | null;
  /** A zone it leaves (`MonsterSpec`'s `leaves`). */
  readonly leaves: { readonly name: string; readonly rounds: number; readonly status: BuiltInStatus } | null;
  /** A status it puts on itself when it lands (a doom's Crescendo, so each one lands harder). */
  readonly self: MythicStatus | null;
};
```

**Why `hits` and not a formula.** A move's size is a design number a GM can read ("60% of an S hunter's HP"), and the
formula is derived from it when the row is made: the move's kind's own formula (`recommended`, as `built` makes a
seed's) times `hits × sampleHp(S) / kindHit`, where `kindHit` is that formula's mean on this mythic's body
(`sameRankHit`'s way, rows.ts). Nothing derived is saved, and a change of the rules moves every move with them.

**Where a script attaches.** `Monster.script: MythicScriptId` (registry/monsters.ts), required when `kind` is
`mythic`; `parseMonster` gives a GM's own mythic with none the script `plain` (B.6). The bestiary maker shows a
"Fight" select with every script's name when the kind is Mythic. A seed's ability that
shares its name with one of the script's moves is the script's: the seed lists it once, as the move, and no phase's
`acts` names it (a test asserts it). A script's `acts` name abilities the monster holds;
`scriptFits(script, monster)` says which are missing and the maker refuses to save a mythic whose script does not fit.

**The rules** (`RULES.fight.mythic`, each with its reason, read in its domain like any rule):

```ts
mythic: {
  // A room's switch (RoomRules, a build switch, as A's keystone.on): off, no row holds a standing, every mythic is
  // today's body, and row M1 is today's. Ships off until unit MY5's rows hold, then on.
  scripts: false,
  // A's promise: the share of a `stagger` op (A.7) a mythic's bar takes. Half: Worldbreaker's half bar is a quarter of
  // a mythic's, so a stagger answer needs the party's hits too, never one ability.
  staggerTaken: real(0.5, 0, 1, 'the share of a stagger op a mythic bar takes: at 1 one op answers an omen alone'),
  // An omen's announce and a phase change each take the mythic's turn: a standard action's time (`paceCost`). The
  // party gets one turn each to answer, and the mythic does nothing else on that turn.
  turnPace: 'standard',
  // The bounds a script is checked against (tests/mythics.test.ts): one to four phases, a clock of
  // 2 to 20 rounds, a burst share of 2% to 20% of max HP, `hits` of 0 to 4 sample hunters.
  bounds: { phases: [1, 4], clock: [2, 20], burst: [0.02, 0.2], hits: [0, 4] },
}
```

### The standing: what a mythic row stores

```ts
// effect-ops.ts, the monster's own fields (SMX-rules-8): a mythic row's standing in its script; null on any other row.
type MonsterOwn = { ...; readonly mythic: MythicStanding | null };   // hunter, shadow, summon: `mythic: null`

/** Where a mythic stands in its script. Only `mythicStep` (mythic.ts) writes it; the lint names the one writer. */
export type MythicStanding =
  | { readonly at: 'calm'; readonly script: MythicScriptId; readonly phase: number; readonly beat: number; readonly since: Tick }
  | { readonly at: 'omen' | 'faltering'; readonly script: MythicScriptId; readonly phase: number; readonly beat: number; readonly since: Tick;
      readonly omen: OmenKey; readonly aim: Place | CombatantId; readonly hpAt: number };
```

- `phase`: the index of the phase it is in. `beat`: the index into the phase's rotation (read modulo its length).
  `since`: when the phase began (a fight time), which the clock counts from; `joined` (fight.ts) moves it as it moves
  a joining row's statuses.
- `omen`, `aim`, `hpAt`: the omen standing, where it was aimed when announced, and the mythic's HP then (the burst
  answer counts from it). They exist only in `omen` and `faltering`.
- **What is not stored, and where it is read:** the gate's HP, whether it is held at the gate, whether its clock ran
  out, whether it is enraged, which rotation and beat come next, which move will land, the answers a player reads, and
  the omen's intent on the card. All are functions of the standing, the script, the row's HP and the fight's `now`, in
  `mythic.ts`. A mythic in `omen` keeps `intent: null`; `intentOf` (fight-view.ts) reads the omen from the standing, so
  the move is never held twice.

### The derived readers (`src/core/combat/mythic.ts`, pure)

| Reader | What it returns |
|---|---|
| `scriptOf(s)` | the script in `MYTHICS` for the standing's id |
| `gateOf(row)` | the HP the gate holds: `ceil(phases[phase + 1].from × hpMax)`; 0 in the last phase and for a row with no standing |
| `heldAtGate(row)` | its phase ends by `gate`, it is not the last, and its HP is at or under `gateOf(row)` |
| `clockOut(row, now)` | `now ≥ since + clock × round` |
| `phaseOver(row, now)` | a gate phase: `heldAtGate`; a clock phase: `clockOut` |
| `enraged(row, now)` | a gate phase with `clockOut` |
| `beatOf(row, now)` | `rotation[beat mod length]`, the rotation the script's `enraged` when `enraged`, else the phase's |
| `landingMove(row)` | `omen`: the omen's `full`; `faltering`: its `weak`; else null |
| `omenAim(rule, row, fight)` | the aim of B.3's `OmenAim`, ties to row order |
| `answerMet(before, after, omen)` | which answers a change met: an interrupt status new on it, its bar broken, the burst share reached; cancel first |

### The gate, in the one writer of a row's life

`rowLifeAfter` (row-life.ts) is the one function that changes a row's HP: a hit, an op's damage, a per-round status, a
zone, the GM's hand edit. The gate goes there and nowhere else:

- `foeLifeAfter(life, event, hpMax, floor)` gains `floor`, which `rowLifeAfter` reads from `gateOf(row)` (0 for every
  row that is not a mythic, so every other row is as today).
- `damage` and `setHp` land at `max(floor, hp − n)` while the life is up and above the floor. A row at its floor takes
  no damage. The damage past the gate is lost: it does not carry into the next phase.
- `heal`, `revive` and `maxChanged` are as today. A heal lifts it off the gate (the burst answer counts the heal
  against the party too).
- What follows from the HP the hit took (checked in resolve.ts `landUse`): lifesteal reads `before − rowHp(after)`, so
  damage the gate held drains nothing. The stagger bar fills from `hpDamage`, the hit's damage before the life clamps
  it (resolve.ts `staggered` is called with `hpDamage`, not with the HP lost), so hits on a mythic held at its gate
  still fill its bar. Both are kept as they are; B adds no rule to either.
- The log says it once, when a change takes it to the gate: `The Angel of the Last Trumpet is held at the gate.`

### The machine: `MYTHIC_TABLE` (mythic.ts)

**States** (stored, `MythicStanding.at`):

| State | Means |
|---|---|
| `calm` | in its phase, no omen standing |
| `omen` | an omen is announced and stands; it lands whole on its next turn unless answered |
| `faltering` | an omen stands and was weakened; its weak move lands on its next turn unless cancelled |

Marks read beside the state, never stored: **held** (`heldAtGate`), **enraged** (`enraged`), and the row's life
(**dead** is the life's state, `row-life.ts`, not the script's).

**Events** (`MythicEvent`; `MYTHIC_EVENTS` lists every type):

| Event | Raised by, and when |
|---|---|
| `next { now, by: 'turn' \| 'gm' }` | `startTurn` (fight-turn.ts): its turn starts and `phaseOver`; or the GM's Next phase (`mythic` command) |
| `announce { omen, aim, hpAt }` | `startTurn`: its turn starts in `calm` on an omen beat |
| `beat` | `startTurn`: its turn starts in `calm` on an act beat |
| `cancel { how }` | `consequences` (fight-turn.ts): a change met an answer whose outcome is `cancel` |
| `weaken { how }` | `consequences`: a change met an answer whose outcome is `weaken` |
| `land` | the reducer's `act` in the running state `landing`: the landing move went off |
| `fizzle` | the same `act`, when the move cannot reach its aim (the aimed body is gone, or out of range): nothing lands |
| `drop` | the GM's Drop the omen (`mythic` command) |

`how` is `'interrupt' | 'stagger' | 'burst'`, for the log's words only.

**The table** (state by event: the next standing; `refused` with its reason, the standing unchanged):

| From | `next` | `announce` | `beat` | `cancel` | `weaken` | `land` | `fizzle` | `drop` |
|---|---|---|---|---|---|---|---|---|
| `calm` | `calm`, phase + 1, beat 0, since now | `omen` with its omen, aim, hpAt | `calm`, beat + 1 | refused `noOmen` | refused `noOmen` | refused `noOmen` | refused `noOmen` | refused `noOmen` |
| `omen` | `calm`, phase + 1, beat 0, since now (the omen is lost) | refused `omenStands` | refused `omenStands` | `calm`, beat + 1 | `faltering` | `calm`, beat + 1 | `calm`, beat + 1 | `calm`, beat + 1 |
| `faltering` | `calm`, phase + 1, beat 0, since now (the omen is lost) | refused `omenStands` | refused `omenStands` | `calm`, beat + 1 | refused `weakened` (a second weaken does nothing) | `calm`, beat + 1 | `calm`, beat + 1 | `calm`, beat + 1 |

And one refusal that is the script's, not the state's: `next` in the last phase is refused `lastPhase` (it ends by
its HP reaching 0). `mythicStep(s, e)` returns the standing or `Refused<MythicRefusal>` (save-step.ts `refuse`, as
`restStep` does), and `mythicCan(s, type)` answers a view before it shows a button.

**What `next` does besides the standing** (fight-turn.ts `phased`, the one place, called for both `by` values): the
old phase's worn statuses come off by key and the new phase's go on (statuses that are not the script's, its
keystones among them, are never touched: A.5 "it never loses its own"); the stagger bar empties and its max is
`staggerOf(body).max × phase.bar`; its channel drops; with `by: 'gm'`, its HP comes down to the new phase's
`from × hpMax` if it is higher (through `rowLifeAfter` `setHp`, whose floor is now the new gate). With `by: 'turn'` the
turn is spent (`turnPace`). The effect `{ type: 'phased'; id; phase }` lets the screens mark it.

**Its turn start, in order** (`startTurn`, for a mythic row with a standing, on a turn it takes: after a held turn is
passed, so a stunned mythic does nothing here). The first that applies:

1. `phaseOver` and not the last phase: `next { by: 'turn' }`, the turn is spent, logged
   `The Angel of the Last Trumpet enters The First Breath.`
2. `omen` or `faltering`: no event. The fight's running state is `landing` (below) until the move goes off.
3. `beatOf` is an omen beat: `announce` with `omenAim` and its HP now; the turn is spent; logged
   `The Angel of the Last Trumpet readies Stars Fall: it lands on its next turn.` When the beat came from the enraged
   rotation the line begins `… is enraged:`. The effect `{ type: 'omen'; id; omen }` lets the screens mark it.
4. Else: `beat`, and the turn goes on as any monster's.

**Its answers, in `consequences`** (fight-turn.ts, the place every change of a row is turned into effects and
follow-ups): for each mythic row in `omen` or `faltering`, `answerMet(before, after, omen)` and, for each answer met
whose outcome is not `none` and that its state takes (`mythicCan`), `cancel` before `weaken`. A cancel logs
`Mira's stun answers Weighed and Found Wanting: it is cancelled.`; a weaken logs `… it will land as Found Wanting.`
The effect `{ type: 'answered'; id; how; outcome }` lets the screens mark it.

### The fight's own table gains a running state and a command

- `RunningState` (fight.ts) gains `{ at: 'landing'; id }`: read from the fight, as `owing` is. The order is `owing`
  (dice first), then `landing` (the current row is a mythic in `omen` or `faltering`), then `acting`.
- The `landing` row of `TABLE`: `act` is `landOmen`, which takes only the landing move at the stored aim (any other
  ability or aim is refused `omenDue`), and is not bound by a taunt (a taunt answers an omen only where its
  `interrupt.by` names `taunt`). When `ready` refuses it for `noTarget` or `range` the omen fizzles: the turn is
  spent and logged `Named in the Book finds no one.` `move`, `endTurn`, `release` and `setIntent` are `null` there.
  Every other cell is `acting`'s.
- A new command, the GM's: `{ type: 'mythic'; by: CombatantId; step: 'drop' | 'next' }`, in `setup` (refused there
  `notNow` for both: a script starts when the fight does) and in every running row. Refused `notMythic` on a row with
  no standing, and with the machine's reasons. `setIntent` on a mythic with an omen standing is refused `omenStands`.
- Refusals added to `Refusal`: `notMythic`, `noOmen`, `omenStands`, `omenDue`, `lastPhase`, `weakened`.
- A mythic row is made (`monsterRows`, rows.ts) in `calm`, phase 0, beat 0, since 0, wearing phase 0's statuses and
  its bar at phase 0's size, when `mythic.scripts` is on.
- **The omen moves are not on the row.** `landOmen`, `intentOf` and the policy build the landing move from the script
  when they need it (`mythicMove`), so a move is never saved and never counts against `MAX_ABILITIES` (12: the
  Angel's seven moves beside its own abilities and its archetype's attack would come near it, and a GM's mythic with
  more abilities would pass it). Its id is
  `mythic-<move key>`, which no seed ability's slug starts with (a test asserts it).

### The chart

`scripts/charts/mythic.ts` walks `mythicStep` breadth first from `calm` over every event, with a two-phase script
whose phase 0 rotation is `[act, omen]`, as `scripts/charts/channel.ts` walks a channel; an entry in `MACHINES`
(`scripts/statecharts.ts`); a line in `docs/guide/machines.md` under The fight: "a mythic's standing in its script
(`combat/mythic.ts`)". Its box words: `calm` "In its phase", `omen` "Omen announced", `faltering` "Omen weakened".

## B.4 Telegraphs: the omen and the party's answer

**The timing.** An omen is announced at the start of one of the mythic's turns, and that turn is spent announcing it.
It lands as the mythic's next turn. Between the two, every body of the party with a speed near the mythic's gets about
one turn: that turn is the answer. A mythic made faster by its phase (Drawn Breath, +20% speed) gives the party less
of a round, which is the point of that phase.

**The answers.** Five, and an omen's data says what the first three do (`cancel`, `weaken` or `none`). The other two
come from the move's shape, so the words for them are read from the move and never typed twice.

| Answer | What the party does | What the code checks, and where | What it changes |
|---|---|---|---|
| **Interrupt** | lands a status with a `hold` (Stunned, Paralyzed), a `root` (Restrained, Paralyzed) or a `taunt` op on the mythic | `answerMet`: a status on it after the change, not before, with an op in `omen.interrupt.by` (in `consequences`) | the omen's `interrupt.outcome`. Its tenacity shortens the status, but landing it is the answer. Its Discipline resists a curse: this roll is where most of the odds live |
| **Stagger** | breaks its stagger bar: big hits saved for the omen, the `stagger` op (A.7) at `mythic.staggerTaken` of its share | the same test `consequences` already makes for the `staggered` effect: the bar's `max` grew | the omen's `stagger` outcome. The break also pushes its turn `staggerCost` rounds (resolve.ts), so even an outcome of `none` buys the party time |
| **Burst** | takes `burst.share` of its max HP from it while the omen stands | `hpAt − hp ≥ share × hpMax`, after the change | the omen's `burst` outcome. Heals on the mythic count against it. HP the gate held does not count, because the HP did not move |
| **Move** | steps out of the marked tiles, or out of a single-target move's range | none of its own: a blast aimed at a tile catches whoever stands in its area when it lands (resolve.ts `landUse` reads the bodies' places at the use); a body out of range makes the landing `fizzle` | an area move lands on fewer bodies; a single-target one finds no one |
| **Shield** | puts a shield on the bodies it will hit | none of its own: `throughShield` (land.ts) takes damage first | the damage that reaches HP |

An omen that is not `sure` is also dodged or resisted as any use (`whereItEnds`, `resists`); its banner says so.

**How answers add up** (all in `MYTHIC_TABLE`, nowhere else):

- A cancel ends the omen: nothing lands, and the mythic's next turn is its next beat.
- A weaken moves it to `faltering`: the omen's `weak` move lands in place of its `full` one. A second weaken does
  nothing (refused `weakened`). A cancel still ends a weakened omen.
- When one change meets two answers, cancel is taken first; the weaken that follows is refused, which is correct.
- An answer after the move landed counts for nothing: the omen is gone.
- **The gate is also an answer.** Pushing the mythic to its gate while an omen stands means its next turn is the
  phase change, and the omen is lost (`next` from `omen`). Most phases open with their own omen, so this trades the
  standing omen for the next phase's first.
- Some omens are answered only by where a body stands or by a shield (Zaratan's Sinking); that is the script's
  choice. A test asserts that every omen in a phase's rotation can be answered: one of its outcomes is not `none`, or
  its move can be walked out of (its reach is not `field`) or dodged (it is not `sure`). Only the enraged rotation may
  hold an omen nothing answers: that is the doom.

**What the simulation and the odds engine do** (`policy.ts`, the one policy both run, so the GM's odds read the
script too):

- The mythic: in `landing`, the landing move at its aim; on an act beat, `monsterChoice` limited to the phase's
  `acts`. The announce and the phase change are the reducer's and need no choice.
- The party: a new `answerChoice`, tried before `partyChoice` when an omen stands. In order: step out of the omen's
  area if the body stands in it and can; use an ability whose status holds, roots or taunts, where the omen's
  interrupt names that op and its outcome is not `none`; while the stagger answer is not `none` and the bar is at
  least half full, the strongest hit on the mythic; while the burst answer is not `none`, the strongest hit on it; a
  support shields the body a single-target omen aims at, or the most hurt body in an area omen. Else `partyChoice`.
- Row B3 (B.8) also plays a party with `answerChoice` turned off, so the share answering adds is a number.

**The GM's hand.** The GM may drop a standing omen (a map with no room to move out, a rule the table forgot) and may
move the mythic to its next phase. Both are logged, and both are the same events the reducer raises, so the machine
has no second path.

## B.5 What a GM and a player see, at 390 px

All words come from core (`mythicView` in `fight-view.ts`, `mythicLines` in `rules-text.ts`); the views lay them out.
Numbers in the words are read from the script and the rules, so a change of either changes the words.

**The mythic strip** (every phone, pinned above the turn order while a mythic with a standing is in the fight, four
lines at most):

```
The Angel of the Last Trumpet
Phase 2 of 3: The First Breath
HP 58% · gate at 30%                 (the HP bar with a notch at the gate)
Clock: 3 rounds left
```

Its third and fourth lines change with the marks:

| Mark | Line 3 | Line 4 |
|---|---|---|
| held at the gate | `HP 30% · held at the gate` | `Its next turn starts phase 3: The Note.` |
| enraged | `HP 22% · last phase` | `Enraged: The Final Note every other turn.` |
| a clock phase | `HP 55% · damage does not reach it` | `Survive 2 more rounds.` |
| the last phase | `HP 22% · last phase` | `Clock: 1 round left` |

When a phase begins, the strip shows the phase's `line` under it until the mythic's next turn:
`It draws breath. It is faster, and the note is closer.`

**The omen banner** (every phone, under the strip, while an omen stands; the danger colour on its left edge):

```
OMEN: Weighed and Found Wanting
Lands on its next turn, on Mira.
Answer it:
- Stun or root it: cancels it
- Take 5% of its HP before it lands (2% so far): weakens it
- Dodge it or resist it as any attack
- A shield takes it first
```

- The second line by aim: `on the marked tiles` (`crowd`, `self`), `on Mira` (`threat`, `weakest`, `farthest`), `on
  everyone` (`all`).
- The interrupt line names its ops in plain words: hold `Stun`, root `root`, taunt `taunt` ("Stun, root or taunt it").
  An outcome of `none` has no line.
- The stagger line reads `Break its stagger bar (now 62%): cancels it`.
- A move that is `sure` has `Nothing dodges it.` in place of the dodge line.
- An area move adds `Step out of the marked tiles.`
- Weakened: the first line is `OMEN, WEAKENED: Weighed and Found Wanting` and the second `Lands as Found Wanting on
  its next turn, on Mira.`
- Answered with a cancel, until the mythic's next turn: `Cancelled: Mira's stun stopped Weighed and Found Wanting.`
- From the enraged rotation the first line is `DOOM: The Final Note`.

**A player's own phone adds two things:**

- On the player's own card: `You are in the marked tiles.` or `Weighed and Found Wanting is aimed at you.`
- Under each hotbar ability that answers the standing omen, a tag: `Answers the omen: cancels it` or `Answers the omen:
  weakens it` (`answersBy(ability, omen)`: an ability whose status has an op the interrupt names, a `stagger` op when
  the stagger answer is not `none`). A player sees which tap matters without reading the banner.

**The GM's phone adds:**

- The turn panel in `landing`: the title `The Angel of the Last Trumpet's turn: the omen lands.`, and two buttons,
  `Land Weighed and Found Wanting` (its dice are rolled as for any use) and `Drop the omen`.
- On an act beat, above the hotbar (which holds only the phase's acts): `Next omen: Stars Fall, in 2 turns.`
- The strip's More button holds `Next phase`, which asks `Move The Angel of the Last Trumpet to The Note now? Its HP
  drops to 30%.` with `Move it` and `Cancel`.
- The toasts: `The Angel of the Last Trumpet readies Stars Fall.`, `Phase 2: The First Breath.`, `Cancelled by Mira's
  stun.`

**The map:** an area omen's tiles in the danger tint with a dashed edge and the omen's name on its centre tile; a
single-target omen draws a ring on the aimed token. Both go when it lands, fizzles or is cancelled.

**The log** (exact lines; names filled in):

- `The Angel of the Last Trumpet readies Stars Fall: it lands on its next turn.`
- `The Angel of the Last Trumpet is enraged: The Final Note lands on its next turn.`
- `The Angel of the Last Trumpet is held at the gate.`
- `The Angel of the Last Trumpet enters The First Breath.`
- `Mira's stun answers Weighed and Found Wanting: it is cancelled.` / `Ren's blow breaks its stagger: Stars Fall is
  cancelled.` / `The party's damage answers The First Breath: it will land as Half a Breath.`
- `Stars Fall lands.` / `Named in the Book finds no one.` / `The GM drops Stars Fall.`

**The Rules page** (`mythicLines(R)`): `A mythic fights in phases. Each phase holds part of its HP: damage past it is
lost, and the next phase starts on the mythic's next turn. Before its biggest moves it announces an omen one turn
ahead. A stun, a broken stagger bar, enough damage, a step out of the marked tiles or a shield can stop it or make it
smaller. A phase that runs past its clock makes the mythic enraged.`

**The codex** entry of a mythic adds `The fight: <shape>` and its phases, each `Phase 1: The Trumpet Raised. <line>`.
**The room's Custom rules** add the switch `Mythics fight in phases`, on or off.

## B.6 Three example mythics, written whole

Each is one row of `MYTHICS` (`src/core/registry/mythics.ts`) for a row of `mythic.json`, which becomes a seed of kind
`mythic` naming its script. The three have different shapes: a **countdown** (the clock is the fight), **the ground**
(where a body stands is the fight, and one phase can only be survived), and **the names** (one hunter at a time is
marked to die). Every `hits` is a first guess at a share of the sample S hunter's max HP before armor and resist; every
`hp` is a first guess the sim moves (B.8). `act` and `omen x` below stand for `{ kind: 'act' }` and
`{ kind: 'omen', omen: 'x' }`. Status defs are written in ops that exist (`speed`, `share`, `sheet`; a stacking def's
`stack` rule as kits design 1.1 has it).

Two worn statuses and one self status are shared by name across scripts, each written once at the top of the file:

```ts
const drawn = (pct: number, name: string): MythicStatus => ({ key: sk(`mythic-${slug(name)}`), def: { label: name, desc: `Acts ${pct}% faster.`, ops: [{ op: 'speed', pct }] } });
const fury = (pct: number, name: string): MythicStatus => ({ key: sk(`mythic-${slug(name)}`), def: { label: name, desc: `Deals ${pct}% more damage.`, ops: [{ op: 'share', on: 'dealt', pct }] } });
/** Put on itself by each doom that lands, so the next lands harder: a fight past its clock ends. */
const CRESCENDO: MythicStatus = { key: sk('mythic-crescendo'), def: { label: 'Crescendo', desc: 'Each stack: 50% more damage.',
  ops: [{ op: 'share', on: 'dealt', pct: 50 }], stack: { cap: 10, leave: { kind: 'never' }, keep: 'fight' } } };
```

Every worn key starts `mythic-`, so no hunter's `cureStatus` names one by chance (**check** that no shipped ability
cures by a key that starts so; `dispel` takes harmful statuses only, effect-ops.ts `dispelled`, and these are not).

### 1. The Angel of the Last Trumpet: the countdown

"The fight should be a countdown to one note that ends it, with no way to survive the note."

```ts
{
  id: 'angel-of-the-last-trumpet', name: 'The Angel of the Last Trumpet', hp: 0.85,
  shape: 'A countdown: every phase is short, and when a clock runs out the Final Note comes every other turn.',
  moves: {
    'stars-fall':   { name: 'Stars Fall', kind: 'blast', type: 'magical', reach: 2, range: 12, hits: 0.55, sure: false,
                      applies: { status: 'burning', rounds: 2 }, leaves: { name: 'Fallen stars', rounds: 2, status: 'burning' }, self: null },
    'weighed':      { name: 'Weighed and Found Wanting', kind: 'curse', type: 'magical', reach: 0, range: 24, hits: 0.35, sure: false,
                      applies: { status: 'paralyzed', rounds: 2 }, leaves: null, self: null },
    'found-wanting':{ name: 'Found Wanting', kind: 'curse', type: 'magical', reach: 0, range: 24, hits: 0.2, sure: false,
                      applies: { status: 'slowed', rounds: 2 }, leaves: null, self: null },
    'first-breath': { name: 'The First Breath', kind: 'blast', type: 'magical', reach: 4, range: 0, hits: 0.7, sure: false,
                      applies: { status: 'prone', rounds: 1 }, leaves: null, self: null },
    'half-breath':  { name: 'Half a Breath', kind: 'blast', type: 'magical', reach: 4, range: 0, hits: 0.35, sure: false,
                      applies: null, leaves: null, self: null },
    'final-note':   { name: 'The Final Note', kind: 'blast', type: 'magical', reach: 'field', range: 0, hits: 1.6, sure: true,
                      applies: { status: 'stunned', rounds: 1 }, leaves: null, self: CRESCENDO },
    'broken-note':  { name: 'The Broken Note', kind: 'blast', type: 'magical', reach: 'field', range: 0, hits: 0.7, sure: true,
                      applies: null, leaves: null, self: CRESCENDO },
  },
  omens: {
    stars:   { name: 'Stars Fall', full: 'stars-fall', weak: null, aim: 'crowd',
               interrupt: { by: [], outcome: 'none' }, stagger: 'cancel', burst: null },
    weighed: { name: 'Weighed and Found Wanting', full: 'weighed', weak: 'found-wanting', aim: 'threat',
               interrupt: { by: ['hold', 'root'], outcome: 'cancel' }, stagger: 'none', burst: { share: 0.05, outcome: 'weaken' } },
    breath:  { name: 'The First Breath', full: 'first-breath', weak: 'half-breath', aim: 'self',
               interrupt: { by: ['hold'], outcome: 'weaken' }, stagger: 'cancel', burst: { share: 0.06, outcome: 'weaken' } },
    note:    { name: 'The Final Note', full: 'final-note', weak: 'broken-note', aim: 'all',
               interrupt: { by: [], outcome: 'none' }, stagger: 'weaken', burst: null },
  },
  phases: [
    { name: 'The Trumpet Raised', line: 'It lifts the trumpet. Each phase is short: when a clock runs out, the Final Note begins.',
      from: 1, ends: 'gate', clock: 5, worn: [], bar: 1,
      acts: ['Roll Up the Sky', 'Appointed Hour'], rotation: [act, omen stars, act, omen weighed] },
    { name: 'The First Breath', line: 'It draws breath. It is faster, and the note is closer.',
      from: 0.65, ends: 'gate', clock: 4, worn: [drawn(20, 'Drawn Breath')], bar: 1.25,
      acts: ['Roll Up the Sky', 'Appointed Hour'], rotation: [omen breath, act, omen weighed, act] },
    { name: 'The Note', line: 'The trumpet sounds. Break its stagger bar to make the note smaller.',
      from: 0.3, ends: 'gate', clock: 3, worn: [drawn(20, 'Drawn Breath'), fury(25, 'Last Hour')], bar: 0.75,
      acts: ['Roll Up the Sky'], rotation: [act, omen note] },
  ],
  enraged: [omen note],
}
```

How it goes: phase 1 teaches the two answers (move out of Stars Fall or break the bar; stun the Weighing or burst it
small) with a five-round clock that a party which only deals damage will miss. Phase 2 is faster and opens on The
First Breath around itself, which ranged hunters walk away from and the tank weakens with a stun. Phase 3 is the note:
three rounds, a smaller bar, and the Final Note every other turn, which only a broken bar makes survivable. A party
that saved its stagger for the note and its stuns for the Weighing wins; one that reached phase 3 late hears the
note twice with Crescendo between.

### 2. Zaratan, the Island That Wakes: the ground

"The hunters stand on it, so it should be able to end the fight by going under."

```ts
{
  id: 'zaratan-the-island-that-wakes', name: 'Zaratan, the Island That Wakes', hp: 0.9,
  shape: 'The ground: each Sinking floods tiles for the rest of the fight, and in the Dive it can only be survived.',
  moves: {
    'sinking':   { name: 'Sinking of the Shore', kind: 'blast', type: 'physical', reach: 3, range: 10, hits: 0.5, sure: false,
                   applies: { status: 'prone', rounds: 1 }, leaves: { name: 'Rising sea', rounds: 20, status: 'slowed' }, self: null },
    'rising':    { name: 'The Sea Rises', kind: 'blast', type: 'physical', reach: 2, range: 16, hits: 0.4, sure: false,
                   applies: null, leaves: { name: 'Rising sea', rounds: 20, status: 'slowed' }, self: null },
    'trench':    { name: 'Breath of the Deep Trench', kind: 'blast', type: 'magical', reach: 2, range: 16, hits: 0.75, sure: false,
                   applies: { status: 'stunned', rounds: 1 }, leaves: null, self: null },
    'spray':     { name: 'Spray of the Trench', kind: 'blast', type: 'magical', reach: 2, range: 16, hits: 0.35, sure: false,
                   applies: null, leaves: null, self: null },
    'go-under':  { name: 'It Goes Under', kind: 'blast', type: 'physical', reach: 'field', range: 0, hits: 1.4, sure: true,
                   applies: { status: 'prone', rounds: 1 }, leaves: null, self: CRESCENDO },
  },
  omens: {
    sinking: { name: 'Sinking of the Shore', full: 'sinking', weak: null, aim: 'crowd',
               interrupt: { by: [], outcome: 'none' }, stagger: 'none', burst: null },
    rising:  { name: 'The Sea Rises', full: 'rising', weak: null, aim: 'crowd',
               interrupt: { by: [], outcome: 'none' }, stagger: 'none', burst: null },
    trench:  { name: 'Breath of the Deep Trench', full: 'trench', weak: 'spray', aim: 'farthest',
               interrupt: { by: ['hold', 'root', 'taunt'], outcome: 'cancel' }, stagger: 'weaken', burst: { share: 0.06, outcome: 'weaken' } },
    under:   { name: 'It Goes Under', full: 'go-under', weak: null, aim: 'all',
               interrupt: { by: [], outcome: 'none' }, stagger: 'none', burst: null },
  },
  phases: [
    { name: 'The Shore', line: 'The island stirs. Where it sinks, the sea stays.',
      from: 1, ends: 'gate', clock: 6, bar: 1,
      worn: [{ key: sk('mythic-shell'), def: { label: 'Shell of a Thousand Years', desc: '30 more armor.', ops: [{ op: 'sheet', key: 'armor', amount: 30 }] } }],
      acts: ['Jaws Like a Harbour', 'Shell of a Thousand Years'], rotation: [act, act, omen sinking] },
    { name: 'The Dive', line: 'It dives. Damage does not reach it under the waves. Survive, and keep off the rising sea.',
      from: 0.55, ends: 'clock', clock: 3, worn: [], bar: 1,
      acts: [], rotation: [omen rising] },
    { name: 'The Island Wakes', line: 'It surfaces, awake. The shore is smaller now.',
      from: 0.55, ends: 'gate', clock: 7, bar: 1,
      worn: [{ key: sk('mythic-shell'), def: { label: 'Shell of a Thousand Years', desc: '30 more armor.', ops: [{ op: 'sheet', key: 'armor', amount: 30 }] } },
             fury(20, 'Waking')],
      acts: ['Jaws Like a Harbour', 'Shell of a Thousand Years'], rotation: [act, omen trench, act, omen sinking] },
  ],
  enraged: [omen under],
}
```

The Dive needs no new rule: it is a clock phase whose `from` equals the next phase's, so its gate is its own HP and
no damage moves it (B.3, the gate). Hits still fill the bar, so a party may enter phase 3 with the bar half full for
the Trench. **Check** that a zone of 20 rounds is within the zones' limits (`zones.ts`); if not, the Rising sea lasts
the longest a zone may, and the script's line says "for a long time" in place of "stays".

How it goes: the fight is where the party stands. Each Sinking leaves Rising sea on its tiles for the rest of the
fight, so the party that clumps loses the dry ground. The Dive is three rounds of The Sea Rises with nothing to hit,
only room to keep. Phase 3 has less ground, more damage, and the Trench aimed at whoever stands farthest (the ranged
hunters), which a stun, root or taunt cancels. The clock of phase 3 is the longest (7 rounds) because the ground left
is the hard part.

### 3. The Fourth Rider: the names

"A hunter he names should die unless something outside the rules prevents it."

```ts
{
  id: 'the-fourth-rider', name: 'The Fourth Rider', hp: 0.85,
  shape: 'The names: he marks one hunter at a time to die, and the party saves them or loses them.',
  moves: {
    'named':      { name: 'Named in the Book', kind: 'curse', type: 'magical', reach: 0, range: 24, hits: 1.1, sure: true,
                    applies: null, leaves: null, self: null },
    'struck':     { name: 'Struck from the Book', kind: 'curse', type: 'magical', reach: 0, range: 24, hits: 0.45, sure: true,
                    applies: { status: 'frightened', rounds: 2 }, leaves: null, self: null },
    'pale-wake':  { name: 'Pale Wake', kind: 'blast', type: 'magical', reach: 2, range: 12, hits: 0.3, sure: false,
                    applies: { status: 'plague', rounds: 3 }, leaves: { name: 'Pale wake', rounds: 3, status: 'plague' }, self: null },
    'all-end':    { name: 'All Things End', kind: 'blast', type: 'magical', reach: 'field', range: 0, hits: 0.55, sure: true,
                    applies: { status: 'frightened', rounds: 2 }, leaves: null, self: null },
    'not-all':    { name: 'Not Yet, Not All', kind: 'blast', type: 'magical', reach: 'field', range: 0, hits: 0.25, sure: true,
                    applies: null, leaves: null, self: null },
    'reaping':    { name: 'The Reaping', kind: 'curse', type: 'magical', reach: 0, range: 24, hits: 2.5, sure: true,
                    applies: null, leaves: null, self: CRESCENDO },
  },
  omens: {
    named:   { name: 'Named in the Book', full: 'named', weak: 'struck', aim: 'weakest',
               interrupt: { by: ['hold', 'root'], outcome: 'cancel' }, stagger: 'cancel', burst: { share: 0.05, outcome: 'weaken' } },
    wake:    { name: 'Pale Wake', full: 'pale-wake', weak: null, aim: 'crowd',
               interrupt: { by: [], outcome: 'none' }, stagger: 'none', burst: null },
    allEnd:  { name: 'All Things End', full: 'all-end', weak: 'not-all', aim: 'all',
               interrupt: { by: ['hold'], outcome: 'cancel' }, stagger: 'weaken', burst: { share: 0.08, outcome: 'weaken' } },
    reaping: { name: 'The Reaping', full: 'reaping', weak: null, aim: 'weakest',
               interrupt: { by: [], outcome: 'none' }, stagger: 'none', burst: null },
  },
  phases: [
    { name: 'The Pale Horse', line: 'He opens the book. The one he names will die unless the party stops him.',
      from: 1, ends: 'gate', clock: 5, worn: [], bar: 1,
      acts: ['Reaping Stroke', 'Not Yet'], rotation: [act, omen named, act] },
    { name: 'The Book Opens', line: 'He is never late, and he is faster now.',
      from: 0.7, ends: 'gate', clock: 5, worn: [drawn(15, 'Never Late')], bar: 1,
      acts: ['Reaping Stroke', 'Not Yet'], rotation: [omen named, act, omen wake] },
    { name: 'All Things End', line: 'The last page. Every name is in it.',
      from: 0.35, ends: 'gate', clock: 4, worn: [drawn(15, 'Never Late'), fury(20, 'The Last Page')], bar: 0.75,
      acts: ['Reaping Stroke'], rotation: [omen named, omen allEnd] },
  ],
  enraged: [omen reaping],
}
```

How it goes: Named in the Book is `sure` and aimed at the hunter lowest on HP, so the party's answers are a stun or
root (cancel), a broken bar (cancel), a burst (weaken), or a shield and a heal on the named one. The healer decides
who is named by deciding who stays topped up. Phase 2 adds Pale Wake's plague, which spreads to a body next to the
bearer, so the party that stands together to share shields catches it. Phase 3 alternates the name and All Things End
on everyone. Past a clock, The Reaping takes the weakest hunter every other turn.

### And `plain`: the script of a mythic with no story of its own

One phase from full HP, `ends: 'gate'` (its gate is 0), clock 14 rounds (today's M1 fight lasts about 14), worn none,
acts `every`, rotation `[act]`, bar 1; enraged `[omen overwhelm]`, where Overwhelm is a `field`, `sure` blast of
`hits` 1.2 with Crescendo and no answer. It is today's mythic with a clock, so every mythic a GM makes plays a script
and row B1 covers it. The other 20 rows of `mythic.json` start on `plain` and gain a script each as one row of data.

### The test to copy

Each script gets one test in `tests/mythics.test.ts` that states its shape from its own words, for example "Zaratan's
Dive cannot be hurt and ends after 3 rounds", "the Angel's Final Note comes every other turn once a clock runs out",
"the Fourth Rider names the hunter lowest on HP". A new mythic copies one of these. Every other check loops over
`MYTHICS` and needs no edit: the shape tests (B.10, MY1) and row B1 (B.8).

## B.7 What needs new code

| Need | Kind | What it is | Where |
|---|---|---|---|
| The script's types | new types | `MythicScript`, `MythicPhase`, `Omen`, `MythicMove`, `MythicStanding` (B.3) | `combat/mythic-types.ts` (new) |
| The scripts | new registry | `MYTHICS` (`plain` and the three of B.6), `mythicMove` (a move into an `Ability` from its `hits`), `scriptFits` | `registry/mythics.ts` (new) |
| `fight.mythic` | rules | the switch, `staggerTaken`, `turnPace`, `bounds` (B.3) | `rules.ts` |
| `Monster.script` | a field | required for kind `mythic`, `plain` when absent; three seeds of `mythic.json` with their scripts | `registry/monsters.ts` |
| The machine | new pure module | `MYTHIC_TABLE`, `mythicStep`, `mythicCan`, the derived readers of B.3 | `combat/mythic.ts` (new) |
| The standing on a row | a field of a kind | `MonsterOwn.mythic`, null on the other kinds (SMX-rules-8); read back from a stored fight | `effect-ops.ts`, `fight-parse.ts` |
| The gate | one argument | `foeLifeAfter`'s `floor` from `gateOf`, in `rowLifeAfter` | `row-life.ts` |
| A mythic row | rows | the standing in `calm`, phase 0's statuses, its bar at phase 0's size | `rows.ts` `monsterRows` |
| Beats, answers, phase change | the turn | `startTurn`'s four steps, `consequences`' answers, `phased` | `fight-turn.ts` |
| `landing`, the `mythic` command | the reducer | the running state and its row of `TABLE`, `landOmen`, the GM's command, `setIntent`'s refusal, `joined` moving `since` | `fight.ts`, `fight-types.ts` (command, effects `phased` `omen` `answered`, six refusals) |
| The stagger op on a mythic | one line | A's `stagger` op fills `share × mythic.staggerTaken` of a mythic's bar | `land.ts`, wherever unit K3 puts the op |
| The play | policy | `answerChoice`; the mythic's landing and its phase's `acts` | `policy.ts` |
| The room | the doc | a mythic row's `my`: script, state, phase, beat, since, and the omen's key, aim and hpAt while one stands; the room's switch | `fight-doc.ts`, `protocol.ts` |
| The words | core | `mythicView` (the strip, the banner, a player's own lines), `answersBy`, `intentOf` reading the omen, `mythicLines` (Rules page) | `fight-view.ts`, `rules-text.ts` |
| The map | core | an omen's tiles and ring | `map-view.ts` |
| The screens | views | the strip and banner, the GM's landing panel and Next phase, the hotbar tag, the maker's Fight select, the codex lines, the room switch | `combat.js`, `uses.js`, `bestiary.js`, `rulesref.js`, `custom.js` |
| The chart | script | B.3 | `scripts/charts/mythic.ts` (new), `scripts/statecharts.ts` |
| One writer | lint | "a mythic's standing has one writer, `mythicStep`" | `tests/lint.test.ts` |

What needs no new code: the interrupt answer is a status op that exists (`hold`, `root`, `taunt`); the stagger answer
is the bar that exists; moving and shields are the use's own rules; a zone left by a move is `MonsterSpec`'s `leaves`;
Crescendo is a stacking status of `share`; the Dive is a clock phase whose gate is its own HP. No new op is needed.

## B.8 The simulation's bounds

In `tests/fight-sim.test.ts`, built in `tests/models/fight-sim.ts`, each move logged in `rw/sim-log.md`, as A.8's rows.
The party is the sim's mixed party at S's first level in its S kit (row M1's). Each script plays on its seed's body
(`plain` on today's brute mythic), `mythic.scripts` on, through `playBegin` and `playStep` with `sensible`. Runs are
600 a script, M1's number: at a share near 0.075 that is a standard error of 0.011, so a share measured at 0.06 to
0.09 is inside the band with room. A row within one standard error of a bound is run again at 1,200 before a lever
moves, and both runs go in the log.

**The one lever is each script's `hp`.** Every other number of a script is design: its clocks, its bands, its
answers, its moves' `hits`. When a row other than B1 misses, the script's words change (an answer added, a clock
lengthened), never its `hp`, and the change is logged with the row it fixed.

| Row | What it checks | Bound | Why this bound |
|---|---|---|---|
| **B1** each mythic at M1 | the mixed party against each script in `MYTHICS`, `plain` included | 5% to 10% wins, every script | the owner: "5-10% odds for a party of 3". Loops over `MYTHICS`, so a new script is measured with no edit |
| **B2** no phase is skipped | in every fight of B1 and B4, the phases the mythic entered and its turns in each | each phase entered in order; every phase before the one the fight ended in had at least one mythic turn; 0 exceptions | the gate's promise (A.9, B.3); a static test says the same for one hit (B.10, MY3) |
| **B3** the answers are the fight | B1's party with `answerChoice` off | under 1% wins for every script with omens (`plain` has none and is skipped) | the odds come from answering, not from HP: a party that ignores omens does not get its 5 to 10% |
| **B4** burst does not skip | three Focused cannons (A.8's build) with the damage keystones each can earn | B2 holds; win share at most 15% | burst is strong, and still meets every phase |
| **B5** every answer counts | for each answer kind a script's omens use with an outcome that is not `none`, B1's party with that kind alone taken out of `answerChoice` | its win share at most four fifths of the script's B1 share | an answer the party can skip is words on a banner, not a decision |
| **B6** the clock ends a fight | the fights of B1 that reach an enraged turn | none reaches `CAP_ROUNDS` (40); the party wins under 1 fight in 100 after it is enraged | a fight past its clock is lost, so sustain cannot outlast it (A.9's risk) |
| **B7** every phase is a threat | in the fights the party lost, the phase in which its first hunter fell | no phase holds over 60% of first falls; each holds at least 10% (a clock phase at least 5%) | a phase in which nobody is ever in danger is filler |
| **B8** the length | rounds of the fights of B1, the median | 10 to 20 rounds | today's M1 fight is about 14; a mythic is the night's set piece, not two hours of it |
| **B9** keystones (A's K5) | A's K5 parties, each keystone pair, against each script | inside 5% to 10%; no one keystone moves a script's share by more than 3 points | A's promise kept for every script |

The static guards, before any fight is played (`tests/mythics.test.ts`): every script is within `mythic.bounds`; each
move's ability deals its `hits` share of the sample S hunter's max HP within 10% before armor and resist; every omen in
a phase's rotation can be answered (B.4); every omen with a `weaken` outcome has a `weak` move.

With `mythic.scripts` off every row of today's sim is unchanged, M1 included; unit MY5 asserts it.

**Check** before MY5 starts: how long row M1 takes today. B1 to B8 are about 20 times its 600 fights (B1 and B4 four
scripts each, B3 three, B5 about nine answer kinds across the three scripts). B9 is A's K5 played against every script,
28 pairs each, far more again; it shares K5's runs, so the two rows read one set of fights. If B1 to B8 push
`bun run test` past its time, B1 and B2 stay in every run and B3 to B9 move behind the sim file's switch for long runs
(**check** its name; if there is none, MY5 adds one and says so in `docs/guide/tests-ci.md`).

## B.9 What could go wrong, and the guard for each

| Risk | Guard |
|---|---|
| A big burst skips a phase (the old way to beat a raid boss) | the gate in `rowLifeAfter`, the one writer of HP: no path of damage passes it; the phase changes only on the mythic's own turn; rows B2 and B4; MY3's "a hit of ten times its max HP leaves a mythic at its gate" |
| Damage held at the gate feels wasted | the strip says `held at the gate` the moment it happens and the log line names it; the bar still fills from that damage, so it is not all wasted; a party learns to save its burst for the omen |
| The 5 to 10% depends on the sim answering better than a table | B1 is measured with `answerChoice`, B3 without it; the gap is the answers' worth and is in the log; the GM's hidden weight (notes-8-fudge) stays the table's dial; the hotbar tag tells a player which tap answers |
| One answer is always right (a stun cancels everything) | each omen names its own answers; B5 bounds each answer kind; the tests assert every omen in a phase can be answered, and the data mixes which answer |
| The script and the HP disagree (an omen standing at the gate, a heal off the gate during a turning turn) | one order, written once in `startTurn` (phase over first, then the landing, then the beat); `next` from `omen` drops the omen; a heal off the gate means the phase is not over at its turn start, which is the plain meaning |
| A party out-sustains the clock (Blood Magic, Undying, Endless Stride) | enraged swaps the rotation for the doom every other turn, and each doom that lands adds Crescendo; row B6 |
| A stunned mythic never lands its omen, or a stagger pushes it forever | an omen waits for a turn the mythic takes; the stagger bar's max grows 75% a break (`staggerRegrow`) and empties only at a phase change; the clock runs on fight time, not on the mythic's turns |
| A taunt makes every omen land on the tank | the landing is not bound by a taunt; a taunt answers only an omen whose `interrupt.by` names it |
| An omen with nowhere to stand (a small map, Zaratan's sea) | Sinking aims at the party's crowd, never at the last dry tile; the GM's Drop the omen; Zaratan's longest clock is its last phase for that reason |
| A dispel or a GM's status edit takes off a phase's worn status | `dispel` takes harmful statuses only; the GM's edit is the GM's; the next phase puts its own on whole |
| Keystones break a script (A's K5) | row B9; `mythic.staggerTaken` halves the stagger op on a mythic |
| The doc grows past `DOC_MAX` | `my` is at most seven short fields a mythic row; the worst-case doc test in `tests/protocol.test.ts` gains a mythic in an omen |
| A player's phone shows a stale omen | the omen is read from the doc's standing, not from an effect; the banner goes when the standing leaves `omen`, as the channel's card does |
| The GM loses control of the table | Drop the omen and Next phase, both events of the same table; the switch turns scripts off for a room |
| Two writers of the standing | the lint row "a mythic's standing has one writer" (MY3) |
| A script that does not fit its monster | `scriptFits` in the maker and a test over every seed |
| An old save or room | nothing to migrate: the standing lives only in a fight; old rooms need not work; a hunter's save is not touched |

## B.10 Units of design B, in build order

MY1 to MY4 run one after another (each reads the one before). MY5 and MY6 may run side by side: they share no file.
MY7 comes after MY6. **With design A:** MY3 shares `effect-ops.ts` and `fight-parse.ts` with A's K3, and MY1 shares
`rules.ts` with K1 and K3: none of those pairs runs side by side. The one line of A's `stagger` op on a mythic goes in
whichever of K3 and MY3 lands second (both list `land.ts` for that line only).

| Unit | What it builds | Files it may change | Named tests | What a table sees | Model |
|---|---|---|---|---|---|
| **MY1** | the script's types, `MYTHICS` (`plain` and B.6's three), `mythicMove`, `scriptFits`, `fight.mythic` (switch off), `Monster.script` and three seeds | `src/core/combat/mythic-types.ts` (new), `src/core/registry/mythics.ts` (new), `src/core/rules.ts`, `src/core/registry/monsters.ts`, `tests/mythics.test.ts` (new), `tests/monsters.test.ts` | `tests/mythics.test.ts`: "every script's phases fall in HP from full", "a clock phase holds no band of HP", "the last phase ends at 0 HP", "every omen lands moves its script holds", "an omen that can be weakened has a weak move", "every omen in a phase can be answered, and only a doom cannot", "no act shares a name with a move", "every script is within the mythic bounds", "each move deals its share of an S hunter's HP"; `tests/monsters.test.ts`: "every mythic seed's script fits it", "a mythic made with no script plays plain" | nothing yet (switch off) | opus |
| **MY2** | the machine and its readers, the chart | `src/core/combat/mythic.ts` (new), `tests/mythic.test.ts` (new), `scripts/charts/mythic.ts` (new), `scripts/statecharts.ts`, `docs/guide/machines.md`, `docs/state-machines.md` (by `bun run charts`) | `tests/mythic.test.ts`: "a mythic's standing as a machine: every state against every event", "next is refused in the last phase", "a weakened omen takes no second weaken", "a phase's gate is the next phase's start", "a gate phase past its clock is enraged and a clock phase is over", "a beat is read modulo its rotation", "each omen aim picks its body, ties to row order"; `tests/statecharts.test.ts` passes | nothing yet | opus |
| **MY3** | the standing on a monster row, the gate in the life's one writer, a mythic's row, the one-writer lint | `src/core/combat/effect-ops.ts`, `src/core/combat/row-life.ts`, `src/core/combat/rows.ts`, `src/core/combat/fight-parse.ts`, `src/core/combat/land.ts` (the stagger op's line only, if K3 landed), `tests/mythic-gate.test.ts` (new), `tests/rows.test.ts`, `tests/lint.test.ts` | `tests/mythic-gate.test.ts`: "a hit of ten times its max HP leaves a mythic at its gate", "a mythic in its last phase falls at 0 HP", "the GM's hand edit stops at the gate", "a heal lifts a mythic off its gate", "lifesteal drains nothing the gate held", "a hit on a mythic held at its gate still fills its stagger bar"; `tests/rows.test.ts`: "a mythic row starts calm in its first phase wearing its statuses", "with mythic phases off a mythic row holds no standing", "a stored mythic row reads back"; `tests/lint.test.ts`: "a mythic's standing has one writer" | nothing while the switch is off | opus |
| **MY4** | the reducer: beats, omens, answers, landing, the GM's command, the phase change | `src/core/combat/fight.ts`, `src/core/combat/fight-turn.ts`, `src/core/combat/fight-types.ts`, `tests/fight.test.ts`, `tests/mythics.test.ts` (the per-script tests), `docs/guide/combat.md` | `tests/fight.test.ts`: "a mythic held at its gate enters its next phase on its next turn", "an omen announced on its turn lands on its next", "a stun on a mythic cancels an omen whose interrupt cancels", "a broken stagger bar weakens an omen whose stagger weakens", "enough damage weakens an omen", "an omen aimed at a body out of range finds no one", "the landing turn takes only the omen's move", "a taunt does not move an omen's aim", "the GM's Next phase brings its HP to the phase's start", "the GM drops an omen", "an omen standing at the gate is lost to the phase change"; `tests/mythics.test.ts`: "Zaratan's Dive cannot be hurt and ends after 3 rounds", "the Angel's Final Note comes every other turn once a clock runs out", "the Fourth Rider names the hunter lowest on HP" | a GM with the switch on in Custom rules can run a scripted mythic from the log | opus |
| **MY5** | the play and the numbers: `answerChoice`, the mythic's landing, rows B1 to B9, each script's `hp`, the switch on | `src/core/combat/policy.ts`, `tests/policy.test.ts` (new), `tests/models/fight-sim.ts`, `tests/fight-sim.test.ts`, `docs/agent-handoff/rw/sim-log.md`, `src/core/registry/mythics.ts` (`hp` only, and words when a row other than B1 misses), `src/core/rules.ts` (`mythic.scripts` to on, last) | the rows of B.8 by name; "with mythic phases off the old rows are unchanged"; `tests/policy.test.ts`: "a hunter in an omen's tiles steps out", "a hunter with a stun uses it on a mythic whose omen a stun cancels", "a support shields the hunter an omen names", "a mythic with an omen standing lands it" | the GM's odds for a mythic read the script; nothing else on screen | opus |
| **MY6** | the room doc: a mythic row's `my`, the room's switch | `src/core/combat/fight-doc.ts`, `src/core/protocol.ts`, `tests/fight-doc.test.ts`, `tests/protocol.test.ts`, `docs/guide/room-sync.md` | `tests/fight-doc.test.ts`: "a player's doc carries a mythic's phase and its omen", "an omen's aim on a hidden body stays off the party's doc"; `tests/protocol.test.ts`: "the worst-case doc on the wire" with a mythic in an omen, "the room carries the mythic switch" | players' phones hold the standing (no screen yet) | sonnet |
| **MY7** | the words and screens of B.5 | `src/core/combat/fight-view.ts`, `src/core/combat/map-view.ts`, `src/core/rules-text.ts`, `src/views/combat.js`, `src/views/uses.js`, `src/views/bestiary.js`, `src/views/rulesref.js`, `src/views/custom.js`, `tests/fight-view.test.ts`, `tests/map-view.test.ts`, `tests/rules-text.test.ts`, `tests/e2e/mythic.e2e.ts` (new) | `tests/fight-view.test.ts`: "the banner lists each answer of the omen in plain words", "the strip says held at the gate", "the strip counts the clock down"; `tests/rules-text.test.ts`: "the Rules page states how a mythic fights"; `tests/e2e/mythic.e2e.ts`: "a GM sees the Angel's omen and lands it with one tap", "a player whose hunter stands in Stars Fall's tiles reads that they are in the marked tiles", "a player's stun cancels the omen on every phone", "the GM's Next phase moves the strip to phase 2", "a GM picks the Fourth Rider's fight in the bestiary" | the whole feature | sonnet |

The recipe each unit leaves in the guide (MY4 writes it in `docs/guide/combat.md`): **a new mythic** is a row of
`MYTHICS` in `src/core/registry/mythics.ts`, its seed's `script` naming it, and one test in `tests/mythics.test.ts`
copied from "Zaratan's Dive cannot be hurt and ends after 3 rounds" that states its shape. Row B1 measures it with no
edit; its `hp` is moved until B1 holds and the move is logged.

---

# Calls in design B that the owner might have made otherwise

Each is built as written unless he says otherwise; the words after each are what he can say to undo it.

1. **Damage past a gate is lost.** It does not carry into the next phase, so no burst skips a phase. Undo: "Let
   damage past a gate carry into the next phase."
2. **Announcing an omen and changing phase each take the mythic's turn.** The party gets a turn to answer and to see
   the new phase. Undo: "A mythic also acts on the turn it announces an omen or changes phase."
3. **The GM's hand edit of a mythic's HP also stops at its gate**; the GM moves a phase with Next phase. Undo: "Let
   the GM's HP edit pass a mythic's gate."
4. **Past a clock, a mythic is enraged: its doom every other turn, each one harder.** A fight past its clock is lost,
   not slowed. Undo: "Make enrage a damage bonus, not a doom."
5. **Every mythic plays a script; one with none plays `plain`**, today's mythic with a clock. Undo: "Let a GM make a
   mythic with no script."
6. **Scripts are built-in data**: a GM picks one in the bestiary but cannot write one. Undo: "Give the bestiary maker
   a script editor." (a unit of its own, after MY7)
7. **The 5 to 10% is measured with a party that answers omens** as the sim's policy does. A table that does not
   answer loses more often (row B3 says how much). Undo: "Measure the 5 to 10% with a party that does not answer."
8. **The codex shows every phase of a mythic before anyone has met it.** Undo: "Hide a mythic's later phases in the
   codex until a party reaches them."
9. **Hits on a mythic held at its gate still fill its stagger bar.** Undo: "A mythic held at its gate takes no
   stagger."
10. **Heals on the mythic count against the burst answer**, because the answer reads the HP it lost. Undo: "Count the
    damage dealt for the burst answer, not the HP lost."
11. **The reducer picks each omen's aim by the script's rule**, not the GM. Undo: "Let the GM pick each omen's
    target."
12. **A taunt answers an omen only where the script names it**, and an omen's landing ignores a taunt. Undo: "A taunt
    always moves an omen onto the tank."
13. **Two ways a phase ends, by HP or by clock.** A phase that ends when an add falls (the Deathless Tsar's hidden
    death) and a mythic that leaves are not built. Undo: "Add a phase that ends when a named summon falls."
14. **Mythic phases ship switched off** and are turned on by MY5 once rows B1 to B9 hold; a room can turn them off.
    Undo: "Turn mythic phases on now."
15. **The other 20 rows of `mythic.json` start on `plain`** and gain their scripts one row at a time. Undo: "Write a
    script for every mythic before phases ship."
