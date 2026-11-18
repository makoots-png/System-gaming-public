// pack.ts: a pack, the GM's custom content as it leaves one phone and arrives on another. `packOf` makes one from a
// save (everything, one kind or one entry, with the statuses its entries name), `parsePack` reads one from outside
// data through each kind's parser, and `mergePack` merges one into a save with Add (keep both) or Replace (same key or
// name). Pure: the code a pack travels as (compression, base64url) is src/edge/pack-code.ts.
// A new kind of custom content gets its list in `Pack`, `PACK_KINDS` and `PACK_CAP`, its line in `packOf`, `parsePack`
// and `mergePack`, and a case in tests/pack.test.ts.
import { FEAT_BOUNDS, freeFeatKey, parseFeat } from './hunter/feats.ts';
import type { FeatDef } from './hunter/feats.ts';
import { parseFeatKey } from './ids.ts';
import { freeStatusKey, isStatusKey } from './combat/effect-ops.ts';
import type { LandOp, Op, StatusDef, StatusKey, UseOp } from './combat/effect-ops.ts';
import type { Ability } from './combat/ability-types.ts';
import { parseStatusDef } from './combat/fight-parse.ts';
import { isStateChip } from './hunter/chips.ts';
import { parseItem } from './registry/items.ts';
import type { ItemTemplate } from './registry/items.ts';
import { parseMonster } from './registry/monsters.ts';
import type { MonsterTemplate } from './registry/monsters.ts';
import { parseSkill } from './registry/skills.ts';
import type { SkillTemplate } from './registry/skills.ts';
import { BUILT_IN_STATUSES } from './registry/statuses.ts';
import { mapId, parseBattleMap } from './registry/maps.ts';
import type { BattleMap } from './registry/maps.ts';
import { parseBundle } from './rewards.ts';
import type { RewardBundle, Rewards } from './rewards.ts';
import { RULES } from './rules.ts';
import { LIMITS, SCHEMA } from './save.ts';
import type { Item, Library, Monster, Save, Skill } from './save.ts';

/** In the Workshop's order. */
export const PACK_KINDS = ['statuses', 'items', 'skills', 'monsters', 'rewards', 'maps', 'feats'] as const;
export type PackKind = (typeof PACK_KINDS)[number];
export type BundleTemplate = Omit<RewardBundle, 'id'>;
export type MapTemplate = Omit<BattleMap, 'id'>;
/** The content of a pack, each entry as its kind's parser gave it back, without ids. Statuses keep their keys. */
export type Pack = {
  statuses: Record<string, StatusDef>; items: ItemTemplate[]; skills: SkillTemplate[]; rewards: BundleTemplate[]; monsters: MonsterTemplate[];
  maps: MapTemplate[];
  /** The GM's feats by key (hunter/feats.ts); a key travels, so a hunter keeps its progress on a feat two tables share. */
  feats: Record<string, FeatDef>;
};
/** A pack as it is written to a file or a code. A part with nothing in it is left out. */
export type PackDoc = {
  schema: typeof SCHEMA; kind: 'library'; savedAt: string;
  library: { statuses?: Record<string, StatusDef>; items?: ItemTemplate[]; skills?: SkillTemplate[]; rewards?: BundleTemplate[]; maps?: MapTemplate[]; feats?: Record<string, FeatDef> };
  monsters?: MonsterTemplate[];
};
/**
 * The most of each kind a pack holds and a save keeps after a merge: the library's limits. A save does not bound its
 * monsters; a merge stops adding at 200, as many as each library list holds.
 */
export const PACK_CAP: Readonly<Record<PackKind, number>> = {
  statuses: LIMITS.libraryStatuses, items: LIMITS.libraryItems, skills: LIMITS.librarySkills, rewards: LIMITS.libraryRewards, monsters: 200,
  maps: LIMITS.libraryMaps, feats: LIMITS.libraryFeats,
};

