// preset.ts: what a dungeon clear pays when the GM pre-sets it on a gate (the owner, Nov 22). Pure.
//
// One writer for `Gate.preset`: every change moves through `presetStep` and its `PRESET_TABLE` (`none`, `recommended`,
// `edited`, `paid`), written to a save only by `gatePreset` (GM edits while the gate can still be cleared) and
// `payGatePreset` (inside the clear settlement step of pay.ts and solo.ts). `paid` is terminal so a preset is never
// paid twice. `recommendPreset` draws from the loot rules (`rollLoot`) over `lootPool` using the caller's `Random`.
import { timeOf } from '../day.ts';
import { parseHunterRef, parsePresetLineId, presetLineId } from '../ids.ts';
import type { GateId, HunterRef, PresetLineId, SheetKey } from '../ids.ts';
import { parseItem } from '../registry/items.ts';
import type { ItemTemplate } from '../registry/items.ts';
import { REWARD_BOUNDS } from '../rewards.ts';
import type { Save } from '../save.ts';
import { refuse } from '../save-step.ts';
import type { Refused } from '../save-step.ts';

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

/** The editable fields held by a recommended, edited, or paid preset. `xp`, `gold`, and `crystal` are per cleared hunter. */
export type PresetPayload = {
  readonly xp: number;
  readonly gold: number;
  readonly crystal: number;
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
  'recommend', 'setGold', 'setCrystal', 'setXp', 'toggleItem', 'assignItem', 'addItem', 'removeItem', 'clear', 'pay',
] as const;
export type PresetEventType = (typeof PRESET_EVENTS)[number];

/** What can move a gate's clear preset. */
export type PresetEvent =
  | { readonly type: 'recommend'; readonly xp: number; readonly gold: number; readonly crystal?: number; readonly items: readonly PresetItem[] }
  | { readonly type: 'setGold'; readonly gold: number }
  | { readonly type: 'setCrystal'; readonly crystal: number }
  | { readonly type: 'setXp'; readonly xp: number }
  | { readonly type: 'toggleItem'; readonly id: PresetLineId; readonly checked: boolean }
  | { readonly type: 'assignItem'; readonly id: PresetLineId; readonly to: HunterRef | null }
  | { readonly type: 'addItem'; readonly item: ItemTemplate; readonly to: HunterRef | null }
  | { readonly type: 'removeItem'; readonly id: PresetLineId }
  | { readonly type: 'clear' }
  | { readonly type: 'pay'; readonly at: string; readonly payees?: readonly PresetPayee[] };

/** Why a save step on a gate's preset refused to write. */
export type PresetRefusal = 'missing' | 'gate-done' | 'refused';

/** Whether `p` is an active preset that pays at the clear (`recommended` or `edited`). */
export const isActivePreset = (p: ClearPreset): p is Extract<ClearPreset, { at: 'recommended' | 'edited' }> =>
  p.at === 'recommended' || p.at === 'edited';

const clampAmount = (n: number, max: number): number | null =>
  (typeof n === 'number' && Number.isFinite(n) ? Math.max(0, Math.min(max, Math.trunc(n))) : null);

/** The next unused valid `PresetLineId`: `max + 1` while `parsePresetLineId` accepts it, else the lowest unused positive id. */
function nextLineId(items: readonly PresetItem[]): PresetLineId {
  const used = new Set<string>(items.map(l => l.id));
  let max = 0;
  for (const line of items) {
    const n = Number(line.id.slice(2));
    if (Number.isFinite(n) && n > max) max = n;
  }
  const next = parsePresetLineId(presetLineId(max + 1));
  if (next && !used.has(next)) return next;
  for (let n = 1; ; n++) {
    const candidate = presetLineId(n);
    if (!used.has(candidate)) return candidate;
  }
}

/** Deduplicated, capped item lines with clean copies. */
function cleanItems(items: readonly PresetItem[]): PresetItem[] {
  const seen = new Set<string>(), out: PresetItem[] = [];
  for (const line of items) {
    if (out.length >= PRESET_ITEMS_MAX || seen.has(line.id)) continue;
    seen.add(line.id);
    out.push({ id: line.id, item: { ...line.item }, checked: line.checked, to: line.to ? { ...line.to } : null });
  }
  return out;
}

type PresetFn<E extends PresetEventType> = (p: ClearPreset, e: Extract<PresetEvent, { type: E }>) => ClearPreset | null;
type Active = Extract<ClearPreset, { at: 'recommended' | 'edited' }>;

