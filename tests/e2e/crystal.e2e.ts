// The Resurrection Crystal (src/core/registry/items.ts, src/core/hunter/use.ts; docs/agent-handoff/features/notes-2b-crystal.md,
// economy design section 5): a dead hunter's way back that the screen names, used from the bag; one of each rank, which
// raises a hunter of its rank or lower, at a cost in levels; sold in the shop at its rank's price and never bought back;
// given by the GM in any reward; the shop closed to the dead. Driven through the UI; the store sets up and reads.
import { test, expect, onboardGM, onboardPlayer, createRoom, dismissAll, go, activeHunter, type Page } from './helpers.ts';

/**
 * The active hunter with `n` Resurrection Crystals of `rank` in its bag and `life`; personal gates off, so no gate's
 * window stands over the bag when a revived hunter's clock would start again. A new hunter is rank E at level 1.
 */
const holding = (page: Page, life: object, n: number, gold = 0, rank = 'E') => page.evaluate(([life, n, gold, rank]) => hunterApp.store.update((d: any) => {
  d.rulesOverrides.solo = { personal: false };
  const h = d.hunters.find((x: any) => x.id === d.settings.activeHunterId) ?? d.hunters[0];
  const crystal = hunterApp.api.inventory.itemTemplates().find((i: any) => i.name === `Resurrection Crystal (${rank})`);
  if (n > 0) h.items.push({ ...crystal, id: hunterApp.store.id('i'), qty: n });
  h.life = life; h.gold = gold;
}, 'test-setup'), [life, n, gold, rank] as const);
/** The active hunter at `level` (the peak with it) and of `rank`, as the GM's edits would leave it. */
const standing = (page: Page, level: number, rank: string) => page.evaluate(([level, rank]) => hunterApp.store.update((d: any) => {
  const h = d.hunters.find((x: any) => x.id === d.settings.activeHunterId) ?? d.hunters[0];
  h.level = level; h.peakLevel = level; h.xp = 0; h.rank = rank;
}, 'test-setup'), [level, rank] as const);
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
  await expect(page.locator('#toasts .toast').last()).toContainText('Resurrection Crystal (E) used: Up at 1 HP.');
  const h = await activeHunter(page);
  expect([h.life, crystals(h)]).toEqual([{ at: 'up', hp: 1 }, 0]);
  await expect(death).toBeHidden();
  await expect(crystalCard(page)).toHaveCount(0);
  const s = await page.evaluate(() => hunterApp.store.get().log.filter((l: any) => l.kind === 'use').map((l: any) => l.title));
  expect(s).toEqual(['Mira used Item: Resurrection Crystal (E)']);
});

test('a living hunter\'s use of a Resurrection Crystal is refused with the reason, and the crystal is kept', async ({ device }) => {
  const { page } = await device('alive');
  await onboardPlayer(page, 'Mira');
  await dismissAll(page);
  await holding(page, { at: 'up', hp: 3 }, 1);
  await go(page, 'status');
  await crystalCard(page).locator('[data-use]').tap();
  await expect(page.locator('#toasts .toast').last()).toContainText('Resurrection Crystal (E) only brings back a dead hunter. You still have it.');
  const h = await activeHunter(page);
  expect([h.life, crystals(h)]).toEqual([{ at: 'up', hp: 3 }, 1]);
});

test('a dead B-rank hunter\'s C crystal is refused, saying the crystal is kept, and the hunter stays dead', async ({ device }) => {
  const { page } = await device('too-low');
  await onboardPlayer(page, 'Mira');
  await dismissAll(page);
  await standing(page, 31, 'B');
  await holding(page, { at: 'dead' }, 1, 0, 'C');
  await go(page, 'status');
  await crystalCard(page).locator('[data-use]').tap();
  await expect(page.locator('#toasts .toast').last()).toContainText('Resurrection Crystal (C) brings back a hunter of rank C or lower. Mira is rank B. You still have it.');
  const h = await activeHunter(page);
  expect([h.life, h.level, crystals(h)]).toEqual([{ at: 'dead' }, 31, 1]);
});

test('a dead hunter at level 31 raised by a crystal of its rank stands at level 29, and the use says the levels lost', async ({ device }) => {
  const { page } = await device('raised');
  await onboardPlayer(page, 'Mira');
  await dismissAll(page);
  await standing(page, 31, 'B');
  await holding(page, { at: 'dead' }, 1, 0, 'B');
  await go(page, 'status');
  await crystalCard(page).locator('[data-use]').tap();
  await expect(page.locator('#toasts .toast').last()).toContainText('Resurrection Crystal (B) used: Up at 1 HP at level 29, 2 levels lost.');
  const h = await activeHunter(page);
  expect([h.life, h.level, h.rank, crystals(h)]).toEqual([{ at: 'up', hp: 1 }, 29, 'B', 0]);
});

test('a GM who revives their own dead level-31 hunter from the board reads the level it came back at and the levels lost', async ({ device }) => {
  const { page } = await device('gm-raised');
  await onboardGM(page);
  await standing(page, 31, 'B');
  await holding(page, { at: 'dead' }, 0);
  await go(page, 'gm');
  const name = (await activeHunter(page)).name;
  await page.locator('#gm-board .gm-card:not(.remote)', { hasText: name }).locator('[data-grevive]').tap();
  await expect(page.locator('#gm-board-msg')).toHaveText(`Revived ${name}. Up at 1 HP at level 29, 2 levels lost.`);
  expect((await activeHunter(page)).level).toBe(29);
});

