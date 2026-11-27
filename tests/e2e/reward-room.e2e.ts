// The reward editor in a room (src/views/reward-editor.js): a GM builds a reward on a phone, saves it as a bundle and
// awards it to a player; the player uses its parts and the GM is told once; a later night the bundle goes out again from
// the Workshop. Driven through the UI; the store sets up and reads.
import type { Locator, Page } from '@playwright/test';
import { SHELF_WORDS } from '../../src/core/registry/bundles.ts';
import { test, expect, onboardGM, onboardPlayer, createRoom, dismissAll, go, activeHunter, answerWindow, openApp, openFeed, chooseList, addLibraryItem, adhoc } from './helpers.ts';

const HUNTER = 'Mira Test';
const BOON = { name: 'One free reroll', text: 'Reroll one die, once this session.' };
/** The GM's own consumable that tells the GM when it is used (the item maker's "Notify GM when used"). */
const TONIC = { name: 'Wolf Tonic', rar: 'common', type: 'consumable', slot: null, dice: '', bonus: {}, desc: 'Heals 5 HP.', armor: 0, resist: 0, tell: true, effects: [{ op: 'heal', amount: { kind: 'number', value: 5 }, when: 'use' }] };

/** Taps through the UI and counts them. Typing is not a tap; picking from a select is one. */
function tapCounter() {
  let n = 0;
  return { tap: async (l: Locator) => { await l.tap(); n++; }, get count() { return n; } };
}
const useLines = (gm: Page) => gm.evaluate(() => hunterApp.store.get().log.filter((l: any) => l.kind === 'use').map((l: any) => `${l.title} | ${l.text}`));
const unfold = async (gm: Page, sec: string) => {
  const toggle = gm.locator(`[data-tog="${sec}"]`);
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.tap();
};

