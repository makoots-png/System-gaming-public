// Rank-tiered potions and Elixir of Life (economy unit 2 of 4: potion-prices):
// 0.35x priceBase for standard consumables (Health Potion 50% max HP, Mana Potion +4 mana, Stamina Tonic -25 fatigue),
// 1.0x priceBase for full-heal Elixirs of Life (E to S), Shop rank filter, core rank-cap enforcement out of and inside
// a fight, and GM item maker rankCap + default value preview.
import { mkdir } from 'node:fs/promises';
import type { Page } from '@playwright/test';
import { RULES } from '../../src/core/rules.ts';
import { SHOP_ITEMS } from '../../src/core/registry/items.ts';
import { RANK_CAP_TEXT } from '../../src/core/effects.ts';
import { USE_WORDS } from '../../src/core/hunter/use.ts';
import { REFUSAL_WORDS } from '../../src/core/combat/refusal-words.ts';
import { test, expect, onboardGM, onboardPlayer, dismissAll, go, activeHunter, chooseList, startGoblinDenFight } from './helpers.ts';

const SHOT_DIR = process.env.POTION_SHOTS || '';
async function snap(page: Page, name: string): Promise<void> {
  if (!SHOT_DIR) return;
  await mkdir(SHOT_DIR, { recursive: true });
  await page.screenshot({ path: `${SHOT_DIR}/${name}`, fullPage: false });
}

test('on a 390 px phone the Shop lists all 35 items, filters cleanly by rank, and lets a hunter buy and drink a 50%-HP potion', async ({ device }) => {
  const { page } = await device('shop-390', { viewport: { width: 390, height: 844 } });
  await onboardPlayer(page, 'Mira Potion');
  await dismissAll(page);
  await page.evaluate(() => hunterApp.store.update((d: any) => {
    d.rulesOverrides.solo = { personal: false };
    const h = d.hunters.find((x: any) => x.id === d.settings.activeHunterId) ?? d.hunters[0];
    h.gold = 2000;
    h.life = { at: 'up', hp: 10 };
  }, 'test-setup'));

  await go(page, 'status');
  await page.locator('#view-status [data-tab="shop"]').tap();
  const rankSel = page.locator('#view-status select[name="shop-rank"]');
  await expect(rankSel).toHaveValue('all');
  await expect(page.locator('#view-status [data-shopitem]')).toHaveCount(SHOP_ITEMS.length);
  await expect(page.locator('#view-status [data-shopitem="Greater Health Potion"]')).toHaveCount(0);

  // Check 390 px fit and >= 44 px control height
  const fit = await page.evaluate(() => {
    const sel = document.querySelector('#view-status select[name="shop-rank"]')!;
    return {
      wide: window.innerWidth,
      scroll: document.documentElement.scrollWidth,
      selH: sel.getBoundingClientRect().height,
    };
  });
  expect(fit.scroll).toBeLessThanOrEqual(fit.wide);
  expect(fit.selH).toBeGreaterThanOrEqual(44);
  await page.locator('#view-status [data-panel="inventory"]').scrollIntoViewIfNeeded();
  await snap(page, 'shop-all-390.png');

  // Filter to Rank C: shows the C-rank potions, Elixir, crystal, and rare shop gear
  await rankSel.selectOption('C');
  await expect(page.locator('#view-status [data-shopitem="Health Potion (C)"] .inv-qty')).toHaveText('438 g');
  await expect(page.locator('#view-status [data-shopitem="Elixir of Life (C)"] .inv-qty')).toHaveText('1,250 g');
  await expect(page.locator('#view-status [data-shopitem="Health Potion (E)"]')).toHaveCount(0);
  await snap(page, 'shop-rank-c-390.png');

  // Buy Elixir of Life (C) (1,250 g)
  await page.locator('#view-status [data-shopitem="Elixir of Life (C)"] [data-buy]').tap();
  await expect(page.locator('#toasts .toast').last()).toContainText('Purchased Elixir of Life (C).');

  // Filter to Rank E, inspect Health Potion (E) detail card, buy it (35 g)
  await rankSel.selectOption('E');
  const hpE = page.locator('#view-status [data-shopitem="Health Potion (E)"]');
  await expect(hpE.locator('.inv-qty')).toHaveText('35 g');
  await hpE.locator('.i-name').tap();
  await expect(hpE).toContainText(RANK_CAP_TEXT);
  await hpE.locator('[data-buy]').tap();
  await expect(page.locator('#toasts .toast').last()).toContainText('Purchased Health Potion (E).');

  // Switch to Items tab and drink Health Potion (E) -> heals 50% of max HP (23 HP on 45 max HP -> 33 HP)
  await page.locator('#view-status [data-tab="items"]').tap();
  const bagPotion = page.locator('#view-status [data-item]', { hasText: 'Health Potion (E)' });
  await bagPotion.locator('[data-use]').tap();
  const h = await activeHunter(page);
  const wantHp = 10 + Math.round(0.5 * RULES.fight.hpBase);
  expect([h.gold, h.life.hp, h.items.some((i: any) => i.name === 'Health Potion (E)')]).toEqual([2000 - 1250 - 35, wantHp, false]);
});

