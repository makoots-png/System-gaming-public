// bind.ts: what the room link writes in the save, as steps, and the two small machines of a player's bind. Pure.
// src/edge/sync.ts is their one caller, each in one `store.apply`; the room model (tests/models/room-world.ts) runs the
// same steps.
//
// Before, sync.ts wrote these fields by hand inside `store.update`: the room fields the link's `save` effect names, the
// ring of GM keys (its cap, a refused key dropped, a gone room's key dropped, a key forgotten, each written apart), that
// the server answered once (`serverOk`), and the bind of a player's hunter to the room, written twice (a join and a
// rebind) with one copy rebinding the outbox and the other too (implicit audit 2, N6). Now each is a named step with a
// table test (tests/bind.test.ts).
//
// A player's bind (audit SMX-sync-2): the hunter this phone sends (`boundHunterId`) and this phone's join of its room
// (`joined`). A join writes both (`boundTo`); "Play as" (`playAs`) and a delete of the bound hunter (party.ts
// `removeHunter`) move the hunter through `rebindTo` and never the join, so a message the room took while the phone was
// in it is never told as one sent while it was away. The "Play as" window's answer is read against the room and the
// bind it was asked in (`playAsAnswered`), and the REMOVED FROM ROOM window is a machine tied to its room
// (`removedStep`, audit SMX-sync-8).
import type { GmKey, HunterId, RoomCode } from '../ids.ts';
import { seenKept, seenWithout } from './seen.ts';
import type { Save, SyncSettings } from '../save.ts';
import { refuse } from '../save-step.ts';
import type { Refused } from '../save-step.ts';
import { rebound } from './outbox.ts';
import type { SaveFields } from './link.ts';
import type { TapAnswer } from './attempt.ts';
import { tapWords } from './taps.ts';
import type { TapKind } from './taps.ts';

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
 * This phone's ring with the keys of a save swapped in (an import, a restore): the ring is merged, never replaced. The
 * phone's own key wins for a room both hold, and the phone's keys are the newest, so past `KEYS_MAX` the swapped-in
 * save's go first.
 */
