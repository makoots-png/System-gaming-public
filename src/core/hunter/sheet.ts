// sheet.ts: what a hunter's sheet is built from, a check's bonus and Auto's placement of free points
// (docs/agent-handoff/rw/m2-plan.md section 4.2, unit P2; design.md sections 2.2 and 2.3). Pure. `buildOf` is the one
// place that sums a hunter's bonuses: the active title, the worn gear, the open path perks, the passive skills and the
// GM's `hpAdj` and `manaAdj`. A new source of bonuses is a field of `SheetHunter` and a line in `buildOf`, with a case
// in tests/sheet.test.ts. The numbers themselves are derive.ts's.

import { rankIdx } from '../rules.ts';
import type { Rank, Rules } from '../rules.ts';
import { STAT_KEYS, above, baseStats } from '../stats.ts';
import type { StatKey, Stats } from '../stats.ts';
import { SHEET_LABELS } from './derive.ts';
import type { Bonus, SheetBasis, DeriveRules, GearPiece, Sheet, SheetNumber } from './derive.ts';
import { modified, statusOn } from '../combat/effect-ops.ts';
import type { Source, Status, StatusDef, StatusKey } from '../combat/effect-ops.ts';
import { tick } from '../combat/timeline.ts';
import { checkPenalty } from './penalty.ts';
import { weightOf } from '../registry/items.ts';
import type { Penalty } from './penalty.ts';
import { allocated, available } from './progress.ts';
import { fatiguePast, vitalStep } from './vitals.ts';
import type { Vitals } from './vitals.ts';
import type { Progress } from './progress.ts';

/** A build path as this file reads it: where Auto places free points, and one list of perks per tier (E to S). */
export type SheetPath = {
  readonly alloc: Partial<Readonly<Record<StatKey, number>>>;
  readonly tiers: readonly (readonly Bonus[])[];
};

/** The rules this file reads. */
export type SheetRules = DeriveRules & Pick<Rules, 'rankBonus' | 'fatigue' | 'rest' | 'penaltyCheck'> & {
  readonly build: { readonly enabled: boolean };
  readonly paths: Readonly<Record<string, SheetPath>>;
};

/** An item as the sheet reads it. Only a worn one counts; a field it lacks adds nothing. */
export type SheetItem = {
  readonly id: string;
  readonly weight?: number;
  /** A weapon's weight is its dice's when it has none of its own (`weightOf`). */
  readonly type?: string;
  readonly dice?: string;
  readonly armor?: number;
  readonly resist?: number;
  readonly penFlat?: number;
  readonly bonus?: Bonus;
};
/** A skill as the sheet reads it: only a passive one carries a bonus. */
export type SheetSkill = { readonly type: 'active' } | { readonly type: 'passive'; readonly bonus: Bonus };
/** A status on a hunter outside a fight. It has no fight time; what it does to the sheet is its def at its source's tier. */
export type SheetCondition = { readonly key: StatusKey; readonly def: StatusDef; readonly source: Source; readonly stacks?: number };

/** The fields of a schema 4 hunter this file reads. `stats` holds the points spent, 10 each on a new hunter. */
export type SheetHunter = {
  /** The confirmed stats; `pending` the points on them not yet confirmed (progress.ts). The sheet is built from both. */
  readonly stats: Stats;
  readonly pending?: Partial<Stats>;
  readonly level: number;
  readonly rank: Rank;
  readonly fatigue: number;
  readonly penalty: Penalty | null;
  readonly hpAdj: number;
  readonly manaAdj: number;
  readonly titleId: string | null;
  readonly titles: readonly { readonly id: string; readonly bonus: Bonus }[];
  readonly items: readonly SheetItem[];
  readonly equipped: Readonly<Record<string, string | null>>;
  readonly build: { readonly path: string | null; readonly picks: readonly number[] };
  readonly skills: readonly SheetSkill[];
  readonly conditions: readonly SheetCondition[];
};

const BONUS_KEYS: readonly (StatKey | SheetNumber)[] = [...STAT_KEYS, ...(Object.keys(SHEET_LABELS) as SheetNumber[])];

function sum(bonuses: readonly Bonus[]): Bonus {
  const out: Partial<Record<StatKey | SheetNumber, number>> = {};
  for (const b of bonuses) for (const k of BONUS_KEYS) { const v = b[k]; if (v) out[k] = (out[k] ?? 0) + v; }
  return out;
}

const worn = (h: SheetHunter): SheetItem[] =>
  Object.values(h.equipped).flatMap(id => h.items.find(i => i.id === id) ?? []);

