// Browser tests for item sync PR 4: live catalog publish/link/read across multiple rooms, built-in status and item
// overrides, deleted custom items, mid-fight staging until End fight, foreign GM items, custom shop sync, and 409 conflicts.
import {
  test, expect, onboardGM, onboardPlayer, createRoom, go, activeHunter, addLibraryItem, answerWindow, roomHeaders, tapIfShown,
} from './helpers.ts';
import type { Page } from '@playwright/test';

async function openGmRules(page: Page) {
  await go(page, 'gm');
  const tog = page.locator('.gm-sec[data-sec="rules"] [data-tog="rules"]');
  await tog.scrollIntoViewIfNeeded();
  if ((await tog.getAttribute('aria-expanded')) !== 'true') await tog.tap();
}

async function giveRefItem(player: Page, defId: string, def?: Record<string, unknown>) {
  await player.evaluate(({ defId, def }) => {
    const h = hunterApp.store.active();
    hunterApp.api.inventory.addItem(h.id, def ? { kind: 'ref', defId, qty: 1, def } : { kind: 'ref', defId, qty: 1 });
  }, { defId, def });
}

test('an edit reaches Room A and unopened Room B with no tap, Grievous Wounds moves owned Thornmail in both, built-in edit/reset and custom shop reach players', async ({ device }) => {
  const gm = (await device('gm')).page;
  const playerA = (await device('player-a')).page;
  const playerB = (await device('player-b')).page;

  await onboardGM(gm);
  const bladeId = await addLibraryItem(gm, {
    name: 'Starlight Edge', rar: 'rare', type: 'weapon', slot: 'weapon', dice: '1d8', attack: 'strike',
    bonus: { str: 2 }, desc: 'Forged from starlight.', armor: 0, resist: 0,
  });

  // Open Room A and join Player A
  const codeA = await createRoom(gm);
  await onboardPlayer(playerA, 'Aria', codeA);

  // Open Room B (leaving Room A) and join Player B
  await go(gm, 'room');
  await gm.locator('#view-room [data-leave]').tap();
  const codeB = await createRoom(gm);
  await onboardPlayer(playerB, 'Bram', codeB);

  // Reopen Room A so Room B is now UNOPENED on the GM phone
  await go(gm, 'room');
  await gm.locator('#view-room [data-leave]').tap();
  await gm.locator(`#view-room [data-gmlist] button[data-gr="rejoin"][data-code="${codeA}"]`).tap();
  await expect.poll(async () => gm.evaluate(() => hunterApp.api.sync.room())).toBe(codeA);

  // Give both players Starlight Edge and built-in Thornmail (b:thornmail)
  const bladeDef = await gm.evaluate(id => JSON.parse(JSON.stringify(hunterApp.store.get().library.items[id])), bladeId);
  await giveRefItem(playerA, bladeId, bladeDef);
  await giveRefItem(playerA, 'b:thornmail');
  await giveRefItem(playerB, bladeId, bladeDef);
  await giveRefItem(playerB, 'b:thornmail');

  // Verify initial read on both players
  for (const p of [playerA, playerB]) {
    await expect.poll(async () => {
      const bag = (await activeHunter(p)).bag;
      const blade = bag.find((i: any) => i.defId === bladeId);
      return blade ? { name: blade.name, dice: blade.dice } : null;
    }, { timeout: 15_000 }).toEqual({ name: 'Starlight Edge', dice: '1d8' });
  }

  // GM edits Starlight Edge in Workshop — Room B is unopened, no tap on either player phone
  await go(gm, 'workshop');
  await gm.locator(`#view-workshop [data-ws="item"] li[data-id="${bladeId}"] [data-act="edit"]`).tap();
  const dlg = gm.locator('.lf-overlay [role=dialog]');
  await expect(dlg).toBeVisible();
  await dlg.locator('#lf-name').fill('Starlight Edge II');
  await dlg.locator('#lf-dice').fill('2d6');
  await dlg.locator('[data-apply]').tap();
  await expect(dlg).toHaveCount(0);

  for (const [label, p] of [['Room A', playerA], ['unopened Room B', playerB]] as const) {
    await expect.poll(async () => {
      const bag = (await activeHunter(p)).bag;
      const blade = bag.find((i: any) => i.defId === bladeId);
      return blade ? { name: blade.name, dice: blade.dice } : null;
    }, { timeout: 15_000, message: `edit reaches ${label} with no tap` }).toEqual({ name: 'Starlight Edge II', dice: '2d6' });
  }

  // GM edits Grievous Wounds to 75% in Rules editor -> owned Thornmail moves in both rooms
  await openGmRules(gm);
  const gwRow = gm.locator('[data-gw-row="grievous"]');
  await gwRow.locator('[data-gw-input="grievous"]').fill('75');
  await gwRow.locator('[data-gw-apply]').tap();
  await expect(gwRow).toContainText('Healing received −75%');

  for (const [label, p] of [['Room A', playerA], ['unopened Room B', playerB]] as const) {
    await expect.poll(async () => p.evaluate(() => {
      const h = hunterApp.store.active();
      const thorn = hunterApp.api.inventory.bag(h).find((i: any) => i.defId === 'b:thornmail');
      const trigOp = thorn?.worn?.triggers?.[0]?.ops?.[1];
      const shareOp = trigOp?.op === 'applyStatus' ? trigOp.def?.ops?.find((o: any) => o.op === 'share' && o.on === 'healed') : null;
      return shareOp?.pct ?? null;
    }), { timeout: 15_000, message: `Grievous Wounds edit moves owned Thornmail in ${label}` }).toBe(-75);
  }

  // Workshop Built-in items fold: edit Thornmail -> reaches players, Reset -> reverts to shipped
  await go(gm, 'workshop');
  const builtFold = gm.locator('#view-workshop [data-ws="item"] .ws-built');
  await builtFold.locator('summary').tap();
  await builtFold.locator('li[data-id="b:thornmail"] [data-act="edit"]').tap();
  const bDlg = gm.locator('.lf-overlay [role=dialog]');
  await expect(bDlg).toBeVisible();
  await bDlg.locator('#lf-name').fill('Spiked Thornmail');
  await bDlg.locator('[data-apply]').tap();
  await expect(bDlg).toHaveCount(0);

  await expect.poll(async () => {
    const bag = (await activeHunter(playerA)).bag;
    return bag.find((i: any) => i.defId === 'b:thornmail')?.name ?? null;
  }, { timeout: 15_000 }).toBe('Spiked Thornmail');

  // Reset built-in Thornmail from Workshop ⋯ menu
  const changedRow = gm.locator('#view-workshop [data-ws="item"] li[data-id="b:thornmail"]');
  await expect(changedRow).toContainText('changed built-in');
  await changedRow.locator('[data-act="more"]').tap();
  await gm.locator('.sys-overlay.show .sys-actions button', { hasText: 'Reset' }).tap();
  await answerWindow(gm, 'Reset Spiked Thornmail?', 'Reset item');

  await expect.poll(async () => {
    const bag = (await activeHunter(playerA)).bag;
    return bag.find((i: any) => i.defId === 'b:thornmail')?.name ?? null;
  }, { timeout: 15_000 }).toBe('Thornmail');

  // GM's custom shop reaches Player A
  await gm.evaluate(id => {
    hunterApp.store.update((s: any) => { s.shop = [id]; }, 'test-shop');
  }, bladeId);
  await expect.poll(async () => playerA.evaluate(() => hunterApp.api.inventory.shop().map((i: any) => i.name)), { timeout: 15_000 })
    .toEqual(['Starlight Edge II']);
});

