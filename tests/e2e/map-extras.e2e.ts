// The extras of design 4 on the GM's phone and a player's, on the map and the cards: a monster's intent (its numbers
// hidden until the GM reveals them), the target its threat suggests and a taunt, a boss's stagger bar breaking, a shield
// taking a hit first, and a channel's charge, its Release and its break. Values come from the rules (src/core/rules.ts
// RULES.fight) and the GM's own fight.
import type { Page } from '@playwright/test';
import { test, expect, onboardGM, onboardPlayer, createRoom, dismissAll, go, fightRow, chooseList, setupDoc } from './helpers.ts';

const HUNTER = 'Kai Extra', BRAKK = 'Brakk Ironhide', RAT = 'Cave Rat', BOSS = 'Cerberus';
const combat = (page: Page) => page.locator('#view-combat');
const map = (page: Page) => combat(page).locator('[data-mapbox]');
const token = (page: Page, id: string) => map(page).locator(`[data-tok="${id}"]`);
/** Every die rolls its lowest face: a reaction d20 of 1 is caught and a crit, so a use lands. */
const lowestDice = (page: Page) => page.evaluate(() => Object.defineProperty(crypto, 'getRandomValues', { configurable: true, value: (a: Uint32Array) => a.fill(0) }));
/** The fight doc a player's phone holds, as its reader read it. */
const playerDoc = (player: Page) => player.evaluate(() => JSON.parse(JSON.stringify(hunterApp.api.sync.doc('fight'))));
const rules = (page: Page) => page.evaluate(() => JSON.parse(JSON.stringify(hunterApp.rules().fight)));

/**
 * A GM and a player in one room, in the GM's fight: the player's hunter at (2, 2), Brakk at (4, 2), Cerberus (a C boss
 * with a stagger bar) at (2, 6) and a rat at (3, 2). `scene` is what the GM's fight holds before both phones frame the
 * map, and whose turn it is.
 */
type Scene = 'intent' | 'threat' | 'stagger' | 'shield' | 'channel' | 'break' | 'kits';
async function extrasFight(device: (label: string) => Promise<{ page: Page }>, scene: Scene) {
  const gm = (await device('gm')).page, player = (await device('player')).page;
  await onboardGM(gm);
  const code = await createRoom(gm);
  await onboardPlayer(player, HUNTER, code);
  await expect.poll(() => player.evaluate(() => hunterApp.api.sync.room())).toBe(code);
  await dismissAll(player, 4);
  await go(gm, 'gm');
  await expect(gm.locator('#gm-board .gm-card.remote', { hasText: HUNTER })).toHaveCount(1);
  await go(gm, 'combat');
  await combat(gm).locator('[data-hsel]').selectOption({ label: `${HUNTER} (remote)` });
  await combat(gm).locator('[data-addh]').tap();
  await combat(gm).locator('[data-hsel]').selectOption({ label: BRAKK });
  await combat(gm).locator('[data-addh]').tap();
  await combat(gm).locator('[data-msel]').selectOption({ label: 'Cerberus (C boss)' });
  await combat(gm).locator('[data-addm]').tap();
  await combat(gm).locator('[data-qline]').fill(`${RAT} x1, E, brute`);
  await combat(gm).locator('[data-qadd]').tap();
  await combat(gm).locator('[data-start]').tap();
  const ids = await gm.evaluate(([names, what]) => {
    let out = { kai: '', brakk: '', boss: '', rat: '' };
    hunterApp.store.update((d: any) => {
      const f = d.fight, by = (n: string) => f.rows.find((r: any) => r.name.startsWith(n));
      const kai = by(names[0]), brakk = by(names[1]), boss = by(names[2]), rat = by(names[3]);
      kai.place = { x: 2, y: 2 }; brakk.place = { x: 4, y: 2 }; boss.place = { x: 2, y: 6 }; rat.place = { x: 3, y: 2 };
      out = { kai: kai.id, brakk: brakk.id, boss: boss.id, rat: rat.id };
      let cur = brakk;
      if (what === 'threat') {
        boss.threat = { [kai.id]: 30, [brakk.id]: 90 };
        boss.statuses = [{ key: 'taunted', def: { label: 'Taunted', desc: '', ops: [{ op: 'taunt' }] }, source: { id: kai.id, tier: 0 }, until: f.now + 2000, since: f.now, settledAt: f.now }];
      }
      if (what === 'stagger') { brakk.place = { x: 2, y: 5 }; boss.stagger = { ...boss.stagger, fill: boss.stagger.max - 1 }; }
      if (what === 'shield') { kai.shield = { amount: 4, until: f.now + 2000 }; cur = rat; }
      if (what === 'channel') kai.channel = { ability: kai.abilities[0].id, aim: rat.id, charge: 1, state: 'holding' };
      if (what === 'break') { kai.channel = { ability: kai.abilities[0].id, aim: rat.id, charge: 4, state: 'holding' }; cur = rat; }
      f.rows.forEach((r: any, i: number) => { r.at = f.now + 10 + i; r.tie = 0; });
      cur.at = f.now; f.currentId = cur.id; f.log = [];
    }, 'test-setup');
    return out;
  }, [[HUNTER, BRAKK, BOSS, RAT], scene] as const);
  await setupDoc(player, HUNTER, { x: 2, y: 2 });
  await go(player, 'combat');
  for (const p of [gm, player]) {
    await expect(token(p, ids.kai)).toBeVisible();
    await map(p).locator('[data-frame]').dblclick({ position: { x: 4, y: 4 } });
  }
  return { gm, player, ids };
}

