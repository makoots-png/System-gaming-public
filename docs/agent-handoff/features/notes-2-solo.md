UNIT 2-solo DONE at c7a6716 (code, tests, charts; the close's notes in the commit after it).

Goal: a player "speedruns" a gate alone, the odds engine's one play is what happened, and the cost and the reward land in one write. Problem: nothing in the game happens without a GM. Smallest change: one pure step beside `gates/pay.ts` that writes what one seeded play of the odds engine left on the hunter (through `sheetEdit` and the life machine) and pays the gate as a Clear pays (`settleClear`, `grant`); personal gates on the hunter with a clock; one room message and one answer for a world gate marked solo.

# Notes: feature 2, solo runs

Status: step 1 approved by the lead (f04f145, rulings in section 15); steps 2 to 5 done, each in its section of 16.

## 0. What I read, and what the code says today

- The engine (`play.ts`, `policy.ts`, `odds.ts`, `draws.ts`): `playBegin`, `playStep`, `playOver`, `playDead`; the run's machine `OddsRun` (idle, running, done, stale); `RunOutcome = 'won' | 'lost' | 'stalled'`; `RowEnd` keeps only hp, mana, fatigue, down, dead.
- The gate (`gate.ts`): `transition` and its `TABLE`, `can`, `gateXp`, `xpDue`, `fightAward`; a gate's break is in world days (`breakDay`), moved only by the GM's day.
- What a Clear pays (`pay.ts`): `clearShares`, `settleClear` (`clearGate`, then `payAll`: `grant` per local payee, the posts into the outbox), `splitAward`. The loot is rolled by the view before the write (`gates.js` `clearGate`: `api.inventory.rollLoot(g.rank, { boss: true })`, cryptoRandom).
- The spawn (`spawn.ts`): `rollGate(R, ask, bestiary, rand)` (rank and type by `gateSpawn` weights, pack by `packRange`, a boss when the pool has one), `rollLoot`, `pickWeighted`.
- The hunter's life (`vitals.ts`): `lifeAfter` and its `TABLE`; `sheetEdit` (`grant.ts`) is the one writer of a hunter's HP, mana, fatigue, life and statuses outside a fight (`totals`, `life`, `put`, `drop`).
- The fight's write-back (`fight-turn.ts` `writeBack`): a hunter row's totals are `sheetStatuses(a.statuses.filter(onSheet), now, R)` and `restUsed(a)`; `fight-save.ts` `wroteBack` writes them with `sheetEdit(totals)`; a shadow's with `setShadowHp`; an item used in a fight leaves its bag through `spendItem` (`itemSpent`, which reads `itemOfAbility`).
- Who a fight holds: `fightHold(fight, who, room)`.
- The day: `day.ts` (`dueAt`, `compareTimes`, `RECHECK_MS`), `nextWake` in `quests.ts` is the one timer's answer, armed by `quests.js` `arm`.
- The room: `DEFS` in `protocol.ts` (`gmOnly`, `ownSheet`, a reader each), the `world` doc (`WorldGate = ShownGate`, 40 gates, names of 60), the `build` doc (`{ enabled, playerPick }`, laid over a player's rules by `withRoomBuild` through `bindRoom` in `src/edge/rules.ts`), `APPLIERS` in `room-events.ts`.
- The penalty (`penalty.ts`): see section 9.

## 1. The engine first: the three findings of lead-look-6-odds.md

### 1.1 "Dead" in a fight the party wins

Cause: `playDead` rolls the death saves of every hunter that went down and is still at 0 HP, to their end, after the fight, whatever the outcome and whoever stands beside it. A table never does that when the party won: an ally stabilizes or heals in one tap.

Variants:

1. Rolled only where nobody can help: a hunter's saves run to their end unless the party won and another hunter row of the party is up at the end; then the hunter is left down (dying, saves not rolled). A shadow or a summon is not an ally that can help: it holds no hands for a stabilize.
2. Dead counted only when the side lost or stalled (the lead's first variant as written): the same as 1 for a party, but alone with shadows that won, the hunter would never die, which a solo run must allow.
3. Keep the roll and change the words ("dies if nobody reaches them"): the number stays wrong for a table, only better labeled.

Picked 1 (the lead's lean, stated precisely). It is also the solo rule: a solo run has one hunter, so its saves always run to their end when it is down at the end.

Change: `playDead` becomes `playSaves(p): Readonly<Record<CombatantId, readonly number[]>>`, the faces each downed hunter rolled, in order (an empty list for one left down). The life each ends in is `lifeAfter` folded over those faces (the life machine), so `RowEnd` gets `saves` and `life` and `dead` becomes `life === 'dead'`. Test (`tests/odds.test.ts`): "a won fight leaves a downed hunter down and not dead while another hunter stands" (fails today: the starter party against three goblins reads dead in about 20%); "alone, a downed hunter's death saves run to their end".

### 1.2 Fatigue reads without its scale

The detail says "30 to 48 fatigue" beside "of 45 HP". `OddsRow` already holds `fatigueMax`. The sheet reads fatigue as "30 / 60" (`hunter.js` `bar('ft', ...)`), so the detail reads "30 to 48 of 60 fatigue". Test: the detail line in `tests/odds.test.ts` ("the detail gives fatigue of its capacity").

### 1.3 Mana never moved for the starter party

Read, not run: the starters hold no ability that costs mana. Only the blast kind costs mana (`RULES.fight.abilityKinds.blast.mana`, 10); strike, shot, curse and support cost 0. Brakk holds Strike (no weapon worn) and Shield Wall (support); Mira the Hunting Bow and Marked Shot (shots); Eldrin Arc Bolt (a curse) and a Mana Potion, which `sensible` never drinks (it drinks only what heals, shields or puts on a status the user lacks), and which would only refill mana nobody spends. So "10 of 10" is right and not a gap in the policy. Test that `sensible` does spend mana when it holds a mana ability: "a hunter holding a blast ends a fight it used it in with less mana".

### 1.4 What else the engine lacks for a solo run

- The run's end must carry what the sheet is written from, not only numbers to read. One function says what a row leaves on its sheet: `sheetTotals(row, now, R)` taken out of `writeBack` (`fight-turn.ts`), used by `writeBack` and by the engine's `endOf`. `RowEnd` becomes `SheetTotals & { down; saves; life }` (section 2).
- Items used up: `Play` gains `spent: readonly { by: CombatantId; item: ItemId }[]`, appended in `playStep` when the choice is an `act` of an ability that `itemOfAbility` names. The engine must not import `fight-save.ts` (the test "the engine, its loop and its policy import nothing that writes"), so it reads `itemOfAbility` (registry/abilities.ts) itself; `itemSpent` keeps the holder's half.
- A count while one play runs: `progressOf` answers `{ done, of, commands, round }` (`commands` is `play.steps`, `round` is the fight's `now` over a round). A single run cannot know its length, so the bar is `motion.progress(el, null, words)`, the "waiting, no number" form, with the words "Round 3, 37 moves played": a real count, no made-up fraction. 100 plays for the odds keep the bar and its percentage.
- How a single run is asked: `oddsStep(IDLE, { type: 'ask', fight, seed, of: 1 })`, then `step` events from the view's frame budget (`ODDS_FRAME_MS`) until `done`; the run is `odds.ends[0]`. No second loop beside the engine: the solo run is the odds machine with a count of one.
- The fight to play: `soloFight(hunter, shadows, monsters, R)` in `gates/solo.ts` builds the `Setup` by the reducer's own `add` (no grid of a map: the open arena, `openArena(R)`), with `hunterRow`, a `shadowRow` for each summoned shadow and `monsterRows`. It answers the fight and the map back to the sheet (`{ hunter: CombatantId; shadows: Record<CombatantId, ShadowId> }`).

## 2. The run: its outcome, its data, its refusals (types before code)

The three outcomes are the engine's own union, `RunOutcome` (`odds.ts`), read for one hunter. A second union with the same three members would be a second name for one thing (the lint "a type name is exported by one module" points the same way), so solo reads it through a table of words:

```ts
// odds.ts (exists): 'won' the gate is cleared and pays; 'lost' the foes won, the hunter is down or dead and the gate stays;
// 'stalled' the time cap (CAP_ROUNDS, 40 rounds) with both sides up: a retreat, the cost paid, the gate stays.
type RunOutcome = 'won' | 'lost' | 'stalled';

// fight-turn.ts (taken out of writeBack): what a row leaves on its sheet, the fight's own write-back's numbers
type SheetTotals = { readonly hp: number; readonly mana: number; readonly fatigue: number;
  readonly statuses: readonly SheetStatus[]; readonly used: Readonly<Record<AbilityId, number>> };

// odds.ts: a party row at a play's end. `saves`: the death save faces it rolled, in order (empty when up, or left down
// beside a standing ally of a won fight); `life`: lifeAfter folded over them from a fresh fall (up when it never fell).
type RowEnd = SheetTotals & { readonly down: boolean; readonly saves: readonly number[]; readonly life: LifeState };
type RunEnd = { readonly outcome: RunOutcome; readonly rounds: number; readonly commands: number;
  readonly party: Readonly<Record<CombatantId, RowEnd>>; readonly spent: readonly { readonly by: CombatantId; readonly item: ItemId }[] };

// gates/solo.ts
/** Where a solo gate is: one of the hunter's own, or a gate of the world list (this phone's, or the room's by its doc). */
type SoloGate = { readonly kind: 'personal'; readonly id: PersonalGateId } | { readonly kind: 'world'; readonly id: GateId };
/** One run as played: its end, the rows that map back to the sheet, and the key of the hunter it was played from. */
type SoloRun = { readonly end: RunEnd; readonly rows: { readonly hunter: CombatantId; readonly shadows: Readonly<Record<CombatantId, ShadowId>> };
  readonly from: string /* soloKey(h) */ };
/** The loot the view rolled before the write (rollLoot, cryptoRandom), paid only when the run cleared. */
type SoloLoot = { readonly gold: number; readonly items: readonly ItemTemplate[] };
/** What a run's write did, for its window. */
type Ran = { readonly save: Save; readonly outcome: RunOutcome; readonly before: Vitals; readonly after: Vitals;
  readonly granted: Granted | null; readonly waiting: EventId | null /* a player's world run waiting for the GM */ };
```

`soloKey(h)` is the hunter's parts a row is built from (life, mana, fatigue, conditions, used, items, equipped, skills, stats, level, shadows), as one string. The write refuses a run whose hunter changed between the tap and the write (a room message landed, another tab wrote): totals of a play are totals from where it started.

### Refusals, a union with words in core

```ts
type SoloRefusal =
  | 'no-hunter'   // the hunter is gone
  | 'fight'       // fightHold answers a row or the GM's fight
  | 'down'        // life dying or stable
  | 'dead'
  | 'collapsed'   // fatigue collapse, ended only by a long rest
  | 'gone'        // no such gate
  | 'closed'      // the gate cannot be cleared: cleared, closed, or a personal gate past its time
  | 'not-solo'    // a world gate the GM has not opened to solo runs
  | 'off'         // personal gates are off (the GM's switch in a room, or this phone's own rule alone)
  | 'not-played'  // a player in a room enters the room's gates only with the hunter it plays there (sync `bound()`)
  | 'waiting'     // this hunter has a run on this gate waiting for the GM's answer
  | 'empty'       // no monster of the roster could be read
  | 'changed';    // the hunter changed while the run played (soloKey)

const SOLO_REFUSAL_WORDS: { readonly [R in SoloRefusal]: string } = {
  'no-hunter': 'This hunter is no longer on this phone.',
  fight: 'A fight holds this hunter. Finish it first.',
  down: 'This hunter is down. Heal or rest first.',
  dead: 'This hunter is dead. The GM\'s Revive or a resurrection brings it back.',
  collapsed: 'This hunter has collapsed from fatigue. Take a long rest first.',
  gone: 'This gate is gone.',
  closed: 'This gate has closed.',
  'not-solo': 'The GM has not opened this gate to solo runs.',
  off: 'Personal gates are off.',
  'not-played': 'Only the hunter you play in this room can enter its gates.',
  waiting: 'Your run here is waiting for the GM\'s answer.',
  empty: 'This gate has no monsters.',
  changed: 'Your hunter changed while the run played. Nothing was paid. Enter again.',
};
```

`soloReady(save, hid, gate, ctx)` answers the hunter and the gate or a refusal. It runs twice: before the odds and the play (so no play is wasted), and inside the write (the state may have moved during the frames the play took).

### What is written, in order, through which writer

One step, `soloRan(save, hid, gate, run, loot, ctx): Ran | Refused<SoloRefusal>`, in `src/core/gates/solo.ts`, given to `store.apply('solo-run', ...)` once:

1. `soloReady` again, and `soloKey(h) === run.from`, else refused whole.
2. The hunter's totals: `sheetEdit(h, { type: 'totals', ...end.party[hunter] })` (HP through the life machine's `setHp`, so 0 HP is a fresh fall, mana, fatigue with its collapse, the statuses that stay on a sheet, the uses spent this rest).
3. Each death save face: `sheetEdit(h, { type: 'life', event: { type: 'deathSave', roll } })`, so dying, stable, up at 1 on a 20, or dead is the life machine's answer, not the run's claim.
4. Each item used: `spendItem(h, item, R)` (`use.ts`), one per use.
5. Each shadow's HP: `setShadowHp(h, sid, hp)` (`shadows.ts`).
6. The gate and the reward, by where the gate is:
   - personal, `won`: the gate leaves the hunter's list (`personalCleared`), then `grant(save, hid, rewards, null, { ...day, vitals: 'sheet' })` with `rewards.xp = gateXp(gate, xpOf)` (the roster's XP, the one rule for what a roster pays) and the loot; `told` a `gate` line.
   - personal, `lost` or `stalled`: the gate stays; `told` a `gate` line.
   - world, this phone settles (`soloRoute(seat)` is `here`: alone, or the GM's own hunter): `won` is `settleClear(save, gateId, pay, [{ hid, rewards }], { room: null, events: [] }, day)` with `pay.due = xpDue(gate, xpOf)`, `splitAward(due, 1, false)` (the one split), the loot; `lost` or `stalled` is `enterGate` when the gate is detected (`transition` `enter`), and its line.
   - world, a player in a room (`soloRoute(seat)` is `room`): the `soloRun` message posted to the outbox (`atOutbox`, `post`), and for `won` a waiting run added (section 5). Nothing of the gate is written: the gate is the GM's.
7. The run's own log line with `told` before the gate's: "Solo run: Mira Vale cleared "Goblin Warren" alone in 4 rounds, at 12 of 45 HP." (`settleClear`'s "GATE CLEARED" line follows for a world gate).

XP last (grant's own order), so a level-up's refill (`levelUpRestore`) fills what the run spent, as any level-up does; the dead stay dead (`refill` heals through the life machine). No new rule of what a gate pays: `gateXp`, `xpDue`, `splitAward`, `rollLoot`, `settleClear`, `grant`, `transition`, `told` are reused; `rollLoot(R, rank, boss, pool, rand)` is called by the view before the write as `clearGate` does (a personal gate has no boss: `boss: false`; a world gate as its Clear: `boss: true`).

The test holds the one write as `tests/fight-save.test.ts` does: each outcome's write applied to a save, and a save that refuses any part (the hunter gone, the gate gone, the key changed) is the save as it was, whole.

## 3. Where a personal gate lives

Variants:

1. **A field of the hunter**, `Hunter.solo: { clock: SoloClock; gates: PersonalGate[] }`. One writer: the steps of `gates/solo.ts` through `atHunter`. It travels with the hunter: the sheet push carries it (so the GM's board sees what a player's hunter holds and how it came out), a hunter file carries it, a deleted hunter takes its gates with it. The world list stays the GM's alone.
2. **The world list with an owner**, `Gate.owner: HunterId | null`. It reuses `transition`, `clearGate` and `settleClear` as they are. But the world list is the GM's: `worldDoc` would publish a GM's NPC's personal gates, `mergeWorld` would merge them across GM phones, the GM's Edit and Delete would reach them, and on a player's phone in a room the Gates view draws the world doc, not `save.gates`. The two clocks also differ: a world gate breaks on a world day the GM moves, a personal gate closes on the wall clock. Every reader of the list would filter by owner.
3. **A separate list**, `Save.personal: PersonalGate[]` keyed by hunter id. One writer, but it does not travel with the sheet or a hunter file, needs a repair line that follows the hunters, and outlives a deleted hunter unless every delete cleans it.

Picked 1. What the GM's board reads: the pushed sheet as today, so a hunter who died alone shows as any dead hunter, with no new path.

```ts
// ids.ts: a new kind of thing, its own id (prefix 'pg' in SaveIds), never a GateId
type PersonalGateId = Id<'PersonalGate'>;
// gates/solo.ts
/** A gate the System opened for one hunter: its roster of built-in monsters (seed ids), when it opened and when it closes. */
type PersonalGate = { readonly id: PersonalGateId; readonly name: string; readonly rank: Rank;
  readonly monsters: readonly GateMonster[] /* seed monster ids and counts */; readonly at: string; readonly closesAt: string };
/** The System's clock for one hunter: off (no spawns), or on with the time of the next spawn. */
type SoloClock = { readonly at: 'off' } | { readonly at: 'on'; readonly next: string };
type Solo = { readonly clock: SoloClock; readonly gates: readonly PersonalGate[] };
```

A personal gate is either open (in the list) or gone (cleared, or past `closesAt`). A lost or stalled run leaves it open: the hunter may try again until it closes. It has no type (normal, red, double): a type changes nothing a run plays, so a personal gate holds none. Its monsters are built-in seeds by id (`seedMonsters(R)` on any phone), so it needs no GM.

### The clock (a machine, drawn before its table)

The step is `soloTick(h, now, ctx, seed)`: pure, its dice from `seededSource(seed)` with a seed the edge drew, its ids from the save's `seq` (`idsFrom`). `ctx` holds the rules and whether the clock may run for this hunter: `R.solo.personal` (with the room's switch laid over it, section 6) and `soloTracked(h, gm)` (not the `seed` hunter; on a GM's phone only a hunter that has completed a daily, as quests.ts `tracked` already rules for the penalty).

```
off --tick [may run]--> on(next = now), one gate spawned now (under the cap)
off --tick [may not run]--> off                       (nothing written)
on  --tick [may not run]--> off                       (held gates stay until they close)
on  --tick [may run, next <= now]--> on(next + k * hours), the spawns due in between
on  --tick [may run, next > now]--> on                (only gates past their time close)
```

Every tick, in either state, first takes out the gates whose `closesAt` has come. The spawns due: for each spawn time `t = next, next + H, ...` up to `now` in order, the gates closed by `t` leave, and a gate opens at `t` when the hunter holds fewer than `held` and `t + stays > now` (a gate that would already have closed while the app was closed is never made). So a phone closed for three days opens to at most `held` gates, each with the time left it would have had. The walk starts at the first `t` whose window still reaches `now` (`k = max(0, ceil((now - stays - next) / H))`), so it is at most `stays / hours + 1` steps however long the phone slept. Times are `dueAt(hours, t)` (`day.ts`): hours of the wall clock, so a clock change neither adds nor removes an hour. A tick that changes nothing is refused (`unchanged`), so it writes nothing.

Where it runs: on the app's `ready` (beside the Quests view's first daily check, handoff section 8), and on the one timer: `nextWake` gains the term `soloWake(save)`, the earliest `clock.next` of a running clock and `closesAt` of a held gate, so `quests.js`'s `arm` wakes for it; its handler runs the rollover and then `app.api.gates.tick()` (two writes, each whole: a rollover and a spawn are independent facts).

The news: each gate the tick opened is told as gate news is told today ("A GATE HAS APPEARED", the gate's name, rank, and "Closes in 23 hours"), at most `held` windows, marked told in device memory when answered (`gateNews` and `toldGate` in world.ts, their input narrowed to the `id` and `status` they read, under the key `personal-told:<hid>`), so a reload between the spawn and the window still shows it.

A spawn's roll: `rollGate` with a wider `SpawnAsk` (`pack?: [number, number]`, `boss?: boolean`), given the seeds of the rank whose kind is `normal` as its bestiary, and its rank from `soloRank(hunterRank, R.solo.ranks, rand)` (spawn.ts). One roll of a gate, not a second one.

## 4. A world gate marked solo

### The gate's field

`GateFields.solo: boolean` (default false) in `newGate`, `fieldsOf`, `parseGate`; the GM's edit form's checkbox "Open to solo runs" (`GateEdit.solo`, `editGate`). The world doc's `WorldGate` gains `solo` (written only when true; the reader's default is false): 12 characters a gate, 480 for 40 gates.

### What a player's phone needs to play it

The world doc names a gate, not its monsters, and a GM's own monsters, their custom statuses and the GM's rule overrides live on the GM's phone. Variants:

1. **The rosters in the world doc**: the doc grows with every custom monster's abilities; one worst-case custom monster (11 abilities with nested status defs) can approach `DOC_MAX` alone, and every player reads it on every change of the world.
2. **A new `solo` doc** with what a run needs: for each solo gate, its roster as monster keys and counts; each monster once, as the fields a row reads (`RowMonster`: name, rank, archetype, kind, tweak, abilities, xp, statuses), read by `parseMonster`; and the GM's statuses those monsters name, read by `parseStatusDef` (found as `pack.ts` finds the statuses an entry names). Built by `soloDoc(save, R)`: gates in the world doc's order, each added whole while the doc's JSON stays under `DOC_MAX`. It answers the doc and the gates it left out; the world doc marks solo only the gates in it, and the GM's card of a gate left out reads "Too many monsters to send to players. Open fewer gates to solo runs." So a player never sees Enter alone on a gate whose monsters it lacks.
3. **The GM's phone plays the run**: one phone holds the monsters, statuses, rules and gate. But the run plays from the sheet the player last pushed (stale by however long), its totals then write over the player's sheet, and the player sees nothing until the GM's phone is online. The brief places the run on the player's phone.

Picked 2. Every monster goes by value, built-in seeds too (one path, no seed or custom branch). The run's rows use the player's rules with the doc's statuses over `conditions` for this fight only (nothing written to the save). Known gap kept: a GM's other rule overrides are not the player's (as for every fight number today; only the build switches travel); for-the-owner.md says so.

### The messages

```ts
/** A player's run of the room's solo gate `gate`, by the hunter of `by`. A report and a claim: the GM's phone acts on it once. */
type SoloRunPayload = Base & { by: SheetKey; gate: GateId; name: string; outcome: RunOutcome; rounds: number; life: LifeState };
// DEFS: { gmOnly: false, ownSheet: true }. Bounds: gate as parseGateId (1 to 80 characters), name text(60), outcome
// choiceOf(RUN_OUTCOMES), rounds int(0, CAP_ROUNDS), life choiceOf(LIFE_STATES). Applier on a player's phone: null.

/** The GM's phone's answer to the run `run`: paid with its rewards, or refused with why. */
type SoloAnswerPayload = Base & { to: [SheetKey]; run: EventId; gate: GateId; name: string }
  & ({ verdict: 'paid'; rewards: Rewards } | { verdict: 'refused'; why: 'taken' | 'closed' | 'gone' });
// DEFS: { gmOnly: true, ownSheet: false }. Bounds: to a list of exactly one key, run parseEventId, gate parseGateId, name
// text(60), verdict choiceOf, rewards by the award's own reader (`rewards`), why choiceOf. Applier: once, a `land`.
```

Only a `won` run waits for an answer; a `lost` or `stalled` run is a report (the GM's phone moves a detected gate to raiding and logs it).

The GM's applier, on the GM's phone, in gates.js on `sync:event`, written with `app.api.sync.once(eid, step)` (the recipe "A use the GM should hear of"), one write: `soloTaken(save, payload, loot, answerEvent, day)` in `gates/solo.ts`.

- `won` and the gate can be cleared (`can(g, 'clear')`): `settleClear` with one remote payee (`{ kind: 'remote', key: by, name }`), its XP `xpDue`, its loot rolled by the view before the write, its post the `soloAnswer` `paid` (the view makes the event from the body core answers, as `clearGate` makes its awards), and the line "Solo run: Mira Vale cleared ... alone". The solo mark is not asked again: a run made while the gate was open to solo runs is paid if the gate can still be cleared (unmarking stops new runs on the players' phones). for-the-owner.md says so.
- `won` and the gate is cleared already: `soloAnswer` `refused`, `taken`, and a line. The gate closed: `closed`. No gate: `gone`.
- `lost` or `stalled`: `enterGate` when detected, else only the line.

The answer on the player's phone (`APPLIERS.soloAnswer`, `once: true`): the waiting run of that `run` id is closed and, for `paid`, `grant` gives the rewards, in one write with the event id; the tell is the System window. With no waiting run of that id (a second GM phone's answer, a replay) the land is refused and nothing is given: the waiting run is the player's guard, by the run's id, beside the answer's own event id.

### Who holds the truth between the run and the answer

The gate's status is the GM's phone's alone (its one writer is `transition`, there); the world doc is a copy it publishes. The player's phone holds only its claim: a waiting run in its save, by the run's event id. It never writes the room's gate and never shows it cleared on its own word: the card shows the doc's status and, under it, the run's state ("Cleared. Waiting for the room." while the message is in the outbox, "Cleared. Waiting for the GM's phone." once the room took it). When the doc says cleared before the answer lands, the card says cleared and still "Your reward is waiting for the GM's phone."

Two players on one gate: the room orders events by seq and the GM's phone takes them in that order, so the first `won` clears the gate and is paid, the second finds it cleared and is answered `taken`; its player keeps the cost paid (a choice, in for-the-owner.md). The GM's phone offline: the run waits in the room (in Postgres until the room dies, 30 days from its last use; the memory store keeps the last 2000 events of a room) and is answered when the GM's phone next polls, once by its event id. A reload on either phone: the outbox and the waiting run are in the save; `once` and the applied ids are in the save. Two GM phones: each answers once; the player's waiting run takes the first and refuses the second (above).

## 5. The waiting run (a machine, drawn before its table)

Kept in the save, `settings.sync.runs: Waiting[]` (room plumbing, beside the outbox, the held events and the applied ids), at most `RUNS_MAX` (20; a player cannot have more won runs unanswered than gates it can see, 40, and 20 is far past any table). Repaired at load by its parser.

```ts
/** A player's won run of a room's solo gate, until the GM's phone answers it. */
type Waiting = { readonly run: EventId; readonly room: RoomCode; readonly hid: HunterId; readonly gate: GateId; readonly name: string; readonly at: string }
  & ({ readonly state: 'posted' } | { readonly state: 'taken' } | { readonly state: 'lost'; readonly why: 'refused' | 'dropped' | 'gone' });
type WaitEvent =
  | { readonly type: 'taken' }                      // the room took the run's message (sync.ts deliver, the outbox's `sent`)
  | { readonly type: 'answered' }                   // the GM's soloAnswer landed (either verdict): the run leaves the list
  | { readonly type: 'unsent'; readonly why: 'refused' | 'dropped' } // the room refused it (4xx), or the outbox let it go
  | { readonly type: 'roomGone' }                   // the room no longer exists (the link's `gone`)
  | { readonly type: 'dismiss' };                   // the player put a lost run away
```

States: posted (in the outbox), taken (the room has it, the GM's phone has not answered), lost (kept to show), and the end (answered or dismissed: out of the list).

```
[*]    --a won run, a player in a room--> posted
posted --taken-->     taken
posted --answered-->  [end]            (the room took it, the answer came before this phone heard the room's 2xx)
posted --unsent-->    lost(refused | dropped)
posted --roomGone-->  lost(gone)
posted --dismiss-->   (null)
taken  --taken-->     (null)
taken  --answered-->  [end]
taken  --unsent-->    (null)           (a letter the room took is never refused after)
taken  --roomGone-->  lost(gone)
taken  --dismiss-->   (null)
lost   --taken-->     (null)
lost   --answered-->  (null)           (no answer can come for a letter the room never took, nor from a room gone)
lost   --unsent-->    (null)
lost   --roomGone-->  (null)
lost   --dismiss-->   [end]
```

Every cell of `TABLE` (3 states by 5 events) is above; `null` leaves the run as it is. A reload is no event: the list is in the save and the outbox puts a letter that was on its way back in its queue. Leaving the room is no event either: the letter waits for the room as the outbox's letters do, and the run waits with it.

Who raises each: `taken` and `unsent` by `src/edge/sync.ts` in the same write as the outbox step that sent, refused or dropped the run's letter (it is the outbox's one writer, so the run hears in the write the box changes, never later); `roomGone` by sync.ts where the link's `gone` takes the room's GM key out of the ring; `answered` by the `soloAnswer` applier in its own write; `dismiss` by the Gates view through `store.apply`. Module: `src/core/gates/solo-wait.ts` (`Waiting`, `WaitEvent`, `TABLE`, `waitStep`, `parseWaiting`), with its walk events in `tests/models/solo-events.ts` and its chart in `scripts/charts/solo.ts` (step 5).

Words: posted "Cleared. Waiting for the room."; taken "Cleared. Waiting for the GM's phone to pay it."; lost refused or dropped "The room did not take this run. Its cost stays and nothing was paid."; lost gone "The room is gone. Its cost stays and nothing was paid." The answer's window: paid, title "GATE CLEARED", the reward window's lines (`grantLines`); refused, title "GATE TAKEN" with "Another hunter cleared "Goblin Warren" first. Your run's cost stays." (`taken`), or "The GM closed this gate first." (`closed`), "This gate is gone." (`gone`).

The idempotence, by test: the run's write happens once per tap (one `store.apply`); its message once in the room (the outbox's event id, the server's `addEvent`); its settle once on each GM phone (`sync.once` by the event id); its pay once on the player's phone (the answer's event id, and the waiting run by the run's id). The room model (`tests/models/room-world.ts`) gets the move "a player's solo run and the GM's answer" and the invariant "a run is paid at most once, and only a run whose gate the GM's phone cleared for it".

## 6. The GM's switch: which doc

The GM turns personal gates off for the room and sets the hours between spawns. Both are rules (`RULES.solo.personal`, `RULES.solo.hours`) a GM overrides in `rulesOverrides` as the build switches are; a player's phone in a room plays by the room's, never written to its save.

1. **The `build` doc, extended**: the smallest change, but the doc and `withRoomBuild` then carry more than the build and their names stop saying what they hold.
2. **A new doc for the switches**: a third doc a player's rules read, and a second overlay function beside `withRoomBuild`.
3. **The `build` doc becomes the room's `rules` doc**: `{ build: { enabled, playerPick }, solo: { personal, hours } }`, read by one overlay, `withRoomRules` (build.ts's `withRoomBuild` renamed and widened, still laid over in `src/edge/rules.ts` through `bindRoom`), published by the GM's phone from its own rules. Old rooms need not work, so the rename costs nothing at the table.

Picked 3: one doc and one function for "the GM's rules a player follows in a room". It touches `protocol.ts` (`Docs`, `DOCS`, `WIRES`), `build.ts`, `src/edge/rules.ts`, `sync.ts` (`bindRoom`), `custom.js` (its publish) and their tests. If the lead would rather not rename in this feature, 1 is the fallback with the same reader.

The switch's control: on the GM's Gates view, beside the day controls, "Personal gates" as a `.seg` (On, Off) and "Every [8] hours". Written by `soloRuleSet(save, patch)` into `rulesOverrides.solo` (as `buildRuleSet` does).

## 7. The rule numbers, `RULES.solo`

```ts
solo: {
  personal: true,                              // personal gates on (the GM's switch, section 6)
  hours: 8,                                    // between two spawns
  held: 3,                                     // personal gates a hunter holds at once
  stays: 24,                                   // hours a personal gate stays open, run or not, unless cleared
  ranks: { below: 25, same: 60, above: 15 },   // percent: a gate one rank below the hunter's, at it, one above
  pack: [1, 3],                                // normal monsters of the gate's rank, from the built-in seeds; no boss
}
```

- **hours 8.** Three spawns a day. A player who opens the app in the morning and in the evening finds a new gate each time; one who opens it once a day finds the day's three.
- **stays 24.** One day, the table's own rhythm (the daily quests reset once a day), so a gate seen at one daily check is still open at the next. Shorter punishes a once-a-day player; longer lets gates pile up unplayed.
- **held 3.** It is `stays / hours`: with the default numbers no more than three are ever open, so the cap takes nothing from a once-a-day player and a phone back after a week finds at most one day's worth. It binds only when the GM shortens the hours (at 4 hours six would be open).
- **ranks 25, 60, 15, a band of one rank.** The brief says `gateSpawn`'s weights bounded by a band. Worked out at today's weights (E 40, D 30, C 15, B 9, A 5, S 1) with a band of one: an E hunter meets a D gate in 43% of spawns (30 of 70), a C hunter a gate below its rank in 56% (30 of 54), an S hunter an A gate in 83% (5 of 6). Those weights describe how common a rank is in the world, not a hunter's next gate. So the pick is a weight of its own, centred on the hunter: 60% at its rank, the gate the balance bounds were tuned for; 15% one above, the dangerous gate the odds warn of, about one every two days at three a day (0.45 a day); 25% one below, an easy run. A rank past E or S gives its share to the hunter's own (an E hunter: E 85%, D 15%). **This departs from the brief's text; the lead decides.** If the brief stands, `rankBand: 1` over `gateSpawn.rank` is the rule and these numbers are its cost.
- **pack 1 to 2 normals, no boss** (1 to 3 before the measurement of section 16 moved it). Design section 6's bound "a party of three against a same-rank pack of three: 2 to 5 rounds, no hunter dying in more than 1 run in 10" makes one same-rank normal one hunter's share of a pack: 1 is the even fight, 2 and 3 the hard ones. A boss is the fight the bounds give the party's extras (taunt, shield, stagger), so a personal gate has none. `gateSpawn.regulars` already spawns E packs of 1 to 3.
- **What it pays.** An E normal is 25 XP (`rankTable.E.xp` 25 times `kinds.normal.xp` 1); a pack of 2 on average is 50 XP a gate, at most 150 a day. A level takes `100 × level` (`xpToNext`), so E (levels 1 to 9, 4,500 XP) takes 30 days of every gate cleared and nothing else; C (levels 20 to 34, 40,500 XP, normals of 250 XP) takes 27. Solo keeps pace with a rank and does not outrun the table. The loot is `rollLoot(R, rank, false, ...)`, a Clear's roll without a boss.
- **The odds' count** is the engine's `ODDS_RUNS` (100), not a new number.

Override bounds: `hours` 1 to 168, `held` 1 to 10, `stays` 1 to 168, each share 0 to 100 with a sum over 0, `pack` two whole numbers from 1 to `MAX_ROWS - 1` with the first at most the second. A reader per bounded rule in `READERS` (`overrides.ts`), so a GM's 0 hours (which would spawn without end) is refused at the boundary and the GM told its path; step 2 checks that `READERS`' patterns reach a plain number path, and if not, the number readers go there.

The measurement before these numbers are trusted (step 2, written before the run): each pregen at level 1 against 1, 2 and 3 goblins, and the same builds at C against 1, 2 and 3 C normals, 100 plays each on the engine. What would change a number: a pregen that clears one same-rank normal in under 60% moves `ranks` toward `below` (the typical gate must be winnable); three same-rank normals cleared in over 50% raises `pack` to 4 (the hard end must be hard). The table goes in these notes with its run count and spread (a share over 100 plays has a standard error of at most 5 points).

## 8. Where it is told in the rules

A line of `src/core/rules-text.ts` with its pin in `tests/rules-text.test.ts`, worked out from `RULES.solo` and `CAP_ROUNDS`: "A solo run plays one fight to its end on the rules. The odds set the cost: what the run leaves of HP, mana and fatigue stays. A hunter can die alone. A run with no winner by round 40 is a retreat." And one for the clock: "The System opens a personal gate every 8 hours, at most 3 at once. Each closes after 24 hours."

## 9. The penalty and the gates today

`penalty.ts` and its callers: a penalty takes `penaltyCheck` (2) off every check, draws the Penalized chip, and issues a Penalty Zone quest the GM plays ("The GM decides how it plays"). Nothing reads it for a gate: no gate step, no fight step and no row looks at `penalty`; a fight's rolls are not checks, so the odds and a run do not see it either. So a Penalized hunter may enter a solo gate, and the run plays as for any hunter. No bar is added (the rules do not say a penalty bars gates). for-the-owner.md: "A Penalized hunter can still run solo gates. Say 'a penalty bars solo gates' to change it."

## 10. Files and tests, by step

### Step 2: the engine and the core

- `src/core/combat/fight-turn.ts`: `sheetTotals` out of `writeBack`.
- `src/core/combat/play.ts`: `playSaves` in place of `playDead`; `Play.spent`.
- `src/core/combat/odds.ts`: `RowEnd` and `RunEnd` as in section 2, `endOf`, `oddsDetail`'s fatigue, `progressOf` with `commands` and `round`.
- `tests/models/fight-sim.ts`: reads `playSaves` (its death rows must print the same numbers for fights the party lost; a row that changes is named in these notes with its cause).
- `src/core/ids.ts`: `PersonalGateId`, prefix `pg`.
- `src/core/gates/spawn.ts`: `SpawnAsk.pack`, `SpawnAsk.boss`, `soloRank`.
- `src/core/gates/solo.ts` (new): `PersonalGate`, `SoloClock`, `Solo`, `SoloGate`, `SoloRun`, `SoloLoot`, `Ran`, `SoloRefusal`, `SOLO_REFUSAL_WORDS`, `SOLO_WORDS`, `soloRoute`, `soloTracked`, `soloKey`, `soloReady`, `soloFight`, `soloRan`, `soloTick`, `soloWake`, `parseSolo`.
- `src/core/rules.ts`, `src/core/overrides.ts`: `RULES.solo`, its readers.
- `src/core/save.ts`: `Hunter.solo` with its default (`{ clock: { at: 'off' }, gates: [] }`) and repair line; `src/core/hunter/imported.ts`: a hunter brought from a file starts with that default (its gates were another campaign's).
- `src/core/hunter/quests.ts`: `nextWake` with `soloWake`.
- `src/core/rules-text.ts`: the two lines.
- Tests:
  - `tests/odds.test.ts`: "a won fight leaves a downed hunter down and not dead while another hunter stands"; "alone, a downed hunter's death saves run to their end"; "the detail gives fatigue of its capacity"; "a hunter holding a blast ends a fight it used it in with less mana"; "a single play counts its moves and its round".
  - `tests/solo.test.ts` (new): "a cleared run writes what the play left and pays the gate's XP and loot once"; "a run that fell leaves the hunter down with the saves it rolled, dead after three failures"; "a retreat pays its cost and leaves the gate open"; "items a run used leave the bag, one per use"; "a run is one write: a hunter gone, a gate gone or a hunter changed leaves the save as it was"; "each refusal says why" (one row per member of `SoloRefusal`); "the same hunter, gate and seed play the same run"; "a world gate settled on this phone pays as its Clear pays"; "a spawn for the time the app was closed: at most the cap, none already closed"; "a tick twice at one moment writes once"; "the clock off spawns nothing and lets held gates close"; "a spawn 8 hours later across a clock change" (TZ Europe/Berlin and America/New_York, both changes, set in the test and back in `afterEach`); "the GM's phone never spawns for a hunter that never completed a daily"; "the rank of a spawn by the weights, and an E hunter's below share given to E".
  - `tests/save.test.ts`: a hunter's solo repaired (a bad clock, a gate past its bounds, too many gates).
  - `tests/overrides.test.ts`: each `RULES.solo` bound refused with its path.
  - `tests/rules-text.test.ts`: the two lines pinned.
  - `tests/quests.test.ts`: "nextWake wakes for the next spawn and for a gate's close".

### Step 3: the room

- `src/core/gates/gate.ts`, `world.ts`: `GateFields.solo`, `GateEdit.solo`; `worldDoc(save, day, soloIds)`.
- `src/core/gates/solo.ts`: `soloDoc`, `soloTaken` (the GM's settle and its answer body).
- `src/core/gates/solo-wait.ts` (new): the waiting run's machine.
- `src/core/protocol.ts`: `WorldGate.solo`; the `rules` doc (in place of `build`) and the `solo` doc with their readers and the size arithmetic in the `DOC_MAX` comment; `soloRun` and `soloAnswer` in `Payloads`, `DEFS`, `EVENTS`.
- `src/core/hunter/build.ts`, `src/edge/rules.ts`: `withRoomRules`.
- `src/core/save.ts`: `settings.sync.runs` and its repair.
- `src/edge/room-events.ts`: `soloRun: null`, `soloAnswer: { once: true, land }`.
- `src/edge/sync.ts`: `taken`, `unsent` and `roomGone` raised on the waiting runs in the outbox's and the link's writes; `bindRoom` reads the `rules` doc.
- Tests: `tests/protocol.test.ts` (the two payloads in `VALID`, a case per bound, the `rules` and `solo` docs, "the worst-case solo doc on the wire"); `tests/server-rooms.test.ts` ("a player cannot send a solo answer", "a solo run speaks only for its own hunter"); `tests/solo-wait.test.ts` (every cell of the table, and a random walk of runs, answers, refusals and a room gone that never pays a run twice); `tests/applied.test.ts` ("a solo answer lands whole: the run closed and the reward given in one write"); `tests/models/room-world.ts` and `tests/room-system-model.test.ts` (the move and the invariant of section 5); `tests/world.test.ts` ("the world doc marks solo only the gates the solo doc holds").

### Step 4: the screens

- `src/views/odds-box.js` (new, `app.api.odds`): the odds control moved out of `combat.js` (`paintOdds`, `oddsFrame`), so the GM's fight box and the player's gate draw one control; `combat.js` mounts it.
- `src/views/gates.js`: the solo section first on a player's phone (personal gates with their time left, then the room's solo gates), each with the odds control and Enter alone; the confirm ("Enter alone?" with the chance to clear, the likely cost and the chance to come out down or dead, and "The odds are 100 plays. Your run is one more, and it can go better or worse."); the run with `motion.progress` (no fraction, the round and the moves); the System window; the waiting run's line and Dismiss; the GM's checkbox in the edit form, the "Too many monsters" note, the switch; `tick` and the news; the `soloRun` handler on the GM's phone.
- `src/views/quests.js`: the wake's handler calls `app.api.gates.tick()`; the first check on `ready`.
- `src/core/api.ts`: `GatesApi.tick`, `OddsApi`.
- `scripts/ui-shots.ts`: a step for the solo gates.
- Tests: `tests/e2e/solo.e2e.ts`: "alone, a hunter clears a personal gate and its cost and reward show"; "alone, a world gate opened to solo runs is cleared and paid on this phone"; "in a room with the GM's phone online, a player's run is paid once"; "with the GM's phone offline, the run waits and is paid once when it comes back"; "two players on one gate: the first is paid, the second told it was taken and keeps its cost"; "a hunter who dies alone shows dead on the GM's board, and the GM's Revive brings it back"; `tests/e2e/look.e2e.ts`: the solo gates at 360 and 390 px. A personal gate spawned in a test is set up through the store with a clock due, and the tick is driven by the app's `ready` (a reload), not by waiting hours.

### Step 5: close

`bun run deps -- --write`, `bun run charts` (`scripts/charts/solo.ts`: the personal clock and the waiting run, walk events in `tests/models/solo-events.ts`, entries in `MACHINES`), typecheck, the whole `bun run test`, every browser file one at a time on `E2E_PORT=3260`, `feel.e2e.ts` alone three times on 3218. AGENTS.md: rows for a solo run, a personal gate, a world gate marked solo, the waiting run and the `rules` doc; recipes touched (a field of a saved thing, a room message). `for-the-owner.md`: each choice in section 12.

## 11. Decision trail

- The outcome union is the engine's `RunOutcome`, read through a table of words, not a second union with the same members.
- A single run is the odds machine asked for one play, so there is one loop; its progress is a count without a fraction, because a single play's length is unknown before it ends.
- `sheetTotals` is taken out of `writeBack`, so a run and the fight write a hunter from the same function.
- Death saves run unless the party won with another hunter standing; alone they always run. The run writes each face through `sheetEdit`'s `deathSave`, so dead is the life machine's answer. (The other way, leaving a downed hunter dying for the player to roll on the sheet, is in section 12.)
- The write refuses a run whose hunter changed while it played (`soloKey`), rather than writing totals over a newer sheet.
- No seed is stored before the run: the player sees nothing of a run before its one write, so a reload in the middle gains nothing and loses nothing.
- A personal gate is a field of the hunter, with its own id kind and no gate type; it is not a `Gate` and not run by the gate machine, because it has no world day, no Edit and two ends (cleared, closed).
- The clock is a two-state machine with the next spawn's time, so a paused clock arms no timer and a resumed one spawns at once.
- A spawn's rank uses centred weights, not `gateSpawn`'s (flagged for the lead).
- A world gate's monsters reach players in a new `solo` doc, by value, built within `DOC_MAX`; the world doc marks solo only what that doc holds.
- The GM's phone pays a won run whenever the gate can still be cleared, whatever its solo mark at that moment.
- One message each way; the answer carries the reward, so the run's close and the reward are one write on the player's phone.
- The waiting run sits in `settings.sync.runs` and hears the outbox from the outbox's own writer (sync.ts), in the same write.
- The `build` doc becomes the room's `rules` doc (fallback: extend `build`).
- A solo run uses the open arena, records no defeat in the bestiary and offers no extraction; a world gate's map and type change nothing in a run.

## 12. Choices for for-the-owner.md (step 5 writes them)

- The second player on a gate already cleared keeps the cost paid and gets nothing.
- A Penalized hunter can still run solo gates.
- A run the GM's phone takes after the GM closed the gate to solo runs is still paid if the gate is open.
- A solo run's hunter rolls its death saves at once (the run resolves), rather than lying down for the player to roll them on the sheet.
- Personal gates have no boss, at most three monsters, one rank below to one above.
- A player's run of a room's gate plays by the player's rules with the GM's monsters and statuses; the GM's other rule overrides do not travel (true of every fight number today).
- No GM's manual refusal of a run: the GM's phone answers by the rules.

## 13. Principles read, and the choice each changed

- `principle-model-the-domain`: the clock is a union with a table (off, on with its next time) instead of a "paused" flag beside a time; the waiting run is a machine whose `lost` state is stored, not guessed from the outbox's absence of a letter (a letter leaves the box both when sent and when dropped).
- `principle-type-system-discipline`: `PersonalGateId` is its own id, never a `GateId`; `SoloGate` is a union of the two places a gate can be; the refusals are a union with a words table the compiler fills.
- `principle-boundary-discipline`: the `solo` doc is read by the parsers each kind already has (`parseMonster`, `parseStatusDef`); the two payloads by bounded readers; the override bounds at `parseOverrides`, not a clamp where the clock reads them.
- `principle-make-operations-idempotent`: the tick derives what is due from the clock and the time, so a repeat finds nothing; the answer is paid by the run's id as well as the event's, so two GM phones cannot pay twice.
- `principle-separate-before-serializing-shared-state`: the gate has one writer (the GM's phone); the player's phone keeps its own record (the waiting run) instead of writing a copy of the gate.
- `principle-subtract-before-you-add`: no second loop, no second outcome union, no second "what a row leaves on its sheet", no second doc overlay; the odds control moves out of `combat.js` rather than being copied.
- `principle-redesign-from-first-principles`: the `build` doc is renamed for what it now carries, rather than a third doc beside it.
- `principle-explain-the-number`: each `RULES.solo` number has its reason in section 7, the rank weights were checked against `gateSpawn` by arithmetic first, and the measurement that would change them is written before it runs.
- `principle-foundational-thinking`: the engine's three findings and `sheetTotals` come first (step 2's opening), since the run, the odds and the fight's write-back all stand on them.
- `principle-experience-first`: the progress shows the real round and moves, not a made-up percentage; a refusal says the way out.
- The `statechart` skill: its TLA+ run needs TLC from the network and this phase runs nothing, so the two machines are drawn above by hand with every cell; `bun run charts` draws them from the real steps in step 5, as the odds' notes did.

## 14. Questions only the owner can answer

1. A long rest is a tap on the sheet and undoes a run's HP, mana and fatigue at once. Should a long rest be limited (once a day, say), so the odds' cost lasts? Until he says, nothing changes.
2. Alone, a hunter who dies comes back through the GM's Revive (switch the phone to GM) or a resurrection boon. Does he want a System resurrection with a price instead (gold or XP)? Until he says, the way is today's.

## 15. The lead's rulings (Nov 18) and what they settled

1. Rank weights: below 25, same 60, above 15, a band of one, a share past E or S to the hunter's own rank. The brief's "gateSpawn's weights" is withdrawn. for-the-owner.md gets a line.
2. The `build` doc becomes the room's `rules` doc with one overlay `withRoomRules`; every caller migrated and the old names deleted in the same step; no compatibility reader.
3. The `solo` doc by value within `DOC_MAX`, the world doc marking solo only what it holds; the worst-case arithmetic above `DOC_MAX` and a wire test.
4. The two questions of section 14 are not asked now; each is a line in for-the-owner.md with what the owner would say.
5. A solo death rolls its saves at once.

Settled before code, as the lead asked:

- **`Hunter.solo` in the sheet push.** `parseSheetHunter` runs `fixHunter`, which reads `solo` with `parseSolo` (`gates/personal.ts`): at most 10 gates (`SOLO_BOUNDS.held`'s upper bound), the newest kept; each with at most 3 roster lines (the spawn's `MAX_KINDS`), a count of 1 to 12 (`SOLO_BOUNDS.pack`), a name of 60, an id of prefix `pg`, two times; a clock that does not read is off. The worst case (10 gates, 3 lines of an 80-character monster id, a 60-character name, two times) is 5,105 characters of JSON, under a sixth of `SHEET_MAX` (32,768); the usual case (3 gates, `pg` ids of a few digits, built-in ids like `seed:goblin`, names of about 15) is about 900. A sheet past `SHEET_MAX` is refused before it is sent today (sync.ts, `too-large`), so the gates take room from the rest of a sheet only in that worst case. `tests/protocol.test.ts` reads the worst case back whole and checks it is under a sixth, and reads a sheet past every bound down to it.
- **A dead hunter's clock.** Off, as "may not run" (`soloTracked`): a dead hunter gets no gates, and the gates it holds close at their time. Revived, the next tick turns the clock on and opens a gate at once. Test: "a dead hunter's clock goes off; revived, it gets a gate at once".
- **No reroll.** Nothing a player sees before the one write tells the outcome: the run's frames show the round and the moves played only (`progressOf`), never HP, a foe's fall or the winner; the window comes after the write. A reload during the play leaves nothing: no seed and no run is stored before the write (the play is a page value). `tests/e2e/solo.e2e.ts` pins both: the words on screen while the play runs hold no number but the round and the moves, and a reload in the middle of a run leaves the hunter's HP, mana, fatigue, items and the gate as they were.
- **A rank with no normal built-in monster.** The seeds have no normal S monster (only S bosses), so a spawn's rank goes to the nearest rank below that has one, else above (`pooled`): an S hunter's gates are A gates. Test: "a rank with no normal built-in monster opens a gate of the nearest rank that has one".
- **The measurement** of section 7 goes in section 16 before the numbers are final; a number it moves is said there.
- **The odds control in `src/views/odds-box.js`**: the lint "every let a view keeps" names its one `let`; the feel case "the GM plays a fight out 100 times for its odds" is run alone on a quiet box after the move.

## 16. The steps

### Step 2: the engine and the core (done)

The measurement, written before the run (section 7) and run at step 2 on the engine: `scratchpad/solo/measure.ts` (not committed), 100 plays each, every row on `sensible`, seeds fixed per row. E: the three pregens at level 1, built as the starter campaign builds them, through `soloFight`. C: the simulator's builds at C (its yardstick) against High Orcs, the C normal brute. A share over 100 plays has a standard error of at most 5 points.

| Hunter | Rank | Monsters | Clears | Down | Dead | Rounds (median) | HP left (10th, 50th, 90th of max) |
|---|---|---|---|---|---|---|---|
| Brakk Ironhide (level 1) | E | 1 Goblin | 96% | 4% | 2% | 5 | 4, 13, 22 of 51 |
| Brakk Ironhide (level 1) | E | 2 Goblins | 0% | 100% | 41% | 3 | 0, 0, 0 of 51 |
| Brakk Ironhide (level 1) | E | 3 Goblins | 0% | 100% | 40% | 2 | 0, 0, 0 of 51 |
| Mira Vale (level 1) | E | 1 Goblin | 95% | 5% | 2% | 4 | 4, 18, 31 of 45 |
| Mira Vale (level 1) | E | 2 Goblins | 16% | 84% | 40% | 4 | 0, 0, 4 of 45 |
| Mira Vale (level 1) | E | 3 Goblins | 0% | 100% | 46% | 2 | 0, 0, 0 of 45 |
| Eldrin Voss (level 1) | E | 1 Goblin | 99% | 1% | 1% | 3 | 8, 21, 33 of 45 |
| Eldrin Voss (level 1) | E | 2 Goblins | 1% | 99% | 38% | 3 | 0, 0, 0 of 45 |
| Eldrin Voss (level 1) | E | 3 Goblins | 0% | 100% | 47% | 2 | 0, 0, 0 of 45 |
| sim tank | C | 1 High Orc | 0% | 100% | 46% | 16 | 0, 0, 0 of 114 |
| sim tank | C | 2 High Orcs | 0% | 100% | 40% | 10 | 0, 0, 0 of 114 |
| sim tank | C | 3 High Orcs | 0% | 100% | 45% | 9 | 0, 0, 0 of 114 |
| sim speed | C | 1 High Orc | 100% | 0% | 0% | 4 | 46, 55, 64 of 81 |
| sim speed | C | 2 High Orcs | 33% | 67% | 24% | 8 | 0, 0, 15 of 81 |
| sim speed | C | 3 High Orcs | 0% | 100% | 44% | 4 | 0, 0, 0 of 81 |
| sim cannon | C | 1 High Orc | 95% | 5% | 2% | 2 | 49, 69, 75 of 81 |
| sim cannon | C | 2 High Orcs | 91% | 9% | 4% | 4 | 1, 39, 62 of 81 |
| sim cannon | C | 3 High Orcs | 37% | 63% | 21% | 5 | 0, 0, 35 of 81 |

What it changed: one same-rank normal is the even gate the notes expected (95 to 100% for every pregen and for the C damage builds), so `ranks` stays. Two are not a hard gate but a near-certain loss for a level 1 pregen, with death in about 40% of plays, and three are a loss for everyone but the C cannon. **`pack` moves from 1 to 3 to 1 to 2**: half the gates even, half the hard one whose odds warn of death. What limits it: a downed lone hunter's saves run to their end (section 1.1), and about 40% of those end dead (three failures before three successes at a 55% success face, with the 1 counting twice), so "down" alone is close to a coin flip on death; the clear share is the lever, not the death share. A finding for the owner, not changed: the simulator's pure tank cannot clear even one same-rank normal alone (0 of 100: it outlasts the orc for 16 rounds but deals too little), which is the build triangle working as designed; the odds tell a tank player so before the run.

What step 2 holds (commit "Solo runs: the engine's findings and the core of a run"):

- Engine: `playSaves` (no saves when the party won with another hunter up), `lifeOfSaves`, `Play.spent`, `sheetTotals` shared by the fight's write-back and the engine's end, `RowEnd`/`RunEnd` as section 2, `progressOf` with the moves and the round, fatigue "of" its capacity in the detail. The simulator reads `playSaves`; its death rows count only real deaths now (a won boss fight with another hunter up no longer rolls).
- Core: `gates/personal.ts` (the gate, the clock, `parseSolo`, `soloTracked`, `soloWake`), `gates/solo.ts` (`soloTick`, `pooled`, `soloReady`, `soloFight`, `ranOn`, `soloRan`, `runLine`, the refusals and their words), `RULES.solo` and `SOLO_BOUNDS` with their readers, `Hunter.solo` in the save and the sheet, `GateFields.solo` and the edit's field, `nextWake`'s term, `soloLines` on the Rules page, `PersonalGateId`, `SpawnAsk.pack` and `.boss`, `soloRank`.
- Tests: `tests/solo.test.ts` (new), cases in `tests/odds.test.ts`, `tests/protocol.test.ts` (the sheet's bounds and its worst case), `tests/overrides.test.ts`, `tests/rules-text.test.ts`, `tests/world.test.ts`, `tests/detail.test.ts`.

### Step 3: the room (done)

What changed from section 5 on the way, each with its cause:

- **The waiting run's `unsent` is read from the outbox, not raised.** Many writers drop or refuse a letter (sync.ts's sends, a full box in any core step that posts, `rebound` in bind.ts and party.ts); hooking each would spread the run's rule over five files. A letter leaves the box as `sent` only in the write that marks its run `taken`, so a run still stored `posted` whose letter is no longer queued or on its way is lost by evidence that stays true wherever a write stopped (principle-make-operations-idempotent). Stored states are `posted`, `taken`, `gone`; shown states (the `TABLE`'s) are `posted`, `taken`, `lost` (`shownOf`). Events: `taken`, `answered`, `roomGone`, `dismiss`.
- **`taken` is heard before the letter leaves the box.** The first test wrote `runTaken` after the box's `sent` step, and the run read as lost (its letter already gone). sync.ts's `boxDo` now takes a `heard` step run on the save before the box's change, in the same write; the room model copies it.
- **The applied ring records a refused land's id** (`appliedOnce`, as for every message): a second answer to a run is recorded and does nothing. The run's id is the guard, as section 4 said; the test reads the reward and the run list, not the ring.
- **A run of a world gate enters it without "The party entered" in the log**: `enteredAlone` (world.ts) runs the gate's `enter` with no line, since the run's own line says who entered.
- **The rules doc replaces the build doc** (`RoomRules`, `withRoomRules`, `roomRulesOf`), the old `_build` doc refused by the server and not read.
- **The solo doc measured**: 40 gates naming all 22 built-in monsters are 29,996 characters (gates 9,466, monsters 20,209, the largest monster 1,744), under half of `DOC_MAX`; a gate of 50 GM monsters with 11 abilities each is left out, and the world doc does not mark it. The arithmetic is above `SOLO_DOC` in protocol.ts.
- **The type is `WaitingRun`**, not `Waiting`: push.ts already exports a `Waiting` (the lint "a type name is exported by one module").
- **`EventBody` is taken member by member**, so `soloAnswer`'s two verdicts each keep their fields; no other body changes (each other payload is one object).

Tests: `tests/solo-wait.test.ts` (new: what the player sees, every cell, the cap, the reader, a random walk of 200 that never answers a run twice); `tests/applied.test.ts` ("the GM's answer to a solo run lands whole, once a run"); `tests/protocol.test.ts` (the two payloads in `VALID` and their bounds, the rules doc, the world's solo mark, the solo doc's reader, "the worst-case solo doc on the wire"); `tests/server-rooms.test.ts` (a player cannot pay its own run; a run speaks only for its own hunter; the rules doc and the old build doc refused); `tests/build.test.ts` (the room's solo switches over a player's rules); `tests/solo.test.ts` ("a world gate open to solo runs, in a room"); `tests/models/room-world.ts` and `tests/room-system-model.test.ts` (the moves `solo` and the GM's answer, the rule "a solo run is paid at most once, and only a run whose gate the GM's phone cleared", and the scenario of two players, a lost answer and a reload). The exhaustive run leaves `solo` to the random walks: it is posted as a told use is.

### Step 4: the screens (done, c7a6716)

- **The odds control is one module**: `src/views/odds-box.js` (`app.api.odds`: `paint` a box by its key, `ask` its answer, played out first when it is not done), mounted by `combat.js` (key `fight`) and by each solo gate's card in `gates.js` (key `solo:<kind>:<gate>:<hunter>`). Its one container is the page Map `boxes` (named in the lint); combat.js lost its `let odds`, `oddsFrame` and `paintOdds`'s body, and its CSS classes became `.odds-*` (one selector in `odds.e2e.ts` followed). Every word is still `ODDS_WORDS`.
- **The Gates view** (`gates.js`): the solo section first on every seat, for the active hunter: its personal gates (soonest to close first, "Closes in N hours"), then the gates open to solo runs (the room's from its docs on a player's phone, the world list's on a phone alone or the GM's). A card has its monsters, its odds box, Enter alone, or the refusal's words, and a waiting run's line (Dismiss for a lost one). Enter alone asks the odds (`ask`), then "ENTER ALONE?" with `soloConfirmLines`, then one play a few commands a frame with `motion.progress(el, null, "Round 3, 37 moves played")`, then the one write and the window (`OUTCOME_WORDS`, `runCostLines`, the reward's lines, then `hunter.granted` for a level-up). The GM's side: "Open to solo runs" in the edit form, its note on the card (and "Too many monsters..." for a gate the solo doc left out), "Personal gates" On or Off and the hours at the top (`soloRuleSet` into `rulesOverrides.solo`), and the `soloRun` handler (`sync.once`, `soloTaken`, a toast of `takenLine`).
- **The clock's wake**: `soloWake` now also answers "now" for a hunter whose clock is off and may run (a new hunter, one revived, the switch turned on), so the first gate comes right after setup and not at the next minute's recheck; `nextWake` takes `{ personal, gm }` for it. `quests.js`'s `checkDaily` calls `gates.tick()` first.
- **A cost line read HP 99999** in the first browser run: the window read the life as stored. `runCostLines` reads `hpOf`, `manaOf` and fatigue within the maxima, as the sheet does.
- **A new player's first screen**: the first personal gate's window ("A GATE HAS APPEARED") comes right after Hunter created. `onboardPlayer` in `tests/e2e/helpers.ts` answers it, as it answers the setup's windows.
- `scripts/ui-shots.ts`: a step "solo gates" (`gates-solo`, `gates-solo-odds`).
- **Every browser file, one at a time on 3260** (feel left to step 5): the first loop failed 13 tests in five files, each with a named cause and each fixed in the test's setup, never by a wait or a bound:
  - `customization.e2e.ts` read the room's `build` doc, which ruling 2 renamed `rules`: it reads `docs.rules.data.build`.
  - `gates-quests-dailies.e2e.ts` (spring forward), `look.e2e.ts` (two Delete hunter cases) and `save.e2e.ts` (eight cases seeded from `main-player.json`): a hunter alone now gets a personal gate on open, and its "A GATE HAS APPEARED" window stood over the tap (Playwright: "sys-overlay intercepts pointer events"). Their setup turns personal gates off (`rulesOverrides.solo = { personal: false }`; save.e2e's `asCurrent`), as their subject is not the gate.
  - `room-view.e2e.ts` "a join under way from another window": failed 1 run in 5 alone. The player's page had a service worker, which fetches `/api` itself once it controls the page, so `page.route` did not hold the join (the request log shows the join's polls at once, no gap). The longer onboarding (the gate window) gave the worker time to claim the page. The player's device blocks the service worker, as the next test in the file already does; 8 runs of 8 pass.
  - Then: save 19 passed, room-view 10, customization 9, gates-quests-dailies 24, look 24; the other 25 files passed in the first loop.
- Browser tests: `tests/e2e/solo.e2e.ts` (seven: alone with a personal gate; a room's gate with the GM's phone online; offline then back, paid once across reloads of both phones; two players on one gate; a death alone and the GM's Revive, with every draw fixed at 3, the seed a bun search found for that body: the goblin downs it and its saves 18, 5, 2, 6 end dead; the round-and-moves line and a reload in the middle that leaves no trace, at 20x CPU so the play spans frames; the GM's switch off), and two look cases at 360 and 390 px.

### Step 5: close (done)

Code, tests and charts are at c7a6716 (step 4's commit); this step's commit adds AGENTS.md's last lines, for-the-owner.md and these notes.

- `bun run deps -- --write`: "wrote docs/dependency-map.md". `bun run charts`: "wrote /home/user/systemgaming/docs/state-machines.md" (the clock and the waiting run from `scripts/charts/solo.ts`; the odds chart's where-row names `odds-box.js`). The charts' first run failed the typecheck in `tests/models/solo-events.ts`: a switch on `e.type` of a one-object event type does not narrow `e.type` inside a case, so `step`'s event read the whole union; the case reads a narrowed `const t`.
- `bun run test` (typecheck, views typecheck, bun test): "Ran 3659 tests across 97 files." 3656 pass, 3 skip (the Postgres-only cases, no `DATABASE_URL`), 0 fail.
- Every browser file one at a time on `E2E_PORT=3260`: all pass (the failures of the first loop and their causes are in step 4).
- `feel.e2e.ts` alone three times on 3260 (the lead's box rule keeps 3218 for the push; the box quiet, load under 1.1), every `[feel]` line kept (worst frame / worst tap, ms):

| case | run 1 | run 2 | run 3 |
|---|---|---|---|
| a fight turn | 66.7 / 58.7 (one long task, 53) | 33.4 / 60.3 | 33.4 / 44.7 |
| a player watching the GM's turn | 16.8 / 0 | 16.8 / 0 | 33.4 / 0 |
| a maker opening | 33.3 / 64.8 | 33.4 / 55.6 | 16.7 / 48.9 |
| the sheet scrolling | 16.8 / 17.3 | 16.8 / 9.2 | 16.8 / 8.7 |
| a pan and a pinch on the map | 16.8 / 30.5 | 16.8 / 22.6 | 16.8 / 20.7 |
| an ability picked on the map | 16.7 / 41.4 | 50 / 69.4 | 16.8 / 43.9 |
| a use from the map | 49.9 / 43.6 | 66.7 / 60.8 | 50 / 44.3 |
| the odds playing (after the move to `odds-box.js`) | 33.3 / 33 (307 frames) | 33.4 / 32.1 (365) | 33.3 / 26.3 (366) |

  Medians 16.7 in every case; each run "6 passed". The odds case holds after the move.
- AGENTS.md: the rows of section 10 (a solo run, personal gates, a world gate marked solo, the waiting run, the `rules` doc in the build row, the odds row's control), the machines' list, and two lines under Tests (the gate window over a seeded save; `page.route` and a service worker). for-the-owner.md: "Solo runs (feature 2, Nov 18)", each choice of section 12 and the lead's rulings 1 and 4.

Left: nothing of the brief. Not done by choice: a solo run records no bestiary defeat and offers no extraction (for-the-owner.md says so).
