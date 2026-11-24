// A write the save refuses, as a player and a GM meet it (audit 2026-11-19, the class "a view ignores a refusal from
// store.apply"; the lint "a view reads the answer of every write to the save"; Unit 7 blocking takeover screen).
// In a read-only tab the blocking takeover screen makes every view inert and holds System windows behind it, so no tap
// can reach a view. ui.wrote and its lint remain active for background, timer, room-link and programmatic writes.
import { freshSave } from '../../src/core/save.ts';
import { parseDeviceId } from '../../src/core/ids.ts';
import { NOT_SAVED, TAKEOVER_WORDS } from '../../src/core/store-life.ts';
import { test, expect, openApp, onboardPlayer, dismissAll, go, save, type Page } from './helpers.ts';

const V4 = 'hunter-system-v4';
const env = { now: new Date(), newDeviceId: () => parseDeviceId('d-e2e-readonly')!, newDeviceToken: () => 'test-device-token-0123456789abcd' };

function newerSave(o: { gm?: boolean; calls?: unknown[]; items?: unknown[]; personal?: boolean; edit?: (s: any) => void } = {}): string {
  const s: any = freshSave(env, { onboarded: true });
  s.rulesOverrides = { solo: { personal: !!o.personal }, feats: { on: false } };
  if (o.gm) s.settings.mode = 'gm';
  if (o.calls) s.calls = o.calls;
  if (o.items) s.library.items = o.items;
  o.edit?.(s);
  return JSON.stringify({ ...s, schema: 99 });
}

async function openReadOnly(device: (label: string, o?: object) => Promise<{ page: Page }>, text: string): Promise<Page> {
  const { page } = await device('phone', { seed: { [V4]: text } });
  await openApp(page);
  await expect(page.locator('.tk-overlay.show .tk-win')).toContainText(TAKEOVER_WORDS.causes.newer.heading);
  return page;
}
const toast = (page: Page, text: string) => page.locator('.toast', { hasText: text });

test('a read-only tab blocks views, header controls, and queued coin or personal-gate windows behind the takeover screen', async ({ device }) => {
  // Closes the read-only tap refusal class (55d98a9e, 3e8a0b53, 4a94d8d0, d9e235dc): views and queued System windows are inert.
  const call = { id: 'd-e2e-player:r-1', hunter: { kind: 'remote', remote: 'd-e2e-player:h-1' }, who: 'Mira', what: 'STR check', face: 20, at: 'called', call: 'heads' };
  const page = await openReadOnly(device, newerSave({ gm: true, calls: [call], personal: true }));
  await expect(page.locator('.sys-overlay.show', { hasText: 'Mira called Heads' })).toHaveCount(0);
  await expect(page.locator('.sys-overlay.show', { hasText: 'A GATE HAS APPEARED' })).toHaveCount(0);
  expect(await page.evaluate(() => [
    (document.querySelector('header.sys-head') as HTMLElement).inert,
    (document.getElementById('main') as HTMLElement).inert,
    (document.getElementById('nav-bottom') as HTMLElement).inert,
  ])).toEqual([true, true, true]);
  const s = await save(page);
  expect(s.calls.map((c: any) => c.at)).toEqual(['called']);
  expect(s.settings.sync.outbox ?? []).toEqual([]);
});

test('ui.wrote still refuses and reports NOT_SAVED when an in-flight or programmatic write hits a read-only store', async ({ device }) => {
  const page = await openReadOnly(device, newerSave({
    gm: true,
    edit: s => {
      s.hunters.push({ ...s.hunters[0], id: 'h2', name: 'Second One' });
    },
  }));
  const creates: string[] = [];
  page.on('request', r => { if (r.method() === 'POST' && new URL(r.url()).pathname === '/api/rooms') creates.push(r.url()); });

  const switched = await page.evaluate(() => hunterApp.api.sync.switchTo('h2'));
  expect(switched).toBe(false);
  expect((await save(page)).settings.activeHunterId).toBe('h1');
  await expect(toast(page, NOT_SAVED)).toHaveCount(1);

  const manaRefusal = await page.evaluate(() => hunterApp.api.hunter.spendMana(hunterApp.store.active().id, 1));
  expect(manaRefusal).toEqual({ ok: false, why: 'read-only' });

  const createErr = await page.evaluate(() => hunterApp.api.sync.create().then(() => null, (e: any) => e?.kind ?? 'err'));
  expect(createErr).toBe('replaced');
  expect(creates).toEqual([]);
  expect(await page.evaluate(() => [hunterApp.api.sync.room(), hunterApp.seat()])).toEqual([null, 'alone']);
});

test('a player who deletes their last hunter and cancels the new one\'s name keeps the hunter', async ({ device }) => {
  // BUG-views-10: the hunter was deleted, and a hunter named "Hunter" made, even on Cancel
  const { page } = await device('player');
  await onboardPlayer(page, 'Mira Test');
  await dismissAll(page, 4);
  await go(page, 'status');
  const row = page.locator('#view-status [data-panel="party"] li', { hasText: 'Mira Test' });
  await row.locator('[data-pdel]').tap();
  const win = page.locator('.sys-overlay.show');
  await expect(win).toContainText('Delete Mira Test?');
  await win.locator('input').fill('Mira Test');
  await win.locator('.sys-actions button.primary').tap();
  await expect(win).toContainText('Create a new hunter');
  await win.locator('.sys-actions button', { hasText: 'Cancel' }).tap();
  await expect(win).toHaveCount(0);
  await expect(row).toHaveCount(1);
  expect((await save(page)).hunters.map((h: any) => h.name)).toEqual(['Mira Test']);
});

test('a tab that cannot save, whose save holds a room, sits in no room and asks it nothing; the save keeps the room, its key and where it stopped', async ({ device }) => {
  // SMX-sync-1.1: the tab polled the room, moved past the GM's award it could not land, and posted as if in no room
  const KEY = 'gmkeygmkeygmkey1';
  const page = await openReadOnly(device, newerSave({ gm: true, edit: s => { s.settings.sync = { ...s.settings.sync, room: 'ABC234', gmKey: KEY, cursor: 7 }; } }));
  const asked: string[] = [];
  page.on('request', r => { if (new URL(r.url()).pathname.startsWith('/api/rooms/ABC234')) asked.push(r.url()); });
  await expect.poll(() => page.evaluate(() => hunterApp.api.sync.status())).toBe('connected');
  expect(await page.evaluate(() => [hunterApp.api.sync.room(), hunterApp.seat()])).toEqual([null, 'alone']);
  expect(asked).toEqual([]);
  expect((await save(page)).settings.sync).toMatchObject({ room: 'ABC234', gmKey: KEY, cursor: 7 });
});
