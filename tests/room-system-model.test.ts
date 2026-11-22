// The room as a whole: a GM phone, one or two player phones and the real server handler (server.ts), each phone running
// the real link and push reducers and the real appliers and applied ids ring, composed by tests/models/room-world.ts.
// A world is its move sequence from the start (taps, a request reaching the server, its answer reaching the phone, a
// request or answer lost, a timer firing), so exploring re-runs sequences instead of cloning worlds. After every move
// the safety rules are checked; after a quiet phase (nothing lost, every timer fires) the convergence rules too.
// A failure prints the seed and the shortest sequence that still breaks the same rule.
import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { buildApp } from '../scripts/build.ts';
import { deadEnd } from './models/dead-ends.ts';
import { START_BAGS, START_STASH, enabled, isGm, keyOf, newWorld, play, probe, quiet, roster } from './models/room-world.ts';
import type { Move, Phone, World } from './models/room-world.ts';
import { coinOf } from '../src/core/coin.ts';
import { endOf, outcomeOf } from '../src/core/trade/offer.ts';
import type { OfferRecord } from '../src/core/trade/offer.ts';
import type { Goods } from '../src/core/trade/goods.ts';
import { endIdOf } from '../src/core/ids.ts';

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
/** Random walks of three phones that prefer a trade's moves (an offer or an answer a third of the time, a poll or a send carried a third), so offers settle, are refused, withdrawn and stopped. */
const TRADE_WALKS = 300;
/** Moves of a trade walk after both players are live: an offer settles in about 12 (posted, sent, read by the taker, accepted, sent, read by both). */
const TRADE_MOVES = 80;
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
const EVENT_KINDS = new Set(['award', 'status', 'chain', 'vitals', 'spent', 'shadow', 'noted']);
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
  const trade = tradeRule(w);
  if (trade) return trade;
  for (const [key, list] of Object.entries(w.writers)) {
    if (list.length > 1) return `phones ${list.map(i => w.phones[i]!.name).join(' and ')} both own sheet ${key} on the server`;
    if (!key.startsWith(`${w.phones[list[0]!]!.device}:`)) return `${w.phones[list[0]!]!.name} owns ${key}`;
  }
  return null;
}

/**
 * A player's coin in a room never holds a side (the owner, Nov 21: the GM says it at the table), and it is ruled only once
 * the GM's phone has landed it: a replayed call or ruling changes nothing. The GM's session log records each ruling once.
 */
function coinRule(w: World): string | null {
  const gm = w.phones[0]!;
  for (const [roll, n] of Object.entries(gm.ruled)) if (n > 1) return `the GM's session log records the ruling of ${roll} ${n} times`;
  for (const p of w.phones.slice(1)) {
    for (const c of p.save.coins) {
      if (c.at === 'landed') return `${p.name}'s coin ${c.id} shows the side ${c.side}, which only the GM's phone may hold`;
      if (c.at !== 'ruled') continue;
      const held = coinOf(gm.save.calls, c.id);
      if (held?.at !== 'landed' || held.call !== c.call) return `${p.name}'s coin ${c.id} is ruled, but the GM's phone holds it as ${held?.at ?? 'nothing'}`;
    }
  }
  return null;
}

/**
 * A solo run is paid at most once, and only a run whose gate the GM's phone cleared for it: across every player, the
 * GM's one solo gate pays one run at most (gates/solo.ts `soloTaken`, sync/asked.ts `askAnswered`).
 */
function soloRule(w: World): string | null {
  let paid = 0;
  for (const p of w.phones.slice(1)) for (const [run, n] of Object.entries(p.paid)) { if (n > 1) return `${p.name}'s solo run ${run} was paid ${n} times`; paid += n; }
  if (paid > 1) return `the GM's one solo gate paid ${paid} runs`;
  if (paid === 1 && w.phones[0]!.save.soloGate !== 'cleared') return 'a solo run was paid for a gate the GM\'s phone has not cleared';
  return null;
}

