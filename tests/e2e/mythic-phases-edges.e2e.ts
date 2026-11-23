// Adversarial browser probes and 390x844 UI screenshots for mythic-phases-on (bb36a784..HEAD).
import { mkdir } from 'node:fs/promises';
import type { Page } from '@playwright/test';
import { MYTHICS } from '../../src/core/registry/mythics.ts';
import { test, expect, onboardGM, onboardPlayer, createRoom, dismissAll, go, chooseList, setupDoc, fightRow, PHONE, type DeviceOptions } from './helpers.ts';

const HUNTER = 'Kai Test';
const ANGEL = 'angel-of-the-last-trumpet' as const;
const script = MYTHICS[ANGEL];
const combat = (page: Page) => page.locator('#view-combat');
const SHOT_DIR = process.env.PHASES_SHOTS ?? '';

async function saveShot(page: Page, name: string, fullPage = false) {
  if (!SHOT_DIR) return;
  await mkdir(SHOT_DIR, { recursive: true });
  await page.screenshot({ path: `${SHOT_DIR}/${name}.png`, fullPage });
}

async function angelFight(
  device: (label: string, o?: DeviceOptions) => Promise<{ page: Page }>,
  standing: Record<string, unknown> | null,
  at = { x: 6, y: 2 },
  kaiAt = { x: 2, y: 2 },
): Promise<{ gm: Page; player: Page }> {
  const gm = (await device('gm', { viewport: PHONE })).page;
  const player = (await device('player', { viewport: PHONE })).page;
  await onboardGM(gm);
  await chooseList(gm);
  const code = await createRoom(gm);
  await onboardPlayer(player, HUNTER, code);
  await chooseList(player);
  await expect.poll(() => player.evaluate(() => hunterApp.api.sync.room())).toBe(code);
  await dismissAll(player, 4);
  await go(gm, 'gm');
  await expect(gm.locator('#gm-board .gm-card.remote', { hasText: HUNTER })).toHaveCount(1);
  await go(gm, 'combat');
  await combat(gm).locator('[data-hsel]').selectOption({ label: `${HUNTER} (remote)` });
  await combat(gm).locator('[data-addh]').tap();
  const label = await combat(gm).locator('[data-msel] option', { hasText: script.name }).first().textContent();
  await combat(gm).locator('[data-msel]').selectOption({ label: label ?? '' });
  await combat(gm).locator('[data-addm]').tap();
  await combat(gm).locator('[data-start]').tap();
  await expect(combat(gm).locator('.cmb-row.cur')).toHaveCount(1);
  await gm.evaluate(([name, boss, at2, kaiPos, omen]) => hunterApp.store.update((d: any) => {
    const f = d.fight, kai = f.rows.find((r: any) => r.name === name), angel = f.rows.find((r: any) => r.name === boss);
    kai.place = kaiPos; angel.place = at2;
    kai.at = f.now + 1; kai.tie = 0; angel.at = f.now; angel.tie = 0;
    f.currentId = angel.id; f.log = [];
    if (omen) angel.mythic = { ...angel.mythic, ...omen, aim: omen.aim === 'kai' ? kai.id : omen.aim === 'boss' ? angel.id : omen.aim };
  }, 'test-setup'), [HUNTER, script.name, at, kaiAt, standing] as const);
  await setupDoc(player, HUNTER, kaiAt);
  await go(player, 'combat');
  return { gm, player };
}

const omen = (key: string, aim: unknown, at: 'omen' | 'faltering' = 'omen') => ({ at, omen: key, aim, hpAt: 1, barAt: null, beat: 1 });

