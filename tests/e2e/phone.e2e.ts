// The phone test: the app as a person uses it on an iPhone and on an Android phone with touch, against a GM's phone or
// laptop. Each test is one thing a person sees. Flows that already have their own test are named in
// docs/agent-handoff/final/notes-final.md (step 2) rather than written twice. The sweep at the end walks every view at
// 360 by 640 and 390 by 844, for a player and a GM, out of a fight and in one, and checks what a thumb and an eye need:
// no sideways scroll, no tap target under 44 px, no text under 12 px, and each maker's lowest field clear of the bars
// when it has the focus.
import type { Page } from '@playwright/test';
import { test, expect, onboardGM, onboardPlayer, createRoom, dismissAll, go, openApp, ANDROID_UA, LANDSCAPE, ROOM_CODE, setupDoc, fightRow } from './helpers.ts';

const combat = (page: Page) => page.locator('#view-combat');
const map = (page: Page) => combat(page).locator('[data-mapbox]');

/** A GM and a player in one room, the player's card on the GM's party board. */
async function room(gm: Page, player: Page, hunter: string): Promise<string> {
  await onboardGM(gm);
  const code = await createRoom(gm);
  await onboardPlayer(player, hunter, code);
  await expect.poll(() => player.evaluate(() => hunterApp.api.sync.room())).toBe(code);
  await dismissAll(player, 4);
  await go(gm, 'gm');
  await expect(gm.locator('#gm-board .gm-card.remote', { hasText: hunter })).toHaveCount(1);
  return code;
}

/** The GM's fight with the player's hunter and one rat, started from the builder; the turn is the hunter's. */
async function fight(gm: Page, player: Page, hunter: string): Promise<void> {
  await go(gm, 'combat');
  await combat(gm).locator('[data-hsel]').selectOption({ label: `${hunter} (remote)` });
  await combat(gm).locator('[data-addh]').tap();
  await combat(gm).locator('[data-qline]').fill('Cave Rat x1, E, brute');
  await combat(gm).locator('[data-qadd]').tap();
  await combat(gm).locator('[data-start]').tap();
  await expect(map(gm).locator('.mp-tok.now')).toHaveCount(1);
  await gm.evaluate(name => hunterApp.store.update((d: any) => {
    const f = d.fight, me = f.rows.find((r: any) => r.name === name), rat = f.rows.find((r: any) => r.kind === 'monster');
    me.place = { x: 2, y: 2 }; me.at = f.now; me.tie = 0; rat.place = { x: 2, y: 4 }; rat.at = f.now + 1; rat.tie = 0;
    f.currentId = me.id; f.log = [];
  }, 'test-setup'), hunter);
  await setupDoc(player, hunter, { x: 2, y: 2 });
  await go(player, 'combat');
  await expect(combat(player).locator('.tb-mine')).toContainText('YOUR TURN');
}

/** Where the centre of tile (x, y) is on the page: the world layer's box, scaled by its zoom (map.js TILE is 40). */
async function tileAt(page: Page, x: number, y: number): Promise<{ x: number; y: number }> {
  await map(page).locator('[data-frame]').scrollIntoViewIfNeeded();
  return map(page).locator('[data-world]').evaluate((w, [tx, ty]) => {
    const r = w.getBoundingClientRect(), s = r.width / (w as HTMLElement).offsetWidth;
    return { x: r.left + (tx! + 0.5) * 40 * s, y: r.top + (ty! + 0.5) * 40 * s };
  }, [x, y]);
}
async function tapTile(page: Page, x: number, y: number): Promise<void> {
  const p = await tileAt(page, x, y);
  await page.touchscreen.tap(p.x, p.y);
}
const rowOf = fightRow;
const turnOn = (page: Page) => map(page).locator('.mp-order li.now');

