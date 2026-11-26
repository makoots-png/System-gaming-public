// First-mission & GM unique-class offer, deterministic two-phone race, 4+ Epic / 7th all-taken notice,
// GM award unique-job refusal notice, and 360px phone layout (PR 6).
import type { Page } from '@playwright/test';
import { OFFER_WORDS, classTakenLine, pickRefusedLine } from '../../src/core/hunter/class-offer.ts';
import { CLASS_UI_WORDS } from '../../src/core/hunter/class-view.ts';
import { uniqueJobRefusalText } from '../../src/core/hunter/grant.ts';
import { WAVE1_EPIC_OFFER, WAVE1_MYTHIC_OFFER } from '../../src/core/hunter/class-locker.ts';
import { test, expect, openApp, tapIfShown, onboardGM, onboardPlayer, createRoom, dismissAll, go, chooseList, SMALL_PHONE } from './helpers.ts';

const modalWin = (page: Page, title: string) => page.locator('.sys-overlay.show', { hasText: title });

async function openGmSection(gm: Page, id: string): Promise<void> {
  const tog = gm.locator(`[data-tog="${id}"]`);
  if ((await tog.getAttribute('aria-expanded')) !== 'true') await tog.tap();
}

async function onboardBlankGM(page: Page): Promise<void> {
  await openApp(page);
  for (const step of ['[data-yes]', '[data-gm]', '[data-blank]']) await tapIfShown(page, `.ob-overlay ${step}`);
  const ready = page.locator('.ob-overlay', { has: page.locator('h2', { hasText: 'Campaign ready' }) });
  if (await ready.isVisible().catch(() => false)) await ready.locator('[data-oblater]').tap();
  await expect(page.locator('.ob-overlay')).toHaveCount(0);
  await page.waitForTimeout(300);
  await dismissAll(page);
}

