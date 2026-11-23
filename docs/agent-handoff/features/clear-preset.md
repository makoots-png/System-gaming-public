# Clear preset design

The GM pre-sets what a dungeon clear pays on a gate (gold, XP, and checked items drawn by the loot rules) and delivers that exact set at the clear through the pending-reward record and the Award form without rolling at the end.

## 1. Data shape

Every preset lives on its gate as `GateFields.preset` in `Save.gates`. One pure module, `src/core/gates/preset.ts`, owns the preset type, its parser, its transition table, and every write to `Gate.preset`. `src/core/gates/gate.ts` supplies `NO_PRESET` in `newGate` and calls `parseClearPreset` in `parseGate`. A new rule in `tests/lint.test.ts` enforces that no other file writes `preset` on a gate.

### Branded id (`src/core/ids.ts`)

```ts
/** One item line inside a gate's clear preset (`pl1`, `pl2`, ...). Unique within its preset. */
export type PresetLineId = Id<'PresetLineId'>;
const PRESET_LINE_RE = /^pl\d{1,6}$/;
export const parsePresetLineId = (v: unknown): PresetLineId | null =>
  (typeof v === 'string' && PRESET_LINE_RE.test(v) ? (v as PresetLineId) : null);
export const presetLineId = (n: number): PresetLineId => `pl${n}` as PresetLineId;
```

### Core types (`src/core/gates/preset.ts`)

```ts
import type { GateId, HunterRef, PresetLineId } from '../ids.ts';
import type { ItemTemplate } from '../registry/items.ts';
import { REWARD_BOUNDS } from '../rewards.ts';

/** At most 20 item lines per gate preset, matching `REWARD_BOUNDS.items` so any checked set fits one reward or stash deposit. */
export const PRESET_ITEMS_MAX = REWARD_BOUNDS.items;

export const PRESET_STATES = ['none', 'recommended', 'edited', 'paid'] as const;
export type PresetState = (typeof PRESET_STATES)[number];

/** One item line in a gate's clear preset. `to: null` sends the item to the party stash at the clear. */
export type PresetItem = {
  readonly id: PresetLineId;
  readonly item: ItemTemplate;
  readonly checked: boolean;
  readonly to: HunterRef | null;
};

/** The editable fields held by a recommended, edited, or paid preset. `xp` and `gold` are per cleared hunter. */
export type PresetPayload = {
  readonly xp: number;
  readonly gold: number;
  readonly items: readonly PresetItem[];
};

/**
 * The clear reward pre-set on a gate.
 * `none` holds no payload. `paid` stamps `paidAt` (ISO time) and refuses every further event.
 */
export type ClearPreset =
  | { readonly at: 'none' }
  | ({ readonly at: 'recommended' } & PresetPayload)
  | ({ readonly at: 'edited' } & PresetPayload)
  | ({ readonly at: 'paid'; readonly paidAt: string } & PresetPayload);

export const NO_PRESET: Extract<ClearPreset, { at: 'none' }> = { at: 'none' };

export const PRESET_EVENTS = [
  'recommend', 'setGold', 'setXp', 'toggleItem', 'assignItem', 'addItem', 'removeItem', 'clear', 'pay',
] as const;
export type PresetEventType = (typeof PRESET_EVENTS)[number];

export type PresetEvent =
  | { readonly type: 'recommend'; readonly xp: number; readonly gold: number; readonly items: readonly PresetItem[] }
  | { readonly type: 'setGold'; readonly gold: number }
  | { readonly type: 'setXp'; readonly xp: number }
  | { readonly type: 'toggleItem'; readonly id: PresetLineId; readonly checked: boolean }
  | { readonly type: 'assignItem'; readonly id: PresetLineId; readonly to: HunterRef | null }
  | { readonly type: 'addItem'; readonly item: ItemTemplate; readonly to: HunterRef | null }
  | { readonly type: 'removeItem'; readonly id: PresetLineId }
  | { readonly type: 'clear' }
  | { readonly type: 'pay'; readonly at: string };

export type PresetRefusal = 'missing' | 'gate-done' | 'refused';
```

### Core signatures (`src/core/gates/preset.ts`)

