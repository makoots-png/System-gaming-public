// Feats in a room (feature 1's notes sections 2.3 and 3.2): the GM's own feats reach the players' phones in the room's
// feats doc, and what the GM's phone saw of a player's hunter (a gate's Clear it was paid in) reaches its phone as the
// room's `noted`, where the player's phone counts it and opens the feat's window once.
import { test, expect, onboardGM, onboardPlayer, createRoom, dismissAll, go, activeHunter, answerWindow } from './helpers.ts';

const FIRST_CLEAR = {
  name: 'First Clear', window: 'FIRST CLEAR', desc: 'A gate cleared.', show: { at: 'never' },
  rule: { on: 'gate', where: [], measure: { of: 'facts' }, within: 'ever', reach: 1, also: [] },
  rewards: { xp: 0, points: 1, gold: 0, items: [], title: null, job: null, skills: [], statuses: [], boons: [] },
};

test('the GM\'s own feat reaches a player\'s phone, and the gate the GM clears for that player earns it there once, after the reward\'s and the level\'s windows', async ({ device }) => {
  const gm = (await device('gm')).page, player = (await device('player')).page;

  await test.step('a GM with a feat of its own and a gate entered, and a player in the room', async () => {
    await onboardGM(gm);
    const code = await createRoom(gm);
    await gm.evaluate(f => hunterApp.store.update((d: any) => {
      d.library.feats = { 'first-clear': f };
      const g = d.gates.find((x: any) => x.name === 'Goblin Den'); g.status = 'entered';
    }, 'test-setup'), FIRST_CLEAR);
    await onboardPlayer(player, 'Mira Test', code);
    await dismissAll(player, 4);
    await expect.poll(() => player.evaluate(() => hunterApp.api.sync.doc('feats')?.feats['first-clear']?.name ?? null), { timeout: 30_000 }).toBe('First Clear');
    // the Clear lists a player once the player's sheet is on the GM's phone
    await expect.poll(() => gm.evaluate(() => hunterApp.api.sync.remoteSheets().map((x: any) => x.data.name)), { timeout: 30_000 }).toContain('Mira Test');
  });

  await test.step('the GM clears the Goblin Den for the player alone', async () => {
    await go(gm, 'gates');
    const card = gm.locator('#view-gates .gate', { hasText: 'Goblin Den' });
    await card.locator('[data-act="clear"]').tap();
    const form = card.locator('.gt-panel[data-form=clear]');
    await expect(form).toBeVisible();
    for (const box of await form.locator('input[name=hid]').all()) {
      const mine = (await box.locator('xpath=..').innerText()).includes('Mira Test');
      if ((await box.isChecked()) !== mine) await box.tap();
    }
    await form.locator('button[type=submit]').tap();
    await expect(form).toBeHidden();
  });

  await test.step('the player\'s phone takes the award, then counts the gate and opens the feat\'s window, once', async () => {
    await answerWindow(player, 'REWARD RECEIVED');
    // the gate's XP takes a level 1 hunter to level 2, and that window comes before the feat's
    await answerWindow(player, 'LEVEL UP!');
    const feat = player.locator('.sys-overlay.show', { hasText: 'FIRST CLEAR' });
    await expect(feat).toBeVisible();
    await expect(feat).toContainText('A gate cleared.');
    await expect(feat).toContainText('+1 ability point');
    await feat.locator('.sys-actions button', { hasText: 'Understood' }).tap();
    const h = await activeHunter(player);
    expect(h.chronicle.feats['first-clear'].at).toBe('earned');
    expect(h.chronicle.facts.filter((f: any) => f.kind === 'gate').map((f: any) => f.name)).toEqual(['Goblin Den']);
  });
});
