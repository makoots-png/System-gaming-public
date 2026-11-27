import { test, expect, onboardGM, onboardPlayer, createRoom, dismissAll, go } from './helpers.ts';
import { PRIMER_WORDS, WORLD_PRIMER } from '../../src/core/first-run.ts';

const OB = '.ob-overlay';

test('solo mode without a room keeps showing the world primer in ? Quick Start', async ({ device }) => {
  const solo = (await device('solo', { viewport: { width: 360, height: 640 } })).page;
  await onboardPlayer(solo, 'Solo Reader');
  await solo.locator('#help-btn').tap();
  const guide = solo.locator(OB, { has: solo.locator('h2', { hasText: 'How it works' }) });
  await expect(guide).toBeVisible();
  await expect(guide.locator('[data-primer] summary')).toHaveText('Read aloud: World primer');
  await guide.locator('[data-ok]').tap();
  await expect(solo.locator(OB)).toHaveCount(0);
});

test('the world primer is hidden from room players until the GM unlocks it, syncs live and on rejoin, and hides again when locked', async ({ device }) => {
  const gm = (await device('gm', { viewport: { width: 360, height: 640 } })).page;
  const player = (await device('player', { viewport: { width: 360, height: 640 } })).page;

  await onboardGM(gm);
  const code = await createRoom(gm);
  await onboardPlayer(player, 'Tessa Player', code);
  await expect.poll(() => player.evaluate(() => hunterApp.api.sync.room())).toBe(code);
  await dismissAll(player, 4);

  await test.step('the GM always sees the primer in ? Quick Start even while locked for players', async () => {
    await gm.locator('#help-btn').tap();
    const guide = gm.locator(OB, { has: gm.locator('h2', { hasText: 'How it works' }) });
    await expect(guide.locator('[data-primer] summary')).toHaveText('Read aloud: World primer');
    await guide.locator('[data-ok]').tap();
    await expect(gm.locator(OB)).toHaveCount(0);
  });

  await test.step('a player in the room does not see the primer while locked', async () => {
    await player.locator('#help-btn').tap();
    const guide = player.locator(OB, { has: player.locator('h2', { hasText: 'How it works' }) });
    await expect(guide).toBeVisible();
    await expect(guide.locator('[data-primer]')).toHaveCount(0);
  });

  await test.step('GM unlocks the primer from the Room view and the player sees it live', async () => {
    await go(gm, 'room');
    const toggle = gm.locator('#view-room [data-primertoggle]');
    await expect(toggle).toHaveText(PRIMER_WORDS.show);
    await expect(gm.locator('#view-room [data-primerstate]')).toHaveText(PRIMER_WORDS.hidden);
    const box = await toggle.boundingBox();
    expect(box && box.height >= 44 && box.width >= 44).toBe(true);

    await toggle.tap();
    await expect(toggle).toHaveText(PRIMER_WORDS.hide);
    await expect(gm.locator('#view-room [data-primerstate]')).toHaveText(PRIMER_WORDS.shown);

    const guide = player.locator(OB, { has: player.locator('h2', { hasText: 'How it works' }) });
    const drawer = guide.locator('[data-primer]');
    await expect(drawer).toBeVisible({ timeout: 20_000 });
    await drawer.locator('summary').tap();
    await expect(drawer).toHaveAttribute('open', '');
    await expect(drawer).toContainText(WORLD_PRIMER[0]!);
    await expect(drawer).toContainText(WORLD_PRIMER[WORLD_PRIMER.length - 1]!);
    await guide.locator('[data-ok]').tap();
    await expect(player.locator(OB)).toHaveCount(0);
  });

  await test.step('after reloading and rejoining the room, the player still sees the unlocked primer', async () => {
    await player.reload();
    await player.waitForFunction(() => window.hunterApp && document.querySelectorAll('#nav-top a').length > 0);
    await expect.poll(() => player.evaluate(() => hunterApp.api.sync.doc('rules')?.primer.on ?? false), { timeout: 20_000 }).toBe(true);
    await player.locator('#help-btn').tap();
    const guide = player.locator(OB, { has: player.locator('h2', { hasText: 'How it works' }) });
    await expect(guide.locator('[data-primer] summary')).toHaveText('Read aloud: World primer');
    await guide.locator('[data-ok]').tap();
  });

  await test.step('GM hides the primer from the GM tab and the player no longer sees it while the GM still does', async () => {
    await go(gm, 'gm');
    const gmBtn = gm.locator('#gm-room [data-gmprimer]');
    await expect(gmBtn).toHaveText(PRIMER_WORDS.hide);
    const box = await gmBtn.boundingBox();
    expect(box && box.height >= 44 && box.width >= 44).toBe(true);

    await gmBtn.tap();
    await expect(gmBtn).toHaveText(PRIMER_WORDS.show);
    await expect.poll(() => player.evaluate(() => hunterApp.api.sync.doc('rules')?.primer.on ?? true), { timeout: 20_000 }).toBe(false);

    await player.locator('#help-btn').tap();
    const pGuide = player.locator(OB, { has: player.locator('h2', { hasText: 'How it works' }) });
    await expect(pGuide.locator('[data-primer]')).toHaveCount(0);
    await pGuide.locator('[data-ok]').tap();

    await gm.locator('#help-btn').tap();
    const gGuide = gm.locator(OB, { has: gm.locator('h2', { hasText: 'How it works' }) });
    await expect(gGuide.locator('[data-primer] summary')).toHaveText('Read aloud: World primer');
    await gGuide.locator('[data-ok]').tap();
  });
});
