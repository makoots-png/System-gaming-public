import { test, expect, onboardGM, onboardPlayer, createRoom, go, chooseList, dismissAll, ROOM_CODE } from './helpers.ts';
import { RULES } from '../../src/core/rules.ts';
import { PARTY_SCALE_WORDS, scaleMonsterForParty, scaleNpcForParty } from '../../src/core/gates/party-scale.ts';
import { monsterSheetOf, seedMonsters } from '../../src/core/registry/monsters.ts';
import { npcSheet } from '../../src/core/registry/npcs.ts';

const gateCard = (page: any, id: string) => page.locator(`#view-gates .gate[data-id="${id}"]`);

test('GM gate fights scale boss HP at fight start (1 hunter vs hunter + weighted ally NPC, setup edits, excluding foe NPCs)', async ({ device }) => {
  const gm = (await device('gm')).page;
  await onboardGM(gm);
  await chooseList(gm);

  // Add one saved Support ally NPC and one saved foe NPC so Start fight offers only the ally NPC.
  await gm.evaluate(() => {
    hunterApp.store.update((d: any) => {
      d.library.npcs = [
        ...(d.library.npcs || []),
        {
          id: 'npc_101',
          name: 'Vanguard Ally',
          rank: 'C',
          archetype: 'brute',
          tier: 'normal',
          tweak: { hp: 1.08, dealt: 0.93, stats: {}, traits: [] },
          defaultSide: 'party',
          skill: 3,
          abilities: [],
          statuses: [],
          notes: '',
        },
        {
          id: 'npc_102',
          name: 'Rival Foe',
          rank: 'C',
          archetype: 'skirmisher',
          tier: 'normal',
          tweak: { hp: 1, dealt: 1, stats: {}, traits: [] },
          defaultSide: 'foe',
          skill: 3,
          abilities: [],
          statuses: [],
          notes: '',
        },
      ];
    }, 'test-setup');
  });

  await go(gm, 'gates');
  const spawnForm = gm.locator('#view-gates form.gt-spawn');
  await spawnForm.locator('select[name="rank"]').selectOption('C');
  await spawnForm.locator('select[name="type"]').selectOption('normal');
  await spawnForm.locator('button[type="submit"]').tap();

  const { gateId, partyCount } = await gm.evaluate(() => ({
    gateId: hunterApp.store.get().gates[0].id as string,
    partyCount: hunterApp.store.get().hunters.length,
  }));
  expect(partyCount).toBeGreaterThanOrEqual(2);

  // Assign deterministic Cerberus boss so HP math is exact.
  const card = gateCard(gm, gateId);
  await card.locator('[data-act="edit"]').tap();
  const eform = card.locator('form[data-form="edit"]');
  await eform.locator('select[name="boss"]').selectOption('seed:cerberus');
  await eform.locator('button[type="submit"]').tap();
  await expect(card.locator('[data-party-size]')).toHaveText(PARTY_SCALE_WORDS.cardSize(partyCount));

  const cerberus = seedMonsters(RULES).find(m => m.id === 'seed:cerberus')!;
  const expectedBossHp = (n: number) =>
    monsterSheetOf(scaleMonsterForParty(cerberus, { difficulty: { gate: { at: 'default' }, boss: { at: 'follows' } } }, 'boss', n, RULES), RULES).hpMax;
  const supWeight = RULES.fight.partyScale.allyWeight.support;

  // 1. Open Start fight dialog: verify Ally NPCs lists Vanguard Ally and NEVER Rival Foe.
  await card.locator('[data-act="encounter"]').tap();
  const modal = gm.locator('[aria-modal="true"]');
  await expect(modal).toBeVisible();
  await expect(modal.locator('[data-party-scale]')).toHaveText(PARTY_SCALE_WORDS.dialogSize(partyCount));
  await expect(modal.locator('[data-npc-pick]')).toContainText('Vanguard Ally');
  await expect(modal.locator('[data-npc-pick]')).not.toContainText('Rival Foe');

  // Uncheck all hunters except the first -> live dialog readout drops to 1 person.
  const hBoxes = modal.locator('input[name="hid"]');
  const hCount = await hBoxes.count();
  for (let i = 1; i < hCount; i++) await hBoxes.nth(i).uncheck();
  await expect(modal.locator('[data-party-scale]')).toHaveText(PARTY_SCALE_WORDS.dialogSize(1));

  // Uncheck "Start the fight now" so the fight opens in setup, then add a 2nd hunter in setup before starting -> sizes for 2!
  await modal.locator('input[name="roll"]').uncheck();
  await modal.locator('[data-apply]').tap();
  await expect(gm.locator('#view-combat [data-start]').first()).toBeVisible();
  const setupCheck = await gm.evaluate(() => ({
    phase: hunterApp.store.get().fight?.phase,
    partyScaled: hunterApp.store.get().fight?.partyScaled,
  }));
  expect(setupCheck).toEqual({ phase: 'setup', partyScaled: true });

  // Add the whole party during setup, then tap Start fight -> sizedFor locks to full partyCount!
  await gm.locator('#view-combat [data-addparty]').tap();
  await gm.locator('#view-combat [data-start]').first().tap();
  await expect(gm.locator('#view-combat [data-next]').first()).toBeVisible();
  const fullPartyFight = await gm.evaluate(() => {
    const f = hunterApp.store.get().fight;
    const row = f?.rows?.find((r: any) => r.name === 'Cerberus');
    return { sizedFor: f?.sizedFor, hp: row ? row.sheet.hpMax : 0 };
  });
  expect(fullPartyFight.sizedFor).toBe(partyCount);
  expect(fullPartyFight.hp).toBe(expectedBossHp(partyCount));

  // End without XP so we can restart the same gate with 1 hunter + 1 Support ally NPC (= 1.2 weighted people).
  await gm.locator('#view-combat [data-end]').first().tap();
  await gm.locator('.sys-overlay.show .sys-actions button', { hasText: 'End without XP' }).first().tap();
  await dismissAll(gm);

  await go(gm, 'gates');
  await gateCard(gm, gateId).locator('[data-act="encounter"]').tap();
  const modal2 = gm.locator('[aria-modal="true"]');
  const hBoxes2 = modal2.locator('input[name="hid"]');
  for (let i = 1; i < (await hBoxes2.count()); i++) await hBoxes2.nth(i).uncheck();
  await modal2.locator('input[name="nid"]').first().check();
  const withSupHead = 1 + supWeight;
  await expect(modal2.locator('[data-party-scale]')).toHaveText(PARTY_SCALE_WORDS.dialogSize(withSupHead));
  await modal2.locator('[data-apply]').tap();
  await expect(gm.locator('#view-combat [data-end]').first()).toBeVisible();

  const allyFight = await gm.evaluate(() => {
    const f = hunterApp.store.get().fight;
    const row = f?.rows?.find((r: any) => r.name === 'Cerberus');
    return { sizedFor: f?.sizedFor, hp: row ? row.sheet.hpMax : 0 };
  });
  expect(allyFight.sizedFor).toBe(withSupHead);
  expect(allyFight.hp).toBe(expectedBossHp(withSupHead));
  expect(allyFight.hp).toBeGreaterThan(expectedBossHp(1));
  expect(allyFight.hp).toBeLessThan(expectedBossHp(2));

  // End fight, then add Vanguard Ally (party) and Rival Foe (foe) directly to the gate's roster via Edit gate.
  await gm.locator('#view-combat [data-end]').first().tap();
  await gm.locator('.sys-overlay.show .sys-actions button', { hasText: 'End without XP' }).first().tap();
  await dismissAll(gm);

  await go(gm, 'gates');
  const card3 = gateCard(gm, gateId);
  await card3.locator('[data-act="edit"]').tap();
  const eform3 = card3.locator('form[data-form="edit"]');
  const addNpcBtn = eform3.locator('[data-act="add-npc"]');
  await addNpcBtn.tap();
  await eform3.locator('[data-nrow]').nth(0).locator('select[name="nid"]').selectOption('npc_101');
  await addNpcBtn.tap();
  await eform3.locator('[data-nrow]').nth(1).locator('select[name="nid"]').selectOption('npc_102');
  await eform3.locator('input[name="solo"]').check();
  await expect(eform3.locator('[data-solo-npc-note]')).toBeVisible();
  await eform3.locator('button[type="submit"]').tap();

  // GM card preview now counts partyCount + supWeight (never Rival Foe), and scales both boss and foe NPC HP.
  const expectedPreviewHead = Math.round((partyCount + supWeight) * 1000) / 1000;
  await expect(card3.locator('[data-party-size]')).toHaveText(PARTY_SCALE_WORDS.cardSize(expectedPreviewHead));
  await expect(card3.locator('.gt-mons li.boss')).toContainText(`HP ${expectedBossHp(expectedPreviewHead).toLocaleString('en-US')}`);

  const foeNpcDef = {
    rank: 'C' as const,
    archetype: 'skirmisher' as const,
    tier: 'normal' as const,
    tweak: { hp: 1, dealt: 1, stats: {}, traits: [] },
  };
  const allyNpcDef = {
    rank: 'C' as const,
    archetype: 'brute' as const,
    tier: 'normal' as const,
    tweak: { hp: 1.08, dealt: 0.93, stats: {}, traits: [] },
  };
  const defGate = { difficulty: { gate: { at: 'default' as const }, boss: { at: 'follows' as const } } };
  const expectedFoeNpcHp = (n: number) => npcSheet(scaleNpcForParty(foeNpcDef, 'foe', defGate, n, RULES), RULES).hpMax;
  const expectedAllyNpcHp = npcSheet(allyNpcDef, RULES).hpMax;

  await expect(card3.locator('[data-gate-npc="npc_102"]')).toContainText(`HP ${expectedFoeNpcHp(expectedPreviewHead).toLocaleString('en-US')}`);
  await expect(card3.locator('[data-gate-npc="npc_101"]')).toContainText(`HP ${expectedAllyNpcHp.toLocaleString('en-US')}`);

  // Solo card shows the gate's monsters AND gate NPCs (Fork 5).
  const soloWorldCard = gm.locator(`#view-gates .gate.solo[data-solo="world:${gateId}"]`);
  await expect(soloWorldCard).toContainText('Vanguard Ally');
  await expect(soloWorldCard).toContainText('Rival Foe');

  // Open Start fight with 1 hunter checked -> dialog counts 1 hunter + 1 gate Support ally NPC = 1.2 weighted people.
  await card3.locator('[data-act="encounter"]').tap();
  const modal3 = gm.locator('[aria-modal="true"]');
  await expect(modal3.locator('[data-party-scale]')).toHaveText(PARTY_SCALE_WORDS.dialogSize(expectedPreviewHead));
  const hBoxes3 = modal3.locator('input[name="hid"]');
  for (let i = 1; i < (await hBoxes3.count()); i++) await hBoxes3.nth(i).uncheck();
  await expect(modal3.locator('[data-party-scale]')).toHaveText(PARTY_SCALE_WORDS.dialogSize(withSupHead));
  await modal3.locator('[data-apply]').tap();
  await expect(gm.locator('#view-combat [data-end]').first()).toBeVisible();

  const rosterFight = await gm.evaluate(() => {
    const f = hunterApp.store.get().fight;
    const rows = f?.rows ?? [];
    const hpOf = (name: string) => rows.find((r: any) => r.name === name)?.sheet.hpMax ?? 0;
    return { sizedFor: f?.sizedFor, boss: hpOf('Cerberus'), foeNpc: hpOf('Rival Foe'), allyNpc: hpOf('Vanguard Ally') };
  });
  expect(rosterFight.sizedFor).toBe(withSupHead);
  expect(rosterFight.boss).toBe(expectedBossHp(withSupHead));
  expect(rosterFight.foeNpc).toBe(expectedFoeNpcHp(withSupHead));
  expect(rosterFight.allyNpc).toBe(expectedAllyNpcHp);
});

