// The events of a hunter's life walk. Shared by tests/vitals.test.ts and the state charts (scripts/charts/life.ts), so
// both walk the same events.
import type { LifeEvent } from '../../src/core/hunter/vitals.ts';

/** The chart's hunter starts with 20 max HP (the test's too). On maxChanged the maximum drops to 12, so the walk also covers HP above a lowered maximum. */
export const WALK_MAX = 20, LOWERED_MAX = 12;

/** 12 events: a small and a large hit, a heal, HP set to 0 and to 9, a death save of 1, 5, 15 and 20, and the GM's stabilize and revive. */
export const WALK_EVENTS: LifeEvent[] = [
  { type: 'damage', amount: 7 }, { type: 'damage', amount: 25 }, { type: 'heal', amount: 6 }, { type: 'setHp', hp: 0 }, { type: 'setHp', hp: 9 },
  { type: 'deathSave', roll: 1 }, { type: 'deathSave', roll: 5 }, { type: 'deathSave', roll: 15 }, { type: 'deathSave', roll: 20 },
  { type: 'stabilize' }, { type: 'revive' }, { type: 'maxChanged' },
];

/** The maximum after `event`: the walk lowers it on maxChanged and keeps it otherwise. */
export const maxAfter = (event: LifeEvent, max: number): number => (event.type === 'maxChanged' ? LOWERED_MAX : max);
