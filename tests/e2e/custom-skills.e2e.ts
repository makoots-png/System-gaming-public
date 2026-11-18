import type { Page } from '@playwright/test';
import { test, expect, onboardGM, go, startGoblinDenFight, answerWindow, fightRow, chooseList } from './helpers.ts';

const combat = (page: Page) => page.locator('#view-combat');
const currentRow = (page: Page) => combat(page).locator('.cmb-row.cur .cmb-nm');
const logLines = (page: Page) => combat(page).locator('[data-log] li');
const card = (page: Page) => combat(page).locator('.cmb-card');
/** The fight's row of the combatant called `name`, as the store holds it. */
const rowOf = fightRow;
const firstMonster = (page: Page) => page.evaluate(() => hunterApp.store.get().fight.rows.find((c: any) => c.kind === 'monster').name as string);

async function tapCombat(page: Page, selector: string, hasText?: string) {
  const target = combat(page).locator(selector, hasText ? { hasText } : {}).first();
  await target.evaluate((el: any) => el.scrollIntoView({ block: 'center' }));
  await target.tap();
}

async function select(page: Page, name: string) {
  await tapCombat(page, `.cmb-row:has-text("${name}") .cmb-pick`);
  await expect(card(page).locator('h3')).toContainText(name);
}

/** The Goblin Den fight on the GM's phone, moved on to Brakk's turn. `carry` goes in Brakk's bag before the fight (setup). */
async function brakksTurn(page: Page, carry?: Record<string, unknown>) {
  await onboardGM(page);
  await chooseList(page);
  if (carry) await giveBrakk(page, 'items', carry);
  await startGoblinDenFight(page);
  await tapCombat(page, '[data-next]');
  await expect(currentRow(page)).toContainText('Brakk Ironhide');
}

/** Gives Brakk, a hunter on the GM's phone, one more thing to carry: a skill or an item (setup only). */
async function giveBrakk(page: Page, key: 'skills' | 'items', thing: Record<string, unknown>) {
  await page.evaluate(([k, t]) => {
    const s = hunterApp.store, brakk = s.get().hunters.find((h: any) => h.name === 'Brakk Ironhide');
    s.update(() => { s.hunter(brakk.id)[k].push({ ...t, id: s.id(k === 'skills' ? 's' : 'i') }); }, 'test-setup');
  }, [key, thing] as const);
}

/**
 * Row `who` takes an ability called `name` into the fight (setup only): its first ability with nothing to avoid it, no
 * cooldown, and status `key` of the rules for `rounds` (a round is 1000 ticks). Then the first goblin stands beside the
 * row, so a touch reaches it.
 */
async function withAbility(page: Page, who: string, name: string, key: string, rounds: number) {
  await page.evaluate(([w, n, k, r]) => hunterApp.store.update((d: any) => {
    const f = d.fight, row = f.rows.find((x: any) => x.name === w), base = row.abilities[0];
    row.abilities.push({ ...base, id: n.toLowerCase().replace(/ /g, '-'), name: n, delivery: { kind: 'sure' }, cost: { ...base.cost, cooldown: 0 },
      ops: [{ op: 'applyStatus', key: k, def: hunterApp.rules().conditions[k], duration: r * 1000 }] });
    const brakk = f.rows.find((x: any) => x.name === 'Brakk Ironhide'), goblin = f.rows.find((x: any) => x.kind === 'monster');
    goblin.place = { x: brakk.place.x, y: brakk.place.y + 1 };
  }, 'test-setup'), [who, name, key, rounds] as const);
}

test('a GM\'s hunter uses a skill on a goblin: the goblin is hurt and its card shows Slowed', async ({ device }) => {
  const page = (await device('gm')).page;
  await brakksTurn(page);
  await withAbility(page, 'Brakk Ironhide', 'Frost Lance', 'slowed', 2);
  const goblin = await firstMonster(page), before = (await rowOf(page, goblin)).hp;

  await tapCombat(page, '.cmb-card.turn [data-ab]', 'Frost Lance');
  await answerWindow(page, 'Use Frost Lance on', goblin);

  await expect.poll(async () => (await rowOf(page, goblin)).hp).toBeLessThan(before);
  expect((await rowOf(page, goblin)).statuses.map((x: any) => x.key)).toEqual(['slowed']);
  await expect(combat(page).locator('.cmb-row', { hasText: goblin }).locator('.cmb-cs')).toContainText('Slowed');
});

