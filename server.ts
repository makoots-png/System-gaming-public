// server.ts: serves the built app and the "campaign room" API for The Hunter System. Bun only, no dependencies.
// Only files that scripts/build.ts produced are served, so nothing else in the repo is reachable.
// The server's rules (a room's life, a removal's window, the database's life) are in src/core/room-server.ts; what a
// message, sheet or doc may hold is src/core/protocol.ts. Everything a room holds is in its store: this file keeps no
// room state of its own, so a restart changes nothing a player sees.

import { CODE_CHARS, CODE_LEN } from './src/core/ids.ts';
import { buildApp, type Built } from './scripts/build.ts';
import { DOCS, DOC_MAX, SHEET_MAX, WIRES, wireDocs, EVENTS, ROOM_PAGE, deviceOf, isEventType, parseDeviceId, parseDocName, parseEvent, parseRoomCode, parseSheet, parseSheetKey, sentAgain, servedTo, sheetFor, speaksFor } from './src/core/protocol.ts';
import type { DeviceId, DocName, EventId, DocOf, KickedDoc, RoomCode, RoomDocs, RoomEvent, RoomState, RoomSheet, ServedSheet, SheetKey, Stored, StoredEvent, RoomViewer } from './src/core/protocol.ts';
import { DB_RETRY_MS, dbHealth, dbStep, kickedAfter, liveSince, pushed, roomLive } from './src/core/room-server.ts';
import type { Db, DbEvent, Pushed, RemovalChange } from './src/core/room-server.ts';
import { ownedBy, ownerOf, ownerStep, parseTokenHash } from './src/core/sync/owner.ts';
import type { Owner, OwnerEvent, TokenHash } from './src/core/sync/owner.ts';

const NO_CACHE = /\.(html|js|css)$/;
const BASE_HEADERS = { 'Server-Timing': 'hunter-api', 'X-Content-Type-Options': 'nosniff' };

/** A value made on first use and kept: the build, and this process's database. */
function once<T>(make: () => T): () => T {
  let made: { value: T } | null = null;
  return () => (made ??= { value: make() }).value;
}
const built = once((): Promise<Built> => buildApp());

async function staticFile(path: string): Promise<Response | null> {
  const file = (await built()).files.get(path);
  if (!file) return null;
  const headers: Record<string, string> = { ...BASE_HEADERS, 'Content-Type': file.type };
  if (NO_CACHE.test(path)) headers['Cache-Control'] = 'no-cache';
  return new Response(file.body, { headers });
}

const iso = (ms: number) => new Date(ms).toISOString();
const messageOf = (e: unknown): string => (e instanceof Error ? e.message : String(e));
/** An error's code (Bun's Postgres errors carry one, ERR_POSTGRES_CONNECTION_REFUSED), safe to show: no host, no user. */
const codeOf = (e: unknown): string => {
  const code = e instanceof Error && 'code' in e ? e.code : null;
  return typeof code === 'string' && /^[A-Z0-9_]{1,60}$/.test(code) ? code : 'unreachable';
};

// ── the store ──
/** Who the `_kicked` doc is from: the server writes it, no phone. */
const SERVER_DEVICE = 'server' as DeviceId;
const MAX_BODY = 64 * 1024, MEM_ROOMS = 2000, PRESENCE_MAX = 200;
/**
 * The most events a room keeps in the memory store, only to bound the process's memory: past it the room refuses a new
 * event (`room full`) and forgets none, so every phone reads every message it was sent and an event id is taken once for
 * the room's life, as in Postgres, which has no such bound. A guess at many long sessions (notes-5-trade.md 12.7).
 */
export const MEM_EVENTS = 20_000;
/** A page of a room's events after a cursor: where to ask from next, and whether the page was full. */
type Page = { events: StoredEvent[]; next: number; more: boolean };
/** What a room holds besides its events: the hunter sheets by key and the room docs by name. */
type Board = { sheets: Record<SheetKey, Stored<RoomSheet>>; docs: RoomDocs };
/**
 * Where rooms live. It keeps only what a protocol parser accepted and answers it typed; Postgres rows are parsed again
 * on the way out, since the database is outside the process. `now` is the request's clock, read once per request.
 * Presence (each phone's last poll) is kept in the process, never written to the database (S04), and goes with its room.
 */