test('a rank B hunter is refused a rank E potion outside a fight and inside a fight by core, keeping the bottle', async ({ device }) => {
  const { page } = await device('cap-refuse');
  await onboardGM(page);
  await dismissAll(page);
  await page.evaluate(() => hunterApp.store.update((d: any) => {
    d.rulesOverrides.solo = { personal: false };
    const h = d.hunters.find((x: any) => x.name === 'Brakk Ironhide');
    d.settings.activeHunterId = h.id;
    h.rank = 'B';
    h.rankBy = 'gm';
    h.life = { at: 'up', hp: 10 };
    const potionE = hunterApp.api.inventory.itemTemplates().find((i: any) => i.name === 'Health Potion (E)');
    h.items.push({ ...potionE, id: hunterApp.store.id('i'), qty: 2 });
  }, 'test-setup'));

  // Out of a fight: refused with USE_WORDS['too-low'], bottle kept
  await go(page, 'status');
  const bagPotion = page.locator('#view-status [data-item]', { hasText: 'Health Potion (E)' });
  await bagPotion.locator('[data-use]').tap();
  await expect(page.locator('#toasts .toast').last()).toContainText(
    USE_WORDS['too-low']('Health Potion (E)', { upTo: 'E', name: 'Brakk Ironhide', rank: 'B', revive: false }),
  );
  const afterBag = await activeHunter(page);
  expect([afterBag.life.hp, afterBag.items.find((i: any) => i.name === 'Health Potion (E)')?.qty]).toEqual([10, 2]);

  // Inside a fight: refused in core by charge.ts (`tooLow`), bottle kept and HP unchanged
  await chooseList(page);
  await startGoblinDenFight(page);
  await page.evaluate(() => hunterApp.store.update((d: any) => {
    const f = d.fight;
    const brakk = f.rows.find((r: any) => r.name === 'Brakk Ironhide');
    f.currentId = brakk.id;
    brakk.at = f.now;
  }, 'test-setup'));
  await go(page, 'status');
  await page.locator('#view-status [data-item]', { hasText: 'Health Potion (E)' }).locator('[data-use]').tap();
  await expect(page.locator('#toasts .toast').last()).toContainText(REFUSAL_WORDS.tooLow);
  const afterFight = await activeHunter(page);
  expect([afterFight.life.hp, afterFight.items.find((i: any) => i.name === 'Health Potion (E)')?.qty]).toEqual([10, 2]);
});

test('in the item maker a GM can toggle rank cap on a consumable and sees 1.0x default price for full-heal consumables', async ({ device }) => {
  const { page } = await device('gm-maker');
  await onboardGM(page);
  await go(page, 'gm');
  await page.locator('#gm-make [data-make="item"]').tap();
  const d = page.locator('.lf-overlay [role=dialog]');
  await d.locator('#lf-name').fill('Royal Elixir');
  await d.locator('[data-chips="type"] [data-chip="consumable"]').tap();
  await d.locator('#lf-rar').selectOption('rare');
  // Standard consumable default: 0.35 * 1250 = 438
  await expect(d.locator('#lf-value')).toHaveAttribute('placeholder', `Default: ${Math.round(RULES.priceBase.C * RULES.usedUpShare)}`);
  await d.locator('[data-quick] [data-q="heal"]').tap();
  await d.locator('[data-row="0"] [data-f="q"]').fill('target.hpMax');
  // Full-heal consumable default: 1.0 * 1250 = 1250
  await expect(d.locator('#lf-value')).toHaveAttribute('placeholder', `Default: ${Math.round(RULES.priceBase.C * RULES.elixirPrices)}`);
  await d.locator('#lf-rank-cap').check();
  await expect(d.locator('.mk-preview')).toContainText(RANK_CAP_TEXT);
  await d.locator('[data-apply]').tap();
  await expect(d).toHaveCount(0);
  const saved = await page.evaluate(() => hunterApp.store.get().library.items.find((i: any) => i.name === 'Royal Elixir'));
  expect(saved.rankCap).toBe(true);
});
