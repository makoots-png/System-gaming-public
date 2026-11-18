import { test, expect, onboardGM, onboardPlayer, createRoom, dismissAll, go, answerWindow, openApp, type Page, type DeviceOptions, chooseList, setupDoc } from './helpers.ts';

const HUNTER = 'Mira Test', MONSTER = 'Cave Rat';
const combat = (page: Page) => page.locator('#view-combat');
const useLines = (gm: Page) => gm.evaluate(() => hunterApp.store.get().log.filter((l: any) => l.kind === 'use').map((l: any) => `${l.title} | ${l.text}`));

/** A GM and a player in one room, the player's card on the GM's party board. */
async function room(device: (label: string, o?: DeviceOptions) => Promise<{ page: Page }>, playerOptions: DeviceOptions = {}): Promise<{ gm: Page; player: Page }> {
  const gm = (await device('gm')).page, player = (await device('player', playerOptions)).page;
  await onboardGM(gm);
  await chooseList(gm);
  const code = await createRoom(gm);
  await onboardPlayer(player, HUNTER, code);
  await chooseList(player);
  await expect.poll(() => player.evaluate(() => hunterApp.api.sync.room())).toBe(code);
  await dismissAll(player, 4);
  await go(gm, 'gm');
  await expect(gm.locator('#gm-board .gm-card.remote', { hasText: HUNTER })).toHaveCount(1);
  return { gm, player };
}
/** Gives the player's hunter something to carry (setup only). */
async function give(player: Page, key: 'boons' | 'items', thing: Record<string, unknown>) {
  await player.evaluate(([k, t]) => { const s = hunterApp.store; s.update(() => { s.active()[k].push({ ...t, id: s.id(k === 'boons' ? 'bn' : 'i') }); }, 'test-setup'); }, [key, thing] as const);
}

test('a player redeems a boon: the GM\'s session log gets one line and a toast, and a replay after a reload writes nothing more', async ({ device }) => {
  const { gm, player } = await room(device);
  await give(player, 'boons', { name: 'Free resurrection', text: 'Once, the GM brings you back at 1 HP.', at: '2026-11-13T00:00:00.000Z' });

  await test.step('the player taps Redeem and confirms', async () => {
    await go(player, 'status');
    await player.locator('[data-panel="titles"] [data-redeem]').tap();
    await answerWindow(player, 'Redeem Free resurrection?', 'Redeem');
    await expect(player.locator('#toasts .toast').last()).toContainText('Free resurrection redeemed.');
    await expect(player.locator('[data-panel="titles"] [data-boons] li')).toHaveCount(0);
  });

  await test.step('the GM sees a toast, "Reward uses" counts 1, and its one tap shows the one line in the Session log', async () => {
    await expect(gm.locator('#toasts .toast', { hasText: `${HUNTER} used Boon: Free resurrection` })).toBeVisible({ timeout: 15_000 });
    expect(await useLines(gm)).toEqual([`${HUNTER} used Boon: Free resurrection | Once, the GM brings you back at 1 HP.`]);
    await expect(gm.locator('#gm-uses-n')).toHaveText('1');
    await gm.locator('#gm-uses-go').tap();
    await expect(gm.locator('#gm-l-kind')).toHaveValue('use');
    await expect(gm.locator('#gm-l-list li')).toHaveCount(1);
    await expect(gm.locator('#gm-l-list li')).toContainText(`${HUNTER} used Boon: Free resurrection`);
    await expect(gm.locator('#gm-uses-n')).toBeHidden();
  });

  await test.step('the GM\'s phone reloads and polls the room from its start again: the line is still written once', async () => {
    await gm.evaluate(() => hunterApp.store.update((d: any) => { d.settings.sync.cursor = 0; }, 'test-setup'));
    await openApp(gm);
    await expect.poll(() => gm.evaluate(() => hunterApp.store.get().settings.sync.cursor)).toBeGreaterThan(0);
    expect(await useLines(gm)).toHaveLength(1);
  });
});

