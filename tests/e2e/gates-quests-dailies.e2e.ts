import { test, expect, openApp, onboardGM, onboardPlayer, createRoom, dismissAll, answerWindow, go, activeHunter, gateByName, ROOM_CODE, chooseList, type DeviceOptions } from './helpers.ts';
import type { Page } from '@playwright/test';
import { RULES } from '../../src/core/rules.ts';

/**
 * Each of `n` hunters' share of what a world gate pays, by the rule (design 4.1): a pot of `gateParty` times the
 * amount, shrunk by party / n past the party, split evenly and rounded down.
 */
const share = (amount: number, n: number, party = RULES.gateParty): number =>
  n <= 0 ? 0 : Math.floor(n <= party ? amount * party / n : amount * party * party / (n * n));
/** What each of `n` hunters takes of an E-rank Clear's gold roll (the Goblin Den's rank), as the Clear panel words it. */
const goldEachE = (n: number): string => {
  const [low = 0, high = 0] = RULES.loot.E.gold;
  return `${share(low, n).toLocaleString('en-US')} to ${share(high, n).toLocaleString('en-US')}`;
};

const lifetimeXp = (page: Page): Promise<Record<string, number>> => page.evaluate(() => Object.fromEntries(hunterApp.store.get().hunters.map((h: any) => {
  let total = h.xp;
  for (let l = 1; l < h.level; l++) total += 100 * l;
  return [h.name, total];
})));

const gained = (before: Record<string, number>, after: Record<string, number>): Record<string, number> => Object.fromEntries(Object.keys(after).map(k => [k, (after[k] ?? 0) - (before[k] ?? 0)]));

const gateCard = (page: Page, id: string) => page.locator(`#view-gates .gate[data-id="${id}"]`);

async function sys(page: Page, label: string): Promise<void> {
  const wanted = page.locator('.sys-overlay.show .sys-actions button', { hasText: label }).first();
  // only a window without the wanted button is tapped past: a window that opens between the two looks is not
  const anyPrimary = page.locator('.sys-overlay.show', { hasNot: page.locator('.sys-actions button', { hasText: label }) }).locator('.sys-actions button.primary').first();
  await expect.poll(async () => {
    if (await wanted.isVisible()) return true;
    if (await anyPrimary.isVisible()) await anyPrimary.tap();
    return false;
  }, { message: `System window button "${label}"` }).toBe(true);
  await wanted.tap();
}

async function startGate(page: Page, id: string): Promise<void> {
  await chooseList(page);
  await go(page, 'gates');
  await gateCard(page, id).locator('[data-act=encounter]').tap();
  await page.locator('[aria-modal="true"] [data-apply]').tap();
  await expect(page.locator('#view-combat [data-end]').first()).toBeVisible();
}

const defeatAllMonsters = (page: Page) => page.evaluate(() => hunterApp.store.update((d: any) => {
  for (const r of d.fight.rows) if (r.side === 'foe') r.life = { at: 'dead' };
}, 'test-setup'));

async function endEncounter(page: Page): Promise<void> {
  const end = page.locator('#view-combat [data-end]').first();
  await end.evaluate((el: any) => el.scrollIntoView({ block: 'center' }));
  await end.tap();
}

async function openClearPanel(page: Page, id: string, tickAll = true) {
  const form = gateCard(page, id).locator('.gt-panel[data-form=clear]');
  await expect(form).toBeVisible();
  if (tickAll) for (const box of await form.locator('input[name=hid]').all()) if (!(await box.isChecked())) await box.tap();
  return form;
}

async function promisedXp(form: ReturnType<Page['locator']>): Promise<number> {
  const shown = form.locator('[data-clearxp]');
  const text = (await shown.count()) ? await shown.first().innerText() : await form.locator('.gt-notes').first().innerText();
  return Number((/\d[\d,]*/.exec(text) ?? ['NaN'])[0].replace(/,/g, ''));
}

async function submitClear(page: Page, form: ReturnType<Page['locator']>): Promise<Record<string, number>> {
  await form.locator('button[type=submit]').tap();
  await expect(form).toBeHidden();
  await dismissAll(page);
  return lifetimeXp(page);
}

const topWindow = (page: Page) => page.locator('.sys-overlay.show .sys-window').first();
const windowTitle = (page: Page) => topWindow(page).locator('.sys-title');

/** Taps Complete on a quest, confirms, and returns once the completion window ("... COMPLETE") is on screen. */
async function completeQuest(page: Page, tab: 'active' | 'daily', title?: RegExp | string): Promise<void> {
  await go(page, 'quests');
  await page.locator(`#view-quests [data-tab="${tab}"]`).tap();
  const scope = title ? page.locator('#view-quests .qc', { hasText: title }) : page.locator('#view-quests');
  const done = scope.locator('[data-done]').first();
  await done.evaluate((el: any) => el.scrollIntoView({ block: 'center' }));
  await done.tap();
  await expect(windowTitle(page)).toHaveText('Complete quest?');
  await topWindow(page).locator('.sys-actions button.primary', { hasText: 'Complete' }).tap();
  await expect(windowTitle(page)).toHaveText(/ COMPLETE$/);
}

async function penaltyWindows(page: Page): Promise<string[]> {
  const found: string[] = [];
  for (let i = 0; i < 10; i++) {
    if (!(await topWindow(page).isVisible())) break;
    const text = (await topWindow(page).innerText()).replace(/\s+/g, ' ');
    if (/Penalty Zone/.test(text)) found.push(text.slice(0, 120));
    await dismissAll(page, 1);
  }
  return found;
}

/** A phone in New York whose clock starts at `start` and moves only as the test moves it. */
async function newYorkPhone(device: (label: string, options?: DeviceOptions) => Promise<{ page: Page }>, label: string, start: string): Promise<Page> {
  const { page } = await device(label, { timezoneId: 'America/New_York' });
  await page.clock.install({ time: new Date(start) });
  return page;
}

async function passMinutePast(page: Page, when: string): Promise<void> {
  await page.clock.setSystemTime(new Date(when));
  await page.clock.runFor(61_000);
  await page.waitForTimeout(300);
}

test('a gate cleared after End fight with XP pays each hunter its share of the gate XP once and the panel number matches', async ({ device }) => {
  const page = (await device('gm')).page;
  await onboardGM(page);
  const gate = await gateByName(page, 'Goblin Den'), start = await lifetimeXp(page), n = Object.keys(start).length;
  await startGate(page, gate.id);
  const fought = await fightXp(page);
  await defeatAllMonsters(page);
  await endEncounter(page);
  await sys(page, 'Award XP to party');
  await sys(page, 'Mark gate cleared');
  const form = await openClearPanel(page, gate.id);
  const says = await promisedXp(form), beforeClear = await lifetimeXp(page);
  const after = await submitClear(page, form);
  expect(Object.values(gained(start, after)), 'XP each hunter got in total').toEqual(Object.values(start).map(() => share(fought, n) + share(Math.max(0, gate.xp - fought), n)));
  expect(Object.values(gained(beforeClear, after)), 'XP each hunter got at Clear').toEqual(Object.values(start).map(() => says));
});

test('a gate cleared from its card after End fight with XP and a reload pays each hunter its share of the gate XP once', async ({ device }) => {
  const page = (await device('gm')).page;
  await onboardGM(page);
  const gate = await gateByName(page, 'Goblin Den'), start = await lifetimeXp(page), n = Object.keys(start).length;
  await startGate(page, gate.id);
  const fought = await fightXp(page);
  await defeatAllMonsters(page);
  await endEncounter(page);
  await sys(page, 'Award XP to party');
  await sys(page, 'Not yet');
  await dismissAll(page);
  await openApp(page);
  await dismissAll(page);
  await go(page, 'gates');
  await gateCard(page, gate.id).locator('[data-act=clear]').tap();
  const form = await openClearPanel(page, gate.id);
  const says = await promisedXp(form), beforeClear = await lifetimeXp(page);
  const after = await submitClear(page, form);
  expect(Object.values(gained(start, after)), 'XP each hunter got in total').toEqual(Object.values(start).map(() => share(fought, n) + share(Math.max(0, gate.xp - fought), n)));
  expect(Object.values(gained(beforeClear, after)), 'XP each hunter got at Clear').toEqual(Object.values(start).map(() => says));
});

