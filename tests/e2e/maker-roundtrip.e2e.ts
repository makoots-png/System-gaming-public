// Parametrized browser round-trip suite: open a worst-case saved value in every maker and editor, save it unchanged,
// and assert nothing was lost or altered. Grouped into three sessions (Workshop makers, Non-Workshop GM editors,
// Player-role editors) to keep browser boot cost low while verifying every E2E entry in ROUNDTRIP_REGISTRY.
import { test, expect, onboardGM, onboardPlayer, go } from './helpers.ts';
import { giveTitle } from '../../src/core/hunter/record.ts';
import { newHunter } from '../../src/core/hunter/hunter.ts';
import { RULES } from '../../src/core/rules.ts';
import { parseFormula } from '../../src/core/formula.ts';
import { statusKey } from '../../src/core/combat/effect-ops.ts';
import { tiles } from '../../src/core/combat/space.ts';
import { parseStatusDef } from '../../src/core/combat/fight-parse.ts';
import type { Item } from '../../src/core/registry/items.ts';
import type { ItemDefData } from '../../src/core/registry/item-book.ts';
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
  WORST_ITEM_FINESSE,
  WORST_ITEM_TYPED_WEAPON,
  WORST_ITEM_WORN,
  WORST_MAP,
  WORST_MONSTER_BOSS,
  WORST_MONSTER_MYTHIC,
  WORST_NPC,
  WORST_OVERRIDES,
  WORST_QUEST_GM,
  WORST_QUEST_SELF,
  WORST_REWARDS,
  WORST_ROLL_TABLES,
  WORST_SKILL_ACTIVE,
  WORST_SKILL_DISPEL_HELPFUL,
  WORST_SKILL_GRIEVOUS,
  WORST_SKILL_PASSIVE,
  WORST_SKILL_REACTION,
  WORST_SKILL_SWAP,
  WORST_SKILL_TRUE,
  WORST_SKILL_ZONE_ERASE,
  WORST_STATUS_KITS,
  WORST_STATUS_OPS,
  WORST_STORY,
  worstGate,
} from '../fixtures/maker-fixtures.ts';

/** Explicit list of registry ids exercised in this browser suite; checked against E2E_MAKER_IDS below. */
const COVERED_E2E_IDS: readonly MakerId[] = [
  'status', 'item', 'skill', 'skill-swap', 'monster', 'npc', 'rewards', 'bundle', 'map', 'feat', 'story',
  'quest', 'gate', 'preset', 'title', 'guild', 'identity', 'rules-overrides', 'roll-tables',
  'typed-weapon', 'true-ability', 'grievous-cut', 'dispel-helpful', 'zone-erase', 'stacks-by', 'overhealed',
];

const mustFormula = (text: string) => {
  const p = parseFormula(text, RULES);
  if (!p.ok) throw new Error(p.error);
  return p.formula;
};

const WORST_STATUS_STACKS_BY = parseStatusDef({
  label: 'Hull Bank',
  desc: 'Converts blocked and lost damage into Wrath stacks.',
  ops: [],
  triggers: [
    {
      on: 'struck',
      tag: null,
      to: 'self',
      limit: { kind: 'round' },
      ops: [
        {
          op: 'applyStatus',
          key: statusKey('rt-wrath'),
          def: parseStatusDef({
            label: 'Wrath',
            desc: 'Stored force.',
            ops: [],
            stack: { cap: 20, leave: { kind: 'never' }, keep: 'fight', threshold: null },
          }, RULES)!,
          duration: null,
          stacksBy: mustFormula('(blocked + 0.5 * lost) / (0.025 * hpmax)'),
        },
        { op: 'refund', pct: 25 },
      ],
    },
    {
      on: 'struck',
      tag: null,
      to: 'other',
      limit: { kind: 'round' },
      ops: [
        { op: 'damage', type: 'physical', amount: mustFormula('0.25 * blocked'), when: 'use' },
        { op: 'reform', hpShare: 0.5, mana: 15 },
      ],
    },
  ],
}, RULES)!;

