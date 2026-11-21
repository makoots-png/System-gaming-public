// lobby.ts: the Room view's two machines with a life of their own, as steps. Pure. src/views/room.js keeps the one
// value (`Lobby`) and moves it only through `lobbyStep`, carrying out the effects it answers.
//
// A code check (`LobbyCheck`): the code typed under Join a room is asked of the server after a pause, and the code of
// an invite link at once; the line under it says what the server answered. A GM seat action (`LobbySeat`): Remove (after
// its confirm window), Release to a new device and Allow back, from the tap until the server answers, tied to the room
// it was tapped in.
//
// Before, both lived in a bag of the view (`view = { jc, ic, hid, open, t }`, audit SMX-sync-11 and SMX-views-10). The
// pause's timer was cleared only by the next keystroke, so a code typed just before Join was still asked after the
// phone was in the room (sync-11.2). A seat action had no state at all: a double tap on Release sent two requests and
// showed two toasts (sync-11.1), and a Remove confirmed after the room changed under its window removed that key in the
// new room and took it out of the new room's fight (sync-11.3). Now a Join tap and a room change end a check's pause
// and drop its question, one seat action a key is out at a time (a second tap sends nothing), and a room change drops
// the seat actions of the room left, so a confirm or an answer that comes back for it does nothing.
import type { RoomCode } from '../ids.ts';
import type { Call } from './outbox.ts';

/** How long typing must stop before the typed code is asked of the server. */
export const LOBBY_PAUSE_MS = 300;

/** What the server said of a code (sync.ts `check`): whether the room exists and this phone holds its GM key; `ok: false` when it did not answer. */
export type LobbyAnswer = { readonly ok: true; readonly exists: boolean; readonly gm: boolean } | { readonly ok: false };
/** What a join the server refused as "no such room" says of its code, without asking again. */
export const LOBBY_NOT_FOUND: LobbyAnswer = { ok: true, exists: false, gm: false };

/**
 * `idle`: no code to check. `waiting`: a code was typed and the pause's timer is set. `asking`: the question is out.
 * `known`: the server's answer for `code` (or a join's "no such room").
 */
export type LobbyCheck =
  | { readonly at: 'idle' }
  | { readonly at: 'waiting'; readonly code: RoomCode }
  | { readonly at: 'asking'; readonly code: RoomCode }
  | { readonly at: 'known'; readonly code: RoomCode; readonly answer: LobbyAnswer };
export const LOBBY_CHECK_STATES = ['idle', 'waiting', 'asking', 'known'] as const satisfies readonly LobbyCheck['at'][];
const IDLE: LobbyCheck = { at: 'idle' };

/**
 * `typed`: the field now holds `code` (null: not a whole code). `paused`: the pause's timer for `code` ran out. `ask`:
 * ask `code` now (an invite). `answered`: the server answered `code`. `notFound`: a join of `code` was refused as no
 * such room. `cancel`: a Join tap or a room change; a pause ends and a question out is dropped, an answer stays.
 * `reset`: the check is over (a join made, an invite dropped). `serverBack`: the server answers again; a check it
 * could not answer is asked again (`invite`: the invite still pending, so a spent one is not asked).
 */
export type LobbyCheckEvent =
  | { readonly type: 'typed'; readonly code: RoomCode | null }
  | { readonly type: 'paused'; readonly code: RoomCode }
  | { readonly type: 'ask'; readonly code: RoomCode }
  | { readonly type: 'answered'; readonly code: RoomCode; readonly answer: LobbyAnswer }
  | { readonly type: 'notFound'; readonly code: RoomCode }
  | { readonly type: 'cancel' }
  | { readonly type: 'reset' }
  | { readonly type: 'serverBack' };
export const LOBBY_CHECK_EVENTS = ['typed', 'paused', 'ask', 'answered', 'notFound', 'cancel', 'reset', 'serverBack'] as const satisfies readonly LobbyCheckEvent['type'][];

/** `setTimer`, `clearTimer`: the pause's one timer, whose end is `paused`. `ask`: ask the server about `code` and step its answer. */
export type LobbyCheckEffect =
  | { readonly type: 'setTimer'; readonly code: RoomCode; readonly ms: number }
  | { readonly type: 'clearTimer' }
  | { readonly type: 'ask'; readonly code: RoomCode };
