import { test, expect, setupGoblinDenGM, onboardPlayer, createRoom, go, dismissAll, startGoblinDenFight, chooseList, PHONE, SMALL_PHONE } from './helpers.ts';
import type { Locator, Page } from '@playwright/test';

/** A picture drawn by the one drawer: its reference, its side in px, and whether it hides from a screen reader. */
const drawn = (pic: Locator) => pic.evaluate(el => ({ href: el.querySelector('use')!.getAttribute('href'), side: Math.round(el.getBoundingClientRect().width), hidden: el.getAttribute('aria-hidden'), color: getComputedStyle(el).color }));
const noSideScroll = (p: Page) => p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
const inside = async (row: Locator, width: number) => { const b = (await row.boundingBox())!; expect(b.x).toBeGreaterThanOrEqual(0); expect(b.x + b.width).toBeLessThanOrEqual(width); };

for (const viewport of [SMALL_PHONE, PHONE]) {
  test(`on a ${viewport.width} px phone each of six bag lines starts with its item's picture, 24 px in the rarity's colour, and the line fits`, async ({ device }) => {
    const p = (await device(`bag-${viewport.width}`, { viewport })).page;
    await onboardPlayer(p, 'Mira Test');
    await dismissAll(p);
    const six: [string, Record<string, unknown>, string][] = [
      ['Bone Blade', { type: 'weapon', slot: 'weapon', rar: 'common' }, 'sword'],
      ['Short Bow', { type: 'weapon', slot: 'weapon', attack: 'shot', rar: 'uncommon' }, 'bow'],
      ['Iron Helm', { type: 'armor', slot: 'head', rar: 'rare' }, 'helm'],
      ['Old Ring', { type: 'accessory', slot: 'ring1', rar: 'epic' }, 'ring'],
      ['Tonic', { type: 'consumable', rar: 'legendary' }, 'potion'],
      ['Spirit Crystal', { type: 'consumable', revive: true, rar: 'mythic' }, 'crystal'],
    ];
    await p.evaluate(items => { const h = hunterApp.store.active(); for (const [name, rest] of items) hunterApp.api.inventory.addItem(h.id, { name, qty: 1, desc: '', ...rest }); }, six.map(([n, r]) => [n, r] as const));
    await go(p, 'status');
    for (const [name, rest, key] of six) {
      const card = p.locator('#view-status [data-panel="inventory"] [data-list] .inv-card', { hasText: name });
      const pic = card.locator('.top > .ic').first();
      await expect(pic, name).toHaveCount(1);
      const d = await drawn(pic);
      expect(d, name).toMatchObject({ href: `#i-${key}`, side: 24, hidden: 'true' });
      const rar = await card.locator('.rar').evaluate(el => getComputedStyle(el).color);
      expect(d.color, `${name} is drawn in its rarity's colour`).toBe(rar);
      expect(await card.locator('.i-name').textContent()).toBe(name);
      await inside(card, viewport.width);
      expect(rest.rar).toBeTruthy();
    }
    expect(await noSideScroll(p)).toBe(true);
  });

  test(`on a ${viewport.width} px phone each of six status chips on the sheet holds its status's picture, 14 px, before its label, and the row fits`, async ({ device }) => {
    const p = (await device(`chips-${viewport.width}`, { viewport })).page;
    await onboardPlayer(p, 'Mira Test');
    await dismissAll(p);
    const six: [string, string][] = [['poisoned', 'poison'], ['burning', 'flame'], ['bleeding', 'blood'], ['stunned', 'dizzy'], ['hasted', 'wing'], ['frightened', 'fear']];
    await p.evaluate(keys => { const h = hunterApp.store.active(); for (const k of keys) hunterApp.api.hunter.addCondition(h.id, { key: k, def: hunterApp.rules().conditions[k], rounds: 3, source: { id: null, tier: 0 } }); }, six.map(([k]) => k));
    await go(p, 'status');
    for (const [key, pic] of six) {
      const chip = p.locator(`#view-status [data-chips] [data-chip="${key}"]`);
      const d = await drawn(chip.locator('.c-info .ic'));
      expect(d, key).toMatchObject({ href: `#i-${pic}`, side: 14, hidden: 'true' });
      await expect(chip.locator('.c-info')).toContainText(/\w/);
      await inside(chip, viewport.width);
    }
    expect(await noSideScroll(p)).toBe(true);
    const box = p.locator('#view-status [data-chips]');
    for (const c of await box.locator('.chip').all()) expect((await c.boundingBox())!.height).toBeGreaterThanOrEqual(40);
  });
}

