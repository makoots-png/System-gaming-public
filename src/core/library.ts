// library.ts: the GM's library of custom content (`save.library`): its statuses by key, and its items, skills and maps
// as lists of named entries, each list at most its cap in LIMITS (save.ts). The makers (forge.js, loot.js, skills.js,
// map-maker.js) and the Workshop (workshop.js) change the library only through these, as `atLibrary` steps
// (save-step.ts). Pure: the caller passes the id a new entry gets (`store.id`), and the entry as its kind's parser gave
// it. A refusal is `{ ok: false, why }`; nothing is half changed. A pack merged into the library is `mergePack` (pack.ts).
import { LIMITS } from './save.ts';
import type { Library, StatusDef } from './save.ts';
import { refuse } from './save-step.ts';
import type { Refused } from './save-step.ts';

/** The library's lists of named entries, and the cap of each. */
export const LIBRARY_LISTS = { items: LIMITS.libraryItems, skills: LIMITS.librarySkills, maps: LIMITS.libraryMaps } as const;
export type LibraryList = keyof typeof LIBRARY_LISTS;
type Entry<L extends LibraryList> = Library[L][number];

/** Why the library refused a change. `full`: the list is at its cap. `missing`: no entry has that id or key. */
export type LibraryWhy = 'full' | 'missing';
type Next = Library | Refused<LibraryWhy>;

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
