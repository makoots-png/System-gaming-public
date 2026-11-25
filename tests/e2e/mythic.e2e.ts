// A mythic's warning on both phones (src/views/mythic-html.js, combat.js, table.js, map.js): the strip with the phase and
// its clock, the omen banner with each way to answer it, the GM's Land and Drop, the marked tiles, and the bestiary entry.
// The words come from the script's own data (src/core/registry/mythics.ts), so a moved omen or number moves them here.
import { mkdir } from 'node:fs/promises';
import type { Page } from '@playwright/test';
import { MYTHICS } from '../../src/core/registry/mythics.ts';
import { test, expect, onboardGM, onboardPlayer, createRoom, dismissAll, go, chooseList, openApp, setupDoc, fightRow, type DeviceOptions } from './helpers.ts';

const HUNTER = 'Kai Test', ANGEL = 'angel-of-the-last-trumpet' as const, script = MYTHICS[ANGEL];
const combat = (page: Page) => page.locator('#view-combat');
const SHOTS = process.env.MY7_SHOTS ?? '';
const shot = async (page: Page, name: string) => { if (SHOTS) { await mkdir(SHOTS, { recursive: true }); await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true }); } };

/** A GM and a player in one room; mythic scripts are on by default, and the Angel and the player's hunter fight, the turn the Angel's. */
async function angelFight(device: (label: string, o?: DeviceOptions) => Promise<{ page: Page }>, standing: Record<string, unknown> | null, at = { x: 6, y: 2 }): Promise<{ gm: Page; player: Page }> {
  const gm = (await device('gm')).page, player = (await device('player')).page;
  await onboardGM(gm);
  await chooseList(gm);
  const code = await createRoom(gm);
  await onboardPlayer(player, HUNTER, code);
  await chooseList(player);
  await expect.poll(() => player.evaluate(() => hunterApp.api.sync.room())).toBe(code);
  await dismissAll(player, 4);
  await go(gm, 'gm');
  await expect(gm.locator('#gm-board .gm-card.remote', { hasText: HUNTER })).toHaveCount(1);
  await go(gm, 'combat');
  const sw = combat(gm).locator('[data-mythsw-btn]');
  await expect(sw).toHaveAttribute('aria-pressed', 'true');
  await combat(gm).locator('[data-hsel]').selectOption({ label: `${HUNTER} (player phone)` });
  await combat(gm).locator('[data-addh]').tap();
  const label = await combat(gm).locator('[data-msel] option', { hasText: script.name }).first().textContent();
  await combat(gm).locator('[data-msel]').selectOption({ label: label ?? '' });
  await combat(gm).locator('[data-addm]').tap();
  await combat(gm).locator('[data-start]').tap();
  await expect(combat(gm).locator('.cmb-row.cur')).toHaveCount(1);
  await gm.evaluate(([name, boss, at2, omen]) => hunterApp.store.update((d: any) => {
    const f = d.fight, kai = f.rows.find((r: any) => r.name === name), angel = f.rows.find((r: any) => r.name === boss);
    kai.place = { x: 2, y: 2 }; angel.place = at2;
    kai.at = f.now + 1; kai.tie = 0; angel.at = f.now; angel.tie = 0;
    f.currentId = angel.id; f.log = [];
    if (omen) angel.mythic = { ...angel.mythic, ...omen, aim: omen.aim === 'kai' ? kai.id : omen.aim === 'boss' ? angel.id : omen.aim };
  }, 'test-setup'), [HUNTER, script.name, at, standing] as const);
  await setupDoc(player, HUNTER, { x: 2, y: 2 });
  await go(player, 'combat');
  return { gm, player };
}
const omen = (key: string, aim: unknown, at: 'omen' | 'faltering' = 'omen') => ({ at, omen: key, aim, hpAt: 1, barAt: null, beat: 1 });

test('a GM sees the Angel\'s omen and lands it with one tap', async ({ device }) => {
  const { gm, player } = await angelFight(device, omen('weighed', 'kai'));
  const w = script.omens['weighed' as keyof typeof script.omens]!;
  await expect(combat(gm).locator('.myth-title')).toHaveText(`OMEN: ${w.name}`);
  await expect(combat(gm).locator('.myth-when')).toHaveText(`Lands on its next turn, on ${HUNTER}.`);
  await expect(combat(gm).locator('.myth-name')).toHaveText(script.name);
  await expect(combat(gm).locator('.myth-turn')).toHaveText(`${script.name}'s turn. The omen lands.`);
  await shot(gm, 'gm-omen');
  await test.step('every phone reads the same omen, and the hunter it is aimed at is told', async () => {
    await expect(combat(player).locator('.myth-title')).toHaveText(`OMEN: ${w.name}`);
    await expect(combat(player).locator('.myth-you')).toHaveText(`${w.name} is aimed at you.`);
    await expect(combat(player).locator('[data-myland]')).toHaveCount(0);
    await shot(player, 'player-omen');
  });
  await test.step('one tap on Land lands it, and the banner goes on both phones', async () => {
    await combat(gm).locator('[data-myland]').tap();
    await expect(combat(gm).locator('.myth-omen')).toHaveCount(0);
    await expect(combat(player).locator('.myth-omen')).toHaveCount(0);
    expect((await fightRow(gm, script.name)).mythic.at).toBe('calm');
  });
});

