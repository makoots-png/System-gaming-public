// Two-tab room browser test: hidden GM Adjust roll (Force natural 20 / 1 and large uncapped +N) on shadow extraction,
// blood extraction (Hemomancer Crimson Vessels), and Arise.
// Verifies the player's tab shows zero trace in its dice log, fight log, session log, toasts, corpse card, room wire, or rules page.
import type { Page } from '@playwright/test';
import { test, expect, setupGoblinDenGM, onboardPlayer, createRoom, dismissAll, go, chooseList, fightRow } from './helpers.ts';
import { RULES } from '../../src/core/rules.ts';
import { abilityId } from '../../src/core/combat/ability-types.ts';
import { CLASS_UI_WORDS } from '../../src/core/hunter/class-view.ts';
import { tiles } from '../../src/core/combat/space.ts';
import { cost, tick } from '../../src/core/combat/timeline.ts';

const HUNTER = 'Mira Test';
const combat = (page: Page) => page.locator('#view-combat');
const card = (page: Page) => combat(page).locator('.cmb-card');

const ARISE_ABILITY = {
  id: abilityId('arise'),
  name: 'Arise',
  kind: 'support' as const,
  cost: { fatigue: 6, mana: 15, time: cost(RULES.fight.cost.standard), cooldown: tick(RULES.fight.round) },
  aim: 'corpse' as const,
  range: tiles(6),
  shape: { kind: 'touch' as const, reach: tiles(6) },
  delivery: { kind: 'sure' as const },
  foesOnly: false,
  effect: null,
  ops: [],
  channel: null,
  raise: { bonus: 2, maxRisen: 2, elitePerFight: 1 },
};

/** Fixes `crypto.getRandomValues` so `faceOf(20, cryptoRandom)` always draws `d20` (1..20). */
async function fixCryptoD20(page: Page, d20: number): Promise<void> {
  const raw = Math.floor(((d20 - 0.5) / 20) * 0x100000000) >>> 0;
  await page.evaluate(v => {
    Object.defineProperty(crypto, 'getRandomValues', { configurable: true, value: (a: Uint32Array) => a.fill(v) });
  }, raw);
}

