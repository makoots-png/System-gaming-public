// A player's turn in the GM's fight (src/views/table.js, src/views/uses.js, the GM's side in src/views/combat.js): a
// use sent as `cast`, a step as `step`, a thrown item as its ability, each taken only on that hunter's turn.
import type { Page } from '@playwright/test';
import { RULES } from '../../src/core/rules.ts';
import { tiles } from '../../src/core/combat/space.ts';
import { abilityId } from '../../src/core/combat/ability-types.ts';
import { abilityOf } from '../../src/core/registry/ability-kinds.ts';
import { test, expect, onboardGM, onboardPlayer, createRoom, dismissAll, go, answerWindow, fightRow, openFeed, chooseList, openApp, type DeviceOptions, setupDoc } from './helpers.ts';

const HUNTER = 'Kai Test', MONSTER = 'Cave Rat';
const combat = (page: Page) => page.locator('#view-combat');
const hudRow = (player: Page, name: string) => combat(player).locator('.tb-row', { hasText: name });
/** Every die rolls its lowest face: a reaction d20 of 1 is caught and a crit, so a use lands. */
const lowestDice = (page: Page) => page.evaluate(() => Object.defineProperty(crypto, 'getRandomValues', { configurable: true, value: (a: Uint32Array) => a.fill(0) }));

/** A GM and a player in one room, the player's card on the GM's party board. `carry` goes in the player's bag first (setup). */
async function room(device: (label: string, o?: DeviceOptions) => Promise<{ page: Page }>, carry: Record<string, unknown>[] = [], gmOptions: DeviceOptions = {}): Promise<{ gm: Page; player: Page }> {
  const gm = (await device('gm', gmOptions)).page, player = (await device('player')).page;
  await onboardGM(gm);
  await chooseList(gm);
  const code = await createRoom(gm);
  await onboardPlayer(player, HUNTER, code);
  await chooseList(player);
  await expect.poll(() => player.evaluate(() => hunterApp.api.sync.room())).toBe(code);
  await dismissAll(player, 4);
  if (carry.length) {
    await player.evaluate(list => { const s = hunterApp.store; s.update(() => { for (const t of list) s.active().items.push({ ...t, id: s.id('i') }); }, 'test-setup'); }, carry);
    await expect.poll(() => gm.evaluate(n => (hunterApp.api.sync.remoteSheets() as any[]).some(r => r.data.items.some((i: any) => i.name === n)), String(carry[0]!.name))).toBe(true);
  }
  await go(gm, 'gm');
  await expect(gm.locator('#gm-board .gm-card.remote', { hasText: HUNTER })).toHaveCount(1);
  return { gm, player };
}

/**
 * The GM's fight with the player's hunter and one rat, started from the Combat view. Then (setup only) the player's row
 * stands at (2, 2) and the rat at `ratAt`, and the turn is the player's.
 */
async function fight(gm: Page, player: Page, ratAt: { x: number; y: number }) {
  await go(gm, 'combat');
  await combat(gm).locator('[data-hsel]').selectOption({ label: `${HUNTER} (remote)` });
  await combat(gm).locator('[data-addh]').tap();
  await combat(gm).locator('[data-qline]').fill(`${MONSTER}, E, brute`);
  await combat(gm).locator('[data-qadd]').tap();
  await combat(gm).locator('[data-start]').tap();
  await expect(combat(gm).locator('.cmb-row.cur')).toHaveCount(1);
  await gm.evaluate(([name, at]) => hunterApp.store.update((d: any) => {
    const f = d.fight, kai = f.rows.find((r: any) => r.name === name), rat = f.rows.find((r: any) => r.kind === 'monster');
    kai.place = { x: 2, y: 2 }; rat.place = at;
    kai.at = f.now; kai.tie = 0; rat.at = f.now + 1; rat.tie = 0;
    f.currentId = kai.id; f.log = [];
  }, 'test-setup'), [HUNTER, ratAt] as const);
  await setupDoc(player, HUNTER, { x: 2, y: 2 });
  await go(player, 'combat');
  await expect(combat(player).locator('.tb-mine')).toContainText('YOUR TURN');
}

