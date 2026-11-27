// Browser tests for NPC units 3-5 (row, wire, Add NPC to fight, mid-fight skill slider, and no-tap automatic turns):
// two-phone parity (ally NPC exact HP, foe NPC band-only, dead foe NPC tile blocking, skill and notes hidden on player phone),
// GM fight drawer picker + silent mid-fight skill slider, GM switch in store.device + Step once, and no-tap rounds
// (full round with no tap, reload survival, dodge pause + resume, and hidden tab pause + resume).
import type { Page } from '@playwright/test';
import { RULES } from '../../src/core/rules.ts';
import { abilityId } from '../../src/core/combat/ability-types.ts';
import { percent, tiles } from '../../src/core/combat/space.ts';
import { abilityOf } from '../../src/core/registry/ability-kinds.ts';
import { newNpc, npcTierPreset } from '../../src/core/registry/npcs.ts';
import { NPC_AUTO_MS } from '../../src/core/combat/policy.ts';
import { shortOf } from '../../src/core/combat/map-view.ts';
import { test, expect, openApp, setupGoblinDenGM, onboardPlayer, createRoom, dismissAll, go, fightRow, chooseList, setupDoc, PHONE, SMALL_PHONE } from './helpers.ts';

const HUNTER = 'Kai Npc';
const ALLY_NAME = 'Mira Scout';
const FOE_NAME = 'Rival Vance';
const ALLY_NOTE = 'GM secret ally note';
const FOE_NOTE = 'GM secret foe note';

const FROST_NOVA = abilityOf('blast', {
  id: abilityId('npc-frost-nova'),
  name: 'Frost Nova',
  range: tiles(8),
  foesOnly: true,
  shape: { kind: 'radius', radius: tiles(1), ring: { outer: tiles(2), share: percent(50) } },
}, RULES);

const combat = (page: Page) => page.locator('#view-combat');
const hudRow = (player: Page, name: string) => combat(player).locator('.tb-row', { hasText: name });
const lowestDice = (page: Page) => page.evaluate(() =>
  Object.defineProperty(crypto, 'getRandomValues', { configurable: true, value: (a: Uint32Array) => a.fill(0) }));
const highestDice = (page: Page) => page.evaluate(() =>
  Object.defineProperty(crypto, 'getRandomValues', { configurable: true, value: (a: Uint32Array) => a.fill(0xffffffff) }));
const pauseClock = async (page: Page) => {
  await page.clock.install();
  await page.clock.pauseAt(Date.now());
};

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
  await gm.evaluate(() => hunterApp.store.device('npcAuto').write(false));
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

test('GM NPC turns switch lives in store.device, Wait for my tap pauses automatic turns, and Step once runs one turn in List and Map views', async ({ device }) => {
  const gm = (await device('gm-auto', { viewport: SMALL_PHONE })).page;
  await setupGoblinDenGM(gm);
  await chooseList(gm);
  await seedNpcs(gm);
  await go(gm, 'combat');

  // Switch shows in Fight tools at 360 px with Play automatically on by default and >= 44 px tap targets.
  const autoOn = combat(gm).locator('[data-npc-auto="on"]');
  const autoOff = combat(gm).locator('[data-npc-auto="off"]');
  await expect(autoOn).toBeVisible();
  await expect(autoOn).toHaveText('Play automatically');
  await expect(autoOn).toHaveAttribute('aria-pressed', 'true');
  await expect(autoOff).toHaveText('Wait for my tap');
  await expect(autoOff).toHaveAttribute('aria-pressed', 'false');
  expect((await autoOn.boundingBox())!.height, 'Play automatically >= 44 px').toBeGreaterThanOrEqual(44);
  expect((await autoOff.boundingBox())!.height, 'Wait for my tap >= 44 px').toBeGreaterThanOrEqual(44);
  expect(await gm.evaluate(() => document.scrollingElement!.scrollWidth <= innerWidth), 'no sideways scroll at 360 px').toBe(true);

  // Flip switch to Wait for my tap -> persists in store.device('npcAuto'), never on the save or fight row.
  await autoOff.tap();
  await expect(autoOff).toHaveAttribute('aria-pressed', 'true');
  await expect(autoOn).toHaveAttribute('aria-pressed', 'false');
  const stored = await gm.evaluate(() => ({
    dev: hunterApp.store.device('npcAuto').read(),
    inSave: JSON.stringify(hunterApp.store.get()).includes('npcAuto'),
  }));
  expect(stored).toEqual({ dev: false, inSave: false });

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

  // Advance past NPC_AUTO_MS with page.clock: with Wait for my tap active, the NPC does not act on its own.
  const allyId = (await fightRow(gm, ALLY_NAME)).id;
  await pauseClock(gm);
  await gm.clock.runFor(NPC_AUTO_MS * 2);
  expect(await gm.evaluate(() => ({ cur: hunterApp.store.get().fight.currentId, log: hunterApp.store.get().fight.log.length }))).toEqual({ cur: allyId, log: 0 });

  // Card button stays as Step once (>= 44 px); tapping it runs one turn.
  const card = combat(gm).locator('.cmb-card.turn');
  await expect(card).toContainText('Ally NPC');
  const stepBtn = card.locator('[data-auto]');
  await expect(stepBtn).toBeVisible();
  await expect(stepBtn).toHaveText('Step once');
  expect((await stepBtn.boundingBox())!.height).toBeGreaterThanOrEqual(44);

  const beforeHp = (await fightRow(gm, FOE_NAME)).hp;
  await lowestDice(gm);
  await stepBtn.tap();
  await gm.clock.runFor(50);
  expect((await fightRow(gm, FOE_NAME)).hp).toBeLessThan(beforeHp);

  // In Map view, top bar button on an active NPC turn also reads Step once and fits 360 px.
  await combat(gm).locator('[data-fview="map"]').tap();
  await gm.clock.runFor(50);
  const barStep = combat(gm).locator('[data-bar] [data-auto]');
  await expect(barStep).toBeVisible();
  await expect(barStep).toHaveText('Step once');
  const barBox = (await barStep.boundingBox())!;
  expect(barBox.height, 'bar Step once >= 44 px').toBeGreaterThanOrEqual(44);
  expect(barBox.x + barBox.width, 'bar Step once fits 360 px').toBeLessThanOrEqual(SMALL_PHONE.width);

  // Open Fight tools in Map view and switch back to Play automatically -> the active NPC acts with no further tap.
  await combat(gm).locator('[data-tools-open]').tap();
  await gm.clock.runFor(50);
  const logBefore = await gm.evaluate(() => hunterApp.store.get().fight.log.length as number);
  await combat(gm).locator('[data-npc-auto="on"]').tap();
  await gm.clock.runFor(NPC_AUTO_MS + 50);
  expect(await gm.evaluate(() => hunterApp.store.get().fight.log.length as number)).toBeGreaterThan(logBefore);
});

