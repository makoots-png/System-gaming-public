// Battle maps (src/views/map-maker.js, src/core/registry/maps.ts) and the ground in a fight (src/core/combat/zones.ts,
// the party's view in src/core/combat/fight-doc.ts): a map made and saved in the Workshop, a gate's fight on it, walls
// a walk goes round, a fire that burns who stands in it, a foe behind a wall the player's phone does not hold, a wall
// the GM paints mid-fight, and a map shared to another phone. Two phones where a player is in it.
import type { Page } from '@playwright/test';
import { test, expect, onboardGM, onboardPlayer, createRoom, dismissAll, go, answerWindow, fightRow, gateByName, setupDoc } from './helpers.ts';

const HUNTER = 'Kai Map', MONSTER = 'Cave Rat';
const combat = (page: Page) => page.locator('#view-combat');
const map = (page: Page) => combat(page).locator('[data-mapbox]');
const token = (page: Page, id: string) => map(page).locator(`[data-tok="${id}"]`);
const maker = (page: Page) => page.locator('.mpm-overlay [role=dialog]');
const W = 20;
/** A cell of the map maker's grid, by its tile. */
const cell = (page: Page, x: number, y: number) => maker(page).locator(`[data-grid] [data-i="${y * W + x}"]`);

/** A GM and a player in one room, the player's card on the GM's party board. */
async function room(device: (label: string) => Promise<{ page: Page }>): Promise<{ gm: Page; player: Page }> {
  const gm = (await device('gm')).page, player = (await device('player')).page;
  await onboardGM(gm);
  const code = await createRoom(gm);
  await onboardPlayer(player, HUNTER, code);
  await expect.poll(() => player.evaluate(() => hunterApp.api.sync.room())).toBe(code);
  await dismissAll(player, 4);
  await go(gm, 'gm');
  await expect(gm.locator('#gm-board .gm-card.remote', { hasText: HUNTER })).toHaveCount(1);
  return { gm, player };
}

/** Both phones on the fight's map, framed. */
async function onMap(gm: Page, player: Page, kai: string): Promise<void> {
  await combat(gm).locator('[data-fview="map"]').tap();
  await go(player, 'combat');
  await combat(player).locator('[data-fview="map"]').tap();
  for (const p of [gm, player]) await expect(token(p, kai)).toBeVisible();
  for (const p of [gm, player]) await map(p).locator('[data-frame]').dblclick({ position: { x: 4, y: 4 } });
}

type Ground = { walls?: [number, number][]; fire?: [number, number][]; fog?: boolean; kai: [number, number]; rat: [number, number] };
/**
 * The GM's fight with the player's hunter and a rat (setup through the store: the ground, the places, the turn Kai's),
 * both phones on the map. The fire burns 10 magical a round. Answers the row ids.
 */
async function fightOn(gm: Page, player: Page, ground: Ground): Promise<{ kai: string; rat: string }> {
  await go(gm, 'combat');
  await combat(gm).locator('[data-hsel]').selectOption({ label: `${HUNTER} (remote)` });
  await combat(gm).locator('[data-addh]').tap();
  await combat(gm).locator('[data-qline]').fill(`${MONSTER}, E, brute`);
  await combat(gm).locator('[data-qadd]').tap();
  await combat(gm).locator('[data-start]').tap();
  await expect(map(gm).locator('.mp-tok.now')).toHaveCount(1);
  const ids = await gm.evaluate(g => {
    let out = { kai: '', rat: '' };
    hunterApp.store.update((d: any) => {
      const f = d.fight, kai = f.rows.find((r: any) => r.kind === 'hunter'), rat = f.rows.find((r: any) => r.kind === 'monster');
      const { w, h } = f.grid, walls = new Set((g.walls ?? []).map(([x, y]: number[]) => y! * w + x!));
      f.grid = { w, h, tiles: Array.from({ length: w * h }, (_, i) => (walls.has(i) ? 'wall' : 'floor')) };
      f.zones = g.fire ? [{ id: 'z-fire', name: 'Fire', ground: { kind: 'tiles', tiles: g.fire.map(([x, y]: number[]) => ({ x, y })) }, owner: null, spares: null, tier: 0, until: null, endsWithOwner: false,
        ops: [{ op: 'damage', type: 'magical', amount: { kind: 'number', value: 10 } }] }] : [];
      f.fog = g.fog ? { sight: 25, seen: '0'.repeat(w * h) } : null;
      kai.place = { x: g.kai[0], y: g.kai[1] }; rat.place = { x: g.rat[0], y: g.rat[1] };
      kai.at = f.now; kai.tie = 0; rat.at = f.now + 1; rat.tie = 0; f.currentId = kai.id; f.log = [];
      out = { kai: kai.id, rat: rat.id };
    }, 'test-setup');
    return out;
  }, ground);
  // the player's map may hold the doc of the fight's start: a tap worked out from it is not this ground's (helpers.ts `setupDoc`)
  await setupDoc(player, HUNTER, { x: ground.kai[0], y: ground.kai[1] });
  await onMap(gm, player, ids.kai);
  return ids;
}

