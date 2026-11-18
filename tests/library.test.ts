import { describe, expect, test } from 'bun:test';
import { copyName, duplicateEntry, removeEntry, removeStatus, saveById, saveEntry, saveStatus } from '../src/core/library.ts';
import { LIMITS, newSave } from '../src/core/save.ts';
import type { Item, Library, StatusDef } from '../src/core/save.ts';
import { isRefused } from '../src/core/save-step.ts';
import type { Refused } from '../src/core/save-step.ts';
import { parseItem } from '../src/core/registry/items.ts';
import { mapId, openArena } from '../src/core/registry/maps.ts';
import { RULES } from '../src/core/rules.ts';
import { dev } from './fixtures/ids.ts';

const item = (id: string, name: string): Item => ({ ...parseItem({ name, type: 'misc' })!, id } as Item);
const lib = (items: Item[] = []): Library => ({ ...newSave(dev('d')).library, items });
const frost: StatusDef = { label: 'Frostbite', desc: 'Cold.', ops: [] };
const ok = (r: Library | Refused): Library => {
  if (isRefused(r)) throw new Error(`refused: ${r.why}`);
  return r;
};

describe('a named entry saved to the library, by its id', () => {
  test('a new id is added', () => {
    const r = ok(saveEntry(lib([item('i1', 'Rope')]), 'items', item('i9', 'Torch')));
    expect(r.items.map(i => [i.id, i.name])).toEqual([['i1', 'Rope'], ['i9', 'Torch']]);
  });
  test('a name another entry holds, in any case, is refused and nothing is replaced: the maker asks', () => {
    const start = lib([item('i1', 'Rope')]);
    expect(saveEntry(start, 'items', { ...item('i9', 'ROPE'), value: 7 })).toEqual({ ok: false, why: 'taken' });
  });
  test('an edit keeps its entry under a new name, and may keep its own name', () => {
    const start = lib([item('i1', 'Rope'), item('i2', 'Torch')]);
    expect(ok(saveEntry(start, 'items', item('i1', 'Long rope'))).items.map(i => [i.id, i.name])).toEqual([['i1', 'Long rope'], ['i2', 'Torch']]);
    expect(ok(saveEntry(start, 'items', { ...item('i1', 'rope'), value: 3 })).items[0]).toMatchObject({ id: 'i1', name: 'rope', value: 3 });
    expect(saveEntry(start, 'items', item('i1', 'torch')), 'a rename onto another entry\'s name').toEqual({ ok: false, why: 'taken' });
  });
  test('a new entry in a full list is refused and the list is unchanged', () => {
    const full = lib(Array.from({ length: LIMITS.libraryItems }, (_, i) => item(`i${i}`, `Thing ${i}`)));
    expect(saveEntry(full, 'items', item('i999', 'One more'))).toEqual({ ok: false, why: 'full' });
    expect(ok(saveEntry(full, 'items', item('i3', 'Thing three'))).items).toHaveLength(LIMITS.libraryItems);
  });
  test('the library given is not changed', () => {
    const before = lib([item('i1', 'Rope')]), text = JSON.stringify(before);
    saveEntry(before, 'items', item('i9', 'Torch'));
    expect(JSON.stringify(before)).toBe(text);
  });
});

describe('a map saved by its id', () => {
  test('a map with a known id is replaced, a new one added', () => {
    const arena = { ...openArena(RULES), id: mapId('mp1'), name: 'Arena' }, start = { ...lib(), maps: [arena] };
    const renamed = ok(saveById(start, 'maps', { ...arena, name: 'Pit' }));
    expect(renamed.maps.map(m => m.name)).toEqual(['Pit']);
    expect(ok(saveById(start, 'maps', { ...arena, id: mapId('mp2') })).maps.map(m => m.id)).toEqual(['mp1', 'mp2']);
  });
});

describe('a library status', () => {
  test('saved under a key, then deleted, leaves the library as it was', () => {
    const start = lib(), saved = ok(saveStatus(start, 'frostbite', frost));
    expect(saved.statuses.frostbite).toEqual(frost);
    expect(ok(removeStatus(saved, 'frostbite'))).toEqual(start);
  });
  test('a new key past the cap is refused; an existing key is still replaced', () => {
    const statuses = Object.fromEntries(Array.from({ length: LIMITS.libraryStatuses }, (_, i) => [`s${i}`, frost]));
    const full = { ...lib(), statuses };
    expect(saveStatus(full, 'one-more', frost)).toEqual({ ok: false, why: 'full' });
    expect(ok(saveStatus(full, 's1', { ...frost, desc: 'Colder.' })).statuses.s1!.desc).toBe('Colder.');
  });
  test('deleting a key the library lacks is refused', () => {
    expect(removeStatus(lib(), 'nothing')).toEqual({ ok: false, why: 'missing' });
  });
});

describe('the Workshop: duplicate and delete', () => {
  test('a duplicate then its delete leaves the library as it was', () => {
    const start = lib([item('i1', 'Rope'), item('i2', 'Torch')]);
    const dup = ok(duplicateEntry(start, 'items', 'i1', { newId: 'i7', name: copyName('Rope', ['Rope', 'Torch'], 60) }));
    expect(dup.items.map(i => [i.id, i.name])).toEqual([['i1', 'Rope'], ['i2', 'Torch'], ['i7', 'Rope (copy)']]);
    expect(ok(removeEntry(dup, 'items', 'i7'))).toEqual(start);
  });
  test('a saved new entry then its delete leaves the library as it was', () => {
    const start = lib([item('i1', 'Rope')]);
    const saved = ok(saveEntry(start, 'items', item('i9', 'Torch')));
    expect(ok(removeEntry(saved, 'items', 'i9'))).toEqual(start);
  });
  test('a duplicate in a full list is refused, and of a missing id too', () => {
    const full = lib(Array.from({ length: LIMITS.libraryItems }, (_, i) => item(`i${i}`, `Thing ${i}`)));
    expect(duplicateEntry(full, 'items', 'i0', { newId: 'z', name: 'z' })).toEqual({ ok: false, why: 'full' });
    expect(duplicateEntry(lib(), 'items', 'i0', { newId: 'z', name: 'z' })).toEqual({ ok: false, why: 'missing' });
  });
  test('a copy name is "(copy)" after the name, then "(copy 2)" and on past any name taken in any case, within its bound', () => {
    expect(copyName('Rope', ['Rope'], 60)).toBe('Rope (copy)');
    expect(copyName('Rope', ['Rope', 'rope (COPY)', 'Rope (copy 2)'], 60)).toBe('Rope (copy 3)');
    expect(copyName('Abcdefghij', [], 12)).toBe('Abcde (copy)');
  });
});
