Goal: the System notices what a hunter does and acts on it without the GM's hand (feats that give titles, rewards and hidden quests), and the GM marks a moment of roleplay in two taps. Problem: nothing in the game remembers what a hunter has done; a fight ends and only its totals reach the sheet. Smallest change that meets it: a `chronicle` on the hunter (facts recorded by the one writer of each thing, in that thing's write, into an inbox; a lifetime tally; the last 40 facts kept), one pure step `noticed` that the store runs at the end of every write, and a feat as custom content (a count over facts, the statuses' library model) whose reward goes through `grant`.

# Notes: feature 1, the System acts on its own (feats), and the GM's awards for roleplay

Status: the design approved by the lead (section 17); unit 1 and the GM's awards for roleplay built (17.1), measured (17.2); the Give shelf at 390 px and the second shelf of awards merged in (17.3); the copy sweep (17.4); unit 2 built (17.5); unit 3 built (17.6); units 4 and 5 built (17.9). Next: the Story design for review.

## 0. What I read, and what the code says today

Read in full: the brief, `plan.md`, `START-HERE.md`, `AGENTS.md`, `notes-2-solo.md` (its shape is copied here), `ideas-feats-titles-rewards.md` (all of it), `final/brief-implicit-unit.md`, `copy-tasks.md`, `helper-rules.md`, the skills `poteto-mode`, `principle-foundational-thinking`, `-model-the-domain`, `-redesign-from-first-principles`, `-exhaust-the-design-space`, `-type-system-discipline`, `-boundary-discipline`, `-make-operations-idempotent`, `-subtract-before-you-add`, `-explain-the-number`, `-experience-first`, `architect` (and its `design-red-flags.md`), `statechart`, `unslop`.

`ideas-2-imaginative.md` was not in `features/` when I read the content, nor when I wrote this file (checked twice, the second time just before the commit). The design is made from `ideas-feats-titles-rewards.md`. The roleplay awards (section 7) are designed as a shape that the second file's section can fill without a change: its entries become built-in bundles (unit 6 reads it).

The code, read at 9bb5843 (the tree's `src/` had no uncommitted change when I read it):

- The hunter (`save.ts`): `Hunter = Progress & Vitals & {...}`, filled by example at every repair (`repairSave` runs after every write, `fixHunter` for every hunter). A field added with a default needs no schema change. The sheet push sends the whole hunter (`SHEET_MAX` 32,768 characters, measured by the server on `{ hunter }`).
- `grant` (grant.ts) gives a whole `Rewards` in one step and hands back what a fight holds (`Granted.fight`). `levelled` is the one place a level change is told (a lint keeps levels in grant.ts). `finishQuest` completes a quest and grants in one step. `sheetEdit` is the one writer of HP, mana, fatigue, life and statuses outside a fight; it takes a hunter and no time.
- `record.ts`: names, jobs, ranks, titles (`giveTitle`, `holdsTitle` by `seedKey` for rule titles), boons. A `Title` is a name, words and a `Perk` bonus.
- `quests.ts`: the quest `TABLE` (active, done, failed), `completeQuest` (the streak, the penalty, the chain), `failQuest`, and `rollover`, which fails an overdue urgent quest by its own call of `questStep` (not through `failQuest`: a second way to fail a quest, see 12, unit 1). `systemCounts` (quest-rights.ts) is today's only objective the System moves: a Job Change level step, moved by the chain's `progress` effect.
- The fight: `fought` (fight-save.ts) writes one command's answer, its write-backs and the players' totals (`vitals` posted under a key, so a newer one replaces a queued older one). `writeBack` and `sheetTotals` (fight-turn.ts) are what a row leaves on its sheet. `ended` makes the `Summary` (rounds, winner, who is down, XP). A row already counts its kills (`Body.kills`, raised by `withKill` in `fire`, read by the formula's `kills`). Every event a use raises passes through `fire` (triggers.ts: `hitDealt`, `struck`, `critDealt`, `critTaken`, `kill`, `avoided`, `turnStart`, `turnEnd`, `moved`, `down`, `statusGained`, `statusEnded`, `used`), but none of it is kept after the command.
- `pay.ts`: `settleEncounter` (the fight's XP, `Gate.fought`, the clear) and `settleClear` (a gate's Clear) post the players' `award` messages in the same write.
- `solo.ts`: `soloRan` writes a run whole (`ranOn` through `sheetEdit`, the gate, the reward), from `RunEnd` (the odds engine's end, which already plays a fight on the reducer).
- `rewards.ts`: `Rewards`, `parseRewards`, `RewardBundle` (`library.rewards`), `grantLines`.
- `protocol.ts`: `DEFS` (gmOnly, ownSheet, a bounded reader each), `DOC_MAX` 62,000, `SHEET_MAX` 32,768; server.ts refuses a body over `MAX_BODY` 64 KiB.
- `room-events.ts`: `APPLIERS`, a `Land` written once by event id (`sync.once`, which is a `store.apply`).
- `library.ts`, `pack.ts`: the library's lists and the statuses by key; a pack per kind.
- `formula.ts`: numbers and dice only, no comparison and no boolean.
- `session-log.ts`: `told` writes lines with ids from the save's `seq`.
- `award.ts` `gmAward` and gm.js's Award form: checkboxes for hunters, the reward editor, Send award.
- `rows.ts` `wornStatuses`: a passive skill's and a worn item's `worn` status go on the hunter's row in every fight.
- `store.ts` `apply(reason, step)`: the step, then `update`, which repairs, stores and announces. Every write of a view and of sync.ts goes through it (a lint).

## 1. What the game remembers about a hunter (the foundation)

### 1.1 Facts first

Whatever is kept, the thing that happens is a **fact**: a typed record of one thing a hunter did or that happened to it, made by the one function that does that thing, in that thing's write. A fact exists in every shape below. The shapes differ in what is kept of facts after they are counted, and where a count lives.

### 1.2 Three shapes, weighed

| | (a) A tally | (b) A chronicle | (c) A tally and a bounded chronicle |
|---|---|---|---|
| What is kept | Named counters only. A fact is folded into them and dropped | Every fact, newest last. Every count is a fold of the list | Lifetime counters (a fixed table), each feat's own counter, and the last 40 facts of the kinds worth reading |
| `now` feats of the ideas file (26) | 26 | 26 | 26 |
| One-fight feats (N2, 21), given the fight's row summary as a fact | 21 | 21 | 21 |
| Counts across fights (N1, 31) | 24 with a fixed key list (the plain counts: F17, F18, F20 to F23, F28, F30, F31, F34, F42, F43, F47, F56, F57, F63, F68, F69, F88 to F90, F95, F98, F99). F19, F24 to F27, F29, F84 need a key made for that one feat (a filtered count or a run) | 31 while the list holds them. F28 (1,000 kills), F43 (100 gates), F52 (365 days), F95 (100 quests) fail once the list is bounded (below) | 31: each feat counts its own matching facts from its start |
| Windows (in a row, a session, a day, between long rests: F27, F35, F45, F54, F55, F79, F82, Q07, Q13, Q14, Q16) | Only with a key per window per feat | Read from the list, right only while the window's facts are still in it | Each feat's counter carries its window mark and resets on it (5.6) |
| A GM's own feat over any filter ("bosses defeated without going down") | Only the filters the key list names | Any | Any |
| A player reads what happened (the Chronicle panel), a recap, prose | No | Yes | Yes, for the last 40 kept facts; the lifetime numbers forever |
| Size on the hunter | ~520 characters (32 counters of ~16) | Unbounded. One session at a table is about 12 facts worth keeping (3 to 6 fights, a level, quest ends, falls, feats) at ~300 characters, ~3.6 KB a session; with each kill a fact, ~8 KB. Past `SHEET_MAX` within 4 to 8 sessions | Tally ~520; feat counters at most 160 x ~30 = 4.8 KB; 40 kept facts, ~12 KB typical and 28.8 KB worst on the phone. The sheet push carries the tally, the newest earned feats and the last 8 facts: ~4.8 KB typical, ~8.7 KB worst (1.6) |
| Per-write cost (the repair reads every hunter on every write) | Nil | Grows without end | Bounded: 40 facts a hunter |
| A room message | One per remote row at a fight's end, ~10.4 KB worst (2.3) | Same | Same |

(b) fails on arithmetic: the sheet push is the whole hunter and `SHEET_MAX` is 32,768, so an unbounded list cannot travel, and a bounded one cannot count to 1,000. (a) fails the GM: the owner's own words make a feat "made by the GM in a maker as a status's triggers are", and a GM's feat over a filter the key list lacks could not be made. It also leaves nothing to read and nothing for section 11.

**Picked (c).** The counts a feat reads are exact forever (its own counter, the lifetime tally), the windows are exact (marks on counters, not a scan of a list), and the kept facts are what a player reads and what every forward use in section 11 needs. Section 11's table is the deciding one: (c) carries all 13 of its uses without a rewrite, each with only its own addition; (a) carries 6 and 3 more in part, and loses the recap, the spotlight, the prose and party feats over facts.

### 1.3 The types

```ts
// src/core/hunter/facts.ts: what a hunter did, as data. Pure. Each kind has one writer (1.5) and a field table.
// A fact's time is not its own: `noticed` stamps every fact of a write with that write's moment (4.1).
export type Stamp = { readonly at: string; readonly day: DayKey; readonly session: number };

/** A monster as a fact names it: its name, rank, its type (the monster's free `type` text, cut to 40) and kind. */
type Foe = { readonly monster: string; readonly rank: Rank; readonly type: string; readonly mkind: MonsterKind };

export type Fact =
  /** A hunter row's fight, at the fight's end (combat/fight-facts.ts `rowFacts`, from the row's tally, 2.2). */
  | { readonly kind: 'fight'; readonly outcome: 'won' | 'lost' | 'ended'; readonly rounds: number; readonly up: boolean;
      readonly downs: number; readonly low: number /* lowest HP share while up, % */; readonly endPct: number;
      readonly struck: number; readonly crits: number; readonly critRun: number; readonly avoided: number;
      readonly dealt: number; readonly taken: number; readonly dealtPct: number; readonly takenPct: number;
      readonly healed: number /* on allies */; readonly raised: number /* allies brought up from down */;
      readonly hexes: number /* harmful statuses put on foes */; readonly harm: number /* most harmful statuses held at once */;
      readonly kills: number; readonly bosses: number; readonly turnKills: number /* most kills in one of its turns */;
      readonly manaPct: number /* mana left, % */; readonly manaUses: number; readonly items: number /* consumables used */;
      readonly onlyWeapon: boolean; readonly saved: number /* killing hits on allies its reactions stopped */;
      readonly exactOne: boolean; readonly firstUseKill: boolean; readonly gearless: boolean; readonly heavy: boolean;
      readonly allies: number; readonly alliesDown: number; readonly alliesDead: number; readonly sideUp: number;
      readonly foes: number; readonly foeTop: number /* highest foe rank minus the hunter's */; readonly foeLow: number;
      readonly bossTop: number | null; readonly early: boolean /* won before any foe's first turn */;
      readonly gate: string | null; readonly gateRank: number | null /* the gate's rank minus the hunter's */; readonly broken: boolean;
      readonly names: string /* "3 Goblins, Hobgoblin", at most 80 */ }
  /** A foe this hunter took down, recorded beside its fight (not kept, 1.4). */
  | ({ readonly kind: 'kill'; readonly above: number /* its rank minus the hunter's */; readonly hpPct: number /* the killer's */;
       readonly payback: boolean /* the foe that put this hunter down this fight */; readonly where: 'fight' | 'solo' } & Foe)
  /** A consumable used up, in a fight or out of one (not kept). */
  | { readonly kind: 'used'; readonly item: string; readonly rar: Rarity; readonly heals: boolean }
  | { readonly kind: 'solo'; readonly outcome: RunOutcome; readonly rank: Rank; readonly above: number; readonly rounds: number;
      readonly odds: number | null /* the share won at entry, % */; readonly endPct: number; readonly life: LifeState;
      readonly personal: boolean; readonly afterReset: number /* minutes after the day's reset */ }
  /** A gate cleared with this hunter among its payees: by the GM's Clear, or alone. */
  | { readonly kind: 'gate'; readonly how: 'clear' | 'solo'; readonly rank: Rank; readonly above: number; readonly toBreak: number | null; readonly name: string }
  /** A personal gate that closed (solo.ts `soloTick`); `entered` when the hunter ran it and did not clear it. */
  | { readonly kind: 'closed'; readonly entered: boolean }
  | { readonly kind: 'quest'; readonly end: 'done' | 'failed'; readonly qkind: QuestKind; readonly from: QuestSource; readonly title: string }
  /** The day's dailies all done (completeQuest's `allDaily`). */
  | { readonly kind: 'daily'; readonly streak: number; readonly afterReset: number; readonly beforeReset: number; readonly fatiguePct: number }
  /** The rollover took a streak (`short`: days it stood short of a bonus day). */
  | { readonly kind: 'streakLost'; readonly streak: number; readonly short: number }
  | { readonly kind: 'penalty'; readonly event: 'issued' | 'lifted'; readonly days: number }
  /** What a change of life was (vitals.ts `lifeNews`), and how. */
  /** `how`: a fight's or a run's totals, a death save, the GM's Revive, an item (a Resurrection Crystal), or any other hand edit; `failures`: the death saves failed before it. */
  | { readonly kind: 'life'; readonly news: LifeNews['kind']; readonly how: 'fight' | 'save' | 'gm' | 'item' | 'hand'; readonly failures: number }
  | { readonly kind: 'level'; readonly level: number }
  | { readonly kind: 'rank'; readonly rank: Rank }
  | { readonly kind: 'title'; readonly name: string }
  | { readonly kind: 'feat'; readonly key: FeatKey; readonly name: string; readonly hidden: boolean }
  /** A bundle the GM gave by hand (the roleplay shelf, section 7). */
  | { readonly kind: 'given'; readonly key: string; readonly name: string }
  /** A d20 check's natural 1 or 20 (`swing`: the check before it was the other extreme). */
  | { readonly kind: 'roll'; readonly natural: 1 | 20; readonly swing: boolean }
  | { readonly kind: 'coin'; readonly won: boolean }
  | { readonly kind: 'shop'; readonly act: 'buy' | 'sell'; readonly item: string; readonly rar: Rarity; readonly price: number; readonly goldAfter: number; readonly revive: boolean }
  | { readonly kind: 'rest'; readonly long: boolean }
  | { readonly kind: 'shadow'; readonly name: string };
export type FactKind = Fact['kind'];
/** A fact as the chronicle keeps it. */
export type Kept = Fact & Stamp;
```

Each kind has a field table the compiler holds against its type, so a field added to a kind without its row does not compile, and the parser, the maker and the rule's words all read the one table:

```ts
type Spec = { readonly label: string } & (
  | { readonly t: 'num'; readonly min: number; readonly max: number }
  | { readonly t: 'flag' }
  | { readonly t: 'rank' }                                  // ordered: E to S, compared by index
  | { readonly t: 'pick'; readonly of: readonly string[] }  // unordered choices: an outcome, a quest kind
  | { readonly t: 'text'; readonly max: number });          // compared whole, in any case: a monster's name or type
type FieldsOf<K extends FactKind> = { readonly [F in Exclude<keyof Extract<Fact, { kind: K }>, 'kind'>]-?: Spec };
export const FACT_FIELDS: { readonly [K in FactKind]: FieldsOf<K> } = { /* one row a field */ };
/** Whether the chronicle keeps a kind (1.4). */
export const KEPT: { readonly [K in FactKind]: boolean } = { /* ... */ };
```

The hunter gets one field:

```ts
// src/core/hunter/chronicle.ts: what the System remembers of a hunter. Only `record` (an inbox append) and `noticed` write it.
export type Chronicle = {
  /** Facts this write recorded and `noticed` has not taken yet; between writes empty, or waiting while a fight holds the hunter (4.2). */
  readonly inbox: readonly Fact[];
  /** The last CHRONICLE_MAX kept facts, stamped, oldest first. */
  readonly facts: readonly Kept[];
  /** Lifetime numbers, each the fold of every fact ever noticed by its row of TALLY. */
  readonly tally: Tally;
  /** Each feat's place on this hunter, by its key. Absent: the feat's start (5.5). */
  readonly feats: Readonly<Record<FeatKey, FeatState>>;
};
export const TALLY_KEYS = ['fights', 'won', 'kills', 'bosses', 'crits', 'struck', 'avoided', 'healed', 'fell', 'died', 'revived',
  'gates', 'soloWon', 'soloLost', 'retreats', 'quests', 'questsFailed', 'dailies', 'penalties', 'penaltyDays', 'feats', 'hiddenFeats',
  'titles', 'given', 'shadows', 'coinsWon', 'coinsLost', 'nat20', 'nat1', 'longRests', 'bought', 'sold'] as const;
export type Tally = { readonly [K in (typeof TALLY_KEYS)[number]]: number };
/** How much one fact adds to each tally key. One row a key: the typecheck asks for a row for each. */
export const TALLY: { readonly [K in keyof Tally]: (f: Fact) => number } = { /* fights: f => (f.kind === 'fight' ? 1 : 0), ... */ };
/** The one writer of the inbox: a fact appended. Pure, hunter-level, so a step that holds only a hunter records too. */
export const record = <H extends { chronicle: Chronicle }>(h: H, ...facts: readonly Fact[]): H => ...;

// on the Hunter (save.ts), with its default and its repair line:
//   chronicle: Chronicle   /** What the System remembers of it: src/core/hunter/chronicle.ts. Only its functions change it. */
```

`Hunter.chronicle` is a field with a default, so no schema change: a save without it reads with an empty chronicle (the brief's one-way migration keeps every hunter).

### 1.4 What is kept

`KEPT` keeps every kind but `kill`, `used`, `roll`, `coin`, `shop` and `rest`: those are many and small, they count (tally, feats) and are dropped. A kill lives on in its fight's `kills`, `bosses` and `names`. The rest are kept: fight, solo, gate, closed, quest, daily, streakLost, penalty, life (but a death save's `saved` and `failed`), level, rank, title, feat, given, shadow. `daily` is kept so the chronicle reads as days; one a day is 40 entries in a quiet month, so a campaign that only does dailies shows its last 40 days, which is what a player scrolls.

### 1.5 One writer per fact, in the write of the thing it records

| Fact | Its one writer (core) | The write it rides in |
|---|---|---|
| fight, kill, used (in a fight) | `fought` (fight-save.ts) on the `ended` effect: `rowFacts` for each hunter row; a local row's facts recorded on its hunter, a remote row's posted as `noted` (2.3) | The command that ended the fight (`end`, or the use that left a side with nobody up) |
| solo, kill (alone) | `soloRan` (solo.ts), from `RunEnd` (which gains the row's tally, 2.2) | The run's one write |
| gate | `settleClear` (pay.ts) for each payee (remote: `noted`); `soloRan` for a cleared personal or local gate; `landSoloAnswer` for a paid room run | The Clear; the run; the answer's land |
| closed | `soloTick` (solo.ts) for each gate it closes | The tick |
| quest | `completeQuest` and the one fail step `failQuest` (quests.ts); `rollover` fails through `failQuest` (unit 1) | The completion, the failure, the rollover |
| daily, streakLost, penalty | `completeQuest` (the streak, the lift); `rollover` (the loss, the issue) | Same |
| life | `sheetEdit` (grant.ts), from `lifeNews(before, after)` on any edit that moved the life, `how` from the edit (`totals` is `fight`, a `deathSave` is `save`, a `revive` takes `by: 'gm' \| 'item'` on its event, any other life event is `hand`) | Every write that changes a hunter's life: the GM's hand, a fight's `vitals` (local) or the room's `vitals` (a player), a solo run, a crystal |
| level | `levelled` (grant.ts), already the one place a level change is told (a lint) | The grant or the GM's level edit |
| rank | `setRank`, `reevaluate` (record.ts) | The GM's edit |
| title | `giveTitle` (record.ts), when it gives one | The grant |
| feat | `noticed` | The write whose fact earned it |
| given | `gmAward` (local hunters) and `landAward` (a player's), when the award names a bundle (section 7) | The award |
| roll | `rolled` (session-log.ts), the one writer of the dice log, for a roll of a hunter of kind `check` with a natural 1 or 20 | The roll |
| coin | the coin's landing step (coin.ts, written by coin.js) | The landing |
| shop | `buy`, `sell` (inventory.ts) | The purchase |
| rest | a hunter-level rest step beside `rest` (vitals.ts), which today answers vitals only | The rest |
| used (outside a fight) | `useItem` (use.ts) | The use |
| shadow | `shadowRises` (shadows.ts) | The rise |

No fact is written after its thing: each writer appends to the hunter's inbox inside its own step, and `noticed` runs at the end of the same `store.apply` (4.1).

Two heals change a life without `sheetEdit`: a rest (`rest`) and a level-up's or the dailies' refill (`refill`). They can bring a stable hunter up, and record no life fact: no idea needs "raised by a rest", and the rest records its own `rest` fact. Said here so it is a choice, not a gap: if a feat ever needs it, both move to `sheetEdit`'s heal.

### 1.6 Arithmetic: the sheet push

The push is the whole hunter today. With the chronicle it is the hunter with its chronicle cut to what the GM's phone reads (`pushedChronicle`, push.ts): the tally, the feats this hunter has earned (not the counters of the rest), the last `PUSHED_FACTS` (8) kept facts, an empty inbox.

- Tally: 32 keys, a key ~10 characters and a number up to 6 digits with its punctuation: ~16 each, ~520.
- Earned feats: an entry `"key":{"at":"earned","on":"2026-11-18T21:04:11.000Z"}` is ~60 with a 12-character key. A hunter who earned every built-in (60) and every GM feat (100): 160 x 60 = 9.6 KB, the worst case no table reaches; 20 earned feats is 1.2 KB.
- 8 facts: a fight fact with its stamp is ~720 characters with every field written (the repair writes every field of a kind). 8 fights is 5.8 KB; a typical mix (3 fights, 5 smaller facts of ~180) is 3.1 KB.

Typical push growth: 0.5 + 1.2 + 3.1 = **4.8 KB**. Worst: 0.5 + 9.6 + 5.8 = **15.9 KB**, half of `SHEET_MAX`. That worst case is too close for a hunter that also carries 20 items with worn statuses, so the push keeps at most `PUSHED_FEATS` (40) earned feats, the newest: worst 0.5 + 2.4 + 5.8 = **8.7 KB**, about a quarter. The test of unit 1 builds the worst chronicle, measures its pushed JSON against a quarter of `SHEET_MAX`, and reads it back whole through `parseSheetHunter` (as the solo notes did for `Hunter.solo`).

On the phone: 40 kept facts, worst all fights, 40 x 720 = 28.8 KB a hunter; typical 40 x 300 = 12 KB. The store writes the whole save on every write and the repair reads every hunter, so this bound is a cost on every tap. Unit 1 measures it before it lands: the feel case "a fight turn" (worst frame and worst tap) with a GM phone holding 6 hunters each at a worst chronicle, against the numbers in `notes-2-solo.md` section 16. If the worst tap moves by more than the run-to-run spread (about 15 ms there), `CHRONICLE_MAX` comes down to 20 and the notes say so. This is the one number in this design that a measurement may move.

## 2. Where a fact is made when the fight is on the GM's phone and the hunter on a player's

### 2.1 Who evaluates a feat: the phone that holds the hunter

Variants:

1. **The phone that holds the hunter** (the lead's lean). Facts are recorded on the hunter where it lives, and the feats are checked there in the same write. The GM's phone only sends the facts it alone can see (a fight's, a Clear's, a bundle given).
2. **The GM's phone**, for every hunter: it holds the fight, the library and every player's pushed sheet. The player's own facts (dailies, solo runs, rolls, the shop, rests) would reach it only through the sheet push, so the GM's phone would read a chronicle it does not own and send each earned feat back as an award.
3. **Split by origin**: the GM's phone checks facts of its fights, the player's phone the rest.

Picked 1. Reasons, each from the code:

- One writer of a hunter. A player's hunter is written only on its phone; the GM's phone posts messages that land there once (`APPLIERS`). Variant 2 makes the GM's phone decide a player's progress from a copy that is up to `PUSH_MS` (3 s) to minutes stale, and two GM phones would each decide.
- The System acts with no GM. A personal gate is spawned and run on the player's phone alone (feature 2). A streak of seven days, a solo run won at 4 HP, a natural 20: under variant 2 none of these is noticed until the GM's phone next polls, which between sessions is days.
- Alone and in a room are the same code. A phone alone is its own GM; under variant 1 it records and checks as any phone does.
- Variant 3 is two places that decide "earned", which `principle-model-the-domain` calls a sign of a missing structure.

The cost of variant 1, said plainly: the GM's own feats must reach the players' phones (the `feats` doc, 3.2), and a player who reads their phone's storage can read the GM's hidden feats. The built-in feats are in the app's code, so they were never secret from such a player. The fight's intents and fog are kept off a player's phone because they decide a fight; a feat's condition decides nothing a player does at the table. This goes to the owner as question 1 (section 15).

### 2.2 What the fight keeps for its end: a row's tally

A fight row keeps nothing of what happened to it but `kills` and the uses it spent. The one-fight feats (N2, 21 of them) need more, kept while the fight runs, because the fight is stored and played over many commands and reloads.

```ts
// src/core/combat/row-tally.ts: what happened to a row in this fight, for its facts at the end. Pure. Written only by
// `tallied`, which the reducer calls at four places (below); read by `rowFacts` (fight-facts.ts) and the formula's `kills`.
export type RowTally = {
  readonly hits: number; readonly struck: number; readonly crits: number; readonly critRun: number; readonly critRunMax: number;
  readonly avoided: number; readonly dealt: number; readonly taken: number; readonly healed: number; readonly raised: number;
  readonly hexes: number; readonly harm: number; readonly downs: number; readonly downedBy: readonly CombatantId[];
  readonly low: number; readonly exactOne: boolean; readonly turns: number; readonly turnKills: number; readonly turnKillsMax: number;
  readonly uses: number; readonly manaUses: number; readonly firstUse: 'none' | 'kill' | 'other'; readonly onlyWeapon: boolean;
  readonly items: readonly ItemId[]; readonly saved: number;
  /** Each foe it took down: the row, and its own HP share at that moment. */
  readonly kills: readonly { readonly row: CombatantId; readonly hpPct: number }[];
};
/** What the reducer tells the tally. */
export type TallyEvent =
  | { readonly type: 'raised'; readonly events: readonly Raised[] }           // fire(): hits, struck, crits, avoided, kills, downs
  | { readonly type: 'used'; readonly by: CombatantId; readonly ability: Ability; readonly outcomes: readonly Outcome[] } // act(): dealt, healed, hexes, uses, mana, items, first use, weapon only
  | { readonly type: 'changed'; readonly before: readonly Body[] }           // consequences(): the lowest HP share, exactly 1 HP, raised from down
  | { readonly type: 'turn'; readonly id: CombatantId }                       // startTurn(): turns, kills in one turn
  | { readonly type: 'saved'; readonly by: CombatantId };                     // a reaction before a killing hit left its ally up (13b)
export function tallied(rows: readonly Body[], e: TallyEvent): Body[];
```

`Body.tally?: RowTally` (absent is all zero) is parsed by `fight-parse.ts` and never put in the fight doc (`fightWire` names its fields one by one, so nothing changes there). `Body.kills` goes: the formula's `kills` reads `tally.kills.length`, and `withKill` becomes the tally's kill (one counter of kills, not two). The odds engine plays the reducer, so its plays keep tallies too (a few additions an event), and `RunEnd` gains the hunter row's tally, from which `soloRan` makes its kill facts. A monster's `type` is on the monster and not on its row's `Origin`; `monsterRows` adds it to `Origin` (the monster arm), so a kill fact can name it.

`rowFacts(f: Ended, cid, refs)` (src/core/combat/fight-facts.ts) answers a hunter row's `fight` fact, a `kill` fact for each of its kills and a `used` fact for each consumable it used, from its tally and the other rows (the party's fields: allies, down, dead, up; the foes' top and lowest rank; a boss's rank), the fight's `Summary`, and the gate the fight came from (`fightRefs.gate`, its rank and whether it broke). It is pure and tested on fights played by the reducer.

### 2.3 The facts of a player's row reach its phone: `noted`

A player's totals travel today as `vitals`, posted under a key so a newer one replaces a queued older one. A fight's facts are not a total: replacing them loses them. So they are a new message by the recipe:

```ts
/**
 * Facts the GM's phone saw of the player's hunter of `to`: a fight's end (its row's facts), a gate's Clear it was paid
 * in, posted in the write of that end or Clear. Landed once by its id: recorded on the hunter, noticed in the same write.
 */
export type NotedPayload = Base & { to: [SheetKey]; facts: Fact[] };
// DEFS: { gmOnly: true, ownSheet: false }. Reader: exactly one key; at most NOTED_MAX (1 + MAX_ROWS + 20 = 81) facts, each
// read by `parseFact` (facts.ts, the save's own reader, so one parser reads a fact wherever it comes from).
// APPLIERS.noted: { once: true, land }: `record(h, ...facts)`; the store's `noticed` takes them in the same write.
```

Posted by `fought` in the end command's write (beside the totals), and by `settleClear` for each remote payee (the `gate` fact). Size: a fight fact ~650, 60 kill facts at ~140, 20 used facts at ~70: ~10.4 KB at the worst, far inside the server's 64 KiB body. Idempotent: the outbox sends it until the room takes it, the room takes an event id once (`addEvent`), and the player's phone writes it once with its id (`appliedOnce`).

Variants weighed for the message: a field of `vitals` (refused: a keyed total, replaced while it waits, so facts would be lost), a field of the settle's `award` (refused: sent only when the GM chooses Award XP with a share above 0, so a fight with no XP would record nothing), a new message (picked).

A bundle the GM gives travels inside its `award` (section 7), since the bundle, its reward and its window are one thing given at once.

## 3. The room's other parts

### 3.1 The session a fact belongs to

A fact's `session` is the GM's session count (`world.session`, moved by Start session). A player's phone does not hold it, so the world doc gains it: `WorldDoc = { day; session; gates }` (published by `worldDoc`, read with `int(0, 1e6)`; 12 characters more). The session a phone stamps: in a room as a player, the world doc's (the last one read; 0 before the first); otherwise its own save's `world.session`. Alone in player mode nobody starts a session, so a session window there spans everything since the phone's GM view last started one; a for-the-owner line says so.

### 3.2 The GM's feats on the players' phones: the `feats` doc

A player's phone checks the feats of the table it plays at: the built-ins, with the GM's library laid over them (overrides, turned off, the GM's own). They travel as the solo doc's monsters do, by value, in a doc of their own:

```ts
/** The GM's feats a player's phone checks (hunter/feats.ts `featsDoc`): each by value as `parseFeat` reads it, and the GM's statuses their rewards name. */
export type FeatsDoc = { on: boolean; feats: Record<FeatKey, FeatDef>; statuses: Record<string, StatusDef> };
```

- `on` is the GM's switch for the whole System's noticing (`RULES.feats.on`, the rules overrides; section 13). The `rules` doc could carry it, but the feats doc is the one a player's phone reads to notice, so it carries its own switch and the rules doc stays small.
- Built by `featsDoc(save, R, DOC_MAX)` in the way `soloDoc` is: the GM's library feats in key order, each added whole only while the doc's JSON stays within `DOC_MAX`; it answers the doc and the keys left out, and the Workshop's feat section says "Too large to send to players" on each left out. Arithmetic: a typical GM feat (a name, a window line, a description of ~120, a rule of two tests, a title reward) is ~700 characters, so 60 feats are ~42 KB; a feat whose reward holds 20 items with worn statuses can pass 30 KB alone, which is why the builder adds whole entries and names the rest. The protocol test builds the worst case and prints it by part, as the solo doc's does.
- Overlaid on a player's phone, never written to its save: `withRoomFeats` (src/edge/feats.ts, bound by sync.ts as `bindRoom` binds the rules). `featsFor(seat, library, doc)` in core is the one answer to which feats apply: alone or the GM, this save's library over the built-ins; a player in a room, the doc over the built-ins (its own library is not the table's).
- Counting starts when a feat reaches the hunter's phone. A feat the GM makes in session 10 counts from the moment its doc lands, not the kills before it. Question 2 (section 15) asks the owner whether he wants the past counted from the chronicle's last 40 facts and the tally instead.

### 3.3 A hunter the GM's fight holds: the release write

While a fight holds a hunter, its facts wait in the inbox (4.2). On the GM's phone the fight's end write lets its hunters go in that same write, so their facts are noticed there. A player's hunter is held by the room's fight doc, which is not in the save: the `noted` message of the fight's end and the doc that says the fight ended can arrive in either order. So sync.ts, when a fight doc changes this phone's answer to `fightHold` from held to free for a hunter with a waiting inbox, runs one write, `store.apply('noticed', released)`, in which the store notices what waited. `released` (noticed.ts) answers the save as it is when a hunter no fight holds has a waiting inbox, else refuses (`unchanged`), so the write records nothing new, changes nothing but what `noticed` answers, and a repeat writes nothing.

## 4. The notice step

### 4.1 One step, at the end of every write

```ts
// src/core/hunter/noticed.ts
export type NoticeCtx = {
  readonly feats: FeatBook;                       // featsFor(...): the feats that apply, by key, in a fixed order
  readonly day: Day;                              // the write's time, today's day key and the rules
  readonly session: number;                       // 3.1
  readonly held: (save: Save, hid: HunterId) => boolean;  // fightHold on the save after the step, or the room's fight doc (4.2)
  /** A player's phone in a room: where a counted quest of the GM's reports its end (6); null otherwise. */
  readonly room: { readonly code: RoomCode; readonly key: (hid: HunterId) => SheetKey; readonly event: EventMaker } | null;
};
export type Noticed = { readonly save: Save; readonly earned: readonly Earned[] };
export type Earned = { readonly hid: HunterId; readonly key: FeatKey; readonly granted: Granted };
/**
 * Every hunter's inbox taken, in a fixed order: each fact stamped with the write's moment, folded into the tally, kept
 * when its kind is kept, counted by each feat and each counted objective (5.6, 6), and each feat it earns marked, told
 * as a `feat` fact, its reward given (`grant`) and its quest issued; then the facts those raised, until none is left. A
 * hunter a fight holds keeps its inbox (4.2). A save with every inbox empty is the save as it was (the same object).
 */
export function noticed(save: Save, ctx: NoticeCtx): Noticed;
```

Where it runs: `store.apply` composes it after the step, in the same write:

```ts
apply(reason, step) {
  if (!mayChange(life)) return refuse(READ_ONLY);
  const next = step(state);
  if (isRefused(next)) return next;
  const n = noticed(next, noticeCtx());   // bound at start by app.js, as the rules are
  store.update(s => { writeInto(s, n.save); }, reason);
  if (n.earned.length) emit({ reason: 'feats', earned: n.earned });
  return { ok: true };
}
```

Variants weighed:

1. **Every caller that records a fact also calls `noticed`** (as callers of a log line call `told`). About 20 writers, several hunter-level (`sheetEdit`, `giveTitle`, `buy`), which cannot `grant` (a save-level step that takes ids from `seq`). A writer that forgets leaves a fact counted never. Refused.
2. **The store notices after every write** (picked). The writers stay hunter-level appends; `noticed` is one call, in one place, whose effect a test of the store pins: "after any `store.apply`, every inbox of a hunter no fight holds is empty". It has a precedent: the store already runs `repairSave` after every write.
3. **Diff the save before and after each write** and infer facts (a life that went from up to dying). It guesses causes (an item gone: sold, used or given?) and is the implicit inference the owner ruled out ("everything explicit"). Refused. `lifeNews` is used inside `sheetEdit`, where the cause is known, not across a whole write.

The inbox is the outbox's mirror: steps queue, one consumer takes. A lint keeps it: "only chronicle.ts's `record` appends to an inbox, and only `noticed` empties it".

### 4.2 The inbox while a fight holds the hunter (a machine)

A feat's reward may hold statuses and a level-up's refill. While a fight holds the hunter, its row holds those, and a status put on the sheet is overwritten by the fight's next totals (today a player's phone refuses such parts of an award with a toast). So a held hunter's facts wait until the fight lets it go, and are noticed then, whole.

```
States of one hunter's inbox:  empty, waiting (facts, a fight holds the hunter)
empty   --a write records facts, no fight holds it-->  empty    (noticed in that write)
empty   --a write records facts, a fight holds it-->   waiting
waiting --a write records facts, still held-->         waiting  (appended)
waiting --a write in which no fight holds it-->        empty    (all noticed, oldest first)
waiting --the hunter is deleted-->                     (gone with it)
```

Every cell: `empty` and `waiting` crossed with {records facts, held}, {records facts, free}, {records nothing, held}, {records nothing, free}: `empty` stays `empty` for the last two; `waiting` stays `waiting` held and empties free (the release write of 3.3, or any write). The facts of a held hunter are few: a life fact on a fall, a roll, a coin call. Bound: `INBOX_MAX` (200), the oldest dropped past it, a bound for junk (a fight's end adds at most 81).

### 4.3 Order and termination

Within a write, hunters in the save's order; each hunter's facts oldest first; for each fact, the feats in a fixed order (built-ins in their registry's order, then the library's by key) and then the active quests' counted objectives. A feat earned appends a `feat` fact; its `grant` may append `level` and `title` facts (written by `levelled` and `giveTitle`); a quest completed by its count appends a `quest` fact. Those are taken in the same loop. It ends: each feat is earned at most once and each quest completes at most once (both are terminal states), so the facts a loop can raise are at most (feats + counted quests) x 3, and the inbox empties. No depth counter is needed; the test "a chain of feats that each count the last one's `feat` fact ends with every feat earned once" pins it.

## 5. A feat as content

### 5.1 The condition's form, three ways

| | (a) A small typed tree | (b) The formula language with counts | (c) A fixed list of condition kinds |
|---|---|---|---|
| What it is | One fact kind, up to 4 tests of its fields (all must hold), what to count (each fact, the sum of a field, different values of a field), the number that earns it, a window; and up to 3 tests of the hunter's state at that moment | `formula.ts` given comparisons, `and` and a scope of counts: `count(kill, rank = E) >= 50` | One kind per idea: `killsOfRank { rank, n }`, `soloWonAbove { n }`, ... |
| What a GM makes it with on a phone | Selects and number fields, as the trigger editor of the status maker (`triggerList`, kit-parts.js): a kind, then rows of field, comparison, value | Typed text with its error under it. The window and the filter become text the GM must learn | One select and the numbers of that kind |
| The ideas file | 94 of 99 feats (F45, F46, F58, F86 approximately). Not: F59 (three kinds on one day), F70 (the HP a level-up's refill found is no fact's field), F74 (the same faces across gates), F77 (the room's dailies), F78 (trading, feature 5). 16 of 19 quests as counted objectives (6) | The same, as text | About 40 kinds for the 94, and a new kind for each new idea |
| What it costs the code | One field table per fact kind (1.3), one counter machine (5.6), one parser | `formula.ts` gains booleans and comparisons that no ability may use, a second reader of its tree, dice refused in one place and allowed in another | A kind, a parser branch, a maker row and words for each |
| A wrong field | Cannot be chosen: the maker offers the kind's fields; the parser drops a test of a field the kind lacks | Read as an unknown name at the boundary | Cannot happen |

Picked (a). The owner asked for feats "made by the GM in a maker as a status's triggers are": a trigger is an event and its conditions picked from lists, and (a) is that shape over facts. It is the tree at depth one, by choice: no `or` and no nesting. Every idea that (a) cannot say needs facts of the party or the room (N6), not a deeper tree; an `or` of two feats is two feats. (b) puts a second meaning into the one language the fight's numbers use. (c) is a hand-synced list that grows with every idea (the red flag "two ways to do one task" in reverse: one way per idea).

### 5.2 The types

```ts
// src/core/ids.ts: a feat's key, as a status has one. A built-in's is reserved; the GM's own is made from its name at
// creation (`freeFeatKey`) and kept through renames. A library entry under a built-in's key is an override of it.
export type FeatKey = Id<'Feat'>;   // parseFeatKey: [a-z0-9-]{1,40}

// src/core/hunter/counts.ts: what a feat or a quest's objective counts. Pure. Its one step is `countStep` (5.6).
export type Within = 'ever' | 'row' | 'session' | 'day' | 'rest';
export type Test<K extends FactKind> = { readonly field: FieldOf<K>; readonly op: '>=' | '<=' | '='; readonly value: number | string | boolean };
/** Each matching fact counts 1; or a numeric field's sum; or the number of different values of a field; or a numeric field's highest value (6). */
export type Measure<K extends FactKind> = { readonly of: 'facts' } | { readonly of: 'sum' | 'distinct' | 'max'; readonly field: FieldOf<K> };
type CountOf<K extends FactKind> = { readonly on: K; readonly where: readonly Test<K>[]; readonly measure: Measure<K>; readonly within: Within };
/** One fact kind, its tests, what to count, the window. A union over the kinds, so a field always belongs to its kind. */
export type Count = { readonly [K in FactKind]: CountOf<K> }[FactKind];
/** Where a count stands: its number, the window's mark it counts in, the values seen (a `distinct` count only). */
export type Counted = { readonly n: number; readonly mark: string; readonly vals?: readonly string[] };

// src/core/hunter/feats.ts
/** The hunter's state a feat may also need: its level, rank (its index, E 0 to S 5), titles held, streak, gold, or a lifetime number (`Tally`). */
export type StateTest = { readonly of: 'level' | 'rank' | 'titles' | 'streak' | 'gold' | keyof Tally; readonly op: '>=' | '<=' | '='; readonly value: number };
/** When the player sees a feat before it is earned: from the start, once its count reaches `n`, once another feat is earned, or never. */
export type Show = { readonly at: 'start' } | { readonly at: 'count'; readonly n: number } | { readonly at: 'feat'; readonly key: FeatKey } | { readonly at: 'never' };
export type FeatRule = Count & { readonly reach: number; readonly also: readonly StateTest[] };
/** A quest a feat issues (the System's, `from: 'system'`), its due time in hours from its issue (an urgent quest), and what failing costs (6). */
export type FeatQuest = { readonly title: string; readonly desc: string; readonly objectives: readonly Objective[] /* each with its `count`, 6 */;
  readonly rewards: Rewards; readonly onFail: Rewards; readonly dueHours: number | null };
export type FeatDef = {
  readonly name: string;          // "Thread's end"
  readonly window: string;        // the System window's title, "YOU ARE STILL STANDING" (copy-tasks: the System's voice lives in a window's title)
  readonly desc: string;          // what the player reads once earned, and while shown
  readonly show: Show; readonly rule: FeatRule; readonly rewards: Rewards; readonly quest: FeatQuest | null;
  /** A built-in the GM turned off: nothing counts toward it. Absent is on. */
  readonly off?: true;
};
/** The feats that apply on a phone, by key, in the order they are checked: `featsFor` (3.2). */
export type FeatBook = readonly (readonly [FeatKey, FeatDef])[];
```

Examples, from the ideas file:

```ts
// F01 Thread's end: a won fight this hunter ended up at 5% of max HP or less, never down in it
{ on: 'fight', where: [{ field: 'outcome', op: '=', value: 'won' }, { field: 'up', op: '=', value: true }, { field: 'low', op: '<=', value: 5 }, { field: 'downs', op: '=', value: 0 }],
  measure: { of: 'facts' }, within: 'ever', reach: 1, also: [] }
// F18 (Beast) A kind of expert: 100 beasts, shown from the start
{ on: 'kill', where: [{ field: 'type', op: '=', value: 'Beast' }], measure: { of: 'facts' }, within: 'ever', reach: 100, also: [] }
// F27 Clean sheet: 10 won fights in a row without going down
{ on: 'fight', where: [{ field: 'outcome', op: '=', value: 'won' }, { field: 'downs', op: '=', value: 0 }], measure: { of: 'facts' }, within: 'row', reach: 10, also: [] }
// F23 Field medic: 500 HP healed on allies
{ on: 'fight', where: [], measure: { of: 'sum', field: 'healed' }, within: 'ever', reach: 500, also: [] }
// F31 Field naturalist: kills of 5 different monster types
{ on: 'kill', where: [], measure: { of: 'distinct', field: 'type' }, within: 'ever', reach: 5, also: [] }
// F35 Marathoner: 3 solo runs won without a long rest between
{ on: 'solo', where: [{ field: 'outcome', op: '=', value: 'won' }], measure: { of: 'facts' }, within: 'rest', reach: 3, also: [] }
// F68 Reads the fine print: level 20 with no fall on record
{ on: 'level', where: [{ field: 'level', op: '>=', value: 20 }], measure: { of: 'facts' }, within: 'ever', reach: 1, also: [{ of: 'fell', op: '=', value: 0 }] }
// F79 The dice are watching: 3 natural 1s in one session
{ on: 'roll', where: [{ field: 'natural', op: '=', value: 1 }], measure: { of: 'facts' }, within: 'session', reach: 3, also: [] }
// The brief's "commended three times in one session": any bundle the GM gave by hand, 3 in a session
{ on: 'given', where: [], measure: { of: 'facts' }, within: 'session', reach: 3, also: [] }
```

### 5.3 Content: parser, library, pack, maker, Workshop, built-ins (AGENTS.md's recipe for a kind of custom content)

- **One parser**, `parseFeat` (hunter/feats.ts), run at load (the library), by the maker and on the `feats` doc. A wrong field of the words or the reward takes its default; a number past its bound is cut to it. A test of a field its kind lacks, or a value its spec cannot read, refuses the feat, and so does an unknown kind: dropping a test would widen what the feat counts ("beasts" becoming "any foe"), and only damaged or hostile data can hold one, since the maker offers only the kind's fields. A feat with no name is refused. The reward through `parseRewards`, the quest's objectives through `parseCount`. Bounds in `FEAT_BOUNDS` (section 13).
- **The library**: `library.feats: Record<FeatKey, FeatDef>`, the statuses' model exactly (`library.statuses`): a built-in's key holds an override (an edit, or `off`), any other key a GM's own; `featsFor` lays them over the built-ins as `rulesOf` lays statuses. Cap `LIMITS.libraryFeats` (100). Steps `saveFeat`, `removeFeat` (library.ts, as `saveStatus`, `removeStatus`); removing an override brings the built-in back.
- **Packs**: `feats` in `PACK_KINDS`, `Pack`, `packOf` (with the statuses its rewards name, through `rewardKeys`), `parsePack`, `mergePack` (Add: a new key; Replace: the same key). A pack's key travels, so a hunter who moves between two tables that share a pack keeps its progress on the same feat.
- **The maker**: `app.api.feats.make(key | null)` in a new `src/views/feat-maker.js`, through `app.api.maker.open`: Name, Window title, What the player reads; "Counts" (a fact kind select, then the trigger editor's row shape for each test: field, comparison, value, offered from `FACT_FIELDS`), "Earned at" (a number), "Within" (a `.seg`: Ever, In a row, One session, One day, Between long rests), "Also needs" (rows of state, comparison, number), "Shown" (`.seg`: From the start, After a count, After a feat, Never), the reward editor (`app.api.maker.rewards`), and "Issues a quest" (unit 8). The preview is `featLines(def, R)`: the rule in words ("Win a fight at 5% of max HP or less without going down."), its reward lines, when it is shown. The form below the first screen is `data-later`. No rule in the view.
- **The Workshop**: a Feats section: the built-ins with Edit (an override) and Turn off or on, the GM's own with New, Edit, Duplicate, Delete, Share; a feat left out of the doc marked so.
- **Built-ins**: `src/core/registry/feats.ts` `BUILT_IN_FEATS`, each entry an idea of the ideas file whose rule (a) can say and whose reward exists today: a title written by value from the ideas' section 4 (its bonus and words), ability points, gold, or a shipped item (Mana Potion, Stamina Tonic, Greater Health Potion). A boon is text, so a feat whose reward is a boon of the ideas file (R18, R19, R37, R41) ships with it. A feat whose reward is a skill or item that is not a seed yet (F06's R24 Final Notice, F09's R21 Spite) waits until that seed exists; unit 3 lists each choice. `tests/feats.test.ts` reads every built-in through `parseFeat` and gets it back whole (the content-table test every registry has).

### 5.4 The words

`featLines` and `ruleLine` (hunter/feats.ts) build the sentences from `FACT_FIELDS`' labels and the rule: "Defeat 100 beasts." "Win 10 fights in a row without going down." "Roll three natural 1s in one session." Each built-in may carry its own `desc` and needs no generated line; a GM's feat with an empty description reads its rule line. The progress line of a shown feat is `progressLine(def, state)`: "Monsters defeated: 37 of 100." The words follow copy-tasks.md (plain, fact first; only the window's title is in the System's voice).

### 5.5 A feat on a hunter (a machine, drawn before its table)

```ts
export type FeatState =
  | ({ readonly at: 'hidden' | 'shown' } & Counted)
  | { readonly at: 'earned'; readonly on: string; readonly name: string };   // the name as it was, so a deleted feat still reads
export type FeatEvent =
  | { readonly type: 'counted'; readonly count: Counted; readonly also: boolean }   // a fact its count takes moved it (5.6); `also`: its state tests hold now
  | { readonly type: 'broke'; readonly count: Counted }                            // a fact of its kind failed its tests ('row' only)
  | { readonly type: 'unlocked' };                                                 // the feat its `show` waits on was earned
export type FeatFx = { readonly type: 'earned' } | { readonly type: 'shown' };
```

An absent entry is the feat's start: `shown` with a count of 0 when its `show` is `start`, else `hidden` with 0. Only a moved feat gets an entry.

```
hidden --counted [n >= reach and also]------------------> earned   (earned, with no warning before)
hidden --counted [show is count, n >= show.n, n < reach]-> shown    (shown)
hidden --counted [otherwise]----------------------------> hidden   (the count kept)
hidden --broke------------------------------------------> hidden   (n 0)
hidden --unlocked---------------------------------------> shown    (shown)
shown  --counted [n >= reach and also]------------------> earned   (earned)
shown  --counted [otherwise]----------------------------> shown
shown  --broke------------------------------------------> shown    (n 0)
shown  --unlocked---------------------------------------> shown    (nothing)
earned --any--------------------------------------------> earned   (nothing: null in the table)
```

`TABLE: { [S in 'hidden' | 'shown' | 'earned']: { [E in FeatEvent['type']]: Step<E> | null } }`, `featStep(state, event, def)`. A count past `reach` whose `also` fails stays at its count and is asked again at its next counted fact (F68 earns at the first level fact at 20 or above whose moment has no fall on record). A feat that is `off` gets no event. Its chart is `scripts/charts/feat.ts` with walk events in `tests/models/feat-events.ts` and an entry in `MACHINES`.

Repeatable feats: none. The ideas file's rule 12 says a feat is earned once per hunter, and what a GM gives again and again is a bundle (section 7). One terminal state is what makes 4.3's loop end.

### 5.6 A count and its window (a machine)

`countStep(c: Counted, fact: Fact, count: Count, at: Mark): Counted | 'broke' | null`, where `null` is "this fact is not of its kind" and the mark of the fact's moment is its window's: `ever` and `row` '', `session` the stamp's session, `day` its day key, `rest` the tally's `longRests` (a long rest is a fact, so it moves the mark and every count between rests starts again).

| The count's window | A fact of its kind that passes its tests, same mark | ... a new mark | A fact of its kind that fails its tests |
|---|---|---|---|
| ever | n + adds | (no new mark) | unchanged |
| row | n + adds | (no new mark) | n 0 (`broke`) |
| session, day, rest | n + adds | adds (it starts again) | unchanged |

`adds` is 1 for `facts`, the field's value for `sum`, for `distinct` 1 when the field's value is not in `vals` (then added) else 0, and for `max` the rise of the field's value over `n`, never below 0 (so `n` is the highest seen); a new mark empties `vals`. A fact of another kind changes nothing. The same step moves a feat's count and a quest objective's (6), so the System counts one way.

### 5.7 What earning does, in the write that earned it

In `noticed`, for an `earned` effect on hunter `h`: the state set to `earned` (now, the name); a `feat` fact recorded (the chronicle keeps it; F94 counts hidden ones); the feats waiting on it `unlocked`; `grant(save, hid, def.rewards, null, { ...day, vitals: 'sheet' })` (the hunter is not held, 4.2, so the sheet holds its vitals); `def.quest` issued as an active quest (`issueQuest` with `from: 'system'`, its due time `dueAt(dueHours, at)`, its objectives counted from now). A party feat (F08, F73: "to each hunter up at the end") needs nothing more: each hunter's phone checks its own fight fact.

The window: device memory, as personal gate news is (`toldGate`): the feats view reads `featNews(save, told)`, the earned feats not yet told, and shows each as a System window (tag `! Feat`, title `def.window`, body `def.desc`, lines `grantLines`), queued by `ui.system`, marked told when answered (`feat-told:<hid>`). A reload between the write and the window shows it again; the store's `feats` announcement only brings the window up at once and carries the level-up's window.

## 6. A quest that counts by itself (N8, N9), in the one quest machine

The quest's `TABLE` (active, done, failed) does not change. Three things are added to what a quest holds, and the System moves them through the steps that exist.

```ts
// save.ts
/** `count`: the System moves this objective by facts (counts.ts); its progress is the count, capped at its target. */
export type Objective = { label: string; target: number; progress: number; count?: { rule: Count; mark: string; vals?: string[] } };
export type Quest = QuestState & { ...; /** What failing costs, given by `grant` in the failing write. Empty: nothing. */ onFail: Rewards };
```

- **Counted objectives.** `noticed` steps each active quest's counted objectives with `countStep` (5.6), the same step that moves a feat. A player's tap is refused on one (`setProgress` asks `systemCounts`, which becomes "the objective has a `count`"). When every objective of a quest is full and one of them is counted, `noticed` completes it through `finishQuest`, the one completion step (its reward, the streak, the penalty, the chain), in the same write, and the quest's `quest` fact follows in the same loop.
- **Issued with no GM tap.** A feat's `quest` (5.7) is issued by `issueQuest` with `from: 'system'`. The GM's quest form gets the same counted row (a forward use, section 11, rank 1), so a GM's quest to a player counts on the player's phone: `QuestOffer` (protocol.ts) gains `onFail` (read by the rewards reader) and an objective's `count` (read by `parseCount`). A counted quest of the GM's reports its end as today (`reportsProgress`): `noticed` posts the `questUpdate` when its context has a room (`NoticeCtx.room`, the code and the event maker sync.ts already has).
- **What failing costs.** `onFail` is a `Rewards` (negative XP, gold or points; a status such as Gate Sickness; a drawback or joke title, Q16's T78), given by `grant` in the one failing step: `questFailed(save, hid, qid, day)` (grant.ts, beside `finishQuest`), which runs `failQuest` (the chain told), the grant and the log line in one write. The Quests view's Fail and the rollover's failure of an overdue quest both call it (unit 1 already sent the rollover through `failQuest`). The card shows it under "If it fails" (`rewardLines`). `penaltyText` stays for what the GM honors by hand.
- **The Job Change level step** is today the one objective the System moves, by the chain's own `progress` effect on `levelChanged`. With counted objectives that is a second way for the System to count. Unit 8 makes the level step's objective a counted one (`{ on: 'level', measure: { of: 'max', field: 'level' } }`, seeded at the level the step is issued at), so the chain loses its `progress` effect and `systemCounts` its chain branch, and the step completes through `finishQuest` like any counted quest (which tells the chain `stepCompleted`, as completing a step does today). `max` is the fourth `Measure` (adds the rise of a field's highest value; "Reach level 10: 7/10"). This touches the chain's machine and chart, so the lead may keep the chain's own count instead; the notes would then list it as the second way and why it stays.

What the ideas' quests need: Q03, Q04, Q05, Q07, Q09 to Q14, Q16 to Q18 as written; Q01 and Q15 approximately (a gate's id is not a fact's field); Q02's shared count is per hunter here; Q06's returning monster, Q08's eight hours and Q18b's hidden gate stay the GM's. 16 of 19.

## 7. The GM's awards for roleplay

### 7.1 What it is

Variants:

1. **A feat with no condition, given by hand.** A feat is earned once and has a hidden or shown state and a count; a roleplay award is given again whenever the moment comes ("In character" in every session). It would need a repeatable arm and a "given" state that mean nothing for a noticed feat, and "feat" would name two things.
2. **A bundle with its window's words** (picked). A bundle is already "a reward saved to give again" (the glossary's word), with a library, a maker, the Workshop's Bundles and packs. What a roleplay award adds is its words in the System's window and that the System remembers it was given.
3. **A new kind, "commendation"**: its own type, parser, library list, pack line, maker and Workshop section. The most code, for a thing that is a bundle with two more fields.

Picked 2: it removes the need for a concept. A bundle given twice whose reward includes a title gives the title once (`grant` gives a title only when it is new), so "a title the first time, XP after" needs nothing more.

```ts
// rewards.ts
/** A System window's words: its title (the System's voice) and one plain line. */
export type SystemWords = { readonly title: string; readonly line: string };
export type RewardBundle = { id: BundleId; name: string; rewards: Rewards; /** The window it is given with; absent: "REWARD RECEIVED". */ window?: SystemWords };
// src/core/registry/bundles.ts: the bundles the app ships for the GM to give at the table (`seed-` keys), given as they
// are; the Workshop offers Duplicate for an editable copy (as the kits' examples).
export const BUILT_IN_BUNDLES: readonly (Omit<RewardBundle, 'id'> & { readonly key: string })[];
// protocol.ts: an award may name the bundle it was given from, with its window
export type AwardPayload = Base & { to: SheetKey[]; rewards: Rewards & { build?: BuildChange }; bundle?: { key: string; name: string; window: SystemWords | null } };
```

The built-ins come from `ideas-2-imaginative.md`'s section of roleplay awards when it lands; until then unit 6 drafts a few from the ideas file's boons and small rewards (R39 Naming Rights, R40 Blank Title, R19 The System Blinks) and the brief's own example, and the lead swaps in the second file's. Their sizes keep to the ideas file's section 1 (an E-rank title is 1 point).

### 7.2 Given in two taps, remembered as a fact

- **Where.** The Party board's hunter card (this phone's hunters and the players'), the GM's fight card of a hunter row, and a player's line in the Table feed (a roll or a use is often the moment) each get "Give…". It opens a sheet listing the built-in bundles and then the GM's, each with its name and its window's title. A tap on one gives it to that hunter. Two taps; the sheet is the confirmation.
- **The write.** `gmAward` with that one hunter, the bundle's rewards and `bundle: { key, name, window }`: a hunter of this phone is granted and its `given` fact recorded (and what its fight holds goes on its row through `grantWrite`, as an award does today); a player's hunter gets the `award` posted; the log line "Gave In character to Mira." All one write.
- **On the player's phone.** `landAward` grants, records `{ kind: 'given', key, name }` and shows the bundle's window (its title, its line, the reward's lines) in place of "REWARD RECEIVED". Once by the event's id.
- **What the System can then notice**: `given` facts with their session, so "commended three times in one session" is a feat (5.2's last example), and filtered by key, "given In character five times" is another.

## 8. What a title can do (N7)

The smallest general extension is the one the brief names: **a title may carry a worn status**, as a passive skill and a worn item do.

```ts
// save.ts and rewards.ts
export type Title = { id: TitleId; name: string; desc: string; bonus: Perk; seedKey?: string; /** On its hunter's row in every fight while it is the active title. */ worn?: StatusDef };
export type RewardTitle = { name: string; desc: string; bonus: Record<string, number>; key?: string; worn?: StatusDef };   // read by parseStatusDef
```

`wornStatuses` (rows.ts) adds the active title's `worn` with the source a passive skill's has (the hunter's rank tier), `giveTitle` copies it, the GM's title form and the reward editor's title row pick a status for it (its def by value, as an item's worn status is), and `pack.ts` follows its statuses. No new mechanism: a title gets every op a status has, its triggers and stacks included.

What it unlocks: a title that changes a decision (the ideas file's rule 7) rather than a number: R30 Marked by the System worn as a title (`edge` on attack and `threat` up), T55 Never Blocks with a `share` of damage taken, T16 Debt Collector with a trigger on `kill`, T40 Not on My Watch with a reaction's status, drawback titles whose drawback bites in fights. What it does not unlock: anything outside a fight. T71 Haggler (shop prices), T72 Hard to Finish (advantage on death saves), T73 Known Face (a gate shows its monsters) and T74 Decorated (a bonus per 10 titles) each need a mechanism of their own and stay as written (their bonus "today" in the ideas file).

## 9. Evaluation

- **When.** In `noticed`, at the end of every `store.apply`, for every hunter with facts in its inbox that no fight holds (4.1, 4.2). The facts come only from their writers (1.5). Nothing is checked on a timer or on looking at a screen.
- **Cost.** Per write, `facts x (feats + counted objectives)` count steps. A count step first compares the fact's kind (most stop there), then runs at most 4 tests. The worst write is a fight's end on the GM's phone with one hunter that took down 60 foes: 81 facts against 160 feats is 12,960 kind comparisons and, if a fifth pass the kind, about 2,600 test runs of at most 4 comparisons: under 50,000 simple operations. A usual fight's end with three hunters is about 24 facts, 3,840 comparisons. My estimate for the worst case is under 1 ms at the feel test's 4x CPU slowdown; unit 3 measures `noticed` on the worst case before it lands (a script in its scratchpad, 100 runs, the median and the spread in its notes), and the number that would change the design is a median over 4 ms (a quarter of a frame), which would move checking out of the loop over facts into a kind-indexed table of feats (each fact meets only the feats of its kind). A write with no facts costs a look at each hunter's inbox.
- **Earned once, however often a write is replayed.** A fact enters the inbox once: its writer's step runs once (a fight command, a land written once by its event id, a tick refused when it changes nothing, a tap). `noticed` empties the inbox in the same write, so a fact is counted once. `earned` is a terminal state. A reload between the write and the window loses nothing (the window is told from the save and device memory, 5.7). A write is whole or not at all (`store.apply`), so there is no half-noticed save. Test: "a fight's `noted` landed twice earns its feats once and counts its kills once" (the second is refused by `appliedOnce`, and a test also feeds the same facts through `noticed` twice in two writes to show the counts move twice, which is why the writers' once-ness is the guard and not `noticed`).

## 10. What the player and the GM see

### 10.1 The player

- **The Chronicle panel** on the hunter's sheet (a jump chip beside Titles): the lifetime numbers first (Fights won, Monsters defeated, Gates cleared, Falls, Feats), then the feats (earned: name, date, what it gave; shown: name and progress, `progressLine`), then the kept facts newest first, each one sentence from core (`factLine`: "Session 4. Won a fight in Goblin Warren in 5 rounds, at 4 of 45 HP. Defeated 3 Goblins.").
- **Hidden feats.** Variants: a "???" row for each (it tells how many exist, and the ideas file's rule 2 says a hidden feat is found by playing, not hunted); a count of those left (it leaks the GM's design and becomes a grind meter); nothing until earned (picked), with an earned hidden feat marked "Hidden" so the player knows it was a secret, and one plain line under the list: "Some feats stay hidden until earned."
- **The window** when a feat is earned (5.7): the feat's window title, its description, its reward's lines, then a level-up's window if its XP gave one.
- **Titles a feat gave** sit in the Titles panel as any title; the Chronicle shows the feat and its title together, in that write's order.

### 10.2 The GM

- **The Party board card** of each hunter: "Feats: 7, newest Thread's end", from the hunter (this phone's) or its pushed sheet (a player's: the pushed part of 1.6). A tap opens that hunter's Chronicle, read-only.
- **News**: "Mira earned Thread's end." once per hunter and feat, as a toast and a Table feed line, told by device memory (`feat-seen:<key>`) when a pushed sheet first shows it.
- **Give…** on the board, the fight card and the Table feed (section 7).
- **The Workshop's Feats** section and the rules switch "The System notices feats" (on by default) beside the personal gates' switch.

## 11. What these capabilities would let us do

Thought forward from the chronicle (facts kept, a lifetime tally, a feat's counted state, a counted objective, a bundle given and remembered). Each: what it needs beyond the base, how much a table would feel it, whether the base carries it without a rewrite, and whether shape (a) of 1.2 would.

| Rank | Capability | What it needs beyond the base | How much a table feels it | Base (c) carries it | Shape (a) would |
|---|---|---|---|---|---|
| 1 | **Contracts**: the GM issues a quest that counts by itself to one hunter or the whole party ("defeat 10 beasts before the next session", "clear 3 gates without a long rest"); the GM stops keeping tallies on paper | Only the counted row in the GM's quest form (unit 8 builds it for feats' quests) | High: every session, and it takes work off the GM | Yes | Yes (counters) |
| 2 | **A recap at a session's start**: Start session shows "Last time" (each hunter's kept facts of the last session, a line each), and the players' phones get a System window "LAST TIME" | `recapOf(hunters, sheets, session)` in core (the words), the GM's window, a `system` message to players | High: the first minute of every session | Yes (facts carry their session; a pushed sheet holds 8) | No (no facts) |
| 3 | **A spotlight line for the GM**: on the board, each hunter's sessions since its last bundle given and since its last kept fact, so a quiet player is seen ("Eldrin: no moment in 3 sessions") | A line on the board; one number beside the tally (the session of the last `given` fact), since a pushed sheet's 8 facts may no longer hold it | High for a roleplay table: it serves the owner's own ask about roleplay | Yes, with that number | No (a count says how many, not when) |
| 4 | **The chronicle as prose**: the System's account of a hunter, grouped by session, in the cold voice | Sentences per kind in core (`factLine` grows a session heading) | Medium to high: players read and share it | Yes | No |
| 5 | **Rivalries**: two hunters' numbers side by side ("Mira 41 kills, Brakk 39"), a feat for overtaking | A board line from two tallies; a rivalry feat needs a fact of another hunter's number (the GM's phone holds both sheets) | Medium; high at a competitive table | Partly: numbers yes, a rivalry feat needs a GM-side check | Partly |
| 6 | **Legends**: a fallen hunter's record (its death, tally, titles, feats) as an epitaph on a Legends list; a deleted hunter's record kept there | A `legends` list on the save, written by the delete step (a dead hunter keeps its chronicle already) | Medium to high: deaths are rare and remembered | Yes, with the list | Numbers only |
| 7 | **Titles the dead leave**: the GM passes a fallen hunter's title to an heir ("Heir of Brakk") | A GM action that grants that title with a `title` fact | Medium | Yes | Yes |
| 8 | **A System with a temperament**: window lines vary with the hunter's record (many falls: colder; a bench warmer: mocking) | A words table in core keyed by tally ratios | Medium: flavor felt at every window | Yes | Yes |
| 9 | **Packs of feats shared between tables** | Unit 5 builds it | Medium, for GMs who share | Yes | Yes |
| 10 | **Feats that open a gate**: a feat or a bundle opens a personal gate (the ideas' F45, R16) | A reward part that spawns a personal gate (`soloTick`'s spawn as a step) | Medium | Yes, with the reward part | Yes |
| 11 | **Personal bests**: fastest clear of each rank, most kills in a fight | Maximum keys in the tally (a fact's field folded by `max`, the measure 6 adds) | Medium to low | Yes, with keys | Partly |
| 12 | **Party and room feats** (F74 the same faces across gates, F77 the whole room's dailies) | A GM-side check over the players' pushed facts and tallies, with its own book of party feats | Medium | Partly: the facts exist, the check is new | No |
| 13 | **Feats for the GM**: sessions run, fights run, hunters lost; titles for the GM | A `Chronicle` on the save for the GM's seat and the GM's facts (the types are reused as they are) | Low to medium (the owner is the GM; he might enjoy it) | Yes, the types; new writers | Yes |

The three I rank highest are 1, 2 and 3: each is cheap on the base, felt every session, and 3 answers the owner's own ask from the other side (the GM sees who has not been given a moment). Contracts need nothing but a form row once unit 8 lands.

## 12. The cut: units, each whole with its tests, the app working after each

Each unit: its files, its tests (bun tests named by behaviour, browser files where a screen is the thing), what it deletes. AGENTS.md rows, `bun run deps -- --write` and `bun run charts` close each.

### Unit 1: the chronicle and its writers outside the fight's rows

- Files: new `src/core/hunter/facts.ts` (`Fact`, `FACT_FIELDS`, `KEPT`, `parseFact`), new `src/core/hunter/chronicle.ts` (`Chronicle`, `Tally`, `TALLY`, `record`, `parseChronicle`, `pushedChronicle`), new `src/core/hunter/noticed.ts` (this unit: stamp, fold, keep, the held machine; no feats yet); `save.ts` (`Hunter.chronicle`, its default and repair line); `src/edge/store.ts` (`apply` composes `noticed`; its context bound at start); the writers of 1.5 but the fight's: `grant.ts` (`sheetEdit` records life facts; `levelled` the level fact), `vitals.ts` (`revive` takes `by`), `record.ts`, `quests.ts`, `use.ts`, `inventory.ts`, a hunter-level rest step, `session-log.ts` `rolled`, `coin.ts`, `shadows.ts`, `solo.ts` (`soloTick` closed, `soloRan` solo and gate), `pay.ts` (`settleClear` for local payees); `push.ts`/`sync.ts` (the push sends `pushedChronicle`); `world.ts` and `protocol.ts` (`WorldDoc.session`).
- Tests: `tests/chronicle.test.ts` (each writer records its fact in its own write, the expected fact written from the rule; the tally's fold; the bound of 40; the stamp is the write's; a held hunter's facts wait and are noticed in the write that frees it), `tests/save.test.ts` (a chronicle that does not read is empty; a save without one reads), `tests/protocol.test.ts` (the worst pushed chronicle under a quarter of `SHEET_MAX`, read back whole), a store case ("after any `store.apply`, every inbox of a hunter no fight holds is empty"), `tests/lint.test.ts` ("only `record` appends to an inbox, only `noticed` empties it").
- Deletes: the rollover's own failure of an overdue quest; it fails through `failQuest` (a second way to fail a quest, which did not tell a chain).
- Measures: 1.6's feel case with worst chronicles before it lands.

### Unit 2: the fight's row tally and its facts (N2)

- Files: new `src/core/combat/row-tally.ts` (`RowTally`, `TallyEvent`, `tallied`), new `src/core/combat/fight-facts.ts` (`rowFacts`); `effect-ops.ts` (`Body.tally`), `fight.ts` (`act`, the reaction that saved), `fight-turn.ts` (`consequences`, `startTurn`, `triggered`), `triggers.ts` (`withKill` into the tally), `resolve.ts` (the formula's `kills` from the tally), `fight-parse.ts`, `rows.ts` (a monster row's `Origin` names its type), `fight-save.ts` (`fought` records a local row's facts on the `ended` effect; a remote row's facts are first sent by unit 4), `odds.ts` (`RunEnd` carries the hunter row's tally), `solo.ts` (kill facts of a run).
- Tests: `tests/row-tally.test.ts` (each field by a fight played on the reducer with fixed dice: "a hunter struck three times in a won fight has struck 3"), `tests/fight-facts.test.ts` (the party's fields on a fight of three hunters), `tests/fight-model.test.ts` (an invariant: a tally never decreases, and a row's kills are its tally's), `tests/formula.test.ts` (`kills` reads as before), `tests/odds.test.ts`, `tests/fight-sim.test.ts` (unchanged numbers), `feel.e2e.ts` run by the lead.
- Deletes: `Body.kills` (one count of kills, the tally's).

### Unit 3: feats, their machine and the built-ins

- Files: new `src/core/hunter/counts.ts` (`Count`, `Counted`, `countStep`, `parseCount`), new `src/core/hunter/feats.ts` (`FeatDef`, `parseFeat`, `featStep` and its `TABLE`, `featsFor`, `featLines`, `ruleLine`, `progressLine`, `featNews`), new `src/core/registry/feats.ts` (`BUILT_IN_FEATS`), `noticed.ts` (feats checked, earned, granted, quests issued), `ids.ts` (`FeatKey`), `save.ts` (`library.feats`, `LIMITS.libraryFeats`), `library.ts` (`saveFeat`, `removeFeat`), `rules.ts` and `overrides.ts` (`RULES.feats.on`), new `src/views/feats.js` (the windows from `featNews`, told by device memory) in `MODULES`, `scripts/charts/feat.ts`, `tests/models/feat-events.ts`, `MACHINES`.
- Tests: `tests/feats.test.ts` (every built-in reads back whole; every cell of the feat's table; F01, F27 (in a row), F35 (between rests), F79 (a session), F31 (distinct), F68 (an `also`), each from facts; a feat earned once over a replayed land; the chain of 4.3 ends), `tests/counts.test.ts` (every cell of 5.6's table), `tests/statecharts.test.ts`, `tests/e2e/feats.e2e.ts` ("a hunter alone wins a solo run at 3 HP and sees YOU WALKED OUT. BARELY once, again after a reload until answered").

### Unit 4: the room's part

- Files: `protocol.ts` (`noted`, `FeatsDoc` and its reader in `DOCS`), `room-events.ts` (`APPLIERS.noted`; `landSoloAnswer`'s gate fact), `fight-save.ts` (`fought` posts `noted` for each remote row), `pay.ts` (`settleClear` posts `noted` for each remote payee), `feats.ts` (`featsDoc`), new `src/edge/feats.ts` (the doc's overlay), `sync.ts` (binds it; the release write of 3.3), the publisher of the doc (where the `rules` doc is published).
- Tests: `tests/protocol.test.ts` (`noted` valid and each bound; the worst-case feats doc by part), `tests/server-rooms.test.ts` (`noted` refused from a player), `tests/applied.test.ts` ("a fight's facts land whole, once"), `tests/models/room-world.ts` (`noted` as a GM move), `tests/e2e/feats-room.e2e.ts` (the GM ends a fight; the player's phone shows the feat's window once, and the GM's board then names it).

### Unit 5: the maker, the Workshop, packs

- Files: new `src/views/feat-maker.js`, `kit-parts.js` (a test row shared with the trigger editor, if it fits without bending either), `workshop.js` (Feats), `pack.ts`, `gm.js` (`MAKE`).
- Tests: `tests/pack.test.ts` (feats travel, Add and Replace), `tests/e2e/makers.e2e.ts` ("a GM makes a feat for three natural 1s in a session; the third roll earns it"), `look.e2e.ts` at 360.

### Unit 6: the GM's awards for roleplay

- Files: `rewards.ts` (`SystemWords`, `RewardBundle.window`, `parseBundle`), new `src/core/registry/bundles.ts`, `award.ts` (`gmAward` records `given`), `protocol.ts` (`AwardPayload.bundle`), `room-events.ts` (`landAward`: the fact and the window's words), `gm.js` (Give… on the board), `combat.js` (Give… on a hunter's card), the Table feed's line, the bundle maker (two fields), `workshop.js` (built-in bundles with Duplicate).
- Tests: `tests/rewards.test.ts`, `tests/award.test.ts` ("a bundle given records its fact in the award's write"), `tests/protocol.test.ts`, `tests/e2e/reward-room.e2e.ts` ("the GM gives a bundle from a player's card in two taps; the player's phone shows its window and its chronicle holds it").

### Unit 7: the screens

- Files: `hunter.js` (the Chronicle panel and its chip), `src/core/hunter/chronicle.ts` or a words module (`factLine`), `gm.js` (the board's feats line, a player's Chronicle read-only, the news), `scripts/ui-shots.ts`.
- Tests: the words' test, `look.e2e.ts`, the `phone.e2e.ts` sweep.

### Unit 8: counting quests and titles with worn statuses

- Files: `save.ts` (`Objective.count`, `Quest.onFail`), `quests.ts`, `quest-rights.ts`, `grant.ts` (`questFailed`), `noticed.ts` (counted objectives, completion, the report), `protocol.ts` (`QuestOffer`), `quests.js` (the counted row, "If it fails"), `job-chain.ts` (the level step as a counted objective, if the lead takes it), `rows.ts` (`wornStatuses`), `record.ts` and `rewards.ts` (`worn` on titles), `reward-editor.js`, `pack.ts`.
- Tests: `tests/quests.test.ts` (a counted quest completes itself through `finishQuest`; a failed one pays its cost in the failing write), `tests/job-chain.test.ts` (the level step still completes at its level, its chart redrawn), `tests/rows.test.ts` ("the active title's worn status is on its hunter's row; another title's is not"), `tests/rewards.test.ts`, a browser step in `tests/e2e/rewards.e2e.ts`.
- Deletes, if the lead takes 6's last point: the chain's `progress` effect and `levelChanged` counting, `systemCounts`' chain branch.

Order: 1 then 2 are the foundation (2 records through 1's `record`; its tally alone could be built beside 1, but it lands after). 3 needs 1 (and 2 for the fight feats among its built-ins: those wait or ship in 3 after 2). 4 needs 2 and 3. 5, 6, 7 need 3 and may go in any order; 8 needs 3.

What the units simplify: one kill count (2), one way to fail a quest (1), one way for the System to move an objective (8), one parser for a fact wherever it comes from (1 and 4). Not deleted, with reasons: `daily.streak` stays the daily engine's own state (its bonus point every 7 days is a rule, not a record; the `daily` fact carries its value); `Gate.fought` stays the gate's own list of who fought it (the Clear offers them first; it is the GM's gate, not a hunter's record); `CodexEntry.kills` stays the campaign's count of a monster kind.

## 13. The rule numbers

| Number | Value | Why |
|---|---|---|
| `CHRONICLE_MAX` | 40 | A quiet month of dailies, or about three sessions of a table (12 kept facts a session), which is what a player scrolls and what a recap reads; 28.8 KB worst a hunter on the phone. The one number a measurement may lower (to 20), 1.6 |
| `PUSHED_FACTS` | 8 | A session's fights and its level, for the board and a recap of the last session; 5.8 KB worst |
| `PUSHED_FEATS` | 40 | The newest earned; 2.4 KB worst, so the push's worst growth is a quarter of `SHEET_MAX` |
| `INBOX_MAX` | 200 | A bound for junk: a fight's end adds at most 81, and a held hunter's waiting facts are a few |
| `NOTED_MAX` | 81 | 1 fight fact, a kill for each of `MAX_ROWS` (60) foes, 20 consumables; ~10.4 KB, inside the server's 64 KiB |
| `LIMITS.libraryFeats` | 100 | Typical feats are ~700 characters, so about 60 fit the doc; 100 is past what a GM writes and keeps the doc's builder honest about what it leaves out |
| `FEAT_BOUNDS` | name 60, window 60, desc 300, tests 4, also 3, reach 1 to 100,000, distinct values 24, text values 40 | Name and window as a title's 60; 4 tests cover every idea (F01 needs 4); 100,000 is a hundred times F28's 1,000; 24 values is four times the six monster types |
| `FEAT_STATES_MAX` | 400 | A hunter's feat entries: the built-ins (about 60) and the library (100), twice over for feats deleted and made again; counting entries go first, earned ones never |
| `RULES.feats.on` | true | The System notices by default; the GM turns it off in the rules, and the room carries the switch in the feats doc |
| `SystemWords` | title 60, line 200 | A window title as a feat's; a line as a boon's text |
| The tally's numbers | whole, 0 to 1e9 | A bound for junk, as the vitals' |

The built-in feats' rewards keep the ideas file's balance (section 1 there: a title is 1 point at E to 5 at S, a feat at most 1 ability point below B and 3 anywhere), copied as written.

## 14. Decision trail

1. Facts are the unit of what happens; the shapes differ in what is kept (1.1). Every shape needs the fight's row summary as a fact, so N2 is not a reason to pick one.
2. Shape (c), a lifetime tally, each feat's own count and the last 40 kept facts (1.2): (b) cannot travel in a sheet and cannot count to 1,000 once bounded; (a) cannot take a GM's filter and keeps nothing to read.
3. A feat's count is its own, from when it reaches the hunter, not a key of a global tally: a GM's filter is any combination of a kind's fields. The tally is for the Chronicle panel and a feat's `also` tests, which read the lifetime numbers (two ways to ask "how many", said plainly in the maker: "counts from now" against "the hunter's record").
4. Kills, uses, rolls, coins, the shop and rests are counted and not kept (1.4): many and small; a kill lives on in its fight's numbers.
5. The phone that holds the hunter checks feats (2.1); the GM's phone sends what only it sees.
6. A fight's facts for a player travel in a new `noted` message, not in `vitals` (a keyed total, replaced while waiting) nor in the settle's `award` (sent only with XP) (2.3).
7. The fight keeps a row tally while it runs (2.2), written by one function at four places of the reducer; `Body.kills` folds into it.
8. Writers append to an inbox on the hunter; the store runs `noticed` at the end of every write (4.1). Refused: each caller calling it (about 20 sites, some unable to grant); a diff of the save (implicit).
9. A hunter a fight holds keeps its facts until the fight lets it go (4.2): a reward's statuses go on a sheet the fight would overwrite. A release write when a room's fight doc frees a player's hunter (3.3).
10. Facts are stamped by `noticed` with the write's moment, not by their writers (most writers hold no clock or session).
11. The condition is a typed tree of depth one (5.1): one fact kind, field tests, a measure, a reach, a window, state tests. Refused: a formula with comparisons, a fixed list of kinds.
12. Feats are kept as statuses are: `library.feats` by key, a built-in's key an override (5.3), so a GM edits or turns off a built-in in place.
13. A feat is earned once; no repeatable arm (5.5). What is given again and again is a bundle.
14. The window's moment is told by device memory as personal gate news is (5.7), so a reload loses no window and no write marks a window shown.
15. A counted objective in the one quest machine, completed through `finishQuest`; a failure cost as `onFail: Rewards` given in one failing step that the rollover uses too (6).
16. The Job Change level step joins the counted objectives (6), the lead's call.
17. A roleplay award is a bundle with its window's words; an award names the bundle it came from, and the player's phone records `given` (7).
18. A title may carry a worn status (8); nothing outside a fight is designed here.
19. Hidden feats show nothing until earned (10.1).
20. The feats doc is its own doc, built whole entry by entry within `DOC_MAX` (3.2).
21. The roleplay shelf's built-ins wait for `ideas-2-imaginative.md`, which was not there (section 0).

## 15. For the owner

### Choices he might want otherwise (for for-the-owner.md, written by the unit that lands each)

- A feat the GM makes counts from when it reaches a hunter's phone, not what the hunter did before (3.2). He would say "count the past" to have a new feat read the tally and the chronicle's last 40 facts.
- The GM's hidden feats sit on the players' phones, where a player who reads the phone's storage can find them (2.1). He would say "keep them on my phone" to have the GM's phone check the GM's own feats, with their windows waiting until the GM's phone is online.
- A hunter in a fight earns nothing until the fight ends; a fall in round 2 is noticed at the end (4.2).
- On the GM's phone the GM's own hunters (NPCs, pregens) earn feats and show their windows. He would say "only players' hunters" to have the GM's phone skip them.
- Alone in player mode nobody starts a session, so a "one session" feat counts across everything since the last session (3.1).
- Hidden feats show nothing until earned, not a "???" (10.1).
- The roleplay shelf gives on the second tap, with no undo (7.2): a reward's undo is not exact (a level-up's refill).
- A feat earned once is never taken back, even when the GM deletes it (the ideas file's rule 9).

### Questions only he can answer

1. Should the GM's hidden feats stay off the players' phones even if that means a player's window waits for the GM's phone? (Default: they travel; the built-ins are in the app's code anyway.)
2. Should a feat made mid-campaign count what the hunters did before it existed? (Default: no.)

## 16. Principles read, and the choice each changed

- `principle-foundational-thinking`: the facts, the chronicle and the row tally come first (units 1 and 2), before any feat; every later unit stands on them. "What happens if another actor modifies this concurrently": the GM's phone never writes a player's chronicle, it sends facts that land once (2.1, 2.3).
- `principle-model-the-domain`: a feat's life is a machine with a table (hidden, shown, earned) instead of flags; a count's window is a table of resets (5.6) instead of per-window code; the inbox is a two-state machine with its held rule (4.2); the fact kinds are a union with a field table the compiler holds.
- `principle-redesign-from-first-principles`: as if remembering had been there from the start, the life fact is recorded where the life machine is driven (`sheetEdit`), the level fact where levels are told (`levelled`), and the quest's failure goes through one step (which removed the rollover's own path).
- `principle-exhaust-the-design-space` and `architect` (weighed on paper, no helpers): three shapes for what is kept (1.2), three for who checks (2.1), three for where checking runs (4.1), three for the condition (5.1), three for the roleplay award (7.1), three for the message (2.3), three for hidden feats (10.1).
- `principle-type-system-discipline`: `FeatKey` is its own id; `Count` is a union over fact kinds so a test's field always belongs to its kind; `FACT_FIELDS` and `TALLY` are typed by the union, so a new kind or field without its row does not compile.
- `principle-boundary-discipline`: one reader of a fact, `parseFact`, at the save, the `noted` message and the sheet push; one reader of a feat, `parseFeat`, at the library, the doc and the maker; inside, `noticed` trusts its types.
- `principle-make-operations-idempotent`: each fact enters an inbox once (its writer runs once, a land by its event id); `noticed` empties it in the same write; `earned` is terminal; the release write is a no-op when the inbox is empty; a window is told from the save, so a crash between the write and the window shows it again (9).
- `principle-subtract-before-you-add`: no repeatable feats, no commendation kind (a bundle with two fields), no feats report message (the GM reads the pushed sheet), one kill count, one way to fail a quest, one way for the System to move an objective; kept facts are a subset by a table, not a second type.
- `principle-explain-the-number`: every bound in section 13 with its reason; the sheet's and the doc's arithmetic shown (1.6, 3.2, 2.3); the two numbers that could move the design (the chronicle's per-write cost, `noticed`'s cost) have their measurement and the result that would change the design written before they run (1.6, 9).
- `principle-experience-first`: hidden feats show nothing rather than a "???" grind list; the roleplay award is two taps from the place the GM is already looking; a window survives a reload; a shown feat says its progress in words.
- `statechart`: its TLA+ run needs TLC from the network and this phase runs nothing, so the three machines (5.5, 5.6, 4.2) are drawn by hand with every cell; `bun run charts` draws the feat's and the count's from the real steps in unit 3, as the solo notes did.
- `unslop`: these notes, plain and without em dashes.
- `humanizer` and `unslop` (from Nov 18, the lead's copy rule): every sentence a player or GM reads, read against both before it is committed; what they changed is in 17.3 and 17.4.

## 17. The lead's rulings (Nov 18) and the build

Rulings: the design approved (shape (c), the hunter's phone checks, the depth-one tree, the award as a bundle with its words). The two questions keep their defaults (both in for-the-owner.md). The Job Change level step stays the chain's own (6's last point is not taken). The order: unit 1, then the GM's awards for roleplay (as far as they need only unit 1 and the `award` message), then 2, 3, 4, 5, 7, 8. The researcher's second file was stopped, so the shelf is written here. `noticed` must cost only a length check when every inbox is empty, and unit 1 measures a write before and after.

### 17.1 Unit 1 and the awards for roleplay (built)

What was built, by the design's sections:

- `src/core/hunter/facts.ts`: `Fact` (18 kinds, each with one writer), `FACT_FIELDS` (the compiler holds each kind's specs against its type; `every<T>()` makes a list the compiler refuses when it misses a member, for the lists that cannot be imported from save.ts without a cycle), `KEPT`, `parseFact`, `parseKept`. Two changes from 1.3, each a subtraction: the fight's, a kill's and a feat's kinds wait for the units that write them (2 and 3); `penalty` became `penaltyIssued` and `penaltyLifted`, since a field table keyed `penalty: {` is what the penalty lint reads as a write of a hunter's penalty, and two kinds with one number each are plainer than one with an event. The `solo` fact keeps its gate's name; `odds` and the reset's minutes wait for the feats that read them.
- `src/core/hunter/chronicle.ts`: `Chronicle` (inbox, kept facts, tally; the feats' states join in unit 3), `TALLY` (25 lifetime numbers, one row each), `record`, `tallyAfter`, `pushedChronicle`, `parseChronicle`; `CHRONICLE_MAX` 40, `PUSHED_FACTS` 8, `INBOX_MAX` 200.
- `src/core/hunter/noticed.ts`: `noticed(save, ctx)` (the context a thunk, asked for only when a fact waits) and `released`; the inbox's two-state rule in its header. `store.apply` runs it on every step's answer; `bindNotice` (store.ts) takes the room's session and fight doc on a player's phone, else the save's own; sync.ts runs the release write after a good poll when a waiting hunter is let go.
- The writers: `sheetEdit` (life, and a rest, now a `SheetEdit` of its own so the rest's heal has its writer too; hunter.js's rest calls it), `levelled`, `giveTitle`, `setRank`, `reevaluate`, `completeQuest`, `failQuest`, `penalized`, `rollover` (its overdue failure now through `failQuest`), `useItem` (and its revive `by: 'item'`), `buy`, `sell`, `rolled`, the coin's two landings, `shadowRises`, `soloTick`, `soloRan`, `settleClear`. The sheet push sends `pushedSheet(h)` (push.ts), and the push's change test compares the same cut. The world doc carries the session.
- The awards for roleplay: `SystemWords`, `parseWords`, `WORDS_BOUNDS` and a bundle's `window` (rewards.ts; `saveBundle` and `parseBundle` keep it); `src/core/registry/bundles.ts` (30 built-ins in 10 moments, each with a comment on its size: 3 lines only, 8 one-use boons, 7 single ability points, 1 of 50 XP, 6 E-rank titles, 1 D-rank title, 4 rare and large); `GivenBundle` on the `award` message; `gmAward(..., given)` records `given` on this phone's hunters, `landAward` on a player's and opens the window in the bundle's words; gm.js's Award form now sends through `sendAward`, which Give… on each board card uses too (`giveFrom`: the shelf as a System window of the GM's bundles and then the built-ins, a tap gives); the bundle maker's Window title and Window line (a bundle with a title may give nothing else); the Workshop lists the built-ins under "Awards for roleplay to copy" with Duplicate, which keeps the words.
- Not built here, by the order: the fight's facts (unit 2), feats (3), the room's `noted` and feats doc (4), Give… on the fight card and the Table feed (unit 6's rest, after 3, since they need nothing new but a button).

Tests (each expected value from the rule): `tests/chronicle.test.ts` (17: the notice step's fast path, stamp, fold, bound, the held machine and the release; each writer's fact; the boundary; the pushed cut's worst case against a quarter of `SHEET_MAX`, 8,192; measured in 17.2), `tests/bundles.test.ts`, cases in `award`, `applied`, `protocol`, `coin`, `inventory`, `pay`, `solo`, `quests` and `record` tests, the lint "only chronicle.ts's record writes a hunter's inbox of facts, and only the notice step empties it", and the browser case "the GM gives an award for roleplay from a player's card in two taps" (`tests/e2e/reward-room.e2e.ts`). Round trips that compared whole hunters now state the difference: the System remembers the purchase and the sale, the title given, the quest failed.

### 17.2 The measurement of ruling 3

Written before the runs: the change adds, on every write, a length check of each hunter's inbox (`noticed`'s fast path) and a read of each hunter's chronicle in the repair (`parseChronicle`, which the repair already runs on every write for every field). The result that would stop the build before unit 2 is a fight turn's worst tap or worst frame slower at head than at base by more than the run-to-run spread, over runs interleaved on the same box. What could fake it: the box's 2x swings in speed (notes-lag-use.md section 2), and the test's hunters, whose chronicles start empty, hiding the cost of a full one. So the browser runs answer "is today's fight turn slower", and a bun timing of the repair answers "what a full chronicle costs", which no browser case yet holds.

**The fight turn, interleaved** (the lag test's case "on a slow phone the GM plays a turn", 4x CPU, port 3260, one worker, alone on the box, load 0.6 to 2.1; base a `git worktree` at 412b4c2 with the main tree's `node_modules`, removed after; head the working tree; head then base, five times):

| Run | head worst frame, worst tap, long tasks | base worst frame, worst tap, long tasks |
|---|---|---|
| 1 | 83.4, 63.3, [51] | 66.7, 55.2, [54] |
| 2 | 66.7, 60.9, [] | 66.6, 54.6, [55] |
| 3 | 50.0, 49.1, [] | 100.1, 71.2, [56, 56] |
| 4 | 50.0, 53.4, [] | 66.7, 64.7, [] |
| 5 | 49.9, 48.7, [] | 83.4, 72.3, [55, 55] |
| Median | 50.0, 53.4 | 66.7, 64.7 |

Every run passed. The lead's CI started in its own worktree at 16:01, during pairs 4 and 5, so that set was run again on an idle box (load 0.6 to 1.5, CI checked idle before each run), twelve pairs more: six with head first and six with base first, since a box that has just been idle may run the first of two runs differently.

| | head first: head worst tap | head first: base worst tap | base first: base worst tap | base first: head worst tap |
|---|---|---|---|---|
| Runs | 72.7, 44.0, 65.0, 60.6, 62.8, 50.0 | 43.3, 47.8, 57.9, 58.2, 58.8, 46.8 | 58.4, 43.7, 45.0, 56.7, 60.2, 69.3 | 62.1, 41.4, 44.5, 63.5, 53.4, 54.9 |
| Median | 61.7 | 52.9 | 57.6 | 54.2 |
| Worst frame, median | 41.7 | 41.7 | 41.7 | 50.0 |

The side that runs first is the slower in both orders (head by 8.8 ms when first, base by 3.4 ms when first), so the order, not the code, moves the medians; over all twelve pairs head's worst tap has a median of 57.8 and base's 57.3, each with a spread near 30 ms (41.4 to 72.7, 43.3 to 69.3). Long tasks: one of 74 ms at head (pair 4, base first), none at base in this set, one or two of 54 to 56 ms at base in the first set. The work predicts no change: the test's hunters have empty chronicles, so the write adds a length check and an empty read, both measured below in microseconds. No run says otherwise.

**What a full chronicle costs a write** (a bun script in the scratchpad, `bench.ts`: the save's own `repairSave` on a clone of a save with 6 hunters, 7 runs each, the median and the range; the clone timed alone and taken out):

| | Median (µs) | Range |
|---|---|---|
| `noticed`, 6 hunters, every inbox empty | 0.03 | 0.02 to 0.05 |
| `noticed`, one fact waiting | 1.12 | 0.99 to 1.43 |
| clone + repair, empty chronicles | 279 (clone alone 95) | 251 to 342 |
| clone + repair, 40 worst kept facts on each of 6 hunters | 929 (clone alone 493) | 849 to 965 |
| `JSON.stringify` of the save, empty / worst | 8.7 / 55.9 | |

So the repair of 240 worst kept facts adds about 436 - 184 = 252 µs a write on this box, and the store's stringify about 47 µs more: about 0.3 ms, about 1.2 ms at the lag test's 4x, against a spread of 15 ms or more in the table above. The limiter is the parse of each kept fact's fields (`parseKept` reads every field of its kind's table) and the save's size (7.3 KB to 67.5 KB with every hunter at its worst); no browser case holds a full chronicle yet, and none needs to before `CHRONICLE_MAX` is in question. The pushed cut's worst case with today's kinds is 2,602 characters (a tally of 523 and 8 facts of 255); the fight's fact of unit 2 is larger, and unit 2 measures it again against a quarter of `SHEET_MAX`.

Verdict: a fight turn's write is not measurably slower. Unit 2 may start.

### 17.3 The Give shelf at 390 px, and the second list's awards merged in

The lead's look at the first shelf (a System window listing 30 names) asked for six things. What each became:

1. **What a row says.** Each row is its name (and "Rare" when it is), a few words of when to give it (`BuiltInBundle.when`, at most 70 characters, a test), and what it gives in one line (`givesLine`, bundles.ts: the reward window's own parts from `grantLines`, a title with its bonus, "Title: Scar Tissue (+1 DIS)", a boon with what it lets the player do, since a boon's name is often the award's own; "Only the System's line." when it gives nothing). A bundle the GM saved says "A bundle you saved" where a built-in says when.
2. **Groups.** Under headings, in order: "Last given" (this phone's last four, `RECENT_GIVES`), "Yours" (the GM's own bundles), then each moment (`MOMENT_WORDS`, 18 moments).
3. **Search, chips, or the last given.** Chosen: moment chips that filter, plus the last given at the top, and no search field. By taps, at 390 px with 83 awards: a search is a tap on the field, a keyboard that covers half the screen and four or five letters typed, and it asks the GM to remember an award's name, which is the one thing a GM in the middle of a scene does not have; a chip is one tap and asks for the moment, which is what the GM just watched. A chip shows its moment alone (1 to 7 rows; at 390 by 844 six rows and a half show, so the longest moments scroll one row), so give is Give…, the chip, the row: three taps, and two when the award is in "Last given" or the first moment, as Held the Mask is. Jumping (scrolling the long list to the heading) was weighed against filtering: a jump leaves 80 rows to scroll past by mistake and the chip still lit over a heading off screen; a filter leaves only the moment's rows. The chips sit in one row that scrolls sideways inside itself (18 chips do not fit one line at 360, and wrapped they take five lines of the screen); the page and the window never scroll sideways (the look test).
4. **A stray tap.** Chosen: the held toast. A tap on a row closes the shelf and shows "Given: Held the Mask to Mira." with Undo for two seconds (`GIVE_HOLD_MS`); the write is made when the toast ends, by the same `sendAward` an award takes without it, so there is no second path: `ui.toast` takes a `hold` (`act`, `ms`, `undo`), runs `act` as the toast ends, and never runs it if Undo was tapped. A held toast pushed off by a third toast, or on a page hidden or left (`visibilitychange`, `pagehide`), ends at once and its write is made, so a give is never lost by a phone put down. Weighed against: nothing (a stray tap on a list of 83 gives a stray award, and an award's undo is not exact, a title and its window cannot be taken back from a player's phone); a confirm (a third tap on every give, for a mistake made on few). The cost: a give reaches the player two seconds later. The toast's own timer is the one it had, so ui.js's timer count stays 4.
5. **Cancel without scrolling.** The window is a column: its head (the tag, the title, Cancel), "How to use these" and the chips stay put; the list scrolls inside. The look test scrolls the list to its end and finds Cancel where it was.
6. **Tests.** The shelf's two screens are in `scripts/ui-shots.ts` ("give shelf"). `tests/e2e/look.e2e.ts` at 360 and 390 ("the GM's shelf of awards keeps Cancel and its moment chips on screen..."): Cancel, the guide and the chips in view, every button 44 px, a row's when and gives, no sideways scroll of the page, the window or the list, the list scrolled to its end with Cancel unmoved, the guide opened, Cancel giving nothing. `tests/e2e/reward-room.e2e.ts` ("...in two taps: it is held two seconds under Undo..."): two taps and the held toast, the write after it ends; the chip "A lie" showing its seven awards alone; Undo, after which "Last given" holds only the earlier award and the chronicle only the one given after.

**The second list merged in.** Every award of features/ideas-2-imaginative.md section 3 marked BUILDABLE TODAY is on the shelf (its A number in its comment), 53 of them, with the first shelf's 30 less one: "Remembered" (kindness, a helper who returns) said what A13 "A Stranger's Lamp" says, so A13 took its place. The moments are the union, 18: the first shelf's 10, and rivalry, a running joke, a hunter changed its mind, a secret kept, a promise, mercy, fear played honestly, and any moment (A62 "Seen", a window with nothing in it). 83 awards: 4 a line alone, 28 a one-use boon, 21 ability points, 17 an E- or D-rank title, 1 of XP, 1 an item worth nothing (A46's Keepsake), and 11 rare (`rare: true`): a title of B or A rank, up to 3 points, A31's legendary The Punchline (worn, a shield of a quarter of max HP as each fight begins), A04's and A08's boons. A boon the second list wrote as a status the GM puts on (A06's shield, A18's Hasted) stays a boon whose text says so, since a bundle given outside a fight cannot know the next fight. The test now reads the rare mark: a rare award at most a sixth of the shelf, a plain one worth at most 2 points, any at most 6.

The ones that wait, against what builds them:

| Award | Waits for | Who builds it |
|---|---|---|
| A20 Repeated, A42 Pause (a window on every phone) | N13, a System window to the whole room as an award | not a unit of feature 1; the GM's broadcast (GM view, System broadcast) does it by hand today |
| A38 Renounced (a title taken away) | N11, a reward that takes away | not a unit of feature 1; the GM removes the title on the sheet by hand |
| A47 What They Carried (a dead hunter's title to its heir) | N16, an heir | not a unit of feature 1 |
| A51 Witnessed (a promise becomes a quest) | a reward that issues a quest, and N9 for its failure title Forsworn | N9 is unit 8's failure cost; a bundle that issues a quest is not in feature 1 (and the Stories ruling keeps a quest the GM's to issue); the GM makes the quest in the quest form today |
| A26 Two Edges' link (+1 while the rival is in the fight) | N15, a pair | not a unit of feature 1; the two titles are on the shelf today |
| A16 The Turned, A29 Made True, A61 The Table Agrees | GM ONLY (the creature's arrival, the world's fact, the spoken vote) | no unit: the GM's part is the award |

**How to use these.** The second list's guide (3.19) is nine sentences in core (`GIVING_GUIDE`), opened from the shelf's "How to use these" at the top of the list.

**The words, through humanizer and unslop** (the lead's copy rule of Nov 18, read in full: `.claude/skills/humanizer/SKILL.md`, `.claude/skills/unslop/SKILL.md`). Every name, when line, gift line, window title and line, and the guide, read against both. Changed where a tell showed: 47 window titles or lines, one boon text, and five of the guide's nine sentences. The tells found most: a contrast that only adds weight ("You played the hunter, not the sheet.", "THE SYSTEM CALLS IT A WEAKNESS" / "It is not one.", "THE SYSTEM SEES THE LOCK. NOT THE KEY", "A clause, not a gift: ..."), a one-line closer ("That counts.", "Good.", "Nobody asked you to bring it. You did."), sayings ("Listening is a skill.", "FEAR IS DATA", "Some accounts are kept in the dark.", "SECOND PLACE IS STILL A PLACE"), stiff passives ("A KINDNESS WAS COUNTED", "The XP was given up. Something else was gained."), and fragments for effect ("Two names, one ledger."). Each now says what happened: "You answered as the hunter would, even when it cost you.", "A SOFT SPOT" / "You were kind when it cost you something.", "THE SYSTEM SEES ONLY THE LOCK", "THE SYSTEM NOTED YOUR FEAR" / "You were afraid, and you let it show.". The guide: "An award at the end of the session rewards a memory, not the moment." became "Give it right after the moment, while the table still remembers it."; "Reward the moment, not the player: ..." became "When you give one, name what happened, like "that line". ...". The old first shelf's hint "Pick a bundle. It is given at once." went with the System window it was in. The shelf's own words (`SHELF_WORDS`) are labels and one toast, "Given: Held the Mask to Mira.", and passed as written.

**A finding in the screen shots** (`scripts/ui-shots.ts`, not a test). Two runs with the shelf failed the later step "the map's Fight tools and a monster's card with its extras": its tap on the Ice Warden's token met the GM's "ICE WARDEN WILL USE..." window. A run of the same script on the commit before passed. The evidence points at the fight's opening dice, not the shelf: the passing run's shot before the step says "Cave Rat A uses Shot", the failing runs' "Cave Rat B uses Shot", so the turn order differed, and the step taps a monster's token whatever the turn. The shelf step opens and cancels its window before the fight begins. Not changed; for the lead, since three runs cannot prove the cause.

### 17.4 The copy sweep of the sentences features 1, 2 and the crystal added in core

Read against humanizer and unslop: the chronicle (it has no fact lines yet; unit 7 writes them), `SOLO_WORDS`, `OUTCOME_WORDS`, `SOLO_REFUSAL_WORDS`, `REFUSED_WORDS` and the GM's `REFUSED_LINE`, `soloConfirmLines`, `runCostLines`, `personalNews`, `closesIn`, `runLine`, `WAIT_WORDS` (solo-wait.ts), the odds' words (`VOICE`, `oddsLine`, `oddsDetail`, `fateLine`, `ODDS_WORDS`), the Resurrection Crystal's (`WAYS_BACK`, `USE_WORDS`, its item text) and `soloLines` (rules-text.ts). Changed only where a tell showed, each with the test that read it:

| Where | Old | New | Tell |
|---|---|---|---|
| odds.ts `VOICE.party.hint` | Plays this fight to its end on the rules, every row on a sensible plan, and reads the party's chance. | Plays this fight to the end 100 times by the rules and shows how often the party wins. | a list of three that hid the number of plays; "reads" for "shows" |
| odds.ts `VOICE.alone.hint` | Plays this gate to its end on the rules, your hunter on a sensible plan, and reads your chance. | Plays this gate to the end 100 times by the rules and shows how often you clear it. | the same (`tests/e2e/solo.e2e.ts`) |
| solo.ts `SOLO_REFUSAL_WORDS.changed` | Your hunter changed while the run played. Nothing was paid. Enter again. | Your hunter changed while the run played, so the run paid nothing. Enter again. | a passive with no actor |
| solo.ts `REFUSED_LINE` (the GM's log) | It was cleared first, so nothing was paid. / It was closed first, so nothing was paid. / It was gone, so nothing was paid. | Someone cleared it first, so the run paid nothing. / The gate closed first, so the run paid nothing. / The gate was gone, so the run paid nothing. | passives |
| solo-wait.ts `WAIT_WORDS.lost`, `.gone` | The room did not take this run. Its cost stays and nothing was paid. / The room is gone. Its cost stays and nothing was paid. | The room did not take this run, so it paid nothing. Its cost stays. / The room is gone, so the run paid nothing. Its cost stays. | a passive; the cause now leads to the result (`tests/solo-wait.test.ts`) |
| use.ts `USE_WORDS['not-dead']` | Resurrection Crystal brings back only a dead hunter. It was not used. | Resurrection Crystal only brings back a dead hunter. You still have it. | a passive that left the player to work out the crystal is still in the bag (`tests/use.test.ts`, `tests/e2e/crystal.e2e.ts`) |

Read and left: `soloConfirmLines`' "The odds are 100 plays. Your run is one more, and it can go better or worse." (a plain statement of what the odds are, which the player needs before a run that can kill), `soloLines`, `runCostLines`, `OUTCOME_WORDS`, `ODDS_WORDS`, `WAYS_BACK`, the crystal's description.

### 17.5 Unit 2: the fight's row tally and its facts (built)

What was built, against 2.2 and unit 2's cut:

- `src/core/combat/row-tally.ts`: `RowTally`, `NO_TALLY`, `tallyOf`, `turnKillsMax`, `TallyEvent` and `tallied`, the one writer. Four events, each from the place that knows it: `used` (a use's outcomes, in `act` and `release`: hits, crits and the crit run, damage dealt to foes, struck and avoided on the targets, heals on allies and the allies they raised, statuses put on foes, a consumable), `changed` (every change, in `consequences`: HP lost to anything, falls, the lowest HP share while up, exactly 1 HP), `turn` (a turn begun, where `startTurn` tells it; a held turn is not one) and `raised` (a `kill` at any depth, in `fire`, which took the place of `withKill`: the kill with the killer's HP share and turn, and the killer on the foe's `downedBy`). `Body.kills` is gone; the formula's `kills` reads `tallyOf(user).kills.length` (one count of kills).
- Two choices that are not in 2.2: a hunter row keeps the whole tally and any other row only its kills, and the stored tally is sparse (a field that never moved is absent). A fight of sixty monsters would otherwise carry sixty tallies in the save that every tap writes, and only hunters have chronicles; the formula's `kills` is the one thing any row needs. The tally's turn is counted where a turn begins (the turn's start event), not where the reducer picks the next row: the settle that follows writes the row it was given, which dropped a count set earlier (found by the first case of `tests/row-tally.test.ts`).
- Cut from 1.3's `fight` fact, because no reducer event says them yet and no unit 3 built-in needs them: `dealtPct`, `takenPct` (a share of whose HP), `harm`, `manaPct`, `manaUses`, `onlyWeapon`, `saved` (a reaction that stopped a killing hit), `firstUseKill`, `gearless`, `heavy`, `foeLow`, `early`, `gateRank`, `broken`, `alliesDead`. Each is a field and an event line by the new recipe ("A number a fight's fact needs") when a feat asks for it. Added: `hits`, `exactOne` (both were tally fields with no fact field), `sideUp` and `gate` as the gate's name ('' for none). A kill fact names the monster's `type`, which a monster row's `Origin` now carries (`monsterRows`, read by `fight-parse.ts`).
- `src/core/combat/fight-facts.ts`: `rowFacts` (the fight fact and its kills from the ended fight's rows and summary, the hunter's rank and the gate's name), `killsSeen` and `killFacts`. `fought` (`fight-save.ts`) records them on each hunter of this phone in the write whose effects say the fight ended, so the store's `noticed` takes them in that write (the end frees the hunters). A player's hunter's facts wait for unit 4's `noted`.
- The odds engine: `RowEnd.kills` (`killsSeen` at a play's end); `soloRan` records a run's kills as kill facts (`where: 'solo'`) after its `solo` fact.
- The tally keys: `fights`, `won`, `kills`, `bosses`, `crits`, `struck`, `avoided`, `healed`.

Tests: `tests/row-tally.test.ts` (8: hits and damage, struck and the lowest share, a kill with its turn and a fall with its killer, turns and the most kills in one turn, a stored tally read back and a junk field left out, a change that moves nothing, a won fight's facts read back by `parseFact`, payback and a pack's names), `tests/fight-save.test.ts` ("a fight's end is remembered"), `tests/solo.test.ts` (a run's kill facts), `tests/fight-model.test.ts` (`tallyWrong`: no count goes down, the lowest share never rises, a row other than a hunter keeps only kills, a kill names a foe), `tests/triggers.test.ts` (Rend's kill read from the tally), `tests/chronicle.test.ts` (the worst pushed chronicle now built from fight facts: 731 characters a fact, 8 of them and the tally under a quarter of `SHEET_MAX`, as 1.6 estimated). `tests/fight-sim.test.ts` and the odds' tests pass unchanged, so the tally moves no fight number.

### 17.6 Unit 3: feats, their machine and the built-ins (built)

What was built, against section 5 and the lead's Nov 18 rulings:

- `src/core/hunter/counts.ts`: `FactCount` (one kind, up to 4 tests, a measure, a window), `Counted`, `countStep` with the window table of 5.6 in its header, `markOf`, `passes`, `parseCount`, `parseCounted`. Two names differ from 5.2: `Count` and `Measure` were taken by other modules (`upgrade.ts`, `scalers.ts`; the lint "a type name is exported by one module"), so they are `FactCount` and `CountMeasure`. A test's field is a string the parser checks against `FACT_FIELDS[on]` rather than a union typed per kind: the parser refuses a field the kind lacks, an op the field cannot take and a value its spec cannot read, which is the guard 5.2's union gave, at the one place outside data enters.
- `src/core/hunter/feats.ts`: `FeatDef` (no `quest`: the Stories ruling keeps quests the GM's to issue, so section 6's issued quest is gone from feats), `StateTest`, `Show`, the machine (`FEAT_STATES`, `FeatEvent`, `TABLE`, `featStep`, `startOf`) as 5.5 drew it, `stateHolds`, `featsFor` (the switch, the library over the built-ins, a turned-off one left out, the GM's own after by key), `progressLine`, `featWindow`, `featNews`, `parseFeat`, `parseFeats`. `FeatState` lives in `chronicle.ts` beside `Chronicle.feats`, so the chronicle's reader does not import feats.ts (a cycle: feats.ts reads the tally's keys).
- `src/core/registry/feats.ts`: 28 built-ins, each an idea of the ideas file whose rule today's facts can say (F01, F03, F04, F07, F13, F17, F19 to F23, F26 to F28, F30, F31, F33 to F35, F37, F38, F40, F42, F43, F49, F50, F79, and the brief's "three awards in a session"). Where an idea's reward was a hidden quest (F07, F31, F49), it gives an ability point or its title alone. Left out: those whose reward is a skill or item not seeded (F06, F09), those whose facts unit 2 cut (F02, F05, F10, F11, F12, F14 to F16, F24, F29 and the rest marked N2 on fields not built), and those that need the party's or the room's facts (N6). The names and window titles are the ideas file's; the lines that describe follow "Plain first" (17.7).
- `noticed.ts`: each fact taken in turn, then counted by the feats of its kind (`byKind`), each earned feat marked, the feats shown after it unlocked, its `feat` fact recorded at the end of the inbox (so the loop takes it, and a feat counting feats sees it), and its reward given by `grant` in the same step. `NoticeCtx` gains `R` and `feats`; the store builds the book (`featsFor(rules(), BUILT_IN_FEATS, library)`, a player in a room the built-ins alone until unit 4's doc). `earnedIn` answers what a write earned, for unit 7's news.
- The switch (ruling: one GM switch, carried in the room's `rules` doc as the solo switch is): `RULES.feats.on`, `RoomRules.feats` (a doc without it reads as on), `roomRulesOf` and `withRoomRules`. Its control on the GM screen is unit 7's; the rules editor sets it until then.
- `library.feats` (`save.ts`, a repair line, `LIMITS.libraryFeats` 100); a pack merge keeps it as it is until unit 5 makes feats travel.
- `src/views/feats.js` (in `MODULES`): each earned feat not told opens its window (tag `! Feat`, its title, its line, its reward's lines), marked told when answered; a reload shows it again until then.
- The chart: `scripts/charts/feat.ts` with `tests/models/feat-events.ts`, in `MACHINES`. The count's window is a table in the code's header and the test, not a chart: it holds no state but a number and a mark.

The measurement section 9 asked for, written before it ran: the worst write is one hunter's fight end of 81 facts (a fight, 60 kills, 20 consumables) against the built-ins and a full library of 100 feats that all count kills; the result that would change the design is a median over 4 ms on this box, which would move checking from every feat to the feats of the fact's kind. A bun script (scratchpad `bench-feats.ts`, 100 runs after 10 to warm): checked one feat by one, a median of 4.82 ms (3.23 to 10.01), over the bound, so the step now meets each fact with the feats of its kind only, and copies a hunter's feat states once a fact rather than once a feat: 3.37 ms (2.12 to 8.88). Both runs were made while the lead's CI ran on the box; on the idle box after it (load 0.6), two runs of the indexed step gave medians of 3.15 ms (2.25 to 5.22) and 3.03 ms (1.75 to 12.34), under the bound. With no feats the same write takes 0.15 ms. A real table's worst is far below this case: the built-ins hold 9 feats on kills, and a library of 100 all on kills is the bound, not a table.

Tests: `tests/feats.test.ts` (16: the count's table cell by cell and its parser's refusals; every cell of the feat's table; each built-in read back whole and in the System's words; the switch, an edit, a turned-off one and the GM's own; Thread's End with its title and its kept facts in one write, Clean Sheet's row broken and earned, Marathoner between rests, the session of three 1s, Field Naturalist's distinct types, a state test that waits, a feat earned once over a later write, a chain of four feats that ends, Iron Routine shown after Early Riser, a held hunter's facts waiting, the news), `tests/build.test.ts` (the switch in a room), `tests/protocol.test.ts` (the rules doc with and without it), `tests/e2e/feats.e2e.ts` ("a player who finishes the daily seven days running sees SEVEN DAYS once, again after a reload until answered, and the title it gives").

### 17.7 "Plain first" (the owner, Nov 19, then "feat names can be clever, the descriptions can not")

The rule as it now stands at the top of copy-tasks.md: a feat's, a title's and a System window's title may be a name, as the ideas file has them; every line that describes is plain and literal. The built-in feats keep the ideas file's names, window titles and title names. Every line that describes was rewritten plain. The condition lines went from an order to a statement of what happened, so the same line reads as the condition while a feat is shown and as the earned window's body (the reward's lines under it): "Win a fight with 5% of your max HP or less left, without going down in it." became "A fight won with 5% of max HP or less left, without going down in it."; "Defeat the monster that put you down, in the same fight." became "The monster that put you down, defeated by you in the same fight."; "Go down in five fights your side still wins." became "Five fights your side won in which you went down."; "Bring a downed ally back up ten times." became "Ten downed allies healed back up."; "Receive three awards for roleplay in one session." became "Three awards for roleplay given to you in one session."; the other 23 the same way ("Defeat ten bosses." became "Ten bosses defeated."). Titles' lines that were figurative or closed on a one-liner: "Walked out of a fight with almost nothing left." became "Won a fight with 5% of max HP or less left."; "Defeated fifty E-rank monsters. Someone has to." lost "Someone has to."; "Put a hundred afflictions on foes." became "Put a hundred statuses on foes."; "Thirty days without a missed daily quest." became "Finished the daily quest thirty days running."; "Landed a hundred crits." became "Landed a hundred critical hits.". A progress line's word for life facts, "Times", became "Life events".

On a second read after the edit, "Five fights your side won while you were down in them" said the hunter stayed down all fight, so it became "in which you went down". The rule wants a second reader who did not write these lines; I wrote them, so they still need that reader. I did not touch `src/core/registry/bundles.ts` after the coordinator's hold.

### 17.8 Unit 3's browser findings, and two slips of the box rule

- The feat window opened before the window of the thing that earned it: the first run of `tests/e2e/feats.e2e.ts` found "SEVEN DAYS" in front of "DAILY QUEST COMPLETE" (the trace's last frame), because feats.js told its windows from the store's change callback, inside the write, before the Quests view queued its own. feats.js now tells after that task (`queueMicrotask`), so the thing's own window is first and the feat's follows.
- Three room cases of `tests/e2e/solo.e2e.ts` failed after unit 3: the trace's last frame on the player's phone showed the feat windows of a won run ("NO PARTY WAS NEEDED", then "THE GATE BARELY OPENED") in front of "paid your solo run", which those cases wait for. A won run earning feats is the new behaviour, not a fault; the cases are about the run, so their setup turns feats off for the room (`rulesOverrides.feats = { on: false }` on the GM's phone, carried by the rules doc) and waits for the player's rules to say so, as a test whose subject is not the personal gate turns those off.
- `tests/server-rooms.test.ts` pads the rules doc to `DOC_MAX`; its rules doc now carries the feats switch, so the doc reads back whole.
- Two whole `bun run test` runs started while the lead's CI was running (`pgrep` printed a pid on the same line and my command did not stop on it). Both passed or failed on code alone (the failure was the dependency map, and the second the server test above), but they broke the rule; every later run checked first and waited.

### 17.9 Units 4 and 5: the room's part, and the maker, the Workshop and packs (built)

The room's part, against 2.3 and 3.2:

- `noted` (`NotedPayload`, `NOTED_MAX` 81, GM only, exactly one hunter, each fact read by `parseFact` and one that does not read left out). The GM's phone posts it in the write that ends a fight, one for each row of a player's hunter (`remoteFacts` in `fight-facts.ts`, its rank from the pushed sheet, E when the sheet is not there; `Beside.noted`, posted by `fought` with no key, so a later message never replaces it), and in a Clear's write for each player paid (`gateFact`, `pay.ts`, the one gate fact a local payee gets too). The player's phone records the facts in one write with the event's id (`APPLIERS.noted`); the store's notice step takes them there, or the release write once the room's fight doc lets the hunter go.
- The `feats` doc (`FeatsDoc`, `DOCS.feats` through `parseFeats` with `FEATS_DOC_MAX` 100): `featsDoc` adds the library's feats by key, each whole, while the doc stays within `DOC_MAX`, and answers the keys left out, which the Workshop marks "too large to send to players". Measured: 100 feats each with a reward of 20 items fill the doc with 8 and leave 92 out (56,579 characters); a feat with a title reward is about 700 characters, so about 80 plain feats fit. Changed from 3.2: the doc carries no `on` (the `rules` doc carries the switch, as ruled) and no statuses of its own (a reward's status travels with its def, as the reward reader keeps it). There is no `src/edge/feats.ts`: sync.ts's `bindNotice` hands the store the doc's feats as the room's `library`, and feats.js reads the same doc for a player's windows, so the doc is read where the room is.
- Not built: a room solo run's gate fact on the player's phone (the `soloAnswer` names its gate but not its rank, so a run the GM's phone paid counts as a `solo` fact on the player's phone and not as a `gate` one); a GM view of what the doc left out beyond the Workshop's mark.
- Tests: `tests/protocol.test.ts` (`noted`'s bounds; the doc names), `tests/server-rooms.test.ts` ("a player cannot send facts of its own hunter as the GM's noted"), `tests/applied.test.ts` ("a fight's facts the GM's phone noted land whole, once"), `tests/models/room-world.ts` (`gm noted`, posted with no key as `spent` and `shadow` are), `tests/feats.test.ts` (the doc's bound and its read-back), `tests/e2e/feats-room.e2e.ts` ("the GM's own feat reaches a player's phone, and the gate the GM clears for that player earns it there once").

The maker, the Workshop and packs, against 5.3:

- `src/views/feat-maker.js` (`featMaker`, through `app.api.maker.open`): Name, Window title, What the player reads; what happened (a kind of fact, in `FACT_KIND_WORDS`), up to four tests each a field of that kind, a comparison its spec allows (`opsFor`) and a value its spec reads (a choice for a rank, a pick or a flag); what to count (each time, the total, different values, the highest, and of which field); Earned at; Within; Shown to the player (from the start, after a count, hidden until earned); the reward editor below the first screen (`data-later`). The preview is `ruleLine` and the reward's lines. Save runs `parseFeat` and writes what it gives back (`saveFeat`) under the feat's key, a new feat's made from its name (`freeFeatKey`). Not in the maker: a feat shown after another feat, and the state tests ("also needs"); both read from the library and from packs and are kept on an edit.
- The Workshop's Feats: the library's feats (a changed built-in, a built-in turned off, one too large for the doc, each marked), and the built-ins not changed under "Built-in feats", each with Edit and Turn off. Reset brings a built-in back, Delete takes a GM's own out (a hunter who earned it keeps it), Duplicate and Share as for every kind. The GM view's Make row stays five buttons: a sixth would not fit a 390 px row at 44 px; New feat is in the Workshop.
- Packs: `feats` is a pack kind (`Pack.feats` by key, `PACK_CAP.feats` the library's cap); `packOf` takes the statuses a feat's reward names; `parsePack` reads each through `parseFeat` under a key `parseFeatKey` reads; `mergeFeats`: Replace overwrites under the same key, Add puts a feat whose key the library holds under a new key as "Name 2". A key travels, so a hunter keeps its progress on a feat two tables share.
- Tests: `tests/pack.test.ts` ("feats in a pack", and feats in the round trip and the unreadable counts), `tests/e2e/makers.e2e.ts` ("a GM makes a feat for 2 Beasts defeated in a session, from the Workshop", including a built-in turned off), `tests/e2e/look.e2e.ts` ("on a 360 px phone the feat maker scrolls only up and down").

Words added in these units: the Workshop's Feats line ("A feat is something a hunter does that the game counts and rewards by itself, such as 100 beasts defeated. Make your own, or change or turn off a built-in one."), the maker's labels, `ruleLine`, `WITHIN_WORDS`, `MEASURE_WORDS`, the confirms of Reset and Delete, and the mark "too large to send to players". Each describes, so each is plain; reread once as a second reader before the commit.

### 17.10 The lead's review (Nov 19): nine points on units 4 and 5

Goal (the owner): the System notices what a hunter does and rewards it without the GM's hand, and the GM makes his own
feats in a maker that is architecturally sound, clean and easy to use on a phone. The problem: units 4 and 5 shipped a
maker that loses a feat's show rule on an edit, a half-built off switch, a test row four controls tall, a refused Save
that says nothing on screen, and five smaller slips. The smallest change: fix each at its cause in the module that owns
it, with a test that fails without the fix. Nothing new beyond what a point names. The brief is
`brief-1-feats-review.md`. Principles read in full this session: fix-root-causes, model-the-domain,
test-behavior-not-implementation, laziness-protocol, experience-first.

**Point 1. A feat shown after another feat.** Data shape first: `Show` stays as it is, four arms
(`start`, `count` with `n`, `feat` with `key`, `never`). The form must answer exactly one of them. Variants:

| | (a) A fourth choice and a list of feats by name | (b) A text field for the key | (c) Keep three choices, carry `feat` unseen |
|---|---|---|---|
| What the GM does | Taps "After another feat", picks the feat by its name | Types a key such as `early-riser` | Nothing; the rule survives only while the GM leaves the choice alone |
| Who decides which feats may be chosen | Core, `afterChoices` in hunter/feats.ts (the built-ins as the library lays them, then the GM's own; not itself, not one turned off; a key the list lacks kept and named by its key) | Nobody: any key reads | Nobody |
| Cost | One select, one core function with its test | A GM never sees a key; a typo hides the feat for good | A hidden state the form does not show, which is what broke |

Chosen (a). The rule of which feats may be chosen is a rule of the game, so it is core's and has a bun test; the view
draws what it answers. The browser test edits and saves one feat of each arm and reads the library back unchanged.

**Point 2. Turning a feat off and on.** Data shape: `FeatDef.off?: true` stays where it is (any feat, not only a
built-in: see below). Two named steps in library.ts, `featOff(lib, key)` and `featOn(lib, key)`, and one rule they share
with `saveFeat`: the library holds a built-in's key only while its entry differs from the shipped feat. Variants for what
Turn on leaves when the entry then equals the shipped built-in:

| | (a) The entry leaves the library | (b) The entry stays, without `off` | (c) A separate list of keys turned off (`library.featsOff`) |
|---|---|---|---|
| Round trip off then on | Exact for an unchanged built-in, a changed one and a GM's own | An unchanged built-in comes back as an entry equal to the shipped one | Exact |
| What the Workshop says after | Listed under Built-in feats again, as before Turn off | "changed built-in" for a feat nobody changed | As before |
| Cost | The shipped-feat comparison in one place (`saveFeat`), so an Edit and Save that changes nothing also leaves no entry | None, and a mark that lies | A new save field, its repair, the room doc and the pack, for what one optional flag already says |

Chosen (a). The same comparison makes an Edit with no change leave the library as it was, so the "changed built-in" mark
is true wherever it shows. The comparison is through `parseFeat` (its answer is one key order), so it is
`sameFeat` in hunter/feats.ts, beside the parser.

A GM's own feat can be turned off too. `featsFor` already leaves out any feat that is `off`, the parser already reads it
on any feat, and a GM who wants to pause a feat of his own for a few sessions should not have to delete it and remake it.
So the type's comment changes from "a built-in" to "a feat", and nothing refuses it. The maker keeps `off` as it found
it. Duplicate moves into library.ts as `duplicateFeat(lib, key)`: a copy named by `copyName` within `FEAT_BOUNDS.name`
(point 9's literal 60 goes with it), under `freeFeatKey`, never `off`.

**Point 3. A test row.** No data changes. Variants:

| | (a) Two rows in a grid: the field and Remove (an icon button), then the comparison and the value | (b) A sentence per test with an Edit button that opens its controls | (c) All four controls on one row |
|---|---|---|---|
| Height at 390 px | Two 44 px rows and their gaps, about 110 px | 44 px closed, more taps to change one | 44 px |
| Readable at 360 px | Yes: the field's label has the row's width, the comparison and the value share the second | Yes | No: about 70 px a control cuts every field's label |

Chosen (a). The group gets the label "Only when" and the button reads "Add a condition", so a row reads as a sentence:
Monster type, is, Beast.

**Point 4. A refused Save.** The shell's `[data-err]` is the last child of `.mk-scroll`, under the whole form and the
reward editor, so a GM who taps Save near the top of a long form does not see it. Every maker has this (the status
maker's "Give the status a name." focuses the name field at the top and writes the message at the bottom). Variants:

| | (a) The message sits in the window's fixed part, just above Cancel and Save | (b) The message stays at the end and is scrolled into view | (c) Each maker marks the wrong field |
|---|---|---|---|
| Seen after the tap | Always, at every scroll position, in every maker | Yes, but the form jumps away from the field to fix | Only where the maker knows which field |
| Cost | Move one element in `openMaker` and collapse it while empty | A scroll on every error | A change in each of the seven makers, and the cap message still needs a place |

Chosen (a): fixed where it starts, in `openMaker`, so all seven makers are fixed by one change.

**Point 5.** The words name the form's labels: "Give the feat a name." and "Give each condition under Only when a value."
(the only test value the parser refuses from this form is an empty one: a number out of its range is cut to it).

**What was built, point by point.**

1. `afterChoices` (hunter/feats.ts) and the fourth chip with its select `#fm-after`. Tests: `tests/feats.test.ts` ("the
   feats a feat may be shown after"), `tests/e2e/makers.e2e.ts` ("a GM who opens a feat and saves it unchanged keeps when
   it is shown": Uphill, Four Figures, Iron Routine, Thread's End, a GM's own feat shown after a deleted key, a new feat
   shown after Early Riser).
2. `featOff`, `featOn`, `duplicateFeat` in library.ts; `saveFeat` drops a built-in's entry equal to the shipped one
   (`sameFeat`, hunter/feats.ts). The Workshop offers Turn off or Turn on on every library feat and Turn off on a shipped
   built-in; a GM's own feat off is tagged "off". Tests: `tests/library.test.ts` ("a feat turned off and on"),
   `tests/e2e/makers.e2e.ts` (the Ratcatcher step: off, Edit keeps off, Duplicate is on, Turn on, Reset, off and on
   again back under Built-in feats).
3. `.fm-tests`, `.fm-test` (a grid of two 44 px rows) and `.fm-row` in feat-maker.js's own CSS, the group labelled
   "Only when", the button "Add a condition", Remove an `.icon-btn`. Test: `tests/e2e/look.e2e.ts` ("a feat's four
   conditions sit under Only when", at 360 and 390 px).
4. `openMaker` (maker.js) puts `[data-err]` between `.mk-scroll` and `.mk-actions`, collapsed while empty. maker.js is
   not in the brief's file list, but the point names the shell as the cause, and it is not one of the files the brief
   forbids. Test: `tests/e2e/makers.e2e.ts` ("a GM whose Save is refused reads why on screen").
5. `needs()` in feat-maker.js, used by the preview and Save.
6. The three comments moved. No test: a comment has no behavior. The same slip is in about fifteen more places in
   `src/core` (below).
7. `rankSeen` (fight-facts.ts); `gateFact` takes `Rank | null`; gates.js passes what it has. Test: `tests/pay.test.ts`.
8. `freeFeatKey` answers through `parseFeatKey` and cuts the slug to leave room for its number. Test:
   `tests/feats.test.ts` (2,000 seeded names of mixed characters and lengths with taken keys, and a long name with
   100,000 numbered keys taken, which failed before).
9. In and Out's title line; `duplicateFeat` cuts at `FEAT_BOUNDS.name`; the ui-shots step "feats and the feat maker".

**Decision trail.**

- Turn on of a built-in that is then as shipped: the entry leaves (exact round trip, a true "changed" mark).
- A GM's own feat may be turned off (one meaning of `off` for every feat; `featsFor` already honoured it).
- `sameFeat` compares through the parser rather than a deep equal: the parser's answer has one key order, and both
  sides are parsed feats, so the comparison needs no second rule of equality.
- `featOff` and `featOn` refuse a no-op as `unchanged` rather than answering the library as it was, so a double tap
  writes nothing and the refusal is named.
- The ui-shots step is the last of the GM's makers, so the shots before it keep their numbers.

**Found outside the points (not fixed).**

- `src/core`: about fifteen more doc comments sit over the wrong declaration, the slip of point 6 (for example
  `record.ts` `setJob`, `inventory.ts` `withShop`, `fight-turn.ts` `partyView`, `fight-view.ts` `timeOf` and
  `ABILITY_LINES`, `effect-ops.ts` `TYPE_MAX`, `ids.ts` `parseHunterRef`, `gate.ts` `MAX_FOUGHT`, `save.ts` `Dropped`).
  A lint "a top-level doc comment is followed by its declaration, never by another doc comment" in `tests/lint.test.ts`
  would keep it out. The lead's sweep owns it.
- The feat maker offers "The total of" and "The highest" for a kind of fact with no number field (`closed`, `quest`,
  `rank`, `title`, `feat`, `given`, `coin`, `rest`, `used`, `shadow`); the field select is then empty and the parser
  refuses the feat with a message about conditions. The maker's unit owns it (offer only the measures the kind's fields
  allow, from core).
- `pack.ts` `mergeFeats`: a pack carries `off` as it is, and Replace of a built-in with the shipped feat leaves an entry
  the Workshop marks "changed built-in"; going through `saveFeat` would apply the same rule. Unit 5's pack owner.
- `ideas-feats-titles-rewards.md` T43 still says "Cleared a gate alone in three rounds." (an ideas file, left as written).
- AGENTS.md's feat row names "a built-in's Turn off and Reset" and `saveFeat`, `removeFeat`; it should name `featOff`,
  `featOn`, `duplicateFeat`, `afterChoices` and `rankSeen`. AGENTS.md is the lead's.
