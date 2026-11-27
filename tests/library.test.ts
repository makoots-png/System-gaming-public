import { describe, expect, test } from 'bun:test';
import { copyName, duplicateEntry, duplicateFeat, featOff, featOn, removeEntry, removeFeat, removeItemDef, removeStatus, saveById, saveEntry, saveFeat, saveItemDef, saveStatus } from '../src/core/library.ts';
import { BUILT_IN_FEATS } from '../src/core/registry/feats.ts';
import { FEAT_BOUNDS, parseFeat } from '../src/core/hunter/feats.ts';
import { parseFeatKey } from '../src/core/ids.ts';
import type { FeatDef } from '../src/core/hunter/feats.ts';
import { LIMITS, newHunter, newSave } from '../src/core/save.ts';
import type { Library, Save, StatusDef } from '../src/core/save.ts';
import { isRefused } from '../src/core/save-step.ts';
import type { Refused } from '../src/core/save-step.ts';
import { builtInDefData, parseItemDef } from '../src/core/registry/item-book.ts';
import type { ItemDefData } from '../src/core/registry/item-book.ts';
import { parseSkill } from '../src/core/registry/skills.ts';
import type { Skill } from '../src/core/registry/skills.ts';
import type { ItemDefId } from '../src/core/ids.ts';
import { mapId, openArena } from '../src/core/registry/maps.ts';
import { RULES } from '../src/core/rules.ts';
import { parseStory } from '../src/core/story/story.ts';
import type { Story } from '../src/core/story/story.ts';
import type { StoryId } from '../src/core/ids.ts';
import { dev } from './fixtures/ids.ts';
import { DAGGER_DEF_ID, customId, heldRef } from './fixtures/items.ts';

const skill = (id: string, name: string): Skill => ({ ...parseSkill({ name, type: 'passive', desc: '' })!, id } as Skill);
const lib = (skills: Skill[] = []): Library => ({ ...newSave(dev('d')).library, skills });
const frost: StatusDef = { label: 'Frostbite', desc: 'Cold.', ops: [] };
const ok = (r: Library | Refused): Library => {
  if (isRefused(r)) throw new Error(`refused: ${r.why}`);
  return r;
};
const okSave = (r: Save | Refused): Save => {
  if (isRefused(r)) throw new Error(`refused: ${r.why}`);
  return r;
};
const misc = (name: string, more: Partial<ItemDefData> = {}): ItemDefData => ({ ...parseItemDef({ name, type: 'misc' })!, ...more });
/** A save whose library holds `defs` (custom item defs by id, as `saveItemDef` writes them). */
const withDefs = (defs: Record<ItemDefId, ItemDefData> = {}): Save => { const s = newSave(dev('d')); return { ...s, library: { ...s.library, items: defs } }; };
const ROPE = customId('rope'), TORCH = customId('torch');
const names = (s: Save): [string, string][] => Object.entries(s.library.items).map(([k, d]) => [k, d.name]);

describe('a named entry saved to the library, by its id', () => {
  test('a new id is added', () => {
    const r = ok(saveEntry(lib([skill('s1', 'Rope Trick')]), 'skills', skill('s9', 'Torch Toss')));
    expect(r.skills.map(i => [i.id, i.name])).toEqual([['s1', 'Rope Trick'], ['s9', 'Torch Toss']]);
  });
  test('a name another entry holds, in any case, is refused and nothing is replaced: the maker asks', () => {
    const start = lib([skill('s1', 'Rope Trick')]);
    expect(saveEntry(start, 'skills', { ...skill('s9', 'ROPE TRICK'), desc: 'Other words.' })).toEqual({ ok: false, why: 'taken' });
  });
  test('an edit keeps its entry under a new name, and may keep its own name', () => {
    const start = lib([skill('s1', 'Rope Trick'), skill('s2', 'Torch Toss')]);
    expect(ok(saveEntry(start, 'skills', skill('s1', 'Long rope'))).skills.map(i => [i.id, i.name])).toEqual([['s1', 'Long rope'], ['s2', 'Torch Toss']]);
    expect(ok(saveEntry(start, 'skills', { ...skill('s1', 'rope trick'), desc: 'Edited.' })).skills[0]).toMatchObject({ id: 's1', name: 'rope trick', desc: 'Edited.' });
    expect(saveEntry(start, 'skills', skill('s1', 'torch toss')), 'a rename onto another entry\'s name').toEqual({ ok: false, why: 'taken' });
  });
  test('a new entry in a full list is refused and the list is unchanged', () => {
    const full = lib(Array.from({ length: LIMITS.librarySkills }, (_, i) => skill(`s${i}`, `Thing ${i}`)));
    expect(saveEntry(full, 'skills', skill('s999', 'One more'))).toEqual({ ok: false, why: 'full' });
    expect(ok(saveEntry(full, 'skills', skill('s3', 'Thing three'))).skills).toHaveLength(LIMITS.librarySkills);
  });
  test('the library given is not changed', () => {
    const before = lib([skill('s1', 'Rope Trick')]), text = JSON.stringify(before);
    saveEntry(before, 'skills', skill('s9', 'Torch Toss'));
    expect(JSON.stringify(before)).toBe(text);
  });
});

