// Class locker, skill tree buyer, fork flip, GM unique-class registry, two-tab room uniqueness, and phone layout (PR 3).
import type { Page } from '@playwright/test';
import { CLASS_REFUSAL_WORDS, classNodeSaid, classSwapSaid } from '../../src/core/hunter/classes.ts';
import { HOLDER_REFUSAL_WORDS } from '../../src/core/hunter/class-holders.ts';
import { CLASS_UI_WORDS, forkRefusalWords, nodeRefusalWords, swapRefusalWords } from '../../src/core/hunter/class-view.ts';
import { test, expect, onboardGM, onboardPlayer, createRoom, dismissAll, go, chooseList, PHONE, SMALL_PHONE } from './helpers.ts';

const modalWin = (page: Page, title: string) => page.locator('.sys-overlay.show', { hasText: title });

test('player class locker enforces setJob refusals, free vs paid swapClass, short-gold refusal, and mid-fight refusal', async ({ device }) => {
  const page = (await device('solo-locker')).page;
  await onboardPlayer(page, 'Kai Locker');
  await dismissAll(page);
  await go(page, 'status');

  const panel = page.locator('#view-status [data-panel="classes"]');
  const jobInput = panel.locator('[data-cls-job]');
  const setBtn = panel.locator('[data-cls-job-set]');

  await test.step('setJob refuses unique names, Shadow Monarch alias, and unearned Rare names with CLASS_REFUSAL_WORDS, while allowing Fighter', async () => {
    for (const bad of ['Hemomancer', 'Necromancer', 'Shadow Monarch']) {
      await jobInput.fill(bad);
      await setBtn.tap();
      await expect(page.locator('#toasts .toast-warning').last()).toContainText(CLASS_REFUSAL_WORDS['unique-class']);
    }
    await jobInput.fill('Pyromancer');
    await setBtn.tap();
    await expect(page.locator('#toasts .toast-warning').last()).toContainText(CLASS_REFUSAL_WORDS['not-earned']);

    await jobInput.fill('Fighter');
    await setBtn.tap();
    await expect(panel.locator('[data-cls-active]')).toContainText('Fighter');
    expect(await page.evaluate(() => hunterApp.store.active().job)).toBe('Fighter');
  });

  await test.step('swapping between earned classes is free before first fight, then charges 25 gold at E rank with ui.warn confirm', async () => {
    await page.evaluate(() => {
      hunterApp.store.update((d: any) => {
        const h = d.hunters[0];
        const at = new Date().toISOString();
        h.classes = {
          Fighter: { unlockedAt: at, nodes: [] },
          Mage: { unlockedAt: at, nodes: [] },
        };
        h.job = 'Fighter';
        h.jobDone = 'Fighter';
      }, 'test-setup');
    });

    const mageRow = panel.locator('[data-cls-entry="Mage"]');
    await expect(mageRow).toContainText('Swap (Free)');
    await mageRow.locator('[data-cls-swap="Mage"]').tap();
    await expect(page.locator('.sys-overlay.show')).toHaveCount(0);
    await expect(panel.locator('[data-cls-active]')).toContainText('Mage');
    expect(await page.evaluate(() => hunterApp.store.active().job)).toBe('Mage');

    // After first fight: short on gold (10 < 25) refuses cleanly with exact gold numbers.
    await page.evaluate(() => {
      hunterApp.store.update((d: any) => {
        const h = d.hunters[0];
        h.chronicle.tally.fights = 1;
        h.gold = 10;
      }, 'test-setup');
    });
    const fighterRow = panel.locator('[data-cls-entry="Fighter"]');
    await expect(fighterRow).toContainText('Swap (25 gold)');
    await fighterRow.locator('[data-cls-swap="Fighter"]').tap();
    await expect(page.locator('#toasts .toast-warning').last()).toContainText(swapRefusalWords(25, 10).gold);
    expect(await page.evaluate(() => hunterApp.store.active().job)).toBe('Mage');

    // Fund with 100 gold: Cancel keeps Mage and gold; Pay swaps to Fighter and deducts 25 gold.
    await page.evaluate(() => {
      hunterApp.store.update((d: any) => { d.hunters[0].gold = 100; }, 'test-setup');
    });
    await fighterRow.locator('[data-cls-swap="Fighter"]').tap();
    const warn = page.locator('.sys-overlay.show .sys-window.sys-warn');
    await expect(warn).toBeVisible();
    await expect(warn).toContainText(CLASS_UI_WORDS.swapWarnTitle('Fighter'));
    await warn.locator('button', { hasText: 'Cancel' }).tap();
    await expect(warn).toHaveCount(0);
    expect(await page.evaluate(() => hunterApp.store.active().gold)).toBe(100);

    await fighterRow.locator('[data-cls-swap="Fighter"]').tap();
    await warn.locator('button', { hasText: CLASS_UI_WORDS.payAction(25) }).tap();
    await expect(warn).toHaveCount(0);
    await expect(panel.locator('[data-cls-active]')).toContainText('Fighter');
    expect(await page.evaluate(() => ({ job: hunterApp.store.active().job, gold: hunterApp.store.active().gold }))).toEqual({
      job: 'Fighter',
      gold: 75,
    });
  });

  await test.step('once locker has earned classes, Classes hides starter job and Identity Edit Job refuses earned classes', async () => {
    await expect(panel.locator('[data-cls-starter]')).toHaveCount(0);
    const statusWin = page.locator('#view-status [data-panel="status-window"]');
    await statusWin.locator('[data-idedit]').tap();
    const idJob = statusWin.locator('[data-f="job"]');
    await idJob.fill('Mage');
    await idJob.press('Enter');
    await expect(page.locator('#toasts .toast-warning').last()).toContainText(CLASS_REFUSAL_WORDS['earned-class']);
    await statusWin.locator('[data-iddone]').tap();
  });
});