test('no-tap NPC round plays ally and foe NPC turns automatically, stops on a player hunter, and survives a reload', async ({ device }) => {
  const gm = (await device('gm-notap', { viewport: SMALL_PHONE })).page;
  await setupGoblinDenGM(gm);
  await chooseList(gm);
  await seedNpcs(gm);
  await go(gm, 'combat');

  await combat(gm).locator('[data-npc-auto="off"]').tap();
  await combat(gm).locator('[data-hsel]').selectOption({ label: 'Brakk Ironhide' });
  await combat(gm).locator('[data-addh]').tap();
  await combat(gm).locator('[data-nsel]').selectOption('npc_101');
  await combat(gm).locator('[data-addn]').tap();
  await combat(gm).locator('[data-nsel]').selectOption('npc_102');
  await combat(gm).locator('[data-addn]').tap();
  await combat(gm).locator('[data-start]').tap();
  await expect(combat(gm).locator('.cmb-row.cur')).toHaveCount(1);

  await lowestDice(gm);
  await gm.evaluate(([aName, fName]) => hunterApp.store.update((d: any) => {
    const f = d.fight;
    const brakk = f.rows.find((r: any) => r.name === 'Brakk Ironhide');
    const ally = f.rows.find((r: any) => r.name === aName);
    const foe = f.rows.find((r: any) => r.name === fName);
    ally.place = { x: 4, y: 4 }; ally.at = f.now; ally.tie = 0;
    foe.place = { x: 4, y: 5 }; foe.at = f.now + 10; foe.tie = 0;
    brakk.place = { x: 4, y: 1 }; brakk.at = f.now + 20; brakk.tie = 0;
    f.currentId = ally.id;
    f.log = [];
  }, 'test-setup'), [ALLY_NAME, FOE_NAME] as const);

  const brakkId = (await fightRow(gm, 'Brakk Ironhide')).id;
  const allyHp0 = (await fightRow(gm, ALLY_NAME)).hp;
  const foeHp0 = (await fightRow(gm, FOE_NAME)).hp;

  // Arm through the GM switch: Mira Scout (ally NPC) plays automatically, its command arms Rival Vance (foe NPC), then handoff stops on Brakk.
  await pauseClock(gm);
  await gm.clock.runFor(50);
  await combat(gm).locator('[data-npc-auto="on"]').tap();
  await gm.clock.runFor(NPC_AUTO_MS + 50);
  await gm.clock.runFor(NPC_AUTO_MS + 50);
  expect(await gm.evaluate(() => hunterApp.store.get().fight.currentId as string)).toBe(brakkId);
  expect((await fightRow(gm, FOE_NAME)).hp, 'ally NPC damaged foe NPC with no tap').toBeLessThan(foeHp0);
  expect((await fightRow(gm, ALLY_NAME)).hp, 'foe NPC damaged ally NPC with no tap').toBeLessThan(allyHp0);
  const logAfterRound = await gm.evaluate(() => hunterApp.store.get().fight.log.length as number);
  expect(logAfterRound).toBeGreaterThanOrEqual(2);

  // Stops on the player hunter (never auto-plays non-NPC rows).
  await gm.clock.runFor(NPC_AUTO_MS * 2);
  expect(await gm.evaluate(() => ({ cur: hunterApp.store.get().fight.currentId, log: hunterApp.store.get().fight.log.length }))).toEqual({ cur: brakkId, log: logAfterRound });

  // Survives a reload: save the fight with ally NPC on turn while paused, re-enable npcAuto, and reload with no tap.
  await gm.evaluate(([aName, fName]) => {
    hunterApp.store.device('npcAuto').write(false);
    hunterApp.store.update((d: any) => {
      const f = d.fight;
      const brakk = f.rows.find((r: any) => r.name === 'Brakk Ironhide');
      const ally = f.rows.find((r: any) => r.name === aName);
      const foe = f.rows.find((r: any) => r.name === fName);
      ally.life = { at: 'up', hp: ally.sheet.hpMax };
      foe.life = { at: 'up', hp: foe.sheet.hpMax };
      ally.at = f.now; ally.tie = 0;
      foe.at = f.now + 30; foe.tie = 0;
      brakk.at = f.now + 10; brakk.tie = 0;
      f.currentId = ally.id;
      f.log = [];
    }, 'test-setup');
  }, [ALLY_NAME, FOE_NAME] as const);
  // Flush the store's post-frame write so localStorage holds the fight before reloading.
  await gm.clock.runFor(50);
  expect(await gm.evaluate(() => hunterApp.store.life())).toMatchObject({ at: 'ready', write: 'clean' });
  await gm.evaluate(() => hunterApp.store.device('npcAuto').write(true));
  await gm.reload({ waitUntil: 'domcontentloaded' });
  await gm.waitForFunction(() => Boolean(window.hunterApp));
  await gm.clock.runFor(50);
  await expect(combat(gm)).toBeVisible();

  // After reload with zero taps, ally NPC automatically takes its turn on NPC_AUTO_MS and advances to Brakk.
  await gm.clock.runFor(NPC_AUTO_MS + 50);
  expect(await gm.evaluate(() => hunterApp.store.get().fight.currentId as string)).toBe(brakkId);
  expect(await gm.evaluate(() => hunterApp.store.get().fight.log.length as number)).toBeGreaterThanOrEqual(1);
});

