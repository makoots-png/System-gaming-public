import { RULES } from '../../src/core/rules.ts';
import { abilityId } from '../../src/core/combat/ability-types.ts';
import { abilityOf } from '../../src/core/registry/ability-kinds.ts';
import { test, expect, onboardGM, onboardPlayer, createRoom, dismissAll, go, activeHunter, answerWindow, startGoblinDenFight, chooseList, fightRow, type Page } from './helpers.ts';

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

/** A reward that uses the fields unit 3 adds: a custom title with +2 STR, a skill, a status for 3 rounds and a boon. */
const REWARD = {
  title: { name: 'Gatebreaker', desc: 'Broke a red gate.', bonus: { str: 2 } },
  skills: [{ name: 'Shield Bash', type: 'active', desc: 'Slam the shield into a foe.' }],
  statuses: [{ key: 'hasted', rounds: 3 }],
  boons: [{ name: 'Free resurrection', text: 'Once, the GM brings you back at 1 HP.' }],
};

test('a GM award with a custom title, a skill, a status and a boon (posted to the room) shows on the player\'s sheet', async ({ device }) => {
  const { gm, player, key } = await room(device);

  await test.step('the GM sends the award', async () => {
    const sent = await gm.evaluate(([to, rewards]) => hunterApp.api.sync.post(hunterApp.api.sync.event('award', { to: [to], rewards })), [key, REWARD] as const);
    expect(sent.ok).toBe(true);
  });

  await test.step('the player sees the reward window with every line', async () => {
    const win = player.locator('.sys-overlay.show', { hasText: 'REWARD RECEIVED' });
    await expect(win).toBeVisible({ timeout: 15_000 });
    for (const line of ['Title acquired: Gatebreaker', 'Skill acquired: Shield Bash', 'Status: Hasted (3 rounds)', 'Boon: Free resurrection']) await expect(win).toContainText(line);
    await dismissAll(player, 4);
  });

  await test.step('the sheet shows the title\'s bonus, the skill, the status chip and the boon', async () => {
    await go(player, 'status');
    const titles = player.locator('[data-panel="titles"]');
    await expect(titles.locator('[data-tlist] li', { hasText: 'Gatebreaker' })).toContainText('+2 STR');
    await expect(player.locator('[data-panel="skills"] [data-list]')).toContainText('Shield Bash');
    await expect(player.locator('#view-status [data-chips]')).toContainText('Hasted · 3 rounds');
    await expect(titles.locator('[data-boons] li', { hasText: 'Free resurrection' })).toContainText('Once, the GM brings you back at 1 HP.');
    const h = await activeHunter(player);
    expect(h.boons).toHaveLength(1);
    expect(h.skills.filter((s: { name: string }) => s.name === 'Shield Bash')).toHaveLength(1);
  });

  await test.step('with the title set active its +2 STR counts on the sheet', async () => {
    const before = (await activeHunter(player)).derived.stats.str;
    await player.locator('[data-panel="titles"] [data-tlist] li', { hasText: 'Gatebreaker' }).locator('[data-tset]').tap();
    await expect.poll(async () => (await activeHunter(player)).derived.stats.str).toBe(before + 2);
  });
});

