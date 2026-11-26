import { mkdir } from 'node:fs/promises';
import { test, expect, openApp, setupGoblinDenGM, onboardPlayer, createRoom, dismissAll, go, activeHunter, gateByName, ROOM_CODE, type Page } from './helpers.ts';
import { RULES } from '../../src/core/rules.ts';
import { PRESET_WORDS } from '../../src/core/gates/preset.ts';
import { shareEach } from '../../src/core/gates/spawn.ts';

const SHOT_DIR = process.env.CLEAR_PRESET_SHOTS || '';
async function snap(page: Page, name: string): Promise<void> {
  if (!SHOT_DIR) return;
  await mkdir(SHOT_DIR, { recursive: true });
  await page.screenshot({ path: `${SHOT_DIR}/${name}`, fullPage: false });
}

const gateCard = (page: Page, id: string) => page.locator(`#view-gates .gate[data-id="${id}"]`);
const lifetimeXp = (page: Page): Promise<Record<string, number>> => page.evaluate((perLevel: number) => Object.fromEntries(hunterApp.store.get().hunters.map((h: any) => {
  let total = h.xp;
  for (let l = 1; l < h.level; l++) total += perLevel * l;
  return [h.name, total];
})), RULES.xpPerLevel);
const hunterTotalXp = (h: any): number => h.xp + RULES.xpPerLevel * (h.level - 1) * h.level / 2;

