// A stacking status of the kits (Resonance: three stacks burst and are spent; one leaves each round) and the events of a
// count's life. Shared by tests/effect-ops.test.ts and the state chart (scripts/charts/stacks.ts), so both walk the same
// events (kits design table 2.1).
import type { StackCtx, StackEvent } from '../../src/core/combat/stacks.ts';

/** A cap of 5, one leaving a round, a fight's count, a threshold at 3 that spends. */
export const RESONANCE: StackCtx = {
  rule: { cap: 5, leave: { kind: 'round' }, keep: 'fight', threshold: { at: { kind: 'count', n: 3 }, to: { kind: 'bearer' }, ops: [], then: 'spend' } },
  at: 3,
};

/** One of each event: an apply of one and of two, a round, the bearer struck, a price of one, its time, a cure of one and of all, the fight's end. */
export const WALK_EVENTS: readonly StackEvent[] = [
  { type: 'apply', k: 1 }, { type: 'apply', k: 2 }, { type: 'round', rounds: 1 }, { type: 'event', event: 'struck' }, { type: 'price', m: 1 },
  { type: 'timeEnds' }, { type: 'cure', n: 1 }, { type: 'cure', n: null }, { type: 'fightEnds' },
];