describe('an item def saved to the library, by its id (item sync PR 2)', () => {
  test('a new custom id is added', () => {
    const r = okSave(saveItemDef(withDefs({ [ROPE]: misc('Rope') }), TORCH, misc('Torch'), RULES));
    expect(names(r)).toEqual([[ROPE, 'Rope'], [TORCH, 'Torch']]);
  });
  test('a name another custom item holds, in any case, is refused and nothing is replaced: the maker asks', () => {
    expect(saveItemDef(withDefs({ [ROPE]: misc('Rope') }), TORCH, misc('ROPE', { value: 7 }), RULES)).toEqual({ ok: false, why: 'taken' });
  });
  test('an edit keeps its id under a new name, and may keep its own name', () => {
    const start = withDefs({ [ROPE]: misc('Rope'), [TORCH]: misc('Torch') });
    expect(names(okSave(saveItemDef(start, ROPE, misc('Long rope'), RULES)))).toEqual([[ROPE, 'Long rope'], [TORCH, 'Torch']]);
    expect(okSave(saveItemDef(start, ROPE, misc('rope', { value: 3 }), RULES)).library.items[ROPE]).toMatchObject({ name: 'rope', value: 3 });
    expect(saveItemDef(start, ROPE, misc('torch'), RULES), 'a rename onto another item\'s name').toEqual({ ok: false, why: 'taken' });
  });
  test(`a new def past ${LIMITS.libraryItems} is refused and the library is unchanged; an edit of one held still saves`, () => {
    const full = withDefs(Object.fromEntries(Array.from({ length: LIMITS.libraryItems }, (_, i) => [customId(`thing${String(i).padStart(3, '0')}`), misc(`Thing ${i}`)])));
    expect(saveItemDef(full, customId('onemore'), misc('One more'), RULES)).toEqual({ ok: false, why: 'full' });
    expect(Object.keys(okSave(saveItemDef(full, customId('thing003'), misc('Thing three'), RULES)).library.items)).toHaveLength(LIMITS.libraryItems);
  });
  test('the save given is not changed', () => {
    const before = withDefs({ [ROPE]: misc('Rope') }), text = JSON.stringify(before);
    saveItemDef(before, TORCH, misc('Torch'), RULES);
    expect(JSON.stringify(before)).toBe(text);
  });
  test('a built-in saved as it shipped leaves no entry; an edit of it is held under its id until it is reset', () => {
    const shipped = builtInDefData(DAGGER_DEF_ID, RULES)!;
    expect(okSave(saveItemDef(withDefs(), DAGGER_DEF_ID, shipped, RULES)).library.items).toEqual({});
    const edited = okSave(saveItemDef(withDefs(), DAGGER_DEF_ID, { ...shipped, name: 'Old Dagger' }, RULES));
    expect(names(edited)).toEqual([[DAGGER_DEF_ID, 'Old Dagger']]);
    expect(okSave(saveItemDef(edited, DAGGER_DEF_ID, shipped, RULES)).library.items, 'saved back as shipped').toEqual({});
    expect(okSave(removeItemDef(edited, DAGGER_DEF_ID)).library.items, 'reset').toEqual({});
  });
  test('a built-in edit named like a custom item is not refused: only custom items share the name space', () => {
    const shipped = builtInDefData(DAGGER_DEF_ID, RULES)!;
    expect(isRefused(saveItemDef(withDefs({ [ROPE]: misc('Rope') }), DAGGER_DEF_ID, { ...shipped, name: 'Rope' }, RULES))).toBe(false);
  });
});

