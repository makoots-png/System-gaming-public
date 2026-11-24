// table-news.ts: what a player's phone tells of the GM's fight, and what it has told (implicit audit 3, T2). Pure.
//
// The room's fight doc arrives again and again; a "Your turn", a refusal of this player's move, a threshold's burst and
// "Encounter cleared" are each told once, a reload included, so the phone keeps what it told in device memory (table.js,
// `store.device('table-cues')`). `toldAfter` answers the news of one doc and the record after it; the record is typed,
// one field per kind of news, each naming the fight it belongs to, so a new fight starts fresh with nothing to prune.
// "Encounter cleared" is told only for a fight this phone saw running: the record's `running` then `ended`.
import { combatantId } from './ability-types.ts';
import type { CombatantId } from './ability-types.ts';
import { tick } from './timeline.ts';
import type { Tick } from './timeline.ts';
import type { Dodge } from './space.ts';
import type { FightDoc, TableRefusal } from './fight-doc.ts';
import { fightId } from '../ids.ts';
import type { FightId } from '../ids.ts';

/** What this phone has told: the running fight it saw, the fight whose end it told, and the last turn, refusal, burst and dodge told. */
export type TableTold = {
  readonly running: FightId | null;
  readonly ended: FightId | null;
  readonly turn: { readonly fight: FightId; readonly now: Tick; readonly current: CombatantId } | null;
  readonly refused: { readonly fight: FightId; readonly at: Tick; readonly n: number } | null;
  readonly burst: { readonly fight: FightId; readonly n: number } | null;
  readonly dodge: { readonly fight: FightId; readonly n: number } | null;
};
export const NOTHING_TOLD: TableTold = { running: null, ended: null, turn: null, refused: null, burst: null, dodge: null };

/** One piece of news: this player's turn (its hunter on this phone), a dodge prompt for it, a refusal of its move, the bearers of a burst, the fight's end. */
export type TableNews =
  | { readonly kind: 'turn'; readonly hid: string }
  | { readonly kind: 'dodge'; readonly hid: string; readonly mode: Dodge; readonly ability: string | null }
  | { readonly kind: 'refused'; readonly reason: TableRefusal }
  | { readonly kind: 'burst'; readonly ids: readonly CombatantId[] }
  | { readonly kind: 'ended' };

/**
 * The news of `doc` on this phone and the record after it. `mine` says what is this player's: the hunter of the current
 * row when it is one of this phone's, whether the doc's refusal is of one of its rows, and the hunter asked to dodge
 * when it is one of this phone's. Each news is told once: a doc read again tells nothing new.
 */
export function toldAfter(doc: FightDoc, told: TableTold, mine: { readonly turn: string | null; readonly refused: boolean; readonly dodge?: string | null }): { told: TableTold; news: TableNews[] } {
  const news: TableNews[] = [];
  if (doc.ended) {
    if (told.running !== doc.id || told.ended === doc.id) return { told, news };
    return { told: { ...told, ended: doc.id }, news: [{ kind: 'ended' }] };
  }
  if (!doc.active) return { told, news };
  let next: TableTold = told.running === doc.id ? told : { ...told, running: doc.id };
  if (doc.burst && !(next.burst && next.burst.fight === doc.id && next.burst.n === doc.burst.n)) {
    next = { ...next, burst: { fight: doc.id, n: doc.burst.n } };
    news.push({ kind: 'burst', ids: doc.burst.ids });
  }
  const no = doc.refused;
  if (no && mine.refused && !(next.refused && next.refused.fight === doc.id && next.refused.at === no.at && next.refused.n === no.n)) {
    next = { ...next, refused: { fight: doc.id, at: no.at, n: no.n } };
    news.push({ kind: 'refused', reason: no.reason });
  }
  const dg = doc.dodge;
  if (dg && mine.dodge && !(next.dodge && next.dodge.fight === doc.id && next.dodge.n === dg.n)) {
    next = { ...next, dodge: { fight: doc.id, n: dg.n } };
    news.push({ kind: 'dodge', hid: mine.dodge, mode: dg.mode, ability: dg.ability });
  }
  if (mine.turn !== null && doc.currentId !== null && !(next.turn && next.turn.fight === doc.id && next.turn.now === doc.now && next.turn.current === doc.currentId)) {
    next = { ...next, turn: { fight: doc.id, now: doc.now, current: doc.currentId } };
    news.push({ kind: 'turn', hid: mine.turn });
  }
  return { told: next, news };
}

/** A stored record as `toldAfter` reads it; anything that is not one is nothing told (a first look tells what is news). */
export function parseTold(v: unknown): TableTold {
  if (typeof v !== 'object' || v === null) return NOTHING_TOLD;
  const o = v as Record<string, unknown>, str = (x: unknown): string | null => (typeof x === 'string' && x.length > 0 && x.length <= 80 ? x : null);
  const num = (x: unknown): number | null => (typeof x === 'number' && Number.isFinite(x) ? x : null);
  const rec = (x: unknown): Record<string, unknown> | null => (typeof x === 'object' && x !== null ? (x as Record<string, unknown>) : null);
  const t = rec(o.turn), r = rec(o.refused), b = rec(o.burst), d = rec(o.dodge), fight = (x: unknown): FightId | null => { const k = str(x); return k === null ? null : fightId(k); };
  const tf = t && fight(t.fight), tn = t && num(t.now), tc = t && str(t.current);
  const rf = r && fight(r.fight), ra = r && num(r.at), rn = r && num(r.n);
  const bf = b && fight(b.fight), bn = b && num(b.n);
  const df = d && fight(d.fight), dn = d && num(d.n);
  return {
    running: fight(o.running), ended: fight(o.ended),
    turn: tf && tn !== null && tc ? { fight: tf, now: tick(tn), current: combatantId(tc) } : null,
    refused: rf && ra !== null && rn !== null ? { fight: rf, at: tick(ra), n: rn } : null,
    burst: bf && bn !== null ? { fight: bf, n: bn } : null,
    dodge: df && dn !== null ? { fight: df, n: dn } : null,
  };
}