test('clearing a gate that never had an encounter pays each hunter the share of the gate XP the panel promises', async ({ device }) => {
  const page = (await device('gm')).page;
  await onboardGM(page);
  const gate = await gateByName(page, 'Goblin Den'), start = await lifetimeXp(page), n = Object.keys(start).length;
  await go(page, 'gates');
  await gateCard(page, gate.id).locator('[data-act=clear]').tap();
  const form = await openClearPanel(page, gate.id);
  const says = await promisedXp(form);
  // with no hunter picked the panel promises what the shares pay nobody: 0 (pay.ts `shareEach`)
  for (const box of await form.locator('input[name=hid]').all()) if (await box.isChecked()) await box.tap();
  await expect(form.locator('[data-clearxp]')).toHaveText('0');
  for (const box of await form.locator('input[name=hid]').all()) if (!(await box.isChecked())) await box.tap();
  const after = await submitClear(page, form);
  expect(says).toBe(share(gate.xp, n));
  expect(Object.values(gained(start, after))).toEqual(Object.values(start).map(() => share(gate.xp, n)));
});

test('a Clear panel open on a gate that is cleared elsewhere closes, and nothing can pay the gate a second time', async ({ device }) => {
  const page = (await device('gm')).page;
  await onboardGM(page);
  const gate = await gateByName(page, 'Goblin Den'), start = await lifetimeXp(page);
  await gateCard(page, gate.id).locator('[data-act=clear]').tap();
  const form = await openClearPanel(page, gate.id);
  // the gate cleared and paid from outside this card, as a player's solo run taken on this phone or another GM phone's world would leave it
  await page.evaluate(id => hunterApp.store.update((d: any) => {
    const g = d.gates.find((x: any) => x.id === id);
    g.status = 'cleared'; g.clearedDay = d.world.day; g.xpPaid = 999;
  }, 'test-setup'), gate.id);
  await expect(form).toHaveCount(0);
  await expect(gateCard(page, gate.id).locator('[data-act=clear]')).toHaveCount(0);
  await expect(gateCard(page, gate.id).locator('.gt-chip.st-cleared')).toHaveCount(1);
  const g = await page.evaluate(id => hunterApp.store.get().gates.find((x: any) => x.id === id), gate.id);
  expect([g.status, g.xpPaid, gained(start, await lifetimeXp(page))]).toEqual(['cleared', 999, Object.fromEntries(Object.keys(start).map(k => [k, 0]))]);
});

test('a gate cleared after End fight without XP still pays each hunter its share of the gate XP', async ({ device }) => {
  const page = (await device('gm')).page;
  await onboardGM(page);
  const gate = await gateByName(page, 'Goblin Den'), start = await lifetimeXp(page), n = Object.keys(start).length;
  await startGate(page, gate.id);
  await defeatAllMonsters(page);
  await endEncounter(page);
  await sys(page, 'End without XP');
  await sys(page, 'Mark gate cleared');
  const form = await openClearPanel(page, gate.id);
  const says = await promisedXp(form);
  const after = await submitClear(page, form);
  expect(says).toBe(share(gate.xp, n));
  expect(Object.values(gained(start, after))).toEqual(Object.values(start).map(() => share(gate.xp, n)));
});

test('clearing a gate lists the room player, pre-ticked, and the party of 4 takes the gate XP each, the player once', async ({ device }) => {
  const gm = (await device('gm')).page, player = (await device('player')).page;
  await onboardGM(gm);
  const code = await createRoom(gm);
  expect(code).toMatch(ROOM_CODE);
  await onboardPlayer(player, 'Kai Test', code);
  await expect.poll(() => gm.evaluate(() => hunterApp.api.sync.remoteSheets().some((r: any) => r.data && r.data.name === 'Kai Test'))).toBe(true);
  await dismissAll(player, 4);
  const gate = await gateByName(gm, 'Goblin Den'), start = await lifetimeXp(gm);
  const kaiBefore = await activeHunter(player);
  const kaiTotal = (h: any) => h.xp + 100 * (h.level - 1) * h.level / 2;

  await startGate(gm, gate.id);
  await gm.locator('#view-combat [data-addparty]').tap();
  await expect(gm.locator('#view-combat .cmb-row', { hasText: 'Kai Test' })).toHaveCount(1);
  await defeatAllMonsters(gm);
  await endEncounter(gm);
  await sys(gm, 'End without XP');
  await sys(gm, 'Mark gate cleared');
  const form = await openClearPanel(gm, gate.id, false);
  await expect(form.locator('label', { hasText: 'Kai Test' }).locator('input')).toHaveCount(1);
  const boxes = await form.locator('input[name=hid]').evaluateAll(all => all.map((b: any) => b.checked));
  expect(boxes.length, 'hunters listed in Award to').toBe(4);
  expect(boxes.every(Boolean), 'every hunter ticked').toBe(true);
  expect(share(gate.xp, boxes.length), 'a party of the gate\'s size takes the gate XP each').toBe(gate.xp);
  const after = await submitClear(gm, form);

  await expect.poll(async () => kaiTotal(await activeHunter(player)) - kaiTotal(kaiBefore)).toBe(gate.xp);
  await gm.waitForTimeout(2500);
  const kaiAfter = await activeHunter(player);
  expect(kaiTotal(kaiAfter) - kaiTotal(kaiBefore), 'XP Kai got').toBe(gate.xp);
  expect(kaiAfter.gold).toBeGreaterThan(kaiBefore.gold);
  expect(Object.values(gained(start, after)), 'XP the local hunters got').toEqual(Object.values(start).map(() => gate.xp));
});

test('the clear panel says the XP and gold each for the hunters ticked, more each as fewer are ticked, fits the phone, and pays exactly that', async ({ device }) => {
  const page = (await device('gm')).page;
  await onboardGM(page);
  const gate = await gateByName(page, 'Goblin Den');
  const start = await lifetimeXp(page);
  expect(Object.keys(start).length, 'three hunters on the GM\'s phone').toBe(3);
  const goldBefore: number[] = await page.evaluate(() => hunterApp.store.get().hunters.map((h: any) => h.gold));
  await go(page, 'gates');
  await gateCard(page, gate.id).locator('[data-act=clear]').tap();
  const form = await openClearPanel(page, gate.id);
  const gold = form.locator('[data-cleargold]'), boxes = form.locator('input[name=hid]');
  await expect.poll(() => promisedXp(form)).toBe(share(gate.xp, 3));
  await expect(gold).toHaveText(goldEachE(3));
  await test.step('the note fits a 390 px wide phone: nothing runs past the panel or the screen', async () => {
    const note = form.locator('.gt-notes');
    await note.scrollIntoViewIfNeeded();
    const fit = await note.evaluate((el: any) => ({ over: el.scrollWidth - el.clientWidth, right: el.getBoundingClientRect().right, wide: window.innerWidth }));
    expect(fit.wide).toBe(390);
    expect(fit.over, 'the note overflows its box').toBeLessThanOrEqual(0);
    expect(fit.right, 'the note runs past the screen').toBeLessThanOrEqual(fit.wide);
  });
  await boxes.nth(2).tap();
  await expect.poll(() => promisedXp(form)).toBe(share(gate.xp, 2));
  await expect(gold).toHaveText(goldEachE(2));
  await boxes.nth(2).tap();
  await expect.poll(() => promisedXp(form)).toBe(share(gate.xp, 3));
  const after = await submitClear(page, form);
  expect(Object.values(gained(start, after))).toEqual(Object.values(start).map(() => share(gate.xp, 3)));
  const goldGot = (await page.evaluate(() => hunterApp.store.get().hunters.map((h: any) => h.gold)) as number[]).map((g, i) => g - goldBefore[i]!);
  const [low = 0, high = 0] = RULES.loot.E.gold;
  expect(new Set(goldGot).size, 'each hunter takes the same share of the roll').toBe(1);
  expect(goldGot[0]!).toBeGreaterThanOrEqual(share(low, 3));
  expect(goldGot[0]!).toBeLessThanOrEqual(share(high, 3));
});

