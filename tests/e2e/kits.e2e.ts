// The kits in the makers (docs/agent-handoff/kits/brief-kits-makers.md): a GM builds Glas's and Einar's kit abilities
// through the status, skill, item and enemy makers on a phone, and the test reads them back from the save, the parsers and
// the fight. Every value expected comes from the kit's rule as the brief and design 5.1 state it.
import { fightId } from '../../src/core/ids.ts';
import type { Locator, Page } from '@playwright/test';
import { formulaOf as formulaNow } from '../../src/core/registry/ability-kinds.ts';
import { test, expect, onboardGM, go, answerWindow } from './helpers.ts';
import { RULES } from '../../src/core/rules.ts';
import { baseStats } from '../../src/core/stats.ts';
import { kitGear } from '../../src/core/hunter/derive.ts';
import { parseAbility, parseStatusDef } from '../../src/core/combat/fight-parse.ts';
import { modified, statusKey } from '../../src/core/combat/effect-ops.ts';
import type { Origin, StatusDef } from '../../src/core/combat/effect-ops.ts';
import { combatantId, hunterId } from '../../src/core/combat/ability-types.ts';
import type { Ability } from '../../src/core/combat/ability-types.ts';
import { place } from '../../src/core/combat/space.ts';
import { diceOf, parseFormula } from '../../src/core/formula.ts';
import { reduce } from '../../src/core/combat/fight.ts';
import type { Command, Ctx, Fight, NewRow } from '../../src/core/combat/fight.ts';
import { fightDoc } from '../../src/core/combat/fight-doc.ts';
import { exampleSkills } from '../../src/core/registry/kit-examples.ts';
import { rowHp } from '../../src/core/combat/row-hp.ts';

const statusMaker = (page: Page) => page.locator('.fg-overlay [role=dialog]');
const workshop = (page: Page, kind: string) => page.locator(`#view-workshop [data-ws="${kind}"]`);
const libraryStatus = (page: Page, label: string) =>
  page.evaluate(l => Object.entries(hunterApp.store.get().library.statuses).find(([, d]: any) => d.label === l), label) as Promise<[string, StatusDef]>;

const formulaOf = (text: string) => { const p = parseFormula(text, RULES); if (!p.ok) throw new Error(p.error); return p.formula; };
/** Opens a group of the maker by its name (`stacks`, `when`, `end`, ...). */
const group = async (d: ReturnType<typeof statusMaker>, name: string) => {
  const g = d.locator(`[data-group="${name}"]`);
  if (!(await g.evaluate((el: HTMLDetailsElement) => el.open))) await g.locator('> summary').tap();
  return g;
};

