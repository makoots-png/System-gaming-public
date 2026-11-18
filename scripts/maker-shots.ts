// Screenshots of the customization screens at phone size, for the report.
//   PORT=3260 bun server.ts &
//   E2E_CHROMIUM=/opt/pw-browsers/chromium bun scripts/maker-shots.ts --url http://localhost:3260 --out docs/agent-handoff/cz/shots
// Two phones, as in tests/e2e/used.e2e.ts and tests/e2e/reward-room.e2e.ts: a GM who opens a room and a player who joins it.
// The GM makes a status, an item, a skill and an enemy through the makers, builds a reward and sends it; the player redeems the
// boon. The selectors are the ones tests/e2e/makers.e2e.ts, used.e2e.ts, reward-room.e2e.ts and sharing.e2e.ts use.
// A shot is the screen at 390 by 844 (not full page): a window is laid out for the screen.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, type Browser, type BrowserContext, type LaunchOptions, type Locator, type Page } from '@playwright/test';

const arg = (name: string): string | undefined => { const i = process.argv.indexOf(name); return i < 0 ? undefined : process.argv[i + 1]; };
const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const PHONE = { width: 390, height: 844 };
const launchOptions = (): LaunchOptions => (process.env.E2E_CHROMIUM ? { executablePath: process.env.E2E_CHROMIUM } : {});

