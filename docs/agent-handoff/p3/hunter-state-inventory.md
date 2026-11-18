# Hunter state inventory (input for M7)

Read-only survey of the working tree on Nov 12. It covers vitals, fatigue, the daily penalty, the job change chain and ability points. Line numbers are for the files as they stand now. It describes what exists and proposes nothing.

Files read in full: `src/views/hunter.js`, `src/views/quests.js`, `src/core/rules.ts`, `src/edge/room-events.ts`. Read in part: `src/core/save.ts` (types 56-94, factories 151-176, `fixHunter` 307-373, `parseSheetHunter` 590-597, `starterHunter` 611-627), `src/core/combat/encounter.ts` (25-303), `src/views/combat.js` (36-135, 398-418), `src/edge/store.ts`, and the snippets cited below from `gm.js`, `effects.js`, `table.js`, `starter.js`, `onboard.js`, `custom.js`, `skills.js`, `statuses.ts` and `status.ts`.

## 0. How a change reaches the listeners

`store.update(fn, reason)` runs `fn`, then `repairSave`, then `persist`, then calls every subscriber at once (`src/edge/store.ts:117-122`). `app.js:246` turns each call into `app.emit('change', p)`. Modules register in the order of `MODULES` (`src/app.js:250`): effects, hunter, quests, skills, and so on. So inside every `store.update` the following run nested and in this order:

1. `settle` in hunter.js (`hunter.js:117-121`), which may call `store.update(..., 'settle')` itself.
2. `syncChain` in quests.js (`quests.js:188`), which may call `store.update(..., 'chain-check')` and `complete()`.
3. `resetCooldowns` in skills.js when the reason is `'rest'` (`skills.js:61`).

Both `settle` and `syncChain` are "a `store.update` inside a change listener", the bug class the phase 3 brief names. No lint rule covers it yet (`tests/lint.test.ts` has the three rules listed in AGENTS.md).

`settle` is skipped when `store.readOnly` is true (`hunter.js:118`). Read-only means the save came from a newer schema (`save.ts:575`). In that mode `store.update` still mutates the save in memory (`store.ts:117-122`, `persist` returns early at `store.ts:91`), so damage to 0 HP leaves no Unconscious chip and no death saves.

## 1. Fields that are state rather than data

Types are at `save.ts:83-94`. Defaults are in `newHunter` (`save.ts:169-176`) and `store.newHunter` (`store.ts:137-145`, which adds the daily quest and sets `daily.lastCheckedKey`).

### 1.1 `hp`

Current hit points. The maximum is not stored: `derived(h).hpMax` is `max(1, formulaHpMax(stats, level) + bonuses.hpMax + hpAdj)` (`hunter.js:98`, formula at `rules.ts:113`). Bonuses come from the active title, items, skills and the build path's perk skill (`hunter.js:79-87`, `save.ts:377-390`).

Direct writers (15 sites):

| file:line | When |
|---|---|
| `hunter.js:109` | `settle` clamps `hp` down to `hpMax` after any change |
| `hunter.js:158` | `grantXP` on a level gained, when `rules().levelUpRestore` (true by default, `rules.ts:15`) |
| `hunter.js:265` | `api.hunter.damage` |
| `hunter.js:266` | `api.hunter.heal` |
| `hunter.js:275` | `api.hunter.rest` (short +25%, long +100% of max, `rules.ts:33`) |
| `hunter.js:401` | HP bar buttons on the Status view (-5, -1, +1, +5, Full) |
| `hunter.js:412` | GM "Edit max HP" prompt; clamps `hp` to the new max and moves `hpAdj` |
| `hunter.js:434` | Death save natural 20 sets `hp = 1` |
| `quests.js:269` | Completing the last daily of the day with `dailyTemplate.recover` (default true, `rules.ts:36`) sets full HP and MP |
| `combat.js:64` | `writeSheet` for a `hunterHp` effect from the encounter reducer |
| `starter.js:41`, `starter.js:52` | Pre-made hunters: `1e6`, then `hpMax` |
| `save.ts:173`, `save.ts:312`, `save.ts:497` | Factory, repair (`max(0, hp)`, no upper clamp), v1 migration |

Callers that change HP through `damage` or `heal` (6): the Status view HP amount box (`hunter.js:377`), the room `hp` applier (`room-events.ts:55`), the GM board amount box and step buttons for local cards (`gm.js:655`, `gm.js:682`), the combat HUD amount box (`table.js:170`), and the `heal` op of an item or effect (`effects.js:50`).

Readers: the Status view (`hunter.js:376-380`, `404`, `463`), the guards listed in 2.4, `room-events.ts:54,66-67` ("YOU HAVE FALLEN"), `combat.js:43,55` (live numbers and `hunterView`), `combat.js:234` (attack targets need `hp > 0`), `gm.js:185` (board bars), `table.js:106,116,169-171`, `custom.js:116-118` (vibrates on a drop, harder at 0), `inventory.js:180` (can a heal item be used), `effects.js:49`.

Invariants the code tries to keep: `0 <= hp <= hpMax` (every writer clamps, and `settle` catches max drops from stat, title, gear, level or `hpAdj` changes). `hp <= 0` if and only if the `unconscious` condition is present (`settle`, `hunter.js:112-113`). `deathSaves` exists only while `hp <= 0` (`hunter.js:113`).

