import type { Page } from '@playwright/test';
import { shareEach } from '../../src/core/gates/pay.ts';
import { RULES } from '../../src/core/rules.ts';
import { NO_PEN, afterDefence } from '../../src/core/combat/land.ts';
import { test, expect, onboardGM, go, startGoblinDenFight, answerWindow, openApp, fightRow, PHONE, SMALL_PHONE, LANDSCAPE, chooseList } from './helpers.ts';

const combat = (page: Page) => page.locator('#view-combat');
const currentRow = (page: Page) => combat(page).locator('.cmb-row.cur .cmb-nm');
const logLines = (page: Page) => combat(page).locator('[data-log] li');
const turnLine = (page: Page, name: string) => logLines(page).filter({ hasText: new RegExp(`^R\\d+: ${name}'s turn\\.$`) });
const currentName = (page: Page) => page.evaluate(() => { const f = hunterApp.store.get().fight; return f.rows.find((r: any) => r.id === f.currentId).name as string; });

async function tapCombat(page: Page, selector: string) {
  const target = combat(page).locator(selector).first();
  await target.evaluate((el: any) => el.scrollIntoView({ block: 'center' }));
  await target.tap();
}

/** Taps Next and waits for the turn to move to someone else. */
async function next(page: Page) {
  const before = await currentName(page);
  await tapCombat(page, '[data-next]');
  await expect.poll(() => currentName(page)).not.toBe(before);
}

async function confirmRemove(page: Page) {
  await page.locator('.sys-overlay.show .sys-actions button', { hasText: 'Remove' }).first().tap();
  await expect(page.locator('.sys-overlay.show')).toHaveCount(0);
}

async function chooseInWindow(page: Page, label: string) {
  const wanted = page.locator('.sys-overlay.show .sys-actions button', { hasText: label }).first();
  // only a window without the wanted button is tapped past: a window that opens between the two looks is not
  const other = page.locator('.sys-overlay.show', { hasNot: page.locator('.sys-actions button', { hasText: label }) }).locator('.sys-actions button.primary').first();
  await expect.poll(async () => {
    if (await wanted.isVisible()) return true;
    if (await other.isVisible()) await other.tap();
    return false;
  }, { message: `System window button "${label}"` }).toBe(true);
  await wanted.tap();
}

async function gmFight(page: Page) {
  await onboardGM(page);
  await chooseList(page);
  return startGoblinDenFight(page);
}

/** Every die rolls its lowest face: a reaction d20 of 1 is caught and a crit, so a use lands. */
const lowestDice = (page: Page) => page.evaluate(() => Object.defineProperty(crypto, 'getRandomValues', { configurable: true, value: (a: Uint32Array) => a.fill(0) }));
const fightNow = (page: Page) => page.evaluate(() => hunterApp.store.get().fight.now as number);