/** The XP of every monster in the running fight: what Award XP shares among its hunters as the gate's pot. */
const fightXp = (page: Page): Promise<number> => page.evaluate(() => hunterApp.store.get().fight.rows
  .filter((r: any) => r.side === 'foe').reduce((sum: number, r: any) => sum + r.xp, 0));

async function editGateStatus(page: Page, id: string, status: string): Promise<void> {
  await go(page, 'gates');
  const done = page.locator('#gt-done');
  if (await done.isVisible() && !(await done.evaluate((el: any) => el.open))) await done.locator('summary').tap();
  await gateCard(page, id).locator('[data-act=edit]').tap();
  const form = gateCard(page, id).locator('.gt-panel[data-form=edit]');
  await form.locator('select[name=status]').selectOption(status);
  await form.locator('button[type=submit]').tap();
  await expect(form).toBeHidden();
}

async function endFightExpectingAward(page: Page): Promise<void> {
  await go(page, 'combat');
  await defeatAllMonsters(page);
  await endEncounter(page);
  await expect(topWindow(page)).toContainText('Fight over');
  await expect(topWindow(page), 'the End window does not say the XP was already paid').not.toContainText('already paid');
  await expect(page.locator('.sys-overlay.show .sys-actions button', { hasText: 'Award XP to party' })).toBeVisible();
}

test('a gate cleared with no hunters selected still lets its running fight award each hunter its share of the monster XP', async ({ device }) => {
  const page = (await device('gm')).page;
  await onboardGM(page);
  const gate = await gateByName(page, 'Goblin Den');
  await startGate(page, gate.id);
  const xp = await fightXp(page), start = await lifetimeXp(page);

  await test.step('the GM clears the gate with every hunter unticked', async () => {
    await go(page, 'gates');
    await gateCard(page, gate.id).locator('[data-act=clear]').tap();
    const form = await openClearPanel(page, gate.id, false);
    for (const box of await form.locator('input[name=hid]').all()) if (await box.isChecked()) await box.tap();
    await form.locator('button[type=submit]').tap();
    await sys(page, 'Clear without rewards');
    await expect(form).toBeHidden();
    await dismissAll(page);
    expect(await lifetimeXp(page), 'the clear paid nobody').toEqual(start);
  });

  await test.step('the fight ends and pays every hunter in it its share of the XP of its monsters', async () => {
    await endFightExpectingAward(page);
    await sys(page, 'Award XP to party');
    await dismissAll(page);
    const n = Object.keys(start).length;
    expect(Object.values(gained(start, await lifetimeXp(page)))).toEqual(Object.values(start).map(() => share(xp, n)));
  });
});

test('a gate set back to detected and cleared again in the edit form shows the day of the second clear', async ({ device }) => {
  const page = (await device('gm')).page;
  await onboardGM(page);
  const gate = await gateByName(page, 'Goblin Den');
  const today = (): Promise<number> => page.evaluate(() => hunterApp.store.get().world.day);
  const first = await today();
  await editGateStatus(page, gate.id, 'cleared');
  await expect(gateCard(page, gate.id).locator('.gt-timer')).toHaveText(`Cleared on day ${first}`);
  await editGateStatus(page, gate.id, 'detected');
  for (let i = 0; i < 2; i++) {
    await page.locator('#view-gates [data-act=day][data-n="1"]').tap();
    await dismissAll(page);
  }
  expect(await today(), 'two days passed').toBe(first + 2);
  await editGateStatus(page, gate.id, 'cleared');
  await expect(gateCard(page, gate.id).locator('.gt-timer')).toHaveText(`Cleared on day ${first + 2}`);
});

test('a gate set to cleared in the edit form, which pays nobody, still lets its running fight award each hunter its share of the monster XP', async ({ device }) => {
  const page = (await device('gm')).page;
  await onboardGM(page);
  const gate = await gateByName(page, 'Goblin Den');
  await startGate(page, gate.id);
  const xp = await fightXp(page), start = await lifetimeXp(page);
  await editGateStatus(page, gate.id, 'cleared');
  expect(await lifetimeXp(page), 'the edit form paid nobody').toEqual(start);
  await endFightExpectingAward(page);
  await sys(page, 'Award XP to party');
  await dismissAll(page);
  const n = Object.keys(start).length;
  expect(Object.values(gained(start, await lifetimeXp(page)))).toEqual(Object.values(start).map(() => share(xp, n)));
});

test('a Lv 10 hunter works the Job Change chain from the Quests tab and becomes a Necromancer', async ({ device }) => {
  const page = (await device('gm')).page;
  await onboardGM(page);
  await page.evaluate(() => hunterApp.store.update(() => { const h = hunterApp.store.active(); h.level = 10; h.xp = 0; }, 'test-setup'));
  const hunterName = (await activeHunter(page)).name;
  const job = (title: string) => page.locator('#view-quests .qc', { hasText: title });

  await test.step('the GM issues the chain and the quest list moves straight to step 2', async () => {
    await go(page, 'quests');
    await page.locator('#view-quests [data-chain]').tap();
    await sys(page, hunterName);
    await sys(page, 'Necromancer');
    await expect(windowTitle(page)).toHaveText('QUEST COMPLETE');
    await dismissAll(page);
    await page.locator('#view-quests [data-tab="active"]').tap();
    await expect(job('Job Change 2/3: The Job Change Dungeon')).toHaveCount(1);
    await expect(job('Job Change 1/3')).toHaveCount(0);
  });

  await test.step('finishing step 2 unlocks step 3', async () => {
    await completeQuest(page, 'active', 'Job Change 2/3');
    await dismissAll(page);
    await go(page, 'quests');
    await page.locator('#view-quests [data-tab="active"]').tap();
    await expect(job('Job Change 3/3: Knight Captain')).toHaveCount(1);
  });

  await test.step('finishing step 3 announces the job and the hunter has it', async () => {
    await completeQuest(page, 'active', 'Job Change 3/3');
    await expect(topWindow(page)).toContainText('JOB CHANGE COMPLETE');
    await expect(topWindow(page)).toContainText('You are now a Necromancer');
    await dismissAll(page);
    expect((await activeHunter(page)).job).toBe('Necromancer');
    await go(page, 'quests');
    await page.locator('#view-quests [data-tab="active"]').tap();
    await expect(job('Job Change')).toHaveCount(0);
  });
});

