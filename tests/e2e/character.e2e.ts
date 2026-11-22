import type { Page } from '@playwright/test';
import { RULES } from '../../src/core/rules.ts';
import { deathLine, naturalLines, pointsLine, soloLines, statBonusLine } from '../../src/core/rules-text.ts';
import { test, expect, onboardGM, onboardPlayer, createRoom, dismissAll, go, activeHunter, openApp, tapIfShown, switchToPlayerMode, answerWindow, startGoblinDenFight, chooseList } from './helpers.ts';

const lifeWord = (p: Page) => p.locator('#view-status [data-death] [data-life]');

async function hpTo0(p: Page): Promise<void> {
  for (let i = 0; i < 40 && (await activeHunter(p)).hp > 0; i++) await p.locator('#view-status [data-hp="-5"]').first().tap();
  await expect.poll(async () => (await activeHunter(p)).hp).toBe(0);
}

async function confirmDanger(p: Page): Promise<void> {
  const button = p.locator('.sys-overlay.show button.danger, [aria-modal="true"] button.danger');
  await button.first().tap();
  await expect(button).toHaveCount(0);
}

async function openSection(p: Page, id: string): Promise<void> {
  const t = p.locator(`[data-tog="${id}"]`);
  if ((await t.getAttribute('aria-expanded')) !== 'true') await t.tap();
  await expect(t).toHaveAttribute('aria-expanded', 'true');
}

async function addToCombat(p: Page, key: string): Promise<void> {
  await chooseList(p);
  await p.locator('#view-combat [data-hsel]').selectOption(key);
  await p.locator('#view-combat [data-addh]').tap();
  await dismissAll(p, 3);
}

async function addCondition(p: Page, key: string): Promise<void> {
  await go(p, 'status');
  await p.locator('#view-status [data-cond-sel]').selectOption(key);
  await p.locator('#view-status [data-cond-add]').tap();
  await expect(p.locator(`#view-status [data-chips] [data-chip="${key}"]`)).toHaveCount(1);
}

async function strCheck(p: Page): Promise<number> {
  await go(p, 'status');
  return +(await p.locator('#view-status [data-cb-k="str"] b').innerText()).replace('−', '-');
}

/** Accuracy and Will on the Derived panel, and the CTL and DIS checks, as the sheet shows them. */
async function sheetCells(p: Page): Promise<Record<'aim' | 'will' | 'ctl' | 'dis', string>> {
  await go(p, 'status');
  const text = (sel: string) => p.locator(`#view-status ${sel} b`).innerText();
  return { aim: await text('[data-dv-k="aim"]'), will: await text('[data-dv-k="will"]'), ctl: await text('[data-cb-k="ctl"]'), dis: await text('[data-cb-k="dis"]') };
}

/** A running fight with the active hunter, another of the GM's hunters (a fight needs someone up on each side) and a rat. */
async function combatReady(p: Page): Promise<void> {
  const [hid, other] = await p.evaluate(() => { const s = hunterApp.store.get(), a = hunterApp.store.active().id; return [a, s.hunters.find((h: any) => h.id !== a).id]; });
  await go(p, 'combat');
  await addToCombat(p, hid!);
  await addToCombat(p, other!);
  await p.locator('#view-combat [data-qline]').fill('Cave Rat, E, brute');
  await p.locator('#view-combat [data-qadd]').tap();
  await p.locator('#view-combat [data-start]').tap();
  await expect(p.locator('#view-combat [data-next]')).toBeVisible();
  await dismissAll(p, 3);
}

async function awardXp(p: Page, xp: number): Promise<void> {
  await go(p, 'gm');
  await openSection(p, 'award');
  const hid = await p.evaluate(() => hunterApp.store.active().id);
  const box = p.locator(`input[data-sel="${hid}"]`);
  if (!(await box.isChecked())) await box.tap();
  await p.locator('#gm-xp').fill(String(xp));
  await p.locator('#gm-award-go').tap();
  await p.waitForTimeout(300);
  await dismissAll(p, 6);
}

async function sheetNumbers(p: Page) {
  await go(p, 'status');
  const text = (s: string) => p.locator(s).first().innerText();
  const bar = async (k: string) => {
    const [cur, max] = (await text(`#view-status [data-bar="${k}"] .bar-nums`)).replace(/[,\s]/g, '').split('/').map(Number);
    return { cur: cur!, max: max! };
  };
  return { lv: +(await text('#view-status [data-lv]')), ap: +(await text('#view-status [data-ap]')), hp: await bar('hp'), mana: await bar('mana') };
}

test('At 0 HP the hunter is dead: the chip says the same word as the death panel, has no remove button, and a heal does not raise it', async ({ device }) => {
  const p = (await device('player-chip')).page;
  await onboardGM(p);
  await switchToPlayerMode(p);
  await go(p, 'status');

  await test.step('at 0 HP the chip and the death panel both read Dead, without a remove button', async () => {
    await hpTo0(p);
    await expect(p.locator('#view-status [data-chips] [data-chip="dead"]')).toHaveText(/^\s*Dead/);
    await expect(lifeWord(p)).toHaveText('Dead');
    await expect(p.locator('#view-status [data-chips] [data-cond-del="dead"]')).toHaveCount(0);
    await expect(p.locator('#view-status [data-dsave]')).toHaveCount(0);
  });

  await test.step('a heal of 1 leaves the hunter dead at 0 HP', async () => {
    await p.locator('#view-status [data-hp="1"]').first().tap();
    await expect(p.locator('#view-status [data-bar="hp"] [data-cur]')).toHaveText('0');
    await expect(lifeWord(p)).toHaveText('Dead');
  });
});

