import type { Page } from '@playwright/test';
import { test, expect, PHONE, onboardGM, onboardPlayer, createRoom, dismissAll, answerWindow } from './helpers.ts';
import { WORLD_PRIMER } from '../../src/core/first-run.ts';
import { INTRO_CARDS, INTRO_CITIES, INTRO_FOOD_ITEMS, introCardCounter, introImagePath } from '../../src/core/intro-cards.ts';
import { INTRO_WRITE_WORDS } from '../../src/core/sync/intro-write.ts';
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

/** Asserts an art card's image inside `root` has the expected `src` and `alt` and finishes loading. */
async function expectArtLoaded(root: ReturnType<Page['locator']>, cardIndex: number): Promise<void> {
  const card = INTRO_CARDS[cardIndex]!;
  const rel = introImagePath(card)!;
  const img = root.locator('[data-intro-img]');
  await expect(img).toHaveCount(1);
  await expect(img).toHaveAttribute('src', rel);
  await expect(img).toHaveAttribute('alt', card.alt);
  await expect.poll(
    () => img.evaluate(el => el instanceof HTMLImageElement && el.complete && el.naturalWidth > 0),
    { timeout: 15_000 },
  ).toBe(true);
  await expect(root.locator('.intro-standin')).toHaveAttribute('data-art-state', 'loaded');
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

  // Advance through all 17 cards, checking Back once and verifying art images, window/type cards, captions, and reduced motion.
  for (let i = 0; i < INTRO_CARDS.length; i++) {
    const card = INTRO_CARDS[i]!;
    await expect(ov.locator('[data-intro-stage]')).toHaveAttribute('data-intro-card', String(i));
    await expect(ov.locator('[data-intro-count]')).toHaveText(introCardCounter(i));
    await expect(ov.locator('[role="img"]')).toHaveAttribute('aria-label', card.alt);

    if (card.kind === 'art') {
      await expectArtLoaded(ov.locator('[data-intro-stage]'), i);
      // Reduced motion: no drift animation and no crossfade ghost layer
      const anim = await ov.locator('[data-intro-img]').evaluate(el => getComputedStyle(el).animationName);
      expect(anim).toBe('none');
      await expect(solo.locator('.m-crossfade')).toHaveCount(0);
    } else {
      await expect(ov.locator('img')).toHaveCount(0);
    }

    if (i === 1) {
      await expect(ov.locator('[data-intro-stage]')).toContainText('London');
      await expect(ov.locator('[data-intro-caption]')).toContainText('About twenty years ago');
      // Verify Back returns to Title and advancing goes back to Card 1
      await ov.locator('[data-intro-back]').tap();
      await expect(ov.locator('[data-intro-stage]')).toHaveAttribute('data-intro-card', '0');
      await ov.locator('[data-intro-stage]').tap();
      await expect(ov.locator('[data-intro-stage]')).toHaveAttribute('data-intro-card', '1');
      await expectArtLoaded(ov.locator('[data-intro-stage]'), 1);
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
    await expectArtLoaded(gm.locator('[data-intro-thumb]'), 1);
    await expect(p1.locator('[data-intro-stage]')).toHaveAttribute('data-intro-card', '1', { timeout: 15_000 });
    await expect(p2.locator('[data-intro-stage]')).toHaveAttribute('data-intro-card', '1', { timeout: 15_000 });
    await expectArtLoaded(p1.locator('[data-intro-stage]'), 1);
    await expectArtLoaded(p2.locator('[data-intro-stage]'), 1);
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

test('art cards preload the next image, fade in over the stand-in, drift under full motion, cut plainly under reduced motion, and stay on stand-in when broken', async ({ device }) => {
  // 1) Preload, delayed fade-in, crossfade, and normal-motion drift (opt back into full motion; config defaults to reduced)
  const normal = (await device('art-motion', { viewport: PHONE, blockServiceWorker: true })).page;
  await normal.emulateMedia({ reducedMotion: 'no-preference' });
  const requested: string[] = [];
  normal.on('request', req => {
    const u = req.url();
    if (u.includes('/intro/primer/')) requested.push(u);
  });

  // Hold Card 2's image briefly so we observe the stand-in first and the fade-in after it arrives.
  let releaseCard2!: () => void;
  const card2Held = new Promise<void>(resolve => { releaseCard2 = resolve; });
  await normal.route('**/intro/primer/p1-teams.webp', async route => {
    await card2Held;
    await route.continue();
  });

  await onboardPlayer(normal, 'Motion Reader');
  await normal.evaluate(() => hunterApp.api.intro.openSolo());
  const ov = normal.locator(OVERLAY);
  await expect(ov.locator('[data-intro-stage]')).toHaveAttribute('data-intro-card', '0');

  // Card 0 preloads Card 1 (p1-london-gate.webp) before Next is tapped
  await expect.poll(() => requested.some(u => u.endsWith('/intro/primer/p1-london-gate.webp')), { timeout: 10_000 }).toBe(true);

  // Advance to Card 1: image loads and runs slow transform drift; Card 2 starts preloading
  await ov.locator('[data-intro-stage]').tap();
  await expect(ov.locator('[data-intro-stage]')).toHaveAttribute('data-intro-card', '1');
  await expectArtLoaded(ov.locator('[data-intro-stage]'), 1);
  await expect.poll(() => requested.some(u => u.endsWith('/intro/primer/p1-teams.webp')), { timeout: 10_000 }).toBe(true);

  const motionProps = await ov.locator('[data-intro-stage]').evaluate(stage => {
    const art = stage.querySelector('[data-intro-art]') as HTMLElement;
    const img = stage.querySelector('[data-intro-img]') as HTMLElement;
    return {
      transitionProperty: getComputedStyle(art).transitionProperty,
      transitionDuration: getComputedStyle(art).transitionDuration,
      animationName: getComputedStyle(img).animationName,
    };
  });
  expect(motionProps.transitionProperty).toBe('opacity');
  expect(parseFloat(motionProps.transitionDuration)).toBeGreaterThan(0);
  expect(motionProps.animationName).toBe('m-intro-drift');

  // Advance to Card 2 while its image is still held: card opens immediately on type-only stand-in
  await ov.locator('[data-intro-stage]').tap();
  await expect(ov.locator('[data-intro-stage]')).toHaveAttribute('data-intro-card', '2');
  await expect(ov.locator('.intro-standin')).toHaveAttribute('data-art-state', 'fallback');
  await expect(ov.locator('.intro-standin-label')).toHaveText('First teams in');
  expect(await ov.locator('[data-intro-art]').evaluate(el => getComputedStyle(el).opacity)).toBe('0');

  // Release Card 2's image: fades in over the stand-in to opacity 1
  releaseCard2();
  await expectArtLoaded(ov.locator('[data-intro-stage]'), 2);
  await expect.poll(() => ov.locator('[data-intro-art]').evaluate(el => getComputedStyle(el).opacity), { timeout: 10_000 }).toBe('1');

  // 2) Broken/missing image stays permanently on the type-only stand-in
  const broken = (await device('art-broken', {
    viewport: PHONE,
    blockServiceWorker: true,
    allowConsole: [/404|Failed to load resource/],
  })).page;
  await broken.route('**/intro/primer/p1-london-gate.webp', route => route.fulfill({ status: 404, body: 'missing' }));
  await onboardPlayer(broken, 'Fallback Reader');
  await broken.evaluate(() => hunterApp.api.intro.openSolo());
  const bov = broken.locator(OVERLAY);
  await bov.locator('[data-intro-stage]').tap();
  await expect(bov.locator('[data-intro-stage]')).toHaveAttribute('data-intro-card', '1');
  await expect(bov.locator('.intro-standin')).toHaveAttribute('data-art-state', 'error', { timeout: 10_000 });
  await expect(bov.locator('.intro-standin-label')).toHaveText('London');
  await expect(bov.locator('.intro-standin-label')).toBeVisible();
  expect(await bov.locator('[data-intro-art]').evaluate(el => getComputedStyle(el).opacity)).toBe('0');

  // 3) Reduced motion uses plain cuts and zero drift
  const reduced = (await device('art-reduced', { viewport: PHONE, blockServiceWorker: true })).page;
  await reduced.emulateMedia({ reducedMotion: 'reduce' });
  await onboardPlayer(reduced, 'Still Reader');
  await reduced.evaluate(() => hunterApp.api.intro.openSolo());
  const rov = reduced.locator(OVERLAY);
  await rov.locator('[data-intro-stage]').tap();
  await expect(rov.locator('[data-intro-stage]')).toHaveAttribute('data-intro-card', '1');
  await expectArtLoaded(rov.locator('[data-intro-stage]'), 1);
  const stillProps = await rov.locator('[data-intro-stage]').evaluate(stage => {
    const art = stage.querySelector('[data-intro-art]') as HTMLElement;
    const img = stage.querySelector('[data-intro-img]') as HTMLElement;
    return {
      transitionDuration: getComputedStyle(art).transitionDuration,
      animationName: getComputedStyle(img).animationName,
      stageAnims: stage.getAnimations().length,
    };
  });
  expect(stillProps.transitionDuration).toBe('0s');
  expect(stillProps.animationName).toBe('none');
  expect(stillProps.stageAnims).toBe(0);
  await expect(reduced.locator('.m-crossfade')).toHaveCount(0);
});

test('390x844 phone view renders full-screen art on player and photo thumbnail above paragraph on GM, capturing screenshots', async ({ device }) => {
  const gm = (await device('u4-gm', { viewport: PHONE, blockServiceWorker: true })).page;
  const player = (await device('u4-player', { viewport: PHONE, blockServiceWorker: true })).page;

  await onboardGM(gm);
  const code = await createRoom(gm);
  await onboardPlayer(player, 'Kai', code);
  await dismissAll(player);
  await expect.poll(() => gm.evaluate(() => hunterApp.api.sync.remoteSheets().some((s: any) => s.data.name === 'Kai')), { timeout: 20_000 }).toBe(true);

  await gm.evaluate(() => hunterApp.api.intro.startTable());
  await expect(gm.locator(OVERLAY)).toBeVisible();
  await expect(player.locator(OVERLAY)).toBeVisible({ timeout: 15_000 });

  // Advance from Title (Card 0) to Card 1 (London, p1-london-gate.webp)
  await gm.locator('[data-intro-next]').tap();
  await expect(gm.locator('[data-intro-count]')).toHaveText('1 / 16');
  await expect(player.locator('[data-intro-stage]')).toHaveAttribute('data-intro-card', '1', { timeout: 15_000 });

  await expectArtLoaded(player.locator('[data-intro-stage]'), 1);
  await expectArtLoaded(gm.locator('[data-intro-thumb]'), 1);
  await expect.poll(() => player.locator('[data-intro-art]').evaluate(el => getComputedStyle(el).opacity), { timeout: 10_000 }).toBe('1');
  await expect.poll(() => gm.locator('[data-intro-thumb] [data-intro-art]').evaluate(el => getComputedStyle(el).opacity), { timeout: 10_000 }).toBe('1');
  await assertNoPrimerParagraphOnPlayer(player);

  // Confirm GM thumbnail sits above the read-aloud paragraph
  const gmBoxes = await gm.evaluate(() => {
    const thumb = document.querySelector('[data-intro-thumb]')?.getBoundingClientRect();
    const read = document.querySelector('[data-intro-read]')?.getBoundingClientRect();
    return thumb && read ? { thumbBottom: thumb.bottom, readTop: read.top } : null;
  });
  expect(gmBoxes).not.toBeNull();
  expect(gmBoxes!.thumbBottom).toBeLessThanOrEqual(gmBoxes!.readTop + 1);

  await player.screenshot({ path: process.env.U4_PLAYER_SHOT || '.lead-scratch/u4-player.png', fullPage: false });
  await gm.screenshot({ path: process.env.U4_GM_SHOT || '.lead-scratch/u4-gm.png', fullPage: false });
});

test('overlapping GM poll started while PUT _intro is in flight and delivered after PUT 200 never flashes the previous card', async ({ device }) => {
  const gm = (await device('gm-stale-poll', { viewport: PHONE, blockServiceWorker: true })).page;
  await onboardGM(gm);
  const code = await createRoom(gm);

  await gm.evaluate(() => hunterApp.api.intro.startTable());
  await expect(gm.locator(OVERLAY)).toBeVisible();
  await expect(gm.locator('[data-intro-count]')).toHaveText('Title');

  let trapActive = false;
  let putInFlight = false;
  let staleGetCaptured = false;
  let staleGetDelivered = false;
  let releaseStaleGet!: () => void;
  const staleGetCanDeliver = new Promise<void>(resolve => { releaseStaleGet = resolve; });

  await gm.route(`**/api/rooms/${code}/sheets/_intro`, async route => {
    if (!trapActive || route.request().method() !== 'PUT') {
      await route.continue();
      return;
    }
    trapActive = false;
    putInFlight = true;
    // Hold the PUT for 1.5 s so a 1 s poll GET fires while the PUT is still out.
    await new Promise(resolve => setTimeout(resolve, 1500));
    const res = await route.fetch();
    await route.fulfill({ response: res });
    putInFlight = false;
  });

  await gm.route(`**/api/rooms/${code}?*`, async route => {
    if (!putInFlight || staleGetCaptured || route.request().method() !== 'GET') {
      await route.continue();
      return;
    }
    staleGetCaptured = true;
    // Fetch the room BEFORE the held PUT lands (so this response carries Card 0 / Title).
    const staleRes = await route.fetch();
    const body = await staleRes.json();
    expect(body.docs?.intro?.data?.intro?.card).toBe(0);
    // Deliver this stale response ONLY AFTER the PUT returns 200 and GM shows 1 / 16.
    await staleGetCanDeliver;
    await route.fulfill({ response: staleRes });
    staleGetDelivered = true;
  });

  // Track every counter value shown after reaching 1 / 16 so even a 1-frame flash back to Title fails.
  await gm.evaluate(() => {
    const seen: string[] = [];
    (globalThis as any).__afterCard1Counts = seen;
    let reached = false;
    const record = () => {
      const text = document.querySelector('[data-intro-count]')?.textContent?.trim() ?? '';
      if (text === '1 / 16') reached = true;
      if (reached && text) seen.push(text);
    };
    const obs = new MutationObserver(record);
    obs.observe(document.body, { subtree: true, childList: true, characterData: true });
  });

  trapActive = true;
  await gm.locator('[data-intro-next]').tap();

  // Wait for the overlapping GET to be captured while PUT is held, and for the PUT to land.
  await expect.poll(() => staleGetCaptured, { timeout: 10_000 }).toBe(true);
  await expect(gm.locator('[data-intro-count]')).toHaveText('1 / 16', { timeout: 10_000 });

  // Now deliver the stale GET (carrying Card 0) AFTER the PUT returned 200.
  releaseStaleGet();
  await expect.poll(() => staleGetDelivered, { timeout: 10_000 }).toBe(true);
  await gm.waitForTimeout(300);

  await expect(gm.locator('[data-intro-count]')).toHaveText('1 / 16');
  const seenAfter = await gm.evaluate(() => (globalThis as any).__afterCard1Counts as string[]);
  expect(seenAfter.length).toBeGreaterThan(0);
  expect(seenAfter.every(t => t === '1 / 16')).toBe(true);
});

test('offline GM tapping Next sees a warning toast and stays on the room card, then advances players once back online', async ({ device }) => {
  const gmDev = await device('gm-offline', {
    viewport: PHONE,
    blockServiceWorker: true,
    allowConsole: [/ERR_INTERNET_DISCONNECTED|Failed to load resource/],
  });
  const pDev = await device('player-follow-retry', { viewport: PHONE, blockServiceWorker: true });
  const gm = gmDev.page, player = pDev.page;

  await onboardGM(gm);
  const code = await createRoom(gm);
  await onboardPlayer(player, 'Kai', code);
  await dismissAll(player);
  await expect.poll(() => gm.evaluate(() => hunterApp.api.sync.remoteSheets().some((s: any) => s.data.name === 'Kai')), { timeout: 20_000 }).toBe(true);

  await gm.evaluate(() => hunterApp.api.intro.startTable());
  await expect(gm.locator(OVERLAY)).toBeVisible();
  await expect(gm.locator('[data-intro-count]')).toHaveText('Title');
  await expect(player.locator(OVERLAY)).toBeVisible({ timeout: 15_000 });
  await expect(player.locator('[data-intro-stage]')).toHaveAttribute('data-intro-card', '0');

  // Go offline on GM, tap Next -> retries exhaust, warning toast shows, counter stays on Title.
  await gmDev.ctx.setOffline(true);
  await gm.locator('[data-intro-next]').tap();

  const toast = gm.locator('.toast.toast-warning');
  await expect(toast).toBeVisible({ timeout: 15_000 });
  await expect(toast).toContainText(INTRO_WRITE_WORDS.failedToast);
  await expect(gm.locator('[data-intro-count]')).toHaveText('Title');
  await expect(player.locator('[data-intro-stage]')).toHaveAttribute('data-intro-card', '0');

  // Go back online, tap Next -> GM advances and player follows to Card 1.
  await gmDev.ctx.setOffline(false);
  await gm.locator('[data-intro-next]').tap();
  await expect(gm.locator('[data-intro-count]')).toHaveText('1 / 16', { timeout: 15_000 });
  await expect(player.locator('[data-intro-stage]')).toHaveAttribute('data-intro-card', '1', { timeout: 15_000 });
  await expectArtLoaded(player.locator('[data-intro-stage]'), 1);
});