export function ringMerged(mine: Ring, theirs: Ring): Record<string, GmKey> {
  const all = [...Object.entries(theirs).filter(([code]) => !(code in mine)), ...Object.entries(mine)];
  return Object.fromEntries(all.slice(Math.max(0, all.length - KEYS_MAX)));
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
 * change. `refused` is the key the link held when the room refused one (sync.ts reads it from the link before). In the
 * write that takes the phone out of a room (to none, or to another), the room's cursor is kept in `seen` at the server's
 * time `at`; the place goes when the phone is in that room again, and when the room is gone.
 */
export function linkSaved(save: Save, f: SaveFields, refused: GmKey | null, at: string): Save {
  let s: SyncSettings = { ...save.settings.sync };
  const was = s.room, gone = f.last?.why === 'gone' ? f.last.code : f.ring && 'gone' in f.ring ? f.ring.gone : null;
  if (f.room !== undefined && was && f.room !== was) s.seen = seenKept(s.seen, was, s.cursor, at);
  if (f.room) s.seen = seenWithout(s.seen, f.room);
  if (gone) s.seen = seenWithout(s.seen, gone);
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

// ── a player's bind ──
/**
 * This phone's join of a room: the room and the server's time it joined at. A message the room took before it came while
 * the phone was out of the room, and a removal from before it does not count. It names its room, so a save swapped in
 * with another room (an import) never reads this join as its own (SMX-sync-2.4): `joinedAt` answers only for its room.
 */
export type BindJoin = { readonly room: RoomCode; readonly at: string };
/** When this phone joined room `code`, in ms on the server's clock; null when the save holds no join of that room. */
export function joinedAt(s: Pick<SyncSettings, 'joined'>, code: RoomCode): number | null {
  const t = s.joined && s.joined.room === code ? Date.parse(s.joined.at) : NaN;
  return Number.isFinite(t) ? t : null;
}

/** The sync settings with `hid` the hunter this phone sends; a tombstone of it waiting in the outbox goes. The join stays. */
export const rebindTo = (s: SyncSettings, hid: HunterId): SyncSettings =>
  ({ ...s, boundHunterId: hid, ...(s.outbox ? { outbox: rebound(s.outbox, hid) } : {}) });

/** `hid` when the party holds it, else null. */
const held = (save: Save, hid: HunterId): HunterId | null => save.hunters.find(h => h.id === hid)?.id ?? null;

/**
 * A player joined room `join.room` at `join.at` (the server's time) with hunter `hid`: active when this phone holds it
 * (else the active hunter stays and is bound), bound, and the join written (a removal from before no longer counts).
 */
export function boundTo(save: Save, hid: HunterId, join: BindJoin): Save {
  const bound = held(save, hid) ?? save.settings.activeHunterId;
  return { ...save, settings: { ...save.settings, activeHunterId: bound, sync: { ...rebindTo(save.settings.sync, bound), joined: join } } };
}
/** "Play as": hunter `hid` is shown and sent in the room this phone is in. The join stays (SMX-sync-2.2). One not in the party is refused. */
export function playAs(save: Save, hid: HunterId): Save | Refused<'no-hunter'> {
  const to = held(save, hid);
  return to ? { ...save, settings: { ...save.settings, activeHunterId: to, sync: rebindTo(save.settings.sync, to) } } : refuse('no-hunter');
}

// ── the "Play as" window (SMX-sync-2.3) ──
/** Where a player's phone is: the room it plays in and the hunter bound there. */
export type BindAsked = { readonly room: RoomCode; readonly bound: HunterId };
/** What the player tapped in the "Play as" window. */
export type BindAnswer = 'cancel' | 'view' | 'bind';
/**
 * What the answer does. `none`: nothing. `show`: the hunter is shown, nothing is bound. `showKept`: shown, and the player
 * is told the bound hunter stays synced. `playAs`: shown and bound (`playAs`).
 */
export type BindSwitch = 'none' | 'show' | 'showKept' | 'playAs';
/**
 * The answer to a "Play as" window asked at `asked`, read where the phone is now (`now`: null out of a room as a
 * player). The window speaks of one room and one bound hunter; once the phone has left that room, or another hunter is
 * bound there, the answer only shows the hunter, as a switch out of a room does.
 */
export function playAsAnswered(asked: BindAsked, now: BindAsked | null, answer: BindAnswer): BindSwitch {
  if (answer === 'cancel') return 'none';
  const still = now !== null && now.room === asked.room && now.bound === asked.bound;
  if (!still) return 'show';
  return answer === 'bind' ? 'playAs' : 'showKept';
}

// ── the REMOVED FROM ROOM window (SMX-sync-8) ──
/**
 * The notice that the GM removed this phone from a room. `told`: the window is open (or waiting its turn); `rejoining`:
 * its Rejoin is on its way. Each names its room and the hunter that was bound, so an answer of an old window never acts
 * on another room.
 */
export type RemovedNotice =
  | { readonly at: 'none' }
  | { readonly at: 'told' | 'rejoining'; readonly room: RoomCode; readonly hunter: HunterId | null };
export const REMOVED_STATES = ['none', 'told', 'rejoining'] as const satisfies readonly RemovedNotice['at'][];
export const NO_REMOVAL: RemovedNotice = { at: 'none' };
/**
 * `removed`: the link put this phone out of `room` (the GM removed `hunter`). `answered`: the window of `room` was
 * answered, Rejoin or OK. `tapped`: the Rejoin's join of `room` answered. `entered`: the phone is in room `room` now (a
 * join from the Room view, an invite, another tab). `replaced`: an import, a restore or a reset replaced the campaign.
 */
export type RemovedEvent =
  | { readonly type: 'removed'; readonly room: RoomCode; readonly hunter: HunterId | null }
  | { readonly type: 'answered'; readonly room: RoomCode; readonly rejoin: boolean }
  | { readonly type: 'tapped'; readonly room: RoomCode; readonly answer: TapAnswer }
  | { readonly type: 'entered'; readonly room: RoomCode }
  | { readonly type: 'replaced' };
export const REMOVED_EVENTS = ['removed', 'answered', 'tapped', 'entered', 'replaced'] as const satisfies readonly RemovedEvent['type'][];
/** `show`: open the REMOVED FROM ROOM window of `room`. `rejoin`: join `room` as a player with `hunter`. `tell`: a toast. */
export type RemovedEffect =
  | { readonly type: 'show'; readonly room: RoomCode; readonly hunter: HunterId | null }
  | { readonly type: 'rejoin'; readonly room: RoomCode; readonly hunter: HunterId | null }
  | { readonly type: 'tell'; readonly text: string; readonly kind: 'info' | 'warning' };
export type RemovedResult = { readonly state: RemovedNotice; readonly effects: readonly RemovedEffect[] };

/** The words of a Rejoin the GM has not allowed yet (today's words, which the window's own Rejoin button explains). */
export const NOT_BACK_YET = 'Not allowed back yet. Ask your GM to press Allow back.';
/**
 * A Rejoin that failed as `kind`: whether the window comes back to try again. Today's behaviour: it does where a second
 * try can work (the GM has not allowed the player back yet, or the server was not reached); a room that is gone, a
 * campaign replaced, or another create or join under way ends the notice with its words.
 */
const AGAIN: { readonly [K in TapKind]: boolean } = {
  removed: true, net: true, notfound: false, replaced: false, busy: false, badcode: false, keyRefused: false,
};

const told = (room: RoomCode, hunter: HunterId | null): RemovedResult =>
  ({ state: { at: 'told', room, hunter }, effects: [{ type: 'show', room, hunter }] });
const unchanged = (state: RemovedNotice): RemovedResult => ({ state, effects: [] });

/** One event of the removed notice. An event for another room than the notice's, or one its state has no use for, changes nothing. */
export function removedStep(n: RemovedNotice, e: RemovedEvent): RemovedResult {
  if (e.type === 'removed') return told(e.room, e.hunter);
  if (n.at === 'none') return unchanged(n);
  if (e.type === 'replaced') return unchanged(NO_REMOVAL);
  if (e.type === 'entered') return n.at === 'told' ? unchanged(NO_REMOVAL) : unchanged(n);
  if (e.room !== n.room) return unchanged(n);
  if (e.type === 'answered') {
    if (n.at !== 'told') return unchanged(n);
    if (!e.rejoin) return unchanged(NO_REMOVAL);
    return { state: { ...n, at: 'rejoining' }, effects: [{ type: 'rejoin', room: n.room, hunter: n.hunter }] };
  }
  if (n.at !== 'rejoining') return unchanged(n);
  const a = e.answer;
  if (a.ok === true) return { state: NO_REMOVAL, effects: [{ type: 'tell', text: `Rejoined room ${n.room}.`, kind: 'info' }] };
  const text = a.kind === 'removed' ? NOT_BACK_YET : tapWords(a.kind, n.room);
  const tell: RemovedEffect[] = text ? [{ type: 'tell', text, kind: 'warning' }] : [];
  if (!AGAIN[a.kind]) return { state: NO_REMOVAL, effects: tell };
  const again = told(n.room, n.hunter);
  return { state: again.state, effects: [...tell, ...again.effects] };
}
