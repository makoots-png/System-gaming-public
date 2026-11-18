// bind.ts: what the room link writes in the save, as steps. Pure. src/edge/sync.ts is their one caller, each in one
// `store.apply`; the room model (tests/models/room-world.ts) runs the same steps.
//
// Before, sync.ts wrote these fields by hand inside `store.update`: the room fields the link's `save` effect names, the
// ring of GM keys (its cap, a refused key dropped, a gone room's key dropped, a key forgotten, each written apart), that
// the server answered once (`serverOk`), and the bind of a player's hunter to the room, written twice (a join and a
// rebind) with one copy rebinding the outbox and the other too (implicit audit 2, N6). Now each is a named step with a
// table test (tests/bind.test.ts).
import { setActive } from '../party.ts';
import type { GmKey, HunterId, RoomCode } from '../ids.ts';
import type { Save, SyncSettings } from '../save.ts';
import { isRefused } from '../save-step.ts';
import { rebound } from './outbox.ts';
import type { SaveFields } from './link.ts';

/** How many rooms' GM keys a phone keeps: a new one past this lets the oldest go. */
export const KEYS_MAX = 10;
type Ring = Readonly<Record<string, GmKey>>;
/** What the ring's steps read and write of the sync settings (the room model's phone keeps the same two fields). */
type Keys = { readonly gmKeys?: Ring | undefined; readonly gmKey?: GmKey | null | undefined };
const ringOf = (s: Keys): Ring => s.gmKeys ?? {};
/** The ring without `code`. */
const without = (g: Ring, code: string): Record<string, GmKey> => Object.fromEntries(Object.entries(g).filter(([c]) => c !== code));

/** The ring with `key` for room `code`, as its newest; past `KEYS_MAX` the oldest goes. */
export function ringKeep(g: Ring, code: RoomCode, key: GmKey): Record<string, GmKey> {
  const next = { ...without(g, code), [code]: key }, codes = Object.keys(next);
  return Object.fromEntries(codes.slice(Math.max(0, codes.length - KEYS_MAX)).map(c => [c, next[c]!]));
}
/**
 * The sync settings after the room refused key `refused` for `code`: the ring's key goes only when it is the one refused
 * (a wrong key typed by hand leaves a good stored one alone; `null`: the stored one was tried), and the room's key too.
 */
export function ringDrop<S extends Keys>(s: S, code: RoomCode, refused: GmKey | null): S {
  const g = ringOf(s), dropped = refused === null || g[code] === refused;
  return { ...s, ...(dropped ? { gmKeys: without(g, code) } : {}), ...(refused !== null && s.gmKey === refused ? { gmKey: null } : {}) };
}
/** The sync settings after room `code` is gone, or its key forgotten: whichever key the ring holds for it goes, and the room's key if it is that one. */
export function ringGone<S extends Keys>(s: S, code: string): S {
  const g = ringOf(s), key = g[code];
  return { ...s, gmKeys: without(g, code), ...(key !== undefined && s.gmKey === key ? { gmKey: null } : {}) };
}

/** A step on the save's sync settings. */
export const atSync = (f: (s: SyncSettings) => SyncSettings) => (save: Save): Save => ({ ...save, settings: { ...save.settings, sync: f(save.settings.sync) } });

/** The sync settings once the server has answered this phone: `serverOk` stays true from then on. */
export const serverSeen = (s: SyncSettings): SyncSettings => (s.serverOk ? s : { ...s, serverOk: true });

/**
 * The save after the link's `save` effect: each room field it names, `serverOk` once it names a room, and its ring
 * change. `refused` is the key the link held when the room refused one (sync.ts reads it from the link before).
 */
export function linkSaved(save: Save, f: SaveFields, refused: GmKey | null): Save {
  let s: SyncSettings = { ...save.settings.sync };
  if (f.room !== undefined) s.room = f.room;
  if (f.cursor !== undefined) s.cursor = f.cursor;
  if (f.last !== undefined) s.lastRoom = f.last ? { code: f.last.code, why: f.last.why } : null;
  if (f.gmKey !== undefined) s.gmKey = f.gmKey;
  if (f.room) s = serverSeen(s);
  const ring = f.ring;
  if (ring && 'keep' in ring) s = { ...s, gmKeys: ringKeep(ringOf(s), ring.keep, ring.key) };
  else if (ring && 'drop' in ring) s = ringDrop(s, ring.drop, refused);
  else if (ring && 'gone' in ring) s = ringGone(s, ring.gone);
  return { ...save, settings: { ...save.settings, sync: s } };
}

/**
 * A player's hunter `hid` bound to the room from server time `at`: active when this phone holds it (else the active
 * hunter stays and is bound), bound, joined at `at` (a removal from before no longer counts), and a tombstone of it
 * waiting in the outbox dropped. A join and a rebind are this one step.
 */
export function boundTo(save: Save, hid: HunterId, at: string): Save {
  const active = setActive(save, hid), s = isRefused(active) ? save : active, bound = s.settings.activeHunterId, sync = s.settings.sync;
  return { ...s, settings: { ...s.settings, sync: { ...sync, boundHunterId: bound, joinedAt: at, ...(sync.outbox ? { outbox: rebound(sync.outbox, bound) } : {}) } } };
}