test('a fight with no map shows the order ahead, a Toward step brings Brakk next to a goblin and his Strike shows the goblin\'s new HP', async ({ device }) => {
  const page = (await device('gm')).page;
  await gmFight(page);
  const brakk = combat(page).locator('.cmb-card.turn', { hasText: 'Brakk Ironhide' });

  await test.step('the order ahead names Brakk and Mira after the goblin whose turn it is', async () => {
    await expect(combat(page).locator('[data-ahead]')).toContainText('Brakk Ironhide → Mira Vale');
    await next(page);
    await expect(currentRow(page)).toContainText('Brakk Ironhide');
  });

  await test.step('Brakk steps toward the nearest goblin, turn by turn, until his attack reaches it', async () => {
    for (let i = 0; i < 40; i++) {
      if ((await currentName(page)) !== 'Brakk Ironhide') { await next(page); continue; }
      // the save says it is Brakk's turn a frame before the screen does: until then the card is the last row's
      await expect(currentRow(page)).toContainText('Brakk Ironhide');
      const before = await fightRow(page, 'Brakk Ironhide');
      const toward = brakk.locator('[data-toward]');
      if (await toward.isDisabled()) break;
      const foe = brakk.locator('[data-target] option:checked'), was = await foe.innerText();
      await toward.evaluate((el: any) => el.scrollIntoView({ block: 'center' }));
      await toward.tap();
      await expect.poll(async () => JSON.stringify((await fightRow(page, 'Brakk Ironhide')).place)).not.toBe(JSON.stringify(before.place));
      // the card is drawn again after the save changes: its foe's distance is the new one, or the turn has moved on
      await expect.poll(async () => { const now = await foe.allInnerTexts(); return now.length === 0 || now[0] !== was; }).toBe(true);
    }
    await expect(currentRow(page)).toContainText('Brakk Ironhide');
    await expect(brakk.locator('[data-toward]')).toBeDisabled();
  });

  await test.step('his attack on the goblin beside him lowers its HP, and its row shows the HP the fight holds', async () => {
    await lowestDice(page);
    await brakk.locator('[data-ab]').first().tap();
    const picker = page.locator('.sys-overlay.show', { hasText: /Use .+ on…/ });
    await expect(picker).toBeVisible();
    const name = ((await picker.locator('.sys-actions button.primary').innerText()).split(' · ')[0] ?? '').trim();
    await picker.locator('.sys-actions button.primary').tap();
    await expect.poll(async () => { const g = await fightRow(page, name); return g.hp < g.sheet.hpMax; }).toBe(true);
    const goblin = await fightRow(page, name);
    await expect(combat(page).locator('.cmb-row', { has: page.locator(`[data-pick="${goblin.id}"]`) }).locator('.cmb-mini')).toContainText(`${goblin.hp}/${goblin.sheet.hpMax}`);
    await expect(page.locator('#toasts .toast', { hasText: `Brakk Ironhide uses` })).toContainText(name);
  });
});

test('a monster stunned on its turn loses it, and the turn goes to Brakk', async ({ device }) => {
  const page = (await device('gm')).page;
  await gmFight(page);
  const goblin = await currentName(page);
  await tapCombat(page, '.cmb-card.turn [data-cforge]');
  await page.locator('.fg-overlay [data-existing] [data-chip="stunned"]').tap();
  await expect(currentRow(page)).toContainText('Brakk Ironhide');
  await expect(logLines(page).filter({ hasText: `${goblin} cannot act and loses the turn.` })).toHaveCount(1);
  await expect(combat(page).locator('.cmb-row', { hasText: goblin }).locator('.cmb-cs')).toContainText('Stunned');
});

test('End shows the summary with each defeated goblin\'s XP and the total, and Award gives every hunter that total', async ({ device }) => {
  const page = (await device('gm')).page;
  const gate = await gmFight(page);
  const xp = () => page.evaluate(() => hunterApp.store.get().hunters.map((h: any) => h.xp + 100 * (h.level - 1) * h.level / 2) as number[]);
  const before = await xp();
  const monsters: { name: string; xp: number }[] = await page.evaluate(() => hunterApp.store.get().fight.rows.filter((r: any) => r.side === 'foe').map((r: any) => ({ name: r.name, xp: r.xp })));
  await page.evaluate(() => hunterApp.store.update((d: any) => { for (const r of d.fight.rows) if (r.side === 'foe') r.life = { at: 'dead' }; }, 'test-setup'));

  await tapCombat(page, '[data-end]');
  const win = page.locator('.sys-overlay.show', { hasText: 'Fight over' });
  await expect(win).toBeVisible();
  for (const m of monsters) await expect(win).toContainText(`${m.name}: ${m.xp.toLocaleString('en-US')} XP`);
  await expect(win).toContainText(`Total XP: ${gate.xp.toLocaleString('en-US')}`);
  // A fight from a gate shares the gate's XP among its hunters (`shareEach`, the rule `gateParty`).
  const each = shareEach(gate.xp, before.length, RULES.gateParty);
  await expect(win).toContainText(`Each hunter receives ${each.toLocaleString('en-US')} XP, a share of the gate's XP for ${before.length} hunter${before.length === 1 ? '' : 's'}.`);
  await chooseInWindow(page, 'Award XP to party');
  await expect.poll(async () => (await xp()).map((n, i) => n - before[i]!)).toEqual(before.map(() => each));
  await expect(combat(page).locator('.cmb-head')).toContainText('No fight');
});

