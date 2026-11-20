// link.ts: this phone's link to a room, as one machine. Pure: no clock, no network, no storage. `reduce(link, event)`
// answers the next link and the effects the edge carries out (requests, timers, the save, notices, news for the push).
// Every request carries the link's `gen`. Entering idle, creating, joining, live or upgrading takes a new gen, and a
// reply whose gen is not the current one changes nothing. That is the whole late-reply rule.
// The sheet push is its own machine (push.ts). The link tells it what it needs through `push` effects and never reads it.
import type { FightDoc, RoomCode } from '../protocol.ts';
import { deviceOf } from '../ids.ts';
import type { Brand, GmKey } from '../ids.ts';
export type { GmKey };

// ── ids ──
/** One stretch of the link: requests of an earlier stretch are stale. Made only by this file (and tests). */
export type Gen = Brand<number, 'Gen'>;

// ── numbers ──
/** Between healthy polls: how stale another phone's sheet may look between turns at the table. Today's number. */
export const POLL_MS = 5000;
/** Between healthy polls while a fight runs: turns move faster than that, so the board refreshes faster. Today's number. */
export const POLL_FAST_MS = 3000;
/**
 * Between a GM phone's polls while a player's hunter has the turn: the GM's phone takes that player's move only when a
 * poll brings it, so this is most of the player's wait to see their move. One small page a second, and only on a
 * player's turn: a monster's or the GM's own hunter's turn polls at POLL_FAST_MS.
 */
export const POLL_TURN_MS = 1000;
/**
 * After a player's own fight move reached the room (`sent`), the phone polls at once and then every CHASE_MS until the
 * fight doc is another than the one the move was sent from, at most CHASE_POLLS polls (3 s), then at its pace again. The
 * GM's phone takes the move within POLL_TURN_MS and its fight doc follows a fifth of a second later (sync.ts), so the
 * answer is usually in by the second or third poll; the bound is for a GM phone that is slow, hidden or gone.
 */
export const CHASE_MS = 300;
export const CHASE_POLLS = 10;
/** How often a page in a room polls: no fight, a fight runs, or (a GM's phone) a player's hunter has the turn. */
export type PollPace = 'table' | 'fight' | 'turn';
export const PACE_MS: Record<PollPace, number> = { table: POLL_MS, fight: POLL_FAST_MS, turn: POLL_TURN_MS };
/** The pace of a room whose fight doc is `fight`, for this `device`: a GM's phone waits on a player's move while a hunter of another device has the turn. */
export function paceOf(fight: FightDoc | null, gm: boolean, device: string): PollPace {
  if (!fight || fight.ended || !fight.active) return 'table';
  const cur = fight.rows.find(r => r.id === fight.currentId);
  return gm && cur && cur.key !== null && deviceOf(cur.key) !== device ? 'turn' : 'fight';
}
/**
 * The wait after 1, 2, 3, then 4 or more failed polls in a row. A phone that lost the network should not wake the radio
 * every 5 s for an hour, and 30 s is the longest a table waits for a phone to come back without anyone tapping.
 */
export const POLL_WAITS = [5000, 10000, 20000, 30000] as const;
export const pollWait = (failed: number): number => POLL_WAITS[Math.min(Math.max(failed, 1), POLL_WAITS.length) - 1] ?? POLL_MS;
/**
 * Between polls of a GM's page that is hidden, while the GM lets the app notify them of a player's use. One poll is a
 * small request, and browsers slow a hidden page's timers to about one a minute anyway; a locked phone gets nothing until
 * it is opened, when the feed and the log catch up.
 */
export const HIDDEN_POLL_MS = 30000;
/**
 * The wait before the next poll of a hidden page, for a wait of `ms` the link asked for: a GM in a live room whose
 * notifications are granted polls every 30 s at the most often; any other hidden page does not poll (null) until it is shown.
 */
export const hiddenWait = (link: Link, ms: number, notifying: boolean): number | null =>
  link.at === 'live' && link.key !== null && notifying ? Math.max(ms, HIDDEN_POLL_MS) : null;
