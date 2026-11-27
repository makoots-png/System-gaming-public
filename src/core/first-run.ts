// first-run.ts: what a new person is told once, in one place. What the site is (`ABOUT`), what a room is (`ROOM_IS`),
// each role's way to one (`ROOM_PATH`), the world read-aloud primer (`WORLD_PRIMER`), what loaded (`LOADED`), the ?
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

/** Four-minute world primer read aloud to new players before Session 1 (synced with docs/world/seeds.md section 3). */
export const WORLD_PRIMER: readonly string[] = [
  'About twenty years ago is when the gates started appearing all over the world. The first one opened in London. A big gaping maw thousands of feet wide, the largest gate we\'ve seen to date. The world stopped, people thought it was aliens, the government, something divine. The governments of the world put a committee together, they tried to send cameras and robots in first. They shut down halfway through the gate. Then we sent people through. The best, we were told. Teams of special operators with the best weaponry we had that never came back. Then we sat on our asses, deliberating. We considered sending in more people, explosives, even nukes.',
  'Seven days later it broke open. News was broadcasted as London fell. The first monster that came out… bigger than anything we\'ve ever seen. A land dragon that towered over the skyscrapers. Over the next five days everyone who didn\'t manage to escape by boat or plane died. Over 97% of the population died. England is still under monster control to this day.',
  'Then gates started opening elsewhere. Shanghai, San Francisco, Tokyo, Melbourne, Madrid, major cities. Always 7 days after they showed up, they would break. We tried to fight what came out of them, but bullets only work on the small ones, tank shells and missiles only for the medium ones. When we nuked New York we managed to stop the creatures that came out of a large-ish gate.',
  'Around that same time, some people started changing. They came down with a fever for three days and walked out of it stronger and faster than anyone else. It still happens, though it\'s rare. About one in every five hundred people becomes a hunter, and nobody knows why it happens to them, but they have the unique ability to deal with the monsters. Their powers make it possible for us to actually fight back. As we hunters started getting our footing, gates became more of an opportunity than a horror.',
  'New gates are still popping up every day. We\'ve started rating them E to S. We\'ve discovered that if hunters go in and kill the boss, the gate closes. If nobody clears it in time, the gate breaks and the monsters come out.',
  'There\'s something people call the System that pays hunters for this work. It pays them in gold and has a shop with things imbued with the same energy the hunters have. You can buy a potion that closes a wound, or a resurrection crystal that brings a dead hunter back to life.',
  'Regular people have the System too. On the first night, everyone alive saw a window that only they could see. For most people it reads "Resident, level 0," and gives them access to a shop, that\'s it. A hunter\'s window lists a level, quests, a rank, and a cap. From the moment you\'re chosen as a hunter, how strong you can get is set in stone. It\'s almost like a fucked up little game we\'ve all been forced to play.',
  'Like I said, these days it\'s ended up being seen as more of a boon. Turns out crystals we can find inside of the gates are an amazing energy source. Entire cities run on crystal. At this point, everyone uses the System\'s gold as money, transferring it from person to person. Things like restaurants or grocery stores only really exist as a novelty, everything you\'d need for food can be bought from the store, from fresh veggies to cup noodles to gourmet Michelin-star-esque meals, and it\'s all better than anything from before.',
  'Guilds control most of the gates, they buy rights to them from the government office called the Bureau. Sometimes people try to sneak in to clear them for item drops to sell, but you can get in a lot of trouble for this.',
  'You just got the call, how will you answer?',
];

/** GM-facing copy for unlocking or hiding the world primer drawer for players in a room. */
export const PRIMER_WORDS = {
  title: 'World primer',
  show: 'Show primer to players',
  hide: 'Hide primer from players',
  hidden: 'Players cannot see the world primer yet.',
  shown: 'Players can read the world primer in the ? guide.',
} as const;

/**
 * Whether this phone shows the world primer drawer: always for the GM and in solo mode (no room),
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
    '3. Open Read aloud: World primer below and read it to the table (4 minutes).',
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
