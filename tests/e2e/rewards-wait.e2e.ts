// Rewards the app pays by itself wait for the GM (World rule 8; the owner, Nov 22, rule d; src/core/hunter/pending.ts):
// a player's counted quest completes on the player's phone, its reward waits in the GM's "Waiting for you" list, and the
// GM edits and approves it, or refuses it. The player gets the approved reward once, across reloads of both phones.
import { test, expect, onboardGM, onboardPlayer, createRoom, dismissAll, go, activeHunter, answerWindow, waitingRow, gmRoomHeaders, type Page } from './helpers.ts';
import { PENDING_WORDS } from '../../src/core/hunter/pending.ts';
import { approvalIdOf, parseEventId } from '../../src/core/ids.ts';

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
  await expect(done).toContainText(PENDING_WORDS.waits);
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
  await expect(gm.locator('#gm-pw-msg')).toHaveText(PENDING_WORDS.refused(HUNTER));
  await expect(questRows(gm)).toHaveCount(0);
  const win = player.locator('.sys-overlay.show', { hasText: 'REWARD REFUSED' });
  await expect(win).toBeVisible({ timeout: 30_000 });
  await expect(win).toContainText(PENDING_WORDS.refusedBody('quest', QUEST));
  await dismissAll(player);
  await gm.reload();
  await go(gm, 'gm');
  await expect(questRows(gm), 'a refused reward does not come back').toHaveCount(0);
  expect(await gold(player)).toBe(before);
});

test('Approve all pays multiple pending player rewards in one tap and does not double-pay across reloads', async ({ device }) => {
  const { gm, player } = await countedQuest(device);
  const before = await gold(player);

  // Issue a second counted rest quest so one rest completes both and creates 2 pending rewards
  const QUEST_TWO = 'Second breath';
  const GOLD_TWO = 35;
  await go(gm, 'gm');
  const qTog = gm.locator('[data-tog="quest"]');
  if ((await qTog.getAttribute('aria-expanded')) !== 'true') await qTog.tap();
  const form = gm.locator('#gm-qf');
  await form.locator('[name=title]').fill(QUEST_TWO);
  await form.locator('[name=olabel]').fill('Rests');
  await form.locator('[data-ocb]').selectOption('system');
  await form.locator('[data-ocount] [data-ck]').selectOption('rest');
  await form.locator('#gmq-gold').fill(String(GOLD_TWO));
  await gm.locator('#gm-q-go').tap();
  await answerWindow(player, QUEST_TWO);
  await dismissAll(player, 4);

  // Player rests once -> both quests complete and wait for GM approval
  await go(player, 'status');
  await player.locator('#view-status [data-rest]').tap();
  await answerWindow(player, 'QUEST COMPLETE');
  await answerWindow(player, 'QUEST COMPLETE');
  expect(await gold(player)).toBe(before);

  await go(gm, 'gm');
  const wTog = gm.locator('[data-tog="waiting"]');
  if ((await wTog.getAttribute('aria-expanded')) !== 'true') await wTog.tap();
  await expect(gm.locator('#gm-pw [data-pw]')).toHaveCount(2, { timeout: 30_000 });
  const approveAll = gm.locator('#gm-pw-all');
  await expect(approveAll).toBeVisible();
  await expect(approveAll).toHaveText(PENDING_WORDS.approveAllCount(2));

  await approveAll.tap();
  await expect(gm.locator('#gm-pw [data-pw]')).toHaveCount(0);
  await expect(gm.locator('#gm-pw-bar')).toBeHidden();
  await expect(gm.locator('#gm-pw-msg')).toHaveText(PENDING_WORDS.approvedAll(2));

  await expect.poll(() => gold(player), { timeout: 30_000 }).toBe(before + RULE_GOLD + GOLD_TWO);
  await dismissAll(player, 6);

  await gm.reload();
  await player.reload();
  await expect.poll(() => player.evaluate(() => hunterApp.api.sync.status()), { timeout: 30_000 }).toBe('connected');
  expect(await gold(player)).toBe(before + RULE_GOLD + GOLD_TWO);
});

test('single-row Approve on one GM phone racing Approve all on a second GM phone pays the player once', async ({ device }) => {
  const { gm, player } = await countedQuest(device);
  const code = await gm.evaluate(() => hunterApp.api.sync.room() as string);
  const gmKey = await gm.evaluate(c => hunterApp.store.get().settings.sync.gmKeys[c] as string, code);
  const before = await gold(player);

  const gm2 = (await device('gm2')).page;
  await onboardGM(gm2);
  await gm2.evaluate(() => hunterApp.store.update((d: any) => { d.rulesOverrides.feats = { on: false }; }, 'test-setup'));
  await gm2.evaluate(({ c, k }) => hunterApp.api.sync.rejoinGM(c, k), { c: code, k: gmKey });
  await expect.poll(() => gm2.evaluate(() => hunterApp.api.sync.room()), { timeout: 30_000 }).toBe(code);
  await go(gm2, 'gm');
  await expect(gm2.locator('#gm-board .gm-card.remote', { hasText: HUNTER })).toHaveCount(1, { timeout: 30_000 });

  const QUEST_TWO = 'Second breath';
  const GOLD_TWO = 35;
  await go(gm, 'gm');
  const qTog = gm.locator('[data-tog="quest"]');
  if ((await qTog.getAttribute('aria-expanded')) !== 'true') await qTog.tap();
  const form = gm.locator('#gm-qf');
  await form.locator('[name=title]').fill(QUEST_TWO);
  await form.locator('[name=olabel]').fill('Rests');
  await form.locator('[data-ocb]').selectOption('system');
  await form.locator('[data-ocount] [data-ck]').selectOption('rest');
  await form.locator('#gmq-gold').fill(String(GOLD_TWO));
  await gm.locator('#gm-q-go').tap();
  await answerWindow(player, QUEST_TWO);
  await dismissAll(player, 4);

  await go(player, 'status');
  await player.locator('#view-status [data-rest]').tap();
  await answerWindow(player, 'QUEST COMPLETE');
  await answerWindow(player, 'QUEST COMPLETE');
  expect(await gold(player)).toBe(before);

  const row1 = await waitingRow(gm, QUEST);
  const rec1Id = parseEventId(await row1.getAttribute('data-pw'))!;
  await waitingRow(gm2, QUEST);
  await expect(gm2.locator('#gm-pw [data-pw]')).toHaveCount(2, { timeout: 30_000 });

  await row1.locator('[data-pw-approve]').tap();
  await expect(questRows(gm)).toHaveCount(0);
  await gm2.locator('#gm-pw-all').tap();
  await expect(gm2.locator('#gm-pw [data-pw]')).toHaveCount(0);

  await expect.poll(() => gm.evaluate(() => (hunterApp.store.get().settings.sync.outbox ?? []).length), { timeout: 30_000 }).toBe(0);
  await expect.poll(() => gm2.evaluate(() => (hunterApp.store.get().settings.sync.outbox ?? []).length), { timeout: 30_000 }).toBe(0);
  await expect.poll(() => gold(player), { timeout: 30_000 }).toBe(before + RULE_GOLD + GOLD_TWO);
  await dismissAll(player, 6);

  const res = await gm.request.get(`/api/rooms/${code}?after=0`, { headers: await gmRoomHeaders(gm, code) });
  const body = await res.json();
  const awards = body.events.filter((e: any) => e.type === 'award');
  expect(awards).toHaveLength(2);
  expect(awards.map((e: any) => e.payload.eid)).toContain(approvalIdOf(rec1Id));
  expect(await gold(player)).toBe(before + RULE_GOLD + GOLD_TWO);
});
