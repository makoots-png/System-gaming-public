// The world of the room system model (tests/room-system-model.test.ts): the real server handler and two or three phones,
// each running the real link and push reducers (src/core/sync/link.ts, push.ts) under a small effect runner that does
// what src/edge/sync.ts does. Every place where this runner had to decide what the edge does names the function of
// sync.ts it copies; docs/agent-handoff/p3/notes-room-system.md lists them.
//
// A request is a pending call: first `out` (the server has not seen it), then `back` (the real handler answered and the
// answer is on its way). A phone that drops a request (an `abort` of its gen, or a reload) no longer hears its answer,
// but the server may still get it, as on a real network. Time is one virtual clock (Date.now is replaced while a world
// runs): a move takes 1 ms, a timer firing moves the clock to when it was due, a lost answer to when its timeout passed.
import { RULES } from '../../src/core/rules.ts';
import { boot, paceOf, reduce as linkReduce } from '../../src/core/sync/link.ts';
import type { FailKind, Gen, GmKey, Last, Link, LinkCall, LinkEffect, LinkEvent, SaveFields } from '../../src/core/sync/link.ts';
import { PUSH_OFF, reduce as pushReduce } from '../../src/core/sync/push.ts';
import type { Push, PushEffect, PushEvent, RefusedWhy } from '../../src/core/sync/push.ts';
import { DOCS, REMOVED_MS, newEvent, onTurn, parseDeviceId, parseRoomState, parseSheetKey } from '../../src/core/protocol.ts';
import type { DeviceId, EventId, EventType, RoomCode, RoomDocs, RoomEvent, RoomState, SheetKey } from '../../src/core/protocol.ts';
import { recordApplied } from '../../src/core/applied.ts';
import { ringDrop, ringGone, ringKeep } from '../../src/core/sync/bind.ts';
import { seenFrom, seenKept, seenWithout } from '../../src/core/sync/seen.ts';
import type { RoomPlaces } from '../../src/core/sync/seen.ts';
import { hunterIdOf, sheetKeyOf } from '../../src/core/ids.ts';
import { parseDayKey } from '../../src/core/day.ts';
import { freshSave } from '../../src/core/save.ts';
import type { Save } from '../../src/core/save.ts';
import { TOLD, isRefused, refuse } from '../../src/core/save-step.ts';
import type { Fight } from '../../src/core/combat/fight-types.ts';
import { roleOf } from '../../src/core/role.ts';
import { applyRoomEvent } from '../../src/edge/room-events.ts';
import { RULINGS, addCoin, coinOf, inAir, landingOf, newRollId, stepCoin, takeCall } from '../../src/core/coin.ts';
import { callOf, next as nextOut, post as postIn, reloaded, roomGone, sentEvent, step as outStep } from '../../src/core/sync/outbox.ts';
import type { Entry, Letter, Outbox } from '../../src/core/sync/outbox.ts';
import type { Coin, RollId, CoinSide } from '../../src/core/coin.ts';
import type { ApplyDeps } from '../../src/edge/room-events.ts';
import { handler } from '../../server.ts';
import { runPosted, runTaken, runsGone, waitingGates } from '../../src/core/gates/solo-wait.ts';
import type { WaitingRun } from '../../src/core/gates/solo-wait.ts';
import { ALL_REPLIES, freeze } from './sync-world.ts';
import { NOBODY, NO_ATTEMPT, attemptStep } from '../../src/core/sync/attempt.ts';
import type { Attempt, AttemptEvent, RoomTap } from '../../src/core/sync/attempt.ts';
import { hid, iid } from '../fixtures/ids.ts';
import { newHunter } from '../../src/core/save.ts';
import type { Hunter } from '../../src/core/save.ts';
import { OFFER_OUTCOMES, TAKER, GIVER, closeNews, endOf, letterTaken, lettersKept, offerAnswered, offerPosted, offerStopped, offerTakenBack, offersGone, offersSeen, outcomeOf } from '../../src/core/trade/offer.ts';
import type { Closed, OfferOutcome, OfferRecord } from '../../src/core/trade/offer.ts';
import type { Goods } from '../../src/core/trade/goods.ts';
import { endIdOf } from '../../src/core/ids.ts';

/** As in src/edge/sync.ts: a removal in the `_kicked` doc younger than this keeps the player out. */
const KICK_MS = REMOVED_MS;
/** As in src/edge/sync.ts: a request outside the machines (an event, a doc, a GM action) is given up after this. */
const REQ_MS = 20000;

// ── the phones ──
/** The part of a phone's save the machines and the edge write, and the hunter reduced to a counter that changes. */
export type PhoneSave = {
  mode: 'gm' | 'player'; room: RoomCode | null; cursor: number; last: Last; gmKey: GmKey | null; gmKeys: Record<string, GmKey>;
  applied: EventId[]; joinedAt: string; serverOk: boolean; sheet: number;
  /** The GM's fight, reduced to its `now`: it is always the turn of the first player's hunter, and every use moves time on. */
  fightNow: number;
  /** The coins this phone called (src/views/coin.js `coins`), the calls the GM's phone holds (`calls`), and the rolls made. */
  coins: readonly Coin[]; calls: readonly Coin[]; rolled: number;
  /** What this phone owes the room (src/core/sync/outbox.ts), and every message it posted, by room (bookkeeping for the rules). */
  outbox: Outbox; posted: { room: RoomCode; eid: EventId }[];
  /** A player's won solo runs waiting for the GM's answer (src/core/gates/solo-wait.ts); the GM's one solo gate, open or cleared. */
  runs: readonly WaitingRun[]; soloGate: 'open' | 'cleared';
  /** Where this phone stopped reading each room it went out of (src/core/sync/seen.ts), written by `save` as `linkSaved` writes it. */
  seen: RoomPlaces;
  /**
   * A player's one hunter as a trade sees it: a bag of numbered tokens (each its own thing, so it never stacks) and gold;
   * the save's id counter (a received item takes a new id); this phone's records of the room's offers
   * (src/core/trade/offer.ts), the GM's watch records on its phone.
   */
  hunter: Hunter; seq: number; offers: readonly OfferRecord[];
};
type Shown = { gen: Gen | null; sheets: RoomState['sheets']; docs: RoomDocs };
const NOTHING_SHOWN: Shown = { gen: null, sheets: {}, docs: {} };
type Data = { kind: 'poll'; r: RoomState; after: number } | { kind: 'head'; now: string } | null;
type QItem = { to: 'link'; e: LinkEvent; data: Data } | { to: 'push'; e: PushEvent };
export type Phone = {
  i: number; name: string; device: DeviceId; token: string;
  /** Kept across a reload. */
  save: PhoneSave;
  /** How many times each event id took effect on this phone's hunter. Part of the hunter, so kept across a reload. */
  ledger: Record<string, number>;
  /** How many session log lines each told use (`used` with `tell`) wrote on this phone, by event id. Part of the save. */
  told: Record<string, number>;
  /** How many players' casts the GM's fight took at each `now`. Part of the save, as the fight is. */
  acted: Record<number, number>;
  /** How many times each of this phone's solo runs was paid, by run id. Part of the hunter. */
  paid: Record<string, number>;
  /** How many times the GM's session log recorded a ruling for each roll. Part of the save. */
  ruled: Record<string, number>;
  /** When and on which page of the GM's phone each roll was ruled: in memory, a lost landing is sent again only by that page. */
  ruledOn: Record<string, { at: number; page: number }>;
  /** Bookkeeping for the rules: the room the save holds and the cursor it was entered with. */
  stretch: { room: RoomCode; from: number; at: number } | null;
  /** Bookkeeping for the rules: for each room, the cursor this phone first went live in it with. Every message to it after that lands once. */
  first: Record<string, number>;
  /** How many lines of the GM's session log each offer's end wrote (the fold's log lines), by offer id. Part of the save. */
  traded: Record<string, number>;
  // in memory: dropped by a reload
  page: number; link: Link; push: Push; attempt: Attempt<null>; sheetText: string; shown: Shown; srvSkew: number;
  timers: { poll?: number; push?: number }; queue: QItem[]; running: boolean; notices: string[];
  /** The device has no network: nothing it sends reaches the server, and the link hears `offline` (a device state, kept across a reload). */
  offline: boolean;
};

// ── the network ──
/** `gm`: a request outside the machines (sync.ts `send`, a removal); `box`: an outbox entry's send (sync.ts `deliver`). */
export type Lane = 'link' | 'push' | 'gm' | 'box';
/** `prove`: as sync.ts `fetchApi`, a read that says which phone asks (the poll and the head) carries the device token. */
type Http = { method: string; path: string; body?: unknown; key?: string | null; prove?: boolean };
type Answer = { status: number; data: unknown };
type Reply = Answer | { none: 'net' | 'timeout' };
export type Pending = {
  n: number; phone: number; page: number; lane: Lane; gen: Gen | null; room: RoomCode | null; what: string;
  stage: 'out' | 'back'; dead: boolean; sentAt: number; timeoutMs: number; http: Http; answer: Answer | null;
  reply: (r: Reply) => void;
};

