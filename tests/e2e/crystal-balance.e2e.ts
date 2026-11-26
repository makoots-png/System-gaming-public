// Mana crystal balance, gate drops, exchange buyers, and GM controls (economy unit 3).
import type { Page } from '@playwright/test';
import { CRYSTAL_WORDS, clearCrystalEach } from '../../src/core/hunter/crystal.ts';
import { PRESET_WORDS } from '../../src/core/gates/preset.ts';
import { RULES, rulesOf } from '../../src/core/rules.ts';
import { crystalLines } from '../../src/core/rules-text.ts';
import { test, expect, setupGoblinDenGM, onboardPlayer, createRoom, dismissAll, go, activeHunter, gateByName } from './helpers.ts';

const HUNTER = 'Kira Crystal';
const exchangeWin = (page: Page) => page.locator('.sys-overlay.show', { hasText: CRYSTAL_WORDS.modalTitle });

test('player earns mana crystal from a clear, sells at Bureau when debt-free and Stair when in debt, sees Helix locked, and syncs to GM', async ({ device }) => {
  const gm = (await device('gm')).page, player = (await device('player')).page;
  await setupGoblinDenGM(gm);
  const code = await createRoom(gm);
  await onboardPlayer(player, HUNTER, code);
  await expect.poll(() => player.evaluate(() => hunterApp.api.sync.room())).toBe(code);
  await dismissAll(player, 4);
  await player.evaluate(() => hunterApp.store.update((d: any) => { d.rulesOverrides.solo = { personal: false }; }, 'test-setup'));

  await go(gm, 'gm');
  await expect(gm.locator('#gm-board .gm-card.remote', { hasText: HUNTER })).toHaveCount(1);

  const gate = await gateByName(gm, 'Goblin Den');
  const expectedCrystal = clearCrystalEach({ rank: 'E', type: 'normal' }, 1, RULES); // 48 for 1 hunter at E-rank normal

  await test.step('GM clears world gate and player receives mana crystal alongside gold', async () => {
    await go(gm, 'gates');
    const card = gm.locator(`.gate[data-id="${gate.id}"]`);
    await card.locator('[data-act="clear"]').tap();
    const form = card.locator('form[data-form="clear"]');
    // Select only the remote player hunter
    const boxes = form.locator('input[name="hid"]');
    const count = await boxes.count();
    for (let i = 0; i < count; i++) {
      const box = boxes.nth(i);
      const label = await box.locator('..').innerText();
      const want = label.includes(HUNTER);
      if ((await box.isChecked()) !== want) await box.click();
    }
    await expect(form.locator('[data-clearcrystal]')).toHaveText(String(expectedCrystal));
    await form.locator('button[type="submit"]').tap();
    await dismissAll(gm, 4);

    // Player gets the award popup showing mana crystal and Bag updates
    await expect.poll(async () => (await activeHunter(player)).crystal).toBe(expectedCrystal);
    await dismissAll(player, 4);
    await go(player, 'status');
    await expect(player.locator('#view-status [data-crystal]')).toHaveText(String(expectedCrystal));
  });

  await test.step('Debt-free player sells at Bureau exchange (85%), Helix is locked, and GM receives synced balance', async () => {
    const before = await activeHunter(player);
    await player.locator('#view-status [data-sell-crystal]').tap();
    const win = exchangeWin(player);
    await expect(win).toBeVisible();

    // Helix is shown unavailable (guild hunters only); Bureau is default checked
    await expect(win.locator('[data-cx-row="helix"] input')).toBeDisabled();
    await expect(win.locator('[data-cx-row="helix"]')).toContainText(CRYSTAL_WORDS.unavailableTag);
    await expect(win.locator('[data-cx-row="bureau"] input')).toBeChecked();
    await expect(win.locator('[data-cx-row="stair"] input')).toBeEnabled();

    // Sell 20 crystal at 85% -> 17 gold
    const amt = win.locator('[data-cx-amt]');
    await amt.fill('20');
    await expect(win.locator('[data-cx-preview]')).toContainText('17 gold');
    await win.locator('.sys-actions button.primary').tap();
    await expect(win).toHaveCount(0);

    const after = await activeHunter(player);
    expect(after.crystal).toBe(before.crystal - 20);
    expect(after.gold).toBe(before.gold + 17);

    // GM phone receives the synced crystal and gold via sheet push
    await expect.poll(() => gm.evaluate((name: string) => {
      const r = hunterApp.api.sync.remoteSheets().find((x: any) => x.data.name === name);
      return r ? r.data.crystal : -1;
    }, HUNTER)).toBe(after.crystal);
  });

  await test.step('In System debt: Bureau is locked, Stair fence (70%) is default open, and sale leaves debt untouched', async () => {
    await player.evaluate(() => hunterApp.store.update((d: any) => {
      const h = d.hunters.find((x: any) => x.id === d.settings.activeHunterId) ?? d.hunters[0];
      h.debt = 300;
    }, 'test-debt'));

    const before = await activeHunter(player);
    await player.locator('#view-status [data-sell-crystal]').tap();
    const win = exchangeWin(player);
    await expect(win).toBeVisible();

    await expect(win.locator('[data-cx-row="bureau"] input')).toBeDisabled();
    await expect(win.locator('[data-cx-row="bureau"]')).toContainText(CRYSTAL_WORDS.unavailableTag);
    await expect(win.locator('[data-cx-row="stair"] input')).toBeChecked();
    await expect(win).toContainText(CRYSTAL_WORDS.debtNote);

    // Sell 20 crystal at Stair fence (70%) -> 14 gold, debt stays 300
    await win.locator('[data-cx-amt]').fill('20');
    await expect(win.locator('[data-cx-preview]')).toContainText('14 gold');
    await win.locator('.sys-actions button.primary').tap();
    await expect(win).toHaveCount(0);

    const after = await activeHunter(player);
    expect(after.crystal).toBe(before.crystal - 20);
    expect(after.gold).toBe(before.gold + 14);
    expect(after.debt).toBe(300);
  });

  await test.step('Dead hunter cannot sell crystal', async () => {
    await player.evaluate(() => hunterApp.store.update((d: any) => {
      const h = d.hunters.find((x: any) => x.id === d.settings.activeHunterId) ?? d.hunters[0];
      h.reviveLeft = 'none';
      h.life = { at: 'dead' };
    }, 'test-dead'));
    const before = await activeHunter(player);
    await player.locator('#view-status [data-sell-crystal]').tap();
    await expect(exchangeWin(player)).toHaveCount(0);
    await expect(player.locator('#toasts')).toContainText(CRYSTAL_WORDS.refusals.dead);
    expect((await activeHunter(player)).crystal).toBe(before.crystal);
  });

  await test.step('GM crystal rule override syncs to player Rules page', async () => {
    await gm.evaluate(() => hunterApp.store.update((d: any) => {
      d.rulesOverrides = { ...d.rulesOverrides, crystal: { rates: { bureau: 0.88 } } };
    }, 'gm-rules'));
    await expect.poll(() => player.evaluate(() => hunterApp.rules().crystal.rates.bureau)).toBe(0.88);
    await go(player, 'rules');
    const sec = player.locator('#rr-crystal');
    await expect(sec).toBeVisible();
    for (const line of crystalLines(rulesOf({ crystal: { rates: { bureau: 0.88 } } }))) {
      await expect(sec).toContainText(line);
    }
  });
});

