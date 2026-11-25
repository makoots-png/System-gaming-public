import { readFile } from 'node:fs/promises';
import { SCHEMA, createHunter, freshSave } from '../../src/core/save.ts';
import { RULES } from '../../src/core/rules.ts';
import { parseItem } from '../../src/core/registry/items.ts';
import { parseDeviceId, saveId } from '../../src/core/ids.ts';
import { TAKEOVER_WORDS } from '../../src/core/store-life.ts';
import { test, expect, openApp, onboardPlayer, dismissAll, editIdentity, go, save, answerWindow, noonDate, type Page } from './helpers.ts';

const V1 = 'hunter-system-v1', V2 = 'hunter-system-v2', V3 = 'hunter-system-v3', V4 = 'hunter-system-v4', V5 = 'hunter-system-v5', BACKUPS = 'hunter-system-backups';
const OLD_IMPORT = 'This save is from an older version and cannot be imported. Start a fresh campaign or import a current save.';
const OLD_PACK_IMPORT = 'This file is from an older version and cannot be imported. Export it again from the current version, or create it fresh in the Workshop.';
const OLD_BACKUP_RESTORE = 'That backup is from an older version and cannot be restored. Keep your current save or use Reset campaign to start fresh.';

const testEnv = (id = 'd-e2e-save') => ({ now: noonDate(), newDeviceId: () => parseDeviceId(id)!, newDeviceToken: () => 'test-device-token-0123456789abcd' });
const pinAfter = (text: string): string => new Date(Date.parse(JSON.parse(text).savedAt) + 60_000).toISOString();
/** A current-schema player save with personal gates off (a hunter alone otherwise gets a personal gate window on open). */
function playerSaveText(): string {
  const s = freshSave(testEnv('d-e2e-player'), { onboarded: true });
  s.savedAt = noonDate().toISOString();
  s.rulesOverrides = { solo: { personal: false } };
  const h = s.hunters[0]!;
  h.name = 'Mira Fixture';
  h.gold = 0;
  h.skills = [];
  h.items = [{ ...parseItem({ name: 'Player Charm', rar: 'common', type: 'misc', qty: 2 })!, id: saveId('i', 10) }];
  return JSON.stringify(s);
}
/** A current-schema campaign save with two hunters for export/import round-trip tests. */
function exportSaveText(): string {
  const base = JSON.parse(playerSaveText());
  const { save: withTwo } = createHunter(base, 'Brakk Ironhide', RULES, noonDate());
  withTwo.settings.activeHunterId = base.hunters[0].id;
  return JSON.stringify(withTwo);
}

const stored = (page: Page, key: string): Promise<string | null> => page.evaluate(k => localStorage.getItem(k), key);
/** The texts the backups hold under this reason. */
const backedUp = (page: Page, reason: string): Promise<string[]> => page.evaluate(([key, wanted]) => {
  const ring: { reason: string; data: string }[] = JSON.parse(localStorage.getItem(key ?? '') ?? '[]');
  return ring.filter(b => b.reason === wanted).map(b => b.data);
}, [BACKUPS, reason]);

/** The part of a hunter a player would miss if it changed. */
const whatPlayersKeep = (h: any) => ({
  name: h.name, level: h.level, xp: h.xp, job: h.job, rank: h.rank, stats: h.stats, gold: h.gold,
  items: h.items.map((i: any) => [i.name, i.qty]),
  skills: h.skills.map((k: any) => k.name),
  quests: h.quests.map((q: any) => [q.title, q.status]),
});

async function expectNoErrorWindow(page: Page): Promise<void> {
  await expect(page.locator('#banners .banner')).toHaveCount(0);
  await expect(page.locator('.sys-overlay.show')).toHaveCount(0);
}

/** The Status sheet and the Inventory show this hunter. */
async function expectSheetShows(page: Page, h: { name: string; level: number; xp: number; gold: number; items: [string, number][]; skills: string[] }): Promise<void> {
  await go(page, 'status');
  const sheet = page.locator('#view-status');
  await expect(sheet.locator('[data-idname]')).toHaveText(h.name);
  await expect(sheet.locator('[data-lv]')).toHaveText(String(h.level));
  await expect(sheet.locator('[data-xpnums]')).toHaveText(new RegExp(`^${h.xp} / `));
  await expect(sheet.locator('[data-panel="inventory"] [data-gold]')).toHaveText(String(h.gold));
  await expect.poll(() => sheet.locator('[data-panel="inventory"] .inv-card').evaluateAll(cards => cards.map(c => {
    const qty = /×(\d+)/.exec(c.textContent ?? '');
    return [c.querySelector('.i-name')?.textContent ?? '', qty ? Number(qty[1]) : 1];
  }))).toEqual(h.items);
  await expect(sheet.locator('[data-panel="skills"] .skill .s-title')).toHaveText(h.skills);
}