export type LobbyCheckResult = { readonly state: LobbyCheck; readonly effects: readonly LobbyCheckEffect[] };

type CheckOut = LobbyCheckResult;
const stay = (s: LobbyCheck): CheckOut => ({ state: s, effects: [] });
/** Leaving `s` for `to`: a pause's timer is cleared. */
const leave = (s: LobbyCheck, to: LobbyCheck, ...effects: LobbyCheckEffect[]): CheckOut =>
  ({ state: to, effects: s.at === 'waiting' ? [{ type: 'clearTimer' }, ...effects] : effects });
const typed = (s: LobbyCheck, e: Extract<LobbyCheckEvent, { type: 'typed' }>): CheckOut =>
  e.code === null ? leave(s, IDLE) : leave(s, { at: 'waiting', code: e.code }, { type: 'setTimer', code: e.code, ms: LOBBY_PAUSE_MS });
const ask = (s: LobbyCheck, code: RoomCode): CheckOut => leave(s, { at: 'asking', code }, { type: 'ask', code });
const notFound = (s: LobbyCheck, e: Extract<LobbyCheckEvent, { type: 'notFound' }>): CheckOut => leave(s, { at: 'known', code: e.code, answer: LOBBY_NOT_FOUND });
const reset = (s: LobbyCheck): CheckOut => leave(s, IDLE);

type CheckCell<S extends LobbyCheck['at'], E extends LobbyCheckEvent['type']> = (s: Extract<LobbyCheck, { at: S }>, e: Extract<LobbyCheckEvent, { type: E }>) => CheckOut;
type CheckTable = { readonly [S in LobbyCheck['at']]: { readonly [E in LobbyCheckEvent['type']]: CheckCell<S, E> } };
/** What each event does from each state. A `paused` or an `answered` for another code than the one waited on or asked is late: it changes nothing. */
const CHECK: CheckTable = {
  idle: {
    typed, paused: stay, ask: (s, e) => ask(s, e.code), answered: stay, notFound, cancel: stay, reset: stay, serverBack: stay,
  },
  waiting: {
    typed, paused: (s, e) => (e.code === s.code ? ask(s, s.code) : stay(s)), ask: (s, e) => ask(s, e.code), answered: stay, notFound,
    cancel: reset, reset, serverBack: stay,
  },
  asking: {
    typed, paused: stay, ask: (s, e) => ask(s, e.code),
    answered: (s, e) => (e.code === s.code ? { state: { at: 'known', code: s.code, answer: e.answer }, effects: [] } : stay(s)),
    notFound, cancel: reset, reset, serverBack: stay,
  },
  known: {
    typed, paused: stay, ask: (s, e) => ask(s, e.code), answered: stay, notFound, cancel: stay, reset,
    // an answer of "the server did not answer" is asked again; what the server said stays
    serverBack: s => (s.answer.ok === true ? stay(s) : ask(s, s.code)),
  },
};

/** One event of a code check. */
export function checkStep(s: LobbyCheck, e: LobbyCheckEvent): LobbyCheckResult {
  // The table pairs each state with its own cells and each cell with its own event, so the cell for `s.at` and
  // `e.type` takes them.
  const row = CHECK[s.at] as { readonly [E in LobbyCheckEvent['type']]: (s: LobbyCheck, e: LobbyCheckEvent) => CheckOut };
  return row[e.type](s, e);
}

/** The answer a check holds for `code`, or null while it is not known for that code. */
export function checkAnswer(s: LobbyCheck, code: string | null): LobbyAnswer | null {
  return s.at === 'known' && s.code === code ? s.answer : null;
}
/** Whether the server is being asked about `code` now (the line says "Checking..."). */
export function checkAsking(s: LobbyCheck, code: string | null): boolean {
  return s.at === 'asking' && s.code === code;
}

/** A GM's action on a player's seat: Remove from room, Release to a new device, Allow back. */
export type LobbySeatAct = 'remove' | 'release' | 'allow';
/**
 * One seat action out, for the sheet key `key` in room `room`, with the name its words use. `confirming`: Remove's
 * confirm window is open. `sent`: the request is out.
 */
