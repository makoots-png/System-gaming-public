// item-refs.ts: every place an item def id (`ItemDefId`) sits in a save, walked by one function for each kind of thing,
// the twin of status-refs.ts. A walk takes a thing and a function of an id, and gives the thing back with each id it
// holds replaced by that function's answer. The same walk lists the ids a save names (`namedIds`, which `heardStep`
// keeps defs for) and rewrites them (`rekeyCatalog`, which an import and a pack merge use), so the list and the renaming
// cannot disagree. Pure.
//
// What the walk covers is a campaign's content: its hunters (bags, quests' rewards), the stash, the shop, the loot
// waiting, the gates' clear presets, the monsters' loot, the library's rewards, feats and stories, and the daily
// reward's override. A phone's own records (offers, asks, outbox) are this phone's and never come in a file
// (save.ts `SYNC_OWNER`): an offer's goods carry their defs whole, and `heardStep` keeps those while the offer is open.
import { catalogIdOf } from './catalog-id.ts';
import { catalogOfItemDefId, customItemDefId, isCustomItemDefId, stampOfItemDefId } from './ids.ts';
import type { CatalogId, CatalogKey, ItemDefId } from './ids.ts';
import { HEARD_MAX } from './registry/item-book.ts';
import type { HeldItem, ItemDefData, ItemGrant } from './registry/item-book.ts';
import type { Loot, Monster, MonsterTemplate } from './registry/monsters.ts';
import type { RewardBundle, Rewards } from './rewards.ts';
import type { FeatDef } from './hunter/feats.ts';
import type { Quest } from './hunter/hunter.ts';
import { presetGrantsMapped } from './gates/preset.ts';
import type { Gate } from './gates/gate.ts';
import type { Chapter, ChapterQuest, Story, StoryTemplate } from './story/story.ts';
import type { Dropped, FightLoot, Save } from './save.ts';
import type { Stash } from './trade/stash.ts';
import type { Goods } from './trade/goods.ts';
import { atSync } from './save-step.ts';

/** What a walk does at each item def id: the id to write there. */
export type DefFn = (id: ItemDefId) => ItemDefId;
/** A thing given back with each item def id in it replaced by `f`'s answer. Never changes its input. */
export type DefWalk<T> = (x: T, f: DefFn) => T;

const list = <T>(walk: DefWalk<T>): DefWalk<readonly T[]> => (xs, f) => xs.map(x => walk(x, f));

// ── the things that hold an item def id ──
/** A grant: a reference's id; an ad hoc item holds none. */
export const grant: DefWalk<ItemGrant> = (g, f) => (g.kind === 'ref' ? { ...g, defId: f(g.defId) } : g);
/** A bag line: a reference's id. */
export const held: DefWalk<HeldItem> = (h, f) => (h.kind === 'ref' ? { ...h, defId: f(h.defId) } : h);
const grants = list(grant);
/** A reward: its items. */
export const rewards: DefWalk<Rewards> = (r, f) => (r.items.length ? { ...r, items: [...grants(r.items, f)] } : r);
/** A reward bundle: its reward. */
export const bundle = <B extends Pick<RewardBundle, 'rewards'>>(b: B, f: DefFn): B => ({ ...b, rewards: rewards(b.rewards, f) });
/** A feat: its reward. */
export const feat: DefWalk<FeatDef> = (d, f) => ({ ...d, rewards: rewards(d.rewards, f) });
const loot: DefWalk<Loot> = (l, f) => ({ ...l, items: [...grants(l.items, f)] });
/** A monster: its loot. */
export const monster = <M extends Pick<MonsterTemplate, 'loot'>>(m: M, f: DefFn): M => ({ ...m, loot: loot(m.loot, f) });
const chapterQuest: DefWalk<ChapterQuest> = (q, f) => ({ ...q, rewards: rewards(q.rewards, f), onFail: rewards(q.onFail, f) });
const chapter: DefWalk<Chapter> = (c, f) => ({ ...c, rewards: rewards(c.rewards, f), ...(c.quest ? { quest: chapterQuest(c.quest, f) } : {}) });
/** A story: each chapter's reward and its quest's. */
export const story = <S extends StoryTemplate>(s: S, f: DefFn): S => ({ ...s, chapters: s.chapters.map(c => chapter(c, f)) });
const quest: DefWalk<Quest> = (q, f) => ({ ...q, rewards: rewards(q.rewards, f), onFail: rewards(q.onFail, f) });
const gate: DefWalk<Gate> = (g, f) => presetGrantsMapped(g, x => grant(x, f));
const drop: DefWalk<Dropped> = (d, f) => ({ ...d, items: [...grants(d.items, f)] });
const fightLoot: DefWalk<FightLoot> = (l, f) => (l.at === 'none' ? l : { at: 'waiting', drops: [drop(l.drops[0], f), ...l.drops.slice(1).map(d => drop(d, f))] });
const stash: DefWalk<Stash> = (s, f) => ({ ...s, items: s.items.map(i => held(i, f)) });
/** Goods: each line's grant. */
export const goods: DefWalk<Goods> = (g, f) => ({ ...g, items: g.items.map(l => ({ ...l, item: grant(l.item, f) })) });

