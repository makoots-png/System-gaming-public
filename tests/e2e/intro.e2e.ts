import type { Page } from '@playwright/test';
import { test, expect, onboardGM, onboardPlayer, createRoom, dismissAll, go, answerWindow } from './helpers.ts';
import { WORLD_PRIMER } from '../../src/core/first-run.ts';
import { INTRO_CARDS, INTRO_CITIES, INTRO_FOOD_ITEMS, introCardCounter } from '../../src/core/intro-cards.ts';
import { newRewards } from '../../src/core/rewards.ts';

const OVERLAY = '.intro-overlay.show';
const REJOIN = '#intro-rejoin';

/** Asserts that `page` contains NO read-aloud WORLD_PRIMER paragraph text anywhere in visible DOM. */
async function assertNoPrimerParagraphOnPlayer(page: Page): Promise<void> {
  const text = await page.locator('body').innerText();
  for (const para of WORLD_PRIMER) {
    // Check both the full paragraph and its opening 28 characters (covers short final paragraph too).
    expect(text.includes(para), `player page must never contain primer paragraph: ${para.slice(0, 32)}`).toBe(false);
    expect(text.includes(para.slice(0, 28)), `player page must never contain primer opening: ${para.slice(0, 28)}`).toBe(false);
  }
}

test('solo replay steps through all 17 cards from Quick start, shows window details and captions, and respects reduced motion', async ({ device }) => {
  const solo = (await device('solo', { blockServiceWorker: true })).page;
  await solo.emulateMedia({ reducedMotion: 'reduce' });
  await onboardPlayer(solo, 'Solo Reader');

  await solo.locator('#help-btn').tap();
  const guide = solo.locator('.ob-overlay', { has: solo.locator('h2', { hasText: 'How it works' }) });
  await expect(guide.locator('[data-primer] summary')).toHaveText('Read aloud: World primer');
  const playBtn = guide.locator('[data-intro-solo]');
  await expect(playBtn).toHaveText('Play intro cards');
  await playBtn.tap();

  const ov = solo.locator(OVERLAY);
  await expect(ov).toBeVisible();
  await expect(ov.locator('[data-intro-count]')).toHaveText('Title');
  await expect(ov.locator('[data-intro-back]')).toBeDisabled();
  await expect(ov.locator('[data-intro-caption]')).toHaveCount(0);
  await expect(ov.locator('.sys-window .sys-title')).toHaveText('The Hunter System');
  await expect(ov.locator('img')).toHaveCount(0);

  // Advance through all 17 cards, checking Back once and verifying key Window/Type cards & captions.
  for (let i = 0; i < INTRO_CARDS.length; i++) {
    const card = INTRO_CARDS[i]!;
    await expect(ov.locator('[data-intro-stage]')).toHaveAttribute('data-intro-card', String(i));
    await expect(ov.locator('[data-intro-count]')).toHaveText(introCardCounter(i));
    await expect(ov.locator('[role="img"]')).toHaveAttribute('aria-label', card.alt);

    if (i === 1) {
      await expect(ov.locator('[data-intro-stage]')).toContainText('London');
      await expect(ov.locator('[data-intro-caption]')).toContainText('About twenty years ago');
      // Verify Back returns to Title and advancing goes back to Card 1
      await ov.locator('[data-intro-back]').tap();
      await expect(ov.locator('[data-intro-stage]')).toHaveAttribute('data-intro-card', '0');
      await ov.locator('[data-intro-stage]').tap();
      await expect(ov.locator('[data-intro-stage]')).toHaveAttribute('data-intro-card', '1');
    } else if (i === 5) {
      await expect(ov.locator('[data-intro-cities] li')).toHaveText([...INTRO_CITIES]);
      // Under reduced motion all 5 rows are immediately visible at opacity 1
      const opacities = await ov.locator('[data-intro-cities] li').evaluateAll(els => els.map(el => getComputedStyle(el).opacity));
      expect(opacities).toEqual(['1', '1', '1', '1', '1']);
    } else if (i === 9) {
      await expect(ov).toContainText('Gate ranks');
      await expect(ov).toContainText('Clear: gate closes');
      await expect(ov).toContainText('Break: monsters come out');
    } else if (i === 10) {
      await expect(ov).toContainText('Health Potion (E)');
      await expect(ov).toContainText('Resurrection Crystal (E)');
      await expect(ov).toContainText('35 gold');
      await expect(ov).toContainText('1,000 gold');
    } else if (i === 11) {
      await expect(ov).toContainText('Resident');
      await expect(ov).toContainText('Level 0');
    } else if (i === 12) {
      await expect(ov).toContainText('Hunter');
      await expect(ov).toContainText('1 active');
      await expect(ov).toContainText('Cap');
      await expect(ov).toContainText('9');
    } else if (i === 14) {
      await expect(ov).toContainText('Gold sent');
      for (const food of INTRO_FOOD_ITEMS) await expect(ov).toContainText(food);
    } else if (i === 16) {
      await expect(ov).toContainText('The call');
      await expect(ov.locator('[data-intro-done]')).toHaveText('Done');
      await expect(ov.locator('[data-intro-answer]')).toHaveCount(0);
    }

    if (i < INTRO_CARDS.length - 1) {
      await ov.locator('[data-intro-stage]').tap();
    } else {
      await ov.locator('[data-intro-done]').tap();
    }
  }
  await expect(solo.locator(OVERLAY)).toHaveCount(0);
});

