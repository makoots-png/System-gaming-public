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
