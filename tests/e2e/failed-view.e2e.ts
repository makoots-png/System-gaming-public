import { test, expect, onboardPlayer, go, type Page } from './helpers.ts';

// A view, a panel or a key whose code throws is a bug. The app says so in place of that part, logs it once per
// distinct failure, and every other part keeps working (src/app.js, audit rows 1 and 2).

const FAILED = 'This section failed to load. The rest of the app still works.';
const warnings = (errors: string[], where: string): string[] => errors.filter(e => e.startsWith('[warning]') && e.includes(`[${where}]`));

/** Registers a view through the app's own registry, as a module would, whose update throws once `window.__break` is set. */
const addBreakable = (page: Page): Promise<void> => page.evaluate(() => {
  hunterApp.registerView({
    id: 'breakable', label: 'Breakable', order: 99,
    mount(el: HTMLElement) { el.innerHTML = '<p data-drawn>Drawn</p>'; },
    update() { if ((window as any).__break) throw new Error('broken on purpose'); },
  });
});

test('a screen whose update breaks says it failed, logs it once, and the other screens still work', async ({ device }) => {
  const { page, errors } = await device('player', { allowConsole: [/\[update:breakable\] broken on purpose/] });
  await onboardPlayer(page, 'Mira Test');
  await addBreakable(page);
  await go(page, 'breakable');
  await expect(page.locator('#view-breakable [data-drawn]')).toHaveText('Drawn');

  await page.evaluate(() => { (window as any).__break = true; });
  await go(page, 'status');
  await go(page, 'breakable');
  await expect(page.locator('#view-breakable')).toContainText(FAILED);
  await go(page, 'status');
  await go(page, 'breakable');
  await expect(page.locator('#view-breakable')).toContainText(FAILED);
  expect(warnings(errors, 'update:breakable')).toHaveLength(1);

  await go(page, 'status');
  await expect(page.locator('#view-status')).toBeVisible();
  await expect(page.locator('#view-status')).not.toContainText(FAILED);
});

test('a screen whose rule for showing breaks is listed and says it failed, rather than hiding or drawing as if fine', async ({ device }) => {
  const { page, errors } = await device('player', { allowConsole: [/\[when:whenless\] no rule today/] });
  await onboardPlayer(page, 'Mira Test');
  await page.evaluate(() => {
    hunterApp.registerView({ id: 'whenless', label: 'Whenless', order: 99, when: () => { throw new Error('no rule today'); },
      mount(el: HTMLElement) { el.innerHTML = '<p data-drawn>Drawn</p>'; } });
  });
  await go(page, 'whenless');
  await expect(page.locator('#view-whenless')).toContainText(FAILED);
  await expect(page.locator('#view-whenless [data-drawn]')).toHaveCount(0);
  expect(warnings(errors, 'when:whenless')).toHaveLength(1);
});

test('a phone whose service worker does not register logs why, as it will not open offline', async ({ device }) => {
  const { page, ctx, errors } = await device('player', { allowConsole: [/\[sync:worker\] the browser refused the worker/] });
  await ctx.addInitScript(() => {
    Object.defineProperty(ServiceWorkerContainer.prototype, 'register', { value: () => Promise.reject(new Error('the browser refused the worker')) });
  });
  await onboardPlayer(page, 'Mira Test');
  await expect.poll(() => warnings(errors, 'sync:worker')).toHaveLength(1);
});

test('a panel whose rule for showing breaks before it ever showed is never set up: it says it failed in its place, and the screen around it still draws', async ({ device }) => {
  const { page, errors } = await device('player', { allowConsole: [/\[when:whenless-panel\] no rule today/] });
  await onboardPlayer(page, 'Mira Test');
  await page.evaluate(() => {
    hunterApp.registerPanel({ id: 'whenless-panel', view: 'status', title: 'Whenless', when: () => { throw new Error('no rule today'); },
      mount(el: HTMLElement) { (window as any).__mounts = ((window as any).__mounts ?? 0) + 1; el.innerHTML = '<p data-drawn>Drawn</p>'; } });
    hunterApp.redraw();
  });
  const panel = page.locator('#view-status [data-panel="whenless-panel"]');
  await expect(panel).toContainText('This panel failed to load.');
  await expect(panel.locator('[data-drawn]')).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__mounts ?? 0)).toBe(0);
  await expect(page.locator('#view-status [data-idedit]')).toBeVisible();
  expect(warnings(errors, 'when:whenless-panel')).toHaveLength(1);
});
