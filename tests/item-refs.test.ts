// Item sync PR 2: where an item def id sits in a save (item-refs.ts), the one writer of heardItems, the catalog rekeys,
// the library's item steps, and that no def of an item a phone was not shown leaves the GM's phone (vis-leak).
import { describe, expect, test } from 'bun:test';
import { RULES } from '../src/core/rules.ts';
import { newSave, savedItemBook } from '../src/core/save.ts';
import type { Save } from '../src/core/save.ts';
import { newHunter } from '../src/core/hunter/hunter.ts';
import { heardStep, importRekey, namedIds, rekeyCatalog, withCatalog } from '../src/core/item-refs.ts';
import { editHeldDef, removeItemDef, saveItemDef } from '../src/core/library.ts';
import { bagEdit, detachItem, equip, removeItem, sell } from '../src/core/hunter/inventory.ts';
import { spendItem, useItem } from '../src/core/hunter/use.ts';
import { hunterSheet } from '../src/core/hunter/sheet.ts';
import { removeHunter } from '../src/core/party.ts';
import { mergePack, packOf, parsePack } from '../src/core/pack.ts';
import { reduce } from '../src/core/combat/fight.ts';
import { hunterRow } from '../src/core/combat/rows.ts';
import { atHunter, isRefused } from '../src/core/save-step.ts';
import { catalogIdOf } from '../src/core/catalog-id.ts';
import { catalogOfItemDefId, customItemDefId, fightId, parseCatalogKey, stampOfItemDefId } from '../src/core/ids.ts';
import type { ItemDefId } from '../src/core/ids.ts';
import { HEARD_MAX, bagDefs, builtInDefData, resolveItem } from '../src/core/registry/item-book.ts';
import type { ItemDefData } from '../src/core/registry/item-book.ts';
import { stashDoc } from '../src/core/trade/stash.ts';
import { hunterFace, newEvent } from '../src/core/protocol.ts';
import { newRewards } from '../src/core/rewards.ts';
import { cid, dev, hid, iid } from './fixtures/ids.ts';
import {
  ADHOC_CHARM_DEF, CUSTOM_BLADE_DEF, CUSTOM_BLADE_ID, CUSTOM_FLASK_PINNED_DEF, CUSTOM_FLASK_PINNED_ID, DAGGER_DEF_ID, FOREIGN_CHARM_DEF,
  FOREIGN_CHARM_ID, GM_CATALOG_ID, GM_CATALOG_KEY, OTHER_CATALOG_ID, customId, grantRef, heldAdhoc, heldRef, rulesWith, stampSeq,
} from './fixtures/items.ts';

const SECRET_ID = customId('secret');
const SECRET_DEF: ItemDefData = { ...CUSTOM_BLADE_DEF, name: 'Never Shown' };

/** A GM's save: three custom items in the library, a hunter holding the blade, the stash holding the flask. */
function gmSave(): Save {
  const s = newSave(dev('d-gm'));
  const h = { ...newHunter(RULES), items: [heldRef(1, CUSTOM_BLADE_ID), heldRef(2, DAGGER_DEF_ID)] };
  return {
    ...s, hunters: [h],
    library: { ...s.library, catalogId: GM_CATALOG_ID, items: { [CUSTOM_BLADE_ID]: CUSTOM_BLADE_DEF, [CUSTOM_FLASK_PINNED_ID]: CUSTOM_FLASK_PINNED_DEF, [SECRET_ID]: SECRET_DEF } },
    stash: { gold: 0, items: [heldRef(3, CUSTOM_FLASK_PINNED_ID, 2)] },
    settings: { ...s.settings, sync: { ...s.settings.sync, catalogKeys: { [GM_CATALOG_ID]: GM_CATALOG_KEY } } },
  };
}
const R = (s: Save) => rulesWith(savedItemBook(s));

