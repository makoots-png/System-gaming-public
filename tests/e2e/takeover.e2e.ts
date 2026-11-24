// Blocking takeover screen (Unit 7, Variant 1): two-tab flows for every read-only cause, focus trap, Escape,
// inert views behind the overlay, Export backup, Take over here locking out the other tab, and 390 px / 360 px layout checks.
import { mkdir, readFile } from 'node:fs/promises';
import { freshSave } from '../../src/core/save.ts';
import { parseDeviceId } from '../../src/core/ids.ts';
import { TAKEOVER_WORDS, canTakeOver } from '../../src/core/store-life.ts';
import type { ReadOnlyWhy } from '../../src/core/store-life.ts';
import { test, expect, openApp, editIdentity, go, save, PHONE, type Page } from './helpers.ts';

const V4 = 'hunter-system-v4', BACKUPS = 'hunter-system-backups';
const env = { now: new Date(), newDeviceId: () => parseDeviceId('d-e2e-takeover')!, newDeviceToken: () => 'test-device-token-0123456789abcd' };

function playerSave(name = 'Mira Fixture'): string {
  const s: any = freshSave(env, { onboarded: true });
  s.hunters[0].name = name;
  s.rulesOverrides = { solo: { personal: false }, feats: { on: false } };
  return JSON.stringify(s);
}

const stored = (page: Page, key: string): Promise<string | null> => page.evaluate(k => localStorage.getItem(k), key);
const storedName = async (page: Page): Promise<string> => JSON.parse((await stored(page, V4)) ?? 'null').hunters[0].name;

/** From now on this page's storage refuses every write of these keys; `free` lets them through again. */
const fill = (page: Page, ...keys: string[]): Promise<void> => page.evaluate(ks => {
  const w = window as any;
  if (!w.e2eFull) {
    w.e2eFull = new Set<string>();
    const set = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k: string, v: string) {
      if (w.e2eFull.has(k)) throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
      return set.call(this, k, v);
    };
  }
  for (const k of ks) w.e2eFull.add(k);
}, keys);
const free = (page: Page): Promise<void> => page.evaluate(() => { (window as any).e2eFull?.clear(); });

const tkOverlay = (page: Page) => page.locator('.tk-overlay.show');
const tkWin = (page: Page) => page.locator('.tk-overlay.show .tk-win');

async function expectTakeoverCause(page: Page, why: ReadOnlyWhy): Promise<void> {
  const copy = TAKEOVER_WORDS.causes[why];
  const win = tkWin(page);
  await expect(win).toBeVisible();
  await expect(win).toHaveAttribute('role', 'alertdialog');
  await expect(win).toHaveAttribute('aria-modal', 'true');
  await expect(win.locator('.n-tag')).toHaveText(TAKEOVER_WORDS.tag);
  await expect(win.locator('#tk-title')).toHaveText(copy.heading);
  for (const p of copy.body) await expect(win.locator('#tk-body')).toContainText(p);
  await expect(win.locator('.tk-export-note')).toHaveText(copy.exportNote);
  await expect(win.getByRole('button', { name: TAKEOVER_WORDS.reload })).toBeVisible();
  await expect(win.getByRole('button', { name: TAKEOVER_WORDS.exportBackup })).toBeVisible();
  await expect(win.getByRole('button', { name: TAKEOVER_WORDS.takeOver })).toHaveCount(canTakeOver(why) ? 1 : 0);
  await expect(page.locator('#banners .banner')).toHaveCount(0);
}

async function expectBehindInert(page: Page): Promise<void> {
  const inertState = await page.evaluate(() => {
    const els = ['header.sys-head', '#main', '#nav-bottom', '#nav-top'];
    return els.map(sel => {
      const el = document.querySelector(sel) as HTMLElement | null;
      return { sel, inert: !!el?.inert, hidden: el?.getAttribute('aria-hidden') };
    });
  });
  for (const row of inertState) {
    expect(row.inert, `${row.sel} is inert behind takeover`).toBe(true);
    expect(row.hidden, `${row.sel} is aria-hidden behind takeover`).toBe('true');
  }
}

