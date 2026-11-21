// room-server.ts: the rules of the room server (server.ts), said once: how long a room lives, how long a removal keeps
// a sheet out, and the life of the database that holds the rooms. Pure; server.ts and both of its stores read these.
//
// The database's life is a machine (docs/state-machines.md, "The room server's database"): `opening` at start, then
// `ready` when Postgres answers or `down` when it does not. While down, no room route answers (503) and /api/health
// says so; server.ts opens it again every `DB_RETRY_MS` until it answers. `closed` is its end, at a shutdown: it takes
// no event, so a try that answers after it is closed again and a down one is tried no more. Rooms are never kept in memory under
// DATABASE_URL: a restart would lose them all, and a phone would be told its room no longer exists.
import type { KickedDoc, SheetKey } from './protocol.ts';
import { REMOVED_MS, ROOM_SHEETS } from './protocol.ts';

// ── a room's life ──
/** A room lives while someone used it (a poll, a write, a join) within this time: 30 days, a long break between sessions. */
export const ROOM_TTL_MS = 30 * 24 * 3600 * 1000;
/** The oldest last use a live room may have at `now`. Both stores' queries and sweeps read this one rule. */
export const liveSince = (now: number): number => now - ROOM_TTL_MS;
/** Whether a room last used at `touched` is still live at `now`. A room used exactly `ROOM_TTL_MS` ago still is. */
export const roomLive = (touched: number, now: number): boolean => touched >= liveSince(now);

// ── a removal ──
/**
 * How long after the GM removes a hunter its phone may not push the sheet back: 20 s, two of a player's slowest polls,
 * so the phone reads the removal in the `_kicked` doc and stops before its next push lands. After that a rejoin is the
 * phone's to refuse (the doc keeps the removal `REMOVED_MS`), and the GM's Allow back lifts both at once.
 */
export const REPUSH_MS = 20_000;
/**
 * The `_kicked` doc after the GM removes `key` at `now` (`name`: the name the board showed, kept 60 characters), or lifts
 * its removal (`name` null): a removal older than `REMOVED_MS` goes, and so does `key`'s old one. How long a removal lasts
 * is read here and in `keptOut` only (implicit audit 3, SV2: server.ts pruned by the window again).
 */
export function kickedAfter(old: KickedDoc | null, key: SheetKey, name: string | null, now: number): KickedDoc {
  const doc: KickedDoc = { keys: {}, names: {} };
  for (const [k, t] of Object.entries(old?.keys ?? {}) as [SheetKey, string][]) {
    if (k === key || now - Date.parse(t) >= REMOVED_MS) continue;
    doc.keys[k] = t; if (old!.names[k]) doc.names[k] = old!.names[k]!;
  }
  if (name !== null) { doc.keys[key] = new Date(now).toISOString(); if (name) doc.names[key] = name.slice(0, 60); }
  return doc;
}

/** Whether the `_kicked` doc keeps `key` from pushing its sheet at `now`. The doc is the one record of a removal. */
export function keptOut(kicked: KickedDoc | null, key: SheetKey, now: number): boolean {
  const at = kicked ? Date.parse(kicked.keys[key] ?? '') : NaN;
  return Number.isFinite(at) && now - at < REPUSH_MS;
}

// ── a room's sheets and removals: one change at a time ──
// A push and a removal each read the room (the `_kicked` doc, how many sheets it holds) and then write it. Two at once
// that read before either wrote would lose one's change, so a store makes each of the two changes below whole, with no
// other change of the same room between its read and its write (Postgres: under the room's row lock, as `addEvent`).
/** What a store did with a pushed sheet: kept it, or refused it because its hunter was removed lately or the room is full. */
export type Pushed = 'stored' | 'removed' | 'full';
/**
 * What becomes of a sheet pushed under `key` at `now`, in a room whose `_kicked` doc is `kicked` and which holds
 * `sheets` sheets, one of them under `key` when `held`. A sheet the room holds is always replaced: only a new one counts
 * against `ROOM_SHEETS`.
 */
export function pushed(kicked: KickedDoc | null, key: SheetKey, held: boolean, sheets: number, now: number): Pushed {
  if (keptOut(kicked, key, now)) return 'removed';
  return !held && sheets >= ROOM_SHEETS ? 'full' : 'stored';
}
/**
 * The GM's two changes of who is kept out: `remove` takes the hunter's sheet out of the room, moves its phone's slot
 * (`removed` in src/core/sync/owner.ts: freed with the phone's last sheet only) and records the removal; `allow` lifts
 * the record so the hunter may rejoin at once.
 */
export type RemovalChange = 'remove' | 'allow';

// ── the database's life ──
export const DB_STATES = ['opening', 'ready', 'down', 'closed'] as const;
export type DbState = (typeof DB_STATES)[number];
export const DB_EVENTS = ['opened', 'failed', 'close'] as const;
export type DbEventType = (typeof DB_EVENTS)[number];
/** How often a down database is opened again: a room is back within this of Postgres answering. One failed connect costs nothing. */
export const DB_RETRY_MS = 10_000;
/**
 * The database as the server holds it. `S` is the store (server.ts's `Store`); a down one keeps when the outage began
 * and the last error's code, which /api/health shows (the message, which may name the host, goes only to the log). A
 * closed one holds no store: closing a ready one closes its store.
 */
export type Db<S> =
  | { at: 'opening' }
  | { at: 'ready'; store: S }
  | { at: 'down'; since: number; error: string }
  | { at: 'closed' };
/** Postgres answers a try; a try fails; the server shuts the database (`Database.close`). */
export type DbEvent<S> = { type: 'opened'; store: S } | { type: 'failed'; at: number; error: string } | { type: 'close' };
/**
 * The state each event leads to, or null where it does not apply. A ready database stays ready: a query that fails
 * later is that request's 500. Every state but `closed` closes; `closed` takes nothing, so a store a try opened after
 * the close is closed by its caller and a failed try schedules no other.
 */
const TABLE: { readonly [St in DbState]: { readonly [E in DbEventType]: DbState | null } } = {
  opening: { opened: 'ready', failed: 'down', close: 'closed' },
  down: { opened: 'ready', failed: 'down', close: 'closed' },
  ready: { opened: null, failed: null, close: 'closed' },
  closed: { opened: null, failed: null, close: null },
};
/** The state `event` leads to from `state`, or null. */
export const dbTransition = (state: DbState, event: DbEventType): DbState | null => TABLE[state][event];
/** The next database, or the same one when its state does not take the event. A down one that fails again keeps when its outage began. */
export function dbStep<S>(db: Db<S>, e: DbEvent<S>): Db<S> {
  const to = dbTransition(db.at, e.type);
  if (to === null) return db;
  switch (e.type) {
    case 'opened': return { at: 'ready', store: e.store };
    case 'failed': return { at: 'down', since: db.at === 'down' ? db.since : e.at, error: e.error };
    case 'close': return { at: 'closed' };
  }
}
/** What /api/health answers for the database, apart from a ready store's own check. */
export type Health = { status: 200 | 503; body: { ok: boolean; db: string; since?: string; error?: string } };
export function dbHealth<S>(db: Db<S>, kind: string): Health {
  switch (db.at) {
    case 'ready': return { status: 200, body: { ok: true, db: kind } };
    case 'opening': return { status: 503, body: { ok: false, db: kind, error: 'opening' } };
    case 'closed': return { status: 503, body: { ok: false, db: kind, error: 'closed' } };
    case 'down': return { status: 503, body: { ok: false, db: kind, since: new Date(db.since).toISOString(), error: db.error } };
  }
}
