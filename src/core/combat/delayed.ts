// delayed.ts: a delayed effect, a status with an `end` (docs/agent-handoff/kits/design.md section 1.6, table 2.2), as a
// machine. Pure. `endStep` is the one place that decides whether an end lands: the settle (fight-turn.ts) asks it when
// the status's time has run out, a cure (resolve.ts rule 18, land.ts) when it takes the status whole. A price that
// spends it to 0, its bearer going down and the fight's end cancel or void it: nothing lands. A new event is a member of
// `DelayedEvent` and its cells in `TABLE` (the typecheck asks), its line in tests/models/delayed-events.ts and its words
// in scripts/charts/delayed.ts.

import type { End } from './effect-ops.ts';

export const DELAYED_STATES = ['absent', 'armed', 'landed', 'cancelled', 'void'] as const;
export type DelayedState = (typeof DELAYED_STATES)[number];
/** Where a status with an end stands on one bearer: not on it, armed (on it, its time running), or done one of three ways. */
export type Delayed = { readonly at: DelayedState };
/**
 * What changes it: it is put on (again: the later end, `applyStatus`); its bearer settles at or after its end (`due`);
 * a cure takes it whole; a price spends it to 0; its bearer goes down; the fight ends.
 */
export type DelayedEvent = { readonly type: 'apply' } | { readonly type: 'due' } | { readonly type: 'cure' } | { readonly type: 'spent' } | { readonly type: 'down' } | { readonly type: 'fightEnds' };
export type DelayedEventType = DelayedEvent['type'];
type Step = (s: Delayed, end: End) => { readonly to: Delayed; readonly lands: boolean };
const go = (at: DelayedState, lands = false) => () => ({ to: { at }, lands });
/** A cure: `cancel` saves its bearer (the default), `land` sets it off at once (a detonation). */
const cure: Step = (_s, end) => (end.cleanse === 'land' ? { to: { at: 'landed' }, lands: true } : { to: { at: 'cancelled' }, lands: false });
/** Table 2.2 of the kits design. `null`: the event does not apply there, and nothing changes or lands. */
const TABLE: { readonly [S in DelayedState]: { readonly [E in DelayedEventType]: Step | null } } = {
  absent: { apply: go('armed'), due: null, cure: null, spent: null, down: null, fightEnds: null },
  armed: { apply: go('armed'), due: go('landed', true), cure, spent: go('cancelled'), down: go('void'), fightEnds: go('void') },
  landed: { apply: null, due: null, cure: null, spent: null, down: null, fightEnds: null },
  cancelled: { apply: null, due: null, cure: null, spent: null, down: null, fightEnds: null },
  void: { apply: null, due: null, cure: null, spent: null, down: null, fightEnds: null },
};
/** Where a status with `end` stands after `event`, and whether its end's ops land now. Never changes its input. */
export function endStep(s: Delayed, event: DelayedEvent, end: End): { readonly to: Delayed; readonly lands: boolean } {
  const step = TABLE[s.at][event.type];
  return step ? step(s, end) : { to: s, lands: false };
}
export const ARMED: Delayed = { at: 'armed' };
