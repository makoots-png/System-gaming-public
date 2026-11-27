// PR C browser test: Hemomancer Blood Extraction into Crimson Vessels, Classes panel display,
// GM Adjust roll on blood extraction, mythic exclusion, and separate bled track from Necromancer shadows.
import type { Page } from '@playwright/test';
import { test, expect, setupGoblinDenGM, go, answerWindow, chooseList, fightRow } from './helpers.ts';
import { ADJUST_HINT } from '../../src/core/combat/roll-adjust.ts';
import { CLASS_UI_WORDS } from '../../src/core/hunter/class-view.ts';
import { bloodExtractDc } from '../../src/core/hunter/blood-vessels.ts';
import { RULES } from '../../src/core/rules.ts';

const combat = (page: Page) => page.locator('#view-combat');
const card = (page: Page) => combat(page).locator('.cmb-card');

test('GM extracts blood after a fight with Adjust roll, fills a Crimson Vessel on the Classes panel, and can remove it', async ({ device }) => {
  const page = (await device('gm')).page;
  await setupGoblinDenGM(page);
  await chooseList(page);

  // Grant Mira Vale awakened Hemomancer and add an E-rank boss (DC 16, power 3) + S-rank mythic (no blood)
  await page.evaluate(() => hunterApp.store.update((d: any) => {
    const mira = d.hunters.find((h: any) => h.name === 'Mira Vale');
    const at = new Date().toISOString();
    d.classHolders = {
      registryId: d.classHolders.registryId,
      held: {
        ...d.classHolders.held,
        Hemomancer: { kind: 'local', hunterId: mira.id, name: mira.name, grantId: 'cg-hemo', claimedAt: at },
      },
    };
    mira.classes = {
      ...mira.classes,
      Hemomancer: { unlockedAt: at, nodes: [], registryId: d.classHolders.registryId, grantId: 'cg-hemo' },
    };
    mira.job = 'Hemomancer';
    mira.jobDone = 'Hemomancer';
    d.settings.activeHunterId = mira.id;
    d.monsters.push(
      {
        id: 'm911', name: 'Bloodfang Alpha', rank: 'E', type: '', archetype: 'brute', kind: 'boss',
        tweak: {}, abilities: [], notes: [], xp: 100, extractable: true, desc: '', statuses: [], loot: { gold: 0, items: [] },
      },
      {
        id: 'm912', name: 'Void Monarch', rank: 'S', type: '', archetype: 'brute', kind: 'mythic',
        tweak: {}, abilities: [], notes: [], xp: 500, extractable: false, desc: '', statuses: [], loot: { gold: 0, items: [] },
      },
    );
  }, 'test-setup'));

  const baseSheet = await page.evaluate(() => {
    const h = hunterApp.store.active();
    const s = hunterApp.api.hunter.sheet(h);
    return { pow: s.stats.pow, resistPenFlat: s.sheet.resistPenFlat, haste: s.sheet.haste, drain: s.sheet.drain, vitBonus: s.checks.bonus.vit };
  });

  // Start a fight with Mira, Bloodfang Alpha, and Void Monarch; defeat both monsters while running
  await go(page, 'bestiary');
  await page.locator('#view-bestiary [data-addc="m911"]').tap();
  await page.locator('#view-bestiary [data-addc="m912"]').tap();
  await go(page, 'combat');
  await combat(page).locator('[data-hsel]').selectOption({ label: 'Mira Vale' });
  await combat(page).locator('[data-addh]').tap();
  await combat(page).locator('[data-start]').tap();
  await expect(combat(page).locator('.cmb-row.cur')).toHaveCount(1);

  await combat(page).locator('.cmb-pick', { hasText: 'Bloodfang Alpha' }).tap();
  await card(page).locator('[data-defeat]').tap();

  await test.step('blood extraction is unavailable while the fight is running, and mythic corpses yield no blood even after it ends', async () => {
    // Void Monarch is still alive, so the fight is still running -> Extract blood must not appear
    await combat(page).locator('.cmb-pick', { hasText: 'Bloodfang Alpha' }).tap();
    await expect(card(page).locator('[data-extract-blood]')).toHaveCount(0);

    // Defeating the last monster (Void Monarch) ends the fight automatically, keeping corpses on screen for extraction
    await combat(page).locator('.cmb-pick', { hasText: 'Void Monarch' }).tap();
    await card(page).locator('[data-defeat]').tap();
    await expect.poll(() => page.evaluate(() => hunterApp.store.get().fight?.phase)).toBe('ended');

    // Mythic monster never shows Extract blood or Extract shadow even after the fight ends
    await combat(page).locator('.cmb-pick', { hasText: 'Void Monarch' }).tap();
    await expect(card(page).locator('[data-extract-blood]')).toHaveCount(0);
    await expect(card(page).locator('[data-extract]')).toHaveCount(0);
  });

  const alphaId: string = (await fightRow(page, 'Bloodfang Alpha')).id;

  await test.step('GM sets Adjust roll, edits inline in Blood Extraction modal, passes a Vitality check, and logs to fight and dice logs', async () => {
    await combat(page).locator(`[data-pick="${alphaId}"]`).tap();
    const bloodBtn = card(page).locator('[data-extract-blood]');
    await expect(bloodBtn).toHaveText('Extract blood');
    await expect(card(page).locator('[data-extract]')).toHaveCount(0);

    // Set +2 on the corpse card with the new GM Adjust roll controls (Adjust by N / Force natural 20 / Force natural 1)
    const box = card(page).locator('[data-adjust-box]');
    await expect(box).toContainText('Adjust next roll on Bloodfang Alpha');
    await expect(card(page).locator('.cmb-adj .cmb-hint')).toHaveText(ADJUST_HINT);
    await expect(box.getByRole('button', { name: 'Adjust by N' })).toHaveAttribute('aria-pressed', 'true');
    await expect(box.getByRole('button', { name: 'Force natural 20' })).toHaveAttribute('aria-pressed', 'false');
    await expect(box.getByRole('button', { name: 'Force natural 1' })).toHaveAttribute('aria-pressed', 'false');
    const up = box.getByRole('button', { name: 'Raise roll adjustment on Bloodfang Alpha' });
    await up.tap();
    await up.tap();
    await expect(box.locator('[data-adjust-input]')).toHaveValue('2');
    await expect(box.locator('.cmb-fdot')).toHaveCount(1);

    // Open Blood Extraction modal and bump adjustment inline from +2 to +6
    await bloodBtn.tap();
    const dlg = page.locator('.sys-overlay.show', { hasText: 'Blood Extraction' });
    await expect(dlg).toBeVisible();
    const dc = bloodExtractDc('E', 'boss', RULES);
    await expect(dlg).toContainText('Target: Bloodfang Alpha (E-rank boss).');
    await expect(dlg).toContainText(`DC ${dc}`);
    await expect(dlg).toContainText('Vitality check');
    await expect(dlg).toContainText('1 attempt per corpse');
    await expect(dlg.getByRole('button', { name: 'Adjust by N' })).toHaveAttribute('aria-pressed', 'true');
    await expect(dlg.getByRole('button', { name: 'Force natural 20' })).toHaveAttribute('aria-pressed', 'false');
    await expect(dlg.getByRole('button', { name: 'Force natural 1' })).toHaveAttribute('aria-pressed', 'false');
    await expect(dlg.locator('[data-adj-in]')).toHaveValue('2');
    await expect(dlg.locator('[data-adj-line]')).toHaveText('GM adjustment: +2');

    const modalUp = dlg.getByRole('button', { name: 'Raise roll adjustment on Bloodfang Alpha' });
    for (let i = 0; i < 4; i++) await modalUp.tap();
    await expect(dlg.locator('[data-adj-in]')).toHaveValue('6');
    await expect(dlg.locator('[data-adj-line]')).toHaveText('GM adjustment: +6');

    // Pick natural face that fails at +0 (dc - 4) and passes with +6 GM adjustment (dc + 2)
    const natural = Math.max(2, Math.min(19, dc - baseSheet.vitBonus - 4));
    const plainTotal = natural + baseSheet.vitBonus;
    const expectedTotal = plainTotal + 6;
    expect(plainTotal, 'natural roll fails without GM adjustment').toBeLessThan(dc);
    expect(expectedTotal, 'adjusted roll passes DC').toBeGreaterThanOrEqual(dc);

    await page.evaluate(f => { Math.random = () => (f - 0.5) / 20; }, natural);
    await dlg.getByRole('button', { name: 'Extract blood' }).tap();
    await expect(page.locator('.sys-overlay.show')).toHaveCount(0);

    // GM fight log shows the blood extraction and GM modifier; player-safe table log strips it; bled is set, adjust clears, button disappears
    const logTop = (await combat(page).locator('[data-log] li').first().textContent()) ?? '';
    expect(logTop).toContain('Mira Vale drains blood from Bloodfang Alpha for a Crimson Vessel');
    expect(logTop).toContain(`+ 6 GM = ${expectedTotal} vs DC ${dc}`);
    const logTable = await page.evaluate(() => hunterApp.store.get().fight?.log?.[0]?.table ?? '');
    expect(logTable).toMatch(/^R\d+: Mira Vale drains blood from Bloodfang Alpha for a Crimson Vessel\.$/);
    expect(logTable).not.toMatch(/GM|\+ 6|forced/i);
    const rowAfter = await fightRow(page, 'Bloodfang Alpha');
    expect(rowAfter.bled).toBe(true);
    expect(rowAfter.adjust).toBeUndefined();
    expect(rowAfter.force).toBeUndefined();
    await expect(card(page).locator('[data-extract-blood]')).toHaveCount(0);
    await expect(card(page).locator('[data-adjust-input]')).toHaveValue('0');
    await expect(card(page).locator('[data-adjust-box] .cmb-fdot')).toHaveCount(0);

    // Dice roll log stays plain with no GM tag or hidden adjustment
    await go(page, 'dice');
    const firstRoll = page.locator('#view-dice [data-hist] li').first();
    await expect(firstRoll).toContainText('Extract blood: Bloodfang Alpha');
    await expect(firstRoll).toContainText(`[${natural}] = ${plainTotal}`);
    await expect(firstRoll).not.toContainText('GM');
    await expect(firstRoll).not.toContainText('forced');
  });

  await test.step('Classes panel shows Crimson Vessels (1 / 3), active bonuses on sheet, and supports removing a vessel', async () => {
    await go(page, 'status');
    const vesselsBox = page.locator('#view-status [data-panel="classes"] [data-cls-vessels]');
    await expect(vesselsBox).toBeVisible();
    await expect(vesselsBox).toContainText(CLASS_UI_WORDS.vesselsHeading(1, 3));
    await expect(vesselsBox).toContainText(CLASS_UI_WORDS.vesselsHint('Hemomancer'));
    await expect(vesselsBox.locator('[data-cls-vessels-bonus]')).toContainText('+1 Power, +1 Flat magic penetration, +1 Ability haste (power 3).');
    const item = vesselsBox.locator('[data-cls-vessel="0"]');
    await expect(item).toContainText('Bloodfang Alpha');
    await expect(item).toContainText('boss');
    await expect(item).toContainText('Power 3');

    // Live hunterSheet gains +1 pow, +1 resistPenFlat, +1 haste with zero added drain
    const afterSheet = await page.evaluate(() => {
      const h = hunterApp.store.active();
      const s = hunterApp.api.hunter.sheet(h);
      return { pow: s.stats.pow, resistPenFlat: s.sheet.resistPenFlat, haste: s.sheet.haste, drain: s.sheet.drain };
    });
    expect(afterSheet.pow).toBe(baseSheet.pow + 1);
    expect(afterSheet.resistPenFlat).toBe(baseSheet.resistPenFlat + 1);
    expect(afterSheet.haste).toBe(baseSheet.haste + 1);
    expect(afterSheet.drain).toBeCloseTo(baseSheet.drain, 6);

    // Removing the vessel clears the slot and returns to empty copy
    await item.locator('[data-cls-vessel-del="0"]').tap();
    const confirmWin = page.locator('.sys-overlay.show', { hasText: CLASS_UI_WORDS.vesselRemoveTitle });
    await expect(confirmWin).toBeVisible();
    await confirmWin.getByRole('button', { name: CLASS_UI_WORDS.vesselRemoveConfirm }).tap();
    await expect(confirmWin).toHaveCount(0);

    await expect(vesselsBox).toContainText(CLASS_UI_WORDS.vesselsHeading(0, 3));
    await expect(vesselsBox.locator('[data-cls-vessels-empty]')).toHaveText(CLASS_UI_WORDS.vesselsEmpty);
  });
});

