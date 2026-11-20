import { writeFile } from 'node:fs/promises';
import { test, expect, onboardGM, onboardPlayer, openApp, createRoom, dismissAll, answerWindow, go, activeHunter, chooseList, gmRoomHeaders, roomHeaders, type Page } from './helpers.ts';

const roomView = '#view-room';
const removedWindow = (page: Page) => page.locator('.sys-overlay.show', { hasText: 'REMOVED FROM ROOM' });
const kaiCard = (gm: Page) => gm.locator('#gm-board .gm-card.remote', { hasText: 'Kai Test' });
/** The names in the GM's fight, being built or running, as the save holds it. */
const inFight = (gm: Page): Promise<string[]> => gm.evaluate(() => (hunterApp.store.get().fight?.rows ?? []).map((r: any) => r.name as string));
const sheetsInRoom = async (page: Page, code: string) => Object.keys(((await (await page.request.get(`/api/rooms/${code}?after=0`, { headers: await roomHeaders(page) })).json()).sheets) ?? {});

async function gmWithRoom(device: (label: string, options?: any) => Promise<any>, options: any = {}) {
  const gm = (await device('gm', options)).page as Page;
  await onboardGM(gm);
  const code = await createRoom(gm);
  return { gm, code };
}

async function playerInRoom(device: (label: string, options?: any) => Promise<any>, code: string, options: any = {}) {
  const player = (await device('player', options)).page as Page;
  await onboardPlayer(player, 'Kai Test', code);
  await expect.poll(() => player.evaluate(() => hunterApp.api.sync.room())).toBe(code);
  await dismissAll(player, 4);
  return player;
}

async function gmKey(gm: Page): Promise<string> {
  await go(gm, 'room');
  return gm.locator(`${roomView} [data-gmkey]`).inputValue();
}

test('a player the GM removed is told so, keeps the hunter, and can only return after the GM allows it', async ({ device }) => {
  const { gm, code } = await gmWithRoom(device);
  const player = await playerInRoom(device, code);

  await test.step('the GM sees the player and removes them from the Room view', async () => {
    await go(gm, 'room');
    await expect(gm.locator(`${roomView} [data-roster]`)).toContainText('Kai Test');
    await gm.locator(`${roomView} [data-manage]`).tap();
    await gm.locator(`${roomView} [data-gmkick]`).tap();
    await gm.locator('.sys-overlay.show button', { hasText: 'Remove from room' }).tap();
    await expect(gm.locator(`${roomView} [data-kicks]`)).toContainText('Kai Test');
    await expect(gm.locator(`${roomView} [data-roster]`)).not.toContainText('Kai Test');
  });

  await test.step('the player is told, is out of the room and still has the hunter', async () => {
    await expect(removedWindow(player)).toBeVisible();
    await expect(removedWindow(player)).toContainText(`from room ${code}`);
    await expect.poll(() => player.evaluate(() => hunterApp.api.sync.room())).toBeNull();
    expect((await activeHunter(player)).name).toBe('Kai Test');
  });

  await test.step('asking to rejoin before the GM allows it is refused', async () => {
    await removedWindow(player).locator('button', { hasText: 'Rejoin when the GM allows' }).tap();
    await expect(player.locator('#toasts .toast', { hasText: 'Not allowed back yet' })).toBeVisible();
    await expect(removedWindow(player)).toBeVisible();
    expect(await player.evaluate(() => hunterApp.api.sync.room())).toBeNull();
  });

  await test.step('after Allow back the player rejoins and the GM card returns', async () => {
    await gm.locator(`${roomView} [data-gmallow]`).tap();
    await removedWindow(player).locator('button', { hasText: 'Rejoin when the GM allows' }).tap();
    await expect.poll(() => player.evaluate(() => hunterApp.api.sync.room())).toBe(code);
    await expect(player.locator('#toasts .toast', { hasText: `Rejoined room ${code}` })).toBeVisible();
    await go(gm, 'gm');
    await expect(kaiCard(gm)).toHaveCount(1);
  });
});

