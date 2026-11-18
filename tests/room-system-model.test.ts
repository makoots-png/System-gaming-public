// The room as a whole: a GM phone, one or two player phones and the real server handler (server.ts), each phone running
// the real link and push reducers and the real appliers and applied ids ring, composed by tests/models/room-world.ts.
// A world is its move sequence from the start (taps, a request reaching the server, its answer reaching the phone, a
// request or answer lost, a timer firing), so exploring re-runs sequences instead of cloning worlds. After every move
// the safety rules are checked; after a quiet phase (nothing lost, every timer fires) the convergence rules too.
// A failure prints the seed and the shortest sequence that still breaks the same rule.
import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { buildApp } from '../scripts/build.ts';
import { deadEnd } from './models/dead-ends.ts';
import { enabled, isGm, keyOf, newWorld, play, probe, quiet, roster } from './models/room-world.ts';
import type { Move, World } from './models/room-world.ts';
import { coinOf } from '../src/core/coin.ts';

const { build } = await buildApp();

// ── the bounds, and why ──
/**
 * Rounds of the quiet phase. The longest chain a rule waits on is: a kick's doc write lands, the player's next poll
 * reads it (round 1); or Allow back lands, the player taps Rejoin, the head and first poll answer, the first sheet push
 * goes (round 2), and the GM's next poll shows it (round 3). One more round shows that nothing moves after that.
 */
const QUIET_ROUNDS = 4;
/**
 * Moves per random walk. A kick, its doc write, a lost poll, a timer past the server's 20 s removal window and a
 * reload in between already take about 15 moves from a live room, and reaching a live room takes about 15 more.
 */
const WALK_MOVES = 40;
/** Random walks: each takes about 4 ms (one run measured), so this is about 8 s. The seeds are fixed, so a failure reruns. */
const WALKS = 2000;
/** The exhaustive walk: every sequence of this many moves from a room with the GM and one player live in it. */
const DEPTH = 3;

// The server reads Date.now for room expiry, the removal window and the time it sends; a world runs on its own clock.
// Each world starts 31 days after the last one ended, so every room an earlier world made has expired (the memory
// store keeps at most 2000 rooms, and its sweep on create clears expired ones).
const realNow = Date.now;
let epoch = realNow();
afterAll(() => { Date.now = realNow; });
function fresh(players: 1 | 2): World {
  const w = newWorld(build, players, epoch);
  Date.now = () => w.clock;
  return w;
}
const done = (w: World): void => { epoch = w.clock + 31 * 24 * 3600 * 1000; Date.now = realNow; };
/**
 * The test running now. A long walk that bun timed out goes on in the background; it stops at its next sequence
 * (`still`), so it never replaces Date.now under a later test or another file (whose rooms would read as expired).
 */
let current = 0;
beforeEach(() => { current++; });
const still = (mine: number): void => { if (current !== mine) throw new Error('this walk was timed out; it stops here'); };

// ── the rules ──
const EVENT_KINDS = new Set(['award', 'status', 'chain', 'vitals']);
/** Checked after every move. */
function safety(w: World): string | null {
  if (w.broken.length) return w.broken[0]!;
  for (const p of w.phones) {
    for (const [eid, n] of Object.entries(p.ledger)) if (n > 1) return `GM event ${eid} took effect ${n} times on ${p.name}`;
    for (const [eid, n] of Object.entries(p.told)) if (n > 1) return `the told use ${eid} is in ${p.name}'s session log ${n} times`;
    for (const [at, n] of Object.entries(p.acted)) if (n > 1) return `${p.name}'s fight took ${n} players' casts in the one turn at ${at}`;
    const out = w.pending.filter(r => r.phone === p.i && !r.dead && r.lane !== 'gm' && r.lane !== 'box').map(r => ({ req: r.what }));
    const dead = deadEnd(p.link, p.push, p.timers, out);
    if (dead) return `${p.name}: ${dead}`;
    if (p.i > 0 && (isGm(p) || (p.link.at === 'live' && p.link.key !== null))) return `player ${p.name} took the GM role`;
    const onItsWay = p.save.outbox.filter(e => e.at === 'sending').length, asked = w.pending.filter(r => r.phone === p.i && !r.dead && r.lane === 'box').length;
    if (onItsWay !== asked) return `${p.name} holds ${onItsWay} message(s) on their way with ${asked} request(s) out: a message waits for an answer nobody will hear`;
  }
  const coin = coinRule(w);
  if (coin) return coin;
  const solo = soloRule(w);
  if (solo) return solo;
  for (const [key, list] of Object.entries(w.writers)) {
    if (list.length > 1) return `phones ${list.map(i => w.phones[i]!.name).join(' and ')} both own sheet ${key} on the server`;
    if (!key.startsWith(`${w.phones[list[0]!]!.device}:`)) return `${w.phones[list[0]!]!.name} owns ${key}`;
  }
  return null;
}

