// row-tally.ts: what happened to a row in this fight, kept on the row while the fight runs (it is stored and played over
// many commands and reloads) for its facts at the end (fight-facts.ts `rowFacts`, feature 1's notes section 2.2) and the
// formula's `kills`. Pure. Written only by `tallied`, which the reducer calls at four places: a use's outcomes (`act`
// and `release` in fight.ts), every change (`consequences` in fight-turn.ts), a turn's start (`startTurn`) and a foe
// taken down at any depth of a use or a trigger (`fire` in triggers.ts). A hunter row keeps the whole tally; any other
// row keeps only its kills, which the formula's `kills` reads, so a fight of sixty monsters stays small in the save.
// Stored sparse: a field that never moved is absent, and `tallyOf` reads absent as zero.
import { isUp, rowHp } from './row-hp.ts';
import type { Body } from './effect-ops.ts';
import type { Ability, CombatantId, Outcome } from './ability-types.ts';
import type { Raised } from './triggers.ts';

/** A foe a row took down: the foe's row, the killer's HP share at that moment (%), and the killer's turn it fell in (its count of turns then). */
export type Kill = { readonly row: CombatantId; readonly hpPct: number; readonly turn: number };
/** What happened to a row in this fight. */
export type RowTally = {
  /** Hits it dealt with a use (a damaging outcome not avoided that dealt something), and of those the crits. */
  readonly hits: number; readonly crits: number;
  /** Its crits in a row among its hits now, and the most in a row this fight. */
  readonly critRun: number; readonly critRunMax: number;
  /** Times a use's hit struck it, and uses it avoided (dodged out of, or resisted). */
  readonly struck: number; readonly avoided: number;
  /** HP its uses took from foes (after defence and shields), HP it lost to anything, HP its uses healed on allies. */
  readonly dealt: number; readonly taken: number; readonly healed: number;
  /** Allies its heals brought up from down; statuses its uses put on foes. */
  readonly raised: number; readonly hexes: number;
  /** Times it went down; its lowest HP share while up (%; absent is 100); whether it stood at exactly 1 HP. */
  readonly downs: number; readonly low: number; readonly exactOne: boolean;
  /** Turns it began, consumables it used. */
  readonly turns: number; readonly items: number;
  /** The foes it took down, in order. */
  readonly kills: readonly Kill[];
  /** The rows that took it down, in order (a hunter's own: the payback of a kill). */
  readonly downedBy: readonly CombatantId[];
};
export const NO_TALLY: RowTally = {
  hits: 0, crits: 0, critRun: 0, critRunMax: 0, struck: 0, avoided: 0, dealt: 0, taken: 0, healed: 0, raised: 0, hexes: 0,
  downs: 0, low: 100, exactOne: false, turns: 0, items: 0, kills: [], downedBy: [],
};
/** A row's tally, absent fields read as zero (none at all on a row nothing has happened to). */
export const tallyOf = (b: Pick<Body, 'tally'>): RowTally => ({ ...NO_TALLY, ...b.tally });
/** The most foes a row took down in one of its turns. */
export const turnKillsMax = (t: RowTally): number => {
  const per = new Map<number, number>();
  for (const k of t.kills) per.set(k.turn, (per.get(k.turn) ?? 0) + 1);
  return Math.max(0, ...per.values());
};

/** What the reducer tells the tally. */
export type TallyEvent =
  /** A use landed: its user, the ability, what it did to each target, and the rows before it. */
  | { readonly type: 'used'; readonly by: CombatantId; readonly ability: Pick<Ability, 'item'>; readonly outcomes: readonly Outcome[]; readonly before: readonly Body[] }
  /** Anything changed rows (`consequences`): the rows before it. */
  | { readonly type: 'changed'; readonly before: readonly Body[] }
  /** A row's turn began. */
  | { readonly type: 'turn'; readonly id: CombatantId }
  /** Events raised at any depth: a `kill` takes its foe down for its bearer. */
  | { readonly type: 'raised'; readonly events: readonly Raised[] };