test('a player\'s Strike sent on their turn changes the goblin\'s band on both phones, and the same tap after the turn moved on changes nothing', async ({ device }) => {
  const { gm, player } = await room(device);
  await fight(gm, player, { x: 2, y: 3 });
  // Healthy is above 75% of max HP (fight-doc.ts BANDS): one HP above three quarters, so any hit makes it Wounded.
  const rat = await fightRow(gm, MONSTER);
  await gm.evaluate(([n, hp]) => hunterApp.store.update((d: any) => { d.fight.rows.find((r: any) => r.name === n).hp = hp; }, 'test-setup'), [MONSTER, Math.floor(rat.sheet.hpMax * 0.75) + 1] as const);
  await expect(hudRow(player, MONSTER).locator('.tb-band')).toHaveAttribute('data-band', 'healthy');
  await lowestDice(gm); await lowestDice(player);
  const sent: any[] = [];
  await player.exposeFunction('__castSent', (p: any) => { sent.push(p); });
  await player.evaluate(() => { const S = hunterApp.api.sync, post = S.post; S.post = (ev: any, o: any) => { if (ev.type === 'cast') (window as any).__castSent(ev.payload); return post(ev, o); }; });

  await test.step('the player taps Use on the Strike, picks the rat, and both phones show it Wounded', async () => {
    await combat(player).locator('[data-cast="attack"]').tap();
    await answerWindow(player, /Use .+ on…/, MONSTER);
    await expect.poll(async () => (await fightRow(gm, MONSTER)).hp, { timeout: 15_000 }).toBeLessThan(Math.floor(rat.sheet.hpMax * 0.75) + 1);
    const hit = await fightRow(gm, MONSTER);
    await expect(combat(gm).locator('.cmb-row', { hasText: MONSTER }).locator('.cmb-mini')).toContainText(`${hit.hp}/${hit.sheet.hpMax}`);
    await expect(hudRow(player, MONSTER).locator('.tb-band')).toHaveAttribute('data-band', 'wounded');
  });

  await test.step('the same cast sent again after the turn moved on changes nothing on the GM\'s phone', async () => {
    const hp = (await fightRow(gm, MONSTER)).hp, now = await gm.evaluate(() => hunterApp.store.get().fight.now);
    expect(sent).toHaveLength(1);
    expect(sent[0].at).toBeLessThan(now);
    await player.evaluate(p => hunterApp.api.sync.post(hunterApp.api.sync.event('cast', { by: p.by, ability: p.ability, aim: p.aim, at: p.at, dice: p.dice })), sent[0]);
    // a roll sent after it reaches the GM's Table feed after it, so by then the GM's phone has read the replay
    await player.evaluate(n => hunterApp.api.dice.roll('1d20', { label: 'after the replay', who: n }), HUNTER);
    await openFeed(gm);
    await expect(combat(gm).locator('[data-feed]', { hasText: 'after the replay' })).toBeVisible({ timeout: 15_000 });
    expect((await fightRow(gm, MONSTER)).hp).toBe(hp);
    await expect(combat(player).locator('[data-cast="attack"]')).toBeDisabled();
  });
});

test('a player\'s step on their turn moves their token on the GM\'s order', async ({ device }) => {
  const { gm, player } = await room(device);
  await fight(gm, player, { x: 2, y: 10 });
  // A body at speed 100 walks RULES.fight.moveBase (6) tiles a round and one move a stride, strideShare (half) of it: 3
  // steps. On the 5-10-5 map the nearest the rat at (2, 10) those reach is 5 tiles, from (1, 5), (2, 5) or (3, 5) (one
  // diagonal is free); a tie goes to the lowest y, then the lowest x (design 3.1 rule 8a), so (1, 5).
  await expect(combat(player).locator('[data-step="1"]')).toHaveText(`Toward ${MONSTER}`);
  await combat(player).locator('[data-step="1"]').tap();
  await expect.poll(async () => (await fightRow(gm, HUNTER)).place, { timeout: 15_000 }).toEqual({ x: 1, y: 5 });
  await expect.poll(() => player.evaluate(n => hunterApp.api.sync.doc('fight').rows.find((r: any) => r.name === n).place, HUNTER)).toEqual({ x: 1, y: 5 });
});

