// Keystones UI and room switch (unit K6): allocation shares, Confirm bar preview, sheet Keystones panel,
// Keystones codex view (all 44), Rules page lines, and GM room switch. Reads words from core word tables.
import { mkdir } from 'node:fs/promises';
import type { Page } from '@playwright/test';
import { RULES } from '../../src/core/rules.ts';
import type { Rules } from '../../src/core/rules.ts';
import { STAT_KEYS, statsBy } from '../../src/core/stats.ts';
import type { StatKey } from '../../src/core/stats.ts';
import { keystoneDiff, keystoneReach, nearestKeystone } from '../../src/core/hunter/keystones.ts';
import { keystoneOf } from '../../src/core/registry/keystones.ts';
import {
  KEYSTONE_SWITCH_WORDS, KEYSTONE_WORDS, keystoneConfirmLine, keystoneCountLine,
  keystoneLines, keystoneNextLine, keystoneShareAria, keystoneShareText, keystoneTierLabel,
} from '../../src/core/rules-text.ts';
import { test, expect, onboardGM, onboardPlayer, createRoom, dismissAll, go } from './helpers.ts';

const SHOTS = process.env.K6_SHOTS ?? '';
const shot = async (page: Page, name: string, target?: string, block: ScrollLogicalPosition = 'center') => {
  if (!SHOTS) return;
  if (target) await page.locator(target).first().evaluate((el, b) => el.scrollIntoView({ block: b, behavior: 'instant' }), block);
  await mkdir(SHOTS, { recursive: true });
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: false });
};

const KS_ON: Rules = { ...RULES, fight: { ...RULES.fight, keystone: { ...RULES.fight.keystone, on: true } } };
const built = (points: Partial<Record<StatKey, number>>) => statsBy(k => RULES.fight.statBase + (points[k] ?? 0));

/** Seeds a local hunter with exact rank, confirmed stats, and free bonusPoints, and turns keystones on via rulesOverrides. */
async function setupKeystoneHunter(page: Page, o: { rank: string; stats: Record<StatKey, number>; bonusPoints?: number; job?: string | null; jobDone?: string | null; on?: boolean; keystoneOverrides?: Record<string, unknown> }) {
  await page.evaluate(cfg => {
    hunterApp.store.update((d: any) => {
      const h = d.hunters[0];
      h.rank = cfg.rank;
      h.stats = { ...cfg.stats };
      h.pending = {};
      h.spent = Object.values(cfg.stats as Record<string, number>).reduce((n, v) => n + Math.max(0, v - 10), 0);
      h.bonusPoints = cfg.bonusPoints ?? 0;
      if (cfg.job !== undefined) h.job = cfg.job;
      if (cfg.jobDone !== undefined) h.jobDone = cfg.jobDone;
      d.rulesOverrides = {
        ...(d.rulesOverrides || {}),
        fight: { ...((d.rulesOverrides && d.rulesOverrides.fight) || {}), keystone: { on: cfg.on ?? true, ...(cfg.keystoneOverrides || {}) } },
      };
    }, 'test-setup');
  }, o);
}

test('a player who puts a third of their points in Strength reads Follow Through on their sheet', async ({ device }) => {
  const page = (await device('player')).page;
  await onboardPlayer(page, 'Jin Test');
  await dismissAll(page);
  await setupKeystoneHunter(page, {
    rank: 'D',
    stats: built({ str: 10, agi: 10, vit: 10 }),
  });
  await go(page, 'status');

  const strCell = page.locator('#view-status .stat[data-k="str"]');
  await expect(strCell.locator('[data-share]')).toHaveText(keystoneShareText(1 / 3));
  await expect(strCell.locator('[data-share]')).toHaveAttribute('aria-label', keystoneShareAria(1 / 3));

  const ksPanel = page.locator('#view-status [data-panel="keystones"]');
  await expect(ksPanel).toBeVisible();
  const ft = keystoneOf({ tier: 'mark', stat: 'str' }, KS_ON);
  await expect(ksPanel.locator('[data-ks-held]')).toContainText(ft.name);
  await expect(ksPanel.locator('[data-ks-held]')).toContainText(keystoneTierLabel({ tier: 'mark', stat: 'str' }));
  await expect(ksPanel.locator('[data-ks-held]')).toContainText(ft.line);
});

