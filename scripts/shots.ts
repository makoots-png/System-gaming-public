// Screenshots of the same screens at three phone sizes, and a pixel comparison of two runs.
//   bun scripts/shots.ts --url http://localhost:3000 --out /tmp/shots/branch
//   bun scripts/shots.ts --compare /tmp/shots/main /tmp/shots/branch --report /tmp/shots/report.json
// Both versions start from the same seeded v2 save (the branch migrates it at load; the old app reads it as it is).
// The fight and the open panels are built by tapping, the same taps on both versions.
// A window is shot at the size of the screen (not full page): the window is laid out for the screen, so a taller capture would draw it differently.
// Options: --mask  extra CSS selectors to paint over (comma separated)
//          --threshold  share of pixels (default 0.001) above which a diff image is written in --compare
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, type Browser, type LaunchOptions, type Page } from '@playwright/test';

const arg = (name: string): string | undefined => { const i = process.argv.indexOf(name); return i < 0 ? undefined : process.argv[i + 1]; };
const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const SIZES = { phone: { width: 390, height: 844 }, small: { width: 360, height: 780 }, landscape: { width: 844, height: 390 } };
const NOW = new Date('2026-11-10T12:30:00.000Z');
const FIXTURE = join(import.meta.dir, '..', 'tests', 'fixtures', 'saves', 'main-gm-starter.json');
const launchOptions = (): LaunchOptions => (process.env.E2E_CHROMIUM ? { executablePath: process.env.E2E_CHROMIUM } : {});

/** The fields of the v2 fixture this script changes; the rest is written back as it was read. */
type FixtureSave = {
  hunters: { id: string; name: string; hp: number }[];
  gates: { name: string; bossId: string | null; monsters: { monsterId: string; count: number }[] }[];
  settings: Record<string, unknown>;
  encounter: unknown;
};

/** A v2 save: one damaged, poisoned hunter, and a gate of two monsters. */
function seedSave(): string {
  const s: FixtureSave = JSON.parse(readFileSync(FIXTURE, 'utf8'));
  const brakk = s.hunters.find(h => h.name === 'Brakk Ironhide');
  if (!brakk) throw new Error(`${FIXTURE} has no Brakk Ironhide`);
  brakk.hp = 22;
  s.hunters = [brakk];
  s.settings.activeHunterId = brakk.id;
  s.settings.onboarded = true;
  s.settings.sync = { room: null, cursor: 0, serverOk: true };
  s.encounter = null;
  s.gates = s.gates.filter(g => g.name === 'Goblin Den' || g.name === 'Fixture Gate');
  const fixture = s.gates.find(g => g.name === 'Fixture Gate');
  if (!fixture) throw new Error(`${FIXTURE} has no Fixture Gate`);
  fixture.bossId = null;
  fixture.monsters = [{ monsterId: 'seed:lizardman', count: 1 }, { monsterId: 'seed:hobgoblin', count: 1 }];
  return JSON.stringify(s);
}

