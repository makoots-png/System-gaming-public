// The System raise (src/core/hunter/grant.ts `systemRaise`, src/core/hunter/revive-standing.ts). World rule 6: the
// first revive is free, then one on debt, then none unless the GM or a crystal; the owner, Nov 22: those two are a "System
// raise", no GM button. A dead hunter's own phone offers it once no fight holds the hunter, and the GM's phone hears it.
// The debt is RULES.reviveDebtPrices[rank] times RULES.priceBase[rank] (calibrated to about 5 gate clears at every rank under gold table B).
import type { Page } from '@playwright/test';
import { RULES } from '../../src/core/rules.ts';
import { RAISE_CHIPS, RAISE_TITLE, debtChip, debtLine, debtPaidLine, debtPreviewLine, debtXpClearedLine, debtXpLine, raiseLine, raiseOffer, raiseOwes, raisedSaid } from '../../src/core/hunter/revive-standing.ts';
import { test, expect, onboardGM, onboardPlayer, createRoom, dismissAll, go, chooseList, gateByName } from './helpers.ts';

const HUNTER = 'Kai Test', MONSTER = 'Cave Rat';
const combat = (page: Page) => page.locator('#view-combat');
const raiseWindow = (page: Page) => page.locator('.sys-overlay.show', { hasText: RAISE_TITLE });
const hunter = (page: Page) => page.evaluate(() => { const h = hunterApp.store.active(); return { life: h.life, reviveLeft: h.reviveLeft, debt: h.debt, level: h.level }; });
/** The player's hunter dead outside any fight (setup: a fall the GM applied by hand). */
const dies = (player: Page) => player.evaluate(() => hunterApp.store.update(() => { hunterApp.store.active().life = { at: 'dead' }; }, 'test-setup'));
const gmLog = (gm: Page) => gm.evaluate(() => hunterApp.store.get().log.filter((l: any) => l.title.startsWith('System revive')).map((l: any) => l.text) as string[]);
const gold = (n: number) => `${n.toLocaleString('en-US')} gold`;

test('a player\'s hunter killed in the GM\'s fight is offered the System raise once the fight ends: free, then on a debt of ten Clears, then never, and the GM\'s log hears each', async ({ device }) => {
  const gm = (await device('gm')).page, player = (await device('player')).page;
  await onboardGM(gm);
  await chooseList(gm);
  const code = await createRoom(gm);
  await onboardPlayer(player, HUNTER, code);
  await chooseList(player);
  await expect.poll(() => player.evaluate(() => hunterApp.api.sync.room())).toBe(code);
  await dismissAll(player, 4);
  await go(gm, 'gm');
  await expect(gm.locator('#gm-board .gm-card.remote', { hasText: HUNTER })).toHaveCount(1);

  await test.step('the GM\'s fight takes the hunter to 0 HP: dead, and no raise is offered while the fight holds it', async () => {
    await go(gm, 'combat');
    for (const label of [`${HUNTER} (player phone)`, await gm.evaluate(() => hunterApp.store.active().name as string)]) {
      await combat(gm).locator('[data-hsel]').selectOption({ label });
      await combat(gm).locator('[data-addh]').tap();
    }
    await combat(gm).locator('[data-qline]').fill(`${MONSTER}, E, brute`);
    await combat(gm).locator('[data-qadd]').tap();
    await combat(gm).locator('[data-start]').tap();
    await gm.evaluate(n => { const r = hunterApp.store.get().fight.rows.find((x: any) => x.name === n); hunterApp.api.combat.adjust(r.id, { hp: -9999 }); }, HUNTER);
    await expect.poll(async () => (await hunter(player)).life, { timeout: 15_000 }).toEqual({ at: 'dead' });
    await go(player, 'status');
    await expect(player.locator('#view-status [data-raise-line]')).toHaveText(raiseLine({ reviveLeft: 'free', rank: 'E', level: 1 }, RULES, true));
    await expect(player.locator('#view-status [data-raise]')).toBeHidden();
    await expect(raiseWindow(player)).toHaveCount(0);
  });

  await test.step('the GM ends the fight, and the System offers the free raise; Rise stands the hunter up', async () => {
    await combat(gm).locator('[data-end]').tap();
    await dismissAll(gm);
    const win = raiseWindow(player);
    await expect(win).toBeVisible({ timeout: 15_000 });
    const freeOffer = raiseOffer({ reviveLeft: 'free', rank: 'E', level: 1 }, RULES)!;
    await expect(win).toContainText(freeOffer.lines[0]!);
    await win.locator('.sys-actions button', { hasText: freeOffer.rise }).tap();
    await expect(win).toHaveCount(0);
    await expect.poll(async () => (await hunter(player)).life).toEqual({ at: 'up', hp: 1 });
    expect(await hunter(player)).toMatchObject({ reviveLeft: 'debt', debt: 0 });
    await expect.poll(() => gmLog(gm), { timeout: 15_000 }).toEqual([raisedSaid(HUNTER, 'free', 0).text]);
  });

  const owes = raiseOwes('debt', 'E', RULES);
  await test.step('the second death: the window names the debt, Rise on debt raises and owes it', async () => {
    await dies(player);
    const win = raiseWindow(player);
    const debtOffer = raiseOffer({ reviveLeft: 'debt', rank: 'E', level: 1 }, RULES)!;
    await expect(win).toBeVisible();
    await expect(win).toContainText(debtOffer.lines[0]!);
    await expect(win).toContainText(debtOffer.lines[2]!);
    await win.locator('.sys-actions button', { hasText: debtOffer.rise }).tap();
    await expect(win).toHaveCount(0);
    await expect.poll(async () => (await hunter(player)).life).toEqual({ at: 'up', hp: 1 });
    expect(await hunter(player)).toMatchObject({ reviveLeft: 'none', debt: owes });
    await go(player, 'inventory');
    await expect(player.locator('[data-debt]')).toHaveText(debtLine(owes)!);
    await expect.poll(() => gmLog(gm), { timeout: 15_000 }).toContain(raisedSaid(HUNTER, 'debt', owes).text);
  });

  await test.step('the third death: no raise is offered, the sheet says so, and the GM\'s card shows it', async () => {
    await dies(player);
    await go(player, 'status');
    await expect(player.locator('#view-status [data-raise-line]')).toHaveText(raiseLine({ reviveLeft: 'none', rank: 'E', level: 1 }, RULES, false));
    await expect(player.locator('#view-status [data-raise]')).toBeHidden();
    await expect(raiseWindow(player)).toHaveCount(0);
    expect((await hunter(player)).life).toEqual({ at: 'dead' });
    await go(gm, 'gm');
    await expect(gm.locator('#gm-board .gm-card.remote', { hasText: HUNTER }).locator('[data-raise-chip]')).toHaveText(RAISE_CHIPS.none, { timeout: 15_000 });
  });
});

