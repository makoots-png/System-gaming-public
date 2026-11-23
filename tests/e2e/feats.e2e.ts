// A feat the System notices on its own (src/core/hunter/feats.ts, noticed.ts) and its window (src/views/feats.js):
// earned in the write of the fact, told once, and told again after a reload until the player answers it.
import type { Page } from '@playwright/test';
import { test, expect, onboardGM, onboardPlayer, dismissAll, go, activeHunter, answerWindow } from './helpers.ts';
import { FEATS_SWITCH_WORDS } from '../../src/core/hunter/chronicle-view.ts';

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
    await expect.poll(() => page.evaluate(() => hunterApp.store.told().feat[hunterApp.store.get().hunters[0].id] ?? [])).toEqual(['early-riser']);
    await expect(page.locator('#view-quests')).toBeVisible();
    await expect(page.locator('.sys-overlay.show', { hasText: 'SEVEN DAYS' })).toHaveCount(0);
  });

  await test.step('the Chronicle on the sheet names the feat with what it gave, and says what happened', async () => {
    await go(page, 'status');
    await page.locator('#view-status [data-jump="chronicle"]').tap();
    const panel = page.locator('#view-status [data-panel="chronicle"]');
    const feat = panel.locator('[data-chr-earned="early-riser"]');
    await expect(feat).toContainText('Early Riser');
    await expect(feat).toContainText('The daily quest finished seven days running.');
    await expect(feat).toContainText('Title acquired: Early Riser');
    await expect(panel.locator('.chr-nums div', { hasText: 'Feats' }).locator('dd')).toHaveText('1');
    const facts = panel.locator('.chr-facts li');
    await expect(facts.filter({ hasText: 'Earned the feat Early Riser.' })).toHaveCount(1);
    await expect(facts.filter({ hasText: 'Finished the day\'s daily quests, 7 days in a row.' })).toHaveCount(1);
    await expect(facts.filter({ hasText: 'Got the title Early Riser.' })).toHaveCount(1);
  });
});

test('the GM turns feats off in the GM view: a hunter who then finishes a seventh daily earns nothing, the Chronicle says feats are off, and On brings them back', async ({ device }) => {
  const gm = (await device('gm')).page;
  await onboardGM(gm);
  await gm.evaluate(() => hunterApp.store.update((d: any) => {
    const today = d.world.lastDailyKey, y = new Date(`${today}T12:00:00Z`);
    y.setUTCDate(y.getUTCDate() - 1);
    const h = d.hunters.find((x: any) => x.id === d.settings.activeHunterId);
    h.daily = { ...h.daily, streak: 6, lastCompleteKey: y.toISOString().slice(0, 10) };
    d.rulesOverrides.solo = { personal: false };
  }, 'test-setup'));
  await dismissAll(gm);

  await test.step('two taps in the GM view turn every feat off, and the session log says so', async () => {
    await go(gm, 'gm');
    await gm.locator('[data-tog="rules"]').tap();
    const off = gm.locator('[data-feats="off"]');
    await expect(gm.locator('.gm-switch', { has: gm.locator('[data-feats]') })).toContainText(FEATS_SWITCH_WORDS.label);
    await expect(gm.locator('[data-feats="on"]')).toHaveAttribute('aria-pressed', 'true');
    await off.tap();
    await expect(off).toHaveAttribute('aria-pressed', 'true');
    expect(await gm.evaluate(() => hunterApp.rules().feats.on)).toBe(false);
    expect(await gm.evaluate(() => hunterApp.store.get().log.some((l: any) => l.text === 'Feats turned off for the table.'))).toBe(true);
  });

  await test.step('the Workshop\'s Feats says they are off and where to turn them on', async () => {
    await go(gm, 'workshop');
    await expect(gm.locator('#view-workshop [data-ws="feat"] [data-ws-featsoff]')).toHaveText('Feats are turned off for the table. Turn them on in the GM view, under Rules editor.');
  });

  await test.step('the seventh daily in a row opens its own window and no feat\'s', async () => {
    await go(gm, 'quests');
    await gm.locator('#view-quests [data-tab="daily"]').tap();
    const done = gm.locator('#view-quests [data-done]').first();
    await done.evaluate((el: any) => el.scrollIntoView({ block: 'center' }));
    await done.tap();
    await topWindow(gm).locator('.sys-actions button.primary', { hasText: 'Complete' }).tap();
    await answerWindow(gm, 'DAILY QUEST COMPLETE');
    const h = await activeHunter(gm);
    expect(h.daily.streak).toBe(7);
    expect(h.chronicle.feats['early-riser']).toBeUndefined();
    await expect(gm.locator('.sys-overlay.show', { hasText: 'SEVEN DAYS' })).toHaveCount(0);
  });

  await test.step('the Chronicle says feats are off and lists none in progress; turned on again, it lists them', async () => {
    await go(gm, 'status');
    const panel = gm.locator('#view-status [data-panel="chronicle"]');
    await expect(panel.locator('[data-chr-off]')).toHaveText('Feats are turned off. Nothing counts toward a feat until they are on again.');
    await expect(panel.locator('[data-chr-shown]')).toHaveCount(0);
    await go(gm, 'gm');
    await gm.locator('[data-feats="on"]').tap();
    expect(await gm.evaluate(() => hunterApp.rules().feats.on)).toBe(true);
    await go(gm, 'status');
    await expect(panel.locator('[data-chr-off]')).toHaveCount(0);
    await expect(panel.locator('[data-chr-shown]')).toHaveCount(3);
  });
});