test('room player, mid-fight join, and joined wave lock sizedFor without resizing existing foes', async ({ device }) => {
  const gm = (await device('gm')).page;
  const player = (await device('player')).page;
  await onboardGM(gm);
  await chooseList(gm);

  // Replace pregens with 1 untouched local placeholder so defaultParty skips it in a room, and create a room.
  const code = await createRoom(gm);
  expect(code).toMatch(ROOM_CODE);
  await onboardPlayer(player, 'Kai Room', code);
  await expect.poll(() => gm.evaluate(() => hunterApp.api.sync.remoteSheets().some((r: any) => r.data && r.data.name === 'Kai Room'))).toBe(true);
  await dismissAll(player, 4);

  // Create a two-wave C-rank gate: Wave 1 Goblin, Wave 2 Cerberus boss.
  await go(gm, 'gates');
  const spawnForm = gm.locator('#view-gates form.gt-spawn');
  await spawnForm.locator('select[name="rank"]').selectOption('C');
  await spawnForm.locator('select[name="type"]').selectOption('normal');
  await spawnForm.locator('button[type="submit"]').tap();

  const gateId = await gm.evaluate(() => hunterApp.store.get().gates[0].id as string);
  await gm.evaluate((gid: string) => {
    hunterApp.store.update((d: any) => {
      const g = d.gates.find((x: any) => x.id === gid);
      g.monsters = [
        { monsterId: 'seed:goblin', count: 1, wave: 1 },
        { monsterId: 'seed:high-orc', count: 1, wave: 2 },
      ];
      g.bossId = 'seed:cerberus';
    }, 'test-waves');
  }, gateId);

  const goblin = seedMonsters(RULES).find(m => m.id === 'seed:goblin')!;
  const cerberus = seedMonsters(RULES).find(m => m.id === 'seed:cerberus')!;
  const defGate = { difficulty: { gate: { at: 'default' as const }, boss: { at: 'follows' as const } } };
  const expectedGobHp = (n: number) => monsterSheetOf(scaleMonsterForParty(goblin, defGate, 'pack', n, RULES), RULES).hpMax;
  const expectedBossHp = (n: number) => monsterSheetOf(scaleMonsterForParty(cerberus, defGate, 'boss', n, RULES), RULES).hpMax;

  // Open Start fight for Wave 1: Kai Room (remote) is checked by default; uncheck all local hunters so only Kai Room fights (sizedFor = 1).
  const card = gateCard(gm, gateId);
  await card.locator('[data-act="encounter"]').tap();
  const modal = gm.locator('[aria-modal="true"]');
  await expect(modal.locator('input[name="rkey"]')).toBeChecked();
  const localBoxes = modal.locator('input[name="hid"]');
  for (let i = 0; i < (await localBoxes.count()); i++) await localBoxes.nth(i).uncheck();
  await expect(modal.locator('[data-party-scale]')).toHaveText(PARTY_SCALE_WORDS.dialogSize(1));
  await modal.locator('[data-apply]').tap();
  await expect(gm.locator('#view-combat [data-next]').first()).toBeVisible();

  const wave1Start = await gm.evaluate(() => {
    const f = hunterApp.store.get().fight;
    const gob = f?.rows?.find((r: any) => r.name === 'Goblin');
    return { sizedFor: f?.sizedFor, gobHp: gob?.sheet.hpMax ?? 0 };
  });
  expect(wave1Start.sizedFor).toBe(1);
  expect(wave1Start.gobHp).toBe(expectedGobHp(1));

  // Mid-fight join: GM taps "Add whole party" while Wave 1 is running -> late local hunters join, but sizedFor stays 1 and Goblin HP does NOT resize!
  await gm.locator('#view-combat [data-addparty]').tap();
  const afterMidJoin = await gm.evaluate(() => {
    const f = hunterApp.store.get().fight;
    const gob = f?.rows?.find((r: any) => r.name === 'Goblin');
    const hunters = (f?.rows ?? []).filter((r: any) => r.kind === 'hunter' && !r.npc).length;
    return { sizedFor: f?.sizedFor, gobHp: gob?.sheet.hpMax ?? 0, hunters };
  });
  expect(afterMidJoin.hunters).toBeGreaterThan(1);
  expect(afterMidJoin.sizedFor).toBe(1);
  expect(afterMidJoin.gobHp).toBe(expectedGobHp(1));

  // GM gate card reads locked sizedFor (1), not live row count!
  await go(gm, 'gates');
  await expect(gateCard(gm, gateId).locator('[data-party-size]')).toHaveText(PARTY_SCALE_WORDS.cardLocked(1));

  // Joined wave: start Wave 2 into the running fight -> dialog says locked at 1, Wave 2 Cerberus enters scaled for 1, Wave 1 Goblin stays unchanged.
  await gateCard(gm, gateId).locator('[data-act="encounter"]').tap();
  const modalW2 = gm.locator('[aria-modal="true"]');
  await modalW2.locator('input[name="wave"][value="2"]').check();
  await expect(modalW2.locator('[data-party-scale]')).toHaveText(PARTY_SCALE_WORDS.dialogLocked(1));
  await modalW2.locator('[data-apply]').tap();
  await expect(gm.locator('#view-combat [data-next]').first()).toBeVisible();

  const afterWave2 = await gm.evaluate(() => {
    const f = hunterApp.store.get().fight;
    const gob = f?.rows?.find((r: any) => r.name === 'Goblin');
    const boss = f?.rows?.find((r: any) => r.name === 'Cerberus');
    return { sizedFor: f?.sizedFor, gobHp: gob?.sheet.hpMax ?? 0, bossHp: boss?.sheet.hpMax ?? 0 };
  });
  expect(afterWave2.sizedFor).toBe(1);
  expect(afterWave2.gobHp).toBe(expectedGobHp(1));
  expect(afterWave2.bossHp).toBe(expectedBossHp(1));
});