test('a GM on a laptop opens a room; an iPhone joins by the invite link and an Android phone by typing the code, and both hunters are on the GM\'s party board', async ({ device }) => {
  const gm = (await device('gm', { mouse: true, viewport: { width: 1280, height: 800 } })).page;
  const iphone = (await device('iphone')).page, android = (await device('android', { viewport: { width: 360, height: 780 }, userAgent: ANDROID_UA })).page;
  await openApp(gm);
  for (const step of ['[data-yes]', '[data-gm]', '[data-starter]', '[data-oblater]']) {
    const b = gm.locator(`.ob-overlay ${step}`);
    if (await b.isVisible()) await b.click();
  }
  await go(gm, 'gm');
  await gm.locator('[data-gmcreate]').click();
  await expect(gm.locator('[data-gmroomcode]')).toHaveText(ROOM_CODE);
  const code = ((await gm.locator('[data-gmroomcode]').textContent()) ?? '').trim();
  await test.step('the iPhone opens the link, types a name and is in the room', async () => {
    await openApp(iphone, `/?room=${code}`);
    await expect(iphone.locator('.ob-overlay [data-roomchip]')).toHaveText(code);
    await iphone.locator('.ob-overlay [data-name]').fill('Ines Link');
    await iphone.locator('.ob-overlay [data-go]').tap();
    await expect.poll(() => iphone.evaluate(() => hunterApp.api.sync.room())).toBe(code);
    await iphone.locator('.ob-overlay [data-obsheet]').tap();
  });
  await test.step('the Android phone types the code and is in the room', async () => {
    await onboardPlayer(android, 'Andre Code', code);
    await expect.poll(() => android.evaluate(() => hunterApp.api.sync.room())).toBe(code);
  });
  await go(gm, 'gm');
  for (const name of ['Ines Link', 'Andre Code']) await expect(gm.locator('#gm-board .gm-card.remote', { hasText: name })).toHaveCount(1);
});

test('on an Android phone a player plays a turn on the map: a step, Strike from the hotbar at the rat, and End turn; the rat\'s turn comes on both phones', async ({ device }) => {
  const gm = (await device('gm')).page, player = (await device('player', { viewport: { width: 360, height: 780 }, userAgent: ANDROID_UA })).page;
  await room(gm, player, 'Ana Turn');
  await fight(gm, player, 'Ana Turn');
  // the rat acts a round and a half from now: after a step (a part of a round) and Strike (a round), before End turn's round more
  await gm.evaluate(() => hunterApp.store.update((d: any) => { const rat = d.fight.rows.find((r: any) => r.kind === 'monster'); rat.at = d.fight.now + 1500; }, 'test-setup'));
  await test.step('a step down the map, one tile', async () => {
    await tapTile(player, 2, 3);
    await map(player).locator('[data-go]', { hasText: 'Move' }).tap();
    await expect.poll(() => rowOf(gm, 'Ana Turn').then(r => [r.place.x, r.place.y])).toEqual([2, 3]);
    // the player's phone draws the room's fight as the GM's phone sends it, a poll after the step
    await expect(map(player).locator('.mp-tok.mine')).toHaveAttribute('data-y', '3');
  });
  await test.step('Strike at the rat beside them', async () => {
    const hp = (await rowOf(gm, 'Cave Rat')).hp;
    await map(player).locator('[data-hot] [data-ab]').first().tap();
    await tapTile(player, 2, 4);
    await map(player).locator('[data-go]').tap();
    await expect.poll(() => gm.evaluate(() => hunterApp.store.get().fight.log.length)).toBeGreaterThan(1);
    expect((await rowOf(gm, 'Cave Rat')).hp).toBeLessThanOrEqual(hp);
  });
  await test.step('End turn, and the rat\'s turn shows on both phones', async () => {
    await map(player).locator('[data-hot] [data-pass]').tap();
    for (const p of [gm, player]) await expect(turnOn(p)).toHaveText('Cave Rat');
  });
});

/** How long the GM's phone may take to answer a player's move on the map: its poll on a player's turn (1 s), its doc 0.2 s later, the player's next quick poll (0.3 s), and room for the page's own work. */
const ANSWER_MS = 2500;