test('a removal the server does not take leaves the player in the fight as in the room, and the next one that it takes removes both', async ({ device }) => {
  const { gm, code } = await gmWithRoom(device, { blockServiceWorker: true, allowConsole: [/ERR_FAILED/] });
  await playerInRoom(device, code);
  await go(gm, 'gm');
  await expect(kaiCard(gm)).toHaveCount(1);
  await chooseList(gm);
  await go(gm, 'combat');
  await gm.locator('#view-combat [data-hsel]').selectOption({ label: 'Kai Test (remote)' });
  await gm.locator('#view-combat [data-addh]').tap();
  await expect.poll(() => inFight(gm)).toContain('Kai Test');
  const removal = (u: URL) => u.pathname.startsWith(`/api/rooms/${code}/sheets/`);
  const remove = async () => {
    await go(gm, 'room');
    await gm.locator(`${roomView} [data-manage]`).tap();
    await gm.locator(`${roomView} [data-gmkick]`).tap();
    await gm.locator('.sys-overlay.show button', { hasText: 'Remove from room' }).tap();
  };

  await test.step('offline, Remove says it could not, and Kai is still in the fight and on the roster', async () => {
    await gm.route(removal, route => (route.request().method() === 'DELETE' ? route.abort() : route.continue()));
    await remove();
    await expect(gm.locator('#toasts .toast', { hasText: 'Could not remove Kai Test' })).toBeVisible();
    expect(await inFight(gm), 'the fight keeps the hunter the room kept').toContain('Kai Test');
    await expect(gm.locator(`${roomView} [data-roster]`)).toContainText('Kai Test');
    await gm.unroute(removal);
  });

  await test.step('online, Remove takes Kai out of the room and the fight', async () => {
    await dismissAll(gm, 2);
    await remove();
    await expect(gm.locator('#toasts .toast', { hasText: 'Removed Kai Test from the room and the fight' })).toBeVisible();
    expect(await inFight(gm)).not.toContain('Kai Test');
    await expect(gm.locator(`${roomView} [data-kicks]`)).toContainText('Kai Test');
  });
});

test('a room that no longer exists is reported as gone and is never joined', async ({ device }) => {
  const gm = (await device('gm')).page;
  const player = (await device('player')).page;
  await onboardGM(gm);
  await onboardPlayer(player, 'Kai Test');

  await test.step('a player typing a code nobody has is told there is no such room', async () => {
    await go(player, 'room');
    await player.locator(`${roomView} input[data-code]`).fill('ZZZZ22');
    await expect(player.locator(`${roomView} [data-check]`)).toContainText('There is no room ZZZZ22.');
    await player.locator(`${roomView} [data-join]`).tap();
    // the one sentence a failed join says on every screen (src/core/sync/taps.ts, V4)
    await expect(player.locator(`${roomView} [data-err]`)).toContainText('There is no room ZZZZ22.');
    expect(await player.evaluate(() => hunterApp.api.sync.room())).toBeNull();
  });

  await test.step('a GM rejoining with a saved key is told the room is gone', async () => {
    await go(gm, 'room');
    await gm.locator(`${roomView} [data-s="key"] summary`).tap();
    await gm.locator(`${roomView} [data-rcode]`).fill('ZZZZ22');
    await gm.locator(`${roomView} [data-rkey]`).fill('nokeynokeynokey');
    await gm.locator(`${roomView} [data-rejoingm]`).tap();
    await expect(gm.locator(`${roomView} [data-kerr]`)).toContainText('There is no room ZZZZ22.');
    expect(await gm.evaluate(() => hunterApp.api.sync.room())).toBeNull();
  });

  await test.step('the last-room card says a room that vanished is gone', async () => {
    await gm.evaluate(() => hunterApp.store.update((d: any) => {
      d.settings.sync.gmKeys = { ZZZZ22: 'nokeynokeynokey' };
      d.settings.sync.lastRoom = { code: 'ZZZZ22', why: 'left' };
    }, 'test-setup'));
    await openApp(gm);
    await dismissAll(gm, 4);
    await go(gm, 'gm');
    await gm.locator('[data-gmrejoin="ZZZZ22"]').tap();
    await expect(gm.locator('#gm-board-msg')).toContainText('There is no room ZZZZ22.');
    await go(gm, 'room');
    await expect(gm.locator(`${roomView} [data-lastgone]`)).toContainText('Room ZZZZ22 no longer exists');
  });
});

