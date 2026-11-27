// Browser test: GM hidden "Adjust roll" (uncapped integer + Force natural 20 / Force natural 1) on shadow extraction and mid-fight Arise.
// Verifies corpse card controls (uncapped input, mode selector, persistence across reload, gold dot, helper text),
// extraction modal pre-fill and inline switching to Force natural 20, plain dice log without GM tags, GM fight log
// breakdown vs player-safe table log, clearing after one roll, and Arise ignoring hidden fight fudge while applying Adjust/Force.
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

test('GM sets an uncapped adjustment and Force natural 20 on a corpse card and modal, reload keeps it, GM log notes it, and dice log stays plain', async ({ device }) => {
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

  await test.step('corpse card shows uncapped Adjust next roll input, mode buttons, helper text, and gold dot while active, and survives reload', async () => {
    const box = card(page).locator('[data-adjust-box]');
    await expect(box).toBeVisible();
    await expect(box).toContainText('Adjust next roll on Igris the Bloodred');
    await expect(card(page).locator('.cmb-adj .cmb-hint')).toHaveText(ADJUST_HINT);
    await expect(box.locator('.cmb-fdot')).toHaveCount(0);

    const inp = box.locator('[data-adjust-input]');
    await inp.fill('25');
    await inp.blur();
    await expect(inp).toHaveValue('25');
    await expect(box.locator('.cmb-fdot')).toHaveCount(1);

    await page.reload();
    await go(page, 'combat');
    await combat(page).locator(`[data-pick="${igrisId}"]`).tap();
    await expect(card(page).locator('[data-adjust-input]')).toHaveValue('25');
    await expect(card(page).locator('[data-adjust-box] .cmb-fdot')).toHaveCount(1);
  });

  await test.step('extraction modal pre-fills +25, switches to Force natural 20, succeeds despite raw 1, clears state, and logs plain roll in Dice', async () => {
    const { bonus, dc } = await page.evaluate(() => {
      const h = hunterApp.store.active();
      const b = hunterApp.api.hunter.sheet(h).checks.bonus.pre as number;
      return { bonus: b, dc: 21 };
    });

    const extractBtn = card(page).locator('[data-extract]');
    await expect(extractBtn).toHaveText('Extract shadow');
    await expect(card(page).locator('[data-extract-blood]')).toHaveCount(0);
    await extractBtn.tap();
    const dlg = page.locator('.sys-overlay.show', { hasText: 'Shadow Extraction' });
    await expect(dlg).toBeVisible();
    await expect(dlg.locator('[data-adj-in]')).toHaveValue('25');
    await expect(dlg.locator('[data-adj-line]')).toHaveText('GM adjustment: +25');

    await dlg.getByRole('button', { name: 'Force natural 20' }).tap();
    await expect(dlg.locator('[data-adj-line]')).toHaveText('GM: Force natural 20');

    // Fix Math.random to draw 1 so only Force natural 20 can produce a 20 and pass
    await page.evaluate(() => { Math.random = () => 0.01; });
    await dlg.getByRole('button', { name: 'Extract shadow' }).tap();
    await answerWindow(page, 'ARISE', 'Arise');

    // GM fight log shows forced 20, player-safe table log shows plain natural 20, and corpse fields clear
    const logTop = (await combat(page).locator('[data-log] li').first().textContent()) ?? '';
    expect(logTop).toContain('Igris the Bloodred rises as a shadow');
    expect(logTop).toContain(`20 + ${bonus} = ${20 + bonus} vs DC ${dc}, GM forced 20`);
    const rowAfter = await fightRow(page, 'Igris the Bloodred');
    expect(rowAfter.adjust).toBeUndefined();
    expect(rowAfter.force).toBeUndefined();
    await expect(card(page).locator('[data-adjust-input]')).toHaveValue('0');
    await expect(card(page).locator('[data-adjust-box] .cmb-fdot')).toHaveCount(0);

    // Dice roll log shows only the plain natural 20 roll (no GM or forced tag)
    await go(page, 'dice');
    const firstRoll = page.locator('#view-dice [data-hist] li').first();
    await expect(firstRoll).toContainText('Extract shadow: Igris the Bloodred');
    await expect(firstRoll).toContainText(`[20] = ${20 + bonus}`);
    await expect(firstRoll).not.toContainText('GM');
    await expect(firstRoll).not.toContainText('forced');
  });
});

