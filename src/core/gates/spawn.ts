// spawn.ts: the roll that makes a new gate: its rank and type (by the rules' `gateSpawn` weights), its name, its pack
// of regular monsters and its boss. Pure: the caller passes the rules, the bestiary's monsters of the rank and the
// random numbers, and src/views/gates.js turns the answer into a gate (making a monster where the roll asks for one).
import { RANKS } from '../rules.ts';
import { oneOf } from '../one-of.ts';
import type { Rank, Rules } from '../rules.ts';
import { GATE_TYPES } from './gate.ts';
import type { GateType } from './gate.ts';

/** A number in [0, 1), as `Math.random` answers. */
export type Random = () => number;
/** One kind of regular monster in the pack. `monsterId: null`: the bestiary has none of the rank, so the caller makes one. */
export type PackEntry = { monsterId: string | null; count: number };
export type GateRoll = { rank: Rank; type: GateType; name: string; breakDays: number; pack: PackEntry[]; bossId: string | null };
/**
 * What the GM asked for; what is not given is rolled. `pack`: the pack's size range in place of the rank's (`packRange`);
 * `boss: false`: no boss even when the pool has one (a personal gate, notes-2-solo.md section 7).
 */
export type SpawnAsk = { rank?: Rank | undefined; type?: GateType | undefined; name?: string | undefined; pack?: readonly [number, number]; boss?: boolean };
/** A bestiary entry as the roll sees it. `custom`: the GM's own (not a seed). */
export type SpawnMonster = { id: string; rank: Rank; boss?: boolean; custom?: boolean; placeholder?: boolean; type: string; name: string };

/** The pack size a rank spawns when `gateSpawn.regulars` does not name it. */
export const DEFAULT_PACK: readonly [number, number] = [2, 6];
/** At most this many kinds of regular monster in one pack. */
export const MAX_KINDS = 3;

/** A key of `weights` picked with chance weight / total, or null when no weight is above 0. */
export function pickWeighted(weights: Readonly<Record<string, number>>, rand: Random): string | null {
  const e = Object.entries(weights).filter(([, w]) => w > 0), total = e.reduce((s, [, w]) => s + w, 0);
  if (!total) return null;
  let r = rand() * total;
  for (const [k, w] of e) { r -= w; if (r < 0) return k; }
  return e[e.length - 1]![0];
}
const below = (n: number, rand: Random): number => Math.floor(rand() * n);

/** The [min, max] pack size of `rank`: the rules' `gateSpawn.regulars` for it, else `DEFAULT_PACK`. */
export function packRange(R: Rules, rank: Rank): [number, number] {
  const rg: readonly unknown[] = (R.gateSpawn.regulars as Partial<Record<Rank, readonly number[]>>)[rank] ?? [];
  const lo = Math.max(1, Math.round(Number(rg[0])) || DEFAULT_PACK[0]);
  return [lo, Math.max(lo, Math.round(Number(rg[1])) || DEFAULT_PACK[1])];
}

/** The name of a monster the caller makes for a gate whose rank has none in the bestiary (`monsterId` or `bossId` null). */
export const placeholderName = (rank: Rank, boss: boolean): string => `${rank}-rank Gate ${boss ? 'Boss' : 'Monster'}`;

/**
 * The monsters a gate of `rank` picks from: its regulars and its bosses. The GM's own monsters of the rank come first:
 * when there are any of a kind, only they are picked. A placeholder the spawn made earlier does not count as the GM's own.
 */
export function spawnPool(bestiary: readonly SpawnMonster[], rank: Rank): { regulars: string[]; bosses: string[] } {
  const all = bestiary.filter(m => m.rank === rank);
  const own = (m: SpawnMonster) => !!m.custom && !m.placeholder;
  const pick = (boss: boolean) => { const of = all.filter(m => !!m.boss === boss), mine = of.filter(own); return (mine.length ? mine : of).map(m => m.id); };
  return { regulars: pick(false), bosses: pick(true) };
}