test('a GM builds a reward with an item to be told of, a new title, a status and a boon, saves it as "Wolf hunt", awards it to a player, hears of each use once, and sends it again from the Workshop in 5 taps', async ({ device }) => {
  const gm = (await device('gm')).page, player = (await device('player')).page;
  const ed = gm.locator('#gm-rw');

  await test.step('a GM and a player in one room', async () => {
    await onboardGM(gm);
    const code = await createRoom(gm);
    await onboardPlayer(player, HUNTER, code);
    await expect.poll(() => player.evaluate(() => hunterApp.api.sync.room())).toBe(code);
    await dismissAll(player, 4);
    await go(gm, 'gm');
    await expect(gm.locator('#gm-board .gm-card.remote', { hasText: HUNTER })).toHaveCount(1);
    await addLibraryItem(gm, TONIC);
  });

  await test.step('the GM builds the reward in the Award form and sees the preview the player will see', async () => {
    await unfold(gm, 'award');
    await gm.fill('#gm-xp', '100');
    await ed.locator('[data-add="item"]').tap();
    await ed.locator('[data-kind="item"] [data-f="pick"]').selectOption({ label: 'Wolf Tonic (common)' });
    await ed.locator('[data-add="title"]').tap();
    await ed.locator('[data-kind="title"] [data-f="name"]').fill('Wolf Slayer');
    await ed.locator('[data-kind="title"] [data-bonus="str"]').fill('2');
    await ed.locator('[data-add="status"]').tap();
    await ed.locator('[data-kind="status"] [data-f="key"]').selectOption({ label: 'Hasted' });
    await ed.locator('[data-add="boon"]').tap();
    await ed.locator('[data-kind="boon"] [data-f="name"]').fill(BOON.name);
    await ed.locator('[data-kind="boon"] [data-f="text"]').fill(BOON.text);
    await expect(ed.locator('[data-kind="boon"]')).toContainText('A one-time custom favor the GM honors. When the player redeems it on their sheet, you get notified.');
    await expect(ed.locator('.rw-preview li')).toHaveText(['+100 XP', 'Item acquired: Wolf Tonic', 'Title acquired: Wolf Slayer', 'Status: Hasted (3 rounds)', `Boon: ${BOON.name}`]);
  });

  await test.step('Save as bundle… keeps it as "Wolf hunt"', async () => {
    await ed.locator('[data-rw-save]').tap();
    await answerWindowFill(gm, 'Save as bundle', 'Wolf hunt');
    await expect(ed.locator('[data-rw-say]')).toContainText('Saved bundle "Wolf hunt".');
    const saved = await gm.evaluate(() => hunterApp.store.get().library.rewards.map((b: any) => b.name));
    expect(saved).toEqual(['Wolf hunt']);
  });

  await test.step('the GM awards it to the player, whose phone shows the reward window and whose sheet shows each part', async () => {
    await gm.locator('#gm-targets label', { hasText: HUNTER }).tap();
    await gm.locator('#gm-award-go').tap();
    await expect(gm.locator('#gm-award-msg')).toHaveText(`Sent to ${HUNTER}.`);
    const win = player.locator('.sys-overlay.show', { hasText: 'REWARD RECEIVED' });
    await expect(win).toBeVisible({ timeout: 15_000 });
    for (const line of ['+100 XP', 'Item acquired: Wolf Tonic', 'Title acquired: Wolf Slayer', 'Status: Hasted (3 rounds)', `Boon: ${BOON.name}`]) await expect(win).toContainText(line);
    await dismissAll(player, 6);
    await go(player, 'status');
    const titles = player.locator('[data-panel="titles"]');
    await expect(titles.locator('[data-tlist] li', { hasText: 'Wolf Slayer' })).toContainText('+2 STR');
    await expect(player.locator('#view-status [data-chips]')).toContainText('Hasted · 3 rounds');
    await expect(titles.locator('[data-boons] li', { hasText: BOON.name })).toContainText(BOON.text);
    const h = await activeHunter(player);
    expect(h.bag.filter((i: any) => i.name === 'Wolf Tonic' && i.tell)).toHaveLength(1);
  });

  await test.step('the player redeems the boon: it leaves the sheet, and the GM gets the feed row, the toast, a count of 1 and one log line', async () => {
    await player.locator('[data-panel="titles"] [data-redeem]').tap();
    await answerWindow(player, `Redeem ${BOON.name}?`, 'Redeem');
    await expect(player.locator('[data-panel="titles"] [data-boonwrap]')).toBeHidden();
    await expect(gm.locator('#toasts .toast', { hasText: `${HUNTER} used Boon: ${BOON.name}` })).toBeVisible({ timeout: 15_000 });
    await expect(gm.locator('#gm-uses-n')).toHaveText('1');
    expect(await useLines(gm)).toEqual([`${HUNTER} used Boon: ${BOON.name} | ${BOON.text}`]);
    await go(gm, 'combat');
    await openFeed(gm);
    const row = gm.locator('#view-combat [data-feed]', { hasText: `${HUNTER} used Boon: ${BOON.name}` });
    await expect(row).toBeVisible();
    await expect(row.locator('.tb-out')).toHaveText(BOON.text);
  });

  await test.step('the player uses the tonic marked "Notify GM when used": a second line; an item without the mark writes none', async () => {
    await player.evaluate(g => {
      const s = hunterApp.store, h = s.active();
      hunterApp.api.hunter.damage(h.id, 10);
      s.update(() => { s.active().items.push({ ...g, id: s.id('i') }); }, 'test-setup');
    }, adhoc({ name: 'Trail Ration', type: 'consumable', rar: 'common', effects: [{ op: 'note', text: 'Tastes like dust.' }] }));
    await player.locator('#view-status [data-panel="inventory"] button[aria-label="Use Wolf Tonic"]').tap();
    await expect.poll(() => useLines(gm), { timeout: 15_000 }).toHaveLength(2);
    expect((await useLines(gm))[0]).toMatch(new RegExp(`^${HUNTER} used Item: Wolf Tonic \\| `));
    await player.locator('#view-status [data-panel="inventory"] button[aria-label="Use Trail Ration"]').tap();
    await expect.poll(() => gm.evaluate(n => hunterApp.api.inventory.bag(hunterApp.api.sync.remoteSheets()[0].data).some((i: any) => i.name === n), 'Trail Ration'), { timeout: 15_000 }).toBe(false);
    expect(await useLines(gm)).toHaveLength(2);
  });

  await test.step('the GM reloads and polls the room from its start: the two lines are there once each', async () => {
    const before = await useLines(gm);
    await gm.evaluate(() => hunterApp.store.update((d: any) => { d.settings.sync.cursor = 0; }, 'test-setup'));
    await openApp(gm);
    await expect.poll(() => gm.evaluate(() => hunterApp.store.get().settings.sync.cursor)).toBeGreaterThan(0);
    expect(await useLines(gm)).toEqual(before);
  });

  await test.step('a second night: from the GM view, More, Workshop, Award… on "Wolf hunt", the player, Send award: 5 taps', async () => {
    await go(gm, 'gm');
    const t = tapCounter();
    await t.tap(gm.locator('#more-btn'));
    await t.tap(gm.locator('.sys-overlay.show .sys-actions button', { hasText: 'Workshop' }));
    await t.tap(gm.locator('#view-workshop [data-ws="bundle"] li', { hasText: 'Wolf hunt' }).locator('[data-act="award"]'));
    await expect(gm.locator('#gm-rw [data-rw-bundle] option:checked')).toHaveText('Wolf hunt');
    await t.tap(gm.locator('#gm-targets label', { hasText: HUNTER }));
    await t.tap(gm.locator('#gm-award-go'));
    expect(t.count).toBe(5);
    await expect(player.locator('.sys-overlay.show', { hasText: 'REWARD RECEIVED' })).toBeVisible({ timeout: 15_000 });
    await dismissAll(player, 6);
    expect((await activeHunter(player)).boons.map((b: any) => b.name)).toEqual([BOON.name]);
  });
});

