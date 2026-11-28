// Player combat hotbar ability info ('i') on a 390x844 phone: reading a ready move, a disabled cooldown move,
// and a More drawer item without firing the move or taking the turn, closing in one tap, and still firing moves normally.
import type { Page } from '@playwright/test';
import { RULES } from '../../src/core/rules.ts';
import { FIGHTER_SIGNATURE } from '../../src/core/registry/class-fighter.ts';
import { MAGE_SIGNATURE } from '../../src/core/registry/class-mage.ts';
import { BUILT_IN_ITEMS } from '../../src/core/registry/items.ts';
import { test, expect, PHONE, setupGoblinDenGM, onboardPlayer, createRoom, dismissAll, go, setupDoc } from './helpers.ts';

const HUNTER = 'Kai Info', MONSTER = 'Cave Rat';
const POWER_STRIKE = FIGHTER_SIGNATURE.actives![0]!;
const FIREBALL = MAGE_SIGNATURE.actives![0]!;
const [POTION_DEF_ID, POTION] = [...BUILT_IN_ITEMS.entries()].find(
  (e): e is [typeof e[0], Extract<typeof e[1], { type: 'consumable' }>] => e[1].type === 'consumable' && e[1].effects.length > 0,
)!;

const lowestDice = (page: Page) => page.evaluate(() => Object.defineProperty(crypto, 'getRandomValues', { configurable: true, value: (a: Uint32Array) => a.fill(0) }));
const combat = (page: Page) => page.locator('#view-combat');
const map = (page: Page) => combat(page).locator('[data-mapbox]');
const token = (page: Page, id: string) => map(page).locator(`[data-tok="${id}"]`);

async function tileAt(page: Page, x: number, y: number): Promise<{ x: number; y: number }> {
  await map(page).locator('[data-frame]').scrollIntoViewIfNeeded();
  return map(page).locator('[data-world]').evaluate((w, [tx, ty]) => {
    const r = w.getBoundingClientRect(), s = r.width / (w as HTMLElement).offsetWidth;
    return { x: r.left + (tx! + 0.5) * 40 * s, y: r.top + (ty! + 0.5) * 40 * s };
  }, [x, y]);
}
async function tapTile(page: Page, x: number, y: number): Promise<void> {
  const p = await tileAt(page, x, y);
  await page.touchscreen.tap(p.x, p.y);
}
const placeOf = (page: Page, id: string) => token(page, id).evaluate(el => [Number((el as HTMLElement).dataset['x']), Number((el as HTMLElement).dataset['y'])]);

const rowSnapshot = (gm: Page, kaiId: string) => gm.evaluate(id => {
  const f = hunterApp.store.get().fight;
  const r = f.rows.find((x: any) => x.id === id);
  return {
    now: f.now,
    currentId: f.currentId,
    logLen: f.log.length,
    fatigue: r.fatigue,
    mana: r.mana,
    used: r.used,
    channel: r.channel,
  };
}, kaiId);

