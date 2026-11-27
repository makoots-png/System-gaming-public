// pack.ts: a pack, the GM's custom content as it leaves one phone and arrives on another. `packOf` makes one from a
// save (everything, one kind or one entry, with the statuses its entries name), `parsePack` reads one from outside
// data through each kind's parser, and `mergePack` merges one into a save with Add (keep both) or Replace (same key or
// name). Where an entry names a status is each kind's walk in `STATUS_REFS` (status-refs.ts): `packOf` lists the
// statuses with it and `mergePack` renames them with it. Pure: the code a pack travels as (compression, base64url) is
// src/edge/pack-code.ts.
// A new kind of custom content gets its list in `Pack`, `PACK_KINDS`, `PACK_WORDS` and `PACK_CAP`, its walk in
// `STATUS_REFS`, its line in `packOf`, `parsePack` and `mergePack`, and a case in tests/pack.test.ts.
import { FEAT_BOUNDS, parseFeat } from './hunter/feats.ts';
import type { FeatDef } from './hunter/feats.ts';
import { newFeatKey, saveFeat } from './library.ts';
import { isRefused } from './save-step.ts';
import { parseFeatKey } from './ids.ts';
import { freeStatusKey, isStatusKey } from './combat/effect-ops.ts';
import type { StatusDef, StatusKey } from './combat/effect-ops.ts';
import { battleMap, bundle, feat, item, monster, namedIn, npc, rekeyed, skill, statusDef, story } from './status-refs.ts';
import type { Walk } from './status-refs.ts';
import { parseStatusDef } from './combat/fight-parse.ts';
import { isStateChip } from './hunter/chips.ts';
import { parseItemDef } from './registry/item-book.ts';
import type { ItemDefData } from './registry/item-book.ts';
import { ITEM_BOUNDS } from './registry/items.ts';
import { catalogOfItemDefId, customItemDefId, isBuiltInItemId, isCustomItemDefId, parseItemDefId } from './ids.ts';
import type { ItemDefId } from './ids.ts';
import * as ITEM_REFS from './item-refs.ts';
import { parseMonster } from './registry/monsters.ts';
import type { MonsterTemplate } from './registry/monsters.ts';
import { NPC_BOUNDS, parseNpc } from './registry/npcs.ts';
import type { Npc, NpcTemplate } from './registry/npcs.ts';
import { parseSkill } from './registry/skills.ts';
import type { SkillTemplate } from './registry/skills.ts';
import { BUILT_IN_STATUSES } from './registry/statuses.ts';
import { mapId, parseBattleMap } from './registry/maps.ts';
import type { BattleMap } from './registry/maps.ts';
import { parseBundle } from './rewards.ts';
import type { RewardBundle } from './rewards.ts';
import { RULES } from './rules.ts';
import { LIMITS, SCHEMA } from './save.ts';
import type { Library, Monster, Save, Skill } from './save.ts';
import { STORY_BOUNDS, parseStory } from './story/story.ts';
import type { Story, StoryTemplate } from './story/story.ts';

/** In the Workshop's order. */
export const PACK_KINDS = ['statuses', 'items', 'skills', 'monsters', 'npcs', 'rewards', 'maps', 'feats', 'stories'] as const;
export type PackKind = (typeof PACK_KINDS)[number];
/** Each kind's words where a pack is shared or read (io.js): one, more than one, and its heading. The typecheck asks for a new kind's. */
export const PACK_WORDS: { readonly [K in PackKind]: readonly [one: string, many: string, heading: string] } = {
  statuses: ['status', 'statuses', 'Statuses'], items: ['item', 'items', 'Items'], skills: ['skill', 'skills', 'Skills'],
  monsters: ['monster', 'monsters', 'Monsters'], npcs: ['NPC', 'NPCs', 'NPCs'], rewards: ['bundle', 'bundles', 'Bundles'], maps: ['map', 'maps', 'Maps'],
  feats: ['feat', 'feats', 'Feats'], stories: ['story', 'stories', 'Stories'],
};
export type BundleTemplate = Omit<RewardBundle, 'id'>;
export type MapTemplate = Omit<BattleMap, 'id'>;
/** The content of a pack, each entry as its kind's parser gave it back, without ids. Statuses keep their keys. */
export type Pack = {
  /** Item defs by id: a built-in's edit (`b:*`), or a custom item (`c:*`) under the catalog it was made in, rekeyed at merge. */
  statuses: Record<string, StatusDef>; items: Record<ItemDefId, ItemDefData>; skills: SkillTemplate[]; rewards: BundleTemplate[]; monsters: MonsterTemplate[];
  npcs: NpcTemplate[];
  maps: MapTemplate[];
  /** The GM's feats by key (hunter/feats.ts); a key travels, so a hunter keeps its progress on a feat two tables share. */
  feats: Record<string, FeatDef>;
  stories: StoryTemplate[];
};
/** A pack as it is written to a file or a code. A part with nothing in it is left out. */
export type PackDoc = {
  schema: typeof SCHEMA; kind: 'library'; savedAt: string;
  library: {
    statuses?: Record<string, StatusDef>; items?: Record<ItemDefId, ItemDefData>; skills?: SkillTemplate[]; rewards?: BundleTemplate[]; maps?: MapTemplate[]; feats?: Record<string, FeatDef>;
    stories?: StoryTemplate[]; npcs?: NpcTemplate[];
  };
  monsters?: MonsterTemplate[];
};
/**
 * The most of each kind a pack holds and a save keeps after a merge: the library's limits. A save does not bound its
 * monsters; a merge stops adding at 200, as many as each library list holds.
 */
