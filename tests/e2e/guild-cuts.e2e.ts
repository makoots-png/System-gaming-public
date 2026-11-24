// Guild contracts, Ninth Hour Rookie refusal, Order C debt + guild stacking, Helix 90% sales, GM overrides, and phone Rules layout (economy unit 4).
import type { Page } from '@playwright/test';
import { CRYSTAL_WORDS, clearCrystalFor } from '../../src/core/hunter/crystal.ts';
import { GUILD_TABLE_PERKS, GUILD_WORDS, guildSheetLine } from '../../src/core/hunter/guild.ts';
import { RULES, rulesOf } from '../../src/core/rules.ts';
import { guildLines } from '../../src/core/rules-text.ts';
import { test, expect, onboardGM, onboardPlayer, createRoom, dismissAll, go, activeHunter, gateByName } from './helpers.ts';

const HUNTER = 'Jin Guild';
const modalWin = (page: Page, title: string) => page.locator('.sys-overlay.show', { hasText: title });

test('GM refuses Ninth Hour Rookie, assigns Ironwake Core, player uses Helix 90%, clears with Order C debt+guild split, uses custom override, and reads Rules at 390px and 360px', async ({ device }) => {
  const gm = (await device('gm-guild')).page, player = (await device('pl-guild')).page;
  await onboardGM(gm);
  const code = await createRoom(gm);
  await onboardPlayer(player, HUNTER, code);
  await expect.poll(() => player.evaluate(() => hunterApp.api.sync.room())).toBe(code);
  await dismissAll(player, 4);
  await player.evaluate(() => hunterApp.store.update((d: any) => { d.rulesOverrides.solo = { personal: false }; }, 'test-setup'));

  await go(gm, 'gm');
  const remoteCard = gm.locator('#gm-board .gm-card.remote', { hasText: HUNTER });
  await expect(remoteCard).toHaveCount(1);

  await test.step('GM editor refuses Ninth Hour Rookie in plain words, then assigns Ironwake (Core) and both phones update', async () => {
    await remoteCard.locator('[data-hguild]').tap();
    const dlg = modalWin(gm, GUILD_WORDS.modalTitle(HUNTER));
    await expect(dlg).toBeVisible();

    // Ninth Hour has no Rookie standing: refused in plain words and Save disabled
    await dlg.locator('[data-gd-arch]').selectOption('ninth-hour');
    await dlg.locator('[data-gd-stand]').selectOption('rookie');
    await expect(dlg.locator('[data-gd-preview]')).toHaveText(GUILD_WORDS.standingUnavailable('ninth-hour', 'rookie', RULES));
    await expect(dlg.locator('.sys-actions button.primary')).toBeDisabled();

    // Switch to Ironwake Core and save
    await dlg.locator('[data-gd-arch]').selectOption('ironwake');
    await dlg.locator('[data-gd-stand]').selectOption('core');
    await expect(dlg.locator('[data-gd-preview]')).toContainText('Ironwake (Core, rank E)');
    await expect(dlg.locator('.sys-actions button.primary')).toBeEnabled();
    await dlg.locator('.sys-actions button.primary').tap();
    await expect(dlg).toHaveCount(0);

    await expect.poll(async () => (await activeHunter(player)).guild?.archetype ?? null).toBe('ironwake');
    await go(player, 'status');
    await expect(player.locator('#view-status [data-guild-line]')).toHaveText(guildSheetLine({ rank: 'E', guild: { archetype: 'ironwake', standing: 'core' } }, RULES));

    // GM party card receives synced sheet and shows guild chip
    await expect(remoteCard.locator('[data-guild-chip]')).toHaveText('Ironwake · Core');
  });

  await test.step('Debt-free guild hunter sells crystal at Helix clerk (90%)', async () => {
    await player.evaluate(() => hunterApp.store.update((d: any) => {
      const h = d.hunters.find((x: any) => x.id === d.settings.activeHunterId) ?? d.hunters[0];
      h.crystal = 100;
    }, 'test-crystal'));

    await player.locator('#view-status [data-sell-crystal]').tap();
    const win = modalWin(player, CRYSTAL_WORDS.modalTitle);
    await expect(win).toBeVisible();
    await expect(win.locator('[data-cx-row="helix"] input')).toBeEnabled();
    await expect(win.locator('[data-cx-row="helix"] input')).toBeChecked();
    await win.locator('[data-cx-amt]').fill('50');
    await expect(win.locator('[data-cx-preview]')).toContainText('45 gold');
    await win.locator('.sys-actions button.primary').tap();
    await expect(win).toHaveCount(0);

    const after = await activeHunter(player);
    expect(after.crystal).toBe(50);
    expect(after.gold).toBe(45);
  });

  await test.step('GM clears world gate while player owes System debt: Order C applies debt first then guild cut and Helix locks in debt', async () => {
    await player.evaluate(() => hunterApp.store.update((d: any) => {
      const h = d.hunters.find((x: any) => x.id === d.settings.activeHunterId) ?? d.hunters[0];
      h.gold = 0;
      h.crystal = 20;
      h.debt = 500;
    }, 'test-debt'));

    // While in debt, Helix clerk is locked and Stair fence is default
    await player.locator('#view-status [data-sell-crystal]').tap();
    const cx = modalWin(player, CRYSTAL_WORDS.modalTitle);
    await expect(cx.locator('[data-cx-row="helix"] input')).toBeDisabled();
    await expect(cx.locator('[data-cx-row="stair"] input')).toBeChecked();
    await cx.locator('.sys-actions button', { hasText: CRYSTAL_WORDS.cancel }).tap();
    await expect(cx).toHaveCount(0);

    // GM clears Goblin Den for the player alone -> E normal pool 400 * 18% = 72 crystal
    const gate = await gateByName(gm, 'Goblin Den');
    const expectedCrystal = clearCrystalFor({ rank: 'E', type: 'normal' }, 1, { rank: 'E', guild: { archetype: 'ironwake', standing: 'core' } }, RULES);
    expect(expectedCrystal).toBe(72);

    await go(gm, 'gates');
    const card = gm.locator(`.gate[data-id="${gate.id}"]`);
    await card.locator('[data-act="clear"]').tap();
    const form = card.locator('form[data-form="clear"]');
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

    // Player receives guild crystal + Order C debt+guild split (always > 0 gold kept)
    await expect.poll(async () => (await activeHunter(player)).crystal).toBe(20 + expectedCrystal);
    const popup = player.locator('.sys-overlay.show');
    await expect(popup).toContainText('Ironwake');
    await expect(popup).toContainText('System debt');
    await dismissAll(player, 4);

    const hAfter = await activeHunter(player);
    expect(hAfter.gold).toBeGreaterThanOrEqual(1);
    expect(hAfter.debt).toBeLessThan(500);
  });

  await test.step('GM sets custom per-hunter gold cut override (10%) and player sheet reflects it', async () => {
    await go(gm, 'gm');
    await remoteCard.locator('[data-hguild]').tap();
    const dlg = modalWin(gm, GUILD_WORDS.modalTitle(HUNTER));
    await dlg.locator('[data-gd-gold]').fill('10');
    await expect(dlg.locator('[data-gd-preview]')).toHaveText(GUILD_WORDS.previewSigned({ archetype: 'ironwake', standing: 'core', goldCut: 0.1 }, 'E', RULES));
    await dlg.locator('.sys-actions button.primary').tap();
    await expect(dlg).toHaveCount(0);

    await expect.poll(async () => (await activeHunter(player)).guild?.goldCut ?? null).toBe(0.1);
    await go(player, 'status');
    await expect(player.locator('#view-status [data-guild-line]')).toHaveText(guildSheetLine({ rank: 'E', guild: { archetype: 'ironwake', standing: 'core', goldCut: 0.1 } }, RULES));
  });

  await test.step('Rules page shows own guild table plus compact archetype summary cleanly at 390px and 360px', async () => {
    await gm.evaluate(() => hunterApp.store.update((d: any) => {
      d.rulesOverrides = { ...d.rulesOverrides, guilds: { baseGoldCut: 0.24 } };
    }, 'gm-rules'));
    await expect.poll(() => player.evaluate(() => hunterApp.rules().guilds.baseGoldCut)).toBe(0.24);

    await go(player, 'rules');
    const sec = player.locator('#rr-guilds');
    await expect(sec).toBeVisible();
    for (const line of guildLines(rulesOf({ guilds: { baseGoldCut: 0.24 } }))) {
      await expect(sec).toContainText(line);
    }
    await expect(sec.locator('h3').first()).toContainText('Ironwake');
    await expect(sec).toContainText(GUILD_TABLE_PERKS.ironwake.summary);
    await expect(sec).toContainText('Lantern Company');
    await expect(sec).toContainText('Ninth Hour');
    await expect(sec).toContainText('Redline');

    // Phone layout proof at 390px and 360px: zero horizontal page overflow
    for (const width of [390, 360]) {
      await player.setViewportSize({ width, height: 844 });
      await sec.scrollIntoViewIfNeeded();
      const overflow = await player.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(1);
    }
  });
});
