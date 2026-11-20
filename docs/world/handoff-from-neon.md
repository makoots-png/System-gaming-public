# Handoff from Neon

## To the lead session (`session_01XcvNgTnz9JGz3oJ2EuJ9ig`)

**Head commit (before this handoff):** `62603706` on branch `world-bible` (starting from `58d469c4`).

### What I checked and found

I audited every file under `docs/world/` against the owner's settled rulings, `docs/agent-handoff/features/economy/design.md`, `src/core/rules.ts`, and internal consistency, and ran both `bun docs/world/prices.ts` and `bun docs/world/machines.ts`. Full findings are in `docs/world/review.md` (`R1` to `R26`).

Three rules from the owner had direct code and setting implications:
- **Revive ladder:** first revive free, second on debt, third+ only a GM grant or a pre-bought Resurrection Crystal within an hour (gold held after death does not help). Every file in `docs/world/` and both scripts contradicted this by assuming every raising consumed a paid crystal and allowing repeat crystal debt.
- **Dailies do not recover you:** no file stated that finishing the daily quest never heals HP, restores mana, or clears fatigue. Also, `machines.ts` (`The daily quest`) cleared `Penalized` on finishing today's daily instead of the Penalty Zone quest (`src/core/hunter/penalty.ts`).
- **GM approval of System messages and rewards:** every System message, viewer tip, scenario, and reward must be editable and approved by the GM before players see it. Neither `story.md` nor `machines.ts` enforced that step.

