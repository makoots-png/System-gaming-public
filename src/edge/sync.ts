// sync.ts: the campaign-room edge. With no server (static host, file://) everything stays local and silent.
// The link to the room and the sheet push are two pure machines (src/core/sync/link.ts, push.ts), and each room doc the
// GM's phone publishes is one of a third (publish.ts). This file holds the current state of each, feeds them events
// (taps, timers, the page, server replies) and carries out their effects. Every
// `app.api.sync` answer is a selector over the two states (src/core/sync/connection.ts). What this phone owes the room
// (room events and tombstones) is the outbox in the save (src/core/sync/outbox.ts), sent from here after each good poll.
// The room pill (src/views/room-pill.ts) and the Room view draw what it answers.
//
// State this file owns, all inside `register`. The lint rule in tests/lint.test.ts allows these `let`s and no other:
//   link, push      the two machines
//   attempt         the Create or Join tap machine (src/core/sync/attempt.ts): the tap in progress, so its promise
//                   answers the view that made it, and who a player's join is for
//   shown           the room data of the last applied poll, tagged with the link gen it belongs to
//   srvSkew         server clock minus this clock, from the last answer that carried the server's time
//   lastOk          when the server last answered (the Room view's "Last sync")
//   sheetText       the bound sheet as the push last sent it, to tell a sheet change from any other change
//   boundSeen       the bound hunter as the push was last told of it, so another hunter bound by any write (a join,
//                   "Play as", a delete of the bound one, a save swapped in) wakes the push as `rebound` (`bindHeard`)
//   removal         the REMOVED FROM ROOM notice (src/core/sync/bind.ts `RemovedNotice`): told, or its Rejoin on its
//                   way, tied to its room
//   invited         the room of the invite link this tab was opened with, until it is joined, dropped, or spent by
//                   the link being live in its room (`spendInvite`)
//   running         effects are being carried out (events raised meanwhile wait in `queue`)
//   stamped         the time in the id of the last event this page made (`stampTime` in src/core/protocol.ts), so the
//                   next id is later and two ids of this page never meet
// and these containers, each named where it is made: `queue` (events raised while effects run), `inflight` (open
// requests by gen: the link's, each doc's put and each outbox send), `timers` (one per name), `peeked` (the Room view's
// 30 s code check cache), `publishers`, `publishing` (each room doc's publish machine on the GM's phone,
// src/core/sync/publish.ts).
// The save fields `room`, `cursor`, `lastRoom`, `gmKey` and `seen` (where this phone stopped reading a room it went out
// of, src/core/sync/seen.ts) are written only by the link's `save` effect, here; a poll page's cursor is written in the
// same write as what the page's events land on a player's phone and what the page says of offers on every phone (`apply`,
// `landPage`), so a reload never finds one without the other.
// The save's `outbox` only here, with a step of src/core/sync/outbox.ts (`boxDo`, and `rebound` at a bind).
import { addHunter, setActive } from '../core/party.ts';
import { stepTime } from '../core/day.ts';
import { BUILD } from './build.ts';
import { reported } from './report.ts';
import { bindRoom } from './rules.ts';
import { awayDeps, landAll } from './room-events.ts';
import type { ApplyDeps, PageLanded } from './room-events.ts';
import { STUCK_TEXT, upgradeRefused } from './upgrade.ts';
import type { store as Store } from './store.ts';
import { bindNotice } from './store.ts';
import { released } from '../core/hunter/noticed.ts';
import { fightHold } from '../core/combat/fight-save.ts';
import type { Bus } from './bus.ts';
import type { Rules } from '../core/rules.ts';
import type { Seat } from '../core/role.ts';
import type { AppApi, RemoteSheet, SyncApi } from '../core/api.ts';
import { DOCS, DOC_MAX, REMOVED_MS, SHEET_MAX, newEvent, parseRoomCode, parseRoomState, stampTime } from '../core/protocol.ts';
import type { DeviceId, DocName, DocOf, EventBody, EventType, RoomCode, RoomDocs, RoomEvent, RoomState, ServedSheet, SheetKey, Stored, StoredEvent } from '../core/protocol.ts';
import { deviceOf, endIdOf, hunterIdOf, parseSheetKey, sheetKeyOf } from '../core/ids.ts';
import type { HunterId } from '../core/ids.ts';
import { appliedOnce } from '../core/applied.ts';
import { seenFrom } from '../core/sync/seen.ts';
import { boot, hiddenWait, paceOf, reduce as linkReduce } from '../core/sync/link.ts';
import { notifying } from './notify.ts';
import type { BootInput, FailKind, Gen, GmKey, Last, Link, LinkCall, LinkEffect, LinkEvent, LinkNotice, SaveFields } from '../core/sync/link.ts';
import { PUSH_OFF, pushedSheet, reduce as pushReduce } from '../core/sync/push.ts';
import type { Push, PushEffect, PushEvent, RefusedWhy } from '../core/sync/push.ts';
import { PUBLISH_IDLE, publishStep, publishWait } from '../core/sync/publish.ts';
import type { Publish, PublishEvent, PutAnswer } from '../core/sync/publish.ts';
import { connection } from '../core/sync/connection.ts';
import type { Connection } from '../core/sync/connection.ts';
import { parseInvite } from '../core/sync/invite.ts';
import type { TapKind } from '../core/sync/taps.ts';
import { NOBODY, NO_ATTEMPT, attemptStep, joinBinds } from '../core/sync/attempt.ts';
import type { Attempt, AttemptEvent, JoinBinds, JoinFor, RoomTap } from '../core/sync/attempt.ts';
import { NO_REMOVAL, atSync, boundTo, joinedAt, linkSaved, playAs, playAsAnswered, removedStep, ringGone, serverSeen } from '../core/sync/bind.ts';
import type { BindAnswer, BindAsked, RemovedEvent, RemovedNotice } from '../core/sync/bind.ts';
import { refuse } from '../core/save-step.ts';
import { READ_ONLY } from '../core/store-life.ts';
import { runTaken, runsGone } from '../core/gates/solo-wait.ts';
import { closeNews, letterTaken, offersGone, offersSeen } from '../core/trade/offer.ts';
import type { OfferNews } from '../core/trade/offer.ts';
import { told } from '../core/session-log.ts';
import { atOutbox, callOf, next as nextOut, post as postIn, rebound, reloaded, roomGone, sentEvent, stalled, step as outStep, waiting } from '../core/sync/outbox.ts';
import type { Call, Entry, EntryEvent, Letter, Outbox } from '../core/sync/outbox.ts';
import type { Hunter, LastRoom, Save, SyncSettings } from '../core/save.ts';

/** The body of the one window that tells a player what the room held for its hunters while its phone was out of the room. */
const AWAY_BODY = 'These were sent while this phone was out of the room.';
/** A request outside the machines (an event, a doc, a GM action, a tombstone, the code check) is given up after this. */
const REQ_MS = 20000;
/** The Room view's code check reuses an answer this long, so typing and retyping a code asks the server once. */
const PEEK_REUSE_MS = 30000;
/** The GM's `_kicked` doc: a removal younger than this keeps the player out (server.ts refuses the sheet for 20 s). */
const KICK_MS = REMOVED_MS;
/** A device on the GM's roster that polled within this is online, else away. */
const ONLINE_MS = 15000;
/**
 * A player's own moves in the GM's fight (protocol.ts `onTurn`) and its death saves there, after which the link chases
 * the answer: the fight doc the GM's phone writes after taking it.
 */
const FIGHT_MOVES: ReadonlySet<string> = new Set(['step', 'cast', 'pass', 'deathSave']);
/** The docs a GM phone writes (the server writes `kicked`). */
type PublishedDoc = Exclude<DocName, 'kicked'>;
/**
 * What two docs of a kind must share to say the same. When one was written never counts, nor the order of a world's
 * gates: two GM phones list them each in their own order, and would otherwise put the world back and forth.
 */
const SAME: { [K in PublishedDoc]: (d: DocOf<K>) => unknown } = {
  fight: d => ({ ...d, at: '' }),
  codex: d => ({ ...d, at: '' }),
  rules: d => d,
  world: d => ({ ...d, gates: [...d.gates].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)) }),
  solo: d => d,
  feats: d => d,
};
const sameDoc = <K extends PublishedDoc>(name: K, a: DocOf<K>, b: DocOf<K>): boolean => {
  const same = SAME[name] as (d: DocOf<K>) => unknown;
  return JSON.stringify(same(a)) === JSON.stringify(same(b));
};

/** A server answer: its status and its JSON body, or the request never got one. */
type Answer = { status: number; data: unknown };
class NoAnswer extends Error { constructor(readonly kind: 'net' | 'timeout') { super(kind); } }
/**
 * What a request that threw tells the machines. `NoAnswer` is the network's; any other throw is a bug of this phone's
 * request (a body that does not stringify, a step that throws), logged once, and the request counts as the server's
 * failure so the link backs off as it would for a 500 rather than stalling.
 */