test('a GM clock 10 minutes fast still keeps a live room player in defaultParty via sync.serverNow()', async ({ device }) => {
  const gmDev = await device('gm');
  const gm = gmDev.page;
  // Shift only the GM page's Date.now 10 minutes ahead of real server time.
  await gm.addInitScript(() => {
    const shift = 10 * 60_000;
    const realNow = Date.now.bind(Date);
    Date.now = () => realNow() + shift;
  });
  const player = (await device('player')).page;

  await onboardGM(gm);
  await chooseList(gm);
  const code = await createRoom(gm);
  expect(code).toMatch(ROOM_CODE);
  await onboardPlayer(player, 'Skewed Kai', code);
  await expect.poll(() => gm.evaluate(() => hunterApp.api.sync.remoteSheets().some((r: any) => r.data && r.data.name === 'Skewed Kai'))).toBe(true);
  await dismissAll(player, 4);

  // Confirm the GM clock really is ~10 minutes ahead of serverNow(), and the room player stays checked by default.
  const skewDelta = await gm.evaluate(() => Date.now() - hunterApp.api.sync.serverNow());
  expect(skewDelta).toBeGreaterThan(8 * 60_000);

  await go(gm, 'gates');
  const spawnForm = gm.locator('#view-gates form.gt-spawn');
  await spawnForm.locator('select[name="rank"]').selectOption('C');
  await spawnForm.locator('select[name="type"]').selectOption('normal');
  await spawnForm.locator('button[type="submit"]').tap();
  const gateId = await gm.evaluate(() => hunterApp.store.get().gates[0].id as string);

  await gateCard(gm, gateId).locator('[data-act="encounter"]').tap();
  const modal = gm.locator('[aria-modal="true"]');
  await expect(modal.locator('input[name="rkey"]')).toBeChecked();
  await modal.locator('[data-apply]').tap();
  await expect(gm.locator('#view-combat [data-end]').first()).toBeVisible();
  const hasKai = await gm.evaluate(() => (hunterApp.store.get().fight?.rows ?? []).some((r: any) => r.name === 'Skewed Kai'));
  expect(hasKai).toBe(true);
});