export interface Store {
  readonly kind: 'postgres' | 'memory';
  /** Throws when the store cannot answer now; /api/health asks it. */
  check(): Promise<void>;
  /** Removes every room that is not live at `now`, with its events, sheets, owners and presence. The only sweep. */
  sweep(now: number): Promise<RoomCode[]>;
  /** False when the code is taken (or the memory store is full). Every room has a GM key. */
  create(code: RoomCode, keyHash: string, now: number): Promise<boolean>;
  /** Null when there is no such room. */
  keyHash(code: RoomCode): Promise<string | null>;
  /** Marks a live room used at `now`; false when it is unknown or no longer live. */
  touch(code: RoomCode, now: number): Promise<boolean>;
  /** As touch, but leaves the room's last use where it was. */
  exists(code: RoomCode, now: number): Promise<boolean>;
  /**
   * Stores the event as the room's next and answers its seq. The same event again under an id the room holds (a
   * phone's outbox sends again what got no answer, or an offer's later end: `sentAgain` in src/core/protocol.ts)
   * answers the stored event's seq and stores nothing; a different event under that id answers `idTaken` and stores
   * nothing. A store keeps every event of a live room; null: the room is full and stores no more (the memory store past
   * `MEM_EVENTS`).
   */
  addEvent(code: RoomCode, from: DeviceId, event: RoomEvent, now: number): Promise<number | 'idTaken' | null>;
  events(code: RoomCode, after: number): Promise<Page>;
  /** The room whole, every sheet and doc parsed, for a poll. No change of the room reads it: each is one call below. */
  board(code: RoomCode): Promise<Board>;
  /**
   * Keeps the pushed sheet unless `pushed` (src/core/room-server.ts) refuses it: its hunter was removed lately, or the
   * room is full. One change of the room: no removal and no other push comes between its read and its write.
   */
  pushSheet(code: RoomCode, key: SheetKey, from: DeviceId, sheet: RoomSheet, now: number): Promise<Pushed>;
  /**
   * The GM removes `key`'s hunter (its sheet out of the room, its phone's slot moved by `removed` with the phone's sheets
   * left, so freed only with its last, the removal in the `_kicked` doc under the name the board showed) or allows it
   * back (the removal lifted). Answers the doc after. One change of the room, as `pushSheet`: the `_kicked` doc has no
   * other writer, so no removal is lost to another.
   */
  setRemoval(code: RoomCode, key: SheetKey, change: RemovalChange, now: number): Promise<KickedDoc>;
  /** Any doc but `kicked`, which only `setRemoval` writes. */
  putDoc<K extends Exclude<DocName, 'kicked'>>(code: RoomCode, name: K, from: DeviceId, doc: DocOf<K>, now: number): Promise<void>;
  /** `dev`'s slot in this room: which phone's token speaks for its sheets (S07, src/core/sync/owner.ts). A read. */
  owner(code: RoomCode, dev: DeviceId): Promise<Owner>;
  /**
   * Moves `dev`'s slot by `ownerStep` and answers it after: a phone's write (the first writer of a free slot binds it)
   * or the GM's release. One change of the room, so of two first writes at once one binds and the other is refused.
   * A removal moves it inside `setRemoval`, which alone knows how many of the phone's sheets are left.
   */
  moveOwner(code: RoomCode, dev: DeviceId, event: Exclude<OwnerEvent, { type: 'removed' }>): Promise<Owner>;
  see(code: RoomCode, dev: DeviceId, now: number): void;
  presence(code: RoomCode): ReadonlyMap<DeviceId, number>;
  close(): Promise<void>;
}

/** Each live room's phones and their last poll. At `PRESENCE_MAX` phones the stalest goes, so a real player is never refused. */
function presenceBook() {
  const rooms = new Map<RoomCode, Map<DeviceId, number>>();
  return {
    see(code: RoomCode, dev: DeviceId, now: number): void {
      let m = rooms.get(code);
      if (!m) rooms.set(code, m = new Map());
      if (!m.has(dev) && m.size >= PRESENCE_MAX) {
        let stalest: DeviceId | null = null;
        for (const [d, t] of m) if (stalest === null || t < m.get(stalest)!) stalest = d;
        if (stalest !== null) m.delete(stalest);
      }
      m.set(dev, now);
    },
    of: (code: RoomCode): ReadonlyMap<DeviceId, number> => rooms.get(code) ?? new Map(),
    drop(codes: readonly RoomCode[]): void { for (const c of codes) rooms.delete(c); },
  };
}

/** A doc kept under its name. One generic step, so each name keeps its own doc type. */
function withDoc<K extends DocName>(docs: RoomDocs, name: K, doc: Stored<DocOf<K>>): void {
  const typed: { [P in K]?: Stored<DocOf<P>> } = docs;
  typed[name] = doc;
}

/** The name a removal keeps for a sheet: its hunter's, or none for a tombstone or no sheet. */
const nameOn = (sheet: RoomSheet | null): string => (sheet && 'hunter' in sheet ? sheet.hunter.name : '');

