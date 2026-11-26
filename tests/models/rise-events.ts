// The events of a corpse's mid-fight rise state machine (src/core/combat/rise.ts `riseStep`),
// shared by tests/rise.test.ts and any future state chart.
import type { RiseEvent } from '../../src/core/combat/rise.ts';

/** One of each: a failed Presence check leaves the corpse open; a passed check marks it risen. */
export const RISE_WALK: readonly RiseEvent[] = [{ type: 'fail' }, { type: 'succeed' }];
