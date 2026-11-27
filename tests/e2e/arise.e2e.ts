// Wave 2 PR 4 browser test: The Empty Throne story flow (unique-class guards & reopen) and
// Arise mid-fight UI (stacked corpses by id, failed check leaves corpse/extraction intact,
// risen card/corpse status in List view, and hotbar corpse picker in Map view).
import type { Page } from '@playwright/test';
import { test, expect, setupGoblinDenGM, go, answerWindow, chooseList } from './helpers.ts';
import { RUN_REFUSAL_WORDS } from '../../src/core/story/run.ts';
import { uniqueJobRefusalText } from '../../src/core/hunter/grant.ts';
import { RULES } from '../../src/core/rules.ts';
import { abilityId } from '../../src/core/combat/ability-types.ts';
import { tiles } from '../../src/core/combat/space.ts';
import { cost, tick } from '../../src/core/combat/timeline.ts';

const stories = (page: Page) => page.locator('#gm-stories');
const storyWin = (page: Page) => page.locator('.st-ov [role=dialog]');
const storyCard = (page: Page) => stories(page).locator('.st-card');
const combat = (page: Page) => page.locator('#view-combat');
const lowestDice = (page: Page) => page.evaluate(() => Object.defineProperty(crypto, 'getRandomValues', { configurable: true, value: (a: Uint32Array) => a.fill(0) }));
const highestDice = (page: Page) => page.evaluate(() => Object.defineProperty(crypto, 'getRandomValues', { configurable: true, value: (a: Uint32Array) => a.fill(0xffffffff) }));

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
  raise: { bonus: 4, maxRisen: 2, elitePerFight: 1 },
};

test('The Empty Throne: duplicate from Workshop, block multi-hunter and taken claims, grant Necromancer + King of Shadows, and reopen cleanly', async ({ device }) => {
  const page = (await device('gm')).page;
  await setupGoblinDenGM(page);
  await page.evaluate(() => hunterApp.store.update((d: any) => {
    d.rulesOverrides = { ...d.rulesOverrides, feats: { on: false } };
  }, 'test-setup'));

  await test.step('duplicate The Empty Throne from Workshop Stories to copy', async () => {
    await go(page, 'workshop');
    const sec = page.locator('#view-workshop [data-ws="story"]');
    await sec.locator('[data-examples] summary').tap();
    await sec.getByRole('button', { name: 'Duplicate The Empty Throne' }).tap();
    await expect(page.locator('#toasts .toast', { hasText: 'The Empty Throne is in your stories.' })).toBeVisible();
  });

  await test.step('start The Empty Throne for Mira Vale and verify chapter 1 window & quest', async () => {
    await go(page, 'gm');
    const tog = page.locator('[data-tog="stories"]');
    if ((await tog.getAttribute('aria-expanded')) !== 'true') await tog.tap();
    await stories(page).locator('[data-st-turnon]').tap();
    const win = storyWin(page);
    await win.locator('[data-st-story]', { hasText: 'The Empty Throne' }).tap();
    await win.locator('[data-st-who]', { hasText: 'Mira Vale' }).tap();
    await win.locator('[data-st-go]').tap();
    await answerWindow(page, 'THE SYSTEM OFFERS YOU A TRIAL');
    await expect(storyCard(page)).toContainText('For Mira Vale');
    const hasQuest = await page.evaluate(() => hunterApp.store.get().hunters.find((h: any) => h.name === 'Mira Vale').quests.some((q: any) => q.title === 'Win the trial alone'));
    expect(hasQuest).toBe(true);
  });

  await test.step('chapter 2 refuses multi-hunter (one-for-unique) and delivers nothing', async () => {
    await storyCard(page).locator('[data-st-open]').tap();
    const win = storyWin(page);
    await win.locator('[data-st-who]', { hasText: 'Brakk Ironhide' }).tap();
    await win.locator('[data-st-go]').tap();
    await expect(win.locator('[data-st-err]')).toHaveText(RUN_REFUSAL_WORDS['one-for-unique'](2));
    // Untick Brakk, keep window open
    await win.locator('[data-st-who]', { hasText: 'Brakk Ironhide' }).tap();
    await win.locator('[data-st-cancel]').tap();
    const state = await page.evaluate(() => ({
      holder: hunterApp.store.get().classHolders.held.Necromancer ?? null,
      chapter: hunterApp.store.get().storyRuns[0].state.chapter,
    }));
    expect(state).toEqual({ holder: null, chapter: 0 });
  });

  await test.step('chapter 2 refuses when Brakk holds Necromancer (unique-job) and delivers nothing', async () => {
    await page.evaluate(() => hunterApp.store.update((d: any) => {
      const brakk = d.hunters.find((h: any) => h.name === 'Brakk Ironhide');
      d.classHolders = {
        registryId: d.classHolders?.registryId || 'reg-e2e',
        held: { Necromancer: { kind: 'local', hunterId: brakk.id, name: brakk.name, grantId: 'cg-brakk', claimedAt: '2026-11-26T12:00:00.000Z' } },
      };
    }, 'test-setup'));
    await storyCard(page).locator('[data-st-open]').tap();
    const win = storyWin(page);
    await win.locator('[data-st-go]').tap();
    await expect(win.locator('[data-st-err]')).toHaveText(
      uniqueJobRefusalText({ className: 'Necromancer', why: 'class-taken', holderName: 'Brakk Ironhide' }, 'Mira Vale'),
    );
    await win.locator('[data-st-cancel]').tap();
    const miraTitles = await page.evaluate(() => hunterApp.store.get().hunters.find((h: any) => h.name === 'Mira Vale').titles.map((t: any) => t.name));
    expect(miraTitles).not.toContain('King of Shadows');
  });

  await test.step('once released, chapter 2 grants Necromancer + King of Shadows, and reopening for Mira leaves class state intact and deduplicates title', async () => {
    await page.evaluate(() => hunterApp.store.update((d: any) => {
      d.classHolders = { registryId: d.classHolders?.registryId || 'reg-e2e', held: {} };
    }, 'test-setup'));
    await storyCard(page).locator('[data-st-open]').tap();
    await storyWin(page).locator('[data-st-go]').tap();
    await answerWindow(page, 'YOU ARE THE NECROMANCER');

    const afterFirst = await page.evaluate(() => {
      const s = hunterApp.store.get();
      const mira = s.hunters.find((h: any) => h.name === 'Mira Vale');
      return {
        job: mira.job,
        holder: s.classHolders.held.Necromancer,
        titles: mira.titles.filter((t: any) => t.name === 'King of Shadows').length,
      };
    });
    expect(afterFirst.job).toBe('Necromancer');
    expect(afterFirst.holder?.name).toBe('Mira Vale');
    expect(afterFirst.titles).toBe(1);

    // Reopen chapter 2 for Mira
    await storyCard(page).locator('[data-st-open]').tap();
    const win = storyWin(page);
    await win.locator('[data-st-ch="1"]').tap();
    await win.locator('[data-st-go]').tap();
    await answerWindow(page, 'YOU ARE THE NECROMANCER');

    const afterReopen = await page.evaluate(() => {
      const s = hunterApp.store.get();
      const mira = s.hunters.find((h: any) => h.name === 'Mira Vale');
      return {
        holder: s.classHolders.held.Necromancer,
        titles: mira.titles.filter((t: any) => t.name === 'King of Shadows').length,
        opens: s.storyRuns[0].opens,
      };
    });
    expect(afterReopen.holder).toEqual(afterFirst.holder);
    expect(afterReopen.titles).toBe(1);
    expect(afterReopen.opens).toBe(3);
  });
});