test('A local hunter at 0 HP shows Dead on the combat card, with no status to remove for it there', async ({ device }) => {
  const p = (await device('gm-combat')).page;
  await onboardGM(p);
  const hid = await p.evaluate(() => hunterApp.store.active().id);
  await p.evaluate(id => hunterApp.store.update(() => {
    hunterApp.store.hunter(id).life = { at: 'dead' };
  }, 'test-setup'), hid);
  await go(p, 'combat');
  await addToCombat(p, hid);
  const cid = await p.evaluate(id => hunterApp.store.get().fight.rows.find((r: any) => r.holder && r.holder.hunterId === id).id, hid);
  await p.locator(`#view-combat [data-pick="${cid}"]`).tap();
  const card = p.locator(`#view-combat .cmb-card[data-cid="${cid}"]`);
  await expect(card.locator('.cmb-tag.lw')).toHaveText('Dead');
  await expect(card.locator('[data-rc="dead"]')).toHaveCount(0);
  await go(p, 'status');
  await expect(lifeWord(p)).toHaveText('Dead');
});

test('A GM sees a remote hunter at 0 HP as Dead with no remove button, on the board and in combat', async ({ device }) => {
  const gm = (await device('gm-room')).page, pl = (await device('player-room')).page;
  const card = gm.locator('#gm-board .gm-card.remote', { hasText: 'Kai Test' });

  await test.step('the player joins the room and drops to 0 HP', async () => {
    await onboardGM(gm);
    const code = await createRoom(gm);
    await onboardPlayer(pl, 'Kai Test', code);
    await expect.poll(() => pl.evaluate(() => hunterApp.api.sync.room())).toBe(code);
    await dismissAll(pl, 4);
    await go(pl, 'status');
    await hpTo0(pl);
    await expect(lifeWord(pl)).toHaveText('Dead');
  });

  await test.step('the GM party board shows Dead without a remove button', async () => {
    await go(gm, 'gm');
    await expect(card).toHaveCount(1);
    await expect(card).toContainText(/Dead/);
    await expect(card).toContainText('0 /');
    await expect(card.locator('[data-rmstatus="dead"]')).toHaveCount(0);
  });

  await test.step('the remote combat card shows Dead and offers no status to remove for it', async () => {
    await go(gm, 'combat');
    const key = await gm.evaluate(() => {
      const o = [...document.querySelectorAll('#view-combat [data-hsel] option')].find(x => (x.textContent ?? '').endsWith('(remote)')); // the player's hunter as the GM reads it
      return o && (o as HTMLOptionElement).value;
    });
    expect(key, 'remote hunter offered in Add hunter').toBeTruthy();
    await addToCombat(gm, key!);
    const cid = await gm.evaluate(() => hunterApp.store.get().fight.rows.find((r: any) => r.holder && r.holder.kind === 'remote').id);
    await gm.locator(`#view-combat [data-pick="${cid}"]`).tap();
    const rcard = gm.locator(`#view-combat .cmb-card[data-cid="${cid}"]`);
    await expect(rcard.locator('.cmb-tag.lw')).toHaveText('Dead');
    await expect(rcard.locator('[data-rc="dead"]')).toHaveCount(0);
    await expect(lifeWord(pl)).toHaveText('Dead');
  });
});

test('Taking XP back removes the ability points of lost levels and never goes below 0 points', async ({ device }) => {
  const p = (await device('gm-xp')).page;
  await onboardGM(p);
  const s0 = await sheetNumbers(p);

  await test.step('+500 then -500 XP returns level and points and keeps HP and mana within their maxima', async () => {
    await awardXp(p, 500);
    const s1 = await sheetNumbers(p);
    expect(s1.lv, 'level after +500 XP').toBeGreaterThan(s0.lv);
    await awardXp(p, -500);
    const s2 = await sheetNumbers(p);
    expect({ lv: s2.lv, ap: s2.ap }).toEqual({ lv: s0.lv, ap: s0.ap });
    expect(s2.hp.cur).toBeLessThanOrEqual(s2.hp.max);
    expect(s2.mana.cur).toBeLessThanOrEqual(s2.mana.max);
    for (let i = 0; i < 2; i++) { await awardXp(p, 500); await awardXp(p, -500); }
    expect((await sheetNumbers(p)).ap).toBe(s0.ap);
  });

  await test.step('losing levels with one unspent point left leaves 0 points', async () => {
    await awardXp(p, 500);
    const s1 = await sheetNumbers(p);
    for (let i = 0; i < s1.ap - 1; i++) await p.locator('#view-status .stat[data-k="str"] [data-dir="1"]').tap();
    await p.locator('#view-status [data-confirm]').first().tap();
    await expect.poll(async () => (await sheetNumbers(p)).ap).toBe(1);
    await awardXp(p, -500);
    expect((await sheetNumbers(p)).ap).toBe(0);
  });
});

test('A point put on a stat and taken off again before Confirm comes back, on the GM\'s phone and on a player\'s', async ({ device }) => {
  const stat = (p: Page) => p.locator('#view-status .stat[data-k="str"]');
  const read = async (p: Page) => ({ ap: (await sheetNumbers(p)).ap, str: (await activeHunter(p)).derived.stats.str });
  for (const who of ['gm', 'player'] as const) {
    await test.step(`on the ${who}'s phone`, async () => {
      const p = (await device(`${who}-undo`)).page;
      if (who === 'gm') await onboardGM(p); else await onboardPlayer(p, 'Mira');
      await go(p, 'status');
      await p.evaluate(() => { const id = hunterApp.store.active().id; hunterApp.store.update((d: any) => { d.hunters.find((h: any) => h.id === id).bonusPoints += 3; }, 'test'); });
      const before = await read(p);
      expect(before.ap, 'points to spend').toBeGreaterThanOrEqual(3);
      await stat(p).locator('[data-dir="1"]').tap();
      await stat(p).locator('[data-dir="1"]').tap();
      await expect.poll(() => read(p)).toEqual({ ap: before.ap - 2, str: before.str + 2 });
      // a look at another tab confirms nothing: the points are still the player's to take back
      await go(p, 'dice');
      await go(p, 'status');
      await stat(p).locator('[data-dir="-1"]').tap();
      await expect.poll(() => read(p)).toEqual({ ap: before.ap - 1, str: before.str + 1 });
      await stat(p).locator('[data-dir="-1"]').tap();
      await expect.poll(() => read(p)).toEqual(before);
      await expect(p.locator('#view-status [data-confirm]')).toBeHidden();
    });
  }
});

