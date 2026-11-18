// push.ts: a player's sheet push to the room, as one machine. Pure. `reduce(push, event)` answers the next push and the
// effects the edge carries out. The push runs only while the link is live as a player: the link says so with
// `linkLive` and `linkLost` (its `push` effects), and its sends carry the link's gen, so a reply from a room this phone
// has left changes nothing. The push never writes the link: a 403 removed or a 426 is the link's to hear.
import type { FailKind, Gen, LinkNews } from './link.ts';
import type { Hunter } from '../save.ts';
import { pushedChronicle } from '../hunter/chronicle.ts';

/**
 * The hunter as the push sends it: its chronicle cut to what the GM's phone reads (chronicle.ts `pushedChronicle`: the
 * lifetime numbers and the last few kept facts), so a long chronicle never takes the room from the rest of a sheet.
 */
export const pushedSheet = (h: Hunter): Hunter => ({ ...h, chronicle: pushedChronicle(h.chronicle) });

// ── numbers ──
/** From a change to its send. Edits inside these 3 s go in the same send, so typing a name is one PUT, not one per key. Today's number. */
export const PUSH_MS = 3000;
/** After a join, a "Play as" or Try now: at once, once the burst of store writes the join itself makes has settled. Today's number. */
export const PUSH_SOON_MS = 200;
/** After a good poll cut a network backoff short: the poll's own events for this sheet land in the store first. Today's number. */
export const PUSH_RESUME_MS = 400;
/** Locked: the GM's release is a tap at the table, so checking twice a minute bounds a released player's wait without asking a server that says no. Today's number. */
export const LOCKED_RETRY_MS = 30000;
/**
 * The wait after 1, 2, 3 ... failed sends in a row. It starts at 3 s, one PUSH_MS, because a blip clears in one round
 * trip. It doubles so a server in trouble is not asked every 3 s. It stops at 60 s because the table should see a
 * player's change within a minute of their phone coming back (the "change arrived 50 s late" report, bug 2).
 */
export const BACKOFF_MS = [3000, 6000, 12000, 24000, 48000, 60000] as const;
export const backoffMs = (fails: number): number => BACKOFF_MS[Math.min(Math.max(fails, 1), BACKOFF_MS.length) - 1] ?? PUSH_MS;
/** A sheet send carries the body up, and a phone's uplink is its slow side, so it gets more time than a poll (20 s). Judgment. */
export const SHEET_TIMEOUT_MS = 30000;

// ── the push ──
/** Why the server refused a sheet for good: 413 too large, 413 room full, or 400. The next change tries again. */
export type RefusedWhy = 'too-large' | 'room-full' | 'bad';
export type PushOff = { at: 'off' };
/** The server has the sheet as it is. */
export type Clean = { at: 'clean'; gen: Gen };
/** Changed; the send timer is set. */
export type Waiting = { at: 'waiting'; gen: Gen };
/** One send is out. `changedSince`: a change came in after it left. `fails`: sends that failed in a row before it. `locked`: it is the retry of a locked sheet. */
export type Sending = { at: 'sending'; gen: Gen; changedSince: boolean; fails: number; locked: boolean };
/** The last `fails` sends failed; the retry timer is set. Only a `net` failure is cut short by a good poll. */
export type Backoff = { at: 'backoff'; gen: Gen; fails: number; kind: FailKind };
export type Rejected = { at: 'rejected'; gen: Gen; why: RefusedWhy };
/** Another phone owns this sheet in the room. The retry timer is set. */
export type Locked = { at: 'locked'; gen: Gen };
export type Push = PushOff | Clean | Waiting | Sending | Backoff | Rejected | Locked;
export type PushAt = Push['at'];

// ── events ──
export type PushEvent =
  | LinkNews
  /** The bound sheet's text changed (the edge compares it with the text it last reported). */
  | { type: 'changed' }
  /** "Play as": another hunter is now the one this phone sends. */
  | { type: 'rebound' }
  | { type: 'timerFired'; name: PushTimer }
  | { type: 'sent'; gen: Gen }
  | { type: 'failed'; gen: Gen; kind: FailKind }
  | { type: 'refused'; gen: Gen; why: RefusedWhy }
  /** 403 `not your sheet`. */
  | { type: 'notYours'; gen: Gen };