type Rec = Record<string, unknown>;
const isObj = (v: unknown): v is Rec => v !== null && typeof v === 'object' && !Array.isArray(v);
const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const newPack = (): Pack => ({ statuses: {}, items: [], skills: [], rewards: [], monsters: [], maps: [], feats: {} });
const each = <T>(f: (k: PackKind) => T): Record<PackKind, T> => Object.fromEntries(PACK_KINDS.map(k => [k, f(k)])) as Record<PackKind, T>;

/** How many of a pack's entries are in it. */
export const packCounts = (p: Pack): Record<PackKind, number> => each(k => (k === 'statuses' || k === 'feats' ? Object.keys(p[k]).length : p[k].length));

// ── statuses named by an entry ──
/** Every status key the ops of a status def apply or cure, nested defs included (their triggers, threshold and end too). */
function opKeys(ops: readonly Op[], out: Set<string>): void {
  for (const o of ops) {
    if (o.op === 'applyStatus') { out.add(o.key); defKeys(o.def, out); }
    else if (o.op === 'cureStatus') out.add(o.key);
  }
}
/** Every status key a def's ops, triggers, threshold and end apply or cure (kits design 1.0: each lands ops). */
function defKeys(d: StatusDef, out: Set<string>): void {
  opKeys(d.ops, out);
  for (const t of d.triggers ?? []) opKeys(t.ops as readonly Op[], out);
  if (d.stack?.threshold) opKeys(d.stack.threshold.ops as readonly Op[], out);
  if (d.end) opKeys(d.end.ops as readonly Op[], out);
}
const itemKeys = (it: Pick<Item, 'effects' | 'worn'>, out: Set<string>): void => { opKeys(it.effects ?? [], out); if (it.worn) defKeys(it.worn, out); };
const abilityKeys = (a: Ability | null, out: Set<string>): void => { if (a) opKeys(a.ops, out); };
const skillKeys = (k: SkillTemplate, out: Set<string>): void => { if (k.type === 'active') abilityKeys(k.ability, out); else if (k.worn) defKeys(k.worn, out); };
function rewardKeys(r: Rewards, out: Set<string>): void {
  r.items.forEach(i => itemKeys(i, out)); r.skills.forEach(k => skillKeys(k, out));
  for (const s of r.statuses) { out.add(s.key); if (s.def) opKeys(s.def.ops, out); }
}
const mapKeys = (m: MapTemplate, out: Set<string>): void => m.zones.forEach(z => opKeys(z.ops, out));
function monsterKeys(m: MonsterTemplate, out: Set<string>): void {
  m.abilities.forEach(a => abilityKeys(a, out)); m.loot.items.forEach(i => itemKeys(i, out));
  for (const s of m.statuses) out.add(s.key);
}

// ── making a pack ──
const noId = <T extends { id: string }>({ id: _id, ...rest }: T): Omit<T, 'id'> => copy(rest);

/**
 * A pack of `save`'s custom content: everything, one kind, or (with `id`) one entry of that kind (a status by its key).
 * It also holds every library status its entries name, and the ones those name, so it stands alone on another phone.
 * It holds no hunter, no room, no setting: only the library and the GM's monsters.
 */