test('GM pre-sets a room gate clear, players never see it early, and clearing pays directly through the unified Clear panel and Party stash', async ({ device }) => {
  const gm = (await device('gm')).page;
  const player = (await device('player')).page;
  await setupGoblinDenGM(gm);
  const code = await createRoom(gm);
  expect(code).toMatch(ROOM_CODE);
  await onboardPlayer(player, 'Kai Preset', code);
  await expect.poll(() => gm.evaluate(() => hunterApp.api.sync.remoteSheets().some((r: any) => r.data && r.data.name === 'Kai Preset'))).toBe(true);
  await dismissAll(player, 4);

  const gate = await gateByName(gm, 'Goblin Den');
  const kaiBefore = await activeHunter(player);
  const kaiKey = await gm.evaluate(() => hunterApp.api.sync.remoteSheets().find((r: any) => r.data?.name === 'Kai Preset')!.key as string);

  // 1. GM opens Set clear rewards
  await go(gm, 'gates');
  const card = gateCard(gm, gate.id);
  await card.locator('[data-act=preset]').tap();
  const pform = card.locator('form[data-form=preset]');
  await expect(pform).toBeVisible();

  const expectedXp = shareEach(gate.xp, 4, RULES.gateParty);
  const [minGold = 0, maxGold = minGold] = RULES.loot.E.gold;
  const xpInput = pform.locator('input[name=xp]');
  const goldInput = pform.locator('input[name=gold]');
  await expect(xpInput).toHaveValue(String(expectedXp));
  const recGold = Number(await goldInput.inputValue());
  expect(recGold).toBeGreaterThanOrEqual(shareEach(minGold, 4, RULES.gateParty));
  expect(recGold).toBeLessThanOrEqual(shareEach(maxGold, 4, RULES.gateParty));

  const rows = pform.locator('[data-prow]');
  await expect(rows).toHaveCount(2);

  // 2. Edit XP and gold, uncheck row 2, assign row 1 to Kai Preset, add an item for Party stash
  const customXp = gate.xp + 50;
  const customGold = maxGold + 25;
  await xpInput.fill(String(customXp));
  await xpInput.dispatchEvent('change');
  await goldInput.fill(String(customGold));
  await goldInput.dispatchEvent('change');

  const row1Name = (await rows.nth(0).getAttribute('data-pname'))!;
  expect(row1Name).toBeTruthy();
  await expect(rows.nth(0).locator('.gt-pchk')).toContainText(PRESET_WORDS.payItem(row1Name));
  await expect(rows.nth(0)).toContainText(PRESET_WORDS.goesTo);
  await expect(rows.nth(0).locator('[data-act=preset-rm]')).toHaveText(PRESET_WORDS.removeItem);
  await expect(pform.locator('[data-act=preset-clear]')).toHaveText(PRESET_WORDS.clear);
  await expect(pform.locator('[data-act=cancel-panel]')).toHaveText(PRESET_WORDS.closePanel);
  await rows.nth(0).locator('select[data-pto]').selectOption(kaiKey);
  await rows.nth(1).locator('input[data-pchk]').uncheck();

  // Add a built-in/shop item (Health Potion (E)) left at Party stash
  const addSelect = pform.locator('[data-padd-pick]');
  const potionOpt = await addSelect.locator('option', { hasText: 'Health Potion (E)' }).first().getAttribute('value');
  expect(potionOpt).toBeTruthy();
  await addSelect.selectOption(potionOpt!);
  await pform.locator('[data-act=preset-add]').tap();
  await expect(pform.locator('[data-prow]')).toHaveCount(3);

  // Verify 390 px fit (no horizontal overflow) and capture screenshot 1
  const fit = await pform.evaluate((el: any) => ({ over: el.scrollWidth - el.clientWidth, right: el.getBoundingClientRect().right, wide: window.innerWidth }));
  expect(fit.wide).toBe(390);
  expect(fit.over).toBeLessThanOrEqual(0);
  expect(fit.right).toBeLessThanOrEqual(fit.wide);
  await pform.scrollIntoViewIfNeeded();
  await snap(gm, 'preset-panel-390.png');

  // Done and reload to verify persistence
  await pform.locator('[data-act=cancel-panel]').tap();
  await expect(pform).toHaveCount(0);
  await expect(card.locator('[data-preset-summary]')).toContainText(`${customXp.toLocaleString('en-US')} XP`);
  await openApp(gm);
  await dismissAll(gm);
  await go(gm, 'gates');
  await expect(gateCard(gm, gate.id).locator('[data-preset-summary]')).toContainText(`${customGold.toLocaleString('en-US')} gold`);

  // 3. Player phone never sees the preset before clear
  await go(player, 'gates');
  await expect(gateCard(player, gate.id)).toBeVisible();
  await expect(gateCard(player, gate.id).locator('[data-preset-summary]')).toHaveCount(0);
  await expect(gateCard(player, gate.id).locator('[data-act=preset]')).toHaveCount(0);
  const leaked = await player.evaluate((id: string) => {
    const w = hunterApp.api.sync.doc('world');
    const g = w?.gates?.find((x: any) => x.id === id);
    return g ? 'preset' in g : true;
  }, gate.id);
  expect(leaked, 'world doc never exposes preset to players').toBe(false);

  // 4. GM opens unified Clear panel -> sees editable preset values and item rows directly
  await gateCard(gm, gate.id).locator('[data-act=clear]').tap();
  const cform = gateCard(gm, gate.id).locator('form[data-form=clear]');
  await expect(cform).toBeVisible();
  for (const box of await cform.locator('input[name=hid]').all()) if (!(await box.isChecked())) await box.tap();
  await expect(cform.locator('input[name=xp]')).toHaveValue(String(customXp));
  await expect(cform.locator('input[name=gold]')).toHaveValue(String(customGold));
  await expect(cform.locator('[data-clearxp]')).toHaveText(customXp.toLocaleString('en-US'));
  await expect(cform.locator('[data-cleargold]')).toHaveText(customGold.toLocaleString('en-US'));
  await expect(cform.locator('[data-clearitems] [data-prow]')).toHaveCount(3);
  await expect(cform.locator('[data-clearitems]')).toContainText(row1Name);
  await expect(cform.locator('[data-clearitems]')).toContainText('Health Potion (E)');
  await cform.scrollIntoViewIfNeeded();
  await snap(gm, 'clear-panel-preset-390.png');

  // 5. Confirm clear -> pays Kai and local hunters directly without bouncing to Pending rewards
  await cform.locator('button[type=submit]').tap();
  await expect(gm.locator('.sys-overlay.show .sys-actions button', { hasText: PRESET_WORDS.openWaiting })).toHaveCount(0);
  await dismissAll(gm, 6);

  // Pending rewards holds zero clear rows; stash holds Health Potion (E)
  const pendingClear = await gm.evaluate(() => (hunterApp.store.get().settings.sync.pending || []).filter((p: any) => p.from === 'clear'));
  expect(pendingClear).toEqual([]);
  const stashNames = await gm.evaluate(() => hunterApp.store.get().stash.items.map((i: any) => i.name));
  expect(stashNames).toContain('Health Potion (E)');

  // Player receives exact preset XP, gold, and assigned item directly
  await expect.poll(async () => hunterTotalXp(await activeHunter(player)) - hunterTotalXp(kaiBefore), { timeout: 30_000 }).toBe(customXp);
  await dismissAll(player, 6);
  const kaiAfter = await activeHunter(player);
  expect(kaiAfter.gold - kaiBefore.gold).toBe(customGold);
  expect(kaiAfter.items.map((i: any) => i.name)).toContain(row1Name);

  // 6. Paid preset shows read-only on GM's gate card under Finished gates, never editable
  await go(gm, 'gates');
  const doneDetails = gm.locator('#gt-done');
  if (!(await doneDetails.evaluate((el: any) => el.open))) await doneDetails.locator('summary').tap();
  const paidCard = gateCard(gm, gate.id);
  const paidSummaryPrefix = PRESET_WORDS.summary({ xp: customXp, gold: customGold, crystal: 0, items: [] }, true, n => n.toLocaleString('en-US'));
  await expect(paidCard.locator('[data-preset-summary]')).toContainText(paidSummaryPrefix);
  await expect(paidCard.locator('[data-preset-paid]')).toContainText(PRESET_WORDS.itemWentTo('Kai Preset'));
  await expect(paidCard.locator('[data-preset-paid]')).toContainText(PRESET_WORDS.itemWentTo(PRESET_WORDS.stash));
  await expect(paidCard.locator('[data-act=preset]')).toHaveCount(0);
});

