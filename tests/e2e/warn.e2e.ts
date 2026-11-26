// Variant 1 warning sweep (audit PR 1): ui.warn layout and behavior at 360 px and 390 px,
// safe focus/Enter on danger confirms, inline match errors on typed confirms, promoted room errors,
// GM respec confirmation, quest failure lines without Rewards heading, GM broadcast control, and file:// overlay.
import { mkdir } from 'node:fs/promises';
import { freshSave } from '../../src/core/save.ts';
import { parseDeviceId } from '../../src/core/ids.ts';
import { test, expect, openApp, setupGoblinDenGM, onboardPlayer, createRoom, dismissAll, answerWindow, go, activeHunter, noonDate, PHONE, SMALL_PHONE, type Page } from './helpers.ts';

const V4 = 'hunter-system-v5';
const SHOT_DIR = process.env.E2E_SHOT_DIR || '';

async function maybeShot(page: Page, name: string): Promise<void> {
  if (!SHOT_DIR) return;
  await mkdir(SHOT_DIR, { recursive: true });
  await page.screenshot({ path: `${SHOT_DIR}/${name}` });
}

/** Asserts every Variant 1 structural, typography, overflow, and button-stack invariant on a visible warning window. */
async function expectVariant1(page: Page, width: number, selector = '.sys-overlay.show .sys-window.sys-warn'): Promise<void> {
  const win = page.locator(selector).first();
  await expect(win).toBeVisible();
  await expect(win).toHaveAttribute('role', 'alertdialog');
  await expect(win).toHaveAttribute('aria-modal', 'true');

  const m = await page.evaluate(sel => {
    const el = document.querySelector(sel) as HTMLElement | null;
    if (!el) return null;
    const wr = el.getBoundingClientRect();
    const tag = el.querySelector('.n-tag')?.textContent?.trim() ?? '';
    const big = el.querySelector('.n-big') as HTMLElement | null;
    const body = el.querySelector('.n-body') as HTMLElement | null;
    const actionsBox = el.querySelector('.sys-actions') as HTMLElement | null;
    const actionsWidth = actionsBox ? actionsBox.clientWidth : 0;
    const buttons = [...el.querySelectorAll('.sys-actions button:not(.confirm-all):not([hidden])')].map(b => {
      const r = b.getBoundingClientRect();
      const cls = b.classList;
      return {
        text: (b.textContent ?? '').trim(),
        primary: cls.contains('primary'),
        danger: cls.contains('danger'),
        cancel: b.hasAttribute('data-cancel'),
        x: r.x,
        right: r.right,
        y: r.y,
        bottom: r.bottom,
        width: r.width,
        height: r.height,
      };
    });
    return {
      innerWidth: window.innerWidth,
      docScrollWidth: document.scrollingElement!.scrollWidth,
      winScrollWidth: el.scrollWidth,
      winClientWidth: el.clientWidth,
      winRect: { x: wr.x, right: wr.right, width: wr.width },
      tag,
      bigTransform: big ? getComputedStyle(big).textTransform : '',
      bodyAlign: body && body.textContent?.trim() ? getComputedStyle(body).textAlign : '',
      actionsWidth,
      buttons,
    };
  }, selector);

  expect(m, 'Variant 1 window is mounted').not.toBeNull();
  const data = m!;
  expect(data.tag, 'no leading ! on warning tag').not.toContain('!');
  expect(data.bigTransform, 'sentence-case heading (no uppercase transform)').toBe('none');
  if (data.bodyAlign) expect(data.bodyAlign, 'body copy is left-aligned').toBe('left');
  expect(data.docScrollWidth, `no horizontal page overflow at ${width}px`).toBeLessThanOrEqual(data.innerWidth);
  expect(data.winScrollWidth, `no horizontal dialog overflow at ${width}px`).toBeLessThanOrEqual(data.winClientWidth);
  expect(data.winRect.x).toBeGreaterThanOrEqual(0);
  expect(data.winRect.right).toBeLessThanOrEqual(data.innerWidth + 1);

  const rankOf = (b: { primary: boolean; danger: boolean; cancel: boolean }) =>
    b.primary ? 0 : b.danger ? 1 : b.cancel ? 3 : 2;

  for (let i = 0; i < data.buttons.length; i++) {
    const b = data.buttons[i]!;
    expect(b.primary && b.danger, `${b.text} is never primary + danger`).toBe(false);
    expect(b.height, `${b.text} is at least 44px tall at ${width}px`).toBeGreaterThanOrEqual(44);
    expect(b.width, `${b.text} spans full button stack width at ${width}px`).toBeGreaterThanOrEqual(data.actionsWidth - 2);
    expect(b.x).toBeGreaterThanOrEqual(data.winRect.x);
    expect(b.right).toBeLessThanOrEqual(data.winRect.right + 1);
    if (i > 0) {
      const prev = data.buttons[i - 1]!;
      expect(b.y, `${b.text} stacks below ${prev.text}`).toBeGreaterThanOrEqual(prev.bottom - 1);
      expect(rankOf(b), `${b.text} follows primary -> danger -> plain -> cancel`).toBeGreaterThanOrEqual(rankOf(prev));
    }
  }
}

