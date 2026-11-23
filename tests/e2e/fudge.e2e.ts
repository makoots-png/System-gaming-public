// The GM's fudge on a fight (src/views/combat.js, src/core/combat/fight-view.ts, docs/agent-handoff/features/notes-8-fudge.md
// sections 2 and 3): the Fudge block in Fight tools, a card's own stepper and Next roll. A GM phone and a player phone.
import type { Page } from '@playwright/test';
import { test, expect, onboardGM, onboardPlayer, createRoom, dismissAll, go, answerWindow, setupDoc } from './helpers.ts';

const HUNTER = 'Kai Test', MONSTER = 'Cave Rat';
const combat = (page: Page) => page.locator('#view-combat');
const tools = (page: Page) => combat(page).locator('[data-tools]');

/** A GM and a player in one room, both with the fight open on the map; the turn is the hunter's, or the rat's with `ratsTurn`. */
async function fightOn(device: (label: string) => Promise<{ page: Page }>, ratsTurn = false): Promise<{ gm: Page; player: Page; kai: string; rat: string }> {
  const gm = (await device('gm')).page, player = (await device('player')).page;
  await onboardGM(gm);
  const code = await createRoom(gm);
  await onboardPlayer(player, HUNTER, code);
  await expect.poll(() => player.evaluate(() => hunterApp.api.sync.room())).toBe(code);
  await dismissAll(player, 4);
  await go(gm, 'gm');
  await expect(gm.locator('#gm-board .gm-card.remote', { hasText: HUNTER })).toHaveCount(1);
  await go(gm, 'combat');
  await combat(gm).locator('[data-hsel]').selectOption({ label: `${HUNTER} (player phone)` });
  await combat(gm).locator('[data-addh]').tap();
  await combat(gm).locator('[data-qline]').fill(`${MONSTER}, E, brute`);
  await combat(gm).locator('[data-qadd]').tap();
  await combat(gm).locator('[data-start]').tap();
  await expect(combat(gm).locator('[data-tools-open]')).toBeVisible();
  const ids = await gm.evaluate(rats => {
    let out = { kai: '', rat: '' };
    hunterApp.store.update((d: any) => {
      const f = d.fight, kai = f.rows.find((r: any) => r.kind === 'hunter'), rat = f.rows.find((r: any) => r.kind === 'monster');
      kai.place = { x: 2, y: 2 }; rat.place = { x: 2, y: 3 };
      kai.at = f.now; kai.tie = 0; rat.at = f.now; rat.tie = 1; f.currentId = rats ? rat.id : kai.id; f.log = [];
      out = { kai: kai.id, rat: rat.id };
    }, 'test-setup');
    return out;
  }, ratsTurn);
  await setupDoc(player, HUNTER, { x: 2, y: 2 });
  await go(player, 'combat');
  await expect(combat(gm).locator(`[data-tok="${ids.kai}"]`)).toBeVisible();
  await combat(gm).locator('[data-mapbox] [data-frame]').dblclick({ position: { x: 4, y: 4 } });
  await expect.poll(() => player.evaluate(() => hunterApp.api.sync.doc('fight') !== null)).toBe(true);
  return { gm, player, ...ids };
}

/** Every request body each page sends, to look for what must not be in one. */
function bodies(...pages: Page[]): string[] {
  const seen: string[] = [];
  for (const p of pages) p.on('request', r => { const b = r.postData(); if (b) seen.push(b); });
  return seen;
}

test('the GM fudges the hunters +2 in three taps and the player\'s phone shows and hears nothing of it', async ({ device }) => {
  const { gm, player, kai } = await fightOn(device);
  const sent = bodies(gm, player);
  const docBefore = await player.evaluate(() => JSON.stringify(hunterApp.api.sync.doc('fight')));
  await expect(combat(gm).locator('[data-tools-open] .cmb-fdot')).toHaveCount(0);

  await test.step('Fight tools, +, + sets the hunters to +2 and lights the dot', async () => {
    await combat(gm).locator('[data-tools-open]').tap();
    const block = tools(gm).locator('[data-fudge]');
    await expect(block).toBeVisible();
    await block.locator('[data-fudge-side="party"]', { hasText: '+' }).tap();
    await block.locator('[data-fudge-side="party"]', { hasText: '+' }).tap();
    await expect(block.locator('.cmb-step', { hasText: "All hunters' rolls" }).locator('b')).toHaveText('+2');
    await expect(block.locator('.cmb-step', { hasText: "All foes' rolls" }).locator('b')).toHaveText('0');
    await expect(block.locator('.cmb-fdot')).toHaveCount(1);
    await expect(combat(gm).locator('[data-tools-open] .cmb-fdot')).toHaveCount(1);
    await expect(combat(gm).locator('[data-tools-open]')).toHaveAttribute('aria-label', 'Fight tools, fudge on');
  });

  await test.step('the hunter\'s card says Fudge +2', async () => {
    await combat(gm).locator('[data-toolsx]').tap();
    await combat(gm).locator(`[data-tok="${kai}"]`).tap();
    await expect(combat(gm).locator('.cmb-card', { hasText: HUNTER }).locator('[data-fudgeline]')).toContainText('Fudge +2');
  });

  await test.step('the player\'s phone holds the same fight doc, shows no fudge and sent or received no body naming it', async () => {
    await player.waitForTimeout(1500);
    expect(await player.evaluate(() => JSON.stringify(hunterApp.api.sync.doc('fight')))).toBe(docBefore);
    expect(await player.evaluate(() => document.body.innerText.split('\n').filter(l => /fudge/i.test(l)))).toEqual([]);
    await expect(player.locator('.cmb-fdot')).toHaveCount(0);
    expect(sent.filter(b => /fudge/i.test(b))).toEqual([]);
  });
});

test('the GM forces a foe\'s next roll to 20 and the card says so until that roll', async ({ device }) => {
  const { gm, rat } = await fightOn(device, true);
  await test.step('the rat\'s card: Next roll 20 is pressed and the card says so', async () => {
    await combat(gm).locator(`[data-tok="${rat}"]`).tap();
    const card = combat(gm).locator('.cmb-card', { hasText: MONSTER });
    await card.locator('[data-fudge-force][data-face="20"]').tap();
    await expect(card.locator('[data-fudge-force][data-face="20"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(card.locator('[data-fudgeline]')).toContainText('Next d20 forced: 20');
    await expect(combat(gm).locator('[data-tools-open] .cmb-fdot')).toHaveCount(1);
  });
  await test.step('the rat attacks, and its forced roll is spent: the card no longer says it', async () => {
    const card = combat(gm).locator('.cmb-card', { hasText: MONSTER });
    await card.locator('[data-ab]').first().tap();
    await answerWindow(gm, /on…|at…/, HUNTER);
    await expect(card.locator('[data-fudgeline]')).toHaveCount(0);
    await expect(card.locator('[data-fudge-force][data-face=""]')).toHaveAttribute('aria-pressed', 'true');
    await expect(combat(gm).locator('[data-tools-open] .cmb-fdot')).toHaveCount(0);
  });
});