test('a GM makes Sanguine Resonance in the status maker: stacks to 10, a heal for the striker on each hit, and at the bearer\'s Vitality a 3d6 burst that spends them', async ({ device }) => {
  const page = (await device('gm', { viewport: { width: 390, height: 844 } })).page;
  await onboardGM(page);
  await go(page, 'workshop');
  const d = statusMaker(page);
  await workshop(page, 'status').locator('[data-new]').tap();
  await d.locator('[data-name]').fill('Resonance');

  await test.step('Stacks: 10 at most, never leave, gone after the fight; at the bearer\'s Vitality 3d6 arcane lands and the stacks are spent', async () => {
    const g = await group(d, 'stacks');
    await expect(g.locator('[data-sum="stacks"]')).toHaveText('Stacks: no');
    await g.locator('[data-k="stack"]').check();
    await g.locator('[data-k="cap"]').fill('10');
    await g.locator('[data-k="th"]').check();
    await g.locator('[data-chips="fgk-at"] [data-chip="formula"]').tap();
    await g.locator('[data-k="thF"]').fill('vit');
    await expect(g.locator('[data-th-fx] [data-row]'), 'what lands starts empty').toHaveCount(0);
    await expect(g.locator('[data-stack-err]')).toHaveText('Add at least one effect for the stack trigger.');
    await g.locator('[data-th-fx] [data-quick] [data-q="damage"]').tap();
    await g.locator('[data-th-fx] [data-row="0"] [data-f="q"]').fill('3d6');
    await expect(g.locator('[data-sum="stacks"]')).toHaveText('Stacks up to 10, at vit: spent');
  });

  await test.step('When: each time its bearer is struck, the other body heals 1d4', async () => {
    const g = await group(d, 'when');
    await g.locator('[data-add-trig]').tap();
    await g.locator('[data-tk="on"]').selectOption('struck');
    await g.locator('[data-chips$="-to"] [data-chip="other"]').tap();
    await g.locator('[data-tfx] [data-quick] [data-q="heal"]').tap();
    await g.locator('[data-tfx] [data-row="0"] [data-f="q"]').fill('1d4');
    await expect(g.locator('[data-sum="when"]')).toHaveText('Triggers: 1');
  });

  await test.step('the preview reads as rules a player understands', async () => {
    const preview = d.locator('.mk-preview');
    await expect(preview).toContainText('Stacks to 10.');
    await expect(preview).toContainText('At vit stacks: Deals 3d6 arcane damage. The stacks are spent.');
    await expect(preview).toContainText('When its bearer is struck: Heal: 1d4 on the other, every time.');
    await expect(preview).toContainText('Removed when the fight ends.');
  });

  await test.step('saved, the library holds what the status reader reads back the same', async () => {
    await d.getByRole('button', { name: 'Save status' }).tap();
    await expect(d).toHaveCount(0);
    const [key, def] = await libraryStatus(page, 'Resonance');
    expect(key).toBe('resonance');
    expect(parseStatusDef(def, RULES)).toEqual(def);
    expect(def.stack).toEqual({
      cap: 10, leave: { kind: 'never' }, keep: 'fight',
      threshold: { at: { kind: 'formula', formula: formulaOf('vit') }, to: { kind: 'bearer' }, then: 'spend',
        ops: [{ op: 'damage', type: 'arcane', amount: { kind: 'dice', count: 3, sides: 6 }, when: 'use' }] },
    });
    expect(def.triggers).toEqual([{ on: 'struck', tag: null, to: 'other', limit: { kind: 'each' }, ops: [{ op: 'heal', amount: { kind: 'dice', count: 1, sides: 4 }, when: 'use' }] }]);
  });

  await test.step('Edit shows every group as saved, and Save leaves it equal', async () => {
    const [, before] = await libraryStatus(page, 'Resonance');
    await workshop(page, 'status').locator('ul.ws-list').first().locator('li', { hasText: 'Resonance' }).locator('.nm').tap();
    await expect(d).toBeVisible();
    await expect(d.locator('[data-sum="stacks"]')).toHaveText('Stacks up to 10, at vit: spent');
    await expect(d.locator('[data-sum="when"]')).toHaveText('Triggers: 1');
    await d.getByRole('button', { name: 'Save status' }).tap();
    await expect(d).toHaveCount(0);
    expect((await libraryStatus(page, 'Resonance'))[1]).toEqual(before);
  });
});

test('a GM makes Hemoplague\'s mark in the status maker: 3 rounds of nothing, then 4d6 arcane when it ends, which a cleanse cancels', async ({ device }) => {
  const page = (await device('gm', { viewport: { width: 390, height: 844 } })).page;
  await onboardGM(page);
  await go(page, 'workshop');
  const d = statusMaker(page);
  await workshop(page, 'status').locator('[data-new]').tap();
  await d.locator('[data-name]').fill('Hemoplague');
  const g = await group(d, 'end');
  await g.locator('[data-k="end"]').check();
  await g.locator('[data-end-fx] [data-quick] [data-q="damage"]').tap();
  await g.locator('[data-end-fx] [data-row="0"] [data-f="q"]').fill('4d6');
  await expect(g.locator('[data-sum="end"]')).toHaveText('When it ends: 1 effect, curing cancels it');
  await expect(d.locator('.mk-preview')).toContainText('When it ends: Deals 4d6 arcane damage. Curing this status cancels it.');
  await d.getByRole('button', { name: 'Save status' }).tap();
  await expect(d).toHaveCount(0);
  const [, def] = await libraryStatus(page, 'Hemoplague');
  expect(def.end).toEqual({ ops: [{ op: 'damage', type: 'arcane', amount: { kind: 'dice', count: 4, sides: 6 }, when: 'use' }], cleanse: 'cancel' });
});

