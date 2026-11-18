# P1 notes: the built-in abilities

## Files outside the unit's two

- `docs/dependency-map.md`: regenerated with `bun run deps -- --write`. `tests/deps.test.ts` fails on a new core file
  until the committed map lists it, so `bun run test` needs it. Commit 8cf554e.
- No file was changed by hand outside `src/core/registry/abilities.ts`, `tests/abilities.test.ts` and these notes.

## Choices the plan left open (read these first)

1. **The status a skill applies comes from the rules.** Sprint puts Hasted on its user and Stealth puts Stealth, and an
   `applyStatus` op carries the status's def. Today `RULES.conditions` holds the old defs of `status.ts`. So the skill
   abilities take `SkillRules = KindRules & { conditions: { hasted: StatusDef; stealth: StatusDef } }` with the new
   `StatusDef` of `effect-ops.ts`. After W1a restates the statuses, `RULES` and `rulesOf(...)` satisfy it as they are,
   and a GM's edited Hasted reaches Sprint. Until then a caller passes `{ ...RULES, conditions }`. The test does that with
   Hasted and Stealth as plan 3.1 restates them. The archetype attacks and `weaponAttack` take `KindRules` only.
2. **One id for every default attack.** `ATTACK_ID` (`'attack'`) is the id of a hunter's weapon attack and of a monster's
   archetype attack. A skill's ability has the skill's name as a slug (`dagger-rush`). A test checks that a hunter's ids
   never collide. P5 and W6 can find a body's default attack by this id.
3. **No weapon, or dice the rules refuse.** `weaponAttack(null, R)` is "Strike", the strike kind's own `1d8 + phys`, the
   default attack of the design's builds and the simulation. An item whose dice do not parse under the rules' dice
   limits (an empty `dice`, `2d5000`) attacks with its kind's dice. No throw: the item is outside data.
4. **A weapon's formula follows the cost budget.** Plan 3.3 writes a weapon's formula as `<dice> + phys`. I read that as
   the kind's recommended formula with the weapon's dice, so a bow (a quick shot) is `0.7 * (<dice> + phys)`, as plan 3.5
   says for skills. Without the share a bow would deal a standard hit for 70 hundredths of a turn, which design 3.3
   rules out.
5. **The weapon's kind is an input.** `Weapon = { name, dice, attack: 'strike' | 'shot' }`. W1b gives an item its
   `attack` ("shot for a bow, else strike", plan 3.3). The test derives it the same way from today's items
   (`/bow\b/i` on the name).
6. **Every old cooldown becomes rounds,** not only the two rows plan 3.5's table names: Sprint 3, Stealth 4, Ruler's
   Authority 5, Shield Wall 3, Marked Shot 2 (Arc Bolt had none). The rule in 3.5 is general.
7. **Sprint and Stealth deal and shield nothing.** They are supports on the user (`aim: 'self'`, shape `self`, range 0)
   with `effect: null`. The support kind's shield would make a self-buff a shield too. `abilityOf` therefore marks them
   `formulaEdited`, which is true: their formula is not the kind's.
8. **Ruler's Authority's reach is in feet.** "within 30 ft" becomes `floor(30 / tileFeet)` = 6 tiles, as both its range
   and its touch reach. Setting the range alone would leave the curse's touch reach at 8.
9. **"Edited" means not the kind's own formula.** A built-in whose formula prints the same as its kind's recommended one
   (a Steel Longsword's `1d8 + phys`, Shield Wall's `1.5 * sup`) is not marked edited; one with other dice is.
10. **Passives are not here.** Bloodlust, Iron Skin, Trailsense and Mana Sense have a bonus and no ability; their bonus
    mapping (plan 3.5: `ac: N` as `vit: 2N`) is W1b's, in `skills.ts`.
11. **What a skill loses.** Marked Shot's "next attack has advantage" and Shield Wall's "adjacent allies" have no rule in
    the new fight: Marked Shot is a plain 1d6 shot, Shield Wall a shield on one ally in range 6.

## What I made

`src/core/registry/abilities.ts`

- `SkillRules`: the kinds' numbers and the defs of the statuses a skill puts on its user.
- `ATTACK_ID`: the id of a body's default attack.
- `Weapon`: what `weaponAttack` reads of an item (`name`, `dice`, `attack`).
- `ARCHETYPE_ATTACKS`: `{ brute, skirmisher, caster }`, each `(R) => Ability`: Strike (`1d8 + phys`), Shot
  (`0.7 * (1d8 + phys)`), Curse (`1d8 + mag`).
- `weaponAttack(item | null, R)`: a hunter's default attack.
- `SKILL_ABILITIES`: each active built-in and starter skill by name, `(R: SkillRules) => Ability | null`; `BuiltInSkill`
  is its key. Arise and Shadow Exchange give null.