test('the Fight over window says how many rounds the fight took once', async ({ device }) => {
  const page = (await device('gm')).page;
  await gmFight(page);
  await page.evaluate(() => hunterApp.store.update((d: any) => { for (const r of d.fight.rows) if (r.side === 'foe') r.life = { at: 'dead' }; }, 'test-setup'));
  await tapCombat(page, '[data-end]');
  const win = page.locator('.sys-overlay.show', { hasText: 'Fight over' });
  await expect(win).toContainText(/defeated in [\d.]+ rounds?\./);
  expect((await win.innerText()).match(/\bround/gi), 'the rounds are said once').toHaveLength(1);
});

test('a GM\'s −5 on a fighting hunter\'s own sheet takes 5 from the fight\'s card, and the HP stays after the next turn', async ({ device }) => {
  const page = (await device('gm')).page;
  await gmFight(page);
  const name = await page.evaluate(() => hunterApp.store.active().name as string);
  const before = await fightRow(page, name);
  expect(before.holder.kind).toBe('local');

  await test.step('the GM taps −5 on the hunter\'s sheet and the fight\'s card shows 5 less', async () => {
    await go(page, 'status');
    await page.locator('#view-status [data-hp="-5"]').first().tap();
    await expect.poll(async () => (await fightRow(page, name)).hp).toBe(before.hp - 5);
    await go(page, 'combat');
    await expect(combat(page).locator('.cmb-row', { hasText: name }).locator('.cmb-mini')).toContainText(`${before.hp - 5}/${before.sheet.hpMax}`);
  });

  await test.step('after the next turn the sheet and the card both still read 5 less', async () => {
    await next(page);
    expect((await fightRow(page, name)).hp).toBe(before.hp - 5);
    expect(await page.evaluate(() => hunterApp.api.hunter.sheet(hunterApp.store.active()).hp)).toBe(before.hp - 5);
  });
});