test('a GM\'s −5 on a fighting player\'s card on the party board takes 5 from the fight\'s row, and the player\'s sheet shows it after the next turn', async ({ device }) => {
  const { gm, player } = await room(device);
  await fight(gm, player, { x: 2, y: 10 });
  const kai = await fightRow(gm, HUNTER);
  await go(gm, 'gm');
  await gm.locator('#gm-board .gm-card.remote', { hasText: HUNTER }).locator('[data-hp="-5"]').tap();
  await expect.poll(async () => (await fightRow(gm, HUNTER)).hp).toBe(kai.hp - 5);
  await go(gm, 'combat');
  await combat(gm).locator('[data-next]').tap();
  await expect.poll(() => player.evaluate(() => hunterApp.api.hunter.sheet(hunterApp.store.active()).hp), { timeout: 15_000 }).toBe(kai.hp - 5);
  expect((await fightRow(gm, HUNTER)).hp).toBe(kai.hp - 5);
});

test('a player\'s hunter who died in the GM\'s fight and whom the GM revives from the fight\'s card stands at 1 HP on the player\'s own phone', async ({ device }) => {
  const { gm, player } = await room(device);
  await fight(gm, player, { x: 2, y: 10 });
  await player.evaluate(() => hunterApp.store.update(() => { hunterApp.store.active().life = { at: 'dead' }; }, 'test-setup'));
  await gm.evaluate(n => hunterApp.store.update((d: any) => { d.fight.rows.find((r: any) => r.name === n).hp = 0; }, 'test-setup'), HUNTER);
  await expect.poll(() => gm.evaluate(n => (hunterApp.api.sync.remoteSheets() as any[]).find(r => r.data.name === n)?.data.life.at, HUNTER)).toBe('dead');
  await go(player, 'status');
  const death = player.locator('#view-status [data-death]');
  await expect(death.locator('[data-life]')).toHaveText('Dead');

  await test.step('the GM picks the player\'s row and taps Revive on its card', async () => {
    await combat(gm).locator('.cmb-row', { hasText: HUNTER }).locator('.cmb-pick').tap();
    const revive = combat(gm).locator('.cmb-card [data-defeat]');
    await expect(revive).toHaveText('Revive');
    await revive.tap();
    await expect.poll(async () => (await fightRow(gm, HUNTER)).hp).toBe(1);
  });

  await test.step('the player\'s sheet is up at 1 HP, and the death panel is gone', async () => {
    await expect(death).toBeHidden({ timeout: 15_000 });
    await expect(player.locator('#view-status [data-bar="hp"] [data-cur]')).toHaveText('1');
    expect(await player.evaluate(() => hunterApp.store.active().life)).toEqual({ at: 'up', hp: 1 });
  });
});

test('a player\'s hunter who died in the GM\'s fight and whom the GM revives from the party board stands at 1 HP on both phones', async ({ device }) => {
  const { gm, player } = await room(device);
  await fight(gm, player, { x: 2, y: 10 });
  await player.evaluate(() => hunterApp.store.update(() => { hunterApp.store.active().life = { at: 'dead' }; }, 'test-setup'));
  await gm.evaluate(n => hunterApp.store.update((d: any) => { d.fight.rows.find((r: any) => r.name === n).hp = 0; }, 'test-setup'), HUNTER);
  await go(player, 'status');
  const death = player.locator('#view-status [data-death]');
  await expect(death.locator('[data-life]')).toHaveText('Dead');

  await test.step('the GM taps Revive on the player\'s card on the party board', async () => {
    await go(gm, 'gm');
    const card = gm.locator('#gm-board .gm-card.remote', { hasText: HUNTER });
    await card.locator('[data-grevive]').tap();
    await expect.poll(async () => (await fightRow(gm, HUNTER)).hp).toBe(1);
  });

  await test.step('the player\'s sheet is up at 1 HP, and the death panel is gone', async () => {
    await expect(death).toBeHidden();
    await expect(player.locator('#view-status [data-bar="hp"] [data-cur]')).toHaveText('1');
    expect(await player.evaluate(() => hunterApp.store.active().life)).toEqual({ at: 'up', hp: 1 });
  });
});