test('a GM who left the room reopens it with the saved key or a typed key, and a wrong key is refused', async ({ device }) => {
  const { gm, code } = await gmWithRoom(device);
  const player = await playerInRoom(device, code);
  const key = await gmKey(gm);
  expect(key.length).toBeGreaterThan(8);

  await test.step('the GM leaves and the lobby offers the room back', async () => {
    await gm.locator(`${roomView} [data-leave]`).tap();
    await expect(gm.locator(`${roomView} [data-lobby]`)).toBeVisible();
    await expect(gm.locator(`${roomView} [data-rejoinlast]`)).toHaveText(`Rejoin ${code} as GM`);
  });

  await test.step('a wrong typed key is refused and the GM stays out', async () => {
    await gm.locator(`${roomView} [data-s="key"] summary`).tap();
    await gm.locator(`${roomView} [data-rcode]`).fill(code);
    await gm.locator(`${roomView} [data-rkey]`).fill('wrongkeywrongkey');
    await gm.locator(`${roomView} [data-rejoingm]`).tap();
    await expect(gm.locator(`${roomView} [data-kerr]`)).toContainText('That GM key does not match this room');
    expect(await gm.evaluate(() => hunterApp.api.sync.room())).toBeNull();
  });

  await test.step('the typed right key reopens the room as GM with the player on the board', async () => {
    await gm.locator(`${roomView} [data-rkey]`).fill(key);
    await gm.locator(`${roomView} [data-rejoingm]`).tap();
    await expect(gm.locator(`${roomView} [data-roomcode]`)).toHaveText(code);
    await expect(gm.locator(`${roomView} [data-who]`)).toBeVisible();
    await go(gm, 'gm');
    await expect(kaiCard(gm)).toHaveCount(1);
  });

  await test.step('after leaving again, the Rejoin button reopens it and GM changes still reach the player', async () => {
    await go(gm, 'room');
    await gm.locator(`${roomView} [data-leave]`).tap();
    await gm.locator(`${roomView} [data-rejoinlast]`).tap();
    await expect(gm.locator(`${roomView} [data-who]`)).toBeVisible();
    await go(gm, 'gm');
    await expect(kaiCard(gm)).toHaveCount(1);
    const before = await activeHunter(player);
    await kaiCard(gm).locator('[data-hp="-5"]').tap();
    await expect.poll(async () => (await activeHunter(player)).hp).toBe(before.hp - 5);
  });
});

test('a GM whose key request fails does not turn into a player of their own room', async ({ device }) => {
  const { gm, code } = await gmWithRoom(device, { blockServiceWorker: true, allowConsole: [/status of 502|ERR_FAILED/] });
  const key = await gmKey(gm);
  await gm.locator(`${roomView} [data-leave]`).tap();
  await expect(gm.locator(`${roomView} [data-lobby]`)).toBeVisible();

  await test.step('the join with the room code fails while the key request gets a 502', async () => {
    await gm.route(u => u.pathname.startsWith(`/api/rooms/${code}`), route => {
      const req = route.request();
      if (req.method() === 'GET' && req.headers()['x-gm-key']) return route.fulfill({ status: 502, contentType: 'text/plain', body: 'bad gateway' });
      return route.continue();
    });
    await gm.locator(`${roomView} input[data-code]`).fill(code);
    await expect(gm.locator(`${roomView} [data-check]`)).toContainText('You are GM of this room');
    await gm.locator(`${roomView} [data-join]`).tap();
    await expect(gm.locator(`${roomView} [data-err]`)).toContainText('Could not reach the server');
  });

  await test.step('the device is still a GM outside the room, still has the key and put no sheet in the room', async () => {
    await gm.waitForTimeout(1500);
    expect(await gm.evaluate(() => hunterApp.api.sync.room())).toBeNull();
    expect(await gm.evaluate(() => hunterApp.store.get().settings.mode)).toBe('gm');
    await expect(gm.locator(`${roomView} [data-lobby]`)).toBeVisible();
    expect(await sheetsInRoom(gm, code)).toEqual([]);
  });

  await test.step('once the server answers, joining reopens the room as GM', async () => {
    await gm.unrouteAll({ behavior: 'ignoreErrors' });
    await gm.locator(`${roomView} [data-join]`).tap();
    await expect(gm.locator(`${roomView} [data-who]`)).toBeVisible();
    expect(await gmKey(gm)).toBe(key);
  });
});

test('a GM key the server refuses ends the join with a message and does not join as a player', async ({ device }) => {
  const { gm, code } = await gmWithRoom(device);
  const player = (await device('player')).page;
  await onboardPlayer(player, 'Kai Test');
  await player.evaluate(c => hunterApp.store.update((d: any) => { d.settings.sync.gmKeys = { [c]: 'wrongkeywrongkey' }; }, 'test-setup'), code);

  await go(player, 'room');
  await player.locator(`${roomView} input[data-code]`).fill(code);
  await player.locator(`${roomView} [data-join]`).tap();
  await expect(player.locator(`${roomView} [data-err]`)).toContainText(`The GM key for ${code} is no longer valid.`);
  await expect(player.locator(`${roomView} [data-lobby]`)).toBeVisible();
  expect(await player.evaluate(() => hunterApp.api.sync.room())).toBeNull();
  expect(await player.evaluate(() => hunterApp.store.get().settings.sync.gmKeys)).toEqual({});
  expect(await player.evaluate(() => hunterApp.isGM())).toBe(false);
  await go(gm, 'gm');
  await expect(kaiCard(gm)).toHaveCount(0);

  await test.step('joining again without the refused key joins as a player', async () => {
    await go(player, 'room');
    await player.locator(`${roomView} [data-join]`).tap();
    await expect.poll(() => player.evaluate(() => hunterApp.api.sync.room())).toBe(code);
    await expect(player.locator(`${roomView} [data-tools]`)).toBeHidden();
    await go(gm, 'gm');
    await expect(kaiCard(gm)).toHaveCount(1);
  });
});

