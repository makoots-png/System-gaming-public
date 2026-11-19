// A story in the GM's room (notes-1-stories.md section 4, unit 4): the GM opens a chapter for a player's hunter on
// another phone, which shows the chapter's window once with its reward and its quest from the GM; the player's end of
// that quest moves nothing; a player who joins late is caught up, ticked alone.
import type { Locator, Page } from '@playwright/test';
import { test, expect, onboardGM, onboardPlayer, createRoom, go, answerWindow, dismissAll } from './helpers.ts';
import { newRewards } from '../../src/core/rewards.ts';

/** Taps through the UI and counts them: what the GM's thumb does. Typing is not a tap. */
function tapCounter() {
  let n = 0;
  return { tap: async (l: Locator) => { await l.tap(); n++; }, get count() { return n; }, reset() { n = 0; } };
}
const section = (page: Page) => page.locator('#gm-stories');
const storyWin = (page: Page) => page.locator('.st-ov [role=dialog]');
const card = (page: Page) => section(page).locator('.st-card');
const runs = (page: Page) => page.evaluate(() => hunterApp.store.get().storyRuns.map((r: any) => ({ chapter: r.state.chapter, opens: r.opens })));
/** The one hunter of a player's phone, as its save holds it. */
const mine = (page: Page) => page.evaluate(() => JSON.parse(JSON.stringify(hunterApp.store.get().hunters[0])));
const chapterFacts = (h: any): string[] => [...h.chronicle.facts, ...h.chronicle.inbox].filter((f: any) => f.kind === 'chapter').map((f: any) => f.title);

const DEBT = {
  name: 'A debt', when: '', for: 'hunters', chapters: [
    { name: 'The notice', note: '', words: { title: 'THE DEEP HAS NOTICED YOU', line: 'You owe the Deep.' }, rewards: { ...newRewards(), gold: 25 },
      quest: { kind: 'side', title: 'Pay the deep', desc: '', objectives: [{ label: 'Gate cleared', target: 1, progress: 0 }], rewards: newRewards(), dueHours: null, penaltyText: '' } },
    { name: 'The quiet', note: '', words: { title: 'THE DEEP IS PATIENT', line: 'Nothing is asked.' }, rewards: newRewards(), quest: null },
    { name: 'The ask', note: '', words: { title: 'THE DEEP ASKS', line: 'Pay now.' }, rewards: newRewards(), quest: null },
  ],
};

type Dev = (label: string, o?: object) => Promise<{ page: Page }>;
/** A player joins the GM's room with one hunter, and the GM's phone holds its sheet; feats and personal gates are off on it. */
async function join(device: Dev, gm: Page, code: string, name: string): Promise<Page> {
  const page = (await device(name, { blockServiceWorker: true })).page;
  await onboardPlayer(page, name, code);
  await dismissAll(page);
  await expect.poll(() => page.evaluate(() => hunterApp.rules().feats.on), { timeout: 30_000 }).toBe(false);
  await expect.poll(() => gm.evaluate(n => hunterApp.api.sync.remoteSheets().some((s: any) => s.data.name === n), name), { timeout: 30_000 }).toBe(true);
  return page;
}
/**
 * The GM with the starter campaign in a room, A debt in the library (for chosen hunters, or the table), feats and
 * personal gates off for the room, the players of `names` in it, and the GM view's Stories section open.
 */