// Brakk, the starter party's first hunter, has Control and Discipline at 10 and is E-rank: Accuracy and Will are
// eff(10) = 10 and a check of either is the rank bonus, +2. A status put on from the sheet is at the hunter's rank, E.
// Poisoned and Frightened each take 8 points at E (4 times the old -2, statuses.ts): eff(2) = 10 * 0.2 ^ 0.8 = 2.76,
// shown 2.8, and the check is floor((2.76 - 10) / 2) + 2 = -4 + 2 = -2.
test('Poisoned lowers Accuracy and the CTL check, Frightened lowers Will and the DIS check, and removing one gives them back', async ({ device }) => {
  const p = (await device('gm-poison')).page;
  await onboardGM(p);

  await test.step('at the start Accuracy and Will are 10 and both checks +2', async () => {
    expect(await sheetCells(p)).toEqual({ aim: '10', will: '10', ctl: '+2', dis: '+2' });
  });

  await test.step('Frightened takes Will to 2.8 and the DIS check to -2', async () => {
    await addCondition(p, 'frightened');
    expect(await sheetCells(p)).toEqual({ aim: '10', will: '2.8', ctl: '+2', dis: '-2' });
    await p.locator('#view-status [data-chips] [data-cond-del="frightened"]').tap();
    await expect(p.locator('#view-status [data-chips] [data-chip="frightened"]')).toHaveCount(0);
    expect(await sheetCells(p)).toEqual({ aim: '10', will: '10', ctl: '+2', dis: '+2' });
  });

  await test.step('Poisoned takes Accuracy to 2.8 and the CTL check to -2', async () => {
    await addCondition(p, 'poisoned');
    expect(await sheetCells(p)).toEqual({ aim: '2.8', will: '10', ctl: '-2', dis: '+2' });
  });
});

// The GM's Venom takes 12 Control: Control -2 counts as 1, eff(1) = 10 * 0.1 ^ 0.8 = 1.58, shown 1.6, and the check is
// floor((1.58 - 10) / 2) + 2 = -5 + 2 = -3.
test('A GM\'s own Poisoned in the library, saved and reloaded, is the one the sheet applies', async ({ device }) => {
  const p = (await device('gm-poison-ov')).page;
  await onboardGM(p);
  await p.evaluate(() => hunterApp.store.update((s: any) => {
    s.library.statuses = { poisoned: { label: 'Venom', desc: 'A GM\'s poison.', ops: [{ op: 'stat', key: 'ctl', amount: -12 }] } };
  }, 'test-setup'));
  await openApp(p);
  await dismissAll(p, 4);
  await addCondition(p, 'poisoned');
  await expect(p.locator('#view-status [data-chips] [data-chip="poisoned"]')).toHaveText(/^\s*Venom/);
  expect(await sheetCells(p)).toEqual({ aim: '1.6', will: '10', ctl: '-3', dis: '+2' });
});

test('GM Reset rules restores the rule numbers but keeps roll tables and the statuses in the Workshop', async ({ device }) => {
  const p = (await device('gm-reset')).page;
  await onboardGM(p);
  const chipText = async (k: string) => (await p.locator(`#view-status [data-chips] [data-chip="${k}"] .c-info`).innerText()).trim();
  let before = { chk: 0, ember: '', pois: '' };

  await test.step('the GM sets fatigue to cost from 0, edits a roll table, forges a status and renames Poisoned, then a hunter wears both', async () => {
    await go(p, 'gm');
    await openSection(p, 'rules');
    await p.locator('#gm-r-text').fill('{"fatigue":{"penaltyAt":0}}');
    await p.locator('#gm-r-save').tap();
    await openSection(p, 'tables');
    await p.locator('#gm-t-sel').selectOption('whisper');
    await p.locator('#gm-t-list').fill('Check whisper row');
    await p.locator('#gm-t-save').tap();
    await go(p, 'workshop');
    await p.locator('#view-workshop [data-ws="status"] [data-new]').tap();
    await p.locator('[aria-modal="true"] [data-name]').first().fill('Ember Mark');
    await p.locator('[aria-modal="true"] [data-q="dis"]').first().tap();
    await p.locator('[aria-modal="true"] [data-apply]').first().tap();
    await p.locator('#view-workshop [data-ws="status"] .ws-built summary').tap();
    await p.locator('#view-workshop [data-ws="status"] li[data-id="poisoned"] [data-act="edit"]').tap();
    await p.locator('[aria-modal="true"] [data-name]').first().fill('Venom');
    await p.locator('[aria-modal="true"] [data-apply]').first().tap();
    await expect(p.locator('[aria-modal="true"]')).toHaveCount(0);
    await addCondition(p, 'ember-mark');
    await addCondition(p, 'poisoned');
    before = { chk: await strCheck(p), ember: await chipText('ember-mark'), pois: await chipText('poisoned') };
    expect(before.ember).toBe('Ember Mark');
    expect(before.pois).toBe('Venom');
  });

  await test.step('after Reset rules fatigue costs nothing at 0 again, and the table, the forged status and Venom stay', async () => {
    await go(p, 'gm');
    await openSection(p, 'rules');
    await p.locator('#gm-r-reset').tap();
    await confirmDanger(p);
    await go(p, 'status');
    expect(await chipText('ember-mark')).toBe('Ember Mark');
    expect(await chipText('poisoned')).toBe('Venom');
    expect(await strCheck(p)).toBe(before.chk + 2);
    await go(p, 'workshop');
    await expect(p.locator('#view-workshop [data-ws="status"] li', { hasText: 'Ember Mark' })).toHaveCount(1);
    await go(p, 'gm');
    await expect(p.locator('#gm-r-text')).not.toHaveValue(/penaltyAt/);
    await openSection(p, 'tables');
    await p.locator('#gm-t-sel').selectOption('urgent');
    await p.locator('#gm-t-sel').selectOption('whisper');
    await expect(p.locator('#gm-t-list')).toHaveValue(/Check whisper row/);
  });
});

