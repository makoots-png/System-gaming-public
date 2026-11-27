// library.ts: the GM's library of custom content (`save.library`): its statuses and feats by key, and its items, skills,
// maps and stories as lists of named entries, each list at most its cap in LIMITS (save.ts). The makers (forge.js,
// loot.js, skills.js, map-maker.js) and the Workshop (workshop.js) change the library only through these, as
// `atLibrary` steps (save-step.ts). Pure: the caller passes the id a new entry gets (`store.id`), and the entry as its
// kind's parser gave it. A refusal is `{ ok: false, why }`; nothing is half changed. A pack merged into the library is
// `mergePack` (pack.ts).
import { FEAT_BOUNDS, freeFeatKey, sameFeat } from './hunter/feats.ts';
import type { FeatDef, FeatKey } from './hunter/feats.ts';
import { BUILT_IN_FEATS } from './registry/feats.ts';
import { LIMITS, savedItemBook } from './save.ts';
import type { Hunter, Library, Save, StatusDef } from './save.ts';
import { isRunning } from './story/run.ts';
import { isBuiltInItemId, isCustomItemDefId } from './ids.ts';
import type { ItemDefId, StoryId } from './ids.ts';
import type { CatalogDoc } from './protocol.ts';
import { isShippedItemDef } from './registry/item-book.ts';
import type { HeldItem, ItemDefData } from './registry/item-book.ts';
import { bagEdit } from './hunter/inventory.ts';
import type { BagEditWhy, BagSeat } from './hunter/inventory.ts';
import { fitted } from './hunter/sheet.ts';
import { fightHold } from './combat/fight-save.ts';
import { NO_TABLE } from './sync/fight-heard.ts';
import { heardStep } from './item-refs.ts';
import { rulesOf, withItems } from './rules.ts';
import type { Rules } from './rules.ts';
import { refuse } from './save-step.ts';
import type { Refused } from './save-step.ts';

/** The library's lists of named entries, and the cap of each. Its items are a book by id (`saveItemDef`). */
export const LIBRARY_LISTS = { skills: LIMITS.librarySkills, maps: LIMITS.libraryMaps, stories: LIMITS.libraryStories } as const;
export type LibraryList = keyof typeof LIBRARY_LISTS;
type Entry<L extends LibraryList> = Library[L][number];

/** Why the library refused a change. `full`: the list is at its cap. `missing`: no entry has that id or key. */
export type LibraryWhy = 'full' | 'missing';
type Next = Library | Refused<LibraryWhy>;

/** What the library keeps, as a maker names it: one, many, and how many the library holds. */
const KEPT = {
  item: { one: 'item', many: 'items', cap: LIMITS.libraryItems },
  skill: { one: 'skill', many: 'skills', cap: LIMITS.librarySkills },
  map: { one: 'map', many: 'maps', cap: LIMITS.libraryMaps },
  story: { one: 'story', many: 'stories', cap: LIMITS.libraryStories },
  status: { one: 'status', many: 'statuses', cap: LIMITS.libraryStatuses },
  feat: { one: 'feat', many: 'feats', cap: LIMITS.libraryFeats },
  bundle: { one: 'bundle', many: 'bundles', cap: LIMITS.libraryRewards },
} as const;
/**
 * What a maker says when the library refuses to save its `kind` named `name` (`ui.wrote`'s words): the list is at its
 * cap (`full`), another entry holds the name (`taken`, from `saveEntry` and rewards.ts `saveBundle`), or no name (`blank`).
 */
export const savedWords = (kind: keyof typeof KEPT, name: string): Readonly<Record<'full' | 'taken' | 'blank', string>> => ({
  full: `Your library can store at most ${KEPT[kind].cap} ${KEPT[kind].many}. Delete one in the Workshop first.`,
  taken: `You already have ${kind === 'item' ? 'an' : 'a'} ${KEPT[kind].one} named "${name}" in your library. Rename this one, or edit the existing one in the Workshop.`,
  blank: `Name the ${KEPT[kind].one}.`,
});

const withList = <L extends LibraryList>(lib: Library, list: L, next: readonly Entry<L>[]): Library => ({ ...lib, [list]: next });

/** The entry of `entries` whose name is `name` in any case, other than the one of id `exceptId`; null when there is none. */
export const namedLike = <E extends { readonly id: string; readonly name: string }>(entries: readonly E[], name: string, exceptId: string | null): E | null =>
  entries.find(x => x.id !== exceptId && x.name.toLowerCase() === name.toLowerCase()) ?? null;

/**
 * A named entry saved to `list` by its id: the entry with that id is replaced (an edit keeps its id, a rename too), else
 * it is added, refused when the list is full (`full`). A name another entry holds in any case is refused (`taken`), so
 * a save never replaces another entry the GM did not open; the maker says so (implicit audit 3, W1: a new item or skill
 * of a name the library held replaced that entry with no question).
 */
