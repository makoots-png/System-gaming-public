// The events of wave 2's six machines (kits design 8.9), shared by the tests that walk them and the state charts
// (scripts/charts/wave2.ts), so both walk the same events.
import type { ReactEvent } from '../../src/core/combat/fight-react.ts';
import type { EdgeEvent, StealthEvent, WardEvent } from '../../src/core/combat/standing.ts';
import type { ShoveEvent } from '../../src/core/combat/space.ts';
import type { ExtraEvent, HasteEvent } from '../../src/core/combat/timeline.ts';

/** 8.9.1: armed and disarmed; a moment that may fire and one that may not; its use resolving; its turn; down. */
export const REACT_WALK: readonly ReactEvent[] = [
  { type: 'arm' }, { type: 'disarm' }, { type: 'moment', may: true }, { type: 'moment', may: false }, { type: 'resolves' }, { type: 'turnStart' }, { type: 'down' },
];
/** 8.9.2: one or two stacks land; a die reached that spends and one worn; its end. */
export const EDGE_WALK: readonly EdgeEvent[] = [{ type: 'lands', k: 1 }, { type: 'reached', spend: true }, { type: 'reached', spend: false }, { type: 'ends' }];
/** 8.9.3: a push of 2 or of 0 (rooted, missed); a free floor tile, a rough one and a stop; the anchor; `zoneSync`. */
export const SHOVE_WALK: readonly ShoveEvent[] = [
  { type: 'lands', k: 2 }, { type: 'lands', k: 0 }, { type: 'tile', free: true, cost: 1 }, { type: 'tile', free: true, cost: 2 }, { type: 'tile', free: false, cost: 1 },
  { type: 'anchor' }, { type: 'settles' },
];
/** 8.9.4: a hide seen and unseen; acting, a foe near, a hurt, its time; the reveal settling. */
export const STEALTH_WALK: readonly StealthEvent[] = [
  { type: 'hide', seen: true }, { type: 'hide', seen: false }, { type: 'acts' }, { type: 'foeNear' }, { type: 'hurt' }, { type: 'time' }, { type: 'settles' },
];
/** 8.9.5: it lands; its bearer acts on a foe; a hit at 1; a round passes. */
export const WARD_WALK: readonly WardEvent[] = [{ type: 'lands' }, { type: 'acts' }, { type: 'lethal' }, { type: 'ends' }];
/** 8.9.6: an extra with one left and with none; a later round; a haste; a turn start. */
export const EXTRA_WALK: readonly ExtraEvent[] = [{ type: 'extra', left: 1 }, { type: 'extra', left: 0 }, { type: 'laterRound' }];
export const HASTE_WALK: readonly HasteEvent[] = [{ type: 'hastened' }, { type: 'turnStart' }];
