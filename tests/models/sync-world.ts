// The world of the link and push model: both machines, what the edge holds for them, and the finite alphabet of events
// (taps, timers, each kind of reply to each request that is out). Shared by the model check (tests/sync-model.test.ts)
// and the state charts (scripts/charts/link.ts), so both walk the same thing.
// The edge is modelled as the brief describes it: a request is out until its reply or an `abort` of its gen, a timer is
// set until it fires or is cleared, and the link's `push` effects go to the push.
import { boot, reduce as linkReduce } from '../../src/core/sync/link.ts';
import type { BootInput, Gen, GmKey, Link, LinkEffect, LinkEvent } from '../../src/core/sync/link.ts';
import { PUSH_OFF, reduce as pushReduce } from '../../src/core/sync/push.ts';
import type { Push, PushEffect, PushEvent } from '../../src/core/sync/push.ts';
import type { RoomCode } from '../../src/core/protocol.ts';

export const A = 'ABC234' as RoomCode, B = 'XYZ789' as RoomCode;
export const KEY = 'key-a' as GmKey;

// ── the world: both machines and what the edge holds for them ──
export type Req = { gen: number; req: string };
export type World = { link: Link; push: Push; timers: { poll?: number; push?: number }; out: Req[] };
export type Ev = { to: 'link'; e: LinkEvent } | { to: 'push'; e: PushEvent };

function carryPush(w: World, fx: PushEffect[]): void {
  for (const x of fx) {
    if (x.type === 'request') w.out.push({ gen: x.gen, req: x.call.req });
    else if (x.type === 'setTimer') w.timers[x.name] = x.ms;
    else if (x.type === 'clearTimer') delete w.timers[x.name];
  }
}
function carryLink(w: World, fx: LinkEffect[]): void {
  for (const x of fx) {
    if (x.type === 'request') w.out.push({ gen: x.gen, req: x.call.req });
    else if (x.type === 'abort') w.out = w.out.filter(r => r.gen !== x.gen);
    else if (x.type === 'setTimer') w.timers[x.name] = x.ms;
    else if (x.type === 'clearTimer') delete w.timers[x.name];
    else if (x.type === 'push') { const r = pushReduce(freeze(w.push), freeze(x.event)); w.push = r.state; carryPush(w, r.effects); }
  }
}
export const copy = (w: World): World => ({ link: w.link, push: w.push, timers: { ...w.timers }, out: [...w.out] });
export function deliver(w0: World, ev: Ev): World {
  const w = copy(w0);
  if (ev.to === 'link') { const r = linkReduce(freeze(w.link), freeze(ev.e)); w.link = r.state; carryLink(w, r.effects); }
  else { const r = pushReduce(freeze(w.push), freeze(ev.e)); w.push = r.state; carryPush(w, r.effects); }
  return w;
}
export function start(input: BootInput): World {
  const w: World = { link: boot(input).state, push: PUSH_OFF, timers: {}, out: [] };
  carryLink(w, boot(input).effects);
  return w;
}
export function freeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.freeze(value); for (const v of Object.values(value)) freeze(v); }
  return value;
}

// ── the alphabet ──
export const L = (e: LinkEvent): Ev => ({ to: 'link', e });
export const P = (e: PushEvent): Ev => ({ to: 'push', e });
export const g = (n: number): Gen => n as Gen;
export const TAPS: Ev[] = [
  L({ type: 'create' }), L({ type: 'join', code: A, key: null }), L({ type: 'join', code: A, key: KEY }), L({ type: 'join', code: B, key: null }),
  L({ type: 'leave' }), L({ type: 'forget' }), L({ type: 'retry' }), L({ type: 'online' }), L({ type: 'offline' }), L({ type: 'visible' }),
  L({ type: 'upgrade', stuck: false }), L({ type: 'upgrade', stuck: true }), P({ type: 'changed' }), P({ type: 'rebound' }),
  // a player's own fight move reached the room, sent from the fight doc 'f1'
  L({ type: 'sent', from: 'f1' }),
  // the GM's phone put a fight doc: a player's turn came, or the fight ended
  L({ type: 'paced', pace: 'turn' }), L({ type: 'paced', pace: 'table' }),
  // the save replaced by an import, a restore or a reset: a file in room B as player, in room A as GM, or in no room
  L({ type: 'replaced', room: { code: B, key: null, cursor: 0 }, last: null }), L({ type: 'replaced', room: { code: A, key: KEY, cursor: 0 }, last: null }),
  L({ type: 'replaced', room: null, last: { code: A, why: 'left' } }),
];
/**
 * Every kind of answer the edge can give to each request. A poll page whose `_kicked` doc names our sheet is first a
 * poll answer and then `removed` (found by the model check: `removed` alone left a GM's link waiting on a poll it had
 * dropped). A send answered 403 removed is `removed` for the link only.
 */