test('a GM\'s round of 0 ticks is refused in the Rules editor: Save stays off and the fight keeps its 1000 ticks', async ({ device }) => {
  const p = (await device('gm-domain')).page;
  await onboardGM(p);
  await go(p, 'gm');
  await openSection(p, 'rules');
  await p.locator('#gm-r-text').fill('{"fight":{"round":0}}');
  await expect(p.locator('#gm-r-text')).toHaveAttribute('aria-invalid', 'true');
  await expect(p.locator('#gm-r-save')).toBeDisabled();
  await p.locator('#gm-r-text').fill('{"fight":{"round":1200}}');
  await expect(p.locator('#gm-r-text')).toHaveAttribute('aria-invalid', 'false');
  await p.locator('#gm-r-save').tap();
  await expect.poll(() => p.evaluate(() => hunterApp.rules().fight.round as number)).toBe(1200);
});

// The words are refusalWords in src/core/overrides.ts, the one place a refused override is put into words.
test('the Rules editor names the bounds of a number out of its domain and why they are there', async ({ device }) => {
  const p = (await device('gm-domain-words')).page;
  await onboardGM(p);
  await go(p, 'gm');
  await openSection(p, 'rules');
  await p.locator('#gm-r-text').fill('{"fight":{"round":0}}');
  await expect(p.locator('#gm-r-msg')).toHaveText('fight.round: must be a whole number from 100 to 10000. Ticks in a round: under 100 the rounding of speed shows, 0 divides by 0.');
});

test('The skill maker starts the formula at the kind\'s recommendation, unmarked: a Shot is the quick share of 1d8 + phys, and the card says how it is used', async ({ device }) => {
  const p = (await device('skill-kind')).page;
  await onboardGM(p);
  await go(p, 'status');
  const maker = p.locator('.skm-overlay [role=dialog]');
  await p.locator('#view-status [data-panel="skills"] [data-new]').tap();
  await maker.locator('#skm-name').fill('Twin Fang');
  // a new skill is a Strike: 1d8 + phys (ability-kinds.ts)
  await expect(maker.locator('[data-formula]')).toHaveValue('1d8 + phys');
  await maker.locator('[data-chips="kind"] [data-chip="shot"]').tap();
  // a quick action deals 0.7 of a standard one (RULES.fight.cost)
  await expect(maker.locator('[data-formula]')).toHaveValue('0.7 * (1d8 + phys)');
  await expect(maker.locator('[data-edited]')).toBeHidden();
  await maker.locator('[data-apply]').tap();
  await answerWindow(p, 'Skill acquired');
  await expect(p.locator('#view-status [data-skill]', { hasText: 'Twin Fang' })).toContainText('Shot, quick · On a foe, 12 tiles');
});

test('A missed daily shows one Penalized chip without a remove button and -2 on checks once', async ({ device }) => {
  const p = (await device('penalized')).page;
  await onboardGM(p);
  await switchToPlayerMode(p);
  const check0 = await strCheck(p);
  // the rollover runs as soon as the save shows a day unchecked, so the Penalty window follows the change itself
  await p.evaluate(() => hunterApp.store.update(() => { hunterApp.store.active().daily.lastCheckedKey = '2000-01-01'; }, 'test-setup'));
  await expect(p.locator('.sys-overlay.show .sys-window', { hasText: 'Penalty Zone' }).first()).toBeVisible();
  await dismissAll(p, 6);
  await go(p, 'status');
  await expect(p.locator('#view-status [data-chips] [data-chip="penalized"]')).toHaveCount(1);
  await expect(p.locator('#view-status [data-chips] [data-cond-del="penalized"]')).toHaveCount(0);
  expect(await strCheck(p)).toBe(check0 - 2);
});

/** Every toast line the page shows from now on, in order (read off the page as the player sees it). */
async function recordToasts(p: Page): Promise<() => Promise<string[]>> {
  await p.evaluate(() => {
    const said: string[] = (window as any).__said = [];
    new MutationObserver(ms => { for (const m of ms) for (const n of m.addedNodes) if (n instanceof HTMLElement && n.matches('.toast')) said.push(n.querySelector('.t-msg')?.textContent ?? ''); })
      .observe(document.body, { childList: true, subtree: true });
  });
  return () => p.evaluate(() => [...(window as any).__said] as string[]);
}

test('the sheet says what a step did: fatigue is "critically high" once, as it crosses into disadvantage, and a fall to 0 HP says the hunter is dead', async ({ device }) => {
  const p = (await device('sheet-news')).page;
  await onboardGM(p);
  await go(p, 'status');
  const said = await recordToasts(p), ft = p.locator('#view-status [data-bar="ft"] [data-cur]');
  const line = await p.evaluate(() => { const s = hunterApp.store, h = s.active(), max = hunterApp.api.hunter.sheet(h).sheet.fatigueMax, at = Math.ceil(max * 0.8) - 3; s.update(() => { s.active().fatigue = at; }, 'test-setup'); return at; });

  await test.step('a step of +5 past 80% of the capacity says so; another +5 while past, and -10 back under, say nothing more', async () => {
    await p.locator('#view-status [data-ft="5"]').tap();
    await expect(ft).toHaveText(String(line + 5));
    await p.locator('#view-status [data-ft="5"]').tap();
    await expect(ft).toHaveText(String(line + 10));
    await p.locator('#view-status [data-ft="-10"]').tap();
    await expect(ft).toHaveText(String(line));
    expect((await said()).filter(t => /fatigue|collapsed/i.test(t))).toEqual(['Fatigue is critically high.']);
  });

  await test.step('at 0 HP the sheet says the hunter is dead, once, with the ways back', async () => {
    await hpTo0(p);
    await expect(lifeWord(p)).toHaveText('Dead');
    expect((await said()).filter(t => t.includes('You are dead'))).toEqual(['HP has reached 0. You are dead. The GM\'s Revive or a Resurrection Crystal brings you back.']);
  });
});