/**
 * A player's coin lands only on the side the GM's phone chose for it, and keeps it: a replayed call or landing changes
 * nothing. The GM's session log records each ruling once.
 */
function coinRule(w: World): string | null {
  const gm = w.phones[0]!;
  for (const [roll, n] of Object.entries(gm.ruled)) if (n > 1) return `the GM's session log records the ruling of ${roll} ${n} times`;
  for (const p of w.phones.slice(1)) {
    for (const c of p.save.coins) {
      if (c.at !== 'landed') continue;
      const held = coinOf(gm.save.calls, c.id);
      if (held?.at !== 'landed' || held.side !== c.side) return `${p.name}'s coin ${c.id} landed ${c.side}, but the GM's phone holds it as ${held?.at === 'landed' ? held.side : held?.at ?? 'nothing'}`;
    }
  }
  return null;
}

/**
 * A solo run is paid at most once, and only a run whose gate the GM's phone cleared for it: across every player, the
 * GM's one solo gate pays one run at most (gates/solo.ts `soloTaken`, solo-wait.ts `runAnswered`).
 */
function soloRule(w: World): string | null {
  let paid = 0;
  for (const p of w.phones.slice(1)) for (const [run, n] of Object.entries(p.paid)) { if (n > 1) return `${p.name}'s solo run ${run} was paid ${n} times`; paid += n; }
  if (paid > 1) return `the GM's one solo gate paid ${paid} runs`;
  if (paid === 1 && w.phones[0]!.save.soloGate !== 'cleared') return 'a solo run was paid for a gate the GM\'s phone has not cleared';
  return null;
}