/**
 * How long each request may take before the edge gives up and answers `failed { kind: 'timeout' }`. Judgment, not
 * measurement. Health, peek and create answer a few bytes, so a server that takes longer than 8 or 10 s is one the
 * table cannot play on, and a player is looking at the Join button. A poll or the head of a room carries a page of up to
 * 200 events and every sheet (up to 24 of 32 KB), so it keeps today's 20 s.
 */
export const TIMEOUT_MS = { health: 8000, peek: 8000, create: 10000, poll: 20000, head: 20000 } as const;

// ── the link ──
/** The room this phone was last in, and why it is not in it now. Mirrors `settings.sync.lastRoom`. */
export type Last = null | { code: RoomCode; why: 'left' | 'gone' | 'removed' };
/** Out of a room: what the health polls say. `unreachable` counts failed health polls in a row, for the wait. */
export type Server = 'unknown' | 'ok' | { unreachable: number };
/** In a room: `connecting` until the first poll answers, then `ok` or n failed polls in a row. */
export type LinkHealth = 'connecting' | 'ok' | { failed: number };
/** Idle and live always poll: either the poll timer is set or one poll is out. */
export type Next = 'timer' | 'polling';
/**
 * A player's phone waits for the answer to its own fight move: the fight doc's `at` the move was sent from (null when
 * the phone held no fight doc), and the quick polls left (CHASE_POLLS at most).
 */
export type Chase = { from: string | null; left: number };

/** This page has no room server. */
export type LinkOff = { at: 'off'; gen: Gen };
export type Idle = { at: 'idle'; gen: Gen; server: Server; last: Last; next: Next };
/** In a room. `key` is the room's GM key when this phone is its GM, else null: the phone is a player. `pace` is the room's as last heard. */
export type Live = { at: 'live'; gen: Gen; code: RoomCode; key: GmKey | null; cursor: number; health: LinkHealth; last: Last; next: Next; pace: PollPace; chase: Chase | null };
/** Where a failed create or join returns to. */
export type Back = LinkOff | Idle | Live;
export type Creating = { at: 'creating'; gen: Gen; back: Back };
/**
 * `peek` asks whether the room exists, `head` reads where its events end (and checks the key or the removal). `from`: the
 * cursor this phone had when it last went out of the room (the save's `seen`), or null for a room it was never in.
 */
export type Joining = { at: 'joining'; gen: Gen; code: RoomCode; key: GmKey | null; from: number | null; step: 'peek' | 'head'; back: Back };
/** Another build's server answered. Never left: the edge reloads, and `stuck` says the reload did not help. */
export type Upgrading = { at: 'upgrading'; gen: Gen; stuck: boolean };
export type Link = LinkOff | Idle | Creating | Joining | Live | Upgrading;
export type LinkAt = Link['at'];