/** A room in memory. `events[i]` has seq i + 1, since the store forgets none; `ids` answers an event id's seq. */
type MemRoom = { touched: number; events: StoredEvent[]; ids: Map<EventId, number>; board: Board; keyHash: string; owners: Map<DeviceId, TokenHash> };
/** The slot `dev` has in a memory room. */
const memOwner = (r: MemRoom, dev: DeviceId): Owner => ownerOf(r.owners.get(dev) ?? null);
/** Keeps `o` as `dev`'s slot in a memory room: a free slot holds no row. */
function keepMemOwner(r: MemRoom, dev: DeviceId, o: Owner): Owner {
  if (o.at === 'bound') r.owners.set(dev, o.hash); else r.owners.delete(dev);
  return o;
}
export function memoryStore(): Store {
  const rooms = new Map<RoomCode, MemRoom>(), book = presenceBook();
  /** A room a route already touched in this request. */
  const room = (code: RoomCode): MemRoom => {
    const r = rooms.get(code);
    if (!r) throw new Error(`no room ${code}`);
    return r;
  };
  const live = (code: RoomCode, now: number): MemRoom | null => {
    const r = rooms.get(code);
    return r && roomLive(r.touched, now) ? r : null;
  };
  return {
    kind: 'memory',
    async check() {},
    async sweep(now) {
      const gone = [...rooms].filter(([, r]) => !roomLive(r.touched, now)).map(([c]) => c);
      for (const c of gone) rooms.delete(c);
      book.drop(gone);
      return gone;
    },
    async create(code, keyHash, now) {
      if (rooms.size >= MEM_ROOMS || rooms.has(code)) return false;
      rooms.set(code, { touched: now, events: [], ids: new Map(), board: { sheets: {}, docs: {} }, keyHash, owners: new Map() });
      return true;
    },
    async keyHash(code) { return rooms.get(code)?.keyHash ?? null; },
    async touch(code, now) { const r = live(code, now); if (r) r.touched = now; return !!r; },
    async exists(code, now) { return !!live(code, now); },
    async addEvent(code, from, event, now) {
      const r = room(code), held = r.ids.get(event.payload.eid);
      if (held !== undefined) { const was = r.events[held - 1]; return was && sentAgain(was, event) ? held : 'idTaken'; }
      if (r.events.length >= MEM_EVENTS) return null;
      const seq = r.events.length + 1;
      r.events.push({ ...event, seq, at: iso(now), from });
      r.ids.set(event.payload.eid, seq);
      return seq;
    },
    async events(code, after) {
      const events = room(code).events.slice(after, after + ROOM_PAGE);
      return { events, next: events.length ? events[events.length - 1]!.seq : after, more: events.length >= ROOM_PAGE };
    },
    async board(code) { const b = room(code).board; return { sheets: { ...b.sheets }, docs: { ...b.docs } }; },
    // each of the three is one synchronous step, so no other request runs inside it
    async pushSheet(code, key, from, sheet, now) {
      const { sheets, docs } = room(code).board;
      const answer = pushed(docs.kicked?.data ?? null, key, key in sheets, Object.keys(sheets).length, now);
      if (answer === 'stored') sheets[key] = { at: iso(now), from, data: sheet };
      return answer;
    },
    async setRemoval(code, key, change, now) {
      const r = room(code), { sheets, docs } = r.board;
      const name = change === 'remove' ? nameOn(sheets[key]?.data ?? null) : null;
      if (change === 'remove') {
        delete sheets[key];
        const dev = deviceOf(key), left = Object.keys(sheets).filter(k => deviceOf(k as SheetKey) === dev).length;
        keepMemOwner(r, dev, ownerStep(memOwner(r, dev), { type: 'removed', left }));
      }
      const doc = kickedAfter(docs.kicked?.data ?? null, key, name, now);
      docs.kicked = { at: iso(now), from: SERVER_DEVICE, data: doc };
      return doc;
    },
    async putDoc(code, name, from, doc, now) { withDoc(room(code).board.docs, name, { at: iso(now), from, data: doc }); },
    async owner(code, dev) { return memOwner(room(code), dev); },
    async moveOwner(code, dev, event) { const r = room(code); return keepMemOwner(r, dev, ownerStep(memOwner(r, dev), event)); },
    see: book.see,
    presence: book.of,
    async close() {},
  };
}

/** A stored row no parser of this build reads (a room from another build). It is left out of the answer, said in the log. */
function unread(what: string, code: RoomCode, at: string): [] {
  console.warn(`[server] room ${code}: ${what} ${at} is not one this build reads; left out`);
  return [];
}

