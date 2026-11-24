import { test, expect, openApp, onboardGM, onboardPlayer, go, dismissAll, startGoblinDenFight, chooseList, answerWindow, createRoom, PHONE, SMALL_PHONE } from './helpers.ts';
import { EXAMPLE_STORIES } from '../../src/core/registry/stories.ts';
import { WAYS_BACK } from '../../src/core/hunter/vitals.ts';
import type { Locator } from '@playwright/test';

test('on a phone, three toasts in a row show the last two above the bottom bar, and the bottom bar can still be tapped', async ({ device }) => {
  const player = (await device('player', { viewport: SMALL_PHONE })).page;
  await onboardPlayer(player, 'Mira Test');
  const toasts = player.locator('#toasts .toast');
  const bar = player.locator('#nav-bottom');

  await test.step('three toasts are raised and the two newest show', async () => {
    await player.evaluate(() => ['First', 'Second', 'Third'].forEach(m => hunterApp.ui.toast('System', `${m} notice.`)));
    await expect(toasts).toHaveCount(2);
    await expect(toasts.nth(0)).toContainText('Second notice.');
    await expect(toasts.nth(1)).toContainText('Third notice.');
    await expect(player.locator('#toasts')).toHaveAttribute('aria-live', 'polite');
    await expect(toasts.last().getByRole('button', { name: 'Dismiss notification' })).toBeVisible();
  });

  await test.step('the toasts sit above the bottom bar, not over it', async () => {
    const box = await player.locator('#toasts').boundingBox(), nav = await bar.boundingBox();
    expect(box && nav && box.y + box.height <= nav.y).toBe(true);
  });

  await test.step('a tap on the Quests tab opens Quests while the toasts are up', async () => {
    await expect(toasts).toHaveCount(2);
    await bar.getByRole('link', { name: /Quests/ }).tap();
    await expect(player).toHaveURL(/#\/quests$/);
  });
});

test('on a 390 px phone, with an item, a title and a boon in the Award form, Send award is in view without scrolling and one tap sends it', async ({ device }) => {
  const gm = (await device('gm', { viewport: PHONE })).page;
  await onboardGM(gm);
  await go(gm, 'gm');
  const toggle = gm.locator('[data-tog="award"]');
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.tap();
  const ed = gm.locator('#gm-rw');
  const send = gm.locator('#gm-award-go');

  await test.step('the GM picks Brakk and adds an item, the title Wolf Slayer and a boon', async () => {
    await gm.locator('#gm-targets label', { hasText: 'Brakk Ironhide' }).locator('input').check();
    await ed.locator('[data-add="item"]').tap();
    await ed.locator('[data-kind="item"] [data-f="pick"]').selectOption({ index: 1 });
    await ed.locator('[data-add="title"]').tap();
    await ed.locator('[data-kind="title"] [data-f="tpick"]').selectOption('Wolf Slayer');
    await ed.locator('[data-add="boon"]').tap();
    await ed.locator('[data-kind="boon"] [data-f="name"]').fill('Free resurrection');
    await ed.locator('[data-kind="boon"] [data-f="text"]').fill('Once.');
  });

  await test.step('Send award is on screen where the boon was typed, without a scroll', async () => {
    const y = await gm.evaluate(() => scrollY);
    await expect(send).toBeInViewport({ ratio: 1 });
    expect(await gm.evaluate(() => scrollY)).toBe(y);
  });

  await test.step('one tap sends it: the form names Brakk, and Brakk has the boon and the title', async () => {
    await send.tap();
    await expect(gm.locator('#gm-award-msg')).toHaveText('Sent to Brakk Ironhide.');
    await dismissAll(gm, 4);
    const brakk = await gm.evaluate(() => hunterApp.store.get().hunters.find((h: any) => h.name === 'Brakk Ironhide'));
    expect(brakk.boons.map((b: { name: string }) => b.name)).toEqual(['Free resurrection']);
    expect(brakk.titles.map((t: { name: string }) => t.name)).toContain('Wolf Slayer');
  });
});

test('on a 360 px phone a Poisoned, Penalized hunter sees both condition chips on the first screen of the sheet', async ({ device }) => {
  const player = (await device('player', { viewport: SMALL_PHONE })).page;
  await onboardPlayer(player, 'Mira Test');
  await dismissAll(player, 4);

  await test.step('the hunter misses a daily and is poisoned', async () => {
    // the rollover runs as soon as the save shows a day unchecked, so the Penalty window follows the change itself
    await player.evaluate(() => hunterApp.store.update(() => { hunterApp.store.active().daily.lastCheckedKey = '2000-01-01'; }, 'test-setup'));
    await expect(player.locator('.sys-overlay.show .sys-window', { hasText: 'Penalty Zone' }).first()).toBeVisible();
    await dismissAll(player, 6);
    await go(player, 'status');
    await player.locator('#view-status [data-cond-sel]').selectOption('poisoned');
    await player.locator('#view-status [data-cond-add]').tap();
  });

  await test.step('both chips are in view without a scroll, and the identity is text with an Edit button', async () => {
    await go(player, 'status');
    expect(await player.evaluate(() => scrollY)).toBe(0);
    await expect(player.locator('#view-status [data-chip="penalized"]')).toBeInViewport({ ratio: 1 });
    await expect(player.locator('#view-status [data-chip="poisoned"]')).toBeInViewport({ ratio: 1 });
    await expect(player.locator('#view-status [data-idname]')).toHaveText('Mira Test');
    await expect(player.locator('#view-status [data-idform]')).toBeHidden();
    await expect(player.locator('#view-status [data-delhunter]')).toHaveCount(0);
  });

  await test.step('the jump row fades at the right, where it still scrolls', async () => {
    await expect(player.locator('#view-status .jump-chips')).toHaveClass(/fade-r/);
  });

  await test.step('the jump chips are in the order of the sections they lead to, Skills after Titles and Chronicle', async () => {
    const chips = await player.locator('#view-status [data-jump]').evaluateAll(bs => bs.map(b => (b as HTMLElement).dataset.jump!));
    expect(chips).toEqual(['attributes', 'titles', 'chronicle', 'skills', 'equipment', 'inventory']);
    const onPage = await player.locator('#view-status [data-panel]').evaluateAll(ps => ps.map(p => (p as HTMLElement).dataset.panel!));
    expect(onPage.filter(id => chips.includes(id)), 'the sheet draws the same sections in the same order').toEqual(chips);
  });
});

test('on a 360 px phone a dead hunter\'s sheet shows Dead and the way back on the first screen, in words that wrap within the width', async ({ device }) => {
  const player = (await device('player', { viewport: SMALL_PHONE })).page;
  await onboardPlayer(player, 'Mira Test');
  await dismissAll(player, 4);
  await player.evaluate(() => hunterApp.store.update((d: any) => { d.rulesOverrides.solo = { personal: false }; hunterApp.store.active().life = { at: 'dead' }; }, 'test-setup'));
  await go(player, 'status');
  const death = player.locator('#view-status [data-death]'), back = death.locator('[data-wayback]');
  await expect(death.locator('[data-life]')).toHaveText('Dead');
  await expect(back).toHaveText(`${WAYS_BACK} brings you back and removes every status.`);
  await expect(back).toBeInViewport({ ratio: 1 });
  const box = await back.boundingBox(), size = await back.evaluate(e => parseFloat(getComputedStyle(e).fontSize));
  expect(box!.x + box!.width, 'the line ends inside the screen').toBeLessThanOrEqual(360);
  expect(size, 'the line is at least 12 px').toBeGreaterThanOrEqual(12);
  expect(await player.evaluate(() => document.scrollingElement!.scrollWidth <= innerWidth), 'the page does not scroll sideways').toBe(true);
});

test('on the sheet, Edit opens the name, job and title inputs and a new name is saved and shown', async ({ device }) => {
  const player = (await device('player', { viewport: SMALL_PHONE })).page;
  await onboardPlayer(player, 'Mira Test');
  await dismissAll(player, 4);
  await go(player, 'status');
  const form = player.locator('#view-status [data-idform]');

  await player.locator('#view-status [data-idedit]').tap();
  for (const f of ['name', 'job', 'title']) await expect(form.locator(`[data-f="${f}"]`)).toBeVisible();
  await form.locator('[data-f="name"]').fill('Mira Vale');
  await form.locator('[data-f="job"]').fill('Ranger');
  await form.locator('[data-iddone]').tap();

  await expect(form).toBeHidden();
  await expect(player.locator('#view-status [data-idname]')).toHaveText('Mira Vale');
  await expect(player.locator('#view-status [data-idsub]')).toHaveText('Ranger');
  expect(await player.evaluate(() => hunterApp.store.active().name)).toBe('Mira Vale');
});

test('Delete hunter is in the Party panel, asks for the name and takes a backup first', async ({ device }) => {
  const player = (await device('player', { viewport: SMALL_PHONE })).page;
  await onboardPlayer(player, 'Mira Test');
  await dismissAll(player, 4);
  await go(player, 'status');
  // setup: personal gates off, so the spare hunter's first gate window does not stand in front of the delete's
  await player.evaluate(() => hunterApp.store.update((s: any) => { s.rulesOverrides.solo = { personal: false }; s.hunters.push({ name: 'Spare Test', daily: { lastCheckedKey: s.world.lastDailyKey } }); }, 'test-setup'));
  const row = player.locator('#view-status [data-panel="party"] li', { hasText: 'Spare Test' });
  const backups0 = await player.evaluate(() => hunterApp.store.backups().length);

  await row.locator('[data-pdel]').tap();
  const win = player.locator('.sys-overlay.show');
  await expect(win).toContainText('Delete Spare Test?');
  await win.locator('input').fill('Spare Test');
  await win.locator('.sys-actions button.danger').tap();

  await expect(player.locator('#view-status [data-panel="party"] li', { hasText: 'Spare Test' })).toHaveCount(0);
  expect(await player.evaluate(() => hunterApp.store.backups().length)).toBe(backups0 + 1);
  expect(await player.evaluate(() => hunterApp.store.get().hunters.map((h: any) => h.name))).toEqual(['Mira Test']);
});

test('Delete hunter with no room left for its backup says so and deletes only when asked again', async ({ device }) => {
  const player = (await device('player', { viewport: SMALL_PHONE })).page;
  await onboardPlayer(player, 'Mira Test');
  await dismissAll(player, 4);
  await go(player, 'status');
  // setup: personal gates off, so the spare hunter's first gate window does not stand in front of the delete's
  await player.evaluate(() => hunterApp.store.update((s: any) => { s.rulesOverrides.solo = { personal: false }; s.hunters.push({ name: 'Spare Test', daily: { lastCheckedKey: s.world.lastDailyKey } }); }, 'test-setup'));
  await player.evaluate(() => {
    const set = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k: string, v: string) { if (k === 'hunter-system-backups') throw new DOMException('full', 'QuotaExceededError'); set.call(this, k, v); };
  });
  const row = () => player.locator('#view-status [data-panel="party"] li', { hasText: 'Spare Test' });
  const win = player.locator('.sys-overlay.show');
  const askDelete = async () => {
    await row().locator('[data-pdel]').tap();
    await expect(win).toContainText('Delete Spare Test?');
    await win.locator('input').fill('Spare Test');
    await win.locator('.sys-actions button.danger').tap();
    await expect(win).toContainText('No backup saved');
  };

  await askDelete();
  await win.locator('.sys-actions button', { hasText: 'Cancel' }).tap();
  await expect(row()).toHaveCount(1);

  await askDelete();
  await win.locator('.sys-actions button', { hasText: 'Delete' }).tap();
  await expect(row()).toHaveCount(0);
});