/** Checked after quiet. */
async function converged(w: World): Promise<string | null> {
  const gm = w.phones[0]!;
  const gmCode = gm.link.at === 'live' && gm.link.key !== null ? gm.link.code : null;
  for (const p of w.phones) {
    if (p.link.at !== 'live') continue;
    const room = await probe(w, p.link.code);
    if (!room) return `${p.name} is live in ${p.link.code}, which the server does not have`;
    if (p.link.cursor !== room.next || p.save.cursor !== room.next) return `${p.name} is at ${p.link.cursor} (saved ${p.save.cursor}) in a room whose events end at ${room.next}`;
    // The outbox: every message this phone posted for the room it is live in is in the room once, or the room refused it.
    const code = p.link.code;
    const left = p.save.outbox.filter(e => e.room === code && e.at !== 'refused');
    if (left.length) return `${p.name} is live in ${code} with ${left.length} message(s) still waiting in its outbox`;
    for (const m of p.save.posted.filter(x => x.room === code)) {
      const n = room.events.filter(ev => ev.payload.eid === m.eid).length;
      const refused = p.save.outbox.some(e => e.id === m.eid && e.at === 'refused');
      if (n !== (refused ? 0 : 1)) return `${p.name}'s message ${m.eid} is in room ${code} ${n} times${refused ? ', though the room refused it' : ''}`;
    }
    if (p.i === 0 || p.link.key !== null || !p.stretch || p.stretch.room !== p.link.code) continue;
    const key = keyOf(p);
    for (const ev of room.events) {
      if (!EVENT_KINDS.has(ev.type) || ev.seq <= p.stretch.from || !('to' in ev.payload) || !ev.payload.to?.includes(key)) continue;
      if (p.ledger[ev.payload.eid] !== 1) return `${ev.type} ${ev.payload.eid} (seq ${ev.seq}) took effect ${p.ledger[ev.payload.eid] ?? 0} times on ${p.name}, which is still in the room`;
    }
    for (const ev of room.events) {
      if (ev.type !== 'coinLand' || ev.seq <= p.stretch.from || !ev.payload.roll.startsWith(`${p.device}:`)) continue;
      const c = coinOf(p.save.coins, ev.payload.roll);
      if (c?.at !== 'landed') return `the landing of ${ev.payload.roll} (seq ${ev.seq}) is in the room, but ${p.name}'s coin is ${c?.at ?? 'gone'}`;
    }
  }
  if (gmCode && gm.stretch && gm.stretch.room === gmCode) {
    for (const ev of (await probe(w, gmCode))?.events ?? []) {
      if (ev.type !== 'used' || !ev.payload.tell || ev.seq <= gm.stretch.from) continue;
      if (gm.told[ev.payload.eid] !== 1) return `the told use ${ev.payload.eid} (seq ${ev.seq}) is in the GM's session log ${gm.told[ev.payload.eid] ?? 0} times`;
    }
    for (const ev of (await probe(w, gmCode))?.events ?? []) {
      if (ev.type !== 'coinCall' || ev.seq <= gm.stretch.from) continue;
      if (!coinOf(gm.save.calls, ev.payload.roll)) return `the call ${ev.payload.roll} (seq ${ev.seq}) is in the room, but the GM's phone does not hold it`;
    }
  }
  for (const p of w.phones.slice(1)) {
    const key = keyOf(p), told = w.told[key], mine = roster(gm)[key];
    const inRoom = p.link.at === 'live' && p.link.code === told?.room;
    if (told?.state === 'removed') {
      const back = inRoom && p.stretch && p.stretch.at - told.at > 600000;
      if (inRoom && !back) return `${p.name} is still in room ${told.room} after the GM was told it was removed`;
      if (gmCode === told.room && mine !== undefined && !back) return `the GM's roster still shows ${p.name} after removing it`;
    }
    if (told?.state === 'allowed' && gmCode === told.room) {
      if (!inRoom) return `${p.name} could not rejoin room ${told.room} after the GM allowed it back`;
      if (mine === undefined) return `the GM's roster does not show ${p.name} after it was allowed back and rejoined`;
    }
    if (gmCode && p.link.at === 'live' && p.link.code === gmCode && p.link.key === null && told?.state !== 'removed') {
      if (mine !== JSON.stringify({ id: 'h1', name: `${p.name} #${p.save.sheet}` })) return `the GM's roster shows ${p.name} as ${mine ?? 'nothing'}, but its sheet is #${p.save.sheet}`;
      // A landing the GM made while both phones were in this room reaches the player, even when its post was lost or the
      // GM's page reloaded: the outbox in the GM's save sends it again after the next good poll.
      for (const c of gm.save.calls) {
        const on = gm.ruledOn[c.id];
        if (c.at !== 'landed' || !c.id.startsWith(`${p.device}:`) || !on || !p.stretch || !gm.stretch) continue;
        if (p.stretch.room !== gmCode || gm.stretch.room !== gmCode || p.stretch.at > on.at || gm.stretch.at > on.at) continue;
        const mineNow = coinOf(p.save.coins, c.id);
        if (mineNow?.at !== 'landed' || mineNow.side !== c.side) return `the GM landed ${c.id} on ${c.side}, but ${p.name}'s coin is ${mineNow?.at ?? 'gone'}`;
      }
    }
  }
  return null;
}