test('a GM who taps New room while Open as GM is on its way is told another is under way, and only the first room opens', async ({ device }) => {
  const { gm, code } = await gmWithRoom(device, { blockServiceWorker: true });
  await go(gm, 'room');
  await gm.locator(`${roomView} [data-leave]`).tap();
  await expect(gm.locator(`${roomView} [data-lobby]`)).toBeVisible();
  let posts = 0;
  gm.on('request', r => { if (r.method() === 'POST' && /\/api\/rooms$/.test(r.url())) posts++; });
  let release = (): void => {};
  const held = new Promise<void>(r => { release = r; });
  const peek = (u: URL) => u.pathname === `/api/rooms/${code}` && u.searchParams.has('peek');
  await gm.route(peek, async route => { await held; await route.continue(); });

  await test.step('the GM taps Open as GM, and while it waits on the server taps New room', async () => {
    await go(gm, 'gm');
    await gm.locator(`#gm-room [data-gmrejoin="${code}"]`).tap();
    await expect.poll(() => gm.evaluate(() => hunterApp.api.sync.conn())).toBe('joining');
    await gm.locator('#gm-room [data-gmcreate]').tap();
    await expect(gm.locator('#gm-board-msg')).toHaveText('Another create or join is under way. Try again in a moment.');
  });

  await test.step('when the server answers, the GM is in the first room and no new room was asked for', async () => {
    release();
    await expect.poll(() => gm.evaluate(() => hunterApp.api.sync.conn())).toBe('live');
    await gm.unroute(peek);
    expect(await gm.evaluate(() => hunterApp.api.sync.room())).toBe(code);
    await expect(gm.locator('#gm-room [data-gmroomcode]')).toHaveText(code);
    expect(posts).toBe(0);
  });
});

test('a player whose join as a new hunter fails is left with no trace of that hunter, and the next join makes it and plays as it', async ({ device }) => {
  const { gm, code } = await gmWithRoom(device);
  const player = (await device('player', { blockServiceWorker: true, allowConsole: [/status of 502/] })).page;
  await onboardPlayer(player, 'Kai Test');
  await player.evaluate(() => hunterApp.store.update((d: any) => { d.hunters.push(hunterApp.store.newHunter('Mia Test')); }, 'test-setup'));
  await answerWindow(player, 'A GATE HAS APPEARED');
  const party = () => player.evaluate(() => hunterApp.store.get().hunters.map((h: any) => h.name as string));
  const kai = await activeHunter(player);
  const head = (u: URL) => u.pathname === `/api/rooms/${code}` && !u.searchParams.has('peek');

  await test.step('the head of the room fails after the room was found: the join says so, and no hunter Rin Test was made', async () => {
    await player.route(head, route => (route.request().method() === 'GET' ? route.fulfill({ status: 502, contentType: 'text/plain', body: 'bad gateway' }) : route.continue()));
    await go(player, 'room');
    await player.locator(`${roomView} input[data-code]`).fill(code);
    await expect(player.locator(`${roomView} [data-check]`)).toContainText('Room found');
    await player.locator(`${roomView} select[data-hunter]`).selectOption('__new');
    await player.locator(`${roomView} [data-newname]`).fill('Rin Test');
    await player.locator(`${roomView} [data-join]`).tap();
    await expect(player.locator(`${roomView} [data-err]`)).toContainText('Could not reach the server');
    expect(await player.evaluate(() => hunterApp.api.sync.room())).toBeNull();
    expect(await party()).toEqual(['Kai Test', 'Mia Test']);
    expect((await activeHunter(player)).id).toBe(kai.id);
    await expect(player.locator('.sys-overlay.show', { hasText: 'Rin Test' }), 'no window speaks of a hunter the phone does not have').toHaveCount(0);
  });

  await test.step('once the server answers, the same join makes Rin Test, plays as it, and the GM sees it', async () => {
    await player.unroute(head);
    await player.locator(`${roomView} [data-join]`).tap();
    await expect.poll(() => player.evaluate(() => hunterApp.api.sync.room())).toBe(code);
    expect(await party()).toEqual(['Kai Test', 'Mia Test', 'Rin Test']);
    const rin = await activeHunter(player);
    expect(rin.name).toBe('Rin Test');
    expect(await player.evaluate(() => hunterApp.store.get().settings.sync.boundHunterId)).toBe(rin.id);
    await go(gm, 'gm');
    await expect(gm.locator('#gm-board .gm-card.remote', { hasText: 'Rin Test' })).toHaveCount(1);
  });
});