test('GM forces natural 20 on shadow extraction and adjusts Arise by +40; player tab shows no trace in dice log, fight log, corpse card, wire, or rules page', async ({ device }) => {
  const gm = (await device('gm')).page;
  const player = (await device('player')).page;

  const playerPayloads: string[] = [];
  player.on('response', async res => {
    if (res.request().method() !== 'GET' || !/^\/api\/rooms\/[^/]+/.test(new URL(res.url()).pathname)) return;
    const text = await res.text().catch(() => '');
    if (text) playerPayloads.push(text);
  });

  await setupGoblinDenGM(gm);
  await chooseList(gm);
  const code = await createRoom(gm);

  await onboardPlayer(player, HUNTER, code);
  await chooseList(player);
  await expect.poll(() => player.evaluate(() => hunterApp.api.sync.room())).toBe(code);
  await dismissAll(player, 4);

  // Wait for player's remote sheet to arrive on GM, then back Necromancer in GM's classHolders and grant it + Arise to player
  let sheetKey = '';
  await expect.poll(async () => {
    sheetKey = await gm.evaluate(name => {
      const hit = (hunterApp.api.sync.remoteSheets() as any[]).find(r => r.data.name === name);
      return hit ? hit.key : '';
    }, HUNTER);
    return sheetKey;
  }, { timeout: 15_000 }).not.toBe('');

  const regId = await gm.evaluate(([sk, name]) => {
    let rid = '';
    hunterApp.store.update((d: any) => {
      rid = d.classHolders.registryId;
      d.classHolders.held.Necromancer = {
        kind: 'remote', sheetKey: sk, name, grantId: 'g-necro', claimedAt: new Date().toISOString(),
      };
      d.monsters.push({
        id: 'm902', name: 'Igris the Bloodred', rank: 'C', type: '', archetype: 'brute', kind: 'boss',
        tweak: {}, abilities: [], notes: [], xp: 200, extractable: true, desc: '', statuses: [], loot: { gold: 0, items: [] },
      });
    }, 'test-setup');
    return rid;
  }, [sheetKey, HUNTER] as const);

  await player.evaluate(([arise, rid]) => {
    const s = hunterApp.store;
    s.update(() => {
      const h = s.active();
      h.classes = { Necromancer: { unlockedAt: new Date().toISOString(), nodes: [], registryId: rid, grantId: 'g-necro' } };
      h.job = 'Necromancer';
      h.jobDone = 'Necromancer';
      h.skills = [
        ...(h.skills || []),
        { id: 'sk-arise', name: 'Arise', kind: 'active', desc: 'Raise a fallen monster.', ability: arise },
      ];
    }, 'test-setup');
  }, [ARISE_ABILITY, regId] as const);

  await expect.poll(() => gm.evaluate(name => (hunterApp.api.sync.remoteSheets() as any[])
    .some(r => r.data.name === name && r.data.job === 'Necromancer'), HUNTER), { timeout: 15_000 }).toBe(true);

  // Build running fight: remote Mira Test, Igris the Bloodred (corpse), High Orc (corpse), and standing Goblin Scout
  await go(gm, 'bestiary');
  await gm.locator('#view-bestiary [data-addc="m902"]').tap();
  await go(gm, 'combat');
  await combat(gm).locator('[data-hsel]').selectOption({ label: `${HUNTER} (player phone)` });
  await combat(gm).locator('[data-addh]').tap();
  await combat(gm).locator('[data-qline]').fill('High Orc, C, brute');
  await combat(gm).locator('[data-qadd]').tap();
  await combat(gm).locator('[data-qline]').fill('Goblin Scout, E, brute');
  await combat(gm).locator('[data-qadd]').tap();
  await combat(gm).locator('[data-start]').tap();
  await expect(combat(gm).locator('.cmb-row.cur')).toHaveCount(1);

  // Position combatants, kill Igris and High Orc, give remote Mira Arise + turn + mana
  await gm.evaluate(arise => hunterApp.store.update((d: any) => {
    const f = d.fight;
    const mira = f.rows.find((r: any) => r.name === 'Mira Test');
    const igris = f.rows.find((r: any) => r.name === 'Igris the Bloodred');
    const orc = f.rows.find((r: any) => r.name === 'High Orc');
    const scout = f.rows.find((r: any) => r.name === 'Goblin Scout');
    mira.abilities = [...mira.abilities.filter((a: any) => a.id !== arise.id), arise];
    mira.mana = 100;
    mira.sheet = { ...mira.sheet, manaMax: 100 };
    mira.place = { x: 2, y: 2 };
    mira.at = f.now;
    mira.tie = 0;
    igris.place = { x: 4, y: 2 };
    igris.life = { at: 'dead' };
    orc.place = { x: 4, y: 3 };
    orc.life = { at: 'dead' };
    scout.place = { x: 10, y: 10 };
    scout.at = f.now + 500;
    f.currentId = mira.id;
  }, 'test-setup'), ARISE_ABILITY);

  await go(player, 'combat');
  await expect(combat(player).locator('.tb-mine')).toContainText('YOUR TURN', { timeout: 15_000 });

  await test.step('GM forces natural 20 on shadow extraction for remote player; shadow arrives with no trace on player tab', async () => {
    await combat(gm).locator('.cmb-pick', { hasText: 'Igris the Bloodred' }).tap();
    await card(gm).getByRole('button', { name: 'Force natural 20' }).tap();
    await expect(card(gm).getByRole('button', { name: 'Force natural 20' })).toHaveAttribute('aria-pressed', 'true');

    await card(gm).locator('[data-extract]').tap();
    const dlg = gm.locator('.sys-overlay.show', { hasText: 'Shadow Extraction' });
    await expect(dlg).toBeVisible();
    await expect(dlg.locator('[data-adj-line]')).toHaveText('GM: Force natural 20');
    await gm.evaluate(() => { Math.random = () => 0.01; });
    await dlg.getByRole('button', { name: 'Extract shadow' }).tap();
    await expect(dlg).toHaveCount(0);

    // GM sees GM forced 20 in its own fight log; force clears on corpse
    const firstLog = combat(gm).locator('[data-log] li').first();
    await expect(firstLog).toContainText('GM forced');
    expect(await firstLog.textContent()).toContain('GM forced 20');
    expect((await fightRow(gm, 'Igris the Bloodred')).force).toBeUndefined();

    // Player receives the shadow on their phone
    await go(player, 'shadows');
    await expect(player.locator('#view-shadows .sh-card', { hasText: 'Igris the Bloodred' })).toBeVisible({ timeout: 15_000 });
    expect(await player.evaluate(() => document.body.innerText)).not.toMatch(/GM forced|Force natural|Adjust next roll/i);
  });

  await test.step('GM adjusts High Orc by +40 and remote player casts Arise; Risen High Orc spawns with zero trace on player tab', async () => {
    await combat(gm).locator('.cmb-pick', { hasText: 'High Orc' }).tap();
    const inp = card(gm).locator('[data-adjust-input]');
    await inp.fill('40');
    await inp.blur();
    await expect(inp).toHaveValue('40');

    // Fix GM crypto d20 to 2 (fails DC without +40, passes with +40)
    await fixCryptoD20(gm, 2);

    await go(player, 'combat');
    await expect(combat(player).locator('.tb-mine')).toContainText('YOUR TURN', { timeout: 15_000 });
    await combat(player).locator('[data-cast="arise"]').tap();
    const pickDlg = player.locator('.sys-overlay.show', { hasText: 'Use Arise on…' });
    await expect(pickDlg).toBeVisible();
    await expect(pickDlg).not.toContainText('GM');
    await expect(pickDlg).not.toContainText('40');
    await pickDlg.locator('.sys-actions button', { hasText: 'High Orc' }).tap();
    await expect(pickDlg).toHaveCount(0);

    // Wait for Risen High Orc on both GM and player tabs
    await expect(combat(gm).locator('.cmb-pick', { hasText: 'Risen High Orc' })).toHaveCount(1, { timeout: 15_000 });
    await expect(combat(player).locator('.tb-row', { hasText: 'Risen High Orc' })).toHaveCount(1, { timeout: 15_000 });
    await expect(combat(gm).locator('[data-log]')).toContainText('+ 40 GM =');
    expect((await fightRow(gm, 'High Orc')).adjust).toBeUndefined();
  });

  await test.step('player tab shows no trace in fight doc, corpse card, dice log, wire responses, or rules page', async () => {
    const playerDoc = await player.evaluate(() => hunterApp.api.sync.doc('fight'));
    expect(playerDoc).not.toBeNull();
    for (const row of playerDoc.rows) {
      expect('adjust' in row).toBe(false);
      expect('force' in row).toBe(false);
    }
    const docLogText = (playerDoc.log as string[]).join('\n');
    expect(docLogText).not.toMatch(/GM forced|\+ 40 GM|adjust|forced/i);
    expect(JSON.stringify(playerDoc)).not.toMatch(/GM forced|\+ 40 GM|Force natural|Adjust next roll/i);

    // Check player's Combat tab (corpse rows and map/list card)
    await go(player, 'combat');
    const combatText = await player.locator('#view-combat').innerText();
    expect(combatText).not.toMatch(/Adjust next roll|Force natural|GM forced|\+ 40 GM/i);
    await expect(player.locator('#view-combat [data-adjust-box]')).toHaveCount(0);

    // Check player's Dice log
    await go(player, 'dice');
    const diceText = await player.locator('#view-dice').innerText();
    expect(diceText).not.toMatch(/GM forced|GM \+40|\+ 40 GM|Force natural|Adjust next roll/i);

    // Check player's Rules page
    await go(player, 'rules');
    const rulesText = await player.locator('#rr-shadows').innerText();
    expect(rulesText).not.toMatch(/roll adjustment|adjust roll|force natural/i);

    // Check every room response received by the player tab
    const joinedWire = playerPayloads.join('\n');
    expect(joinedWire).not.toMatch(/GM forced|\+ 40 GM|Force natural|Adjust next roll/i);
  });
});

