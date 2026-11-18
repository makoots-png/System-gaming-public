// award.ts: what one of the GM view's actions writes, as one step. Pure.
//
// Before, Send award was a write per hunter of this phone, a post per group of players, then the log line, each its own
// write from gm.js; HP, Revive and a broadcast were a post and then a log line (implicit audit 2, N3, N4). A throw part
// way paid some hunters with no log line, and a second tap paid them twice. Now an action's change, its posts (queued in
// the outbox, src/core/sync/outbox.ts, which sends each until the room takes it, once) and its log lines are one answer,
// written by one `store.apply` or not at all, as a fight's end and a gate's Clear are (src/core/gates/pay.ts). What a
// running fight holds (a status on a row) is the fight's command, after this write, as a grant's fight parts are.
import { grant } from './hunter/grant.ts';
import type { Day, Granted, VitalsAt } from './hunter/grant.ts';
import type { GivenBundle, RoomCode, RoomEvent } from './protocol.ts';
import { record } from './hunter/chronicle.ts';
import type { Rewards } from './rewards.ts';
import type { Save } from './save.ts';
import { isRefused } from './save-step.ts';
import { told } from './session-log.ts';
import type { Said, Stamp } from './session-log.ts';
import { atOutbox, post } from './sync/outbox.ts';

/**
 * What an action sends and says beside its change: the room events it posts (for `room`; none outside a room), each
 * under its `key` when it has one (a queued message of that key stands for the same thing and is replaced), and its
 * log lines.
 */
export type Sends = { readonly room: RoomCode | null; readonly events: readonly (RoomEvent | Keyed)[]; readonly said: readonly Said[] };
/** A room event posted under a key: a newer one of the same key replaces it while it waits (src/core/sync/outbox.ts `post`). */
export type Keyed = { readonly key: string; readonly event: RoomEvent };

/** The save with `s`'s events queued in the outbox for its room, in order, and its lines on top of the log at `stamp`. */
export function sent(save: Save, s: Sends, stamp: Stamp): Save {
  const room = s.room;
  const posted = room && s.events.length ? atOutbox(box => s.events.reduce((b, e) => ('key' in e ? post(b, room, { kind: 'event', event: e.event }, e.key) : post(b, room, { kind: 'event', event: e })).box, box))(save) : save;
  return told(posted, stamp, ...s.said);
}

/** What the GM's award did: the next save and each local hunter's grant (the view shows each with `hunter.granted`). */
export type Awarded = { readonly save: Save; readonly granted: readonly { readonly hid: string; readonly g: Granted }[] };

/**
 * The GM's Send award, in one step: each hunter of this phone in `locals` granted `rewards` (with its vitals where its
 * fight holds them, `vitals`), then `s`: each player's award posted and the log line. A hunter no longer here is left out.
 * An award given from a bundle by hand (`given`, the GM's awards for roleplay) is a fact of each local hunter's chronicle,
 * in the same write; a player's phone records it when its award lands (room-events.ts).
 */
export function gmAward(save: Save, locals: readonly { readonly hid: string; readonly vitals: VitalsAt }[], rewards: Rewards, s: Sends, day: Day, given: GivenBundle | null = null): Awarded {
  let next = save;
  const granted: { hid: string; g: Granted }[] = [];
  for (const { hid, vitals } of locals) {
    const g = grant(next, hid, rewards, null, { ...day, vitals });
    if (isRefused(g)) continue;
    next = given ? { ...g.save, hunters: g.save.hunters.map(h => (h.id === hid ? record(h, { kind: 'given', key: given.key, name: given.name }) : h)) } : g.save;
    granted.push({ hid, g: { ...g, save: next } });
  }
  return { save: sent(next, s, { at: day.at, cap: day.R.logCap }), granted };
}
