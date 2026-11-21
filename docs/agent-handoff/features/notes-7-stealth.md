# Stealth, sight and the GM's eyes: the design (feature 7)

the owner's three rulings of Nov 19 (plan.md lines 80, 82, 83): Stealth and Invisible in a fight; the GM sees as an enemy; sight against stealth. This file is the design only. Nothing here is built.

Principles applied. `principle-redesign-from-first-principles` made sight a rule every reader asks, in place of a fourth `holds(b, 'hidden')` beside the three that exist. It also deleted the stealth table's `revealed` state, which nothing stores. `principle-model-the-domain` made the three ends a record keyed by a union (each end present once), and the GM's choice a union (`everything` or one row). It also made a body's stealth a value derived from its statuses by one function, so the state is never kept in two places.

## 1. What exists today, and what each ruling needs

Today `hidden` is a plain op with no fields (`effect-ops.ts` `Op`, read by `parseOp` in `fight-parse.ts` as `{ op }`). Every reader asks `holds(b, 'hidden')` (`standing.ts`).

| Today | Where | What the ruling needs |
|---|---|---|
| A hidden body cannot be picked and no shape catches it | `concealed` (`standing.ts`), used by `ready` rule 2 (`noTarget`) and `catchable` (`resolve.ts`) | An ability aimed at a place catches it. Only a picked target is refused. `concealed` mixes the untargetable ward with stealth, so it splits |
| Hiding ends when the bearer acts on a foe or a place | `landed` (`fight.ts`) calls `uncovered` (`fight-turn.ts`) | It ends when the bearer deals damage. A curse that only slows ends nothing |
| Hiding ends when a foe stands within 1 tile, or on HP lost | `revealed` (`fight-turn.ts`) | These stay as two of the three ends: `revealed` and `hurt` |
| The three ends are fixed | `STEALTH_TABLE` (`standing.ts`) | Each end is a part of the status a class or skill can change |
| An attack from hiding has the attacker's edge | `edgeOn` (`standing.ts`, line 185) | A damage multiplier, a rule number |
| A hide is refused while a foe that is up sees the tile | `seenByFoes` (`fight.ts`), its own sight sum beside `seenBy` (`space.ts`) | Stays for Stealth. Invisible works in the open ("how invisible works in League"), so whether a hide needs cover belongs to the status |
| No body has a sight level, no hidden status has a level | `Sheet` (`derive.ts`), the op | A level on the hidden op, a sight level on the body, one rule comparing them |
| The party's doc leaves out every hidden foe | `inView` (`fight-doc.ts`) | A hidden foe is in the doc while some hunter of the party perceives it |
| The GM's map draws every row, dimming a foe the party cannot see | `fightBodies`, `mapScene` (`map-view.ts`: `MapBody.stealth`, `MapToken.hidden` from the party's lit tiles) | A choice of eyes: everything, or one foe row. A hidden hunter no foe sees is dimmed under everything |
| The odds engine's policy skips concealed foes | `foesOf` (`policy.ts`) | It asks the same rule |
| Invisible and Stealth have no ops; the Stealth skill puts on Stealth, which does nothing | `statuses.ts` lines 41 and 44; `abilities.ts` `Stealth`; pinned by "Invisible and Stealth do nothing the fight counts" (`tests/statuses.test.ts`) | Both get a hidden op. The pin is replaced by a test of the rule |

The stealth machine is implicit today. No body stores its state. `act` calls `stealthStep('seen', …)` with a literal state, and `revealed` calls `stealthStep('hidden', …)` the same way. The `revealed` state and the `settles` event exist only in the chart. The table is consulted, never run on a stored value.

## 2. The data shapes

### The levels

```ts
// standing.ts
export const LEVELS = [0, 1, 2, 3, 4, 5] as const;   // one per rank, E to S
export type Level = (typeof LEVELS)[number];
```

Six levels, one per rank, so a level can follow its source's rank as every other tiered number does (`Tiered<Level>`, read with `atTier`). A level past 5 cannot be written. The parser clamps a number into `Level` at the boundary.

### The hidden op