test('every job can be earned through the Job Change chain when it is issued at Lv 1, 10 or 30', async ({ device }) => {
  const page = (await device('gm')).page;
  await onboardGM(page);
  const failures = await page.evaluate(async () => {
    const A = hunterApp.api, s = hunterApp.store, out: string[] = [], pause = () => new Promise(r => setTimeout(r, 30));
    for (const job of ['Necromancer', 'Assassin', 'Mage', 'Tanker', 'Healer', 'Fighter', 'Ranger']) for (const level of [1, 10, 30]) {
      const hid = s.active().id;
      s.update(() => { const h = s.hunter(hid); h.level = level; h.peakLevel = level; h.xp = 0; h.job = null; h.jobChain = null; h.quests = h.quests.filter((q: any) => !q.chainId); }, 'test-setup');
      A.quests.issueJobChain(hid, job); await pause();
      // Level 1 to 10 costs 100 XP per level held (xpPerLevel in rules.ts): 100 x (1 + 2 + ... + 9) = 4500.
      if (level < 10) A.hunter.gainXP(hid, 4500);
      await pause();
      for (const step of [2, 3]) {
        const c = s.hunter(hid).jobChain, q = c && c.step === step && s.hunter(hid).quests.find((x: any) => x.id === c.questId && x.status === 'active');
        if (!q) { out.push(`${job}@${level}: no step ${step}`); break; }
        await A.quests.complete(hid, q.id); await pause();
      }
      if (s.hunter(hid).job !== job) out.push(`${job}@${level}: job ${s.hunter(hid).job}`);
    }
    return out;
  });
  await dismissAll(page, 40);
  expect(failures).toEqual([]);
});

test('on a GM device, pre-made hunters roll over without a penalty and a hunter who did a daily is penalized when they skip', async ({ device }) => {
  const page = await newYorkPhone(device, 'gm', '2026-11-10T12:00:00-05:00');
  await onboardGM(page);
  const hunters: string[] = await page.evaluate(() => hunterApp.store.get().hunters.map((h: any) => h.name));
  const penaltyChips = page.locator('#gm-board .gm-card .gm-chip.pen');
  const dailyChips = page.locator('#gm-board .gm-card .gm-chip', { hasText: /^Daily \d\/1$/ });

  await test.step('the Quests tab does not warn of a penalty that will not come', async () => {
    await go(page, 'quests');
    await page.clock.runFor(2000);
    await expect(page.locator('#view-quests [data-warn]')).toBeHidden();
  });

  await test.step('a day passes with every daily at 40 progress and nobody is penalized', async () => {
    await page.evaluate(() => hunterApp.store.update(() => { for (const h of hunterApp.store.get().hunters) h.quests.find((q: any) => q.kind === 'daily').objectives[0].progress = 40; }, 'test-setup'));
    await passMinutePast(page, '2026-11-11T12:00:00-05:00');
    expect(await penaltyWindows(page)).toEqual([]);
    await go(page, 'gm');
    await expect(penaltyChips).toHaveCount(0);
    await expect(dailyChips).toHaveText(hunters.map(() => 'Daily 0/1'));
  });

  await test.step('the GM hunter completes the new daily, then two days pass: only that hunter is penalized', async () => {
    await completeQuest(page, 'daily');
    await dismissAll(page);
    await passMinutePast(page, '2026-11-13T12:00:00-05:00');
    await expect.poll(() => topWindow(page).isVisible()).toBe(true);
    const windows = await penaltyWindows(page);
    expect(windows).toHaveLength(1);
    expect(windows[0]).toContain('Brakk');
    await go(page, 'gm');
    await expect(penaltyChips).toHaveCount(1);
    await expect(page.locator('#gm-board .gm-card', { hasText: 'Brakk Ironhide' }).locator('.gm-chip.pen')).toHaveCount(1);
  });
});

test('on a player device, a missed daily is penalized and the sheet shows the Penalized chip', async ({ device }) => {
  const page = await newYorkPhone(device, 'player', '2026-11-10T12:00:00-05:00');
  await onboardPlayer(page, 'Solo Test');
  await dismissAll(page);
  await passMinutePast(page, '2026-11-11T12:00:00-05:00');
  await expect.poll(() => topWindow(page).isVisible()).toBe(true);
  expect(await penaltyWindows(page)).toHaveLength(1);
  await go(page, 'status');
  await expect(page.locator('#view-status [data-chip="penalized"]')).toBeVisible();
});

test('a daily streak keeps counting across the night the clocks fall back', async ({ device }) => {
  const page = await newYorkPhone(device, 'player', '2026-10-31T12:00:00-04:00');
  await onboardPlayer(page, 'Solo Test');
  await dismissAll(page);

  await completeQuest(page, 'daily');
  await expect(topWindow(page)).toContainText('DAILY QUEST COMPLETE');
  await expect(topWindow(page)).toContainText('Streak: 1 day');
  await dismissAll(page);

  await passMinutePast(page, '2026-11-01T23:30:00-05:00');
  await dismissAll(page);
  await completeQuest(page, 'daily');
  await expect(topWindow(page)).toContainText('DAILY QUEST COMPLETE');
  await expect(topWindow(page)).toContainText('Streak: 2 days');
});

test('on the morning the clocks spring forward, a missed daily is penalized when the countdown reaches zero, not an hour later', async ({ device }) => {
  const page = await newYorkPhone(device, 'player', '2026-03-07T12:00:00-05:00');
  await onboardPlayer(page, 'Solo Test');
  await dismissAll(page);
  // setup: personal gates off, so the gates the System opens over the night do not stand in front of the penalty's window
  await page.evaluate(() => hunterApp.store.update((d: any) => { d.settings.dailyResetHour = 4; d.rulesOverrides.solo = { personal: false }; }, 'test-setup'));

  await test.step('a minute before 4:00 the countdown is under a minute and nothing has happened', async () => {
    await page.clock.pauseAt(new Date('2026-03-08T03:58:00-04:00'));
    await page.clock.runFor(61_000);
    await go(page, 'quests');
    await page.locator('#view-quests [data-tab="daily"]').tap();
    await expect(page.locator('#view-quests [data-countdown]')).toHaveText('Resets in 00:00:59');
    await page.clock.runFor(58_000);
    expect(await topWindow(page).isVisible()).toBe(false);
  });

  await test.step('at 4:00 EDT the PENALTY window opens', async () => {
    await page.clock.runFor(2_000);
    await expect.poll(() => topWindow(page).isVisible()).toBe(true);
    expect(await penaltyWindows(page)).toHaveLength(1);
  });
});

test('an urgent quest fails at its due time, and asks for a new due time before it is reopened', async ({ device }) => {
  const page = await newYorkPhone(device, 'player', '2026-11-10T12:00:00-05:00');
  await onboardPlayer(page, 'Solo Test');
  await dismissAll(page);
  const form = page.locator('#view-quests form[data-form]');
  const card = page.locator('#view-quests .qc', { hasText: 'Hold the bridge' });

  await test.step('the player makes an urgent quest due at 12:10', async () => {
    await go(page, 'quests');
    await page.locator('#view-quests [data-new]').tap();
    await form.locator('[name=kind]').selectOption('urgent');
    await form.locator('[name=title]').fill('Hold the bridge');
    await form.locator('[name=dueAt]').fill('2026-11-10T12:10');
    await form.locator('button[type=submit]').tap();
    await expect(card).toHaveCount(1);
  });

  await test.step('it fails at 12:10, not before', async () => {
    await page.clock.pauseAt(new Date('2026-11-10T12:09:59-05:00'));
    expect(await topWindow(page).isVisible()).toBe(false);
    await page.clock.runFor(2_000);
    await expect(windowTitle(page)).toHaveText('Quest failed');
    await dismissAll(page);
  });

  await test.step('Reopen asks for a new due time; with one the quest is active again', async () => {
    await page.locator('#view-quests [data-tab="failed"]').tap();
    await card.locator('[data-reopen]').tap();
    await expect(page.locator('#toasts .toast').last()).toContainText('Set a new due time first.');
    await expect(form.locator('[data-ftitle]')).toHaveText('Edit quest');
    await form.locator('[name=dueAt]').fill('2026-11-10T13:00');
    await form.locator('button[type=submit]').tap();
    await card.locator('[data-reopen]').tap();
    await page.locator('#view-quests [data-tab="active"]').tap();
    await expect(card.locator('[data-done]')).toBeVisible();
  });
});

