// Act 1 "The Empty Seat" end-to-end tests (U6):
// 1. Full GM + remote player room run through Chapters 1-5, Wave 1 & Wave 2, unique-class pick, Clear gate, and Cap: none.
// 2. Solo GM run testing Tessa Corbin's 12 unspent creation points, 2-wave Tidewall Cannery Gate, 3 Mythics + 1 Epic, and Guest title.
// 3. Clear-before-offer recovery: clearing Tidewall Cannery Gate before offering classes keeps the card offer button active.
import type { Page } from '@playwright/test';
import { EPIC_OFFER_POOL, MYTHIC_OFFER_POOL, OFFER_WORDS } from '../../src/core/hunter/class-offer.ts';
import { PREGENS, STARTER_GATE, STARTER_STORY_NAME, STARTER_UNSPENT_HUNTER } from '../../src/core/starter.ts';
import { STORY_WORDS } from '../../src/core/story/run.ts';
import {
  SMALL_PHONE,
  activeHunter,
  answerWindow,
  chooseList,
  createRoom,
  dismissAll,
  expect,
  go,
  onboardGM,
  onboardPlayer,
  test,
} from './helpers.ts';

const modalWin = (page: Page, title: string) => page.locator('.sys-overlay.show', { hasText: title });
const storyWin = (page: Page) => page.locator('.st-ov [role=dialog]');

async function openGmSection(gm: Page, id: string): Promise<void> {
  const tog = gm.locator(`[data-tog="${id}"]`);
  if ((await tog.getAttribute('aria-expanded')) !== 'true') await tog.tap();
}

/** Answers `count` queued System windows titled `title` (one per local hunter on a GM phone). */
async function answerEachWindow(page: Page, title: string, count: number): Promise<void> {
  for (let i = 0; i < count; i++) await answerWindow(page, title);
}

/** Defeats all living foes in the current GM fight, ends it, and taps Award XP to party. */
async function finishCurrentFight(gm: Page): Promise<void> {
  const endBtn = gm.locator('#view-combat [data-end]').first();
  await expect(endBtn).toBeVisible();
  await gm.evaluate(() => hunterApp.store.update((d: any) => {
    for (const r of d.fight.rows) if (r.side === 'foe') r.life = { at: 'dead' };
  }, 'test-defeat-foes'));
  await endBtn.evaluate((el: any) => el.scrollIntoView({ block: 'center' }));
  await endBtn.tap();
  const awardBtn = gm.locator('.sys-overlay.show .sys-actions button', { hasText: 'Award XP to party' }).first();
  await expect(awardBtn).toBeVisible();
  await awardBtn.tap();
}

/** Dismisses any earlier queued System window (e.g. Wave 1 fight XP award) until `title` sits on top, then answers it. */
async function waitAndAnswerWindow(page: Page, title: string): Promise<void> {
  const wanted = modalWin(page, title);
  const otherPrimary = page.locator('.sys-overlay.show', { hasNotText: title }).locator('.sys-actions button.primary').first();
  await expect.poll(async () => {
    if (await wanted.isVisible()) return true;
    if (await otherPrimary.isVisible()) await otherPrimary.tap();
    return false;
  }, { timeout: 20_000, message: `System window "${title}"` }).toBe(true);
  await answerWindow(page, title);
}
async function waitForGateClearedModal(gm: Page) {
  const clearedDlg = modalWin(gm, 'Gate cleared?');
  const otherPrimary = gm.locator('.sys-overlay.show', { hasNotText: 'Gate cleared?' }).locator('.sys-actions button.primary').first();
  await expect.poll(async () => {
    if (await clearedDlg.isVisible()) return true;
    if (await otherPrimary.isVisible()) await otherPrimary.tap();
    return false;
  }, { timeout: 15_000 }).toBe(true);
  return clearedDlg;
}

