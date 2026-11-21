// progress.ts: a hunter's level, XP and ability points, and the stats those points are put into. Pure.
// Points are not a counter: the points free are what the levels held give, plus bonus points, less what was spent,
// less what is pending.
//
// The allocation. `stats` are the confirmed stats; `pending` holds, per stat, the points put on it and not yet
// confirmed. What the sheet is built from is the two added (`allocated`). A pending point is not spent: it leaves the
// points free while it is pending, and `confirm` moves it into the stat and into `spent`. So the state cannot say a
// stat is unconfirmed while the points disagree, and no stored pair of lists can grant a refund that was never paid
// (the old `statsLocked` was a second full list a view compared, with three writers and a GM branch: ab79803).
// The allocation is settled or allocating (`ProgressAllocation`), and every change to these fields is an event of
// `progressStep` through `PROGRESS_TABLE`: `raise`, `lower`, `confirm`, `raiseMany` (Auto), the GM's `setStat`, XP,
// the GM's level, points and the GM's points are its named events.
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
import { MAX_LEVEL, MIN_LEVEL, levelOf } from './level.ts';

/** Points put on a stat and not yet confirmed, by stat. A stat with none is absent; a present one is 1 or more. */
export type Pending = Partial<Record<StatKey, number>>;

/** What a hunter stores of its progress. The points free are not stored: `available` derives them. */
export type Progress = {
  /** A level (level.ts): MIN_LEVEL to MAX_LEVEL. */
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

export const newProgress = (): Progress => ({ level: MIN_LEVEL, xp: 0, peakLevel: MIN_LEVEL, bonusPoints: 0, spent: 0, pending: {} });

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
  while (xp < 0 && level > MIN_LEVEL) { level--; xp += xpToNext(R, level); }
  xp = Math.max(0, Math.min(xp, xpToNext(R, level) - 1));
  const progress = { ...fieldsOf(p), level, xp, peakLevel: Math.max(p.peakLevel, level) };
  const moved = lifetimeXp(R, level, xp) - lifetimeXp(R, p.level, p.xp);
  return { progress, from, to: level, points: available(progress, R) - available(p, R), refill: R.levelUpRestore && level > p.peakLevel, xp: moved };
}

/** XP from level 1 with 0 XP to `level` with `xp`. */
const lifetimeXp = (R: Rules, level: number, xp: number): number => R.xpPerLevel * level * (level - 1) / 2 + xp;

/**
 * The GM's edit of the level and the XP inside it: the XP change that leads there, so the points and the peak follow
 * as they would from an award. The level is the nearest level (`levelOf`), the XP inside the level.
 */
export function setLevel(p: Progress, level: number, xp: number, R: Rules): XpChange {
  const to = levelOf(level);
  const within = Math.min(xpToNext(R, to) - 1, Math.max(0, Math.trunc(xp) || 0));
  return gainXp(p, lifetimeXp(R, to, within) - lifetimeXp(R, p.level, p.xp), R);
}
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

/** A count from outside (a plan's, a reward's): a whole number of 0 or more, and 0 for what is not a finite number. */
const whole = (v: number | undefined): number => (Number.isFinite(v) ? Math.max(0, Math.trunc(v!)) : 0);

// ── the machine: every change to the progress and the allocation is an event through `PROGRESS_TABLE` ──
//
//   settled    --+ or Auto [a point free]----------------------------------------> allocating
//   settled    --+ [none free] (GM: the stat edited), the GM's stat edit, starting stats, XP, level, points, Confirm
//                  (nothing to confirm)----------------------------------------------> settled
//   settled    --− (player)----------------------------------------------------------> refused `confirmed`
//   allocating --+ or Auto [a point free], − [more pending], the GM's edit of another stat--> allocating
//   allocating --Confirm, starting stats, − [the last pending], the GM's edit of the last pending stat--> settled
//   allocating --XP or level (a level may be lost)-----------> allocating, the pending kept (SMX-rules-7.1 waits)
//   allocating --a deduction of points------------------------> only the points free taken (SMX-rules-7.1 waits)

/** Where the allocation stands, read from `pending`: nothing waits for Confirm, or points sit on stats (never none). */
export type ProgressAllocation = { readonly at: 'settled' } | { readonly at: 'allocating'; readonly pending: Pending };
export const allocationOf = (p: Pick<Progress, 'pending'>): ProgressAllocation =>
  (hasPending(p) ? { at: 'allocating', pending: p.pending } : { at: 'settled' });

/**
 * What can happen to a hunter's progress: + and − on a stat (by role), Confirm, Auto's plan, the GM's edit of a stat,
 * a hunter's starting stats, XP given or taken, the GM's level and XP, points given or taken, the GM's points shown.
 */
export type ProgressEvent =
  | { readonly type: 'raise'; readonly stat: StatKey; readonly role: Role }
  | { readonly type: 'lower'; readonly stat: StatKey; readonly role: Role }
  | { readonly type: 'confirm' }
  | { readonly type: 'auto'; readonly plan: Pending }
  | { readonly type: 'setStat'; readonly stat: StatKey; readonly value: number }
  | { readonly type: 'start'; readonly stats: Partial<Stats> }
  | { readonly type: 'xp'; readonly amount: number }
  | { readonly type: 'level'; readonly level: number; readonly xp: number }
  | { readonly type: 'points'; readonly n: number }
  | { readonly type: 'setPoints'; readonly n: number };
