// first-run.ts: what a new person is told once, in one place. What the site is (`ABOUT`), what a room is (`ROOM_IS`),
// each role's way to one (`ROOM_PATH`), the San Francisco read-aloud primer (`WORLD_PRIMER`), what loaded (`LOADED`), the ?
// guide's tips (`TIPS`), and the next steps after setup (`nextSteps`). The Welcome window, Hunter created and Campaign
// ready (src/views/onboard.js), the Room view (src/views/room.js) and the ? guide all read these, so their words cannot
// drift apart. Pure: the view reads the facts from this phone and passes them in.
import type { RoomCode } from './ids.ts';
import type { Role, Seat } from './role.ts';
import type { Rules } from './rules.ts';
import { STARTER_STORY_NAME, STARTER_UNSPENT_HUNTER } from './starter.ts';

export const ABOUT = 'A tabletop RPG companion for The Hunter System. The GM runs gates, fights, and stories while you track your hunter, quests, and dice on your phone.';

export const ROOM_IS = 'A room connects the GM\'s phone to the players\' phones so the GM can see hunters, send quests and rewards, and run shared fights and gates.';

export const ROOM_PATH: Readonly<Record<Role, string>> = {
  gm: 'Create a room, then share its code, link or QR code with your players.',
  player: 'Your GM creates the room and gives you its code or an invite link.',
};

/** Three-minute San Francisco primer read aloud to new players before Session 1 (synced with docs/world/seeds.md section 3). */
export const WORLD_PRIMER: readonly string[] = [
  'Twenty years ago, gates opened all over the world. They looked like doors made of light. Nothing came out of them at first.',
  'Two days later the largest gate broke. Monsters came out and destroyed a city of two million people in a day. Over the next five days every other gate broke too, in every country. About one person in twenty died in the three years that followed.',
  'Some people changed. They had a fever for three days and came out of it stronger and faster than anyone else. About one person in five hundred changes this way. They are called hunters, and nobody knows why it happens to them.',
  'New gates still open every day. Each gate has a rank from E to S and a deadline. An E gate breaks after seven days and an S gate after two. If hunters go in and kill the boss, the gate closes. If nobody does, the monsters come out.',
  'Something pays hunters for this work. It gives them gold and sells them things that nobody can make, such as a potion that closes a wound and a crystal that brings a dead hunter back to life. The System raises a dead hunter once for free, once on debt, and after that only with a crystal bought before death and used within an hour. Gold in your pocket after death does nothing, and none of it works on anyone who never awakened. People call this something the System.',
  'Everyone has the System. On the first night every person alive saw a window that only they could see. For most people it says "Resident, level 0" and does nothing. A hunter\'s window lists a level, quests, and a rank. It also lists a cap. An E-rank\'s level stops at 9, and nothing they do will raise it. The System has never said what the game is for or why it stops people where it does.',
  'Cities run on crystal that crews cut out of cleared gates. Rent depends on how quickly hunters can reach your street. Everyone uses the System\'s gold as money. A bowl of noodles costs under half a gold, a laborer earns twelve a day, and an E-rank hunter earns a hundred for clearing a gate. Guilds control most of the gates, and a government office called the Bureau controls the rest. Most hunters are poor and a few are very rich.',
  'You live in San Francisco, a port city of 800,000 people. You became a hunter recently. The Bureau has given you a rank and a license. Your window says level 1 and tells you where you will stop. You have a seat in a gate on Thursday.',
  'What do you do?',
];

/** GM-facing copy for unlocking or hiding the San Francisco primer drawer for players in a room. */
export const PRIMER_WORDS = {
  title: 'San Francisco primer',
  show: 'Show primer to players',
  hide: 'Hide primer from players',
  hidden: 'Players cannot see the San Francisco primer yet.',
  shown: 'Players can read the San Francisco primer in the ? guide.',
} as const;

/**
 * Whether this phone shows the San Francisco primer drawer: always for the GM and in solo mode (no room),
 * and for a player in a room only once the room's rules unlock it (`primer.on`).
 */
export const showsPrimer = (seat: Seat, roomRules: Pick<Rules, 'primer'> | null): boolean =>
  seat !== 'player' || Boolean(roomRules?.primer.on);

/** Hunter created's line: the hunter, and its job when it has one. */
export const createdLine = (name: string, job: string): string => `Your hunter ${name}${job ? ` (${job})` : ''} is ready.`;