test('blood extraction nat-1 failure marks bled without crumbling the corpse for a party Necromancer', async ({ device }) => {
  const page = (await device('gm-shared')).page;
  await setupGoblinDenGM(page);
  await chooseList(page);

  await page.evaluate(() => hunterApp.store.update((d: any) => {
    const mira = d.hunters.find((h: any) => h.name === 'Mira Vale');
    const brakk = d.hunters.find((h: any) => h.name === 'Brakk Ironhide');
    const at = new Date().toISOString();
    d.classHolders = {
      registryId: d.classHolders.registryId,
      held: {
        ...d.classHolders.held,
        Hemomancer: { kind: 'local', hunterId: mira.id, name: mira.name, grantId: 'cg-hemo2', claimedAt: at },
        Necromancer: { kind: 'local', hunterId: brakk.id, name: brakk.name, grantId: 'cg-necro2', claimedAt: at },
      },
    };
    mira.classes = { ...mira.classes, Hemomancer: { unlockedAt: at, nodes: [], registryId: d.classHolders.registryId, grantId: 'cg-hemo2' } };
    mira.job = 'Hemomancer';
    mira.jobDone = 'Hemomancer';
    brakk.classes = { ...brakk.classes, Necromancer: { unlockedAt: at, nodes: [], registryId: d.classHolders.registryId, grantId: 'cg-necro2' } };
    brakk.job = 'Necromancer';
    brakk.jobDone = 'Necromancer';
    d.monsters.push({
      id: 'm913', name: 'Crimson Knight', rank: 'E', type: '', archetype: 'brute', kind: 'elite',
      tweak: {}, abilities: [], notes: [], xp: 80, extractable: true, desc: '', statuses: [], loot: { gold: 0, items: [] },
    });
  }, 'test-setup'));

  await go(page, 'bestiary');
  await page.locator('#view-bestiary [data-addc="m913"]').tap();
  await go(page, 'combat');
  await combat(page).locator('[data-hsel]').selectOption({ label: 'Mira Vale' });
  await combat(page).locator('[data-addh]').tap();
  await combat(page).locator('[data-hsel]').selectOption({ label: 'Brakk Ironhide' });
  await combat(page).locator('[data-addh]').tap();
  await combat(page).locator('[data-start]').tap();

  await combat(page).locator('.cmb-pick', { hasText: 'Crimson Knight' }).tap();
  await card(page).locator('[data-defeat]').tap();
  await expect.poll(() => page.evaluate(() => hunterApp.store.get().fight?.phase)).toBe('ended');

  await combat(page).locator('.cmb-pick', { hasText: 'Crimson Knight' }).tap();
  await expect(card(page).locator('[data-extract]')).toHaveText('Extract shadow');
  await expect(card(page).locator('[data-extract-blood]')).toHaveText('Extract blood');

  // Blood extraction rolls a natural 1 -> fails and marks bled, but never touches Necromancer's extraction track
  await card(page).locator('[data-extract-blood]').tap();
  const bloodDlg = page.locator('.sys-overlay.show', { hasText: 'Blood Extraction' });
  await expect(bloodDlg).toBeVisible();
  await page.evaluate(() => { Math.random = () => 0.01; });
  await bloodDlg.getByRole('button', { name: 'Extract blood' }).tap();
  const failWarn = page.locator('.sys-overlay.show', { hasText: 'Blood extraction failed' });
  await expect(failWarn).toBeVisible();
  await expect(failWarn).toContainText('Natural 1. No blood was extracted from this corpse.');
  await failWarn.locator('button').first().tap();
  await expect(failWarn).toHaveCount(0);

  await expect(card(page).locator('[data-extract-blood]')).toHaveCount(0);
  await expect(card(page).locator('[data-extract]')).toHaveText('Extract shadow');

  // Necromancer still extracts Crimson Knight cleanly on a natural 20
  await card(page).locator('[data-extract]').tap();
  const shadowDlg = page.locator('.sys-overlay.show', { hasText: 'Shadow Extraction' });
  await expect(shadowDlg).toBeVisible();
  await page.evaluate(() => { Math.random = () => 0.99; });
  await shadowDlg.getByRole('button', { name: 'Extract shadow' }).tap();
  await answerWindow(page, 'ARISE', 'Arise');

  const brakkShadows = await page.evaluate(() => hunterApp.store.get().hunters.find((h: any) => h.name === 'Brakk Ironhide').shadows.map((s: any) => s.name));
  expect(brakkShadows).toContain('Crimson Knight');
});