// ── Glas's kit, built through the makers and played ──
const skillMaker = (page: Page) => page.locator('.skm-overlay [role=dialog]');
const librarySkill = (page: Page, name: string) => page.evaluate(n => hunterApp.store.get().library.skills.find((k: any) => k.name === n), name);
/** A C-rank caster's body (Power 63, Control 33, a light kit), as makers.e2e.ts builds its fight rows. */
const caster: Origin = { kind: 'hunter', build: { stats: { ...baseStats(RULES.fight), pow: 63, ctl: 33 }, level: RULES.rankLevels.C, gear: kitGear('light', RULES), perks: {} } };
/** A C-rank boss brute with five times its HP, so it stands through ten Festers and a burst. */
const brute: Origin = { kind: 'monster', name: 'Monster', rank: 'C', archetype: 'brute', monsterKind: 'boss', tweak: { hp: 5, dealt: 1, stats: {}, traits: [] } };
function newRow(name: string, side: 'party' | 'foe', origin: Origin, x: number, abilities: Ability[] = []): NewRow {
  const { sheet } = modified(origin, [], RULES);
  return {
    id: combatantId(name), name, side, kind: side === 'party' ? 'hunter' : 'monster', origin, tier: 2, place: place(x, 6), life: { at: 'up', hp: sheet.hpMax }, mana: sheet.manaMax, fatigue: 0,
    shield: null, stagger: null, channel: null, threat: side === 'foe' ? {} : null, statuses: [], readyAt: {}, abilities, intent: null, holder: null, xp: 0, mythic: null,
  } as NewRow;
}
const ctx: Ctx = { rules: RULES };
const step = (f: Fight | null, cmd: Command): Fight => {
  const r = reduce(f, cmd, ctx), no = r.effects.find(e => e.type === 'refused');
  if (no) throw new Error(`${cmd.type} refused: ${JSON.stringify(no)}`);
  return r.fight!;
};
const rowIn = (f: Fight, id: string) => f.rows.find(r => r.id === id)!;
/** A uses `a` on M, the dice at their lowest faces and M's reaction die a 1 (caught, not resisted). */
const use = (f: Fight, a: Ability, aim: string): Fight =>
  step(f, { type: 'act', by: combatantId('A'), ability: a.id, aim: combatantId(aim), rolls: { dice: a.effect ? { [aim]: diceOf(formulaNow(a, RULES)!).map(x => x.count) } : {}, react: { M: 1, A: 1 } } } as never);
/** M passes until it is A's turn again. */
const toA = (f: Fight): Fight => { let g = f; for (let i = 0; i < 4 && g.phase === 'running' && (g as any).currentId !== 'A'; i++) g = step(g, { type: 'endTurn', by: (g as any).currentId }); return g; };

/** Opens a group of a maker (`prices`, `gates`, `ticks`, `names`, ...) when it is closed. */
async function openGroup(d: Locator, name: string) {
  const g = d.locator(`[data-group="${name}"]`).first();
  if (!(await g.evaluate((el: HTMLDetailsElement) => el.open))) await g.locator('> summary').tap();
  return g;
}