describe('namedIds and heardStep', () => {
  test('the save names every id its bags, stash and rewards hold, and not its books alone', () => {
    const s = gmSave(), named = namedIds(s);
    expect([...named].sort()).toEqual([CUSTOM_BLADE_ID, CUSTOM_FLASK_PINNED_ID, DAGGER_DEF_ID].sort());
    expect(named.has(SECRET_ID)).toBe(false);
  });

  test('heardStep keeps a heard custom def only while the save names it and the library lacks it; never a built-in', () => {
    const s0 = { ...newSave(dev('d-p')), hunters: [{ ...newHunter(RULES), items: [heldRef(1, FOREIGN_CHARM_ID)] }] };
    const s1 = heardStep(s0, { [FOREIGN_CHARM_ID]: FOREIGN_CHARM_DEF, [SECRET_ID]: SECRET_DEF, [DAGGER_DEF_ID]: CUSTOM_BLADE_DEF });
    expect(Object.keys(s1.heardItems)).toEqual([FOREIGN_CHARM_ID]);
    expect(resolveItem(s1.hunters[0]!.items[0]!, R(s1)).name).toBe(FOREIGN_CHARM_DEF.name);
    // the last holder lets it go: the def leaves the phone
    expect(heardStep({ ...s1, hunters: [{ ...s1.hunters[0]!, items: [] }] }).heardItems).toEqual({});
    // a second run changes nothing (the same object)
    expect(heardStep(s1)).toBe(s1);
  });

  test('heardStep prioritizes incoming defs at HEARD_MAX and updates an existing key with the fresh def', () => {
    const ids = Array.from({ length: HEARD_MAX + 1 }, (_, i) => customId(`h${String(i).padStart(4, '0')}`));
    const items = ids.map((id, i) => heldRef(i + 1, id));
    const s0: Save = { ...newSave(dev('d-p')), hunters: [{ ...newHunter(RULES), items }] };
    const initialDefs = Object.fromEntries(ids.slice(0, HEARD_MAX).map((id, i) => [id, { ...FOREIGN_CHARM_DEF, name: `Item ${i}` }]));
    const full = heardStep(s0, initialDefs);
    expect(Object.keys(full.heardItems)).toHaveLength(HEARD_MAX);
    // incoming 401st def wins over the oldest entry and stays bounded at HEARD_MAX
    const freshId = ids[HEARD_MAX]!, freshDef = { ...FOREIGN_CHARM_DEF, name: 'Fresh Reward' };
    const after = heardStep(full, { [freshId]: freshDef });
    expect(Object.keys(after.heardItems)).toHaveLength(HEARD_MAX);
    expect(after.heardItems[freshId]).toEqual(freshDef);
    expect(Object.hasOwn(after.heardItems, ids[HEARD_MAX - 1]!)).toBe(false);
    // incoming updated def for an already-heard key replaces the stale copy
    const updated = { ...FOREIGN_CHARM_DEF, name: 'Refreshed 0' };
    const refreshed = heardStep(after, { [ids[0]!]: updated });
    expect(refreshed.heardItems[ids[0]!]).toEqual(updated);
  });

  test('heardItems is pruned when the last copy leaves via remove, sell, use, hunter removal, or pack merge', () => {
    const flaskId = customId('foreignflask', OTHER_CATALOG_ID);
    const flaskDef: ItemDefData = { ...CUSTOM_FLASK_PINNED_DEF, name: 'Foreign Flask', value: 40 };
    const mkSave = (qty = 1): Save => {
      const h = { ...newHunter(RULES), id: hid('h1'), life: { at: 'up' as const, hp: 5 }, items: [heldRef(1, flaskId, qty)] };
      return heardStep({ ...newSave(dev('d-p')), hunters: [h] }, { [flaskId]: flaskDef });
    };
    // removeItem
    const sRem = mkSave(1), afterRem = atHunter(hid('h1'), h => removeItem(h, iid('i1'), false, R(sRem)))(sRem);
    if (isRefused(afterRem)) throw new Error(afterRem.why);
    expect(heardStep(afterRem).heardItems).toEqual({});
    // sell
    const sSell = mkSave(1), afterSell = atHunter(hid('h1'), h => sell(h, iid('i1'), 1, R(sSell), false))(sSell);
    if (isRefused(afterSell)) throw new Error(afterSell.why);
    expect(heardStep(afterSell).heardItems).toEqual({});
    // spendItem / useItem
    const sSpend = mkSave(1), afterSpend = atHunter(hid('h1'), h => spendItem(h, iid('i1'), R(sSpend)))(sSpend);
    if (isRefused(afterSpend)) throw new Error(afterSpend.why);
    expect(heardStep(afterSpend).heardItems).toEqual({});
    const sUse = mkSave(1), used = useItem(sUse.hunters[0]!, iid('i1'), [[]], R(sUse));
    if (isRefused(used)) throw new Error(used.why);
    expect(heardStep({ ...sUse, hunters: [used.hunter] }).heardItems).toEqual({});
    // removeHunter
    const sTwo: Save = { ...mkSave(1), hunters: [mkSave(1).hunters[0]!, { ...newHunter(RULES), id: hid('h2') }] };
    const afterDel = removeHunter(sTwo, hid('h1'), null);
    if (isRefused(afterDel)) throw new Error(afterDel.why);
    expect(afterDel.heardItems).toEqual({});
    // mergePack re-adding a previously deleted own-catalog item drops it from heardItems
    const sGm = gmSave();
    const packRes = parsePack(packOf(sGm, '2026-11-26T00:00:00.000Z', 'items', CUSTOM_BLADE_ID));
    if (!packRes.ok) throw new Error(packRes.why);
    const deleted = removeItemDef(sGm, CUSTOM_BLADE_ID);
    if (isRefused(deleted)) throw new Error(deleted.why);
    expect(Object.hasOwn(deleted.heardItems, CUSTOM_BLADE_ID)).toBe(true);
    const merged = mergePack(deleted, packRes.pack, 'add', stampSeq('m'));
    expect(Object.hasOwn(merged.save.library.items, CUSTOM_BLADE_ID)).toBe(true);
    expect(Object.hasOwn(merged.save.heardItems, CUSTOM_BLADE_ID)).toBe(false);
  });
});

