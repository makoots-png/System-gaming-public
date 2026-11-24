// Parametrized browser round-trip suite: open a worst-case saved value in every maker and editor, save it unchanged,
// and assert nothing was lost or altered. Grouped into three sessions (Workshop makers, Non-Workshop GM editors,
// Player-role editors) to keep browser boot cost low while verifying every E2E entry in ROUNDTRIP_REGISTRY.
import { test, expect, onboardGM, onboardPlayer, go } from './helpers.ts';
import { giveTitle } from '../../src/core/hunter/record.ts';
import { newHunter } from '../../src/core/hunter/hunter.ts';
import { RULES } from '../../src/core/rules.ts';
import { E2E_MAKER_IDS } from '../fixtures/maker-registry.ts';
import type { MakerId } from '../fixtures/maker-registry.ts';
import {
  WORST_BUNDLE,
  WORST_FEAT_AFTER,
  WORST_FEAT_COUNT,
  WORST_GUILD,
  WORST_IDENTITY,
  WORST_ITEM_BULWARK,
  WORST_ITEM_CONSUMABLE,
  WORST_ITEM_WORN,
  WORST_MAP,
  WORST_MONSTER_BOSS,
  WORST_MONSTER_MYTHIC,
  WORST_OVERRIDES,
  WORST_QUEST_GM,
  WORST_QUEST_SELF,
  WORST_REWARDS,
  WORST_ROLL_TABLES,
  WORST_SKILL_ACTIVE,
  WORST_SKILL_PASSIVE,
  WORST_SKILL_REACTION,
  WORST_STATUS_KITS,
  WORST_STATUS_OPS,
  WORST_STORY,
  worstGate,
} from '../fixtures/maker-fixtures.ts';

/** Explicit list of registry ids exercised in this browser suite; checked against E2E_MAKER_IDS below. */
const COVERED_E2E_IDS: readonly MakerId[] = [
  'status', 'item', 'skill', 'monster', 'rewards', 'bundle', 'map', 'feat', 'story',
  'quest', 'gate', 'preset', 'title', 'guild', 'identity', 'rules-overrides', 'roll-tables',
];

test('registry check: every e2e-registered maker and editor is exercised by this suite', () => {
  expect([...COVERED_E2E_IDS].sort()).toEqual([...E2E_MAKER_IDS].sort());
});