test('a GM builds Glas\'s kit in the makers (Fester by the target\'s Resonance, Hemoplague under Crimson Pact for half max HP, an execute) and a fight plays it: stacks, the burst, the HP paid and the delayed hit', async ({ device }) => {
  test.setTimeout(120_000);
  const page = (await device('gm', { viewport: { width: 390, height: 844 } })).page;
  await onboardGM(page);
  await go(page, 'workshop');
  const sm = statusMaker(page), km = skillMaker(page);
  const newStatus = async (name: string) => { await workshop(page, 'status').locator('[data-new]').tap(); await sm.locator('[data-name]').fill(name); };
  const saveStatus = async () => { await sm.getByRole('button', { name: 'Save status' }).tap(); await expect(sm).toHaveCount(0); };

  await test.step('the statuses: Resonance (stacks to 10, a burst of 3d6 at the bearer\'s Vitality), Hemoplague (4d6 when it ends), Crimson Pact (a mode)', async () => {
    await newStatus('Resonance');
    const g = await group(sm, 'stacks');
    await g.locator('[data-k="stack"]').check();
    await g.locator('[data-k="cap"]').fill('10');
    await g.locator('[data-k="th"]').check();
    await g.locator('[data-chips="fgk-at"] [data-chip="formula"]').tap();
    await g.locator('[data-k="thF"]').fill('vit');
    await g.locator('[data-th-fx] [data-quick] [data-q="damage"]').tap();
    await g.locator('[data-th-fx] [data-row="0"] [data-f="q"]').fill('3d6');
    await saveStatus();
    await newStatus('Hemoplague');
    const e = await group(sm, 'end');
    await e.locator('[data-k="end"]').check();
    await e.locator('[data-end-fx] [data-quick] [data-q="damage"]').tap();
    await e.locator('[data-end-fx] [data-row="0"] [data-f="q"]').fill('4d6');
    await saveStatus();
    await newStatus('Crimson Pact');
    await saveStatus();
  });

  const newSkill = async (name: string, kind: string) => {
    await workshop(page, 'skill').locator('[data-new]').tap();
    await km.locator('#skm-name').fill(name);
    await km.locator(`[data-chips="kind"] [data-chip="${kind}"]`).tap();
  };
  const applyRow = async (status: string, rounds: string) => {
    await km.locator('[data-fx] [data-add]').tap();
    await km.locator('[data-fx] [data-row="0"] [data-f="kind"]').selectOption('applyStatus');
    await km.locator('[data-fx] [data-row="0"] [data-f="status"]').selectOption(status);
    await km.locator('[data-fx] [data-row="0"] [data-f="rounds"]').fill(rounds);
  };
  const saveSkill = async () => { await km.locator('[data-apply]').tap(); await expect(km).toHaveCount(0); };

  await test.step('Fester: a curse whose formula reads the target\'s Resonance, put in with a chip, that adds a Resonance', async () => {
    await newSkill('Fester', 'curse');
    const field = km.locator('[data-formula]');
    await field.fill('0.6 * (2d6 + mag) * (1 + 0.15 * ');
    const names = await openGroup(km, 'names');
    await names.locator('[data-name-key]').selectOption('resonance');
    await names.locator('[data-insert="target.stacks(KEY)"]').tap();
    await field.press('End');
    await field.pressSequentially(')');
    await expect(field).toHaveValue('0.6 * (2d6 + mag) * (1 + 0.15 * target.stacks(resonance))');
    await expect(km.locator('[data-formula-err]')).toHaveText('');
    await applyRow('resonance', '2');
    await expect(km.locator('.mk-preview')).toContainText('Applies Resonance');
    await expect(km.locator('[data-worth-line]')).toContainText('Power rating:');
    await saveSkill();
  });

  await test.step('Crimson Pact: a support on the user that costs half its max HP and puts the Pact on for 3 rounds', async () => {
    await newSkill('Crimson Pact', 'support');
    await km.locator('[data-chips="aim"] [data-chip="self"]').tap();
    await km.locator('[data-chips="ftype"] [data-chip="none"]').tap();
    const g = await openGroup(km, 'prices');
    await g.locator('[data-add="price"]').tap();
    await g.locator('[data-price="0"] [data-f="n"]').fill('50');
    await expect(km.locator('[data-sum="prices"]')).toHaveText('Extra costs: 1 cost');
    await applyRow('crimson-pact', '3');
    await expect(km.locator('.mk-preview')).toContainText('50% of your max HP');
    await saveSkill();
  });

  await test.step('Hemoplague: a curse that only works under the Pact and leaves Hemoplague for 3 rounds', async () => {
    await newSkill('Hemoplague', 'curse');
    await km.locator('[data-chips="ftype"] [data-chip="none"]').tap();
    const g = await openGroup(km, 'gates');
    await g.locator('[data-add="gate"]').tap();
    await g.locator('[data-gate="0"] [data-f="key"]').selectOption('crimson-pact');
    await expect(km.locator('[data-sum="gates"]')).toHaveText('Requirements: 1 condition');
    await applyRow('hemoplague', '3');
    await saveSkill();
  });

  await test.step('Executioner: a strike with the suggested execute, its base cut so it stays at its budget', async () => {
    await newSkill('Executioner', 'strike');
    const g = await openGroup(km, 'ticks');
    await g.locator('[data-add-scaler]').tap();
    await expect(g.locator('[data-sc="0"] [data-sc-f="name"]')).toHaveValue('execute');
    await expect(g.locator('[data-sc="0"] [data-sc-f="start"]')).toHaveValue('50');
    await expect(g.locator('[data-sc="0"] [data-sc-f="scale"]')).toHaveValue('100');
    await expect(km.locator('[data-formula]')).toHaveValue(/target\.missing/);
    await expect(km.locator('.mk-preview')).toContainText('Up to +100% against a target under half of its HP.');
    await expect(km.locator('[data-worth]')).not.toHaveClass(/over/);
    await saveSkill();
  });

  const fester: Ability = (await librarySkill(page, 'Fester')).ability, pact: Ability = (await librarySkill(page, 'Crimson Pact')).ability;
  const hemo: Ability = (await librarySkill(page, 'Hemoplague')).ability, cut: Ability = (await librarySkill(page, 'Executioner')).ability;
  for (const a of [fester, pact, hemo, cut]) expect(parseAbility(a, RULES)).toEqual(a);

  await test.step('in a fight: the Pact takes half of max HP, Hemoplague then lands, each Fester adds a Resonance on the foe\'s chip, and at its Vitality the stacks burst', async () => {
    let f = step(null, { type: 'add', fightId: fightId('f-glas'), rows: [newRow('A', 'party', caster, 4, [fester, pact, hemo, cut]), newRow('M', 'foe', brute, 6)], openings: [] });
    f = step(f, { type: 'start', openings: [{ id: combatantId('A'), d20: 20, tie: 0 }, { id: combatantId('M'), d20: 1, tie: 0 }] });
    const max = rowIn(f, 'A').sheet.hpMax;
    expect(() => use(f, hemo, 'M')).toThrow(/gated/);
    f = use(f, pact, 'A');
    expect(rowHp(rowIn(f, 'A'))).toBe(max - Math.ceil(max / 2));
    f = use(toA(f), hemo, 'M');
    expect(rowIn(f, 'M').statuses.map(s => s.key)).toContain(statusKey('hemoplague'));
    const vit = rowIn(f, 'M').stats.vit, need = Math.max(1, Math.min(10, vit));
    const seen: number[] = [];
    for (let i = 0; i < need; i++) {
      f = use(toA(f), fester, 'M');
      const r = rowIn(f, 'M').statuses.find(s => s.key === 'resonance');
      seen.push(r && 'stacks' in r ? r.stacks! : 0);
      if (i === 0) {
        const doc = fightDoc(f, RULES, { by: 'gm' as never, at: 'now', was: null, keyOf: () => null })!;
        const row = 'rows' in doc ? doc.rows.find(x => x.id === 'M') : null;
        expect(row && row.statuses.find(s => s.key === 'resonance')).toMatchObject({ label: 'Resonance', stacks: 1 });
      }
    }
    expect(seen).toEqual([...Array.from({ length: need - 1 }, (_, i) => i + 1), 0]);
    expect(f.log.some(l => /Resonance/.test(l.text))).toBe(true);
  });

  await test.step('the delayed hit: Hemoplague ends on the foe 3 rounds after it landed, and 4d6 lands as it goes', async () => {
    let f = step(null, { type: 'add', fightId: fightId('f-hemo'), rows: [newRow('A', 'party', caster, 4, [fester, pact, hemo, cut]), newRow('M', 'foe', brute, 6)], openings: [] });
    f = step(f, { type: 'start', openings: [{ id: combatantId('A'), d20: 20, tie: 0 }, { id: combatantId('M'), d20: 1, tie: 0 }] });
    f = use(toA(use(f, pact, 'A')), hemo, 'M');
    const until = rowIn(f, 'M').statuses.find(s => s.key === 'hemoplague')!.until!;
    const before = rowHp(rowIn(f, 'M'));
    let guard = 0;
    while ((f as any).now < until && guard++ < 40) f = step(f, { type: 'endTurn', by: (f as any).currentId });
    for (let i = 0; i < 4 && rowIn(f, 'M').statuses.some(s => s.key === 'hemoplague'); i++) f = step(f, { type: 'endTurn', by: (f as any).currentId });
    expect(rowIn(f, 'M').statuses.some(s => s.key === 'hemoplague')).toBe(false);
    expect(rowHp(rowIn(f, 'M'))).toBeLessThan(before);
  });
});

