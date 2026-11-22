// The System raise (src/core/hunter/grant.ts `systemRaise`, src/core/hunter/revive-standing.ts). World rule 6: the
// first revive is free, then one on debt, then none unless the GM or a crystal; the owner, Nov 22: those two are a "System
// raise", no GM button. A dead hunter's own phone offers it once no fight holds the hunter, and the GM's phone hears it.
// The debt is RULES.reviveDebtClears Clears of the hunter's rank (economy.md section 13).
import type { Page } from '@playwright/test';
import { RULES, clearOf } from '../../src/core/rules.ts';
import { test, expect, onboardGM, onboardPlayer, createRoom, dismissAll, go, chooseList } from './helpers.ts';

const HUNTER = 'Kai Test', MONSTER = 'Cave Rat';
const combat = (page: Page) => page.locator('#view-combat');
const raiseWindow = (page: Page) => page.locator('.sys-overlay.show', { hasText: 'THE SYSTEM CAN RAISE YOU' });
const hunter = (page: Page) => page.evaluate(() => { const h = hunterApp.store.active(); return { life: h.life, reviveLeft: h.reviveLeft, debt: h.debt, level: h.level }; });
/** The player's hunter dead outside any fight (setup: a fall the GM applied by hand). */
const dies = (player: Page) => player.evaluate(() => hunterApp.store.update(() => { hunterApp.store.active().life = { at: 'dead' }; }, 'test-setup'));
const gmLog = (gm: Page) => gm.evaluate(() => hunterApp.store.get().log.filter((l: any) => l.title.startsWith('System raise')).map((l: any) => l.text) as string[]);
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
    for (const label of [`${HUNTER} (remote)`, await gm.evaluate(() => hunterApp.store.active().name as string)]) {
      await combat(gm).locator('[data-hsel]').selectOption({ label });
      await combat(gm).locator('[data-addh]').tap();
    }
    await combat(gm).locator('[data-qline]').fill(`${MONSTER}, E, brute`);
    await combat(gm).locator('[data-qadd]').tap();
    await combat(gm).locator('[data-start]').tap();
    await gm.evaluate(n => { const r = hunterApp.store.get().fight.rows.find((x: any) => x.name === n); hunterApp.api.combat.adjust(r.id, { hp: -9999 }); }, HUNTER);
    await expect.poll(async () => (await hunter(player)).life, { timeout: 15_000 }).toEqual({ at: 'dead' });
    await go(player, 'status');
    await expect(player.locator('#view-status [data-raise-line]')).toHaveText('Once the fight ends, the System can raise you once for free.');
    await expect(player.locator('#view-status [data-raise]')).toBeHidden();
    await expect(raiseWindow(player)).toHaveCount(0);
  });

  await test.step('the GM ends the fight, and the System offers the free raise; Rise stands the hunter up', async () => {
    await combat(gm).locator('[data-end]').tap();
    await dismissAll(gm);
    const win = raiseWindow(player);
    await expect(win).toBeVisible({ timeout: 15_000 });
    await expect(win).toContainText('Cost: nothing. This is your free raise.');
    await win.locator('.sys-actions button', { hasText: 'Rise' }).tap();
    await expect(win).toHaveCount(0);
    await expect.poll(async () => (await hunter(player)).life).toEqual({ at: 'up', hp: 1 });
    expect(await hunter(player)).toMatchObject({ reviveLeft: 'debt', debt: 0 });
    await expect.poll(() => gmLog(gm), { timeout: 15_000 }).toEqual([`The System raised ${HUNTER} for free. One raise on debt is left.`]);
  });

  const owes = RULES.reviveDebtClears * clearOf(RULES, 'E');
  await test.step('the second death: the window names the debt, Rise on debt raises and owes it', async () => {
    await dies(player);
    const win = raiseWindow(player);
    await expect(win).toBeVisible();
    await expect(win).toContainText(`Cost: a debt of ${gold(owes)}, ${RULES.reviveDebtClears} E-rank Clears.`);
    await expect(win).toContainText('After this, only a Resurrection Crystal or the GM brings you back.');
    await win.locator('.sys-actions button', { hasText: `Rise on debt: ${gold(owes)}` }).tap();
    await expect(win).toHaveCount(0);
    await expect.poll(async () => (await hunter(player)).life).toEqual({ at: 'up', hp: 1 });
    expect(await hunter(player)).toMatchObject({ reviveLeft: 'none', debt: owes });
    await go(player, 'inventory');
    await expect(player.locator('[data-debt]')).toHaveText(`Owed to the System for a raise on debt: ${gold(owes)}.`);
    await expect.poll(() => gmLog(gm), { timeout: 15_000 }).toContain(`The System raised ${HUNTER} on a debt of ${gold(owes)}. No System raise is left.`);
  });

  await test.step('the third death: no raise is offered, the sheet says so, and the GM\'s card shows it', async () => {
    await dies(player);
    await go(player, 'status');
    await expect(player.locator('#view-status [data-raise-line]')).toHaveText('The System will not raise you again.');
    await expect(player.locator('#view-status [data-raise]')).toBeHidden();
    await expect(raiseWindow(player)).toHaveCount(0);
    expect((await hunter(player)).life).toEqual({ at: 'dead' });
    await go(gm, 'gm');
    await expect(gm.locator('#gm-board .gm-card.remote', { hasText: HUNTER }).locator('[data-raise-chip]')).toHaveText('No System raise', { timeout: 15_000 });
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
    for (const label of [`${HUNTER} (remote)`, await gm.evaluate(() => hunterApp.store.active().name as string)]) {
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
    await expect(player.locator('#view-status [data-raise-line]')).toHaveText('Once the fight ends, the System can raise you once for free.');
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
  await expect(player.locator('#view-status [data-raise-line]')).toHaveText('The System can raise you once for free.');
  await player.locator('#view-status [data-raise]').tap();
  await expect(win).toBeVisible();
  await win.locator('.sys-actions button', { hasText: 'Rise' }).tap();
  await expect.poll(async () => (await hunter(player)).life).toEqual({ at: 'up', hp: 1 });
  await expect(player.locator('#view-status [data-death]')).toBeHidden();
});
