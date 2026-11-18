// The events of a delayed effect's life (kits design table 2.2) and the two ends it may have, shared by tests/fight.test.ts
// ("a delayed effect") and the state chart (scripts/charts/delayed.ts), so both walk the same events.
import type { DelayedEvent } from '../../src/core/combat/delayed.ts';
import type { End } from '../../src/core/combat/effect-ops.ts';

/** One of each event: put on (again), due at its bearer's settle, a cure, a price spending it, its bearer down, the fight's end. */
export const WALK_EVENTS: readonly DelayedEvent[] = [
  { type: 'apply' }, { type: 'due' }, { type: 'cure' }, { type: 'spent' }, { type: 'down' }, { type: 'fightEnds' },
];
/** A cleanse that saves its bearer (Hemoplague) and one that sets it off (a detonation). */
export const ENDS: readonly End[] = [{ ops: [], cleanse: 'cancel' }, { ops: [], cleanse: 'land' }];