async function expectHuntersMatch(page: Page, hunters: any[]): Promise<void> {
  await expect.poll(async () => (await save(page)).hunters.map(whatPlayersKeep)).toEqual(hunters.map(whatPlayersKeep));
}

async function importThroughDataPanel(page: Page, file: string): Promise<void> {
  await go(page, 'data');
  await page.locator('#view-data [data-import]').setInputFiles(file);
  const preview = page.locator('.sys-overlay.show');
  await expect(preview).toContainText('Import preview');
  await preview.getByRole('button', { name: 'Replace campaign' }).tap();
  await expect(preview).toHaveCount(0);
}

test('old storage keys boot cleanly into fresh onboarding, and an older-schema file is refused at import', async ({ device }) => {
  const oldV4 = JSON.stringify({ ...JSON.parse(playerSaveText()), schema: SCHEMA - 1 });
  const cases: [string, string, string][] = [
    ['v1 key', V1, JSON.stringify({ name: 'Old Hero', stats: { str: 12 } })],
    ['v2 key', V2, JSON.stringify({ ...JSON.parse(playerSaveText()), schema: 2 })],
    ['v3 key', V3, JSON.stringify({ ...JSON.parse(playerSaveText()), schema: 3 })],
    ['v4 key', V4, oldV4],
  ];
  let last: Page | null = null;
  for (const [what, key, text] of cases) {
    await test.step(`${what} is ignored and starts fresh onboarding`, async () => {
      const { page } = await device(what, { seed: { [key]: text, 'hunter-system-told': JSON.stringify({ campaign: 'old-c', feat: { h1: ['threads-end'] }, personal: {}, room: {} }) } });
      await openApp(page);
      await expect(page.locator('#banners .banner')).toHaveCount(0);
      await expect(page.locator('.ob-overlay')).toBeVisible();
      expect(await stored(page, key)).toBe(text);
      expect(JSON.parse((await stored(page, V5)) ?? 'null')).toMatchObject({ schema: SCHEMA });
      const told = JSON.parse((await stored(page, 'hunter-system-told')) ?? 'null');
      expect(told?.campaign).not.toBe('old-c');
      expect(told?.feat?.h1 ?? []).toEqual([]);
      last = page;
    });
  }

  await test.step('an older-schema file chosen in the Data panel is refused before any preview offers to import it', async () => {
    const page = last!;
    await onboardPlayer(page, 'Fresh Hero');
    await dismissAll(page, 4);
    const before = (await save(page)).hunters;
    await go(page, 'data');
    await page.locator('#view-data [data-import]').setInputFiles({ name: 'old-save.json', mimeType: 'application/json', buffer: Buffer.from(btoa(oldV4), 'base64') });
    await expect(page.locator('.sys-overlay.show', { hasText: 'Import failed' })).toContainText(OLD_IMPORT);
    await expect(page.locator('.sys-overlay.show', { hasText: 'Import preview' })).toHaveCount(0);
    await answerWindow(page, 'Import failed');
    expect((await save(page)).hunters).toEqual(before);

    const oldPack = JSON.stringify({ schema: SCHEMA - 1, kind: 'library', library: {} });
    await page.locator('#view-data [data-import]').setInputFiles({ name: 'old-pack.json', mimeType: 'application/json', buffer: Buffer.from(btoa(oldPack), 'base64') });
    await expect(page.locator('.sys-overlay.show', { hasText: 'Import failed' })).toContainText(OLD_PACK_IMPORT);
    await answerWindow(page, 'Import failed');

    await page.evaluate(([bkKey, data]) => {
      const ring = JSON.parse(localStorage.getItem(bkKey!) ?? '[]');
      ring.unshift({ at: '2026-11-20T12:00:00.000Z', reason: 'manual', data });
      localStorage.setItem(bkKey!, JSON.stringify(ring));
    }, [BACKUPS, oldV4]);
    await go(page, 'status');
    await go(page, 'data');
    await page.locator('#view-data [data-backups] li [data-restore="0"]').tap();
    await answerWindow(page, 'Restore this backup?', 'Restore backup');
    await expect(page.locator('.sys-overlay.show', { hasText: 'Restore failed' })).toContainText(OLD_BACKUP_RESTORE);
    await answerWindow(page, 'Restore failed');
    expect((await save(page)).hunters).toEqual(before);

    await go(page, 'status');
    await expect(page.locator('#view-status [data-idname]')).toHaveText('Fresh Hero');
  });
});

