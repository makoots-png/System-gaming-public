// Shop borrowing (src/core/hunter/inventory.ts `buyPlan`, `buy`, `borrowConfirm`, `shopCreditLine`, `BUY_WORDS`, `BORROW_WORDS`).
// the owner (Nov 23), cap A (qd row 73): `RULES.borrowCapPrices` = 1.5 times `RULES.priceBase[rank]`, synced in RoomRules.
// Cash is spent first, shortfall adds to shared `Hunter.debt`, refused when over cap / borrowing off / reviveDebtShare <= 0,
// paid off through the existing 3-way gate clear gold split and 0.25x XP rule, and ignored by `systemRaise`.
import type { Page } from '@playwright/test';
import { RULES } from '../../src/core/rules.ts';
import { BORROW_WORDS, BUY_WORDS, borrowConfirm, shopCreditLine } from '../../src/core/hunter/inventory.ts';
import { RAISE_TITLE, debtChip, debtLine, debtPaidLine, debtXpClearedLine, debtXpLine, raiseOffer, raiseOwes } from '../../src/core/hunter/revive-standing.ts';
import { borrowLine } from '../../src/core/rules-text.ts';
import { test, expect, setupGoblinDenGM, onboardPlayer, createRoom, dismissAll, go, activeHunter, gateByName } from './helpers.ts';

const HUNTER = 'Mira Loan';
const confirmWin = (page: Page) => page.locator('.sys-overlay.show', { hasText: BORROW_WORDS.title });
const raiseWin = (page: Page) => page.locator('.sys-overlay.show', { hasText: RAISE_TITLE });

