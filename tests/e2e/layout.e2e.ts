import type { Page } from '@playwright/test';
import { test, expect, onboardGM, onboardPlayer, openApp, go, dismissAll, createRoom, PHONE, ROOM_CODE, type DeviceOptions, chooseList } from './helpers.ts';

const combat = (page: Page) => page.locator('#view-combat');
const currentRow = (page: Page) => combat(page).locator('.cmb-row.cur');

/** The GM builds a fight of Brakk and two Goblins in the Combat view and starts it. */
async function brakkAndTwoGoblins(page: Page) {
  await go(page, 'combat');
  const brakk = await combat(page).locator('[data-hsel] option', { hasText: 'Brakk Ironhide' }).first().getAttribute('value');
  await combat(page).locator('[data-hsel]').selectOption(brakk ?? '');
  await combat(page).locator('[data-addh]').tap();
  const goblin = await combat(page).locator('[data-msel] option', { hasText: 'Goblin' }).first().getAttribute('value');
  await combat(page).locator('[data-msel]').selectOption(goblin ?? '');
  await combat(page).locator('[data-mcount]').fill('2');
  await combat(page).locator('[data-addm]').tap();
  await expect(combat(page).locator('.cmb-row')).toHaveCount(3);
  await combat(page).locator('[data-start]').tap();
  await expect(currentRow(page)).toHaveCount(1);
  await dismissAll(page, 4);
}

/** A GM on a 1280 by 800 laptop with a mouse, through the onboarding with the starter campaign. */
async function laptopGM(device: (label: string, options?: DeviceOptions) => Promise<{ page: Page }>) {
  const gm = (await device('gm', { viewport: { width: 1280, height: 800 }, mouse: true })).page;
  await openApp(gm);
  for (const step of ['[data-yes]', '[data-gm]', '[data-starter]', '[data-oblater]']) await gm.locator(`.ob-overlay ${step}`).click();
  await expect(gm.locator('.ob-overlay')).toHaveCount(0);
  return gm;
}

test('on a 390 px phone the GM sees whose turn it is at the top of the fight, the mark moves on Next, and a goblin at 0 HP is marked down in the order', async ({ device }) => {
  const gm = (await device('gm', { viewport: PHONE })).page;
  await onboardGM(gm);
  await chooseList(gm);
  await brakkAndTwoGoblins(gm);
  await go(gm, 'gm');
  await go(gm, 'combat');

  const first = (await currentRow(gm).locator('.cmb-nm').innerText()).replace(/^▶\s*/, '').trim();
  await test.step('the current row is on the first screen of Combat, before the selected card', async () => {
    expect(await gm.evaluate(() => scrollY)).toBe(0);
    await expect(currentRow(gm)).toBeInViewport({ ratio: 1 });
    const row = await currentRow(gm).boundingBox(), card = await combat(gm).locator('.cmb-card').boundingBox();
    expect(row && card && row.y < card.y).toBe(true);
  });

  await test.step('after Next the mark is on the next combatant, still on the first screen', async () => {
    await combat(gm).locator('[data-next]').tap();
    await expect(currentRow(gm).locator('.cmb-nm')).not.toContainText(first);
    await expect(currentRow(gm)).toBeInViewport({ ratio: 1 });
  });

  await test.step('a tap on a goblin in the order brings its card into view; at 0 HP its row says Defeated', async () => {
    const gob = combat(gm).locator('.cmb-row', { hasText: 'Goblin' }).first();
    const name = (await gob.locator('.cmb-nm').innerText()).replace(/^▶\s*/, '').trim();
    await gob.locator('.cmb-pick').tap();
    const card = combat(gm).locator('.cmb-card');
    await expect(card.locator('h3')).toContainText(name);
    await expect(card).toBeInViewport();
    await card.locator('[data-amt]').fill('999');
    await card.locator('[data-dmg]').tap();
    const down = combat(gm).locator('.cmb-row', { hasText: name });
    await expect(down.locator('.cmb-dn')).toHaveText('Defeated');
    await expect(down.locator('.cmb-dn')).toBeVisible();
    await expect(combat(gm).locator('.cmb-row .cmb-dn')).toHaveCount(1);
  });
});