### 1.2 `mp`

Same shape as HP: `mpMax` is derived (`hunter.js:99`, `rules.ts:114`). Writers: `hunter.js:110` (settle clamp), `158` (level-up restore), `269` (`spendMp`), `275` (rest), `401` (bar), `412` (max edit), `quests.js:269` (daily recover), `room-events.ts:60`, `combat.js:65` (`hunterMp`), `effects.js:52` (`mp` op), `starter.js:41,52`, `save.ts:312,497`. Callers of `spendMp`: `skills.js:47` (skill cost), `shadows.js:83` (summon). The reducer refuses a hunter MP spend below 0 (`encounter.ts:243`).

### 1.3 `fatigue`

0 to 100, see section 3.

### 1.4 `deathSaves?: { s, f, stable }`

Optional (`save.ts:86,93`). Writers: `hunter.js:112` (created by `settle` when it adds Unconscious, only if absent), `hunter.js:113` (deleted by `settle` when `hp > 0`), `hunter.js:421` (GM Stabilize, creates if absent), `hunter.js:433-436` (death save roll, creates if absent), `save.ts:352` (repair fills missing keys or deletes a non-object). Readers: `hunter.js:464-471` only. Nothing outside hunter.js reads it; the GM board and combat do not show death saves.

### 1.5 `conditions` and the three derived chips

`conditions` is a list of `{ key, rounds, def?, source? }` (`save.ts:54`, repaired at `save.ts:290-299`). Three built-in keys stand for hunter state rather than a status someone applied (`statuses.ts:20-22`, constants `UNCONSCIOUS`, `PENALIZED`, `EXHAUSTED` at `statuses.ts:32-36`; nothing imports these constants).

| Chip | Added by | Removed by | Meaning in numbers |
|---|---|---|---|
| `unconscious` | `settle` when `hp <= 0` (`hunter.js:112`) | `settle` when `hp > 0` (`hunter.js:113`) | none; the death panel shows while the chip is present (`hunter.js:464-465`) |
| `exhausted` | `settle` when `fatigue >= 100` (`hunter.js:114`) | long rest (`hunter.js:278`), fatigue "Rest" button (`hunter.js:402`), any generic remover | none |
| `penalized` | daily rollover (`quests.js:305`) | penalty quest completed (`quests.js:240`) or deleted (`quests.js:616`) | none: `mods()` skips it (`status.ts:154-158`); the -2 comes from `h.penalty` (`hunter.js:94`) |

Generic condition writers that can touch these keys too: `addC`/`delC` through `api.hunter.addCondition` and `removeCondition` (`hunter.js:286,288`), whose callers are the sheet's Add select and chip x (`hunter.js:416,419`), `effects.js:61,65` (item `applyStatus` and `cureStatus` ops) and `room-events.ts:75-76,83` (room `status` event). `combat.js:67` replaces the whole list from a `hunterStatuses` effect, bypassing every guard. `fixConditions` in the repair keeps any key.

### 1.6 `penalty: null | { since, days }`

See section 4. Writers: `quests.js:240`, `quests.js:304`, `quests.js:616` at runtime, plus `save.ts:175` (factory) and `save.ts:348-351` (repair: `since` defaults to now, `days` to at least 1). Readers: `hunter.js:94` (the -2), `hunter.js:477` (chip), `gm.js:198` (board chip "PENALTY xN").

### 1.7 `xp`, `level`, `points`, `statsLocked`, `rank`

See section 6 for the flow.

- `xp` is XP inside the current level, not a total. Writers: `hunter.js:152-155` (`grantXP`), `hunter.js:707-708` (GM raw edit clamps to `0..xpToNext-1`), `save.ts:311,491`. Readers: `hunter.js:451-452`, `starter.js:29`, `combat.js:745`.
- `level` writers: `hunter.js:153-154` (`grantXP`), `hunter.js:707` (GM raw edit, no points and no restore), `save.ts:311,491`. Readers: derived HP/MP (`hunter.js:98-99`), rank eligibility (`hunter.js:171`), `syncChain` (`quests.js:181`), party list, GM board, pickers.
- `points` (unspent ability points) writers: `hunter.js:155` (`grantXP`), `239` (`applyRewards` `points`, may be negative from a room `award`, `protocol.ts:118`), `523` (spend one), `526` (undo an unconfirmed one), `531` (GM "+1 point"), `709` (GM raw edit), `custom.js:309` (build auto-place), `save.ts:311,491`. Readers: `hunter.js:543,546`, `custom.js:277,441`.
- `statsLocked` is the stat floor a player cannot go below with the minus button. Writers: `hunter.js:523,525` (GM edits lock), `530` (Confirm), `706` (GM raw), `720` (leaving the Status view confirms every hunter), `starter.js:38`, `save.ts:313-320` (repair: `min(locked, stat)`).
- `rank` writers: `hunter.js:176` (`reevaluate`, only upward, `hunter.js:172`), `hunter.js:702` (GM raw select, any rank), `save.ts:310,515`. Rank is not lowered when levels are lost. Readers: `derived().rankBonus` (`hunter.js:92`), build tiers (`rules.ts:129`, `custom.js:293,321`), combat tier (`combat.js:55`).