test('GM-paced room intro syncs across players, late join, reload, close/rejoin, second GM tab, Card 16 Answer, End intro, wake lock, and story-card-wins', async ({ device }) => {
  const gmDev = await device('gm', { blockServiceWorker: true });
  const p1Dev = await device('kai', { blockServiceWorker: true });
  const p2Dev = await device('mira', { blockServiceWorker: true, allowConsole: [/ERR_INTERNET_DISCONNECTED/] });
  const gm = gmDev.page, p1 = p1Dev.page, p2 = p2Dev.page;

  // Stub Screen Wake Lock on p1 to verify request on open and re-request on visibility return.
  await p1.addInitScript(() => {
    let calls = 0;
    let released = 0;
    let releaseListeners: (() => void)[] = [];
    (globalThis as any).__wakeStats = () => ({ calls, released });
    (globalThis as any).__dropWakeLock = () => {
      const fns = releaseListeners;
      releaseListeners = [];
      for (const fn of fns) fn();
    };
    Object.defineProperty(navigator, 'wakeLock', {
      configurable: true,
      value: {
        request: async () => {
          calls++;
          return {
            released: false,
            addEventListener(ev: string, fn: () => void) {
              if (ev === 'release') releaseListeners.push(fn);
            },
            release: async () => { released++; },
          };
        },
      },
    });
  });

  await onboardGM(gm);
  const code = await createRoom(gm);
  const gmKey = await gm.evaluate(() => hunterApp.store.get().settings.sync.gmKey as string);

  for (const [page, name] of [[p1, 'Kai'], [p2, 'Mira']] as const) {
    await onboardPlayer(page, name, code);
    await dismissAll(page);
    await expect.poll(() => gm.evaluate(n => hunterApp.api.sync.remoteSheets().some((s: any) => s.data.name === n), name), { timeout: 20_000 }).toBe(true);
  }

  // GM starts intro from the primer drawer in Quick start
  await test.step('GM starts intro from primer drawer and both players open Card 0 with no primer text', async () => {
    await gm.locator('#help-btn').tap();
    const guide = gm.locator('.ob-overlay', { has: gm.locator('h2', { hasText: 'How it works' }) });
    await guide.locator('[data-primer] summary').tap();
    const startBtn = guide.locator('[data-intro-table]');
    await expect(startBtn).toHaveText('Show pictures to the table');
    await startBtn.tap();

    await expect(gm.locator(OVERLAY)).toBeVisible();
    await expect(gm.locator('[data-intro-count]')).toHaveText('Title');
    await expect(gm.locator('[data-intro-thumb]')).toBeVisible();

    for (const p of [p1, p2]) {
      await expect(p.locator(OVERLAY)).toBeVisible({ timeout: 15_000 });
      await expect(p.locator('[data-intro-stage]')).toHaveAttribute('data-intro-card', '0');
      await expect(p.locator('[data-intro-next]')).toHaveCount(0);
      await expect(p.locator('[data-intro-back]')).toHaveCount(0);
      await assertNoPrimerParagraphOnPlayer(p);
    }

    const wake = await p1.evaluate(() => (globalThis as any).__wakeStats());
    expect(wake.calls).toBeGreaterThanOrEqual(1);
  });

  // Double-tap guard on GM Next + Back
  await test.step('GM double-tap advances only one card; GM highlights active slice; Back works immediately', async () => {
    const nextBtn = gm.locator('[data-intro-next]');
    await nextBtn.click();
    await nextBtn.click(); // immediate second click inside 450 ms guard
    await expect(gm.locator('[data-intro-count]')).toHaveText('1 / 16');
    await expect(gm.locator('.intro-hl')).toContainText('About twenty years ago');
    await expect(p1.locator('[data-intro-stage]')).toHaveAttribute('data-intro-card', '1', { timeout: 15_000 });
    await expect(p2.locator('[data-intro-stage]')).toHaveAttribute('data-intro-card', '1', { timeout: 15_000 });
    await assertNoPrimerParagraphOnPlayer(p1);
    await assertNoPrimerParagraphOnPlayer(p2);

    // Back is unguarded and moves back to Title
    await gm.locator('[data-intro-back]').tap();
    await expect(gm.locator('[data-intro-count]')).toHaveText('Title');
    await expect(p1.locator('[data-intro-stage]')).toHaveAttribute('data-intro-card', '0', { timeout: 15_000 });
  });

  // Advance to Card 5 and test late join + player reload + Close & Rejoin
  await test.step('late join, player reload, and Close + Rejoin follow the room card', async () => {
    for (let step = 1; step <= 5; step++) {
      await gm.waitForTimeout(480);
      await gm.locator('[data-intro-next]').tap();
      await expect(gm.locator('[data-intro-count]')).toHaveText(`${step} / 16`);
    }
    await expect(p1.locator('[data-intro-stage]')).toHaveAttribute('data-intro-card', '5', { timeout: 15_000 });
    await expect(p1.locator('[data-intro-cities] li')).toHaveText([...INTRO_CITIES]);
    await assertNoPrimerParagraphOnPlayer(p1);

    // Late join: Player 3 joins while room is on Card 5
    const p3 = (await device('sera', { blockServiceWorker: true })).page;
    await onboardPlayer(p3, 'Sera', code);
    await dismissAll(p3);
    await expect(p3.locator(OVERLAY)).toBeVisible({ timeout: 20_000 });
    await expect(p3.locator('[data-intro-stage]')).toHaveAttribute('data-intro-card', '5', { timeout: 15_000 });
    await assertNoPrimerParagraphOnPlayer(p3);

    // Player 1 reloads and lands back on Card 5
    await p1.reload();
    await p1.waitForFunction(() => window.hunterApp && document.querySelectorAll('#nav-top a').length > 0);
    await expect(p1.locator(OVERLAY)).toBeVisible({ timeout: 20_000 });
    await expect(p1.locator('[data-intro-stage]')).toHaveAttribute('data-intro-card', '5', { timeout: 15_000 });
    await assertNoPrimerParagraphOnPlayer(p1);

    // Player 2 taps Close -> overlay closes on p2 only, rejoin bar appears
    await p2.locator('[data-intro-close]').tap();
    await expect(p2.locator(OVERLAY)).toHaveCount(0);
    await expect(p2.locator(REJOIN)).toBeVisible();
    await expect(p2.locator(REJOIN)).toContainText('Intro in progress');

    // GM moves to Card 6 while p2 is closed; p1 follows; p2 rejoins straight to Card 6
    await gm.waitForTimeout(480);
    await gm.locator('[data-intro-next]').tap();
    await expect(p1.locator('[data-intro-stage]')).toHaveAttribute('data-intro-card', '6', { timeout: 15_000 });
    await expect(p2.locator(OVERLAY)).toHaveCount(0);
    await p2.locator('[data-intro-rejoin]').tap();
    await expect(p2.locator(OVERLAY)).toBeVisible();
    await expect(p2.locator('[data-intro-stage]')).toHaveAttribute('data-intro-card', '6');
    await expect(p2.locator(REJOIN)).toBeHidden();
    await assertNoPrimerParagraphOnPlayer(p2);
  });

  // Second GM tab joins the room with the GM key and controls the intro
  await test.step('second GM tab shows GM view, follows changes, and advances cleanly', async () => {
    const gm2 = (await device('gm2', { blockServiceWorker: true })).page;
    await onboardGM(gm2);
    await gm2.evaluate(async ([c, k]) => {
      await hunterApp.api.sync.rejoinGM(c, k);
    }, [code, gmKey] as const);

    await expect(gm2.locator(OVERLAY)).toBeVisible({ timeout: 20_000 });
    await expect(gm2.locator('[data-intro-count]')).toHaveText('6 / 16', { timeout: 15_000 });

    // Simultaneous Next taps from both GM tabs while showing Card 6 both send absolute Card 7 (last write wins)
    await gm.waitForTimeout(480);
    await Promise.all([gm.locator('[data-intro-next]').click(), gm2.locator('[data-intro-next]').click()]);
    await expect(gm2.locator('[data-intro-count]')).toHaveText('7 / 16', { timeout: 15_000 });
    await expect(gm.locator('[data-intro-count]')).toHaveText('7 / 16', { timeout: 15_000 });
    await expect(p1.locator('[data-intro-stage]')).toHaveAttribute('data-intro-card', '7', { timeout: 15_000 });
    await assertNoPrimerParagraphOnPlayer(p1);
  });

  // Offline / reconnect + visibility return wake-lock re-acquire
  await test.step('player losing connection holds last card and jumps to current card on reconnect; visibility return re-acquires wake lock', async () => {
    await expect(p2.locator('[data-intro-stage]')).toHaveAttribute('data-intro-card', '7', { timeout: 15_000 });
    await p2Dev.ctx.setOffline(true);
    await gm.waitForTimeout(480);
    await gm.locator('[data-intro-next]').tap();
    await expect(gm.locator('[data-intro-count]')).toHaveText('8 / 16');
    await expect(p1.locator('[data-intro-stage]')).toHaveAttribute('data-intro-card', '8', { timeout: 15_000 });
    // Offline p2 stays on card 7 without closing or crashing
    await expect(p2.locator('[data-intro-stage]')).toHaveAttribute('data-intro-card', '7');

    // Reconnect p2 -> jumps directly to card 8
    await p2Dev.ctx.setOffline(false);
    await expect(p2.locator('[data-intro-stage]')).toHaveAttribute('data-intro-card', '8', { timeout: 20_000 });
    await assertNoPrimerParagraphOnPlayer(p2);

    // Returning to foreground re-acquires Screen Wake Lock after browser released it on lock/hide
    const before = await p1.evaluate(() => (globalThis as any).__wakeStats().calls as number);
    await p1.evaluate(() => {
      (globalThis as any).__dropWakeLock();
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await expect.poll(() => p1.evaluate(() => (globalThis as any).__wakeStats().calls as number)).toBeGreaterThan(before);
  });

  // Card 16 Answer on players + GM reload + End intro
  await test.step('Card 16 shows Answer on players, GM lists who answered across reload, and End intro closes all phones', async () => {
    await gm.evaluate(async () => {
      const cur = hunterApp.api.sync.doc('intro');
      if (cur?.intro) await hunterApp.api.sync.setIntro({ intro: { ...cur.intro, card: 16 }, at: new Date().toISOString() });
    });

    await expect(gm.locator('[data-intro-count]')).toHaveText('16 / 16');
    await expect(gm.locator('[data-intro-next]')).toHaveCount(0);
    await expect(gm.locator('[data-intro-end-primary]')).toHaveText('End intro');
    await expect(gm.locator('[data-intro-answered]')).toHaveText('No answers yet.');

    for (const p of [p1, p2]) {
      await expect(p.locator('[data-intro-stage]')).toHaveAttribute('data-intro-card', '16', { timeout: 15_000 });
      await expect(p.locator('[data-intro-answer]')).toHaveText('Answer');
      await assertNoPrimerParagraphOnPlayer(p);
      await p.locator('[data-intro-answer]').tap();
      await expect(p.locator('[data-intro-answer]')).toHaveText('Answered');
      await expect(p.locator('[data-intro-answer]')).toBeDisabled();
    }

    await expect(gm.locator('[data-intro-answered]')).toContainText('Kai', { timeout: 15_000 });
    await expect(gm.locator('[data-intro-answered]')).toContainText('Mira', { timeout: 15_000 });

    // GM reloads on Card 16 -> returns to GM view on Card 16 with answered players intact
    await gm.reload();
    await gm.waitForFunction(() => window.hunterApp && document.querySelectorAll('#nav-top a').length > 0);
    await expect(gm.locator(OVERLAY)).toBeVisible({ timeout: 20_000 });
    await expect(gm.locator('[data-intro-count]')).toHaveText('16 / 16', { timeout: 15_000 });
    await expect(gm.locator('[data-intro-answered]')).toContainText('Kai');
    await expect(gm.locator('[data-intro-answered]')).toContainText('Mira');

    // End intro closes all phones and releases wake lock on p1
    await gm.locator('[data-intro-end-primary]').tap();
    await expect(gm.locator(OVERLAY)).toHaveCount(0);
    await expect(p1.locator(OVERLAY)).toHaveCount(0, { timeout: 15_000 });
    await expect(p2.locator(OVERLAY)).toHaveCount(0, { timeout: 15_000 });
  });

  // Story card wins over an open intro
  await test.step('opening a story chapter closes an open intro with no rejoin bar and shows the chapter window', async () => {
    const STORY = {
      id: 'st1',
      name: 'First Call',
      when: '',
      for: 'table',
      chapters: [
        {
          name: 'Seat Assigned',
          note: '',
          words: { title: 'SEAT ASSIGNED', line: 'Take your place.' },
          rewards: newRewards(),
          quest: null,
        },
      ],
    };
    await gm.evaluate(story => {
      hunterApp.store.update((d: any) => { d.library.stories = [story]; }, 'test-setup');
    }, STORY);

    // Start intro again from GM API and wait for Player 1 to open Card 0
    await gm.evaluate(() => hunterApp.api.intro.startTable());
    await expect(p1.locator(OVERLAY)).toBeVisible({ timeout: 15_000 });

    // Second GM tab opens Stories without ending the intro first, and starts First Call
    const gm3 = (await device('gm3', { blockServiceWorker: true })).page;
    await onboardGM(gm3);
    await gm3.evaluate(story => {
      hunterApp.store.update((d: any) => { d.library.stories = [story]; }, 'test-setup');
    }, STORY);
    await gm3.evaluate(async ([c, k]) => {
      await hunterApp.api.sync.rejoinGM(c, k);
    }, [code, gmKey] as const);
    await expect.poll(() => gm3.evaluate(() => hunterApp.api.sync.remoteSheets().length), { timeout: 20_000 }).toBeGreaterThanOrEqual(2);

    // Trigger story turnOn directly from gm3 while intro is open on gm and p1
    await gm3.evaluate(() => {
      void hunterApp.api.stories.turnOn('st1');
    });
    const stWin = gm3.locator('.st-ov [role="dialog"]');
    await expect(stWin).toBeVisible();
    await stWin.locator('[data-st-go]', { hasText: 'Start and open chapter 1' }).tap();

    // Player 1's intro closes immediately (no rejoin bar) and SEAT ASSIGNED opens unobstructed
    await expect(p1.locator('.sys-overlay.show', { hasText: 'SEAT ASSIGNED' })).toBeVisible({ timeout: 20_000 });
    await expect(p1.locator(OVERLAY)).toHaveCount(0);
    await expect(p1.locator(REJOIN)).toBeHidden();
    await answerWindow(p1, 'SEAT ASSIGNED');

    // _intro doc is cleared to null on the server
    await expect.poll(() => gm.evaluate(() => hunterApp.api.sync.doc('intro')?.intro ?? null), { timeout: 15_000 }).toBeNull();
  });
});
