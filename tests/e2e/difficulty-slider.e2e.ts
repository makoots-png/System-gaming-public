import { mkdir } from 'node:fs/promises';
import { test, expect, openApp, onboardGM, onboardPlayer, createRoom, dismissAll, go, gateByName, chooseList, ROOM_CODE, type Page } from './helpers.ts';
import { RULES } from '../../src/core/rules.ts';
import { DIFFICULTY_WORDS, difficultyFactor, scaleMonsterForGate } from '../../src/core/gates/difficulty.ts';
import type { DifficultyLevel, GateDifficulty } from '../../src/core/gates/difficulty.ts';
import { monsterSheetOf, seedMonsters } from '../../src/core/registry/monsters.ts';

const SHOT_DIR = process.env.DIFFICULTY_SHOTS || '';
async function snap(page: Page, name: string): Promise<void> {
  if (!SHOT_DIR) return;
  await mkdir(SHOT_DIR, { recursive: true });
  await page.screenshot({ path: `${SHOT_DIR}/${name}`, fullPage: false });
}

const gateCard = (page: Page, id: string) => page.locator(`#view-gates .gate[data-id="${id}"]`);

async function setRange(locator: ReturnType<Page['locator']>, value: number): Promise<void> {
  await locator.evaluate((el: HTMLInputElement, v: string) => {
    el.value = v;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, String(value));
}

async function assert390Fit(locator: ReturnType<Page['locator']>, label: string): Promise<void> {
  const fit = await locator.evaluate((el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    const ranges = [...el.querySelectorAll('input[type="range"]')].filter(x => (x as HTMLElement).offsetParent !== null);
    const minRangeH = ranges.length ? Math.min(...ranges.map(x => x.getBoundingClientRect().height)) : 44;
    return {
      wide: window.innerWidth,
      over: el.scrollWidth - el.clientWidth,
      right: r.right,
      minRangeH,
    };
  });
  expect(fit.wide, `${label}: 390 px viewport`).toBe(390);
  expect(fit.over, `${label}: no horizontal overflow`).toBeLessThanOrEqual(0);
  expect(fit.right, `${label}: fits inside viewport width`).toBeLessThanOrEqual(fit.wide + 1);
  expect(fit.minRangeH, `${label}: slider touch target >= 44 px`).toBeGreaterThanOrEqual(44);
}

test('GM spawns a gate at custom difficulty, overrides and clears boss difficulty, combines Bestiary edits in combat, and uses the GM screen shortcut', async ({ device }) => {
  const gm = (await device('gm')).page;
  await onboardGM(gm);
  await chooseList(gm);
  await go(gm, 'gates');

  const cerberus = seedMonsters(RULES).find(m => m.id === 'seed:cerberus')!;
  const defLevel = RULES.fight.difficulty.default as DifficultyLevel;
  const cerbHpAt = (lvl: DifficultyLevel) =>
    monsterSheetOf(scaleMonsterForGate(cerberus, { difficulty: { gate: { at: 'set', level: lvl }, boss: { at: 'follows' } } }, 'boss', RULES), RULES).hpMax;

  // 1. Gates spawn form: verify default phrase, drag to difficulty 8, check 390 px fit, capture shot, spawn C-rank gate
  const spawnForm = gm.locator('#view-gates form.gt-spawn');
  const spSlider = spawnForm.locator('input[name="difficulty"]');
  const spOut = spawnForm.locator('[data-diff-out="gate"]');
  await expect(spSlider).toHaveValue(String(defLevel));
  await expect(spOut).toHaveText(DIFFICULTY_WORDS.gateReadout(defLevel, RULES));

  await spawnForm.locator('select[name="rank"]').selectOption('C');
  await spawnForm.locator('select[name="type"]').selectOption('normal');
  await setRange(spSlider, 8);
  await expect(spOut).toHaveText(DIFFICULTY_WORDS.gateReadout(8, RULES));
  await expect(spSlider).toHaveAttribute('aria-valuetext', DIFFICULTY_WORDS.gateReadout(8, RULES));
  await spawnForm.scrollIntoViewIfNeeded();
  await assert390Fit(spawnForm, 'Gates spawn form');
  await snap(gm, 'spawn-form.png');

  await spawnForm.locator('button[type="submit"]').tap();

  // Find the newly spawned C-rank gate (first in list) and its rolled boss
  const { spawnedId, spawnedBoss } = await gm.evaluate(() => {
    const g = hunterApp.store.get().gates[0];
    return { spawnedId: g.id as string, spawnedBoss: hunterApp.api.bestiary.get(g.bossId) };
  });
  const bossHpAt = (m: any, lvl: DifficultyLevel) =>
    monsterSheetOf(scaleMonsterForGate(m, { difficulty: { gate: { at: 'set', level: lvl }, boss: { at: 'follows' } } }, 'boss', RULES), RULES).hpMax;

  const card = gateCard(gm, spawnedId);
  await expect(card).toBeVisible();
  const diff8: GateDifficulty = { gate: { at: 'set', level: 8 }, boss: { at: 'follows' } };
  await expect(card.locator('[data-diff-summary]')).toHaveText(DIFFICULTY_WORDS.cardSummary(diff8, true, RULES));

  const hp5 = bossHpAt(spawnedBoss, 5);
  const hp8 = bossHpAt(spawnedBoss, 8);
  const hp10 = bossHpAt(spawnedBoss, 10);
  expect(hp8).toBeGreaterThan(hp5);
  expect(hp10).toBeGreaterThan(hp8);
  await expect(card.locator('.gt-mons li.boss')).toContainText(`HP ${hp8.toLocaleString('en-US')}`);

  await card.scrollIntoViewIfNeeded();
  await assert390Fit(card, 'GM gate card');
  await snap(gm, 'gate-card.png');

  // Reload and verify persistence
  await openApp(gm);
  await dismissAll(gm);
  await go(gm, 'gates');
  const cardAfter = gateCard(gm, spawnedId);
  await expect(cardAfter.locator('[data-diff-summary]')).toHaveText(DIFFICULTY_WORDS.cardSummary(diff8, true, RULES));
  await expect(cardAfter.locator('.gt-mons li.boss')).toContainText(`HP ${hp8.toLocaleString('en-US')}`);

  // 2. Edit panel: enable boss override at difficulty 10, capture shot, save, verify card updates
  await cardAfter.locator('[data-act="edit"]').tap();
  const eform = cardAfter.locator('form[data-form="edit"]');
  await expect(eform).toBeVisible();
  const bossChk = eform.locator('input[data-diff-boss-on]');
  const bossSlider = eform.locator('input[data-diff-range="boss"]');
  const bossOut = eform.locator('[data-diff-out="boss"]');
  await expect(eform.locator('[data-diff-ctl="boss"]')).toContainText(DIFFICULTY_WORDS.bossToggle);
  await expect(bossChk).not.toBeChecked();
  await expect(bossOut).toHaveText(DIFFICULTY_WORDS.bossFollowReadout(8, RULES));

  await bossChk.check();
  await expect(bossSlider).toBeVisible();
  await setRange(bossSlider, 10);
  await expect(bossOut).toHaveText(DIFFICULTY_WORDS.bossOwnReadout(10, RULES));
  await eform.locator('[data-diff-ctl="gate"]').scrollIntoViewIfNeeded();
  await assert390Fit(eform, 'Gate edit panel with boss override');
  await snap(gm, 'edit-panel-boss-override.png');

  await eform.locator('button[type="submit"]').tap();
  await expect(eform).toHaveCount(0);
  const diff8Own10: GateDifficulty = { gate: { at: 'set', level: 8 }, boss: { at: 'own', level: 10 } };
  await expect(cardAfter.locator('[data-diff-summary]')).toHaveText(DIFFICULTY_WORDS.cardSummary(diff8Own10, true, RULES));
  await expect(cardAfter.locator('.gt-mons li.boss')).toContainText(`HP ${hp10.toLocaleString('en-US')}`);

  // 3. Remove boss -> boss difficulty resets to follows; re-add Cerberus -> stays follows
  await cardAfter.locator('[data-act="edit"]').tap();
  const eform2 = cardAfter.locator('form[data-form="edit"]');
  await eform2.locator('select[name="boss"]').selectOption('');
  await expect(eform2.locator('[data-diff-ctl="boss"]')).toBeHidden();
  await eform2.locator('button[type="submit"]').tap();
  await expect(cardAfter.locator('[data-diff-summary]')).toHaveText(DIFFICULTY_WORDS.cardSummary(diff8, false, RULES));

  await cardAfter.locator('[data-act="edit"]').tap();
  const eform3 = cardAfter.locator('form[data-form="edit"]');
  await eform3.locator('select[name="boss"]').selectOption('seed:cerberus');
  await expect(eform3.locator('[data-diff-ctl="boss"]')).toBeVisible();
  await expect(eform3.locator('input[data-diff-boss-on]')).not.toBeChecked();
  await eform3.locator('button[type="submit"]').tap();
  await expect(cardAfter.locator('[data-diff-summary]')).toHaveText(DIFFICULTY_WORDS.cardSummary(diff8, true, RULES));
  await expect(cardAfter.locator('.gt-mons li.boss')).toContainText(`HP ${cerbHpAt(8).toLocaleString('en-US')}`);

  // 4. GM Bestiary edit + gate difficulty multiply together in the started fight
  const editedBossId = await gm.evaluate((base: any) => {
    const res = hunterApp.api.bestiary.save({
      ...base,
      name: 'Armored Cerberus',
      tweak: { hp: 2, stats: { str: 6 }, traits: ['armored'] },
    }, true);
    return res.ok ? res.id as string : '';
  }, cerberus);
  expect(editedBossId).toBeTruthy();

  await cardAfter.locator('[data-act="edit"]').tap();
  const eform4 = cardAfter.locator('form[data-form="edit"]');
  await eform4.locator('select[name="boss"]').selectOption(editedBossId);
  await eform4.locator('button[type="submit"]').tap();

  const expectedEditedHp = monsterSheetOf(
    scaleMonsterForGate(
      { ...cerberus, tweak: { hp: 2, stats: { str: 6 }, traits: ['armored'] } },
      { difficulty: diff8 },
      'boss',
      RULES,
    ),
    RULES,
  ).hpMax;
  const expectedFactor = difficultyFactor('boss', 'C', 8, RULES);
  await expect(cardAfter.locator('.gt-mons li.boss')).toContainText(`HP ${expectedEditedHp.toLocaleString('en-US')}`);

  await cardAfter.locator('[data-act="encounter"]').tap();
  await gm.locator('[aria-modal="true"] [data-apply]').tap();
  await expect(gm.locator('#view-combat [data-end]').first()).toBeVisible();

  const fightBoss = await gm.evaluate(() => {
    const f = hunterApp.store.get().fight;
    const row = f?.rows?.find((r: any) => r.name === 'Armored Cerberus');
    return row ? { hpMax: row.sheet.hpMax, tweak: row.origin.tweak } : null;
  });
  expect(fightBoss).not.toBeNull();
  expect(fightBoss!.hpMax).toBe(expectedEditedHp);
  expect(fightBoss!.tweak.hp).toBeCloseTo(2 * expectedFactor.hp, 5);
  expect(fightBoss!.tweak.dealt).toBeCloseTo(expectedFactor.dealt, 5);
  expect(fightBoss!.tweak.stats).toEqual({ str: 6 });
  expect(fightBoss!.tweak.traits).toEqual(['armored']);

  // 5. GM screen spawn shortcut at difficulty 3
  await go(gm, 'gm');
  const gateSec = gm.locator('.gm-sec[data-sec="gate"]');
  const gateTog = gateSec.locator('[data-tog="gate"]');
  if ((await gateTog.getAttribute('aria-expanded')) !== 'true') await gateTog.tap();
  const gmSlider = gm.locator('#gm-g-diff');
  const gmOut = gateSec.locator('[data-diff-out="gate"]');
  await expect(gmSlider).toHaveValue(String(defLevel));
  await setRange(gmSlider, 3);
  await expect(gmOut).toHaveText(DIFFICULTY_WORDS.gateReadout(3, RULES));
  await gm.locator('#gm-g-name').fill('Shortcut Vault');
  await gateSec.scrollIntoViewIfNeeded();
  await assert390Fit(gateSec.locator('.gm-body'), 'GM screen Gates and world day section');
  await snap(gm, 'gm-spawn-shortcut.png');

  await gm.locator('#gm-g-go').tap();
  await go(gm, 'gates');
  const shortcut = await gateByName(gm, 'Shortcut Vault');
  const diff3: GateDifficulty = { gate: { at: 'set', level: 3 }, boss: { at: 'follows' } };
  await expect(gateCard(gm, shortcut.id).locator('[data-diff-summary]')).toHaveText(DIFFICULTY_WORDS.cardSummary(diff3, true, RULES));
});

test('room players never see gate difficulty, while solo-open gates carry scaled boss factors on the wire', async ({ device }) => {
  const gm = (await device('gm')).page;
  const player = (await device('player')).page;
  await onboardGM(gm);
  const code = await createRoom(gm);
  expect(code).toMatch(ROOM_CODE);
  await onboardPlayer(player, 'Kai Slider', code);
  await expect.poll(() => gm.evaluate(() => hunterApp.api.sync.remoteSheets().some((r: any) => r.data && r.data.name === 'Kai Slider'))).toBe(true);
  await dismissAll(player, 4);

  // GM spawns a C-rank gate at difficulty 10 and opens it to solo runs
  await go(gm, 'gates');
  const spawnForm = gm.locator('#view-gates form.gt-spawn');
  await spawnForm.locator('select[name="rank"]').selectOption('C');
  await setRange(spawnForm.locator('input[name="difficulty"]'), 10);
  await spawnForm.locator('button[type="submit"]').tap();
  const gateId = await gm.evaluate(() => hunterApp.store.get().gates[0].id as string);

  const card = gateCard(gm, gateId);
  await card.locator('[data-act="edit"]').tap();
  const eform = card.locator('form[data-form="edit"]');
  await eform.locator('input[name="solo"]').check();
  await eform.locator('button[type="submit"]').tap();

  // Wait for player to receive both world and solo docs
  await expect.poll(() => player.evaluate((id: string) => {
    const w = hunterApp.api.sync.doc('world');
    const s = hunterApp.api.sync.doc('solo');
    return !!(w?.gates?.some((g: any) => g.id === id) && s?.gates?.some((g: any) => g.id === id));
  }, gateId)).toBe(true);

  await go(player, 'gates');
  const pCard = gateCard(player, gateId);
  await expect(pCard).toBeVisible();
  await expect(pCard.locator('[data-diff-summary]')).toHaveCount(0);
  await expect(pCard).not.toContainText('Difficulty');
  await expect(pCard).not.toContainText('of 10');

  const worldHasDifficulty = await player.evaluate((id: string) => {
    const w = hunterApp.api.sync.doc('world');
    const g = w?.gates?.find((x: any) => x.id === id);
    return g ? 'difficulty' in g : true;
  }, gateId);
  expect(worldHasDifficulty, 'world doc never exposes difficulty to players').toBe(false);

  // Solo doc carries the rounded hp/dealt scaling on the boss line without exposing difficulty on the card
  const bossLine = await player.evaluate((id: string) => {
    const s = hunterApp.api.sync.doc('solo');
    const g = s?.gates?.find((x: any) => x.id === id);
    return g ? g.lines[g.lines.length - 1] : null;
  }, gateId);
  const expected10 = difficultyFactor('boss', 'C', 10, RULES);
  expect(bossLine).not.toBeNull();
  expect(bossLine.hp).toBeCloseTo(expected10.hp, 2);
  expect(bossLine.dealt).toBeCloseTo(expected10.dealt, 2);

  const soloCard = player.locator(`#gt-solo .gate.solo[data-solo="world:${gateId}"]`);
  await expect(soloCard).toBeVisible();
  await expect(soloCard).not.toContainText('Difficulty');
  await expect(soloCard.locator('input[type="range"]')).toHaveCount(0);
});