test('E gates spawn E-sized packs of regular monsters and D gates keep 2 to 6', async ({ device }) => {
  const page = (await device('gm')).page;
  await onboardGM(page);
  const r = await page.evaluate(() => {
    const A = hunterApp.api, counts: Record<string, number[]> = { E: [], D: [] };
    for (const rank of ['E', 'D']) for (let i = 0; i < 60; i++) {
      const g = A.gates.spawn({ rank, type: 'normal' });
      counts[rank]!.push(g.monsters.reduce((a: number, m: any) => a + m.count, 0));
    }
    const range = hunterApp.rules().gateSpawn.regulars;
    return { E: [Math.min(...counts.E!), Math.max(...counts.E!)], D: [Math.min(...counts.D!), Math.max(...counts.D!)], rule: range ? range.E : null };
  });
  expect(r.rule, 'E range in the rules').not.toBeNull();
  expect(r.E[0]).toBeGreaterThanOrEqual(r.rule[0]);
  expect(r.E[1]).toBeLessThanOrEqual(r.rule[1]);
  expect(r.E[1]).toBeLessThan(6);
  expect(r.D[0]).toBeGreaterThanOrEqual(2);
  expect(r.D[1]).toBeLessThanOrEqual(6);
});

test('ability points and the HP refill cannot be farmed by gaining levels, spending the points, losing the levels and regaining them', async ({ device }) => {
  const page = (await device('gm')).page;
  await onboardGM(page);
  const sheet = async () => {
    await go(page, 'status');
    const text = async (sel: string) => (await page.locator(sel).first().innerText()).replace(/\s+/g, ' ').trim();
    return {
      level: Number(await text('#view-status [data-lv]')),
      points: Number(await text('#view-status [data-ap]')),
      str: Number(await text('#view-status .stat[data-k="str"] [data-v]')),
      hp: await text('#view-status [data-bar="hp"] .bar-nums'),
      mana: await text('#view-status [data-bar="mana"] .bar-nums'),
    };
  };
  const award = async (xp: number) => {
    await go(page, 'gm');
    const toggle = page.locator('[data-tog="award"]');
    if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.tap();
    const hid = (await activeHunter(page)).id, box = page.locator(`input[data-sel="${hid}"]`);
    if (!(await box.isChecked())) await box.tap();
    await page.locator('#gm-xp').fill(String(xp));
    await page.locator('#gm-award-go').tap();
  };

  const start = await sheet();
  expect(start.level).toBe(1);

  await award(500);
  await expect.poll(async () => (await activeHunter(page)).level).toBeGreaterThan(1);
  await answerWindow(page, 'REWARDS ACQUIRED');
  await answerWindow(page, 'LEVEL UP!');
  const levelled = await sheet();
  expect(levelled.points).toBeGreaterThan(0);

  for (let i = 0; i < levelled.points; i++) await page.locator('#view-status .stat[data-k="str"] [data-dir="1"]').tap();
  await page.locator('#view-status [data-confirm]').tap();
  await expect(page.locator('#view-status [data-ap]')).toHaveText('0');
  const spent = await sheet();
  expect(spent.str).toBe(levelled.str + levelled.points);

  await award(-500);
  await expect.poll(async () => (await activeHunter(page)).level).toBe(1);
  await answerWindow(page, 'REWARDS ACQUIRED');

  await award(500);
  await expect.poll(async () => (await activeHunter(page)).level).toBe(levelled.level);
  await answerWindow(page, 'REWARDS ACQUIRED');
  await answerWindow(page, 'LEVEL UP!');
  const again = await sheet();
  expect(again.level).toBe(levelled.level);
  expect(again.str + again.points, 'STR plus unspent points').toBe(spent.str + spent.points);
  // Level 1 clamped HP to the level 1 maximum. Regaining levels 2 and 3 does not refill, so HP stays there. Brakk's
  // Vitality is 18 and Iron Skin's 2, so 20: x(20) = 7.41 and a level 1 body has 45 * (1 + 0.9 * 7.41 / 47.41) = 51.33
  // HP (`hpBase` 45, `hpVitCap` 0.9, `half` 40), 51. Level 3 has 51.33 * (1 + 2/24) = 55.61, 56 (`growthDiv` 24).
  // Mana does not grow with level (`manaBase`), so it stays full.
  const [hp, hpMax] = again.hp.replace(/[,\s]/g, '').split('/').map(Number);
  const [mana, manaMax] = again.mana.replace(/[,\s]/g, '').split('/').map(Number);
  expect({ hp, hpMax, mana }, 'HP and mana after regaining lost levels').toEqual({ hp: 51, hpMax: 56, mana: manaMax });
});

const strCheck = async (page: Page): Promise<number> => {
  await go(page, 'status');
  return +(await page.locator('#view-status [data-cb-k="str"] b').innerText()).replace('−', '-');
};
const penalizedChip = (page: Page) => page.locator('#view-status [data-chips] [data-chip="penalized"]');
/** The Penalty Zone quest cards on one tab of the Quests view. */
async function penaltyCards(page: Page, tab: 'active' | 'failed') {
  await go(page, 'quests');
  await page.locator(`#view-quests [data-tab="${tab}"]`).tap();
  return page.locator('#view-quests .qc.kind-penalty');
}
/** A player on the New York clock whose daily stays undone, after the first rollover: one PENALTY window seen and closed. */
async function penalizedPlayer(device: (label: string) => Promise<{ page: Page }>): Promise<{ page: Page; check0: number }> {
  const page = await newYorkPhone(device, 'player', '2026-11-10T12:00:00-05:00');
  await onboardPlayer(page, 'Solo Test');
  await dismissAll(page);
  const check0 = await strCheck(page);
  await passMinutePast(page, '2026-11-11T12:00:00-05:00');
  await expect.poll(() => topWindow(page).isVisible()).toBe(true);
  expect(await penaltyWindows(page)).toHaveLength(1);
  return { page, check0 };
}

test('a player who clears the Penalty Zone quest loses the Penalized chip and the -2 on checks', async ({ device }) => {
  const { page, check0 } = await penalizedPlayer(device);

  await test.step('after a missed daily the sheet shows Penalized and checks are 2 lower (penaltyCheck in rules.ts)', async () => {
    await go(page, 'status');
    await expect(penalizedChip(page)).toHaveCount(1);
    expect(await strCheck(page)).toBe(check0 - 2);
  });

  await test.step('completing the Penalty Zone quest says PENALTY ZONE CLEARED', async () => {
    await (await penaltyCards(page, 'active')).locator('[data-done]').tap();
    await expect(windowTitle(page)).toHaveText('Complete quest?');
    await topWindow(page).locator('.sys-actions button.primary', { hasText: 'Complete' }).tap();
    await expect(windowTitle(page)).toHaveText('PENALTY ZONE CLEARED');
    await dismissAll(page);
  });

  await test.step('the chip is gone and checks are back where they were', async () => {
    await go(page, 'status');
    await expect(penalizedChip(page)).toHaveCount(0);
    expect(await strCheck(page)).toBe(check0);
  });
});

