// loadouts.ts: a hunter's saved gear sets (`hunter.loadouts`): save the gear worn as a set, overwrite, rename, delete,
// and swap a set back on. The Loadouts panel (custom.js) changes them only here, as steps. Pure: the caller passes the
// rules (the slots and the cap), the id a new set gets and whether the hunter is in a fight (the fight's row holds the
// sheet it started with, so gear does not change there).
import { RULES } from '../rules.ts';
import type { Rules } from '../rules.ts';
import { LIMITS, SLOTS } from '../save.ts';
import type { Hunter, Loadout, Save } from '../save.ts';
import { isRefused, refuse } from '../save-step.ts';
import type { Refused } from '../save-step.ts';
import { saveId } from '../ids.ts';
import type { LoadoutId } from '../ids.ts';
import { fits, wearSet, wornOf } from './inventory.ts';

/** Whether an item can be worn in a slot; inventory.ts owns it, and the Loadouts panel (custom.js) reads it here. */
export { fits };

/** How long a set's name may be. */
export const LOADOUT_NAME_MAX = 24;
export type LoadoutWhy = 'full' | 'missing' | 'no-name' | 'in-fight';
/** What a refused change of a set says (`ui.wrote`'s words). `missing` and `no-name` are refusals the panel never offers. */
export const LOADOUT_WORDS: Readonly<Partial<Record<LoadoutWhy, string>>> = {
  full: 'Every loadout slot is taken. Delete a set first.',
  'in-fight': 'You cannot change gear during a fight.',
};

/** How many sets a hunter may save now: the rules' cap (0 or more), never above the save's limit. A lowered cap deletes none. */
export function loadoutCap(R: Rules): number {
  const c = Math.trunc(Number(R.loadoutCap));
  return Math.min(LIMITS.loadouts, Number.isFinite(c) ? Math.max(0, c) : RULES.loadoutCap);
}
/** The gear worn now (inventory.ts `wornOf`, by the rules), as a set's slots. */
const worn = (h: Hunter, R: Rules): Loadout['slots'] => {
  const slots: Loadout['slots'] = {}, now = wornOf(h, R);
  for (const s of SLOTS) { const id = now[s]; if (id) slots[s] = id; }
  return slots;
};
const atSet = (h: Hunter, id: string): number => h.loadouts.findIndex(l => l.id === id);
const withSet = (h: Hunter, at: number, l: Loadout): Hunter => ({ ...h, loadouts: h.loadouts.map((x, i) => (i === at ? l : x)) });

/** The gear worn saved as set `id` under `name` (blank: "Set n"); refused at the cap. */
export function saveLoadout(h: Hunter, id: LoadoutId, name: string, R: Rules): Hunter | Refused<LoadoutWhy> {
  if (h.loadouts.length >= loadoutCap(R)) return refuse('full');
  const l: Loadout = { id, name: name.trim().slice(0, LOADOUT_NAME_MAX) || `Set ${h.loadouts.length + 1}`, slots: worn(h, R) };
  return { ...h, loadouts: [...h.loadouts, l] };
}
/** Set `id` made to hold the gear worn now. */
export function overwriteLoadout(h: Hunter, id: string, R: Rules): Hunter | Refused<LoadoutWhy> {
  const at = atSet(h, id);
  return at < 0 ? refuse('missing') : withSet(h, at, { ...h.loadouts[at]!, slots: worn(h, R) });
}
/** Set `id` renamed; a name of spaces is refused. */
export function renameLoadout(h: Hunter, id: string, name: string): Hunter | Refused<LoadoutWhy> {
  const at = atSet(h, id), n = name.trim().slice(0, LOADOUT_NAME_MAX);
  if (at < 0) return refuse('missing');
  return n ? withSet(h, at, { ...h.loadouts[at]!, name: n }) : refuse('no-name');
}
/** Set `id` deleted. The gear stays worn. */
export function removeLoadout(h: Hunter, id: string): Hunter | Refused<LoadoutWhy> {
  return atSet(h, id) < 0 ? refuse('missing') : { ...h, loadouts: h.loadouts.filter(l => l.id !== id) };
}

/**
 * Set `lid` of hunter `hid` put on, in one step via `wearSet` in inventory.ts. A slot the set leaves empty is emptied;
 * a listed item that is there, fits and has a copy is worn (one taken off a stack becomes its own item, with an id from
 * the save's `seq`, and the set names it from then on); an item gone or unfit leaves its slot as a candidate and is
 * named in `skipped`; any item dropped by two-handed lock or `WEAR_LIMIT` is named in `left`. Refused in a fight.
 */
export function swapLoadout<S extends Pick<Save, 'hunters' | 'seq'>>(save: S, hid: string, lid: string, R: Rules, inFight: boolean): { save: S; skipped: string[]; left: string[] } | Refused<LoadoutWhy | 'no-hunter'> {
  const hi = save.hunters.findIndex(x => x.id === hid);
  if (hi < 0) return refuse('no-hunter');
  const h = save.hunters[hi]!, li = atSet(h, lid);
  if (li < 0) return refuse('missing');
  let seq = save.seq;
  const res = wearSet(h, h.loadouts[li]!.slots, () => saveId('i', ++seq), inFight, R);
  if (isRefused(res)) return res;
  const loadouts = h.loadouts.map((l, i) => (i === li ? { ...l, slots: res.slots } : l));
  const next: Hunter = { ...res.h, loadouts };
  return { save: { ...save, seq, hunters: save.hunters.map((x, i) => (i === hi ? next : x)) }, skipped: res.skipped, left: res.left };
}
