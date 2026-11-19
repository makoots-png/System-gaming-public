// A GM alone with hunters on one phone runs a story (notes-1-stories.md sections 5 and 9, unit 3): turned on from the GM
// view's Stories section, a chapter opened at a time, ended under Undo, and the taps of section 5.2 counted.
import type { Locator, Page } from '@playwright/test';
import { test, expect, onboardGM, go, answerWindow } from './helpers.ts';
import { EXAMPLE_STORIES } from '../../src/core/registry/stories.ts';

/** Taps through the UI and counts them: what the GM's thumb does. Typing is not a tap. */
function tapCounter() {
  let n = 0;
  return { tap: async (l: Locator) => { await l.tap(); n++; }, get count() { return n; }, reset() { n = 0; } };
}
const section = (page: Page) => page.locator('#gm-stories');
const storyWin = (page: Page) => page.locator('.st-ov [role=dialog]');
const card = (page: Page) => section(page).locator('.st-card');
const runs = (page: Page) => page.evaluate(() => hunterApp.store.get().storyRuns.map((r: any) => ({ state: r.state, opens: r.opens, who: r.who.at })));
const hunterId = (page: Page, name: string) => page.evaluate(n => hunterApp.store.get().hunters.find((h: any) => h.name === n).id as string, name);
const pointsOf = (page: Page, id: string) => page.evaluate(i => hunterApp.store.get().hunters.find((h: any) => h.id === i).bonusPoints as number, id);
/** How many chapter windows the System keeps in a hunter's record. */
const chapterFacts = (page: Page, id: string) => page.evaluate(i => hunterApp.store.get().hunters.find((h: any) => h.id === i).chronicle.facts.filter((f: any) => f.kind === 'chapter').length as number, id);
/** Each of `n` chapter windows titled `title`, one a hunter, answered in turn. */
async function answerEach(page: Page, title: string, n: number): Promise<void> {
  // the windows share a title and follow each other at once, so each is answered by the hunter it names
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

/** The GM alone with the starter campaign, feats off, The wager in the library (for the table when `forTable`), and 5 points more on each hunter. */
async function setup(page: Page, forTable = false): Promise<void> {
  await onboardGM(page);
  await page.evaluate(([story, table]) => hunterApp.store.update((d: any) => {
    d.library.stories = [{ ...story, for: table ? 'table' : story.for, id: 'st1' }];
    d.rulesOverrides = { ...d.rulesOverrides, feats: { on: false } };
    for (const h of d.hunters) h.bonusPoints += 5;
  }, 'test-setup'), [EXAMPLE_STORIES[0]!.story, forTable] as const);
  await go(page, 'gm');
  const tog = page.locator('[data-tog="stories"]');
  if ((await tog.getAttribute('aria-expanded')) !== 'true') await tog.tap();
  await expect(section(page).locator('[data-st-turnon]')).toBeVisible();
}

test('a GM alone turns on The wager for one hunter and sees its first window; opens chapter 2 twice, and the hunter loses a point each time; ends it, undoes the end, ends it again', async ({ device }) => {
  const page = (await device('gm')).page, t = tapCounter();
  await setup(page);
  const brakk = await hunterId(page, 'Brakk Ironhide'), mira = await hunterId(page, 'Mira Vale'), win = storyWin(page);
  const before = await pointsOf(page, brakk), miraBefore = await pointsOf(page, mira);

  await test.step('turned on for Brakk in 4 taps: Turn on a story, the story, Brakk, Turn on and open chapter 1; Brakk sees chapter 1\'s window', async () => {
    await t.tap(section(page).locator('[data-st-turnon]'));
    await expect(win.getByRole('heading', { name: 'Turn on a story' })).toBeVisible();
    await t.tap(win.locator('[data-st-story]', { hasText: 'The wager' }));
    await expect(win.getByRole('heading', { name: 'Turn on The wager' })).toBeVisible();
    await expect(win.locator('[data-st-for="hunters"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(win.locator('.st-prev')).toContainText('THE SYSTEM WILL TAKE THAT BET');
    await t.tap(win.locator('[data-st-who]', { hasText: 'Brakk Ironhide' }));
    await t.tap(win.locator('[data-st-go]', { hasText: 'Turn on and open chapter 1' }));
    expect(t.count).toBe(4);
    await answerWindow(page, 'THE SYSTEM WILL TAKE THAT BET');
    await expect(card(page)).toContainText('For Brakk Ironhide');
    await expect(card(page).locator('.st-at')).toHaveText('Chapter 1 of 4: The bet. Opened this session.');
    await expect(page.locator('#gm-hsum-stories')).toHaveText('1 running');
  });

  await test.step('the card names the next chapter and what it gives without a tap; chapter 2 opened in 2 taps takes 1 point from Brakk alone', async () => {
    await expect(card(page).locator('.st-next')).toHaveText('Next: 2. The runs. THE SYSTEM IS WATCHING THE NUMBERS. Gives a reward.');
    t.reset();
    await t.tap(card(page).locator('[data-st-open]', { hasText: 'Open chapter 2' }));
    await expect(win.getByRole('heading', { name: 'Open chapter 2' })).toBeVisible();
    await expect(win.locator('[data-st-who]', { hasText: 'Brakk Ironhide' })).toHaveAttribute('aria-pressed', 'true');
    await expect(win.locator('.st-prev li')).toHaveText(['Loses 1 ability point']);
    await t.tap(win.locator('[data-st-go]'));
    expect(t.count).toBe(2);
    await answerWindow(page, 'THE SYSTEM IS WATCHING THE NUMBERS');
    expect([await pointsOf(page, brakk), await pointsOf(page, mira)]).toEqual([before - 1, miraBefore]);
  });

  await test.step('chapter 2 opened again in 3 taps (the card\'s Open, the chapter\'s number, Open) takes another point; the window says Brakk has had it', async () => {
    t.reset();
    await t.tap(card(page).locator('[data-st-open]', { hasText: 'Open chapter 3' }));
    await t.tap(win.locator('[data-st-ch="1"]'));
    await expect(win.locator('[data-st-who]', { hasText: 'Brakk Ironhide' })).toHaveText('Brakk Ironhide · has it');
    await expect(win).toContainText('Brakk Ironhide has had this chapter. Opening it gives it again.');
    await t.tap(win.locator('[data-st-go]', { hasText: 'Open chapter 2' }));
    expect(t.count).toBe(3);
    await answerWindow(page, 'THE SYSTEM IS WATCHING THE NUMBERS');
    expect(await pointsOf(page, brakk)).toBe(before - 2);
    expect(await runs(page)).toEqual([{ state: { at: 'running', chapter: 1 }, opens: 3, who: 'hunters' }]);
  });

  await test.step('End in 2 taps (⋯, End story) is held under Undo; Undo keeps the story running after the toast is gone', async () => {
    t.reset();
    await t.tap(card(page).locator('[data-st-more]'));
    await t.tap(page.locator('.sys-overlay.show .sys-actions button', { hasText: 'End story' }));
    expect(t.count).toBe(2);
    const toast = page.locator('#toasts .toast', { hasText: 'Ended The wager.' });
    await toast.locator('.t-undo').tap();
    await expect(toast).toHaveCount(0);
    await page.waitForTimeout(2500);
    expect((await runs(page))[0]!.state.at).toBe('running');
    await expect(card(page)).toHaveCount(1);
  });

  await test.step('ended again, it is written when the toast ends: the card goes and the story is in the Ended fold', async () => {
    await card(page).locator('[data-st-more]').tap();
    await page.locator('.sys-overlay.show .sys-actions button', { hasText: 'End story' }).tap();
    await expect(page.locator('#toasts .toast', { hasText: 'Ended The wager.' })).toHaveCount(0);
    await expect(card(page)).toHaveCount(0);
    await expect(section(page)).toContainText('No story is running.');
    await section(page).locator('.st-ended summary').tap();
    await expect(section(page).locator('.st-ended li')).toHaveText(['The wager · for Brakk Ironhide · ended at chapter 2 in session 0']);
    expect(await runs(page)).toEqual([{ state: { at: 'ended', chapter: 1, endedAt: expect.any(String), session: 0 }, opens: 3, who: 'hunters' }]);
    expect(await pointsOf(page, brakk)).toBe(before - 2);
  });
});

test('a story for the table: on in 3 taps for everyone here, a late hunter ticked alone to catch up, the last chapter ended in 1 tap, and stale taps refused', async ({ device }) => {
  const page = (await device('gm')).page, t = tapCounter();
  await setup(page, true);
  const win = storyWin(page), brakk = await hunterId(page, 'Brakk Ironhide');
  const names = await page.evaluate(() => hunterApp.store.get().hunters.map((h: any) => h.name as string));

  await test.step('turned on for the table in 3 taps: Turn on a story, the story, Turn on and open chapter 1; every hunter here sees its window', async () => {
    await t.tap(section(page).locator('[data-st-turnon]'));
    await t.tap(win.locator('[data-st-story]', { hasText: 'The wager' }));
    await expect(win.locator('[data-st-for="table"]')).toHaveAttribute('aria-pressed', 'true');
    await t.tap(win.locator('[data-st-go]'));
    expect(t.count).toBe(3);
    await answerEach(page, 'THE SYSTEM WILL TAKE THAT BET', names.length);
    await expect(card(page)).toContainText('For the table');
    for (const n of names) expect(await chapterFacts(page, await hunterId(page, n))).toBe(1);
  });

  await test.step('a hunter added after chapter 1 is the only one ticked when the GM picks chapter 1 again: the catch-up is 3 taps', async () => {
    await page.evaluate(() => hunterApp.store.update((d: any) => { const h = JSON.parse(JSON.stringify(d.hunters[0])); d.hunters.push({ ...h, id: 'h900', name: 'Kai Late', chronicle: { ...h.chronicle, facts: [] } }); }, 'test-setup'));
    t.reset();
    await t.tap(card(page).locator('[data-st-open]'));
    await t.tap(win.locator('[data-st-ch="0"]'));
    await expect(win.locator('[data-st-who][aria-pressed="true"]')).toHaveText(['Kai Late']);
    await t.tap(win.locator('[data-st-go]', { hasText: 'Open chapter 1' }));
    expect(t.count).toBe(3);
    await answerWindow(page, 'THE SYSTEM WILL TAKE THAT BET');
    expect(await chapterFacts(page, 'h900')).toBe(1);
  });

  await test.step('a tap from a window drawn before the story was opened again is refused, says where the story is, and writes nothing', async () => {
    await card(page).locator('[data-st-open]').tap();
    await expect(win.getByRole('heading', { name: 'Open chapter 2' })).toBeVisible();
    const pts = await pointsOf(page, brakk);
    await page.evaluate(() => hunterApp.store.update((d: any) => { d.storyRuns[0].opens += 1; }, 'test-setup'));
    await win.locator('[data-st-go]').tap();
    await expect(win.locator('[data-st-err]')).toHaveText('This story was opened again meanwhile. It is at chapter 1 now.');
    expect([await pointsOf(page, brakk), (await runs(page))[0]!.state.chapter]).toEqual([pts, 0]);
    await win.locator('[data-st-cancel]').tap();
    await expect(win).toHaveCount(0);
  });

  await test.step('an End held under Undo while the GM opens chapter 2 is refused when the toast ends, and the story stays at chapter 2', async () => {
    await card(page).locator('[data-st-more]').tap();
    await page.locator('.sys-overlay.show .sys-actions button', { hasText: 'End story' }).tap();
    await card(page).locator('[data-st-open]').tap();
    await win.locator('[data-st-go]').tap();
    await expect(page.locator('#toasts .toast', { hasText: 'This story was opened again meanwhile. It is at chapter 2 now.' })).toBeVisible();
    await expect(card(page).locator('.st-at')).toContainText('Chapter 2 of 4');
    expect((await runs(page))[0]!.state).toEqual({ at: 'running', chapter: 1 });
    await answerEach(page, 'THE SYSTEM IS WATCHING THE NUMBERS', names.length + 1);
  });

  await test.step('chapter 4 from "⋯" (⋯, Open a chapter…, 4, Open): the card says it is the last and End story is its button, 1 tap', async () => {
    t.reset();
    await t.tap(card(page).locator('[data-st-more]'));
    await t.tap(page.locator('.sys-overlay.show .sys-actions button', { hasText: 'Open a chapter…' }));
    await t.tap(win.locator('[data-st-ch="3"]'));
    await t.tap(win.locator('[data-st-go]', { hasText: 'Open chapter 4' }));
    expect(t.count).toBe(4);
    await answerEach(page, 'THE HOUSE KEEPS THE STAKE', names.length + 1);
    await expect(card(page).locator('.st-next')).toHaveText('Chapter 4 is the last.');
    t.reset();
    await t.tap(card(page).locator('[data-st-end]'));
    expect(t.count).toBe(1);
    await expect(card(page)).toHaveCount(0);
    expect((await runs(page))[0]!.state).toMatchObject({ at: 'ended', chapter: 3 });
  });
});

test('from the Workshop, Turn on… opens the story at its own step: on for one hunter in 3 taps; its row then says running, and Delete says to end it first', async ({ device }) => {
  const page = (await device('gm')).page, t = tapCounter();
  await setup(page);
  await go(page, 'workshop');
  const row = page.locator('#view-workshop [data-ws="story"] li[data-id]:not([data-example])', { hasText: 'The wager' }), win = storyWin(page);

  await test.step('Turn on…, Brakk, Turn on and open chapter 1', async () => {
    await t.tap(row.getByRole('button', { name: 'Turn on The wager' }));
    await expect(win.getByRole('heading', { name: 'Turn on The wager' })).toBeVisible();
    await t.tap(win.locator('[data-st-who]', { hasText: 'Brakk Ironhide' }));
    await t.tap(win.locator('[data-st-go]'));
    expect(t.count).toBe(3);
    await answerWindow(page, 'THE SYSTEM WILL TAKE THAT BET');
    await expect(row.locator('.tag')).toHaveText('running');
  });

  await test.step('Delete on a running story says to end it in the GM view, and the story stays', async () => {
    await row.locator('[data-act="more"]').tap();
    await page.locator('.sys-overlay.show .sys-actions button', { hasText: 'Delete' }).tap();
    await expect(page.locator('#toasts .toast', { hasText: 'End The wager in the GM view before you delete it.' })).toBeVisible();
    expect(await page.evaluate(() => hunterApp.store.get().library.stories.length)).toBe(1);
  });
});