/** Opens Postgres at `url` and makes its tables. Throws when Postgres does not answer: the caller's database is then down. */
export async function postgresStore(url: string): Promise<Store> {
  const db = new Bun.SQL(url), book = presenceBook();
  try {
    await db`CREATE TABLE IF NOT EXISTS rooms (code text PRIMARY KEY, created bigint NOT NULL, touched bigint NOT NULL)`;
    await db`CREATE TABLE IF NOT EXISTS events (room text NOT NULL, seq integer NOT NULL, at bigint NOT NULL, from_id text NOT NULL, type text NOT NULL, payload jsonb NOT NULL, PRIMARY KEY (room, seq))`;
    await db`CREATE TABLE IF NOT EXISTS sheets (room text NOT NULL, hid text NOT NULL, at bigint NOT NULL, from_id text NOT NULL, data jsonb NOT NULL, PRIMARY KEY (room, hid))`;
    await db`ALTER TABLE rooms ADD COLUMN IF NOT EXISTS gm_key_hash text`;
    await db`CREATE TABLE IF NOT EXISTS sheet_owners (room text NOT NULL, device text NOT NULL, token_hash text NOT NULL, PRIMARY KEY (room, device))`;
    // A room's last seq is its own counter, taken under the room's row lock; an event id is held once per room. Rows of
    // builds before this one: the counter is raised to the room's highest seq and each event's id is read from its
    // payload (a repeat of an id keeps none). Both change nothing when run again.
    await db`ALTER TABLE rooms ADD COLUMN IF NOT EXISTS seq integer NOT NULL DEFAULT 0`;
    await db`ALTER TABLE events ADD COLUMN IF NOT EXISTS eid text`;
    await db`UPDATE rooms SET seq = e.top FROM (SELECT room, MAX(seq) AS top FROM events GROUP BY room) e WHERE rooms.code = e.room AND rooms.seq < e.top`;
    await db`UPDATE events e SET eid = e.payload->>'eid' WHERE e.eid IS NULL AND NOT EXISTS (SELECT 1 FROM events o WHERE o.room = e.room AND o.seq < e.seq AND o.payload->>'eid' = e.payload->>'eid')`;
    await db`CREATE UNIQUE INDEX IF NOT EXISTS events_eid ON events (room, eid)`;
    // Builds before this one bound the JSON text, which Bun sends as a JSON string, so a row held a string of JSON.
    // Unwrapped once; a row already an object is left as it is, so this runs at every start and changes nothing after.
    await db`UPDATE events SET payload = (payload #>> '{}')::jsonb WHERE jsonb_typeof(payload) = 'string'`;
    await db`UPDATE sheets SET data = (data #>> '{}')::jsonb WHERE jsonb_typeof(data) = 'string'`;
  } catch (e) {
    await db.close();
    throw e;
  }
  const text = (v: unknown): string | null => (typeof v === 'string' ? v : null);
  // A value is bound as itself: Bun sends an object as JSON, and a string as a JSON string.
  const put = async (q: BunSqlTx, code: RoomCode, hid: string, from: DeviceId, data: object, now: number): Promise<void> => {
    await q`INSERT INTO sheets (room, hid, at, from_id, data) VALUES (${code}, ${hid}, ${now}, ${from}, ${data}::jsonb)
      ON CONFLICT (room, hid) DO UPDATE SET at = EXCLUDED.at, from_id = EXCLUDED.from_id, data = EXCLUDED.data`;
  };
  /**
   * `change` as one change of the room: its row is locked until the transaction ends, so a second one of the same room
   * waits and reads what the first wrote. `kicked` is the room's `_kicked` doc as the change finds it.
   */
  const inRoom = <T>(code: RoomCode, change: (tx: BunSqlTx, kicked: KickedDoc | null) => Promise<T>): Promise<T> => db.begin(async tx => {
    if (!(await tx`SELECT code FROM rooms WHERE code = ${code} FOR UPDATE`).length) throw new Error(`no room ${code}`);
    const [row] = await tx`SELECT data FROM sheets WHERE room = ${code} AND hid = '_kicked'`;
    return change(tx, row ? DOCS.kicked(row.data) : null);
  });
  const ownerIn = async (q: BunSqlTx, code: RoomCode, dev: DeviceId): Promise<Owner> =>
    ownerOf(parseTokenHash((await q`SELECT token_hash FROM sheet_owners WHERE room = ${code} AND device = ${dev}`)[0]?.token_hash));
  /** `dev`'s slot moved by `event` inside a change of the room (`inRoom`): `ownerStep` decides, the row follows. */
  const moveIn = async (tx: BunSqlTx, code: RoomCode, dev: DeviceId, event: OwnerEvent): Promise<Owner> => {
    const was = await ownerIn(tx, code, dev), after = ownerStep(was, event);
    if (after === was) return was;
    if (after.at === 'free') await tx`DELETE FROM sheet_owners WHERE room = ${code} AND device = ${dev}`;
    else await tx`INSERT INTO sheet_owners (room, device, token_hash) VALUES (${code}, ${dev}, ${after.hash}) ON CONFLICT (room, device) DO UPDATE SET token_hash = EXCLUDED.token_hash`;
    return after;
  };
  return {
    kind: 'postgres',
    async check() { await db`SELECT 1`; },
    async sweep(now) {
      const gone = (await db`DELETE FROM rooms WHERE touched < ${liveSince(now)} RETURNING code`).flatMap(r => { const c = parseRoomCode(r.code); return c ? [c] : []; });
      await db`DELETE FROM events WHERE NOT EXISTS (SELECT 1 FROM rooms WHERE rooms.code = events.room)`;
      await db`DELETE FROM sheets WHERE NOT EXISTS (SELECT 1 FROM rooms WHERE rooms.code = sheets.room)`;
      await db`DELETE FROM sheet_owners WHERE NOT EXISTS (SELECT 1 FROM rooms WHERE rooms.code = sheet_owners.room)`;
      book.drop(gone);
      return gone;
    },
    async create(code, keyHash, now) {
      const r = await db`INSERT INTO rooms (code, created, touched, gm_key_hash) VALUES (${code}, ${now}, ${now}, ${keyHash}) ON CONFLICT (code) DO NOTHING RETURNING code`;
      return r.length > 0;
    },
    async keyHash(code) { return text((await db`SELECT gm_key_hash FROM rooms WHERE code = ${code}`)[0]?.gm_key_hash); },
    async touch(code, now) { return (await db`UPDATE rooms SET touched = ${now} WHERE code = ${code} AND touched >= ${liveSince(now)} RETURNING code`).length > 0; },
    async exists(code, now) { return (await db`SELECT code FROM rooms WHERE code = ${code} AND touched >= ${liveSince(now)}`).length > 0; },
    async addEvent(code, from, event, now) {
      const { type, payload } = event;
      // the room's row is locked until the event is in: two writers take seqs one after the other, and an id sent twice
      // finds its first copy
      return db.begin(async (tx): Promise<number | 'idTaken'> => {
        const [r] = await tx`SELECT seq FROM rooms WHERE code = ${code} FOR UPDATE`;
        if (!r) throw new Error(`no room ${code}`);
        const [held] = await tx`SELECT seq, type, payload FROM events WHERE room = ${code} AND eid = ${payload.eid}`;
        if (held) { const was = parseEvent(held.type, held.payload); return was && sentAgain(was, event) ? Number(held.seq) : 'idTaken'; }
        const seq = Number(r.seq) + 1;
        await tx`UPDATE rooms SET seq = ${seq} WHERE code = ${code}`;
        await tx`INSERT INTO events (room, seq, at, from_id, type, payload, eid) VALUES (${code}, ${seq}, ${now}, ${from}, ${type}, ${payload}::jsonb, ${payload.eid})`;
        return seq;
      });
    },
    async events(code, after) {
      const rows = await db`SELECT seq, at, from_id, type, payload FROM events WHERE room = ${code} AND seq > ${after} ORDER BY seq LIMIT ${ROOM_PAGE}`;
      const events = rows.flatMap((r): StoredEvent[] => {
        const event = parseEvent(r.type, r.payload), from = parseDeviceId(r.from_id), seq = Number(r.seq);
        return event && from ? [{ ...event, seq, at: iso(Number(r.at)), from }] : unread('event', code, String(seq));
      });
      return { events, next: rows.length ? Number(rows[rows.length - 1]!.seq) : after, more: rows.length >= ROOM_PAGE };
    },
    async board(code) {
      const board: Board = { sheets: {}, docs: {} };
      const readDoc = <K extends DocName>(name: K, at: string, from: DeviceId, data: unknown): boolean => {
        const doc = DOCS[name](data);
        if (doc) withDoc(board.docs, name, { at, from, data: doc });
        return !!doc;
      };
      for (const r of await db`SELECT hid, at, from_id, data FROM sheets WHERE room = ${code}`) {
        const hid = String(r.hid), at = iso(Number(r.at)), from = parseDeviceId(r.from_id);
        const name = hid.startsWith('_') ? parseDocName(hid.slice(1)) : null, key = hid.startsWith('_') ? null : parseSheetKey(hid);
        const sheet = key && parseSheet(key, r.data);
        if (from && name && readDoc(name, at, from, r.data)) continue;
        if (from && key && sheet) { board.sheets[key] = { at, from, data: sheet }; continue; }
        unread('row', code, hid);
      }
      return board;
    },
    async pushSheet(code, key, from, sheet, now) {
      return inRoom(code, async (tx, kicked) => {
        // a doc's row is under '_' and its name; every other row of the room is a sheet
        const [n] = await tx`SELECT COUNT(*) AS sheets, COUNT(*) FILTER (WHERE hid = ${key}) AS held FROM sheets WHERE room = ${code} AND left(hid, 1) <> '_'`;
        const answer = pushed(kicked, key, Number(n?.held) > 0, Number(n?.sheets), now);
        if (answer === 'stored') await put(tx, code, key, from, sheet, now);
        return answer;
      });
    },
    async setRemoval(code, key, change, now) {
      return inRoom(code, async (tx, kicked) => {
        let name: string | null = null;
        if (change === 'remove') {
          const [row] = await tx`DELETE FROM sheets WHERE room = ${code} AND hid = ${key} RETURNING data`;
          name = nameOn(row ? parseSheet(key, row.data) : null);
          const dev = deviceOf(key);
          const [n] = await tx`SELECT COUNT(*) AS kept FROM sheets WHERE room = ${code} AND left(hid, 1) <> '_' AND split_part(hid, ':', 1) = ${dev}`;
          await moveIn(tx, code, dev, { type: 'removed', left: Number(n?.kept) });
        }
        const doc = kickedAfter(kicked, key, name, now);
        await put(tx, code, '_kicked', SERVER_DEVICE, WIRES.kicked(doc), now);
        return doc;
      });
    },
    async putDoc(code, name, from, doc, now) { await put(db, code, '_' + name, from, WIRES[name](doc), now); },
    async owner(code, dev) { return ownerIn(db, code, dev); },
    async moveOwner(code, dev, event) { return inRoom(code, tx => moveIn(tx, code, dev, event)); },
    see: book.see,
    presence: book.of,
    async close() { await db.close(); },
  };
}

