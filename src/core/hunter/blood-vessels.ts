// blood-vessels.ts: Crimson Vessels math, DC calculation, upgrade rules, parser, and plain-English words for the
// predatory-mythic blood extraction aspect (PR B). Pure: no DOM, no storage, no network.
import { timeOf } from '../day.ts';
import { oneOf } from '../one-of.ts';
import { isObj } from '../repair.ts';
import { RANKS, rankIdx } from '../rules.ts';
import type { Rank, Rules } from '../rules.ts';
import { isRefused, refuse } from '../save-step.ts';
import type { Refused } from '../save-step.ts';
import type { MonsterKind } from './derive.ts';
import type { ClassPerk } from '../registry/class-trees.ts';

/** Monster kinds that can fill a Crimson Vessel (mythic monsters follow `extractable === false` and yield no blood). */
export const VESSEL_KINDS = ['normal', 'elite', 'boss'] as const;
export type VesselKind = (typeof VESSEL_KINDS)[number];

/** Default maximum Crimson Vessels stored per blood-extracting class entry. */
export const VESSEL_CAP = 3;
/** Maximum length of a stored vessel's monster name. */
export const VESSEL_NAME_MAX = 60;

/** One extracted Crimson Vessel stored on `ClassEntry.vessels`. Power is always derived via `vesselPower`, never stored. */
export type BloodVessel = {
  readonly name: string;
  readonly rank: Rank;
  readonly kind: VesselKind;
  readonly at: string;
};

/** Upgrade plan for adding a monster's blood to a hunter's held vessels. */
export type VesselUpgradePlan = {
  readonly ok: true;
  readonly replaces: BloodVessel | null;
  readonly replaceIndex: number | null;
  readonly power: number;
};

/** Rank-driven power table for one Crimson Vessel: every rank strictly outranks the rank below it (1 at E normal to 40 at S boss). */
export const VESSEL_POWER_TABLE: Readonly<Record<Rank, Readonly<Record<VesselKind, number>>>> = {
  E: { normal: 1, elite: 2, boss: 3 },
  D: { normal: 4, elite: 5, boss: 6 },
  C: { normal: 7, elite: 9, boss: 11 },
  B: { normal: 12, elite: 15, boss: 18 },
  A: { normal: 19, elite: 23, boss: 27 },
  S: { normal: 28, elite: 34, boss: 40 },
};

/** Maximum power of a single Crimson Vessel (S-rank boss) and total across `VESSEL_CAP` vessels (120). */
export const VESSEL_POWER_MAX = VESSEL_POWER_TABLE.S.boss;
export const VESSEL_TOTAL_MAX = VESSEL_POWER_MAX * VESSEL_CAP;

/**
 * Derived power of one Crimson Vessel, driven primarily by corpse rank (E 1..3, D 4..6, C 7..11, B 12..18, A 19..27,
 * S 28..40). Sum across 3 vessels runs from 0 to 120.
 */
export function vesselPower(rank: Rank, kind: VesselKind): number {
  return VESSEL_POWER_TABLE[rank][kind];
}

/** Total derived power across up to `cap` held Crimson Vessels (0 to 120 at cap 3). */
export function vesselTotalPower(vessels: readonly BloodVessel[] | undefined, cap = VESSEL_CAP): number {
  if (!vessels?.length || cap <= 0) return 0;
  let sum = 0;
  for (const v of vessels.slice(0, cap)) sum += vesselPower(v.rank, v.kind);
  return sum;
}

/**
 * Passive stat/sheet bonus granted by held Crimson Vessels while the owning class is active and awakened.
 * Scales with rank-driven vessel power (0 to 120 across 3 vessels): +0 to +12 Power, +0 to +12 Flat magic penetration,
 * and +0 to +12 Ability haste (zero drain, Vitality, or flat HP).
 */
export function vesselBonus(vessels: readonly BloodVessel[] | undefined, cap = VESSEL_CAP): ClassPerk {
  const total = vesselTotalPower(vessels, cap);
  if (total <= 0) return {};
  const pow = Math.ceil(total / 10);
  const resistPenFlat = total < 2 ? 0 : Math.floor((total + 8) / 10);
  const haste = total < 3 ? 0 : Math.floor((total + 7) / 10);
  return {
    ...(pow > 0 ? { pow } : {}),
    ...(resistPenFlat > 0 ? { resistPenFlat } : {}),
    ...(haste > 0 ? { haste } : {}),
  };
}

/** Per-rank Blood Extraction DC surcharge added on top of `RULES.rankTable[rank].dc` so C/B/A/S never auto-pass. */
export const BLOOD_DC_RANK_ADD: Readonly<Record<Rank, number>> = { E: 0, D: 4, C: 8, B: 13, A: 18, S: 23 };
/** Extra Blood Extraction DC per rank the monster is above the hunter (or subtracted per rank below). */
export const BLOOD_DC_PER_RANK = 5;
/** Minimum Blood Extraction DC floor. */
export const BLOOD_DC_MIN = 10;

/**
 * DC for a blood extraction check against a fallen monster of `rank` and `kind` by a hunter of `hunterRank`
 * (defaults to `rank` for same-rank callers):
 * `max(BLOOD_DC_MIN, RULES.rankTable[rank].dc[0 | 1 | 2] + BLOOD_DC_RANK_ADD[rank] + BLOOD_DC_PER_RANK * (rankIdx(rank) - rankIdx(hunterRank)))`.
 */