test('a player\'s −5 on their own sheet during the GM\'s fight is turned down with a word, and their HP stays the fight\'s', async ({ device }) => {
  const { gm, player } = await room(device);
  await fight(gm, player, { x: 2, y: 10 });
  const kai = await fightRow(gm, HUNTER);
  await go(player, 'status');
  await player.locator('#view-status [data-hp="-5"]').first().tap();
  await expect(player.locator('.toast', { hasText: 'During the GM\'s fight, the GM changes your HP' })).toBeVisible();
  expect(await player.evaluate(() => hunterApp.api.hunter.sheet(hunterApp.store.active()).hp)).toBe(kai.hp);
  expect((await fightRow(gm, HUNTER)).hp).toBe(kai.hp);
});

test('a potion a player drinks on their turn heals their row on both phones, and the healed HP stays after the next doc arrives', async ({ device }) => {
  // A Health Potion "Restores 30 HP" (src/core/registry/items.ts); it goes to its user.
  const potion = { name: 'Health Potion', rar: 'common', type: 'consumable', qty: 2, slot: null, bonus: {}, effects: [{ op: 'heal', amount: { kind: 'number', value: 30 }, when: 'use' }], value: 50, desc: 'Restores 30 HP.' };
  const { gm, player } = await room(device, [potion]);
  await fight(gm, player, { x: 2, y: 10 });
  const kai = await fightRow(gm, HUNTER), hurt = kai.sheet.hpMax - 35, healed = hurt + 30;
  await gm.evaluate(([id]) => hunterApp.api.combat.adjust(id, { hp: -35 }), [kai.id] as const);
  const ownHp = combat(player).locator('.tb-me .bar-nums').first();
  await expect(ownHp).toHaveText(`${hurt} / ${kai.sheet.hpMax}`, { timeout: 15_000 });

  await test.step('the player taps Use on the potion in their bag and both phones show the healed HP', async () => {
    await go(player, 'status');
    await player.locator('[data-panel="inventory"] .inv-card', { hasText: 'Health Potion' }).getByRole('button', { name: 'Use Health Potion' }).tap();
    await expect.poll(async () => (await fightRow(gm, HUNTER)).hp, { timeout: 15_000 }).toBe(healed);
    await expect(combat(gm).locator('.cmb-row', { hasText: HUNTER }).locator('.cmb-mini')).toContainText(`${healed}/${kai.sheet.hpMax}`);
    await go(player, 'combat');
    await expect(ownHp).toHaveText(`${healed} / ${kai.sheet.hpMax}`, { timeout: 15_000 });
    await expect(hudRow(player, HUNTER)).toContainText(`${healed}/${kai.sheet.hpMax}`);
    await expect.poll(() => player.evaluate(() => hunterApp.store.active().items.find((i: any) => i.name === 'Health Potion')?.qty)).toBe(1);
  });

  await test.step('the GM ends the turn, and the next doc keeps the healed HP on the player\'s phone', async () => {
    const now = await gm.evaluate(() => hunterApp.store.get().fight.now);
    await combat(gm).locator('[data-next]').tap();
    await expect.poll(() => player.evaluate(() => hunterApp.api.sync.doc('fight').now), { timeout: 15_000 }).toBeGreaterThan(now);
    await expect(ownHp).toHaveText(`${healed} / ${kai.sheet.hpMax}`);
    await expect(hudRow(player, HUNTER)).toContainText(`${healed}/${kai.sheet.hpMax}`);
    expect(await player.evaluate(() => hunterApp.api.hunter.sheet(hunterApp.store.active()).hp)).toBe(healed);
  });
});

