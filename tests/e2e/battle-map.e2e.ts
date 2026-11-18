// The battle map (src/views/map.js, its scene from src/core/combat/map-view.ts) on the GM's phone and a player's: the
// same tokens on both, a move picked from the movement area and confirmed, the GM's long-press drag, a pan, and an
// ability used from the hotbar with its reach, targets, splash and ring.
import type { Page } from '@playwright/test';
import { RULES } from '../../src/core/rules.ts';
import { abilityId } from '../../src/core/combat/ability-types.ts';
import { abilityOf } from '../../src/core/registry/ability-kinds.ts';
import { test, expect, onboardGM, onboardPlayer, createRoom, dismissAll, go, fightRow } from './helpers.ts';

const HUNTER = 'Kai Map', MONSTER = 'Cave Rat', BRAKK = 'Brakk Ironhide';
/** Every die rolls its lowest face: a reaction d20 of 1 is caught and a crit, so a use lands. */
const lowestDice = (page: Page) => page.evaluate(() => Object.defineProperty(crypto, 'getRandomValues', { configurable: true, value: (a: Uint32Array) => a.fill(0) }));
/** The share of HP a token's ring shows (`--f` of its ring). */
const ringOf = (page: Page, id: string) => token(page, id).locator('.mp-ring').evaluate(el => Number((el as HTMLElement).style.getPropertyValue('--f')));
const combat = (page: Page) => page.locator('#view-combat');
const map = (page: Page) => combat(page).locator('[data-mapbox]');
const token = (page: Page, id: string) => map(page).locator(`[data-tok="${id}"]`);

/** A GM and a player in one room, the player's card on the GM's party board. */
async function room(device: (label: string) => Promise<{ page: Page }>): Promise<{ gm: Page; player: Page }> {
  const gm = (await device('gm')).page, player = (await device('player')).page;
  await onboardGM(gm);
  const code = await createRoom(gm);
  await onboardPlayer(player, HUNTER, code);
  await expect.poll(() => player.evaluate(() => hunterApp.api.sync.room())).toBe(code);
  await dismissAll(player, 4);
  await go(gm, 'gm');
  await expect(gm.locator('#gm-board .gm-card.remote', { hasText: HUNTER })).toHaveCount(1);
  return { gm, player };
}

/**
 * The GM's fight with the player's hunter and `rats` rats (setup: the hunter at (2, 2), the rats from `ratAt`, the turn
 * the hunter's), both phones on the map. Answers the row ids.
 */
async function fight(gm: Page, player: Page, ratAt: { x: number; y: number }[], brakkAt: { x: number; y: number } | null = null): Promise<{ kai: string; rats: string[] }> {
  await go(gm, 'combat');
  await combat(gm).locator('[data-hsel]').selectOption({ label: `${HUNTER} (remote)` });
  await combat(gm).locator('[data-addh]').tap();
  if (brakkAt) { await combat(gm).locator('[data-hsel]').selectOption({ label: BRAKK }); await combat(gm).locator('[data-addh]').tap(); }
  await combat(gm).locator('[data-qline]').fill(`${MONSTER} x${ratAt.length}, E, brute`);
  await combat(gm).locator('[data-qadd]').tap();
  await combat(gm).locator('[data-start]').tap();
  await expect(map(gm).locator('.mp-tok.now')).toHaveCount(1);
  const ids = await gm.evaluate(([name, at, brakk]) => {
    let out = { kai: '', rats: [] as string[] };
    hunterApp.store.update((d: any) => {
      const f = d.fight, kai = f.rows.find((r: any) => r.name === name), rats = f.rows.filter((r: any) => r.kind === 'monster');
      const b = f.rows.find((r: any) => r.name === 'Brakk Ironhide');
      if (b && brakk) { b.place = brakk; b.at = f.now + 50; b.tie = 0; }
      kai.place = { x: 2, y: 2 }; kai.at = f.now; kai.tie = 0;
      rats.forEach((r: any, i: number) => { r.place = at[i]; r.at = f.now + 1 + i; r.tie = 0; });
      f.currentId = kai.id; f.log = [];
      out = { kai: kai.id, rats: rats.map((r: any) => r.id) };
    }, 'test-setup');
    return out;
  }, [HUNTER, ratAt, brakkAt] as const);
  await combat(gm).locator('[data-fview="map"]').tap();
  await go(player, 'combat');
  await expect(combat(player).locator('.tb-mine')).toContainText('YOUR TURN');
  await combat(player).locator('[data-fview="map"]').tap();
  for (const p of [gm, player]) await expect(token(p, ids.kai)).toBeVisible();
  // the start's doc may already call the hunter's turn, from where the fight first stood it: wait for the doc of the setup
  for (const p of [gm, player]) await expect.poll(() => placeOf(p, ids.kai)).toEqual([2, 2]);
  // the map opened while the fight was built and framed the tokens where they stood then: a double tap frames them again
  for (const p of [gm, player]) await map(p).locator('[data-frame]').dblclick({ position: { x: 4, y: 4 } });
  return ids;
}