// ── events ──
export type FailKind = 'net' | 'timeout' | 'server';
export type LinkEvent =
  // taps
  | { type: 'create' }
  /**
   * `key` is the GM key this phone holds for the room, or null to join as a player. `from`: where this phone stopped
   * reading the room when it last went out of it (the save's `seen[code]`), or null when it keeps none.
   */
  | { type: 'join'; code: RoomCode; key: GmKey | null; from: number | null }
  | { type: 'leave' }
  /** Forget the last room. */
  | { type: 'forget' }
  /** Try now. */
  | { type: 'retry' }
  /** A player's own fight move (a step, a cast, End turn) reached the room, sent from the fight doc of `at` `from`. */
  | { type: 'sent'; from: string | null }
  /** The GM's phone put a fight doc whose pace is `pace` (a fight began or ended, a player's turn came or went). */
  | { type: 'paced'; pace: PollPace }
  /** The whole save was replaced (import, restore, reset): the link starts again from the room it now holds, as at boot. */
  | { type: 'replaced'; room: BootInput['room']; last: Last }
  // the page and the network
  | { type: 'online' }
  | { type: 'offline' }
  | { type: 'visible' }
  | { type: 'timerFired'; name: LinkTimer }
  // replies, each for the gen of the request
  | { type: 'healthOk'; gen: Gen }
  /** A poll page. `cursor` is the last seq in it, `more` that the page was full, `pace` the room's, `fightAt` its fight doc's `at`. */
  | { type: 'polled'; gen: Gen; cursor: number; more: boolean; pace: PollPace; fightAt: string | null }
  | { type: 'created'; gen: Gen; code: RoomCode; key: GmKey }
  | { type: 'peeked'; gen: Gen; exists: boolean }
  /** The head of the room: where its events end, whether the key sent is its GM key, whether our sheet was removed lately. */
  | { type: 'headed'; gen: Gen; cursor: number; gm: boolean; kicked: boolean }
  /** The server said `no such room` (a 404 with that reason; any other 404 is `failed`). */
  | { type: 'gone'; gen: Gen }
  /** The GM removed this phone's sheet: raised by the edge from the `_kicked` doc of a poll or a push's 403 removed. */
  | { type: 'removed'; gen: Gen }
  /** A GM's poll answered that the key it sent is not the room's GM key: raised by the edge after the poll answer. */
  | { type: 'keyLost'; gen: Gen }
  | { type: 'failed'; gen: Gen; kind: FailKind }
  /** A 426 from any request, current or not: it is about the build, not a room. `stuck` comes from `decideUpgrade`. */
  | { type: 'upgrade'; stuck: boolean };
export type LinkEventType = LinkEvent['type'];

// ── effects ──
export type LinkTimer = 'poll';
export type LinkCall =
  | { req: 'health' }
  | { req: 'poll'; code: RoomCode; cursor: number; key: GmKey | null }
  | { req: 'create' }
  | { req: 'peek'; code: RoomCode }
  | { req: 'head'; code: RoomCode; key: GmKey | null };
/** What the link writes to `settings.sync`. Only the fields that changed. */
export type SaveFields = {
  room?: RoomCode | null; cursor?: number; last?: Last; gmKey?: GmKey | null;
  /** `keep` a key; `drop` the key the room refused (a wrong typed key leaves a good stored one); a room `gone` takes any key of it. */
  ring?: { keep: RoomCode; key: GmKey } | { drop: RoomCode } | { gone: RoomCode };
};
/** A toast or a window. The view holds the words. */
export type LinkNotice = 'gone' | 'removed' | 'notFound' | 'keyRefused' | 'notAllowedBack' | 'keyLost' | 'unreachable' | 'serverError' | 'upgradeStuck' | 'replaced';
/** What the link tells the sheet push. */
export type LinkNews = { type: 'linkLive'; gen: Gen } | { type: 'linkLost' } | { type: 'pollOk'; gen: Gen } | { type: 'retry' };
export type LinkEffect =
  | { type: 'request'; gen: Gen; timeoutMs: number; call: LinkCall }
  /** Drop every request of this gen, the push's included: its answers would change nothing. */
  | { type: 'abort'; gen: Gen }
  | { type: 'setTimer'; name: LinkTimer; ms: number }
  | { type: 'clearTimer'; name: LinkTimer }
  | { type: 'save'; fields: SaveFields }
  | { type: 'notify'; id: LinkNotice; code: RoomCode | null }
  /** Tell the views. `serverBack` when the server answers after failing: a view re-checks what it showed. */
  | { type: 'status'; serverBack: boolean }
  /** Carry out the room data of the reply just given: a poll page, or the head of a joined room. */
  | { type: 'apply' }
  | { type: 'push'; event: LinkNews };
export type LinkResult = { state: Link; effects: LinkEffect[] };

// ── starting ──
export type BootInput = {
  /** The page was served by the room server, or a server answered on an earlier visit. */
  server: boolean;
  /** The room in the save, if any. */
  room: { code: RoomCode; key: GmKey | null; cursor: number } | null;
  last: Last;
};
/** The link a page opens with, and its first request. */
export function boot(input: BootInput): LinkResult {
  const gen = 1 as Gen;
  if (!input.server) return { state: { at: 'off', gen }, effects: [] };
  const { room, last } = input;
  const out = room ? live(gen, room.code, room.key, room.cursor, last, 'connecting') : pollNow({ at: 'idle', gen, server: 'unknown', last, next: 'timer' });
  return { state: out.state, effects: [...out.effects, { type: 'status', serverBack: false }] };
}