test('a deleted custom item keeps working for its holder and reads the same on the GM row', async ({ device }) => {
  const gm = (await device('gm')).page;
  const player = (await device('player')).page;

  await onboardGM(gm);
  const fangId = await addLibraryItem(gm, {
    name: 'Phantom Fang', rar: 'epic', type: 'weapon', slot: 'weapon', dice: '1d10', attack: 'strike',
    bonus: { str: 2 }, desc: 'Spectral edge.', armor: 0, resist: 0,
  });
  const code = await createRoom(gm);
  await onboardPlayer(player, 'Sora', code);

  const fangDef = await gm.evaluate(id => JSON.parse(JSON.stringify(hunterApp.store.get().library.items[id])), fangId);
  await giveRefItem(player, fangId, fangDef);
  await player.evaluate(id => {
    const h = hunterApp.store.active();
    const line = h.items.find((i: any) => i.defId === id);
    if (line) hunterApp.api.inventory.equip(h.id, line.id);
  }, fangId);

  // GM edits Phantom Fang -> Phantom Fang+ (+4 str, 2d8)
  await go(gm, 'workshop');
  await gm.locator(`#view-workshop [data-ws="item"] li[data-id="${fangId}"] [data-act="edit"]`).tap();
  const dlg = gm.locator('.lf-overlay [role=dialog]');
  await expect(dlg).toBeVisible();
  await dlg.locator('#lf-name').fill('Phantom Fang+');
  await dlg.locator('#lf-dice').fill('2d8');
  await dlg.locator('[data-bonus="str"]').fill('4');
  await dlg.locator('[data-apply]').tap();
  await expect(dlg).toHaveCount(0);

  await expect.poll(async () => {
    const bag = (await activeHunter(player)).bag;
    const it = bag.find((i: any) => i.defId === fangId);
    return it ? { name: it.name, dice: it.dice, str: it.bonus.str } : null;
  }, { timeout: 15_000 }).toEqual({ name: 'Phantom Fang+', dice: '2d8', str: 4 });

  // Wait for a GM poll that carries the player's re-pushed sheet with the edited def. Before the delete the GM reads its own
  // library def, so polling the GM's view would pass on any sheet that names the item (Fable's diagnosis, design/npc/itemsync-flake-fable.md).
  await gm.waitForResponse(async r => {
    if (r.request().method() !== 'GET' || !/\/api\/rooms\/[^/]+\?after=/.test(r.url()) || !r.ok()) return false;
    const sheets = (await r.json()).sheets ?? {};
    return Object.values(sheets).some((s: any) => s.data?.defs?.[fangId]?.name === 'Phantom Fang+');
  }, { timeout: 30_000 });

  const revBeforeDel = await gm.evaluate(() => hunterApp.store.get().settings.sync.catalogSent?.rev ?? 0);

  const heardDelete = player.waitForResponse(async r =>
    r.request().method() === 'POST' && r.url().includes('/catalog/read') && r.ok() && (await r.json()).rev > revBeforeDel, { timeout: 30_000 });
  // GM deletes Phantom Fang+ from Workshop
  await gm.locator(`#view-workshop [data-ws="item"] li[data-id="${fangId}"] [data-act="more"]`).tap();
  await gm.locator('.sys-overlay.show .sys-actions button', { hasText: 'Delete' }).tap();
  await answerWindow(gm, 'Delete from library?', 'Delete item');

  // Wait for GM's deletion to publish a newer catalog rev
  await expect.poll(async () => gm.evaluate(() => hunterApp.store.get().settings.sync.catalogSent?.rev ?? 0), { timeout: 15_000 })
    .toBeGreaterThan(revBeforeDel);

  // The player hears the delete, then the deleted item still works identically on BOTH player and GM
  await heardDelete;
  const playerIt = await player.evaluate(id => {
    const h = hunterApp.store.active();
    const it = hunterApp.api.inventory.bag(h).find((i: any) => i.defId === id);
    return it ? { name: it.name, dice: it.dice, str: it.bonus.str, unknown: !!it.unknown } : null;
  }, fangId);
  expect(playerIt).toEqual({ name: 'Phantom Fang+', dice: '2d8', str: 4, unknown: false });

  await expect.poll(() => gm.evaluate(id => {
    const sheet = hunterApp.api.sync.remoteSheets()[0];
    if (!sheet) return null;
    const it = hunterApp.api.inventory.bag(sheet.data).find((i: any) => i.defId === id);
    return it ? { name: it.name, dice: it.dice, str: it.bonus.str, unknown: !!it.unknown } : null;
  }, fangId), { timeout: 15_000 }).toEqual({ name: 'Phantom Fang+', dice: '2d8', str: 4, unknown: false });
});