/** Where the centre of tile (x, y) is on the page: the world layer's box, scaled by its zoom. */
async function tileAt(page: Page, x: number, y: number): Promise<{ x: number; y: number }> {
  await map(page).locator('[data-frame]').scrollIntoViewIfNeeded();
  return map(page).locator('[data-world]').evaluate((w, [tx, ty]) => {
    // the world is 40 pixels a tile at zoom 1 (map.js TILE); its box on the page is that times the zoom
    const r = w.getBoundingClientRect(), s = r.width / (w as HTMLElement).offsetWidth;
    return { x: r.left + (tx! + 0.5) * 40 * s, y: r.top + (ty! + 0.5) * 40 * s };
  }, [x, y]);
}
async function tapTile(page: Page, x: number, y: number): Promise<void> {
  const p = await tileAt(page, x, y);
  await page.touchscreen.tap(p.x, p.y);
}
const placeOf = (page: Page, id: string) => token(page, id).evaluate(el => [Number((el as HTMLElement).dataset['x']), Number((el as HTMLElement).dataset['y'])]);
const fightNow = (gm: Page) => gm.evaluate(() => hunterApp.store.get().fight.now as number);

test('a player who taps the Fight tab as the GM\'s fight arrives is on the Fight tab', async ({ device }) => {
  const { gm, player } = await room(device);
  await go(player, 'status');
  // a tab's link sets the hash and its hashchange comes in a later task: the poll that brings the fight lands between
  await player.evaluate(() => {
    const was = JSON.stringify(hunterApp.api.sync.doc('fight'));
    let armed = true;
    hunterApp.on('sync:sheets', () => {
      if (!armed || JSON.stringify(hunterApp.api.sync.doc('fight')) === was) return;
      armed = false; location.hash = '#/combat';
    });
  });
  await go(gm, 'combat');
  await combat(gm).locator('[data-hsel]').selectOption({ label: `${HUNTER} (remote)` });
  await combat(gm).locator('[data-addh]').tap();
  await combat(gm).locator('[data-qline]').fill(`${MONSTER} x1, E, brute`);
  await combat(gm).locator('[data-qadd]').tap();
  await combat(gm).locator('[data-start]').tap();
  await expect(combat(player)).toBeVisible();
  await expect(combat(player).locator('[data-panel="table-hud"]')).toBeVisible();
  expect(await player.evaluate(() => location.hash)).toBe('#/combat');
});

test('on a 360 by 640 phone the player\'s map opens on the fight with tokens a thumb can hit, names under them, and the hotbar on the first screen', async ({ device }) => {
  const { gm, player } = await room(label => device(label, label === 'player' ? { viewport: { width: 360, height: 640 } } : {}));
  const { kai, rats } = await fight(gm, player, [{ x: 6, y: 3 }]);
  await player.evaluate(() => scrollTo(0, 0));
  const nav = (await player.locator('.nav-bottom').boundingBox())!;
  const hot = (await map(player).locator('[data-hot]').boundingBox())!, frame = (await map(player).locator('[data-frame]').boundingBox())!;
  expect(hot.y + hot.height, 'the hotbar ends above the bottom bar with the page at its top').toBeLessThanOrEqual(nav.y);
  expect(frame.height, 'the map takes the room left, not a sliver').toBeGreaterThanOrEqual(200);
  for (const id of [kai, rats[0]!]) {
    const t = (await token(player, id).boundingBox())!;
    expect(Math.min(t.width, t.height), 'a token is at least 44 px').toBeGreaterThanOrEqual(44);
    expect(t.x >= frame.x && t.x + t.width <= frame.x + frame.width && t.y >= frame.y && t.y + t.height <= frame.y + frame.height, 'both bodies are in the frame').toBe(true);
  }
  await expect(token(player, kai).locator('.mp-name')).toHaveText('Kai');
  await expect(token(player, rats[0]!).locator('.mp-name')).toHaveText('Rat');
});

