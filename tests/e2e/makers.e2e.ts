// The makers (src/views/maker.js): the status, item, skill and enemy makers on a phone, driven through the UI, read back
// from the save and from the game. The steps that put a status on a fight row run on the GM's fight screen of W5
// (combat.js); they need W5's merge to run.
import type { Locator, Page } from '@playwright/test';
import { test, expect, onboardGM, onboardPlayer, createRoom, dismissAll, go, answerWindow, startGoblinDenFight, openApp, chooseList } from './helpers.ts';
import { RULES } from '../../src/core/rules.ts';
import { baseStats } from '../../src/core/stats.ts';
import type { StatKey } from '../../src/core/stats.ts';
import { kitGear } from '../../src/core/hunter/derive.ts';
import type { Kit } from '../../src/core/hunter/derive.ts';
import { diceOf, parseFormula } from '../../src/core/formula.ts';
import { place, tiles } from '../../src/core/combat/space.ts';
import type { Place } from '../../src/core/combat/space.ts';
import { tick } from '../../src/core/combat/timeline.ts';
import { abilityId, combatantId } from '../../src/core/combat/ability-types.ts';
import type { Ability } from '../../src/core/combat/ability-types.ts';
import { modified, OP_KINDS, statusKey } from '../../src/core/combat/effect-ops.ts';
import type { Origin, StatusDef } from '../../src/core/combat/effect-ops.ts';
import { parseOp } from '../../src/core/combat/fight-parse.ts';
import { formulaOf as formulaNow, abilityOf, defaultTicks, recommended } from '../../src/core/registry/ability-kinds.ts';
import { fightId, reduce } from '../../src/core/combat/fight.ts';
import type { Command, Ctx, Fight, NewRow } from '../../src/core/combat/fight.ts';
import { UNFINISHED_ROWS, newRewards } from '../../src/core/rewards.ts';
import { EXAMPLE_STORIES } from '../../src/core/registry/stories.ts';
import { rowHp } from '../../src/core/combat/row-hp.ts';

const combat = (page: Page) => page.locator('#view-combat');
const statusMaker = (page: Page) => page.locator('.fg-overlay [role=dialog]');
const itemMaker = (page: Page) => page.locator('.lf-overlay [role=dialog]');
const skillMaker = (page: Page) => page.locator('.skm-overlay [role=dialog]');
const monsterMaker = (page: Page) => page.locator('.enm-overlay [role=dialog]');
const libraryItem = (page: Page, name: string) => page.evaluate(n => hunterApp.store.get().library.items.find((i: any) => i.name === n), name);

/** A section of the Workshop: `status`, `item`, `skill` or `monster`. */
const workshop = (page: Page, kind: string) => page.locator(`#view-workshop [data-ws="${kind}"]`);
/** From the screen the app opens on: the GM tab, then a button of the Make row (`status`, `item`, `skill`, `monster`, `bundle`). */
async function makeFromHome(page: Page, t: { tap(l: Locator): Promise<void> }, kind: string) {
  await openApp(page);
  await expect(page.locator('#view-gm')).toBeVisible();
  await t.tap(page.locator(`#gm-make [data-make="${kind}"]`));
}

/** In the window a Workshop row's "⋯" opened, the action named `label`. The window it may open next can hold the same name, so this does not wait for it to close. */
const underMore = (page: Page, label: string) => page.locator('.sys-overlay.show .sys-actions button', { hasText: label }).first().tap();

/** Taps through the UI and counts them: what the GM's thumb does. Typing is not a tap; picking from a select is one. */
function tapCounter() {
  let n = 0;
  return { tap: async (l: Locator) => { await l.tap(); n++; }, selected: () => { n++; }, get count() { return n; } };
}

async function tapCombat(page: Page, selector: string) {
  const target = combat(page).locator(selector).first();
  await target.evaluate((el: any) => el.scrollIntoView({ block: 'center' }));
  await target.tap();
}

/** The Goblin Den fight, its first monster renamed and set to `rank` (setup through the store). Answers the monster's name. */
async function fightWith(page: Page, rank: string): Promise<string> {
  await chooseList(page);
  await startGoblinDenFight(page);
  await page.evaluate(r => hunterApp.store.update((d: any) => {
    const m = d.fight.rows.find((c: any) => c.kind === 'monster');
    Object.assign(m, { name: 'Frost Wolf', tier: ['E', 'D', 'C', 'B', 'A', 'S'].indexOf(r), origin: { ...m.origin, rank: r } });
  }, 'test-setup'), rank);
  return 'Frost Wolf';
}
/** The fight row named `name`, as the save holds it. */
const row = (page: Page, name: string) => page.evaluate(n => hunterApp.store.get().fight.rows.find((c: any) => c.name === n), name);

/** Opens the Status window on a combatant's card. */
async function statusOn(page: Page, name: string) {
  await tapCombat(page, `.cmb-row:has-text("${name}") .cmb-pick`);
  await tapCombat(page, `.cmb-card:has-text("${name}") [data-cforge]`);
  await expect(statusMaker(page)).toBeVisible();
}
const card = (page: Page, name: string) => combat(page).locator('.cmb-card', { hasText: name });

test('a GM makes Frostbite with damage by rank in 6 taps from the home screen, and a C-rank monster in a fight shows its C value', async ({ device }) => {
  const page = (await device('gm')).page;
  await onboardGM(page);
  const t = tapCounter(), d = statusMaker(page);

  await test.step('the GM makes the status: 1d6 magical a round by rank, S changed to 9d12', async () => {
    await makeFromHome(page, t, 'status');
    await t.tap(d.locator('[data-name]'));
    await d.locator('[data-name]').fill('Frostbite');
    await t.tap(d.locator('[data-quick] [data-q="d6"]'));
    await t.tap(d.locator('[data-row="0"] [data-mode="rank"]'));
    const tiers = d.locator('[data-row="0"] [data-t]');
    await expect(tiers).toHaveCount(6);
    await t.tap(tiers.nth(5));
    await tiers.nth(5).fill('9d12');
    await expect(d.locator('.mk-preview')).toContainText('1d6 / 2d6 / 3d8 / 4d10 / 5d12 / 9d12 magical damage a round, by rank E to S');
    await t.tap(d.locator('[data-apply]'));
    await expect(d).toHaveCount(0);
    expect(t.count).toBeLessThanOrEqual(6);
  });

  await test.step('the library holds the op with six formulas', async () => {
    const lib = await page.evaluate(() => hunterApp.store.get().library.statuses);
    const dice = (count: number, sides: number) => ({ kind: 'dice', count, sides });
    expect(lib.frostbite.ops).toEqual([{ op: 'damage', type: 'magical', amount: [dice(1, 6), dice(2, 6), dice(3, 8), dice(4, 10), dice(5, 12), dice(9, 12)] }]);
  });

  await test.step('put on a C-rank monster by hand at its own rank, the card says 3d8', async () => {
    const wolf = await fightWith(page, 'C');
    await statusOn(page, wolf);
    await expect(d.locator('[data-chips="strength"] [data-chip="C"]')).toHaveAttribute('aria-pressed', 'true');
    await d.locator('[data-existing] [data-chip="frostbite"]').tap();
    await expect(card(page, wolf)).toContainText('3d8 magical damage a round');
  });
});

test('a GM makes a status whose damage is a formula on the bearer\'s max HP, and a wrong name in it shows the parser\'s error on its row', async ({ device }) => {
  const page = (await device('gm')).page;
  await onboardGM(page);
  const d = statusMaker(page);
  await go(page, 'workshop');
  await workshop(page, 'status').locator('[data-new]').tap();
  await d.locator('[data-name]').fill('Wither');
  await d.locator('[data-add]').tap();
  await d.locator('[data-row="0"] [data-f="q"]').fill('0.05 * hpMx');
  await expect(d.locator('[data-row="0"] [data-err]')).toContainText('Unknown name "hpMx" at character 8.');
  await expect(d.locator('[data-apply]')).toBeDisabled();
  await d.locator('[data-row="0"] [data-f="q"]').fill('0.05 * hpMax');
  await expect(d.locator('[data-row="0"] [data-err]')).toHaveText('');
  await expect(d.locator('.mk-preview')).toContainText('0.05 * hpMax physical damage a round');
  await d.locator('[data-apply]').tap();
  await expect(d).toHaveCount(0);
  const ops = await page.evaluate(() => hunterApp.store.get().library.statuses.wither.ops);
  expect(ops).toEqual([{ op: 'damage', type: 'physical', amount: { kind: 'binary', op: '*', left: { kind: 'number', value: 0.05 }, right: { kind: 'sheet', whose: 'user', key: 'hpMax' } } }]);
});

test('a GM puts Slowed on an E-rank monster by hand at Strength A, and the card shows Speed −40%', async ({ device }) => {
  const page = (await device('gm')).page;
  await onboardGM(page);
  const wolf = await fightWith(page, 'E'), d = statusMaker(page);
  await statusOn(page, wolf);
  await expect(d.locator('[data-chips="strength"] [data-chip="E"]')).toHaveAttribute('aria-pressed', 'true');
  await d.locator('[data-chips="strength"] [data-chip="A"]').tap();
  await d.locator('[data-existing] [data-chip="slowed"]').tap();
  // Slowed's speed by rank is −20, −25, −30, −35, −40, −50 (statuses.ts): A is the fifth
  await expect(card(page, wolf)).toContainText('Speed −40%');
  expect((await row(page, wolf)).statuses.find((s: any) => s.key === 'slowed').source).toEqual({ id: null, tier: 4 });
});

test('from the Workshop, New status has no Rounds, no Apply existing and no Save to library, and one Save status button keeps it', async ({ device }) => {
  const page = (await device('gm')).page;
  await onboardGM(page);
  const d = statusMaker(page);
  await go(page, 'workshop');
  await workshop(page, 'status').locator('[data-new]').tap();
  await expect(d.getByRole('heading', { name: 'New status' })).toBeVisible();
  await expect(d.getByLabel('Rounds', { exact: true })).toHaveCount(0);
  await expect(d.getByText('Apply existing')).toHaveCount(0);
  await expect(d.getByText('Save to library')).toHaveCount(0);
  await expect(d.locator('.mk-actions button')).toHaveText(['Cancel', 'Save status']);
  await d.locator('[data-name]').fill('Ember Mark');
  await d.locator('[data-quick] [data-q="d4"]').tap();
  await d.getByRole('button', { name: 'Save status' }).tap();
  await expect(d).toHaveCount(0);
  expect(await page.evaluate(() => hunterApp.store.get().library.statuses['ember-mark']?.label)).toBe('Ember Mark');
  await expect(workshop(page, 'status').locator('.ws-list li', { hasText: 'Ember Mark' })).toContainText('1d4 physical damage a round');
});

test('in a fight, Poisoned goes on a monster one tap after the Status window opens, with the Rounds and Strength the window shows', async ({ device }) => {
  const page = (await device('gm')).page;
  await onboardGM(page);
  const wolf = await fightWith(page, 'E'), d = statusMaker(page), t = tapCounter();
  await statusOn(page, wolf);
  await d.getByLabel('Rounds', { exact: true }).fill('5');
  await d.locator('[data-chips="strength"] [data-chip="B"]').tap();
  await t.tap(d.locator('[data-existing] [data-chip="poisoned"]'));
  await expect(d).toHaveCount(0);
  expect(t.count).toBe(1);
  const st = (await row(page, wolf)).statuses.find((s: any) => s.key === 'poisoned');
  // five rounds of 1000 ticks (RULES.fight.round), from the GM at B's tier
  expect(st.source).toEqual({ id: null, tier: 3 });
  expect(st.until - st.since).toBe(5000);
});

test('on a 390 by 844 phone, each button of the GM view\'s Make row opens its maker in one tap', async ({ device }) => {
  const page = (await device('gm', { viewport: { width: 390, height: 844 } })).page;
  await onboardGM(page);
  await go(page, 'gm');
  const makers: [string, string, Locator][] = [
    ['status', 'New status', statusMaker(page)], ['item', 'New item', itemMaker(page)], ['skill', 'New skill', skillMaker(page)],
    ['monster', 'New monster', monsterMaker(page)], ['bundle', 'New bundle', page.locator('.rwm-overlay [role=dialog]')],
  ];
  for (const [kind, title, d] of makers) {
    await test.step(`${kind}: one tap opens ${title}`, async () => {
      const t = tapCounter();
      await expect(page.locator(`#gm-make [data-make="${kind}"]`)).toBeInViewport({ ratio: 1 });
      await t.tap(page.locator(`#gm-make [data-make="${kind}"]`));
      await expect(d.getByRole('heading', { name: title })).toBeVisible();
      expect(t.count).toBe(1);
      await d.locator('[data-cancel]').tap();
      await expect(d).toHaveCount(0);
    });
  }
  await page.locator('#gm-make [data-make="workshop"]').tap();
  await expect(page.locator('#view-workshop')).toBeVisible();
});