test('the Workshop\'s kit examples copy into the library with Duplicate, and each copy opens in its maker as it was', async ({ device }) => {
  const page = (await device('gm', { viewport: { width: 390, height: 844 } })).page;
  await onboardGM(page);
  await go(page, 'workshop');
  const R = RULES;
  await test.step('Duplicate on the example Fester puts it in the skills as it is written', async () => {
    const fold = workshop(page, 'skill').locator('[data-examples]');
    await fold.locator('summary').tap();
    await fold.locator('li', { hasText: 'Fester' }).getByRole('button', { name: 'Duplicate Fester' }).tap();
    const { id: _id, ...made } = await librarySkill(page, 'Fester');
    expect(made).toEqual(JSON.parse(JSON.stringify(exampleSkills(R).find(k => k.name === 'Fester'))));
  });
  await test.step('Duplicate on the example Resonance puts it in the statuses under its key', async () => {
    const fold = workshop(page, 'status').locator('[data-examples]');
    await fold.locator('summary').tap();
    await fold.locator('li', { hasText: 'Resonance' }).getByRole('button', { name: 'Duplicate Resonance' }).tap();
    expect((await libraryStatus(page, 'Resonance'))[0]).toBe('resonance');
  });
  for (const k of exampleSkills(R)) {
    await test.step(`${k.name}: copied, it opens in the skill maker, and Save leaves every field equal (prices, conditions, scalers, a reaction, a summon, a worn status)`, async () => {
      const fold = workshop(page, 'skill').locator('[data-examples]');
      if (!(await fold.evaluate((el: HTMLDetailsElement) => el.open))) await fold.locator('summary').tap();
      if (k.name !== 'Fester') await fold.getByRole('button', { name: `Duplicate ${k.name}`, exact: true }).tap();
      const before = await librarySkill(page, k.name);
      await workshop(page, 'skill').locator('ul.ws-list').first().locator('li', { hasText: k.name }).first().locator('.nm').tap();
      await expect(skillMaker(page).locator('#skm-name')).toHaveValue(k.name);
      await skillMaker(page).locator('[data-apply]').tap();
      await expect(skillMaker(page)).toHaveCount(0);
      expect(await librarySkill(page, k.name)).toEqual(before);
    });
  }
});

