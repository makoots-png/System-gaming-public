// Solo runs (src/core/gates/solo.ts, docs/agent-handoff/features/notes-2-solo.md): a hunter enters a gate alone, reads
// its odds first, and one play of the engine is what happened, written in one write. Alone with a personal gate, and
// in a room with a world gate the GM opened to solo runs: the GM's phone online, offline, two players on one gate, and a
// hunter who dies alone and is revived.
import { test, expect, onboardGM, onboardPlayer, createRoom, dismissAll, go, save, type Page } from './helpers.ts';

/** The hunter on `page` made strong enough to clear any E or D gate alone: every stat at 60, its HP full. */
const strong = (page: Page) => page.evaluate(() => hunterApp.store.update((d: any) => {
  const h = d.hunters.find((x: any) => x.id === d.settings.activeHunterId) ?? d.hunters[0];
  for (const k of Object.keys(h.stats)) h.stats[k] = 60;
  h.life = { at: 'up', hp: 99999 }; h.mana = 9999; h.fatigue = 0;
}, 'test-setup'));
const soloCard = (page: Page) => page.locator('#view-gates .gate.solo').first();
const hunterOf = (s: any) => s.hunters.find((h: any) => h.id === s.settings.activeHunterId) ?? s.hunters[0];

/** Taps Enter alone on the first solo gate: the odds play out, the one question with their numbers, Enter alone. */
async function enterAlone(page: Page): Promise<void> {
  await soloCard(page).locator('[data-solo-enter]').tap();
  const ask = page.locator('.sys-overlay.show', { hasText: 'ENTER ALONE?' });
  await expect(ask).toBeVisible({ timeout: 60_000 });
  await expect(ask).toContainText(/You clear it in \d+% of 100 plays\./);
  await expect(ask).toContainText('The odds are 100 plays. Your run is one more, and it can go better or worse.');
  await ask.locator('.sys-actions button', { hasText: 'Enter alone' }).tap();
}

test('alone, the System opens a personal gate; the hunter reads its odds, enters alone, and its cost and reward are written once', async ({ device }) => {
  const { page } = await device('solo');
  await onboardPlayer(page, 'Mira');
  await dismissAll(page);
  await strong(page);
  // setup: the gate the System opened holds one goblin, so a strong hunter clears it in every play
  await page.evaluate(() => hunterApp.store.update((d: any) => { d.hunters[0].solo.gates[0].monsters = [{ monsterId: 'seed:goblin', count: 1 }]; }, 'test-setup'));
  await go(page, 'gates');
  const card = soloCard(page), before = hunterOf(await save(page));
  expect(before.solo.gates).toHaveLength(1);
  await expect(card).toContainText(/Closes in 2[34] hours/);
  await expect(page.locator('#gt-list'), 'under a personal gate the world list names itself').toHaveText('No world gates.');
  await expect(card.locator('[data-odds] .hint')).toHaveText('Plays this gate to the end 100 times by the rules and shows how often you clear it.');
  await card.locator('[data-odds-ask]').tap();
  await expect(card.locator('[data-oddsline]')).toHaveText(/^You clear it in \d+% of 100 plays\. (Down in \d+%(, dead in \d+%)?|Never down in these plays)\. About \d+ rounds?\.$/, { timeout: 60_000 });
  await card.locator('[data-oddsline]').tap();
  await expect(card.locator('[data-dt-panel="odds"]')).toContainText(/Rounds: /);
  await expect(card.locator('[data-dt-panel="odds"]')).not.toContainText('party');
  await enterAlone(page);
  const done = page.locator('.sys-overlay.show', { hasText: 'GATE CLEARED' });
  await expect(done).toBeVisible({ timeout: 30_000 });
  await expect(done).toContainText(/HP \d+ to \d+ of \d+/);
  await done.locator('.sys-actions button').first().tap();
  await dismissAll(page);
  const after = hunterOf(await save(page)), s = await save(page);
  expect(after.solo.gates, 'the cleared gate is gone').toHaveLength(0);
  expect(after.xp + 100 * (after.level - 1), 'its roster\'s XP, once').toBeGreaterThan(before.xp);
  expect(s.log.filter((l: any) => l.title === 'Solo run')).toHaveLength(1);
  await expect(page.locator('#view-gates .gate.solo')).toHaveCount(0);
});