export type LobbySeat =
  | { readonly at: 'confirming'; readonly act: 'remove'; readonly room: RoomCode; readonly key: string; readonly name: string }
  | { readonly at: 'sent'; readonly act: LobbySeatAct; readonly room: RoomCode; readonly key: string; readonly name: string };
/** The seat actions out: at most one a key and room. */
export type LobbySeats = readonly LobbySeat[];
/** A key's seat state, for the table test: none out, or one confirming or sent. */
export const LOBBY_SEAT_STATES = ['none', 'confirming', 'sent'] as const;

/**
 * `seatTapped`: the GM tapped `act` on `key` in `room` (null: in no room). `confirmed`: Remove's window for `key` in
 * `room` was answered. `seatAnswered`: the server answered the request. `room`: the phone is now in room `code` (null:
 * none).
 */
export type LobbySeatEvent =
  | { readonly type: 'seatTapped'; readonly act: LobbySeatAct; readonly key: string; readonly name: string; readonly room: RoomCode | null }
  | { readonly type: 'confirmed'; readonly key: string; readonly room: RoomCode; readonly yes: boolean }
  | { readonly type: 'seatAnswered'; readonly act: LobbySeatAct; readonly key: string; readonly room: RoomCode; readonly call: Call }
  | { readonly type: 'room'; readonly code: RoomCode | null };
export const LOBBY_SEAT_EVENTS = ['seatTapped', 'confirmed', 'seatAnswered', 'room'] as const satisfies readonly LobbySeatEvent['type'][];

/** `confirm`: open Remove's confirm window. `send`: send the request. `told`: tell the GM the answer (and a Remove taken: out of the fight too). */
export type LobbySeatEffect =
  | { readonly type: 'confirm'; readonly key: string; readonly room: RoomCode; readonly name: string }
  | { readonly type: 'send'; readonly act: LobbySeatAct; readonly key: string; readonly room: RoomCode }
  | { readonly type: 'told'; readonly act: LobbySeatAct; readonly key: string; readonly name: string; readonly call: Call };
export type LobbySeatResult = { readonly state: LobbySeats; readonly effects: readonly LobbySeatEffect[] };

const sameSeat = (a: LobbySeat, key: string, room: RoomCode): boolean => a.key === key && a.room === room;

/** One event of the seat actions. */
export function seatStep(s: LobbySeats, e: LobbySeatEvent): LobbySeatResult {
  switch (e.type) {
    case 'seatTapped': {
      const room = e.room;
      // in no room nothing is asked; a second tap on a key whose action is out sends nothing
      if (room === null || s.some(a => sameSeat(a, e.key, room))) return { state: s, effects: [] };
      if (e.act === 'remove') return { state: [...s, { at: 'confirming', act: 'remove', room, key: e.key, name: e.name }], effects: [{ type: 'confirm', key: e.key, room, name: e.name }] };
      return { state: [...s, { at: 'sent', act: e.act, room, key: e.key, name: e.name }], effects: [{ type: 'send', act: e.act, key: e.key, room }] };
    }
    case 'confirmed': {
      const a = s.find(x => x.at === 'confirming' && sameSeat(x, e.key, e.room));
      if (!a) return { state: s, effects: [] };
      const rest = s.filter(x => x !== a);
      if (!e.yes) return { state: rest, effects: [] };
      return { state: [...rest, { ...a, at: 'sent' }], effects: [{ type: 'send', act: 'remove', key: a.key, room: a.room }] };
    }
    case 'seatAnswered': {
      const a = s.find(x => x.at === 'sent' && x.act === e.act && sameSeat(x, e.key, e.room));
      if (!a) return { state: s, effects: [] };
      return { state: s.filter(x => x !== a), effects: [{ type: 'told', act: a.act, key: a.key, name: a.name, call: e.call }] };
    }
    case 'room': {
      const kept = s.filter(a => a.room === e.code);
      return { state: kept.length === s.length ? s : kept, effects: [] };
    }
  }
}

/** Whether a seat action on `key` in `room` is out, so its buttons wait. */
export function seatBusy(s: LobbySeats, key: string, room: RoomCode | null): boolean {
  return room !== null && s.some(a => sameSeat(a, key, room));
}