test('a player\'s Strike at the wrong rat while taunted is turned down by the GM\'s phone, and the player reads why', async ({ device }) => {
  const { gm, player } = await room(device);
  await go(gm, 'combat');
  await combat(gm).locator('[data-hsel]').selectOption({ label: `${HUNTER} (remote)` });
  await combat(gm).locator('[data-addh]').tap();
  await combat(gm).locator('[data-qline]').fill(`${MONSTER} x2, E, brute`);
  await combat(gm).locator('[data-qadd]').tap();
  await combat(gm).locator('[data-start]').tap();
  await expect(combat(gm).locator('.cmb-row.cur')).toHaveCount(1);
  // Both rats stand next to Kai; Rat A has taunted Kai, so a use against a foe must aim at Rat A (design 3.1 rule 2).
  await gm.evaluate(name => hunterApp.store.update((d: any) => {
    const f = d.fight, kai = f.rows.find((r: any) => r.name === name), [a, b] = f.rows.filter((r: any) => r.kind === 'monster');
    kai.place = { x: 2, y: 2 }; a.place = { x: 2, y: 3 }; b.place = { x: 3, y: 2 };
    kai.at = f.now; kai.tie = 0; a.at = f.now + 1; b.at = f.now + 2;
    kai.statuses = [{ key: 'taunted', def: { label: 'Taunted', desc: '', ops: [{ op: 'taunt' }] }, source: { id: a.id, tier: 0 }, until: null, since: f.now, settledAt: f.now }];
    f.currentId = kai.id; f.log = [];
  }, 'test-setup'), HUNTER);
  await setupDoc(player, HUNTER, { x: 2, y: 2 });
  await go(player, 'combat');
  await expect(combat(player).locator('.tb-mine')).toContainText('YOUR TURN');
  const hp = (await fightRow(gm, `${MONSTER} B`)).hp;

  await combat(player).locator('[data-cast="attack"]').tap();
  await answerWindow(player, /Use .+ on…/, `${MONSTER} B`);
  await expect(player.locator('.toast', { hasText: 'You are taunted: aim at your taunter.' })).toBeVisible({ timeout: 15_000 });
  expect((await fightRow(gm, `${MONSTER} B`)).hp).toBe(hp);
  await expect(combat(player).locator('.tb-mine')).toContainText('YOUR TURN');
});

test('an ability on cooldown says on the player\'s phone when it is ready again, and cannot be tapped until then', async ({ device }) => {
  const { gm, player } = await room(device);
  await fight(gm, player, { x: 2, y: 3 });
  // A use with a cooldown of 2 rounds (RULES.fight.round ticks each) made just now is ready again 2 rounds on.
  await gm.evaluate(name => hunterApp.store.update((d: any) => {
    const f = d.fight, kai = f.rows.find((r: any) => r.name === name);
    kai.readyAt = { ...kai.readyAt, attack: f.now + 2 * hunterApp.rules().fight.round };
  }, 'test-setup'), HUNTER);
  const use = combat(player).locator('[data-cast="attack"]');
  await expect(use).toBeDisabled({ timeout: 15_000 });
  await expect(combat(player).locator('.tb-kl li', { has: player.locator('[data-cast="attack"]') })).toContainText('Ready in 2 rounds');
});

test('a player taps End turn in the list on their turn and the rat\'s turn comes on both phones', async ({ device }) => {
  const { gm, player } = await room(device);
  await fight(gm, player, { x: 2, y: 10 });
  await combat(player).locator('[data-acts] [data-pass]').tap();
  await expect(combat(gm).locator('.cmb-row.cur', { hasText: MONSTER })).toHaveCount(1);
  await expect(combat(player).locator('.tb-mine')).toHaveCount(0);
  await expect(combat(player).locator('[data-acts] [data-pass]')).toHaveCount(0);
});

