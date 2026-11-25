// Browser tests for variable Grievous Wounds: Skill maker 90% cap and round-trip, legacy 95% clamp, non-Grievous shareCap guard, GM Rules editor row, and room sync.
import { test, expect, onboardGM, onboardPlayer, createRoom, go } from './helpers.ts';

async function openGmRules(page: import('@playwright/test').Page) {
  await go(page, 'gm');
  const tog = page.locator('.gm-sec[data-sec="rules"] [data-tog="rules"]');
  await tog.scrollIntoViewIfNeeded();
  if ((await tog.getAttribute('aria-expanded')) !== 'true') await tog.tap();
}

test('GM sets Grievous Wounds up to 90% in the Skill maker (refusing 91%), sees legacy 95% clamped to 90%, and non-Grievous stays on shareCap', async ({ device }) => {
  const page = (await device('gm')).page;
  await onboardGM(page);

  await test.step('create an active skill applying Grievous Wounds at 90% (default 50% share cap) and refuse 91%', async () => {
    await go(page, 'gm');
    await page.locator('#gm-make [data-make="skill"]').tap();
    const dlg = page.locator('.skm-overlay [role=dialog]');
    await expect(dlg).toBeVisible();
    await dlg.locator('#skm-name').fill('Sever');
    await dlg.locator('[data-quick] [data-q="apply"]').tap();
    await dlg.locator('[data-row="0"] [data-f="status"]').selectOption('grievous');

    const cutInput = dlg.locator('[data-row="0"] [data-f="gwCut"]');
    await expect(cutInput).toBeVisible();
    await expect(cutInput).toHaveValue('');
    await expect(cutInput).toHaveAttribute('placeholder', '40');
    await expect(cutInput).toHaveAttribute('max', '90');
    await expect(dlg.locator('.mk-preview')).toContainText('Healing received −40%');

    // Above 90% is refused
    const errEl = dlg.locator('[data-active-fx] [data-row="0"] [data-err]');
    await cutInput.fill('91');
    await expect(errEl).toContainText('Healing cut must be a whole number from 1 to 90.');

    // 90% is accepted even under default 50% shareCap
    await cutInput.fill('90');
    await expect(errEl).toHaveText('');
    await expect(dlg.locator('.mk-preview')).toContainText('Healing received −90%');

    await dlg.locator('[data-apply]').tap();
    await expect(dlg).toHaveCount(0);

    const saved = await page.evaluate(() => hunterApp.store.get().library.skills.find((k: any) => k.name === 'Sever'));
    expect(saved?.type).toBe('active');
    const op = saved.ability.ops[0];
    expect(op.op).toBe('applyStatus');
    expect(op.key).toBe('grievous');
    expect(op.def.ops).toEqual([{ op: 'share', on: 'healed', pct: -90 }]);
    expect(op.def.desc).toBe('Receives less healing.');
  });

  await test.step('re-open the saved skill from the Workshop and confirm 90% round-trips and empty inherits default', async () => {
    await go(page, 'workshop');
    const row = page.locator('#view-workshop [data-ws="skill"] li', { hasText: 'Sever' });
    await expect(row).toBeVisible();
    await row.locator('[data-act="edit"]').tap();
    const dlg = page.locator('.skm-overlay [role=dialog]');
    await expect(dlg).toBeVisible();
    const cutInput = dlg.locator('[data-row="0"] [data-f="gwCut"]');
    await expect(cutInput).toHaveValue('90');
    await expect(cutInput).toHaveAttribute('placeholder', '40');
    await expect(dlg.locator('.mk-preview')).toContainText('Healing received −90%');

    await cutInput.fill('');
    await expect(dlg.locator('.mk-preview')).toContainText('Healing received −40%');
    await dlg.locator('[data-cancel]').tap();
    await expect(dlg).toHaveCount(0);
  });

  await test.step('legacy stored 95% Grievous Wounds opens clamped to 90%, and non-Grievous custom status still enforces shareCap (50%)', async () => {
    await page.evaluate(() => {
      const s = hunterApp.store.get();
      const orig = s.library.skills.find((k: any) => k.name === 'Sever');
      const legacy = JSON.parse(JSON.stringify(orig));
      legacy.id = 'sk-legacy95';
      legacy.name = 'Legacy 95';
      legacy.ability.id = 'ab-legacy95';
      legacy.ability.name = 'Legacy 95';
      legacy.ability.ops[0].def.ops[0].pct = -95;

      const blightDef = { label: 'Blight', desc: 'Cuts healing.', ops: [{ op: 'share', on: 'healed', pct: -30 }] };
      const over = JSON.parse(JSON.stringify(orig));
      over.id = 'sk-overcap';
      over.name = 'Overcap Blight';
      over.ability.id = 'ab-overcap';
      over.ability.name = 'Overcap Blight';
      over.ability.ops[0].key = 'blight';
      over.ability.ops[0].def = { ...blightDef, ops: [{ op: 'share', on: 'healed', pct: -100 }] };

      const frac = JSON.parse(JSON.stringify(orig));
      frac.id = 'sk-fracgw';
      frac.name = 'Fractional Sever';
      frac.ability.id = 'ab-fracgw';
      frac.ability.name = 'Fractional Sever';
      frac.ability.ops[0].def.ops[0].pct = -12.5;

      hunterApp.store.update((cur: any) => {
        cur.library.statuses.blight = blightDef;
        cur.library.skills.push(legacy, over, frac);
      });
    });

    await go(page, 'workshop');
    // Legacy 95% Grievous loads clamped to 90%
    const legRow = page.locator('#view-workshop [data-ws="skill"] li', { hasText: 'Legacy 95' });
    await expect(legRow).toBeVisible();
    await legRow.locator('[data-act="edit"]').tap();
    const legDlg = page.locator('.skm-overlay [role=dialog]');
    await expect(legDlg.locator('[data-row="0"] [data-f="gwCut"]')).toHaveValue('90');
    await legDlg.locator('[data-cancel]').tap();
    await expect(legDlg).toHaveCount(0);

    // Saved fractional Grievous cut (-12.5%) stays valid while untouched
    const fracRow = page.locator('#view-workshop [data-ws="skill"] li', { hasText: 'Fractional Sever' });
    await expect(fracRow).toBeVisible();
    await fracRow.locator('[data-act="edit"]').tap();
    const fracDlg = page.locator('.skm-overlay [role=dialog]');
    await expect(fracDlg.locator('[data-row="0"] [data-f="gwCut"]')).toHaveValue('12.5');
    await expect(fracDlg.locator('[data-active-fx] [data-row="0"] [data-err]')).toHaveText('');
    await fracDlg.locator('[data-cancel]').tap();
    await expect(fracDlg).toHaveCount(0);

    // Non-Grievous Blight at 100% can lower to 95% (preserving 91..100), refuses raising past 100 with share cap message, and clearing restores 30%
    const row = page.locator('#view-workshop [data-ws="skill"] li', { hasText: 'Overcap Blight' });
    await expect(row).toBeVisible();
    await row.locator('[data-act="edit"]').tap();
    const dlg = page.locator('.skm-overlay [role=dialog]');
    await expect(dlg).toBeVisible();
    const cutInput = dlg.locator('[data-row="0"] [data-f="gwCut"]');
    const errEl = dlg.locator('[data-active-fx] [data-row="0"] [data-err]');
    await expect(cutInput).toHaveValue('100');
    await expect(cutInput).toHaveAttribute('placeholder', '30');
    await expect(errEl).toHaveText('');

    await cutInput.fill('105');
    await expect(errEl).toContainText('share cap');

    await cutInput.fill('95');
    await expect(errEl).toHaveText('');
    await dlg.locator('#skm-name').fill('Overcap Blight II');
    await dlg.locator('[data-apply]').tap();
    await expect(dlg).toHaveCount(0);
    const keptPct = await page.evaluate(() => hunterApp.store.get().library.skills.find((k: any) => k.name === 'Overcap Blight II')?.ability?.ops?.[0]?.def?.ops?.[0]?.pct);
    expect(keptPct).toBe(-95);

    const row2 = page.locator('#view-workshop [data-ws="skill"] li', { hasText: 'Overcap Blight II' });
    await row2.locator('[data-act="edit"]').tap();
    const dlg2 = page.locator('.skm-overlay [role=dialog]');
    await dlg2.locator('[data-row="0"] [data-f="gwCut"]').fill('');
    await dlg2.locator('[data-apply]').tap();
    await expect(dlg2).toHaveCount(0);
    const clearedPct = await page.evaluate(() => hunterApp.store.get().library.skills.find((k: any) => k.name === 'Overcap Blight II')?.ability?.ops?.[0]?.def?.ops?.[0]?.pct);
    expect(clearedPct).toBe(-30);
  });
});

