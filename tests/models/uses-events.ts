// The events of a limited use (kits design table 2.3), shared by tests/fight.test.ts ("a limited use") and the state
// chart (scripts/charts/uses.ts), so both walk the same events.
import type { UsesEvent } from '../../src/core/combat/uses.ts';

/** One of each: a use, the fight's end, a long rest, the GM setting none spent. */
export const USES_WALK: readonly UsesEvent[] = [{ type: 'used' }, { type: 'fightEnds' }, { type: 'longRest' }, { type: 'gmSets', spent: 0 }];