test('a player who opened the map on a foe\'s turn still has End turn above the bottom bar when the turn comes to them', async ({ device }) => {
  const { gm, player } = await room(label => device(label, label === 'player' ? { viewport: { width: 360, height: 640 } } : {}));
  const { kai } = await fight(gm, player, [{ x: 6, y: 3 }]);
  await map(player).locator('[data-pass]').tap();
  await expect(token(gm, kai)).not.toHaveClass(/\bnow\b/);
  await expect(combat(player).locator('.tb-mine')).toHaveCount(0);
  await test.step('the player opens the app again while the rat acts: the map frames with no YOUR TURN line over it', async () => {
    await player.reload();
    await player.waitForFunction(() => window.hunterApp && document.querySelectorAll('#nav-top a').length > 0);
    await go(player, 'combat');
    await expect(map(player).locator('.mp-tok')).toHaveCount(2);
  });
  await combat(gm).locator('[data-next], [data-fk="next"]').first().tap();
  await expect(combat(player).locator('.tb-mine')).toContainText('YOUR TURN');
  // the line over the map pushed the frame down: the frame gives the height back, so the hotbar stays on the first screen
  await expect.poll(async () => {
    await player.evaluate(() => scrollTo(0, 0));
    const end = await map(player).locator('[data-pass]').boundingBox(), nav = await player.locator('.nav-bottom').boundingBox();
    return end && nav ? end.y + end.height <= nav.y : false;
  }, { message: 'End turn is above the bottom bar' }).toBe(true);
});

for (const [width, height] of [[360, 640], [390, 844]] as const) {
  test(`on a ${width} px phone a player's turn with two abilities shows End turn whole on the first screen, and the bar fades where it scrolls`, async ({ device }) => {
    const { gm, player } = await room(label => device(label, label === 'player' ? { viewport: { width, height } } : {}));
    const fester = abilityOf('curse', { id: abilityId('fester'), name: 'Fester' }, RULES);
    await player.evaluate(a => { const s = hunterApp.store; s.update(() => { s.active().skills.push({ id: s.id('s'), name: 'Fester', type: 'active', level: 1, label: null, desc: '', ability: a }); }, 'test-setup'); }, fester);
    await expect.poll(() => gm.evaluate(() => (hunterApp.api.sync.remoteSheets() as any[]).some(r => r.data.skills.some((k: any) => k.name === 'Fester')))).toBe(true);
    await fight(gm, player, [{ x: 6, y: 3 }]);
    await player.evaluate(() => scrollTo(0, 0));
    const hot = map(player).locator('[data-hot]');
    await expect(hot.locator('.mp-hb', { hasText: 'Fester' })).toHaveCount(1);
    await expect(hot.locator('[data-more]')).toHaveCount(1);
    const end = (await hot.locator('[data-pass]').boundingBox())!, nav = (await player.locator('.nav-bottom').boundingBox())!;
    expect(end.x >= 0 && end.x + end.width <= width, 'End turn is whole across the screen').toBe(true);
    expect(end.y + end.height, 'End turn is above the bottom bar').toBeLessThanOrEqual(nav.y);
    expect(end.height, 'End turn is a 44 px target').toBeGreaterThanOrEqual(44);
    const slots = hot.locator('[data-slots]');
    await expect.poll(() => slots.evaluate(el => [el.scrollWidth > el.clientWidth + 1, el.classList.contains('cut')]), { message: 'the bar fades at its edge exactly when it scrolls' })
      .toEqual(await slots.evaluate(el => [el.scrollWidth > el.clientWidth + 1, el.scrollWidth > el.clientWidth + 1]));
  });
}

test('the GM and the player see the same tokens on the map, the player\'s own marked as theirs', async ({ device }) => {
  const { gm, player } = await room(device);
  const { kai, rats } = await fight(gm, player, [{ x: 2, y: 4 }]);
  for (const p of [gm, player]) {
    expect(await placeOf(p, kai)).toEqual([2, 2]);
    expect(await placeOf(p, rats[0]!)).toEqual([2, 4]);
    await expect(token(p, rats[0]!)).toHaveClass(/\bfoe\b/);
  }
  await expect(token(player, kai)).toHaveClass(/\bmine\b/);
  await expect(token(player, kai)).toHaveAttribute('aria-label', new RegExp(`^${HUNTER}, HP \\d+ of \\d+, their turn`));
  await expect(token(gm, rats[0]!)).toHaveAttribute('aria-label', /^Cave Rat, healthy/);
});