test('two phones: no-tap NPC turns pause on a player dodge prompt and resume automatically once the dodge resolves', async ({ device }) => {
  const gm = (await device('gm-npc-dodge', { viewport: SMALL_PHONE })).page;
  const player = (await device('pl-npc-dodge', { viewport: PHONE })).page;

  await setupGoblinDenGM(gm);
  await chooseList(gm);
  await seedNpcs(gm);
  const code = await createRoom(gm);
  await onboardPlayer(player, 'Kai Dodge', code);
  await expect.poll(() => player.evaluate(() => hunterApp.api.sync.room())).toBe(code);
  await dismissAll(player, 4);
  await go(gm, 'gm');
  await expect(gm.locator('#gm-board .gm-card.remote', { hasText: 'Kai Dodge' })).toHaveCount(1);

  await go(gm, 'combat');
  await combat(gm).locator('[data-npc-auto="off"]').tap();
  await combat(gm).locator('[data-hsel]').selectOption({ label: 'Kai Dodge (player phone)' });
  await combat(gm).locator('[data-addh]').tap();
  await combat(gm).locator('[data-nsel]').selectOption('npc_101');
  await combat(gm).locator('[data-addn]').tap();
  await combat(gm).locator('[data-nsel]').selectOption('npc_102');
  await combat(gm).locator('[data-addn]').tap();
  await combat(gm).locator('[data-start]').tap();
  await expect(combat(gm).locator('.cmb-row.cur')).toHaveCount(1);

  await gm.evaluate(([aName, fName, blast]) => hunterApp.store.update((d: any) => {
    const f = d.fight;
    const kai = f.rows.find((r: any) => r.name === 'Kai Dodge');
    const ally = f.rows.find((r: any) => r.name === aName);
    const foe = f.rows.find((r: any) => r.name === fName);
    foe.place = { x: 5, y: 2 }; foe.at = f.now; foe.tie = 0; foe.npc = { skill: 5 }; foe.abilities = [blast];
    ally.place = { x: 1, y: 1 }; ally.at = f.now + 10; ally.tie = 0; ally.npc = { skill: 5 };
    kai.place = { x: 5, y: 5 }; kai.at = f.now + 50; kai.tie = 0;
    f.currentId = foe.id;
    f.log = [];
  }, 'test-setup'), [ALLY_NAME, FOE_NAME, FROST_NOVA] as const);

  await setupDoc(player, 'Kai Dodge', { x: 5, y: 5 });
  await go(player, 'combat');

  const kaiId = (await fightRow(gm, 'Kai Dodge')).id;
  const allyId = (await fightRow(gm, ALLY_NAME)).id;
  await highestDice(gm);
  await pauseClock(gm);

  // Turn automatic NPC turns on -> foe NPC casts Frost Nova with no tap and pauses on Kai's dodge prompt.
  await combat(gm).locator('[data-npc-auto="on"]').tap();
  await gm.clock.runFor(NPC_AUTO_MS + 50);
  await expect(combat(gm).locator('[data-dodge]')).toBeVisible();
  await expect(combat(gm).locator('.cmb-card.turn [data-auto]')).toBeDisabled();

  // While dodging, advance well past NPC_AUTO_MS (also flushes the fight doc to the room): stays paused with no refusal toast.
  await gm.clock.runFor(NPC_AUTO_MS * 2);
  await expect(combat(player).locator('.tb-dodge')).toBeVisible({ timeout: 15_000 });
  expect(await gm.evaluate(() => ({ hasDodge: Boolean(hunterApp.store.get().fight.dodge), cur: hunterApp.store.get().fight.currentId }))).toMatchObject({ hasDodge: true });
  expect(await gm.evaluate(() => hunterApp.store.get().fight.currentId)).not.toBe(allyId);
  await expect(gm.locator('#toasts .toast-warning')).toHaveCount(0);

  // Resolve dodge -> ally NPC takes its turn automatically with no further tap and hands off to Kai.
  const foeHpBefore = (await fightRow(gm, FOE_NAME)).hp;
  await lowestDice(gm);
  await combat(gm).locator('[data-dodge-auto]').tap();
  await gm.clock.runFor(50);
  await expect(combat(gm).locator('[data-dodge]')).toBeHidden();
  await gm.clock.runFor(NPC_AUTO_MS + 50);
  expect(await gm.evaluate(() => hunterApp.store.get().fight.currentId as string)).toBe(kaiId);
  expect((await fightRow(gm, FOE_NAME)).hp, 'ally NPC automatically attacked foe NPC after dodge resolved').toBeLessThan(foeHpBefore);
});

