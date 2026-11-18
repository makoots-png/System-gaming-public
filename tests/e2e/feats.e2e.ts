// A feat the System notices on its own (src/core/hunter/feats.ts, noticed.ts) and its window (src/views/feats.js):
// earned in the write of the fact, told once, and told again after a reload until the player answers it.
import type { Page } from '@playwright/test';
import { test, expect, onboardPlayer, dismissAll, go, activeHunter, answerWindow } from './helpers.ts';

const topWindow = (page: Page) => page.locator('.sys-overlay.show .sys-window').first();

test('a player who finishes the daily seven days running sees SEVEN DAYS once, again after a reload until answered, and the title it gives', async ({ device }) => {
  const page = (await device('player')).page;
  await onboardPlayer(page, 'Mira Test');
  await dismissAll(page);

  await test.step('setup: six days of dailies done, the last one yesterday', async () => {
    await page.evaluate(() => hunterApp.store.update((d: any) => {
      const today = d.world.lastDailyKey, y = new Date(`${today}T12:00:00Z`);
      y.setUTCDate(y.getUTCDate() - 1);
      d.hunters[0].daily = { ...d.hunters[0].daily, streak: 6, lastCompleteKey: y.toISOString().slice(0, 10) };
      d.rulesOverrides.solo = { personal: false };
    }, 'test-setup'));
  });

  await test.step('the player completes today\'s daily: its window, then the feat\'s', async () => {
    await go(page, 'quests');
    await page.locator('#view-quests [data-tab="daily"]').tap();
    const done = page.locator('#view-quests [data-done]').first();
    await done.evaluate((el: any) => el.scrollIntoView({ block: 'center' }));
    await done.tap();
    await topWindow(page).locator('.sys-actions button.primary', { hasText: 'Complete' }).tap();
    await answerWindow(page, 'DAILY QUEST COMPLETE');
    const feat = page.locator('.sys-overlay.show', { hasText: 'SEVEN DAYS' });
    await expect(feat).toBeVisible();
    await expect(feat).toContainText('The daily quest finished seven days running.');
    await expect(feat).toContainText('Title acquired: Early Riser');
    const h = await activeHunter(page);
    expect(h.chronicle.feats['early-riser'].at).toBe('earned');
    expect(h.titles.map((t: any) => t.name)).toContain('Early Riser');
  });

  await test.step('a reload before it is answered shows it again; answered, a reload shows it no more', async () => {
    await page.reload();
    const feat = page.locator('.sys-overlay.show', { hasText: 'SEVEN DAYS' });
    await expect(feat).toBeVisible();
    await feat.locator('.sys-actions button', { hasText: 'Understood' }).tap();
    await expect(feat).toHaveCount(0);
    await page.reload();
    // the windows of what is earned and not told open on the app's `ready`; the told list says this one was told
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem(`hunter-system-feat-told:${hunterApp.store.get().hunters[0].id}`) || '[]'))).toEqual(['early-riser']);
    await expect(page.locator('#view-quests')).toBeVisible();
    await expect(page.locator('.sys-overlay.show', { hasText: 'SEVEN DAYS' })).toHaveCount(0);
  });
});
