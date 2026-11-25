// A pack of the GM's custom content (src/core/pack.ts): made from a save, read from outside data, merged with Add or Replace.
import { parseFeat } from '../src/core/hunter/feats.ts';
import { BUILT_IN_FEATS } from '../src/core/registry/feats.ts';
import { describe, expect, test } from 'bun:test';
import { PACK_CAP, PACK_WORDS, mergePack, packCounts, packOf, parsePack } from '../src/core/pack.ts';
import type { MergeTarget, Pack, PackKind, PackRead } from '../src/core/pack.ts';
import { SCHEMA, newSave } from '../src/core/save.ts';
import type { Save } from '../src/core/save.ts';
import { writeInto } from '../src/core/save-step.ts';
import { parseItem } from '../src/core/registry/items.ts';
import type { Item } from '../src/core/registry/items.ts';
import { parseMonster } from '../src/core/registry/monsters.ts';
import type { Monster } from '../src/core/registry/monsters.ts';
import type { Skill } from '../src/core/registry/skills.ts';
import { abilityOf } from '../src/core/registry/ability-kinds.ts';
import { abilityId } from '../src/core/combat/ability-types.ts';
import type { Ability } from '../src/core/combat/ability-types.ts';
import { newRewards } from '../src/core/rewards.ts';
import { statusKey } from '../src/core/combat/effect-ops.ts';
import type { StatusDef } from '../src/core/combat/effect-ops.ts';
import { tick } from '../src/core/combat/timeline.ts';
import { RULES } from '../src/core/rules.ts';
import { parseBattleMap } from '../src/core/registry/maps.ts';
import type { BattleMap } from '../src/core/registry/maps.ts';
import { dev, gmKey, iid, mid, rbid, room, skid } from './fixtures/ids.ts';
import { parseStory } from '../src/core/story/story.ts';
import type { Story } from '../src/core/story/story.ts';
import type { StoryId } from '../src/core/ids.ts';

const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const AT = '2026-11-13T10:00:00.000Z';
const FROSTBITE: StatusDef = { label: 'Frostbite', desc: 'Cold eats at you.', ops: [{ op: 'damage', type: 'arcane', amount: { kind: 'dice', count: 1, sides: 6 } }] };
const CHILL: StatusDef = { label: 'Chill', desc: 'Slower in the cold.', ops: [{ op: 'speed', pct: -10 }] };
/** A status that puts Chill on when it lands: a status naming another. */
const DEEP_FREEZE: StatusDef = { label: 'Deep Freeze', desc: 'Frozen through.', ops: [{ op: 'applyStatus', key: statusKey('chill'), def: CHILL, duration: tick(2000) }] };
/** An op that puts the GM's Frostbite on for 3 rounds, under `key`. */
const frostbite = (key = 'frostbite') => ({ op: 'applyStatus' as const, key: statusKey(key), def: FROSTBITE, duration: tick(3 * RULES.fight.round) });
const SHARD: Item = { ...parseItem({ name: 'Frost Shard', type: 'consumable', rar: 'rare' })!, id: iid('i5'), effects: [frostbite()], target: 'other' };
const LANCE_ABILITY = abilityOf('shot', { id: abilityId('frost-lance'), name: 'Frost Lance', ops: [frostbite()] }, RULES);
const LANCE: Skill = { id: skid('s6'), name: 'Frost Lance', type: 'active', level: 1, label: null, desc: '', ability: LANCE_ABILITY };
const WARDEN: Monster = { ...parseMonster({ name: 'Ice Warden', rank: 'C' })!, id: mid('m7'), statuses: [{ key: 'frostbite', rounds: 3 }], abilities: [LANCE_ABILITY] };
/** A walled hall with a patch of ice that puts the GM's Frostbite on, a start for each side, and the party's fog. */
const HALL: BattleMap = parseBattleMap({
  id: 'mp9', name: 'Frost Hall', w: 6, h: 4, tiles: '#######....##.~o.#######', fog: true, starts: { party: [{ x: 1, y: 1 }], foe: [{ x: 4, y: 2 }] },
  zones: [{ id: 'z1', name: 'Ice', ground: { kind: 'tiles', tiles: [{ x: 2, y: 1 }] }, ops: [frostbite()] }],
}, RULES)!;
/** A GM's feat whose reward names the custom status Frostbite. */
const FROST_WARD = parseFeat({ name: 'Frost Ward', window: 'COLD HANDS', desc: 'Ten wolves defeated.', show: { at: 'start' }, rule: { on: 'kill', where: [{ field: 'monster', op: '=', value: 'Wolf' }], reach: 10 }, rewards: { statuses: [{ key: 'frostbite', rounds: 2 }] } })!;
/** A GM's story of two chapters: the first's reward puts Frostbite on, the second issues a quest whose reward puts it on too. */
const WAGER: Story = { ...parseStory({ name: 'The wager', for: 'hunters', chapters: [
  { name: 'The bet', words: { title: 'The house offers a bet', line: 'Win a solo run of your rank.' }, rewards: { points: -1, statuses: [{ key: 'frostbite', rounds: 2 }] } },
  { words: { title: 'The house pays' }, quest: { title: 'Win again', objectives: [{ label: 'Solo run won', target: 1 }], rewards: { statuses: [{ key: 'frostbite', rounds: 1 }] } } },
] })!, id: 'st4' as StoryId };
const HUNT = { id: rbid('rb8'), name: 'Wolf hunt', rewards: { ...newRewards(), xp: 100, boons: [{ name: 'One free reroll', text: 'Reroll one die.' }] } };