/** Where the centre of tile (x, y) is on the page. */
async function tileAt(page: Page, x: number, y: number): Promise<{ x: number; y: number }> {
  return map(page).locator('[data-world]').evaluate((w, [tx, ty]) => {
    const r = w.getBoundingClientRect(), s = r.width / (w as HTMLElement).offsetWidth;
    return { x: r.left + (tx! + 0.5) * 40 * s, y: r.top + (ty! + 0.5) * 40 * s };
  }, [x, y]);
}
async function tapTile(page: Page, x: number, y: number): Promise<void> {
  const p = await tileAt(page, x, y);
  await page.touchscreen.tap(p.x, p.y);
}
const walls = (page: Page) => map(page).locator('.mp-t.wall');
const placeOf = (page: Page, id: string) => token(page, id).evaluate(el => [Number((el as HTMLElement).dataset['x']), Number((el as HTMLElement).dataset['y'])]);

test('a GM paints walls and a fire in the Workshop, saves the map, names it on a gate, and the gate\'s fight shows them on both phones', async ({ device }) => {
  const { gm, player } = await room(device);
  await test.step('the GM draws the map in the map maker and saves it', async () => {
    await go(gm, 'workshop');
    await gm.locator('#view-workshop [data-ws="map"] [data-new]').tap();
    await maker(gm).locator('[data-name]').fill('Ash Crypt');
    await maker(gm).locator('[data-brush="wall"]').tap();
    const from = (await cell(gm, 9, 3).boundingBox())!, to = (await cell(gm, 9, 7).boundingBox())!;
    await gm.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await gm.mouse.down();
    await gm.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 8 });
    await gm.mouse.up();
    await maker(gm).locator('[data-newzone]').tap();
    await maker(gm).locator('[data-zname]').fill('Fire');
    await cell(gm, 2, 5).tap();
    await cell(gm, 3, 5).tap();
    await expect(maker(gm).locator('.mk-preview')).toContainText('20 by 14 tiles: 5 wall');
    await expect(maker(gm).locator('.mk-preview')).toContainText('Fire: 2 tiles');
    await maker(gm).locator('[data-apply]').tap();
    await expect(maker(gm)).toHaveCount(0);
    const saved = await gm.evaluate(() => hunterApp.store.get().library.maps[0]);
    expect(saved.name).toBe('Ash Crypt');
    expect([3, 4, 5, 6, 7].map(y => saved.tiles[y * 20 + 9])).toEqual(['#', '#', '#', '#', '#']);
    expect(saved.zones.map((z: any) => [z.name, z.ground])).toEqual([['Fire', { kind: 'tiles', tiles: [{ x: 2, y: 5 }, { x: 3, y: 5 }] }]]);
    await expect(gm.locator('#view-workshop [data-ws="map"] li', { hasText: 'Ash Crypt' })).toHaveCount(1);
  });
  await test.step('the Goblin Den names the map, and its fight is fought on it', async () => {
    const gate = await gateByName(gm, 'Goblin Den');
    const card = gm.locator(`#view-gates .gate[data-id="${gate.id}"]`);
    await card.locator('[data-act=edit]').tap();
    await card.locator('select[name=map]').selectOption({ label: 'Ash Crypt' });
    await card.locator('.gt-panel [type=submit]').tap();
    await expect(card.locator('.gt-notes', { hasText: 'Battle map: Ash Crypt' })).toBeVisible();
    await card.locator('[data-act=encounter]').tap();
    const dlg = gm.locator('[aria-modal="true"]');
    for (const box of await dlg.locator('input[name=hid]').all()) await box.uncheck();
    await dlg.locator('input[name=roll]').uncheck();
    await dlg.locator('[data-apply]').tap();
    await combat(gm).locator('[data-hsel]').selectOption({ label: `${HUNTER} (remote)` });
    await combat(gm).locator('[data-addh]').tap();
    await combat(gm).locator('[data-start]').tap();
    const f = await gm.evaluate(() => hunterApp.store.get().fight);
    expect(f.grid.tiles[3 * 20 + 9]).toBe('wall');
    expect(f.zones.map((z: any) => z.name)).toEqual(['Fire']);
  });
  await test.step('both phones draw the five walls and the fire', async () => {
    const kai = (await fightRow(gm, HUNTER)).id;
    await onMap(gm, player, kai);
    for (const p of [gm, player]) {
      await expect(walls(p)).toHaveCount(5);
      await expect(map(p).locator('.mp-zone.harm')).toHaveCount(1);
    }
  });
});

