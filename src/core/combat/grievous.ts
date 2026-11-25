// grievous.ts: variable Grievous Wounds healing-cut helpers and bounds. Pure leaf module with zero value imports so
// every combat, registry, protocol and view module can read it without value-import cycles.

import type { Op, StatusDef, Tiered } from './effect-ops.ts';

/** Reads a `Tiered<number>` at `tier` (0 to 5, clamped) without importing `op-amount.ts` (keeps this module a pure leaf). */
const tierNum = (v: Tiered<number>, tier: number): number => (typeof v === 'number' ? v : v[Math.max(0, Math.min(v.length - 1, tier))]!);

/** Default healing-received reduction (%) for Grievous Wounds when a source does not override it. */
export const DEFAULT_GRIEVOUS_PCT = 40;
/** Minimum healing-received reduction (%) allowed on a Grievous Wounds source. */
export const GRIEVOUS_MIN = 1;
/** Maximum healing-received reduction (%) accepted by parsers (combat and UI clamp to `kit.shareCap`). */
export const GRIEVOUS_MAX = 100;

/** Clamps a finite number to a whole healing-cut percentage in `[GRIEVOUS_MIN, GRIEVOUS_MAX]`, or null when non-finite. */
export function clampGrievousCut(pct: number): number | null {
  if (!Number.isFinite(pct)) return null;
  return Math.max(GRIEVOUS_MIN, Math.min(GRIEVOUS_MAX, Math.round(pct)));
}

/** Parses a whole healing-cut percentage in `[GRIEVOUS_MIN, GRIEVOUS_MAX]`, or null when invalid. */
export function parseGrievousCut(v: unknown): number | null {
  return typeof v === 'number' && Number.isInteger(v) && v >= GRIEVOUS_MIN && v <= GRIEVOUS_MAX ? v : null;
}

/** Maximum effective healing-cut percentage allowed under `R.fight.kit.shareCap` (floored, e.g. 50 at 0.5, 45 at 0.455). */
export function grievousCapPct(R: { readonly fight: { readonly kit: { readonly shareCap: number } } }): number {
  return Math.max(GRIEVOUS_MIN, Math.min(GRIEVOUS_MAX, Math.floor(R.fight.kit.shareCap * 100 + 1e-9)));
}

/**
 * Whether `def` carries a tiered (by-rank) negative `share` on `'healed'` op. Makers hide the flat Healing cut (%)
 * field on tiered healing-cut statuses so they are never flattened.
 */
export function hasTieredGrievousCut(def: StatusDef | null | undefined): boolean {
  if (!def) return false;
  return def.ops.some(o => o.op === 'share' && o.on === 'healed' && Array.isArray(o.pct) && o.pct.some(n => n < 0));
}

/**
 * Strongest healing-received cut (positive %, 1..100) carried by `def` at `tier`, read from its negative
 * `{ op: 'share', on: 'healed' }` ops. Returns null when `def` carries no healing reduction.
 */
export function grievousCutAt(def: StatusDef | null | undefined, tier = 0): number | null {
  if (!def) return null;
  let best = 0;
  for (const o of def.ops) {
    if (o.op === 'share' && o.on === 'healed') {
      const pct = tierNum(o.pct, tier);
      if (pct < 0) best = Math.max(best, -pct);
    }
  }
  return best > 0 ? best : null;
}

/** Strongest healing-received cut (positive %) carried by `def` at tier 0, or null when `def` has none. */
export const grievousCutOf = (def: StatusDef | null | undefined): number | null => grievousCutAt(def, 0);

/**
 * Returns a copy of `def` with every flat negative `share` on `'healed'` op set to `-pct` (clamped to `1..100`).
 * Returns `def` unchanged when `pct` is non-finite. Preserves tiered `pct` arrays untouched and never modifies `def.desc`.
 */
export function withGrievousCut(def: StatusDef, pct: number): StatusDef {
  const cut = clampGrievousCut(pct);
  if (cut === null) return def;
  const ops: Op[] = def.ops.map(o =>
    o.op === 'share' && o.on === 'healed' && typeof o.pct === 'number' && o.pct < 0 ? { ...o, pct: -cut } : o,
  );
  return { ...def, ops };
}
