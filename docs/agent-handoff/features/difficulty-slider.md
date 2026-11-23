# Difficulty Slider: Design

## 1. Goal and Scope

the owner asked for a 1 to 10 difficulty slider on dungeons (gates) and bosses so bosses feel hard by default and the GM can tune difficulty up or down alongside manual monster stat edits (`docs/agent-handoff/questionable-decisions.md` row 8).

Anchors from the owner:
- Difficulty 1: three same-rank hunters win about 95% of the time against one same-rank boss.
- Difficulty 5 (default): three same-rank hunters win about 75% of the time.
- Difficulty 10: three same-rank hunters win about 5% of the time.
- The GM can still edit a boss's stats in the Bestiary before the fight.

Scope of this unit (`difficulty-slider`):
1. Store gate difficulty and optional boss difficulty override on `Gate` with one pure writer and an explicit state machine.
2. Put the difficulty curve, target win percentages, HP/damage split, pack curve, and per-rank calibration factors in `RULES.fight.difficulty` with full `Domain` and `overrides.ts` validation.
3. Apply difficulty scaling multiplicatively over the GM's edited monster stats when a gate starts a fight or runs as a solo gate (local or remote).
4. Add compact, self-explaining difficulty slider controls on the GM spawn forms (`src/views/gates.js`, `src/views/gm.js`), gate card, and gate edit panel without editing existing copy owned by `plain-copy`.
5. Hold the curve with balance simulation rows in `tests/fight-sim.test.ts`, a table test for the state machine, a generated Mermaid chart via `bun run charts`, an e2e test reading numbers from `RULES`, and 390 px screenshots under `docs/agent-handoff/ui-pass/difficulty-slider/`.

Non-goals:
- Do not change `RULES.fight.kinds.boss` base values (that would break existing unscaled boss rows in `tests/fight-sim.test.ts`).
- Do not put difficulty on `Monster` entries in the Bestiary (one boss entry can appear in multiple gates at different difficulties).
- Do not scale personal gates (`Hunter.solo.gates`, System-generated with normal packs and no boss).
- Do not change gate XP or loot rewards by difficulty (recorded as a questionable decision in Section 9).
- No new dependencies.

---

## 2. Data Shape (First)

### 2.1 Core Types (`src/core/gates/difficulty.ts`)

```ts
export const DIFFICULTY_MIN = 1;
export const DIFFICULTY_MAX = 10;
export const DIFFICULTY_DEFAULT = 5;

export const DIFFICULTY_LEVELS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const;
export type DifficultyLevel = (typeof DIFFICULTY_LEVELS)[number];

export const GATE_DIFFICULTY_STATES = ['default', 'set'] as const;
export type GateDifficultyState = (typeof GATE_DIFFICULTY_STATES)[number];

export const BOSS_DIFFICULTY_STATES = ['follows', 'own'] as const;
export type BossDifficultyState = (typeof BOSS_DIFFICULTY_STATES)[number];

/** Whether a gate uses the rule's default difficulty or a level explicitly set by the GM. */
export type GateTrack =
  | { readonly at: 'default' }
  | { readonly at: 'set'; readonly level: DifficultyLevel };

/** Whether a gate's boss follows the gate's difficulty or carries its own override. */
export type BossTrack =
  | { readonly at: 'follows' }
  | { readonly at: 'own'; readonly level: DifficultyLevel };

/** Explicit two-region state stored on `GateFields.difficulty`. */
export type GateDifficulty = {
  readonly gate: GateTrack;
  readonly boss: BossTrack;
};

export const DEFAULT_DIFFICULTY: GateDifficulty = {
  gate: { at: 'default' },
  boss: { at: 'follows' },
};

/** Multiplicative HP and outgoing-damage factors applied to a monster row entering a fight. */
export type DifficultyScale = {
  readonly hp: number;
  readonly dealt: number;
};

export const DIFFICULTY_EVENTS = ['setGate', 'resetGate', 'setBoss', 'followGate', 'bossRemoved'] as const;
export type DifficultyEventType = (typeof DIFFICULTY_EVENTS)[number];

export type DifficultyEvent =
  | { readonly type: 'setGate'; readonly level: DifficultyLevel }
  | { readonly type: 'resetGate' }
  | { readonly type: 'setBoss'; readonly level: DifficultyLevel }
  | { readonly type: 'followGate' }
  | { readonly type: 'bossRemoved' };
```

### 2.2 Storage Location and One Writer

- **Where stored:** `GateFields.difficulty: GateDifficulty` in `src/core/gates/gate.ts`, persisted inside `save.gates`.
- **Save compatibility:** Existing saves without a `difficulty` property parse through `parseGate` -> `parseGateDifficulty(value.difficulty)` into `DEFAULT_DIFFICULTY`.
- **The one writer:** `src/core/gates/difficulty.ts`.
  - `difficultyStep(state: GateDifficulty, event: DifficultyEvent): GateDifficulty | null` is the pure reducer.
  - `withDifficulty(gate: Gate, events: readonly DifficultyEvent[]): Gate` applies events to a newly rolled or edited gate (called from `src/views/gates.js` `roll` and `src/core/gates/world.ts` `editGate`).
  - `gateDifficulty(save: Save, gateId: GateId, event: DifficultyEvent): Save | Refused<'missing' | 'gate-done' | 'refused'>` writes a single standalone event to a save gate (used if live difficulty controls write outside the edit form).
  - `src/core/gates/gate.ts` only initializes `DEFAULT_DIFFICULTY` in `newGate()`, reads `parseGateDifficulty(value.difficulty)` in `parseGate()`, and preserves `difficulty: gate.difficulty` in `fieldsOf()`.
  - Enforced by a new one-writer lint test in `tests/lint.test.ts` (`only src/core/gates/difficulty.ts writes a gate's difficulty`), matching the existing `only src/core/gates/preset.ts writes a gate's preset` test (`owners = ['src/core/gates/difficulty.ts', 'src/core/gates/gate.ts']`).

### 2.3 Rule Shape (`RULES.fight.difficulty` in `src/core/rules.ts`)