test('a campaign exported from the Data panel and imported on another phone brings the same hunters back', async ({ device }) => {
  const text = exportSaveText(), fixture = JSON.parse(text);
  const pinTo = pinAfter(text);
  const first = (await device('first phone', { seed: { [V5]: text }, pinTo })).page, second = (await device('second phone', { pinTo })).page;
  let exported = '', hunters: any[] = [];

  await test.step('the first phone opens the campaign and exports it', async () => {
    await openApp(first);
    await expectNoErrorWindow(first);
    hunters = (await save(first)).hunters;
    expect(hunters.map((h: any) => h.name)).toEqual(fixture.hunters.map((h: any) => h.name));
    await go(first, 'data');
    const download = first.waitForEvent('download');
    await first.locator('#view-data [data-export]').tap();
    exported = (await (await download).path()) ?? '';
    expect(exported).not.toBe('');
  });

  await test.step('the file carries no identity of the first phone: no device id, no device token, no GM key', async () => {
    const file = JSON.parse(await readFile(exported, 'utf8'));
    expect([file.settings.deviceId, file.settings.sync.deviceToken, file.settings.sync.gmKey]).toEqual([undefined, undefined, undefined]);
  });

  await test.step('the file carries only the campaign\'s room fields, none of the first phone\'s dealings with rooms', async () => {
    const file = JSON.parse(await readFile(exported, 'utf8'));
    expect(Object.keys(file.settings.sync).filter(k => !['room', 'cursor', 'lastRoom', 'boundHunterId'].includes(k))).toEqual([]);
  });

  await test.step('a fresh second phone imports that file and has the same hunters', async () => {
    await onboardPlayer(second, 'Second Phone');
    await dismissAll(second, 4);
    const identity = () => second.evaluate(() => { const s = hunterApp.store.get().settings; return [s.deviceId, s.sync.deviceToken]; });
    const ownRooms = () => second.evaluate(() => { const s = hunterApp.store.get().settings.sync; return [s.gmKeys, s.applied]; });
    await second.evaluate(() => hunterApp.store.update((s: any) => { s.settings.sync.gmKeys = { ABCDEF: 'k'.repeat(32) }; s.settings.sync.applied = ['e-landed-here']; }));
    const mine = await identity(), rooms = await ownRooms();
    expect(rooms).toEqual([{ ABCDEF: 'k'.repeat(32) }, ['e-landed-here']]);
    await importThroughDataPanel(second, exported);
    await expectHuntersMatch(second, hunters);
    expect(await identity(), 'the second phone is still itself to the room').toEqual(mine);
    expect(await ownRooms(), 'the second phone keeps its GM keys and what landed on it').toEqual(rooms);
    const active = hunters.find((h: any) => h.id === fixture.settings.activeHunterId);
    await expectSheetShows(second, { ...active, items: active.items.map((i: any) => [i.name, i.qty]), skills: active.skills.map((k: any) => k.name) });
  });
});

/** The player sees one warning and a starter hunter, and the Data panel lists one backup that holds exactly the old text. */
async function expectWarnedAndBackedUp(page: Page, oldText: string): Promise<void> {
  await expect(page.locator('#banners .banner')).toHaveCount(1);
  await expect(page.locator('#banners .banner')).toContainText('could not be read');
  await go(page, 'status');
  await expect(page.locator('#view-status [data-idname]')).toHaveText('Sung Jin-Woo');
  await go(page, 'data');
  await expect(page.locator('#view-data [data-backups] li', { hasText: 'unreadable' })).toHaveCount(1);
  expect(await backedUp(page, 'unreadable')).toEqual([oldText]);
}

test('a save that is not JSON opens the app with a fresh hunter, a warning, and the old text kept in the backups', async ({ device }) => {
  const junk = 'not json {name: Lost Hunter';
  const { page } = await device('phone', { seed: { [V5]: junk } });
  await openApp(page);
  await expectWarnedAndBackedUp(page, junk);
});

