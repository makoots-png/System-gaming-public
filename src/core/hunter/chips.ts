// chips.ts: every chip a hunter's state draws, from its vitals (src/core/hunter/vitals.ts) and its daily penalty
// (src/core/hunter/penalty.ts). A chip is not a status: no picker offers it, a room message or a combat command that
// adds or removes one is refused, and the save repair drops one found in `conditions`. Its label is in the status
// registry (`STATE_CHIP_DEFS`). A new chip joins the list of the model that draws it; the typecheck then asks for its
// label and for the reason a change to it is refused.
import { VITAL_CHIPS, vitalChipsOf } from './vitals.ts';
import type { Vitals } from './vitals.ts';
import { PENALTY_CHIPS, penaltyChipsOf } from './penalty.ts';
import type { Penalty } from './penalty.ts';
import { STATE_CHIP_DEFS } from '../registry/statuses.ts';
import type { StatusDef } from '../combat/effect-ops.ts';

export const STATE_CHIPS = [...VITAL_CHIPS, ...PENALTY_CHIPS] as const;
export type StateChip = (typeof STATE_CHIPS)[number];
export const isStateChip = (key: unknown): key is StateChip => (STATE_CHIPS as readonly unknown[]).includes(key);

/** The chips a hunter shows for its state, vitals first. */
export const chipsOf = (h: Pick<Vitals, 'life' | 'collapsed'> & { penalty: Penalty | null }): StateChip[] => [...vitalChipsOf(h), ...penaltyChipsOf(h)];

/** What a chip reads: its label and description in the status registry (`STATE_CHIP_DEFS`). */
export const chipDef = (key: StateChip): StatusDef => STATE_CHIP_DEFS[key];

/** Whether chip `key` is drawn from the hunter's life, so a screen colors it by the life's state. */
export const ofLife = (key: StateChip): boolean => key === 'dead';

/** What a GM is told when a combat command tries to put a chip on or take it off. */
export const CHIP_REFUSAL: Readonly<Record<StateChip, string>> = {
  dead: 'Dead follows HP and ends with a revive.',
  exhausted: 'Exhausted follows fatigue and lifts with a rest that leaves fatigue under the collapse share, or a gate\'s Clear.',
  penalized: 'Penalized follows a missed daily and ends when its Penalty Zone quest is done.',
};
