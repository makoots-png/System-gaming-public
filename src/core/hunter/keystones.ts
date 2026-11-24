// keystones.ts: who earns which keystone (docs/agent-handoff/features/notes-11-keystones.md, design A). Pure.
// A keystone is earned when one stat, or two together, hold a large share of the points a body spent. There is no
// keystone state: what a body holds is a function of its allocated stats, its rank, its job's pair and whether that
// job's Job Change chain is done (`KeystoneBasis`), so nothing is saved and a respec or a GM's edit moves it at once.
// The shares and ranks are `RULES.fight.keystone`; what each keystone does is the registry's (K2).
import { STAT_KEYS } from '../stats.ts';
import type { StatKey, Stats } from '../stats.ts';
import { rankIdx } from '../rules.ts';
import type { FightRules, Rank } from '../rules.ts';
import { BUILT_IN_JOBS, isJobName } from '../registry/jobs.ts';
import { allocated } from './progress.ts';
import type { Pending } from './progress.ts';

/** Every unordered pair of a list, each written `first+second` in the list's order. */
type PairOf<K extends readonly string[]> = K extends readonly [infer H extends string, ...infer T extends readonly string[]]
  ? `${H}+${T[number]}` | PairOf<T>
  : never;
/** Two stats in STAT_KEYS order: 'str+agi' | 'str+vit' | ... (28 members). Built over STAT_KEYS, so a new stat asks for its pairs. */
export type StatPair = PairOf<typeof STAT_KEYS>;
/** The pair of two different stats, in STAT_KEYS order whichever comes first here. */
export const pairOf = (a: StatKey, b: StatKey): StatPair => {
  const [x, y] = STAT_KEYS.indexOf(a) < STAT_KEYS.indexOf(b) ? [a, b] : [b, a];
  // PairOf spells each pair `x+y` with x before y in STAT_KEYS, as sorted above.
  return `${x}+${y}` as StatPair;
};
/** Every pair, in STAT_KEYS order: str+agi, str+vit, ..., pow+ctl. */
export const STAT_PAIRS: readonly StatPair[] = STAT_KEYS.flatMap((a, i) => STAT_KEYS.slice(i + 1).map(b => pairOf(a, b)));
/** The two stats of a pair, in STAT_KEYS order. */
export const statsOfPair = (p: StatPair): readonly [StatKey, StatKey] => {
  const [a, b] = p.split('+');
  // a StatPair is two stat keys joined by '+'
  return [a as StatKey, b as StatKey];
};

/** A keystone: a stat's Mark or Apex, or a pair's Confluence. */
export type KeystoneKey =
  | { readonly tier: 'mark'; readonly stat: StatKey }
  | { readonly tier: 'apex'; readonly stat: StatKey }
  | { readonly tier: 'confluence'; readonly pair: StatPair };
export type KeystoneTier = KeystoneKey['tier'];

/**
 * What a body's keystones are a function of, and nothing else. `stats`: its allocated stats (a hunter's confirmed and
 * pending points, never a bonus); `pair`: the pair its job leans to, null for no job or a body with none; `awakened`:
 * that job's Job Change chain is done.
 */
export type KeystoneBasis = { readonly stats: Stats; readonly rank: Rank; readonly pair: StatPair | null; readonly awakened: boolean };
/** The rules keystones read: the shares, ranks and switch, and the stat base the spent points are counted from. */
export type KeystoneRules = Pick<FightRules, 'keystone' | 'statBase'>;

/** The points a stat spent: its score above the base. A stat edited under the base spent none. */
const spent = (score: number, R: KeystoneRules): number => Math.max(0, score - R.statBase);
/** Each stat's share of the points spent, from 0 to 1; every share is 0 when nothing was spent. */
export function sharesOf(stats: Stats, R: KeystoneRules): Readonly<Record<StatKey, number>> {
  const total = STAT_KEYS.reduce((n, k) => n + spent(stats[k], R), 0);
  return Object.fromEntries(STAT_KEYS.map(k => [k, total > 0 ? spent(stats[k], R) / total : 0])) as Record<StatKey, number>;
}