// ── the reducer ──
type Step = { state: Link; effects: LinkEffect[] };
const same = (link: Link): Step => ({ state: link, effects: [] });
const nextGen = (gen: Gen): Gen => (gen + 1) as Gen;
const request = (gen: Gen, call: LinkCall): LinkEffect => ({ type: 'request', gen, timeoutMs: TIMEOUT_MS[call.req], call });
const news = (event: LinkNews): LinkEffect => ({ type: 'push', event });
const notify = (id: LinkNotice, code: RoomCode | null): LinkEffect => ({ type: 'notify', id, code });

/** One event. A stale reply, or an event the state has no use for, answers the same link and no effects. */
export function reduce(link: Link, event: LinkEvent): LinkResult {
  const out = step(link, event);
  if (out.state === link) return out;
  return { state: out.state, effects: [...saves(link, out.state), ...out.effects, { type: 'status', serverBack: serverBack(link, out.state) }] };
}

function step(link: Link, event: LinkEvent): Step {
  if (event.type === 'upgrade') return upgrade(link, event.stuck);
  if (link.at === 'upgrading') return same(link);
  if ('gen' in event && event.gen !== link.gen) return same(link);
  if (event.type === 'replaced') return link.at === 'off' ? same(link) : replaced(link, event);
  switch (link.at) {
    case 'off': return event.type === 'create' || event.type === 'join' ? begin(link, event) : same(link);
    case 'idle': return idle(link, event);
    case 'creating': return creating(link, event);
    case 'joining': return joining(link, event);
    case 'live': return inRoom(link, event);
  }
}

/** Leaving a state: its requests are dropped, its timer cleared, and a player's push stops. */
function exit(link: Link): LinkEffect[] {
  if (link.at === 'off' || link.at === 'upgrading') return [];
  const fx: LinkEffect[] = [{ type: 'abort', gen: link.gen }];
  if ((link.at === 'idle' || link.at === 'live') && link.next === 'timer') fx.push({ type: 'clearTimer', name: 'poll' });
  if (link.at === 'live' && link.key === null) fx.push(news({ type: 'linkLost' }));
  return fx;
}

function upgrade(link: Link, stuck: boolean): Step {
  if (link.at === 'upgrading') {
    return stuck && !link.stuck ? { state: { ...link, stuck: true }, effects: [notify('upgradeStuck', null)] } : same(link);
  }
  return { state: { at: 'upgrading', gen: nextGen(link.gen), stuck }, effects: [...exit(link), ...(stuck ? [notify('upgradeStuck', null)] : [])] };
}

