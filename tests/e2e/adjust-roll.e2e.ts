// PR A browser test: GM "Adjust roll" modifier on shadow extraction and mid-fight Arise.
// Verifies corpse card stepper (persistence across reload, gold dot, helper text), extraction modal inline stepper
// and GM adjustment line, roll log showing the modifier, fight log breakdown, clearing after one roll, and Arise
// ignoring hidden fight fudge while applying Adjust roll.
import type { Page } from '@playwright/test';
import { test, expect, setupGoblinDenGM, go, answerWindow, chooseList, fightRow } from './helpers.ts';
import { RULES } from '../../src/core/rules.ts';
import { abilityId } from '../../src/core/combat/ability-types.ts';
import { tiles } from '../../src/core/combat/space.ts';
import { cost, tick } from '../../src/core/combat/timeline.ts';
import { ADJUST_HINT } from '../../src/core/combat/roll-adjust.ts';

const combat = (page: Page) => page.locator('#view-combat');
const card = (page: Page) => combat(page).locator('.cmb-card');

const ARISE_ABILITY = {
  id: abilityId('arise'),
  name: 'Arise',
  kind: 'support' as const,
  cost: { fatigue: 6, mana: 15, time: cost(RULES.fight.cost.standard), cooldown: tick(RULES.fight.round) },
  aim: 'corpse' as const,
  range: tiles(6),
  shape: { kind: 'touch' as const, reach: tiles(6) },
  delivery: { kind: 'sure' as const },
  foesOnly: false,
  effect: null,
  ops: [],
  channel: null,
  raise: { bonus: 2, maxRisen: 2, elitePerFight: 1 },
};

/** Fixes `crypto.getRandomValues` so `faceOf(20, cryptoRandom)` always draws `d20` (1..20). */
async function fixCryptoD20(page: Page, d20: number): Promise<void> {
  const raw = Math.floor(((d20 - 0.5) / 20) * 0x100000000) >>> 0;
  await page.evaluate(v => {
    Object.defineProperty(crypto, 'getRandomValues', { configurable: true, value: (a: Uint32Array) => a.fill(v) });
  }, raw);
}