export function packOf(save: Pick<Save, 'library' | 'monsters'>, savedAt: string, kind: PackKind | 'all' = 'all', id: string | null = null): PackDoc {
  const L = save.library, wants = (k: PackKind): boolean => kind === 'all' || kind === k;
  const pick = <T extends { id: string }>(k: PackKind, list: readonly T[]): T[] => (!wants(k) ? [] : id === null ? [...list] : list.filter(x => x.id === id));
  const items = pick('items', L.items), skills = pick('skills', L.skills), rewards = pick('rewards', L.rewards), monsters = pick('monsters', save.monsters);
  const maps = pick('maps', L.maps);
  const statusKeys = new Set<string>(!wants('statuses') ? [] : id === null ? Object.keys(L.statuses) : Object.hasOwn(L.statuses, id) ? [id] : []);
  const featKeys = !wants('feats') ? [] : id === null ? Object.keys(L.feats) : Object.hasOwn(L.feats, id) ? [id] : [];
  const named = new Set<string>();
  for (const k of featKeys) rewardKeys(L.feats[k]!.rewards, named);
  items.forEach(i => itemKeys(i, named)); skills.forEach(k => skillKeys(k, named));
  rewards.forEach(b => rewardKeys(b.rewards, named)); monsters.forEach(m => monsterKeys(m, named)); maps.forEach(m => mapKeys(m, named));
  for (const k of statusKeys) { const d = L.statuses[k]; if (d) defKeys(d, named); }
  // a status named by a status that joins: follow until nothing new joins
  const queue = [...named];
  while (queue.length) {
    const k = queue.pop()!;
    if (statusKeys.has(k) || !Object.hasOwn(L.statuses, k)) continue;
    statusKeys.add(k);
    const more = new Set<string>(); defKeys(L.statuses[k]!, more); queue.push(...more);
  }
  const library: PackDoc['library'] = {};
  if (statusKeys.size) library.statuses = Object.fromEntries(Object.keys(L.statuses).filter(k => statusKeys.has(k)).map(k => [k, copy(L.statuses[k]!)]));
  if (items.length) library.items = items.map(noId);
  // A skill is a template and an id (skills.ts), so without its id it is its template; `Omit` of a union loses that.
  if (skills.length) library.skills = skills.map(k => noId(k) as SkillTemplate);
  if (rewards.length) library.rewards = rewards.map(noId);
  if (maps.length) library.maps = maps.map(noId);
  if (featKeys.length) library.feats = Object.fromEntries(featKeys.map(k => [k, copy(L.feats[k]!)]));
  const doc: PackDoc = { schema: SCHEMA, kind: 'library', savedAt, library };
  if (monsters.length) doc.monsters = monsters.map(noId);
  return doc;
}

// ── reading a pack ──
/** Of a kind's entries in the data: kept, refused by the parser (`unreadable`), and past the pack's cap (`over`). */
export type KindCount = { kept: number; unreadable: number; over: number };
export type PackRead =
  | { ok: true; pack: Pack; counts: Record<PackKind, KindCount> }
  | { ok: false; why: 'not-a-pack' | 'newer' };

function readList<T>(v: unknown, cap: number, read: (x: unknown) => T | null, count: KindCount): T[] {
  const out: T[] = [];
  for (const raw of Array.isArray(v) ? v : []) {
    if (out.length >= cap) { count.over++; continue; }
    const x = read(raw);
    if (x === null) count.unreadable++; else { out.push(x); count.kept++; }
  }
  return out;
}

/**
 * A pack read from outside data. Not a pack: anything but an object whose `kind` is 'library'. Newer: its schema is
 * above this app's. Each entry is read by its kind's parser (`parseStatusDef` with the shipped rules' dice limits, under
 * a key `STATUS_KEY_RE` accepts that is not a hunter's state chip, `parseItem`, `parseSkill`, `parseBundle`,
 * `parseMonster`, `parseBattleMap`); one it refuses is counted
 * unreadable, and entries past `PACK_CAP` are counted over. A missing or wrongly typed part holds nothing.
 */