test('non-preset gate opens the unified editable Clear panel with rolled boss loot, cancels cleanly without saving a preset, and pays edits directly', async ({ device }) => {
  const gm = (await device('gm-unified')).page;
  const player = (await device('player-unified')).page;
  await setupGoblinDenGM(gm);
  const code = await createRoom(gm);
  await onboardPlayer(player, 'Sera Unified', code);
  await expect.poll(() => gm.evaluate(() => hunterApp.api.sync.remoteSheets().some((r: any) => r.data && r.data.name === 'Sera Unified'))).toBe(true);
  await dismissAll(player, 4);

  const gate = await gateByName(gm, 'Goblin Den');
  const seraBefore = await activeHunter(player);
  const seraKey = await gm.evaluate(() => hunterApp.api.sync.remoteSheets().find((r: any) => r.data?.name === 'Sera Unified')!.key as string);

  await go(gm, 'gates');
  const card = gateCard(gm, gate.id);
  await card.locator('[data-act=clear]').tap();
  const cform = card.locator('form[data-form=clear]');
  await expect(cform).toBeVisible();
  await expect(cform.locator('[data-clearitems] [data-prow]')).toHaveCount(2);

  // Canceling leaves the gate with no saved preset
  await cform.locator('[data-act=cancel-panel]').tap();
  await expect(cform).toHaveCount(0);
  expect(await gm.evaluate((id: string) => hunterApp.store.get().gates.find((g: any) => g.id === id).preset.at, gate.id)).toBe('none');

  // Reopen unified Clear panel, edit gold directly (without blur before submit), assign first rolled item to Sera, confirm
  await card.locator('[data-act=clear]').tap();
  await expect(cform).toBeVisible();
  for (const box of await cform.locator('input[name=hid]').all()) {
    const label = (await box.locator('..').textContent()) || '';
    const want = label.includes('Sera Unified');
    if ((await box.isChecked()) !== want) await box.tap();
  }
  const firstRow = cform.locator('[data-clearitems] [data-prow]').first();
  const rolledItem = (await firstRow.getAttribute('data-pname'))!;
  await firstRow.locator('select[data-pto]').selectOption(seraKey);
  await cform.locator('input[name=gold]').fill('333');
  await expect(cform.locator('[data-cleargold]')).toHaveText('333');
  await cform.locator('button[type=submit]').tap();
  await dismissAll(gm, 6);

  await expect.poll(async () => (await activeHunter(player)).gold - seraBefore.gold, { timeout: 30_000 }).toBe(333);
  await dismissAll(player, 6);
  const seraAfter = await activeHunter(player);
  expect(seraAfter.items.map((i: any) => i.name)).toContain(rolledItem);
});

