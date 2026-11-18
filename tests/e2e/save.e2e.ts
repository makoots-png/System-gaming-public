import { readFile } from 'node:fs/promises';
import { freshSave } from '../../src/core/save.ts';
import { parseDeviceId } from '../../src/core/ids.ts';
import { test, expect, openApp, onboardPlayer, dismissAll, editIdentity, go, save, answerWindow, type Page } from './helpers.ts';

const V1 = 'hunter-system-v1', V2 = 'hunter-system-v2', V3 = 'hunter-system-v3', V4 = 'hunter-system-v4', BACKUPS = 'hunter-system-backups';
/** The reason the backups give an old save's text, and the words of the banner and of a refused import. */
const OLD_REASON = 'before the new combat rules';
const OLD_BANNER = 'This save is from before the new combat rules. It is kept in Backups, and the app starts a new campaign.';
const OLD_IMPORT = 'This save is from before the new combat rules, and this app cannot open it.';

const fixturePath = (name: string): string => `${test.info().project.testDir}/../fixtures/saves/${name}`;
const fixtureText = (name: string): Promise<string> => readFile(fixturePath(name), 'utf8');
const pinAfter = (text: string): string => new Date(Date.parse(JSON.parse(text).savedAt) + 60_000).toISOString();
/** A save made on main, stamped with this app's schema so the app reads it as its own, with personal gates off: a
 * hunter alone gets one on open, and its "A GATE HAS APPEARED" window would stand over the steps these tests take. */
const asCurrent = (text: string): string => {
  const s = JSON.parse(text);
  return JSON.stringify({ ...s, schema: 4, rulesOverrides: { ...s.rulesOverrides, solo: { personal: false } } });
};

const stored = (page: Page, key: string): Promise<string | null> => page.evaluate(k => localStorage.getItem(k), key);
/** The texts the backups hold under this reason. */
const backedUp = (page: Page, reason: string): Promise<string[]> => page.evaluate(([key, wanted]) => {
  const ring: { reason: string; data: string }[] = JSON.parse(localStorage.getItem(key ?? '') ?? '[]');
  return ring.filter(b => b.reason === wanted).map(b => b.data);
}, [BACKUPS, reason]);

/** The app wrote a new schema 4 save under its own key and left the old key as it was. */
async function expectNewSaveAndOldKept(page: Page, oldKey: string, oldText: string): Promise<void> {
  expect(JSON.parse((await stored(page, V4)) ?? 'null')).toMatchObject({ schema: 4 });
  expect(await stored(page, oldKey)).toBe(oldText);
}

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

/** The player sees the old-save banner and a new campaign, and the Data panel lists one backup that holds exactly the old text. */
async function expectNewCampaignAndOldKept(page: Page, oldKey: string, oldText: string): Promise<void> {
  await expect(page.locator('#banners .banner')).toHaveCount(1);
  await expect(page.locator('#banners .banner')).toContainText(OLD_BANNER);
  await expect(page.locator('.sys-overlay.show')).toHaveCount(0);
  await go(page, 'status');
  await expect(page.locator('#view-status [data-idname]')).toHaveText('Sung Jin-Woo');
  await go(page, 'data');
  await expect(page.locator('#view-data [data-backups] li', { hasText: OLD_REASON })).toHaveCount(1);
  expect(await backedUp(page, OLD_REASON)).toEqual([oldText]);
  await expectNewSaveAndOldKept(page, oldKey, oldText);
}

