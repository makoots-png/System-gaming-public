// Trading on screen (src/views/trade.js): two players in a GM's room hand each other items and gold through the room. One
// offers from the Bag's Give window, the other accepts or refuses on the Bag's Offers tab, the giver can take it back, the
// GM can stop an offer and turn trading off. Driven through the UI; the store sets up and reads.
import type { Page } from '@playwright/test';
import { test, expect, type DeviceOptions, onboardGM, onboardPlayer, createRoom, dismissAll, go, answerWindow, gmRoomHeaders, adhoc } from './helpers.ts';
import { STATE_WORDS } from '../../src/core/trade/offer.ts';
import { TRADE_WORDS } from '../../src/core/trade/words.ts';

type Line = { name: string; qty?: number; slot?: string };
type Table = { gm: Page; brakk: Page; mira: Page; code: string };

/** A request the test cut off, as the browser logs it. */
const CUT = [/Failed to load resource: net::ERR_(FAILED|INTERNET_DISCONNECTED)/];
/**
 * A GM's room with Brakk's phone and Mira's phone in it, each seeing the other's hunter. `cut`: the phone whose requests
 * the test cuts off, served without the service worker so the cut reaches them, its cut requests' console lines allowed.
 */
async function table(device: (label: string, o?: DeviceOptions) => Promise<{ page: Page }>, o: { cut?: 'brakk' | 'mira' } = {}): Promise<Table> {
  const cut = (who: 'brakk' | 'mira'): DeviceOptions => (o.cut === who ? { blockServiceWorker: true, allowConsole: CUT } : {});
  const gm = (await device('gm')).page, brakk = (await device('brakk', cut('brakk'))).page, mira = (await device('mira', cut('mira'))).page;
  await onboardGM(gm);
  const code = await createRoom(gm);
  await onboardPlayer(brakk, 'Brakk', code);
  await onboardPlayer(mira, 'Mira', code);
  for (const [p, other] of [[brakk, 'Mira'], [mira, 'Brakk']] as const) {
    await expect.poll(() => p.evaluate(() => hunterApp.api.sync.room())).toBe(code);
    await dismissAll(p, 4);
    await expect.poll(() => p.evaluate(() => hunterApp.api.sync.faces().map((f: any) => f.name)), { timeout: 20_000 }).toContain(other);
  }
  return { gm, brakk, mira, code };
}
/** Puts `lines`, the hunter's own items, in the active hunter's bag and sets its gold, as setup. */
async function stock(page: Page, lines: Line[], gold: number): Promise<void> {
  const grants = lines.map(l => adhoc({ name: l.name, rar: 'common', type: l.slot ? 'armor' : 'consumable', ...(l.slot ? { slot: l.slot } : {}) }, l.qty ?? 1));
  await page.evaluate(({ grants, gold }) => {
    const hid = hunterApp.store.active().id;
    for (const g of grants) hunterApp.api.inventory.addItem(hid, g);
    hunterApp.api.inventory.addGold(hid, gold - hunterApp.store.active().gold);
  }, { grants, gold });
}
/** How many of item `name` the active hunter holds. */
const has = (page: Page, name: string): Promise<number> => page.evaluate(n => hunterApp.api.inventory.bag(hunterApp.store.active()).filter((i: any) => i.name === n).reduce((a: number, i: any) => a + i.qty, 0), name);
const goldOf = (page: Page): Promise<number> => page.evaluate(() => hunterApp.store.active().gold);
const records = (page: Page): Promise<string[]> => page.evaluate(() => (hunterApp.store.get().settings.sync.offers ?? []).map((r: any) => `${r.side} ${r.state}`));
const tradeLog = (gm: Page): Promise<string[]> => gm.evaluate(() => hunterApp.store.get().log.filter((l: any) => l.kind === 'trade').map((l: any) => l.text));