export type World = {
  build: string; clock: number; phones: Phone[]; pending: Pending[]; n: number; made: number;
  /** What the GM was last told about each player's sheet key: removed (kick answered) or allowed back. */
  told: Record<string, { state: 'removed' | 'allowed'; room: RoomCode; at: number }>;
  /** Broken rules seen while the world ran (a GM-only request of a player taken, a stale reply that changed a phone). */
  broken: string[];
  /** Per hunter sheet key, the phones whose sheet the server stored under it. */
  writers: Record<string, number[]>;
  /** Each room's GM key as its create answered it (bookkeeping for the rules: `probe` reads the whole room with it). */
  keys: Record<string, string>;
  /** Each event a room stored, by id, as the server keeps the first of an id (bookkeeping for the trade's rules, which `safety` checks with no request). */
  stored: Record<string, RoomEvent>;
  /** How each phone's record of an offer ended, by offer id and then phone and side (bookkeeping: both sides read one outcome). */
  outcomes: Record<string, Record<string, OfferOutcome>>;
  /** Goods a player took back from a stranded record after the room was gone: the one way a unit may be in two places (notes-5-trade.md 1.10). */
  reclaimed: Goods[];
};

export const keyOf = (p: Phone): SheetKey => parseSheetKey(`${p.device}:h1`)!;
const hunterOf = (p: Phone) => ({ id: 'h1', name: `${p.name} #${p.save.sheet}` });
const sheetJson = (p: Phone): string => JSON.stringify(hunterOf(p));
/** app.js `isGM`: the role for the room the link is in (src/core/role.ts). */
export const isGm = (p: Phone): boolean => roleOf({ mode: p.save.mode, sync: { gmKey: p.save.gmKey } }, roomOf(p.link)) === 'gm';

/** The tokens and gold each player's hunter starts with: player 1 gives tokens, player 2 pays gold (notes-5-trade.md 1.8). */
export const START_BAGS: readonly { readonly tokens: readonly number[]; readonly gold: number }[] = [{ tokens: [], gold: 0 }, { tokens: [1, 2, 3], gold: 100 }, { tokens: [11, 12], gold: 50 }];
const token = (n: number) => ({ id: iid(`i${n}`), name: `Token ${n}`, rar: 'common' as const, type: 'misc' as const, slot: null, qty: 1, dice: '', bonus: {}, desc: '', armor: 0, resist: 0 });
const HUNTER = newHunter(RULES);
function newPhone(i: number, name: string, mode: 'gm' | 'player'): Phone {
  const start = START_BAGS[i] ?? START_BAGS[0]!;
  return {
    i, name, device: parseDeviceId(`d-${name}`)!, token: `${name}-token`.padEnd(16, 'x'),
    save: { mode, room: null, cursor: 0, last: null, gmKey: null, gmKeys: {}, applied: [], joinedAt: '', serverOk: true, sheet: 1, fightNow: FIGHT_START, coins: [], calls: [], rolled: 0, outbox: [], posted: [], runs: [], soloGate: 'open', seen: {},
      hunter: { ...HUNTER, id: hid('h1'), name, gold: start.gold, items: start.tokens.map(token) }, seq: 100, offers: [] },
    ledger: {}, told: {}, acted: {}, paid: {}, ruled: {}, ruledOn: {}, stretch: null, first: {}, traded: {},
    page: 0, link: { at: 'off', gen: 0 as Gen }, push: PUSH_OFF, attempt: NO_ATTEMPT, sheetText: '', shown: NOTHING_SHOWN, srvSkew: 0,
    timers: {}, queue: [], running: false, notices: [], offline: false,
  };
}

/** A new world: a GM phone and `players` player phones, each booted with no room, and the clock at `t0`. */
export function newWorld(build: string, players: 1 | 2, t0: number): World {
  const w: World = { build, clock: t0, phones: [], pending: [], n: 0, made: 0, told: {}, broken: [], writers: {}, keys: {}, stored: {}, outcomes: {}, reclaimed: [] };
  w.phones.push(newPhone(0, 'gm', 'gm'));
  for (let k = 1; k <= players; k++) w.phones.push(newPhone(k, `p${k}`, 'player'));
  for (const p of w.phones) startPage(w, p);
  return w;
}

// ── the edge, phone by phone (each function names its original in src/edge/sync.ts) ──
/** sync.ts `register` boot: the link reads the save; the page was served by the room server. */
function startPage(w: World, p: Phone): void {
  const s = p.save;
  // sync.ts boot: nothing the last page sent is answered here, so what was on its way waits again
  if (s.outbox.some(e => e.at === 'sending')) write(w, p, x => { x.outbox = reloaded(x.outbox); });
  const room = s.room ? { code: s.room, key: s.gmKey ? s.gmKey : null, cursor: s.cursor } : null; // sync.ts `storedRoom`
  const started = boot({ server: true, room, last: s.last });
  p.link = started.state;
  runLink(w, p, started.effects, started.state, null);
}

/** `linkDo`, `pushDo`, `drain`: events raised while effects run wait their turn. */
function linkDo(w: World, p: Phone, e: LinkEvent, data: Data = null): void { p.queue.push({ to: 'link', e, data }); drain(w, p); }
function pushDo(w: World, p: Phone, e: PushEvent): void { p.queue.push({ to: 'push', e }); drain(w, p); }
function drain(w: World, p: Phone): void {
  if (p.running) return;
  p.running = true;
  try {
    for (let next = p.queue.shift(); next; next = p.queue.shift()) {
      if (next.to === 'link') {
        const before = p.link, r = linkReduce(freeze(p.link), freeze(next.e));
        p.link = r.state;
        runLink(w, p, r.effects, before, next.data);
        attemptDo(w, p, { type: 'linked', took: next.e, link: p.link, notices: r.effects.flatMap(x => (x.type === 'notify' ? [x.id] : [])) });
      } else {
        const r = pushReduce(freeze(p.push), freeze(next.e));
        p.push = r.state;
        runPush(w, p, r.effects);
      }
    }
  } finally { p.running = false; }
}

/** `runLink`. */
function runLink(w: World, p: Phone, fx: LinkEffect[], before: Link, data: Data): void {
  // sync.ts `runLink`: a poll page's cursor waits for the page's `apply`, which writes it with what the page lands
  const page = data?.kind === 'poll' && fx.some(x => x.type === 'apply');
  let cursor: SaveFields | null = null;
  for (const x of fx) {
    switch (x.type) {
      case 'request': linkRequest(w, p, x.gen, x.timeoutMs, x.call); break;
      case 'abort': for (const r of w.pending) if (r.phone === p.i && r.page === p.page && r.lane !== 'gm' && r.gen === x.gen) r.dead = true; break;
      case 'setTimer': p.timers[x.name] = w.clock + x.ms; break;
      case 'clearTimer': delete p.timers[x.name]; break;
      case 'save': if (page) cursor = x.fields; else save(w, p, x.fields, before); break;
      case 'notify': {
        p.notices.push(x.id);
        const code = 'code' in before ? before.code : null;
        // sync.ts `notice` 'gone': the room's offers step `roomGone` in the write that refuses its letters
        if (x.id === 'gone' && code) {
          const gone = offersGone(tradeSave(p), code);
          noteClosed(w, p, gone.closed);
          write(w, p, s => { tradeBack(p, gone.save); s.runs = onRuns(s, x2 => runsGone(x2, code)); s.outbox = roomGone(s.outbox, code); });
        }
        break;
      }
      case 'status': break;
      case 'apply': apply(w, p, data, cursor, before); cursor = null; break;
      case 'push': { const r = pushReduce(freeze(p.push), freeze(x.event)); p.push = r.state; runPush(w, p, r.effects); break; }
    }
  }
}
/** `runPush`. */
function runPush(w: World, p: Phone, fx: PushEffect[]): void {
  for (const x of fx) {
    switch (x.type) {
      case 'request': sendSheet(w, p, x.gen, x.timeoutMs); break;
      case 'setTimer': p.timers[x.name] = w.clock + x.ms; break;
      case 'clearTimer': delete p.timers[x.name]; break;
      case 'notify': p.notices.push('locked'); break;
      case 'status': break;
    }
  }
}

/**
 * A store write, then the store's change signal: `app.on('change')` in sync.ts tells the push when the sheet text differs.
 * store.ts `apply` runs `lettersKept` on every write's answer: each offer record follows its letter in the box.
 */
