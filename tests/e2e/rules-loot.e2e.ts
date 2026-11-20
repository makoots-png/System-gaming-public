import { test, expect, onboardGM, go, dismissAll, PHONE } from './helpers.ts';
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