/** The Bag on the Status view, on tab `tab`. */
async function bag(page: Page, tab: 'Items' | 'Offers'): Promise<ReturnType<Page['locator']>> {
  await go(page, 'status');
  const panel = page.locator('[data-panel="inventory"]');
  await panel.locator('[role=tab]', { hasText: tab }).tap();
  return panel;
}
/** Give on item `item`'s row, `to` picked, and the offer's action tapped; `ask` opens Ask in return first. */
async function offer(page: Page, item: string, to: string, o: { n?: number; askGold?: number; ask?: string } = {}): Promise<void> {
  const panel = await bag(page, 'Items');
  await panel.getByRole('button', { name: `Give ${item}` }).tap();
  const win = page.locator('.sys-overlay.show', { hasText: `Give ${item}` });
  await expect(win).toBeVisible();
  if (o.n) await win.locator('[data-tr-n]').fill(String(o.n));
  await win.locator('[data-tr-to]', { hasText: to }).tap();
  if (o.askGold || o.ask) {
    await win.locator('.tr-ask summary').tap();
    if (o.askGold) await win.locator('[data-tr-askgold]').fill(String(o.askGold));
    if (o.ask) await win.locator('[data-tr-ask]', { hasText: o.ask }).tap();
  }
  await win.getByRole('button', { name: `Offer to ${to}` }).tap();
  await expect(win).toHaveCount(0);
}
/** The offer from `from` on the Offers tab, once it has reached this phone. */
async function offerFrom(page: Page, from: string) {
  await expect(page.locator('[data-panel="inventory"] [data-tab="offers"]')).toHaveText('Offers (1)', { timeout: 20_000 });
  const panel = await bag(page, 'Offers');
  return panel.locator('[data-tr-list="to"] .tr-offer', { hasText: `${from} offers` });
}

test('Brakk offers Mira a Healing Potion and Mira accepts: it leaves his bag and lands in hers', async ({ device }) => {
  const { gm, brakk, mira } = await table(device);
  await stock(brakk, [{ name: 'Healing Potion', qty: 3 }], 0);

  await test.step('Brakk offers one of his three: it waits aside, and his offer says it waits for Mira', async () => {
    await offer(brakk, 'Healing Potion', 'Mira');
    expect(await has(brakk, 'Healing Potion')).toBe(2);
    const yours = (await bag(brakk, 'Offers')).locator('[data-tr-list="yours"] .tr-offer');
    await expect(yours).toContainText('You offer Mira 1 Healing Potion.');
    await expect(yours.locator('.tr-state')).toHaveText('Waiting for Mira.', { timeout: 20_000 });
  });

  await test.step('Mira reads the offer under Offers and accepts it in one tap', async () => {
    const line = await offerFrom(mira, 'Brakk');
    await expect(line).toContainText('Brakk offers 1 Healing Potion.');
    await line.getByRole('button', { name: 'Accept' }).tap();
    await expect.poll(() => has(mira, 'Healing Potion'), { timeout: 20_000 }).toBe(1);
  });

  await test.step('Brakk\'s phone reads the end: two potions left and no offer waiting; the GM\'s log has the trade', async () => {
    await expect.poll(() => records(brakk), { timeout: 20_000 }).toEqual([]);
    expect(await has(brakk, 'Healing Potion')).toBe(2);
    expect(await records(mira)).toEqual([]);
    await expect.poll(() => tradeLog(gm), { timeout: 20_000 }).toEqual(['Brakk gave Mira 1 Healing Potion.']);
  });
});

