// publish.ts: one room doc the GM's phone keeps in the room (the fight, the world, the rules, the codex, the solo gates,
// the feats), as a machine. Pure. `publishStep(p, event)` answers the next state and the effects src/edge/sync.ts carries
// out; sync.ts keeps one state per doc.
//
// The machine remembers nothing of what was sent: when a put is due the edge builds the doc and puts it only when it
// differs from the room's, so a failed put is tried again at the next change or poll. What the machine holds is that at
// most one put of a doc is out at a time. A change while one is out waits for its answer, then the doc is built again
// and put. Before, a change while a put was out set a second put going beside it, and the older answer could land
// last: the room and this phone held the older doc until the next change (audit SM-sync-3, BUG-sync-8).
//
// A timer and a put belong to the stretch of the link they were set going in (link.ts `Gen`). Leaving it (`left`) drops
// them and the too-big mark, and an answer of an old stretch moves nothing. Before, a put to a room the GM had left
// held the doc back in the next room for up to 20 s, and its 413 put the shorter doc into the next room. A too-big
// mark also stayed on the pill after the fight closed until the room was left; nothing to put now clears it
// (`tooBigAfter`; audit SMX-sync-3).
import type { Gen } from './link.ts';

// ── numbers ──
/** A GM's room docs follow a burst of changes this long after it ends. */
export const PUBLISH_MS = 800;
/** The fight doc follows sooner: a player's phone waits on it to see its own move (link.ts `CHASE_MS`), and a fight's changes come one tap at a time. */
export const PUBLISH_FIGHT_MS = 200;
/** The wait from a change of doc `name` to its put. */
export const publishWait = (name: string): number => (name === 'fight' ? PUBLISH_FIGHT_MS : PUBLISH_MS);

// ── the machine ──
/**
 * `idle`: nothing is due. `waiting`: a change came; the timer is set. `sending`: one put is out. `sendingStale`: one put
 * is out, and a change came after it was built, so the doc is put again once it is answered.
 */
export const PUBLISH_STATES = ['idle', 'waiting', 'sending', 'sendingStale'] as const;
export type PublishAt = (typeof PUBLISH_STATES)[number];
/**
 * One doc's state. `gen`: the stretch of the link the timer or the put belongs to; the room of that stretch is the only
 * one it is put in, and leaving the stretch (`left`) drops it. `tooBig`: the room refused this doc as too big, even
 * without its log, and has not taken or matched one since in this stretch. The pill reads it.
 */
export type Publish =
  | { readonly at: 'idle'; readonly tooBig: boolean }
  | { readonly at: Exclude<PublishAt, 'idle'>; readonly gen: Gen; readonly tooBig: boolean };
export const PUBLISH_IDLE: Publish = { at: 'idle', tooBig: false };

/**
 * How a put ended. `stored`: the room took it. `tooBig`: the room refused it as too big, also without its log. `failed`:
 * no answer, or another refusal. `unsent`: nothing was put, since the room holds this doc already, there is nothing to
 * put, or this phone has not read the room's docs in this stretch yet (no put of it was refused in the stretch then).
 */
export const PUTS = ['stored', 'tooBig', 'failed', 'unsent'] as const;
export type PutAnswer = (typeof PUTS)[number];
export const PUBLISH_EVENTS = ['changed', 'due', 'answered', 'left'] as const;
export type PublishEventType = (typeof PUBLISH_EVENTS)[number];
/**
 * `changed`: the save, a poll or the link changed in stretch `gen`, so the doc may differ from the room's. `due`: the
 * timer set in `gen` fired. `answered`: the put made in `gen` is over. `left`: the link left its stretch (the GM left the
 * room, switched to another, or the link went out and back), and dropped the stretch's requests (link.ts `abort`). A
 * `due` or an `answered` of a stretch other than the doc's is an old stretch's, and moves nothing.
 */
export type PublishEvent =
  | { readonly type: 'changed'; readonly gen: Gen } | { readonly type: 'due'; readonly gen: Gen }
  | { readonly type: 'answered'; readonly gen: Gen; readonly put: PutAnswer } | { readonly type: 'left' };
/** `setTimer`: wait `publishWait(name)`, then `due` in `gen`. `put`: build the doc and put it in the room of `gen` if it differs from the room's, then `answered`. `status`: the pill may say another thing. */
export type PublishEffect = { readonly type: 'setTimer'; readonly gen: Gen } | { readonly type: 'put'; readonly gen: Gen } | { readonly type: 'status' };
export type PublishResult = { readonly state: Publish; readonly effects: readonly PublishEffect[] };

/** The state each event leads to, or null where it does not apply. */
export const TABLE: { readonly [S in PublishAt]: { readonly [E in PublishEventType]: PublishAt | null } } = {
  idle: { changed: 'waiting', due: null, answered: null, left: 'idle' },
  waiting: { changed: null, due: 'sending', answered: null, left: 'idle' },
  sending: { changed: 'sendingStale', due: null, answered: 'idle', left: 'idle' },
  sendingStale: { changed: null, due: null, answered: 'waiting', left: 'idle' },
};
/** What entering a state in stretch `gen` asks of the edge. */
const ON_ENTRY: { readonly [S in PublishAt]: (gen: Gen) => readonly PublishEffect[] } = {
  idle: () => [], waiting: gen => [{ type: 'setTimer', gen }], sending: gen => [{ type: 'put', gen }], sendingStale: () => [],
};
/**
 * Whether the doc is too big for the room after `event`. A refusal marks it; a put taken, or nothing to put (the doc is
 * gone, as a closed fight's, or the room holds it as it is), clears it; a put with no answer leaves it. Leaving the
 * stretch clears it: the next room has not refused anything.
 */
function tooBigAfter(was: boolean, event: PublishEvent): boolean {
  if (event.type === 'left') return false;
  if (event.type !== 'answered') return was;
  switch (event.put) {
    case 'tooBig': return true;
    case 'stored': case 'unsent': return false;
    case 'failed': return was;
  }
}

/** One event. An event the state has no cell for, or one of an old stretch, answers the same state and no effects. */
export function publishStep(p: Publish, event: PublishEvent): PublishResult {
  const to = TABLE[p.at][event.type];
  if (to === null || (p.at !== 'idle' && event.type !== 'left' && event.gen !== p.gen)) return { state: p, effects: [] };
  const tooBig = tooBigAfter(p.tooBig, event);
  const status: readonly PublishEffect[] = tooBig !== p.tooBig ? [{ type: 'status' }] : [];
  if (to === 'idle' || event.type === 'left') return { state: { at: 'idle', tooBig }, effects: status };
  return { state: { at: to, gen: event.gen, tooBig }, effects: [...ON_ENTRY[to](event.gen), ...status] };
}