```ts
/** Pure transition function. Returns the next preset, or null where the table refuses the event. */
export function presetStep(p: ClearPreset, e: PresetEvent): ClearPreset | null;

/** Recommends a clear preset for `gate`, `partySize` hunters, `xpOf`, `R`, `pool`, and `rand`. */
export function recommendPreset(
  gate: Gate,
  partySize: number,
  xpOf: XpOf,
  R: Pick<Rules, 'loot' | 'gateParty'>,
  pool: readonly ItemTemplate[],
  rand: Random,
): Extract<PresetEvent, { type: 'recommend' }>;

/**
 * Save step for GM edits on gate `gateId` (recommend, edit gold or XP, toggle, assign, add, remove, clear).
 * Refuses `missing` when the gate is absent, `gate-done` when `can(gate, 'clear')` is false, and `refused` when `presetStep` returns null.
 * Never accepts `pay`, because `payGatePreset` runs only inside the clear settlement step.
 */
export function gatePreset(
  save: Save,
  gateId: GateId,
  event: Exclude<PresetEvent, { type: 'pay' }>,
): Save | Refused<PresetRefusal>;

/**
 * Marks gate `gateId`'s active preset paid at `at`.
 * Called only inside clear settlement (`pay.ts` and `solo.ts`). Refuses `missing` or `refused`.
 */
export function payGatePreset(
  save: Save,
  gateId: GateId,
  at: string,
): Save | Refused<'missing' | 'refused'>;

/** Splits a preset's checked items among `payees` by `to`. Items with `to: null` or a hunter outside `payees` go to `stash`. */
export function partitionPresetItems(
  preset: Extract<ClearPreset, { at: 'recommended' | 'edited' }>,
  payees: readonly Payee[],
): { readonly byPayee: ReadonlyMap<string, readonly ItemTemplate[]>; readonly stash: readonly ItemTemplate[] };

/** Reads a stored preset at the boundary. Unknown or malformed values fall back to `NO_PRESET`. */
export function parseClearPreset(v: unknown): ClearPreset;
```

## 2. Two candidate shapes

### Shape A (chosen), `GateFields.preset` with its own machine in `src/core/gates/preset.ts`

Types live in `src/core/gates/preset.ts`. `GateFields` in `src/core/gates/gate.ts` adds one field.

```ts
// src/core/gates/gate.ts
export type GateFields = {
  id: GateId; name: string; rank: Rank; type: GateType; breakDay: number;
  monsters: GateMonster[]; bossId: MonsterId | null; notes: string;
  createdDay: number; xpPaid: number; mapId: MapId | null; fought: string[];
  solo: boolean;
  preset: ClearPreset;
};

// src/core/gates/preset.ts
export function presetStep(p: ClearPreset, e: PresetEvent): ClearPreset | null;
export function gatePreset(save: Save, gateId: GateId, event: Exclude<PresetEvent, { type: 'pay' }>): Save | Refused<PresetRefusal>;
export function payGatePreset(save: Save, gateId: GateId, at: string): Save | Refused<'missing' | 'refused'>;
```

### Shape B (rejected), separate map `Save.clearPresets` keyed by `GateId`

`Gate` stays untouched. A top-level map on `Save` (or inside `Save.settings`) stores presets by gate id.

```ts
// src/core/save.ts
export type Save = {
  // ...existing fields...
  clearPresets: Readonly<Partial<Record<GateId, ClearPreset>>>;
};

// src/core/gates/preset.ts
export function presetOf(save: Pick<Save, 'clearPresets'>, gateId: GateId): ClearPreset;
export function gatePreset(save: Save, gateId: GateId, event: PresetEvent): Save | Refused<PresetRefusal>;
export function dropGatePreset(save: Save, gateId: GateId): Save;
```

### Why Shape A wins

1. Each gate already owns its GM-private data (`monsters`, `bossId`, `notes`, `fought`, `xpPaid`), and `shownOf` already strips private fields before publishing `worldDoc`.
2. Deleting or repairing a gate (`deleteGate`, `parseGate`) deletes or repairs its preset in one place with no orphan keys to clean up in `world.ts` or `save.ts`.
3. Callers (`gates.js`, `pay.ts`, `solo.ts`) already hold the `Gate` value and read `g.preset` directly instead of threading a second lookup map alongside `save.gates`.
4. Keeping the 4-state `presetStep` machine in `src/core/gates/preset.ts` instead of crossing it with the 5 gate statuses in `gate.ts` mirrors `Hunter.life`, `Hunter.rests`, and `Hunter.penalty` and keeps both machines small.
5. One writer (`preset.ts`) owns every transition of `Gate.preset`, enforced by one lint test in `tests/lint.test.ts`.

## 3. Systems touched

