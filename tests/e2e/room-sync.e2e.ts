import { test, expect, onboardGM, onboardPlayer, createRoom, dismissAll, editIdentity, go, activeHunter, answerWindow, chooseList, roomHeaders, startGoblinDenFight, type Page } from './helpers.ts';

/** The day of room `code`'s world doc, as the server holds it. */
const worldDay = async (page: Page, code: string): Promise<number | null> =>
  (await (await page.request.get(`/api/rooms/${code}?after=0`, { headers: await roomHeaders(page) })).json()).docs?.world?.data?.day ?? null;
/** The GM's request to put a doc or send a message is held until `release`, then let through; one the page dropped meanwhile stays dropped. */
function held() {
  let release!: () => void, out = 0;
  const gate = new Promise<void>(r => { release = r; });
  return {
    release: () => release(),
    get out(): number { return out; },
    async handle(route: import('@playwright/test').Route): Promise<void> {
      out++;
      await gate;
      await route.continue().catch(() => undefined); // the page dropped it when it left the room: nothing to let through
    },
  };
}

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

test('a player who left the room and came back gets the award the GM sent meanwhile, once, told in one window', async ({ device }) => {
  const gm = (await device('gm')).page, player = (await device('player')).page;
  await onboardGM(gm);
  const code = await createRoom(gm);
  await onboardPlayer(player, 'Kai Test', code);
  await expect.poll(() => player.evaluate(() => hunterApp.api.sync.room())).toBe(code);
  await dismissAll(player, 4);
  await go(gm, 'gm');
  await expect(gm.locator('#gm-board .gm-card.remote', { hasText: 'Kai Test' })).toHaveCount(1);
  const before = await activeHunter(player);

  await test.step('the player leaves the room', async () => {
    await go(player, 'room');
    await player.locator('#view-room [data-leave]').tap();
    await expect.poll(() => player.evaluate(() => hunterApp.api.sync.room())).toBeNull();
  });

  await test.step('the GM awards Kai 30 XP and 12 gold, and the room takes it', async () => {
    const toggle = gm.locator('[data-tog="award"]');
    if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.tap();
    await gm.locator('#gm-targets label', { hasText: 'Kai Test' }).locator('input').check();
    await gm.fill('#gm-xp', '30');
    await gm.fill('#gm-gold', '12');
    await gm.locator('#gm-award-go').tap();
    await expect.poll(() => gm.evaluate(() => hunterApp.api.sync.detail().waiting)).toBe(0);
    expect((await activeHunter(player)).gold, 'nothing reaches a phone out of the room').toBe(before.gold);
  });

  await test.step('the player joins again with one tap and is given the award, told in the window of what was sent meanwhile', async () => {
    await player.locator('#view-room [data-rejoinlast]').tap();
    await expect.poll(() => player.evaluate(() => hunterApp.api.sync.room())).toBe(code);
    await expect.poll(async () => (await activeHunter(player)).xp).toBe(before.xp + 30);
    expect((await activeHunter(player)).gold).toBe(before.gold + 12);
    const away = player.locator('.sys-overlay.show', { hasText: 'WHILE YOU WERE AWAY' });
    await expect(away).toContainText('These were sent while this phone was out of the room.');
    await expect(away).toContainText('Reward: REWARD RECEIVED. +30 XP. +12 gold');
    await expect(player.locator('.sys-overlay.show', { hasText: 'The System has delivered a reward.' }), 'no window of its own beside it').toHaveCount(0);
    await dismissAll(player, 4);
  });

  await test.step('a reload, and leaving and joining once more, give it no second time', async () => {
    await player.reload({ waitUntil: 'networkidle' });
    await player.waitForFunction(() => window.hunterApp && document.querySelectorAll('#nav-top a').length > 0);
    await expect.poll(() => player.evaluate(() => hunterApp.api.sync.conn())).toBe('live');
    await go(player, 'room');
    await player.locator('#view-room [data-leave]').tap();
    await expect.poll(() => player.evaluate(() => hunterApp.api.sync.room())).toBeNull();
    await player.locator('#view-room [data-rejoinlast]').tap();
    await expect.poll(() => player.evaluate(() => hunterApp.api.sync.conn())).toBe('live');
    // the GM's damage lands after the rejoin's page: once it shows, every earlier message has been read
    const hpBefore = (await activeHunter(player)).hp;
    await gm.locator('#gm-board .gm-card.remote', { hasText: 'Kai Test' }).locator('[data-hp="-5"]').tap();
    await expect.poll(async () => (await activeHunter(player)).hp).toBe(hpBefore - 5);
    const after = await activeHunter(player);
    expect({ xp: after.xp, gold: after.gold }).toEqual({ xp: before.xp + 30, gold: before.gold + 12 });
    await expect(player.locator('.sys-overlay.show', { hasText: 'WHILE YOU WERE AWAY' })).toHaveCount(0);
  });
});