test('full GM + remote player room run of The Empty Seat reaches unique-class pick, Guest title, and Cap: none', async ({ device }) => {
  const gm = (await device('gm-act1', { blockServiceWorker: true })).page;
  const p1 = (await device('kira-act1', { viewport: SMALL_PHONE })).page;

  await onboardGM(gm);
  await chooseList(gm);
  const code = await createRoom(gm);

  await onboardPlayer(p1, 'Kira Sol', code);
  await dismissAll(p1);

  await expect.poll(
    () => gm.evaluate(() => (hunterApp.api.sync.remoteSheets() as any[]).map(r => r.data.name)),
    { timeout: 20_000 },
  ).toEqual(['Kira Sol']);

  await test.step('starter campaign loads 4 sample hunters, zero non-daily quests, Tidewall Cannery Gate, and preloaded The Empty Seat', async () => {
    const snap = await gm.evaluate(() => {
      const s = hunterApp.store.get();
      return {
        hunters: s.hunters.map((h: any) => ({ name: h.name, cap: h.capDisplay, nonDaily: h.quests.filter((q: any) => q.kind !== 'daily').length })),
        gates: s.gates.map((g: any) => ({ name: g.name, rank: g.rank, breakDelta: g.breakDay - s.world.day, classOffer: g.classOffer, bossFell: g.bossFell })),
        stories: s.library.stories.map((st: any) => ({ name: st.name, chapters: st.chapters.length })),
        runs: s.storyRuns.length,
      };
    });
    expect(snap.hunters.map((h: any) => h.name)).toEqual(PREGENS.map(p => p.name));
    expect(snap.hunters.every((h: any) => h.cap === 'E' && h.nonDaily === 0)).toBe(true);
    expect(snap.gates).toEqual([{ name: STARTER_GATE.name, rank: 'E', breakDelta: 1, classOffer: true, bossFell: false }]);
    expect(snap.stories).toEqual([{ name: STARTER_STORY_NAME, chapters: 5 }]);
    expect(snap.runs).toBe(0);

    // GM sets Kira Sol's display cap to E (Cap: 9) on the Party board before Chapter 1.
    await go(gm, 'gm');
    await openGmSection(gm, 'party');
    await gm.locator('#gm-board .gm-card.remote', { hasText: 'Kira Sol' }).locator('[data-gmcap]').selectOption('E');
    await go(p1, 'status');
    await expect(p1.locator('#view-status [data-cap-chip]')).toHaveText('Cap: 9', { timeout: 20_000 });
  });

  await test.step('Beat 1: GM starts The Empty Seat (Chapter 1: Seat Assigned) and Kira Sol receives 2 Health Potions (E) and Thursday\'s Gate', async () => {
    await go(gm, 'gm');
    await openGmSection(gm, 'stories');
    await gm.locator('#gm-stories [data-st-turnon]').tap();
    const sw = storyWin(gm);
    await sw.locator('[data-st-story]', { hasText: STARTER_STORY_NAME }).tap();
    await expect(sw.locator('[data-st-for="table"]')).toHaveAttribute('aria-pressed', 'true');
    await sw.locator('[data-st-go]').tap();
    await answerEachWindow(gm, 'SEAT ASSIGNED', PREGENS.length);

    await expect(p1.locator('.sys-overlay.show', { hasText: 'SEAT ASSIGNED' })).toBeVisible({ timeout: 20_000 });
    await answerWindow(p1, 'SEAT ASSIGNED');
    await expect.poll(() => p1.evaluate(() => {
      const h = hunterApp.store.active();
      const pot = hunterApp.api.inventory.bag(h).find((i: any) => i.name === 'Health Potion (E)');
      return {
        potions: pot ? pot.qty : 0,
        quests: h.quests.filter((q: any) => q.kind !== 'daily').map((q: any) => q.title),
      };
    }), { timeout: 20_000 }).toEqual({ potions: 2, quests: ["Thursday's Gate"] });
  });

  await test.step('Beat 2: GM marks Tidewall Cannery Gate raiding, opens Chapter 2, and clears Wave 1 with neither Clear modal nor class offer', async () => {
    await go(gm, 'gates');
    const card = gm.locator('#view-gates .gate', { hasText: STARTER_GATE.name });
    await expect(card.locator('[data-wave-head="1"]')).toHaveText('Wave 1');
    await expect(card.locator('[data-wave-head="2"]')).toHaveText('Wave 2');
    await card.locator('[data-act="enter"]').tap();
    await expect(card.locator('.gt-chip.st-raiding')).toHaveText('Raiding');

    await go(gm, 'gm');
    await openGmSection(gm, 'stories');
    await gm.locator('#gm-stories .st-card [data-st-open]').tap();
    await storyWin(gm).locator('[data-st-go]').tap();
    await answerEachWindow(gm, 'GATE ENTERED', PREGENS.length);
    await expect(p1.locator('.sys-overlay.show', { hasText: 'GATE ENTERED' })).toBeVisible({ timeout: 20_000 });
    await answerWindow(p1, 'GATE ENTERED');

    await go(gm, 'gates');
    await card.locator('[data-act="encounter"]').tap();
    const dlg = gm.locator('[aria-modal="true"]');
    await expect(dlg.locator('[data-wave-pick] input[name="wave"][value="1"]')).toBeChecked();
    await dlg.locator('[data-apply]').tap();

    const w1Foes = await gm.evaluate(() => hunterApp.store.get().fight.rows.filter((r: any) => r.side === 'foe').map((r: any) => r.name));
    expect(w1Foes.some((n: string) => n.includes('Goblin Chief'))).toBe(true);
    expect(w1Foes.some((n: string) => n.includes('Usher'))).toBe(false);

    await finishCurrentFight(gm);
    await dismissAll(gm);
    await expect(modalWin(gm, 'Gate cleared?')).toHaveCount(0);
    await dismissAll(p1);

    await go(gm, 'gates');
    await expect(card.locator('[data-act="class-offer"]')).toHaveCount(0);
    expect(await gm.evaluate(name => hunterApp.store.get().gates.find((g: any) => g.name === name)?.bossFell, STARTER_GATE.name)).toBe(false);
  });

  await test.step('Beats 3 & 4: GM opens Chapters 3 and 4, awards question gold, and clears Wave 2 (Head Usher) to trigger Lift cap and offer classes', async () => {
    await go(gm, 'gm');
    await openGmSection(gm, 'stories');
    // Chapter 3: The Stone Hall
    await gm.locator('#gm-stories .st-card [data-st-open]').tap();
    await storyWin(gm).locator('[data-st-go]').tap();
    await answerEachWindow(gm, 'TRIAL ISSUED', PREGENS.length);
    await waitAndAnswerWindow(p1, 'TRIAL ISSUED');

    // Chapter 4: Final Objective (03:14)
    await gm.locator('#gm-stories .st-card [data-st-open]').tap();
    await storyWin(gm).locator('[data-st-go]').tap();
    await answerEachWindow(gm, 'FINAL OBJECTIVE', PREGENS.length);
    await waitAndAnswerWindow(p1, 'FINAL OBJECTIVE');

    // Wave 2 fight
    await go(gm, 'gates');
    const card = gm.locator('#view-gates .gate', { hasText: STARTER_GATE.name });
    await card.locator('[data-act="encounter"]').tap();
    const dlg = gm.locator('[aria-modal="true"]');
    await expect(dlg.locator('[data-wave-pick] input[name="wave"][value="2"]')).toBeChecked();
    await dlg.locator('[data-apply]').tap();

    const w2Foes = await gm.evaluate(() => hunterApp.store.get().fight.rows.filter((r: any) => r.side === 'foe').map((r: any) => r.name));
    expect(w2Foes.some((n: string) => n.includes('Head Usher'))).toBe(true);
    expect(w2Foes.some((n: string) => n.includes('Goblin'))).toBe(false);

    await finishCurrentFight(gm);
    const clearedDlg = await waitForGateClearedModal(gm);
    await expect(clearedDlg).toContainText(OFFER_WORDS.gatePromptNote);
    await clearedDlg.locator('.sys-actions button', { hasText: OFFER_WORDS.gmLiftAndOfferButton }).tap();
    await expect(clearedDlg).toHaveCount(0);
  });

  await test.step('Beat 5: Kira Sol picks Hemomancer, cap lifts to Cap: none on both phones, gate clears, and Chapter 5 grants Guest (+1 dis)', async () => {
    const gmOffer = gm.locator('[data-co-modal]');
    await expect(gmOffer).toBeVisible();
    await expect(gmOffer.locator('[data-co-mythics] [data-co-card]')).toHaveCount(MYTHIC_OFFER_POOL.length);
    await expect(gmOffer.locator('[data-co-epics] [data-co-card]')).toHaveCount(EPIC_OFFER_POOL.length);

    // Remote player sees offer modal and picks Hemomancer.
    await dismissAll(p1);
    const p1Offer = p1.locator('[data-co-modal]');
    await expect(p1Offer).toBeVisible({ timeout: 20_000 });
    await dismissAll(p1);
    await expect(p1Offer).toContainText(OFFER_WORDS.openBody);
    await p1Offer.locator('[data-co-pick="Hemomancer"]').tap();
    await expect(p1Offer.locator('[data-co-picked]')).toContainText(OFFER_WORDS.alreadyPickedLine('Hemomancer'), { timeout: 20_000 });
    await p1Offer.locator('[data-co-dismiss]').tap();

    // GM claims Bladefiend for Dolan Kestrel and closes the offer.
    await expect(gmOffer.locator('[data-co-taken="Hemomancer"]')).toContainText('Held by Kira Sol', { timeout: 20_000 });
    await gmOffer.locator('[data-co-card="Bladefiend"] [data-co-pick="Bladefiend"]').tap();
    await expect(gmOffer.locator('[data-co-taken="Bladefiend"]')).toContainText('Held by');
    await gmOffer.locator('[data-co-close-offer]').tap();
    await expect(gmOffer).toHaveCount(0);

    // Cap: none shows on both GM and remote player phones.
    await go(p1, 'status');
    await expect(p1.locator('#view-status [data-cap-chip]')).toHaveText('Cap: none', { timeout: 20_000 });
    expect((await activeHunter(p1)).job).toBe('Hemomancer');
    await go(gm, 'status');
    await expect(gm.locator('#view-status [data-cap-chip]')).toHaveText('Cap: none');

    // Clear Tidewall Cannery Gate.
    await go(gm, 'gates');
    const card = gm.locator('#view-gates .gate', { hasText: STARTER_GATE.name });
    await card.locator('[data-act="clear"]').tap();
    await card.locator('.gt-panel[data-form="clear"] button[type="submit"]').tap();
    await dismissAll(gm);
    await dismissAll(p1);

    const done = gm.locator('#gt-done');
    if (!(await done.evaluate((el: any) => el.open))) await done.locator('summary').tap();
    await expect(gm.locator('#gt-done-list .gate', { hasText: STARTER_GATE.name })).toBeVisible();

    // Open Chapter 5: Trial Complete -> Guest title (+1 dis).
    await go(gm, 'gm');
    await openGmSection(gm, 'stories');
    await gm.locator('#gm-stories .st-card [data-st-open]').tap();
    await storyWin(gm).locator('[data-st-go]').tap();
    await answerEachWindow(gm, 'TRIAL COMPLETE', PREGENS.length);

    await waitAndAnswerWindow(p1, 'TRIAL COMPLETE');
    await expect.poll(
      () => p1.evaluate(() => hunterApp.store.active().titles.some((t: any) => t.name === 'Guest' && t.bonus.dis === 1)),
      { timeout: 20_000 },
    ).toBe(true);
    await expect(gm.locator('#gm-stories .st-card .st-next')).toHaveText(STORY_WORDS.last(4));
  });
});