export function parsePack(v: unknown): PackRead {
  if (!isObj(v) || v.kind !== 'library') return { ok: false, why: 'not-a-pack' };
  if (typeof v.schema === 'number' && v.schema > SCHEMA) return { ok: false, why: 'newer' };
  const lib = isObj(v.library) ? v.library : {};
  const counts = each((): KindCount => ({ kept: 0, unreadable: 0, over: 0 }));
  const pack = newPack();
  for (const [key, raw] of Object.entries(isObj(lib.statuses) ? lib.statuses : {})) {
    const c = counts.statuses;
    if (c.kept >= PACK_CAP.statuses) { c.over++; continue; }
    const def = isStatusKey(key) && !isStateChip(key) ? parseStatusDef(raw, RULES) : null;
    if (def) { pack.statuses[key] = def; c.kept++; } else c.unreadable++;
  }
  pack.items = readList(lib.items, PACK_CAP.items, parseItem, counts.items);
  pack.skills = readList(lib.skills, PACK_CAP.skills, parseSkill, counts.skills);
  pack.rewards = readList(lib.rewards, PACK_CAP.rewards, parseBundle, counts.rewards);
  pack.monsters = readList(v.monsters, PACK_CAP.monsters, parseMonster, counts.monsters);
  pack.maps = readList(lib.maps, PACK_CAP.maps, x => { const m = parseBattleMap(x, RULES); return m && noId(m); }, counts.maps);
  for (const [key, raw] of Object.entries(isObj(lib.feats) ? lib.feats : {})) {
    const c = counts.feats;
    if (c.kept >= PACK_CAP.feats) { c.over++; continue; }
    const def = parseFeatKey(key) ? parseFeat(raw) : null;
    if (def) { pack.feats[key] = def; c.kept++; } else c.unreadable++;
  }
  return { ok: true, pack, counts };
}

// ── merging a pack ──
export type MergeMode = 'add' | 'replace';
/** What a merge did with each kind: entries added (`renamed` of them under a number suffix), replaced, and left out because the list was full. */
export type KindMerge = { added: number; renamed: number; replaced: number; full: number };
export type MergeTarget = Pick<Save, 'library' | 'monsters' | 'seq'>;
export type Merged = { save: { library: Library; monsters: Monster[]; seq: number }; report: Record<PackKind, KindMerge> };

/** `name` with the first number suffix from 2 that `taken` does not hold, cut to `max` characters: "Frostbite 2". */
function suffixed(name: string, max: number, taken: (n: string) => boolean): string {
  for (let n = 2; ; n++) {
    const suf = ` ${n}`, out = name.slice(0, max - suf.length).trimEnd() + suf;
    if (!taken(out)) return out;
  }
}

/** The ops with each status key `map` holds replaced, nested defs included. */
function rekeyOps(ops: readonly Op[], map: ReadonlyMap<string, StatusKey>): Op[] {
  return ops.map(o => {
    if (o.op === 'cureStatus') return { ...o, key: map.get(o.key) ?? o.key };
    if (o.op !== 'applyStatus') return o;
    return { ...o, key: map.get(o.key) ?? o.key, def: rekeyDef(o.def, map) };
  });
}
/** A def with each status key `map` holds replaced in its ops, its triggers', its threshold's and its end's. */
function rekeyDef(d: StatusDef, map: ReadonlyMap<string, StatusKey>): StatusDef {
  const land = <T extends { readonly ops: readonly LandOp[] }>(x: T): T => ({ ...x, ops: rekeyOps(x.ops as readonly Op[], map) as LandOp[] });
  const out: StatusDef = { ...d, ops: rekeyOps(d.ops, map) };
  return {
    ...out,
    ...(d.triggers ? { triggers: d.triggers.map(land) } : {}),
    ...(d.end ? { end: land(d.end) } : {}),
    ...(d.stack ? { stack: { ...d.stack, threshold: d.stack.threshold ? land(d.stack.threshold) : null } } : {}),
  } as StatusDef;
}
/** An ability with each status key `map` holds replaced. `rekeyOps` keeps each op's kind, so its ops are still use ops. */
const rekeyAbility = (a: Ability, map: ReadonlyMap<string, StatusKey>): Ability => ({ ...a, ops: rekeyOps(a.ops, map) as UseOp[] });
const rekeyItem = <T extends Pick<Item, 'effects' | 'worn'>>(x: T, map: ReadonlyMap<string, StatusKey>): T =>
  ({ ...x, ...(x.effects ? { effects: rekeyOps(x.effects, map) } : {}), ...(x.worn ? { worn: rekeyDef(x.worn, map) } : {}) });
