# Notes, unit 0 (subtract)

- Step 1: save.ts imports STAT_KEYS and StatKey from rules.ts (no cycle; monsters.ts already did). The test that compared the two lists is gone.
- Step 2: `PERK_LABELS` in rules.ts, built from `STATS` for the six stats. Views reach it through `src/edge/rules.ts` (`export *`). maker.js, loot.js, skills.js say "Max HP"/"Max MP" and override those two words at the top of the file; the other three use the table as is. The disagreement is in copy-tasks.md. skills.js and hunter.js also use `PERK_KEYS` in place of their own key lists.
- Step 3: dead and deleted: `carry` (grep `\bcarry\b` over src and tests: only the two definitions) and `statusMods` (grep `\bstatusMods\b`: only the definition in hunter.js and the type in api.ts). Every other Derived field has a reader (init, skillDC, passivePerception, rankBonus, fatiguePenalty, penaltyMod in hunter.js or combat.js; atkMod, dmgMod, fatigueDis in combat.js; bonus, points, stats, mods in hunter.js or custom.js).
- Browser files character, makers, customization, layout, look: all passed on port 3241. Net lines: see the final report.