test('the GM saves the Award form\'s reward as a bundle, and picking the bundle later fills the reward editor with every part', async ({ device }) => {
  const gm = (await device('gm')).page;
  await onboardGM(gm);
  await go(gm, 'gm');
  const toggle = gm.locator('[data-tog="award"]');
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.tap();
  const ed = gm.locator('#gm-rw');

  await test.step('the GM fills XP, adds the built-in title Wolf Slayer and saves the reward as the bundle "Wolf pack"', async () => {
    await gm.fill('#gm-xp', '40');
    await ed.locator('[data-add="title"]').tap();
    await ed.locator('[data-kind="title"] [data-f="tpick"]').selectOption('Wolf Slayer');
    await ed.locator('[data-rw-save]').tap();
    const win = gm.locator('.sys-overlay.show', { hasText: 'Save as bundle' });
    await expect(win).toBeVisible();
    await win.locator('input').fill('Wolf pack');
    await win.locator('.sys-actions button.primary').tap();
    await expect(ed.locator('[data-rw-say]')).toContainText('Saved bundle "Wolf pack".');
    const saved = await gm.evaluate(() => hunterApp.store.get().library.rewards);
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ name: 'Wolf pack', rewards: { xp: 40, title: { name: 'Wolf Slayer', bonus: { str: 2 } } } });
  });

  await test.step('a bundle with a boon, picked from the Bundle select, fills the editor with its gold and its boon row', async () => {
    await gm.evaluate(() => hunterApp.api.bundles.save('Boss chest', { ...hunterApp.store.get().library.rewards[0].rewards, xp: 0, gold: 300, title: null, boons: [{ name: 'Free resurrection', text: 'Once.' }] }));
    await ed.locator('[data-rw-bundle]').selectOption({ label: 'Boss chest' });
    await expect(gm.locator('#gm-gold')).toHaveValue('300');
    await expect(ed.locator('[data-kind="boon"] [data-f="name"]')).toHaveValue('Free resurrection');
    await expect(ed.locator('[data-kind="title"]')).toHaveCount(0);
    await ed.locator('[data-rw-bundle]').selectOption({ label: 'Wolf pack' });
    await expect(gm.locator('#gm-xp')).toHaveValue('40');
    await expect(ed.locator('[data-kind="title"] [data-f="name"]')).toHaveValue('Wolf Slayer');
  });

  await test.step('the award of the boss chest to Brakk gives him the gold and the boon', async () => {
    await ed.locator('[data-rw-bundle]').selectOption({ label: 'Boss chest' });
    const brakk = await gm.evaluate(() => hunterApp.store.get().hunters.find((h: any) => h.name === 'Brakk Ironhide'));
    await gm.locator('#gm-targets label', { hasText: 'Brakk Ironhide' }).locator('input').check();
    await gm.locator('#gm-award-go').tap();
    await dismissAll(gm, 4);
    const after = await gm.evaluate(() => hunterApp.store.get().hunters.find((h: any) => h.name === 'Brakk Ironhide'));
    expect(after.gold).toBe(brakk.gold + 300);
    expect(after.boons.map((b: { name: string }) => b.name)).toEqual(['Free resurrection']);
  });
});

test('the GM issues a Job Change to a player in a room, and the player\'s Quests view shows step 1', async ({ device }) => {
  const { gm, player } = await room(device);

  await test.step('the GM picks the player\'s hunter and Ranger in Issue Job Change Quest', async () => {
    await go(gm, 'quests');
    await gm.locator('#view-quests [data-chain]').tap();
    await answerWindow(gm, 'Issue to', 'Mira Test (player)');
    await answerWindow(gm, 'Choose the job', 'Ranger');
    await expect(gm.locator('#toasts .toast', { hasText: 'Job Change quest sent (Ranger).' })).toBeVisible();
  });

  await test.step('the player is told, and step 1 of the Ranger chain is in their Quests', async () => {
    await expect(player.locator('.sys-overlay.show', { hasText: 'JOB CHANGE QUEST' })).toBeVisible({ timeout: 15_000 });
    await dismissAll(player, 4);
    const h = await activeHunter(player);
    expect(h.jobChain).toMatchObject({ job: 'Ranger', step: 1, status: 'active' });
    const step1 = h.quests.find((q: { id: string }) => q.id === h.jobChain.questId);
    await go(player, 'quests');
    await expect(player.locator('#view-quests .qc.kind-job .qc-title')).toHaveText(step1.title);
  });
});

test('a player in a room gets no Edit, no Delete and no minus or plus on the Job Change step the GM issued, and Complete and Fail stay', async ({ device }) => {
  const { gm, player } = await room(device);

  await test.step('the GM issues Ranger to the player', async () => {
    await go(gm, 'quests');
    await gm.locator('#view-quests [data-chain]').tap();
    await answerWindow(gm, 'Issue to', 'Mira Test (player)');
    await answerWindow(gm, 'Choose the job', 'Ranger');
    await expect(player.locator('.sys-overlay.show', { hasText: 'JOB CHANGE QUEST' })).toBeVisible({ timeout: 15_000 });
    await dismissAll(player, 4);
  });

  await test.step('step 1 shows Complete and Fail, Reach Level 10 as a count with no buttons, and no Edit or Delete', async () => {
    await go(player, 'quests');
    const card = player.locator('#view-quests .qc.kind-job');
    await expect(card.locator('.qa button')).toHaveText(['Complete', 'Fail']);
    const goal = card.locator('.qo', { hasText: 'Reach Level 10' });
    await expect(goal.locator('.qo-v')).toHaveText('1/10');
    await expect(goal.locator('button')).toHaveCount(0);
    expect((await activeHunter(player)).jobChain).toMatchObject({ job: 'Ranger', step: 1, status: 'active' });
  });
});

