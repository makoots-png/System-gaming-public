// shadows.ts: a hunter's shadow army: a shadow made from a monster's body, summoned and dismissed, healed, renamed,
// noted and released. Pure. A view changes these only through a function here, in `store.apply`
// (src/core/save-step.ts). In a fight the fight writes a shadow's HP back (`setShadowHp`, from fight-save.ts).
//
// Summoning costs mana (`summonMp` of the shadow's rank in the rules, taken by the view through app.api.hunter) and
// dismissing gives none back: summon then dismiss leaves the army as it was and the hunter that mana poorer.
//
// A shadow's life is a machine: resting (in the army, not summoned), summoned, released (gone for good). `TABLE` says
// which event each state takes; `stepShadow` is the one way to move it (docs/state-machines.md, "A shadow").
import type { Rank, Save, Shadow, ShadowGrade } from '../save.ts';
import { record } from './chronicle.ts';
import { told } from '../session-log.ts';
import type { Stamp } from '../session-log.ts';
import type { Archetype, MonsterKind } from './derive.ts';
import { hunterSheet } from './sheet.ts';
import type { SheetHunter, SheetRules } from './sheet.ts';
import type { ExtractionOutcome } from '../combat/extraction.ts';
import { shadowSheet } from '../combat/rows.ts';
import type { RowRules } from '../combat/rows.ts';
import { isRefused, refuse } from '../save-step.ts';
import type { Refused } from '../save-step.ts';
import { cleanName } from './record.ts';
import { rankIdx } from '../rules.ts';
import type { MonsterId, ShadowId } from '../ids.ts';

type Army = { shadows: Shadow[] };
/** What a shadow is made from: its body (rank, archetype, grade), the monster it was, and a name. */
export type ShadowOrigin = { rank: Rank; archetype: Archetype; grade: ShadowGrade; monster: MonsterId | null; name: string };

/** A new shadow under `id`, at the full HP its body gives, not summoned. A blank name is "Shadow". */
export const newShadowOf = (o: ShadowOrigin, id: ShadowId, R: RowRules): Shadow =>
  ({ id, name: cleanName(o.name) || 'Shadow', monster: o.monster, rank: o.rank, archetype: o.archetype, grade: o.grade, hp: shadowSheet(o, R).hpMax, summoned: false, notes: '' });
/** How many shadows the hunter's army holds at most: its sheet's shadow capacity. */
export const armyCap = (h: SheetHunter, R: SheetRules): number => Math.max(0, hunterSheet(h, R).sheet.shadows);
/** A shadow joins the army; at its cap (`armyCap`) it is refused (`army-full`), whatever the view showed. */
export const addShadow = <H extends Army & SheetHunter>(h: H, s: Shadow, R: SheetRules): H | Refused<'army-full'> =>
  h.shadows.length >= armyCap(h, R) ? refuse('army-full') : { ...h, shadows: [...h.shadows, s] };
/**
 * A shadow risen from `o` joins hunter `hid`'s army under `id`, with its session log line, in one step: an extraction or
 * the GM's grant on this phone, and the room's `shadow` message on a player's phone (the GM's phone rolled it). Refused
 * `army-full` at the army's cap, `no-hunter` when the save holds no such hunter.
 */
export function shadowRises<S extends Pick<Save, 'hunters' | 'log' | 'seq'>>(save: S, hid: string, o: ShadowOrigin, id: ShadowId, stamp: Stamp, R: RowRules & SheetRules): S | Refused<'army-full' | 'no-hunter'> {
  const at = save.hunters.findIndex(h => h.id === hid);
  if (at < 0) return refuse('no-hunter');
  const h = save.hunters[at]!, made = newShadowOf(o, id, R), next = addShadow(h, made, R);
  if (isRefused(next)) return next;
  // a shadow risen for this hunter is a fact of its chronicle (chronicle.ts)
  const risen = record(next, { kind: 'shadow', name: made.name });
  return told({ ...save, hunters: save.hunters.map((x, i) => (i === at ? risen : x)) }, stamp,
    { kind: 'system', hunterId: h.id, title: 'Shadow extraction', text: `${made.name} (${made.grade}) joins the shadow army.` });
}

