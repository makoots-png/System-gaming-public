import { describe, expect, test } from 'bun:test';
import { ABOUT, LOADED, ROOM_IS, ROOM_PATH, TIPS, WORLD_PRIMER, createdLine, nextSteps } from '../src/core/first-run.ts';
import type { FirstRunFacts } from '../src/core/first-run.ts';
import { STARTER_STORY_NAME, STARTER_UNSPENT_HUNTER } from '../src/core/starter.ts';
import { RULES } from '../src/core/rules.ts';
import { room } from './fixtures/ids.ts';

const CODE = room('ABC234');
const player = (o: Partial<Extract<FirstRunFacts, { role: 'player' }>> = {}): FirstRunFacts =>
  ({ role: 'player', points: 5, rooms: true, room: null, joining: null, ...o });
const gm = (o: Partial<Extract<FirstRunFacts, { role: 'gm' }>> = {}): FirstRunFacts =>
  ({ role: 'gm', rooms: true, room: null, players: 0, ...o });
const step = (facts: FirstRunFacts, key: string) => nextSteps(facts, RULES).find(s => s.key === key);

describe('a new player\'s next steps', () => {
  test('a new player is told to spend points and join the GM\'s room, in that order, none done', () => {
    expect(nextSteps(player(), RULES)).toEqual([
      { key: 'points', done: false, words: 'Spend your 5 ability points. On the Status tab, tap + on a stat, then tap Confirm allocation.' },
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
  test('with no room server there is no join step', () => {
    expect(nextSteps(player({ rooms: false }), RULES).map(s => s.key)).toEqual(['points']);
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
  test('with no room server and no starterPoints fact a GM has no next steps', () => {
    expect(nextSteps(gm({ rooms: false }), RULES)).toEqual([]);
  });
  test('includes a points step for Tessa Corbin when starterPoints is present, and marks it done at 0', () => {
    expect(step(gm({ starterPoints: { name: STARTER_UNSPENT_HUNTER, points: 12 } }), 'points')).toEqual({
      key: 'points',
      done: false,
      words: `Spend ${STARTER_UNSPENT_HUNTER}'s 12 ability points. On the Status tab, tap + on a stat, then tap Confirm allocation.`,
    });
    expect(step(gm({ starterPoints: { name: STARTER_UNSPENT_HUNTER, points: 1 } }), 'points')?.words).toBe(
      `Spend ${STARTER_UNSPENT_HUNTER}'s 1 ability point. On the Status tab, tap + on a stat, then tap Confirm allocation.`,
    );
    expect(step(gm({ starterPoints: { name: STARTER_UNSPENT_HUNTER, points: 0 } }), 'points')).toEqual({
      key: 'points',
      done: true,
      words: `${STARTER_UNSPENT_HUNTER}'s ability points spent.`,
    });
    expect(nextSteps(gm({ rooms: false, starterPoints: { name: STARTER_UNSPENT_HUNTER, points: 12 } }), RULES).map(s => s.key)).toEqual(['points']);
    expect(step(gm({ starterPoints: null }), 'points')).toBeUndefined();
  });
});

describe('the sentences a new person reads', () => {
  test('ABOUT names The Hunter System in plain prose with no em dash, semicolon, or exclamation mark', () => {
    expect(ABOUT).toContain('The Hunter System');
    expect(ABOUT).toMatch(/^[A-Z].*\.$/);
    expect(ABOUT).not.toMatch(/[—!;]/);
  });

  const oneSentence = { ROOM_IS, 'ROOM_PATH.gm': ROOM_PATH.gm, 'ROOM_PATH.player': ROOM_PATH.player };
  for (const [name, s] of Object.entries(oneSentence)) {
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

  test('LOADED.starter names The Empty Seat, Tessa Corbin, the primer, and Start a story', () => {
    expect(LOADED.starter).toContain(STARTER_STORY_NAME);
    expect(LOADED.starter).toContain(STARTER_UNSPENT_HUNTER);
    expect(LOADED.starter).toContain('Read aloud: Carrow primer');
    expect(LOADED.starter).toContain('Start a story');
    expect(LOADED.starter).toContain('Chapter 1');
  });

  test('WORLD_PRIMER carries the 9 Carrow primer paragraphs in American English', () => {
    expect(WORLD_PRIMER).toHaveLength(9);
    const full = WORLD_PRIMER.join('\n\n');
    expect(full).toContain('Carrow');
    expect(full).toContain('laborer');
    expect(full).toContain('license');
    expect(full).not.toMatch(/\b(labourer|licence)\b/i);
    expect(WORLD_PRIMER[WORLD_PRIMER.length - 1]).toBe('What do you do?');
  });

  test('the guide\'s room tips use each role\'s verb, and no line a person reads says "open a room"', () => {
    expect(TIPS.gm.some(t => /create a room/.test(t))).toBe(true);
    expect(TIPS.gm.some(t => /GM -> Stories/.test(t))).toBe(true);
    expect(TIPS.player.some(t => /join your GM's room/.test(t))).toBe(true);
    for (const t of [...TIPS.gm, ...TIPS.player, ...Object.values(LOADED), ABOUT, ROOM_IS, ...WORLD_PRIMER]) {
      expect(t).not.toMatch(/open a room|run a room/i);
      expect(t).not.toMatch(/[—!;]/);
    }
  });
});
