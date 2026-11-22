// Rewards the app pays by itself wait for the GM (World rule 8; the owner, Nov 22, rule d; src/core/hunter/pending.ts):
// a player's counted quest completes on the player's phone, its reward waits in the GM's "Waiting for you" list, and the
// GM edits and approves it, or refuses it. The player gets the approved reward once, across reloads of both phones.
import { test, expect, onboardGM, onboardPlayer, createRoom, dismissAll, go, activeHunter, answerWindow, waitingRow, type Page } from './helpers.ts';

const HUNTER = 'Mira Test';
const QUEST = 'Catch your breath';
const RULE_GOLD = 40, EDITED_GOLD = 75;

/** A GM and a player in one room; the GM issues the player a quest of one rest, counted by the System, paying `RULE_GOLD`. */
async function countedQuest(device: (label: string) => Promise<{ page: Page }>): Promise<{ gm: Page; player: Page }> {
  const gm = (await device('gm')).page, player = (await device('player')).page;
  await onboardGM(gm);
  const code = await createRoom(gm);
  await onboardPlayer(player, HUNTER, code);
  await expect.poll(() => player.evaluate(() => hunterApp.api.sync.room())).toBe(code);
  await dismissAll(player, 4);
  // setup: no feat's reward joins the quest's in the list
  await gm.evaluate(() => hunterApp.store.update((d: any) => { d.rulesOverrides.feats = { on: false }; }, 'test-setup'));
  await go(gm, 'gm');
  await expect(gm.locator('#gm-board .gm-card.remote', { hasText: HUNTER })).toHaveCount(1, { timeout: 30_000 });
  await gm.locator('[data-tog="quest"]').tap();
  const form = gm.locator('#gm-qf');
  await form.locator('[name=title]').fill(QUEST);
  await form.locator('[name=olabel]').fill('Rests');
  await form.locator('[data-ocb]').selectOption('system');
  await form.locator('[data-ocount] [data-ck]').selectOption('rest');
  await form.locator('#gmq-gold').fill(String(RULE_GOLD));
  await gm.locator('[data-tog="award"]').tap();
  await gm.locator('#gm-targets label', { hasText: HUNTER }).tap();
  await gm.locator('#gm-q-go').tap();
  await answerWindow(player, QUEST);
  await dismissAll(player, 4);
  return { gm, player };
}
/** The player rests once on the sheet: the System completes the quest, and its window says the reward waits for the GM. */
async function restCompletes(player: Page): Promise<void> {
  await go(player, 'status');
  await player.locator('#view-status [data-rest]').tap();
  const done = player.locator('.sys-overlay.show', { hasText: 'QUEST COMPLETE' });
  await expect(done).toBeVisible({ timeout: 15_000 });
  await expect(done).toContainText('Waiting for the GM');
  await expect(done).not.toContainText(`+${RULE_GOLD} gold`);
  await done.locator('.sys-actions button').first().tap();
}
/** The GM's rows of the quest's reward. */
const questRows = (gm: Page) => gm.locator('#gm-pw [data-pw]', { hasText: QUEST });
const gold = async (player: Page): Promise<number> => (await activeHunter(player)).gold;

test('a player\'s counted quest completes; its reward waits for the GM, who edits the gold and approves it; the player gets the edited gold once', async ({ device }) => {
  const { gm, player } = await countedQuest(device);
  const before = await gold(player);

  await test.step('the quest is done at once on the player\'s phone, and nothing is paid', async () => {
    await restCompletes(player);
    expect((await activeHunter(player)).quests.find((q: any) => q.title === QUEST).status).toBe('done');
    expect(await gold(player)).toBe(before);
  });

  await test.step('the GM\'s list holds the reward as the rule pays it; Edit opens it in the Award form\'s fields', async () => {
    const row = await waitingRow(gm, QUEST);
    await expect(row).toContainText(HUNTER);
    await expect(row).toContainText(`+${RULE_GOLD} gold`);
    await row.locator('[data-pw-edit]').tap();
    await expect(gm.locator('#gm-gold')).toHaveValue(String(RULE_GOLD));
    await expect(gm.locator('#gm-award-tie')).toContainText(`For ${HUNTER}: Quest complete: ${QUEST}.`);
    await expect(gm.locator('#gm-award-go')).toHaveText('Approve');
  });

  await test.step('the GM raises the gold and approves: the player\'s phone shows the edited gold, paid once', async () => {
    await gm.fill('#gm-gold', String(EDITED_GOLD));
    await gm.locator('#gm-award-go').tap();
    await expect(questRows(gm), 'the approved reward leaves the list').toHaveCount(0);
    const win = player.locator('.sys-overlay.show', { hasText: 'REWARD RECEIVED' });
    await expect(win).toBeVisible({ timeout: 30_000 });
    await expect(win).toContainText(`Quest complete: ${QUEST}. The GM approved your reward.`);
    await expect(win).toContainText(`+${EDITED_GOLD} gold`);
    await dismissAll(player);
    expect(await gold(player)).toBe(before + EDITED_GOLD);
  });

  await test.step('a reload of both phones pays nothing again, and the GM\'s list stays empty', async () => {
    await gm.reload();
    await player.reload();
    await expect.poll(() => player.evaluate(() => hunterApp.api.sync.status()), { timeout: 30_000 }).toBe('connected');
    await expect.poll(async () => (await activeHunter(player)).gold).toBe(before + EDITED_GOLD);
    await go(gm, 'gm');
    await expect(questRows(gm)).toHaveCount(0);
    expect(await gm.evaluate(() => hunterApp.store.get().settings.sync.pending.filter((p: any) => p.from === 'quest').map((p: any) => [p.at, p.rewards.gold]))).toEqual([['approved', EDITED_GOLD]]);
  });
});

test('the GM refuses a reward waiting for a player: the player is told, and nothing is paid', async ({ device }) => {
  const { gm, player } = await countedQuest(device);
  const before = await gold(player);
  await restCompletes(player);
  const row = await waitingRow(gm, QUEST);
  await row.locator('[data-pw-refuse]').tap();
  await expect(gm.locator('#gm-pw-msg')).toHaveText(`Refused for ${HUNTER}.`);
  await expect(questRows(gm)).toHaveCount(0);
  const win = player.locator('.sys-overlay.show', { hasText: 'REWARD REFUSED' });
  await expect(win).toBeVisible({ timeout: 30_000 });
  await expect(win).toContainText(`Quest complete: ${QUEST}. The GM did not give this reward.`);
  await dismissAll(player);
  await gm.reload();
  await go(gm, 'gm');
  await expect(questRows(gm), 'a refused reward does not come back').toHaveCount(0);
  expect(await gold(player)).toBe(before);
});