async function settle(page: Page) {
  await page.evaluate(() => new Promise<void>(r => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
}

async function openSized(browser: Browser, url: string, size: { width: number; height: number }) {
  const ctx = await browser.newContext({ viewport: size, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: IPHONE_UA, serviceWorkers: 'block' });
  const save = seedSave();
  await ctx.addInitScript((save: string) => {
    let a = 123456789;
    Math.random = () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    if (localStorage.getItem('__seeded') === null) { localStorage.setItem('hunter-system-v2', save); localStorage.setItem('__seeded', '1'); }
  }, save);
  const page = await ctx.newPage();
  page.setDefaultTimeout(8000);
  await page.clock.setFixedTime(NOW);
  const errors: string[] = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.hunterApp && document.querySelectorAll('#nav-top a').length > 0, null, { timeout: 15_000 });
  await page.addStyleTag({ content: '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important;scroll-behavior:auto!important}' + (size.width <= 720 ? '.nav-bottom{position:static!important}' : '') });
  return { ctx, page, errors };
}

async function tapIfShown(page: Page, sel: string) {
  const t = page.locator(sel).first();
  if (await t.count() && await t.isVisible()) { await t.tap(); return true; }
  return false;
}

async function main() {
  const url = arg('--url'), out = arg('--out');
  if (!url || !out) throw new Error('usage: --url URL --out DIR');
  mkdirSync(out, { recursive: true });
  const masks = (arg('--mask') ?? '').split(',').filter(Boolean);
  const browser = await chromium.launch(launchOptions());
  const skipped: string[] = [];
  const names: string[] = [];
  for (const [sizeName, size] of Object.entries(SIZES)) {
    const { ctx, page, errors } = await openSized(browser, url, size);
    const shot = async (view: string, state: string, fullPage = true) => {
      await settle(page);
      const name = `${sizeName}-${view}-${state}`;
      await page.screenshot({ path: join(out, name + '.png'), fullPage, animations: 'disabled', caret: 'hide', mask: masks.map(m => page.locator(m)), maskColor: '#ff00ff' });
      names.push(name);
    };
    const tryState = async (name: string, f: () => Promise<void>) => {
      try { await f(); } catch (e) { skipped.push(`${sizeName} ${name}: ${String(e).split('\n')[0]}`); }
    };
    const closeWindows = async () => {
      for (let i = 0; i < 6; i++) {
        if (await tapIfShown(page, '.sys-overlay.show [data-cancel]')) { await settle(page); continue; }
        const last = page.locator('.sys-overlay.show .sys-actions button:not(.confirm-all)').last();
        if (await last.count() && await last.isVisible()) { await last.tap(); await settle(page); continue; }
        break;
      }
    };
    const goView = async (id: string) => {
      await page.evaluate(v => { location.hash = '#/' + v; }, id);
      await page.waitForSelector(`#view-${id}`, { state: 'visible' });
    };

    await closeWindows();
    const ids = await page.$$eval('#nav-top a', as => as.map(a => (a.getAttribute('href') ?? '').replace('#/', '')));
    for (const id of ids) await tryState(id, async () => { await goView(id); await shot(id, id === 'status' ? 'chip-low-hp' : 'view'); });

    await tryState('fight', async () => {
      await goView('gates');
      const card = page.locator('#view-gates .gate').filter({ has: page.locator('.gt-name').getByText('Fixture Gate', { exact: true }) });
      await tryState('gate enter', async () => { await card.locator('[data-act=enter]').tap(); await closeWindows(); });
      await card.locator('[data-act=encounter]').tap();
      const win = page.locator('.sys-overlay.show', { hasText: 'Start fight' });
      await win.waitFor();
      await win.locator('input[name=roll]').uncheck();
      await win.locator('[data-go]').tap();
      await page.waitForSelector('#view-combat .cmb-row');
      await closeWindows();
      await goView('combat');
      await page.locator('#view-combat .cmb-pick').filter({ hasText: /Lizardman|Hobgoblin/ }).first().tap();
      await page.locator('#view-combat [data-defeat]').first().tap();
      await page.waitForSelector('#view-combat .cmb-row.dead');
      await page.locator('.sys-overlay.show', { hasText: 'MONSTER INFO UNLOCKED' }).waitFor({ timeout: 3000 }).catch(() => {});
      await closeWindows();
      await shot('combat', 'running-one-down');
    });
    await tryState('gate clear panel', async () => {
      await closeWindows();
      await goView('gates');
      await page.locator('#view-gates .gate [data-act=clear]').first().tap();
      await page.waitForSelector('#view-gates form');
      await shot('gates', 'clear-panel-open');
      await page.locator('#view-gates [data-act=cancel-panel]').first().tap();
    });
    await tryState('status window', async () => {
      await goView('combat');
      await page.locator('#view-combat .cmb-pick').first().tap();
      await page.locator('#view-combat [data-cforge]').first().tap();
      await page.waitForSelector('.sys-overlay.show, .overlay.show');
      await page.locator('.fg-overlay [data-existing] .fg-chip').first().waitFor({ state: 'visible' });
      await shot('combat', 'status-window-open', false);
      await closeWindows();
    });
    await tryState('system window', async () => {
      await page.locator('#more-btn').tap();
      await page.waitForSelector('.sys-overlay.show');
      await shot('app', 'system-window-open', false);
      await closeWindows();
    });
    if (errors.length) skipped.push(`${sizeName} console errors: ${errors.slice(0, 3).join(' | ')}`);
    await ctx.close();
  }
  await browser.close();
  writeFileSync(join(out, 'index.json'), JSON.stringify({ names, skipped }, null, 1));
  console.log(`${names.length} shots in ${out}`);
  for (const s of skipped) console.log('skipped: ' + s);
}

type Row = { name: string; sizeA: string; sizeB: string; sameSize: boolean; diffShare: number; diffImage?: string };

async function compare(dirA: string, dirB: string, reportFile: string) {
  const threshold = Number(arg('--threshold') ?? 0.001);
  const list = (d: string) => readdirSync(d).filter(f => f.endsWith('.png') && !f.endsWith('.diff.png')).sort();
  const a = list(dirA), b = new Set(list(dirB));
  const both = a.filter(f => b.has(f));
  const onlyA = a.filter(f => !b.has(f)), onlyB = [...b].filter(f => !a.includes(f));
  const browser = await chromium.launch(launchOptions());
  const page = await browser.newPage();
  const rows: Row[] = [];
  for (const f of both) {
    const r = await page.evaluate(async ({ x, y }) => {
      const load = async (b64: string) => { const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0)); return createImageBitmap(new Blob([bytes], { type: 'image/png' })); };
      const [ia, ib] = [await load(x), await load(y)];
      const w = Math.max(ia.width, ib.width), h = Math.max(ia.height, ib.height);
      const pix = (im: ImageBitmap) => { const c = new OffscreenCanvas(w, h), g = c.getContext('2d', { willReadFrequently: true })!; g.drawImage(im, 0, 0); return g.getImageData(0, 0, w, h).data; };
      const pa = pix(ia), pb = pix(ib);
      const at = (px: Uint8ClampedArray, i: number) => px[i] ?? 0;
      const out = new OffscreenCanvas(w, h), og = out.getContext('2d')!, od = og.createImageData(w, h);
      let diff = 0;
      for (let i = 0; i < w * h; i++) {
        const o = i * 4;
        const outside = (i % w) >= Math.min(ia.width, ib.width) || Math.floor(i / w) >= Math.min(ia.height, ib.height);
        const d = outside || Math.max(Math.abs(at(pa, o) - at(pb, o)), Math.abs(at(pa, o + 1) - at(pb, o + 1)), Math.abs(at(pa, o + 2) - at(pb, o + 2)), Math.abs(at(pa, o + 3) - at(pb, o + 3))) > 24;
        if (d) { diff++; od.data.set([255, 0, 60, 255], o); } else od.data.set([at(pa, o) >> 2, at(pa, o + 1) >> 2, at(pa, o + 2) >> 2, 255], o);
      }
      og.putImageData(od, 0, 0);
      const blob = await out.convertToBlob({ type: 'image/png' });
      const buf = new Uint8Array(await blob.arrayBuffer());
      let s = ''; for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
      return { sizeA: `${ia.width}x${ia.height}`, sizeB: `${ib.width}x${ib.height}`, diff, total: w * h, png: btoa(s) };
    }, { x: readFileSync(join(dirA, f)).toString('base64'), y: readFileSync(join(dirB, f)).toString('base64') });
    const row: Row = { name: f.replace(/\.png$/, ''), sizeA: r.sizeA, sizeB: r.sizeB, sameSize: r.sizeA === r.sizeB, diffShare: r.diff / r.total };
    if (row.diffShare > threshold || !row.sameSize) { row.diffImage = join(dirB, row.name + '.diff.png'); writeFileSync(row.diffImage, Buffer.from(r.png, 'base64')); }
    rows.push(row);
  }
  await browser.close();
  writeFileSync(reportFile, JSON.stringify({ threshold, rows, onlyA, onlyB }, null, 1));
  console.log('name\tsize A\tsize B\tdiff %');
  for (const r of rows) console.log(`${r.name}\t${r.sizeA}\t${r.sizeB}\t${(r.diffShare * 100).toFixed(3)}${r.diffImage ? '\t' + r.diffImage : ''}`);
  const over = rows.filter(r => r.diffImage).length;
  console.log(`${rows.length} pairs, ${over} over ${threshold * 100}% or of different size; only in A: ${onlyA.length}, only in B: ${onlyB.length}`);
}

if (process.argv.includes('--compare')) {
  const i = process.argv.indexOf('--compare');
  const report = arg('--report');
  if (!report) throw new Error('--report FILE needed');
  await compare(process.argv[i + 1]!, process.argv[i + 2]!, report);
} else await main();