test('Workshop makers: open worst-case saved values across all eight kinds and save unchanged', async ({ device }) => {
  const page = (await device('gm')).page;
  await onboardGM(page);

  await page.evaluate(f => hunterApp.store.update((d: any) => {
    d.library.statuses['rt-ops'] = f.statusOps;
    d.library.statuses['rt-kits'] = f.statusKits;
    d.library.items.push(f.bulwark, f.worn, f.consumable);
    d.library.skills.push(f.skillActive, f.skillReaction, f.skillPassive);
    d.monsters.push(f.monsterMythic, f.monsterBoss);
    d.library.rewards.push(f.bundle);
    d.library.maps.push(f.map);
    d.library.feats['rt-feat-after'] = f.featAfter;
    d.library.feats['rt-feat-count'] = f.featCount;
    d.library.stories.push(f.story);
  }, 'test-setup'), {
    statusOps: WORST_STATUS_OPS,
    statusKits: WORST_STATUS_KITS,
    bulwark: WORST_ITEM_BULWARK,
    worn: WORST_ITEM_WORN,
    consumable: WORST_ITEM_CONSUMABLE,
    skillActive: WORST_SKILL_ACTIVE,
    skillReaction: WORST_SKILL_REACTION,
    skillPassive: WORST_SKILL_PASSIVE,
    monsterMythic: WORST_MONSTER_MYTHIC,
    monsterBoss: WORST_MONSTER_BOSS,
    bundle: WORST_BUNDLE,
    map: WORST_MAP,
    featAfter: WORST_FEAT_AFTER,
    featCount: WORST_FEAT_COUNT,
    story: WORST_STORY,
  });

  await go(page, 'workshop');

  const cases: readonly {
    label: string;
    ws: string;
    id: string;
    overlay: string;
    expected: unknown;
    read: () => Promise<unknown>;
  }[] = [
    { label: 'status (colored ops)', ws: 'status', id: 'rt-ops', overlay: '.fg-overlay', expected: WORST_STATUS_OPS, read: () => page.evaluate(() => hunterApp.store.get().library.statuses['rt-ops']) },
    { label: 'status (uncolored kits + long bounds + Reach most)', ws: 'status', id: 'rt-kits', overlay: '.fg-overlay', expected: WORST_STATUS_KITS, read: () => page.evaluate(() => hunterApp.store.get().library.statuses['rt-kits']) },
    { label: 'item (Bulwark Ring active.name)', ws: 'item', id: WORST_ITEM_BULWARK.id, overlay: '.lf-overlay', expected: WORST_ITEM_BULWARK, read: () => page.evaluate(id => hunterApp.store.get().library.items.find((x: any) => x.id === id), WORST_ITEM_BULWARK.id) },
    { label: 'item (worn weapon + worn icon/label + active)', ws: 'item', id: WORST_ITEM_WORN.id, overlay: '.lf-overlay', expected: WORST_ITEM_WORN, read: () => page.evaluate(id => hunterApp.store.get().library.items.find((x: any) => x.id === id), WORST_ITEM_WORN.id) },
    { label: 'item (consumable revive/rankCap/tell/target)', ws: 'item', id: WORST_ITEM_CONSUMABLE.id, overlay: '.lf-overlay', expected: WORST_ITEM_CONSUMABLE, read: () => page.evaluate(id => hunterApp.store.get().library.items.find((x: any) => x.id === id), WORST_ITEM_CONSUMABLE.id) },
    { label: 'skill (active with null-duration zone + kits)', ws: 'skill', id: WORST_SKILL_ACTIVE.id, overlay: '.skm-overlay', expected: WORST_SKILL_ACTIVE, read: () => page.evaluate(id => hunterApp.store.get().library.skills.find((x: any) => x.id === id), WORST_SKILL_ACTIVE.id) },
    { label: 'skill (reaction)', ws: 'skill', id: WORST_SKILL_REACTION.id, overlay: '.skm-overlay', expected: WORST_SKILL_REACTION, read: () => page.evaluate(id => hunterApp.store.get().library.skills.find((x: any) => x.id === id), WORST_SKILL_REACTION.id) },
    { label: 'skill (passive large bonus + worn icon/label)', ws: 'skill', id: WORST_SKILL_PASSIVE.id, overlay: '.skm-overlay', expected: WORST_SKILL_PASSIVE, read: () => page.evaluate(id => hunterApp.store.get().library.skills.find((x: any) => x.id === id), WORST_SKILL_PASSIVE.id) },
    { label: 'monster (mythic script)', ws: 'monster', id: WORST_MONSTER_MYTHIC.id, overlay: '.enm-overlay', expected: WORST_MONSTER_MYTHIC, read: () => page.evaluate(id => hunterApp.store.get().monsters.find((x: any) => x.id === id), WORST_MONSTER_MYTHIC.id) },
    { label: 'monster (extractable boss)', ws: 'monster', id: WORST_MONSTER_BOSS.id, overlay: '.enm-overlay', expected: WORST_MONSTER_BOSS, read: () => page.evaluate(id => hunterApp.store.get().monsters.find((x: any) => x.id === id), WORST_MONSTER_BOSS.id) },
    { label: 'bundle + reward editor (9e57d384)', ws: 'bundle', id: WORST_BUNDLE.id, overlay: '.rwm-overlay', expected: WORST_BUNDLE, read: () => page.evaluate(id => hunterApp.store.get().library.rewards.find((x: any) => x.id === id), WORST_BUNDLE.id) },
    { label: 'map (optional MapZone fields)', ws: 'map', id: WORST_MAP.id, overlay: '.mpm-overlay', expected: WORST_MAP, read: () => page.evaluate(id => hunterApp.store.get().library.maps.find((x: any) => x.id === id), WORST_MAP.id) },
    { label: 'feat (show.at === feat, 7e222b1e)', ws: 'feat', id: 'rt-feat-after', overlay: '.fm-overlay', expected: WORST_FEAT_AFTER, read: () => page.evaluate(() => hunterApp.store.get().library.feats['rt-feat-after']) },
    { label: 'feat (show.at === count)', ws: 'feat', id: 'rt-feat-count', overlay: '.fm-overlay', expected: WORST_FEAT_COUNT, read: () => page.evaluate(() => hunterApp.store.get().library.feats['rt-feat-count']) },
    { label: 'story (chapter quest onFail + counted objective, 4e6be3c8)', ws: 'story', id: WORST_STORY.id, overlay: '.stm-overlay', expected: WORST_STORY, read: () => page.evaluate(id => hunterApp.store.get().library.stories.find((x: any) => x.id === id), WORST_STORY.id) },
  ];

  for (const c of cases) {
    await test.step(c.label, async () => {
      const btn = page.locator(`#view-workshop [data-ws="${c.ws}"] [data-id="${c.id}"] [data-act="edit"]`);
      await btn.scrollIntoViewIfNeeded();
      await btn.tap();
      const dlg = page.locator(`${c.overlay} [role=dialog]`);
      await expect(dlg).toBeVisible();
      await dlg.locator('[data-apply]').tap();
      await expect(dlg).toHaveCount(0);
      expect(await c.read(), c.label).toEqual(c.expected);
    });
  }
});