test('a GM takes a boon back from a hunter on this phone: the Boons block goes, and no use is written to the log', async ({ device }) => {
  const gm = (await device('gm')).page;
  await onboardGM(gm);
  await gm.evaluate(() => { const s = hunterApp.store; s.update(() => { s.active().boons.push({ id: s.id('bn'), name: 'Free resurrection', text: 'Once.', at: '2026-11-13T00:00:00.000Z' }); }, 'test-setup'); });
  await go(gm, 'status');
  const titles = gm.locator('[data-panel="titles"]');
  await expect(titles.locator('[data-boons] li')).toHaveCount(1);
  await titles.locator('[data-boondel]').tap();
  await answerWindow(gm, 'Remove boon?', 'Remove');
  await expect(titles.locator('[data-boonwrap]')).toBeHidden();
  expect((await activeHunter(gm)).boons).toEqual([]);
  expect(await gm.evaluate(() => hunterApp.store.get().log.filter((l: any) => l.kind === 'use').length)).toBe(0);
});

test('the GM awards the title Square in place of Owed to the Deep: the hunter keeps one title, still active, now named Square, and the reward window names both', async ({ device }) => {
  const gm = (await device('gm')).page;
  await onboardGM(gm);
  const held = await gm.evaluate(() => {
    const s = hunterApp.store, id = s.id('t') as string;
    s.update(() => { const h = s.active(); h.titles.push({ id, name: 'Owed to the Deep', desc: 'It is owed.', bonus: { hpMax: -10 } }); h.titleId = id; }, 'test-setup');
    return { id, name: s.active().name as string, titles: s.active().titles.length as number };
  });
  const hpMax = (await activeHunter(gm)).derived.hpMax;
  await go(gm, 'gm');
  const toggle = gm.locator('[data-tog="award"]');
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.tap();
  const ed = gm.locator('#gm-rw'), row = ed.locator('[data-kind="title"]');

  await test.step('the title row has In place of, and the preview names both titles', async () => {
    await ed.locator('[data-add="title"]').tap();
    await row.locator('[data-f="name"]').fill('Square');
    await expect(row.locator('label.field', { hasText: 'In place of' })).toBeVisible();
    await expect(row).toContainText('The hunter\'s title of this name becomes this one. If the hunter does not hold it, or this is empty, they get a new title.');
    await row.locator('[data-f="replaces"]').fill('Owed to the Deep');
    await row.locator('[data-bonus="hpMax"]').fill('10');
    await expect(ed.locator('.rw-preview')).toContainText('Title acquired: Square (in place of Owed to the Deep)');
  });

  await test.step('the award is sent to the hunter, whose window says which title it replaced', async () => {
    await gm.locator('#gm-targets label', { hasText: held.name }).locator('input').check();
    await gm.locator('#gm-award-go').tap();
    await expect(gm.locator('.sys-overlay.show', { hasText: 'Title acquired: Square (in place of Owed to the Deep)' })).toBeVisible();
    await dismissAll(gm, 4);
  });

  await test.step('the hunter holds Square under the old title\'s id, still active, and its bonus is on the sheet', async () => {
    const h = await activeHunter(gm);
    expect(h.titles).toHaveLength(held.titles);
    expect(h.titles.find((t: { id: string }) => t.id === held.id)).toMatchObject({ name: 'Square', bonus: { hpMax: 10 } });
    expect(h.titleId).toBe(held.id);
    expect(h.derived.hpMax, 'from 10 less max HP to 10 more').toBe(hpMax + 20);
    await go(gm, 'status');
    const list = gm.locator('[data-panel="titles"] [data-tlist]');
    await expect(list.locator('li', { hasText: 'Square' }).locator('[data-tset]')).toHaveText('Unset');
    await expect(list.locator('li', { hasText: 'Owed to the Deep' })).toHaveCount(0);
  });
});