test('GM applies uncapped negative adjust and Force natural 1 to mid-fight Arise, hidden fight fudge does not interfere, and state clears after one roll', async ({ device }) => {
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

  // Set uncapped -25 roll adjustment on High Orc corpse card
  await combat(page).locator('.cmb-pick', { hasText: 'High Orc' }).tap();
  const inp = card(page).locator('[data-adjust-input]');
  await inp.fill('-25');
  await inp.blur();
  await expect(inp).toHaveValue('-25');

  // Even a natural 19 fails with -25 GM adjustment
  await fixCryptoD20(page, 19);
  await combat(page).locator('.cmb-pick', { hasText: 'Mira Vale' }).tap();
  await card(page).locator('[data-ab="arise"]').tap();
  const dlg = page.locator('.sys-overlay.show', { hasText: 'Use Arise on…' });
  await expect(dlg).toBeVisible();
  await expect(dlg.locator('.sys-actions button', { hasText: 'High Orc' })).toContainText('GM −25');
  await dlg.locator('.sys-actions button', { hasText: 'High Orc' }).tap();
  await expect(dlg).toHaveCount(0);

  // Arise failed despite hidden fudge +15 & forced 20; GM log shows - 25 GM, table log strips it, adjust is cleared
  const afterFail = await page.evaluate(() => {
    const f = hunterApp.store.get().fight;
    const orc = f.rows.find((r: any) => r.name === 'High Orc');
    const ariseLog = f.log.find((l: any) => l.text.includes('fails on High Orc'));
    return {
      text: ariseLog?.text ?? '',
      table: ariseLog?.table ?? '',
      adjust: orc.adjust ?? null,
      risen: f.rows.filter((r: any) => r.kind === 'summon').length,
      forced: f.fudge.forced,
    };
  });
  expect(afterFail.risen).toBe(0);
  expect(afterFail.adjust).toBeNull();
  expect(afterFail.text).toContain('- 25 GM =');
  expect(afterFail.table).toContain('fails on High Orc.');
  expect(afterFail.table).not.toMatch(/GM|- 25/i);
  expect(Object.keys(afterFail.forced).length, 'hidden forced roll was not consumed by Arise').toBe(1);

  // Now set Force natural 1 on High Orc and give Mira another turn with a raw 20 roll -> still fails as natural 1 and clears force
  await page.evaluate(() => hunterApp.store.update((d: any) => {
    const f = d.fight;
    const mira = f.rows.find((r: any) => r.name === 'Mira Vale');
    mira.readyAt = {};
    mira.mana = 100;
    mira.at = f.now;
    f.currentId = mira.id;
  }, 'test-setup'));
  await combat(page).locator('.cmb-pick', { hasText: 'High Orc' }).tap();
  await card(page).getByRole('button', { name: 'Force natural 1' }).tap();
  await expect(card(page).getByRole('button', { name: 'Force natural 1' })).toHaveAttribute('aria-pressed', 'true');

  await fixCryptoD20(page, 20);
  await combat(page).locator('.cmb-pick', { hasText: 'Mira Vale' }).tap();
  await card(page).locator('[data-ab="arise"]').tap();
  const dlg2 = page.locator('.sys-overlay.show', { hasText: 'Use Arise on…' });
  const orcPick = dlg2.locator('.sys-actions button', { hasText: 'High Orc' });
  await expect(orcPick).toContainText('GM natural');
  expect(await orcPick.textContent()).toContain('GM natural 1');
  await orcPick.tap();
  await expect(dlg2).toHaveCount(0);

  const afterForce1 = await page.evaluate(() => {
    const f = hunterApp.store.get().fight;
    const orc = f.rows.find((r: any) => r.name === 'High Orc');
    const ariseLog = f.log.find((l: any) => l.text.includes('fails on High Orc'));
    return {
      text: ariseLog?.text ?? '',
      table: ariseLog?.table ?? '',
      force: orc.force ?? null,
      risen: f.rows.filter((r: any) => r.kind === 'summon').length,
    };
  });
  expect(afterForce1.risen).toBe(0);
  expect(afterForce1.force).toBeNull();
  expect(afterForce1.text).toContain('GM forced 1');
  expect(afterForce1.table).not.toMatch(/GM|forced/i);
  expect(afterForce1.table).toContain('rolled 1 +');
});
