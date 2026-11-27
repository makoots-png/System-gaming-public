// Browser tests for NPC unit 3 (row, wire, Add NPC to fight, and Auto turn):
// two-phone parity (ally NPC exact HP, foe NPC band-only, dead foe NPC tile blocking, skill and notes hidden on player phone)
// and GM fight drawer picker with count + Auto turn on an NPC's turn.
import type { Page } from '@playwright/test';
import { newNpc, npcTierPreset } from '../../src/core/registry/npcs.ts';
import { shortOf } from '../../src/core/combat/map-view.ts';
import { test, expect, setupGoblinDenGM, onboardPlayer, createRoom, dismissAll, go, fightRow, chooseList, setupDoc, PHONE, SMALL_PHONE } from './helpers.ts';

const HUNTER = 'Kai Npc';
const ALLY_NAME = 'Mira Scout';
const FOE_NAME = 'Rival Vance';
const ALLY_NOTE = 'GM secret ally note';
const FOE_NOTE = 'GM secret foe note';

const combat = (page: Page) => page.locator('#view-combat');
const hudRow = (player: Page, name: string) => combat(player).locator('.tb-row', { hasText: name });
const lowestDice = (page: Page) => page.evaluate(() =>
  Object.defineProperty(crypto, 'getRandomValues', { configurable: true, value: (a: Uint32Array) => a.fill(0) }));

async function seedNpcs(gm: Page) {
  const ally = {
    ...newNpc({ name: ALLY_NAME, rank: 'E', archetype: 'skirmisher', defaultSide: 'party', skill: 4, icon: 'bow', notes: ALLY_NOTE }),
    id: 'npc_101',
  };
  const foe = {
    ...newNpc({ name: FOE_NAME, rank: 'E', archetype: 'brute', ...npcTierPreset('elite'), defaultSide: 'foe', skill: 2, icon: 'skull', notes: FOE_NOTE }),
    id: 'npc_102',
  };
  await gm.evaluate(([a, f]) => hunterApp.store.update((d: any) => {
    d.library.npcs = [a, f];
  }, 'test-setup'), [ally, foe] as const);
}