test('GM edits built-in Grievous Wounds up to 90% in Rules editor (refusing 91%) and syncs to a player phone', async ({ device }) => {
  const gm = (await device('gm')).page;
  const player = (await device('player')).page;
  await onboardGM(gm);
  const code = await createRoom(gm);
  await onboardPlayer(player, 'Sora', code);

  await openGmRules(gm);
  await expect(gm.locator('#gm-gw')).toContainText('Grievous Wounds');

  const gwRow = gm.locator('[data-gw-row="grievous"]');
  await expect(gwRow.locator('[data-gw-input="grievous"]')).toHaveAttribute('max', '90');

  // Refused above 90%
  await gwRow.locator('[data-gw-input="grievous"]').fill('91');
  await gwRow.locator('[data-gw-apply]').tap();
  await expect(gm.locator('#gm-r-msg')).toContainText('Healing cut must be a whole number from 1 to 90.');

  // 90% is accepted even under default 50% shareCap and syncs to the player phone
  await gwRow.locator('[data-gw-input="grievous"]').fill('90');
  await gwRow.locator('[data-gw-apply]').tap();
  await expect(gwRow).toContainText('Healing received −90%');

  await expect.poll(async () => player.evaluate(() => {
    const R = hunterApp.rules();
    const gwOp = R.conditions.grievous?.ops.find((o: any) => o.op === 'share' && o.on === 'healed');
    return {
      gwPct: gwOp?.pct ?? null,
      gwDesc: R.conditions.grievous?.desc ?? null,
      shareCap: R.fight.kit.shareCap,
    };
  }), { timeout: 15000 }).toEqual({
    gwPct: -90,
    gwDesc: 'Receives less healing.',
    shareCap: 0.5,
  });

  // Workshop changed built-in status row shows −90% (not capped to −50%), and Status Maker enforces −90..100 cleanly
  const errors: string[] = [];
  gm.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
  await go(gm, 'workshop');
  const wsRow = gm.locator('#view-workshop [data-ws="status"] li[data-id="grievous"]');
  await expect(wsRow).toBeVisible();
  await expect(wsRow).toContainText('Healing received −90%');

  await wsRow.locator('[data-act="edit"]').tap();
  const fgDlg = gm.locator('.fg-overlay [role=dialog]');
  await expect(fgDlg).toBeVisible();
  const qInput = fgDlg.locator('[data-row="0"] [data-f="q"]');
  const fgErr = fgDlg.locator('[data-row="0"] [data-err]');
  await expect(qInput).toHaveValue('-90');

  await qInput.fill('-91');
  await expect(fgErr).toContainText('Write a whole number from -90 to 100.');

  await qInput.fill('-85');
  await expect(fgErr).toHaveText('');
  await expect(fgDlg.locator('.mk-preview')).toContainText('Healing received −85%');
  await fgDlg.locator('[data-apply]').tap();
  await expect(fgDlg).toHaveCount(0);
  expect(errors).toEqual([]);
  await expect(wsRow).toContainText('Healing received −85%');

  // Tiered custom grievous disables the flat Rules row instead of reporting a fake edit
  await openGmRules(gm);
  await gm.evaluate(() => {
    hunterApp.store.update((cur: any) => {
      cur.library.statuses.grievous = {
        label: 'Grievous Wounds',
        desc: 'Receives less healing.',
        ops: [{ op: 'share', on: 'healed', pct: [-10, -20, -30, -40, -50, -60] }],
      };
    });
  });
  await expect(gwRow).toContainText('Varies by rank (edit in Status Maker)');
  await expect(gwRow.locator('[data-gw-input="grievous"]')).toBeDisabled();
  await expect(gwRow.locator('[data-gw-apply]')).toBeDisabled();
  await expect(gwRow.locator('[data-gw-reset]')).toBeDisabled();
});