test('a boon redeemed while the player\'s phone is offline waits on the phone, and reaches the GM\'s log once when the phone is back', async ({ device }) => {
  // setOffline reaches the app's requests only past no service worker
  const { gm, player } = await room(device, { blockServiceWorker: true, allowConsole: [/ERR_INTERNET_DISCONNECTED|net::ERR|Failed to fetch/] });
  await give(player, 'boons', { name: 'Free resurrection', text: 'Once, the GM brings you back at 1 HP.', at: '2026-11-13T00:00:00.000Z' });
  const waiting = () => player.evaluate(() => (hunterApp.store.get().settings.sync.outbox ?? []).filter((e: any) => e.at !== 'refused').length);

  await test.step('offline, the player redeems the boon: the phone says the GM is told when the room answers, and keeps it', async () => {
    await player.context().setOffline(true);
    await expect.poll(() => player.evaluate(() => hunterApp.api.sync.status())).toBe('offline');
    await go(player, 'status');
    await player.locator('[data-panel="titles"] [data-redeem]').tap();
    await answerWindow(player, 'Redeem Free resurrection?', 'Redeem');
    await expect(player.locator('#toasts .toast', { hasText: 'The GM is told about Free resurrection when the room answers.' })).toBeVisible();
    expect(await waiting()).toBe(1);
    expect(await useLines(gm)).toEqual([]);
  });

  await test.step('back online, the use reaches the GM once and leaves the phone\'s outbox', async () => {
    await player.context().setOffline(false);
    await expect(gm.locator('#toasts .toast', { hasText: `${HUNTER} used Boon: Free resurrection` })).toBeVisible({ timeout: 20_000 });
    await expect.poll(waiting).toBe(0);
    expect(await useLines(gm)).toEqual([`${HUNTER} used Boon: Free resurrection | Once, the GM brings you back at 1 HP.`]);
  });
});

test('a player completes the GM\'s quest: the GM\'s log says so once, and a replay after a reload writes nothing more', async ({ device }) => {
  const { gm, player } = await room(device);
  const done = () => gm.evaluate(() => hunterApp.store.get().log.filter((l: any) => l.title === 'Quest completed').map((l: any) => l.text));

  await test.step('the GM sends a quest and the player completes it from the Quests view', async () => {
    const key = await gm.evaluate(() => hunterApp.api.sync.remoteSheets()[0].key as string);
    await gm.evaluate(to => hunterApp.api.sync.post(hunterApp.api.sync.event('quest', { to: [to], quest: { kind: 'side', title: 'Clear the rats', desc: '', objectives: [], rewards: { xp: 10 }, dueAt: null, penaltyText: '' } })), key);
    await expect(player.locator('.sys-overlay.show', { hasText: 'Clear the rats' })).toBeVisible({ timeout: 15_000 });
    await dismissAll(player, 4);
    await go(player, 'quests');
    await player.locator('#view-quests .qc', { hasText: 'Clear the rats' }).locator('[data-done]').tap();
    await answerWindow(player, 'Complete quest?', 'Complete');
    await dismissAll(player, 4);
  });

  await test.step('the GM\'s log has one line for it', async () => {
    await expect.poll(done, { timeout: 15_000 }).toEqual([`${HUNTER} COMPLETED Clear the rats`]);
  });

  await test.step('the GM\'s phone reloads and polls the room from its start again: still one line', async () => {
    await gm.evaluate(() => hunterApp.store.update((d: any) => { d.settings.sync.cursor = 0; }, 'test-setup'));
    await openApp(gm);
    await expect.poll(() => gm.evaluate(() => hunterApp.store.get().settings.sync.cursor)).toBeGreaterThan(0);
    expect(await done()).toHaveLength(1);
  });
});

/** Frostbite for 2 rounds: a round is 1000 ticks of fight time (RULES.fight.round). */
const FROSTBITE = { label: 'Frostbite', desc: 'Cold eats at you.', ops: [{ op: 'damage', type: 'magical', amount: { kind: 'number', value: 3 } }] };
const FROST_BOMB = {
  name: 'Frost Bomb', type: 'consumable', rar: 'rare', slot: null, qty: 2, dice: '', bonus: {}, value: 0, desc: '', weight: 0, armor: 0, resist: 0, target: 'other',
  effects: [{ op: 'applyStatus', key: 'frostbite', def: FROSTBITE, duration: 2000 }],
};

