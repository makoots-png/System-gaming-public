// fight-heard.ts: on a player's phone, whether the GM's fight holds one of its hunters. Pure.
// The phone hears of the GM's fight by two paths: the room's fight doc, which the GM's phone puts a moment after the fight
// changes (publish.ts `PUBLISH_FIGHT_MS`), and the fight's `vitals` message for a row of this phone's hunter, posted at
// once. A death in the fight can land before the doc that holds its row (the System raise was offered in the GM's fight,
// raise.e2e.ts). So the message is kept, `FightHeard` at `settings.sync.heard`, and `gmHolds` reads it beside the doc.
import { deviceOf, parseRoomCode, parseSheetKey } from '../ids.ts';
import type { DeviceId, RoomCode, SheetKey } from '../ids.ts';
import { fightId } from '../combat/fight-types.ts';
import type { FightId } from '../combat/fight-types.ts';
import type { RoomEvent } from '../protocol.ts';

/** The GM's fight's last `vitals` message to a hunter of this phone: the room, the hunter's sheet key, the fight, and when the room stored it (the server's clock). */
export type FightHeard = { readonly room: RoomCode; readonly key: SheetKey; readonly fight: FightId; readonly at: string };
/** What a player's phone reads of the GM's fight: the room's fight doc, as `DOCS.fight` parsed it. */
export type TableDoc = { readonly ended: boolean; readonly active?: boolean; readonly id: FightId; readonly rows?: readonly { readonly key?: string | null }[] };
/** All a player's phone knows of the GM's fight in room `code`: its doc and when the room stored it (`docAt`, the server's clock), and the last message heard. */
export type TableSeen = { readonly code: RoomCode | null; readonly doc: TableDoc | null; readonly docAt: string | null; readonly heard: FightHeard | null };
/** What a phone outside a room, or a GM's, knows of a GM's fight: nothing. */
export const NO_TABLE: TableSeen = { code: null, doc: null, docAt: null, heard: null };

const hasRow = (d: TableDoc, key: SheetKey): boolean => !d.ended && (d.rows ?? []).some(r => r.key === key);
/**
 * Whether the GM's fight holds the hunter of sheet key `key`, in either order of arrival. The doc says so while the fight
 * runs with a row of that key. A message heard for that key says so until the room shows a doc that answers it: a doc of
 * the same fight holds while that fight has not ended and has the row; a doc of another fight that the room stored after
 * the message is a later fight, so the one heard has ended. A doc stored before the message, or none, is from before the
 * fight heard, which still holds the hunter.
 */
export function gmHolds(t: TableSeen, key: SheetKey): boolean {
  const d = t.doc, h = t.heard;
  if (d && d.active && hasRow(d, key)) return true;
  if (!h || h.room !== t.code || h.key !== key) return false;
  if (!d) return true;
  if (d.id === h.fight) return hasRow(d, key);
  return t.docAt === null || Date.parse(t.docAt) <= Date.parse(h.at);
}

/**
 * What a player's phone keeps heard after a page of room `room`'s events: the last `vitals` message of the page to a
 * hunter of device `device`, else what it kept.
 */
export function fightHeard(kept: FightHeard | null, room: RoomCode, page: readonly (RoomEvent & { readonly at: string })[], device: DeviceId): FightHeard | null {
  let out = kept;
  for (const ev of page) {
    if (ev.type !== 'vitals') continue;
    const key = ev.payload.to[0];
    if (deviceOf(key) === device) out = { room, key, fight: ev.payload.fight, at: ev.at };
  }
  return out;
}

/** A kept `FightHeard` as a save holds it, or null. */
export function parseFightHeard(v: unknown): FightHeard | null {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>, room = parseRoomCode(o.room), key = parseSheetKey(o.key);
  const fight = typeof o.fight === 'string' && o.fight.length > 0 && o.fight.length <= 40 ? fightId(o.fight) : null;
  const at = typeof o.at === 'string' && Number.isFinite(Date.parse(o.at)) ? o.at : null;
  return room && key && fight && at ? { room, key, fight, at } : null;
}