test('A hunter at 0 HP is dead, a heal and a rest do not raise them, and the GM revives them at 1 HP from the board with every status gone', async ({ device }) => {
  const p = (await device('gm-dead')).page;
  await onboardGM(p);
  await go(p, 'status');
  const panel = p.locator('#view-status [data-death]');

  await test.step('poisoned, then at 0 HP the hunter is Dead', async () => {
    await p.locator('#view-status [data-cond-sel]').selectOption('poisoned');
    await p.locator('#view-status [data-cond-add]').tap();
    await expect(p.locator('#view-status [data-chips] [data-chip="poisoned"]')).toHaveCount(1);
    await hpTo0(p);
    await expect(panel.locator('[data-life]')).toHaveText('Dead');
    await expect(p.locator('#view-status [data-chips] [data-chip="dead"]')).toHaveCount(1);
  });

  await test.step('healing 5 leaves the hunter dead at 0 HP, and a rest is refused with the ways back', async () => {
    const said = await recordToasts(p);
    await p.locator('#view-status [data-hp="5"]').first().tap();
    await p.locator('#view-status [data-rest]').tap();
    await expect.poll(said).toContain('A dead hunter cannot rest. The GM\'s Revive or a Resurrection Crystal brings you back.');
    await expect(p.locator('#view-status [data-bar="hp"] [data-cur]')).toHaveText('0');
    await expect(panel.locator('[data-life]')).toHaveText('Dead');
    await expect(p.locator('#view-status [data-rests-left]')).toHaveText(`Rests left this gate: ${RULES.rest.perGate} of ${RULES.rest.perGate}.`);
  });

  await test.step('the GM board shows Dead with a Revive button, and Revive brings the hunter up at 1 HP with no status left', async () => {
    const name = (await activeHunter(p)).name;
    await go(p, 'gm');
    const card = p.locator('#gm-board .gm-card:not(.remote)', { hasText: name });
    await expect(card).toContainText('Dead');
    await card.locator('[data-grevive]').tap();
    await expect(card.locator('[data-grevive]')).toHaveCount(0);
    await go(p, 'status');
    await expect(panel).toBeHidden();
    await expect(p.locator('#view-status [data-bar="hp"] [data-cur]')).toHaveText('1');
    await expect(p.locator('#view-status [data-chips] [data-chip="poisoned"]')).toHaveCount(0);
  });
});

test('A collapsed hunter stays Exhausted when fatigue drops by hand; a rest takes most of the fatigue off and lifts it, twice a gate', async ({ device }) => {
  const p = (await device('collapsed')).page;
  await onboardGM(p);
  await switchToPlayerMode(p);
  await go(p, 'status');
  const exhausted = p.locator('#view-status [data-chips] [data-chip="exhausted"]');
  const fatigue = p.locator('#view-status [data-bar="ft"] [data-cur]');
  const left = p.locator('#view-status [data-rests-left]'), n = RULES.rest.perGate;

  // Brakk's Vitality is 18 and Iron Skin's 2, so 20: x(20) = 7.41 and the fatigue capacity is 100 + 50 * 7.41 / 47.41
  // = 107.8, 108 (`fatigueBase` 100, `fatigueCap` 50, `half` 40). Collapse is at 100 percent of it (`collapseAt`).
  await test.step('fatigue full, at the capacity of 108, collapses the hunter: Exhausted, with no remove button', async () => {
    await p.locator('#view-status [data-ft="full"]').tap();
    await expect(fatigue).toHaveText('108');
    await expect(p.locator('#view-status [data-bar="ft"] [data-maxtxt]')).toHaveText('108');
    await expect(exhausted).toHaveCount(1);
    await expect(p.locator('#view-status [data-cond-del="exhausted"]')).toHaveCount(0);
    await expect(left).toHaveText(`Rests left this gate: ${n} of ${n}.`);
  });

  await test.step('fatigue down 10 by hand, and Exhausted stays', async () => {
    await p.locator('#view-status [data-ft="-10"]').tap();
    await expect(fatigue).toHaveText('98');
    await expect(exhausted).toHaveCount(1);
  });

  // "exhausted will largely clear" (the owner, Nov 22): a rest takes `RULES.rest.fatigue` of the 98 held off, rounded up
  await test.step('a rest takes its share of the fatigue off and ends the collapse', async () => {
    await p.locator('#view-status [data-rest]').tap();
    await expect(fatigue).toHaveText(String(98 - Math.ceil(98 * RULES.rest.fatigue)));
    await expect(exhausted).toHaveCount(0);
    await expect(left).toHaveText(`Rests left this gate: ${n - 1} of ${n}.`);
  });

  await test.step('the rests a gate spent, the next rest is refused with the words that say why', async () => {
    const said = await recordToasts(p);
    for (let i = 1; i < n; i++) await p.locator('#view-status [data-rest]').tap();
    await expect(left).toHaveText(`Rests left this gate: 0 of ${n}.`);
    await p.locator('#view-status [data-rest]').tap();
    await expect.poll(said).toContain(`No rest left: a hunter rests ${n} times a gate. Clearing the gate gives everything back.`);
    await expect(left).toHaveText(`Rests left this gate: 0 of ${n}.`);
  });
});

/** Opens the named condition's chip on the sheet and answers what its detail says. */
async function chipCard(p: Page, key: string): Promise<string> {
  await go(p, 'status');
  const info = p.locator(`#view-status [data-chips] [data-chip="${key}"] [data-dt-key]`);
  if ((await info.getAttribute('aria-expanded')) !== 'true') await info.tap();
  const detail = p.locator('#view-status [data-chips] .dt');
  await expect(detail).toBeVisible();
  return detail.innerText();
}