/**
 * A save with each item def id its campaign holds replaced by `f`'s answer: hunters' bags and quests, the stash, the
 * shop, the waiting loot, the gates' presets, the monsters, the library's rewards, feats and stories, and the keys of
 * `library.items` and `heardItems` themselves. The daily reward's override holds items too: its `rewards` walk.
 */
export function walkSave(save: Save, f: DefFn): Save {
  const keys = (book: Record<ItemDefId, ItemDefData>): Record<ItemDefId, ItemDefData> =>
    Object.fromEntries(Object.entries(book).map(([id, def]) => [f(id as ItemDefId), def])) as Record<ItemDefId, ItemDefData>;
  const daily = dailyOverride(save.rulesOverrides);
  return {
    ...save,
    hunters: save.hunters.map(h => ({ ...h, items: h.items.map(i => held(i, f)), quests: h.quests.map(q => quest(q, f)) })),
    stash: stash(save.stash, f),
    shop: save.shop === null ? null : save.shop.map(f),
    loot: fightLoot(save.loot, f),
    gates: save.gates.map(g => gate(g, f)),
    monsters: save.monsters.map((m): Monster => monster(m, f)),
    library: {
      ...save.library,
      items: keys(save.library.items),
      rewards: save.library.rewards.map(b => bundle(b, f)),
      feats: Object.fromEntries(Object.entries(save.library.feats).map(([k, d]) => [k, feat(d, f)])),
      stories: save.library.stories.map((s): Story => story(s, f)),
    },
    heardItems: keys(save.heardItems),
    ...(daily ? { rulesOverrides: { ...save.rulesOverrides, dailyTemplate: { ...daily.whole, rewards: rewards(daily.rewards, f) } } } : {}),
  };
}
/** The daily quest's reward as a rule override holds it (`dailyTemplate.rewards`, overrides.ts), or null. */
function dailyOverride(ov: Record<string, unknown>): { readonly whole: Record<string, unknown>; readonly rewards: Rewards } | null {
  const d = ov.dailyTemplate;
  if (d === null || typeof d !== 'object' || Array.isArray(d)) return null;
  const r = (d as Record<string, unknown>).rewards;
  if (r === null || typeof r !== 'object' || !Array.isArray((r as Record<string, unknown>).items)) return null;
  return { whole: d as Record<string, unknown>, rewards: r as Rewards };
}

/** The item def ids `x` names by `walk`, added to `out`. */
export function namedIn<T>(walk: DefWalk<T>, x: T, out: Set<ItemDefId>): Set<ItemDefId> {
  walk(x, id => { out.add(id); return id; });
  return out;
}

/**
 * Every item def id the save names outside its own books (`library.items`, `heardItems`): its campaign (`walkSave`) and
 * this phone's open records, the goods aside in its offers and stash asks, whose defs travel with them.
 */
export function namedIds(save: Save): Set<ItemDefId> {
  const out = new Set<ItemDefId>();
  walkSave({ ...save, library: { ...save.library, items: {} }, heardItems: {} }, id => { out.add(id); return id; });
  const sync = save.settings.sync;
  for (const o of sync.offers ?? []) {
    if ('aside' in o && o.aside) namedIn(goods, o.aside, out);
    namedIn(goods, o.offer.gives, out);
  }
  for (const a of sync.asked ?? []) if (a.kind === 'stash' && a.ask.kind === 'put') namedIn(goods, a.ask.goods, out);
  for (const p of sync.pending ?? []) namedIn(rewards, p.rewards, out);
  return out;
}

