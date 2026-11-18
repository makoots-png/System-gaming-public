import { spawn, type ChildProcess } from 'node:child_process';
import { test, expect, onboardGM, onboardPlayer, createRoom, dismissAll, editIdentity, go, save, type Page } from './helpers.ts';

// Chromium logs every 426 answer as a console error. The 426 is the refusal these tests are about.
const REFUSED_LOG = /Failed to load resource: the server responded with a status of 426 \(Upgrade Required\)/;
const STUCK = 'This app is out of date and could not update itself. Close every tab of it and open it again.';
const OLD_BUILD = 'old-build-01';

const countLoads = (page: Page): (() => number) => {
  let loads = 0;
  page.on('load', () => { loads++; });
  return () => loads;
};

const appIsUp = (page: Page) => page.waitForFunction(() => window.hunterApp && document.querySelectorAll('#nav-top a').length > 0, null, { timeout: 15_000 });
const hunters = async (page: Page) => (await save(page)).hunters;
const syncState = (page: Page) => page.evaluate(() => ({ room: hunterApp.api.sync.room(), conn: hunterApp.api.sync.conn(), bound: hunterApp.store.get().settings.sync.boundHunterId }));

/** Makes the player's room requests look like an old app's. `keepGoing` is asked before each request. */
async function sendOldBuild(page: Page, keepGoing: (refusals: number) => boolean): Promise<void> {
  let refusals = 0;
  await page.route(url => url.pathname.startsWith('/api/rooms'), async route => {
    if (!keepGoing(refusals)) return route.continue();
    const response = await route.fetch({ headers: { ...route.request().headers(), 'x-hunter-build': OLD_BUILD } });
    if (response.status() === 426) refusals++;
    await route.fulfill({ response });
  });
}

async function gmAndPlayerInARoom(gm: Page, player: Page): Promise<string> {
  await onboardGM(gm);
  const code = await createRoom(gm);
  await onboardPlayer(player, 'Kai Test', code);
  await expect.poll(async () => (await syncState(player)).room).toBe(code);
  await dismissAll(player, 4);
  await expect.poll(async () => (await syncState(player)).conn).toBe('live');
  await go(gm, 'gm');
  await expect(gm.locator('#gm-board .gm-card.remote', { hasText: 'Kai Test' })).toHaveCount(1);
  return code;
}

test('a phone with an old app updates itself and is back in the room', async ({ device }) => {
  const gm = (await device('gm')).page;
  const player = (await device('player', { blockServiceWorker: true, allowConsole: [REFUSED_LOG] })).page;
  const code = await gmAndPlayerInARoom(gm, player);
  const before = { hunters: await hunters(player), sync: await syncState(player) };
  const loads = countLoads(player);

  await test.step('the server refuses the old app and the phone reloads once', async () => {
    await sendOldBuild(player, refusals => refusals === 0);
    await expect.poll(loads).toBe(1);
    await appIsUp(player);
  });

  await test.step('the player is live in the same room with the same hunter', async () => {
    await expect.poll(() => syncState(player)).toEqual({ ...before.sync, room: code, conn: 'live' });
    expect(await hunters(player)).toEqual(before.hunters);
    await expect(player.locator('#banners .banner')).toHaveCount(0);
  });

  await test.step('a change the player makes afterwards reaches the GM', async () => {
    await dismissAll(player, 4);
    await go(player, 'status');
    await editIdentity(player, 'job', 'Mage');
    await expect(gm.locator('#gm-board .gm-card.remote', { hasText: 'Kai Test' })).toContainText('Mage');
    expect(loads()).toBe(1);
  });
});

test('a phone that cannot update says so and does not reload again', async ({ device }) => {
  const gm = (await device('gm')).page;
  const player = (await device('player', { blockServiceWorker: true, allowConsole: [REFUSED_LOG] })).page;
  const code = await gmAndPlayerInARoom(gm, player);
  const before = { hunters: await hunters(player), sync: await syncState(player) };
  const loads = countLoads(player);

  await test.step('the phone reloads once and then says it could not update', async () => {
    await sendOldBuild(player, () => true);
    await expect.poll(loads).toBe(1);
    await expect(player.locator('#banners .banner', { hasText: STUCK })).toHaveCount(1);
  });

  await test.step('it does not reload again and keeps its room and hunter', async () => {
    await player.waitForTimeout(6000);
    expect(loads()).toBe(1);
    await expect(player.locator('#banners .banner', { hasText: STUCK })).toHaveCount(1);
    expect((await syncState(player)).room).toBe(code);
    expect((await syncState(player)).bound).toBe(before.sync.bound);
    expect(await hunters(player)).toEqual(before.hunters);
  });
});

// Beside the run's own server (E2E_PORT, 3217 by default), so two runs on two ports do not share it.
const DEPLOY_PORT = Number(process.env.E2E_PORT ?? 3217) + 15, DEPLOY_URL = `http://localhost:${DEPLOY_PORT}`;

const serverAnswers = () => fetch(`${DEPLOY_URL}/api/health`).then(r => r.ok, () => false);