export function bloodExtractDc(
  rank: Rank,
  kind: MonsterKind,
  R: Pick<Rules, 'rankTable'>,
  hunterRank: Rank = rank,
): number {
  const idx = kind === 'normal' ? 0 : kind === 'elite' ? 1 : 2;
  const base = R.rankTable[rank].dc[idx]!;
  return Math.max(BLOOD_DC_MIN, base + BLOOD_DC_RANK_ADD[rank] + BLOOD_DC_PER_RANK * (rankIdx(rank) - rankIdx(hunterRank)));
}

/** Index of the weakest vessel in `vessels` (lowest `vesselPower`, earliest index on ties), or -1 when empty. */
export function weakestVesselIndex(vessels: readonly BloodVessel[]): number {
  if (!vessels.length) return -1;
  let bestIdx = 0;
  let bestPow = vesselPower(vessels[0]!.rank, vessels[0]!.kind);
  for (let i = 1; i < vessels.length; i++) {
    const p = vesselPower(vessels[i]!.rank, vessels[i]!.kind);
    if (p < bestPow) {
      bestPow = p;
      bestIdx = i;
    }
  }
  return bestIdx;
}

/**
 * Plans adding blood from a monster of `(rank, kind)` into `vessels` (capped at `cap`).
 * Below `cap`, fills an open slot. At `cap`, succeeds only if the incoming `vesselPower` strictly exceeds
 * the weakest held vessel, replacing that vessel on success; otherwise refuses `'stronger-held'`.
 */
export function vesselUpgradePlan(
  vessels: readonly BloodVessel[] | undefined,
  rank: Rank,
  kind: VesselKind,
  cap = VESSEL_CAP,
): VesselUpgradePlan | Refused<'stronger-held'> {
  const list = vessels ?? [];
  const power = vesselPower(rank, kind);
  if (list.length < cap) {
    return { ok: true, replaces: null, replaceIndex: null, power };
  }
  const idx = weakestVesselIndex(list);
  const weak = idx >= 0 ? list[idx]! : null;
  if (!weak) return { ok: true, replaces: null, replaceIndex: null, power };
  if (power <= vesselPower(weak.rank, weak.kind)) return refuse('stronger-held');
  return { ok: true, replaces: weak, replaceIndex: idx, power };
}

/** Adds `incoming` to `vessels` according to `vesselUpgradePlan`, returning the next list and any replaced vessel. */
export function addVesselToList(
  vessels: readonly BloodVessel[] | undefined,
  incoming: BloodVessel,
  cap = VESSEL_CAP,
): { readonly vessels: readonly BloodVessel[]; readonly replaced: BloodVessel | null } | Refused<'stronger-held'> {
  const plan = vesselUpgradePlan(vessels, incoming.rank, incoming.kind, cap);
  if (isRefused(plan)) return plan;
  const list = vessels ?? [];
  if (plan.replaceIndex === null) {
    return { vessels: [...list, incoming], replaced: null };
  }
  return {
    vessels: list.map((v, i) => (i === plan.replaceIndex ? incoming : v)),
    replaced: plan.replaces,
  };
}

/**
 * Parses one stored or wire `BloodVessel`. When `fallbackAt` is omitted (wire parsing), a missing or invalid `at`
 * timestamp is refused; when provided (save repair), falls back to `fallbackAt`.
 */
export function parseBloodVessel(raw: unknown, fallbackAt?: string): BloodVessel | null {
  if (!isObj(raw)) return null;
  const rawName = Object.hasOwn(raw, 'name') ? raw.name : undefined;
  const name = typeof rawName === 'string' ? rawName.replace(/\s+/g, ' ').trim().slice(0, VESSEL_NAME_MAX) : '';
  if (!name) return null;
  const rank = oneOf(Object.hasOwn(raw, 'rank') ? raw.rank : undefined, RANKS, null);
  const kind = oneOf(Object.hasOwn(raw, 'kind') ? raw.kind : undefined, VESSEL_KINDS, null);
  const at = timeOf(Object.hasOwn(raw, 'at') ? raw.at : undefined) ?? fallbackAt ?? null;
  if (!rank || !kind || !at) return null;
  return { name, rank, kind, at };
}

/** Parses and repairs a `ClassEntry.vessels` array from stored JSON, returning undefined when empty or absent. */
export function parseBloodVessels(raw: unknown, fallbackAt: string, cap = VESSEL_CAP): readonly BloodVessel[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: BloodVessel[] = [];
  for (const item of raw) {
    if (out.length >= cap) break;
    const v = parseBloodVessel(item, fallbackAt);
    if (v) out.push(v);
  }
  return out.length > 0 ? out : undefined;
}

/** Plain-English refusal and UI copy for Blood Extraction (voice.md compliant). */
export const BLOOD_REFUSAL_WORDS = {
  running: 'Extract blood after the fight ends.',
  bled: 'Blood was already extracted from this corpse.',
  'stronger-held': `You already have stronger blood in all ${VESSEL_CAP} Crimson Vessels. Defeat a stronger monster to upgrade them.`,
} as const;