test('a player taps a tile inside their movement area and confirms, and their token is on that tile on both phones', async ({ device }) => {
  const { gm, player } = await room(device);
  const { kai } = await fight(gm, player, [{ x: 10, y: 10 }]);
  await expect(map(player).locator('[data-shade="stride"]').first()).toBeAttached();
  await tapTile(player, 4, 2);
  const confirm = map(player).locator('[data-confirm]');
  await expect(confirm.locator('[data-words]')).toHaveText('2 tiles: a third of your turn');
  await confirm.locator('[data-go]', { hasText: 'Move' }).tap();
  await expect.poll(() => fightRow(gm, HUNTER).then(r => [r.place.x, r.place.y])).toEqual([4, 2]);
  for (const p of [gm, player]) await expect.poll(() => placeOf(p, kai)).toEqual([4, 2]);
});

test('a tile outside the player\'s movement area cannot be chosen', async ({ device }) => {
  const { gm, player } = await room(device);
  // a dash runs the whole move (6 tiles at base speed) in a straight line; 8 tiles down is past it
  const { kai } = await fight(gm, player, [{ x: 2, y: 12 }]);
  await expect(map(player).locator('[data-shade="stride"]').first()).toBeAttached();
  await tapTile(player, 2, 10);
  await expect(map(player).locator('[data-confirm]')).toBeHidden();
  await expect(map(player).locator('[data-shade="way"]')).toHaveCount(0);
  expect(await placeOf(gm, kai)).toEqual([2, 2]);
});

test('a rooted hunter has no movement area', async ({ device }) => {
  const { gm, player } = await room(device);
  const { kai } = await fight(gm, player, [{ x: 10, y: 10 }]);
  await expect(map(player).locator('[data-shade="stride"]').first()).toBeAttached();
  await gm.evaluate(id => hunterApp.api.combat.status(id, { add: { key: 'map-root', def: { label: 'Rooted', desc: '', ops: [{ op: 'root' }] }, rounds: 2, tier: 0 } }), kai);
  await expect(map(player).locator('[data-shade]')).toHaveCount(0);
  await tapTile(player, 3, 2);
  await expect(map(player).locator('[data-confirm]')).toBeHidden();
});

test('the GM picks a monster up with a long press, drops it on a new tile, and no time passes', async ({ device }) => {
  const { gm, player } = await room(device);
  const { rats } = await fight(gm, player, [{ x: 6, y: 6 }]);
  const now = await fightNow(gm), at = (await fightRow(gm, MONSTER)).at;
  const from = await tileAt(gm, 6, 6), to = await tileAt(gm, 8, 5);
  await gm.mouse.move(from.x, from.y);
  await gm.mouse.down();
  await expect(token(gm, rats[0]!)).toHaveClass(/\blifted\b/);
  await gm.mouse.move(to.x, to.y, { steps: 6 });
  await gm.mouse.up();
  await expect.poll(() => fightRow(gm, MONSTER).then(r => [r.place.x, r.place.y])).toEqual([8, 5]);
  expect([await fightNow(gm), (await fightRow(gm, MONSTER)).at]).toEqual([now, at]);
  await expect.poll(() => placeOf(player, rats[0]!)).toEqual([8, 5]);
});

test('the GM\'s slow tap on a monster, held until it lifts and let go where it was, opens its card and moves nothing', async ({ device }) => {
  const { gm, player } = await room(device);
  const { rats } = await fight(gm, player, [{ x: 6, y: 6 }]);
  const at = await tileAt(gm, 6, 6);
  await gm.mouse.move(at.x, at.y);
  await gm.mouse.down();
  await expect(token(gm, rats[0]!)).toHaveClass(/\blifted\b/);
  await gm.mouse.up();
  await expect(combat(gm).locator('[data-cardbox]')).toHaveClass(/\bsheet\b/);
  await expect(combat(gm).locator('[data-cardbox]')).toContainText(MONSTER);
  await expect(token(gm, rats[0]!)).not.toHaveClass(/\blifted\b/);
  expect(await fightRow(gm, MONSTER).then(r => [r.place.x, r.place.y])).toEqual([6, 6]);
});

test('right after a pan with a finger, a tap on a tile in the movement area chooses it', async ({ device }) => {
  const { gm, player } = await room(device);
  await fight(gm, player, [{ x: 6, y: 6 }]);
  const world = map(player).locator('[data-world]'), before = await world.evaluate(w => (w as HTMLElement).style.transform);
  const f = (await map(player).locator('[data-frame]').boundingBox())!, x = f.x + f.width / 2, y = f.y + f.height / 2;
  const cdp = await player.context().newCDPSession(player);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  for (let i = 1; i <= 4; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x - 15 * i, y }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect.poll(() => world.evaluate(w => (w as HTMLElement).style.transform)).not.toBe(before);
  // Chrome sends no click for a tap this soon after a pan; the map's tap is its finger's lift, so it is not lost
  await tapTile(player, 4, 2);
  await expect(map(player).locator('[data-confirm] [data-go]')).toHaveText('Move');
});