const worldCard = (page: Page, name: string) => page.locator('#view-gates .gate.solo[data-solo^="world:"]').filter({ hasText: name });
/** The GM opens gate `name` to solo runs in its edit form. */
async function openToSolo(gm: Page, name: string): Promise<string> {
  await go(gm, 'gates');
  const card = gm.locator('#view-gates .gate[data-id]').filter({ has: gm.locator('.gt-name').getByText(name, { exact: true }) });
  const id = (await card.getAttribute('data-id')) ?? '';
  await card.locator('[data-act=edit]').tap();
  await card.locator('.gt-panel input[name=solo]').check();
  await card.locator('.gt-panel button[type=submit]').tap();
  await expect(gm.locator(`#view-gates .gate[data-id="${id}"]`)).toContainText('Open to solo runs');
  return id;
}
/** A GM with the starter campaign in a room, and a player in it, its hunter strong, the Goblin Den open to solo runs. */
async function roomWithSoloDen(device: (label: string, o?: object) => Promise<{ page: Page; ctx: import('@playwright/test').BrowserContext }>, players: string[], gmOptions: object = {}) {
  const gm = await device('gm', { blockServiceWorker: true, ...gmOptions });
  await onboardGM(gm.page);
  const code = await createRoom(gm.page);
  // setup: the den holds one goblin and no boss, so a strong hunter clears it in every play
  await gm.page.evaluate(() => hunterApp.store.update((d: any) => { const g = d.gates.find((x: any) => x.name === 'Goblin Den'); g.monsters = [{ monsterId: 'seed:goblin', count: 1 }]; g.bossId = null; d.rulesOverrides.feats = { on: false }; }, 'test-setup'));
  // setup: feats off for the room (the room's rules doc carries the switch), so a run's feat windows (Alone, Once and the
  // rest, registry/feats.ts) do not stand before the windows these tests are about
  const den = await openToSolo(gm.page, 'Goblin Den');
  const phones = [];
  for (const name of players) {
    const p = await device(name, { blockServiceWorker: true });
    await onboardPlayer(p.page, name, code);
    await dismissAll(p.page);
    await strong(p.page);
    await expect.poll(() => p.page.evaluate(() => hunterApp.rules().feats.on), { timeout: 30_000 }).toBe(false);
    await go(p.page, 'gates');
    await expect(worldCard(p.page, 'Goblin Den')).toBeVisible({ timeout: 30_000 });
    phones.push(p);
  }
  return { gm, den, code, players: phones };
}
/** The player's run of the room's Goblin Den: Enter alone, and the run's window, which says the reward waits for the GM. */
async function runDen(page: Page): Promise<void> {
  const card = worldCard(page, 'Goblin Den');
  await card.locator('[data-solo-enter]').tap();
  const ask = page.locator('.sys-overlay.show', { hasText: 'ENTER ALONE?' });
  await expect(ask).toBeVisible({ timeout: 60_000 });
  await ask.locator('.sys-actions button', { hasText: 'Enter alone' }).tap();
  const ran = page.locator('.sys-overlay.show', { hasText: 'GATE CLEARED' });
  await expect(ran).toBeVisible({ timeout: 30_000 });
  await expect(ran).toContainText(/Cleared\. Waiting for the/);
  await ran.locator('.sys-actions button').first().tap();
}
const lifetime = (h: any): number => h.xp + Array.from({ length: h.level - 1 }, (_, i) => 100 * (i + 1)).reduce((a, b) => a + b, 0);

test('in a room, the GM opens a gate to solo runs; a player clears it alone and the GM\'s phone pays it once', async ({ device }) => {
  const { gm, den, players: [kai] } = await roomWithSoloDen(device, ['Kai']);
  const xp0 = lifetime(hunterOf(await save(kai!.page)));
  const due = await gm.page.evaluate(id => { const g = hunterApp.store.get().gates.find((x: any) => x.id === id); return g; }, den);
  await runDen(kai!.page);
  const paid = kai!.page.locator('.sys-overlay.show', { hasText: 'paid your solo run' });
  await expect(paid).toBeVisible({ timeout: 30_000 });
  await paid.locator('.sys-actions button').first().tap();
  await expect.poll(async () => (await gm.page.evaluate(id => hunterApp.store.get().gates.find((x: any) => x.id === id).status, den))).toBe('cleared');
  const gained = lifetime(hunterOf(await save(kai!.page))) - xp0, paidXp = await gm.page.evaluate(id => hunterApp.store.get().gates.find((x: any) => x.id === id).xpPaid, den);
  expect(gained, 'the gate\'s XP still due, once').toBe(paidXp - due.xpPaid);
  expect((await save(kai!.page)).settings.sync.runs ?? []).toEqual([]);
  expect((await save(gm.page)).log.some((l: any) => l.title === 'Solo run' && l.text.startsWith('Kai cleared "Goblin Den"'))).toBe(true);
});