test('an offer for 20 gold moves the gold the other way', async ({ device }) => {
  const { brakk, mira } = await table(device);
  await stock(brakk, [{ name: 'Healing Potion' }], 0);
  await stock(mira, [], 50);

  await offer(brakk, 'Healing Potion', 'Mira', { askGold: 20 });
  const line = await offerFrom(mira, 'Brakk');
  await expect(line).toContainText('Brakk offers 1 Healing Potion for your 20 gold.');
  await line.getByRole('button', { name: 'Accept' }).tap();
  await expect(mira.locator('#toasts .toast', { hasText: 'You give 20 gold for 1 Healing Potion.' })).toBeVisible();
  await expect.poll(() => has(mira, 'Healing Potion'), { timeout: 20_000 }).toBe(1);
  expect(await goldOf(mira)).toBe(30);
  await expect.poll(() => goldOf(brakk), { timeout: 20_000 }).toBe(20);
  expect(await has(brakk, 'Healing Potion')).toBe(0);
});

test('Mira takes a potion for her Iron Shield', async ({ device }) => {
  const { brakk, mira } = await table(device);
  await stock(brakk, [{ name: 'Healing Potion' }], 0);
  await stock(mira, [{ name: 'Iron Shield', slot: 'offhand' }], 0);
  await expect.poll(() => brakk.evaluate(() => hunterApp.api.sync.faces().flatMap((f: any) => (f.bag ?? []).map((l: any) => l.name))), { timeout: 20_000 }).toContain('Iron Shield');

  await offer(brakk, 'Healing Potion', 'Mira', { ask: 'Iron Shield' });
  const line = await offerFrom(mira, 'Brakk');
  await expect(line).toContainText('Brakk offers 1 Healing Potion for your 1 Iron Shield.');
  await line.getByRole('button', { name: 'Accept' }).tap();
  await expect.poll(() => has(brakk, 'Iron Shield'), { timeout: 20_000 }).toBe(1);
  expect(await has(mira, 'Iron Shield')).toBe(0);
  await expect.poll(() => has(mira, 'Healing Potion'), { timeout: 20_000 }).toBe(1);
  expect(await has(brakk, 'Healing Potion')).toBe(0);
});

test('an accept and a take back at once: one wins, on both phones', async ({ device }) => {
  const { gm, brakk, mira } = await table(device);
  await stock(brakk, [{ name: 'Healing Potion' }], 0);
  await offer(brakk, 'Healing Potion', 'Mira');
  const line = await offerFrom(mira, 'Brakk');
  const back = (await bag(brakk, 'Offers')).locator('[data-tr-list="yours"] .tr-offer').getByRole('button', { name: 'Take back' });
  await expect(back).toBeVisible();

  await Promise.all([line.getByRole('button', { name: 'Accept' }).tap(), back.tap()]);
  await expect.poll(async () => [...await records(brakk), ...await records(mira)], { timeout: 30_000 }).toEqual([]);
  const [his, hers] = [await has(brakk, 'Healing Potion'), await has(mira, 'Healing Potion')];
  expect(his + hers, 'one potion, in one bag').toBe(1);
  const said = hers === 1 ? 'Brakk gave Mira 1 Healing Potion.' : 'Brakk took back an offer to Mira.';
  await expect.poll(() => tradeLog(gm), { timeout: 20_000 }).toEqual([said]);
});

test('the GM stops an offer and the potion goes back', async ({ device }) => {
  const { gm, brakk, mira } = await table(device);
  await stock(brakk, [{ name: 'Healing Potion' }], 0);
  await offer(brakk, 'Healing Potion', 'Mira');
  await offerFrom(mira, 'Brakk');

  await go(gm, 'gm');
  const toggle = gm.locator('[data-tog="trade"]');
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.tap();
  const open = gm.locator('#gm-trade .tr-offer', { hasText: 'Brakk offers Mira 1 Healing Potion.' });
  await expect(open).toBeVisible({ timeout: 20_000 });
  await expect(gm.locator('#gm-hsum-trade')).toHaveText(TRADE_WORDS.summary(1));
  await open.getByRole('button', { name: /^Stop/ }).tap();
  await expect(gm.locator('#toasts .toast', { hasText: 'Stopped Brakk\'s offer to Mira.' })).toBeVisible();

  await expect.poll(() => has(brakk, 'Healing Potion'), { timeout: 20_000 }).toBe(1);
  await expect.poll(() => records(mira), { timeout: 20_000 }).toEqual([]);
  expect(await has(mira, 'Healing Potion')).toBe(0);
  await expect(gm.locator('#gm-trade')).toContainText('No open offers.', { timeout: 20_000 });
  await expect.poll(() => tradeLog(gm), { timeout: 20_000 }).toEqual(['You stopped Brakk\'s offer to Mira.']);
});