test('a GM who leaves a room while it is slow to take the world doc has it put in the next room at once', async ({ device }) => {
  const gm = (await device('gm', { blockServiceWorker: true })).page;
  await onboardGM(gm);
  const roomA = await createRoom(gm);
  await expect.poll(() => worldDay(gm, roomA)).toBe(1);
  const slow = held();
  await gm.route(`**/api/rooms/${roomA}/sheets/_world`, route => (route.request().method() === 'PUT' ? slow.handle(route) : route.continue()));

  await test.step('the GM advances the day, and room A is slow to take the world doc of day 2', async () => {
    await go(gm, 'gm');
    await gm.locator('[data-tog="gate"]').tap();
    await gm.locator('#gm-d1').tap();
    await expect(gm.locator('#gm-day')).toHaveText('Day 2');
    await expect.poll(() => slow.out).toBe(1);
  });

  const roomB = await test.step('the GM leaves room A and opens a new room', async () => {
    await go(gm, 'room');
    await gm.locator('#view-room [data-leave]').tap();
    await expect.poll(() => gm.evaluate(() => hunterApp.api.sync.room())).toBeNull();
    return createRoom(gm);
  });

  await test.step('the new room has day 2 well before room A\'s put would have given up (20 s)', async () => {
    await expect.poll(() => worldDay(gm, roomB), { timeout: 10_000 }).toBe(2);
    slow.release();
    await expect.poll(() => gm.evaluate(() => hunterApp.api.sync.conn())).toBe('live');
  });
});

test('a fight the room refused as too big, once cleared, leaves the pill saying live', async ({ device }) => {
  const gm = (await device('gm', { blockServiceWorker: true, allowConsole: [/status of 413/] })).page;
  await onboardGM(gm);
  await chooseList(gm);
  const code = await createRoom(gm);
  const pill = gm.locator('#sync-pill [data-roompill]');
  await gm.route(`**/api/rooms/${code}/sheets/_fight`, route => (route.request().method() === 'PUT'
    ? route.fulfill({ status: 413, contentType: 'application/json', body: '{"error":"too large"}' }) : route.continue()));

  await test.step('the GM starts a fight, and the room refuses its doc as too big', async () => {
    await startGoblinDenFight(gm);
    await expect(pill).toHaveAttribute('data-conn', 'tooBig');
  });

  await test.step('the GM clears the fight: there is nothing too big to share, and the pill says live', async () => {
    await gm.locator('#view-combat').getByRole('button', { name: 'Clear the fight' }).tap();
    await answerWindow(gm, 'Clear the fight?', 'Clear');
    await expect(pill).toHaveAttribute('data-conn', 'live');
  });
});

test('an award on its way when the GM leaves the room waits for that room, says nothing meanwhile, and lands once when the GM is back', async ({ device }) => {
  const gm = (await device('gm', { blockServiceWorker: true })).page, player = (await device('player')).page;
  await onboardGM(gm);
  const code = await createRoom(gm);
  await onboardPlayer(player, 'Kai Test', code);
  await expect.poll(() => player.evaluate(() => hunterApp.api.sync.room())).toBe(code);
  await dismissAll(player, 4);
  await go(gm, 'gm');
  await expect(gm.locator('#gm-board .gm-card.remote', { hasText: 'Kai Test' })).toHaveCount(1);
  const before = await activeHunter(player);
  const slow = held();
  await gm.route(`**/api/rooms/${code}/events`, route => (route.request().method() === 'POST' ? slow.handle(route) : route.continue()));
  await gm.evaluate(() => { (window as any).heard = []; hunterApp.on('sync:outbox', (o: unknown) => (window as any).heard.push(o)); });
  const box = (): Promise<{ room: string; at: string }[]> => gm.evaluate(() => hunterApp.store.get().settings.sync.outbox.map((e: any) => ({ room: e.room, at: e.at })));

  await test.step('the GM awards Kai 30 XP, and the room is slow to take it', async () => {
    const toggle = gm.locator('[data-tog="award"]');
    if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.tap();
    await gm.locator('#gm-targets label', { hasText: 'Kai Test' }).locator('input').check();
    await gm.fill('#gm-xp', '30');
    await gm.locator('#gm-award-go').tap();
    await expect.poll(() => slow.out).toBe(1);
    expect(await box()).toEqual([{ room: code, at: 'sending' }]);
  });

  await test.step('the GM leaves the room: the award waits again for that room, and nothing is told of it out of the room', async () => {
    await go(gm, 'room');
    await gm.locator('#view-room [data-leave]').tap();
    await expect.poll(() => gm.evaluate(() => hunterApp.api.sync.room())).toBeNull();
    expect(await box()).toEqual([{ room: code, at: 'queued' }]);
    slow.release();
    await expect.poll(() => gm.evaluate(() => hunterApp.api.sync.conn())).toBe('ready');
    expect(await gm.evaluate(() => (window as any).heard)).toEqual([]);
    expect((await activeHunter(player)).xp).toBe(before.xp);
  });

  await test.step('the GM opens the room again: the award goes, and Kai gets 30 XP once', async () => {
    await gm.unroute(`**/api/rooms/${code}/events`);
    await go(gm, 'gm');
    await gm.locator(`#gm-room [data-gmrejoin="${code}"]`).tap();
    await expect.poll(box).toEqual([]);
    await expect.poll(async () => (await activeHunter(player)).xp).toBe(before.xp + 30);
    expect(await gm.evaluate(() => (window as any).heard.map((o: { at: string }) => o.at))).toEqual(['sent']);
  });
});