const rekeySkill = <T extends SkillTemplate>(k: T, map: ReadonlyMap<string, StatusKey>): T =>
  (k.type === 'active' && k.ability ? { ...k, ability: rekeyAbility(k.ability, map) } : k.type === 'passive' && k.worn ? { ...k, worn: rekeyDef(k.worn, map) } : k);
function rekeyRewards(r: Rewards, map: ReadonlyMap<string, StatusKey>): Rewards {
  return {
    ...r, items: r.items.map(i => rekeyItem(i, map)), skills: r.skills.map(k => rekeySkill(k, map)),
    statuses: r.statuses.map(s => ({ ...s, key: map.get(s.key) ?? s.key, ...(s.def ? { def: rekeyDef(s.def, map) } : {}) })),
  };
}
const rekeyMap = (m: MapTemplate, map: ReadonlyMap<string, StatusKey>): MapTemplate => ({ ...m, zones: m.zones.map(z => ({ ...z, ops: rekeyOps(z.ops, map) })) });
function rekeyMonster(m: MonsterTemplate, map: ReadonlyMap<string, StatusKey>): MonsterTemplate {
  return {
    ...m, abilities: m.abilities.map(a => rekeyAbility(a, map)), statuses: m.statuses.map(s => ({ ...s, key: map.get(s.key) ?? s.key })),
    loot: { ...m.loot, items: m.loot.items.map(i => rekeyItem(i, map)) },
  };
}

/**
 * The library statuses after a merge, and the new key of each pack status Add renamed. Add: a status whose key is in
 * the library or is a built-in's, or whose label a library or built-in status has, arrives as "Label 2" under a key
 * slugged from that label. Replace: a status overwrites the library's under the same key (a built-in key holds a
 * change to that built-in).
 */
function mergeStatuses(have: Record<string, StatusDef>, incoming: Record<string, StatusDef>, mode: MergeMode, count: KindMerge) {
  const out: Record<string, StatusDef> = { ...have }, map = new Map<string, StatusKey>();
  const builtIn: Record<string, StatusDef> = BUILT_IN_STATUSES;
  const labels = new Set([...Object.values(builtIn), ...Object.values(have)].map(d => d.label.toLowerCase()));
  const taken = new Set([...Object.keys(have), ...Object.keys(incoming)]);
  const placed: string[] = [];
  for (const [key, def] of Object.entries(incoming)) {
    const exists = Object.hasOwn(out, key);
    if (mode === 'replace' && exists) { out[key] = def; count.replaced++; placed.push(key); continue; }
    if (Object.keys(out).length >= PACK_CAP.statuses) { count.full++; continue; }
    if (mode === 'replace' || !(exists || Object.hasOwn(builtIn, key) || labels.has(def.label.toLowerCase()))) {
      out[key] = def; labels.add(def.label.toLowerCase()); count.added++; placed.push(key); continue;
    }
    const label = suffixed(def.label, 40, l => labels.has(l.toLowerCase()));
    const nkey = freeStatusKey(label, k => taken.has(k) || Object.hasOwn(builtIn, k));
    taken.add(nkey); labels.add(label.toLowerCase()); map.set(key, nkey);
    out[nkey] = { ...def, label }; count.added++; count.renamed++; placed.push(nkey);
  }
  for (const k of placed) out[k] = rekeyDef(out[k]!, map);
  return { statuses: out, map };
}

/**
 * A named list after a merge. Add: an entry whose name the list has arrives as "Name 2" under a new id. Replace: an
 * entry overwrites the list's first of the same name and keeps its id. A new entry past `cap` is counted full.
 */
