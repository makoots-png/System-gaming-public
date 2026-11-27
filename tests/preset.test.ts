// A gate's clear preset (src/core/gates/preset.ts; the owner, Nov 22): every state against every event, guard refusals,
// save-level guards, loot-rule recommendation, item partitioning, and boundary parsing without leaking to players.
import { describe, expect, test } from 'bun:test';
import { NO_PRESET, PRESET_EVENTS, PRESET_ITEMS_MAX, PRESET_STATES, gatePreset, parseClearPreset, partitionPresetItems, payGatePreset, presetStep } from '../src/core/gates/preset.ts';
import type { ClearPreset, PresetEvent, PresetItem, PresetState } from '../src/core/gates/preset.ts';
import { parseGate, shownOf } from '../src/core/gates/gate.ts';
import { recommendPreset, shareEach } from '../src/core/gates/spawn.ts';
import { builtInItemId, parseSheetKey, presetLineId } from '../src/core/ids.ts';
import type { HunterRef } from '../src/core/ids.ts';
import { lootPool } from '../src/core/registry/items.ts';
import { refGrant, resolveGrant } from '../src/core/registry/item-book.ts';
import type { ItemGrant } from '../src/core/registry/item-book.ts';
import { REWARD_BOUNDS } from '../src/core/rewards.ts';
import { RULES } from '../src/core/rules.ts';
import { freshSave } from '../src/core/save.ts';
import type { Save } from '../src/core/save.ts';
import { isRefused } from '../src/core/save-step.ts';
import type { Refused } from '../src/core/save-step.ts';
import { den } from './models/gate-events.ts';
import { dev, gid, hid } from './fixtures/ids.ts';

const ok = <T>(r: T | Refused): T => { if (isRefused(r)) throw new Error(`refused: ${r.why}`); return r as T; };
const AT = '2026-11-22T20:00:00.000Z';
const POTION = refGrant(builtInItemId('health-potion-e'));
const SWORD = refGrant(builtInItemId('iron-dagger'));
/** The name a grant reads under the shipped rules. */
const nameOf = (g: ItemGrant): string => resolveGrant(g, RULES).name;
const LOCAL_REF: HunterRef = { kind: 'local', hunterId: hid('h1') };
const REMOTE_KEY = parseSheetKey('d-p1:h1')!;
const REMOTE_REF: HunterRef = { kind: 'remote', remote: REMOTE_KEY };

const L1: PresetItem = { id: presetLineId(1), item: POTION, checked: true, to: null };
const L2: PresetItem = { id: presetLineId(2), item: SWORD, checked: true, to: LOCAL_REF };

const REC_STATE: ClearPreset = { at: 'recommended', xp: 150, gold: 100, crystal: 12, items: [L1] };
const EDITED_STATE: ClearPreset = { at: 'edited', xp: 150, gold: 100, crystal: 12, items: [L1] };
const PAID_STATE: ClearPreset = { at: 'paid', xp: 150, gold: 100, crystal: 12, items: [L1], paidAt: AT };
const STATES: { readonly [S in PresetState]: ClearPreset } = { none: NO_PRESET, recommended: REC_STATE, edited: EDITED_STATE, paid: PAID_STATE };

const NEW_REC = { type: 'recommend' as const, xp: 200, gold: 120, crystal: 18, items: [L1] };
const EVENTS: { readonly [E in PresetEvent['type']]: Extract<PresetEvent, { type: E }> } = {
  recommend: NEW_REC,
  setGold: { type: 'setGold', gold: 250 },
  setCrystal: { type: 'setCrystal', crystal: 30 },
  setXp: { type: 'setXp', xp: 300 },
  toggleItem: { type: 'toggleItem', id: presetLineId(1), checked: false },
  assignItem: { type: 'assignItem', id: presetLineId(1), to: LOCAL_REF },
  addItem: { type: 'addItem', item: SWORD, to: REMOTE_REF },
  removeItem: { type: 'removeItem', id: presetLineId(1) },
  clear: { type: 'clear' },
  pay: { type: 'pay', at: AT },
};

const saveWith = (gate = den('detected')): Save => ({
  ...freshSave({ now: new Date(AT), newDeviceToken: () => 'test-device-token-0123456789abcd', newDeviceId: () => dev('d-gm') }, { onboarded: true }),
  gates: [gate],
});