/** The grade a fallen monster of each kind rises as (rows.ts `SHADOW_KINDS` gives each grade its body). */
const RISES_AS: { readonly [K in MonsterKind]: ShadowGrade } = { boss: 'Knight', elite: 'Elite', normal: 'Normal' };
export const risesAs = (kind: MonsterKind): ShadowGrade => RISES_AS[kind];
/** One extraction roll against `dc`: a natural 1 crumbles the corpse, a natural 20 or a total of `dc` or more raises the shadow, else it fails. */
export const extractOutcome = (roll: { readonly natural: number; readonly total: number }, dc: number): ExtractionOutcome =>
  roll.natural === 1 ? 'crumbled' : roll.natural === 20 || roll.total >= dc ? 'risen' : 'failed';

const change = <H extends Army>(h: H, sid: string, f: (s: Shadow) => Shadow): H | Refused<'no-shadow'> =>
  h.shadows.some(s => s.id === sid) ? { ...h, shadows: h.shadows.map(s => (s.id === sid ? f(s) : s)) } : refuse('no-shadow');

// ── the machine ──
export const SHADOW_STATES = ['resting', 'summoned', 'released'] as const;
export type ShadowState = (typeof SHADOW_STATES)[number];
export const SHADOW_EVENTS = ['summon', 'dismiss', 'release'] as const;
export type ShadowEvent = (typeof SHADOW_EVENTS)[number];
/** The state each event leads to, or null where it does not apply. A released shadow takes none. */
const TABLE: { readonly [S in ShadowState]: { readonly [E in ShadowEvent]: ShadowState | null } } = {
  resting: { summon: 'summoned', dismiss: null, release: 'released' },
  summoned: { summon: null, dismiss: 'resting', release: 'released' },
  released: { summon: null, dismiss: null, release: null },
};
/** The state of the shadow `sid` in the army: released when it is not there. */
export const shadowState = (h: Army, sid: string): ShadowState => {
  const s = h.shadows.find(x => x.id === sid);
  return !s ? 'released' : s.summoned ? 'summoned' : 'resting';
};
/** The state `event` leads to from `state`, or null. */
export const transition = (state: ShadowState, event: ShadowEvent): ShadowState | null => TABLE[state][event];
/** Whether the shadow `sid` takes `event` now: the view shows Summon or Dismiss by it. */
export const can = (h: Army, sid: string, event: ShadowEvent): boolean => transition(shadowState(h, sid), event) !== null;
/** Moves the shadow `sid` by `event`; an event its state does not take is refused (`not-now`). */
export function stepShadow<H extends Army>(h: H, sid: string, event: ShadowEvent): H | Refused<'not-now'> {
  const to = transition(shadowState(h, sid), event);
  if (to === null) return refuse('not-now');
  if (to === 'released') return { ...h, shadows: h.shadows.filter(s => s.id !== sid) };
  return { ...h, shadows: h.shadows.map(s => (s.id === sid ? { ...s, summoned: to === 'summoned' } : s)) };
}
/** Its HP as a fight leaves it: the fight's `shadowHp` write-back (src/core/combat/fight-save.ts). */
export const setShadowHp = <H extends Army>(h: H, sid: string, hp: number): H | Refused<'no-shadow'> => change(h, sid, s => ({ ...s, hp }));
/** HP back to the full HP its body gives. */
export const healShadow = <H extends Army>(h: H, sid: string, R: RowRules): H | Refused<'no-shadow'> => change(h, sid, s => ({ ...s, hp: shadowSheet(s, R).hpMax }));
/** A new name; a blank one is refused (`blank`). */
export function renameShadow<H extends Army>(h: H, sid: string, name: string): H | Refused<'no-shadow' | 'blank'> {
  const n = String(name ?? '').trim().slice(0, 60);
  return n ? change(h, sid, s => ({ ...s, name: n })) : refuse('blank');
}
/** The GM's notes, at most 500 characters. */
export const noteShadow = <H extends Army>(h: H, sid: string, notes: string): H | Refused<'no-shadow'> => change(h, sid, s => ({ ...s, notes: String(notes ?? '').slice(0, 500) }));

/**
 * The DC to extract a shadow from a fallen foe of rank `foe` and kind `kind` for a hunter of rank `hunter`: the rules'
 * base, a step for each rank the foe is above the hunter (below, a step less), a boss's extra, never under `dcMin`.
 */
export function extractDc(hunter: Rank, foe: Rank, kind: string, R: { readonly dcBase: number; readonly dcPerRank: number; readonly bossDc: number; readonly dcMin: number }): number {
  return Math.max(R.dcMin, R.dcBase + R.dcPerRank * (rankIdx(foe) - rankIdx(hunter)) + (kind === 'boss' ? R.bossDc : 0));
}