test('a hunter cannot walk through a wall: the way to the tile beyond goes round it, three steps where two would do', async ({ device }) => {
  const { gm, player } = await room(device);
  const { kai } = await fightOn(gm, player, { walls: [[8, 5]], kai: [7, 5], rat: [15, 12] });
  await tapTile(player, 9, 5);
  const confirm = map(player).locator('[data-confirm]');
  // round the wall: a diagonal step up and one down, the second diagonal costing 2 by the 5-10-5 count (design 5.1)
  await expect(confirm.locator('[data-words]')).toHaveText('3 tiles: half of your turn');
  await confirm.locator('[data-go]', { hasText: 'Move' }).tap();
  for (const p of [gm, player]) await expect.poll(() => placeOf(p, kai)).toEqual([9, 5]);
  expect(await gm.evaluate(() => hunterApp.store.get().fight.log.some((l: { text: string }) => l.text.includes('moves 3 tiles')))).toBe(true);
});

test('a hunter who ends a turn in the fire takes its damage at their next turn, and their card says Fire', async ({ device }) => {
  const { gm, player } = await room(device);
  const { kai } = await fightOn(gm, player, { fire: [[4, 4]], kai: [4, 4], rat: [15, 12] });
  const hp0 = (await fightRow(gm, HUNTER)).hp, t0 = await gm.evaluate(() => hunterApp.store.get().fight.now as number);
  await map(player).locator('[data-pass]').tap();
  await expect(token(gm, kai)).not.toHaveClass(/\bnow\b/);
  await combat(gm).locator('[data-next], [data-fk="next"]').first().tap();
  await expect(combat(player).locator('.tb-mine')).toContainText('YOUR TURN');
  const now = await gm.evaluate(() => hunterApp.store.get().fight.now as number);
  // 10 a round for the time Kai stood in it, a round being 1000 ticks (RULES.fight.round), as a status settles
  expect(now).toBeGreaterThan(t0);
  expect(hp0 - (await fightRow(gm, HUNTER)).hp).toBe(Math.round(10 * (now - t0) / 1000));
  await token(player, kai).tap();
  await expect(combat(player).locator('[data-tbsheet]')).toContainText('Fire');
});

test('a foe behind a wall is not on the player\'s phone and appears when the hunter steps past the wall\'s end; the GM sees it dimmed until then', async ({ device }) => {
  const { gm, player } = await room(device);
  const wall: [number, number][] = Array.from({ length: 9 }, (_, y) => [8, y]);
  const { kai, rat } = await fightOn(gm, player, { walls: wall, fog: true, kai: [7, 9], rat: [12, 2] });
  await expect(token(gm, rat)).toHaveClass(/\bhidden\b/);
  await expect(token(player, rat)).toHaveCount(0);
  expect(JSON.stringify(await player.evaluate(() => hunterApp.api.sync.doc('fight')))).not.toContain(MONSTER);
  await tapTile(player, 9, 9);
  await map(player).locator('[data-confirm] [data-go]').tap();
  await expect.poll(() => placeOf(gm, kai)).toEqual([9, 9]);
  await expect(token(player, rat)).toBeVisible();
  await expect(token(gm, rat)).not.toHaveClass(/\bhidden\b/);
});