/** A GM's save with one custom status, item, skill, monster, reward bundle, map, feat and story. */
function gmSave(): Save {
  const s = newSave(dev('d1'));
  s.seq = 10;
  s.library.statuses = { frostbite: copy(FROSTBITE) };
  s.library.items = [copy(SHARD)];
  s.library.skills = [copy(LANCE)];
  s.library.rewards = [copy(HUNT)];
  s.monsters = [copy(WARDEN)];
  s.library.maps = [copy(HALL)];
  s.library.feats = { 'frost-ward': copy(FROST_WARD) };
  s.library.stories = [copy(WAGER)];
  return s;
}
const read = (v: unknown): Extract<PackRead, { ok: true }> => {
  const r = parsePack(copy(v));
  if (!r.ok) throw new Error(`not read: ${r.why}`);
  return r;
};
const target = (s: Save): MergeTarget => ({ library: s.library, monsters: s.monsters, seq: s.seq });
const noIds = <T extends { id: string }>(xs: T[]): Omit<T, 'id'>[] => xs.map(({ id: _id, ...x }) => x);
const items = (n: number): Partial<Item>[] => Array.from({ length: n }, (_, i) => ({ name: `Junk ${i + 1}` }));

describe('a pack made and read back', () => {
  test('one of each kind arrives on an empty phone as it was made, under new ids', () => {
    const from = gmSave();
    const r = read(packOf(from, AT));
    expect(packCounts(r.pack)).toEqual({ statuses: 1, items: 1, skills: 1, rewards: 1, monsters: 1, maps: 1, feats: 1, stories: 1 });
    const { save } = mergePack(target(newSave(dev('d2'))), r.pack, 'add');
    expect(save.library.statuses).toEqual(from.library.statuses);
    expect(noIds(save.library.items)).toEqual(noIds(from.library.items));
    expect(noIds(save.library.skills)).toEqual(noIds(from.library.skills));
    expect(noIds(save.library.rewards)).toEqual(noIds(from.library.rewards));
    expect(noIds(save.monsters)).toEqual(noIds(from.monsters));
    expect(noIds(save.library.maps)).toEqual(noIds(from.library.maps));
    expect(save.library.feats).toEqual(from.library.feats);
    expect(noIds(save.library.stories)).toEqual(noIds(from.library.stories));
    expect(save.library.items[0]!.id).toBe(iid('i101'));
  });

  test('an icon a GM picked travels on a monster, an item and a status, and one a build lacks is dropped on arrival', () => {
    const from = gmSave();
    from.monsters = [{ ...WARDEN, icon: 'bear' }];
    from.library.items = [{ ...SHARD, icon: 'crystal' }];
    from.library.statuses = { frostbite: { ...FROSTBITE, icon: 'ward' } };
    const { save } = mergePack(target(newSave(dev('d2'))), read(packOf(from, AT)).pack, 'add');
    expect([save.monsters[0]!.icon, save.library.items[0]!.icon, save.library.statuses.frostbite!.icon]).toEqual(['bear', 'crystal', 'ward']);
    const wire = copy(packOf(from, AT)) as { monsters: { icon?: string }[]; library: { items: { icon?: string }[] } };
    wire.monsters[0]!.icon = 'gone'; wire.library.items[0]!.icon = 'gone';
    const later = mergePack(target(newSave(dev('d2'))), read(wire).pack, 'add').save;
    expect(later.monsters[0]).not.toHaveProperty('icon');
    expect(later.library.items[0]).not.toHaveProperty('icon');
  });

  test('a pack holds the library and the monsters only: no hunter, no settings, no room key', () => {
    const from = gmSave();
    from.settings.sync = { ...from.settings.sync, room: room('ABCDEF'), gmKey: gmKey('secret-gm-key') };
    const doc = packOf(from, AT);
    expect(Object.keys(doc).sort()).toEqual(['kind', 'library', 'monsters', 'savedAt', 'schema']);
    expect(JSON.stringify(doc)).not.toContain('secret-gm-key');
    expect(JSON.stringify(doc)).not.toContain('ABCDEF');
  });

  test('one kind holds that kind and the statuses its entries name', () => {
    const doc = packOf(gmSave(), AT, 'items');
    expect(Object.keys(doc.library).sort()).toEqual(['items', 'statuses']);
    expect(doc.library.statuses).toEqual({ frostbite: FROSTBITE });
    expect(doc.monsters).toBeUndefined();
  });

  test('one entry holds that entry alone with the statuses it names, and the statuses those name', () => {
    const s = gmSave();
    s.library.statuses = { frostbite: copy(FROSTBITE), chill: copy(CHILL), 'deep-freeze': copy(DEEP_FREEZE), unrelated: { label: 'Unrelated', desc: '', ops: [] } };
    s.library.items.push({ ...parseItem({ name: 'Freezer' })!, id: iid('i9'), effects: [{ op: 'applyStatus', key: statusKey('deep-freeze'), def: DEEP_FREEZE, duration: tick(1000) }, { op: 'cureStatus', key: statusKey('hasted') }] });
    const doc = packOf(s, AT, 'items', 'i9');
    expect(doc.library.items!.map(i => i.name)).toEqual(['Freezer']);
    expect(Object.keys(doc.library.statuses!).sort()).toEqual(['chill', 'deep-freeze']);
  });

  test('one monster brings its starting status; one status brings only itself when it names none', () => {
    expect(Object.keys(packOf(gmSave(), AT, 'monsters', 'm7').library)).toEqual(['statuses']);
    expect(packOf(gmSave(), AT, 'statuses', 'frostbite').library).toEqual({ statuses: { frostbite: FROSTBITE } });
  });
});

