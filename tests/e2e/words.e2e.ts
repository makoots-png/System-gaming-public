// A private word to the GM on screen (src/views/words.js, src/core/sync/word.ts): a player sends the GM a word from the
// Room view, the GM answers it in "Words from players", and the answer opens a window once on the player's phone. Both
// are sealed messages: another player's phone never holds either, in its save or in any answer the room gave it.
import type { Page } from '@playwright/test';
import { WORD_WORDS } from '../../src/core/sync/word.ts';
import { test, expect, onboardGM, onboardPlayer, createRoom, dismissAll, go } from './helpers.ts';

const WORD = 'Can my shadow scout the gate before we go in?', ANSWER = 'Yes. Roll Perception when it comes back.';

test('Mira sends the GM a word and the GM answers; Brakk\'s phone never holds either', async ({ device }) => {
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

  await test.step('Mira writes in the Room view\'s "Word to the GM" and sends it: her thread shows it, Sent. once the room has it', async () => {
    await go(mira, 'room');
    const sec = mira.locator('#view-room [data-wordsec]');
    await expect(sec).toBeVisible();
    await expect(sec).toContainText(WORD_WORDS.privacy);
    await expect(sec.locator('[data-wd-thread]')).toHaveText('Nothing sent yet.');
    await sec.getByLabel(WORD_WORDS.field).fill(WORD);
    await sec.getByRole('button', { name: 'Send to the GM' }).tap();
    const line = sec.locator('.wd-line', { hasText: WORD });
    await expect(line).toBeVisible();
    await expect(line.locator('.wd-who')).toHaveText(/^You, \d\d:\d\d$/);
    await expect(line.locator('.wd-state')).toHaveText('Sent.', { timeout: 20_000 });
    await expect(sec.getByLabel(WORD_WORDS.field)).toHaveValue('');
  });

  await test.step('the GM hears it once: a toast, "1 new" on the section\'s head, the word with Answer, and a line of the session log', async () => {
    await expect(gm.locator('#toasts .toast', { hasText: 'Mira sent you a word.' })).toBeVisible({ timeout: 20_000 });
    await go(gm, 'gm');
    await expect(gm.locator('#gm-hsum-words')).toHaveText('1 new');
    const toggle = gm.locator('[data-tog="words"]');
    if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.tap();
    const line = gm.locator('#gm-words .wd-line', { hasText: WORD });
    await expect(line.locator('.wd-who').first()).toHaveText(/^Mira, \d\d:\d\d$/);
    expect(await gm.evaluate(() => hunterApp.store.get().log.filter((l: any) => l.kind === 'word').map((l: any) => l.text))).toEqual([`Mira: ${WORD}`]);
  });

  await test.step('the GM answers: Answer opens a field, Send answer sends it, and the word shows the answer in place of Answer', async () => {
    const sec = gm.locator('#gm-words');
    await sec.getByRole('button', { name: 'Answer: Mira' }).tap();
    await sec.getByLabel('Your answer').fill(ANSWER);
    await sec.getByRole('button', { name: 'Send answer' }).tap();
    await expect(sec.locator('[data-wd-msg]')).toHaveText('Sent to Mira.');
    await expect(sec.locator('.wd-line', { hasText: WORD })).toContainText(ANSWER);
    await expect(sec.getByRole('button', { name: 'Answer: Mira' })).toHaveCount(0);
    await expect(gm.locator('#gm-hsum-words')).toHaveText('');
    expect(await gm.evaluate(() => hunterApp.store.get().log.filter((l: any) => l.kind === 'answer').map((l: any) => l.text))).toEqual([`You to Mira: ${ANSWER}`]);
  });

  await test.step('Mira\'s phone opens the answer in a window once; closed, it stays in her thread under her word', async () => {
    const win = mira.locator('.sys-overlay.show', { hasText: 'FROM THE GM' });
    await expect(win).toBeVisible({ timeout: 20_000 });
    await expect(win).toContainText(ANSWER);
    await win.getByRole('button', { name: 'Close' }).tap();
    await expect(win).toHaveCount(0);
    const answer = mira.locator('#view-room [data-wordsec] .wd-gm');
    await expect(answer).toContainText(ANSWER);
    await expect(answer.locator('.wd-who')).toHaveText(/^GM, \d\d:\d\d$/);
    await mira.reload();
    await go(mira, 'room');
    await expect(mira.locator('#view-room [data-wordsec] .wd-gm')).toContainText(ANSWER);
    await expect(mira.locator('.sys-overlay.show', { hasText: 'FROM THE GM' }), 'read: a reload does not open it again').toHaveCount(0);
  });

  await test.step('Brakk\'s phone holds neither: not in its save, not in any answer the room gave it', async () => {
    await expect.poll(() => brakk.evaluate(() => hunterApp.api.sync.detail().lastOk ?? 0)).toBeGreaterThan(0);
    const kept = await brakk.evaluate(() => JSON.stringify(hunterApp.store.get()));
    for (const text of [WORD, ANSWER]) {
      expect(kept).not.toContain(text);
      expect(brakkHeard.filter(b => b.includes(text))).toEqual([]);
    }
    expect(brakkHeard.length, 'Brakk\'s phone polled the room').toBeGreaterThan(0);
    await go(brakk, 'room');
    await expect(brakk.locator('#view-room [data-wordsec] [data-wd-thread]')).toHaveText('Nothing sent yet.');
  });
});

test('a word with nothing written is not sent, and says so', async ({ device }) => {
  const gm = (await device('gm')).page, mira: Page = (await device('mira')).page;
  await onboardGM(gm);
  const code = await createRoom(gm);
  await onboardPlayer(mira, 'Mira', code);
  await expect.poll(() => mira.evaluate(() => hunterApp.api.sync.room())).toBe(code);
  await dismissAll(mira, 4);
  await go(mira, 'room');
  const sec = mira.locator('#view-room [data-wordsec]');
  await sec.getByLabel(WORD_WORDS.field).fill('   ');
  await sec.getByRole('button', { name: 'Send to the GM' }).tap();
  await expect(mira.locator('#toasts .toast', { hasText: 'Write something first.' })).toBeVisible();
  expect(await mira.evaluate(() => (hunterApp.store.get().settings.sync.words ?? []).length)).toBe(0);
});