// ── the database's life (src/core/room-server.ts) ──
export type Database = { readonly kind: Store['kind']; now(): Promise<Db<Store>>; close(): Promise<void> };
/**
 * A database whose one state is `db`, moved only by `dbStep`. A store the step does not take (a try that answers after
 * the close) is closed at once, and so is a ready one's at the close: the state then holds no store.
 */
function lifeOf(start: Db<Store>) {
  let db = start;
  return {
    now: (): Db<Store> => db,
    async event(e: DbEvent<Store>): Promise<void> {
      const was = db;
      db = dbStep(db, e);
      if (e.type === 'opened' && db.at !== 'ready') await e.store.close();
      if (was.at === 'ready' && db.at === 'closed') await was.store.close();
    },
  };
}
/** A database over a store already open: a test's, or the memory store. */
export const openDatabase = (store: Store): Database => {
  const life = lifeOf({ at: 'ready', store });
  return { kind: store.kind, now: async () => life.now(), close: () => life.event({ type: 'close' }) };
};
/**
 * The rooms' database: the memory store when `url` is not set, else Postgres and only Postgres. A Postgres that does
 * not answer leaves the database down: no room route answers (503), /api/health says since when and why, the log says
 * it loudly, and it is opened again every `retryMs` until it answers or the database is closed. `now()` waits for the
 * first attempt.
 */
