// Browser tests for GM-editable damage types: Rules editor controls, makers (weapon, consumable, ability), and room sync.
import { mkdir } from 'node:fs/promises';
import { test, expect, onboardGM, onboardPlayer, createRoom, go } from './helpers.ts';

async function openGmRules(page: import('@playwright/test').Page) {
  await go(page, 'gm');
  const tog = page.locator('.gm-sec[data-sec="rules"] [data-tog="rules"]');
  await tog.scrollIntoViewIfNeeded();
  if ((await tog.getAttribute('aria-expanded')) !== 'true') await tog.tap();
}

test('GM edits Poisoned and Arc Bolt damage types in Rules editor, and creates a true-damage weapon and true-damage skill', async ({ device }) => {
  const page = (await device('gm')).page;
  await onboardGM(page);

  await test.step('GM changes Poisoned to Arcane and Arc Bolt to True in Rules editor', async () => {
    await openGmRules(page);
    await expect(page.locator('#gm-dt')).toContainText('Armor reduces physical damage. Resist reduces arcane damage. True damage is not reduced.');
    await expect(page.locator('#gm-dt')).toContainText('Poisoned deals');
    await expect(page.locator('#gm-dt')).toContainText('Executioner deals');
    await expect(page.locator('#gm-dt')).toContainText('Spellblade deals');
    await expect(page.locator('#gm-dt')).toContainText('Riposte deals');
    const poisonArcane = page.locator('[data-dt-kind="status"][data-dt-key="poisoned"][data-dt-val="arcane"]');
    await poisonArcane.tap();
    await expect(poisonArcane).toHaveAttribute('aria-pressed', 'true');
    const savedStatus = await page.evaluate(() => hunterApp.store.get().library.statuses.poisoned);
    expect(savedStatus.ops.find((o: any) => o.op === 'damage').type).toBe('arcane');

    const execTrue = page.locator('[data-dt-kind="rule"][data-dt-key="keystone-executioner"][data-dt-val="true"]');
    await execTrue.tap();
    await expect(execTrue).toHaveAttribute('aria-pressed', 'true');

    await page.locator('#gm-dt-abilities-fold > summary').tap();
    await page.locator('#gm-dt-q').fill('Arc Bolt');
    const arcTrue = page.locator('[data-dt-kind="rule"][data-dt-key="arc-bolt"][data-dt-val="true"]');
    await arcTrue.tap();
    await expect(arcTrue).toHaveAttribute('aria-pressed', 'true');
    const savedOv = await page.evaluate(() => hunterApp.store.get().rulesOverrides.fight.damageTypes);
    expect(savedOv['arc-bolt']).toBe('true');
    expect(savedOv['keystone-executioner']).toBe('true');
  });

  await test.step('GM creates a true-damage weapon in the Item maker', async () => {
    await page.locator('#gm-make [data-make="item"]').tap();
    const dlg = page.locator('.lf-overlay [role=dialog]');
    await expect(dlg).toBeVisible();
    await dlg.locator('#lf-name').fill('Void Blade');
    await dlg.locator('[data-chips="type"] [data-chip="weapon"]').tap();
    await dlg.locator('#lf-dice').fill('1d8');
    await dlg.locator('[data-chips="dmgtype"] [data-chip="true"]').tap();
    await expect(dlg.locator('.mk-preview')).toContainText('Weapon attack: 1d8 + phys.');
    await expect(dlg.locator('.mk-preview')).toContainText('True damage');
    await dlg.locator('[data-apply]').tap();
    await expect(dlg).toHaveCount(0);
    const savedItem = await page.evaluate(() => (Object.values(hunterApp.store.get().library.items) as any[]).find(x => x.name === 'Void Blade'));
    expect(savedItem.damageType).toBe('true');
  });

  await test.step('GM creates a true-damage active skill in the Skill maker', async () => {
    await page.locator('#gm-make [data-make="skill"]').tap();
    const dlg = page.locator('.skm-overlay [role=dialog]');
    await expect(dlg).toBeVisible();
    await dlg.locator('#skm-name').fill('True Cleave');
    await dlg.locator('[data-chips="ftype"] [data-chip="true"]').tap();
    await expect(dlg.locator('[data-formula-avg]')).toContainText('Ignores Armor and Resist');
    await dlg.locator('[data-apply]').tap();
    await expect(dlg).toHaveCount(0);
    const savedSkill = await page.evaluate(() => hunterApp.store.get().library.skills.find((x: any) => x.name === 'True Cleave'));
    expect(savedSkill.ability.effect.type).toBe('true');
  });
});