test('a death from the GM\'s fight that reaches the player\'s phone before the fight\'s doc offers no raise until that fight ends', async ({ device }) => {
  const gm = (await device('gm', { blockServiceWorker: true })).page, player = (await device('player')).page;
  await onboardGM(gm);
  await chooseList(gm);
  const code = await createRoom(gm);
  await onboardPlayer(player, HUNTER, code);
  await chooseList(player);
  await expect.poll(() => player.evaluate(() => hunterApp.api.sync.room())).toBe(code);
  await dismissAll(player, 4);
  await go(gm, 'gm');
  await expect(gm.locator('#gm-board .gm-card.remote', { hasText: HUNTER })).toHaveCount(1);
  let letGo = (): void => {};
  const docs = new Promise<void>(r => { letGo = r; });
  await gm.route(u => u.pathname === `/api/rooms/${code}/sheets/_fight`, async route => { await docs; await route.continue(); });

  await test.step('the GM\'s fight kills the hunter while the room holds no doc of it: no raise is offered, and none can be taken', async () => {
    await go(gm, 'combat');
    for (const label of [`${HUNTER} (player phone)`, await gm.evaluate(() => hunterApp.store.active().name as string)]) {
      await combat(gm).locator('[data-hsel]').selectOption({ label });
      await combat(gm).locator('[data-addh]').tap();
    }
    await combat(gm).locator('[data-qline]').fill(`${MONSTER}, E, brute`);
    await combat(gm).locator('[data-qadd]').tap();
    await combat(gm).locator('[data-start]').tap();
    await gm.evaluate(n => { const r = hunterApp.store.get().fight.rows.find((x: any) => x.name === n); hunterApp.api.combat.adjust(r.id, { hp: -9999 }); }, HUNTER);
    await expect.poll(async () => (await hunter(player)).life, { timeout: 15_000 }).toEqual({ at: 'dead' });
    expect(await player.evaluate(() => hunterApp.api.sync.doc('fight'))).toBeNull();
    await go(player, 'status');
    await expect(player.locator('#view-status [data-raise-line]')).toHaveText(raiseLine({ reviveLeft: 'free', rank: 'E', level: 1 }, RULES, true));
    await expect(player.locator('#view-status [data-raise]')).toBeHidden();
    await expect(raiseWindow(player)).toHaveCount(0);
    expect(await player.evaluate(() => hunterApp.api.hunter.systemRaise(hunterApp.store.active().id))).toMatchObject({ ok: false, why: 'held' });
  });

  await test.step('the fight\'s doc reaches the room and the GM ends the fight: then the raise is offered', async () => {
    letGo();
    await expect.poll(() => player.evaluate(() => hunterApp.api.sync.doc('fight')?.active ?? false), { timeout: 15_000 }).toBe(true);
    await expect(raiseWindow(player)).toHaveCount(0);
    await combat(gm).locator('[data-end]').tap();
    await dismissAll(gm);
    await expect(raiseWindow(player)).toBeVisible({ timeout: 15_000 });
  });
});