test('a goblin burning at strength C loses more HP over its turn than one burning at strength E', async ({ device }) => {
  const page = (await device('gm')).page;
  await gmFight(page);
  const round = await page.evaluate(() => hunterApp.rules().fight.round as number);
  // Burning burns 3d8 a round at C and 1d6 at E (src/core/registry/statuses.ts); every die on its lowest face makes 3 and
  // 1, so neither goblin falls before its turn. A per-round op pays its rate times the rounds since it went on, rounded
  // (design 1.3, effect-ops.ts `dueAmount`).
  const rate: Record<string, number> = { C: 3, E: 1 };
  const hot = await currentName(page);
  const mild: string = await page.evaluate(n => hunterApp.store.get().fight.rows.find((r: any) => r.side === 'foe' && r.name !== n).name, hot);
  const strength: Record<string, string> = { [hot]: 'C', [mild]: 'E' };
  const on: Record<string, { at: number; hp: number }> = {}, burnt: Record<string, { at: number; hp: number }> = {};
  // a gate's monsters may be Goblin and Goblin Shaman: a row is found by its id, not by a name another contains
  const rowOf = (id: string) => combat(page).locator('.cmb-row', { has: page.locator(`[data-pick="${id}"]`) });
  await lowestDice(page);
  const burn = async (name: string) => {
    await tapCombat(page, '.cmb-card.turn [data-cforge]');
    const dialog = page.locator('.fg-overlay');
    await dialog.locator(`[data-chips="strength"] [data-chip="${strength[name]}"]`).tap();
    await dialog.locator('[data-existing] [data-chip="burning"]').tap();
    await expect(dialog).toHaveCount(0);
    await expect(rowOf((await fightRow(page, name)).id).locator('.cmb-cs')).toContainText('Burning');
    on[name] = { at: await fightNow(page), hp: (await fightRow(page, name)).hp };
  };

  await test.step('the GM puts Burning at C on the goblin whose turn it is, and Burning at E on the other at its turn', async () => {
    await burn(hot);
    for (let i = 0; i < 40 && !(burnt[hot] && burnt[mild]); i++) {
      await next(page);
      const name = await currentName(page);
      if (name === mild && !on[mild]) await burn(mild);
      else if (on[name] && !burnt[name]) {
        await expect.poll(async () => (await fightRow(page, name)).hp).toBeLessThan(on[name]!.hp);
        burnt[name] = { at: await fightNow(page), hp: (await fightRow(page, name)).hp };
      }
    }
  });

  await test.step('at each goblin\'s next turn its HP has fallen by its Burning\'s rate over the time since', async () => {
    for (const name of [hot, mild]) {
      const row = await fightRow(page, name);
      const dealtRate = afterDefence(rate[strength[name]!]!, 'arcane', NO_PEN, row.sheet, RULES);
      const lost = Math.round(dealtRate * (burnt[name]!.at - on[name]!.at) / round);
      expect(on[name]!.hp - burnt[name]!.hp).toBe(lost);
      await expect(rowOf(row.id).locator('.cmb-mini')).toContainText(`${row.hp}/${row.sheet.hpMax}`);
    }
    expect(on[hot]!.hp - burnt[hot]!.hp).toBeGreaterThan(on[mild]!.hp - burnt[mild]!.hp);
  });
});

test('a caster rat\'s Curse tapped on its card hurts Brakk by what the damage rule gives', async ({ device }) => {
  const page = (await device('gm')).page;
  await onboardGM(page);
  await chooseList(page);
  await go(page, 'combat');
  await combat(page).locator('[data-hsel]').selectOption({ label: 'Brakk Ironhide' });
  await tapCombat(page, '[data-addh]');
  await combat(page).locator('[data-qline]').fill('Cave Rat, E, caster');
  await tapCombat(page, '[data-qadd]');
  await tapCombat(page, '[data-start]');
  await expect(combat(page).locator('.cmb-row.cur')).toHaveCount(1);
  await page.evaluate(() => hunterApp.store.update((d: any) => {
    const f = d.fight, rat = f.rows.find((r: any) => r.kind === 'monster'), brakk = f.rows.find((r: any) => r.kind === 'hunter');
    rat.place = { x: 2, y: 3 }; brakk.place = { x: 2, y: 2 };
    rat.at = f.now; rat.tie = 0; brakk.at = f.now + 1; brakk.tie = 0; f.currentId = rat.id; f.log = [];
  }, 'test-setup'));
  await expect(currentRow(page)).toContainText('Cave Rat');
  const rat = await fightRow(page, 'Cave Rat'), brakk = await fightRow(page, 'Brakk Ironhide');
  const F = await page.evaluate(() => hunterApp.rules().fight);
  // A caster's Curse is 1d8 + mag, arcane, direct (src/core/registry/abilities.ts). With every die on 1 the reaction d20
  // is 1: under the resist DC, so caught, and within the rat's crit faces, so a crit (design 3.1 rules 8b and 9). Rule
  // 11 multiplies by the crit size; rule 12 takes Brakk's Resist, less the rat's magic penetration (percent, then Unravel), off the hit.
  const raw = (1 + rat.sheet.mag) * rat.sheet.critSize;
  const left = Math.max(0, brakk.sheet.resist * (1 - rat.sheet.resistPen / 100) - rat.sheet.resistPenFlat);
  const dealt = Math.max(1, Math.round(Math.max(0, raw - F.armorFlat * left) * F.armorK / (F.armorK + left)));
  await lowestDice(page);

  await tapCombat(page, '.cmb-card.turn [data-ab]');
  await answerWindow(page, /Use .+ on…/, 'Brakk Ironhide');
  await expect.poll(async () => (await fightRow(page, 'Brakk Ironhide')).hp).toBe(brakk.hp - dealt);
  await expect(combat(page).locator('.cmb-row', { hasText: 'Brakk Ironhide' }).locator('.cmb-mini')).toContainText(`${brakk.hp - dealt}/${brakk.sheet.hpMax}`);
  expect(await page.evaluate(() => hunterApp.api.hunter.sheet(hunterApp.store.get().hunters.find((h: any) => h.name === 'Brakk Ironhide')).hp)).toBe(brakk.hp - dealt);
});

