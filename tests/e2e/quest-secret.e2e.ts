// A secret quest on screen (src/core/hunter/quest-secret.ts, the box on the GM view's Issue quest, the chip on the
// player's quest card): the GM gives one hunter a quest that the room seals, with its progress, to that hunter's phone
// and the GM's. Another player's phone never holds it, in its save or in any answer the room gave it, even when it ends.
import { test, expect, onboardGM, onboardPlayer, createRoom, dismissAll, go, answerWindow } from './helpers.ts';

const TITLE = 'Unmask the traitor', CLUE = 'Clues found';

test('the GM gives Mira a secret quest: Mira sees it marked Secret, Brakk\'s phone never receives it, and the GM reads Mira\'s progress', async ({ device }) => {
  const gm = (await device('gm')).page, mira = (await device('mira')).page, brakk = (await device('brakk')).page;
  const brakkHeard: string[] = [];
  brakk.on('response', r => { if (r.url().includes('/api/rooms/')) void r.text().then(t => { brakkHeard.push(t); }, () => undefined); });
  await onboardGM(gm);
  const code = await createRoom(gm);
  await onboardPlayer(mira, 'Mira', code);
  await onboardPlayer(brakk, 'Brakk', code);
  for (const p of [mira, brakk]) {
    await expect.poll(() => p.evaluate(() => hunterApp.api.sync.room())).toBe(code);
    await dismissAll(p, 4);
  }

  await test.step('the GM writes the quest, ticks Secret and picks Mira and Brakk: Issue quest says a secret quest goes to one hunter, and sends nothing', async () => {
    await go(gm, 'gm');
    await gm.locator('[data-tog="quest"]').tap();
    const form = gm.locator('#gm-qf');
    await form.locator('[name=title]').fill(TITLE);
    await form.locator('[name=olabel]').fill(CLUE);
    await form.locator('[name=otarget]').fill('2');
    await gm.getByLabel('Secret: only this hunter and you see it').check();
    await gm.locator('[data-tog="award"]').tap();
    for (const name of ['Mira (remote)', 'Brakk (remote)']) await gm.locator('#gm-targets label', { hasText: name }).tap();
    await gm.locator('#gm-q-go').tap();
    await expect(gm.locator('#gm-q-msg')).toHaveText('A secret quest goes to one hunter.');
    expect(await gm.evaluate(() => (hunterApp.store.get().settings.sync.outbox ?? []).filter((l: any) => l.letter.event?.type === 'quest').length)).toBe(0);
  });

  await test.step('with Brakk unpicked, Issue quest sends it to Mira alone', async () => {
    await gm.locator('#gm-targets label', { hasText: 'Brakk (remote)' }).tap();
    await gm.locator('#gm-q-go').tap();
    await expect(gm.locator('#gm-q-msg')).toHaveText(/^(Sent to 1 remote\.|1 remote gets it when the room answers\.)$/);
  });

  await test.step('Mira\'s phone opens the quest with the Secret line, and her quest card shows the Secret chip and says only she and the GM see it', async () => {
    const win = mira.locator('.sys-overlay.show', { hasText: TITLE });
    await expect(win).toBeVisible({ timeout: 20_000 });
    await expect(win).toContainText('SECRET: Only you and the GM see this quest.');
    await answerWindow(mira, TITLE);
    await go(mira, 'quests');
    const card = mira.locator('#view-quests .qc', { hasText: TITLE });
    await expect(card.locator('[data-secret]')).toHaveText('Secret');
    await expect(card).toContainText('Only you and the GM see this quest.');
  });

  await test.step('Mira finds a clue: the GM is told and its session log reads her progress, marked (secret)', async () => {
    await mira.locator('#view-quests .qc', { hasText: TITLE }).getByRole('button', { name: `Increase ${CLUE}` }).tap();
    await expect(gm.locator('#toasts .toast', { hasText: `Mira · ${TITLE} (secret) 1/2` })).toBeVisible({ timeout: 20_000 });
    await expect.poll(() => gm.evaluate(() => hunterApp.store.get().log.filter((l: any) => l.kind === 'quest').map((l: any) => l.text))).toContain(`Mira · ${TITLE} (secret) 1/2`);
  });

  await test.step('the GM\'s Party quests shows Mira\'s quest marked (secret), at 1/2', async () => {
    await go(gm, 'quests');
    const row = gm.locator('[data-party] li', { hasText: TITLE });
    await expect(row).toContainText('Mira');
    await expect(row.locator('.sec')).toHaveText('(secret)');
    await expect(row.locator('.st')).toHaveText('1/2', { timeout: 20_000 });
  });

  await test.step('Mira finds the second clue and completes it: the GM reads the end, marked (secret)', async () => {
    await mira.locator('#view-quests .qc', { hasText: TITLE }).getByRole('button', { name: `Increase ${CLUE}` }).tap();
    await answerWindow(mira, 'Complete quest?', 'Complete');
    await dismissAll(mira, 4);
    await expect(gm.locator('#toasts .toast', { hasText: `Mira COMPLETED ${TITLE} (secret)` })).toBeVisible({ timeout: 20_000 });
  });

  await test.step('Brakk\'s phone holds none of it: not in its save, not in any answer the room gave it, not on its screen', async () => {
    await expect.poll(() => brakk.evaluate(() => hunterApp.api.sync.detail().lastOk ?? 0)).toBeGreaterThan(0);
    expect(brakkHeard.length, 'Brakk\'s phone polled the room').toBeGreaterThan(0);
    const polledAfter = brakkHeard.length;
    await expect.poll(() => brakkHeard.length, 'Brakk\'s phone polled again after the quest ended').toBeGreaterThan(polledAfter);
    expect(await brakk.evaluate(() => JSON.stringify(hunterApp.store.get()))).not.toContain(TITLE);
    expect(brakkHeard.filter(b => b.includes(TITLE))).toEqual([]);
    await go(brakk, 'quests');
    await expect(brakk.locator('#view-quests')).not.toContainText(TITLE);
    await expect(brakk.locator('.sys-overlay.show', { hasText: TITLE })).toHaveCount(0);
  });
});