test('the GM awards the title Steady Hand worn in fights as Hasted: once it is the active title, the hunter starts a fight Hasted', async ({ device }) => {
  const gm = (await device('gm')).page;
  await onboardGM(gm);
  await gm.evaluate(() => hunterApp.store.update((d: any) => { d.rulesOverrides.feats = { on: false }; d.rulesOverrides.solo = { personal: false }; }, 'test-setup'));
  const name = (await activeHunter(gm)).name as string;
  await go(gm, 'gm');
  const toggle = gm.locator('[data-tog="award"]');
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.tap();
  const ed = gm.locator('#gm-rw'), row = ed.locator('[data-kind="title"]');

  await test.step('the title row has Worn in fights, and the preview names the status', async () => {
    await ed.locator('[data-add="title"]').tap();
    await row.locator('[data-f="name"]').fill('Steady Hand');
    await expect(row.locator('label.field', { hasText: 'Worn in fights' })).toBeVisible();
    await expect(row).toContainText('While this is the hunter\'s active title, the status is on the hunter in every fight.');
    await row.locator('[data-f="tworn"]').selectOption('hasted');
    await expect(ed.locator('.rw-preview')).toContainText('Title acquired: Steady Hand, worn in fights: Hasted');
  });

  await test.step('the award is sent, and the hunter\'s window names the worn status', async () => {
    await gm.locator('#gm-targets label', { hasText: name }).locator('input').check();
    await gm.locator('#gm-award-go').tap();
    await expect(gm.locator('.sys-overlay.show', { hasText: 'Title acquired: Steady Hand, worn in fights: Hasted' })).toBeVisible();
    await dismissAll(gm, 4);
  });

  await test.step('the hunter sets Steady Hand active on the sheet', async () => {
    await go(gm, 'status');
    const li = gm.locator('[data-panel="titles"] [data-tlist] li', { hasText: 'Steady Hand' });
    await li.locator('[data-tset]').tap();
    await expect(li.locator('[data-tset]')).toHaveText('Unset');
  });

  await test.step('in the Goblin Den fight the hunter\'s row is Hasted, a worn status, and the other hunters\' rows are not', async () => {
    await chooseList(gm);
    await startGoblinDenFight(gm, [name]);
    const hasted = (r: any) => r.statuses.filter((s: any) => s.def.label === 'Hasted').map((s: any) => ({ worn: s.worn === true, until: s.until }));
    expect(hasted(await fightRow(gm, name))).toEqual([{ worn: true, until: null }]);
    const others = await gm.evaluate(n => hunterApp.store.get().fight.rows.filter((r: any) => r.kind === 'hunter' && r.name !== n).map((r: any) => r.statuses.filter((s: any) => s.def.label === 'Hasted').length), name);
    expect(others.length).toBeGreaterThan(0);
    expect(others.every((n: number) => n === 0)).toBe(true);
  });
});