test('An item of a higher rarity applies a stronger status than a common one', async ({ device }) => {
  const p = (await device('flasks')).page;
  await onboardPlayer(p, 'Kai Test');
  await dismissAll(p);
  await p.evaluate(() => {
    const id = hunterApp.store.active().id, burn = [{ op: 'applyStatus', key: 'burning', def: hunterApp.rules().conditions.burning, duration: 3000 }];
    hunterApp.api.inventory.addItem(id, { name: 'Ember Flask', rar: 'common', type: 'consumable', qty: 1, effects: burn });
    hunterApp.api.inventory.addItem(id, { name: 'Inferno Flask', rar: 'epic', type: 'consumable', qty: 1, effects: burn });
  });
  const card = (name: string) => p.locator('#view-status [data-panel="inventory"] .inv-card', { hasText: name });

  // Burning by rank is 1d6, 2d6, 3d8, 4d10, 5d12, 7d12 (statuses.ts); common is the first tier, epic the fourth
  await test.step('the common flask\'s detail says its Burning deals 1d6, the epic one\'s 4d10', async () => {
    await go(p, 'status');
    await card('Ember Flask').locator('.i-name').tap();
    await expect(card('Ember Flask').locator('.dt')).toContainText('Applies Burning (3 rounds): 1d6 magical damage a round');
    await card('Inferno Flask').locator('.i-name').tap();
    await expect(card('Inferno Flask').locator('.dt')).toContainText('Applies Burning (3 rounds): 4d10 magical damage a round');
    await expect(card('Ember Flask').locator('.dt'), 'one detail open at a time in a list').toHaveCount(0);
  });

  await test.step('using the common flask burns the hunter for 1d6 a round', async () => {
    await card('Ember Flask').locator('[data-use]').tap();
    expect(await chipCard(p, 'burning')).toContain('1d6 magical damage a round');
  });

  await test.step('using the epic flask on top makes it 4d10, still one Burning chip', async () => {
    await card('Inferno Flask').locator('[data-use]').tap();
    expect(await chipCard(p, 'burning')).toContain('4d10 magical damage a round');
    await expect(p.locator('#view-status [data-chips] [data-chip="burning"]')).toHaveCount(1);
  });
});

test('Worn and used items do what their effects say: a rare potion heals its rare amount, a tonic a quarter of max HP, a ring its Strength', async ({ device }) => {
  const p = (await device('tiers')).page;
  await onboardPlayer(p, 'Kai Test');
  await dismissAll(p);
  await p.evaluate(() => {
    const id = hunterApp.store.active().id, n = (value: number) => ({ kind: 'number', value });
    hunterApp.api.inventory.addItem(id, { name: 'Rank Draught', rar: 'rare', type: 'consumable', effects: [{ op: 'heal', amount: [1, 2, 3, 4, 5, 6].map(n), when: 'use' }] });
    hunterApp.api.inventory.addItem(id, { name: 'Quarter Tonic', rar: 'common', type: 'consumable', effects: [{ op: 'heal', amount: { kind: 'binary', op: '*', left: n(0.25), right: { kind: 'sheet', whose: 'user', key: 'hpMax' } }, when: 'use' }] });
    hunterApp.api.inventory.addItem(id, { name: 'Rank Ring', rar: 'epic', type: 'accessory', slot: 'ring1', bonus: { str: 2 } });
  });
  const card = (name: string) => p.locator('#view-status [data-panel="inventory"] .inv-card', { hasText: name });
  const now = () => p.evaluate(() => { const x = hunterApp.api.hunter.sheet(hunterApp.store.active()); return { hp: x.hp as number, hpMax: x.sheet.hpMax as number, str: x.stats.str as number }; });
  await go(p, 'status');
  for (let i = 0; i < 3; i++) await p.locator('#view-status [data-hp="-5"]').first().tap();
  const start = await now();
  expect(start.hp).toBe(start.hpMax - 15);

  await test.step('the rare draught heals 3, the third of its six numbers', async () => {
    await card('Rank Draught').locator('[data-use]').tap();
    await expect.poll(async () => (await now()).hp).toBe(start.hp + 3);
  });

  await test.step('the tonic heals a quarter of max HP', async () => {
    await card('Quarter Tonic').locator('[data-use]').tap();
    await expect.poll(async () => (await now()).hp).toBe(start.hp + 3 + Math.round(start.hpMax / 4));
  });

  await test.step('wearing the ring adds its 2 Strength', async () => {
    await card('Rank Ring').locator('[data-equip]').tap();
    await expect.poll(async () => (await now()).str).toBe(start.str + 2);
  });
});

test('Editing a library item in the item maker shows a row for each of its six effects, and saving it keeps them', async ({ device }) => {
  const p = (await device('gm-forge-keep')).page;
  await onboardGM(p);
  const dice = (count: number, sides: number) => ({ kind: 'dice', count, sides }), n = (value: number) => ({ kind: 'number', value });
  const effects = [
    { op: 'heal', amount: [1, 2, 3, 4, 5, 6].map(c => dice(c, 4)), when: 'use' }, { op: 'damage', type: 'magical', amount: n(10), when: 'use' },
    { op: 'mana', amount: n(5), when: 'use' }, { op: 'fatigue', amount: n(-10), when: 'use' }, { op: 'cureStatus', key: 'poisoned' }, { op: 'note', text: 'Smells of ash' },
  ];
  await p.evaluate(fx => hunterApp.store.update((d: any) => {
    d.library.items.push({ id: 'i900', name: 'Ash Vial', rar: 'rare', type: 'consumable', slot: null, qty: 1, dice: '', bonus: {}, value: 70, desc: '', weight: 0, armor: 0, resist: 0, effects: fx });
  }), effects);
  const stored = () => p.evaluate(() => hunterApp.store.get().library.items.find((i: any) => i.id === 'i900'));
  const before = await stored();
  expect(before.effects).toHaveLength(6);

  await go(p, 'workshop');
  await p.locator('#view-workshop [data-ws="item"] li[data-id="i900"] [data-act="edit"]').tap();
  const win = p.locator('[aria-modal="true"]', { hasText: 'Edit item' });
  await expect(win).toBeVisible();
  await expect(win.locator('.mk-fx')).toHaveCount(6);
  await expect(win.locator('.mk-keep')).toHaveCount(0);
  await win.locator('[data-apply]').tap();
  await expect(win).toHaveCount(0);
  expect((await stored()).effects).toEqual(before.effects);
});