test('screenshots at 390x844: bestiary entry, omen banner, Stars Fall, mythic strip, and GM switch', async ({ device }) => {
  // 1. Bestiary entry with phases on + GM switch in Fight tools
  const gmOnly = (await device('gm-shots', { viewport: PHONE })).page;
  await onboardGM(gmOnly);
  await chooseList(gmOnly);
  await go(gmOnly, 'bestiary');
  const card = gmOnly.locator('#view-bestiary .bst-card', { hasText: script.name });
  await card.evaluate((el: HTMLElement) => el.scrollIntoView({ block: 'start' }));
  await gmOnly.evaluate(() => window.scrollBy(0, -70));
  await expect(card).toContainText(`The fight: ${script.shape}`);
  await saveShot(gmOnly, 'bestiary-angel');
  // Also check Zaratan's entry (longer lines / Harbour)
  const zaratan = gmOnly.locator('#view-bestiary .bst-card', { hasText: 'Zaratan' });
  await zaratan.evaluate((el: HTMLElement) => el.scrollIntoView({ block: 'start' }));
  await gmOnly.evaluate(() => window.scrollBy(0, -70));
  await saveShot(gmOnly, 'bestiary-zaratan');

  // Check GM switch at 390px
  await go(gmOnly, 'combat');
  const sw = combat(gmOnly).locator('[data-mythsw]');
  await sw.scrollIntoViewIfNeeded();
  await expect(combat(gmOnly).locator('[data-mythsw-btn]')).toHaveText('On');
  await saveShot(gmOnly, 'gm-switch-on');

  // Measure horizontal overflow on bestiary and combat
  const overflowCombat = await gmOnly.evaluate(() => ({
    scrollWidth: document.scrollingElement!.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  expect(overflowCombat.scrollWidth).toBeLessThanOrEqual(overflowCombat.innerWidth);

  // 2. Omen banner (Weighed and Found Wanting) + mythic strip on GM and Player
  const { gm, player } = await angelFight(device, omen('weighed', 'kai'));
  await expect(combat(gm).locator('.myth-title')).toHaveText('OMEN: Weighed and Found Wanting');
  await expect(combat(player).locator('.myth-title')).toHaveText('OMEN: Weighed and Found Wanting');
  await gm.evaluate(() => document.querySelectorAll('#toasts .toast').forEach(t => t.remove()));
  await saveShot(gm, 'omen-banner-gm');
  await saveShot(player, 'omen-banner-player');

  // 3. Stars Fall omen on GM and Player
  await gm.evaluate(([boss]) => hunterApp.store.update((d: any) => {
    const angel = d.fight.rows.find((r: any) => r.name === boss);
    angel.mythic = { ...angel.mythic, at: 'omen', omen: 'stars', aim: { x: 3, y: 2 }, hpAt: 1, barAt: null, beat: 1 };
  }, 'test-stars'), [script.name] as const);
  await expect(combat(gm).locator('.myth-title')).toHaveText('OMEN: Stars Fall');
  await expect(combat(player).locator('.myth-title')).toHaveText('OMEN: Stars Fall');
  await expect(combat(player).locator('.myth-you')).toHaveText('You are in the marked tiles.');
  await gm.evaluate(() => document.querySelectorAll('#toasts .toast').forEach(t => t.remove()));
  await saveShot(gm, 'stars-fall-gm');
  await saveShot(player, 'stars-fall-player');

  // 4. Mythic strip calm (after dropping omen) on GM and Player
  await combat(gm).locator('[data-mydrop]').tap();
  await expect(combat(gm).locator('.myth-omen')).toHaveCount(0);
  await expect(combat(player).locator('.myth-omen')).toHaveCount(0);
  await expect(combat(gm).locator('.myth-phase')).toContainText('Phase 1 of 3');
  await expect(combat(player).locator('.myth-phase')).toContainText('Phase 1 of 3');
  await gm.evaluate(() => document.querySelectorAll('#toasts .toast').forEach(t => t.remove()));
  await saveShot(gm, 'mythic-strip-gm');
  await saveShot(player, 'mythic-strip-player');

  // Check no horizontal overflow on either phone
  for (const [label, p] of [['gm', gm], ['player', player]] as const) {
    const m = await p.evaluate(() => ({ sw: document.scrollingElement!.scrollWidth, iw: window.innerWidth }));
    expect(m.sw, `${label} horizontal overflow`).toBeLessThanOrEqual(m.iw);
  }
});

test('probe: player who viewed Rules before joining a room with phases off keeps seeing "How a mythic fights"', async ({ device }) => {
  const gm = (await device('gm', { viewport: PHONE })).page;
  const player = (await device('player', { viewport: PHONE })).page;
  await onboardGM(gm);
  await chooseList(gm);
  const code = await createRoom(gm);
  // GM turns mythic phases off
  await go(gm, 'combat');
  const sw = combat(gm).locator('[data-mythsw-btn]');
  await expect(sw).toHaveAttribute('aria-pressed', 'true');
  await expect(sw).toHaveText('On');
  await sw.tap();
  await expect(sw).toHaveAttribute('aria-pressed', 'false');
  await expect(sw).toHaveText('Off');

  // Player onboards alone first, opens Rules (sees "How a mythic fights" since default is on)
  await onboardPlayer(player, HUNTER);
  await dismissAll(player, 4);
  await go(player, 'rules');
  await expect(player.locator('#rr-mythic')).toHaveCount(1);

  // Player joins GM's room whose switch is OFF
  await go(player, 'room');
  await player.locator('#view-room [data-code]').fill(code);
  await expect(player.locator('#view-room [data-join]')).toBeEnabled();
  await player.locator('#view-room [data-join]').tap();
  await expect.poll(() => player.evaluate(() => hunterApp.api.sync.room())).toBe(code);
  await expect.poll(() => player.evaluate(() => hunterApp.rules().fight.mythic.scripts)).toBe(false);

  // Player returns to Rules: intent says player's phone follows the room's switch, so #rr-mythic should be gone
  await go(player, 'rules');
  await expect(player.locator('#rr-mythic')).toHaveCount(0);
});

test('probe: at 390px, mythic bestiary XP wraps mid-number ("40,00" / "0")', async ({ device }) => {
  const gm = (await device('gm-layout-xp', { viewport: PHONE })).page;
  await onboardGM(gm);
  await chooseList(gm);
  await go(gm, 'bestiary');
  const card = gm.locator('#view-bestiary .bst-card', { hasText: script.name });
  const xpLines = await card.locator('.bst-vit div').last().locator('b').evaluate((el: HTMLElement) => {
    const r = document.createRange();
    r.selectNodeContents(el);
    return { text: el.textContent, rects: r.getClientRects().length };
  });
  expect(xpLines, 'XP "40,000" should stay on one line, not break mid-number').toEqual({ text: '40,000', rects: 1 });
});

test('probe: at 390px, GM switch label touches button with 0px gap and has no pressed styling', async ({ device }) => {
  const gm = (await device('gm-layout-sw', { viewport: PHONE })).page;
  await onboardGM(gm);
  await chooseList(gm);
  await go(gm, 'combat');
  const swMetrics = await combat(gm).locator('[data-mythsw]').evaluate((el: HTMLElement) => {
    const lbl = el.querySelector('.lbl')!.getBoundingClientRect();
    const btn = el.querySelector('[data-mythsw-btn]')!.getBoundingClientRect();
    return { gapPx: Math.round((btn.left - lbl.right) * 10) / 10, hintFontSize: getComputedStyle(el.querySelector('.cmb-hint')!).fontSize };
  });
  expect(swMetrics.gapPx, 'GM switch label and button should have visible spacing').toBeGreaterThanOrEqual(6);
});

test('probe: player in room viewing Rules does not update when GM flips mythic switch off', async ({ device }) => {
  const gm = (await device('gm', { viewport: PHONE })).page;
  const player = (await device('player', { viewport: PHONE })).page;
  await onboardGM(gm);
  await chooseList(gm);
  const code = await createRoom(gm);
  await onboardPlayer(player, HUNTER, code);
  await expect.poll(() => player.evaluate(() => hunterApp.api.sync.room())).toBe(code);
  await dismissAll(player, 4);

  // Player opens Rules while GM has phases ON
  await go(player, 'rules');
  await expect(player.locator('#rr-mythic')).toHaveCount(1);

  // GM turns mythic phases OFF
  await go(gm, 'combat');
  await combat(gm).locator('[data-mythsw-btn]').tap();
  await expect(combat(gm).locator('[data-mythsw-btn]')).toHaveAttribute('aria-pressed', 'false');

  // Player's live rules follow the room's switch
  await expect.poll(() => player.evaluate(() => hunterApp.rules().fight.mythic.scripts)).toBe(false);

  // Player's Rules page should drop "How a mythic fights"
  await go(player, 'status');
  await go(player, 'rules');
  await expect(player.locator('#rr-mythic')).toHaveCount(0);
});

test('probe: GM does not see Next phase during setup, and sees it once started', async ({ device }) => {
  const gm = (await device('gm', { viewport: PHONE })).page;
  await onboardGM(gm);
  await chooseList(gm);
  await go(gm, 'combat');
  await combat(gm).locator('[data-addh]').tap();
  const label = await combat(gm).locator('[data-msel] option', { hasText: script.name }).first().textContent();
  await combat(gm).locator('[data-msel]').selectOption({ label: label ?? '' });
  await combat(gm).locator('[data-addm]').tap();
  await expect(combat(gm).locator('.myth-phase')).toContainText('Phase 1 of 3');
  const nextBtn = combat(gm).locator('[data-mynext]');
  await expect(nextBtn).toHaveCount(0);
  await combat(gm).locator('[data-start]').tap();
  await expect(nextBtn).toBeVisible();
  await nextBtn.tap();
  const ask = gm.locator('.sys-overlay.show');
  await expect(ask).toContainText(`Move ${script.name} to ${script.phases[1]!.name} now?`);
  await ask.locator('.sys-actions button', { hasText: 'Move it' }).tap();
  await expect(combat(gm).locator('.myth-phase')).toContainText('Phase 2 of 3');
});

test('probe: GM flipping mythic switch off during setup (not yet running) still starts fight with phases on', async ({ device }) => {
  const gm = (await device('gm', { viewport: PHONE })).page;
  await onboardGM(gm);
  await chooseList(gm);
  await go(gm, 'combat');
  await combat(gm).locator('[data-addh]').tap();
  const label = await combat(gm).locator('[data-msel] option', { hasText: script.name }).first().textContent();
  await combat(gm).locator('[data-msel]').selectOption({ label: label ?? '' });
  await combat(gm).locator('[data-addm]').tap();
  // Fight is still in setup ("Ready to fight"), NOT running; GM flips switch off
  await combat(gm).locator('[data-mythsw-btn]').tap();
  await expect(combat(gm).locator('[data-mythsw-btn]')).toHaveAttribute('aria-pressed', 'false');
  await combat(gm).locator('[data-start]').tap();
  await expect(combat(gm).locator('.cmb-row.cur')).toHaveCount(1);
  // Hint says "A fight already running keeps the way it began." This fight had NOT begun yet!
  expect((await fightRow(gm, script.name)).mythic).toBeNull();
});

test('probe: player standing 1 tile from Angel during The First Breath gets no "You are in the marked tiles." warning', async ({ device }) => {
  const { player } = await angelFight(device, omen('breath', 'boss'), { x: 4, y: 2 }, { x: 3, y: 2 });
  await expect(combat(player).locator('.myth-title')).toHaveText('OMEN: The First Breath');
  await expect(combat(player).locator('.myth-you')).toHaveText('You are in the marked tiles.');
});
