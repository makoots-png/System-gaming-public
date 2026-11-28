// Bug 2 E2E proof (390x844 phone): a Fighter uses Iron Cleave, the slot shows a whole-number cooldown, and it counts
// down by 1 each round until it is ready again.
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { Page } from '@playwright/test';
import { test, expect, PHONE, setupGoblinDenGM, onboardPlayer, createRoom, dismissAll, go, setupDoc } from './helpers.ts';

const HUNTER = 'Ira Steel';
const MONSTER = 'Cave Rat';
const ABILITY = 'Iron Cleave';
const SCREENSHOT_PATH = '/workspace/sg-refused-use/.lead-scratch/cooldown.png';

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

async function abilitySlot(page: Page) {
  const btn = map(page).locator('.mp-hb', { hasText: ABILITY });
  if (await btn.count() === 0) {
    const more = map(page).locator('[data-more]');
    if (await more.count()) await more.tap();
  }
  return btn;
}

test('a Fighter uses Iron Cleave, sees a whole-number cooldown, and it counts down by 1 each round', async ({ device }) => {
  const gm = (await device('gm', { viewport: PHONE })).page;
  const player = (await device('player', { viewport: PHONE })).page;

  await setupGoblinDenGM(gm);
  const code = await createRoom(gm);
  await onboardPlayer(player, HUNTER, code);
  await expect.poll(() => player.evaluate(() => hunterApp.api.sync.room())).toBe(code);
  await dismissAll(player, 4);

  await player.evaluate(() => {
    const s = hunterApp.store;
    s.update(() => {
      const h = s.active();
      const at = new Date().toISOString();
      h.level = 10;
      h.job = 'Fighter';
      h.jobDone = 'Fighter';
      h.classes = { ...h.classes, Fighter: { unlockedAt: at, nodes: [] } };
      h.stats = { ...h.stats, vit: 20, str: 20, pow: 10 };
      h.life = { at: 'up', hp: 100 };
    }, 'test-setup');
  });

  await go(gm, 'gm');
  await expect(gm.locator('#gm-board .gm-card.remote', { hasText: HUNTER })).toHaveCount(1);
  await expect.poll(() => player.evaluate(() => hunterApp.store.active().job)).toBe('Fighter');
  await expect.poll(() => gm.evaluate(n => {
    const r = (hunterApp.api.sync.remoteSheets() as any[]).find(x => x.data.name === n);
    return r?.data?.job ?? null;
  }, HUNTER)).toBe('Fighter');

  await gm.evaluate(() => hunterApp.store.device('npcAuto').write(false));

  await go(gm, 'combat');
  await combat(gm).locator('[data-hsel]').selectOption({ label: `${HUNTER} (player phone)` });
  await combat(gm).locator('[data-addh]').tap();
  await combat(gm).locator('[data-qline]').fill(`${MONSTER} x1, E, brute`);
  await combat(gm).locator('[data-qadd]').tap();
  await combat(gm).locator('[data-start]').tap();
  await expect(map(gm).locator('.mp-tok.now')).toHaveCount(1);

  const ids = await gm.evaluate(name => {
    let out = { hero: '', rat: '', now: 0 };
    hunterApp.store.update((d: any) => {
      const f = d.fight;
      const hero = f.rows.find((r: any) => r.name === name);
      const rat = f.rows.find((r: any) => r.kind === 'monster');
      hero.place = { x: 2, y: 2 };
      hero.at = f.now;
      hero.tie = 0;
      rat.place = { x: 3, y: 2 };
      rat.at = f.now + 1;
      rat.tie = 0;
      rat.life = { at: 'up', hp: 100000 };
      if (rat.sheet) rat.sheet.hpMax = 100000;
      f.currentId = hero.id;
      f.log = [];
      out = { hero: hero.id, rat: rat.id, now: f.now };
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

  const slot = await abilitySlot(player);
  await expect(slot).toHaveCount(1);
  await expect(slot).toBeEnabled();
  await slot.tap();
  await tapTile(player, 3, 2);
  await expect(map(player).locator('[data-words]')).toHaveText(`Hits ${MONSTER}.`);
  await map(player).locator('[data-go]').tap();

  await expect.poll(() => gm.evaluate(() => hunterApp.store.get().fight?.currentId ?? null), { timeout: 15_000 }).not.toBe(ids.hero);

  // After the use the player's turn has already ended, so their hotbar shows cost again. The fight doc still holds a
  // whole-round leftover, which the player's slot will show on their next turn.
  const leftoverOf = (page: Page, heroId: string) => page.evaluate(({ id, name }) => {
    const f = (hunterApp as any).store.get().fight;
    const h = f.rows.find((r: any) => r.id === id);
    const a = h?.abilities?.find((x: any) => x.name === name);
    if (!a) return null;
    const at = h.readyAt?.[a.id];
    if (!at || at <= f.now) return 0;
    return Math.ceil((at - f.now) / 1000);
  }, { id: heroId, name: ABILITY });
  await expect.poll(() => leftoverOf(gm, ids.hero), { timeout: 15_000 }).toBeGreaterThan(0);
  const startLeft = await leftoverOf(gm, ids.hero);
  expect(Number.isInteger(startLeft)).toBe(true);
  expect(startLeft).toBeGreaterThanOrEqual(1);

  // The GM's Next button ends the rat's turn with no attack, so the clock moves about one round.
  await go(gm, 'combat');
  const nextBtn = combat(gm).locator('[data-next]');
  await expect(nextBtn).toBeVisible({ timeout: 10_000 });
  await nextBtn.tap();

  const playerCurrent = () => player.evaluate(() => (hunterApp.api.sync.doc('fight') as any)?.currentId ?? null);
  await expect.poll(playerCurrent, { timeout: 15_000 }).toBe(ids.hero);
  await expect(combat(player).locator('.tb-mine')).toContainText('YOUR TURN');
  const slotAgain = await abilitySlot(player);
  const waitText = async () => {
    const el = slotAgain.locator('small').first();
    return (await el.count()) ? (await el.innerText()).trim() : '';
  };
  await expect.poll(waitText, { timeout: 15_000 }).toMatch(/^\d+ rounds?$/);
  expect((await waitText()).includes('.')).toBe(false);
  const midWait = await waitText();
  expect(midWait).toBe('1 round');
  await expect(slotAgain).toBeDisabled();

  await player.evaluate(() => scrollTo(0, 0));
  await mkdir(dirname(SCREENSHOT_PATH), { recursive: true });
  await player.screenshot({ path: SCREENSHOT_PATH });

  await map(player).locator('[data-pass]').tap();
  await expect.poll(() => gm.evaluate(() => hunterApp.store.get().fight?.currentId ?? null), { timeout: 15_000 }).not.toBe(ids.hero);
  await expect(nextBtn).toBeVisible({ timeout: 10_000 });
  await nextBtn.tap();
  await expect.poll(playerCurrent, { timeout: 15_000 }).toBe(ids.hero);

  const ready = await abilitySlot(player);
  await expect(ready.locator('small').first()).not.toContainText('round');
  await expect(ready).toBeEnabled();
});