```ts
// Domain definitions in src/core/rules.ts:
const DIFFICULTY_LEVEL = wholeDomain(1, 10, 'gate or boss difficulty level, 1 to 10');
const DIFFICULTY_WIN_PCT = wholeDomain(1, 99, 'expected three-hunter win chance in percent for one difficulty step');
const DIFFICULTY_FACTOR = realDomain(0.1, 20, 'combined HP-times-damage difficulty multiplier for one step or rank');
const DIFFICULTY_SPLIT = realDomain(0, 1, 'share of the difficulty factor placed on max HP; the rest goes to outgoing damage');

// Under RULES.fight:
difficulty: {
  default: of(5, DIFFICULTY_LEVEL),
  /**
   * Share of combined factor `k` placed on max HP (`hp = k^hpExponent`, `dealt = k^(1 - hpExponent)`).
   * Equal split (0.5) stretched boss fights to 11-13.5 rounds. At 0.35, 3-hunter boss fights stay around
   * 8-11 rounds while spanning 95% to 5% win rates across all ranks.
   */
  hpExponent: of(0.35, DIFFICULTY_SPLIT),
  /**
   * Displayed 3-hunter expected win chance (%) for levels 1..10.
   * Anchors from the owner (QD row 8): 1 = 95%, 5 = 75%, 10 = 5%.
   * Straight lines between anchors: -5 points per step for 1..5, -14 points per step for 5..10.
   */
  targets: each([95, 90, 85, 80, 75, 61, 47, 33, 19, 5], DIFFICULTY_WIN_PCT),
  /**
   * Combined difficulty factor `k` for `kind === 'boss'` at levels 1..10 (calibrated at Rank C, then
   * normalized per rank by `rankScale`). Today's unscaled boss (k = 1.0) loses 100% of fights to 3
   * same-rank hunters, so even level 1 sits above 1.0.
   */
  boss: each([2.55, 2.70, 2.82, 2.92, 3.02, 3.16, 3.30, 3.52, 3.88, 4.60], DIFFICULTY_FACTOR),
  /**
   * Combined difficulty factor `k` for non-boss monsters (`normal`, `elite`) and `mythic` bosses placed
   * in a gate. Centered at 1.0 at default level 5 so existing balanced pack fights and M1/B1 mythic
   * odds (5-10% win rate) stay untouched by default, while levels 1..4 soften and 6..10 harden them.
   */
  pack: each([0.72, 0.79, 0.86, 0.93, 1.00, 1.12, 1.24, 1.38, 1.54, 1.72], DIFFICULTY_FACTOR),
  /**
   * Per-rank multiplier on `boss[level - 1]` so all six ranks hit the 95/75/5% anchors instead of
   * drifting ~30 percentage points from E to S (high-rank brute armor outscales capped cannon mana).
   */
  rankScale: {
    E: of(1.04, DIFFICULTY_FACTOR),
    D: of(0.95, DIFFICULTY_FACTOR),
    C: of(1.00, DIFFICULTY_FACTOR),
    B: of(0.95, DIFFICULTY_FACTOR),
    A: of(0.85, DIFFICULTY_FACTOR),
    S: of(0.85, DIFFICULTY_FACTOR),
  },
},
```

In `src/core/overrides.ts`, register list readers in `READERS`:
- `'fight.difficulty.targets': numbers(10)`
- `'fight.difficulty.boss': numbers(10)`
- `'fight.difficulty.pack': numbers(10)`

Every scalar leaf (`default`, `hpExponent`, `rankScale.E..S`) is automatically validated by its `Domain` in `rules.ts`.

---

## 3. Two Candidate Shapes and Decision

### Shape A (Recommended): Explicit Two-Region State on `Gate.difficulty` with Dedicated Writer Module

```ts
// src/core/gates/difficulty.ts
export type GateTrack =
  | { readonly at: 'default' }
  | { readonly at: 'set'; readonly level: DifficultyLevel };

export type BossTrack =
  | { readonly at: 'follows' }
  | { readonly at: 'own'; readonly level: DifficultyLevel };

export type GateDifficulty = { readonly gate: GateTrack; readonly boss: BossTrack };

export function difficultyStep(state: GateDifficulty, event: DifficultyEvent): GateDifficulty | null;
export function withDifficulty(gate: Gate, events: readonly DifficultyEvent[]): Gate;
export function gateDifficulty(save: Save, gateId: GateId, event: DifficultyEvent): Save | Refused<DifficultyRefusal>;
export function effectiveGateLevel(d: GateDifficulty, R: Pick<Rules, 'fight'>): DifficultyLevel;
export function effectiveBossLevel(d: GateDifficulty, R: Pick<Rules, 'fight'>): DifficultyLevel;
export function difficultyFactor(kind: MonsterKind, rank: Rank, level: DifficultyLevel, R: Pick<Rules, 'fight'>): DifficultyScale;
export function scaleMonsterForGate(m: RowMonster, gate: Pick<Gate, 'rank' | 'difficulty'>, role: 'pack' | 'boss', R: Pick<Rules, 'fight'>): RowMonster;
```

### Shape B (Alternative): Flat Numeric Fields on `GateFields`, Mutated Inside `world.ts`

```ts
// src/core/gates/gate.ts
export type GateFields = {
  // ...existing fields...
  difficulty: DifficultyLevel;        // default 5
  bossDifficulty: DifficultyLevel | null; // null = follows gate
};

// src/core/gates/world.ts
export type GateEdit = {
  // ...existing fields...
  difficulty: DifficultyLevel;
  bossDifficulty: DifficultyLevel | null;
};
// Mutated directly inside editGate() and gates.js roll(), with no separate reducer.
```

### Choice (5 lines)

We pick **Shape A**.
1. Shape A separates an untouched default (`gate.at === 'default'`) from a GM-pinned level 5 (`gate.at === 'set', level: 5`), so changing `RULES.fight.difficulty.default` updates unedited gates without overwriting pinned ones.
2. Shape A isolates every write to `Gate.difficulty` in one module (`src/core/gates/difficulty.ts`), enforceable by a one-writer lint identical to `Gate.preset`.
3. Shape A models `bossRemoved` in the reducer table so clearing a gate's boss never leaves a hidden stale boss override behind.
4. Shape A maps directly onto a clean two-region Mermaid state chart (`scripts/charts/difficulty.ts`) with no sentinel `null`s or hidden boolean flags.
5. Shape B blurs default vs pinned 5, scatters writes across `world.ts` and `gates.js`, and allows orphaned `bossDifficulty` values when `bossId` is cleared.

---

## 4. Explicit State Machine, Transition Table, and Chart

### 4.1 Honest Assessment of Statefulness

