// The NPC builder (src/views/npc-maker.js) and the Workshop's NPCs section (src/views/workshop.js):
// create, Copy NPC, edit, delete, the "How well this NPC plays" 5-step slider, power readout and ally over-budget
// warning, abilities/statuses/tweaks/notes, and the 360 px single-column layout.
import type { Page } from '@playwright/test';
import { test, expect, setupGoblinDenGM, go, answerWindow, SMALL_PHONE } from './helpers.ts';
import { RULES, rulesOf } from '../../src/core/rules.ts';
import { parseOverrides } from '../../src/core/overrides.ts';
import { ALLY_OVER_BUDGET_WARNING, NPC_NAME_SEEDS, NPC_SKILL_INFO, NPC_SKILLS, newNpc, npcSkillReadout, npcWorth } from '../../src/core/registry/npcs.ts';

const npcSection = (page: Page) => page.locator('#view-workshop [data-ws="npc"]');
const npcMaker = (page: Page) => page.locator('.npcm-overlay [role=dialog]');
const underMore = (page: Page, label: string) =>
  page.locator('.sys-overlay.show .sys-actions button', { hasText: label }).first().tap();

test('a GM creates an NPC in the Workshop, uses Roll a name and the skill slider, sees the ally power warning, and saves it', async ({ device }) => {
  const page = (await device('gm')).page;
  await setupGoblinDenGM(page);
  await go(page, 'workshop');

  const sec = npcSection(page);
  const d = npcMaker(page);

  await test.step('the empty NPCs section describes NPCs and offers New NPC', async () => {
    await expect(sec.locator('.ws-empty')).toHaveText('An NPC is a hunter that no player controls. It fights for the hunters or for the foes, and it takes its turns automatically.');
    await expect(sec.locator('[data-new]')).toHaveText('New NPC');
  });

  await test.step('New NPC opens with default Support ally (~0.65x), Steady (3 of 5), and Roll a name fills the input', async () => {
    await sec.locator('[data-new]').tap();
    await expect(d.getByRole('heading', { name: 'New NPC' })).toBeVisible();
    await expect(d.locator('[data-chips="side"] [data-chip="party"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(d.locator('[data-chips="preset"] [data-chip="support"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(d.locator('#npcm-skill')).toHaveValue('3');
    await expect(d.locator('[data-npc-skill-name]')).toHaveText('Steady (3 of 5)');
    await expect(d.locator('[data-npc-skill-out]')).toHaveText(NPC_SKILL_INFO[3].readout);
    await expect(d.locator('[data-power-summary]')).toHaveText(npcWorth(newNpc({}, RULES), RULES).summary);
    await expect(d.locator('[data-power-warn]')).toBeHidden();

    await d.locator('[data-roll-name]').tap();
    const rolled = await d.locator('#npcm-name').inputValue();
    expect(NPC_NAME_SEEDS).toContain(rolled);
    await d.locator('#npcm-name').fill('Han Seo-jun');
  });

  await test.step('switching side on an untouched new NPC swaps between Support ally and Standard, while explicit preset picks and typed multipliers stay put', async () => {
    await d.locator('[data-group="tweaks"] summary').tap();
    await expect(d.locator('#npcm-hp')).toHaveValue('1.08');
    await expect(d.locator('#npcm-dealt')).toHaveValue('0.93');

    await d.locator('[data-chips="side"] [data-chip="foe"]').tap();
    await expect(d.locator('[data-chips="preset"] [data-chip="standard"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(d.locator('#npcm-hp')).toHaveValue('1');
    await expect(d.locator('#npcm-dealt')).toHaveValue('1');

    await d.locator('[data-chips="side"] [data-chip="party"]').tap();
    await expect(d.locator('[data-chips="preset"] [data-chip="support"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(d.locator('#npcm-hp')).toHaveValue('1.08');
    await expect(d.locator('#npcm-dealt')).toHaveValue('0.93');

    await d.locator('[data-chips="preset"] [data-chip="standard"]').tap();
    await expect(d.locator('#npcm-hp')).toHaveValue('1');
    await d.locator('[data-chips="side"] [data-chip="foe"]').tap();
    await d.locator('[data-chips="side"] [data-chip="party"]').tap();
    await expect(d.locator('[data-chips="preset"] [data-chip="standard"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(d.locator('#npcm-hp')).toHaveValue('1');

    await d.locator('#npcm-hp').fill('1.4');
    await d.locator('[data-chips="preset"] [data-chip="standard"]').tap();
    await expect(d.locator('#npcm-hp')).toHaveValue('1.4');

    await d.locator('[data-chips="preset"] [data-chip="support"]').tap();
    await expect(d.locator('#npcm-hp')).toHaveValue('1.08');
  });

  await test.step('moving the skill slider walks through all 5 named steps and updates the readout and aria-valuetext', async () => {
    const slider = d.locator('#npcm-skill');
    for (const step of NPC_SKILLS) {
      await slider.fill(String(step));
      const info = NPC_SKILL_INFO[step];
      await expect(d.locator('[data-npc-skill-name]')).toHaveText(`${info.name} (${step} of 5)`);
      await expect(d.locator('[data-npc-skill-out]')).toHaveText(info.readout);
      await expect(slider).toHaveAttribute('aria-valuetext', info.readout);
    }
    await slider.fill('4');
  });

  await test.step('choosing Elite as an ally shows the over-budget warning, switching to Foes clears it, and Support ally clears it', async () => {
    await d.locator('[data-chips="preset"] [data-chip="elite"]').tap();
    await expect(d.locator('[data-power]')).toHaveClass(/over/);
    await expect(d.locator('[data-power-warn]')).toBeVisible();
    await expect(d.locator('[data-power-warn]')).toHaveText(ALLY_OVER_BUDGET_WARNING);

    await d.locator('[data-chips="side"] [data-chip="foe"]').tap();
    await expect(d.locator('[data-power-warn]')).toBeHidden();
    await expect(d.locator('[data-power]')).not.toHaveClass(/over/);

    await d.locator('[data-chips="side"] [data-chip="party"]').tap();
    await expect(d.locator('[data-power-warn]')).toBeVisible();

    await d.locator('[data-chips="preset"] [data-chip="support"]').tap();
    await expect(d.locator('[data-power-warn]')).toBeHidden();
  });

  await test.step('adding an ability, starting status, and GM note saves the NPC to the library and lists it in the Workshop', async () => {
    await d.locator('[data-chips="rank"] [data-chip="C"]').tap();
    await d.locator('[data-chips="archetype"] [data-chip="caster"]').tap();
    const abSel = d.locator('[data-add="ability"]');
    await abSel.scrollIntoViewIfNeeded();
    await abSel.selectOption({ index: 1 });
    await expect(d.locator('[data-abilities] li')).toHaveCount(1);
    await expect(d.locator('[data-abilities] .worth')).toBeVisible();

    const stSel = d.locator('[data-add="status"]');
    await stSel.selectOption('hasted');
    await expect(d.locator('[data-statuses] li')).toHaveCount(1);

    await d.locator('#npcm-notes').fill('Stays back and shields wounded rookies.');
    await d.locator('[data-apply]').tap();
    await expect(d).toHaveCount(0);

    await expect(sec.locator('.ws-list li', { hasText: 'Han Seo-jun' })).toContainText('C-rank Ally · support ally caster');
    await expect(sec.locator('.ws-list li', { hasText: 'Han Seo-jun' })).toContainText(`Plays ${NPC_SKILL_INFO[4].name.toLowerCase()}`);

    const saved = await page.evaluate(() => hunterApp.store.get().library.npcs);
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({
      name: 'Han Seo-jun',
      rank: 'C',
      archetype: 'caster',
      tier: 'normal',
      defaultSide: 'party',
      skill: 4,
      notes: 'Stays back and shields wounded rookies.',
    });
    expect(saved[0].abilities).toHaveLength(1);
    expect(saved[0].statuses).toEqual([{ key: 'hasted', rounds: 3 }]);
  });
});

test('a GM copies an NPC from the Workshop and from Edit NPC, edits one, and deletes both', async ({ device }) => {
  const page = (await device('gm')).page;
  await setupGoblinDenGM(page);
  await go(page, 'workshop');

  const sec = npcSection(page);
  const d = npcMaker(page);

  await sec.locator('[data-new]').tap();
  await d.locator('#npcm-name').fill('Sera Vance');
  await d.locator('[data-chips="rank"] [data-chip="B"]').tap();
  await d.locator('[data-apply]').tap();
  await expect(d).toHaveCount(0);

  await test.step('Copy NPC under ⋯ in the Workshop creates an independent copy', async () => {
    await sec.locator('li', { hasText: 'Sera Vance' }).getByRole('button', { name: 'More for Sera Vance' }).tap();
    await underMore(page, 'Copy NPC');
    await expect(sec.locator('.ws-list li')).toHaveCount(2);
    await expect(sec.locator('.ws-list li', { hasText: 'Sera Vance (copy)' })).toHaveCount(1);
  });

  await test.step('Edit NPC updates fields, and Copy NPC in the maker footer makes a third copy', async () => {
    await sec.locator('li', { hasText: 'Sera Vance (copy)' }).locator('[data-act="edit"]').tap();
    await expect(d.getByRole('heading', { name: 'Edit NPC' })).toBeVisible();
    await d.locator('#npcm-name').fill('Sera Rival');
    await d.locator('[data-chips="side"] [data-chip="foe"]').tap();
    await d.locator('[data-chips="preset"] [data-chip="elite"]').tap();
    await d.locator('#npcm-skill').fill('5');
    await d.locator('[data-apply]').tap();
    await expect(d).toHaveCount(0);

    await expect(sec.locator('li', { hasText: 'Sera Rival' })).toContainText('B-rank Foe · elite brute');
    await expect(sec.locator('li', { hasText: 'Sera Rival' })).toContainText(`Plays ${NPC_SKILL_INFO[5].name.toLowerCase()}`);

    await sec.locator('li', { hasText: 'Sera Rival' }).locator('[data-act="edit"]').tap();
    const copyBtn = d.locator('[data-copy-npc]');
    await copyBtn.scrollIntoViewIfNeeded();
    await expect(copyBtn).toHaveText('Copy NPC');
    await copyBtn.tap();
    await expect(d).toHaveCount(0);
    await expect(sec.locator('.ws-list li')).toHaveCount(3);
    await expect(sec.locator('li', { hasText: 'Sera Rival (copy)' })).toHaveCount(1);
  });

  await test.step('Delete NPC in Edit NPC and under ⋯ names gates holding the NPC and removes all three', async () => {
    // Place Sera Rival (copy) and Sera Vance in Goblin Den so both delete confirms name it; leave Sera Rival unplaced.
    await page.evaluate(() => {
      hunterApp.store.update((d: any) => {
        const copyNpc = d.library.npcs.find((n: any) => n.name === 'Sera Rival (copy)');
        const vance = d.library.npcs.find((n: any) => n.name === 'Sera Vance');
        const den = d.gates.find((g: any) => g.name === 'Goblin Den');
        if (den && copyNpc && vance) {
          den.npcs = [
            { npcId: copyNpc.id, count: 1, side: 'foe' },
            { npcId: vance.id, count: 1, side: 'party' },
          ];
        }
      }, 'test-setup');
    });

    await sec.locator('li', { hasText: 'Sera Rival (copy)' }).locator('[data-act="edit"]').tap();
    const delBtn = d.locator('[data-del-npc]');
    await delBtn.scrollIntoViewIfNeeded();
    await expect(delBtn).toHaveText('Delete NPC');
    await delBtn.tap();
    await expect(page.locator('.sys-overlay.show').last()).toContainText('Goblin Den');
    await answerWindow(page, 'Delete Sera Rival (copy)?', 'Delete NPC');
    await expect(d).toHaveCount(0);
    await expect(sec.locator('.ws-list li')).toHaveCount(2);

    await sec.locator('li', { hasText: 'Sera Rival' }).getByRole('button', { name: 'More for Sera Rival' }).tap();
    await underMore(page, 'Delete');
    await expect(page.locator('.sys-overlay.show').last()).not.toContainText('Goblin Den');
    await answerWindow(page, 'Delete Sera Rival?', 'Delete NPC');

    await sec.locator('li', { hasText: 'Sera Vance' }).getByRole('button', { name: 'More for Sera Vance' }).tap();
    await underMore(page, 'Delete');
    await expect(page.locator('.sys-overlay.show').last()).toContainText('Goblin Den');
    await answerWindow(page, 'Delete Sera Vance?', 'Delete NPC');

    await expect(sec.locator('.ws-list li')).toHaveCount(0);
    await expect(sec.locator('.ws-empty')).toBeVisible();
  });
});

test('GM overrides update the skill slider readout (both on open and while moving) and Roll a name uses a custom GM NPC name table', async ({ device }) => {
  const page = (await device('gm')).page;
  await setupGoblinDenGM(page);

  const customNames = ['Kaelen Dusk', 'Lyra Ash'];
  const ov = parseOverrides({ fight: { npc: { defaultSkill: 1, skill: { 1: { skip: 0.3 } } } } });
  expect(ov.refused).toEqual([]);
  const customRules = rulesOf(ov.overrides);
  const expectedStep1 = npcSkillReadout(1, customRules);
  expect(expectedStep1).toContain('30% chance');
  expect(expectedStep1).not.toContain('65%');

  await page.evaluate(([overrides, names]) => hunterApp.store.update((d: any) => {
    d.rulesOverrides = { ...overrides, gmTables: { npc: names } };
  }, 'test-setup'), [ov.overrides, customNames] as const);

  await go(page, 'workshop');
  await npcSection(page).locator('[data-new]').tap();
  const d = npcMaker(page);
  await expect(d.getByRole('heading', { name: 'New NPC' })).toBeVisible();

  await test.step('initial slider render and live movement both read the GM override through npcSkillReadout', async () => {
    const slider = d.locator('#npcm-skill');
    await expect(slider).toHaveValue('1');
    await expect(d.locator('[data-npc-skill-out]')).toHaveText(expectedStep1);
    await expect(slider).toHaveAttribute('aria-valuetext', expectedStep1);

    await slider.fill('3');
    await expect(d.locator('[data-npc-skill-out]')).toHaveText(npcSkillReadout(3, customRules));
    await slider.fill('1');
    await expect(d.locator('[data-npc-skill-out]')).toHaveText(expectedStep1);
    await expect(slider).toHaveAttribute('aria-valuetext', expectedStep1);
  });

  await test.step('Roll a name draws from rulesOverrides.gmTables.npc and avoids repeating the current name', async () => {
    await d.locator('[data-roll-name]').tap();
    const first = await d.locator('#npcm-name').inputValue();
    expect(customNames).toContain(first);

    await d.locator('[data-roll-name]').tap();
    const second = await d.locator('#npcm-name').inputValue();
    expect(customNames).toContain(second);
    expect(second).not.toBe(first);
  });
});

test('on a 360 px phone the NPC maker stays single-column with no sideways overflow and every control (including ability and stacking status rows) at least 44 px tall', async ({ device }) => {
  const page = (await device('gm', { viewport: SMALL_PHONE })).page;
  await setupGoblinDenGM(page);
  await page.evaluate(() => hunterApp.store.update((d: any) => {
    d.library.statuses.ember = { label: 'Ember', desc: 'Stacks of heat.', ops: [], stack: { cap: 5, leave: { kind: 'never' }, keep: 'fight', threshold: null } };
  }, 'test-setup'));
  await go(page, 'workshop');

  await npcSection(page).locator('[data-new]').tap();
  const d = npcMaker(page);
  await expect(d.getByRole('heading', { name: 'New NPC' })).toBeVisible();
  // Wait for data-later to reveal below-fold sections before adding dense rows and measuring all controls.
  await expect(d.locator('#npcm-notes')).toBeVisible();

  const abSel = d.locator('[data-add="ability"]');
  await abSel.scrollIntoViewIfNeeded();
  await abSel.selectOption({ index: 1 });
  await expect(d.locator('[data-abilities] [data-edit-ability="0"]')).toBeVisible();
  await expect(d.locator('[data-abilities] [data-rm="ability"]')).toBeVisible();

  const stSel = d.locator('[data-add="status"]');
  await stSel.scrollIntoViewIfNeeded();
  await stSel.selectOption('ember');
  await expect(d.locator('[data-statuses] [data-rounds="0"]')).toBeVisible();
  await expect(d.locator('[data-statuses] [data-stacks="0"]')).toBeVisible();
  await expect(d.locator('[data-statuses] [data-rm="status"]')).toBeVisible();

  await d.locator('[data-group="tweaks"] summary').tap();
  await expect(d.locator('#npcm-hp')).toBeVisible();
  await d.locator('[data-chips="preset"] [data-chip="boss"]').tap();
  await expect(d.locator('[data-power-warn]')).toBeVisible();

  await expect.poll(() => page.evaluate(() => document.getAnimations().filter(a => a.playState === 'running').length)).toBe(0);

  const audit = await d.evaluate(win => {
    const wStyle = getComputedStyle(win);
    const wRect = win.getBoundingClientRect();
    const minLeft = wRect.left + parseFloat(wStyle.paddingLeft) - 1;
    const maxRight = wRect.right - parseFloat(wStyle.paddingRight) + 1;
    const labelOf = (el: Element) => (el.getAttribute('aria-label') || el.textContent || el.id || el.tagName).trim().slice(0, 30);
    const controls = [...win.querySelectorAll('button, input:not([type=checkbox]), select')].filter(
      el => (el as HTMLElement).offsetParent !== null,
    );
    const short = controls
      .filter(el => el.getBoundingClientRect().height < 44)
      .map(labelOf);
    const outside = [...win.querySelectorAll('button, input:not([type=checkbox]), select, textarea')]
      .filter(el => (el as HTMLElement).offsetParent !== null)
      .filter(el => {
        const r = el.getBoundingClientRect();
        return r.left < minLeft || r.right > maxRight || r.left < 0 || r.right > innerWidth;
      })
      .map(labelOf);
    const scroll = win.querySelector('.mk-scroll') as HTMLElement | null;
    const scrollOverflow = !!(scroll && scroll.scrollWidth > scroll.clientWidth + 1);
    const hpBox = win.querySelector('#npcm-hp')?.getBoundingClientRect();
    const dealtBox = win.querySelector('#npcm-dealt')?.getBoundingClientRect();
    const singleColMults = !!(hpBox && dealtBox && dealtBox.top >= hpBox.bottom - 1);
    return {
      short,
      outside,
      scrollOverflow,
      singleColMults,
      pageOverflow: document.documentElement.scrollWidth - innerWidth,
    };
  });

  expect(audit).toEqual({ short: [], outside: [], scrollOverflow: false, singleColMults: true, pageOverflow: 0 });
});