```ts
export const STEALTH_ENDS = ['hurt', 'revealed', 'dealt'] as const;
export type StealthEnd = (typeof STEALTH_ENDS)[number];
export type HideStart = 'unseen' | 'anywhere';

| { readonly op: 'hidden';
    readonly level: Tiered<Level>;
    readonly start: HideStart;
    readonly ends: { readonly [E in StealthEnd]: boolean } }
| { readonly op: 'stayHidden'; readonly on: StealthEnd }
```

- `level` is the stealth's level. A viewer perceives the bearer only with a higher sight (section 3).
- `start: 'unseen'` lands only on a body no foe that is up has in sight: the kits' rule, a wall or the dark hides you. `start: 'anywhere'` lands in the open (Invisible).
- `ends` says which of the owner's three events end this status: `hurt` (the bearer loses HP), `revealed` (a foe that is up comes within `kit.hideReveal` tiles, or a `reveal` op lands on it), `dealt` (a use or reaction of the bearer deals HP damage to a body of the other side). Its time and a cure end any status as they do today. With all three false, only its time and a cure end it.
- `stayHidden { on }` is a worn op for a class or a skill upgrade. While the bearer holds it, none of its hidden statuses ends on that event. This is how "affected by class/skills upgrade" stays content.

`parseOp` reads a missing or wrong field as its default: `level` 0, `start` `'unseen'`, every end `true`. That default is the kits' Stealth as built. An `ends` key other than the three is dropped.

### A body's stealth

```ts
/** The level a body hides at: the highest of its hidden statuses at their tiers, or null when it holds none. */
export const stealthOf = (b: Pick<Body, 'statuses'>): Level | null;
```

This is derived from the statuses and never stored. The statuses are the machine's storage, so a cure, a dispel or an expiry needs no stealth code.

### A body's sight level, a derived number

- `Sheet.sight: Level`, labelled "Sight level" in `SHEET_LABELS`. `derive` sets it to `RULES.fight.stealth.sightBase` (0) for a hunter, a monster and a shadow.
- `sight` joins `SHEET_OP_KEYS`. A `sheet { key: 'sight', amount }` op raises it after `derive` in `withSheetOps`, summed as ops of one key add, clamped into `Level`.
- A hunter gains it from a passive's or an item's `worn` status (`wornStatuses`, `rows.ts`). A monster gains it from one of its starting statuses. A status from an ability (a flare, a potion) gives it for a while.
- Reason for a base of 0: a body with no sight content perceives no stealth, so any hide works on it until a class or an item gives sight. The owner's "the appropriate level of sight" reads as sight being earned. It is not a stat curve: a curve on Insight would let any hunter who spends points see every hide.

### The ambush multiplier

`RULES.fight.stealth.ambush: 1.5`, with this reason in its comment. It enters rule 11c as the user's `dealt` increase against each target that does not perceive the user, when the user holds a hidden status at rule 11. Of the user's dealt increases only the strongest applies, and the product stays within `kit.shareCap`. So the worst heavy strike stays under design 6's 60% of a tank: table 8.10.2b's 38% with the edge, times 1.5, is 57%. A hide is one action that deals nothing. The ambush pays half of it back in damage, and the turns the bearer cannot be picked pay the rest. A larger number would make hide and strike beat two strikes outright. A class's power over stealth is in its level, its start and its ends, not in a larger multiplier.

### Whose sight a question asks

```ts
// sight.ts (new, core)
export type Eyes = { readonly place: Place; readonly side: Side; readonly up: boolean; readonly sight: Level };
export type Figure = { readonly place: Place; readonly side: Side; readonly stealth: Level | null };
export type SightRange = { readonly kind: 'whole' } | { readonly kind: 'tiles'; readonly n: number };
export const eyesOf = (b: Body): Eyes;      // its place, side, isUp, its sheet's sight after its sheet ops
export const figureOf = (b: Body): Figure;  // its place, side, stealthOf
export const rangeOf = (f: Pick<Fight, 'fog'>): SightRange; // the fog's sight, or the whole map with no fog
```

The viewer a map scene is drawn for:

```ts
// map-view.ts
export type ViewAs = { readonly kind: 'everything' } | { readonly kind: 'row'; readonly id: CombatantId };
```