test('a current save of the wrong shape warns the player and keeps the old text in the backups', async ({ device }) => {
  const odd = JSON.stringify({ schema: SCHEMA, hunters: { h1: { name: 'Odd Shape Hunter', level: 4 } } });
  const { page } = await device('phone', { seed: { [V5]: odd } });
  await openApp(page);
  await expectWarnedAndBackedUp(page, odd);
});

test('a save whose running fight is damaged opens without the fight, says so, and keeps the save as it was in the backups', async ({ device }) => {
  const env = { now: noonDate(), newDeviceId: () => parseDeviceId('d-e2e-fight')!, newDeviceToken: () => 'test-device-token-0123456789abcd' };
  const base = freshSave(env, { onboarded: true });
  const text = JSON.stringify({ ...base, hunters: [{ ...base.hunters[0]!, name: 'Kept Hunter' }], fight: { phase: 'running', rows: 'not rows' } });
  const { page } = await device('phone', { seed: { [V5]: text } });
  await openApp(page);
  await expect(page.locator('#banners .banner')).toHaveCount(1);
  await expect(page.locator('#banners .banner')).toContainText('running fight');
  expect((await save(page)).fight).toBeNull();
  await go(page, 'status');
  await expect(page.locator('#view-status [data-idname]')).toHaveText('Kept Hunter');
  expect(await backedUp(page, 'a fight that could not be read')).toEqual([text]);
});

test('a player who opens the app days after their last daily meets the PENALTY window as the app opens', async ({ device }) => {
  const env = { now: noonDate(new Date(Date.now() - 3 * 86_400_000)), newDeviceId: () => parseDeviceId('d-e2e-late')!, newDeviceToken: () => 'test-device-token-0123456789abcd' };
  const { page } = await device('phone', { seed: { [V5]: JSON.stringify(freshSave(env, { onboarded: true })) } });
  await openApp(page);
  await expect(page.locator('.sys-overlay.show')).toContainText('Penalty Zone');
  await dismissAll(page);
  await go(page, 'status');
  await expect(page.locator('#view-status .chip', { hasText: 'Penalized' })).toHaveCount(1);
});

test('a save from a newer app opens read-only: the blocking takeover screen stops edits without Take over here, and nothing is overwritten', async ({ device }) => {
  const text = JSON.stringify({ ...JSON.parse(playerSaveText()), schema: 99 });
  const { page } = await device('phone', { seed: { [V5]: text }, pinTo: pinAfter(text) });
  await openApp(page);
  const win = page.locator('.tk-overlay.show .tk-win');
  await expect(win).toContainText(TAKEOVER_WORDS.causes.newer.heading);
  await expect(win).toContainText(TAKEOVER_WORDS.causes.newer.body[0]!);
  await expect(win.getByRole('button', { name: TAKEOVER_WORDS.takeOver })).toHaveCount(0);
  await expect(page.locator('#banners .banner')).toHaveCount(0);
  expect(await page.evaluate(() => (document.getElementById('main') as HTMLElement).inert)).toBe(true);
  await expect(page.locator('#view-status [data-idname]')).toHaveText('Mira Fixture');
  expect((await save(page)).hunters[0].name).toBe('Mira Fixture');
  expect(await stored(page, V5)).toBe(text);

  await openApp(page);
  await expect(win).toContainText(TAKEOVER_WORDS.causes.newer.heading);
  await expect(page.locator('#view-status [data-idname]')).toHaveText('Mira Fixture');
  expect(await stored(page, V5)).toBe(text);
});

test('a renamed hunter and a newly stored item are still there after reloading the page', async ({ device }) => {
  const text = playerSaveText();
  const { page } = await device('phone', { seed: { [V5]: text }, pinTo: pinAfter(text) });
  await openApp(page);
  await go(page, 'status');
  await editIdentity(page, 'name', 'Mira Renamed');
  const inventory = page.locator('#view-status [data-panel="inventory"]');
  await inventory.locator('[data-form] [name="name"]').fill('Reload Charm');
  await inventory.locator('[data-form] button[type="submit"]').tap();
  await expect(inventory.locator('.inv-card .i-name')).toHaveText(['Player Charm', 'Reload Charm']);

  await openApp(page);
  await expectSheetShows(page, { name: 'Mira Renamed', level: 1, xp: 0, gold: 0, items: [['Player Charm', 2], ['Reload Charm', 1]], skills: [] });
});

