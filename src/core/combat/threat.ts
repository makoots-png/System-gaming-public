// threat.ts: whom a monster's threat table suggests it strike, and who taunts a body (design 4.2). Read by the card
// (fight-view.ts), a played monster's choice (policy.ts) and a mythic's omen aim (mythic.ts). It sits under all three,
// so fight-view.ts may read mythic.ts (unit MY7) without the two importing each other.
import type { CombatantId } from './ability-types.ts';
import type { Body } from './effect-ops.ts';
import type { Fight } from './fight-types.ts';
import { isUp } from './row-hp.ts';
import { counting } from './standing.ts';
import type { Tick } from './timeline.ts';

/** The body a live taunt on `row` names and when that taunt ends (null until removed); null when nothing taunts it. */
export function taunter(row: Pick<Body, 'statuses'>): { readonly by: CombatantId; readonly until: Tick | null } | null {
  const s = counting(row.statuses).find(x => x.source.id !== null && x.def.ops.some(o => o.op === 'taunt'));
  return s && s.source.id !== null ? { by: s.source.id, until: s.until } : null;
}

/**
 * A monster's threat table as its card shows it (design 4.2): each body still up with an entry, highest first, with its
 * share of the table in whole percent, and the target it suggests: its taunter while a taunt holds, else the highest
 * entry. Null for a body that keeps no table. The GM may target anyone.
 */
export type ThreatView = { readonly suggest: CombatantId | null; readonly shares: readonly { readonly id: CombatantId; readonly share: number }[] };
export function threatOf(f: Pick<Fight, 'rows'>, row: Body): ThreatView | null {
  if (!row.threat) return null;
  const up = new Set(f.rows.filter(isUp).map(r => r.id as string));
  const entries = (Object.entries(row.threat) as [CombatantId, number][]).filter(([id, t]) => up.has(id) && t > 0).sort((a, b) => b[1] - a[1]);
  const total = entries.reduce((n, [, t]) => n + t, 0);
  const taunt = taunter(row);
  const suggest = taunt && up.has(taunt.by) ? taunt.by : entries[0]?.[0] ?? null;
  return { suggest, shares: entries.map(([id, t]) => ({ id, share: Math.round(100 * t / total) })) };
}