test('Not now leaves the hunter dead, and Rise on the sheet opens the window again', async ({ device }) => {
  const player = (await device('alone')).page;
  await onboardPlayer(player, HUNTER);
  await dismissAll(player);
  await player.evaluate(() => hunterApp.store.update((d: any) => { d.rulesOverrides.solo = { personal: false }; }, 'test-setup'));
  await dies(player);
  const win = raiseWindow(player);
  await expect(win).toBeVisible();
  await win.locator('.sys-actions button', { hasText: 'Not now' }).tap();
  await expect(win).toHaveCount(0);
  expect((await hunter(player)).life).toEqual({ at: 'dead' });
  await go(player, 'status');
  await expect(player.locator('#view-status [data-raise-line]')).toHaveText(raiseLine({ reviveLeft: 'free', rank: 'E', level: 1 }, RULES, false));
  await player.locator('#view-status [data-raise]').tap();
  await expect(win).toBeVisible();
  await win.locator('.sys-actions button', { hasText: raiseOffer({ reviveLeft: 'free', rank: 'E', level: 1 }, RULES)!.rise }).tap();
  await expect.poll(async () => (await hunter(player)).life).toEqual({ at: 'up', hp: 1 });
  await expect(player.locator('#view-status [data-death]')).toBeHidden();
});