test('the item maker takes the GM\'s typing the moment it shows, and its effects editor, drawn a frame later, takes the next tap', async ({ device }) => {
  const page = (await device('gm', { viewport: { width: 390, height: 844 } })).page;
  await onboardGM(page);
  const t = tapCounter(), d = itemMaker(page);
  await makeFromHome(page, t, 'item');
  await expect(d.getByRole('heading', { name: 'New item' })).toBeVisible();
  await expect(d.locator('#lf-name')).toBeFocused();
  await page.keyboard.type('Quick Draught');
  await t.tap(d.locator('[data-quick] [data-q="heal"]'));
  await expect(d.locator('.mk-preview')).toContainText('2d4 + 2');
  await t.tap(d.locator('[data-apply]'));
  await expect(d).toHaveCount(0);
  expect(await libraryItem(page, 'Quick Draught')).toMatchObject({ name: 'Quick Draught', effects: [{ op: 'heal', when: 'use' }] });
});

test('a GM makes the consumable Bottled Storm in 7 taps from the home screen, and Edit shows every field and effect as saved', async ({ device }) => {
  const page = (await device('gm')).page;
  await onboardGM(page);
  const t = tapCounter(), d = itemMaker(page);

  await test.step('the GM makes it: on a target, 2d6 damage and Bleeding', async () => {
    await makeFromHome(page, t, 'item');
    await t.tap(d.locator('#lf-name'));
    await d.locator('#lf-name').fill('Bottled Storm');
    await t.tap(d.locator('[data-chips="type"] [data-chip="consumable"]'));
    await t.tap(d.locator('[data-quick] [data-q="damage"]'));
    await t.tap(d.locator('[data-quick] [data-q="apply"]'));
    await t.tap(d.locator('[data-chips="target"] [data-chip="other"]'));
    await expect(d.locator('.mk-preview')).toContainText('Deals 2d6 physical damage');
    // a common item's tier is E's: Bleeding at E is 1d4 a round
    await expect(d.locator('.mk-preview')).toContainText('Applies Bleeding (3 rounds): 1d4 physical damage a round');
    await t.tap(d.locator('[data-apply]'));
    await expect(d).toHaveCount(0);
    expect(t.count).toBeLessThanOrEqual(7);
  });

  const saved = await libraryItem(page, 'Bottled Storm');
  await test.step('the library holds it as made', async () => {
    expect(saved).toMatchObject({ type: 'consumable', rar: 'common', target: 'other' });
    expect(saved.tell).toBeUndefined();
    expect(saved.effects[0]).toEqual({ op: 'damage', type: 'physical', amount: { kind: 'dice', count: 2, sides: 6 }, when: 'use' });
    expect(saved.effects[1]).toMatchObject({ op: 'applyStatus', key: 'bleeding', duration: 3000, def: { label: 'Bleeding' } });
  });

  await test.step('Edit shows every field and effect, and Save leaves it equal', async () => {
    await go(page, 'workshop');
    await workshop(page, 'item').locator(`li[data-id="${saved.id}"] [data-act="edit"]`).tap();
    await expect(d.locator('#lf-name')).toHaveValue('Bottled Storm');
    await expect(d.locator('[data-chips="type"] [data-chip="consumable"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(d.locator('[data-chips="target"] [data-chip="other"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(d.locator('.mk-fx')).toHaveCount(2);
    await expect(d.locator('[data-row="0"] [data-f="kind"]')).toHaveValue('damage');
    await expect(d.locator('[data-row="0"] [data-f="q"]')).toHaveValue('2d6');
    await expect(d.locator('[data-row="1"] [data-f="kind"]')).toHaveValue('applyStatus');
    await expect(d.locator('[data-row="1"] [data-f="status"]')).toHaveValue('bleeding');
    await expect(d.locator('[data-row="1"] [data-f="rounds"]')).toHaveValue('3');
    await d.locator('[data-apply]').tap();
    await expect(d).toHaveCount(0);
    expect(await libraryItem(page, 'Bottled Storm')).toEqual(saved);
  });
});

test('a GM makes epic gauntlets from the heavy kit with +2 STR; a hunter who wears them has 9 more armor and 2 more Strength', async ({ device }) => {
  const page = (await device('gm')).page;
  await onboardGM(page);
  const d = itemMaker(page);
  await go(page, 'workshop');
  await workshop(page, 'item').locator('[data-new]').tap();
  await d.locator('#lf-name').fill('Rime Grips');
  await d.locator('[data-chips="type"] [data-chip="armor"]').tap();
  await d.locator('#lf-rar').selectOption('epic');
  await d.getByLabel('Slot').selectOption('hands');
  await d.locator('[data-kit="heavy"]').tap();
  // the heavy kit is weight 32, armor 60, resist 60 (RULES.fight.kits) and hands are a tenth of it (KIT_SHARE), each
  // rounded half up: 3, 6, 6; an epic piece adds its rarity's index, 3, to armor and resist
  await expect(d.locator('[data-gear="weight"]')).toHaveValue('3');
  await expect(d.locator('[data-gear="armor"]')).toHaveValue('9');
  await expect(d.locator('[data-gear="resist"]')).toHaveValue('9');
  await d.locator('[data-bonus="str"]').fill('2');
  await expect(d.locator('.mk-preview')).toContainText('Weight 3 · Armor 9 · Resist 9');
  await expect(d.locator('.mk-preview')).toContainText('Worn: +2 STR');
  await d.locator('[data-apply]').tap();
  await expect(d).toHaveCount(0);

  const grips = await libraryItem(page, 'Rime Grips');
  expect(grips).toMatchObject({ type: 'armor', rar: 'epic', slot: 'hands', weight: 3, armor: 9, resist: 9, bonus: { str: 2 } });

  const sheet = () => page.evaluate(() => { const x = hunterApp.api.hunter.sheet(hunterApp.store.active()); return { armor: x.sheet.armor as number, str: x.stats.str as number }; });
  await page.evaluate(it => hunterApp.api.inventory.addItem(hunterApp.store.active().id, it), grips);
  const before = await sheet();
  await go(page, 'status');
  const equip = page.locator('[data-panel="inventory"] [aria-label="Equip Rime Grips"]');
  await equip.evaluate((el: any) => el.scrollIntoView({ block: 'center' }));
  await equip.tap();
  await expect.poll(sheet).toEqual({ armor: before.armor + 9, str: before.str + 2 });
});

test('in the item maker a consumable shows no slot, no gear numbers and no bonus while worn; a weapon shows them and how it attacks', async ({ device }) => {
  const page = (await device('gm')).page;
  await onboardGM(page);
  const d = itemMaker(page);
  await go(page, 'gm');
  await page.locator('#gm-make [data-make="item"]').tap();
  const worn = [d.getByLabel('Slot'), d.locator('[data-gear="weight"]'), d.locator('[data-bonus="str"]')];
  await d.locator('[data-chips="type"] [data-chip="consumable"]').tap();
  for (const l of worn) await expect(l).toBeHidden();
  await expect(d.locator('[data-chips="attack"]')).toBeHidden();
  await expect(d.locator('[data-quick] [data-q="heal"]')).toBeVisible();
  await d.locator('[data-chips="type"] [data-chip="weapon"]').tap();
  for (const l of worn) await expect(l).toBeVisible();
  await expect(d.getByLabel('Slot')).toHaveValue('weapon');
  await d.locator('#lf-dice').fill('2d6');
  await d.locator('[data-chips="attack"] [data-chip="shot"]').tap();
  // a weapon of two or more dice weighs 4 (weaponWeight): left blank, the weight is the rule's, so a change of the dice moves it
  await expect(d.locator('[data-gear="weight"]')).toHaveValue('');
  await expect(d.locator('[data-gear="weight"]')).toHaveAttribute('placeholder', 'By the rule: 4');
  await expect(d.locator('.mk-preview')).toContainText('Weight 4');
  await expect(d.locator('.mk-preview')).toContainText('Shot with 2d6');
  await d.locator('#lf-dice').fill('1d6');
  await expect(d.locator('.mk-preview')).toContainText('Weight 1');
});

test('on a 390 px phone the item maker\'s grade row, Legendary− to Legendary+, fits the screen with no sideways scroll', async ({ device }) => {
  const page = (await device('gm', { viewport: { width: 390, height: 844 } })).page;
  await onboardGM(page);
  const d = itemMaker(page), grades = d.locator('[data-chips="grade"]');
  await go(page, 'gm');
  await page.locator('#gm-make [data-make="item"]').tap();
  await d.locator('#lf-rar').selectOption('legendary');
  await grades.locator('[data-chip="1"]').tap();
  await expect(grades.locator('[data-chip]')).toHaveText(['Legendary−', 'Legendary', 'Legendary+']);
  await grades.scrollIntoViewIfNeeded();
  const fit = await grades.evaluate(el => ({
    scroll: el.scrollWidth, client: el.clientWidth, page: document.documentElement.scrollWidth - innerWidth,
    inside: [...el.querySelectorAll('[data-chip]')].every(c => { const r = c.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth; }),
  }));
  expect(fit.scroll).toBeLessThanOrEqual(fit.client);
  expect(fit.inside, 'every chip inside the screen').toBe(true);
  expect(fit.page, 'the page does not scroll sideways').toBeLessThanOrEqual(0);
  await page.screenshot({ path: '/tmp/pw-economy-2-grade-390.png' });
});

test('a GM grades an epic item Epic+: the price by the rule is gradeStep times the Clear, a consumable usedUpShare of it, and Edit shows Epic+', async ({ device }) => {
  const page = (await device('gm')).page;
  await onboardGM(page);
  const d = itemMaker(page), grades = d.locator('[data-chips="grade"]'), value = d.locator('#lf-value');
  /** One Clear of the B rank, which prices an epic item: the middle of its loot gold. */
  const clearB = (RULES.loot.B.gold[0]! + RULES.loot.B.gold[1]!) / 2;
  await go(page, 'gm');
  await page.locator('#gm-make [data-make="item"]').tap();

  await test.step('an epic item starts at the middle, priced one Clear', async () => {
    await d.locator('#lf-name').fill('Storm Idol');
    await d.locator('#lf-rar').selectOption('epic');
    await expect(grades.locator('[data-chip]')).toHaveText(['Epic−', 'Epic', 'Epic+']);
    await expect(grades.locator('[data-chip="0"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(value).toHaveAttribute('placeholder', `By the rule: ${Math.round(clearB)}`);
  });

  await test.step('Epic+ costs gradeStep times the Clear, and as a consumable usedUpShare of that', async () => {
    await grades.locator('[data-chip="1"]').tap();
    await expect(value).toHaveAttribute('placeholder', `By the rule: ${Math.round(clearB * RULES.gradeStep)}`);
    await expect(d.locator('.mk-preview')).toContainText('Epic+');
    await d.locator('[data-chips="type"] [data-chip="consumable"]').tap();
    await expect(value).toHaveAttribute('placeholder', `By the rule: ${Math.round(clearB * RULES.gradeStep * RULES.usedUpShare)}`);
    await d.locator('[data-chips="type"] [data-chip="material"]').tap();
    await d.locator('[data-apply]').tap();
    await expect(d).toHaveCount(0);
  });

  const saved = await libraryItem(page, 'Storm Idol');
  await test.step('the library holds it as a plus with no price of its own, and Edit shows Epic+ pressed', async () => {
    expect(saved).toMatchObject({ rar: 'epic', type: 'material', grade: 1 });
    expect(saved.value).toBeUndefined();
    await go(page, 'workshop');
    await workshop(page, 'item').locator(`li[data-id="${saved.id}"] [data-act="edit"]`).tap();
    await expect(grades.locator('[data-chip="1"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(value).toHaveAttribute('placeholder', `By the rule: ${Math.round(clearB * RULES.gradeStep)}`);
  });
});

test('an effect whose amount the formula reader refuses ("abc") shows its error on its row and Save stays off until it is fixed', async ({ device }) => {
  const page = (await device('gm')).page;
  await onboardGM(page);
  const d = statusMaker(page);
  await go(page, 'workshop');
  await workshop(page, 'status').locator('[data-new]').tap();
  await d.locator('[data-name]').fill('Hex');
  await d.locator('[data-add]').tap();
  await d.locator('[data-row="0"] [data-f="q"]').fill('abc');
  await expect(d.locator('[data-row="0"] [data-err]')).toContainText('Unknown name "abc" at character 1.');
  await expect(d.locator('[data-apply]')).toBeDisabled();
  await d.locator('[data-row="0"] [data-f="q"]').fill('1d8');
  await expect(d.locator('[data-row="0"] [data-err]')).toHaveText('');
  await expect(d.locator('[data-apply]')).toBeEnabled();
});

/** A GM and a player in one room, the player's card on the GM's party board. Answers both pages and the player's sheet key. */
async function room(device: (label: string) => Promise<{ page: Page }>): Promise<{ gm: Page; player: Page; key: string }> {
  const gm = (await device('gm')).page, player = (await device('player')).page;
  await onboardGM(gm);
  const code = await createRoom(gm);
  await onboardPlayer(player, 'Mira Test', code);
  await expect.poll(() => player.evaluate(() => hunterApp.api.sync.room())).toBe(code);
  await dismissAll(player, 4);
  await go(gm, 'gm');
  await expect(gm.locator('#gm-board .gm-card.remote', { hasText: 'Mira Test' })).toHaveCount(1);
  const key = await gm.evaluate(() => hunterApp.api.sync.remoteSheets()[0].key as string);
  return { gm, player, key };
}

test('a GM makes a skill from the Skills panel and gives it to a player in the room: the player sees the reward window and the skill in their Skills panel', async ({ device }) => {
  const { gm, player } = await room(device);
  const d = skillMaker(gm);
  await go(gm, 'status');
  await gm.locator('#view-status [data-panel="skills"] [data-new]').tap();
  await d.locator('#skm-name').fill('Ember Step');
  await d.locator('[data-chips="kind"] [data-chip="shot"]').tap();
  await d.locator('[data-chips="give"] [data-chip]', { hasText: 'Mira Test (player)' }).tap();
  await d.locator('[data-apply]').tap();
  await answerWindow(gm, 'Skill acquired');

  await expect(player.locator('.sys-overlay.show', { hasText: 'Skill acquired: Ember Step' })).toBeVisible({ timeout: 15_000 });
  await dismissAll(player, 4);
  await go(player, 'status');
  // the shot kind: quick, at a foe, range 12 (RULES.fight.abilityKinds.shot)
  await expect(player.locator('[data-panel="skills"] [data-skill]', { hasText: 'Ember Step' })).toContainText('Shot, quick · On a foe, 12 tiles');
});

test('the enemy maker shows the body a rank, an archetype and a kind make, and XP follows the rank and kind until the GM types one', async ({ device }) => {
  const page = (await device('gm')).page;
  await onboardGM(page);
  const d = monsterMaker(page);
  await go(page, 'bestiary');
  await page.locator('#view-bestiary [data-new]').tap();
  await d.locator('#enm-name').fill('Glass Golem');
  const body = async () => {
    const m = /HP (\d+) · Armor (\d+) · Resist (\d+) · Speed (\d+)/.exec(await d.locator('[data-derived]').innerText());
    return { hp: Number(m![1]), armor: Number(m![2]), speed: Number(m![4]) };
  };
  const xp = d.locator('#enm-xp');
  await d.locator('[data-chips="rank"] [data-chip="C"]').tap();
  // a normal C monster's XP is the rank table's 250, a boss's three times it (RULES.fight.kinds); left blank, the rule's
  await expect(xp).toHaveValue('');
  await expect(xp).toHaveAttribute('placeholder', 'By the rule: 250');
  const normal = await body();
  await d.locator('[data-chips="kind"] [data-chip="boss"]').tap();
  await expect(xp).toHaveAttribute('placeholder', 'By the rule: 750');
  // a boss has 3.2 bodies of HP where a normal monster has 0.6: within rounding, 16/3 times
  const boss = await body();
  expect(Math.abs(boss.hp - normal.hp * 3.2 / 0.6)).toBeLessThanOrEqual(3);
  await d.locator('[data-chips="archetype"] [data-chip="skirmisher"]').tap();
  // a skirmisher puts its points in Agility and wears the light kit: faster than a brute, with less armor
  const skirmisher = await body();
  expect(skirmisher.speed).toBeGreaterThan(boss.speed);
  expect(skirmisher.armor).toBeLessThan(boss.armor);
  await xp.fill('999');
  await d.locator('[data-chips="rank"] [data-chip="B"]').tap();
  await expect(xp).toHaveValue('999');
  await d.locator('[data-apply]').tap();
  await expect(d).toHaveCount(0);
  const saved = await page.evaluate(() => hunterApp.store.get().monsters.find((m: any) => m.name === 'Glass Golem'));
  expect(saved).toMatchObject({ rank: 'B', archetype: 'skirmisher', kind: 'boss', xp: 999 });
});

test('on a 390 px phone the enemy maker\'s starting status row keeps its × on the line of the status\'s name', async ({ device }) => {
  const page = (await device('gm', { viewport: { width: 390, height: 844 } })).page;
  await onboardGM(page);
  const d = monsterMaker(page);
  await go(page, 'gm');
  await page.locator('#gm-make [data-make="monster"]').tap();
  await d.locator('[data-add="status"]').selectOption('hasted');
  const row = d.locator('[data-statuses] li', { hasText: 'Hasted' });
  await expect(row.getByRole('button', { name: 'Remove Hasted' })).toBeVisible();
  const apart = await row.evaluate((li) => {
    const mid = (el: Element) => { const r = el.getBoundingClientRect(); return r.top + r.height / 2; };
    return Math.abs(mid(li.querySelector('.nm')!) - mid(li.querySelector('button[data-rm]')!));
  });
  expect(apart).toBeLessThan(12);
});

/** Slowed as the rules hold it (src/core/registry/statuses.ts). */
const SLOWED = { label: 'Slowed', desc: 'Moves and acts more slowly.', ops: [{ op: 'speed', pct: [-20, -25, -30, -35, -40, -50] }] };
/**
 * Frost Lance as the library holds it once the GM has made it (a test below makes it through the maker): the shot kind's
 * ability (RULES.fight.abilityKinds.shot, its formula the quick share of 1d8 + phys) that puts Slowed on for 2 rounds.
 */
const FROST_LANCE = {
  id: 's900', name: 'Frost Lance', type: 'active', level: 1, label: null, desc: 'A spear of ice.',
  ability: {
    id: 'frost-lance', name: 'Frost Lance', kind: 'shot', cost: { fatigue: 6, mana: 0, time: 70, cooldown: 0 }, aim: 'foe', range: 12,
    shape: { kind: 'line', width: 0, pierce: false }, delivery: { kind: 'travel', windup: 100, speed: 80 }, foesOnly: true,
    // made with the shot's own ticks, so it follows the rule: `0.7 * (1d8 + phys)` worked out where it is read (M2)
    effect: { type: 'physical', by: 'rule', ticks: { scale: 'str', gap: null, scalers: [] } },
    ops: [{ op: 'applyStatus', key: 'slowed', def: SLOWED, duration: 2000 }], channel: null,
  },
};
const FROST_SHARD = { id: 'i900', name: 'Frost Shard', rar: 'rare', type: 'material', slot: null, qty: 1, dice: '', bonus: {}, value: 40, desc: 'Cold to the touch.', weight: 0, armor: 0, resist: 0 };

test('a GM makes the monster Ice Warden in at most 9 taps from the home screen: it holds Frost Lance, starts Hasted and drops its loot, and in a fight it starts Hasted', async ({ device }) => {
  const page = (await device('gm')).page;
  await onboardGM(page);
  await page.evaluate(([k, i]) => hunterApp.store.update((d: any) => { d.library.skills.push(k); d.library.items.push(i); }, 'test-setup'), [FROST_LANCE, FROST_SHARD] as const);
  const t = tapCounter(), d = monsterMaker(page);

  await test.step('the GM makes it: rank C, a caster, Frost Lance, Hasted at the start, 50 gold and a Frost Shard', async () => {
    await makeFromHome(page, t, 'monster');
    await t.tap(d.locator('#enm-name'));
    await d.locator('#enm-name').fill('Ice Warden');
    await t.tap(d.locator('[data-chips="rank"] [data-chip="C"]'));
    await t.tap(d.locator('[data-chips="archetype"] [data-chip="caster"]'));
    await d.locator('[data-add="ability"]').selectOption('lib:s900'); t.selected();
    await d.locator('[data-add="status"]').selectOption('hasted'); t.selected();
    await t.tap(d.locator('#enm-gold'));
    await d.locator('#enm-gold').fill('50');
    await d.locator('[data-add="item"]').selectOption('lib:i900'); t.selected();
    const preview = d.locator('.mk-preview');
    await expect(preview).toContainText('C-rank normal caster');
    await expect(preview).toContainText('Curse: Curse, standard · On a foe, 8 tiles');
    // a monster's ability is read at its rank: Slowed at C is −30%
    await expect(preview).toContainText('Frost Lance: Shot, quick · On a foe, 12 tiles; Costs 6 fatigue');
    await expect(preview).toContainText('Applies Slowed (2 rounds): Speed −30%');
    await expect(preview).toContainText('Starts with: Hasted (3 rounds)');
    await expect(preview).toContainText('Drops: 50 gold, Frost Shard');
    await t.tap(d.locator('[data-apply]'));
    await expect(d).toHaveCount(0);
    expect(t.count).toBeLessThanOrEqual(9);
  });

  const warden = await page.evaluate(() => hunterApp.store.get().monsters.find((m: any) => m.name === 'Ice Warden'));
  await test.step('the bestiary holds it as made', async () => {
    // its XP is left blank, so it is the XP table's (250 for a normal C monster), read and not stored (V9 B1)
    expect(warden.xp).toBeUndefined();
    expect(warden).toMatchObject({ rank: 'C', archetype: 'caster', kind: 'normal', statuses: [{ key: 'hasted', rounds: 3 }], loot: { gold: 50, items: [{ name: 'Frost Shard', qty: 1 }] } });
    expect(warden.abilities).toEqual([FROST_LANCE.ability]);
  });

  await test.step('added to a fight from its Bestiary card, it starts Hasted', async () => {
    await go(page, 'bestiary');
    await page.locator(`#view-bestiary [data-addc="${warden.id}"]`).tap();
    await expect.poll(async () => ((await row(page, 'Ice Warden'))?.statuses ?? []).map((s: any) => s.key)).toEqual(['hasted']);
  });
});

test('a GM makes Frost Lance in at most 9 taps from the home screen: a shot that slows for 2 rounds, in the library and on Brakk', async ({ device }) => {
  const page = (await device('gm')).page;
  await onboardGM(page);
  const t = tapCounter(), d = skillMaker(page);

  await test.step('the GM makes it from the Skills panel: the shot kind, its formula read only, Slowed for 2 rounds', async () => {
    await t.tap(page.locator('#view-status [data-jump="skills"]'));
    await t.tap(page.locator('#view-status [data-panel="skills"] [data-new]'));
    await t.tap(d.locator('#skm-name'));
    await d.locator('#skm-name').fill('Frost Lance');
    await t.tap(d.locator('[data-chips="kind"] [data-chip="shot"]'));
    // a quick action deals 0.7 of a standard one (RULES.fight.cost)
    await expect(d.locator('[data-formula]')).toHaveValue('0.7 * (1d8 + phys)');
    await expect(d.locator('[data-edited]')).toBeHidden();
    await t.tap(d.locator('[data-quick] [data-q="apply"]'));
    await d.locator('[data-row="0"] [data-f="status"]').selectOption('slowed'); t.selected();
    await t.tap(d.locator('[data-row="0"] [data-f="rounds"]'));
    await d.locator('[data-row="0"] [data-f="rounds"]').fill('2');
    await expect(d.locator('[data-chips="give"] [data-chip]', { hasText: 'Brakk Ironhide' })).toHaveAttribute('aria-pressed', 'true');
    const preview = d.locator('.mk-preview');
    await expect(preview).toContainText('Shot, quick · On a foe, 12 tiles');
    await expect(preview).toContainText('Applies Slowed (2 rounds): Speed −20% / −25% / −30% / −35% / −40% / −50%, by rank E to S');
    await t.tap(d.locator('[data-apply]'));
    await expect(d).toHaveCount(0);
    expect(t.count).toBeLessThanOrEqual(9);
    await answerWindow(page, 'Skill acquired');
  });

  await test.step('the library holds it as made, and Brakk has the same skill', async () => {
    const lance = await page.evaluate(() => hunterApp.store.get().library.skills.find((k: any) => k.name === 'Frost Lance'));
    const { id: _, ...made } = FROST_LANCE;
    // the ability's id is made by the store when the skill is made (skills.js `ownId`), not from its name
    expect({ ...lance, id: undefined, desc: made.desc, ability: { ...lance.ability, id: undefined } }).toEqual({ ...made, id: undefined, ability: { ...made.ability, id: undefined } });
    expect(lance.ability.id).toMatch(/^ab\d+$/);
    const brakk = await page.evaluate(() => hunterApp.store.get().hunters.find((h: any) => h.name === 'Brakk Ironhide').skills.find((k: any) => k.name === 'Frost Lance'));
    expect(brakk.ability).toEqual(lance.ability);
  });
});

test('in the skill maker a support reaches an ally or only the user, and another kind does not ask', async ({ device }) => {
  const page = (await device('gm')).page;
  await onboardGM(page);
  const d = skillMaker(page);
  await go(page, 'gm');
  await page.locator('#gm-make [data-make="skill"]').tap();
  await d.locator('#skm-name').fill('Ward');
  const affects = d.locator('[data-chips="aim"]');
  await expect(affects).toBeHidden();
  await d.locator('[data-chips="kind"] [data-chip="support"]').tap();
  await expect(affects).toBeVisible();
  // a support reaches an ally 6 tiles off (RULES.fight.abilityKinds.support) and shields 1.5 * sup (ability-kinds.ts)
  await expect(d.locator('.mk-preview')).toContainText('Support, standard · On an ally, 6 tiles');
  await expect(d.locator('[data-formula]')).toHaveValue('1.5 * sup');
  await expect(d.locator('[data-chips="ftype"] [data-chip="shield"]')).toHaveAttribute('aria-pressed', 'true');
  await affects.locator('[data-chip="self"]').tap();
  await expect(d.locator('.mk-preview')).toContainText('Support, standard · On the user');
  await d.locator('[data-chips="kind"] [data-chip="curse"]').tap();
  await expect(affects).toBeHidden();
  await expect(d.locator('.mk-preview')).toContainText('Curse, standard · On a foe, 8 tiles');
});

test('in the skill maker the form holds still after the GM types a formula, so a name chip tapped a moment later puts its name in', async ({ device }) => {
  const page = (await device('gm', { viewport: { width: 390, height: 844 } })).page;
  await onboardGM(page);
  await go(page, 'gm');
  await page.locator('#gm-make [data-make="skill"]').tap();
  const d = skillMaker(page), field = d.locator('[data-formula]'), names = d.locator('[data-group="names"]');
  await d.locator('[data-chips="kind"] [data-chip="curse"]').tap();
  await names.locator('> summary').tap();
  await names.locator('[data-name-key]').selectOption('prone');
  await page.clock.install();
  await field.fill('2d6 + ');
  const chip = names.locator('[data-insert="target.stacks(KEY)"]');
  await chip.scrollIntoViewIfNeeded();
  const aimed = await chip.boundingBox();
  await page.clock.runFor(1000);
  expect(await chip.boundingBox()).toEqual(aimed);
  await chip.tap();
  await expect(field).toHaveValue('2d6 + target.stacks(prone)');
});

test('a press beside an edited maker or Escape asks before it drops the GM\'s work; Escape on that question closes only the question; an untouched maker just closes', async ({ device }) => {
  const page = (await device('gm', { viewport: { width: 390, height: 844 } })).page;
  await onboardGM(page);
  await go(page, 'gm');
  const d = statusMaker(page), ask = page.getByRole('alertdialog', { name: 'Discard changes?' });
  await page.locator('#gm-make [data-make="status"]').tap();
  await expect(d).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(d).toHaveCount(0);
  await expect(ask).toHaveCount(0);

  await page.locator('#gm-make [data-make="status"]').tap();
  await d.locator('[data-name]').fill('Half-built');
  await page.locator('.fg-overlay').click({ position: { x: 3, y: 420 } });
  await expect(ask).toBeVisible();
  await ask.getByRole('button', { name: 'Cancel' }).tap();
  await expect(ask).toHaveCount(0);
  await expect(d.locator('[data-name]')).toHaveValue('Half-built');

  await d.locator('[data-name]').press('Escape');
  await expect(ask).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(ask).toHaveCount(0);
  await expect(d.locator('[data-name]')).toHaveValue('Half-built');

  await page.keyboard.press('Escape');
  await ask.getByRole('button', { name: 'Discard' }).tap();
  await expect(d).toHaveCount(0);
  expect(await page.evaluate(() => Object.values(hunterApp.store.get().library.statuses).map((s: any) => s.label))).toEqual([]);
});

test('when the phone\'s keyboard opens under a maker, the field the GM is typing in stays in view above it', async ({ device }) => {
  const page = (await device('gm', { viewport: { width: 390, height: 844 } })).page;
  await onboardGM(page);
  await go(page, 'gm');
  await page.locator('#gm-make [data-make="skill"]').tap();
  const d = skillMaker(page), cost = d.locator('[data-group="cost"]'), cooldown = d.locator('#skm-cd');
  await cost.locator('> summary').tap();
  await cooldown.evaluate(el => el.scrollIntoView({ block: 'end' }));
  await cooldown.tap();
  await expect(cooldown).toBeFocused();
  await page.setViewportSize({ width: 390, height: 400 });
  await expect(cooldown).toBeInViewport({ ratio: 1 });
});

test('a GM gives a library skill to a player in the room from the Workshop, and the player\'s Skills panel shows it', async ({ device }) => {
  const { gm, player } = await room(device);
  await gm.evaluate(k => hunterApp.store.update((d: any) => { d.library.skills.push(k); }, 'test-setup'), FROST_LANCE);
  await go(gm, 'workshop');
  await workshop(gm, 'skill').locator('li', { hasText: 'Frost Lance' }).locator('[data-act="give"]').tap();
  await answerWindow(gm, 'Give Frost Lance to', 'Mira Test (player)');

  await expect(player.locator('.sys-overlay.show', { hasText: 'Skill acquired: Frost Lance' })).toBeVisible({ timeout: 15_000 });
  await dismissAll(player, 4);
  await go(player, 'status');
  await expect(player.locator('[data-panel="skills"] [data-skill]', { hasText: 'Frost Lance' })).toContainText('Applies Slowed (2 rounds)');
});

test('the Workshop says what an empty kind is, lists the GM\'s status, item, skill and monster, and Delete under ⋯ removes the skill', async ({ device }) => {
  const page = (await device('gm')).page;
  await onboardGM(page);
  await go(page, 'workshop');
  await test.step('with no skill made, the Skills section says what a skill is and shows New skill', async () => {
    await expect(workshop(page, 'skill').locator('.ws-empty')).toHaveText('A skill is an ability a hunter or a monster uses in a fight: a strike, a shot, a blast, a curse or a support, which can hurt, heal, shield or put on a status.');
    await expect(workshop(page, 'skill').locator('[data-new]')).toHaveText('New skill');
  });

  await page.evaluate(([k, i]) => hunterApp.store.update((d: any) => {
    d.library.skills.push(k); d.library.items.push(i);
    d.library.statuses.frostbite = { label: 'Frostbite', desc: 'Cold bites.', ops: [{ op: 'damage', type: 'magical', amount: { kind: 'dice', count: 1, sides: 6 } }] };
    d.monsters.push({ id: 'm900', name: 'Ice Warden', rank: 'C', type: '', archetype: 'caster', kind: 'normal', tweak: {}, abilities: [], notes: [], xp: 250, extractable: true, desc: '', statuses: [], loot: { gold: 0, items: [] } });
  }, 'test-setup'), [FROST_LANCE, FROST_SHARD] as const);

  await test.step('each section lists the GM\'s own', async () => {
    await expect(workshop(page, 'status').locator('.ws-list li', { hasText: 'Frostbite' })).toContainText('1d6 magical damage a round');
    await expect(workshop(page, 'item').locator('li', { hasText: 'Frost Shard' })).toHaveCount(1);
    await expect(workshop(page, 'skill').locator('li', { hasText: 'Frost Lance' })).toHaveCount(1);
    await expect(workshop(page, 'monster').locator('li', { hasText: 'Ice Warden' })).toContainText('C-rank normal caster');
  });

  await test.step('a tap on the skill\'s row opens it in the skill maker, with Duplicate, Share and Delete not on the row', async () => {
    const row = workshop(page, 'skill').locator('li', { hasText: 'Frost Lance' });
    for (const a of ['dup', 'share', 'del']) await expect(row.locator(`[data-act="${a}"]`)).toHaveCount(0);
    await row.locator('.nm').tap();
    await expect(skillMaker(page).locator('#skm-name')).toHaveValue('Frost Lance');
    await skillMaker(page).locator('[data-cancel]').tap();
    await expect(skillMaker(page)).toHaveCount(0);
  });

  await test.step('Delete under ⋯ on the skill, a danger button, confirmed, removes it from the list and the library', async () => {
    await workshop(page, 'skill').locator('li', { hasText: 'Frost Lance' }).getByRole('button', { name: 'More for Frost Lance' }).tap();
    await expect(page.locator('.sys-overlay.show .sys-actions button', { hasText: 'Delete' })).toHaveClass(/danger/);
    await underMore(page, 'Delete');
    await answerWindow(page, 'Delete from library?', 'Delete');
    await expect(workshop(page, 'skill').locator('li', { hasText: 'Frost Lance' })).toHaveCount(0);
    await expect(workshop(page, 'skill').locator('.ws-empty')).toBeVisible();
    expect(await page.evaluate(() => hunterApp.store.get().library.skills.length)).toBe(0);
  });
});

test('a skill renamed and given another kind in the skill maker keeps its ability\'s id, so its pins, cooldown and uses stay with it', async ({ device }) => {
  const page = (await device('gm')).page;
  await onboardGM(page);
  await go(page, 'workshop');
  await page.evaluate(k => hunterApp.store.update((d: any) => { d.library.skills.push(k); }, 'test-setup'), FROST_LANCE);
  await workshop(page, 'skill').locator('li', { hasText: 'Frost Lance' }).locator('.nm').tap();
  const d = skillMaker(page);
  await d.locator('#skm-name').fill('Frost Spear');
  await d.locator('[data-chips="kind"] [data-chip="curse"]').tap();
  await expect(d.locator('.mk-preview')).toContainText('Curse');
  await d.locator('[data-apply]').tap();
  await expect(d).toHaveCount(0);
  const spear = await page.evaluate(() => hunterApp.store.get().library.skills.find((k: any) => k.name === 'Frost Spear'));
  expect([spear.ability.kind, spear.ability.id]).toEqual(['curse', FROST_LANCE.ability.id]);
});

test('the skill maker refuses a reaction that would push: the GM is told why and nothing is saved', async ({ device }) => {
  const page = (await device('gm')).page;
  await onboardGM(page);
  await go(page, 'workshop');
  await workshop(page, 'skill').locator('[data-new]').tap();
  const d = skillMaker(page);
  await d.locator('#skm-name').fill('Shove Back');
  await d.locator('[data-chips="kind"] [data-chip="strike"]').tap();
  await d.locator('[data-fx] [data-add]').tap();
  await d.locator('[data-fx] [data-row="0"] [data-f="kind"]').selectOption('shove');
  await d.locator('[data-sum="react"]').tap();
  await d.locator('[data-f="react"]').check();
  await d.locator('[data-apply]').tap();
  await expect(d.getByText('A reaction cannot push, pull or give an extra action.', { exact: false })).toBeVisible();
  expect(await page.evaluate(() => hunterApp.store.get().library.skills.length)).toBe(0);
});

const rewardMaker = (page: Page) => page.locator('.rwm-overlay [role=dialog]');
const bundles = (page: Page) => page.evaluate(() => hunterApp.store.get().library.rewards.map((b: any) => ({ name: b.name, gold: b.rewards.gold })));

test('the Workshop\'s Bundles: New opens the reward editor alone, Duplicate copies, a tap on the row edits and renames, Delete removes', async ({ device }) => {
  const page = (await device('gm')).page;
  await onboardGM(page);
  await go(page, 'workshop');
  const sec = workshop(page, 'bundle'), row = (name: string) => sec.locator('.ws-list li').filter({ has: page.locator('.nm', { hasText: new RegExp(`^${name.replace(/[()]/g, '\\$&')}$`) }) });

  await test.step('with none saved, the section says what a reward bundle is', async () => {
    await expect(sec.locator('.ws-empty')).toContainText('A bundle is a reward you saved to give again');
  });

  await test.step('New bundle: a name and 25 gold, saved, and listed with its line', async () => {
    await sec.locator('[data-new]').tap();
    await expect(rewardMaker(page)).toBeVisible();
    await rewardMaker(page).locator('#rwm-name').fill('Goblin purse');
    await rewardMaker(page).locator('[data-n="gold"]').fill('25');
    await expect(rewardMaker(page).locator('.rw-preview')).toContainText('+25 gold');
    await rewardMaker(page).locator('[data-apply]').tap();
    await expect(row('Goblin purse')).toContainText('+25 gold');
    expect(await bundles(page)).toEqual([{ name: 'Goblin purse', gold: 25 }]);
  });

  await test.step('Duplicate makes "Goblin purse (copy)"; its Edit renames it "Big purse" with 99 gold, and the copy\'s old name is gone', async () => {
    await row('Goblin purse').locator('[data-act="more"]').tap();
    await underMore(page, 'Duplicate');
    await expect(row('Goblin purse (copy)')).toHaveCount(1);
    await row('Goblin purse (copy)').locator('.nm').tap();
    await rewardMaker(page).locator('#rwm-name').fill('Big purse');
    await rewardMaker(page).locator('[data-n="gold"]').fill('99');
    await rewardMaker(page).locator('[data-apply]').tap();
    await expect(row('Big purse')).toContainText('+99 gold');
    expect(await bundles(page)).toEqual([{ name: 'Goblin purse', gold: 25 }, { name: 'Big purse', gold: 99 }]);
  });

  await test.step('Delete on Big purse, confirmed, leaves Goblin purse alone', async () => {
    await row('Big purse').locator('[data-act="more"]').tap();
    await underMore(page, 'Delete');
    await answerWindow(page, 'Delete bundle?', 'Delete');
    await expect(row('Big purse')).toHaveCount(0);
    expect(await bundles(page)).toEqual([{ name: 'Goblin purse', gold: 25 }]);
  });
});

test('a quest whose reward is made in the reward editor pays it on completion, the boon included, and Enter in a reward field does not save the quest early', async ({ device }) => {
  const page = (await device('gm')).page;
  await onboardGM(page);
  await go(page, 'quests');
  const form = page.locator('#view-quests form[data-form]'), ed = form.locator('[data-rweditor]');
  const before = await page.evaluate(() => { const h = hunterApp.store.active(); return { id: h.id as string, gold: h.gold as number }; });

  await test.step('the GM writes the quest, 40 gold and the boon "Guild favor", for the active hunter; Enter in the boon\'s name and in the gold leaves the form open', async () => {
    await page.locator('#view-quests [data-new]').tap();
    await form.locator('[name="title"]').fill('Hunt the alpha');
    await form.locator('#qf-gold').fill('40');
    await ed.locator('[data-add="boon"]').tap();
    await ed.locator('[data-kind="boon"] [data-f="name"]').fill('Guild favor');
    await ed.locator('[data-kind="boon"] [data-f="text"]').fill('The guild owes you one.');
    await ed.locator('[data-kind="boon"] [data-f="name"]').press('Enter');
    await ed.locator('#qf-gold').press('Enter');
    await expect(form).toBeVisible();
    await expect(page.locator('#view-quests .qc', { hasText: 'Hunt the alpha' })).toHaveCount(0);
    await expect(ed.locator('.rw-preview li')).toHaveText(['+40 gold', 'Boon: Guild favor']);
    await form.locator('button[type="submit"]').tap();
    await expect(page.locator('#view-quests .qc', { hasText: 'Hunt the alpha' })).toContainText('Boon: Guild favor');
  });

  await test.step('completed, the quest window lists the reward, and the hunter has the gold and the boon', async () => {
    await page.locator('#view-quests .qc', { hasText: 'Hunt the alpha' }).locator('[data-done]').tap();
    await answerWindow(page, 'Complete quest?', 'Complete');
    await expect(page.locator('.sys-overlay.show')).toContainText('Boon: Guild favor');
    await dismissAll(page, 4);
    const h = await page.evaluate(id => hunterApp.store.hunter(id), before.id);
    expect(h.gold).toBe(before.gold + 40);
    expect(h.boons.map((b: any) => [b.name, b.text])).toEqual([['Guild favor', 'The guild owes you one.']]);
  });
});

test('on a 390 px phone the reward editor with a row of each kind scrolls only up and down, and every control is at least 44 px tall', async ({ device }) => {
  const page = (await device('gm')).page;
  await onboardGM(page);
  await go(page, 'gm');
  const toggle = page.locator('[data-tog="award"]');
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.tap();
  const ed = page.locator('#gm-rw');
  for (const k of ['item', 'title', 'skill', 'status', 'boon', 'job']) await ed.locator(`[data-add="${k}"]`).tap();
  await ed.locator('[data-kind="item"] [data-f="pick"]').selectOption({ label: 'Health Potion (common)' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  const short = await ed.evaluate(box => [...box.querySelectorAll('button, input:not([type=checkbox]), select, .rw-chk')]
    .filter(el => (el as HTMLElement).offsetParent !== null && el.getBoundingClientRect().height < 44)
    .map(el => `${el.tagName} ${el.getAttribute('data-f') || el.getAttribute('data-add') || el.className} ${el.getBoundingClientRect().height}`));
  expect(short).toEqual([]);
});

// ── milestone 4: the formula field, the ability form, every op kind, read back from the save and from a fight ──
// The fight steps run what the maker saved through the real reducer (src/core/combat/fight.ts, resolve.ts) in the test's
// own process, so they read the fight's rules and not the fight screen's markup.

const C_LEVEL = RULES.rankLevels.C;
/** A C-rank hunter's origin: 63 in `main`, 33 in `second` (the paper's C builds, design table 2.1), in `kit`. */
const cHunter = (main: StatKey, second: StatKey, kit: Kit): Origin =>
  ({ kind: 'hunter', build: { stats: { ...baseStats(RULES.fight), [main]: 63, [second]: 33 }, level: C_LEVEL, gear: kitGear(kit, RULES), perks: {} } });
/** A row of a new fight standing on `at`. */
function newRow(name: string, side: 'party' | 'foe', origin: Origin, at: Place, abilities: Ability[] = []): NewRow {
  const { sheet } = modified(origin, [], RULES);
  return {
    id: combatantId(name), name, side, kind: side === 'party' ? 'hunter' : 'monster', origin, tier: 2, place: at, life: { at: 'up', hp: sheet.hpMax }, mana: sheet.manaMax, fatigue: 0,
    shield: null, stagger: null, channel: null, threat: side === 'foe' ? {} : null, statuses: [], readyAt: {}, abilities, intent: null, holder: null, xp: 0,
  } as NewRow;
}
const ctx: Ctx = { rules: RULES };
/** Plays commands from no fight; a refusal fails the test. */
function play(...commands: Command[]): Fight {
  let fight: Fight | null = null;
  for (const cmd of commands) {
    const r = reduce(fight, cmd, ctx), no = r.effects.find(e => e.type === 'refused');
    if (no) throw new Error(`${cmd.type} refused: ${JSON.stringify(no)}`);
    fight = r.fight;
  }
  return fight!;
}
/** One more command on `f`; a refusal fails the test. */
const then = (f: Fight, cmd: Command): Fight => {
  const r = reduce(f, cmd, ctx), no = r.effects.find(e => e.type === 'refused');
  if (no) throw new Error(`${cmd.type} refused: ${JSON.stringify(no)}`);
  return r.fight!;
};
const rowIn = (f: Fight, name: string) => f.rows.find(r => r.id === name)!;
/** A as the party's only hunter and M as one foe, A first. */
const duel = (a: NewRow, m: NewRow): Command[] => [
  { type: 'add', fightId: fightId('f-m4'), rows: [a, m], openings: [] },
  { type: 'start', openings: [{ id: combatantId('A'), d20: 20, tie: 0 }, { id: combatantId('M'), d20: 1, tie: 0 }] },
];
const pass = (by: string): Command => ({ type: 'endTurn', by: combatantId(by) });
const librarySkill = (page: Page, name: string) => page.evaluate(n => hunterApp.store.get().library.skills.find((k: any) => k.name === n), name);
const libraryStatus = (page: Page, label: string) => page.evaluate(l => Object.entries(hunterApp.store.get().library.statuses).find(([, d]: any) => d.label === l), label) as Promise<[string, StatusDef]>;
const formulaOf = (text: string) => { const p = parseFormula(text, RULES); if (!p.ok) throw new Error(p.error); return p.formula; };

test('a GM ticks "scales with Power" and "aimed at Resist" and saves the recommended formula; typed over it is marked edited, broken it blocks Save, and Reset brings the recommendation back', async ({ device }) => {
  const page = (await device('gm')).page;
  await onboardGM(page);
  const d = skillMaker(page), field = d.locator('[data-formula]');
  await go(page, 'gm');
  await page.locator('#gm-make [data-make="skill"]').tap();
  await d.locator('#skm-name').fill('Mind Spike');

  await test.step('the ticks build the recommendation: a strike aimed at Resist that scales with Power reads 1d8 + mag', async () => {
    await d.locator('[data-chips="ftype"] [data-chip="magical"]').tap();
    await d.locator('[data-group="ticks"] > summary').tap();
    await d.locator('[data-tick="scale"]').selectOption('pow');
    // magical damage meets Resist and its power is mag, 0.6 times the curve of Power (design 2.2, ability-kinds.ts)
    await expect(field).toHaveValue('1d8 + mag');
    await expect(d.locator('[data-edited]')).toBeHidden();
    await expect(d.locator('[data-formula-avg]')).toContainText('after its Resist');
  });

  await test.step('typed over, the field is marked edited and Reset shows', async () => {
    await field.fill('2d8 + mag');
    await expect(d.locator('[data-edited]')).toBeVisible();
    await expect(d.locator('[data-reset]')).toBeVisible();
  });

  await test.step('a name the parser cannot read shows its words under the field and turns Save off', async () => {
    await field.fill('2d8 + magic');
    await expect(d.locator('[data-formula-err]')).toContainText('Unknown name "magic" at character 7.');
    await expect(d.locator('[data-apply]')).toBeDisabled();
  });

  await test.step('Reset returns to the recommendation, unmarked, and Save keeps it', async () => {
    await d.locator('[data-reset]').tap();
    await expect(field).toHaveValue('1d8 + mag');
    await expect(d.locator('[data-edited]')).toBeHidden();
    await expect(d.locator('[data-formula-err]')).toHaveText('');
    await d.locator('[data-apply]').tap();
    await expect(d).toHaveCount(0);
    const spike = await librarySkill(page, 'Mind Spike');
    expect(spike.ability.effect, 'a reset formula follows the rule: its ticks are kept, never its text').toEqual({ type: 'magical', by: 'rule', ticks: { scale: 'pow', gap: null, scalers: [] } });
    expect(formulaNow(spike.ability, RULES)).toEqual(formulaOf('1d8 + mag'));
  });
});

test('a formula the GM typed stays when the ability\'s kind changes, marked edited, and Reset gives the new kind\'s recommendation', async ({ device }) => {
  const page = (await device('gm')).page;
  await onboardGM(page);
  const d = skillMaker(page), field = d.locator('[data-formula]');
  await go(page, 'gm');
  await page.locator('#gm-make [data-make="skill"]').tap();
  await d.locator('#skm-name').fill('Twin Fang');
  await d.locator('[data-chips="kind"] [data-chip="strike"]').tap();
  await field.fill('3d6 + phys');
  await d.locator('[data-chips="kind"] [data-chip="shot"]').tap();
  await expect(field).toHaveValue('3d6 + phys');
  await expect(d.locator('[data-edited]')).toBeVisible();
  await d.locator('[data-reset]').tap();
  // a shot is quick: its share of the budget scales the 1d8 + phys a strike recommends (ability-kinds.ts KINDS, RULES.fight.cost)
  await expect(field).toHaveValue(recommended('shot', defaultTicks('shot', 'physical'), RULES).text);
  await expect(d.locator('[data-edited]')).toBeHidden();
});

test('a formula field holds whatever the maker writes in it: the GM types on at the end of the longest formula the rule builds, and a status\'s damage takes more than 60 characters', async ({ device }) => {
  const page = (await device('gm')).page;
  await onboardGM(page);

  await test.step('the rule builds a formula of more than 200 characters, and the GM types on at its end', async () => {
    const d = skillMaker(page), field = d.locator('[data-formula]');
    await go(page, 'gm');
    await page.locator('#gm-make [data-make="skill"]').tap();
    await d.locator('#skm-name').fill('Long Cut');
    await d.locator('[data-group="ticks"] > summary').tap();
    await d.locator('[data-tick="scale"]').selectOption('agi');
    await d.locator('[data-tick="gap"]').check();
    await d.locator('[data-add-scaler]').tap();
    await d.locator('[data-add-scaler]').tap();
    await d.locator('[data-sc="0"] [data-sc-f="name"]').selectOption('underdog');
    await d.locator('[data-sc="1"] [data-sc-f="name"]').selectOption('underdog');
    await expect.poll(async () => (await field.inputValue()).length, 'the rule\'s formula is longer than the 200 characters the field once took').toBeGreaterThan(200);
    const rule = await field.inputValue();
    await field.focus();
    await field.press('End');
    await field.pressSequentially(' + 1');
    await expect(field).toHaveValue(`${rule} + 1`);
    await expect(d.locator('[data-edited]')).toBeVisible();
    await expect(d.locator('[data-formula-err]')).toHaveText('');
    await d.locator('[data-apply]').tap();
    await expect(d).toHaveCount(0);
    const cut = await librarySkill(page, 'Long Cut');
    expect(formulaNow(cut.ability, RULES)).toEqual(formulaOf(`${rule} + 1`));
  });

  await test.step('a status\'s damage typed past 60 characters is kept whole', async () => {
    const d = statusMaker(page), amount = '0.05 * hpMax + 0.05 * target.hpMax + 0.02 * manaMax + 0.01 * target.manaMax';
    expect(amount.length).toBeGreaterThan(60);
    await go(page, 'workshop');
    await workshop(page, 'status').locator('[data-new]').tap();
    await d.locator('[data-name]').fill('Wither');
    await d.locator('[data-add]').tap();
    await d.locator('[data-row="0"] [data-f="q"]').pressSequentially(amount);
    await expect(d.locator('[data-row="0"] [data-f="q"]')).toHaveValue(amount);
    await expect(d.locator('[data-row="0"] [data-err]')).toHaveText('');
    await d.locator('[data-apply]').tap();
    await expect(d).toHaveCount(0);
    const ops = await page.evaluate(() => hunterApp.store.get().library.statuses.wither.ops);
    expect(ops).toEqual([{ op: 'damage', type: 'physical', amount: formulaOf(amount) }]);
  });
});

test('a GM makes a status that slows by 30% and roots; on a monster in a fight its speed falls to 0.7 of what it was and it cannot move', async ({ device }) => {
  const page = (await device('gm')).page;
  await onboardGM(page);
  const d = statusMaker(page);
  await go(page, 'workshop');
  await workshop(page, 'status').locator('[data-new]').tap();
  await d.locator('[data-name]').fill('Frozen Snare');
  await d.locator('[data-quick] [data-q="slow"]').tap();
  await d.locator('[data-row="0"] [data-f="q"]').fill('-30');
  await d.locator('[data-quick] [data-q="root"]').tap();
  await expect(d.locator('.mk-preview')).toContainText('Speed −30%');
  await expect(d.locator('.mk-preview')).toContainText('Cannot move');
  await d.getByRole('button', { name: 'Save status' }).tap();
  await expect(d).toHaveCount(0);

  const wolf = await fightWith(page, 'E'), before = await row(page, wolf);
  await statusOn(page, wolf);
  await statusMaker(page).locator('[data-existing] [data-chip="frozen-snare"]').tap();
  await expect(card(page, wolf)).toContainText('Speed −30%');
  const after = await row(page, wolf);
  // a slow multiplies speed by 1 - 30/100 before it is rounded (derive.ts); a root sets move to 0 (effect-ops.ts `modified`)
  expect(Math.abs(after.speed - before.speed * 0.7)).toBeLessThanOrEqual(1);
  expect([before.sheet.move > 0, after.sheet.move]).toEqual([true, 0]);
});

test('a GM makes a blast with a ring and a 1 round wind-up; in a fight a fast target gets out of it and a slow one is caught', async ({ device }) => {
  const page = (await device('gm')).page;
  await onboardGM(page);
  const d = skillMaker(page);
  await go(page, 'gm');
  await page.locator('#gm-make [data-make="skill"]').tap();
  await d.locator('#skm-name').fill('Frost Nova');
  await d.locator('[data-chips="kind"] [data-chip="blast"]').tap();
  await d.locator('[data-group="reach"] > summary').tap();
  await expect(d.locator('[data-a="ring"]')).toBeChecked();
  await d.locator('[data-a="radius"]').fill('2');
  await d.locator('[data-a="outer"]').fill('3');
  await d.locator('[data-a="share"]').fill('50');
  await d.locator('[data-group="avoid"] > summary').tap();
  await d.locator('[data-chips="delivery"] [data-chip="travel"]').tap();
  await d.locator('[data-a="windup"]').fill('1');
  await expect(d.locator('.mk-preview')).toContainText('Hits everyone within 2 tiles of a point up to 10 tiles away, and 50% in a ring out to 3 tiles.');
  await expect(d.locator('.mk-preview')).toContainText('Can be dodged: it lands 1 round after it is used');
  await d.locator('[data-apply]').tap();
  await expect(d).toHaveCount(0);

  const nova: Ability = (await librarySkill(page, 'Frost Nova')).ability;
  expect([nova.shape, nova.delivery]).toEqual([{ kind: 'radius', radius: 2, ring: { outer: 3, share: 50 } }, { kind: 'travel', windup: 1000, speed: 'instant' }]);
  // the C speed build (Agility 63, light kit) walks 8 tiles a round and the C tank (Vitality 63, heavy kit) 4 (design 4.6):
  // in the round the blast takes to land, a d20 of 20 carries the fast one the 4 tiles out of the ring, and a d20 of 1
  // leaves the slow one in it
  const caster = newRow('A', 'party', cHunter('pow', 'ctl', 'light'), place(2, 6), [nova]);
  const fast = newRow('F', 'foe', cHunter('agi', 'str', 'light'), place(9, 6)), slow = newRow('S', 'foe', cHunter('vit', 'str', 'heavy'), place(9, 7));
  const f = play({ type: 'add', fightId: fightId('f-m4'), rows: [caster, fast, slow], openings: [] },
    { type: 'start', openings: [{ id: combatantId('A'), d20: 20, tie: 0 }, { id: combatantId('F'), d20: 1, tie: 0 }, { id: combatantId('S'), d20: 1, tie: 0 }] });
  const dice = Object.fromEntries(['F', 'S'].map(id => [id, diceOf(formulaNow(nova, RULES)!).map(x => x.count * x.sides)]));
  const hit = then(f, { type: 'act', by: combatantId('A'), ability: nova.id, aim: place(9, 6), rolls: { dice, react: { F: 20, S: 1 } } as never });
  expect(rowHp(rowIn(hit, 'F'))).toBe(rowHp(rowIn(f, 'F')));
  expect(rowHp(rowIn(hit, 'S'))).toBeLessThan(rowHp(rowIn(f, 'S')));
});

test('a GM makes a channeled ability that grows exponentially; in a fight its charge grows one each of its user\'s turns', async ({ device }) => {
  const page = (await device('gm')).page;
  await onboardGM(page);
  const d = skillMaker(page);
  await go(page, 'gm');
  await page.locator('#gm-make [data-make="skill"]').tap();
  await d.locator('#skm-name').fill('Meteor');
  await d.locator('[data-chips="kind"] [data-chip="blast"]').tap();
  await d.locator('[data-group="channel"] > summary').tap();
  await d.locator('[data-a="channel"]').check();
  await d.locator('[data-chips="growth"] [data-chip="exponential"]').tap();
  // the exponential tick multiplies the base by 1.45 a charge (RULES.fight.channelExp), a blast's base being the heavy share
  await expect(d.locator('[data-formula]')).toHaveValue('1.5 * (2d8 + mag) * 1.45^charge');
  await d.locator('[data-apply]').tap();
  await expect(d).toHaveCount(0);

  const meteor: Ability = (await librarySkill(page, 'Meteor')).ability;
  expect(meteor.channel).toEqual({ growth: 'exponential', max: RULES.fight.channelMax });
  let f = play(...duel(newRow('A', 'party', cHunter('pow', 'ctl', 'light'), place(2, 6), [meteor]), newRow('M', 'foe', cHunter('vit', 'str', 'heavy'), place(8, 6))),
    { type: 'act', by: combatantId('A'), ability: meteor.id, aim: combatantId('M'), rolls: { dice: {}, react: {} } as never });
  expect(rowIn(f, 'A').channel).toMatchObject({ charge: 0, state: 'holding' });
  /** Passes whoever acts until A's turn starts again (A is faster than M, so it may act twice between M's turns). */
  const current = (g: Fight): string => (g.phase === 'running' ? g.currentId : '');
  const toA = (g: Fight): Fight => { let x = g; while (current(x) !== 'A') x = then(x, pass(current(x))); return x; };
  const charges: number[] = [];
  for (let turn = 0; turn < 3; turn++) {
    f = turn === 0 ? toA(f) : toA(then(f, pass('A')));
    charges.push(rowIn(f, 'A').channel!.charge);
  }
  expect(charges).toEqual([1, 2, 3]);
});

test('a GM makes a status with a shield of 20; on a hunter in a fight it takes a hit before HP does', async ({ device }) => {
  const page = (await device('gm')).page;
  await onboardGM(page);
  const d = statusMaker(page);
  await go(page, 'workshop');
  await workshop(page, 'status').locator('[data-new]').tap();
  await d.locator('[data-name]').fill('Ice Ward');
  await d.locator('[data-add]').tap();
  await d.locator('[data-row="0"] [data-f="kind"]').selectOption('shield');
  await d.locator('[data-row="0"] [data-f="q"]').fill('20');
  await expect(d.locator('.mk-preview')).toContainText('Shield of 20');
  await d.getByRole('button', { name: 'Save status' }).tap();
  await expect(d).toHaveCount(0);

  const [key, ward] = await libraryStatus(page, 'Ice Ward');
  const hit: Ability = { ...abilityOf('strike', { id: abilityId('hit'), name: 'Hit', effect: { type: 'physical', by: 'hand', formula: formulaOf('10') } }, RULES), range: tiles(20), shape: { kind: 'touch', reach: tiles(20) } };
  const a = newRow('A', 'party', cHunter('vit', 'str', 'heavy'), place(2, 6)), m = newRow('M', 'foe', cHunter('str', 'vit', 'medium'), place(4, 6), [hit]);
  const f = play(...duel(a, m), { type: 'status', id: combatantId('A'), add: { key: statusKey(key), def: ward, duration: tick(2000), tier: 0 } }, pass('A'),
    { type: 'act', by: combatantId('M'), ability: hit.id, aim: combatantId('A'), rolls: { dice: {}, react: { A: 10 } } as never });
  expect(rowHp(rowIn(f, 'A'))).toBe(rowHp(a));
  expect(rowIn(f, 'A').shield!.amount).toBeLessThan(20);
});

test('every kind of op round-trips through the status maker and its parser, the same at every rank and by rank where it has one', async ({ device }) => {
  const page = (await device('gm')).page;
  await onboardGM(page);
  const d = statusMaker(page);
  await go(page, 'workshop');
  for (const kind of OP_KINDS) {
    await test.step(kind, async () => {
      await workshop(page, 'status').locator('[data-new]').tap();
      await d.locator('[data-name]').fill(`Op ${kind}`);
      await d.locator('[data-add]').tap();
      await d.locator('[data-row="0"] [data-f="kind"]').selectOption(kind);
      if (kind === 'note') await d.locator('[data-row="0"] [data-f="text"]').fill('The GM rules on it.');
      await expect(d.locator('[data-row="0"] [data-err]')).toHaveText('');
      await d.getByRole('button', { name: 'Save status' }).tap();
      await expect(d).toHaveCount(0);
      const [, def] = await libraryStatus(page, `Op ${kind}`);
      expect(def.ops.map(o => o.op)).toEqual([kind]);
      expect(parseOp(def.ops[0], RULES)).toEqual(def.ops[0]);
      const byRank = d.locator('[data-row="0"] [data-mode="rank"]');
      await workshop(page, 'status').locator('[data-new]').tap();
      await d.locator('[data-name]').fill(`Op ${kind} by rank`);
      await d.locator('[data-add]').tap();
      await d.locator('[data-row="0"] [data-f="kind"]').selectOption(kind);
      if (kind === 'note') await d.locator('[data-row="0"] [data-f="text"]').fill('The GM rules on it.');
      const tiered = await byRank.count() > 0;
      if (tiered) {
        await byRank.tap();
        await d.locator('[data-row="0"] [data-t="5"]').fill(await d.locator('[data-row="0"] [data-t="0"]').inputValue() === '2' ? '3' : '2');
      }
      await expect(d.locator('[data-row="0"] [data-err]')).toHaveText('');
      await d.getByRole('button', { name: 'Save status' }).tap();
      await expect(d).toHaveCount(0);
      const [, ranked] = await libraryStatus(page, `Op ${kind} by rank`);
      expect(parseOp(ranked.ops[0], RULES)).toEqual(ranked.ops[0]);
      if (tiered) expect(Object.values(ranked.ops[0] as object).some((v: unknown) => Array.isArray(v) && v.length === 6)).toBe(true);
    });
  }
});

test('a GM makes a fire blast that leaves burning ground for 2 rounds; in a fight the ground stays where it landed and a foe left standing in it burns', async ({ device }) => {
  const page = (await device('gm')).page;
  await onboardGM(page);
  const d = skillMaker(page);
  await go(page, 'gm');
  await page.locator('#gm-make [data-make="skill"]').tap();
  await d.locator('#skm-name').fill('Fire Rain');
  await d.locator('[data-chips="kind"] [data-chip="blast"]').tap();
  await d.locator('[data-group="zone"] > summary').tap();
  await d.locator('[data-a="zone"]').check();
  await d.locator('[data-a="zname"]').fill('Burning ground');
  await d.locator('[data-a="zrounds"]').fill('2');
  await d.locator('[data-zone-fx] [data-row="0"] [data-f="q"]').fill('4');
  await expect(d.locator('[data-sum="zone"]')).toHaveText('Leaves Burning ground for 2 rounds');
  await expect(d.locator('.mk-preview')).toContainText('Leaves Burning ground where it lands for 2 rounds');
  await d.locator('[data-apply]').tap();
  await expect(d).toHaveCount(0);

  const rain: Ability = (await librarySkill(page, 'Fire Rain')).ability;
  expect(rain.zone).toEqual({ name: 'Burning ground', duration: 2000, ops: [{ op: 'damage', type: 'magical', amount: formulaOf('4') }], endsWithOwner: false, around: null, grow: null });
  // the caster far from the blast, a rooted tank at its centre that cannot step out: it stays in the ground
  const caster = newRow('A', 'party', cHunter('pow', 'ctl', 'light'), place(2, 6), [rain]);
  const tank = newRow('T', 'foe', cHunter('vit', 'str', 'heavy'), place(9, 6));
  const f = play({ type: 'add', fightId: fightId('f-m6'), rows: [caster, tank], openings: [] },
    { type: 'start', openings: [{ id: combatantId('A'), d20: 20, tie: 0 }, { id: combatantId('T'), d20: 1, tie: 0 }] },
    { type: 'status', id: combatantId('T'), add: { key: statusKey('rooted'), def: { label: 'Rooted', desc: '', ops: [{ op: 'root' }] }, duration: null, tier: 0 } });
  const dice = { T: diceOf(formulaNow(rain, RULES)!).map(x => x.count) };
  const hit = then(f, { type: 'act', by: combatantId('A'), ability: rain.id, aim: place(9, 6), rolls: { dice, react: { T: 1 } } as never });
  expect(hit.zones.map(z => [z.name, z.owner, z.until])).toEqual([['Burning ground', 'A', tick((f as any).now + 2000)]]);
  // the same use with no field: what the tank lost besides is the ground's 4 a round for the time it stood in it, paid
  // at its own turn's start (a heavy blast gives the tank the next turn)
  const { zone: _field, ...plain } = rain;
  const g = play({ type: 'add', fightId: fightId('f-m6'), rows: [{ ...caster, abilities: [plain] }, tank], openings: [] },
    { type: 'start', openings: [{ id: combatantId('A'), d20: 20, tie: 0 }, { id: combatantId('T'), d20: 1, tie: 0 }] },
    { type: 'status', id: combatantId('T'), add: { key: statusKey('rooted'), def: { label: 'Rooted', desc: '', ops: [{ op: 'root' }] }, duration: null, tier: 0 } });
  const hitPlain = then(g, { type: 'act', by: combatantId('A'), ability: plain.id, aim: place(9, 6), rolls: { dice, react: { T: 1 } } as never });
  expect((hit as any).currentId).toBe('T');
  expect(rowHp(rowIn(hitPlain, 'T')) - rowHp(rowIn(hit, 'T'))).toBe(Math.round(4 * ((hit as any).now - (f as any).now) / 1000));
  expect(rowIn(hit, 'T').statuses.some(s => s.def.label === 'Burning ground' && s.until === null)).toBe(true);
});

test('in the skill maker "Add what lands when it ends" goes the moment an effect is added under it, and Save keeps that effect as the field\'s end', async ({ device }) => {
  const page = (await device('gm')).page;
  await onboardGM(page);
  const d = skillMaker(page), err = d.locator('[data-zend-err]');
  await go(page, 'gm');
  await page.locator('#gm-make [data-make="skill"]').tap();
  await d.locator('#skm-name').fill('Ember Field');
  await d.locator('[data-chips="kind"] [data-chip="blast"]').tap();
  await d.locator('[data-group="zone"] > summary').tap();
  await d.locator('[data-a="zone"]').check();
  await d.locator('[data-a="zend"]').check();
  await expect(err).toHaveText('Add what lands when it ends.');
  await expect(d.locator('[data-apply]')).toBeDisabled();
  await d.locator('[data-zend-fx] [data-q="damage"]').tap();
  await expect(err).toHaveText('');
  await expect(d.locator('[data-apply]')).toBeEnabled();
  await d.locator('[data-apply]').tap();
  await expect(d).toHaveCount(0);
  const ember: Ability = (await librarySkill(page, 'Ember Field')).ability;
  expect(ember.zone?.end?.map(op => [op.op, (op as { type?: string }).type])).toEqual([['damage', 'magical']]);
});

test('a GM makes a feat for 2 Beasts defeated in a session, from the Workshop: the library holds what the form said, the list says its rule, and Edit opens it as saved', async ({ device }) => {
  const page = (await device('gm')).page;
  await onboardGM(page);
  const d = page.locator('.fm-overlay [role=dialog]');
  await go(page, 'workshop');
  await workshop(page, 'feat').locator('[data-new]').tap();
  await expect(d.getByRole('heading', { name: 'New feat' })).toBeVisible();

  await test.step('Count offers only what the kind of fact can count, and keeps a choice the new kind can take', async () => {
    const count = d.locator('#fm-measure'), of = d.locator('#fm-mfield');
    await d.locator('#fm-name').fill('Beast Week');
    await d.locator('#fm-kind').selectOption('fight');
    await count.selectOption({ label: 'The total of' });
    await of.selectOption({ label: 'HP healed on allies' });
    await d.locator('#fm-kind').selectOption('quest');
    await expect(count.locator('option')).toHaveText(['Each time', 'Different values of']);
    await expect(count).toHaveValue('facts');
    await expect(of).toHaveCount(0);
    await count.selectOption({ label: 'Different values of' });
    await expect(of.locator('option')).toHaveText(['End', 'Kind', 'From', 'Title']);
    await of.selectOption({ label: 'Title' });
    await expect(d.locator('.mk-preview')).toContainText('Different values of title: 1, ever.');
    await d.locator('#fm-kind').selectOption('fight');
    await expect(count.locator('option')).toHaveText(['Each time', 'The total of', 'Different values of', 'The highest']);
    await expect(count).toHaveValue('distinct');
    await count.selectOption('facts');
  });

  await test.step('the form: a name, a window, what happened, one test, the count, the window, shown from the start, 1 ability point', async () => {
    await d.locator('#fm-name').fill('Beast Week');
    await d.locator('#fm-window').fill('THE BEASTS NOTICED');
    await d.locator('#fm-desc').fill('Two Beasts defeated in one session.');
    await d.locator('#fm-kind').selectOption('kill');
    await d.locator('[data-tadd]').tap();
    await d.locator('[data-test] [data-tf]').selectOption('type');
    await d.locator('[data-test] [data-tv]').fill('Beast');
    await d.locator('#fm-reach').fill('2');
    await d.locator('[data-chips="within"] [data-chip="session"]').tap();
    await d.locator('[data-chips="show"] [data-chip="start"]').tap();
    await d.locator('.rw-nums [data-n="points"]').fill('1');
    await expect(d.locator('.mk-preview')).toContainText('Monsters defeated (Monster type is Beast): 2, in one session.');
    await d.getByRole('button', { name: 'Save feat' }).tap();
    await expect(d).toHaveCount(0);
  });

  await test.step('the library holds it as the parser reads it, and the Workshop lists it with its line', async () => {
    const f = await page.evaluate(() => hunterApp.store.get().library.feats['beast-week']);
    expect(f).toMatchObject({ name: 'Beast Week', window: 'THE BEASTS NOTICED', desc: 'Two Beasts defeated in one session.', show: { at: 'start' },
      rule: { on: 'kill', where: [{ field: 'type', op: '=', value: 'Beast' }], measure: { of: 'facts' }, within: 'session', reach: 2, also: [] } });
    expect(f.rewards.points).toBe(1);
    await expect(workshop(page, 'feat').locator('.ws-list li', { hasText: 'Beast Week' })).toContainText('Two Beasts defeated in one session.');
  });

  await test.step('Edit opens the feat as it was saved', async () => {
    await workshop(page, 'feat').locator('.ws-list li', { hasText: 'Beast Week' }).locator('.ws-row').tap();
    await expect(d.getByRole('heading', { name: 'Edit Beast Week' })).toBeVisible();
    await expect(d.locator('#fm-kind')).toHaveValue('kill');
    await expect(d.locator('[data-test] [data-tv]')).toHaveValue('Beast');
    await expect(d.locator('#fm-reach')).toHaveValue('2');
    await d.locator('[data-cancel]').tap();
  });

  await test.step('a built-in feat turned off is listed off, an Edit keeps it off, its Duplicate is on, and Turn on lists it with the built-ins again', async () => {
    const built = workshop(page, 'feat').locator('.ws-built'), shipped = built.locator('li[data-id="ratcatcher"]');
    const mine = workshop(page, 'feat').locator(':scope > .ws-list > li[data-id="ratcatcher"]');
    /** "⋯" on the row `li`, then `label` in its window, the window titled by the feat's name. */
    const more = async (li: typeof mine, label: string) => {
      await li.locator('[data-act="more"]').tap();
      const win = page.locator('.sys-overlay.show', { has: page.locator('h2.sys-title', { hasText: /^Ratcatcher$/ }) });
      await win.locator('.sys-actions button', { hasText: label }).tap();
      await expect(win).toHaveCount(0);
    };
    await built.locator('summary').tap();
    await more(shipped, 'Turn off');
    await expect(mine).toContainText('built-in, off');
    expect(await page.evaluate(() => hunterApp.store.get().library.feats.ratcatcher?.off)).toBe(true);
    await mine.locator('.ws-row').tap();
    await expect(d.getByRole('heading', { name: 'Edit Ratcatcher' })).toBeVisible();
    await d.locator('#fm-reach').fill('40');
    await d.getByRole('button', { name: 'Save feat' }).tap();
    await expect(d).toHaveCount(0);
    expect(await page.evaluate(() => { const f = hunterApp.store.get().library.feats.ratcatcher; return [f?.off, f?.rule.reach]; })).toEqual([true, 40]);
    await more(mine, 'Duplicate');
    await expect(workshop(page, 'feat').locator('.ws-list li', { hasText: 'Ratcatcher (copy)' })).toBeVisible();
    expect(await page.evaluate(() => Object.values(hunterApp.store.get().library.feats as Record<string, any>).filter(f => f.name === 'Ratcatcher (copy)').map(f => [f.off ?? null, f.rule.reach]))).toEqual([[null, 40]]);
    await more(mine, 'Turn on');
    await expect(mine).not.toContainText('off');
    await expect(mine).toContainText('changed built-in');
    await more(mine, 'Reset');
    await answerWindow(page, 'Reset Ratcatcher?', 'Reset');
    await expect(mine).toHaveCount(0);
    await more(shipped, 'Turn off');
    await more(mine, 'Turn on');
    await expect(mine).toHaveCount(0);
    await expect(shipped).toBeVisible();
    expect(await page.evaluate(() => Object.hasOwn(hunterApp.store.get().library.feats, 'ratcatcher'))).toBe(false);
  });
});

test('a GM who opens a feat and saves it unchanged keeps when it is shown: from the start, after a count, after another feat, hidden, and after a feat the list no longer holds', async ({ device }) => {
  const page = (await device('gm')).page;
  await onboardGM(page);
  const own = { name: 'Second Wind', window: 'SECOND WIND', desc: 'Shown after a feat that was deleted.', show: { at: 'feat', key: 'gone-feat' },
    rule: { on: 'roll', where: [], measure: { of: 'facts' }, within: 'ever', reach: 2, also: [] }, rewards: { xp: 10 } };
  await page.evaluate(f => hunterApp.store.update((d: any) => { d.library.feats = { 'second-wind': f }; }, 'test-setup'), own);
  const parsed = await page.evaluate(() => hunterApp.store.get().library.feats['second-wind']);
  const d = page.locator('.fm-overlay [role=dialog]');
  await go(page, 'workshop');
  const built = workshop(page, 'feat').locator('.ws-built');
  await built.locator('summary').tap();
  /** Opens the feat on `row`, checks the show choice pressed, and answers its Save. */
  const editAndSave = async (row: Locator, name: string, at: string) => {
    await row.locator('.ws-row').tap();
    await expect(d.getByRole('heading', { name: `Edit ${name}` })).toBeVisible();
    await expect(d.locator(`[data-chips="show"] [data-chip="${at}"]`)).toHaveAttribute('aria-pressed', 'true');
    return async () => { await d.getByRole('button', { name: 'Save feat' }).tap(); await expect(d).toHaveCount(0); };
  };
  for (const [key, name, at] of [['uphill', 'Uphill', 'start'], ['four-figures', 'Four Figures', 'count'], ['iron-routine', 'Iron Routine', 'feat'], ['threads-end', 'Thread\'s End', 'never']] as const) {
    await test.step(`${name}, shown ${at}: Edit then Save leaves the library without an entry for it, so it is as it shipped`, async () => {
      const save = await editAndSave(built.locator(`li[data-id="${key}"]`), name, at);
      if (at === 'feat') await expect(d.locator('#fm-after option:checked')).toHaveText('Early Riser');
      if (at === 'count') await expect(d.locator('#fm-shown')).toHaveValue('100');
      await save();
      expect(await page.evaluate(k => Object.hasOwn(hunterApp.store.get().library.feats, k), key)).toBe(false);
    });
  }
  await test.step('the GM\'s own feat, shown after a feat no longer in the list: the key stays chosen, named by its key, and Save keeps it', async () => {
    const save = await editAndSave(workshop(page, 'feat').locator(':scope > .ws-list > li[data-id="second-wind"]'), 'Second Wind', 'feat');
    await expect(d.locator('#fm-after option:checked')).toHaveText('gone-feat');
    await expect(d.locator('#fm-after option', { hasText: 'Second Wind' })).toHaveCount(0);
    await save();
    expect(await page.evaluate(() => hunterApp.store.get().library.feats['second-wind'])).toEqual(parsed);
  });
  await test.step('a new feat shown after Early Riser is saved with that key', async () => {
    await workshop(page, 'feat').locator('[data-new]').tap();
    await d.locator('#fm-name').fill('After Dawn');
    await d.locator('[data-chips="show"] [data-chip="feat"]').tap();
    await d.locator('#fm-after').selectOption({ label: 'Early Riser' });
    await d.getByRole('button', { name: 'Save feat' }).tap();
    await expect(d).toHaveCount(0);
    expect(await page.evaluate(() => hunterApp.store.get().library.feats['after-dawn']?.show)).toEqual({ at: 'feat', key: 'early-riser' });
  });
});

test('a GM whose Save is refused reads why on screen, in the feat maker and in the status maker, wherever the form is scrolled', async ({ device }) => {
  const page = (await device('gm')).page;
  await onboardGM(page);
  await go(page, 'workshop');
  /** The message of the window `win` reads `text` and is wholly on screen, not clipped by the scrolled form. */
  const inView = async (win: Locator, text: string) => {
    const err = win.locator('[data-err]').last();
    await expect(err).toHaveText(text);
    await expect(err).toBeInViewport({ ratio: 1 });
  };
  await test.step('the feat maker: a condition left without a value', async () => {
    const d = page.locator('.fm-overlay [role=dialog]');
    await workshop(page, 'feat').locator('[data-new]').tap();
    await d.locator('#fm-name').fill('Beast Week');
    await d.locator('[data-tadd]').tap();
    await d.getByRole('button', { name: 'Save feat' }).tap();
    await inView(d, 'Give each condition under Only when a value.');
    await expect(d.locator('.mk-preview')).toContainText('Give each condition under Only when a value.');
    await d.locator('#fm-name').fill('');
    await d.locator('.mk-scroll').evaluate(el => el.scrollTo(0, el.scrollHeight));
    await d.getByRole('button', { name: 'Save feat' }).tap();
    await inView(d, 'Give the feat a name.');
    expect(await page.evaluate(() => Object.keys(hunterApp.store.get().library.feats))).toEqual([]);
    await d.locator('[data-cancel]').last().tap();
  });
  await test.step('the status maker: a status with no name', async () => {
    const d = page.locator('.mk-overlay [role=dialog]');
    await workshop(page, 'status').locator('[data-new]').tap();
    await d.locator('.mk-scroll').evaluate(el => el.scrollTo(0, el.scrollHeight));
    await d.locator('[data-apply]').tap();
    await inView(d, 'Give the status a name.');
  });
});

test('a status too large to keep is refused whole when the GM saves it: the maker says its size and the most a status holds, and the library does not get it', async ({ device }) => {
  const page = (await device('gm')).page;
  await onboardGM(page);
  const d = statusMaker(page);
  await go(page, 'workshop');
  await workshop(page, 'status').locator('[data-new]').tap();
  await d.locator('[data-name]').fill('Litany');
  // 12 notes of 200 three-byte characters are 7,400 bytes of JSON, over a status's 5,120 (src/core/size.ts)
  for (let i = 0; i < 12; i++) {
    await d.locator('[data-add]').tap();
    await d.locator(`[data-row="${i}"] [data-f="kind"]`).selectOption('note');
    await d.locator(`[data-row="${i}"] [data-f="text"]`).fill('\u0800'.repeat(200));
  }
  await d.locator('[data-apply]').tap();
  await expect(d.locator('[data-err]').last()).toHaveText(/^This status is too large to save\. It takes [\d,]+ bytes, and a status holds at most 5,120\. Remove an effect, or one of the things that happen when it stacks, triggers or ends\.$/);
  await expect(d).toBeVisible();
  expect(await page.evaluate(() => Object.keys(hunterApp.store.get().library.statuses))).not.toContain('litany');

  await test.step('with five of the notes removed it fits and is saved', async () => {
    for (let i = 11; i >= 7; i--) await d.locator(`[data-row="${i}"] [data-rm]`).tap();
    await d.locator('[data-apply]').tap();
    await expect(d).toHaveCount(0);
    expect(await page.evaluate(() => hunterApp.store.get().library.statuses.litany.ops.length)).toBe(7);
  });
});

const storyMakerWin = (page: Page) => page.locator('.stm-overlay [role=dialog]');
const libraryStories = (page: Page) => page.evaluate(() => hunterApp.store.get().library.stories.map(({ id: _id, ...s }: any) => s));

test('a GM makes a story of two chapters in the Workshop, the second with a quest, and edits the first', async ({ device }) => {
  const page = (await device('gm')).page;
  await onboardGM(page);
  const d = storyMakerWin(page);
  await go(page, 'workshop');
  await workshop(page, 'story').locator('[data-new]').tap();
  await expect(d.getByRole('heading', { name: 'New story' })).toBeVisible();

  await test.step('the story and its first chapter: a name, when, for chosen hunters, the window, a note and 50 gold', async () => {
    await d.locator('#stm-name').fill('The debt');
    await d.locator('#stm-when').fill('A hunter is close to death and alone.');
    await d.locator('[data-chips="for"] [data-chip="hunters"]').tap();
    await d.locator('#stm-cname').fill('The offer');
    await d.locator('#stm-wtitle').fill('The deep has noticed you');
    await d.locator('#stm-wline').fill('A voice offers strength for a debt.');
    await d.locator('#stm-note').fill('Ask whether the hunter takes the offer.');
    await d.locator('[data-stm-rw] [data-n="gold"]').fill('50');
  });

  await test.step('a second chapter issues an urgent quest due 48 hours after it opens, with 100 XP; the first folds to its line', async () => {
    await d.locator('[data-chadd]').tap();
    await expect(d.locator('[data-chopen="0"]')).toHaveText('1. The offer · THE DEEP HAS NOTICED YOU');
    await d.locator('#stm-wtitle').fill('The deep asks for a gate');
    await d.locator('#stm-hasq').check();
    const q = d.locator('[data-stm-q]');
    await q.locator('[name=kind]').selectOption('urgent');
    await q.locator('[name=title]').fill('Clear a gate for the Deep');
    await q.locator('[name=olabel]').fill('Gate cleared');
    await q.locator('[name=dueHours]').fill('48');
    await q.locator('#stq-xp').fill('100');
    await expect(d.locator('.mk-preview li')).toHaveText([
      'Chapter 1, The offer: THE DEEP HAS NOTICED YOU. +50 gold.',
      'Chapter 2: THE DEEP ASKS FOR A GATE. Quest: Clear a gate for the Deep.',
    ]);
    await d.getByRole('button', { name: 'Save story' }).tap();
    await expect(d).toHaveCount(0);
  });

  await test.step('the library holds what the form said, and the Workshop lists it with its chapters and who it is for', async () => {
    expect(await libraryStories(page)).toEqual([{
      name: 'The debt', when: 'A hunter is close to death and alone.', for: 'hunters', chapters: [
        { name: 'The offer', words: { title: 'THE DEEP HAS NOTICED YOU', line: 'A voice offers strength for a debt.' }, rewards: { ...newRewards(), gold: 50 }, quest: null, note: 'Ask whether the hunter takes the offer.' },
        { name: '', words: { title: 'THE DEEP ASKS FOR A GATE', line: '' }, rewards: newRewards(), note: '',
          quest: { kind: 'urgent', title: 'Clear a gate for the Deep', desc: '', objectives: [{ label: 'Gate cleared', target: 1, progress: 0 }], rewards: { ...newRewards(), xp: 100 }, onFail: newRewards(), dueHours: 48, penaltyText: '' } },
      ],
    }]);
    await expect(workshop(page, 'story').locator('li[data-id]:not([data-example]) .meta')).toHaveText('2 chapters · for chosen hunters');
  });

  await test.step('Edit opens it as saved; a changed line in chapter 1 is saved, and chapter 2 keeps its quest', async () => {
    await workshop(page, 'story').getByRole('button', { name: 'Edit The debt' }).tap();
    await expect(d.getByRole('heading', { name: 'Edit The debt' })).toBeVisible();
    await expect(d.locator('#stm-cname')).toHaveValue('The offer');
    await expect(d.locator('[data-stm-rw] [data-n="gold"]')).toHaveValue('50');
    await d.locator('#stm-wline').fill('A voice offers strength. It wants a debt.');
    await d.locator('[data-chopen="1"]').tap();
    await expect(d.locator('[data-stm-q] [name=title]')).toHaveValue('Clear a gate for the Deep');
    await d.getByRole('button', { name: 'Save story' }).tap();
    await expect(d).toHaveCount(0);
    const [s] = await libraryStories(page);
    expect([s.chapters[0].words.line, s.chapters[1].quest.title, s.chapters[1].quest.dueHours]).toEqual(['A voice offers strength. It wants a debt.', 'Clear a gate for the Deep', 48]);
  });
});

test('the shortest story is a name and a window title: three taps from the Workshop', async ({ device }) => {
  const page = (await device('gm')).page;
  await onboardGM(page);
  const d = storyMakerWin(page), t = tapCounter();
  await go(page, 'workshop');

  await test.step('Save says what is missing: the name, then the chapter\'s window title', async () => {
    await workshop(page, 'story').locator('[data-new]').tap();
    await d.getByRole('button', { name: 'Save story' }).tap();
    await expect(d.locator('.mk-err')).toHaveText('Name the story.');
    await d.locator('#stm-name').fill('What you owe');
    await d.getByRole('button', { name: 'Save story' }).tap();
    await expect(d.locator('.mk-err')).toHaveText('Give chapter 1 a window title.');
    await d.locator('.mk-actions [data-cancel]').tap();
    await expect(d).toHaveCount(0);
  });

  await test.step('New story, the name typed where the cursor is, Window title, Save story', async () => {
    await t.tap(workshop(page, 'story').locator('[data-new]'));
    await expect(d.locator('#stm-name')).toBeFocused();
    await page.keyboard.type('What you owe');
    await t.tap(d.locator('#stm-wtitle'));
    await page.keyboard.type('What do you owe');
    await t.tap(d.getByRole('button', { name: 'Save story' }));
    await expect(d).toHaveCount(0);
    expect(t.count).toBe(3);
    expect(await libraryStories(page)).toEqual([{ name: 'What you owe', when: '', for: 'table', chapters: [{ name: '', words: { title: 'WHAT DO YOU OWE', line: '' }, rewards: newRewards(), quest: null, note: '' }] }]);
  });
});

test('a GM copies The wager from the stories to copy and finds it whole in the library', async ({ device }) => {
  const page = (await device('gm')).page;
  await onboardGM(page);
  await go(page, 'workshop');
  const sec = workshop(page, 'story');
  await sec.locator('[data-examples] summary').tap();
  await expect(sec.locator('[data-examples] summary')).toHaveText('Stories to copy (2)');
  await sec.getByRole('button', { name: 'Duplicate The wager' }).tap();
  await expect(page.locator('#toasts .toast', { hasText: 'The wager is in your stories.' })).toBeVisible();
  expect(await libraryStories(page)).toEqual([EXAMPLE_STORIES[0]!.story]);
  await expect(sec.locator('li[data-id]:not([data-example]) .meta')).toHaveText('4 chapters · for chosen hunters');
});

test('Enter in a maker\'s field moves to the next field and never saves the form; Ctrl and Enter saves it', async ({ device }) => {
  const page = (await device('gm')).page;
  await onboardGM(page);
  const d = storyMakerWin(page);
  await go(page, 'workshop');
  await workshop(page, 'story').locator('[data-new]').tap();

  await test.step('Enter in the name moves to "When to turn it on"', async () => {
    await d.locator('#stm-name').fill('The long debt');
    await d.locator('#stm-name').press('Enter');
    await expect(d.locator('#stm-when')).toBeFocused();
  });

  await test.step('Enter in a chapter quest\'s objective moves to its target, and the story stays unsaved with the maker open', async () => {
    await d.locator('#stm-wtitle').fill('The deep asks');
    await d.locator('#stm-hasq').check();
    const q = d.locator('[data-stm-q]');
    await q.locator('[name=title]').fill('Pay the deep');
    await q.locator('[name=olabel]').fill('Gate cleared');
    await q.locator('[name=olabel]').press('Enter');
    await expect(q.locator('[name=otarget]')).toBeFocused();
    await q.locator('[name=otarget]').press('Enter');
    await expect(d).toBeVisible();
    expect(await libraryStories(page)).toEqual([]);
  });

  await test.step('Ctrl and Enter saves the story', async () => {
    await d.locator('#stm-wline').press('Control+Enter');
    await expect(d).toHaveCount(0);
    const [s] = await libraryStories(page);
    expect([s.name, s.chapters[0].quest.title, s.chapters[0].quest.objectives]).toEqual(['The long debt', 'Pay the deep', [{ label: 'Gate cleared', target: 1, progress: 0 }]]);
  });
});

test('Enter in the Quests view\'s form moves to the next field as it does in a maker and never saves the quest; Ctrl and Enter saves it', async ({ device }) => {
  const page = (await device('gm')).page;
  await onboardGM(page);
  await go(page, 'quests');
  const form = page.locator('#view-quests form[data-form]'), cards = page.locator('#view-quests .qc', { hasText: 'Clear the den' });
  await page.locator('#view-quests [data-new]').tap();

  await test.step('Enter in the title moves to the description, and nothing is saved', async () => {
    await form.locator('[name=title]').fill('Clear the den');
    await form.locator('[name=title]').press('Enter');
    await expect(form.locator('[name=desc]')).toBeFocused();
    await expect(form).toBeVisible();
    await expect(cards).toHaveCount(0);
  });

  await test.step('Enter in an objective moves to its target, and Enter in the penalty text leaves the form open', async () => {
    await form.locator('[name=olabel]').fill('Wolves slain');
    await form.locator('[name=olabel]').press('Enter');
    await expect(form.locator('[name=otarget]')).toBeFocused();
    await form.locator('[name=penaltyText]').fill('Lose 10 gold');
    await form.locator('[name=penaltyText]').press('Enter');
    await expect(form).toBeVisible();
    await expect(cards).toHaveCount(0);
  });

  await test.step('Ctrl and Enter in the description saves the quest', async () => {
    await form.locator('[name=desc]').press('Control+Enter');
    await expect(form).toBeHidden();
    await expect(cards).toContainText('Wolves slain');
  });
});

test('a half-written reward row keeps its chapter open in the story maker, and the maker says so, until the row is finished', async ({ device }) => {
  const page = (await device('gm')).page;
  await onboardGM(page);
  const d = storyMakerWin(page), rw = d.locator('[data-stm-rw]');
  await go(page, 'workshop');
  await workshop(page, 'story').locator('[data-new]').tap();
  await d.locator('#stm-name').fill('A favor owed');
  await d.locator('#stm-wtitle').fill('Someone owes you');

  await test.step('a boon row without a name: Add a chapter leaves chapter 1 open and says why; ticking "Issues a quest" keeps the row', async () => {
    await rw.locator('[data-add="boon"]').tap();
    await d.locator('[data-chadd]').tap();
    await expect(d.locator('.mk-err')).toHaveText(UNFINISHED_ROWS);
    await expect(d.locator('[data-ch]')).toHaveCount(1);
    await expect(d.locator('#stm-wtitle')).toHaveValue('Someone owes you');
    await d.locator('#stm-hasq').check();
    await expect(rw.locator('[data-kind="boon"]')).toHaveCount(1);
    await d.locator('#stm-hasq').uncheck();
  });

  await test.step('named, the row goes with chapter 1 when chapter 2 opens, and Save keeps it', async () => {
    await rw.locator('[data-kind="boon"] [data-f="name"]').fill('A favor');
    await d.locator('[data-chadd]').tap();
    await expect(d.locator('[data-ch]')).toHaveCount(2);
    await expect(d.locator('.mk-err')).toHaveText('');
    await d.locator('#stm-wtitle').fill('The favor comes due');
    await d.getByRole('button', { name: 'Save story' }).tap();
    await expect(d).toHaveCount(0);
    const [s] = await libraryStories(page);
    expect(s.chapters.map((c: any) => c.rewards.boons)).toEqual([[{ name: 'A favor', text: '' }], []]);
  });
});