test('on a 360 px phone the quick dice sheet keeps the seven dice on one row and leaves one tab lit', async ({ device }) => {
  const player = (await device('player', { viewport: SMALL_PHONE })).page;
  await onboardPlayer(player, 'Mira Test');
  await dismissAll(player, 4);
  const bar = player.locator('#nav-bottom');
  const status = bar.locator('a[href="#/status"]'), dice = bar.locator('a[href="#/dice"]');
  const litTop = (target: typeof status) => target.evaluate(el => getComputedStyle(el).borderTopColor);
  const statusLit = await litTop(status);

  await test.step('the Dice tab opens the sheet and is the only lit tab', async () => {
    await dice.tap();
    await expect(player.locator('#dice-sheet')).toBeVisible();
    await expect(dice).toHaveAttribute('aria-expanded', 'true');
    expect(await litTop(dice)).toBe(statusLit);
    expect(await litTop(status)).not.toBe(statusLit);
  });

  await test.step('d4 to d100 sit on one row', async () => {
    const buttons = player.locator('#dice-sheet .dice-btns button');
    await expect(buttons).toHaveCount(7);
    const tops = await buttons.evaluateAll(els => els.map(el => Math.round(el.getBoundingClientRect().top)));
    expect(new Set(tops).size).toBe(1);
    const widths = await buttons.evaluateAll(els => els.map(el => el.getBoundingClientRect().width));
    expect(Math.min(...widths)).toBeGreaterThanOrEqual(40);
  });

  await test.step('closing the sheet lights the Status tab again', async () => {
    await player.locator('#dice-sheet [data-close]').tap();
    await expect(player.locator('#dice-sheet')).toBeHidden();
    expect(await litTop(status)).toBe(statusLit);
  });
});

test('a new hunter with no job and no title shows no "None" under the name', async ({ device }) => {
  const player = (await device('player', { viewport: SMALL_PHONE })).page;
  await onboardPlayer(player, 'Mira Test');
  await go(player, 'status');
  await expect(player.locator('[data-idname]')).toHaveText('Mira Test');
  await expect(player.locator('[data-idsub]')).toHaveText('');
  await expect(player.locator('[data-idread]')).not.toContainText('None');
});

test('on the inventory, Store is the one filled button and is 44 px tall; Save current gear is plain', async ({ device }) => {
  const player = (await device('player', { viewport: SMALL_PHONE })).page;
  await onboardPlayer(player, 'Mira Test');
  await go(player, 'status');
  const store = player.getByRole('button', { name: 'Add to bag', exact: true });
  await store.scrollIntoViewIfNeeded();
  const box = await store.boundingBox();
  expect(box && box.height).toBeGreaterThanOrEqual(44);
  await expect(player.locator('[data-losave]')).not.toHaveClass(/primary/);
  await expect(store).toHaveClass(/primary/);
});

test('at 1280 the status maker keeps its preview in the right column in view while the effects scroll', async ({ device }) => {
  const gm = (await device('gm', { viewport: { width: 1280, height: 800 }, mouse: true })).page;
  await openApp(gm);
  for (const step of ['[data-yes]', '[data-gm]', '[data-starter]', '[data-oblater]']) await gm.locator(`.ob-overlay ${step}`).click();
  await expect(gm.locator('.ob-overlay')).toHaveCount(0);
  await go(gm, 'workshop');
  await gm.locator('#view-workshop [data-ws="status"] [data-new]').click();
  const dlg = gm.locator('.fg-overlay [role=dialog]');
  await expect(dlg.getByRole('heading', { name: 'New status' })).toBeVisible();
  for (let i = 0; i < 6; i++) await dlg.locator('[data-quick] [data-q="d4"]').click();
  await dlg.locator('.mk-scroll').evaluate(el => { el.scrollTop = 0; });
  const preview = dlg.locator('.mk-preview');
  await expect(preview).toBeInViewport({ ratio: 1 });
  const box = await preview.boundingBox(), win = await dlg.boundingBox();
  expect(box && win && box.x > win.x + win.width / 2 - 40).toBe(true);
});

test('on a 390 px phone the map maker shows its brushes and the map\'s first rows on the first screen, the map scrolls inside its frame, and every button is at least 44 px tall', async ({ device }) => {
  const gm = (await device('gm', { viewport: PHONE })).page;
  await onboardGM(gm);
  await go(gm, 'workshop');
  await gm.locator('#view-workshop [data-ws="map"] [data-new]').tap();
  const d = gm.locator('.mpm-overlay [role=dialog]');
  await expect(d.locator('[data-brush="wall"]')).toBeInViewport();
  await expect(d.locator('[data-grid] [data-i="0"]')).toBeInViewport();
  expect(await gm.evaluate(() => document.scrollingElement!.scrollWidth <= innerWidth), 'the page does not scroll sideways').toBe(true);
  const scroller = d.locator('.mpm-scroll');
  expect(await scroller.evaluate(el => el.scrollWidth > el.clientWidth), 'the 20 columns scroll inside the map\'s frame').toBe(true);
  // measured once the window has finished arriving (it rises from 98% of its size)
  await expect.poll(() => gm.evaluate(() => document.getAnimations().filter(a => a.playState === 'running').length)).toBe(0);
  const short = await d.locator('button:visible').evaluateAll(els => els.filter(el => el.getBoundingClientRect().height < 44).map(el => el.textContent));
  expect(short).toEqual([]);
});

