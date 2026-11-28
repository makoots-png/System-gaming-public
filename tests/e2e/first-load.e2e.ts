import { test, expect, PHONE } from './helpers.ts';
import { WELCOME_WORDS } from '../../src/core/first-run.ts';

test('first load explains what the app is, removes Window active, captures a phone screenshot, and opens the role step', async ({ device }) => {
  const { page } = await device('fresh', { viewport: PHONE, blockServiceWorker: true });
  await page.goto('/');
  await page.waitForFunction(() => window.hunterApp && document.querySelectorAll('#nav-top a').length > 0);

  const overlay = page.locator('.ob-overlay');
  const dialog = overlay.locator('[role="dialog"]');
  await expect(dialog).toBeVisible();

  await expect(dialog.locator('h2')).toHaveText(WELCOME_WORDS.title);
  await expect(dialog).toContainText(WELCOME_WORDS.kicker);
  await expect(dialog).toContainText(WELCOME_WORDS.lead);
  await expect(dialog).toContainText(WELCOME_WORDS.gmLine);
  await expect(dialog).toContainText(WELCOME_WORDS.playerLine);
  await expect(dialog.locator('[data-yes]')).toHaveText(WELCOME_WORDS.start);
  await expect(dialog.locator('[data-skip]')).toHaveText(WELCOME_WORDS.skip);

  const bodyText = await page.locator('body').innerText();
  expect(bodyText).not.toContain('Window active');
  expect(bodyText).not.toContain('Every person has had a System window');

  expect(await overlay.evaluate(el => el.scrollHeight <= el.clientHeight)).toBe(true);
  await page.screenshot({ path: process.env.FIRST_LOAD_SHOT || 'test-results/first-load.png' });

  await dialog.locator('[data-yes]').tap();
  await expect(dialog.locator('h2')).toHaveText('Who are you?');
  await expect(dialog.locator('[data-player]')).toHaveText("I'm a Player");
  await expect(dialog.locator('[data-gm]')).toHaveText("I'm the GM");
});