export function saveEntry<L extends LibraryList>(lib: Library, list: L, entry: Entry<L>): Next | Refused<'taken'> {
  const arr = lib[list] as readonly Entry<L>[];
  if (namedLike(arr, entry.name, entry.id)) return refuse('taken');
  return saveById(lib, list, entry);
}

/** An entry saved by its id: the one with that id is replaced, else it is added, refused when the list is full. */
export function saveById<L extends LibraryList>(lib: Library, list: L, entry: Entry<L>): Next {
  const arr = lib[list] as readonly Entry<L>[], at = arr.findIndex(x => x.id === entry.id);
  if (at < 0 && arr.length >= LIBRARY_LISTS[list]) return refuse('full');
  return withList(lib, list, at >= 0 ? arr.map((x, i) => (i === at ? entry : x)) : [...arr, entry]);
}

/** The entry `id` of `list` taken out. */
export function removeEntry(lib: Library, list: LibraryList, id: string): Next {
  const arr = lib[list] as readonly Entry<LibraryList>[];
  if (!arr.some(x => x.id === id)) return refuse('missing');
  return withList(lib, list, arr.filter(x => x.id !== id));
}

// ── items: the GM's defs by id (item sync, PR 2) ──
/** Whether hunter `h` wears a bag line referencing def `id` (raw slots cover both before and after a slot-removing edit). */
function wearsDef(h: Hunter, id: ItemDefId): boolean {
  const eq = new Set(Object.values(h.equipped));
  return h.items.some(x => x.kind === 'ref' && x.defId === id && eq.has(x.id));
}
/**
 * Local hunters wearing def `id` and not held in a fight, re-fitted under the save's updated item defs: lowering a worn
 * item's bonus, removing its slot, or making a worn weapon two-handed clamps HP, mana and fatigue to the new maxima.
 * A hunter held in a fight keeps its vitals owned by the fight.
 */
function fitWearers(save: Save, id: ItemDefId, R: Rules): Save {
  if (!save.hunters.some(h => wearsDef(h, id))) return save;
  const nextR = withItems(R, savedItemBook(save));
  let changed = false;
  const hunters = save.hunters.map(h => {
    if (!wearsDef(h, id)) return h;
    if (fightHold(save.fight, { hid: h.id }, { seat: 'alone', key: null, ...NO_TABLE }) !== null) return h;
    changed = true;
    return fitted(h, nextR);
  });
  return changed ? { ...save, hunters } : save;
}
/**
 * Item def `id` saved in the library as `def`: the one writer of `library.items` (with `removeItemDef` and the rekeys
 * of item-refs.ts). A built-in's id holds an edit of it while it differs from the shipped def; saved as shipped it
 * leaves the library, so an untouched built-in saved in the item maker leaves no entry. A custom id holds the GM's own
 * item: a name another custom item holds in any case is refused (`taken`), a new one past `LIMITS.libraryItems`
 * (`full`). The library's def wins over one this phone heard, so `heardStep` drops that one, and any local hunter
 * wearing `id` outside a fight is re-fitted to the updated def (`fitWearers`).
 */
export function saveItemDef(save: Save, id: ItemDefId, def: ItemDefData, R: Rules): Save | Refused<LibraryWhy | 'taken'> {
  const items = save.library.items, has = Object.hasOwn(items, id);
  if (isBuiltInItemId(id)) {
    if (isShippedItemDef(id, def, R)) {
      if (!has) return save;
      const { [id]: _same, ...rest } = items;
      return fitWearers({ ...save, library: { ...save.library, items: rest } }, id, R);
    }
  } else if (Object.entries(items).some(([k, d]) => k !== id && isCustomItemDefId(k as ItemDefId) && d.name.toLowerCase() === def.name.toLowerCase())) {
    return refuse('taken');
  }
  if (!has && Object.keys(items).length >= LIMITS.libraryItems) return refuse('full');
  return fitWearers(heardStep({ ...save, library: { ...save.library, items: { ...items, [id]: def } } }), id, R);
}
/**
 * The Bag's Edit of bag line `held`'s def, for every copy (`saveItemDef`): refused `not-yours` unless the phone owns the
 * def where it sits (inventory.ts `bagEdit` answers `def`), so a player in a room never turns a GM's item into its own.
 */
export function editHeldDef(save: Save, held: HeldItem, def: ItemDefData, seat: BagSeat, R: Rules): Save | Refused<LibraryWhy | 'taken' | BagEditWhy> {
  if (held.kind !== 'ref' || bagEdit(held, seat, save.library.catalogId) !== 'def') return refuse('not-yours');
  return saveItemDef(save, held.defId, def, R);
}
/**
 * Item def `id` taken out of the library: a built-in's edit undone (the shipped def is back), a custom item deleted.
 * A deleted custom item that a hunter, the stash, the shop or a reward still names keeps its def in `heardItems`
 * (item-refs.ts `heardStep`), so it keeps working for its holder and reads the same on every phone. Its id leaves the
 * shop, and resetting a built-in re-fits local wearers outside a fight (`fitWearers`). Refused (`missing`) when the
 * library holds no such def.
 */