test('solo GM run of The Empty Seat spends Tessa Corbin\'s 12 points, clears both waves, claims 3 Mythics + 1 Epic, and lifts cap to Cap: none', async ({ device }) => {
  const gm = (await device('gm-solo')).page;
  await onboardGM(gm);
  await chooseList(gm);

  await test.step('Tessa Corbin starts with 12 unspent creation points and Cap: 9, and spending them brings her to 0 unspent', async () => {
    await go(gm, 'status');
    const tessaId = await gm.evaluate(name => hunterApp.store.get().hunters.find((h: any) => h.name === name).id as string, STARTER_UNSPENT_HUNTER);
    await gm.locator('#hunter-sel').selectOption(tessaId);
    await expect(gm.locator('#view-status [data-cap-chip]')).toHaveText('Cap: 9');
    await expect(gm.locator('#view-status [data-ap]')).toHaveText('12');

    // Spend 8 Power and 4 Control via Status tab + buttons and confirm.
    for (let i = 0; i < 8; i++) await gm.locator('#view-status button[data-st="pow"][data-dir="1"]').tap();
    for (let i = 0; i < 4; i++) await gm.locator('#view-status button[data-st="ctl"][data-dir="1"]').tap();
    await gm.locator('#view-status [data-confirm]').tap();
    await expect(gm.locator('#view-status [data-ap]')).toHaveText('0');
  });

  await test.step('running Wave 1 then Wave 2 on Tidewall Cannery Gate lets all 4 sample hunters claim 3 Mythics + 1 Epic and reach Cap: none', async () => {
    await go(gm, 'gates');
    const card = gm.locator('#view-gates .gate', { hasText: STARTER_GATE.name });
    await card.locator('[data-act="enter"]').tap();

    // Wave 1: no Gate cleared? modal
    await card.locator('[data-act="encounter"]').tap();
    await gm.locator('[aria-modal="true"] [data-apply]').tap();
    await finishCurrentFight(gm);
    await dismissAll(gm);
    await expect(modalWin(gm, 'Gate cleared?')).toHaveCount(0);

    // Wave 2: triggers Gate cleared? + Lift cap and offer classes
    await go(gm, 'gates');
    await card.locator('[data-act="encounter"]').tap();
    await expect(gm.locator('[aria-modal="true"] [data-wave-pick] input[name="wave"][value="2"]')).toBeChecked();
    await gm.locator('[aria-modal="true"] [data-apply]').tap();
    await finishCurrentFight(gm);
    const clearedDlg = await waitForGateClearedModal(gm);
    await clearedDlg.locator('.sys-actions button', { hasText: OFFER_WORDS.gmLiftAndOfferButton }).tap();

    // Claim 3 Mythics + 1 Epic across the 4 sample hunters.
    const coModal = gm.locator('[data-co-modal]');
    await expect(coModal).toBeVisible();
    for (const cls of ['Bladefiend', 'Rifthunter', 'Seraph', 'Hemomancer'] as const) {
      await coModal.locator(`[data-co-card="${cls}"] [data-co-pick="${cls}"]`).tap();
      await expect(coModal.locator(`[data-co-taken="${cls}"]`)).toContainText('Held by');
    }
    await coModal.locator('[data-co-close-offer]').tap();
    await expect(coModal).toHaveCount(0);

    // Clear gate and verify every sample hunter shows Cap: none and reached at least Level 3.
    await go(gm, 'gates');
    await card.locator('[data-act="clear"]').tap();
    await card.locator('.gt-panel[data-form="clear"] button[type="submit"]').tap();
    await dismissAll(gm);

    const summary = await gm.evaluate(() => hunterApp.store.get().hunters.map((h: any) => ({
      name: h.name,
      level: h.level,
      cap: h.capDisplay,
      job: h.job,
    })));
    expect(summary.every((h: any) => h.cap === 'none' && h.level >= 3)).toBe(true);
    expect(summary.map((h: any) => h.job).sort()).toEqual(['Bladefiend', 'Hemomancer', 'Rifthunter', 'Seraph']);
  });
});