function write(w: World, p: Phone, fn: (s: PhoneSave) => void): void {
  fn(p.save);
  if (p.save.offers.length) { const s = p.save, next = lettersKept(tradeSave(p)); if (next.settings.sync.offers !== s.offers) tradeBack(p, next); }
  if (p.push.at !== 'off' && sheetJson(p) !== p.sheetText) pushDo(w, p, { type: 'changed' });
}

// ── a trade (src/core/trade/offer.ts): the real steps on the part of the save they read ──
const BASES = new Map<DeviceId, Save>();
/** The phone's save as the trade's steps read it: its one hunter bound in its room, its outbox, its offer records. */
function tradeSave(p: Phone): Save {
  const base = BASES.get(p.device) ?? playerSave(p.device);
  BASES.set(p.device, base);
  const s = p.save;
  return { ...base, seq: s.seq, hunters: p.i === 0 ? base.hunters : [s.hunter], settings: { ...base.settings, sync: { ...base.settings.sync, room: s.room, boundHunterId: hid('h1'), outbox: s.outbox, offers: [...s.offers] } } };
}
/** Takes back what a trade's step changed: the hunter (its sheet then changes), the id counter, the outbox and the records. */
function tradeBack(p: Phone, next: Save): void {
  const s = p.save, h = p.i === 0 ? s.hunter : next.hunters.find(x => x.id === 'h1') ?? s.hunter;
  if (h !== s.hunter) s.sheet++;
  s.hunter = h; s.seq = next.seq; s.outbox = next.settings.sync.outbox ?? []; s.offers = next.settings.sync.offers ?? [];
}
/** A trade's step as one store write; a refused one writes nothing. Answers whether it wrote. */
function trade(w: World, p: Phone, f: (s: Save) => Save | { ok: false }): boolean {
  const next = f(tradeSave(p));
  if ('ok' in next) return false;
  write(w, p, () => tradeBack(p, next));
  return true;
}
/** What each phone's record of an offer read as its outcome (both sides must read one). */
function noteClosed(w: World, p: Phone, closed: readonly Closed[]): void {
  for (const c of closed) {
    const outcome = OFFER_OUTCOMES.find(o => o === c.close);
    if (outcome) (w.outcomes[c.record.offer.id] ??= {})[`${p.name} ${c.record.side}`] = outcome;
  }
}
/**
 * sync.ts `landPage`, its fold: what the page says of offers, over the page whole with this phone's own echoes, in the
 * page's write; the GM's phone writes a session log line for each news of kind `log`.
 */
function foldOffers(w: World, p: Phone, page: RoomState['events']): void {
  if (p.link.at !== 'live' || !page.length) return;
  const me = { room: p.link.code, seat: p.link.key === null ? 'player' as const : 'gm' as const };
  const before = tradeSave(p), seen = offersSeen(before, page, me);
  noteClosed(w, p, seen.closed);
  for (const n of seen.news) if (n.kind === 'log') p.traded[n.offer] = (p.traded[n.offer] ?? 0) + 1;
  if (seen.save !== before) write(w, p, () => tradeBack(p, seen.save));
}
/** The tap for each trade move; a move is enabled only where its tap is not refused (notes-5-trade.md 1.8's moves). */
function tradeTap(w: World, p: Phone, verb: string, rand = 0): Save | { ok: false } {
  const s = tradeSave(p), gate = { on: true, held: false } as const;
  const open = (side: OfferRecord['side'], ok: (r: OfferRecord) => boolean) => p.save.offers.find(r => r.side === side && ok(r)) ?? null;
  switch (verb) {
    case 'offer': {
      const to = w.phones[2]; if (!to) return { ok: false };
      const t = p.save.hunter.items[0], asks = w.made % 2 ? 5 : 0;
      return offerPosted(s, { hid: hid('h1'), to: keyOf(to), toName: to.name, at: new Date(w.clock).toISOString(), stamp: { device: p.device, now: w.clock, rand }, ...gate,
        gives: { gold: t ? 0 : 5, items: t ? [{ id: t.id, qty: 1, name: t.name }] : [] }, asks: { gold: asks, items: [] } });
    }
    case 'accept': case 'refuse': { const r = open('taker', x => x.state === 'offered'); return r ? offerAnswered(s, r.offer.id, verb, gate) : { ok: false }; }
    case 'withdraw': { const r = takeBackOf(p); return r ? offerTakenBack(s, r.offer.id) : { ok: false }; }
    case 'stop': { const r = open('gm', x => x.state === 'open'); return r ? offerStopped(s, r.offer.id) : { ok: false }; }
    default: return { ok: false };
  }
}
/** The record a player's Take back is for: its oldest that takes one (its offer, or a stranded answer). */
const takeBackOf = (p: Phone): OfferRecord | undefined =>
  p.save.offers.find(x => x.side !== 'gm' && (x.side === 'giver' ? GIVER[x.state].takeBack : TAKER[x.state].takeBack) !== null);
const TRADE_TAPS = ['offer', 'accept', 'refuse', 'withdraw'] as const;

/** `save`: the only writer of the room fields. */
function save(w: World, p: Phone, fields: SaveFields, before: Link): void {
  const room0 = p.save.room;
  write(w, p, s => {
    // bind.ts `linkSaved`: the room's cursor is kept in the write that takes the phone out of it; the place goes when the
    // phone is in the room again, and when the room is gone
    const at = new Date(w.clock + p.srvSkew).toISOString(); // sync.ts `srvNow`
    const gone = fields.last?.why === 'gone' ? fields.last.code : fields.ring && 'gone' in fields.ring ? fields.ring.gone : null;
    if (fields.room !== undefined && s.room && fields.room !== s.room) s.seen = seenKept(s.seen, s.room, s.cursor, at);
    if (fields.room) s.seen = seenWithout(s.seen, fields.room);
    if (gone) s.seen = seenWithout(s.seen, gone);
    if (fields.room !== undefined) s.room = fields.room;
    if (fields.cursor !== undefined) s.cursor = fields.cursor;
    if (fields.last !== undefined) s.last = fields.last ? { code: fields.last.code, why: fields.last.why } : null;
    if (fields.gmKey !== undefined) s.gmKey = fields.gmKey;
    if (fields.room) s.serverOk = true;
    // the ring's steps of src/core/sync/bind.ts, as `linkSaved` runs them
    const ring = fields.ring;
    const r = ring && 'keep' in ring ? { gmKey: s.gmKey, gmKeys: ringKeep(s.gmKeys, ring.keep, ring.key) }
      : ring && 'drop' in ring ? ringDrop(s, ring.drop, 'key' in before ? before.key : null)
        : ring && 'gone' in ring ? ringGone(s, ring.gone) : s;
    s.gmKeys = { ...(r.gmKeys ?? {}) }; s.gmKey = r.gmKey ?? null;
  });
  if (p.save.room !== room0) p.stretch = p.save.room ? { room: p.save.room, from: p.save.cursor, at: w.clock } : null;
  if (p.save.room !== room0 && p.save.room) p.first[p.save.room] ??= p.save.cursor;
}

/** `attemptDo`: the real tap machine (src/core/sync/attempt.ts). The world's taps have no view to answer. */
function attemptDo(w: World, p: Phone, e: AttemptEvent<null>): void {
  const r = attemptStep(p.attempt, e);
  p.attempt = r.state;
  for (const x of r.effects) {
    switch (x.type) {
      case 'link': linkDo(w, p, x.tap); break;
      case 'answer': break;
    }
  }
}

function request(w: World, p: Phone, lane: Lane, gen: Gen | null, room: RoomCode | null, what: string, timeoutMs: number, http: Http, reply: (r: Reply) => void): void {
  w.pending.push({ n: w.n++, phone: p.i, page: p.page, lane, gen, room, what, stage: 'out', dead: false, sentAt: w.clock, timeoutMs, http, answer: null, reply });
}

const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const errorOf = (a: Answer): string => (isObj(a.data) && typeof a.data.error === 'string' ? a.data.error : '');
const ok = (r: Reply): boolean => 'status' in r && r.status >= 200 && r.status < 300;