test('GM can adjust, edit, award, and pre-set mana crystal per hunter', async ({ device }) => {
  const gm = (await device('gm-ctrl')).page;
  await setupGoblinDenGM(gm);
  await go(gm, 'status');

  // 1. Bag Adjust crystal
  await gm.locator('#view-status [data-crystal-adj]').tap();
  const prompt = gm.locator('.sys-overlay.show');
  await expect(prompt).toContainText(CRYSTAL_WORDS.adjustTitle);
  await prompt.locator('.sys-input').fill('50');
  await prompt.locator('.sys-actions button.primary').tap();
  await expect(gm.locator('#view-status [data-crystal]')).toHaveText('50');

  // 2. GM: Edit hunter raw field
  const rawInput = gm.locator('#view-status [data-raw="crystal"]');
  await rawInput.fill('80');
  await rawInput.dispatchEvent('change');
  await expect(gm.locator('#view-status [data-crystal]')).toHaveText('80');

  // 3. GM Award form Mana crystal field
  await go(gm, 'gm');
  const toggle = gm.locator('[data-tog="award"]');
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.tap();
  const activeName = (await activeHunter(gm)).name;
  await gm.locator('#gm-targets label', { hasText: activeName }).locator('input').check();
  await gm.locator('#gm-rw [data-n="crystal"]').fill('25');
  await expect(gm.locator('#gm-rw .rw-preview')).toContainText('+25 mana crystal');
  await gm.locator('#gm-award-go').scrollIntoViewIfNeeded();
  await gm.locator('#gm-award-go').tap();
  await dismissAll(gm, 4);
  expect((await activeHunter(gm)).crystal).toBe(105);

  // 4. Gate Clear rewards preset Mana crystal per hunter
  const gate = await gateByName(gm, 'Goblin Den');
  await go(gm, 'gates');
  const card = gm.locator(`.gate[data-id="${gate.id}"]`);
  await card.locator('[data-act="preset"]').tap();
  const pForm = card.locator('form[data-form="preset"]');
  const crInput = pForm.locator('input[name="crystal"]');
  await crInput.fill('35');
  await crInput.dispatchEvent('change');
  await expect(card.locator('[data-preset-summary]')).toContainText('35 mana crystal');
  await pForm.locator('[data-act="cancel-panel"]').tap();

  await card.locator('[data-act="clear"]').tap();
  const cForm = card.locator('form[data-form="clear"]');
  await expect(cForm).toContainText('35 mana crystal');
  await cForm.locator('button[type="submit"]').tap();
  await dismissAll(gm, 4);
  expect((await activeHunter(gm)).crystal).toBe(140);
  expect(await gm.evaluate(() => hunterApp.store.get().log.find((l: any) => l.title === 'GATE CLEARED')?.text ?? '')).toContain('35 mana crystal');
  await expect(card.locator('[data-preset-summary]')).toContainText(PRESET_WORDS.summary({ xp: 0, gold: 0, crystal: 35, items: [] }, true, n => String(n)).split(', ').pop()!);
});