test('the GM awards a title of band C usable in fights as Second Wind: its card names the power, and once it is the active title the hunter has Second Wind in the fight', async ({ device }) => {
  const gm = (await device('gm')).page;
  await onboardGM(gm);
  await gm.evaluate(() => hunterApp.store.update((d: any) => { d.rulesOverrides.feats = { on: false }; d.rulesOverrides.solo = { personal: false }; }, 'test-setup'));
  const wind = abilityOf('support', { id: abilityId('second-wind'), name: 'Second Wind', aim: 'self' }, RULES);
  await gm.evaluate(a => hunterApp.store.update((d: any) => { d.library.skills.push({ id: 's-second-wind', name: 'Second Wind', type: 'active', level: 1, label: null, desc: '', ability: a }); }, 'test-setup'), wind);
  const name = (await activeHunter(gm)).name as string;
  await go(gm, 'gm');
  const toggle = gm.locator('[data-tog="award"]');
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.tap();
  const ed = gm.locator('#gm-rw'), row = ed.locator('[data-kind="title"]');

  await test.step('the title row has Band chips and Usable in fights, and a spend line against the band\'s budget', async () => {
    await ed.locator('[data-add="title"]').tap();
    await row.locator('[data-f="name"]').fill('Last Light');
    await expect(row.locator('[data-band="E"]')).toHaveAttribute('aria-pressed', 'true');
    await row.locator('[data-band="C"]').tap();
    await expect(row.locator('[data-band="C"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(row.locator('[data-band="E"]')).toHaveAttribute('aria-pressed', 'false');
    await row.locator('[data-f="tactive"]').selectOption({ label: 'Second Wind' });
    await expect(row.locator('[data-tinfo]')).toContainText('Can use in a fight: Second Wind');
    await expect(row.locator('[data-tspend]')).toContainText(`of a rank C title's ${RULES.titleBudget.C} points`);
  });

  await test.step('the award is sent and the hunter holds a title of band C with the ability', async () => {
    await gm.locator('#gm-targets label', { hasText: name }).locator('input').check();
    await gm.locator('#gm-award-go').tap();
    await dismissAll(gm, 4);
    const t = (await activeHunter(gm)).titles.find((x: any) => x.name === 'Last Light');
    expect(t).toMatchObject({ band: 'C', active: { name: 'Second Wind' } });
  });

  await test.step('the title\'s card names its power and fits a 390 px phone', async () => {
    await go(gm, 'status');
    const li = gm.locator('[data-panel="titles"] [data-tlist] li', { hasText: 'Last Light' });
    await expect(li.locator('.t-powers')).toContainText('Can use in a fight: Second Wind');
    await li.locator('[data-tset]').tap();
    await expect(li.locator('[data-tset]')).toHaveText('Unset');
    await li.scrollIntoViewIfNeeded();
    const box = await li.evaluate(el => ({ scroll: el.scrollWidth, client: el.clientWidth }));
    expect(box.scroll).toBeLessThanOrEqual(box.client);
  });

  await test.step('in the Goblin Den fight the hunter\'s row has Second Wind as a worn ability', async () => {
    await chooseList(gm);
    await startGoblinDenFight(gm, [name]);
    const row = await fightRow(gm, name);
    expect(row.abilities.map((a: any) => a.id)).toContain('worn-second-wind');
  });
});

test('the GM folds an Award form holding a fight\'s 75 gold and later sends Brakk +25 XP: Brakk gets the XP and no gold, and the 75 gold is offered again', async ({ device }) => {
  const gm = (await device('gm')).page;
  await onboardGM(gm);
  await gm.evaluate(() => hunterApp.store.update((d: any) => { d.loot = { at: 'waiting', drops: [{ fight: 'f-hoard', gold: 75, items: [] }] }; }, 'test-setup'));
  await gm.reload();
  const tie = gm.locator('#gm-award-tie'), toggle = gm.locator('[data-tog="award"]');
  const brakk = () => gm.evaluate(() => { const h = hunterApp.store.get().hunters.find((x: any) => x.name === 'Brakk Ironhide'); return { gold: h.gold as number, level: h.level as number, xp: h.xp as number }; });
  const goldWaiting = () => gm.evaluate(() => { const l = hunterApp.store.get().loot; return l.at === 'waiting' ? l.drops.map((d: any) => d.gold) : []; });

  await test.step('Award loot opens the form with the 75 gold, and the line naming the loot fits a 390 px phone', async () => {
    await answerWindow(gm, 'Loot dropped', 'Award loot');
    await expect(gm.locator('#gm-gold')).toHaveValue('75');
    await expect(tie).toHaveText('Fight loot: 75 gold. Send award gives it; fold Award to keep it for later.');
    await tie.scrollIntoViewIfNeeded();
    const box = await tie.evaluate(el => ({ scroll: el.scrollWidth, client: el.clientWidth, right: el.getBoundingClientRect().right, page: document.documentElement.clientWidth }));
    expect(box.scroll).toBeLessThanOrEqual(box.client);
    expect(box.right).toBeLessThanOrEqual(box.page);
    await gm.screenshot({ path: '/tmp/pw-sm-u5-award-tie-390.png' });
  });

  await test.step('folding Award empties the form and unties it; the 75 gold still waits', async () => {
    await toggle.tap();
    await toggle.tap();
    await expect(tie).toBeHidden();
    await expect(gm.locator('#gm-gold')).not.toHaveValue('75');
    expect(await goldWaiting()).toEqual([75]);
  });

  await test.step('+25 XP sent to Brakk gives him 25 XP and no gold, and the 75 gold still waits', async () => {
    const before = await brakk();
    await gm.fill('#gm-xp', '25');
    await gm.locator('#gm-targets label', { hasText: 'Brakk Ironhide' }).locator('input').check();
    await gm.locator('#gm-award-go').tap();
    await expect(gm.locator('#gm-award-msg')).toContainText('Sent to Brakk Ironhide.');
    await dismissAll(gm, 4);
    const after = await brakk();
    expect(after.gold).toBe(before.gold);
    expect(after.level === before.level ? after.xp - before.xp : 'levelled').toBe(25);
    expect(await goldWaiting()).toEqual([75]);
  });

  await test.step('after a reload the Loot dropped window offers the 75 gold again', async () => {
    await gm.reload();
    await expect(gm.locator('.sys-overlay.show', { hasText: 'Loot dropped' })).toContainText('75 gold');
  });
});