test('GM adjusts a shadow extraction roll via the corpse card and modal, reload keeps it, and both fight log and roll log show the modifier', async ({ device }) => {
  const page = (await device('gm')).page;
  await setupGoblinDenGM(page);
  await chooseList(page);

  // Give Mira Vale awakened Necromancer and add a C-rank boss monster so DC is 21 (E hunter vs C boss)
  await page.evaluate(() => hunterApp.store.update((d: any) => {
    const mira = d.hunters.find((h: any) => h.name === 'Mira Vale');
    const at = new Date().toISOString();
    d.classHolders = {
      registryId: d.classHolders.registryId,
      held: { ...d.classHolders.held, Necromancer: { kind: 'local', hunterId: mira.id, name: mira.name, grantId: 'cg-adj', claimedAt: at } },
    };
    mira.classes = { ...mira.classes, Necromancer: { unlockedAt: at, nodes: [], registryId: d.classHolders.registryId, grantId: 'cg-adj' } };
    mira.job = 'Necromancer';
    mira.jobDone = 'Necromancer';
    d.settings.activeHunterId = mira.id;
    d.monsters.push({
      id: 'm901', name: 'Igris the Bloodred', rank: 'C', type: '', archetype: 'brute', kind: 'boss',
      tweak: {}, abilities: [], notes: [], xp: 200, extractable: true, desc: '', statuses: [], loot: { gold: 0, items: [] },
    });
  }, 'test-setup'));

  await go(page, 'bestiary');
  await page.locator('#view-bestiary [data-addc="m901"]').tap();
  await go(page, 'combat');
  await combat(page).locator('[data-hsel]').selectOption({ label: 'Mira Vale' });
  await combat(page).locator('[data-addh]').tap();
  await combat(page).locator('.cmb-pick', { hasText: 'Igris the Bloodred' }).tap();
  await card(page).locator('[data-defeat]').tap();

  const igrisId: string = (await fightRow(page, 'Igris the Bloodred')).id;
  await combat(page).locator(`[data-pick="${igrisId}"]`).tap();

  await test.step('corpse card shows Adjust next roll stepper, helper text, and gold dot while non-zero, and survives reload', async () => {
    const box = card(page).locator('[data-adjust-box]');
    await expect(box).toBeVisible();
    await expect(box).toContainText('Adjust next roll on Igris the Bloodred');
    await expect(card(page).locator('.cmb-adj .cmb-hint')).toHaveText(ADJUST_HINT);
    await expect(box.locator('.cmb-fdot')).toHaveCount(0);

    const up = box.getByRole('button', { name: 'Raise roll adjustment on Igris the Bloodred' });
    await up.tap();
    await up.tap();
    await expect(box.locator('[data-adjust-val]')).toHaveText('+2');
    await expect(box.locator('.cmb-fdot')).toHaveCount(1);

    await page.reload();
    await go(page, 'combat');
    await combat(page).locator(`[data-pick="${igrisId}"]`).tap();
    await expect(card(page).locator('[data-adjust-val]')).toHaveText('+2');
    await expect(card(page).locator('[data-adjust-box] .cmb-fdot')).toHaveCount(1);
  });

  await test.step('extraction modal pre-fills +2, edits inline to +6, passes a roll that would fail without it, clears adjust, and logs to fight and dice logs', async () => {
    // Compute Mira's Presence bonus and choose a natural face that fails at +0 (DC - 4) and passes at +6 (DC + 2)
    const { bonus, dc } = await page.evaluate(() => {
      const h = hunterApp.store.active();
      const b = hunterApp.api.hunter.sheet(h).checks.bonus.pre as number;
      // E hunter vs C boss: 10 + 3*2 + 5 = 21
      return { bonus: b, dc: 21 };
    });
    const natural = Math.max(2, Math.min(19, dc - bonus - 4));
    const expectedTotal = natural + bonus + 6;
    expect(natural + bonus, 'natural roll fails without GM adjustment').toBeLessThan(dc);
    expect(expectedTotal, 'adjusted roll passes DC').toBeGreaterThanOrEqual(dc);

    const extractBtn = card(page).locator('[data-extract]');
    await expect(extractBtn).toHaveText('Extract shadow');
    await expect(card(page).locator('[data-extract-blood]')).toHaveCount(0);
    await extractBtn.tap();
    const dlg = page.locator('.sys-overlay.show', { hasText: 'Shadow Extraction' });
    await expect(dlg).toBeVisible();
    await expect(dlg.locator('[data-adj-val]')).toHaveText('+2');
    await expect(dlg.locator('[data-adj-line]')).toHaveText('GM adjustment: +2');

    const modalUp = dlg.getByRole('button', { name: 'Raise roll adjustment on Igris the Bloodred' });
    for (let i = 0; i < 4; i++) await modalUp.tap();
    await expect(dlg.locator('[data-adj-val]')).toHaveText('+6');
    await expect(dlg.locator('[data-adj-line]')).toHaveText('GM adjustment: +6');

    await page.evaluate(f => { Math.random = () => (f - 0.5) / 20; }, natural);
    await dlg.getByRole('button', { name: 'Extract shadow' }).tap();
    await answerWindow(page, 'ARISE', 'Arise');

    // Fight log shows the GM modifier and corpse.adjust is cleared
    const logTop = (await combat(page).locator('[data-log] li').first().textContent()) ?? '';
    expect(logTop).toContain('Igris the Bloodred rises as a shadow');
    expect(logTop).toContain(`+ 6 GM = ${expectedTotal} vs DC ${dc}`);
    expect((await fightRow(page, 'Igris the Bloodred')).adjust).toBeUndefined();
    await expect(card(page).locator('[data-adjust-val]')).toHaveText('0');
    await expect(card(page).locator('[data-adjust-box] .cmb-fdot')).toHaveCount(0);

    // Dice roll log shows the modifier in both expression and label
    await go(page, 'dice');
    const firstRoll = page.locator('#view-dice [data-hist] li').first();
    await expect(firstRoll).toContainText('Extract shadow: Igris the Bloodred (GM +6)');
    await expect(firstRoll).toContainText(`[${natural}] = ${expectedTotal}`);
  });
});