test('skill tree buyer and fork flip deduct gold, unlock capstone early, preserve convergence on flip, and refuse mid-fight', async ({ device }) => {
  const dev = await device('solo-tree');
  const page = dev.page;
  await onboardPlayer(page, 'Sora Tree');
  await dismissAll(page);
  await page.evaluate(() => {
    hunterApp.store.update((d: any) => {
      const h = d.hunters[0];
      const at = new Date().toISOString();
      h.classes = { Pyromancer: { unlockedAt: at, nodes: [] } };
      h.job = 'Pyromancer';
      h.jobDone = 'Pyromancer';
      h.chronicle.tally.fights = 1;
      h.gold = 2000;
    }, 'test-setup');
  });
  await go(page, 'status');

  const panel = page.locator('#view-status [data-panel="classes"]');
  const tree = panel.locator('[data-cls-tree="Pyromancer"]');

  await test.step('Skill tree starts collapsed; opening it shows Root buyable, Depth 2 locked with parent hint, and buying Root deducts 15 gold', async () => {
    await expect(tree).toBeVisible();
    await expect(tree).not.toHaveAttribute('open', '');
    await tree.locator('summary').tap();
    await expect(tree).toHaveAttribute('open', '');
    await expect(tree.locator('[data-cls-node="pyro-root"]')).toHaveAttribute('data-cls-status', 'buyable');
    await expect(tree.locator('[data-cls-node="pyro-a2"]')).toHaveAttribute('data-cls-status', 'locked');
    await expect(tree.locator('[data-cls-node="pyro-a2"]')).toContainText('Needs: Kindled Focus');
    await expect(tree.locator('[data-cls-fork="pyro-a5"]')).toContainText(CLASS_UI_WORDS.forkPickOne);

    await tree.locator('[data-cls-buy="pyro-root"]').tap();
    const warn = page.locator('.sys-overlay.show .sys-window.sys-warn');
    await expect(warn).toContainText(CLASS_UI_WORDS.nodeWarnTitle('Kindled Focus'));
    await warn.locator('button', { hasText: CLASS_UI_WORDS.payAction(15) }).tap();
    await expect(warn).toHaveCount(0);

    await expect(tree.locator('[data-cls-node="pyro-root"]')).toHaveAttribute('data-cls-status', 'owned');
    await expect(tree.locator('[data-cls-node="pyro-a2"]')).toHaveAttribute('data-cls-status', 'buyable');
    expect(await page.evaluate(() => hunterApp.store.active().gold)).toBe(1985);
  });

  await test.step('buying down branch A reaches Depth 5 fork, locks its twin, unlocks Capstone, and flips fork keeping convergence', async () => {
    for (const id of ['pyro-a2', 'pyro-a3x', 'pyro-a3y', 'pyro-a4x', 'pyro-a4y', 'pyro-a5-l']) {
      await tree.locator(`[data-cls-buy="${id}"]`).tap();
      const warn = page.locator('.sys-overlay.show .sys-window.sys-warn');
      await warn.locator('button.primary').tap();
      await expect(warn).toHaveCount(0);
    }

    await expect(tree.locator('[data-cls-node="pyro-a5-l"]')).toHaveAttribute('data-cls-status', 'owned');
    await expect(tree.locator('[data-cls-node="pyro-a5-r"]')).toHaveAttribute('data-cls-status', 'fork-taken');
    await expect(tree.locator('[data-cls-node="pyro-a6"]')).toHaveAttribute('data-cls-status', 'buyable');

    // Buy branch A penultimate convergence node pyro-a6 -> unlocks Capstone early.
    await tree.locator('[data-cls-buy="pyro-a6"]').tap();
    await page.locator('.sys-overlay.show .sys-window.sys-warn button.primary').tap();
    await expect(tree.locator('[data-cls-capstone-ready]')).toHaveText(CLASS_UI_WORDS.capstoneReady);
    await expect(tree.locator('[data-cls-node="pyro-cap"]')).toHaveAttribute('data-cls-status', 'buyable');

    // Flip fork from pyro-a5-l to pyro-a5-r for 25 gold: pyro-a6 convergence survives.
    const goldBeforeFlip = await page.evaluate(() => hunterApp.store.active().gold);
    await tree.locator('[data-cls-flip-from="pyro-a5-l"][data-cls-flip-to="pyro-a5-r"]').tap();
    const flipWarn = page.locator('.sys-overlay.show .sys-window.sys-warn');
    await expect(flipWarn).toContainText(CLASS_UI_WORDS.flipWarnTitle('Molten Basin', 'Cinder Pit'));
    await flipWarn.locator('button', { hasText: CLASS_UI_WORDS.payAction(25) }).tap();
    await expect(flipWarn).toHaveCount(0);

    await expect(tree.locator('[data-cls-node="pyro-a5-r"]')).toHaveAttribute('data-cls-status', 'owned');
    await expect(tree.locator('[data-cls-node="pyro-a5-l"]')).toHaveAttribute('data-cls-status', 'fork-taken');
    await expect(tree.locator('[data-cls-node="pyro-a6"]')).toHaveAttribute('data-cls-status', 'owned');
    expect(await page.evaluate(() => hunterApp.store.active().gold)).toBe(goldBeforeFlip - 25);
  });

  await test.step('short gold refuses buyClassNode and flipClassFork cleanly with exact gold numbers, and mid-fight refuses both', async () => {
    await page.evaluate(() => {
      hunterApp.store.update((d: any) => { d.hunters[0].gold = 5; }, 'test-setup');
    });
    await tree.locator('[data-cls-buy="pyro-cap"]').tap();
    await expect(page.locator('#toasts .toast-warning').last()).toContainText(nodeRefusalWords(180, 5).gold);

    await tree.locator('[data-cls-flip-from="pyro-a5-r"][data-cls-flip-to="pyro-a5-l"]').tap();
    await expect(page.locator('#toasts .toast-warning').last()).toContainText(forkRefusalWords(25, 5).gold);

    // Fund hunter and put them in an active fight (GM mode on solo device): both buy and flip refuse 'held'.
    await page.evaluate(() => {
      hunterApp.store.update((d: any) => {
        d.settings.mode = 'gm';
        d.hunters[0].gold = 2000;
      }, 'test-setup');
    });
    await go(page, 'combat');
    await page.locator('#view-combat [data-hsel]').selectOption({ label: 'Sora Tree' });
    await page.locator('#view-combat [data-addh]').tap();
    await page.locator('#view-combat [data-qline]').fill('Cave Rat, E, brute');
    await page.locator('#view-combat [data-qadd]').tap();
    await page.locator('#view-combat [data-start]').tap();

    await go(page, 'status');
    if ((await tree.getAttribute('open')) === null) await tree.locator('summary').tap();
    await tree.locator('[data-cls-buy="pyro-cap"]').tap();
    await expect(page.locator('#toasts .toast-warning').last()).toContainText(CLASS_REFUSAL_WORDS.held);
    await tree.locator('[data-cls-flip-from="pyro-a5-r"][data-cls-flip-to="pyro-a5-l"]').tap();
    await expect(page.locator('#toasts .toast-warning').last()).toContainText(CLASS_REFUSAL_WORDS.held);

    // Mid-fight Identity Edit Job change is also refused by setJob in core.
    const statusWin = page.locator('#view-status [data-panel="status-window"]');
    await statusWin.locator('[data-idedit]').tap();
    await statusWin.locator('[data-f="job"]').fill('Fighter');
    await statusWin.locator('[data-f="job"]').press('Enter');
    await expect(page.locator('#toasts .toast-warning').last()).toContainText(CLASS_REFUSAL_WORDS.held);
    expect(await page.evaluate(() => hunterApp.store.active().job)).toBe('Pyromancer');
  });
});