test('an award the GM gives while the GM\'s phone is offline waits on the GM\'s phone, and reaches the player once when it is back', async ({ device }) => {
  // setOffline reaches the app's requests only past no service worker
  const gm = (await device('gm', { blockServiceWorker: true, allowConsole: [/ERR_INTERNET_DISCONNECTED|net::ERR|Failed to fetch/] })).page, player = (await device('player')).page;
  const waiting = () => gm.evaluate(() => (hunterApp.store.get().settings.sync.outbox ?? []).filter((e: any) => e.at !== 'refused').length);
  const xp = () => player.evaluate(() => { const h = hunterApp.store.active(); return { level: h.level, xp: h.xp }; });

  await test.step('a GM and a player in one room', async () => {
    await onboardGM(gm);
    const code = await createRoom(gm);
    await onboardPlayer(player, HUNTER, code);
    await expect.poll(() => player.evaluate(() => hunterApp.api.sync.room())).toBe(code);
    await dismissAll(player, 4);
    await go(gm, 'gm');
    await expect(gm.locator('#gm-board .gm-card.remote', { hasText: HUNTER })).toHaveCount(1);
  });
  const before = await xp();

  await test.step('offline, the GM awards 25 XP: the GM view says the player gets it when the room answers, and the GM\'s phone keeps it', async () => {
    await gm.context().setOffline(true);
    await expect.poll(() => gm.evaluate(() => hunterApp.api.sync.status())).toBe('offline');
    await unfold(gm, 'award');
    await gm.fill('#gm-xp', '25');
    await gm.locator('#gm-targets label', { hasText: HUNTER }).tap();
    await gm.locator('#gm-award-go').tap();
    await expect(gm.locator('#gm-award-msg')).toHaveText(`Saved. ${HUNTER} will get it once the room server confirms it.`);
    expect(await waiting()).toBe(1);
    expect(await xp()).toEqual(before);
  });

  await test.step('back online, the player gets the award once and the GM\'s outbox empties', async () => {
    await gm.context().setOffline(false);
    await expect(player.locator('.sys-overlay.show', { hasText: 'REWARD RECEIVED' })).toContainText('+25 XP', { timeout: 20_000 });
    await expect.poll(waiting).toBe(0);
    await dismissAll(player, 4);
    expect(await xp()).toEqual({ level: before.level, xp: before.xp + 25 });
  });
});

