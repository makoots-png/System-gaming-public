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

# K3

The two ops of A.7: `{ op: 'stagger'; share }` (a use op and a land op) and `{ op: 'echo'; radius }` (a land op).
Proof: `flock /tmp/box.lock bun run test` ends `Ran 5937 tests across 134 files.` with 0 fail; the maker's browser file
is: `flock /tmp/box.lock env E2E_CHROMIUM=/opt/google/chrome/chrome E2E_PORT=4360 bunx playwright test
tests/e2e/makers.e2e.ts --workers=1 --output=/tmp/pw-k3` ends `61 passed (6.1m)` on the first run ("every kind of op
round-trips" saves both new ops).

## What was built

- **The bar has one place it fills.** `barFilled` in `land.ts` (rule 16's break: stun `staggerCost` rounds, empty,
  grow `staggerRegrow`) and `barRate` (the `staggerRate` statuses). Resolve's `staggered` (a hit) now computes its fill
  and calls `barFilled`; `staggerOp` (the op) computes `min(staggerOpMax, share * barRate) * max` and calls it. A use's
  outcome adds the op's fill to `stagger` and its break to `staggered`, so the card and log say it.
- **`kit.staggerOpMax`** 0.5 in `rules.ts`, domain 0 to 1, reason "half a bar, so no one op breaks a bar alone". The
  cap holds after the bearer's stagger rate too: a bar that fills twice as fast still takes half from one op, so the
  reason holds on every body. The parser holds a GM's larger share at the cap (the kits' clamp convention).
- **"As hits of that size would"**: read as "the bar fills by that much and breaks as a hit's fill does". A weak hit's
  1.5 weight is not applied: a share of the bar is not a hit measured against a same-rank hit.
- **Echo** lands in `echoed` (`land.ts`), once per op after the targets, on the nearest other body of the gainer's side
  within `radius` (held at `fieldRadiusMax`) that is up and lacks the status (a tie: the fight's order), from the same
  source, one stack, for the time the status had left at that moment (it was put on that moment, so that is the length
  it had when put on; `until - since` would be wrong for a refreshed status, whose `since` is the old one). It goes
  through rule 18's door like any status (`putFor`, split out of `landStatus` so the length is not shortened again by
  tenacity: a safeguard or a spent ward refuses it, a hold stuns, a channel breaks, a threshold crosses). It is told as
  a body that gained nothing, so it raises no `statusGained` and cannot chain.
- **Worth**: a stagger is `share * breakWorth`, a break being `staggerCost` rounds of the monster's turn weighed as a
  delay's time (`staggerCost * round / cost.standard` = 1.5 SA). An echo stays unweighed (named in `unweighed`): its
  worth is the status it copies, which the trigger's key names and `landWorth` cannot see.
- **Maker** (`maker.js`): "Fill the stagger bar" (a percent of the bar, 0 to 50, with a line that only an elite or a
  boss has one) in the skill and land rows; "Echo to the nearest" (tiles, 1 to the widest field, with a line on when it
  acts) in the land rows; both in the status rows through `OP_KINDS`.

## What did not hold against the code, and what I built instead

1. **`imposed` is not built** (item-stats). Echo is built against `statusGained`: `fire` (`triggers.ts`) passes a
   trigger's `landOps` the status gained that set it off (`Gained`: who gained it and its key), and echo reads only
   that. With `statusGained` the trigger's bearer is the one that gained the status, so "the foe nearest the trigger's
   other body" becomes "the body nearest the gainer, on the gainer's side". When `imposed` lands, its line in `fire`
   passes `{ holder: e.other, key: e.key }` and echo needs no change. The shape a GM can make today: a status whose own
   trigger is "when its bearer gains this status: echo". Puppeteer (an echo of whatever its hunter imposes) needs
   `imposed`.
2. **Where echo may stand.** The design says echo is an op of an `imposed` trigger. The trigger maker in
   `kit-parts.js` (outside K3's files) gives every trigger, threshold and end one list of land ops, so a parser that
   refused echo elsewhere would let a GM build a status the save then refuses. Echo is read everywhere a land op is
   and does nothing where no status gained set it off, as `move` with `key: 'event'` does in an end. If the lead wants
   it refused elsewhere: `kit-parts.js` passes the trigger's event to `M.effects`, and the parser refuses echo outside
   a `statusGained` trigger.
3. **Files outside the brief's list that the compiler or the behaviour asked for**: `src/core/combat/triggers.ts` (the
   one line that passes `gained`), `src/core/status-refs.ts` (`opWalk`), `src/core/registry/icon-defaults.ts`
   (`OP_ICON`: both `status`), `tests/icons.test.ts` (`SAMPLE` and `OP_PICTURE`). None is another helper's.
4. **"A mythic's bar takes `mythic.staggerTaken` of it"** is design B's and not built (no such rule yet).

## Principles that changed a choice

- principle-model-the-domain: the bar's fill and break had one copy inside resolve.ts; a second for the op would have
  been two writers of one machine. Both now go through `barFilled`.
- principle-test-behavior-not-implementation: the echo test places a third foe one tile from the echoed one, so an
  echo that raised `statusGained` would put the status there; I checked it fails when the echo is told as gained.
