// The rules a view reads (src/edge/rules.ts `rules()`): made once from the save's overrides, the GM's statuses and the
// room's rules, and the same answer until one of them changes. A fight turn reads them 13 to 30 times (audit AW-sync-3),
// so a read must not cost more for a GM with a full library of statuses than for one with none.
import { expect, test } from 'bun:test';
import { bindRoom, bindSave, rules } from '../src/edge/rules.ts';
import { RULES } from '../src/core/rules.ts';
import { freshSave, repairSave } from '../src/core/save.ts';
import type { ParseEnv } from '../src/core/save.ts';
import type { StatusDef } from '../src/core/combat/effect-ops.ts';
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
  const save = { rulesOverrides: { xpPerLevel: 120 }, library: { statuses } };
  bindRoom(() => null);
  bindSave(() => save);
  const first = rules();
  expect([first.xpPerLevel, status('gm-199')?.label]).toEqual([120, 'GM 199']);
  walks = 0;
  for (let i = 0; i < 30; i++) expect(rules()).toBe(first);
  expect(walks, 'thirty reads, the most a fight turn made, walk the library no time').toBe(0);
});

test('a write of the save reaches the next read: new overrides, a new status, the room\'s rules', () => {
  const save = { rulesOverrides: {} as Record<string, unknown>, library: { statuses: library(2) } };
  let room: { build: { enabled: boolean; playerPick: boolean }; solo: { personal: boolean; hours: number }; feats: { on: boolean } } | null = null;
  bindRoom(() => room);
  bindSave(() => save);
  expect(rules().xpPerLevel).toBe(RULES.xpPerLevel);
  save.rulesOverrides = { xpPerLevel: 150 };
  expect(rules().xpPerLevel).toBe(150);
  save.library = { statuses: { ...library(2), 'gm-new': { ...burning, label: 'Fresh' } } };
  expect(status('gm-new')?.label).toBe('Fresh');
  room = { build: { enabled: false, playerPick: false }, solo: { personal: false, hours: 12 }, feats: { on: true } };
  expect([rules().build.enabled, rules().solo.hours]).toEqual([false, 12]);
  room = { ...room, solo: { personal: false, hours: 6 } };
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
