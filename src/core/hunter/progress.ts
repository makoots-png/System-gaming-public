// progress.ts: a hunter's level, XP and ability points, and the stats those points are put into. Pure.
// Points are not a counter: the points free are what the levels held give, plus bonus points, less what was spent,
// less what is pending.
//
// The allocation. `stats` are the confirmed stats; `pending` holds, per stat, the points put on it and not yet
// confirmed. What the sheet is built from is the two added (`allocated`). A pending point is not spent: it leaves the
// points free while it is pending, and `confirm` moves it into the stat and into `spent`. So the state cannot say a
// stat is unconfirmed while the points disagree, and no stored pair of lists can grant a refund that was never paid
// (the old `statsLocked` was a second full list a view compared, with three writers and a GM branch: ab79803).
// The rule, with what each role may do, is `raise`, `lower`, `confirm`, `raiseMany` (Auto) and the GM's `setStat`.
//
// A view changes these fields only through a function here, in `store.apply` (src/core/save-step.ts).
// The save repair reads a stored hunter's fields in src/core/save.ts.
import { xpToNext } from '../rules.ts';
import type { Rules } from '../rules.ts';
import type { Role } from '../role.ts';
import { refuse } from '../save-step.ts';
import type { Refused } from '../save-step.ts';
import { STAT_KEYS } from '../stats.ts';
import type { StatKey } from '../stats.ts';
import { pointsAt } from './derive.ts';

/** Points put on a stat and not yet confirmed, by stat. A stat with none is absent; a present one is 1 or more. */
export type Pending = Partial<Record<StatKey, number>>;

/** What a hunter stores of its progress. The points free are not stored: `available` derives them. */
export type Progress = {
  /** 1 to MAX_LEVEL. */
  level: number;
  /** XP inside the level: 0 up to the level's cost, `xpToNext(level)`. */
  xp: number;
  /** The highest level this hunter has held, at least `level`. Reaching a level above it refills HP and mana. */
  peakLevel: number;
  /** Points from quests, dailies and the GM, less the points the GM took back. May be below 0. */
  bonusPoints: number;
  /** Points put into stats and confirmed, 0 or more. */
  spent: number;
  /** Points put on stats and not yet confirmed (the header). */
  pending: Pending;
};

/** Bound for junk only. 1e9 XP, the largest award a room accepts, takes a level 1 hunter to level 4472 at 100 XP per level. */
export const MAX_LEVEL = 9999;

export const newProgress = (): Progress => ({ level: 1, xp: 0, peakLevel: 1, bonusPoints: 0, spent: 0, pending: {} });

/** Only the progress fields: a hunter passed in keeps its other fields out of the answer. */
const fieldsOf = (p: Progress): Progress => ({ level: p.level, xp: p.xp, peakLevel: p.peakLevel, bonusPoints: p.bonusPoints, spent: p.spent, pending: p.pending });
/** All the points pending. */
export const pendingTotal = (p: Pick<Progress, 'pending'>): number => STAT_KEYS.reduce((n, k) => n + (p.pending[k] ?? 0), 0);

/** The points a level holds: the creation points of level 1, then `pointsPerLevel` for each level above 1 (derive.ts `pointsAt`). */
export const levelPoints = (R: Rules, level: number): number => pointsAt(level, R);
/** Points free, below 0 when the hunter has spent more than it holds (after losing levels). */
const balance = (p: Progress, R: Rules): number => levelPoints(R, p.level) + p.bonusPoints - p.spent - pendingTotal(p);
/** The points free to spend, as the sheet shows them: never below 0. */
export const available = (p: Progress, R: Rules): number => Math.max(0, balance(p, R));

/**
 * What an XP change did: the progress after it, the levels it went from and to, the change in points free, whether HP and
 * mana refill, and the XP it moved (`xp`: the amount asked, less what level 1 with 0 XP or the top level kept back).
 */
export type XpChange = { progress: Progress; from: number; to: number; points: number; refill: boolean; xp: number };

