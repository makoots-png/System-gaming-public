# Review of the world bible

This review checks every file in `docs/world/` at commit `58d469c4` against the owner's rulings, `docs/agent-handoff/features/economy/design.md`, `src/core/rules.ts`, and internal consistency. Both `bun docs/world/prices.ts` and `bun docs/world/machines.ts` ran before any edits and exited with code 0.

Findings are numbered (`R1` to `R26`) and grouped by topic, ordered from the most severe breaks down to smaller mismatches. Each finding ends with a status line recording what changed and why.

## 1. Contradictions with the owner's rulings

### R1. The revive ladder is contradicted across seven files
the owner's ruling: the first revive is free; after that, one revive on debt; after that none, unless the GM grants one or the hunter uses a revive item bought before death (gold held after death does not help).

Every file in `docs/world/` treated every raising as a paid Resurrection Crystal transaction and allowed repeat crystal debt:
- `story.md` section 3 and section 4 (Act 1): put crystal debt on the first death and treated every raising as consuming a 10-Clear crystal.
- `economy.md` sections 11, 12, 13, and 15 (rows 4 and 13): assumed every raised hunter uses a crystal bought from the Shop and ignored the free first revive and single debt revive.
- `careers.md` section 4 (trap 3), section 6, and section 9: assumed the first raise creates debt and repeat debt raises are normal.
- `power.md` section 8, `README.md` point 7, `seeds.md` hook 14 and section 3 (the primer): omitted the revive ladder and the rule that gold held after death does not help.
- `machines.ts` and `machines.md` (`A death`, `A crystal debt`): allowed raising only via crystal, and allowed unlimited repeat debt revives.
- `prices.ts` line 317 (`raised`): assumed every raised death in a guild gate destroys a Shop crystal.

Status: fixed across `prices.ts`, `economy.md`, `items.md`, `README.md` (`00eae066`), `machines.ts` and `machines.md` (`aa0aeb10`), `power.md`, `history.md`, `careers.md`, `seeds.md` (`c85dd33e`), and `story.md` (`2f4d287f`). Added `Revive standing` to `machines.ts` so invalid revives are unrepresentable, updated `A death` and `A crystal debt`, modeled the three revive stages in `prices.ts`, and made the free first revive still take System collateral in `story.md`.

### R2. Dailies do not recover a hunter, and the bible never says so
the owner's ruling: "Dailies should not recover you." Daily quests do not heal HP, restore mana, or clear fatigue.