test('the loot of a monster defeated in a fight opens in the Award form when the GM taps Award loot', async ({ device }) => {
  const page = (await device('gm')).page;
  await onboardGM(page);
  await chooseList(page);
  const potion = { name: 'Health Potion', rar: 'common', type: 'consumable', qty: 2, slot: null, bonus: {}, effects: [{ op: 'heal', amount: { kind: 'number', value: 30 }, when: 'use' }], desc: 'Restores 30 HP.' };
  await page.evaluate(p => hunterApp.store.update((d: any) => {
    d.monsters.push({ id: 'm900', name: 'Hoard Rat', rank: 'E', type: '', archetype: 'brute', kind: 'normal', tweak: {}, abilities: [], notes: [], xp: 40, extractable: false, desc: '', statuses: [], loot: { gold: 75, items: [p] } });
  }, 'test-setup'), potion);
  await go(page, 'bestiary');
  await page.locator('#view-bestiary [data-addc="m900"]').tap();
  await go(page, 'combat');
  await combat(page).locator('[data-hsel]').selectOption({ label: 'Brakk Ironhide' });
  await tapCombat(page, '[data-addh]');
  await tapCombat(page, '.cmb-row:has-text("Hoard Rat") .cmb-pick');
  await tapCombat(page, '.cmb-card [data-defeat]');
  await expect.poll(async () => (await fightRow(page, 'Hoard Rat')).hp).toBe(0);

  await test.step('End lists the loot, and the Loot dropped window after it offers it to the Award form', async () => {
    await tapCombat(page, '[data-end]');
    const win = page.locator('.sys-overlay.show', { hasText: 'Fight over' });
    await expect(win).toContainText('Loot: 75 gold, Health Potion ×2');
    await chooseInWindow(page, 'End without XP');
    await answerWindow(page, 'Loot dropped', 'Award loot');
  });

  await test.step('the Award form holds the 75 gold and the two potions', async () => {
    await expect(page.locator('#gm-gold')).toHaveValue('75');
    await expect(page.locator('#view-gm .rw-nm', { hasText: 'Health Potion' })).toBeVisible();
  });
});

test('the loot of a fight the GM has not given yet is offered again after a reload, and Set aside ends the offer', async ({ device }) => {
  const page = (await device('gm')).page;
  await onboardGM(page);
  await chooseList(page);
  await page.evaluate(() => hunterApp.store.update((d: any) => {
    d.monsters.push({ id: 'm900', name: 'Hoard Rat', rank: 'E', type: '', archetype: 'brute', kind: 'normal', tweak: {}, abilities: [], notes: [], xp: 40, extractable: false, desc: '', statuses: [], loot: { gold: 75, items: [] } });
  }, 'test-setup'));
  await go(page, 'bestiary');
  await page.locator('#view-bestiary [data-addc="m900"]').tap();
  await go(page, 'combat');
  await combat(page).locator('[data-hsel]').selectOption({ label: 'Brakk Ironhide' });
  await tapCombat(page, '[data-addh]');
  await tapCombat(page, '.cmb-row:has-text("Hoard Rat") .cmb-pick');
  await tapCombat(page, '.cmb-card [data-defeat]');
  await expect.poll(async () => (await fightRow(page, 'Hoard Rat')).hp).toBe(0);
  await tapCombat(page, '[data-end]');
  await chooseInWindow(page, 'End without XP');
  await answerWindow(page, 'Loot dropped', 'Later');
  expect(await page.evaluate(() => hunterApp.store.get().loot.drops.map((d: any) => d.gold))).toEqual([75]);

  await test.step('after a reload the Loot dropped window offers the 75 gold again', async () => {
    await page.reload();
    await expect(page.locator('.sys-overlay.show', { hasText: 'Loot dropped' })).toContainText('75 gold');
    await answerWindow(page, 'Loot dropped', 'Set aside');
    await expect.poll(() => page.evaluate(() => hunterApp.store.get().loot)).toEqual({ at: 'none' });
  });
});