test('a player who fails the Penalty Zone quest stays Penalized, and the next missed day brings a new Penalty Zone quest', async ({ device }) => {
  const { page } = await penalizedPlayer(device);

  await test.step('failing the Penalty Zone quest leaves the hunter Penalized', async () => {
    await (await penaltyCards(page, 'active')).locator('[data-fail]').tap();
    await expect(windowTitle(page)).toHaveText('Fail quest?');
    await topWindow(page).locator('.sys-actions button', { hasText: 'Fail quest' }).tap();
    await expect(page.locator('.sys-overlay.show')).toHaveCount(0);
    await expect(await penaltyCards(page, 'active')).toHaveCount(0);
    await go(page, 'status');
    await expect(penalizedChip(page)).toHaveCount(1);
  });

  await test.step('the next missed day shows PENALTY and gives a new Penalty Zone quest; the failed one stays failed', async () => {
    await passMinutePast(page, '2026-11-12T12:00:00-05:00');
    await expect.poll(() => topWindow(page).isVisible()).toBe(true);
    expect(await penaltyWindows(page)).toHaveLength(1);
    await expect(await penaltyCards(page, 'active')).toHaveCount(1);
    await expect(await penaltyCards(page, 'failed')).toHaveCount(1);
    await go(page, 'status');
    await expect(penalizedChip(page)).toHaveCount(1);
  });

  await test.step('the penalty holds both missed days and is tied to the new quest', async () => {
    // Nov 11 and Nov 12 each rolled over with the daily undone: 1 + 1 = 2 days.
    const h = await activeHunter(page);
    const open = h.quests.find((q: any) => q.kind === 'penalty' && q.status === 'active');
    expect(h.penalty).toMatchObject({ days: 2, questId: open.id });
  });
});

test('the edit form of a Penalty Zone quest has no Kind, and a saved edit keeps it the Penalty Zone quest', async ({ device }) => {
  const { page } = await penalizedPlayer(device);
  const card = await penaltyCards(page, 'active');
  await card.locator('[data-edit]').tap();
  const form = page.locator('#view-quests form[data-form]');
  await expect(form.locator('[data-ftitle]')).toHaveText('Edit quest');
  await expect(form.locator('select[name="kind"]')).toBeHidden();
  await expect(form.locator('input[name="title"]')).toBeVisible();
  await form.locator('input[name="title"]').fill('Penalty Zone: the swamp');
  await form.locator('button[type="submit"]').tap();
  await expect(form).toBeHidden();
  await expect((await penaltyCards(page, 'active')).locator('.qc-title')).toHaveText('Penalty Zone: the swamp');
  const h = await activeHunter(page);
  expect(h.quests.find((q: any) => q.id === h.penalty.questId)).toMatchObject({ kind: 'penalty', title: 'Penalty Zone: the swamp' });
});

test('a player sees no Delete on the Penalty Zone quest that holds their penalty; the GM deletes it and the penalty is lifted', async ({ device }) => {
  await test.step('the player\'s Penalty Zone quest offers Complete and Fail but no Delete, open or failed; their daily still offers Delete', async () => {
    const { page } = await penalizedPlayer(device);
    const open = await penaltyCards(page, 'active');
    await expect(open.locator('[data-fail]')).toHaveCount(1);
    await expect(open.locator('[data-del]')).toHaveCount(0);
    await open.locator('[data-fail]').tap();
    await expect(windowTitle(page)).toHaveText('Fail quest?');
    await topWindow(page).locator('.sys-actions button', { hasText: 'Fail quest' }).tap();
    await expect(page.locator('.sys-overlay.show')).toHaveCount(0);
    const failed = await penaltyCards(page, 'failed');
    await expect(failed).toHaveCount(1);
    await expect(failed.locator('[data-del]')).toHaveCount(0);
    await page.locator('#view-quests [data-tab="daily"]').tap();
    await expect(page.locator('#view-quests .qc.kind-daily [data-del]')).toHaveCount(1);
  });

  await test.step('on the GM\'s phone the same quest offers Delete, the window says it lifts the penalty, and the Penalized chip is gone', async () => {
    const page = await newYorkPhone(device, 'gm', '2026-11-10T12:00:00-05:00');
    await onboardGM(page);
    const name: string = await page.evaluate(() => {
      const h = hunterApp.store.active();
      hunterApp.store.update(() => { h.daily.lastCompleteKey = '2026-11-09'; }, 'test-setup');
      return h.name;
    });
    await passMinutePast(page, '2026-11-11T12:00:00-05:00');
    await expect.poll(() => topWindow(page).isVisible()).toBe(true);
    expect(await penaltyWindows(page)).toEqual([expect.stringContaining(name)]);
    await go(page, 'status');
    await expect(penalizedChip(page)).toHaveCount(1);
    await (await penaltyCards(page, 'active')).locator('[data-del]').tap();
    await expect(windowTitle(page)).toHaveText('Delete quest?');
    await expect(topWindow(page)).toContainText(`Deleting it clears ${name}'s penalty.`);
    await topWindow(page).locator('.sys-actions button', { hasText: 'Delete' }).tap();
    await expect(page.locator('.sys-overlay.show')).toHaveCount(0);
    await expect(await penaltyCards(page, 'active')).toHaveCount(0);
    await go(page, 'status');
    await expect(penalizedChip(page)).toHaveCount(0);
  });
});

test('a failed Job Change shows on the Quests tab: the player is told the GM can reissue it, and the GM reissues the step and the hunter becomes a Necromancer', async ({ device }) => {
  const failedCard = (page: Page) => page.locator('#view-quests [data-jobchain]');
  const job = (page: Page, title: string) => page.locator('#view-quests .qc', { hasText: title });
  async function failStep(page: Page, title: string): Promise<void> {
    await go(page, 'quests');
    await page.locator('#view-quests [data-tab="active"]').tap();
    await job(page, title).locator('[data-fail]').tap();
    await expect(windowTitle(page)).toHaveText('Fail quest?');
    await topWindow(page).locator('.sys-actions button', { hasText: 'Fail quest' }).tap();
    await expect(page.locator('.sys-overlay.show')).toHaveCount(0);
  }

  await test.step('a player whose step 1 fails sees the failed Job Change and no Reissue or Reopen', async () => {
    const page = (await device('player')).page;
    await onboardPlayer(page, 'Solo Test');
    await dismissAll(page);
    await page.evaluate(() => hunterApp.api.quests.issueJobChain(hunterApp.store.active().id, 'Mage'));
    await failStep(page, 'Job Change 1/3');
    await expect(failedCard(page)).toBeVisible();
    await expect(failedCard(page)).toContainText('Job Change failed: Mage, step 1 of 3');
    await expect(failedCard(page)).toContainText('The GM can reissue it.');
    await expect(failedCard(page).locator('[data-reissue], [data-abandon]')).toHaveCount(0);
    await page.locator('#view-quests [data-tab="failed"]').tap();
    await expect(job(page, 'Job Change 1/3').locator('[data-reopen]')).toHaveCount(0);
  });

  await test.step('the GM fails step 2 of a Lv 10 hunter\'s chain, reissues it, and the hunter finishes steps 2 and 3', async () => {
    const page = (await device('gm')).page;
    await onboardGM(page);
    await page.evaluate(() => hunterApp.store.update(() => { const h = hunterApp.store.active(); h.level = 10; h.peakLevel = 10; h.xp = 0; }, 'test-setup'));
    const hunterName = (await activeHunter(page)).name;
    await go(page, 'quests');
    await page.locator('#view-quests [data-chain]').tap();
    await sys(page, hunterName);
    await sys(page, 'Necromancer');
    // Level 10 is step 1's level (CHAIN_LEVEL in src/core/registry/jobs.ts), so step 1 completes as the chain is issued.
    await expect(windowTitle(page)).toHaveText('QUEST COMPLETE');
    await dismissAll(page);
    await failStep(page, 'Job Change 2/3');
    await expect(failedCard(page)).toContainText('Job Change failed: Necromancer, step 2 of 3');
    await failedCard(page).locator('[data-reissue]').tap();
    await expect(failedCard(page)).toBeHidden();
    await page.locator('#view-quests [data-tab="active"]').tap();
    await expect(job(page, 'Job Change 2/3')).toHaveCount(1);
    await completeQuest(page, 'active', 'Job Change 2/3');
    await dismissAll(page);
    await completeQuest(page, 'active', 'Job Change 3/3');
    await expect(topWindow(page)).toContainText('You are now a Necromancer');
    await dismissAll(page);
    expect((await activeHunter(page)).job).toBe('Necromancer');
  });
});