test('hidden tab pauses automatic NPC turns and resumes when visible again', async ({ device }) => {
  const gm = (await device('gm-hidden', { viewport: SMALL_PHONE })).page;
  await setupGoblinDenGM(gm);
  await chooseList(gm);
  await seedNpcs(gm);
  await go(gm, 'combat');

  await combat(gm).locator('[data-npc-auto="off"]').tap();
  await combat(gm).locator('[data-hsel]').selectOption({ label: 'Brakk Ironhide' });
  await combat(gm).locator('[data-addh]').tap();
  await combat(gm).locator('[data-nsel]').selectOption('npc_101');
  await combat(gm).locator('[data-addn]').tap();
  await combat(gm).locator('[data-nsel]').selectOption('npc_102');
  await combat(gm).locator('[data-addn]').tap();
  await combat(gm).locator('[data-start]').tap();
  await expect(combat(gm).locator('.cmb-row.cur')).toHaveCount(1);

  await lowestDice(gm);
  await gm.evaluate(([aName, fName]) => hunterApp.store.update((d: any) => {
    const f = d.fight;
    const brakk = f.rows.find((r: any) => r.name === 'Brakk Ironhide');
    const ally = f.rows.find((r: any) => r.name === aName);
    const foe = f.rows.find((r: any) => r.name === fName);
    ally.place = { x: 4, y: 4 }; ally.at = f.now; ally.tie = 0;
    foe.place = { x: 4, y: 5 }; foe.at = f.now + 30; foe.tie = 0;
    brakk.place = { x: 4, y: 1 }; brakk.at = f.now + 10; brakk.tie = 0;
    f.currentId = ally.id;
    f.log = [];
  }, 'test-setup'), [ALLY_NAME, FOE_NAME] as const);

  const allyId = (await fightRow(gm, ALLY_NAME)).id;
  const brakkId = (await fightRow(gm, 'Brakk Ironhide')).id;

  await pauseClock(gm);
  await gm.clock.runFor(50);

  // Hide the tab FIRST, then switch automatic NPC turns on -> must not arm while hidden.
  await gm.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await combat(gm).locator('[data-npc-auto="on"]').tap();

  // Advance well past NPC_AUTO_MS while hidden -> the NPC does not act.
  await gm.clock.runFor(NPC_AUTO_MS * 2);
  expect(await gm.evaluate(() => ({ cur: hunterApp.store.get().fight.currentId, log: hunterApp.store.get().fight.log.length }))).toEqual({ cur: allyId, log: 0 });

  // Return tab to visible -> automatic timer arms and plays the NPC's turn on NPC_AUTO_MS with no tap.
  await gm.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await gm.clock.runFor(NPC_AUTO_MS + 50);
  expect(await gm.evaluate(() => hunterApp.store.get().fight.currentId as string)).toBe(brakkId);
  expect(await gm.evaluate(() => hunterApp.store.get().fight.log.length as number)).toBeGreaterThanOrEqual(1);
});