async function expectLayoutClean(page: Page, width: number): Promise<void> {
  const metrics = await page.evaluate(() => {
    const win = document.querySelector('.tk-overlay.show .tk-win') as HTMLElement | null;
    if (!win) return null;
    const wr = win.getBoundingClientRect();
    const buttons = [...win.querySelectorAll('.tk-actions button')].map(b => {
      const r = b.getBoundingClientRect();
      return { text: (b.textContent ?? '').trim(), x: r.x, right: r.right, y: r.y, bottom: r.bottom, width: r.width, height: r.height };
    });
    return {
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      docScrollWidth: document.scrollingElement!.scrollWidth,
      winScrollWidth: win.scrollWidth,
      winClientWidth: win.clientWidth,
      winRect: { x: wr.x, right: wr.right, y: wr.y, bottom: wr.bottom, width: wr.width, height: wr.height },
      buttons,
    };
  });
  expect(metrics, 'takeover window is mounted').not.toBeNull();
  const m = metrics!;
  expect(m.docScrollWidth, `no horizontal page scroll at ${width}px`).toBeLessThanOrEqual(m.innerWidth);
  expect(m.winScrollWidth, `no horizontal dialog scroll at ${width}px`).toBeLessThanOrEqual(m.winClientWidth);
  expect(m.winRect.x).toBeGreaterThanOrEqual(0);
  expect(m.winRect.right).toBeLessThanOrEqual(m.innerWidth + 1);
  for (const b of m.buttons) {
    expect(b.height, `${b.text} is at least 44px tall at ${width}px`).toBeGreaterThanOrEqual(44);
    expect(b.height, `${b.text} stays single-line at ${width}px`).toBeLessThanOrEqual(56);
    expect(b.x, `${b.text} starts inside window`).toBeGreaterThanOrEqual(m.winRect.x);
    expect(b.right, `${b.text} fits inside window`).toBeLessThanOrEqual(m.winRect.right + 1);
    expect(b.right, `${b.text} fits inside viewport`).toBeLessThanOrEqual(m.innerWidth);
  }
}

async function exportFromTakeover(page: Page): Promise<string> {
  const dl = page.waitForEvent('download');
  await tkWin(page).getByRole('button', { name: TAKEOVER_WORDS.exportBackup }).tap();
  const path = (await (await dl).path()) ?? '';
  expect(path).not.toBe('');
  await expect(tkWin(page).locator('[data-tk-status]')).toHaveText(TAKEOVER_WORDS.exported);
  return readFile(path, 'utf8');
}

test('two tabs: otherTab blocks views, traps focus, ignores Escape and backdrop taps, exports unsaved changes, and Take over here locks out the other tab until Reload', async ({ device }) => {
  const { page, ctx } = await device('first tab', { seed: { [V4]: playerSave('Mira Start') } });
  await openApp(page);
  const other = await ctx.newPage();
  await openApp(other);

  await test.step('first tab holds an unsaved change while second tab saves, triggering otherTab takeover', async () => {
    await go(page, 'status');
    await fill(page, V4);
    await editIdentity(page, 'name', 'Mira Unsaved Tab 1');
    await expect(page.locator('#banners .banner')).toContainText('Saving failed');

    await go(other, 'status');
    await editIdentity(other, 'name', 'Mira Saved Tab 2');

    await expectTakeoverCause(page, 'otherTab');
    await expectBehindInert(page);
    await expectLayoutClean(page, PHONE.width);
  });

  await test.step('Escape, keyboard shortcuts, and backdrop taps do nothing harmful', async () => {
    await page.keyboard.press('Escape');
    await expect(tkOverlay(page)).toBeVisible();
    await page.keyboard.press('?');
    await expect(page.locator('.sys-overlay.show', { hasText: 'KEYBOARD' })).toHaveCount(0);
    await page.touchscreen.tap(8, 8);
    await expect(tkOverlay(page)).toBeVisible();
  });

  await test.step('Tab and Shift+Tab trap focus strictly inside the takeover window', async () => {
    const focusedText = () => page.evaluate(() => (document.activeElement as HTMLElement | null)?.textContent?.trim() ?? '');
    const focusInside = () => page.evaluate(() => !!document.activeElement?.closest('.tk-win'));
    await expect.poll(focusedText).toBe(TAKEOVER_WORDS.reload);
    await page.keyboard.press('Tab');
    await expect.poll(focusedText).toBe(TAKEOVER_WORDS.takeOver);
    await page.keyboard.press('Tab');
    await expect.poll(focusedText).toBe(TAKEOVER_WORDS.exportBackup);
    await page.keyboard.press('Tab');
    await expect.poll(focusedText).toBe(TAKEOVER_WORDS.reload);
    await page.keyboard.press('Shift+Tab');
    await expect.poll(focusedText).toBe(TAKEOVER_WORDS.exportBackup);
    expect(await focusInside()).toBe(true);
  });

  await test.step('Export backup downloads the first tab unsaved changes without phone secrets', async () => {
    const exported = JSON.parse(await exportFromTakeover(page));
    expect(exported.hunters[0].name).toBe('Mira Unsaved Tab 1');
    expect(exported.settings.deviceId).toBeUndefined();
    expect(exported.settings.sync.deviceToken).toBeUndefined();
    expect(exported.settings.sync.gmKey).toBeUndefined();
  });

  await test.step('Take over here restores saving in tab 1 and immediately locks out tab 2', async () => {
    await free(page);
    await tkWin(page).getByRole('button', { name: TAKEOVER_WORDS.takeOver }).tap();
    await expect(tkOverlay(page)).toHaveCount(0);
    expect(await page.evaluate(() => (document.getElementById('main') as HTMLElement).inert)).toBe(false);

    // Tab 2 is now read-only and showing the blocking takeover screen
    await expectTakeoverCause(other, 'otherTab');
    await expectBehindInert(other);

    // Tab 1 can edit and save again
    await editIdentity(page, 'name', 'Mira Owned By Tab 1');
    await expect.poll(() => storedName(page)).toBe('Mira Owned By Tab 1');
  });

  await test.step('Reload on tab 2 follows tab 1 without overwriting it', async () => {
    const reloaded = other.waitForEvent('load');
    await tkWin(other).getByRole('button', { name: TAKEOVER_WORDS.reload }).tap();
    await reloaded;
    await other.waitForFunction(() => window.hunterApp && document.querySelectorAll('#nav-top a').length > 0, null, { timeout: 15_000 });
    await expect(tkOverlay(other)).toHaveCount(0);
    await go(other, 'status');
    await expect(other.locator('#view-status [data-idname]')).toHaveText('Mira Owned By Tab 1');
    expect(await storedName(other)).toBe('Mira Owned By Tab 1');
  });
});