test('a goblin uses its Venom Spit on a hunter: the hunter\'s row shows Poisoned', async ({ device }) => {
  const page = (await device('gm')).page;
  await onboardGM(page);
  await chooseList(page);
  await startGoblinDenFight(page);
  const goblin = await firstMonster(page);
  await withAbility(page, goblin, 'Venom Spit', 'poisoned', 3);
  await expect(card(page).locator('[data-ab]', { hasText: 'Venom Spit' })).toBeVisible();

  await tapCombat(page, '.cmb-card [data-ab]', 'Venom Spit');
  await answerWindow(page, 'Use Venom Spit on', 'Brakk Ironhide');

  await expect.poll(async () => (await rowOf(page, 'Brakk Ironhide')).statuses.map((x: any) => x.key)).toEqual(['poisoned']);
  await expect(combat(page).locator('.cmb-row', { hasText: 'Brakk Ironhide' }).locator('.cmb-cs')).toContainText('Poisoned');
});

test('a monster the GM made with a starting status shows it on its card when the fight starts', async ({ device }) => {
  const page = (await device('gm')).page;
  await onboardGM(page);
  await chooseList(page);
  const id = await page.evaluate(() => hunterApp.api.bestiary.save({ name: 'Hasted Hound', rank: 'D', archetype: 'skirmisher', kind: 'normal', statuses: [{ key: 'hasted', rounds: null }] }, true));
  await go(page, 'combat');
  await combat(page).locator('[data-msel]').selectOption(id);
  await tapCombat(page, '[data-addm]');
  await tapCombat(page, '[data-addh]');
  await tapCombat(page, '[data-start]');
  await expect(combat(page).locator('.cmb-row.cur')).toHaveCount(1);

  await expect(combat(page).locator('.cmb-row', { hasText: 'Hasted Hound' }).locator('.cmb-cs')).toHaveText('Hasted');
  await select(page, 'Hasted Hound');
  await expect(card(page).locator('.cmb-conds')).toContainText('Hasted');
});

/**
 * A bomb that deals 5 magical damage and puts Blinded on for a round (a round is 1000 ticks, RULES.fight.round). In a
 * fight it is its ability (src/core/registry/abilities.ts `itemAbility`): a curse on a foe that nothing avoids.
 */
const BOMB = {
  name: 'Flash Bomb', type: 'consumable', rar: 'common', slot: null, qty: 2, dice: '', bonus: {}, value: 0, desc: '', weight: 0, armor: 0, resist: 0, target: 'other',
  effects: [{ op: 'damage', type: 'magical', amount: { kind: 'number', value: 5 }, when: 'use' }, { op: 'applyStatus', key: 'blinded', def: { label: 'Blinded', desc: '', ops: [] }, duration: 1000 }],
};
const bombs = (page: Page) => page.evaluate(() => hunterApp.store.get().hunters.find((h: any) => h.name === 'Brakk Ironhide').items.find((i: any) => i.name === 'Flash Bomb')?.qty ?? 0);
/** A thrown bomb landed on `name`: its HP went down and it holds Blinded. */
async function bombed(page: Page, name: string, before: number) {
  await expect.poll(async () => (await rowOf(page, name)).hp).toBeLessThan(before);
  expect((await rowOf(page, name)).statuses.map((x: any) => x.key)).toEqual(['blinded']);
}

test('a GM\'s hunter throws a bomb at a goblin from his card: the goblin is hurt and Blinded, and one bomb is gone', async ({ device }) => {
  const page = (await device('gm')).page;
  await brakksTurn(page, BOMB);
  const bomb = combat(page).locator('.cmb-card.turn [data-ab]', { hasText: 'Flash Bomb' });
  await expect(bomb).toHaveText('Flash Bomb ×2');
  await bomb.tap();
  const picker = page.locator('.sys-overlay.show', { hasText: 'Use Flash Bomb on' });
  const goblin = ((await picker.locator('.sys-actions button.primary').innerText()).split(' · ')[0] ?? '').trim(), before = (await rowOf(page, goblin)).hp;
  await answerWindow(page, 'Use Flash Bomb on');
  await bombed(page, goblin, before);
  expect(await bombs(page)).toBe(1);
});

test('a double tap on a hunter\'s skill opens one target window and uses it once', async ({ device }) => {
  const page = (await device('gm')).page;
  await brakksTurn(page);
  await withAbility(page, 'Brakk Ironhide', 'Frost Lance', 'slowed', 2);
  const goblin = await firstMonster(page);
  const lance = combat(page).locator('.cmb-card.turn [data-ab]', { hasText: 'Frost Lance' });
  await expect(lance).toBeVisible();

  await lance.evaluate((b: any) => { b.click(); b.click(); });
  await expect(page.locator('.sys-overlay.show')).toHaveCount(1);
  await answerWindow(page, 'Use Frost Lance on', goblin);

  await expect(logLines(page).filter({ hasText: 'uses Frost Lance' })).toHaveCount(1);
  await expect(page.locator('.sys-overlay.show')).toHaveCount(0);
});

