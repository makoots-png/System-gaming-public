# Brief: status audit for phase 4 (read only, one new file)

One helper (Opus, heavy-writer), in its own worktree. You change no app code and no test. You write one file, `docs/agent-handoff/p4/status-audit.md`, and commit it (plain message, no AI attribution, no Co-Authored-By). Do not push. Do not start helpers of your own. Never edit anything under `.claude/skills`.

If `git log -1` in your worktree is not the commit your prompt names, run `git reset --hard <that commit>` first.

Read `AGENTS.md` first, then `.claude/skills/principle-explain-the-number/SKILL.md` and `.claude/skills/unslop/SKILL.md`.

## Why (the owner's goal)

"Make sure status effects scale a bit. It's ok for stronger ones to take the place of weaker ones as the game progresses, but even basic status effects should scale into the mid game at least a little." "Some flat damages are good or extremely low scaling. Some should be higher scaling for sure." "The scaling should be largely decided by the strength of the user/item. In the case of the % healths or things like that of course it'll scale with enemy strength but the % should go up with level. I don't mind some items/players/classes be death by a thousand effects rather than just damage output."

The lead will decide each status's curve from your audit without opening the big files. So the audit must be complete, exact and short. Every number carries its `file:line`.

## What is known

- A status instance is `{ key, rounds, def?, source? }` and `source.tier` is 0 to 5, a snapshot at apply time (`src/core/combat/status.ts`). A rank's tier is E 0 to S 5; an item's is its rarity index; the GM's is 0.
- Built-in statuses are the table in `src/core/registry/statuses.ts`. Nothing reads the tier today except the stacking rule (`applyStatus`: one instance per key, the higher tier wins).
- A GM can override or add statuses through `rulesOverrides.conditions` (`src/core/rules.ts`, `src/edge/rules.ts`).

## What to write, in this order

1. **Each status today.** One table row per built-in status: its ops, what the code does with them each turn or while it lasts (which of the description's words are enforced by code and which are only text for the table to follow), and the same row at tier 0, 2 and 5 (they will be identical today; say so once and show the flat number).
2. **Every source that applies a status.** Monsters (count the seeded abilities per status and per rank from `src/core/registry/monsters.ts` through `parseAbility`), items (`src/core/registry/items.ts`), perks and paths, jobs, shadows, quests and rewards, the GM by hand, a hunter by hand on their turn, custom content from the forges (`src/views/custom.js`). For each: the tier the instance gets today and where it is set (`sourceOf`, `sendRoom`, the item use path). List every path where a status is applied with no source or with tier 0 when a better tier is known (an item's rarity, a monster's rank).
3. **The yardsticks.** What a status's damage is measured against, per rank E to S, each with its line:
   - a monster's HP, AC, to-hit and damage (`rankTable`, elite and boss multipliers);
   - a hunter's HP at the level each rank starts (rank levels, HP per level, a typical VIT), and a hunter's weapon damage per hit at that level with a typical build (weapon dice by rarity, stat mod, any damage bonus). Show the arithmetic, not only the result;
   - how many rounds a fight at each rank lasts if a party of three only attacks (expected hits against AC), so that a per-turn status can be compared with one attack.
4. **Where a status's numbers are shown.** Every place in the views that prints a status's ops or description (combat cards, the status picker, the rules reference, the sheet, the GM board, item cards, the bestiary), with the function that builds the text (`describeOps` or whichever). The phase must show scaled values in each.
5. **How an override meets the table.** How `rulesOverrides.conditions` merges with the built-ins, what a custom status with ops looks like in a save, and what a tier-aware definition would have to keep working (an override of `poisoned` that only changes the dice, a custom status with no notion of tier).
6. **Percent of health.** Whether any op, item, ability or perk deals or heals a percentage of HP today. If none, say none.
7. **What the tests pin.** Which tests in `tests/status.test.ts`, `tests/statuses.test.ts`, `tests/encounter.test.ts` and the browser files assert a status's exact number (so the lead knows what a curve will move).
8. **Odd things.** Anything you notice that is wrong or surprising (a description that promises what no code does, two statuses that are the same in play, a status nothing can apply). One line each. No fixes.

## Rules

- Facts only. No design, no curve proposals.
- Under 500 lines. Tables over prose.
- If a number cannot be found, say "not found" and where you looked.

## Done means

The file is committed in your worktree. Final reply under 150 words: the commit hash, the branch name, the three facts you think matter most to the design.

If you are still going after about 50 minutes, commit what you have with a line at the top saying which sections are missing, and reply.
