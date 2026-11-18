// conditions.ts: the statuses a hunter holds on its sheet outside a fight (`conditions`). Pure. In a fight the fight's
// row holds them (hunter.js `vitalsEdit` asks where they live); on the sheet they change only through these two.
// One instance per key: a status put on again keeps the stronger source and the longer time (effect-ops.ts
// `addSheetStatus`). A chip drawn from the hunter's state (src/core/hunter/chips.ts) is never put on.
import { addSheetStatus } from '../combat/effect-ops.ts';
import type { SheetStatus, Source, StatusDef } from '../combat/effect-ops.ts';
import { gmSource } from '../effects.ts';
import type { Rank } from '../rules.ts';
import { refuse } from '../save-step.ts';
import type { Refused } from '../save-step.ts';
import { isStateChip } from './chips.ts';

type Holding = { conditions: SheetStatus[]; rank: Rank };
/** A status to put on: its key, and its def, source and rounds when it carries them. */
export type StatusIn = { key: string; def?: StatusDef; source?: Source; rounds?: number | null };

/**
 * The status put on. Its def is the one it carries, else the one the hunter holds under that key, else `defs` (the
 * rules'); its source the one it carries, else the GM's at the hunter's rank. Refused for a chip drawn from the state
 * (`state-chip`), a key with no def (`no-def`) and a change that changes nothing (`unchanged`).
 */
export function putStatus<H extends Holding>(h: H, s: StatusIn, defs: Readonly<Record<string, StatusDef>>): H | Refused<'state-chip' | 'no-def' | 'unchanged'> {
  if (isStateChip(s.key)) return refuse('state-chip');
  const def = s.def ?? h.conditions.find(c => c.key === s.key)?.def ?? defs[s.key];
  if (!def) return refuse('no-def');
  const next = addSheetStatus(h.conditions, { key: s.key, def, source: s.source ?? gmSource(h.rank), rounds: s.rounds ?? null } as SheetStatus);
  return JSON.stringify(next) === JSON.stringify(h.conditions) ? refuse('unchanged') : { ...h, conditions: next };
}
/** The status of that key taken off. One the hunter does not hold is refused (`unchanged`). */
export function dropStatus<H extends Holding>(h: H, key: string): H | Refused<'unchanged'> {
  return h.conditions.some(c => c.key === key) ? { ...h, conditions: h.conditions.filter(c => c.key !== key) } : refuse('unchanged');
}