test('a pan moves the map, not a token', async ({ device }) => {
  const { gm, player } = await room(device);
  const { kai, rats } = await fight(gm, player, [{ x: 6, y: 6 }]);
  const world = map(gm).locator('[data-world]'), before = await world.evaluate(w => (w as HTMLElement).style.transform);
  const from = await tileAt(gm, 4, 4), dx = -60, dy = -40;
  await gm.mouse.move(from.x, from.y);
  await gm.mouse.down();
  await gm.mouse.move(from.x + dx, from.y + dy, { steps: 8 });
  await gm.mouse.up();
  await expect.poll(() => world.evaluate(w => (w as HTMLElement).style.transform)).not.toBe(before);
  expect([await placeOf(gm, rats[0]!), await placeOf(gm, kai)]).toEqual([[6, 6], [2, 2]]);
  expect(await fightRow(gm, MONSTER).then(r => [r.place.x, r.place.y])).toEqual([6, 6]);
  await expect(token(gm, rats[0]!)).not.toHaveClass(/\blifted\b/);
});


test('the GM picks a monster\'s attack: its reach shows, a hunter out of reach cannot be picked, and the one in reach is hit and its ring shrinks on both phones', async ({ device }) => {
  const { gm, player } = await room(device);
  const { kai, rats } = await fight(gm, player, [{ x: 2, y: 3 }], { x: 8, y: 2 });
  await gm.evaluate(id => hunterApp.store.update((d: any) => { d.fight.currentId = id; d.fight.rows.find((r: any) => r.id === id).at = d.fight.now; }, 'test-setup'), rats[0]!);
  await expect(token(gm, rats[0]!)).toHaveClass(/\bnow\b/);
  await lowestDice(gm);
  const ring = await ringOf(player, kai);
  await map(gm).locator('[data-hot] .mp-hb').first().tap();
  await expect(map(gm).locator('[data-shade="reach"]').first()).toBeAttached();
  await expect(token(gm, kai)).toHaveClass(/\btgt\b/);
  await tapTile(gm, 8, 2);
  await expect(map(gm).locator('[data-news]')).toHaveText('Out of reach.');
  await expect(gm.locator('#toasts .toast')).toHaveCount(0);
  await expect(map(gm).locator('[data-go]')).toBeDisabled();
  await tapTile(gm, 2, 2);
  await expect(map(gm).locator('[data-words]')).toHaveText(`Hits ${HUNTER}.`);
  await map(gm).locator('[data-go]').tap();
  for (const p of [gm, player]) await expect.poll(() => ringOf(p, kai)).toBeLessThan(ring);
});

test('a player uses Strike from the map on their turn and the rat is hit; off their turn the hotbar is refused in the line over the map', async ({ device }) => {
  const { gm, player } = await room(device);
  const { rats } = await fight(gm, player, [{ x: 2, y: 3 }]);
  await lowestDice(gm); await lowestDice(player);
  const hp = (await fightRow(gm, MONSTER)).hp;
  await map(player).locator('[data-hot] .mp-hb').first().tap();
  await tapTile(player, 2, 3);
  await expect(map(player).locator('[data-words]')).toHaveText(`Hits ${MONSTER}.`);
  await map(player).locator('[data-go]').tap();
  await expect.poll(() => fightRow(gm, MONSTER).then(r => r.hp)).toBeLessThan(hp);
  await expect(combat(player).locator('.tb-mine')).toHaveCount(0);
  await expect(token(player, rats[0]!)).toHaveClass(/\bnow\b/);
  await map(player).locator('[data-hot] .mp-hb').first().tap();
  await expect(map(player).locator('[data-news]')).toHaveText('It is not your turn.');
  await expect(player.locator('#toasts .toast')).toHaveCount(0);
});