/** `linkRequest` and `ask`: one reply per request, turned into link events as sync.ts does. */
function linkRequest(w: World, p: Phone, gen: Gen, timeoutMs: number, call: LinkCall): void {
  const failedOf = (a: Answer): LinkEvent => (a.status === 404 && errorOf(a) === 'no such room' ? { type: 'gone', gen } : { type: 'failed', gen, kind: 'server' });
  const failedServer: LinkEvent = { type: 'failed', gen, kind: 'server' };
  const go = (events: LinkEvent[], data: Data = null): void => events.forEach((e, i) => linkDo(w, p, e, i === 0 ? data : null));
  const on = (http: Http, room: RoomCode | null, answer: (a: Answer) => void): void =>
    request(w, p, 'link', gen, room, call.req, timeoutMs, http, r => ('none' in r ? go([{ type: 'failed', gen, kind: r.none }]) : answer(r)));
  switch (call.req) {
    case 'health': return on({ method: 'GET', path: '/health' }, null, a => {
      if (a.status !== 200 || !isObj(a.data) || !a.data.ok) return go([failedServer]);
      heard(w, p); go([{ type: 'healthOk', gen }]);
    });
    case 'create': return on({ method: 'POST', path: '/rooms' }, null, a => {
      const code = isObj(a.data) ? (a.data.code as RoomCode) : null, key = isObj(a.data) && typeof a.data.gmKey === 'string' ? a.data.gmKey : '';
      if (a.status !== 200 || !code || !key) return go([failedServer]);
      w.keys[code] = key;
      go([{ type: 'created', gen, code, key: key as GmKey }]);
    });
    case 'peek': return on({ method: 'GET', path: `/rooms/${call.code}?peek=1` }, call.code, a => {
      if (a.status !== 200) return go([failedServer]);
      go([{ type: 'peeked', gen, exists: isObj(a.data) && a.data.exists === true }]);
    });
    case 'head': return on({ method: 'GET', path: `/rooms/${call.code}?after=0&d=${p.device}`, key: call.key, prove: true }, call.code, a => {
      if (a.status !== 200) return go([failedOf(a)]);
      const r = parseRoomState(a.data); if (!r) return go([failedServer]);
      if (r.more) throw new Error('runner: a head of more than one page is not modelled');
      go([{ type: 'headed', gen, cursor: r.next, gm: r.gm, kicked: kickedAt(w, r, keyOf(p)) !== null }], { kind: 'head', now: r.now });
    });
    case 'poll': {
      const after = call.cursor;
      return on({ method: 'GET', path: `/rooms/${call.code}?after=${after}&d=${p.device}`, key: call.key, prove: true }, call.code, a => {
        if (a.status !== 200) return go([failedOf(a)]);
        const r = parseRoomState(a.data); if (!r) return go([failedServer]);
        const fight = r.docs.fight?.data ?? null;
        const events: LinkEvent[] = [{ type: 'polled', gen, cursor: Math.max(r.next, after), more: r.more, pace: paceOf(fight, call.key !== null, p.device), fightAt: fight ? fight.at : null }];
        if (call.key && !r.gm) events.push({ type: 'keyLost', gen });
        if (!call.key && removedSinceJoin(w, p, r)) events.push({ type: 'removed', gen });
        go(events, { kind: 'poll', r, after });
      });
    }
  }
}
/** `heard`. */
const heard = (w: World, p: Phone): void => { if (!p.save.serverOk) write(w, p, s => { s.serverOk = true; }); };
/** `kickedAt`. */
function kickedAt(w: World, r: RoomState, key: SheetKey): number | null {
  const t = Date.parse(r.docs.kicked?.data.keys[key] ?? ''), now = Date.parse(r.now) || w.clock;
  return Number.isFinite(t) && now - t < KICK_MS ? t : null;
}
/** `removedSinceJoin`: the bound hunter is always h1 here. */
function removedSinceJoin(w: World, p: Phone, r: RoomState): boolean {
  const t = kickedAt(w, r, keyOf(p));
  return t !== null && t > (Date.parse(p.save.joinedAt || '') || 0);
}

/** `apply`: the room data of the reply just given. A player applies each event through the real appliers and ring. */
function apply(w: World, p: Phone, data: Data, cursor: SaveFields | null, before: Link): void {
  if (!data) return;
  const player = p.link.at === 'live' && p.link.key === null;
  if (data.kind === 'head') {
    skewFrom(w, p, data.now);
    if (player) { write(w, p, s => { s.joinedAt = new Date(w.clock + p.srvSkew).toISOString(); }); p.sheetText = ''; } // bindJoin
    return;
  }
  const { r, after } = data;
  skewFrom(w, p, r.now);
  p.shown = { gen: p.link.gen, sheets: r.sheets, docs: r.docs };
  // sync.ts `landPage`: the page's lands and its cursor are one write. No move falls between the statements of one
  // `apply`, so a reload here finds both or neither, as a phone's one write does.
  const page = r.events.filter(e => e.seq > after).sort((a, b) => a.seq - b.seq);
  for (const ev of page) {
    if (ev.from === p.device) continue;
    if (player) applyOne(w, p, ev);
    else if (isGm(p)) { tellOne(w, p, ev); castOne(w, p, ev); callOne(w, p, ev); soloOne(w, p, ev); }
  }
  foldOffers(w, p, page);
  if (cursor) save(w, p, cursor, before);
  heard(w, p);
  flushOut(w, p);
}
const skewFrom = (w: World, p: Phone, now: string): void => { const t = Date.parse(now); if (Number.isFinite(t)) p.srvSkew = t - w.clock; };

/** A player's save with one hunter, `h1`, on device `device`: what the appliers' steps are run on (they are pure). */
const playerSave = (device: DeviceId): Save => {
  const s = freshSave({ now: new Date(0), newDeviceToken: () => 'test-device-token-0123456789abcd', newDeviceId: () => device }, { onboarded: true });
  return { ...s, settings: { ...s.settings, deviceId: device } };
};
/**
 * The real `applyRoomEvent` with `once` as in sync.ts: the applier's step and the event id in one write, the first time
 * only. A step written counts once in the ledger.
 */
function applyOne(w: World, p: Phone, ev: RoomEvent): void {
  let took = false;
  const fresh = playerSave(p.device), base: Save = { ...fresh, settings: { ...fresh.settings, sync: { ...fresh.settings.sync, outbox: [...p.save.outbox], runs: [...p.save.runs] } } };
  const deps: ApplyDeps = {
    store: { get: () => base },
    once: (eid, step) => {
      const ring = recordApplied(p.save.applied, eid);
      if (!ring) return false;
      if (!isRefused(step(base))) took = true;
      write(w, p, s => { s.applied = ring; });
      return true;
    },
    rules: () => RULES, now: () => new Date(w.clock).toISOString(), today: () => parseDayKey(new Date(w.clock).toISOString().slice(0, 10))!, toast: () => {}, system: () => {},
    hunter: { fightOf: () => null, granted: () => ({ lines: [], levelup: null, popup: null }), gmHolds: () => refuse(TOLD) },
    stepsDone: () => {},
    // coin.js `landed`: the coin's table takes the first landing of a roll
    coinLanded: (roll: RollId, side: CoinSide) => write(w, p, s => { s.coins = stepCoin(s.coins, roll, { type: 'land', side }); }),
  };
  applyRoomEvent(ev, deps);
  if (took) { p.ledger[ev.payload.eid] = (p.ledger[ev.payload.eid] ?? 0) + 1; bump(w, p); }
  // room-events.ts `landSoloAnswer`: the answer closes its waiting run in the write that lands it, and pays it when paid
  if (took && ev.type === 'soloAnswer') {
    const run = ev.payload.run;
    write(w, p, s => { s.runs = s.runs.filter(x => x.run !== run); });
    if (ev.payload.verdict === 'paid') p.paid[run] = (p.paid[run] ?? 0) + 1;
  }
}

/** The runs of `s` after a step of solo-wait.ts on a save that holds them and the outbox. */
function onRuns(s: PhoneSave, f: (x: Save) => Save): WaitingRun[] {
  const x = { settings: { sync: { outbox: s.outbox, runs: s.runs } } } as unknown as Save;
  return [...(f(x).settings.sync.runs ?? [])];
}
/**
 * gates.js on a player's phone: the bound hunter clears the room's solo gate alone. Its `soloRun` goes in the outbox and
 * the run waits for the answer, in one write (gates/solo.ts `soloRan`); one run of the gate while one waits.
 */
function soloRun(w: World, p: Phone): void {
  const code = roomOf(p.link); if (!code) return;
  const ev = newEvent('soloRun', { by: keyOf(p), gate: 'g1' as never, name: p.name, outcome: 'won', rounds: 4, life: 'up' }, { device: p.device, now: w.clock, rand: (w.made++ % 997) / 997 });
  if (!ev) return;
  const at = new Date(w.clock).toISOString();
  flushOut(w, p, s => {
    s.outbox = postIn(s.outbox, code, { kind: 'event', event: ev }).box;
    s.posted = [...s.posted, { room: code, eid: ev.payload.eid }];
    s.runs = onRuns(s, x => runPosted(x, { run: ev.payload.eid, room: code, hid: hunterIdOf(keyOf(p)), gate: 'g1' as never, name: 'Den', at, state: 'posted' }));
  });
}
/**
 * gates.js's `sync:event` handler for a player's `soloRun` on the GM's phone, with sync.ts `once`: the first won run of
 * its one solo gate clears it and is answered paid, a later one is answered taken (gates/solo.ts `soloTaken`), each in
 * one write with the run's id, so a run delivered again is answered once.
 */