test('Non-Workshop GM editors: quest, gate, clear preset, title, guild, rules overrides, and roll tables round-trip unchanged', async ({ device }) => {
  const page = (await device('gm')).page;
  await onboardGM(page);

  const hunterId = await page.evaluate(() => hunterApp.store.get().hunters[0].id as string);
  const gate = worstGate(hunterId);
  const titleSeed = giveTitle(
    newHunter(RULES),
    WORST_REWARDS.title!,
    't910',
    RULES.titles,
  ).titles[0]!;

  await page.evaluate(f => hunterApp.store.update((d: any) => {
    const h = d.hunters[0];
    h.quests.push(f.quest);
    h.titles.push(f.title);
    h.titleId = f.title.id;
    h.guild = f.guild;
    d.monsters.push(f.m1, f.m2);
    d.library.maps.push(f.map);
    d.gates.push(f.gate);
    d.rulesOverrides = {
      ...f.overrides,
      gmTables: {
        urgent: [...f.tables.urgent],
        encounter: { B: [...f.tables.encounterB] },
      },
    };
  }, 'test-setup'), {
    quest: WORST_QUEST_GM,
    title: titleSeed,
    guild: WORST_GUILD,
    m1: WORST_MONSTER_MYTHIC,
    m2: WORST_MONSTER_BOSS,
    map: WORST_MAP,
    gate,
    overrides: WORST_OVERRIDES,
    tables: WORST_ROLL_TABLES,
  });

  await test.step('quest editor (GM urgent quest with exact dueAt seconds, counted objective, rewards, onFail)', async () => {
    await go(page, 'quests');
    await page.locator(`#view-quests [data-edit="${WORST_QUEST_GM.id}"]`).tap();
    const form = page.locator('#view-quests form[data-form]');
    await expect(form).toBeVisible();
    await form.locator('button[type="submit"]').tap();
    await expect(form).toBeHidden();
    const after = await page.evaluate(id => hunterApp.store.get().hunters[0].quests.find((q: any) => q.id === id), WORST_QUEST_GM.id);
    expect(after).toEqual(WORST_QUEST_GM);
  });

  await test.step('gate editor (rank, type, status, difficulty + boss own difficulty, map, monsters, solo)', async () => {
    await go(page, 'gates');
    const card = page.locator(`#view-gates .gate[data-id="${gate.id}"]`);
    await card.locator('[data-act="edit"]').tap();
    const form = card.locator('form[data-form="edit"]');
    await expect(form).toBeVisible();
    await form.locator('button[type="submit"]').tap();
    await expect(form).toHaveCount(0);
    const after = await page.evaluate(id => hunterApp.store.get().gates.find((g: any) => g.id === id), gate.id);
    expect(after).toEqual(gate);
  });

  await test.step('gate clear preset editor (xp, gold, crystal, checked/unchecked item destinations)', async () => {
    const card = page.locator(`#view-gates .gate[data-id="${gate.id}"]`);
    await card.locator('[data-act="preset"]').tap();
    const form = card.locator('form[data-form="preset"]');
    await expect(form).toBeVisible();
    await form.locator('input[name="xp"]').dispatchEvent('change');
    await form.locator('input[name="gold"]').dispatchEvent('change');
    await form.locator('input[name="crystal"]').dispatchEvent('change');
    await form.locator('[data-act="cancel-panel"]').tap();
    await expect(form).toHaveCount(0);
    const after = await page.evaluate(id => hunterApp.store.get().gates.find((g: any) => g.id === id)?.preset, gate.id);
    expect(after).toEqual(gate.preset);
  });

  await test.step('hunter title editor (preserves full desc bound, bonus, seedKey, band, worn, active)', async () => {
    await go(page, 'status');
    await page.locator('#view-status [data-jump="titles"]').tap();
    await page.locator(`#view-status [data-tedit="${titleSeed.id}"]`).tap();
    const form = page.locator('#view-status form[data-tform]');
    await expect(form).toBeVisible();
    await form.locator('button[type="submit"]').tap();
    await expect(form).toBeHidden();
    const after = await page.evaluate(id => hunterApp.store.get().hunters[0].titles.find((t: any) => t.id === id), titleSeed.id);
    expect(after).toEqual(titleSeed);
  });

  await test.step('guild editor (0.01% override rates and custom name)', async () => {
    await go(page, 'gm');
    const partyToggle = page.locator('#view-gm [data-tog="party"]');
    if ((await partyToggle.getAttribute('aria-expanded')) !== 'true') await partyToggle.tap();
    await page.locator(`#gm-board .gm-card[data-hid="${hunterId}"] [data-hguild]`).tap();
    const dlg = page.locator('.sys-overlay.show .sys-window');
    await expect(dlg).toBeVisible();
    await dlg.locator('.sys-actions button.primary').tap();
    await expect(dlg).toHaveCount(0);
    const after = await page.evaluate(() => hunterApp.store.get().hunters[0].guild);
    expect(after).toEqual(WORST_GUILD);
  });

  await test.step('GM rules overrides JSON editor (preserves rule overrides and gmTables)', async () => {
    const before = await page.evaluate(() => hunterApp.store.get().rulesOverrides);
    const rulesToggle = page.locator('#view-gm [data-tog="rules"]');
    if ((await rulesToggle.getAttribute('aria-expanded')) !== 'true') await rulesToggle.tap();
    await page.locator('#gm-r-save').tap();
    const after = await page.evaluate(() => hunterApp.store.get().rulesOverrides);
    expect(after).toEqual(before);
  });

  await test.step('GM roll tables editor (unranked urgent and ranked B encounter tables)', async () => {
    const before = await page.evaluate(() => hunterApp.store.get().rulesOverrides);
    const tablesToggle = page.locator('#view-gm [data-tog="tables"]');
    if ((await tablesToggle.getAttribute('aria-expanded')) !== 'true') await tablesToggle.tap();
    await page.locator('#gm-t-sel').selectOption('urgent');
    await page.locator('#gm-t-save').tap();
    await page.locator('#gm-t-sel').selectOption('encounter');
    await page.locator('#gm-t-rank').selectOption('B');
    await page.locator('#gm-t-save').tap();
    const after = await page.evaluate(() => hunterApp.store.get().rulesOverrides);
    expect(after).toEqual(before);
  });
});