test('two phones: ally NPC shows exact HP, foe NPC shows band only, dead foe tile stays on map and blocks movement, and skill stays hidden on player phone', async ({ device }) => {
  const gm = (await device('gm', { viewport: SMALL_PHONE })).page;
  const player = (await device('player', { viewport: PHONE })).page;

  await setupGoblinDenGM(gm);
  await chooseList(gm);
  await seedNpcs(gm);
  const code = await createRoom(gm);
  await onboardPlayer(player, HUNTER, code);
  await chooseList(player);
  await expect.poll(() => player.evaluate(() => hunterApp.api.sync.room())).toBe(code);
  await dismissAll(player, 4);
  await go(gm, 'gm');
  await expect(gm.locator('#gm-board .gm-card.remote', { hasText: HUNTER })).toHaveCount(1);

  await test.step('GM adds player hunter, 1 ally NPC, and 2 foe NPCs via Add NPC to fight at 360 px', async () => {
    await go(gm, 'combat');
    const addBtn = combat(gm).locator('[data-addn]');
    await expect(addBtn).toBeVisible();
    await expect(addBtn).toHaveText('Add NPC to fight');
    const box = (await addBtn.boundingBox())!;
    expect(box.height, 'Add NPC to fight tap target >= 44 px').toBeGreaterThanOrEqual(44);
    expect(await gm.evaluate(() => document.scrollingElement!.scrollWidth <= innerWidth), 'no sideways scroll at 360 px').toBe(true);

    // Add player hunter.
    await combat(gm).locator('[data-hsel]').selectOption({ label: `${HUNTER} (player phone)` });
    await combat(gm).locator('[data-addh]').tap();

    // Add 1 ally NPC (Fights for defaults to party).
    await combat(gm).locator('[data-nsel]').selectOption('npc_101');
    await expect(combat(gm).locator('[data-nside]')).toHaveValue('party');
    await combat(gm).locator('[data-ncount]').fill('1');
    await addBtn.tap();

    // Add 2 foe NPCs (Fights for switches to foe; auto-lettered A and B).
    await combat(gm).locator('[data-nsel]').selectOption('npc_102');
    await expect(combat(gm).locator('[data-nside]')).toHaveValue('foe');
    await combat(gm).locator('[data-ncount]').fill('2');
    await addBtn.tap();

    await combat(gm).locator('[data-start]').tap();
    await expect(combat(gm).locator('.cmb-row.cur')).toHaveCount(1);

    // Arrange positions deterministically: Kai at (2, 2), ally at (2, 1), foe A at (2, 3), foe B at (6, 6).
    await gm.evaluate(([hName, aName, fName]) => hunterApp.store.update((d: any) => {
      const f = d.fight;
      const kai = f.rows.find((r: any) => r.name === hName);
      const ally = f.rows.find((r: any) => r.name === aName);
      const foeA = f.rows.find((r: any) => r.name === `${fName} A`);
      const foeB = f.rows.find((r: any) => r.name === `${fName} B`);
      kai.place = { x: 2, y: 2 }; kai.at = f.now; kai.tie = 0;
      ally.place = { x: 2, y: 1 }; ally.at = f.now + 10; ally.tie = 0;
      foeA.place = { x: 2, y: 3 }; foeA.at = f.now + 20; foeA.tie = 0;
      foeB.place = { x: 6, y: 6 }; foeB.at = f.now + 30; foeB.tie = 0;
      f.currentId = kai.id;
      f.log = [];
    }, 'test-setup'), [HUNTER, ALLY_NAME, FOE_NAME] as const);

    // GM cards show Ally NPC and Foe NPC badges.
    await combat(gm).locator('.cmb-row', { hasText: ALLY_NAME }).locator('.cmb-pick').tap();
    await expect(combat(gm).locator('.cmb-card')).toContainText('Ally NPC');
    await combat(gm).locator('.cmb-row', { hasText: `${FOE_NAME} A` }).locator('.cmb-pick').tap();
    await expect(combat(gm).locator('.cmb-card')).toContainText('Foe NPC');
  });

  await setupDoc(player, HUNTER, { x: 2, y: 2 });
  await go(player, 'combat');
  await expect(combat(player).locator('.tb-mine')).toContainText('YOUR TURN');

  const allyRow = await fightRow(gm, ALLY_NAME);
  const foeARow = await fightRow(gm, `${FOE_NAME} A`);

  await test.step('player phone shows ally NPC exact HP, foe NPC band only, and hides skill and GM notes', async () => {
    await expect(hudRow(player, ALLY_NAME)).toContainText(`${allyRow.hp}/${allyRow.sheet.hpMax}`);
    await expect(hudRow(player, `${FOE_NAME} A`)).toContainText('Healthy');
    await expect(hudRow(player, `${FOE_NAME} A`)).not.toContainText(`${foeARow.hp}/${foeARow.sheet.hpMax}`);
    await expect(hudRow(player, `${FOE_NAME} A`)).not.toContainText(String(foeARow.sheet.hpMax));

    // Damage foe A to ~60% HP on GM phone -> player sees Wounded, still no exact HP.
    const dmg = Math.floor(foeARow.sheet.hpMax * 0.4);
    await gm.evaluate(([id, n]) => hunterApp.api.combat.adjust(id, { hp: -n }), [foeARow.id, dmg] as const);
    await expect(hudRow(player, `${FOE_NAME} A`)).toContainText('Wounded', { timeout: 15_000 });
    await expect(hudRow(player, `${FOE_NAME} A`)).not.toContainText(String(foeARow.sheet.hpMax));

    // Room fight doc on player phone carries no foe HP, no skill, and no GM notes.
    const docCheck = await player.evaluate(([allyId, foeId, aNote, fNote]) => {
      const doc = hunterApp.api.sync.doc('fight');
      const raw = JSON.stringify(doc);
      const a = doc.rows.find((r: any) => r.id === allyId);
      const f = doc.rows.find((r: any) => r.id === foeId);
      return {
        allyKind: a?.kind, allyHasHp: a?.hp != null,
        foeKind: f?.kind, foeHasHp: 'hp' in (f || {}), foeHasHpMax: 'hpMax' in (f || {}),
        foeHasStride: 'stride' in (f || {}), foeHasMove: 'move' in (f || {}),
        hasSkillWord: raw.includes('skill'),
        hasNpcKey: raw.includes('"npc"'),
        hasNotes: raw.includes(aNote) || raw.includes(fNote),
      };
    }, [allyRow.id, foeARow.id, ALLY_NOTE, FOE_NOTE] as const);
    expect(docCheck).toEqual({
      allyKind: 'hunter', allyHasHp: true,
      foeKind: 'hunter', foeHasHp: false, foeHasHpMax: false,
      foeHasStride: false, foeHasMove: false,
      hasSkillWord: false, hasNpcKey: false, hasNotes: false,
    });
    const playerText = await combat(player).innerText();
    expect(playerText).not.toContain(ALLY_NOTE);
    expect(playerText).not.toContain(FOE_NOTE);
    expect(playerText).not.toContain('How well this NPC plays');
  });

  await test.step('dead foe NPC reads Dead on player phone, stays on map at its tile, and blocks movement on both phones', async () => {
    await combat(gm).locator('.cmb-row', { hasText: `${FOE_NAME} A` }).locator('.cmb-pick').tap();
    await combat(gm).locator('.cmb-card [data-defeat]').tap();

    await expect(hudRow(player, `${FOE_NAME} A`).locator('.lw')).toHaveText('Dead', { timeout: 15_000 });
    await expect(hudRow(player, `${FOE_NAME} A`)).not.toContainText('Down');
    await expect(hudRow(player, `${FOE_NAME} A`)).not.toContainText(String(foeARow.sheet.hpMax));

    // Switch player phone to Map view: dead foe NPC token remains at (2, 3), lettered copies A and B are told apart on both phones, and dead foe opens band/Dead sheet with no HP.
    await combat(player).locator('[data-fview="map"]').tap();
    const foeBRow = await fightRow(gm, `${FOE_NAME} B`);
    const deadTok = combat(player).locator(`[data-mapbox] [data-tok="${foeARow.id}"]`);
    const foeBTok = combat(player).locator(`[data-mapbox] [data-tok="${foeBRow.id}"]`);
    const foePlateA = shortOf(`${FOE_NAME} A`, true);
    const foePlateB = shortOf(`${FOE_NAME} B`, true);
    await expect(deadTok).toBeVisible();
    await expect(deadTok).toHaveClass(/\bdown\b/);
    await expect(deadTok.locator('.mp-pk')).toHaveText('A');
    await expect(deadTok.locator('.mp-name')).toHaveText(foePlateA);
    await expect(foeBTok.locator('.mp-pk')).toHaveText('B');
    await expect(foeBTok.locator('.mp-name')).toHaveText(foePlateB);

    // GM map also tells lettered NPC copies A and B apart.
    await combat(gm).locator('[data-fview="map"]').tap();
    await expect(combat(gm).locator(`[data-mapbox] [data-tok="${foeARow.id}"] .mp-pk`)).toHaveText('A');
    await expect(combat(gm).locator(`[data-mapbox] [data-tok="${foeARow.id}"] .mp-name`)).toHaveText(foePlateA);
    await expect(combat(gm).locator(`[data-mapbox] [data-tok="${foeBRow.id}"] .mp-pk`)).toHaveText('B');
    await expect(combat(gm).locator(`[data-mapbox] [data-tok="${foeBRow.id}"] .mp-name`)).toHaveText(foePlateB);

    // Tap dead foe NPC token to open its card sheet: shows Dead, no HP numbers.
    await deadTok.tap();
    const sheet = combat(player).locator('[data-tbsheet]');
    await expect(sheet).toBeVisible();
    await expect(sheet).toContainText(`${FOE_NAME} A`);
    await expect(sheet).toContainText('Dead');
    await expect(sheet).not.toContainText(`HP 0 /`);
    await expect(sheet).not.toContainText(String(foeARow.sheet.hpMax));
    await sheet.locator('[data-tbsheetx]').tap();

    // Tap ally NPC token: shows exact HP.
    await combat(player).locator(`[data-mapbox] [data-tok="${allyRow.id}"]`).tap();
    await expect(sheet).toBeVisible();
    await expect(sheet).toContainText(`HP ${allyRow.hp} / ${allyRow.sheet.hpMax}`);
    await sheet.locator('[data-tbsheetx]').tap();

    // Posting a step onto the dead foe NPC's tile (2, 3) is refused as `taken` by the GM and Kai stays at (2, 2).
    await player.evaluate(([x, y]) => {
      const S = hunterApp.api.sync;
      const h = hunterApp.store.active();
      const doc = S.doc('fight');
      S.post(S.event('step', { by: S.myKey(h.id), place: { x, y }, at: doc.now, dash: false }));
      void S.flush();
    }, [2, 3] as const);
    await expect.poll(async () => player.evaluate(() => hunterApp.api.sync.doc('fight')?.refused?.reason ?? null), { timeout: 15_000 }).toBe('taken');
    const afterStep = await gm.evaluate(([hName]) => {
      const f = hunterApp.store.get().fight;
      const kai = f.rows.find((r: any) => r.name === hName);
      return kai?.place;
    }, [HUNTER] as const);
    expect(afterStep).toEqual({ x: 2, y: 2 });
  });
});