test('Start session counts on from the campaign\'s last session after its log has dropped the old lines, and moves the day once', async ({ device }) => {
  const page = (await device('gm')).page;
  await onboardGM(page);
  await page.evaluate(() => hunterApp.store.update((d: any) => { d.world.session = 41; d.world.day = 7; d.log = []; d.gates = []; }, 'test-setup'));
  await go(page, 'gm');
  const toggle = page.locator('#view-gm [data-tog="cheat"]');
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.tap();
  await page.locator('#gm-s-go').tap();
  await expect(page.locator('#gm-s-msg')).toHaveText('Session 42 began on day 8. A backup was saved.');
  const after = await page.evaluate(() => { const s = hunterApp.store.get(); return { world: s.world, log: s.log.map((l: any) => [l.title, l.text]) }; });
  expect(after.world).toMatchObject({ day: 8, session: 42 });
  expect(after.log).toEqual([['Session 42 began', 'A backup was saved. World day 8.'], ['World day', 'Day advanced by 1 to 8.']]);
});

test('a GM makes a quest the System counts: two rests complete it with its window, and a quest that fails costs what If it fails says', async ({ device }) => {
  const page = (await device('gm')).page;
  await onboardGM(page);
  await dismissAll(page, 6);
  await page.evaluate(() => hunterApp.store.update((d: any) => { d.rulesOverrides.feats = { on: false }; d.rulesOverrides.solo = { personal: false }; }, 'test-setup'));
  const form = page.locator('#view-quests form[data-form]');
  const card = (title: string) => page.locator('#view-quests .qc', { hasText: title });

  await test.step('the GM writes "Catch your breath": two rests, counted by the System', async () => {
    await go(page, 'quests');
    await page.locator('#view-quests [data-new]').tap();
    await form.locator('[name=title]').fill('Catch your breath');
    await form.locator('[name=olabel]').fill('Rests');
    await form.locator('[name=otarget]').fill('2');
    await form.locator('[data-ocb]').selectOption('system');
    await form.locator('[data-ocount] [data-ck]').selectOption('rest');
    await form.locator('button[type=submit]').tap();
    await expect(card('Catch your breath').locator('[data-counted]')).toHaveText('Counted by the System');
    await expect(card('Catch your breath').locator('[data-done]'), 'the System completes it, so no tap does').toHaveCount(0);
  });

  await test.step('two rests on the sheet complete it, and its window opens once', async () => {
    await go(page, 'status');
    await page.locator('#view-status [data-rest]').tap();
    const q = () => page.evaluate(() => hunterApp.store.active().quests.find((x: any) => x.title === 'Catch your breath'));
    await expect.poll(async () => (await q()).objectives[0].progress).toBe(1);
    await page.locator('#view-status [data-rest]').tap();
    await answerWindow(page, 'QUEST COMPLETE');
    const done = await q();
    expect(done.status).toBe('done');
    await expect.poll(async () => (await q()).told, 'the window answered is told in the quest').toBe(true);
    await page.reload();
    await expect(page.locator('#view-status [data-rest]')).toBeVisible();
  });

  await test.step('a hunter with 80 gold, on a quest that costs 50 gold if it fails, has 30 when the GM taps Fail', async () => {
    await page.evaluate(() => hunterApp.store.update(() => { hunterApp.store.active().gold = 80; }, 'test-setup'));
    await go(page, 'quests');
    await page.locator('#view-quests [data-new]').tap();
    await form.locator('[name=title]').fill('Hold the line');
    await form.locator('[name=olabel]').fill('Hold');
    await form.locator('#qf-fail-gold').fill('-50');
    await form.locator('button[type=submit]').tap();
    await expect(card('Hold the line').locator('[data-onfail]')).toContainText('Loses 50 gold');
    await card('Hold the line').locator('[data-fail]').tap();
    await answerWindow(page, 'Fail quest?', 'Fail quest');
    const win = page.locator('.sys-overlay.show', { hasText: 'Quest failed' });
    await expect(win).toContainText('Hold the line');
    await expect(win).toContainText('Loses 50 gold');
    await expect(page.locator('.sys-overlay', { hasText: 'QUEST COMPLETE' }), 'the completed quest\'s window, told before the reload, was not queued again by it').toHaveCount(0);
    expect(await page.evaluate(() => hunterApp.store.active().gold)).toBe(30);
    expect((await page.evaluate(() => hunterApp.store.active().quests.find((x: any) => x.title === 'Hold the line'))).status).toBe('failed');
  });
});

test('from the GM view with Issue quest open, "Defeat 10 Beasts in one session, or lose 50 gold" takes 10 taps besides the typing', async ({ device }) => {
  const page = (await device('gm')).page;
  await onboardGM(page);
  await page.evaluate(() => hunterApp.store.update((d: any) => { d.rulesOverrides.feats = { on: false }; d.rulesOverrides.solo = { personal: false }; }, 'test-setup'));
  const name = (await activeHunter(page)).name as string;
  await go(page, 'gm');
  const quest = page.locator('[data-tog="quest"]'), award = page.locator('[data-tog="award"]');
  await expect(quest, 'Issue quest starts closed').toHaveAttribute('aria-expanded', 'false');
  await expect(award, 'the Award section, where the hunters are picked, starts closed').toHaveAttribute('aria-expanded', 'false');
  await quest.tap();
  const form = page.locator('#gm-qf'), count = form.locator('[data-ocount]');
  let taps = 0;
  const tap = async (l: import('@playwright/test').Locator) => { taps += 1; await l.tap(); };
  /** A select is two taps on a phone: one opens it, one picks. */
  const pick = async (l: import('@playwright/test').Locator, value: string) => { taps += 2; await l.selectOption(value); };

  await form.locator('[name=title]').fill('Beast hunt');
  await form.locator('[name=olabel]').fill('Defeat Beasts');
  await form.locator('[name=otarget]').fill('10');
  await pick(form.locator('[data-ocb]'), 'system');
  await tap(count.locator('[data-tadd]'));
  await pick(count.locator('[data-test] [data-tf]'), 'type');
  await count.locator('[data-test] [data-tv]').fill('Beast');
  await pick(count.locator('[data-cw]'), 'session');
  await form.locator('#gmq-fail-gold').fill('-50');
  await tap(award);
  await tap(page.locator('#gm-targets label', { hasText: name }));
  await tap(page.locator('#gm-q-go'));
  await expect(page.locator('#gm-q-msg')).toHaveText('Issued to 1 hunter.');

  const q = (await activeHunter(page)).quests.find((x: any) => x.title === 'Beast hunt');
  expect(q.objectives).toEqual([{ label: 'Defeat Beasts', target: 10, progress: 0,
    count: { rule: { on: 'kill', where: [{ field: 'type', op: '=', value: 'Beast' }], measure: { of: 'facts' }, within: 'session' }, mark: '' } }]);
  expect(q.onFail).toMatchObject({ gold: -50 });
  expect(taps, 'Counted by 2, Add a condition 1, its field 2, Within 2, the Award section 1, the hunter 1, Issue quest 1').toBe(10);
});

