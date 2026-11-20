// In a fight the fight's row holds a hunter's HP, mana, fatigue and statuses, and the sheet hears of them through the
// fight's `vitals`. These are the writers that wrote the sheet beside a running fight: a reward's status, a level-up's
// refill and Revive. Each now reaches the row, so the next `vitals` keeps what the GM gave.
import type { Page } from '@playwright/test';
import { test, expect, onboardGM, go, startGoblinDenFight, dismissAll, fightRow, chooseList } from './helpers.ts';

const combat = (page: Page) => page.locator('#view-combat');
const activeName = (page: Page) => page.evaluate(() => hunterApp.store.active().name as string);
const sheetHp = (page: Page) => page.evaluate(() => hunterApp.api.hunter.sheet(hunterApp.store.active()).hp as number);
const sheetStatuses = (page: Page) => page.evaluate(() => hunterApp.store.active().conditions.map((c: any) => c.key) as string[]);
const rowStatuses = async (page: Page, name: string) => ((await fightRow(page, name)).statuses as { key: string }[]).map(s => s.key);

async function gmFight(page: Page) {
  await onboardGM(page);
  await chooseList(page);
  await startGoblinDenFight(page);
  return activeName(page);
}

/** The GM's Award form, opened; `fill` adds the reward's parts; the reward goes to hunter `name` on this phone. */
async function award(page: Page, name: string, fill: () => Promise<void>) {
  await go(page, 'gm');
  const toggle = page.locator('[data-tog="award"]');
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.tap();
  await fill();
  await page.locator('#gm-targets label', { hasText: name }).locator('input').check();
  await page.locator('#gm-award-go').tap();
  await dismissAll(page, 4);
}

/** The GM's −5 on the active hunter's own sheet: in a fight it goes to the row, and the fight answers with `vitals`. */
async function minusFive(page: Page) {
  await go(page, 'status');
  await page.locator('#view-status [data-hp="-5"]').first().tap();
}

test('a status the GM awards to a hunter in the fight shows on the fight\'s card, and the sheet keeps it after the fight next changes that hunter', async ({ device }) => {
  const page = (await device('gm')).page;
  const name = await gmFight(page);

  await test.step('the GM awards Hasted to the hunter from the Award form, and the fight\'s row holds it', async () => {
    await award(page, name, async () => {
      const ed = page.locator('#gm-rw');
      await ed.locator('[data-add="status"]').tap();
      await ed.locator('[data-kind="status"] [data-f="key"]').selectOption({ label: 'Hasted' });
    });
    await expect.poll(() => rowStatuses(page, name)).toContain('hasted');
  });

  await test.step('after the GM\'s −5 on the sheet, the sheet still shows Hasted', async () => {
    const before = (await fightRow(page, name)).hp;
    await minusFive(page);
    await expect.poll(async () => (await fightRow(page, name)).hp).toBe(before - 5);
    expect(await sheetStatuses(page)).toContain('hasted');
    await expect(page.locator('#view-status [data-chips]')).toContainText('Hasted');
  });
});

test('a hunter in the fight who levels up from an award is back to full HP on the fight\'s card, and the sheet reads the same', async ({ device }) => {
  const page = (await device('gm')).page;
  const name = await gmFight(page);
  const max = (await fightRow(page, name)).sheet.hpMax as number;

  await test.step('the GM\'s −5 on the sheet takes 5 from the row', async () => {
    await minusFive(page);
    await expect.poll(async () => (await fightRow(page, name)).hp).toBe(max - 5);
  });

  await test.step('an award of 1,000 XP raises the level, and the row is at its full HP', async () => {
    const level = await page.evaluate(() => hunterApp.store.active().level as number);
    await award(page, name, () => page.fill('#gm-xp', '1000'));
    await expect.poll(() => page.evaluate(() => hunterApp.store.active().level as number)).toBeGreaterThan(level);
    await expect.poll(async () => (await fightRow(page, name)).hp).toBe(max);
    await go(page, 'combat');
    await expect(combat(page).locator('.cmb-row', { hasText: name }).locator('.cmb-mini')).toContainText(`${max}/${max}`);
    expect(await sheetHp(page)).toBe(max);
  });
});

test('a dead hunter in the fight whom the GM revives from the sheet stands at 1 HP on the fight\'s card, and stays up when the fight next changes him', async ({ device }) => {
  const page = (await device('gm')).page;
  const name = await gmFight(page);
  await page.evaluate(n => hunterApp.store.update((d: any) => {
    const h = d.hunters.find((x: any) => x.name === n); h.life = { at: 'dead' };
    d.fight.rows.find((r: any) => r.name === n).life = { at: 'dead' };
  }, 'test-setup'), name);

  await test.step('the GM taps Revive on the sheet, and the fight\'s row stands at 1 HP', async () => {
    await go(page, 'status');
    await page.locator('#view-status [data-revive]').tap();
    await expect.poll(async () => (await fightRow(page, name)).hp).toBe(1);
    expect(await page.evaluate(() => hunterApp.store.active().life)).toEqual({ at: 'up', hp: 1 });
  });

  await test.step('a status the GM adds on the sheet goes to the row, and the hunter is still up at 1 HP', async () => {
    await page.locator('#view-status [data-cond-sel]').selectOption({ label: 'Hasted' });
    await page.locator('#view-status [data-cond-add]').tap();
    await expect.poll(() => rowStatuses(page, name)).toContain('hasted');
    expect(await page.evaluate(() => hunterApp.store.active().life)).toEqual({ at: 'up', hp: 1 });
    expect(await sheetHp(page)).toBe(1);
  });
});