/** Which code check: the code typed under Join a room, or the code of the invite link the page was opened with. */
export type LobbyCheckOf = 'join' | 'invite';
/** The Room view's value: its two code checks and the GM's seat actions out. */
export type Lobby = { readonly join: LobbyCheck; readonly invite: LobbyCheck; readonly seats: LobbySeats };
export const LOBBY_START: Lobby = { join: IDLE, invite: IDLE, seats: [] };

/**
 * What the Room view tells the lobby. `typed` and `paused` are the join field's; `asked` is the invite's; `answered`
 * and `notFound` name their check. `joinTapped`: a Join, Create or Rejoin tap (the join field's check ends).
 * `joined`: a join was made (both checks end). `dropped`: Not this room. `serverBack`: the server answers again
 * (`invite`: the invite still pending). `room`: the phone's room changed. The rest are the seat actions'.
 */
export type LobbyEvent =
  | { readonly type: 'typed'; readonly code: RoomCode | null }
  | { readonly type: 'paused'; readonly code: RoomCode }
  | { readonly type: 'asked'; readonly code: RoomCode }
  | { readonly type: 'answered'; readonly of: LobbyCheckOf; readonly code: RoomCode; readonly answer: LobbyAnswer }
  | { readonly type: 'notFound'; readonly of: LobbyCheckOf; readonly code: RoomCode }
  | { readonly type: 'joinTapped' }
  | { readonly type: 'joined' }
  | { readonly type: 'dropped' }
  | { readonly type: 'serverBack'; readonly invite: RoomCode | null }
  | { readonly type: 'room'; readonly code: RoomCode | null }
  | Exclude<LobbySeatEvent, { type: 'room' }>;

/** A check's effects, named by which check; the seat actions' as they are. */
export type LobbyEffect =
  | { readonly type: 'setTimer'; readonly code: RoomCode; readonly ms: number }
  | { readonly type: 'clearTimer' }
  | { readonly type: 'ask'; readonly of: LobbyCheckOf; readonly code: RoomCode }
  | LobbySeatEffect;
export type LobbyResult = { readonly state: Lobby; readonly effects: readonly LobbyEffect[] };

/** One check's step, put back in the lobby with its effects named by the check. */
function onCheck(l: Lobby, of: LobbyCheckOf, e: LobbyCheckEvent): LobbyResult {
  const r = checkStep(l[of], e);
  return { state: r.state === l[of] ? l : { ...l, [of]: r.state }, effects: r.effects.map((x): LobbyEffect => (x.type === 'ask' ? { ...x, of } : x)) };
}
/** Both checks' steps, the join field's first. */
function onBoth(l: Lobby, join: LobbyCheckEvent, invite: LobbyCheckEvent): LobbyResult {
  const a = onCheck(l, 'join', join), b = onCheck(a.state, 'invite', invite);
  return { state: b.state, effects: [...a.effects, ...b.effects] };
}
function onSeats(l: Lobby, e: LobbySeatEvent): LobbyResult {
  const r = seatStep(l.seats, e);
  return { state: r.state === l.seats ? l : { ...l, seats: r.state }, effects: r.effects };
}

/** One event of the Room view's lobby. */
export function lobbyStep(l: Lobby, e: LobbyEvent): LobbyResult {
  switch (e.type) {
    case 'typed': return onCheck(l, 'join', e);
    case 'paused': return onCheck(l, 'join', e);
    case 'asked': return onCheck(l, 'invite', { type: 'ask', code: e.code });
    case 'answered': return onCheck(l, e.of, { type: 'answered', code: e.code, answer: e.answer });
    case 'notFound': return onCheck(l, e.of, { type: 'notFound', code: e.code });
    case 'joinTapped': return onCheck(l, 'join', { type: 'cancel' });
    case 'joined': return onBoth(l, { type: 'reset' }, { type: 'reset' });
    case 'dropped': return onCheck(l, 'invite', { type: 'reset' });
    // the invite's check is asked again only while that invite is still the one pending
    case 'serverBack': return l.invite.at === 'known' && l.invite.code === e.invite ? onBoth(l, e, e) : onCheck(l, 'join', e);
    case 'room': {
      const r = onCheck(l, 'join', { type: 'cancel' }), s = onSeats(r.state, e);
      return { state: s.state, effects: [...r.effects, ...s.effects] };
    }
    case 'seatTapped': case 'confirmed': case 'seatAnswered': return onSeats(l, e);
  }
}