describe('re-fitting non-held local hunters when a worn item def changes', () => {
  test('saveItemDef and editHeldDef clamp vitals of non-held wearers and leave fight-held hunters alone', () => {
    const vestId = customId('vital-vest');
    const richDef: ItemDefData = { ...CUSTOM_BLADE_DEF, name: 'Vital Vest', type: 'armor', slot: 'chest', bonus: { hpMax: 80, manaMax: 40 } };
    const poorDef: ItemDefData = { ...richDef, bonus: {} };
    const R0 = rulesWith({ [vestId]: richDef });
    const makeWearer = (id: string) => {
      const base = { ...newHunter(R0), id: hid(id), items: [heldRef(1, vestId)] };
      const worn = equip(base, iid('i1'), iid('i9'), false, R0);
      if (isRefused(worn)) throw new Error(worn.why);
      const max = hunterSheet(worn, R0).sheet;
      return { ...worn, life: { at: 'up' as const, hp: max.hpMax }, mana: max.manaMax };
    };
    const free = makeWearer('h1'), held = makeWearer('h2');
    const row = hunterRow(held, cid('c1'), R0);
    const fight = reduce(null, { type: 'add', fightId: fightId('f1'), rows: [row], openings: [] }, { rules: R0 }).fight!;
    const s0: Save = {
      ...gmSave(),
      hunters: [free, held],
      fight,
      library: { ...gmSave().library, items: { [vestId]: richDef } },
    };
    const after = editHeldDef(s0, free.items[0]!, poorDef, 'gm', RULES);
    if (isRefused(after)) throw new Error(after.why);
    const bareMax = hunterSheet(after.hunters[0]!, R(after)).sheet;
    expect(after.hunters[0]!.life).toEqual({ at: 'up', hp: bareMax.hpMax });
    expect(after.hunters[0]!.mana).toBe(bareMax.manaMax);
    // held hunter keeps its pre-edit sheet vitals untouched while in the fight
    expect(after.hunters[1]!).toBe(held);
    // removing the slot via saveItemDef also clamps vitals
    const s1 = { ...s0, fight: null };
    const slotless = saveItemDef(s1, vestId, { ...richDef, slot: null, type: 'misc' }, RULES);
    if (isRefused(slotless)) throw new Error(slotless.why);
    expect(slotless.hunters[0]!.life).toEqual({ at: 'up', hp: bareMax.hpMax });
    expect(slotless.hunters[1]!.life).toEqual({ at: 'up', hp: bareMax.hpMax });
  });

  test('resetting an edited built-in via removeItemDef or saving it back as shipped re-fits wearers', () => {
    const shipped = builtInDefData(DAGGER_DEF_ID, RULES)!;
    const buffed: ItemDefData = { ...shipped, bonus: { ...shipped.bonus, hpMax: 60 } };
    const Rbuf = rulesWith({ [DAGGER_DEF_ID]: buffed });
    const worn = equip({ ...newHunter(Rbuf), id: hid('h1'), items: [heldRef(1, DAGGER_DEF_ID)] }, iid('i1'), iid('i9'), false, Rbuf);
    if (isRefused(worn)) throw new Error(worn.why);
    const high = hunterSheet(worn, Rbuf).sheet.hpMax;
    const s0: Save = { ...gmSave(), hunters: [{ ...worn, life: { at: 'up', hp: high } }], library: { ...gmSave().library, items: { [DAGGER_DEF_ID]: buffed } } };
    const baseMax = hunterSheet(worn, RULES).sheet.hpMax;
    const reset = removeItemDef(s0, DAGGER_DEF_ID, RULES);
    if (isRefused(reset)) throw new Error(reset.why);
    expect(reset.hunters[0]!.life).toEqual({ at: 'up', hp: baseMax });
    const savedBack = saveItemDef(s0, DAGGER_DEF_ID, shipped, RULES);
    if (isRefused(savedBack)) throw new Error(savedBack.why);
    expect(savedBack.hunters[0]!.life).toEqual({ at: 'up', hp: baseMax });
  });
});

