// The events of a zone's life in the kits (kits design table 2.6), shared by tests/fight.test.ts ("a zone on the ground:
// the kits' upkeep") and the state chart (scripts/charts/zone.ts), so both walk the same events.
import type { ZoneEvent } from '../../src/core/combat/zones.ts';

/** One of each: its upkeep paid and not, a fourth zone, a price and its time a round old or younger, its owner down, or erased by a foe. */
export const ZONE_WALK: readonly ZoneEvent[] = [
  { type: 'paid' }, { type: 'unpaid' }, { type: 'fourth' }, { type: 'price', old: true }, { type: 'price', old: false },
  { type: 'time', old: true }, { type: 'time', old: false }, { type: 'ownerDown' }, { type: 'erased' },
];