test('in a room the mode pill explains the role and does not change it', async ({ device }) => {
  const { gm, code } = await gmWithRoom(device);
  const player = await playerInRoom(device, code);
  const roleWindow = (page: Page) => page.locator('.sys-overlay.show');
  const chosenMode = (page: Page) => page.evaluate(() => hunterApp.store.get().settings.mode as string);

  await test.step('the player taps the pill, reads why they are a player, and still has the player nav', async () => {
    const before = await chosenMode(player);
    await expect(player.locator('#mode-pill')).toHaveText('PLAYER');
    await player.locator('#mode-pill').tap();
    await expect(roleWindow(player)).toContainText('You are a player in this room. The GM is the phone that opened it.');
    await roleWindow(player).locator('button', { hasText: 'Understood' }).tap();
    await expect(roleWindow(player)).toHaveCount(0);
    await expect(player.locator('#mode-pill')).toHaveText('PLAYER');
    await expect(player.locator('#nav-bottom a[href="#/status"]')).toBeVisible();
    await expect(player.locator('#nav-bottom a[href="#/gm"]')).toHaveCount(0);
    expect(await chosenMode(player)).toBe(before);
  });

  await test.step('the GM taps the pill, reads that they are the GM, and still has the GM nav', async () => {
    const before = await chosenMode(gm);
    await expect(gm.locator('#mode-pill')).toHaveText('GM');
    await gm.locator('#mode-pill').tap();
    await expect(roleWindow(gm)).toContainText('You are the GM of this room.');
    await roleWindow(gm).locator('button', { hasText: 'Understood' }).tap();
    await expect(roleWindow(gm)).toHaveCount(0);
    await expect(gm.locator('#mode-pill')).toHaveText('GM');
    await expect(gm.locator('#nav-bottom a[href="#/gm"]')).toBeVisible();
    expect(await chosenMode(gm)).toBe(before);
    expect(await gm.evaluate(() => hunterApp.isGM())).toBe(true);
  });
});

test('in a room each phone sits where the room puts it, and only the GM\'s holds the players\' sheets', async ({ device }) => {
  const { gm, code } = await gmWithRoom(device);
  const player = await playerInRoom(device, code);
  await expect.poll(() => gm.evaluate(() => hunterApp.api.sync.remoteSheets().length)).toBeGreaterThan(0);
  expect(await gm.evaluate(() => hunterApp.seat())).toBe('gm');
  expect(await player.evaluate(() => hunterApp.seat())).toBe('player');
  expect(await player.evaluate(() => hunterApp.api.sync.remoteSheets())).toEqual([]);
  await go(player, 'room');
  await player.locator(`${roomView} [data-leave]`).tap();
  await expect.poll(() => player.evaluate(() => hunterApp.seat())).toBe('alone');
});

test('a player who leaves a room returns with one tap, and a hunter claimed by another device is not reported as claimed in a new room', async ({ device }) => {
  const { code } = await gmWithRoom(device);
  const player = await playerInRoom(device, code, { blockServiceWorker: true, allowConsole: [/status of 403/] });

  await test.step('leaving shows the lobby and a one-tap return', async () => {
    await go(player, 'room');
    await player.locator(`${roomView} [data-leave]`).tap();
    await expect(player.locator(`${roomView} [data-lobby]`)).toBeVisible();
    await expect(player.locator(`${roomView} [data-rejoinlast]`)).toHaveText(`Rejoin ${code}`);
  });

  await test.step('rejoining while the server refuses the sheet shows the claimed note', async () => {
    await player.route(u => u.pathname.startsWith(`/api/rooms/${code}/sheets/`), route => route.request().method() === 'PUT'
      ? route.fulfill({ status: 403, contentType: 'application/json', body: '{"error":"not your sheet"}' }) : route.continue());
    await player.locator(`${roomView} [data-rejoinlast]`).tap();
    await expect.poll(() => player.evaluate(() => hunterApp.api.sync.room())).toBe(code);
    await expect(player.locator('.sys-overlay.show', { hasText: 'HUNTER LOCKED TO ANOTHER DEVICE' })).toBeVisible();
    await dismissAll(player, 4);
    await go(player, 'room');
    await expect(player.locator(`${roomView} [data-cl="locked"]`)).toBeVisible();
  });

  await test.step('after leaving and running a new room, the note is gone', async () => {
    await player.unrouteAll({ behavior: 'ignoreErrors' });
    await player.locator(`${roomView} [data-leave]`).tap();
    await player.locator(`${roomView} [data-create]`).tap();
    await expect(player.locator(`${roomView} [data-card]`)).toBeVisible();
    await expect(player.locator(`${roomView} [data-cl="locked"]`)).toBeHidden();
  });
});