// ── a trade between the two players (notes-5-trade.md 1.8) ──
/** Whether the room holds an end of `r`'s offer that settles it: the goods are then the other side's, wherever they wait. */
function settledInRoom(w: World, r: OfferRecord): boolean {
  const end = w.stored[endIdOf(r.offer.id)], e = end ? endOf(end) : null;
  return !!e && outcomeOf(r.offer, e) === 'settled';
}
/** Whether the GM's phone kept stash ask `id` (its `kept` answer in the room, or in that phone's outbox): the put's goods are then the stash's. */
const keptInRoom = (w: World, id: string): boolean =>
  [...Object.values(w.stored), ...w.phones[0]!.save.outbox.flatMap(e => (e.letter.kind === 'event' ? [e.letter.event] : []))]
    .some(e => e.type === 'stashAnswer' && e.payload.ask === id && e.payload.verdict === 'kept');
/**
 * The goods a player's phone holds: its hunter's bag and gold, the asides of its records that no settled end in the room
 * gave away, and the goods of its stash puts that the GM's phone has not kept.
 */
function heldBy(w: World, p: Phone): { tokens: string[]; gold: number } {
  const puts: Goods[] = p.save.asked.flatMap(a => (a.kind === 'stash' && a.ask.kind === 'put' && !keptInRoom(w, a.id) ? [a.ask.goods] : []));
  const asides: Goods[] = [...p.save.offers.flatMap(r => ('aside' in r && !settledInRoom(w, r) ? [r.aside] : [])), ...puts];
  return {
    tokens: [...p.save.hunter.items.map(i => i.name), ...asides.flatMap(g => g.items.map(l => l.item.name))],
    gold: p.save.hunter.gold + asides.reduce((n, g) => n + g.gold, 0),
  };
}
const START_GOLD = START_BAGS.reduce((n, b) => n + b.gold, 0);
/** The tokens in the GM's party stash (trade/stash.ts). */
const stashed = (w: World): string[] => w.phones[0]!.save.stash.items.map(i => i.name);
/**
 * After every move: no token in two places among the players' bags and asides (never doubled); the gold never more than
 * the start; both sides of an offer that read its end read one outcome; a token a settled trade took from player 1 is
 * never in its bag again; the GM's session log has each trade once; a stash line is given at most once, and no token is
 * both in the stash and with a player. Goods a player took back from a stranded record after the room was gone are left
 * out (1.10: the window says they may be in two places).
 */
function tradeRule(w: World): string | null {
  const players = w.phones.slice(1);
  if (players.length < 2) return null;
  const twice = new Set(w.reclaimed.flatMap(g => g.items.map(l => l.item.name))), extra = w.reclaimed.reduce((n, g) => n + g.gold, 0);
  const held = players.map(p => heldBy(w, p)), tokens = [...held.flatMap(h => h.tokens), ...stashed(w)].filter(t => !twice.has(t));
  const doubled = tokens.find((t, i) => tokens.indexOf(t) !== i);
  if (doubled) return `${doubled} is in two places among the players' bags and asides and the stash`;
  const given = Object.values(w.stored).flatMap(e => (e.type === 'stashAnswer' && e.payload.verdict === 'given' ? e.payload.goods.items.map(l => l.from) : []));
  const twiceGiven = given.find((id, i) => given.indexOf(id) !== i);
  if (twiceGiven) return `the stash line ${twiceGiven} was given twice`;
  const gold = held.reduce((n, h) => n + h.gold, 0);
  if (gold > START_GOLD + extra) return `the players hold ${gold} gold, more than the ${START_GOLD + extra} they started with`;
  for (const [id, by] of Object.entries(w.outcomes)) if (new Set(Object.values(by)).size > 1) return `the phones read offer ${id} as ${JSON.stringify(by)}`;
  for (const ev of Object.values(w.stored)) {
    if (ev.type !== 'offerEnd') continue;
    const o = w.stored[ev.payload.offer], e = endOf(ev);
    if (o?.type !== 'offer' || !e || e.how !== 'accept' || e.by !== o.payload.to[0]) continue;
    for (const l of o.payload.gives.items) if (!twice.has(l.item.name) && players[0]!.save.hunter.items.some(i => i.name === l.item.name)) return `${l.item.name} went to ${players[1]!.name} in a settled trade and is back in ${players[0]!.name}'s bag`;
  }
  for (const [id, n] of Object.entries(w.phones[0]!.traded)) if (n > 1) return `the GM's session log has the trade ${id} ${n} times`;
  return null;
}
/**
 * At rest, with both players and the GM live and caught up in one room: every offer has at most one end in the room; no
 * phone keeps a record of an offer whose end the room holds (it was read, once); and unless a record was stranded, every
 * token is in exactly one place and the gold is whole.
 */