test('the GM sets a monster\'s intent from its token: both phones see its name, its target and a line to it, and its numbers only after Reveal', async ({ device }) => {
  const { gm, player, ids } = await extrasFight(device, 'intent');
  await token(gm, ids.boss).tap();
  const card = combat(gm).locator('.cmb-card');
  await card.locator('[data-intent-set]').tap();
  await gm.locator('.sys-overlay.show', { hasText: `${BOSS} will use` }).waitFor();
  await gm.locator('.sys-overlay.show button', { hasText: 'Three Heads' }).tap();
  await gm.locator('.sys-overlay.show', { hasText: 'Three Heads at' }).waitFor();
  await gm.locator('.sys-overlay.show button', { hasText: HUNTER }).tap();
  await expect(card.locator('[data-intent]')).toContainText(`Three Heads at ${HUNTER}`);
  for (const p of [gm, player]) await expect(map(p).locator(`[data-line="${ids.boss}"][data-kind="intent"]`)).toBeAttached();
  await expect.poll(() => playerDoc(player).then(d => d.rows.find((r: any) => r.id === ids.boss).intent)).toEqual({ name: 'Three Heads', target: ids.kai, reveal: null });
  await token(player, ids.boss).tap();
  const sheet = combat(player).locator('[data-tbsheet]');
  await expect(sheet.locator('[data-intent]')).toContainText(`Three Heads at ${HUNTER}`);
  await expect(sheet.locator('[data-reveal]')).toHaveCount(0);

  await card.locator('[data-intent-reveal]').tap();
  const range = await gm.evaluate(id => hunterApp.store.get().fight.rows.find((r: any) => r.id === id).abilities.find((a: any) => a.name === 'Three Heads').range, ids.boss);
  await expect(sheet.locator('[data-reveal] li', { hasText: `Range ${range} tile` })).toHaveCount(1);
  await expect(card.locator('[data-intent] li', { hasText: `Range ${range} tile` })).toHaveCount(1);
});

test('a monster\'s card suggests its highest-threat target with each share behind a tap, the map draws the suggestion quietly, and a taunt shows on its token and card', async ({ device }) => {
  const { gm, player, ids } = await extrasFight(device, 'threat');
  // the taunter is the suggestion while the taunt holds; the shares are 90 and 30 of 120
  await token(gm, ids.boss).tap();
  const card = combat(gm).locator('.cmb-card');
  await expect(card.locator('[data-suggest]')).toHaveText(`Suggested target: ${HUNTER}`);
  await card.locator('.cmb-threat summary').tap();
  await expect(card.locator('.cmb-threat li')).toHaveText([`${BRAKK}75%`, `${HUNTER}25%`]);
  await expect(card.locator('.cmb-x.taunt')).toHaveText(`Taunted by ${HUNTER} · 2 rounds`);
  for (const p of [gm, player]) {
    await expect(map(p).locator(`[data-line="${ids.boss}"][data-kind="suggest"]`)).toBeAttached();
    await expect(token(p, ids.boss).locator('.mp-taunt')).toBeVisible();
  }
  await token(player, ids.boss).tap();
  await expect(combat(player).locator('[data-tbsheet] .tb-x.taunt')).toHaveText(`Taunted by ${HUNTER} · 2 rounds`);
  await expect(combat(player).locator('[data-tbsheet] [data-suggest]')).toHaveText(`Likely target: ${HUNTER}`);
});