describe('a pack from outside data', () => {
  test('anything but an object of kind library is not a pack, and newer, older, or malformed schemas are refused', () => {
    for (const v of [null, 'HS1.x', 42, [], {}, { kind: 'hunter', hunters: [] }, { schema: 3, library: {} }]) expect(parsePack(v)).toEqual({ ok: false, why: 'not-a-pack' });
    for (const schema of [0, -1, 4.5, Number.NaN, Number.POSITIVE_INFINITY, '4', null]) {
      expect(parsePack({ schema, kind: 'library', library: {} })).toEqual({ ok: false, why: 'not-a-pack' });
    }
    expect(parsePack({ schema: SCHEMA + 1, kind: 'library', library: {} })).toEqual({ ok: false, why: 'newer' });
    expect(parsePack({ schema: SCHEMA - 1, kind: 'library', library: {} })).toEqual({ ok: false, why: 'older' });
  });

  test('parts of the wrong type hold nothing', () => {
    const r = read({ kind: 'library', library: { statuses: [], items: 'x', skills: {}, rewards: 5 }, monsters: { a: 1 } });
    expect(packCounts(r.pack)).toEqual({ statuses: 0, items: 0, skills: 0, rewards: 0, monsters: 0, maps: 0, feats: 0, stories: 0 });
  });

  test('entries the parsers refuse are counted unreadable, and a wrong field takes its default', () => {
    const r = read({
      kind: 'library',
      library: {
        statuses: {
          'Bad Key!': FROSTBITE, dead: FROSTBITE, nolabel: { desc: 'x', ops: [] }, bad: { label: 'Bad', desc: '', ops: [{ op: 'explode', amount: 9 }, { op: 'hold' }] },
          old: { label: 'Old', desc: '', ops: [{ op: 'mod', stat: 'ac', value: -1 }] }, ok: { label: 'Ok', desc: '', ops: [{ op: 'heal', amount: { kind: 'number', value: 2 } }] },
        },
        items: [{ name: '' }, 'sword', { name: 'Sword', qty: 1e12, rar: 'godly' }],
        skills: [{ type: 'active' }, { name: 'Jab', ability: 'punch' }],
        rewards: [{ rewards: {} }, { name: 'Bag', rewards: 'gold' }],
        maps: [{ w: 5 }, { name: 'Pit', w: 99, tiles: 'xyz', sight: -3 }],
        feats: { 'Bad Key!': FROST_WARD, nameless: { ...FROST_WARD, name: '' }, ok: FROST_WARD },
        stories: [{ name: 'No chapters', chapters: [] }, { name: '', chapters: WAGER.chapters }, { name: 'Odd', for: 'everyone', chapters: [{ words: { title: 'Hi' } }] }],
      },
      monsters: [7, { name: 'Rat', tweak: { hp: 'lots' } }],
    });
    expect(r.counts).toEqual({
      statuses: { kept: 1, unreadable: 5, over: 0 }, items: { kept: 1, unreadable: 2, over: 0 }, skills: { kept: 1, unreadable: 1, over: 0 },
      rewards: { kept: 1, unreadable: 1, over: 0 }, monsters: { kept: 1, unreadable: 1, over: 0 }, maps: { kept: 1, unreadable: 1, over: 0 },
      feats: { kept: 1, unreadable: 2, over: 0 }, stories: { kept: 1, unreadable: 2, over: 0 },
    });
    expect(r.pack.stories[0]).toMatchObject({ name: 'Odd', for: 'table', chapters: [{ words: { title: 'HI', line: '' }, quest: null }] });
    expect(r.pack.maps[0]).toMatchObject({ name: 'Pit', w: RULES.fight.grid.w, sight: RULES.fight.sight, fog: false });
    expect(r.pack.statuses.ok!.ops).toEqual([{ op: 'heal', amount: { kind: 'number', value: 2 } }]);
    expect(r.pack.items[0]).toMatchObject({ name: 'Sword', qty: 9999, rar: 'common' });
    expect(r.pack.skills[0]).toMatchObject({ name: 'Jab', type: 'active', ability: null });
    expect(r.pack.rewards[0]!.rewards).toEqual(newRewards());
    expect(r.pack.monsters[0]!.tweak).toEqual({});
  });

  test('500 items keep the first 200 and count 300 over', () => {
    const r = read({ kind: 'library', library: { items: items(500) } });
    expect(r.counts.items).toEqual({ kept: PACK_CAP.items, unreadable: 0, over: 500 - PACK_CAP.items });
    expect(r.pack.items.at(-1)!.name).toBe('Junk 200');
  });

  test('an entry keeps no key its parser does not know, nor an id', () => {
    const r = read({ kind: 'library', library: { items: [{ name: 'Gem', id: 'i1', hunters: [{ name: 'x' }], gmKey: 'k' }] } });
    expect(r.pack.items[0]).not.toHaveProperty('gmKey');
    expect(r.pack.items[0]).not.toHaveProperty('id');
  });
});