test('two tabs: mineUnkept keeps unsaved changes for Export backup and Take over here', async ({ device }) => {
  const { page, ctx } = await device('first tab', { seed: { [V4]: playerSave('Mira Start') } });
  await openApp(page);
  const other = await ctx.newPage();
  await openApp(other);

  await go(page, 'status');
  await fill(page, V4, BACKUPS);
  await editIdentity(page, 'name', 'Mira Mine Unkept');
  await expect(page.locator('#banners .banner')).toContainText('Saving failed');

  await go(other, 'status');
  await editIdentity(other, 'name', 'Mira Other Tab');

  await expectTakeoverCause(page, 'mineUnkept');
  await expectBehindInert(page);
  await expectLayoutClean(page, PHONE.width);

  const exported = JSON.parse(await exportFromTakeover(page));
  expect(exported.hunters[0].name).toBe('Mira Mine Unkept');
  expect(await storedName(page)).toBe('Mira Other Tab');

  await free(page);
  await tkWin(page).getByRole('button', { name: TAKEOVER_WORDS.takeOver }).tap();
  await expect(tkOverlay(page)).toHaveCount(0);
  await expect.poll(() => storedName(page)).toBe('Mira Mine Unkept');
  await expectTakeoverCause(other, 'otherTab');
});

test('newer save omits Take over here, exports the intact newer save, and never overwrites storage', async ({ device }) => {
  const raw = JSON.stringify({ ...JSON.parse(playerSave('Mira Future')), schema: 99, futureField: 'kept' });
  const { page } = await device('phone', { seed: { [V4]: raw } });
  await openApp(page);

  await expectTakeoverCause(page, 'newer');
  await expectBehindInert(page);
  await expectLayoutClean(page, PHONE.width);

  const exported = await exportFromTakeover(page);
  expect(JSON.parse(exported)).toMatchObject({ schema: 99, futureField: 'kept' });
  expect(await stored(page, V4)).toBe(raw);
});

test('loadUnkept omits Take over here, exports the raw stored text, and leaves storage untouched', async ({ device }) => {
  const junk = 'not json {name: Lost Hunter';
  const { page, ctx } = await device('phone', { seed: { [V4]: junk } });
  await ctx.addInitScript(key => {
    const set = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k: string, v: string) {
      if (k === key) throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
      return set.call(this, k, v);
    };
  }, BACKUPS);
  await openApp(page);

  await expectTakeoverCause(page, 'loadUnkept');
  await expectBehindInert(page);
  await expectLayoutClean(page, PHONE.width);

  expect(await exportFromTakeover(page)).toBe(junk);
  expect(await stored(page, V4)).toBe(junk);
});

