// The phone test: the app as a person uses it on an iPhone and on an Android phone with touch, against a GM's phone or
// laptop. Each test is one thing a person sees. Flows that already have their own test are named in
// docs/agent-handoff/final/notes-final.md (step 2) rather than written twice. The sweep at the end walks every view at
// 360 by 640 and 390 by 844, for a player and a GM, out of a fight and in one, and checks what a thumb and an eye need:
// no sideways scroll, no tap target under 44 px, no text under 12 px, and each maker's lowest field clear of the bars
// when it has the focus.
import { mkdir } from 'node:fs/promises';
import type { Page } from '@playwright/test';
import { test, expect, onboardGM, onboardPlayer, createRoom, dismissAll, go, openApp, ANDROID_UA, LANDSCAPE, ROOM_CODE, setupDoc, fightRow } from './helpers.ts';

const SHOTS = process.env.FS5_SHOTS ?? '';
async function shot(page: Page, name: string): Promise<void> {
  if (!SHOTS) return;
  await mkdir(SHOTS, { recursive: true });
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: false });
}

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
  await combat(gm).locator('[data-hsel]').selectOption({ label: `${hunter} (player phone)` });
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
  await combat(gm).locator('[data-hsel]').selectOption({ label: 'Lia Side (player phone)' });
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
type CheckOpts = {
  /** Also scroll the page (or open dialog/sheet) to its bottom to verify persistent bottom floaters never trap the lowest tap targets. */
  checkBottom?: boolean;
};

/**
 * What a thumb and an eye need on the screen as it is now: each failure named by what it is and where.
 * Checks horizontal overflow (page, floating cards, unwrapped tables, tap targets), 44 px tap targets,
 * 12 px text, floating-card / HUD overlap against active tap targets, and (when `checkBottom`) bottom-of-scroll reachability.
 */
