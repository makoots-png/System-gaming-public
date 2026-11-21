// The coin call (src/views/coin.js, src/core/coin.ts): a check's natural 1 or 20 outside a fight asks the player heads or
// tails; the GM rules in a System window and sees the side, and the player's phone hears only that the coin was flipped
// (the owner, Nov 21: the GM says the outcome at the table).
import type { Page } from '@playwright/test';
import { test, expect, onboardGM, onboardPlayer, createRoom, dismissAll, go, answerWindow, openApp, roomHeaders, save, PHONE, SMALL_PHONE } from './helpers.ts';

const HUNTER = 'Kai Test';
const card = (page: Page) => page.locator('[data-coin-card]');
const gmWindow = (gm: Page) => gm.locator('.sys-overlay.show', { hasText: 'Coin call' });

/** A GM and a player in one room on 390 px phones, the player's card on the GM's party board. Answers the room code too. */
async function room(device: (label: string, o?: { viewport?: typeof PHONE }) => Promise<{ page: Page }>): Promise<{ gm: Page; player: Page; code: string }> {
  const gm = (await device('gm', { viewport: PHONE })).page, player = (await device('player', { viewport: PHONE })).page;
  await onboardGM(gm);
  const code = await createRoom(gm);
  await onboardPlayer(player, HUNTER, code);
  await expect.poll(() => player.evaluate(() => hunterApp.api.sync.room())).toBe(code);
  await dismissAll(player, 4);
  await go(gm, 'gm');
  await expect(gm.locator('#gm-board .gm-card.remote', { hasText: HUNTER })).toHaveCount(1);
  return { gm, player, code };
}

/**
 * A Strength check from the Dice view whose d20 shows `face`: the tray reads `Math.random` at each die, so it answers
 * 0.99 for a 20 (1 + floor(0.99 x 20)) and 0 for a 1 during the tap only.
 */
async function check(page: Page, face: 1 | 20): Promise<void> {
  await go(page, 'dice');
  await page.evaluate(r => { (window as any).__r = Math.random; Math.random = () => r; }, face === 20 ? 0.99 : 0);
  try { await page.locator('#view-dice [data-st="str"]').tap(); } finally { await page.evaluate(() => { Math.random = (window as any).__r; }); }
}

/**
 * Every true flip on `page` shows `side`: the flip reads crypto.getRandomValues (src/edge/roll.ts), and below one half is
 * heads (`sideOf`). A test of a ruling sets the flip to the other side, so a phone that flipped instead of ruling fails it.
 */
const flipShows = (page: Page, side: 'heads' | 'tails') =>
  page.evaluate(v => Object.defineProperty(crypto, 'getRandomValues', { configurable: true, value: (a: Uint32Array) => a.fill(v) }), side === 'heads' ? 0 : 0xffffffff);

/** The player's coin card asks, the player calls `side`, and the coin is in the air. */
async function call(player: Page, side: 'Heads' | 'Tails'): Promise<void> {
  await expect(card(player)).toContainText('Heads or tails?');
  await card(player).getByRole('button', { name: side, exact: true }).tap();
  await expect(card(player).locator('[data-words]')).toHaveText('In the air');
}

/** The GM's toast after a ruling: the side the coin landed on and what it means, for the GM to say at the table. */
const gmTold = (gm: Page) => gm.locator('#toasts .toast', { hasText: 'It landed' });

/**
 * The player's coin after the GM ruled it in a room: its words, and whether anything on the card names a side it landed
 * on or a verdict. The card holds no coin face, since a face at rest shows a side.
 */
async function flipped(player: Page, called: 'Heads' | 'Tails'): Promise<void> {
  const row = card(player).locator('li', { hasText: `You called ${called}` });
  await expect(row.locator('[data-words]')).toHaveText('Flipped');
  await expect(row).toContainText('The GM tells you how it landed.');
  await expect(row.locator('[data-coin-face], [data-side]')).toHaveCount(0);
  const text = (await row.textContent()) ?? '';
  expect(text.replace(`You called ${called}`, '')).not.toMatch(/Heads|Tails|Critical|Success|Saved|Right|Wrong/);
}

