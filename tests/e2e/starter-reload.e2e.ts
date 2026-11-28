// A GM who finished first-time setup with Start blank can still load the starter campaign from Stories or the Room
// lobby, see The Empty Seat and Tidewall Cannery Gate, run Chapter 1 in a room, and get an "already loaded" notice
// rather than duplicates after leaving the room.
import type { Page } from '@playwright/test';
import {
  PHONE,
  ROOM_CODE,
  answerWindow,
  createRoom,
  dismissAll,
  expect,
  go,
  onboardPlayer,
  openApp,
  tapIfShown,
  test,
} from './helpers.ts';
import {
  PREGENS,
  STARTER_GATE,
  STARTER_REFUSAL_WORDS,
  STARTER_STORY_NAME,
  STARTER_WORDS,
} from '../../src/core/starter.ts';

async function onboardBlankGM(page: Page): Promise<void> {
  await openApp(page);
  for (const step of ['[data-yes]', '[data-gm]', '[data-blank]']) await tapIfShown(page, `.ob-overlay ${step}`);
  const ready = page.locator('.ob-overlay', { has: page.locator('h2', { hasText: 'Campaign ready' }) });
  await expect(ready).toBeVisible();
  await ready.locator('[data-oblater]').tap();
  await expect(page.locator('.ob-overlay')).toHaveCount(0);
  await dismissAll(page);
}

async function openGmSection(page: Page, id: string): Promise<void> {
  const tog = page.locator(`[data-tog="${id}"]`);
  if ((await tog.getAttribute('aria-expanded')) !== 'true') await tog.tap();
}

async function answerEachLocal(page: Page, title: string, count: number): Promise<void> {
  for (let i = 0; i < count; i++) await answerWindow(page, title);
}