async function check(page: Page, view: string, opts: CheckOpts = {}): Promise<Finding[]> {
  const found = await page.evaluate(({ checkBottom }) => {
    const out: string[] = [];
    const root = document.scrollingElement!;
    if (root.scrollWidth > innerWidth + 1) out.push(`the page scrolls sideways (${root.scrollWidth} px wide at ${innerWidth})`);
    const name = (el: Element) => `${el.tagName.toLowerCase()}${el.className && typeof el.className === 'string' && el.className.trim() ? `.${el.className.trim().split(/\s+/).slice(0, 3).join('.')}` : ''} "${(el.getAttribute('aria-label') ?? el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 36)}"`;
    const shown = (el: Element | null): el is Element => {
      if (!el) return false;
      const det = el.closest('details:not([open])');
      if (det && !el.closest('summary')) return false;
      const r = el.getBoundingClientRect();
      // off the page (a skip link waits above it until it has the focus)
      if (r.width === 0 || r.height === 0 || r.bottom + scrollY <= 0 || r.right + scrollX <= 0) return false;
      const s = getComputedStyle(el);
      return s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) > 0 && !el.closest('[hidden],[inert],.ob-gone,[aria-hidden="true"]');
    };
    const cross = (a: DOMRect, b: DOMRect) => a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1;
    const sameControl = (a: Element, b: Element | null) => !!b && (b === a || a.contains(b) || b.contains(a) || (!!a.closest('label') && b.closest('label') === a.closest('label')));
    const inHScroll = (el: Element) => {
      for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
        const ox = getComputedStyle(p).overflowX;
        if (ox === 'auto' || ox === 'scroll' || p.hasAttribute('data-frame')) return p;
      }
      return null;
    };
    const floatHost = (el: Element | null): Element | null => {
      if (!el) return null;
      return el.closest('#nav-bottom, .coin-card, .toast, #dice-sheet, .sys-window, .tb-sheet, [data-cardbox].sheet, .cmb-tools.open, [data-panel="table-feed"], .jump-chips, .dlg-actions, .mk-actions, .mp-tools, [data-confirm], [data-hot]');
    };

    // Active modal or non-modal bottom drawer scope: elements behind an open modal or bottom drawer are intentionally obscured.
    const modals = [...document.querySelectorAll('.overlay.show .sys-window, .ob-overlay .sys-window, .mk-ic-panel')].filter(shown);
    const activeModal = modals.length ? modals[modals.length - 1]! : null;
    const drawers = [...document.querySelectorAll('#dice-sheet:not([hidden]), .tb-sheet:not([hidden]), [data-cardbox].sheet, .cmb-tools.open')].filter(shown);
    const activeDrawer = !activeModal && drawers.length ? drawers[drawers.length - 1]! : null;
    const inActiveScope = (el: Element) => {
      if (activeModal) return activeModal.contains(el) || !!el.closest('.toast');
      if (activeDrawer) return activeDrawer.contains(el) || !!el.closest('#nav-bottom, .toast, .coin-card');
      return true;
    };

    // 1. Floating card horizontal bounds (must never extend outside the viewport)
    for (const card of document.querySelectorAll('.sys-window, .coin-card, .dx-sheet, .toast')) {
      if (!shown(card)) continue;
      const r = card.getBoundingClientRect();
      if (r.left < -1 || r.right > innerWidth + 1) out.push(`floating card overflows sideways: ${name(card)} (${Math.round(r.left)}..${Math.round(r.right)} at ${innerWidth})`);
    }

    // 2. Unwrapped wide tables (a table wider than the screen must sit inside a horizontal scroller that itself fits)
    for (const tbl of document.querySelectorAll('table')) {
      if (!shown(tbl)) continue;
      const r = tbl.getBoundingClientRect();
      if (r.right > innerWidth + 1 || r.left < -1) {
        const sc = inHScroll(tbl);
        const sr = sc?.getBoundingClientRect();
        if (!sc || !sr || sr.right > innerWidth + 1 || sr.left < -1) {
          out.push(`wide table overflows screen: ${name(tbl)} (${Math.round(r.left)}..${Math.round(r.right)} at ${innerWidth})`);
        }
      }
    }

    // the scale the battle map draws its world at: a token and a name are sized in the world, then zoomed
    const zoom = (el: Element) => { const w = el.closest('[data-world]') as HTMLElement | null; return w ? w.getBoundingClientRect().width / w.offsetWidth : 1; };
    const TAP_SEL = 'button, select, textarea, a[href], input:not([type=hidden]), [role=button], [role=tab], summary';
    const tapTargets: { el: Element; box: Element }[] = [];
    for (const el of document.querySelectorAll(TAP_SEL)) {
      if (!shown(el)) continue;
      // a box or a choice is tapped through its label
      const t = el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'radio') ? el.closest('label') ?? el : el;
      if (!shown(t)) continue;
      tapTargets.push({ el, box: t });
      const r = t.getBoundingClientRect();
      // A button just tapped may still be in its :active press scale (.97 -> 43 px on a 44 px target); measure its laid-out size then.
      const w = t.matches(':active') ? (t as HTMLElement).offsetWidth : r.width;
      const h = t.matches(':active') ? (t as HTMLElement).offsetHeight : r.height;
      if (Math.round(h) < 44 || Math.round(w) < 44) out.push(`a tap target under 44 px: ${name(el)} is ${Math.round(w)} by ${Math.round(h)}`);
      if (inActiveScope(t) && !inHScroll(t) && (r.left < -1 || r.right > innerWidth + 1)) {
        out.push(`tap target overflows sideways: ${name(el)} (${Math.round(r.left)}..${Math.round(r.right)} at ${innerWidth})`);
      }
      if (el instanceof HTMLButtonElement && !el.closest('[data-world]') && getComputedStyle(el).overflowX === 'visible' && el.scrollWidth > el.clientWidth + 2) {
        out.push(`button text overflows its box: ${name(el)} (scroll ${el.scrollWidth} > client ${el.clientWidth})`);
      }
    }

    // 3. Text readability >= 12 px
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const small = new Set<Element>();
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const el = n.parentElement;
      if (!el || !n.textContent?.trim() || small.has(el) || !shown(el) || el.closest('script,style,svg')) continue;
      const px = parseFloat(getComputedStyle(el).fontSize) * zoom(el);
      if (px < 11.95) { small.add(el); out.push(`text under 12 px: ${name(el)} at ${px.toFixed(1)} px`); }
    }

    const visibleInScrollAncestors = (el: Element, cx: number, cy: number) => {
      for (let p = el.parentElement; p && p !== document.body && p !== document.documentElement; p = p.parentElement) {
        const s = getComputedStyle(p);
        if (s.overflowY === 'auto' || s.overflowY === 'scroll' || s.overflowY === 'hidden' || s.overflowX === 'auto' || s.overflowX === 'scroll' || s.overflowX === 'hidden') {
          const pr = p.getBoundingClientRect();
          if (cy < pr.top || cy > pr.bottom || cx < pr.left || cx > pr.right) return false;
        }
      }
      return true;
    };

    // 4. Floating-on-floating and HUD overlap: active tap targets inside floating cards, modals, drawers, or map HUD must be hittable
    const hitCheck = (t: Element, el: Element, where: string, allowedCover?: (top: Element) => boolean) => {
      const r = t.getBoundingClientRect();
      const cx = Math.min(innerWidth - 1, Math.max(1, r.left + r.width / 2));
      const cy = r.top + r.height / 2;
      if (cy < 0 || cy > innerHeight || r.right <= 0 || r.left >= innerWidth) return;
      if (!visibleInScrollAncestors(t, cx, cy)) return;
      const top = document.elementFromPoint(cx, cy);
      if (!top || sameControl(t, top) || sameControl(el, top)) return;
      if (allowedCover && allowedCover(top)) return;
      const host = floatHost(top);
      if (host && !host.contains(t)) {
        out.push(`${where}: ${name(host)} covers ${name(el)}`);
      }
    };

    const hudTarget = (el: Element) =>
      !!el.closest('#nav-bottom, .coin-card, .toast, #dice-sheet, .sys-window, .mk-ic-panel, .tb-sheet, [data-cardbox].sheet, .cmb-tools.open, .mp-tools, [data-hot], [data-confirm], #view-combat [data-next]');

    for (const { el, box } of tapTargets) {
      if (!inActiveScope(box)) continue;
      if (hudTarget(box)) {
        // Inside a scrolling modal/drawer, its own sticky footer (.dlg-actions/.mk-actions) naturally sits over mid-form
        // fields at scrollTop=0; bottom-of-scroll reachability (step 5) checks that no field is permanently trapped under it.
        const ownFooter = (top: Element) => !!activeModal && activeModal.contains(box) && !box.closest('.dlg-actions, .mk-actions') && !!top.closest('.dlg-actions, .mk-actions');
        hitCheck(box, el, 'floating/HUD overlap', ownFooter);
      }
    }

    // 4b. Pointer-events:none map HUD notices (.mp-news, .mp-seenas, .mp-sending) must not visually overlap map HUD buttons
    if (!activeModal && !activeDrawer) {
      const mapNotices = [...document.querySelectorAll('.mp-news, .mp-seenas, .mp-sending')].filter(n => shown(n) && !!n.textContent?.trim());
      if (mapNotices.length) {
        const hudBtns = tapTargets.filter(({ box }) => !!box.closest('.mp-tools, [data-hot], [data-confirm], #view-combat [data-next]'));
        for (const notice of mapNotices) {
          const nr = notice.getBoundingClientRect();
          for (const { el, box } of hudBtns) {
            if (cross(nr, box.getBoundingClientRect())) out.push(`map HUD overlap: ${name(notice)} covers ${name(el)}`);
          }
        }
      }
    }

    // 5. Bottom-of-scroll reachability: persistent bottom floaters (#nav-bottom, fixed .coin-card, sticky table feed, sticky action bars)
    //    must never permanently trap the lowest tap targets when scrolled all the way down.
    if (checkBottom) {
      if (activeModal) {
        const scroller = (activeModal.querySelector('.mk-scroll') as HTMLElement | null) ?? (activeModal as HTMLElement);
        const prevTop = scroller.scrollTop;
        scroller.scrollTop = scroller.scrollHeight;
        for (const { el, box } of tapTargets) {
          if (!activeModal.contains(box) || box.closest('.dlg-actions, .mk-actions')) continue;
          // ignore transient top-docked toasts here (already checked in step 4 against modal targets)
          hitCheck(box, el, 'modal bottom scroll', top => !!top.closest('.toast'));
        }
        scroller.scrollTop = prevTop;
      } else if (!activeDrawer) {
        const prevY = scrollY;
        const maxScroll = Math.max(0, root.scrollHeight - innerHeight);
        scrollTo(0, maxScroll);
        // Re-measure targets inside #main at max scroll; only persistent bottom floaters trap controls at maxScroll.
        // Top-sticky bars (.jump-chips) and transient toasts are excluded here (toasts are checked in step 4).
        const main = document.getElementById('main');
        if (main) {
          for (const el of main.querySelectorAll(TAP_SEL)) {
            if (!shown(el) || el.closest('[data-world]')) continue;
            const t = el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'radio') ? el.closest('label') ?? el : el;
            if (!shown(t) || t.closest('.dlg-actions, .mk-actions, .jump-chips, [data-panel="table-feed"]')) continue;
            hitCheck(t, el, 'bottom of scroll', top => !!top.closest('.toast, .jump-chips'));
          }
        }
        scrollTo(0, prevY);
      }
    }

    return [...new Set(out)];
  }, { checkBottom: !!opts.checkBottom });
  return found.map(what => ({ view, what }));
}