test('fightUnkept names the unreadable running fight, omits Take over here, and exports the raw save', async ({ device }) => {
  const base = JSON.parse(playerSave('Intact Hero'));
  const raw = JSON.stringify({ ...base, fight: { phase: 'running', rows: 'not rows' } });
  const { page, ctx } = await device('phone', { seed: { [V4]: raw } });
  await ctx.addInitScript(key => {
    const set = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k: string, v: string) {
      if (k === key) throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
      return set.call(this, k, v);
    };
  }, BACKUPS);
  await openApp(page);

  await expectTakeoverCause(page, 'fightUnkept');
  await expectBehindInert(page);
  await expectLayoutClean(page, PHONE.width);

  expect(await exportFromTakeover(page)).toBe(raw);
  expect(await stored(page, V4)).toBe(raw);
  expect((await save(page)).hunters[0].name).toBe('Intact Hero');
});

test('takeover screen fits 390 px and 360 px viewports with no horizontal scroll and whole 44 px buttons', async ({ device }) => {
  const shotDir = process.env.E2E_SHOT_DIR || '';
  if (shotDir) await mkdir(shotDir, { recursive: true });

  for (const viewport of [{ width: 390, height: 844 }, { width: 360, height: 844 }]) {
    const tag = `${viewport.width}`;
    // otherTab
    const { page, ctx } = await device(`otherTab-${tag}`, { viewport, seed: { [V4]: playerSave('Mira') } });
    await openApp(page);
    const other = await ctx.newPage();
    await openApp(other);
    await fill(page, V4);
    await editIdentity(page, 'name', 'Mira Unsaved');
    await editIdentity(other, 'name', 'Mira Other');
    await expectTakeoverCause(page, 'otherTab');
    await expectLayoutClean(page, viewport.width);
    if (shotDir) await page.screenshot({ path: `${shotDir}/otherTab-${tag}.png` });

    // mineUnkept
    const m = await device(`mineUnkept-${tag}`, { viewport, seed: { [V4]: playerSave('Mira') } });
    await openApp(m.page);
    const mOther = await m.ctx.newPage();
    await openApp(mOther);
    await fill(m.page, V4, BACKUPS);
    await editIdentity(m.page, 'name', 'Mira Unkept');
    await editIdentity(mOther, 'name', 'Mira Other');
    await expectTakeoverCause(m.page, 'mineUnkept');
    await expectLayoutClean(m.page, viewport.width);
    if (shotDir) await m.page.screenshot({ path: `${shotDir}/mineUnkept-${tag}.png` });

    // newer
    const n = await device(`newer-${tag}`, { viewport, seed: { [V4]: JSON.stringify({ ...JSON.parse(playerSave('Mira')), schema: 99 }) } });
    await openApp(n.page);
    await expectTakeoverCause(n.page, 'newer');
    await expectLayoutClean(n.page, viewport.width);
    if (shotDir) await n.page.screenshot({ path: `${shotDir}/newer-${tag}.png` });

    // loadUnkept
    const l = await device(`loadUnkept-${tag}`, { viewport, seed: { [V4]: 'not json {name: Lost Hunter' } });
    await l.ctx.addInitScript(key => {
      const set = Storage.prototype.setItem;
      Storage.prototype.setItem = function (k: string, v: string) {
        if (k === key) throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
        return set.call(this, k, v);
      };
    }, BACKUPS);
    await openApp(l.page);
    await expectTakeoverCause(l.page, 'loadUnkept');
    await expectLayoutClean(l.page, viewport.width);
    if (shotDir) await l.page.screenshot({ path: `${shotDir}/loadUnkept-${tag}.png` });

    // fightUnkept
    const fBase = JSON.parse(playerSave('Mira'));
    const f = await device(`fightUnkept-${tag}`, { viewport, seed: { [V4]: JSON.stringify({ ...fBase, fight: { phase: 'running', rows: 'bad' } }) } });
    await f.ctx.addInitScript(key => {
      const set = Storage.prototype.setItem;
      Storage.prototype.setItem = function (k: string, v: string) {
        if (k === key) throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
        return set.call(this, k, v);
      };
    }, BACKUPS);
    await openApp(f.page);
    await expectTakeoverCause(f.page, 'fightUnkept');
    await expectLayoutClean(f.page, viewport.width);
    if (shotDir) await f.page.screenshot({ path: `${shotDir}/fightUnkept-${tag}.png` });
  }
});
