// rests.ts: how many rests a hunter has taken in the gate it is in, as a machine. Pure.
// the owner, Nov 22: "They should get 2x per dungeon, and after a dungeon clear they should get everything back." A
// dungeon is a gate. A player's phone cannot know which gate its hunter is in; what reaches it is a gate's Clear (its
// `gate` fact) and the end of its own solo run. So the count is the rests taken since the hunter's last gate ended for
// it (docs/agent-handoff/features/notes-10-rest.md, question 1). `Hunter.restsTaken` holds it; grant.ts `sheetEdit` is
// its one writer, with the rest's vitals (vitals.ts `rest`) or the Clear's (`cleared`) in the same answer.
import { refuse } from '../save-step.ts';
import type { Refused } from '../save-step.ts';
import type { Rules } from '../rules.ts';
import { WAYS_BACK } from './vitals.ts';

export const REST_STATES = ['left', 'spent'] as const;
/** `left`: fewer rests taken than `R.rest.perGate`; `spent`: all of them, until the gate ends for the hunter. */
export type RestState = (typeof REST_STATES)[number];
/**
 * A rest taken; a gate the hunter was paid for cleared (everything back, vitals.ts `cleared`); a gate left without its
 * Clear (a solo run lost; a retreat leaves the gate open and keeps its rests): the count starts again, nothing else comes back.
 */
export type RestEvent = { readonly type: 'rest' } | { readonly type: 'cleared' } | { readonly type: 'gateLeft' };
export type RestEventType = RestEvent['type'];
export const REST_EVENT_TYPES = ['rest', 'cleared', 'gateLeft'] as const satisfies readonly RestEventType[];

/** Where a count of `taken` rests stands against the rules' rests a gate. */
export const restState = (taken: number, R: Pick<Rules, 'rest'>): RestState => (taken < R.rest.perGate ? 'left' : 'spent');
/** The rests a hunter has left in this gate: never below 0. */
export const restsLeft = (taken: number, R: Pick<Rules, 'rest'>): number => Math.max(0, R.rest.perGate - taken);

type Cell = ((taken: number) => number) | null;
/** For each state, what each event does to the count. `null`: refused (`spent`), and the count stays. */
const TABLE: { readonly [S in RestState]: { readonly [E in RestEventType]: Cell } } = {
  left: { rest: n => n + 1, cleared: () => 0, gateLeft: () => 0 },
  spent: { rest: null, cleared: () => 0, gateLeft: () => 0 },
};

/** The count after `e`, or `spent` when no rest is left. */
export function restStep(taken: number, e: RestEvent, R: Pick<Rules, 'rest'>): number | Refused<'spent'> {
  const cell = TABLE[restState(taken, R)][e.type];
  return cell ? cell(Math.max(0, taken)) : refuse('spent');
}

/** The sheet's words for a refused rest: none left in this gate (`spent`), or the hunter is dead (`cannot`, vitals.ts `VITAL_TABLE`). */
export const restRefusalWords = (R: Pick<Rules, 'rest'>): { readonly spent: string; readonly cannot: string } => ({
  spent: `No rest left: a hunter rests ${R.rest.perGate} time${R.rest.perGate === 1 ? '' : 's'} a gate. Clearing the gate gives everything back.`,
  cannot: `A dead hunter cannot rest. ${WAYS_BACK} brings you back.`,
});
/** The line under the Rest button: the rests left in this gate. */
export const restsLeftLine = (taken: number, R: Pick<Rules, 'rest'>): string => `Rests left this gate: ${restsLeft(taken, R)} of ${R.rest.perGate}.`;
