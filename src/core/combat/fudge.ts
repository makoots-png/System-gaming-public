// fudge.ts: the GM's hidden weight on a fight's dice (docs/agent-handoff/features/notes-8-fudge.md section 2). Its
// shape is `Fudge` (fight-types.ts), held by a fight in setup and running; `fudgeStep` is its one writer, called by the
// fight's `fudge` command and by a row that leaves (fight.ts). It has no states, so no machine: each event sets a value.
import type { CombatantId } from './ability-types.ts';
import type { Fudge, FudgeSet } from './fight-types.ts';

/** A new fight's weight: 0 for both sides, no row's own, no forced roll. */
export const NO_FUDGE: Fudge = { sides: { party: 0, foe: 0 }, rows: {}, forced: {} };

/** What changes a fight's weight: the GM's `fudge` command, or row `id` leaving the fight (its weight and force go with it). */
export type FudgeEvent = FudgeSet | { readonly kind: 'left'; readonly id: CombatantId };

const without = <V>(rec: Readonly<Record<CombatantId, V>>, id: CombatantId): Record<CombatantId, V> =>
  Object.fromEntries(Object.entries(rec).filter(([k]) => k !== id)) as Record<CombatantId, V>;

/**
 * The weight after `e`. A weight or a force is set, never added, and a row's weight of 0 or a force of null leaves no
 * entry. What is set already answers `f` itself, so a caller can tell nothing changed.
 */
export function fudgeStep(f: Fudge, e: FudgeEvent): Fudge {
  switch (e.kind) {
    case 'weight': {
      const s = e.scope;
      if (s.kind === 'side') return f.sides[s.side] === e.n ? f : { ...f, sides: { ...f.sides, [s.side]: e.n } };
      if ((f.rows[s.id] ?? 0) === e.n) return f;
      return { ...f, rows: e.n === 0 ? without(f.rows, s.id) : { ...f.rows, [s.id]: e.n } };
    }
    case 'force':
      if ((f.forced[e.id] ?? null) === e.face) return f;
      return { ...f, forced: e.face === null ? without(f.forced, e.id) : { ...f.forced, [e.id]: e.face } };
    case 'left':
      return e.id in f.rows || e.id in f.forced ? { ...f, rows: without(f.rows, e.id), forced: without(f.forced, e.id) } : f;
  }
}
