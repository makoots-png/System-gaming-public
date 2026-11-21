import { describe, expect, test } from 'bun:test';
import { GROUP_WORDS, ICON_PICK_EVENTS, ICON_PICK_STATES, iconPickStart, iconPickStep, iconShown, iconWords, pickerGroups } from '../src/core/icon-pick.ts';
import type { IconPick, IconPickEvent, IconSubject } from '../src/core/icon-pick.ts';
import { ICON_GROUPS } from '../src/core/registry/icons.ts';
import type { IconGroup, IconKey } from '../src/core/registry/icons.ts';
import type { StatusDef } from '../src/core/combat/effect-ops.ts';

const open = (group: IconGroup, pick: IconKey | null = null): IconPick => ({ at: 'open', thing: 'item', pick, group });
const closed = (pick: IconKey | null = null): IconPick => iconPickStart('item', pick);
const words = (s: IconSubject, pick: IconKey | null = null) => iconWords(iconShown(s, pick));
const monster = (type: string, archetype: 'brute' | 'caster' | 'skirmisher' = 'brute'): IconSubject => ({ thing: 'monster', monster: { type, archetype } });
const status = (key: string, def: Pick<StatusDef, 'ops' | 'end'>): IconSubject => ({ thing: 'status', key, def });

describe('the icon picker of a maker', () => {
  test('a maker opens with its picker closed on the pick it was saved with, or none', () => {
    expect(iconPickStart('monster')).toEqual({ at: 'closed', thing: 'monster', pick: null });
    expect(iconPickStart('status', 'raven')).toEqual({ at: 'closed', thing: 'status', pick: 'raven' });
  });

  test('every state against every event: a tap on the row opens it, a group shows that group, a cell picks and closes, Escape or a tap beside it closes and keeps the pick', () => {
    const states: IconPick[] = [closed(), closed('raven'), open('item'), open('foe', 'raven')];
    const events: IconPickEvent[] = [{ kind: 'opened' }, { kind: 'group', group: 'foe' }, { kind: 'group', group: 'item' }, { kind: 'picked', key: 'raven' }, { kind: 'picked', key: null }, { kind: 'shut' }];
    expect(states.map(s => events.map(e => iconPickStep(s, e)))).toEqual([
      [open('item'), closed(), closed(), closed(), closed(), closed()],
      [open('foe', 'raven'), closed('raven'), closed('raven'), closed('raven'), closed('raven'), closed('raven')],
      [open('item'), open('foe'), open('item'), closed('raven'), closed(), closed()],
      [open('foe', 'raven'), open('foe', 'raven'), open('item', 'raven'), closed('raven'), closed(), closed('raven')],
    ]);
  });

  test('a step that changes nothing answers the same value, so the view draws only a change', () => {
    for (const s of [closed(), closed('sword')]) for (const e of [{ kind: 'group', group: 'foe' }, { kind: 'picked', key: 'bow' }, { kind: 'shut' }] as const) expect(iconPickStep(s, e)).toBe(s);
    const at = open('status');
    expect(iconPickStep(at, { kind: 'opened' })).toBe(at);
    expect(iconPickStep(at, { kind: 'group', group: 'status' })).toBe(at);
  });

  test('it opens on the thing\'s own group with no pick, and on the pick\'s group with one, so the pick in use is lit', () => {
    expect(iconPickStep(iconPickStart('monster'), { kind: 'opened' })).toMatchObject({ at: 'open', group: 'foe' });
    expect(iconPickStep(iconPickStart('item'), { kind: 'opened' })).toMatchObject({ at: 'open', group: 'item' });
    expect(iconPickStep(iconPickStart('status'), { kind: 'opened' })).toMatchObject({ at: 'open', group: 'status' });
    expect(iconPickStep(iconPickStart('status', 'raven'), { kind: 'opened' })).toMatchObject({ at: 'open', group: 'foe' });
  });

  test('the row of groups puts the thing\'s own first, then the rest in the registry\'s order, each named once', () => {
    expect(pickerGroups('monster')).toEqual(['foe', 'item', 'status', 'ability', 'emblem']);
    expect(pickerGroups('item')).toEqual(['item', 'foe', 'status', 'ability', 'emblem']);
    expect(pickerGroups('status')).toEqual(['status', 'foe', 'item', 'ability', 'emblem']);
    expect(ICON_GROUPS.map(g => GROUP_WORDS[g])).toEqual(['Foe', 'Item', 'Status', 'Ability', 'Emblem']);
  });

  test('the lists of states and events are every member of the types', () => {
    const kinds: Record<IconPickEvent['kind'], true> = { opened: true, group: true, picked: true, shut: true };
    const ats: Record<IconPick['at'], true> = { closed: true, open: true };
    expect([...ICON_PICK_EVENTS].sort()).toEqual(Object.keys(kinds).sort());
    expect([...ICON_PICK_STATES].sort()).toEqual(Object.keys(ats).sort());
  });
});

describe('the line that says why a thing shows its icon', () => {
  test('a pick is named as picked, whatever the default would be', () => {
    expect(words(monster('Beast'), 'raven')).toBe('Raven, picked');
    expect(words({ thing: 'item', item: { type: 'weapon', slot: 'weapon', attack: 'shot' } }, 'skull')).toBe('Skull, picked');
    expect(words(status('burning', { ops: [] }), 'wolf')).toBe('Wolf, picked');
  });

  test('a monster\'s default comes from its type as typed, any case, else from its archetype', () => {
    expect(words(monster('Beast'))).toBe('Wolf, from its type');
    expect(words(monster('  UNDEAD '))).toBe('Skull, from its type');
    expect(words(monster('Ice', 'brute'))).toBe('Claw, from its archetype');
    expect(words(monster('', 'brute'))).toBe('Claw, from its archetype');
    expect(iconShown(monster('Beast'), null).key).toBe('wolf');
  });

  test('an item\'s default names the field that gives it: how it attacks, its slot, its revive, else its type', () => {
    expect(words({ thing: 'item', item: { type: 'weapon', slot: 'weapon', attack: 'shot' } })).toBe('Bow, from its attack');
    // a weapon that strikes shows the sword every weapon shows: its type gives it as much as its attack
    expect(words({ thing: 'item', item: { type: 'weapon', slot: 'weapon', attack: 'strike' } })).toBe('Sword, from its type');
    expect(words({ thing: 'item', item: { type: 'armor', slot: 'head' } })).toBe('Helm, from its slot');
    expect(words({ thing: 'item', item: { type: 'armor', slot: null } })).toBe('Chestplate, from its type');
    expect(words({ thing: 'item', item: { type: 'consumable', slot: null, revive: true } })).toBe('Crystal, as it revives');
    expect(words({ thing: 'item', item: { type: 'consumable', slot: null } })).toBe('Potion, from its type');
  });

  test('a status\'s default names the built-in it is, else its first effect, else its end, else the plain picture', () => {
    expect(words(status('burning', { ops: [] }))).toBe('Flame, the built-in\'s');
    expect(words(status('ember-mark', { ops: [{ op: 'heal', amount: { kind: 'number', value: 3 }, when: 'turn' }] }))).toBe('Heal, from its first effect');
    expect(words(status('ember-mark', { ops: [], end: { ops: [], cleanse: 'land' } }))).toBe('Timer, from its end');
    expect(words(status('ember-mark', { ops: [] }))).toBe('Status, the default');
  });

  test('a monster\'s, an item\'s or a status\'s own icon in the subject is not the pick: only the pick passed is', () => {
    expect(words({ thing: 'item', item: { type: 'consumable', slot: null, icon: 'raven' } })).toBe('Potion, from its type');
  });
});
