// Browser tests for unit A6: one-tap Auto turn button for monsters in live combat
// (src/core/combat/policy.ts `autoMonsterTurn`, src/views/combat.js).
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { RULES } from '../../src/core/rules.ts';
import { abilityId } from '../../src/core/combat/ability-types.ts';
import { REFUSAL_WORDS } from '../../src/core/combat/refusal-words.ts';
import { percent, tiles } from '../../src/core/combat/space.ts';
import { abilityOf } from '../../src/core/registry/ability-kinds.ts';
import { test, expect, onboardGM, onboardPlayer, createRoom, dismissAll, go, fightRow, chooseList, setupDoc, PHONE, SMALL_PHONE } from './helpers.ts';

const SHOTS = join('.lead-scratch', 'shots');
mkdirSync(SHOTS, { recursive: true });

const combat = (page: Page) => page.locator('#view-combat');
const map = (page: Page) => combat(page).locator('[data-mapbox]');
const highestDice = (page: Page) => page.evaluate(() =>
  Object.defineProperty(crypto, 'getRandomValues', { configurable: true, value: (a: Uint32Array) => a.fill(0xffffffff) }));
const lowestDice = (page: Page) => page.evaluate(() =>
  Object.defineProperty(crypto, 'getRandomValues', { configurable: true, value: (a: Uint32Array) => a.fill(0) }));

const FROST_NOVA = abilityOf('blast', {
  id: abilityId('frost-nova'),
  name: 'Frost Nova',
  range: tiles(8),
  foesOnly: true,
  shape: { kind: 'radius', radius: tiles(1), ring: { outer: tiles(2), share: percent(50) } },
}, RULES);

async function startSimpleMonsterFight(page: Page, listMode: boolean) {
  await onboardGM(page);
  if (listMode) await chooseList(page);
  await go(page, 'combat');
  await combat(page).locator('[data-hsel]').selectOption({ label: 'Brakk Ironhide' });
  await combat(page).locator('[data-addh]').tap();
  await combat(page).locator('[data-qline]').fill('Cave Rat x2, E, brute');
  await combat(page).locator('[data-qadd]').tap();
  await combat(page).locator('[data-start]').tap();
  if (listMode) await expect(combat(page).locator('.cmb-row.cur')).toHaveCount(1);
  else await expect(map(page).locator('.mp-tok.now')).toHaveCount(1);

  await page.evaluate(() => hunterApp.store.update((d: any) => {
    const f = d.fight;
    const brakk = f.rows.find((r: any) => r.kind === 'hunter');
    const rats = f.rows.filter((r: any) => r.kind === 'monster');
    brakk.place = { x: 4, y: 4 }; brakk.at = f.now + 50; brakk.tie = 0;
    rats[0].place = { x: 4, y: 5 }; rats[0].at = f.now; rats[0].tie = 0;
    rats[1].place = { x: 4, y: 8 }; rats[1].at = f.now + 20; rats[1].tie = 0;
    f.currentId = rats[0].id; f.log = [];
  }, 'test-setup'));
}

test('at 360 px and 390 px, an active monster card shows Auto turn cleanly without overflow and one tap runs the turn', async ({ device }) => {
  for (const [label, viewport, shot] of [
    ['gm360', SMALL_PHONE, 'a6-monster-card-360.png'],
    ['gm390', PHONE, 'a6-monster-card-390.png'],
  ] as const) {
    const page = (await device(label, { viewport })).page;
    await startSimpleMonsterFight(page, true);

    const card = combat(page).locator('.cmb-card.turn');
    const btn = card.locator('[data-auto]');
    await expect(btn).toBeVisible();
    await expect(btn).toHaveText('Auto turn');
    await card.evaluate((el: HTMLElement) => el.scrollIntoView({ block: 'start' }));

    const box = (await btn.boundingBox())!;
    expect(box.height, `${label}: tap target >= 44 px`).toBeGreaterThanOrEqual(44);
    expect(box.x + box.width, `${label}: button fits inside viewport`).toBeLessThanOrEqual(viewport.width);
    expect(await page.evaluate(() => document.scrollingElement!.scrollWidth <= innerWidth), `${label}: no sideways scroll`).toBe(true);
    await page.screenshot({ path: join(SHOTS, shot), fullPage: false });

    const beforeHp = (await fightRow(page, 'Brakk Ironhide')).hp;
    await lowestDice(page);
    await btn.tap();
    await expect.poll(async () => (await fightRow(page, 'Brakk Ironhide')).hp).toBeLessThan(beforeHp);
    // Second monster (at y=8) is now active and out of melee range -> Auto turn walks it closer.
    const ratB = await page.evaluate(() => {
      const f = hunterApp.store.get().fight;
      return f.rows.find((r: any) => r.id === f.currentId);
    });
    expect(ratB.kind).toBe('monster');
    const beforePlace = ratB.place;
    await card.locator('[data-auto]').tap();
    await expect.poll(() => page.evaluate(id => {
      const f = hunterApp.store.get().fight;
      const r = f.rows.find((x: any) => x.id === id);
      return JSON.stringify(r.place);
    }, ratB.id)).not.toBe(JSON.stringify(beforePlace));
  }
});

