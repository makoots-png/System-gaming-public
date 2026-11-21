import { describe, expect, test } from 'bun:test';
import { THING_MAX, bytesOf, tooLarge } from '../src/core/size.ts';
import { RULES } from '../src/core/rules.ts';
import { parseAbility, parseSheetStatus, parseStatusDef } from '../src/core/combat/fight-parse.ts';
import { LOOT_ITEMS, SHOP_ITEMS, itemOf, parseItem } from '../src/core/registry/items.ts';
import { SKILL_SEEDS, parseSkill, skillOf } from '../src/core/registry/skills.ts';
import { seedMonsters } from '../src/core/registry/monsters.ts';
import { BUILT_IN_STATUSES, STATE_CHIP_DEFS } from '../src/core/registry/statuses.ts';
import { exampleSkills, exampleStatuses } from '../src/core/registry/kit-examples.ts';
import { BUILT_IN_BUNDLES } from '../src/core/registry/bundles.ts';
import { ARCHETYPE_ATTACKS } from '../src/core/registry/abilities.ts';
import { abilityOf } from '../src/core/registry/ability-kinds.ts';
import { abilityId } from '../src/core/combat/ability-types.ts';
import { parseRewards } from '../src/core/rewards.ts';
import { freshSave, parseSave } from '../src/core/save.ts';
import { dev } from './fixtures/ids.ts';