export type ProgressEventType = ProgressEvent['type'];
type EventOf<T extends ProgressEventType> = Extract<ProgressEvent, { type: T }>;
/** The events that read no rules, and the events that read only the progress (not the stats). */
type NoRules = 'lower' | 'confirm' | 'setStat' | 'start';
type OfProgress = 'xp' | 'level' | 'points' | 'setPoints';
/** Why each event that can be refused is. */
type Refusals = { readonly raise: 'no-points'; readonly lower: 'confirmed' | 'at-min'; readonly auto: 'no-points'; readonly setPoints: 'not-a-number' };
export type ProgressRefusal = Refusals[keyof Refusals];
/** What an event of type `T` answers for `H`: `H`, or `H` or its refusal. */
type Answer<H, T extends ProgressEventType> = T extends keyof Refusals ? H | Refused<Refusals[T]> : H;
type Cell<T extends ProgressEventType> = <H extends Allocating>(h: H, e: EventOf<T>, R: T extends NoRules ? undefined : Rules) => Answer<H, T>;
type ProgressRow = { readonly [T in ProgressEventType]: Cell<T> };

const raiseCell: Cell<'raise'> = (h, e, R) => {
  if (available(h, R) >= 1) return { ...h, pending: withPending(h.pending, e.stat, (h.pending[e.stat] ?? 0) + 1) };
  return e.role === 'gm' ? statCell(h, { type: 'setStat', stat: e.stat, value: allocated(h)[e.stat] + 1 }, undefined) : refuse('no-points');
};
/** − with nothing pending on the stat: a player is refused, the GM edits the stat one down, to `STAT_MIN`. */
const lowerConfirmed: Cell<'lower'> = (h, e) => {
  if (e.role !== 'gm') return refuse('confirmed');
  return h.stats[e.stat] > STAT_MIN ? statCell(h, { type: 'setStat', stat: e.stat, value: h.stats[e.stat] - 1 }, undefined) : refuse('at-min');
};
const lowerPending: Cell<'lower'> = (h, e, R) => {
  const n = h.pending[e.stat] ?? 0;
  return n > 0 ? { ...h, pending: withPending(h.pending, e.stat, n - 1) } : lowerConfirmed(h, e, R);
};
const confirmCell: Cell<'confirm'> = h => ({ ...h, stats: allocated(h), spent: h.spent + pendingTotal(h), pending: {} });
const autoCell: Cell<'auto'> = (h, e, R) => {
  const n = STAT_KEYS.reduce((a, k) => a + whole(e.plan[k]), 0);
  if (n < 1 || n > available(h, R)) return refuse('no-points');
  let pending = h.pending;
  for (const k of STAT_KEYS) pending = withPending(pending, k, (pending[k] ?? 0) + whole(e.plan[k]));
  return { ...h, pending };
};
const statCell: Cell<'setStat'> = (h, e) => {
  const to = Math.max(STAT_MIN, Math.trunc(e.value) || STAT_MIN);
  return { ...h, stats: { ...h.stats, [e.stat]: to }, spent: h.spent + (h.pending[e.stat] ?? 0), pending: withPending(h.pending, e.stat, 0) };
};
const startCell: Cell<'start'> = (h, e) => ({ ...h, stats: { ...h.stats, ...e.stats }, pending: {} });
const xpCell: Cell<'xp'> = (p, e, R) => ({ ...p, ...gainXp(p, e.amount, R).progress, pending: p.pending });
const levelCell: Cell<'level'> = (p, e, R) => ({ ...p, ...setLevel(p, e.level, e.xp, R).progress, pending: p.pending });
/** Points given; a deduction takes at most the points free. Not a finite number: nothing changes. */
const pointsCell: Cell<'points'> = (p, e, R) => {
  if (!Number.isFinite(e.n)) return p;
  const n = Math.trunc(e.n);
  return { ...p, bonusPoints: p.bonusPoints + (n >= 0 ? n : Math.max(n, -available(p, R))) };
};
const setPointsCell: Cell<'setPoints'> = (p, e, R) => {
  if (!Number.isFinite(e.n)) return refuse('not-a-number');
  return { ...p, bonusPoints: Math.max(0, Math.trunc(e.n)) - levelPoints(R, p.level) + p.spent + pendingTotal(p) };
};
const unchanged: Cell<'confirm'> = h => h;

