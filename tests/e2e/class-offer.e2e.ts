// First-mission & GM unique-class offer, deterministic two-phone race, 4+ Epic / 7th all-taken notice,
// GM award unique-job refusal notice, and 360px phone layout (PR 6).
import type { Page } from '@playwright/test';
import { DEFAULT_OFFER_POOL, EPIC_OFFER_POOL, MYTHIC_OFFER_POOL, OFFER_WORDS, classTakenLine, pickRefusedLine } from '../../src/core/hunter/class-offer.ts';
import { CLASS_UI_WORDS } from '../../src/core/hunter/class-view.ts';
import { uniqueJobRefusalText } from '../../src/core/hunter/grant.ts';
import { STARTER_GATE } from '../../src/core/starter.ts';
import { test, expect, openApp, tapIfShown, onboardGM, setupGoblinDenGM, onboardPlayer, createRoom, dismissAll, go, chooseList, SMALL_PHONE } from './helpers.ts';

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

test('starter Goblin Den first fight prompts Offer classes, local hunters claim from wired Mythics + 3 Epics, and GM panel offers anytime', async ({ device }) => {
  const gm = (await device('gm-starter')).page;
  await setupGoblinDenGM(gm);
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
    await clearedDlg.locator('.sys-actions button', { hasText: OFFER_WORDS.gmLiftAndOfferButton }).tap();
    await expect(clearedDlg).toHaveCount(0);
  });

  await test.step('live GM offer modal lists every wired Mythic above 3 Epics and claims locally without repeating gate prompt', async () => {
    const coModal = gm.locator('[data-co-modal]');
    await expect(coModal).toBeVisible();
    await expect(coModal.locator('[data-co-mythics] [data-co-card]')).toHaveCount(MYTHIC_OFFER_POOL.length);
    await expect(coModal.locator('[data-co-epics] [data-co-card]')).toHaveCount(EPIC_OFFER_POOL.length);
    for (const cls of MYTHIC_OFFER_POOL) await expect(coModal.locator(`[data-co-mythics] [data-co-card="${cls}"]`)).toBeVisible();
    for (const cls of EPIC_OFFER_POOL) await expect(coModal.locator(`[data-co-epics] [data-co-card="${cls}"]`)).toBeVisible();
    await expect(coModal.locator('[data-co-epic-note]')).toHaveText(OFFER_WORDS.epicKeepNote);
    // every offered class has its kit, so no card says it has none
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

    // Combined Lift cap and offer classes set every local hunter's Status chip to Cap: none.
    await go(gm, 'status');
    await expect(gm.locator('#view-status [data-cap-chip]')).toBeVisible();
    await expect(gm.locator('#view-status [data-cap-chip]')).toHaveText('Cap: none');

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

  await test.step('GM opens class offer on GM panel (blank campaign); both phones auto-open modal with every wired Mythic + 3 Epics and fit 360px', async () => {
    await go(gm, 'gm');
    await openGmSection(gm, 'classes');
    const regBox = gm.locator('#gm-classes');
    await regBox.locator('[data-cg-offer-open]').tap();
    await expect(gm.locator('[data-co-modal]')).toBeVisible();

    for (const page of [p1, p2]) {
      const m = page.locator('[data-co-modal]');
      await expect(m).toBeVisible({ timeout: 20_000 });
      await expect(m).toContainText(OFFER_WORDS.openBody);
      await expect(m.locator('[data-co-mythics] [data-co-card]')).toHaveCount(MYTHIC_OFFER_POOL.length);
      await expect(m.locator('[data-co-epics] [data-co-card]')).toHaveCount(EPIC_OFFER_POOL.length);
      await expect(m.locator('[data-co-epic-note]')).toHaveText(OFFER_WORDS.epicKeepNote);
    }

    // Verify 360px phone layout has zero horizontal overflow (page and modal body) and the last Epic card is reachable inside the scrollable body.
    const overflow = await p1.evaluate(() => {
      const mid = document.querySelector('[data-co-modal] .co-mid');
      return {
        page: document.documentElement.scrollWidth - window.innerWidth,
        modal: mid ? mid.scrollWidth - mid.clientWidth : 0,
      };
    });
    expect(overflow.page).toBeLessThanOrEqual(1);
    expect(overflow.modal).toBeLessThanOrEqual(1);
    const lastEpic = p1.locator(`[data-co-modal] [data-co-card="${EPIC_OFFER_POOL[EPIC_OFFER_POOL.length - 1]}"]`);
    await lastEpic.scrollIntoViewIfNeeded();
    await expect(lastEpic).toBeVisible();
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

  await test.step('when Kael is later granted a Mythic, he keeps his Epic Seraph; and when all offered classes are taken, an unpicked player sees the plain notice', async () => {
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

    // Claim every remaining offered class for NPCs so all offered classes are taken.
    const alreadyHeld = new Set(['Hemomancer', 'Seraph', 'Bladefiend']);
    const remaining = DEFAULT_OFFER_POOL.filter(c => !alreadyHeld.has(c));
    for (const cls of remaining) {
      const npc = cls === 'Rifthunter' ? 'Rift Warden' : `Secret ${cls} Warden`;
      await regBox.locator(`[data-cg-grant="${cls}"]`).tap();
      const d = modalWin(gm, `Grant ${cls}`);
      await d.locator('[data-cg-kind] button[data-kind="npc"]').tap();
      await d.locator('[data-cg-npc-name]').fill(npc);
      await d.locator('.sys-actions button.primary').tap();
      await expect(d).toHaveCount(0);
    }

    // A 3rd player joining now sees the plain all-taken notice and never learns NPC names.
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

  await test.step('the GM gives Hemomancer and releases it before either doc goes out: another hunter\'s revoke is ignored, Mira\'s revoke clears Claiming with a plain notice, and she can pick again', async () => {
    // the GM's doc puts wait, so Mira reads neither the grant nor the release from a doc
    let putDocs!: () => void;
    const docsHeld = new Promise<void>(resolve => { putDocs = resolve; });
    const docPattern = new RegExp(`/api/rooms/${code}/sheets/_(holders|classOffer)`);
    await gm.route(docPattern, async route => { await docsHeld; await route.continue(); });

    await m.locator('[data-co-pick="Hemomancer"]').tap();
    await expect(m.locator('[data-co-picking="Hemomancer"]')).toHaveText(OFFER_WORDS.pickingAction('Hemomancer'));

    // A classRevoke for another hunter on the same device must not clear Mira's pending Claiming state,
    // even if the player switches active hunters while waiting.
    const miraHid = await mira.evaluate(() => {
      const s = hunterApp.store.get();
      const orig = s.hunters[0];
      const alt = { ...structuredClone(orig), id: 'h-alt', name: 'Bram' };
      hunterApp.store.update((d: any) => { d.hunters.push(alt); d.activeHunterId = 'h-alt'; }, 'test-switch-hunter');
      return orig.id;
    });
    await mira.evaluate(() => {
      const devId = hunterApp.store.get().settings.deviceId;
      hunterApp.emit('sync:event', {
        event: {
          type: 'classRevoke',
          payload: { eid: `${devId}-cr-other`, to: [`${devId}:h999`], className: 'Hemomancer', at: new Date().toISOString() },
        },
      });
    });
    await expect(m.locator('[data-co-picking="Hemomancer"]')).toHaveText(OFFER_WORDS.pickingAction('Hemomancer'));
    await expect(m.locator('[data-co-msg]')).toHaveCount(0);

    const hemoRow = gm.locator('#gm-classes [data-cg-row="Hemomancer"]');
    await expect(hemoRow).toContainText('Held by Mira', { timeout: 20_000 });
    await hemoRow.locator('[data-cg-release="Hemomancer"]').tap();
    const conf = modalWin(gm, CLASS_UI_WORDS.gmReleaseTitle('Hemomancer'));
    await conf.locator('button', { hasText: CLASS_UI_WORDS.gmReleaseConfirm }).tap();
    await expect(conf).toHaveCount(0);

    // Even while Bram is active on the phone, Mira's real classRevoke matches pending.by and clears Claiming.
    await expect(m.locator('[data-co-picking]')).toHaveCount(0, { timeout: 20_000 });
    await expect(m.locator('[data-co-msg]')).toHaveText(OFFER_WORDS.releasedNotice('Hemomancer'));
    await mira.evaluate(hid => {
      hunterApp.store.update((d: any) => {
        d.hunters = d.hunters.filter((h: any) => h.id !== 'h-alt');
        d.activeHunterId = hid;
      }, 'test-restore-hunter');
    }, miraHid);
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

test('two-wave offer gate: Fight 1 preselects Wave 1 with neither Clear modal nor offer; Fight 2 preselects Wave 2, triggers both, and Clear-before-offer keeps the card button active', async ({ device }) => {
  const gm = (await device('gm-waves')).page;
  await onboardGM(gm);
  await dismissAll(gm);
  await chooseList(gm);

  // Author a two-wave E-rank gate using the U1 scripted monsters (goblin-chief in Wave 1, usher + head-usher in Wave 2).
  const gateId = await gm.evaluate(() => {
    const id = hunterApp.store.id('g');
    hunterApp.store.update((d: any) => {
      d.gates.unshift({
        id,
        name: 'Wave Trial Gate',
        rank: 'E',
        type: 'normal',
        status: 'detected',
        breakDay: d.world.day + 1,
        monsters: [
          { monsterId: 'seed:goblin', count: 2, wave: 1 },
          { monsterId: 'seed:goblin-chief', count: 1, wave: 1 },
          { monsterId: 'seed:usher', count: 2, wave: 2 },
        ],
        bossId: 'seed:head-usher',
        notes: '',
        createdDay: d.world.day,
        xpPaid: 0,
        mapId: null,
        fought: [],
        solo: false,
        preset: { at: 'none' },
        difficulty: { gate: { at: 'default' }, boss: { at: 'follows' } },
        classOffer: true,
        bossFell: false,
      });
    }, 'test-wave-gate');
    return id as string;
  });

  await go(gm, 'gates');
  const card = gm.locator(`#view-gates .gate[data-id="${gateId}"]`);
  await expect(card).toBeVisible();
  await expect(card.locator('[data-wave-head="1"]')).toHaveText('Wave 1');
  await expect(card.locator('[data-wave-head="2"]')).toHaveText('Wave 2');
  await expect(card.locator('[data-act="class-offer"]')).toHaveCount(0);

  await test.step('Fight 1 preselects Wave 1 (no Ushers) and settling it triggers neither Gate cleared? nor Lift cap and offer classes', async () => {
    await card.locator('[data-act="encounter"]').tap();
    const dlg = gm.locator('[aria-modal="true"]');
    await expect(dlg.locator('[data-wave-pick] input[name="wave"][value="1"]')).toBeChecked();
    await dlg.locator('[data-apply]').tap();
    await expect(gm.locator('#view-combat [data-end]').first()).toBeVisible();

    const foeNames = await gm.evaluate(() => hunterApp.store.get().fight.rows.filter((r: any) => r.side === 'foe').map((r: any) => r.name));
    expect(foeNames.some((n: string) => n.includes('Usher'))).toBe(false);
    expect(foeNames.some((n: string) => n.includes('Goblin Chief'))).toBe(true);

    await gm.evaluate(() => hunterApp.store.update((d: any) => {
      for (const r of d.fight.rows) if (r.side === 'foe') r.life = { at: 'dead' };
    }, 'test-defeat-wave1'));
    const endBtn = gm.locator('#view-combat [data-end]').first();
    await endBtn.evaluate((el: any) => el.scrollIntoView({ block: 'center' }));
    await endBtn.tap();
    await gm.locator('.sys-overlay.show .sys-actions button', { hasText: 'Award XP to party' }).first().tap();

    // Close rewards/loot windows and verify Gate cleared? never opens.
    await dismissAll(gm);
    await expect(modalWin(gm, 'Gate cleared?')).toHaveCount(0);
    await go(gm, 'gates');
    await expect(card.locator('[data-act="class-offer"]')).toHaveCount(0);
    expect(await gm.evaluate(id => hunterApp.store.get().gates.find((g: any) => g.id === id)?.bossFell, gateId)).toBe(false);
  });

  await test.step('Fight 2 preselects Wave 2 (Ushers + Head Usher), triggers Gate cleared? + Lift cap and offer classes, and clearing first keeps the card button active', async () => {
    await card.locator('[data-act="encounter"]').tap();
    const dlg = gm.locator('[aria-modal="true"]');
    await expect(dlg.locator('[data-wave-pick] input[name="wave"][value="2"]')).toBeChecked();
    await dlg.locator('[data-apply]').tap();
    await expect(gm.locator('#view-combat [data-end]').first()).toBeVisible();

    const foeNames = await gm.evaluate(() => hunterApp.store.get().fight.rows.filter((r: any) => r.side === 'foe').map((r: any) => r.name));
    expect(foeNames.some((n: string) => n.includes('Head Usher'))).toBe(true);
    expect(foeNames.some((n: string) => n.includes('Goblin'))).toBe(false);

    await gm.evaluate(() => hunterApp.store.update((d: any) => {
      for (const r of d.fight.rows) if (r.side === 'foe') r.life = { at: 'dead' };
    }, 'test-defeat-wave2'));
    const endBtn = gm.locator('#view-combat [data-end]').first();
    await endBtn.evaluate((el: any) => el.scrollIntoView({ block: 'center' }));
    await endBtn.tap();
    await gm.locator('.sys-overlay.show .sys-actions button', { hasText: 'Award XP to party' }).first().tap();

    const clearedDlg = modalWin(gm, 'Gate cleared?');
    const otherPrimary = gm.locator('.sys-overlay.show', { hasNotText: 'Gate cleared?' }).locator('.sys-actions button.primary').first();
    await expect.poll(async () => {
      if (await clearedDlg.isVisible()) return true;
      if (await otherPrimary.isVisible()) await otherPrimary.tap();
      return false;
    }, { timeout: 15_000 }).toBe(true);

    await expect(clearedDlg).toContainText(OFFER_WORDS.gatePromptNote);
    await expect(clearedDlg.locator('.sys-actions button', { hasText: OFFER_WORDS.gmLiftAndOfferButton })).toBeVisible();

    // Tap Mark gate cleared BEFORE offering classes to test the post-Clear recovery path.
    await clearedDlg.locator('.sys-actions button', { hasText: 'Mark gate cleared' }).tap();
    const clearForm = card.locator('.gt-panel[data-form="clear"]');
    await expect(clearForm).toBeVisible();
    await clearForm.locator('button[type="submit"]').tap();
    await dismissAll(gm);

    // Open Finished gates: the cleared card still shows Lift cap and offer classes and opens the class offer modal.
    const done = gm.locator('#gt-done');
    if (!(await done.evaluate((el: any) => el.open))) await done.locator('summary').tap();
    const clearedCard = gm.locator(`#gt-done-list .gate[data-id="${gateId}"]`);
    await expect(clearedCard).toBeVisible();
    await expect(clearedCard.locator('[data-act="class-offer"]')).toHaveText(OFFER_WORDS.gmLiftAndOfferButton);
    await clearedCard.locator('[data-act="class-offer"]').tap();
    await expect(gm.locator('[data-co-modal]')).toBeVisible();
  });
});

test('capDisplay chip stays hidden on blank saves, updates via GM picker and rankLevels edits, and syncs to players via capSet', async ({ device }) => {
  const gmDev = await device('gm-cap');
  const p1Dev = await device('p1-cap', { viewport: SMALL_PHONE });
  const gm = gmDev.page, p1 = p1Dev.page;

  await onboardBlankGM(gm);
  const code = await createRoom(gm);

  await onboardPlayer(p1, 'Mira', code);
  await dismissAll(p1);

  await expect.poll(
    () => gm.evaluate(() => (hunterApp.api.sync.remoteSheets() as any[]).map(r => r.data.name)),
    { timeout: 20_000 },
  ).toEqual(['Mira']);

  await test.step('blank saves render no cap chip on either GM or player Status tab', async () => {
    await go(gm, 'status');
    await expect(gm.locator('#view-status [data-cap-chip]')).toBeHidden();
    await go(p1, 'status');
    await expect(p1.locator('#view-status [data-cap-chip]')).toBeHidden();
  });

  await test.step('GM hunter editor picker sets Cap: 9 and a rankLevels edit updates the displayed number live', async () => {
    const picker = gm.locator('#view-status [data-rawcap]');
    await expect(picker).toBeVisible();
    await picker.selectOption('E');
    await expect(gm.locator('#view-status [data-cap-chip]')).toHaveText('Cap: 9');

    await picker.selectOption('D');
    await expect(gm.locator('#view-status [data-cap-chip]')).toHaveText('Cap: 19');

    await picker.selectOption('E');
    await expect(gm.locator('#view-status [data-cap-chip]')).toHaveText('Cap: 9');

    // Edit rankLevels in GM Rules editor so D starts at level 12 -> E displays Cap: 11.
    await go(gm, 'gm');
    await openGmSection(gm, 'rules');
    await gm.locator('#gm-r-text').fill('{"rankLevels":{"D":12}}');
    await gm.locator('#gm-r-save').tap();

    await go(gm, 'status');
    await expect(gm.locator('#view-status [data-cap-chip]')).toHaveText('Cap: 11');
  });

  await test.step('GM Party board picker sends capSet to remote player and Lift cap and offer classes lifts the whole table', async () => {
    await go(gm, 'gm');
    await openGmSection(gm, 'party');
    const remoteCard = gm.locator('#gm-board .gm-card.remote', { hasText: 'Mira' });
    await expect(remoteCard).toBeVisible();
    await remoteCard.locator('[data-gmcap]').selectOption('E');

    await expect(p1.locator('#view-status [data-cap-chip]')).toHaveText('Cap: 9', { timeout: 20_000 });

    // Trigger combined Lift cap and offer classes from a classOffer gate on the GM phone.
    await gm.evaluate(() => {
      hunterApp.api.classUi.openOffer('g1');
    });
    await expect(gm.locator('[data-co-modal]')).toBeVisible();
    await expect(p1.locator('#view-status [data-cap-chip]')).toHaveText('Cap: none', { timeout: 20_000 });
    await gm.locator('[data-co-close-offer]').tap();

    await go(gm, 'status');
    await expect(gm.locator('#view-status [data-cap-chip]')).toHaveText('Cap: none');
  });
});

test('starter Tidewall Cannery Gate gates the class offer on Head Usher falling, uses neutral offer copy, and recovers after Clear', async ({ device }) => {
  const gm = (await device('gm-tidewall')).page;
  await onboardGM(gm);
  await chooseList(gm);

  await go(gm, 'gates');
  const card = gm.locator('#view-gates .gate', { hasText: STARTER_GATE.name });
  await expect(card).toBeVisible();
  await expect(card.locator('[data-wave-head="1"]')).toHaveText('Wave 1');
  await expect(card.locator('[data-wave-head="2"]')).toHaveText('Wave 2');
  await expect(card.locator('[data-act="class-offer"]')).toHaveCount(0);

  // Wave 1 (Goblins + Goblin Shaman + Goblin Chief): no Gate cleared? modal and no class offer button.
  await card.locator('[data-act="encounter"]').tap();
  await expect(gm.locator('[aria-modal="true"] [data-wave-pick] input[name="wave"][value="1"]')).toBeChecked();
  await gm.locator('[aria-modal="true"] [data-apply]').tap();
  await expect(gm.locator('#view-combat [data-end]').first()).toBeVisible();
  await gm.evaluate(() => hunterApp.store.update((d: any) => {
    for (const r of d.fight.rows) if (r.side === 'foe') r.life = { at: 'dead' };
  }, 'test-tidewall-w1'));
  await gm.locator('#view-combat [data-end]').first().evaluate((el: any) => el.scrollIntoView({ block: 'center' }));
  await gm.locator('#view-combat [data-end]').first().tap();
  await gm.locator('.sys-overlay.show .sys-actions button', { hasText: 'Award XP to party' }).first().tap();
  await dismissAll(gm);
  await expect(modalWin(gm, 'Gate cleared?')).toHaveCount(0);

  // Wave 2 (Ushers + Head Usher): opens Gate cleared? with neutral offer copy (no carved altar).
  await go(gm, 'gates');
  await expect(card.locator('[data-act="class-offer"]')).toHaveCount(0);
  await card.locator('[data-act="encounter"]').tap();
  await expect(gm.locator('[aria-modal="true"] [data-wave-pick] input[name="wave"][value="2"]')).toBeChecked();
  await gm.locator('[aria-modal="true"] [data-apply]').tap();
  await expect(gm.locator('#view-combat [data-end]').first()).toBeVisible();
  await gm.evaluate(() => hunterApp.store.update((d: any) => {
    for (const r of d.fight.rows) if (r.side === 'foe') r.life = { at: 'dead' };
  }, 'test-tidewall-w2'));
  await gm.locator('#view-combat [data-end]').first().evaluate((el: any) => el.scrollIntoView({ block: 'center' }));
  await gm.locator('#view-combat [data-end]').first().tap();
  await gm.locator('.sys-overlay.show .sys-actions button', { hasText: 'Award XP to party' }).first().tap();

  const clearedDlg = modalWin(gm, 'Gate cleared?');
  const otherPrimary = gm.locator('.sys-overlay.show', { hasNotText: 'Gate cleared?' }).locator('.sys-actions button.primary').first();
  await expect.poll(async () => {
    if (await clearedDlg.isVisible()) return true;
    if (await otherPrimary.isVisible()) await otherPrimary.tap();
    return false;
  }, { timeout: 15_000 }).toBe(true);

  await expect(clearedDlg).toContainText(OFFER_WORDS.gatePromptNote);
  await expect(clearedDlg).not.toContainText(/carved altar/i);
  await clearedDlg.locator('.sys-actions button', { hasText: OFFER_WORDS.gmLiftAndOfferButton }).tap();
  const coModal = gm.locator('[data-co-modal]');
  await expect(coModal).toBeVisible();
  await expect(coModal).not.toContainText(/carved altar/i);
  await coModal.locator('[data-co-close-offer]').tap();
});
