// use-told.ts: how a use reaches the GM, as a step written in the same `store.apply` as the use itself. Pure.
//
// A use changes a hunter (a potion leaves the bag, a boon is spent) and is told: a player's phone in a room posts the
// room's `used` to the outbox (src/core/sync/outbox.ts), which sends it until the room takes it; the GM's or a solo
// phone writes a told use to its own session log; a use nobody asked to hear of is told to nobody (protocol.ts
// `useRoute`). Before, the change and the report were two writes, so a throw or a refused write between them left a
// boon spent with the GM never told (implicit audit 3, H5). The view makes the line's id or the event (with its id)
// and the step writes them with the change.
import type { RoomCode, RoomEvent } from './protocol.ts';
import type { Rules } from './rules.ts';
import type { LogEntry, Save } from './save.ts';
import type { Step } from './save-step.ts';
import { logged } from './session-log.ts';
import { atOutbox, post } from './sync/outbox.ts';

/** Where a use's report goes: nowhere, this phone's session log, or the room's outbox. */
export type UseTold =
  | { readonly kind: 'none' }
  | { readonly kind: 'log'; readonly line: LogEntry }
  | { readonly kind: 'post'; readonly room: RoomCode; readonly event: RoomEvent };

/** The step that writes `t`: the log line on top of the log, or the event queued in the outbox for its room. */
export const toldStep = (t: UseTold, R: Pick<Rules, 'logCap'>): Step<Save> =>
  t.kind === 'log' ? logged(t.line, R)
    : t.kind === 'post' ? atOutbox(box => post(box, t.room, { kind: 'event', event: t.event }).box)
      : save => save;