describe('merging a pack', () => {
  test('Add keeps both: a name or key that exists arrives as "… 2", and its entries name the renamed status', () => {
    const s = gmSave();
    const { save, report } = mergePack(target(s), read(packOf(s, AT)).pack, 'add');
    expect(save.library.statuses.frostbite).toEqual(FROSTBITE);
    expect(save.library.statuses['frostbite-2']).toEqual({ ...FROSTBITE, label: 'Frostbite 2' });
    expect(save.library.items.map(i => i.name)).toEqual(['Frost Shard', 'Frost Shard 2']);
    expect(save.library.items[0]!.effects).toEqual([frostbite()]);
    expect(save.library.items[1]!.effects).toEqual([frostbite('frostbite-2')]);
    expect(save.library.skills.map(k => k.name)).toEqual(['Frost Lance', 'Frost Lance 2']);
    expect(save.library.skills.map(k => k.type === 'active' && k.ability?.ops)).toEqual([[frostbite()], [frostbite('frostbite-2')]]);
    expect(save.monsters.map(m => m.abilities[0]!.ops)).toEqual([[frostbite()], [frostbite('frostbite-2')]]);
    expect(save.library.rewards.map(b => b.name)).toEqual(['Wolf hunt', 'Wolf hunt 2']);
    expect(save.monsters.map(m => m.name)).toEqual(['Ice Warden', 'Ice Warden 2']);
    expect(save.monsters[1]!.statuses).toEqual([{ key: 'frostbite-2', rounds: 3 }]);
    expect(report.items).toEqual({ added: 1, renamed: 1, replaced: 0, full: 0 });
    expect(new Set(save.library.items.map(i => i.id)).size).toBe(2);
  });

  test('Add a second time makes "… 3"', () => {
    const s = gmSave(), pack = read(packOf(s, AT)).pack;
    const once = mergePack(target(s), pack, 'add').save;
    const twice = mergePack(once, pack, 'add').save;
    expect(twice.library.items.map(i => i.name)).toEqual(['Frost Shard', 'Frost Shard 2', 'Frost Shard 3']);
    expect(Object.values(twice.library.statuses).map(d => d.label)).toEqual(['Frostbite', 'Frostbite 2', 'Frostbite 3']);
  });

  test('Add renames a status whose label a built-in has, and one whose key is a built-in\'s', () => {
    const pack: Pack = { ...read({ kind: 'library' }).pack, statuses: { 'my-poison': { label: 'Poisoned', desc: 'Mine.', ops: [] }, hasted: { label: 'Quick', desc: '', ops: [] } } };
    const { save } = mergePack(target(newSave(dev('d'))), pack, 'add');
    expect(save.library.statuses).toEqual({ 'poisoned-2': { label: 'Poisoned 2', desc: 'Mine.', ops: [] }, 'quick-2': { label: 'Quick 2', desc: '', ops: [] } });
  });

  test('Add renames a status inside the statuses that apply it', () => {
    const s = gmSave();
    s.library.statuses = { chill: copy(CHILL), 'deep-freeze': copy(DEEP_FREEZE) };
    const { save } = mergePack(target(s), read(packOf(s, AT, 'statuses')).pack, 'add');
    expect(save.library.statuses['deep-freeze-2']!.ops[0]).toEqual({ ...DEEP_FREEZE.ops[0]!, key: statusKey('chill-2') });
    expect(save.library.statuses['deep-freeze']!.ops[0]).toEqual(DEEP_FREEZE.ops[0]);
  });

  test('a kit travels whole: a passive skill and a worn item with their worn statuses, a monster\'s starting stacks, and the statuses their triggers, thresholds and ends apply', () => {
    const s = gmSave();
    const ROT: StatusDef = { label: 'Rot', desc: '', ops: [], stack: { cap: 10, leave: { kind: 'never' }, keep: 'fight', threshold: null } };
    const BURST: StatusDef = { label: 'Burst', desc: '', ops: [], stack: { cap: 3, leave: { kind: 'never' }, keep: 'fight',
      threshold: { at: { kind: 'count', n: 3 }, to: { kind: 'bearer' }, then: 'spend', ops: [{ op: 'applyStatus', key: statusKey('chill'), def: CHILL, duration: null }] } } };
    const LATE: StatusDef = { label: 'Late', desc: '', ops: [], end: { ops: [{ op: 'applyStatus', key: statusKey('rot'), def: ROT, duration: null, stacks: 2 }], cleanse: 'cancel' } };
    const worn: StatusDef = { label: 'Festering', desc: '', ops: [],
      triggers: [{ on: 'hitDealt', tag: null, to: 'other', limit: { kind: 'each' }, ops: [{ op: 'applyStatus', key: statusKey('rot'), def: ROT, duration: null }] }] };
    s.library.statuses = { rot: ROT, chill: CHILL, burst: BURST, late: LATE };
    s.library.skills = [{ id: skid('s1'), name: 'Festering', type: 'passive', level: 1, label: null, desc: '', bonus: {}, worn }];
    s.library.items = [{ ...parseItem({ name: 'Burst Ring', type: 'accessory', slot: 'ring1' })!, id: iid('i1'), worn: { ...worn, triggers: [{ ...worn.triggers![0]!, ops: [{ op: 'applyStatus', key: statusKey('burst'), def: BURST, duration: null }] }] } }];
    s.monsters = [{ ...parseMonster({ name: 'Einar', rank: 'C' })!, id: mid('m1'), statuses: [{ key: 'late', rounds: 2, stacks: 3 }] }];
    expect(Object.keys(packOf(s, AT, 'skills', 's1').library.statuses!)).toEqual(['rot']);
    expect(Object.keys(packOf(s, AT, 'items', 'i1').library.statuses!)).toEqual(['chill', 'burst']);
    expect(Object.keys(packOf(s, AT, 'monsters', 'm1').library.statuses!)).toEqual(['rot', 'late']);
    const r = read(packOf(s, AT));
    expect(r.pack.skills[0]).toEqual(noIds(s.library.skills)[0]!);
    expect(r.pack.items[0]!.worn).toEqual(s.library.items[0]!.worn!);
    expect(r.pack.monsters[0]!.statuses).toEqual([{ key: 'late', rounds: 2, stacks: 3 }]);
    const { save } = mergePack(target(s), r.pack, 'add');
    const skill = save.library.skills.find(k => k.name === 'Festering 2')!;
    expect(skill.type === 'passive' && skill.worn?.triggers?.[0]!.ops[0]).toMatchObject({ op: 'applyStatus', key: 'rot-2' });
    expect(save.library.statuses['burst-2']!.stack!.threshold!.ops[0]).toMatchObject({ key: 'chill-2' });
    expect(save.library.statuses['late-2']!.end!.ops[0]).toMatchObject({ key: 'rot-2', stacks: 2 });
  });

  test('Replace overwrites the status with the same key and the entry with the same name, keeping its id', () => {
    const s = gmSave();
    const pack = read(packOf(s, AT)).pack;
    pack.statuses.frostbite = { ...pack.statuses.frostbite!, desc: 'Colder now.' };
    pack.items[0]!.rar = 'epic';
    pack.monsters[0]!.xp = 300;
    const { save, report } = mergePack(target(s), pack, 'replace');
    expect(save.library.statuses).toEqual({ frostbite: { ...FROSTBITE, desc: 'Colder now.' } });
    expect(save.library.items).toEqual([{ ...SHARD, rar: 'epic' }]);
    expect(save.monsters.map(m => [m.id, m.xp])).toEqual([['m7', 300]]);
    expect(report.items).toEqual({ added: 0, renamed: 0, replaced: 1, full: 0 });
    expect(save.seq).toBe(s.seq);
  });

  test('Replace adds what has no match, and the same pack replaced twice changes nothing the second time', () => {
    const pack = read(packOf(gmSave(), AT)).pack;
    const s = newSave(dev('d2'));
    s.library.items = [{ ...parseItem({ name: 'Rope' })!, id: iid('i3') }];
    const once = mergePack(target(s), pack, 'replace');
    expect(once.save.library.items.map(i => i.name)).toEqual(['Rope', 'Frost Shard']);
    const twice = mergePack(once.save, pack, 'replace');
    expect(twice.save).toEqual(once.save);
    expect(twice.report.items).toEqual({ added: 0, renamed: 0, replaced: 1, full: 0 });
  });

  test('a merge never grows a list past its cap, and counts what did not fit', () => {
    const s = newSave(dev('d'));
    s.library.items = items(PACK_CAP.items - 1).map((it, i) => ({ ...parseItem(it)!, id: iid(`i${i + 1}`) }));
    const pack = read({ kind: 'library', library: { items: [{ name: 'Junk 1' }, { name: 'New A' }, { name: 'New B' }] } }).pack;
    const add = mergePack(target(s), pack, 'add');
    expect(add.save.library.items.length).toBe(PACK_CAP.items);
    expect(add.report.items).toEqual({ added: 1, renamed: 1, replaced: 0, full: 2 });
    const replace = mergePack(target(s), pack, 'replace');
    expect(replace.save.library.items.length).toBe(PACK_CAP.items);
    expect(replace.report.items).toEqual({ added: 1, renamed: 0, replaced: 1, full: 1 });
  });

  test('a full status library takes no new status, and Replace still overwrites one it holds', () => {
    const s = newSave(dev('d'));
    for (let i = 0; i < PACK_CAP.statuses; i++) s.library.statuses[`s-${i}`] = { label: `S ${i}`, desc: '', ops: [] };
    const pack = read({ kind: 'library', library: { statuses: { 's-0': { label: 'S 0', desc: 'new', ops: [] }, fresh: { label: 'Fresh', desc: '', ops: [] } } } }).pack;
    const r = mergePack(target(s), pack, 'replace');
    expect(Object.keys(r.save.library.statuses).length).toBe(PACK_CAP.statuses);
    expect(r.save.library.statuses['s-0']!.desc).toBe('new');
    expect(r.report.statuses).toEqual({ added: 0, renamed: 0, replaced: 1, full: 1 });
  });

  test('the status an imported item applies arrives with it when the pack holds it', () => {
    const { save } = mergePack(target(newSave(dev('d'))), read(packOf(gmSave(), AT, 'items', 'i5')).pack, 'add');
    expect(save.library.statuses).toEqual({ frostbite: FROSTBITE });
    expect(save.library.items[0]!.effects).toEqual(SHARD.effects);
  });

  test('when the pack does not hold the status, the item\'s op is kept as it was, its own def included', () => {
    const def = { label: 'Numb', desc: 'Cannot feel.', ops: [] };
    const numb = { op: 'applyStatus' as const, key: statusKey('numb'), def, duration: tick(2000) };
    const pack = read({ kind: 'library', library: { items: [{ name: 'Numbing Dart', effects: [numb] }] } }).pack;
    const { save } = mergePack(target(newSave(dev('d'))), pack, 'add');
    expect(save.library.statuses).toEqual({});
    expect(save.library.items[0]!.effects).toEqual([numb]);
  });

  test('the save given to a merge is not changed', () => {
    const s = gmSave(), before = copy(s);
    mergePack(target(s), read(packOf(s, AT)).pack, 'add');
    mergePack(target(s), read(packOf(s, AT)).pack, 'replace');
    expect(s).toEqual(before);
  });

  test('merging into a full save returns the whole save so writeInto keeps every other field intact', () => {
    const from = gmSave();
    const live = newSave(dev('d2')) as Save & { futureField?: { keep: boolean } };
    live.futureField = { keep: true };
    const beforeKeys = Object.keys(live).sort();
    const huntersRef = live.hunters;
    const merged = mergePack(live, read(packOf(from, AT)).pack, 'add');
    expect(Object.keys(merged.save).sort()).toEqual(beforeKeys);
    expect(merged.save.futureField).toEqual({ keep: true });
    writeInto(live, merged.save);
    expect(Object.keys(live).sort()).toEqual(beforeKeys);
    expect(live.hunters).toBe(huntersRef);
    expect(live.futureField).toEqual({ keep: true });
    expect(live.library.items.map(i => i.name)).toEqual(['Frost Shard']);
    expect(live.monsters.map(m => m.name)).toEqual(['Ice Warden']);
  });
});

