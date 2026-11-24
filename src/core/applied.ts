// applied.ts: the event ids a phone has applied, kept in its save at `settings.sync.applied`. Pure.
// An event that changes a hunter (award, quest, hp, status) is recorded here in the same write as its change
// (`appliedOnce`), so it is applied whole at most once per phone, across a reload and a leave and rejoin. See
// docs/agent-handoff/p3/notes-protocol.md for why.
import { parseEventId } from './ids.ts';
import type { EventId } from './ids.ts';
import { parseEvent, standsFor } from './protocol.ts';
import type { RoomEvent } from './protocol.ts';
import type { Save } from './save.ts';
import { atSync, isRefused, refuse } from './save-step.ts';
import type { Step } from './save-step.ts';

/** Ids a phone remembers: one poll page. A replay comes from the last page or a resend seconds later. */
export const APPLIED_MAX = 200;

/** The ring with `eid` recorded, newest last and at most 200, or null when `eid` is in it: that event was applied. */
export function recordApplied(ring: readonly EventId[] | undefined, eid: EventId): EventId[] | null {
  if (ring?.includes(eid)) return null;
  return [...(ring ?? []), eid].slice(-APPLIED_MAX);
}

/**
 * A step that writes `write` and records `eid` together, the first time only: one write or none. Refused (`applied`)
 * when the save's ring holds `eid`. A `write` that refuses leaves the save as it was and records the id alone, so a
 * message that does not apply on this phone is not tried again; one that throws throws here, before anything is written.
 */
export const appliedOnce = (eid: EventId, write: Step<Save>): Step<Save> => save => {
  const ring = recordApplied(save.settings.sync.applied, eid);
  if (!ring) return refuse('applied');
  const next = write(save), base = isRefused(next) ? save : next;
  return atSync(sy => ({ ...sy, applied: ring }))(base);
};

/** Whether this phone applied event `eid` already: its id is in the save's ring. */
export const wasApplied = (save: Save, eid: EventId): boolean => save.settings.sync.applied?.includes(eid) ?? false;

/** The ring a save holds: its event ids in order, the newest 200. An entry that is not an event id is dropped. */
export function parseApplied(v: unknown): EventId[] {
  if (!Array.isArray(v)) return [];
  return v.map(parseEventId).filter((id): id is EventId => id !== null).slice(-APPLIED_MAX);
}

// ── an event this phone could not apply ──
/**
 * Room events whose applier threw on this phone (a bug, or a save it cannot apply them to yet), kept at
 * `settings.sync.held` so the poll cursor may move past them without losing them. Each is tried again after every good
 * poll, before that poll's own events, until it applies (or refuses) and leaves. At most `HELD_MAX`, oldest let go.
 */
export const HELD_MAX = 20;
/**
 * `held` without what `ev` takes the place of: the held messages that stand for what it stands for (protocol.ts
 * `standsFor`, a fight's totals for one hunter). The room gives events in its order, so every held one is older than `ev`,
 * and an older total that landed after a newer one would put old numbers back.
 */
export function replaced(held: readonly RoomEvent[], ev: RoomEvent): RoomEvent[] {
  const key = standsFor(ev);
  return key === null ? [...held] : held.filter(e => standsFor(e) !== key);
}
/** `held` with `ev` kept, once, as the newest, in the place of any it replaces. */
export const hold = (held: readonly RoomEvent[] | undefined, ev: RoomEvent): RoomEvent[] =>
  [...replaced(held ?? [], ev).filter(e => e.payload.eid !== ev.payload.eid), ev].slice(-HELD_MAX);
/** `held` without the event `eid`: it applied, or refused, on a later try. */
export const unhold = (held: readonly RoomEvent[] | undefined, eid: EventId): RoomEvent[] => (held ?? []).filter(e => e.payload.eid !== eid);
/** The held events a save holds, each read again by the room's own parser. */
export function parseHeld(v: unknown): RoomEvent[] {
  if (!Array.isArray(v)) return [];
  return v.flatMap(x => {
    const ev = x !== null && typeof x === 'object' ? parseEvent((x as { type?: unknown }).type, (x as { payload?: unknown }).payload) : null;
    return ev ? [ev] : [];
  }).slice(-HELD_MAX);
}
