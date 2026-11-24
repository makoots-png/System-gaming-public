// outbox.ts: what this phone still owes the room. Pure; the save holds it (`settings.sync.outbox`) and src/edge/sync.ts
// is its one writer, through these functions and `store.apply`.
//
// Every message a phone sends the room goes in here first: a room event (a player's use, roll or coin call, a GM's
// award) or a deleted hunter's tombstone. It is sent after each good poll, one at a time per room in the order it was
// posted, and leaves the box only when the room took it (`sent`) or nothing will ever take it (`dropped`). A send that
// got no answer, or a 5xx, puts it back in the queue; a reload, or the link leaving the stretch it was sent in, does the
// same to one that was on its way (its answer is never heard). The room takes an event id once (server.ts `addEvent`)
// and a tombstone is a sheet put, so sending one again after a lost answer is never a second message. A different message under an id already used is refused, by the box and by the room alike
// (`sentAgain` in src/core/protocol.ts): never answered as taken, so a lost message is never silent.
//
// One entry's life is a machine (docs/state-machines.md, "A message to the room"): `queued`, `sending`, then `sent`,
// `refused` (the room answered 4xx: kept, with the reason, until the box is full of them) or `dropped`.
import { API_ERRORS, parseEvent, parseRoomCode, sentAgain } from '../protocol.ts';
import type { RoomCode, RoomEvent } from '../protocol.ts';
import { atSync } from '../save-step.ts';
import { parseSaveId } from '../ids.ts';
import type { HunterId } from '../ids.ts';

/** What one entry carries to the room. */
export type Letter =
  /** A room event, with its id (`newEvent` in src/core/protocol.ts). */
  | { readonly kind: 'event'; readonly event: RoomEvent }
  /** A hunter deleted on this phone: its sheet in the room is replaced by a tombstone, so it leaves the GM's board. */
  | { readonly kind: 'tomb'; readonly hid: HunterId };

export const ENTRY_STATES = ['queued', 'sending', 'sent', 'refused', 'dropped'] as const;
export type EntryState = (typeof ENTRY_STATES)[number];
/** The states an entry is kept in. `sent` and `dropped` leave the box. */
export type KeptState = Exclude<EntryState, 'sent' | 'dropped'>;
export const ENTRY_EVENTS = ['send', 'sent', 'failed', 'refused', 'reload', 'drop'] as const;
export type EntryEventType = (typeof ENTRY_EVENTS)[number];
/**
 * What happens to an entry. `send`: it goes out now. `sent`: the room took it (2xx). `failed`: no answer, or a 5xx.
 * `refused`: the room answered 4xx with `why` (or its room no longer exists). `reload`: its answer will never be heard,
 * since the page it was sent from is gone or the link left the stretch it was sent in. `drop`: nothing will ever take it (its hunter is bound again, the box is full, or
 * the player put a refusal away).
 */
export type EntryEvent =
  | { readonly type: 'send' } | { readonly type: 'sent' } | { readonly type: 'failed' } | { readonly type: 'refused'; readonly why: string }
  | { readonly type: 'reload' } | { readonly type: 'drop' };

type Base = {
  /** The event's id, or `tomb <hid>` for a tombstone. One entry per id: posting it again changes nothing. */
  readonly id: string;
  /** The room it is for. It is sent only while this phone is in that room. */
  readonly room: RoomCode;
  readonly letter: Letter;
  /** Entries of one room with the same key stand for one thing: a newer post takes the place of a queued older one. */
  readonly key: string | null;
};
export type Entry = Base & ({ readonly at: 'queued' | 'sending' } | { readonly at: 'refused'; readonly why: string });
/** Oldest first. */
export type Outbox = readonly Entry[];

/** Room messages a phone may owe at once. A post past it drops the oldest refusal, else the oldest message not on its way. */
export const OUTBOX_MAX = 100;
/** Refusals kept to show. A newer one drops the oldest. */
export const REFUSED_KEEP = 10;

/** Words shown when a full outbox drops older unsent messages. */
export const OUTBOX_WORDS = {
  dropped: (n: number): string => `There are too many unsent messages for the room server, so the app dropped ${n === 1 ? 'the oldest message' : `the ${n} oldest messages`}.`,
} as const;

/** The state each event leads to, or null where it does not apply. */
const TABLE: { readonly [S in KeptState]: { readonly [E in EntryEventType]: EntryState | null } } = {
  queued: { send: 'sending', sent: null, failed: null, refused: 'refused', reload: null, drop: 'dropped' },
  sending: { send: null, sent: 'sent', failed: 'queued', refused: 'refused', reload: 'queued', drop: 'dropped' },
  refused: { send: null, sent: null, failed: null, refused: null, reload: null, drop: 'dropped' },
};
/** The state `event` leads to from `state`, or null. */
export const entryTransition = (state: KeptState, event: EntryEventType): EntryState | null => TABLE[state][event];

