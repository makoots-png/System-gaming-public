// catalog-publish.ts: the GM's catalog publish state machine (`clean | due | sending | conflict`), canonical catalog
// doc hashing, and the player's catalog read / release helpers. Pure.
//
// The GM's phone tracks the last sent rev and hash in `settings.sync.catalogSent`. On a change to library items,
// library statuses, or shop, the machine moves `clean -> due` (debounced) -> `sending`. On 200 it records the new rev
// and hash (`saveSent`). On 409 the edge fetches the server's doc (`GET /api/catalogs/:id`): if its canonical hash
// matches the local doc it silently adopts the server rev (`conflictSame`); if it differs it enters `conflict` and
// waits until the GM picks Keep mine (`keepMine`, PUT with `ifRev = serverRev`) or Use theirs (`useTheirs`, adopting
// the server doc into the save via library.ts `adoptCatalogDoc`).
import { sha256Hex } from '../sha256.ts';
import { catalogOfItemDefId, isCustomItemDefId } from '../ids.ts';
import type { CatalogId, HunterId, ItemDefId, SheetKey } from '../ids.ts';
import { CATALOG_READ_MAX } from '../protocol.ts';
import type { CatalogDoc, CatalogRead, RoomDocs, ServedSheet, Stored, StoredEvent } from '../protocol.ts';
import { goods as walkGoods, heardStep, held as walkHeld, namedIds, namedIn, rewards as walkRewards } from '../item-refs.ts';
import type { Rules } from '../rules.ts';
import type { CatalogSent, Hunter, Save } from '../save.ts';
import { atSync } from '../save-step.ts';

// ── timings ──
/** Debounce after a GM edits items, statuses, or the shop before PUTting the catalog. */
export const CATALOG_PUBLISH_MS = 400;
/** Backoff waits after transient PUT failures (network, timeout, 5xx). */
export const CATALOG_RETRY_WAITS = [2000, 5000, 10000, 30000] as const;
export const catalogRetryWait = (fails: number): number =>
  CATALOG_RETRY_WAITS[Math.min(Math.max(fails, 1), CATALOG_RETRY_WAITS.length) - 1] ?? CATALOG_RETRY_WAITS[0];

// ── canonical hashing ──
/** Canonical JSON (recursively sorted object keys) so two equal docs always hash identically regardless of key order. */
function canonicalJson(v: unknown): string {
  return JSON.stringify(v, (_k, x: unknown) =>
    (x !== null && typeof x === 'object' && !Array.isArray(x)
      ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : x));
}

/** Deterministic SHA-256 hex digest of a `CatalogDoc`. */
export const catalogDocHash = (doc: CatalogDoc): string => sha256Hex(canonicalJson(doc));

/** Whether `save` has any GM catalog content worth publishing while alone (outside a room). */
export function hasCatalogContent(save: Pick<Save, 'library' | 'shop'>): boolean {
  return save.library.catalogId !== null
    || Object.keys(save.library.items).length > 0
    || Object.keys(save.library.statuses).length > 0
    || save.shop !== null;
}

/** Writes or clears `settings.sync.catalogSent` on `save`. */
export function catalogSentStep(sent: CatalogSent | null): (save: Save) => Save {
  return atSync(sy => {
    if (sent === null) {
      if (!('catalogSent' in sy)) return sy;
      const { catalogSent: _gone, ...rest } = sy;
      return rest;
    }
    return { ...sy, catalogSent: sent };
  });
}

// ── the publish state machine ──
export const CATALOG_PUBLISH_STATES = ['clean', 'due', 'sending', 'conflict'] as const;
export type CatalogPublishAt = (typeof CATALOG_PUBLISH_STATES)[number];

export type CatalogPublish =
  | { readonly at: 'clean' }
  | { readonly at: 'due'; readonly fails: number }
  | { readonly at: 'sending'; readonly hash: string; readonly ifRev: number; readonly stale: boolean; readonly fails: number }
  | { readonly at: 'conflict'; readonly serverRev: number; readonly serverDoc: CatalogDoc };

export const CATALOG_PUBLISH_CLEAN: CatalogPublish = { at: 'clean' };

export type CatalogPublishEvent =
  | { readonly type: 'changed' }
  | { readonly type: 'matched' }
  | { readonly type: 'due'; readonly hash: string; readonly ifRev: number }
  | { readonly type: 'now'; readonly hash: string; readonly ifRev: number }
  | { readonly type: 'stored'; readonly rev: number }
  | { readonly type: 'conflictSame'; readonly serverRev: number }
  | { readonly type: 'conflictDiff'; readonly serverRev: number; readonly serverDoc: CatalogDoc }
  | { readonly type: 'failed'; readonly retry: boolean }
  | { readonly type: 'keepMine'; readonly hash: string }
  | { readonly type: 'useTheirs' }
  | { readonly type: 'reset' };

