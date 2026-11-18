// A pack of the GM's custom content (src/core/pack.ts): made from a save, read from outside data, merged with Add or Replace.
import { parseFeat } from '../src/core/hunter/feats.ts';
import { describe, expect, test } from 'bun:test';
import { PACK_CAP, mergePack, packCounts, packOf, parsePack } from '../src/core/pack.ts';
import type { MergeTarget, Pack, PackRead } from '../src/core/pack.ts';
import { SCHEMA, newSave } from '../src/core/save.ts';
import type { Save } from '../src/core/save.ts';
import { parseItem } from '../src/core/registry/items.ts';
import type { Item } from '../src/core/registry/items.ts';
import { parseMonster } from '../src/core/registry/monsters.ts';
import type { Monster } from '../src/core/registry/monsters.ts';
import type { Skill } from '../src/core/registry/skills.ts';
import { abilityOf } from '../src/core/registry/ability-kinds.ts';
import { abilityId } from '../src/core/combat/ability-types.ts';
import { newRewards } from '../src/core/rewards.ts';
import { statusKey } from '../src/core/combat/effect-ops.ts';
import type { StatusDef } from '../src/core/combat/effect-ops.ts';
import { tick } from '../src/core/combat/timeline.ts';
import { RULES } from '../src/core/rules.ts';
import { parseBattleMap } from '../src/core/registry/maps.ts';
import type { BattleMap } from '../src/core/registry/maps.ts';
import { dev, gmKey, iid, mid, rbid, room, skid } from './fixtures/ids.ts';

const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const AT = '2026-11-13T10:00:00.000Z';
const FROSTBITE: StatusDef = { label: 'Frostbite', desc: 'Cold eats at you.', ops: [{ op: 'damage', type: 'magical', amount: { kind: 'dice', count: 1, sides: 6 } }] };
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
const HUNT = { id: rbid('rb8'), name: 'Wolf hunt', rewards: { ...newRewards(), xp: 100, boons: [{ name: 'One free reroll', text: 'Reroll one die.' }] } };

/** A GM's save with one custom status, item, skill, monster, reward bundle and map. */
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
    expect(packCounts(r.pack)).toEqual({ statuses: 1, items: 1, skills: 1, rewards: 1, monsters: 1, maps: 1, feats: 1 });
    const { save } = mergePack(target(newSave(dev('d2'))), r.pack, 'add');
    expect(save.library.statuses).toEqual(from.library.statuses);
    expect(noIds(save.library.items)).toEqual(noIds(from.library.items));
    expect(noIds(save.library.skills)).toEqual(noIds(from.library.skills));
    expect(noIds(save.library.rewards)).toEqual(noIds(from.library.rewards));
    expect(noIds(save.monsters)).toEqual(noIds(from.monsters));
    expect(noIds(save.library.maps)).toEqual(noIds(from.library.maps));
    expect(save.library.feats).toEqual(from.library.feats);
    expect(save.library.items[0]!.id).toBe(iid('i101'));
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
  test('anything but an object of kind library is not a pack, and a newer schema is refused', () => {
    for (const v of [null, 'HS1.x', 42, [], {}, { kind: 'hunter', hunters: [] }, { schema: 3, library: {} }]) expect(parsePack(v)).toEqual({ ok: false, why: 'not-a-pack' });
    expect(parsePack({ schema: SCHEMA + 1, kind: 'library', library: {} })).toEqual({ ok: false, why: 'newer' });
  });

  test('parts of the wrong type hold nothing', () => {
    const r = read({ kind: 'library', library: { statuses: [], items: 'x', skills: {}, rewards: 5 }, monsters: { a: 1 } });
    expect(packCounts(r.pack)).toEqual({ statuses: 0, items: 0, skills: 0, rewards: 0, monsters: 0, maps: 0, feats: 0 });
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
      },
      monsters: [7, { name: 'Rat', tweak: { hp: 'lots' } }],
    });
    expect(r.counts).toEqual({
      statuses: { kept: 1, unreadable: 5, over: 0 }, items: { kept: 1, unreadable: 2, over: 0 }, skills: { kept: 1, unreadable: 1, over: 0 },
      rewards: { kept: 1, unreadable: 1, over: 0 }, monsters: { kept: 1, unreadable: 1, over: 0 }, maps: { kept: 1, unreadable: 1, over: 0 },
      feats: { kept: 1, unreadable: 2, over: 0 },
    });
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
});
