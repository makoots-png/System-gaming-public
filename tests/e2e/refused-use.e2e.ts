// Bug 1 E2E proof (390x844 phone): a Hemomancer with too little HP/blood taps a blood ability, sees the plain reason,
// keeps YOUR TURN with every button still usable, sends nothing that ends the turn, and then takes a real action that turn.
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { Page } from '@playwright/test';
import { test, expect, PHONE, setupGoblinDenGM, onboardPlayer, createRoom, dismissAll, go, setupDoc } from './helpers.ts';

const HUNTER = 'Vlad Blood';
const MONSTER = 'Cave Rat';
const SCREENSHOT_PATH = '/workspace/sg-tools/design/move-turn/refused-use.png';

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

test('Hemomancer with too little blood taps Sanguine Pool, sees plain reason, keeps YOUR TURN, and still acts that turn', async ({ device }) => {
  const gm = (await device('gm', { viewport: PHONE })).page;
  const player = (await device('player', { viewport: PHONE })).page;

  await setupGoblinDenGM(gm);
  const code = await createRoom(gm);
  await onboardPlayer(player, HUNTER, code);
  await expect.poll(() => player.evaluate(() => hunterApp.api.sync.room())).toBe(code);
  await dismissAll(player, 4);

  // Set player hunter HP max cleanly (~100+) and grant Hemomancer via room holders doc
  const playerKey = await player.evaluate(() => {
    const s = hunterApp.store;
    s.update(() => {
      const h = s.active();
      h.level = 10;
      h.stats = { ...h.stats, vit: 20, pow: 20 };
      h.life = { at: 'up', hp: 100 };
    }, 'test-setup');
    return hunterApp.api.sync.myKey(s.active().id);
  });

  await gm.evaluate(who => {
    hunterApp.store.update((d: any) => {
      d.classHolders = {
        registryId: d.classHolders?.registryId || 'reg-refuse-e2e',
        held: { Hemomancer: { kind: 'remote', sheetKey: who, grantId: 'cg-refuse-1', at: '2026-11-28T00:00:00.000Z' } },
      };
    }, 'test-setup');
  }, playerKey);

  await go(gm, 'gm');
  await expect(gm.locator('#gm-board .gm-card.remote', { hasText: HUNTER })).toHaveCount(1);
  await expect.poll(() => player.evaluate(() => hunterApp.store.active().job)).toBe('Hemomancer');
  await expect.poll(() => gm.evaluate(n => {
    const r = (hunterApp.api.sync.remoteSheets() as any[]).find(x => x.data.name === n);
    return r?.data?.job ?? null;
  }, HUNTER)).toBe('Hemomancer');

  // Start fight on GM with Hemomancer at (2, 2) with only 12 HP (too little blood for Sanguine Pool's 20% HP cost) and Cave Rat at (3, 2)
  await go(gm, 'combat');
  await combat(gm).locator('[data-hsel]').selectOption({ label: `${HUNTER} (player phone)` });
  await combat(gm).locator('[data-addh]').tap();
  await combat(gm).locator('[data-qline]').fill(`${MONSTER} x1, E, brute`);
  await combat(gm).locator('[data-qadd]').tap();
  await combat(gm).locator('[data-start]').tap();
  await expect(map(gm).locator('.mp-tok.now')).toHaveCount(1);

  const ids = await gm.evaluate(name => {
    let out = { hero: '', rat: '', hpMax: 0, now: 0 };
    hunterApp.store.update((d: any) => {
      const f = d.fight;
      const hero = f.rows.find((r: any) => r.name === name);
      const rat = f.rows.find((r: any) => r.kind === 'monster');
      hero.place = { x: 2, y: 2 };
      hero.life = { at: 'up', hp: 12 };
      hero.at = f.now;
      hero.tie = 0;
      rat.place = { x: 3, y: 2 };
      rat.at = f.now + 1;
      rat.tie = 0;
      f.currentId = hero.id;
      f.log = [];
      out = { hero: hero.id, rat: rat.id, hpMax: hero.sheet.hpMax, now: f.now };
    }, 'test-setup');
    return out;
  }, HUNTER);

  await setupDoc(player, HUNTER, { x: 2, y: 2 });
  await go(player, 'combat');
  await expect(combat(player).locator('.tb-mine')).toContainText('YOUR TURN');
  await combat(player).locator('[data-fview="map"]').tap();
  await expect(token(player, ids.hero)).toBeVisible();
  await expect(token(player, ids.rat)).toBeVisible();
  await map(player).locator('[data-frame]').dblclick({ position: { x: 4, y: 4 } });

  // Wait for player's synced fight doc to reflect the 12 HP setup
  await expect.poll(() => player.evaluate(hid => {
    const doc = hunterApp.api.sync.doc('fight') as any;
    return doc?.rows?.find((r: any) => r.id === hid)?.hp ?? null;
  }, ids.hero)).toBe(12);

  // Spy on sync.post on the player phone to ensure nothing that ends the turn is sent on refusal
  await player.evaluate(() => {
    const sync = hunterApp.api.sync as any;
    const orig = sync.post.bind(sync);
    (window as any).__sentEvents = [] as { type?: string }[];
    sync.post = (ev: any) => {
      (window as any).__sentEvents.push(ev);
      return orig(ev);
    };
  });

  // Locate Sanguine Pool on hotbar (or inside More drawer if overflowed)
  const poolBtn = map(player).locator('.mp-hb', { hasText: 'Sanguine Pool' });
  if (await poolBtn.count() === 0) {
    await map(player).locator('[data-more]').tap();
  }
  await expect(poolBtn).toHaveCount(1);
  await expect(poolBtn).toHaveAttribute('data-unaffordable', 'true');
  await expect(poolBtn).toBeEnabled();

  // Tap Sanguine Pool: should show exact plain refusal reason without sending anything or ending the turn
  await poolBtn.tap();
  const news = map(player).locator('[data-news]');
  await expect(news).toBeVisible();
  await expect(news).toContainText('Not enough HP.');
  await expect(news).toContainText('you have 12.');

  // Capture phone screenshot showing the refusal reason while YOUR TURN and buttons stay usable
  await player.evaluate(() => scrollTo(0, 0));
  await mkdir(dirname(SCREENSHOT_PATH), { recursive: true });
  await player.screenshot({ path: SCREENSHOT_PATH });

  // Assert YOUR TURN is still shown, every hotbar button is usable, nothing turn-ending was sent, and GM turn is unchanged
  await expect(combat(player).locator('.tb-mine')).toContainText('YOUR TURN');
  await expect(map(player).locator('[data-pass]')).toBeEnabled();
  const transBtn = map(player).locator('.mp-hb', { hasText: 'Transfusion' });
  await expect(transBtn).toBeEnabled();
  const sentBeforeAction = await player.evaluate(() => (window as any).__sentEvents as { type: string }[]);
  expect(sentBeforeAction.filter(e => e.type === 'cast' || e.type === 'pass' || e.type === 'step')).toHaveLength(0);
  const gmAfterRefusal = await gm.evaluate(() => ({ now: hunterApp.store.get().fight.now, cur: hunterApp.store.get().fight.currentId }));
  expect(gmAfterRefusal).toEqual({ now: ids.now, cur: ids.hero });

  // Now take a real action (Transfusion, 0 HP cost) on that SAME turn and verify it lands
  await transBtn.tap();
  await tapTile(player, 3, 2);
  await map(player).locator('[data-go]').tap();

  await expect.poll(() => gm.evaluate(() => hunterApp.store.get().fight.currentId), { timeout: 15_000 }).not.toBe(ids.hero);
  const sentAfterAction = await player.evaluate(() => (window as any).__sentEvents as { type: string }[]);
  expect(sentAfterAction.some(e => e.type === 'cast')).toBe(true);
});