On the economy and items side:
- `prices.ts` had a stock-flow impossibility (1.0 billion gold in bank reserves after only 20 years of gates at 2.6M/month net), a fitted `residentShopShare` GDP fraction, a denominator bug in `Hunters die` (0% guild deaths, occasional deaths divided by regulars), five circular checks (`Rights are worth buying`, `Crystal cover`, `Rent`, `House prices`, `Food`), and two fine checks hardcoded away from the `law` table.
- Four sinks from `items.md` (seeds, skill books, escape stones, food catalysts) were missing from `prices.ts`, while `sinkGear` assumed 10,133 occasional hunters buy two own-rank items a year.
- Player-side math across ranks E to S showed net per session drops from 0.82 Clears at E to 0.62 at S (contrary to `economy.md`'s claim that E ratios hold everywhere), and B/A levelling (~11 and ~7 sessions) outruns solo 10-Clear crystals and skill books (15.6 to 15.9 sessions), whereas 4-way party crystal pooling stays healthy at 3.0 to 4.0 sessions each.
- `items.md` had three game-breaking holes: un-gated seeds (high ranks spamming 100-gold E-seeds and capped hunters breaking their cap), Master Stonecutter's indestructible enhancement stone, and boss cores required for E-to-C middle gear (consuming 67% of Carrow's boss cores against Helix's 90% crystal share).

### What I changed and why

- **No app code or tests changed** (all edits are under `docs/world/`).
- **`economy.md` section 15 (the lead's sync table):** renumbered cleanly 1 to 16, added explicit rows for the owner's revive ladder (tracking revive standing in core), dailies not recovering vitals, and GM edit/approval queuing for every System message and reward; fixed the S-gate frequency note (0.9/year, not every three years).
- **`prices.ts`, `economy.md`, `items.md`, `README.md` (`00eae066`):** replaced the fitted GDP fraction with bottom-up Resident medical demand (ER, household, trauma, Elixirs), derived Carrow's 20-year cumulative gold stock (333M, 1.4% bank reserve ratio, +4.2%/year drift above the 3% Tide), added the four missing hunter sinks, fixed `sinkGear` and the `Hunters die` denominator, removed circular checks, added four cross-domain checks, and generated a full E-to-S `party-goals` table.
- **`machines.ts` and `machines.md` (`aa0aeb10`):** added `Revive standing`, `A System message or reward`, `Sponsor patronage`, `A guild gear lien`, `A party bond`, `Shadow extraction`, and `A keepsake` (21 machines total), aligned `The daily quest` with `penalty.ts`, and tightened `faults()` to catch unguarded event collisions.
- Both `bun docs/world/prices.ts --write` and `bun docs/world/machines.ts --write` exit 0.

### Questions for the owner (and items waiting on him for implementation)

See `docs/world/review.md` ("For the owner" and "Proposed, needs the owner") for full details:
1. **Seeds (`items.md` sections 1 and 2):** approve rank-gating, cap blocking, max 5 per rank, and tier-scaled stat points (E 1, D 1, C 2, B 3, A 4, S 5)? Recommended: yes.
2. **Gate keys (`items.md` sections 1 and 2):** drop auction value from 5 Clears to 1 to 2 Clears and guarantee one rare crafting material in a keyed gate? Recommended: yes.
3. **Boss cores (`items.md` section 3):** require boss cores only for B/A/S middle gear and signature boss items so Helix keeps its 90% share? Recommended: yes.
4. **Master Stonecutter (`items.md` section 4):** change indestructible stone to 67% success (2 in 3), still lost on failure? Recommended: yes.
5. **Open items carried over (`economy.md` section 15 rows 4 and 14):** raising stat points per level against the daily's +1 point/day, and whether a raising also costs one level.

---

## To Fable (`session_01XcvNgX1DRapcRHiMXR4GBL`)

**Head commit (before this handoff):** `62603706` on branch `world-bible` (starting from `58d469c4`).

### What I checked and found

Your draft had a strong spine, clean prose (zero em dashes and zero AI tells across all eleven files), solid everyday pricing, well-structured factions, and consistent ageing math for every named celebrity. `docs/world/review.md` section 8 lists everything that held and stayed untouched.

The main issues I found (`review.md`, `R1` to `R26`):
- **Three new rulings from the owner** conflicted with the draft: the revive ladder (first free, second on debt, third+ only GM grant or pre-bought crystal within an hour; gold held after death does not help), dailies never recovering HP/mana/fatigue, and GM editing/approval of every System message and reward before players see it.
- **Economy premises and checks (`prices.ts`, `economy.md`):** 1.0 billion gold in bank vaults was stock-flow impossible over 20 years of gates; `residentShopShare` was fitted (and misquoted as 0.044% vs 0.040%); five checks were circular and two fine checks hardcoded literals away from `law`; `Hunters die` had 0% guild deaths and divided occasional deaths by regulars; retired C-rank scouts (4,500) out-earned active C-rank liners (4,394); S-rank liner math assumed 48 S gates/year in a city getting 0.9/year; and E-rank session ratios did not hold at S (0.82 down to 0.62 Clears/session).
- **Item exploits (`items.md`):** un-gated seeds broke both caps and the price ladder; Master Stonecutter's indestructible stone broke the enhancement gamble; boss cores on every middle item consumed two-thirds of Carrow's boss cores; gate keys at 5 Clears were a 20x trap.
- **Stale sentences and cross-file contradictions:** `story.md`'s crying man had 30 years / 11,000 dailies in a Year 20 world; `history.md` still said unsigned hunters lived on personal gates and put worldwide gates at "a few thousand a month" against Carrow's 1,500/month; `economy.md` line 15 still cited half-price consumables; Councillor Baskin's son in `seeds.md` hook 13 awakened with `"Cap: none"` and asked the party to judge a rank his own window showed; `power.md` section 5 contradicted itself on second fevers and re-awakenings vs trial gates; `seeds.md` Quiet Mile put D-rank monsters on day 7 instead of day 6; `careers.md` section 9 aged a level-19 D-rank using level 10's `g = 1.38`.
- **Story runnability and machines:** Act 1 put third-raising collateral on the first raising; Act 2 could strand a heroic PC at level 9 forever; Act 3's trigger ignored Okoro and Osei already being uncapped; Acts 3 to 6 were thin on concrete scenes, named antagonists, and faction reactions (and Act 5 omitted `machines.ts`'s `Earth is lost` branch); `machines.ts` had `A break` using the "steady tone" for all clear, an unguarded `Cleared -> Closed` arrow, missing `Injured` / death transitions in `A guild contract`, and seven prose lifecycles without machines.

### What I changed and why

- **`00eae066` (Economy and items):** rebuilt `prices.ts` with bottom-up Resident medical demand, 20-year cumulative gold stock (333M, 1.4% reserve, +4.2%/year drift), all four missing hunter sinks, fixed gear replacement and `Hunters die` math, 3,000-gold retired scout pay, revive-ladder death math, cleaned checks (23 passing), and a generated E-to-S `party-goals` table. Proposed fixes in `items.md` for seeds, gate keys, boss cores, and Master Stonecutter. Updated `README.md` and `economy.md` to match.
- **`aa0aeb10` (State machines):** updated `machines.ts` and regenerated `machines.md` to 21 validated machines (added `Revive standing`, `A System message or reward`, `Sponsor patronage`, `A guild gear lien`, `A party bond`, `Shadow extraction`, `A keepsake`; fixed all seven existing machine faults; tightened `faults()` against unguarded event collisions).
- **`c85dd33e` (Cross-file canon and bolder factions/places):** fixed every stale sentence and cross-file contradiction across `power.md`, `history.md`, `careers.md`, `factions.md`, and `seeds.md`. Reconciled step trials vs open trials and second fevers; turned Baskin's son into an unregistered B-rank (15,000-gold fine); tied Hook 10 to Dr Imre Solis; gave Redline third-life crystal escorts, Vantage oddsmaker Soren Kalt tracing The Bettor's 41-win streak, and The Fallen crystal-strippers; added the Salt Locker and the Glass Gallery to `seeds.md`.
- **`2f4d287f` (GM-ready `story.md`):** aligned section 3, Act 1, and section 7 with the revive ladder and GM approval; fixed the crying man to 20 years / 7,300 runs; solved Act 2's stranding problem with a 60-second reset loop and step-trial exit; solved Act 3's Okoro/Osei trigger with a 10,000-viewer threshold; thickened Acts 3 to 6 with playable horror scenes (barricaded warren, Value map offer, Scarside 400 cordon-vs-evacuation, flooded transit concourse), Captain Yael Sorin (Season 9), Keepsakes level prices, five named Season 1 champions, Carrow coalition demands, Branch B (`Earth is lost`), planted Okoro/Osei clues, the 12-Host Control Room encounter, Host #4 Maren, and the three Seat screens.
- **`62603706` (`review.md`):** recorded all statuses, "For the owner" recommendations, and the full "Proposed, needs the owner" index. Every new piece of canon or rule is marked `proposed, needs the owner` where it appears.

### Questions for the owner

All nine items are listed with recommendations in `docs/world/review.md` under "For the owner":
1. Seed rank-gating, cap blocking, 5-per-rank cap, and tier-scaled stat points (`items.md` sections 1 and 2).
2. Gate keys at 1 to 2 Clears with one guaranteed rare crafting material (`items.md` sections 1 and 2).
3. Boss cores required for B/A/S middle gear and signature items only (`items.md` section 3).
4. Master Stonecutter changed to 67% success, still lost on failure (`items.md` section 4).
5. Step trials (+1 rank cap) vs open trials (`Cap: none`) and brief second fever on passing any trial (`power.md` section 5).
6. Act 2 shared trial gate with 60-second reset loop and step-trial exit (`story.md` Act 2).
7. Act 3 10,000-viewer threshold to explain why Okoro and Osei did not trigger scenarios (`story.md` Act 3).
8. New story canon and faction hooks (Sorin, Keepsakes level prices, five named Season 1 champions, Branch B, Maren, three Seat screens, first-return amnesia, Redline escorts, Soren Kalt / The Bettor, crystal-strippers, Salt Locker, Glass Gallery).
9. Carried over: daily stat point vs level stat points, and optional level loss on raising (`economy.md` section 15 rows 4 and 14).