describe('an item def taken out of the library (item sync PR 2)', () => {
  test('deleting an id the library lacks is refused', () => {
    expect(removeItemDef(withDefs(), ROPE)).toEqual({ ok: false, why: 'missing' });
  });
  test('a deleted custom item a hunter still holds keeps its def in heardItems, and its id leaves the shop', () => {
    const s0 = withDefs({ [ROPE]: misc('Rope'), [TORCH]: misc('Torch') });
    const s = { ...s0, shop: [ROPE, DAGGER_DEF_ID], hunters: [{ ...newHunter(RULES), items: [heldRef(1, ROPE)] }] };
    const r = okSave(removeItemDef(s, ROPE));
    expect(Object.hasOwn(r.library.items, ROPE)).toBe(false);
    expect(r.heardItems).toEqual({ [ROPE]: misc('Rope') });
    expect(r.shop).toEqual([DAGGER_DEF_ID]);
    const t = okSave(removeItemDef(s, TORCH));
    expect(t.heardItems, 'a deleted item nothing names is not kept').toEqual({});
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

describe('a story in the library (the Workshop\'s Stories)', () => {
  const story = (id: string, name: string): Story => ({ ...parseStory({ name, chapters: [{ words: { title: 'The deep has noticed you' } }] })!, id: id as StoryId });
  const stories = (n: number) => ({ ...lib(), stories: Array.from({ length: n }, (_, i) => story(`st${i}`, `Story ${i}`)) });

  test('saved by its id: a new one is added, an edit keeps its id, and a name another story holds is refused', () => {
    const one = ok(saveEntry(lib(), 'stories', story('st1', 'The wager')));
    const renamed = ok(saveEntry(one, 'stories', story('st1', 'The long wager')));
    expect(renamed.stories.map(s => [s.id, s.name])).toEqual([['st1', 'The long wager']]);
    expect(saveEntry(renamed, 'stories', story('st2', 'the LONG wager'))).toEqual({ ok: false, why: 'taken' });
  });
  test(`the library holds at most ${LIMITS.libraryStories} stories: one more, or a duplicate, is refused`, () => {
    const full = stories(LIMITS.libraryStories);
    expect(saveEntry(full, 'stories', story('st99', 'One more'))).toEqual({ ok: false, why: 'full' });
    expect(duplicateEntry(full, 'stories', 'st0', { newId: 'st99', name: 'Story 0 (copy)' })).toEqual({ ok: false, why: 'full' });
  });
  test('a duplicate then its delete leaves the library as it was', () => {
    const start = stories(2);
    const dup = ok(duplicateEntry(start, 'stories', 'st1', { newId: 'st7', name: copyName('Story 1', start.stories.map(s => s.name), 60) }));
    expect(dup.stories.map(s => [s.id, s.name, s.chapters.length])).toEqual([['st0', 'Story 0', 1], ['st1', 'Story 1', 1], ['st7', 'Story 1 (copy)', 1]]);
    expect(ok(removeEntry(dup, 'stories', 'st7'))).toEqual(start);
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
    const start = lib([skill('s1', 'Rope Trick'), skill('s2', 'Torch Toss')]);
    const dup = ok(duplicateEntry(start, 'skills', 's1', { newId: 's7', name: copyName('Rope Trick', ['Rope Trick', 'Torch Toss'], 60) }));
    expect(dup.skills.map(i => [i.id, i.name])).toEqual([['s1', 'Rope Trick'], ['s2', 'Torch Toss'], ['s7', 'Rope Trick (copy)']]);
    expect(ok(removeEntry(dup, 'skills', 's7'))).toEqual(start);
  });
  test('an item duplicated (a copy under a new id) then deleted leaves the save as it was', () => {
    const start = withDefs({ [ROPE]: misc('Rope'), [TORCH]: misc('Torch') }), copy = customId('ropecopy');
    const dup = okSave(saveItemDef(start, copy, misc(copyName('Rope', ['Rope', 'Torch'], 60)), RULES));
    expect(names(dup)).toEqual([[ROPE, 'Rope'], [TORCH, 'Torch'], [copy, 'Rope (copy)']]);
    expect(okSave(removeItemDef(dup, copy))).toEqual(start);
  });
  test('a saved new entry then its delete leaves the library as it was', () => {
    const start = lib([skill('s1', 'Rope Trick')]);
    const saved = ok(saveEntry(start, 'skills', skill('s9', 'Torch Toss')));
    expect(ok(removeEntry(saved, 'skills', 's9'))).toEqual(start);
  });
  test('a duplicate in a full list is refused, and of a missing id too', () => {
    const full = lib(Array.from({ length: LIMITS.librarySkills }, (_, i) => skill(`s${i}`, `Thing ${i}`)));
    expect(duplicateEntry(full, 'skills', 's0', { newId: 'z', name: 'z' })).toEqual({ ok: false, why: 'full' });
    expect(duplicateEntry(lib(), 'skills', 's0', { newId: 'z', name: 'z' })).toEqual({ ok: false, why: 'missing' });
  });
  test('a copy name is "(copy)" after the name, then "(copy 2)" and on past any name taken in any case, within its bound', () => {
    expect(copyName('Rope', ['Rope'], 60)).toBe('Rope (copy)');
    expect(copyName('Rope', ['Rope', 'rope (COPY)', 'Rope (copy 2)'], 60)).toBe('Rope (copy 3)');
    expect(copyName('Abcdefghij', [], 12)).toBe('Abcde (copy)');
  });
});

describe('a feat turned off and on (the Workshop\'s Turn off and Turn on)', () => {
  const shipped = (key: string): FeatDef => BUILT_IN_FEATS.find(([k]) => k === key)![1];
  const rat = shipped('ratcatcher');
  const changed: FeatDef = { ...rat, name: 'Rat King', rule: { ...rat.rule, reach: 20 } };
  const own: FeatDef = { ...rat, name: 'Beast Week', window: 'THE BEASTS NOTICED' };
  const withFeats = (feats: Record<string, FeatDef>): Library => ({ ...lib(), feats });
  test('Turn off then Turn on leaves the library as it was: an unchanged built-in, a changed one and a GM\'s own', () => {
    for (const [start, key] of [[withFeats({}), 'ratcatcher'], [withFeats({ ratcatcher: changed }), 'ratcatcher'], [withFeats({ 'beast-week': own }), 'beast-week']] as const) {
      const off = ok(featOff(start, key));
      expect(off.feats[key], key).toEqual({ ...(start.feats[key] ?? rat), off: true });
      expect(ok(featOn(off, key)), key).toEqual(start);
    }
  });
  test('an unchanged built-in turned on again leaves the library, so it is listed with the built-ins again', () => {
    const on = ok(featOn(ok(featOff(withFeats({}), 'ratcatcher')), 'ratcatcher'));
    expect(Object.hasOwn(on.feats, 'ratcatcher')).toBe(false);
  });
  test('a feat already off is not turned off again, one on is not turned on, and a key no feat has is refused', () => {
    const off = ok(featOff(withFeats({}), 'ratcatcher'));
    expect(featOff(off, 'ratcatcher')).toEqual({ ok: false, why: 'unchanged' });
    expect(featOn(withFeats({ ratcatcher: changed }), 'ratcatcher')).toEqual({ ok: false, why: 'unchanged' });
    expect(featOn(withFeats({}), 'ratcatcher')).toEqual({ ok: false, why: 'missing' });
    expect(featOff(withFeats({}), 'no-such-feat')).toEqual({ ok: false, why: 'missing' });
  });
  test('a built-in saved as it shipped leaves no entry: an Edit that changes nothing marks nothing changed', () => {
    const parsed = parseFeat(JSON.parse(JSON.stringify(rat)))!;
    expect(ok(saveFeat(withFeats({ ratcatcher: changed }), 'ratcatcher', parsed)).feats).toEqual({});
    expect(ok(saveFeat(withFeats({}), 'ratcatcher', parsed)).feats).toEqual({});
    expect(ok(removeFeat(ok(saveFeat(withFeats({}), 'ratcatcher', changed)), 'ratcatcher')).feats).toEqual({});
  });
  test('Duplicate of a turned-off built-in is the GM\'s own feat, on, under a key of its own, its name within the bound', () => {
    const off = ok(featOff(withFeats({}), 'ratcatcher'));
    const dup = ok(duplicateFeat(off, 'ratcatcher'));
    const [key, copy] = Object.entries(dup.feats).find(([k]) => k !== 'ratcatcher')!;
    expect(copy).toEqual({ ...rat, name: 'Ratcatcher (copy)' });
    expect(parseFeatKey(key) as string | null).toBe(key);
    expect(BUILT_IN_FEATS.some(([k]) => k === key)).toBe(false);
    const long = withFeats({ 'long-one': { ...own, name: 'L'.repeat(FEAT_BOUNDS.name) } });
    const named = Object.values(ok(duplicateFeat(long, 'long-one')).feats).map(d => d.name);
    expect(named).toContain(`${'L'.repeat(FEAT_BOUNDS.name - ' (copy)'.length)} (copy)`);
  });
});