describe('a status named anywhere in a shared thing travels with it', () => {
  const ROT: StatusDef = { label: 'Rot', desc: 'Flesh decays.', ops: [{ op: 'damage', type: 'physical', amount: { kind: 'number', value: 1 } }], stack: { cap: 5, leave: { kind: 'never' }, keep: 'fight', threshold: null } };
  /** The other phone's own status under the same key, so Add must rename the pack's Rot to "Rot 2" under `rot-2`. */
  const RUST: StatusDef = { label: 'Rust', desc: 'Metal flakes.', ops: [] };
  const rot = statusKey('rot');
  const apply = { op: 'applyStatus', key: rot, def: ROT, duration: null } as const;
  const heal = { op: 'heal', amount: { kind: 'number', value: 1 } } as const;
  const each = { kind: 'each' } as const;
  const one = (n: number) => ({ kind: 'number', value: n }) as const;
  const active = (extra: Partial<Ability>): Skill => ({ id: skid('s1'), name: 'Rotting Touch', type: 'active', level: 1, label: null, desc: '',
    ability: { ...abilityOf('strike', { id: abilityId('rotting-touch'), name: 'Rotting Touch' }, RULES), ...extra } });
  const passive = (def: Omit<StatusDef, 'label' | 'desc'>): Skill => ({ id: skid('s1'), name: 'Hunger', type: 'passive', level: 1, label: null, desc: '', bonus: {},
    worn: { label: 'Hunger', desc: '', ...def } as StatusDef });
  const zone = { name: 'Mire', duration: null, ops: [], endsWithOwner: false, around: null, grow: null };
  const bundle = (def: Omit<StatusDef, 'label' | 'desc'>) => ({ id: rbid('rb1'), name: 'Spoils', rewards: { ...newRewards(), statuses: [{ key: statusKey('marked'), rounds: 2, def: { label: 'Marked', desc: '', ...def } as StatusDef }] } });
  const hall = (z: object): BattleMap => parseBattleMap({ id: 'mp1', name: 'Bog', w: 4, h: 4, zones: [{ id: 'z1', name: 'Bog', ground: { kind: 'tiles', tiles: [{ x: 1, y: 1 }] }, ops: [], ...z }] }, RULES)!;
  type Case = { where: string; kind: PackKind; name: string; put: (s: Save) => void };
  const CASES: Case[] = [
    { where: 'the ops of the zone an ability leaves', kind: 'skills', name: 'Rotting Touch', put: s => { s.library.skills = [active({ zone: { ...zone, ops: [apply] } })]; } },
    { where: 'a trigger of the zone an ability leaves', kind: 'skills', name: 'Rotting Touch', put: s => { s.library.skills = [active({ zone: { ...zone, triggers: [{ on: 'turnStart', to: 'self', limit: each, ops: [apply] }] } })]; } },
    { where: 'the end of the zone an ability leaves', kind: 'skills', name: 'Rotting Touch', put: s => { s.library.skills = [active({ zone: { ...zone, end: [apply] } })]; } },
    { where: 'an ability\'s price in stacks', kind: 'skills', name: 'Rotting Touch', put: s => { s.library.skills = [active({ prices: [{ kind: 'stacks', key: rot, from: 'self', take: { kind: 'n', n: 1 } }] })]; } },
    { where: 'an ability\'s condition that a status is held', kind: 'skills', name: 'Rotting Touch', put: s => { s.library.skills = [active({ gates: [{ kind: 'holds', key: rot, on: 'self', atLeast: 1 }] })]; } },
    { where: 'the starting statuses of an ability\'s summon', kind: 'skills', name: 'Rotting Touch', put: s => { s.library.skills = [active({ summon: { name: 'Ghoul', archetype: 'brute', rounds: 2, statuses: [{ key: rot, rounds: 2 }] } })]; } },
    { where: 'the status a move op takes', kind: 'skills', name: 'Rotting Touch', put: s => { s.library.skills = [active({ ops: [{ op: 'move', key: rot, take: 'all', from: 'target', as: null }] })]; } },
    { where: 'the status a move op turns its stacks into', kind: 'skills', name: 'Rotting Touch', put: s => { s.library.skills = [active({ ops: [{ op: 'move', key: 'harmful', take: 'all', from: 'target', as: rot }] })]; } },
    { where: 'an ability\'s hand formula', kind: 'skills', name: 'Rotting Touch', put: s => { s.library.skills = [active({ effect: { type: 'physical', by: 'hand', formula: { kind: 'stacks', whose: 'target', key: rot } } })]; } },
    { where: 'the formula of an ability\'s op', kind: 'skills', name: 'Rotting Touch', put: s => { s.library.skills = [active({ ops: [{ op: 'shield', amount: { kind: 'field', key: rot } }] })]; } },
    { where: 'one tier of a worn status\'s op formula', kind: 'skills', name: 'Hunger', put: s => { s.library.skills = [passive({ ops: [{ op: 'damage', type: 'arcane', amount: [one(1), one(2), one(3), one(4), one(5), { kind: 'held', key: rot }] }] })]; } },
    { where: 'a worn status\'s trigger on a status gained', kind: 'skills', name: 'Hunger', put: s => { s.library.skills = [passive({ ops: [], triggers: [{ on: 'statusGained', key: rot, to: 'self', limit: each, ops: [heal] }] })]; } },
    { where: 'a worn status\'s trigger that needs a status held', kind: 'skills', name: 'Hunger', put: s => { s.library.skills = [passive({ ops: [], triggers: [{ on: 'turnStart', to: 'self', limit: each, need: { kind: 'holds', key: rot }, ops: [heal] }] })]; } },
    { where: 'a worn status\'s threshold formula', kind: 'skills', name: 'Hunger', put: s => {
      s.library.skills = [passive({ ops: [], stack: { cap: 5, leave: { kind: 'never' }, keep: 'fight', threshold: { at: { kind: 'formula', formula: { kind: 'stacks', whose: 'user', key: rot } }, to: { kind: 'bearer' }, ops: [heal], then: 'spend' } } })];
    } },
    { where: 'the formula of an item\'s use', kind: 'items', name: 'Rot Salve', put: s => { s.library.items = [{ ...parseItem({ name: 'Rot Salve', type: 'consumable' })!, id: iid('i1'), effects: [{ op: 'heal', amount: { kind: 'stacks', whose: 'user', key: rot } }] }]; } },
    { where: 'a library status\'s trigger on a status ended', kind: 'statuses', name: 'hunger', put: s => { s.library.statuses.hunger = { label: 'Hunger', desc: '', ops: [], triggers: [{ on: 'statusEnded', key: rot, to: 'self', limit: each, ops: [heal] }] }; } },
    { where: 'a trigger of a reward status\'s def', kind: 'rewards', name: 'Spoils', put: s => { s.library.rewards = [bundle({ ops: [], triggers: [{ on: 'struck', tag: null, to: 'self', limit: each, ops: [apply] }] })]; } },
    { where: 'the threshold of a reward status\'s def', kind: 'rewards', name: 'Spoils', put: s => {
      s.library.rewards = [bundle({ ops: [], stack: { cap: 3, leave: { kind: 'never' }, keep: 'fight', threshold: { at: { kind: 'count', n: 3 }, to: { kind: 'bearer' }, ops: [apply], then: 'spend' } } })];
    } },
    { where: 'the end of a reward status\'s def', kind: 'rewards', name: 'Spoils', put: s => { s.library.rewards = [bundle({ ops: [], end: { ops: [apply], cleanse: 'cancel' } })]; } },
    { where: 'the worn status of a reward\'s title', kind: 'rewards', name: 'Spoils', put: s => {
      s.library.rewards = [{ id: rbid('rb1'), name: 'Spoils', rewards: { ...newRewards(), title: { name: 'Plague Bearer', desc: '', bonus: {}, worn: { label: 'Plague', desc: '', ops: [], triggers: [{ on: 'hitDealt', tag: null, to: 'other', limit: each, ops: [apply] }] } } } }];
    } },
    { where: 'the active of a worn item (powers.ts)', kind: 'items', name: 'Rot Ring', put: s => {
      s.library.items = [{ ...parseItem({ name: 'Rot Ring', type: 'accessory', slot: 'ring1' })!, id: iid('i1'), active: { ...LANCE_ABILITY, ops: [apply] } }];
    } },
    { where: 'the active of a reward\'s title (powers.ts)', kind: 'rewards', name: 'Spoils', put: s => {
      s.library.rewards = [{ id: rbid('rb1'), name: 'Spoils', rewards: { ...newRewards(), title: { name: 'Plague Bearer', desc: '', bonus: {}, active: { ...LANCE_ABILITY, ops: [apply] } } } }];
    } },
    { where: 'a monster ability\'s condition', kind: 'monsters', name: 'Ghoul', put: s => {
      s.monsters = [{ ...parseMonster({ name: 'Ghoul', rank: 'C' })!, id: mid('m1'), abilities: [{ ...LANCE_ABILITY, ops: [], gates: [{ kind: 'holds', key: rot, on: 'target', atLeast: 2 }] }] }];
    } },
    { where: 'a trigger of a map\'s zone', kind: 'maps', name: 'Bog', put: s => { s.library.maps = [hall({ triggers: [{ on: 'turnStart', to: 'self', limit: each, ops: [apply] }] })]; } },
    { where: 'the end of a map\'s zone', kind: 'maps', name: 'Bog', put: s => { s.library.maps = [hall({ end: [apply] })]; } },
    { where: 'what a story\'s quest takes when it fails', kind: 'stories', name: 'The debt', put: s => {
      s.library.stories = [{ ...parseStory({ name: 'The debt', for: 'hunters', chapters: [{ words: { title: 'Pay up' }, quest: { title: 'Pay', objectives: [{ label: 'Paid', target: 1 }], onFail: { statuses: [{ key: 'rot', rounds: 3 }] } } }] })!, id: 'st1' as StoryId }];
    } },
  ];
  /** The thing of `kind` called `name` (a status or a feat by its key). */
  const thing = (s: Pick<Save, 'library' | 'monsters'>, kind: PackKind, name: string): unknown => {
    if (kind === 'statuses' || kind === 'feats') return s.library[kind][name];
    const list: readonly { name: string }[] = kind === 'monsters' ? s.monsters : s.library[kind];
    return list.find(x => x.name === name);
  };
  /** How many times `key` is written as a whole value in `v`: each place it names that status. */
  const named = (v: unknown, key: string): number => JSON.stringify(v).split(`"${key}"`).length - 1;

  for (const c of CASES) {
    test(`a status named in ${c.where} travels with the shared ${PACK_WORDS[c.kind][0]}, named under its new key when Add renames it`, () => {
      const from = newSave(dev('d1'));
      from.seq = 10;
      from.library.statuses = { rot: copy(ROT) };
      c.put(from);
      const sent = thing(from, c.kind, c.name);
      expect(named(sent, 'rot')).toBeGreaterThan(0);
      const there = newSave(dev('d2'));
      there.library.statuses = { rot: copy(RUST) };
      const { save } = mergePack(target(there), read(packOf(from, AT, c.kind, c.kind === 'statuses' ? c.name : (thing(from, c.kind, c.name) as { id: string }).id)).pack, 'add');
      expect(save.library.statuses.rot).toEqual(RUST);
      expect(save.library.statuses['rot-2']).toEqual({ ...ROT, label: 'Rot 2' });
      const got = thing(save, c.kind, c.name);
      expect({ rot: named(got, 'rot'), 'rot-2': named(got, 'rot-2') }).toEqual({ rot: 0, 'rot-2': named(sent, 'rot') });
    });
  }
});