test('changes made while a phone is offline arrive after it reconnects, in both directions', async ({ device }) => {
  const { gm, code } = await gmWithRoom(device);
  const player = await playerInRoom(device, code, { blockServiceWorker: true, allowConsole: [/ERR_INTERNET_DISCONNECTED|net::ERR|Failed to fetch/] });
  const ctx = player.context();
  await go(gm, 'gm');
  await expect(kaiCard(gm)).toHaveCount(1);
  let start: any;

  await test.step('the player goes offline, changes the sheet, and the phone says it will send later', async () => {
    await ctx.setOffline(true);
    await go(player, 'status');
    start = await activeHunter(player);
    const before = start;
    await player.locator('#view-status [data-hp="-5"]').first().tap();
    await go(player, 'room');
    await expect(player.locator(`${roomView} [data-cl="off"]`)).toBeVisible();
    await expect(player.locator(`${roomView} [data-state]`)).toHaveAttribute('data-conn', 'reconnecting');
    await expect(player.locator(`${roomView} [data-cl="kept"]`)).toBeVisible();
    await expect(kaiCard(gm)).not.toContainText(`${before.hp - 5} / ${before.derived.hpMax}`);
  });

  await test.step('the GM hurts the player meanwhile', async () => {
    await kaiCard(gm).locator('[data-hp="-5"]').tap();
  });

  await test.step('back online, the GM sees the offline change and the player gets the GM damage', async () => {
    await ctx.setOffline(false);
    await expect(player.locator(`${roomView} [data-state]`)).toHaveAttribute('data-conn', 'live');
    await expect.poll(async () => (await activeHunter(player)).hp).toBe(start.hp - 10);
    await expect(kaiCard(gm)).toContainText(`${start.hp - 10} / ${start.derived.hpMax}`);
  });
});

test('an award the GM sent once is paid once, even when the player reloads and when the player leaves and rejoins the room', async ({ device }) => {
  const { gm, code } = await gmWithRoom(device);
  const player = await playerInRoom(device, code);
  const gold = async (): Promise<number> => (await activeHunter(player)).gold;
  const cursor = () => player.evaluate(() => hunterApp.store.get().settings.sync.cursor as number);
  // Setup for a replay: the phone loses its place in the room, so its next poll reads the award again.
  const rewind = () => player.evaluate(() => hunterApp.store.update((d: any) => { d.settings.sync.cursor = 0; }, 'test-rewind'));
  const reloadAndReadAgain = async (head: number) => {
    await rewind();
    await player.reload();
    await player.waitForFunction(() => window.hunterApp && document.querySelectorAll('#nav-top a').length > 0);
    await expect.poll(cursor).toBe(head);
  };
  let paid = 0, head = 0;

  await test.step('the GM awards 25 gold to the player, and the player receives it', async () => {
    const before = await gold();
    await go(gm, 'gm');
    const toggle = gm.locator('[data-tog="award"]');
    if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.tap();
    await gm.locator('#gm-targets label', { hasText: 'Kai Test' }).locator('input').check();
    await gm.fill('#gm-gold', '25');
    await gm.locator('#gm-award-go').tap();
    await expect.poll(gold).toBe(before + 25);
    await expect(player.locator('.sys-overlay.show', { hasText: 'REWARD RECEIVED' })).toBeVisible();
    paid = before + 25;
    head = await cursor();
    await dismissAll(player, 6);
  });

  await test.step('a reload that reads the award again leaves the gold as it was', async () => {
    await reloadAndReadAgain(head);
    expect(await gold()).toBe(paid);
  });

  await test.step('after leaving and rejoining, reading the award again leaves the gold as it was', async () => {
    await dismissAll(player, 4);
    await go(player, 'room');
    await player.locator(`${roomView} [data-leave]`).tap();
    await player.locator(`${roomView} [data-rejoinlast]`).tap();
    await expect.poll(() => player.evaluate(() => hunterApp.api.sync.room())).toBe(code);
    await reloadAndReadAgain(head);
    expect(await gold()).toBe(paid);
  });
});

