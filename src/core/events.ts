// The app's events: each name `app.emit(name, payload)` may send and `app.on(name, fn)` may hear, with its payload.
// `src/edge/bus.ts` types `on` and `emit` with this table, so the compiler checks every name and payload, in the
// TypeScript modules and in the views (tsconfig.views.json). `tests/deps.test.ts` checks that each entry is emitted and heard.

import type { Body } from './combat/effect-ops.ts';
import type { Ended } from './combat/fight-types.ts';
import type { RoomCode, RoomDocs, ServedSheet, SheetKey, Stored, StoredEvent } from './protocol.ts';
import type { Quest } from './save.ts';
import type { Connection } from './sync/connection.ts';
import type { GateId, RollEntryId } from './ids.ts';

/** A store change: the reason passed to `store.update`. `replaced`: the whole save was swapped (import, restore, reset). */
export type Change = { reason: string; replaced?: true };
/** A roll the dice tray made and logged in the save's `rolls` (its `id`). `natural`: the d20 of a single-d20 roll, else null. */
export type DiceRoll = { id?: RollEntryId; expr: string; total: number; rolls: number[]; natural: number | null; crit: boolean; fumble: boolean; adv: boolean; dis: boolean; text?: string };
/** A hunter who reached a new level (`refill`: HP and MP were refilled, the level is above the hunter's peak). */
export type LevelUp = { hunterId: string; from: number; to: number; points: number; refill: boolean };

export type AppEvents = {
  /** app.js once, after every module registered and the first view drew. First-run setup starts on it. */
  'ready': undefined;
  /** app.js after every store change. Views that draw from the save redraw; sync.ts pushes the sheet. */
  'change': Change;
  /** app.js when the phone crosses the desktop or wide breakpoint. Views with two layouts redraw. */
  'layout': { desktop: boolean; wide: boolean };
  /** app.js when the route moves to another view (`from` is null at start). Views close what belongs to the old one. */
  'view': { id: string; from: string | null };
  /** custom.js when this phone's device choices change (here or in another tab). The Device panel redraws. */
  'prefs': undefined;
  /** dice.js after a logged roll. In a room, a player's table announces it to the GM. */
  'roll': { roll: DiceRoll };
  /** hunter.js when a hunter reaches a new level. The phone buzzes. */
  'levelup': LevelUp;
  /** quests.js when a quest is completed. The phone buzzes. */
  'quest:done': { hunterId: string; quest: Quest };
  /** combat.js when a turn starts, table.js when a remote player's turn starts. Skills tick cooldowns; the phone buzzes. */
  'combat:turn': { hunterId: string | null };
  /** combat.js when a monster or shadow goes down (the fight's `defeated` effect), with its row. The bestiary records the kill. */
  'combat:defeated': { body: Body };
  /** combat.js when a fight ends (the fight's `ended` effect), and the gate it was started from. The bestiary records the fallen; a gate's fight offers to clear the gate or open its class offer. */
  'combat:end': { fight: Ended; gateId: string | null; offerClasses?: GateId | null };
  /** sync.ts for each room event another phone sent. The GM's quest and table views show replies and rolls. */
  'sync:event': { event: StoredEvent };
  /** sync.ts when the room's hunter sheets change. Views that list the party redraw. */
  'sync:sheets': { sheets: Record<SheetKey, Stored<ServedSheet>> };
  /** sync.ts when the room's shared documents change. Views that read a document (bestiary, gates, rules) redraw. */
  'sync:docs': { docs: RoomDocs };
  /**
   * sync.ts when the room answered a message from the outbox (src/core/sync/outbox.ts): `id` is the entry's (an event's
   * id), `seq` the room's for it. A player's table lets its turn go when the room refused the move it waits on.
   */
  'sync:outbox': { id: string; at: 'sent'; seq: number | null } | { id: string; at: 'refused'; why: string } | { id: string; at: 'dropped' };
  /**
   * sync.ts when the link to the room changes. The pill, the Room view and room-aware buttons redraw. `serverBack`: the
   * server answers again after failing (link.ts `serverBack`), so a view checks again what it could not.
   */
  'sync:status': { status: 'off' | 'offline' | 'connected'; room: RoomCode | null; conn: Connection; serverBack: boolean };
  /** sync.ts when the room this phone is in changes: joined, left, removed, the room gone, or another tab's save. The Room view drops its old errors. */
  'sync:room': { from: RoomCode | null; to: RoomCode | null };
};
export type EventName = keyof AppEvents;