export type CatalogPublishEffect =
  | { readonly type: 'setTimer'; readonly ms: number }
  | { readonly type: 'clearTimer' }
  | { readonly type: 'put'; readonly ifRev: number; readonly hash: string }
  | { readonly type: 'saveSent'; readonly rev: number; readonly hash: string }
  | { readonly type: 'adoptTheirs'; readonly serverRev: number; readonly serverDoc: CatalogDoc; readonly hash: string }
  | { readonly type: 'abort' }
  | { readonly type: 'status' };

export type CatalogPublishResult = {
  readonly state: CatalogPublish;
  readonly effects: readonly CatalogPublishEffect[];
};

const same = (state: CatalogPublish): CatalogPublishResult => ({ state, effects: [] });

/** One step of the GM's catalog publish machine (`clean | due | sending | conflict`). */
export function catalogPublishStep(state: CatalogPublish, event: CatalogPublishEvent): CatalogPublishResult {
  switch (event.type) {
    case 'reset': {
      const fx: CatalogPublishEffect[] = [];
      if (state.at === 'due') fx.push({ type: 'clearTimer' });
      if (state.at === 'sending') fx.push({ type: 'abort' });
      if (state.at === 'conflict') fx.push({ type: 'status' });
      return { state: CATALOG_PUBLISH_CLEAN, effects: fx };
    }
    case 'changed': {
      if (state.at === 'clean') return { state: { at: 'due', fails: 0 }, effects: [{ type: 'setTimer', ms: CATALOG_PUBLISH_MS }] };
      if (state.at === 'sending' && !state.stale) return { state: { ...state, stale: true }, effects: [] };
      return same(state);
    }
    case 'matched': {
      if (state.at === 'due') return { state: CATALOG_PUBLISH_CLEAN, effects: [{ type: 'clearTimer' }] };
      return same(state);
    }
    case 'due': {
      if (state.at !== 'due') return same(state);
      return {
        state: { at: 'sending', hash: event.hash, ifRev: event.ifRev, stale: false, fails: state.fails },
        effects: [{ type: 'put', ifRev: event.ifRev, hash: event.hash }],
      };
    }
    case 'now': {
      if (state.at === 'conflict') return same(state);
      if (state.at === 'sending') return state.stale ? same(state) : { state: { ...state, stale: true }, effects: [] };
      const fx: CatalogPublishEffect[] = [];
      if (state.at === 'due') fx.push({ type: 'clearTimer' });
      fx.push({ type: 'put', ifRev: event.ifRev, hash: event.hash });
      return {
        state: { at: 'sending', hash: event.hash, ifRev: event.ifRev, stale: false, fails: state.at === 'due' ? state.fails : 0 },
        effects: fx,
      };
    }
    case 'stored': {
      if (state.at !== 'sending') return same(state);
      const saved: CatalogPublishEffect = { type: 'saveSent', rev: event.rev, hash: state.hash };
      if (state.stale) {
        return { state: { at: 'due', fails: 0 }, effects: [saved, { type: 'setTimer', ms: CATALOG_PUBLISH_MS }] };
      }
      return { state: CATALOG_PUBLISH_CLEAN, effects: [saved] };
    }
    case 'conflictSame': {
      if (state.at !== 'sending') return same(state);
      const saved: CatalogPublishEffect = { type: 'saveSent', rev: event.serverRev, hash: state.hash };
      if (state.stale) {
        return { state: { at: 'due', fails: 0 }, effects: [saved, { type: 'setTimer', ms: CATALOG_PUBLISH_MS }] };
      }
      return { state: CATALOG_PUBLISH_CLEAN, effects: [saved] };
    }
    case 'conflictDiff': {
      if (state.at !== 'sending') return same(state);
      return {
        state: { at: 'conflict', serverRev: event.serverRev, serverDoc: event.serverDoc },
        effects: [{ type: 'status' }],
      };
    }
    case 'failed': {
      if (state.at !== 'sending') return same(state);
      if (!event.retry) return { state: CATALOG_PUBLISH_CLEAN, effects: [] };
      const fails = state.fails + 1;
      return { state: { at: 'due', fails }, effects: [{ type: 'setTimer', ms: catalogRetryWait(fails) }] };
    }
    case 'keepMine': {
      if (state.at !== 'conflict') return same(state);
      return {
        state: { at: 'sending', hash: event.hash, ifRev: state.serverRev, stale: false, fails: 0 },
        effects: [{ type: 'put', ifRev: state.serverRev, hash: event.hash }, { type: 'status' }],
      };
    }
    case 'useTheirs': {
      if (state.at !== 'conflict') return same(state);
      return {
        state: CATALOG_PUBLISH_CLEAN,
        effects: [
          { type: 'adoptTheirs', serverRev: state.serverRev, serverDoc: state.serverDoc, hash: catalogDocHash(state.serverDoc) },
          { type: 'status' },
        ],
      };
    }
  }
}