`ViewAs` exists only on the GM's phone. A player's phone has the doc, which is already the party's eyes.

## 3. One sight rule

```ts
/** Whether `e` perceives `f`: its own side always; else `e` is up, `f` is in its sight, and its sight beats `f`'s stealth. */
export function perceives(e: Eyes, f: Figure, grid: Grid, range: SightRange): boolean {
  if (e.side === f.side) return true;
  if (!e.up) return false;
  if (range.kind === 'tiles' && !inSight(e.place, f.place, grid, range.n)) return false;
  return f.stealth === null || e.sight > f.stealth;
}
```

`inSight(a, b, grid, n)` in `space.ts` is `dist(a, b) <= n && sees(a, b, grid)`. `seenBy` calls it for each tile, so the fog's lit tiles and a single body's sight are one geometry. `seenByFoes` in `fight.ts` is deleted.

What each caller passes:

| Caller | Eyes | Figure | Range |
|---|---|---|---|
| Rule 2, a picked target (`ready`, `resolve.ts`): refused `noTarget` when false | the user | the target | `whole`: the use's own reach and line already decide whether it can be reached (Q7) |
| A shape's catch (`catchable`, `resolve.ts`) | not asked: a hidden body is caught. Only the untargetable ward stays out (`warded` replaces `concealed`) | | |
| Rule 11c, the ambush | each target | the user | `whole` |
| The policy's foes (`foesOf`, `policy.ts`) | the row choosing | each foe | `whole`, as rule 2 |
| A hide's start, `unseen` (the act's `seen` refusal, and `landStatus` for a hide put on another body) | each foe that is up | the body, with `stealth: null` | `tiles(fog?.sight ?? fight.sight)`: a wall answers whether a foe looks at the tile, even with no fog kept |
| The party's doc (`inView`, `fight-doc.ts`) | each party row | each foe | `rangeOf(f)` |
| The GM's map under `everything` (`fightBodies`) | each row of the other side | each body | `rangeOf(f)`. A body none of them perceives is drawn dimmed (`MapBody.unseen`) |
| The GM's map under `row` (`fightBodies`) | that row | each body | `rangeOf(f)`. A body it does not perceive is left out |

The doc's rule is `b.side === 'party' || f.rows.some(r => r.side === 'party' && perceives(eyesOf(r), figureOf(b), f.grid, rangeOf(f)))`. A hunter with line of sight and low sight, beside a hunter with high sight and no line of sight, does not bring the foe in. One body's eyes must do both. That is the per-viewer meaning of the owner's rule.

`partyView` stays as the fog's lit tiles for the ground and `Fight.fog.seen`. It answers which tiles, never which bodies.

## 4. The stealth machine after the change

It replaces `STEALTH_TABLE`, `Stealth` and `StealthEvent` in `standing.ts` (table 8.9.4), and its walk in `tests/models/wave2-events.ts` and chart in `scripts/charts/wave2.ts`. The body's state is `stealthOf(b)`: `seen` (null) or `hidden` at a level. An event acts on each hidden status by its own `ends`:

```ts
export type StealthEvent =
  | { readonly type: 'hide'; readonly start: HideStart; readonly watched: boolean }
  | { readonly type: 'hurt' } | { readonly type: 'dealt' } | { readonly type: 'revealed' };
/** Whether `e` ends a hidden status of `ends` on a bearer whose `stayHidden` ops keep `kept`. */
export function endsOn(ends: Ends, kept: ReadonlySet<StealthEnd>, e: Exclude<StealthEvent, { type: 'hide' }>): boolean;
/** One writer: `b` without each hidden status `e` ends. */
export function stealthStep(b: Body, e: StealthEvent, now: Tick, R: Rules): Body;
```

| State | hide | hurt | dealt | revealed | time, cure |
|---|---|---|---|---|---|
| seen | hidden at its level, when `start` is `anywhere` or no foe watches; else stays seen, and a self-hide is refused `seen` | nothing | nothing | nothing | nothing |
| hidden at L | hidden at the higher of L and the new level (one instance per key, as `applyStatus` keeps) | each status with `ends.hurt` and no `stayHidden` on `hurt` goes | the same on `dealt` | the same on `revealed` | that status goes, as any status does |