/** Whether `rank` is at `least` or above it. */
const reaches = (rank: Rank, least: Rank): boolean => rankIdx(rank) >= rankIdx(least);
/** Whether a stat's share earns its mark, at any rank. */
const marks = (share: number, R: KeystoneRules): boolean => share >= R.keystone.markShare;
/** Whether a stat's share earns its apex, at any rank: over the share, never at it. */
const apexes = (share: number, R: KeystoneRules): boolean => share > R.keystone.apexShare;
/** Whether both stats of a pair hold the confluence's share. */
const pairs = (p: StatPair, shares: Readonly<Record<StatKey, number>>, R: KeystoneRules): boolean =>
  statsOfPair(p).every(k => shares[k] >= R.keystone.pairShare);

/**
 * The pair whose confluence a body holds by its shares, at any rank: the job's pair when both its stats hold the share
 * (the job is the one choice that bends the rule), else the two highest stats when both hold it, a tie going to the
 * stat first in STAT_KEYS. Null when no pair holds it.
 */
function confluenceOf(b: KeystoneBasis, shares: Readonly<Record<StatKey, number>>, R: KeystoneRules): StatPair | null {
  if (b.pair && pairs(b.pair, shares, R)) return b.pair;
  const [first, second] = [...STAT_KEYS].sort((x, y) => shares[y] - shares[x]);
  const top = pairOf(first!, second!);
  return pairs(top, shares, R) ? top : null;
}

/**
 * The keystones a body holds, in a fixed order: its marks in STAT_KEYS order, its confluence, its apex. None when the
 * switch is off. A mark at `markRank` for each stat holding `markShare`; the confluence at `pairRank` (`confluenceOf`);
 * the apex at `apexRank` for the stat over `apexShare`, which one stat at most can be.
 */
export function keystonesOf(b: KeystoneBasis, R: KeystoneRules): readonly KeystoneKey[] {
  const K = R.keystone;
  if (!K.on) return [];
  const shares = sharesOf(b.stats, R), out: KeystoneKey[] = [];
  if (reaches(b.rank, K.markRank)) for (const stat of STAT_KEYS) if (marks(shares[stat], R)) out.push({ tier: 'mark', stat });
  const pair = reaches(b.rank, K.pairRank) ? confluenceOf(b, shares, R) : null;
  if (pair) out.push({ tier: 'confluence', pair });
  const apex = reaches(b.rank, K.apexRank) ? STAT_KEYS.find(k => apexes(shares[k], R)) : undefined;
  if (apex) out.push({ tier: 'apex', stat: apex });
  return out;
}

/** Stable string identifier for a keystone key (`mark:str`, `confluence:str+dis`, `apex:str`). */
export const keystoneKeyId = (k: KeystoneKey): string => (k.tier === 'confluence' ? `confluence:${k.pair}` : `${k.tier}:${k.stat}`);

/**
 * The next keystone of one stat's own: its mark until it holds it, then its apex. `share` and `rank` are what it asks;
 * `shareMet` and `rankMet` whether the body has each now.
 */
export type NextKeystone = {
  readonly key: Extract<KeystoneKey, { tier: 'mark' | 'apex' }>;
  readonly share: number; readonly rank: Rank;
  readonly shareMet: boolean; readonly rankMet: boolean;
};
/** One stat's standing for the sheet's words: its share of the points spent and its next keystone, null when it holds both. */
export type StatReach = { readonly stat: StatKey; readonly share: number; readonly next: NextKeystone | null };
/**
 * What the hunter's next confluence asks, or null when keystones are off, a confluence is already held, or no pair applies
 * yet. `fromJob` is true when this pair is the hunter's job pair.
 */