const pct = (b: Body): number => (b.sheet.hpMax > 0 ? Math.max(0, Math.round((rowHp(b) / b.sheet.hpMax) * 100)) : 0);
/** Keeps only the fields that differ from none: the stored tally is sparse. */
function sparse(t: RowTally): Partial<RowTally> | undefined {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(t) as [keyof RowTally, RowTally[keyof RowTally]][]) {
    const none = NO_TALLY[k];
    if (Array.isArray(v) ? v.length > 0 : v !== none) out[k] = v;
  }
  return Object.keys(out).length ? out as Partial<RowTally> : undefined;
}
/** `b` with its tally `t` (absent when it holds nothing). */
function withTally(b: Body, t: RowTally): Body {
  const s = sparse(t);
  if (s) return { ...b, tally: s };
  const { tally: _gone, ...rest } = b;
  return rest;
}
/** Whether a row keeps more than its kills: a hunter's does. */
const whole = (b: Body): boolean => b.kind === 'hunter';

/**
 * The rows after `e`, each row's tally moved by what `e` says of it. A row other than a hunter moves only its kills.
 * Answers `rows` itself when nothing moved.
 */
export function tallied(rows: readonly Body[], e: TallyEvent): Body[] {
  const map = new Map(rows.map(b => [b.id, b] as const));
  let moved = false;
  const bump = (id: CombatantId, f: (t: RowTally, b: Body) => RowTally, all = false): void => {
    const b = map.get(id);
    if (!b || !(all || whole(b))) return;
    const t = tallyOf(b), n = f(t, b);
    if (n === t) return;
    map.set(id, withTally(b, n)); moved = true;
  };
  switch (e.type) {
    case 'used': {
      const before = new Map(e.before.map(b => [b.id, b] as const)), user = map.get(e.by);
      if (!user) break;
      if (e.ability.item) bump(e.by, t => ({ ...t, items: t.items + 1 }));
      for (const o of e.outcomes) {
        const target = map.get(o.target), was = before.get(o.target);
        if (!target) continue;
        const foe = target.side !== user.side, hit = (o.type === 'physical' || o.type === 'magical') && o.avoid !== 'out' && o.dealt > 0;
        if (hit && foe) {
          bump(e.by, t => {
            const run = o.crit ? t.critRun + 1 : 0;
            return { ...t, hits: t.hits + 1, crits: t.crits + (o.crit ? 1 : 0), critRun: run, critRunMax: Math.max(t.critRunMax, run), dealt: t.dealt + o.dealt };
          });
        }
        if (hit) bump(o.target, t => ({ ...t, struck: t.struck + 1 }));
        if (o.avoid === 'out' || o.avoid === 'resisted') bump(o.target, t => ({ ...t, avoided: t.avoided + 1 }));
        if (o.type === 'heal' && !foe && o.target !== e.by && o.dealt > 0) {
          const up = !!was && !isUp(was) && isUp(target);
          bump(e.by, t => ({ ...t, healed: t.healed + o.dealt, raised: t.raised + (up ? 1 : 0) }));
        }
        if (foe && o.statuses.length) bump(e.by, t => ({ ...t, hexes: t.hexes + o.statuses.length }));
      }
      break;
    }
    case 'changed':
      for (const b of e.before) {
        const a = map.get(b.id);
        if (!a) continue;
        bump(a.id, t => {
          const lost = Math.max(0, rowHp(b) - rowHp(a)), fell = isUp(b) && !isUp(a), up = isUp(a);
          const low = up ? Math.min(t.low, pct(a)) : t.low, one = t.exactOne || (up && rowHp(a) === 1);
          return lost || fell || low !== t.low || one !== t.exactOne ? { ...t, taken: t.taken + lost, downs: t.downs + (fell ? 1 : 0), low, exactOne: one } : t;
        });
      }
      break;
    case 'turn':
      bump(e.id, t => ({ ...t, turns: t.turns + 1 }));
      break;
    case 'raised':
      for (const ev of e.events) {
        if (ev.event !== 'kill' || ev.other === null) continue;
        const k = map.get(ev.bearer), d = map.get(ev.other);
        if (!k || !d || k.side === d.side) continue;
        bump(k.id, t => ({ ...t, kills: [...t.kills, { row: d.id, hpPct: pct(k), turn: t.turns }] }), true);
        bump(d.id, t => ({ ...t, downedBy: [...t.downedBy, k.id] }));
      }
      break;
  }
  return moved ? rows.map(b => map.get(b.id)!) : [...rows];
}