function soloOne(w: World, p: Phone, ev: RoomEvent): void {
  if (ev.type !== 'soloRun') return;
  const ring = recordApplied(p.save.applied, ev.payload.eid);
  if (!ring) return;
  const open = p.save.soloGate === 'open';
  write(w, p, s => { s.applied = ring; s.soloGate = 'cleared'; });
  const base = { to: [ev.payload.by], run: ev.payload.eid, gate: 'g1', name: 'Den' };
  post(w, p, 'soloAnswer', open ? { ...base, verdict: 'paid', rewards: AWARD.rewards } : { ...base, verdict: 'refused', why: 'taken' });
}

/**
 * uses.js's `sync:event` handler on the GM's phone with sync.ts `once`: a told use writes its session log line only when
 * its event id goes into the applied ring, and the id and the line are written in one store update.
 */
function tellOne(w: World, p: Phone, ev: RoomEvent): void {
  if (ev.type !== 'used' || !ev.payload.tell) return;
  const eid = ev.payload.eid, ring = recordApplied(p.save.applied, eid);
  if (!ring) return;
  write(w, p, s => { s.applied = ring; });
  p.told[eid] = (p.told[eid] ?? 0) + 1;
}

/** The time the GM's fight starts at, in ticks, and how far one use moves it on (a standard action at speed 100). */
const FIGHT_START = 1000, USE_TICKS = 1000;
/** The GM's fight as `onTurn` reads it: running at the GM's `now`, the turn of the first player's hunter, which another phone holds. */
const fightOf = (w: World, gm: Phone): Fight => ({
  phase: 'running', now: gm.save.fightNow, currentId: 'c1', rows: [{ id: 'c1', holder: { kind: 'remote', remote: keyOf(w.phones[1]!) } }],
}) as unknown as Fight;
/**
 * combat.js's `sync:event` handler for a player's `cast` on the GM's phone: the fight takes it only when `onTurn` says it
 * is for the turn the fight is on, and a use moves the fight's time on, in the same store update.
 */
function castOne(w: World, p: Phone, ev: RoomEvent): void {
  if (ev.type !== 'cast' || onTurn(fightOf(w, p), ev.payload) === null) return;
  const at = p.save.fightNow;
  write(w, p, s => { s.fightNow = at + USE_TICKS; });
  p.acted[at] = (p.acted[at] ?? 0) + 1;
}

/**
 * coin.js's `sync:event` handler for a player's `coinCall` on the GM's phone: a call is kept once per roll (`takeCall`); a
 * call for a roll the GM already answered is answered again with the same landing, so a player whose landing was lost hears it.
 */
function callOne(w: World, p: Phone, ev: RoomEvent): void {
  if (ev.type !== 'coinCall') return;
  const c = ev.payload, held = coinOf(p.save.calls, c.roll);
  if (held?.at === 'landed') { sendLanding(w, p, held.id, held.side); return; }
  write(w, p, s => { s.calls = takeCall(s.calls, { id: c.roll, hunter: { kind: 'remote', remote: c.by }, who: c.who, what: c.what, face: c.face, call: c.call }); });
}
/** coin.js `byOf`: the sheet key of the hunter that called, read from the coin. */
const byOf = (p: Phone, c: Coin): SheetKey => (c.hunter.kind === 'local' ? sheetKeyOf(p.device, c.hunter.hunterId) : c.hunter.remote);
/** coin.js `sendCall` and `sendLanding`: posted, one message per roll; the outbox sends it again until the room takes it. */
function sendCall(w: World, p: Phone, c: Extract<Coin, { at: 'called' }>): void {
  post(w, p, 'coinCall', { by: byOf(p, c), roll: c.id, who: c.who, what: c.what, face: c.face, call: c.call }, `coin ${c.id}`);
}
function sendLanding(w: World, p: Phone, roll: RollId, side: CoinSide): void {
  post(w, p, 'coinLand', { roll, side }, `coin ${roll}`);
}
/** coin.js on a player's phone: a check shows a natural 20, the player calls heads, and the call goes to the GM. */
function coinCall(w: World, p: Phone): void {
  const id = newRollId(p.device, `r${p.save.rolled + 1}`)!;
  write(w, p, s => {
    s.rolled++;
    s.coins = stepCoin(addCoin(s.coins, { id, hunter: { kind: 'local', hunterId: hunterIdOf(keyOf(p)) }, who: p.name, what: 'STR check', face: 20, at: 'uncalled' }), id, { type: 'call', side: 'heads' });
  });
  const c = coinOf(p.save.coins, id);
  if (c?.at === 'called') sendCall(w, p, c);
}
/**
 * coin.js on the GM's phone: the oldest call of `player` answered, Right, Wrong and the coin in turn, with the flip
 * showing tails. The landing and the session log's ruling are written in one store update, then the landing is sent.
 */
function rule(w: World, p: Phone, player: Phone): void {
  const c = inAir(p.save.calls).find(x => x.id.startsWith(`${player.device}:`));
  if (c?.at !== 'called') return;
  const body = landingOf(c, RULINGS[w.made % RULINGS.length]!, 'tails');
  write(w, p, s => { s.calls = stepCoin(s.calls, c.id, { type: 'land', side: body.side }); });
  p.ruled[c.id] = (p.ruled[c.id] ?? 0) + 1;
  p.ruledOn[c.id] = { at: w.clock, page: p.page };
  sendLanding(w, p, body.roll, body.side);
}

/** The hunter changes: its counter moves on. */
function bump(w: World, p: Phone): void {
  write(w, p, s => { s.sheet++; });
}

/** `sendSheet`: PUT the bound sheet as it is now. A 403 removed is the link's to hear. */
function sendSheet(w: World, p: Phone, gen: Gen, timeoutMs: number): void {
  if (p.link.at !== 'live' || p.link.gen !== gen) { p.queue.push({ to: 'push', e: { type: 'sent', gen } }); return; } // sync.ts: a microtask
  const text = sheetJson(p), code = p.link.code, key = keyOf(p);
  p.sheetText = text;
  request(w, p, 'push', gen, code, 'sheet', timeoutMs, { method: 'PUT', path: `/rooms/${code}/sheets/${key}`, body: { from: p.device, data: { hunter: JSON.parse(text) } } }, r => {
    let e: PushEvent | LinkEvent;
    if ('none' in r) e = { type: 'failed', gen, kind: r.none satisfies FailKind };
    else {
      const why = errorOf(r);
      e = ok(r) ? { type: 'sent', gen }
        : r.status === 403 && why === 'not your sheet' ? { type: 'notYours', gen }
        : r.status === 403 ? { type: 'removed', gen }
        : r.status === 400 || r.status === 413 ? { type: 'refused', gen, why: (r.status === 400 ? 'bad' : why === 'room full' ? 'room-full' : 'too-large') satisfies RefusedWhy }
        : { type: 'failed', gen, kind: 'server' };
    }
    if (e.type === 'removed') linkDo(w, p, e as LinkEvent); else pushDo(w, p, e as PushEvent);
  });
}

// ── the outbox (sync.ts `postLetter`, `flush`, `deliver`) ──
/** sync.ts `roomOf`: the room this phone is in, or the one a create or join started from; upgrading is not modelled. */
function roomOf(l: Link): RoomCode | null {
  if (l.at === 'live') return l.code;
  if (l.at === 'creating' || l.at === 'joining') return roomOf(l.back);
  return null;
}
/** `postLetter`: the letter waits in the save for the room this phone is in, then what waits is sent. */
function postLetter(w: World, p: Phone, letter: Letter, key: string | null = null): void {
  const code = roomOf(p.link); if (!code) return;
  const was = p.save.outbox.filter(e => e.at === 'queued').map(e => e.id);
  flushOut(w, p, s => { s.outbox = postIn(s.outbox, code, letter, key).box; if (letter.kind === 'event') s.posted = [...s.posted, { room: code, eid: letter.event.payload.eid }]; });
  // a queued message a newer one of its key took the place of never reaches the room, and is owed no more
  const gone = was.filter(id => !p.save.outbox.some(e => e.id === id));
  if (gone.length) write(w, p, s => { s.posted = s.posted.filter(m => !gone.includes(m.eid)); });
}
/** `post`: a room event made by `newEvent`, posted (with `key`, one message per key while it waits). */
function post(w: World, p: Phone, type: EventType, body: unknown, key: string | null = null): void {
  const ev = newEvent(type, body as never, { device: p.device, now: w.clock, rand: (w.made++ % 997) / 997 });
  if (ev) postLetter(w, p, { kind: 'event', event: ev }, key);
}
/**
 * `flush`: `first` (a post, or a send's answer) and, in the same write, the oldest message waiting for the live room on
 * its way when none of that room is. `answered`: taken or refused, the next goes; no answer, it waits for a good poll.
 */