test('starter Goblin Den first fight prompts Offer classes, local hunters claim from 3 Mythics + 3 Epics, and GM panel offers anytime', async ({ device }) => {
  const gm = (await device('gm-starter')).page;
  await onboardGM(gm);
  await dismissAll(gm);

  await test.step('after Goblin Den first fight, GM gets Offer classes alongside Mark gate cleared', async () => {
    await chooseList(gm);
    await go(gm, 'gates');
    const den = gm.locator('#view-gates .gate', { hasText: 'Goblin Den' });
    await expect(den).toBeVisible();
    await den.locator('[data-act="encounter"]').tap();
    await gm.locator('[aria-modal="true"] [data-apply]').tap();
    const endBtn = gm.locator('#view-combat [data-end]').first();
    await expect(endBtn).toBeVisible();
    await gm.evaluate(() => hunterApp.store.update((d: any) => {
      for (const r of d.fight.rows) if (r.side === 'foe') r.life = { at: 'dead' };
    }, 'test-setup'));
    await endBtn.evaluate((el: any) => el.scrollIntoView({ block: 'center' }));
    await endBtn.tap();

    // Confirm End fight XP award and tap past any queued loot/level windows until Gate cleared? is on top.
    const awardBtn = gm.locator('.sys-overlay.show .sys-actions button', { hasText: 'Award XP to party' }).first();
    await expect(awardBtn).toBeVisible();
    await awardBtn.tap();

    const clearedDlg = modalWin(gm, 'Gate cleared?');
    const otherPrimary = gm.locator('.sys-overlay.show', { hasNotText: 'Gate cleared?' }).locator('.sys-actions button.primary').first();
    await expect.poll(async () => {
      if (await clearedDlg.isVisible()) return true;
      if (await otherPrimary.isVisible()) await otherPrimary.tap();
      return false;
    }, { timeout: 15_000 }).toBe(true);

    await expect(clearedDlg).toContainText(OFFER_WORDS.gatePromptNote);
    await expect(clearedDlg.locator('.sys-actions button.primary')).toHaveText('Mark gate cleared');
    await clearedDlg.locator('.sys-actions button', { hasText: OFFER_WORDS.gmOpenButton }).tap();
    await expect(clearedDlg).toHaveCount(0);
  });

  await test.step('live GM offer modal lists 3 Mythics above 3 Epics and claims locally without repeating gate prompt', async () => {
    const coModal = gm.locator('[data-co-modal]');
    await expect(coModal).toBeVisible();
    await expect(coModal.locator('[data-co-mythics] [data-co-card]')).toHaveCount(3);
    await expect(coModal.locator('[data-co-epics] [data-co-card]')).toHaveCount(3);
    for (const cls of WAVE1_MYTHIC_OFFER) await expect(coModal.locator(`[data-co-mythics] [data-co-card="${cls}"]`)).toBeVisible();
    for (const cls of WAVE1_EPIC_OFFER) await expect(coModal.locator(`[data-co-epics] [data-co-card="${cls}"]`)).toBeVisible();
    await expect(coModal.locator('[data-co-epic-note]')).toHaveText(OFFER_WORDS.epicKeepNote);
    // every Wave 1 offer class has its kit (kits PRs 4, 5 and 7), so no card says it has none
    await expect(coModal.locator('[data-co-nokit]')).toHaveCount(0);

    // Pick Hemomancer for the first starter hunter and Seraph (Epic) for the second.
    const firstHunter = await coModal.locator('[data-co-local] option:checked').textContent();
    expect(firstHunter).toBeTruthy();
    await coModal.locator('[data-co-card="Hemomancer"] [data-co-pick="Hemomancer"]').tap();
    await expect(coModal.locator('[data-co-taken="Hemomancer"]')).toContainText('Held by');

    await coModal.locator('[data-co-card="Seraph"] [data-co-pick="Seraph"]').tap();
    await expect(coModal.locator('[data-co-taken="Seraph"]')).toContainText('Held by');

    await coModal.locator('[data-co-close-offer]').tap();
    await expect(coModal).toHaveCount(0);

    // GM panel still exposes Offer classes anytime.
    await go(gm, 'gm');
    await openGmSection(gm, 'classes');
    const regBox = gm.locator('#gm-classes');
    await expect(regBox.locator('[data-cg-offer-open]')).toHaveText(OFFER_WORDS.gmOpenButton);
    await expect(gm.locator('#gm-hsum-classes')).toHaveText('2 of 18 held');
  });
});

