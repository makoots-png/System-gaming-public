// The party stash on screen (src/views/trade.js, src/core/trade/stash.ts): players in a GM's room put things in from the
// Give window and take them out on the Bag's Stash tab; the GM's phone answers each ask in the order the room brings
// them and lists the stash in "Trades and stash" with Remove, held under Undo. Driven through the UI; the store sets up and reads.
import type { Page } from '@playwright/test';
import { STASH_WORDS } from '../../src/core/trade/stash.ts';
import { test, expect, type DeviceOptions, onboardGM, onboardPlayer, createRoom, dismissAll, go, adhoc } from './helpers.ts';

type Table = { gm: Page; mira: Page; eldrin: Page; gmCtx: import('@playwright/test').BrowserContext };
const CUT = [/Failed to load resource: net::ERR_(FAILED|INTERNET_DISCONNECTED)/];

/** A GM's room with Mira's phone and Eldrin's phone in it. `gmAway`: the GM's phone may be cut off, its cut requests' console lines allowed. */
async function table(device: (label: string, o?: DeviceOptions) => Promise<{ page: Page; ctx: import('@playwright/test').BrowserContext }>, o: { gmAway?: boolean } = {}): Promise<Table> {
  const g = await device('gm', o.gmAway ? { blockServiceWorker: true, allowConsole: CUT } : {});
  const mira = (await device('mira')).page, eldrin = (await device('eldrin')).page;
  await onboardGM(g.page);
  const code = await createRoom(g.page);
  await onboardPlayer(mira, 'Mira', code);
  await onboardPlayer(eldrin, 'Eldrin', code);
  for (const p of [mira, eldrin]) {
    await expect.poll(() => p.evaluate(() => hunterApp.api.sync.room())).toBe(code);
    await dismissAll(p, 4);
  }
  return { gm: g.page, mira, eldrin, gmCtx: g.ctx };
}
/** Puts `n` Healing Potions, the hunter's own item, in the active hunter's bag, as setup. */
const stock = (page: Page, n: number): Promise<void> => page.evaluate(g => {
  hunterApp.api.inventory.addItem(hunterApp.store.active().id, g);
}, adhoc({ name: 'Healing Potion', rar: 'common', type: 'consumable' }, n));
const has = (page: Page): Promise<number> => page.evaluate(() => hunterApp.api.inventory.bag(hunterApp.store.active()).filter((i: any) => i.name === 'Healing Potion').reduce((a: number, i: any) => a + i.qty, 0));
const stashOf = (gm: Page): Promise<string[]> => gm.evaluate(() => hunterApp.api.inventory.bag(hunterApp.store.get().stash).map((i: any) => `${i.name} ${i.qty}`));
const tradeLog = (gm: Page): Promise<string[]> => gm.evaluate(() => hunterApp.store.get().log.filter((l: any) => l.kind === 'trade').map((l: any) => l.text));

/** The Bag on the Status view, on tab `tab`. */
async function bag(page: Page, tab: 'Items' | 'Stash') {
  await go(page, 'status');
  const panel = page.locator('[data-panel="inventory"]');
  await panel.locator('[role=tab]', { hasText: tab }).tap();
  return panel;
}
/** Give on the Healing Potion row, Party stash picked, `n` of them, and Put in the stash tapped. */
async function putIn(page: Page, n: number): Promise<void> {
  const panel = await bag(page, 'Items');
  await panel.getByRole('button', { name: 'Give Healing Potion' }).tap();
  const win = page.locator('.sys-overlay.show', { hasText: 'Give Healing Potion' });
  await expect(win).toBeVisible();
  if (n > 1) await win.locator('[data-tr-n]').fill(String(n));
  await win.locator('[data-tr-to]', { hasText: 'Party stash' }).tap();
  await expect(win.locator('[data-tr-hint]')).toHaveText('Anyone in the room can take it out.');
  await win.getByRole('button', { name: 'Put in the stash' }).tap();
  await expect(win).toHaveCount(0);
}
/** The stash's line `text` on the Stash tab, once the room's stash doc shows it. */
async function stashLine(page: Page, text: string) {
  const panel = await bag(page, 'Stash');
  const line = panel.locator('[data-tr-list="stash"] .tr-line', { hasText: text });
  await expect(line).toBeVisible({ timeout: 20_000 });
  return line;
}
/** The GM view's "Trades and stash" section, open. */
async function gmSection(gm: Page) {
  await go(gm, 'gm');
  const toggle = gm.locator('[data-tog="trade"]');
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.tap();
  return gm.locator('#gm-trade');
}

test('Mira puts two potions in the stash and Eldrin takes one', async ({ device }) => {
  const { gm, mira, eldrin } = await table(device);
  await stock(mira, 3);

  await test.step('Mira puts two of her three in: they wait aside until the GM\'s phone keeps them', async () => {
    await putIn(mira, 2);
    expect(await has(mira)).toBe(1);
    await expect(mira.locator('#toasts .toast', { hasText: 'In the stash: Healing Potion × 2.' })).toBeVisible({ timeout: 20_000 });
    await expect.poll(() => stashOf(gm), { timeout: 20_000 }).toEqual(['Healing Potion 2']);
    expect(await has(mira), 'kept: nothing comes back').toBe(1);
  });

  await test.step('the GM\'s section lists the stash and its head counts it', async () => {
    const sec = await gmSection(gm);
    await expect(sec.locator('[data-tr-list="gm-stash"] .tr-offer')).toHaveCount(1);
    await expect(sec.getByRole('button', { name: 'Remove: Healing Potion × 2' })).toBeVisible();
    await expect(gm.locator('#gm-hsum-trade')).toHaveText(STASH_WORDS.summary(1));
  });

  await test.step('Eldrin takes one: the window asks how many, and the potion lands once the GM\'s phone answers', async () => {
    const line = await stashLine(eldrin, 'Healing Potion × 2');
    await line.getByRole('button', { name: 'Take: Healing Potion' }).tap();
    const win = eldrin.locator('.sys-overlay.show', { hasText: 'Take Healing Potion' });
    await expect(win).toContainText(STASH_WORDS.howMany(2));
    await win.getByRole('button', { name: 'Take' }).tap();
    await expect.poll(() => has(eldrin), { timeout: 20_000 }).toBe(1);
    await expect(eldrin.locator('#toasts .toast', { hasText: 'From the stash: 1 Healing Potion.' })).toBeVisible();
    await expect.poll(() => stashOf(gm)).toEqual(['Healing Potion 1']);
    await expect(await stashLine(eldrin, 'Healing Potion')).not.toContainText('×');
  });

  await test.step('the GM\'s session log has each, once', async () => {
    await expect.poll(() => tradeLog(gm)).toEqual(['Eldrin took 1 Healing Potion from the stash.', 'Mira put Healing Potion × 2 in the stash.']);
  });
});