test('a sheet the server refuses as too large shows as too big while the room stays live', async ({ device }) => {
  const { gm, code } = await gmWithRoom(device);
  const player = await playerInRoom(device, code, { blockServiceWorker: true, allowConsole: [/status of 413/] });
  await go(gm, 'gm');
  await expect(kaiCard(gm)).toHaveCount(1);
  const start = await activeHunter(player);

  await test.step('the server refuses the sheet as too large when the player loses HP', async () => {
    await player.route(u => u.pathname.startsWith(`/api/rooms/${code}/sheets/`), route => route.request().method() === 'PUT'
      ? route.fulfill({ status: 413, contentType: 'application/json', body: '{"error":"too large"}' }) : route.continue());
    await go(player, 'status');
    await player.locator('#view-status [data-hp="-5"]').first().tap();
  });

  await test.step('the pill and the Room card say the sheet is too big for the room, and the player is still in the room', async () => {
    // a refusal for size is told as such (V4 `sheetTooBig`); Try now is not offered, as a retry sends the same sheet
    await expect(player.locator('#sync-pill [data-roompill]')).toHaveAttribute('data-conn', 'sheetTooBig');
    await go(player, 'room');
    await expect(player.locator(`${roomView} [data-conntext]`)).toHaveText('Live. Your sheet is too big for the room: the GM does not see your changes.');
    await expect(player.locator(`${roomView} [data-retry]`)).toBeHidden();
    expect(await player.evaluate(() => hunterApp.api.sync.room())).toBe(code);
    await expect(kaiCard(gm)).toHaveCount(1);
  });

  await test.step('the GM board keeps the old HP, and a GM change still reaches the player', async () => {
    await expect(kaiCard(gm)).toContainText(`${start.hp} / ${start.derived.hpMax}`);
    await kaiCard(gm).locator('[data-hp="-1"]').tap();
    await expect.poll(async () => (await activeHunter(player)).hp).toBe(start.hp - 6);
  });
});

test('a GM whose key stops working is told and leaves the room', async ({ device }) => {
  const { gm, code } = await gmWithRoom(device);
  await gm.evaluate(c => hunterApp.store.update((d: any) => {
    d.settings.sync.gmKey = 'wrongkeywrongkey';
    d.settings.sync.gmKeys = { [c]: 'wrongkeywrongkey' };
  }, 'test-setup'), code);
  await openApp(gm);

  await expect(gm.locator('#toasts .toast', { hasText: `The GM key for room ${code} no longer works, so this phone left the room.` })).toBeVisible();
  await expect.poll(() => gm.evaluate(() => hunterApp.api.sync.room())).toBeNull();
  await go(gm, 'room');
  await expect(gm.locator(`${roomView} [data-lobby]`)).toBeVisible();
  await expect(gm.locator(`${roomView} [data-rejoinlast]`)).toHaveText(`Rejoin ${code}`);
  expect(await gm.evaluate(() => hunterApp.store.get().settings.sync.gmKeys)).toEqual({});
});

test('a GM who leaves and rejoins the same room never sees the room as it was before leaving', async ({ device }) => {
  const { gm, code } = await gmWithRoom(device);
  const player = await playerInRoom(device, code);
  const roster = gm.locator(`${roomView} [data-roster]`);
  await go(gm, 'room');
  await expect(roster).toContainText('Kai Test');

  await test.step('the GM leaves, and meanwhile the player hunter is renamed and reaches the room', async () => {
    await gm.locator(`${roomView} [data-leave]`).tap();
    await expect(gm.locator(`${roomView} [data-lobby]`)).toBeVisible();
    await player.evaluate(() => hunterApp.store.update((d: any) => { d.hunters.find((h: any) => h.name === 'Kai Test').name = 'Kai Renamed'; }, 'test-setup'));
    const names = async () => (await (await gm.request.get(`/api/rooms/${code}?after=0`, { headers: await gmRoomHeaders(gm, code) })).json()).sheets as Record<string, any>;
    await expect.poll(async () => Object.values(await names()).map(s => s.data.hunter.name)).toContain('Kai Renamed');
  });

  await test.step('after Rejoin the roster shows the new name and never the old one', async () => {
    await gm.evaluate(() => {
      const w = window as any, el = document.querySelector('#view-room [data-roster]') as HTMLElement;
      w.__rosterSeen = [];
      const look = () => { if (el.checkVisibility()) w.__rosterSeen.push(el.textContent); };
      new MutationObserver(look).observe(el, { childList: true, subtree: true, characterData: true });
      const frame = () => { look(); requestAnimationFrame(frame); };
      requestAnimationFrame(frame);
    });
    await gm.locator(`${roomView} [data-rejoinlast]`).tap();
    await expect(roster).toContainText('Kai Renamed');
    const seen: string[] = await gm.evaluate(() => (window as any).__rosterSeen);
    expect(seen.filter(t => t.includes('Kai Test'))).toEqual([]);
  });
});