const xpOf = (id: string): number => (id === 'm-goblin' ? 25 : id === 'm-hob' ? 75 : 0);

describe('a gate\'s clear preset machine', () => {
  test('every state answers every event: none takes recommend, active states take all edits/clear/pay, paid is terminal', () => {
    const table = Object.fromEntries(PRESET_STATES.map(s => [s, Object.fromEntries(PRESET_EVENTS.map(e => [e, presetStep(STATES[s], EVENTS[e])]))]));
    const activeExpected = {
      recommend: { at: 'recommended', xp: 200, gold: 120, crystal: 18, items: [L1] },
      setGold: { at: 'edited', xp: 150, gold: 250, crystal: 12, items: [L1] },
      setCrystal: { at: 'edited', xp: 150, gold: 100, crystal: 30, items: [L1] },
      setXp: { at: 'edited', xp: 300, gold: 100, crystal: 12, items: [L1] },
      toggleItem: { at: 'edited', xp: 150, gold: 100, crystal: 12, items: [{ ...L1, checked: false }] },
      assignItem: { at: 'edited', xp: 150, gold: 100, crystal: 12, items: [{ ...L1, to: LOCAL_REF }] },
      addItem: { at: 'edited', xp: 150, gold: 100, crystal: 12, items: [L1, { id: presetLineId(2), item: SWORD, checked: true, to: REMOTE_REF }] },
      removeItem: { at: 'edited', xp: 150, gold: 100, crystal: 12, items: [] },
      clear: NO_PRESET,
      pay: { at: 'paid', xp: 150, gold: 100, crystal: 12, items: [L1], paidAt: AT },
    };
    const nulls = Object.fromEntries(PRESET_EVENTS.map(e => [e, null]));
    expect(table).toEqual({
      none: { ...nulls, recommend: { at: 'recommended', xp: 200, gold: 120, crystal: 18, items: [L1] } },
      recommended: activeExpected,
      edited: activeExpected,
      paid: nulls,
    });
  });

  test('guard refusals: non-finite numbers, clamping, unknown line id, item cap, and bad paidAt', () => {
    expect(presetStep(REC_STATE, { type: 'setGold', gold: Number.NaN })).toBeNull();
    expect(presetStep(REC_STATE, { type: 'setXp', xp: Number.POSITIVE_INFINITY })).toBeNull();
    expect(presetStep(REC_STATE, { type: 'setGold', gold: -50 })).toMatchObject({ at: 'edited', gold: 0 });
    expect(presetStep(REC_STATE, { type: 'setXp', xp: REWARD_BOUNDS.xp + 500 })).toMatchObject({ at: 'edited', xp: REWARD_BOUNDS.xp });
    expect(presetStep(REC_STATE, { type: 'toggleItem', id: presetLineId(99), checked: false })).toBeNull();
    expect(presetStep(REC_STATE, { type: 'assignItem', id: presetLineId(99), to: LOCAL_REF })).toBeNull();
    expect(presetStep(REC_STATE, { type: 'removeItem', id: presetLineId(99) })).toBeNull();
    expect(presetStep(REC_STATE, { type: 'pay', at: 'not-a-date' })).toBeNull();

    let full: ClearPreset = REC_STATE;
    for (let i = 1; i < PRESET_ITEMS_MAX; i++) full = presetStep(full, { type: 'addItem', item: POTION, to: null })!;
    expect(full.at === 'edited' && full.items.length).toBe(PRESET_ITEMS_MAX);
    expect(presetStep(full, { type: 'addItem', item: SWORD, to: null })).toBeNull();
  });

  test('save writers refuse a missing gate, a cleared or closed gate, and a second payment', () => {
    const s0 = saveWith(den('detected'));
    expect(gatePreset(s0, gid('g-missing'), NEW_REC)).toEqual({ ok: false, why: 'missing' });
    expect(gatePreset(saveWith(den('cleared')), gid('g-den'), NEW_REC)).toEqual({ ok: false, why: 'gate-done' });
    expect(gatePreset(saveWith(den('closed')), gid('g-den'), NEW_REC)).toEqual({ ok: false, why: 'gate-done' });
    expect(gatePreset(s0, gid('g-den'), { type: 'setGold', gold: 10 })).toEqual({ ok: false, why: 'refused' });

    const s1 = ok(gatePreset(s0, gid('g-den'), NEW_REC));
    expect(s1.gates[0]!.preset.at).toBe('recommended');
    const paid = ok(payGatePreset(s1, gid('g-den'), AT));
    expect(paid.gates[0]!.preset.at).toBe('paid');
    expect(payGatePreset(paid, gid('g-den'), AT)).toEqual({ ok: false, why: 'refused' });
    expect(gatePreset(paid, gid('g-den'), { type: 'setGold', gold: 999 })).toEqual({ ok: false, why: 'refused' });
  });
});