export const REPLIES: Record<string, (gen: Gen) => Ev[]> = {
  health: gen => [L({ type: 'healthOk', gen }), L({ type: 'failed', gen, kind: 'net' }), L({ type: 'failed', gen, kind: 'server' })],
  poll: gen => [
    L({ type: 'polled', gen, cursor: 9, more: false, pace: 'table', fightAt: null }), L({ type: 'polled', gen, cursor: 9, more: true, pace: 'table', fightAt: null }),
    // a fight's pace acts as a player's turn's but for its wait, so the model uses two of the three paces
    L({ type: 'polled', gen, cursor: 9, more: false, pace: 'turn', fightAt: 'f1' }), L({ type: 'polled', gen, cursor: 9, more: false, pace: 'table', fightAt: 'f2' }),
    L({ type: 'failed', gen, kind: 'net' }), L({ type: 'failed', gen, kind: 'timeout' }),
    L({ type: 'gone', gen }),
  ],
  create: gen => [L({ type: 'created', gen, code: B, key: KEY }), L({ type: 'failed', gen, kind: 'net' }), L({ type: 'failed', gen, kind: 'server' })],
  peek: gen => [L({ type: 'peeked', gen, exists: true }), L({ type: 'peeked', gen, exists: false }), L({ type: 'failed', gen, kind: 'net' })],
  head: gen => [
    L({ type: 'headed', gen, cursor: 5, gm: true, kicked: false }), L({ type: 'headed', gen, cursor: 5, gm: false, kicked: false }),
    L({ type: 'headed', gen, cursor: 5, gm: false, kicked: true }), L({ type: 'failed', gen, kind: 'timeout' }), L({ type: 'gone', gen }),
  ],
  sheet: gen => [
    P({ type: 'sent', gen }), P({ type: 'failed', gen, kind: 'net' }), P({ type: 'failed', gen, kind: 'server' }), P({ type: 'failed', gen, kind: 'timeout' }),
    P({ type: 'refused', gen, why: 'too-large' }), P({ type: 'notYours', gen }), L({ type: 'removed', gen }),
  ],
  /** Only ever raised after a poll answer (see `answers`); listed here so the stale probe sends it too. */
  keyLost: gen => [L({ type: 'keyLost', gen })],
};
/** Every reply of every kind, for probing with a stale gen. */
export const ALL_REPLIES = (gen: Gen): Ev[] => Object.values(REPLIES).flatMap(f => f(gen));
/** What may answer a request: each single reply, and for a poll also a page that says we were removed or the GM key is not taken. */
const answers = (req: string, gen: Gen): Ev[][] => [
  ...REPLIES[req]!(gen).map(e => [e]),
  ...(req === 'poll' ? [
    [L({ type: 'polled', gen, cursor: 9, more: false, pace: 'table', fightAt: null }), L({ type: 'removed', gen })],
    [L({ type: 'polled', gen, cursor: 9, more: false, pace: 'table', fightAt: null }), L({ type: 'keyLost', gen })],
  ] : []),
];

/** One step the world can take: the events it delivers, in order, and the world after them. */
export type Move = { label: string; events: Ev[]; next: () => World };
export function moves(w: World): Move[] {
  const out: Move[] = TAPS.map(ev => ({ label: JSON.stringify(ev.e), events: [ev], next: () => deliver(w, ev) }));
  for (const name of ['poll', 'push'] as const) {
    if (w.timers[name] === undefined) continue;
    const e: Ev = name === 'poll' ? L({ type: 'timerFired', name }) : P({ type: 'timerFired', name });
    out.push({ label: `the ${name} timer fires`, events: [e], next: () => { const c = copy(w); delete c.timers[name]; return deliver(c, e); } });
  }
  w.out.forEach((r, i) => {
    for (const evs of answers(r.req, g(r.gen))) {
      out.push({
        label: `${r.req} answers ${evs.map(ev => JSON.stringify(ev.e)).join(' then ')}`,
        events: evs,
        next: () => { const c = copy(w); c.out.splice(i, 1); return evs.reduce(deliver, c); },
      });
    }
  });
  return out;
}

/** States that act the same share a key: gens relative to the link's, and counts past the point where the wait stops growing. */
export function key(w: World): string {
  const cur = w.link.gen;
  return JSON.stringify(w, (k, v: unknown) => {
    if (k === 'gen' && typeof v === 'number') return v - cur;
    if ((k === 'failed' || k === 'unreachable') && typeof v === 'number') return Math.min(v, 4);
    if (k === 'fails' && typeof v === 'number') return Math.min(v, 6);
    return v;
  });
}
/** The ways a page can boot: no room server; a server and no room; in room A as a player; in room A as its GM. */
export const BOOTS: BootInput[] = [
  { server: false, room: null, last: null },
  { server: true, room: null, last: null },
  { server: true, room: { code: A, key: null, cursor: 0 }, last: null },
  { server: true, room: { code: A, key: KEY, cursor: 0 }, last: { code: B, why: 'left' } },
];