test('a GM shares a kit as a pack code and another GM\'s Add brings the passive with its trigger, its spender and the status they count', async ({ device }) => {
  const gm = (await device('gm')).page;
  await onboardGM(gm);
  await go(gm, 'workshop');
  await test.step('the kit is made: Pain is Power and Pain copied from the examples', async () => {
    const skills = workshop(gm, 'skill').locator('[data-examples]');
    await skills.locator('summary').tap();
    await skills.getByRole('button', { name: 'Duplicate Pain is Power' }).tap();
    await skills.getByRole('button', { name: 'Duplicate Violence' }).tap();
    const st = workshop(gm, 'status').locator('[data-examples]');
    await st.locator('summary').tap();
    await st.getByRole('button', { name: 'Duplicate Pain' }).tap();
  });
  let code = '';
  await test.step('Data, Share custom content, Everything, Show a code', async () => {
    await go(gm, 'data');
    await gm.locator('#view-data [data-share]').tap();
    await answerWindow(gm, 'Share custom content', 'Everything');
    await answerWindow(gm, 'Share as', 'Show a code');
    const box = gm.locator('.sys-overlay.show [data-pack-code]');
    await expect(box).toHaveValue(/^HS1\./);
    code = await box.inputValue();
    await answerWindow(gm, 'Share code', 'Close');
  });
  await test.step('on another GM\'s phone, Add brings Pain is Power with its trigger, Violence with its price, and Pain', async () => {
    const other = (await device('other')).page;
    await onboardGM(other);
    await go(other, 'data');
    await other.locator('#view-data [data-paste]').fill(code);
    await other.locator('#view-data [data-read-code]').tap();
    await answerWindow(other, 'Import custom content', 'Add');
    const mine = await gm.evaluate(() => hunterApp.store.get().library);
    const theirs = await other.evaluate(() => hunterApp.store.get().library);
    const strip = (xs: any[]) => xs.map(({ id: _id, ...x }) => x);
    expect(strip(theirs.skills)).toEqual(strip(mine.skills));
    expect(theirs.statuses.pain).toEqual(mine.statuses.pain);
    expect(theirs.skills.find((k: any) => k.name === 'Pain is Power').worn.triggers[0].on).toBe('hitDealt');
  });
});

test('a GM makes an item that wears a status in a fight and a monster that starts with 3 Pain, and each reads back as made', async ({ device }) => {
  const page = (await device('gm', { viewport: { width: 390, height: 844 } })).page;
  await onboardGM(page);
  await go(page, 'workshop');
  const st = workshop(page, 'status').locator('[data-examples]');
  await st.locator('summary').tap();
  await st.getByRole('button', { name: 'Duplicate Pain', exact: true }).tap();

  await test.step('the item: a ring whose wearer, each time it is struck, deals 1d6 back to the striker', async () => {
    const d = page.locator('.lf-overlay [role=dialog]');
    await workshop(page, 'item').locator('[data-new]').tap();
    await d.locator('#lf-name').fill('Thorn Ring');
    await d.locator('[data-chips="type"] [data-chip="accessory"]').tap();
    const g = await openGroup(d, 'worn');
    await g.locator('[data-worn-on]').check();
    const w = await openGroup(g, 'when');
    await w.locator('[data-add-trig]').tap();
    await w.locator('[data-tk="on"]').selectOption('struck');
    await w.locator('[data-chips$="-to"] [data-chip="other"]').tap();
    await w.locator('[data-tfx] [data-add]').tap();
    await w.locator('[data-tfx] [data-row="0"] [data-f="kind"]').selectOption('damage');
    await w.locator('[data-tfx] [data-row="0"] [data-f="q"]').fill('1d6');
    await expect(d.locator('.mk-preview')).toContainText('In a fight: When its bearer is struck: Deals 1d6 physical damage on the other, every time.');
    await d.locator('[data-apply]').tap();
    await expect(d).toHaveCount(0);
    const it = await page.evaluate(() => (Object.values(hunterApp.store.get().library.items) as any[]).find(i => i.name === 'Thorn Ring'));
    expect(it.worn).toEqual({ label: 'Thorn Ring', desc: '', ops: [], triggers: [{ on: 'struck', tag: null, to: 'other', limit: { kind: 'each' },
      ops: [{ op: 'damage', type: 'physical', amount: { kind: 'dice', count: 1, sides: 6 }, when: 'use' }] }] });
  });

  await test.step('the monster: Pain at the start, 3 stacks, said in its lines', async () => {
    const d = page.locator('.enm-overlay [role=dialog]');
    await workshop(page, 'monster').locator('[data-new]').tap();
    await d.locator('#enm-name').fill('Einar');
    await d.locator('[data-add="status"]').selectOption('pain');
    await d.locator('[data-stacks="0"]').fill('3');
    await expect(d.locator('.mk-preview')).toContainText('Starts with: 3 Pain');
    await d.getByRole('button', { name: 'Save monster' }).tap();
    await expect(d).toHaveCount(0);
    const m = await page.evaluate(() => hunterApp.store.get().monsters.find((x: any) => x.name === 'Einar'));
    expect(m.statuses).toEqual([{ key: 'pain', rounds: 3, stacks: 3 }]);
  });
});

