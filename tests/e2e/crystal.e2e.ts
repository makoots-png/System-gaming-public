// The Resurrection Crystal (src/core/registry/items.ts, src/core/hunter/use.ts; docs/agent-handoff/features/notes-2b-crystal.md):
// a dead hunter's way back that the screen names, used from the bag; sold in the shop at its price and never bought
// back; given by the GM in any reward. Driven through the UI; the store sets up and reads.
import { test, expect, onboardGM, onboardPlayer, createRoom, dismissAll, go, activeHunter, type Page } from './helpers.ts';

/**
 * The active hunter with `n` Resurrection Crystals in its bag and `life`; personal gates off, so no gate's window stands
 * over the bag when a revived hunter's clock would start again.
 */
const holding = (page: Page, life: object, n: number, gold = 0) => page.evaluate(([life, n, gold]) => hunterApp.store.update((d: any) => {
  d.rulesOverrides.solo = { personal: false };
  const h = d.hunters.find((x: any) => x.id === d.settings.activeHunterId) ?? d.hunters[0];
  const crystal = hunterApp.api.inventory.itemTemplates().find((i: any) => i.revive);
  if (n > 0) h.items.push({ ...crystal, id: hunterApp.store.id('i'), qty: n });
  h.life = life; h.gold = gold;
}, 'test-setup'), [life, n, gold] as const);
const crystalCard = (page: Page) => page.locator('#view-status [data-item]').filter({ hasText: 'Resurrection Crystal' });
const crystals = (h: any): number => h.items.filter((i: any) => i.revive).reduce((n: number, i: any) => n + i.qty, 0);

test('a dead hunter alone reads the way back on the sheet, uses a Resurrection Crystal from the bag and stands at 1 HP, the crystal gone and the use logged', async ({ device }) => {
  const { page } = await device('dead');
  await onboardPlayer(page, 'Mira');
  await dismissAll(page);
  await holding(page, { at: 'dead' }, 1);
  await go(page, 'status');
  const death = page.locator('#view-status [data-death]');
  await expect(death.locator('[data-life]')).toHaveText('Dead');
  await expect(death.locator('[data-wayback]')).toHaveText('The GM\'s Revive or a Resurrection Crystal brings you back.');
  await expect(crystalCard(page).locator('[data-sell]'), 'a crystal is not bought back').toHaveCount(0);
  await crystalCard(page).locator('[data-use]').tap();
  await expect(page.locator('#toasts .toast').last()).toContainText('Resurrection Crystal used: Up at 1 HP.');
  const h = await activeHunter(page);
  expect([h.life, crystals(h)]).toEqual([{ at: 'up', hp: 1 }, 0]);
  await expect(death).toBeHidden();
  await expect(crystalCard(page)).toHaveCount(0);
  const s = await page.evaluate(() => hunterApp.store.get().log.filter((l: any) => l.kind === 'use').map((l: any) => l.title));
  expect(s).toEqual(['Mira used Item: Resurrection Crystal']);
});

test('a living hunter\'s use of a Resurrection Crystal is refused with the reason, and the crystal is kept', async ({ device }) => {
  const { page } = await device('alive');
  await onboardPlayer(page, 'Mira');
  await dismissAll(page);
  await holding(page, { at: 'up', hp: 3 }, 1);
  await go(page, 'status');
  await crystalCard(page).locator('[data-use]').tap();
  await expect(page.locator('#toasts .toast').last()).toContainText('Resurrection Crystal only brings back a dead hunter. You still have it.');
  const h = await activeHunter(page);
  expect([h.life, crystals(h)]).toEqual([{ at: 'up', hp: 3 }, 1]);
});