/**
 * The progress after `amount` XP (below 0 takes XP back). Levels are gained while the XP covers the level's cost and
 * lost while it is below 0, never below level 1 with 0 XP. HP and mana refill when the rules say so and a level above
 * the peak is reached, so a lost level regained does not refill. Not a finite number: nothing changes.
 */
export function gainXp(p: Progress, amount: number, R: Rules): XpChange {
  const from = p.level;
  if (!Number.isFinite(amount)) return { progress: fieldsOf(p), from, to: from, points: 0, refill: false, xp: 0 };
  let level = p.level, xp = p.xp + Math.trunc(amount);
  while (level < MAX_LEVEL && xp >= xpToNext(R, level)) { xp -= xpToNext(R, level); level++; }
  while (xp < 0 && level > 1) { level--; xp += xpToNext(R, level); }
  xp = Math.max(0, Math.min(xp, xpToNext(R, level) - 1));
  const progress = { ...fieldsOf(p), level, xp, peakLevel: Math.max(p.peakLevel, level) };
  const moved = lifetimeXp(R, level, xp) - lifetimeXp(R, p.level, p.xp);
  return { progress, from, to: level, points: available(progress, R) - available(p, R), refill: R.levelUpRestore && level > p.peakLevel, xp: moved };
}

/** The hunter after `amount` XP (`gainXp`): what an award or a quest writes. */
export const addXp = <P extends Progress>(p: P, amount: number, R: Rules): P => ({ ...p, ...gainXp(p, amount, R).progress, pending: p.pending });

/** XP from level 1 with 0 XP to `level` with `xp`. */
const lifetimeXp = (R: Rules, level: number, xp: number): number => R.xpPerLevel * level * (level - 1) / 2 + xp;

/**
 * The GM's edit of the level and the XP inside it: the XP change that leads there, so the points and the peak follow
 * as they would from an award. The level is kept within 1 to MAX_LEVEL and the XP inside the level.
 */
export function setLevel(p: Progress, level: number, xp: number, R: Rules): XpChange {
  const to = Math.min(MAX_LEVEL, Math.max(1, Math.trunc(level) || 1));
  const within = Math.min(xpToNext(R, to) - 1, Math.max(0, Math.trunc(xp) || 0));
  return gainXp(p, lifetimeXp(R, to, within) - lifetimeXp(R, p.level, p.xp), R);
}
/** The hunter after the GM's edit of its level and XP (`setLevel`). */
export const atLevel = <P extends Progress>(p: P, level: number, xp: number, R: Rules): P => ({ ...p, ...setLevel(p, level, xp, R).progress, pending: p.pending });


/** A reward of `n` points (quests, dailies, a GM award). A deduction takes at most the points free. */
export function grantPoints<P extends Progress>(p: P, n: number, R: Rules): P {
  const delta = n >= 0 ? n : Math.max(n, -available(p, R));
  return { ...p, bonusPoints: p.bonusPoints + delta };
}
/** The GM's edit of the points shown: afterwards `available` is `n`, or 0 for a number below 0. */
export function setPoints<P extends Progress>(p: P, n: number, R: Rules): P {
  return { ...p, bonusPoints: Math.max(0, n) - levelPoints(R, p.level) + p.spent + pendingTotal(p) };
}
/** The GM's +1 point: one more than the points shown now. */
export const plusPoint = <P extends Progress>(p: P, R: Rules): P => setPoints(p, available(p, R) + 1, R);

// ── the allocation ──

type Stats = Record<StatKey, number>;
/** What the allocation functions read and write: the progress and the confirmed stats. A hunter is one. */
export type Allocating = Progress & { stats: Stats };
/** The lowest a stat may be edited to by the GM. */
export const STAT_MIN = 1;

/** The stats the sheet is built from: the confirmed stats and the points pending on them. */
export const allocated = (h: { stats: Stats; pending?: Pending }): Stats =>
  Object.fromEntries(STAT_KEYS.map(k => [k, h.stats[k] + (h.pending?.[k] ?? 0)])) as Stats;