test('on a 390 px phone in a room, the empty Table feed is one line that covers none of the card, and a player\'s roll shows as 1 new', async ({ device }) => {
  const gm = (await device('gm', { viewport: PHONE })).page;
  await onboardGM(gm);
  await chooseList(gm);
  await createRoom(gm);
  await brakkAndTwoGoblins(gm);
  const toggle = combat(gm).locator('[data-tb-open]');
  const defeat = combat(gm).locator('.cmb-card [data-defeat]');

  await test.step('the feed is one line saying it is empty, and a goblin\'s Mark defeated scrolled to just above the bottom bar is the thing a tap hits', async () => {
    await combat(gm).locator('.cmb-row', { hasText: 'Goblin' }).first().locator('.cmb-pick').tap();
    await expect(toggle).toHaveText(/Table feed\s*Empty/);
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(gm.locator('#toasts .toast')).toHaveCount(0);
    await defeat.evaluate((el: any) => scrollBy(0, el.getBoundingClientRect().bottom - document.getElementById('nav-bottom')!.getBoundingClientRect().top + 4));
    await expect(defeat).toBeInViewport({ ratio: 1 });
    const hit = await defeat.evaluate((el: any) => { const r = el.getBoundingClientRect(); return el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)); });
    expect(hit).toBe(true);
    await defeat.tap();
    await expect(combat(gm).locator('.cmb-card [data-revive]')).toHaveText('Revive');
  });

  await test.step('a player\'s roll arrives: the line says 1 new and is on screen; a tap opens the row', async () => {
    await gm.evaluate(() => hunterApp.emit('sync:event', { event: { id: 'e-roll-9', at: Date.now(), from: 'p1', type: 'roll', payload: { eid: 'e-roll-9', name: 'Kai', label: 'Longsword', expr: '1d8', total: 6, crit: false, fumble: false } } }));
    await expect(toggle).toContainText('1 new');
    await expect(toggle).toBeInViewport({ ratio: 1 });
    const row = combat(gm).locator('[data-feed]', { hasText: 'Kai · Longsword 1d8 = 6' });
    await expect(row).toBeHidden();
    await toggle.tap();
    await expect(row).toBeVisible();
    await expect(toggle).not.toContainText('new');
  });
});

test('at 1280 a player\'s roll that arrives while the GM is on another view is still new until the GM opens Combat', async ({ device }) => {
  const gm = await laptopGM(device);
  await go(gm, 'gm');
  await gm.locator('[data-gmcreate]').click();
  await expect(gm.locator('[data-gmroomcode]')).toHaveText(ROOM_CODE);
  await go(gm, 'combat');
  await expect(combat(gm).locator('[data-tb-list]')).toBeVisible();
  const unseen = () => gm.evaluate(() => (JSON.parse(sessionStorage.getItem('hunter-system-table-feed') || '[]') as { seen?: boolean }[]).filter(f => !f.seen).length);

  await test.step('on the GM view, a roll arrives and the save changes: the feed, drawn off screen, marks nothing seen', async () => {
    await go(gm, 'gm');
    await gm.evaluate(() => hunterApp.emit('sync:event', { event: { id: 'e-roll-9', at: Date.now(), from: 'p1', type: 'roll', payload: { eid: 'e-roll-9', name: 'Kai', label: 'Longsword', expr: '1d8', total: 6, crit: false, fumble: false } } }));
    await gm.evaluate(() => hunterApp.store.update(() => {}, 'test-change'));
    expect(await unseen()).toBe(1);
  });

  await test.step('the GM opens Combat: the row is on screen, and seen', async () => {
    await go(gm, 'combat');
    await expect(combat(gm).locator('[data-feed]', { hasText: 'Kai · Longsword 1d8 = 6' })).toBeVisible();
    await expect.poll(unseen).toBe(0);
  });
});

test('at 1280 by 800 the GM\'s top nav is one row holding all thirteen views', async ({ device }) => {
  const gm = await laptopGM(device);
  await go(gm, 'gm');
  await gm.locator('[data-gmcreate]').click();
  await expect(gm.locator('[data-gmroomcode]')).toHaveText(ROOM_CODE);
  const tabs = gm.locator('#nav-top .tab');
  await expect(tabs).toHaveCount(13);
  const rows = () => tabs.evaluateAll(els => new Set(els.map(el => Math.round(el.getBoundingClientRect().top))).size);
  expect(await rows()).toBe(1);
  await gm.evaluate(() => { document.documentElement.style.overflowY = 'scroll'; document.documentElement.style.scrollbarGutter = 'stable both-edges'; });
  expect(await rows(), 'still one row with a desktop scrollbar on both edges, as when a window is open').toBe(1);
});

test('at 1280 the Workshop shows its entries as cards, two side by side', async ({ device }) => {
  const gm = await laptopGM(device);
  await go(gm, 'workshop');
  await gm.locator('#view-workshop [data-ws="status"] .ws-built summary').click();
  const cards = gm.locator('#view-workshop [data-ws="status"] .ws-built .ws-list > li');
  await expect(cards.nth(1)).toBeVisible();
  const [a, b] = [await cards.nth(0).boundingBox(), await cards.nth(1).boundingBox()];
  expect(a && b && Math.round(a.y) === Math.round(b.y) && b.x >= a.x + a.width).toBe(true);
});

test('a GM\'s phone opens on the GM view and a player\'s on Status when the address names no view', async ({ device }) => {
  const gm = (await device('gm', { viewport: PHONE })).page, player = (await device('player', { viewport: PHONE })).page;
  await onboardGM(gm);
  await chooseList(gm);
  await onboardPlayer(player, 'Mira Test');
  await chooseList(player);
  await openApp(gm, '/');
  await expect(gm.locator('#view-gm')).toBeVisible();
  await expect(gm.locator('#view-status')).toBeHidden();
  await expect(gm.locator('#nav-bottom a[href="#/gm"]')).toHaveAttribute('aria-current', 'page');
  await openApp(player, '/');
  await expect(player.locator('#view-status')).toBeVisible();
  await expect(player.locator('#view-gm')).toHaveCount(0);
});