test('a hit that fills Cerberus\'s stagger bar breaks it: both phones show it staggered for the rounds a break costs and the turn order holds it back', async ({ device }) => {
  const { gm, player, ids } = await extrasFight(device, 'stagger');
  const R = await rules(gm);
  await expect(token(gm, ids.boss).locator('.mp-stag')).toBeVisible();
  await lowestDice(gm);
  await map(gm).locator('[data-hot] .mp-hb').first().tap();
  await token(gm, ids.boss).tap();
  await map(gm).locator('[data-go]').tap();
  await expect.poll(() => fightRow(gm, BOSS).then(r => r.stagger.fill)).toBe(0);
  for (const p of [gm, player]) {
    await expect(token(p, ids.boss)).toHaveClass(/\bstaggered\b/);
    await expect(map(p).locator('.mp-order li.stag')).toHaveText(`${BOSS} (staggered)`);
  }
  await token(gm, ids.boss).tap();
  await expect(combat(gm).locator('.cmb-card .cmb-stg')).toHaveText(`Staggered · loses ${R.staggerCost} rounds`);
  await token(player, ids.boss).tap();
  await expect(combat(player).locator('[data-tbsheet] .tb-x.stagger b')).toHaveText(`Staggered · loses ${R.staggerCost} rounds`);
});

test('a shield on the player\'s hunter shows its amount and rounds on both phones, and a hit takes the shield first', async ({ device }) => {
  const { gm, player, ids } = await extrasFight(device, 'shield');
  for (const p of [gm, player]) await expect(token(p, ids.kai).locator('.mp-shield')).toBeVisible();
  await token(player, ids.kai).tap();
  await expect(combat(player).locator('[data-tbsheet] .tb-x.shield')).toHaveText('Shield 4 · 2 rounds');
  const hp = (await fightRow(gm, HUNTER)).hp;
  await lowestDice(gm);
  await map(gm).locator('[data-hot] .mp-hb').first().tap();
  await token(gm, ids.kai).tap();
  await map(gm).locator('[data-go]').tap();
  await expect.poll(() => fightRow(gm, HUNTER).then(r => r.shield)).toBeNull();
  // the log says what the hit dealt before the shield; the HP lost is that less the 4 the shield took
  const dealt = await gm.evaluate(name => Number(/caught(?:, crit)? (\d+)/.exec(hunterApp.store.get().fight.log.find((l: { text: string }) => l.text.includes(`${name} caught`))?.text ?? '')?.[1]), HUNTER);
  expect(dealt).toBeGreaterThan(4);
  await expect.poll(() => fightRow(gm, HUNTER).then(r => hp - r.hp)).toBe(dealt - 4);
  for (const p of [gm, player]) await expect(token(p, ids.kai).locator('.mp-shield')).toBeHidden();
});

test('the player\'s hunter channels: its pips grow on both phones at its turn, the hotbar offers Release with the payoff, and Release fires at the charge', async ({ device }) => {
  const { gm, player, ids } = await extrasFight(device, 'channel');
  const R = await rules(gm);
  for (const p of [gm, player]) await expect(token(p, ids.kai).locator('.mp-pips i.on')).toHaveCount(1);
  await combat(gm).locator('[data-next]').tap();
  await expect.poll(() => gm.evaluate(() => hunterApp.store.get().fight.currentId)).toBe(ids.kai);
  for (const p of [gm, player]) await expect(token(p, ids.kai).locator('.mp-pips i.on')).toHaveCount(2);
  const factor = Math.round(R.channelExp ** 2 * 100) / 100;
  const release = map(player).locator('[data-release]');
  await expect(release).toContainText(`2 of ${R.channelMax} · ×${factor}`);
  const hp = (await fightRow(gm, `${RAT}`)).hp;
  await lowestDice(gm); await lowestDice(player);
  await release.tap();
  await expect.poll(() => gm.evaluate(() => hunterApp.store.get().fight.log.some((l: { text: string }) => l.text.includes('goes off at charge 2')))).toBe(true);
  await expect.poll(() => fightRow(gm, RAT).then(r => r.hp)).toBeLessThan(hp);
  for (const p of [gm, player]) await expect(token(p, ids.kai).locator('.mp-pips')).toHaveCount(0);
});