export const PACK_CAP: Readonly<Record<PackKind, number>> = {
  statuses: LIMITS.libraryStatuses, items: LIMITS.libraryItems, skills: LIMITS.librarySkills, rewards: LIMITS.libraryRewards, monsters: 200,
  npcs: LIMITS.libraryNpcs, maps: LIMITS.libraryMaps, feats: LIMITS.libraryFeats,
  stories: LIMITS.libraryStories,
};

type Rec = Record<string, unknown>;
const isObj = (v: unknown): v is Rec => v !== null && typeof v === 'object' && !Array.isArray(v);
const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const newPack = (): Pack => ({ statuses: {}, items: {}, skills: [], rewards: [], monsters: [], npcs: [], maps: [], feats: {}, stories: [] });
const each = <T>(f: (k: PackKind) => T): Record<PackKind, T> => Object.fromEntries(PACK_KINDS.map(k => [k, f(k)])) as Record<PackKind, T>;

/** How many of a pack's entries are in it. */
export const packCounts = (p: Pack): Record<PackKind, number> => each(k => (k === 'statuses' || k === 'feats' || k === 'items' ? Object.keys(p[k]).length : p[k].length));

// ── statuses named by an entry ──
/** One entry of a kind, as a pack carries it. */
type PackEntry<K extends PackKind> = Pack[K] extends readonly (infer E)[] ? E : Pack[K] extends Record<string, infer V> ? V : never;
/** Where each kind's entry names statuses: its walk (status-refs.ts), read to list them and to rename them. */
const STATUS_REFS: { readonly [K in PackKind]: Walk<PackEntry<K>> } = {
  statuses: statusDef, items: item, skills: skill, rewards: bundle, monsters: monster, npcs: npc, maps: battleMap, feats: feat, stories: story,
};

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
  const itemIds = new Set<ItemDefId>(!wants('items') ? [] : id === null ? Object.keys(L.items) as ItemDefId[] : Object.hasOwn(L.items, id) ? [id as ItemDefId] : []);
  const skills = pick('skills', L.skills), rewards = pick('rewards', L.rewards), monsters = pick('monsters', save.monsters);
  const npcs = pick('npcs', L.npcs), maps = pick('maps', L.maps), stories = pick('stories', L.stories);
  const statusKeys = new Set<string>(!wants('statuses') ? [] : id === null ? Object.keys(L.statuses) : Object.hasOwn(L.statuses, id) ? [id] : []);
  const featKeys = !wants('feats') ? [] : id === null ? Object.keys(L.feats) : Object.hasOwn(L.feats, id) ? [id] : [];
  const named = new Set<StatusKey>(), R = STATUS_REFS;
  for (const k of featKeys) namedIn(R.feats, L.feats[k]!, named);
  // a custom item an entry gives travels with it, so the pack stands alone (item-refs.ts names where an id sits)
  const givenIds = new Set<ItemDefId>(), I = ITEM_REFS;
  for (const k of featKeys) I.namedIn(I.feat, L.feats[k]!, givenIds);
  rewards.forEach(b => I.namedIn(I.bundle, b, givenIds)); monsters.forEach(m => I.namedIn(I.monster, m, givenIds)); stories.forEach(st => I.namedIn(I.story, st, givenIds));
  for (const g of givenIds) if (isCustomItemDefId(g) && Object.hasOwn(L.items, g)) itemIds.add(g);
  const items = [...itemIds].map(k => L.items[k]!);
  items.forEach(i => namedIn(R.items, i, named)); skills.forEach(k => namedIn(R.skills, k, named));
  rewards.forEach(b => namedIn(R.rewards, b, named)); monsters.forEach(m => namedIn(R.monsters, m, named)); npcs.forEach(n => namedIn(R.npcs, n, named)); maps.forEach(m => namedIn(R.maps, m, named));
  stories.forEach(s => namedIn(R.stories, s, named));
  for (const k of statusKeys) namedIn(R.statuses, L.statuses[k]!, named);
  // a status named by a status that joins: follow until nothing new joins
  const queue = [...named];
  while (queue.length) {
    const k = queue.pop()!;
    if (statusKeys.has(k) || !Object.hasOwn(L.statuses, k)) continue;
    statusKeys.add(k);
    const more = new Set<StatusKey>(); namedIn(R.statuses, L.statuses[k]!, more); queue.push(...more);
  }
  const library: PackDoc['library'] = {};
  if (statusKeys.size) library.statuses = Object.fromEntries(Object.keys(L.statuses).filter(k => statusKeys.has(k)).map(k => [k, copy(L.statuses[k]!)]));
  if (itemIds.size) library.items = Object.fromEntries([...itemIds].map(k => [k, copy(L.items[k]!)]));
  // A skill is a template and an id (skills.ts), so without its id it is its template; `Omit` of a union loses that.
  if (skills.length) library.skills = skills.map(k => noId(k) as SkillTemplate);
  if (rewards.length) library.rewards = rewards.map(noId);
  if (maps.length) library.maps = maps.map(noId);
  if (featKeys.length) library.feats = Object.fromEntries(featKeys.map(k => [k, copy(L.feats[k]!)]));
  if (stories.length) library.stories = stories.map(noId);
  if (npcs.length) library.npcs = npcs.map(noId);
  const doc: PackDoc = { schema: SCHEMA, kind: 'library', savedAt, library };
  if (monsters.length) doc.monsters = monsters.map(noId);
  return doc;
}