export function removeItemDef(save: Save, id: ItemDefId, R?: Rules): Save | Refused<LibraryWhy> {
  if (!Object.hasOwn(save.library.items, id)) return refuse('missing');
  const { [id]: def, ...rest } = save.library.items;
  const next: Save = { ...save, library: { ...save.library, items: rest }, shop: save.shop === null ? null : save.shop.filter(x => x !== id) };
  const after = heardStep(next, isCustomItemDefId(id) && def ? { [id]: def } : {});
  return isBuiltInItemId(id) ? fitWearers(after, id, R ?? rulesOf(after.rulesOverrides, after.library.statuses, savedItemBook(after))) : after;
}
/** What the Workshop says before an item def leaves the library. */
export const ITEM_DEL_WORDS = {
  del: 'Hunters who hold it keep it, and it still works for them.',
  reset: 'Every copy goes back to the built-in item as it shipped.',
} as const;
/** The library's custom item named `name` in any case, other than `exceptId`; null when there is none. */
export const itemNamedLike = (lib: Library, name: string, exceptId: ItemDefId | null): ItemDefId | null =>
  (Object.entries(lib.items).find(([k, d]) => k !== exceptId && isCustomItemDefId(k as ItemDefId) && d.name.toLowerCase() === name.toLowerCase())?.[0] as ItemDefId | undefined) ?? null;

/**
 * Replaces this GM save's synced catalog (`library.items`, `library.statuses`, `shop`) with `doc` from the server
 * ("Use the other phone's items" on a 409 conflict). Any custom item removed from `library.items` that a hunter, stash,
 * or reward still names is preserved in `heardItems` via `heardStep`, and non-held local hunters are re-fitted to the
 * adopted defs.
 */
export function adoptCatalogDoc(save: Save, doc: CatalogDoc): Save {
  const dropped: Record<ItemDefId, ItemDefData> = {};
  for (const [k, def] of Object.entries(save.library.items) as [ItemDefId, ItemDefData][]) {
    if (isCustomItemDefId(k) && !Object.hasOwn(doc.items, k)) dropped[k] = def;
  }
  const replaced: Save = {
    ...save,
    library: { ...save.library, items: { ...doc.items }, statuses: { ...doc.statuses } },
    shop: doc.shop === null ? null : [...doc.shop],
  };
  const after = heardStep(replaced, dropped);
  const nextR = rulesOf(after.rulesOverrides, after.library.statuses, savedItemBook(after));
  let changed = false;
  const hunters = after.hunters.map(h => {
    if (fightHold(after.fight, { hid: h.id }, { seat: 'alone', key: null, ...NO_TABLE }) !== null) return h;
    const f = fitted(h, nextR);
    if (f.mana !== h.mana || f.fatigue !== h.fatigue || f.collapsed !== h.collapsed || f.life.at !== h.life.at || (f.life.at === 'up' && h.life.at === 'up' && f.life.hp !== h.life.hp)) {
      changed = true;
      return f;
    }
    return h;
  });
  return changed ? { ...after, hunters } : after;
}

/**
 * Story `id` taken out of the library, as a step on the whole save: refused while a run of it is running (`running`), so
 * a story on the table is never deleted under the GM (the Workshop says to end it first). An ended run keeps its name.
 */
export function removeStory(save: Save, id: StoryId): Save | Refused<LibraryWhy | 'running'> {
  if (isRunning(save.storyRuns, id)) return refuse('running');
  const lib = removeEntry(save.library, 'stories', id);
  return 'ok' in lib ? lib : { ...save, library: lib };
}

/** A copy of entry `id` of `list` under `newId` and `name`, at the end of the list; refused when the list is full. */
export function duplicateEntry<L extends LibraryList>(lib: Library, list: L, id: string, copy: { newId: string; name: string }): Next {
  const arr = lib[list] as readonly Entry<L>[], src = arr.find(x => x.id === id);
  if (!src) return refuse('missing');
  if (arr.length >= LIBRARY_LISTS[list]) return refuse('full');
  return withList(lib, list, [...arr, { ...src, id: copy.newId, name: copy.name } as Entry<L>]);
}

/** The status `key` saved as `def`: one with that key is replaced, else it is added, refused at `LIMITS.libraryStatuses`. */
export function saveStatus(lib: Library, key: string, def: StatusDef): Next {
  if (!Object.hasOwn(lib.statuses, key) && Object.keys(lib.statuses).length >= LIMITS.libraryStatuses) return refuse('full');
  return { ...lib, statuses: { ...lib.statuses, [key]: def } };
}