/** Rolls a new gate from the rules' weights and the bestiary. */
export function rollGate(R: Rules, ask: SpawnAsk, bestiary: readonly SpawnMonster[], rand: Random): GateRoll {
  const sp = R.gateSpawn;
  const rank = ask.rank ?? oneOf(pickWeighted(sp.rank, rand), RANKS, 'E');
  const type = ask.type ?? oneOf(pickWeighted(sp.type, rand), GATE_TYPES, 'normal');
  const pool = spawnPool(bestiary, rank);
  const [lo, hi] = ask.pack ?? packRange(R, rank);
  const total = lo + below(hi - lo + 1, rand);
  const kinds = Math.min(total, 1 + below(MAX_KINDS, rand));
  const chosen = Array.from({ length: kinds }, () => (pool.regulars.length ? pool.regulars[below(pool.regulars.length, rand)]! : null));
  const counts = chosen.map(() => 0);
  for (let i = 0; i < total; i++) counts[i < kinds ? i : below(kinds, rand)]! += 1;
  const pack: PackEntry[] = [];
  chosen.forEach((monsterId, i) => {
    const same = monsterId !== null ? pack.find(p => p.monsterId === monsterId) : undefined;
    if (same) same.count += counts[i]!; else pack.push({ monsterId, count: counts[i]! });
  });
  const bossId = ask.boss !== false && pool.bosses.length ? pool.bosses[below(pool.bosses.length, rand)]! : null;
  const names = R.gateNames.length ? R.gateNames : ['Gate'];
  const name = String(ask.name || names[below(names.length, rand)]).slice(0, 60);
  return { rank, type, name, breakDays: (R.rankTable[rank] || R.rankTable.E).breakDays, pack, bossId };
}

// ── a personal gate's rank (notes-2-solo.md section 7) ──
/** The weights of a personal gate's rank, in percent: one rank below the hunter's, at it, one above. */
export type RankOdds = { readonly below: number; readonly same: number; readonly above: number };
/**
 * The rank of a hunter's personal gate: one below `rank`, `rank`, or one above, by `odds`; the share of a rank past E or
 * S is the hunter's own (an E hunter's below is E).
 */
export function soloRank(rank: Rank, odds: RankOdds, rand: Random): Rank {
  const at = RANKS.indexOf(rank), w: Partial<Record<Rank, number>> = {};
  const add = (i: number, n: number): void => { const r = RANKS[i] ?? rank; w[r] = (w[r] ?? 0) + Math.max(0, n); };
  add(at - 1, odds.below); add(at, odds.same); add(at + 1, odds.above);
  return oneOf(pickWeighted(w as Record<string, number>, rand), RANKS, rank);
}

// ── a loot roll (implicit audit 3, I2 and G3) ──
/** One thing a loot roll gave: gold, or an item of the pool. */
export type LootDrop<I> = { readonly kind: 'gold'; readonly gold: number } | { readonly kind: 'item'; readonly item: I };
/**
 * Whose roll it is: a boss's makes two picks; `share` is the part of the table the roll pays, from 0 to 1 (`lootShareOf`):
 * the gold rolled times it, rounded down, and each pick made with that chance. 1 is the whole table.
 */
export type LootAsk = { readonly boss: boolean; readonly share: number };
/**
 * The share of its loot roll a cleared gate pays (economy design 4.2): a personal gate the rule `solo.lootShare`, a world
 * gate all of it, whether a party clears it or one hunter runs it alone.
 */
export const lootShareOf = (R: Pick<Rules, 'solo'>, kind: 'personal' | 'world'): number => (kind === 'personal' ? R.solo.lootShare : 1);
/**
 * A loot roll of `rank`'s table (the rules' `loot`, E's for a rank it lacks): its gold anywhere in the table's span when
 * it has one, times the ask's share, then one pick by rarity weight (two for a boss), each made when a draw falls under
 * the share and then an item of the picked rarity from `pool`, none when the pool holds none of it. A share of 1 draws no
 * chance, so a world gate's roll reads the same numbers as before shares. The Clear of a gate rolls a boss's; the GM's
 * roll table a regular's; a personal gate's run its share.
 */
export function rollLoot<I extends { readonly rar: string }>(R: Pick<Rules, 'loot'>, rank: Rank, ask: LootAsk, pool: readonly I[], rand: Random): LootDrop<I>[] {
  const t = R.loot[rank] ?? R.loot.E, out: LootDrop<I>[] = [];
  if (t.gold) { const [lo = 0, hi = lo] = t.gold; out.push({ kind: 'gold', gold: Math.floor((lo + below(Math.max(0, hi - lo) + 1, rand)) * ask.share) }); }
  for (let n = ask.boss ? 2 : 1; n > 0; n--) {
    if (ask.share < 1 && rand() >= ask.share) continue;
    const rar = pickWeighted(t.weights, rand), of = rar === null ? [] : pool.filter(x => x.rar === rar);
    if (of.length) out.push({ kind: 'item', item: of[below(of.length, rand)]! });
  }
  return out;
}