test('GM forces natural 20, adjusts by +45, and forces natural 1 on Hemomancer blood extraction; player phone shows no trace in vessels, toasts, logs, or wire', async ({ device }) => {
  const gm = (await device('gm-blood')).page;
  const player = (await device('player-blood')).page;

  const playerPayloads: string[] = [];
  player.on('response', async res => {
    if (res.request().method() !== 'GET' || !/^\/api\/rooms\/[^/]+/.test(new URL(res.url()).pathname)) return;
    const text = await res.text().catch(() => '');
    if (text) playerPayloads.push(text);
  });

  await setupGoblinDenGM(gm);
  await chooseList(gm);
  const code = await createRoom(gm);

  await onboardPlayer(player, HUNTER, code);
  await chooseList(player);
  await expect.poll(() => player.evaluate(() => hunterApp.api.sync.room())).toBe(code);
  await dismissAll(player, 4);

  // Record every toast text rendered on the player's phone during blood extraction
  await player.evaluate(() => {
    const win = window as any;
    win.__seenToasts = [] as string[];
    const box = document.getElementById('toasts');
    if (!box) return;
    const record = (el: Element) => {
      const t = (el.textContent || '').trim();
      if (t && !win.__seenToasts.includes(t)) win.__seenToasts.push(t);
    };
    for (const el of box.querySelectorAll('.toast')) record(el);
    new MutationObserver(records => {
      for (const rec of records) {
        for (const node of rec.addedNodes) {
          if (node instanceof Element) {
            if (node.matches('.toast')) record(node);
            for (const sub of node.querySelectorAll('.toast')) record(sub);
          }
        }
      }
    }).observe(box, { childList: true, subtree: true });
  });

  // Wait for player's remote sheet on GM, back Hemomancer in GM's classHolders, and add 3 extractable monsters
  let sheetKey = '';
  await expect.poll(async () => {
    sheetKey = await gm.evaluate(name => {
      const hit = (hunterApp.api.sync.remoteSheets() as any[]).find(r => r.data.name === name);
      return hit ? hit.key : '';
    }, HUNTER);
    return sheetKey;
  }, { timeout: 15_000 }).not.toBe('');

  const regId = await gm.evaluate(([sk, name]) => {
    let rid = '';
    hunterApp.store.update((d: any) => {
      rid = d.classHolders.registryId;
      d.classHolders.held.Hemomancer = {
        kind: 'remote', sheetKey: sk, name, grantId: 'g-hemo', claimedAt: new Date().toISOString(),
      };
      d.monsters.push(
        {
          id: 'm921', name: 'Bloodfang Monarch', rank: 'S', type: '', archetype: 'brute', kind: 'boss',
          tweak: {}, abilities: [], notes: [], xp: 500, extractable: true, desc: '', statuses: [], loot: { gold: 0, items: [] },
        },
        {
          id: 'm922', name: 'Crimson Dreadlord', rank: 'A', type: '', archetype: 'brute', kind: 'boss',
          tweak: {}, abilities: [], notes: [], xp: 400, extractable: true, desc: '', statuses: [], loot: { gold: 0, items: [] },
        },
        {
          id: 'm923', name: 'Iron Wolf', rank: 'E', type: '', archetype: 'brute', kind: 'normal',
          tweak: {}, abilities: [], notes: [], xp: 40, extractable: true, desc: '', statuses: [], loot: { gold: 0, items: [] },
        },
      );
    }, 'test-setup');
    return rid;
  }, [sheetKey, HUNTER] as const);

  await player.evaluate(rid => {
    const s = hunterApp.store;
    s.update(() => {
      const h = s.active();
      h.classes = { Hemomancer: { unlockedAt: new Date().toISOString(), nodes: [], registryId: rid, grantId: 'g-hemo' } };
      h.job = 'Hemomancer';
      h.jobDone = 'Hemomancer';
    }, 'test-setup');
  }, regId);

  await expect.poll(() => gm.evaluate(name => (hunterApp.api.sync.remoteSheets() as any[])
    .some(r => r.data.name === name && r.data.job === 'Hemomancer'), HUNTER), { timeout: 15_000 }).toBe(true);

  const playerVitBonus = await player.evaluate(() => hunterApp.api.hunter.sheet(hunterApp.store.active()).checks.bonus.vit as number);

  // Build and end a fight with remote Mira Test and all three monsters so post-fight blood extraction opens
  await go(gm, 'bestiary');
  await gm.locator('#view-bestiary [data-addc="m921"]').tap();
  await gm.locator('#view-bestiary [data-addc="m922"]').tap();
  await gm.locator('#view-bestiary [data-addc="m923"]').tap();
  await go(gm, 'combat');
  await combat(gm).locator('[data-hsel]').selectOption({ label: `${HUNTER} (player phone)` });
  await combat(gm).locator('[data-addh]').tap();
  await combat(gm).locator('[data-start]').tap();
  await expect(combat(gm).locator('.cmb-row.cur')).toHaveCount(1);

  for (const name of ['Bloodfang Monarch', 'Crimson Dreadlord', 'Iron Wolf']) {
    await combat(gm).locator('.cmb-pick', { hasText: name }).tap();
    await card(gm).locator('[data-defeat]').tap();
  }
  await expect.poll(() => gm.evaluate(() => hunterApp.store.get().fight?.phase)).toBe('ended');

  await test.step('GM forces natural 20 on S-rank boss blood extraction despite raw 1; player receives vessel with no trace', async () => {
    await combat(gm).locator('.cmb-pick', { hasText: 'Bloodfang Monarch' }).tap();
    await card(gm).getByRole('button', { name: 'Force natural 20' }).tap();
    await expect(card(gm).getByRole('button', { name: 'Force natural 20' })).toHaveAttribute('aria-pressed', 'true');

    await card(gm).locator('[data-extract-blood]').tap();
    const dlg = gm.locator('.sys-overlay.show', { hasText: 'Blood Extraction' });
    await expect(dlg).toBeVisible();
    await expect(dlg.locator('[data-adj-line]')).toHaveText('GM: Force natural 20');

    await gm.evaluate(() => { Math.random = () => 0.01; });
    await dlg.getByRole('button', { name: 'Extract blood' }).tap();
    await expect(dlg).toHaveCount(0);

    const logEntry = await gm.evaluate(() => hunterApp.store.get().fight?.log?.[0] ?? null);
    expect(logEntry?.text).toContain('GM forced 20');
    expect(logEntry?.table).toContain(`20 + ${playerVitBonus} = ${20 + playerVitBonus} vs DC 55`);
    expect(logEntry?.table).not.toMatch(/GM|forced/i);
    const rowAfter = await fightRow(gm, 'Bloodfang Monarch');
    expect(rowAfter.bled).toBe(true);
    expect(rowAfter.force).toBeUndefined();

    // GM dice log label/formula stays plain (no GM or forced tag; roller column still shows who rolled: GM)
    await go(gm, 'dice');
    const firstRollMeta = gm.locator('#view-dice [data-hist] li').first().locator('.lm');
    await expect(firstRollMeta).toContainText('Extract blood: Bloodfang Monarch');
    await expect(firstRollMeta).toContainText(`[20] = ${20 + playerVitBonus}`);
    await expect(firstRollMeta).not.toContainText('GM');
    await expect(firstRollMeta).not.toContainText('forced');

    // Player's Classes panel shows the Crimson Vessel
    await go(player, 'status');
    const vesselsBox = player.locator('#view-status [data-panel="classes"] [data-cls-vessels]');
    await expect(vesselsBox).toContainText(CLASS_UI_WORDS.vesselsHeading(1, 3), { timeout: 15_000 });
    await expect(vesselsBox).toContainText('Bloodfang Monarch');
  });

  await test.step('GM adjusts A-rank boss blood extraction by +45 despite raw 2; player receives vessel with no trace', async () => {
    await go(gm, 'combat');
    await combat(gm).locator('.cmb-pick', { hasText: 'Crimson Dreadlord' }).tap();
    const inp = card(gm).locator('[data-adjust-input]');
    await inp.fill('45');
    await inp.blur();
    await expect(inp).toHaveValue('45');

    await card(gm).locator('[data-extract-blood]').tap();
    const dlg = gm.locator('.sys-overlay.show', { hasText: 'Blood Extraction' });
    await expect(dlg).toBeVisible();
    await expect(dlg.locator('[data-adj-in]')).toHaveValue('45');
    await expect(dlg.locator('[data-adj-line]')).toHaveText('GM adjustment: +45');

    await gm.evaluate(() => { Math.random = () => (2 - 0.5) / 20; });
    await dlg.getByRole('button', { name: 'Extract blood' }).tap();
    await expect(dlg).toHaveCount(0);

    const logEntry = await gm.evaluate(() => hunterApp.store.get().fight?.log?.[0] ?? null);
    expect(logEntry?.text).toContain('+ 45 GM =');
    expect(logEntry?.table).toMatch(new RegExp(`^R\\d+: ${HUNTER} drains blood from Crimson Dreadlord for a Crimson Vessel\\.$`));
    expect(logEntry?.table).not.toMatch(/GM|45|forced/i);
    const rowAfter = await fightRow(gm, 'Crimson Dreadlord');
    expect(rowAfter.bled).toBe(true);
    expect(rowAfter.adjust).toBeUndefined();

    // GM dice log label/formula stays plain (natural 2 + playerVitBonus, no +45 or GM tag)
    await go(gm, 'dice');
    const firstRollMeta = gm.locator('#view-dice [data-hist] li').first().locator('.lm');
    await expect(firstRollMeta).toContainText('Extract blood: Crimson Dreadlord');
    await expect(firstRollMeta).toContainText(`[2] = ${2 + playerVitBonus}`);
    await expect(firstRollMeta).not.toContainText('GM');
    await expect(firstRollMeta).not.toContainText('45');

    // Player's Classes panel updates to 2 / 3 with Crimson Dreadlord
    const vesselsBox = player.locator('#view-status [data-panel="classes"] [data-cls-vessels]');
    await expect(vesselsBox).toContainText(CLASS_UI_WORDS.vesselsHeading(2, 3), { timeout: 15_000 });
    await expect(vesselsBox).toContainText('Crimson Dreadlord');
  });

  await test.step('GM forces natural 1 on E-rank monster blood extraction despite raw 20; fails silently on player phone', async () => {
    await go(gm, 'combat');
    await combat(gm).locator('.cmb-pick', { hasText: 'Iron Wolf' }).tap();
    await card(gm).getByRole('button', { name: 'Force natural 1' }).tap();
    await expect(card(gm).getByRole('button', { name: 'Force natural 1' })).toHaveAttribute('aria-pressed', 'true');

    await card(gm).locator('[data-extract-blood]').tap();
    const dlg = gm.locator('.sys-overlay.show', { hasText: 'Blood Extraction' });
    await expect(dlg).toBeVisible();
    await expect(dlg.locator('[data-adj-line]')).toHaveText('GM: Force natural 1');

    await gm.evaluate(() => { Math.random = () => 0.99; });
    await dlg.getByRole('button', { name: 'Extract blood' }).tap();
    const failWarn = gm.locator('.sys-overlay.show', { hasText: 'Blood extraction failed' });
    await expect(failWarn).toBeVisible();
    await expect(failWarn).toContainText('Natural 1. No blood was extracted from this corpse.');
    expect(await failWarn.textContent()).toContain('GM forced 1');
    await failWarn.locator('button').first().tap();
    await expect(failWarn).toHaveCount(0);

    const logEntry = await gm.evaluate(() => hunterApp.store.get().fight?.log?.[0] ?? null);
    expect(logEntry?.text).toContain('GM forced 1');
    expect(logEntry?.table).toContain(`1 + ${playerVitBonus} = ${1 + playerVitBonus} vs DC 10`);
    expect(logEntry?.table).not.toMatch(/GM|forced/i);
    const rowAfter = await fightRow(gm, 'Iron Wolf');
    expect(rowAfter.bled).toBe(true);
    expect(rowAfter.force).toBeUndefined();
  });

  await test.step('player phone carries no adjustment or force in vessel outcome toasts, session log, dice log, combat view, or room wire', async () => {
    // Wait briefly for a room poll cycle after the forced failure, then verify player state
    const vesselsBox = player.locator('#view-status [data-panel="classes"] [data-cls-vessels]');
    await expect(vesselsBox).toContainText(CLASS_UI_WORDS.vesselsHeading(2, 3));
    await expect(vesselsBox).not.toContainText('Iron Wolf');

    // Player's vessel outcome toasts carry plain vessel text with no GM adjustment or force
    const seenToasts: string[] = await player.evaluate(() => (window as any).__seenToasts || []);
    const joinedToasts = seenToasts.join('\n');
    expect(joinedToasts).toContain('Bloodfang Monarch (S-rank boss) fills a Crimson Vessel');
    expect(joinedToasts).toContain('Crimson Dreadlord (A-rank boss) fills a Crimson Vessel');
    expect(joinedToasts).not.toMatch(/GM forced|GM \+45|\+ 45 GM|Force natural|Adjust next roll/i);
    expect(seenToasts.filter(t => /Extraction|Crimson Vessel|blood/i.test(t) && /Iron Wolf/i.test(t))).toEqual([]);

    // Player's session log records both extractions plainly with zero GM or force details
    const playerLogLines: string[] = await player.evaluate(() =>
      (hunterApp.store.get().log || []).map((e: any) => `${e.title || ''}: ${e.text || ''}`),
    );
    const joinedLog = playerLogLines.join('\n');
    expect(joinedLog).toContain(`${HUNTER} extracted blood from Bloodfang Monarch (S-rank boss) into a Crimson Vessel.`);
    expect(joinedLog).toContain(`${HUNTER} extracted blood from Crimson Dreadlord (A-rank boss) into a Crimson Vessel.`);
    expect(joinedLog).not.toMatch(/GM forced|GM \+45|\+ 45 GM|Force natural|Adjust next roll|forced/i);

    // Player's Status/Classes, Combat, and Dice views have zero trace
    const statusText = await player.locator('#view-status').innerText();
    expect(statusText).not.toMatch(/GM forced|GM \+45|\+ 45 GM|Force natural|Adjust next roll/i);

    await go(player, 'combat');
    const combatText = await player.locator('#view-combat').innerText();
    expect(combatText).not.toMatch(/Adjust next roll|Force natural|GM forced|\+ 45 GM/i);
    await expect(player.locator('#view-combat [data-adjust-box]')).toHaveCount(0);

    await go(player, 'dice');
    const diceText = await player.locator('#view-dice').innerText();
    expect(diceText).not.toMatch(/Extract blood|GM forced|GM \+45|\+ 45 GM|Force natural|Adjust next roll/i);

    // Every room wire response received by the player tab is clean, and bloodExtract events carry only { eid, to, vessel }
    const joinedWire = playerPayloads.join('\n');
    expect(joinedWire).not.toMatch(/GM forced|GM \+45|\+ 45 GM|Force natural|Adjust next roll/i);
    const bloodEvents = playerPayloads.flatMap(raw => {
      try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed.events) ? parsed.events.filter((e: any) => e.type === 'bloodExtract') : [];
      } catch {
        return [];
      }
    });
    expect(bloodEvents.length).toBeGreaterThanOrEqual(2);
    for (const ev of bloodEvents) {
      expect(Object.keys(ev.payload).sort()).toEqual(['eid', 'to', 'vessel']);
      expect(Object.keys(ev.payload.vessel).sort()).toEqual(['at', 'kind', 'name', 'rank']);
    }
  });
});
