// chips.ts: every chip a hunter's state draws, from its vitals (src/core/hunter/vitals.ts) and its daily penalty
// (src/core/hunter/penalty.ts). A chip is not a status: no picker offers it, a room message or a combat command that
// adds or removes one is refused, and the save repair drops one found in `conditions`. Its label is in the status
// registry (`STATE_CHIP_DEFS`). A new chip joins the list of the model that draws it; the typecheck then asks for its
// label and for the reason a change to it is refused.
import { VITAL_CHIPS, vitalChipsOf } from './vitals.ts';
import type { Vitals } from './vitals.ts';
import { LIFE_TAG } from './vitals.ts';
import { PENALTY_CHIPS, penaltyChipsOf } from './penalty.ts';
import type { Penalty } from './penalty.ts';
import { STATE_CHIP_DEFS } from '../registry/statuses.ts';
import type { StatusDef } from '../combat/effect-ops.ts';

export const STATE_CHIPS = [...VITAL_CHIPS, ...PENALTY_CHIPS] as const;
export type StateChip = (typeof STATE_CHIPS)[number];
export const isStateChip = (key: unknown): key is StateChip => (STATE_CHIPS as readonly unknown[]).includes(key);

/** The chips a hunter shows for its state, vitals first. */
export const chipsOf = (h: Pick<Vitals, 'life' | 'collapsed'> & { penalty: Penalty | null }): StateChip[] => [...vitalChipsOf(h), ...penaltyChipsOf(h)];

/**
 * What a chip reads for this hunter. The chip of a hunter at 0 HP says what the death panel says, Down or Down, stable
 * (A23): one state, one word. The key is `down`.
 */
export const chipDef = (key: StateChip, life: Pick<Vitals, 'life'>['life']): StatusDef =>
  (key === 'down' && LIFE_TAG[life.at] ? { ...STATE_CHIP_DEFS.down, label: LIFE_TAG[life.at] } : STATE_CHIP_DEFS[key]);

/** What a GM is told when a combat command tries to put a chip on or take it off. */
export const CHIP_REFUSAL: Readonly<Record<StateChip, string>> = {
  down: 'Down and Dead follow HP and death saves.',
  dead: 'Down and Dead follow HP and death saves.',
  exhausted: 'Exhausted follows fatigue and ends with a long rest.',
  penalized: 'Penalized follows a missed daily and ends when its Penalty Zone quest is done.',
};