test('in Map view at 360 px, Auto turn sits in the top bar for one-tap monster play without hiding the hotbar', async ({ device }) => {
  const page = (await device('gm-map', { viewport: SMALL_PHONE })).page;
  await startSimpleMonsterFight(page, false);

  const barAuto = combat(page).locator('[data-bar] [data-auto]');
  await expect(barAuto).toBeVisible();
  await expect(barAuto).toHaveText('Auto turn');
  const box = (await barAuto.boundingBox())!;
  expect(box.height, 'bar Auto turn >= 44 px').toBeGreaterThanOrEqual(44);
  expect(box.x + box.width, 'bar Auto turn fits 360 px').toBeLessThanOrEqual(SMALL_PHONE.width);
  expect(await page.evaluate(() => document.scrollingElement!.scrollWidth <= innerWidth), 'no sideways scroll').toBe(true);
  const nav = (await page.locator('.nav-bottom').boundingBox())!;
  const hot = (await map(page).locator('[data-hot]').boundingBox())!;
  expect(hot.y + hot.height, 'hotbar stays above bottom nav').toBeLessThanOrEqual(nav.y);

  const beforeHp = (await fightRow(page, 'Brakk Ironhide')).hp;
  await lowestDice(page);
  await barAuto.tap();
  await expect.poll(async () => (await fightRow(page, 'Brakk Ironhide')).hp).toBeLessThan(beforeHp);
});

test('fudge forced d20 applies to Auto turn rolls and is spent just like a hand roll', async ({ device }) => {
  const page = (await device('gm-fudge', { viewport: PHONE })).page;
  await startSimpleMonsterFight(page, true);

  // Force natural 20 on the active monster so even with highest raw random (d20 = 20 for target), target's reaction is forced to 1 (crit).
  await combat(page).locator('.cmb-card.turn [data-fudge-force][data-face="20"]').tap();
  await expect(combat(page).locator('.cmb-card.turn [data-fudgeline]')).toContainText('Next d20 forced: 20');
  const ratId = await page.evaluate(() => hunterApp.store.get().fight.currentId as string);
  const beforeHp = (await fightRow(page, 'Brakk Ironhide')).hp;
  await highestDice(page);
  await combat(page).locator('.cmb-card.turn [data-auto]').tap();
  await expect.poll(async () => (await fightRow(page, 'Brakk Ironhide')).hp).toBeLessThan(beforeHp);
  const forcedAfter = await page.evaluate(id => hunterApp.store.get().fight.fudge.forced[id] ?? null, ratId);
  expect(forcedAfter, 'forced d20 is consumed by Auto turn').toBeNull();
  await expect(combat(page).locator('[data-log]')).toContainText('crit');
});

test('Auto turn pauses for the player dodge picker when a monster blast catches a hunter', async ({ device }) => {
  const gm = (await device('gm-dodge', { viewport: PHONE })).page;
  const player = (await device('pl-dodge', { viewport: SMALL_PHONE })).page;
  await onboardGM(gm);
  const code = await createRoom(gm);
  await onboardPlayer(player, 'Kai Auto', code);
  await expect.poll(() => player.evaluate(() => hunterApp.api.sync.room())).toBe(code);
  await dismissAll(player, 4);
  await go(gm, 'gm');
  await expect(gm.locator('#gm-board .gm-card.remote', { hasText: 'Kai Auto' })).toHaveCount(1);

  await go(gm, 'combat');
  await chooseList(gm);
  await gm.locator('#view-combat [data-hsel]').selectOption({ label: 'Kai Auto (player phone)' });
  await gm.locator('#view-combat [data-addh]').tap();
  await gm.locator('#view-combat [data-qline]').fill('Frost Imp, E, caster');
  await gm.locator('#view-combat [data-qadd]').tap();
  await gm.locator('#view-combat [data-start]').tap();
  await expect(gm.locator('#view-combat .cmb-row.cur')).toHaveCount(1);

  await gm.evaluate(blast => hunterApp.store.update((d: any) => {
    const f = d.fight;
    const kai = f.rows.find((r: any) => r.kind === 'hunter');
    const imp = f.rows.find((r: any) => r.kind === 'monster');
    kai.place = { x: 5, y: 5 }; kai.at = f.now + 50; kai.tie = 0;
    imp.place = { x: 5, y: 2 }; imp.at = f.now; imp.tie = 0;
    imp.abilities = [blast];
    f.currentId = imp.id; f.log = [];
  }, 'test-setup'), FROST_NOVA);
  await setupDoc(player, 'Kai Auto', { x: 5, y: 5 });
  await go(player, 'combat');

  await highestDice(gm);
  const autoBtn = gm.locator('#view-combat .cmb-card.turn [data-auto]');
  await autoBtn.tap();

  // GM sees dodge banner and Auto turn becomes disabled while waiting for the hunter's dodge pick.
  await expect(gm.locator('#view-combat [data-dodge]')).toBeVisible();
  await expect(autoBtn).toBeDisabled();
  await expect(player.locator('#view-combat .tb-dodge')).toBeVisible();

  // GM resolves with automatic nearest safe tile -> dodge closes and turn moves on.
  await gm.locator('#view-combat [data-dodge-auto]').tap();
  await expect(gm.locator('#view-combat [data-dodge]')).toBeHidden();
  await expect.poll(() => gm.evaluate(() => hunterApp.store.get().fight.dodge ?? null)).toBeNull();
});