for (const viewport of [PHONE, SMALL_PHONE]) {
  test(`danger confirm at ${viewport.width}px: Variant 1 layout, safe Cancel focus, Enter/Escape/backdrop cancel, danger button deletes`, async ({ device }) => {
    const { page } = await device(`gm-${viewport.width}`, { viewport });
    await setupGoblinDenGM(page);
    await go(page, 'gates');
    const card = page.locator('#view-gates .gate[data-id]', { hasText: 'Goblin Den' });
    await expect(card).toBeVisible();

    await card.locator('[data-act="delete"]').tap();
    await expectVariant1(page, viewport.width);
    const win = page.locator('.sys-overlay.show .sys-window.sys-warn');
    await expect(win.locator('.n-big')).toHaveText('Delete this gate?');
    await expect(win.locator('.sys-actions button.danger')).toHaveText('Delete gate');
    await expect(win.locator('.sys-actions button.primary')).toHaveCount(0);

    // Safe focus lands on Cancel, so pressing Enter cancels without deleting
    await expect.poll(() => page.evaluate(() => (document.activeElement as HTMLElement | null)?.textContent?.trim() ?? '')).toBe('Cancel');
    if (viewport.width === PHONE.width) await maybeShot(page, 'danger-confirm.png');
    await page.keyboard.press('Enter');
    await expect(win).toHaveCount(0);
    await expect(card).toBeVisible();

    // Escape cancels
    await card.locator('[data-act="delete"]').tap();
    await expect(win).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(win).toHaveCount(0);
    await expect(card).toBeVisible();

    // Backdrop tap cancels
    await card.locator('[data-act="delete"]').tap();
    await expect(win).toBeVisible();
    await page.touchscreen.tap(8, 8);
    await expect(win).toHaveCount(0);
    await expect(card).toBeVisible();

    // Danger action deletes the gate
    await card.locator('[data-act="delete"]').tap();
    await win.locator('.sys-actions button.danger').tap();
    await expect(win).toHaveCount(0);
    await expect(card).toHaveCount(0);
  });

  test(`typed delete and reset at ${viewport.width}px: inline mismatch error, typing clears error, Enter submits, reset accepts lowercase`, async ({ device }) => {
    const { page } = await device(`typed-${viewport.width}`, { viewport });
    await onboardPlayer(page, 'Mira Test');
    await dismissAll(page);
    await page.evaluate(() => hunterApp.store.update((s: any) => {
      s.rulesOverrides.solo = { personal: false };
      s.hunters.push({ name: 'Spare Test', daily: { lastCheckedKey: s.world.lastDailyKey } });
    }, 'test-setup'));
    await go(page, 'status');

    const row = page.locator('#view-status [data-panel="party"] li', { hasText: 'Spare Test' });
    await row.locator('[data-pdel]').tap();
    await expectVariant1(page, viewport.width);
    const win = page.locator('.sys-overlay.show .sys-window.sys-warn');
    await expect(win.locator('.n-big')).toHaveText('Delete Spare Test?');
    await expect(win.locator('.sys-actions button.danger')).toHaveText('Delete hunter');

    // Focus lands on the text input, not Cancel
    await expect.poll(() => page.evaluate(() => document.activeElement?.tagName)).toBe('INPUT');

    // Wrong word keeps window open with inline error and no mismatch toast
    await win.locator('input').fill('wrong name');
    await page.keyboard.press('Enter');
    await expect(win).toBeVisible();
    await expect(win.locator('.sys-err')).toContainText('Type Spare Test to confirm.');
    await expect(page.locator('#toasts .toast', { hasText: 'did not match' })).toHaveCount(0);
    if (viewport.width === PHONE.width) await maybeShot(page, 'typed-delete.png');

    // Typing clears the inline error, and exact name + Enter submits
    await win.locator('input').fill('Spare Test');
    await expect(win.locator('.sys-err')).toHaveText('');
    await page.keyboard.press('Enter');
    await expect(win).toHaveCount(0);
    await expect(row).toHaveCount(0);

    // Reset campaign accepts lowercase "reset"
    await go(page, 'data');
    await page.locator('#view-data [data-reset]').tap();
    await expectVariant1(page, viewport.width);
    await expect(win.locator('.n-big')).toHaveText('Reset campaign?');
    await win.locator('input').fill('nope');
    await win.locator('.sys-actions button.danger').tap();
    await expect(win.locator('.sys-err')).toHaveText('Type RESET to confirm.');
    await win.locator('input').fill('reset');
    await expect(win.locator('.sys-err')).toHaveText('');
    await win.locator('.sys-actions button.danger').tap();
    await expect(win).toHaveCount(0);
  });
}

