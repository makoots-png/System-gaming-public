// Point respec (point-respec unit): staged take-backs in signed pending, free before first fight, rank-scaled
// carried gold cost after first fight, Variant 1 warning on paid confirm, fightHold block, RoomRules sync,
// sealed GM respec report, and GM local free respec.
import { mkdir } from 'node:fs/promises';
import type { Page } from '@playwright/test';
import { RESPEC_WORDS, confirmCostLine, respecCost, respecRefusalWords, respecSaid } from '../../src/core/hunter/respec.ts';
import { RULES } from '../../src/core/rules.ts';
import { newTally } from '../../src/core/hunter/chronicle.ts';
import { test, expect, setupGoblinDenGM, onboardPlayer, createRoom, dismissAll, go, chooseList, PHONE, SMALL_PHONE } from './helpers.ts';

const SHOTS = process.env.RESPEC_SHOTS ?? '';
const shot = async (page: Page, name: string) => {
  if (!SHOTS) return;
  await page.locator('#view-status [data-panel="attributes"] [data-confirm-cost]').scrollIntoViewIfNeeded();
  await page.locator('#view-status [data-panel="attributes"]').evaluate(el => el.scrollIntoView({ block: 'end' }));
  await mkdir(SHOTS, { recursive: true });
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: false });
};

const foughtTally = { tally: { ...newTally(), fights: 1 } };

test('a solo player takes points back free before their first fight, then pays carried gold with a cap and Variant 1 confirm after fighting', async ({ device }) => {
  const page = (await device('solo')).page;
  await onboardPlayer(page, 'Kai Respec');
  await dismissAll(page);
  await go(page, 'status');

  const attrs = page.locator('#view-status [data-panel="attributes"]');
  const strPlus = attrs.locator('.stat[data-k="str"] button[data-dir="1"]');
  const strMinus = attrs.locator('.stat[data-k="str"] button[data-dir="-1"]');
  const vitPlus = attrs.locator('.stat[data-k="vit"] button[data-dir="1"]');
  const takeAllBtn = attrs.locator('[data-take-all]');
  const confirmBtn = attrs.locator('[data-confirm]');
  const costEl = attrs.locator('[data-confirm-cost]');
  const apEl = attrs.locator('[data-ap]');

  await test.step('spend 12 creation points and confirm, then take 2 back for free before first fight', async () => {
    await expect(takeAllBtn).toBeHidden();
    for (let i = 0; i < 8; i++) await strPlus.tap();
    for (let i = 0; i < 4; i++) await vitPlus.tap();
    await confirmBtn.tap();
    await expect(apEl).toHaveText('0');
    await expect(takeAllBtn).toBeVisible();

    await strMinus.tap();
    await strMinus.tap();
    await expect(apEl, 'taken-back points stay unavailable until Confirm').toHaveText('0');
    await expect(costEl).toHaveText(confirmCostLine({ count: 2, cost: 0, freeWhy: 'before-first-fight' }, 0));
    await confirmBtn.tap();
    await expect(page.locator('.sys-overlay.show')).toHaveCount(0);
    await expect(apEl).toHaveText('2');
    await expect(costEl).toBeHidden();

    // Put the 2 points back and confirm so all 12 are spent again.
    await strPlus.tap();
    await strPlus.tap();
    await confirmBtn.tap();
    await expect(apEl).toHaveText('0');
  });

  await test.step('after first fight, taking 2 points back costs 10 gold and opens a Variant 1 confirm window', async () => {
    await page.evaluate(() => {
      hunterApp.store.update((d: any) => {
        const h = d.hunters[0];
        h.chronicle.tally.fights = 1;
        h.gold = 30;
      }, 'test-setup');
    });
    await strMinus.tap();
    await strMinus.tap();
    const plan2 = respecCost({ rank: 'E', chronicle: foughtTally }, 2, 'player', RULES);
    await expect(costEl).toHaveText(confirmCostLine(plan2, 30));

    // Cancel leaves gold and stats unchanged.
    await confirmBtn.tap();
    const warn = page.locator('.sys-overlay.show .sys-window.sys-warn');
    await expect(warn).toBeVisible();
    await expect(warn).toContainText(RESPEC_WORDS.warnTitle);
    await expect(warn).toContainText(RESPEC_WORDS.warnBody(2, plan2.cost, 30));
    await warn.locator('button', { hasText: 'Cancel' }).tap();
    await expect(warn).toHaveCount(0);
    expect(await page.evaluate(() => hunterApp.store.active().gold)).toBe(30);

    // Pay deducts 10 gold and returns 2 points.
    await confirmBtn.tap();
    await warn.locator('button', { hasText: RESPEC_WORDS.payAction(plan2.cost) }).tap();
    await expect(warn).toHaveCount(0);
    await expect(apEl).toHaveText('2');
    expect(await page.evaluate(() => hunterApp.store.active().gold)).toBe(20);
  });

  await test.step('Take all back with insufficient gold refuses cleanly, then pays the capped full reset once funded', async () => {
    await takeAllBtn.tap();
    const planAll = respecCost({ rank: 'E', chronicle: foughtTally }, 10, 'player', RULES);
    await expect(costEl).toHaveText(confirmCostLine(planAll, 20));
    await expect(costEl).toHaveClass(/\bbad\b/);
    await confirmBtn.tap();
    await expect(page.locator('#toasts .toast-warning')).toContainText(respecRefusalWords(planAll.cost, 20).gold);
    await expect(apEl).toHaveText('2');

    await page.evaluate(() => {
      hunterApp.store.update((d: any) => { d.hunters[0].gold = 120; }, 'test-setup');
    });
    await expect(costEl).toHaveText(confirmCostLine(planAll, 120));
    await confirmBtn.tap();
    const warn = page.locator('.sys-overlay.show .sys-window.sys-warn');
    await warn.locator('button', { hasText: RESPEC_WORDS.payAction(planAll.cost) }).tap();
    await expect(warn).toHaveCount(0);
    await expect(apEl).toHaveText('12');
    expect(await page.evaluate(() => ({ gold: hunterApp.store.active().gold, debt: hunterApp.store.active().debt, spent: hunterApp.store.active().spent }))).toEqual({
      gold: 70,
      debt: 0,
      spent: {},
    });
  });
});

