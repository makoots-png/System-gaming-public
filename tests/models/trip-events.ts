// The events of one trigger's limit (kits design table 2.5), shared by tests/triggers.test.ts and the state chart
// (scripts/charts/trips.ts), so both walk the same events: an event in the first round, in the next, and one skipped
// past the chain's depth or the command's firings.
import type { Limit, TripEvent } from '../../src/core/combat/triggers.ts';

export const WALK_EVENTS: readonly TripEvent[] = [{ type: 'event', round: 0 }, { type: 'event', round: 1 }, { type: 'skipped' }];
/** The three limits the chart walks: every time, once a round, twice a fight. */
export const LIMITS: readonly Limit[] = [{ kind: 'each' }, { kind: 'round' }, { kind: 'fight', n: 2 }];