test('two visible tabs in one browser: storage sync cancels the passive tab so only the active tab plays NPC turns', async ({ device }) => {
  const { page: tabA, ctx } = await device('gm-two-tabs', { viewport: SMALL_PHONE });
  await setupGoblinDenGM(tabA);
  await chooseList(tabA);
  await seedNpcs(tabA);
  await go(tabA, 'combat');

  await combat(tabA).locator('[data-npc-auto="off"]').tap();
  await combat(tabA).locator('[data-hsel]').selectOption({ label: 'Brakk Ironhide' });
  await combat(tabA).locator('[data-addh]').tap();
  await combat(tabA).locator('[data-nsel]').selectOption('npc_101');
  await combat(tabA).locator('[data-addn]').tap();
  await combat(tabA).locator('[data-nsel]').selectOption('npc_102');
  await combat(tabA).locator('[data-addn]').tap();
  await combat(tabA).locator('[data-start]').tap();
  await expect(combat(tabA).locator('.cmb-row.cur')).toHaveCount(1);

  await lowestDice(tabA);
  await tabA.evaluate(([aName, fName]) => hunterApp.store.update((d: any) => {
    const f = d.fight;
    const brakk = f.rows.find((r: any) => r.name === 'Brakk Ironhide');
    const ally = f.rows.find((r: any) => r.name === aName);
    const foe = f.rows.find((r: any) => r.name === fName);
    ally.place = { x: 4, y: 4 }; ally.at = f.now; ally.tie = 0;
    foe.place = { x: 4, y: 5 }; foe.at = f.now + 10; foe.tie = 0;
    brakk.place = { x: 4, y: 1 }; brakk.at = f.now + 20; brakk.tie = 0;
    f.currentId = ally.id;
    f.log = [];
  }, 'test-setup'), [ALLY_NAME, FOE_NAME] as const);
  await expect.poll(() => tabA.evaluate(() => hunterApp.store.life())).toMatchObject({ at: 'ready', write: 'clean' });

  const foeId = (await fightRow(tabA, FOE_NAME)).id;
  const brakkId = (await fightRow(tabA, 'Brakk Ironhide')).id;

  // Open a second visible tab in the same browser context, both ready and clean on Combat.
  const tabB = await ctx.newPage();
  await openApp(tabB);
  await go(tabB, 'combat');
  await expect(combat(tabB).locator('.cmb-row.cur')).toHaveCount(1);
  await expect.poll(() => tabB.evaluate(() => hunterApp.store.life())).toMatchObject({ at: 'ready', write: 'clean' });

  // Playwright's clock is per-context: install and pause once on the context via tabA.
  await pauseClock(tabA);

  // Tab A enables automatic turns and plays ally NPC's turn, flushing to localStorage so tab B receives 'storage'.
  await combat(tabA).locator('[data-npc-auto="on"]').tap();
  await tabA.clock.runFor(NPC_AUTO_MS + 50);
  expect(await tabA.evaluate(() => hunterApp.store.get().fight.currentId as string)).toBe(foeId);
  await expect.poll(async () => {
    await tabA.clock.runFor(20);
    return tabB.evaluate(() => hunterApp.store.get().fight.currentId as string);
  }).toBe(foeId);
  const logAfterFirst = await tabA.evaluate(() => hunterApp.store.get().fight.log.length as number);

  // Hide tab A (canceling tab A's own timer without touching storage) while tab B stays visible, ready, and clean.
  // Advancing the shared context clock well past NPC_AUTO_MS proves tab B did NOT arm on 'storage'.
  await tabA.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await tabB.clock.runFor(NPC_AUTO_MS * 2);
  expect(await tabB.evaluate(() => ({
    cur: hunterApp.store.get().fight.currentId,
    log: hunterApp.store.get().fight.log.length,
    readOnly: hunterApp.store.readOnly,
    life: hunterApp.store.life(),
  }))).toEqual({ cur: foeId, log: logAfterFirst, readOnly: false, life: { at: 'ready', write: 'clean' } });

  // Return tab A to visible -> tab A finishes foe NPC's turn and hands off to Brakk; tab B follows cleanly without read-only takeover.
  await tabA.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await tabA.clock.runFor(NPC_AUTO_MS + 50);
  expect(await tabA.evaluate(() => hunterApp.store.get().fight.currentId as string)).toBe(brakkId);
  await expect.poll(async () => {
    await tabA.clock.runFor(20);
    return tabB.evaluate(() => hunterApp.store.get().fight.currentId as string);
  }).toBe(brakkId);
  expect(await tabA.evaluate(() => hunterApp.store.readOnly)).toBe(false);
  expect(await tabB.evaluate(() => hunterApp.store.readOnly)).toBe(false);
  expect(await tabA.evaluate(() => hunterApp.store.backups().filter((b: any) => b.reason === 'before another tab saved').length)).toBe(0);
});