describe('feats in a pack', () => {
  test('one feat brings the status its reward names; Add of a feat whose key the library holds arrives as "Frost Ward 2", Replace overwrites it', () => {
    const from = gmSave();
    const one = read(packOf(from, AT, 'feats', 'frost-ward'));
    expect(packCounts(one.pack)).toMatchObject({ feats: 1, statuses: 1 });
    const added = mergePack(target(from), one.pack, 'add');
    expect(Object.keys(added.save.library.feats).sort()).toEqual(['frost-ward', 'frost-ward-2']);
    expect(added.save.library.feats['frost-ward-2']!.name).toBe('Frost Ward 2');
    expect(added.report.feats).toEqual({ added: 1, renamed: 1, replaced: 0, full: 0 });
    const changed = { ...one.pack, feats: { 'frost-ward': { ...FROST_WARD, desc: 'Twenty wolves.' } } };
    const replaced = mergePack(target(from), changed, 'replace');
    expect(replaced.save.library.feats).toEqual({ 'frost-ward': { ...FROST_WARD, desc: 'Twenty wolves.' } });
    expect(mergePack({ ...target(from), library: replaced.save.library }, changed, 'replace').save.library.feats).toEqual(replaced.save.library.feats);
  });
  test('a pack holding a built-in as it shipped leaves no entry, and Replace of a changed one brings it back as shipped; a built-in turned off arrives off', () => {
    const from = gmSave(), shipped = BUILT_IN_FEATS.find(([k]) => k === 'ratcatcher')![1];
    const holding = (feats: Record<string, unknown>) => read({ ...packOf(from, AT, 'feats'), library: { feats } }).pack;
    const none = { added: 0, renamed: 0, replaced: 0, full: 0 };
    for (const mode of ['add', 'replace'] as const) {
      const m = mergePack(target(from), holding({ ratcatcher: shipped }), mode);
      expect(m.save.library.feats).toEqual(from.library.feats);
      expect(m.report.feats).toEqual(none);
    }
    const changed = { ...target(from), library: { ...from.library, feats: { ...from.library.feats, ratcatcher: { ...shipped, rule: { ...shipped.rule, reach: 40 } } } } };
    const back = mergePack(changed, holding({ ratcatcher: shipped }), 'replace');
    expect(back.save.library.feats).toEqual(from.library.feats);
    expect(back.report.feats).toEqual({ ...none, replaced: 1 });
    const off = mergePack(target(from), holding({ ratcatcher: { ...shipped, off: true } }), 'add');
    expect(off.save.library.feats).toEqual({ ...from.library.feats, ratcatcher: { ...shipped, off: true } });
    expect(off.report.feats).toEqual({ ...none, added: 1 });
  });
});

