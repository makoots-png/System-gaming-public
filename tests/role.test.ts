import { expect, test } from 'bun:test';
import { chooseMode, roleOf, runsFight, seatOf, type Role, type Seat } from '../src/core/role.ts';

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