test('Player-role editors: identity badge, self urgent quest, and bag item preserve hidden GM fields', async ({ device }) => {
  const page = (await device('player')).page;
  await onboardPlayer(page, 'Mira');

  await page.evaluate(f => hunterApp.store.update((d: any) => {
    const h = d.hunters[0];
    h.emblem = f.identity.emblem;
    h.color = f.identity.color;
    h.quests.push(f.selfQuest);
    h.items.push(f.consumable);
  }, 'test-setup'), {
    identity: WORST_IDENTITY,
    selfQuest: WORST_QUEST_SELF,
    consumable: WORST_ITEM_CONSUMABLE,
  });

  await test.step('identity emblem and color picker', async () => {
    await go(page, 'status');
    await page.locator('#view-status [data-emblem]').tap();
    const dlg = page.locator('.sys-overlay.show .sys-window');
    await expect(dlg).toBeVisible();
    await dlg.locator('.sys-actions button.primary').tap();
    await expect(dlg).toHaveCount(0);
    const after = await page.evaluate(() => ({
      emblem: hunterApp.store.get().hunters[0].emblem,
      color: hunterApp.store.get().hunters[0].color,
    }));
    expect(after).toEqual(WORST_IDENTITY);
  });

  await test.step('player-owned urgent quest preserves exact dueAt seconds', async () => {
    await go(page, 'quests');
    await page.locator(`#view-quests [data-edit="${WORST_QUEST_SELF.id}"]`).tap();
    const form = page.locator('#view-quests form[data-form]');
    await expect(form).toBeVisible();
    await form.locator('button[type="submit"]').tap();
    await expect(form).toBeHidden();
    const after = await page.evaluate(id => hunterApp.store.get().hunters[0].quests.find((q: any) => q.id === id), WORST_QUEST_SELF.id);
    expect(after).toEqual(WORST_QUEST_SELF);
  });

  await test.step('player bag item edit preserves GM-only revive, rankCap, and tell flags', async () => {
    await go(page, 'status');
    await page.locator('#view-status [data-jump="inventory"]').tap();
    const editBtn = page.locator(`#view-status [data-panel="inventory"] [data-edit-item="${WORST_ITEM_CONSUMABLE.id}"]`);
    await editBtn.scrollIntoViewIfNeeded();
    await editBtn.tap();
    const dlg = page.locator('.lf-overlay [role=dialog]');
    await expect(dlg).toBeVisible();
    await dlg.locator('[data-apply]').tap();
    await expect(dlg).toHaveCount(0);
    const after = await page.evaluate(id => hunterApp.store.get().hunters[0].items.find((x: any) => x.id === id), WORST_ITEM_CONSUMABLE.id);
    expect(after).toEqual(WORST_ITEM_CONSUMABLE);
  });
});