test('two players take the last potion: one gets it, the other is told', async ({ device }) => {
  const { gm, mira, eldrin } = await table(device);
  await stock(gm, 1);
  await putIn(gm, 1);
  expect(await stashOf(gm), 'the GM\'s own hunter puts in at once').toEqual(['Healing Potion 1']);

  const lines = [await stashLine(mira, 'Healing Potion'), await stashLine(eldrin, 'Healing Potion')];
  for (const line of lines) await line.getByRole('button', { name: 'Take: Healing Potion' }).tap();
  await expect.poll(async () => (await has(mira)) + (await has(eldrin)), { timeout: 30_000 }).toBe(1);
  const loser = (await has(mira)) ? eldrin : mira;
  await expect(loser.locator('#toasts .toast', { hasText: 'The stash has no Healing Potion left.' })).toBeVisible({ timeout: 20_000 });
  await expect.poll(() => stashOf(gm)).toEqual([]);
  for (const p of [mira, eldrin]) await expect.poll(() => p.evaluate(() => hunterApp.store.get().settings.sync.asked ?? [])).toEqual([]);
  expect((await has(mira)) + (await has(eldrin)), 'given once, across both answers').toBe(1);
});

test('with the GM\'s phone away, the stash shows the time of what it shows, and a take waits and is answered when it is back', async ({ device }) => {
  const { gm, eldrin, gmCtx } = await table(device, { gmAway: true });
  await stock(gm, 1);
  await putIn(gm, 1);
  const line = await stashLine(eldrin, 'Healing Potion');

  await gmCtx.setOffline(true);
  await line.getByRole('button', { name: 'Take: Healing Potion' }).tap();
  const waiting = eldrin.locator('[data-tr-list="asks"] .tr-offer');
  await expect(waiting).toContainText('Take: 1 Healing Potion.');
  await expect(waiting.locator('.tr-state')).toHaveText(STASH_WORDS.waitingLine);
  await expect(eldrin.locator('[data-panel="inventory"] .tr-hint', { hasText: STASH_WORDS.order })).toBeVisible();
  const stored = await eldrin.evaluate(() => { const d = new Date(hunterApp.api.sync.docAt('stash')); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; });
  await expect(eldrin.locator('[data-panel="inventory"] [data-tr-asof]'), 'the stash shows the time the room stored it').toHaveText(STASH_WORDS.asOf(stored));
  await expect.poll(() => eldrin.evaluate(() => (hunterApp.store.get().settings.sync.asked ?? []).map((w: any) => w.state)), { timeout: 20_000 }).toEqual(['taken']);
  expect(await has(eldrin), 'nothing lands while the GM\'s phone is away').toBe(0);

  await gmCtx.setOffline(false);
  await expect.poll(() => has(eldrin), { timeout: 60_000 }).toBe(1);
  await expect(waiting).toHaveCount(0);
  expect(await stashOf(gm)).toEqual([]);
});

test('the GM removes a line, held under Undo first', async ({ device }) => {
  const { gm, mira } = await table(device);
  await stock(mira, 2);
  await putIn(mira, 2);
  await expect.poll(() => stashOf(gm), { timeout: 20_000 }).toEqual(['Healing Potion 2']);
  const sec = await gmSection(gm);
  const held = gm.locator('#toasts .toast', { hasText: 'You removed Healing Potion × 2 from the stash.' });

  await test.step('Undo keeps the line', async () => {
    await sec.getByRole('button', { name: 'Remove: Healing Potion × 2' }).tap();
    await held.getByRole('button', { name: 'Undo' }).tap();
    await expect(held).toHaveCount(0);
    expect(await stashOf(gm)).toEqual(['Healing Potion 2']);
    expect(await tradeLog(gm)).not.toContain('You removed Healing Potion × 2 from the stash.');
  });

  await test.step('left alone, the line is gone and logged, and Mira\'s stash reads empty', async () => {
    await sec.getByRole('button', { name: 'Remove: Healing Potion × 2' }).tap();
    await expect(held.getByRole('button', { name: 'Undo' })).toBeVisible();
    await expect(sec.locator('[data-tr-list="gm-stash"]')).toHaveText('The stash is empty.', { timeout: 10_000 });
    expect(await tradeLog(gm)).toContain('You removed Healing Potion × 2 from the stash.');
    await expect(await stashEmpty(mira)).toBeVisible({ timeout: 20_000 });
  });
});

/** The stash's empty line on the Stash tab. */
async function stashEmpty(page: Page) {
  const panel = await bag(page, 'Stash');
  return panel.locator('[data-tr-list="stash"] .empty', { hasText: 'The stash is empty.' });
}
