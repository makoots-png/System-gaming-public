# Notes: inventory for the combat and stats rework

Written as I go. What I could not check, and why.

## Step 1

- Started from commit 3cc275f. Read the brief, the helper rules, AGENTS.md, the rework notes, p4/design.md, the fight chart and the four skills the brief names.
- Step 1 committed as 7064f9e. The `use` path, the attack buttons and every roll were read in `src/views/combat.js`; the rest of that 1,026-line file (the card HTML from line 605 on, the build form) was skimmed by grep only.

## Step 2

- The numbers table came from a bun script in the session scratchpad that imports the real `RULES`, `pathBonus`, `formulaHpMax`, `formulaMpMax`, `mod` and `statBlock`. It copies Auto's placement rule from `custom.js:278` by hand, since that function lives in a view. The Vanguard rows match the phase 4 audit's HP column (p4/status-audit.md:169-176).
- "Typical build" is an assumption: Auto-placed points, the first perk of each tier, a 1d8 weapon, no other gear or title. A GM can hand-place points differently.
- The 21-file list came from grep for the six keys, `STAT_KEYS`, `STATS`, `PERK_KEYS`, `BONUS_KEYS`, `StatKey`, `capacityStat` and `checkBonus`. A file that names a stat only inside a string I did not search for would be missed. `tests/` and `scripts/` were not counted.

## Step 3

- Counts of built-in content came from a scratchpad script over `BUILT_IN_STATUSES`, `SKILL_SEEDS`, `SHOP_ITEMS`, `LOOT_ITEMS`, `STARTER_GEAR` and `SEEDS`. The word search over descriptions is case-sensitive, so "Speed" in three status descriptions was found by reading, not by the script.

## Step 4

- The doc sizes came from a scratchpad script that builds encounter docs and runs `DOCS.encounter`. The server counts `JSON.stringify(data).length` (server.ts:312), which is what the script measured.
- Not checked: what `putDoc` does with a 413 for a doc. Not checked: whether `fill` in save.ts keeps keys the example hunter lacks.

## Step 5

- `bun test tests/status-sim.test.ts` passed 8 of 8 in 1.53 s and `bun test tests/encounter-model.test.ts` 3 of 3 in 2.90 s, one run each, on this box while a CI run may have shared it. Test counts are `test(` lines, so a test inside a loop counts once.
- The brief names `docs/agent-handoff/p4/status-sim.test.ts`; the file is `tests/status-sim.test.ts`.
- The e2e list is by grep for initiative, `combat.add`, `startFlow` and "encounter"; how many tests in each file start a fight was not counted. No Playwright was run, as the brief says.

## Step 6

- The summary was added to the top of inventory.md and folded into the step 6 commit with `--amend`, to keep the brief's six or seven commits. Nothing was pushed.
- Section 6 lists facts and traps, not designs. The one open choice it names for the lead is in section 4.4: a new campaign (the rework notes) or a migration that keeps a player's hunters (AGENTS.md and the helper instructions).
