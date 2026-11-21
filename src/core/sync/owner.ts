// owner.ts: which phone speaks for a device id in a room (S07), as a machine. Pure; server.ts's stores keep one slot per
// (room, device) and move it only through `ownerStep`.
//
// A device's slot is `free` or `bound` to the hash of one device token. Only a write binds it: a phone's sheet push or
// event, carrying its token. A read (a poll, the head of a join) moves nothing and is proven only by a bound slot's own
// token, so a phone that polls with another phone's device id never takes it (audit SMX-sync-5: a poll bound the slot
// on first use, and after the GM freed it another phone could read a player's sheet and sealed chapters). There is no
// join event: a join is a poll and then the sheet push, which is the `write`. The GM's Release frees the slot; the GM's
// removal of a sheet frees it only with the device's last sheet, since its other sheets are still that phone's.
import type { Id } from '../ids.ts';

/** The sha256 of a device token, in hex: what a slot is bound to. The token itself is never kept. */
export type TokenHash = Id<'TokenHash'>;
const HASH_RE = /^[0-9a-f]{64}$/;
/** A token's hash as the server made it (64 hex digits), or null: a stored row is read through this. */
export const parseTokenHash = (v: unknown): TokenHash | null => (typeof v === 'string' && HASH_RE.test(v) ? (v as TokenHash) : null);

/** A device's slot in one room: no phone speaks for it yet, or the phone whose token hashes to `hash` does. */
export type Owner = { readonly at: 'free' } | { readonly at: 'bound'; readonly hash: TokenHash };
export const OWNER_STATES = ['free', 'bound'] as const;
export type OwnerState = (typeof OWNER_STATES)[number];
export const FREE: Owner = { at: 'free' };
/** The slot a store keeps as the hash it holds for the device, or none. */
export const ownerOf = (hash: TokenHash | null): Owner => (hash ? { at: 'bound', hash } : FREE);

/**
 * What moves a slot. `write`: a phone writes for the device with its token (the first writer of a free slot binds it).
 * `release`: the GM's "Release to a new device". `removed`: the GM removed one of the device's sheets, and `left` of
 * its sheets are still in the room.
 */
export type OwnerEvent =
  | { readonly type: 'write'; readonly hash: TokenHash }
  | { readonly type: 'release' }
  | { readonly type: 'removed'; readonly left: number };
export const OWNER_EVENTS = ['write', 'release', 'removed'] as const;
export type OwnerEventType = (typeof OWNER_EVENTS)[number];

/** The slot after `e`. A write to a slot bound to another token leaves it as it is: that write is refused (`ownedBy`). */
export function ownerStep(o: Owner, e: OwnerEvent): Owner {
  switch (e.type) {
    case 'write': return o.at === 'free' ? { at: 'bound', hash: e.hash } : o;
    case 'release': return FREE;
    case 'removed': return e.left > 0 ? o : FREE;
  }
}

/**
 * Whether a request carrying the token that hashes to `hash` speaks for the device whose slot is `o`: a read asks this
 * of the slot as it is, a write of the slot after its `write` step. A free slot is no one's.
 */
export const ownedBy = (o: Owner, hash: TokenHash): boolean => o.at === 'bound' && o.hash === hash;
