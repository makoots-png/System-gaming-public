# Notes: the rework's design on paper

Written as I go. What I was unsure of, and which principle changed a choice.

## Step 1, the timeline

- Principle that changed a choice: `principle-model-the-domain`. A stun first looked like a status the turn loop checks ("skip this turn"). It became `at = max(at, until)`, a floor on the next-action time, so the timeline has no stun branch at all.
- Unsure: per-round damage settled pro rata at the bearer's turn start. It keeps a damage status's total the same for a fast and a slow bearer, but a fast bearer sees more, smaller ticks. If the table finds small ticks fiddly, the lever is to settle only on whole rounds crossed (the script would then print a per-whole-round table).
- Unsure: the opening roll (d20 plus Instinct moves the first `at` within one interval). It keeps a die at the start of a fight as the table expects. It could be dropped (everyone starts at 0, ties by speed) with no other change.

## Step 2, stats

- Principle that changed a choice: `principle-model-the-domain`. Monsters were first a column table (HP, armor, power per rank). They became the same `derive` over a stat split, so "a same-rank hit" is one yardstick by construction and `rankTable` loses five columns instead of gaining new ones.
- Changed a fixed number: 12 creation points. Without them every E build is 2 points from every other.
- Unsure: `HP_VIT = 0.6` and `GROWTH_DIV = 18`. The tank has 1.07 times a cannon's HP at E and 2.17 times at S, because Vitality's effective points grow with rank while the kit's armor does not. The E tank leans on its kit alone. If the simulation finds the E tank too soft, raise `HP_VIT` before `HP_BASE`.
- Unsure: speed builds take Strength second. With Instinct second they had `phys` 6 at every rank and dealt nothing at S.

## Step 3, one use

- Principle that changed a choice: `principle-type-system-discipline`. Avoidance first had four flags (dodge, resist, escape, none). It is now `Delivery`, a three-member union, and the outcome is computed, so "caught" is never stored where it could disagree with the places.
- One d20 per target does both reaction and crit. I chose this over a separate strike die to keep one die per target per use. If the owner wants the attacker to roll too, the lever is a second die for crit only; nothing else moves.
- Unsure: the target's token moves when it dodges. It is first-principles (it ran), but on a crowded map a group dodge could block itself. Core picks tiles in a fixed order, so it is deterministic; the simulation should count how often a dodge is blocked.
- Unsure: `undo` replacing `prev`. Keeping the previous `Running` is one value, but a room's players may have seen the undone state for up to 800 ms.

## Step 4, the extras

- Principle that changed a choice: `principle-explain-the-number`. Movement first cost a flat 50 per stride, which let a speed build cover 12 tiles a round while its dodge rate was 8.5. A tile now costs 100/6 of a standard action for everyone, so walking and dodging move at exactly the same rate. The table in the script is what caught it.
- Unsure: the stagger bar growing 50% after each stagger. It is the cheapest way to hold "one or two staggers a fight" at every rank, but it is a rule the table must remember. The alternative is a cooldown on staggering.
- Unsure: `CHANNEL_EXP = 1.45`. Five turns is 6.4 times the base, 73% of a same-rank boss's HP. The owner asked for a one-shot after five turns, so this may be too low for him; the lever is the one constant.
- Unsure: threat decay of 10% a round. No measurement behind it yet; the simulation should report how often the suggested target changes.

## Step 5, the map

- Principle that changed a choice: `principle-boundary-discipline`. The `step` and `cast` messages carry the `now` the player saw, so a stale tap is refused at the boundary instead of resolving against a fight that moved on. That also makes them idempotent with no applied-id list of their own.
- The doc's row cap drops from 60 to 32 because a worst-case row is 492 characters and 33 rows fill the server's cap. Measured in the script, not guessed.
- Unsure: a 20 by 14 default grid. It comes from a phone screen at a readable token size, not from a measurement of the real UI, which does not exist yet.

## Step 6, balance

- Principle that changed a choice: `principle-explain-the-number`. The first paper check had the speed build beating the tank at every rank, because a quick action cost 0.6 of a standard and dealt full damage. The fix is a rule, not a tuned number: a cost buys a share of the damage budget (quick 0.7, standard 1, heavy 1.5). The quick cost also went from 60 to 70 so two quick actions cost more than one standard.
- Tuned by the paper check, in this order: `COST.quick` 60 to 70, the damage share by cost, `GROWTH_DIV` 18 to 24, `HP_VIT` 0.6 to 0.5, `MONSTER.normal.power` 0.8 to 0.7. Each moved a named row of section 6 and nothing else.
- The three numbers I trust least: `CHANNEL_EXP` 1.45 (no measurement behind the payoff, only the owner's "should probably oneshot someone"), `THREAT_DECAY` 0.1 a round (no measurement at all), and the E cannon's mana blast at 59% of a tank's max HP expected (the bound is 60%, so it sits on the line).
- The paper check models no healing, no taunt, no shield and no status, so every one-on-one row is the floor of what a build can do. The simulation will show more.

## Step 7, the proposals and the work

- Principle that changed a choice: `principle-sequence-verifiable-units`. The build order puts the six pure modules before the reducer and the simulation before any screen, so each unit ends in a check the owner can see.
- No true damage: an ability that ignores both Armor and Resist makes the whole defence layer optional for whoever has it, and a GM who wants it can write 100% penetration.
- Left for the lead: `AGENTS.md` is not edited here (not in the brief's file list). Section 7.3 lists the rows and recipes it needs.