test('blank GM loads starter campaign from Stories, starts Chapter 1 in a room, and after leaving sees the entry point report already loaded without duplicates', async ({ device }) => {
  const gm = (await device('gm-blank', { viewport: PHONE })).page;
  const player = (await device('player-blank', { viewport: PHONE })).page;
  const shotPath = process.env.STARTER_RELOAD_SHOT || '.lead-scratch/starter-reload-entry.png';

  await test.step('GM finishes setup with Start blank, opens Stories, and sees the Load starter campaign entry point', async () => {
    await onboardBlankGM(gm);
    await go(gm, 'gm');
    await openGmSection(gm, 'stories');

    const storiesBox = gm.locator('#gm-stories');
    const loadBtn = storiesBox.locator('[data-st-starter]');
    await expect(loadBtn).toBeVisible();
    await expect(loadBtn).toHaveText(STARTER_WORDS.button);
    await loadBtn.scrollIntoViewIfNeeded();
    await gm.waitForTimeout(150);
    await gm.screenshot({ path: shotPath, fullPage: false });
  });

  await test.step('loading from Stories adds The Empty Seat, Tidewall Cannery Gate, and the 4 sample hunters without wiping Hunter', async () => {
    await gm.locator('#gm-stories [data-st-starter]').tap();
    const dialog = gm.locator('.sys-overlay.show .sys-window', { hasText: STARTER_WORDS.title });
    await expect(dialog).toBeVisible();
    const toggle = dialog.getByRole('checkbox', { name: STARTER_WORDS.pregensLabel });
    await expect(toggle).toBeChecked();
    await expect(dialog).toContainText(STARTER_WORDS.pregensHelp);

    await dialog.locator('.sys-actions button.primary', { hasText: STARTER_WORDS.button }).tap();
    await expect(dialog).toHaveCount(0);
    await expect(gm.locator('#toasts .toast', { hasText: STARTER_STORY_NAME })).toBeVisible();

    await expect(gm.locator('#gm-stories [data-st-turnon]')).toBeVisible();
    await expect(gm.locator('#gm-stories')).toContainText('No story is running.');

    const state = await gm.evaluate(() => {
      const s = hunterApp.store.get();
      return {
        stories: s.library.stories.map((st: any) => st.name),
        gates: s.gates.map((g: any) => g.name),
        hunters: s.hunters.map((h: any) => h.name),
        runs: s.storyRuns.length,
      };
    });
    expect(state.stories).toEqual([STARTER_STORY_NAME]);
    expect(state.gates).toEqual([STARTER_GATE.name]);
    expect(state.hunters).toEqual(['Hunter', ...PREGENS.map(p => p.name)]);
    expect(state.runs).toBe(0);

    await go(gm, 'gates');
    await expect(gm.locator('#view-gates .gate .gt-name', { hasText: STARTER_GATE.name })).toBeVisible();
  });

  await test.step('GM creates a room, a player joins, and starting The Empty Seat delivers Chapter 1', async () => {
    const code = await createRoom(gm);
    expect(code).toMatch(ROOM_CODE);

    await onboardPlayer(player, 'Kira Sol', code);
    await dismissAll(player);
    await expect.poll(
      () => gm.evaluate(() => (hunterApp.api.sync.remoteSheets() as any[]).map(r => r.data.name)),
      { timeout: 20_000 },
    ).toEqual(['Kira Sol']);

    await go(gm, 'gm');
    await openGmSection(gm, 'stories');
    await gm.locator('#gm-stories [data-st-turnon]').tap();
    const storyWin = gm.locator('.st-ov [role=dialog]');
    await storyWin.locator('[data-st-story]', { hasText: STARTER_STORY_NAME }).tap();
    await expect(storyWin.locator('[data-st-for="table"]')).toHaveAttribute('aria-pressed', 'true');
    await storyWin.locator('[data-st-go]').tap();

    // 5 local hunters (Hunter + 4 sample hunters) receive Chapter 1 on the GM device, and Kira Sol receives it in the room.
    await answerEachLocal(gm, 'SEAT ASSIGNED', PREGENS.length + 1);
    await expect(gm.locator('#gm-stories .st-card .st-at')).toContainText('Chapter 1 of 5: Seat Assigned.');
    await expect(player.locator('.sys-overlay.show', { hasText: 'SEAT ASSIGNED' })).toBeVisible({ timeout: 20_000 });
    await answerWindow(player, 'SEAT ASSIGNED');
  });

  await test.step('after leaving the room, the GM still finds the entry point in Room lobby and Stories, and tapping it reports already loaded without duplicates', async () => {
    await go(gm, 'room');
    await gm.locator('#view-room [data-leave]').tap();
    // the starter control lives in the lobby, which stays hidden until leave finishes
    await expect(gm.locator('#view-room [data-lobby]')).toBeVisible();

    const lobbyBtn = gm.locator('#view-room [data-s="starter"] [data-roomstarter]');
    await expect(lobbyBtn).toBeVisible();
    await expect(lobbyBtn).toHaveText(STARTER_WORDS.button);
    await lobbyBtn.tap();
    const lobbyToast = gm.locator('#toasts .toast', { hasText: STARTER_REFUSAL_WORDS.already });
    await expect(lobbyToast).toBeVisible();
    await lobbyToast.locator('.t-x').tap();
    await expect(lobbyToast).toHaveCount(0);

    await go(gm, 'gm');
    await expect(gm.locator('#gm-room [data-gmstarter]')).toBeVisible();
    await openGmSection(gm, 'stories');
    const storiesBtn = gm.locator('#gm-stories [data-st-starter]');
    await expect(storiesBtn).toBeVisible();
    await storiesBtn.tap();
    await expect(gm.locator('#toasts .toast', { hasText: STARTER_REFUSAL_WORDS.already })).toBeVisible();

    const after = await gm.evaluate(() => {
      const s = hunterApp.store.get();
      return {
        stories: s.library.stories.map((st: any) => st.name),
        gates: s.gates.map((g: any) => g.name),
        hunters: s.hunters.map((h: any) => h.name),
      };
    });
    expect(after.stories).toEqual([STARTER_STORY_NAME]);
    expect(after.gates).toEqual([STARTER_GATE.name]);
    expect(after.hunters).toEqual(['Hunter', ...PREGENS.map(p => p.name)]);
  });
});