test('a v1 save and player and GM saves made before the new combat rules open a new campaign, say so, and keep their text in Backups', async ({ device }) => {
  const schema3 = JSON.stringify({ ...JSON.parse(await fixtureText('main-gm-starter.json')), schema: 3 });
  const cases: [string, string, string][] = [
    ['a v1 save', V1, await fixtureText('v1-save.json')],
    ['a player save made on main', V2, await fixtureText('main-player.json')],
    ['a GM save of schema 3', V3, schema3],
  ];
  let last: Page | null = null;
  for (const [what, key, text] of cases) {
    await test.step(`${what} opens a new campaign`, async () => {
      const { page } = await device(what, { seed: { [key]: text } });
      await openApp(page);
      await expectNewCampaignAndOldKept(page, key, text);
      last = page;
    });
  }

  await test.step('an old campaign file chosen in the Data panel is refused before any preview offers to import it, and the campaign stays', async () => {
    const page = last!, before = (await save(page)).hunters;
    await go(page, 'data');
    await page.locator('#view-data [data-import]').setInputFiles(fixturePath('main-export.json'));
    await expect(page.locator('.sys-overlay.show', { hasText: 'Import failed' })).toContainText(OLD_IMPORT);
    await expect(page.locator('.sys-overlay.show', { hasText: 'Import preview' })).toHaveCount(0);
    await answerWindow(page, 'Import failed');
    expect((await save(page)).hunters).toEqual(before);
    await go(page, 'status');
    await expect(page.locator('#view-status [data-idname]')).toHaveText('Sung Jin-Woo');
  });
});