describe('the library item steps', () => {
  test('removeItemDef keeps a deleted custom item for its holder, reading as before; the shop drops it', () => {
    const s = { ...gmSave(), shop: [CUSTOM_BLADE_ID, DAGGER_DEF_ID] };
    const out = removeItemDef(s, CUSTOM_BLADE_ID);
    if (isRefused(out)) throw new Error(out.why);
    expect(Object.hasOwn(out.library.items, CUSTOM_BLADE_ID)).toBe(false);
    expect(out.heardItems[CUSTOM_BLADE_ID]).toEqual(CUSTOM_BLADE_DEF);
    expect(resolveItem(out.hunters[0]!.items[0]!, R(out)).name).toBe(CUSTOM_BLADE_DEF.name);
    expect(out.shop).toEqual([DAGGER_DEF_ID]);
    // a deleted def nothing names leaves no trace
    const gone = removeItemDef(s, SECRET_ID);
    expect(isRefused(gone) ? gone : gone.heardItems).toEqual({});
  });

  test('saveItemDef refuses a custom name another custom item holds, and saving a heard def into the library drops the heard copy', () => {
    const s = gmSave();
    expect(saveItemDef(s, customId('other'), { ...CUSTOM_BLADE_DEF, name: 'rift fang' }, RULES)).toMatchObject({ ok: false, why: 'taken' });
    const heard = heardStep({ ...s, hunters: [{ ...s.hunters[0]!, items: [...s.hunters[0]!.items, heldRef(5, FOREIGN_CHARM_ID)] }] }, { [FOREIGN_CHARM_ID]: FOREIGN_CHARM_DEF });
    const kept = saveItemDef(heard, FOREIGN_CHARM_ID, FOREIGN_CHARM_DEF, RULES);
    if (isRefused(kept)) throw new Error(kept.why);
    expect(kept.heardItems).toEqual({});
  });
});

