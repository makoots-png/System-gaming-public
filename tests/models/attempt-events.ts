// A Create or Join tap (src/core/sync/attempt.ts), from no tap out, and every event of its life: the four taps, the link
// taking each or not, the link still in its stretch (peeking, asking the head), the link leaving it (into the room, or
// back with each notice that ends a tap). Walked by the state chart
// (scripts/charts/attempt.ts); tests/attempt.test.ts checks each move and walks random events.
import { NOBODY, NO_ATTEMPT } from '../../src/core/sync/attempt.ts';
import type { Attempt, AttemptEvent, RoomTap, JoinFor } from '../../src/core/sync/attempt.ts';
import type { Gen, Idle, Link, LinkEvent, LinkNotice, Live } from '../../src/core/sync/link.ts';
import { gmKey, hid, room } from '../fixtures/ids.ts';

/** A tap's promise in the walk: which tap it answers. */
export type Asked = string;
export const START: Attempt<Asked> = NO_ATTEMPT;

export const CODE = room('ABC234');
export const KEY = gmKey('gmkeygmkeygmkey1');
export const MIRA = hid('h1');
export const CREATE: RoomTap = { type: 'create' };
export const JOIN_GM: RoomTap = { type: 'join', code: CODE, key: KEY, from: null };
export const JOIN_PLAYER: RoomTap = { type: 'join', code: CODE, key: null, from: null };
export const PICKED: JoinFor = { hunterId: MIRA, name: '' };
export const NAMED: JoinFor = { hunterId: null, name: 'Rin' };
/** A link event that is no tap: what the link takes while a create or join waits on the server. */
export const REPLY: LinkEvent = { type: 'timerFired', name: 'poll' };

/** The stretch a create or join is under way in, and the next one, which the link takes as it leaves it. */
export const GEN = 2 as Gen;
export const NEXT = 3 as Gen;
export const IDLE: Idle = { at: 'idle', gen: NEXT, server: 'ok', last: null, next: 'timer' };
const BACK: Idle = { ...IDLE, gen: 1 as Gen };
export const CREATING: Link = { at: 'creating', gen: GEN, back: BACK };
export const PEEK: Link = { at: 'joining', gen: GEN, code: CODE, key: null, from: null, step: 'peek', back: BACK };
export const HEAD: Link = { ...PEEK, step: 'head' };
export const PEEK_GM: Link = { ...PEEK, key: KEY };
const live = (key: Live['key']): Live => ({ at: 'live', gen: NEXT, code: CODE, key, cursor: 0, health: 'ok', last: null, next: 'polling', pace: 'table', chase: null });
export const LIVE_GM: Link = live(KEY);
export const LIVE_PLAYER: Link = live(null);
export const UPGRADING: Link = { at: 'upgrading', gen: NEXT, stuck: false };

export const tap = (t: RoomTap, who: JoinFor, reply: Asked): AttemptEvent<Asked> => ({ type: 'tap', tap: t, who, reply });
export const linked = (took: LinkEvent, link: Link, notices: readonly LinkNotice[] = []): AttemptEvent<Asked> => ({ type: 'linked', took, link, notices });
/** The notices that end a tap, each with where the link went. */
export const ENDS: readonly LinkNotice[] = ['notFound', 'keyRefused', 'notAllowedBack', 'unreachable', 'serverError'];

export const WALK_EVENTS: readonly AttemptEvent<Asked>[] = [
  tap(CREATE, NOBODY, 'create'), tap(JOIN_GM, NOBODY, 'join as GM'), tap(JOIN_PLAYER, PICKED, 'join as Mira'), tap(JOIN_PLAYER, NAMED, 'join as Rin'),
  linked(CREATE, CREATING), linked(JOIN_GM, PEEK_GM), linked(JOIN_PLAYER, PEEK), linked(CREATE, LIVE_GM), linked(JOIN_PLAYER, UPGRADING),
  linked(REPLY, PEEK), linked(REPLY, HEAD), linked(REPLY, LIVE_GM), linked(REPLY, LIVE_PLAYER), linked(REPLY, UPGRADING),
  ...ENDS.map(n => linked(REPLY, IDLE, [n])), linked(REPLY, LIVE_PLAYER, ['replaced']),
];
/** The notices only a join's link step gives (link.ts `joining`): the chart does not walk them from a create. */
const JOIN_ONLY: readonly LinkNotice[] = ['notFound', 'keyRefused', 'notAllowedBack'];
/** The events the link can give in state `s`: all of them, but a create never ends with a join's notice. */
export const eventsFrom = (s: Attempt<Asked>): readonly AttemptEvent<Asked>[] =>
  s.at === 'creating' ? WALK_EVENTS.filter(e => e.type !== 'linked' || !e.notices.some(n => JOIN_ONLY.includes(n))) : WALK_EVENTS;