test('a GM\'s Revive of a player\'s dead level-31 hunter tells the player the level and the levels lost', async ({ device }) => {
  const gm = (await device('gm')).page, player = (await device('player')).page;
  await onboardGM(gm);
  const code = await createRoom(gm);
  await onboardPlayer(player, 'Kai', code);
  await expect.poll(() => player.evaluate(() => hunterApp.api.sync.room())).toBe(code);
  await dismissAll(player, 4);
  await standing(player, 31, 'B');
  await holding(player, { at: 'dead' }, 0);
  await go(gm, 'gm');
  const card = gm.locator('#gm-board .gm-card.remote', { hasText: 'Kai' });
  await expect(card).toContainText('Dead');
  await card.locator('[data-grevive]').tap();
  await expect(player.locator('#toasts .toast').last()).toContainText('The GM has revived you. Up at 1 HP at level 29, 2 levels lost.');
  expect((await activeHunter(player)).level).toBe(29);
});

test('the shop sells a C crystal for 12,500 gold, ten Clears of rank C, and a hunter with that much buys one', async ({ device }) => {
  const { page } = await device('shop');
  await onboardPlayer(page, 'Mira');
  await dismissAll(page);
  await holding(page, { at: 'up', hp: 3 }, 0, 12500);
  await go(page, 'status');
  await page.locator('#view-status [data-tab="shop"]').tap();
  await expect(page.locator('#view-status [data-shopitem^="Resurrection Crystal ("]')).toHaveCount(6);
  const item = page.locator('#view-status [data-shopitem="Resurrection Crystal (C)"]');
  await expect(item.locator('.inv-qty')).toHaveText('12,500 g');
  await item.locator('[data-buy]').tap();
  await expect(page.locator('#toasts .toast').last()).toContainText('Purchased Resurrection Crystal (C).');
  const h = await activeHunter(page);
  expect([h.gold, crystals(h)]).toEqual([0, 1]);
});

test('a dead hunter opens the shop and reads that it is closed, with the ways back: no Buy, and no Sell in the bag', async ({ device }) => {
  const { page } = await device('dead-shop');
  await onboardPlayer(page, 'Mira');
  await dismissAll(page);
  await holding(page, { at: 'dead' }, 0, 100000);
  await page.evaluate(() => hunterApp.store.update((d: any) => {
    const h = d.hunters.find((x: any) => x.id === d.settings.activeHunterId) ?? d.hunters[0];
    h.items.push({ ...hunterApp.api.inventory.itemTemplates().find((i: any) => i.name === 'Health Potion'), id: hunterApp.store.id('i'), qty: 1 });
  }, 'test-setup'));
  await go(page, 'status');
  await expect(page.locator('#view-status [data-item]').filter({ hasText: 'Health Potion' }), 'a potion, which a living hunter can sell').toBeVisible();
  await expect(page.locator('#view-status [data-sell]')).toHaveCount(0);
  await page.locator('#view-status [data-tab="shop"]').tap();
  await expect(page.locator('#view-status [data-shop-closed]')).toHaveText('The shop is closed while you are dead. You cannot buy or sell. The GM\'s Revive or a Resurrection Crystal brings you back. The GM or another hunter can give you a Resurrection Crystal.');
  await expect(page.locator('#view-status [data-shopitem="Resurrection Crystal (E)"]'), 'the list still shows what the shop sells').toBeVisible();
  await expect(page.locator('#view-status [data-buy]')).toHaveCount(0);
  const h = await activeHunter(page);
  expect([h.gold, crystals(h)]).toEqual([100000, 0]);
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
  await ed.locator('[data-kind="item"] [data-f="pick"]').selectOption({ label: 'Resurrection Crystal (S) (mythic)' });
  await expect(ed.locator('.rw-preview li')).toHaveText(['Item acquired: Resurrection Crystal (S)', 'Title acquired: Twice Born']);
  await gm.locator('#gm-targets label', { hasText: 'Kai' }).tap();
  await gm.locator('#gm-award-go').tap();
  await expect(gm.locator('#gm-award-msg')).toHaveText('Sent to Kai.');
  const win = player.locator('.sys-overlay.show', { hasText: 'REWARD RECEIVED' });
  await expect(win).toBeVisible({ timeout: 15_000 });
  await expect(win).toContainText('Item acquired: Resurrection Crystal (S)');
  await expect(win).toContainText('Title acquired: Twice Born');
  const h = await activeHunter(player);
  expect([crystals(h), h.items.find((i: any) => i.revive)?.tell, h.titles.map((t: any) => t.name)]).toEqual([1, true, ['Twice Born']]);
});

test('a GM who edits the shop\'s S Resurrection Crystal to another price keeps it a crystal, and a GM can make an item that revives', async ({ device }) => {
  const page = (await device('gm')).page;
  await onboardGM(page);
  await dismissAll(page);
  await go(page, 'status');
  await page.locator('#view-status [data-tab="shop"]').tap();
  const item = page.locator('#view-status [data-shopitem="Resurrection Crystal (S)"]');
  await item.locator('[data-shop-edit]').tap();
  const d = page.locator('.lf-overlay [role=dialog]');
  await expect(d.locator('#lf-revive')).toBeChecked();
  await expect(d.locator('.mk-preview')).toContainText('Brings its dead user back at 1 HP, outside a fight.');
  await d.locator('#lf-value').fill('50000');
  await d.locator('[data-apply]').tap();
  await expect(d).toHaveCount(0);
  await expect(item.locator('.inv-qty')).toHaveText('50,000 g');
  const shop = await page.evaluate(() => hunterApp.store.get().shop.find((i: any) => i.name === 'Resurrection Crystal (S)'));
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