function flushOut(w: World, p: Phone, first: ((s: PhoneSave) => void) | null = null): void {
  const code = p.link.at === 'live' ? p.link.code : null, key = p.link.at === 'live' ? p.link.key : null;
  if (!first && (!code || !nextOut(p.save.outbox, code))) return;
  const pick: { e: Entry | null } = { e: null };
  write(w, p, s => { first?.(s); pick.e = code ? nextOut(s.outbox, code) : null; if (pick.e) s.outbox = outStep(s.outbox, pick.e.id, { type: 'send' }); });
  const out = pick.e;
  if (!out || !code) return;
  deliver(w, p, code, key, out, r => {
    const ev = sentEvent('none' in r ? { ok: false, why: 'offline' } : callOf(r.status, errorOf(r), r.data));
    if (ev.type === 'failed') write(w, p, s => { s.outbox = outStep(s.outbox, out.id, ev); });
    // sync.ts `answered`: a solo run whose message the room took is heard taken in the same write, before its letter leaves
    // and an offer's letter heard taken (trade/offer.ts `letterTaken`), in that write too
    else flushOut(w, p, s => { if (ev.type === 'sent') { s.runs = onRuns(s, x => runTaken(x, out.id)); tradeBack(p, letterTaken(tradeSave(p), out.id)); } s.outbox = outStep(s.outbox, out.id, ev); });
  });
}
/** `deliver`: an event is posted with the GM key on the GM's phone. */
function deliver(w: World, p: Phone, code: RoomCode, key: GmKey | null, e: Entry, done: (r: Reply) => void): void {
  if (e.letter.kind !== 'event') throw new Error('runner: a tombstone is not modelled');
  const ev = e.letter.event;
  request(w, p, 'box', null, code, `event ${ev.type}`, REQ_MS, { method: 'POST', path: `/rooms/${code}/events`, body: { from: p.device, type: ev.type, payload: ev.payload }, key }, done);
}

// ── what a GM sends (sync.ts `send`, `putDoc`, `kickSheet`, `allowBack`); a GM call is never aborted ──
const gmRoom = (p: Phone): { code: RoomCode; key: GmKey } | null => (p.link.at === 'live' && p.link.key !== null ? { code: p.link.code, key: p.link.key } : null);
/** `view`: the data of the last poll of this stretch of the link. */
const view = (p: Phone): Shown => (p.link.at === 'live' && p.shown.gen === p.link.gen ? p.shown : NOTHING_SHOWN);
/** The GM's roster: sheet keys and what each sheet says (`remoteSheets` without tombstones). */
export const roster = (p: Phone): Record<string, string> =>
  gmRoom(p) ? Object.fromEntries(Object.entries(view(p).sheets).flatMap(([k, s]) => ('hunter' in s.data ? [[k, JSON.stringify({ id: s.data.hunter.id, name: s.data.hunter.name })]] : []))) : {};
const kickedDoc = (p: Phone): { keys: Record<string, string>; names: Record<string, string> } => {
  const d = view(p).docs.kicked?.data;
  return { keys: { ...(d?.keys ?? {}) }, names: { ...(d?.names ?? {}) } };
};
/** `recentKicks`: what the Allow back list offers. */
export const recentKicks = (w: World, p: Phone): string[] =>
  Object.entries(kickedDoc(p).keys).filter(([, t]) => w.clock + p.srvSkew - Date.parse(t) < KICK_MS).map(([k]) => k);

/**
 * `send`: post a room event; `done` hears the seq the room gave it, or null. A player's own fight move that the room took
 * is then `sent` to the link, from the fight doc it was sent from, as sync.ts does.
 */
function send(w: World, p: Phone, type: EventType, body: unknown, done?: (ev: RoomEvent, seq: number | null) => void): RoomEvent | null {
  const ev = newEvent(type, body as never, { device: p.device, now: w.clock, rand: (w.made++ % 997) / 997 });
  if (!ev || p.link.at !== 'live') return null;
  const key = p.link.key, from = FIGHT_MOVES.has(ev.type) ? view(p).docs.fight?.data.at ?? null : undefined;
  request(w, p, 'gm', p.link.gen, p.link.code, `event ${type}`, REQ_MS, { method: 'POST', path: `/rooms/${p.link.code}/events`, body: { from: p.device, type: ev.type, payload: ev.payload }, key }, r => {
    const seq = seqOf(r);
    if (seq !== null && from !== undefined) linkDo(w, p, { type: 'sent', from });
    done?.(ev, seq);
  });
  return ev;
}
/** As in src/edge/sync.ts: a player's own moves in the GM's fight. */
const FIGHT_MOVES: ReadonlySet<string> = new Set(['step', 'cast', 'pass']);
const seqOf = (r: Reply): number | null => (ok(r) && 'data' in r && isObj(r.data) && Number.isSafeInteger(r.data.seq) && (r.data.seq as number) > 0 ? (r.data.seq as number) : null);
/**
 * A GM's message to a player's hunter, posted to the outbox as the GM's phone posts every one (gm.js's award and
 * statuses, quests.js's chain step, combat.js `sendVitals`). The totals are posted under the hunter's key, so only the
 * latest waits while the phone is away.
 */
function sendTo(w: World, p: Phone, type: 'award' | 'status' | 'chain' | 'vitals', k: SheetKey, body: unknown): void {
  if (p.link.at !== 'live') return;
  post(w, p, type, body, type === 'vitals' ? `vitals ${k}` : null);
}
/** `kickSheet`: one request; the server records the removal in `_kicked` itself. */
function kick(w: World, p: Phone, key: SheetKey): void {
  const gm = gmRoom(p), gen = p.link.gen; if (!gm) return;
  request(w, p, 'gm', gen, gm.code, 'kick', REQ_MS, { method: 'DELETE', path: `/rooms/${gm.code}/sheets/${key}`, key: gm.key }, r => {
    if (!ok(r)) return;
    if (p.shown.gen === gen && p.link.gen === gen) { const sheets = { ...p.shown.sheets }; delete sheets[key]; p.shown = { ...p.shown, sheets }; }
    showKicked(w, p, r, gen);
    w.told[key] = { state: 'removed', room: gm.code, at: w.clock };
  });
}
/** `allowBack`: one request; the server lifts its block and the `_kicked` entry. */
function allowBack(w: World, p: Phone, key: SheetKey): void {
  const gm = gmRoom(p), gen = p.link.gen; if (!gm) return;
  request(w, p, 'gm', gen, gm.code, 'allow back', REQ_MS, { method: 'DELETE', path: `/rooms/${gm.code}/kicks/${key}`, key: gm.key }, r => {
    if (!ok(r)) return;
    showKicked(w, p, r, gen);
    w.told[key] = { state: 'allowed', room: gm.code, at: w.clock };
  });
}
/** `showKicked`. */
function showKicked(w: World, p: Phone, r: Reply, gen: Gen): void {
  const data = 'status' in r && isObj(r.data) ? DOCS.kicked(r.data.kicked) : null;
  if (!data || p.shown.gen !== gen || p.link.gen !== gen) return;
  p.shown = { ...p.shown, docs: { ...p.shown.docs, kicked: { at: new Date(w.clock + p.srvSkew).toISOString(), from: p.device, data } } };
}

// ── taps ──
/** `begin`: a Create or Join tap; one while another is out is answered `busy` and starts nothing. */
function begin(w: World, p: Phone, tap: RoomTap): void {
  attemptDo(w, p, { type: 'tap', tap, who: NOBODY, reply: null });
}
/** A reload: the save stays, everything in memory goes, and the requests of the old page are heard by nobody. */
function reload(w: World, p: Phone): void {
  for (const r of w.pending) if (r.phone === p.i) r.dead = true;
  Object.assign(p, { page: p.page + 1, push: PUSH_OFF, attempt: NO_ATTEMPT, sheetText: '', shown: NOTHING_SHOWN, srvSkew: 0, timers: {}, queue: [], running: false });
  if (p.offline) linkDo(w, p, { type: 'offline' });
  startPage(w, p);
}
/** sync.ts `joining`: a join of `code`, reading on from where this phone stopped when it last went out of that room. */
const joining = (w: World, p: Phone, code: RoomCode): Extract<LinkEvent, { type: 'join' }> =>
  ({ type: 'join', code, key: p.save.gmKeys[code] ?? null, from: seenFrom(p.save.seen, code, w.clock + p.srvSkew) });