test('the GM ends the fight while the GM\'s phone is offline: the player still gets the XP, once, when the GM\'s phone is back', async ({ device }) => {
  // setOffline reaches the app's requests only past no service worker
  const { gm, player } = await room(device, [], { blockServiceWorker: true, allowConsole: [/ERR_INTERNET_DISCONNECTED|net::ERR|Failed to fetch/] });
  await fight(gm, player, { x: 2, y: 3 });
  const total = () => player.evaluate(() => { const h = hunterApp.store.active(); return h.xp + 100 * (h.level - 1) * h.level / 2; });
  const before = await total();
  await gm.evaluate(n => hunterApp.store.update((d: any) => { const rat = d.fight.rows.find((r: any) => r.name === n); rat.hp = 0; rat.xp = 40; }, 'test-setup'), MONSTER);

  await test.step('offline, the GM ends the encounter and awards the XP: the fight is gone and the player\'s award waits in the GM\'s outbox', async () => {
    await gm.context().setOffline(true);
    await expect.poll(() => gm.evaluate(() => hunterApp.api.sync.status())).toBe('offline');
    await combat(gm).locator('[data-end]').first().tap();
    await expect(gm.locator('.sys-overlay.show', { hasText: 'Fight over' })).toContainText('Each hunter receives 40 XP.');
    await answerWindow(gm, 'Fight over', 'Award XP to party');
    await expect.poll(() => gm.evaluate(() => hunterApp.store.get().fight)).toBeNull();
    // beside the award waits the fight's facts for the player's hunter (`noted`, feats unit 4), posted in the same write
    const waiting = await gm.evaluate(() => (hunterApp.store.get().settings.sync.outbox ?? []).map((e: any) => [e.at, e.letter.event.type, e.letter.event.payload.rewards?.xp ?? null]));
    expect(waiting.filter((w: any[]) => w[1] === 'award')).toEqual([['queued', 'award', 40]]);
    expect(waiting.map((w: any[]) => w[1]).sort()).toEqual(['award', 'noted']);
    expect(await total()).toBe(before);
  });

  await test.step('back online, the award reaches the player once, the GM\'s outbox is empty, and the player\'s page reading the room from its start again gives it nothing more', async () => {
    await gm.context().setOffline(false);
    await expect.poll(total, { timeout: 20_000 }).toBe(before + 40);
    await expect.poll(() => gm.evaluate(() => (hunterApp.store.get().settings.sync.outbox ?? []).length)).toBe(0);
    await player.evaluate(() => hunterApp.store.update((d: any) => { d.settings.sync.cursor = 0; }, 'test-setup'));
    await openApp(player);
    await expect.poll(() => player.evaluate(() => hunterApp.store.get().settings.sync.cursor)).toBeGreaterThan(0);
    expect(await total()).toBe(before + 40);
  });
});

test('the GM\'s phone offline awards the party\'s XP and reads that the player gets it when the room answers, not that it was sent', async ({ device }) => {
  // setOffline reaches the app's requests only past no service worker
  const { gm, player } = await room(device, [], { blockServiceWorker: true, allowConsole: [/ERR_INTERNET_DISCONNECTED|net::ERR|Failed to fetch/] });
  await fight(gm, player, { x: 2, y: 3 });
  await gm.evaluate(n => hunterApp.store.update((d: any) => { const rat = d.fight.rows.find((r: any) => r.name === n); rat.hp = 0; rat.xp = 40; }, 'test-setup'), MONSTER);
  await gm.context().setOffline(true);
  await expect.poll(() => gm.evaluate(() => hunterApp.api.sync.status())).toBe('offline');
  await combat(gm).locator('[data-end]').first().tap();
  await answerWindow(gm, 'Fight over', 'Award XP to party');
  await expect(gm.getByText(`${HUNTER} gets the XP when the room answers.`)).toBeVisible();
  await expect(gm.getByText(`XP sent to ${HUNTER}.`)).toHaveCount(0);
});

test('a player\'s blast at two rats rolls each apart, as the GM\'s own does: the player\'s dice for the rat aimed at, the GM\'s phone\'s for the other', async ({ device }) => {
  const { gm, player } = await room(device);
  const boom = { ...abilityOf('blast', { id: abilityId('boom'), name: 'Boom' }, RULES), range: tiles(6), shape: { kind: 'radius', radius: tiles(1), ring: null }, foesOnly: true };
  await player.evaluate(a => { const s = hunterApp.store; s.update(() => { s.active().skills.push({ id: s.id('s'), name: 'Boom', type: 'active', level: 1, label: null, desc: '', ability: a }); }, 'test-setup'); }, boom);
  await expect.poll(() => gm.evaluate(() => (hunterApp.api.sync.remoteSheets() as any[]).some(r => r.data.skills.some((k: any) => k.name === 'Boom')))).toBe(true);
  await go(gm, 'combat');
  await combat(gm).locator('[data-hsel]').selectOption({ label: `${HUNTER} (remote)` });
  await combat(gm).locator('[data-addh]').tap();
  await combat(gm).locator('[data-qline]').fill(`${MONSTER}, E, brute, x2`);
  await combat(gm).locator('[data-qadd]').tap();
  await combat(gm).locator('[data-start]').tap();
  await expect(combat(gm).locator('.cmb-row.cur')).toHaveCount(1);
  await gm.evaluate(name => hunterApp.store.update((d: any) => {
    const f = d.fight, kai = f.rows.find((r: any) => r.name === name), [a, b] = f.rows.filter((r: any) => r.kind === 'monster');
    kai.place = { x: 2, y: 0 }; a.place = { x: 2, y: 3 }; b.place = { x: 2, y: 4 };
    kai.at = f.now; kai.tie = 0; a.at = f.now + 1; b.at = f.now + 2; f.currentId = kai.id; f.log = [];
  }, 'test-setup'), HUNTER);
  await setupDoc(player, HUNTER, { x: 2, y: 0 });
  await go(player, 'combat');
  await expect(combat(player).locator('.tb-mine')).toContainText('YOUR TURN');
  // the player's phone rolls its dice at their highest faces, the GM's phone every die at its lowest (a reaction d20 of 1: caught)
  await player.evaluate(() => Object.defineProperty(crypto, 'getRandomValues', { configurable: true, value: (a: Uint32Array) => a.fill(0xffffffff) }));
  await lowestDice(gm);
  await combat(player).locator('[data-cast="boom"]').tap();
  await answerWindow(player, /Use .+ on…/, `${MONSTER} A`);
  const lost = async (n: string) => { const r = await fightRow(gm, n); return r.sheet.hpMax - r.hp; };
  await expect.poll(() => lost(`${MONSTER} A`), { timeout: 15_000 }).toBeGreaterThan(0);
  await expect.poll(() => lost(`${MONSTER} B`)).toBeGreaterThan(0);
  expect(await lost(`${MONSTER} A`)).toBeGreaterThan(await lost(`${MONSTER} B`));
});

