# Enemy list, first draft

the owner asked for "a HUGE enemy list. Ranging from weak to basically mythical unbeatable." This is the list as a
draft. Nothing here is balanced and nothing is in the game yet.

- `draft.json`: 343 enemies, each a `SEEDS` row (`src/core/registry/monsters.ts`) as an object: `key`, `name`,
  `rank`, `type`, `archetype`, `kind`, `abilities` (each a `MonsterSpec`), `notes`, `desc`. No row has a tweak.
- `mythic.json`: 23 more, rank S, each with `"mythic": true` and `unbeatable`, one line on what should make it
  near unbeatable. How that is built is not decided here.
- Check: `bun docs/agent-handoff/features/enemies/check.ts`. It makes each row a monster the way `seedMonsters` does, reads it
  with `parseMonster`, and fails on a row the parser changes or refuses, a spec field the kind does not have,
  and a key or name held twice (the shipped seeds included).
- Sweep: `flock /tmp/box.lock bun docs/agent-handoff/features/enemies/measure.ts` (about 5 minutes for all 366 rows; `--rank=C`,
  `--kind=boss`, `--key=slug`, `--runs=N`, `--quiet` narrow it). One line a row: worth, single hit and fight against the plan's
  bounds, then OK, EXC or OUT; exits 1 on an OUT. A row is EXC when a bullet "- `key`: reason" is under a heading "Exceptions..." here.

## Counts

`draft.json`, 343:

| By | Counts |
|---|---|
| Rank | E 56, D 59, C 59, B 58, A 53, S 58 |
| Archetype | brute 145, caster 104, skirmisher 94 |
| Kind | normal 174, elite 107, boss 62 |
| Type | Beast 43, Undead 33, Insect 32, Construct 29, Demon 29, Spirit 26, Humanoid 23, Dragon 22, Giant 19, Plant 17, Elemental 15, Fey 15, Aquatic 13, Aberration 12, Ooze 10, Celestial 5 |

`mythic.json`, 23: brute 11, caster 9, skirmisher 3; boss 20, elite 3; 16 types, Dragon 3, five types 2 each, the
rest 1.

## What the balance pass must decide

1. Every tweak: HP factor, stat points, XP factor. All are at their defaults, so two enemies of one rank,
   archetype and kind have the same body. Slow, fast, frail and tough are said only in the words.
2. Whether each ability set is too much. No ability was weighed. Bosses hold three to five, some normals one
   or none. Status lengths, reaches and blast sizes (up to 60 ft, 90 ft for a mythic) were picked by feel.
3. Status spread: stunned and bleeding 84 uses each, plague 10, bloodlust 14. Paralyzed (25) is on many low
   rank enemies and may be too strong there.
4. What "mythic" means in the rules: a rank past S, a fourth kind, a tweak, or a rule of its own. Then whether
   each `unbeatable` line becomes a mechanic or stays the GM's.
5. Extractable: every row takes the default (yes). Constructs, oozes, spirits and the mythic tier likely
   should not be.
6. The first note of each row is advice to the GM. Where it states a rule (regenerates unless burned, heads
   grow back, adds arrive each round) someone must make it a mechanic or accept it as text.
7. Loot: none is given.
8. The type list. Aquatic, Fey, Ooze, Plant, Elemental, Aberration, Spirit and Celestial are new beside the
   seeds' types, and whether a type should mean anything in a fight.
9. The four penetration stats (the owner, Nov 21, `for-the-owner.md` Answered): flat and percent, for armor and for
   resist, in place of today's `pen` and `penFlat`. Decide which stat feeds each, whether monsters hold them, what
   today's flat-penetration gear becomes, each one's weight in the item budget (`itemSpend` does not weigh flat
   penetration today), and a name for flat magic penetration. An item may hold each of the four. Measure it with
   Tenacity from Strength and Discipline: both move damage and control against a boss, which is tough only by
   HP, armor and resist.