const recommendFn: PresetFn<'recommend'> = (_p, e) => {
  const xp = clampAmount(e.xp, REWARD_BOUNDS.xp), gold = clampAmount(e.gold, REWARD_BOUNDS.gold);
  const crystal = clampAmount(e.crystal ?? 0, REWARD_BOUNDS.crystal);
  if (xp === null || gold === null || crystal === null) return null;
  return { at: 'recommended', xp, gold, crystal, items: cleanItems(e.items) };
};
const setGoldFn: PresetFn<'setGold'> = (p, e) => {
  if (!isActivePreset(p)) return null;
  const gold = clampAmount(e.gold, REWARD_BOUNDS.gold);
  return gold === null ? null : { at: 'edited', xp: p.xp, gold, crystal: p.crystal, items: p.items };
};
const setCrystalFn: PresetFn<'setCrystal'> = (p, e) => {
  if (!isActivePreset(p)) return null;
  const crystal = clampAmount(e.crystal, REWARD_BOUNDS.crystal);
  return crystal === null ? null : { at: 'edited', xp: p.xp, gold: p.gold, crystal, items: p.items };
};
const setXpFn: PresetFn<'setXp'> = (p, e) => {
  if (!isActivePreset(p)) return null;
  const xp = clampAmount(e.xp, REWARD_BOUNDS.xp);
  return xp === null ? null : { at: 'edited', xp, gold: p.gold, crystal: p.crystal, items: p.items };
};
const toggleItemFn: PresetFn<'toggleItem'> = (p, e) => {
  if (!isActivePreset(p) || !p.items.some(x => x.id === e.id)) return null;
  return { at: 'edited', xp: p.xp, gold: p.gold, crystal: p.crystal, items: p.items.map(x => (x.id === e.id ? { ...x, checked: e.checked } : x)) };
};
const assignItemFn: PresetFn<'assignItem'> = (p, e) => {
  if (!isActivePreset(p) || !p.items.some(x => x.id === e.id)) return null;
  return { at: 'edited', xp: p.xp, gold: p.gold, crystal: p.crystal, items: p.items.map(x => (x.id === e.id ? { ...x, to: e.to ? { ...e.to } : null } : x)) };
};
const addItemFn: PresetFn<'addItem'> = (p, e) => {
  if (!isActivePreset(p) || p.items.length >= PRESET_ITEMS_MAX) return null;
  const line: PresetItem = { id: nextLineId(p.items), item: { ...e.item }, checked: true, to: e.to ? { ...e.to } : null };
  return { at: 'edited', xp: p.xp, gold: p.gold, crystal: p.crystal, items: [...p.items, line] };
};
const removeItemFn: PresetFn<'removeItem'> = (p, e) => {
  if (!isActivePreset(p) || !p.items.some(x => x.id === e.id)) return null;
  return { at: 'edited', xp: p.xp, gold: p.gold, crystal: p.crystal, items: p.items.filter(x => x.id !== e.id) };
};
const clearFn: PresetFn<'clear'> = () => NO_PRESET;
const payFn: PresetFn<'pay'> = (p, e) => {
  if (!isActivePreset(p)) return null;
  const paidAt = timeOf(e.at);
  if (!paidAt) return null;
  if (!e.payees) return { at: 'paid', xp: p.xp, gold: p.gold, crystal: p.crystal, items: p.items, paidAt };
  const valid = new Set(e.payees.map(payeeKey));
  const items = p.items.map(line => (line.checked && line.to && !valid.has(refKey(line.to)) ? { ...line, to: null } : line));
  return { at: 'paid', xp: e.payees.length ? p.xp : 0, gold: e.payees.length ? p.gold : 0, crystal: e.payees.length ? p.crystal : 0, items, paidAt };
};

const ACTIVE_ROW: { readonly [E in PresetEventType]: PresetFn<E> } = {
  recommend: recommendFn, setGold: setGoldFn, setCrystal: setCrystalFn, setXp: setXpFn, toggleItem: toggleItemFn,
  assignItem: assignItemFn, addItem: addItemFn, removeItem: removeItemFn, clear: clearFn, pay: payFn,
};

/** Every state against every event; null refuses the event and changes nothing. `paid` is terminal. */
const PRESET_TABLE: { readonly [S in PresetState]: { readonly [E in PresetEventType]: PresetFn<E> | null } } = {
  none: { recommend: recommendFn, setGold: null, setCrystal: null, setXp: null, toggleItem: null, assignItem: null, addItem: null, removeItem: null, clear: null, pay: null },
  recommended: ACTIVE_ROW,
  edited: ACTIVE_ROW,
  paid: { recommend: null, setGold: null, setCrystal: null, setXp: null, toggleItem: null, assignItem: null, addItem: null, removeItem: null, clear: null, pay: null },
};

/** `p` after `e`, or null where the table refuses it. */
export function presetStep(p: ClearPreset, e: PresetEvent): ClearPreset | null {
  const step = PRESET_TABLE[p.at][e.type] as PresetFn<PresetEventType> | null;
  return step ? step(p, e) : null;
}