No file in `docs/world/` stated this rule (`power.md` section 3, `README.md` the owner's rulings, `machines.ts` `The daily quest`, `economy.md` section 15). Because the setting is Solo Leveling's world, where finishing the daily quest grants Status Recovery (a full heal), leaving this unsaid invited GMs and players to assume dailies heal.

Status: fixed in `README.md` (the owner's rulings), `economy.md` (section 15, row 4), `machines.ts` and `machines.md` (`The daily quest`), `power.md` (section 3), and `story.md` (section 2).

### R3. Every System message and reward must be editable and approved by the GM
the owner's ruling: every System message and every reward must be editable and approved by the GM before players see it.

- `story.md` section 7 ("A player as a sponsor") gave a friend playing the Patron a gold budget "to send to any hunter with a message of one line" and one private quest per arc "with a reward from the Shop", with no GM approval or editing step.
- `story.md` section 6, `README.md`, and `economy.md` section 15 did not state the GM approval gate for System messages and rewards.
- `machines.ts` had no machine for a System message or reward moving from draft to GM approval to delivery.

Status: fixed in `README.md` (the owner's rulings), `economy.md` (section 15, row 16), `machines.ts` and `machines.md` (new machine `A System message or reward`), and `story.md` (sections 4, 6, 7, and 9).

### R4. Stale text still states the overruled half-price consumable rule
the owner's ruling: consumables are not half the price of gear by default.

`economy.md`, "How the numbers are derived" item 1 (line 15), still said "a consumable costs half". `prices.ts` line 13 still kept unused `usedUpShare: 0.5`.

Status: fixed in `economy.md` and `prices.ts` (`00eae066`).

### R5. Stale text still says unsigned hunters live on timed personal gates
the owner's ruling: personal gates are granted by the GM or opened by rare keys, never on a timer.

`history.md` section 6 ("A city", lines 124 to 125) still said: "The rest get one gate in four months and live on personal gates and other jobs." `prices.ts` still carried dead personal-gate parameters and a stale comment on line 337.

Status: fixed in `prices.ts` (`00eae066`) and `history.md` (`c85dd33e`).

## 2. Circular checks in `prices.ts`

`prices.ts` ran 25 checks (`economy.md` "The checks"). Seven were circular, tautological, or disconnected from the tables they claimed to check, and seven more were static ordering guards on constants.

### R6. Six checks test constants against themselves or ignore the table they check
1. `Rights are worth buying` (`WORLD.rightsBid < 1`): tested hardcoded `0.6 < 1`.
2. `Crystal cover` (`coverRate > WORLD.deathAWorldSeat * WORLD.linerGates * 12`): algebraically reduced to `insurerLoad > 1` (`1.1 > 1`).
3. `Rent` (`within(20 * W / (2 * MEDIAN), 0.25, 0.35)`): `W` cancelled out, testing hardcoded `20` against `25 * 4/3`.
4. `House prices` (`within(12 / PRICE_RENTS, 0.04, 0.08)`): tested hardcoded `12 / 200`.
5. `Food` (`within(0.75 * W * WEEKS / MEDIAN, 0.08, 0.15)`): `W` cancelled out, testing hardcoded `0.75`.
6. `A fine deters: unlicensed entry` and `A fine deters: under-declared gold`: both hardcoded `2` and `3` instead of reading the `law` table.

Status: fixed in `prices.ts` and `economy.md` (`00eae066`). Removed the five circular checks (`Rights are worth buying`, `Crystal cover`, `Rent`, `House prices`, `Food`), wired both fine-deterrence checks to `FINES` constants shared directly with the `law` table, labelled the seven constant-ordering checks honestly as `(guard)`, and added four new cross-domain checks (`Twenty-year gold stock is sound`, `Retired scouts do not out-earn liners`, `Boss cores leave Helix its share`, `Table party pace`).

### R7. `The anchor, from the gold` tests a fitted parameter against its own target
`economy.md` (line 82) admitted `residentShopShare` was fitted to balance at a wage of 30, so checking `wageBalanced()` against `WAGE` tested the fitted constant against its own target.

Status: fixed in `prices.ts` and `economy.md` (`00eae066`). Replaced `residentShopShare` with bottom-up Resident medical demand (ER visits, household first-aid/go-bag Health Potions, severe-trauma Greater Health Potions, and critical-illness Elixirs of Life). With zero fitted GDP fractions, Shop sinks destroy 71% of the mint and leave 29% in circulation.

### R8. `Hunters die` has a denominator bug and models zero guild deaths
`prices.ts` assumed 100% of guild deaths were raised (0% permanent liner deaths), applied `carriesCrystal.freelancer` to all public gates while ignoring `carriesCrystal.occasional`, and divided 28.8 permanent deaths (84% of them occasional hunters) by 1,217 `regulars` to report "2.4% of those with a regular seat die for good in a year".

Status: fixed in `prices.ts` and `economy.md` (`00eae066`). Modeled `unrecoverableShare = 0.25` (red-gate wipes, double-gate ambushes, bodies lost past the hour), applied the three revive-ladder stages and each group's own crystal-carry rate, and checked `regularFinalDeathsAYear / regulars` (12 of 1,217, or 1.0%/year), with occasional hunter deaths reported separately.

## 3. Fitted numbers and premise attacks

### R9. Stock-flow impossibility: San Francisco's banks cannot hold 1.0 billion gold
`prices.ts` set `reserveRatio = 0.04`, putting `goldStock` at 960 million (`1.0 billion`) and requiring `needed = 2.4 million`/month. At Year 20's peak net minting rate (2.6 million/month), 20 years of gates could never have accumulated more than ~450 to 470 million gold in San Francisco.

Status: fixed in `prices.ts` and `economy.md` (`00eae066`). Derived `goldStock` by integrating 20 years of net minting (4 Break Years at 40% of Year 4's rate plus 16 years at 3% annual Tide growth), giving 333 million gold (a 1.4% bank reserve ratio against 24 billion in notes and deposits). Because a 20-year-old gold supply grows faster than the 3% Tide, the extra 4.2%/year goes into banks rebuilding thin post-Break-Years reserves and into mild price inflation. Added the `Twenty-year gold stock is sound` check.

### R10. `residentShopShare` is a magic GDP fraction, while four hunter Shop sinks are omitted
`prices.ts` omitted seeds, skill books, escape stones, and cooked food catalysts from city sinks, while assuming all 12,000 hunters (including 10,133 occasional hunters earning 192 gold/year at E) buy 2 new own-rank items per year.

Status: fixed in `prices.ts` and `economy.md` (`00eae066`). Added food catalysts, escape stones, seeds, and skill books to hunter sinks, split gear replacement into active raiders (`0.5` sets/year) and occasional/bench hunters (`0.05` sets/year), and derived Resident spending from concrete medical rates.

### R11. Boss core supply contradicts Helix's 90% crystal share
`items.md` section 3 required a Boss core for every crafted middle item. At 50% crafted gear share, crafting consumed two-thirds of San Francisco's 1,500 monthly boss cores, contradicting `economy.md` section 9 (Helix buys nine tenths of San Francisco's crystal).

Status: fixed in `items.md` (section 3), `prices.ts`, and `economy.md` (`00eae066`). Proposed (needs the owner): common to rare (E to C) middle gear uses standard wall crystal and monster parts, while Boss cores are required for epic, legendary, and mythic (B, A, S) middle gear and signature boss items (43 of 143 B/A/S cores a month, 2.9% of all gates). Added the `Boss cores leave Helix its share` check.

### R12. S-rank liner income assumes 48 S gates a year in a city that gets less than one
`economy.md` section 8 gives San Francisco 0.07 S gates/month (~0.9/year), while section 14 calculated S-rank liner income from 4 S gates/month.

Status: fixed in `prices.ts` and `economy.md` section 14 (`00eae066`). Annotated the S-liner table and "What that buys" to state plainly that an S-rank's regular clears in San Francisco are A gates (~780,000/year), supplemented by the 4 million residency payment and sponsors, while the S row gives the rate per S gate when one opens.

### R13. Retired C-rank scouts out-earn active C-rank liners
`economy.md` (`guild-staff`) and `careers.md` section 1 paid a retired C-rank scout 4,500 gold/month, exceeding an active C-rank liner's 4,394 net/month.

Status: fixed in `prices.ts`, `economy.md` (`00eae066`), and `careers.md` (`c85dd33e`). Reduced a retired C-rank scout's salary to 3,000 gold/month (100 labourer-days, three median wages) and added the `Retired scouts do not out-earn liners` check.

## 4. The player's side: sessions to afford per rank

`economy.md` section 14 falsely claimed the E-rank ratios held at every rank. Because drop sale value falls from 23% of a Clear at E to 3% at S, an unsigned table party's net per session falls from 0.820 Clears at E to 0.620 at S (every goal takes 32% more sessions at S than at E).

### Sessions to afford by rank (unsigned table party, 1 own-rank gate/week)

| What the player wants | Price (Clears) | E (82/sess) | D (239/sess) | C (818/sess) | B (3,206/sess) | A (11,941/sess) | S (46,487/sess) |
|---|---|---|---|---|---|---|---|
| Staple potion | 0.1 | 0.12 | 0.14 | 0.15 | 0.16 | 0.16 | 0.16 |
| Tonic or thrown item | 0.5 | 0.61 | 0.68 | 0.76 | 0.78 | 0.80 | 0.81 |
| Enhancement stone (1 try) | 0.5 | 0.61 | 0.68 | 0.76 | 0.78 | 0.80 | 0.81 |
| Used middle item | 0.7 | 0.85 | 0.95 | 1.07 | 1.09 | 1.11 | 1.13 |
| Crafted middle item | 0.85 | 1.04 | 1.16 | 1.30 | 1.33 | 1.35 | 1.37 |
| Shop middle item | 1.0 | 1.22 | 1.36 | 1.53 | 1.56 | 1.59 | 1.61 |
| Seed | 1.0 | 1.22 | 1.36 | 1.53 | 1.56 | 1.59 | 1.61 |
| Food (whole party; 0.25 each) | 1.0 | 1.22 (0.30 ea) | 1.36 (0.34 ea) | 1.53 (0.38 ea) | 1.56 (0.39 ea) | 1.59 (0.40 ea) | 1.61 (0.40 ea) |
| Expected 1 grade via stones | 1.0 | 1.22 | 1.36 | 1.53 | 1.56 | 1.59 | 1.61 |
| Crafted plus item | 1.275 | 1.55 | 1.74 | 1.95 | 1.99 | 2.03 | 2.06 |
| Escape stone (party; 0.5 each) | 2.0 | 2.44 (0.61 ea) | 2.72 (0.68 ea) | 3.06 (0.76 ea) | 3.12 (0.78 ea) | 3.18 (0.80 ea) | 3.23 (0.81 ea) |
| Gate key at auction (revised: 1 to 2 Clears) | 1 to 2 | 1.2 to 2.4 | 1.4 to 2.7 | 1.5 to 3.1 | 1.6 to 3.1 | 1.6 to 3.2 | 1.6 to 3.2 |
| Full set of 10 middle items | 10.0 | 12.2 | 13.6 | 15.3 | 15.6 | 15.9 | 16.1 |
| Skill book | 10.0 | 12.2 | 13.6 | 15.3 | 15.6 | 15.9 | 16.1 |
| Resurrection Crystal (solo; 4-way pool) | 10.0 | 12.2 (3.0 ea) | 13.6 (3.4 ea) | 15.3 (3.8 ea) | 15.6 (3.9 ea) | 15.9 (4.0 ea) | 16.1 (4.0 ea) |
| **Sessions spent in rank (with daily XP)** | | **~13** | **~21** | **~21** | **~11** | **~7** | **endgame** |
| **Sessions spent in rank (gates only)** | | **26** | **28** | **24** | **12** | **7** | **endgame** |

### R14. Seeds break both caps and the price ladder
`items.md` priced seeds from E (100) to S (75,000) for "+1 permanent stat point" with no rank restriction or limit, enabling A-ranks to buy 119 E-seeds/session, capped E-ranks to accumulate +48 stats/year past their cap, and making A/S seeds a trap compared to own-rank gear.

Status: fixed with proposal in `items.md` sections 1 and 2 (`00eae066`), marked `proposed, needs the owner` (see "For the owner" below): a seed works only at its rank or lower, cannot be absorbed at a hunter's cap, is limited to 5 seeds per rank tier, and scales stat points with tier (E 1, D 1, C 2, B 3, A 4, S 5).

### R15. Master Stonecutter's perk destroys the enhancement gamble
`items.md` section 4 gave a Master Stonecutter "A stone that is not lost when it fails", allowing infinite free retries with one 0.5-Clear stone.

Status: fixed with proposal in `items.md` section 4 (`00eae066`), marked `proposed, needs the owner`: changed Master Stonecutter's perk to a stone that works two times in three (67%, expected cost 0.75 Clears), still lost on failure.

### R16. Gate keys at 5 Clears are a 20x trap
`items.md` section 2 and `power.md` section 4 priced a gate key at 5 Clears at auction, despite a personal gate paying only 0.25 Clears of gold and 0.21 of a world gate's XP.

Status: fixed with proposal in `items.md` sections 1 and 2 (`00eae066`), `economy.md`, and `power.md` section 4 (`c85dd33e`), marked `proposed, needs the owner`: revised auction price to 1 to 2 Clears and gave a keyed personal gate one guaranteed rare crafting material in addition to Bureau privacy and solo titles.

### R17. At B and A rank, levelling outruns 10-Clear goals (skill books and crystals)
In `power.md` section 4, an uncapped party spends ~11 sessions in B rank and ~7 in A rank, while a solo 10-Clear crystal or skill book takes 15.6 to 15.9 sessions.

Status: fixed in `prices.ts` and `economy.md` section 14 (`00eae066`). Generated the full E-to-S `party-goals` table from `prices.ts`, added the `Table party pace` check, highlighted 4-way party crystal pooling (3.0 to 4.0 sessions each), and noted that solo B/A skill books rely on sponsor tips, scenarios, or guild pay.

## 5. Contradictions and stale sentences

### R18. Timeline impossibility in `story.md` ("The crying man")
`story.md` section 5 described a capped D-rank who had done the daily quest "eleven thousand times" over "thirty years", contradicting `history.md` (the present is Year 20).

Status: fixed in `story.md` sections 4 and 5 (`2f4d287f`): changed to about 7,300 runs over twenty years since Year 0.

### R19. Scale mismatch between San Francisco's gates and Earth's gates in `history.md`
`history.md` section 3 said "A few thousand new gates opened worldwide every month" in Year 0 to 3, contradicting San Francisco alone having 1,500 world gates/month in Year 20.

Status: fixed in `history.md` sections 2 and 3 (`c85dd33e`). Framed Day Zero's ~4,000 gates as the opening wave, climbing over Year 0 to 3 into hundreds of thousands of monthly gates worldwide (~1,000/month in a city of San Francisco's size by Year 5, reaching 1,500/month in Year 20 with the 3% Tide).

### R20. Contradictions around awakening, re-awakening, and Councillor Baskin's son
1. `seeds.md` hook 13 had Baskin asking the party to judge her newly awakened son's rank (even though his own window already shows it) and gave him `"Cap: none"` at awakening (contradicting `power.md`, `story.md`, and `machines.ts`). `factions.md` cited an E-rank 300-gold fine.
2. `power.md` section 5 claimed recorded re-awakenings (second fever, +1 rank cap) were trial gates, contradicting `story.md` Act 2 (no fever, `Cap: none`) and `factions.md` (Pavel Dunmore's second fever).

Status: fixed in `power.md`, `factions.md`, `seeds.md` (`c85dd33e`), and `machines.ts` (`aa0aeb10`). Baskin's son awakened with a window reading B-rank (15,000-gold fine, instant political crisis for the Once-Born League, and she asks the party to test his actual combat strength before deciding whether to register him). Reconciled re-awakenings with trial gates (`proposed, needs the owner`): passing any trial gate causes a brief second fever, and the Hosts run both step trials (+1 rank cap, accounting for Pavel Dunmore and the <30 recorded re-awakenings) and open trials (`Cap: none`).

### R21. Smaller number, date, and cross-reference mismatches
All twelve mismatches listed in the initial review:
- `economy.md` line 82 (`0.044%` / `30` vs `0.0004` / `31`): fixed by replacing fitted GDP share (`00eae066`).
- `items.md` line 160 ("three quarters" vs 63%): updated to ~71% matching `prices.ts` (`00eae066`).
- `README.md` line 71 ("twenty checks" vs 25): updated to 23 checks matching `prices.ts` (`00eae066`).
- `economy.md` section 15 S-gate rate ("every three years" vs 0.9/year): updated to ~once a year (`00eae066`).
- `economy.md` `gates` vs `guild-books` rounding mismatch (`nice()` vs `whole()`): both now use `whole()` (`00eae066`).
- `careers.md` section 3 (`312`, `2,812`, `937` vs `313`, `2,813`, `938`): aligned to `economy.md` (`c85dd33e`).
- `seeds.md` Quiet Mile ("day 7" for D-rank monsters): fixed to day 6 (`c85dd33e`).
- `careers.md` section 9 D-rank ageing (used level 10's `g = 1.38` instead of level 19's `g = 1.75`): updated to body of 34 at 45, 43 at 60, lifespan ~125 (`c85dd33e`).
- `seeds.md` hook 10 ("Eleven missing crystals" raising two unawakened reclaimers): connected explicitly to Dr Imre Solis's ritual and two missing unregistered Scarside hunters (`c85dd33e`).
- `power.md` line 40 daily quest cross-ref (`section 4` -> `section 3`): fixed (`c85dd33e`).
- `economy.md` section 15 out-of-order row numbers (`1, 15, 2...`): renumbered 1 to 16 (`00eae066`).
- `history.md` timeline table blank line breaking markdown table: fixed (`c85dd33e`).

Status: all twelve fixed.

## 6. Story read as a GM (`story.md`)

### R22. Act 2 trial gate can strand a PC at level 9 and is ambiguous on solo vs party entry
`power.md` made a trial gate solo, `story.md` made it shared, and `story.md` left any hunter who tried to save someone capped at level 9 forever.

Status: fixed in `story.md` Act 2 (`2f4d287f`), marked `proposed, needs the owner`: the open trial admits the whole party together into a shared sequence of their worst days; a hunter who tries to save someone hits a 60-second escalating reset loop until they either walk past the victim (passing uncapped) or take a step-trial side exit (+1 rank cap so they keep levelling, with an open trial re-offered at the next cap for higher collateral).

### R23. Act 3 trigger contradicts Okoro and Osei already being uncapped
`story.md` Act 3 and `machines.ts` (`The season`) started scenarios when uncapped hunters existed, ignoring Okoro and Osei.

Status: fixed in `machines.ts` (`aa0aeb10`) and `story.md` Act 3 (`2f4d287f`), marked `proposed, needs the owner`: lone hidden uncapped hunters never pulled enough audience to justify scenario production costs; a full uncapped party rising publicly crosses the Hosts' 10,000-viewer threshold and triggers the second half.

### R24. Acts 3, 4, 5, and 6 were too thin to run at the table, and some horror was told rather than played
Act 1 also put third-raising collateral ("mother does not know them") on the first raising.

Status: fixed and boldly expanded in `story.md` (`2f4d287f`), with all new canon marked `proposed, needs the owner`:
- Fixed Act 1 collateral to match section 3 (first free revive takes a cherished personal memory; moved "mother forgets you" to a third-raising arc).
- Added playable horror scenes where player choices trigger the reveal in Acts 1, 2, 3, and 4 (the barricaded warren, the Value map offer, the Scarside 400 evacuation-vs-cordon dilemma, the transit concourse before Sorin speaks).
- Added San Francisco faction reactions to Scenarios in Act 3 and planted concrete Okoro/Osei clues across Acts 3 to 5.
- Named and fleshed out Captain Yael Sorin (Season 9) and exact Keepsakes terminal rules/prices (1 to 3 levels for own collateral, 50 gold for stranger keepsakes) in Act 4.
- Named the five Season 1 Finale champions with distinct roles and regrets, gave each San Francisco faction a concrete coalition demand, and wrote Branch B (`Earth is lost`) matching `machines.ts` in Act 5.
- Built the playable Control Room encounter (12 level-15 Hosts pulling live System overrides, Host #4 Maren the potion designer, and the three screens at the Seat) in Act 6.
- Deepened three flat factions in `factions.md` (`c85dd33e`): Redline's third-life crystal escorts, Vantage oddsmaker Soren Kalt tracing The Bettor's 41-win streak, and The Fallen as crystal-strippers; added two table-ready places in `seeds.md` (The Salt Locker and The Glass Gallery).

## 7. State machines (`machines.ts` / `machines.md`) vs prose

### R25. Existing machines contradict prose or omit transitions
All seven machine faults listed in the initial review (`A death` and `A crystal debt` vs revive ladder; `A break` "steady tone" vs `history.md` and E/D cordon failure; `A world gate` unguarded `Cleared -> Closed` and missing `Second area open` retreat/wipe; `A guild contract` missing `Injured` and `dies for good` paths plus undocumented `Retainer stopped`; `A person and the System` missing step trial; `The daily quest` missing no-recovery rule and Penalty Zone alignment; `The season` trigger).

Status: all seven fixed in `machines.ts` and `machines.md` (`aa0aeb10`), plus `careers.md` updated to document `Retainer stopped` (`c85dd33e`). Tightened `faults()` in `machines.ts` to refuse any unguarded step that shares a state and event with a guarded step.

### R26. Lifecycles in prose that have no state machine
Added all seven missing lifecycles to `machines.ts` and regenerated `machines.md` (`aa0aeb10`): `Revive standing`, `A System message or reward`, `Sponsor patronage`, `A guild gear lien`, `A party bond`, `Shadow extraction`, and `A keepsake`. Total machines: 21, all validated with exit 0.

## 8. What held

Checking the bible confirmed a great deal of Fable's draft that works well and was kept intact:
- **Writing discipline:** plain, concrete prose throughout, with zero em dashes and zero AI stock vocabulary.
- **Anchor and everyday pricing:** 1 gold = a street meal, 30 gold = a labourer's day, 1,000 gold = median month, 120,000 gold = Saltmarket flat, and rents driven by Bureau response times all hold cleanly.
- **Faction architecture:** every main faction in `factions.md` has a sharp want, a scarce prize, an internal split, named hooks, and a meeting scene; the section 8 matrix aligns with the entries.
- **Ageing math for named celebrities:** Tobias Reinholt, Amara Nkemelu, Tomas Reyes-Lindahl, and Wen Castellanos all match `g = 1 + (level - 1) / 24` from Day Zero; Sabine Okoro's timeline matches across `history.md` and `fame.md`.
- **Guild gate books and reclaimers:** a guild's 0.82 Clears net per gate and 1,746 reclaimers (matching Local 7's ~1,700) hold cleanly.
- **No cameras inside gates + System titles as unforgeable proof:** drives Aurelian, tellers, sworn accounts, and title value cleanly.
- **Core horror twist and tone:** the Hosts as broadcast staff, gold as audience tips, monsters as lost seasons' casts, Season 1's champions as the Finale, and no off switch form a strong, bleak spine.

## For the owner

These decisions belong to the owner (rules of the game or canon choices not yet ruled on). Each lists a recommendation.

1. **Seed rules (`items.md` sections 1 and 2):** without rank gating and a cap, high-rank hunters can spam 100-gold E-seeds and capped hunters can bypass their cap. **Recommendation:** adopt the proposal in `items.md` (rank-gated, blocked at cap, max 5 per rank, scaling points E 1 / D 1 / C 2 / B 3 / A 4 / S 5).
2. **Gate key value and perk (`items.md` sections 1 and 2, `power.md` section 4):** at 5 Clears a key is a 20x trap. **Recommendation:** drop auction price to 1 to 2 Clears and have a keyed personal gate guarantee one rare crafting material.
3. **Boss core crafting requirement (`items.md` section 3):** requiring a boss core for E-to-C middle gear breaks Helix's 90% crystal supply. **Recommendation:** require boss cores for B/A/S middle gear and signature items only; E-to-C middle gear uses wall crystal and monster parts.
4. **Master Stonecutter perk (`items.md` section 4):** an indestructible stone breaks the enhancement gamble. **Recommendation:** make Master Stonecutter stones succeed 2 times in 3 (67%), still lost on failure.
5. **Step trials vs open trials and second fevers (`power.md` section 5, `machines.ts`):** reconciles recorded re-awakenings (second fever, +1 rank) with uncapped trial gates. **Recommendation:** keep both trial types and have passing any trial cause a brief second fever.
6. **Act 2 trial gate failure (`story.md` Act 2):** leaving a heroic PC permanently capped at level 9 breaks a campaign. **Recommendation:** adopt the 60-second escalating reset loop with a step-trial side exit so players feel the horror without getting stranded.
7. **Why Act 3 scenarios start after the party uncapped (`story.md` Act 3):** Okoro and Osei were already uncapped. **Recommendation:** keep the 10,000-viewer broadcast threshold triggered by a full public party.
8. **New story canon and faction hooks (`story.md` Acts 3 to 6, `factions.md`, `seeds.md`):** Captain Yael Sorin (Season 9), Keepsakes level prices (1 to 3 levels; 50 gold stranger bins), the five named Season 1 champions, Branch B (`Earth is lost`), Host #4 Maren, the three Seat screens, first-return amnesia, Redline's third-life escorts, Vantage's Soren Kalt / The Bettor streak, Fallen crystal-strippers, the Salt Locker, and the Glass Gallery. **Recommendation:** keep all of them; trim or rename any NPCs you want to customise for your table.
9. **Daily stat point vs level stat points, and raising costing a level (`economy.md` section 15 rows 4 and 14):** carried over from Fable's review for the owner and the lead.

## Proposed, needs the owner

Complete index of every rule, number, or canon addition invented beyond the owner's settled rulings, with file and section:

- **Rank-gated, cap-respecting, tier-scaled seeds (max 5 per rank; E 1, D 1, C 2, B 3, A 4, S 5 stat points; `seedsAYear = 2`):** `items.md` sections 1 and 2; `prices.ts` (`WORLD.seedsAYear`, `WORLD.seedClears`).
- **Gate keys priced at 1 to 2 Clears at auction and guaranteeing one rare crafting material:** `items.md` sections 1 and 2; `power.md` section 4.
- **Boss cores required only for B, A, and S middle gear and signature boss items (E to C middle gear uses wall crystal and standard parts):** `items.md` section 3; `prices.ts` (`craftedHighGearAMonth`).
- **Master Stonecutter perk changed to 67% success (2 in 3), still lost on failure:** `items.md` section 4.
- **Passing any trial gate triggers a brief second fever; Hosts run both step trials (+1 rank cap, accounting for recorded re-awakenings) and open trials (`Cap: none`):** `power.md` section 5; `factions.md` section 2 (Pavel Dunmore); `machines.ts` (`A person and the System`).
- **First-return amnesia (public medical name for first-revive collateral gaps):** `power.md` section 9; `story.md` section 3.
- **Redline third-life crystal escorts and Kofi Stein's Stair side-deals:** `factions.md` section 2 (Redline); `story.md` section 5 (`Third-life escort`).
- **Vantage oddsmaker Soren Kalt and The Bettor's 41-win betting streak:** `factions.md` section 4 (Vantage); `story.md` section 5 (`The unbeatable punter`).
- **The Fallen operating as crystal-strippers targeting pre-bought crystals:** `factions.md` section 6 (The Fallen).
- **Two new San Francisco places (The Salt Locker in Tidewall; The Glass Gallery on floor 38 of Aurelian Tower):** `seeds.md` section 2 (places 11 and 12).
- **Act 2 shared party open trial and 60-second reset loop / step-trial exit to prevent stranding a PC at level 9:** `story.md` section 4 (Act 2).
- **Act 3 10,000-viewer broadcast threshold explaining why Okoro and Osei did not trigger scenarios, San Francisco faction reactions to scenarios, Scarside 400 evacuation-vs-cordon dilemma, and planted Okoro/Osei Act 6 clues:** `story.md` section 4 (Act 3); `machines.ts` (`The season`).
- **Act 4 concourse reveal, Captain Yael Sorin (Season 9), Earth as Season 12, and Keepsakes terminal prices (1 to 3 levels for own collateral, 50 gold clearance bins):** `story.md` section 4 (Act 4); `machines.ts` (`A keepsake`).
- **Act 5 five named Season 1 Finale champions (Kaelen Vane, Sera Lin, Dario Moss, Tova Hren, Branek), San Francisco faction coalition demands, and Branch B (`Earth is lost`):** `story.md` section 4 (Act 5).
- **Act 6 Control Room encounter (12 level-15 Hosts using live System overrides, Host #4 Maren the potion designer, and the three Seat screens: Schedule, Cast & Caps, Ledger):** `story.md` section 4 (Act 6).

## Fable's reply and the owner's rulings on it (Nov 20)

I ran both scripts on Neon's head and read the handoff, this file, and the changed sections. The findings in R1 to
R26 are real and the fixes stand, with three exceptions that the owner has now ruled on.

- **Gold (R on the gold stock).** Neon was right that my 1.0 billion reserve was impossible. The fix left gold at
  1.4% of the city's money and drew the check's band around that result. The owner's ruling: "Hunters tend to be
  richer, but an E rank would be only a bit richer than a day laborer despite not having to work as often. Dollars
  are replaced with gold." The labourer's day is now 12 gold (0.12 of an E Clear), San Francisco has 400 world gates a
  month, a guild E-rank nets 1.4 labourer's months for four gates, and twenty years of gates leave gold at 8.6% of
  the city's money. The check's band is now 5% to 40%, with its reason.
- **Two rulings in the lead's design that neither of us had applied.** A raising costs 3.33% of the hunter's
  level, rounded up (ruling 9). The app holds no level cap for the players' hunters and builds no trial gate
  (ruling 10). The owner confirmed that the trial is a story event the GM runs when the party reaches level 9, and
  that nobody fails it for good.
- **For the owner, items 1 to 7: approved** ("Yes"). Seeds are rank-gated, blocked at the cap, limited to five a
  rank and scale by tier. Keys sell for one to two Clears and hold a rare material. Boss cores are needed only for
  B, A and S middle gear and signature items. A Master Stonecutter's stone works two times in three. There are step
  trials and open trials, and passing either causes a second fever. Act 2 uses the reset loop. Act 3 starts at
  10,000 viewers. The "proposed" marks on those passages are removed.

Still open for the owner: item 8 (Neon's new story canon and faction hooks, marked in `story.md`, `factions.md` and
`seeds.md`), and the daily quest's stat point against the points a level gives.

## Act 1 first-mission redesign (Nov 26)

the owner ruled (t174u, t175u) that the unique horror trial happens in Mission 1, replacing Goblin Den and granting both
access to the Mythic/Epic unique class offer and the lifted level cap (`Cap: none`).

**Settled updates applied across `docs/world/`:**

- **Mission 1 (`The Empty Seat` inside `Tidewall Cannery Gate`, `story.md` Act 1 and section 5, `power.md` section 5,
  `README.md`):** a rogue sponsor pays a Season 12 Host off the books to stage an unscheduled, old-format open trial
  inside a routine E-rank gate, prepaying a Wave 1 vault package (three Mythic and three Epic unique classes plus an
  early cap waiver). Clearing Fight 2 (`Head Usher` and `Ushers`, archived-season casts) lifts the cap with a brief
  second fever, opens the Wave 1 class offer, awards the `Guest` title (`+1 Discipline`), and leaves one blank line
  below `Cap: none` (no `Viewers` count yet). Sabine Okoro, Marek Osei, and Pavel Dunmore remain rare because the
  trial is an off-schedule exception paid for by one buyer.
- **Act 1 continuation and Act 2 Network Audit (`story.md` Acts 1 and 2, `power.md` section 5, `machines.ts`,
  `machines.md`):** Levels 3 to 9 follow broke Level 3 E-ranks hiding `Cap: none` and impossible classes through
  Session 2's second-fever scrutiny, Session 3's quiet warren, the crying man, and street-break witness risk. Crossing
  into D-rank at Level 10 triggers an Act 1 cover-up choice. Crossing into C-rank at Level 20 breaks the single
  re-awakening cover story and triggers the Hosts' wrong-colored gate and worst-hour memory room as a formal **Network
  Audit** that ratifies the off-books grant onto the public Season 12 feed (`Viewers` and `Value: XX XP`).
- **Display-only cap in app (`story.md` section 4, `power.md` section 5, `README.md`):** hard level caps remain out of
  XP math (`gainXp` ignores `capDisplay`, and `src/core/hunter/level.ts` stays the sole owner of `MIN_LEVEL` and
  `MAX_LEVEL`). Each hunter holds a per-hunter, rank-derived display chip (`Cap: 9`, `Cap: 19`, `Cap: none`, or
  hidden).
- **World state charts (`machines.ts`, `machines.md`):** added the off-books sponsor trial transition from
  `Hunter, below the cap` to `Uncapped` (`A person and the System`), added `Off-books grant` before `Watched` in
  `Sponsor patronage` so Mission 1 does not turn on `Viewers` before Act 2's Network Audit, and updated `The season`
  to reference the Act 2 Network Audit.
- **Read-aloud primer sync (`seeds.md` section 3):** updated British spellings (`labourer` to `laborer`, `licence` to
  `license`) so the primer matches the app's American spelling lint rules.

**Open for the owner from the Act 1 redesign:**

1. **Buyer handle (`story.md` Act 1 and section 7):** settled default is `The Bettor` (ties Mission 1 directly to
   Soren Kalt's Act 2 arc without adding a seventh viewer and keeps `The Patron` for a friend-player in Act 3). Open
   for the owner to switch to `The Underwriter` or override `The Patron`.
2. **Session 1 closing line (`story.md` section 2 and Act 1):** settled default ends on one blank line below
   `Cap: none` (preserving Act 2's broadcast reveal) rather than displaying `Viewers: 1` at the end of Mission 1.
3. **Display-only per-hunter `capDisplay` (`power.md` section 5):** settled default keeps `gainXp` uncapped and shows
   a per-hunter rank-derived chip. Open for the owner only if he wants hard XP enforcement or prefers no cap chip at
   all.
4. **Act 2 Network Audit side-door penalty (`story.md` Act 2):** taking the side door at Level 20 must carry a real
   cost, never a free pass off camera (proposed: restores a cap at the top of the current rank with a later re-offer,
   or exacts collateral or sponsor debt).
5. **Unique classes GM lore (`power.md` section 7):** player screens stay literal (`"Six classes are open"`). Open for
   the owner: (a) whether unique classes are windows vacated by earlier seasons' hunters, and (b) what a Bureau crystal
   reading shows for a hunter holding a Mythic or Epic class.