/** Ask now: the server's health out of a room, the room's events in one. Only when no poll is out. */
function pollNow(link: Idle | Live): Step {
  if (link.next === 'polling') return same(link);
  const call: LinkCall = link.at === 'idle' ? { req: 'health' } : { req: 'poll', code: link.code, cursor: link.cursor, key: link.key };
  return { state: { ...link, next: 'polling' }, effects: [request(link.gen, call)] };
}
/** Try now, online, visible: cut the wait short. The failure count stays, so a phone still offline keeps backing off. */
function wake(link: Idle | Live): Step {
  if (link.next === 'polling') return same(link);
  const out = pollNow(link);
  return { state: out.state, effects: [{ type: 'clearTimer', name: 'poll' }, ...out.effects] };
}
function toIdle(gen: Gen, server: Server, last: Last): Step {
  const ms = typeof server === 'object' ? pollWait(server.unreachable) : POLL_MS;
  return { state: { at: 'idle', gen, server, last, next: 'timer' }, effects: [{ type: 'setTimer', name: 'poll', ms }] };
}
/** Enter a room: poll it at once, and start a player's push. */
function live(gen: Gen, code: RoomCode, key: GmKey | null, cursor: number, last: Last, h: LinkHealth): Step {
  const out = pollNow({ at: 'live', gen, code, key, cursor, health: h, last, next: 'timer', pace: 'table', chase: null });
  return { state: out.state, effects: [...out.effects, ...(key === null ? [news({ type: 'linkLive', gen })] : [])] };
}
/** Return to where a create or join started, with a new gen. */
function resume(back: Back, gen: Gen): Step {
  switch (back.at) {
    case 'off': return { state: { at: 'off', gen }, effects: [] };
    case 'idle': return toIdle(gen, back.server, back.last);
    case 'live': return live(gen, back.code, back.key, back.cursor, back.last, back.health);
  }
}
/** The last room once this phone is in `code`: the room it came from, or what it had unless that was `code`. */
function lastAfter(back: Back, code: RoomCode): Last {
  if (back.at === 'live') return back.code === code ? back.last : { code: back.code, why: 'left' };
  if (back.at === 'idle') return back.last && back.last.code === code ? null : back.last;
  return null;
}

function begin(link: Back, event: Extract<LinkEvent, { type: 'create' | 'join' }>): Step {
  const gen = nextGen(link.gen);
  if (event.type === 'create') return { state: { at: 'creating', gen, back: link }, effects: [...exit(link), request(gen, { req: 'create' })] };
  return {
    state: { at: 'joining', gen, code: event.code, key: event.key, from: event.from, step: 'peek', back: link },
    effects: [...exit(link), request(gen, { req: 'peek', code: event.code })],
  };
}
/** Leave `link` for the step `to` (made with a new gen): the old state's exit, then `fx`, then the new state's own. */
const leaving = (link: Link, to: Step, ...fx: LinkEffect[]): Step => ({ state: to.state, effects: [...exit(link), ...fx, ...to.effects] });

function idle(link: Idle, event: LinkEvent): Step {
  switch (event.type) {
    case 'create': case 'join': return begin(link, event);
    case 'timerFired': return pollNow(link);
    case 'retry': case 'online': case 'visible': return wake(link);
    case 'offline': return typeof link.server === 'object' ? same(link) : { state: { ...link, server: { unreachable: 1 } }, effects: [] };
    case 'forget': return link.last ? { state: { ...link, last: null }, effects: [] } : same(link);
    case 'healthOk': return link.next === 'polling' ? toIdle(link.gen, 'ok', link.last) : same(link);
    case 'failed': return link.next === 'polling' ? toIdle(link.gen, { unreachable: unreachableCount(link.server) + 1 }, link.last) : same(link);
    default: return same(link);
  }
}
const unreachableCount = (s: Server): number => (typeof s === 'object' ? s.unreachable : 0);

function creating(link: Creating, event: LinkEvent): Step {
  const gen = nextGen(link.gen);
  switch (event.type) {
    case 'created':
      return leaving(link, live(gen, event.code, event.key, 0, lastAfter(link.back, event.code), 'ok'),
        { type: 'save', fields: { ring: { keep: event.code, key: event.key } } });
    case 'failed': return failed(link, gen, event.kind);
    default: return same(link);
  }
}