/** From now on this page's storage refuses every write of these keys, as a full or blocked storage does; `free` lets them through again. */
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
const free = (page: Page): Promise<void> => page.evaluate(() => { (window as any).e2eFull.clear(); });
const storedName = async (page: Page): Promise<string> => JSON.parse((await stored(page, V5)) ?? 'null').hunters[0].name;
const SAVE_FAILED = 'Saving failed';
const OWN_SETTINGS = 'device settings';
const banner = (page: Page, text: string) => page.locator('#banners .banner', { hasText: text });

test('storage full on a write: the player is told, the change stays on screen, and it is saved once storage has room', async ({ device }) => {
  const text = playerSaveText();
  const { page } = await device('phone', { seed: { [V5]: text }, pinTo: pinAfter(text) });
  await openApp(page);
  await go(page, 'status');
  const inventory = page.locator('#view-status [data-panel="inventory"]');

  await test.step('a change storage refuses shows a banner and stays on screen', async () => {
    await fill(page, V5);
    await editIdentity(page, 'name', 'Mira Unsaved');
    await expect(banner(page, SAVE_FAILED)).toHaveCount(1);
    await expect(page.locator('#view-status [data-idname]')).toHaveText('Mira Unsaved');
    expect(await storedName(page)).toBe('Mira Fixture');
  });

  await test.step('a second change while storage is full keeps the banner up', async () => {
    await inventory.locator('[data-form] [name="name"]').fill('Full Storage Charm');
    await inventory.locator('[data-form] button[type="submit"]').tap();
    await expect(inventory.locator('.inv-card .i-name')).toHaveText(['Player Charm', 'Full Storage Charm']);
    await expect(banner(page, SAVE_FAILED)).toHaveCount(1);
    expect(await storedName(page)).toBe('Mira Fixture');
  });

  await test.step('with room again, the next change saves both earlier ones and the banner goes', async () => {
    await free(page);
    await editIdentity(page, 'name', 'Mira Saved');
    await expect(banner(page, SAVE_FAILED)).toHaveCount(0);
    await expect.poll(() => storedName(page)).toBe('Mira Saved');
    expect(JSON.parse((await stored(page, V5))!).hunters[0].items.map((i: any) => i.name)).toEqual(['Player Charm', 'Full Storage Charm']);
  });
});

test('a change storage refused is saved when the page is reloaded once storage has room, with no change after it', async ({ device }) => {
  const text = playerSaveText();
  const { page } = await device('phone', { seed: { [V5]: text }, pinTo: pinAfter(text) });
  await openApp(page);
  await go(page, 'status');
  await fill(page, V5);
  await editIdentity(page, 'name', 'Mira Kept On Leaving');
  await expect(banner(page, SAVE_FAILED)).toHaveCount(1);
  await free(page);
  await openApp(page);
  await expect(page.locator('#banners .banner')).toHaveCount(0);
  await go(page, 'status');
  await expect(page.locator('#view-status [data-idname]')).toHaveText('Mira Kept On Leaving');
});

test('a reload between a change and its write keeps the change', async ({ device }) => {
  const text = playerSaveText();
  const { page } = await device('phone', { seed: { [V5]: text }, pinTo: pinAfter(text) });
  await openApp(page);
  await go(page, 'status');
  const inventory = page.locator('#view-status [data-panel="inventory"]');
  await inventory.locator('[data-form] [name="name"]').fill('Between Writes');
  // The page reloads itself in the task of the change, so the test waits for that reload: a second navigation asked for
  // from here would race it ("interrupted by another navigation").
  const reloaded = page.waitForEvent('load');
  await page.evaluate(() => {
    const form = document.querySelector('#view-status [data-panel="inventory"] [data-form]') as HTMLFormElement;
    form.requestSubmit();
    sessionStorage.setItem('e2e-life-at-reload', JSON.stringify(hunterApp.store.life()));
    location.reload();
  });
  await reloaded;
  await page.waitForFunction(() => window.hunterApp && document.querySelectorAll('#nav-top a').length > 0, null, { timeout: 15_000 });
  const lifeAtReload = await page.evaluate(() => sessionStorage.getItem('e2e-life-at-reload'));
  expect(JSON.parse(lifeAtReload ?? 'null'), 'the reload came before the change\'s write').toEqual({ at: 'ready', write: 'dirty' });
  await expectSheetShows(page, { name: 'Mira Fixture', level: 1, xp: 0, gold: 0, items: [['Player Charm', 2], ['Between Writes', 1]], skills: [] });
});

