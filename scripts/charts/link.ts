// The charts of this phone's room link and its sheet push (src/core/sync/link.ts, push.ts), walked breadth first over
// the world and the alphabet of tests/sync-model.test.ts (tests/models/sync-world.ts).
import type { Link, LinkAt, LinkEvent } from '../../src/core/sync/link.ts';
import type { Push, PushAt, PushEvent } from '../../src/core/sync/push.ts';
import { BOOTS, key, moves, start } from '../../tests/models/sync-world.ts';
import type { Ev, World } from '../../tests/models/sync-world.ts';
import { bfs, machine } from '../statecharts.ts';
import type { Arrow, Shape, View } from '../statecharts.ts';

/** The events one move delivers: a tap, a timer, or a reply (a poll page can be followed by `removed` or `keyLost`). */
type Move = Ev[];
const linkEvent = (m: Move): LinkEvent | null => { let e: LinkEvent | null = null; for (const x of m) if (x.to === 'link') e = x.e; return e; };
const pushEvent = (m: Move): PushEvent | null => { let e: PushEvent | null = null; for (const x of m) if (x.to === 'push') e = x.e; return e; };

// ── the link alone ──
const OUT = 'Out of a room', IN = 'In a room', ASK = 'Creating or joining a room';
/** The words of the room pill and the Room view (render in src/views/room-pill.ts, STATE in src/views/room.js). */
const LINK: { readonly [A in LinkAt]: (l: Extract<Link, { at: A }>) => readonly string[] } = {
  off: () => ['No room server'],
  idle: l => [OUT, typeof l.server === 'object' ? 'Offline' : 'Ready to join'],
  creating: () => [ASK],
  joining: () => [ASK],
  live: l => [IN, l.health === 'connecting' ? 'Connecting' : l.health === 'ok' ? 'Live' : 'Reconnecting'],
  upgrading: () => ['Updating the app'],
};
const linkState = (l: Link): readonly string[] => (LINK[l.at] as (l: Link) => readonly string[])(l);

const BACK = 'refused or no answer, back where you were';
function linkStep(m: Move, from: World, to: World): string | null {
  const e = linkEvent(m);
  if (!e) throw new Error(`a push event moved the link from ${from.link.at} to ${to.link.at}`);
  switch (e.type) {
    case 'create': case 'join': return 'you tap Create room or Join room';
    case 'leave': return 'you tap Leave room';
    case 'replaced': return null;
    case 'readOnly': return 'this tab stops saving (another tab saved)';
    case 'upgrade': return from.link.at === 'live' ? 'the server runs a newer build' : null;
    case 'created': return 'the room opens or lets you in';
    case 'headed': return from.link.at === 'joining' && to.link.at === 'live' && to.link.code === from.link.code ? 'the room opens or lets you in' : BACK;
    case 'peeked': case 'failed': case 'gone':
      if (from.link.at === 'creating' || from.link.at === 'joining') return BACK;
      if (e.type === 'gone') return 'the room is gone, or you are put out of it';
      return from.link.at === 'idle' ? 'the server does not answer, or the phone goes offline' : 'the room does not answer, or the phone goes offline';
    case 'offline': return from.link.at === 'idle' ? 'the server does not answer, or the phone goes offline' : 'the room does not answer, or the phone goes offline';
    case 'healthOk': return 'the server answers';
    case 'polled': return 'the room answers';
    // a poll page followed by a removal this phone does not hear (a GM is not removed, a player has no key): the page counts
    case 'removed': case 'keyLost': return to.link.at === 'live' ? 'the room answers' : 'the room is gone, or you are put out of it';
    default: throw new Error(`${e.type} moved the link from ${from.link.at} to ${to.link.at} with no label`);
  }
}

// ── the link and the push side by side ──
const PLAYER = 'In a room as a player', NOT_PLAYER = 'Not in a room as a player', ON = 'Sheet push on';
const playing = (l: Link): boolean => l.at === 'live' && l.key === null;
/** The push's words: what the Room view says about this phone's sheet. */
const PUSH: { readonly [A in PushAt]: (p: Extract<Push, { at: A }>) => readonly string[] } = {
  off: () => ['Off'],
  clean: () => [ON, 'Sent'],
  waiting: () => [ON, 'Changes to send'],
  sending: () => [ON, 'Sending'],
  backoff: () => [ON, 'Not sent, trying again'],
  rejected: () => [ON, 'Refused by the server'],
  locked: () => [ON, 'Claimed by another phone'],
};
const pushState = (p: Push): readonly string[] => (PUSH[p.at] as (p: Push) => readonly string[])(p);