test('a mid-fight edit is staged during combat and lands at End fight', async ({ device }) => {
  const gm = (await device('gm')).page;
  const player = (await device('player')).page;

  await onboardGM(gm);
  const bandId = await addLibraryItem(gm, {
    name: 'Aegis Band', rar: 'rare', type: 'accessory', slot: 'ring1', dice: '',
    bonus: { vit: 10 }, desc: 'Bolsters vitality.', armor: 0, resist: 0,
  });
  const code = await createRoom(gm);
  await onboardPlayer(player, 'Kael', code);

  const bandDef = await gm.evaluate(id => JSON.parse(JSON.stringify(hunterApp.store.get().library.items[id])), bandId);
  await giveRefItem(player, bandId, bandDef);
  await player.evaluate(id => {
    const h = hunterApp.store.active();
    const line = h.items.find((i: any) => i.defId === id);
    if (line) hunterApp.api.inventory.equip(h.id, line.id);
    // Refill HP to the boosted maximum
    const max = hunterApp.api.hunter.sheet(hunterApp.store.active()).sheet.hpMax;
    hunterApp.api.hunter.heal(h.id, max);
  }, bandId);

  const beforeFight = await activeHunter(player);
  const hpBefore = beforeFight.hp;
  const hpMaxBefore = beforeFight.derived.hpMax;
  expect(hpBefore).toBe(hpMaxBefore);

  // Wait for GM to receive Kael's sheet
  await expect.poll(async () => gm.evaluate(() => hunterApp.api.sync.remoteSheets().length), { timeout: 15_000 }).toBe(1);

  // GM starts a fight with Kael (remote hunter) and a monster
  await go(gm, 'combat');
  await gm.locator('#view-combat [data-addparty]').tap();
  await gm.locator('#view-combat [data-addm]').tap();
  await gm.locator('#view-combat [data-start]').tap();

  // Wait until player's phone sees the active fight doc holding Kael
  await expect.poll(async () => player.evaluate(() => {
    const f = hunterApp.api.sync.doc('fight');
    return !!(f && !f.ended && f.active && hunterApp.api.hunter.fightOf({ hid: hunterApp.store.active().id }));
  }), { timeout: 15_000 }).toBe(true);

  const revDuring = await gm.evaluate(() => hunterApp.store.get().settings.sync.catalogSent?.rev ?? 0);

  // Mid-fight: GM edits Aegis Band -> Cracked Band (removing +10 vit)
  await go(gm, 'workshop');
  await gm.locator(`#view-workshop [data-ws="item"] li[data-id="${bandId}"] [data-act="edit"]`).tap();
  const dlg = gm.locator('.lf-overlay [role=dialog]');
  await expect(dlg).toBeVisible();
  await dlg.locator('#lf-name').fill('Cracked Band');
  await dlg.locator('[data-bonus="vit"]').fill('');
  await dlg.locator('[data-apply]').tap();
  await expect(dlg).toHaveCount(0);

  // Wait until GM's new catalog rev is published on the server
  await expect.poll(async () => gm.evaluate(() => hunterApp.store.get().settings.sync.catalogSent?.rev ?? 0), { timeout: 15_000 })
    .toBeGreaterThan(revDuring);

  // Let player poll several times while the fight is still running
  await player.waitForTimeout(3500);
  const duringFight = await activeHunter(player);
  const bandDuring = duringFight.bag.find((i: any) => i.defId === bandId);
  expect(bandDuring.name, 'mid-fight edit stays staged while fight holds hunter').toBe('Aegis Band');
  expect(bandDuring.bonus.vit).toBe(10);
  expect(duringFight.derived.hpMax).toBe(hpMaxBefore);

  // GM ends the fight -> staged catalog promotes on player's phone and fits HP
  await go(gm, 'combat');
  await tapIfShown(gm, '#view-combat [data-tools-open]');
  await gm.locator('#view-combat [data-end]').tap();
  await answerWindow(gm, 'Fight over', 'End without XP');

  await expect.poll(async () => {
    const after = await activeHunter(player);
    const band = after.bag.find((i: any) => i.defId === bandId);
    return { name: band?.name ?? null, vit: band?.bonus?.vit ?? 0, fittedDown: after.hp < hpBefore && after.derived.hpMax < hpMaxBefore };
  }, { timeout: 15_000 }).toEqual({ name: 'Cracked Band', vit: 0, fittedDown: true });
});

