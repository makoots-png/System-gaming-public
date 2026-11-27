// One whole session at a table, a GM phone and two player phones in one room, played stage by stage: a fight in which a
// hunter dies and is raised, the fight's end paying out and releasing the room's hunters (Start fight checks live room
// players by default via defaultParty, so Kai and Mira are held by the GM's fight until it ends), a rest, the GM's
// fudge on a roll, a trade, and the party stash. Each stage is a named step, so a red run says which stage broke. Every
// stage has its own test file that goes deeper; this one proves they work in one room, one after the other, on what
// each phone shows.
import type { Page } from '@playwright/test';
import { RULES } from '../../src/core/rules.ts';
import { STASH_WORDS } from '../../src/core/trade/stash.ts';
import { restRefusalWords } from '../../src/core/hunter/rests.ts';
import { test, expect, setupGoblinDenGM, onboardPlayer, createRoom, dismissAll, go, chooseList, save, startGoblinDenFight, adhoc } from './helpers.ts';

const KAI = 'Kai Test', MIRA = 'Mira Test', FALLEN = 'Brakk Ironhide', POTION = 'Healing Potion';

const combat = (page: Page) => page.locator('#view-combat');
const gmRow = (gm: Page, name: string) => combat(gm).locator('.cmb-row', { hasText: name });
const gmCard = (gm: Page) => combat(gm).locator('.cmb-card');
const hudRow = (player: Page, name: string) => combat(player).locator('.tb-row', { hasText: name });
const sheet = (page: Page, bar: 'hp' | 'mana') => page.locator(`#view-status [data-bar="${bar}"]`);
const num = async (page: Page, bar: 'hp' | 'mana'): Promise<{ cur: number; max: number }> => ({
  cur: Number(await sheet(page, bar).locator('[data-cur]').innerText()), max: Number(await sheet(page, bar).locator('[data-maxtxt]').innerText()),
});
const shareOf = (max: number, share: number): number => Math.ceil(max * share);

async function tapCombat(page: Page, selector: string) {
  const target = combat(page).locator(selector).first();
  await target.evaluate((el: any) => el.scrollIntoView({ block: 'center' }));
  await target.tap();
}
async function gmSelect(gm: Page, name: string) {
  const pick = gmRow(gm, name).first().locator('[data-pick]');
  await pick.evaluate((el: any) => el.scrollIntoView({ block: 'center' }));
  await pick.tap();
  await expect(gmCard(gm).locator('h3')).toContainText(name);
}

/** The Bag on the Status view, on tab `tab`. */
async function bag(page: Page, tab: 'Items' | 'Offers' | 'Stash') {
  await go(page, 'status');
  const panel = page.locator('[data-panel="inventory"]');
  await panel.locator('[role=tab]', { hasText: tab }).tap();
  return panel;
}
const potions = (page: Page) => page.locator('[data-panel="inventory"] .inv-card', { hasText: POTION });

/** The face a drawn `f` shows under a weight of `w`: moved by `w`, kept on the d20 (the tray draws 1 + floor(r x 20)). */
const weighed = (f: number, w: number): number => Math.min(20, Math.max(1, f + w));

/** Rolls the STR quick check while the die draws `face`, and answers what the tray shows once the roll has landed. */
async function strCheck(player: Page, face: number): Promise<{ sum: string; total: string; faces: string }> {
  const view = player.locator('#view-dice [data-roller]');
  await view.locator('[data-m=""]').tap();
  const n = (await save(player)).rolls.length;
  await player.evaluate(r => { (window as any).__r = Math.random; Math.random = () => r; }, (face - 0.5) / 20);
  try { await view.locator('[data-checks] [data-st="str"]').dispatchEvent('click'); } finally { await player.evaluate(() => { Math.random = (window as any).__r; }); }
  await expect.poll(() => save(player).then(s => s.rolls.length)).toBe(n + 1);
  const id = (await save(player)).rolls[0].id as string;
  await expect(view.locator(`[data-total][data-rid="${id}"]`)).toHaveCount(1);
  await expect(view.locator('[data-sum]')).toBeVisible();
  return { sum: (await view.locator('[data-sum]').innerText()).trim(), total: (await view.locator('[data-total]').innerText()).trim(), faces: ((await view.locator('.dx-faces').innerText()) ?? '').replace(/[[\]!\s]/g, '') };
}