test('a GM drops the omen with one tap on its turn and is never stuck', async ({ device }) => {
  const { gm, player } = await angelFight(device, omen('weighed', 'kai'));
  await combat(gm).locator('[data-mydrop]').tap();
  await expect(combat(gm).locator('.myth-omen')).toHaveCount(0);
  await expect(combat(player).locator('.myth-omen')).toHaveCount(0);
  expect((await fightRow(gm, script.name)).mythic.at).toBe('calm');
  await expect(combat(gm).locator('[data-log] li').first()).toContainText('The GM drops');
});

test('a player whose hunter stands in Stars Fall\'s tiles reads that they are in the marked tiles', async ({ device }) => {
  const { gm, player } = await angelFight(device, omen('stars', { x: 3, y: 2 }));
  const stars = script.omens['stars' as keyof typeof script.omens]!;
  await expect(combat(player).locator('.myth-title')).toHaveText(`OMEN: ${stars.name}`);
  await expect(combat(player).locator('.myth-when')).toHaveText('Lands on its next turn, on the marked tiles.');
  await expect(combat(player).locator('.myth-omen')).toContainText('Cannot be dodged or resisted.');
  await expect(combat(player).locator('.myth-you')).toHaveText('You are in the marked tiles.');
  await expect(combat(gm).locator('.myth-you')).toHaveCount(0);
  await shot(player, 'player-stars');
});

test('a stun on the mythic weakens the First Breath on every phone', async ({ device }) => {
  const { gm, player } = await angelFight(device, omen('breath', 'boss'));
  const b = script.omens['breath' as keyof typeof script.omens]!;
  await expect(combat(player).locator('.myth-title')).toHaveText(`OMEN: ${b.name}`);
  await gm.evaluate(() => { const angel = hunterApp.store.get().fight.rows.find((r: any) => r.kind === 'monster'); return hunterApp.api.combat.status(angel.id, { add: { key: 'stunned', def: hunterApp.rules().conditions.stunned, rounds: 1, tier: 0 } }); });
  await expect(combat(gm).locator('.myth-title')).toHaveText(`OMEN, WEAKENED: ${b.name}`);
  await expect(combat(player).locator('.myth-title')).toHaveText(`OMEN, WEAKENED: ${b.name}`);
  const toast = gm.locator('#toasts .toast', { hasText: `${b.name} will land as ` });
  await expect(toast).toHaveCount(1);
  await expect(toast).not.toContainText(/^R\d+:/);
});

test('the GM\'s Next phase moves the strip to phase 2 after a question', async ({ device }) => {
  const { gm, player } = await angelFight(device, null);
  await expect(combat(gm).locator('.myth-phase')).toHaveText(`Phase 1 of ${script.phases.length}: ${script.phases[0]!.name}`);
  await combat(gm).locator('[data-mynext]').tap();
  const ask = gm.locator('.sys-overlay.show');
  await expect(ask).toContainText(`Move ${script.name} to ${script.phases[1]!.name} now?`);
  await ask.locator('.sys-actions button', { hasText: 'Start next phase' }).tap();
  await expect(combat(gm).locator('.myth-phase')).toHaveText(`Phase 2 of ${script.phases.length}: ${script.phases[1]!.name}`);
  await expect(combat(player).locator('.myth-phase')).toHaveText(`Phase 2 of ${script.phases.length}: ${script.phases[1]!.name}`);
  await shot(gm, 'gm-strip');
});

test('a GM picks the Angel\'s entry in the bestiary and reads its phases', async ({ device }) => {
  const page = (await device('gm')).page;
  await onboardGM(page);
  await go(page, 'bestiary');
  const card = page.locator('#view-bestiary .bst-card', { hasText: script.name });
  await card.scrollIntoViewIfNeeded();
  await expect(card).toContainText(`The fight: ${script.shape}`);
  await expect(card).toContainText(`Phase 1: ${script.phases[0]!.name}.`);
  await shot(page, 'bestiary');
});

test('the GM\'s switch turns mythic phases off for a table', async ({ device }) => {
  const gm = (await device('gm')).page;
  await onboardGM(gm);
  await chooseList(gm);
  await go(gm, 'combat');
  const sw = combat(gm).locator('[data-mythsw-btn]');
  await expect(sw).toHaveAttribute('aria-pressed', 'true');
  await sw.tap();
  await expect(sw).toHaveAttribute('aria-pressed', 'false');
  await combat(gm).locator('[data-addh]').tap();
  const label = await combat(gm).locator('[data-msel] option', { hasText: script.name }).first().textContent();
  await combat(gm).locator('[data-msel]').selectOption({ label: label ?? '' });
  await combat(gm).locator('[data-addm]').tap();
  await combat(gm).locator('[data-start]').tap();
  await expect(combat(gm).locator('.cmb-row.cur')).toHaveCount(1);
  expect((await fightRow(gm, script.name)).mythic).toBeNull();
  await expect(combat(gm).locator('.myth-phase')).toHaveCount(0);
  await go(gm, 'bestiary');
  const card = gm.locator('#view-bestiary .bst-card', { hasText: script.name });
  await card.scrollIntoViewIfNeeded();
  await expect(card).not.toContainText(`The fight: ${script.shape}`);
});
