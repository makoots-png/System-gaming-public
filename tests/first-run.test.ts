import { describe, expect, test } from 'bun:test';
import { ABOUT, LOADED, ROOM_IS, ROOM_PATH, TIPS, WORLD_PRIMER, createdLine, nextSteps } from '../src/core/first-run.ts';
import type { FirstRunFacts } from '../src/core/first-run.ts';
import { STARTER_STORY_NAME, STARTER_UNSPENT_HUNTER, starterStory } from '../src/core/starter.ts';
import { RULES } from '../src/core/rules.ts';
import { room } from './fixtures/ids.ts';

const ROOT = `${import.meta.dir}/..`;

/** Parses the blockquote paragraphs from `docs/world/seeds.md` section `## 3. The primer`. */
function extractSeedsPrimer(markdown: string): string[] {
  const start = markdown.indexOf('## 3. The primer');
  if (start < 0) throw new Error('missing "## 3. The primer" in docs/world/seeds.md');
  const after = markdown.slice(start);
  const nextHeading = after.slice(1).search(/\n##\s+/);
  const section = nextHeading >= 0 ? after.slice(0, nextHeading + 1) : after;
  const paragraphs: string[] = [];
  let cur: string[] = [];
  for (const line of section.split('\n')) {
    if (!line.startsWith('>')) {
      if (cur.length) { paragraphs.push(cur.join(' ')); cur = []; }
      continue;
    }
    const text = line.replace(/^>\s?/, '').trim();
    if (!text) {
      if (cur.length) { paragraphs.push(cur.join(' ')); cur = []; }
    } else {
      cur.push(text);
    }
  }
  if (cur.length) paragraphs.push(cur.join(' '));
  return paragraphs;
}

/** Applies the documented American-spelling and voice-lint adaptations from docs/world/seeds.md to WORLD_PRIMER. */
const adaptPrimerForApp = (p: string): string => p
  .replace(/\blabourer\b/g, 'laborer')
  .replace(/\blicence\b/g, 'license')
  .replace(
    "A hunter's window shows a level, quests and a rank. It also shows a cap.",
    "A hunter's window lists a level, quests, and a rank. It also lists a cap.",
  );

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

  test('WORLD_PRIMER matches docs/world/seeds.md section 3 paragraph for paragraph', async () => {
    const seeds = await Bun.file(`${ROOT}/docs/world/seeds.md`).text();
    const expected = extractSeedsPrimer(seeds).map(adaptPrimerForApp);
    expect(expected).toHaveLength(9);
    expect(WORLD_PRIMER).toEqual(expected);
  });

  test('every button and drawer label named in onboarding copy and starter GM notes exists in live UI source', async () => {
    const [onboardSrc, gatesSrc, combatSrc, storyRunSrc, classOfferSrc, rulesTextSrc] = await Promise.all([
      Bun.file(`${ROOT}/src/views/onboard.js`).text(),
      Bun.file(`${ROOT}/src/views/gates.js`).text(),
      Bun.file(`${ROOT}/src/views/combat.js`).text(),
      Bun.file(`${ROOT}/src/core/story/run.ts`).text(),
      Bun.file(`${ROOT}/src/core/hunter/class-offer.ts`).text(),
      Bun.file(`${ROOT}/src/core/rules-text.ts`).text(),
    ]);
    const notes = starterStory(RULES).chapters.map(c => c.note).join('\n');
    const stepText = [
      ...nextSteps(player(), RULES).map(s => s.words),
      ...nextSteps(gm({ starterPoints: { name: STARTER_UNSPENT_HUNTER, points: 12 } }), RULES).map(s => s.words),
      LOADED.starter,
      LOADED.blank,
      ...TIPS.gm,
      ...TIPS.player,
      notes,
    ].join('\n');

    const checks: readonly { readonly label: string; readonly referencedIn: string; readonly uiSource: string; readonly uiFile: string }[] = [
      { label: 'Read aloud: Carrow primer', referencedIn: LOADED.starter, uiSource: onboardSrc, uiFile: 'src/views/onboard.js' },
      { label: 'Start a story', referencedIn: LOADED.starter, uiSource: storyRunSrc, uiFile: 'src/core/story/run.ts' },
      { label: 'Confirm allocation', referencedIn: stepText, uiSource: rulesTextSrc, uiFile: 'src/core/rules-text.ts' },
      { label: 'Mark as raiding', referencedIn: notes, uiSource: gatesSrc, uiFile: 'src/views/gates.js' },
      { label: 'Start fight', referencedIn: notes, uiSource: gatesSrc, uiFile: 'src/views/gates.js' },
      { label: 'Award XP', referencedIn: notes, uiSource: combatSrc, uiFile: 'src/views/combat.js' },
      { label: 'Lift cap and offer classes', referencedIn: notes, uiSource: classOfferSrc, uiFile: 'src/core/hunter/class-offer.ts' },
      { label: 'Close offer', referencedIn: notes, uiSource: classOfferSrc, uiFile: 'src/core/hunter/class-offer.ts' },
      { label: 'Clear gate', referencedIn: notes, uiSource: gatesSrc, uiFile: 'src/views/gates.js' },
      { label: 'Start blank', referencedIn: onboardSrc, uiSource: onboardSrc, uiFile: 'src/views/onboard.js' },
      { label: 'Create room', referencedIn: onboardSrc, uiSource: onboardSrc, uiFile: 'src/views/onboard.js' },
    ];
    for (const c of checks) {
      expect(c.referencedIn, `expected copy to reference "${c.label}"`).toContain(c.label);
      expect(c.uiSource, `expected "${c.label}" to exist in ${c.uiFile}`).toContain(c.label);
    }
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