const note = (n: number) => ({ op: 'note', text: 'x'.repeat(n) });
describe('one item, one status and one ability have a size (notes-5-trade.md 13, ruling 2)', () => {
  const wideNote = { op: 'note', text: 'ࠀ'.repeat(200) };
  /** A status of `n` notes of 200 three-byte characters: 7 are under a status's size, 12 are over it. */
  const heavyDef = (n: number) => ({ label: 'Heavy', desc: '', ops: Array(n).fill(wideNote) });

  test('a status under a status\'s size reads; the same status with more of the same ops is refused whole, wherever a status is read', () => {
    expect(bytesOf(heavyDef(7))).toBeLessThanOrEqual(THING_MAX.status);
    expect(parseStatusDef(heavyDef(7), RULES)).toEqual(heavyDef(7));
    expect(bytesOf(heavyDef(12))).toBeGreaterThan(THING_MAX.status);
    expect(parseStatusDef(heavyDef(12), RULES)).toBeNull();
    const held = (def: unknown) => parseSheetStatus({ key: 'heavy', rounds: 2, def, source: { id: null, tier: 0 } }, RULES);
    expect([held(heavyDef(7))?.key, held(heavyDef(12))], 'a sheet\'s condition, a status message').toEqual(['heavy' as never, null]);
    const given = (def: unknown) => parseRewards({ statuses: [{ key: 'heavy', rounds: 2, def }] })!.statuses.map(s => s.key);
    expect([given(heavyDef(7)), given(heavyDef(12))], 'a reward\'s status: never its key alone, without the def it came with').toEqual([['heavy' as never], []]);
  });

  test('an item over an item\'s size is refused whole: never kept without the effect or the worn status that made it too large', () => {
    const tome = (effects: number) => ({ name: 'Tome', desc: 'x'.repeat(500), effects: Array(effects).fill(wideNote) });
    expect(parseItem(tome(10))?.effects).toHaveLength(10);
    expect(bytesOf(tome(12))).toBeGreaterThan(THING_MAX.item);
    expect(parseItem(tome(12))).toBeNull();
    expect(parseItem({ name: 'Ring', type: 'accessory', worn: heavyDef(7) })?.worn).toEqual(heavyDef(7));
    expect(parseItem({ name: 'Ring', type: 'accessory', worn: heavyDef(12) }), 'its worn status alone is over a status\'s size').toBeNull();
    expect(parseItem({ name: 'Ring', type: 'accessory', worn: { label: 5 } })?.worn, 'a worn status that does not read is still left out, as before').toBeUndefined();
  });

  test('an ability over an ability\'s size is refused, and the skill that is that ability is refused whole', () => {
    const heavyDef = (i: number) => ({ op: 'applyStatus', key: `s${i}`, duration: null, def: { label: 'Heavy', desc: 'x'.repeat(500), ops: Array(12).fill(note(200)) } });
    const strike = abilityOf('strike', { id: abilityId('heavy'), name: 'Heavy' }, RULES);
    const ok = { ...strike, ops: [heavyDef(1)] }, over = { ...strike, ops: [heavyDef(1), heavyDef(2), heavyDef(3)] };
    expect(parseAbility(ok, RULES)).not.toBeNull();
    expect(bytesOf(over)).toBeGreaterThan(THING_MAX.ability);
    expect(parseAbility(over, RULES)).toBeNull();
    expect(parseSkill({ name: 'Heavy', type: 'active', ability: over }), 'never a skill with no ability in its place').toBeNull();
    expect(parseSkill({ name: 'Light', type: 'active', ability: ok })?.name).toBe('Light');
  });

  test('the words a maker shows give both numbers and a way out; a thing that fits has none', () => {
    const heavy = { name: 'Tome', desc: 'x'.repeat(8000) };
    expect(tooLarge('item', heavy)).toBe(`This item is too large to save. It takes ${bytesOf(heavy).toLocaleString('en-US')} bytes, and an item holds at most 7,168. Remove an effect, or make its worn status smaller.`);
    expect(tooLarge('status', { label: 'x'.repeat(6000) })).toBe('This status is too large to save. It takes 6,012 bytes, and a status holds at most 5,120. Remove an effect, or one of the things that happen when it stacks, triggers or ends.');
    expect(tooLarge('ability', { name: 'x'.repeat(9000) })).toBe('This skill\'s ability is too large to save. It takes 9,011 bytes, and an ability holds at most 8,192. Remove an effect.');
    expect(tooLarge('item', { name: 'Potion' })).toBeNull();
  });

  test('everything the app ships is at most a quarter of its size: every built-in status, item, ability, kit example, bundle and monster', () => {
    const largest = { status: 0, item: 0, ability: 0 };
    const see = (kind: keyof typeof largest, v: unknown) => { largest[kind] = Math.max(largest[kind], bytesOf(v)); };
    const walk = (v: unknown): void => {
      if (v === null || typeof v !== 'object') return;
      if (Array.isArray(v)) { v.forEach(walk); return; }
      const o = v as Record<string, unknown>;
      if (typeof o.label === 'string' && Array.isArray(o.ops)) see('status', o);
      if (o.cost !== undefined && o.kind !== undefined && o.id !== undefined) see('ability', o);
      if (typeof o.rar === 'string' && typeof o.name === 'string') see('item', o);
      Object.values(o).forEach(walk);
    };
    walk([BUILT_IN_STATUSES, STATE_CHIP_DEFS, exampleStatuses(RULES), exampleSkills(RULES), seedMonsters(RULES), SKILL_SEEDS.map(d => skillOf(d, RULES)),
      [...SHOP_ITEMS, ...LOOT_ITEMS].map(d => parseItem(itemOf(RULES, d))), BUILT_IN_BUNDLES, Object.values(ARCHETYPE_ATTACKS).map(f => f(RULES))]);
    console.info(`the largest the app ships: a status ${largest.status} bytes of ${THING_MAX.status}, an item ${largest.item} of ${THING_MAX.item}, an ability ${largest.ability} of ${THING_MAX.ability}`);
    for (const kind of ['status', 'item', 'ability'] as const) {
      expect(largest[kind], kind).toBeGreaterThan(0);
      expect(largest[kind] * 4, kind).toBeLessThanOrEqual(THING_MAX[kind]);
    }
  });

  test('a save whose library holds an item over the size opens without it, and keeps its other items and its hunters', () => {
    const fresh = freshSave({ now: new Date(0), newDeviceToken: () => 'test-device-token-0123456789abcd', newDeviceId: () => dev('d-gm1') }, { onboarded: true });
    const heavy = { id: 'i900', name: 'Heavy Tome', desc: 'ࠀ'.repeat(500), effects: Array(12).fill({ op: 'note', text: 'ࠀ'.repeat(200) }), worn: { label: 'w', desc: 'ࠀ'.repeat(500), ops: Array(8).fill(note(200)) } };
    expect(bytesOf(heavy)).toBeGreaterThan(THING_MAX.item);
    const raw = JSON.parse(JSON.stringify({ ...fresh, library: { ...fresh.library, items: [heavy, { id: 'i901', name: 'Light Tome' }] } }));
    const read = parseSave(JSON.stringify(raw), { now: new Date(0), newDeviceToken: () => 'test-device-token-0123456789abcd', newDeviceId: () => dev('d-gm1') });
    expect(read.kind === 'save' ? [read.save.library.items.map(i => i.name), read.save.hunters.length] : read.kind).toEqual([['Light Tome'], fresh.hunters.length]);
  });
});
