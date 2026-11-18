# Phase 4 design: how a status scales

Decided by the lead from `p4/status-audit.md`. The owner's words are in `later-phases/phase4-prompt.md`. This file is the model both phase 4 briefs build.

## What the audit showed

- Nothing reads a status's tier for a number. Burning's 1d6 is 1.16 of a hunter's attack at E and 0.04 at S.
- A same-rank hit is nearly the same number for a hunter and a monster at every rank (hunter 5.5, 14.5, 27.5, 44.5, 63, 84; monster 6.5, 14, 26.5, 44, 69, 102). So one yardstick, "a same-rank hit", measures a status in both directions.
- Monster HP grows 100 times from E to S while a hit grows 15 times.
- To-hit is decided by the build from C up. A flat or slowly growing penalty to a d20 roll matters only where the d20 still matters (an off-stat check or save, an attacker near the target's AC).
- Many paths drop the source, and many instances carry a frozen copy of their definition.

## The model

1. **The power axis is the source's tier**, 0 to 5, as `Source.tier` already holds it: a monster's or hunter's rank (E 0 to S 5), an item's rarity index. It is a snapshot at apply time. A hunter's tier follows the rank on the sheet, as the rank bonus does, so re-evaluation raises both.
2. **An op may carry six values, one per tier.** `tiers` on an op replaces its flat number: six quantities for a numeric op (`damage`, `heal`, `mp`, `fatigue`), six integers for a `mod`. An op without `tiers` is flat, as today. A GM override or a forged status with flat ops keeps meaning exactly what it says.
3. **One function resolves it.** `statusDef(R, instance)` already takes the instance. It returns the ops at the instance's source tier (no source reads as tier 0). `turnOps`, `mods` and `describe` of an instance go through it, so every reader gets scaled numbers with no tier of its own. A definition with no instance (the rules reference, a picker) is described with all six values.
4. **The source travels with the status** everywhere a status travels: to a remote phone, back in its sheet, from an item, from the GM board. No path may drop it.
5. **A status applied by hand with nobody acting takes the target's own rank as its tier** (kind `gm`). In a running fight it keeps taking the combatant whose turn it is. Tier 0 on an S-rank hunter would be a dead number.
6. **A quantity may be a percent of the target's max HP**, written `3%`, for `damage` and `heal` ops only. It rounds to the nearest whole and is at least 1. No built-in uses it (see below). It exists for custom statuses and items.
7. **`checkMod` is deleted.** It is "the older way to write a check modifier". The built-ins use a `mod check` op, and an override writes ops.
8. The stacking rule stays: one instance per key per target, the higher tier wins, the longer duration is kept. That is how a stronger source's status takes the place of a weaker one.

## The curves

Columns are the source's tier, E D C B A S. "Hit" is a same-rank hit (hunter's, from the audit's section 3).

| Status | Op | E | D | C | B | A | S | Why |
|---|---|---|---|---|---|---|---|---|
| Burning | damage per turn | 1d6 | 2d6 | 3d8 | 4d10 | 5d12 | 7d12 | The signature damage status. It keeps the share of a hit it has at E today: about half a hit a turn (averages 3.5, 7, 13.5, 22, 32.5, 45.5 against hits of 5.5 to 84: 0.64, 0.48, 0.49, 0.49, 0.52, 0.54) |
| Bleeding | damage per turn | 1d4 | 1d6 | 2d6 | 2d8 | 3d8 | 4d8 | A chip. It grows, but to about a fifth of a hit from D on (2.5, 3.5, 7, 9, 13.5, 18: 0.45, 0.24, 0.25, 0.20, 0.21, 0.21) |
| Poisoned | damage per turn | 1d4 | 1d4 | 1d6 | 1d8 | 1d10 | 1d12 | Barely scales: one die that grows a size a rank from C. Its weight is its penalty |
| Poisoned | check | -2 | -3 | -4 | -5 | -6 | -8 | The rank bonus of the source's rank (`rules.ts` `rankBonus`): a status moves a roll by what a rank is worth |
| Frightened | check | -2 | -3 | -4 | -5 | -6 | -8 | the same rule |
| Bloodlust | check | -2 | -3 | -4 | -5 | -6 | -8 | the same rule |
| Bloodlust | damage dealt | -1 | -3 | -5 | -9 | -13 | -19 | About a fifth of a same-rank hit. It makes Bloodlust the stronger fear, and it is the one penalty that still bites where to-hit no longer does |
| Blinded | attack | -4 | -6 | -8 | -10 | -12 | -16 | Twice the rank bonus: the strong accuracy penalty |
| Restrained | attack | -2 | -3 | -4 | -5 | -6 | -8 | the rank bonus |
| Slowed | AC | -2 | -3 | -4 | -5 | -6 | -8 | the rank bonus |
| Prone | AC | -2 | -3 | -4 | -5 | -6 | -8 | the rank bonus |
| Hasted | AC | +2 | +3 | +4 | +5 | +6 | +8 | the rank bonus |

Every tier 0 value is today's value except Blinded's (-2 today). Paralyzed, Stunned, Invisible and Stealth have no numbers and do not change.

## What the curves are meant to give

- One status hunter who keeps all three damage statuses on one long-lived target and never attacks deals 0.8 to 0.9 of a hit a round from D up, guaranteed, against 0.95 for a hunter who only attacks at the hit cap. Viable, not better.
- A hunter who keeps Burning up and attacks on the other turns deals about 1.2 of the attacker's damage on a target that lives four rounds or more, and less than the attacker on one that dies in two. Statuses are for bosses and long fights; attacks are for packs.
- One instance per key per target means a second status hunter adds nothing with the same statuses. That bounds the archetype by itself.
- The simulation test must show these three with the real reducer at E, C and S. The bounds are written before the run: against a boss, the rounds the status build needs are within 0.8 to 1.25 of the direct build's; against a normal monster of a pack, the status build is not faster.

## Decided against

- **A built-in percent-of-health status.** Monster HP grows 100 times while a hit grows 15 times, so a percent that rises with the source's rank, as the owner asked for percent effects, is worth 1 hit a turn on an S monster and 3 on an S boss at 5% (0.7 and 2.1 at 3%). It would need a cap and a floor, two more numbers to read at the table. The quantity exists for custom content, and the report gives the arithmetic.
- **Scaling by the target.** the owner: the strength of the user or item decides.
- **A formula.** A table of six values per op is what the card shows.
- **Enforcing "cannot act", disadvantage, saves or speed.** They are text for the table today. That is not scaling.
- **A tier per level.** The rank is the tier the table already reads.

## After the first simulation run (unit A)

The run (400 seeded fights a row, table in `p4/notes-scale-core.md`, step 7) met the bounds at C and S against bosses and at C against a normal monster. It missed in two places, and both misses are the bound's fault, not a curve's.

- **The bound sorted targets by boss or normal. The design sorts them by how long they live.** An S normal monster takes the attackers 8.8 rounds, so it is a long target, and the Burning party is faster there (0.96) as the design says it should be. The bounds are restated by lifetime: on a target the attackers need 4 rounds or more for, each status party's rounds are within 0.8 to 1.25 of the attackers'; on a target the attackers kill in under 3 rounds, no status party is faster.
- **E is outside the bounds.** At E a hunter hits a little over half the time (55% against AC 13), so a status that is sure to tick beats an attack: the status parties need 0.68 and 0.78 of the attackers' rounds on the boss. Those E numbers are today's numbers and this phase keeps them, so that a first session plays as it did. The bounds hold from C up, where the curves are new. The simulation still prints the E rows, and the report tells the owner, with the choice he has: lower the E dice, or have a hunter's ability apply a status only on a hit, which the customization phase can do.

What the simulation assumes, and the customization phase must know: the status hunter spends a whole turn to apply one status and it always lands. An ability that applies a status as well as its damage is worth more than these numbers say.
