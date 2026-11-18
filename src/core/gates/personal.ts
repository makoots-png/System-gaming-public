// personal.ts: a hunter's personal gates, the System's (`Hunter.solo`, notes-2-solo.md section 3): what one is, its
// clock, the boundary that reads them from a save or a pushed sheet, whether the clock may run for a hunter, and when it
// next has something to do. Pure, and light on imports, since save.ts reads a hunter through it. What opens, closes and
// runs them is gates/solo.ts.
import { RANKS } from '../rules.ts';
import type { Rank } from '../rules.ts';
import { oneOf } from '../one-of.ts';
import { compareTimes, timeOf } from '../day.ts';
import { parseSaveId, saveId } from '../ids.ts';
import type { MonsterId, PersonalGateId } from '../ids.ts';
import type { Hunter, Save } from '../save.ts';

/** One line of a personal gate's roster: `count` of one built-in monster (a seed id). */
export type PersonalLine = { readonly monsterId: MonsterId; readonly count: number };
// ── a personal gate ──
/** A gate the System opened for one hunter: its built-in monsters (seed ids and counts), when it opened and when it closes. */
export type PersonalGate = {
  readonly id: PersonalGateId; readonly name: string; readonly rank: Rank; readonly monsters: readonly PersonalLine[]; readonly at: string; readonly closesAt: string;
};
/** The System's clock for one hunter: off (it spawns nothing and arms no timer), or on with the time of its next spawn. */
export type SoloClock = { readonly at: 'off' } | { readonly at: 'on'; readonly next: string };
/** A hunter's personal gates and their clock. */
export type Solo = { readonly clock: SoloClock; readonly gates: readonly PersonalGate[] };
export const newSolo = (): Solo => ({ clock: { at: 'off' }, gates: [] });

/** At most this many kinds of monster on a personal gate's roster (spawn.ts `MAX_KINDS` makes at most 3). */
const ROSTER_MAX = 3, NAME_MAX = 60;
/** The bounds of a stored or pushed `Hunter.solo` (notes-2-solo.md 10): at most 10 gates (`SOLO_BOUNDS.held`), each roster bounded. */
export const SOLO_PARSE = { gates: 10, roster: ROSTER_MAX, count: 12, name: NAME_MAX } as const;

type Rec = Record<string, unknown>;
const isObj = (v: unknown): v is Rec => v !== null && typeof v === 'object' && !Array.isArray(v);
/** A personal gate id: a save id of prefix `pg`. */
export const parsePersonalGateId = (v: unknown): PersonalGateId | null => { const id = parseSaveId<'pg'>(v); return id && id.startsWith('pg') ? id : null; };

/**
 * A hunter's `solo` from outside data (a save, a pushed sheet), bounded: a clock that does not read is off; a gate needs
 * its id, times and at least one roster line of a monster id with a count of 1 to `SOLO_PARSE.count`; at most
 * `SOLO_PARSE.gates`, the newest kept.
 */
export function parseSolo(v: unknown): Solo {
  if (!isObj(v)) return newSolo();
  const c = isObj(v.clock) ? v.clock : {}, next = c.at === 'on' ? timeOf(c.next) : null;
  const clock: SoloClock = next ? { at: 'on', next } : { at: 'off' };
  const gates: PersonalGate[] = [];
  for (const raw of Array.isArray(v.gates) ? v.gates : []) {
    if (!isObj(raw)) continue;
    const id = parsePersonalGateId(raw.id), at = timeOf(raw.at), closesAt = timeOf(raw.closesAt);
    const monsters = (Array.isArray(raw.monsters) ? raw.monsters : []).flatMap((m): PersonalLine[] => {
      const mid = isObj(m) && typeof m.monsterId === 'string' && m.monsterId.length > 0 && m.monsterId.length <= 80 ? (m.monsterId as MonsterId) : null;
      const n = isObj(m) && typeof m.count === 'number' && Number.isInteger(m.count) ? Math.max(1, Math.min(SOLO_PARSE.count, m.count)) : 1;
      return mid ? [{ monsterId: mid, count: n }] : [];
    }).slice(0, SOLO_PARSE.roster);
    if (!id || !at || !closesAt || !monsters.length || gates.some(g => g.id === id)) continue;
    gates.push({ id, name: typeof raw.name === 'string' ? raw.name.slice(0, NAME_MAX) || 'Gate' : 'Gate', rank: oneOf(raw.rank, RANKS, 'E'), monsters, at, closesAt });
  }
  return { clock, gates: gates.slice(-SOLO_PARSE.gates) };
}

/**
 * Whether the System's clock may run for `h`: not the starter hunter before setup, not a dead hunter (its clock goes
 * off, so a revived one gets a gate at once), and on a GM's phone only a hunter that has completed a daily (the NPCs
 * and pregens nobody trains with, as quests.ts `tracked` rules for the penalty).
 */
export const soloTracked = (h: Pick<Hunter, 'seed' | 'life' | 'daily'>, gm: boolean): boolean =>
  h.seed !== true && h.life.at !== 'dead' && (!gm || !!h.daily.lastCompleteKey);

/**
 * When the System's clock next has something to do, in ms: now for a hunter whose clock is off and may run (a new
 * hunter, one revived, personal gates turned back on), a running clock's next spawn, a held gate's close. Null for none.
 * `may`: whether personal gates are on (the rules, with the room's switch) and the phone is the GM's (`soloTracked`).
 */
export function soloWake(save: Pick<Save, 'hunters'>, nowMs: number, may: { readonly personal: boolean; readonly gm: boolean }): number | null {
  const times = save.hunters.flatMap(h => [
    ...(h.solo.clock.at === 'on' ? [Date.parse(h.solo.clock.next)] : may.personal && soloTracked(h, may.gm) ? [nowMs] : []),
    ...h.solo.gates.map(g => Date.parse(g.closesAt)),
  ]);
  return times.length ? Math.min(...times) : null;
}

/** A personal gate's id made from a number. */
export const personalGateId = (n: number): PersonalGateId => saveId('pg', n);
/** Personal gates in the order they close, soonest first (the Gates view's order). */
export const byClosing = (list: readonly PersonalGate[]): PersonalGate[] => [...list].sort((a, b) => compareTimes(a.closesAt, b.closesAt));