10. How League prices a stat (the owner, Nov 21: "let's look at how league does stats. Their balance system is pretty
    good, but that's like for a tier"): League gives each stat a gold value from its cheapest item and calls an
    item's stats over its price its gold efficiency. Ours is `BONUS_COST` in points against a tier's budget. Compare
    the two tables stat by stat and name where ours differs and why.
11. Variation inside a tier ("There should be some variation in how strong or weak an item is"): grades inside a
    tier exist (Rare-, Rare, Rare+). Decide how wide the spread of spend is in one tier and how a drop picks it.
12. The strongest stats, measured ("Let's also determine what the strongest stats are in that balance run, so we can
    decide how rare to make them. Things like lifesteal are ok to be on the stronger side because they should be
    rare to gain"): the simulation gives each bonus key's gain in win share and rounds to kill for one budget's
    worth of it; the keys are ranked, and a key's rank sets the lowest rarity an item may hold it at and how often
    a drop rolls it, in place of pricing a strong key up until it is fair. A rule each, in `itemBudget`.
13. How good each stat is, and where each derived number comes from (the owner, Nov 21: "also have it look at how good
    the stats are if they aren't planning to already, and where we should source things like % pen, lethality,
    tenacity, etc..."). Two measurements with the simulation. (a) The eight stats: for each, what ten more points do
    to win share and rounds to kill for each sample build at C and S, so a stat that is worth much less than the
    others is found (he said of Strength and Discipline: "throwing more of a bone to those stats"). (b) Each derived
    number (the two percent penetrations, Lethality, Unravel, tenacity, potency, lifesteal, haste, heal power and the
    rest): which source it should have: a stat's curve (and which stat), items only, titles and paths, or a mix;
    today percent penetration is Control's for both kinds and tenacity is Strength and Discipline's. The answer is a
    table, one row a number, with the measurement that decided it, and the weak stats are given the numbers that
    fit them. The numbers are the lead's to set (the owner: "you have a better view of the numbers"); he judges the
    results.
    The result he wants (Nov 21): "The stats should be roughly equal in strength, with benefits to pushing towards a
    single or a few stats in particular as a class." So two bounds: (i) ten points of any one stat are worth about the
    same as ten of any other (say within a quarter of the mean, measured as in (a)); (ii) a build that puts its
    points into one or a few stats beats a build that spreads the same points evenly, at what its class does (a
    cannon's damage, a tank's staying power), by a clear and bounded margin. Today's curve works against (ii): the
    Rules page says "points spread over several stats are worth about as much as points put in one" (`effExp`, the
    effective points of a stat grow slower than the stat). Measure what the curve gives now, then move it, or give a
    class its reward another way (a path's or a job's bonus that grows with its own stat), and say which.
    He confirmed it the same hour: "Specializing should pay off for sure." So (ii) is a bound that must hold, and the
    Rules page's sentence on spread points goes with whatever replaces it.

## What the seed shape could not say

- A lasting buff. `applies` goes on a target, a `shield` is the only self ability. Regeneration, haste,
  stealth and invisibility need a starting status, which is in the tweak, so no row has one. Some rows
  say "regenerates" or "hides" only in words.
- Summons, adds and splitting (a hive queen, a hydra's heads, an ooze cut in two). Notes only.
- Flight, burrowing, swimming, climbing, and an enemy that never moves. Notes only.
- Pulls, pushes and carrying a hunter off. A hook or a snatch is written as `restrained` or `prone`.
- Auras, phases, a trigger on low HP, a weak point, a condition that ends the fight. Notes only.
- Elements. Damage is physical or magical, so fire, frost, lightning and acid differ only by the status.
- A healer or a buffer of allies. No spec heals or helps another row.
- A blast shaped as a line or cone (every breath is a radius), and a zone that is not a blast's leftover.
- Swarms and armies as one body, and several bodies that are one enemy (twins, a coven of three).
- Size. A hill-sized enemy and a rat take one tile each as far as a row says.