/** The room code a player can type: the room the GM's phone is in, read off the GM's screen. */
const invite = (w: World): RoomCode | null => (w.phones[0]!.link.at === 'live' ? (w.phones[0]!.link as { code: RoomCode }).code : null);

const AWARD = { rewards: { xp: 10 } };
/** A told item a player's phone reports (uses.js `report`): the GM logs it. */
const USED = { who: 'Mira', what: 'item', name: 'Flash Bomb', text: 'Blinds a foe.', target: 'self', tell: true };
const STATUS = { add: [{ key: 'marked', rounds: 3, def: { label: 'Marked', desc: '', ops: [] }, source: { id: null, tier: 0 } }], remove: [], reason: '' };
/** The fight's totals for a player's hunter (combat.js carries out the fight's `sendRemote` effect as a `vitals` message). */
const VITALS = { life: { at: 'up', hp: 12 }, mana: 3, fatigue: 20, statuses: [] };
/** A story's chapter as the GM's phone opens it for a player's hunter: a window, a point, and a quest from the GM. */
const CHAPTER = { words: { title: 'THE DEEP HAS NOTICED YOU', line: '' }, rewards: { xp: 0, points: 1, gold: 0, items: [], title: null, job: null, skills: [], statuses: [], boons: [] },
  quest: { kind: 'side', title: 'Find it', desc: '', objectives: [], rewards: { xp: 0, points: 0, gold: 0, items: [], title: null, job: null, skills: [], statuses: [], boons: [] }, dueAt: null, penaltyText: '' } };
/** A shadow risen for a player's hunter (shadows.js on the GM's phone posts it with the fight's `extract`). */
const RISEN = { rank: 'E', archetype: 'brute', grade: 'Normal', monster: null, name: 'Wolf' };

// ── the moves ──
/**
 * A move is a word, so a sequence can be printed, replayed and shrunk. A move that cannot happen in a world (a reply
 * when nothing is out, a kick of a sheet the GM does not see) is not enabled there; a replay skips it.
 */
export type Move = string;
const TAPS_GM = ['create', 'leave', 'rejoin', 'reload'] as const;
const TAPS_PLAYER = ['join', 'leave', 'reload', 'edit', 'forbidden', 'use', 'cast', 'coin', 'arm', 'solo', 'offline', 'online'] as const;
/** What the GM does to a player whose sheet it sees (`gm award kai`); `gm allow` has its own condition in `enabled`. */
const GM_TO = ['award', 'status', 'chain', 'vitals', 'spent', 'shadow', 'noted', 'chapter', 'settle', 'kick'] as const;
const LANES: Lane[] = ['link', 'push', 'gm', 'box'];

const live = (w: World, p: Phone): Pending[] => w.pending.filter(r => r.phone === p.i && !r.dead);
const oldest = (w: World, p: Phone, lane: Lane, stage?: 'out' | 'back'): Pending | undefined =>
  live(w, p).find(r => r.lane === lane && (stage === undefined || r.stage === stage) && (stage !== 'out' || w.clock - r.sentAt <= r.timeoutMs));
const lateOne = (w: World, p: Phone): Pending | undefined => w.pending.find(r => r.phone === p.i && r.dead && r.stage === 'out' && w.clock - r.sentAt <= r.timeoutMs);
const phoneNamed = (w: World, name: string): Phone | undefined => w.phones.find(p => p.name === name);

/** Every move that does something in `w`, in a fixed order. */
export function enabled(w: World): Move[] {
  const out: Move[] = [];
  const gm = w.phones[0]!;
  for (const t of TAPS_GM) out.push(`gm ${t}`);
  for (const p of w.phones.slice(1)) {
    const net = (t: string) => (t === 'offline' ? !p.offline : t === 'online' ? p.offline : true);
    // a use goes in the outbox while the phone is in a room, live or not (uses.js `report`, sync.ts `room`)
    const inRoom = (t: string) => (t === 'use' ? roomOf(p.link) !== null : (t !== 'forbidden' && t !== 'use' && t !== 'cast' && t !== 'coin' && t !== 'arm' && t !== 'solo') || p.link.at === 'live');
    // gates/solo.ts `soloReady`: no second run of the gate while one waits for its answer
    const free = (t: string) => t !== 'solo' || p.link.at !== 'live' || !waitingGates({ settings: { sync: { outbox: p.save.outbox, runs: p.save.runs } } } as unknown as Save, p.link.code, 'h1').length;
    for (const t of TAPS_PLAYER) if ((t !== 'join' || invite(w)) && net(t) && inRoom(t) && free(t)) out.push(`${p.name} ${t}`);
    // a trade between the two players (notes-5-trade.md 1.8): player 1 offers player 2 a token, asking 5 gold or nothing;
    // each tap is enabled where it would be written, in a room, live or not (an offer waits in the outbox as a use does)
    if (w.phones.length === 3 && roomOf(p.link)) for (const t of TRADE_TAPS) if ((t !== 'offer' || p.i === 1) && !('ok' in tradeTap(w, p, t))) out.push(`${p.name} ${t}`);
    const k = keyOf(p);
    if (p.i === 1 && gm.save.offers.length && roomOf(gm.link) && !('ok' in tradeTap(w, gm, 'stop'))) out.push('gm stop');
    if (gmRoom(gm) && inAir(gm.save.calls).some(c => c.id.startsWith(`${p.device}:`))) out.push(`gm rule ${p.name}`);
    if (roster(gm)[k] !== undefined) for (const a of GM_TO) out.push(`gm ${a} ${p.name}`);
    if (recentKicks(w, gm).includes(k)) out.push(`gm allow ${p.name}`);
  }
  for (const p of w.phones) {
    for (const lane of LANES) {
      if (oldest(w, p, lane, 'out') && !p.offline) out.push(`${p.name} serve ${lane}`);
      if (oldest(w, p, lane, 'back')) out.push(`${p.name} answer ${lane}`);
      if (oldest(w, p, lane)) out.push(`${p.name} drop ${lane}`);
    }
    if (oldest(w, p, 'gm', 'out') && !p.offline) out.push(`${p.name} dup gm`);
    if (oldest(w, p, 'box', 'out') && !p.offline) out.push(`${p.name} dup box`);
    if (lateOne(w, p) && !p.offline) out.push(`${p.name} late`);
    for (const t of ['poll', 'push'] as const) if (p.timers[t] !== undefined) out.push(`${p.name} timer ${t}`);
  }
  return out;
}

async function serve(w: World, r: Pending): Promise<Answer> {
  const { method, path, body, key, prove } = r.http;
  const headers: Record<string, string> = { 'x-hunter-build': w.build };
  const p = w.phones[r.phone]!;
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (key) headers['x-gm-key'] = key;
  if ((body !== undefined || prove) && !key) headers['x-device-token'] = p.token;
  const res = await handler(new Request('http://test/api' + path, { method, headers, body: body === undefined ? null : JSON.stringify(body) }));
  let data: unknown = null;
  try { data = await res.json(); } catch { /* no body */ }
  const a = { status: res.status, data };
  if (a.status >= 200 && a.status < 300) {
    // the server keeps the first event of an id and answers a later one with its seq
    if (method === 'POST' && path.endsWith('/events') && isObj(body)) { const ev = { type: body.type, payload: body.payload } as RoomEvent; w.stored[ev.payload.eid] ??= ev; }
    if (r.lane === 'push') { const k = path.split('/').pop()!, list = (w.writers[k] ??= []); if (!list.includes(p.i)) list.push(p.i); }
    if (p.i !== 0 && (r.lane === 'gm' || r.lane === 'box') && r.what !== 'event used' && r.what !== 'event cast' && r.what !== 'event coinCall' && r.what !== 'event arm' && r.what !== 'event soloRun' && r.what !== 'event offer' && r.what !== 'event offerEnd') w.broken.push(`the server took a GM-only ${r.what} from ${p.name}`);
  }
  return a;
}
/** A snapshot of what a phone shows and keeps, for "a reply for a room the phone has left changes nothing". */
const seen = (p: Phone): string => JSON.stringify({ link: p.link, push: p.push, save: p.save, ledger: p.ledger, paid: p.paid, shown: p.shown, timers: p.timers, notices: p.notices });
/** The link has left the stretch the request was sent in (a leave, a rejoin, another room: each takes a new gen). */
const leftFor = (p: Phone, r: Pending): boolean => r.gen !== null && p.link.gen !== r.gen;
function hear(w: World, r: Pending, reply: Reply): void {
  const p = w.phones[r.phone]!;
  if (r.dead) return;
  const left = leftFor(p, r), before = left ? seen(p) : '';
  r.reply(reply);
  if (left && seen(p) !== before) w.broken.push(`a reply to ${p.name}'s ${r.what} for a room it had left changed the phone`);
}

