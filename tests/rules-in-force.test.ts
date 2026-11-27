// The rules a view reads (src/edge/rules.ts `rules()`): made once from the save's overrides, the GM's statuses and the
// room's rules, and the same answer until one of them changes. A fight turn reads them 13 to 30 times (audit AW-sync-3),
// so a read must not cost more for a GM with a full library of statuses than for one with none.
import { expect, test } from 'bun:test';
import { bindCatalog, bindRoom, bindSave, rules } from '../src/edge/rules.ts';
import type { BoundCatalog } from '../src/edge/rules.ts';
import { RULES } from '../src/core/rules.ts';
import { roomRulesOf } from '../src/core/hunter/build.ts';
import type { RoomRules } from '../src/core/protocol.ts';
import { freshSave, repairSave } from '../src/core/save.ts';
import type { ParseEnv } from '../src/core/save.ts';
import type { StatusDef } from '../src/core/combat/effect-ops.ts';
import { resolveDef } from '../src/core/registry/item-book.ts';
import { CUSTOM_BLADE_DEF, CUSTOM_BLADE_ID, DAGGER_DEF_ID, FOREIGN_CHARM_DEF, FOREIGN_CHARM_ID } from './fixtures/items.ts';
import { dev } from './fixtures/ids.ts';

const AT = '2026-11-18T10:00:00.000Z';
const ENV: ParseEnv = { now: new Date(AT), newDeviceToken: () => 'test-device-token-0123456789abcd', newDeviceId: () => dev('d-me') };
const burning: StatusDef = RULES.conditions.burning;
/** A status of the rules by key, a GM's or a built-in. */
const status = (key: string): StatusDef | undefined => (rules().conditions as Readonly<Record<string, StatusDef>>)[key];
/** A library of `n` statuses of the GM's, each a Burning of its own name. */
const library = (n: number): Record<string, StatusDef> => Object.fromEntries(Array.from({ length: n }, (_, i) => [`gm-${i}`, { ...burning, label: `GM ${i}` }]));

test('a read of the rules between two writes does not walk the GM\'s statuses, however many there are', () => {
  let walks = 0;
  const statuses = new Proxy(library(200), { ownKeys(t) { walks++; return Reflect.ownKeys(t); } });
  const save = { rulesOverrides: { xpPerLevel: 120 }, library: { statuses, items: {} }, heardItems: {} };
  bindRoom(() => null);
  bindSave(() => save);
  const first = rules();
  expect([first.xpPerLevel, status('gm-199')?.label]).toEqual([120, 'GM 199']);
  walks = 0;
  for (let i = 0; i < 30; i++) expect(rules()).toBe(first);
  expect(walks, 'thirty reads, the most a fight turn made, walk the library no time').toBe(0);
});

test('a write of the save reaches the next read: new overrides, a new status, the room\'s rules', () => {
  const save = { rulesOverrides: {} as Record<string, unknown>, library: { statuses: library(2), items: {} }, heardItems: {} };
  let room: RoomRules | null = null;
  bindRoom(() => room);
  bindSave(() => save);
  expect(rules().xpPerLevel).toBe(RULES.xpPerLevel);
  save.rulesOverrides = { xpPerLevel: 150 };
  expect(rules().xpPerLevel).toBe(150);
  save.library = { statuses: { ...library(2), 'gm-new': { ...burning, label: 'Fresh' } }, items: {} };
  expect(status('gm-new')?.label).toBe('Fresh');
  const baseRoom = roomRulesOf(RULES);
  room = { ...baseRoom, solo: { personal: false, hours: 12, lootShare: RULES.solo.lootShare } };
  expect([rules().solo.personal, rules().solo.hours]).toEqual([false, 12]);
  room = { ...room, solo: { ...room.solo, hours: 6 } };
  expect(rules().solo.hours, 'the room\'s rules are read by value: a new doc of other hours is a change').toBe(6);
});

// The store writes the save only through store.update, which runs this repair after each change (src/edge/store.ts).
// The read above keys on the overrides and the statuses by reference, so it holds only while the repair gives each a
// new object on every write: an edit of a status in place, kept the same object, would leave the rules in force behind.
test('every repair of the save gives the overrides and the GM\'s statuses new objects, so each write is a change the rules see', () => {
  const save = { ...freshSave(ENV, { onboarded: true }), rulesOverrides: { xpPerLevel: 120 }, library: { ...freshSave(ENV, { onboarded: true }).library, statuses: library(3) } };
  const ov = save.rulesOverrides, statuses = save.library.statuses;
  repairSave(save, ENV, 'kept');
  expect(save.rulesOverrides).not.toBe(ov);
  expect(save.library.statuses).not.toBe(statuses);
  expect([save.rulesOverrides, save.library.statuses]).toEqual([ov, statuses]);
});

test('bindCatalog layers catalog defs over heardItems and catalog statuses over built-ins, memoized by reference', () => {
  const localPoison: StatusDef = { ...burning, label: 'Player Local Poison' };
  const gmPoison: StatusDef = { ...burning, label: 'GM Synced Poison' };
  const gmDagger = { ...CUSTOM_BLADE_DEF, name: 'GM Iron Dagger' };
  const gmBladeEdit = { ...CUSTOM_BLADE_DEF, name: 'Rift Fang v2' };
  const save = {
    rulesOverrides: {},
    library: { statuses: { poisoned: localPoison }, items: { [CUSTOM_BLADE_ID]: { ...CUSTOM_BLADE_DEF, name: 'Player Local Blade' } } },
    heardItems: { [CUSTOM_BLADE_ID]: CUSTOM_BLADE_DEF, [FOREIGN_CHARM_ID]: FOREIGN_CHARM_DEF },
  };
  let cat: BoundCatalog | null = null;
  bindRoom(() => null);
  bindCatalog(() => cat);
  bindSave(() => save);

  // Alone: player's own library statuses and library items win
  expect(rules().conditions.poisoned.label).toBe('Player Local Poison');
  expect(resolveDef(CUSTOM_BLADE_ID, rules())?.name).toBe('Player Local Blade');

  // Bound catalog: heardItems under catalog.defs, built-ins under catalog.statuses (player library ignored)
  cat = { defs: { [CUSTOM_BLADE_ID]: gmBladeEdit, [DAGGER_DEF_ID]: gmDagger }, statuses: { poisoned: gmPoison } };
  const r1 = rules();
  expect(r1.conditions.poisoned.label).toBe('GM Synced Poison');
  expect(resolveDef(CUSTOM_BLADE_ID, r1)?.name).toBe('Rift Fang v2');
  expect(resolveDef(DAGGER_DEF_ID, r1)?.name).toBe('GM Iron Dagger');
  expect(resolveDef(FOREIGN_CHARM_ID, r1)?.name).toBe(FOREIGN_CHARM_DEF.name);
  // Memoized by reference: same catalog object returns the same Rules object
  expect(rules()).toBe(r1);

  // New catalog object without the custom blade falls back to heardItems; leaving room restores player's own
  cat = { defs: {}, statuses: {} };
  const r2 = rules();
  expect(r2).not.toBe(r1);
  expect(r2.conditions.poisoned.label).toBe(RULES.conditions.poisoned.label);
  expect(resolveDef(CUSTOM_BLADE_ID, r2)?.name).toBe(CUSTOM_BLADE_DEF.name);
  expect(resolveDef(DAGGER_DEF_ID, r2)?.name).toBe('Iron Dagger');

  cat = null;
  bindCatalog(() => null);
  expect(rules().conditions.poisoned.label).toBe('Player Local Poison');
});