test('with the GM\'s phone offline, the run waits for it and is paid once when it is back', async ({ device }) => {
  const { gm, players: [kai] } = await roomWithSoloDen(device, ['Kai'], { allowConsole: [/ERR_INTERNET_DISCONNECTED/] });
  await gm.ctx.setOffline(true);
  const xp0 = lifetime(hunterOf(await save(kai!.page)));
  await runDen(kai!.page);
  await expect(worldCard(kai!.page, 'Goblin Den')).toContainText('Cleared. Waiting for the GM\'s phone to pay it.', { timeout: 30_000 });
  expect(lifetime(hunterOf(await save(kai!.page))), 'nothing paid while the GM\'s phone is away').toBe(xp0);
  await kai!.page.reload();
  await gm.ctx.setOffline(false);
  const paid = kai!.page.locator('.sys-overlay.show', { hasText: 'paid your solo run' });
  await expect(paid).toBeVisible({ timeout: 60_000 });
  await paid.locator('.sys-actions button').first().tap();
  const once = lifetime(hunterOf(await save(kai!.page)));
  expect(once).toBeGreaterThan(xp0);
  await kai!.page.reload();
  await gm.page.reload();
  await expect.poll(async () => (await save(kai!.page)).settings.sync.cursor, { timeout: 30_000 }).toBeGreaterThan(0);
  await kai!.page.waitForFunction(() => hunterApp.api.sync.status() === 'connected');
  expect(lifetime(hunterOf(await save(kai!.page))), 'paid once, across reloads of both phones').toBe(once);
});

test('two players clear one gate: the first is paid, the second is told it was taken and keeps its cost', async ({ device }) => {
  const { code, players: [kai, rei] } = await roomWithSoloDen(device, ['Kai', 'Rei']);
  const reiXp = lifetime(hunterOf(await save(rei!.page)));
  // setup: Rei's phone hears nothing more of the room until its own run is played, so the den it enters is the one it
  // saw before Kai cleared it. Without this the test raced Rei's next poll: on a slow machine the cleared gate arrived
  // first and the card had no Enter alone (the public CI, Nov 19).
  let hear!: () => void;
  const quiet = new Promise<void>(r => { hear = r; });
  await rei!.page.route(u => u.pathname === `/api/rooms/${code}`, async route => {
    if (route.request().method() === 'GET') await quiet;
    // the page may have gone by the time a held poll is let through
    await route.continue().catch(() => {});
  });
  await runDen(kai!.page);
  const paid = kai!.page.locator('.sys-overlay.show', { hasText: 'paid your solo run' });
  await expect(paid).toBeVisible({ timeout: 30_000 });
  await runDen(rei!.page);
  hear();
  const taken = rei!.page.locator('.sys-overlay.show', { hasText: 'GATE TAKEN' });
  await expect(taken).toBeVisible({ timeout: 30_000 });
  await expect(taken).toContainText('Another hunter cleared this gate first. Your run\'s cost stays.');
  expect(lifetime(hunterOf(await save(rei!.page))), 'the second run is paid nothing').toBe(reiXp);
  expect((await save(rei!.page)).settings.sync.runs ?? []).toEqual([]);
});

/**
 * The hunter on `page` set to a plain level 1 body at 1 HP, as tests/e2e's seed search built it, so the run below plays the
 * fight that search played: with every draw at 3 (`seeded`), the goblin downs it and its saves (18, 5, 2, 6) end dead.
 */
const frail = (page: Page) => page.evaluate(() => hunterApp.store.update((d: any) => {
  const h = d.hunters.find((x: any) => x.id === d.settings.activeHunterId) ?? d.hunters[0];
  for (const k of Object.keys(h.stats)) h.stats[k] = 10;
  for (const k of Object.keys(h.equipped)) h.equipped[k] = null;
  Object.assign(h, { pending: {}, level: 1, rank: 'E', items: [], skills: [], conditions: [], shadows: [], titles: [], titleId: null, build: { path: null, picks: [] }, hpAdj: 0, manaAdj: 0, life: { at: 'up', hp: 1 }, mana: 0, fatigue: 0, collapsed: false, used: {} });
}, 'test-setup'));
/** Every draw of crypto.getRandomValues on `page` is `v`: the run's seed (edge/roll.ts `oddsSeed`) is then `v`. */
const seeded = (page: Page, v: number) => page.evaluate(n => Object.defineProperty(crypto, 'getRandomValues', { configurable: true, value: (a: Uint32Array) => a.fill(n) }), v);