test('a GM gives a field an upkeep and something that lands on who stands in it when it ends, and the skill reads back with both', async ({ device }) => {
  const page = (await device('gm', { viewport: { width: 390, height: 844 } })).page;
  await onboardGM(page);
  await go(page, 'workshop');
  const km = skillMaker(page);
  await workshop(page, 'skill').locator('[data-new]').tap();
  await km.locator('#skm-name').fill('Boundary');
  await km.locator('[data-chips="kind"] [data-chip="blast"]').tap();
  const z = await openGroup(km, 'zone');
  await z.locator('[data-a="zone"]').check();
  await z.locator('[data-a="zname"]').fill('Boundary');
  await z.locator('[data-a="zupf"]').fill('3');
  await z.locator('[data-a="zupm"]').fill('2');
  await z.locator('[data-a="zend"]').check();
  await expect(z.locator('[data-zend-fx] [data-row]'), 'what lands starts empty').toHaveCount(0);
  await expect(z.locator('[data-zend-err]')).toHaveText('Add at least one effect for when the field ends.');
  await z.locator('[data-zend-fx] [data-quick] [data-q="damage"]').tap();
  await z.locator('[data-zend-fx] [data-row="0"] [data-f="q"]').fill('4d6');
  await expect(z.locator('[data-sum="zone"]')).toContainText('with an upkeep, triggers when it ends');
  await km.locator('[data-apply]').tap();
  await expect(km).toHaveCount(0);
  const zone = (await librarySkill(page, 'Boundary')).ability.zone;
  expect(zone.upkeep).toEqual({ fatigue: 3, mana: 2 });
  expect(zone.end).toEqual([{ op: 'damage', type: 'arcane', amount: { kind: 'dice', count: 4, sides: 6 }, when: 'use' }]);
});

test('a GM builds Einar\'s Harmony boundary: a field that gives one inside it a Harmony stack at each turn start and stuns who stands in it when it ends, and it reads back as made', async ({ device }) => {
  const page = (await device('gm', { viewport: { width: 390, height: 844 } })).page;
  await onboardGM(page);
  await go(page, 'workshop');
  await test.step('Harmony: a status that stacks to 5', async () => {
    const d = statusMaker(page);
    await workshop(page, 'status').locator('[data-new]').tap();
    await d.locator('[data-name]').fill('Harmony');
    const g = await group(d, 'stacks');
    await g.locator('[data-k="stack"]').check();
    await g.locator('[data-k="cap"]').fill('5');
    await d.getByRole('button', { name: 'Save status' }).tap();
    await expect(d).toHaveCount(0);
  });
  const km = skillMaker(page);
  await test.step('the boundary: a field of 5 rounds whose trigger and end are made in the field group', async () => {
    await workshop(page, 'skill').locator('[data-new]').tap();
    await km.locator('#skm-name').fill('Harmony Boundary');
    await km.locator('[data-chips="kind"] [data-chip="blast"]').tap();
    await km.locator('[data-chips="ftype"] [data-chip="none"]').tap();
    const z = await openGroup(km, 'zone');
    await z.locator('[data-a="zone"]').check();
    await z.locator('[data-a="zname"]').fill('Harmony');
    await z.locator('[data-a="zrounds"]').fill('5');
    await z.locator('[data-zone-fx] [data-row="0"] [data-rm]').tap();
    await z.locator('[data-a="zend"]').check();
    await z.locator('[data-zend-fx] [data-add]').tap();
    await z.locator('[data-zend-fx] [data-row="0"] [data-f="kind"]').selectOption('applyStatus');
    await z.locator('[data-zend-fx] [data-row="0"] [data-f="status"]').selectOption('stunned');
    await z.locator('[data-zend-fx] [data-row="0"] [data-f="rounds"]').fill('1');
    const t = z.locator('[data-ztrig]');
    await t.locator('[data-add-trig]').tap();
    await t.locator('[data-tk="on"]').selectOption('turnStart');
    await expect(t.locator('[data-tk="on"] option:checked')).toHaveText('When one inside it starts its turn');
    await t.locator('[data-tfx] [data-add]').tap();
    await t.locator('[data-tfx] [data-row="0"] [data-f="kind"]').selectOption('applyStatus');
    await t.locator('[data-tfx] [data-row="0"] [data-f="status"]').selectOption('harmony');
    await t.locator('[data-tfx] [data-row="0"] [data-f="rounds"]').fill('5');
    await expect(z.locator('[data-sum="zone"]')).toContainText('triggers when it ends, 1 trigger');
    await km.locator('[data-apply]').tap();
    await expect(km).toHaveCount(0);
  });
  await test.step('the skill holds the trigger and the end, the ability reader reads it back the same, and the maker saves it equal', async () => {
    const before = await librarySkill(page, 'Harmony Boundary'), zone = before.ability.zone;
    expect(parseAbility(before.ability, RULES)).toEqual(before.ability);
    expect(zone.triggers.map((x: any) => [x.on, x.to, x.limit, x.ops.map((o: any) => [o.op, o.key, o.duration])]))
      .toEqual([['turnStart', 'self', { kind: 'each' }, [['applyStatus', 'harmony', 5 * RULES.fight.round]]]]);
    expect(zone.end.map((o: any) => [o.op, o.key, o.duration])).toEqual([['applyStatus', 'stunned', RULES.fight.round]]);
    expect(zone.ops).toEqual([]);
    await workshop(page, 'skill').locator('ul.ws-list').first().locator('li', { hasText: 'Harmony Boundary' }).first().locator('.nm').tap();
    await expect(km.locator('#skm-name')).toHaveValue('Harmony Boundary');
    await expect(km.locator('[data-ztrig] [data-tk="on"]')).toHaveValue('turnStart');
    await km.locator('[data-apply]').tap();
    await expect(km).toHaveCount(0);
    expect(await librarySkill(page, 'Harmony Boundary')).toEqual(before);
  });
});