test('the Confirm bar says which keystone a point earns', async ({ device }) => {
  const page = (await device('player')).page;
  await onboardPlayer(page, 'Jin Test');
  await dismissAll(page);
  await setupKeystoneHunter(page, {
    rank: 'D',
    stats: built({ str: 29, agi: 25, vit: 25, ins: 21 }),
    bonusPoints: 105,
  });
  await go(page, 'status');

  const confirmKs = page.locator('#view-status [data-confirm-ks]');
  await expect(confirmKs).toBeHidden();

  await page.locator('#view-status .stat[data-k="str"] button[data-dir="1"]').tap();
  await page.locator('#view-status .stat[data-k="str"] button[data-dir="1"]').tap();

  const expectedDiff = keystoneDiff(
    { stats: built({ str: 29, agi: 25, vit: 25, ins: 21 }), rank: 'D', pair: null, awakened: false },
    { stats: built({ str: 31, agi: 25, vit: 25, ins: 21 }), rank: 'D', pair: null, awakened: false },
    KS_ON.fight,
  );
  await expect(confirmKs).toBeVisible();
  await expect(confirmKs).toHaveText(keystoneConfirmLine(expectedDiff, KS_ON));
  await shot(page, 'allocation-confirm', '#view-status [data-panel="attributes"]');

  await page.locator('#view-status [data-confirm]').tap();
  await expect(confirmKs).toBeHidden();
  await expect(page.locator('#view-status [data-panel="keystones"] [data-ks-held]')).toContainText(keystoneOf({ tier: 'mark', stat: 'str' }, KS_ON).name);
});

test('the Confirm bar warns when pending points in another stat lose a held keystone', async ({ device }) => {
  const page = (await device('player')).page;
  await onboardPlayer(page, 'Jin Test');
  await dismissAll(page);
  await setupKeystoneHunter(page, {
    rank: 'D',
    stats: built({ str: 30, agi: 70 }),
    bonusPoints: 105,
  });
  await go(page, 'status');

  await page.locator('#view-status .stat[data-k="agi"] button[data-dir="1"]').tap();
  const expectedDiff = keystoneDiff(
    { stats: built({ str: 30, agi: 70 }), rank: 'D', pair: null, awakened: false },
    { stats: built({ str: 30, agi: 71 }), rank: 'D', pair: null, awakened: false },
    KS_ON.fight,
  );
  await expect(page.locator('#view-status [data-confirm-ks]')).toHaveText(keystoneConfirmLine(expectedDiff, KS_ON));
});

test('with keystones off, a player sees no keystone words anywhere', async ({ device }) => {
  const page = (await device('player')).page;
  await onboardPlayer(page, 'Kai Test');
  await dismissAll(page);
  await go(page, 'status');

  await expect(page.locator('#view-status [data-panel="keystones"]')).toHaveCount(0);
  await expect(page.locator('#view-status .jump-chips button', { hasText: KEYSTONE_WORDS.panelTitle })).toHaveCount(0);
  await expect(page.locator('#view-status [data-share]:visible')).toHaveCount(0);
  await expect(page.locator('#view-status [data-confirm-ks]')).toBeHidden();
  await expect(page.locator('#view-status [data-kstoggle]')).toHaveCount(0);
  await expect(page.locator('#view-status [data-ksgm-hint]')).toBeHidden();

  await page.locator('#more-btn').tap();
  await expect(page.locator('.sys-overlay.show .sys-actions button', { hasText: KEYSTONE_WORDS.codexTitle })).toHaveCount(0);
  await page.locator('.sys-overlay.show .sys-actions button', { hasText: 'Close' }).tap();

  await go(page, 'rules');
  await expect(page.locator('#view-rules')).not.toContainText(KEYSTONE_WORDS.panelTitle);
  await expect(page.locator('#view-rules [data-rr-ks]')).toHaveCount(0);
});