const gearOf = (i: SheetItem): GearPiece =>
  ({ weight: weightOf(i), armor: i.armor ?? 0, resist: i.resist ?? 0, ...(i.penFlat === undefined ? {} : { penFlat: i.penFlat }) });

/** The hunter's path, or null when builds are off or the rules no longer have it. */
function pathOf(h: SheetHunter, R: SheetRules): SheetPath | null {
  const id = h.build.path;
  return R.build.enabled && id !== null && Object.hasOwn(R.paths, id) ? R.paths[id] ?? null : null;
}

/** The perks of the picks the hunter's rank has opened: tier i opens at rank i (E 0 to S 5). Later picks are kept, not counted. */
function pathPerks(h: SheetHunter, R: SheetRules): Bonus[] {
  const path = pathOf(h, R);
  if (!path) return [];
  const open = Math.min(h.build.picks.length, path.tiers.length, rankIdx(h.rank) + 1);
  return h.build.picks.slice(0, open).map((pick, tier) => path.tiers[tier]?.[pick] ?? {});
}

/** What `derive` builds the hunter's sheet from: its spent stats, its level, its worn gear and every bonus it holds. */
export function buildOf(h: SheetHunter, R: SheetRules): SheetBasis {
  const gear = worn(h);
  return {
    stats: allocated(h),
    level: h.level,
    gear: gear.map(gearOf),
    perks: sum([
      h.titles.find(t => t.id === h.titleId)?.bonus ?? {},
      ...gear.map(i => i.bonus ?? {}),
      ...pathPerks(h, R),
      ...h.skills.map(s => s.type === 'passive' ? s.bonus : {}),
      { hpMax: h.hpAdj, manaMax: h.manaAdj },
    ]),
  };
}

// A condition has no fight time; `modified` reads only its def and its source.
const asStatus = (c: SheetCondition): Status => statusOn(c.def, { key: c.key, source: c.source, until: null, since: tick(0), settledAt: tick(0) }, c.stacks);

/** The hunter's stats (spent, plus perks, plus what its conditions do) and its sheet under its conditions. */
export const hunterSheet = (h: SheetHunter, R: SheetRules): { stats: Stats; sheet: Sheet } =>
  modified({ kind: 'hunter', build: buildOf(h, R) }, h.conditions.map(asStatus), R);

/** Where a part of a sheet number comes from, in the order `explain` adds them. */
export const SOURCES = ['base', 'level', 'stats', 'gear', 'title', 'path', 'skills', 'gm', 'statuses'] as const;
export type SheetSource = (typeof SOURCES)[number];
export const SOURCE_LABELS: { readonly [K in SheetSource]: string } = {
  base: 'Base', level: 'Level', stats: 'Stats', gear: 'Gear', title: 'Title', path: 'Path', skills: 'Passive skills', gm: 'GM\'s change', statuses: 'Statuses',
};
/** One part of a sheet number: where it comes from and how much it adds. */
export type Part = { readonly from: SheetSource; readonly amount: number };

/**
 * A sheet number as the sum of where it comes from (the "more info" of a number on the sheet). The sheet is worked out
 * again with each source added in `SOURCES`'s order, starting from a level 1 body at the base stats with nothing worn, and
 * a part is what that source changed. The curves, the load and the clamps are not linear, so a part is what its source
 * adds after the ones before it: the parts always sum to the number, and a source that changes nothing is a part of 0.
 */
export function explain(h: SheetHunter, key: SheetNumber, R: SheetRules): { total: number; parts: Part[] } {
  const full = buildOf(h, R), gear = worn(h);
  const add = (b: SheetBasis, perks: Bonus): SheetBasis => ({ ...b, perks: sum([b.perks, perks]) });
  const base: SheetBasis = { stats: baseStats(R.fight), level: 1, gear: [], perks: {} };
  const level: SheetBasis = { ...base, level: h.level };
  const stats: SheetBasis = { ...level, stats: allocated(h) };
  const geared: SheetBasis = add({ ...stats, gear: gear.map(gearOf) }, sum(gear.map(i => i.bonus ?? {})));
  const title = add(geared, h.titles.find(t => t.id === h.titleId)?.bonus ?? {});
  const path = add(title, sum(pathPerks(h, R)));
  const skills = add(path, sum(h.skills.map(s => s.type === 'passive' ? s.bonus : {})));
  const steps: readonly (readonly [SheetSource, SheetBasis, readonly Status[]])[] = [
    ['base', base, []], ['level', level, []], ['stats', stats, []], ['gear', geared, []], ['title', title, []], ['path', path, []],
    ['skills', skills, []], ['gm', full, []], ['statuses', full, h.conditions.map(asStatus)],
  ];
  const values = steps.map(([, b, s]) => modified({ kind: 'hunter', build: b }, s, R).sheet[key]);
  return { total: values[values.length - 1]!, parts: steps.map(([from], i) => ({ from, amount: i === 0 ? values[0]! : values[i]! - values[i - 1]! })) };
}

