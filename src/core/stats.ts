// stats.ts: the eight stats of the reworked fight and the two curves every derived number goes through
// (docs/agent-handoff/rw/design.md section 2.1). Pure; the curve's numbers come in as `CurveRules` (`RULES.fight`).
// rules.ts imports STAT_KEYS from here; no other file lists the stats.

export const STAT_KEYS = ['str', 'agi', 'vit', 'ins', 'dis', 'pre', 'pow', 'ctl'] as const;
export type StatKey = (typeof STAT_KEYS)[number];
/** A score for each of the eight stats. */
export type Stats = Readonly<Record<StatKey, number>>;

export const STAT_LABELS: Readonly<Record<StatKey, string>> = {
  str: 'Strength', agi: 'Agility', vit: 'Vitality', ins: 'Instinct', dis: 'Discipline', pre: 'Presence', pow: 'Power', ctl: 'Control',
};
/** The three-letter label a sheet, a chip or a perk shows. */
export const STAT_SHORT: Readonly<Record<StatKey, string>> = {
  str: 'STR', agi: 'AGI', vit: 'VIT', ins: 'INS', dis: 'DIS', pre: 'PRE', pow: 'POW', ctl: 'CTL',
};

/** The rule numbers the curves read. */
export type CurveRules = {
  /** What every stat starts at. */
  readonly statBase: number;
  readonly effExp: number;
  /** The effective points at which a capped curve reaches half its cap. */
  readonly half: number;
};

/** The stats whose score for each key `score` gives: the one maker of a whole set of stats. */
export const statsBy = (score: (k: StatKey) => number): Stats => Object.fromEntries(STAT_KEYS.map(k => [k, score(k)])) as Record<StatKey, number>;
/** Every stat at its base. */
export const baseStats = (R: CurveRules): Stats => statsBy(() => R.statBase);

/**
 * The effective score, `base * (s / base) ^ effExp`: doubling a stat gives 1.74 times, not 2. A score under 1 counts as 1,
 * so a stat a status lowers past 0 still has a curve.
 */
export const eff = (s: number, R: CurveRules): number => R.statBase * Math.pow(Math.max(1, s) / R.statBase, R.effExp);

/** The effective points above the base, the design's `x(s)`; negative for a stat lowered below the base. */
export const above = (s: number, R: CurveRules): number => eff(s, R) - R.statBase;

/**
 * A number that must stay under `cap`: half of it at `half` effective points and never all of it. Below 0 it falls at the
 * slope it starts with, so a lowered stat hurts at least as much as a raised one helps.
 */
export const capped = (x: number, cap: number, R: CurveRules): number => x >= 0 ? cap * x / (x + R.half) : cap * x / R.half;