test('a goblin\'s corpse that crumbled on a natural 1 stays crumbled after the GM\'s page reloads: its card offers no Extract', async ({ device }) => {
  const page = (await device('gm')).page;
  const gate = await gmFight(page);
  const goblin = await currentName(page), id: string = (await fightRow(page, goblin)).id;
  const card = combat(page).locator(`.cmb-card[data-cid="${id}"]`);

  await test.step('the gate the fight started from is marked as fought, in the same write as the fight', async () => {
    expect(await page.evaluate(g => hunterApp.store.get().gates.find((x: any) => x.id === g).status, gate.id)).toBe('raiding');
  });

  await test.step('the GM marks the goblin defeated and the Necromancer\'s extraction rolls a natural 1', async () => {
    await page.evaluate(() => hunterApp.store.update((d: any) => { d.hunters.find((h: any) => h.id === d.settings.activeHunterId).job = 'Necromancer'; }, 'test-setup'));
    await tapCombat(page, '.cmb-card.turn [data-defeat]');
    await tapCombat(page, `[data-pick="${id}"]`);
    // the extraction is a check rolled on the dice tray, which draws from Math.random (src/edge/roll.ts `trayRandom`)
    await page.evaluate(() => { Math.random = () => 0; });
    await card.locator('[data-extract]').tap();
    await answerWindow(page, 'Shadow Extraction', 'Extract');
    await expect(page.locator('.sys-overlay.show', { hasText: 'corpse is destroyed' })).toBeVisible();
    await answerWindow(page, 'Extraction failed');
    await expect(card.locator('[data-extract]')).toHaveCount(0);
  });

  await test.step('after a reload the corpse is still spent', async () => {
    await page.reload();
    await go(page, 'combat');
    await tapCombat(page, `[data-pick="${id}"]`);
    await expect(card).toBeVisible();
    await expect(card.locator('[data-extract]')).toHaveCount(0);
    expect((await fightRow(page, goblin)).extraction).toEqual({ at: 'gone', why: 'crumbled' });
  });
});

test('a goblin that rises on a natural 20 joins the Necromancer\'s army as the corpse is spent, and the name typed in ARISE renames it', async ({ device }) => {
  const page = (await device('gm')).page;
  await gmFight(page);
  const goblin = await currentName(page), id: string = (await fightRow(page, goblin)).id;
  const army = () => page.evaluate(() => hunterApp.store.active().shadows.map((s: any) => s.name) as string[]);
  await page.evaluate(() => hunterApp.store.update((d: any) => { d.hunters.find((h: any) => h.id === d.settings.activeHunterId).job = 'Necromancer'; }, 'test-setup'));
  await tapCombat(page, '.cmb-card.turn [data-defeat]');
  await tapCombat(page, `[data-pick="${id}"]`);
  await page.evaluate(() => { Math.random = () => 0.99; });
  await combat(page).locator(`.cmb-card[data-cid="${id}"] [data-extract]`).tap();
  await answerWindow(page, 'Shadow Extraction', 'Extract');
  const arise = page.locator('.sys-overlay.show', { hasText: 'ARISE' });
  await expect(arise).toBeVisible();
  expect(await army(), 'the shadow is in the army while ARISE asks its name').toEqual([goblin]);
  expect((await fightRow(page, goblin)).extraction).toEqual({ at: 'gone', why: 'risen' });
  await arise.locator('input').fill('Igris');
  await answerWindow(page, 'ARISE', 'Arise');
  await expect.poll(army).toEqual(['Igris']);
});