export type ConfluenceReach = {
  readonly key: Extract<KeystoneKey, { tier: 'confluence' }>;
  readonly stats: readonly [StatKey, StatKey];
  readonly shares: readonly [number, number];
  readonly share: number; readonly rank: Rank;
  readonly shareMet: boolean; readonly rankMet: boolean;
  readonly fromJob: boolean;
};
/** Every stat's standing and the confluence's standing, plus total ability points spent above the stat base. */
export type KeystoneReach = {
  readonly totalSpent: number;
  readonly stats: readonly StatReach[];
  readonly confluence: ConfluenceReach | null;
};
/** One candidate for the sheet's nearest unearned keystone line. */
export type NearestKeystone =
  | { readonly kind: 'stat'; readonly stat: StatKey; readonly current: number; readonly next: NextKeystone }
  | { readonly kind: 'confluence'; readonly reach: ConfluenceReach };
/** Keystones earned and lost between two bases (for Confirm allocation preview). */
export type KeystoneDiff = { readonly earned: readonly KeystoneKey[]; readonly lost: readonly KeystoneKey[] };

/** Share shortfall for a pair to reach `pairShare` in both stats. */
const pairShortfall = (p: StatPair, shares: Readonly<Record<StatKey, number>>, need: number): number => {
  const [a, b] = statsOfPair(p);
  return Math.max(0, need - shares[a]) + Math.max(0, need - shares[b]);
};

/**
 * For the sheet's words: total points spent, each stat in STAT_KEYS order with its share and next single-stat keystone,
 * and what the next confluence asks (the qualifying pair when waiting on rank, else the job pair when it is as close as
 * or closer than the two highest stats, else the two highest stats). With the switch off every next keystone is null.
 */
export function keystoneReach(b: KeystoneBasis, R: KeystoneRules): KeystoneReach {
  const K = R.keystone, totalSpent = STAT_KEYS.reduce((n, k) => n + spent(b.stats[k], R), 0);
  const shares = sharesOf(b.stats, R), held = keystonesOf(b, R);
  const holds = (tier: 'mark' | 'apex', stat: StatKey): boolean => held.some(h => h.tier === tier && h.stat === stat);
  const ask = (tier: 'mark' | 'apex', stat: StatKey): NextKeystone => tier === 'mark'
    ? { key: { tier, stat }, share: K.markShare, rank: K.markRank, shareMet: marks(shares[stat], R), rankMet: reaches(b.rank, K.markRank) }
    : { key: { tier, stat }, share: K.apexShare, rank: K.apexRank, shareMet: apexes(shares[stat], R), rankMet: reaches(b.rank, K.apexRank) };
  const stats: StatReach[] = STAT_KEYS.map(stat => {
    const tier = !K.on ? null : !holds('mark', stat) ? 'mark' : !holds('apex', stat) ? 'apex' : null;
    return { stat, share: shares[stat], next: tier && ask(tier, stat) };
  });
  let confluence: ConfluenceReach | null = null;
  if (K.on && !held.some(h => h.tier === 'confluence')) {
    const qualified = confluenceOf(b, shares, R), rankMet = reaches(b.rank, K.pairRank);
    let pair: StatPair | null = qualified;
    if (pair === null) {
      if (totalSpent === 0) pair = b.pair;
      else {
        const [first, second] = [...STAT_KEYS].sort((x, y) => shares[y] - shares[x]);
        const top = pairOf(first!, second!);
        pair = b.pair !== null && pairShortfall(b.pair, shares, K.pairShare) <= pairShortfall(top, shares, K.pairShare) ? b.pair : top;
      }
    }
    if (pair !== null) {
      const pairStats = statsOfPair(pair);
      confluence = {
        key: { tier: 'confluence', pair },
        stats: pairStats,
        shares: [shares[pairStats[0]], shares[pairStats[1]]],
        share: K.pairShare,
        rank: K.pairRank,
        shareMet: qualified !== null,
        rankMet,
        fromJob: b.pair === pair,
      };
    }
  }
  return { totalSpent, stats, confluence };
}

