// save-step.ts: the one shape of a change to the save, and the pieces that aim a change at one part of it.
//
// A view changes the save only with `store.apply(reason, step)` (src/edge/store.ts). A step is a pure function: it is
// given the save and answers the next save, or a refusal (`{ ok: false, why }`) that leaves the save as it was. The
// rule lives in the function a step calls, in the core module that owns that state (docs/guide/makers.md, "A view's write to the save").
// The store then writes the answer into the live save with `writeInto`, repairs it, stores it and announces it.
//
// `writeInto` keeps every object that an id still names: a hunter, an item or a quest the view holds stays the live
// one after the write, so a view that kept `h` reads the new values, as it did when it changed `h` in place. A record
// without an id (a hunter's `life`) is replaced, as an assignment replaced it.
// A step copies what it changes and shares the rest; one that moves an object to another key or list copies it there.
import type { Hunter, Library, Save, Settings, SyncSettings } from './save.ts';

/** A change that did not happen, and why. A step answers it instead of throwing; the save is not touched. */
export type Refused<W extends string = string> = { readonly ok: false; readonly why: W };
export const refuse = <W extends string>(why: W): Refused<W> => ({ ok: false, why });
/** Whether a step's answer is a refusal. A part of the save never holds `ok: false`, so the two cannot be confused. */
export const isRefused = (v: unknown): v is Refused =>
  v !== null && typeof v === 'object' && (v as { ok?: unknown }).ok === false && typeof (v as { why?: unknown }).why === 'string';

/**
 * The why of a refusal its writer told the player already: the fight's news for a command the fight or the store refused,
 * the toast that the GM's fight holds a hunter. An api member whose own path tells a refusal answers it, so its caller
 * reads every answer the same way; `ui.wrote` (src/views/ui.js) says nothing more of it.
 */
export const TOLD = 'told';
/** A pure change of a value: the next value or a refusal. */
export type Step<T> = (value: T) => T | Refused;
/** What `store.apply` answers: done, or the step's refusal. */
export type Applied = { readonly ok: true } | Refused;
/** What a write answers when it was done: `store.apply`'s, and an api member's that wrote another way (the fight's command). */
export const WROTE: Applied = { ok: true };

/** A step on the save that changes one hunter by its id. A hunter that is not there is refused (`no-hunter`). */
export const atHunter = (hid: string, f: Step<Hunter>): Step<Save> => save => {
  const at = save.hunters.findIndex(h => h.id === hid);
  if (at < 0) return refuse('no-hunter');
  const next = f(save.hunters[at]!);
  if (isRefused(next)) return next;
  return { ...save, hunters: save.hunters.map((h, i) => (i === at ? next : h)) };
};
/** A step on the save that changes the GM's library. */
export const atLibrary = (f: Step<Library>): Step<Save> => save => {
  const next = f(save.library);
  return isRefused(next) ? next : { ...save, library: next };
};
/** A step on the save that changes the settings. */
export const atSettings = (f: Step<Settings>): Step<Save> => save => {
  const next = f(save.settings);
  return isRefused(next) ? next : { ...save, settings: next };
};
/** A step on the save's sync settings. */
export const atSync = (f: (s: SyncSettings) => SyncSettings) => <S extends Pick<Save, 'settings'>>(save: S): S => {
  const next = f(save.settings.sync);
  return next === save.settings.sync ? save : { ...save, settings: { ...save.settings, sync: next } };
};
/** Steps run one after another; the first refusal stops them and nothing of the earlier ones is kept. */
export const both = <T>(...steps: Step<T>[]): Step<T> => value => {
  let cur = value;
  for (const s of steps) {
    const next = s(cur);
    if (isRefused(next)) return next;
    cur = next;
  }
  return cur;
};

/** A step whose refusal leaves the value as it was: for a part of a change that may do nothing without stopping the rest. */
export const orKeep = <T>(f: Step<T>): ((value: T) => T) => value => {
  const next = f(value);
  return isRefused(next) ? value : next;
};

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => v !== null && typeof v === 'object' && !Array.isArray(v);
const idOf = (v: unknown): unknown => (isRec(v) ? v.id : undefined);

/**
 * Makes `target` deep-equal to `next` in place. An object or array inside `target` that `next` keeps (the same object,
 * or for an array element one with the same `id`) is written into rather than replaced, so references to it stay live.
 * A key `next` does not have is deleted. `next` may share objects with `target` (a step copies only what it changes):
 * a part that is the same object is left alone.
 *
 * An array element is the same thing as an old one only when it is that object or has its `id`. An element without an
 * id that is not kept is new: its place in the list says nothing, since a step that puts an element before it moves
 * every one after, and writing it into the old element at its place would change an element `next` still holds there
 * or a part a changed copy of it shares (audit BUG-sync-1).
 */
export function writeInto<T extends object>(target: T, next: T): void {
  writeAny(target as Rec | unknown[], next as Rec | unknown[]);
}
function writeAny(target: Rec | unknown[], next: Rec | unknown[]): void {
  if (target === next) return;
  if (Array.isArray(target) && Array.isArray(next)) {
    const byId = new Map<unknown, unknown>();
    for (const old of target) if (idOf(old) !== undefined) byId.set(idOf(old), old);
    const live = new Set<unknown>(target);
    const out = next.map(n => {
      if (live.has(n)) return n; // kept or moved within the list: written into nothing, so a reorder corrupts no element
      return mergeValue(idOf(n) !== undefined ? byId.get(idOf(n)) : undefined, n);
    });
    target.length = 0;
    target.push(...out);
    return;
  }
  if (isRec(target) && isRec(next)) {
    for (const key of Object.keys(target)) if (!(key in next)) delete target[key];
    for (const key of Object.keys(next)) target[key] = mergeValue(target[key], next[key]);
  }
}
/**
 * The value to store where `old` was. A list, and a thing with the same `id` (a hunter, an item, a quest), is `old`
 * itself written into, so a view that holds it reads the new values. A record without an id (a hunter's `life`, its
 * `equipped`, the settings) is a value: a new record, as an assignment made it, so a view that kept the old one to
 * compare with still holds the old values; what it holds is merged the same way. Anything else is a copy of `next`, so
 * the save never shares an object with something outside it (a built-in list a step started from).
 */
function mergeValue(old: unknown, next: unknown): unknown {
  if (old === next) return old;
  if (Array.isArray(old) && Array.isArray(next)) { writeAny(old, next); return old; }
  if (isRec(old) && isRec(next)) {
    if (idOf(next) !== undefined && idOf(old) === idOf(next)) { writeAny(old, next); return old; }
    if (idOf(next) === undefined && idOf(old) === undefined) return Object.fromEntries(Object.keys(next).map(k => [k, mergeValue(old[k], next[k])]));
  }
  return next !== null && typeof next === 'object' ? JSON.parse(JSON.stringify(next)) : next;
}