test('on a 390x844 phone a player can read ready, disabled, and drawer abilities via the info button without firing them, then still use an ability', async ({ device }) => {
  const gm = (await device('gm', { viewport: PHONE })).page;
  const player = (await device('player', { viewport: PHONE })).page;
  await setupGoblinDenGM(gm);
  const code = await createRoom(gm);
  await onboardPlayer(player, HUNTER, code);
  await expect.poll(() => player.evaluate(() => hunterApp.api.sync.room())).toBe(code);
  await dismissAll(player, 4);

  // Give the player two real class actives (Power Strike and Fireball) plus a consumable item so the hotbar has
  // ready and cooldown slots and the More drawer has a consumable item.
  await player.evaluate(([ps, fb, potId]) => {
    const s = hunterApp.store;
    s.update(() => {
      const h = s.active();
      h.skills.push(
        { id: s.id('s'), name: ps.name, type: 'active', level: 1, label: null, desc: ps.desc ?? '', ability: ps },
        { id: s.id('s'), name: fb.name, type: 'active', level: 1, label: null, desc: fb.desc ?? '', ability: fb },
      );
      h.items.push({ kind: 'ref', id: s.id('i'), defId: potId, qty: 1 });
    }, 'test-setup');
  }, [POWER_STRIKE, FIREBALL, POTION_DEF_ID] as const);

  await go(gm, 'gm');
  await expect(gm.locator('#gm-board .gm-card.remote', { hasText: HUNTER })).toHaveCount(1);
  await expect.poll(() => gm.evaluate(name => (hunterApp.api.sync.remoteSheets() as any[]).some(r => r.data.skills.some((k: any) => k.name === name)), POWER_STRIKE.name)).toBe(true);

  await go(gm, 'combat');
  await combat(gm).locator('[data-hsel]').selectOption({ label: `${HUNTER} (player phone)` });
  await combat(gm).locator('[data-addh]').tap();
  await combat(gm).locator('[data-qline]').fill(`${MONSTER} x1, E, brute`);
  await combat(gm).locator('[data-qadd]').tap();
  await combat(gm).locator('[data-start]').tap();
  await expect(map(gm).locator('.mp-tok.now')).toHaveCount(1);

  const ids = await gm.evaluate(([name, fbId, cdTicks]) => {
    let out = { kai: '', rat: '' };
    hunterApp.store.update((d: any) => {
      const f = d.fight;
      const kai = f.rows.find((r: any) => r.name === name);
      const rat = f.rows.find((r: any) => r.kind === 'monster');
      kai.place = { x: 2, y: 2 }; kai.at = f.now; kai.tie = 0;
      kai.readyAt = { ...(kai.readyAt || {}), [fbId]: f.now + cdTicks };
      rat.place = { x: 3, y: 2 }; rat.at = f.now + 1; rat.tie = 0;
      f.currentId = kai.id; f.log = [];
      out = { kai: kai.id, rat: rat.id };
    }, 'test-setup');
    return out;
  }, [HUNTER, FIREBALL.id, 2 * RULES.fight.round] as const);

  await setupDoc(player, HUNTER, { x: 2, y: 2 });
  await combat(gm).locator('[data-fview="map"]').tap();
  await go(player, 'combat');
  await expect(combat(player).locator('.tb-mine')).toContainText('YOUR TURN');
  await combat(player).locator('[data-fview="map"]').tap();
  for (const p of [gm, player]) await expect(token(p, ids.kai)).toBeVisible();
  for (const p of [gm, player]) await expect.poll(() => placeOf(p, ids.kai)).toEqual([2, 2]);
  for (const p of [gm, player]) await map(p).locator('[data-frame]').dblclick({ position: { x: 4, y: 4 } });

  const hot = map(player).locator('[data-hot]');
  const psInfo = hot.locator(`[data-ab-info="${POWER_STRIKE.id}"]`);
  const fbUse = hot.locator(`[data-ab="${FIREBALL.id}"]`);
  const fbInfo = hot.locator(`[data-ab-info="${FIREBALL.id}"]`);
  const panel = map(player).locator('[data-mapdt] .dt');

  await expect(psInfo).toBeVisible();
  await expect(fbUse).toBeDisabled();
  await expect(fbInfo).toBeEnabled();

  // Sibling markup (not nested inside use button) and thumb-sized >= 44px hit target at 390x844.
  const nestedCount = await hot.locator('[data-ab] [data-ab-info], [data-arm] [data-ab-info]').count();
  expect(nestedCount).toBe(0);
  const psBox = (await psInfo.boundingBox())!;
  expect(Math.min(psBox.width, psBox.height)).toBeGreaterThanOrEqual(44);

  const before = await rowSnapshot(gm, ids.kai);

  // 1. Tap 'i' on Power Strike: opens panel with ability name and non-empty plain description, does not fire.
  await player.evaluate(() => scrollTo(0, 0));
  await psInfo.tap();
  await expect(panel).toBeVisible();
  await expect(panel.locator('b')).toHaveText(POWER_STRIKE.name);
  await expect(panel.locator('p')).toHaveText(POWER_STRIKE.desc!);
  await expect(psInfo).toHaveAttribute('aria-expanded', 'true');
  await expect(map(player).locator('[data-confirm]')).toBeHidden();

  // Both the full open detail panel and the hotbar stay visible above the bottom nav bar without scrolling.
  const navBox = (await player.locator('.nav-bottom').boundingBox())!;
  const dtBox = (await panel.boundingBox())!;
  const hotBox = (await hot.boundingBox())!;
  expect(dtBox.y + dtBox.height).toBeLessThanOrEqual(hotBox.y + 2);
  expect(hotBox.y + hotBox.height).toBeLessThanOrEqual(navBox.y);

  await player.screenshot({
    path: process.env.ABILITY_INFO_SHOT || '.lead-scratch/ability-info-player.png',
    fullPage: false,
  });

  // 2. Close in one tap via the Close button.
  await panel.locator('[data-dt-close]').tap();
  await expect(panel).toHaveCount(0);
  await expect(psInfo).toHaveAttribute('aria-expanded', 'false');

  // 3. Re-open and close in one tap by tapping the same 'i' button again.
  await psInfo.tap();
  await expect(panel).toBeVisible();
  await psInfo.tap();
  await expect(panel).toHaveCount(0);

  // 4. Tap 'i' on the disabled cooldown slot (Fireball): opens detail with description and live cooldown.
  await fbInfo.tap();
  await expect(panel).toBeVisible();
  await expect(panel.locator('b')).toHaveText(FIREBALL.name);
  await expect(panel.locator('p')).toHaveText(FIREBALL.desc!);
  await expect(panel).toContainText('Ready in 2 rounds.');
  await panel.locator('[data-dt-close]').tap();
  await expect(panel).toHaveCount(0);

  // 5. Open More drawer and tap 'i' on the consumable item row.
  await hot.locator('[data-more]').tap();
  const drawer = map(player).locator('[data-drawer]');
  await expect(drawer).toBeVisible();
  const potInfo = drawer.locator(`[aria-label="About ${POTION.name}"]`);
  await expect(potInfo).toBeVisible();
  await potInfo.tap();
  await expect(panel).toBeVisible();
  await expect(panel.locator('b')).toHaveText(POTION.name);
  await expect(panel.locator('p')).toHaveText(POTION.desc);
  await panel.locator('[data-dt-close]').tap();
  await expect(panel).toHaveCount(0);
  await hot.locator('[data-more]').tap();

  // Verify no act went out during any info tap: row state and log are untouched.
  expect(await rowSnapshot(gm, ids.kai)).toEqual(before);

  // 6. A later tap on the use button still uses the ability normally.
  await lowestDice(gm);
  await hot.locator('[data-ab="attack"]').tap();
  await expect(map(player).locator('[data-confirm]')).toBeVisible();
  await tapTile(player, 3, 2);
  await map(player).locator('[data-go]').tap();
  await expect.poll(() => gm.evaluate(() => hunterApp.store.get().fight.log.length)).toBeGreaterThan(0);
});