test('a hit breaks the player\'s channel: its pips shatter on both phones and it fires at once at half its charge', async ({ device }) => {
  const { gm, player, ids } = await extrasFight(device, 'break');
  const R = await rules(gm);
  for (const p of [gm, player]) await expect(token(p, ids.kai).locator('.mp-pips i.on')).toHaveCount(4);
  await lowestDice(gm);
  await map(gm).locator('[data-hot] .mp-hb').first().tap();
  await token(gm, ids.kai).tap();
  await map(gm).locator('[data-go]').tap();
  // design 4.1: a broken channel goes off at once at floor(charge * breakShare)
  const half = Math.floor(4 * R.breakShare);
  await expect.poll(() => gm.evaluate(n => hunterApp.store.get().fight.log.some((l: { text: string }) => l.text.includes(`goes off at charge ${n}`)), half)).toBe(true);
  for (const p of [gm, player]) await expect(token(p, ids.kai).locator('.mp-pips')).toHaveCount(0);
});

// ── the kits at the table (kits design 1.1, 1.2, 8.4): a stack count, its threshold's burst, a reaction armed and fired ──

/** Pain: stacks to 5, and at 2 it goes off for 3 damage and the stacks are spent. */
const PAIN = { label: 'Pain', desc: 'It builds.', ops: [], stack: { cap: 5, leave: { kind: 'never' }, keep: 'fight', threshold: { at: { kind: 'count', n: 2 }, to: { kind: 'bearer' }, ops: [{ op: 'damage', type: 'magical', amount: { kind: 'number', value: 3 }, when: 'use' }], then: 'spend' } } };
/** Particles drawn on a page so far (motion.ts keeps its pool on the page): a burst played when the count grows. */
const bits = (page: Page) => page.evaluate(() => document.querySelectorAll('.m-bit').length);
/** It is `id`'s turn now: setup, as the other scenes' turns are. */
const turnOf = (gm: Page, id: string) => gm.evaluate(b => hunterApp.store.update((d: any) => { const f = d.fight, r = f.rows.find((x: any) => x.id === b); r.at = f.now; f.currentId = b; }, 'test-setup'), id);

/**
 * The kits' fight: Brakk holds Mark (his strike, putting one Pain on its target), the player's hunter holds Parry (a
 * reaction before a strike lands on it, on its sheet and its row), and it is Brakk's turn.
 */
async function kitsFight(device: (label: string) => Promise<{ page: Page }>) {
  const f = await extrasFight(device, 'kits');
  const parry = await f.gm.evaluate(([kai, brakk, pain]) => {
    let out: any = null;
    hunterApp.store.update((d: any) => {
      const rows = d.fight.rows, k = rows.find((r: any) => r.id === kai), b = rows.find((r: any) => r.id === brakk);
      b.abilities = [...b.abilities, { ...b.abilities[0], id: 'mark', name: 'Mark', ops: [{ op: 'applyStatus', key: 'pain', def: pain, duration: null }] }];
      out = { ...k.abilities[0], id: 'parry', name: 'Parry', aim: 'self', effect: null, ops: [{ op: 'guard', share: 0.3 }], react: { when: 'before', reach: 0 } };
      k.abilities = [...k.abilities, out];
    }, 'test-setup');
    return out;
  }, [f.ids.kai, f.ids.brakk, PAIN] as const);
  await f.player.evaluate(a => hunterApp.store.update((d: any) => {
    const h = d.hunters.find((x: any) => x.name === 'Kai Extra');
    h.skills.push({ id: 's-parry', name: 'Parry', type: 'active', level: 1, label: null, desc: '', ability: a });
  }, 'test-setup'), parry);
  await expect(map(f.player).locator('[data-hot] [data-arm="parry"]')).toBeVisible();
  return f;
}
/** The GM uses Brakk's Mark on the rat from the map. */
async function mark(gm: Page, rat: string) {
  await map(gm).locator('[data-hot] [data-ab="mark"]').tap();
  await token(gm, rat).tap();
  await map(gm).locator('[data-go]').tap();
}