### 1.8 `job` and `canExtract`

- `job` writers: `hunter.js:246` (`applyRewards` with `rewards.job`), `hunter.js:368` (Job field on the Status window, any non-empty text), `onboard.js:79`, `starter.js:38`, `save.ts:172,309,490`.
- `canExtract` writers: `hunter.js:246` and `hunter.js:368` (set true when the job is in `rules().extractJobs`, `rules.ts:44`), `quests.js:266` (the same check again after a quest reward), `save.ts:174`. Nothing sets it back to false; changing the job away from Necromancer keeps it. Readers: `shadows.js:8` (gates the Shadows view and `extract`), `combat.js:620` (Extract button).

### 1.9 Quest fields that carry the job chain

`chainId?`, `step?`, `chainJob?` on a quest (`save.ts:63`). Writers: `quests.js:153` in `issue` (only when `partial.chainId` is set; `step` clamped to 1..99, `chainJob` kept only if it is in `CHAIN_JOBS`), `quests.js:182` (step 1 objective progress). The repair only checks types (`save.ts:331`). Readers: `quests.js:180,251-252`. See section 5.

### 1.10 `daily: { streak, lastCompleteKey, lastCheckedKey }`

Writers: `quests.js:243-244` (streak and last complete day on the last daily of a day), `quests.js:303` (streak 0 on a penalty), `quests.js:314` (last checked day), `store.ts:143`, `save.ts:516,625`. Readers: `quests.js:242-245,285,290,294-295`, `gm.js:197`.

### 1.11 Skill cooldowns

`skills[].cdLeft` follows turns. `combat:turn` (emitted at `combat.js:80` for each `turnStarted` effect) ticks it down by one (`skills.js:34-37,60`). A skill use sets it to `cooldown` (`skills.js:50`). It is reset three times on a rest: `hunter.js:277` inside the rest update, `hunter.js:281` (`skills.resetCooldowns(hid)`), and `skills.js:61` on a `'rest'` change, which resets the active hunter even when another hunter rested.

## 2. Vitals today

### 2.1 Situations and how the code tells them apart

| Situation | Stored shape |
|---|---|
| Up | `hp > 0`, no `unconscious`, no `deathSaves` |
| Dying | `hp == 0`, `unconscious`, `deathSaves = { s < 3, f < 3, stable: false }` |
| Stable | `hp == 0`, `unconscious`, `stable: true`. Reached by 3 successes or by the GM's Stabilize, so `s` can be below 3 |
| Fallen (3 failures) | `hp == 0`, `unconscious`, `f >= 3`. `f` can reach 4 (2 failures plus a natural 1, `hunter.js:436`). The GM can still press Stabilize, giving `f >= 3` and `stable: true` together |
| Between write and settle | `hp == 0` without the chip, or `hp > 0` with it, inside one synchronous `store.update` before `settle` runs; lasting in read-only mode |

There is no Dead state. A fallen hunter differs from a dying one only by `f >= 3`, which disables the roll button (`hunter.js:470`).

Each part of the code asks a different question:

- The death panel and pips show when the `unconscious` chip is present (`hunter.js:464-465`), not when `hp <= 0`.
- The removal guards ask `hp <= 0` (`hunter.js:288,476`, `gm.js:189`).
- Combat targets ask `live(c).hp > 0` (`combat.js:234`). A hunter combatant's own `state` (`'up' | 'down'`) does not follow HP: `changeHp` for `kind: 'hunter'` only emits `hunterHp` (`encounter.ts:215-219`), and `setState` checks HP only for monsters and shadows (`encounter.ts:160`, `followsHp` at `encounter-types.ts:120`). A dying hunter keeps taking turns.
- The combat card shows a "Down" tag for a remote hunter at 0 HP but nothing for a local one (`combat.js:623,650`).
- The room applier fires "YOU HAVE FALLEN" when HP crosses from above 0 to 0 (`room-events.ts:67`). The Status view toasts "HP has reached 0. You are dying." from its own buttons (`hunter.js:380,404`).

### 2.2 What `settle()` does

`settle(h)` at `hunter.js:107-116`, in order:

1. Clamp `hp` to `hpMax` and `mp` to `mpMax`.
2. If `hp <= 0`: add `unconscious` with `addC`. Only when that call changed the list, create `deathSaves` if absent (`||=`). A chip removed and re-added keeps the old saves, since `deathSaves` was never deleted.
3. Else: remove `unconscious` and delete `deathSaves`.
4. If `fatigue >= rules().fatigue.collapseAt` (100): add `exhausted`. It never removes `exhausted`.
5. Return whether anything changed.

When it runs: on every `change` event (`hunter.js:117-121`). The listener first runs `settle` on a `structuredClone` of each hunter, and only if one would change does it call `store.update(d => d.hunters.forEach(settle), 'settle')`. That second update emits a second `change`, and the nested run finds nothing to do. `rest` also calls `settle(h)` directly inside its own update (`hunter.js:279`).