test('pending NPC timer cancels on Wait for my tap, pauses under End fight and target picker, and survives a refused command', async ({ device }) => {
  const gm = (await device('gm-pending', { viewport: SMALL_PHONE })).page;
  await setupGoblinDenGM(gm);
  await chooseList(gm);
  await seedNpcs(gm);
  await go(gm, 'combat');

  await combat(gm).locator('[data-npc-auto="off"]').tap();
  await combat(gm).locator('[data-hsel]').selectOption({ label: 'Brakk Ironhide' });
  await combat(gm).locator('[data-addh]').tap();
  await combat(gm).locator('[data-nsel]').selectOption('npc_101');
  await combat(gm).locator('[data-addn]').tap();
  await combat(gm).locator('[data-nsel]').selectOption('npc_102');
  await combat(gm).locator('[data-addn]').tap();
  await combat(gm).locator('[data-start]').tap();
  await expect(combat(gm).locator('.cmb-row.cur')).toHaveCount(1);

  await lowestDice(gm);
  await gm.evaluate(([aName, fName]) => hunterApp.store.update((d: any) => {
    const f = d.fight;
    const brakk = f.rows.find((r: any) => r.name === 'Brakk Ironhide');
    const ally = f.rows.find((r: any) => r.name === aName);
    const foe = f.rows.find((r: any) => r.name === fName);
    ally.place = { x: 4, y: 4 }; ally.at = f.now; ally.tie = 0;
    foe.place = { x: 4, y: 5 }; foe.at = f.now + 10; foe.tie = 0;
    // Place Brakk on the right edge of the grid so shrinking width by 1 is refused (`cutOff`).
    brakk.place = { x: f.grid.w - 1, y: 1 }; brakk.at = f.now + 20; brakk.tie = 0;
    f.currentId = ally.id;
    f.log = [];
  }, 'test-setup'), [ALLY_NAME, FOE_NAME] as const);

  const allyId = (await fightRow(gm, ALLY_NAME)).id;
  const foeId = (await fightRow(gm, FOE_NAME)).id;
  const half = Math.floor(NPC_AUTO_MS / 2);

  await pauseClock(gm);
  await gm.clock.runFor(50);

  // 1. Switch off while a timer is armed -> cancels the pending timer.
  await combat(gm).locator('[data-npc-auto="on"]').tap();
  await gm.clock.runFor(half);
  expect(await gm.evaluate(() => hunterApp.store.get().fight.currentId as string)).toBe(allyId);
  await combat(gm).locator('[data-npc-auto="off"]').tap();
  await gm.clock.runFor(NPC_AUTO_MS * 2);
  expect(await gm.evaluate(() => ({ cur: hunterApp.store.get().fight.currentId, log: hunterApp.store.get().fight.log.length }))).toEqual({ cur: allyId, log: 0 });

  // 2. End fight with a timer pending -> pauses behind the summary, and Keep fighting re-arms without acting behind it.
  await combat(gm).locator('[data-npc-auto="on"]').tap();
  await gm.clock.runFor(half);
  await combat(gm).locator('[data-end]').tap();
  await gm.clock.runFor(50);
  const summary = gm.locator('.sys-overlay.show', { hasText: 'Fight over' });
  await expect(summary).toBeVisible();
  await gm.clock.runFor(NPC_AUTO_MS * 2);
  expect(await gm.evaluate(() => ({ cur: hunterApp.store.get().fight.currentId, log: hunterApp.store.get().fight.log.length }))).toEqual({ cur: allyId, log: 0 });
  await summary.locator('.sys-actions button', { hasText: 'Keep fighting' }).tap();
  await gm.clock.runFor(50);
  await expect(summary).toHaveCount(0);

  // 3. Target picker with a timer pending -> pauses while open, and Cancel re-arms.
  await gm.clock.runFor(half);
  await combat(gm).locator('.cmb-card.turn [data-ab]').first().tap();
  await gm.clock.runFor(50);
  const picker = gm.locator('.sys-overlay.show', { hasText: /Use .+ on…/ });
  await expect(picker).toBeVisible();
  await gm.clock.runFor(NPC_AUTO_MS * 2);
  expect(await gm.evaluate(() => ({ cur: hunterApp.store.get().fight.currentId, log: hunterApp.store.get().fight.log.length }))).toEqual({ cur: allyId, log: 0 });
  await picker.locator('.sys-actions button', { hasText: 'Cancel' }).tap();
  await gm.clock.runFor(50);
  await expect(picker).toHaveCount(0);

  // 4. Refused command while a timer is armed -> leaves the armed timer alive so the NPC still acts.
  await combat(gm).locator('[data-fview="map"]').tap();
  await gm.clock.runFor(50);
  await combat(gm).locator('[data-tools-open]').tap();
  await gm.clock.runFor(50);
  await combat(gm).locator('[data-resize="w"][data-d="-1"]').tap();
  await gm.clock.runFor(50);
  expect(await gm.evaluate(() => hunterApp.store.get().fight.currentId as string)).toBe(allyId);
  await gm.clock.runFor(NPC_AUTO_MS + 50);
  expect(await gm.evaluate(() => hunterApp.store.get().fight.currentId as string)).toBe(foeId);
});

