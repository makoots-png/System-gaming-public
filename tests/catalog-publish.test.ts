import { describe, expect, test } from 'bun:test';
import {
  CATALOG_PUBLISH_CLEAN, CATALOG_PUBLISH_MS, catalogDocHash, catalogPublishStep, catalogReleaseStep,
  catalogRetryWait, catalogSentStep, hasCatalogContent, mergeCatalogRead, wantedCatalogIds,
} from '../src/core/sync/catalog-publish.ts';
import type { CatalogPublish } from '../src/core/sync/catalog-publish.ts';
import { adoptCatalogDoc } from '../src/core/library.ts';
import { fitted } from '../src/core/hunter/sheet.ts';
import { heardStep } from '../src/core/item-refs.ts';
import { catalogDoc, catalogReadOf, newEvent, parseSheetKey } from '../src/core/protocol.ts';
import type { CatalogDoc, CatalogRead, RoomDocs, ServedSheet, SheetKey, Stored, StoredEvent } from '../src/core/protocol.ts';
import { RULES, rulesOf } from '../src/core/rules.ts';
import { freshSave, repairSave } from '../src/core/save.ts';
import type { ParseEnv, Save } from '../src/core/save.ts';
import { BUILT_IN_STATUSES } from '../src/core/registry/statuses.ts';
import { resolveItem } from '../src/core/registry/item-book.ts';
import { dev, iid } from './fixtures/ids.ts';
import {
  CUSTOM_BLADE_DEF, CUSTOM_BLADE_ID, CUSTOM_FLASK_FOLLOW_DEF as SECRET_DEF,
  CUSTOM_FLASK_FOLLOW_ID as SECRET_ID, DAGGER_DEF_ID, FOREIGN_CHARM_DEF, FOREIGN_CHARM_ID,
  GM_CATALOG_ID, grantRef, heldRef,
} from './fixtures/items.ts';

const ENV: ParseEnv = {
  now: new Date('2026-11-26T12:00:00.000Z'),
  newDeviceId: () => dev('d-test'),
  newDeviceToken: () => 'test-device-token-0123456789abcd',
};

const baseSave = (): Save => freshSave(ENV, { onboarded: true });

