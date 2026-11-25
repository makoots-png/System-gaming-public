// grievous.ts: variable Grievous Wounds healing-cut helpers and bounds. Pure leaf module with zero value imports so
// every combat, registry, protocol and view module can read it without value-import cycles.

import type { Op, StatusDef, Tiered } from './effect-ops.ts';

/** Reads a `Tiered<number>` at `tier` (0 to 5, clamped) without importing `op-amount.ts` (keeps this module a pure leaf). */
const tierNum = (v: Tiered<number>, tier: number): number => (typeof v === 'number' ? v : v[Math.max(0, Math.min(v.length - 1, tier))]!);

/** Built-in status key for Grievous Wounds, which uses `GRIEVOUS_MAX` instead of `fight.kit.shareCap`. */
export const GRIEVOUS_KEY = 'grievous';
/** Default healing-received reduction (%) for Grievous Wounds when a source does not override it. */
export const DEFAULT_GRIEVOUS_PCT = 40;
/** Minimum healing-received reduction (%) allowed on a Grievous Wounds source. */
export const GRIEVOUS_MIN = 1;
/** Maximum healing-received reduction (%) allowed for Grievous Wounds, regardless of `fight.kit.shareCap`. */
export const GRIEVOUS_MAX = 90;
/** Legacy pre-90% ceiling accepted on persisted wire `h` and non-Grievous cuts (`wave2Op` allows −100..100). */
export const GRIEVOUS_LEGACY_MAX = 100;

/** Whether `key` is the built-in Grievous Wounds status key. */
export const isGrievousKey = (key: string | null | undefined): boolean => key === GRIEVOUS_KEY;

/** Clamps a finite number to a whole healing-cut percentage in `[GRIEVOUS_MIN, max]` (default `GRIEVOUS_MAX`), or null when non-finite. */
export function clampGrievousCut(pct: number, max = GRIEVOUS_MAX): number | null {
  if (!Number.isFinite(pct)) return null;
  return Math.max(GRIEVOUS_MIN, Math.min(max, Math.round(pct)));
}

/** Parses a whole healing-cut percentage in `[GRIEVOUS_MIN, GRIEVOUS_MAX]`, or null when invalid. */
export function parseGrievousCut(v: unknown): number | null {
  return typeof v === 'number' && Number.isInteger(v) && v >= GRIEVOUS_MIN && v <= GRIEVOUS_MAX ? v : null;
}

/**
 * Reads a persisted healing-cut override (`h` on fight wires) in `[GRIEVOUS_MIN, GRIEVOUS_LEGACY_MAX]`, clamping values
 * above `max` (default `GRIEVOUS_MAX` for Grievous Wounds; pass `GRIEVOUS_LEGACY_MAX` for non-Grievous keys), or null when invalid.
 */
export function readLegacyGrievousCut(v: unknown, max = GRIEVOUS_MAX): number | null {
  return typeof v === 'number' && Number.isInteger(v) && v >= GRIEVOUS_MIN && v <= GRIEVOUS_LEGACY_MAX
    ? Math.min(max, v)
    : null;
}

/** Maximum effective healing-cut percentage allowed for Grievous Wounds (`GRIEVOUS_MAX`, independent of `shareCap`). */
export function grievousCapPct(): number {
  return GRIEVOUS_MAX;
}

/**
 * Maximum effective healing-cut percentage for non-Grievous statuses under `R.fight.kit.shareCap` (floored, e.g. 50 at
 * 0.5, 45 at 0.455; `shareCap` itself tops out at 0.9 in `rules.ts`, bounded here to 1..100 independent of `GRIEVOUS_MAX`).
 */
export function shareCapPct(R: { readonly fight: { readonly kit: { readonly shareCap: number } } }): number {
  return Math.max(1, Math.min(100, Math.floor(R.fight.kit.shareCap * 100 + 1e-9)));
}

/**
 * Clamps every negative `share` on `'healed'` op (flat or tiered) in `ops` to `-GRIEVOUS_MAX`, returning `ops`
 * unchanged when all cuts are already within bounds. Used on save read so legacy 91..100 cuts load as 90.
 */
export function clampGrievousOps(ops: readonly Op[]): Op[] {
  let changed = false;
  const out: Op[] = ops.map(o => {
    if (o.op !== 'share' || o.on !== 'healed') return o;
    if (typeof o.pct === 'number') {
      if (o.pct < -GRIEVOUS_MAX) { changed = true; return { ...o, pct: -GRIEVOUS_MAX }; }
      return o;
    }
    if (o.pct.some(n => n < -GRIEVOUS_MAX)) {
      changed = true;
      return { ...o, pct: o.pct.map(n => Math.max(-GRIEVOUS_MAX, n)) as unknown as Tiered<number> };
    }
    return o;
  });
  return changed ? out : ops as Op[];
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
 * Strongest healing-received cut (positive %, 1..90 on parsed Grievous defs) carried by `def` at `tier`, read from its
 * negative `{ op: 'share', on: 'healed' }` ops. Returns null when `def` carries no healing reduction.
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
 * Returns a copy of `def` with every flat negative `share` on `'healed'` op set to `-pct` (clamped to `[1, max]`,
 * default `GRIEVOUS_MAX = 90`). Returns `def` unchanged when `pct` is non-finite. Preserves tiered `pct` arrays
 * untouched and never modifies `def.desc`.
 */
export function withGrievousCut(def: StatusDef, pct: number, max = GRIEVOUS_MAX): StatusDef {
  const cut = clampGrievousCut(pct, max);
  if (cut === null) return def;
  const ops: Op[] = def.ops.map(o =>
    o.op === 'share' && o.on === 'healed' && typeof o.pct === 'number' && o.pct < 0 ? { ...o, pct: -cut } : o,
  );
  return { ...def, ops };
}
