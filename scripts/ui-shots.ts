// Screenshots of every screen for the UI and UX pass, the same file names on every run (a "before" and an "after" set).
//   E2E_CHROMIUM=/opt/pw-browsers/chromium bun scripts/ui-shots.ts --serve 3261 --out /tmp/shots
// `--serve PORT` starts `bun server.ts` on PORT, waits for its health check, and stops it at the end (as the Playwright
// config does for the tests); `--url URL` shoots a server that is already running instead.
// Two passes, each a GM and a player in one room (as scripts/maker-shots.ts). Pass 1: the GM at 1280 by 800 with a mouse,
// and a player on a 360 by 780 touch phone who is shot too. Pass 2: the same GM screens at 390 by 844 with touch.
// Files are `<role>-<size>-<nn>-<screen>.png`. A shot is the screen at deviceScaleFactor 1 with Date starting at a fixed time on each load,
// Math.random seeded and animations off. The room code comes from the server, so screens that show it differ between runs.
// A step whose selector is missing is reported and the script exits 1 at the end; the other steps still run.
import { mkdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { chromium, type Browser, type BrowserContext, type LaunchOptions, type Locator, type Page } from '@playwright/test';

const arg = (name: string): string | undefined => { const i = process.argv.indexOf(name); return i < 0 ? undefined : process.argv[i + 1]; };
const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const NOW = new Date('2026-11-13T18:30:00.000Z');
const launchOptions = (): LaunchOptions => (process.env.E2E_CHROMIUM ? { executablePath: process.env.E2E_CHROMIUM } : {});
const NO_MOTION = '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important;scroll-behavior:auto!important}';
const HUNTER = 'Mira Test';

type Size = { width: number; height: number };
type Phone = { ctx: BrowserContext; page: Page; errors: string[]; touch: boolean; prefix: string; n: number };

const failures: string[] = [];
const written: string[] = [];
let OUT = '';

async function device(browser: Browser, size: Size, touch: boolean, prefix: string): Promise<Phone> {
  const ctx = await browser.newContext({
    viewport: size, deviceScaleFactor: 1, isMobile: touch, hasTouch: touch, serviceWorkers: 'block', reducedMotion: 'reduce',
    ...(touch ? { userAgent: IPHONE_UA } : {}),
  });
  await ctx.addInitScript(({ css, now, seed }: { css: string; now: number; seed: number }) => {
    // Date starts at NOW on every load and runs from there. Playwright's page.clock would also fake performance,
    // which hides the server's Server-Timing tag and leaves the app thinking it has no room server.
    const t0 = performance.now(), Real = Date;
    const at = () => Math.round(now + performance.now() - t0);
    class Fixed extends Real { constructor(...a: unknown[]) { if (a.length) super(...(a as [number])); else super(at()); } static override now() { return at(); } }
    (globalThis as any).Date = Fixed;
    // A seed per phone: the device id is drawn from Math.random, and two phones with one id ignore each other's room events.
    let a = seed;
    Math.random = () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    const add = () => { const s = document.createElement('style'); s.textContent = css; document.head.appendChild(s); };
    if (document.head) add(); else document.addEventListener('DOMContentLoaded', add);
  }, { css: NO_MOTION, now: NOW.getTime(), seed: [...prefix].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7) });
  const page = await ctx.newPage();
  page.setDefaultTimeout(10_000);
  const errors: string[] = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push(String(e)));
  return { ctx, page, errors, touch, prefix, n: 0 };
}

