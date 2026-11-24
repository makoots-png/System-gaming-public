// first-run.ts: what a new person is told once, in one place. What the site is (`ABOUT`), what a room is (`ROOM_IS`),
// each role's way to one (`ROOM_PATH`), and the next steps after setup (`nextSteps`). The Welcome window, Hunter
// created and Campaign ready (src/views/onboard.js), the Room view (src/views/room.js) and the ? guide all read these,
// so their words cannot drift apart. Pure: the view reads the facts from this phone and passes them in.
import type { RoomCode } from './ids.ts';
import type { Role } from './role.ts';
import type { Rules } from './rules.ts';
import { ARC, PREGENS, STARTER_GATES } from './starter.ts';

export const ABOUT = 'A companion app for a Solo Leveling tabletop RPG where the GM runs the game and each player tracks their hunter, quests, and dice on their phone.';

export const ROOM_IS = 'A room connects the GM\'s phone to the players\' phones so the GM can see hunters, send quests and rewards, and run shared fights and gates.';

export const ROOM_PATH: Readonly<Record<Role, string>> = {
  gm: 'Create a room, then share its code, link or QR code with your players.',
  player: 'Your GM creates the room and gives you its code or an invite link.',
};

/** Hunter created's line: the hunter, and its job when it has one. */
export const createdLine = (name: string, job: string): string => `Your hunter ${name}${job ? ` (${job})` : ''} is ready.`;

/** Campaign ready's line: what the GM's choice loaded. */
export const LOADED: Readonly<Record<'starter' | 'blank', string>> = {
  starter: `The starter campaign is loaded with ${PREGENS.length} hunters, ${STARTER_GATES.length} gates, and ${ARC.length} linked quests.`,
  blank: 'A blank campaign is ready for your own hunters, gates and quests.',
};

/** The ? guide's tips, one list per role; each room line uses the role's verb. */
export const TIPS: Readonly<Record<Role, readonly string[]>> = {
  gm: [
    'Build your campaign in the Gates and Quests tabs and the Workshop.',
    'Spawn gates in the Gates tab, then start a fight from one.',
    'Issue quests in the Quests tab. Give XP, items and gold with the Award form in the GM tab.',
    'Tap the room button at the top to create a room, then invite your players with its code, link or QR code.',
    'Everything saves in this browser. Backups are in the Data tab. Tap ? any time to see this guide again.',
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

/**
 * What this phone knows now. `rooms`: whether this build has a room server (with none, no room step is listed).
 * A player: `points` free (`available`), the room it is in, and the room it is joining.
 * A GM: the room it holds and how many players are in it.
 */
export type FirstRunFacts =
  | { readonly role: 'player'; readonly points: number;
      readonly rooms: boolean; readonly room: RoomCode | null; readonly joining: RoomCode | null }
  | { readonly role: 'gm'; readonly rooms: boolean; readonly room: RoomCode | null; readonly players: number };

const several = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/** The role's next steps, in order (a player: points, join; a GM: create, invite), each done or not. */
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
  if (!facts.rooms) return out;
  out.push(facts.room !== null ? { key: 'create', done: true, words: `Room ${facts.room} created.` } : { key: 'create', done: false, words: 'Create a room.' });
  out.push(facts.players > 0
    ? { key: 'invite', done: true, words: `${several(facts.players, 'player', 'players')} joined.` }
    : { key: 'invite', done: false, words: 'Invite your players. Share the room code, link, or QR code.' });
  return out;
}
