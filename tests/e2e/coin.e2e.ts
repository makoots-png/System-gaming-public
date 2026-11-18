// The coin call (src/views/coin.js, src/core/coin.ts): a check's natural 1 or 20 outside a fight asks the player heads or
// tails; the GM rules in a System window, and the player's phone hears only where the coin landed.
import type { Page } from '@playwright/test';
import { test, expect, onboardGM, onboardPlayer, createRoom, dismissAll, go, answerWindow, openApp, roomHeaders, save, SMALL_PHONE } from './helpers.ts';

const HUNTER = 'Kai Test';
const card = (page: Page) => page.locator('[data-coin-card]');
const gmWindow = (gm: Page) => gm.locator('.sys-overlay.show', { hasText: 'Coin call' });

/** A GM and a player in one room, the player's card on the GM's party board. Answers the room code too. */
async function room(device: (label: string) => Promise<{ page: Page }>): Promise<{ gm: Page; player: Page; code: string }> {
  const gm = (await device('gm')).page, player = (await device('player')).page;
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

/** The player's coin after it landed: the side its face rests on and the words under it. */
async function landed(player: Page): Promise<{ side: string | null; words: string }> {
  const words = card(player).locator('[data-words]');
  await expect(words).not.toHaveText('In the air');
  return { side: await card(player).locator('[data-coin-face]').getAttribute('data-side'), words: (await words.textContent()) ?? '' };
}

test('a player\'s natural 20 asks heads or tails; the GM sees the call and rules Right; the coin lands on the called side and reads "Critical success"', async ({ device }) => {
  const { gm, player } = await room(device);
  await flipShows(gm, 'tails');
  await check(player, 20);
  await call(player, 'Heads');
  await expect(gmWindow(gm)).toContainText(`${HUNTER} called Heads`);
  await expect(gmWindow(gm)).toContainText('STR check');
  await expect(gmWindow(gm)).toContainText('Natural 20');
  await answerWindow(gm, 'Coin call', 'Right');
  expect(await landed(player)).toEqual({ side: 'heads', words: 'Critical success' });
  const log = (await save(gm)).log[0];
  expect(log.text).toContain('Ruled Right');
});

test('Wrong on a natural 1 lands the coin on the other side and reads "Critical failure"', async ({ device }) => {
  const { gm, player } = await room(device);
  await flipShows(gm, 'heads');
  await check(player, 1);
  await call(player, 'Heads');
  await expect(gmWindow(gm)).toContainText('Natural 1');
  await answerWindow(gm, 'Coin call', 'Wrong');
  expect(await landed(player)).toEqual({ side: 'tails', words: 'Critical failure' });
});

test('Let the coin decide lands a side and the words agree with it', async ({ device }) => {
  const { gm, player } = await room(device);
  await flipShows(gm, 'heads');
  await check(player, 20);
  await call(player, 'Tails');
  await answerWindow(gm, 'Coin call', 'Let the coin decide');
  expect(await landed(player)).toEqual({ side: 'heads', words: 'Success' });
});

test('the player\'s phone holds nothing that tells a ruling from a flip: the room\'s landing and the stored coin hold only the side', async ({ device }) => {
  const { gm, player, code } = await room(device);
  await flipShows(gm, 'heads');
  await check(player, 20);
  await call(player, 'Heads');
  await answerWindow(gm, 'Coin call', 'Right');
  await landed(player);
  await card(player).getByRole('button', { name: 'Close' }).tap();
  await check(player, 20);
  await call(player, 'Heads');
  await answerWindow(gm, 'Coin call', 'Let the coin decide');
  await landed(player);

  const events = (await (await player.request.get(`/api/rooms/${code}?after=0`, { headers: await roomHeaders(player) })).json()).events as any[];
  const landings = events.filter(e => e.type === 'coinLand').map(e => e.payload);
  expect(landings.map(p => Object.keys(p).sort())).toEqual([['eid', 'roll', 'side'], ['eid', 'roll', 'side']]);
  expect(landings.map(p => p.side)).toEqual(['heads', 'heads']);
  expect(events.map(e => e.type).filter(t => t.startsWith('coin'))).toEqual(['coinCall', 'coinLand', 'coinCall', 'coinLand']);

  const s = await save(player);
  expect(s.coins.map((c: any) => Object.keys(c).sort())).toEqual([['at', 'call', 'face', 'hunter', 'id', 'side', 'what', 'who'], ['at', 'call', 'face', 'hunter', 'id', 'side', 'what', 'who']]);
  expect(s.coins.map((c: any) => c.hunter), 'the coin names the hunter who rolled, and nothing of the ruling').toEqual([{ kind: 'local', hunterId: s.settings.activeHunterId }, { kind: 'local', hunterId: s.settings.activeHunterId }]);
  const lines = s.log.filter((l: any) => l.title.startsWith('Coin'));
  expect(lines).toHaveLength(2);
  expect([lines[0].title, lines[0].text]).toEqual([lines[1].title, lines[1].text]);
  expect(JSON.stringify([s.coins, lines])).not.toMatch(/Ruled|Right|Wrong|decide/);
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
  await test.step('the GM\'s ruling still reaches the player', async () => {
    await answerWindow(gm, 'Coin call', 'Right');
    expect(await landed(player)).toEqual({ side: 'tails', words: 'Critical success' });
  });
});