function joining(link: Joining, event: LinkEvent): Step {
  const gen = nextGen(link.gen);
  switch (event.type) {
    case 'peeked':
      if (link.step !== 'peek') return same(link);
      if (!event.exists) return notFound(link, gen);
      return { state: { ...link, step: 'head' }, effects: [request(link.gen, { req: 'head', code: link.code, key: link.key })] };
    case 'gone': return notFound(link, gen);
    case 'headed': {
      if (link.step !== 'head') return same(link);
      if (link.key !== null && !event.gm) {
        return leaving(link, resume(link.back, gen), { type: 'save', fields: { ring: { drop: link.code } } }, notify('keyRefused', link.code));
      }
      if (link.key === null && event.kicked) return leaving(link, resume(link.back, gen), notify('notAllowedBack', link.code));
      const keep: LinkEffect[] = link.key === null ? [] : [{ type: 'save', fields: { ring: { keep: link.code, key: link.key } } }];
      // back in a room it was in before, the phone reads on from where it stopped, so what came meanwhile lands as any page
      // does; a room it was never in, or a cursor past the room's end (another room under the code), starts at the end
      const cursor = link.from !== null && link.from <= event.cursor ? link.from : event.cursor;
      return leaving(link, live(gen, link.code, link.key, cursor, lastAfter(link.back, link.code), 'ok'), ...keep, { type: 'apply' });
    }
    case 'failed': return failed(link, gen, event.kind);
    default: return same(link);
  }
}
/**
 * The room does not exist: back where the join started, a last room of that code is marked gone, and a GM key for it
 * leaves the ring, so nothing offers to reopen a room that is no more.
 */
function notFound(link: Joining, gen: Gen): Step {
  const b = link.back;
  const back: Back = b.at !== 'off' && b.last && b.last.code === link.code ? { ...b, last: { code: link.code, why: 'gone' } } : b;
  return leaving(link, resume(back, gen), ...keyOfGone(link), notify('notFound', link.code));
}
/** A room that is gone takes its GM key with it: the key opened only that room, and its code will not come back. */
const keyOfGone = (link: Joining | Live): LinkEffect[] => (link.key === null ? [] : [{ type: 'save', fields: { ring: { gone: link.code } } }]);
/** A create or join that failed: back where it started. Out of a room, no answer reads as a failed health poll. */
function failed(link: Creating | Joining, gen: Gen, kind: FailKind): Step {
  const b = link.back;
  const back: Back = kind !== 'server' && b.at === 'idle' ? { ...b, server: { unreachable: unreachableCount(b.server) + 1 } } : b;
  return leaving(link, resume(back, gen), notify(kind === 'server' ? 'serverError' : 'unreachable', link.at === 'joining' ? link.code : null));
}