What breaks without it: damage to 0 shows no death panel and no chip; healing leaves the chip and the old saves; any lowered maximum (GM raw `hpAdj` edit at `hunter.js:710`, a lost level, a removed title or item) leaves `hp` above `hpMax`; fatigue 100 never shows Exhausted; a natural 20 leaves the saves in place. Combat relies on it explicitly: "The hunter view's settle adds or drops Unconscious." (`combat.js:58`). It is the only code that keeps the chip and HP together, and it runs as a second write after the fact.

### 2.3 Transition table

"Up" here means `hp > 0` after the write. All writes clamp at 0, so damage at 0 HP keeps the hunter at 0.

| From | Event | To | Side effects | file:line |
|---|---|---|---|---|
| Up | Damage to 0 (sheet box, bar, GM board, HUD, room `hp`, combat `hunterHp`) | Dying, 0/0 | `settle` adds chip and fresh saves. Toast on the sheet; "YOU HAVE FALLEN" window from a room event | `hunter.js:265,401`, `room-events.ts:55,67`, `combat.js:64`, `hunter.js:112` |
| Up | Damage above 0 | Up | none | same |
| Dying | Death save roll 10-19 | Dying, `s+1`; at `s = 3` Stable | toast | `hunter.js:435` |
| Dying | Death save roll 2-9 / natural 1 | Dying, `f+1` / `f+2`; at `f >= 3` Fallen | toast "The GM decides your fate" | `hunter.js:436` |
| Dying | Natural 20 | Up at 1 HP | `settle` drops chip and saves | `hunter.js:434`, `113` |
| Dying, Fallen | GM Stabilize (button hidden for players) | Stable | `stable = true` only | `hunter.js:421,471` |
| Dying, Stable, Fallen | Any heal or HP set above 0 (heal, bar +1/Full, rest, room `hp`, combat `hunterHp`, item `heal` op, daily recover, level-up restore) | Up | `settle` drops chip and deletes saves, so the next drop starts at 0/0 | `hunter.js:266,275,401,158`, `quests.js:269`, `effects.js:50`, `hunter.js:113` |
| Dying, Stable, Fallen | More damage | unchanged | no failure added, `stable` kept | `hunter.js:265` |
| Stable, Fallen | Death save roll | refused (button disabled) | | `hunter.js:470` |
| Any at 0 HP | Remove Unconscious on the sheet, from an item `cureStatus`, or a room `status` remove | unchanged | `removeCondition` refuses | `hunter.js:288` |
| Any at 0 HP | Remove Unconscious on a local combat card | unchanged | `hunterStatuses` writes the list without it (`combat.js:67`), `settle` re-adds it and keeps the saves (pinned by `character.e2e.ts:124`) | `encounter.ts:193-198`, `hunter.js:112` |
| Up | Add Unconscious by hand (sheet select, combat, effect, room) | Up | `settle` removes it in the same emit | `hunter.js:286`, `113` |
| Any | GM "Edit max HP" | same situation | `hp` clamped to the new max, min 1 | `hunter.js:412` |
| Any | GM raw `hpAdj`, level loss, stat, title or gear change lowering `hpMax` | same, `hp` clamped | `settle` | `hunter.js:109` |
| Dying, Stable, Fallen | Short rest | Up (`+ceil(25% of max)`) | cooldowns reset | `hunter.js:275` |

There is no automatic death save at turn start in combat. The Unconscious description says "HP 0: make death saves each turn." (`statuses.ts:21`); the only roll is the sheet button.

### 2.4 Every guard on the three chips

| file:line | Guard |
|---|---|
| `hunter.js:288` | `removeCondition` refuses `unconscious` while `hp <= 0`. Comment: "every remover (sheet chip, cureStatus, room status events) lands here" |
| `hunter.js:419` | Sheet chip click refuses `penalized` |
| `hunter.js:476` | Sheet chip has no x for `penalized`, or for `unconscious` while `hp <= 0` |
| `hunter.js:477` | Sheet shows a `penalized` chip from `h.penalty` when the condition is missing |
| `hunter.js:358,473` | The sheet's Add condition select leaves out `penalized` |
| `gm.js:189` | GM board gives a remote card's chip an x except `unconscious` at `hp <= 0`. Local cards never get an x |
| `hunter.js:112,114` (`settle`) | Re-adds `unconscious` and `exhausted` after any remover, including combat's wholesale write |
| `status.ts:158` | `mods()` ignores `penalized` so the -2 is not counted twice |
| `quests.js:386` | The GM kind select offers `penalty` only when editing a penalty quest; players never see `penalty` or `job` (`quests.js:6`) |
| `room-events.ts:75` | A room `status` add first removes the same key (upsert); for `unconscious` at 0 HP the remove is refused and `addCondition` stacks onto it |

`exhausted` has no removal guard. Any remover takes it off, and `settle` puts it back only while fatigue is still 100.

## 3. Fatigue and collapse today

Rules (`rules.ts:32-33`): `penaltyAt: 50` gives -2 to checks (`hunter.js:93,102`); `disAt: 80` gives disadvantage on checks (`dice.js:113`) and on attacks (`combat.js:211`); `collapseAt: 100` adds `exhausted`. Short rest removes 25 fatigue; long rest removes 100 and clears Exhausted.