test('gate clear gold splits three ways for System revive debt, XP is cut while owing, room rules sync, and paying off debt restores full XP', async ({ device }) => {
  const gm = (await device('gm')).page, player = (await device('player')).page;
  await onboardGM(gm);
  const code = await createRoom(gm);
  await onboardPlayer(player, HUNTER, code);
  await expect.poll(() => player.evaluate(() => hunterApp.api.sync.room())).toBe(code);
  await dismissAll(player, 4);
  await go(gm, 'gm');
  const card = gm.locator('#gm-board .gm-card.remote', { hasText: HUNTER });
  await expect(card).toHaveCount(1);

  // Put player on System revive debt (1,000 gold at E rank) via two System revives.
  await player.evaluate(() => hunterApp.store.update((d: any) => { d.rulesOverrides.solo = { personal: false }; }, 'test-setup'));
  await dies(player);
  const freeOffer = raiseOffer({ reviveLeft: 'free', rank: 'E', level: 1 }, RULES)!;
  await raiseWindow(player).locator('.sys-actions button', { hasText: freeOffer.rise }).tap();
  await expect(raiseWindow(player)).toHaveCount(0);
  await dies(player);
  const debtOffer = raiseOffer({ reviveLeft: 'debt', rank: 'E', level: 1 }, RULES)!;
  await raiseWindow(player).locator('.sys-actions button', { hasText: debtOffer.rise }).tap();
  await expect(raiseWindow(player)).toHaveCount(0);

  const owes = raiseOwes('debt', 'E', RULES);
  await expect.poll(async () => (await hunter(player)).debt).toBe(owes);
  await expect(card.locator('[data-debt-chip]')).toHaveText(debtChip(owes)!, { timeout: 15_000 });

  // GM overrides reviveDebtShare (0.4), reviveDebtBurn (0.2), and reviveDebtXpRate (0.5) and verifies all three sync to the player.
  await gm.evaluate(() => {
    hunterApp.store.update((d: any) => { d.rulesOverrides = { ...d.rulesOverrides, reviveDebtShare: 0.4, reviveDebtBurn: 0.2, reviveDebtXpRate: 0.5 }; }, 'test-rules');
  });
  await expect.poll(() => player.evaluate(() => {
    const r = hunterApp.rules();
    return { share: r.reviveDebtShare, burn: r.reviveDebtBurn, xp: r.reviveDebtXpRate };
  }), { timeout: 15_000 }).toEqual({ share: 0.4, burn: 0.2, xp: 0.5 });

  // GM sets a 400 gold + 40 XP preset on Goblin Den, clears it, sees the 3-way split + XP cut preview, and approves.
  const gate = await gateByName(gm, 'Goblin Den');
  await go(gm, 'gates');
  const gcard = gm.locator(`#view-gates .gate[data-id="${gate.id}"]`);
  await gcard.locator('[data-act=preset]').tap();
  const pform = gcard.locator('form[data-form=preset]');
  await pform.locator('input[name=gold]').fill('400');
  await pform.locator('input[name=gold]').dispatchEvent('change');
  await pform.locator('input[name=xp]').fill('40');
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

  const firstPaid = { total: 400, paid: 160, burn: 80, kept: 160, left: owes - 160 };
  const firstXp = { base: 40, xp: 20, rate: 0.5, left: owes - 160 };

  await go(gm, 'gm');
  const waitSec = gm.locator('.gm-sec[data-sec=waiting]');
  if (await waitSec.locator('.gm-body').isHidden()) await waitSec.locator('.gm-tog').tap();
  const prow = waitSec.locator('.gm-pw-row', { hasText: HUNTER });
  await expect(prow.locator('[data-pw-debt]')).toHaveText(debtPreviewLine(firstPaid, firstXp)!);
  await prow.locator('[data-pw-approve]').tap();

  const rewardWin = player.locator('.sys-overlay.show', { hasText: 'REWARD RECEIVED' });
  await expect(rewardWin).toBeVisible({ timeout: 15_000 });
  await expect(rewardWin).toContainText(debtPaidLine(firstPaid)!);
  await expect(rewardWin).toContainText(debtXpLine(firstXp));
  await dismissAll(player);

  await expect.poll(async () => player.evaluate(() => { const h = hunterApp.store.active(); return { gold: h.gold, xp: h.xp, debt: h.debt }; })).toEqual({ gold: 160, xp: 20, debt: owes - 160 });
  await expect(card.locator('[data-debt-chip]')).toHaveText(debtChip(owes - 160)!, { timeout: 15_000 });

  // GM restores defaults (0.5 share, 0.25 burn, 0.25 XP) and sends a 2,000 gold + 60 XP clear to pay off the remaining debt.
  // Proportional burn on remaining debt applies, and the hunter gets full 60 XP because debt reaches 0.
  await gm.evaluate(() => {
    hunterApp.store.update((d: any) => { d.rulesOverrides = { ...d.rulesOverrides, reviveDebtShare: 0.5, reviveDebtBurn: 0.25, reviveDebtXpRate: 0.25 }; }, 'test-rules');
  });
  await expect.poll(() => player.evaluate(() => {
    const r = hunterApp.rules();
    return { share: r.reviveDebtShare, burn: r.reviveDebtBurn, xp: r.reviveDebtXpRate };
  }), { timeout: 15_000 }).toEqual({ share: 0.5, burn: 0.25, xp: 0.25 });

  const g2 = await gm.evaluate(() => hunterApp.api.gates.spawn({ rank: 'E', name: 'Debt Crypt' })!.id as string);
  await go(gm, 'gates');
  const gcard2 = gm.locator(`#view-gates .gate[data-id="${g2}"]`);
  await gcard2.locator('[data-act=preset]').tap();
  const pform2 = gcard2.locator('form[data-form=preset]');
  await pform2.locator('input[name=gold]').fill('2000');
  await pform2.locator('input[name=gold]').dispatchEvent('change');
  await pform2.locator('input[name=xp]').fill('60');
  await pform2.locator('input[name=xp]').dispatchEvent('change');
  await pform2.locator('[data-act=cancel-panel]').tap();
  await gcard2.locator('[data-act=clear]').tap();
  const cform2 = gcard2.locator('form[data-form=clear]');
  for (const box of await cform2.locator('input[name=hid]').all()) {
    const label = (await box.locator('..').textContent()) || '';
    const want = label.includes(HUNTER);
    if ((await box.isChecked()) !== want) await box.tap();
  }
  await cform2.locator('button[type=submit]').tap();
  await dismissAll(gm);

  const rem = owes - 160;
  const finalBurn = Math.round(rem * (RULES.reviveDebtBurn / RULES.reviveDebtShare));
  const finalKept = 2000 - rem - finalBurn;
  const finalPaid = { total: 2000, paid: rem, burn: finalBurn, kept: finalKept, left: 0 };

  await go(gm, 'gm');
  const prow2 = waitSec.locator('.gm-pw-row', { hasText: HUNTER });
  await expect(prow2.locator('[data-pw-debt]')).toHaveText(debtPreviewLine(finalPaid, null)!);
  await prow2.locator('[data-pw-approve]').tap();

  await expect(rewardWin).toBeVisible({ timeout: 15_000 });
  await expect(rewardWin).toContainText(debtPaidLine(finalPaid)!);
  await expect(rewardWin).toContainText(debtXpClearedLine(60));
  await dismissAll(player);

  await expect.poll(async () => player.evaluate(() => { const h = hunterApp.store.active(); return { gold: h.gold, xp: h.xp, debt: h.debt, reviveLeft: h.reviveLeft }; })).toEqual({ gold: 160 + finalKept, xp: 80, debt: 0, reviveLeft: 'none' });
  await go(player, 'inventory');
  await expect(player.locator('[data-debt]')).toBeHidden();
  await expect(card.locator('[data-debt-chip]')).toHaveCount(0, { timeout: 15_000 });
});