test('on an Android phone a player\'s step shows as sending with its way in the frame after the tap, and the token stands on the new tile within 2.5 s', async ({ device }) => {
  const gm = (await device('gm')).page, player = (await device('player', { viewport: { width: 360, height: 780 }, userAgent: ANDROID_UA })).page;
  await room(gm, player, 'Ana Quick');
  await fight(gm, player, 'Ana Quick');
  await tapTile(player, 2, 3);
  const move = map(player).locator('[data-go]', { hasText: 'Move' });
  await expect(move).toBeVisible();
  await player.evaluate(() => {
    const w = window as any, tok = document.querySelector('#view-combat [data-mapbox] .mp-tok.mine')!;
    w.__answer = { tapped: 0, shown: 0, sending: false, way: false };
    // The map acts when the finger lifts on Move (its pointerup), so the tap is timed from there, not from the click: the
    // Move bar may be hidden by the time the browser sends the click, which then lands on what is under the bar. The map
    // holds the pointer, so the lift's target is the map: the first listener, before the map's, finds the button by where
    // the finger is; the second, after the map's, asks for the frame, so its rAF runs after any the map asked for and
    // sees the frame that first draws after the tap.
    let onMove = false;
    document.addEventListener('pointerup', ev => { onMove = !!document.elementFromPoint(ev.clientX, ev.clientY)?.closest('[data-go]'); }, true);
    document.addEventListener('pointerup', () => {
      if (!onMove) return;
      w.__answer.tapped = performance.now();
      requestAnimationFrame(() => {
        const mark = document.querySelector('#view-combat [data-sending]') as HTMLElement | null;
        w.__answer.sending = !!mark && !mark.hidden; w.__answer.way = !!document.querySelector('#view-combat [data-shade="way"]');
      });
    });
    new MutationObserver(() => { if (tok.getAttribute('data-y') === '3' && !w.__answer.shown) w.__answer.shown = performance.now(); }).observe(tok, { attributes: true, attributeFilter: ['data-y'] });
  });
  await move.tap();
  await expect(map(player).locator('.mp-tok.mine')).toHaveAttribute('data-y', '3');
  const a = await player.evaluate(() => (window as any).__answer);
  expect(a.sending, 'the sending mark shows in the frame after the tap').toBe(true);
  expect(a.way, 'the way the step goes stays drawn while it is sent').toBe(true);
  expect(a.shown - a.tapped, `the step shows on the player's phone ${Math.round(a.shown - a.tapped)} ms after the tap`).toBeLessThan(ANSWER_MS);
  await expect(map(player).locator('[data-sending]')).toBeHidden();
});