describe('catalog rekeys (Fable C2)', () => {
  test('rekeyCatalog moves every def and ref of one catalog, keeping each stamp; another catalog is left alone', () => {
    const s0 = gmSave(), withForeign = { ...s0, hunters: [{ ...s0.hunters[0]!, items: [...s0.hunters[0]!.items, heldRef(9, FOREIGN_CHARM_ID)] }] };
    const to = catalogIdOf(parseCatalogKey('ck_another_phone_key_0123456789')!);
    const s = rekeyCatalog({ ...withForeign, library: { ...withForeign.library, rewards: [{ id: 'rb1' as never, name: 'Gift', rewards: { ...newRewards(), items: [grantRef(CUSTOM_BLADE_ID)] } }] } }, GM_CATALOG_ID, to);
    const moved = customItemDefId(to, stampOfItemDefId(CUSTOM_BLADE_ID)!);
    expect(s.library.catalogId).toBe(to);
    expect(Object.keys(s.library.items).every(k => catalogOfItemDefId(k as ItemDefId) === to)).toBe(true);
    expect(s.hunters[0]!.items.map(i => (i.kind === 'ref' ? i.defId : null))).toEqual([moved, DAGGER_DEF_ID, FOREIGN_CHARM_ID]);
    expect(s.stash.items[0]).toMatchObject({ defId: customItemDefId(to, stampOfItemDefId(CUSTOM_FLASK_PINNED_ID)!) });
    expect(s.library.rewards[0]!.rewards.items[0]).toMatchObject({ defId: moved });
    expect(resolveItem(s.hunters[0]!.items[0]!, R(s)).name).toBe(CUSTOM_BLADE_DEF.name);
  });

  test('the daily quest\'s reward override is walked: named, and rekeyed', () => {
    const s0 = { ...gmSave(), rulesOverrides: { dailyTemplate: { rewards: { items: [grantRef(SECRET_ID)] } } } };
    expect(namedIds(s0).has(SECRET_ID)).toBe(true);
    const to = catalogIdOf(parseCatalogKey('ck_daily_rekey_key_000000000000')!);
    const s = rekeyCatalog(s0, GM_CATALOG_ID, to);
    expect((s.rulesOverrides as any).dailyTemplate.rewards.items[0].defId).toBe(customItemDefId(to, stampOfItemDefId(SECRET_ID)!));
  });

  test('importRekey rekeys a campaign whose catalog has no key in the ring, once; a held key or no catalog changes nothing', () => {
    const s0 = gmSave(), fileOnly = { ...s0, settings: { ...s0.settings, sync: { ...s0.settings.sync, catalogKeys: {} } } };
    const key = parseCatalogKey('ck_fresh_import_key_abcdefghijk')!;
    const out = importRekey(fileOnly, key);
    expect(out.library.catalogId).toBe(catalogIdOf(key));
    expect(out.settings.sync.catalogKeys).toEqual({ [catalogIdOf(key)]: key });
    expect(Object.keys(out.library.items).every(k => catalogOfItemDefId(k as ItemDefId) === catalogIdOf(key))).toBe(true);
    expect(importRekey(out, parseCatalogKey('ck_yet_another_key_zzzzzzzzzzz')!)).toBe(out);
    expect(importRekey(s0, key)).toBe(s0);
    const blank = newSave(dev('d-x'));
    expect(importRekey(blank, key)).toBe(blank);
  });

  test('withCatalog mints a catalog once, from the key it is given', () => {
    const s = withCatalog(newSave(dev('d-x')), GM_CATALOG_KEY);
    expect(s.library.catalogId).toBe(GM_CATALOG_ID);
    expect(s.settings.sync.catalogKeys).toEqual({ [GM_CATALOG_ID]: GM_CATALOG_KEY });
    expect(withCatalog(s, parseCatalogKey('ck_second_key_should_not_count')!)).toBe(s);
  });
});

