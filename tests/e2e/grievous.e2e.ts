// Browser tests for variable Grievous Wounds: Skill maker edit and round-trip, shareCap guard, GM Rules editor row, and room sync.
import { test, expect, onboardGM, onboardPlayer, createRoom, go } from './helpers.ts';

async function openGmRules(page: import('@playwright/test').Page) {
  await go(page, 'gm');
  const tog = page.locator('.gm-sec[data-sec="rules"] [data-tog="rules"]');
  await tog.scrollIntoViewIfNeeded();
  if ((await tog.getAttribute('aria-expanded')) !== 'true') await tog.tap();
}

test('GM sets a custom Grievous Wounds healing cut in the Skill maker, sees the share cap enforced, and re-opens it cleanly from the Workshop', async ({ device }) => {
  const page = (await device('gm')).page;
  await onboardGM(page);

  await test.step('create an active skill applying Grievous Wounds at 25% (default 50% share cap)', async () => {
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
    await expect(dlg.locator('.mk-preview')).toContainText('Healing received −40%');

    // Above default shareCap (50%) is refused with a message naming the share cap
    const errEl = dlg.locator('[data-active-fx] [data-row="0"] [data-err]');
    await cutInput.fill('70');
    await expect(errEl).toContainText('share cap');

    await cutInput.fill('25');
    await expect(errEl).toHaveText('');
    await expect(dlg.locator('.mk-preview')).toContainText('Healing received −25%');

    await dlg.locator('[data-apply]').tap();
    await expect(dlg).toHaveCount(0);

    const saved = await page.evaluate(() => hunterApp.store.get().library.skills.find((k: any) => k.name === 'Sever'));
    expect(saved?.type).toBe('active');
    const op = saved.ability.ops[0];
    expect(op.op).toBe('applyStatus');
    expect(op.key).toBe('grievous');
    expect(op.def.ops).toEqual([{ op: 'share', on: 'healed', pct: -25 }]);
    expect(op.def.desc).toBe('Receives less healing.');
  });

  await test.step('re-open the saved skill from the Workshop and confirm 25% round-trips and empty inherits default', async () => {
    await go(page, 'workshop');
    const row = page.locator('#view-workshop [data-ws="skill"] li', { hasText: 'Sever' });
    await expect(row).toBeVisible();
    await row.locator('[data-act="edit"]').tap();
    const dlg = page.locator('.skm-overlay [role=dialog]');
    await expect(dlg).toBeVisible();
    const cutInput = dlg.locator('[data-row="0"] [data-f="gwCut"]');
    await expect(cutInput).toHaveValue('25');
    await expect(cutInput).toHaveAttribute('placeholder', '40');
    await expect(dlg.locator('.mk-preview')).toContainText('Healing received −25%');

    await cutInput.fill('');
    await expect(dlg.locator('.mk-preview')).toContainText('Healing received −40%');
    await dlg.locator('[data-cancel]').tap();
    await expect(dlg).toHaveCount(0);
  });

  await test.step('over-cap stored cut (60%) can be re-saved unchanged, refuses raising, and clearing restores library default', async () => {
    await page.evaluate(() => {
      const s = hunterApp.store.get();
      const orig = s.library.skills.find((k: any) => k.name === 'Sever');
      const over = JSON.parse(JSON.stringify(orig));
      over.id = 'sk-overcap';
      over.name = 'Overcap Sever';
      over.ability.id = 'ab-overcap';
      over.ability.name = 'Overcap Sever';
      over.ability.ops[0].def.ops[0].pct = -60;
      hunterApp.store.update((cur: any) => { cur.library.skills.push(over); });
    });
    await go(page, 'workshop');
    const row = page.locator('#view-workshop [data-ws="skill"] li', { hasText: 'Overcap Sever' });
    await expect(row).toBeVisible();
    await row.locator('[data-act="edit"]').tap();
    const dlg = page.locator('.skm-overlay [role=dialog]');
    await expect(dlg).toBeVisible();
    const cutInput = dlg.locator('[data-row="0"] [data-f="gwCut"]');
    const errEl = dlg.locator('[data-active-fx] [data-row="0"] [data-err]');
    await expect(cutInput).toHaveValue('60');
    await expect(cutInput).toHaveAttribute('placeholder', '40');
    await expect(errEl).toHaveText('');

    // Raising past 60 is refused
    await cutInput.fill('65');
    await expect(errEl).toContainText('share cap');

    // Keeping 60 allows saving another edit (name)
    await cutInput.fill('60');
    await expect(errEl).toHaveText('');
    await dlg.locator('#skm-name').fill('Overcap Sever II');
    await dlg.locator('[data-apply]').tap();
    await expect(dlg).toHaveCount(0);
    const keptPct = await page.evaluate(() => hunterApp.store.get().library.skills.find((k: any) => k.name === 'Overcap Sever II')?.ability?.ops?.[0]?.def?.ops?.[0]?.pct);
    expect(keptPct).toBe(-60);

    // Clearing restores the library's 40%
    const row2 = page.locator('#view-workshop [data-ws="skill"] li', { hasText: 'Overcap Sever II' });
    await row2.locator('[data-act="edit"]').tap();
    const dlg2 = page.locator('.skm-overlay [role=dialog]');
    await dlg2.locator('[data-row="0"] [data-f="gwCut"]').fill('');
    await dlg2.locator('[data-apply]').tap();
    await expect(dlg2).toHaveCount(0);
    const clearedPct = await page.evaluate(() => hunterApp.store.get().library.skills.find((k: any) => k.name === 'Overcap Sever II')?.ability?.ops?.[0]?.def?.ops?.[0]?.pct);
    expect(clearedPct).toBe(-40);
  });
});

test('GM edits built-in Grievous Wounds in Rules editor, sees shareCap enforced, and syncs to a player phone', async ({ device }) => {
  const gm = (await device('gm')).page;
  const player = (await device('player')).page;
  await onboardGM(gm);
  const code = await createRoom(gm);
  await onboardPlayer(player, 'Sora', code);

  await openGmRules(gm);
  await expect(gm.locator('#gm-gw')).toContainText('Grievous Wounds');

  const gwRow = gm.locator('[data-gw-row="grievous"]');
  // Refused above default shareCap (50%)
  await gwRow.locator('[data-gw-input="grievous"]').fill('70');
  await gwRow.locator('[data-gw-apply]').tap();
  await expect(gm.locator('#gm-r-msg')).toContainText('share cap');

  // Valid cut (25%) updates the built-in status and syncs to the player phone
  await gwRow.locator('[data-gw-input="grievous"]').fill('25');
  await gwRow.locator('[data-gw-apply]').tap();
  await expect(gwRow).toContainText('Healing received −25%');

  await expect.poll(async () => player.evaluate(() => {
    const R = hunterApp.rules();
    const gwOp = R.conditions.grievous?.ops.find((o: any) => o.op === 'share' && o.on === 'healed');
    return {
      gwPct: gwOp?.pct ?? null,
      gwDesc: R.conditions.grievous?.desc ?? null,
      shareCap: R.fight.kit.shareCap,
    };
  }), { timeout: 15000 }).toEqual({
    gwPct: -25,
    gwDesc: 'Receives less healing.',
    shareCap: 0.5,
  });

  // Tiered custom grievous disables the flat Rules row instead of reporting a fake edit
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
