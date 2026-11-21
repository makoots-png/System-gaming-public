import type { Page } from '@playwright/test';
import { test, expect, onboardGM, go, dismissAll, answerWindow, chooseList, fightRow, PHONE } from './helpers.ts';
import { saleRows } from '../../src/core/rules-text.ts';
import { RULES } from '../../src/core/rules.ts';

for (const width of [PHONE.width, 320]) {
  test(`on a ${width} px phone the Loot and rarity sale table shows all four columns whole, and Sells for is the core's number`, async ({ device }) => {
    const p = (await device('rules-loot', { viewport: { width, height: 844 } })).page;
    await onboardGM(p);
    await dismissAll(p);
    await go(p, 'rules');
    const wrap = p.locator('#rr-loot .rr-tw').first();
    await wrap.scrollIntoViewIfNeeded();

    await test.step('the table fits its column with no sideways scroll', async () => {
      const w = await wrap.evaluate(el => ({ scroll: el.scrollWidth, client: el.clientWidth }));
      expect(w.scroll).toBeLessThanOrEqual(w.client);
      await p.screenshot({ path: `/tmp/rules-loot-${width}.png` });
    });

    await test.step('the Common row pays what saleRows gives, the number sellPrice pays for an unpriced Common item', async () => {
      const common = saleRows(RULES).find(r => r.rar === 'common')!;
      const cells = wrap.locator('tbody tr').first().locator('td');
      await expect(cells.last()).toHaveText(common.sell.toLocaleString('en-US'));
    });
  });
}

/** A monster of the bestiary that drops `gold` and nothing else. */
const looter = (id: string, name: string, gold: number) => ({ id, name, rank: 'E', type: '', archetype: 'brute', kind: 'normal', tweak: {}, abilities: [], notes: [], xp: 40, extractable: false, desc: '', statuses: [], loot: { gold, items: [] } });

/** Taps `label` in the System window that offers it, tapping past any window before it that does not. */
async function chooseInWindow(page: Page, label: string) {
  const wanted = page.locator('.sys-overlay.show .sys-actions button', { hasText: label }).first();
  const other = page.locator('.sys-overlay.show', { hasNot: page.locator('.sys-actions button', { hasText: label }) }).locator('.sys-actions button.primary').first();
  await expect.poll(async () => {
    if (await wanted.isVisible()) return true;
    if (await other.isVisible()) await other.tap();
    return false;
  }, { message: `System window button "${label}"` }).toBe(true);
  await wanted.tap();
}

/** Brakk fights monster `mid` alone, defeats it, and the GM ends the fight without XP. */
async function fightAndEnd(page: Page, mid: string, name: string) {
  const combat = page.locator('#view-combat');
  const tap = async (selector: string) => { const t = combat.locator(selector).first(); await t.evaluate((el: any) => el.scrollIntoView({ block: 'center' })); await t.tap(); };
  await go(page, 'bestiary');
  await page.locator(`#view-bestiary [data-addc="${mid}"]`).tap();
  await go(page, 'combat');
  await combat.locator('[data-hsel]').selectOption({ label: 'Brakk Ironhide' });
  await tap('[data-addh]');
  await tap(`.cmb-row:has-text("${name}") .cmb-pick`);
  await tap('.cmb-card [data-defeat]');
  await expect.poll(async () => (await fightRow(page, name)).hp).toBe(0);
  await tap('[data-end]');
  await chooseInWindow(page, 'End without XP');
}

const goldWaiting = (page: Page) => page.evaluate(() => { const l = hunterApp.store.get().loot; return l.at === 'waiting' ? l.drops.map((d: any) => d.gold) : []; });

test('loot put off with Later survives the next fight: the Loot dropped window offers the first fight\'s 75 gold, then the second\'s 40, and Award loot opens the one it offered', async ({ device }) => {
  const page = (await device('gm')).page;
  await onboardGM(page);
  await chooseList(page);
  await page.evaluate(([a, b]) => hunterApp.store.update((d: any) => { d.monsters.push(a, b); }, 'test-setup'), [looter('m900', 'Hoard Rat', 75), looter('m901', 'Ember Rat', 40)] as const);

  await test.step('the first fight\'s 75 gold is put off with Later', async () => {
    await fightAndEnd(page, 'm900', 'Hoard Rat');
    await answerWindow(page, 'Loot dropped', 'Later');
    expect(await goldWaiting(page)).toEqual([75]);
  });

  await test.step('after the second fight both wait, and the window offers the older 75 gold and says one more fight\'s loot waits', async () => {
    await fightAndEnd(page, 'm901', 'Ember Rat');
    const win = page.locator('.sys-overlay.show', { hasText: 'Loot dropped' });
    await expect(win).toContainText('75 gold');
    await expect(win).toContainText('The loot of 1 more fight waits after it.');
    expect(await goldWaiting(page)).toEqual([75, 40]);
  });

  await test.step('Set aside deals the 75 gold alone, and the window offers the 40 gold next', async () => {
    const win = page.locator('.sys-overlay.show', { hasText: 'Loot dropped' });
    await win.locator('.sys-actions button', { hasText: 'Set aside' }).tap();
    await expect(win).toContainText('40 gold');
    await expect(win).not.toContainText('more fight');
    expect(await goldWaiting(page)).toEqual([40]);
  });

  await test.step('Award loot opens the Award form with the 40 gold, and its line names the loot it holds', async () => {
    await answerWindow(page, 'Loot dropped', 'Award loot');
    await expect(page.locator('#gm-gold')).toHaveValue('40');
    await expect(page.locator('#gm-award-tie')).toHaveText('Fight loot: 40 gold. Send award gives it; fold Award to keep it for later.');
  });
});