// ── save writers (the one writer of Gate.preset) ──
/**
 * Applies GM preset event `event` to gate `gateId`.
 * Refuses `missing` when the gate is absent, `gate-done` when the gate can no longer be cleared, and `refused` when
 * `presetStep` refuses the event. Never accepts `pay` (only `payGatePreset` inside clear settlement marks a preset paid).
 */
export function gatePreset(save: Save, gateId: GateId, event: Exclude<PresetEvent, { type: 'pay' }>): Save | Refused<PresetRefusal> {
  const at = save.gates.findIndex(g => g.id === gateId);
  if (at < 0) return refuse('missing');
  const g = save.gates[at]!;
  if (g.status === 'cleared' || g.status === 'closed') return refuse('gate-done');
  const next = presetStep(g.preset, event);
  if (!next) return refuse('refused');
  return { ...save, gates: save.gates.map((x, i) => (i === at ? { ...x, preset: next } : x)) };
}

/**
 * Marks gate `gateId`'s active preset paid at ISO time `at`, recording where each item went and whether any hunter got
 * XP or gold when `payees` is provided. Called only inside clear settlement (`pay.ts` and `solo.ts`). Refuses `missing` or `refused`.
 */
export function payGatePreset(save: Save, gateId: GateId, at: string, payees?: readonly PresetPayee[]): Save | Refused<'missing' | 'refused'> {
  const idx = save.gates.findIndex(g => g.id === gateId);
  if (idx < 0) return refuse('missing');
  const g = save.gates[idx]!;
  const next = presetStep(g.preset, payees ? { type: 'pay', at, payees } : { type: 'pay', at });
  if (!next) return refuse('refused');
  return { ...save, gates: save.gates.map((x, i) => (i === idx ? { ...x, preset: next } : x)) };
}

// ── item partitioning at the clear ──
/** A payee as `partitionPresetItems` identifies it: a local hunter id or a remote player's sheet key. */
export type PresetPayee = { readonly kind: 'local'; readonly hid: string } | { readonly kind: 'remote'; readonly key: SheetKey };

/** The string key of a `HunterRef`: matches `local` hunter id or `remote` sheet key. */
export const refKey = (ref: HunterRef): string => (ref.kind === 'local' ? ref.hunterId : ref.remote);
const payeeKey = (p: PresetPayee): string => (p.kind === 'local' ? p.hid : p.key);

/**
 * Splits `preset`'s checked items among `payees` by `to`.
 * Unchecked items are dropped. Checked items with `to: null` or assigned to a hunter outside `payees` go to `stash`.
 */
export function partitionPresetItems(
  preset: Active,
  payees: readonly PresetPayee[],
): { readonly byPayee: ReadonlyMap<string, readonly ItemTemplate[]>; readonly stash: readonly ItemTemplate[] } {
  const valid = new Set(payees.map(payeeKey));
  const map = new Map<string, ItemTemplate[]>();
  const stash: ItemTemplate[] = [];
  for (const line of preset.items) {
    if (!line.checked) continue;
    const key = line.to ? refKey(line.to) : null;
    if (key && valid.has(key)) {
      const list = map.get(key) ?? [];
      list.push({ ...line.item });
      map.set(key, list);
    } else stash.push({ ...line.item });
  }
  return { byPayee: map, stash };
}