const failKind = (e: unknown): FailKind => { if (e instanceof NoAnswer) return e.kind; reported('sync', e); return 'server'; };
const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const errorOf = (a: Answer): string => (isObj(a.data) && typeof a.data.error === 'string' ? a.data.error : '');
/** A server error answer, as the views read it (`status`, `reason`). */
const httpError = (a: Answer): Error & { status: number; reason: string } => Object.assign(new Error(`HTTP ${a.status}`), { status: a.status, reason: errorOf(a) });
/** What a failed Create or Join tap rejects with: why it failed (src/core/sync/taps.ts), which the views word with `tapWords`. */
class TapError extends Error {
  constructor(readonly kind: TapKind) { super(kind); }
}
const tapError = (kind: TapKind): TapError => new TapError(kind);
/**
 * A Create or Join tap's promise rejects only with a `TapError`, whose kind the views turn into words. Anything else
 * thrown on the way is a bug of this phone, logged once; the tap then fails as `net`, so the view says it did not work.
 */
const tapped = <A extends unknown[], T>(f: (...a: A) => Promise<T>) => (...a: A): Promise<T> =>
  f(...a).catch((e: unknown) => { if (e instanceof TapError) throw e; reported('sync', e); throw tapError('net'); });
/** How the tap machine answers a tap's promise. */
type Reply = { resolve(v: string): void; reject(e: TapError): void };
/** The room data of one poll answer, for the link gen it was applied in. */
type Shown = { gen: Gen | null; sheets: Record<SheetKey, Stored<ServedSheet>>; docs: RoomDocs; presence: Record<string, string>; presenceOk: boolean };
const NOTHING_SHOWN: Shown = { gen: null, sheets: {}, docs: {}, presence: {}, presenceOk: false };
/** A reply and the room data that came with it, for the `apply` effect. */
type Data = { kind: 'poll'; r: RoomState; after: number } | { kind: 'head'; now: string } | null;

/** A System window this file opens: its words, and the actions a player picks from (it answers the value tapped). */
type SyncWindow = {
  tag: string; title: string; kind: string; body: string; lines?: string[]; rewards?: string[];
  actions?: { label: string; value: unknown; cancel?: boolean; primary?: boolean }[];
};
/**
 * What this file uses of the app object src/app.js hands to `register`: the bus, the store, the rules, every module's
 * `app.api`, the seat, the way to a view, the build id it sets, and the toast, the System window and `wrote` (a refused
 * write told by its kind) of src/views/ui.js.
 * The `App` of src/views/app.ts has all of it, and app.js's call of `register` is checked against this type
 * (tsconfig.views.json). The edge names what it uses so it imports nothing from the views.
 */
export type SyncHost = Bus & {
  store: typeof Store;
  rules(): Rules;
  api: AppApi;
  seat(): Seat;
  go(id: string): void;
  build?: string;
  ui: { toast(tag: string, text: string, opts?: { kind: string }): void; system(w: SyncWindow): Promise<unknown>; wrote(tag: string, w: ReturnType<typeof Store.apply>): boolean };
};