/** The GM's phone alone, its feats and personal gates off, so no window of theirs stands in front of the ones a test waits for. */
async function quietGM(device: (label: string, options?: DeviceOptions) => Promise<{ page: Page }>, start: string): Promise<Page> {
  const page = await newYorkPhone(device, 'gm', start);
  await onboardGM(page);
  await dismissAll(page, 6);
  await page.evaluate(() => hunterApp.store.update((d: any) => { d.rulesOverrides.feats = { on: false }; d.rulesOverrides.solo = { personal: false }; }, 'test-setup'));
  return page;
}
/** The GM writes an urgent quest for the hunter on screen, due in `hours`, that costs `gold` if it fails. */
async function urgentWithCost(page: Page, title: string, hours: number, gold: number): Promise<void> {
  const form = page.locator('#view-quests form[data-form]');
  await page.locator('#view-quests [data-new]').tap();
  await form.locator('[name=kind]').selectOption('urgent');
  await form.locator('[name=title]').fill(title);
  await form.locator('[name=dueHours]').fill(String(hours));
  await form.locator('#qf-fail-gold').fill(String(-gold));
  await form.locator('button[type=submit]').tap();
  await expect(form).toBeHidden();
  await expect(page.locator('#view-quests .qc', { hasText: title }).locator('[data-onfail]')).toContainText(`Loses ${gold} gold`);
}

test('two urgent quests that run out at once each show their own cost, and each cost is paid', async ({ device }) => {
  const page = await quietGM(device, '2026-11-10T12:00:00-05:00');
  const gold = () => page.evaluate(() => hunterApp.store.active().gold);
  await go(page, 'quests');
  await urgentWithCost(page, 'Hold the bridge', 0.25, 30);
  await urgentWithCost(page, 'Guard the gate', 0.25, 5);
  await page.evaluate(() => hunterApp.store.update(() => { hunterApp.store.active().gold = 100; }, 'test-setup'));
  await page.clock.runFor(16 * 60_000);
  const failed = page.locator('.sys-overlay.show', { hasText: 'Quest failed' });
  await expect(failed.first()).toContainText('Hold the bridge');
  await expect(failed.first()).toContainText('Loses 30 gold');
  await answerWindow(page, 'Hold the bridge');
  await expect(failed.first()).toContainText('Guard the gate');
  await expect(failed.first()).toContainText('Loses 5 gold');
  await expect(failed.first()).not.toContainText('Loses 30 gold');
  await answerWindow(page, 'Guard the gate');
  expect(await gold()).toBe(65);
});

test('an urgent quest whose failing write is refused shows no QUEST FAILED and stays active; a minute on the rollover fails it once', async ({ device }) => {
  const page = await newYorkPhone(device, 'player', '2026-11-10T12:00:00-05:00');
  await onboardPlayer(page, 'Solo Test');
  await dismissAll(page);
  const form = page.locator('#view-quests form[data-form]');
  const status = () => page.evaluate(() => hunterApp.store.active().quests.find((q: any) => q.title === 'Hold the bridge').status);
  const failed = page.locator('.sys-overlay', { hasText: 'Quest failed' });
  await go(page, 'quests');
  await page.locator('#view-quests [data-new]').tap();
  await form.locator('[name=kind]').selectOption('urgent');
  await form.locator('[name=title]').fill('Hold the bridge');
  await form.locator('[name=dueAt]').fill('2026-11-10T12:10');
  await form.locator('button[type=submit]').tap();
  await expect(form).toBeHidden();

  await test.step('the write is refused at 12:10: no window, the quest still active, and no second try within the minute', async () => {
    await page.evaluate(() => {
      const api = hunterApp.api.hunter, w = window as any;
      w.kept = api.grantWrite; w.tries = 0;
      api.grantWrite = (why: string, step: (s: unknown) => unknown) => (why === 'daily-check' ? (w.tries++, step(hunterApp.store.get()), { ok: false, why: 'fight' }) : w.kept(why, step));
    });
    await page.clock.runFor(10 * 60_000 + 1_000);
    expect(await page.evaluate(() => (window as any).tries)).toBe(1);
    await page.clock.runFor(30_000);
    expect(await page.evaluate(() => (window as any).tries), 'tried again a minute on, not at once').toBe(1);
    await expect(failed).toHaveCount(0);
    expect(await status()).toBe('active');
  });

  await test.step('the refusal gone, the next try fails it with one window', async () => {
    await page.evaluate(() => { hunterApp.api.hunter.grantWrite = (window as any).kept; });
    await page.clock.runFor(31_000);
    await expect(failed).toHaveCount(1);
    await expect(failed).toContainText('Hold the bridge: the time limit has expired.');
    expect(await status()).toBe('failed');
  });
});

test('a GM editing one hunter\'s quest who picks another hunter sees the form close, and no quest is copied to the other hunter', async ({ device }) => {
  const page = await quietGM(device, '2026-11-10T12:00:00-05:00');
  const form = page.locator('#view-quests form[data-form]');
  const titles = (i: number) => page.evaluate(n => hunterApp.store.get().hunters[n].quests.map((q: any) => q.title), i);
  const [first, second] = await page.evaluate(() => hunterApp.store.get().hunters.slice(0, 2).map((h: any) => h.id));
  await page.evaluate(h => hunterApp.api.quests.issue([h], { kind: 'side', title: 'Clear the den', objectives: [{ label: 'Goblins', target: 3 }] }), first);
  await page.locator('#hunter-sel').selectOption(first);
  await go(page, 'quests');
  const before = await titles(1);
  const card = page.locator('#view-quests .qc', { hasText: 'Clear the den' });
  await card.locator('[data-edit]').tap();
  await expect(form).toBeVisible();
  await form.locator('[name=title]').fill('Copied over');
  await page.locator('#hunter-sel').selectOption(second);
  await expect(form).toBeHidden();
  expect(await titles(1)).toEqual(before);
  expect((await titles(0)).includes('Copied over')).toBe(false);
});

test('a New quest form opened as a player closes when the phone switches to GM mode, and saves nothing', async ({ device }) => {
  const page = (await device('player')).page;
  await onboardPlayer(page, 'Solo Test');
  await dismissAll(page);
  const form = page.locator('#view-quests form[data-form]');
  await go(page, 'quests');
  await page.locator('#view-quests [data-new]').tap();
  await form.locator('[name=title]').fill('Half written');
  await page.locator('#mode-pill').tap();
  await answerWindow(page, 'Switch to GM mode?', 'Enter GM mode');
  await expect(form).toBeHidden();
  await page.locator('#view-quests [data-new]').tap();
  await expect(form.locator('[data-who]'), 'opened again as the GM, the form asks whom it is for').toBeVisible();
  expect(await page.evaluate(() => hunterApp.store.get().hunters.flatMap((h: any) => h.quests.map((q: any) => q.title)))).not.toContain('Half written');
});

test('a GM\'s daily the System counts opens QUEST COMPLETE on the second day as on the first', async ({ device }) => {
  const page = await quietGM(device, '2026-11-10T12:00:00-05:00');
  const form = page.locator('#view-quests form[data-form]');
  const rest = async () => { await go(page, 'status'); await page.locator('#view-status [data-rest]').tap(); };

  await test.step('the GM writes a daily of one rest, counted by the System', async () => {
    await go(page, 'quests');
    await page.locator('#view-quests [data-new]').tap();
    await form.locator('[name=kind]').selectOption('daily');
    await form.locator('[name=title]').fill('Catch your breath');
    await form.locator('[name=olabel]').fill('Rests');
    await form.locator('[data-ocb]').selectOption('system');
    await form.locator('[data-ocount] [data-ck]').selectOption('rest');
    await form.locator('button[type=submit]').tap();
    await expect(form).toBeHidden();
  });

  await test.step('day 1: a rest completes it and its window opens', async () => {
    await rest();
    await answerWindow(page, 'QUEST COMPLETE');
  });

  await test.step('day 2: the daily is active again, and a rest opens its window again', async () => {
    await passMinutePast(page, '2026-11-11T12:00:00-05:00');
    await dismissAll(page);
    await go(page, 'quests');
    await page.locator('#view-quests [data-tab="daily"]').tap();
    await expect(page.locator('#view-quests .qc', { hasText: 'Catch your breath' })).toHaveAttribute('data-st', 'active');
    await rest();
    await answerWindow(page, 'QUEST COMPLETE');
  });
});