test('on a wide screen Add to the fight folds away when the fight starts, and once the GM opens it by hand it stays open turn after turn', async ({ device }) => {
  const page = (await device('gm', { viewport: { width: 1280, height: 800 } })).page;
  await gmFight(page);
  const build = combat(page).locator('[data-build]');
  await expect(build).not.toHaveAttribute('open', '');
  await build.locator('summary').tap();
  await expect(build).toHaveAttribute('open', '');
  await next(page);
  await next(page);
  await expect(build).toHaveAttribute('open', '');
});

test('removing the combatant whose turn it is starts the next combatant\'s turn', async ({ device }) => {
  const page = (await device('gm')).page;
  await gmFight(page);
  await next(page);
  await expect(currentRow(page)).toContainText('Brakk Ironhide');

  await tapCombat(page, '.cmb-card.turn [data-remove]');
  await confirmRemove(page);

  await expect(currentRow(page)).toContainText('Mira Vale');
  await expect(turnLine(page, 'Mira Vale')).toHaveCount(1);
});

test('a removed defeated monster keeps its XP and a removed live one gives none', async ({ device }) => {
  const page = (await device('gm')).page;
  const gate = await gmFight(page);
  const monsters: { id: string; xp: number }[] = await page.evaluate(() => hunterApp.store.get().fight.rows.filter((r: any) => r.side === 'foe').map((r: any) => ({ id: r.id, xp: r.xp })));
  const dead = monsters[1]!, live = (monsters[2] ?? monsters[0])!;

  await tapCombat(page, `[data-pick="${dead.id}"]`);
  await tapCombat(page, '[data-defeat]');
  await expect(combat(page).locator(`[data-pick="${dead.id}"] .cmb-dn`)).toHaveText('Defeated');
  await tapCombat(page, '[data-remove]');
  await confirmRemove(page);
  await tapCombat(page, `[data-pick="${live.id}"]`);
  await tapCombat(page, '[data-remove]');
  await confirmRemove(page);

  await tapCombat(page, '[data-end]');
  await expect(page.locator('.sys-overlay.show .sys-window').first()).toContainText(`Total XP: ${dead.xp.toLocaleString('en-US')}`);
  await chooseInWindow(page, 'Award XP to party');
  await chooseInWindow(page, 'Mark gate cleared');

  const panel = page.locator(`#view-gates .gate[data-id="${gate.id}"] .gt-panel[data-form=clear]`);
  const promise = panel.locator('[data-clearxp]').first();
  await expect(promise).toBeVisible();
  // The XP still due is shared among the hunters ticked in the panel.
  const ticked = await panel.locator('input[type=checkbox]:checked').count();
  expect(ticked).toBeGreaterThan(0);
  await expect.poll(async () => Number(((await promise.innerText()).match(/\d[\d,]*/) ?? ['NaN'])[0].replace(/,/g, ''))).toBe(shareEach(gate.xp - dead.xp, ticked, RULES.gateParty));
});

for (const [size, viewport] of Object.entries({ phone: PHONE, 'small phone': SMALL_PHONE, 'landscape phone': LANDSCAPE })) {
  test(`on a ${size} the Status window opens at its top: title, Rounds and the first existing statuses in view`, async ({ device }) => {
    const page = (await device('gm', { viewport })).page;
    await gmFight(page);
    await tapCombat(page, '.cmb-row:has-text("Brakk Ironhide") .cmb-pick');
    await page.clock.install();
    await tapCombat(page, '.cmb-card [data-cforge]');
    const dialog = page.locator('.fg-overlay [role=dialog]');
    await expect(dialog.getByRole('heading', { name: 'Status for Brakk Ironhide' })).toBeInViewport({ ratio: 1 });
    await expect(dialog.getByLabel('Rounds', { exact: true })).toBeInViewport({ ratio: 1 });
    await expect(dialog.locator('[data-existing] button').first()).toBeInViewport({ ratio: 1 });
    await page.clock.runFor(2000);
    await expect(dialog.getByRole('heading', { name: 'Status for Brakk Ironhide' })).toBeInViewport({ ratio: 1 });
    await expect(dialog.getByLabel('Rounds', { exact: true })).toBeInViewport({ ratio: 1 });
  });
}