export function register(app: SyncHost): void {
  const { store, ui } = app;
  const sy = (): SyncSettings => store.get().settings.sync;
  const deviceId = (): DeviceId => store.get().settings.deviceId;
  const web = /^https?:$/.test(location.protocol);
  app.build = BUILD;

  // ── the network ──
  /**
   * One request to the API. Answers the status and body, or throws `NoAnswer` (no HTTP answer, the service worker's
   * offline answer, or `timeoutMs` passed). A room answer of 426 `upgrade` is handed to the link here, whoever asked.
   * `prove`: a read that says which phone asks (the room's poll and head) carries the device token, so the server serves
   * this phone's own sheets whole and the messages sealed to its hunters (protocol.ts `servedTo`). A write always carries
   * it; the GM's key stands in for it.
   */
  async function fetchApi(method: string, path: string, o: { body?: unknown; key?: string | null; prove?: boolean; signal?: AbortSignal; timeoutMs?: number } = {}): Promise<Answer> {
    const rooms = path.startsWith('/rooms');
    const hd: Record<string, string> = {};
    if (rooms) hd['X-Hunter-Build'] = BUILD;
    if (o.body !== undefined) hd['Content-Type'] = 'application/json';
    if (o.key) hd['X-GM-Key'] = o.key;
    if ((o.body !== undefined || o.prove) && !o.key) hd['X-Device-Token'] = sy().deviceToken; // made at load (save.ts), read only here
    const ac = new AbortController(), timer = setTimeout(() => ac.abort(), o.timeoutMs ?? REQ_MS);
    const outer = o.signal, stop = () => ac.abort();
    outer?.addEventListener('abort', stop);
    try {
      let res: Response;
      try {
        res = await fetch('/api' + path, { method, headers: hd, body: o.body === undefined ? null : JSON.stringify(o.body), cache: 'no-store', signal: ac.signal });
      } catch { throw new NoAnswer(ac.signal.aborted && !outer?.aborted ? 'timeout' : 'net'); } // fetch rejects only when no answer came: offline or aborted
      let data: unknown = null;
      try { data = await res.json(); } catch { if (ac.signal.aborted) throw new NoAnswer(outer?.aborted ? 'net' : 'timeout'); } // a body that is not JSON (a proxy's page): the status decides
      if (isObj(data) && data.offline) throw new NoAnswer('net'); // sw.js answers 200 {offline:true} when the network is down
      lastOk = Date.now();
      if (rooms && res.status === 426 && isObj(data) && data.error === 'upgrade') upgrade(String(data.build));
      return { status: res.status, data };
    } finally { clearTimeout(timer); outer?.removeEventListener('abort', stop); }
  }
  /** Another build's server answered: the link stops for good, and the tab reloads once or says it is stuck. */
  function upgrade(serverBuild: string): void {
    if (link.at === 'upgrading') return;
    linkDo({ type: 'upgrade', stuck: false });
    void upgradeRefused(serverBuild, () => linkDo({ type: 'upgrade', stuck: true }));
  }
  /**
   * A request outside the machines, answered as a `Call` (src/core/sync/outbox.ts): taken, offline, refused with the
   * server's reason, or the server's failure. Once the link is upgrading nothing is asked: the app reloads.
   */
  async function call(method: string, path: string, body?: unknown, key?: string | null, signal?: AbortSignal): Promise<Call> {
    if (link.at === 'upgrading') return { ok: false, why: 'server' };
    let a: Answer;
    try { a = await fetchApi(method, path, { body, key: key ?? null, ...(signal ? { signal } : {}) }); } catch (e) { return { ok: false, why: failKind(e) === 'server' ? 'server' : 'offline' }; }
    return callOf(a.status, errorOf(a), a.data);
  }

  // ── the two machines ──
  const nav = web && performance.getEntriesByType ? (performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined) : undefined;
  const tagged = !!nav && (nav.serverTiming || []).some(t => t.name === 'hunter-api');
  const storedLast = (l: LastRoom | null | undefined): Last => {
    const code = l ? parseRoomCode(l.code) : null;
    return code && l ? { code, why: l.why } : null;
  };
  /**
   * The room the save holds, as the link reads it at boot and after the save is replaced. None in a tab that may not
   * write its save: it takes no part in a room (link.ts `readOnly`), and its save keeps the room for a tab that may.
   */
  const storedRoom = (): BootInput['room'] => {
    const code = sy().room && !store.readOnly ? parseRoomCode(sy().room) : null;
    return code ? { code, key: sy().gmKey ?? null, cursor: sy().cursor || 0 } : null;
  };
  /** Another tab wrote a save whose room or GM key is not the one this link is in (it left, joined or opened another). */
  const otherRoom = (): boolean => {
    const r = storedRoom(), here = link.at === 'live' ? { code: link.code, key: link.key } : null;
    return (r?.code ?? null) !== (here?.code ?? null) || (r?.key ?? null) !== (here?.key ?? null);
  };
  const started = boot({ server: web && (tagged || sy().serverOk), room: storedRoom(), last: storedLast(sy().lastRoom) });
  let link: Link = started.state;
  let push: Push = PUSH_OFF;
  let attempt: Attempt<Reply> = NO_ATTEMPT;
  let shown: Shown = NOTHING_SHOWN;
  let srvSkew = 0;
  let lastOk = 0;
  let sheetText = '';
  let boundSeen: HunterId | null = bound()?.id ?? null;
  let removal: RemovedNotice = NO_REMOVAL;
  /**
   * The invite survives a reload of the tab (iOS drops background tabs) in this tab's memory (`store.device('invite',
   * 'tab')`), never in the save or a backup; a write storage refuses is the store's banner, as any device memory's.
   */
  const inviteMemory = store.device('invite', 'tab');
  let invited: RoomCode | null = parseRoomCode(inviteMemory.read());
  const setInvite = (code: RoomCode | null): void => {
    invited = code;
    inviteMemory.write(code);
  };
  /**
   * The invite is spent once the link is live in its room. Joined by a tap, the tap says so; already there (the link
   * opened again, or another tab joined it), the player is told once.
   */
  function spendInvite(tapped: boolean): void {
    if (!invited || link.at !== 'live' || link.code !== invited) return;
    const code = invited;
    setInvite(null);
    if (!tapped) ui.toast('System', `You are already in room ${code}.`, { kind: 'info' });
  }
  /** Events raised while effects run wait here, so each event's effects run in full and in order. */
  const queue: ({ to: 'link'; e: LinkEvent; data: Data } | { to: 'push'; e: PushEvent })[] = [];
  let running = false;
  /** The open requests of each gen, so `abort { gen }` can drop them. */
  const inflight = new Map<Gen, Set<AbortController>>();
  /**
   * One timer per name. A poll timer due while the page is hidden waits for the page to show (`visible`), except on a GM's
   * phone that may notify, which polls every 30 s while hidden (`hiddenWait` in src/core/sync/link.ts).
   */
  const timers = new Map<'poll' | 'push', ReturnType<typeof setTimeout>>();

  function linkDo(e: LinkEvent, data: Data = null): void { queue.push({ to: 'link', e, data }); drain(); }
  function pushDo(e: PushEvent): void { queue.push({ to: 'push', e }); drain(); }
  function drain(): void {
    if (running) return;
    running = true;
    try {
      for (let next = queue.shift(); next; next = queue.shift()) {
        if (next.to === 'link') {
          const before = link, r = linkReduce(link, next.e);
          link = r.state;
          runLink(r.effects, before, next.data);
          const tapped = attempt.at !== 'none';
          attemptDo({ type: 'linked', took: next.e, link, notices: r.effects.flatMap(x => (x.type === 'notify' ? [x.id] : [])) });
          spendInvite(tapped);
        } else {
          const r = pushReduce(push, next.e);
          push = r.state;
          runPush(r.effects);
        }
      }
    } finally { running = false; }
  }

  // ── carrying out the link's effects ──
  function runLink(fx: LinkEffect[], before: Link, data: Data): void {
    // a poll page's cursor waits for the page's `apply`, which writes it with what the page lands, in one write
    const page = data?.kind === 'poll' && fx.some(x => x.type === 'apply');
    let cursor: SaveFields | null = null;
    for (const x of fx) {
      switch (x.type) {
        case 'request': linkRequest(x.gen, x.timeoutMs, x.call); break;
        case 'abort': abortGen(x.gen); stretchLeft(); break;
        case 'setTimer': setTimer(x.name, x.ms); break;
        case 'clearTimer': clearTimer(x.name); break;
        case 'save': if (page) cursor = x.fields; else save(x.fields, before); break;
        case 'notify': notice(x.id, x.code); break;
        case 'status': {
          emitStatus(x.serverBack);
          const from = roomOf(before), to = room();
          if (from !== to) app.emit('sync:room', { from, to });
          if (to) removalDo({ type: 'entered', room: to });
          break;
        }
        case 'apply': apply(data, cursor, before); cursor = null; break;
        // the push hears the link at once, before anything else happens
        case 'push': { const r = pushReduce(push, x.event); push = r.state; runPush(r.effects); break; }
      }
    }
  }
  function track(gen: Gen): AbortController {
    const ac = new AbortController();
    const open = inflight.get(gen) ?? new Set<AbortController>();
    open.add(ac); inflight.set(gen, open);
    return ac;
  }
  function untrack(gen: Gen, ac: AbortController): void {
    const open = inflight.get(gen); if (!open) return;
    open.delete(ac); if (!open.size) inflight.delete(gen);
  }
  function abortGen(gen: Gen): void {
    const open = inflight.get(gen); if (!open) return;
    inflight.delete(gen);
    for (const ac of open) ac.abort();
  }
  /**
   * A request outside the machines made in stretch `gen` (a doc's put, an outbox send): dropped with the stretch's other
   * requests when the link leaves it, and then answered as no answer. Made in a stretch already left, it is dropped at once.
   */
  async function inStretch<T>(gen: Gen, ask: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const ac = track(gen);
    if (link.gen !== gen) abortGen(gen);
    try { return await ask(ac.signal); } finally { untrack(gen, ac); }
  }
  /**
   * The link left a stretch (link.ts `abort`) and dropped its requests, so nothing of it is answered here: each room
   * doc's put and timer go with it (publish.ts `left`), and what was on its way to the room waits again.
   */
  function stretchLeft(): void {
    for (const name of publishing.keys()) publishDo(name, { type: 'left' });
    unheard();
  }
  function setTimer(name: 'poll' | 'push', ms: number): void {
    clearTimer(name);
    const hidden = (): boolean => document.visibilityState === 'hidden';
    const wait = name === 'poll' && hidden() ? hiddenWait(link, ms, notifying()) ?? ms : ms;
    timers.set(name, setTimeout(() => {
      timers.delete(name);
      if (name === 'push') pushDo({ type: 'timerFired', name });
      else if (!hidden() || hiddenWait(link, ms, notifying()) !== null) linkDo({ type: 'timerFired', name });
      // else: the page is hidden. `visible` polls when it shows.
    }, wait));
  }
  function clearTimer(name: 'poll' | 'push'): void {
    const t = timers.get(name);
    if (t !== undefined) { clearTimeout(t); timers.delete(name); }
  }
  /** One reply per request: the reply events go to the link unless the request's gen was dropped meanwhile. */
  function linkRequest(gen: Gen, timeoutMs: number, call: LinkCall): void {
    const ac = track(gen);
    void ask(call, gen, ac.signal, timeoutMs).then(({ events, data }) => {
      untrack(gen, ac);
      if (ac.signal.aborted) return;
      events.forEach((e, i) => linkDo(e, i === 0 ? data : null));
    });
  }
  const failedOf = (a: Answer, gen: Gen): LinkEvent =>
    a.status === 404 && errorOf(a) === 'no such room' ? { type: 'gone', gen } : { type: 'failed', gen, kind: 'server' };
  /** The server's answer to one link request, as link events. A poll's `removed` or `keyLost` comes after the poll answer. */
  async function ask(call: LinkCall, gen: Gen, signal: AbortSignal, timeoutMs: number): Promise<{ events: LinkEvent[]; data: Data }> {
    const one = (e: LinkEvent): { events: LinkEvent[]; data: Data } => ({ events: [e], data: null });
    const failedServer: LinkEvent = { type: 'failed', gen, kind: 'server' };
    try {
      switch (call.req) {
        case 'health': {
          const a = await fetchApi('GET', '/health', { signal, timeoutMs });
          if (a.status !== 200 || !isObj(a.data) || !a.data.ok) return one(failedServer);
          heard();
          return one({ type: 'healthOk', gen });
        }
        case 'create': {
          const a = await fetchApi('POST', '/rooms', { signal, timeoutMs });
          const code = isObj(a.data) ? parseRoomCode(a.data.code) : null, key = isObj(a.data) && typeof a.data.gmKey === 'string' ? a.data.gmKey : '';
          if (a.status !== 200 || !code || !key) return one(failedServer);
          peeked.set(code, { at: Date.now(), exists: true });
          return one({ type: 'created', gen, code, key: key as GmKey });
        }
        case 'peek': {
          const a = await fetchApi('GET', `/rooms/${call.code}?peek=1`, { signal, timeoutMs });
          if (a.status !== 200) return one(failedServer);
          const exists = isObj(a.data) && a.data.exists === true;
          peeked.set(call.code, { at: Date.now(), exists });
          return one({ type: 'peeked', gen, exists });
        }
        case 'head': {
          // the head of the room without its history; the first page says whether our sheet was removed lately
          let after = 0, first: RoomState | null = null;
          for (;;) {
            const a = await fetchApi('GET', `/rooms/${call.code}?after=${after}&d=${encodeURIComponent(deviceId())}`, { signal, timeoutMs, key: call.key, prove: true });
            if (a.status !== 200) return one(failedOf(a, gen));
            const r = parseRoomState(a.data); if (!r) return one(failedServer);
            first ??= r;
            const binds = joinsFor();
            if (!r.more) return { events: [{ type: 'headed', gen, cursor: r.next, gm: r.gm, kicked: 'hunter' in binds && kickedAt(first, myKey(binds.hunter)) !== null }], data: { kind: 'head', now: r.now } };
            after = r.next;
          }
        }
        case 'poll': {
          const after = call.cursor;
          const a = await fetchApi('GET', `/rooms/${call.code}?after=${after}&d=${encodeURIComponent(deviceId())}`, { signal, timeoutMs, key: call.key, prove: true });
          if (a.status !== 200) return one(failedOf(a, gen));
          const r = parseRoomState(a.data); if (!r) return one(failedServer);
          const fight = r.docs.fight?.data ?? null;
          const events: LinkEvent[] = [{ type: 'polled', gen, cursor: Math.max(r.next, after), more: r.more, pace: paceOf(fight, call.key !== null, deviceId()), fightAt: fight ? fight.at : null }];
          if (call.key && !r.gm) events.push({ type: 'keyLost', gen });
          if (!call.key && removedSinceJoin(r, call.code)) events.push({ type: 'removed', gen });
          return { events, data: { kind: 'poll', r, after } };
        }
      }
    } catch (e) { return one({ type: 'failed', gen, kind: failKind(e) }); }
  }
  /** A server answered: later visits probe it at boot even from a page the server did not tag. */
  const heard = (): void => { if (!sy().serverOk) store.apply('sync-status', atSync(serverSeen)); };
  /** When the GM removed the sheet `key`, if under 10 minutes before the server's now, else null. */
  function kickedAt(r: RoomState, key: string): number | null {
    const t = Date.parse(r.docs.kicked?.data.keys[key as SheetKey] ?? ''), now = Date.parse(r.now) || Date.now();
    return Number.isFinite(t) && now - t < KICK_MS ? t : null;
  }
  /** The bound hunter was removed from room `code` after this phone joined it: a removal from before does not count. */
  function removedSinceJoin(r: RoomState, code: RoomCode): boolean {
    const h = bound(); if (!h) return false;
    const t = kickedAt(r, myKey(h.id));
    return t !== null && t > (joinedAt(sy(), code) ?? 0);
  }

  /** The only writer of the room fields of the save: the link's `save` effect as one step (src/core/sync/bind.ts `linkSaved`). */
  function save(fields: SaveFields, before: Link): void {
    store.apply('sync-link', s => linkWritten(s, fields, before));
  }
  /** The link's `save` effect as a step. The key the room refused is the one the link held: a key typed by hand that is wrong leaves a good stored one alone. */
  const linkWritten = (s: Save, fields: SaveFields, before: Link): Save => linkSaved(s, fields, 'key' in before ? before.key : null, srvNow());

  /** A toast or a window. A notice that ends a tap is the tap machine's to answer (`attemptDo`), and the view that made it shows it. */
  function notice(id: LinkNotice, code: RoomCode | null): void {
    switch (id) {
      case 'gone': {
        ui.toast('Sync', 'This room no longer exists, so this phone left it.', { kind: 'warn' });
        if (!code) return;
        peeked.delete(code);
        // the room's offers step `roomGone` in the write that refuses its letters: a never-sent one gives its goods back
        const ended: { news: OfferNews[] } = { news: [] };
        boxDo('outbox-gone', b => roomGone(b, code), s => { const g = offersGone(runsGone(s, code), code); ended.news = g.closed.flatMap(c => closeNews(c) ?? []); return g.save; });
        for (const n of ended.news) if (n.kind === 'toast') ui.toast('Trade', n.text);
        return;
      }
      case 'keyLost': ui.toast('System', `The GM key for room ${code ?? ''} no longer works, so this phone left the room.`, { kind: 'warn' }); return;
      case 'removed': if (code) removalDo({ type: 'removed', room: code, hunter: bound()?.id ?? null }); return;
      case 'upgradeStuck': store.notify({ id: 'upgrade', text: STUCK_TEXT }); return;
      case 'notFound': if (code) peeked.delete(code); return;
      case 'readOnly': ui.toast('System', code ? `This tab cannot save, so it left room ${code}. The save keeps the room: reload to go back in.` : 'This tab cannot save, so it stopped opening the room.', { kind: 'warn' }); return;
      case 'keyRefused': case 'notAllowedBack': case 'unreachable': case 'serverError': case 'replaced': return;
    }
  }

  /**
   * The room data of the reply just given. Only the link's `apply` effect calls this, so only a current reply is applied.
   * `cursor`: the link's `save` of this step (a poll page's cursor), written here with what the page lands.
   */
  function apply(data: Data, cursor: SaveFields | null, before: Link): void {
    if (!data) return;
    if (data.kind === 'head') { skewFrom(data.now); if (link.at === 'live' && link.key === null) bindJoin(link.code); return; }
    const { r, after } = data;
    skewFrom(r.now);
    const presenceOk = !!(r.gm && r.presence);
    shown = { gen: link.gen, sheets: r.sheets, docs: r.docs, presence: presenceOk ? r.presence ?? {} : {}, presenceOk };
    const player = link.at === 'live' && link.key === null, dev = deviceId();
    // a message the room took before this phone's join came while the phone was out of the room: it is told in one window
    const joined = link.at === 'live' && link.key === null ? joinedAt(sy(), link.code) : null;
    const page = r.events.filter(e => e.seq > after).sort((a, b) => a.seq - b.seq);
    const fresh: RoomEvent[] = [], away = new Set<RoomEvent>();
    for (const ev of page) {
      if (ev.from === dev) continue; // our own sends echo back; never apply or re-announce them
      app.emit('sync:event', { event: ev });
      const e = { type: ev.type, payload: ev.payload } as RoomEvent;
      fresh.push(e);
      if (joined !== null && Date.parse(ev.at) < joined) away.add(e);
    }
    landPage(player ? fresh : null, page, away, joined, cursor, before);
    if (player) release();
    heard();
    app.emit('sync:sheets', { sheets: shown.sheets });
    app.emit('sync:docs', { docs: shown.docs });
    republish();
    flush();
  }
  /**
   * One write for a poll page: its cursor; on a player's phone what its events land (room-events.ts `landAll`: the events
   * held from earlier pages, then this page's) and the events held now (`settings.sync.held`); and on every phone in the
   * room what the page says of offers (src/core/trade/offer.ts `offersSeen`, over the page whole, this phone's own echoes
   * included: a phone learns that its own accept or take back won only by reading it as the end), with the GM's log lines of
   * trades. Then the player is told, in the room's order; the messages of `away` (sent while this phone was out of the
   * room, `joined`) as lines of one window.
   */
  function landPage(events: RoomEvent[] | null, page: readonly StoredEvent[], away: ReadonlySet<RoomEvent>, joined: number | null, cursor: SaveFields | null, before: Link): void {
    const me = link.at === 'live' ? { room: link.code, seat: link.key === null ? 'player' as const : 'gm' as const } : null;
    if (!cursor && !(events && (events.length || sy().held?.length)) && !(me && page.length)) return; // nothing to write
    const lines: string[] = [], awayApp = awayDeps(deps, lines), did: { page: PageLanded | null; news: readonly OfferNews[] } = { page: null, news: [] };
    const wrote = store.apply('sync-page', s => {
      const at = cursor ? linkWritten(s, cursor, before) : s;
      const landed = events ? did.page = landAll(at, at.settings.sync.held ?? [], events, deps, ev => (away.has(ev) ? awayApp : deps)) : null;
      const next = landed ? { ...landed.save, settings: { ...landed.save.settings, sync: { ...landed.save.settings.sync, held: landed.held } } } : at;
      if (!me) return next;
      const seen = offersSeen(next, page, me);
      did.news = seen.news;
      const logs = seen.news.flatMap(n => (n.kind === 'log' ? [{ kind: 'trade' as const, hunterId: null, title: 'Trade', text: n.text }] : []));
      return told(seen.save, { at: new Date().toISOString(), cap: app.rules().logCap }, ...logs);
    });
    if (!wrote.ok) return;
    const landed = did.page;
    for (const tell of landed?.tells ?? []) tell();
    for (const n of did.news) {
      if (n.kind !== 'toast') continue;
      const ids: readonly string[] = [n.offer, endIdOf(n.offer)], ev = page.find(e => ids.includes(e.payload.eid));
      if (joined !== null && ev && Date.parse(ev.at) < joined) lines.push(`Trade: ${n.text}`); else ui.toast('Trade', n.text);
    }
    if (lines.length) void ui.system({ tag: '! System', title: 'WHILE YOU WERE AWAY', kind: 'info', body: AWAY_BODY, lines });
    if (landed?.fresh.length) ui.toast('Sync', 'A message from the GM could not be applied on this phone. It is kept and tried again.', { kind: 'warn' });
  }
  const skewFrom = (now: string): void => { const t = Date.parse(now); if (Number.isFinite(t)) srvSkew = t - Date.now(); };
  /** What the appliers in room-events.ts use of the app; read when an event arrives, after every module has registered. */
  const deps: ApplyDeps = {
    store, once: (eid, step) => once(eid, step), rules: () => app.rules(), now: () => new Date().toISOString(),
    today: () => stepTime(store.get(), new Date()).today,
    toast: (tag, text, o) => ui.toast(tag, text, o), system: w => ui.system({ ...w, body: w.body ?? '' }),
    get hunter() {
      const h = app.api.hunter!;
      return { fightOf: h.fightOf, granted: h.granted, gmHolds: h.gmHolds };
    },
    stepsDone: (hid, done) => app.api.quests!.stepsDone(hid, done),
    coinRuled: roll => app.api.coin!.ruled(roll),
  };
  /** `write` and the event id in one write, the first time only (src/core/applied.ts `appliedOnce`). A repeat writes nothing. */
  const once: SyncApi['once'] = (eid, write) => store.apply('sync-applied', appliedOnce(eid, write)).ok;

  // ── carrying out the push's effects ──
  function runPush(fx: PushEffect[]): void {
    for (const x of fx) {
      switch (x.type) {
        case 'request': sendSheet(x.gen, x.timeoutMs); break;
        case 'setTimer': setTimer(x.name, x.ms); break;
        case 'clearTimer': clearTimer(x.name); break;
        case 'notify': notOwner(); break;
        case 'status': emitStatus(); break;
      }
    }
  }
  /**
   * PUT the bound sheet as it is now. A 403 removed and a 426 are the link's to hear.
   */
  function sendSheet(gen: Gen, timeoutMs: number): void {
    const b = bound();
    if (link.at !== 'live' || link.gen !== gen || !b) { queueMicrotask(() => pushDo({ type: 'sent', gen })); return; } // nothing to send
    const h = pushedSheet(b), text = JSON.stringify(h), code = link.code;
    // the room's own bound, counted before the request: a sheet past it is refused as too large, as the server would
    if (JSON.stringify({ hunter: h }).length > SHEET_MAX) { queueMicrotask(() => pushDo({ type: 'refused', gen, why: 'too-large' })); return; }
    const ac = track(gen);
    sheetText = text;
    void (async (): Promise<void> => {
      let e: PushEvent | LinkEvent;
      try {
        const a = await fetchApi('PUT', `/rooms/${code}/sheets/${encodeURIComponent(myKey(h.id))}`, { body: { from: deviceId(), data: { hunter: JSON.parse(text) } }, signal: ac.signal, timeoutMs });
        const why = errorOf(a);
        e = a.status >= 200 && a.status < 300 ? { type: 'sent', gen }
          : a.status === 403 && why === 'not your sheet' ? { type: 'notYours', gen }
          : a.status === 403 ? { type: 'removed', gen }
          : a.status === 400 || a.status === 413 ? { type: 'refused', gen, why: (a.status === 400 ? 'bad' : why === 'room full' ? 'room-full' : 'too-large') satisfies RefusedWhy }
          : { type: 'failed', gen, kind: 'server' };
      } catch (x) { e = { type: 'failed', gen, kind: failKind(x) }; }
      untrack(gen, ac);
      if (ac.signal.aborted) return;
      if (e.type === 'removed') linkDo(e); else pushDo(e as PushEvent);
    })();
  }
  function notOwner(): void {
    const h = bound();
    ui.system({ tag: '! System', title: 'HUNTER LOCKED TO ANOTHER DEVICE', kind: 'warning', body: `${h?.name || 'This hunter'} is claimed by a different device in this room, so this device cannot update it. Ask your GM to release it, then reopen the app.` });
  }

  // ── the hunter this phone sends (settings.sync.boundHunterId), not whichever is active ──
  const myKey = (hid: HunterId): SheetKey => sheetKeyOf(deviceId(), hid);
  const srvNow = (): string => new Date(Date.now() + srvSkew).toISOString(); // a skewed phone clock cannot defeat the removal stamp
  /**
   * The bound hunter, or none: never whichever is shown. A join binds one (`bindJoin`), "Play as" another (`switchTo`), a
   * delete the first left (party.ts `removeHunter`), each through src/core/sync/bind.ts, and a save read in a room binds
   * its active one (save.ts).
   */
  function bound(): Hunter | null { const id = sy().boundHunterId; return id ? store.hunter(id) : null; }
  /** What a join binds (attempt.ts `joinBinds`): the hunter picked, a new one of the typed name, or the active one. */
  const joinsFor = (): JoinBinds => joinBinds(attempt, id => store.hunter(id)?.id ?? null, store.get().settings.activeHunterId);
  /**
   * A player joined room `code`: that hunter is active and bound, and the join written at the server's now (an older
   * removal no longer applies). A new hunter of a typed name is made in the same write, so a join that failed made none.
   */
  function bindJoin(code: RoomCode): void {
    const binds = joinsFor(), join = { room: code, at: srvNow() };
    if ('make' in binds) { const h = store.newHunter(binds.make.slice(0, 60)); store.apply('sync-join', s => boundTo(addHunter(s, h), h.id, join)); }
    else store.apply('sync-join', s => boundTo(s, binds.hunter, join));
    sheetText = '';
  }

  // ── the Create or Join tap (src/core/sync/attempt.ts) ──
  /** The only mover of `attempt`: one step of the tap machine, then its effects. */
  function attemptDo(e: AttemptEvent<Reply>): void {
    const r = attemptStep(attempt, e);
    attempt = r.state;
    for (const x of r.effects) {
      switch (x.type) {
        case 'link': linkDo(x.tap); break;
        case 'answer': { const a = x.answer; if ('kind' in a) x.reply.reject(tapError(a.kind)); else x.reply.resolve(a.value); break; }
      }
    }
  }
  /**
   * Start a create or a join. A tap while one is out is answered at once as `busy` (attempt.ts). A tab that may not write
   * its save enters no room (link.ts `readOnly`): the tap is told as any refused write is, and fails with no words of its own.
   */
  const begin = (tap: RoomTap, who: JoinFor = NOBODY): Promise<string> => {
    if (store.readOnly) { ui.wrote('System', refuse(READ_ONLY)); return Promise.reject(tapError('replaced')); }
    return new Promise<string>((resolve, reject) => attemptDo({ type: 'tap', tap, who, reply: { resolve, reject } }));
  };
  const keyFor = (code: RoomCode): GmKey | null => (sy().gmKeys || {})[code] ?? null;
  /** A join of `code`, reading on from where this phone stopped when it last went out of that room (seen.ts `seenFrom`). */
  const joining = (code: RoomCode, key: GmKey | null): Extract<LinkEvent, { type: 'join' }> => ({ type: 'join', code, key, from: seenFrom(sy().seen, code, Date.now() + srvSkew) });
  async function create(): Promise<string> { return begin({ type: 'create' }); }
  /** Join the room in `text` (a code, a link, a message). With the room's GM key in the ring, reopen it as GM. */
  async function joinRoom(text: unknown, o: { hunterId?: string; name?: string } = {}): Promise<string> {
    const code = parseInvite(text); if (!code) throw tapError('badcode');
    const key = keyFor(code);
    const role = await begin(joining(code, key), key ? NOBODY : { hunterId: o.hunterId ?? null, name: String(o.name ?? '').trim() });
    setInvite(null);
    return role;
  }
  /** Rejoin room `code` as its GM: with `key` typed by hand, or else the key this phone keeps for it (`keyFor`). */
  async function rejoinGM(code: string, key?: string): Promise<void> {
    const c = parseRoomCode(code), k = c ? (key ?? keyFor(c)) : null; if (!c || !k) throw tapError('badcode');
    await begin(joining(c, k as GmKey));
  }

  // ── removed by the GM (src/core/sync/bind.ts `removedStep`) ──
  /** The only mover of `removal`: one step of the removed notice, then its effects. */
  function removalDo(e: RemovedEvent): void {
    const r = removedStep(removal, e);
    removal = r.state;
    for (const x of r.effects) {
      switch (x.type) {
        case 'show': showRemoved(x.room, x.hunter); break;
        case 'tell': ui.toast('System', x.text, { kind: x.kind }); break;
        case 'rejoin': {
          const room = x.room;
          void tapped(() => begin(joining(room, null), { hunterId: x.hunter, name: '' }))().then(
            () => removalDo({ type: 'tapped', room, answer: { ok: true, value: '' } }),
            (e: unknown) => removalDo({ type: 'tapped', room, answer: { ok: false, kind: e instanceof TapError ? e.kind : 'net' } }));
          break;
        }
      }
    }
  }
  /** The REMOVED FROM ROOM window of room `code`. Its answer goes to the notice, which acts only while it is that room's. */
  function showRemoved(code: RoomCode, hid: HunterId | null): void {
    const h = hid ? store.hunter(hid) : null;
    const body = `The GM removed ${h?.name || 'your hunter'} from room ${code}. Your hunter is safe on this device. Ask your GM before joining again.`;
    void ui.system({ tag: '! System', title: 'REMOVED FROM ROOM', kind: 'warning', body,
      actions: [{ label: 'OK', value: false, cancel: true }, { label: 'Rejoin when the GM allows', value: true, primary: true }] })
      .then(v => removalDo({ type: 'answered', room: code, rejoin: v === true }));
  }

  // ── the outbox: what this phone owes the room (src/core/sync/outbox.ts) ──
  const box = (): Outbox => sy().outbox ?? [];
  /**
   * The one writer of the save's outbox outside a bind. Answers whether the step was written. `heard`: what the same
   * write tells beside the box, before the box changes (a solo run whose message the room took, or whose room is gone,
   * gates/solo-wait.ts): it reads the letter while it is still in the box.
   */
  const boxDo = (reason: string, f: (b: Outbox) => Outbox, heard: ((s: Save) => Save) | null = null): boolean =>
    store.apply(reason, s => atOutbox(f)(heard ? heard(s) : s)).ok;
  /**
   * Puts `letter` in the outbox for the room this phone is in and sends what waits. Answers the entry's id and how many
   * older messages the full box let go (the view says so), or why nothing was posted.
   */
  function postLetter(letter: Letter, key: string | null): ReturnType<SyncApi['post']> {
    const code = room(); if (!code) return { ok: false, why: 'noRoom' };
    let dropped: readonly Entry[] = [];
    if (!flush('outbox-post', b => { const r = postIn(b, code, letter, key); dropped = r.dropped; return r.box; })) return { ok: false, why: 'noRoom' };
    // each message the full box let go is told to whoever waits on its id (a turn's hold: SMX-sync-4.3)
    for (const d of dropped) app.emit('sync:outbox', { id: d.id, at: 'dropped' });
    if (dropped.length) ui.toast('Sync', `Too much is waiting for the room, so ${dropped.length === 1 ? 'the oldest message was' : `the ${dropped.length} oldest messages were`} dropped.`, { kind: 'warn' });
    return { ok: true, id: letter.kind === 'event' ? letter.event.payload.eid : `tomb ${letter.hid}`, dropped: dropped.length };
  }
  /**
   * Writes `first` (a post, or the answer to a send) and, in the same write, puts the oldest message that waits for the
   * live room on its way, when none of that room is. One at a time, in the order posted (the box's `next`); one write, so
   * the box is never seen with a message waiting behind nothing. Answers whether the write was made.
   */
  function flush(reason = 'outbox-send', first: ((b: Outbox) => Outbox) | null = null, heard: ((s: Save) => Save) | null = null): boolean {
    const code = link.at === 'live' ? link.code : null, key = link.at === 'live' ? link.key : null, gen = link.gen;
    if (!first && (!code || !nextOut(box(), code))) return false; // nothing to write: a poll with nothing waiting writes nothing
    const pick: { e: Entry | null } = { e: null };
    const wrote = boxDo(reason, b => { const b1 = first ? first(b) : b; pick.e = code ? nextOut(b1, code) : null; return pick.e ? outStep(b1, pick.e.id, { type: 'send' }) : b1; }, heard);
    const out = pick.e;
    if (wrote && out && code) void inStretch(gen, signal => deliver(code, key, out, signal)).then(c => answered(out, c, gen));
    return wrote;
  }
  /**
   * The room answered `e`, sent in stretch `gen`: taken or refused, the next goes at once; with no answer it waits for the
   * next good poll. The answer of a stretch the link left is never heard: the entry waits again already (`unheard`), and
   * the room it was for is not the one this phone shows (audit SMX-sync-4.2).
   */
  function answered(e: Entry, c: Call, gen: Gen): void {
    if (link.gen !== gen) return;
    const ev: EntryEvent = sentEvent(c);
    if (ev.type === 'failed') boxDo('outbox-failed', b => outStep(b, e.id, ev));
    // a solo run's message, or an offer's letter, the room took is heard taken in the same write as its letter leaves the
    // box (solo-wait.ts `runTaken`, trade/offer.ts `letterTaken`); one on its way was heard tried in the write that sent it
    // (the store's `lettersKept`)
    else flush(`outbox-${ev.type}`, b => outStep(b, e.id, ev), ev.type === 'sent' ? s => letterTaken(runTaken(s, e.id), e.id) : null);
    // a player's own fight move: the link polls quickly until the fight doc it was sent from changes
    if (c.ok && e.letter.kind === 'event' && FIGHT_MOVES.has(e.letter.event.type)) linkDo({ type: 'sent', from: view().docs.fight?.data.at ?? null });
    if (ev.type === 'sent') app.emit('sync:outbox', { id: e.id, at: 'sent', seq: c.ok && isObj(c.data) && typeof c.data.seq === 'number' ? c.data.seq : null });
    if (ev.type === 'refused') {
      console.warn(`[sync] the room refused a ${e.letter.kind === 'event' ? e.letter.event.type : 'tombstone'}: ${ev.why}`);
      ui.toast('Sync', `The room did not take ${e.letter.kind === 'event' ? WHAT_SENT[e.letter.event.type] ?? 'a message' : 'the removal of a deleted hunter'} (${ev.why}).`, { kind: 'warn' });
      app.emit('sync:outbox', { id: e.id, at: 'refused', why: ev.why });
    }
    emitStatus();
  }
  /**
   * Nothing sent before is answered here, so what was on its way waits again (the room takes an id once): a new page, or
   * the link left the stretch it was sent in (`stretchLeft`).
   */
  function unheard(): void { if (box().some(e => e.at === 'sending')) boxDo('outbox-reload', reloaded); }
  /** One entry's request: an event is posted (with the GM key on the GM's phone), a tombstone put over the hunter's sheet. */
  function deliver(code: RoomCode, key: GmKey | null, e: Entry, signal: AbortSignal): Promise<Call> {
    const at = encodeURIComponent(code);
    if (e.letter.kind === 'tomb') return call('PUT', `/rooms/${at}/sheets/${encodeURIComponent(myKey(e.letter.hid))}`, { from: deviceId(), data: { deleted: true } }, key, signal);
    const ev = e.letter.event;
    return call('POST', `/rooms/${at}/events`, { from: deviceId(), type: ev.type, payload: ev.payload }, key, signal);
  }
  /** A message as the player reads it when the room refuses it. */
  const WHAT_SENT: Partial<Record<RoomEvent['type'], string>> = {
    used: 'a use you told the GM of', roll: 'a roll', questUpdate: 'a quest\'s progress', coinCall: 'a coin call', coinLand: 'a coin\'s ruling',
    step: 'a step', cast: 'a use in the fight', pass: 'the end of a turn', deathSave: 'a death save', arm: 'a reaction', award: 'an award', quest: 'a quest', chain: 'a Job Change',
    soloRun: 'a solo run', soloAnswer: 'the answer to a solo run',
  };
  /** A hunter deleted on this phone leaves the GM's board: its sheet is replaced by a tombstone, through the outbox. */
  const forget = (hid: HunterId): void => { if (playerRoom()) postLetter({ kind: 'tomb', hid }, null); };
  /**
   * Change the active hunter. In a room as a player, ask whether the new hunter takes the room slot (the old card leaves
   * the GM's board). The answer is read where the phone is once it comes (bind.ts `playAsAnswered`): a window answered
   * after the phone left that room, or after another hunter was bound there, only shows the hunter. Answers whether the
   * hunter changed; a refused write is told (ui.js `wrote`) and changes nothing.
   */
  async function switchTo(hid: string): Promise<boolean> {
    const to = store.hunter(hid); if (!to) return false;
    const show = (): boolean => ui.wrote('System', store.apply('switch-hunter', s => setActive(s, to.id)));
    const asked = playing(), b = bound();
    if (!asked || !b || asked.bound === to.id) return show();
    const v = await ui.system({ tag: '! System', title: `PLAY AS ${String(to.name).toUpperCase()}?`, kind: 'quest',
      body: `Play as ${to.name} in room ${asked.room}? ${b.name} leaves the GM's board.`,
      actions: [{ label: 'Cancel', value: 'cancel', cancel: true }, { label: `Only view ${to.name}`, value: 'view' }, { label: `Play as ${to.name}`, value: 'bind', primary: true }] });
    const answer: BindAnswer = v === 'bind' || v === 'view' ? v : 'cancel';
    switch (playAsAnswered(asked, playing(), answer)) {
      case 'none': return false;
      case 'show': return show();
      case 'showKept':
        if (!show()) return false;
        ui.toast('System', `${b.name} stays synced to room ${asked.room}.`, { kind: 'info' }); // the sheet still sends the bound hunter
        return true;
      case 'playAs':
        if (!ui.wrote('System', store.apply('sync-rebind', s => playAs(s, to.id)))) return false;
        forget(b.id);
        return true;
    }
  }
  /** Where this phone plays: the live room as a player and the hunter bound there, or null. */
  const playing = (): BindAsked | null => { const code = playerRoom(), b = bound(); return code && b ? { room: code, bound: b.id } : null; };

  // ── the room as the views read it ──
  /** The room this phone is in: the live room, or the one a create or join started from. Upgrading, the saved room, which the reloaded app opens. */
  function roomOf(l: Link): RoomCode | null {
    if (l.at === 'live') return l.code;
    if (l.at === 'creating' || l.at === 'joining') return roomOf(l.back);
    if (l.at === 'upgrading') return sy().room ? parseRoomCode(sy().room) : null;
    return null;
  }
  const room = (): RoomCode | null => roomOf(link);
  /** The live room as a player, or null. */
  const playerRoom = (): RoomCode | null => (link.at === 'live' && link.key === null ? link.code : null);
  /** The live room as GM with its key, or null. */
  const gmRoom = (): { code: RoomCode; key: GmKey } | null => (link.at === 'live' && link.key !== null ? { code: link.code, key: link.key } : null);
  /** The data of the last poll of this stretch of the link: never another room's, nor this room's from before a leave. */
  const view = (): Shown => (link.at === 'live' && shown.gen === link.gen ? shown : NOTHING_SHOWN);
  const doc = <K extends DocName>(name: K): DocOf<K> | null => (view().docs[name]?.data as DocOf<K> | undefined) ?? null;
  // a player's phone plays by the room's build switches while in it (src/edge/rules.ts); the GM's phone by its own
  bindRoom(() => (playerRoom() ? doc('rules') : null));
  /** Whether the GM's fight holds a hunter of this player's phone (its row in the room's fight doc), for the notice step. */
  const noticeHeld = (s: Save, hid: HunterId): boolean => fightHold(s.fight, { hid }, { seat: app.seat(), doc: doc('fight'), key: myKey(hid) }) !== null;
  // a player's facts belong to the room's session (its world doc) and wait while the GM's fight holds the hunter (noticed.ts)
  bindNotice(() => (playerRoom() ? { session: doc('world')?.session ?? 0, held: noticeHeld, library: doc('feats')?.feats ?? {} } : null));
  /** The release write: once the room's fight doc lets a hunter with waiting facts go, they are noticed (noticed.ts `released`). */
  const release = (): void => { if (store.get().hunters.some(h => h.chronicle.inbox.length)) store.apply('noticed', s => released(s, noticeHeld)); };
  /**
   * The players' sheets with their device, hunter and when the device last polled, on the room's GM phone; none on any
   * other (a player's phone is told nothing of the others). A deleted hunter's tombstone is left out.
   */
  const remoteSheets = (): RemoteSheet[] => (!gmRoom() ? [] : Object.entries(view().sheets).flatMap(([text, s]) => {
    const key = parseSheetKey(text);
    if (!key || !('hunter' in s.data)) return [];
    const deviceId = deviceOf(key);
    return [{ key, polledAt: view().presence[deviceId] || null, deviceId, hunterId: hunterIdOf(key), at: s.at, from: s.from, data: s.data.hunter }];
  }));

  // ── what a GM sends: events, docs, removals ──
  let stamped = 0;
  /**
   * A room event with its id (newEvent in src/core/protocol.ts), for `post`. The id's time is later than that of the
   * last id this page made (`stamped`), so two of this page's ids differ whatever the clock and `Math.random` answer.
   */
  const event = <K extends EventType>(type: K, body: EventBody<K>): RoomEvent | null => {
    stamped = stampTime(stamped, Date.now());
    return newEvent(type, body, { device: deviceId(), now: stamped, rand: Math.random() });
  };
  /**
   * Puts a room doc in the room of stretch `gen`, and nowhere once the link has left it. The GM's phone then shows the doc
   * as `DOCS` reads it, as every other phone will. `tooBig`: longer than `DOC_MAX`, counted here before it is sent or by
   * the server's 413.
   */
  async function putDoc(name: DocName, data: unknown, gen: Gen): Promise<'stored' | 'tooBig' | 'failed'> {
    const gm = link.gen === gen ? gmRoom() : null, parsed = DOCS[name](data);
    if (!gm || !parsed) return 'failed';
    const body = JSON.stringify(data); if (body.length > DOC_MAX) return 'tooBig';
    let a: Answer;
    try { a = await inStretch(gen, signal => fetchApi('PUT', `/rooms/${encodeURIComponent(gm.code)}/sheets/_${name}`, { body: { from: deviceId(), data: JSON.parse(body) }, key: gm.key, signal })); } catch (e) { failKind(e); return 'failed'; }
    if (a.status === 413) return 'tooBig';
    if (a.status < 200 || a.status >= 300) return 'failed';
    // stored in the room of `gen`; shown only while this phone is still in that stretch of the link
    if (shown.gen === gen && link.gen === gen) {
      shown = { ...shown, docs: { ...shown.docs, [name]: { at: new Date().toISOString(), from: deviceId(), data: parsed } } };
      app.emit('sync:docs', { docs: shown.docs });
    }
    return 'stored';
  }
  /**
   * The docs this GM phone keeps in the room. Each `build` answers what the room should hold now (null: nothing). A doc is
   * put when it differs from the room's (`at` aside), so nothing remembers what was sent: a failed put is tried again at
   * the next change or poll, and nothing is put before this stretch of the link has read the room's docs.
   */
  const publishers = new Map<PublishedDoc, () => unknown>();
  /** Each doc's publish machine (src/core/sync/publish.ts): at most one put of a doc out at a time. A doc not in it is idle. */
  const publishing = new Map<PublishedDoc, Publish>();
  /** One event of doc `name`'s publish machine; its effects carried out here. */
  function publishDo(name: PublishedDoc, event: PublishEvent): void {
    const { state, effects } = publishStep(publishing.get(name) ?? PUBLISH_IDLE, event);
    publishing.set(name, state);
    for (const fx of effects) {
      switch (fx.type) {
        case 'setTimer': setTimeout(() => publishDo(name, { type: 'due', gen: fx.gen }), publishWait(name)); break; // the machine is `waiting` until it fires, or the stretch is left
        case 'put': {
          const { gen } = fx;
          // a doc whose build throws is a bug: logged once, and the machine hears a failed put, so the doc is put again at the next change
          publishNow(name, gen).then(put => publishDo(name, { type: 'answered', gen, put }), e => { reported('sync:publish', e); publishDo(name, { type: 'answered', gen, put: 'failed' }); });
          break;
        }
        case 'status': emitStatus(); break;
      }
    }
  }
  function republish(): void {
    if (!gmRoom()) return;
    const gen = link.gen;
    for (const name of publishers.keys()) publishDo(name, { type: 'changed', gen });
  }
  /** The doc without what a player can do without, for a second put after the room refused the first as too big: the fight's log. */
  const shorter = (data: unknown): unknown => (isObj(data) && Array.isArray(data.log) && data.log.length ? { ...data, log: [] } : null);
  /** The put of doc `name` its machine asked for in stretch `gen`: built now, and put only when it differs from the room's. */
  async function publishNow<K extends PublishedDoc>(name: K, gen: Gen): Promise<PutAnswer> {
    if (link.gen !== gen || !gmRoom() || shown.gen !== gen) return 'unsent';
    const data = publishers.get(name)!(), want = data === null ? null : (DOCS[name](data) as DocOf<K> | null);
    if (!want) return 'unsent';
    const have = view().docs[name]?.data as DocOf<K> | undefined;
    if (have && sameDoc(name, want, have)) return 'unsent';
    let put = await putDoc(name, data, gen);
    const short = put === 'tooBig' ? shorter(data) : null;
    if (short !== null) {
      console.info(`[sync] the room refused the ${name} doc as too big; putting it again without its log`);
      put = await putDoc(name, short, gen);
    }
    // a fight that began or ended, or a turn that came to a player or left one, sets how often this phone polls
    if (put === 'stored' && name === 'fight' && link.gen === gen) linkDo({ type: 'paced', pace: paceOf(want as DocOf<'fight'>, true, deviceId()) });
    return put;
  }
  /** The GM removes a player's hunter. The player's phone is told on its next poll; its hunter stays on that phone. */
  async function kickSheet(key: string): Promise<Call> {
    const gm = gmRoom(), gen = link.gen; if (!gm || !/^[\w:.-]{1,40}$/.test(key) || key.startsWith('_')) return NOT_GM;
    const c = await call('DELETE', `/rooms/${encodeURIComponent(gm.code)}/sheets/${encodeURIComponent(key)}`, undefined, gm.key);
    if (!c.ok) return c;
    if (shown.gen === gen && link.gen === gen) { const sheets = { ...shown.sheets }; delete sheets[key as SheetKey]; shown = { ...shown, sheets }; app.emit('sync:sheets', { sheets }); }
    showKicked(c.data, gen);
    return c;
  }
  /** The GM lifts a removal. The server drops its block and the entry in `_kicked` in the same request. */
  async function allowBack(key: string): Promise<Call> {
    const gm = gmRoom(), gen = link.gen; if (!gm || !/^[\w:.-]{1,40}$/.test(key)) return NOT_GM;
    const c = await call('DELETE', `/rooms/${encodeURIComponent(gm.code)}/kicks/${encodeURIComponent(key)}`, undefined, gm.key);
    if (c.ok) showKicked(c.data, gen);
    return c;
  }
  /** What a GM's action answers on a phone not live in a room as GM, or for a key that is not a hunter's: nothing was asked. */
  const NOT_GM: Call = { ok: false, why: 'refused', reason: 'not the GM of a live room' };
  /** The `_kicked` doc the server answered a removal route with, shown at once while this phone is still in that stretch of the link. */
  function showKicked(answer: unknown, gen: Gen): void {
    const data = DOCS.kicked(isObj(answer) ? answer.kicked : null);
    if (!data || shown.gen !== gen || link.gen !== gen) return;
    shown = { ...shown, docs: { ...shown.docs, kicked: { at: new Date(Date.now() + srvSkew).toISOString(), from: deviceId() as DeviceId, data } } };
    app.emit('sync:docs', { docs: shown.docs });
  }
  /** Removed less than 10 minutes ago: `[{ key, name, at }]`. */
  function recentKicks(): { key: string; at: string; name: string }[] {
    const d0 = doc('kicked'), now = Date.now() + srvSkew, names: Record<string, string> = d0?.names ?? {};
    return Object.entries(d0?.keys ?? {}).filter(([, t]) => now - Date.parse(t) < KICK_MS).map(([key, at]) => ({ key, at, name: names[key] || 'Hunter' }));
  }
  /** The GM frees a device's claim on its sheets, so the player's phone (or a new one) can claim them on its next write. */
  async function releaseSheet(key: string): Promise<Call> {
    const gm = gmRoom(), sheet = parseSheetKey(key);
    if (!gm || !sheet) return NOT_GM;
    return call('POST', `/rooms/${encodeURIComponent(gm.code)}/release`, { device: deviceOf(sheet) }, gm.key);
  }
  /** Forget the GM key of a room. Forgetting the key of the room this phone runs leaves that room. */
  function forgetKey(code: string): void {
    const key = (sy().gmKeys || {})[code]; if (!key) return;
    if (gmRoom()?.code === code) linkDo({ type: 'leave' });
    store.apply('gmkeys-forget', atSync(s => ringGone(s, code)));
  }

  // ── the Room view's live code check ──
  /** code -> what the server said and when. Reused for 30 s, a "no such room" too. */
  const peeked = new Map<RoomCode, { at: number; exists: boolean }>();
  /** `{ ok: true, exists, gm }`, or `{ ok: false }` when the server was not reached. Never throws. Moves nothing. */
  async function check(text: unknown): Promise<{ ok: true; exists: boolean; gm: boolean } | { ok: false }> {
    const code = parseInvite(text);
    if (!code) return { ok: true, exists: false, gm: false };
    const gm = !!keyFor(code), p = peeked.get(code);
    if (p && Date.now() - p.at < PEEK_REUSE_MS) return { ok: true, exists: p.exists, gm };
    if (link.at === 'off' || link.at === 'upgrading') return { ok: false };
    let a: Answer;
    try { a = await fetchApi('GET', `/rooms/${code}?peek=1`, { timeoutMs: REQ_MS }); } catch (e) { failKind(e); return { ok: false }; }
    if (a.status !== 200 && a.status !== 404) return { ok: false };
    const exists = a.status === 200 && !(isObj(a.data) && a.data.exists === false);
    peeked.set(code, { at: Date.now(), exists });
    return { ok: true, exists, gm };
  }

  // ── what the pill and the views show ──
  const conn = (): Connection => connection(link, push, [...publishing.values()].some(p => p.tooBig), stalled(box(), room()));
  /** Coarser than `conn`: is there a server here at all, and is it answering. */
  const status = (): 'off' | 'offline' | 'connected' => {
    const c = conn();
    return c === 'off' ? 'off' : c === 'unreachable' || c === 'reconnecting' || c === 'connecting' || c === 'upgrading' || (link.at === 'idle' && link.server === 'unknown') ? 'offline' : 'connected';
  };
  /** Tells the views the link, the push or the outbox changed; `serverBack` when the server answers again after failing. */
  function emitStatus(serverBack = false): void { republish(); app.emit('sync:status', { status: status(), room: room(), conn: conn(), serverBack }); }
  /** The last room, for a one-tap return. A room the GM removed this phone from offers none. */
  function lastRoom(): { code: RoomCode; gone: boolean; gm: boolean } | null {
    const l: Link = link.at === 'creating' || link.at === 'joining' ? link.back : link;
    const last = l.at === 'idle' || l.at === 'live' ? l.last : null;
    return last && last.why !== 'removed' ? { code: last.code, gone: last.why === 'gone', gm: !!keyFor(last.code) } : null;
  }
  const locked = (): boolean => push.at === 'locked' || (push.at === 'sending' && push.locked);
  /** The sheet has changes the server does not have yet. */
  const unsent = (): boolean => push.at !== 'off' && push.at !== 'clean';
  const detail = () => ({ conn: conn(), room: room(), lastOk, online: navigator.onLine, unsent: unsent(), locked: locked(), waiting: waiting(box(), room()),
    joining: link.at === 'joining' ? link.code : null });
  const nInt = (x: unknown, max = 99999): number => Math.max(-max, Math.min(max, Math.trunc(Number(x)) || 0));
  /** Since `iso` on the server's clock, in words. */
  const agoS = (iso: string | null): string => {
    const t = Date.parse(iso || ''); if (!Number.isFinite(t)) return '';
    const m = Math.round((Date.now() + srvSkew - t) / 60000);
    return m < 1 ? 'just now' : m < 60 ? `${m} min` : m < 1440 ? `${Math.round(m / 60)} h` : `${Math.round(m / 1440)} d`;
  };
  /** The GM's list of sheets, online (polled in the last 15 s), away, or unknown when the server sent no presence. */
  function roster(): ReturnType<SyncApi['roster']> {
    const now = Date.now() + srvSkew, presenceOk = view().presenceOk;
    return remoteSheets().map((r): ReturnType<SyncApi['roster']>[number] => {
      const d = r.data, t = Date.parse(r.polledAt || '');
      return { key: r.key, name: d.name, level: d.level, job: d.job ?? '',
        state: !presenceOk ? 'unknown' : Number.isFinite(t) && now - t < ONLINE_MS ? 'online' : 'away', seen: agoS(r.polledAt || r.at) };
    }).sort((a, b) => (a.state === 'online' ? 0 : 1) - (b.state === 'online' ? 0 : 1));
  }
  /** An invite link: this app's address and `?room=CODE`. Only the code travels; the GM key never goes in a link. */
  const inviteLink = (code: string | null = room()): string => (code ? `${location.origin}${location.pathname}?room=${encodeURIComponent(code)}` : '');

  // ── public API: the names the views use ──
  app.api.sync = { // checked against SyncApi in src/core/api.ts
    status, conn, detail, room, event, once, remoteSheets, myKey, doc, inviteLink,
    post: (ev, o) => (ev ? postLetter({ kind: 'event', event: ev }, o?.key ?? null) : { ok: false, why: 'notEvent' }),
    flush: (): void => { flush(); },
    publish: (name, build) => { publishers.set(name, build); },
    invite: () => invited, dropInvite: (): void => setInvite(null),
    create: tapped(create), parseInvite, check, joinRoom: tapped(joinRoom), rejoinGM: tapped(rejoinGM), roster, lastRoom, bound, switchTo, forgetKey,
    leave: (): void => linkDo({ type: 'leave' }),
    forgetLast: (): void => linkDo({ type: 'forget' }),
    retry: async (): Promise<void> => linkDo({ type: 'retry' }),
    gmRooms: () => Object.keys(sy().gmKeys || {}).reverse().map(code => ({ code, current: code === room() })), // newest first
    kick: kickSheet, allowBack, recentKicks, release: releaseSheet, forget,
  };

  // ── the page and the network ──
  app.on('change', change => {
    if (store.readOnly) linkDo({ type: 'readOnly' });
    else if (change.replaced || (change.reason === 'storage' && otherRoom())) linkDo({ type: 'replaced', room: storedRoom(), last: storedLast(sy().lastRoom) });
    if (change.replaced) removalDo({ type: 'replaced' });
    bindHeard();
    republish();
  });
  /**
   * Tells the push what a change did to the bound sheet: another hunter bound, by whichever write (a join, "Play as", a
   * delete of the bound one, a save swapped in), is `rebound`, which wakes a push that is locked or backing off
   * (SMX-sync-2.1); an edit of the same one is `changed`.
   */
  function bindHeard(): void {
    const h = bound(), id = h?.id ?? null;
    if (id !== boundSeen) { boundSeen = id; if (push.at !== 'off' && h) pushDo({ type: 'rebound' }); return; }
    if (push.at !== 'off' && h && JSON.stringify(pushedSheet(h)) !== sheetText) pushDo({ type: 'changed' });
  }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') linkDo({ type: 'visible' }); });
  addEventListener('online', () => linkDo({ type: 'online' })); // the link polls at once, and a good poll sends what waits
  addEventListener('offline', () => linkDo({ type: 'offline' }));
  addEventListener('pageshow', e => { if (e.persisted) linkDo({ type: 'visible' }); });

  // ?room=CODE in the address: strip it, then show the invite in the Room view (first-run onboarding prefills its room field instead)
  {
    const u = new URL(location.href), c = (u.searchParams.get('room') || '').toUpperCase();
    if (u.searchParams.has('room')) { u.searchParams.delete('room'); history.replaceState(history.state, '', u.pathname + (u.search || '') + u.hash); }
    const code = parseRoomCode(c);
    if (code) {
      setInvite(code);
      spendInvite(false);
      if (store.get().settings.onboarded) app.go('room'); // the Room view shows the invite, or the room it is spent on
    }
  }

  // ── boot ──
  unheard();
  runLink(started.effects, started.state, null);
  if (web && 'serviceWorker' in navigator) {
    // a worker that does not register leaves the app working online and not offline: logged, as the player cannot act on it
    const register = (): void => { navigator.serviceWorker.register('sw.js').catch(e => reported('sync:worker', e)); };
    addEventListener('load', register);
    if (document.readyState === 'complete') register();
  }
}
