import type { Page } from '@playwright/test';
import { test, expect, setupGoblinDenGM, go, startGoblinDenFight, chooseList, PHONE } from './helpers.ts';
import { ODDS_RUNS, ODDS_WORDS } from '../../src/core/combat/odds.ts';

const odds = (page: Page) => page.locator('#view-combat [data-odds]');
/** What the odds may not touch: the fight, the outbox, the log and the hunters, as the save holds them. */
const kept = (page: Page) => page.evaluate(() => {
  const s = hunterApp.store.get();
  return JSON.stringify({ fight: s.fight, outbox: s.settings.sync.outbox, log: s.log, hunters: s.hunters });
});

/** The GM's fight in setup (tests/e2e/look.e2e.ts builds the same): the starter party and two of the bestiary's first monster, added through the builder. */
async function buildFight(page: Page) {
  await setupGoblinDenGM(page);
  await go(page, 'combat');
  await page.locator('#view-combat [data-addparty]').tap();
  await page.locator('#view-combat [data-mcount]').fill('2');
  await page.locator('#view-combat [data-addm]').tap();
  await expect(page.locator('#view-combat [data-start]')).toBeEnabled();
}

test('the GM building a fight plays it out 100 times, sees the count as it goes, reads the party\'s odds and their detail, and the odds are marked stale when the fight changes', async ({ device }) => {
  const page = (await device('gm', { viewport: PHONE })).page;
  await buildFight(page);
  const before = await kept(page);

  await test.step('the control says what it does, and asking shows the count as it plays', async () => {
    const ask = odds(page).locator('[data-odds-ask]');
    await expect(ask).toHaveText(ODDS_WORDS.ask);
    await ask.tap();
    await expect(odds(page).locator('[data-oddsprog]')).toContainText(new RegExp(ODDS_WORDS.running(0, ODDS_RUNS).replace('0', '\\d+')));
  });

  await test.step('the answer is one line with the party\'s chance, who goes down most and the rounds', async () => {
    const line = odds(page).locator('[data-oddsline]');
    await expect(line).toHaveText(/^The party wins \d+% of 100 fights\. (.+ is most likely to die \(\d+%\)|Nobody died)\.? About \d+ rounds\.$/, { timeout: 60_000 });
    expect(await kept(page), 'playing the odds changed nothing in the save').toBe(before);
  });

  await test.step('the line opens its detail: the rounds and each hunter\'s end', async () => {
    await odds(page).locator('[data-oddsline]').tap();
    await expect(odds(page)).toContainText(/Rounds: .*most often about \d+\./);
    await expect(odds(page)).toContainText(/Brakk Ironhide: .*Ends with .* HP/);
  });

  await test.step('adding a monster marks the odds stale; playing again answers for the fight as it is', async () => {
    await page.locator('#view-combat [data-mcount]').fill('1');
    await page.locator('#view-combat [data-addm]').tap();
    await expect(odds(page).locator('.odds-stale')).toHaveText(ODDS_WORDS.stale);
    await odds(page).locator('[data-odds-ask]').tap();
    await expect(odds(page).locator('[data-oddsline]')).toHaveText(/^The party wins \d+% of 100 fights\./, { timeout: 60_000 });
    await expect(odds(page).locator('.odds-stale')).toHaveCount(0);
  });
});

test('the GM stops a run of the odds and the control comes back', async ({ device }) => {
  const page = (await device('gm', { viewport: PHONE })).page;
  await buildFight(page);
  await odds(page).locator('[data-odds-ask]').tap();
  await odds(page).locator('[data-odds-stop]').tap();
  await expect(odds(page).locator('[data-odds-ask]')).toHaveText(ODDS_WORDS.ask);
  await expect(odds(page).locator('[data-oddsline]')).toHaveCount(0);
});

test('while a fight runs on the map, the Fight tools play it out from where it stands', async ({ device }) => {
  const page = (await device('gm', { viewport: PHONE })).page;
  await setupGoblinDenGM(page);
  await chooseList(page);
  await startGoblinDenFight(page);
  await page.locator('#view-combat [data-fview="map"]').tap();
  await page.locator('#view-combat [data-tools-open]').tap();
  const ask = page.locator('#view-combat [data-tools] [data-odds-ask]');
  await expect(ask).toBeVisible();
  await ask.tap();
  await expect(page.locator('#view-combat [data-tools] [data-oddsline]')).toHaveText(/^The party wins \d+% of 100 fights\./, { timeout: 60_000 });
});