// ── reading a pack ──
/** Of a kind's entries in the data: kept, refused by the parser (`unreadable`), and past the pack's cap (`over`). */
export type KindCount = { kept: number; unreadable: number; over: number };
export type PackRead =
  | { ok: true; pack: Pack; counts: Record<PackKind, KindCount> }
  | { ok: false; why: 'not-a-pack' | 'newer' | 'older' };

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
 * A pack read from outside data. Not a pack: anything but an object whose `kind` is 'library' and whose `schema` is a
 * positive integer. Newer: its schema is above this app's. Older: its schema is below this app's. Each entry is read by
 * its kind's parser (`parseStatusDef` with the shipped rules' dice limits, under a key `STATUS_KEY_RE` accepts that is
 * not a hunter's state chip, `parseItemDef` under a key `parseItemDefId` reads, `parseSkill`, `parseBundle`, `parseMonster`, `parseBattleMap`, `parseFeat`,
 * `parseStory`); one it refuses is counted unreadable, and entries past `PACK_CAP` are counted over. A missing or
 * wrongly typed part holds nothing.
 */
export function parsePack(v: unknown): PackRead {
  if (!isObj(v) || v.kind !== 'library') return { ok: false, why: 'not-a-pack' };
  if (typeof v.schema !== 'number' || !Number.isInteger(v.schema) || v.schema < 1) return { ok: false, why: 'not-a-pack' };
  if (v.schema > SCHEMA) return { ok: false, why: 'newer' };
  if (v.schema < SCHEMA) return { ok: false, why: 'older' };
  const lib = isObj(v.library) ? v.library : {};
  const counts = each((): KindCount => ({ kept: 0, unreadable: 0, over: 0 }));
  const pack = newPack();
  for (const [key, raw] of Object.entries(isObj(lib.statuses) ? lib.statuses : {})) {
    const c = counts.statuses;
    if (c.kept >= PACK_CAP.statuses) { c.over++; continue; }
    const def = isStatusKey(key) && !isStateChip(key) ? parseStatusDef(raw, RULES, key) : null;
    if (def) { pack.statuses[key] = def; c.kept++; } else c.unreadable++;
  }
  for (const [key, raw] of Object.entries(isObj(lib.items) ? lib.items : {})) {
    const c = counts.items;
    if (c.kept >= PACK_CAP.items) { c.over++; continue; }
    const k = parseItemDefId(key), def = k ? parseItemDef(raw) : null;
    if (k && def) { pack.items[k] = def; c.kept++; } else c.unreadable++;
  }
  pack.skills = readList(lib.skills, PACK_CAP.skills, parseSkill, counts.skills);
  pack.rewards = readList(lib.rewards, PACK_CAP.rewards, parseBundle, counts.rewards);
  pack.monsters = readList(v.monsters, PACK_CAP.monsters, parseMonster, counts.monsters);
  pack.npcs = readList(lib.npcs, PACK_CAP.npcs, parseNpc, counts.npcs);
  pack.maps = readList(lib.maps, PACK_CAP.maps, x => { const m = parseBattleMap(x, RULES); return m && noId(m); }, counts.maps);
  for (const [key, raw] of Object.entries(isObj(lib.feats) ? lib.feats : {})) {
    const c = counts.feats;
    if (c.kept >= PACK_CAP.feats) { c.over++; continue; }
    const def = parseFeatKey(key) ? parseFeat(raw) : null;
    if (def) { pack.feats[key] = def; c.kept++; } else c.unreadable++;
  }
  pack.stories = readList(lib.stories, PACK_CAP.stories, parseStory, counts.stories);
  return { ok: true, pack, counts };
}

