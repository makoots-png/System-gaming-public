// One message in the outbox (src/core/sync/outbox.ts) as it is posted, and every event of its life, walked by the state
// chart (scripts/charts/outbox.ts); tests/statecharts.test.ts checks the walk reaches every state. tests/outbox.test.ts
// checks each cell, and tests/room-system-model.test.ts runs the outbox on two and three phones.
import { post } from '../../src/core/sync/outbox.ts';
import type { Entry, EntryEvent } from '../../src/core/sync/outbox.ts';
import type { RoomCode } from '../../src/core/protocol.ts';
import { hid } from '../fixtures/ids.ts';

/** A deleted hunter's tombstone, just posted: the walk is the same for every letter. */
export const START: Entry = post([], 'ABCD23' as RoomCode, { kind: 'tomb', hid: hid('h1') }).box[0]!;
/** One of each event of an entry's life. */
export const WALK_EVENTS: readonly EntryEvent[] = [
  { type: 'send' }, { type: 'sent' }, { type: 'failed' }, { type: 'refused', why: 'not your sheet' }, { type: 'reload' }, { type: 'drop' },
];
