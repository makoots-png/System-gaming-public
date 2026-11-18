// summons.ts: a timed summon's life in a fight (docs/agent-handoff/kits/design.md section 1.9, table 2.4), as a machine.
// Pure. A summon is a row of kind `summon` (rows.ts `summonRow`) with an `owner` and an `until`; the reducer calls
// `summonStep` when a summon's turn starts, when another summon of its owner arrives, and after every change (its owner
// down or gone, its HP at 0). A summon never keeps a side up (fight-turn.ts `holdsSide`). A new event is a member of
// `SummonEvent` and its cells in `TABLE` (the typecheck asks), its line in tests/models/summon-events.ts and its words in
// scripts/charts/summon.ts.

import type { Tick } from './timeline.ts';
import type { Body, OpRules } from './effect-ops.ts';
import type { CombatantId } from './ability-types.ts';

export const SUMMON_STATES = ['present', 'gone'] as const;
export type SummonState = (typeof SUMMON_STATES)[number];
/**
 * What happens to a summon: its turn starts before its `until` or at or after it; its owner goes down or leaves; its HP
 * reaches 0; a third summon of its owner arrives and it is the oldest; the fight ends.
 */
export type SummonEvent =
  | { readonly type: 'turn'; readonly late: boolean } | { readonly type: 'ownerGone' } | { readonly type: 'down' } | { readonly type: 'third' } | { readonly type: 'fightEnds' };
export type SummonEventType = SummonEvent['type'];
type Step = (e: SummonEvent) => SummonState;
const leaves: Step = () => 'gone';
/** Table 2.4 of the kits design. `null`: the event does not apply there, and nothing changes. */
const TABLE: { readonly [S in SummonState]: { readonly [E in SummonEventType]: Step | null } } = {
  present: { turn: e => (e.type === 'turn' && e.late ? 'gone' : 'present'), ownerGone: leaves, down: leaves, third: leaves, fightEnds: leaves },
  gone: { turn: null, ownerGone: null, down: null, third: null, fightEnds: null },
};
/** A summon's state after `event`. */
export function summonStep(s: SummonState, event: SummonEvent): SummonState {
  const step = TABLE[s][event.type];
  return step ? step(event) : s;
}

/** Whether a row is a summon: a body the party or a foe called for a few rounds, with an owner. */
export const isSummon = (b: Pick<Body, 'kind'>): boolean => b.kind === 'summon';
/** The summons on `rows` whose owner is gone or down, or whose HP is 0: each leaves now (table 2.4). */
export function dismissed(rows: readonly Body[]): Body[] {
  const up = (id: CombatantId | undefined): boolean => rows.some(r => r.id === id && r.hp > 0);
  return rows.filter(r => isSummon(r) && summonStep('present', r.hp <= 0 ? { type: 'down' } : up(r.owner) ? { type: 'turn', late: false } : { type: 'ownerGone' }) === 'gone');
}
/** Whether a summon whose turn starts at `now` leaves before it acts: its time is up (table 2.4). */
export const timeUp = (b: Body, now: Tick): boolean => isSummon(b) && summonStep('present', { type: 'turn', late: b.until !== undefined && now >= b.until }) === 'gone';
/**
 * The summons of `owner` that leave as another arrives (table 2.4, "a third"): the oldest, while it holds `kit.summons`
 * or more, so it holds that many with the new one.
 */
export function crowded(rows: readonly Body[], owner: CombatantId, R: OpRules): Body[] {
  const mine = rows.filter(r => isSummon(r) && r.owner === owner);
  return mine.slice(0, Math.max(0, mine.length + 1 - R.fight.kit.summons)).filter(() => summonStep('present', { type: 'third' }) === 'gone');
}