test('two world days advanced while the room is slow to take the first: the GM\'s phone puts the world once at a time, and the room ends on the last day', async ({ device }) => {
  const { gm, code } = await gmWithRoom(device, { blockServiceWorker: true });
  const worldDay = async (): Promise<number | null> => (await (await gm.request.get(`/api/rooms/${code}?after=0`, { headers: await roomHeaders(gm) })).json()).docs?.world?.data?.day ?? null;
  await expect.poll(worldDay).toBe(1);
  let out = 0, most = 0, held = true, release!: () => void;
  const slow = new Promise<void>(r => { release = r; });
  await gm.route(`**/api/rooms/${code}/sheets/_world`, async route => {
    if (route.request().method() !== 'PUT') return route.continue();
    out++; most = Math.max(most, out);
    if (held) { held = false; await slow; }
    const response = await route.fetch();
    out--;
    await route.fulfill({ response });
  });
  const polled = () => gm.waitForRequest(r => r.method() === 'GET' && r.url().includes(`/api/rooms/${code}?after=`));

  await test.step('the GM advances the day, and the room is slow to take the world doc of day 2', async () => {
    await go(gm, 'gm');
    await gm.locator('[data-tog="gate"]').tap();
    await gm.locator('#gm-d1').tap();
    await expect(gm.locator('#gm-day')).toHaveText('Day 2');
    await expect.poll(() => out).toBe(1);
  });

  await test.step('the GM advances it again while that put is out: no second put of the world goes out beside it', async () => {
    await gm.locator('#gm-d1').tap();
    await expect(gm.locator('#gm-day')).toHaveText('Day 3');
    await polled();
    await polled();
    expect(most).toBe(1);
  });

  await test.step('once the room answers the first, the room holds day 3', async () => {
    release();
    await expect.poll(worldDay).toBe(3);
    expect(most).toBe(1);
  });
});

test('replacing the campaign with a file from another room moves the phone to that room without a reload', async ({ device }, testInfo) => {
  const { code: roomA } = await gmWithRoom(device);
  const player = await playerInRoom(device, roomA);
  const gmB = (await device('gm-b')).page;
  await onboardGM(gmB);
  const roomB = await createRoom(gmB);
  const file = await player.evaluate(b => {
    const s = JSON.parse(JSON.stringify(hunterApp.store.get()));
    s.settings.sync.room = b; s.settings.sync.cursor = 0; s.settings.sync.lastRoom = null;
    s.hunters.find((h: any) => h.id === s.settings.activeHunterId).name = 'Ren File';
    return JSON.stringify(s);
  }, roomB);

  await test.step('the player replaces the campaign with the file', async () => {
    const path = testInfo.outputPath('ren.json');
    await writeFile(path, file);
    await go(player, 'data');
    await player.locator('#view-data [data-import]').setInputFiles(path);
    const preview = player.locator('.sys-overlay.show', { hasText: 'Import preview' });
    await preview.getByRole('button', { name: 'Replace campaign' }).tap();
    await expect(preview).toHaveCount(0);
  });

  await test.step('the pill names the room of the file, and its GM sees the hunter of the file', async () => {
    await expect(player.locator('#sync-pill [data-roompill]')).toHaveText(roomB);
    expect(await player.evaluate(() => hunterApp.api.sync.room())).toBe(roomB);
    await go(gmB, 'gm');
    await expect(gmB.locator('#gm-board .gm-card.remote', { hasText: 'Ren File' })).toHaveCount(1);
  });
});

test('a player\'s dead hunter is revived by the GM from the GM\'s phone and stands at 1 HP', async ({ device }) => {
  const { gm, code } = await gmWithRoom(device);
  const player = await playerInRoom(device, code);
  const hp = player.locator('#view-status [data-bar="hp"] [data-cur]');
  const panel = player.locator('#view-status [data-death]');
  const pips = player.locator('#view-status [data-pips]');

  await test.step('the player falls to 0 HP and fails three death saves: the hunter is Dead', async () => {
    await go(player, 'status');
    for (let i = 0; i < 40 && (await activeHunter(player)).hp > 0; i++) await player.locator('#view-status [data-hp="-5"]').first().tap();
    await expect(hp).toHaveText('0');
    // Math.random answers 0.2, so each d20 is 1 + floor(0.2 x 20) = 5: a failure (2 to 9). Three failures are death.
    await player.evaluate(() => { (window as any).__r = Math.random; Math.random = () => 0.2; });
    for (const after of [/0 successes, 1 failures/, /0 successes, 2 failures/, /^Dead$/]) {
      await player.locator('#view-status [data-dsave]').tap();
      await expect(pips).toHaveAttribute('aria-label', after);
    }
    await player.evaluate(() => { Math.random = (window as any).__r; });
    await expect(panel.locator('[data-life]')).toHaveText('Dead');
  });

  await test.step('the GM sees the hunter Dead on the board and taps Revive', async () => {
    await go(gm, 'gm');
    await expect(kaiCard(gm)).toContainText('Dead');
    await kaiCard(gm).locator('[data-grevive]').tap();
    await expect(gm.locator('#gm-board-msg')).toHaveText('Sent Revive to Kai Test.');
  });

  await test.step('the player\'s hunter stands at 1 HP, and the GM board shows it alive', async () => {
    await expect(hp).toHaveText('1');
    await expect(panel).toBeHidden();
    await expect(kaiCard(gm).locator('[data-grevive]')).toHaveCount(0);
    await expect(kaiCard(gm)).not.toContainText('Dead');
  });
});