test('a hunter can borrow in the shop up to the rank cap with plain confirmation, sees exact refusals, syncs room rules, and pays the loan off through gate clears', async ({ device }) => {
  const gm = (await device('gm')).page, player = (await device('player')).page;
  await setupGoblinDenGM(gm);
  const code = await createRoom(gm);
  await onboardPlayer(player, HUNTER, code);
  await expect.poll(() => player.evaluate(() => hunterApp.api.sync.room())).toBe(code);
  await dismissAll(player, 4);
  await player.evaluate(() => hunterApp.store.update((d: any) => {
    d.rulesOverrides.solo = { personal: false };
    const h = d.hunters.find((x: any) => x.id === d.settings.activeHunterId) ?? d.hunters[0];
    h.gold = 10;
  }, 'test-setup'));

  await go(gm, 'gm');
  const card = gm.locator('#gm-board .gm-card.remote', { hasText: HUNTER });
  await expect(card).toHaveCount(1);

  await test.step('Shop tab shows credit limit and opens a clear confirmation before borrowing', async () => {
    await go(player, 'status');
    await player.locator('#view-status [data-tab="shop"]').tap();
    await expect(player.locator('#view-status [data-shop-credit]')).toHaveText(
      shopCreditLine({ life: { at: 'up' }, gold: 10, debt: 0, rank: 'E' }, RULES)!,
    );

    const sword = player.locator('#view-status [data-shopitem="Steel Longsword"]');
    await expect(sword.locator('[data-buy]')).toHaveText(BORROW_WORDS.btnBorrow);
    await sword.locator('[data-buy]').tap();

    const win = confirmWin(player);
    await expect(win).toBeVisible();
    const expected = borrowConfirm('Steel Longsword', { ok: true, price: 67, cash: 10, borrow: 57, debtAfter: 57, cap: 150, available: 150 }, RULES);
    await expect(win).toContainText(expected.body);
    for (const line of expected.lines) await expect(win).toContainText(line);

    // Cancel changes nothing.
    await win.locator('.sys-actions button', { hasText: expected.cancel }).tap();
    await expect(win).toHaveCount(0);
    expect(await activeHunter(player)).toMatchObject({ gold: 10, debt: 0 });

    // Confirm spends cash first (10 gold) and adds shortfall (57 gold) to Hunter.debt.
    await sword.locator('[data-buy]').tap();
    await expect(win).toBeVisible();
    await win.locator('.sys-actions button', { hasText: expected.confirm }).tap();
    await expect(win).toHaveCount(0);

    await expect(player.locator('#toasts .toast').last()).toContainText(BORROW_WORDS.bought('Steel Longsword', { cash: 10, borrow: 57 }));
    const h = await activeHunter(player);
    expect([h.gold, h.debt, h.bag.some((i: any) => i.name === 'Steel Longsword')]).toEqual([0, 57, true]);
    await expect(player.locator('[data-debt]')).toHaveText(debtLine(57)!);
    await expect(player.locator('#view-status [data-shop-credit]')).toHaveText(
      shopCreditLine({ life: { at: 'up' }, gold: 0, debt: 57, rank: 'E' }, RULES)!,
    );
    await expect(card.locator('[data-debt-chip]')).toHaveText(debtChip(57)!, { timeout: 15_000 });
  });

  await test.step('Refused borrows state exact cap and available amount, borrowing off, and 0% payoff', async () => {
    // Health Potion (D) is 114 gold, above remaining 93 gold of the 150 gold E-rank limit.
    const dhp = player.locator('#view-status [data-shopitem="Health Potion (D)"]');
    await expect(dhp.locator('[data-buy]')).toBeVisible();
    await expect(dhp.locator('[data-buy]')).toHaveAttribute('aria-disabled', 'true');
    await dhp.locator('[data-buy]').tap({ force: true });
    await expect(player.locator('#toasts .toast').last()).toContainText(
      BUY_WORDS['over-cap']({ name: 'Health Potion (D)', rank: 'E', price: 114, have: 0, need: 114, debt: 57, cap: 150, available: 93 }),
    );

    // GM sets borrowCapPrices to 0 -> syncs to player, hides credit line, refuses with borrow-off.
    await gm.evaluate(() => {
      hunterApp.store.update((d: any) => { d.rulesOverrides = { ...d.rulesOverrides, borrowCapPrices: 0 }; }, 'test-rules');
    });
    await expect.poll(() => player.evaluate(() => hunterApp.rules().borrowCapPrices), { timeout: 15_000 }).toBe(0);
    await expect(player.locator('#view-status [data-shop-credit]')).toBeHidden();
    const potion = player.locator('#view-status [data-shopitem="Health Potion (E)"]');
    await expect(potion.locator('[data-buy]')).toHaveAttribute('aria-disabled', 'true');
    await potion.locator('[data-buy]').tap({ force: true });
    await expect(player.locator('#toasts .toast').last()).toContainText(
      BUY_WORDS['borrow-off']({ name: 'Health Potion (E)', rank: 'E', price: 35, have: 0, need: 35, debt: 57, cap: 0, available: 0 }),
    );

    // GM re-enables borrowCapPrices (1.5) but sets reviveDebtShare to 0 -> paused notice and no-payoff refusal.
    await gm.evaluate(() => {
      hunterApp.store.update((d: any) => { d.rulesOverrides = { ...d.rulesOverrides, borrowCapPrices: 1.5, reviveDebtShare: 0 }; }, 'test-rules');
    });
    await expect.poll(() => player.evaluate(() => ({ cap: hunterApp.rules().borrowCapPrices, share: hunterApp.rules().reviveDebtShare })), { timeout: 15_000 }).toEqual({ cap: 1.5, share: 0 });
    await expect(player.locator('#view-status [data-shop-credit]')).toHaveText(BORROW_WORDS.paused);
    await expect(potion.locator('[data-buy]')).toHaveAttribute('aria-disabled', 'true');
    await potion.locator('[data-buy]').tap({ force: true });
    await expect(player.locator('#toasts .toast').last()).toContainText(
      BUY_WORDS['no-payoff']({ name: 'Health Potion (E)', rank: 'E', price: 35, have: 0, need: 35, debt: 57, cap: 150, available: 93 }),
    );

    // Restore defaults.
    await gm.evaluate(() => {
      hunterApp.store.update((d: any) => { d.rulesOverrides = { ...d.rulesOverrides, borrowCapPrices: 1.5, reviveDebtShare: 0.5 }; }, 'test-rules');
    });
    await expect.poll(() => player.evaluate(() => hunterApp.rules().reviveDebtShare), { timeout: 15_000 }).toBe(0.5);
  });

  await test.step('Borrowed debt pays off through the existing 3-way gate clear gold split and 0.25x XP rule', async () => {
    const clearPreset = async (gateName: string, goldAmt: number, xpAmt: number) => {
      const gate = await gateByName(gm, gateName);
      await go(gm, 'gates');
      const gcard = gm.locator(`#view-gates .gate[data-id="${gate.id}"]`);
      await gcard.locator('[data-act=preset]').tap();
      const pform = gcard.locator('form[data-form=preset]');
      await pform.locator('input[name=gold]').fill(String(goldAmt));
      await pform.locator('input[name=gold]').dispatchEvent('change');
      await pform.locator('input[name=xp]').fill(String(xpAmt));
      await pform.locator('input[name=xp]').dispatchEvent('change');
      await pform.locator('[data-act=cancel-panel]').tap();
      await gcard.locator('[data-act=clear]').tap();
      const cform = gcard.locator('form[data-form=clear]');
      for (const box of await cform.locator('input[name=hid]').all()) {
        const label = (await box.locator('..').textContent()) || '';
        const want = label.includes(HUNTER);
        if ((await box.isChecked()) !== want) await box.tap();
      }
      await cform.locator('button[type=submit]').tap();
      await dismissAll(gm);
    };

    // First clear: 100 gold -> 50 to debt (7 left), 25 burned, 25 kept; 40 XP -> 10 XP.
    await clearPreset('Goblin Den', 100, 40);
    const rw1 = player.locator('.sys-overlay.show', { hasText: 'REWARD RECEIVED' });
    await expect(rw1).toBeVisible({ timeout: 15_000 });
    await expect(rw1).toContainText(debtPaidLine({ total: 100, paid: 50, burn: 25, kept: 25, left: 7 })!);
    await expect(rw1).toContainText(debtXpLine({ base: 40, xp: 10, rate: 0.25, left: 7 }));
    await dismissAll(player);
    await expect.poll(async () => { const h = await activeHunter(player); return { gold: h.gold, debt: h.debt, xp: h.xp }; }).toEqual({ gold: 25, debt: 7, xp: 10 });

    // Second clear: 100 gold -> pays last 7 debt (4 proportional burn, 89 kept), full 40 XP applied.
    await gm.evaluate(() => hunterApp.api.gates.spawn({ rank: 'E', name: 'Loan Crypt' }));
    await clearPreset('Loan Crypt', 100, 40);
    const rw2 = player.locator('.sys-overlay.show', { hasText: 'REWARD RECEIVED' });
    await expect(rw2).toBeVisible({ timeout: 15_000 });
    await expect(rw2).toContainText(debtPaidLine({ total: 100, paid: 7, burn: 4, kept: 89, left: 0 })!);
    await expect(rw2).toContainText(debtXpClearedLine(40));
    await dismissAll(player);
    await expect.poll(async () => { const h = await activeHunter(player); return { gold: h.gold, debt: h.debt, xp: h.xp }; }).toEqual({ gold: 114, debt: 0, xp: 50 });
    await expect(player.locator('[data-debt]')).toBeHidden();
    await go(gm, 'gm');
    await expect(card.locator('[data-debt-chip]')).toHaveCount(0, { timeout: 15_000 });
  });
});

