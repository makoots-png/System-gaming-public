// The events of wave 2's six machines (kits design 8.9), shared by the tests that walk them and the state charts
// (scripts/charts/wave2.ts), so both walk the same events.
import type { ReactEvent } from '../../src/core/combat/fight-react.ts';
import type { EdgeEvent, Hide, Stealth, StealthEvent, WardEvent } from '../../src/core/combat/standing.ts';
import { statusKey } from '../../src/core/combat/effect-ops.ts';
import type { ShoveEvent } from '../../src/core/combat/space.ts';
import type { ExtraEvent, HasteEvent } from '../../src/core/combat/timeline.ts';

/** 8.9.1: armed by a reactor up and by one down, and disarmed; a moment that may fire at an aim up or down, and one that may not; its use resolving; its turn; down. */
export const REACT_WALK: readonly ReactEvent[] = [
  { type: 'arm', up: true }, { type: 'arm', up: false }, { type: 'disarm' },
  { type: 'moment', may: true, aim: 'up' }, { type: 'moment', may: true, aim: 'down' }, { type: 'moment', may: false, aim: 'up' },
  { type: 'resolves' }, { type: 'turnStart' }, { type: 'down' },
];
/** 8.9.2: one or two stacks land; a die reached that spends and one worn; its end. */
export const EDGE_WALK: readonly EdgeEvent[] = [{ type: 'lands', k: 1 }, { type: 'reached', spend: true }, { type: 'reached', spend: false }, { type: 'ends' }];
/** 8.9.3: a push of 2 or of 0 (rooted, missed); a free floor tile, a rough one and a stop; the anchor; `zoneSync`. */
export const SHOVE_WALK: readonly ShoveEvent[] = [
  { type: 'lands', k: 2 }, { type: 'lands', k: 0 }, { type: 'tile', free: true, cost: 1 }, { type: 'tile', free: true, cost: 2 }, { type: 'tile', free: false, cost: 1 },
  { type: 'anchor' }, { type: 'settles' },
];
/** Two hides: the kits' Stealth (level 1, out of sight, ended by each of the three) and an Invisible (level 3, anywhere, not ended by a hurt). */
export const STEALTH_HIDE: Hide = { key: statusKey('stealth'), level: 1, ends: { hurt: true, revealed: true, dealt: true } };
export const INVISIBLE_HIDE: Hide = { key: statusKey('invisible'), level: 3, ends: { hurt: false, revealed: true, dealt: true } };
/** Where the walk of stealth starts: a body seen, wearing no `stayHidden`, and one wearing it on `dealt` (an Unseen Blade). */
export const STEALTH_STARTS: readonly Stealth[] = [{ hides: [], kept: new Set() }, { hides: [], kept: new Set(['dealt']) }];
/** notes-7-stealth.md section 4: the Stealth hide watched and unwatched, the Invisible one watched; a hurt, damage dealt, a reveal. */
export const STEALTH_WALK: readonly StealthEvent[] = [
  { type: 'hide', hide: STEALTH_HIDE, start: 'unseen', watched: true }, { type: 'hide', hide: STEALTH_HIDE, start: 'unseen', watched: false },
  { type: 'hide', hide: INVISIBLE_HIDE, start: 'anywhere', watched: true }, { type: 'hurt' }, { type: 'dealt' }, { type: 'revealed' },
];
/** 8.9.5: it lands; its bearer acts on a foe; a hit at 1; a round passes. */
export const WARD_WALK: readonly WardEvent[] = [{ type: 'lands' }, { type: 'acts' }, { type: 'lethal' }, { type: 'ends' }];
/** 8.9.6: an extra with one left and with none; a later round; a haste; a turn start. */
export const EXTRA_WALK: readonly ExtraEvent[] = [{ type: 'extra', left: 1 }, { type: 'extra', left: 0 }, { type: 'laterRound' }];
export const HASTE_WALK: readonly HasteEvent[] = [{ type: 'hastened' }, { type: 'turnStart' }];