test('on a 390 px phone in a fight on the map, the map and its hotbar fit the first screen, Paint and Grid are 44 px buttons and the fight\'s news sits clear of the hotbar and the dock', async ({ device }) => {
  const gm = (await device('gm', { viewport: PHONE })).page;
  await onboardGM(gm);
  await chooseList(gm);
  await startGoblinDenFight(gm);
  await gm.locator('#view-combat [data-fview="map"]').tap();
  const map = gm.locator('#view-combat [data-mapbox]');
  await expect(map.locator('[data-hot] .mp-hb').first()).toBeVisible();

  await test.step('Paint and Grid are buttons a thumb can hit, and Grid shows when it is on', async () => {
    for (const name of ['Paint', 'Grid']) {
      const b = (await map.getByRole('button', { name, exact: true }).boundingBox())!;
      expect(Math.min(b.width, b.height), `${name} is at least 44 px each way`).toBeGreaterThanOrEqual(44);
    }
    await map.getByRole('button', { name: 'Grid', exact: true }).tap();
    await expect(map.getByRole('button', { name: 'Grid', exact: true })).toHaveAttribute('aria-pressed', 'true');
  });

  await test.step('with the page at its top the hotbar ends above the bottom bar', async () => {
    await gm.evaluate(() => scrollTo(0, 0));
    const hot = (await map.locator('[data-hot]').boundingBox())!, nav = (await gm.locator('.nav-bottom').boundingBox())!;
    expect(hot.y + hot.height).toBeLessThanOrEqual(nav.y);
  });

  await test.step('the fight\'s news is one line over the map, not a toast, clear of Next, the hotbar and Use and Cancel', async () => {
    await gm.evaluate(() => hunterApp.store.update((d: any) => {
      const f = d.fight, me = f.rows.find((r: any) => r.id === f.currentId), others = f.rows.filter((r: any) => r !== me);
      me.place = { x: 2, y: 2 }; others.forEach((r: any, i: number) => { r.place = r.name === 'Brakk Ironhide' ? { x: 3, y: 2 } : { x: 2 + i, y: 5 + i }; });
    }, 'test-setup'));
    await gm.evaluate(() => scrollTo(0, 0));
    await map.locator('[data-frame]').dblclick({ position: { x: 4, y: 4 } });
    const brakk = await gm.evaluate(() => hunterApp.store.get().fight.rows.find((r: any) => r.name === 'Brakk Ironhide').id);
    await map.locator('[data-hot] [data-ab]').first().tap();
    await expect(map.locator('[data-confirm]')).toBeVisible();
    const at = await map.locator('[data-world]').evaluate(w => {
      const r = w.getBoundingClientRect(), s = r.width / (w as HTMLElement).offsetWidth;
      return { x: r.left + 3.5 * 40 * s, y: r.top + 2.5 * 40 * s };
    });
    await gm.touchscreen.tap(at.x, at.y);
    await expect(map.locator('[data-words]')).toContainText('Brakk Ironhide');
    const confirm = (await map.locator('[data-confirm]').boundingBox())!;
    await map.locator('[data-go]').tap();
    const news = map.locator('[data-news]');
    await expect(news).toContainText(/uses .+ on Brakk Ironhide|Brakk Ironhide/);
    await expect(gm.locator('#toasts .toast')).toHaveCount(0);
    expect(await gm.evaluate(id => hunterApp.store.get().fight.currentId === id, brakk), 'the turn went on to Brakk').toBe(true);
    const line = (await news.boundingBox())!;
    for (const [name, b] of [['Next', (await gm.locator('#view-combat [data-next]').boundingBox())!], ['the hotbar', (await map.locator('[data-hot]').boundingBox())!], ['Use and Cancel', confirm]] as const) {
      expect(line.y + line.height <= b.y || line.y >= b.y + b.height || line.x + line.width <= b.x || line.x >= b.x + b.width, `the news line and ${name} do not overlap`).toBe(true);
    }
  });
});

test('on a 360 px phone the Fight tools keep each map size stepper, its label, minus, number and plus, on one row', async ({ device }) => {
  const gm = (await device('gm', { viewport: SMALL_PHONE })).page;
  await onboardGM(gm);
  await chooseList(gm);
  await startGoblinDenFight(gm);
  await gm.locator('#view-combat [data-fview="map"]').tap();
  await gm.locator('#view-combat [data-tools-open]').tap();
  const size = gm.locator('#view-combat [data-tools] .cmb-size');
  await expect(size).toBeVisible();
  const rows = await size.evaluate(el => ['w', 'h'].map(k => {
    const minus = el.querySelector(`[data-resize="${k}"][data-d="-1"]`)!, plus = el.querySelector(`[data-resize="${k}"][data-d="1"]`)!;
    const parts = [minus.previousElementSibling!, minus, el.querySelector(`[data-mapsize="${k}"]`)!, plus];
    return parts.map(p => { const r = p.getBoundingClientRect(); return Math.round(r.top + r.height / 2); });
  }));
  for (const [i, k] of ['Width', 'Height'].entries()) {
    const ys = rows[i]!;
    expect(Math.max(...ys) - Math.min(...ys), `${k}'s label, minus, number and plus share a row (${ys.join(', ')})`).toBeLessThanOrEqual(4);
  }
});

test('on a 390 px phone a pack of rats and a boss on the map each show their picture in the disc, the pack\'s letter in its corner and the boss\'s inside its stagger ring; a hunter shows its emblem, or its initials with none; the card, the order and the hotbar show theirs beside the words', async ({ device }) => {
  const gm = (await device('gm', { viewport: PHONE })).page;
  await onboardGM(gm);
  await chooseList(gm);
  await startGoblinDenFight(gm);
  const combat = gm.locator('#view-combat');
  for (const line of ['Cave Rat x3, E, brute', 'Ash Drake, C, caster, boss']) {
    await combat.locator('[data-qline]').fill(line);
    await combat.locator('[data-qadd]').tap();
  }
  const ids = await gm.evaluate(() => {
    let out = { rats: [] as string[], boss: '', brakk: '', mira: '' };
    hunterApp.store.update((d: any) => {
      d.hunters.find((h: any) => h.name === 'Brakk Ironhide').emblem = 'crown';
      d.hunters.find((h: any) => h.name === 'Mira Vale').emblem = '';
      const f = d.fight, rats = f.rows.filter((r: any) => r.name.startsWith('Cave Rat')), boss = f.rows.find((r: any) => r.name === 'Ash Drake');
      const brakk = f.rows.find((r: any) => r.name === 'Brakk Ironhide'), mira = f.rows.find((r: any) => r.name === 'Mira Vale');
      const others = f.rows.filter((r: any) => ![...rats, boss, brakk, mira].includes(r));
      rats.forEach((r: any, i: number) => { r.place = { x: 2 + i, y: 2 }; });
      boss.place = { x: 6, y: 2 }; boss.origin.type = 'Dragon'; boss.stagger = { fill: 40, max: 100, hit: 25 }; boss.shield = { amount: 20, until: f.now + 2000 };
      brakk.place = { x: 3, y: 4 }; mira.place = { x: 4, y: 4 };
      others.forEach((r: any, i: number) => { r.place = { x: 1 + 2 * i, y: 7 }; });
      out = { rats: rats.map((r: any) => r.id), boss: boss.id, brakk: brakk.id, mira: mira.id };
    }, 'test-setup');
    return out;
  });
  await combat.locator('[data-fview="map"]').tap();
  const map = combat.locator('[data-mapbox]'), tok = (id: string) => map.locator(`[data-tok="${id}"]`);
  await map.locator('[data-frame]').dblclick({ position: { x: 4, y: 4 } });
  /** What a token's disc shows: its picture's key and size, its letter and its initials, each only while shown. */
  const disc = (id: string) => tok(id).evaluate(t => {
    const shown = (el: Element | null) => !!el && getComputedStyle(el).display !== 'none' && !el.hasAttribute('hidden');
    const ic = t.querySelector('.mp-ic'), pk = t.querySelector('.mp-pk'), lbl = t.querySelector('.mp-lbl');
    return {
      icon: shown(ic) ? ic!.querySelector('use')!.getAttribute('href') : null, size: shown(ic) ? getComputedStyle(ic!).width : null, hidden: ic?.getAttribute('aria-hidden') ?? null,
      letter: shown(pk) ? pk!.textContent : null, letterPx: shown(pk) ? parseFloat(getComputedStyle(pk!).fontSize) : null, initials: shown(lbl) ? lbl!.textContent : null,
    };
  });

  await test.step('each rat shows a Cave Rat\'s picture (a brute with no type: the claw) with its pack\'s letter, 12 px, inside its own tile', async () => {
    for (const [i, id] of ids.rats.entries()) {
      expect(await disc(id)).toEqual({ icon: '#i-claw', size: '22px', hidden: 'true', letter: 'ABC'[i], letterPx: 12, initials: null });
      const inside = await tok(id).evaluate(t => { const a = t.getBoundingClientRect(), b = t.querySelector('.mp-pk')!.getBoundingClientRect(); return b.left >= a.left - 0.5 && b.right <= a.right + 0.5 && b.top >= a.top - 0.5 && b.bottom <= a.bottom + 0.5; });
      expect(inside, `Rat ${'ABC'[i]}'s letter stays inside its tile`).toBe(true);
      await expect(tok(id), 'the token still says its name').toHaveAttribute('aria-label', new RegExp(`^Cave Rat ${'ABC'[i]},`));
    }
  });
  await test.step('the boss shows a Dragon\'s picture inside its stagger ring, its shield around it', async () => {
    expect(await disc(ids.boss)).toEqual({ icon: '#i-dragon', size: '22px', hidden: 'true', letter: null, letterPx: null, initials: null });
    const clear = await tok(ids.boss).evaluate(t => {
      const ic = t.querySelector('.mp-ic')!.getBoundingClientRect(), st = t.querySelector('.mp-stag')!, r = st.getBoundingClientRect(), pad = parseFloat(getComputedStyle(st).paddingLeft) * (r.width / (st as HTMLElement).offsetWidth);
      return ic.left >= r.left + pad - 0.5 && ic.right <= r.right - pad + 0.5 && ic.top >= r.top + pad - 0.5 && ic.bottom <= r.bottom - pad + 0.5;
    });
    expect(clear, 'the picture sits inside the stagger ring\'s inner edge').toBe(true);
  });
  await test.step('Brakk shows his crown; Mira, with no emblem, her initials', async () => {
    await expect.poll(() => disc(ids.brakk)).toEqual({ icon: '#i-crown', size: '22px', hidden: 'true', letter: null, letterPx: null, initials: null });
    expect(await disc(ids.mira)).toEqual({ icon: null, size: null, hidden: 'true', letter: null, letterPx: null, initials: 'MV' });
  });
  await test.step('the order shows each name after its picture at 16 px, the hotbar each ability\'s at 20 px above its name', async () => {
    const order = await map.locator('.mp-order li').evaluateAll(lis => lis.map(li => { const ic = li.querySelector('.ic'); return ic && !ic.hasAttribute('hidden') ? getComputedStyle(ic).width : null; }));
    expect(order.length).toBeGreaterThan(1);
    expect(order.filter(Boolean).every(w => w === '16px'), `the order's pictures: ${order.join(', ')}`).toBe(true);
    const slot = map.locator('[data-hot] [data-ab]').first();
    const [ic, name] = await Promise.all([slot.locator('.ic').boundingBox(), slot.locator('span').boundingBox()]);
    expect(await slot.locator('.ic').evaluate(el => [getComputedStyle(el).width, el.getAttribute('aria-hidden')])).toEqual(['20px', 'true']);
    expect(ic!.y + ic!.height, 'the picture is above the name').toBeLessThanOrEqual(name!.y + 0.5);
    expect((await slot.boundingBox())!.height, 'the slot is still a 44 px target').toBeGreaterThanOrEqual(44);
  });
  await test.step('the boss\'s card shows its picture at 24 px before its name', async () => {
    await tok(ids.boss).tap();
    const head = combat.locator('.cmb-card h3');
    await expect(head).toContainText('Ash Drake');
    expect(await head.locator('.ic').evaluate(el => [el.querySelector('use')!.getAttribute('href'), getComputedStyle(el).width, el.getAttribute('aria-hidden')])).toEqual(['#i-dragon', '24px', 'true']);
  });
});