test('the shop sells the Resurrection Crystal for 100,000 gold, and a hunter with that much buys one', async ({ device }) => {
  const { page } = await device('shop');
  await onboardPlayer(page, 'Mira');
  await dismissAll(page);
  await holding(page, { at: 'up', hp: 3 }, 0, 100000);
  await go(page, 'status');
  await page.locator('#view-status [data-tab="shop"]').tap();
  const item = page.locator('#view-status [data-shopitem="Resurrection Crystal"]');
  await expect(item.locator('.inv-qty')).toHaveText('100,000 g');
  await item.locator('[data-buy]').tap();
  await expect(page.locator('#toasts .toast').last()).toContainText('Purchased Resurrection Crystal.');
  const h = await activeHunter(page);
  expect([h.gold, crystals(h)]).toEqual([0, 1]);
});

test('a GM gives a player a title with a Resurrection Crystal in one award, and the player\'s phone holds both', async ({ device }) => {
  const gm = (await device('gm')).page, player = (await device('player')).page;
  await onboardGM(gm);
  const code = await createRoom(gm);
  await onboardPlayer(player, 'Kai', code);
  await expect.poll(() => player.evaluate(() => hunterApp.api.sync.room())).toBe(code);
  await dismissAll(player, 4);
  await go(gm, 'gm');
  await expect(gm.locator('#gm-board .gm-card.remote', { hasText: 'Kai' })).toHaveCount(1);
  const toggle = gm.locator('[data-tog="award"]');
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.tap();
  const ed = gm.locator('#gm-rw');
  await ed.locator('[data-add="title"]').tap();
  await ed.locator('[data-kind="title"] [data-f="name"]').fill('Twice Born');
  await ed.locator('[data-add="item"]').tap();
  await ed.locator('[data-kind="item"] [data-f="pick"]').selectOption({ label: 'Resurrection Crystal (mythic)' });
  await expect(ed.locator('.rw-preview li')).toHaveText(['Item acquired: Resurrection Crystal', 'Title acquired: Twice Born']);
  await gm.locator('#gm-targets label', { hasText: 'Kai' }).tap();
  await gm.locator('#gm-award-go').tap();
  await expect(gm.locator('#gm-award-msg')).toHaveText('Sent to Kai.');
  const win = player.locator('.sys-overlay.show', { hasText: 'REWARD RECEIVED' });
  await expect(win).toBeVisible({ timeout: 15_000 });
  await expect(win).toContainText('Item acquired: Resurrection Crystal');
  await expect(win).toContainText('Title acquired: Twice Born');
  const h = await activeHunter(player);
  expect([crystals(h), h.items.find((i: any) => i.revive)?.tell, h.titles.map((t: any) => t.name)]).toEqual([1, true, ['Twice Born']]);
});

test('a GM who edits the shop\'s Resurrection Crystal to another price keeps it a crystal, and a GM can make an item that revives', async ({ device }) => {
  const page = (await device('gm')).page;
  await onboardGM(page);
  await dismissAll(page);
  await go(page, 'status');
  await page.locator('#view-status [data-tab="shop"]').tap();
  const item = page.locator('#view-status [data-shopitem="Resurrection Crystal"]');
  await item.locator('[data-shop-edit]').tap();
  const d = page.locator('.lf-overlay [role=dialog]');
  await expect(d.locator('#lf-revive')).toBeChecked();
  await expect(d.locator('.mk-preview')).toContainText('Brings its dead user back at 1 HP, outside a fight.');
  await d.locator('#lf-value').fill('50000');
  await d.locator('[data-apply]').tap();
  await expect(d).toHaveCount(0);
  await expect(item.locator('.inv-qty')).toHaveText('50,000 g');
  const shop = await page.evaluate(() => hunterApp.store.get().shop.find((i: any) => i.name === 'Resurrection Crystal'));
  expect([shop.value, shop.revive]).toEqual([50000, true]);

  await page.locator('#view-status [data-shop-add]').tap();
  await d.locator('#lf-name').fill('Phoenix Feather');
  await d.locator('[data-chips="type"] [data-chip="consumable"]').tap();
  await d.locator('#lf-revive').check();
  await d.locator('[data-apply]').tap();
  await expect(d).toHaveCount(0);
  const feather = await page.evaluate(() => hunterApp.store.get().shop.find((i: any) => i.name === 'Phoenix Feather'));
  expect([feather.type, feather.revive]).toEqual(['consumable', true]);
});
