// The events of this phone's solo run (src/core/gates/solo-run.ts), over two gates, shared by tests/solo-run.test.ts and
// the state chart (scripts/charts/solo-run.ts), so both walk the same events.
import type { RunPhaseEvent } from '../../src/core/gates/solo-run.ts';
import type { GateId, HunterId, PersonalGateId } from '../../src/core/ids.ts';

export const MIRA = 'h1' as HunterId;
/** A personal gate and a world gate, so a tap on another gate's Enter alone is walked too. */
export const PERSONAL = { kind: 'personal', id: 'pg1' as PersonalGateId } as const;
export const WORLD = { kind: 'world', id: 'g1' as GateId } as const;
/** Every event, from every state: a tap on either gate, the question answered, a round played, the write, the end. */
export const RUN_PHASE_WALK: readonly RunPhaseEvent[] = [
  { type: 'enter', gate: PERSONAL, hid: MIRA }, { type: 'enter', gate: WORLD, hid: MIRA },
  { type: 'go' }, { type: 'played', round: 1, moves: 3 }, { type: 'wrote' }, { type: 'done' },
];