async function room(device: Dev, names: string[], forTable = false): Promise<{ gm: Page; code: string; players: Page[] }> {
  const gm = (await device('gm', { blockServiceWorker: true })).page;
  await onboardGM(gm);
  const code = await createRoom(gm);
  await gm.evaluate(([story, table]) => hunterApp.store.update((d: any) => {
    d.library.stories = [{ ...story, for: table ? 'table' : story.for, id: 'st1' }];
    d.rulesOverrides = { ...d.rulesOverrides, feats: { on: false }, solo: { personal: false } };
  }, 'test-setup'), [DEBT, forTable] as const);
  const players: Page[] = [];
  for (const n of names) players.push(await join(device, gm, code, n));
  await go(gm, 'gm');
  const tog = gm.locator('[data-tog="stories"]');
  if ((await tog.getAttribute('aria-expanded')) !== 'true') await tog.tap();
  await expect(section(gm).locator('[data-st-turnon]')).toBeVisible();
  return { gm, code, players };
}
/** Each of `n` chapter windows titled `title` on the GM's phone, one a hunter of its own, answered by the hunter its line names. */
async function answerEach(page: Page, title: string, n: number): Promise<void> {
  const all: string[] = await page.evaluate(() => hunterApp.store.get().hunters.map((h: any) => h.name as string));
  const seen = new Set<string>();
  for (let i = 0; i < n; i++) {
    const win = page.locator('.sys-overlay.show', { hasText: title });
    await expect(win).toBeVisible();
    const text = await win.innerText(), who = all.find(name => !seen.has(name) && text.includes(name));
    expect(who, `window ${i + 1} of ${n} titled ${title} names a hunter not yet answered`).toBeTruthy();
    seen.add(who!);
    await answerWindow(page, who!);
  }
}
/** The GM turns A debt on for the player's hunter `name`: Turn on a story, the story, the hunter, Turn on and open chapter 1. */
async function turnOnFor(gm: Page, name: string, t = tapCounter()): Promise<number> {
  const win = storyWin(gm);
  await t.tap(section(gm).locator('[data-st-turnon]'));
  await t.tap(win.locator('[data-st-story]', { hasText: 'A debt' }));
  await t.tap(win.locator('[data-st-who]', { hasText: name }));
  await t.tap(win.locator('[data-st-go]', { hasText: 'Turn on and open chapter 1' }));
  await expect(card(gm)).toContainText(`For ${name}`);
  return t.count;
}

test('the GM opens chapter 1 for a player\'s hunter; the player sees the window once, the quest is in Quests and cannot be deleted, the reward is on the sheet', async ({ device }) => {
  const { gm, players: [kai] } = await room(device, ['Kai Test']);
  const before = await mine(kai!);

  await test.step('turned on for Kai in 4 taps; the GM is told it went', async () => {
    expect(await turnOnFor(gm, 'Kai Test')).toBe(4);
    await expect(gm.locator('#toasts .toast', { hasText: 'Turned on A debt. Opened chapter 1 for Kai Test.' })).toBeVisible();
    expect(await runs(gm)).toEqual([{ chapter: 0, opens: 1 }]);
  });

  await test.step('Kai\'s phone shows the chapter\'s window, in the GM\'s words, with what it gave and the quest', async () => {
    const win = kai!.locator('.sys-overlay.show', { hasText: 'THE DEEP HAS NOTICED YOU' });
    await expect(win).toBeVisible({ timeout: 30_000 });
    await expect(win.locator('.n-tag')).toHaveText('! Story');
    await expect(win.locator('.n-body')).toHaveText('You owe the Deep.');
    await expect(win.locator('.sys-lines li')).toHaveText(['+25 gold', 'Quest: Pay the deep']);
    await answerWindow(kai!, 'THE DEEP HAS NOTICED YOU');
  });

  await test.step('the quest is in Kai\'s Quests from the GM, with no Delete and no Edit; the gold is on the sheet and the chapter in the record', async () => {
    await go(kai!, 'quests');
    const q = kai!.locator('#view-quests .qc', { hasText: 'Pay the deep' });
    await expect(q).toBeVisible();
    await expect(q.locator('[data-del]')).toHaveCount(0);
    await expect(q.locator('[data-edit]')).toHaveCount(0);
    const h = await mine(kai!);
    expect([h.gold, h.quests.filter((x: any) => x.title === 'Pay the deep').map((x: any) => x.from), chapterFacts(h)]).toEqual([before.gold + 25, ['gm'], ['THE DEEP HAS NOTICED YOU']]);
  });

  await test.step('chapter 2 opened for Kai in 2 taps reaches Kai\'s phone, and chapter 1 has not landed a second time', async () => {
    const t = tapCounter(), win = storyWin(gm);
    await t.tap(card(gm).locator('[data-st-open]', { hasText: 'Open chapter 2' }));
    await expect(win.locator('[data-st-who]', { hasText: 'Kai Test' })).toHaveAttribute('aria-pressed', 'true');
    await t.tap(win.locator('[data-st-go]', { hasText: 'Open chapter 2' }));
    expect(t.count).toBe(2);
    await answerWindow(kai!, 'THE DEEP IS PATIENT');
    const h = await mine(kai!);
    expect([h.gold, h.quests.filter((x: any) => x.title === 'Pay the deep').length, chapterFacts(h)]).toEqual([before.gold + 25, 1, ['THE DEEP HAS NOTICED YOU', 'THE DEEP IS PATIENT']]);
  });
});