test('a hunter who dies alone shows dead on the GM\'s board, and the GM\'s Revive brings it back', async ({ device }) => {
  const { gm, players: [kai] } = await roomWithSoloDen(device, ['Kai']);
  await frail(kai!.page);
  await seeded(kai!.page, 3);
  await worldCard(kai!.page, 'Goblin Den').locator('[data-solo-enter]').tap();
  const ask = kai!.page.locator('.sys-overlay.show', { hasText: 'ENTER ALONE?' });
  await expect(ask).toBeVisible({ timeout: 60_000 });
  await ask.locator('.sys-actions button', { hasText: 'Enter alone' }).tap();
  const failed = kai!.page.locator('.sys-overlay.show', { hasText: 'RUN FAILED' });
  await expect(failed).toBeVisible({ timeout: 30_000 });
  await expect(failed).toContainText('You died. The GM\'s Revive or a Resurrection Crystal brings you back.');
  await failed.locator('.sys-actions button').first().tap();
  expect(hunterOf(await save(kai!.page)).life).toEqual({ at: 'dead' });
  await go(gm.page, 'gm');
  const card = gm.page.locator('#gm-board .gm-card.remote', { hasText: 'Kai' });
  await expect(card).toContainText('Dead', { timeout: 30_000 });
  await card.locator('[data-grevive]').tap();
  await expect.poll(async () => hunterOf(await save(kai!.page)).life, { timeout: 30_000 }).toEqual({ at: 'up', hp: 1 });
  await expect.poll(async () => (await save(gm.page)).log.some((l: any) => l.title === 'Solo run' && l.text.includes('Kai fell in "Goblin Den"') && l.text.endsWith('and died.'))).toBe(true);
});

// The player cannot try a bad run again: nothing on screen while the run plays tells how it goes (only the round and the
// moves), and a reload in the middle leaves no trace of it: the run is a page value until its one write.
test('while a run plays the card shows only its round and moves, and a reload in the middle leaves no trace and no cost', async ({ device }) => {
  const { page } = await device('reroll');
  await onboardPlayer(page, 'Mira');
  await dismissAll(page);
  // setup: a hunter that hardly hurts and is hardly hurt, against two goblins: a long fight, so the run spans many frames
  await page.evaluate(() => hunterApp.store.update((d: any) => {
    const h = d.hunters[0];
    for (const k of Object.keys(h.stats)) h.stats[k] = 1;
    h.stats.vit = 99; h.life = { at: 'up', hp: 99999 };
    h.solo.gates[0].monsters = [{ monsterId: 'seed:goblin', count: 2 }];
  }, 'test-setup'));
  const kept = () => page.evaluate(() => { const h = hunterApp.store.get().hunters[0], s = hunterApp.store.get(); return JSON.stringify([h.life, h.mana, h.fatigue, h.items, h.xp, h.solo.gates, s.log.filter((l: any) => l.title === 'Solo run').length]); });
  await go(page, 'gates');
  const before = await kept(), card = soloCard(page);
  await card.locator('[data-solo-enter]').tap();
  const ask = page.locator('.sys-overlay.show', { hasText: 'ENTER ALONE?' });
  await expect(ask).toBeVisible({ timeout: 120_000 });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 20 });
  // The run plays a few moves a frame. The page is held after the run's first frame (no further frame is given), as a
  // phone closed in the middle of it: otherwise the run could end, and write, before this test looks or reloads.
  await card.locator('[data-solorun]').evaluate(el => {
    new MutationObserver(() => { if (!(el as HTMLElement).hidden) window.requestAnimationFrame = () => 0; }).observe(el, { attributes: true, attributeFilter: ['hidden'] });
  });
  await ask.locator('.sys-actions button', { hasText: 'Enter alone' }).tap();
  const playing = card.locator('[data-solorun]');
  await expect(playing).toHaveText(/^Round \d+, \d+ moves? played$/);
  expect(await kept(), 'nothing is written while the run plays').toBe(before);
  await page.reload();
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  await page.waitForFunction(() => window.hunterApp && document.querySelectorAll('#nav-top a').length > 0);
  expect(await kept(), 'the reload left the hunter, its gate and the log as they were').toBe(before);
});

test('the GM turns personal gates off for the room: a player\'s gates stop, and the player\'s own switch is left as it was', async ({ device }) => {
  const { gm, players: [kai] } = await roomWithSoloDen(device, ['Kai']);
  await expect(kai!.page.locator('#view-gates .gate.solo[data-solo^="personal:"]')).toHaveCount(1);
  await go(gm.page, 'gates');
  await gm.page.locator('#view-gates [data-act=solo-off]').tap();
  await expect(gm.page.locator('#view-gates [data-act=solo-off]')).toHaveAttribute('aria-pressed', 'true');
  await expect(kai!.page.locator('#view-gates .gate.solo[data-solo^="personal:"]')).toHaveCount(0, { timeout: 30_000 });
  await expect(kai!.page.locator('#view-gates .gt-solo')).not.toContainText('Personal gates');
  expect((await save(kai!.page)).rulesOverrides.solo, 'the room\'s switch is never written to the player\'s save').toBeUndefined();
  expect((await save(gm.page)).rulesOverrides.solo).toEqual({ personal: false });
});