function inRoom(link: Live, event: LinkEvent): Step {
  const gen = nextGen(link.gen), player = link.key === null;
  switch (event.type) {
    case 'timerFired': return pollNow(link);
    case 'online': case 'visible': return wake(link);
    case 'retry': {
      const out = wake(link);
      return player ? { state: out.state, effects: [...out.effects, news({ type: 'retry' })] } : out;
    }
    case 'offline': return typeof link.health === 'object' ? same(link) : { state: { ...link, health: { failed: 1 } }, effects: [] };
    case 'sent': {
      if (!player) return same(link);
      const state: Live = { ...link, chase: { from: event.from, left: CHASE_POLLS } };
      return state.next === 'polling' ? { state, effects: [] } : wake(state);
    }
    case 'paced': {
      // the wait starts again at the new pace: a GM's phone polls within a second of a player's turn coming, not 5 s later
      if (event.pace === link.pace) return same(link);
      const state: Live = { ...link, pace: event.pace };
      if (link.next === 'polling' || link.chase || typeof link.health === 'object') return { state, effects: [] };
      return { state, effects: [{ type: 'setTimer', name: 'poll', ms: PACE_MS[event.pace] }] };
    }
    case 'polled': {
      if (link.next !== 'polling') return same(link);
      // the chase goes on while the fight doc is the one the move was sent from and quick polls are left
      const c = link.chase, chase = c && c.left > 1 && event.fightAt === c.from ? { from: c.from, left: c.left - 1 } : null;
      const state: Live = { ...link, cursor: event.cursor, health: 'ok', next: 'timer', pace: event.pace, chase };
      const fx: LinkEffect[] = [{ type: 'apply' }, ...(player ? [news({ type: 'pollOk', gen: link.gen })] : [])];
      if (event.more) { const out = pollNow(state); return { state: out.state, effects: [...fx, ...out.effects] }; }
      return { state, effects: [...fx, { type: 'setTimer', name: 'poll', ms: chase ? CHASE_MS : PACE_MS[event.pace] }] };
    }
    case 'failed': {
      if (link.next !== 'polling') return same(link);
      const failed = (typeof link.health === 'object' ? link.health.failed : 0) + 1;
      return { state: { ...link, health: { failed }, next: 'timer', chase: null }, effects: [{ type: 'setTimer', name: 'poll', ms: pollWait(failed) }] };
    }
    case 'gone': return link.next === 'polling' ? sentOut(link, gen, 'gone') : same(link);
    case 'removed': return player ? sentOut(link, gen, 'removed') : same(link);
    case 'keyLost':
      return player ? same(link) : leaving(link, toIdle(gen, 'ok', { code: link.code, why: 'left' }),
        { type: 'save', fields: { ring: { drop: link.code } } }, notify('keyLost', link.code));
    case 'leave': return leaving(link, toIdle(gen, serverOf(link), { code: link.code, why: 'left' }));
    case 'create': return begin(link, event);
    // a phone's place in a room is its code and its role (the key): the same place is no join, any other begins one
    case 'join': return event.code === link.code && event.key === link.key ? same(link) : begin(link, event);
    default: return same(link);
  }
}
/** Start again from the save that replaced this one. What is known about the server stays. */
function replaced(link: Idle | Creating | Joining | Live, event: Extract<LinkEvent, { type: 'replaced' }>): Step {
  const gen = nextGen(link.gen), { room, last } = event;
  const tap = link.at === 'creating' || link.at === 'joining' ? [notify('replaced', null)] : [];
  return leaving(link, room ? live(gen, room.code, room.key, room.cursor, last, 'connecting') : toIdle(gen, serverOf(link), last), ...tap);
}
function serverOf(link: Idle | Creating | Joining | Live): Server {
  switch (link.at) {
    case 'idle': return link.server;
    case 'live': return link.health === 'connecting' ? 'unknown' : link.health === 'ok' ? 'ok' : { unreachable: link.health.failed };
    case 'creating': case 'joining': return link.back.at === 'off' ? 'unknown' : serverOf(link.back);
  }
}
function sentOut(link: Live, gen: Gen, why: 'gone' | 'removed'): Step {
  return leaving(link, toIdle(gen, 'ok', { code: link.code, why }), ...(why === 'gone' ? keyOfGone(link) : []), notify(why, link.code));
}

// ── what the save and the views hear ──
type Stored = { room: RoomCode | null; cursor: number; last: Last; gmKey?: GmKey | null };
/** What the save holds for this link. Null: leave the save as it is (no server, or a reload is coming). */
function stored(link: Link): Stored | null {
  switch (link.at) {
    case 'idle': return { room: null, cursor: 0, last: link.last };
    case 'live': return { room: link.code, cursor: link.cursor, last: link.last, gmKey: link.key };
    case 'creating': case 'joining': return stored(link.back);
    case 'off': case 'upgrading': return null;
  }
}
const sameLast = (a: Last, b: Last): boolean => a === b || (!!a && !!b && a.code === b.code && a.why === b.why);
function saves(before: Link, after: Link): LinkEffect[] {
  const a = stored(after), b = stored(before);
  if (!a) return [];
  const fields: SaveFields = {};
  if (!b || a.room !== b.room) fields.room = a.room;
  if (!b || a.cursor !== b.cursor) fields.cursor = a.cursor;
  if (!b || !sameLast(a.last, b.last)) fields.last = a.last;
  if (a.gmKey !== undefined && (!b || a.gmKey !== b.gmKey)) fields.gmKey = a.gmKey;
  return Object.keys(fields).length ? [{ type: 'save', fields }] : [];
}
const failing = (l: Link): boolean => (l.at === 'idle' && typeof l.server === 'object') || (l.at === 'live' && typeof l.health === 'object');
const answering = (l: Link): boolean => (l.at === 'idle' && l.server === 'ok') || (l.at === 'live' && l.health === 'ok');
/** The server answers again after failing: from unreachable to ready, or from reconnecting to live. */
const serverBack = (before: Link, after: Link): boolean => failing(before) && answering(after);
