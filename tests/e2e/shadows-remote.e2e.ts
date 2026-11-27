// Remote shadows in a room fight (Wave 2 PR 1): GM sees a player's summoned shadows, ownerOut/shadowsIn guards,
// and remote shadow HP write-back (shadowHp room event -> setShadowHp) through damage and defeat.
import type { Page } from '@playwright/test';
import { test, expect, setupGoblinDenGM, onboardPlayer, createRoom, dismissAll, go, chooseList, fightRow, answerWindow } from './helpers.ts';

const HUNTER = 'Mira Test';
const SHADOW = 'Igris';
const combat = (page: Page) => page.locator('#view-combat');

test('a player\'s summoned shadow joins the GM\'s fight under owner guards and syncs HP and defeat back to the player\'s Shadows panel', async ({ device }) => {
  const gm = (await device('gm')).page;
  const player = (await device('player')).page;

  await setupGoblinDenGM(gm);
  await chooseList(gm);
  const code = await createRoom(gm);

  await onboardPlayer(player, HUNTER, code);
  await chooseList(player);
  await expect.poll(() => player.evaluate(() => hunterApp.api.sync.room())).toBe(code);
  await dismissAll(player, 4);

  // Give the player's hunter a summoned shadow and wait for the GM to receive their sheet with it.
  const startHp = await player.evaluate(name => {
    const s = hunterApp.store;
    let hp = 20;
    s.update(() => {
      const h = s.active();
      const id = s.id('sh');
      h.shadows.push({ id, name, rank: 'E', archetype: 'brute', grade: 'Normal', monster: null, hp, summoned: true, notes: '' });
    }, 'test-setup');
    return hp;
  }, SHADOW);

  await expect.poll(() => gm.evaluate(([hName, sName]) => (hunterApp.api.sync.remoteSheets() as any[])
    .some(r => r.data.name === hName && r.data.shadows.some((x: any) => x.name === sName && x.summoned)), [HUNTER, SHADOW] as const), { timeout: 15_000 }).toBe(true);

  await go(gm, 'combat');
  const shadowOption = `${SHADOW} (${HUNTER}, player phone)`;
  await expect(combat(gm).locator('[data-ssel] option', { hasText: shadowOption })).toHaveCount(1);

  await test.step('adding the shadow before its hunter is refused with the hunter\'s name', async () => {
    await combat(gm).locator('[data-ssel]').selectOption({ label: shadowOption });
    await combat(gm).locator('[data-adds]').tap();
    await expect(gm.locator('#toasts')).toContainText(`Add ${HUNTER} first, then ${HUNTER}'s shadows.`);
    expect(await gm.evaluate(() => hunterApp.store.get().fight)).toBeNull();
  });

  await test.step('adding the hunter then the shadow succeeds, and removing the hunter while their shadow remains is refused', async () => {
    await combat(gm).locator('[data-hsel]').selectOption({ label: `${HUNTER} (player phone)` });
    await combat(gm).locator('[data-addh]').tap();
    await expect(combat(gm).locator('.cmb-row', { hasText: HUNTER })).toHaveCount(1);

    await combat(gm).locator('[data-ssel]').selectOption({ label: shadowOption });
    await combat(gm).locator('[data-adds]').tap();
    await expect(combat(gm).locator('.cmb-row', { hasText: SHADOW })).toHaveCount(1);

    await combat(gm).locator('.cmb-row', { hasText: HUNTER }).locator('.cmb-pick').tap();
    await combat(gm).locator('.cmb-card [data-remove]').tap();
    await answerWindow(gm, 'Remove combatant?', 'Remove combatant');
    await expect(gm.locator('#toasts')).toContainText(`Remove ${HUNTER}'s shadows first.`);
    await expect(combat(gm).locator('.cmb-row', { hasText: HUNTER })).toHaveCount(1);
  });

  await test.step('damaging and defeating the remote shadow in the fight writes HP and unsummoned state back to the player\'s Shadows panel', async () => {
    await combat(gm).locator('[data-qline]').fill('Cave Rat, E, brute');
    await combat(gm).locator('[data-qadd]').tap();
    await combat(gm).locator('[data-start]').tap();
    await expect(combat(gm).locator('.cmb-row.cur')).toHaveCount(1);

    const rowBefore = await fightRow(gm, SHADOW);
    expect(rowBefore.hp).toBeLessThanOrEqual(startHp);
    const dmg = 5;
    const expectedHp = Math.max(1, rowBefore.hp - dmg);
    await combat(gm).locator('.cmb-row', { hasText: SHADOW }).locator('.cmb-pick').tap();
    await combat(gm).locator('.cmb-card [data-q="-5"]').tap();
    await expect.poll(async () => (await fightRow(gm, SHADOW)).hp).toBe(expectedHp);

    await go(player, 'shadows');
    const card = player.locator('#view-shadows .sh-card', { hasText: SHADOW });
    await expect(card).toContainText(`HP ${expectedHp} /`, { timeout: 15_000 });
    await expect(card.locator('[data-act="summon"]')).toHaveText('Unsummon');

    // Defeat the shadow (0 HP): player's panel updates to 0 HP and resting (Summon disabled).
    await combat(gm).locator('.cmb-card [data-defeat]').tap();
    await expect.poll(async () => (await fightRow(gm, SHADOW)).hp).toBe(0);
    await expect(card).toContainText('HP 0 /', { timeout: 15_000 });
    await expect(card.locator('[data-act="summon"]')).toHaveText('Summon');
    await expect(card.locator('[data-act="summon"]')).toBeDisabled();
  });

  await test.step('removing the shadow first lets the GM remove the hunter', async () => {
    await combat(gm).locator('.cmb-row', { hasText: SHADOW }).locator('.cmb-pick').tap();
    await combat(gm).locator('.cmb-card [data-remove]').tap();
    await answerWindow(gm, 'Remove combatant?', 'Remove combatant');
    await expect(combat(gm).locator('.cmb-row', { hasText: SHADOW })).toHaveCount(0);

    await combat(gm).locator('.cmb-row', { hasText: HUNTER }).locator('.cmb-pick').tap();
    await combat(gm).locator('.cmb-card [data-remove]').tap();
    await answerWindow(gm, 'Remove combatant?', 'Remove combatant');
    await expect(combat(gm).locator('.cmb-row', { hasText: HUNTER })).toHaveCount(0);
  });
});
