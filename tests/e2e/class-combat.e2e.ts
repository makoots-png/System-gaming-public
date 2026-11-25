// class-combat.e2e.ts: verifies class combat wiring in the browser UI, specifically that Hemomancer's
// self-centered place ability Tides of Blood (aim: 'place', range: 0) can be cast from both the player
// turn card (uses.js) and the GM combat screen (combat.js) without hitting an empty target picker.
import type { Page } from '@playwright/test';
import { test, expect, onboardGM, onboardPlayer, createRoom, dismissAll, go, chooseList, fightRow, setupDoc } from './helpers.ts';

const HUNTER = 'Vlad Test';
const MONSTER = 'Cave Rat';
const combat = (page: Page) => page.locator('#view-combat');

test('Hemomancer Tides of Blood (place aim, range 0) casts cleanly from player and GM combat screens', async ({ device }) => {
  const gm = (await device('gm')).page;
  const player = (await device('player')).page;

  await onboardGM(gm);
  await chooseList(gm);
  const code = await createRoom(gm);

  await onboardPlayer(player, HUNTER, code);
  await chooseList(player);
  await expect.poll(() => player.evaluate(() => hunterApp.api.sync.room())).toBe(code);
  await dismissAll(player, 4);

  // Raise the player's hunter to S-rank stats/HP so Tides of Blood's 10% HP cost is payable
  const playerKey = await player.evaluate(() => {
    const s = hunterApp.store;
    s.update(() => {
      const h = s.active();
      h.rank = 'S';
      h.level = 70;
      h.stats = { ...h.stats, pow: 120, vit: 60 };
      h.life = { at: 'up', hp: 500 };
    }, 'test-setup');
    return hunterApp.api.sync.myKey(s.active().id);
  });

  // GM grants the unique Hemomancer class via room holders doc (PR 1 authority); player converges automatically
  await gm.evaluate(who => {
    hunterApp.store.update((d: any) => {
      d.classHolders = {
        registryId: d.classHolders?.registryId || 'reg-e2e',
        held: { Hemomancer: { kind: 'remote', sheetKey: who, grantId: 'cg-e2e-1', at: '2026-11-25T12:00:00.000Z' } },
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

  // Start a fight with the player's Hemomancer at (2, 2) and an adjacent S-rank boss at (3, 2)
  await go(gm, 'combat');
  await combat(gm).locator('[data-hsel]').selectOption({ label: `${HUNTER} (player phone)` });
  await combat(gm).locator('[data-addh]').tap();
  await combat(gm).locator('[data-qline]').fill(`${MONSTER}, S, brute, boss`);
  await combat(gm).locator('[data-qadd]').tap();
  await combat(gm).locator('[data-start]').tap();
  await expect(combat(gm).locator('.cmb-row.cur')).toHaveCount(1);

  await gm.evaluate(name => hunterApp.store.update((d: any) => {
    const f = d.fight;
    const hero = f.rows.find((r: any) => r.name === name);
    const rat = f.rows.find((r: any) => r.kind === 'monster');
    hero.place = { x: 2, y: 2 };
    rat.place = { x: 3, y: 2 };
    hero.at = f.now;
    hero.tie = 0;
    rat.at = f.now + 1;
    rat.tie = 0;
    f.currentId = hero.id;
    f.log = [];
  }, 'test-setup'), HUNTER);
  await setupDoc(player, HUNTER, { x: 2, y: 2 });
  await go(player, 'combat');
  await expect(combat(player).locator('.tb-mine')).toContainText('YOUR TURN');

  const hpBefore = (await fightRow(gm, HUNTER)).hp;

  await test.step('player casts Tides of Blood from turn card without an empty target picker refusal', async () => {
    const tidesBtn = combat(player).locator('[data-cast="worn-hemo-tides-of-blood"]');
    await expect(tidesBtn).toBeVisible();
    await tidesBtn.tap();
    // Base Tides of Blood begins channeling on caster's own tile and pays 10% max HP immediately
    await expect.poll(async () => (await fightRow(gm, HUNTER)).hp, { timeout: 15_000 }).toBeLessThan(hpBefore);
    await expect.poll(async () => gm.evaluate(n => hunterApp.store.get().fight?.rows.find((r: any) => r.name === n)?.channel?.state ?? null, HUNTER), { timeout: 15_000 }).toBe('holding');
  });

  await test.step('GM combat screen also casts self-centered Tides of Blood directly after resetting channel', async () => {
    await gm.evaluate(name => hunterApp.store.update((d: any) => {
      const f = d.fight;
      const hero = f.rows.find((r: any) => r.name === name);
      const rat = f.rows.find((r: any) => r.kind === 'monster');
      hero.holder = null;
      hero.channel = null;
      hero.readyAt = {};
      hero.at = f.now;
      hero.tie = 0;
      rat.at = f.now + 100;
      rat.tie = 0;
      f.currentId = hero.id;
    }, 'test-setup'), HUNTER);
    await combat(gm).locator('.cmb-pick', { hasText: HUNTER }).first().tap();
    const hp2 = (await fightRow(gm, HUNTER)).hp;
    const gmTidesBtn = combat(gm).locator('.cmb-card.turn [data-ab="worn-hemo-tides-of-blood"]');
    await expect(gmTidesBtn).toBeVisible();
    await gmTidesBtn.tap();
    await expect.poll(async () => (await fightRow(gm, HUNTER)).hp, { timeout: 10_000 }).toBeLessThan(hp2);
  });
});