export function database(url: string | undefined, open: (url: string) => Promise<Store> = postgresStore, retryMs = DB_RETRY_MS): Database {
  if (!url) return openDatabase(memoryStore());
  const at = url, life = lifeOf({ at: 'opening' });
  async function attempt(): Promise<void> {
    if (life.now().at === 'closed') return; // a try set before the close
    let store: Store;
    try {
      store = await open(at);
    } catch (e) {
      await life.event({ type: 'failed', at: Date.now(), error: codeOf(e) });
      const down = life.now().at === 'down';
      console.error(`[server] DATABASE_URL is set and Postgres does not answer (${messageOf(e)}). ${down ? `No room is served and /api/health answers 503 until it does. Trying again in ${retryMs / 1000} s.` : 'The database is closed: no more tries.'}`);
      if (down) setTimeout(() => { void attempt(); }, retryMs);
      return;
    }
    await life.event({ type: 'opened', store });
    if (life.now().at === 'ready') console.log('[server] Postgres answers: rooms are served');
  }
  const first = attempt();
  return {
    kind: 'postgres',
    now: async () => { await first; return life.now(); },
    close: () => life.event({ type: 'close' }),
  };
}

// ── API ──
const J = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...BASE_HEADERS, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const newKey = () => Array.from(crypto.getRandomValues(new Uint8Array(32)), b => CODE_CHARS[b % CODE_CHARS.length]).join('');
const sha = async (t: string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t))), b => b.toString(16).padStart(2, '0')).join('');
/** Every code has a digit, so a code in a message never reads like a word ("thanks"): src/core/sync/invite.ts relies on it. */
function newCode(): RoomCode {
  for (;;) {
    const code = parseRoomCode(Array.from(crypto.getRandomValues(new Uint8Array(CODE_LEN)), b => CODE_CHARS[b % CODE_CHARS.length]).join(''));
    if (code && /\d/.test(code)) return code;
  }
}

/** True when the request carries the room's GM key (a constant-time compare of hashes). */
async function gmOk(req: Request, st: Store, code: RoomCode): Promise<boolean> {
  const want = await st.keyHash(code); if (!want) return false;
  const got = await sha(req.headers.get('x-gm-key') || '');
  let d = got.length ^ want.length; for (let i = 0; i < want.length; i++) d |= (got.charCodeAt(i) || 0) ^ want.charCodeAt(i);
  return d === 0;
}
/** The hash of the request's device token, or null when it carries none of the app's form: such a request proves nothing. */
async function tokenOf(req: Request): Promise<TokenHash | null> {
  const tok = req.headers.get('x-device-token') || '';
  return tok.length < 16 || tok.length > 128 ? null : parseTokenHash(await sha(tok));
}
/**
 * S07: whether this poll comes from the phone `dev`: its token is the one `dev`'s slot is bound to. A read moves no
 * slot (src/core/sync/owner.ts), so a phone that polls with another's device id never takes it; a phone is bound by
 * its first write, the sheet push that follows its join.
 */
async function proven(req: Request, st: Store, code: RoomCode, dev: DeviceId): Promise<boolean> {
  const hash = await tokenOf(req);
  return hash !== null && ownedBy(await st.owner(code, dev), hash);
}
/** Whether this request may write for the phone `dev`: the GM's key, or `dev`'s token, whose write binds a free slot. */
async function mayWriteFor(req: Request, st: Store, code: RoomCode, dev: DeviceId, gm: boolean): Promise<boolean> {
  if (gm) return true;
  const hash = await tokenOf(req);
  return hash !== null && ownedBy(await st.moveOwner(code, dev, { type: 'write', hash }), hash);
}
/**
 * What the faces of a poll carry: every table shows its bags until the trading switch lands with unit 4, which reads it
 * here from the rules doc (notes-5-trade.md 10, ruling 4: a table with trading off sends faces without bag lines).
 */
const FACE_BAGS = { bags: true } as const;

async function readJson(req: Request): Promise<Record<string, unknown> | Response> {
  const len = Number(req.headers.get('content-length') || 0);
  if (len > MAX_BODY) return J({ error: 'too large' }, 413);
  const text = await req.text();
  if (new TextEncoder().encode(text).length > MAX_BODY) return J({ error: 'too large' }, 413);
  try { const v = JSON.parse(text); return isObj(v) ? v : J({ error: 'bad json' }, 400); } catch { return J({ error: 'bad json' }, 400); } // the client sent a body that is not JSON
}