test('two-tab room uniqueness: GM grants, strips spoofed unique, enforces in-fight refusal, reassigns atomically, resets nodes on re-grant, restores Necromancer extraction, and logs player swaps/nodes', async ({ device }) => {
  const gmDev = await device('gm-reg');
  const p1Dev = await device('p1-reg');
  const p2Dev = await device('p2-reg');
  const gm = gmDev.page, p1 = p1Dev.page, p2 = p2Dev.page;

  await onboardGM(gm);
  await chooseList(gm);
  const code = await createRoom(gm);
  await onboardPlayer(p1, 'Mira Unique', code);
  await chooseList(p1);
  await onboardPlayer(p2, 'Kael Unique', code);
  await chooseList(p2);
  await expect.poll(() => p1.evaluate(() => hunterApp.api.sync.room())).toBe(code);
  await expect.poll(() => p2.evaluate(() => hunterApp.api.sync.room())).toBe(code);
  await dismissAll(p1, 4);
  await dismissAll(p2, 4);

  await go(gm, 'gm');
  await expect(gm.locator('#gm-board .gm-card.remote', { hasText: 'Mira Unique' })).toHaveCount(1);
  await expect(gm.locator('#gm-board .gm-card.remote', { hasText: 'Kael Unique' })).toHaveCount(1);

  const clsTog = gm.locator('[data-tog="classes"]');
  if ((await clsTog.getAttribute('aria-expanded')) !== 'true') await clsTog.tap();
  const regBox = gm.locator('#gm-classes');

  await test.step('GM grants Hemomancer to Mira Unique; DOCS.holders syncs it to Mira and blocks Kael from taking it', async () => {
    await expect(gm.locator('#gm-hsum-classes')).toHaveText('0 of 18 held');
    const hemoRow = regBox.locator('[data-cg-row="Hemomancer"]');
    await hemoRow.locator('[data-cg-grant="Hemomancer"]').tap();

    const dlg = modalWin(gm, CLASS_UI_WORDS.gmGrantTitle('Hemomancer'));
    await expect(dlg).toBeVisible();
    await dlg.locator('[data-cg-hsel]').selectOption({ label: 'Mira Unique (E-rank, Player phone)' });
    await dlg.locator('.sys-actions button.primary').tap();
    await expect(dlg).toHaveCount(0);

    await expect(gm.locator('#gm-hsum-classes')).toHaveText('1 of 18 held');
    await expect(hemoRow).toContainText('Held by Mira Unique (Player phone)');
    await expect(hemoRow.locator('[data-cg-nokit]'), 'Hemomancer has its kit since PR 2').toHaveCount(0);
    await expect(hemoRow.locator('[data-cg-grant]')).toHaveCount(0);
    await expect(hemoRow.locator('[data-cg-sync="synced"]')).toHaveText(CLASS_UI_WORDS.syncedBadge, { timeout: 15_000 });

    // Mira's phone converges from DOCS.holders automatically.
    await expect.poll(() => p1.evaluate(() => hunterApp.store.active().job), { timeout: 20_000 }).toBe('Hemomancer');
    await go(p1, 'status');
    await expect(p1.locator('#view-status [data-panel="classes"] [data-cls-active]')).toContainText('Hemomancer');

    // Unbacked Hemomancer injected on Kael is dropped by DOCS.holders reconcile and never trusted on GM remoteSheets().
    await p2.evaluate(() => {
      hunterApp.store.update((d: any) => {
        const h = d.hunters[0];
        const at = new Date().toISOString();
        h.classes.Hemomancer = { unlockedAt: at, nodes: [] };
        h.job = 'Hemomancer';
        h.jobDone = 'Hemomancer';
      }, 'test-spoof');
    });
    await expect.poll(() => p2.evaluate(() => hunterApp.store.active().job), { timeout: 20_000 }).toBeNull();
    await expect.poll(() => gm.evaluate(() => (hunterApp.api.sync.remoteSheets() as any[]).filter(r => r.data.job === 'Hemomancer').map(r => r.data.name)), { timeout: 20_000 }).toEqual(['Mira Unique']);

    // Kael cannot type Hemomancer as free text.
    await go(p2, 'status');
    await p2.locator('#view-status [data-panel="classes"] [data-cls-job]').fill('Hemomancer');
    await p2.locator('#view-status [data-panel="classes"] [data-cls-job-set]').tap();
    await expect(p2.locator('#toasts .toast-warning').last()).toContainText(CLASS_REFUSAL_WORDS['unique-class']);
  });

  await test.step('while Mira is held in a GM fight, Release and Reassign refuse in plain words and player swap refuses mid-fight', async () => {
    await go(gm, 'combat');
    const combat = gm.locator('#view-combat');
    await combat.locator('[data-hsel]').selectOption({ label: 'Mira Unique (player phone)' });
    await combat.locator('[data-addh]').tap();
    await combat.locator('[data-qline]').fill('Cave Rat, E, brute');
    await combat.locator('[data-qadd]').tap();
    await combat.locator('[data-start]').tap();
    await expect.poll(() => p1.evaluate(() => hunterApp.api.sync.doc('fight')?.active ?? false), { timeout: 15_000 }).toBe(true);

    // GM registry marks Hemomancer as In fight and refuses Release + Reassign with HOLDER_REFUSAL_WORDS.held.
    await go(gm, 'gm');
    const hemoRow = regBox.locator('[data-cg-row="Hemomancer"]');
    await expect(hemoRow).toContainText(CLASS_UI_WORDS.inFightBadge);

    await hemoRow.locator('[data-cg-release="Hemomancer"]').tap();
    await expect(gm.locator('#toasts .toast-warning').last()).toContainText(HOLDER_REFUSAL_WORDS.held);
    await expect(regBox.locator('[data-cg-msg]')).toHaveText(HOLDER_REFUSAL_WORDS.held);

    await hemoRow.locator('[data-cg-reassign="Hemomancer"]').tap();
    const rdlg = modalWin(gm, CLASS_UI_WORDS.gmReassignTitle('Hemomancer'));
    await expect(rdlg.locator('[data-cg-warn]')).toHaveText(CLASS_UI_WORDS.gmHeldWarning);
    await rdlg.locator('[data-cg-hsel]').selectOption({ label: 'Kael Unique (E-rank, Player phone)' });
    await rdlg.locator('.sys-actions button.primary').tap();
    await expect(rdlg).toHaveCount(0);
    await expect(gm.locator('#toasts .toast-warning').last()).toContainText(HOLDER_REFUSAL_WORDS.held);
    await expect(hemoRow).toContainText('Held by Mira Unique (Player phone)');

    // Mira's phone also refuses swapping classes mid-fight.
    await p1.evaluate(() => {
      hunterApp.store.update((d: any) => {
        const h = d.hunters[0];
        h.classes.Fighter = { unlockedAt: new Date().toISOString(), nodes: [] };
      }, 'test-setup');
    });
    await go(p1, 'status');
    await p1.locator('#view-status [data-panel="classes"] [data-cls-swap="Fighter"]').tap();
    await expect(p1.locator('#toasts .toast-warning').last()).toContainText(CLASS_REFUSAL_WORDS.held);
    expect(await p1.evaluate(() => hunterApp.store.active().job)).toBe('Hemomancer');

    // End the fight so reassignment can proceed.
    await go(gm, 'combat');
    await gm.locator('#view-combat [data-end]').tap();
    await dismissAll(gm);
    await expect.poll(() => p1.evaluate(() => hunterApp.api.sync.doc('fight')?.ended ?? true), { timeout: 15_000 }).toBe(true);
  });

  await test.step('after fight ends, GM reassigns Hemomancer from Mira to Kael in one step, and both players converge', async () => {
    await go(gm, 'gm');
    const hemoRow = regBox.locator('[data-cg-row="Hemomancer"]');
    await hemoRow.locator('[data-cg-reassign="Hemomancer"]').tap();
    const rdlg = modalWin(gm, CLASS_UI_WORDS.gmReassignTitle('Hemomancer'));
    await rdlg.locator('[data-cg-hsel]').selectOption({ label: 'Kael Unique (E-rank, Player phone)' });
    await rdlg.locator('.sys-actions button.primary').tap();
    await expect(rdlg).toHaveCount(0);

    await expect(hemoRow).toContainText('Held by Kael Unique (Player phone)');
    await expect.poll(() => p1.evaluate(() => hunterApp.store.active().job), { timeout: 20_000 }).toBeNull();
    await expect.poll(() => p2.evaluate(() => hunterApp.store.active().job), { timeout: 20_000 }).toBe('Hemomancer');
  });

  await test.step('GM releases and re-grants Hemomancer to Kael, issuing a fresh grantId and resetting bought nodes', async () => {
    const firstGrantId = await p2.evaluate(() => {
      hunterApp.store.update((d: any) => {
        const entry = d.hunters[0].classes.Hemomancer;
        if (entry) entry.nodes = ['root'];
      }, 'test-nodes');
      return hunterApp.store.active().classes.Hemomancer?.grantId ?? null;
    });
    expect(firstGrantId).toBeTruthy();

    const hemoRow = regBox.locator('[data-cg-row="Hemomancer"]');
    await hemoRow.locator('[data-cg-release="Hemomancer"]').tap();
    const rconf = modalWin(gm, CLASS_UI_WORDS.gmReleaseTitle('Hemomancer'));
    await rconf.locator('button', { hasText: CLASS_UI_WORDS.gmReleaseConfirm }).tap();
    await expect(rconf).toHaveCount(0);
    await expect.poll(() => p2.evaluate(() => hunterApp.store.active().job), { timeout: 20_000 }).toBeNull();

    await hemoRow.locator('[data-cg-grant="Hemomancer"]').tap();
    const gdlg = modalWin(gm, CLASS_UI_WORDS.gmGrantTitle('Hemomancer'));
    await gdlg.locator('[data-cg-hsel]').selectOption({ label: 'Kael Unique (E-rank, Player phone)' });
    await gdlg.locator('.sys-actions button.primary').tap();
    await expect(gdlg).toHaveCount(0);

    await expect.poll(() => p2.evaluate(() => hunterApp.store.active().job), { timeout: 20_000 }).toBe('Hemomancer');
    const secondGrant = await p2.evaluate(() => hunterApp.store.active().classes.Hemomancer);
    expect(secondGrant?.grantId).toBeTruthy();
    expect(secondGrant?.grantId).not.toBe(firstGrantId);
    expect(secondGrant?.nodes).toEqual([]);
  });

  await test.step('GM claims Seraph for an NPC and releases it back to Open', async () => {
    const seraphRow = regBox.locator('[data-cg-row="Seraph"]');
    await expect(seraphRow.locator('[data-cg-nokit]')).toHaveCount(0);
    await seraphRow.locator('[data-cg-grant="Seraph"]').tap();
    const dlg = modalWin(gm, CLASS_UI_WORDS.gmGrantTitle('Seraph'));
    await dlg.locator('[data-cg-kind] button[data-kind="npc"]').tap();
    await dlg.locator('[data-cg-npc-name]').fill('Archon Vael');
    await dlg.locator('.sys-actions button.primary').tap();
    await expect(dlg).toHaveCount(0);

    await expect(gm.locator('#gm-hsum-classes')).toHaveText('2 of 18 held');
    await expect(seraphRow).toContainText('Held by Archon Vael (NPC)');

    await seraphRow.locator('[data-cg-release="Seraph"]').tap();
    const conf = modalWin(gm, CLASS_UI_WORDS.gmReleaseTitle('Seraph'));
    await conf.locator('button', { hasText: CLASS_UI_WORDS.gmReleaseConfirm }).tap();
    await expect(conf).toHaveCount(0);
    await expect(gm.locator('#gm-hsum-classes')).toHaveText('1 of 18 held');
    await expect(seraphRow).toContainText(CLASS_UI_WORDS.gmUnclaimed);
  });

  await test.step('GM grants Necromancer to Mira restoring shadow extraction, and Kael swaps/buys a node logged by human name', async () => {
    const necroRow = regBox.locator('[data-cg-row="Necromancer"]');
    await necroRow.locator('[data-cg-grant="Necromancer"]').tap();
    const ndlg = modalWin(gm, CLASS_UI_WORDS.gmGrantTitle('Necromancer'));
    await ndlg.locator('[data-cg-hsel]').selectOption({ label: 'Mira Unique (E-rank, Player phone)' });
    await ndlg.locator('.sys-actions button.primary').tap();
    await expect(ndlg).toHaveCount(0);
    await expect.poll(() => p1.evaluate(() => hunterApp.api.shadows.canExtract(hunterApp.store.active())), { timeout: 20_000 }).toBe(true);

    await p2.evaluate(() => {
      hunterApp.store.update((d: any) => {
        const h = d.hunters[0];
        h.classes.Pyromancer = { unlockedAt: new Date().toISOString(), nodes: [] };
        h.gold = 200;
      }, 'test-setup');
    });
    await go(p2, 'status');
    const p2Panel = p2.locator('#view-status [data-panel="classes"]');
    await p2Panel.locator('[data-cls-swap="Pyromancer"]').tap();
    await expect(p2Panel.locator('[data-cls-active]')).toContainText('Pyromancer');

    const p2Tree = p2Panel.locator('[data-cls-tree-fold]');
    await p2Tree.locator('summary').tap();
    await p2Panel.locator('[data-cls-buy="pyro-root"]').tap();
    await p2.locator('.sys-overlay.show .sys-window.sys-warn button.primary').tap();
    await expect(p2Panel.locator('[data-cls-node="pyro-root"]')).toHaveAttribute('data-cls-status', 'owned');

    const wantSwap = classSwapSaid('Kael Unique', 'Hemomancer', 'Pyromancer', 0).text;
    const wantBuy = classNodeSaid('Kael Unique', 'Pyromancer', 'Kindled Focus', 15).text;
    await expect.poll(() => gm.evaluate(() => hunterApp.store.get().log.map((l: any) => l.text)), { timeout: 20_000 }).toContain(wantSwap);
    await expect.poll(() => gm.evaluate(() => hunterApp.store.get().log.map((l: any) => l.text)), { timeout: 20_000 }).toContain(wantBuy);
  });
});

