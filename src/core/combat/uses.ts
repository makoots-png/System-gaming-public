// uses.ts: an ability with uses a fight or a long rest (docs/agent-handoff/kits/design.md section 1.4, table 2.3), as a
// machine. Pure. A row counts each such ability's uses in `Body.used` (this fight's, and for one limited a rest the
// rest's before the fight, from the hunter's `Vitals.used`); `usesOf` reads where it stands against its gates, rule 3b
// refuses a spent one (`noUses`, charge.ts), the reducer counts a use that resolved (`counted`), and the GM sets one with
// the fight's `adjust`. A long rest clears the hunter's count (vitals.ts `rest`). A new event is a member of `UsesEvent`
// and its cells in `TABLE` (the typecheck asks), its line in tests/models/uses-events.ts and its words in
// scripts/charts/uses.ts.

import type { Ability, AbilityId, AbilityGate } from './ability-types.ts';
import type { Body, OpRules } from './effect-ops.ts';

export const USES_STATES = ['ready', 'spent'] as const;
export type UsesState = (typeof USES_STATES)[number];
/** Where an ability limited to `n` uses stands: `left` uses left (1 to n), or spent. */
export type Uses = { readonly at: 'ready'; readonly left: number } | { readonly at: 'spent' };
/** What changes it: a use that resolved; the fight's end; a long rest; the GM setting the uses spent. */
export type UsesEvent = { readonly type: 'used' } | { readonly type: 'fightEnds' } | { readonly type: 'longRest' } | { readonly type: 'gmSets'; readonly spent: number };
export type UsesEventType = UsesEvent['type'];
type UsesGate = Extract<AbilityGate, { kind: 'uses' }>;
type Step = (u: Uses, e: UsesEvent, g: UsesGate) => Uses;
const left = (n: number): Uses => (n >= 1 ? { at: 'ready', left: n } : { at: 'spent' });
/** The fight's end gives a per-fight ability its uses back (its row is gone); a per-rest one keeps its count on the sheet. */
const fightEnds: Step = (u, _e, g) => (g.per === 'fight' ? left(g.n) : u);
/** A long rest gives a per-rest ability its uses back. */
const longRest: Step = (u, _e, g) => (g.per === 'rest' ? left(g.n) : u);
const gmSets: Step = (_u, e, g) => left(g.n - (e.type === 'gmSets' ? e.spent : 0));
/** Table 2.3 of the kits design. `null`: the event does not apply there (a spent one used is refused), and nothing changes. */
const TABLE: { readonly [S in UsesState]: { readonly [E in UsesEventType]: Step | null } } = {
  ready: { used: u => left((u.at === 'ready' ? u.left : 0) - 1), fightEnds, longRest, gmSets },
  spent: { used: null, fightEnds, longRest, gmSets },
};
/** Where a limited ability stands after `event` under its `gate`. Never changes its input. */
export function usesStep(u: Uses, event: UsesEvent, gate: UsesGate): Uses {
  const step = TABLE[u.at][event.type];
  return step ? step(u, event, gate) : u;
}

/** The uses gates of an ability (kits design 1.4). */
export const usesGates = (a: Pick<Ability, 'gates'>): UsesGate[] => (a.gates ?? []).flatMap(g => (g.kind === 'uses' ? [g] : []));
/** The uses a row has spent of ability `id`: its count, 0 when none. */
export const spentOf = (b: Pick<Body, 'used'>, id: AbilityId): number => b.used?.[id] ?? 0;
/** Where `a` stands on row `b`: the tightest of its uses gates, or null when it has none. */
export function usesOf(a: Pick<Ability, 'id' | 'gates'>, b: Pick<Body, 'used'>): Uses | null {
  const gates = usesGates(a);
  if (!gates.length) return null;
  return left(Math.min(...gates.map(g => g.n)) - spentOf(b, a.id));
}
/** Row `b` after a use of `a` resolved (table 2.3, `used`): one more spent, when `a` is limited; else as it was. */
export function counted<B extends Body>(b: B, a: Pick<Ability, 'id' | 'gates'>, R: OpRules): B {
  if (!usesGates(a).length) return b;
  return { ...b, used: { ...b.used, [a.id]: Math.min(R.fight.kit.fightUses, spentOf(b, a.id) + 1) } };
}
/** The uses of the abilities limited a long rest that a hunter's sheet keeps (`Vitals.used`), from its row. */
export const restUsed = (b: Pick<Body, 'used' | 'abilities'>): Record<AbilityId, number> =>
  Object.fromEntries(b.abilities.filter(a => usesGates(a).some(g => g.per === 'rest') && spentOf(b, a.id) > 0).map(a => [a.id, spentOf(b, a.id)]));