test('GM adjusts a mid-fight Arise roll on a corpse card, hidden fight fudge does not interfere, and the adjustment clears after one roll', async ({ device }) => {
  const page = (await device('gm')).page;
  await setupGoblinDenGM(page);
  await chooseList(page);

  await go(page, 'combat');
  await combat(page).locator('[data-hsel]').selectOption({ label: 'Mira Vale' });
  await combat(page).locator('[data-addh]').tap();
  await combat(page).locator('[data-qline]').fill('High Orc, C, brute');
  await combat(page).locator('[data-qadd]').tap();
  await combat(page).locator('[data-qline]').fill('Goblin Scout, E, brute');
  await combat(page).locator('[data-qadd]').tap();
  await combat(page).locator('[data-start]').tap();
  await expect(combat(page).locator('.cmb-row.cur')).toHaveCount(1);

  // Give Mira Arise, kill High Orc in range, and turn hidden Fudge (+10 + Force Natural 20) ON to prove Arise ignores fudge
  await page.evaluate(arise => hunterApp.store.update((d: any) => {
    const f = d.fight;
    const mira = f.rows.find((r: any) => r.name === 'Mira Vale');
    const orc = f.rows.find((r: any) => r.name === 'High Orc');
    const scout = f.rows.find((r: any) => r.name === 'Goblin Scout');
    mira.abilities = [...mira.abilities, arise];
    mira.mana = 100;
    mira.sheet = { ...mira.sheet, manaMax: 100 };
    mira.place = { x: 2, y: 2 };
    mira.at = f.now;
    mira.tie = 0;
    orc.place = { x: 4, y: 2 };
    orc.life = { at: 'dead' };
    scout.place = { x: 10, y: 10 };
    scout.at = f.now + 500;
    f.currentId = mira.id;
    f.fudge = { sides: { party: 10, foe: 0 }, rows: { [mira.id]: 5 }, forced: { [mira.id]: 20 } };
  }, 'test-setup'), ARISE_ABILITY);

  // Set -5 roll adjustment on High Orc corpse card
  await combat(page).locator('.cmb-pick', { hasText: 'High Orc' }).tap();
  const down = card(page).getByRole('button', { name: 'Lower roll adjustment on High Orc' });
  for (let i = 0; i < 5; i++) await down.tap();
  await expect(card(page).locator('[data-adjust-val]')).toHaveText('−5');

  // Choose natural face that passes without adjustment (15 + bonus >= 16) but fails with -5 GM adjustment
  await fixCryptoD20(page, 14);
  await combat(page).locator('.cmb-pick', { hasText: 'Mira Vale' }).tap();
  await card(page).locator('[data-ab="arise"]').tap();
  const dlg = page.locator('.sys-overlay.show', { hasText: 'Use Arise on…' });
  await expect(dlg).toBeVisible();
  await expect(dlg.locator('.sys-actions button', { hasText: 'High Orc' })).toContainText('GM −5');
  await dlg.locator('.sys-actions button', { hasText: 'High Orc' }).tap();
  await expect(dlg).toHaveCount(0);

  // Arise failed despite hidden fudge +15 & forced 20; log shows - 5 GM and adjust is cleared
  const afterFail = await page.evaluate(() => {
    const f = hunterApp.store.get().fight;
    const orc = f.rows.find((r: any) => r.name === 'High Orc');
    return {
      log: f.log.map((l: any) => l.text).join('\n'),
      adjust: orc.adjust ?? null,
      risen: f.rows.filter((r: any) => r.kind === 'summon').length,
      forced: f.fudge.forced,
    };
  });
  expect(afterFail.risen).toBe(0);
  expect(afterFail.adjust).toBeNull();
  expect(afterFail.log).toContain('fails on High Orc');
  expect(afterFail.log).toContain('- 5 GM =');
  expect(Object.keys(afterFail.forced).length, 'hidden forced roll was not consumed by Arise').toBe(1);
});