function pushStep(m: Move, from: World, to: World): string | null {
  if (to.push.at === 'off') return 'you are no longer in the room as a player';
  if (from.push.at === 'off') return 'you are in the room as a player';
  const e = pushEvent(m), l = linkEvent(m);
  if (m.some(x => x.to === 'link' && (x.e.type === 'retry' || x.e.type === 'polled'))) return 'the room answers again, or you tap Try now';
  if (!e) throw new Error(`${l?.type} moved the push from ${from.push.at} to ${to.push.at} with no label`);
  switch (e.type) {
    case 'changed': return 'you change your hunter';
    case 'rebound': return null;
    case 'timerFired': return 'the wait ends';
    case 'sent': case 'refused':
      if (to.push.at === 'waiting') return 'the room answers, and you changed it meanwhile';
      return e.type === 'sent' ? 'the room takes it' : 'the room refuses it (too large, or the room is full)';
    case 'failed': return 'the send fails';
    case 'notYours': return 'another phone holds this hunter';
    case 'pollOk': case 'retry': return 'the room answers again, or you tap Try now';
    default: throw new Error(`${e.type} moved the push from ${from.push.at} to ${to.push.at} with no label`);
  }
}
function bothStep(m: Move, from: World, to: World): Arrow {
  if (linkEvent(m)?.type === 'replaced') return null;
  if (pushEvent(m)?.type === 'rebound') return null;
  return {
    'Room link': playing(to.link) ? 'you join or come back as a player' : 'you leave, switch rooms, are put out, or the app updates',
    'Sheet push': pushStep(m, from, to),
  };
}

const linkView: View<World, Move> = {
  title: 'The room link',
  note: 'The chart shows what the room pill and the Room view say. It leaves out the waits between polls (5 s, 3 s in a fight, longer after failures; a hidden page does not poll, except a GM\'s page that may notify, which polls every 30 s), how many polls failed, whether a poll is out or waiting, the room code, the last room and the GM key, and whether the phone is the GM or a player, except where a step depends on it. Opening and joining a room go back to the box the phone came from when they fail. Updating the app is never left: the page reloads.',
  hides: 'a save replaced by an import, a restore or a reset starts the link again from the room in the new save, from any state but No room server and Updating the app. A server on a newer build sends every state to Updating the app; the chart draws that arrow from In a room only',
  state: (w): Shape => linkState(w.link),
  step: linkStep,
};
const bothView: View<World, Move> = {
  title: 'The room link and the sheet push',
  note: 'A player\'s phone sends its hunter to the room while it is in a room as a player, and only then. The link side is cut down to that one question. The push side leaves out the waits (3 s after a change, then 3 s doubling to 60 s after failures, 30 s while another phone holds the hunter) and how many sends failed. A GM\'s phone never sends a sheet.',
  hides: 'a save replaced by an import, a restore or a reset, which leaves the room and enters the one in the new save; and Play as another hunter, which sends the new hunter soon from any push state but Off',
  state: (w): Shape => ({ 'Room link': playing(w.link) ? PLAYER : NOT_PLAYER, 'Sheet push': pushState(w.push) }),
  step: bothStep,
};

export const link = machine<World, Move>({
  name: 'The room link and the sheet push',
  walked: 'Every state of the link and the push together that the model check of tests/sync-model.test.ts reaches from the four ways a page boots (tests/models/sync-world.ts), breadth first: taps, timers, and every kind of reply to each request that is out.',
  walk: () => bfs(BOOTS.map(start), w => moves(w).map(m => ({ event: m.events, to: m.next() })), key),
  kinds: [...Object.keys(LINK).map(k => `link ${k}`), ...Object.keys(PUSH).map(k => `push ${k}`)],
  kindsOf: w => [`link ${w.link.at}`, `push ${w.push.at}`],
  views: [linkView, bothView],
  where: [
    ['The unions', '`Link` and `LinkEvent` in `src/core/sync/link.ts`; `Push` and `PushEvent` in `src/core/sync/push.ts`'],
    ['What changes them', '`reduce(link, event)` in `link.ts`; `reduce(push, event)` in `push.ts`, which hears the link through its `push` effects'],
    ['Who calls them', '`src/edge/sync.ts`, which holds the one current link and push and carries out their effects. `connection(link, push)` in `src/core/sync/connection.ts` says what the pill shows'],
    ['The test to copy', '`tests/link.test.ts` and `tests/push.test.ts`; every reachable state is checked in `tests/sync-model.test.ts`, whose world and replies are in `tests/models/sync-world.ts`'],
    ['The recipe', 'docs/guide/room-sync.md, "To add a link state or a reply"'],
  ],
});
