// summons.ts: a summon's or risen corpse's life in a fight (docs/agent-handoff/kits/design.md section 1.9, table 2.4;
// Wave 2 PR 2), as a machine. Pure. A summon is a row of kind `summon` (rows.ts `summonRow`, rise.ts `risenRow`) with
// an `owner` and either a timed `until` or `until: null` with `rose` set; the reducer calls `summonStep` when a timed
// summon's turn starts, when another row in the same owner lane arrives past cap, and after every change (its owner
// down or gone, its HP at 0, or the fight ends). A summon never keeps a side up (fight-turn.ts `holdsSide`). A new
// event is a member of `SummonEvent` and its cells in `TABLE` (the typecheck asks), its line in
// tests/models/summon-events.ts and its words in scripts/charts/summon.ts.

import type { Tick } from './timeline.ts';
import { isUp } from './row-hp.ts';
import type { Body } from './effect-ops.ts';
import type { CombatantId } from './ability-types.ts';

export const SUMMON_STATES = ['present', 'gone'] as const;
export type SummonState = (typeof SUMMON_STATES)[number];
/**
 * What happens to a summon or risen corpse: its turn starts before its `until` or at or after it (timed summons only);
 * its owner goes down or leaves; its HP reaches 0; another row in its lane arrives past cap and it is the oldest;
 * the fight ends.
 */
export type SummonEvent =
  | { readonly type: 'turn'; readonly late: boolean } | { readonly type: 'ownerGone' } | { readonly type: 'down' } | { readonly type: 'evicted' } | { readonly type: 'fightEnds' };
export type SummonEventType = SummonEvent['type'];
type Step = (e: SummonEvent) => SummonState;
const leaves: Step = () => 'gone';
/** Table 2.4 of the kits design, extended to risen rows. `null`: the event does not apply there, and nothing changes. */
const TABLE: { readonly [S in SummonState]: { readonly [E in SummonEventType]: Step | null } } = {
  present: { turn: e => (e.type === 'turn' && e.late ? 'gone' : 'present'), ownerGone: leaves, down: leaves, evicted: leaves, fightEnds: leaves },
  gone: { turn: null, ownerGone: null, down: null, evicted: null, fightEnds: null },
};
/** A summon's state after `event`. */
export function summonStep(s: SummonState, event: SummonEvent): SummonState {
  const step = TABLE[s][event.type];
  return step ? step(event) : s;
}

/** Whether a row is a summon (timed summon or risen corpse). */
export const isSummon = (b: Pick<Body, 'kind'>): boolean => b.kind === 'summon';
export { isMinionOf, ownerOf } from './effect-ops.ts';
/** Whether `b` is a corpse risen mid-fight by Arise (`kind === 'summon'` with `rose` set). */
export const isRisen = (b: Body): boolean => b.kind === 'summon' && b.rose !== undefined;
/** Whether `b` is a timed summon (`kind === 'summon'` without `rose`). */
export const isTimedSummon = (b: Body): boolean => b.kind === 'summon' && b.rose === undefined;
/** The summons on `rows` whose owner is gone or down, or whose HP is 0: each leaves now (table 2.4). */
export function dismissed(rows: readonly Body[]): Body[] {
  const up = (id: CombatantId | undefined): boolean => rows.some(r => r.id === id && isUp(r));
  return rows.filter(r => isSummon(r) && summonStep('present', !isUp(r) ? { type: 'down' } : up(r.owner) ? { type: 'turn', late: false } : { type: 'ownerGone' }) === 'gone');
}
/** Whether a timed summon whose turn starts at `now` leaves before it acts: its time is up (risen rows have `until: null` and skip this). */
export const timeUp = (b: Body, now: Tick): boolean =>
  b.kind === 'summon' && b.until !== null && summonStep('present', { type: 'turn', late: now >= b.until }) === 'gone';
/**
 * The rows of `owner` in `lane` (`timed` or `risen`) that leave as another arrives in that lane: the oldest, while the
 * lane holds `cap` or more, so it holds at most `cap` with the new one.
 */
export function crowded(rows: readonly Body[], owner: CombatantId, lane: 'timed' | 'risen', cap: number): Body[] {
  const inLane = lane === 'risen' ? isRisen : isTimedSummon;
  const mine = rows.filter(r => inLane(r) && r.owner === owner);
  return mine.slice(0, Math.max(0, mine.length + 1 - cap)).filter(() => summonStep('present', { type: 'evicted' }) === 'gone');
}