// ── words ──
/** Plain, literal words for the clear preset panel, card summary, clear hand-off, and refusals. */
export const PRESET_WORDS = {
  button: 'Set clear rewards',
  title: 'Clear rewards',
  xpLabel: 'XP per hunter',
  goldLabel: 'Gold per hunter',
  crystalLabel: 'Mana crystal per hunter',
  itemsLabel: 'Items to give',
  payItem: (name: string): string => `Give ${name}`,
  goesTo: 'Goes to',
  itemGoesTo: (dest: string): string => `goes to ${dest}`,
  itemWentTo: (dest: string): string => `went to ${dest}`,
  stash: 'Party stash',
  removeItem: 'Remove item',
  addItemLabel: 'Add an item',
  addItem: 'Add item',
  pickItem: 'Pick an item',
  newItem: 'New item…',
  reset: 'Reset to recommended',
  clear: 'Remove clear rewards',
  closePanel: 'Close panel',
  cancelClear: 'Cancel clear',
  approveLater: 'Approve later',
  edit: 'Edit clear rewards',
  noItems: 'No items in these clear rewards.',
  paidItemsLabel: 'Given clear reward items',
  clearItemsLabel: 'Clear reward items',
  clearedTitle: 'Gate cleared',
  clearedBody: (rank: string, name: string): string => `${rank}-rank gate cleared: ${name}`,
  openWaiting: 'Open Pending rewards',
  waitingLine: (n: number): string => `${n} reward${n === 1 ? ' is' : 's are'} in Pending rewards on the GM screen.`,
  stashedLine: (names: readonly string[]): string => `You put ${names.join(', ')} in the party stash.`,
  rewardedLine: (names: readonly string[]): string => `You rewarded ${names.join(', ')}.`,
  nobodyGotXpGold: 'You picked no hunters, so nobody got XP or gold.',
  nobodyGotRewards: 'You picked no hunters, so nobody got rewards.',
  clearNoteHead: 'Each selected hunter gets ',
  clearNoteMid: ' XP and ',
  clearNoteCrystal: (crystal: number, fmt: (n: number) => string): string => (crystal > 0 ? `, ${fmt(crystal)} mana crystal` : ''),
  clearNoteTail: (inRoom: boolean): string =>
    ` gold from the clear rewards you set. No random loot is rolled for this clear.${inRoom ? ' Approve each hunter\'s share in Pending rewards on the GM screen.' : ''}`,
  clearNoteTailCrystal: (inRoom: boolean): string =>
    ` from the clear rewards you set. No random loot is rolled for this clear.${inRoom ? ' Approve each hunter\'s share in Pending rewards on the GM screen.' : ''}`,
  paidClearNote: 'You already gave this gate\'s clear rewards. Tap Confirm clear to mark the gate cleared without giving rewards again.',
  paidClearedLine: 'You already gave this gate\'s clear rewards, so nobody got rewards again.',
  confirmNoHunters: {
    title: 'Clear with no rewards?',
    body: 'You picked no hunters, so nobody gets rewards.',
    confirmLabel: 'Clear anyway',
  },
  confirmNoHuntersWithStash: {
    title: 'Clear with no hunters?',
    body: 'You picked no hunters, so nobody gets XP or gold. The checked items still go to the party stash.',
    confirmLabel: 'Clear anyway',
  },
  summary: (p: PresetPayload, paid: boolean, fmt: (n: number) => string): string => {
    const checked = p.items.filter(i => i.checked);
    const toStash = checked.filter(i => !i.to).length;
    const itemPart = checked.length ? `${checked.length} item${checked.length === 1 ? '' : 's'}${toStash ? `, ${toStash} to the stash` : ''}` : '';
    const parts = paid && p.xp === 0 && p.gold === 0 && p.crystal === 0
      ? ['nobody got XP or gold']
      : [`${fmt(p.xp)} XP`, `${fmt(p.gold)} gold`, ...(p.crystal > 0 ? [`${fmt(p.crystal)} mana crystal`] : [])];
    if (itemPart) parts.push(itemPart);
    return `${paid ? 'Clear rewards given' : 'Clear rewards'}: ${parts.join(', ')}`;
  },
  refusals: {
    missing: 'This gate no longer exists.',
    'gate-done': 'This gate is cleared or closed, so you cannot change its clear rewards.',
    refused: 'You cannot make this change now. The clear rewards may already be given, or the list already has 20 items.',
    'no-preset': 'This gate has no clear rewards set.',
    'stash-full': 'The party stash is full. Take something out of the stash, or assign the items to hunters first.',
  },
} as const;

// ── boundary parser ──
type Rec = Record<string, unknown>;
const isObj = (v: unknown): v is Rec => v !== null && typeof v === 'object' && !Array.isArray(v);
const inList = <T extends string>(list: readonly T[], v: unknown): T | null =>
  ((list as readonly unknown[]).includes(v) ? (v as T) : null);

function parsePresetItems(v: unknown): PresetItem[] {
  const out: PresetItem[] = [], seen = new Set<string>();
  for (const raw of Array.isArray(v) ? v : []) {
    if (out.length >= PRESET_ITEMS_MAX || !isObj(raw)) continue;
    const id = parsePresetLineId(raw.id);
    const item = parseItem(raw.item);
    if (!id || !item || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, item, checked: raw.checked === true, to: raw.to === null || raw.to === undefined ? null : parseHunterRef(raw.to) });
  }
  return out;
}

/** Reads a stored clear preset at the boundary. Unknown or malformed values fall back to `NO_PRESET`. */
export function parseClearPreset(v: unknown): ClearPreset {
  if (!isObj(v)) return NO_PRESET;
  const at = inList(PRESET_STATES, v.at);
  if (!at || at === 'none') return NO_PRESET;
  const xp = clampAmount(Number(v.xp), REWARD_BOUNDS.xp) ?? 0;
  const gold = clampAmount(Number(v.gold), REWARD_BOUNDS.gold) ?? 0;
  const crystal = clampAmount(Number(v.crystal), REWARD_BOUNDS.crystal) ?? 0;
  const items = parsePresetItems(v.items);
  if (at === 'paid') {
    const paidAt = timeOf(v.paidAt);
    return paidAt ? { at: 'paid', xp, gold, crystal, items, paidAt } : NO_PRESET;
  }
  return { at, xp, gold, crystal, items };
}