/** One entry after `e`: the next entry, `sent` or `dropped` when it leaves the box, or the same entry when its state does not take `e`. */
export function entryStep(entry: Entry, e: EntryEvent): Entry | 'sent' | 'dropped' {
  const to = entryTransition(entry.at, e.type);
  if (to === null) return entry;
  if (to === 'sent' || to === 'dropped') return to;
  const base: Base = { id: entry.id, room: entry.room, letter: entry.letter, key: entry.key };
  return to === 'refused' ? { ...base, at: 'refused', why: e.type === 'refused' ? e.why : '' } : { ...base, at: to };
}

/** The entry id of a letter. */
export const idOf = (l: Letter): string => (l.kind === 'event' ? l.event.payload.eid : `tomb ${l.hid}`);

/** What a post did: the next box, and any message it pushed out to make room (the view says so). */
export type Posted = { readonly box: Outbox; readonly dropped: readonly Entry[] };
/**
 * Thrown by `post` for a different letter under an id the box holds. Each page makes its ids later than its last
 * (`stampTime` in src/core/protocol.ts), so this is a bug of whatever made the id, never a state to handle: the write
 * that posts is refused whole, and the error names the id and both messages.
 */
export class IdTaken extends Error {
  constructor(readonly id: string, held: Letter, posted: Letter) {
    super(`the outbox has a ${what(held)} under id ${id}, so this ${what(posted)} was not posted: the id was made twice`);
    this.name = 'IdTaken';
  }
}
const what = (l: Letter): string => (l.kind === 'event' ? `${l.event.type} message` : 'tombstone');
/** Whether `b`, under the id of `a`, is the same letter again (`sentAgain` in src/core/protocol.ts for an event). */
const sameLetter = (a: Letter, b: Letter): boolean =>
  a.kind === 'event' && b.kind === 'event' ? sentAgain(a.event, b.event) : a.kind === b.kind;
/**
 * `letter` for `room`, queued as the newest. The same letter again changes nothing (a post repeated); a different one
 * under an id the box holds throws `IdTaken`, as the room refuses it (server.ts `addEvent`). With `key`, a queued entry
 * of that room and key leaves for it: it stands for the same thing, newer. Over `OUTBOX_MAX`, the oldest refusal goes
 * first, then the oldest queued message, which is answered in `dropped`.
 */
export function post(box: Outbox, room: RoomCode, letter: Letter, key: string | null = null, max = OUTBOX_MAX): Posted {
  const id = idOf(letter), held = box.find(e => e.id === id);
  if (held) { if (sameLetter(held.letter, letter)) return { box, dropped: [] }; throw new IdTaken(id, held.letter, letter); }
  let next: Entry[] = [...box.filter(e => !(key !== null && e.key === key && e.room === room && e.at === 'queued')), { id, room, letter, key, at: 'queued' }];
  const dropped: Entry[] = [];
  while (next.length > max) {
    const at = next.findIndex(e => e.at === 'refused'), q = at >= 0 ? at : next.findIndex(e => e.at === 'queued' && e.id !== id);
    if (q < 0) break;
    if (next[q]!.at === 'queued') dropped.push(next[q]!);
    next = next.filter((_, i) => i !== q);
  }
  return { box: next, dropped };
}

/** The box after `e` on entry `id` (an id not in the box changes nothing). A refusal past `REFUSED_KEEP` drops the oldest. */
export function step(box: Outbox, id: string, e: EntryEvent): Outbox {
  const i = box.findIndex(x => x.id === id);
  if (i < 0) return box;
  const out = entryStep(box[i]!, e);
  if (out === box[i]) return box;
  const next = typeof out === 'string' ? box.filter((_, j) => j !== i) : box.map((x, j) => (j === i ? out : x));
  const refused = next.filter(x => x.at === 'refused');
  return refused.length > REFUSED_KEEP ? next.filter(x => x !== refused[0]) : next;
}

/** Every entry for which `pick` holds, after `e`. */
export const stepAll = (box: Outbox, pick: (e: Entry) => boolean, e: EntryEvent): Outbox =>
  box.filter(pick).reduce((b, x) => step(b, x.id, e), box);