test('GM damage-type overrides for Poisoned and Arc Bolt reach a player phone in the same room', async ({ device }) => {
  const gm = (await device('gm')).page;
  const player = (await device('player')).page;
  await onboardGM(gm);
  const code = await createRoom(gm);
  await onboardPlayer(player, 'Sora', code);

  // GM sets Poisoned -> arcane and Arc Bolt -> true
  await openGmRules(gm);
  await gm.locator('[data-dt-kind="status"][data-dt-key="poisoned"][data-dt-val="arcane"]').tap();
  await gm.locator('#gm-dt-abilities-fold > summary').tap();
  await gm.locator('#gm-dt-q').fill('Arc Bolt');
  await gm.locator('[data-dt-kind="rule"][data-dt-key="arc-bolt"][data-dt-val="true"]').tap();

  // Player phone receives RoomRules with both overrides
  await expect.poll(async () => player.evaluate(() => {
    const R = hunterApp.rules();
    const pOp = R.conditions.poisoned?.ops.find((o: any) => o.op === 'damage');
    return { poisoned: pOp?.type ?? null, arcBolt: R.fight.damageTypes['arc-bolt'] ?? null };
  }), { timeout: 15000 }).toEqual({ poisoned: 'arcane', arcBolt: 'true' });
});

test('damage-type controls fit 360 px and 390 px viewports with no horizontal scroll and 44 px targets', async ({ device }) => {
  const shotDir = process.env.E2E_SHOT_DIR || '';
  if (shotDir) await mkdir(shotDir, { recursive: true });

  for (const viewport of [{ width: 360, height: 844 }, { width: 390, height: 844 }]) {
    const tag = `${viewport.width}`;
    const page = (await device(`gm-${tag}`, { viewport })).page;
    await onboardGM(page);
    await openGmRules(page);
    await page.locator('#gm-dt').evaluate(el => el.scrollIntoView({ block: 'start' }));
    if (shotDir) await page.screenshot({ path: `${shotDir}/gm-rules-dt-top-${tag}.png` });
    await page.locator('#gm-dt-attacks-fold > summary').tap();
    await page.locator('#gm-dt-abilities-fold > summary').tap();
    await page.locator('#gm-dt-q').fill('Arc Bolt');

    const rulesMetrics = await page.evaluate(() => {
      const buttons = [...document.querySelectorAll('#gm-dt .gm-dt-seg button')].map(b => {
        const r = b.getBoundingClientRect();
        return { text: (b.textContent ?? '').trim(), x: r.x, right: r.right, height: r.height, width: r.width };
      });
      return { innerWidth: window.innerWidth, scrollWidth: document.scrollingElement!.scrollWidth, buttons };
    });
    expect(rulesMetrics.scrollWidth, `no horizontal page scroll at ${tag}px`).toBeLessThanOrEqual(rulesMetrics.innerWidth);
    expect(rulesMetrics.buttons.length).toBeGreaterThanOrEqual(18);
    for (const b of rulesMetrics.buttons) {
      expect(b.height, `${b.text} is at least 44px tall at ${tag}px`).toBeGreaterThanOrEqual(44);
      expect(b.x, `${b.text} starts inside viewport at ${tag}px`).toBeGreaterThanOrEqual(0);
      expect(b.right, `${b.text} fits inside viewport at ${tag}px`).toBeLessThanOrEqual(rulesMetrics.innerWidth + 1);
    }
    await page.locator('#gm-dt-attacks-fold').evaluate(el => el.scrollIntoView({ block: 'start' }));
    if (shotDir) await page.screenshot({ path: `${shotDir}/gm-rules-dt-folds-${tag}.png` });

    // Item maker weapon damage type chips
    await page.locator('#gm-make [data-make="item"]').scrollIntoViewIfNeeded();
    await page.locator('#gm-make [data-make="item"]').tap();
    const itemDlg = page.locator('.lf-overlay [role=dialog]');
    await expect(itemDlg).toBeVisible();
    await page.waitForTimeout(300);
    await itemDlg.locator('[data-chips="type"] [data-chip="weapon"]').tap();
    await itemDlg.locator('[data-chips="dmgtype"] [data-chip="true"]').tap();
    await itemDlg.locator('[data-chips="dmgtype"]').scrollIntoViewIfNeeded();
    if (shotDir) await page.screenshot({ path: `${shotDir}/item-maker-dt-${tag}.png` });
    const itemMetrics = await page.evaluate(() => {
      const dlg = document.querySelector('.lf-overlay [role=dialog]') as HTMLElement;
      const dr = dlg.getBoundingClientRect();
      const buttons = [...dlg.querySelectorAll('[data-chips="dmgtype"] button')].map(b => {
        const r = b.getBoundingClientRect();
        return { text: (b.textContent ?? '').trim(), x: r.x, right: r.right, height: r.height };
      });
      return { innerWidth: window.innerWidth, scrollWidth: document.scrollingElement!.scrollWidth, dlgRight: dr.right, buttons };
    });
    expect(itemMetrics.scrollWidth, `no page horizontal scroll in item maker at ${tag}px`).toBeLessThanOrEqual(itemMetrics.innerWidth);
    for (const b of itemMetrics.buttons) {
      expect(b.height, `item chip ${b.text} is at least 44px tall at ${tag}px`).toBeGreaterThanOrEqual(44);
      expect(b.right, `item chip ${b.text} fits inside item maker at ${tag}px`).toBeLessThanOrEqual(itemMetrics.dlgRight + 1);
      expect(b.right, `item chip ${b.text} fits inside viewport at ${tag}px`).toBeLessThanOrEqual(itemMetrics.innerWidth + 1);
    }
    await itemDlg.locator('[data-cancel]').tap();
    await expect(itemDlg).toHaveCount(0);

    // Skill maker damage type chips
    await page.locator('#gm-make [data-make="skill"]').scrollIntoViewIfNeeded();
    await page.locator('#gm-make [data-make="skill"]').tap();
    const skillDlg = page.locator('.skm-overlay [role=dialog]');
    await expect(skillDlg).toBeVisible();
    await page.waitForTimeout(300);
    await skillDlg.locator('[data-chips="ftype"] [data-chip="true"]').scrollIntoViewIfNeeded();
    await skillDlg.locator('[data-chips="ftype"] [data-chip="true"]').tap();
    await page.waitForTimeout(300);
    if (shotDir) await page.screenshot({ path: `${shotDir}/skill-maker-dt-${tag}.png` });
    const skillMetrics = await page.evaluate(() => {
      const dlg = document.querySelector('.skm-overlay [role=dialog]') as HTMLElement;
      const dr = dlg.getBoundingClientRect();
      const buttons = [...dlg.querySelectorAll('[data-chips="ftype"] button')].map(b => {
        const r = b.getBoundingClientRect();
        return { text: (b.textContent ?? '').trim(), x: r.x, right: r.right, height: r.height };
      });
      return { innerWidth: window.innerWidth, scrollWidth: document.scrollingElement!.scrollWidth, dlgRight: dr.right, buttons };
    });
    expect(skillMetrics.scrollWidth, `no page horizontal scroll in skill maker at ${tag}px`).toBeLessThanOrEqual(skillMetrics.innerWidth);
    for (const b of skillMetrics.buttons) {
      expect(b.height, `skill chip ${b.text} is at least 44px tall at ${tag}px`).toBeGreaterThanOrEqual(44);
      expect(b.right, `skill chip ${b.text} fits inside skill maker at ${tag}px`).toBeLessThanOrEqual(skillMetrics.dlgRight + 1);
      expect(b.right, `skill chip ${b.text} fits inside viewport at ${tag}px`).toBeLessThanOrEqual(skillMetrics.innerWidth + 1);
    }
    await skillDlg.locator('[data-cancel]').tap();
    await expect(skillDlg).toHaveCount(0);
  }
});
