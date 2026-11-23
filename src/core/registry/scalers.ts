// scalers.ts: the conditional scalers that replace the execute (docs/agent-handoff/kits/design.md section 8.0). The owner,
// Nov 14: "execute just does more dmg the lower health people are... There should be a counterpart for when people are
// higher hp. Also one for higher max hp than the player, lower max hp than the player". Nothing kills outright: a scaler
// is formula text a tick writes (ability-kinds.ts `recommended`) and reads back (`scalersOf`), so every damage flows
// through the one formula parser and the GM sees and edits it. This file holds the family, its text, its mean over the
// reference dungeon (`RULES.fight.kit.reference`), the suggestion the maker fills and the sentence the preview shows.
// The numbers are rules (`RULES.fight.kit`); a new member of the family is a row of `FAMILY` (the typecheck asks).

import type { Rank, Rules } from '../rules.ts';
import { parseFormula, printFormula } from '../formula.ts';
import type { Formula } from '../formula.ts';
import type { AbilityKind } from '../combat/ability-types.ts';

/** The rule numbers this file reads. */
export type ScalerRules = Pick<Rules, 'fight' | 'dice'>;

/**
 * What a scaler compares: the target's HP share, the user's own, the target's part of the two max HPs
 * (`T / (T + U)`, 0.5 for equal bodies), or the target's part of the two current HPs.
 */
export type Measure = 'target' | 'user' | 'maxPair' | 'hpPair';
export type Dir = 'under' | 'over';
/** One scaler (design 8.0): its bonus is 0 at `start` and `scale` at its measure's end, linear between. */
export type Scaler = { readonly measure: Measure; readonly dir: Dir; readonly start: number; readonly scale: number };
export type ScalerName = 'execute' | 'opener' | 'desperate' | 'steady' | 'giantSlayer' | 'cull' | 'underdog' | 'bully';

/** The closed family of eight, each a measure and a direction, with its name and what its sentence says it is against. */
export const FAMILY: { readonly [N in ScalerName]: { readonly measure: Measure; readonly dir: Dir; readonly label: string; readonly words: (start: number, R: ScalerRules) => string } } = {
  execute: { measure: 'target', dir: 'under', label: 'Bonus vs low-HP target', words: s => `against a target under ${share(s)} of its HP` },
  opener: { measure: 'target', dir: 'over', label: 'Bonus vs high-HP target', words: s => `against a target over ${share(s)} of its HP` },
  desperate: { measure: 'user', dir: 'under', label: 'Bonus while you are low HP', words: s => `while you are under ${share(s)} of your HP` },
  steady: { measure: 'user', dir: 'over', label: 'Bonus while you are high HP', words: s => `while you are over ${share(s)} of your HP` },
  giantSlayer: { measure: 'maxPair', dir: 'over', label: 'Bonus vs higher max HP', words: (s, R) => `against a target with more max HP than ${pair(s, 'over', R)}` },
  cull: { measure: 'maxPair', dir: 'under', label: 'Bonus vs lower max HP', words: (s, R) => `against a target with less max HP than ${pair(s, 'under', R)}` },
  underdog: { measure: 'hpPair', dir: 'over', label: 'Bonus vs higher current HP', words: (s, R) => `against a target with more HP left than ${pair(s, 'over', R)}` },
  bully: { measure: 'hpPair', dir: 'under', label: 'Bonus vs lower current HP', words: (s, R) => `against a target with less HP left than ${pair(s, 'under', R)}` },
};
export const SCALER_NAMES = Object.keys(FAMILY) as readonly ScalerName[];
export const nameOf = (s: Pick<Scaler, 'measure' | 'dir'>): ScalerName => SCALER_NAMES.find(n => FAMILY[n].measure === s.measure && FAMILY[n].dir === s.dir)!;

const r4 = (x: number): number => Math.round(x * 1e4) / 1e4;
const clamp01 = (x: number): number => Math.max(0, Math.min(1, x));
const share = (s: number): string => (s === 0.5 ? 'half' : `${Math.round(s * 100)}%`);
/** A pair's start in words: "yours" at 1 to 1, else the ratio; and where it is whole. */
function pair(start: number, dir: Dir, R: ScalerRules): string {
  const ratio = (x: number): number => Math.round(x / (1 - x) * 100) / 100, full = R.fight.kit.pairFull;
  const from = start === 0.5 ? 'yours' : `${ratio(start)} times yours`;
  return `${from}, reaching max at ${dir === 'over' ? `${full} times yours` : `1/${full} of yours`}`;
}