test('in a room, respec follows GM respecPrices, refuses during a fight, sends one sealed report to the GM, and GM local respec is free', async ({ device }) => {
  const gm = (await device('gm')).page;
  const player = (await device('player')).page;
  await setupGoblinDenGM(gm);
  await chooseList(gm);
  const code = await createRoom(gm);
  await onboardPlayer(player, 'Mira Respec', code);
  await chooseList(player);
  await expect.poll(() => player.evaluate(() => hunterApp.api.sync.room())).toBe(code);
  await dismissAll(player, 4);
  await go(gm, 'gm');
  await expect(gm.locator('#gm-board .gm-card.remote', { hasText: 'Mira Respec' })).toHaveCount(1);

  await test.step('GM overrides respecPrices to 1.0 and player phone syncs it', async () => {
    await gm.evaluate(() => {
      hunterApp.store.update((d: any) => { d.rulesOverrides = { ...d.rulesOverrides, respecPrices: 1 }; }, 'test-rules');
    });
    await expect.poll(() => player.evaluate(() => hunterApp.rules().respecPrices), { timeout: 15_000 }).toBe(1);
  });

  await test.step('player spends 4 points, has fought, and is blocked while held in the GM fight', async () => {
    await go(player, 'status');
    const attrs = player.locator('#view-status [data-panel="attributes"]');
    for (let i = 0; i < 4; i++) await attrs.locator('.stat[data-k="str"] button[data-dir="1"]').tap();
    await attrs.locator('[data-confirm]').tap();
    await player.evaluate(() => {
      hunterApp.store.update((d: any) => {
        const h = d.hunters[0];
        h.chronicle.tally.fights = 1;
        h.gold = 200;
      }, 'test-setup');
    });

    await go(gm, 'combat');
    const combat = gm.locator('#view-combat');
    for (const label of ['Mira Respec (player phone)', 'Brakk Ironhide']) {
      await combat.locator('[data-hsel]').selectOption({ label });
      await combat.locator('[data-addh]').tap();
    }
    await combat.locator('[data-qline]').fill('Cave Rat, E, brute');
    await combat.locator('[data-qadd]').tap();
    await combat.locator('[data-start]').tap();
    await expect.poll(() => player.evaluate(() => hunterApp.api.sync.doc('fight')?.active ?? false), { timeout: 15_000 }).toBe(true);

    await attrs.locator('.stat[data-k="str"] button[data-dir="-1"]').tap();
    await attrs.locator('.stat[data-k="str"] button[data-dir="-1"]').tap();
    await attrs.locator('[data-confirm]').tap();
    await expect(player.locator('#toasts .toast-warning')).toContainText(respecRefusalWords(20, 200).held);
    expect(await player.evaluate(() => hunterApp.store.active().gold)).toBe(200);
  });

  await test.step('once the fight ends, player confirms for 20 gold (GM rule) and the GM logs the sealed report once', async () => {
    await gm.locator('#view-combat [data-end]').tap();
    await dismissAll(gm);
    await expect.poll(() => player.evaluate(() => hunterApp.api.sync.doc('fight')?.ended ?? true), { timeout: 15_000 }).toBe(true);

    const attrs = player.locator('#view-status [data-panel="attributes"]');
    await attrs.locator('[data-confirm]').tap();
    const warn = player.locator('.sys-overlay.show .sys-window.sys-warn');
    await expect(warn).toBeVisible();
    await warn.locator('button', { hasText: RESPEC_WORDS.payAction(20) }).tap();
    await expect(warn).toHaveCount(0);
    await expect.poll(() => player.evaluate(() => hunterApp.store.active().gold)).toBe(180);

    const wantLog = respecSaid('Mira Respec', 2, 20).text;
    await expect.poll(() => gm.evaluate(() => hunterApp.store.get().log.filter((l: any) => l.title === 'Points reset').map((l: any) => l.text)), { timeout: 15_000 }).toEqual([wantLog]);
  });

  await test.step('GM takes all back on local Brakk for free, logged locally with no room event', async () => {
    await go(gm, 'status');
    const attrs = gm.locator('#view-status [data-panel="attributes"]');
    await attrs.locator('[data-take-all]').tap();
    await expect(attrs.locator('[data-confirm-cost]')).toHaveText(confirmCostLine({ count: 12, cost: 0, freeWhy: 'gm' }, 0));
    await attrs.locator('[data-confirm]').tap();
    await expect(attrs.locator('[data-ap]')).toHaveText('12');
    const gmCheck = await gm.evaluate(() => ({
      logs: hunterApp.store.get().log.filter((l: any) => l.title === 'Points reset').map((l: any) => l.text),
      respecOut: hunterApp.store.get().settings.sync.outbox.filter((e: any) => e.letter.kind === 'event' && e.letter.event.type === 'respec').length,
    }));
    expect(gmCheck.logs).toContain(respecSaid('Brakk Ironhide', 12, 0).text);
    expect(gmCheck.respecOut).toBe(0);
  });
});