function mergeNamed<T extends { id: string; name: string }>(have: readonly T[], incoming: readonly Omit<T, 'id'>[], mode: MergeMode,
  cap: number, nameMax: number, newId: () => string, count: KindMerge): T[] {
  const out = [...have];
  for (const t of incoming) {
    const at = mode === 'replace' ? out.findIndex(x => x.name === t.name) : -1;
    if (at >= 0) { out[at] = { ...t, id: out[at]!.id } as T; count.replaced++; continue; }
    if (out.length >= cap) { count.full++; continue; }
    const names = new Set(out.map(x => x.name));
    const name = names.has(t.name) ? suffixed(t.name, nameMax, n => names.has(n)) : t.name;
    if (name !== t.name) count.renamed++;
    out.push({ ...t, name, id: newId() } as T); count.added++;
  }
  return out;
}

/**
 * The library's feats after a merge. Replace: a feat overwrites the library's under the same key (a built-in's key holds
 * an edit of that built-in). Add: a feat whose key the library holds arrives as "Name 2" under a free key slugged from
 * that name; a new key past the cap is counted full. Its reward names a status a merge renamed by its new key.
 */
function mergeFeats(have: Record<string, FeatDef>, incoming: Record<string, FeatDef>, map: ReadonlyMap<string, StatusKey>, mode: MergeMode, count: KindMerge): Record<string, FeatDef> {
  const out: Record<string, FeatDef> = { ...have };
  for (const [key, raw] of Object.entries(incoming)) {
    const def = { ...raw, rewards: rekeyRewards(raw.rewards, map) };
    const exists = Object.hasOwn(out, key);
    if (mode === 'replace' && exists) { out[key] = def; count.replaced++; continue; }
    if (Object.keys(out).length >= PACK_CAP.feats) { count.full++; continue; }
    if (!exists) { out[key] = def; count.added++; continue; }
    const names = new Set(Object.values(out).map(d => d.name));
    const name = suffixed(def.name, FEAT_BOUNDS.name, n => names.has(n));
    out[freeFeatKey(name, k => Object.hasOwn(out, k))] = { ...def, name }; count.added++; count.renamed++;
  }
  return out;
}

/**
 * `target`'s library and monsters with `pack` merged in, and what was done with each kind. Statuses go first, so an
 * item, skill, bundle or monster that names a pack status Add renamed names it under its new key; one that names a status
 * the pack does not hold is kept as it is (its op may carry its own def). New ids continue `target.seq`. The caps of
 * `PACK_CAP` hold: what does not fit is counted in `full`. Replace run twice with the same pack changes nothing the
 * second time. `target` is not changed.
 */
export function mergePack(target: MergeTarget, pack: Pack, mode: MergeMode): Merged {
  const report = each((): KindMerge => ({ added: 0, renamed: 0, replaced: 0, full: 0 }));
  let seq = target.seq;
  const id = (prefix: string) => () => `${prefix}${++seq}`;
  const p = copy(pack), L = copy(target.library);
  const { statuses, map } = mergeStatuses(L.statuses, p.statuses, mode, report.statuses);
  const library: Library = {
    statuses,
    items: mergeNamed<Item>(L.items, p.items.map(i => rekeyItem(i, map)), mode, PACK_CAP.items, 60, id('i'), report.items),
    skills: mergeNamed<Skill>(L.skills, p.skills.map(k => rekeySkill(k, map)), mode, PACK_CAP.skills, 60, id('s'), report.skills),
    rewards: mergeNamed<RewardBundle>(L.rewards, p.rewards.map(b => ({ ...b, rewards: rekeyRewards(b.rewards, map) })), mode, PACK_CAP.rewards, 60, id('rb'), report.rewards),
    maps: mergeNamed<BattleMap>(L.maps, p.maps.map(m => rekeyMap(m, map)), mode, PACK_CAP.maps, 40, () => mapId(id('mp')()), report.maps),
    feats: mergeFeats(L.feats, p.feats, map, mode, report.feats),
  };
  const monsters = mergeNamed<Monster>(copy(target.monsters), p.monsters.map(m => rekeyMonster(m, map)), mode, PACK_CAP.monsters, 60, id('m'), report.monsters);
  return { save: { library, monsters, seq }, report };
}