/**
 * The one writer of `heardItems` (save.ts): the defs `defs` heard (a grant's, a goods line's, the stash doc's, a def the
 * GM deleted from the library, or a synced catalog read), laid over what it held (incoming `defs` first so fresh defs
 * win at `HEARD_MAX`, unless `opts.fillOnly` is true while a fight holds the hunter, in which case existing heard
 * entries stay untouched and `defs` only fills missing ones), then cut to the custom ids the save names (`namedIds`)
 * and does not hold in its library, at most `HEARD_MAX`. A built-in id is never kept here: the shipped def or the
 * library's override is the one a phone reads. So a def leaves this phone when the last thing that names it does.
 */
export function heardStep(
  save: Save,
  defs: Readonly<Record<ItemDefId, ItemDefData>> = {},
  opts: { readonly fillOnly?: boolean } = {},
): Save {
  const named = namedIds(save), next: Record<ItemDefId, ItemDefData> = {};
  const entries = (opts.fillOnly
    ? [...Object.entries(save.heardItems), ...Object.entries(defs)]
    : [...Object.entries(defs), ...Object.entries(save.heardItems)]) as [ItemDefId, ItemDefData][];
  let n = 0;
  for (const [k, def] of entries) {
    if (!isCustomItemDefId(k) || !named.has(k) || Object.hasOwn(save.library.items, k) || Object.hasOwn(next, k)) continue;
    if (n >= HEARD_MAX) break;
    next[k] = def;
    n++;
  }
  const same = Object.keys(next).length === Object.keys(save.heardItems).length
    && Object.entries(next).every(([k, d]) => {
      const prev = save.heardItems[k as ItemDefId];
      return prev === d || (prev !== undefined && JSON.stringify(prev) === JSON.stringify(d));
    });
  return same ? save : { ...save, heardItems: next };
}

/**
 * The save with every custom item of catalog `from` moved to catalog `to`: each `c:<from>:<stamp>` def and ref
 * rewritten as `c:<to>:<stamp>` (the stamp kept, so two moves of one file agree), and `library.catalogId` set to `to`.
 */
export function rekeyCatalog(save: Save, from: CatalogId, to: CatalogId): Save {
  const moved = from === to ? save : walkSave(save, id => {
    const stamp = catalogOfItemDefId(id) === from ? stampOfItemDefId(id) : null;
    return stamp ? customItemDefId(to, stamp) : id;
  });
  return { ...moved, library: { ...moved.library, catalogId: to } };
}

/**
 * A campaign swapped in on this phone (an import, a restore) whose catalog has no key in this phone's ring is rekeyed at
 * once to a catalog of `newKey` (Fable C2): every def and ref of the old catalog rewritten, and the new key put in the
 * ring. A save with no catalog, or one whose key this phone holds, is as it was. So a phone never holds custom items of
 * a catalog it cannot publish, and two phones that import one file never write one catalog.
 */
export function importRekey(save: Save, newKey: CatalogKey): Save {
  const from = save.library.catalogId, ring = save.settings.sync.catalogKeys ?? {};
  if (from === null || Object.hasOwn(ring, from)) return save;
  const to = catalogIdOf(newKey), moved = rekeyCatalog(save, from, to);
  return atSync(sync => ({ ...sync, catalogKeys: { ...ring, [to]: newKey } }))(moved);
}

/**
 * The save with a catalog of its own: as it is when `library.catalogId` is set, else with `catalogIdOf(newKey)` and the
 * key put in the ring (the edge mints `newKey` at the first custom item, Fable C2).
 */
export function withCatalog(save: Save, newKey: CatalogKey): Save {
  if (save.library.catalogId !== null) return save;
  const id = catalogIdOf(newKey), ring = save.settings.sync.catalogKeys ?? {};
  return atSync(sync => ({ ...sync, catalogKeys: { ...ring, [id]: newKey } }))({ ...save, library: { ...save.library, catalogId: id } });
}
