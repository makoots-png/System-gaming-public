// stacks.ts: the count of a stacking status on one bearer, as a machine (docs/agent-handoff/kits/design.md section 1.1,
// table 2.1). Pure. `stackStep` is the one place a count changes: effect-ops.ts `applyStatus`, the settle's round leave,
// a cure and a price call it. A threshold is a cell of this table, not a machine: it fires on the crossing, so nothing
// records that it fired (design 1.2). A new event is a member of `StackEvent` and its cells in `TABLE` (the typecheck
// asks), its line in `WALK_EVENTS` (tests/models/stack-events.ts) and its words in scripts/charts/stacks.ts.

import type { BearerEvent } from './triggers.ts';
import type { StackRule } from './effect-ops.ts';

export const STACK_STATES = ['absent', 'held'] as const;
export type StackState = (typeof STACK_STATES)[number];
/** A stacking status's count on one bearer: none, or `n`, 1 to its cap. */
export type Stack = { readonly at: 'absent' } | { readonly at: 'held'; readonly n: number };

/**
 * What changes a count: `k` stacks applied; `rounds` whole rounds held (its leave `round`); an event of the bearer (its
 * leave `event` names one); a price that takes `m`; its time running out; a cure of `n` stacks (null, all of them); the
 * fight's end.
 */
export type StackEvent =
  | { readonly type: 'apply'; readonly k: number }
  | { readonly type: 'round'; readonly rounds: number }
  | { readonly type: 'event'; readonly event: BearerEvent }
  | { readonly type: 'price'; readonly m: number }
  | { readonly type: 'timeEnds' }
  | { readonly type: 'cure'; readonly n: number | null }
  | { readonly type: 'fightEnds' };
export type StackEventType = StackEvent['type'];

/**
 * The rule a step reads: the def's stack rule, and its threshold's count (`at`: a count, or its formula's value over
 * the bearer, which the caller works out) or null when the threshold is not read here (an apply that sets nothing off:
 * the GM's own window, a sheet).
 */
export type StackCtx = { readonly rule: StackRule; readonly at: number | null };
/**
 * What a step did: the count after it, whether the threshold fired on the way (its ops are the caller's to land), and
 * how a count that went went: `ended` (its time ran out: its end lands, design 1.6), `cured`, `spent` (a price, a
 * spend, a round leave or the bearer's event took the last stack: spent is not ended), `dropped` (the fight ended with
 * a fight's count). Null while it is held, or when it was absent.
 */
export type Stepped = { readonly stack: Stack; readonly fired: boolean; readonly gone: 'ended' | 'cured' | 'spent' | 'dropped' | null };

const ABSENT: Stack = { at: 'absent' };
const held = (n: number): Stack => (n >= 1 ? { at: 'held', n } : ABSENT);
const whole = (n: number): number => (Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : 0);
/** A threshold's count, clamped to 1 to the cap (design 1.2); null when there is none or it is not read. */
const thresholdOf = (c: StackCtx): number | null => c.rule.threshold === null || c.at === null ? null : Math.max(1, Math.min(c.rule.cap, Math.round(c.at)));
const left = (s: Stack, n: number, gone: Stepped['gone']): Stepped => { const next = held(n); return { stack: next, fired: false, gone: next.at === 'absent' ? gone : null }; };

type Step<T extends StackEventType> = (s: Stack, e: Extract<StackEvent, { type: T }>, c: StackCtx) => Stepped;
type Row = { readonly [T in StackEventType]: Step<T> | null };
const countOf = (s: Stack): number => (s.at === 'held' ? s.n : 0);

/**
 * `k` stacks on, up to the cap. When the count goes from under the threshold to at or over it, the threshold fires:
 * `spend` takes its count off (absent at 0), `keep` leaves the count, so it fires again only after it falls below.
 */
const apply: Step<'apply'> = (s, e, c) => {
  const before = countOf(s), after = Math.min(c.rule.cap, before + Math.max(1, whole(e.k))), at = thresholdOf(c);
  if (at === null || !(before < at && at <= after)) return { stack: held(after), fired: false, gone: null };
  if (c.rule.threshold!.then === 'keep') return { stack: held(after), fired: true, gone: null };
  const rest = held(after - at);
  return { stack: rest, fired: true, gone: rest.at === 'absent' ? 'spent' : null };
};
/** A round leave takes one stack for each whole round held. */
const round: Step<'round'> = (s, e, c) => (c.rule.leave.kind === 'round' ? left(s, countOf(s) - whole(e.rounds), 'spent') : { stack: s, fired: false, gone: null });
/** The bearer's named event takes every stack; another event changes nothing. */
const event: Step<'event'> = (s, e, c) => (c.rule.leave.kind === 'event' && c.rule.leave.event === e.event ? left(s, 0, 'spent') : { stack: s, fired: false, gone: null });
/** A price takes `m`; going down by a price never fires a threshold. */
const price: Step<'price'> = (s, e) => left(s, countOf(s) - whole(e.m), 'spent');
const timeEnds: Step<'timeEnds'> = () => ({ stack: ABSENT, fired: false, gone: 'ended' });
/** A cure takes `n` stacks, or all of them. */
const cure: Step<'cure'> = (s, e) => left(s, e.n === null ? 0 : countOf(s) - whole(e.n), 'cured');
/** A fight's count goes with the fight; a sheet's is written back with its stacks. */
const fightEnds: Step<'fightEnds'> = (s, _e, c) => (c.rule.keep === 'fight' ? { stack: ABSENT, fired: false, gone: 'dropped' } : { stack: s, fired: false, gone: null });

/** Table 2.1 of the kits design. `null`: the event does not apply there, and the count stays as it is. */
const TABLE: { readonly [S in StackState]: Row } = {
  absent: { apply, round: null, event: null, price: null, timeEnds: null, cure: null, fightEnds: null },
  held: { apply, round, event, price, timeEnds, cure, fightEnds },
};

/** The count after `event` under `ctx`. Never changes its input. */
export function stackStep(s: Stack, event: StackEvent, ctx: StackCtx): Stepped {
  // The table's type pairs each key with the step for that event, so the step for `event.type` takes `event`.
  const step = TABLE[s.at][event.type] as Step<StackEventType> | null;
  return step ? step(s, event as never, ctx) : { stack: s, fired: false, gone: null };
}
/** Whether `type` changes anything in this state. */
export const canStack = (s: Stack, type: StackEventType): boolean => TABLE[s.at][type] !== null;