test('a wall the GM paints mid-fight appears on the player\'s phone', async ({ device }) => {
  const { gm, player } = await room(device);
  await fightOn(gm, player, { walls: [[0, 0]], kai: [2, 2], rat: [15, 12] });
  for (const p of [gm, player]) await expect(walls(p)).toHaveCount(1);
  await map(gm).locator('[data-painttog]').tap();
  await expect(map(gm).locator('[data-paint] [data-brush="t:wall"]')).toHaveAttribute('aria-pressed', 'true');
  await tapTile(gm, 5, 5);
  await expect.poll(() => gm.evaluate(() => hunterApp.store.get().fight.grid.tiles[5 * 20 + 5])).toBe('wall');
  await expect(walls(gm)).toHaveCount(2);
  await expect(walls(player)).toHaveCount(2);
});

test('a map shared from the Workshop arrives on another phone with its walls and its fire', async ({ device }) => {
  const gm = (await device('gm')).page;
  await onboardGM(gm);
  const MAP = { id: 'mp900', name: 'Frost Hall', w: 6, h: 4, tiles: '#######....##.~o.#######', fog: true, sight: 6, starts: { party: [{ x: 1, y: 1 }], foe: [{ x: 4, y: 2 }] },
    zones: [{ id: 'z1', name: 'Ice', ground: { kind: 'tiles', tiles: [{ x: 2, y: 1 }] }, ops: [{ op: 'speed', pct: -30 }] }] };
  await gm.evaluate(m => hunterApp.store.update((d: any) => { d.library.maps.push(m); }, 'test-setup'), MAP);
  await go(gm, 'workshop');
  await gm.locator('#view-workshop [data-ws="map"] li', { hasText: 'Frost Hall' }).locator('[data-act="more"]').tap();
  await gm.locator('.sys-overlay.show', { hasText: 'Frost Hall' }).locator('.sys-actions button', { hasText: 'Share' }).tap();
  const box = gm.locator('.sys-overlay.show', { hasText: 'Share code' }).locator('[data-pack-code]');
  await expect(box).toHaveValue(/^HS1\./);
  const code = await box.inputValue();
  await answerWindow(gm, 'Share code', 'Close');

  const other = (await device('other')).page;
  await onboardGM(other);
  await go(other, 'data');
  await other.locator('#view-data [data-paste]').fill(code);
  await other.locator('#view-data [data-read-code]').tap();
  await answerWindow(other, 'Import custom content', 'Add');
  const got = await other.evaluate(() => hunterApp.store.get().library.maps);
  expect(got.map((m: any) => [m.name, m.tiles, m.fog, m.sight, m.zones.map((z: any) => z.name)])).toEqual([['Frost Hall', MAP.tiles, true, 6, ['Ice']]]);
  await go(other, 'workshop');
  await expect(other.locator('#view-workshop [data-ws="map"] li', { hasText: 'Frost Hall' })).toHaveCount(1);
});