for (const vp of [SMALL_PHONE, PHONE]) {
  test(`Attributes panel staging a take-back fits cleanly at ${vp.width}px with no horizontal overflow`, async ({ device }) => {
    const page = (await device(`shot-${vp.width}`, { viewport: vp })).page;
    await onboardPlayer(page, 'Kai Respec');
    await dismissAll(page);
    await page.evaluate(() => {
      hunterApp.store.update((d: any) => {
        const h = d.hunters[0];
        h.stats.str = 18;
        h.stats.vit = 14;
        h.spent = { str: 8, vit: 4 };
        h.pending = { str: -3 };
        h.chronicle.tally.fights = 1;
        h.gold = 80;
      }, 'test-setup');
    });
    await go(page, 'status');
    const attrs = page.locator('#view-status [data-panel="attributes"]');
    const plan = respecCost({ rank: 'E', chronicle: foughtTally }, 3, 'player', RULES);
    await expect(attrs.locator('[data-confirm-cost]')).toHaveText(confirmCostLine(plan, 80));
    await expect(attrs.locator('[data-confirm]')).toBeVisible();
    await expect(attrs.locator('[data-take-all]')).toBeVisible();
    const overflow = await page.evaluate(() => document.scrollingElement!.scrollWidth > window.innerWidth);
    expect(overflow, `no horizontal overflow at ${vp.width}px`).toBe(false);
    await shot(page, `attributes-respec-${vp.width}`);
  });
}
