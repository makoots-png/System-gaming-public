// The events of the store's life, every kind, and the lives a tab opens in. Shared by tests/store-life.test.ts and the
// state chart (scripts/charts/store.ts), so both walk the same events.
import { opened } from '../../src/core/store-life.ts';
import type { StoreEvent, StoreLife } from '../../src/core/store-life.ts';

export const WALK_EVENTS: readonly StoreEvent[] = [
  { type: 'changed' },
  { type: 'due' },
  { type: 'leaving' },
  { type: 'wrote' },
  { type: 'writeFailed' },
  { type: 'otherTab', theirs: 'save' },
  { type: 'otherTab', theirs: 'newer' },
  { type: 'otherTab', theirs: 'unreadable' },
  { type: 'replaced' },
  { type: 'kept' },
  { type: 'keepFailed' },
  { type: 'takeOver' },
  { type: 'takenOver' },
];

/**
 * Every life a load opens in: storage blocked, a newer app's save, this app's, a text storage was too full to back up,
 * and a save whose running fight storage was too full to back up.
 */
export const STARTS: readonly StoreLife[] = [
  opened({ storage: 'blocked', newer: false, backup: 'none' }).life,
  opened({ storage: 'ok', newer: true, backup: 'none' }).life,
  opened({ storage: 'ok', newer: false, backup: 'none' }).life,
  opened({ storage: 'ok', newer: false, backup: { unkept: 'unreadable' } }).life,
  opened({ storage: 'ok', newer: false, backup: { unkept: 'fight' } }).life,
];