describe('catalogPublishStep state machine', () => {
  const docA: CatalogDoc = { items: { [CUSTOM_BLADE_ID]: CUSTOM_BLADE_DEF }, statuses: {}, shop: null };
  const docB: CatalogDoc = { items: { [CUSTOM_BLADE_ID]: { ...CUSTOM_BLADE_DEF, name: 'Blade B' } }, statuses: {}, shop: null };
  const hashA = catalogDocHash(docA);
  const hashB = catalogDocHash(docB);

  test('clean -> due -> sending -> clean on stored, and stale edits reschedule due', () => {
    let s: CatalogPublish = CATALOG_PUBLISH_CLEAN;
    let r = catalogPublishStep(s, { type: 'changed' });
    expect(r.state).toEqual({ at: 'due', fails: 0 });
    expect(r.effects).toEqual([{ type: 'setTimer', ms: CATALOG_PUBLISH_MS }]);

    // Another edit while due is a no-op
    s = r.state;
    expect(catalogPublishStep(s, { type: 'changed' })).toEqual({ state: s, effects: [] });

    // Timer fires -> sending
    r = catalogPublishStep(s, { type: 'due', hash: hashA, ifRev: 0 });
    expect(r.state).toEqual({ at: 'sending', hash: hashA, ifRev: 0, stale: false, fails: 0 });
    expect(r.effects).toEqual([{ type: 'put', ifRev: 0, hash: hashA }]);

    // Stored cleanly -> clean + saveSent
    const clean = catalogPublishStep(r.state, { type: 'stored', rev: 1 });
    expect(clean.state).toEqual({ at: 'clean' });
    expect(clean.effects).toEqual([{ type: 'saveSent', rev: 1, hash: hashA }]);

    // Mid-flight edit marks stale -> stored reschedules due
    const stale = catalogPublishStep(r.state, { type: 'changed' });
    expect(stale.state).toEqual({ at: 'sending', hash: hashA, ifRev: 0, stale: true, fails: 0 });
    const afterStale = catalogPublishStep(stale.state, { type: 'stored', rev: 1 });
    expect(afterStale.state).toEqual({ at: 'due', fails: 0 });
    expect(afterStale.effects).toEqual([
      { type: 'saveSent', rev: 1, hash: hashA },
      { type: 'setTimer', ms: CATALOG_PUBLISH_MS },
    ]);
  });

  test('409 conflictSame silently adopts server rev; conflictDiff enters conflict and pauses publishing until resolved', () => {
    const sending = catalogPublishStep(CATALOG_PUBLISH_CLEAN, { type: 'now', hash: hashA, ifRev: 0 }).state;

    // Same doc on server -> silently adopt rev
    const same = catalogPublishStep(sending, { type: 'conflictSame', serverRev: 4 });
    expect(same.state).toEqual({ at: 'clean' });
    expect(same.effects).toEqual([{ type: 'saveSent', rev: 4, hash: hashA }]);

    // Different doc on server -> conflict state, Workshop notified
    const conf = catalogPublishStep(sending, { type: 'conflictDiff', serverRev: 5, serverDoc: docB });
    expect(conf.state).toEqual({ at: 'conflict', serverRev: 5, serverDoc: docB });
    expect(conf.effects).toEqual([{ type: 'status' }]);

    // Further edits or immediate flush wait while in conflict
    expect(catalogPublishStep(conf.state, { type: 'changed' })).toEqual({ state: conf.state, effects: [] });
    expect(catalogPublishStep(conf.state, { type: 'now', hash: hashA, ifRev: 5 })).toEqual({ state: conf.state, effects: [] });

    // Resolve: Keep mine -> sending with ifRev = serverRev
    const keep = catalogPublishStep(conf.state, { type: 'keepMine', hash: hashA });
    expect(keep.state).toEqual({ at: 'sending', hash: hashA, ifRev: 5, stale: false, fails: 0 });
    expect(keep.effects).toEqual([{ type: 'put', ifRev: 5, hash: hashA }, { type: 'status' }]);

    // Resolve: Use theirs -> clean + adoptTheirs
    const theirs = catalogPublishStep(conf.state, { type: 'useTheirs' });
    expect(theirs.state).toEqual({ at: 'clean' });
    expect(theirs.effects).toEqual([
      { type: 'adoptTheirs', serverRev: 5, serverDoc: docB, hash: hashB },
      { type: 'status' },
    ]);
  });

  test('transient failures back off, non-retryable returns clean, matched cancels timer, reset aborts', () => {
    const due = catalogPublishStep(CATALOG_PUBLISH_CLEAN, { type: 'changed' }).state;
    const matched = catalogPublishStep(due, { type: 'matched' });
    expect(matched.state).toEqual({ at: 'clean' });
    expect(matched.effects).toEqual([{ type: 'clearTimer' }]);

    const s1 = catalogPublishStep(CATALOG_PUBLISH_CLEAN, { type: 'now', hash: hashA, ifRev: 1 }).state;
    const f1 = catalogPublishStep(s1, { type: 'failed', retry: true });
    expect(f1.state).toEqual({ at: 'due', fails: 1 });
    expect(f1.effects).toEqual([{ type: 'setTimer', ms: catalogRetryWait(1) }]);

    const s2 = catalogPublishStep(f1.state, { type: 'due', hash: hashA, ifRev: 1 }).state;
    const f2 = catalogPublishStep(s2, { type: 'failed', retry: true });
    expect(f2.state).toEqual({ at: 'due', fails: 2 });
    expect(f2.effects).toEqual([{ type: 'setTimer', ms: catalogRetryWait(2) }]);

    const nonRetry = catalogPublishStep(s1, { type: 'failed', retry: false });
    expect(nonRetry.state).toEqual({ at: 'clean' });
    expect(nonRetry.effects).toEqual([]);

    const resetSending = catalogPublishStep(s1, { type: 'reset' });
    expect(resetSending.state).toEqual({ at: 'clean' });
    expect(resetSending.effects).toEqual([{ type: 'abort' }]);
  });

  test('catalogDocHash is independent of object key order', () => {
    const a: CatalogDoc = { items: { [CUSTOM_BLADE_ID]: CUSTOM_BLADE_DEF, [SECRET_ID]: SECRET_DEF }, statuses: {}, shop: null };
    const b: CatalogDoc = { shop: null, statuses: {}, items: { [SECRET_ID]: SECRET_DEF, [CUSTOM_BLADE_ID]: CUSTOM_BLADE_DEF } };
    expect(catalogDocHash(a)).toBe(catalogDocHash(b));
    expect(catalogDocHash(a)).not.toBe(catalogDocHash(docB));
  });

  test('catalogSentStep persists in SyncSettings and survives save repair', () => {
    const s = catalogSentStep({ id: GM_CATALOG_ID, rev: 3, hash: hashA })(baseSave());
    expect(s.settings.sync.catalogSent).toEqual({ id: GM_CATALOG_ID, rev: 3, hash: hashA });
    const repaired = repairSave(JSON.parse(JSON.stringify(s)), ENV);
    expect(repaired.settings.sync.catalogSent).toEqual({ id: GM_CATALOG_ID, rev: 3, hash: hashA });
    expect(hasCatalogContent(baseSave())).toBe(false);
    expect(hasCatalogContent({ ...baseSave(), shop: [DAGGER_DEF_ID] })).toBe(true);
    expect(catalogSentStep(null)(s).settings.sync.catalogSent).toBeUndefined();
  });
});

