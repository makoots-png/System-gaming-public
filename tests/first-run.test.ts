import { describe, expect, test } from 'bun:test';
import { ABOUT, LOADED, ROOM_IS, ROOM_PATH, TIPS, createdLine, nextSteps } from '../src/core/first-run.ts';
import type { FirstRunFacts } from '../src/core/first-run.ts';
import { RULES } from '../src/core/rules.ts';
import { room } from './fixtures/ids.ts';

const CODE = room('ABC234');
const player = (o: Partial<Extract<FirstRunFacts, { role: 'player' }>> = {}): FirstRunFacts =>
  ({ role: 'player', points: 5, path: 'open', rooms: true, room: null, joining: null, ...o });
const gm = (o: Partial<Extract<FirstRunFacts, { role: 'gm' }>> = {}): FirstRunFacts =>
  ({ role: 'gm', rooms: true, room: null, players: 0, ...o });
const step = (facts: FirstRunFacts, key: string) => nextSteps(facts, RULES).find(s => s.key === key);

describe('a new player\'s next steps', () => {
  test('a new player is told to spend points, pick a path and join the GM\'s room, in that order, none done', () => {
    expect(nextSteps(player(), RULES)).toEqual([
      { key: 'points', done: false, words: 'Spend your 5 ability points. On the Status tab, tap + on a stat, then tap Confirm allocation.' },
      { key: 'path', done: false, words: 'Pick a path in the Build panel on the Status tab.' },
      { key: 'join', done: false, words: 'Join your GM\'s room. Ask the GM for the room code or an invite link.' },
    ]);
  });
  test('one point left is "1 ability point"; none left is done and says what a level gives', () => {
    expect(step(player({ points: 1 }), 'points')?.words).toBe('Spend your 1 ability point. On the Status tab, tap + on a stat, then tap Confirm allocation.');
    expect(step(player({ points: 0 }), 'points')).toEqual({ key: 'points', done: true, words: 'Ability points spent. Each level gives 3 more.' });
  });
  test('the points a level gives are the rules\' own', () => {
    expect(nextSteps(player({ points: 0 }), { ...RULES, pointsPerLevel: 4 })[0]?.words).toBe('Ability points spent. Each level gives 4 more.');
  });
  test('a picked path is done; with builds off or picks closed there is no path step', () => {
    expect(step(player({ path: 'picked' }), 'path')).toEqual({ key: 'path', done: true, words: 'Path picked.' });
    expect(nextSteps(player({ path: 'closed' }), RULES).map(s => s.key)).toEqual(['points', 'join']);
  });
  test('with no room server there is no join step', () => {
    expect(nextSteps(player({ rooms: false }), RULES).map(s => s.key)).toEqual(['points', 'path']);
  });
  test('joining names the room and is not done yet; in the room the step is done', () => {
    expect(step(player({ joining: CODE }), 'join')).toEqual({ key: 'join', done: false, words: 'Joining room ABC234.' });
    expect(step(player({ room: CODE }), 'join')).toEqual({ key: 'join', done: true, words: 'In room ABC234.' });
    expect(step(player({ room: CODE, joining: CODE }), 'join')?.done).toBe(true);
  });
});

describe('a new GM\'s next steps', () => {
  test('a GM with no room is told to create one, then invite players', () => {
    expect(nextSteps(gm(), RULES)).toEqual([
      { key: 'create', done: false, words: 'Create a room.' },
      { key: 'invite', done: false, words: 'Invite your players. Share the room code, link, or QR code.' },
    ]);
  });
  test('a room with no players: created is done, invite is not', () => {
    expect(nextSteps(gm({ room: CODE }), RULES)).toEqual([
      { key: 'create', done: true, words: 'Room ABC234 created.' },
      { key: 'invite', done: false, words: 'Invite your players. Share the room code, link, or QR code.' },
    ]);
  });
  test('one player joined and two players joined', () => {
    expect(step(gm({ room: CODE, players: 1 }), 'invite')).toEqual({ key: 'invite', done: true, words: '1 player joined.' });
    expect(step(gm({ room: CODE, players: 2 }), 'invite')).toEqual({ key: 'invite', done: true, words: '2 players joined.' });
  });
  test('with no room server a GM has no next steps', () => {
    expect(nextSteps(gm({ rooms: false }), RULES)).toEqual([]);
  });
});

describe('the sentences a new person reads', () => {
  const all = { ABOUT, ROOM_IS, 'ROOM_PATH.gm': ROOM_PATH.gm, 'ROOM_PATH.player': ROOM_PATH.player };
  for (const [name, s] of Object.entries(all)) {
    test(`${name} is one sentence in the app's voice (no em dash, no exclamation mark, no semicolon)`, () => {
      expect(s).toMatch(/^[A-Z].*\.$/);
      expect(s.slice(0, -1)).not.toMatch(/[.?!]\s/);
      expect(s).not.toMatch(/[—!;]/);
    });
  }
  test('both roles\' paths use the role\'s verb: a GM creates a room, a player joins with a code or a link', () => {
    expect(ROOM_PATH.gm).toMatch(/^Create a room/);
    expect(ROOM_PATH.player).toContain('code or an invite link');
  });
  test('Hunter created names the hunter, and its job when it has one', () => {
    expect(createdLine('Nova Reed', '')).toBe('Your hunter Nova Reed is ready.');
    expect(createdLine('Nova Reed', 'Ranger')).toBe('Your hunter Nova Reed (Ranger) is ready.');
  });
  test('the guide\'s room tips use each role\'s verb, and no line a person reads says "open a room"', () => {
    expect(TIPS.gm.some(t => /create a room/.test(t))).toBe(true);
    expect(TIPS.player.some(t => /join your GM's room/.test(t))).toBe(true);
    for (const t of [...TIPS.gm, ...TIPS.player, ...Object.values(LOADED), ABOUT, ROOM_IS]) {
      expect(t).not.toMatch(/open a room|run a room/i);
      expect(t).not.toMatch(/[—!;]/);
    }
  });
});