/** The player's coin after it landed alone: the side its face rests on and the words under it. */
async function landed(player: Page): Promise<{ side: string | null; words: string }> {
  const words = card(player).locator('[data-words]');
  await expect(words).not.toHaveText('In the air');
  return { side: await card(player).locator('[data-coin-face]').getAttribute('data-side'), words: (await words.textContent()) ?? '' };
}

test('a player\'s natural 20 asks heads or tails; the GM rules Right and is told it landed Heads, a critical success; the player\'s phone says only that it was flipped', async ({ device }) => {
  const { gm, player } = await room(device);
  await flipShows(gm, 'tails');
  await check(player, 20);
  await call(player, 'Heads');
  await expect(gmWindow(gm)).toContainText(`${HUNTER} called Heads`);
  await expect(gmWindow(gm)).toContainText('STR check');
  await expect(gmWindow(gm)).toContainText('Natural 20');
  await answerWindow(gm, 'Coin call', 'Right');
  await expect(gmTold(gm)).toContainText(`${HUNTER} called Heads. It landed Heads: Critical success.`);
  await flipped(player, 'Heads');
  await expect(player.locator('#view-dice [data-flag]')).toHaveText('Flipped');
  const log = (await save(gm)).log[0];
  expect(log.text).toContain('Ruled Right: the coin landed Heads');
});

test('Wrong on a natural 1: the GM is told it landed on the other side, a critical failure, and the player\'s phone says only that it was flipped', async ({ device }) => {
  const { gm, player } = await room(device);
  await flipShows(gm, 'heads');
  await check(player, 1);
  await call(player, 'Heads');
  await expect(gmWindow(gm)).toContainText('Natural 1');
  await answerWindow(gm, 'Coin call', 'Wrong');
  await expect(gmTold(gm)).toContainText(`${HUNTER} called Heads. It landed Tails: Critical failure.`);
  await flipped(player, 'Heads');
});

test('Let the coin decide: the GM is told the true flip\'s side and what it means, and the player\'s phone says only that it was flipped', async ({ device }) => {
  const { gm, player } = await room(device);
  await flipShows(gm, 'heads');
  await check(player, 20);
  await call(player, 'Tails');
  await answerWindow(gm, 'Coin call', 'Let the coin decide');
  await expect(gmTold(gm)).toContainText(`${HUNTER} called Tails. It landed Heads: Success.`);
  await flipped(player, 'Tails');
});

test('the player\'s phone never receives the side or the ruling: the room\'s message holds the roll alone, and the stored coin and log hold no side', async ({ device }) => {
  const { gm, player, code } = await room(device);
  await flipShows(gm, 'heads');
  await check(player, 20);
  await call(player, 'Heads');
  await answerWindow(gm, 'Coin call', 'Right');
  await flipped(player, 'Heads');
  await card(player).getByRole('button', { name: 'Close' }).tap();
  await check(player, 20);
  await call(player, 'Heads');
  await answerWindow(gm, 'Coin call', 'Wrong');
  await flipped(player, 'Heads');

  const events = (await (await player.request.get(`/api/rooms/${code}?after=0`, { headers: await roomHeaders(player) })).json()).events as any[];
  const landings = events.filter(e => e.type === 'coinLand').map(e => e.payload);
  expect(landings.map(p => Object.keys(p).sort())).toEqual([['eid', 'roll'], ['eid', 'roll']]);
  expect(events.map(e => e.type).filter(t => t.startsWith('coin'))).toEqual(['coinCall', 'coinLand', 'coinCall', 'coinLand']);

  const s = await save(player);
  expect(s.coins.map((c: any) => [c.at, Object.keys(c).sort()])).toEqual([0, 1].map(() => ['ruled', ['at', 'call', 'face', 'hunter', 'id', 'what', 'who']]));
  const lines = s.log.filter((l: any) => l.title.startsWith('Coin'));
  expect(lines.map((l: any) => l.text)).toEqual([0, 1].map(() => 'Natural 20 for STR check. The GM flipped the coin.'));
  expect(JSON.stringify([s.coins, lines])).not.toMatch(/Tails|Ruled|Right|Wrong|decide|landed|Critical|Success|Saved/);
  expect(s.hunters.flatMap((h: any) => h.chronicle.facts).filter((f: any) => f.kind === 'coin'), 'no coin fact says whether the call was right').toEqual([]);
});