// ── merging a pack ──
export type MergeMode = 'add' | 'replace';
/** What a merge did with each kind: entries added (`renamed` of them under a number suffix), replaced, and left out because the list was full. */
export type KindMerge = { added: number; renamed: number; replaced: number; full: number };
export type MergeTarget = Pick<Save, 'library' | 'monsters' | 'seq'>;
/** What a merge mints: the stamp of a custom item's new id (16 random characters at the edge, ids.ts `ITEM_STAMP_LEN`). */
export type MintStamp = () => string;
export type Merged<S extends MergeTarget = Save> = { save: S; report: Record<PackKind, KindMerge> };

/** `name` with the first number suffix from 2 that `taken` does not hold, cut to `max` characters: "Frostbite 2". */
function suffixed(name: string, max: number, taken: (n: string) => boolean): string {
  for (let n = 2; ; n++) {
    const suf = ` ${n}`, out = name.slice(0, max - suf.length).trimEnd() + suf;
    if (!taken(out)) return out;
  }
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
  for (const k of placed) out[k] = rekeyed(STATUS_REFS.statuses, out[k]!, map);
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
 * The library's feats after a merge, each written by the library's own step (`saveFeat`): a built-in as it shipped leaves
 * no entry, and a feat past the cap is counted full. Replace: a feat overwrites the library's under the same key (a
 * built-in's key holds an edit of that built-in). Add: a feat whose key the library holds arrives as "Name 2" under a key
 * no feat holds (`newFeatKey`). A feat keeps `off`, so a table's set-up arrives with the same feats turned off. Its
 * reward names a status a merge renamed by its new key.
 */
function mergeFeats(have: Library, incoming: Record<string, FeatDef>, map: ReadonlyMap<string, StatusKey>, mode: MergeMode, count: KindMerge): Record<string, FeatDef> {
  let lib = have;
  for (const [key, raw] of Object.entries(incoming)) {
    const exists = Object.hasOwn(lib.feats, key), renamed = exists && mode === 'add';
    const name = renamed ? suffixed(raw.name, FEAT_BOUNDS.name, n => Object.values(lib.feats).some(d => d.name === n)) : raw.name;
    const at = renamed ? newFeatKey(lib, name) : key;
    const next = saveFeat(lib, at, { ...rekeyed(STATUS_REFS.feats, raw, map), name });
    if (isRefused(next)) { count.full++; continue; }
    if (exists && !renamed) count.replaced++;
    else if (Object.hasOwn(next.feats, at)) { count.added++; if (renamed) count.renamed++; }
    lib = next;
  }
  return lib.feats;
}

/**
 * The library's item defs after a merge, and the new id of each pack item that moved. A built-in's edit is laid over the
 * library's (Add and Replace alike: there is one built-in). A custom item becomes one of `catalog`'s: Replace overwrites
 * the library's custom item of the same name and takes its id; Add, or no such item, gives it a new id under `catalog`
 * (`mint`), its name suffixed when the library holds it ("Rift Fang 2"). A pack item of this catalog that the library
 * does not hold keeps its id. With no catalog (`null`), custom items cannot be minted and are counted full.
 */
function mergeItems(have: Record<ItemDefId, ItemDefData>, incoming: Record<ItemDefId, ItemDefData>, catalog: Library['catalogId'], mode: MergeMode, mint: MintStamp, count: KindMerge) {
  const out: Record<ItemDefId, ItemDefData> = { ...have }, map = new Map<ItemDefId, ItemDefId>();
  const customNames = (): Map<string, ItemDefId> => new Map(Object.entries(out).filter(([k]) => isCustomItemDefId(k as ItemDefId)).map(([k, d]) => [d.name.toLowerCase(), k as ItemDefId]));
  for (const [key, def] of Object.entries(incoming) as [ItemDefId, ItemDefData][]) {
    if (isBuiltInItemId(key)) {
      const exists = Object.hasOwn(out, key);
      if (!exists && Object.keys(out).length >= PACK_CAP.items) { count.full++; continue; }
      out[key] = def; if (exists) count.replaced++; else count.added++;
      continue;
    }
    if (catalog === null) { count.full++; continue; }
    const names = customNames(), same = names.get(def.name.toLowerCase());
    if (mode === 'replace' && same) { out[same] = def; map.set(key, same); count.replaced++; continue; }
    if (Object.keys(out).length >= PACK_CAP.items) { count.full++; continue; }
    const keep = catalogOfItemDefId(key) === catalog && !Object.hasOwn(out, key);
    const nid = keep ? key : customItemDefId(catalog, mint());
    const name = names.has(def.name.toLowerCase()) ? suffixed(def.name, ITEM_BOUNDS.name, n => names.has(n.toLowerCase())) : def.name;
    if (name !== def.name) count.renamed++;
    out[nid] = { ...def, name }; map.set(key, nid); count.added++;
  }
  return { items: out, map };
}

/**
 * `target`'s library and monsters with `pack` merged in, and what was done with each kind. Statuses go first, so an
 * item, skill, bundle or monster that names a pack status Add renamed names it under its new key; one that names a status
 * the pack does not hold is kept as it is (its op may carry its own def). Items go next (`mergeItems`), so a bundle, a
 * monster's loot, a feat or a story that gives a pack item gives it under its new id. New ids continue `target.seq`. The caps of
 * `PACK_CAP` hold: what does not fit is counted in `full`. Replace run twice with the same pack changes nothing the
 * second time. `target` is not changed.
 */
export function mergePack<S extends MergeTarget>(target: S, pack: Pack, mode: MergeMode, mint: MintStamp): Merged<S> {
  const report = each((): KindMerge => ({ added: 0, renamed: 0, replaced: 0, full: 0 }));
  let seq = target.seq;
  const id = (prefix: string) => () => `${prefix}${++seq}`;
  const p = copy(pack), L = copy(target.library);
  const { statuses, map } = mergeStatuses(L.statuses, p.statuses, mode, report.statuses);
  const R = STATUS_REFS;
  const merged = mergeItems(L.items, Object.fromEntries(Object.entries(p.items).map(([k, d]) => [k, rekeyed(R.items, d, map)])), L.catalogId, mode, mint, report.items);
  const moved = (x: ItemDefId): ItemDefId => merged.map.get(x) ?? x, I = ITEM_REFS;
  p.rewards = p.rewards.map(b => I.bundle(b, moved)); p.monsters = p.monsters.map(m => I.monster(m, moved)); p.stories = p.stories.map(st => I.story(st, moved));
  p.feats = Object.fromEntries(Object.entries(p.feats).map(([k, d]) => [k, I.feat(d, moved)]));
  const library: Library = {
    statuses,
    items: merged.items,
    catalogId: L.catalogId,
    skills: mergeNamed<Skill>(L.skills, p.skills.map(k => rekeyed(R.skills, k, map)), mode, PACK_CAP.skills, 60, id('s'), report.skills),
    rewards: mergeNamed<RewardBundle>(L.rewards, p.rewards.map(b => rekeyed(R.rewards, b, map)), mode, PACK_CAP.rewards, 60, id('rb'), report.rewards),
    maps: mergeNamed<BattleMap>(L.maps, p.maps.map(m => rekeyed(R.maps, m, map)), mode, PACK_CAP.maps, 40, () => mapId(id('mp')()), report.maps),
    feats: mergeFeats(L, p.feats, map, mode, report.feats),
    stories: mergeNamed<Story>(L.stories, p.stories.map(s => rekeyed(R.stories, s, map)), mode, PACK_CAP.stories, STORY_BOUNDS.name, id('st'), report.stories),
    npcs: mergeNamed<Npc>(L.npcs, p.npcs.map(n => rekeyed(R.npcs, n, map)), mode, PACK_CAP.npcs, NPC_BOUNDS.name, id('npc_'), report.npcs),
  };
  const monsters = mergeNamed<Monster>(copy(target.monsters), p.monsters.map(m => rekeyed(R.monsters, m, map)), mode, PACK_CAP.monsters, 60, id('m'), report.monsters);
  const out = { ...target, library, monsters, seq };
  const isFullSave = (s: MergeTarget): s is Save => 'heardItems' in s && 'hunters' in s && 'settings' in s;
  return { save: (isFullSave(out) ? I.heardStep(out) : out) as S, report };
}