test('Arise mid-fight UI: stacked corpses by id, failed roll leaves corpse open, risen card and Map view hotbar work cleanly', async ({ device }) => {
  const page = (await device('gm')).page;
  await setupGoblinDenGM(page);
  await chooseList(page);

  await go(page, 'combat');
  await combat(page).locator('[data-hsel]').selectOption({ label: 'Mira Vale' });
  await combat(page).locator('[data-addh]').tap();
  await combat(page).locator('[data-qline]').fill('Goblin x2, E, brute');
  await combat(page).locator('[data-qadd]').tap();
  await combat(page).locator('[data-qline]').fill('Orc Guard, E, brute');
  await combat(page).locator('[data-qadd]').tap();
  await combat(page).locator('[data-start]').tap();
  await expect(combat(page).locator('.cmb-row.cur')).toHaveCount(1);

  // Give Mira Arise + plenty of mana, place stacked dead goblins on (4, 2) and keep Orc Guard alive at (10, 10)
  await page.evaluate(arise => hunterApp.store.update((d: any) => {
    const f = d.fight;
    const mira = f.rows.find((r: any) => r.name === 'Mira Vale');
    const gobs = f.rows.filter((r: any) => r.name.startsWith('Goblin'));
    const orc = f.rows.find((r: any) => r.name === 'Orc Guard');
    mira.abilities = [...mira.abilities, arise];
    mira.mana = 100;
    mira.sheet = { ...mira.sheet, manaMax: 100 };
    mira.place = { x: 2, y: 2 };
    mira.at = f.now;
    mira.tie = 0;
    for (const g of gobs) {
      g.place = { x: 4, y: 2 };
      g.life = { at: 'dead' };
    }
    orc.place = { x: 10, y: 10 };
    orc.at = f.now + 500;
    f.currentId = mira.id;
  }, 'test-setup'), ARISE_ABILITY);
  await lowestDice(page);

  await combat(page).locator('.cmb-pick', { hasText: 'Mira Vale' }).first().tap();

  await test.step('failed nat-1 Arise in List view opens stacked-corpse picker with DC and leaves corpse open and extraction untouched', async () => {
    const ariseBtn = combat(page).locator('.cmb-card.turn [data-ab="arise"]');
    await expect(ariseBtn).toBeVisible();
    await ariseBtn.tap();
    const dlg = page.locator('.sys-overlay.show', { hasText: 'Use Arise on…' });
    await expect(dlg).toBeVisible();
    await expect(dlg).toContainText('Presence check');
    await expect(dlg.locator('.sys-actions button', { hasText: 'Goblin A' })).toContainText('DC');
    await expect(dlg.locator('.sys-actions button', { hasText: 'Goblin B' })).toContainText('DC');
    await dlg.locator('.sys-actions button', { hasText: 'Goblin B' }).tap();
    await expect(dlg).toHaveCount(0);

    const afterFail = await page.evaluate(() => {
      const f = hunterApp.store.get().fight;
      const gobB = f.rows.find((r: any) => r.name === 'Goblin B');
      return {
        risen: f.rows.filter((r: any) => r.kind === 'summon').length,
        rose: gobB.rose ?? false,
        extraction: gobB.extraction ?? null,
        log: f.log.map((l: any) => l.text).join('\n'),
      };
    });
    expect(afterFail.risen).toBe(0);
    expect(afterFail.rose).toBe(false);
    expect(afterFail.extraction).toBeNull();
    expect(afterFail.log).toContain('fails on Goblin B');
    await expect(page.locator('#toasts .toast', { hasText: 'fails on' })).toBeVisible();
  });

  await test.step('passed nat-20 Arise in List view raises exact stacked corpse and updates risen & corpse cards', async () => {
    await page.evaluate(() => hunterApp.store.update((d: any) => {
      const f = d.fight;
      const mira = f.rows.find((r: any) => r.name === 'Mira Vale');
      mira.readyAt = {};
      mira.mana = 100;
      mira.at = f.now;
      f.currentId = mira.id;
    }, 'test-setup'));
    await highestDice(page);

    await combat(page).locator('.cmb-pick', { hasText: 'Mira Vale' }).first().tap();
    await combat(page).locator('.cmb-card.turn [data-ab="arise"]').tap();
    const dlg = page.locator('.sys-overlay.show', { hasText: 'Use Arise on…' });
    await expect(dlg).toBeVisible();
    await dlg.locator('.sys-actions button', { hasText: 'Goblin B' }).tap();
    await expect(dlg).toHaveCount(0);

    // Inspect Risen Goblin B card
    const risenPick = combat(page).locator('.cmb-pick', { hasText: 'Risen Goblin B' });
    await expect(risenPick).toHaveCount(1);
    await risenPick.tap();
    const risenCard = combat(page).locator('.cmb-card');
    await expect(risenCard).toContainText('risen');
    await expect(risenCard).toContainText('Raised by Mira Vale · lasts until the fight ends');

    // Inspect Goblin B corpse card
    await combat(page).locator('.cmb-row.down .cmb-pick', { hasText: 'Goblin B' }).tap();
    await expect(combat(page).locator('.cmb-card')).toContainText('Already raised in this fight.');
  });

  await test.step('tapping Arise on the Map view hotbar opens the corpse picker for remaining corpse and spawns onto the map', async () => {
    await page.evaluate(() => hunterApp.store.update((d: any) => {
      const f = d.fight;
      const mira = f.rows.find((r: any) => r.name === 'Mira Vale');
      mira.readyAt = {};
      mira.mana = 100;
      mira.at = f.now;
      f.currentId = mira.id;
    }, 'test-setup'));
    await highestDice(page);
    await combat(page).locator('[data-fview="map"]').tap();

    const mapArise = combat(page).locator('[data-mapbox] [data-ab="arise"]');
    await expect(mapArise).toBeVisible();
    await mapArise.tap();
    const dlg = page.locator('.sys-overlay.show', { hasText: 'Use Arise on…' });
    await expect(dlg).toBeVisible();
    await expect(dlg.locator('.sys-actions button', { hasText: 'Goblin A' })).toHaveCount(1);
    await expect(dlg.locator('.sys-actions button', { hasText: 'Goblin B' })).toHaveCount(0);
    await dlg.locator('.sys-actions button', { hasText: 'Goblin A' }).tap();
    await expect(dlg).toHaveCount(0);

    await expect.poll(() => page.evaluate(() => hunterApp.store.get().fight.rows.filter((r: any) => r.kind === 'summon' && r.rose !== undefined).length)).toBe(2);
  });
});