export type PushEventType = PushEvent['type'];

// ── effects ──
export type PushTimer = 'push';
export type PushEffect =
  /** PUT the bound sheet as it is now. */
  | { type: 'request'; gen: Gen; timeoutMs: number; call: { req: 'sheet' } }
  | { type: 'setTimer'; name: PushTimer; ms: number }
  | { type: 'clearTimer'; name: PushTimer }
  | { type: 'notify'; id: 'locked' }
  | { type: 'status' };
export type PushResult = { state: Push; effects: PushEffect[] };

export const PUSH_OFF: Push = { at: 'off' };

// ── the reducer ──
type Step = PushResult;
const same = (push: Push): Step => ({ state: push, effects: [] });
const timer = (ms: number): PushEffect => ({ type: 'setTimer', name: 'push', ms });
/** Stop the push's timer, when its state has one. */
const clear = (push: Push): PushEffect[] => (push.at === 'waiting' || push.at === 'backoff' || push.at === 'locked' ? [{ type: 'clearTimer', name: 'push' }] : []);
const wait = (push: Push, gen: Gen, ms: number): Step => ({ state: { at: 'waiting', gen }, effects: [...clear(push), timer(ms)] });

/** One event. A stale reply, or an event the state has no use for, answers the same push and no effects. */
export function reduce(push: Push, event: PushEvent): PushResult {
  const out = step(push, event);
  if (out.state === push) return out;
  return { state: out.state, effects: [...out.effects, { type: 'status' }] };
}

function step(push: Push, event: PushEvent): Step {
  if (event.type === 'linkLive') return push.at !== 'off' && push.gen === event.gen ? same(push) : wait(push, event.gen, PUSH_SOON_MS);
  if (push.at === 'off') return same(push);
  if (event.type === 'linkLost') return { state: PUSH_OFF, effects: clear(push) };
  if ('gen' in event && event.gen !== push.gen) return same(push);
  const gen = push.gen;
  switch (event.type) {
    case 'changed':
      if (push.at === 'clean' || push.at === 'rejected') return wait(push, gen, PUSH_MS);
      if (push.at === 'sending' && !push.changedSince) return { state: { ...push, changedSince: true }, effects: [] };
      return same(push);
    case 'rebound':
      if (push.at === 'sending') return push.changedSince ? same(push) : { state: { ...push, changedSince: true }, effects: [] };
      return wait(push, gen, PUSH_SOON_MS);
    case 'timerFired': {
      const fails = push.at === 'backoff' ? push.fails : 0;
      if (push.at !== 'waiting' && push.at !== 'backoff' && push.at !== 'locked') return same(push);
      return {
        state: { at: 'sending', gen, changedSince: false, fails, locked: push.at === 'locked' },
        effects: [{ type: 'request', gen, timeoutMs: SHEET_TIMEOUT_MS, call: { req: 'sheet' } }],
      };
    }
    case 'sent':
      if (push.at !== 'sending') return same(push);
      return push.changedSince ? wait(push, gen, PUSH_MS) : { state: { at: 'clean', gen }, effects: [] };
    case 'failed': {
      if (push.at !== 'sending') return same(push);
      const fails = push.fails + 1;
      return { state: { at: 'backoff', gen, fails, kind: event.kind }, effects: [timer(backoffMs(fails))] };
    }
    case 'refused':
      if (push.at !== 'sending') return same(push);
      return push.changedSince ? wait(push, gen, PUSH_MS) : { state: { at: 'rejected', gen, why: event.why }, effects: [] };
    case 'notYours':
      if (push.at !== 'sending') return same(push);
      return { state: { at: 'locked', gen }, effects: [timer(LOCKED_RETRY_MS), ...(push.locked ? [] : [{ type: 'notify', id: 'locked' } as const])] };
    case 'pollOk':
      return push.at === 'backoff' && push.kind === 'net' ? wait(push, gen, PUSH_RESUME_MS) : same(push);
    case 'retry':
      return push.at === 'backoff' ? wait(push, gen, PUSH_SOON_MS) : same(push);
  }
}