test('a GM turns keystones on for a room, and a player sees shares, sheet reach, Rules lines, and all 44 in the codex', async ({ device }) => {
  const gm = (await device('gm')).page;
  const player = (await device('player')).page;

  await onboardGM(gm);
  const code = await createRoom(gm);
  await onboardPlayer(player, 'Mira Test', code);
  await expect.poll(() => player.evaluate(() => hunterApp.api.sync.room())).toBe(code);
  await dismissAll(player, 4);

  await test.step('GM toggles Keystones on in the Build panel and pushes room rules', async () => {
    await go(gm, 'status');
    const sw = gm.locator('#view-status [data-kstoggle]');
    await sw.scrollIntoViewIfNeeded();
    await expect(sw).toHaveAttribute('aria-pressed', 'false');
    await expect(sw).toHaveText(`${KEYSTONE_SWITCH_WORDS.label}: ${KEYSTONE_SWITCH_WORDS.off}`);
    await sw.tap();
    await expect(sw).toHaveAttribute('aria-pressed', 'true');
    await expect(sw).toHaveText(`${KEYSTONE_SWITCH_WORDS.label}: ${KEYSTONE_SWITCH_WORDS.on}`);
    await expect(gm.locator('#view-status [data-ksgm-hint]')).toHaveText(KEYSTONE_SWITCH_WORDS.hint);
    await shot(gm, 'gm-build-switch', '#view-status [data-panel="build"]');
  });

  await test.step('Player phone follows the room switch and shows sheet earned + confluence reach', async () => {
    await player.evaluate(() => {
      hunterApp.store.update((d: any) => {
        const h = d.hunters[0];
        h.rank = 'D';
        h.stats = { str: 50, agi: 35, vit: 10, ins: 10, dis: 45, pre: 10, pow: 10, ctl: 10 };
        h.spent = 100;
        h.pending = {};
      }, 'test-setup');
    });
    await go(player, 'status');
    await expect.poll(() => player.evaluate(() => hunterApp.rules().fight.keystone.on)).toBe(true);

    const ksPanel = player.locator('#view-status [data-panel="keystones"]');
    await expect(ksPanel).toBeVisible();
    await expect(player.locator('#view-status .jump-chips button', { hasText: KEYSTONE_WORDS.panelTitle })).toHaveCount(1);

    const expectedReach = keystoneReach({ stats: built({ str: 40, agi: 25, dis: 35 }), rank: 'D', pair: null, awakened: false }, KS_ON.fight);
    const expectedNext = keystoneNextLine(nearestKeystone(expectedReach, KS_ON.fight), KS_ON, expectedReach.totalSpent);
    await expect(ksPanel.locator('[data-ks-next]')).toHaveText(expectedNext);
    await shot(player, 'sheet-keystones', '#view-status [data-panel="keystones"]');
  });

  await test.step('Rules page displays live keystone thresholds from rules and links to the codex', async () => {
    await go(player, 'rules');
    const curves = player.locator('#rr-curves');
    for (const line of keystoneLines(KS_ON)) await expect(curves).toContainText(line);
    await shot(player, 'rules-keystones', '#rr-curves', 'start');
    await curves.locator('[data-rr-ks]').tap();
    await expect(player.locator('#view-keystones')).toBeVisible();
  });

  await test.step('Keystones codex lists all 44 and filters by tier, stat value, and search', async () => {
    const view = player.locator('#view-keystones');
    await expect(view.locator('[data-ks-card]')).toHaveCount(44);
    await expect(view.locator('[data-ks-count]')).toHaveText(keystoneCountLine(44, 44));
    await shot(player, 'codex-keystones');

    await view.locator('[data-ks-tier] button[data-tier="confluence"]').tap();
    await expect(view.locator('[data-ks-card]:visible')).toHaveCount(28);
    await expect(view.locator('[data-ks-count]')).toHaveText(keystoneCountLine(28, 44));

    await view.locator('[data-ks-stat]').selectOption('str');
    await expect(view.locator('[data-ks-card]:visible')).toHaveCount(7);

    await view.locator('[data-ks-tier] button[data-tier=""]').tap();
    await view.locator('[data-ks-stat]').selectOption('');
    await view.locator('[data-ks-q]').fill(keystoneOf({ tier: 'apex', stat: 'str' }, KS_ON).name);
    await expect(view.locator('[data-ks-card]:visible')).toHaveCount(1);
    await expect(view.locator('[data-ks-card]:visible')).toContainText(keystoneOf({ tier: 'apex', stat: 'str' }, KS_ON).line);
  });

  await test.step('GM share override travels through RoomRules to the player sheet and Rules page', async () => {
    await gm.evaluate(() => {
      hunterApp.store.update((d: any) => {
        d.rulesOverrides = { ...(d.rulesOverrides || {}), fight: { ...((d.rulesOverrides && d.rulesOverrides.fight) || {}), keystone: { on: true, markShare: 0.4 } } };
      }, 'test-setup');
    });
    await expect.poll(() => player.evaluate(() => hunterApp.rules().fight.keystone.markShare)).toBe(0.4);
    await go(player, 'rules');
    const customRules: Rules = { ...KS_ON, fight: { ...KS_ON.fight, keystone: { ...KS_ON.fight.keystone, markShare: 0.4 } } };
    for (const line of keystoneLines(customRules)) await expect(player.locator('#rr-curves')).toContainText(line);
  });

  await test.step('No horizontal overflow at 390 px across changed views', async () => {
    for (const id of ['status', 'rules', 'keystones'] as const) {
      await go(player, id);
      const overflow = await player.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `${id} horizontal overflow`).toBeLessThanOrEqual(0);
    }
  });
});