There is a real, small, stateful machine here:
- Region 1 (`gate`): `default` (tracks `RULES.fight.difficulty.default`) vs `set` (pinned to a specific `DifficultyLevel` 1..10).
- Region 2 (`boss`): `follows` (tracks the gate's effective difficulty) vs `own` (pinned to its own `DifficultyLevel` 1..10).

Product state count: `2 x 2 = 4` abstract states (`default/follows`, `set/follows`, `default/own`, `set/own`). Keeping `gate` and `boss` as two explicit sub-tables inside `difficultyStep` avoids cross-region duplication while enforcing every invariant.

### 4.2 Transition Tables

**Region 1: `GATE_TABLE` (`gate.at` x event)**

| State (`gate.at`) | `setGate(level)` | `resetGate` | `setBoss(level)` | `followGate` | `bossRemoved` |
|---|---|---|---|---|---|
| `default` | `set(level)` (if valid 1..10, else refused) | `null` (refused, already default) | unchanged | unchanged | unchanged |
| `set(k)` | `set(level)` (if `level !== k` and valid 1..10; `null` if unchanged) | `default` | unchanged | unchanged | unchanged |

**Region 2: `BOSS_TABLE` (`boss.at` x event)**

| State (`boss.at`) | `setGate(level)` | `resetGate` | `setBoss(level)` | `followGate` | `bossRemoved` |
|---|---|---|---|---|---|
| `follows` | unchanged | unchanged | `own(level)` (if valid 1..10, else refused) | `null` (refused, already following) | `null` (no-op when already following) |
| `own(k)` | unchanged | unchanged | `own(level)` (if `level !== k` and valid 1..10; `null` if unchanged) | `follows` | `follows` |

Notes on edge cases:
- `difficultyStep` returns `null` when an event is refused (invalid level outside 1..10, non-integer, or no-op in the current state).
- `setGate` at level 5 from `default` transitions to `{ at: 'set', level: 5 }`. Setting level 5 again from `{ at: 'set', level: 5 }` returns `null` (unchanged).
- `withDifficulty(gate, events)` applies events sequentially, silently skipping any event where `difficultyStep` returns `null` (so `editGate` can always append `{ type: 'bossRemoved' }` when `edit.bossId === null` without failing if `boss` was already `follows`).
- `gateDifficulty(save, gateId, event)` refuses `'missing'` if the gate is absent, `'gate-done'` if `gate.status === 'cleared' || gate.status === 'closed'`, and `'refused'` if `difficultyStep` returns `null`.

### 4.3 Table Test Plan (`tests/difficulty.test.ts`)

1. **Exhaustive transition table test:** iterate every pair of `(gateState in ['default', 'set(5)', 'set(7)'], bossState in ['follows', 'own(5)', 'own(9)'])` against every event in `DIFFICULTY_EVENTS` (`setGate(3)`, `setGate(5)`, `setGate(7)`, `setGate(0)`, `setGate(11)`, `setGate(5.5)`, `resetGate`, `setBoss(9)`, `setBoss(8)`, `setBoss(0)`, `followGate`, `bossRemoved`) and assert the exact next `GateDifficulty` or `null`.
2. **Boundary parser (`parseGateDifficulty`):** valid shapes, missing/undefined (old save migration -> `DEFAULT_DIFFICULTY`), out-of-range levels (`0`, `11`, `NaN`, `Infinity`, floats, strings), unknown `at` tags, partial objects (`gate` valid + `boss` junk keeps valid `gate` and resets `boss` to `follows`).
3. **Effective level and scaling math (`effectiveGateLevel`, `effectiveBossLevel`, `difficultyFactor`, `scaleMonsterForGate`):**
   - Rule override of `RULES.fight.difficulty.default` moves `default` gates and `follows` bosses, and does not move `set` gates or `own` bosses.
   - `kind === 'normal'`, `'elite'`, `'mythic'` at level 5 return `{ hp: 1, dealt: 1 }`.
   - `kind === 'boss'` scales strictly monotonically across levels 1..10 for every rank `E..S`.
   - Multiplicative composition with GM Bestiary edits: a boss with `tweak: { hp: 2, stats: { str: 6 }, traits: ['armored'] }` keeps `stats` and `traits` intact and gets `hp = 2 * s.hp`, `dealt = 1 * s.dealt`.
4. **Save writer (`gateDifficulty` and `editGate`):** refuses missing gate and cleared/closed gate; `editGate` with `bossId: null` triggers `bossRemoved` and clears `boss.at === 'own'` back to `'follows'`.
5. **Copy helper (`DIFFICULTY_WORDS`):** every level 1..10 produces a full phrase naming the level, scale (`of 10`), and exact win percentage read from `RULES.fight.difficulty.targets`.

### 4.4 State Chart (`scripts/charts/difficulty.ts`)

- Register `gateDifficulty` in `scripts/statecharts.ts` `MACHINES` right next to `gate` and `clearPreset`.
- Walk `difficultyStep` via `bfs` from `[DEFAULT_DIFFICULTY]` using representative levels (`setGate(7)`, `resetGate`, `setBoss(8)`, `followGate`, `bossRemoved`).
- `kinds`: `[...GATE_DIFFICULTY_STATES, ...BOSS_DIFFICULTY_STATES]` (`['default', 'set', 'follows', 'own']`).
- `kindsOf(s)`: `[s.gate.at, s.boss.at]`.
- Parallel regions view (`{ 'Gate difficulty': ..., 'Boss difficulty': ... }`), matching `scripts/statecharts.ts` `Shape` support.
- Update `docs/state-machines.md` via `bun run charts` and verify with `tests/statecharts.test.ts`.

---

## 5. Every System Traced

### 5.1 How GM Stat Edits and Difficulty Combine

Decision: **Difficulty scales multiplicatively from the GM's edited base.**

Trace:
1. The GM edits a monster in Bestiary (`src/views/bestiary.js` -> `save.monsters`): custom `stats` bonus, `traits`, `tweak.hp` (up to `MONSTER_BOUNDS.hp = 10`), `abilities`, `statuses`.
2. `monsterSheet` (`src/core/hunter/derive.ts`) builds the monster's base stats from rank + archetype + `tweak.stats` + `tweak.traits`, then multiplies `hpMax` by `tweak.hp`.
3. When the monster enters a fight from a gate, `scaleMonsterForGate` computes `{ hp, dealt } = difficultyFactor(m.kind, gate.rank, level, R)` and multiplies into the row's tweak:
   `tweak = { ...t, hp: t.hp * scale.hp, dealt: t.dealt * scale.dealt }`.
4. `monsterRows` (`src/core/combat/rows.ts`) builds the `NewRow` with that `tweak`. `standing.ts` (`dealtBy`) already multiplies every outgoing monster damage roll by `origin.tweak.dealt` in both `resolve.ts` and `land.ts` (outside `kit.shareCap`), and `derive.ts` multiplies `hpMax` by `origin.tweak.hp`.
5. On a solo run, `soloFight` (`src/core/gates/solo.ts:251`) multiplies `harder` (`sqrt(R.solo.autoHarder)`) on top of the gate-scaled `RowMonster`, so GM edit, gate/boss difficulty, and solo auto-harder compose cleanly without overwriting each other.

**Critical bug avoided (`src/core/combat/fight-parse.ts:687`):**
Today `tweakOf` in `fight-parse.ts` caps `tweak.hp` and `tweak.dealt` at `10` (`num(v.hp, 0, 10)`). If a GM sets a custom boss to `HP x 6` in Bestiary (`MONSTER_BOUNDS.hp = 10`) and runs it in a difficulty 10 gate (`hp ~ 1.78x`), `tweak.hp` reaches `10.68`, which would cause `parseFight` to reject the saved fight and drop it on reload.
Fix: raise the upper bound in `fight-parse.ts` `tweakOf` for `hp` and `dealt` from `10` to `100` (sufficient for `MONSTER_BOUNDS.hp (10) * difficulty 10 (~3) * mythic script (~2) = 60`, with margin). Keep `MONSTER_BOUNDS.hp = 10` unchanged in `src/core/registry/monsters.ts` so Bestiary inputs stay bounded.

**Critical bug avoided (`src/views/bestiary.js:46-52`):**
`api.bestiary.toCombatant(monster, n)` runs `parseMonster(m)` before calling `monsterRows(...)`. `parseMonster` strips `tweak.dealt` (not part of `MonsterTweak`) and clamps `tweak.hp` to `10`.
Fix: extend `BestiaryApi['toCombatant']` in `src/core/api.ts` and `src/views/bestiary.js` to accept an optional third argument `scale?: DifficultyScale`:
```ts
toCombatant(monster: Monster | string, n?: number, scale?: DifficultyScale): JoinRow[];
```
Inside `toCombatant`, call `parseMonster(m)` first, then apply `scaleRowMonster(one, scale)` before `monsterRows(...)`. Bestiary calls without `scale` behave identically to today.

### 5.2 Gate Spawn (`src/core/gates/spawn.ts`, `src/views/gates.js`, `src/views/gm.js`, `src/core/api.ts`)

- `spawn.ts` `rollGate`: unchanged (difficulty is a GM choice, not randomly rolled).
- `GatesApi` in `src/core/api.ts`: add optional `difficulty?: DifficultyLevel` to `spawn(o?)` and `roll(o?)`.
- `src/views/gates.js` `roll({ rank, type, name, difficulty } = {})`: after building `g` via `parseGate(...)`, if `difficulty !== undefined && difficulty !== R.fight.difficulty.default`, return `withDifficulty(g, [{ type: 'setGate', level: difficulty }])`. Leaving the slider at default 5 keeps `gate: { at: 'default' }`.
- `src/views/gm.js` `doSpawn()`: reads the GM spawn shortcut's difficulty slider and passes `difficulty` to `A().gates.spawn(...)`.

### 5.3 Fight Start (`src/views/gates.js`, `src/views/combat.js`)

- `src/views/gates.js` `startEncounter(id)` (lines 98 to 106):
  - For each pack line `m` in `g.monsters`: look up `mo = monsterOf(m.monsterId)`, compute `scale = mo ? difficultyFactor(mo.kind, g.rank, effectiveGateLevel(g.difficulty, R), R) : undefined`, and call `api.bestiary.toCombatant(m.monsterId, m.count, scale)`.
  - For `g.bossId`: look up `boss = monsterOf(g.bossId)`, compute `scale = boss ? difficultyFactor(boss.kind, g.rank, effectiveBossLevel(g.difficulty, R), R) : undefined`, and call `api.bestiary.toCombatant(g.bossId, 1, scale)`.
  - Note on `boss` vs `rank`: `difficultyFactor` uses `mo.rank` (the monster's own rank) for `rankScale[mo.rank]` so an S-rank boss placed in an A-rank gate gets S-rank calibration. (Verify: if a gate's boss has the gate's rank, `mo.rank === g.rank`; if the GM manually swaps in a higher-rank boss, calibrating by `mo.rank` keeps that monster's armor/mana ratio accurate.)
- `src/views/combat.js`: no changes needed! `startFlow` already accepts `JoinRow[]` and passes each `NewRow` straight into the fight reducer. The fight's odds box (`odds-box.js`) automatically reads the scaled `origin.tweak` from the running/setup fight rows.

### 5.4 Save Parsing and Persistence (`src/core/gates/gate.ts`, `src/core/save.ts`)

- `save.ts` already parses every gate through `parseGate` (`gate.ts`).
- `parseGate` reads `difficulty: parseGateDifficulty(value.difficulty)`.
- Old saves without `difficulty` load cleanly with `DEFAULT_DIFFICULTY`.
- Corrupted `difficulty` values fall back cleanly per track (`gate` to `default`, `boss` to `follows`).

### 5.5 Room Protocol: Do Players See Difficulty? (`src/core/gates/gate.ts`, `src/core/gates/world.ts`, `src/core/gates/solo.ts`, `src/core/protocol.ts`)

**Decision: Players do NOT see gate or boss difficulty.**

1. **`WorldDoc` / `ShownGate` (`gate.ts`, `protocol.ts`):**
   - `shownOf(g, nameMax)` stays unchanged and omits `difficulty` (same privacy boundary as `Gate.preset` and GM dice `fudge`).
   - Players' gate cards (`sharedCard` in `gates.js`) show no difficulty text or slider.
   - Multi-GM `mergeWorld` (`world.ts`): keeps each GM phone's local `difficulty` on matching gates and gives newly merged gates `DEFAULT_DIFFICULTY` (same as `preset` and `solo`).
2. **Solo runs of world gates (`solo.ts`, `protocol.ts`):**
   - **Local solo run (`soloReady`, `solo.ts:236-238`):** `roster` scales pack lines with `effectiveGateLevel` and the boss line with `effectiveBossLevel` via `scaleMonsterForGate`, before `soloFight` applies `harder`.
   - **Remote solo run (`soloDoc` in `solo.ts:430-459` and `SoloDocLine` in `protocol.ts:852`):**
     - Extend `SoloDocLine` to `{ m: string; n: number; hp?: number; dealt?: number }`, omitting `hp` and `dealt` when `1`, and rounding to 3 decimals (e.g. `1.469`, `2.042`).
     - Validate `hp` and `dealt` in `protocol.ts` as optional finite numbers in `(0, 100]`.
     - In `soloDoc`, compute `scale = difficultyFactor(m.kind, m.rank, level, R)` for each roster line (boss line uses `effectiveBossLevel`, pack lines use `effectiveGateLevel`) and attach `hp`/`dealt` only when not equal to `1`.
     - In `soloTargets`, apply `l.hp` and `l.dealt` to each line's `RowMonster.tweak` so `soloFight` and the solo odds box play the real scaled encounter without exposing any difficulty slider or requiring `RULES.fight.difficulty` in `RoomRules`.
     - Two solo gates referencing the same `monsterId` at different difficulties do not collide in `doc.monsters`.
     - Wire budget check: on the 40-gate worst-case solo doc (`tests/protocol.test.ts`, currently 31,664 chars = 51.1% of `DOC_MAX = 62,000`), adding `"hp":1.469,"dealt":2.042` (+24 chars) to 40 default-difficulty boss lines adds 960 chars -> 32,624 chars (52.6% of `DOC_MAX`, still under the test's 55% ceiling). Even if all 160 lines across 40 gates are non-default, +3,840 chars -> 35,504 chars (57.3%, >26,000 chars below `DOC_MAX`), and `soloDoc` enforces `JSON.stringify(next).length <= max` gate by gate.
3. **Personal gates (`solo.ts:217-224`):** unaffected (no boss, no difficulty field).
4. **Codex (`bestiary.js:80-95`):** `recordDefeat` looks up `found = monsterOfKind(...)` in the Bestiary first, so defeating a difficulty-scaled gate boss does not overwrite the Bestiary entry's base HP.

### 5.6 Gate Card, Gate Edit Panel, and GM Screen (`src/views/gates.js`, `src/views/gm.js`, `src/views/difficulty-control.js`)

Another lane (`plain-copy`) owns existing wording in `src/views/gm.js` and `src/views/gates.js`. To avoid merge conflicts, all new slider markup, CSS class names, and live readout wiring live in a new stateless view helper `src/views/difficulty-control.js` (zero module-level `let`s, zero containers, zero lint allowlist changes).

#### New helper module: `src/views/difficulty-control.js`

Exports three small functions:
1. `difficultySliderHtml({ idPrefix, name, label, level, R, resetAct })`: renders one `<div class="diff-ctl">` containing the `<label>`, `<input type="range" min="1" max="10" step="1" ...>` with `aria-valuetext`, optional `"Reset to default"` button, and `<output class="diff-read" data-diff-out>` showing the full self-explaining phrase.
2. `bossDifficultyHtml({ idPrefix, gateLevel, bossTrack, hasBoss, R })`: renders the `"Give this boss its own difficulty"` checkbox (hidden when `!hasBoss`), the boss range slider (shown when checked), and the live self-explaining readout (either `"Boss difficulty follows the gate (...)"` or `"Boss difficulty X of 10: three hunters of this rank win about Y% of the time."`).
3. `wireDifficultyLive(root, R)`: attaches one delegated `input`/`change` handler on `root` that updates `[data-diff-out]` and `aria-valuetext` live as sliders move, toggles boss slider visibility when the checkbox or `select[name=boss]` changes, and handles `[data-diff-reset]` clicks inside forms.

#### Self-explaining phrases (`DIFFICULTY_WORDS` in `src/core/gates/difficulty.ts`)

Every number read from `R.fight.difficulty.targets[level - 1]`:
- Slider readout (`gateReadout(level, R)`):
  `"Difficulty ${level} of 10: three hunters of this rank win about ${pct}% of the time."`
  (Example at 8: `"Difficulty 8 of 10: three hunters of this rank win about 33% of the time."` Note: on the straight-line table `95, 90, 85, 80, 75, 61, 47, 33, 19, 5`, level 7 is 47% and level 8 is 33%.)
- Boss following readout (`bossFollowReadout(gateLevel, R)`):
  `"Boss difficulty follows the gate (${gateLevel} of 10: three hunters of this rank win about ${pct}% of the time)."`
- Boss custom readout (`bossOwnReadout(level, R)`):
  `"Boss difficulty ${level} of 10: three hunters of this rank win about ${pct}% of the time."`
- Gate card summary (`cardSummary(d, hasBoss, R)`):
  - Default + follows: `"Difficulty 5 of 10 (default): three hunters of this rank win about 75% of the time."`
  - Set + follows: `"Difficulty ${g} of 10: three hunters of this rank win about ${gPct}% of the time."`
  - Boss override (`hasBoss && d.boss.at === 'own'`): `"Gate difficulty ${g} of 10 (about ${gPct}% win chance). Boss difficulty ${b} of 10 (about ${bPct}% win chance)."`
- Checkbox label: `"Give this boss its own difficulty"`
- Reset button label: `"Reset to default (5)"` (number read from `R.fight.difficulty.default`)

#### Exact lines to add in `src/views/gates.js` (minimal, zero edits to existing copy)

| Location in `src/views/gates.js` | Exact addition |
|---|---|
| After line 4 (imports) | 2 import lines: `import { DIFFICULTY_WORDS, difficultyFactor, effectiveBossLevel, effectiveGateLevel, parseDifficultyLevel, scaleMonsterForGate, withDifficulty } from '../core/gates/difficulty.ts';` and `import { bossDifficultyHtml, difficultySliderHtml, wireDifficultyLive } from './difficulty-control.js';` |
| Lines 55 and 66 to 68 (`roll`) | Accept `difficulty` in destructuring of `roll({ rank, type, name, difficulty } = {})`; wrap returned `g` with `difficulty !== undefined && difficulty !== R.fight.difficulty.default ? withDifficulty(g, [{ type: 'setGate', level: difficulty }]) : g` |
| Lines 101 to 102 (`startEncounter`) | Pass `difficultyFactor(mo.kind, mo.rank, effectiveGateLevel(g.difficulty, R), R)` to `toCombatant` for pack lines and `effectiveBossLevel(g.difficulty, R)` for `g.bossId` |
| After line 420 (`ui.css`) | 4 compact CSS rules for `.diff-ctl`, `.diff-ctl input[type=range]` (44 px touch target height), `.diff-read`, `.diff-head` |
| Line 451 (inside `.gt-spawn` form, before `<button type="submit">`) | `${difficultySliderHtml({ idPrefix: 'gt-sp', name: 'difficulty', label: 'Gate difficulty', level: app.rules().fight.difficulty.default, R: app.rules() })}` |
| Lines 470, 492, and after 493 (`cardHtml`) | Compute scaled HP via `scaleMonsterForGate` for `mons` and `boss`; add 1 GM-only summary line `${gm ? `<div class="gt-notes" data-diff-summary>${esc(DIFFICULTY_WORDS.cardSummary(g.difficulty, !!g.bossId, app.rules()))}</div>` : ''}` |
| After line 612 (in `editPanel`, right below Boss `<select>`) | `${difficultySliderHtml({ idPrefix: `gt-ed-${g.id}`, name: 'difficulty', label: 'Gate difficulty', level: effectiveGateLevel(g.difficulty, app.rules()), isSet: g.difficulty.gate.at === 'set', R: app.rules() })}` and `${bossDifficultyHtml({ idPrefix: `gt-ed-${g.id}`, gateLevel: effectiveGateLevel(g.difficulty, app.rules()), bossTrack: g.difficulty.boss, hasBoss: !!g.bossId, R: app.rules() })}` |
| After line 459 (`mount`) | `wireDifficultyLive(el, () => app.rules());` |
| Line 819 (`submit` of `.gt-spawn`) | Pass `difficulty: parseDifficultyLevel(Number(f.difficulty?.value)) ?? undefined` into `spawn(...)` |
| Lines 837 to 838 (`submit` of `edit`) | Build `difficultyEvents` via a small helper in `difficulty-control.js` (`readEditDifficultyEvents(f, g.difficulty, app.rules())`) and pass `difficultyEvents` in the `GateEdit` object to `editGate(...)` |

#### Exact lines to add in `src/views/gm.js` (minimal, zero edits to existing copy)

| Location in `src/views/gm.js` | Exact addition |
|---|---|
| After top imports | 2 import lines: `parseDifficultyLevel` from `../core/gates/difficulty.ts` and `difficultySliderHtml, wireDifficultyLive` from `./difficulty-control.js` |
| Lines 697 to 698 (`doSpawn`) | Read `const difficulty = parseDifficultyLevel(Number($('#gm-g-diff')?.value)) ?? undefined;` and pass `difficulty` into `A().gates.spawn({ rank: ..., type: ..., name: ..., difficulty })` |
| Line 888 (inside `section('gate', ...)` after `#gm-g-name`) | `<div class="wide">${difficultySliderHtml({ idPrefix: 'gm-g', inputId: 'gm-g-diff', name: 'difficulty', label: 'Gate difficulty', level: app.rules().fight.difficulty.default, R: app.rules() })}</div>` |
| In `mount` after `el.innerHTML` | `wireDifficultyLive(el, () => app.rules());` |

No existing text string in `src/views/gates.js` or `src/views/gm.js` is modified.

---

## 6. Measured Baseline Win Rates and Curve-Fitting Plan

All baselines and sweeps below were measured on the real fight reducer via `tests/models/fight-sim.ts` (`MIXED = ['tank', 'bruiser', 'cannon']` at each rank's first level vs 1 same-rank boss).

### 6.1 Measured Baseline Today (`hp = 1.0, dealt = 1.0`, `n = 200` per cell, 3,600 fights)

| Rank | Brute boss (party WR / dead / rounds) | Skirmisher boss (party WR / dead / rounds) | Caster boss (party WR / dead / rounds) |
|---|---|---|---|
| E | 100.0% / 0.0% / 5.8 r | 100.0% / 1.0% / 8.6 r | 100.0% / 4.0% / 9.5 r |
| D | 100.0% / 0.0% / 5.9 r | 100.0% / 0.0% / 7.8 r | 100.0% / 1.0% / 8.4 r |
| C | 100.0% / 0.0% / 5.9 r | 100.0% / 0.0% / 7.4 r | 100.0% / 1.5% / 7.9 r |
| B | 100.0% / 0.0% / 6.2 r | 100.0% / 0.0% / 7.5 r | 100.0% / 0.0% / 7.9 r |
| A | 100.0% / 0.0% / 6.7 r | 100.0% / 0.0% / 7.6 r | 100.0% / 0.5% / 8.0 r |
| S | 100.0% / 0.0% / 7.3 r | 100.0% / 0.0% / 7.8 r | 100.0% / 0.0% / 8.2 r |

Key findings from the baseline and sweeps:
1. **Unscaled bosses lose 100% of fights** to three same-rank hunters across all 6 ranks and all 3 archetypes. Even difficulty 1 (95% target) requires scaling above `1.0`.
2. **Dealt-only scaling fails:** at `hp = 1.0, dealt = 5.0`, an E-rank brute boss still loses 31% of fights because it dies in 5 to 6 rounds before finishing the party.
3. **Equal split (`hp = k^0.5, dealt = k^0.5`) drags fights out:** boss fights at 75% win rate stretch to 10.7 to 13.5 rounds.
4. **Dealt-leaning split (`hp = k^0.35, dealt = k^0.65`) keeps fights crisp (8.3 to 11.4 rounds)** and spans 100% down to 0% cleanly across all six ranks.
5. **Rank drift is ~30 percentage points without `rankScale`:** brute armor scales with rank Vitality while cannon mana caps at 40 (`manaBase 10 + manaCap 30`), making S fights ~1.5 rounds longer than E at baseline. Applying `rankScale` aligns all six ranks onto one curve.
6. **Regular packs must NOT use the boss multiplier:** applying the boss level-5 multiplier (`k = 3.0`) to 3 normal brutes drops 3-hunter pack win rate to E 63% (71% death), C 44% (76% death), S 31% (93% death), making normal packs deadlier than the boss. Therefore `RULES.fight.difficulty` separates `boss` (calibrated to 95/75/5%) from `pack` (centered at `1.0` at level 5).
7. **Archetype gap (existing QD row 27):** at `hp = 1.35, dealt = 2.0`, brute boss party win rate is E 93% / C 95% / S 66%, while skirmisher is E 3% / C 43% / S 67% and caster is E 5% / C 27% / S 25% because `RULES.fight.archetypes` gives skirmisher `1.7x` HP and caster `1.8x` HP (fitted for S mythics). All 7 shipped `kind: 'boss'` seeds and all placeholder gate bosses are `brute`. We calibrate the difficulty sim rows against `brute` bosses (matching `partyRows`) and flag QD row 27 explicitly.

### 6.2 Measured Fine Grid (`hp = k^0.35, dealt = k^0.65`, `n = 200` per cell vs brute boss)

| `k` | `hp` | `dealt` | E | D | C | B | A | S |
|---|---|---|---|---|---|---|---|---|
| 2.0 | 1.275 | 1.569 | 100.0% | 99.0% | 100.0% | 99.0% | 98.0% | 95.5% |
| 2.2 | 1.318 | 1.669 | 99.5% | 98.5% | 100.0% | 97.0% | 94.5% | 90.0% |
| 2.4 | 1.359 | 1.767 | 99.5% | 94.0% | 98.5% | 95.0% | 82.5% | 84.5% |
| 2.6 | 1.397 | 1.861 | 96.0% | 92.0% | 97.0% | 87.0% | 69.0% | 69.0% |
| 2.8 | 1.434 | 1.953 | 89.0% | 81.0% | 92.0% | 76.0% | 65.5% | 52.0% |
| 3.0 | 1.469 | 2.042 | 76.5% | 59.0% | 75.0% | 73.0% | 56.0% | 45.0% |
| 3.2 | 1.502 | 2.130 | 66.0% | 43.0% | 53.5% | 66.5% | 47.5% | 37.0% |
| 3.4 | 1.535 | 2.215 | 60.0% | 30.0% | 32.5% | 49.5% | 39.5% | 30.5% |
| 3.6 | 1.566 | 2.299 | 48.5% | 23.5% | 21.0% | 27.0% | 28.5% | 24.5% |
| 3.8 | 1.596 | 2.382 | 40.0% | 17.0% | 17.5% | 15.5% | 10.5% | 20.0% |
| 4.0 | 1.625 | 2.462 | 35.0% | 11.5% | 14.0% | 7.5% | 5.5% | 11.0% |
| 4.3 | 1.666 | 2.581 | 21.0% | 5.5% | 7.0% | 4.0% | 2.0% | 0.0% |
| 4.6 | 1.706 | 2.696 | 14.0% | 2.5% | 5.0% | 1.0% | 0.0% | 0.0% |
| 5.0 | 1.756 | 2.847 | 8.0% | 1.0% | 1.0% | 0.0% | 0.0% | 0.0% |

Interpolated anchor crossings per rank:
- 95% WR: E `2.63`, D `2.37`, C `2.68`, B `2.40`, A `2.18`, S `2.02`
- 75% WR: E `3.03`, D `2.85`, C `3.00`, B `2.87`, A `2.51`, S `2.53`
- 5% WR: E `5.20`, D `4.34`, C `4.60`, B `4.22`, A `4.03`, S `4.15`

### 6.3 Piecewise Linear vs Smooth Curve Between Anchors

We compared two candidate target curves through `(1, 95%), (5, 75%), (10, 5%)`:
- **Lead's piecewise linear (`targets = [95, 90, 85, 80, 75, 61, 47, 33, 19, 5]`):** drops 5 points per step from 1 to 5 and 14 points per step from 5 to 10.
- **Smooth power curve (`95 - 90 * ((d - 1) / 9)^1.855` -> `[95, 93, 90, 83, 75, 65, 52, 38, 23, 5]`):** removes the slope change at 5 (4->5 is -8, 5->6 is -10), but levels 1 and 2 are only 2 points apart (smaller than simulation noise `se ~ 1.5%` at `n = 200`), making levels 1 and 2 indistinguishable in play.

Because `RULES.fight.difficulty.boss` is an explicit 10-entry table, both curves fit the simulation equally accurately. **We keep the lead's piecewise-linear targets** so every single step moves by at least 5 percentage points and reads cleanly on screen, and record the smooth power curve as an alternative in Section 9.

### 6.4 Simulation Rows to Add to `tests/fight-sim.test.ts`

Following the file's published noise-floor rule (`RUNS = { even: 400, tenth: 150, quarter: 300, twentieth: 100, mythic: 600 }`):

| Row group | Ranks | Difficulty | Runs (`n`) | Expected SE | Target | Bound (`[low, high]`) | Lever |
|---|---|---|---|---|---|---|---|
| D1: default boss | E, D, C, B, A, S (6 rows) | 5 | `RUNS.quarter` (300) | 2.5% | 75% | `[0.68, 0.82]` | `difficulty.boss[4]` and `difficulty.rankScale` |
| D2: easiest boss | E, C, S (3 rows) | 1 | `RUNS.quarter` (300) | 1.3% | 95% | `[0.90, 0.99]` | `difficulty.boss[0]` and `difficulty.rankScale` |
| D3: hardest boss | E, C, S (3 rows) | 10 | `RUNS.even` (400) | 1.1% | 5% | `[0.01, 0.10]` | `difficulty.boss[9]` and `difficulty.rankScale` |
| D4: interior curve | C (3 rows) | 3, 7, 8 | 300, 400, 400 | 2.1%, 2.5%, 2.4% | 85%, 47%, 33% | `[0.78, 0.92]`, `[0.39, 0.55]`, `[0.25, 0.41]` | `difficulty.boss[2,6,7]` |
| D5: pack at 10 | C (1 row) | 10 | `RUNS.tenth` (150) | 3.5% | > 10% death | anyDead `>= 0.20`, party WR `<= 0.90` | `difficulty.pack[9]` |

Note on Rank E at difficulty 10: Rank E has slightly higher variance (smaller HP pools, larger relative crit swings), so at `k_E = 4.60 * 1.04 = 4.78` its win rate is ~9 to 10%, inside `[0.01, 0.10]`. During Step 2 implementation, tune `boss[0..9]` and `rankScale` until all 16 rows land near the center of their bounds (none `"near"` an edge).

**Measured runtime:**
- Benchmarked 400 scaled boss fights on this machine: C = `2.55 s`, S = `2.77 s` (~6.6 ms per fight).
- Total new fights across the 16 rows: `1,800 + 900 + 1,200 + 1,100 + 150 = 5,150` fights.
- Estimated added wall time in `tests/fight-sim.test.ts`: **~33 seconds** total (~2.0 to 2.8 s per row, well under `BUDGET_MS = 30,000` ms).

---

## 7. Implementation Step List (Each Step Ends in a Check)

1. **Step 1: Rules and override validation (`src/core/rules.ts`, `src/core/overrides.ts`, `src/core/combat/fight-parse.ts`)**
   - Add `RULES.fight.difficulty` (`default`, `hpExponent`, `targets`, `boss`, `pack`, `rankScale`) with `Domain`s.
   - Add `numbers(10)` readers for `fight.difficulty.targets`, `fight.difficulty.boss`, `fight.difficulty.pack` in `src/core/overrides.ts`.
   - Raise `tweakOf` upper bound on `hp` and `dealt` in `src/core/combat/fight-parse.ts` from `10` to `100`.
   - **Check:** `bun run typecheck && bun test tests/overrides.test.ts tests/fight-parse.test.ts tests/lint.test.ts` passes.

2. **Step 2: Core difficulty module, machine, and sim calibration (`src/core/gates/difficulty.ts`, `tests/difficulty.test.ts`, `tests/fight-sim.test.ts`)**
   - Implement `GateDifficulty`, `difficultyStep`, `GATE_TABLE`, `BOSS_TABLE`, `withDifficulty`, `gateDifficulty`, `parseGateDifficulty`, `effectiveGateLevel`, `effectiveBossLevel`, `difficultyFactor`, `scaleMonsterForGate`, `scaleRowMonster`, `DIFFICULTY_WORDS`.
   - Write exhaustive table tests and math/parser tests in `tests/difficulty.test.ts`.
   - Add D1 to D5 simulation rows in `tests/fight-sim.test.ts` and tune `RULES.fight.difficulty.boss` and `rankScale` so all 16 new rows and all existing rows pass cleanly (log moved numbers in `docs/agent-handoff/rw/sim-log.md`).
   - **Check:** `bun test tests/difficulty.test.ts tests/fight-sim.test.ts` passes with every new row inside bounds.

3. **Step 3: Gate model, world steps, solo runs, protocol, and one-writer lint (`src/core/gates/gate.ts`, `src/core/gates/world.ts`, `src/core/gates/solo.ts`, `src/core/protocol.ts`, `tests/lint.test.ts`, `tests/gate.test.ts`, `tests/solo.test.ts`, `tests/protocol.test.ts`)**
   - Add `difficulty: GateDifficulty` to `GateFields`, `newGate`, `fieldsOf`, `parseGate` (keep out of `shownOf`).
   - Extend `GateEdit` in `world.ts` with `difficultyEvents?: readonly DifficultyEvent[]`, delegating to `withDifficulty` and firing `{ type: 'bossRemoved' }` when `edit.bossId === null`.
   - Scale monsters in `soloReady` (local world gate) and encode optional `hp`/`dealt` per `SoloDocLine` in `soloDoc` / `soloTargets` / `protocol.ts`.
   - Add `only src/core/gates/difficulty.ts writes a gate's difficulty` lint to `tests/lint.test.ts`.
   - Add unit tests covering old-save migration, `bossRemoved`, `shownOf` privacy, `soloDoc` wire scaling, and worst-case `SoloDoc` size.
   - **Check:** `bun run typecheck && bun test tests/gate.test.ts tests/solo.test.ts tests/protocol.test.ts tests/lint.test.ts` passes.

4. **Step 4: State chart generation (`scripts/charts/difficulty.ts`, `scripts/statecharts.ts`, `docs/state-machines.md`)**
   - Add `scripts/charts/difficulty.ts` walking `difficultyStep` with parallel regions (`Gate difficulty`, `Boss difficulty`).
   - Register in `scripts/statecharts.ts` and regenerate `docs/state-machines.md`.
   - **Check:** `bun run charts` then `bun test tests/statecharts.test.ts` passes.

5. **Step 5: Bestiary API, UI controls, and view wiring (`src/core/api.ts`, `src/views/bestiary.js`, `src/views/difficulty-control.js`, `src/views/gates.js`, `src/views/gm.js`)**
   - Extend `BestiaryApi.toCombatant` with optional `scale?: DifficultyScale` and `GatesApi.spawn`/`roll` with optional `difficulty?: DifficultyLevel`.
   - Build `src/views/difficulty-control.js` with stateless slider markup, boss override toggle, live readout updater, and `readEditDifficultyEvents`.
   - Insert the exact minimal blocks in `src/views/gates.js` and `src/views/gm.js` listed in Section 5.6 (zero changes to existing copy).
   - Regenerate `docs/dependency-map.md` (`bun run deps`).
   - **Check:** `bun run test` (full typecheck, unit tests, lint, dependency map) passes green.

6. **Step 6: Browser e2e test and 390 px visual verification (`tests/e2e/difficulty-slider.e2e.ts`, `docs/agent-handoff/ui-pass/difficulty-slider/`)**
   - Write `tests/e2e/difficulty-slider.e2e.ts` reading all target win percentages and default level directly from `RULES.fight.difficulty` (never hardcoding percentages):
     - Spawn gate on Gates screen at difficulty 8, verify full phrase on slider readout and gate card, verify scaled boss HP increases vs difficulty 5, reload and verify persistence.
     - Open Edit panel, enable boss override at difficulty 10, verify boss card HP and summary phrase update; clear boss (`No boss`) and save, re-add boss, verify boss override reset to `follows`.
     - Start encounter from gate and verify fight combatant row carries the scaled max HP; verify GM Bestiary stat edit + difficulty combine multiplicatively.
     - Spawn gate from GM screen shortcut at difficulty 3 and verify it appears with difficulty 3.
     - Verify player phone in a room sees the gate card with NO difficulty text, while solo run odds on a solo-open gate reflect the scaled boss.
   - Capture 390 px mobile screenshots (`viewport: { width: 390, height: 844 }`) into `docs/agent-handoff/ui-pass/difficulty-slider/`:
     - `spawn-form.png` (Gates spawn form with slider and full phrase)
     - `gate-card.png` (GM gate card showing difficulty summary and scaled boss HP)
     - `edit-panel-boss-override.png` (Edit panel with gate slider + boss override checkbox and slider checked)
     - `gm-spawn-shortcut.png` (GM screen "Gates and world day" section with slider)
   - Inspect every 390 px shot for overflow, clipping, touch-target height (>= 44 px), and readable wrapping.
   - **Check:** `bunx playwright test tests/e2e/difficulty-slider.e2e.ts tests/e2e/gates.e2e.ts --workers=1 --output=/tmp/pw-difficulty` passes green, and `docs/guide/gates-solo.md` + `docs/guide/machines.md` updated.

---

## 8. Docs to Update During Implementation

- `docs/state-machines.md` (via `bun run charts`)
- `docs/dependency-map.md` (via `bun run deps`)
- `docs/guide/gates-solo.md` (add `difficulty.ts` to "Where things live")
- `docs/guide/machines.md` (add `GateDifficulty` row)
- `docs/agent-handoff/rw/sim-log.md` (record baseline measurements and final fitted `boss` / `rankScale` values)
- `docs/agent-handoff/questionable-decisions.md` (append rows below, sequentially numbered from the last row before `## Neon review`, verified by `tests/qd-rows.test.ts`)

---

## 9. Questionable Decisions (Plain Words for the owner)

Record these as new sequential rows in `docs/agent-handoff/questionable-decisions.md` when implementing:

1. **Curve between 1, 5, and 10:** Straight lines between the anchors (`95, 90, 85, 80, 75` dropping 5 points per step, then `61, 47, 33, 19, 5` dropping 14 points per step) rather than a smooth power curve (`95, 93, 90, 83, 75, 65, 52, 38, 23, 5`). Straight lines keep every step at least 5 points apart so levels 1 and 2 feel distinct. Alternative: switch `targets` and refit `boss` to the smooth curve if the jump from 5 to 6 feels too sharp.
2. **Normal and elite monsters stay at 1.0x at default difficulty 5:** Applying the boss multiplier to regular packs wiped 3-hunter parties on normal packs (C-rank pack dropped to 44% win rate with 76% hunter deaths). So normal and elite monsters use a separate `pack` curve centered at `1.0x` at difficulty 5 (softening at 1 to 4, hardening at 6 to 10), while only `kind === 'boss'` uses the 95/75/5% `boss` curve.
3. **Mythic bosses stay at 1.0x at default difficulty 5:** Mythics are already tuned to 5 to 10% win rate at `1.0x` (M1/B1). Putting a mythic on the `boss` curve would make it ~0% winnable at default 5. So a mythic placed in a gate uses the centered-at-5 `pack` curve (unchanged at 5, easier at 1 to 4, harder at 6 to 10).
4. **GM monster edits and difficulty multiply together:** When the GM edits a boss's HP multiplier or stats in the Bestiary, the gate/boss difficulty scales on top of those edited stats rather than overriding them.
5. **Players do not see the difficulty number:** Gate and boss difficulty stay GM-only (omitted from `WorldDoc` / `ShownGate`, same as clear presets and dice weights). On a world gate opened to solo runs, the player's solo odds and solo fight still use the real scaled monsters via `SoloDocLine`.
6. **Difficulty does not change XP or loot:** Raising a gate from 5 to 9 makes the fight harder without automatically inflating XP or gold rewards (the GM can already pre-set custom clear rewards with "What this clear pays").
7. **Boss scaling calibrated on brute bosses (blocked by QD row 27 for skirmisher/caster bosses):** All 7 shipped `kind: 'boss'` seeds and placeholder gate bosses are `brute`. Non-brute bosses (`skirmisher`, `caster`) have `1.7x` / `1.8x` archetype HP fitted to S mythics (QD row 27), so they run much harder than the displayed win chance until QD row 27 is resolved.