/** Where a measure's bonus is whole: a share at 0 (under) or 1 (over), a pair at 1 to `pairFull` or `pairFull` to 1. */
export function endOf(measure: Measure, dir: Dir, R: ScalerRules): number {
  const full = R.fight.kit.pairFull;
  if (measure === 'target' || measure === 'user') return dir === 'under' ? 0 : 1;
  return dir === 'under' ? 1 / (1 + full) : full / (1 + full);
}
/** A scaler as the GM may hold it: its start strictly between its ends, its scale 0 to `scaleCap`, each to four places. */
export function bounded(s: Scaler, R: ScalerRules): Scaler {
  const a = endOf(s.measure, 'under', R), b = endOf(s.measure, 'over', R), step = R.fight.kit.scalerStep / 10;
  return { measure: s.measure, dir: s.dir, start: r4(Math.max(a + step, Math.min(b - step, s.start))), scale: r4(Math.max(0, Math.min(R.fight.kit.scaleCap, s.scale))) };
}

/** The measure's text: the user's or target's lost share, or the target's part of the two max or current HPs. */
function measureText(m: Measure): string {
  switch (m) {
    case 'target': return 'target.missing';
    case 'user': return 'missing';
    case 'maxPair': return 'target.hpMax / (target.hpMax + hpMax)';
    case 'hpPair': return 'target.hpMax * (1 - target.missing) / (target.hpMax * (1 - target.missing) + hpMax * (1 - missing))';
  }
}
/**
 * The ramp from 0 at the start to 1 at the end, as formula text: a share through its lost share (`missing`), so an
 * execute from half HP is `(target.missing - 0.5) / 0.5`; a pair through its part.
 */
function rampText(s: Scaler, R: ScalerRules): string {
  const m = measureText(s.measure), end = endOf(s.measure, s.dir, R);
  if (s.measure === 'target' || s.measure === 'user') {
    return s.dir === 'under' ? `(${m} - ${r4(1 - s.start)}) / ${r4(s.start)}` : `(${r4(1 - s.start)} - ${m}) / ${r4(1 - s.start)}`;
  }
  return s.dir === 'over' ? `(${m} - ${r4(s.start)}) / ${r4(end - s.start)}` : `(${r4(s.start)} - ${m}) / ${r4(s.start - end)}`;
}
/** A scaler's bonus as formula text: `scale * max(0, min(1, ramp))` (design 8.0 point 4). */
export const scalerText = (s: Scaler, R: ScalerRules): string => `${r4(s.scale)} * max(0, min(1, ${rampText(s, R)}))`;

const printed = (text: string, R: ScalerRules): string => { const p = parseFormula(text, R); return p.ok ? printFormula(p.formula) : text; };
/**
 * The scalers a formula carries, read back from its tree: `core * base * (1 + term + term)`, each term a scale times a
 * clamped ramp that one member of the family, at one start, writes as printed text. Empty when it carries none.
 */
export function scalersOf(f: Formula, R: ScalerRules): { readonly core: Formula; readonly base: number; readonly scalers: readonly Scaler[] } | null {
  if (f.kind !== 'binary' || f.op !== '*' || f.left.kind !== 'binary' || f.left.op !== '*' || f.left.right.kind !== 'number') return null;
  const terms: Formula[] = [];
  let sum: Formula = f.right;
  while (sum.kind === 'binary' && sum.op === '+') { terms.unshift(sum.right); sum = sum.left; }
  if (sum.kind !== 'number' || sum.value !== 1 || !terms.length || terms.length > R.fight.kit.scalers) return null;
  const out: Scaler[] = [];
  for (const t of terms) {
    if (t.kind !== 'binary' || t.op !== '*' || t.left.kind !== 'number' || t.right.kind !== 'max') return null;
    const clampAt = t.right, lo = clampAt.left, hi = clampAt.right.kind === 'min' ? clampAt.right.left : null;
    const inner = clampAt.right.kind === 'min' ? clampAt.right.right : null;
    if (!inner || lo.kind !== 'number' || lo.value !== 0 || hi?.kind !== 'number' || hi.value !== 1) return null;
    const text = printFormula(inner), starts = numbersIn(inner).flatMap(x => [x, r4(1 - x)]);
    const found = SCALER_NAMES.flatMap(n => starts.map(start => ({ measure: FAMILY[n].measure, dir: FAMILY[n].dir, start, scale: (t.left as { value: number }).value })))
      .find(s => s.start > 0 && s.start < 1 && printed(rampText(s, R), R) === text);
    if (!found) return null;
    out.push(found);
  }
  return { core: f.left.left, base: f.left.right.value, scalers: out };
}
const numbersIn = (f: Formula): number[] => {
  switch (f.kind) {
    case 'number': return [f.value];
    case 'negate': return numbersIn(f.arg);
    case 'binary': case 'min': case 'max': return [...numbersIn(f.left), ...numbersIn(f.right)];
    default: return [];
  }
};

// ── the reference dungeon (design 8.0, RULES.fight.kit.reference) ──
/** The ranks the reference dungeon is given at, and the one a formula's base cut is worked out at (the design's table). */
export const REFERENCE_RANKS: readonly Rank[] = ['E', 'C', 'S'];
const BASE_RANK = 'C';
/** The body each kind's reference user wears: the strike's bruiser the medium kit, every other kind's body the light. */
const BODY: { readonly [K in AbilityKind]: 'medium' | 'light' } = { strike: 'medium', shot: 'light', blast: 'light', curse: 'light', support: 'light' };
/** The shares of HP a current-HP pair is averaged over: 5% to 100% in twentieths, each side alike. */
const GRID = Array.from({ length: 20 }, (_, i) => (i + 1) / 20);