test('the Bestiary draws each monster\'s picture, 32 px left of its name, on the GM\'s phone and on a player\'s through the codex doc', async ({ device }) => {
  const gm = (await device('gm', { viewport: PHONE })).page, player = (await device('player', { viewport: PHONE })).page;
  await setupGoblinDenGM(gm);
  const code = await createRoom(gm);
  await onboardPlayer(player, 'Mira Test', code);
  await dismissAll(player);
  await gm.evaluate(() => {
    const s = hunterApp.store;
    const m = hunterApp.api.bestiary.save({ name: 'Cave Wolf', rank: 'E', archetype: 'skirmisher', kind: 'normal', type: 'Beast' }, true);
    s.update(() => { s.get().codex['cave wolf|E'] = { name: 'Cave Wolf', rank: 'E', kills: 2, firstAt: new Date().toISOString(), lastAt: new Date().toISOString(), monsterId: m.id }; }, 'test-setup');
  });
  await test.step('the GM\'s card has the wolf', async () => {
    await go(gm, 'bestiary');
    const card = gm.locator('#view-bestiary .bst-card', { hasText: 'Cave Wolf' });
    expect(await drawn(card.locator('.bst-h > .ic'))).toMatchObject({ href: '#i-wolf', side: 32, hidden: 'true' });
    expect(await card.locator('.bst-h .ic').evaluate(el => el.compareDocumentPosition(el.parentElement!.querySelector('.nm')!) & Node.DOCUMENT_POSITION_FOLLOWING)).toBeTruthy();
    await inside(card, PHONE.width);
  });
  await test.step('a player\'s card for the same monster shows the same picture', async () => {
    await go(player, 'bestiary');
    const card = player.locator('#view-bestiary .bst-card', { hasText: 'Cave Wolf' });
    await expect(card).toBeVisible();
    expect(await drawn(card.locator('.bst-h > .ic'))).toMatchObject({ href: '#i-wolf', side: 32, hidden: 'true' });
    await inside(card, PHONE.width);
    expect(await noSideScroll(player)).toBe(true);
  });
});

test('a hunter\'s potion, in the hotbar\'s drawer on the map, shows the picture the bag shows for it', async ({ device }) => {
  const gm = (await device('gm', { viewport: PHONE })).page;
  await setupGoblinDenGM(gm);
  const item = await gm.evaluate(() => {
    const brakk = hunterApp.store.get().hunters.find((h: any) => h.name === 'Brakk Ironhide');
    return hunterApp.api.inventory.addItem(brakk.id, hunterApp.api.inventory.itemTemplates().find((t: any) => t.name === 'Health Potion (E)')).id;
  });
  await chooseList(gm);
  await startGoblinDenFight(gm);
  await gm.evaluate(() => hunterApp.store.update((d: any) => { const f = d.fight; f.currentId = f.rows.find((r: any) => r.name === 'Brakk Ironhide').id; }, 'test-setup'));
  await gm.locator('#view-combat [data-fview="map"]').tap();
  const map = gm.locator('#view-combat [data-mapbox]');
  await map.locator('[data-hot] [data-more]').tap();
  const slot = map.locator(`[data-drawer] [data-ab="item-${item}"]`);
  await expect(slot).toBeVisible();
  expect(await drawn(slot.locator('.ic'))).toMatchObject({ href: '#i-potion', side: 20, hidden: 'true' });
  await inside(slot, PHONE.width);
});

test('a status on the GM card and on the player\'s table HUD starts with its picture, and the chip fits a phone', async ({ device }) => {
  const gm = (await device('gm', { viewport: PHONE })).page, player = (await device('player', { viewport: PHONE })).page;
  await setupGoblinDenGM(gm);
  await chooseList(gm);
  const code = await createRoom(gm);
  await onboardPlayer(player, 'Kai Test', code);
  await chooseList(player);
  await dismissAll(player, 4);
  await expect(gm.locator('#gm-board .gm-card.remote', { hasText: 'Kai Test' })).toHaveCount(1);
  await go(gm, 'combat');
  await expect(gm.locator('#view-combat [data-hsel] option', { hasText: 'Kai Test (player phone)' })).toHaveCount(1);
  await gm.locator('#view-combat [data-hsel]').selectOption({ label: 'Kai Test (player phone)' });
  await gm.locator('#view-combat [data-addh]').tap();
  await gm.locator('#view-combat [data-qline]').fill('Cave Rat, E, brute');
  await gm.locator('#view-combat [data-qadd]').tap();
  await gm.locator('#view-combat .cmb-row', { hasText: 'Kai Test' }).first().locator('[data-pick]').tap();
  const card = gm.locator('#view-combat .cmb-card');
  await expect(card.locator('h3')).toContainText('Kai Test');
  await card.locator('[data-cforge]').tap();
  await gm.locator('.fg-overlay [data-existing] [data-chip="poisoned"]').tap();
  const gmChip = card.locator('.cmb-conds [data-chip="poisoned"] .c-info');
  expect(await drawn(gmChip.locator('.ic'))).toMatchObject({ href: '#i-poison', side: 14, hidden: 'true' });
  await inside(gmChip.locator('..'), PHONE.width);
  expect(await noSideScroll(gm)).toBe(true);

  await gm.locator('#view-combat [data-start]').tap();
  await go(player, 'combat');
  const hudChip = player.locator('#view-combat [aria-label="Your statuses"] [data-chip="poisoned"] .c-info');
  expect(await drawn(hudChip.locator('.ic'))).toMatchObject({ href: '#i-poison', side: 14, hidden: 'true' });
  await inside(hudChip.locator('..'), PHONE.width);
  expect(await noSideScroll(player)).toBe(true);
});