async function api(req: Request, parts: string[], database: Database): Promise<Response> {
  const m = req.method, now = Date.now(), db = await database.now();
  if (parts[0] === 'health' && parts.length === 1) {
    if (db.at === 'ready') {
      try { await db.store.check(); } catch (e) {
        console.error(`[server] Postgres stopped answering (${messageOf(e)})`);
        return J({ ok: false, db: database.kind, error: codeOf(e) }, 503);
      }
    }
    const health = dbHealth(db, database.kind);
    return J(health.body, health.status);
  }
  if (parts[0] !== 'rooms') return J({ error: 'not found' }, 404);
  // Build handshake: an app from another build may speak another wire format, so no room route answers it.
  // Nothing is touched or written. The client updates itself and reloads (src/edge/upgrade.ts).
  const { build } = await built();
  if (req.headers.get('X-Hunter-Build') !== build) return J({ error: 'upgrade', build }, 426);
  // A database that does not answer serves no room. Never 404: a phone would take its room for gone.
  if (db.at !== 'ready') return J({ error: 'no database' }, 503);
  const st = db.store;
  if (parts.length === 1) {
    if (m !== 'POST') return J({ error: 'method' }, 405);
    await st.sweep(now);
    for (let i = 0; i < 8; i++) {
      const code = newCode(), gmKey = newKey();
      if (await st.create(code, await sha(gmKey), now)) return J({ code, gmKey });
    }
    return J({ error: 'busy' }, 503);
  }
  const code = parseRoomCode((parts[1] ?? '').toUpperCase()), query = new URL(req.url).searchParams;
  // a typed code is checked before joining: always 200, so a wrong code prints no console error and downloads nothing
  if (parts.length === 2 && m === 'GET' && query.get('peek') === '1') return J({ exists: !!code && (await st.exists(code, now)) }); // a peek is not a use: it never keeps a dead room alive
  if (!code || !(await st.touch(code, now))) return J({ error: 'no such room' }, 404);
  const gm = await gmOk(req, st, code);
  if (parts.length === 2) {
    if (m !== 'GET') return J({ error: 'method' }, 405);
    const after = Math.max(0, Math.floor(Number(query.get('after'))) || 0);
    const dev = parseDeviceId(query.get('d'));
    if (dev) st.see(code, dev, now);
    // each phone gets what is for it (src/core/protocol.ts `servedTo`, `sheetFor`); the cursor passes what it did not get
    const viewer: RoomViewer = gm ? { kind: 'gm' } : dev && (await proven(req, st, code, dev)) ? { kind: 'phone', device: dev } : { kind: 'anyone' };
    const [page, board] = await Promise.all([st.events(code, after), st.board(code)]);
    const sheets: Record<SheetKey, Stored<ServedSheet>> = {};
    for (const [key, s] of Object.entries(board.sheets) as [SheetKey, Stored<RoomSheet>][]) sheets[key] = { ...s, data: sheetFor(key, s.data, viewer, FACE_BAGS) };
    const answer: RoomState = {
      gm,
      now: iso(now), // S11: server clock for everyone (joinedAt / kick stamps); presence stays GM-only
      ...(gm ? { presence: Object.fromEntries([...st.presence(code)].map(([d, t]) => [d, iso(t)])) } : {}),
      events: page.events.filter(e => servedTo(e, viewer)), next: page.next, more: page.more, sheets, docs: board.docs,
    };
    // the docs go out in the shape `DOCS` reads (`WIRES`); the store keeps them as read
    return J({ ...answer, docs: wireDocs(board.docs) });
  }
  if (parts[2] === 'events' && parts.length === 3) {
    if (m !== 'POST') return J({ error: 'method' }, 405);
    const b = await readJson(req); if (b instanceof Response) return b;
    const from = parseDeviceId(b.from);
    if (!from) return J({ error: 'bad event', reason: 'sender' }, 400);
    if (!isEventType(b.type)) return J({ error: 'bad event', reason: 'type' }, 400);
    if (EVENTS[b.type].gmOnly && !gm) return J({ error: 'gm only' }, 403);
    if (!(await mayWriteFor(req, st, code, from, gm))) return J({ error: 'not your sheet' }, 403);
    const event = parseEvent(b.type, b.payload); // only a parsed event is stored
    if (!event) return J({ error: 'bad event', reason: 'payload' }, 400);
    // an event that speaks for one hunter (`ownSheet` in DEFS, src/core/protocol.ts): only that hunter's phone may post it
    const by = speaksFor(event);
    if (by && deviceOf(by) !== from) return J({ error: 'not your sheet' }, 403);
    const seq = await st.addEvent(code, from, event, now);
    // a different message under an id the room holds is refused, never answered as taken: its sender made the id twice
    return seq === null ? J({ error: 'room full' }, 413) : seq === 'idTaken' ? J({ error: 'id taken' }, 409) : J({ seq });
  }
  if (parts[2] === 'kicks' && parts.length === 4) { // S11: the GM lifts a removal so the player can rejoin at once
    if (m !== 'DELETE') return J({ error: 'method' }, 405);
    if (!gm) return J({ error: 'gm only' }, 403);
    const key = parseSheetKey(parts[3]);
    if (!key) return J({ error: 'bad hunter id' }, 400);
    return J({ ok: true, kicked: await st.setRemoval(code, key, 'allow', now) });
  }
  if (parts[2] === 'release' && parts.length === 3) { // S07: the GM frees a device's slot, so the player's new phone binds it by its first write
    if (m !== 'POST') return J({ error: 'method' }, 405);
    if (!gm) return J({ error: 'gm only' }, 403);
    const b = await readJson(req); if (b instanceof Response) return b;
    const dev = parseDeviceId(b.device);
    if (!dev) return J({ error: 'bad device' }, 400);
    await st.moveOwner(code, dev, { type: 'release' }); return J({ ok: true });
  }
  if (parts[2] === 'sheets' && parts.length === 4) {
    if (m !== 'PUT' && m !== 'DELETE') return J({ error: 'method' }, 405);
    // a row is a hunter sheet under its sheet key, or a room doc under '_' and the doc's name
    const hid = parts[3] ?? '', isDoc = hid.startsWith('_'), key = isDoc ? null : parseSheetKey(hid), docName = isDoc ? parseDocName(hid.slice(1)) : null;
    if (!isDoc && !key) return J({ error: 'bad hunter id' }, 400);
    if (m === 'DELETE') { // R01: the GM removes a player's hunter from the room (their device keeps its own copy)
      if (!key || !gm) return J({ error: 'gm only' }, 403);
      return J({ ok: true, kicked: await st.setRemoval(code, key, 'remove', now) }); // S07: the removal of a phone's last sheet frees its slot too
    }
    if (docName === 'kicked') return J({ error: 'server doc' }, 403); // only the removal routes write it (`setRemoval`)
    if (isDoc && !gm) return J({ error: 'gm only' }, 403);
    const b = await readJson(req); if (b instanceof Response) return b;
    const bad = J({ error: isDoc ? 'bad doc' : 'bad sheet' }, 400), from = parseDeviceId(b.from);
    if (!from) return bad;
    if (JSON.stringify(b.data ?? null).length > (isDoc ? DOC_MAX : SHEET_MAX)) return J({ error: 'too large' }, 413);
    if (key) { // only a parsed sheet is stored
      const sheet = parseSheet(key, b.data);
      if (!sheet) return bad;
      if (!(await mayWriteFor(req, st, code, deviceOf(key), gm))) return J({ error: 'not your sheet' }, 403);
      switch (await st.pushSheet(code, key, from, sheet, now)) {
        case 'stored': return J({ ok: true });
        case 'removed': return J({ error: 'removed' }, 403); // so the player's phone reads the removal and stops
        case 'full': return J({ error: 'room full' }, 413);
      }
    }
    return docName ? putDoc(st, code, docName, from, b.data, now) : bad;
  }
  return J({ error: 'not found' }, 404);
}
/** Only a parsed doc is stored. One generic step, so the parser and the store agree on the doc's type. */
async function putDoc<K extends Exclude<DocName, 'kicked'>>(st: Store, code: RoomCode, name: K, from: DeviceId, data: unknown, now: number): Promise<Response> {
  const doc = DOCS[name](data);
  if (!doc) return J({ error: 'bad doc' }, 400);
  await st.putDoc(code, name, from, doc, now);
  return J({ ok: true });
}