test('a player whose phone is hidden and offline while the GM moves the fight on comes back to the same fight as the GM', async ({ device }) => {
  const gm = (await device('gm')).page;
  const player = (await device('player', { blockServiceWorker: true, allowConsole: [/ERR_INTERNET_DISCONNECTED|net::ERR|Failed to fetch/] })).page;
  await room(gm, player, 'Hana Away');
  await fight(gm, player, 'Hana Away');
  await test.step('the page is hidden and the phone goes offline', async () => {
    await player.evaluate(() => { Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true }); Object.defineProperty(document, 'hidden', { value: true, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
    await player.context().setOffline(true);
  });
  await test.step('the GM ends the hunter\'s turn and hurts the rat', async () => {
    await combat(gm).locator('[data-next]').first().tap();
    await expect(turnOn(gm)).toHaveText('Cave Rat');
  });
  await test.step('back online and shown, the player\'s map has the rat\'s turn as the GM does', async () => {
    await player.context().setOffline(false);
    await player.evaluate(() => { Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true }); Object.defineProperty(document, 'hidden', { value: false, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
    await expect(turnOn(player)).toHaveText('Cave Rat', { timeout: 20_000 });
    await expect(combat(player).locator('.tb-mine', { hasText: 'YOUR TURN' })).toHaveCount(0);
  });
});

test('a player who opens Combat on a fight already under way meets the map framed on the fight, its tokens a thumb wide', async ({ device }) => {
  const gm = (await device('gm')).page, player = (await device('player')).page;
  await room(gm, player, 'Mio Late');
  await fight(gm, player, 'Mio Late');
  // The fight's doc was on the phone before Combat was opened, and nothing has changed since: the map frames at its first draw.
  const sizes = await map(player).locator('.mp-tok').evaluateAll(els => els.map(e => Math.round(e.getBoundingClientRect().width)));
  expect(sizes).toHaveLength(2);
  for (const w of sizes) expect(w).toBeGreaterThanOrEqual(44);
});

test('a player who reloads in the middle of a fight is back on the map with their turn and their hotbar', async ({ device }) => {
  const gm = (await device('gm')).page, player = (await device('player')).page;
  await room(gm, player, 'Rei Load');
  await fight(gm, player, 'Rei Load');
  await player.reload();
  await player.waitForFunction(() => window.hunterApp && document.querySelectorAll('#nav-top a').length > 0);
  await go(player, 'combat');
  await expect(combat(player).locator('.tb-mine')).toContainText('YOUR TURN');
  await expect(map(player).locator('.mp-tok')).toHaveCount(2);
  await expect(map(player).locator('[data-hot] [data-ab]').first()).toBeVisible();
  await expect(turnOn(player)).toHaveText('Rei Load');
});

test('a phone turned to landscape shows the map and the hotbar, and Strike picked there hits the rat', async ({ device }) => {
  const gm = (await device('gm')).page, player = (await device('player', { viewport: LANDSCAPE })).page;
  await room(gm, player, 'Lia Side');
  await gm.evaluate(() => hunterApp.store.update(() => {}, 'noop'));
  await go(gm, 'combat');
  await combat(gm).locator('[data-hsel]').selectOption({ label: 'Lia Side (remote)' });
  await combat(gm).locator('[data-addh]').tap();
  await combat(gm).locator('[data-qline]').fill('Cave Rat x1, E, brute');
  await combat(gm).locator('[data-qadd]').tap();
  await combat(gm).locator('[data-start]').tap();
  await gm.evaluate(() => hunterApp.store.update((d: any) => {
    const f = d.fight, me = f.rows.find((r: any) => r.name === 'Lia Side'), rat = f.rows.find((r: any) => r.kind === 'monster');
    me.place = { x: 2, y: 2 }; me.at = f.now; me.tie = 0; rat.place = { x: 3, y: 2 }; rat.at = f.now + 1; rat.tie = 0; f.currentId = me.id; f.log = [];
  }, 'test-setup'));
  await setupDoc(player, 'Lia Side', { x: 2, y: 2 });
  await go(player, 'combat');
  await expect(combat(player).locator('.tb-mine')).toContainText('YOUR TURN');
  expect(await player.evaluate(() => document.scrollingElement!.scrollWidth <= innerWidth), 'no sideways scroll').toBe(true);
  const frame = (await map(player).locator('[data-frame]').boundingBox())!;
  expect(frame.height, 'the map is not a sliver').toBeGreaterThanOrEqual(200);
  const strike = map(player).locator('[data-hot] [data-ab]').first();
  await strike.scrollIntoViewIfNeeded();
  await expect(strike).toBeInViewport();
  await strike.tap();
  await tapTile(player, 3, 2);
  const use = map(player).locator('[data-go]');
  await use.scrollIntoViewIfNeeded();
  await expect(use).toBeEnabled();
  await use.tap();
  await expect.poll(() => gm.evaluate(() => hunterApp.store.get().fight.log.length)).toBeGreaterThan(0);
});

// ── the sweep ──

type Finding = { view: string; what: string };

/** What a thumb and an eye need on the screen as it is now: each failure named by what it is and where. */
async function check(page: Page, view: string): Promise<Finding[]> {
  const found = await page.evaluate(() => {
    const out: string[] = [];
    const root = document.scrollingElement!;
    if (root.scrollWidth > innerWidth + 1) out.push(`the page scrolls sideways (${root.scrollWidth} px wide at ${innerWidth})`);
    const name = (el: Element) => `${el.tagName.toLowerCase()}${el.className && typeof el.className === 'string' ? `.${el.className.trim().split(/\s+/).join('.')}` : ''} "${(el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 30)}"`;
    const shown = (el: Element) => {
      const r = el.getBoundingClientRect();
      // off the page (a skip link waits above it until it has the focus)
      if (r.width === 0 || r.height === 0 || r.bottom + scrollY <= 0 || r.right + scrollX <= 0) return false;
      const s = getComputedStyle(el);
      return s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) > 0 && !el.closest('[hidden],[inert],.ob-gone,[aria-hidden="true"]');
    };
    // the scale the battle map draws its world at: a token and a name are sized in the world, then zoomed
    const zoom = (el: Element) => { const w = el.closest('[data-world]') as HTMLElement | null; return w ? w.getBoundingClientRect().width / w.offsetWidth : 1; };
    for (const el of document.querySelectorAll('button, select, textarea, a[href], input:not([type=hidden]), [role=button], [role=tab]')) {
      if (!shown(el)) continue;
      // a box or a choice is tapped through its label
      const t = el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'radio') ? el.closest('label') ?? el : el;
      const r = t.getBoundingClientRect();
      if (Math.round(r.height) < 44 || Math.round(r.width) < 44) out.push(`a tap target under 44 px: ${name(el)} is ${Math.round(r.width)} by ${Math.round(r.height)}`);
    }
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const small = new Set<Element>();
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const el = n.parentElement;
      if (!el || !n.textContent?.trim() || small.has(el) || !shown(el) || el.closest('script,style,svg')) continue;
      const px = parseFloat(getComputedStyle(el).fontSize) * zoom(el);
      if (px < 11.95) { small.add(el); out.push(`text under 12 px: ${name(el)} at ${px.toFixed(1)} px`); }
    }
    return out;
  });
  return found.map(what => ({ view, what }));
}

/** Every view this phone's menu offers. */
const viewsOf = (page: Page) => page.evaluate(() => [...new Set([...document.querySelectorAll('#nav-top a, .nav-bottom a')].map(a => (a.getAttribute('href') ?? '').replace('#/', '')).filter(Boolean))]);

async function sweep(page: Page, label: string): Promise<Finding[]> {
  const out: Finding[] = [];
  for (const v of await viewsOf(page)) {
    await go(page, v);
    await page.evaluate(() => scrollTo(0, 0));
    out.push(...await check(page, `${label} ${v}`));
  }
  return out;
}

/** Each maker of the Workshop: its lowest field, given the focus, is not under the bottom bar or the window's own bar. */
async function makers(gm: Page, label: string): Promise<Finding[]> {
  const out: Finding[] = [];
  await go(gm, 'workshop');
  const kinds = await gm.locator('#view-workshop [data-ws]').evaluateAll(els => els.map(e => (e as HTMLElement).dataset['ws']!));
  for (const k of kinds) {
    const add = gm.locator(`#view-workshop [data-ws="${k}"] [data-new]`);
    if (!(await add.count())) continue;
    await add.tap();
    const dlg = gm.locator('[role=dialog][aria-modal="true"]').last();
    await expect(dlg).toBeVisible();
    // The window comes in at .98 of its size (motion.ts `enter`): measured before that ends, a 44 px control reads 43.
    // A motion cancelled on the way is over too.
    await gm.evaluate(() => Promise.all(document.getAnimations().filter(a => a.effect?.getTiming().iterations !== Infinity).map(a => a.finished.then(() => true, () => false))));
    const fields = dlg.locator('input:visible:not([type=checkbox]):not([type=radio]), textarea:visible, select:visible');
    const n = await fields.count();
    if (n) {
      const last = fields.nth(n - 1);
      await last.focus();
      await last.evaluate(el => el.scrollIntoView({ block: 'nearest' }));
      const covered = await last.evaluate(el => {
        const r = el.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + Math.min(r.height / 2, 20);
        if (y > innerHeight) return 'below the screen';
        const top = document.elementFromPoint(x, y);
        return top && (top === el || el.contains(top) || top.contains(el) || top.closest('label') === el.closest('label')) ? null : `under ${top ? `${top.tagName.toLowerCase()}.${String(top.className).split(' ').join('.')}` : 'nothing'}`;
      });
      if (covered) out.push({ view: `${label} ${k} maker`, what: `its last field, focused, is ${covered}` });
    }
    out.push(...(await check(gm, `${label} ${k} maker`)));
    // a maker with an Icon row (icons design 6): its sheet of icons, open on the thing's own group, then closed by Escape
    const icons = dlg.locator('[data-ic-open]');
    if (await icons.count()) {
      await icons.tap();
      await expect(dlg.locator('.mk-ic-panel')).toBeVisible();
      await gm.evaluate(() => Promise.all(document.getAnimations().filter(a => a.effect?.getTiming().iterations !== Infinity).map(a => a.finished.then(() => true, () => false))));
      out.push(...(await check(gm, `${label} ${k} maker's icons`)));
      await gm.keyboard.press('Escape');
      await expect(dlg.locator('.mk-ic-panel')).toHaveCount(0);
    }
    await gm.keyboard.press('Escape');
    await expect(dlg).toBeHidden();
  }
  return out;
}

const report = (all: Finding[]) => all.map(f => `${f.view}: ${f.what}`);

for (const size of [{ width: 360, height: 640 }, { width: 390, height: 844 }]) {
  test(`at ${size.width} by ${size.height} every view, for a player and a GM, in and out of a fight, has no sideways scroll, no tap target under 44 px and no text under 12 px, and each maker's last field shows when focused`, async ({ device }) => {
    test.setTimeout(240_000);
    const gm = (await device('gm', { viewport: size })).page, player = (await device('player', { viewport: size, userAgent: ANDROID_UA })).page;
    await room(gm, player, 'Ada Sweep');
    const found: Finding[] = [];
    await test.step('out of a fight', async () => {
      found.push(...await sweep(player, 'player'), ...await sweep(gm, 'gm'));
      found.push(...await makers(gm, 'gm'));
    });
    await test.step('in a fight', async () => {
      await fight(gm, player, 'Ada Sweep');
      found.push(...await sweep(player, 'player in a fight'), ...await sweep(gm, 'gm in a fight'));
    });
    expect(report(found)).toEqual([]);
  });
}
