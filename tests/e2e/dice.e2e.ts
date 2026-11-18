// The Dice view's typed roll (src/views/dice.js): Roll20 text read by parseFormula and rolled with its faces by
// rollFormula. The tray reads the page's Math.random at each die, so a test fixes the faces: a face f of a dS is
// 1 + floor(r x S), so r = (f - 0.5) / S shows f.
import type { Page } from '@playwright/test';
import { test, expect, onboardPlayer, dismissAll, go, save } from './helpers.ts';

/** Types `text` in the Dice view's field and rolls it while the dice show `faces` (each a face of a d`sides`), in order. */
async function typed(page: Page, text: string, faces: number[], sides: number): Promise<void> {
  const field = page.locator('#view-dice [data-expr]');
  await field.fill(text);
  await page.evaluate(([fs, s]) => {
    const rs = (fs as number[]).map(f => (f - 0.5) / (s as number));
    (window as any).__r = Math.random; Math.random = () => rs.shift() ?? 0.5;
  }, [faces, sides]);
  try { await page.locator('#view-dice [data-go]').tap(); } finally { await page.evaluate(() => { Math.random = (window as any).__r; }); }
}
const last = (page: Page) => save(page).then(s => s.rolls[0]);
const detail = (page: Page) => page.locator('#view-dice [data-roller] [data-detail]');

test.describe('a roll typed the Roll20 way', () => {
  let p: Page;
  test.beforeEach(async ({ device }) => {
    p = (await device('dice')).page;
    await onboardPlayer(p, 'Kai Test');
    await dismissAll(p);
    await go(p, 'dice');
  });

  test('/r d20+4 rolls one d20 and adds 4', async () => {
    await typed(p, '/r d20+4', [15], 20);
    await expect.poll(() => last(p).then(r => [r.expr, r.total, r.rolls])).toEqual(['1d20 + 4', 19, [15]]);
    await expect(p.locator('#view-dice [data-roller] [data-total]')).toHaveText('19');
    await expect(detail(p)).toContainText('1d20 + 4 [15]');
  });

  test('/r 2d20kh1 keeps the higher d20 and strikes the other', async () => {
    await typed(p, '/r 2d20kh1', [7, 16], 20);
    await expect.poll(() => last(p).then(r => [r.total, r.natural])).toEqual([16, 16]);
    await expect(detail(p).locator('s')).toHaveText(['7']);
  });

  test('/r 10d20kh4 keeps the four highest of ten and strikes the six others', async () => {
    await typed(p, '/r 10d20kh4', [3, 18, 1, 9, 12, 20, 5, 14, 7, 2], 20);
    // kept 20, 18, 14 and 12
    await expect.poll(() => last(p).then(r => r.total)).toBe(64);
    await expect(detail(p).locator('s')).toHaveText(['3', '1', '9', '5', '7', '2']);
  });

  test('a bad formula says what is wrong under the field as it is typed, and rolls nothing', async () => {
    const before = (await save(p)).rolls.length;
    await p.locator('#view-dice [data-expr]').fill('/r 2d20kh3');
    await expect(p.locator('#view-dice [data-roller] [data-err]')).not.toBeEmpty();
    await p.locator('#view-dice [data-expr]').fill('/r 2d20kh1');
    await expect(p.locator('#view-dice [data-roller] [data-err]')).toBeEmpty();
    await p.locator('#view-dice [data-expr]').fill('/r 2d20kh3');
    await p.locator('#view-dice [data-go]').tap();
    await expect(p.locator('#view-dice [data-roller] [data-err]')).not.toBeEmpty();
    expect((await save(p)).rolls.length).toBe(before);
  });

  test('the last typed rolls stay on the device, and a tap rolls one again', async () => {
    await typed(p, '/r d20+4', [10], 20);
    await typed(p, '/r 2d6', [3, 4], 6);
    const recent = p.locator('#view-dice [data-recent] button');
    await expect(recent).toHaveText(['/r 2d6', '/r d20+4']);
    const n = (await save(p)).rolls.length;
    await recent.filter({ hasText: '/r d20+4' }).tap();
    await expect.poll(() => save(p).then(s => [s.rolls.length, s.rolls[0].expr])).toEqual([n + 1, '1d20 + 4']);
    await expect(recent).toHaveText(['/r d20+4', '/r 2d6']);
  });
});