// ── running a sequence ──
type Run = { failure: string | null; played: Move[] };
/** Plays `moves` (a move not enabled is skipped), then quiet. With `pick`, the next move is chosen from what is enabled. */
async function run(players: 1 | 2, moves: Move[], pick?: (options: Move[]) => Move): Promise<Run> {
  const w = fresh(players), played: Move[] = [];
  try {
    for (let i = 0; i < moves.length || (pick && i < WALK_MOVES); i++) {
      const m = pick ? pick(enabled(w)) : moves[i]!;
      if (!(await play(w, m))) continue;
      played.push(m);
      const bad = safety(w);
      if (bad) return { failure: bad, played };
    }
    await quiet(w, QUIET_ROUNDS);
    return { failure: safety(w) ?? (await converged(w)), played };
  } finally { done(w); }
}
/** The same rule, in words, without the ids and numbers that change from run to run. */
const ruleOf = (f: string): string => f.replace(/[A-Z0-9]{6}\b|d-[\w-]+|#?\d+/g, '_');
/** Remove moves while the same rule still breaks: first halves, then single moves. */
async function shrink(players: 1 | 2, moves: Move[], failure: string): Promise<Run> {
  let best: Run = { failure, played: moves };
  for (let size = Math.floor(moves.length / 2); size >= 1; size = Math.floor(size / 2)) {
    for (let i = 0; i + size <= best.played.length;) {
      const trial = [...best.played.slice(0, i), ...best.played.slice(i + size)];
      const r = await run(players, trial);
      if (r.failure && ruleOf(r.failure) === ruleOf(failure)) best = r; else i += size;
    }
  }
  return best;
}
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const report = (what: string, r: Run): string => `${what}\n  rule: ${r.failure}\n  moves (${r.played.length}):\n    ${r.played.join('\n    ')}`;

/** Into a room: the GM creates it and polls, the player joins, pushes its sheet, and the GM polls again. */
const LIVE: Move[] = [
  'gm create', 'gm serve link', 'gm answer link', 'gm serve link', 'gm answer link',
  'p1 join', 'p1 serve link', 'p1 answer link', 'p1 serve link', 'p1 answer link', 'p1 timer push', 'p1 serve push', 'p1 answer push',
  'p1 serve link', 'p1 answer link', 'gm timer poll', 'gm serve link', 'gm answer link',
];

describe('the runner', () => {
  test('a GM who creates a room sees the player who joins it, and an award reaches the player once', async () => {
    const r = await run(1, [...LIVE, 'gm award p1', 'gm serve box', 'gm answer box', 'p1 timer poll', 'p1 serve link', 'p1 answer link']);
    expect(r.failure).toBeNull();
    expect(r.played).toHaveLength(LIVE.length + 6);
  });
});

describe('what the room model found', () => {
  // A removal was two requests from the GM's phone: delete the sheet, then, once that answered, write the `_kicked` doc
  // the player's phone reads. Anything that ended the GM's stretch of the link in between left the sheet deleted on the
  // server and the player never told (docs/agent-handoff/p3/bugs-found.md).
  test('a player the GM removes is told, even when the GM opens a new room before the removal is answered', async () => {
    expect((await run(1, [...LIVE, 'gm kick p1', 'gm create'])).failure).toBeNull();
  });
  test('a player the GM removes is told, even when the GM reloads before the removal is answered', async () => {
    expect((await run(1, [...LIVE, 'gm kick p1', 'gm reload'])).failure).toBeNull();
  });
});

describe('a use the GM is told of', () => {
  test('reaches the GM\'s session log once, when the player\'s phone posts it twice and the GM reloads in between', async () => {
    const r = await run(1, [...LIVE, 'p1 use', 'p1 dup box', 'p1 serve box', 'p1 answer box', 'gm timer poll', 'gm serve link', 'gm answer link', 'gm reload', 'gm serve link', 'gm answer link']);
    expect(r.failure).toBeNull();
    expect(r.played).toContain('p1 dup box');
  });
});

describe('a player\'s cast on the GM\'s fight', () => {
  test('acts once when the player\'s phone posts it twice and the GM reloads in between: the copy is for a turn that is over', async () => {
    const r = await run(1, [...LIVE, 'p1 cast', 'p1 dup box', 'p1 serve box', 'p1 answer box', 'gm timer poll', 'gm serve link', 'gm answer link', 'gm reload', 'gm serve link', 'gm answer link']);
    expect(r.failure).toBeNull();
    expect(r.played).toContain('p1 dup box');
  });

  test('acts once when the player taps twice before the GM\'s phone hears the first', async () => {
    const r = await run(1, [...LIVE, 'p1 cast', 'p1 cast', 'p1 serve box', 'p1 answer box', 'p1 serve box', 'p1 answer box', 'gm timer poll', 'gm serve link', 'gm answer link']);
    expect(r.failure).toBeNull();
  });
});

describe('a message in the outbox', () => {
  const POLL: Move[] = ['p1 timer poll', 'p1 serve link', 'p1 answer link'];
  test('a use reported offline is kept, and reaches the GM\'s session log once when the phone is back', async () => {
    const r = await run(1, [...LIVE, 'p1 offline', 'p1 use', 'p1 drop box', 'p1 online', 'p1 serve link', 'p1 answer link', 'p1 serve box', 'p1 answer box', 'gm timer poll', 'gm serve link', 'gm answer link']);
    expect(r.failure).toBeNull();
    expect(r.played).toContain('p1 serve box');
  });
  test('a use whose answer was lost is sent again after the next good poll, and is one message in the room', async () => {
    const r = await run(1, [...LIVE, 'p1 use', 'p1 serve box', 'p1 drop box', ...POLL, 'p1 serve box', 'p1 answer box', 'gm timer poll', 'gm serve link', 'gm answer link']);
    expect(r.failure).toBeNull();
    expect(r.played.filter(m => m === 'p1 serve box')).toHaveLength(2);
  });
  test('a use posted just before a reload is sent by the next page', async () => {
    const r = await run(1, [...LIVE, 'p1 use', 'p1 reload', 'p1 serve link', 'p1 answer link', 'p1 serve box', 'p1 answer box']);
    expect(r.failure).toBeNull();
    expect(r.played).toContain('p1 answer box');
  });
});

describe('the end of a fight (pay.ts settleEncounter puts each player\'s award in the GM\'s outbox)', () => {
  test('a player offline when the fight ends gets its XP once, when the phone is back', async () => {
    const r = await run(1, [...LIVE, 'p1 offline', 'gm settle p1', 'gm serve box', 'gm answer box', 'p1 timer poll', 'p1 drop link', 'p1 online', 'p1 serve link', 'p1 answer link']);
    expect(r.failure).toBeNull();
    expect(r.played).toContain('gm answer box');
  });
  test('the GM\'s page reloads right after the end, before the award went: the next page sends it, once', async () => {
    const r = await run(1, [...LIVE, 'gm settle p1', 'gm reload', 'gm serve link', 'gm answer link', 'gm serve box', 'gm answer box', 'p1 timer poll', 'p1 serve link', 'p1 answer link']);
    expect(r.failure).toBeNull();
    expect(r.played).toContain('gm answer box');
  });
  test('the award never reaches the room (the GM\'s network drops it): the GM\'s next good poll sends it, and the player is given it once', async () => {
    const r = await run(1, [...LIVE, 'gm settle p1', 'gm drop box', 'gm timer poll', 'gm serve link', 'gm answer link', 'gm serve box', 'gm answer box']);
    expect(r.failure).toBeNull();
    expect(r.played).toEqual([...LIVE, 'gm settle p1', 'gm drop box', 'gm timer poll', 'gm serve link', 'gm answer link', 'gm serve box', 'gm answer box']);
  });
  test('the award\'s answer is lost and the GM\'s phone sends it again: the player is given it once', async () => {
    const r = await run(1, [...LIVE, 'gm settle p1', 'gm serve box', 'gm drop box', 'gm timer poll', 'gm serve link', 'gm answer link', 'gm serve box', 'gm answer box']);
    expect(r.failure).toBeNull();
    expect(r.played.filter(m => m === 'gm serve box')).toHaveLength(2);
  });
});

describe('the GM view\'s messages to a player (gm.js posts each to the outbox)', () => {
  test('a status whose answer is lost is sent again after the GM\'s next good poll, and lands on the player once', async () => {
    const moves: Move[] = [...LIVE, 'gm status p1', 'gm serve box', 'gm drop box', 'gm timer poll', 'gm serve link', 'gm answer link', 'gm serve box', 'gm answer box',
      'p1 timer poll', 'p1 serve link', 'p1 answer link'];
    const r = await run(1, moves);
    expect(r.failure).toBeNull();
    expect(r.played).toEqual(moves);
  });
  test('an award given while the GM\'s phone is reloading waits in the outbox and reaches the player once', async () => {
    const moves: Move[] = [...LIVE, 'gm award p1', 'gm reload', 'gm serve link', 'gm answer link', 'gm serve box', 'gm answer box', 'p1 timer poll', 'p1 serve link', 'p1 answer link'];
    const r = await run(1, moves);
    expect(r.failure).toBeNull();
    expect(r.played).toEqual(moves);
  });
});

describe('a coin call', () => {
  const CALL: Move[] = ['p1 coin', 'p1 serve box', 'p1 answer box', 'gm timer poll', 'gm serve link', 'gm answer link'];
  const LAND: Move[] = ['gm rule p1', 'gm serve box', 'gm answer box', 'p1 timer poll', 'p1 serve link', 'p1 answer link'];

  test('a call posted twice reaches the GM once, and the landing reaches the player on the GM\'s side', async () => {
    const r = await run(1, [...LIVE, 'p1 coin', 'p1 dup box', ...CALL.slice(1), ...LAND]);
    expect(r.failure).toBeNull();
    expect(r.played).toEqual([...LIVE, 'p1 coin', 'p1 dup box', ...CALL.slice(1), ...LAND]);
  });

  test('a landing posted twice, and a player who reloads in between, keep the first side', async () => {
    const r = await run(1, [...LIVE, ...CALL, 'gm rule p1', 'gm dup box', 'gm serve box', 'gm answer box', 'p1 reload', 'p1 serve link', 'p1 answer link', 'p1 serve link', 'p1 answer link']);
    expect(r.failure).toBeNull();
    expect(r.played).toContain('gm dup box');
  });

  test('a landing lost on its way out is sent again after the GM\'s next poll', async () => {
    const r = await run(1, [...LIVE, ...CALL, 'gm rule p1', 'gm drop box', 'gm timer poll', 'gm serve link', 'gm answer link']);
    expect(r.failure).toBeNull();
  });
});

describe('the fight\'s totals for a player\'s hunter', () => {
  test('reach the player once, through a lost poll answer and a reload of the player\'s page', async () => {
    const r = await run(1, [...LIVE, 'gm vitals p1', 'gm serve gm', 'gm answer gm', 'p1 timer poll', 'p1 serve link', 'p1 drop link', 'p1 reload']);
    expect(r.failure).toBeNull();
    expect(r.played).toContain('gm vitals p1');
  });
});

describe('a solo run of the room\'s gate (gates/solo.ts, solo-wait.ts)', () => {
  test('two players clear the GM\'s one solo gate: the first run is paid once and the second answered taken, through a lost answer and a reload', async () => {
    const w = fresh(2), [gm, p1, p2] = w.phones as [typeof w.phones[0], typeof w.phones[0], typeof w.phones[0]];
    try {
      await play(w, 'gm create'); await quiet(w, 2);
      await play(w, 'p1 join'); await play(w, 'p2 join'); await quiet(w, 3);
      expect([p1.link.at, p2.link.at]).toEqual(['live', 'live']);
      await play(w, 'p1 solo');
      expect(p1.save.runs.map(r => r.state)).toEqual(['posted']);
      await play(w, 'p2 solo');
      await play(w, 'p1 serve box'); await play(w, 'p1 drop box'); // the room took p1's run; its answer is lost
      await play(w, 'p1 reload');
      await quiet(w, QUIET_ROUNDS);
      expect(safety(w)).toBeNull();
      expect([p1.paid, p2.paid]).toEqual([{ [p1.save.posted[0]!.eid]: 1 }, {}]);
      expect([p1.save.runs, p2.save.runs, gm.save.soloGate]).toEqual([[], [], 'cleared']);
    } finally { done(w); }
  });
});

describe('the room under every interleaving explored', () => {
  test('random walks of two and three phones keep every rule', async () => {
    const t0 = performance.now(), mine = current;
    let moves = 0;
    for (let seed = 1; seed <= WALKS; seed++) {
      still(mine);
      const players = seed % 2 ? 1 : 2, next = rng(seed);
      const r = await run(players, [], options => options[Math.floor(next() * options.length)]!);
      moves += r.played.length;
      if (r.failure) {
        const small = await shrink(players, r.played, r.failure);
        throw new Error(report(`seed ${seed}, ${players + 1} phones`, small));
      }
    }
    console.log(`room model: ${WALKS} random walks, ${moves} moves, ${Math.round(performance.now() - t0)} ms`);
  }, 60_000);

  test(`every sequence of ${DEPTH} moves from a live room keeps every rule`, async () => {
    const t0 = performance.now(), mine = current;
    let sequences = 0;
    async function dfs(prefix: Move[]): Promise<void> {
      still(mine);
      if (prefix.length === LIVE.length + DEPTH) {
        sequences++;
        const r = await run(1, prefix);
        if (r.failure) throw new Error(report('exhaustive', await shrink(1, r.played, r.failure)));
        return;
      }
      const w = fresh(1);
      try { for (const m of prefix) await play(w, m); } finally { done(w); }
      // one move per way of posting: a risen shadow is posted as a spent item is (in the write of a fight command, with no
      // key, applied once by its id), so the random walks above play `gm shadow` and this run leaves it to `gm spent`; a
      // solo run is posted as a told use is (a player's message with no key), so the walks play `solo` and this run `use`
      // `gm noted` (a fight's facts) is posted that way too, so it is left to the random walks as `gm shadow` is
      for (const m of enabled(w).filter(m => !/^gm (shadow|noted) /.test(m) && !/ solo$/.test(m))) await dfs([...prefix, m]);
    }
    await dfs(LIVE);
    console.log(`room model: ${sequences} sequences of ${DEPTH} moves from a live room, ${Math.round(performance.now() - t0)} ms`);
  }, 60_000);
});
