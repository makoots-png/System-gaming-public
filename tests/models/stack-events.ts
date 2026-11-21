// A stacking status of the kits (Resonance: three stacks burst and are spent; one leaves each round) and the events of a
// count's life; and the events of a status's own life on its bearer (standing.ts `statusStep`, SMX-rules-2). Shared by
// tests/effect-ops.test.ts and the state charts (scripts/charts/stacks.ts), so both walk the same events (kits design
// table 2.1).
import type { StackCtx, StackEvent } from '../../src/core/combat/stacks.ts';
import type { StatusEvent } from '../../src/core/combat/standing.ts';

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

/**
 * Every event of a status's life, each with every value of its fields: a land whose end is still ahead or already
 * behind; time moving with its end ahead, or past with a settle owed or not; its bearer's settle before or past its end;
 * a cure, a dispel or a spend taking it whole.
 */
export const STATUS_WALK: readonly StatusEvent[] = [
  { type: 'land', runs: true }, { type: 'land', runs: false },
  { type: 'time', past: false, owes: false }, { type: 'time', past: false, owes: true }, { type: 'time', past: true, owes: false }, { type: 'time', past: true, owes: true },
  { type: 'settle', past: false }, { type: 'settle', past: true },
  { type: 'taken' },
];
