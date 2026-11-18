import { test, expect, onboardGM, onboardPlayer, openApp, go, dismissAll, ROOM_CODE, type Device } from './helpers.ts';
import type { Page } from '@playwright/test';

const V = '#view-room ';
const roomOf = (page: Page) => page.evaluate(() => hunterApp.api.sync.room());
const text = async (page: Page, selector: string) => ((await page.locator(V + selector).first().textContent()) ?? '').replace(/\s/g, '');

async function openRoomView(page: Page): Promise<void> {
  await page.locator('#sync-pill button').first().tap();
  await expect(page).toHaveURL(/#\/room$/);
}

async function gmCreatesRoomInView(gm: Page): Promise<string> {
  await onboardGM(gm);
  await openRoomView(gm);
  await gm.locator(V + '[data-create]').tap();
  const shown = gm.locator(V + '[data-roomcode]');
  await expect(shown).toHaveText(ROOM_CODE);
  return ((await shown.textContent()) ?? '').trim();
}

async function playerJoinsInView(player: Page, code: string): Promise<void> {
  await openRoomView(player);
  await player.locator(V + '[data-code]').fill(code);
  await expect(player.locator(V + '[data-check]')).toContainText('Room found');
  await player.locator(V + '[data-join]').tap();
  await expect.poll(() => roomOf(player)).toBe(code);
}

test('a GM opens a room from the Room view and sees the code, the QR and link feedback', async ({ device }) => {
  const gm = (await device('gm', { blockServiceWorker: true })).page;
  const code = await gmCreatesRoomInView(gm);

  await test.step('the code is shown bare and the QR is on screen', async () => {
    expect(await gm.evaluate(() => document.querySelector('[data-roomcode]')?.textContent)).toBe(code);
    await expect(gm.locator(V + '[data-qr] svg')).toBeVisible();
  });

  await test.step('tapping the QR opens an enlarged copy that closes again', async () => {
    await gm.locator(V + '[data-qr]').tap();
    await expect(gm.locator('.sys-overlay .rm-sys-qr svg')).toBeVisible();
    await gm.locator('.sys-overlay.show button').first().tap();
    await expect(gm.locator('.sys-overlay.show')).toHaveCount(0);
  });

  await test.step('Copy link answers on the button itself', async () => {
    await gm.locator(V + '[data-copyinvite]').tap();
    await expect(gm.locator(V + '[data-copyinvite]')).toContainText(/Copied|Select and copy/);
  });
});

test('a player types a wrong code, fixes it, joins, and the GM sees them under Who is here', async ({ device }) => {
  const gm = (await device('gm', { blockServiceWorker: true })).page, player = (await device('player', { blockServiceWorker: true })).page;
  const code = await gmCreatesRoomInView(gm);
  await onboardPlayer(player, 'Kai Test');
  await openRoomView(player);
  const field = player.locator(V + '[data-code]');

  await test.step('a wrong code says there is no such room and Join stays usable', async () => {
    await field.fill('ZZZZZZ');
    await expect(player.locator(V + '[data-check]')).toContainText('There is no room ZZZZZZ.');
    await expect(player.locator(V + '[data-join]')).toBeEnabled();
  });

  await test.step('the corrected code in the same field finds the room', async () => {
    await field.fill(code);
    await expect(player.locator(V + '[data-check]')).toContainText('Room found');
    await expect(player.locator(V + '[data-hunter]')).toBeHidden();
  });

  await test.step('Join puts both phones in one room', async () => {
    await player.locator(V + '[data-join]').tap();
    await expect.poll(() => roomOf(player)).toBe(code);
    await expect(player.locator(V + '[data-roomcode]')).toBeVisible();
    await expect(player.locator(V + '[data-lobby]')).toBeHidden();
    await expect.poll(() => roomOf(gm)).toBe(code);
    await expect(gm.locator(V + '[data-roster]')).toContainText('Kai');
  });
});

test('pasting an invite link, a sentence or a dashed code leaves the bare code, and Enter joins', async ({ device }) => {
  const gm = (await device('gm', { blockServiceWorker: true })).page, player = (await device('player', { blockServiceWorker: true })).page;
  const code = await gmCreatesRoomInView(gm);
  await onboardPlayer(player, 'Paste Test');
  await openRoomView(player);
  const field = player.locator(V + '[data-code]');
  const origin = new URL(player.url()).origin;

  await test.step('pasted text is cleaned down to the code', async () => {
    await field.fill(`${origin}/?room=${code}`);
    await expect(field).toHaveValue(code);
    await field.fill(`join my room: ${code.toLowerCase()}`);
    await expect(field).toHaveValue(code);
    await field.fill(`${code.slice(0, 3)}-${code.slice(3)}`);
    await expect(field).toHaveValue(code);
  });

  await test.step('typing upper-cases and other text is left alone', async () => {
    await field.fill('ab');
    await expect(field).toHaveValue('AB');
    await field.fill('hello world, nothing here');
    await expect(field).toHaveValue('HELLO WORLD, NOTHING HERE');
  });

  await test.step('Enter in the field joins the room', async () => {
    await field.fill(code);
    await expect(player.locator(V + '[data-check]')).toContainText('Room found');
    await field.press('Enter');
    await expect.poll(() => roomOf(player)).toBe(code);
  });
});

test('a GM removes a player from the room, the player is told, and Allow back clears the removal', async ({ device }) => {
  const gm = (await device('gm', { blockServiceWorker: true })).page, player = (await device('player', { blockServiceWorker: true })).page;
  const code = await gmCreatesRoomInView(gm);
  await onboardPlayer(player, 'Kai Test');
  await playerJoinsInView(player, code);
  await expect(gm.locator(V + '[data-roster]')).toContainText('Kai');

  await test.step('Manage reveals Remove and Release', async () => {
    await gm.locator(V + '[data-manage]').first().tap();
    await expect(gm.locator(V + '[data-gmkick]').first()).toBeVisible();
    await expect(gm.locator(V + '[data-gmrelease]').first()).toBeVisible();
  });

  await test.step('Remove and confirm shows the player a removed window', async () => {
    await gm.locator(V + '[data-gmkick]').first().tap();
    await gm.locator('.sys-overlay.show .primary').tap();
    await expect(player.locator('.sys-overlay.show', { hasText: /REMOVED FROM ROOM/ })).toBeVisible();
    await dismissAll(player, 4);
  });

  await test.step('Recently removed lists them and Allow back clears the line', async () => {
    await expect(gm.locator(V + '[data-gmallow]').first()).toBeVisible();
    await gm.locator(V + '[data-gmallow]').first().tap();
    await expect(gm.locator(V + '[data-gmallow]')).toHaveCount(0);
  });
});

test('a device with several hunters picks who to play as and joins as a player', async ({ device }) => {
  const gm = (await device('gm', { blockServiceWorker: true })).page, multi = (await device('multi', { blockServiceWorker: true })).page;
  const code = await gmCreatesRoomInView(gm);
  await onboardGM(multi);
  await multi.evaluate(() => hunterApp.store.update((d: any) => { d.hunters.push(hunterApp.store.newHunter('Second One')); }, 'test'));
  const secondId = await multi.evaluate(() => hunterApp.store.get().hunters.find((h: any) => h.name === 'Second One').id);
  await openRoomView(multi);
  await multi.locator(V + '[data-code]').fill(code);
  await expect(multi.locator(V + '[data-check]')).toContainText('Room found');
  await expect(multi.locator(V + '[data-hunter]')).toBeVisible();
  await multi.locator(V + '[data-hunter]').selectOption(secondId);
  await multi.locator(V + '[data-join]').tap();
  await expect.poll(() => roomOf(multi)).toBe(code);
  await expect(multi.locator(V + '[data-hunter]')).toBeVisible();
  await expect(multi.locator(V + '[data-roomcode]')).toBeVisible();
  await expect(gm.locator(V + '[data-roster]')).toContainText('Second One');
  await go(multi, 'status');
  await expect(multi.locator('#view-status')).toContainText('Second One');
});

test('an invite link shows an invite card that joins in one tap and does not come back', async ({ device }) => {
  const gm = (await device('gm', { blockServiceWorker: true })).page, player = (await device('player', { blockServiceWorker: true })).page;
  const code = await gmCreatesRoomInView(gm);
  await onboardPlayer(player, 'Link Test');

  await test.step('the link lands on the Room view with the code on an invite card', async () => {
    await openApp(player, `/?room=${code}`);
    await expect(player).toHaveURL(/#\/room$/);
    await expect(player.locator(V + '[data-invite]')).toBeVisible();
    expect(await text(player, '[data-invcode]')).toBe(code);
  });

  await test.step('one tap joins and the card goes away', async () => {
    await player.locator(V + '[data-joininvite]').tap();
    await expect.poll(() => roomOf(player)).toBe(code);
    await expect(player.locator(V + '[data-invite]')).toBeHidden();
  });

  await test.step('the same link again shows no card for a room already joined, and says so once', async () => {
    await openApp(player, `/?room=${code}`);
    await expect.poll(() => roomOf(player)).toBe(code);
    await expect(player.locator(V + '[data-invite]')).toBeHidden();
    const already = player.locator('#toasts .toast', { hasText: `You are already in room ${code}` });
    await expect(already).toHaveCount(1);
    await go(player, 'status');
    await go(player, 'room');
    await expect(already, 'drawing the Room view again says nothing more').toHaveCount(1);
  });

  await test.step('Not this room drops a card for a missing room', async () => {
    await player.evaluate(() => { hunterApp.api.sync.leave(); });
    await openApp(player, '/?room=ABC234');
    await expect(player.locator(V + '[data-invite]')).toBeVisible();
    await expect(player.locator(V + '[data-invcheck]')).toContainText('There is no room ABC234.');
    await player.locator(V + '[data-notthis]').tap();
    await expect(player.locator(V + '[data-invite]')).toBeHidden();
  });

  await test.step('the room button at the top is the way into the Room view, from the Data page too', async () => {
    await go(player, 'data');
    await player.locator('#sync-pill [data-roompill]').tap();
    await expect(player).toHaveURL(/#\/room$/);
  });
});

test('a join under way from another window keeps the Room view from starting a second one until it ends', async ({ device }) => {
  // The player's page has no service worker: once one controls the page it fetches /api itself, and page.route below
  // would not hold the join (a race on how soon the worker claims the page).
  const gm = (await device('gm')).page, player = (await device('player', { blockServiceWorker: true })).page;
  const code = await gmCreatesRoomInView(gm);
  await onboardPlayer(player, 'Wait Test');
  await openRoomView(player);
  await player.locator(V + '[data-code]').fill(code);
  await expect(player.locator(V + '[data-check]')).toContainText('Room found');
  await expect(player.locator(V + '[data-join]')).toBeEnabled();
  let release = (): void => {};
  const held = new Promise<void>(r => { release = r; });
  const toRoom = (u: URL) => u.pathname === `/api/rooms/${code}`;
  await player.route(toRoom, async route => { await held; await route.continue(); });

  await test.step('while a join started elsewhere waits on the server, Join and Create are disabled and Join shows it is busy', async () => {
    await player.evaluate(c => { hunterApp.api.sync.joinRoom(c).catch(() => {}); }, code);
    await expect(player.locator(V + '[data-join]')).toBeDisabled();
    await expect(player.locator(V + '[data-join]')).toHaveAttribute('aria-busy', 'true');
    await expect(player.locator(V + '[data-create]')).toBeDisabled();
  });

  await test.step('when the server answers, the join lands and the room card shows', async () => {
    release();
    await expect.poll(() => roomOf(player)).toBe(code);
    await player.unroute(toRoom);
    await expect.poll(() => text(player, '[data-roomcode]')).toBe(code);
  });
});

test('leaving and rejoining the last room works for a player and a GM, and a dropped link recovers', async ({ device }) => {
  const gm = (await device('gm', { blockServiceWorker: true })).page;
  const playerDevice: Device = await device('player', { blockServiceWorker: true, allowConsole: [/ERR_INTERNET_DISCONNECTED|Failed to fetch|net::ERR|404/] });
  const player = playerDevice.page;
  const code = await gmCreatesRoomInView(gm);
  await onboardPlayer(player, 'Link Test');
  await playerJoinsInView(player, code);

  await test.step('a player leaves with one tap and no window, then Rejoin last brings them back', async () => {
    await player.locator(V + '[data-leave]').tap();
    await expect.poll(() => roomOf(player)).toBeNull();
    await expect(player.locator('.sys-overlay.show')).toHaveCount(0);
    await expect(player.locator(V + '[data-rejoinlast]')).toBeVisible();
    await player.locator(V + '[data-rejoinlast]').tap();
    await expect.poll(() => roomOf(player)).toBe(code);
  });

  await test.step('a GM leaves, Rejoin last says as GM, and they are the GM of the same room again', async () => {
    await gm.locator(V + '[data-leave]').tap();
    await expect(gm.locator(V + '[data-rejoinlast]')).toContainText('as GM');
    await gm.locator(V + '[data-rejoinlast]').tap();
    await expect.poll(() => roomOf(gm)).toBe(code);
    await expect(gm.locator(V + '[data-roster]')).toBeVisible();
    await expect(gm.locator(V + '[data-qr]')).toBeVisible();
  });

  await test.step('going offline shows Reconnecting with Try now, and coming back shows Live', async () => {
    await playerDevice.ctx.setOffline(true);
    await expect(player.locator(V + '[data-conntext]')).toContainText('Reconnecting');
    await expect(player.locator(V + '[data-retry]')).toBeVisible();
    await playerDevice.ctx.setOffline(false);
    await expect(player.locator(V + '[data-conntext]')).toContainText(/^\s*Live/);
    await expect(player.locator(V + '[data-retry]')).toBeHidden();
  });

  await test.step('a room the server no longer knows shows a gone notice that Dismiss clears', async () => {
    let hit = 0;
    const poll = new RegExp(`/api/rooms/${code}\\?after`);
    await player.route(poll, route => { if (!hit++) route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"no such room"}' }); else route.continue(); });
    await expect(player.locator(V + '[data-forgetlast]')).toBeVisible();
    await expect(player.locator(V + '[data-lastgone]')).toContainText(/no longer exists/);
    await player.locator(V + '[data-forgetlast]').tap();
    await expect(player.locator(V + '[data-forgetlast]')).toBeHidden();
    await player.unroute(poll);
  });
});

test('the GM tab room strip makes one room on a double tap and drops a room the server lost', async ({ device }) => {
  const gmDevice = await device('gm', { blockServiceWorker: true, allowConsole: [/404/] });
  const gm = gmDevice.page;
  await onboardGM(gm);
  let posts = 0;
  gm.on('request', r => { if (r.method() === 'POST' && /\/api\/rooms$/.test(r.url())) posts++; });

  await test.step('two quick taps on Create room make one room', async () => {
    await gm.route(/\/api\/rooms$/, async route => {
      if (route.request().method() === 'POST') await new Promise(r => setTimeout(r, 800));
      await route.continue().catch(() => {});
    });
    await go(gm, 'gm');
    const create = gm.locator('#gm-room [data-gmcreate]');
    await expect(create).toBeVisible();
    await create.tap();
    await gm.evaluate(() => (document.querySelector('#gm-room [data-gmcreate]') as HTMLElement | null)?.click());
    await expect(gm.locator('#gm-room [data-gmroomcode]')).toHaveText(ROOM_CODE);
    await gm.unroute(/\/api\/rooms$/);
    expect(posts).toBe(1);
  });

  await test.step('a remembered room that the server lost is offered once, then Create room comes back', async () => {
    await gm.evaluate(() => hunterApp.api.sync.leave());
    await gm.evaluate(() => hunterApp.store.update((d: any) => { d.settings.sync.gmKeys = { ZZZZ22: 'nokey' }; d.settings.sync.lastRoom = null; }, 'test'));
    await go(gm, 'status');
    await go(gm, 'gm');
    const rejoin = gm.locator('#gm-room [data-gmrejoin="ZZZZ22"]');
    await expect(rejoin).toBeVisible();
    await rejoin.tap();
    await expect(rejoin).toHaveCount(0);
    await expect(gm.locator('#gm-room [data-gmcreate]')).toHaveCount(1);
  });

  await test.step('after a reload the lost room is still not offered: its key left the ring with it', async () => {
    expect(await gm.evaluate(() => hunterApp.store.get().settings.sync.gmKeys)).toEqual({});
    await openApp(gm);
    await dismissAll(gm);
    await go(gm, 'gm');
    await expect(gm.locator('#gm-room [data-gmcreate]')).toHaveCount(1);
    await expect(gm.locator('#gm-room [data-gmrejoin]')).toHaveCount(0);
  });
});

test('a GM who leaves the room in one tab sees the second tab of the same browser leave it too', async ({ device }) => {
  const first = await device('gm');
  const code = await gmCreatesRoomInView(first.page);
  const second = await first.ctx.newPage();
  await openApp(second);
  await expect.poll(() => roomOf(second)).toBe(code);
  await first.page.locator(V + '[data-leave]').tap();
  await expect.poll(() => roomOf(first.page)).toBeNull();
  await expect.poll(() => roomOf(second)).toBeNull();
  await expect.poll(() => second.evaluate(() => hunterApp.store.get().settings.sync.room)).toBeNull();
});