/**
 * Nothing sent before will be answered, so every entry on its way is queued again: a new page, or the link left the
 * stretch the send was made in (its request is dropped, and an answer to it is never heard). Every entry on its way is
 * of the stretch the link is in, so this is each of them.
 */
export const reloaded = (box: Outbox): Outbox => stepAll(box, e => e.at === 'sending', { type: 'reload' });
/** The room no longer exists: nothing will take what waits for it or what is on its way to it, so both are refused. */
export const roomGone = (box: Outbox, room: RoomCode): Outbox =>
  stepAll(box, e => e.room === room && (e.at === 'queued' || e.at === 'sending'), { type: 'refused', why: API_ERRORS.noSuchRoom.text });
/** Hunter `hid` is bound again on this phone: its tombstones are dropped (a bound hunter's card is never tombstoned). */
export const rebound = (box: Outbox, hid: string): Outbox => stepAll(box, e => e.letter.kind === 'tomb' && e.letter.hid === hid, { type: 'drop' });

/** The entry to send next in `room`: the oldest queued one, when none of that room is on its way. In order, one at a time. */
export function next(box: Outbox, room: RoomCode): Entry | null {
  if (box.some(e => e.room === room && e.at === 'sending')) return null;
  return box.find(e => e.room === room && e.at === 'queued') ?? null;
}
/**
 * Messages for `room` wait with none on its way: the last send got no answer, and they go at the next good poll. While
 * the box sends, one is always on its way, so this is never true for a moment between two sends.
 */
export const stalled = (box: Outbox, room: RoomCode | null): boolean =>
  !!room && box.some(e => e.room === room && e.at === 'queued') && !box.some(e => e.room === room && e.at === 'sending');
/** The messages for `room` the room does not have yet. */
export const waiting = (box: Outbox, room: RoomCode | null): number => (room ? box.filter(e => e.room === room && e.at !== 'refused').length : 0);

/** A step on the save's box (src/core/save-step.ts). */
export const atOutbox = (f: (box: Outbox) => Outbox) =>
  atSync(sy => ({ ...sy, outbox: f(sy.outbox ?? []) }));

// ── how the room answered a request ──
/**
 * One request's answer, as a sender and a view read it. `offline`: no answer (no network, a timeout, the service
 * worker's offline answer). `refused`: a 4xx, with the server's reason. `server`: a 5xx, or another build's server.
 */
export type Call<T = unknown> =
  | { readonly ok: true; readonly data: T }
  | { readonly ok: false; readonly why: 'offline' }
  | { readonly ok: false; readonly why: 'refused'; readonly reason: string }
  | { readonly ok: false; readonly why: 'server' };
/** The answer of status `status` with the server's `error` text. 426 is another build: the app reloads, so it is the server's. */
export function callOf(status: number, error: string, data: unknown): Call {
  if (status >= 200 && status < 300) return { ok: true, data };
  if (status >= 400 && status < 500 && status !== 426) return { ok: false, why: 'refused', reason: error.slice(0, 60) };
  return { ok: false, why: 'server' };
}
/** What an entry's send answered, as its event. */
export function sentEvent(c: Call): EntryEvent {
  if (!('why' in c)) return { type: 'sent' };
  return 'reason' in c ? { type: 'refused', why: c.reason || 'refused' } : { type: 'failed' };
}

// ── reading the save's box ──
const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
function letterOf(v: unknown): Letter | null {
  if (!isObj(v)) return null;
  if (v.kind === 'tomb') { const hid = parseSaveId<'h'>(v.hid); return hid ? { kind: 'tomb', hid } : null; }
  if (v.kind !== 'event' || !isObj(v.event)) return null;
  const event = parseEvent(v.event.type, v.event.payload);
  return event ? { kind: 'event', event } : null;
}
/** The box a save holds: each entry read again (an event through the room's own parser), one per id, at most `OUTBOX_MAX`. */
export function parseOutbox(v: unknown): Outbox {
  if (!Array.isArray(v)) return [];
  const out: Entry[] = [];
  for (const x of v) {
    if (!isObj(x)) continue;
    const room = parseRoomCode(x.room), letter = letterOf(x.letter);
    if (!room || !letter || out.some(e => e.id === idOf(letter))) continue;
    const base: Base = { id: idOf(letter), room, letter, key: typeof x.key === 'string' ? x.key.slice(0, 80) : null };
    out.push(x.at === 'refused' ? { ...base, at: 'refused', why: typeof x.why === 'string' ? x.why.slice(0, 60) : '' } : { ...base, at: x.at === 'sending' ? 'sending' : 'queued' });
  }
  return out.slice(-OUTBOX_MAX);
}