test('two-phone race on Hemomancer gives winner the class, shows exact taken copy to loser, supports Epics + all-taken notice, and refuses duplicate unique GM award', async ({ device }) => {
  const gmDev = await device('gm-race', { blockServiceWorker: true });
  const p1Dev = await device('mira-race', { viewport: SMALL_PHONE });
  const p2Dev = await device('kael-race');
  const gm = gmDev.page, p1 = p1Dev.page, p2 = p2Dev.page;

  await onboardBlankGM(gm);
  const code = await createRoom(gm);

  await onboardPlayer(p1, 'Mira', code);
  await dismissAll(p1);
  await onboardPlayer(p2, 'Kael', code);
  await dismissAll(p2);

  // Wait for GM to see both players in the room.
  await expect.poll(
    () => gm.evaluate(() => (hunterApp.api.sync.remoteSheets() as any[]).map(r => r.data.name).sort()),
    { timeout: 20_000 },
  ).toEqual(['Kael', 'Mira']);

  await test.step('GM opens class offer on GM panel (blank campaign); both phones auto-open modal with 3 Mythics + 3 Epics and fit 360px', async () => {
    await go(gm, 'gm');
    await openGmSection(gm, 'classes');
    const regBox = gm.locator('#gm-classes');
    await regBox.locator('[data-cg-offer-open]').tap();
    await expect(gm.locator('[data-co-modal]')).toBeVisible();

    for (const page of [p1, p2]) {
      const m = page.locator('[data-co-modal]');
      await expect(m).toBeVisible({ timeout: 20_000 });
      await expect(m).toContainText(OFFER_WORDS.openBody);
      await expect(m.locator('[data-co-mythics] [data-co-card]')).toHaveCount(3);
      await expect(m.locator('[data-co-epics] [data-co-card]')).toHaveCount(3);
      await expect(m.locator('[data-co-epic-note]')).toHaveText(OFFER_WORDS.epicKeepNote);
    }

    // Verify 360px phone layout has zero horizontal overflow.
    const overflow = await p1.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });

  await test.step('deterministic two-phone race: Mira and Kael both tap Hemomancer before GM polls; Mira wins and Kael sees exact taken line then picks Seraph', async () => {
    // Pause GM room polls so both players tap Hemomancer while it still looks open on both screens.
    let releaseGmPoll!: () => void;
    const holdPoll = new Promise<void>(resolve => { releaseGmPoll = resolve; });
    const pollPattern = `**/api/rooms/${code}*`;
    await gm.route(pollPattern, async route => {
      if (route.request().method() === 'GET') await holdPoll;
      await route.continue();
    });

    const p1Posted = p1.waitForResponse(r => r.url().includes(`/api/rooms/${code}/events`) && r.request().method() === 'POST' && r.status() === 200);
    await p1.locator('[data-co-modal] [data-co-pick="Hemomancer"]').tap();
    await p1Posted;

    const p2Posted = p2.waitForResponse(r => r.url().includes(`/api/rooms/${code}/events`) && r.request().method() === 'POST' && r.status() === 200);
    await p2.locator('[data-co-modal] [data-co-pick="Hemomancer"]').tap();
    await p2Posted;

    // Release GM poll so GM processes Mira's event first and Kael's second in one batch.
    releaseGmPoll();
    await gm.unroute(pollPattern);

    // Mira receives Hemomancer and sees confirmation.
    await expect(p1.locator('[data-co-modal] [data-co-picked]')).toContainText(OFFER_WORDS.alreadyPickedLine('Hemomancer'), { timeout: 20_000 });
    await expect.poll(() => p1.evaluate(() => hunterApp.store.active().job), { timeout: 20_000 }).toBe('Hemomancer');

    // Kael sees exact the owner t148u lost-race notice and can immediately pick an open Epic (Seraph).
    await expect(p2.locator('[data-co-modal] [data-co-msg]')).toHaveText(classTakenLine('Hemomancer', 'Mira'), { timeout: 20_000 });
    await expect(p2.locator('[data-co-modal] [data-co-taken="Hemomancer"]')).toContainText('Held by Mira');

    await p2.locator('[data-co-modal] [data-co-pick="Seraph"]').tap();
    await expect(p2.locator('[data-co-modal] [data-co-picked]')).toContainText(OFFER_WORDS.alreadyPickedLine('Seraph'), { timeout: 20_000 });
    await expect.poll(() => p2.evaluate(() => hunterApp.store.active().job), { timeout: 20_000 }).toBe('Seraph');

    await p1.locator('[data-co-modal] [data-co-dismiss]').tap();
    await p2.locator('[data-co-modal] [data-co-dismiss]').tap();
  });

  await test.step('when Kael is later granted a Mythic, he keeps his Epic Seraph; and when all 6 are taken, an unpicked player sees the plain notice', async () => {
    await gm.locator('[data-co-modal] [data-co-dismiss]').tap();
    await go(gm, 'gm');
    await openGmSection(gm, 'classes');
    const regBox = gm.locator('#gm-classes');

    // Grant Bladefiend (Mythic) to Kael -> Kael keeps Seraph in his locker too.
    await regBox.locator('[data-cg-grant="Bladefiend"]').tap();
    const dlg = modalWin(gm, 'Grant Bladefiend');
    await dlg.locator('[data-cg-hsel]').selectOption({ label: 'Kael (E-rank, Player phone)' });
    await dlg.locator('.sys-actions button.primary').tap();
    await expect(dlg).toHaveCount(0);

    await expect.poll(
      () => p2.evaluate(() => Object.keys(hunterApp.store.active().classes).sort()),
      { timeout: 20_000 },
    ).toEqual(['Bladefiend', 'Seraph']);

    // Claim the remaining 3 offered classes for NPCs so all 6 offered classes are taken.
    for (const [cls, npc] of [['Rifthunter', 'Rift Warden'], ['Ironclad', 'Iron Captain'], ['Stormcaller', 'Sky Mage']] as const) {
      await regBox.locator(`[data-cg-grant="${cls}"]`).tap();
      const d = modalWin(gm, `Grant ${cls}`);
      await d.locator('[data-cg-kind] button[data-kind="npc"]').tap();
      await d.locator('[data-cg-npc-name]').fill(npc);
      await d.locator('.sys-actions button.primary').tap();
      await expect(d).toHaveCount(0);
    }

    // A 3rd player joining now sees the plain all-6-taken notice and never learns NPC names.
    const p3 = (await device('seventh-player')).page;
    await onboardPlayer(p3, 'Sora', code);
    await dismissAll(p3);
    const m3 = p3.locator('[data-co-modal]');
    await expect(m3).toBeVisible({ timeout: 20_000 });
    await expect(m3.locator('[data-co-all-taken]')).toHaveText(OFFER_WORDS.allTakenNotice);
    await expect(m3).not.toContainText('Rift Warden');
    await expect(m3.locator('[data-co-pick]')).toHaveCount(0);
  });

  await test.step('GM Award carrying unique rewards.job Hemomancer (already held by Mira) refuses with notice while still landing gold', async () => {
    await go(gm, 'gm');
    await openGmSection(gm, 'award');
    const targets = gm.locator('#gm-targets');
    for (const box of await targets.locator('input[type="checkbox"]').all()) {
      if (await box.isChecked()) await box.tap();
    }
    const kaelLabel = targets.locator('label.gm-chk', { hasText: 'Kael' }).first();
    await kaelLabel.locator('input[type="checkbox"]').tap();

    const goldBefore = await p2.evaluate(() => hunterApp.store.active().gold);
    const rw = gm.locator('#gm-rw');
    await rw.locator('input[data-n="gold"]').fill('45');
    await rw.locator('button[data-add="job"]').tap();
    await rw.locator('[data-row] input').first().fill('Hemomancer');
    await gm.locator('#gm-award-go').tap();

    const expectedRefusal = uniqueJobRefusalText({ className: 'Hemomancer', why: 'class-taken', holderName: 'Mira' }, 'Kael');
    await expect(gm.locator('#toasts .toast-warning').last()).toContainText(expectedRefusal, { timeout: 15_000 });
    await expect.poll(() => p2.evaluate(() => hunterApp.store.active().gold), { timeout: 20_000 }).toBe(goldBefore + 45);
    expect(await p2.evaluate(() => Object.hasOwn(hunterApp.store.active().classes, 'Hemomancer'))).toBe(false);
  });
});