test('the GM widens the map from Fight tools mid-fight and the player\'s map grows with it; a shrink that would cut off the rat is refused', async ({ device }) => {
  const { gm, player } = await room(device);
  const { rat } = await fightOn(gm, player, { kai: [2, 2], rat: [19, 5] });
  const tools = combat(gm).locator('[data-tools]');
  await combat(gm).locator('[data-tools-open]').tap();
  await tools.locator('[data-resize="w"][data-d="1"]').tap();
  await expect(tools.locator('[data-mapsize="w"]')).toHaveText('21');
  expect(await gm.evaluate(() => [hunterApp.store.get().fight.grid.w, hunterApp.store.get().fight.grid.h])).toEqual([21, 14]);
  // 40 pixels a tile at zoom 1 (map.js TILE)
  await expect.poll(() => map(player).locator('[data-world]').evaluate(w => (w as HTMLElement).offsetWidth)).toBe(21 * 40);
  await tools.locator('[data-resize="w"][data-d="-1"]').tap();
  await expect(tools.locator('[data-mapsize="w"]')).toHaveText('20');
  await tools.locator('[data-resize="w"][data-d="-1"]').tap();
  await expect(gm.getByText('the map cannot shrink past it')).toBeVisible();
  await expect(tools.locator('[data-mapsize="w"]')).toHaveText('20');
  expect(await placeOf(gm, rat)).toEqual([19, 5]);
  await expect.poll(() => map(player).locator('[data-world]').evaluate(w => (w as HTMLElement).offsetWidth)).toBe(20 * 40);
});

test('a GM makes an aura skill; the player\'s hunter casts it, walks, and the ally the aura comes over is healed on both phones', async ({ device }) => {
  const { gm, player } = await room(device);
  const skm = gm.locator('.skm-overlay [role=dialog]');
  await test.step('the GM makes Healing Light: a support that leaves a field around its user, healing 5 as it reaches someone', async () => {
    await go(gm, 'gm');
    await gm.locator('#gm-make [data-make="skill"]').tap();
    await skm.locator('#skm-name').fill('Healing Light');
    await skm.locator('[data-chips="kind"] [data-chip="support"]').tap();
    await skm.locator('[data-group="zone"] > summary').tap();
    await skm.locator('[data-a="zone"]').check();
    await skm.locator('[data-chips="zwhere"] [data-chip="user"]').tap();
    await skm.locator('[data-a="zradius"]').fill('2');
    await skm.locator('[data-a="zname"]').fill('Healing light');
    await skm.locator('[data-zone-fx] [data-row="0"] [data-f="kind"]').selectOption('heal');
    await skm.locator('[data-zone-fx] [data-row="0"] [data-f="q"]').fill('5');
    await skm.locator('[data-zone-fx] [data-row="0"] [data-when="use"]').tap();
    await expect(skm.locator('[data-sum="zone"]')).toHaveText('Leaves Healing light around the user for 2 rounds');
    await expect(skm.locator('.mk-preview')).toContainText('Leaves Healing light around its user for 2 rounds, 2 tiles out');
    await skm.locator('[data-apply]').tap();
    await expect(skm).toHaveCount(0);
    const made = await gm.evaluate(() => hunterApp.store.get().library.skills.find((k: any) => k.name === 'Healing Light'));
    expect(made.ability.zone).toMatchObject({ name: 'Healing light', around: 2, grow: null, endsWithOwner: false });
    await player.evaluate(([skill, name]) => hunterApp.store.update((d: any) => { d.hunters.find((h: any) => h.name === name).skills.push({ ...skill, id: 'sk-light' }); }, 'test-setup'), [made, HUNTER] as const);
    await expect.poll(() => gm.evaluate(n => JSON.stringify(hunterApp.api.sync.remoteSheets().find((r: any) => r.data.name === n)?.data.skills ?? []), HUNTER)).toContain('Healing Light');
  });
  const { kai } = await fightOn(gm, player, { kai: [2, 5], rat: [15, 12] });
  const ally = 'ally-mira';
  await gm.evaluate(([id, k]) => hunterApp.store.update((d: any) => {
    const me = d.fight.rows.find((r: any) => r.id === k);
    d.fight.rows.push({ ...me, id, name: 'Mira Ally', holder: null, place: { x: 6, y: 5 }, hp: 10, at: d.fight.now + 5000, statuses: [] });
  }, 'test-setup'), [ally, kai] as const);
  const allyHp = async (p: Page) => p === gm
    ? gm.evaluate(id => hunterApp.store.get().fight.rows.find((r: any) => r.id === id).hp as number, ally)
    : player.evaluate(id => (hunterApp.api.sync.doc('fight') as any).rows.find((r: any) => r.id === id)?.hp as number, ally);
  await expect.poll(() => allyHp(player)).toBe(10);
  await test.step('the player casts it on themselves: the light lies around Kai and Mira, 4 tiles off, is outside it', async () => {
    await map(player).locator('[data-hot] .mp-hb', { hasText: 'Healing Light' }).tap();
    await tapTile(player, 2, 5);
    await map(player).locator('[data-go]').tap();
    await expect.poll(() => gm.evaluate(() => hunterApp.store.get().fight.zones.map((z: any) => [z.name, z.ground.kind]))).toEqual([['Healing light', 'around']]);
    for (const p of [gm, player]) await expect(map(p).locator('.mp-zone.help')).toHaveCount(1);
    expect(await allyHp(gm)).toBe(10);
  });
  await test.step('Kai walks two tiles toward Mira; the light goes with Kai, comes over Mira, and heals her 5 on both phones', async () => {
    await combat(gm).locator('[data-next], [data-fk="next"]').first().tap();
    await expect(combat(player).locator('.tb-mine')).toContainText('YOUR TURN');
    await tapTile(player, 4, 5);
    await map(player).locator('[data-confirm] [data-go]').tap();
    await expect.poll(() => placeOf(gm, kai)).toEqual([4, 5]);
    await expect.poll(() => allyHp(gm)).toBe(15);
    await expect.poll(() => allyHp(player)).toBe(15);
  });
});