test('right after a pan with a finger, a tap on Use sends the use once', async ({ device }) => {
  const { gm, player } = await room(device);
  await fight(gm, player, [{ x: 2, y: 3 }]);
  await lowestDice(gm); await lowestDice(player);
  const hp = (await fightRow(gm, MONSTER)).hp;
  await map(player).locator('[data-hot] .mp-hb').first().tap();
  await tapTile(player, 2, 3);
  await expect(map(player).locator('[data-words]')).toHaveText(`Hits ${MONSTER}.`);
  const world = map(player).locator('[data-world]'), before = await world.evaluate(w => (w as HTMLElement).style.transform);
  const f = (await map(player).locator('[data-frame]').boundingBox())!, x = f.x + f.width / 2, y = f.y + f.height / 2;
  const cdp = await player.context().newCDPSession(player);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  for (let i = 1; i <= 4; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x - 15 * i, y }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  // Chrome sends no click for a tap this soon after a pan (measured about 60 ms after it); Use acts at the finger's lift
  await map(player).locator('[data-go]').tap();
  await expect.poll(() => world.evaluate(w => (w as HTMLElement).style.transform)).not.toBe(before);
  await expect.poll(() => fightRow(gm, MONSTER).then(r => r.hp)).toBeLessThan(hp);
  const uses = await gm.evaluate(() => (hunterApp.store.get().fight.log as { text: string }[]).filter(l => l.text.includes('Strike')).length);
  expect(uses).toBe(1);
});

test('Cancel puts an aimed ability down and spends nothing', async ({ device }) => {
  const { gm, player } = await room(device);
  await fight(gm, player, [{ x: 2, y: 3 }]);
  const before = await gm.evaluate(() => { const f = hunterApp.store.get().fight; return JSON.stringify([f.now, f.rows.map((r: any) => [r.hp, r.fatigue, r.mana, r.at])]); });
  await map(player).locator('[data-hot] .mp-hb').first().tap();
  await tapTile(player, 2, 3);
  await expect(map(player).locator('[data-go]')).toBeEnabled();
  await map(player).locator('[data-cancel]').tap();
  await expect(map(player).locator('[data-confirm]')).toBeHidden();
  await expect(map(player).locator('[data-shade="reach"]')).toHaveCount(0);
  expect(await gm.evaluate(() => { const f = hunterApp.store.get().fight; return JSON.stringify([f.now, f.rows.map((r: any) => [r.hp, r.fatigue, r.mana, r.at])]); })).toBe(before);
});