describe('recommendPreset and item partitioning', () => {
  test('draws gold, XP, and boss items from RULES.loot over lootPool using the caller Random, never a revive crystal', () => {
    const gate = den('detected'); // E-rank, 150 XP due
    const pool = lootPool(RULES);
    const rec = recommendPreset(gate, 2, xpOf, RULES, pool, () => 0);
    const [minGold] = RULES.loot.E.gold;
    expect(rec.type).toBe('recommend');
    expect(rec.xp).toBe(shareEach(150, 2, RULES.gateParty));
    expect(rec.gold).toBe(shareEach(minGold!, 2, RULES.gateParty));
    expect(rec.items.length).toBe(2);
    expect(rec.items.map(i => [i.id, i.checked, i.to])).toEqual([
      [presetLineId(1), true, null],
      [presetLineId(2), true, null],
    ]);
    expect(rec.items.every(i => i.item.kind === 'ref' && !resolveGrant(i.item, RULES).revive)).toBe(true);
  });

  test('partitionPresetItems skips unchecked lines and sends unpicked or absent-hunter items to the party stash', () => {
    const preset: Extract<ClearPreset, { at: 'edited' }> = {
      at: 'edited',
      xp: 100,
      gold: 50,
      crystal: 12,
      items: [
        L1, // checked, to: null -> stash
        L2, // checked, to: LOCAL_REF -> h1
        { id: presetLineId(3), item: POTION, checked: false, to: LOCAL_REF }, // unchecked -> dropped
        { id: presetLineId(4), item: SWORD, checked: true, to: REMOTE_REF }, // checked, remote not in payees -> stash
      ],
    };
    const part = partitionPresetItems(preset, [{ kind: 'local', hid: hid('h1') }]);
    expect(part.byPayee.get(hid('h1'))?.map(nameOf)).toEqual(['Iron Dagger']);
    expect(part.stash.map(nameOf)).toEqual(['Health Potion (E)', 'Iron Dagger']);

    const both = partitionPresetItems(preset, [{ kind: 'local', hid: hid('h1') }, { kind: 'remote', key: REMOTE_KEY }]);
    expect(both.byPayee.get(REMOTE_KEY)?.map(nameOf)).toEqual(['Iron Dagger']);
    expect(both.stash.map(nameOf)).toEqual(['Health Potion (E)']);
  });
});

describe('boundary parsing and player isolation', () => {
  test('parseClearPreset and parseGate round-trip every state, repair malformed inputs, and shownOf never exposes preset', () => {
    for (const s of PRESET_STATES) {
      const g = { ...den('detected'), preset: STATES[s] };
      const parsed = parseGate(JSON.parse(JSON.stringify(g)))!;
      expect(parsed.preset).toEqual(STATES[s]);
      expect('preset' in shownOf(parsed, 60)).toBe(false);
    }
    expect(parseClearPreset(null)).toEqual(NO_PRESET);
    expect(parseClearPreset({ at: 'bogus' })).toEqual(NO_PRESET);
    expect(parseClearPreset({ at: 'paid', xp: 10, gold: 10, items: [], paidAt: 'not-a-date' })).toEqual(NO_PRESET);
    const repaired = parseClearPreset({
      at: 'edited', xp: -5, gold: 1e12,
      items: [
        { id: 'pl1', item: POTION, checked: true, to: null },
        { id: 'pl1', item: SWORD, checked: true, to: null }, // duplicate id dropped
        { id: 'bad', item: POTION, checked: true, to: null }, // bad id dropped
        { id: 'pl2', item: SWORD, checked: true, to: { kind: 'local', hunterId: 'h1' } },
      ],
    });
    expect(repaired).toEqual({
      at: 'edited', xp: 0, gold: REWARD_BOUNDS.gold, crystal: 0,
      items: [
        { id: presetLineId(1), item: POTION, checked: true, to: null },
        { id: presetLineId(2), item: SWORD, checked: true, to: LOCAL_REF },
      ],
    });
  });
});