test('a System revive ignores the borrow cap, stacks on shop debt, blocks further borrowing while over cap, and the Rules page states borrowing', async ({ device }) => {
  const player = (await device('alone')).page;
  await onboardPlayer(player, 'Kai Solo');
  await dismissAll(player);
  await player.evaluate(() => hunterApp.store.update((d: any) => {
    d.rulesOverrides.solo = { personal: false };
    const h = d.hunters.find((x: any) => x.id === d.settings.activeHunterId) ?? d.hunters[0];
    h.gold = 0;
    h.reviveLeft = 'debt';
  }, 'test-setup'));

  // Borrow 35 gold for a Health Potion (E) first, then die and take System revive on debt (+600 -> 635 total).
  await go(player, 'status');
  await player.locator('#view-status [data-tab="shop"]').tap();
  const potion = player.locator('#view-status [data-shopitem="Health Potion (E)"]');
  await potion.locator('[data-buy]').tap();
  await confirmWin(player).locator('.sys-actions button', { hasText: BORROW_WORDS.confirmBtn(35) }).tap();
  await expect.poll(async () => (await activeHunter(player)).debt).toBe(35);

  await player.evaluate(() => hunterApp.store.update(() => { hunterApp.store.active().life = { at: 'dead' }; }, 'test-setup'));
  const debtOffer = raiseOffer({ reviveLeft: 'debt', rank: 'E', level: 1 }, RULES)!;
  await expect(raiseWin(player)).toBeVisible();
  await raiseWin(player).locator('.sys-actions button', { hasText: debtOffer.rise }).tap();
  await expect(raiseWin(player)).toHaveCount(0);

  const owes = 35 + raiseOwes('debt', 'E', RULES);
  expect(await activeHunter(player)).toMatchObject({ life: { at: 'up', hp: 1 }, reviveLeft: 'none', debt: owes });

  // Now owing 635 (over the 150 E-rank cap), borrowing another Health Potion (E) is refused.
  await expect(player.locator('#view-status [data-shop-credit]')).toHaveText(
    shopCreditLine({ life: { at: 'up' }, gold: 0, debt: owes, rank: 'E' }, RULES)!,
  );
  await expect(potion.locator('[data-buy]')).toHaveAttribute('aria-disabled', 'true');
  await potion.locator('[data-buy]').tap({ force: true });
  await expect(player.locator('#toasts .toast').last()).toContainText(
    BUY_WORDS['over-cap']({ name: 'Health Potion (E)', rank: 'E', price: 35, have: 0, need: 35, debt: owes, cap: 150, available: 0 }),
  );

  // Rules page includes the live borrow line.
  await go(player, 'rules');
  await expect(player.locator('#rr-loot')).toContainText(borrowLine(RULES));
});