| File | Function or symbol | Change |
|---|---|---|
| `src/core/ids.ts` | `PresetLineId`, `parsePresetLineId`, `presetLineId` | Add branded id for preset item lines. |
| `src/core/gates/preset.ts` | New module | Define `ClearPreset`, `PresetItem`, `PRESET_STATES`, `PRESET_EVENTS`, `PRESET_TABLE`, `presetStep`, `recommendPreset`, `partitionPresetItems`, `gatePreset`, `payGatePreset`, `parseClearPreset`, `PRESET_WORDS`. |
| `src/core/gates/gate.ts` | `GateFields`, `newGate`, `fieldsOf`, `parseGate` | Add `preset: ClearPreset`, default `NO_PRESET`, preserve in `fieldsOf`, parse via `parseClearPreset(value.preset)`. `shownOf` stays unchanged and never exports `preset`. |
| `src/core/gates/world.ts` | `editGate`, `mergeWorld`, `clearGate`, `worldDoc` | No signature change. `editGate` and `mergeWorld` preserve `preset` via object spread. `worldDoc` reads `shownOf`, so players never receive `preset`. |
| `src/core/protocol.ts` | `REWARD_FROM`, `ASK_FROM`, `newEventId`, `newEvent` | Extract `newEventId(stamp: EventStamp): EventId | null` from `newEvent` so core can mint valid `EventId` values for `clear` pending records without breaking the event-id lint rule. Expand `REWARD_FROM` to `['solo', 'quest', 'feat', 'clear']` for `award.earned` and `PendingReward.from`, while keeping `rewardAsk` limited to `ASK_FROM = ['solo', 'quest', 'feat']`. `WorldGate`, `WorldDoc`, and `SoloDoc` stay unchanged. |
| `src/core/hunter/pending.ts` | `FROM_WORDS`, `pendingHeard`, `parsePending`, `PENDING_WORDS` | Add `clear: 'Gate clear'` to `FROM_WORDS`. Add `pendingClear(s, rec, log)` or pass `from: 'clear'` into `pendingHeard` so a clear preset creates one waiting record per payee in `settings.sync.pending`. `pendingStep` (`waiting` to `approved` or `refused`) and `ROUTE` stay unchanged. |
| `src/core/award.ts` | `AwardDraft`, `draftStep`, `gmAward` | No change needed. Waiting records with `from: 'clear'` open in the Award form with `tie: { kind: 'pending', id }`, edit freely, and approve once in the same write as `gmAward`. |
| `src/core/trade/stash.ts` | `stashDeposit` | Export one pure save step `stashDeposit(save, items, stamp, reason): Save | Refused<'full'>` backed by `keptIn`, `idsOn`, and `told`. Deposits unpicked preset items into `save.stash` in the clear's single write, or refuses `'full'` before anything writes. |
| `src/core/gates/pay.ts` | `settleClearPreset`, `ClearPresetPlan` | Add atomic clear step for gates whose `preset.at` is `'recommended'` or `'edited'`. Runs `clearGate`, `payGatePreset`, `noteFacts` (local) and `noted` events (remote), `stashDeposit` for unpicked checked items, and routes each payee's reward by `ROUTE[seat]` (`pendingHeard` when `seat === 'gm'` in a room, `grant` when `seat === 'alone'`). Refuses `'missing'`, `'unchanged'`, `'no-preset'`, or `'stash-full'`. Existing `settleClear` stays for gates with `preset.at === 'none'`. |
| `src/core/gates/solo.ts` | `soloPlan`, `soloOwed`, `soloTaken`, `soloRan` | When a world gate cleared by a solo run has an active preset (`recommended` or `edited`), pay the preset's `xp`, `gold`, and items assigned to that hunter instead of rolling loot, deposit unpicked checked items to `save.stash`, and move `preset` to `'paid'` in the same write. |
| `src/core/save.ts` | `gates` in `repair` | No code change needed because `gates` already runs `parseGate` on every stored gate. `exportedSave` keeps gates as before. |
| `src/edge/room-events.ts` | `award` applier | No code change needed. When the GM approves a `from: 'clear'` record, the player receives `award` with `earned: { from: 'clear', what: gate.name }`, and `PENDING_WORDS.approvedBody` displays `"Gate clear: <name>. The GM approved your reward."`. |
| `src/views/gates.js` | Gate card, `presetPanel`, `clearPanel`, `clearGate`, `soloRun` handler | Add **What this clear pays** button (`data-act="preset"`) on active gate cards for the GM, preset summary line on cards, inline `preset` panel inside `openPanel` (no new view state), updated `clearPanel` when preset is active, and branch in `clearGate` to call `settleClearPreset` when `g.preset.at === 'recommended' || g.preset.at === 'edited'`. |
| `src/views/gm.js` | `Waiting for you`, `Award` form | No change to `sendAward` or `draftStep`. `renderWaiting` already lists `from: 'clear'` records with Approve, Edit, and Refuse. Unfold `waiting` when `waitingHere().length > 0` on view update if a new clear record arrived. |
| `scripts/charts/preset.ts` and `scripts/statecharts.ts` | `clearPreset` chart, `MACHINES` | Walk `presetStep` over all 9 events and register in `MACHINES`. Regenerate `docs/state-machines.md`. |
| `docs/guide/machines.md` and `docs/guide/gates-solo.md` | Machine list and Gates guide table | Add the clear preset machine line and "Where things live" row. |
| `tests/lint.test.ts` | One-writer lint | Add test `only src/core/gates/preset.ts writes a gate's preset` (allowing `gate.ts` only for `NO_PRESET` and `parseClearPreset`). Verify `gates.js` keeps its existing `let` count. |