test('with trading off, Give offers no hunter in the room', async ({ device }) => {
  const { gm, brakk } = await table(device);
  await stock(brakk, [{ name: 'Healing Potion' }], 0);
  await go(gm, 'gm');
  const toggle = gm.locator('[data-tog="trade"]');
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.tap();
  await gm.locator('#gm-trade [data-tr-on="off"]').tap();
  await expect(gm.locator('#gm-trade [data-tr-on="off"]')).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => brakk.evaluate(() => hunterApp.rules().trade.on), { timeout: 20_000 }).toBe(false);

  const panel = await bag(brakk, 'Items');
  await panel.getByRole('button', { name: 'Give Healing Potion' }).tap();
  const win = brakk.locator('.sys-overlay.show', { hasText: 'Give Healing Potion' });
  await expect(win).toContainText('Trading is off for this table.');
  await expect(win.locator('[data-tr-to]', { hasText: 'In the room' })).toHaveCount(0);
  await answerWindow(brakk, 'Give Healing Potion', 'Cancel');
  expect(await has(brakk, 'Healing Potion')).toBe(1);
});

test('a reload between the offer and the room keeps the potion aside and sends it once', async ({ device }) => {
  const { gm, brakk, mira, code } = await table(device, { cut: 'brakk' });
  await stock(brakk, [{ name: 'Healing Potion', qty: 2 }], 0);
  await brakk.route('**/api/rooms/*/events', r => (r.request().method() === 'POST' ? r.abort() : r.continue()));

  await offer(brakk, 'Healing Potion', 'Mira');
  expect(await has(brakk, 'Healing Potion')).toBe(1);
  await brakk.reload({ waitUntil: 'networkidle' });
  await brakk.waitForFunction(() => window.hunterApp && document.querySelectorAll('#nav-top a').length > 0);
  expect(await has(brakk, 'Healing Potion'), 'the potion is still aside after the reload').toBe(1);
  expect((await records(brakk))[0]).toMatch(/^giver posting-/);

  await brakk.unroute('**/api/rooms/*/events');
  await expect.poll(() => records(brakk), { timeout: 30_000 }).toEqual(['giver open']);
  const line = await offerFrom(mira, 'Brakk');
  await expect(line).toHaveCount(1);
  const events = (await (await gm.request.get(`/api/rooms/${code}?after=0`, { headers: await gmRoomHeaders(gm, code) })).json()).events ?? [];
  expect(events.filter((e: any) => e.type === 'offer').length, 'the room holds the offer once').toBe(1);
});

test('Mira\'s phone offline accepts later and gets it', async ({ device }) => {
  const { gm, brakk, mira, code } = await table(device, { cut: 'mira' });
  await stock(brakk, [{ name: 'Healing Potion' }], 0);
  await offer(brakk, 'Healing Potion', 'Mira');
  const line = await offerFrom(mira, 'Brakk');

  await mira.context().setOffline(true);
  await expect.poll(() => mira.evaluate(() => hunterApp.api.sync.status())).toBe('offline');
  await line.getByRole('button', { name: 'Accept' }).tap();
  await expect(line.locator('.tr-state')).toHaveText(STATE_WORDS.taker['accepting-queued'](null as never));
  const ends = async () => ((await (await gm.request.get(`/api/rooms/${code}?after=0`, { headers: await gmRoomHeaders(gm, code) })).json()).events ?? []).filter((e: any) => e.type === 'offerEnd').length;
  expect(await ends(), 'the room has no answer while Mira\'s phone is offline').toBe(0);
  expect(await has(mira, 'Healing Potion'), 'nothing lands while the phone is offline').toBe(0);
  expect(await records(brakk)).toEqual(['giver open']);

  await mira.context().setOffline(false);
  await expect.poll(() => has(mira, 'Healing Potion'), { timeout: 30_000 }).toBe(1);
  await expect.poll(() => records(brakk), { timeout: 20_000 }).toEqual([]);
  expect(await has(brakk, 'Healing Potion')).toBe(0);
  expect(await ends(), 'one answer reached the room').toBe(1);
});

