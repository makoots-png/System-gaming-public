import { test, expect, chooseList, go, setupGoblinDenGM, onboardPlayer, startGoblinDenFight, type Page } from './helpers.ts';

/** Whether the System window `title` names is what the player sees at its own middle, with no other window drawn over it. */
const seenOnTop = (page: Page, title: string): Promise<boolean> => page.evaluate(t => {
  const win = [...document.querySelectorAll('.sys-overlay.show .sys-window')].find(w => w.textContent?.includes(t));
  if (!win) return false;
  const r = win.getBoundingClientRect(), at = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  return !!at && win.contains(at);
}, title);
/** Whether the focus is in the quick start guide. */
const focusInGuide = (page: Page): Promise<boolean> => page.evaluate(() => !!document.activeElement?.closest('.ob-overlay'));

test('a System window that comes while the quick start guide is open waits behind it: the guide keeps the focus and Escape, and the window shows when the guide closes', async ({ device }) => {
  const { page } = await device('player');
  const guide = page.locator('.ob-overlay', { has: page.locator('h2', { hasText: 'How it works' }) });
  const gate = page.locator('.sys-overlay.show', { hasText: 'GATE CLEARED' });

  await test.step('the player opens the quick start guide', async () => {
    await onboardPlayer(page, 'Window Watcher');
    await page.locator('#help-btn').tap();
    await expect(guide).toBeVisible();
    await expect.poll(() => focusInGuide(page)).toBe(true);
  });

  await test.step('a System window comes, and the guide keeps the focus', async () => {
    await page.evaluate(() => { void hunterApp.ui.system({ tag: '! Notification', kind: 'quest', title: 'GATE CLEARED', body: 'The gate is closed.' }); });
    await expect(guide).toBeVisible();
    await expect.poll(() => focusInGuide(page)).toBe(true);
  });

  await test.step('Escape closes the guide, and the System window shows on top', async () => {
    await page.keyboard.press('Escape');
    await expect(guide).toHaveCount(0);
    await expect(gate).toBeVisible();
    await expect.poll(() => seenOnTop(page, 'GATE CLEARED')).toBe(true);
  });

  await test.step('Escape again takes off the System window', async () => {
    await page.keyboard.press('Escape');
    await expect(gate).toHaveCount(0);
  });
});

const DESKTOP = { width: 1280, height: 800 };
/** Whether the focus is in the dice roller's sheet. */
const focusInRoller = (page: Page): Promise<boolean> => page.evaluate(() => !!document.activeElement?.closest('#dice-sheet'));

test('on a desktop, Escape takes down the dice roller after a click beside it, and the keyboard shortcuts work again', async ({ device }) => {
  const { page } = await device('player', { viewport: DESKTOP });
  const roller = page.locator('#dice-sheet');
  await onboardPlayer(page, 'Quick Roller');

  await test.step('the player opens the dice roller, then clicks on the page beside it', async () => {
    await page.locator('#dice-fab').click();
    await expect(roller).toBeVisible();
    await page.locator('#view-status h2').first().click();
    await expect.poll(() => focusInRoller(page)).toBe(false);
  });

  await test.step('Escape takes the dice roller down', async () => {
    await page.keyboard.press('Escape');
    await expect(roller).toBeHidden();
  });

  await test.step('? opens the keyboard list again', async () => {
    await page.keyboard.press('?');
    await expect(page.locator('.sys-overlay.show', { hasText: 'KEYBOARD' })).toBeVisible();
  });
});

test('on the Dice page, the dice roller\'s Dice tab takes the roller down', async ({ device }) => {
  const { page } = await device('player', { viewport: DESKTOP });
  const roller = page.locator('#dice-sheet');
  await onboardPlayer(page, 'Quick Roller');
  await go(page, 'dice');
  await page.locator('#dice-fab').click();
  await expect(roller).toBeVisible();
  await roller.locator('[data-full]').click();
  await expect(roller).toBeHidden();
  await expect(page.locator('#view-dice')).toBeVisible();
});

test('a GM\'s Fight tools over the map go with Escape, and are not open again on the way back to Combat', async ({ device }) => {
  const { page } = await device('gm');
  const tools = page.locator('#view-combat').getByRole('dialog', { name: 'Fight tools' });
  await setupGoblinDenGM(page);
  await chooseList(page);
  await go(page, 'gates');
  await startGoblinDenFight(page);
  await page.locator('#view-combat [data-fview="map"]').tap();

  await test.step('the GM opens the Fight tools and presses Escape', async () => {
    await page.locator('#view-combat [data-tools-open]').tap();
    await expect(tools).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(tools).toBeHidden();
  });

  await test.step('the GM opens them again, goes to the GM tab and back to Combat', async () => {
    await page.locator('#view-combat [data-tools-open]').tap();
    await expect(tools).toBeVisible();
    await page.locator('#nav-bottom a[href="#/gm"]').tap();
    await expect(page.locator('#view-gm')).toBeVisible();
    await page.locator('#nav-bottom a[href="#/combat"]').tap();
    await expect(page.locator('#view-combat [data-tools-open]')).toBeVisible();
    await expect(tools).toBeHidden();
  });
});