async function tradeRest(w: World, code: string): Promise<string | null> {
  const players = w.phones.slice(1);
  if (players.length < 2 || !w.phones.every(p => p.link.at === 'live' && p.link.code === code)) return null;
  const room = await probe(w, code as never);
  const ends = (room?.events ?? []).flatMap(e => (e.type === 'offerEnd' || e.type === 'offerStop' ? [e.payload.offer] : []));
  const twiceEnded = ends.find((x, i) => ends.indexOf(x) !== i);
  if (twiceEnded) return `offer ${twiceEnded} has two ends in the room`;
  for (const p of w.phones) for (const r of p.save.offers) if (r.offer.room === code && ends.includes(r.offer.id)) return `${p.name} is caught up and still keeps its ${r.side} record of offer ${r.offer.id}, whose end is in the room`;
  if (w.reclaimed.length || w.phones.some(p => p.save.offers.some(r => r.state === 'stranded'))) return null;
  const tokens = [...players.flatMap(p => heldBy(w, p).tokens), ...stashed(w)].sort(), start = [...START_BAGS.flatMap(b => b.tokens), ...START_STASH].map(n => `Token ${n}`).sort();
  if (JSON.stringify(tokens) !== JSON.stringify(start)) return `at rest the players hold ${tokens.join(', ')}, not each of ${start.join(', ')} once`;
  const gold = players.reduce((n, p) => n + heldBy(w, p).gold, 0);
  return gold === START_GOLD ? null : `at rest the players hold ${gold} gold of the ${START_GOLD} they started with`;
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
    // every message to this phone's hunter since the phone first joined the room lands once, whether or not the phone was
    // in the room when it was sent (notes-5-trade.md 11.7): a join back reads on from where the phone stopped
    const key = keyOf(p), from = p.first[p.link.code] ?? p.stretch.from;
    for (const ev of room.events) {
      if (!EVENT_KINDS.has(ev.type) || ev.seq <= from || !('to' in ev.payload) || !ev.payload.to?.includes(key)) continue;
      if (p.ledger[ev.payload.eid] !== 1) return `${ev.type} ${ev.payload.eid} (seq ${ev.seq}) took effect ${p.ledger[ev.payload.eid] ?? 0} times on ${p.name}, which first joined the room at ${from}`;
    }
    for (const ev of room.events) {
      if (ev.type !== 'coinLand' || ev.seq <= from || !ev.payload.roll.startsWith(`${p.device}:`)) continue;
      const c = coinOf(p.save.coins, ev.payload.roll);
      if (c?.at !== 'ruled') return `the ruling of ${ev.payload.roll} (seq ${ev.seq}) is in the room, but ${p.name}'s coin is ${c?.at ?? 'gone'}`;
    }
  }
  if (gmCode && gm.stretch && gm.stretch.room === gmCode) {
    // the GM's phone, too, reads on from where it stopped: a player's message sent while it was out of the room is heard
    const from = gm.first[gmCode] ?? gm.stretch.from;
    for (const ev of (await probe(w, gmCode))?.events ?? []) {
      if (ev.type !== 'used' || !ev.payload.tell || ev.seq <= from) continue;
      if (gm.told[ev.payload.eid] !== 1) return `the told use ${ev.payload.eid} (seq ${ev.seq}) is in the GM's session log ${gm.told[ev.payload.eid] ?? 0} times`;
    }
    for (const ev of (await probe(w, gmCode))?.events ?? []) {
      if (ev.type !== 'coinCall' || ev.seq <= from) continue;
      if (!coinOf(gm.save.calls, ev.payload.roll)) return `the call ${ev.payload.roll} (seq ${ev.seq}) is in the room, but the GM's phone does not hold it`;
    }
  }
  if (gmCode) { const t = await tradeRest(w, gmCode); if (t) return t; }
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
        if (mineNow?.at !== 'ruled') return `the GM landed ${c.id} on ${c.side}, but ${p.name}'s coin is ${mineNow?.at ?? 'gone'}`;
      }
    }
  }
  return null;
}