test('A GM\'s edit of Burning to a flat 1d4 is flat at every rank in the rules reference, and a status of the GM\'s own is listed beside it', async ({ device }) => {
  const p = (await device('gm-flat')).page;
  await onboardGM(p);
  const d = p.locator('.fg-overlay [role=dialog]');
  await go(p, 'workshop');
  await test.step('the GM edits the built-in Burning: one row of 1d4, by no rank', async () => {
    await p.locator('#view-workshop [data-ws="status"] .ws-built summary').tap();
    await p.locator('#view-workshop [data-ws="status"] .ws-built li', { hasText: 'Burning' }).locator('[data-act="edit"]').tap();
    await expect(d.locator('[data-row="0"] [data-mode="rank"]')).toHaveAttribute('aria-pressed', 'true');
    await d.locator('[data-row="0"] [data-mode="flat"]').tap();
    await d.locator('[data-row="0"] [data-f="q"]').fill('1d4');
    await d.locator('[data-apply]').tap();
    await expect(d).toHaveCount(0);
  });
  await test.step('the GM makes Ember Mark: 1d6 magical a round', async () => {
    await p.locator('#view-workshop [data-ws="status"] [data-new]').tap();
    await d.locator('[data-name]').fill('Ember Mark');
    await d.locator('[data-quick] [data-q="d6"]').tap();
    await d.locator('[data-apply]').tap();
    await expect(d).toHaveCount(0);
  });
  await test.step('the rules reference lists Burning at 1d4 with no rank and Ember Mark at 1d6', async () => {
    await go(p, 'rules');
    const burning = p.locator('#rr-conditions tr', { hasText: 'Burning' });
    await expect(burning).toContainText('1d4 magical damage a round');
    await expect(burning).not.toContainText('by rank');
    await expect(p.locator('#rr-conditions tr', { hasText: 'Ember Mark' })).toContainText('1d6 magical damage a round');
  });
});

test('The rules reference shows a scaled status\'s six values, E to S', async ({ device }) => {
  const p = (await device('rules-ref')).page;
  await onboardPlayer(p, 'Kai Test');
  await dismissAll(p);
  await go(p, 'rules');
  const row = p.locator('#view-rules tr', { hasText: 'Burning' }).first();
  await row.scrollIntoViewIfNeeded();
  await expect(row).toContainText('1d6 / 2d6 / 3d8 / 4d10 / 5d12 / 7d12 magical damage a round, by rank E to S');
});

test('the rules reference says a timed status is paid at the start of its bearer\'s turn and ends when its rounds have passed, as the fight counts it', async ({ device }) => {
  const p = (await device('rules-timing')).page;
  await onboardPlayer(p, 'Kai Test');
  await dismissAll(p);
  await go(p, 'rules');
  await expect(p.locator('#view-rules')).toContainText('per-round effects are paid at the start of the bearer\'s turn');
  await expect(p.locator('#view-rules')).toContainText('a status ends when its rounds have passed');
  await expect(p.locator('#view-rules')).not.toContainText('count down at the end');
});

test('a player\'s rules page opens with How checks work and has no GM quick card, and the 0 HP line says dead', async ({ device }) => {
  const p = (await device('rules-player')).page;
  await onboardPlayer(p, 'Kai Test');
  await dismissAll(p);
  await go(p, 'rules');
  await expect(p.locator('#view-rules .rr-sec').first()).toContainText('How checks work');
  await expect(p.locator('#rr-cheat')).toHaveCount(0);
  await test.step('the stat line and the worked example state the same bonus for a score of 14, once', async () => {
    const checks = await p.locator('#rr-checks').innerText();
    expect(checks).toContain(statBonusLine(RULES));
    expect(checks.split('the effective points are close to')).toHaveLength(2);
    expect(checks).toMatch(/Strength 14 \([\d.]+ effective points above 10, so \+1\)/);
    expect(checks).toContain('adds +1.');
    expect(checks).not.toContain('adds about 2');
  });
  await test.step('a natural 1 names the coin, and only Confirm locks points', async () => {
    await expect(p.locator('#rr-checks')).toContainText(naturalLines()[1]!);
    await expect(p.locator('#view-rules')).toContainText(pointsLine());
    await expect(p.locator('#view-rules')).not.toContainText('or leave the Status view, to lock it in');
  });
  await expect(p.locator('#view-rules')).toContainText('At 0 HP a hunter is dead.');
  await expect(p.locator('#view-rules')).toContainText(deathLine(RULES));
  await expect(p.locator('#view-rules')).not.toContainText('death save');
  await expect(p.locator('#view-rules')).not.toContainText('Unconscious');
  await test.step('the Gates section tells solo runs and the personal gates, the first of them the even one', async () => {
    for (const line of soloLines(RULES)) await expect(p.locator('#rr-gates')).toContainText(line);
  });
});

test('a GM\'s rules page opens with the GM quick card', async ({ device }) => {
  const p = (await device('rules-gm')).page;
  await onboardGM(p);
  await go(p, 'rules');
  await expect(p.locator('#view-rules .rr-sec').first()).toContainText('GM quick card');
});

test('the rules reference explains the eight stats, Armor and Resist, and the turn order by speed', async ({ device }) => {
  const p = (await device('rules-stats')).page;
  await onboardPlayer(p, 'Kai Test');
  await dismissAll(p);
  await go(p, 'rules');
  const stats = p.locator('#rr-stats tbody tr');
  await expect(stats).toHaveCount(8);
  await expect(stats.first()).toContainText('Strength');
  // dealt = damage * 100 / (100 + defence) (RULES.fight.armorK); the heavy kit's 60 armor takes 38% off
  await expect(p.locator('#rr-armor')).toContainText('60 armor takes 38% off');
  await expect(p.locator('#rr-combat')).toContainText('Turns come by speed');
});

test('a hunter who falls in a fight is Dead on the GM\'s card, which offers Revive, and the Revive stands it up at 1 HP', async ({ device }) => {
  const p = (await device('gm-dead-card')).page;
  await onboardGM(p);
  const hid = await p.evaluate(() => hunterApp.store.active().id);
  const cid = async () => p.evaluate(id => hunterApp.store.get().fight.rows.find((r: any) => r.holder && r.holder.hunterId === id).id, hid);

  await test.step('the GM runs a fight with the hunter, who falls to 0 HP and is dead', async () => {
    await combatReady(p);
    await p.locator(`#view-combat [data-pick="${await cid()}"]`).tap();
    await p.locator(`#view-combat .cmb-card[data-cid="${await cid()}"] [data-defeat]`).tap();
    await expect.poll(async () => (await activeHunter(p)).life.at).toBe('dead');
  });

  await test.step('the hunter\'s card reads Dead and offers Revive, which stands it up at 1 HP', async () => {
    const card = p.locator(`#view-combat .cmb-card[data-cid="${await cid()}"]`);
    await expect(card.locator('.cmb-tag.lw')).toHaveText('Dead');
    await expect(card.locator('[data-dsave], [data-stabilize]')).toHaveCount(0);
    await card.locator('[data-revive]').tap();
    await expect.poll(async () => (await activeHunter(p)).life).toEqual({ at: 'up', hp: 1 });
  });
});