test('a campaign exported from the Data panel and imported on another phone brings the same hunters back', async ({ device }) => {
  const text = asCurrent(await fixtureText('main-export.json')), fixture = JSON.parse(text);
  const pinTo = pinAfter(text);
  const first = (await device('first phone', { seed: { [V4]: text }, pinTo })).page, second = (await device('second phone', { pinTo })).page;
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

  await test.step('a fresh second phone imports that file and has the same hunters', async () => {
    await onboardPlayer(second, 'Second Phone');
    await dismissAll(second, 4);
    const identity = () => second.evaluate(() => { const s = hunterApp.store.get().settings; return [s.deviceId, s.sync.deviceToken]; });
    const mine = await identity();
    await importThroughDataPanel(second, exported);
    await expectHuntersMatch(second, hunters);
    expect(await identity(), 'the second phone is still itself to the room').toEqual(mine);
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
  const { page } = await device('phone', { seed: { [V2]: junk } });
  await openApp(page);
  await expectWarnedAndBackedUp(page, junk);
});

test('a save of the wrong shape warns the player and keeps the old text in the backups', async ({ device }) => {
  const odd = JSON.stringify({ schema: 2, hunters: { h1: { name: 'Odd Shape Hunter', level: 4 } } });
  const { page } = await device('phone', { seed: { [V2]: odd } });
  await openApp(page);
  await expectWarnedAndBackedUp(page, odd);
  expect(await stored(page, V2)).toBe(odd);
});

test('a current save of the wrong shape warns the player and keeps the old text in the backups', async ({ device }) => {
  const odd = JSON.stringify({ schema: 4, hunters: { h1: { name: 'Odd Shape Hunter', level: 4 } } });
  const { page } = await device('phone', { seed: { [V4]: odd } });
  await openApp(page);
  await expectWarnedAndBackedUp(page, odd);
});

test('a save whose running fight is damaged opens without the fight, says so, and keeps the save as it was in the backups', async ({ device }) => {
  const env = { now: new Date(), newDeviceId: () => parseDeviceId('d-e2e-fight')!, newDeviceToken: () => 'test-device-token-0123456789abcd' };
  const base = freshSave(env, { onboarded: true });
  const text = JSON.stringify({ ...base, hunters: [{ ...base.hunters[0]!, name: 'Kept Hunter' }], fight: { phase: 'running', rows: 'not rows' } });
  const { page } = await device('phone', { seed: { [V4]: text } });
  await openApp(page);
  await expect(page.locator('#banners .banner')).toHaveCount(1);
  await expect(page.locator('#banners .banner')).toContainText('running fight');
  expect((await save(page)).fight).toBeNull();
  await go(page, 'status');
  await expect(page.locator('#view-status [data-idname]')).toHaveText('Kept Hunter');
  expect(await backedUp(page, 'a fight that could not be read')).toEqual([text]);
});

test('a player who opens the app days after their last daily meets the PENALTY window as the app opens', async ({ device }) => {
  const env = { now: new Date(Date.now() - 3 * 86_400_000), newDeviceId: () => parseDeviceId('d-e2e-late')!, newDeviceToken: () => 'test-device-token-0123456789abcd' };
  const { page } = await device('phone', { seed: { [V4]: JSON.stringify(freshSave(env, { onboarded: true })) } });
  await openApp(page);
  await expect(page.locator('.sys-overlay.show')).toContainText('PENALTY');
  await dismissAll(page);
  await go(page, 'status');
  await expect(page.locator('#view-status .chip', { hasText: 'Penalized' })).toHaveCount(1);
});

test('a save from a newer app opens read-only: the screen refuses a change rather than show one the reload drops, and nothing is overwritten', async ({ device }) => {
  const text = JSON.stringify({ ...JSON.parse(await fixtureText('main-player.json')), schema: 99 });
  const { page } = await device('phone', { seed: { [V4]: text }, pinTo: pinAfter(text) });
  await openApp(page);
  await expect(page.locator('#banners .banner')).toContainText('newer version');
  await go(page, 'status');
  await expect(page.locator('#view-status [data-idname]')).toHaveText('Mira Fixture');
  await editIdentity(page, 'name', 'Renamed On Old App');
  await expect(page.locator('#view-status [data-idname]')).toHaveText('Mira Fixture');
  expect((await save(page)).hunters[0].name).toBe('Mira Fixture');
  expect(await stored(page, V4)).toBe(text);

  await openApp(page);
  await expect(page.locator('#banners .banner')).toContainText('newer version');
  await go(page, 'status');
  await expect(page.locator('#view-status [data-idname]')).toHaveText('Mira Fixture');
  expect(await stored(page, V4)).toBe(text);
});

test('a renamed hunter and a newly stored item are still there after reloading the page', async ({ device }) => {
  const text = asCurrent(await fixtureText('main-player.json'));
  const { page } = await device('phone', { seed: { [V4]: text }, pinTo: pinAfter(text) });
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
const storedName = async (page: Page): Promise<string> => JSON.parse((await stored(page, V4)) ?? 'null').hunters[0].name;
const SAVE_FAILED = 'Saving failed';
const OTHER_TAB = 'Another tab saved this campaign';
const OWN_SETTINGS = 'own settings';
const banner = (page: Page, text: string) => page.locator('#banners .banner', { hasText: text });

test('storage full on a write: the player is told, the change stays on screen, and it is saved once storage has room', async ({ device }) => {
  const text = asCurrent(await fixtureText('main-player.json'));
  const { page } = await device('phone', { seed: { [V4]: text }, pinTo: pinAfter(text) });
  await openApp(page);
  await go(page, 'status');
  const inventory = page.locator('#view-status [data-panel="inventory"]');

  await test.step('a change storage refuses shows a banner and stays on screen', async () => {
    await fill(page, V4);
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
    expect(JSON.parse((await stored(page, V4))!).hunters[0].items.map((i: any) => i.name)).toEqual(['Player Charm', 'Full Storage Charm']);
  });
});

test('a change storage refused is saved when the page is reloaded once storage has room, with no change after it', async ({ device }) => {
  const text = asCurrent(await fixtureText('main-player.json'));
  const { page } = await device('phone', { seed: { [V4]: text }, pinTo: pinAfter(text) });
  await openApp(page);
  await go(page, 'status');
  await fill(page, V4);
  await editIdentity(page, 'name', 'Mira Kept On Leaving');
  await expect(banner(page, SAVE_FAILED)).toHaveCount(1);
  await free(page);
  await openApp(page);
  await expect(page.locator('#banners .banner')).toHaveCount(0);
  await go(page, 'status');
  await expect(page.locator('#view-status [data-idname]')).toHaveText('Mira Kept On Leaving');
});

test('a reload between a change and its write keeps the change', async ({ device }) => {
  const text = asCurrent(await fixtureText('main-player.json'));
  const { page } = await device('phone', { seed: { [V4]: text }, pinTo: pinAfter(text) });
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
  const text = asCurrent(await fixtureText('main-player.json'));
  const { page, ctx } = await device('first tab', { seed: { [V4]: text }, pinTo: pinAfter(text) });
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
  const text = asCurrent(await fixtureText('main-player.json'));
  const { page, ctx } = await device('first tab', { seed: { [V4]: text }, pinTo: pinAfter(text) });
  await openApp(page);
  const other = await ctx.newPage();
  await openApp(other);

  await test.step('this tab holds a change storage refused', async () => {
    await go(page, 'status');
    await fill(page, V4);
    await editIdentity(page, 'name', 'Named In This Tab');
    await expect(banner(page, SAVE_FAILED)).toHaveCount(1);
  });

  await test.step('the other tab saves: this tab shows its save, says it stopped saving, and refuses a change', async () => {
    await go(other, 'status');
    await editIdentity(other, 'name', 'Named In The Other Tab');
    await expect(banner(page, OTHER_TAB)).toHaveCount(1);
    await expect(page.locator('#view-status [data-idname]')).toHaveText('Named In The Other Tab');
    await free(page);
    await editIdentity(page, 'name', 'Refused In This Tab');
    await expect(page.locator('#view-status [data-idname]')).toHaveText('Named In The Other Tab');
    expect(await storedName(page)).toBe('Named In The Other Tab');
  });

  await test.step('after a reload this tab saves again, and its change comes back from Backups', async () => {
    await openApp(page);
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

test('another tab saving while storage is too full to keep this tab\'s unsaved change in Backups: this tab keeps showing it, says to export it, and refuses a change', async ({ device }) => {
  const text = asCurrent(await fixtureText('main-player.json'));
  const { page, ctx } = await device('first tab', { seed: { [V4]: text }, pinTo: pinAfter(text) });
  await openApp(page);
  const other = await ctx.newPage();
  await openApp(other);
  await go(page, 'status');
  await fill(page, V4, BACKUPS);
  await editIdentity(page, 'name', 'Named In This Tab');
  await expect(banner(page, SAVE_FAILED)).toHaveCount(1);
  await go(other, 'status');
  await editIdentity(other, 'name', 'Named In The Other Tab');
  await expect(banner(page, 'export them from the Data tab')).toHaveCount(1);
  await expect(banner(page, 'is in Backups'), 'no banner says the change is in Backups').toHaveCount(0);
  await expect(page.locator('#view-status [data-idname]')).toHaveText('Named In This Tab');
  await editIdentity(page, 'name', 'Refused In This Tab');
  await expect(page.locator('#view-status [data-idname]')).toHaveText('Named In This Tab');
  expect(await storedName(page)).toBe('Named In The Other Tab');
});

test('a save the app cannot open, when storage is too full to back it up, is never written over: the app says so and refuses a change', async ({ device }) => {
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
  await expect(banner(page, 'too full to keep a copy of it in Backups')).toHaveCount(1);
  await expect(banner(page, 'unreadable')).toHaveCount(0);
  await go(page, 'status');
  await editIdentity(page, 'name', 'Written Over');
  await expect(page.locator('#view-status [data-idname]')).not.toHaveText('Written Over');
  expect(await stored(page, V4)).toBe(junk);
});

test('a reset that cannot back up the campaign first asks before it goes on, and Cancel keeps the campaign', async ({ device }) => {
  const text = asCurrent(await fixtureText('main-player.json'));
  const { page } = await device('phone', { seed: { [V4]: text }, pinTo: pinAfter(text) });
  await openApp(page);
  await go(page, 'data');
  await fill(page, BACKUPS);
  await page.locator('#view-data [data-backup-now]').tap();
  await answerWindow(page, 'No backup saved');
  await page.locator('#view-data [data-reset]').tap();
  const prompt = page.locator('.sys-overlay.show', { hasText: 'Reset campaign?' });
  await prompt.locator('input').fill('RESET');
  await prompt.locator('.sys-actions button.primary').tap();
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
  const text = asCurrent(await fixtureText('main-player.json'));
  const { page } = await device('phone', { seed: { [V4]: text }, pinTo: pinAfter(text) });
  await openApp(page);
  await go(page, 'device');
  await fill(page, 'hunter-system-prefs');
  await page.locator('[data-acc=violet]').tap();
  await expect(banner(page, OWN_SETTINGS)).toHaveCount(1);
  await free(page);
  await page.locator('[data-acc=cyan]').tap();
  await expect(banner(page, OWN_SETTINGS)).toHaveCount(0);
});