test('the GM awards Hasted to a player\'s hunter in the GM\'s running fight: the row shows it, in the same write as the award\'s log line', async ({ device }) => {
  const gm = (await device('gm')).page, player = (await device('player')).page;
  const combat = gm.locator('#view-combat');
  const kaiRow = () => gm.evaluate(n => hunterApp.store.get().fight.rows.find((r: any) => r.name === n), HUNTER);

  await test.step('a GM and a player in one room, the player\'s hunter and a rat in the GM\'s running fight', async () => {
    await onboardGM(gm);
    await chooseList(gm);
    const code = await createRoom(gm);
    await onboardPlayer(player, HUNTER, code);
    await expect.poll(() => player.evaluate(() => hunterApp.api.sync.room())).toBe(code);
    await dismissAll(player, 4);
    await go(gm, 'gm');
    await expect(gm.locator('#gm-board .gm-card.remote', { hasText: HUNTER })).toHaveCount(1);
    await go(gm, 'combat');
    await combat.locator('[data-hsel]').selectOption({ label: `${HUNTER} (player phone)` });
    await combat.locator('[data-addh]').tap();
    await combat.locator('[data-qline]').fill('Cave Rat, E, brute');
    await combat.locator('[data-qadd]').tap();
    await combat.locator('[data-start]').tap();
    await expect(combat.locator('.cmb-row.cur')).toHaveCount(1);
    expect((await kaiRow()).statuses.map((x: any) => x.key)).not.toContain('hasted');
  });

  await test.step('the GM sends 10 XP and Hasted to the player from the Award form', async () => {
    await go(gm, 'gm');
    await unfold(gm, 'award');
    await gm.fill('#gm-xp', '10');
    await gm.locator('#gm-rw [data-add="status"]').tap();
    await gm.locator('#gm-rw [data-kind="status"] [data-f="key"]').selectOption({ label: 'Hasted' });
    await gm.locator('#gm-targets label', { hasText: HUNTER }).tap();
    await gm.locator('#gm-award-go').tap();
    await expect(gm.locator('#gm-award-msg')).toHaveText(`Sent to ${HUNTER}.`);
  });

  await test.step('the GM\'s row for the player shows Hasted, and the save that holds the award\'s log line holds the status on the row', async () => {
    await go(gm, 'combat');
    await expect(combat.locator('.cmb-row', { hasText: HUNTER }).locator('.cmb-cs')).toContainText('Hasted');
    const both = await gm.evaluate(n => { const s = hunterApp.store.get(); return { line: s.log.some((l: any) => l.title === 'GM award' && l.text.includes('Hasted')), row: s.fight.rows.find((r: any) => r.name === n).statuses.map((x: any) => x.key) }; }, HUNTER);
    expect(both.line).toBe(true);
    expect(both.row).toContain('hasted');
  });
});

/** Fills a prompt window's text field and confirms it. */
async function answerWindowFill(page: Page, title: string, text: string) {
  const win = page.locator('.sys-overlay.show', { hasText: title });
  await expect(win).toBeVisible();
  await win.locator('input').fill(text);
  await win.locator('.sys-actions button.primary').tap();
}