/** Plays one move. Answers false when it is not enabled in `w`. */
export async function play(w: World, move: Move): Promise<boolean> {
  if (!enabled(w).includes(move)) return false;
  const [who, verb, arg] = move.split(' ') as [string, string, string | undefined];
  const p = phoneNamed(w, who)!;
  switch (verb) {
    case 'create': begin(w, p, { type: 'create' }); break;
    case 'rejoin': { const code = p.save.room ?? p.save.last?.code; if (code) begin(w, p, joining(w, p, code)); break; }
    case 'join': { const code = invite(w)!; begin(w, p, joining(w, p, code)); break; }
    case 'leave': linkDo(w, p, { type: 'leave' }); break;
    case 'reload': reload(w, p); break;
    case 'edit': bump(w, p); break;
    case 'forbidden': send(w, p, 'award', { to: [keyOf(p)], ...AWARD }); break;
    // a player's told use (uses.js `report`) is posted: kept in the save until the room takes it
    case 'use': post(w, p, 'used', { by: keyOf(p), ...USED }); break;
    case 'offline': p.offline = true; linkDo(w, p, { type: 'offline' }); break;
    case 'online': p.offline = false; linkDo(w, p, { type: 'online' }); break;
    // a strike at the time the GM's fight is at as the player's table shows it (read off the GM's phone, as `invite` reads the code)
    case 'cast': post(w, p, 'cast', { by: keyOf(p), ability: 'strike', aim: 'c2', at: w.phones[0]!.save.fightNow, dice: [4] }); break;
    case 'coin': coinCall(w, p); break;
    case 'solo': soloRun(w, p); break;
    // a player arms its hunter's reaction (kits design 8.4.2): taken at any time, it changes nothing but its own row
    case 'arm': post(w, p, 'arm', { by: keyOf(p), ability: 'parry', on: null }); break;
    case 'rule': rule(w, p, phoneNamed(w, arg!)!); break;
    case 'offer': case 'accept': case 'refuse': case 'withdraw': case 'stop': {
      // a stranded record taken back after the window: its goods come back though the other side may hold them (1.10)
      const back = verb === 'withdraw' ? takeBackOf(p) : undefined;
      if (back?.state === 'stranded' && 'aside' in back) w.reclaimed.push(back.aside);
      trade(w, p, () => tradeTap(w, p, verb, (w.made++ % 997) / 997));
      flushOut(w, p);
      break;
    }
    case 'award': case 'status': case 'chain': case 'vitals': case 'spent': case 'shadow': case 'noted': case 'chapter': case 'settle': case 'kick': case 'allow': {
      const k = keyOf(phoneNamed(w, arg!)!);
      // a fight's end (pay.ts `settleEncounter`) puts the player's award in the GM's outbox
      if (verb === 'settle') { post(w, p, 'award', { to: [k], ...AWARD }); break; }
      // the GM's fight took the player's item use: its `spent` goes in the outbox in the write of the use (fight-save.ts
      // `fought`), with no key, so later totals never replace it
      if (verb === 'spent') { post(w, p, 'spent', { to: [k], item: 'i1' }); break; }
      // the GM's phone rolled the player's Necromancer's extraction and the shadow rose: its `shadow` goes in the outbox in
      // the write of the fight's `extract` (fight-save.ts `fought`), with no key
      if (verb === 'shadow') { post(w, p, 'shadow', { to: [k], shadow: RISEN }); break; }
      // the GM's fight ended or a Clear paid the player's hunter: what it did goes in the outbox as `noted` in that write
      // (fight-save.ts `fought`, gates.js's Clear), with no key
      if (verb === 'noted') { post(w, p, 'noted', { to: [k], facts: [{ kind: 'gate', name: 'Goblin Den', rank: 'E', above: 0, toBreak: 3 }] }); break; }
      // the GM opened a story's chapter for the player's hunter: its `chapter` goes in the outbox in the write of the open
      // (story/run.ts `storyMove`), with no key
      if (verb === 'chapter') { post(w, p, 'chapter', { to: [k], ...CHAPTER }); break; }
      if (verb === 'award') sendTo(w, p, 'award', k, { to: [k], ...AWARD });
      else if (verb === 'vitals') sendTo(w, p, 'vitals', k, { to: [k], ...VITALS });
      else if (verb === 'chain') sendTo(w, p, 'chain', k, { to: [k], job: 'Ranger', kind: 'issue' });
      else if (verb === 'status') sendTo(w, p, 'status', k, { to: [k], ...STATUS });
      else if (verb === 'kick') kick(w, p, k);
      else allowBack(w, p, k);
      break;
    }
    case 'timer': {
      const name = arg as 'poll' | 'push';
      w.clock = Math.max(w.clock, p.timers[name]!);
      delete p.timers[name];
      if (name === 'poll') linkDo(w, p, { type: 'timerFired', name }); else pushDo(w, p, { type: 'timerFired', name });
      break;
    }
    case 'serve': case 'dup': { const r = oldest(w, p, arg as Lane ?? 'gm', 'out')!; const a = await serve(w, r); if (verb === 'serve') { r.stage = 'back'; r.answer = a; } break; }
    case 'answer': { const r = oldest(w, p, arg as Lane, 'back')!; w.pending.splice(w.pending.indexOf(r), 1); hear(w, r, r.answer!); break; }
    case 'drop': {
      const r = oldest(w, p, arg as Lane)!;
      w.pending.splice(w.pending.indexOf(r), 1);
      if (r.stage === 'back') w.clock = Math.max(w.clock, r.sentAt + r.timeoutMs);
      hear(w, r, { none: r.stage === 'out' ? 'net' : 'timeout' });
      break;
    }
    case 'late': {
      const r = lateOne(w, p)!;
      await serve(w, r);
      w.pending.splice(w.pending.indexOf(r), 1);
      // The edge drops this answer (its gen was aborted, or its page is gone). The machines must drop it too: probe every
      // reply kind of that gen against the phone's link and push, without carrying anything out.
      if (r.lane !== 'gm' && r.gen !== null && r.page === p.page) {
        for (const ev of ALL_REPLIES(r.gen)) {
          const out = ev.to === 'link' ? linkReduce(p.link, ev.e) : pushReduce(p.push, ev.e);
          if (out.state !== (ev.to === 'link' ? p.link : p.push) || out.effects.length) w.broken.push(`a stale ${ev.e.type} for ${p.name}'s dropped ${r.what} changed its ${ev.to}`);
        }
      }
      break;
    }
  }
  w.clock += 1;
  w.pending = w.pending.filter(r => !r.dead || (r.stage === 'out' && w.clock - r.sentAt <= r.timeoutMs));
  return true;
}

/**
 * Quiet: the network stops losing things. Every request out is served and answered (one past its timeout is lost as a
 * network error, as the phone would see it), then every push timer and every poll timer fires, `rounds` times. A player
 * the GM allowed back taps Rejoin after the first round, as the REMOVED window offers.
 */
export async function quiet(w: World, rounds: number): Promise<void> {
  for (const p of w.phones) if (p.offline) await play(w, `${p.name} online`);
  for (let i = 0; i < rounds; i++) {
    await flush(w);
    for (const t of ['push', 'poll'] as const) {
      for (const p of w.phones) if (p.timers[t] !== undefined) { await play(w, `${p.name} timer ${t}`); await flush(w); }
    }
    if (i === 0) {
      for (const p of w.phones.slice(1)) {
        const code = invite(w);
        if (code && w.told[keyOf(p)]?.state === 'allowed' && w.told[keyOf(p)]!.room === code && !(p.link.at === 'live' && p.link.code === code)) { await play(w, `${p.name} join`); await flush(w); }
      }
    }
  }
}
async function flush(w: World): Promise<void> {
  for (let guard = 0; guard < 500; guard++) {
    const r = w.pending.find(x => !x.dead) ?? w.pending.find(x => x.dead && x.stage === 'out');
    if (!r) return;
    const p = w.phones[r.phone]!;
    if (r.dead) await play(w, `${p.name} late`);
    else if (r.stage === 'back') await play(w, `${p.name} answer ${r.lane}`);
    else if (w.clock - r.sentAt <= r.timeoutMs) await play(w, `${p.name} serve ${r.lane}`);
    else await play(w, `${p.name} drop ${r.lane}`);
  }
  throw new Error('runner: the network never went quiet');
}

/** What the server holds for a room, read whole with the room's GM key (it only renews the room's expiry). */
export async function probe(w: World, code: RoomCode): Promise<RoomState | null> {
  const res = await handler(new Request(`http://test/api/rooms/${code}?after=0`, { headers: { 'x-hunter-build': w.build, 'x-gm-key': w.keys[code] ?? '' } }));
  return res.status === 200 ? parseRoomState(await res.json()) : null;
}
