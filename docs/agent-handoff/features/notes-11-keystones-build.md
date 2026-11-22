# Notes 11, build: keystones unit K1 (the rules and the pure rule)

Branch `keystones-1`. Design: `notes-11-keystones.md` sections A.2, A.3, A.5, row K1 of A.10.

## Progress

- Read the brief, helper rules, AGENTS.md, the design sections, the two principle skills, rules.ts, overrides.ts,
  stats.ts, jobs.ts, job-chain.ts, progress.ts `allocated`.
- Built K1 in one step: `RULES.fight.keystone`, the readers, `src/core/hunter/keystones.ts`, `Job.pair`, the tests.
  `flock /tmp/box.lock bun run test`: 5922 pass, 0 fail.

## What exists

- `RULES.fight.keystone` (`src/core/rules.ts`, after `kit`): `on`, `markShare` 0.3, `pairShare` 0.25, `apexShare` 0.55,
  `markRank` D, `pairRank` C, `apexRank` B, `monsterKinds` elite/boss/mythic, `budget` mark 2, confluence 3, apex 4. Each
  share and budget has a domain with its reason; the budgets share one domain, `KEYSTONE_SPEND` (0 to 30), declared
  with the other shared domains (one line outside the block).
- `src/core/overrides.ts` `READERS`: the three ranks read as one of `RANKS` (`oneRank`); `monsterKinds` entry by entry,
  each a key of `fight.kinds`. The generic tests of `tests/rule-domains.test.ts` and `tests/overrides.test.ts` walk the
  new numbers and the new list on their own; three named cases added (apex share 0.5, a rank that is not one, a kind
  that is not one).
- `src/core/hunter/keystones.ts`: `StatPair` (a type over `STAT_KEYS`, 28), `STAT_PAIRS`, `pairOf`, `statsOfPair`,
  `KeystoneKey`, `KeystoneBasis`, `sharesOf`, `keystonesOf`, `keystoneReach` (`StatReach` with `NextKeystone`), and
  `keystoneBasis(h)`, the one reader from a hunter.
- `Job.pair` on every job (`src/core/registry/jobs.ts`), each with its reason beside it.

## Each job's pair (from the stats that feed what the job does: derive.ts, item-budget.ts `FED_BY`)

| Job | Pair | Why |
|---|---|---|
| Fighter | str+vit | physical power, and HP and armor to stand in reach |
| Assassin | agi+ins | speed; the opening, Reaction and crit faces |
| Ranger | agi+ctl | speed and move to keep range; accuracy and crit size |
| Mage | pow+ctl | magical power and mana; accuracy, penetration, cost cut |
| Tanker | vit+dis | HP and armor; resist, will and tenacity: the guard on both sides |
| Healer | dis+pre | support power; will and channel hold to cast under fire |
| Necromancer | pre+pow | shadow capacity; the mana a summon costs |

All seven are different. Tanker could as well be vit+pre (Presence draws threat); I chose the guard over the threat.

## Where the design did not hold against the code, and what I built

1. **`above` is not "the score less the base".** Design A.2 writes `share(k) = above(stats[k]) / Σ above(...)` and
   calls `above` "the score less the base (10)". `stats.ts` `above` is the curved `eff(s) - base`. I followed the
   words ("share of the points spent"): a share counts raw points `max(0, score - statBase)`. With the curve, 60/40
   raw points would not be 60/40, and A.2's table would not hold.
2. **`StatPair` home.** A.3 puts `StatPair` in `src/core/registry/keystones.ts`, which is K2's file. K1's files do not
   include it, so `StatPair` lives in `src/core/hunter/keystones.ts` and `jobs.ts` imports its type. K2 may move it.
3. **"Its chain is done" is not stored.** A finished chain sets `jobChain` to null and grants the job; nothing else
   records it. `keystoneBasis` reads it from the quests: a done quest of kind `job`, with a `chainId`, whose reward
   is the hunter's job (the third step's quest, `stepQuest`). A hunter who deletes that quest loses `awakened`.
   No flag was added, as the design wants no keystone state; if the lead wants it durable, a chronicle fact or a
   `jobChain` "done" state is the place (outside K1's files).
4. **A stat under the base** (a GM edit to 1) spent no points, not negative ones: `max(0, ...)`.
5. **Ties.** The confluence's "two highest" sorts by share, a tie to the stat first in `STAT_KEYS` (JS sort is
   stable). Marks and the pair are "at least" their share; the apex is "over" its share, as A.2 says.
6. **`keystoneReach`** returns, per stat, its share and its next own keystone (mark, then apex) with the share and
   rank it asks and whether each is met. The confluence's reach ("Rank C opens your Confluence") is not per stat;
   K6 can read it from `keystonesOf` at the next rank. Not built here.
7. **Fight status test.** No row holds keystones yet (K4). "A fight status never changes one" is held on a hunter's
   `conditions` (the statuses a hunter carries into a fight): a `stat` op lowers the sheet's Strength by 15 and the
   mark stays. K4 should add the same on a row.

## Principles that changed a choice

- principle-type-system-discipline: `StatPair` is a type built over `STAT_KEYS`, not a hand list, so K2's
  `Record<StatPair, Keystone>` asks for every pair; the ranks in the rules are typed `Rank` and read by a reader that
  refuses any other text, rather than trusting a string.
- principle-model-the-domain: no keystone state; `KeystoneBasis` names the four inputs and nothing else, and
  `keystoneBasis` is the one place a hunter becomes one, so gear and titles cannot reach the rule.