async function settle(page: Page) {
  await page.evaluate(() => new Promise<void>(r => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
}

async function tapIfShown(page: Page, sel: string): Promise<boolean> {
  const t = page.locator(sel).first();
  if (!(await t.count()) || !(await t.isVisible())) return false;
  await t.tap();
  await page.waitForTimeout(300);
  return true;
}

async function dismissAll(page: Page, max = 12) {
  for (let i = 0; i < max; i++) {
    if (await tapIfShown(page, '.sys-overlay.show .primary')) continue;
    if (await tapIfShown(page, '.sys-overlay.show button:not(.confirm-all):not([hidden])')) continue;
    if (await tapIfShown(page, '.ob-overlay [data-ok]')) continue;
    if (await tapIfShown(page, '.ob-overlay [data-skip]')) continue;
    break;
  }
}

async function answerWindow(page: Page, title: string | RegExp, label?: string) {
  const win = page.locator('.sys-overlay.show', { hasText: title });
  await win.waitFor({ state: 'visible' });
  await (label ? win.locator('.sys-actions button', { hasText: label }) : win.locator('.sys-actions button.primary, .sys-actions button:only-child')).first().tap();
  await win.waitFor({ state: 'detached' });
}

async function go(page: Page, view: string) {
  await page.evaluate(v => (window as any).hunterApp.go(v), view);
  await page.waitForTimeout(300);
}

async function openApp(page: Page, url: string) {
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => (window as any).hunterApp && document.querySelectorAll('#nav-top a').length > 0, null, { timeout: 15_000 });
}

async function phone(browser: Browser): Promise<{ ctx: BrowserContext; page: Page; errors: string[] }> {
  const ctx = await browser.newContext({ viewport: PHONE, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: IPHONE_UA, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  page.setDefaultTimeout(10_000);
  const errors: string[] = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push(String(e)));
  return { ctx, page, errors };
}

async function shot(page: Page, out: string, name: string) {
  await settle(page);
  await page.screenshot({ path: join(out, name) });
  console.log(`wrote ${name}`);
}

/** Scrolls a locator to the middle of the screen (or of its own scrolling window). */
async function show(l: Locator, block: 'start' | 'center' | 'end' = 'center') {
  await l.evaluate((el, b) => el.scrollIntoView({ block: b as ScrollLogicalPosition }), block);
}

async function main() {
  const url = arg('--url'), out = arg('--out');
  if (!url || !out) throw new Error('usage: --url URL --out DIR');
  mkdirSync(out, { recursive: true });
  const browser = await chromium.launch(launchOptions());
  const gm = await phone(browser), pl = await phone(browser);
  const g = gm.page, p = pl.page;
  const workshop = (kind: string) => g.locator(`#view-workshop [data-ws="${kind}"]`);
  const HUNTER = 'Mira Test';

  try {
    await openApp(g, url);
    for (const step of ['[data-yes]', '[data-gm]', '[data-starter]', '[data-oblater]']) await tapIfShown(g, `.ob-overlay ${step}`);
    await g.waitForTimeout(500);
    await dismissAll(g);

    await go(g, 'gm');
    await g.locator('[data-gmcreate]').tap();
    const shown = g.locator('[data-gmroomcode]');
    await g.waitForFunction(() => /^[A-HJ-NP-Z2-9]{6}$/.test((document.querySelector('[data-gmroomcode]')?.textContent ?? '').trim()));
    const code = ((await shown.textContent()) ?? '').trim();

    await openApp(p, url);
    await tapIfShown(p, '.ob-overlay [data-yes]');
    await tapIfShown(p, '.ob-overlay [data-player]');
    await p.fill('.ob-overlay [data-name]', HUNTER);
    await p.fill('.ob-overlay [data-room]', code);
    await tapIfShown(p, '.ob-overlay [data-go]');
    await p.locator('.ob-overlay [data-obsheet]').waitFor();
    await tapIfShown(p, '.ob-overlay [data-obsheet]');
    await p.waitForTimeout(500);
    await dismissAll(p, 4);
    await go(g, 'gm');
    await g.locator('#gm-board .gm-card.remote', { hasText: HUNTER }).waitFor({ timeout: 20_000 });

    // The status maker: Frostbite, 1d6 a turn, by rank, S changed to 9d12.
    {
      const d = g.locator('.fg-overlay [role=dialog]');
      await go(g, 'workshop');
      await workshop('status').locator('[data-new]').tap();
      await d.locator('[data-name]').fill('Frostbite');
      await d.locator('[data-quick] [data-q="d6"]').tap();
      await d.locator('[data-row="0"] [data-mode="rank"]').tap();
      await d.locator('[data-row="0"] [data-t]').nth(5).fill('9d12');
      await show(d.locator('.mk-preview'), 'end');
      await shot(g, out, 'status-maker-by-rank.png');
      await d.locator('[data-apply]').tap();
      await d.waitFor({ state: 'detached' });
    }

    // The item maker: Bottled Storm, a consumable on a target, 2d6 damage, Bleeding, and "Tell me when it is used".
    {
      const d = g.locator('.lf-overlay [role=dialog]');
      await workshop('item').locator('[data-new]').tap();
      await d.locator('#lf-name').fill('Bottled Storm');
      await d.locator('[data-chips="type"] [data-chip="consumable"]').tap();
      await d.locator('[data-quick] [data-q="damage"]').tap();
      await d.locator('[data-quick] [data-q="apply"]').tap();
      await d.locator('[data-chips="target"] [data-chip="other"]').tap();
      await d.locator('#lf-tell').check();
      await show(d.locator('#lf-tell'), 'end');
      await shot(g, out, 'item-maker-target-and-tell.png');
      await d.locator('[data-apply]').tap();
      await d.waitFor({ state: 'detached' });
    }

    // The skill maker: Frost Lance, on a target, rolls to hit, 2d8 damage by rank (4d8 at C), Slowed for 2 rounds.
    {
      const d = g.locator('.skm-overlay [role=dialog]');
      await workshop('skill').locator('[data-new]').tap();
      await d.locator('#skm-name').fill('Frost Lance');
      await d.locator('[data-chips="target"] [data-chip="other"]').tap();
      await d.locator('#skm-attack').check();
      await d.locator('[data-quick] [data-q="damage"]').tap();
      await d.locator('[data-row="0"] [data-f="q"]').fill('2d8');
      await d.locator('[data-row="0"] [data-mode="rank"]').tap();
      await d.locator('[data-row="0"] [data-t="2"]').fill('4d8');
      await d.locator('[data-quick] [data-q="apply"]').tap();
      await d.locator('[data-row="1"] [data-f="status"]').selectOption('slowed');
      await d.locator('[data-row="1"] [data-f="rounds"]').fill('2');
      await show(d.locator('.mk-preview'), 'end');
      await shot(g, out, 'skill-maker-preview.png');
      await d.locator('[data-apply]').tap();
      await d.waitFor({ state: 'detached' });
      await dismissAll(g, 3);
    }

    // The enemy maker: Ice Warden, rank C, Frost Lance, Hasted at the start, 50 gold and a Bottled Storm.
    {
      const d = g.locator('.enm-overlay [role=dialog]');
      const ids = await g.evaluate(() => { const s = (window as any).hunterApp.store.get(); return { skill: s.library.skills.find((k: any) => k.name === 'Frost Lance').id as string, item: s.library.items.find((i: any) => i.name === 'Bottled Storm').id as string }; });
      await go(g, 'bestiary');
      await g.locator('#view-bestiary [data-new]').tap();
      await d.locator('#enm-name').fill('Ice Warden');
      await d.locator('[data-chips="rank"] [data-chip="C"]').tap();
      await d.locator('[data-add="skill"]').selectOption(`lib:${ids.skill}`);
      await d.locator('[data-add="status"]').selectOption('hasted');
      await d.locator('#enm-gold').fill('50');
      await d.locator('[data-add="item"]').selectOption(`lib:${ids.item}`);
      await show(d.locator('.mk-preview'), 'end');
      await shot(g, out, 'enemy-maker-skill-status-loot.png');
      await d.locator('[data-apply]').tap();
      await d.waitFor({ state: 'detached' });
    }

    // The Workshop, with one of each kind in it.
    await go(g, 'workshop');
    await g.evaluate(() => window.scrollTo(0, 0));
    await shot(g, out, 'workshop.png');

    // The reward editor in the Award form: 100 XP, a Health Potion marked "Tell me when used", a title, Hasted and a boon.
    {
      const ed = g.locator('#gm-rw');
      await go(g, 'gm');
      const toggle = g.locator('[data-tog="award"]');
      if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.tap();
      await g.fill('#gm-xp', '100');
      await ed.locator('[data-add="item"]').tap();
      await ed.locator('[data-kind="item"] [data-f="pick"]').selectOption({ label: 'Health Potion (common)' });
      await ed.locator('[data-kind="item"] [data-f="tell"]').check();
      await ed.locator('[data-add="title"]').tap();
      await ed.locator('[data-kind="title"] [data-f="name"]').fill('Wolf Slayer');
      await ed.locator('[data-kind="title"] [data-bonus="str"]').fill('2');
      await ed.locator('[data-add="status"]').tap();
      await ed.locator('[data-kind="status"] [data-f="key"]').selectOption({ label: 'Hasted' });
      await ed.locator('[data-add="boon"]').tap();
      await ed.locator('[data-kind="boon"] [data-f="name"]').fill('One free reroll');
      await ed.locator('[data-kind="boon"] [data-f="text"]').fill('Reroll one die, once this session.');
      await show(ed.locator('.rw-preview'), 'end');
      await shot(g, out, 'reward-editor-item-title-boon.png');

      await g.locator('#gm-targets label', { hasText: HUNTER }).tap();
      await g.locator('#gm-award-go').tap();
      await p.locator('.sys-overlay.show', { hasText: 'REWARD RECEIVED' }).waitFor({ timeout: 20_000 });
      await dismissAll(p, 6);
    }

    // The player's sheet: the boon and its Redeem button.
    await go(p, 'status');
    await show(p.locator('[data-panel="titles"] [data-boons]'), 'center');
    await shot(p, out, 'player-sheet-boon-redeem.png');

    // The player redeems it; the GM's Reward uses shows one line.
    await p.locator('[data-panel="titles"] [data-redeem]').tap();
    await answerWindow(p, 'Redeem One free reroll?', 'Redeem');
    await g.locator('#toasts .toast', { hasText: 'used Boon: One free reroll' }).waitFor({ timeout: 20_000 });
    await go(g, 'gm');
    await g.locator('#gm-uses-go').tap();
    await g.locator('#gm-l-list li').first().waitFor();
    await show(g.locator('#gm-l-list'), 'center');
    await shot(g, out, 'gm-reward-uses.png');

    // The Share code box: everything the GM made, as a code.
    await go(g, 'data');
    await g.locator('#view-data [data-share]').tap();
    await answerWindow(g, 'Share custom content', 'Everything');
    await answerWindow(g, 'Share as', 'Show a code');
    await g.locator('.sys-overlay.show [data-pack-code]').waitFor();
    await g.waitForTimeout(800);
    await shot(g, out, 'share-code.png');
  } finally {
    const errs = [...gm.errors.map(e => `gm: ${e}`), ...pl.errors.map(e => `player: ${e}`)];
    if (errs.length) console.log(`console errors:\n${errs.join('\n')}`);
    await gm.ctx.close();
    await pl.ctx.close();
    await browser.close();
  }
}

await main();