const WORST_STATUS_OVERHEALED = parseStatusDef({
  label: 'Solar Overflow',
  desc: 'Turns excess healing past max HP into solar fire.',
  ops: [],
  stack: { cap: 3, leave: { kind: 'event', event: 'overhealed' }, keep: 'fight', threshold: null },
  triggers: [
    {
      on: 'overhealed',
      to: { kind: 'most', of: 'hp', radius: tiles(6), on: 'foes' },
      limit: { kind: 'round' },
      ops: [{ op: 'damage', type: 'arcane', amount: mustFormula('0.75 * over'), when: 'use' }],
    },
  ],
}, RULES)!;

/** A by-value item fixture as the def the library keys by its id: no `id`, no `qty`. */
const defOf = ({ id: _id, qty: _qty, ...def }: Item): ItemDefData => def;
/** The worst-case item fixtures, each a library item of the GM's catalog in the Workshop session. */
const WORST_ITEMS = {
  bulwark: defOf(WORST_ITEM_BULWARK),
  worn: defOf(WORST_ITEM_WORN),
  finesse: defOf(WORST_ITEM_FINESSE),
  consumable: defOf(WORST_ITEM_CONSUMABLE),
  typedWeapon: defOf(WORST_ITEM_TYPED_WEAPON),
};

test('registry check: every e2e-registered maker and editor is exercised by this suite', () => {
  expect([...COVERED_E2E_IDS].sort()).toEqual([...E2E_MAKER_IDS].sort());
});