test('stale Auto turn tap after the turn moved and second GM device guard both refuse safely', async ({ device }) => {
  const page = (await device('gm-stale', { viewport: PHONE })).page;
  await startSimpleMonsterFight(page, true);
  await expect(combat(page).locator('.cmb-card.turn [data-auto]')).toBeVisible();

  // Stale tap: simulate clicking a button carrying a previous combatant id after the turn already moved.
  const staleResult = await page.evaluate(() => {
    const f = hunterApp.store.get().fight;
    const other = f.rows.find((r: any) => r.id !== f.currentId);
    const btn = document.querySelector('#view-combat .cmb-card.turn [data-auto]') as HTMLButtonElement;
    btn.dataset.auto = other.id;
    const curBefore = f.currentId;
    btn.click();
    return { curBefore, curAfter: hunterApp.store.get().fight.currentId };
  });
  expect(staleResult.curAfter).toBe(staleResult.curBefore);
  await expect(page.locator('#toasts .toast-warning')).toContainText(REFUSAL_WORDS.notYourTurn);

  // Two GM devices: if another GM device owns the active room fight doc, Auto turn asks to confirm Replace fight.
  await page.evaluate(() => {
    const f = hunterApp.store.get().fight;
    const btn = document.querySelector('#view-combat .cmb-card.turn [data-auto]') as HTMLButtonElement;
    btn.dataset.auto = f.currentId;
    // Stub seat + room doc from another GM device to exercise the two-GM confirmation boundary.
    hunterApp.seat = () => 'gm';
    const origDoc = hunterApp.api.sync.doc;
    hunterApp.api.sync.doc = (name: any) => name === 'fight'
      ? { ended: false, active: true, by: 'd-other-gm', id: 'f-other', at: new Date().toISOString(), now: 0, currentId: null, ahead: [], grid: { w: 10, h: 10, tiles: null, lit: null }, zones: [], rows: [], log: [], refused: null, ready: {} } as any
      : origDoc(name);
  });
  const nowBefore = await page.evaluate(() => hunterApp.store.get().fight.now as number);
  await combat(page).locator('.cmb-card.turn [data-auto]').tap();
  const confirmWin = page.locator('.sys-overlay.show', { hasText: 'Fight running on another device' });
  await expect(confirmWin).toBeVisible();
  await confirmWin.locator('button', { hasText: 'Cancel' }).tap();
  await expect(confirmWin).toHaveCount(0);
  expect(await page.evaluate(() => hunterApp.store.get().fight.now)).toBe(nowBefore);
});

test('on a mythic landing turn, Auto turn lands the standing omen on the aimed hunter', async ({ device }) => {
  const page = (await device('gm-mythic', { viewport: PHONE })).page;
  await onboardGM(page);
  await chooseList(page);
  await go(page, 'combat');
  await combat(page).locator('[data-hsel]').selectOption({ label: 'Brakk Ironhide' });
  await combat(page).locator('[data-addh]').tap();
  await combat(page).locator('[data-msel]').selectOption({ label: 'The Fourth Rider (S mythic)' });
  await combat(page).locator('[data-addm]').tap();
  await combat(page).locator('[data-start]').tap();
  await expect(combat(page).locator('.cmb-row.cur')).toHaveCount(1);

  // Set up The Fourth Rider's standing omen (Named in the Book) aimed at Brakk on the mythic's turn.
  await page.evaluate(() => hunterApp.store.update((d: any) => {
    const f = d.fight;
    const brakk = f.rows.find((r: any) => r.kind === 'hunter');
    const rider = f.rows.find((r: any) => r.kind === 'monster');
    brakk.place = { x: 8, y: 5 }; brakk.at = f.now + 50; brakk.tie = 0;
    rider.place = { x: 5, y: 5 }; rider.at = f.now; rider.tie = 0;
    rider.mythic = { at: 'omen', script: 'the-fourth-rider', phase: 0, beat: 1, since: f.now, omen: 'named', aim: brakk.id, hpAt: rider.life.hp, barAt: rider.stagger && { fill: rider.stagger.fill, max: rider.stagger.max } };
    f.currentId = rider.id; f.log = [];
  }, 'test-setup'));

  const beforeHp = (await fightRow(page, 'Brakk Ironhide')).hp;
  const autoBtn = combat(page).locator('.cmb-card.turn [data-auto]');
  await expect(autoBtn).toBeVisible();
  await autoBtn.tap();
  await expect.poll(async () => (await fightRow(page, 'Brakk Ironhide')).hp).toBeLessThan(beforeHp);
  const mythicAt = await page.evaluate(() => hunterApp.store.get().fight.rows.find((r: any) => r.kind === 'monster').mythic.at as string);
  expect(mythicAt, 'omen landed and mythic returned to calm').toBe('calm');
});