test('another tab\'s save shows in this tab while this tab has nothing unsaved', async ({ device }) => {
  const text = playerSaveText();
  const { page, ctx } = await device('first tab', { seed: { [V5]: text }, pinTo: pinAfter(text) });
  await openApp(page);
  const other = await ctx.newPage();
  await openApp(other);
  await go(other, 'status');
  await editIdentity(other, 'name', 'Named In The Other Tab');
  await go(page, 'status');
  await expect(page.locator('#view-status [data-idname]')).toHaveText('Named In The Other Tab');
  await expect(page.locator('#banners .banner')).toHaveCount(0);
});

test('another tab saving while this tab holds a change storage refused: this tab says so, keeps its change in Backups and stops saving over the other', async ({ device }) => {
  const text = playerSaveText();
  const { page, ctx } = await device('first tab', { seed: { [V5]: text }, pinTo: pinAfter(text) });
  await openApp(page);
  const other = await ctx.newPage();
  await openApp(other);

  await test.step('this tab holds a change storage refused', async () => {
    await go(page, 'status');
    await fill(page, V5);
    await editIdentity(page, 'name', 'Named In This Tab');
    await expect(banner(page, SAVE_FAILED)).toHaveCount(1);
  });

  await test.step('the other tab saves: this tab shows the blocking takeover screen, keeps its change in Backups, and stops saving over the other', async () => {
    await go(other, 'status');
    await editIdentity(other, 'name', 'Named In The Other Tab');
    const win = page.locator('.tk-overlay.show .tk-win');
    await expect(win).toContainText(TAKEOVER_WORDS.causes.otherTab.heading);
    await expect(page.locator('#banners .banner')).toHaveCount(0);
    await expect(page.locator('#view-status [data-idname]')).toHaveText('Named In The Other Tab');
    expect(await page.evaluate(() => (document.getElementById('main') as HTMLElement).inert)).toBe(true);
    await free(page);
    expect(await storedName(page)).toBe('Named In The Other Tab');
  });

  await test.step('after a reload this tab saves again, and its change comes back from Backups', async () => {
    await openApp(page);
    await expect(page.locator('.tk-overlay.show')).toHaveCount(0);
    await expect(page.locator('#banners .banner')).toHaveCount(0);
    await go(page, 'data');
    const kept = page.locator('#view-data [data-backups] li', { hasText: 'before another tab saved' });
    await expect(kept).toHaveCount(1);
    await kept.getByRole('button', { name: /^Restore/ }).tap();
    await answerWindow(page, 'Restore this backup?', 'Restore');
    await go(page, 'status');
    await expect(page.locator('#view-status [data-idname]')).toHaveText('Named In This Tab');
    await expect.poll(() => storedName(page)).toBe('Named In This Tab');
  });
});

test('another tab saving while storage is too full to keep this tab\'s unsaved change in Backups: this tab keeps showing it behind the takeover screen and offers Export backup', async ({ device }) => {
  const text = playerSaveText();
  const { page, ctx } = await device('first tab', { seed: { [V5]: text }, pinTo: pinAfter(text) });
  await openApp(page);
  const other = await ctx.newPage();
  await openApp(other);
  await go(page, 'status');
  await fill(page, V5, BACKUPS);
  await editIdentity(page, 'name', 'Named In This Tab');
  await expect(banner(page, SAVE_FAILED)).toHaveCount(1);
  await go(other, 'status');
  await editIdentity(other, 'name', 'Named In The Other Tab');
  const win = page.locator('.tk-overlay.show .tk-win');
  await expect(win).toContainText(TAKEOVER_WORDS.causes.mineUnkept.heading);
  await expect(win).toContainText(TAKEOVER_WORDS.causes.mineUnkept.body[0]!);
  await expect(page.locator('#banners .banner')).toHaveCount(0);
  await expect(page.locator('#view-status [data-idname]')).toHaveText('Named In This Tab');
  expect(await page.evaluate(() => (document.getElementById('main') as HTMLElement).inert)).toBe(true);
  expect(await storedName(page)).toBe('Named In The Other Tab');
});

