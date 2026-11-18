// fight-facts.ts: what a fight that ended says of each hunter row in it, as facts for its hunter's chronicle (feature
// 1's notes section 2.2): one `fight` fact from the row's tally (row-tally.ts) and the other rows, and a `kill` fact for
// each foe it took down. Pure. Read by `fought` (fight-save.ts), which records them on a hunter of this phone in the
// write that ended the fight; a player's hunter's travel as the room's `noted` (unit 4). A solo run's kills are
// `killFacts` too, read by `soloRan` (solo.ts) from the run's end.
import { rankIdx } from '../rules.ts';
import type { Rank } from '../rules.ts';
import type { Fact, FactOf, FightOutcome } from '../hunter/facts.ts';
import type { Body } from './effect-ops.ts';
import type { CombatantId } from './ability-types.ts';
import type { SheetKey } from '../ids.ts';
import type { Ended } from './fight-types.ts';
import { tallyOf, turnKillsMax } from './row-tally.ts';
import type { RowTally } from './row-tally.ts';

/** The longest list of foes' names a fight fact keeps (facts.ts `names`). */
const NAMES_MAX = 80;
const pct = (b: Body): number => (b.sheet.hpMax > 0 ? Math.max(0, Math.min(100, Math.round((b.hp / b.sheet.hpMax) * 100))) : 0);

/** A foe a row took down, as its kill fact will name it before it knows whose rank to measure against or where it fell. */
export type KillSeen = Omit<FactOf<'kill'>, 'kind' | 'above' | 'where'>;
/** The foes a tally took down that are monsters: each one's name, rank, type and kind, the killer's HP share then, and whether it had put the killer down. */
export function killsSeen(t: RowTally, rows: readonly Body[]): KillSeen[] {
  return t.kills.flatMap((k): KillSeen[] => {
    const foe = rows.find(b => b.id === k.row);
    if (!foe || foe.origin.kind !== 'monster') return [];
    const o = foe.origin;
    return [{ monster: o.name, rank: o.rank, type: o.type ?? '', mkind: o.monsterKind, hpPct: k.hpPct, payback: t.downedBy.includes(k.row) }];
  });
}
/** The kill facts of `seen` for a hunter of rank `rank`, in a fight or a solo run. */
export const killFacts = (seen: readonly KillSeen[], rank: Rank, where: 'fight' | 'solo'): Fact[] =>
  seen.map(k => ({ kind: 'kill', ...k, above: rankIdx(k.rank) - rankIdx(rank), where }));

/** "Goblin ×3, Hobgoblin": the foes by their monster's name, in the order they first stand in the rows. */
function namesOf(foes: readonly Body[]): string {
  const counts = new Map<string, number>();
  for (const b of foes) { const n = b.origin.kind === 'monster' ? b.origin.name : b.name; counts.set(n, (counts.get(n) ?? 0) + 1); }
  return [...counts].map(([n, c]) => (c > 1 ? `${n} ×${c}` : n)).join(', ').slice(0, NAMES_MAX);
}

/**
 * The facts of hunter row `cid` in fight `f` that ended: its `fight` fact and its kills. `rank`: the hunter's rank;
 * `gate`: the name of the gate the fight came from, '' for none. None for a row that is not a hunter's.
 */
export function rowFacts(f: Ended, cid: CombatantId, rank: Rank, gate: string): Fact[] {
  const me = f.rows.find(b => b.id === cid);
  if (!me || me.kind !== 'hunter') return [];
  const t = tallyOf(me), w = f.summary.winner;
  const outcome: FightOutcome = w === null ? 'ended' : w === me.side ? 'won' : 'lost';
  const side = f.rows.filter(b => b.side === me.side), allies = side.filter(b => b.kind === 'hunter' && b.id !== cid);
  const foes = f.rows.filter(b => b.side !== me.side && b.kind !== 'summon'), monsters = foes.flatMap(b => (b.origin.kind === 'monster' ? [b.origin] : []));
  const above = (rk: Rank): number => rankIdx(rk) - rankIdx(rank), bosses = monsters.filter(o => o.monsterKind === 'boss');
  const kills = killFacts(killsSeen(t, f.rows), rank, 'fight');
  const fight: Fact = {
    kind: 'fight', outcome, rounds: Math.max(1, Math.round(f.summary.rounds)), up: me.hp > 0, downs: t.downs, low: t.low, endPct: pct(me), exactOne: t.exactOne,
    struck: t.struck, hits: t.hits, crits: t.crits, critRun: t.critRunMax, avoided: t.avoided, dealt: t.dealt, taken: t.taken, healed: t.healed,
    raised: t.raised, hexes: t.hexes, kills: t.kills.length, bosses: kills.filter(k => k.kind === 'kill' && k.mkind === 'boss').length, turnKills: turnKillsMax(t),
    items: t.items, allies: allies.length, alliesDown: allies.filter(b => b.hp <= 0).length, sideUp: side.filter(b => b.hp > 0).length, foes: foes.length,
    foeTop: monsters.length ? Math.max(...monsters.map(o => above(o.rank))) : 0, bossTop: bosses.length ? Math.max(...bosses.map(o => above(o.rank))) : null,
    gate, names: namesOf(foes),
  };
  return [fight, ...kills];
}

/**
 * The facts of each row of a player's hunter in fight `f` that ended (its holder is a sheet key of the room), for the
 * room's `noted` message the GM's phone posts in the ending write: `rankOf` reads the hunter's rank from its pushed sheet
 * (none when its sheet is not on this phone: E). `gate` as `rowFacts`.
 */
export function remoteFacts(f: Ended, rankOf: (key: SheetKey) => Rank | null, gate: string): { readonly to: SheetKey; readonly facts: Fact[] }[] {
  return f.rows.flatMap(b => {
    const h = b.holder;
    if (b.kind !== 'hunter' || h?.kind !== 'remote') return [];
    const facts = rowFacts(f, b.id, rankOf(h.remote) ?? 'E', gate);
    return facts.length ? [{ to: h.remote, facts }] : [];
  });
}
