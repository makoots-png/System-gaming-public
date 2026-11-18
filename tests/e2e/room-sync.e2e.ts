import { test, expect, onboardGM, onboardPlayer, createRoom, dismissAll, editIdentity, go, activeHunter } from './helpers.ts';

test('a GM and a player in one room see each other\'s changes', async ({ device }) => {
  const gm = (await device('gm')).page, player = (await device('player')).page;
  const kaiCard = gm.locator('#gm-board .gm-card.remote', { hasText: 'Kai Test' });

  await test.step('the GM creates a room and the player joins with the code', async () => {
    await onboardGM(gm);
    const code = await createRoom(gm);
    await onboardPlayer(player, 'Kai Test', code);
    await expect.poll(() => player.evaluate(() => hunterApp.api.sync.room())).toBe(code);
    await dismissAll(player, 4);
    await go(gm, 'gm');
    await expect(kaiCard).toHaveCount(1);
  });

  await test.step('a change on the player sheet reaches the GM card', async () => {
    await go(player, 'status');
    const before = await activeHunter(player);
    await player.locator('#view-status [data-hp="-5"]').first().tap();
    await editIdentity(player, 'job', 'Mage');
    await expect(kaiCard).toContainText(`${before.hp - 5} / ${before.derived.hpMax}`);
    await expect(kaiCard).toContainText('Mage');
  });

  await test.step('a GM award of XP and gold arrives on the player once', async () => {
    const before = await activeHunter(player);
    const toggle = gm.locator('[data-tog="award"]');
    if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.tap();
    await gm.locator('#gm-targets label', { hasText: 'Kai Test' }).locator('input').check();
    await gm.fill('#gm-xp', '30');
    await gm.fill('#gm-gold', '12');
    await gm.locator('#gm-award-go').tap();
    await expect.poll(async () => (await activeHunter(player)).xp).toBe(before.xp + 30);
    expect((await activeHunter(player)).gold).toBe(before.gold + 12);
    await expect(player.locator('.sys-overlay.show, #toasts .toast').first()).toBeVisible();
    await dismissAll(player, 6);
  });

  await test.step('GM damage from the party board lowers the player\'s HP', async () => {
    const before = await activeHunter(player);
    await kaiCard.locator('[data-hp="-5"]').tap();
    await expect.poll(async () => (await activeHunter(player)).hp).toBe(before.hp - 5);
  });

  await test.step('a reload on the player applies nothing twice', async () => {
    await player.waitForTimeout(1500);
    const before = await activeHunter(player);
    await player.reload({ waitUntil: 'networkidle' });
    await player.waitForFunction(() => window.hunterApp && document.querySelectorAll('#nav-top a').length > 0);
    await player.waitForTimeout(8000);
    await dismissAll(player, 4);
    const after = await activeHunter(player);
    expect({ xp: after.xp, gold: after.gold, hp: after.hp, level: after.level }).toEqual({ xp: before.xp, gold: before.gold, hp: before.hp, level: before.level });
    await expect(kaiCard).toHaveCount(1);
  });
});