test('a pick the GM undoes or refuses takes the player off Claiming: a grant released at once, and a pick refused during a fight that ended unseen (statechart rule 5)', async ({ device }) => {
  const gm = (await device('gm-answer', { blockServiceWorker: true })).page;
  const mira = (await device('mira-answer', { blockServiceWorker: true })).page;
  await onboardBlankGM(gm);
  await chooseList(gm);
  const code = await createRoom(gm);
  await onboardPlayer(mira, 'Mira', code);
  await dismissAll(mira);
  await expect.poll(() => gm.evaluate(() => (hunterApp.api.sync.remoteSheets() as any[]).map(r => r.data.name)), { timeout: 20_000 }).toEqual(['Mira']);
  await go(gm, 'gm');
  await openGmSection(gm, 'classes');
  await gm.locator('#gm-classes [data-cg-offer-open]').tap();
  await gm.locator('[data-co-modal] [data-co-dismiss]').tap();
  const m = mira.locator('[data-co-modal]');
  await expect(m).toBeVisible({ timeout: 20_000 });

  await test.step('the GM gives Hemomancer and releases it before either doc goes out: Mira leaves Claiming and can pick again', async () => {
    // the GM's doc puts wait, so Mira reads neither the grant nor the release from a doc
    let putDocs!: () => void;
    const docsHeld = new Promise<void>(resolve => { putDocs = resolve; });
    const docPattern = new RegExp(`/api/rooms/${code}/sheets/_(holders|classOffer)`);
    await gm.route(docPattern, async route => { await docsHeld; await route.continue(); });

    await m.locator('[data-co-pick="Hemomancer"]').tap();
    await expect(m.locator('[data-co-picking="Hemomancer"]')).toHaveText(OFFER_WORDS.pickingAction('Hemomancer'));
    const hemoRow = gm.locator('#gm-classes [data-cg-row="Hemomancer"]');
    await expect(hemoRow).toContainText('Held by Mira', { timeout: 20_000 });
    await hemoRow.locator('[data-cg-release="Hemomancer"]').tap();
    const conf = modalWin(gm, CLASS_UI_WORDS.gmReleaseTitle('Hemomancer'));
    await conf.locator('button', { hasText: CLASS_UI_WORDS.gmReleaseConfirm }).tap();
    await expect(conf).toHaveCount(0);

    await expect(m.locator('[data-co-picking]')).toHaveCount(0, { timeout: 20_000 });
    putDocs();
    await gm.unroute(docPattern);
    await expect(m.locator('[data-co-pick="Hemomancer"]')).toBeEnabled({ timeout: 20_000 });
    expect(await mira.evaluate(() => Object.hasOwn(hunterApp.store.active().classes, 'Hemomancer'))).toBe(false);
  });

  await test.step('Mira picks while the GM\'s fight holds her, and the fight ends before her phone reads it: she sees the reason and can pick again', async () => {
    // Mira's phone reads nothing from the room until the fight has ended
    let letPoll!: () => void;
    const pollHeld = new Promise<void>(resolve => { letPoll = resolve; });
    const pollPattern = `**/api/rooms/${code}*`;
    let caught!: () => void;
    const pollCaught = new Promise<void>(resolve => { caught = resolve; });
    await mira.route(pollPattern, async route => { if (route.request().method() === 'GET') { caught(); await pollHeld; } await route.continue(); });
    // a poll already out before the route answers first: the fight starts only once the next one is caught
    await pollCaught;

    await go(gm, 'combat');
    const combat = gm.locator('#view-combat');
    await combat.locator('[data-hsel]').selectOption({ label: 'Mira (player phone)' });
    await combat.locator('[data-addh]').tap();
    await combat.locator('[data-qline]').fill('Cave Rat, E, brute');
    await combat.locator('[data-qadd]').tap();
    await combat.locator('[data-start]').tap();
    await expect(gm.locator('#view-combat [data-end]')).toBeVisible();

    const posted = mira.waitForResponse(r => r.url().includes(`/api/rooms/${code}/events`) && r.request().method() === 'POST' && r.status() === 200);
    await m.locator('[data-co-pick="Seraph"]').tap();
    const pick = (await posted).request().postDataJSON().payload.eid as string;
    // the GM's phone reads the pick and answers it refused; then the fight ends
    await expect.poll(() => gm.evaluate(eid => (hunterApp.store.get().settings.sync.applied ?? []).includes(eid), pick), { timeout: 20_000 }).toBe(true);
    expect(await gm.evaluate(() => hunterApp.store.get().classHolders.held.Seraph ?? null)).toBeNull();
    await gm.locator('#view-combat [data-end]').tap();
    await dismissAll(gm);

    letPoll();
    await mira.unroute(pollPattern);
    await expect(m.locator('[data-co-msg]')).toHaveText(pickRefusedLine('held', 'Seraph'), { timeout: 20_000 });
    await expect(m.locator('[data-co-picking]')).toHaveCount(0);
    await expect(m.locator('[data-co-pick="Seraph"]')).toBeEnabled();
  });
});
