import { test, expect, onboardPlayer, type Page } from './helpers.ts';

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