test('on a 390 px phone the player\'s flipped coin card fits the screen beside the nav and its Close button is a thumb\'s size', async ({ device }) => {
  const { gm, player } = await room(device);
  await check(player, 20);
  await call(player, 'Heads');
  await answerWindow(gm, 'Coin call', 'Right');
  await flipped(player, 'Heads');
  await expect.poll(() => card(player).evaluate(el => el.getAnimations({ subtree: true }).filter(a => a.playState === 'running').length)).toBe(0);
  const box = await card(player).evaluate(el => {
    const r = el.getBoundingClientRect(), b = el.querySelector('[data-close]')!.getBoundingClientRect();
    return { left: r.left, right: r.right, bottom: r.bottom, button: b.height, nav: document.getElementById('nav-bottom')!.getBoundingClientRect().top, width: innerWidth };
  });
  expect(box.width).toBe(PHONE.width);
  expect(box.left).toBeGreaterThanOrEqual(0);
  expect(box.right).toBeLessThanOrEqual(box.width);
  expect(box.bottom).toBeLessThanOrEqual(box.nav);
  expect(box.button).toBeGreaterThanOrEqual(44);
});

test('a hunter in a running fight who rolls a natural 20 gets no coin', async ({ device }) => {
  const { gm, player } = await room(device);
  await go(gm, 'combat');
  const combat = gm.locator('#view-combat');
  await combat.locator('[data-hsel]').selectOption({ label: `${HUNTER} (remote)` });
  await combat.locator('[data-addh]').tap();
  await combat.locator('[data-qline]').fill('Cave Rat, E, brute');
  await combat.locator('[data-qadd]').tap();
  await combat.locator('[data-start]').tap();
  await expect.poll(() => player.evaluate(() => hunterApp.api.uses.onTable(hunterApp.store.active().id))).toBe(true);
  await check(player, 20);
  await expect(player.locator('#view-dice [data-flag]')).toHaveText('Critical hit');
  await expect(card(player)).toBeHidden();
  expect((await save(player)).coins).toEqual([]);
});

test('alone on a 360 px phone, Heads and Tails sit side by side as large buttons and the coin lands by itself on a true flip', async ({ device }) => {
  const player = (await device('player', { viewport: SMALL_PHONE })).page;
  await onboardPlayer(player, HUNTER);
  await dismissAll(player, 4);
  await flipShows(player, 'heads');
  await check(player, 1);
  await expect(card(player)).toContainText('Heads or tails?');
  // the card rises into place (motion.ts `enter`, a translate and a scale): its buttons are measured once it is still, both
  // in one frame, so the boxes compared are the ones a thumb meets
  await expect.poll(() => card(player).evaluate(el => el.getAnimations({ subtree: true }).filter(a => a.playState === 'running').length)).toBe(0);
  const [heads, tails] = await card(player).evaluate(el => ['heads', 'tails'].map(side => {
    const r = el.querySelector(`[data-call="${side}"]`)!.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  }));
  expect(heads!.y).toBe(tails!.y);
  expect(Math.min(heads!.height, tails!.height)).toBeGreaterThanOrEqual(44);
  expect(heads!.x + heads!.width).toBeLessThanOrEqual(tails!.x);
  await card(player).getByRole('button', { name: 'Tails', exact: true }).tap();
  expect(await landed(player)).toEqual({ side: 'heads', words: 'Critical failure' });
  await expect(player.locator('#view-dice [data-flag]')).toHaveText('Critical failure');
});

test('a reload on either phone while the coin is in the air keeps it in the air and the GM\'s window open', async ({ device }) => {
  const { gm, player } = await room(device);
  await check(player, 20);
  await call(player, 'Tails');
  await expect(gmWindow(gm)).toContainText(`${HUNTER} called Tails`);

  await test.step('the player reloads: the coin is still in the air', async () => {
    await openApp(player);
    await expect(card(player).locator('[data-words]')).toHaveText('In the air');
  });
  await test.step('the GM reloads: the window is open again', async () => {
    await openApp(gm);
    await expect(gmWindow(gm)).toContainText(`${HUNTER} called Tails`);
  });
  await test.step('the GM\'s ruling still reaches the player, with no side', async () => {
    await answerWindow(gm, 'Coin call', 'Right');
    await flipped(player, 'Tails');
  });
});

/** The calls the GM put off, as the coin card offers them. */
const putOff = (gm: Page) => card(gm).locator('[data-put-off]');