test('a player in the GM\'s fight throws a Frost Bomb from the bag on their turn: the rat on the GM\'s phone has Frostbite, and one bomb is gone', async ({ device }) => {
  const { gm, player } = await room(device);
  await give(player, 'items', FROST_BOMB);
  await expect.poll(() => gm.evaluate(() => (hunterApp.api.sync.remoteSheets() as any[]).some(r => r.data.items.some((i: any) => i.name === 'Frost Bomb')))).toBe(true);
  const bombs = () => player.evaluate(() => hunterApp.store.active().items.find((i: any) => i.name === 'Frost Bomb')?.qty ?? 0);

  await test.step('the GM runs a fight with the player\'s hunter and a rat, and the turn is the player\'s (setup)', async () => {
    await go(gm, 'combat');
    await combat(gm).locator('[data-hsel]').selectOption({ label: `${HUNTER} (remote)` });
    await combat(gm).locator('[data-addh]').tap();
    await combat(gm).locator('[data-qline]').fill(`${MONSTER}, E, brute`);
    await combat(gm).locator('[data-qadd]').tap();
    await combat(gm).locator('[data-start]').tap();
    await expect(combat(gm).locator('.cmb-row.cur')).toHaveCount(1);
    await gm.evaluate(name => hunterApp.store.update((d: any) => {
      const f = d.fight, me = f.rows.find((r: any) => r.name === name), rat = f.rows.find((r: any) => r.kind === 'monster');
      me.place = { x: 2, y: 2 }; rat.place = { x: 2, y: 4 }; me.at = f.now; me.tie = 0; rat.at = f.now + 1; f.currentId = me.id;
    }, 'test-setup'), HUNTER);
    await setupDoc(player, HUNTER, { x: 2, y: 2 });
    await go(player, 'combat');
    await expect(combat(player).locator('.tb-mine')).toContainText('YOUR TURN');
  });

  await test.step('the player uses the bomb from the bag and picks the rat', async () => {
    await go(player, 'status');
    await player.locator('#view-status [data-panel="inventory"] button[aria-label="Use Frost Bomb"]').tap();
    await answerWindow(player, 'Use Frost Bomb on', MONSTER);
    await expect(player.locator('#toasts .toast', { hasText: 'Frost Bomb: sent to the GM.' })).toBeVisible();
  });

  await test.step('the GM\'s rat holds Frostbite; then one bomb leaves the player\'s bag, and the player\'s table shows Frostbite on the rat', async () => {
    await expect.poll(() => gm.evaluate(n => hunterApp.store.get().fight.rows.find((r: any) => r.name === n).statuses.map((s: any) => s.key), MONSTER), { timeout: 15_000 }).toEqual(['frostbite']);
    await expect.poll(bombs, { timeout: 15_000 }).toBe(1);
    await expect(player.locator('#toasts .toast', { hasText: 'Frost Bomb used.' })).toBeVisible();
    await expect(combat(gm).locator('.cmb-row', { hasText: MONSTER }).locator('.cmb-cs')).toContainText('Frostbite');
    await go(player, 'combat');
    await expect(combat(player).locator('.tb-row', { hasText: MONSTER }).locator('.tb-conds')).toContainText('Frostbite');
  });
});

test('a player\'s Frost Bomb the GM\'s fight turns down stays in the bag: the player reads why, and nothing reached the rat', async ({ device }) => {
  const { gm, player } = await room(device);
  const bombs = () => player.evaluate(() => hunterApp.store.active().items.find((i: any) => i.name === 'Frost Bomb')?.qty ?? 0);

  await test.step('the GM runs a fight with the player\'s hunter and a rat, its turn the player\'s, before the player has the bomb', async () => {
    await go(gm, 'combat');
    await combat(gm).locator('[data-hsel]').selectOption({ label: `${HUNTER} (remote)` });
    await combat(gm).locator('[data-addh]').tap();
    await combat(gm).locator('[data-qline]').fill(`${MONSTER}, E, brute`);
    await combat(gm).locator('[data-qadd]').tap();
    await combat(gm).locator('[data-start]').tap();
    await expect(combat(gm).locator('.cmb-row.cur')).toHaveCount(1);
    await gm.evaluate(name => hunterApp.store.update((d: any) => {
      const f = d.fight, me = f.rows.find((r: any) => r.name === name), rat = f.rows.find((r: any) => r.kind === 'monster');
      me.place = { x: 2, y: 2 }; rat.place = { x: 2, y: 4 }; me.at = f.now; me.tie = 0; rat.at = f.now + 1; f.currentId = me.id;
    }, 'test-setup'), HUNTER);
    await setupDoc(player, HUNTER, { x: 2, y: 2 });
    await give(player, 'items', FROST_BOMB);
    await go(player, 'combat');
    await expect(combat(player).locator('.tb-mine')).toContainText('YOUR TURN');
  });

  await test.step('the player throws the bomb at the rat; the GM\'s fight turns it down, and the player reads why', async () => {
    await go(player, 'status');
    await player.locator('#view-status [data-panel="inventory"] button[aria-label="Use Frost Bomb"]').tap();
    await answerWindow(player, 'Use Frost Bomb on', MONSTER);
    await expect(player.getByText('You did not have that when the fight began.').first()).toBeVisible({ timeout: 15_000 });
  });

  await test.step('both bombs are still in the bag, and the rat has no Frostbite', async () => {
    expect(await bombs()).toBe(2);
    expect(await gm.evaluate(n => hunterApp.store.get().fight.rows.find((r: any) => r.name === n).statuses.length, MONSTER)).toBe(0);
  });
});