test('a player sees a stack count on the rat rise, then go off in a burst at its threshold', async ({ device }) => {
  const { gm, player, ids } = await kitsFight(device);
  await lowestDice(gm);
  await mark(gm, ids.rat);
  await token(player, ids.rat).tap();
  const chip = combat(player).locator('[data-tbsheet] [data-chip="pain"]');
  await expect(chip.locator('.c-n')).toHaveText('1');
  // the GM's own status is not in the player's rules: the doc carries its def, so its detail says its cap and threshold
  await test.step('a tap on the chip opens its detail with its count of its cap and what it does at 2', async () => {
    await chip.locator('[data-dt-key]').tap();
    await expect(combat(player).locator('[data-tbsheet] .dt')).toContainText('1 of 5 stack.');
    await expect(combat(player).locator('[data-tbsheet] .dt')).toContainText('At 2 stacks');
  });
  const before = await bits(player);
  await turnOf(gm, ids.brakk);
  await mark(gm, ids.rat);
  await expect.poll(() => playerDoc(player).then(d => d.burst && d.burst.ids)).toEqual([ids.rat]);
  await expect.poll(() => bits(player)).toBeGreaterThan(before);
  await expect(chip).toHaveCount(0);
});

test('the GM makes a status of their own on the rat\'s card, and the player opens it on the rat\'s token and reads what it does', async ({ device }) => {
  const { gm, player, ids } = await extrasFight(device, 'kits');
  const forge = gm.locator('.fg-overlay [role=dialog]');
  await test.step('the GM makes Frostbite, 1d6 magical a round, and puts it on the rat', async () => {
    await chooseList(gm);
    await go(gm, 'combat');
    await combat(gm).locator(`.cmb-row:has-text("${RAT}") .cmb-pick`).tap();
    await combat(gm).locator(`.cmb-card:has-text("${RAT}") [data-cforge]`).tap();
    await expect(forge).toBeVisible();
    await forge.locator('[data-name]').fill('Frostbite');
    await forge.locator('[data-quick] [data-q="d6"]').tap();
    await expect(forge.locator('.mk-preview')).toContainText('1d6 magical damage a round');
    await forge.locator('[data-apply]').tap();
    await expect(forge).toHaveCount(0);
    await expect(combat(gm).locator('.cmb-card', { hasText: RAT })).toContainText('1d6 magical damage a round');
  });
  await test.step('the player taps the rat and opens Frostbite: the same sentence as the GM\'s', async () => {
    await token(player, ids.rat).tap();
    const chip = combat(player).locator('[data-tbsheet] [data-chip]', { hasText: 'Frostbite' });
    await chip.locator('[data-dt-key]').tap();
    await expect(combat(player).locator('[data-tbsheet] .dt')).toContainText('1d6 magical damage a round');
  });
});

test('a player arms Parry on the hotbar, a strike on them sets it off, and the slot says Spent', async ({ device }) => {
  const { gm, player, ids } = await kitsFight(device);
  const slot = map(player).locator('[data-hot] [data-arm="parry"]');
  await expect(slot).toHaveText(/Arm$/);
  await slot.tap();
  await expect.poll(() => fightRow(gm, HUNTER).then(r => r.armed && r.armed.ability)).toBe('parry');
  await expect(slot).toHaveText(/Armed$/);
  await expect(slot).toHaveAttribute('aria-pressed', 'true');
  await test.step('the rat strikes the hunter: Parry fires and is spent until the hunter\'s turn', async () => {
    await turnOf(gm, ids.rat);
    await lowestDice(gm);
    await map(gm).locator('[data-hot] .mp-hb').first().tap();
    await token(gm, ids.kai).tap();
    await map(gm).locator('[data-go]').tap();
    await expect.poll(() => gm.evaluate(() => hunterApp.store.get().fight.log.some((l: { text: string }) => l.text.includes('reacts with Parry')))).toBe(true);
    await expect.poll(() => playerDoc(player).then(d => d.spent)).toEqual([ids.kai]);
    await expect(slot).toHaveText(/Spent$/);
    await expect(token(player, ids.kai)).toHaveAttribute('aria-label', /reacted/);
  });
});

test('a player holds an ability on the hotbar to read what it does, and it is not picked', async ({ device }) => {
  const { player } = await kitsFight(device);
  const slot = map(player).locator('[data-hot] [data-ab]').first();
  const box = (await slot.boundingBox())!;
  await player.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await player.mouse.down();
  await expect(map(player).locator('[data-mapdt] .dt')).toBeVisible();
  await player.mouse.up();
  await expect(map(player).locator('[data-mapdt] .dt')).toContainText(await slot.locator('span').innerText());
  await expect(slot).toHaveAttribute('aria-pressed', 'false');
  await expect(map(player).locator('[data-confirm]')).toBeHidden();
  await test.step('a tap on the detail closes it', async () => {
    await map(player).locator('[data-mapdt] .dt').tap();
    await expect(map(player).locator('[data-mapdt] .dt')).toHaveCount(0);
  });
});