/** A hunter's d20 checks: the bonus on each stat and what every check reads besides the stat. */
export type Checks = {
  readonly bonus: Readonly<Record<StatKey, number>>;
  /** Taken off every check from `penaltyAt` percent of the fatigue capacity on. */
  readonly tired: number;
  /** A missed daily's penalty, taken off every check. */
  readonly penalty: number;
  /** Every check rolls with disadvantage from `disAt` percent of the fatigue capacity on. */
  readonly dis: boolean;
};

/** The stat's part of a check bonus: half of the points above the base, rounded down. */
export const statBonus = (score: number, F: Parameters<typeof above>[1]): number => Math.floor(above(score, F) / 2);

/**
 * The hunter's checks, from its stats and sheet as `hunterSheet` answers them. A check of a stat is `floor(x(stat) / 2)`
 * plus the rank's bonus, less `tired` and `penalty`. Near the base `x(s)` is close to `s - 10`, so the old DC table keeps
 * its meaning (m2-plan section 2, the row of `mod`).
 */
export function checksOf(h: SheetHunter, at: { stats: Stats; sheet: Sheet }, R: SheetRules): Checks {
  const tired = fatiguePast(h.fatigue, at.sheet, R.fatigue.penaltyAt) ? R.fatigue.penalty : 0;
  const penalty = checkPenalty(h.penalty, R);
  const bonus = Object.fromEntries(STAT_KEYS.map(k => [k, statBonus(at.stats[k], R.fight) + R.rankBonus[h.rank] - tired - penalty]));
  return { bonus: bonus as Record<StatKey, number>, tired, penalty, dis: fatiguePast(h.fatigue, at.sheet, R.fatigue.disAt) };
}

/**
 * The hunter after a change to what its sheet is built from (a stat, a level, worn gear, a title, a perk, a passive):
 * HP, mana and fatigue brought down to the maxima its sheet now gives (vitals.ts `vitalStep`'s `maxChanged`).
 */
export const fitted = <H extends SheetHunter & Vitals>(h: H, R: SheetRules): H => ({ ...h, ...vitalStep(h, { type: 'maxChanged' }, hunterSheet(h, R).sheet, R) });

/** The least a maximum can be: the sheet never gives less (derive.ts), so a lower target is that floor. */
const MAX_FLOOR = { hpMax: 1, manaMax: 0 } as const;
/**
 * The GM's edit of max HP or max mana to `n` (at least its floor, `MAX_FLOOR`): its adjustment (`hpAdj`, `manaAdj`)
 * moves by the difference, then `fitted`. The same edit twice moves nothing the second time.
 */
export function setMaximum<H extends SheetHunter & Vitals>(h: H, key: 'hpMax' | 'manaMax', n: number, R: SheetRules): H {
  const adj = key === 'hpMax' ? 'hpAdj' : 'manaAdj', by = Math.max(MAX_FLOOR[key], Math.trunc(n) || 0) - hunterSheet(h, R).sheet[key];
  return fitted({ ...h, [adj]: h[adj] + by }, R);
}
/** The GM's edit of an adjustment of max HP or max mana itself, then `fitted`. */
export const setAdjust = <H extends SheetHunter & Vitals>(h: H, key: 'hpAdj' | 'manaAdj', v: number, R: SheetRules): H => fitted({ ...h, [key]: Math.trunc(v) || 0 }, R);

/** The bonus on a d20 check of `stat` (`checksOf`). */
export const checkBonus = (h: SheetHunter, stat: StatKey, R: SheetRules): number => checksOf(h, hunterSheet(h, R), R).bonus[stat];

/**
 * Where Auto places the points free, one at a time, each to the path's stat with the fewest placed for its weight; a tie
 * goes to the stat first in `STAT_KEYS`. A stat with no weight gets none. Answers the points per stat, to show and then
 * spend; empty when nothing is free or the path weighs no stat.
 */
export function autoSpend(h: Progress, path: SheetPath, R: Rules): Partial<Record<StatKey, number>> {
  const keys = STAT_KEYS.filter(k => (path.alloc[k] ?? 0) > 0);
  const out: Partial<Record<StatKey, number>> = {};
  if (!keys.length) return out;
  const share = (k: StatKey): number => (out[k] ?? 0) / path.alloc[k]!;
  for (let i = available(h, R); i > 0; i--) {
    const k = keys.reduce((a, b) => share(b) < share(a) ? b : a);
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}
