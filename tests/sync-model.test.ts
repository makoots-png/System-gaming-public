// A breadth-first model check of the link and push machines together (src/core/sync/link.ts, push.ts). From each way
// a page can boot it plays every event of a finite alphabet (taps, timers, each kind of reply to each request that is
// out, online and offline, another build) and checks the rules below at every pair of states it reaches. The world and
// the alphabet are in tests/models/sync-world.ts, which the state charts (scripts/charts/link.ts) walk too.
// A failure prints the shortest event sequence that breaks a rule. Sequences it found are kept as named tests at the end.
import { describe, expect, test } from 'bun:test';
import { reduce as linkReduce } from '../src/core/sync/link.ts';
import type { BootInput, Link } from '../src/core/sync/link.ts';
import { reduce as pushReduce } from '../src/core/sync/push.ts';
import { A, ALL_REPLIES, BOOTS, KEY, L, deliver, g, key, moves, start } from './models/sync-world.ts';
import type { Ev, World } from './models/sync-world.ts';
import { deadEnd } from './models/dead-ends.ts';

// ── the rules ──
function broken(before: World | null, label: string, w: World): string | null {
  const { link, push } = w, cur = link.gen;
  for (const ev of ALL_REPLIES(g(cur - 1))) {
    const r = ev.to === 'link' ? linkReduce(link, ev.e) : pushReduce(push, ev.e);
    const after = ev.to === 'link' ? link : push;
    if (r.state !== after || r.effects.length) return `a stale ${JSON.stringify(ev.e)} changed the ${ev.to}`;
  }
  if (w.out.some(r => r.gen !== cur)) return 'a request of an earlier gen is still out';
  // no dead ends, and the push runs exactly while the link is live as a player, on the link's gen
  const dead = deadEnd(link, push, w.timers, w.out);
  if (dead) return dead;
  if ((push.at === 'waiting' || push.at === 'backoff' || push.at === 'locked') && w.timers.push! > 60_000) return `push ${push.at} waits ${w.timers.push} ms`;
  if (before && before.link.at === 'upgrading' && link.at !== 'upgrading') return 'upgrading was left';
  if (before && label === '{"type":"leave"}' && before.link.at === 'live') {
    if (push.at !== 'off' || w.timers.push !== undefined) return 'the push still runs after Leave';
    if (w.out.length) return 'a request is out after Leave';
  }
  return null;
}

// ── the search ──
type Found = { states: number; transitions: number; depth: number; complete: boolean; failure: string | null };
function explore(maxDepth: number): Found {
  const seen = new Map<string, { parent: string | null; label: string }>();
  let frontier: { k: string; w: World }[] = [], transitions = 0, depth = 0;
  for (const b of BOOTS) {
    const w = start(b), k = key(w);
    if (seen.has(k)) continue;
    seen.set(k, { parent: null, label: `boot ${JSON.stringify(b)}` });
    const bad = broken(null, '', w);
    if (bad) return { states: seen.size, transitions, depth, complete: false, failure: `${bad}\n  boot ${JSON.stringify(b)}` };
    frontier.push({ k, w });
  }
  const path = (k: string): string[] => { const out: string[] = []; for (let c: string | null = k; c; c = seen.get(c)!.parent) out.unshift(seen.get(c)!.label); return out; };
  while (frontier.length && depth < maxDepth) {
    depth++;
    const next: typeof frontier = [];
    for (const { k, w } of frontier) {
      for (const m of moves(w)) {
        transitions++;
        const after = m.next(), k2 = key(after);
        const bad = broken(w, m.label, after);
        if (bad) return { states: seen.size, transitions, depth, complete: false, failure: `${bad}\n  ${[...path(k), m.label].join('\n  ')}` };
        if (seen.has(k2)) continue;
        seen.set(k2, { parent: k, label: m.label });
        next.push({ k: k2, w: after });
      }
    }
    frontier = next;
  }
  return { states: seen.size, transitions, depth, complete: frontier.length === 0, failure: null };
}

/** Plays fixed events from a boot with the same rules as the search. Answers the first broken rule, or the final world. */
function replay(b: BootInput, events: ((w: World) => Ev[])[]): { problem: string | null; w: World } {
  let w = start(b);
  for (const [i, make] of events.entries()) {
    const before = w;
    for (const ev of make(w)) w = deliver(w, ev);
    const bad = broken(before, '', w);
    if (bad) return { problem: `event ${i + 1}: ${bad}`, w };
  }
  return { problem: null, w };
}

describe('what the model check found', () => {
  // The first run modelled "the poll page says the GM removed us" as a `removed` alone. For a GM the link ignores
  // `removed`, so it went on waiting for a poll answer it had already had. The edge contract this pins: a poll answer is
  // always `polled`, `failed` or `gone`, and `removed` comes after it, never instead of it.
  test('a GM whose poll page names a removed sheet keeps polling the room', () => {
    const gm: BootInput = { server: true, room: { code: A, key: KEY, cursor: 0 }, last: null };
    const r = replay(gm, [w => [L({ type: 'polled', gen: g(w.link.gen), cursor: 9, more: false, pace: 'table', fightAt: null }), L({ type: 'removed', gen: g(w.link.gen) })]]);
    expect(r.problem).toBeNull();
    expect(r.w.link).toMatchObject({ at: 'live', code: A, next: 'timer' });
    expect(r.w.timers.poll).toBe(5000);
  });
});

describe('the link and the push under every event sequence', () => {
  // The depth bound is a guard, not a cut: from the four boots every reachable state is found by depth 30, and the test
  // fails if the search ever stops at the bound with states left, so a change that grows the space shows up here.
  test('every reachable pair of states keeps every rule', () => {
    const t0 = performance.now();
    const r = explore(60);
    console.log(`sync model: ${r.states} states, ${r.transitions} transitions, depth ${r.depth}, ${r.complete ? 'all reachable states explored' : 'stopped at the depth bound'}, ${Math.round(performance.now() - t0)} ms`);
    expect(r.failure).toBeNull();
    expect(r.complete).toBe(true);
    // about 69,000 states and 20 s since a player's chase (ten quick polls) and the room's pace are part of the link.
    // Inside the whole run with four workers (scripts/ci.ts), three runs on Nov 19: 19, 18 and 19 s; under concurrent
    // box load on Nov 26 it took 86 s and tripped 60 s. The budget is 180 s, over twice the loaded run.
  }, 180_000);
});