test('playing alone: clearing a gate with a preset pays exact amounts immediately and stashes unpicked items', async ({ device }) => {
  const gm = (await device('gm-alone')).page;
  await setupGoblinDenGM(gm);
  const gate = await gateByName(gm, 'Goblin Den');
  const startXp = await lifetimeXp(gm);
  const startGold: Record<string, number> = await gm.evaluate(() => Object.fromEntries(hunterApp.store.get().hunters.map((h: any) => [h.name, h.gold])));
  const firstHunter = await gm.evaluate(() => ({ id: hunterApp.store.get().hunters[0].id as string, name: hunterApp.store.get().hunters[0].name as string }));

  await go(gm, 'gates');
  const card = gateCard(gm, gate.id);
  await card.locator('[data-act=preset]').tap();
  const pform = card.locator('form[data-form=preset]');
  const [minGold = 0] = RULES.loot.E.gold;
  const xpSet = gate.xp + 20, goldSet = minGold + 10;
  await pform.locator('input[name=xp]').fill(String(xpSet));
  await pform.locator('input[name=xp]').dispatchEvent('change');
  await pform.locator('input[name=gold]').fill(String(goldSet));
  await pform.locator('input[name=gold]').dispatchEvent('change');

  const rows = pform.locator('[data-prow]');
  const assignedName = (await rows.nth(0).getAttribute('data-pname'))!;
  const stashedName = (await rows.nth(1).getAttribute('data-pname'))!;
  await rows.nth(0).locator('select[data-pto]').selectOption(firstHunter.id);
  await pform.locator('[data-act=cancel-panel]').tap();

  await card.locator('[data-act=clear]').tap();
  const cform = card.locator('form[data-form=clear]');
  for (const box of await cform.locator('input[name=hid]').all()) if (!(await box.isChecked())) await box.tap();
  await cform.locator('button[type=submit]').tap();
  await dismissAll(gm);

  const afterXp = await lifetimeXp(gm);
  const afterGold: Record<string, number> = await gm.evaluate(() => Object.fromEntries(hunterApp.store.get().hunters.map((h: any) => [h.name, h.gold])));
  for (const name of Object.keys(startXp)) {
    expect(afterXp[name]! - startXp[name]!).toBe(xpSet);
    expect(afterGold[name]! - startGold[name]!).toBe(goldSet);
  }
  const firstItems: string[] = await gm.evaluate((id: string) => hunterApp.store.get().hunters.find((h: any) => h.id === id).items.map((i: any) => i.name), firstHunter.id);
  const stashItems: string[] = await gm.evaluate(() => hunterApp.store.get().stash.items.map((i: any) => i.name));
  expect(firstItems).toContain(assignedName);
  expect(stashItems).toContain(stashedName);
});