/** Every view this phone's menu offers. */
const viewsOf = (page: Page) => page.evaluate(() => [...new Set([...document.querySelectorAll('#nav-top a, .nav-bottom a')].map(a => (a.getAttribute('href') ?? '').replace('#/', '')).filter(Boolean))]);

async function sweep(page: Page, label: string, opts: CheckOpts = {}): Promise<Finding[]> {
  const out: Finding[] = [];
  for (const v of await viewsOf(page)) {
    await go(page, v);
    await page.evaluate(() => scrollTo(0, 0));
    out.push(...await check(page, `${label} ${v}`, opts));
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

const BUSY_PLAYER = 'Alexandria Valeriana-Kestrelsworth-Montague III';

/**
 * Seeds a worst-case campaign onto both GM and player phones: long hunter/job/title/item/status/skill/quest/shadow/monster/gate names,
 * signed custom guild lines, large gold/crystal/debt numbers, full session/roll logs, 6 party cards, mythic boss & multi-monster bestiary.
 */
async function seedBusy(gm: Page, player: Page): Promise<void> {
  const applyBusy = (page: Page, asGM: boolean) => page.evaluate(({ isGM, playerName }) => {
    hunterApp.store.update((d: any) => {
      const R = hunterApp.rules();
      const now = new Date().toISOString();
      const today = d.world?.lastDailyKey ?? now.slice(0, 10);
      d.rulesOverrides = { ...d.rulesOverrides, solo: { personal: false }, feats: { on: false }, fight: { ...(d.rulesOverrides?.fight || {}), keystone: { on: true } } };

      // Custom long-named statuses
      const corrosion = {
        label: 'Abyssal Mana-Corrosion Resonance Mark',
        desc: 'Eats through armor and mana each turn while resonating with abyssal fields.',
        color: '#c79bff',
        ops: [{ op: 'dot', dmg: '2d6', dmgType: 'magic' }, { op: 'sheet', key: 'armor', amount: -12 }],
        stack: { cap: 5, leave: { kind: 'never' }, keep: 'fight', threshold: null },
      };
      const bastion = {
        label: 'Sovereign Ironwake Bulwark & Ward',
        desc: 'Reinforces physical and magical defense across long dungeon raids.',
        color: '#4dd8ff',
        ops: [{ op: 'sheet', key: 'armor', amount: 18 }, { op: 'sheet', key: 'resist', amount: 15 }],
      };
      d.library.statuses['abyssal-corrosion-mark'] = corrosion;
      d.library.statuses['sovereign-bastion-ward'] = bastion;

      const makeItems = (prefix: string) => [
        { id: `${prefix}1`, name: 'Sovereign Twin-Edged Abyssal Wyrmfang Greatsword of Ruin', rar: 'mythic', type: 'weapon', slot: 'weapon', qty: 1, dice: '3d10+6', attack: 'strike', bonus: { str: 12, pow: 8, aim: 4 }, armor: 0, resist: 0, desc: 'Forged from the seventh-horizon dragon spine.' },
        { id: `${prefix}2`, name: 'Aurelian Vanguard Runeforged Adamantine Breastplate', rar: 'legendary', type: 'armor', slot: 'chest', qty: 1, dice: '', bonus: { vit: 10, dis: 6 }, armor: 48, resist: 32, desc: 'Etched with guild resonance wards.' },
        { id: `${prefix}3`, name: 'Distilled Phoenix-Ash & S-Rank Essence Restoration Elixir', rar: 'epic', type: 'consumable', slot: null, qty: 12, dice: '', bonus: {}, armor: 0, resist: 0, desc: 'Restores 80 HP and clears burning on use.', effects: [{ op: 'heal', amount: 80 }] },
        { id: `${prefix}4`, name: "Crystallized Monarch's Dimensional Relic-Key of Ash", rar: 'rare', type: 'key', slot: null, qty: 3, dice: '', bonus: {}, armor: 0, resist: 0, desc: 'Unlocks sealed red double-dungeon sanctums.' },
      ];

      const makeConditions = () => [
        { key: 'abyssal-corrosion-mark', def: corrosion, rounds: 5, stacks: 3, source: { id: null, tier: 4 } },
        { key: 'sovereign-bastion-ward', def: bastion, rounds: 4, source: { id: null, tier: 4 } },
        { key: 'poisoned', def: R.conditions.poisoned, rounds: 6, source: { id: null, tier: 3 } },
        { key: 'burning', def: R.conditions.burning, rounds: 3, source: { id: null, tier: 2 } },
      ];

      const makeQuests = (prefix: string) => [
        { id: `${prefix}1`, kind: 'daily', title: 'Daily Sovereign Conditioning & Abyssal Stamina Regimen', desc: 'Complete every physical and mana circulation drill before midnight.', objectives: [{ label: 'Mana-charged shadow sprints across the citadel', target: 100, progress: 64 }, { label: 'Heavy greatsword resonance strikes', target: 100, progress: 100 }], rewards: { xp: 250, points: 3, gold: 500, crystal: 50, items: [], titles: [], boons: [], skills: [] }, onFail: { xp: 0, points: 0, gold: 0, crystal: 0, items: [], titles: [], boons: [], skills: [] }, status: 'active', issuedAt: now, doneAt: null, dueAt: null, from: 'system', penaltyText: '4 hours in the Crimson Desert Penalty Zone.', secret: false },
        { id: `${prefix}2`, kind: 'main', title: 'Shatter the Seventh Horizon Cathedral Double-Dungeon Sovereign', desc: 'Breach the inner sanctum and defeat the Arch-Sovereign before the red gate breaks over the harbor.', objectives: [{ label: 'Clear outer vanguard wardens', target: 6, progress: 4 }, { label: 'Disrupt the Sovereign Omen anchors', target: 3, progress: 1 }], rewards: { xp: 45000, points: 5, gold: 250000, crystal: 12000, items: [], titles: [], boons: [], skills: [] }, onFail: { xp: 0, points: 0, gold: 0, crystal: 0, items: [], titles: [], boons: [], skills: [] }, status: 'active', issuedAt: now, doneAt: null, dueAt: new Date(Date.now() + 7_200_000).toISOString(), from: 'gm', penaltyText: '', secret: true },
        { id: `${prefix}3`, kind: 'urgent', title: 'Intercept the Escaped S-Rank Calamity Wyrmling Pack', desc: 'Stop the rampaging wyrmlings before they reach the Association branch.', objectives: [{ label: 'Defeat escaped wyrmlings', target: 4, progress: 2 }], rewards: { xp: 12000, points: 0, gold: 40000, crystal: 2500, items: [], titles: [], boons: [], skills: [] }, onFail: { xp: 0, points: 0, gold: 0, crystal: 0, items: [], titles: [], boons: [], skills: [] }, status: 'active', issuedAt: now, doneAt: null, dueAt: new Date(Date.now() + 3_600_000).toISOString(), from: 'gm', penaltyText: 'Reputation loss with the Association.', secret: false },
        { id: `${prefix}4`, kind: 'side', title: 'Recover the Lost Aurelian Guild Expedition Ledger', desc: 'Returned intact to the guild master.', objectives: [{ label: 'Bring ledger back', target: 1, progress: 1 }], rewards: { xp: 3200, points: 0, gold: 15000, crystal: 0, items: [], titles: [], boons: [], skills: [] }, onFail: { xp: 0, points: 0, gold: 0, crystal: 0, items: [], titles: [], boons: [], skills: [] }, status: 'done', issuedAt: now, doneAt: now, told: true, dueAt: null, from: 'gm', penaltyText: '', secret: false },
      ];

      const makeShadows = (prefix: string) => [
        { id: `${prefix}1`, name: 'Marshal Igris of the Blood-Red Abyssal Throne', monster: null, rank: 'S', archetype: 'brute', grade: 'Marshal', hp: 420, summoned: true, notes: 'Commands the vanguard line during S-rank double-dungeon raids.' },
        { id: `${prefix}2`, name: 'Commander Beru, Ant King of Jeju Sanctum', monster: null, rank: 'A', archetype: 'skirmisher', grade: 'Commander', hp: 310, summoned: false, notes: 'High-speed flanker with healing shriek.' },
        { id: `${prefix}3`, name: 'Knight Tusk, Grand High-Orc Hymn-Weaver', monster: null, rank: 'B', archetype: 'caster', grade: 'Knight', hp: 240, summoned: false, notes: 'Provides wide-area fire and ward support.' },
      ];

      const guild = { archetype: 'aurelian', standing: 'ace', name: 'Order of the Aurelian Sovereign Vanguard Syndicate', goldCut: 0.225, crystalShare: 0.375 };

      const enrichHunter = (h: any, name: string, prefix: string, opts: { dead?: boolean } = {}) => {
        h.name = name;
        h.job = 'Shadow Monarch & Grand Archivist of the Abyssal Court';
        h.jobDone = 'Shadow Monarch';
        h.rank = 'A';
        h.level = 58;
        h.peakLevel = 58;
        h.xp = 4250;
        h.gold = 1_250_000;
        h.crystal = 987_654;
        h.debt = 450_000;
        h.reviveLeft = 'debt';
        h.guild = guild;
        h.emblem = 'crown';
        h.stats = { str: 48, agi: 42, vit: 44, ins: 36, dis: 38, pre: 46, pow: 50, ctl: 40 };
        h.spent = Object.values(h.stats as Record<string, number>).reduce((n, v) => n + Math.max(0, v - 10), 0);
        h.daily = { streak: 27, lastCompleteKey: today, lastCheckedKey: today };
        h.titles = [
          { id: `${prefix}t1`, name: 'Sovereign of the Endless Midnight Labyrinth and Seventh Gate', desc: 'Earned by clearing three red gates without a retreat.', bonus: { str: 4, pow: 4, armor: 10 } },
          { id: `${prefix}t2`, name: 'Aurelian Vanguard Arch-Slayer of the Drowned Cathedral', desc: 'Standing guild combat honor.', bonus: { agi: 3 } },
        ];
        h.titleId = `${prefix}t1`;
        h.boons = [{ id: `${prefix}bn1`, name: 'Association High-Council Emergency Extraction Writ', text: 'Once per arc, summon an S-rank strike team to hold a gate break.', at: now }];
        h.items = makeItems(`${prefix}i`);
        h.equipped = { weapon: `${prefix}i1`, offhand: null, head: null, chest: `${prefix}i2`, hands: null, legs: null, feet: null, neck: null, ring1: null, ring2: null };
        h.conditions = opts.dead ? [] : makeConditions();
        h.quests = makeQuests(`${prefix}q`);
        h.shadows = makeShadows(`${prefix}sh`);
        h.loadouts = [{ id: `${prefix}lo1`, name: 'Abyssal Raid Vanguard Kit', slots: { weapon: `${prefix}i1`, chest: `${prefix}i2` } }];
        h.life = opts.dead ? { at: 'dead' } : { at: 'up', hp: 310 };
        h.mana = 180;
        h.fatigue = 22;
      };

      // Enrich active hunter on both phones
      const act = d.hunters.find((x: any) => x.id === d.activeHunterId) ?? d.hunters[0];
      enrichHunter(act, isGM ? 'Bartholomew Thunderforge-Ironhide the Undying' : playerName, isGM ? 'g0' : 'p0');

      // GM-side extra hunters, custom monsters, gates, and large session log
      if (isGM) {
        const extraNames: [string, boolean][] = [
          ['Cassiopeia Nightwhisper-Valkyrien of Ironwake', false],
          ['Demetrius Stormbreaker-Ashborne the Fallen', true],
          ['Evangeline Frostweaver-Holloway of Ninth Hour', false],
          ['Ferdinand Blackthorn-Carrow, Guild Quartermaster', false],
        ];
        while (d.hunters.length < 1 + extraNames.length) d.hunters.push({ name: 'Extra' });
        extraNames.forEach(([nm, dead], i) => enrichHunter(d.hunters[i + 1], nm, `gx${i}`, { dead }));

        // Busy custom monsters including a mythic boss
        const customMonsters = [
          { id: 'mb1', name: 'Arch-Sovereign Malakor, Devourer of the Seventh Horizon', rank: 'S', archetype: 'brute', kind: 'boss', type: 'Dragon', script: 'plain', tweak: { hp: 0, stats: {}, traits: ['armored', 'fierce'] }, abilities: [], xp: 25000, desc: 'Ancient calamity sovereign with layered phase scripts and abyssal omen blasts.' },
          { id: 'mb2', name: 'Abyssal Sanctum Dread-Knight Vanguard Captain', rank: 'A', archetype: 'brute', kind: 'elite', type: 'Undead', tweak: { hp: 0, stats: {}, traits: ['tough'] }, abilities: [], xp: 6400, desc: 'Holds choke points with heavy shield walls.' },
          { id: 'mb3', name: 'Venomous Obsidian Chitin-Stalker Matriarch', rank: 'A', archetype: 'skirmisher', kind: 'elite', type: 'Beast', tweak: { hp: 0, stats: {}, traits: ['swift'] }, abilities: [], xp: 5200, desc: 'Ambushes casters from shadowed ledges.' },
          { id: 'mb4', name: 'Hollow-Star Void-Choir Arch-Cantor', rank: 'B', archetype: 'caster', kind: 'normal', type: 'Demon', tweak: { hp: 0, stats: {}, traits: [] }, abilities: [], xp: 2400, desc: 'Drains mana and layers corrosion marks.' },
          { id: 'mb5', name: 'Crimson Ash-Forged Siege Golem Colossus', rank: 'B', archetype: 'brute', kind: 'normal', type: 'Construct', tweak: { hp: 0, stats: {}, traits: ['armored'] }, abilities: [], xp: 2200, desc: 'Slow, unstoppable frontline breaker.' },
          { id: 'mb6', name: 'Frostbite Mirror-Wraith Sentinel', rank: 'C', archetype: 'caster', kind: 'normal', type: 'Undead', tweak: { hp: 0, stats: {}, traits: ['swift'] }, abilities: [], xp: 900, desc: 'Splits light into blinding lances.' },
        ];
        d.monsters = [...(d.monsters || []), ...customMonsters];

        // Gates of every type with long names
        d.gates = [
          { id: 'gb1', name: 'The Drowned Cathedral of Saint Averno (Seventh Horizon)', rank: 'S', type: 'double', status: 'detected', breakDay: d.world.day + 4, createdDay: d.world.day, clearedDay: null, xpPaid: false, monsters: [{ monsterId: 'mb2', count: 3 }, { monsterId: 'mb4', count: 2 }], bossId: 'mb1', notes: 'Double dungeon confirmed by Association scouts.' },
          { id: 'gb2', name: 'Frozen Crimson Citadel of the Shattered Ice-Monarch', rank: 'A', type: 'red', status: 'raiding', breakDay: d.world.day + 2, createdDay: d.world.day, clearedDay: null, xpPaid: false, monsters: [{ monsterId: 'mb3', count: 4 }], bossId: 'mb2', notes: 'No exit until the boss falls; time runs 10x inside.' },
          { id: 'gb3', name: 'Overgrown Obsidian Foundry of the Ash-Forged Legion', rank: 'B', type: 'normal', status: 'broken', breakDay: d.world.day, createdDay: Math.max(1, d.world.day - 5), clearedDay: null, xpPaid: false, monsters: [{ monsterId: 'mb5', count: 3 }, { monsterId: 'mb6', count: 2 }], bossId: 'mb5', notes: 'Break perimeter held by Aurelian vanguard.' },
        ];
      }

      // Full session log (40 long entries)
      const kinds = ['combat', 'award', 'gate', 'quest', 'use', 'system'];
      d.log = Array.from({ length: 40 }, (_, i) => ({
        id: `lb${i + 1}`,
        at: new Date(Date.now() - i * 60_000).toISOString(),
        kind: kinds[i % kinds.length],
        hunterId: act.id,
        title: `Round ${40 - i}: ${playerName} vs Arch-Sovereign Malakor`,
        text: `Detailed session chronicle entry #${40 - i} recording guild cut (22.5%), System debt repayment (12,500 gold), crystal salvage (4,850 mana crystal), and Abyssal Mana-Corrosion Resonance Mark stacks.`,
      }));

      // Full roll log (25 long entries)
      d.rolls = Array.from({ length: 25 }, (_, i) => ({
        id: `rb${i + 1}`,
        at: new Date(Date.now() - i * 45_000).toISOString(),
        hid: act.id,
        who: isGM ? 'Bartholomew Thunderforge-Ironhide the Undying' : playerName,
        kind: i % 2 === 0 ? 'check' : 'die',
        label: `Abyssal Labyrinth Athletics & Perception Check #${25 - i}`,
        expr: '4d12+2d6+15',
        rolls: [12, 9, 11, 8, 6, 5],
        total: 66 - (i % 15),
        natural: i === 0 ? 20 : i === 1 ? 1 : 14,
        crit: i === 0,
        fumble: i === 1,
        adv: i % 3 === 0,
        dis: i % 5 === 0 && i % 3 !== 0,
        check: i % 2 === 0 ? { dc: 22, success: i % 4 !== 1 } : null,
      }));
    }, 'busy-fixture');
  }, { isGM: asGM, playerName: BUSY_PLAYER });

  await applyBusy(player, false);
  // Mark the GM's busy world gates as already told on the player's phone before the GM writes them,
  // so no "A GATE HAS APPEARED" / "Dungeon Break" popups interrupt the sweep when the world doc syncs.
  await player.evaluate(() => {
    const code = hunterApp.api.sync.room();
    const campaign = hunterApp.store.told().campaign;
    if (!code || !campaign) return;
    for (const [id, broke] of [['gb1', false], ['gb2', false], ['gb3', true]] as const) {
      hunterApp.store.tell({ type: 'answered', campaign, topic: { of: 'room', room: code }, id, broke });
    }
  });
  await applyBusy(gm, true);
  // Wait for player's updated long-named sheet to sync to the GM's party board
  await go(gm, 'gm');
  await expect(gm.locator('#gm-board .gm-card.remote', { hasText: BUSY_PLAYER })).toHaveCount(1, { timeout: 20_000 });
  await dismissAll(player, 6);
}

/** Starts a 10-combatant busy fight (4 hunters + 6 monsters including mythic boss, long statuses, and 25-entry fight log). */
async function startBusyFight(gm: Page, player: Page): Promise<void> {
  await go(gm, 'combat');
  await combat(gm).locator('[data-hsel]').selectOption({ label: `${BUSY_PLAYER} (player phone)` });
  await combat(gm).locator('[data-addh]').tap();
  await combat(gm).locator('[data-addparty]').tap();
  await combat(gm).locator('[data-qline]').fill('Arch-Sovereign Malakor, S, brute, boss');
  await combat(gm).locator('[data-qadd]').tap();
  await combat(gm).locator('[data-qline]').fill('Abyssal Sanctum Dread-Knight x3, A, brute, elite');
  await combat(gm).locator('[data-qadd]').tap();
  await combat(gm).locator('[data-qline]').fill('Hollow-Star Void-Choir Arch-Cantor x2, B, caster');
  await combat(gm).locator('[data-qadd]').tap();
  await combat(gm).locator('[data-start]').tap();
  await expect(map(gm).locator('.mp-tok.now')).toHaveCount(1);

  await gm.evaluate(name => hunterApp.store.update((d: any) => {
    const f = d.fight;
    const me = f.rows.find((r: any) => r.name === name);
    const boss = f.rows.find((r: any) => r.name.includes('Malakor'));
    const rest = f.rows.filter((r: any) => r !== me && r !== boss);
    me.place = { x: 2, y: 2 }; me.at = f.now; me.tie = 0;
    boss.place = { x: 2, y: 4 }; boss.at = f.now + 100; boss.tie = 0;
    boss.shield = { amount: 140, until: f.now + 3000 };
    boss.stagger = { fill: 55, max: 100, hit: 25 };
    rest.forEach((r: any, i: number) => {
      r.place = { x: 1 + (i % 5), y: i < 4 ? 1 : 5 + Math.floor((i - 4) / 5) };
      r.at = f.now + 200 + i * 50;
      r.tie = 0;
    });
    f.currentId = me.id;
    f.log = Array.from({ length: 25 }, (_, i) => ({
      text: `R${25 - i}: ${name} hits Arch-Sovereign Malakor for ${42 + i} damage (Abyssal Mana-Corrosion Resonance Mark x3 active).`,
      rows: [],
      zones: [],
    }));
  }, 'busy-fight-setup'), BUSY_PLAYER);

  await setupDoc(player, BUSY_PLAYER, { x: 2, y: 2 });
  await go(player, 'combat');
  await expect(combat(player).locator('.tb-mine')).toBeVisible();
}

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

  test(`at ${size.width} by ${size.height} with a busy campaign, every view and floating card (coin card, toasts, popups, HUD) has no overlap and no horizontal overflow`, async ({ device }) => {
    test.setTimeout(240_000);
    const reducedSeed = { 'hunter-system-prefs': JSON.stringify({ motion: 'reduce' }) };
    const gm = (await device('gm', { viewport: size, seed: reducedSeed })).page;
    const player = (await device('player', { viewport: size, userAgent: ANDROID_UA, seed: reducedSeed })).page;
    await room(gm, player, BUSY_PLAYER);
    await seedBusy(gm, player);

    const found: Finding[] = [];

    await test.step('player out of a fight (every view + Bag Shop tab)', async () => {
      found.push(...await sweep(player, 'busy player', { checkBottom: true }));
      await go(player, 'status');
      if (SHOTS && size.width === 360) {
        await player.locator('#view-status [data-panel="attributes"]').scrollIntoViewIfNeeded();
        await shot(player, 'stat-share-360');
      }
      await player.locator('#view-status [data-panel="inventory"] [data-tab="shop"]').tap();
      found.push(...await check(player, 'busy player status (Bag Shop)', { checkBottom: true }));
      await player.locator('#view-status [data-panel="inventory"] [data-tab="items"]').tap();
    });

    await test.step('GM out of a fight (every view + expanded GM cheat/party/award/log sections)', async () => {
      await go(gm, 'gm');
      for (const sec of ['cheat', 'party', 'award', 'log']) {
        const tog = gm.locator(`#view-gm [data-tog="${sec}"]`);
        if ((await tog.getAttribute('aria-expanded')) !== 'true') await tog.tap();
      }
      if (SHOTS && size.width === 360) {
        await gm.locator('#gm-board .gm-card.remote').first().scrollIntoViewIfNeeded();
        await shot(gm, 'gm-x-360');
      }
      found.push(...await sweep(gm, 'busy gm', { checkBottom: true }));
      if (SHOTS && size.width === 360) {
        await go(gm, 'status');
        await gm.locator('#view-status [data-panel="titles"]').scrollIntoViewIfNeeded();
        await shot(gm, 'titles-btns-360');
      }
    });

    await test.step('floating cards: coin card (docked & floating), toasts, quick roll sheet, and busy popups', async () => {
      // Trigger a natural 20 check on Dice view -> coin card opens docked inside #view-dice [data-coin-slot]
      await go(player, 'dice');
      await player.evaluate(() => { (window as any).__r = Math.random; Math.random = () => 0.99; });
      try { await player.locator('#view-dice [data-st="str"]').tap(); } finally { await player.evaluate(() => { Math.random = (window as any).__r; }); }
      const pCard = player.locator('[data-coin-card]');
      await expect(pCard).toBeVisible();
      const dockedOnDice = await pCard.evaluate(el => !!el.closest('#view-dice [data-coin-slot]') && getComputedStyle(el).position === 'static');
      if (!dockedOnDice) found.push({ view: 'busy player dice + coin', what: 'coin card is not docked statically inside #view-dice [data-coin-slot]' });
      found.push(...await check(player, 'busy player dice + docked coin', { checkBottom: true }));

      // Move to Status -> coin card floats fixed over body; check nav clearance & bottom-of-scroll reachability
      await go(player, 'status');
      await expect(pCard).toBeVisible();
      found.push(...await check(player, 'busy player status + floating coin', { checkBottom: true }));

      // Raise 2 simultaneous toasts while floating coin card is open on Status!
      await player.evaluate(() => {
        hunterApp.ui.toast('System', 'Guild cut applied: 22.5% to Order of the Aurelian Sovereign Vanguard Syndicate.');
        hunterApp.ui.toast('Warning', 'System debt balance remaining: 450,000 gold across upcoming clears.', { kind: 'warning' });
      });
      await expect(player.locator('#toasts .toast')).toHaveCount(2);
      if (SHOTS && size.width === 360) await shot(player, 'coin-toast-player-360');
      found.push(...await check(player, 'busy player status + floating coin + 2 toasts', { checkBottom: true }));

      // Open Quick roll sheet while coin card & toasts are active -> coin card docks inside #dice-sheet [data-coin-slot]
      await player.locator('#nav-bottom a[href="#/dice"]').tap();
      await expect(player.locator('#dice-sheet')).toBeVisible();
      const dockedInSheet = await pCard.evaluate(el => !!el.closest('#dice-sheet [data-coin-slot]') && getComputedStyle(el).position === 'static');
      if (!dockedInSheet) found.push({ view: 'busy player quick roll + coin', what: 'coin card is not docked statically inside #dice-sheet [data-coin-slot]' });
      if (SHOTS) await shot(player, `dice-sheet-toast-${size.width}`);
      found.push(...await check(player, 'busy player quick roll + docked coin + toasts', { checkBottom: true }));
      await player.locator('#dice-sheet [data-close]').tap();
      await expect(player.locator('#dice-sheet')).toBeHidden();

      // Call Heads -> GM gets Coin call popup; check popup + toasts, then Escape -> GM floating put-off coin card
      await pCard.locator('[data-call="heads"]').tap();
      const gmCoinWin = gm.locator('.sys-overlay.show', { hasText: 'Coin call' });
      await expect(gmCoinWin).toBeVisible({ timeout: 20_000 });
      await gm.evaluate(() => {
        hunterApp.ui.toast('GM', 'Player roll arrived from Alexandria Valeriana-Kestrelsworth-Montague III.');
        hunterApp.ui.toast('GM', 'Second notice while Coin call window is open.');
      });
      found.push(...await check(gm, 'busy gm coin call popup + 2 toasts', { checkBottom: true }));
      await gm.keyboard.press('Escape');
      await expect(gmCoinWin).toHaveCount(0);
      await expect(gm.locator('[data-coin-card] [data-put-off]')).toHaveCount(1);
      await go(gm, 'gm');
      if (SHOTS && size.width === 360) await shot(gm, 'coin-toast-gm-360');
      found.push(...await check(gm, 'busy gm + floating put-off coin + toasts', { checkBottom: true }));

      // Settle the coin call so the card closes cleanly before modals/fight
      await gm.locator('[data-coin-card] [data-rule]').tap();
      await expect(gmCoinWin).toBeVisible();
      await gmCoinWin.locator('.sys-actions button').first().tap();
      await expect(gmCoinWin).toHaveCount(0);
      await expect(pCard.locator('[data-close]')).toBeVisible({ timeout: 20_000 });
      await pCard.locator('[data-close]').tap();
      await expect(pCard).toBeHidden();

      // Player Sell mana crystal modal (debt + large crystal balance) + 2 toasts
      await go(player, 'status');
      const sellBtn = player.locator('#view-status [data-sell-crystal]');
      await sellBtn.scrollIntoViewIfNeeded();
      await sellBtn.tap();
      await expect(player.locator('.sys-overlay.show')).toBeVisible();
      await player.evaluate(() => {
        hunterApp.ui.toast('System', 'Crystal exchange rates loaded while modal is open.');
      });
      if (SHOTS && size.width === 360) await shot(player, 'sell-crystal-360');
      found.push(...await check(player, 'busy player sell crystal modal + toast', { checkBottom: true }));
      await player.keyboard.press('Escape');
      await expect(player.locator('.sys-overlay.show')).toHaveCount(0);

      // Player More menu popup
      await player.locator('#more-btn').tap();
      await expect(player.locator('.sys-overlay.show')).toBeVisible();
      found.push(...await check(player, 'busy player More menu popup', { checkBottom: true }));
      await player.keyboard.press('Escape');
      await expect(player.locator('.sys-overlay.show')).toHaveCount(0);

      // GM Guild edit modal (long hunter name, custom guild name, custom cuts)
      await go(gm, 'gm');
      const guildBtn = gm.locator('#gm-board .gm-card [data-hguild]').first();
      await guildBtn.scrollIntoViewIfNeeded();
      await guildBtn.tap();
      await expect(gm.locator('.sys-overlay.show')).toBeVisible();
      found.push(...await check(gm, 'busy gm guild modal', { checkBottom: true }));
      await gm.keyboard.press('Escape');
      await expect(gm.locator('.sys-overlay.show')).toHaveCount(0);
    });

    await test.step('in a busy 10-combatant fight (Map HUD, confirm bar, sheets, sticky table feed, List mode)', async () => {
      await startBusyFight(gm, player);

      // Player combat Map mode: HUD + hotbar + aimed confirm bar + map news + toast
      await go(player, 'combat');
      found.push(...await check(player, 'busy player fight (map)', { checkBottom: true }));
      await tapTile(player, 2, 3);
      await expect(map(player).locator('[data-confirm]')).toBeVisible();
      await player.evaluate(() => {
        hunterApp.ui.news('Alexandria Valeriana-Kestrelsworth-Montague III targets Arch-Sovereign Malakor.', 'warning');
        hunterApp.ui.toast('System', 'Toast while map confirm bar and news are visible.');
      });
      found.push(...await check(player, 'busy player fight (map + confirm + news + toast)', { checkBottom: true }));
      await map(player).locator('[data-cancel]').tap();
      // Player map token sheet (.tb-sheet)
      const bossTokP = map(player).locator('.mp-tok.foe').first();
      await bossTokP.tap();
      await expect(combat(player).locator('.tb-sheet')).toBeVisible();
      found.push(...await check(player, 'busy player fight (map + token sheet)', { checkBottom: true }));
      await combat(player).locator('.tb-sheet button').first().tap();
      // Player combat List mode
      await combat(player).locator('[data-fview="list"]').tap();
      found.push(...await check(player, 'busy player fight (list)', { checkBottom: true }));

      // GM combat Map mode + fresh sticky Table feed + toast
      await go(gm, 'combat');
      await gm.evaluate(() => {
        hunterApp.emit('sync:event', { event: { id: 'e-busy-roll-1', at: Date.now(), from: 'p1', type: 'roll', payload: { eid: 'e-busy-roll-1', name: 'Alexandria Valeriana-Kestrelsworth-Montague III', label: 'Abyssal Wyrmfang Greatsword', expr: '3d10+6', total: 29, crit: false, fumble: false } } });
        hunterApp.ui.toast('GM', 'Toast during GM map mode with fresh table feed.');
      });
      await expect(combat(gm).locator('[data-fresh]')).toHaveCount(1);
      found.push(...await check(gm, 'busy gm fight (map + fresh feed + toast)', { checkBottom: true }));

      // GM map combatant sheet ([data-cardbox].sheet): dismiss the toast and frame the map before tapping the boss token
      for (const x of await gm.locator('#toasts .toast .t-x').all()) if (await x.isVisible()) await x.tap();
      await map(gm).locator('[data-frame]').dblclick({ position: { x: 4, y: 4 } });
      await tapTile(gm, 2, 4);
      await expect(combat(gm).locator('[data-cardbox].sheet')).toBeVisible();
      found.push(...await check(gm, 'busy gm fight (map + combatant sheet)', { checkBottom: true }));
      await combat(gm).locator('[data-cardbox].sheet .cmb-sheetx').tap();

      // GM map tools drawer (.cmb-tools.open)
      await combat(gm).locator('[data-tools-open]').tap();
      await expect(combat(gm).locator('.cmb-tools.open')).toBeVisible();
      found.push(...await check(gm, 'busy gm fight (map + tools sheet)', { checkBottom: true }));
      await combat(gm).locator('.cmb-tools.open [data-toolsx]').tap();
      await expect(combat(gm).locator('.cmb-tools.open')).toHaveCount(0);

      // GM combat List mode (10 rows + selected boss card + 25-line log + fresh sticky feed)
      await combat(gm).locator('[data-fview="list"]').tap();
      found.push(...await check(gm, 'busy gm fight (list + fresh feed)', { checkBottom: true }));
    });

    expect(report(found)).toEqual([]);
  });
}