/** The server over `database`: the room API and the built files. */
export function serverOf(database: Database): (req: Request) => Promise<Response> {
  return async (req: Request): Promise<Response> => {
    try {
      const url = new URL(req.url);
      let path: string;
      try { path = decodeURIComponent(url.pathname); } catch { return J({ error: 'bad path' }, 400); } // a path with a broken escape names no file
      if (path === '/healthz') return J({ ok: true });
      if (path.includes('..') || path.includes('\0') || path.includes('\\')) return J({ error: 'bad path' }, 400);
      if (path.startsWith('/api/')) return await api(req, path.slice(5).split('/').filter(Boolean), database);
      if (req.method !== 'GET' && req.method !== 'HEAD') return J({ error: 'method' }, 405);
      if (path === '/') path = '/index.html';
      if (path.split('/').some(s => s.startsWith('.'))) return new Response('Not found', { status: 404, headers: BASE_HEADERS });
      return (await staticFile(path)) ?? new Response('Not found', { status: 404, headers: BASE_HEADERS });
    } catch (e) {
      console.error('[server]', messageOf(e));
      return J({ error: 'server error' }, 500);
    }
  };
}

/** This process's database, from DATABASE_URL: opened at the server's start, or at a test's first request. */
const processDatabase = once(() => database(Bun.env.DATABASE_URL));
/** The server of this process. Tests that import it get the store DATABASE_URL names, as the deploy does. */
export const handler = serverOf({ kind: Bun.env.DATABASE_URL ? 'postgres' : 'memory', now: () => processDatabase().now(), close: () => processDatabase().close() });

if (import.meta.main) {
  const port = Bun.env.PORT ? Number(Bun.env.PORT) : 3000;
  const { build } = await built();
  const db = await processDatabase().now();
  const server = Bun.serve({ port, fetch: handler });
  console.log(`The Hunter System (build ${build}) listening on :${server.port};${db.at === 'ready' ? `rooms in ${db.store.kind}` : 'NO ROOMS: Postgres does not answer, see above'}`);
}