/** Brakk as the active hunter, his bag on the Status view (setup only). */
async function brakkActive(page: Page) {
  await page.evaluate(() => { const s = hunterApp.store, brakk = s.get().hunters.find((h: any) => h.name === 'Brakk Ironhide'); s.update((d: any) => { d.settings.activeHunterId = brakk.id; }, 'test-setup'); });
  await go(page, 'status');
}

test('a bomb used from the bag in a running fight asks the GM whom it hits, and the goblin is hurt and Blinded', async ({ device }) => {
  const page = (await device('gm')).page;
  await brakksTurn(page, BOMB);
  await brakkActive(page);
  await page.locator('#view-status [data-panel="inventory"] button[aria-label="Use Flash Bomb"]').tap();
  const picker = page.locator('.sys-overlay.show', { hasText: 'Use Flash Bomb on' });
  const goblin = ((await picker.locator('.sys-actions button.primary').innerText()).split(' · ')[0] ?? '').trim(), before = (await rowOf(page, goblin)).hp;
  await answerWindow(page, 'Use Flash Bomb on');
  await bombed(page, goblin, before);
  expect((await rowOf(page, 'Brakk Ironhide')).statuses).toEqual([]);
  expect(await bombs(page)).toBe(1);
});

test('with no fight and no room, a bomb used from the bag says what it does for the GM to rule on and leaves its user as he was', async ({ device }) => {
  const page = (await device('gm')).page;
  await onboardGM(page);
  await chooseList(page);
  await giveBrakk(page, 'items', BOMB);
  await brakkActive(page);
  const hunter = () => page.evaluate(() => JSON.parse(JSON.stringify(hunterApp.store.get().hunters.find((h: any) => h.name === 'Brakk Ironhide'))));
  const before = await hunter();
  await page.locator('#view-status [data-panel="inventory"] button[aria-label="Use Flash Bomb"]').tap();
  await expect(page.locator('#toasts .toast').last()).toContainText('Flash Bomb used. On the target: Deals 5 magical damage, Applies Blinded (1 round).');
  const after = await hunter();
  expect([after.life, after.conditions, after.items.find((i: any) => i.name === 'Flash Bomb').qty]).toEqual([before.life, before.conditions, 1]);
});

test('a skill\'s name on the Skills panel opens what it does, with its cost, and a second tap closes it', async ({ device }) => {
  const page = (await device('gm')).page;
  await onboardGM(page);
  await go(page, 'status');
  const s = await page.evaluate(() => hunterApp.store.active().skills.find((k: any) => k.type === 'active' && k.ability && (k.ability.cost.mana || k.ability.cost.fatigue)));
  expect(s, 'the active hunter holds an active skill with a cost').toBeTruthy();
  const cost = [s.ability.cost.fatigue ? `${s.ability.cost.fatigue} fatigue` : '', s.ability.cost.mana ? `${s.ability.cost.mana} mana` : ''].filter(Boolean).join(' and ');
  const item = page.locator(`[data-panel="skills"] [data-skill="${s.id}"]`), name = item.getByRole('button', { name: s.name, exact: true });
  await name.tap();
  await expect(name).toHaveAttribute('aria-expanded', 'true');
  await expect(item.locator('.dt')).toContainText(`Costs ${cost}.`);
  await name.tap();
  await expect(name).toHaveAttribute('aria-expanded', 'false');
  await expect(item.locator('.dt')).toHaveCount(0);
});

test('the GM arms a hunter\'s reaction that waits for a body\'s turn from the card, and picks whose turn it waits for', async ({ device }) => {
  const page = (await device('gm')).page;
  await brakksTurn(page);
  const ids = await page.evaluate(() => {
    let out = { brakk: '', foes: [] as string[] };
    hunterApp.store.update((d: any) => {
      const rows = d.fight.rows, b = rows.find((r: any) => r.name === 'Brakk Ironhide');
      b.abilities = [...b.abilities, { ...b.abilities[0], id: 'ambush', name: 'Ambush', react: { when: 'turn', reach: 0 } }];
      out = { brakk: b.id, foes: rows.filter((r: any) => r.side === 'foe').map((r: any) => r.id) };
    }, 'test-setup');
    return out;
  });
  const armed = () => page.evaluate(id => JSON.parse(JSON.stringify(hunterApp.store.get().fight.rows.find((r: any) => r.id === id).armed ?? null)), ids.brakk);
  await select(page, 'Brakk Ironhide');
  await tapCombat(page, '.cmb-card [data-garm="ambush"]');
  await expect.poll(armed).toMatchObject({ ability: 'ambush', on: ids.foes[0], spent: false });
  await expect(card(page)).toContainText('Ready');
  await card(page).locator('[data-garm-on]').selectOption(ids.foes[1]!);
  await expect.poll(armed).toMatchObject({ ability: 'ambush', on: ids.foes[1] });
});