test('a save the app cannot open, when storage is too full to back it up, is never written over: the blocking takeover screen says so and omits Take over here', async ({ device }) => {
  const junk = 'not json {name: Lost Hunter';
  const { page, ctx } = await device('phone', { seed: { [V5]: junk } });
  await ctx.addInitScript(key => {
    const set = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k: string, v: string) {
      if (k === key) throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
      return set.call(this, k, v);
    };
  }, BACKUPS);
  await openApp(page);
  const win = page.locator('.tk-overlay.show .tk-win');
  await expect(win).toContainText(TAKEOVER_WORDS.causes.loadUnkept.heading);
  await expect(win).toContainText(TAKEOVER_WORDS.causes.loadUnkept.body[0]!);
  await expect(win.getByRole('button', { name: TAKEOVER_WORDS.takeOver })).toHaveCount(0);
  await expect(page.locator('#banners .banner')).toHaveCount(0);
  expect(await page.evaluate(() => (document.getElementById('main') as HTMLElement).inert)).toBe(true);
  expect(await stored(page, V5)).toBe(junk);
});

test('a save that opens whole but for its damaged fight, when storage is too full to back it up, says the fight could not be read, not that the save could not be opened', async ({ device }) => {
  // SMX-sync-9.2: the banner said "Your save could not be opened" over a hunter and campaign that had opened
  const env = { now: noonDate(), newDeviceId: () => parseDeviceId('d-e2e-fight')!, newDeviceToken: () => 'test-device-token-0123456789abcd' };
  const base = freshSave(env, { onboarded: true });
  const text = JSON.stringify({ ...base, hunters: [{ ...base.hunters[0]!, name: 'Intact Hero' }], fight: { phase: 'running', rows: 'not rows' } });
  const { page, ctx } = await device('phone', { seed: { [V5]: text } });
  await ctx.addInitScript(key => {
    const set = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k: string, v: string) {
      if (k === key) throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
      return set.call(this, k, v);
    };
  }, BACKUPS);
  await openApp(page);
  const win = page.locator('.tk-overlay.show .tk-win');
  await expect(win).toContainText(TAKEOVER_WORDS.causes.fightUnkept.heading);
  await expect(win).not.toContainText(TAKEOVER_WORDS.causes.loadUnkept.heading);
  await expect(win.getByRole('button', { name: TAKEOVER_WORDS.takeOver })).toHaveCount(0);
  await expect(page.locator('#banners .banner')).toHaveCount(0);
  await expect(page.locator('#view-status [data-idname]')).toHaveText('Intact Hero');
  expect(await page.evaluate(() => (document.getElementById('main') as HTMLElement).inert)).toBe(true);
  expect(await stored(page, V5)).toBe(text);
});

test('a reset that cannot back up the campaign first asks before it goes on, and Cancel keeps the campaign', async ({ device }) => {
  const text = playerSaveText();
  const { page } = await device('phone', { seed: { [V5]: text }, pinTo: pinAfter(text) });
  await openApp(page);
  await go(page, 'data');
  await fill(page, BACKUPS);
  await page.locator('#view-data [data-backup-now]').tap();
  await answerWindow(page, 'No backup saved');
  await page.locator('#view-data [data-reset]').tap();
  const prompt = page.locator('.sys-overlay.show', { hasText: 'Reset campaign?' });
  await prompt.locator('input').fill('RESET');
  await prompt.locator('.sys-actions button.danger').tap();
  await answerWindow(page, 'No backup saved', 'Cancel');
  await go(page, 'status');
  await expect(page.locator('#view-status [data-idname]')).toHaveText('Mira Fixture');
  expect(await storedName(page)).toBe('Mira Fixture');
});

test('with no browser storage the app still opens, and says progress will not be saved', async ({ device }) => {
  const { page, ctx } = await device('phone');
  await ctx.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('The operation is insecure.', 'SecurityError'); } });
  });
  await openApp(page);
  await expect(banner(page, 'Browser storage is unavailable')).toHaveCount(1);
});

test('a failed write of this phone\'s own settings is told, and the banner goes once one is kept', async ({ device }) => {
  const text = playerSaveText();
  const { page } = await device('phone', { seed: { [V5]: text }, pinTo: pinAfter(text) });
  await openApp(page);
  await go(page, 'device');
  await fill(page, 'hunter-system-prefs');
  await page.locator('[data-acc=violet]').tap();
  await expect(banner(page, OWN_SETTINGS)).toHaveCount(1);
  await free(page);
  await page.locator('[data-acc=cyan]').tap();
  await expect(banner(page, OWN_SETTINGS)).toHaveCount(0);
});