test('a GM\'s fight opens on the map, and while it runs the screen is the fight: Add to the fight and the log wait behind Fight tools', async ({ device }) => {
  const { gm, player } = await room(device);
  await go(gm, 'combat');
  await combat(gm).locator('[data-hsel]').selectOption({ label: `${HUNTER} (remote)` });
  await combat(gm).locator('[data-addh]').tap();
  await combat(gm).locator('[data-qline]').fill(`${MONSTER} x1, E, brute`);
  await combat(gm).locator('[data-qadd]').tap();
  await expect(combat(gm).locator('[data-fview="map"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(combat(gm).locator('[data-build]')).toBeVisible();
  await combat(gm).locator('[data-start]').tap();
  await expect(map(gm).locator('[data-frame]')).toBeVisible();
  await expect(map(gm).locator('[data-hot]')).toBeVisible();
  for (const hidden of ['[data-build]', '[data-log]', '[data-end]', '.cmb-list']) await expect(combat(gm).locator(hidden)).toBeHidden();
  await combat(gm).locator('[data-tools-open]').tap();
  const tools = combat(gm).getByRole('dialog', { name: 'Fight tools' });
  for (const shown of ['[data-build]', '[data-log]', '[data-end]']) await expect(tools.locator(shown)).toBeVisible();
  await tools.locator('[data-toolsx]').tap();
  await expect(tools).toBeHidden();
  await go(player, 'combat');
  await expect(combat(player).locator('[data-fview="map"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(map(player).locator('[data-frame]')).toBeVisible();
});

/** Every die rolls its highest face: a reaction d20 of 20 uses all the time a slow ability gives to move. */
const highestDice = (page: Page) => page.evaluate(() => Object.defineProperty(crypto, 'getRandomValues', { configurable: true, value: (a: Uint32Array) => a.fill(0xffffffff) }));

test('a blast aimed at a place marks who is caught and who is in its ring before Use, and after Use the hunter who outran it stands where they escaped to on both phones', async ({ device }) => {
  const { gm, player } = await room(device);
  const { kai, rats } = await fight(gm, player, [{ x: 2, y: 7 }]);
  await combat(gm).locator('[data-tools-open]').tap();
  await combat(gm).locator('[data-msel]').selectOption({ label: 'Cerberus (C boss)' });
  await combat(gm).locator('[data-addm]').tap();
  await combat(gm).locator('[data-toolsx]').tap();
  const boss = await gm.evaluate(() => {
    let id = '';
    hunterApp.store.update((d: any) => {
      const f = d.fight, b = f.rows.find((r: any) => r.name.startsWith('Cerberus'));
      b.place = { x: 10, y: 2 }; b.at = f.now; b.tie = 0; f.currentId = b.id; id = b.id;
    }, 'test-setup');
    return id;
  });
  await expect(token(gm, boss)).toHaveClass(/\bnow\b/);
  await highestDice(gm);
  await map(gm).locator('[data-hot] .mp-hb', { hasText: 'Hellfire Breath' }).tap();
  await expect(map(gm).locator('[data-shade="reach"]')).toHaveClass(/\bhostile\b/);
  // Hellfire Breath: 30 feet is a radius of 3 tiles and an outer ring to 4 (abilities.ts, RULES.fight.abilityKinds.blast);
  // aimed at (2, 3), the hunter at (2, 2) is 1 away and the rat at (2, 7) is 4 away. The map framed the boss when its turn
  // came, at a thumb's zoom where (2, 3) is off a phone's screen: the GM zooms out first
  const f = (await map(gm).locator('[data-frame]').boundingBox())!;
  await gm.mouse.move(f.x + f.width / 2, f.y + f.height / 2);
  for (let i = 0; i < 6; i++) await gm.mouse.wheel(0, 100);
  await tapTile(gm, 2, 3);
  await expect(map(gm).locator('[data-shade="splash"]')).toBeAttached();
  await expect(map(gm).locator('[data-shade="ring"]')).toBeAttached();
  await expect(token(gm, kai).locator('.mp-mark')).toHaveText('Caught');
  await expect(token(gm, rats[0]!).locator('.mp-mark')).toHaveText('Ring');
  await expect(map(gm).locator('[data-words]')).toHaveText(`Hits ${HUNTER}. In the ring: ${MONSTER}.`);
  await map(gm).locator('[data-go]').tap();
  await expect.poll(() => fightRow(gm, HUNTER).then(r => r.place.x !== 2 || r.place.y !== 2)).toBe(true);
  const escaped = await fightRow(gm, HUNTER).then(r => [r.place.x, r.place.y]);
  // out of the ring: more than 4 tiles from (2, 3) by 5-10-5
  const [ex, ey] = escaped as [number, number], dx = Math.abs(ex - 2), dy = Math.abs(ey - 3);
  expect(Math.max(dx, dy) + Math.floor(Math.min(dx, dy) / 2)).toBeGreaterThan(4);
  for (const p of [gm, player]) await expect.poll(() => placeOf(p, kai)).toEqual(escaped);
});

test('a player uses a Health Potion from the More drawer on the map: one leaves the bag and their HP rises on both phones', async ({ device }) => {
  const { gm, player } = await room(device);
  // the shop's Health Potion (items.ts SHOP_ITEMS), two of them in the player's bag
  await player.evaluate(() => {
    const potion = hunterApp.api.inventory.shop().find((i: any) => i.name === 'Health Potion');
    hunterApp.api.inventory.addItem(hunterApp.store.active().id, { ...potion, qty: 2 });
  });
  await expect.poll(() => gm.evaluate(name => (hunterApp.api.sync.remoteSheets().find((r: any) => r.data && r.data.name === name)?.data.items ?? [])
    .some((i: any) => i.name === 'Health Potion'), HUNTER)).toBe(true);
  await fight(gm, player, [{ x: 10, y: 10 }]);
  await gm.evaluate(name => hunterApp.store.update((d: any) => { const r = d.fight.rows.find((x: any) => x.name === name); r.hp = r.hp - 25; }, 'test-setup'), HUNTER);
  const hp = (await fightRow(gm, HUNTER)).hp;
  const potions = () => player.evaluate(() => hunterApp.store.active().items.find((i: any) => i.name === 'Health Potion')?.qty ?? 0);
  const had = await potions();
  expect(had).toBeGreaterThan(0);
  await map(player).locator('[data-more]').tap();
  await map(player).locator('[data-drawer] .mp-hb', { hasText: 'Health Potion' }).tap();
  await expect(map(player).locator('[data-go]')).toBeEnabled();
  await map(player).locator('[data-go]').tap();
  await expect.poll(potions).toBe(had - 1);
  await expect.poll(() => fightRow(gm, HUNTER).then(r => r.hp)).toBeGreaterThan(hp);
  await expect(token(player, (await fightRow(gm, HUNTER)).id)).toHaveAttribute('aria-label', new RegExp(`HP ${(await fightRow(gm, HUNTER)).hp} of`));
});

test('a player with nothing to do taps End turn on the map and the rat\'s turn comes on both phones; the same pass sent again changes nothing', async ({ device }) => {
  const { gm, player } = await room(device);
  const { kai, rats } = await fight(gm, player, [{ x: 10, y: 10 }]);
  const sent: any[] = [];
  await player.exposeFunction('__passSent', (p: any) => { sent.push(p); });
  await player.evaluate(() => { const S = hunterApp.api.sync, post = S.post; S.post = (ev: any, o: any) => { if (ev.type === 'pass') (window as any).__passSent(ev.payload); return post(ev, o); }; });
  await expect(map(gm).locator('[data-pass]')).toHaveCount(0);
  await map(player).locator('[data-pass]').tap();
  for (const p of [gm, player]) await expect(token(p, rats[0]!)).toHaveClass(/\bnow\b/);
  await expect(combat(player).locator('.tb-mine')).toHaveCount(0);
  await expect(map(player).locator('[data-pass]')).toHaveCount(0);
  const after = await gm.evaluate(() => JSON.stringify(hunterApp.store.get().fight));
  expect(sent).toHaveLength(1);
  await player.evaluate(p => hunterApp.api.sync.post(hunterApp.api.sync.event('pass', { by: p.by, at: p.at })), sent[0]);
  await player.evaluate(n => hunterApp.api.dice.roll('1d20', { label: 'after the replay', who: n }), HUNTER);
  // a roll sent after it reaches the GM's Table feed after it, so by then the GM's phone has read the replay
  await expect.poll(() => gm.evaluate(() => Object.keys(sessionStorage).some(k => k.endsWith('-feed') && (sessionStorage.getItem(k) ?? '').includes('after the replay'))), { timeout: 15_000 }).toBe(true);
  expect(await gm.evaluate(() => JSON.stringify(hunterApp.store.get().fight))).toBe(after);
  await expect(token(gm, kai)).not.toHaveClass(/\bnow\b/);
});

test('a double tap frames the map and chooses no tile', async ({ device }) => {
  const { gm, player } = await room(device);
  await fight(gm, player, [{ x: 10, y: 10 }]);
  await expect(map(player).locator('[data-shade="stride"]').first()).toBeAttached();
  const p = await tileAt(player, 4, 2);
  await player.mouse.dblclick(p.x, p.y);
  await expect(map(player).locator('[data-confirm]')).toBeHidden();
  await expect(map(player).locator('[data-shade="path"], [data-path]')).toHaveCount(0);
  await tapTile(player, 4, 2);
  await expect(map(player).locator('[data-confirm] [data-words]')).toHaveText('2 tiles: a third of your turn');
});

/**
 * A tap on `el` whose lift happened 100 ms after its press (the events' own times, set by CDP) but reaches the page only
 * after `held` shows the page ran the hold timer first: what a busy phone does to a quick tap. The times are given, so
 * the tap is the same on a quiet box and a loaded one.
 */
async function lateLiftTap(page: Page, el: ReturnType<Page['locator']>, held: () => Promise<void>): Promise<void> {
  const b = (await el.boundingBox())!, at = { x: b.x + b.width / 2, y: b.y + b.height / 2 }, cdp = await page.context().newCDPSession(page);
  const t0 = Date.now() / 1000;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [at], timestamp: t0 });
  await held();
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [], timestamp: t0 + 0.1 });
}

test('on a page too busy to hear a quick tap on a hotbar slot before its hold time, the tap still picks it', async ({ device }) => {
  const { gm, player } = await room(device);
  await fight(gm, player, [{ x: 2, y: 3 }]);
  const slot = map(player).locator('[data-hot] .mp-hb').first();
  await lateLiftTap(player, slot, () => expect(map(player).locator('[data-mapdt]')).not.toBeEmpty());
  await expect(slot).toHaveAttribute('aria-pressed', 'true');
  await expect(map(player).locator('[data-mapdt]')).toBeEmpty();
});

test('on a page too busy to hear the GM\'s quick tap on a monster before the hold time, the tap still opens its card', async ({ device }) => {
  const { gm, player } = await room(device);
  const { rats } = await fight(gm, player, [{ x: 6, y: 6 }]);
  await lateLiftTap(gm, token(gm, rats[0]!), () => expect(token(gm, rats[0]!)).toHaveClass(/\blifted\b/));
  await expect(combat(gm).locator('[data-cardbox]')).toHaveClass(/\bsheet\b/);
});