### Room protocol check

Players never see a gate's preset before the clear.
- `worldDoc` (`src/core/gates/world.ts`) builds every entry with `shownOf` (`src/core/gates/gate.ts`), which copies only `id`, `name`, `rank`, `type`, `breakDay`, `status`, and `clearedDay`.
- `soloDoc` (`src/core/gates/solo.ts`) copies only `id` and fight monsters.
- No new room message type is added.
- At the clear in a room, the GM's phone creates `PendingReward` records locally in `save.settings.sync.pending` (`SYNC_OWNER.pending = 'phone'`). The only wire message sent at clear time is `noted` (the hunter's `gate` fact). A player receives an `award` message with `earned: { from: 'clear', what: gate.name }` only after the GM taps Approve in **Waiting for you** or **Award**.
- Unpicked items deposited into `save.stash` publish to the room automatically through the existing `stash` doc publisher.

### Recommendation algorithm (`recommendPreset`)

1. Determine `n = Math.max(1, partySize)`. In `gates.js`, `partySize` is `fighters(g).size` when a fight is live or `g.fought.length > 0`, else the count of hunters at the table (local plus remote), else `R.gateParty`.
2. Compute `due = xpDue(gate, xpOf)` and `xp = shareEach(due, n, R.gateParty)`.
3. Roll loot once with `rollLoot(R, gate.rank, { boss: true, share: 1 }, pool, rand)` where `pool = lootPool(R)` (built-in items already sized to each grade's budget by `itemOf`, excluding revives).
4. Compute `rolledGold = drops.filter(gold).sum` and `gold = shareEach(rolledGold, n, R.gateParty)`.
5. Convert each rolled item drop into a `PresetItem` with sequential `presetLineId(1)`, `presetLineId(2)`, `checked: true`, and `to: null` (party stash).
6. Return `{ type: 'recommend', xp, gold, items }`.

## 4. State machine transition table

Every cell is the resulting `at` state (with payload change in parentheses), or `null` when `presetStep(p, e)` refuses the event and returns `null`.

| State and event | `recommend` | `setGold` | `setXp` | `toggleItem` | `assignItem` | `addItem` | `removeItem` | `clear` | `pay` |
|---|---|---|---|---|---|---|---|---|---|
| `none` | `recommended` (loads xp, gold, items) | `null` | `null` | `null` | `null` | `null` | `null` | `null` | `null` |
| `recommended` | `recommended` (replaces xp, gold, items) | `edited` (clamped gold, `null` if non-finite) | `edited` (clamped xp, `null` if non-finite) | `edited` (sets `checked` on `id`, `null` if `id` missing) | `edited` (sets `to` on `id`, `null` if `id` missing) | `edited` (appends checked line, `null` at `PRESET_ITEMS_MAX`) | `edited` (drops `id`, `null` if `id` missing) | `none` | `paid` (stamps `paidAt`, `null` if bad time) |
| `edited` | `recommended` (replaces xp, gold, items) | `edited` (clamped gold, `null` if non-finite) | `edited` (clamped xp, `null` if non-finite) | `edited` (sets `checked` on `id`, `null` if `id` missing) | `edited` (sets `to` on `id`, `null` if `id` missing) | `edited` (appends checked line, `null` at `PRESET_ITEMS_MAX`) | `edited` (drops `id`, `null` if `id` missing) | `none` | `paid` (stamps `paidAt`, `null` if bad time) |
| `paid` | `null` | `null` | `null` | `null` | `null` | `null` | `null` | `null` | `null` |

### Table test plan (`tests/preset.test.ts`)

1. **Exhaustive state and event matrix.** Build one representative state for each member of `PRESET_STATES` and one valid event for each member of `PRESET_EVENTS`. Run `presetStep(state, event)` over all 36 cells and assert the full result table with `toEqual`, matching `tests/pending.test.ts` lines 36 to 43.
2. **Guard refusals.** Check that `setGold` and `setXp` refuse `NaN` and `Infinity`, clamp negatives to `0`, and clamp large values to `REWARD_BOUNDS`. Check that `toggleItem`, `assignItem`, and `removeItem` return `null` for an unknown `PresetLineId`. Check that `addItem` returns `null` at `PRESET_ITEMS_MAX` and `pay` returns `null` on an invalid timestamp.
3. **Save step guards (`gatePreset` and `payGatePreset`).** Check that they refuse a `missing` gate, refuse `gate-done` on a `cleared` or `closed` gate, and refuse double payment once `paid`.
4. **Recommendation (`recommendPreset`).** Check that it uses `RULES.loot[rank]`, `RULES.gateParty`, `xpDue`, and `lootPool(RULES)` (never recommending a Resurrection Crystal). Verify gold and XP scale with party size via `shareEach`, and verify items receive sequential `PresetLineId` values starting checked with `to: null`.
5. **Item partitioning (`partitionPresetItems`).** Check that it omits unchecked items, routes checked items with a matching local or remote `to` to that payee, and routes `to: null` or a `to` outside `payees` to `stash`.
6. **Boundary round-trip (`parseClearPreset` and `parseGate`).** Round-trip all 4 states through JSON. Repair missing or malformed fields to `NO_PRESET`, drop duplicate line ids and lines beyond `PRESET_ITEMS_MAX`, fall back to `NO_PRESET` on a bad `paidAt`, and verify `shownOf` never exposes `preset`.

## 5. Step list

Build in this order. Do not start the next step until the current step's check passes.

1. **Ids, core preset machine, and recommendation.** Add `PresetLineId` in `src/core/ids.ts`, create `src/core/gates/preset.ts` (`presetStep`, `PRESET_TABLE`, `recommendPreset`, `partitionPresetItems`, `gatePreset`, `payGatePreset`, `parseClearPreset`, `PRESET_WORDS`), and wire `GateFields.preset` in `src/core/gates/gate.ts`. Write `tests/preset.test.ts` and add the one-writer rule in `tests/lint.test.ts`.
   - Check: `bun test tests/preset.test.ts tests/gate.test.ts tests/save.test.ts tests/lint.test.ts`
2. **State chart and machine docs.** Create `scripts/charts/preset.ts`, add `clearPreset` to `MACHINES` in `scripts/statecharts.ts`, add its line to `docs/guide/machines.md`, and run `bun run charts`.
   - Check: `bun test tests/statecharts.test.ts`
3. **Protocol, pending rewards, and stash deposit.** Extract `newEventId` and add `'clear'` to `REWARD_FROM` (keeping `ASK_FROM` on `rewardAsk`) in `src/core/protocol.ts`. Add `clear: 'Gate clear'` in `src/core/hunter/pending.ts`. Export `stashDeposit` in `src/core/trade/stash.ts`. Add unit cases to `tests/protocol.test.ts`, `tests/pending.test.ts`, and `tests/stash.test.ts`.
   - Check: `bun test tests/protocol.test.ts tests/pending.test.ts tests/stash.test.ts`
4. **Clear settlement hand-off.** Add `settleClearPreset` in `src/core/gates/pay.ts` to handle both `seat === 'gm'` via `pendingHeard` and `seat === 'alone'` via `grant`, plus `stashDeposit` and `payGatePreset` in one atomic step. Wire active presets into `soloTaken` and `soloRan` in `src/core/gates/solo.ts`. Add unit cases to `tests/pay.test.ts` and `tests/solo.test.ts` covering stash-full refusal, double-clear refusal, unchecked item omission, and player isolation.
   - Check: `bun test tests/pay.test.ts tests/solo.test.ts`
5. **GM screen in Gates and GM views.** Update `src/views/gates.js` with the **What this clear pays** button, card summary line, inline `preset` panel (XP input, gold input, item checkbox rows with rarity and grade tag, hunter or Party stash select, remove button, add-item picker with Library, Shop, Built-in, and New item, Reset to recommended, Clear preset, Done), updated `clearPanel` when a preset is active, and `clearGate` calling `settleClearPreset`. Check `src/views/gm.js` so **Waiting for you** opens cleanly when clear rewards wait. Update `docs/guide/gates-solo.md`.
   - Check: `bun run typecheck` and `bun run test`
6. **Browser test.** Write `tests/e2e/clear-preset.e2e.ts` reading all expected numbers from `RULES` (`RULES.loot`, `RULES.gateParty`). Cover these scenarios:
   - The GM opens **What this clear pays**, sees recommended XP, gold, and checked items drawn from the loot rules, unchecks one item, edits gold and XP, assigns one item to a player and leaves another for Party stash, adds a line, and reloads to confirm persistence.
   - The player phone in the room never sees the preset before the clear.
   - The GM clears the gate. Nothing is rolled, the unpicked item lands in the Party stash, each cleared hunter's preset reward appears in GM **Waiting for you**, editing one opens the Award form tied to that record, and approving delivers the exact gold, XP, and assigned item to the player once.
   - When playing alone with no room, clearing a gate with a preset pays exact preset amounts right away and puts unpicked items in the stash.
   - Existing clear tests with no preset in `tests/e2e/gates-quests-dailies.e2e.ts` stay green.
   - Check: `bunx playwright test tests/e2e/clear-preset.e2e.ts tests/e2e/gates-quests-dailies.e2e.ts --workers=1 --output=/tmp/pw-clear-preset`
7. **390 px UI pass and docs.** Capture 390 px wide screenshots under `docs/agent-handoff/ui-pass/clear-preset/` (`preset-panel-390.png`, `clear-panel-preset-390.png`, `gm-waiting-clear-390.png`), verify zero horizontal overflow and 44 px touch targets, add the questionable-decisions rows to `docs/agent-handoff/questionable-decisions.md`, and run full verification.
   - Check: `bun run deps` and `bun run test`

## 6. Questionable decisions

Plain-word rows to add to `docs/agent-handoff/questionable-decisions.md` once built.

1. **Players do not see a gate's clear preset before the gate is cleared.** The preset stays only on the GM's save and is left out of the room's world doc, so players learn what the dungeon paid only after the clear and GM approval. Undo with "show the preset clear reward on players' gate cards".
2. **The GM picks a hunter for each preset item, and any unpicked item goes to the party stash.** Every recommended or newly added item starts set to Party stash, and an item assigned to a hunter who is not checked at Clear also goes to the party stash instead of disappearing. If the stash is full, the clear stops and asks the GM to make room or assign the item. Undo with "put every preset item in the party stash with no per-hunter picker" or "give unpicked items to the first selected hunter".
3. **Gold and XP typed in "What this clear pays" are per hunter, not a shared pot split again at the clear.** Opening the preset starts both fields at the recommended per-hunter share for the party size. Whatever numbers the GM leaves in those fields are what each cleared hunter gets. Undo with "split the preset's gold and XP across the party at the clear".
4. **Clearing a gate that has no preset still rolls loot at the clear and pays directly.** Only a gate where the GM opened "What this clear pays" (and did not clear the preset) skips rolling and routes through **Waiting for you** and the Award form in a room. Undo with "route every gate clear through Waiting for you even with no preset".
5. **In a room, every cleared hunter's preset reward waits in Waiting for you on the GM screen, and playing alone pays right away.** This matches how feats, counted quests, and room solo clears already route (`pending.ts` `ROUTE`), so no player sees a room reward until the GM approves or edits it, while an offline solo table has no extra step. Undo with "pay the GM's own local hunters right away in a room too" or "approve preset clears directly on the Clear panel without Waiting for you".
6. **A solo run that clears a world gate with a preset pays the preset instead of rolling loot.** The solo hunter gets the preset's XP, gold, and items assigned to them (waiting for GM approval in a room), and unpicked items go to the party stash. Undo with "ignore the preset on a solo clear and roll loot as before".
7. **A paid preset stays locked as paid even if the GM changes the gate's status back in Edit.** This keeps a reopened gate from paying its preset a second time. Undo with "let the GM reset a paid preset back to recommended after reopening a gate".