async function settle(page: Page) {
  await page.evaluate(() => new Promise<void>(r => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
}

/** One screenshot: the next number, the screen's name. */
async function shot(d: Phone, screen: string) {
  d.n += 1;
  const name = `${d.prefix}-${String(d.n).padStart(2, '0')}-${screen}.png`;
  await settle(d.page);
  await d.page.mouse.move(0, 0).catch(() => {});
  await d.page.screenshot({ path: join(OUT, name), animations: 'disabled', caret: 'hide' });
  written.push(name);
  console.log(`wrote ${name}`);
}

/** Runs one step; a failure is recorded and the step's shots are skipped, but its numbers are kept so names stay stable. */
async function step(d: Phone, shots: number, name: string, fn: () => Promise<void>) {
  const start = d.n;
  try { await fn(); } catch (e) {
    failures.push(`${d.prefix} ${name}: ${String(e).split('\n')[0]}`);
    console.log(`FAILED ${d.prefix} ${name}: ${String(e).split('\n')[0]}`);
    const dbg = arg('--debug');
    if (dbg) { mkdirSync(dbg, { recursive: true }); await d.page.screenshot({ path: join(dbg, `${d.prefix}-${name.replace(/\W+/g, '-')}.png`) }).catch(() => {}); }
    await closeWindows(d).catch(() => {});
  }
  if (d.n > start + shots) failures.push(`${d.prefix} ${name}: took ${d.n - start} shots, declared ${shots}`);
  d.n = start + shots;
}

/** With --debug, prints what the player's hunter holds, to find where a change is lost. */
async function probe(d: Phone, label: string) {
  if (!arg('--debug')) return;
  const h = await d.page.evaluate(() => { const a = (window as any).hunterApp.store.active(); return { items: (a.inventory ?? a.items ?? []).map((i: any) => i.name), titles: (a.titles ?? []).length, boons: (a.boons ?? []).length, xp: a.xp }; });
  console.log(`probe ${label}: ${JSON.stringify(h)}`);
}

const press = (d: Phone, l: Locator) => (d.touch ? l.first().tap() : l.first().click());

async function pressIfShown(d: Phone, sel: string): Promise<boolean> {
  const t = d.page.locator(sel).first();
  if (!(await t.count()) || !(await t.isVisible())) return false;
  await press(d, t);
  await d.page.waitForTimeout(300);
  return true;
}

async function closeWindows(d: Phone, max = 8) {
  for (let i = 0; i < max; i++) {
    if (await pressIfShown(d, '.mk-overlay [data-cancel]')) continue;
    if (await pressIfShown(d, '.sys-overlay.show .primary')) continue;
    if (await pressIfShown(d, '.sys-overlay.show button:not(.confirm-all):not([hidden])')) continue;
    if (await pressIfShown(d, '.ob-overlay [data-ok]')) continue;
    if (await pressIfShown(d, '.ob-overlay [data-skip]')) continue;
    break;
  }
}

async function answer(d: Phone, title: string | RegExp, label?: string) {
  const win = d.page.locator('.sys-overlay.show', { hasText: title }).last();
  await win.waitFor({ state: 'visible' });
  await press(d, label ? win.locator('.sys-actions button', { hasText: label }) : win.locator('.sys-actions button.primary, .sys-actions button:only-child'));
  await d.page.waitForTimeout(300);
}

async function go(d: Phone, view: string) {
  await d.page.evaluate(v => (window as any).hunterApp.go(v), view);
  await d.page.locator(`#view-${view}`).waitFor({ state: 'visible' });
  await d.page.evaluate(() => window.scrollTo(0, 0));
  await d.page.waitForTimeout(200);
}

async function openApp(d: Phone, url: string) {
  await d.page.goto(url, { waitUntil: 'networkidle' });
  await d.page.waitForFunction(() => (window as any).hunterApp && document.querySelectorAll('#nav-top a').length > 0, null, { timeout: 15_000 });
}

async function show(l: Locator, block: 'start' | 'center' | 'end' = 'center') {
  await l.first().evaluate((el, b) => el.scrollIntoView({ block: b as ScrollLogicalPosition }), block);
}

async function waitToastGone(d: Phone) {
  await d.page.locator('#toasts .toast').first().waitFor({ state: 'detached', timeout: 12_000 }).catch(() => {});
}

/** The GM's first run with the starter campaign, and a room. */
async function gmStart(g: Phone, url: string): Promise<string> {
  await openApp(g, url);
  let code = '';
  await step(g, 1, 'onboarding', async () => {
    await g.page.locator('.ob-overlay').waitFor();
    await shot(g, 'onboarding-welcome');
  });
  for (const s of ['[data-yes]', '[data-gm]', '[data-starter]']) await pressIfShown(g, `.ob-overlay ${s}`);
  await step(g, 1, 'campaign ready', async () => { await g.page.locator('.ob-overlay [data-oblater]').waitFor(); await shot(g, 'onboarding-campaign-ready'); });
  await pressIfShown(g, '.ob-overlay [data-oblater]');
  await g.page.waitForTimeout(500);
  await closeWindows(g);
  await step(g, 1, 'gm view out of a room', async () => { await go(g, 'gm'); await shot(g, 'gm-view-no-room'); });
  await go(g, 'gm');
  await press(g, g.page.locator('[data-gmcreate]'));
  await g.page.waitForFunction(() => /^[A-HJ-NP-Z2-9]{6}$/.test((document.querySelector('[data-gmroomcode]')?.textContent ?? '').trim()));
  code = ((await g.page.locator('[data-gmroomcode]').first().textContent()) ?? '').trim();
  return code;
}

/** The player joins; with `shots` the onboarding, the refused code and the Room view out of a room are shot. */
async function playerJoin(p: Phone, url: string, code: string, shots: boolean) {
  await openApp(p, url);
  if (shots) await step(p, 1, 'onboarding welcome', async () => { await p.page.locator('.ob-overlay [data-yes]').waitFor(); await shot(p, 'onboarding-welcome'); });
  await pressIfShown(p, '.ob-overlay [data-yes]');
  await pressIfShown(p, '.ob-overlay [data-player]');
  await p.page.fill('.ob-overlay [data-name]', HUNTER);
  if (shots) {
    await step(p, 1, 'refused room code', async () => {
      await p.page.fill('.ob-overlay [data-room]', 'ZZZZ22');
      await p.page.locator('.ob-overlay', { hasText: /There is no room/i }).waitFor({ timeout: 8000 });
      await shot(p, 'onboarding-refused-code');
    });
  }
  await p.page.fill('.ob-overlay [data-room]', code);
  if (shots) await step(p, 1, 'onboarding filled', async () => { await p.page.locator('.ob-overlay', { hasText: /Room found/i }).waitFor({ timeout: 8000 }); await shot(p, 'onboarding-player-filled'); });
  await pressIfShown(p, '.ob-overlay [data-go]');
  await p.page.locator('.ob-overlay [data-obsheet]').waitFor();
  if (shots) await step(p, 1, 'hunter created', async () => { await shot(p, 'onboarding-hunter-created'); });
  await pressIfShown(p, '.ob-overlay [data-obsheet]');
  await p.page.waitForTimeout(800);
  await closeWindows(p, 4);
}

async function gmMakers(g: Phone) {
  const page = g.page;
  const workshop = (kind: string) => page.locator(`#view-workshop [data-ws="${kind}"]`);
  await step(g, 1, 'workshop empty', async () => { await go(g, 'workshop'); await shot(g, 'workshop-empty'); });
  await step(g, 2, 'status maker', async () => {
    const d = page.locator('.fg-overlay [role=dialog]');
    await go(g, 'workshop');
    await press(g, workshop('status').locator('[data-new]'));
    await d.locator('[data-name]').fill('Frostbite');
    await shot(g, 'maker-status-top');
    await press(g, d.locator('[data-quick] [data-q="d6"]'));
    await press(g, d.locator('[data-row="0"] [data-mode="rank"]'));
    await d.locator('[data-row="0"] [data-t]').nth(5).fill('9d12');
    await show(d.locator('.mk-preview'), 'end');
    await shot(g, 'maker-status-filled');
    await press(g, d.locator('[data-apply]'));
    await d.waitFor({ state: 'detached' });
  });
  await step(g, 2, 'status maker kits groups', async () => {
    const d = page.locator('.fg-overlay [role=dialog]');
    await press(g, workshop('status').locator('[data-new]'));
    await d.locator('[data-name]').fill('Resonance');
    const st = d.locator('[data-group="stacks"]');
    await press(g, st.locator('> summary'));
    await st.locator('[data-k="stack"]').check();
    await st.locator('[data-k="th"]').check();
    await show(st, 'start');
    await shot(g, 'maker-status-stacks');
    const wh = d.locator('[data-group="when"]');
    await press(g, wh.locator('> summary'));
    await press(g, wh.locator('[data-add-trig]'));
    await show(wh, 'start');
    await shot(g, 'maker-status-trigger');
    await press(g, d.locator('.mk-actions [data-cancel]'));
    await d.waitFor({ state: 'detached' });
  });
  await step(g, 1, 'item maker', async () => {
    const d = page.locator('.lf-overlay [role=dialog]');
    await press(g, workshop('item').locator('[data-new]'));
    await d.locator('#lf-name').fill('Bottled Storm');
    await press(g, d.locator('[data-chips="type"] [data-chip="consumable"]'));
    await press(g, d.locator('[data-quick] [data-q="damage"]'));
    await press(g, d.locator('[data-quick] [data-q="apply"]'));
    await press(g, d.locator('[data-chips="target"] [data-chip="other"]'));
    await d.locator('#lf-tell').check();
    await show(d.locator('#lf-tell'), 'end');
    await shot(g, 'maker-item-filled');
    await press(g, d.locator('[data-apply]'));
    await d.waitFor({ state: 'detached' });
  });
  await step(g, 1, 'skill maker', async () => {
    const d = page.locator('.skm-overlay [role=dialog]');
    await press(g, workshop('skill').locator('[data-new]'));
    await d.locator('#skm-name').fill('Frost Lance');
    await press(g, d.locator('[data-chips="kind"] [data-chip="shot"]'));
    await press(g, d.locator('[data-quick] [data-q="apply"]'));
    await d.locator('[data-row="0"] [data-f="status"]').selectOption('slowed');
    await d.locator('[data-row="0"] [data-f="rounds"]').fill('2');
    await settle(page);
    await show(d.locator('.mk-preview'), 'end');
    await shot(g, 'maker-skill-filled');
    await press(g, d.locator('[data-apply]'));
    await d.waitFor({ state: 'detached' });
    await closeWindows(g, 3);
  });
  await step(g, 1, 'skill maker kits groups', async () => {
    const d = page.locator('.skm-overlay [role=dialog]');
    await press(g, workshop('skill').locator('[data-new]'));
    await d.locator('#skm-name').fill('Executioner');
    for (const grp of ['ticks', 'prices', 'gates']) await press(g, d.locator(`[data-group="${grp}"] > summary`).first());
    await press(g, d.locator('[data-add-scaler]'));
    await press(g, d.locator('[data-add="price"]'));
    await show(d.locator('[data-group="prices"]'), 'start');
    await shot(g, 'maker-skill-kits');
    await press(g, d.locator('.mk-actions [data-cancel]'));
    await d.waitFor({ state: 'detached' });
  });
  await step(g, 1, 'enemy maker', async () => {
    const d = page.locator('.enm-overlay [role=dialog]');
    const ids = await page.evaluate(() => { const s = (window as any).hunterApp.store.get(); return { skill: s.library.skills.find((k: any) => k.name === 'Frost Lance').id as string, item: s.library.items.find((i: any) => i.name === 'Bottled Storm').id as string }; });
    await go(g, 'bestiary');
    await press(g, page.locator('#view-bestiary [data-new]'));
    await d.locator('#enm-name').fill('Ice Warden');
    await press(g, d.locator('[data-chips="rank"] [data-chip="C"]'));
    await press(g, d.locator('[data-chips="archetype"] [data-chip="caster"]'));
    await d.locator('[data-add="ability"]').selectOption(`lib:${ids.skill}`);
    await d.locator('[data-add="status"]').selectOption('hasted');
    await d.locator('#enm-gold').fill('50');
    await d.locator('[data-add="item"]').selectOption(`lib:${ids.item}`);
    await show(d.locator('.mk-preview'), 'end');
    await shot(g, 'maker-enemy-filled');
    await press(g, d.locator('[data-apply]'));
    await d.waitFor({ state: 'detached' });
  });
  await step(g, 1, 'reward maker', async () => {
    const d = page.locator('.rwm-overlay [role=dialog]');
    await go(g, 'workshop');
    await press(g, workshop('bundle').locator('[data-new]'));
    await d.locator('#rwm-name').fill('Wolf hunt');
    await press(g, d.locator('[data-add="item"]'));
    await d.locator('[data-kind="item"] [data-f="pick"]').selectOption({ label: 'Health Potion (common)' });
    await press(g, d.locator('[data-add="boon"]'));
    await d.locator('[data-kind="boon"] [data-f="name"]').fill('One free reroll');
    await d.locator('[data-kind="boon"] [data-f="text"]').fill('Reroll one die, once this session.');
    await shot(g, 'maker-reward-filled');
    await press(g, d.locator('[data-apply]'));
    await d.waitFor({ state: 'detached' });
  });
  await step(g, 1, 'map maker', async () => {
    const d = page.locator('.mpm-overlay [role=dialog]');
    await go(g, 'workshop');
    await press(g, workshop('map').locator('[data-new]'));
    await d.locator('[data-name]').fill('Ash Crypt');
    for (let y = 2; y <= 8; y++) await press(g, d.locator(`[data-grid] [data-i="${y * 20 + 9}"]`));
    await press(g, d.locator('[data-brush="cover"]'));
    for (const x of [4, 5, 6]) await press(g, d.locator(`[data-grid] [data-i="${5 * 20 + x}"]`));
    await press(g, d.locator('[data-newzone]'));
    await d.locator('[data-zname]').fill('Burning ground');
    for (const x of [12, 13, 14]) await press(g, d.locator(`[data-grid] [data-i="${10 * 20 + x}"]`));
    await shot(g, 'maker-map');
    await press(g, d.locator('[data-apply]'));
    await d.waitFor({ state: 'detached' });
  });
  await step(g, 2, 'workshop filled', async () => {
    await waitToastGone(g);
    await go(g, 'workshop');
    await shot(g, 'workshop-filled-top');
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await shot(g, 'workshop-filled-bottom');
  });
  await step(g, 2, 'feats and the feat maker', async () => {
    const feats = workshop('feat'), d = page.locator('.fm-overlay [role=dialog]');
    await go(g, 'workshop');
    await press(g, feats.locator('.ws-built summary'));
    await show(feats, 'start');
    await shot(g, 'workshop-feats');
    await press(g, feats.locator('.ws-built li[data-id="iron-routine"] .ws-row'));
    await press(g, d.locator('[data-tadd]'));
    await show(d.locator('[data-test]').last());
    await shot(g, 'maker-feat-edit');
    await press(g, d.locator('[data-cancel]'));
    await d.waitFor({ state: 'detached' });
  });
  await step(g, 2, 'stories and the story maker', async () => {
    const stories = workshop('story'), d = page.locator('.stm-overlay [role=dialog]');
    await go(g, 'workshop');
    await press(g, stories.locator('[data-examples] summary'));
    await press(g, stories.locator('[data-examples] [data-act="example"]').first());
    await show(stories, 'start');
    await shot(g, 'workshop-stories');
    await press(g, stories.locator('li[data-id] .ws-row').first());
    await press(g, d.locator('[data-chopen="1"]'));
    await show(d.locator('[data-chopen="1"]'), 'start');
    await shot(g, 'maker-story-chapter');
    await press(g, d.locator('.mk-actions [data-cancel]'));
    await d.waitFor({ state: 'detached' });
  });
  await step(g, 4, 'the GM view\'s stories: the turn-on window, a running story\'s card, the open window', async () => {
    const sec = page.locator('#gm-stories'), w = page.locator('.st-ov [role=dialog]');
    await go(g, 'gm');
    const tog = page.locator('[data-tog="stories"]');
    if ((await tog.getAttribute('aria-expanded')) !== 'true') await press(g, tog);
    await show(sec, 'start');
    await press(g, sec.locator('[data-st-turnon]'));
    await shot(g, 'stories-turn-on');
    await press(g, w.locator('[data-st-story]').first());
    await press(g, w.locator('[data-st-who]').first());
    await shot(g, 'stories-turn-on-story');
    await press(g, w.locator('[data-st-go]'));
    await w.waitFor({ state: 'detached' });
    await closeWindows(g);
    await waitToastGone(g);
    await show(sec, 'start');
    await shot(g, 'stories-card');
    await press(g, sec.locator('[data-st-open]'));
    await shot(g, 'stories-open');
    await press(g, w.locator('[data-st-cancel]'));
    await w.waitFor({ state: 'detached' });
  });
}

async function gmAward(g: Phone, p: Phone | null) {
  const page = g.page;
  await step(g, 4, 'award form', async () => {
    const ed = page.locator('#gm-rw');
    await go(g, 'gm');
    await shot(g, 'gm-view-board');
    const toggle = page.locator('[data-tog="award"]');
    if ((await toggle.getAttribute('aria-expanded')) !== 'true') await press(g, toggle);
    await page.fill('#gm-xp', '100');
    await press(g, ed.locator('[data-add="item"]'));
    await ed.locator('[data-kind="item"] [data-f="pick"]').selectOption({ label: 'Bottled Storm (common)' }).catch(async () => {
      await ed.locator('[data-kind="item"] [data-f="pick"]').selectOption({ index: 1 });
    });
    await ed.locator('[data-kind="item"] [data-f="tell"]').check();
    await press(g, ed.locator('[data-add="title"]'));
    await ed.locator('[data-kind="title"] [data-f="name"]').fill('Wolf Slayer');
    await ed.locator('[data-kind="title"] [data-bonus="str"]').fill('2');
    await press(g, ed.locator('[data-add="boon"]'));
    await ed.locator('[data-kind="boon"] [data-f="name"]').fill('One free reroll');
    await ed.locator('[data-kind="boon"] [data-f="text"]').fill('Reroll one die, once this session.');
    await show(ed, 'start');
    await shot(g, 'award-form-editor');
    await press(g, page.locator('#gm-targets label', { hasText: HUNTER }));
    await show(page.locator('#gm-award-go'), 'end');
    await page.evaluate(() => window.scrollBy(0, 400));
    await shot(g, 'award-form-bottom');
    await press(g, page.locator('#gm-award-go'));
    await page.locator('#gm-award-msg', { hasText: /Sent to|Not sent|need a room|needs a room|Select|Finish|Add something/ }).waitFor();
    await shot(g, 'award-sent');
  });
  await step(g, 2, 'give shelf', async () => {
    await go(g, 'gm');
    await press(g, page.locator('#gm-board .gm-card [data-ggive]').first());
    const shelf = page.locator('.sys-overlay.show.gs-ov');
    await shelf.waitFor();
    await shot(g, 'give-shelf');
    await press(g, shelf.locator('[data-gs-chip="lie"]'));
    await shot(g, 'give-shelf-moment');
    await press(g, shelf.locator('[data-gs-cancel]'));
    await shelf.waitFor({ state: 'detached' });
  });
  if (p) {
    await step(p, 1, 'reward arriving', async () => {
      await p.page.locator('.sys-overlay.show', { hasText: 'REWARD RECEIVED' }).waitFor({ timeout: 20_000 });
      await shot(p, 'reward-received');
    });
    await closeWindows(p, 6);
  }
}

async function gmQuests(g: Phone, p: Phone | null) {
  const page = g.page;
  await step(g, 2, 'quest form', async () => {
    await go(g, 'quests');
    await shot(g, 'quests-gm');
    await press(g, page.locator('#view-quests [data-new]'));
    await page.locator('#view-quests form [name=title]').fill('Clear the sewer');
    await show(page.locator('#view-quests form'), 'start');
    await shot(g, 'quest-form');
    await pressIfShown(g, '#view-quests form [data-cancel], #view-quests form button[type=button]:has-text("Cancel")');
  });
  await step(g, 0, 'job change issue', async () => {
    await go(g, 'quests');
    await press(g, page.locator('#view-quests [data-chain]'));
    await answer(g, 'Issue to', `${HUNTER} (player)`);
    await answer(g, 'Choose the job', 'Ranger');
  });
  if (p) {
    await step(p, 1, 'job change arriving', async () => {
      await p.page.locator('.sys-overlay.show', { hasText: 'JOB CHANGE QUEST' }).waitFor({ timeout: 20_000 });
      await shot(p, 'job-change-received');
    });
    await closeWindows(p, 4);
  }
}

async function gmGates(g: Phone) {
  const page = g.page;
  await step(g, 3, 'gates', async () => {
    await go(g, 'gates');
    await shot(g, 'gates');
    const card = page.locator('#view-gates .gate').filter({ has: page.locator('.gt-name').getByText('Goblin Den', { exact: true }) });
    await press(g, card.locator('[data-act=edit]'));
    await page.locator('.gt-panel[data-form=edit]').waitFor();
    await show(page.locator('.gt-panel[data-form=edit]'), 'start');
    await shot(g, 'gate-edit-form');
    await press(g, page.locator('#view-gates [data-act=cancel-panel]'));
    await show(page.locator('#view-gates .gt-spawn'), 'center');
    await shot(g, 'gate-spawn-form');
  });
  await step(g, 1, 'bestiary', async () => { await go(g, 'bestiary'); await shot(g, 'bestiary'); });
}

async function gmFight(g: Phone, p: Phone | null) {
  const page = g.page, combat = page.locator('#view-combat');
  const row = (name: string) => combat.locator('.cmb-row', { hasText: name }).first();
  const pick = async (name: string) => { await show(row(name).locator('[data-pick]')); await press(g, row(name).locator('[data-pick]')); await combat.locator('.cmb-card h3', { hasText: name }).waitFor(); };
  // the list's steps first: the map is the default view, and its own steps come after
  await page.evaluate(() => (window as any).hunterApp.store.setPrefs({ fightView: 'list' }));
  await step(g, 1, 'combat empty', async () => { await go(g, 'combat'); await shot(g, 'combat-empty'); });
  await step(g, 1, 'fight being built', async () => {
    await go(g, 'combat');
    await combat.locator('[data-hsel]').selectOption({ label: `${HUNTER} (remote)` });
    await press(g, combat.locator('[data-addh]'));
    await row(HUNTER).waitFor();
    const warden = await page.evaluate(() => (window as any).hunterApp.api.bestiary.list().find((m: any) => m.name === 'Ice Warden')?.id as string);
    await combat.locator('[data-msel]').selectOption(warden);
    await press(g, combat.locator('[data-addm]'));
    await row('Ice Warden').waitFor();
    await combat.locator('[data-qline]').fill('Cave Rat x2, E, skirmisher');
    await press(g, combat.locator('[data-qadd]'));
    await row('Cave Rat').waitFor();
    await shot(g, 'combat-building');
  });
  await step(g, 2, 'status applied', async () => {
    await pick(HUNTER);
    await show(combat.locator('.cmb-card [data-cforge]'));
    await press(g, combat.locator('.cmb-card [data-cforge]'));
    const dlg = page.locator('.fg-overlay');
    await dlg.locator('[data-existing] [data-chip]').first().waitFor();
    await shot(g, 'status-dialog-existing');
    await press(g, dlg.locator('[data-existing] [data-chip="poisoned"]'));
    await dlg.waitFor({ state: 'detached' });
    await shot(g, 'status-dialog-picked');
  });
  if (p) await closeWindows(p, 4);
  await step(g, 2, 'running fight', async () => {
    await show(combat.locator('[data-start]'));
    await press(g, combat.locator('[data-start]'));
    await combat.locator('[data-ahead]').first().waitFor();
    await closeWindows(g, 3);
    await page.evaluate(() => window.scrollTo(0, 0));
    await shot(g, 'combat-running');
    await pick('Ice Warden');
    await show(combat.locator('.cmb-card'), 'start');
    await shot(g, 'combat-monster-card');
  });
  await step(g, 2, 'move control and target picker', async () => {
    const turn = combat.locator('.cmb-card.turn');
    // the card shows the row picked last (the Ice Warden), so each turn the current row is picked first: the move control
    // is on the card of a row of this phone whose turn it is
    for (let i = 0; i < 12; i++) {
      await press(g, combat.locator('.cmb-row.cur [data-pick]'));
      if (await turn.locator('[data-toward]').count()) break;
      await press(g, combat.locator('[data-next]'));
    }
    await show(turn.locator('[data-toward]'));
    await shot(g, 'combat-move-control');
    // a monster's attack reaches the remote hunter from the default lines (8 tiles; a Shot 12, a Curse 8), so no step first
    await show(turn.locator('[data-ab]'));
    await press(g, turn.locator('[data-ab]'));
    await page.locator('.sys-overlay.show').waitFor();
    await shot(g, 'skill-target-picker');
    await closeWindows(g, 1);
  });
  await step(g, 2, 'the battle map', async () => {
    await show(combat.locator('[data-fview="map"]'));
    await press(g, combat.locator('[data-fview="map"]'));
    const map = combat.locator('[data-mapbox]');
    await map.locator('.mp-tok').first().waitFor();
    await show(map.locator('[data-frame]'), 'start');
    await shot(g, 'combat-map');
    const hot = map.locator('[data-hot] .mp-hb').first();
    if (await hot.count()) { await press(g, hot); await shot(g, 'combat-map-aiming'); await press(g, hot); }
  });
  await step(g, 2, 'the map\'s Fight tools and a monster\'s card with its extras', async () => {
    const map = combat.locator('[data-mapbox]');
    // the Ice Warden announces its first ability at the remote hunter, revealed, so the card and the map draw an intent
    await page.evaluate(name => (window as any).hunterApp.store.update((d: any) => {
      const w = d.fight.rows.find((r: any) => r.name === 'Ice Warden'), h = d.fight.rows.find((r: any) => r.name === name);
      if (w && h) w.intent = { ability: w.abilities[0].id, aim: h.id, revealed: true };
    }, 'ui-shots'), HUNTER);
    await press(g, combat.locator('[data-tools-open]'));
    await combat.locator('.cmb-tools.open').waitFor();
    await shot(g, 'combat-map-tools');
    await press(g, combat.locator('[data-toolsx]'));
    const warden = await page.evaluate(() => (window as any).hunterApp.store.get().fight.rows.find((r: any) => r.name === 'Ice Warden').id as string);
    await press(g, map.locator(`[data-tok="${warden}"]`));
    await combat.locator('.cmb-card h3', { hasText: 'Ice Warden' }).waitFor();
    await shot(g, 'combat-map-monster-card');
    await press(g, combat.locator('[data-fview="list"]'));
  });
  if (p) {
    await step(p, 2, 'player side of the fight', async () => {
      await closeWindows(p, 4);
      await go(p, 'status');
      await p.page.locator('#view-status .tb-banner').waitFor({ timeout: 15_000 });
      await shot(p, 'fight-status-banner');
      await p.page.evaluate(() => (window as any).hunterApp.store.setPrefs({ fightView: 'list' }));
      await go(p, 'combat');
      await p.page.locator('#view-combat .tb-row').first().waitFor({ timeout: 15_000 });
      await shot(p, 'fight-combat-hud');
    });
  }
  await step(g, 1, 'the map with walls, a field and the fog', async () => {
    await page.evaluate(() => (window as any).hunterApp.store.update((d: any) => {
      const f = d.fight, { w, h } = f.grid, wall = (x: number, y: number) => x === 4 && y >= 1 && y <= 4;
      f.grid = { w, h, tiles: Array.from({ length: w * h }, (_, i) => { const x = i % w, y = Math.floor(i / w); return wall(x, y) ? 'wall' : y === 6 && x >= 3 && x <= 5 ? 'cover' : 'floor'; }) };
      f.zones = [{ id: 'z-shots', name: 'Burning ground', ground: { kind: 'tiles', tiles: [{ x: 3, y: 9 }, { x: 4, y: 9 }, { x: 3, y: 10 }, { x: 4, y: 10 }] }, owner: null, spares: null, tier: 0, until: null, endsWithOwner: false,
        ops: [{ op: 'damage', type: 'magical', amount: { kind: 'number', value: 3 } }] }];
      // the party saw the right of the map once (remembered, dim) and never the rest it cannot see now (mist)
      f.fog = { sight: 8, seen: Array.from({ length: w * h }, (_, i) => (i % w >= 12 ? '1' : '0')).join('') };
    }, 'ui-shots'));
    await press(g, combat.locator('[data-fview="map"]'));
    const map = combat.locator('[data-mapbox]');
    await map.locator('.mp-t.wall').first().waitFor();
    await show(map.locator('[data-frame]'), 'start');
    await shot(g, 'combat-map-ground');
    // the steps after this one drive the list
    await press(g, combat.locator('[data-fview="list"]'));
  });
  if (p) {
    await step(p, 1, 'the player\'s map with walls and the fog', async () => {
      await p.page.evaluate(() => (window as any).hunterApp.store.setPrefs({ fightView: 'map' }));
      await go(p, 'combat');
      await p.page.locator('#view-combat [data-mapbox] .mp-fog path').first().waitFor({ state: 'attached', timeout: 15_000 });
      await shot(p, 'fight-map-ground');
    });
  }
  await step(g, 2, 'fight end with loot', async () => {
    for (const name of ['Ice Warden', 'Cave Rat A', 'Cave Rat B']) {
      await pick(name);
      await press(g, combat.locator('.cmb-card [data-defeat]'));
      await closeWindows(g, 2);
    }
    await show(combat.locator('[data-end]'));
    await press(g, combat.locator('[data-end]'));
    await page.locator('.sys-overlay.show', { hasText: 'Fight over' }).waitFor();
    await shot(g, 'fight-end');
    await answer(g, 'Fight over', 'End without XP');
    await page.locator('.sys-overlay.show', { hasText: 'Loot dropped' }).waitFor();
    await shot(g, 'fight-loot');
    await answer(g, 'Loot dropped', 'Later');
  });
}

async function gmRest(g: Phone, p: Phone | null) {
  const page = g.page;
  if (p) {
    await step(p, 2, 'boon on the sheet and redeem', async () => {
      await closeWindows(p, 4);
      await go(p, 'status');
      await show(p.page.locator('[data-panel="titles"] [data-boons]'));
      await shot(p, 'sheet-boon');
      await press(p, p.page.locator('[data-panel="titles"] [data-redeem]'));
      await p.page.locator('.sys-overlay.show', { hasText: 'Redeem' }).waitFor();
      await shot(p, 'boon-redeem-confirm');
      await answer(p, /Redeem One free reroll/, 'Redeem');
    });
  }
  await step(g, 2, 'reward uses and log', async () => {
    if (p) await page.locator('#toasts .toast', { hasText: 'used Boon' }).waitFor({ timeout: 20_000 });
    await go(g, 'gm');
    await shot(g, 'gm-view-use-toast');
    await press(g, page.locator('#gm-uses-go'));
    await page.locator('#gm-l-list li').first().waitFor();
    await show(page.locator('#gm-l-list'));
    await shot(g, 'session-log-uses');
  });
  await step(g, 2, 'json rules editor and rest of gm view', async () => {
    await go(g, 'gm');
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await shot(g, 'gm-view-bottom');
    const tog = page.locator('[data-tog="rules"]');
    if ((await tog.getAttribute('aria-expanded')) !== 'true') await press(g, tog);
    await show(page.locator('#gm-r-text'));
    await shot(g, 'rules-json-editor');
  });
  await step(g, 2, 'share code and data', async () => {
    await waitToastGone(g);
    await go(g, 'data');
    await shot(g, 'data-view');
    await press(g, page.locator('#view-data [data-share]'));
    await answer(g, 'Share custom content', 'Everything');
    await answer(g, 'Share as', 'Show a code');
    await page.locator('.sys-overlay.show [data-pack-code]').waitFor();
    await page.waitForTimeout(500);
    await shot(g, 'share-code');
    await answer(g, 'Share code', 'Close');
  });
  await step(g, 1, 'rules reference', async () => { await go(g, 'rules'); await shot(g, 'rules-reference'); });
  await step(g, 1, 'shadows', async () => { await go(g, 'shadows'); await shot(g, 'shadows'); });
  await step(g, 1, 'dice', async () => { await go(g, 'dice'); await shot(g, 'dice'); });
  await step(g, 1, 'room view', async () => { await go(g, 'room'); await shot(g, 'room-view-gm'); });
  await step(g, 1, 'more menu', async () => {
    if (!(await page.locator('#more-btn').isVisible())) { await shot(g, 'more-menu-not-shown'); return; }
    await press(g, page.locator('#more-btn'));
    await page.locator('.sys-overlay.show', { hasText: 'More' }).waitFor();
    await shot(g, 'more-menu');
    await closeWindows(g, 1);
  });
}

/** The player's own screens, after the room part. */
async function playerScreens(p: Phone) {
  const page = p.page, status = page.locator('#view-status');
  await step(p, 3, 'status sheet', async () => {
    await go(p, 'status');
    await shot(p, 'status-top');
    await show(status.locator('[data-panel="attributes"]'), 'start');
    await shot(p, 'status-attributes');
    await show(status.locator('[data-panel="skills"]'), 'start');
    await shot(p, 'status-skills');
  });
  await step(p, 2, 'inventory and use', async () => {
    await go(p, 'status');
    await show(status.locator('[data-panel="inventory"]'), 'start');
    await shot(p, 'inventory');
    await press(p, status.locator('[data-panel="inventory"] [data-use]'));
    await page.locator('.sys-overlay.show, #toasts .toast').first().waitFor();
    await shot(p, 'inventory-use-window');
    await closeWindows(p, 3);
  });
  await step(p, 2, 'quests', async () => {
    await go(p, 'quests');
    await shot(p, 'quests-active-job-step');
    await press(p, page.locator('#view-quests [data-tab="daily"]'));
    await shot(p, 'quests-daily');
  });
  await step(p, 1, 'quest reward window', async () => {
    await go(p, 'quests');
    await press(p, page.locator('#view-quests [data-tab="daily"]'));
    await press(p, page.locator('#view-quests [data-done]'));
    await page.locator('.sys-overlay.show').waitFor();
    await shot(p, 'quest-reward-window');
    await closeWindows(p, 4);
  });
  await step(p, 2, 'solo gates', async () => {
    await go(p, 'gates');
    const card = page.locator('#view-gates .gate.solo').first();
    await card.waitFor();
    await shot(p, 'gates-solo');
    await press(p, card.locator('[data-odds-ask]'));
    await card.locator('[data-oddsline]').waitFor({ timeout: 60_000 });
    await shot(p, 'gates-solo-odds');
  });
  await step(p, 2, 'dice', async () => {
    await go(p, 'status');
    await press(p, page.locator('#nav-bottom a[href="#/dice"]'));
    await page.waitForTimeout(300);
    await shot(p, 'dice-quick-sheet');
    await go(p, 'dice');
    await shot(p, 'dice-view');
  });
  await step(p, 1, 'more menu', async () => {
    await go(p, 'status');
    await press(p, page.locator('#more-btn'));
    await page.locator('.sys-overlay.show', { hasText: 'More' }).waitFor();
    await shot(p, 'more-menu');
    await closeWindows(p, 1);
  });
  for (const v of ['gates', 'bestiary', 'rules', 'room', 'device', 'data']) {
    await step(p, 1, `more ${v}`, async () => { await go(p, v); await shot(p, `more-${v}`); });
  }
  await step(p, 1, 'room pill', async () => {
    await go(p, 'status');
    await page.locator('#sync-pill button').waitFor();
    await press(p, page.locator('#sync-pill button'));
    await page.locator('#view-room').waitFor({ state: 'visible' });
    await shot(p, 'room-view-from-pill');
  });
  await step(p, 3, 'dying, a chip card and dead', async () => {
    await go(p, 'status');
    await page.evaluate(() => (window as any).hunterApp.store.update(() => { (window as any).hunterApp.store.active().life = { at: 'dying', successes: 1, failures: 1 }; }, 'shot-setup'));
    await status.locator('[data-chips] [data-chip]').first().waitFor();
    await show(status.locator('[data-death]'), 'center');
    await shot(p, 'hunter-dying');
    await press(p, status.locator('[data-chips] [data-chip]').first());
    await status.locator('[data-chips] .dt').first().waitFor({ state: 'visible' });
    await shot(p, 'status-chip-card');
    await page.evaluate(() => (window as any).hunterApp.store.update(() => { (window as any).hunterApp.store.active().life = { at: 'dead' }; }, 'shot-setup'));
    await status.locator('[data-chips] [data-chip="dead"]').waitFor();
    await page.evaluate(() => window.scrollTo(0, 0));
    await shot(p, 'hunter-dead');
  });
  await step(p, 2, 'room left', async () => {
    await go(p, 'room');
    await press(p, page.locator('#view-room [data-leave]'));
    await page.locator('#view-room [data-code]').first().waitFor({ state: 'visible' });
    await page.evaluate(() => window.scrollTo(0, 0));
    await shot(p, 'room-view-out-of-room');
    await go(p, 'status');
    await shot(p, 'status-out-of-room');
  });
  await step(p, 2, 'penalized', async () => {
    await page.evaluate(() => (window as any).hunterApp.store.update(() => { const h = (window as any).hunterApp.store.active(); h.life = { at: 'up', hp: 5 }; h.daily.lastCheckedKey = '2000-01-01'; }, 'shot-setup'));
    await page.locator('.sys-overlay.show .sys-window', { hasText: 'Penalty Zone' }).first().waitFor();
    await shot(p, 'penalty-zone-window');
    await closeWindows(p, 6);
    await go(p, 'status');
    await status.locator('[data-chips] [data-chip="penalized"]').waitFor();
    await shot(p, 'status-penalized');
  });
}

async function pass(browser: Browser, url: string, gmSize: Size, gmTouch: boolean, gmPrefix: string, playerShots: boolean) {
  const g = await device(browser, gmSize, gmTouch, gmPrefix);
  const p = await device(browser, { width: 360, height: 780 }, true, 'player-360');
  try {
    const code = await gmStart(g, url);
    await playerJoin(p, url, code, playerShots);
    await g.page.locator('#gm-board .gm-card.remote', { hasText: HUNTER }).waitFor({ timeout: 20_000 });
    const pl = playerShots ? p : null;
    if (pl) await step(p, 1, 'status in a live room', async () => { await go(p, 'status'); await p.page.locator('#sync-pill').waitFor(); await shot(p, 'status-live-room'); });
    await gmMakers(g);
    await gmAward(g, pl);
    await probe(p, 'after award');
    if (!pl) await closeWindows(p, 6);
    await gmQuests(g, pl);
    if (!pl) await closeWindows(p, 4);
    await probe(p, 'after quests');
    await gmGates(g);
    await gmFight(g, pl);
    await p.page.locator('#toasts .toast', { hasText: /Monster info unlocked/ }).first().waitFor({ timeout: 15_000 }).catch(() => {});
    await closeWindows(p, 6);
    await probe(p, 'after fight');
    if (!pl) {
      await go(p, 'status');
      for (let i = 0; i < 6; i++) {
        await closeWindows(p, 6);
        if (await p.page.locator('[data-panel="titles"] [data-redeem]').first().tap({ timeout: 3000 }).then(() => true, () => false)) break;
      }
      await answer(p, /Redeem One free reroll/, 'Redeem');
    }
    await gmRest(g, pl);
    if (pl) await playerScreens(p);
  } finally {
    for (const [who, d] of [['gm', g], ['player', p]] as const) {
      const errs = d.errors.filter(e => !/Failed to load resource/.test(e));
      if (errs.length) console.log(`${gmPrefix} ${who} console errors:\n  ${errs.slice(0, 5).join('\n  ')}`);
    }
    await g.ctx.close();
    await p.ctx.close();
  }
}

/** `bun server.ts` on `port` in its own process group, once its health check answers; `stop` ends it and what it started. */
async function serve(port: number): Promise<{ url: string; stop(): void }> {
  const child = spawn('bun', ['server.ts'], { env: { ...process.env, PORT: String(port) }, stdio: 'ignore', detached: true });
  const stop = () => { try { if (child.pid) process.kill(-child.pid, 'SIGTERM'); } catch { /* already gone */ } };
  const url = `http://localhost:${port}`;
  for (let i = 0; i < 240; i++) {
    if (await fetch(`${url}/api/health`).then(r => r.ok, () => false)) return { url, stop };
    await new Promise(r => setTimeout(r, 250));
  }
  stop();
  throw new Error(`the server on ${port} did not answer its health check in 60 s`);
}

async function main() {
  const port = arg('--serve'), out = arg('--out');
  if ((!arg('--url') && !port) || !out) throw new Error('usage: (--url URL | --serve PORT) --out DIR');
  OUT = out;
  mkdirSync(out, { recursive: true });
  const server = port ? await serve(Number(port)) : null;
  const url = server ? server.url : String(arg('--url'));
  const browser = await chromium.launch(launchOptions());
  try {
    await pass(browser, url, { width: 1280, height: 800 }, false, 'gm-1280', true);
    await pass(browser, url, { width: 390, height: 844 }, true, 'gm-390', false);
  } finally {
    await browser.close();
    server?.stop();
  }
  console.log(`${written.length} shots in ${out}`);
  if (failures.length) {
    console.log(`${failures.length} steps failed:\n  ${failures.join('\n  ')}`);
    process.exit(1);
  }
}

await main();