Every entry goes through `abilityOf`, so a GM's override of a kind's numbers reaches it (a test overrides strike's
fatigue and curse's range). Fatigue and mana are always the kind's; time is the pace's; the cooldown is whole rounds.

| Skill | Ability |
|---|---|
| Dagger Rush | strike, quick (70), `0.7 * (2d4 + phys)`, cooldown 2 rounds |
| Mutilation | strike, standard, `2d6 + phys`, cooldown 3 rounds |
| Sprint | support on self, quick, Hasted for 1 round, cooldown 3 rounds |
| Stealth | support on self, Stealth until removed, cooldown 4 rounds |
| Ruler's Authority | curse, physical, `1d8 + phys`, range and reach 6, cooldown 5 rounds |
| Shadow Exchange, Arise | null |
| Shield Wall | support, `1.5 * sup` shield, cooldown 3 rounds |
| Marked Shot | shot, `0.7 * (1d6 + phys)`, cooldown 2 rounds |
| Arc Bolt | curse, `2d6 + mag` |

`tests/abilities.test.ts` (18 tests): every entry has every field of its kind's ability, the kind's fatigue and mana, a
pace's time and a cooldown in whole rounds; every formula reads back as the same tree from its printed text; a hunter's
ids are distinct; every active seed and starter skill has an entry; the single-hit bound; one test per row of plan 3.5
and 3.3; the override reaching the built-ins.

## The single-hit bound (design section 6)

Bound, written before the run: a use deals at most 60% of a same-rank tank's max HP at mean dice, on a caught target
without a crit (table 6.6's "expected"). The tank and the users are design 2.2's builds: points split 2:1 by `split`,
every perk (`TIER_BUDGET` summed to the rank) on the main stat, in the build's kit from `kitGear`. A test pins the C tank
to the paper's table 2.1 (Vitality 63, Strength 33). Each hunter ability is tried by all five builds; each archetype
attack by its archetype as normal, elite and boss; every rank E to S. 534 uses go through `resolve` (16 hunter abilities by 5 builds, 3 archetype attacks by 3 kinds, at 6 ranks). A reaction d20
of 7 is past every crit face (at most 6) and, with the edge capped at 6, under the resist roll of 15; the target stands
adjacent, so nothing lands slowly enough to step out of. The test asserts each outcome is caught with no crit, so a
change that broke that setup would fail it rather than pass quietly. A second test shows the check sees a breach
(a 20d12 strike by a C bruiser is over 60%).

Worst share per entry, from a scratch script that runs the same uses (one deterministic run, no spread; the limiter is
the user's power against the tank's armor and HP at E, where HP is lowest):

| Entry | Worst | Where |
|---|---|---|
| Monarch's Scepter (4d8) | 31% | E bruiser |
| Arc Bolt | 27% | E cannon |
| caster's Curse | 25% | E boss |
| Kamish's Wrath (3d8) | 25% | E bruiser |
| brute's Strike | 18% | E boss |
| Mutilation, Frost Giant Hammer | 18% | E bruiser |
| every other entry | 10% to 16% | |

The largest is half the bound, so no built-in is the outlier risk 3 of the plan feared. The monster blasts (Dragon
Breath) are W1b's and will meet the same bound in `monsters.test.ts`.

## Words for copy-tasks.md (W9 owns it)

New ability names: "Strike" (a brute's attack and a hunter with no weapon), "Shot" (a skirmisher's), "Curse" (a
caster's). A weapon attack takes the item's name.

## Which principle changed a choice

- explain-the-number: the bound's setup is table 6.6's definition, the tank is pinned to the paper's table 2.1, and the
  worst share per entry is recorded above with what limits it.
- test-behavior-not-implementation: each expected formula is the plan's text (`0.7 * (2d4 + phys)`, `1d8 + phys`), not
  a run; the bound test asserts its own setup (caught, no crit) and has a case that breaches it.
- minimize-reader-load and subtract-before-you-add: one builder, `built`, over `abilityOf` and `recommended`, so the
  recommended formula keeps one home; a skill states only how it differs from its kind.
- boundary-discipline: `weaponAttack` takes outside dice and falls back to the kind's dice rather than throwing.

## Progress

- Step 1: `src/core/registry/abilities.ts`. Commit 95779a3.
- Step 2: `tests/abilities.test.ts` and the "edited" mark by printed formula. Commit f720ccc.
- Step 3: `bun run deps -- --write`. Commit 8cf554e.
- Step 4: these notes.

Lines: `abilities.ts` 125 added, `abilities.test.ts` 215 added, nothing removed (new files only).

## The check

- `bun test tests/abilities.test.ts`: `Ran 18 tests across 1 file. [167.00ms]` (18 pass, 0 fail).
- `bun run test`: `Ran 2033 tests across 54 files. [118.69s]` (2029 pass, 4 todo, 0 fail; the 4 todo are
  `tests/fight-sim.test.ts`'s open rows, there before this unit).