test('Workshop makers: open worst-case saved values across all eight kinds and save unchanged', async ({ device }) => {
  const page = (await device('gm')).page;
  await onboardGM(page);

  const itemIds = await page.evaluate(defs => {
    const ids = Object.fromEntries(Object.keys(defs).map(k => [k, hunterApp.store.itemDefId() as string]));
    hunterApp.store.update((d: any) => { for (const [k, def] of Object.entries(defs)) d.library.items[ids[k]!] = def; }, 'test-setup');
    return ids;
  }, WORST_ITEMS) as Record<keyof typeof WORST_ITEMS, string>;
  const libraryItem = (id: string) => page.evaluate(i => hunterApp.store.get().library.items[i], id);

  await page.evaluate(f => hunterApp.store.update((d: any) => {
    d.library.statuses['rt-ops'] = f.statusOps;
    d.library.statuses['rt-kits'] = f.statusKits;
    d.library.statuses['rt-stacks-by'] = f.statusStacksBy;
    d.library.statuses['rt-overhealed'] = f.statusOverhealed;
    d.library.skills.push(f.skillActive, f.skillReaction, f.skillPassive, f.skillSwap, f.skillTrue, f.skillGrievous, f.skillDispelHelpful, f.skillZoneErase);
    d.monsters.push(f.monsterMythic, f.monsterBoss);
    d.library.npcs.push(f.npc);
    d.library.rewards.push(f.bundle);
    d.library.maps.push(f.map);
    d.library.feats['rt-feat-after'] = f.featAfter;
    d.library.feats['rt-feat-count'] = f.featCount;
    d.library.stories.push(f.story);
  }, 'test-setup'), {
    statusOps: WORST_STATUS_OPS,
    statusKits: WORST_STATUS_KITS,
    statusStacksBy: WORST_STATUS_STACKS_BY,
    statusOverhealed: WORST_STATUS_OVERHEALED,
    skillActive: WORST_SKILL_ACTIVE,
    skillReaction: WORST_SKILL_REACTION,
    skillPassive: WORST_SKILL_PASSIVE,
    skillSwap: WORST_SKILL_SWAP,
    skillTrue: WORST_SKILL_TRUE,
    skillGrievous: WORST_SKILL_GRIEVOUS,
    skillDispelHelpful: WORST_SKILL_DISPEL_HELPFUL,
    skillZoneErase: WORST_SKILL_ZONE_ERASE,
    monsterMythic: WORST_MONSTER_MYTHIC,
    monsterBoss: WORST_MONSTER_BOSS,
    npc: WORST_NPC,
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
    { label: 'stacks-by (status trigger applyStatus with dynamic stacksBy formula)', ws: 'status', id: 'rt-stacks-by', overlay: '.fg-overlay', expected: WORST_STATUS_STACKS_BY, read: () => page.evaluate(() => hunterApp.store.get().library.statuses['rt-stacks-by']) },
    { label: 'overhealed (status trigger on overhealed using over formula count)', ws: 'status', id: 'rt-overhealed', overlay: '.fg-overlay', expected: WORST_STATUS_OVERHEALED, read: () => page.evaluate(() => hunterApp.store.get().library.statuses['rt-overhealed']) },
    { label: 'item (Bulwark Ring active.name)', ws: 'item', id: itemIds.bulwark, overlay: '.lf-overlay', expected: WORST_ITEMS.bulwark, read: () => libraryItem(itemIds.bulwark) },
    { label: 'item (worn weapon + worn icon/label + active)', ws: 'item', id: itemIds.worn, overlay: '.lf-overlay', expected: WORST_ITEMS.worn, read: () => libraryItem(itemIds.worn) },
    { label: 'item (finesse strike weapon with formula dice)', ws: 'item', id: itemIds.finesse, overlay: '.lf-overlay', expected: WORST_ITEMS.finesse, read: () => libraryItem(itemIds.finesse) },
    { label: 'item (consumable revive/rankCap/tell/target)', ws: 'item', id: itemIds.consumable, overlay: '.lf-overlay', expected: WORST_ITEMS.consumable, read: () => libraryItem(itemIds.consumable) },
    { label: 'typed-weapon (weapon with damageType true)', ws: 'item', id: itemIds.typedWeapon, overlay: '.lf-overlay', expected: WORST_ITEMS.typedWeapon, read: () => libraryItem(itemIds.typedWeapon) },
    { label: 'skill (active with null-duration zone + kits)', ws: 'skill', id: WORST_SKILL_ACTIVE.id, overlay: '.skm-overlay', expected: WORST_SKILL_ACTIVE, read: () => page.evaluate(id => hunterApp.store.get().library.skills.find((x: any) => x.id === id), WORST_SKILL_ACTIVE.id) },
    { label: 'skill (reaction)', ws: 'skill', id: WORST_SKILL_REACTION.id, overlay: '.skm-overlay', expected: WORST_SKILL_REACTION, read: () => page.evaluate(id => hunterApp.store.get().library.skills.find((x: any) => x.id === id), WORST_SKILL_REACTION.id) },
    { label: 'skill (passive large bonus + worn icon/label)', ws: 'skill', id: WORST_SKILL_PASSIVE.id, overlay: '.skm-overlay', expected: WORST_SKILL_PASSIVE, read: () => page.evaluate(id => hunterApp.store.get().library.skills.find((x: any) => x.id === id), WORST_SKILL_PASSIVE.id) },
    { label: 'skill (shadow swap movement, kit-parts)', ws: 'skill', id: WORST_SKILL_SWAP.id, overlay: '.skm-overlay', expected: WORST_SKILL_SWAP, read: () => page.evaluate(id => hunterApp.store.get().library.skills.find((x: any) => x.id === id), WORST_SKILL_SWAP.id) },
    { label: 'true-ability (active skill dealing true damage)', ws: 'skill', id: WORST_SKILL_TRUE.id, overlay: '.skm-overlay', expected: WORST_SKILL_TRUE, read: () => page.evaluate(id => hunterApp.store.get().library.skills.find((x: any) => x.id === id), WORST_SKILL_TRUE.id) },
    { label: 'grievous-cut (active skill applying Grievous Wounds at 25%)', ws: 'skill', id: WORST_SKILL_GRIEVOUS.id, overlay: '.skm-overlay', expected: WORST_SKILL_GRIEVOUS, read: () => page.evaluate(id => hunterApp.store.get().library.skills.find((x: any) => x.id === id), WORST_SKILL_GRIEVOUS.id) },
    { label: 'dispel-helpful (active skill dispelling helpful and harmful statuses)', ws: 'skill', id: WORST_SKILL_DISPEL_HELPFUL.id, overlay: '.skm-overlay', expected: WORST_SKILL_DISPEL_HELPFUL, read: () => page.evaluate(id => hunterApp.store.get().library.skills.find((x: any) => x.id === id), WORST_SKILL_DISPEL_HELPFUL.id) },
    { label: 'zone-erase (active skill erasing foe fields)', ws: 'skill', id: WORST_SKILL_ZONE_ERASE.id, overlay: '.skm-overlay', expected: WORST_SKILL_ZONE_ERASE, read: () => page.evaluate(id => hunterApp.store.get().library.skills.find((x: any) => x.id === id), WORST_SKILL_ZONE_ERASE.id) },
    { label: 'monster (mythic script)', ws: 'monster', id: WORST_MONSTER_MYTHIC.id, overlay: '.enm-overlay', expected: WORST_MONSTER_MYTHIC, read: () => page.evaluate(id => hunterApp.store.get().monsters.find((x: any) => x.id === id), WORST_MONSTER_MYTHIC.id) },
    { label: 'monster (extractable boss)', ws: 'monster', id: WORST_MONSTER_BOSS.id, overlay: '.enm-overlay', expected: WORST_MONSTER_BOSS, read: () => page.evaluate(id => hunterApp.store.get().monsters.find((x: any) => x.id === id), WORST_MONSTER_BOSS.id) },
    { label: 'npc (elite foe with abilities, statuses, tweaks, icon, notes)', ws: 'npc', id: WORST_NPC.id, overlay: '.npcm-overlay', expected: WORST_NPC, read: () => page.evaluate(id => hunterApp.store.get().library.npcs.find((x: any) => x.id === id), WORST_NPC.id) },
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

  await test.step('dispel-helpful UI toggle: switch to Helpful statuses / All of them and verify preview and saved op', async () => {
    const btn = page.locator(`#view-workshop [data-ws="skill"] [data-id="${WORST_SKILL_DISPEL_HELPFUL.id}"] [data-act="edit"]`);
    await btn.scrollIntoViewIfNeeded();
    await btn.tap();
    const dlg = page.locator('.skm-overlay [role=dialog]');
    await expect(dlg).toBeVisible();
    await expect(dlg.locator('.mk-preview')).toContainText('Removes the first helpful status');
    await expect(dlg.locator('.mk-preview')).toContainText('Cures every harmful status');
    await dlg.locator('[data-fx] [data-row="0"] [data-set="which"][data-v="all"]').tap();
    await expect(dlg.locator('.mk-preview')).toContainText('Removes every helpful status');
    await dlg.locator('[data-fx] [data-row="1"] [data-set="dispelKind"][data-v="helpful"]').tap();
    await dlg.locator('[data-apply]').tap();
    await expect(dlg).toHaveCount(0);
    const updated = await page.evaluate(id => hunterApp.store.get().library.skills.find((x: any) => x.id === id), WORST_SKILL_DISPEL_HELPFUL.id);
    expect(updated.ability.ops).toEqual([
      { op: 'dispel', which: 'all', kind: 'helpful' },
      { op: 'dispel', which: 'all', kind: 'helpful' },
    ]);
  });

  await test.step('zone-erase UI toggle: edit count and field name and verify preview and saved zoneAct', async () => {
    const btn = page.locator(`#view-workshop [data-ws="skill"] [data-id="${WORST_SKILL_ZONE_ERASE.id}"] [data-act="edit"]`);
    await btn.scrollIntoViewIfNeeded();
    await btn.tap();
    const dlg = page.locator('.skm-overlay [role=dialog]');
    await expect(dlg).toBeVisible();
    await expect(dlg.locator('.mk-preview')).toContainText('Erases up to 2 foe Mire nearest where you aim.');
    await expect(dlg.locator('[data-worth-line]')).toContainText('moving, resizing, or erasing a field');
    const moves = dlg.locator('details[data-group="moves"]');
    await moves.locator('summary').tap();
    await expect(moves.locator('[data-sum="moves"]')).toContainText('erases a foe field');
    await expect(moves.locator('[data-set="act"][data-v="erase"]')).toHaveAttribute('aria-pressed', 'true');
    await moves.locator('input[data-f="by"]').fill('1');
    await moves.locator('input[data-f="actZone"]').fill('');
    await expect(dlg.locator('.mk-preview')).toContainText('Erases up to 1 foe field nearest where you aim.');
    await dlg.locator('[data-apply]').tap();
    await expect(dlg).toHaveCount(0);
    const updated = await page.evaluate(id => hunterApp.store.get().library.skills.find((x: any) => x.id === id), WORST_SKILL_ZONE_ERASE.id);
    expect(updated.ability.zoneAct).toEqual({ act: 'erase', name: null, by: 1 });
  });

  await test.step('formula helper chips include blocked, lost, and over and insert their names', async () => {
    const btn = page.locator(`#view-workshop [data-ws="skill"] [data-id="${WORST_SKILL_TRUE.id}"] [data-act="edit"]`);
    await btn.scrollIntoViewIfNeeded();
    await btn.tap();
    const dlg = page.locator('.skm-overlay [role=dialog]');
    await expect(dlg).toBeVisible();
    const names = dlg.locator('details[data-group="names"]');
    await names.locator('summary').tap();
    const blockedChip = names.locator('[data-insert="blocked"]');
    const lostChip = names.locator('[data-insert="lost"]');
    const overChip = names.locator('[data-insert="over"]');
    await expect(blockedChip).toHaveText('Damage stopped by defense or shield');
    await expect(lostChip).toHaveText('HP damage past your shield');
    await expect(overChip).toHaveText('Excess healing past max HP');
    await blockedChip.tap();
    await expect(dlg.locator('[data-formula]')).toHaveValue(/blocked/);
    await lostChip.tap();
    await expect(dlg.locator('[data-formula]')).toHaveValue(/lost/);
    await overChip.tap();
    await expect(dlg.locator('[data-formula]')).toHaveValue(/over/);
    await dlg.locator('[data-cancel]').tap();
    await expect(dlg).toHaveCount(0);
  });

  await test.step('overhealed event label renders in Status Forge trigger and stack-expiry selects', async () => {
    const btn = page.locator('#view-workshop [data-ws="status"] [data-id="rt-overhealed"] [data-act="edit"]');
    await btn.scrollIntoViewIfNeeded();
    await btn.tap();
    const dlg = page.locator('.fg-overlay [role=dialog]');
    await expect(dlg).toBeVisible();
    await expect(dlg.locator('.mk-preview')).toContainText('When its bearer is overhealed:');
    const when = dlg.locator('details[data-group="when"]');
    await when.locator('summary').tap();
    await expect(when.locator('[data-tk="on"] option[value="overhealed"]')).toHaveText('When its bearer is overhealed');
    const stacks = dlg.locator('details[data-group="stacks"]');
    await stacks.locator('summary').tap();
    await expect(stacks.locator('[data-k="leaveEvent"] option[value="overhealed"]')).toHaveText('is overhealed');
    await dlg.locator('[data-cancel]').tap();
    await expect(dlg).toHaveCount(0);
  });
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
    d.library.npcs.push(f.npc);
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
    npc: WORST_NPC,
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
    consumable: { kind: 'adhoc', id: WORST_ITEM_CONSUMABLE.id, qty: WORST_ITEM_CONSUMABLE.qty, item: WORST_ITEMS.consumable },
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

  await test.step('a player\'s own bag item, edited, keeps the GM-only revive, rankCap and tell flags', async () => {
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
    expect(after).toEqual({ kind: 'adhoc', id: WORST_ITEM_CONSUMABLE.id, qty: WORST_ITEM_CONSUMABLE.qty, item: WORST_ITEMS.consumable });
  });
});