test('the GM extracts a fallen monster with a player\'s Necromancer, and the shadow that rises joins the army on the player\'s phone', async ({ device }) => {
  const { gm, player } = await room(device);
  const army = () => player.evaluate(() => hunterApp.store.active().shadows.map((s: any) => [s.name, s.grade]) as [string, string][]);
  await player.evaluate(() => hunterApp.store.update(() => { hunterApp.store.active().job = 'Necromancer'; }, 'test-setup'));
  await expect.poll(() => gm.evaluate(n => (hunterApp.api.sync.remoteSheets() as any[]).find(r => r.data.name === n)?.data.job, HUNTER)).toBe('Necromancer');
  await gm.evaluate(() => hunterApp.store.update((d: any) => {
    d.monsters.push({ id: 'm900', name: 'Frost Wolf', rank: 'E', type: '', archetype: 'brute', kind: 'normal', tweak: {}, abilities: [], notes: [], xp: 40, extractable: true, desc: '', statuses: [], loot: { gold: 0, items: [] } });
  }, 'test-setup'));
  await go(gm, 'bestiary');
  await gm.locator('#view-bestiary [data-addc="m900"]').tap();
  await go(gm, 'combat');
  await combat(gm).locator('[data-hsel]').selectOption({ label: `${HUNTER} (remote)` });
  await combat(gm).locator('[data-addh]').tap();
  await combat(gm).locator('.cmb-row:has-text("Frost Wolf") .cmb-pick').tap();
  await combat(gm).locator('.cmb-card [data-defeat]').tap();
  const wolf = combat(gm).locator('.cmb-card', { hasText: 'Frost Wolf' });

  await test.step('the wolf\'s card offers Extract for the player\'s Necromancer, and a natural 20 raises it', async () => {
    await expect(wolf.locator('[data-extract]')).toHaveCount(1);
    // the extraction is a check rolled on the dice tray, which draws from Math.random (src/edge/roll.ts `trayRandom`)
    await gm.evaluate(() => { Math.random = () => 0.99; });
    await wolf.locator('[data-extract]').tap();
    await answerWindow(gm, 'Shadow Extraction', 'Extract');
    await expect.poll(async () => (await fightRow(gm, 'Frost Wolf')).extraction).toEqual({ at: 'gone', why: 'risen' });
    await expect(wolf.locator('[data-extract]')).toHaveCount(0);
    expect(await gm.evaluate(() => hunterApp.store.get().hunters.flatMap((h: any) => h.shadows)), 'no hunter of the GM\'s phone took it').toEqual([]);
  });

  await test.step('the player\'s phone takes the shadow into its hunter\'s army once and says ARISE', async () => {
    await expect.poll(army, { timeout: 20_000 }).toEqual([['Frost Wolf', 'Normal']]);
    await expect(player.locator('#toasts .toast', { hasText: 'joins' }).first()).toBeVisible();
  });
});