test('penalty window, quest failed without Rewards heading, and GM EMERGENCY QUEST broadcast control at 390px and 360px', async ({ device }) => {
  // 1. Penalty window on missed daily (both 390 px and 360 px)
  for (const viewport of [PHONE, SMALL_PHONE]) {
    const env = { now: noonDate(new Date(Date.now() - 3 * 86_400_000)), newDeviceId: () => parseDeviceId('d-e2e-pen')!, newDeviceToken: () => 'test-device-token-0123456789abcd' };
    const { page } = await device(`penalty-${viewport.width}`, { viewport, seed: { [V4]: JSON.stringify(freshSave(env, { onboarded: true })) } });
    await openApp(page);
    await expectVariant1(page, viewport.width);
    const win = page.locator('.sys-overlay.show .sys-window.sys-warn');
    await expect(win.locator('.n-tag')).toHaveText('Penalty Zone');
    await expect(win.locator('.n-big')).toHaveText('Penalty');
    if (viewport.width === PHONE.width) await maybeShot(page, 'penalty.png');
    await answerWindow(page, 'Penalty Zone');
  }

  // 2. Quest failed shows penalty lines without a "Rewards" heading
  const { page: gm } = await device('gm-qfail', { viewport: PHONE });
  await setupGoblinDenGM(gm);
  await gm.evaluate(() => hunterApp.store.update((d: any) => { d.hunters[0].gold = 80; }, 'test-setup'));
  await go(gm, 'quests');
  await gm.locator('#view-quests [data-new]').tap();
  const form = gm.locator('#view-quests form[data-form]');
  await form.locator('[name=title]').fill('Hold the line');
  await form.locator('#qf-fail-gold').fill('-50');
  await form.locator('button[type=submit]').tap();
  await gm.locator('#view-quests .qc', { hasText: 'Hold the line' }).locator('[data-fail]').tap();
  await answerWindow(gm, 'Fail quest?', 'Fail quest');
  await expectVariant1(gm, PHONE.width);
  const qfail = gm.locator('.sys-overlay.show .sys-window.sys-warn');
  await expect(qfail.locator('.n-big')).toHaveText('Quest failed');
  await expect(qfail).toContainText('Loses 50 gold');
  await expect(qfail.locator('.sys-rw-h')).toHaveCount(0);
  await answerWindow(gm, 'Quest failed');

  // 3. GM "EMERGENCY QUEST" broadcast stays centered (non-warn control)
  await gm.evaluate(() => {
    void hunterApp.ui.system({ tag: '! System', title: 'EMERGENCY QUEST', kind: 'quest', body: 'Defend the square.' });
  });
  const broadcast = gm.locator('.sys-overlay.show .sys-window', { hasText: 'EMERGENCY QUEST' });
  await expect(broadcast).toBeVisible();
  const ctrl = await gm.evaluate(() => {
    const el = document.querySelector('.sys-overlay.show .sys-window') as HTMLElement;
    return { isWarn: el.classList.contains('sys-warn'), bigTransform: getComputedStyle(el.querySelector('.n-big')!).textTransform };
  });
  expect(ctrl.isWarn).toBe(false);
  expect(ctrl.bigTransform).toBe('uppercase');
  await answerWindow(gm, 'EMERGENCY QUEST');
});

