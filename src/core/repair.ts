// repair.ts: how a stored object is read back, the tools of the save's repair (save.ts) and of a hunter's (hunter/hunter.ts).
// Each object is filled by its default ("fill by example": a missing or wrongly typed field takes the default's value)
// and then the typed fields are clamped and checked. Keys the types do not know are kept as they are, because the
// untyped view modules still stash fields of their own on these objects and dropping them would lose that data. The
// repair works in place and returns the object it was given: views hold on to a hunter between updates, so the object
// must stay the same one. One run (`RepairRun`) claims every id once and notes the entities whose id must be replaced,
// each with the hunter that holds it, so the save's repair can point that hunter's references at the new ids.
// Pure, and a leaf of the save: it imports nothing that reads a save.

import { SAVE_ID_RE } from './ids.ts';
import type { DeviceId } from './ids.ts';
import { parseItem } from './registry/items.ts';
import type { Item } from './registry/items.ts';
import { parseSkill } from './registry/skills.ts';
import type { Skill } from './registry/skills.ts';
import { MAX_MAPS } from './registry/maps.ts';
import type { Rules } from './rules.ts';
import type { Hunter } from './hunter/hunter.ts';

/** What a read needs from outside: the clock, and the makers of this phone's device id and device token (random, the edge's). */
export type ParseEnv = { now: Date; newDeviceId: () => DeviceId; newDeviceToken: () => string };

/** Bounds for junk or hostile saves only. GM rules (loadoutCap, path tiers) never prune saved data. */
export const LIMITS = { loadouts: 24, picks: 12, libraryItems: 200, libraryStatuses: 200, librarySkills: 200, libraryRewards: 200, libraryMaps: MAX_MAPS, libraryFeats: 100, libraryStories: 30, boons: 50 } as const;

export type Rec = Record<string, unknown>;
export const isObj = (v: unknown): v is Rec => v !== null && typeof v === 'object' && !Array.isArray(v);
export const isStr = (v: unknown): v is string => typeof v === 'string';
export const isNum = (v: unknown): v is number => Number.isFinite(v);
export const isBool = (v: unknown): v is boolean => typeof v === 'boolean';
export function num(v: unknown, fallback: number, lo = -Infinity, hi = Infinity): number {
  const n = Number(v);
  return Number.isFinite(n) && v !== null && v !== '' ? Math.min(hi, Math.max(lo, n)) : fallback;
}
export const int = (v: unknown, fallback: number, lo?: number, hi?: number): number => Math.round(num(v, fallback, lo, hi));
export const str = <D extends string | null>(v: unknown, fallback: D, max = 500): string | D => (isStr(v) ? v.slice(0, max) : fallback);
export const strOrNull = (v: unknown): string | null => (isStr(v) ? v : null);
export const numOrNull = (v: unknown): number | null => (isNum(v) ? v : null);

/** Bound for junk only: the GM's max HP edit stops at 9999, and a level 9999 hunter's HP is far below this. */
export const VITAL_MAX = 1e9;
/** The largest number an id may end in. Above it `seq + 1` stops being exact, so such an id is replaced. */
export const SEQ_MAX = 1e15;
export const idNumber = (id: string): number => Number(/(\d+)$/.exec(id)?.[1] ?? 0);
/** The example save's device id: the repair makes one when the stored one does not read. */
export const NO_DEVICE = '' as DeviceId;

function fillValue(v: unknown, example: unknown): unknown {
  if (typeof example === 'number') return isNum(v) ? v : example;
  if (typeof example === 'string') return isStr(v) ? v.slice(0, 500) : example;
  if (typeof example === 'boolean') return isBool(v) ? v : example;
  if (example === null) return v === undefined ? null : v;
  if (Array.isArray(example)) return Array.isArray(v) ? v : example;
  return isObj(v) ? fill(v, example as Rec) : example;
}
/**
 * Fills `o` in place from a fresh default and returns it as that type. After it, every number, string, boolean,
 * array and object field of the default has that kind of value. Enums, nullable fields and list entries are not
 * checked yet: the caller does that next.
 */
export function fill<T extends object>(o: Rec, example: T): T {
  for (const [key, value] of Object.entries(example)) o[key] = fillValue(o[key], value);
  return o as T;
}
/** Removes an optional field whose value is not of its type. */
export function optional<T extends object>(o: T, key: keyof T & string, ok: (v: unknown) => boolean): void {
  if (key in o && !ok(o[key])) delete o[key];
}

/** An entity whose id must be replaced, the prefix of its new id, and the hunter that holds it (null: the save's own lists). */
export type BadId = [o: { id: string }, prefix: string, owner: Hunter | null];
/**
 * One repair run: the save's rules, and every id seen so far with the entities whose id must be replaced. `owner`: the
 * hunter whose lists this run is reading (hunter.ts `fixHunter` reads them with a run of its own), else null. `sheet`
 * is a hunter another phone sent: its build path is checked against that phone's rules, which this run does not have.
 */
export type RepairRun = { R: Rules; env: ParseEnv; ids: Set<string>; bad: BadId[]; owner: Hunter | null; sheet?: true };

/** A list of entities: drops what is not an object, fills defaults, and notes a missing or repeated id for a new one. */
export function list<T extends { id: string }>(run: RepairRun, value: unknown, prefix: string, example: () => T, fix?: (o: T) => void): T[] {
  return (Array.isArray(value) ? value : []).filter(isObj).map(raw => {
    const o = fill(raw, example());
    if (fix) fix(o);
    claimId(run, o, prefix);
    return o;
  });
}
/** Keeps a good id, or notes a malformed or repeated one for a new id. */
export function claimId(run: RepairRun, o: { id: string }, prefix: string): void {
  if (!SAVE_ID_RE.test(o.id) || idNumber(o.id) > SEQ_MAX || run.ids.has(o.id)) run.bad.push([o, prefix, run.owner]); else run.ids.add(o.id);
}

/**
 * Empties `raw` and fills it with `t` and an id (its own, else `defaultId`), noting a bad id for a new one. The object
 * stays the same one, because a view may hold it between updates.
 */
export function refill<T extends { id: string }>(run: RepairRun, raw: Rec, t: Omit<T, 'id'>, defaultId: string, prefix: string): T {
  const id = isStr(raw.id) ? raw.id : defaultId;
  for (const key of Object.keys(raw)) delete raw[key];
  const o = Object.assign(raw, t, { id }) as unknown as T;
  claimId(run, o, prefix);
  return o;
}
/** Saved items, each read by `parseItem`; one it refuses (no name) is dropped, one without an id takes the default's. */
export const items = (run: RepairRun, value: unknown): Item[] =>
  (Array.isArray(value) ? value : []).filter(isObj).flatMap(raw => { const t = parseItem(raw); return t ? [refill<Item>(run, raw, t, 'i0', 'i')] : []; });
/** Saved skills, each read by `parseSkill`; one it refuses (no name) is dropped, one without an id takes the default's. */
export const skills = (run: RepairRun, value: unknown): Skill[] =>
  (Array.isArray(value) ? value : []).filter(isObj).flatMap(raw => { const t = parseSkill(raw); return t ? [refill<Skill>(run, raw, t, 's0', 's')] : []; });