test('GM in a room waits for this stretch\'s first poll before arming, respects another GM\'s fight, and arms once sync:docs clears', async ({ device }) => {
  const gm = (await device('gm-room-poll', { viewport: SMALL_PHONE, blockServiceWorker: true })).page;
  await setupGoblinDenGM(gm);
  await chooseList(gm);
  await seedNpcs(gm);
  const code = await createRoom(gm);
  await go(gm, 'combat');

  await combat(gm).locator('[data-npc-auto="off"]').tap();
  await combat(gm).locator('[data-hsel]').selectOption({ label: 'Brakk Ironhide' });
  await combat(gm).locator('[data-addh]').tap();
  await combat(gm).locator('[data-nsel]').selectOption('npc_101');
  await combat(gm).locator('[data-addn]').tap();
  await combat(gm).locator('[data-nsel]').selectOption('npc_102');
  await combat(gm).locator('[data-addn]').tap();
  await combat(gm).locator('[data-start]').tap();
  await expect(combat(gm).locator('.cmb-row.cur')).toHaveCount(1);

  await lowestDice(gm);
  await gm.evaluate(([aName, fName]) => hunterApp.store.update((d: any) => {
    const f = d.fight;
    const brakk = f.rows.find((r: any) => r.name === 'Brakk Ironhide');
    const ally = f.rows.find((r: any) => r.name === aName);
    const foe = f.rows.find((r: any) => r.name === fName);
    ally.place = { x: 4, y: 4 }; ally.at = f.now; ally.tie = 0;
    foe.place = { x: 4, y: 5 }; foe.at = f.now + 30; foe.tie = 0;
    brakk.place = { x: 4, y: 1 }; brakk.at = f.now + 10; brakk.tie = 0;
    f.currentId = ally.id;
    f.log = [];
  }, 'test-setup'), [ALLY_NAME, FOE_NAME] as const);
  await expect.poll(() => gm.evaluate(() => hunterApp.store.life())).toMatchObject({ at: 'ready', write: 'clean' });

  const allyId = (await fightRow(gm, ALLY_NAME)).id;
  const brakkId = (await fightRow(gm, 'Brakk Ironhide')).id;

  // Hold the first room poll after reload so we can prove NPC auto-turns wait for this stretch to be heard.
  let pollMode: 'hold' | 'other-gm' | 'ended' = 'hold';
  let releaseFirstPoll!: () => void;
  const firstPollGate = new Promise<void>(resolve => { releaseFirstPoll = resolve; });
  await gm.route(`**/api/rooms/${code}/sheets/_fight`, async route => {
    if (route.request().method() === 'PUT' && pollMode === 'other-gm') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{"offline":true}' });
      return;
    }
    await route.continue();
  });
  await gm.route(`**/api/rooms/${code}?*`, async route => {
    if (route.request().method() !== 'GET') return route.continue();
    if (pollMode === 'hold') await firstPollGate;
    const res = await route.fetch();
    const json = await res.json();
    const otherDoc = pollMode === 'other-gm'
      ? { ended: false, active: true, by: 'd-other-gm', id: 'f-other', at: new Date().toISOString(), now: 0, currentId: null, ahead: [], grid: { w: 10, h: 10 }, zones: [], rows: [], log: [], refused: null, ready: {} }
      : { ended: true, active: false, id: 'f-other', at: new Date().toISOString() };
    json.docs = { ...(json.docs || {}), fight: { at: new Date().toISOString(), from: 'd-other-gm', data: otherDoc } };
    await route.fulfill({ response: res, json });
  });

  await gm.evaluate(() => hunterApp.store.device('npcAuto').write(true));
  await pauseClock(gm);
  await gm.reload({ waitUntil: 'domcontentloaded' });
  await gm.waitForFunction(() => Boolean(window.hunterApp));
  await gm.clock.runFor(50);
  await expect(combat(gm)).toBeVisible();

  // Before the first poll returns, sync.detail().heard is false -> does not arm even well past NPC_AUTO_MS.
  expect(await gm.evaluate(() => hunterApp.api.sync.detail().heard)).toBe(false);
  await gm.clock.runFor(NPC_AUTO_MS * 2);
  expect(await gm.evaluate(() => ({ cur: hunterApp.store.get().fight.currentId, log: hunterApp.store.get().fight.log.length }))).toEqual({ cur: allyId, log: 0 });

  // First poll lands with another GM running a fight -> heard becomes true, otherGMRunning keeps it paused.
  pollMode = 'other-gm';
  releaseFirstPoll();
  await expect.poll(() => gm.evaluate(() => hunterApp.api.sync.detail().heard)).toBe(true);
  await gm.clock.runFor(NPC_AUTO_MS * 2);
  expect(await gm.evaluate(() => ({ cur: hunterApp.store.get().fight.currentId, log: hunterApp.store.get().fight.log.length }))).toEqual({ cur: allyId, log: 0 });

  // Next poll reports the other GM's fight ended -> sync:docs calls scheduleNpcAuto and the NPC plays automatically.
  pollMode = 'ended';
  await gm.evaluate(() => hunterApp.api.sync.retry());
  await expect.poll(() => gm.evaluate(() => {
    const d = hunterApp.api.sync.doc('fight');
    return Boolean(d && (d.ended || d.by === hunterApp.store.get().settings.deviceId));
  })).toBe(true);
  await gm.clock.runFor(NPC_AUTO_MS + 50);
  expect(await gm.evaluate(() => hunterApp.store.get().fight.currentId as string)).toBe(brakkId);
  expect(await gm.evaluate(() => hunterApp.store.get().fight.log.length as number)).toBeGreaterThanOrEqual(1);
});

