// The story maker (src/views/story-maker.js) holds each chapter whole, open or folded, and checks every chapter at Save
// (src/core/draft.ts `storyProblem`): a chapter quest's "If it fails" cost survives a fold and a Save, and a folded
// chapter's Job Change quest with no job is refused with that chapter opened. One GM phone.
import type { Page } from '@playwright/test';
import { test, expect, onboardGM, go } from './helpers.ts';
import { newRewards } from '../../src/core/rewards.ts';

const maker = (page: Page) => page.locator('.stm-overlay [role=dialog]');
const quest = (page: Page) => maker(page).locator('[data-stm-q]');
const stories = (page: Page) => page.evaluate(() => hunterApp.store.get().library.stories);

/** The Workshop's New story, its name typed and chapter 1's window title. */
async function newStory(page: Page, name: string, title: string): Promise<void> {
  await go(page, 'workshop');
  await page.locator('#view-workshop [data-ws="story"] [data-new]').tap();
  await maker(page).locator('#stm-name').fill(name);
  await maker(page).locator('#stm-wtitle').fill(title);
}

test('a chapter quest\'s "If it fails" cost of -50 gold stays with it when its chapter folds, is saved with the chapter folded, and Edit shows it', async ({ device }) => {
  const page = (await device('gm')).page;
  await onboardGM(page);
  await newStory(page, 'The debt', 'The deep asks for a gate');

  await test.step('chapter 1 issues a quest that costs 50 gold if it fails; a second chapter folds it', async () => {
    await maker(page).locator('#stm-hasq').check();
    await quest(page).locator('[name=title]').fill('Clear a gate for the Deep');
    await quest(page).locator('#stq-fail-gold').fill('-50');
    await maker(page).locator('[data-chadd]').tap();
    await expect(maker(page).locator('[data-ch]')).toHaveCount(2);
    await maker(page).locator('#stm-wtitle').fill('The debt is paid');
  });

  await test.step('chapter 1 opened again shows -50 under "If it fails"', async () => {
    await maker(page).locator('[data-chopen="0"]').tap();
    await expect(quest(page).locator('#stq-fail-gold')).toHaveValue('-50');
    await maker(page).locator('[data-chopen="1"]').tap();
    await expect(maker(page).locator('[data-chopen="0"]')).toHaveAttribute('aria-expanded', 'false');
  });

  await test.step('Save with chapter 1 folded keeps the cost', async () => {
    await maker(page).getByRole('button', { name: 'Save story' }).tap();
    await expect(maker(page)).toHaveCount(0);
    const [s] = await stories(page);
    expect(s.chapters[0].quest.onFail).toEqual({ ...newRewards(), gold: -50 });
  });

  await test.step('Edit opens chapter 1 with -50 under "If it fails", and saving unchanged keeps it', async () => {
    await page.locator('#view-workshop [data-ws="story"]').getByRole('button', { name: 'Edit The debt' }).tap();
    await expect(quest(page).locator('#stq-fail-gold')).toHaveValue('-50');
    await maker(page).getByRole('button', { name: 'Save story' }).tap();
    await expect(maker(page)).toHaveCount(0);
    const [s] = await stories(page);
    expect(s.chapters[0].quest.onFail.gold).toBe(-50);
  });
});

test('a folded chapter\'s Job Change quest with no job is refused at Save: the maker opens that chapter and says to choose a job, and saves once one is named', async ({ device }) => {
  const page = (await device('gm')).page;
  await onboardGM(page);
  await newStory(page, 'The new path', 'A path opens');

  await test.step('chapter 1 issues a Job Change quest and names no job; chapter 2 is added, which folds chapter 1', async () => {
    await maker(page).locator('#stm-hasq').check();
    await quest(page).locator('[name=kind]').selectOption('job');
    await quest(page).locator('[name=title]').fill('Walk the new path');
    await maker(page).locator('[data-chadd]').tap();
    await maker(page).locator('#stm-wtitle').fill('The path closes');
    await expect(maker(page).locator('[data-chopen="0"]')).toHaveAttribute('aria-expanded', 'false');
  });

  await test.step('Save is refused: chapter 1 opens with its quest, the maker says to choose a job, and nothing is saved', async () => {
    await maker(page).getByRole('button', { name: 'Save story' }).tap();
    await expect(maker(page).locator('.mk-err')).toHaveText('Choose a job for chapter 1\'s job quest.');
    await expect(maker(page).locator('[data-chopen="0"]')).toHaveAttribute('aria-expanded', 'true');
    await expect(quest(page).locator('[name=title]')).toHaveValue('Walk the new path');
    expect(await stories(page)).toEqual([]);
  });

  await test.step('with Necromancer named as the job, Save keeps the story and the job', async () => {
    await quest(page).locator('[data-rweditor] [data-rw-job]').fill('Necromancer');
    await maker(page).getByRole('button', { name: 'Save story' }).tap();
    await expect(maker(page)).toHaveCount(0);
    const [s] = await stories(page);
    expect([s.chapters[0].quest.kind, s.chapters[0].quest.rewards.job]).toEqual(['job', 'Necromancer']);
  });
});