/** For each state of the allocation, what each event does. */
export const PROGRESS_TABLE: { readonly [S in ProgressAllocation['at']]: ProgressRow } = {
  settled: {
    raise: raiseCell, lower: lowerConfirmed, confirm: unchanged, auto: autoCell, setStat: statCell, start: startCell,
    xp: xpCell, level: levelCell, points: pointsCell, setPoints: setPointsCell,
  },
  allocating: {
    raise: raiseCell, lower: lowerPending, confirm: confirmCell, auto: autoCell, setStat: statCell, start: startCell,
    // SMX-rules-7.1 waits on the owner: whether the points pending are handed back when the level drops. Today they stay
    // pending, so a hunter that now holds fewer points than it spent and has pending owes them (`available` is 0).
    xp: xpCell,
    level: levelCell,
    // SMX-rules-7.1 waits on the owner: whether a deduction (a quest's point cost) reaches the points pending. Today it
    // takes only the points free, and the pending points stay.
    points: pointsCell,
    setPoints: setPointsCell,
  },
};

/**
 * The progress after `e`: the one writer of a hunter's level, XP, peak, points, confirmed stats and pending points.
 * Each event goes to its state's cell in `PROGRESS_TABLE`. Never changes its input. The events of the progress alone
 * (XP, level, points) take any progress; the others take the stats too, and +, Auto and the GM's points read the rules.
 */
export function progressStep<P extends Progress, E extends EventOf<OfProgress>>(p: P, e: E, R: Rules): Answer<P, E['type']>;
export function progressStep<H extends Allocating, E extends EventOf<NoRules>>(h: H, e: E): Answer<H, E['type']>;
export function progressStep<H extends Allocating, E extends ProgressEvent>(h: H, e: E, R: Rules): Answer<H, E['type']>;
export function progressStep<P extends Progress>(p: P, e: ProgressEvent, R?: Rules): P | Refused<ProgressRefusal> {
  // The table pairs each event type with the cell for it, and the overloads pass the rules to every cell that reads them.
  const cell = PROGRESS_TABLE[allocationOf(p).at][e.type] as Cell<ProgressEventType>;
  return cell(p as never, e as never, R as never);
}

/** The hunter after `amount` XP (`gainXp`): what an award or a quest writes. */
export const addXp = <P extends Progress>(p: P, amount: number, R: Rules): P => progressStep(p, { type: 'xp', amount }, R);
/** The hunter after the GM's edit of its level and XP (`setLevel`). */
export const atLevel = <P extends Progress>(p: P, level: number, xp: number, R: Rules): P => progressStep(p, { type: 'level', level, xp }, R);
/** A reward of `n` points (quests, dailies, a GM award). A deduction takes at most the points free. */
export const grantPoints = <P extends Progress>(p: P, n: number, R: Rules): P => progressStep(p, { type: 'points', n }, R);
/** The GM's edit of the points shown: afterwards `available` is `n` cut to a whole number, or 0 below 0. Not a finite number is refused. */
export const setPoints = <P extends Progress>(p: P, n: number, R: Rules): P | Refused<'not-a-number'> => progressStep(p, { type: 'setPoints', n }, R);
/** The GM's +1 point: one more than the points shown now. */
export const plusPoint = <P extends Progress>(p: P, R: Rules): P | Refused<'not-a-number'> => setPoints(p, available(p, R) + 1, R);

/**
 * + on a stat. With a point free, the point goes on the stat, pending. With none, a player is refused (`no-points`);
 * the GM edits the stat one up (`setStat`).
 */
export const raise = <H extends Allocating>(h: H, stat: StatKey, role: Role, R: Rules): H | Refused<'no-points'> => progressStep(h, { type: 'raise', stat, role }, R);
/**
 * − on a stat. A pending point comes off and is free again, on either phone. With none pending, a player is refused
 * (`confirmed`); the GM edits the stat one down (`setStat`), and is refused at `STAT_MIN` (`at-min`).
 */
export const lower = <H extends Allocating>(h: H, stat: StatKey, role: Role): H | Refused<'confirmed' | 'at-min'> => progressStep(h, { type: 'lower', stat, role });
/** Confirm: every pending point goes into its stat and into `spent`. The points free do not change. */
export const confirm = <H extends Allocating>(h: H): H => progressStep(h, { type: 'confirm' });
/** Auto: the points of `plan` go on their stats, pending, all or none. Refused when the plan holds more than is free. */
export const raiseMany = <H extends Allocating>(h: H, plan: Pending, R: Rules): H | Refused<'no-points'> => progressStep(h, { type: 'auto', plan }, R);
/**
 * The GM's edit of a stat to `value` as the sheet shows it. It confirms that stat: the points pending on it count as
 * spent, and no point returns. Below `STAT_MIN` it stops at `STAT_MIN`.
 */
export const setStat = <H extends Allocating>(h: H, stat: StatKey, value: number): H => progressStep(h, { type: 'setStat', stat, value });
/** A hunter's starting stats (a pregen, a new hunter's build): set and confirmed, the points untouched, nothing pending. */
export const startingStats = <H extends Allocating>(h: H, stats: Partial<Stats>): H => progressStep(h, { type: 'start', stats });

/** What a player reads when + or − on a stat is refused (`raise`, `lower`). */
export const ALLOCATION_WORDS: { readonly [W in 'no-points' | 'confirmed' | 'at-min']: string } = {
  'no-points': 'No points to spend.',
  confirmed: 'Confirmed points stay. − takes back only a point you have not confirmed.',
  'at-min': `A stat goes no lower than ${STAT_MIN}.`,
};
