// publish.ts: one room doc the GM's phone keeps in the room (the fight, the world, the rules, the codex, the solo gates,
// the feats), as a machine. Pure. `publishStep(p, event)` answers the next state and the effects src/edge/sync.ts carries
// out; sync.ts keeps one state per doc.
//
// The machine remembers nothing of what was sent: when a put is due the edge builds the doc and puts it only when it
// differs from the room's, so a failed put is tried again at the next change or poll. What the machine holds is that at
// most one put of a doc is out at a time. A change while one is out waits for its answer, then the doc is built again
// and put. Before, a change while a put was out set a second put going beside it, and the older answer could land
// last: the room and this phone held the older doc until the next change (audit SM-sync-3, BUG-sync-8).
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
/** `tooBig`: the stretch of the link in which the room last refused this doc as too big, even without its log; null once it took one. The pill reads it. */
export type Publish = { readonly at: PublishAt; readonly tooBig: Gen | null };
export const PUBLISH_IDLE: Publish = { at: 'idle', tooBig: null };

/**
 * How a put ended. `stored`: the room took it. `tooBig`: the room refused it as too big, also without its log. `failed`:
 * no answer, or another refusal. `unsent`: nothing was put, since the room holds this doc already, there is nothing to
 * put, or this phone is not the room's GM in this stretch of the link.
 */
export const PUTS = ['stored', 'tooBig', 'failed', 'unsent'] as const;
export type PutAnswer = (typeof PUTS)[number];
export const PUBLISH_EVENTS = ['changed', 'due', 'answered'] as const;
export type PublishEventType = (typeof PUBLISH_EVENTS)[number];
/** `changed`: the save, a poll or the link changed, so the doc may differ from the room's. `due`: the timer fired. `answered`: the put is over, in the stretch `gen` it was made in. */
export type PublishEvent = { readonly type: 'changed' } | { readonly type: 'due' } | { readonly type: 'answered'; readonly gen: Gen; readonly put: PutAnswer };
/** `setTimer`: wait `publishWait(name)`, then `due`. `put`: build the doc and put it if it differs from the room's, then `answered`. `status`: the pill may say another thing. */
export type PublishEffect = { readonly type: 'setTimer' } | { readonly type: 'put' } | { readonly type: 'status' };
export type PublishResult = { readonly state: Publish; readonly effects: readonly PublishEffect[] };

/** The state each event leads to, or null where it does not apply. */
export const TABLE: { readonly [S in PublishAt]: { readonly [E in PublishEventType]: PublishAt | null } } = {
  idle: { changed: 'waiting', due: null, answered: null },
  waiting: { changed: null, due: 'sending', answered: null },
  sending: { changed: 'sendingStale', due: null, answered: 'idle' },
  sendingStale: { changed: null, due: null, answered: 'waiting' },
};
/** What entering a state asks of the edge. */
const ON_ENTRY: { readonly [S in PublishAt]: readonly PublishEffect[] } = {
  idle: [], waiting: [{ type: 'setTimer' }], sending: [{ type: 'put' }], sendingStale: [],
};
/** The room's last word on the doc's size after `put` in stretch `gen`: a refusal marks the stretch, a put taken clears it, the rest leave it. */
function tooBigAfter(was: Gen | null, gen: Gen, put: PutAnswer): Gen | null {
  switch (put) {
    case 'tooBig': return gen;
    case 'stored': return null;
    case 'failed': case 'unsent': return was;
  }
}

/** One event. An event the state has no cell for answers the same state and no effects. */
export function publishStep(p: Publish, event: PublishEvent): PublishResult {
  const to = TABLE[p.at][event.type];
  if (to === null) return { state: p, effects: [] };
  const tooBig = event.type === 'answered' ? tooBigAfter(p.tooBig, event.gen, event.put) : p.tooBig;
  return { state: { at: to, tooBig }, effects: [...ON_ENTRY[to], ...(tooBig !== p.tooBig ? [{ type: 'status' } as const] : [])] };
}