describe('stories in a pack', () => {
  test('one story travels whole with the statuses its chapters\' rewards and quests name, without its id', () => {
    const doc = packOf(gmSave(), AT, 'stories', 'st4');
    expect(Object.keys(doc.library).sort()).toEqual(['statuses', 'stories']);
    expect(doc.library.statuses).toEqual({ frostbite: FROSTBITE });
    expect(read(doc).pack.stories).toEqual(noIds([WAGER]));
    expect(JSON.stringify(doc.library.stories)).not.toContain('st4');
  });

  test('Add of a story whose name the library holds arrives as "The wager 2" under a new id, its chapters naming the renamed status', () => {
    const s = gmSave();
    const { save, report } = mergePack(target(s), read(packOf(s, AT)).pack, 'add');
    expect(save.library.stories.map(x => x.name)).toEqual(['The wager', 'The wager 2']);
    expect(new Set(save.library.stories.map(x => x.id)).size).toBe(2);
    const [kept, added] = save.library.stories;
    expect(kept).toEqual(WAGER);
    expect([added!.chapters[0]!.rewards.statuses[0]!.key, added!.chapters[1]!.quest!.rewards.statuses[0]!.key]).toEqual(['frostbite-2', 'frostbite-2']);
    expect(added!.chapters[0]!.rewards.points).toBe(-1);
    expect(report.stories).toEqual({ added: 1, renamed: 1, replaced: 0, full: 0 });
  });

  test('Replace overwrites the story of the same name and keeps its id; replaced twice changes nothing the second time', () => {
    const s = gmSave(), pack = read(packOf(s, AT, 'stories')).pack;
    const changed = { ...pack, stories: [{ ...pack.stories[0]!, when: 'When a hunter bets.' }] };
    const once = mergePack(target(s), changed, 'replace');
    expect(once.save.library.stories).toEqual([{ ...WAGER, when: 'When a hunter bets.' }]);
    expect(once.report.stories).toEqual({ added: 0, renamed: 0, replaced: 1, full: 0 });
    expect(mergePack(once.save, changed, 'replace').save).toEqual(once.save);
  });

  test(`a pack holds at most ${PACK_CAP.stories} stories, and a full library takes no more`, () => {
    const r = read({ kind: 'library', library: { stories: Array.from({ length: 40 }, (_, i) => ({ name: `S${i}`, chapters: [{ words: { title: 'T' } }] })) } });
    expect(r.counts.stories).toEqual({ kept: PACK_CAP.stories, unreadable: 0, over: 40 - PACK_CAP.stories });
    const full = newSave(dev('d'));
    full.library.stories = r.pack.stories.map((x, i) => ({ ...x, name: `Mine ${i}`, id: `st${i + 1}` as StoryId }));
    const merged = mergePack(target(full), { ...r.pack, stories: r.pack.stories.slice(0, 2) }, 'add');
    expect([merged.save.library.stories.length, merged.report.stories.full]).toEqual([PACK_CAP.stories, 2]);
  });
});