for (const width of [360, 390]) {
  test(`on a ${width} px phone in a melee of three on the map, every name is clear of the other tokens and the other names, aimed or not`, async ({ device }) => {
    const gm = (await device('gm', { viewport: { width, height: 800 } })).page;
    await onboardGM(gm);
    await chooseList(gm);
    await startGoblinDenFight(gm);
    await gm.evaluate(() => hunterApp.store.update((d: any) => {
      const f = d.fight, me = f.rows.find((r: any) => r.id === f.currentId);
      const brakk = f.rows.find((r: any) => r.name === 'Brakk Ironhide'), mira = f.rows.find((r: any) => r.name === 'Mira Vale');
      me.place = { x: 3, y: 2 }; brakk.place = { x: 3, y: 3 }; mira.place = { x: 4, y: 3 };
      f.rows.filter((r: any) => ![me, brakk, mira].includes(r)).forEach((r: any, i: number) => { r.place = { x: 7, y: 1 + 2 * i }; });
    }, 'test-setup'));
    await gm.locator('#view-combat [data-fview="map"]').tap();
    const map = gm.locator('#view-combat [data-mapbox]');
    await map.locator('[data-frame]').dblclick({ position: { x: 4, y: 4 } });
    /** Each pair of a shown name and another token or another name whose boxes cross. */
    const crossings = () => map.locator('[data-tokens]').evaluate(layer => {
      const box = (el: Element) => el.getBoundingClientRect();
      const cross = (a: DOMRect, b: DOMRect) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
      const toks = [...layer.querySelectorAll('.mp-tok')];
      const names = toks.flatMap(t => [...t.querySelectorAll('.mp-name')].filter(n => (n as HTMLElement).offsetParent !== null).map(n => ({ t, n })));
      const out: string[] = [];
      for (const { t, n } of names) {
        for (const o of toks) if (o !== t && cross(box(n), box(o))) out.push(`${n.textContent} over the token ${o.getAttribute('aria-label')!.split(',')[0]}`);
        for (const m of names) if (m.n !== n && cross(box(n), box(m.n))) out.push(`${n.textContent} over the name ${m.n.textContent}`);
      }
      return { shown: names.map(x => x.n.textContent), out };
    });
    await test.step('nothing aimed', async () => {
      const c = await crossings();
      expect(c.shown, 'the names with room are shown').toContain('Mira');
      expect(c.out).toEqual([]);
    });
    await test.step('the first ability aimed at Brakk', async () => {
      await map.locator('[data-hot] [data-ab]').first().tap();
      const at = await map.locator('[data-world]').evaluate(w => {
        const r = w.getBoundingClientRect(), s = r.width / (w as HTMLElement).offsetWidth;
        return { x: r.left + 3.5 * 40 * s, y: r.top + 3.5 * 40 * s };
      });
      await gm.touchscreen.tap(at.x, at.y);
      await expect(map.locator('[data-words]')).toContainText('Brakk Ironhide');
      expect((await crossings()).out).toEqual([]);
    });
  });
}

for (const width of [360, 390]) {
  test(`on a ${width} px phone the kits' groups of the status and skill makers, every one open, scroll only up and down, and every control is at least 44 px tall`, async ({ device }) => {
    const page = (await device('gm', { viewport: { width, height: 800 } })).page;
    await onboardGM(page);
    await go(page, 'workshop');
    /** Controls in `box` that are shown and under 44 px tall, and whether the maker's scroll is wider than the window. */
    const audit = (box: Locator) => box.evaluate(win => {
      const scroll = win.querySelector('.mk-scroll') as HTMLElement;
      const short = [...win.querySelectorAll('button, input:not([type=checkbox]), select, .mk-check, summary')]
        // the laid-out height, not the drawn box: a chip just tapped is still in its press motion (a scale)
        .filter(el => (el as HTMLElement).offsetParent !== null && (el as HTMLElement).offsetHeight < 44)
        .map(el => `${el.tagName} ${el.getAttribute('data-k') || el.getAttribute('data-f') || el.getAttribute('data-chip') || el.className} ${(el as HTMLElement).offsetHeight}`);
      return { wide: scroll.scrollWidth > scroll.clientWidth + 1, short };
    });
    const sm = page.locator('.fg-overlay [role=dialog]');
    await page.locator('#view-workshop [data-ws="status"] [data-new]').tap();
    await sm.locator('[data-name]').fill('Resonance');
    for (const g of ['stacks', 'when', 'end']) await sm.locator(`[data-group="${g}"] > summary`).tap();
    await sm.locator('[data-k="stack"]').check();
    await sm.locator('[data-k="th"]').check();
    await sm.locator('[data-chips="fgk-leave"] [data-chip="event"]').tap();
    await sm.locator('[data-chips="fgk-th-to"] [data-chip="area"]').tap();
    await sm.locator('[data-add-trig]').tap();
    await sm.locator('[data-chips$="-limit"] [data-chip="fight"]').tap();
    await sm.locator('[data-chips$="-to"] [data-chip="area"]').last().tap();
    await sm.locator('[data-k="end"]').check();
    expect(await audit(sm)).toEqual({ wide: false, short: [] });
    await sm.locator('.mk-actions [data-cancel]').tap();
    await expect(sm).toHaveCount(0);

    const km = page.locator('.skm-overlay [role=dialog]');
    await page.locator('#view-workshop [data-ws="skill"] [data-new]').tap();
    await km.locator('#skm-name').fill('Executioner');
    for (const g of ['ticks', 'names', 'prices', 'gates', 'tags', 'moves', 'react', 'summon']) await km.locator(`[data-group="${g}"] > summary`).first().tap();
    await km.locator('[data-add-scaler]').tap();
    await km.locator('[data-add="price"]').tap();
    await km.locator('[data-add="gate"]').tap();
    await km.locator('[data-f="react"]').check();
    await km.locator('[data-f="summon"]').check();
    await km.locator('[data-set="act"][data-v="shift"]').tap();
    expect(await audit(km)).toEqual({ wide: false, short: [] });
  });
}