test('a whole session: a death and a raising in a fight, a rest, a fudged roll, a trade, the stash, and the fight\'s end pays', async ({ device }) => {
  const gm = (await device('gm')).page, kai = (await device('kai')).page, mira = (await device('mira')).page;
  let code = '';

  await test.step('setup: the GM opens a room and Kai and Mira join it', async () => {
    await setupGoblinDenGM(gm);
    await chooseList(gm);
    code = await createRoom(gm);
    await onboardPlayer(kai, KAI, code);
    await onboardPlayer(mira, MIRA, code);
    for (const p of [kai, mira]) {
      await expect.poll(() => p.evaluate(() => hunterApp.api.sync.room())).toBe(code);
      await dismissAll(p, 4);
    }
    await chooseList(kai, mira);
    for (const who of [KAI, MIRA]) await expect(gm.locator('#gm-board .gm-card.remote', { hasText: who })).toHaveCount(1);
  });

  await test.step('stage 1, the fight: Brakk goes to 0 HP and is Dead on every phone, and the GM raises him with every status gone', async () => {
    await startGoblinDenFight(gm);
    await gmSelect(gm, FALLEN);
    await tapCombat(gm, '.cmb-card [data-cforge]');
    const dialog = gm.locator('.fg-overlay');
    await dialog.locator('[data-inf]').tap();
    await dialog.locator('[data-existing] [data-chip="poisoned"]').tap();
    await expect(dialog).toHaveCount(0);
    await expect(gmCard(gm).locator('.cmb-conds')).toContainText('Poisoned');
    const [, max] = ((await gmCard(gm).locator('.bar-nums').first().innerText()).match(/(\d+)\s*\/\s*(\d+)/) ?? []).slice(1).map(Number) as [number, number];
    expect(max, 'the card reads Brakk\'s maximum HP').toBeGreaterThan(0);
    for (const p of [kai, mira]) {
      await go(p, 'combat');
      await expect(hudRow(p, FALLEN)).toHaveCount(1);
      await expect(hudRow(p, FALLEN).locator('.tb-conds')).toContainText('Poisoned');
    }

    await gmCard(gm).locator('[data-amt]').fill(String(max));
    await tapCombat(gm, '[data-dmg]');
    await expect(gmRow(gm, FALLEN).locator('.cmb-mini')).toContainText(`0/${max}`);
    await expect(gmCard(gm).locator('[data-revive]')).toBeVisible();
    for (const p of [kai, mira]) {
      await expect(hudRow(p, FALLEN)).toHaveClass(/\bdead\b/);
      await expect(hudRow(p, FALLEN).locator('.lw')).toHaveText('Dead');
    }

    await tapCombat(gm, '[data-revive]');
    await expect(gmRow(gm, FALLEN).locator('.cmb-mini')).toContainText(`1/${max}`);
    await expect(gmCard(gm).locator('.cmb-conds')).not.toContainText('Poisoned');
    for (const p of [kai, mira]) {
      await expect(hudRow(p, FALLEN)).not.toHaveClass(/\bdead\b/);
      await expect(hudRow(p, FALLEN).locator('.tb-conds')).toHaveCount(0);
    }
  });

  await test.step('stage 2, the fight\'s end: the monsters fall, the GM ends the fight, and the XP it names is paid to the hunters in it', async () => {
    await go(gm, 'status');
    const [xpBefore, xpNeed] = ((await gm.locator('#view-status [data-xpnums]').innerText()).match(/^(\d+) \/ (\d+)$/) ?? []).slice(1).map(Number) as [number, number];
    await go(gm, 'combat');
    const monsters = await gm.evaluate(() => hunterApp.store.get().fight.rows.filter((r: any) => r.kind !== 'hunter').map((r: any) => r.id as string));
    expect(monsters.length, 'the den has monsters').toBeGreaterThan(0);
    for (const id of monsters) {
      const row = combat(gm).locator(`.cmb-row[data-key="${id}"]`);
      await row.locator('[data-pick]').evaluate((el: any) => el.scrollIntoView({ block: 'center' }));
      await row.locator('[data-pick]').tap();
      await tapCombat(gm, '[data-defeat]');
      await expect(row).toHaveClass(/\bdead\b/);
    }
    const progress = (p: Page) => p.evaluate(() => { const h = hunterApp.store.active(); return `${h.level}:${h.xp}`; });
    const before = new Map<Page, string>();
    for (const p of [kai, mira]) before.set(p, await progress(p));
    await tapCombat(gm, '[data-end]');
    const win = gm.locator('.sys-overlay.show', { hasText: 'Fight over' });
    await expect(win).toBeVisible();
    const each = Number(((await win.innerText()).match(/Each hunter receives (\d+) XP/) ?? [])[1]);
    expect(each, 'the window names the XP each hunter gets').toBeGreaterThan(0);
    await win.locator('.sys-actions button', { hasText: 'Award XP to party' }).tap();
    await expect(win).toHaveCount(0);
    await dismissAll(gm, 4);
    await expect(combat(gm).locator('.cmb-head').first()).toContainText('No fight');
    await go(gm, 'status');
    let wantXp = xpBefore + each, wantNeed = xpNeed;
    while (wantXp >= wantNeed) { wantXp -= wantNeed; wantNeed += RULES.xpPerLevel; }
    await expect(gm.locator('#view-status [data-xpnums]')).toHaveText(`${wantXp} / ${wantNeed}`);
    for (const p of [kai, mira]) {
      // The award lands on each player's phone at its next poll, with its System windows: wait for it, then close them.
      await expect.poll(() => progress(p), { timeout: 20_000 }).not.toBe(before.get(p));
      await dismissAll(p, 8);
      await expect(p.locator('.sys-overlay.show')).toHaveCount(0);
      await go(p, 'combat');
      await expect(combat(p).locator('[data-idle]')).toHaveText('The GM is not running a fight.');
      await expect(combat(p).locator('.tb-row')).toHaveCount(0);
      await dismissAll(p, 4);
    }
  });

  await test.step('stage 3, a rest: Mira, hurt, gets a quarter of her health and mana back, and a third rest in the gate is refused', async () => {
    await dismissAll(mira, 4);
    await go(mira, 'status');
    for (let i = 0; i < 2; i++) {
      await mira.locator('#view-status [data-hp="-5"]').first().tap();
      await mira.locator('#view-status [data-mana="-5"]').first().tap();
    }
    const hp = await num(mira, 'hp'), mana = await num(mira, 'mana');
    expect(hp.cur, 'hurt').toBeLessThan(hp.max);
    expect(mana.cur, 'spent').toBeLessThan(mana.max);
    const left = mira.locator('#view-status [data-rests-left]'), n = RULES.rest.perGate;
    await expect(left).toHaveText(`Rests left this gate: ${n} of ${n}.`);

    await mira.locator('#view-status [data-rest]').tap();
    await expect(sheet(mira, 'hp').locator('[data-cur]')).toHaveText(String(Math.min(hp.max, hp.cur + shareOf(hp.max, RULES.rest.hp))));
    await expect(sheet(mira, 'mana').locator('[data-cur]')).toHaveText(String(Math.min(mana.max, mana.cur + shareOf(mana.max, RULES.rest.mana))));
    await expect(left).toHaveText(`Rests left this gate: ${n - 1} of ${n}.`);

    for (let i = 1; i < n; i++) await mira.locator('#view-status [data-rest]').tap();
    await expect(left).toHaveText(`Rests left this gate: 0 of ${n}.`);
    await mira.locator('#view-status [data-rest]').tap();
    await expect(mira.locator('#toasts .toast', { hasText: restRefusalWords(RULES).spent }).first()).toBeVisible();
    await expect(left).toHaveText(`Rests left this gate: 0 of ${n}.`);
  });

  await test.step('stage 4, the GM\'s fudge: a table weight of +2 moves Kai\'s die, and a forced 20 is the next roll, on his tray', async () => {
    await dismissAll(kai, 4);
    const key = await kai.evaluate(() => hunterApp.api.sync.myKey(hunterApp.store.active().id) as string);
    const bonus = await kai.evaluate(() => hunterApp.api.hunter.sheet(hunterApp.store.active()).checks.bonus.str as number);
    await go(gm, 'gm');
    const box = gm.locator('#gm-weight');
    for (const shown of ['+1', '+2']) {
      await box.locator('[data-weigh-scope="hunters"][aria-label^="Raise"]').tap();
      await expect(box.locator('b')).toHaveText(shown);
    }
    await expect.poll(() => kai.evaluate(() => { const w = hunterApp.store.get().settings.sync.weights; return w ? w.hunters[hunterApp.store.active().id] ?? null : null; })).toEqual({ total: 2, force: null });
    await go(kai, 'dice');
    const heavy = await strCheck(kai, 5), face = weighed(5, 2);
    expect(heavy).toEqual({ sum: `${face} + ${bonus} = ${face + bonus}`, total: String(face + bonus), faces: String(face) });

    const forceBtn = gm.locator(`[data-weigh-force="${key}"][data-face="20"]`);
    await forceBtn.tap();
    await expect(gm.locator('#gm-board .gm-card.remote', { hasText: KAI }).locator('[data-weightline]')).toContainText('Next d20 forced to 20');
    await expect.poll(() => kai.evaluate(() => { const w = hunterApp.store.get().settings.sync.weights; return w ? w.hunters[hunterApp.store.active().id]?.force ?? null : null; })).toBe(20);
    const forced = await strCheck(kai, 5);
    expect(forced).toEqual({ sum: `20 + ${bonus} = ${20 + bonus}`, total: String(20 + bonus), faces: '20' });
    await expect(gm.locator('#gm-board .gm-card.remote', { hasText: KAI }).locator('[data-weightline]')).not.toContainText('Next d20 forced');
  });

  await test.step('stage 5, a trade: Mira offers Kai a potion and Kai accepts it', async () => {
    await mira.evaluate(g => hunterApp.api.inventory.addItem(hunterApp.store.active().id, g), adhoc({ name: POTION, rar: 'common', type: 'consumable' }, 2));
    await expect.poll(() => kai.evaluate(() => hunterApp.api.sync.faces().map((f: any) => f.name)), { timeout: 20_000 }).toContain(MIRA);
    const panel = await bag(mira, 'Items');
    await expect(potions(mira).locator('.inv-qty')).toHaveText('×2');
    await panel.getByRole('button', { name: `Give ${POTION}` }).tap();
    const win = mira.locator('.sys-overlay.show', { hasText: `Give ${POTION}` });
    await expect(win).toBeVisible();
    await win.locator('[data-tr-to]', { hasText: KAI }).tap();
    await win.getByRole('button', { name: `Offer to ${KAI}` }).tap();
    await expect(win).toHaveCount(0);
    await expect(potions(mira)).toHaveCount(1);
    await expect(potions(mira).locator('.inv-qty')).toHaveCount(0);
    await expect((await bag(mira, 'Offers')).locator('[data-tr-list="yours"] .tr-offer .tr-state')).toHaveText(`Waiting for ${KAI}.`, { timeout: 20_000 });

    await go(kai, 'status');
    await expect(kai.locator('[data-panel="inventory"] [data-tab="offers"]')).toHaveText('Offers (1)', { timeout: 20_000 });
    const line = (await bag(kai, 'Offers')).locator('[data-tr-list="to"] .tr-offer', { hasText: `${MIRA} offers` });
    await expect(line).toContainText(`${MIRA} offers 1 ${POTION}.`);
    await line.getByRole('button', { name: 'Accept' }).tap();
    await bag(kai, 'Items');
    await expect(potions(kai)).toHaveCount(1, { timeout: 20_000 });
    await expect(mira.locator('[data-panel="inventory"] [data-tab="offers"]')).toHaveText('Offers', { timeout: 20_000 });
  });

  await test.step('stage 6, the party stash: Kai puts the potion in and Mira takes it out', async () => {
    const panel = await bag(kai, 'Items');
    await panel.getByRole('button', { name: `Give ${POTION}` }).tap();
    const win = kai.locator('.sys-overlay.show', { hasText: `Give ${POTION}` });
    await expect(win).toBeVisible();
    await win.locator('[data-tr-to]', { hasText: 'Party stash' }).tap();
    await win.getByRole('button', { name: 'Put in the stash' }).tap();
    await expect(win).toHaveCount(0);
    await expect(kai.locator('#toasts .toast', { hasText: new RegExp(`In the stash: .*${POTION}`) })).toBeVisible({ timeout: 20_000 });
    await expect(potions(kai)).toHaveCount(0);

    await go(gm, 'gm');
    const toggle = gm.locator('[data-tog="trade"]');
    if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.tap();
    await expect(gm.locator('#gm-trade [data-tr-list="gm-stash"] .tr-offer')).toHaveCount(1);
    await expect(gm.locator('#gm-hsum-trade')).toContainText(STASH_WORDS.summary(1));

    const stashLine = (await bag(mira, 'Stash')).locator('[data-tr-list="stash"] .tr-line', { hasText: POTION });
    await expect(stashLine).toBeVisible({ timeout: 20_000 });
    await stashLine.getByRole('button', { name: `Take: ${POTION}` }).tap();
    await expect(mira.locator('#toasts .toast', { hasText: `From the stash: 1 ${POTION}.` })).toBeVisible({ timeout: 20_000 });
    await bag(mira, 'Items');
    // a player's own item stacks with its exact copy (inventory.ts `stackOf`): the one taken joins the one kept
    await expect(potions(mira).locator('.inv-qty')).toHaveText('×2');
    await expect((await bag(mira, 'Stash')).locator('[data-tr-list="stash"] .empty')).toHaveText('The stash is empty.', { timeout: 20_000 });
    await expect(gm.locator('#gm-trade [data-tr-list="gm-stash"]')).toHaveText('The stash is empty.', { timeout: 20_000 });
  });
});