test('a GM who closes a coin call\'s window is not asked again until they tap Rule on it in the coin card, and the ruling still reaches the player', async ({ device }) => {
  const { gm, player } = await room(device);
  await flipShows(gm, 'heads');
  await check(player, 20);
  await call(player, 'Tails');
  await expect(gmWindow(gm)).toContainText(`${HUNTER} called Tails`);

  await test.step('Escape puts the call off: the window stays closed and the coin card offers the call', async () => {
    await gm.keyboard.press('Escape');
    await expect(putOff(gm)).toContainText(`${HUNTER} called Tails`);
    await expect(gmWindow(gm)).toHaveCount(0);
  });
  await test.step('the GM can look at the party board while the call waits', async () => {
    await go(gm, 'status');
    await go(gm, 'gm');
    await expect(gm.locator('#gm-board .gm-card.remote', { hasText: HUNTER })).toBeVisible();
    await expect(gmWindow(gm)).toHaveCount(0);
  });
  await test.step('Rule opens the window again; Later and a tap beside it each put it off again', async () => {
    await putOff(gm).getByRole('button', { name: 'Rule' }).tap();
    await answerWindow(gm, 'Coin call', 'Later');
    await expect(putOff(gm)).toHaveCount(1);
    await putOff(gm).getByRole('button', { name: 'Rule' }).tap();
    await expect(gmWindow(gm)).toBeVisible();
    await gmWindow(gm).tap({ position: { x: 4, y: 4 } });
    await expect(gmWindow(gm)).toHaveCount(0);
    await expect(putOff(gm)).toHaveCount(1);
  });
  await test.step('Rule, then Right: the player\'s coin is flipped and the card no longer offers the call', async () => {
    await putOff(gm).getByRole('button', { name: 'Rule' }).tap();
    await answerWindow(gm, 'Coin call', 'Right');
    await flipped(player, 'Tails');
    await expect(putOff(gm)).toHaveCount(0);
    await expect(card(gm)).toBeHidden();
  });
});

test('a call that arrives while another is put off opens its own window, and the put-off call stays in the coin card', async ({ device }) => {
  const { gm, player } = await room(device);
  await check(player, 20);
  await call(player, 'Heads');
  await expect(gmWindow(gm)).toContainText(`${HUNTER} called Heads`);
  await gm.keyboard.press('Escape');
  await expect(putOff(gm)).toHaveCount(1);

  await check(player, 1);
  await card(player).locator('li', { hasText: 'Natural 1' }).getByRole('button', { name: 'Tails', exact: true }).tap();
  await expect(gmWindow(gm)).toContainText('Natural 1');
  await expect(gmWindow(gm)).toContainText(`${HUNTER} called Tails`);
  await expect(putOff(gm)).toHaveCount(1);
  await expect(putOff(gm)).toContainText(`${HUNTER} called Heads`);
  await answerWindow(gm, 'Coin call', 'Wrong');
  await expect(gmWindow(gm)).toHaveCount(0);
  await expect(putOff(gm)).toContainText(`${HUNTER} called Heads`);
});

test('on a 390 px phone the GM\'s put-off call fits the screen beside the nav and its Rule button is a thumb\'s size', async ({ device }) => {
  const { gm, player } = await room(device);
  await check(player, 20);
  await call(player, 'Heads');
  await expect(gmWindow(gm)).toBeVisible();
  await gm.keyboard.press('Escape');
  await expect(putOff(gm)).toHaveCount(1);
  await expect.poll(() => card(gm).evaluate(el => el.getAnimations({ subtree: true }).filter(a => a.playState === 'running').length)).toBe(0);
  const box = await card(gm).evaluate(el => {
    const r = el.getBoundingClientRect(), b = el.querySelector('[data-put-off] button')!.getBoundingClientRect();
    return { left: r.left, right: r.right, bottom: r.bottom, button: b.height, nav: document.getElementById('nav-bottom')!.getBoundingClientRect().top, width: innerWidth };
  });
  expect(box.left).toBeGreaterThanOrEqual(0);
  expect(box.right).toBeLessThanOrEqual(box.width);
  expect(box.bottom).toBeLessThanOrEqual(box.nav);
  expect(box.button).toBeGreaterThanOrEqual(44);
});