test('the player completes the chapter\'s quest and the GM\'s card still says chapter 1; the next chapter waits for the GM\'s tap', async ({ device }) => {
  const { gm, players: [kai] } = await room(device, ['Kai Test']);
  await turnOnFor(gm, 'Kai Test');
  await answerWindow(kai!, 'THE DEEP HAS NOTICED YOU');

  await test.step('Kai completes Pay the deep in Quests', async () => {
    await go(kai!, 'quests');
    await kai!.locator('#view-quests .qc', { hasText: 'Pay the deep' }).locator('[data-done]').tap();
    await answerWindow(kai!, 'Complete quest?', 'Complete');
    await answerWindow(kai!, 'QUEST COMPLETE');
  });

  await test.step('the GM\'s phone hears the quest is done, and the story is where it was: chapter 1, one open, Open chapter 2 waiting', async () => {
    await expect.poll(() => gm.evaluate(() => hunterApp.api.sync.remoteSheets().flatMap((s: any) => s.data.quests).find((q: any) => q.title === 'Pay the deep')?.status), { timeout: 30_000 }).toBe('done');
    await expect(card(gm).locator('.st-at')).toHaveText('Chapter 1 of 3: The notice. Opened this session.');
    await expect(card(gm).locator('[data-st-open]')).toHaveText('Open chapter 2');
    expect(await runs(gm)).toEqual([{ chapter: 0, opens: 1 }]);
    expect(chapterFacts(await mine(kai!))).toEqual(['THE DEEP HAS NOTICED YOU']);
  });
});

test('a player who joins after chapter 1 gets chapter 2, then chapter 1 when the GM catches them up, ticked alone', async ({ device }) => {
  const { gm, code, players: [kai] } = await room(device, ['Kai Test'], true);
  const locals: number = await gm.evaluate(() => hunterApp.store.get().hunters.length);
  const t = tapCounter(), win = storyWin(gm);

  await test.step('turned on for the table: the GM\'s own hunters and Kai get chapter 1', async () => {
    await section(gm).locator('[data-st-turnon]').tap();
    await win.locator('[data-st-story]', { hasText: 'A debt' }).tap();
    await win.locator('[data-st-go]').tap();
    await answerEach(gm, 'THE DEEP HAS NOTICED YOU', locals);
    await answerWindow(kai!, 'THE DEEP HAS NOTICED YOU');
  });

  const lin = await join(device, gm, code, 'Lin Late');

  await test.step('chapter 2 opened for the table reaches Lin, who joined after chapter 1', async () => {
    await card(gm).locator('[data-st-open]', { hasText: 'Open chapter 2' }).tap();
    await expect(win.locator('[data-st-who]', { hasText: 'Lin Late' })).toHaveAttribute('aria-pressed', 'true');
    await win.locator('[data-st-go]').tap();
    await answerEach(gm, 'THE DEEP IS PATIENT', locals);
    await answerWindow(kai!, 'THE DEEP IS PATIENT');
    await answerWindow(lin, 'THE DEEP IS PATIENT');
  });

  await test.step('the catch-up in 3 taps: Open chapter 3, chapter 1, Open chapter 1; only Lin is ticked, and only Lin gets it', async () => {
    await t.tap(card(gm).locator('[data-st-open]', { hasText: 'Open chapter 3' }));
    await t.tap(win.locator('[data-st-ch="0"]'));
    await expect(win.locator('[data-st-who][aria-pressed="true"]')).toHaveText(['Lin Late']);
    await t.tap(win.locator('[data-st-go]', { hasText: 'Open chapter 1' }));
    expect(t.count).toBe(3);
    await answerWindow(lin, 'THE DEEP HAS NOTICED YOU');
    expect(chapterFacts(await mine(lin))).toEqual(['THE DEEP IS PATIENT', 'THE DEEP HAS NOTICED YOU']);
    expect((await mine(lin)).quests.filter((q: any) => q.title === 'Pay the deep').length).toBe(1);
    expect(chapterFacts(await mine(kai!))).toEqual(['THE DEEP HAS NOTICED YOU', 'THE DEEP IS PATIENT']);
  });
});