test('gate break (GM Dungeon Break and player Gate Break) and room gone', async ({ device }) => {
  const { page: gm } = await device('gm-room', { viewport: PHONE, blockServiceWorker: true });
  await setupGoblinDenGM(gm);
  const code = await createRoom(gm);

  const { page: player } = await device('player-room', { viewport: PHONE, blockServiceWorker: true, allowConsole: [/status of 404/] });
  await onboardPlayer(player, 'Kai Test', code);
  await expect.poll(() => player.evaluate(() => hunterApp.api.sync.room())).toBe(code);
  await dismissAll(player, 4);

  // 1. Gate break: GM advances day past breakDay -> GM sees Dungeon Break (with Start fight + Close), player sees Gate Break
  await expect.poll(() => player.evaluate(() => hunterApp.api.sync.doc('world')?.gates?.length ?? 0), { timeout: 30_000 }).toBeGreaterThan(0);
  await go(gm, 'gates');
  await gm.evaluate(() => hunterApp.api.gates.advanceDay(10));
  await expectVariant1(gm, PHONE.width);
  await expect(gm.locator('.sys-overlay.show .n-big')).toHaveText('Dungeon Break');
  await maybeShot(gm, 'gate-break.png');
  while (await gm.locator('.sys-overlay.show', { hasText: 'Dungeon Break' }).count()) {
    await gm.locator('.sys-overlay.show .sys-actions button', { hasText: 'Close' }).first().tap();
    await gm.waitForTimeout(200);
  }

  await expect(player.locator('.sys-overlay.show .n-big')).toHaveText('Gate Break', { timeout: 30_000 });
  await expectVariant1(player, PHONE.width);
  while (await player.locator('.sys-overlay.show', { hasText: 'Gate Break' }).count()) {
    await player.locator('.sys-overlay.show .sys-actions button', { hasText: 'Close' }).first().tap();
    await player.waitForTimeout(200);
  }

  // 3. Room gone (404) opens Variant 1 window on player phone
  await player.route(u => u.pathname === `/api/rooms/${code}`, route =>
    route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"no such room"}' }));
  await expect(player.locator('.sys-overlay.show .n-big')).toHaveText('This room no longer exists', { timeout: 20_000 });
  await expectVariant1(player, PHONE.width);
  await expect(player.locator('.sys-overlay.show .n-tag')).toHaveText('Room closed');
  await maybeShot(player, 'room-gone.png');
  await answerWindow(player, 'This room no longer exists', 'Close');
  await expect.poll(() => player.evaluate(() => hunterApp.api.sync.room())).toBeNull();
});

test('file:// static warning overlay renders Variant 1 layout and marks dead chrome inert at 390px and 360px', async ({ device }) => {
  const fileUrl = `file://${test.info().project.testDir}/../../public/index.html`;
  for (const viewport of [PHONE, SMALL_PHONE]) {
    const { page } = await device(`file-${viewport.width}`, {
      viewport,
      // ES module script and manifest cannot load over file:// by browser design
      allowConsole: [/CORS|Failed to load resource|ERR_FAILED|Access to script|manifest/i],
    });
    await page.goto(fileUrl, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#file-warn.show')).toBeVisible();
    await expectVariant1(page, viewport.width, '#file-warn.show .sys-window.sys-warn');
    await expect(page.locator('#file-warn .n-tag')).toHaveText('Cannot start here');
    await expect(page.locator('#file-warn .n-big')).toHaveText('Open from a web address');
    const inertState = await page.evaluate(() => ['header.sys-head', '#main', '#nav-bottom', '#nav-top'].map(sel => {
      const el = document.querySelector(sel) as HTMLElement | null;
      return { sel, inert: !!el?.inert, hidden: el?.getAttribute('aria-hidden') };
    }));
    for (const row of inertState) {
      expect(row.inert, `${row.sel} is inert behind #file-warn`).toBe(true);
      expect(row.hidden, `${row.sel} is aria-hidden behind #file-warn`).toBe('true');
    }
    if (viewport.width === PHONE.width) await maybeShot(page, 'file-protocol.png');
  }
});