async function startServer(salt: string): Promise<ChildProcess> {
  expect(await serverAnswers(), `port ${DEPLOY_PORT} is free before the test server starts`).toBe(false);
  const child = spawn('bun', ['server.ts'], { env: { ...process.env, PORT: String(DEPLOY_PORT), BUILD_SALT: salt }, stdio: 'ignore', detached: true });
  await expect.poll(serverAnswers, { message: `server on ${DEPLOY_PORT} answers`, timeout: 30_000 }).toBe(true);
  return child;
}

/** `bun` can be a shell wrapper around the real binary, so the whole process group is stopped, not only the child. */
async function stopServer(child: ChildProcess): Promise<void> {
  try { if (child.pid) process.kill(-child.pid, 'SIGTERM'); } catch { /* already gone */ }
  await expect.poll(serverAnswers, { message: `server on ${DEPLOY_PORT} stopped`, timeout: 30_000 }).toBe(false);
}

test('after a deploy an open phone updates itself', async ({ device }) => {
  const { page } = await device('phone', { allowConsole: [
    REFUSED_LOG,
    // The new server starts with no rooms (memory store), so the reloaded app's first poll of its old room is a 404.
    /Failed to load resource: the server responded with a status of 404 \(Not Found\)/,
  ] });
  const cacheNames = () => page.evaluate(() => caches.keys());
  const running: ChildProcess[] = [];
  try {
    running.push(await startServer(''));
    await onboardGM(page, DEPLOY_URL + '/');
    const code = await createRoom(page);
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
    const before = { build: await page.evaluate(() => hunterApp.build as string), hunters: await hunters(page) };
    await expect.poll(cacheNames).toEqual([`hunter-system-${before.build}`]);
    const loads = countLoads(page);

    await test.step('the server restarts as a new build and the phone reloads once', async () => {
      await stopServer(running.pop()!);
      running.push(await startServer('next'));
      await expect.poll(loads, { timeout: 30_000 }).toBe(1);
      await appIsUp(page);
    });

    await test.step('the page runs the new build from the new worker cache', async () => {
      const build = await page.evaluate(() => hunterApp.build as string);
      expect(build).not.toBe(before.build);
      await expect.poll(cacheNames).toEqual([`hunter-system-${build}`]);
    });

    await test.step('the hunters are unchanged and the phone says the room is gone', async () => {
      expect(await hunters(page)).toEqual(before.hunters);
      await expect.poll(async () => (await syncState(page)).room).toBeNull();
      await dismissAll(page, 4);
      await go(page, 'room');
      await expect(page.locator('#view-room')).toContainText(`Room ${code} no longer exists`);
      await expect(page.locator('#banners .banner')).toHaveCount(0);
      expect(loads()).toBe(1);
    });
  } finally {
    for (const child of running) await stopServer(child);
  }
});

// The update's own words, seen on a real worker: the test's server is restarted as a new build, so the page's room
// requests are refused and the browser installs the new build's sw.js. Requests the worker makes to cache the app are
// routed only with Chromium's service worker network events (PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS), read
// when a worker starts; each test that routes them sets it and puts it back.
const SW_EVENTS = 'PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS';
const NEW_SERVER_ROOM_GONE = /Failed to load resource: the server responded with a status of 404 \(Not Found\)/;

/** Every text the room pill shows, in order, across reloads; a reload after setup is marked `(reload)`. */
async function recordPill(page: Page): Promise<string[]> {
  const seen: string[] = [];
  await page.exposeFunction('__pillSeen', (text: string) => { seen.push(text); });
  await page.addInitScript(() => addEventListener('DOMContentLoaded', () => {
    let last = '';
    new MutationObserver(() => {
      const text = document.querySelector('#sync-pill .sp-txt')?.textContent ?? '';
      if (text !== last) { last = text; (window as unknown as { __pillSeen: (t: string) => void }).__pillSeen(text); }
    }).observe(document.documentElement, { subtree: true, childList: true, characterData: true });
  }));
  return seen;
}

/** The percentages the pill showed before the first reload after setup. */
function percentsBeforeReload(seen: readonly string[]): number[] {
  const end = seen.indexOf('(reload)');
  return seen.slice(0, end < 0 ? seen.length : end).flatMap(t => { const m = /^Updating (\d+)%$/.exec(t); return m ? [Number(m[1])] : []; });
}
const reloads = (seen: readonly string[]) => seen.filter(t => t === '(reload)').length;

/** A GM phone in a room on the first build, controlled by that build's worker. Answers the build; `seen` starts empty after it. */
async function onTheFirstBuild(page: Page, running: ChildProcess[], seen: string[]): Promise<string> {
  running.push(await startServer(''));
  await onboardGM(page, DEPLOY_URL + '/');
  await createRoom(page);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  page.on('load', () => { seen.push('(reload)'); });
  seen.length = 0;
  return page.evaluate(() => hunterApp.build as string);
}

async function deployNext(running: ChildProcess[]): Promise<void> {
  await stopServer(running.pop()!);
  running.push(await startServer('next'));
}