test('a player in a room at 0 HP reads Dead on their HUD in the GM\'s fight, with the ways back and nothing to roll', async ({ device }) => {
  const gm = (await device('gm-room-dead')).page, pl = (await device('player-room-dead')).page;

  await test.step('the player joins the room and drops to 0 HP', async () => {
    await onboardGM(gm);
    const code = await createRoom(gm);
    await onboardPlayer(pl, 'Kai Test', code);
    await expect.poll(() => pl.evaluate(() => hunterApp.api.sync.room())).toBe(code);
    await dismissAll(pl, 4);
    await go(pl, 'status');
    await hpTo0(pl);
  });

  await test.step('the GM puts the player in a fight and the player\'s HUD reads Dead', async () => {
    await go(gm, 'gm');
    await expect(gm.locator('#gm-board .gm-card.remote', { hasText: 'Kai Test' })).toHaveCount(1);
    // the row joins with the life of the sheet the GM's phone has read, and from then on the row's life is the sheet's
    await expect.poll(() => gm.evaluate(() => (hunterApp.api.sync.remoteSheets() as any[]).find(r => r.data.name === 'Kai Test')?.data.life.at)).toBe('dead');
    await go(gm, 'combat');
    await expect(gm.locator('#view-combat [data-hsel] option', { hasText: 'Kai Test' })).toHaveCount(1);
    const key = await gm.evaluate(() => {
      const o = [...document.querySelectorAll('#view-combat [data-hsel] option')].find(x => (x.textContent ?? '').endsWith('(remote)')); // the player's hunter as the GM reads it
      return o && (o as HTMLOptionElement).value;
    });
    await addToCombat(gm, key!);
    const own = await gm.evaluate(() => hunterApp.store.active().id);
    await addToCombat(gm, own);
    await gm.locator('#view-combat [data-qline]').fill('Cave Rat, E, brute');
    await gm.locator('#view-combat [data-qadd]').tap();
    await gm.locator('#view-combat [data-start]').tap();
    await dismissAll(gm, 3);
    await go(pl, 'combat');
    const row = pl.locator('#view-combat .tb-death');
    await expect(row.locator('b')).toHaveText('Dead');
    await expect(row).toContainText('The GM\'s Revive or a Resurrection Crystal brings you back.');
    await expect(row.locator('button')).toHaveCount(0);
  });
});

test('each control on the sheet and the one that undoes it leave the hunter as it was, on the GM\'s phone and on a player\'s', async ({ device }) => {
  const hunter = (p: Page) => p.evaluate(() => JSON.parse(JSON.stringify(hunterApp.store.active())));
  for (const who of ['gm', 'player'] as const) {
    await test.step(`on the ${who}'s phone`, async () => {
      const p = (await device(`${who}-roundtrip`)).page;
      if (who === 'gm') await onboardGM(p); else await onboardPlayer(p, 'Mira');
      await go(p, 'status');
      await p.evaluate(() => hunterApp.api.inventory.addItem(hunterApp.store.active().id, { name: 'Test Ring', rar: 'rare', type: 'accessory', slot: 'ring1', bonus: { str: 1 } }));
      const before = await hunter(p);

      await p.locator('#view-status [aria-label="Equip Test Ring"]').tap();
      await expect(p.locator('#view-status [aria-label="Unequip Test Ring"]').first()).toBeVisible();
      await p.locator('#view-status [data-unequip-item][aria-label="Unequip Test Ring"]').tap();
      await expect.poll(() => hunter(p), 'equip, then unequip').toEqual(before);

      await p.locator('#view-status [data-cond-sel]').selectOption({ label: 'Hasted' });
      await p.locator('#view-status [data-cond-add]').tap();
      await p.locator('#view-status [aria-label="Remove status Hasted"]').tap();
      await expect.poll(() => hunter(p), 'a status put on, then taken off').toEqual(before);

      if (who === 'gm') {
        const grant = p.locator('#view-status [data-grant-title]').first(), name = (await grant.getAttribute('aria-label'))!.replace(/^Grant title /, '');
        await grant.tap();
        await p.locator(`#view-status [aria-label="Delete title ${name}"]`).tap();
        await answerWindow(p, 'Delete title?', 'Delete');
        // but for what the System remembers: the title given stays a fact of the chronicle (notes-1-feats.md 1.5)
        await expect.poll(async () => ({ ...await hunter(p), chronicle: before.chronicle }), 'a title granted, then deleted').toEqual(before);
        const given = await hunter(p);
        expect(given.chronicle.facts.map((f: { kind: string; name?: string }) => [f.kind, f.name])).toEqual([...before.chronicle.facts.map((f: { kind: string; name?: string }) => [f.kind, f.name]), ['title', name]]);
      }
    });
  }
});

test('removing a worn amulet that raised max HP brings HP down to the new maximum, as taking it off does', async ({ device }) => {
  const p = (await device('gm-amulet')).page;
  await onboardGM(p);
  await go(p, 'status');
  const id = await p.evaluate(() => {
    const A = hunterApp.api, hid = hunterApp.store.active().id;
    const it = A.inventory.addItem(hid, { name: 'Vital Amulet', rar: 'rare', type: 'accessory', slot: 'neck', bonus: { hpMax: 20 } });
    A.inventory.equip(hid, it.id); A.hunter.heal(hid, 999);
    return it.id as string;
  });
  const hp = () => p.evaluate(() => { const h = hunterApp.store.active(); return { stored: h.life.hp, max: hunterApp.api.hunter.sheet(h).sheet.hpMax }; });
  const worn = await hp();
  await p.locator(`#view-status [data-del="${id}"]`).tap();
  await answerWindow(p, 'Remove item?', 'Remove');
  await expect.poll(hp).toEqual({ stored: worn.max - 20, max: worn.max - 20 });
});