test('in a room the GM gives an award for roleplay from a player\'s card in three taps: the award opens in the Award form to edit first, its Give is held two seconds under Undo, then the player\'s phone opens it in its own words, and both hunters\' chronicles remember it', async ({ device }) => {
  const gm = (await device('gm')).page, player = (await device('player')).page;
  const shelf = gm.locator('.sys-overlay.show.gs-ov');
  const heldToast = (award: string) => gm.locator('#toasts .toast[data-held]', { hasText: `Gave ${award} to` });

  await test.step('a GM with a hunter of its own, and a player, in one room', async () => {
    await onboardGM(gm);
    const code = await createRoom(gm);
    await onboardPlayer(player, HUNTER, code);
    await expect.poll(() => player.evaluate(() => hunterApp.api.sync.room())).toBe(code);
    await dismissAll(player, 4);
    await go(gm, 'gm');
    await expect(gm.locator('#gm-board .gm-card.remote', { hasText: HUNTER })).toHaveCount(1);
  });

  await test.step('Give… on the player\'s card, then Held the Mask, the first award of the first moment: it opens in the Award form\'s fields (ruling 20), and its Give holds it under Undo: three taps', async () => {
    const taps = tapCounter();
    await taps.tap(gm.locator('#gm-board .gm-card.remote', { hasText: HUNTER }).locator('[data-ggive]'));
    await expect(shelf).toContainText(`GIVE TO ${HUNTER.toUpperCase()}`);
    const row = shelf.locator('[data-give="seed-held-the-mask"]');
    await expect(row).toContainText('Stayed in character during a hard scene');
    await expect(row).toContainText('+1 ability point');
    await taps.tap(row);
    await expect(shelf).toHaveCount(0);
    await expect(gm.locator('#gm-pts')).toHaveValue('1');
    await expect(gm.locator('#gm-award-tie')).toContainText(SHELF_WORDS.tie('Held the Mask', HUNTER));
    await expect(heldToast('Held the Mask'), 'nothing is held before the Give').toHaveCount(0);
    await taps.tap(gm.locator('#gm-award-go', { hasText: 'Give' }));
    expect(taps.count).toBe(3);
    await expect(heldToast('Held the Mask').getByRole('button', { name: 'Undo' })).toBeVisible();
    // the write waits for the toast to end: the message under the form comes when it goes
    await expect(heldToast('Held the Mask')).toHaveCount(0);
    await expect(gm.locator('#gm-award-msg')).toContainText(`Gave Held the Mask to ${HUNTER}.`);
  });

  await test.step('the player\'s phone opens it in its own words, and the chronicle holds it once', async () => {
    const win = player.locator('.sys-overlay.show', { hasText: 'THE MASK HELD' });
    await expect(win).toBeVisible({ timeout: 15_000 });
    await expect(win).toContainText('You stayed in character during a hard scene. You get 1 ability point.');
    await expect(win).toContainText('+1 ability point');
    await answerWindow(player, 'THE MASK HELD');
    await expect.poll(async () => (await activeHunter(player)).chronicle.facts.filter((f: any) => f.kind === 'given').map((f: any) => f.name)).toEqual(['Held the Mask']);
  });

  await test.step('on its own hunter the GM taps the chip "Told a good lie": the shelf shows that moment\'s awards alone; Straight Face, then Undo, and nothing is given', async () => {
    const own = gm.locator('#gm-board .gm-card:not(.remote)').first();
    await own.locator('[data-ggive]').tap();
    await expect(shelf).toBeVisible();
    await shelf.locator('[data-gs-chip="lie"]').tap();
    await expect(shelf.locator('[data-gs-chip="lie"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(shelf.locator('.gs-h')).toHaveText(['Told a good lie']);
    await expect(shelf.locator('[data-give]')).toHaveCount(7);
    await shelf.locator('[data-give="seed-straight-face"]').tap();
    await gm.locator('#gm-award-go', { hasText: 'Give' }).tap();
    await heldToast('Straight Face').getByRole('button', { name: 'Undo' }).tap();
    await expect(heldToast('Straight Face')).toHaveCount(0);
  });

  await test.step('Give… again: the last given at the top is Held the Mask alone, since the undone one was never given; Straight Face now lands, once', async () => {
    const own = gm.locator('#gm-board .gm-card:not(.remote)').first();
    await own.locator('[data-ggive]').tap();
    const recent = shelf.locator('[data-group="recent"]');
    await expect(recent.locator('.gs-h')).toHaveText(SHELF_WORDS.recent);
    await expect(recent.locator('[data-give]')).toHaveCount(1);
    await expect(recent.locator('[data-give="seed-held-the-mask"]')).toBeVisible();
    await shelf.locator('[data-group="lie"] [data-give="seed-straight-face"]').tap();
    await gm.locator('#gm-award-go', { hasText: 'Give' }).tap();
    const win = gm.locator('.sys-overlay.show', { hasText: 'THE SYSTEM BELIEVED YOU TOO' });
    await expect(win).toBeVisible();
    await answerWindow(gm, 'THE SYSTEM BELIEVED YOU TOO');
    const facts = await gm.evaluate(() => hunterApp.store.get().hunters.flatMap((h: any) => h.chronicle.facts.filter((f: any) => f.kind === 'given').map((f: any) => f.key)));
    expect(facts).toEqual(['seed-straight-face']);
  });
});

test('a held Give\'s Undo stays its whole two seconds while other notices come: the GM taps it after two more notices and nothing is given (the owner, Nov 22)', async ({ device }) => {
  const gm = (await device('gm')).page;
  const shelf = gm.locator('.sys-overlay.show.gs-ov'), held = gm.locator('#toasts .toast[data-held]', { hasText: 'Gave Straight Face to' });
  await onboardGM(gm);
  await go(gm, 'gm');
  await test.step('Give… on the GM\'s own hunter, then Straight Face: a toast holds it with Undo', async () => {
    await gm.locator('#gm-board .gm-card:not(.remote)').first().locator('[data-ggive]').tap();
    await shelf.locator('[data-give="seed-straight-face"]').first().tap();
    await expect(held.getByRole('button', { name: 'Undo' })).toBeVisible();
  });
  await test.step('two other notices arrive, and the held toast and its Undo are still there', async () => {
    await gm.evaluate(() => ['First', 'Second'].forEach(m => hunterApp.ui.toast('System', `${m} notice.`)));
    await expect(gm.locator('#toasts .toast', { hasText: 'Second notice.' })).toBeVisible();
    await expect(held.getByRole('button', { name: 'Undo' })).toBeVisible();
  });
  await test.step('Undo: the toast goes and the hunter is given nothing', async () => {
    await held.getByRole('button', { name: 'Undo' }).tap();
    await expect(held).toHaveCount(0);
    const facts = await gm.evaluate(() => hunterApp.store.get().hunters.flatMap((h: any) => h.chronicle.facts.filter((f: any) => f.kind === 'given')));
    expect(facts).toEqual([]);
  });
});

test('a GM alone takes 50 gold and more points than the hunter holds: the preview says what the reward takes, the window says what was lost, and neither goes below 0', async ({ device }) => {
  const gm = (await device('gm-cost')).page;
  const ed = gm.locator('#gm-rw');
  const shown = async () => { await go(gm, 'status'); return { gold: await activeHunter(gm).then((h: any) => h.gold), points: +(await gm.locator('#view-status [data-ap]').first().innerText()) }; };

  const held = await test.step('a hunter who holds 20 gold and at least one ability point', async () => {
    await onboardGM(gm);
    await gm.evaluate(() => hunterApp.store.update((d: any) => { const h = d.hunters.find((x: any) => x.id === d.settings.activeHunterId); h.gold = 20; h.bonusPoints += 1; }, 'test-setup'));
    const s = await shown();
    expect(s.gold).toBe(20);
    expect(s.points).toBeGreaterThan(0);
    return s;
  });

  await test.step('the GM types the amounts with a minus, and the preview reads them as losses', async () => {
    await go(gm, 'gm');
    await unfold(gm, 'award');
    await gm.fill('#gm-gold', '-50');
    await gm.fill('#gm-pts', String(-(held.points + 2)));
    await expect(ed.locator('.rw-preview li')).toHaveText(['Loses 50 gold', `Loses ${held.points + 2} ability points`]);
  });

  await test.step('Send award: the window says what the hunter lost, and the sheet shows 0 gold and 0 points', async () => {
    const hid = await gm.evaluate(() => hunterApp.store.active().id);
    const box = gm.locator(`input[data-sel="${hid}"]`);
    if (!(await box.isChecked())) await box.tap();
    await gm.locator('#gm-award-go').tap();
    const win = gm.locator('.sys-overlay.show', { hasText: 'Loses 20 gold' });
    await expect(win).toBeVisible();
    await expect(win).toContainText(`Loses ${held.points} ability point${held.points === 1 ? '' : 's'}`);
    await dismissAll(gm, 4);
    expect(await shown()).toEqual({ gold: 0, points: 0 });
  });
});