test('a GM gives a summon a status it starts with, and the skill reads back with it', async ({ device }) => {
  const page = (await device('gm', { viewport: { width: 390, height: 844 } })).page;
  await onboardGM(page);
  await go(page, 'workshop');
  const km = skillMaker(page);
  await workshop(page, 'skill').locator('[data-new]').tap();
  await km.locator('#skm-name').fill('Call Wisp');
  await km.locator('[data-chips="kind"] [data-chip="support"]').tap();
  await km.locator('[data-chips="aim"] [data-chip="self"]').tap();
  await km.locator('[data-chips="ftype"] [data-chip="none"]').tap();
  const g = await openGroup(km, 'summon');
  await g.locator('[data-f="summon"]').check();
  await g.locator('[data-add="sstat"]').tap();
  await g.locator('[data-sstat="0"] [data-f="key"]').selectOption('hasted');
  await g.locator('[data-sstat="0"] [data-f="rounds"]').fill('2');
  await expect(g.locator('[data-sum="summon"]')).toHaveText('Summons Sprite for 2 rounds, starting with a status');
  await km.locator('[data-apply]').tap();
  await expect(km).toHaveCount(0);
  const before = await librarySkill(page, 'Call Wisp');
  expect(before.ability.summon.statuses).toEqual([{ key: 'hasted', rounds: 2 }]);
  expect(parseAbility(before.ability, RULES)).toEqual(before.ability);
  await workshop(page, 'skill').locator('ul.ws-list').first().locator('li', { hasText: 'Call Wisp' }).first().locator('.nm').tap();
  await expect(km.locator('[data-sstat="0"] [data-f="key"]')).toHaveValue('hasted');
  await km.locator('[data-apply]').tap();
  await expect(km).toHaveCount(0);
  expect(await librarySkill(page, 'Call Wisp')).toEqual(before);
});

test('a status list longer than a phone shows has a search above it: what the GM types hides the statuses it does not match, and the pick still saves', async ({ device }) => {
  const page = (await device('gm', { viewport: { width: 390, height: 844 } })).page;
  await onboardGM(page);
  await go(page, 'workshop');
  const km = skillMaker(page);
  await workshop(page, 'skill').locator('[data-new]').tap();
  await km.locator('#skm-name').fill('Open Vein');
  await km.locator('[data-fx] [data-add]').tap();
  await km.locator('[data-fx] [data-row="0"] [data-f="kind"]').selectOption('applyStatus');
  const row = km.locator('[data-fx] [data-row="0"]'), pick = row.locator('[data-f="status"]');
  await row.getByRole('searchbox').fill('bleed');
  expect(await pick.evaluate((s: HTMLSelectElement) => [...s.options].filter(o => !o.hidden).map(o => o.text))).toEqual(['Pick a status', 'Bleeding']);
  await pick.selectOption('bleeding');
  await km.locator('[data-fx] [data-row="0"] [data-f="rounds"]').fill('2');
  await km.locator('[data-apply]').tap();
  await expect(km).toHaveCount(0);
  expect((await librarySkill(page, 'Open Vein')).ability.ops.map((o: any) => o.key)).toEqual(['bleeding']);
});