test('GM Auto turn runs an active NPC turn in List view', async ({ device }) => {
  const gm = (await device('gm-auto', { viewport: SMALL_PHONE })).page;
  await setupGoblinDenGM(gm);
  await chooseList(gm);
  await seedNpcs(gm);
  await go(gm, 'combat');

  await combat(gm).locator('[data-nsel]').selectOption('npc_101');
  await combat(gm).locator('[data-addn]').tap();
  await combat(gm).locator('[data-nsel]').selectOption('npc_102');
  await combat(gm).locator('[data-addn]').tap();
  await combat(gm).locator('[data-start]').tap();
  await expect(combat(gm).locator('.cmb-row.cur')).toHaveCount(1);

  await gm.evaluate(([aName, fName]) => hunterApp.store.update((d: any) => {
    const f = d.fight;
    const ally = f.rows.find((r: any) => r.name === aName);
    const foe = f.rows.find((r: any) => r.name === fName);
    ally.place = { x: 4, y: 4 }; ally.at = f.now; ally.tie = 0;
    foe.place = { x: 4, y: 5 }; foe.at = f.now + 20; foe.tie = 0;
    f.currentId = ally.id;
    f.log = [];
  }, 'test-setup'), [ALLY_NAME, FOE_NAME] as const);

  const card = combat(gm).locator('.cmb-card.turn');
  await expect(card).toContainText('Ally NPC');
  const autoBtn = card.locator('[data-auto]');
  await expect(autoBtn).toBeVisible();
  await expect(autoBtn).toHaveText('Auto turn');
  expect((await autoBtn.boundingBox())!.height).toBeGreaterThanOrEqual(44);

  const beforeHp = (await fightRow(gm, FOE_NAME)).hp;
  await lowestDice(gm);
  await autoBtn.tap();
  await expect.poll(async () => (await fightRow(gm, FOE_NAME)).hp).toBeLessThan(beforeHp);
});