/** The status `key` taken out of the library (a built-in's key: the built-in is back). */
export function removeStatus(lib: Library, key: string): Next {
  if (!Object.hasOwn(lib.statuses, key)) return refuse('missing');
  const { [key]: _gone, ...rest } = lib.statuses;
  return { ...lib, statuses: rest };
}

/** The built-in feat under `key` as it shipped, or null for a key that is not a built-in's. */
const shippedFeat = (key: string): FeatDef | null => BUILT_IN_FEATS.find(([k]) => k === key)?.[1] ?? null;
/** A key for a new feat named `name` that no feat of the library and no built-in holds (`freeFeatKey`). */
export const newFeatKey = (lib: Library, name: string): FeatKey => freeFeatKey(name, k => Object.hasOwn(lib.feats, k) || shippedFeat(k) !== null);
/** `def` turned on: without `off`. */
const onOf = (def: FeatDef): Omit<FeatDef, 'off'> => { const { off: _off, ...on } = def; return on; };

/**
 * The feat `key` saved in the library as `def` (a built-in's key holds an edit of it, or its turning off; any other key a
 * GM's own), refused past the cap. A built-in's entry that equals the feat as it shipped leaves the library, so the
 * library holds a built-in's key only while it differs, and the Workshop lists it with the built-ins again. The one
 * writer of a library feat: the maker, the Workshop's steps and a pack's merge (`mergePack`) all go through it.
 */
export function saveFeat(lib: Library, key: string, def: FeatDef): Next {
  const shipped = shippedFeat(key);
  if (shipped && sameFeat(def, shipped)) { const { [key]: _same, ...rest } = lib.feats; return { ...lib, feats: rest }; }
  if (!Object.hasOwn(lib.feats, key) && Object.keys(lib.feats).length >= LIMITS.libraryFeats) return refuse('full');
  return { ...lib, feats: { ...lib.feats, [key]: def } };
}
/** The feat `key` taken out of the library (a built-in's key: the built-in is back as it shipped). */
export function removeFeat(lib: Library, key: string): Next {
  if (!Object.hasOwn(lib.feats, key)) return refuse('missing');
  const { [key]: _gone, ...rest } = lib.feats;
  return { ...lib, feats: rest };
}
/**
 * Feat `key` turned off, a built-in (changed or not) or the GM's own: nothing counts toward it on any phone, and its
 * edits stay. Refused for a key no feat has (`missing`) and for a feat already off (`unchanged`).
 */
export function featOff(lib: Library, key: string): Next | Refused<'unchanged'> {
  const def = lib.feats[key] ?? shippedFeat(key);
  if (!def) return refuse('missing');
  if (def.off) return refuse('unchanged');
  return saveFeat(lib, key, { ...def, off: true });
}
/**
 * Feat `key` turned on again, its edits kept; a built-in that is then as it shipped leaves the library (`saveFeat`).
 * Refused for a key the library lacks (`missing`) and for a feat that is on (`unchanged`). `featOff` undone exactly.
 */
export function featOn(lib: Library, key: string): Next | Refused<'unchanged'> {
  const def = lib.feats[key];
  if (!def) return refuse('missing');
  if (!def.off) return refuse('unchanged');
  return saveFeat(lib, key, onOf(def));
}
/**
 * A copy of feat `key` (the library's, or a built-in as it shipped) as a GM's own feat, on whether or not the feat it
 * copies is off: "(copy)" after its name within `FEAT_BOUNDS.name`, under a key no feat holds. Refused past the cap.
 */
export function duplicateFeat(lib: Library, key: string): Next {
  const def = lib.feats[key] ?? shippedFeat(key);
  if (!def) return refuse('missing');
  const names = [...Object.values(lib.feats), ...BUILT_IN_FEATS.map(([, d]) => d)].map(d => d.name);
  const name = copyName(def.name, names, FEAT_BOUNDS.name);
  return saveFeat(lib, newFeatKey(lib, name), { ...onOf(def), name });
}

/**
 * The name a copy is given: "(copy)" after the name, then "(copy 2)", "(copy 3)" and on, the first that no name of
 * `taken` is in any case; cut to `max` characters. The one copy-name rule for every kind of entry (W1: it was made four
 * ways).
 */
export function copyName(name: string, taken: readonly string[], max: number): string {
  const used = new Set(taken.map(t => t.toLowerCase()));
  for (let n = 1; ; n++) {
    const tail = n === 1 ? ' (copy)' : ` (copy ${n})`, copy = `${name.slice(0, Math.max(0, max - tail.length))}${tail}`;
    if (!used.has(copy.toLowerCase())) return copy;
  }
}