for (const viewport of [SMALL_PHONE, PHONE]) {
  test(`on a ${viewport.width} px phone a status chip, a sheet number and an item each open their detail under them, inside the screen, one at a time`, async ({ device }) => {
    const p = (await device(`detail-${viewport.width}`, { viewport })).page;
    await onboardPlayer(p, 'Mira Test');
    await dismissAll(p);
    await p.evaluate(() => {
      const h = hunterApp.store.active();
      hunterApp.api.hunter.addCondition(h.id, { key: 'poisoned', def: hunterApp.rules().conditions.poisoned, rounds: 3, source: { id: null, tier: 0 } });
      hunterApp.api.inventory.addItem(h.id, { name: 'Ember Flask', rar: 'common', type: 'consumable', qty: 1, desc: 'Throw it.', effects: [{ op: 'applyStatus', key: 'burning', def: hunterApp.rules().conditions.burning, duration: 3000 }] });
    });
    await go(p, 'status');
    const inside = async (sel: string) => {
      const d = p.locator(sel);
      await expect(d).toBeVisible();
      const box = (await d.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
      const small = await d.evaluate(el => [...el.querySelectorAll('*')].map(x => parseFloat(getComputedStyle(x).fontSize)).filter(n => n < 12).length);
      expect(small, 'no text under 12 px').toBe(0);
    };
    await test.step('Poisoned\'s chip opens what it does', async () => {
      const chip = p.locator('#view-status [data-chips] [data-chip="poisoned"] [data-dt-key]');
      await chip.tap();
      await expect(chip).toHaveAttribute('aria-expanded', 'true');
      await inside('#view-status [data-chips] .dt');
      await expect(p.locator('#view-status [data-chips] .dt')).toContainText('3 rounds left.');
    });
    await test.step('Armor opens its parts', async () => {
      await p.locator('#view-status [data-dv-k="armor"]').tap();
      await inside('#view-status [data-dv] .dt');
      await expect(p.locator('#view-status [data-dv] .dt')).toContainText('Base');
    });
    await test.step('the flask opens what it does, and a second tap closes it', async () => {
      const name = p.locator('#view-status [data-panel="inventory"] .inv-card', { hasText: 'Ember Flask' }).locator('.i-name');
      await name.tap();
      await inside('#view-status [data-panel="inventory"] .dt');
      await name.tap();
      await expect(name).toHaveAttribute('aria-expanded', 'false');
      await expect(p.locator('#view-status [data-panel="inventory"] .dt')).toHaveCount(0);
    });
  });
}

test('a player who closes a status chip\'s or a sheet number\'s detail opens it again with the next tap', async ({ device }) => {
  const p = (await device('detail-again', { viewport: PHONE })).page;
  await onboardPlayer(p, 'Mira Test');
  await dismissAll(p);
  await p.evaluate(() => {
    const h = hunterApp.store.active();
    hunterApp.api.hunter.addCondition(h.id, { key: 'poisoned', def: hunterApp.rules().conditions.poisoned, rounds: 3, source: { id: null, tier: 0 } });
  });
  await go(p, 'status');
  const thrice = async (control: Locator, detail: Locator) => {
    await control.tap();
    await expect(detail).toBeVisible();
    await control.tap();
    await expect(control).toHaveAttribute('aria-expanded', 'false');
    await expect(detail).toHaveCount(0);
    await control.tap();
    await expect(control).toHaveAttribute('aria-expanded', 'true');
    await expect(detail).toBeVisible();
  };
  await test.step('Poisoned\'s chip opens, closes and opens again', () =>
    thrice(p.locator('#view-status [data-chips] [data-chip="poisoned"] [data-dt-key]'), p.locator('#view-status [data-chips] .dt')));
  await test.step('Armor opens, closes and opens again', () =>
    thrice(p.locator('#view-status [data-dv-k="armor"]'), p.locator('#view-status [data-dv] .dt')));
});

test('a GM who closes a monster ability\'s detail on its card opens it again with the next tap', async ({ device }) => {
  const gm = (await device('gm', { viewport: PHONE })).page;
  await onboardGM(gm);
  await chooseList(gm);
  await startGoblinDenFight(gm);
  const ability = gm.locator('#view-combat .cmb-x.abil .cmb-ai').first(), detail = gm.locator('#view-combat .cmb-x.abil .dt');
  await ability.tap();
  await expect(detail).toBeVisible();
  await ability.tap();
  await expect(detail).toHaveCount(0);
  await ability.tap();
  await expect(ability).toHaveAttribute('aria-expanded', 'true');
  await expect(detail).toBeVisible();
});

test('a GM who closes a hotbar ability\'s detail on the map opens it again with the next press and hold', async ({ device }) => {
  const gm = (await device('gm', { viewport: PHONE })).page;
  await onboardGM(gm);
  await go(gm, 'combat');
  const combat = gm.locator('#view-combat');
  await combat.locator('[data-hsel]').selectOption({ label: 'Brakk Ironhide' });
  await combat.locator('[data-addh]').tap();
  await combat.locator('[data-qline]').fill('Cave Rat x1, E, brute');
  await combat.locator('[data-qadd]').tap();
  await combat.locator('[data-start]').tap();
  const map = combat.locator('[data-mapbox]');
  const slot = map.locator('[data-hot] [data-ab]').first(), detail = map.locator('[data-mapdt] .dt');
  const hold = async () => {
    const box = (await slot.boundingBox())!;
    await gm.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await gm.mouse.down();
    await expect(detail).toBeVisible();
    await gm.mouse.up();
  };
  await hold();
  await detail.tap();
  await expect(detail).toHaveCount(0);
  await hold();
  await expect(detail).toContainText(await slot.locator('span').first().innerText());
});

test('shadows take no room until someone holds one: the GM\'s Add to the fight form has no shadow block with none summoned and shows it once one is, and a player sees the Shadows tab only with a job that extracts or a shadow of their own', async ({ device }) => {
  const gm = (await device('gm', { viewport: PHONE })).page;
  await onboardGM(gm);
  await go(gm, 'combat');
  const block = gm.locator('#view-combat fieldset', { hasText: 'Summoned shadows' });
  await expect(gm.locator('#view-combat [data-hsel]')).toBeVisible();
  await expect(block).toBeHidden();
  // setup: the active hunter holds a summoned shadow
  await gm.evaluate(() => hunterApp.store.update((d: any) => {
    const h = d.hunters.find((x: any) => x.id === d.activeId) ?? d.hunters[0];
    h.shadows.push({ id: hunterApp.store.id('sh'), name: 'Igris', rank: 'E', archetype: 'brute', grade: 'Normal', monster: null, hp: 10, summoned: true, notes: '' });
  }, 'test-setup'));
  await expect(block).toBeVisible();
  await expect(block.locator('[data-ssel] option')).toHaveText(/Igris/);

  const player = (await device('player', { viewport: SMALL_PHONE })).page;
  await onboardPlayer(player, 'Mira Test');
  const listed = () => player.evaluate(() => [...document.querySelectorAll('#nav-top a')].some(a => a.getAttribute('href') === '#/shadows'));
  expect(await listed()).toBe(false);
  await player.evaluate(() => hunterApp.store.update((d: any) => {
    d.hunters[0].shadows.push({ id: hunterApp.store.id('sh'), name: 'Igris', rank: 'E', archetype: 'brute', grade: 'Normal', monster: null, hp: 10, summoned: false, notes: '' });
  }, 'test-setup'));
  await expect.poll(listed).toBe(true);
});

for (const viewport of [PHONE, SMALL_PHONE]) {
  test(`on a ${viewport.width} px phone the odds control and its line fit the screen`, async ({ device }) => {
    const page = (await device('gm', { viewport })).page;
    await onboardGM(page);
    await go(page, 'combat');
    await page.locator('#view-combat [data-addparty]').tap();
    await page.locator('#view-combat [data-addm]').tap();
    const box = page.locator('#view-combat [data-odds]');
    await expect(box.locator('[data-odds-ask]')).toBeVisible();
    const fits = () => box.evaluate(el => [...el.querySelectorAll('button, p')].every(c => { const r = c.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth; }) && document.documentElement.scrollWidth <= innerWidth);
    expect(await fits(), 'the control fits').toBe(true);
    await box.locator('[data-odds-ask]').tap();
    await expect(box.locator('[data-oddsline]')).toBeVisible({ timeout: 60_000 });
    expect(await fits(), 'the line fits').toBe(true);
    const h = await box.locator('[data-oddsline]').evaluate(el => el.getBoundingClientRect().height);
    expect(h, 'the line is a 44 px target').toBeGreaterThanOrEqual(44);
  });
}

for (const viewport of [PHONE, SMALL_PHONE]) {
  test(`on a ${viewport.width} px phone a personal gate's card, its odds and Enter alone fit the screen as 44 px targets`, async ({ device }) => {
    const page = (await device('solo', { viewport })).page;
    await onboardPlayer(page, 'Mira Test');
    await go(page, 'gates');
    const card = page.locator('#view-gates .gate.solo').first();
    await expect(card).toBeVisible();
    await expect(card).toContainText(/Closes in \d+ hours?/);
    const fits = () => card.evaluate(el => [...el.querySelectorAll('button, p, li, .gt-timer')].every(c => { const r = c.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth; }) && document.documentElement.scrollWidth <= innerWidth);
    expect(await fits(), 'the card fits').toBe(true);
    for (const b of await card.locator('[data-odds-ask], [data-solo-enter]').all()) expect((await b.boundingBox())!.height, 'a 44 px target').toBeGreaterThanOrEqual(44);
    await card.locator('[data-odds-ask]').tap();
    await expect(card.locator('[data-oddsline]')).toBeVisible({ timeout: 60_000 });
    expect(await fits(), 'the odds line fits').toBe(true);
  });
}

for (const viewport of [SMALL_PHONE, PHONE]) {
  test(`on a ${viewport.width} px phone the GM's shelf of awards keeps Cancel and its moment chips on screen while the list scrolls, each row says when and what it gives, and nothing scrolls sideways`, async ({ device }) => {
    const gm = (await device('gm', { viewport })).page;
    await onboardGM(gm);
    await go(gm, 'gm');
    const card = gm.locator('#gm-board .gm-card', { hasText: 'Brakk Ironhide' });
    await card.locator('[data-ggive]').tap();
    const shelf = gm.locator('.sys-overlay.show.gs-ov'), list = shelf.locator('[data-gs-list]');
    const cancel = shelf.locator('[data-gs-cancel]');
    await expect(shelf).toContainText('GIVE TO BRAKK IRONHIDE');

    await test.step('Cancel, the guide and the chips are on the first screen, and every control there is 44 px tall', async () => {
      await expect(cancel).toBeInViewport({ ratio: 1 });
      await expect(shelf.locator('[data-gs-guide]')).toBeInViewport({ ratio: 1 });
      await expect(shelf.locator('[data-gs-chip="all"]')).toBeInViewport({ ratio: 1 });
      const short = await shelf.evaluate(win => [...win.querySelectorAll('button')]
        .filter(b => (b as HTMLElement).offsetParent !== null && (b as HTMLElement).offsetHeight < 44).map(b => b.textContent!.trim().slice(0, 30)));
      expect(short).toEqual([]);
    });

    await test.step('the first row says what it is for and what it gives, in lines that wrap within the window', async () => {
      const row = shelf.locator('[data-give]').first();
      await expect(row.locator('.gs-when')).not.toBeEmpty();
      await expect(row.locator('.gs-gives')).not.toBeEmpty();
      await expect(shelf.locator('[data-give="seed-scar-tissue"] .gs-gives')).toHaveText('Title: Scar Tissue (+1 DIS)');
      const wide = await shelf.evaluate(win => {
        // the window does not scroll (its list does), and its corner marks sit 2 px outside it by design
        const w = win.querySelector('.gs-win') as HTMLElement, l = win.querySelector('[data-gs-list]') as HTMLElement;
        w.scrollLeft = 50;
        return { win: w.scrollLeft, list: l.scrollWidth - l.clientWidth, page: document.documentElement.scrollWidth - innerWidth };
      });
      expect(wide).toEqual({ win: 0, list: 0, page: 0 });
    });

    await test.step('the list scrolls to its end inside the window, and Cancel and the chips stay where they were', async () => {
      // the window comes in at .98 of its size (motion.ts `enter`): measured before that ends, Cancel reads a hair small
      await expect.poll(() => gm.evaluate(() => document.getAnimations().filter(a => a.playState === 'running' && (a.effect?.getTiming().iterations ?? 1) !== Infinity).length)).toBe(0);
      const before = await cancel.boundingBox();
      await list.evaluate(l => { l.scrollTop = l.scrollHeight; });
      await expect(shelf.locator('[data-give="seed-seen"]')).toBeInViewport();
      await expect(cancel).toBeInViewport({ ratio: 1 });
      expect(await cancel.boundingBox()).toEqual(before);
    });

    await test.step('How to use these opens the guide at the top of the list; Cancel closes the shelf and gives nothing', async () => {
      await shelf.locator('[data-gs-guide]').tap();
      await expect(shelf.locator('.gs-guide li').first()).toBeInViewport();
      await expect(shelf.locator('.gs-guide li')).toHaveCount(9);
      await cancel.tap();
      await expect(shelf).toHaveCount(0);
      await expect(gm.locator('#toasts .toast[data-held]')).toHaveCount(0);
    });
  });
}

for (const viewport of [SMALL_PHONE, PHONE]) {
  test(`at ${viewport.width} px a feat's four conditions sit under Only when, each two rows of 44 px controls, with no sideways scroll`, async ({ device }) => {
    const page = (await device('gm', { viewport })).page;
    await onboardGM(page);
    await go(page, 'workshop');
    await page.locator('#view-workshop [data-ws="feat"] [data-new]').tap();
    const d = page.locator('.fm-overlay [role=dialog]');
    await expect(d.getByRole('heading', { name: 'New feat' })).toBeVisible();
    for (let i = 0; i < 4; i++) await d.getByRole('button', { name: 'Add a condition' }).tap();
    await expect(d.getByRole('group', { name: 'Only when' }).locator('[data-test]')).toHaveCount(4);
    const rows = await d.locator('[data-test]').evaluateAll(els => els.map(el => {
      const r = el.getBoundingClientRect(), controls = [...el.querySelectorAll('select, input, button')].map(c => c.getBoundingClientRect());
      return { height: Math.round(r.height), lines: new Set(controls.map(c => Math.round(c.top))).size, short: controls.filter(c => c.height < 44).length, wide: el.scrollWidth > el.clientWidth + 1 };
    }));
    for (const row of rows) expect(row).toEqual({ height: expect.any(Number), lines: 2, short: 0, wide: false });
    for (const row of rows) expect(row.height, 'a condition takes about half the 330 px it took').toBeLessThanOrEqual(120);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
  });
}

test('on a 360 px phone the feat maker scrolls only up and down, and every control in it is at least 44 px tall', async ({ device }) => {
  const page = (await device('gm', { viewport: SMALL_PHONE })).page;
  await onboardGM(page);
  await go(page, 'workshop');
  await page.locator('#view-workshop [data-ws="feat"] [data-new]').tap();
  const d = page.locator('.fm-overlay [role=dialog]');
  await expect(d.getByRole('heading', { name: 'New feat' })).toBeVisible();
  await d.locator('[data-tadd]').tap();
  await d.locator('#fm-measure').selectOption('sum');
  const audit = await d.evaluate(win => {
    const short = [...win.querySelectorAll('button, input:not([type=checkbox]), select')]
      .filter(el => (el as HTMLElement).offsetParent !== null && (el as HTMLElement).offsetHeight < 44).map(el => (el.getAttribute('aria-label') || el.textContent || el.id || el.tagName).trim().slice(0, 30));
    const wide = [...win.querySelectorAll('*')].some(el => (el as HTMLElement).scrollWidth > (el as HTMLElement).clientWidth + 1 && getComputedStyle(el).overflowX !== 'visible' && getComputedStyle(el).overflowX !== 'hidden');
    return { short, wide, page: document.documentElement.scrollWidth - innerWidth };
  });
  expect(audit).toEqual({ short: [], wide: false, page: 0 });
});

for (const viewport of [SMALL_PHONE, PHONE]) {
  test(`at ${viewport.width} px the story maker with four chapters scrolls only up and down, and the open chapter's controls are at least 44 px tall`, async ({ device }) => {
    const page = (await device('gm', { viewport })).page;
    await onboardGM(page);
    await go(page, 'workshop');
    await page.locator('#view-workshop [data-ws="story"] [data-new]').tap();
    const d = page.locator('.stm-overlay [role=dialog]');
    await expect(d.getByRole('heading', { name: 'New story' })).toBeVisible();
    await d.locator('#stm-name').fill('A story with a long name to fill the line');
    for (let i = 0; i < 3; i++) await d.getByRole('button', { name: 'Add a chapter' }).tap();
    await expect(d.locator('.stm-ch')).toHaveCount(4);
    await d.locator('#stm-wtitle').fill('A WINDOW TITLE LONG ENOUGH TO WRAP AT THIS WIDTH');
    await d.locator('#stm-hasq').check();
    await expect(d.locator('[data-stm-q] [name=title]')).toBeVisible();
    const audit = await d.evaluate(win => {
      const short = [...win.querySelectorAll('button, input:not([type=checkbox]), select')]
        .filter(el => (el as HTMLElement).offsetParent !== null && (el as HTMLElement).offsetHeight < 44).map(el => (el.getAttribute('aria-label') || el.textContent || el.id || el.tagName).trim().slice(0, 30));
      // a text field holds a line longer than its box and scrolls inside it, as every field does: only the layout is checked
      const wide = [...win.querySelectorAll('*:not(input):not(textarea)')].some(el => (el as HTMLElement).scrollWidth > (el as HTMLElement).clientWidth + 1 && getComputedStyle(el).overflowX !== 'visible' && getComputedStyle(el).overflowX !== 'hidden');
      return { short, wide, page: document.documentElement.scrollWidth - innerWidth };
    });
    expect(audit).toEqual({ short: [], wide: false, page: 0 });
  });
}

for (const viewport of [SMALL_PHONE, PHONE]) {
  test(`at ${viewport.width} px the GM view's Stories, its turn-on window and its open window have 44 px controls, no sideways scroll, and the open window's actions on screen at the end of its list`, async ({ device }) => {
    const page = (await device('gm', { viewport })).page;
    await onboardGM(page);
    await page.evaluate(story => hunterApp.store.update((d: any) => {
      d.library.stories = [{ ...story, id: 'st1', name: 'A story with a name long enough to wrap at this width' }];
      d.rulesOverrides = { ...d.rulesOverrides, feats: { on: false } };
      for (let i = 0; i < 5; i++) d.hunters.push({ ...JSON.parse(JSON.stringify(d.hunters[0])), id: `h${800 + i}`, name: `Spare hunter number ${i + 1}` });
    }, 'test-setup'), EXAMPLE_STORIES[1]!.story);
    await go(page, 'gm');
    const tog = page.locator('[data-tog="stories"]');
    if ((await tog.getAttribute('aria-expanded')) !== 'true') await tog.tap();
    const sec = page.locator('#gm-stories'), w = page.locator('.st-ov [role=dialog]');
    /** Controls under 44 px tall, anything wider than its box that scrolls sideways, and the page's sideways overflow. */
    const audit = (root: string) => page.evaluate(sel => {
      const box = document.querySelector(sel)!;
      const short = [...box.querySelectorAll('button, select')].filter(el => (el as HTMLElement).offsetParent !== null && (el as HTMLElement).offsetHeight < 44).map(el => (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 30));
      const wide = [...box.querySelectorAll('*')].some(el => (el as HTMLElement).scrollWidth > (el as HTMLElement).clientWidth + 1 && !['visible', 'hidden'].includes(getComputedStyle(el).overflowX));
      return { short, wide, page: document.documentElement.scrollWidth - innerWidth };
    }, root);

    await test.step('the turn-on window, its list and then the story\'s step', async () => {
      await sec.locator('[data-st-turnon]').tap();
      await expect(w.getByRole('heading', { name: 'Start a story' })).toBeVisible();
      expect(await audit('.st-ov [role=dialog]')).toEqual({ short: [], wide: false, page: 0 });
      await w.locator('[data-st-story]').tap();
      await w.locator('[data-st-who]').first().tap();
      expect(await audit('.st-ov [role=dialog]')).toEqual({ short: [], wide: false, page: 0 });
      await w.locator('[data-st-go]').tap();
      await answerWindow(page, 'IT WILL REMEMBER YOUR FACE');
    });

    await test.step('the section with a running story', async () => {
      await expect(sec.locator('.st-card')).toHaveCount(1);
      expect(await audit('#gm-stories')).toEqual({ short: [], wide: false, page: 0 });
    });

    await test.step('the open window, scrolled to the end of its list, keeps Cancel and Open on screen', async () => {
      await sec.locator('[data-st-open]').tap();
      await expect(w.getByRole('heading', { name: 'Open chapter 2' })).toBeVisible();
      expect(await audit('.st-ov [role=dialog]')).toEqual({ short: [], wide: false, page: 0 });
      await w.locator('.st-mid').evaluate(el => { el.scrollTop = el.scrollHeight; });
      for (const b of [w.locator('[data-st-cancel]'), w.locator('[data-st-go]')]) await expect(b).toBeInViewport({ ratio: 1 });
      await expect(w.locator('[data-st-who]').last()).toBeInViewport();
    });
  });
}

for (const viewport of [SMALL_PHONE, PHONE]) {
  test(`at ${viewport.width} px the Chronicle of a hunter with 40 entries shows the 5 newest and one 44 px button for the rest, and scrolls only up and down, on the sheet and in the GM's window`, async ({ device }) => {
    const gm = (await device('gm', { viewport })).page;
    await onboardGM(gm);
    await gm.evaluate(() => {
      const s = hunterApp.store, at = (i: number) => new Date(Date.parse('2026-11-01T10:00:00.000Z') + i * 3_600_000).toISOString();
      const fight = { kind: 'fight', outcome: 'won', rounds: 6, up: true, downs: 0, low: 12, endPct: 12, exactOne: false, struck: 4, hits: 5, crits: 1, critRun: 1, avoided: 0, dealt: 60, taken: 40, healed: 0, raised: 0, hexes: 0,
        kills: 2, bosses: 0, turnKills: 1, items: 0, allies: 1, alliesDown: 0, sideUp: 2, foes: 3, foeTop: 0, bossTop: null, gate: 'The Drowned Cathedral of Saint Averno', names: '3 Goblins, Hobgoblin, Goblin Shaman, 2 Dire Wolves' };
      const facts = Array.from({ length: 40 }, (_, i) => ({ ...(i % 2 ? fight : { kind: 'level', level: i + 2 }), at: at(i), day: '2026-11-01', session: i < 4 ? 0 : 3 }));
      const told = ['threads-end', 'uphill', 'three-in-a-breath', 'payback'];
      for (const id of told) s.tell({ type: 'answered', campaign: s.told().campaign, topic: { of: 'feat', hunter: s.active().id }, id });
      s.update(() => {
        const h = s.active();
        h.chronicle = { inbox: [], facts, tally: { ...h.chronicle.tally, won: 12, kills: 1048, gates: 5, died: 3, feats: 4 },
          feats: { ...Object.fromEntries(told.map((k, i) => [k, { at: 'earned', on: at(i), day: at(i).slice(0, 10), name: k === 'threads-end' ? 'Thread\'s End' : k }])), ratcatcher: { at: 'shown', n: 25 } } };
      }, 'test-setup');
    });
    const audit = (root: import('./helpers.ts').Page | any) => root.evaluate((el: HTMLElement) => ({
      out: [...el.querySelectorAll('li, dd, dt, p, button')].filter(c => { const r = c.getBoundingClientRect(); return r.width > 0 && (r.left < 0 || r.right > innerWidth + 0.5); }).length,
      page: document.documentElement.scrollWidth - innerWidth,
    }));

    await test.step('the sheet\'s panel, short and then whole', async () => {
      await go(gm, 'status');
      const chip = gm.locator('#view-status [data-jump="chronicle"]');
      await expect(chip).toHaveText('Chronicle');
      await chip.tap();
      const panel = gm.locator('#view-status [data-panel="chronicle"]');
      await expect(panel.locator('.chr-nums div')).toHaveCount(5);
      await expect(panel.locator('[data-chr-earned]')).toHaveCount(3);
      await expect(panel.locator('[data-chr-shown]')).toHaveCount(3);
      await expect(panel.locator('.chr-facts li')).toHaveCount(5);
      await expect(panel.locator('.chr-facts li').first()).toContainText('Won a fight in The Drowned Cathedral of Saint Averno against 3 Goblins, Hobgoblin, Goblin Shaman, 2 Dire Wolves in 6 rounds, at 12% HP.');
      const all = panel.locator('[data-chr-all]');
      await expect(all).toHaveText(/^Show all: 4 feats, \d+ in progress, 40 entries$/);
      expect((await all.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      expect(await audit(panel)).toEqual({ out: 0, page: 0 });
      await all.tap();
      await expect(panel.locator('.chr-facts li')).toHaveCount(40);
      await expect(panel.locator('[data-chr-earned]')).toHaveCount(4);
      await expect(all).toHaveText('Show less');
      expect(await audit(panel)).toEqual({ out: 0, page: 0 });
    });

    await test.step('the GM\'s board button and the window it opens, which starts at its title', async () => {
      await go(gm, 'gm');
      const tog = gm.locator('[data-tog="party"]');
      if ((await tog.getAttribute('aria-expanded')) !== 'true') await tog.tap();
      const line = gm.locator('#gm-board .gm-card [data-gchron]').first();
      await expect(line).toHaveText('Chronicle: 4 feats, newest payback');
      const box = (await line.boundingBox())!;
      expect(box.height).toBeGreaterThanOrEqual(44);
      expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
      await line.tap();
      const win = gm.locator('.sys-overlay.show .sys-window', { has: gm.locator('.chr-win') });
      await expect(win.locator('.chr-facts li')).toHaveCount(40);
      expect(await win.evaluate(el => el.scrollTop), 'a window taller than the screen opens at its title').toBe(0);
      await expect(win.locator('.sys-title')).toBeInViewport();
      expect(await audit(win)).toEqual({ out: 0, page: 0 });
      expect(await win.locator('.chr-win').evaluate(el => el.scrollWidth - el.clientWidth), 'the Chronicle is no wider than its window').toBeLessThanOrEqual(1);
    });
  });
}

for (const viewport of [SMALL_PHONE, PHONE]) {
  test(`at ${viewport.width} px the GM's quest form with an objective counted by the System, a title worn in fights and If it fails scrolls only up and down, and every control in it is at least 44 px tall`, async ({ device }) => {
    const page = (await device('gm', { viewport })).page;
    await onboardGM(page);
    await go(page, 'quests');
    await page.locator('#view-quests [data-new]').tap();
    const form = page.locator('#view-quests form[data-form]');
    await form.locator('[data-ocb]').selectOption('system');
    const count = form.locator('[data-ocount]');
    await count.locator('[data-tadd]').tap();
    await count.locator('[data-cm]').selectOption('max');
    await expect(count.locator('[data-mf]')).toBeVisible();
    await form.locator('[data-rweditor] [data-add="title"]').tap();
    await expect(form.locator('[data-rweditor] [data-f="tworn"]')).toBeVisible();
    await expect(form.locator('[data-failrw] .rw-nums')).toBeVisible();
    await expect(form.locator('[data-failrw] [data-rw-bundle]'), 'a cost is not picked from or saved as an award bundle').toHaveCount(0);
    const audit = await form.evaluate(box => {
      const short = [...box.querySelectorAll('button, input:not([type=checkbox]), select')]
        .filter(el => (el as HTMLElement).offsetParent !== null && (el as HTMLElement).offsetHeight < 44).map(el => (el.getAttribute('aria-label') || el.textContent || el.id || el.tagName).trim().slice(0, 30));
      const wide = [...box.querySelectorAll('*:not(input):not(textarea)')].some(el => (el as HTMLElement).scrollWidth > (el as HTMLElement).clientWidth + 1 && getComputedStyle(el).overflowX !== 'visible' && getComputedStyle(el).overflowX !== 'hidden');
      const out = [...box.querySelectorAll('button, input, select, label, p')].filter(el => { const r = el.getBoundingClientRect(); return r.width > 0 && (r.left < 0 || r.right > innerWidth + 0.5); }).map(el => (el.getAttribute('aria-label') || el.textContent || el.tagName).trim().slice(0, 30));
      return { short, wide, out, page: document.documentElement.scrollWidth - innerWidth };
    });
    expect(audit).toEqual({ short: [], wide: false, out: [], page: 0 });
  });
}

test('on 360 and 390 px phones the Bag\'s four tabs and an item\'s row with Give keep one line each, and every control is at least 44 px tall', async ({ device }) => {
  for (const viewport of [SMALL_PHONE, PHONE]) {
    const player = (await device(`player ${viewport.width}`, { viewport })).page;
    await onboardPlayer(player, 'Mira Test');
    await player.evaluate(() => {
      const hid = hunterApp.store.active().id;
      hunterApp.api.inventory.addItem(hid, { name: 'Greater Health Potion', rar: 'rare', type: 'consumable', qty: 2 });
      hunterApp.api.inventory.addItem(hid, { name: 'Iron Shield', rar: 'uncommon', type: 'armor', slot: 'offhand' });
      hunterApp.api.inventory.addGold(hid, 50);
    });
    await go(player, 'status');
    const bag = player.locator('[data-panel="inventory"]');
    await expect(bag.getByRole('button', { name: 'Give Iron Shield' })).toBeVisible();
    const lines = await bag.evaluate(el => [el.querySelector('[role=tablist]')!, ...el.querySelectorAll('.inv-card .acts')].map(row => {
      const boxes = [...row.querySelectorAll('button')].map(b => b.getBoundingClientRect());
      return { lines: new Set(boxes.map(b => Math.round(b.top))).size, least: Math.min(...boxes.map(b => b.height)) };
    }));
    expect(lines.length, `${viewport.width}: the tabs and two rows`).toBe(3);
    for (const l of lines) expect(l, `${viewport.width}: one line of 44 px controls`).toEqual({ lines: 1, least: expect.any(Number) });
    expect(Math.min(...lines.map(l => l.least)), `${viewport.width}: every control 44 px`).toBeGreaterThanOrEqual(44);
    expect(await player.evaluate(() => document.documentElement.scrollWidth), `${viewport.width}: no sideways scroll`).toBe(viewport.width);
  }
});

test('on a 390 px phone the Give window with Ask in return open fits the width, and its chips and Ask in return are at least 44 px tall', async ({ device }) => {
  const gm = (await device('gm')).page, brakk = (await device('brakk', { viewport: PHONE })).page, mira = (await device('mira')).page;
  await onboardGM(gm);
  const code = await createRoom(gm);
  await onboardPlayer(brakk, 'Brakk', code);
  await onboardPlayer(mira, 'Mira', code);
  await dismissAll(brakk, 4);
  await brakk.evaluate(() => hunterApp.api.inventory.addItem(hunterApp.store.active().id, { name: 'Healing Potion', rar: 'common', type: 'consumable', qty: 3 }));
  await mira.evaluate(() => hunterApp.api.inventory.addItem(hunterApp.store.active().id, { name: 'Greater Health Potion of the Long Night', rar: 'rare', type: 'consumable', qty: 2 }));
  await expect.poll(() => brakk.evaluate(() => hunterApp.api.sync.faces().flatMap((f: any) => (f.bag ?? []).map((l: any) => l.name))), { timeout: 20_000 }).toContain('Greater Health Potion of the Long Night');
  await go(brakk, 'status');
  await brakk.locator('[data-panel="inventory"]').getByRole('button', { name: 'Give Healing Potion' }).tap();
  const win = brakk.locator('.sys-overlay.show .sys-window');
  await win.locator('[data-tr-to]', { hasText: 'Mira' }).tap();
  await win.locator('.tr-ask summary').tap();
  await expect(win.locator('[data-tr-ask]')).toBeVisible();
  const box = await win.boundingBox();
  expect(box && box.x >= 0 && box.x + box.width <= PHONE.width, 'the window fits the width').toBe(true);
  const least = await win.evaluate(w => Math.min(...[...w.querySelectorAll('.tr-give button, .tr-give summary')].map(b => (b as HTMLElement).offsetHeight)));
  expect(least, 'the layout height: a chip just tapped is drawn 3% smaller while pressed').toBeGreaterThanOrEqual(44);
  expect(await brakk.evaluate(() => document.documentElement.scrollWidth)).toBe(PHONE.width);
});

test('on a 390 px phone a player\'s Stash tab and the GM\'s stash list fit the width, each line\'s name beside its 44 px button', async ({ device }) => {
  const gm = (await device('gm', { viewport: PHONE })).page, mira = (await device('mira', { viewport: PHONE })).page;
  await onboardGM(gm);
  const code = await createRoom(gm);
  await onboardPlayer(mira, 'Mira', code);
  await dismissAll(mira, 4);
  await gm.evaluate(() => {
    const hid = hunterApp.store.active().id;
    hunterApp.api.inventory.addItem(hid, { name: 'Healing Potion', rar: 'common', type: 'consumable', qty: 3 });
    hunterApp.api.inventory.addItem(hid, { name: 'Greater Health Potion of the Long Night', rar: 'rare', type: 'consumable', qty: 1 });
    hunterApp.api.inventory.addGold(hid, 40);
  });
  await go(gm, 'status');
  for (const name of ['Healing Potion', 'Greater Health Potion of the Long Night']) {
    await gm.locator('[data-panel="inventory"]').getByRole('button', { name: `Give ${name}`, exact: true }).tap();
    const win = gm.locator('.sys-overlay.show');
    await win.locator('[data-tr-to]', { hasText: 'Party stash' }).tap();
    await win.getByRole('button', { name: 'Put in the stash' }).tap();
    await expect(win).toHaveCount(0);
  }
  const rows = (root: Locator, list: string) => root.evaluate((el, list) => [...el.querySelectorAll(`[data-tr-list="${list}"] .tr-offer`)].map(row => {
    const name = row.querySelector('span')!.getBoundingClientRect(), b = row.querySelector('button')!.getBoundingClientRect();
    return { beside: b.left >= name.right - 1 && b.top < name.bottom, tall: b.height >= 44, inside: b.right <= innerWidth };
  }), list);
  const fits = { beside: true, tall: true, inside: true };

  await go(mira, 'status');
  const bag = mira.locator('[data-panel="inventory"]');
  await bag.locator('[role=tab]', { hasText: 'Stash' }).tap();
  await expect(bag.locator('[data-tr-list="stash"] .tr-line')).toHaveCount(2, { timeout: 20_000 });
  await expect(bag.locator('[data-tr-asof]')).toHaveText(/^Updated \d\d:\d\d\.$/);
  expect(await rows(bag, 'stash'), 'the player\'s lines').toEqual([fits, fits]);
  expect(await mira.evaluate(() => document.documentElement.scrollWidth), 'no sideways scroll on the player\'s phone').toBe(PHONE.width);

  await go(gm, 'gm');
  const toggle = gm.locator('[data-tog="trade"]');
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.tap();
  const sec = gm.locator('#gm-trade');
  await expect(sec.locator('[data-tr-list="gm-stash"] .tr-offer')).toHaveCount(2);
  expect(await rows(sec, 'gm-stash'), 'the GM\'s lines').toEqual([fits, fits]);
  expect(await gm.evaluate(() => document.documentElement.scrollWidth), 'no sideways scroll on the GM\'s phone').toBe(PHONE.width);
});