test('two phones: GM moves the mid-fight NPC skill slider silently with no log line and nothing sent to or shown on the player phone', async ({ device }) => {
  const gm = (await device('gm-skill', { viewport: SMALL_PHONE })).page;
  const player = (await device('player-skill', { viewport: PHONE })).page;

  await setupGoblinDenGM(gm);
  await chooseList(gm);
  await seedNpcs(gm);
  await gm.evaluate(() => hunterApp.store.device('npcAuto').write(false));
  const code = await createRoom(gm);
  await onboardPlayer(player, HUNTER, code);
  await chooseList(player);
  await expect.poll(() => player.evaluate(() => hunterApp.api.sync.room())).toBe(code);
  await dismissAll(player, 4);
  await go(gm, 'gm');
  await expect(gm.locator('#gm-board .gm-card.remote', { hasText: HUNTER })).toHaveCount(1);

  await go(gm, 'combat');
  await combat(gm).locator('[data-hsel]').selectOption({ label: `${HUNTER} (player phone)` });
  await combat(gm).locator('[data-addh]').tap();

  // Fight drawer syncs its per-fight skill slider to the selected NPC (ally skill 4 -> Sharp) and allows overriding it.
  await combat(gm).locator('[data-nsel]').selectOption('npc_101');
  const drawerSlider = combat(gm).locator('#cmb-add-npc-skill');
  await expect(drawerSlider).toBeVisible();
  await expect(drawerSlider).toHaveValue('4');
  await combat(gm).locator('[data-addn]').tap();

  await combat(gm).locator('[data-nsel]').selectOption('npc_102');
  await expect(drawerSlider).toHaveValue('2');
  await combat(gm).locator('[data-addn]').tap();

  await combat(gm).locator('[data-start]').tap();
  await expect(combat(gm).locator('.cmb-row.cur')).toHaveCount(1);
  await expect.poll(() => player.evaluate(() => hunterApp.api.sync.doc('fight') !== null)).toBe(true);
  await go(player, 'combat');
  await expect(hudRow(player, ALLY_NAME)).toBeVisible();

  // Track every outbound request body on both phones from this point on.
  const sent: string[] = [];
  for (const p of [gm, player]) p.on('request', r => { const b = r.postData(); if (b) sent.push(b); });

  const docBefore = await player.evaluate(() => JSON.stringify(hunterApp.api.sync.doc('fight')));
  const logBefore = await gm.evaluate(() => JSON.stringify(hunterApp.store.get().fight.log));

  // Non-NPC hunter card shows no NPC skill slider.
  await combat(gm).locator('.cmb-row', { hasText: HUNTER }).locator('.cmb-pick').tap();
  await expect(combat(gm).locator('.cmb-card [data-npc-skill-row]')).toHaveCount(0);

  // Ally NPC card shows the GM-only "How well this NPC plays" slider (>= 44 px, no horizontal overflow at 360 px).
  await combat(gm).locator('.cmb-row', { hasText: ALLY_NAME }).locator('.cmb-pick').tap();
  const card = combat(gm).locator('.cmb-card');
  const slider = card.locator('[data-npc-skill-row]');
  await expect(slider).toBeVisible();
  await expect(card).toContainText('How well this NPC plays');
  await expect(card.locator('[data-npc-skill-name]')).toHaveText('Sharp (4 of 5)');
  expect((await slider.boundingBox())!.height, 'mid-fight skill slider >= 44 px').toBeGreaterThanOrEqual(44);
  expect(await gm.evaluate(() => document.scrollingElement!.scrollWidth <= innerWidth), 'no sideways scroll at 360 px').toBe(true);

  // Pointer-drag the mid-fight skill slider continuously from 4 (Sharp) -> 1 (Sloppy) without replacing the input node.
  await slider.evaluate(el => {
    el.scrollIntoView({ block: 'center' });
    (el as unknown as Record<string, string>).__dragKeep = 'same-input';
  });
  const box = (await slider.boundingBox())!;
  const cy = box.y + box.height / 2;
  const xStart = box.x + box.width * 0.75;
  const xEnd = box.x + 4;
  await gm.mouse.move(xStart, cy);
  await gm.mouse.down();
  await gm.mouse.move(xEnd, cy, { steps: 12 });

  // Mid-drag (before mouse up): readout updated live in place on the exact same input element, without committing early.
  await expect(card.locator('[data-npc-skill-name]')).toHaveText('Sloppy (1 of 5)');
  await expect(card.locator('[data-npc-skill-out]')).toContainText('Sloppy:');
  expect(await slider.evaluate(el => (el as unknown as Record<string, string>).__dragKeep), 'slider input survives drag intact').toBe('same-input');
  expect(await gm.evaluate(([name]) => hunterApp.store.get().fight.rows.find((r: any) => r.name === name)?.npc?.skill, [ALLY_NAME] as const)).toBe(4);

  // Release commits setNpcSkill once and still keeps the same input element alive.
  await gm.mouse.up();
  await expect(card.locator('[data-npc-skill-name]')).toHaveText('Sloppy (1 of 5)');
  await expect(card.locator('[data-npc-skill-out]')).toContainText('Sloppy:');
  expect(await slider.evaluate(el => (el as unknown as Record<string, string>).__dragKeep), 'slider input stays mounted after release').toBe('same-input');

  // Fight state updated silently: skill is 1 and the GM's fight log did not add a line.
  const gmAfter = await gm.evaluate(([name]) => {
    const f = hunterApp.store.get().fight;
    const row = f.rows.find((r: any) => r.name === name);
    return { skill: row?.npc?.skill, log: JSON.stringify(f.log) };
  }, [ALLY_NAME] as const);
  expect(gmAfter.skill).toBe(1);
  expect(gmAfter.log).toBe(logBefore);

  // Wait for any sync cycle; player phone holds the exact same fight doc, shows nothing about skill, and saw no skill payload.
  await player.waitForTimeout(1500);
  expect(await player.evaluate(() => JSON.stringify(hunterApp.api.sync.doc('fight')))).toBe(docBefore);
  const playerText = await player.evaluate(() => document.body.innerText);
  expect(playerText).not.toContain('How well this NPC plays');
  expect(playerText).not.toContain('Sloppy');
  expect(playerText).not.toContain('Optimal');
  expect(playerText).not.toContain('Play automatically');
  expect(playerText).not.toContain('Wait for my tap');
  expect(sent.filter(b => /setNpcSkill|npcSkill|npcAuto|How well this NPC plays|"npc":/i.test(b))).toEqual([]);
});