test('a rat given the Plague passes it to the rat beside it once a round has passed, and it never comes back to the first', async ({ device }) => {
  const { gm, player } = await room(device);
  await go(gm, 'combat');
  await combat(gm).locator('[data-hsel]').selectOption({ label: `${HUNTER} (remote)` });
  await combat(gm).locator('[data-addh]').tap();
  await combat(gm).locator('[data-qline]').fill(`${MONSTER} x2, E, brute`);
  await combat(gm).locator('[data-qadd]').tap();
  await combat(gm).locator('[data-start]').tap();
  const [first, second] = await gm.evaluate(() => {
    let out: string[] = [];
    hunterApp.store.update((d: any) => {
      const f = d.fight, rats = f.rows.filter((r: any) => r.kind === 'monster'), kai = f.rows.find((r: any) => r.kind === 'hunter');
      kai.place = { x: 2, y: 2 }; rats[0].place = { x: 10, y: 8 }; rats[1].place = { x: 11, y: 8 }; // the GM's phone only: no player taps in this test
      rats[0].statuses = [{ key: 'plague', def: hunterApp.rules().conditions.plague, source: { id: null, tier: 0 }, until: f.now + 1500, since: f.now, settledAt: f.now }];
      out = rats.map((r: any) => r.id);
    }, 'test-setup');
    return out;
  });
  // every die the GM's phone rolls is its lowest: the rat beside it fails its resist (rule 8b)
  await gm.evaluate(() => Object.defineProperty(crypto, 'getRandomValues', { configurable: true, value: (a: Uint32Array) => a.fill(0) }));
  const has = (id: string) => gm.evaluate(([r]) => hunterApp.store.get().fight.rows.find((x: any) => x.id === r).statuses.some((s: any) => s.key === 'plague'), [id] as const);
  const next = combat(gm).locator('[data-next], [data-fk="next"]').first();
  await test.step('the turns pass until the second rat catches it', async () => {
    await expect.poll(async () => { if (!await has(second!)) await next.tap(); return has(second!); }, { timeout: 30_000 }).toBe(true);
    expect(await gm.evaluate(() => hunterApp.store.get().fight.log.filter((l: { text: string }) => l.text.includes('catches Plague')).length)).toBe(1);
  });
  await test.step('the turns pass on until both are well; the first never caught it again', async () => {
    await expect.poll(async () => {
      const sick = (await has(first!)) || (await has(second!));
      if (sick) await next.tap();
      return sick;
    }, { timeout: 60_000 }).toBe(false);
    const f = await gm.evaluate(() => hunterApp.store.get().fight);
    expect(f.had.plague).toEqual([first, second]);
    expect(f.log.filter((l: { text: string }) => l.text.includes('catches Plague')).length).toBe(1);
  });
  void player;
});
