// The events of a timed summon's life (kits design table 2.4), shared by tests/fight.test.ts ("a timed summon") and the
// state chart (scripts/charts/summon.ts), so both walk the same events.
import type { SummonEvent } from '../../src/core/combat/summons.ts';

/** One of each: its turn before its end and at or after it, its owner gone, its HP at 0, a third, the fight's end. */
export const SUMMON_WALK: readonly SummonEvent[] = [
  { type: 'turn', late: false }, { type: 'turn', late: true }, { type: 'ownerGone' }, { type: 'down' }, { type: 'third' }, { type: 'fightEnds' },
];