const TIER_ORDER: { readonly [T in KeystoneTier]: number } = { mark: 0, confluence: 1, apex: 2 };
/**
 * The nearest unearned keystone for the sheet's summary line, or null when keystones are off, nothing is spent, or none
 * remains. Priority: (1) share already met and waiting on rank (lowest rank first), (2) rank met and waiting on share
 * (smallest share shortfall first), (3) neither met (lowest rank, then smallest share shortfall).
 */
export function nearestKeystone(reach: KeystoneReach, R: KeystoneRules): NearestKeystone | null {
  if (!R.keystone.on || reach.totalSpent === 0) return null;
  type Ranked = { readonly item: NearestKeystone; readonly bucket: number; readonly rank: number; readonly gap: number; readonly tier: number; readonly order: number };
  const candidates: Ranked[] = [];
  reach.stats.forEach((s, idx) => {
    if (!s.next) return;
    const n = s.next, bucket = n.shareMet && !n.rankMet ? 0 : n.rankMet && !n.shareMet ? 1 : 2;
    const gap = n.shareMet ? 0 : n.key.tier === 'apex' ? Math.max(0, n.share - s.share) + 1e-9 : Math.max(0, n.share - s.share);
    candidates.push({ item: { kind: 'stat', stat: s.stat, current: s.share, next: n }, bucket, rank: rankIdx(n.rank), gap, tier: TIER_ORDER[n.key.tier], order: idx });
  });
  if (reach.confluence) {
    const c = reach.confluence, bucket = c.shareMet && !c.rankMet ? 0 : c.rankMet && !c.shareMet ? 1 : 2;
    const gap = c.shareMet ? 0 : Math.max(0, c.share - c.shares[0]) + Math.max(0, c.share - c.shares[1]);
    candidates.push({ item: { kind: 'confluence', reach: c }, bucket, rank: rankIdx(c.rank), gap, tier: TIER_ORDER.confluence, order: STAT_KEYS.indexOf(c.stats[0]) });
  }
  if (!candidates.length) return null;
  candidates.sort((a, b) => a.bucket - b.bucket
    || (a.bucket === 1 ? a.gap - b.gap || a.rank - b.rank : a.rank - b.rank || a.gap - b.gap)
    || a.tier - b.tier || a.order - b.order);
  return candidates[0]!.item;
}

/** Keystones gained and lost if `before` moves to `after` (for pending stat allocation preview). */
export function keystoneDiff(before: KeystoneBasis, after: KeystoneBasis, R: KeystoneRules): KeystoneDiff {
  const was = keystonesOf(before, R), now = keystonesOf(after, R);
  const wasIds = new Set(was.map(keystoneKeyId)), nowIds = new Set(now.map(keystoneKeyId));
  return {
    earned: now.filter(k => !wasIds.has(keystoneKeyId(k))),
    lost: was.filter(k => !nowIds.has(keystoneKeyId(k))),
  };
}

/** What a hunter's keystones are read from: its points, rank and job, and the job whose Job Change it finished (`Hunter.jobDone`). */
export type KeystoneHunter = {
  readonly stats: Stats; readonly pending?: Pending; readonly rank: Rank; readonly job: string | null;
  readonly jobDone: string | null;
};
/**
 * A hunter's basis: its allocated stats (confirmed and pending, so the allocation screen previews a keystone before
 * Confirm), its rank, its job's pair (a job of `registry/jobs.ts`; any other job leans to none) and whether that job's
 * Job Change chain is done (`jobDone` is that job). Its gear, titles, perks and
 * statuses are not read.
 */
export function keystoneBasis(h: KeystoneHunter): KeystoneBasis {
  const job = isJobName(h.job) ? h.job : null;
  const awakened = job !== null && h.jobDone === job;
  return { stats: allocated(h), rank: h.rank, pair: job ? BUILT_IN_JOBS[job].pair : null, awakened };
}
/** Keystones gained and lost if `h` confirms its pending stat points (confirmed stats vs allocated stats). */
export function keystoneConfirmDiff(h: KeystoneHunter, R: KeystoneRules): KeystoneDiff {
  const after = keystoneBasis(h);
  return keystoneDiff({ ...after, stats: h.stats }, after, R);
}