test('another GM\'s custom item works in my room', async ({ device }) => {
  const gm1 = (await device('gm-1')).page;
  const gm2 = (await device('gm-2')).page;
  const player = (await device('player')).page;

  await onboardGM(gm1);
  const sunId = await addLibraryItem(gm1, {
    name: 'Foreign Sunblade', rar: 'legendary', type: 'weapon', slot: 'weapon', dice: '2d6', attack: 'strike',
    bonus: { agi: 3 }, desc: 'Forged in another campaign.', armor: 0, resist: 0,
  });
  const room1 = await createRoom(gm1);
  await onboardPlayer(player, 'Rin', room1);

  const sunDef = await gm1.evaluate(id => JSON.parse(JSON.stringify(hunterApp.store.get().library.items[id])), sunId);
  await giveRefItem(player, sunId, sunDef);

  // Player leaves Room 1 and joins GM 2's Room 2
  await onboardGM(gm2);
  const room2 = await createRoom(gm2);

  await go(player, 'room');
  await player.locator('#view-room [data-leave]').tap();
  await player.locator('#view-room [data-code]').fill(room2);
  await player.locator('#view-room [data-join]').tap();
  await expect.poll(async () => player.evaluate(() => hunterApp.api.sync.room())).toBe(room2);

  // Both Player and GM 2 read GM 1's Foreign Sunblade intact
  await expect.poll(async () => {
    const it = (await activeHunter(player)).bag.find((i: any) => i.defId === sunId);
    return it ? { name: it.name, dice: it.dice, agi: it.bonus.agi, unknown: !!it.unknown } : null;
  }, { timeout: 15_000 }).toEqual({ name: 'Foreign Sunblade', dice: '2d6', agi: 3, unknown: false });

  await expect.poll(async () => gm2.evaluate(id => {
    const sheet = hunterApp.api.sync.remoteSheets()[0];
    if (!sheet) return null;
    const it = hunterApp.api.inventory.bag(sheet.data).find((i: any) => i.defId === id);
    return it ? { name: it.name, dice: it.dice, agi: it.bonus.agi, unknown: !!it.unknown } : null;
  }, sunId), { timeout: 15_000 }).toEqual({ name: 'Foreign Sunblade', dice: '2d6', agi: 3, unknown: false });
});