| Level | Situation | Effect | How the code knows |
|---|---|---|---|
| 0-49 | Fresh | none | `fatigue` compared at read time |
| 50-79 | Tired | -2 checks | `derived().fatiguePenalty` |
| 80-99 | Strained | -2 and disadvantage | `derived().fatigueDis` |
| 100 | Collapsed | same plus the `exhausted` chip | the chip, added by `settle` |

Writers: `hunter.js:276` (rest), `hunter.js:401` (bar: -10, -5, +5, +10, "Rest" sets 0, "Full" sets 100), `room-events.ts:61`, `combat.js:66` (`hunterFatigue`, from a GM change or a status's `fatigue` op at turn start, `combat.js:98`), `effects.js:54` (item or effect `fatigue` op, including the legacy `fatigue` field of items, `effects.ts:14-17`), `save.ts:312,491`.

| From | Event | To | Side effects | file:line |
|---|---|---|---|---|
| below 100 | Any write reaching 100 | Collapsed | `settle` adds Exhausted; sheet toast "You have collapsed from exhaustion." only from the bar | `hunter.js:114,405` |
| Collapsed | Short rest | fatigue 75, Exhausted kept | `settle` never removes it | `hunter.js:276,279` |
| Collapsed | Long rest | fatigue 0, Exhausted removed | | `hunter.js:276,278` |
| Collapsed | Bar "Rest" button | fatigue 0, Exhausted removed | no long rest needed | `hunter.js:401-402` |
| Collapsed | Bar -5/-10, item, combat or room change below 100 | fatigue lowered, Exhausted kept | | `hunter.js:401`, `effects.js:54`, `combat.js:66`, `room-events.ts:61` |
| any | Remove Exhausted by hand (chip x, cure, combat, room) | removed; back at once if fatigue is still 100 | | `hunter.js:288`, `112-114` |

Exhausted's description is "Collapsed: cannot act until a long rest." (`statuses.ts:20`). Nothing enforces "cannot act": the combatant keeps its turns and its buttons.

## 4. Penalty today

### 4.1 The three stores

1. `h.penalty: { since, days } | null` (`save.ts:84`). Drives the -2 on checks (`hunter.js:94,102`) and the GM board chip (`gm.js:198`).
2. A `penalized` condition in `h.conditions`. No effect on numbers (`status.ts:158`). Shown on the GM board's condition chips (`gm.js:188-191`), in combat status lists (`combat.js:33,595,648`) and to other phones through the sheet.
3. A quest `{ kind: 'penalty', status: 'active', title: 'Penalty Zone: Survive for 4 hours', objectives: [{ label: 'Hours survived', target: 4 }], from: 'system' }` (`quests.js:306-309`). Ending it is the only way to end the penalty.

### 4.2 The daily rollover

`checkDaily()` at `quests.js:286-331`. It runs at module start (`quests.js:654`), every 60 s (`655`), when the page becomes visible (`656`), every second while the Quests view is mounted if `todayKey()` differs from `world.lastDailyKey` (`630`), and from tests (`api.quests.checkDaily`).

1. Returns at once if the store is read-only (`287`).
2. The day key is `dayKey(now, settings.dailyResetHour)`: the local date shifted back by the reset hour (`quests.js:105-106`, `rules.ts:156-160`).
3. Skips the update when `world.lastDailyKey` is today and every hunter's `lastCheckedKey` is today and no urgent quest is overdue (`290`).
4. For each hunter whose `lastCheckedKey` is missing or earlier than today (a clock that went back is ignored, `294`):
   - With no previous key, it only records today (`296,314`).
   - `gap` = calendar days since the last check; `allDone` = the hunter has dailies and all are done; `days = allDone ? gap - 1 : gap` (`298-300`).
   - Every daily is reset to active with zero progress (`301`).
   - A penalty is issued when `tracked(h) && dailies.length && gap >= 1 && days >= 1` (`302`). `tracked(h)` is `!app.isGM() || !!h.daily.lastCompleteKey` (`285`): on a GM device a hunter who never completed a daily is a pre-made sheet and is never penalized. The role is read at rollover time.
   - The penalty sets `streak = 0`, adds `days` to an existing `h.penalty` or creates `{ since: now, days }`, pushes the `penalized` condition if missing, pushes a penalty quest only if no active one exists, logs, and queues a PENALTY window (`303-311,322-326`).
5. Overdue urgent quests fail in the same update (`316,327-330`).
6. `daily:reset` is emitted when any hunter rolled (`320`). Nothing listens to it.

A hunter with no daily quest is never penalized. The rules reference says "the System issues <b>one</b> penalty (even after several missed days)" (`rulesref.js:130`): one quest, while `days` keeps adding up.

The Quests view warning "Daily quest incomplete — penalty in HH:MM" shows when `tracked(h)` and an active daily exists (`quests.js:373-376`).

### 4.3 How a penalty ends

- Completing the penalty quest: `h.penalty = null` and the condition is filtered out (`quests.js:240`), window "PENALTY ZONE CLEARED" (`260`). It completes from the Complete button (`604`) or when the 4 hours are filled and the player confirms (`setProgress`, `505-506`).
- Deleting the penalty quest when no other active penalty quest is left: same clearing (`quests.js:616`).
- Days passing never end it; they only add to `days`.
- Failing the penalty quest does nothing to the penalty (`quests.js:274-281`). With no active penalty quest left, the next missed day adds a new one (`306`). "Reopen" makes the failed one active again (`609`).

### 4.4 Ways the three stores disagree

| Case | `h.penalty` | condition | active quest | Source |
|---|---|---|---|---|
| Penalty quest failed | set | present | none | `quests.js:277` |
| Penalized removed by a room `status` remove or an item `cureStatus` (only `unconscious` is guarded) | set | gone (sheet still shows the chip from `h.penalty`) | present | `hunter.js:288,477` |
| Penalized removed on a local combat card | set | gone until rollover re-adds it | present | `combat.js:67` |
| Penalized applied from combat, a room `status` event or an item (none of these filter it) | null | present, no -2, no x on the sheet, no way to clear it there | none | `hunter.js:286,419,476` |
| GM edits the penalty quest's kind to another kind | set | present | none of kind `penalty`; completing or deleting it no longer clears | `quests.js:482` |
| GM "Issue to…" copies a penalty quest to another hunter | null for that hunter | absent | present; completing it clears nothing that was set | `quests.js:520` |
| GM board, local hunter | shows "PENALTY xN" from `h.penalty` and a "Penalized" condition chip, side by side | | | `gm.js:191,198` |
| A sheet from another phone without `since` | repaired to the epoch | | | `save.ts:587-592` |

The repair (`save.ts:348-351`) checks only the shape of `h.penalty`; it does not compare the three.

## 5. Job change chain today

### 5.1 Issuing

`CHAIN_JOBS = ['Necromancer', 'Assassin', 'Mage', 'Tanker', 'Healer', 'Fighter', 'Ranger']`, `CHAIN_LEVEL = 10` (`quests.js:10-11`). The three steps are built by `chainStep(n, job)` (`quests.js:13-17`): step 1 "Reach Level 10" (objective target 10), step 2 "Survive dungeon waves" (target 3), step 3 "Defeat the Knight Captain" with `rewards: { job }`.

The GM's "Issue Job Change Quest" button (`quests.js:552,597`, hidden for players at `647`) calls `pickChain()` (`190-199`). It offers local hunters only (`store.get().hunters`); a remote player cannot get a chain, and the room `quest` offer has no chain fields (`QuestOffer` at `protocol.ts:85`). `issueJobChain(hid, job)` (`161-168`) refuses a job outside `CHAIN_JOBS`, issues step 1 with a new `chainId` (`store.id('c')`), `step: 1` and `chainJob: job`, then calls `syncChain()`. It does not check for a chain already running.

The tests pin these: at Lv 10 issuing moves straight to step 2 and shows QUEST COMPLETE (`gates-quests-dailies.e2e.ts:309-346`); every job works when issued at Lv 1, 10 or 30 (`348-370`).

### 5.2 Advancing

- Step 1: `syncChain()` (`quests.js:176-187`) runs on every `change`. For each active quest with `chainId` and `step === 1`, it sets objective 0's progress to `min(10, level)` in its own `store.update('chain-check')`, and calls `complete()` when it reaches 10. The level can also drop, and progress follows it down.
- Step 2 and 3 are completed by the player or GM like any quest.
- `complete()` (`232-272`) marks the quest done, then, when `q.chainId && q.step < 3 && q.chainJob`, issues the next step with the same `chainId` and `chainJob` (`251-253`). Completing step 1 by hand below level 10 is not refused, so the chain can skip the level check.

The `syncing` flag (`175-177,186`): `syncChain` writes to the store, which emits `change`, which calls `syncChain` again before the outer call finishes. The flag makes the nested call return at once. Without it, each `chain-check` update and each `complete()` inside the loop would re-enter the loop while the outer loop holds a stale quest list, calling `complete()` on the same quest again (the second call returns false on `status !== 'active'`) and recursing once per nested write. The comment at `quests.js:164` records the order this depends on: "chainJob goes in with the quest: at Lv 10+ the issue's own 'change' completes step 1 at once, and step 2 needs the job". So at Lv 10 step 1 completes inside `api.issue`'s own emit, before `issueJobChain` reaches its explicit `syncChain()`.

### 5.3 Failure, abandonment, deletion

There is no chain state, so these are plain quest operations:

- Fail on any step: the quest is failed and nothing else happens (`274-281`). The chain stops. "Reopen" brings the step back (`609`).
- Delete any step: removed, the chain stops (`614-615`).
- Edit (GM or player): `Object.assign` keeps `chainId`, `step` and `chainJob` (`482`), but the GM can change `kind` and `rewards.job` on step 3. The next step is still issued from `chainJob`, while step 3 grants whatever `rewards.job` says.
- "Issue to…" copies a step without chain fields (`520`); a copied step 3 still grants its job.
- Two chains for one hunter can run side by side.

### 5.4 Granting the job

Completing step 3 calls `applyRewards(h.id, { ...q.rewards }, 'quest', { popup: false })` (`quests.js:265`). That sets `h.job` and, for an extract job, `canExtract` (`hunter.js:246`). `quests.js:266` sets `canExtract` again for the same condition. The window is "JOB CHANGE COMPLETE / You are now a {job}." when `q.kind === 'job' && r.job` (`259`). Among `CHAIN_JOBS` only Necromancer is in `extractJobs`. Any job quest made by hand with a job reward grants the job the same way.

## 6. Leveling and ability points today

### 6.1 XP to levels

`grantXP(hid, n, source)` (`hunter.js:148-164`), inside one `store.update('xp')`:

- `xp += n`.
- While `xp >= xpToNext(level)` (`100 * level`, `rules.ts:106`): subtract it, `level++`, `pts += pointsPerLevel` (3, `rules.ts:15`).
- While `xp < 0 && level > 1`: `level--`, `xp += xpToNext(level)`, `pts -= 3`.
- `xp = max(0, xp)`; `points = max(0, points + pts)`.
- If the level went up: restore HP and MP to max (`levelUpRestore`).
- Emits `xp` (no listener) and `levelup` (`custom.js:120` vibrates).

Rank does not change; a "Re-evaluate" button appears when `rankForLevel(level)` is above `rank` (`hunter.js:171-180,449`). Callers: `gainXP` (the sheet's GM +10/+50/+100 buttons, `hunter.js:390`) and `applyRewards` (`hunter.js:255`), which is called by quests (`quests.js:265`), gates (`gates.js:160`), combat awards (`combat.js:408`), the GM award form (`gm.js:376`) and the room `award` event (`room-events.ts:37`).

### 6.2 Points granted and spent

Granted: 3 per level in `grantXP`; `rewards.points` in `applyRewards` (quest rewards, the daily's 1 point at `rules.ts:41`, the streak bonus of 1 every 7 days at `quests.js:245,254`, GM awards); the GM's "+1 point" (`hunter.js:531`); the GM raw edit (`709`). Spent: `+` on a stat (`523`) or build auto-place (`custom.js:309`). Undone: `-` on a stat above `statsLocked` returns the point (`526`). Locked: Confirm (`530`) or leaving the Status view (`718-721`).

There is one counter, `points`. Nothing records which levels have paid out.

### 6.3 XP loss

Levels drop as in 6.1 and their points are subtracted from the unspent counter, floored at 0 (`hunter.js:155`). Spent points stay in the stats. HP and MP are clamped by `settle` to the lower maxima. Rank stays. `character.e2e.ts:184-211` pins two behaviours the fix must keep: "+500 then -500 XP returns level and points" and "losing levels with one unspent point left leaves 0 points".

### 6.4 Bug 1, step by step

Start: Lv 1, 0 XP, 0 points, STR 10.

1. Award +500 XP. `xp = 500`; 500 >= 100 gives Lv 2, `xp = 400`; 400 >= 200 gives Lv 3, `xp = 200`; 200 < 300 stops. `points = 6`. HP and MP refilled (`hunter.js:152-158`).
2. Spend 6 points on STR and confirm. STR 16, `statsLocked.str = 16`, `points = 0` (`hunter.js:523,530`).
3. Award -500 XP. `xp = -300`; Lv 2, `xp = -100`, `pts = -3`; Lv 1, `xp = 0`, `pts = -6`. `points = max(0, 0 - 6) = 0`. STR stays 16 (`hunter.js:154-155`).
4. Award +500 XP. Lv 3 again and `points = 6` (`hunter.js:153`), with HP and MP refilled again (`158`).

The wrong step is `hunter.js:155`: `h.points = Math.max(0, h.points + pts)`. The 6 points owed back on level loss are dropped because they were already spent, and `hunter.js:153` then pays levels 2 and 3 a second time because no record says they were paid. The test is `test.fixme('ability points cannot be farmed by gaining levels, spending the points, losing the levels and regaining them', ...)` at `gates-quests-dailies.e2e.ts:459`. Bugs-found.md says: "Fix in M7 with the hunter model (track points granted per level, not a counter). Then remove the fixme."

A related effect of the same code: an XP yo-yo (+XP, -XP, +XP) also refills HP and MP each time a level is regained, since `levelUpRestore` runs on any level above `from`.

## 7. What other modules call

### 7.1 `app.api.hunter` (`hunter.js:183-290`)

| Function | Callers outside hunter.js | What it does |
|---|---|---|
| `deleteHunter(hid)` | none (sheet and party panel) | Typed-name confirm, backup, room `forget`, removes the hunter |
| `parseAmount`, `amountMsg`, `amountFromKey`, `AMT_*` | `gm.js:651-658`, `table.js:165-175` | Parse "7" / "+5" HP entries |
| `derived(h)` | 16 sites: `combat.js:43,54,63,126,131,209,225`, `custom.js:377`, `gm.js:103`, `shadows.js:9,49`, `dice.js:108`, `inventory.js:178`, `quests.js:268`, `table.js:106`, `starter.js:51`, `effects.js:46`, `room-events.ts:57` | Maxima, mods, AC, check bonus, fatigue and penalty modifiers |
| `gainXP(hid, n)` | none | `grantXP` plus a popup or toast |
| `applyRewards(hid, rw, source, opts)` | `quests.js:265`, `gates.js:160`, `combat.js:408`, `gm.js:376`, `room-events.ts:37` | Points, titles, skills, job, build reward, gold, items, then XP |
| `damage(hid, n)`, `heal(hid, n)` | `room-events.ts:55`, `gm.js:655,682`, `table.js:170`, `effects.js:50` (heal) | Clamped HP change |
| `spendMp(hid, n)` | `skills.js:47`, `shadows.js:83` | MP cost, false when short |
| `rest(kind, hid)` | none | Short or long rest |
| `eligibleRank`, `canReeval`, `reevaluate` | none | Rank re-evaluation |
| `grantTitle` | none | Adds a title |
| `addCondition(hid, key, rounds, def)` | `effects.js:61`, `room-events.ts:76` | `applyStatus` onto the list |
| `removeCondition(hid, key)` | `effects.js:65`, `room-events.ts:75,83` | Removes a key, refusing Unconscious at 0 HP |
| `hasCondition` | none | |

### 7.2 `app.api.quests` (`quests.js:143-172`)

| Function | Callers | What it does |
|---|---|---|
| `issue(hids, partial)` | `sync.js:114` (room `quest` event via `issueQuest`), `starter.js:55`, `gm.js:420`, and inside quests.js | Creates a cleaned quest per hunter, chain fields included when given |
| `checkDaily()` | tests | The rollover in 4.2 |
| `issueJobChain(hid, job)` | `pickChain`, tests | Step 1 of a chain |
| `complete(hid, qid)` | tests | See 5.2 and 4.3 |
| `fail(hid, qid)` | none outside | Marks failed |
| `nextReset()` | none outside | Next reset time for the countdown |

### 7.3 Events

| Event | Emitted at | Listened at |
|---|---|---|
| `change` | `app.js:246` on every store write | `settle` (`hunter.js:117`), `syncChain` (`quests.js:188`), `resetCooldowns` on `'rest'` (`skills.js:61`), plus renderers and sync push |
| `xp` | `hunter.js:161` | none |
| `levelup` | `hunter.js:162` | `custom.js:120` |
| `quest:done` | `quests.js:249` | `custom.js:121` |
| `quest:failed` | `quests.js:278,328` | none |
| `daily:reset` | `quests.js:320` | none |
| `combat:turn` | `combat.js:80` | `skills.js:60` (cooldowns), `custom.js:122` |
| `sync:event` `questUpdate` | room | `quests.js:219-229` (GM log and toast) |
| `view` (leaving Status) | app | `hunter.js:718-721` confirms allocations |
| Room `hp` / `status` | GM's `sendHp` (`gm.js:279`), combat `sendRemote` (`combat.js:109-121`) | `room-events.ts:49-86` on the player's phone |

## 8. Open questions

1. A fallen hunter. `hunter.js:436`: "Three failures: you have fallen. The GM decides your fate." Nothing else happens, and any heal brings the hunter back. Is a Dead state wanted, and what may a GM do from it?
2. Death saves in combat. `statuses.ts:21`: "HP 0: make death saves each turn." No turn-start roll exists, and a dying hunter's combatant stays `'up'` and keeps its turn. Intended?
3. Damage while dying or stable adds no failure and keeps `stable`. Intended, or not yet built?
4. Exhausted. `statuses.ts:20`: "Collapsed: cannot act until a long rest." The fatigue bar's "Rest" button (`hunter.js:401-402`) clears it without a rest, and nothing stops the hunter acting. Which is meant?
5. Penalized without a penalty. `status.ts:154`: "Penalized is left out: the daily penalty applies it." A `penalized` chip from combat, a room event or an item gives no -2 and cannot be removed on the sheet. Should those paths be able to apply it at all?
6. A failed penalty quest leaves the penalty on with no quest to clear it until the next missed day. Intended?
7. `penalty.days` adds up across missed days but changes nothing except the GM chip's "xN". `rulesref.js:130` says one penalty is issued "even after several missed days". What is `days` for?
8. GM role at rollover. `quests.js:284`: "a GM device holds NPCs and pre-made sheets nobody trains with: no penalty until that hunter has completed a daily once". `tracked` reads `app.isGM()` at rollover time, so a phone that switches role changes who gets penalized for the days already passed.
9. Rank after level loss: kept (`hunter.js:172` re-evaluates only upward). Intended?
10. `canExtract` is never cleared when the job changes. Intended?
11. Step 1 of a chain can be completed by hand below level 10, and step 3's job comes from `rewards.job`, which the GM edit form can change, not from `chainJob`. Which one is the chain's job?
12. Remote Unconscious on the GM's side. `gm.js:189`: "the phone refuses that removal while HP <= 0". Removing it on a remote combat card drops it from the GM's row (`encounter.ts:199`), and `syncRemote` carries no statuses (`encounter.ts:297-303`), so the GM's card and the player's sheet may disagree for the rest of the fight. `character.e2e.ts:142` checks only the player's side.
13. The GM raw level edit (`hunter.js:707`) grants no points and does not refill HP. With points granted per level, should a raw level edit grant them?