test('Brakk gives Eldrin a potion on the same phone in one tap more', async ({ device }) => {
  const brakk = (await device('brakk')).page;
  await onboardPlayer(brakk, 'Brakk');
  await brakk.evaluate(() => hunterApp.store.update((d: any) => { d.hunters.push({ name: 'Eldrin', daily: { lastCheckedKey: d.world.lastDailyKey } }); }, 'test-setup'));
  await dismissAll(brakk, 4);
  await stock(brakk, [{ name: 'Healing Potion', qty: 3 }], 0);
  const panel = await bag(brakk, 'Items');

  let taps = 0;
  await panel.getByRole('button', { name: 'Give Healing Potion' }).tap(); taps++;
  const win = brakk.locator('.sys-overlay.show', { hasText: 'Give Healing Potion' });
  await expect(win.locator('.tr-have')).toHaveText('You have 3.');
  await win.locator('[data-tr-to]', { hasText: 'Eldrin' }).tap(); taps++;
  await expect(win.locator('[data-tr-to]', { hasText: 'Eldrin' })).toContainText('On this phone');
  await win.getByRole('button', { name: 'Give to Eldrin' }).tap(); taps++;
  await expect(win).toHaveCount(0);

  expect(taps).toBe(3);
  expect(await has(brakk, 'Healing Potion')).toBe(2);
  const eldrin = await brakk.evaluate(() => hunterApp.api.inventory.bag(hunterApp.store.get().hunters.find((h: any) => h.name === 'Eldrin')).map((i: any) => [i.name, i.qty]));
  expect(eldrin).toEqual([['Healing Potion', 1]]);
  await expect(brakk.locator('#toasts .toast', { hasText: 'Brakk gave Eldrin 1 Healing Potion.' })).toBeVisible();
});

test('the GM\'s session log has a line for each trade that ended: given, refused, taken back', async ({ device }) => {
  const { gm, brakk, mira } = await table(device);
  await stock(brakk, [{ name: 'Healing Potion', qty: 3 }], 0);

  await offer(brakk, 'Healing Potion', 'Mira');
  await (await offerFrom(mira, 'Brakk')).getByRole('button', { name: 'Refuse' }).tap();
  await expect.poll(() => records(brakk), { timeout: 20_000 }).toEqual([]);
  expect(await has(brakk, 'Healing Potion')).toBe(3);

  await offer(brakk, 'Healing Potion', 'Mira');
  await expect.poll(() => records(brakk), { timeout: 20_000 }).toEqual(['giver open']);
  await (await bag(brakk, 'Offers')).locator('[data-tr-list="yours"]').getByRole('button', { name: 'Take back' }).tap();
  await expect.poll(() => records(brakk), { timeout: 20_000 }).toEqual([]);

  await offer(brakk, 'Healing Potion', 'Mira', { n: 2 });
  await (await offerFrom(mira, 'Brakk')).getByRole('button', { name: 'Accept' }).tap();
  await expect.poll(() => has(mira, 'Healing Potion'), { timeout: 20_000 }).toBe(2);

  await expect.poll(() => tradeLog(gm), { timeout: 20_000 }).toEqual([
    'Brakk gave Mira Healing Potion × 2.', 'Brakk took back an offer to Mira.', 'Mira refused Brakk\'s offer.',
  ]);
});