test('a 409 catalog conflict shows the two buttons in Workshop and resolves with Use theirs or Keep mine', async ({ device }) => {
  const gm = (await device('gm', { allowConsole: [/status of 409/] })).page;
  await onboardGM(gm);
  const bladeId = await addLibraryItem(gm, {
    name: 'Moonblade', rar: 'rare', type: 'weapon', slot: 'weapon', dice: '1d8', attack: 'strike',
    bonus: {}, desc: 'Lunar steel.', armor: 0, resist: 0,
  });
  await createRoom(gm);

  // Wait for rev 1 to publish
  await expect.poll(async () => gm.evaluate(() => hunterApp.store.get().settings.sync.catalogSent?.rev ?? 0), { timeout: 15_000 })
    .toBeGreaterThanOrEqual(1);

  const info = await gm.evaluate(id => {
    const s = hunterApp.store.get();
    const catId = s.library.catalogId;
    return { catId, key: s.settings.sync.catalogKeys[catId], rev: s.settings.sync.catalogSent.rev, def: s.library.items[id] };
  }, bladeId);

  // Simulate another GM device pushing rev + 1 directly to the server with a different item name
  const headers = { ...(await roomHeaders(gm)), 'Content-Type': 'application/json', 'X-Catalog-Key': info.key };
  const putRes = await gm.request.put(`/api/catalogs/${info.catId}`, {
    headers,
    data: { ifRev: info.rev, data: { items: { [bladeId]: { ...info.def, name: 'Moonblade From Other Phone' } }, statuses: {}, shop: null } },
  });
  expect(putRes.status()).toBe(200);
  const rev2 = (await putRes.json()).rev;

  // Now edit locally on GM's phone -> PUT with stale ifRev gets 409 -> conflict banner appears in Workshop
  await go(gm, 'workshop');
  await gm.locator(`#view-workshop [data-ws="item"] li[data-id="${bladeId}"] [data-act="edit"]`).tap();
  const dlg = gm.locator('.lf-overlay [role=dialog]');
  await expect(dlg).toBeVisible();
  await dlg.locator('#lf-name').fill('Moonblade Local Edit');
  await dlg.locator('[data-apply]').tap();
  await expect(dlg).toHaveCount(0);

  const banner = gm.locator('#view-workshop [data-ws-cat-conflict]');
  await expect(banner).toBeVisible({ timeout: 15_000 });
  await expect(banner.locator('[data-cat-resolve="mine"]')).toHaveText('Keep this phone\'s items');
  await expect(banner.locator('[data-cat-resolve="theirs"]')).toHaveText('Use the other phone\'s items');

  // Resolve 1: Use the other phone's items -> adopts server doc
  await banner.locator('[data-cat-resolve="theirs"]').tap();
  await expect(banner).toHaveCount(0);
  await expect.poll(async () => gm.evaluate(id => hunterApp.store.get().library.items[id]?.name ?? null, bladeId))
    .toBe('Moonblade From Other Phone');

  // Create a second conflict: server moves to rev2 + 1 while GM edits locally
  const putRes2 = await gm.request.put(`/api/catalogs/${info.catId}`, {
    headers,
    data: { ifRev: rev2, data: { items: { [bladeId]: { ...info.def, name: 'Moonblade Server Third' } }, statuses: {}, shop: null } },
  });
  expect(putRes2.status()).toBe(200);

  await gm.locator(`#view-workshop [data-ws="item"] li[data-id="${bladeId}"] [data-act="edit"]`).tap();
  await expect(dlg).toBeVisible();
  await dlg.locator('#lf-name').fill('Moonblade Keep Mine');
  await dlg.locator('[data-apply]').tap();
  await expect(dlg).toHaveCount(0);

  await expect(banner).toBeVisible({ timeout: 15_000 });
  // Resolve 2: Keep this phone's items -> overwrites server at rev2 + 2
  await banner.locator('[data-cat-resolve="mine"]').tap();
  await expect(banner).toHaveCount(0);
  await expect.poll(async () => gm.evaluate(() => hunterApp.store.get().settings.sync.catalogSent?.rev ?? 0), { timeout: 15_000 })
    .toBeGreaterThan(rev2 + 1);
  const getRes = await gm.request.get(`/api/catalogs/${info.catId}`, { headers });
  expect(getRes.status()).toBe(200);
  const srvDoc = (await getRes.json()).data;
  expect(srvDoc.items[bladeId].name).toBe('Moonblade Keep Mine');
});