After an event the body is hidden at the highest level left, or seen when none is left. There is no `revealed` state and no `settles` event: a body seen again may hide again at once, which is today's rule.

Where each event is raised:

- `hide`: `act` (`fight.ts`) before a use whose `applyStatus` puts a hidden status on its user, and `landStatus` (`land.ts`) for any other landing. The `watched` value comes from section 3's hide row.
- `hurt`: `consequences` (`fight-turn.ts`, today's `revealed`), for a row whose HP fell in the change.
- `revealed`: the same place, for a row with a foe that is up within `kit.hideReveal`. Also `landOps` when a `reveal` op lands (a new land op with no fields, the flare's).
- `dealt`: `landed` (`fight.ts`) after the use resolves, when an outcome dealt HP damage to the other side. Also `fireReaction` (`fight-react.ts`) for a reaction's damage. `landed` stops calling `uncovered` for hidden. The untargetable ward keeps its own end on acting.

## 5. A stealth class or skill is content

A class or skill sets only these: the hidden op's `level`, `start` and `ends`; a `stayHidden { on }` worn op; a `sheet { key: 'sight' }` op; a `reveal` land op; the status's duration and the ability's cooldown. No code changes. The status maker, the skill maker and packs carry them.

**Example 1, a shadow kit.** "Vanish", an active skill: a `support` ability aimed at self, cooldown 5, `applyStatus` of "Vanished" for 2 rounds with `{ op: 'hidden', level: [1, 1, 2, 2, 3, 3], start: 'anywhere', ends: { hurt: true, revealed: true, dealt: true } }`. It hides in the open. Its level follows the hunter's rank. Its partner "Unseen Blade" is a passive whose `worn` status holds `{ op: 'stayHidden', on: 'dealt' }`: hitting from Vanish no longer ends it, so each hit while hidden gets the ambush until a hit lands on the bearer. The worth line prices that as the ambush on every use for the status's rounds.

**Example 2, a seer.** "Hunter's Eye", a passive whose `worn` status holds `{ op: 'sheet', key: 'sight', amount: 2 }`. Its hunter perceives stealth of level 0 and 1 in its sight. Its party's doc then holds such a foe, and the hunter can pick it. A "Flare" active (a `blast` at a place with a `reveal` land op) ends the hide of every body it catches whose status ends on `revealed`, sight or none.

The built-ins become content too. Stealth is `{ op: 'hidden', level: [0, 1, 2, 3, 4, 5], start: 'unseen', ends: all true }`. Invisible is `{ op: 'hidden', level: [1, 1, 2, 3, 4, 5], start: 'anywhere', ends: all true }`.

## 6. The GM's eyes and the player's doc

The map's own terms:

```ts
// api.ts, MapSource
/** Whose eyes the map shows: everything, or one foe row (kits design 8.7, feature 7). Null on a player's phone. */
eyes: { choices(): { id: CombatantId; name: string }[]; now(): ViewAs; set(v: ViewAs): void } | null;
// map-view.ts, MapInput
/** The row whose eyes the scene shows, named on the map so the GM knows it is not everything; null for everything and on a player's phone. */
readonly eyes?: { readonly id: CombatantId; readonly name: string } | null;
// map-view.ts, MapBody: `stealth: boolean` becomes
/** No body of the other side perceives it (sight.ts `perceives`): drawn dimmed on the GM's map. Always false on a player's. */
readonly unseen: boolean;
```

- `fightBodies(f, R, mine, as: ViewAs)` leaves out what a `row` view does not perceive and sets `unseen` under `everything`. `fightGround(f, R, as)` gives the fog: under `everything` the party's lit tiles, as today; under `row` that row's own `seenBy` tiles (none with no fog). `mapScene` reads `unseen` for `MapToken.hidden` and stops reading `sight.lit` for tokens. It holds no sight rule of its own.
- The choices are the foe rows, summons of the foe side included, in the order of the fight. combat.js draws them as a `.seg` "See as" row in the Fight tools sheet. It keeps the choice in `store.device('map-eyes', 'tab')` with the fight's id. A row gone from the fight, or another fight, reads as everything. A down row sees nothing but its own side, and the map says so by its name.
- A player's doc holds a foe only while a party row perceives it (section 3). It never holds a stealth level, a sight level or an unseen foe's log line. A hidden hunter is in the doc with its status chip, since the party perceives its own.

## 7. Units, in order

Each unit ends with `bun run test` green and its named tests. Each one's guide rows and charts move with it (`bun run charts`, `bun run deps -- --write`).

1. **One sight rule.** `Level`, `Eyes`, `Figure`, `SightRange`, `perceives`, `eyesOf`, `figureOf`, `rangeOf` in `sight.ts`. `inSight` in `space.ts`, which `seenBy` calls. `Sheet.sight` and the `sight` sheet op key. `RULES.fight.stealth.sightBase`. Tests: `tests/sight.test.ts` ("a body perceives its own side, a foe in sight with no stealth, and a hidden foe only with a higher sight"; equal level not perceived; a down viewer perceives no foe; a wall blocks a `tiles` range and not `whole`). `tests/derive.test.ts` row for sight 0. `tests/effect-ops.test.ts`: two sight ops add and stop at 5. Seen: the sheet lists Sight level 0. Nothing in a fight changes.
2. **The hidden op's fields.** `level`, `start`, `ends` and the `stayHidden` op: `Op`, `OP_KIND_SET`, `parseOp` with the defaults, `opLine` words, the status maker's row (a level by rank, Starts: Out of sight / Anywhere, Ends when: hurt / revealed / it deals damage). Tests: `tests/effect-ops.test.ts` reads each field back and a missing one as its default. The maker round trip in `tests/e2e/makers.e2e.ts`. Seen: the GM's status maker offers the three ends. The fight still plays as today.
3. **The stealth machine.** Section 4's table and `stealthStep`. `landed` raises `dealt` in place of ending hidden on acting. `consequences` raises `hurt` and `revealed`. The `reveal` land op. `seenByFoes` deleted. Walk events and chart. Tests in "wards and stealth" (`tests/fight.test.ts`): a hidden body that slows a foe stays hidden; one that deals damage is seen; a status with `ends.hurt` false survives a hit; `stayHidden` on `dealt` keeps it through a hit it deals; an Invisible-style `anywhere` hide in the open lands; a Flare's reveal ends it. Seen: a hidden hunter's debuff no longer gives it away.
4. **Picking and catching.** Rule 2 asks `perceives`. `catchable` keeps out only the untargetable ward. `concealed` splits into `warded` (the ward) and the sight rule. `policy.ts` and `usable` ask the same. Tests (`tests/resolve.test.ts`, `tests/fight.test.ts`): a blast at a place hits a hidden body; picking it is refused `noTarget`; picking it is allowed with a higher sight, refused with an equal one; the odds engine still plays every fight to its end (`tests/odds.test.ts`). Seen: the GM's blast catches a hidden hunter; a monster cannot pick it.
5. **The ambush.** `RULES.fight.stealth.ambush` in rule 11c. The edge from hiding removed (`edgeOn`, Q3). Tests (`tests/resolve.test.ts`): a hidden user's hit deals 1.5 times the same hit unhidden at the same dice; no ambush against a target that perceives the user; with a dealt share of +50% the hit is still 1.5 times, not 2.25; the needsRoll case of the old edge is gone. `worth.ts` names stealth unweighed, as today. Seen: the log's damage from hiding is larger.
6. **The party's doc.** `inView` through `perceives`. Tests (`tests/fight-doc.test.ts`, "a hidden foe"): absent with no sight; present while a hunter with sight 2 has it in sight; absent when that hunter has no line to it while another hunter with sight 0 has one; its log lines follow. Seen: a player whose hunter has Hunter's Eye sees the hidden foe on the map and can tap it.
7. **The GM's eyes.** `ViewAs`, `MapSource.eyes`, `MapInput.eyes`, `MapBody.unseen`, `fightBodies` and `fightGround` given the choice, the See as row in combat.js. Tests: `tests/map-view.test.ts` ("seen through one foe's eyes": a hidden hunter it cannot see is no token, its fog is its own; under everything that hunter is dimmed). `tests/e2e/battle-map.e2e.ts`: the GM taps See as Goblin and the hidden hunter's token goes, then Everything brings it back dimmed. Seen: the GM's map as each enemy sees it.
8. **The built-ins.** Stealth and Invisible get their ops (section 5). The pin in `tests/statuses.test.ts` becomes "Stealth hides out of sight and Invisible in the open, each ended by a hurt, a reveal or damage dealt". Kit examples to copy: Vanish, Unseen Blade, Hunter's Eye, Flare (`kit-examples.ts`, read back by `tests/kit-examples.test.ts`). The Rules page's line for stealth. Seen: the Stealth skill hides its hunter, and the Workshop offers the examples.

## 8. Open questions for the owner, each with the default the build uses

1. Does a viewer whose sight equals the stealth level see it? Default no: "under that level" reads as strictly under.
2. Does an area ability reveal a hidden body it hits? Default: the hit itself does not. Its damage ends the hide through `hurt` when the status ends on hurt, which the built-ins do. A Flare's `reveal` op reveals outright.
3. Does the attack from hiding keep the kits' advantage beside the multiplier? Default no: the multiplier replaces it, so hiding gives one bonus.
4. Does a foe standing next to a hidden body reveal it? Default yes, as the `revealed` end (the kits' 1 tile). A status without that end, a League-style invisibility, ignores it.
5. Does the multiplier apply against a target that sees the attacker? Default no: that target saw it coming.
6. Is "deals damage" any HP damage of the bearer's own use or reaction? Default yes. Damage a round from a status or field it left does not end it, or a poison would end every hide.
7. In a fog fight, may a body pick a target outside its own sight? Default yes, as today: the use's range and line decide. Answering no would thread the fog into `resolve.ts`.
8. Do sight sources add (two +1 make 2)? Default yes, as sheet ops add, at most 5.
9. Should the GM's eyes follow the acting enemy by themselves? Default no: the GM picks, and the choice stays until changed.

## The owner's rulings on the open questions (Nov 19, typed in the lead's session). These win over every section above

His answers, in the order of the questions: "Uh yes. Yes. Multiplier replaces advantage. No. No. Yes. Yes. No, highest one. No."

1. A viewer whose sight level equals the stealth level sees it. A body is hidden only from sight of a lower level. (The default above said no: changed.)
2. An area ability reveals a hidden body it hits. (The default said no: changed.)
3. The ambush multiplier replaces the advantage hiding gave. Not both.
4. An enemy standing next to a hidden body does not reveal it. (The default said yes: changed.)
5. The ambush multiplier does not apply against a target that sees the attacker.
6. "Deals damage" is the hidden body's own uses and reactions, not a zone or a status it left earlier.
7. In fog a body may pick a target it cannot itself see when an ally sees it.
8. Sources of sight do not add. The highest one is the body's sight level. (The default said they add: changed.)
9. The GM's "See as" stays where the GM set it. It does not follow the acting enemy.

A builder reads this section first and builds units 1 to 8 by it.

## What was built differently (Nov 21, units 1 to 4)

- A hide's default level is 1 and 0 is not a hide's level (the lead's ruling from ruling 1 and `sightBase` 0; for-the-owner 23).
- `kit.hideReveal` is removed: by ruling 4 nearness reveals nothing, so every `kit.hideReveal` above is history.
- `revealed` is raised by a `reveal` op and by a foe's radius hit (ruling 2). Unit 5 closed the line's gap with one rule: a use reveals each hidden body of the other side it caught and did not pick (aimed at by id). One narrower case differs from the ruling's letter and is asked of the owner (for-the-owner 25): a blast aimed by id at a hidden body its user sees does not reveal that body.
- Open, scored 2 or under: a hide put on by a trigger, a threshold, an end or a reaction skips the watched check (land.ts `landOne` passes `false`); a strike aimed at a tile catches a hidden body standing there; `fog` is an optional last argument of `ready`, `usable`, `resolve`, `landUse`; in fog a side that sees no foe walks toward the nearest foe's real place.