test('in a short window used with a mouse, the Workshop\'s New status opens at its top: title and Name in view', async ({ device }) => {
  const page = (await device('laptop', { viewport: LANDSCAPE, mouse: true })).page;
  await openApp(page);
  for (const step of ['[data-yes]', '[data-gm]', '[data-starter]', '[data-oblater]']) {
    const b = page.locator(`.ob-overlay ${step}`).first();
    if (await b.isVisible()) await b.click();
  }
  const windowButton = page.locator('.sys-overlay.show .primary');
  while (await windowButton.isVisible()) await windowButton.click();
  await go(page, 'workshop');
  await page.clock.install();
  await page.locator('#view-workshop [data-ws="status"] [data-new]').click();
  const dialog = page.locator('.fg-overlay [role=dialog]');
  await expect(dialog.getByRole('heading', { name: 'New status' })).toBeVisible();
  await page.clock.runFor(2000);
  await expect(dialog.getByRole('heading', { name: 'New status' })).toBeInViewport({ ratio: 1 });
  await expect(dialog.getByLabel('Name', { exact: true })).toBeInViewport({ ratio: 1 });
});

test('a GM renames Poisoned in the Workshop and a Poisoned put on in a fight shows the new name, then after a reset Poisoned again', async ({ device }) => {
  const page = (await device('gm')).page;
  await gmFight(page);
  const poisonedRow = () => page.locator('#view-workshop [data-ws="status"] li[data-id="poisoned"]');
  const poisonOn = async (hunter: string) => {
    await go(page, 'combat');
    await tapCombat(page, `.cmb-row:has-text("${hunter}") .cmb-pick`);
    await tapCombat(page, '.cmb-card [data-cforge]');
    await page.locator('.fg-overlay [data-existing] [data-chip="poisoned"]').tap();
    return combat(page).locator('.cmb-card', { hasText: hunter }).locator('.cmb-conds');
  };

  await test.step('the GM edits Poisoned, names it Venom and saves', async () => {
    await go(page, 'workshop');
    await page.locator('#view-workshop [data-ws="status"] .ws-built summary').tap();
    await poisonedRow().locator('[data-act="edit"]').tap();
    const dialog = page.locator('.fg-overlay [role=dialog]');
    await expect(dialog.getByRole('heading', { name: 'Edit Poisoned' })).toBeVisible();
    await dialog.locator('[data-name]').fill('Venom');
    await dialog.locator('[data-apply]').tap();
    await expect(dialog).toHaveCount(0);
  });

  await test.step('Poisoned put on Brakk\'s combat card shows as Venom', async () => {
    const conds = await poisonOn('Brakk Ironhide');
    await expect(conds).toContainText('Venom');
    await expect(conds).not.toContainText('Poisoned');
  });

  await test.step('after Reset, Poisoned put on Mira shows as Poisoned', async () => {
    await go(page, 'workshop');
    await poisonedRow().getByRole('button', { name: 'More for Venom' }).tap();
    await page.locator('.sys-overlay.show', { hasText: 'Venom' }).locator('.sys-actions button', { hasText: 'Reset' }).tap();
    await answerWindow(page, 'Reset Venom?', 'Reset');
    await expect(poisonedRow()).toContainText('Poisoned');
    await expect(await poisonOn('Mira Vale')).toContainText('Poisoned');
  });
});