/** Whether any point waits for Confirm. */
export const hasPending = (p: Pick<Progress, 'pending'>): boolean => pendingTotal(p) > 0;

const withPending = (pending: Pending, k: StatKey, n: number): Pending => {
  const { [k]: _gone, ...rest } = pending;
  return n > 0 ? { ...rest, [k]: n } : rest;
};

/**
 * The GM's edit of a stat to `value` as the sheet shows it. It confirms that stat: the points pending on it count as
 * spent, and no point returns. Below `STAT_MIN` it stops at `STAT_MIN`.
 */
export function setStat<H extends Allocating>(h: H, stat: StatKey, value: number): H {
  const to = Math.max(STAT_MIN, Math.trunc(value) || STAT_MIN);
  return { ...h, stats: { ...h.stats, [stat]: to }, spent: h.spent + (h.pending[stat] ?? 0), pending: withPending(h.pending, stat, 0) };
}

/**
 * + on a stat. With a point free, the point goes on the stat, pending. With none, a player is refused (`no-points`);
 * the GM edits the stat one up (`setStat`).
 */
export function raise<H extends Allocating>(h: H, stat: StatKey, role: Role, R: Rules): H | Refused<'no-points'> {
  if (available(h, R) >= 1) return { ...h, pending: withPending(h.pending, stat, (h.pending[stat] ?? 0) + 1) };
  return role === 'gm' ? setStat(h, stat, allocated(h)[stat] + 1) : refuse('no-points');
}

/**
 * − on a stat. A pending point comes off and is free again, on either phone. With none pending, a player is refused
 * (`confirmed`); the GM edits the stat one down (`setStat`), and is refused at `STAT_MIN` (`at-min`).
 */
export function lower<H extends Allocating>(h: H, stat: StatKey, role: Role): H | Refused<'confirmed' | 'at-min'> {
  const n = h.pending[stat] ?? 0;
  if (n > 0) return { ...h, pending: withPending(h.pending, stat, n - 1) };
  if (role !== 'gm') return refuse('confirmed');
  return h.stats[stat] > STAT_MIN ? setStat(h, stat, h.stats[stat] - 1) : refuse('at-min');
}

/** What a player reads when + or − on a stat is refused (`raise`, `lower`). */
export const ALLOCATION_WORDS: { readonly [W in 'no-points' | 'confirmed' | 'at-min']: string } = {
  'no-points': 'No points to spend.',
  confirmed: 'Confirmed points stay. − takes back only a point you have not confirmed.',
  'at-min': `A stat goes no lower than ${STAT_MIN}.`,
};

/** Confirm: every pending point goes into its stat and into `spent`. The points free do not change. */
export function confirm<H extends Allocating>(h: H): H {
  const stats = allocated(h);
  return { ...h, stats, spent: h.spent + pendingTotal(h), pending: {} };
}

/** Auto: the points of `plan` go on their stats, pending, all or none. Refused when the plan holds more than is free. */
export function raiseMany<H extends Allocating>(h: H, plan: Pending, R: Rules): H | Refused<'no-points'> {
  const n = STAT_KEYS.reduce((a, k) => a + Math.max(0, Math.trunc(plan[k] ?? 0)), 0);
  if (n < 1 || n > available(h, R)) return refuse('no-points');
  let pending = h.pending;
  for (const k of STAT_KEYS) pending = withPending(pending, k, (pending[k] ?? 0) + Math.max(0, Math.trunc(plan[k] ?? 0)));
  return { ...h, pending };
}

/** A hunter's starting stats (a pregen, a new hunter's build): set and confirmed, the points untouched, nothing pending. */
export function startingStats<H extends Allocating>(h: H, stats: Partial<Stats>): H {
  return { ...h, stats: { ...h.stats, ...stats }, pending: {} };
}