// ── running a sequence ──
type Run = { failure: string | null; played: Move[] };
/** Plays `moves` (a move not enabled is skipped), then with `pick` `steps` more, each chosen from what is enabled, then quiet. */
async function run(players: 1 | 2, moves: Move[], pick?: (options: Move[]) => Move, after?: (w: World) => void, steps = WALK_MOVES): Promise<Run> {
  const w = fresh(players), played: Move[] = [];
  try {
    for (let i = 0; i < moves.length + (pick ? steps : 0); i++) {
      const m = i < moves.length ? moves[i]! : pick!(enabled(w));
      if (!(await play(w, m))) continue;
      played.push(m);
      const bad = safety(w);
      if (bad) return { failure: bad, played };
    }
    await quiet(w, QUIET_ROUNDS);
    const failure = safety(w) ?? (await converged(w));
    after?.(w);
    return { failure, played };
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

/** Into a room with both players: `LIVE`, then the second player joins and pushes its sheet as the first did, and both poll. */
const LIVE_TWO: Move[] = [
  ...LIVE, 'p2 join', 'p2 serve link', 'p2 answer link', 'p2 serve link', 'p2 answer link', 'p2 timer push', 'p2 serve push', 'p2 answer push',
  'p2 serve link', 'p2 answer link', 'gm timer poll', 'gm serve link', 'gm answer link', 'p1 timer poll', 'p1 serve link', 'p1 answer link',
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

describe('a solo run of the room\'s gate (gates/solo.ts, sync/asked.ts)', () => {
  test('two players clear the GM\'s one solo gate: the first run is paid once and the second answered taken, through a lost answer and a reload', async () => {
    const w = fresh(2), [gm, p1, p2] = w.phones as [typeof w.phones[0], typeof w.phones[0], typeof w.phones[0]];
    try {
      await play(w, 'gm create'); await quiet(w, 2);
      await play(w, 'p1 join'); await play(w, 'p2 join'); await quiet(w, 3);
      expect([p1.link.at, p2.link.at]).toEqual(['live', 'live']);
      await play(w, 'p1 solo');
      expect(p1.save.asked.map(r => r.state)).toEqual(['posted']);
      await play(w, 'p2 solo');
      await play(w, 'p1 serve box'); await play(w, 'p1 drop box'); // the room took p1's run; its answer is lost
      await play(w, 'p1 reload');
      await quiet(w, QUIET_ROUNDS);
      expect(safety(w)).toBeNull();
      expect([p1.paid, p2.paid]).toEqual([{ [p1.save.posted[0]!.eid]: 1 }, {}]);
      expect([p1.save.asked, p2.save.asked, gm.save.soloGate]).toEqual([[], [], 'cleared']);
    } finally { done(w); }
  });
});

describe('what a phone missed while it was out of the room (notes-5-trade.md 11.7)', () => {
  /** A world with the GM and one player live in the GM's room, at rest. */
  async function liveWorld(): Promise<World> {
    const w = fresh(1);
    await play(w, 'gm create'); await quiet(w, 2);
    await play(w, 'p1 join'); await quiet(w, 3);
    return w;
  }
  const landed = (w: World): number[] => Object.values(w.phones[1]!.ledger);

  test('an award sent while Mira\'s phone was out of the room lands once when she joins again', async () => {
    const w = await liveWorld(), p1 = w.phones[1]!;
    try {
      await play(w, 'p1 leave');
      expect(p1.link.at).toBe('idle');
      expect(await play(w, 'gm award p1'), 'the GM\'s board still shows her hunter').toBe(true);
      await play(w, 'gm serve box'); await play(w, 'gm answer box');
      expect(landed(w), 'nothing lands on a phone out of the room').toEqual([]);
      await play(w, 'p1 join');
      await quiet(w, QUIET_ROUNDS);
      expect(p1.link.at).toBe('live');
      expect(landed(w)).toEqual([1]);
      expect(safety(w) ?? (await converged(w))).toBeNull();
    } finally { done(w); }
  });

  test('a player removed and allowed back gets the status the GM sent in between, once', async () => {
    const w = await liveWorld(), p1 = w.phones[1]!;
    try {
      await play(w, 'gm status p1'); await play(w, 'gm kick p1');
      await quiet(w, 2);
      expect(p1.link.at, 'the removal took her phone out').toBe('idle');
      const before = landed(w).length;
      await play(w, 'gm allow p1');
      await quiet(w, QUIET_ROUNDS);
      expect(p1.link.at).toBe('live');
      expect(landed(w).every(n => n === 1) && landed(w).length >= Math.max(1, before)).toBe(true);
      expect(safety(w) ?? (await converged(w))).toBeNull();
    } finally { done(w); }
  });

  test('a solo run claimed while the GM\'s phone was away is answered when the GM opens the room again', async () => {
    const w = await liveWorld(), [gm, p1] = w.phones as [World['phones'][0], World['phones'][0]];
    try {
      await play(w, 'gm leave');
      await play(w, 'p1 solo'); await play(w, 'p1 serve box'); await play(w, 'p1 answer box');
      expect(p1.save.asked.map(r => r.state), 'the room took the run; nobody answered it').toEqual(['taken']);
      await play(w, 'gm rejoin');
      await quiet(w, QUIET_ROUNDS);
      expect([gm.link.at, Object.values(p1.paid), p1.save.asked]).toEqual(['live', [1], []]);
      expect(safety(w) ?? (await converged(w))).toBeNull();
    } finally { done(w); }
  });

  test('a reload in the middle of a catch-up lands nothing twice', async () => {
    const w = await liveWorld(), p1 = w.phones[1]!;
    try {
      await play(w, 'p1 leave');
      for (const m of ['gm award p1', 'gm serve box', 'gm answer box', 'gm chain p1', 'gm serve box', 'gm answer box']) await play(w, m);
      await play(w, 'p1 join');
      // the join's code check and head answer, the first page of the catch-up is served, and the page reloads before its answer
      for (const m of ['p1 serve link', 'p1 answer link', 'p1 serve link', 'p1 answer link', 'p1 serve link', 'p1 reload']) expect(await play(w, m), m).toBe(true);
      await quiet(w, QUIET_ROUNDS);
      expect(landed(w)).toEqual([1, 1]);
      await play(w, 'p1 reload');
      await quiet(w, QUIET_ROUNDS);
      expect(landed(w), 'and a reload after it').toEqual([1, 1]);
      expect(safety(w) ?? (await converged(w))).toBeNull();
    } finally { done(w); }
  });
});

describe('a trade between two players (notes-5-trade.md 1.8, unit 2)', () => {
  /** A world with the GM and both players live in the GM's room, at rest. */
  async function threeLive(): Promise<World> {
    const w = fresh(2);
    await play(w, 'gm create'); await quiet(w, 2);
    await play(w, 'p1 join'); await play(w, 'p2 join'); await quiet(w, 3);
    return w;
  }
  const bagOf = (p: Phone): string[] => p.save.hunter.items.map(i => i.name).sort();
  const outcomesOf = (w: World): string[] => Object.values(w.outcomes).map(by => [...new Set(Object.values(by))].join('|'));

  test('player 1 offers a token, player 2 accepts, and each sheet changes once, through a lost answer and a reload of each phone', async () => {
    const w = await threeLive(), [gm, p1, p2] = w.phones as [Phone, Phone, Phone];
    try {
      expect(await play(w, 'p1 offer')).toBe(true);
      expect(bagOf(p1), 'the token is put aside in the tap\'s write').toEqual(['Token 2', 'Token 3']);
      await play(w, 'p1 serve box'); await play(w, 'p1 drop box'); await play(w, 'p1 reload');
      await quiet(w, QUIET_ROUNDS);
      expect(p2.save.offers.map(r => r.state)).toEqual(['offered']);
      expect(gm.save.offers.map(r => r.state)).toEqual(['open']);
      expect(await play(w, 'p2 accept')).toBe(true);
      await play(w, 'p2 serve box'); await play(w, 'p2 reload');
      await quiet(w, QUIET_ROUNDS);
      expect(outcomesOf(w)).toEqual(['settled']);
      expect([bagOf(p1), bagOf(p2)]).toEqual([['Token 2', 'Token 3'], ['Token 1', 'Token 11', 'Token 12']]);
      expect(p1.save.hunter.gold + p2.save.hunter.gold).toBe(150);
      expect([p1.save.offers, p2.save.offers, gm.save.offers]).toEqual([[], [], []]);
      expect(Object.values(gm.traded), 'the GM\'s session log has the trade once').toEqual([1]);
      expect(safety(w) ?? (await converged(w))).toBeNull();
    } finally { done(w); }
  });

  for (const first of ['accept', 'withdraw'] as const) {
    test(`an accept and a take back sent at once: whichever the room took decides, on both phones (${first} first)`, async () => {
      const w = await threeLive(), [, p1, p2] = w.phones as [Phone, Phone, Phone];
      try {
        await play(w, 'p1 offer'); await quiet(w, QUIET_ROUNDS);
        expect(await play(w, 'p2 accept')).toBe(true);
        expect(await play(w, 'p1 withdraw')).toBe(true);
        const order = first === 'accept' ? ['p2 serve box', 'p1 serve box'] : ['p1 serve box', 'p2 serve box'];
        for (const m of order) expect(await play(w, m), m).toBe(true);
        await quiet(w, QUIET_ROUNDS);
        expect(outcomesOf(w)).toEqual([first === 'accept' ? 'settled' : 'withdrawn']);
        expect(Object.keys(w.outcomes[Object.keys(w.outcomes)[0]!]!).sort()).toEqual(['gm gm', 'p1 giver', 'p2 taker']);
        expect(bagOf(p2).includes('Token 1')).toBe(first === 'accept');
        expect(p1.save.hunter.gold + p2.save.hunter.gold).toBe(150);
        expect(safety(w) ?? (await converged(w))).toBeNull();
      } finally { done(w); }
    });
  }

  test('a giver removed with its offer open reads the accept once, on the catch-up after the GM allows it back', async () => {
    const w = await threeLive(), [, p1, p2] = w.phones as [Phone, Phone, Phone];
    try {
      await play(w, 'p1 offer'); await quiet(w, QUIET_ROUNDS);
      await play(w, 'gm kick p1'); await quiet(w, 2);
      expect(p1.link.at).toBe('idle');
      await play(w, 'p2 accept'); await quiet(w, 2);
      expect(bagOf(p2)).toContain('Token 1');
      expect(p1.save.offers.map(r => r.state), 'the giver\'s phone is out of the room and has not read the end').toEqual(['open']);
      await play(w, 'gm allow p1');
      await quiet(w, QUIET_ROUNDS);
      expect(p1.link.at).toBe('live');
      expect([p1.save.offers, outcomesOf(w)]).toEqual([[], ['settled']]);
      expect(p1.save.hunter.gold + p2.save.hunter.gold).toBe(150);
      expect(safety(w) ?? (await converged(w))).toBeNull();
    } finally { done(w); }
  });

  test('two players take the stash\'s last token: the GM\'s phone gives it to the first ask it reads and refuses the other; each answer lands once', async () => {
    const w = await threeLive(), [gm, p1, p2] = w.phones as [Phone, Phone, Phone];
    try {
      expect(await play(w, 'p1 take')).toBe(true);
      expect(await play(w, 'p2 take')).toBe(true);
      await play(w, 'p2 serve box'); await play(w, 'p1 serve box'); await play(w, 'p1 reload');
      await quiet(w, QUIET_ROUNDS);
      expect([bagOf(p1).includes('Token 21'), bagOf(p2).includes('Token 21'), gm.save.stash.items]).toEqual([false, true, []]);
      expect([p1.save.asked, p2.save.asked]).toEqual([[], []]);
      expect(await play(w, 'p1 put')).toBe(true);
      await quiet(w, QUIET_ROUNDS);
      expect([gm.save.stash.items.map(i => i.name), bagOf(p1)]).toEqual([['Token 1'], ['Token 2', 'Token 3']]);
      expect(safety(w) ?? (await converged(w))).toBeNull();
    } finally { done(w); }
  });

  test('random walks of a trade keep every rule, and settle, refuse, withdraw and stop offers', async () => {
    const t0 = performance.now(), mine = current, seen = new Set<string>();
    let moves = 0;
    for (let seed = 1; seed <= TRADE_WALKS; seed++) {
      still(mine);
      const next = rng(seed * 7919);
      const answering = (m: Move): boolean => / (offer|accept|refuse|put|take)$/.test(m), ending = (m: Move): boolean => / (withdraw|stop)$/.test(m);
      // no removal here: a sheet a trade changed, pushed after the server's 20 s removal window by a phone that has not yet
      // heard its removal, puts the removed player back on the GM's roster (seed 76; a finding of the removal's window, in
      // notes-5-trade.md 12.11, not of a trade). The removal of a giver is the named test above.
      const r = await run(2, LIVE_TWO, all => {
        const options = all.filter(m => !/^gm kick /.test(m)), a = options.filter(answering), e = options.filter(ending), roll = next();
        const carry = options.filter(m => / (serve|answer) (link|box)$| timer poll$/.test(m));
        // Take back and Stop are enabled while any offer is open, so taken uniformly they end nearly every offer before
        // its taker reads it: they get a small share; an offer or an answer, and a poll or a send carried, a third each
        const from = a.length && roll < 0.33 ? a : e.length && roll < 0.38 ? e : carry.length && roll < 0.7 ? carry : options.filter(m => !ending(m));
        return from[Math.floor(next() * from.length)]!;
      }, w => {
        for (const by of Object.values(w.outcomes)) for (const o of Object.values(by)) seen.add(o);
        for (const e of Object.values(w.stored)) if (e.type === 'stashAnswer') seen.add(`stash ${e.payload.verdict}`);
      }, TRADE_MOVES);
      moves += r.played.length;
      if (r.failure) throw new Error(report(`trade seed ${seed}`, await shrink(2, r.played, r.failure)));
    }
    expect([...seen].sort()).toEqual(['refused', 'settled', 'stash given', 'stash kept', 'stash refused', 'stopped', 'withdrawn']);
    console.log(`room model: ${TRADE_WALKS} trade walks, ${moves} moves, ${Math.round(performance.now() - t0)} ms`);
  }, 60_000);
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
      for (const m of enabled(w).filter(m => !/^gm (shadow|noted|chapter) /.test(m) && !/ solo$/.test(m))) await dfs([...prefix, m]);
    }
    await dfs(LIVE);
    console.log(`room model: ${sequences} sequences of ${DEPTH} moves from a live room, ${Math.round(performance.now() - t0)} ms`);
    // The walk is all computing and asserts no time: 16,386 sequences take 42 to 45 s alone on the lead's four-core box
    // (Nov 19, the same before and after feats unit 4) and passed 60 s inside the whole run, where the walk going on
    // after its timeout then failed tests of the files after it. The limit is only how long bun lets it compute.
    // Inside the whole run with four workers (scripts/ci.ts), three runs on Nov 19: 54, 48 and 50 s. The budget is 180 s,
    // over twice the slowest.
  }, 180_000);
});
