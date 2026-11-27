// party.ts: the hunters on this phone and which one is active. Pure. A view changes them only through a function
// here (or `createHunter` in save.ts), in `store.apply` (src/core/save-step.ts). The room's bound hunter follows a
// deleted one here, through bind.ts `rebindTo` as every rebind does (the join's time stays); the room link's own
// fields are sync.ts's.
import { newHunter } from './hunter/hunter.ts';
import type { HunterRef, SheetKey } from './ids.ts';
import type { Hunter, Save } from './save.ts';
import type { Rules } from './rules.ts';
import { atSync, refuse } from './save-step.ts';
import type { Refused } from './save-step.ts';
import { rebindTo } from './sync/bind.ts';
import { heardStep } from './item-refs.ts';

/**
 * A hunter a picker offers: this phone's or a player's (by its sheet key), the id its control carries (a hunter id or a
 * sheet key, which never look alike: a key holds a ':') and its name as its sheet holds it (the sheet's parser keeps a
 * name of 1 to 60 characters, so nothing guards it again).
 */
export type Pickable = { readonly ref: HunterRef; readonly id: string; readonly name: string };
/** This phone's hunters, then the players' sheets, as a picker lists them. */
export const pickables = (hunters: readonly Pick<Hunter, 'id' | 'name'>[], sheets: readonly { readonly key: SheetKey; readonly data: Pick<Hunter, 'name'> }[]): Pickable[] => [
  ...hunters.map((h): Pickable => ({ ref: { kind: 'local', hunterId: h.id }, id: h.id, name: h.name })),
  ...sheets.map((r): Pickable => ({ ref: { kind: 'remote', remote: r.key }, id: r.key, name: r.data.name })),
];
/** The hunter a control's id names in `list`, or null. */
export const pickedRef = (list: readonly Pickable[], id: string): HunterRef | null => list.find(p => p.id === id)?.ref ?? null;
/** The name of the player's hunter of sheet key `key`, or `none` when the room holds no sheet of it (a removed player). */
export const sheetName = (sheets: readonly { readonly key: SheetKey; readonly data: Pick<Hunter, 'name'> }[], key: string, none: string): string =>
  sheets.find(r => r.key === key)?.data.name ?? none;

/** A hunter joins the party and becomes the active one. */
export const addHunter = (save: Save, h: Hunter): Save => ({ ...save, hunters: [...save.hunters, h], settings: { ...save.settings, activeHunterId: h.id } });

/** Another hunter becomes the active one. One not in the party is refused (`no-hunter`). */
export function setActive(save: Save, hid: string): Save | Refused<'no-hunter'> {
  const h = save.hunters.find(x => x.id === hid);
  return h ? { ...save, settings: { ...save.settings, activeHunterId: h.id } } : refuse('no-hunter');
}

/**
 * A hunter leaves the party with everything it holds. The last one is replaced by `fresh` (a party is never empty);
 * the active hunter, and the room's bound hunter if it was the one deleted, become the first left.
 */
export function removeHunter(save: Save, hid: string, fresh: Hunter | null): Save | Refused<'no-hunter' | 'last'> {
  if (!save.hunters.some(h => h.id === hid)) return refuse('no-hunter');
  const left = save.hunters.filter(h => h.id !== hid);
  if (!left.length && !fresh) return refuse('last');
  const hunters = left.length ? left : [fresh!];
  const active = hunters.some(h => h.id === save.settings.activeHunterId) ? save.settings.activeHunterId : hunters[0]!.id;
  const next: Save = { ...save, hunters, settings: { ...save.settings, activeHunterId: active } };
  return heardStep(save.settings.sync.boundHunterId === hid ? atSync(sy => rebindTo(sy, active))(next) : next);
}

/** Two plain values (what a save holds: numbers, strings, lists and objects) are the same, whatever the key order. */
function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => same(x, b[i]));
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  const ka = Object.keys(a), kb = Object.keys(b) as (keyof typeof b)[];
  return ka.length === kb.length && ka.every(k => same((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}
/** What play changes on a hunter: everything but who it is (id, name, emblem, color, the seed mark), when it last changed, and the daily quest every new hunter gets with its own id and day. */
function played(h: Hunter): unknown {
  const { id: _id, name: _name, emblem: _emblem, color: _color, seed: _seed, updatedAt: _at, quests, daily, ...rest } = h;
  return { ...rest, quests: quests.filter(q => q.kind !== 'daily'), streak: daily.streak, lastCompleteKey: daily.lastCompleteKey };
}
/**
 * Whether nothing was ever played on hunter `h`: all that play changes is as `newHunter` makes it under rules `R` (no
 * level, XP, gold, stat point, item, skill, title, shadow, quest of its own, condition, note, loadout, boon, build, job
 * or lost HP). Its name is not read. The GM's Add party in a room leaves such a hunter of the GM's own phone out
 * (combat.js): the room's players bring their own.
 */
export const untouched = (h: Hunter, R: Rules): boolean => same(played(h), played(newHunter(R)));