describe('vis-leak: no def of an item a phone was not shown leaves the GM\'s phone', () => {
  const allText = (v: unknown): string => JSON.stringify(v);

  test('the stash doc carries the defs of its own lines only', () => {
    const s = gmSave(), doc = stashDoc(s.stash, R(s));
    expect(Object.keys(doc.defs)).toEqual([CUSTOM_FLASK_PINNED_ID]);
    expect(allText(doc)).not.toContain(SECRET_DEF.name);
    expect(allText(doc)).not.toContain(CUSTOM_BLADE_DEF.name);
  });

  test('an award carries the def of what it gives, and nothing else of the library', () => {
    const s = gmSave();
    const ev = newEvent('award', { to: ['d-p:h1' as never], rewards: { ...newRewards(), items: [grantRef(CUSTOM_BLADE_ID)] } }, { device: 'd-gm', now: 1, rand: 0.5 }, R(s));
    expect(ev).not.toBeNull();
    const text = allText(ev);
    expect(text).toContain(CUSTOM_BLADE_DEF.name);
    expect(text).not.toContain(SECRET_DEF.name);
    expect(text).not.toContain(CUSTOM_FLASK_PINNED_DEF.name);
  });

  test('a pushed sheet carries the defs of its own bag; a face names unworn lines only, and nothing with bags hidden', () => {
    const s = gmSave(), h = { ...s.hunters[0]!, items: [...s.hunters[0]!.items, heldAdhoc(4, ADHOC_CHARM_DEF)] };
    const defs = bagDefs(h.items, R(s));
    expect(Object.keys(defs)).toEqual([CUSTOM_BLADE_ID]);
    const shown = hunterFace(h, { bags: true }, defs).face.bag!;
    expect(shown.map(l => l.name ?? null)).toEqual([CUSTOM_BLADE_DEF.name, null, ADHOC_CHARM_DEF.name]);
    expect(allText(hunterFace(h, { bags: false }, defs))).not.toContain(CUSTOM_BLADE_DEF.name);
    expect(allText({ h, defs })).not.toContain(SECRET_DEF.name);
  });
});

describe('the Bag\'s Edit, strict (Fable section 1)', () => {
  test('bagEdit offers the def only where the phone owns it; a player in a room gets none on a reference', () => {
    const blade = heldRef(1, CUSTOM_BLADE_ID), dagger = heldRef(2, DAGGER_DEF_ID), foreign = heldRef(3, FOREIGN_CHARM_ID), own = heldAdhoc(4, ADHOC_CHARM_DEF);
    expect(['alone', 'gm', 'player'].map(seat => bagEdit(blade, seat as never, GM_CATALOG_ID))).toEqual(['def', 'def', 'none']);
    expect(['alone', 'gm', 'player'].map(seat => bagEdit(dagger, seat as never, GM_CATALOG_ID))).toEqual(['def', 'def', 'none']);
    expect(bagEdit(foreign, 'gm', GM_CATALOG_ID)).toBe('none');
    expect(bagEdit(own, 'player', null)).toBe('adhoc');
  });

  test('core refuses a player\'s edit or detach of a reference; the GM\'s edit reaches every copy', () => {
    const s = gmSave(), line = s.hunters[0]!.items[0]!, renamed = { ...CUSTOM_BLADE_DEF, name: 'Rift Fang Reforged' };
    expect(editHeldDef(s, line, renamed, 'player', RULES)).toMatchObject({ ok: false, why: 'not-yours' });
    expect(detachItem(s.hunters[0]!, line.id, SECRET_ID, false, R(s), 'player', GM_CATALOG_ID)).toMatchObject({ ok: false, why: 'not-yours' });
    const edited = editHeldDef(s, line, renamed, 'gm', RULES);
    if (isRefused(edited)) throw new Error(edited.why);
    expect(resolveItem(edited.hunters[0]!.items[0]!, R(edited)).name).toBe('Rift Fang Reforged');
    const split = detachItem(s.hunters[0]!, line.id, SECRET_ID, false, R(s), 'gm', GM_CATALOG_ID);
    if (isRefused(split)) throw new Error(split.why);
    expect(split.items[0]).toMatchObject({ kind: 'ref', defId: SECRET_ID });
  });
});