const bonusAt = (s: Scaler, x: number, R: ScalerRules): number => s.scale * clamp01((x - s.start) / (endOf(s.measure, s.dir, R) - s.start));
/**
 * A scaler's mean bonus against one foe whose max HP is `ratio` times the user's: a share is uniform over 0 to 1 (a body
 * takes about equal hits over its life), so its mean is `scale * window / 2`; a max-HP pair is fixed by the two bodies;
 * a current-HP pair is the mean over both shares in twentieths.
 */
function meanAgainst(s: Scaler, ratio: number, R: ScalerRules): number {
  if (s.measure === 'target' || s.measure === 'user') return s.scale * Math.abs(s.start - endOf(s.measure, s.dir, R)) / 2;
  if (s.measure === 'maxPair') return bonusAt(s, ratio / (1 + ratio), R);
  return GRID.reduce((sum, a) => sum + GRID.reduce((q, b) => q + bonusAt(s, a * ratio / (a * ratio + b), R), 0), 0) / GRID.length ** 2;
}
/**
 * A scaler's mean bonus at `rank` for an ability of `kind`: against a pack's normal brute, against a boss, and over the
 * reference dungeon (the two weighted by the rounds the party takes to win each, so a bonus only a boss gives counts for
 * the boss fight's share of the time).
 */
export function scalerMean(s: Scaler, kind: AbilityKind, rank: Rank, R: ScalerRules): { readonly normal: number; readonly boss: number; readonly mean: number } {
  const ref = (R.fight.kit.reference as Readonly<Record<string, typeof R.fight.kit.reference.C>>)[rank] ?? R.fight.kit.reference.C, body = ref[BODY[kind]];
  const normal = meanAgainst(s, body.normal, R), boss = meanAgainst(s, body.boss, R);
  return { normal, boss, mean: (ref.pack * normal + ref.boss * boss) / (ref.pack + ref.boss) };
}
/** The cut on the rest of the formula that keeps it at its plain budget over the reference dungeon at C: `1 / (1 + sum of means)`, to two places. */
export function baseOf(scalers: readonly Scaler[], kind: AbilityKind, R: ScalerRules): number {
  const sum = scalers.reduce((n, s) => n + scalerMean(s, kind, BASE_RANK, R).mean, 0);
  return Math.round(100 / (1 + sum)) / 100;
}
/**
 * How the scalers with their base cut weigh against each reference foe alone, as a share of the plain use, at `rank`:
 * the larger of the two is what the maker warns past `1 + tolerance` (design 8.0: "the worth line shows the larger").
 */
export function againstEach(scalers: readonly Scaler[], kind: AbilityKind, rank: Rank, R: ScalerRules): { readonly normal: number; readonly boss: number } {
  const base = 1 / (1 + scalers.reduce((n, s) => n + scalerMean(s, kind, rank, R).mean, 0));
  const each = (foe: 'normal' | 'boss') => base * (1 + scalers.reduce((n, s) => n + scalerMean(s, kind, rank, R)[foe], 0));
  return { normal: each('normal'), boss: each('boss') };
}

/**
 * The scaler the maker fills for a kind (design 8.0, table 8.0.2): it starts at `scalerStart` (half the HP, or two equal
 * bodies), and its scale is the largest, in steps of `scalerStep` up to `scaleCap`, with which the use against a normal
 * brute alone and against a boss alone stays within the tolerance of its plain use at every reference rank. A share
 * scaler is neutral against every foe, so it is suggested at the cap. The single-use bound (60% of a same-rank tank)
 * never binds on paper (best uses 5 to 25% of a C tank), so it is not searched.
 */
export function suggestScaler(kind: AbilityKind, name: ScalerName, R: ScalerRules): Scaler {
  const K = R.fight.kit, { measure, dir } = FAMILY[name];
  const at = (scale: number): Scaler => ({ measure, dir, start: K.scalerStart, scale });
  const fits = (scale: number, rank: Rank): boolean => { const e = againstEach([at(scale)], kind, rank, R); return e.normal <= 1 + K.tolerance + 1e-9 && e.boss <= 1 + K.tolerance + 1e-9; };
  const steps = Math.round(K.scaleCap / K.scalerStep);
  const best = REFERENCE_RANKS.map(rank => {
    let pick = 0;
    for (let i = 1; i <= steps; i++) if (fits(r4(i * K.scalerStep), rank)) pick = r4(i * K.scalerStep);
    return pick;
  });
  return at(Math.min(...best));
}

/** A scaler in the preview's words (design 8.0 point 6): "Up to +100% against a target under half its HP". */
export const scalerLine = (s: Scaler, R: ScalerRules): string => `Up to +${Math.round(s.scale * 100)}% ${FAMILY[nameOf(s)].words(s.start, R)}.`;