for (const vp of [SMALL_PHONE, PHONE]) {
  test(`Classes panel and GM Unique classes section fit cleanly at ${vp.width}px with no horizontal overflow`, async ({ device }) => {
    const dev = await device(`cls-vp-${vp.width}`, { viewport: vp });
    const page = dev.page;
    await onboardGM(page);
    await dismissAll(page);
    await page.evaluate(() => {
      hunterApp.store.update((d: any) => {
        const h = d.hunters[0];
        const at = new Date().toISOString();
        h.classes = { Pyromancer: { unlockedAt: at, nodes: ['pyro-root'] }, Fighter: { unlockedAt: at, nodes: [] } };
        h.job = 'Pyromancer';
        h.jobDone = 'Pyromancer';
      }, 'test-setup');
    });

    await go(page, 'status');
    const fold = page.locator('#view-status [data-panel="classes"] [data-cls-tree-fold]');
    await fold.locator('summary').tap();
    await fold.scrollIntoViewIfNeeded();
    expect(await page.evaluate(() => document.scrollingElement!.scrollWidth <= window.innerWidth), `status overflow at ${vp.width}px`).toBe(true);

    await go(page, 'gm');
    const tog = page.locator('[data-tog="classes"]');
    if ((await tog.getAttribute('aria-expanded')) !== 'true') await tog.tap();
    await page.locator('#gm-classes').scrollIntoViewIfNeeded();
    expect(await page.evaluate(() => document.scrollingElement!.scrollWidth <= window.innerWidth), `gm overflow at ${vp.width}px`).toBe(true);
  });
}
