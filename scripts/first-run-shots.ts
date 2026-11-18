// Phone screenshots of what a new player and a new GM meet: the Welcome window, the end of setup, the Room page for
// each role, and the Rules page. The same taps on any build, so two builds can be laid side by side.
//   PORT=3301 bun server.ts &      (the build to shoot; rooms need the server)
//   bun scripts/first-run-shots.ts --url http://localhost:3301 --out docs/agent-handoff/frc/shots --tag before
// Each file is <tag>-<n>-<name>.png at 390 by 844, the screen only (a window is laid out for the screen).
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, type Browser, type LaunchOptions, type Page } from '@playwright/test';

const arg = (name: string): string | undefined => { const i = process.argv.indexOf(name); return i < 0 ? undefined : process.argv[i + 1]; };
const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const launchOptions = (): LaunchOptions => (process.env.E2E_CHROMIUM ? { executablePath: process.env.E2E_CHROMIUM } : {});
const OB = '.ob-overlay';

const url = arg('--url'), out = arg('--out'), tag = arg('--tag');
if (!url || !out || !tag) throw new Error('usage: bun scripts/first-run-shots.ts --url <app url> --out <folder> --tag <before|after>');

async function phone(browser: Browser): Promise<Page> {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: IPHONE_UA, serviceWorkers: 'block', reducedMotion: 'reduce' });
  const page = await context.newPage();
  await page.goto(url!);
  await page.locator(`${OB} [data-yes]`).waitFor();
  return page;
}

/** Lets a window that is opening finish and a toast settle: this script shoots builds whose windows differ, so it cannot wait by title. */
const settle = (page: Page): Promise<void> => page.waitForTimeout(900);

async function shot(page: Page, n: number, name: string): Promise<void> {
  await settle(page);
  await page.screenshot({ path: join(out!, `${tag}-${n}-${name}.png`) });
}

async function tapIfShown(page: Page, selector: string): Promise<boolean> {
  const el = page.locator(selector).first();
  if (!(await el.isVisible())) return false;
  await el.tap();
  return true;
}

/** Closes what stands over the page after setup: the window setup ends with, then any System window. */
async function clear(page: Page, after: string): Promise<void> {
  await settle(page);
  await tapIfShown(page, `${OB} ${after}`);
  for (let i = 0; i < 6; i++) {
    await settle(page);
    if (!(await tapIfShown(page, '.sys-overlay.show .primary')) && !(await tapIfShown(page, '.sys-overlay.show button'))) break;
  }
}

async function view(page: Page, id: string): Promise<void> {
  await page.evaluate((hash: string) => { location.hash = hash; }, `#/${id}`);
  await page.locator(`#view-${id}`).waitFor();
}

async function player(browser: Browser): Promise<void> {
  const page = await phone(browser);
  await shot(page, 1, 'welcome');
  await page.locator(`${OB} [data-yes]`).tap();
  await page.locator(`${OB} [data-player]`).tap();
  await page.locator(`${OB} [data-name]`).fill('Mira Vale');
  await shot(page, 2, 'player-name');
  await page.locator(`${OB} [data-go]`).tap();
  await shot(page, 3, 'player-after-setup');
  await clear(page, '[data-obsheet]');
  await view(page, 'room');
  await shot(page, 6, 'room-join-player');
  await view(page, 'rules');
  await shot(page, 8, 'rules-top-player');
  await page.locator('#rr-checks').evaluate(el => el.scrollIntoView({ block: 'start' }));
  await shot(page, 9, 'rules-checks');
  await page.locator('.rr', { hasText: 'At 0 HP' }).first().evaluate(el => el.scrollIntoView({ block: 'center' }));
  await shot(page, 10, 'rules-0hp');
  await page.context().close();
}

async function gm(browser: Browser): Promise<void> {
  const page = await phone(browser);
  await page.locator(`${OB} [data-yes]`).tap();
  await page.locator(`${OB} [data-gm]`).tap();
  await page.locator(`${OB} [data-starter]`).tap();
  await shot(page, 4, 'gm-after-setup');
  await clear(page, '[data-oblater]');
  await view(page, 'room');
  await shot(page, 5, 'room-create-gm');
  await page.locator('#view-room [data-create]').tap();
  await page.locator('#view-room [data-roomcode]').waitFor();
  await shot(page, 7, 'room-invite-gm');
  await page.context().close();
}

mkdirSync(out, { recursive: true });
const browser = await chromium.launch(launchOptions());
try { await player(browser); await gm(browser); } finally { await browser.close(); }
console.log(`shots written to ${out} with tag ${tag}`);
