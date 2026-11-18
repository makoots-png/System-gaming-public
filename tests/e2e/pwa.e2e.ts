import { test, expect, openApp, onboardPlayer, dismissAll, editIdentity, go, activeHunter, type Page, type BrowserContext } from './helpers.ts';

async function installedAndControlling(page: Page): Promise<void> {
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
}

async function reloadOffline(page: Page, ctx: BrowserContext): Promise<void> {
  await ctx.setOffline(true);
  await page.reload();
  await page.waitForFunction(() => window.hunterApp && document.querySelectorAll('#nav-top a').length > 0, null, { timeout: 15_000 });
  await dismissAll(page, 4);
}

test('the app links a manifest with a name, a start URL and icons that load', async ({ device }) => {
  const { page } = await device('phone');
  await openApp(page);
  const href = await page.locator('link[rel=manifest]').getAttribute('href');
  expect(href).toBeTruthy();
  const result = await page.evaluate(async h => {
    const res = await fetch(h!);
    const manifest = await res.json();
    const icons = await Promise.all((manifest.icons ?? []).map(async (i: any) => {
      const r = await fetch(new URL(i.src, new URL(h!, document.baseURI)));
      if (!r.ok) return { src: i.src, status: r.status, width: 0 };
      return { src: i.src, status: r.status, width: (await createImageBitmap(await r.blob())).width };
    }));
    return { status: res.status, manifest, icons };
  }, href);
  expect(result.status).toBe(200);
  expect(result.manifest.name).toBeTruthy();
  expect(result.manifest.start_url).toBeTruthy();
  expect(result.manifest.display).toMatch(/standalone|fullscreen|minimal-ui/);
  expect(result.icons.length).toBeGreaterThan(0);
  expect(result.icons.filter((i: any) => i.status !== 200 || i.width < 144)).toEqual([]);
  expect(result.manifest.icons.some((i: any) => parseInt(i.sizes, 10) >= 512)).toBe(true);
});

test('after one online visit the app opens with the network off and shows the hunter', async ({ device }) => {
  const { page, ctx } = await device('phone');
  await onboardPlayer(page, 'Kai Offline');
  await dismissAll(page, 4);
  await installedAndControlling(page);
  await reloadOffline(page, ctx);
  await go(page, 'status');
  await expect(page.locator('#view-status [data-idname]')).toHaveText('Kai Offline');
});

test('a change made offline is still there after another offline reload', async ({ device }) => {
  const { page, ctx } = await device('phone');
  await onboardPlayer(page, 'Kai Offline');
  await dismissAll(page, 4);
  await installedAndControlling(page);
  await reloadOffline(page, ctx);
  await go(page, 'status');
  await editIdentity(page, 'job', 'Night Mage');
  const before = await activeHunter(page);
  await page.locator('#view-status [data-hp="-5"]').first().tap();
  await expect.poll(async () => (await activeHunter(page)).hp).toBe(before.hp - 5);
  await reloadOffline(page, ctx);
  await go(page, 'status');
  await expect(page.locator('#view-status [data-idsub]')).toContainText('Night Mage');
  expect((await activeHunter(page)).hp).toBe(before.hp - 5);
});