test('clear-before-offer recovery on Tidewall Cannery Gate keeps Lift cap and offer classes active in Finished gates', async ({ device }) => {
  const gm = (await device('gm-recovery')).page;
  await onboardGM(gm);
  await chooseList(gm);

  await go(gm, 'gates');
  const card = gm.locator('#view-gates .gate', { hasText: STARTER_GATE.name });
  await card.locator('[data-act="enter"]').tap();

  // Wave 1 settles without triggering clear or offer.
  await card.locator('[data-act="encounter"]').tap();
  await gm.locator('[aria-modal="true"] [data-apply]').tap();
  await finishCurrentFight(gm);
  await dismissAll(gm);

  // Wave 2 settles with Head Usher down -> GM taps Mark gate cleared BEFORE offering classes.
  await go(gm, 'gates');
  await card.locator('[data-act="encounter"]').tap();
  await gm.locator('[aria-modal="true"] [data-apply]').tap();
  await finishCurrentFight(gm);
  const clearedDlg = await waitForGateClearedModal(gm);
  await clearedDlg.locator('.sys-actions button', { hasText: 'Mark gate cleared' }).tap();

  const clearForm = card.locator('.gt-panel[data-form="clear"]');
  await expect(clearForm).toBeVisible();
  await clearForm.locator('button[type="submit"]').tap();
  await dismissAll(gm);

  // Expand Finished gates: Tidewall Cannery Gate still exposes Lift cap and offer classes.
  const done = gm.locator('#gt-done');
  if (!(await done.evaluate((el: any) => el.open))) await done.locator('summary').tap();
  const clearedCard = gm.locator('#gt-done-list .gate', { hasText: STARTER_GATE.name });
  await expect(clearedCard).toBeVisible();
  await expect(clearedCard.locator('[data-act="class-offer"]')).toHaveText(OFFER_WORDS.gmLiftAndOfferButton);

  // Tapping the recovery button opens the class offer and lifts cap to Cap: none.
  await clearedCard.locator('[data-act="class-offer"]').tap();
  const coModal = gm.locator('[data-co-modal]');
  await expect(coModal).toBeVisible();
  await coModal.locator('[data-co-card="Hemomancer"] [data-co-pick="Hemomancer"]').tap();
  await coModal.locator('[data-co-close-offer]').tap();
  await expect(coModal).toHaveCount(0);

  await expect(clearedCard.locator('[data-act="class-offer"]')).toHaveCount(0);
  await go(gm, 'status');
  await expect(gm.locator('#view-status [data-cap-chip]')).toHaveText('Cap: none');
});