/** Campaign ready's line: what the GM's choice loaded. */
export const LOADED: Readonly<Record<'starter' | 'blank', string>> = {
  starter: [
    `The first mission is loaded: ${STARTER_STORY_NAME} (about 3 hours, 1 to 6 players).`,
    '1. Create a room and share the code, link, or QR code.',
    `2. Let each player make a hunter on their phone (or spend ${STARTER_UNSPENT_HUNTER}'s 12 points if testing alone).`,
    '3. Open Read aloud: San Francisco primer below and read it to the table (3 minutes).',
    `4. Open GM -> Stories and tap Start a story for ${STARTER_STORY_NAME} to send Chapter 1 to every phone.`,
  ].join('\n'),
  blank: 'A blank campaign is ready for your own hunters, gates, and quests.',
};

/** The ? guide's tips, one list per role; each room line uses the role's verb. */
export const TIPS: Readonly<Record<Role, readonly string[]>> = {
  gm: [
    'Run your table in a loop: open a story chapter, mark a gate as raiding, start a fight, award XP, and clear the gate.',
    'Open GM -> Stories to start a story and release chapters one at a time after you review each GM note.',
    'Open Gates to spawn gates, start fights, open class offers, and clear finished gates.',
    'Use the Award form in the GM tab to send gold, XP, items, or titles to local and room hunters.',
    'Tap the room button at the top to create a room and invite players. Backups live in Data. Tap ? any time to reopen this guide.',
  ],
  player: [
    'Use the Status tab to spend ability points, track HP and mana, and equip gear.',
    'Complete your daily quest each day, or you get a penalty.',
    'Tap the room button at the top to join your GM\'s room with its code, or open the GM\'s invite link.',
    'Everything saves in this browser. Tap ? any time to see this guide again.',
  ],
};

export type NextKey = 'points' | 'join' | 'create' | 'invite';
export interface NextStep { readonly key: NextKey; readonly words: string; readonly done: boolean }

/** A sample hunter on a GM phone whose creation points can be spent during solo testing (`points === 0` marks the step done). */
export type StarterPointsFact = { readonly name: string; readonly points: number };

/**
 * What this phone knows now. `rooms`: whether this build has a room server (with none, no room step is listed).
 * A player: `points` free (`available`), the room it is in, and the room it is joining.
 * A GM: the room it holds, how many players are in it, and optionally the sample hunter with creation points to spend (`starterPoints`).
 */
export type FirstRunFacts =
  | { readonly role: 'player'; readonly points: number;
      readonly rooms: boolean; readonly room: RoomCode | null; readonly joining: RoomCode | null }
  | { readonly role: 'gm'; readonly rooms: boolean; readonly room: RoomCode | null; readonly players: number;
      readonly starterPoints?: StarterPointsFact | null };

const several = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/** The role's next steps, in order (a player: points, join; a GM: create, invite, and starterPoints when present), each done or not. */
export function nextSteps(facts: FirstRunFacts, R: Rules): readonly NextStep[] {
  const out: NextStep[] = [];
  if (facts.role === 'player') {
    out.push(facts.points === 0
      ? { key: 'points', done: true, words: `Ability points spent. Each level gives ${R.pointsPerLevel} more.` }
      : { key: 'points', done: false, words: `Spend your ${several(facts.points, 'ability point', 'ability points')}. On the Status tab, tap + on a stat, then tap Confirm allocation.` });
    if (facts.rooms) {
      out.push(facts.room !== null ? { key: 'join', done: true, words: `In room ${facts.room}.` }
        : facts.joining !== null ? { key: 'join', done: false, words: `Joining room ${facts.joining}.` }
        : { key: 'join', done: false, words: 'Join your GM\'s room. Ask the GM for the room code or an invite link.' });
    }
    return out;
  }
  if (facts.rooms) {
    out.push(facts.room !== null ? { key: 'create', done: true, words: `Room ${facts.room} created.` } : { key: 'create', done: false, words: 'Create a room.' });
    out.push(facts.players > 0
      ? { key: 'invite', done: true, words: `${several(facts.players, 'player', 'players')} joined.` }
      : { key: 'invite', done: false, words: 'Invite your players. Share the room code, link, or QR code.' });
  }
  if (facts.starterPoints) {
    const sp = facts.starterPoints;
    out.push(sp.points === 0
      ? { key: 'points', done: true, words: `${sp.name}'s ability points spent.` }
      : { key: 'points', done: false, words: `Spend ${sp.name}'s ${several(sp.points, 'ability point', 'ability points')}. On the Status tab, tap + on a stat, then tap Confirm allocation.` });
  }
  return out;
}