test('after a deploy the pill counts the new app\'s files up to 100% before the phone reloads', async ({ device }) => {
  const { page } = await device('phone', { allowConsole: [REFUSED_LOG, NEW_SERVER_ROOM_GONE] });
  const seen = await recordPill(page);
  const running: ChildProcess[] = [];
  try {
    const first = await onTheFirstBuild(page, running, seen);

    await test.step('the server restarts as a new build and the phone reloads once', async () => {
      await deployNext(running);
      await expect.poll(() => reloads(seen), { timeout: 30_000 }).toBe(1);
      await appIsUp(page);
      expect(await page.evaluate(() => hunterApp.build as string)).not.toBe(first);
    });

    await test.step('before the reload the pill counted up, file by file, to 100%', async () => {
      const percents = percentsBeforeReload(seen);
      expect(percents.at(-1), `the pill showed ${percents.join(', ')}`).toBe(100);
      expect(percents.some(p => p > 0 && p < 100), `a share between 0 and 100 was shown: ${percents.join(', ')}`).toBe(true);
      expect(percents).toEqual([...percents].sort((a, b) => a - b));
    });
  } finally {
    for (const child of running) await stopServer(child);
  }
});

test('a phone whose new worker is slow keeps counting and reloads only once every file is cached', async ({ device }) => {
  process.env[SW_EVENTS] = '1';
  const running: ChildProcess[] = [];
  try {
    const { page, ctx } = await device('phone', { allowConsole: [REFUSED_LOG, NEW_SERVER_ROOM_GONE] });
    const seen = await recordPill(page);
    await onTheFirstBuild(page, running, seen);
    // A slow phone: the files the new worker caches arrive 800 ms apart from the first, so caching them all takes past
    // the 4 s the tab used to wait in all. Only a file's first request is the install's; the old worker's own fetches
    // (the room's requests, the reload's files) pass at once.
    const GAP = 800, delayed: string[] = [];
    let first = 0;
    await ctx.route(() => true, async route => {
      const r = route.request(), path = new URL(r.url()).pathname;
      if (!r.serviceWorker() || path.startsWith('/api/') || delayed.includes(path)) return route.continue();
      first ||= Date.now();
      delayed.push(path);
      const due = first + GAP * (delayed.length - 1);
      await new Promise(resolve => setTimeout(resolve, Math.max(0, due - Date.now())));
      return route.continue();
    });

    await test.step('the server restarts as a new build and the phone reloads once', async () => {
      await deployNext(running);
      await expect.poll(() => reloads(seen), { timeout: 45_000 }).toBe(1);
      await appIsUp(page);
    });

    await test.step('the worker\'s files came slowly and the pill reached 100% before the reload', async () => {
      expect(GAP * (delayed.length - 1), `the install took longer than the old 4 s wait: ${delayed.join(' ')}`).toBeGreaterThan(4000);
      const percents = percentsBeforeReload(seen);
      expect(percents.at(-1), `the pill showed ${percents.join(', ')}`).toBe(100);
    });
  } finally {
    delete process.env[SW_EVENTS];
    for (const child of running) await stopServer(child);
  }
});

test('a new worker that cannot cache a file does not take over: the phone reloads into the new build and the old worker keeps its cache', async ({ device }) => {
  process.env[SW_EVENTS] = '1';
  const running: ChildProcess[] = [];
  try {
    const { page, ctx } = await device('phone', { allowConsole: [REFUSED_LOG, NEW_SERVER_ROOM_GONE] });
    const seen = await recordPill(page);
    const cacheNames = () => page.evaluate(() => caches.keys());
    const first = await onTheFirstBuild(page, running, seen);
    await expect.poll(cacheNames).toEqual([`hunter-system-${first}`]);
    let refused = 0;
    await ctx.route(() => true, async route => {
      const r = route.request();
      if (r.serviceWorker() && new URL(r.url()).pathname === '/app.css') { refused++; return route.abort(); }
      return route.continue();
    });

    await test.step('the server restarts as a new build and the phone reloads once, into the new build', async () => {
      await deployNext(running);
      await expect.poll(() => reloads(seen), { timeout: 30_000 }).toBe(1);
      await appIsUp(page);
      expect(await page.evaluate(() => hunterApp.build as string)).not.toBe(first);
      expect(refused, 'the new worker asked for the file and was refused').toBeGreaterThan(0);
      expect(percentsBeforeReload(seen).at(-1) ?? 0).toBeLessThan(100);
    });

    await test.step('the old worker still controls the page with its own cache, and the new one left none', async () => {
      await expect.poll(cacheNames).toEqual([`hunter-system-${first}`]);
      expect(await page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);
    });

    await test.step('once the file can be fetched, the next load installs the new worker whole', async () => {
      await ctx.unrouteAll();
      const build = await page.evaluate(() => hunterApp.build as string);
      await page.reload();
      await appIsUp(page);
      await expect.poll(cacheNames, { timeout: 30_000 }).toEqual([`hunter-system-${build}`]);
    });
  } finally {
    delete process.env[SW_EVENTS];
    for (const child of running) await stopServer(child);
  }
});