// ── player-side catalog read and release helpers ──

/**
 * Collects every custom item def id belonging to `catalogId` that this player phone names:
 * hunters' bags and quests, open offers and stash asks, loot, shop, room stash doc, visible faces,
 * and grants carried in incoming poll events. Sorted, deduplicated, and capped at `CATALOG_READ_MAX`.
 */
export function wantedCatalogIds(
  catalogId: CatalogId,
  save: Save,
  docs: RoomDocs,
  sheets: Readonly<Record<SheetKey, Stored<ServedSheet>>>,
  events: readonly StoredEvent[] = [],
): ItemDefId[] {
  const all = namedIds(save);
  const stash = docs.stash?.data;
  if (stash) for (const item of stash.items) namedIn(walkHeld, item, all);
  for (const s of Object.values(sheets)) {
    if ('face' in s.data && s.data.face.bag) {
      for (const line of s.data.face.bag) if (line.defId) all.add(line.defId);
    }
  }
  for (const ev of events) {
    switch (ev.type) {
      case 'award': namedIn(walkRewards, ev.payload.rewards, all); break;
      case 'quest':
        namedIn(walkRewards, ev.payload.quest.rewards, all);
        namedIn(walkRewards, ev.payload.quest.onFail, all);
        break;
      case 'chapter':
        namedIn(walkRewards, ev.payload.rewards, all);
        if (ev.payload.quest) {
          namedIn(walkRewards, ev.payload.quest.rewards, all);
          namedIn(walkRewards, ev.payload.quest.onFail, all);
        }
        break;
      case 'offer': namedIn(walkGoods, ev.payload.gives, all); break;
      case 'offerEnd': namedIn(walkGoods, ev.payload.gives, all); break;
      case 'stashAnswer': if (ev.payload.verdict === 'given') namedIn(walkGoods, ev.payload.goods, all); break;
    }
  }
  const out: ItemDefId[] = [];
  for (const id of all) {
    if (isCustomItemDefId(id) && catalogOfItemDefId(id) === catalogId) out.push(id);
  }
  out.sort();
  return out.slice(0, CATALOG_READ_MAX);
}

/** Merges a fresh `CatalogRead` into `prev`: replaces on new id or rev, merges `defs` when reading newly wanted ids at the same rev. */
export function mergeCatalogRead(prev: CatalogRead | null, next: CatalogRead): CatalogRead {
  if (!prev || prev.id !== next.id || prev.rev !== next.rev) return next;
  const defs = { ...prev.defs, ...next.defs };
  const gone = [...new Set([...prev.gone.filter(id => !Object.hasOwn(defs, id)), ...next.gone])];
  return { ...next, defs, gone };
}

const sameVitals = (a: Hunter, b: Hunter): boolean =>
  a.mana === b.mana && a.fatigue === b.fatigue && a.collapsed === b.collapsed
  && a.life.at === b.life.at && (a.life.at !== 'up' || (b.life.at === 'up' && a.life.hp === b.life.hp));

/**
 * Applies a newly active or promoted `CatalogRead` to `save`: persists custom defs referenced by the save into
 * `heardItems` (so deleted items keep working) and re-fits non-held hunters under `R` (with the catalog bound).
 * Returns the same `save` reference when neither `heardItems` nor any hunter's vitals changed (zero idle writes).
 */
export function catalogReleaseStep(
  save: Save,
  catalog: CatalogRead,
  R: Rules,
  isHeld: (s: Save, hid: HunterId) => boolean,
  fit: (h: Hunter, R: Rules) => Hunter,
): Save {
  const afterHeard = heardStep(save, catalog.defs);
  let huntersChanged = false;
  const hunters = afterHeard.hunters.map(h => {
    if (isHeld(afterHeard, h.id)) return h;
    const next = fit(h, R);
    if (sameVitals(h, next)) return h;
    huntersChanged = true;
    return next;
  });
  return huntersChanged ? { ...afterHeard, hunters } : afterHeard;
}

// ── plain-language UI copy (docs/guide/voice.md) ──
export const CATALOG_CONFLICT_WORDS = {
  title: 'Catalog conflict',
  body: 'Your synced items, statuses, or shop changed on another device. Choose which version to keep. Syncing is paused until you choose.',
  keepMine: 'Keep this phone\'s items',
  useTheirs: 'Use the other phone\'s items',
  keptToast: 'Kept this phone\'s items.',
  adoptedToast: 'Loaded the other phone\'s items.',
  leftWarning: (n: number): string =>
    `Your synced catalog is over the size limit. ${n} ${n === 1 ? 'entry is' : 'entries are'} not sent to players. Remove unused items or statuses to fit everything.`,
} as const;
