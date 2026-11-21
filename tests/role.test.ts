import { expect, test } from 'bun:test';
import { chooseMode, roleOf, runsFight, seatOf, type Role, type Seat } from '../src/core/role.ts';
import { boot, reduce } from '../src/core/sync/link.ts';
import type { Gen, Link, LinkEvent } from '../src/core/sync/link.ts';
import { linkSaved } from '../src/core/sync/bind.ts';
import { freshSave } from '../src/core/save.ts';
import type { ParseEnv, Save } from '../src/core/save.ts';
import { dev, gmKey, room } from './fixtures/ids.ts';

type Case = { name: string; mode: Role; room: string | null; gmKey: string | null; seat: Seat; role: Role };

const CASES: Case[] = [
  { name: 'alone, a phone that chose GM is the GM', mode: 'gm', room: null, gmKey: null, seat: 'alone', role: 'gm' },
  { name: 'alone, a phone that chose player is a player', mode: 'player', room: null, gmKey: null, seat: 'alone', role: 'player' },
  { name: 'alone, a key kept from a room the phone left does not make a player the GM', mode: 'player', room: null, gmKey: 'KEY', seat: 'alone', role: 'player' },
  { name: 'in a room with its GM key, a phone that chose GM is the GM', mode: 'gm', room: 'ABC234', gmKey: 'KEY', seat: 'gm', role: 'gm' },
  { name: 'in a room with its GM key, a phone that chose player is still the GM', mode: 'player', room: 'ABC234', gmKey: 'KEY', seat: 'gm', role: 'gm' },
  { name: 'in a room without its GM key, a phone that chose GM is a player', mode: 'gm', room: 'ABC234', gmKey: null, seat: 'player', role: 'player' },
  { name: 'in a room without its GM key, a phone that chose player is a player', mode: 'player', room: 'ABC234', gmKey: null, seat: 'player', role: 'player' },
];

for (const c of CASES) {
  test(c.name, () => {
    const settings = { mode: c.mode, sync: { gmKey: c.gmKey } };
    expect(seatOf(settings, c.room)).toBe(c.seat);
    expect(roleOf(settings, c.room)).toBe(c.role);
  });
}

test('a save that never held a GM key sits as a player in a room', () => {
  expect(seatOf({ mode: 'gm', sync: {} }, 'ABC234')).toBe('player');
});

test('a phone alone runs its own fight; in a room only the GM runs one, and a player plays in the GM\'s', () => {
  expect(runsFight('alone')).toBe(true);
  expect(runsFight('gm')).toBe(true);
  expect(runsFight('player')).toBe(false);
});

test('round trip: switching to GM mode and back to player mode alone leaves the settings as they were', () => {
  const settings = { mode: 'player' as Role, sync: { gmKey: null } };
  expect(chooseMode(chooseMode(settings, 'gm'), 'player')).toEqual(settings);
  expect(roleOf(chooseMode(settings, 'gm'), null)).toBe('gm');
  expect(roleOf(chooseMode(settings, 'gm'), 'ABC234'), 'in a room the room decides').toBe('player');
});

test('the seat the save says is the link\'s own at every step: a GM who leaves and joins another room as a player is a player there (SMX-sync-1, 12.1)', () => {
  const AT = '2026-11-21T10:00:00.000Z';
  const env: ParseEnv = { now: new Date(AT), newDeviceToken: () => 'test-device-token-0123456789abcd', newDeviceId: () => dev('d-p1') };
  const A = room('AAAA22'), B = room('BBBB33'), KA = gmKey('key-a');
  /** Where the link itself sits: the room it is live in, as the GM when it sends a key. */
  const linkSeat = (l: Link): Seat => (l.at !== 'live' ? 'alone' : l.key !== null ? 'gm' : 'player');
  const linkRoom = (l: Link): string | null => (l.at === 'live' ? l.code : null);
  let link: Link = boot({ server: true, room: null, last: null }).state;
  let save: Save = freshSave(env, { onboarded: true });
  const play = (e: LinkEvent | ((gen: Gen) => LinkEvent)): void => {
    const r = reduce(link, typeof e === 'function' ? e(link.gen) : e);
    for (const fx of r.effects) if (fx.type === 'save') save = linkSaved(save, fx.fields, null, AT);
    link = r.state;
    expect(seatOf(save.settings, linkRoom(link)), `after ${link.at}`).toBe(linkSeat(link));
  };
  play(gen => ({ type: 'healthOk', gen }));
  play({ type: 'create' });
  play(gen => ({ type: 'created', gen, code: A, key: KA }));
  expect(seatOf(save.settings, A)).toBe('gm');
  play({ type: 'leave' });
  expect(save.settings.sync.gmKey ?? null, 'out of a room the save holds no GM key').toBeNull();
  play({ type: 'join', code: B, key: null, from: null });
  play(gen => ({ type: 'peeked', gen, exists: true }));
  play(gen => ({ type: 'headed', gen, cursor: 3, gm: false, kicked: false }));
  expect(seatOf(save.settings, B)).toBe('player');
  play({ type: 'readOnly' });
  expect(save.settings.sync.room, 'a tab that stops saving keeps the room in its save').toBe(B);
});