test('out of a room, a redeemed boon is written to this phone\'s own session log and nothing is sent', async ({ device }) => {
  const gm = (await device('gm')).page;
  await onboardGM(gm);
  await chooseList(gm);
  await give(gm, 'boons', { name: 'Favor of the guild', text: 'One free question.', at: '2026-11-13T00:00:00.000Z' });
  const name = await gm.evaluate(() => hunterApp.store.active().name as string);
  await go(gm, 'status');
  await gm.locator('[data-panel="titles"] [data-redeem]').tap();
  await answerWindow(gm, 'Redeem Favor of the guild?', 'Redeem');
  await expect.poll(() => useLines(gm)).toEqual([`${name} used Boon: Favor of the guild | One free question.`]);
});

/** Records what the GM's phone asks the service worker to show, and makes its page look hidden to the app. */
async function hideAndRecord(gm: Page) {
  await gm.evaluate(() => {
    const w = window as any;
    w.__shown = [];
    ServiceWorkerRegistration.prototype.showNotification = function (title: string, o: NotificationOptions) { w.__shown.push({ title, body: o.body, tag: o.tag }); return Promise.resolve(); };
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
}
const shown = (gm: Page) => gm.evaluate(() => (window as any).__shown as { title: string; body: string; tag: string }[]);
const BOON = { name: 'Free resurrection', text: 'Once, the GM brings you back at 1 HP.', at: '2026-11-13T00:00:00.000Z' };
async function redeem(player: Page) {
  await go(player, 'status');
  await player.locator('[data-panel="titles"] [data-redeem]').tap();
  await answerWindow(player, 'Redeem Free resurrection?', 'Redeem');
}

test('a GM who allowed notifications gets one for a boon a player redeems while the GM\'s page is hidden', async ({ device }) => {
  const gmDevice = await device('gm'), gm = gmDevice.page, player = (await device('player')).page;
  await gmDevice.ctx.grantPermissions(['notifications']);
  await onboardGM(gm);
  await chooseList(gm);
  const code = await createRoom(gm);
  await onboardPlayer(player, HUNTER, code);
  await chooseList(player);
  await dismissAll(player, 4);
  await go(gm, 'gm');
  await expect(gm.locator('#gm-board .gm-card.remote', { hasText: HUNTER })).toHaveCount(1);
  await give(player, 'boons', BOON);

  await test.step('the GM taps the notify button and the GM view says notifications are on', async () => {
    const toggle = gm.locator('[data-tog="log"]');
    if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.tap();
    await gm.locator('#gm-notify').tap();
    await expect(gm.locator('#gm-notify-state')).toContainText('On:');
    await gm.evaluate(() => navigator.serviceWorker.ready);
  });

  await test.step('the GM\'s page is hidden, the player redeems the boon, and the GM\'s phone asks for one notification with its name', async () => {
    await hideAndRecord(gm);
    await redeem(player);
    await expect.poll(() => shown(gm), { timeout: 20_000 }).toHaveLength(1);
    const [n] = await shown(gm);
    expect(n).toMatchObject({ title: `${HUNTER} used Boon: Free resurrection`, body: BOON.text });
    expect(n!.tag).toBe(await gm.evaluate(() => hunterApp.store.get().settings.sync.applied.at(-1)));
    expect(await useLines(gm)).toHaveLength(1);
  });
});

test('without the GM\'s permission no notification is asked for, and the log line still appears', async ({ device }) => {
  const { gm, player } = await room(device);
  await give(player, 'boons', BOON);
  await hideAndRecord(gm);
  await redeem(player);
  const code = await gm.evaluate(() => hunterApp.api.sync.room());
  const build = await gm.evaluate(() => hunterApp.build as string);
  await expect.poll(async () => (await (await player.request.get(`/api/rooms/${code}?after=0`, { headers: { 'X-Hunter-Build': build } })).json()).events.some((e: any) => e.type === 'used')).toBe(true);
  await gm.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect.poll(() => useLines(gm)).toEqual([`${HUNTER} used Boon: Free resurrection | ${BOON.text}`]);
  expect(await shown(gm)).toEqual([]);
});