describe('player catalog read, staging, and conflict adoption', () => {
  test('wantedCatalogIds collects c:<catalog>:* from bags, stash doc, faces, and incoming poll events, skipping b:* and foreign ids', () => {
    const s = baseSave();
    s.hunters[0]!.items = [heldRef(1, CUSTOM_BLADE_ID), heldRef(2, DAGGER_DEF_ID), heldRef(3, FOREIGN_CHARM_ID)];
    const docs: RoomDocs = {
      stash: { at: '2026-11-26T12:00:00.000Z', from: dev('d-gm'), data: { gold: 0, items: [heldRef(4, SECRET_ID)], defs: {} } },
    };
    const otherKey: SheetKey = parseSheetKey('d-other:h1')!;
    const myKey: SheetKey = parseSheetKey('d-test:h1')!;
    const sheets: Record<SheetKey, Stored<ServedSheet>> = {
      [otherKey]: {
        at: '2026-11-26T12:00:00.000Z',
        from: dev('d-other'),
        data: { face: { name: 'Kai', level: 1, job: null, bag: [{ id: iid('i9'), qty: 1, defId: CUSTOM_BLADE_ID, name: 'Rift Fang', rar: 'rare' }] } },
      },
    };
    const awardId = `c:${GM_CATALOG_ID}:awardeditem00001` as typeof CUSTOM_BLADE_ID;
    const ev = newEvent('award', {
      to: [myKey],
      rewards: { xp: 0, points: 0, gold: 0, crystal: 0, items: [grantRef(awardId)], title: null, job: null, skills: [], statuses: [], boons: [] },
    }, { device: 'd-gm', now: 1700000000001, rand: 0.5 })!;
    const events: StoredEvent[] = [{ ...ev, seq: 1, at: '2026-11-26T12:00:00.000Z', from: dev('d-gm') }];

    const want = wantedCatalogIds(GM_CATALOG_ID, s, docs, sheets, events);
    expect(want).toEqual([CUSTOM_BLADE_ID, SECRET_ID, awardId].sort());
  });

  test('mergeCatalogRead replaces on new rev and merges defs on same rev', () => {
    const r1: CatalogRead = { id: GM_CATALOG_ID, rev: 1, statuses: {}, shop: null, defs: { [CUSTOM_BLADE_ID]: CUSTOM_BLADE_DEF }, gone: [SECRET_ID] };
    const r1More: CatalogRead = { id: GM_CATALOG_ID, rev: 1, statuses: {}, shop: null, defs: { [SECRET_ID]: SECRET_DEF }, gone: [] };
    const merged = mergeCatalogRead(r1, r1More);
    expect(Object.keys(merged.defs).sort()).toEqual([CUSTOM_BLADE_ID, SECRET_ID].sort());
    expect(merged.gone).toEqual([]);

    const r2: CatalogRead = { id: GM_CATALOG_ID, rev: 2, statuses: {}, shop: null, defs: {}, gone: [CUSTOM_BLADE_ID] };
    expect(mergeCatalogRead(merged, r2)).toBe(r2);
  });

  test('heardStep fillOnly keeps existing heard def during a fight and only fills missing entries', () => {
    const s = baseSave();
    s.hunters[0]!.items = [heldRef(1, CUSTOM_BLADE_ID), heldRef(2, SECRET_ID)];
    const oldBlade = { ...CUSTOM_BLADE_DEF, name: 'Blade Old' };
    const newBlade = { ...CUSTOM_BLADE_DEF, name: 'Blade New' };
    const s1 = heardStep(s, { [CUSTOM_BLADE_ID]: oldBlade });

    // During a fight (fillOnly: true): existing blade stays old, missing secret is filled
    const midFight = heardStep(s1, { [CUSTOM_BLADE_ID]: newBlade, [SECRET_ID]: SECRET_DEF }, { fillOnly: true });
    expect(midFight.heardItems[CUSTOM_BLADE_ID]?.name).toBe('Blade Old');
    expect(midFight.heardItems[SECRET_ID]?.name).toBe(SECRET_DEF.name);

    // At release (default fillOnly: false): fresh catalog def replaces old blade
    const after = heardStep(midFight, { [CUSTOM_BLADE_ID]: newBlade });
    expect(after.heardItems[CUSTOM_BLADE_ID]?.name).toBe('Blade New');
  });

  test('catalogReleaseStep updates heardItems, fits non-held wearers, skips held hunters, and avoids idle writes', () => {
    const strongRing = { ...CUSTOM_BLADE_DEF, name: 'Vitality Band', type: 'accessory' as const, slot: 'ring1' as const, bonus: { vit: 10 }, dice: '' };
    const weakRing = { ...strongRing, bonus: {} };
    const s = baseSave();
    const h = s.hunters[0]!;
    h.items = [heldRef(1, CUSTOM_BLADE_ID)];
    h.equipped.ring1 = iid('i1');
    const rStrong = rulesOf({}, {}, { [CUSTOM_BLADE_ID]: strongRing });
    const fullHp = h.life.at === 'up' ? h.life.hp + 100 : 100;
    s.hunters[0] = { ...h, life: { at: 'up', hp: fullHp } };
    const withHeard = heardStep(s, { [CUSTOM_BLADE_ID]: strongRing });

    const { doc } = catalogDoc({ library: { items: { [CUSTOM_BLADE_ID]: weakRing }, statuses: {} }, shop: null });
    const read = catalogReadOf(GM_CATALOG_ID, 2, doc, [CUSTOM_BLADE_ID]);
    const rWeak = rulesOf({}, read.statuses, read.defs);

    // Held hunter is not fitted, though heardItems updates when called at release (caller gates release on !anyHeld)
    const heldOut = catalogReleaseStep(withHeard, read, rWeak, () => true, fitted);
    expect(heldOut.hunters[0]!.life).toEqual(withHeard.hunters[0]!.life);
    expect(heldOut.heardItems[CUSTOM_BLADE_ID]?.bonus).toEqual({});

    // Non-held hunter is fitted down to new max HP
    const released = catalogReleaseStep(withHeard, read, rWeak, () => false, fitted);
    const hpAfter = released.hunters[0]!.life.at === 'up' ? released.hunters[0]!.life.hp : 0;
    expect(hpAfter).toBeLessThan(fullHp);
    expect(resolveItem(released.hunters[0]!.items[0]!, rStrong)).toBeDefined();

    // Calling again with same catalog returns identical save reference (zero idle writes)
    expect(catalogReleaseStep(released, read, rWeak, () => false, fitted)).toBe(released);
  });

  test('adoptCatalogDoc replaces library items, statuses, and shop while keeping held deleted items in heardItems', () => {
    const s = baseSave();
    s.library.catalogId = GM_CATALOG_ID;
    s.library.items = { [CUSTOM_BLADE_ID]: CUSTOM_BLADE_DEF, [SECRET_ID]: SECRET_DEF };
    s.hunters[0]!.items = [heldRef(1, CUSTOM_BLADE_ID)];
    const serverDoc: CatalogDoc = {
      items: { [SECRET_ID]: { ...SECRET_DEF, name: 'Server Secret' } },
      statuses: { poisoned: { ...BUILT_IN_STATUSES.poisoned, label: 'Server Poison' } },
      shop: [DAGGER_DEF_ID, SECRET_ID],
    };
    const next = adoptCatalogDoc(s, serverDoc);
    expect(Object.keys(next.library.items)).toEqual([SECRET_ID]);
    expect(next.library.items[SECRET_ID]?.name).toBe('Server Secret');
    expect(next.library.statuses.poisoned?.label).toBe('Server Poison');
    expect(next.shop).toEqual([DAGGER_DEF_ID, SECRET_ID]);
    // Custom blade removed by server is kept in heardItems because hunter 0 holds it
    expect(next.heardItems[CUSTOM_BLADE_ID]?.name).toBe(CUSTOM_BLADE_DEF.name);
  });
});
