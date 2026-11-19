// seen.ts: where this phone stopped reading each room it went out of, kept in its save at `settings.sync.seen`. Pure.
// Written only by the link's `save` effect (bind.ts `linkSaved`), read when a join starts (src/edge/sync.ts).
import { parseRoomCode } from '../ids.ts';
import type { RoomCode } from '../ids.ts';
import { ROOM_TTL_MS } from '../room-server.ts';

/**
 * Where this phone stopped reading each room it went out of: the room's cursor at the way out (a leave, a removal,
 * another room) and when, in the server's time. A join back into the room reads on from there (link.ts `Joining.from`),
 * so what came meanwhile lands through the same path as any page (notes-5-trade.md 11). Kept while its code still names
 * the same room: a room lives `ROOM_TTL_MS` after its last use, and this phone's last poll was a use.
 */
export type RoomPlaces = Readonly<Record<string, { readonly seq: number; readonly at: string }>>;
/** The most rooms a phone keeps its place in: a bound for junk. A phone in a new room every day of a room's life holds 30. */
export const SEEN_MAX = 100;
/** `seen` with the place in `code` kept as its newest; past `SEEN_MAX` the oldest goes. */
export function seenKept(seen: RoomPlaces | undefined, code: RoomCode, seq: number, at: string): RoomPlaces {
  const next = Object.entries({ ...seenWithout(seen, code), [code]: { seq, at } });
  return Object.fromEntries(next.slice(Math.max(0, next.length - SEEN_MAX)));
}
/** `seen` without `code`: this phone is in that room again, or the room is gone. */
export const seenWithout = (seen: RoomPlaces | undefined, code: string): RoomPlaces => Object.fromEntries(Object.entries(seen ?? {}).filter(([c]) => c !== code));
/** Where a join of `code` reads on from at `now`, or null: no place is kept, or it is older than a room's life and the code may name another room. */
export function seenFrom(seen: RoomPlaces | undefined, code: RoomCode, now: number): number | null {
  const e = (seen ?? {})[code], at = e ? Date.parse(e.at) : NaN;
  return e && Number.isFinite(at) && now - at <= ROOM_TTL_MS ? e.seq : null;
}
/** The places a save holds, as read at `now`: a room code, a whole seq from 0 and a time; one older than a room's life is dropped, the newest `SEEN_MAX` kept. */
export function parseSeen(v: unknown, now: number): RoomPlaces {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return {};
  const out: [string, { seq: number; at: string }][] = [];
  for (const [code, e] of Object.entries(v as Record<string, unknown>)) {
    if (!parseRoomCode(code) || e === null || typeof e !== 'object') continue;
    const { seq, at } = e as { seq?: unknown; at?: unknown }, t = typeof at === 'string' ? Date.parse(at) : NaN;
    if (typeof seq === 'number' && Number.isSafeInteger(seq) && seq >= 0 && typeof at === 'string' && Number.isFinite(t) && now - t <= ROOM_TTL_MS) out.push([code, { seq, at }]);
  }
  return Object.fromEntries(out.slice(Math.max(0, out.length - SEEN_MAX)));
}
