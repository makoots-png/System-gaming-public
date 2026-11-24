// Two-phone browser tests for the dodge-tile picker (src/core/combat/fight.ts, src/core/combat/fight-doc.ts,
// src/core/combat/map-view.ts, src/views/map.js, src/views/combat.js, src/views/table.js).
// Covers 360 px and 390 px viewports: non-default 2-tap pick, 1-tap default confirm, GM override,
// two hunters in one blast (sequential pick + tile exclusion), reload mid-pick, and ring-only wording.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { RULES } from '../../src/core/rules.ts';
import { abilityId } from '../../src/core/combat/ability-types.ts';
import { percent, tiles } from '../../src/core/combat/space.ts';
import { abilityOf } from '../../src/core/registry/ability-kinds.ts';
import { test, expect, PHONE, SMALL_PHONE, onboardGM, onboardPlayer, createRoom, dismissAll, go, fightRow, chooseList, setupDoc, type DeviceOptions } from './helpers.ts';

const HUNTER = 'Kai Dodge', HUNTER_B = 'Mira Dodge', MONSTER = 'Frost Imp';
const SHOTS = join('.lead-scratch', 'shots');
mkdirSync(SHOTS, { recursive: true });

const combat = (page: Page) => page.locator('#view-combat');
const map = (page: Page) => combat(page).locator('[data-mapbox]');
const token = (page: Page, id: string) => map(page).locator(`[data-tok="${id}"]`);

/** Every die rolls its highest face (d20 = 20), so a caught hunter's reaction always succeeds and opens dodge. */
const highestDice = (page: Page) => page.evaluate(() =>
  Object.defineProperty(crypto, 'getRandomValues', { configurable: true, value: (a: Uint32Array) => a.fill(0xffffffff) }));

const FROST_NOVA = abilityOf('blast', {
  id: abilityId('frost-nova'),
  name: 'Frost Nova',
  range: tiles(8),
  foesOnly: true,
  shape: { kind: 'radius', radius: tiles(1), ring: { outer: tiles(2), share: percent(50) } },
}, RULES);

const RING_NOVA = abilityOf('blast', {
  id: abilityId('ring-nova'),
  name: 'Frost Nova',
  range: tiles(8),
  foesOnly: true,
  shape: { kind: 'radius', radius: tiles(1), ring: { outer: tiles(4), share: percent(50) } },
}, RULES);

async function tileAt(page: Page, x: number, y: number): Promise<{ x: number; y: number }> {
  await map(page).locator('[data-frame]').scrollIntoViewIfNeeded();
  return map(page).locator('[data-world]').evaluate((w, [tx, ty]) => {
    const r = w.getBoundingClientRect(), s = r.width / (w as HTMLElement).offsetWidth;
    return { x: r.left + (tx! + 0.5) * 40 * s, y: r.top + (ty! + 0.5) * 40 * s };
  }, [x, y]);
}

async function tapTile(page: Page, x: number, y: number): Promise<void> {
  const p = await tileAt(page, x, y);
  await page.touchscreen.tap(p.x, p.y);
}

const placeOf = (page: Page, id: string) => token(page, id).evaluate(el => [Number((el as HTMLElement).dataset['x']), Number((el as HTMLElement).dataset['y'])]);

/** Creates a room on GM and joins `players` (one or more player phones). */
async function setupRoom(
  device: (label: string, o?: DeviceOptions) => Promise<{ page: Page }>,
  players: readonly { label: string; name: string; viewport: { width: number; height: number } }[],
  gmViewport: { width: number; height: number },
): Promise<{ gm: Page; code: string; pages: Page[] }> {
  const gm = (await device('gm', { viewport: gmViewport })).page;
  await onboardGM(gm);
  const code = await createRoom(gm);
  const pages: Page[] = [];
  for (const p of players) {
    const page = (await device(p.label, { viewport: p.viewport })).page;
    await onboardPlayer(page, p.name, code);
    await expect.poll(() => page.evaluate(() => hunterApp.api.sync.room())).toBe(code);
    await dismissAll(page, 4);
    pages.push(page);
  }
  await go(gm, 'gm');
  for (const p of players) {
    await expect(gm.locator('#gm-board .gm-card.remote', { hasText: p.name })).toHaveCount(1);
  }
  return { gm, code, pages };
}

/**
 * Starts a fight with `hunters` and one Frost Imp caster that holds `blast`, puts each hunter at `places`,
 * puts the imp at `impAt` on its turn, and opens Combat on every phone.
 */
async function startBlastFight(
  gm: Page,
  players: Page[],
  hunters: readonly { name: string; at: { x: number; y: number } }[],
  impAt: { x: number; y: number },
  blast: typeof FROST_NOVA = FROST_NOVA,
  grid?: { w: number; h: number; cover?: readonly { x: number; y: number }[] },
): Promise<{ impId: string; hunterIds: Record<string, string> }> {
  await go(gm, 'combat');
  await chooseList(gm);
  for (const h of hunters) {
    await combat(gm).locator('[data-hsel]').selectOption({ label: `${h.name} (player phone)` });
    await combat(gm).locator('[data-addh]').tap();
  }
  await combat(gm).locator('[data-qline]').fill(`${MONSTER}, E, caster`);
  await combat(gm).locator('[data-qadd]').tap();
  await combat(gm).locator('[data-start]').tap();
  await expect(combat(gm).locator('.cmb-row.cur')).toHaveCount(1);

  const ids = await gm.evaluate(([hs, mAt, ab, gr]) => {
    const hunterIds: Record<string, string> = {};
    let impId = '';
    hunterApp.store.update((d: any) => {
      const f = d.fight;
      if (gr) {
        const tilesArr = Array.from({ length: gr.w * gr.h }, () => 'floor');
        for (const c of gr.cover ?? []) tilesArr[c.y * gr.w + c.x] = 'cover';
        f.grid = { w: gr.w, h: gr.h, tiles: tilesArr };
      }
      const imp = f.rows.find((r: any) => r.kind === 'monster');
      imp.place = mAt;
      imp.at = f.now;
      imp.tie = 0;
      imp.mana = imp.sheet.manaMax;
      imp.abilities = [ab, ...imp.abilities.filter((x: any) => x.id !== ab.id)];
      impId = imp.id;
      hs.forEach((h: any, i: number) => {
        const row = f.rows.find((r: any) => r.name === h.name);
        row.place = h.at;
        row.at = f.now + 10 + i;
        row.tie = 0;
        hunterIds[h.name] = row.id;
      });
      f.currentId = imp.id;
      f.log = [];
    }, 'test-setup');
    return { impId, hunterIds };
  }, [hunters, impAt, blast, grid ?? null] as const);

  await combat(gm).locator('[data-fview="map"]').tap();
  await expect(token(gm, ids.impId)).toBeVisible();
  await highestDice(gm);

  for (let i = 0; i < players.length; i++) {
    const p = players[i]!, h = hunters[i]!;
    await setupDoc(p, h.name, h.at);
    await go(p, 'combat');
    await expect(combat(p).locator('[data-panel="table-hud"]')).toBeVisible();
    await expect.poll(() => p.evaluate(id => (hunterApp.api.sync.doc('fight') as any)?.currentId ?? null, ids.impId)).toBe(ids.impId);
  }
  return ids;
}

/** GM casts `Frost Nova` from the map hotbar at `(x, y)`. */
async function gmCastBlast(gm: Page, x: number, y: number): Promise<void> {
  await map(gm).locator('[data-frame]').dblclick({ position: { x: 4, y: 4 } });
  const btn = map(gm).locator('[data-hot] .mp-hb', { hasText: 'Frost Nova' }).first();
  await expect(btn).toBeVisible();
  await btn.tap();
  await tapTile(gm, x, y);
  const goBtn = map(gm).locator('[data-confirm] [data-go]');
  await expect(goBtn).toBeVisible();
  await goBtn.tap();
}

/** Picks an offered dodge tile that lies cleanly inside the visible map frame (not under top tools) and differs from `avoid`. */
async function visibleAltTile(player: Page, avoid: { x: number; y: number }): Promise<{ x: number; y: number }> {
  const offered = await playerDodgeTiles(player);
  const frameBox = (await map(player).locator('[data-frame]').boundingBox())!;
  const visible: { x: number; y: number }[] = [];
  for (const t of offered.tiles) {
    const p = await tileAt(player, t.x, t.y);
    if (p.x >= frameBox.x + 12 && p.x <= frameBox.x + frameBox.width - 12 && p.y >= frameBox.y + 52 && p.y <= frameBox.y + frameBox.height - 12) {
      visible.push(t);
    }
  }
  const alt = visible.find(t => t.x !== avoid.x || t.y !== avoid.y);
  expect(alt, 'at least one non-default offered dodge tile is directly visible in the map frame').toBeDefined();
  return alt!;
}
async function playerDodgeTiles(player: Page): Promise<{ auto: { x: number; y: number }; tiles: { x: number; y: number }[]; mode: string }> {
  return player.evaluate(() => {
    const doc = hunterApp.api.sync.doc('fight') as any;
    const d = doc.dodge, w = doc.grid.w;
    const list: { x: number; y: number }[] = [];
    for (const part of String(d.tiles || '').split(',').filter(Boolean)) {
      const [s, len] = part.split('+').map(Number);
      for (let i = 0; i < (len || 1); i++) {
        const idx = s! + i;
        list.push({ x: idx % w, y: Math.floor(idx / w) });
      }
    }
    return { auto: d.auto, tiles: list, mode: d.mode };
  });
}

test('360 px: list-view dodge banner, non-default two-tap dodge pick, touch targets, and screenshots', async ({ device }) => {
  const { gm, pages: [player] } = await setupRoom(device, [{ label: 'player', name: HUNTER, viewport: SMALL_PHONE }], SMALL_PHONE);
  const { hunterIds } = await startBlastFight(gm, [player!], [{ name: HUNTER, at: { x: 4, y: 4 } }], { x: 4, y: 8 });
  const kaiId = hunterIds[HUNTER]!;

  // Put the player in List view before the blast so the List-view dodge banner is verified too
  await combat(player!).locator('[data-fview="list"]').tap();
  await expect(combat(player!).locator('.tb-rows')).toBeVisible();

  await gmCastBlast(gm, 4, 4);

  // GM sees waiting banner + Use nearest safe tile, with confirm bar above bottom nav at 360 px
  await expect(combat(gm).locator('[data-dodge]')).toContainText(`Waiting for ${HUNTER} to dodge ${FROST_NOVA.name}.`);
  await expect(combat(gm).locator('[data-dodge-auto]')).toHaveText('Use nearest safe tile');
  await gm.evaluate(() => scrollTo(0, 0));
  const gmNav = (await gm.locator('.nav-bottom').boundingBox())!;
  const gmGo = (await map(gm).locator('[data-confirm] [data-go]').boundingBox())!;
  expect(gmGo.y + gmGo.height, 'GM confirm bar sits above bottom nav at 360 px').toBeLessThanOrEqual(gmNav.y + 2);
  await gm.screenshot({ path: join(SHOTS, 'gm-waiting-360.png') });

  // Player in List view sees DODGE banner + Open map to dodge button, no horizontal overflow
  await expect(combat(player!).locator('.tb-dodge')).toContainText('DODGE · Frost Nova');
  await expect(combat(player!).locator('[data-dodge-map]')).toHaveText('Open map to dodge');
  await player!.evaluate(() => scrollTo(0, 0));
  expect(await player!.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await player!.screenshot({ path: join(SHOTS, 'player-list-dodge-360.png') });

  // Tap Open map to dodge -> Map opens with offered dots and Dodge here confirm bar
  await combat(player!).locator('[data-dodge-map]').tap();
  const confirmBtn = map(player!).locator('[data-confirm] [data-go]');
  await expect(confirmBtn).toHaveText('Dodge here');
  await expect(map(player!).locator('[data-dtile]').first()).toBeAttached();
  await expect(map(player!).locator('[data-confirm] [data-cancel]')).toBeHidden();
  await expect(map(player!).locator('[data-hot]')).toBeHidden();

  // Check 360 px layout: no overflow, 44 px confirm target, confirm bar above bottom nav
  await player!.evaluate(() => scrollTo(0, 0));
  const navBox = (await player!.locator('.nav-bottom').boundingBox())!;
  const goBox = (await confirmBtn.boundingBox())!;
  expect(await player!.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(goBox.height, 'Dodge here button is at least 44 px tall').toBeGreaterThanOrEqual(44);
  expect(goBox.y + goBox.height, 'confirm bar sits above bottom nav').toBeLessThanOrEqual(navBox.y + 2);
  await player!.screenshot({ path: join(SHOTS, 'player-dodge-360.png') });

  // Pick a non-default offered tile visible in the frame (2 taps: tap alternate tile, then tap Dodge here)
  const offered = await playerDodgeTiles(player!);
  expect(offered.tiles.length).toBeGreaterThanOrEqual(2);
  const alt = await visibleAltTile(player!, offered.auto);
  await tapTile(player!, alt.x, alt.y);
  await expect(map(player!).locator(`[data-dtile="${alt.x},${alt.y}"]`)).toHaveClass(/\bon\b/);
  await confirmBtn.tap();

  // Both phones place Kai on the chosen non-default tile and close dodge
  await expect.poll(async () => (await fightRow(gm, HUNTER)).place, { timeout: 15_000 }).toEqual(alt);
  await expect.poll(() => placeOf(gm, kaiId), { timeout: 15_000 }).toEqual([alt.x, alt.y]);
  await expect.poll(() => placeOf(player!, kaiId), { timeout: 15_000 }).toEqual([alt.x, alt.y]);
  await expect(combat(gm).locator('[data-dodge]')).toBeHidden();
  await expect(combat(player!).locator('.tb-dodge')).toHaveCount(0);
});

test('390 px: one-tap default dodge confirm and GM one-tap override', async ({ device }) => {
  const { gm, pages: [player] } = await setupRoom(device, [{ label: 'player', name: HUNTER, viewport: PHONE }], PHONE);
  const { impId, hunterIds } = await startBlastFight(gm, [player!], [{ name: HUNTER, at: { x: 4, y: 4 } }], { x: 4, y: 8 });
  const kaiId = hunterIds[HUNTER]!;

  await test.step('default one-tap confirm lands on the nearest safe tile', async () => {
    await gmCastBlast(gm, 4, 4);
    const goBtn = map(player!).locator('[data-confirm] [data-go]');
    await expect(goBtn).toHaveText('Dodge here');
    const offered = await playerDodgeTiles(player!);
    // One tap directly on Dodge here without tapping a tile
    await goBtn.tap();
    await expect.poll(async () => (await fightRow(gm, HUNTER)).place, { timeout: 15_000 }).toEqual(offered.auto);
    await expect.poll(() => placeOf(player!, kaiId), { timeout: 15_000 }).toEqual([offered.auto.x, offered.auto.y]);
    await expect(combat(gm).locator('[data-dodge]')).toBeHidden();
  });

  await test.step('GM one-tap override resolves the dodge for a remote player', async () => {
    // Reset positions and return turn to the imp so it can blast again
    await gm.evaluate(([mId, kId]) => {
      hunterApp.store.update((d: any) => {
        const f = d.fight;
        const imp = f.rows.find((r: any) => r.id === mId), kai = f.rows.find((r: any) => r.id === kId);
        kai.place = { x: 4, y: 4 }; kai.life = { at: 'up', hp: kai.sheet.hpMax }; kai.at = f.now + 10;
        imp.place = { x: 4, y: 8 }; imp.at = f.now; imp.readyAt = {}; imp.mana = imp.sheet.manaMax;
        f.currentId = imp.id;
      }, 'test-setup');
    }, [impId, kaiId] as const);
    await setupDoc(player!, HUNTER, { x: 4, y: 4 });
    await expect.poll(() => placeOf(player!, kaiId), { timeout: 15_000 }).toEqual([4, 4]);

    await gmCastBlast(gm, 4, 4);
    await expect(combat(player!).locator('.tb-dodge')).toContainText('DODGE · Frost Nova');
    const offered = await playerDodgeTiles(player!);
    await combat(gm).locator('[data-dodge-auto]').tap();

    await expect.poll(async () => (await fightRow(gm, HUNTER)).place, { timeout: 15_000 }).toEqual(offered.auto);
    await expect.poll(() => placeOf(player!, kaiId), { timeout: 15_000 }).toEqual([offered.auto.x, offered.auto.y]);
    await expect(combat(player!).locator('.tb-dodge')).toHaveCount(0);
    await expect(combat(gm).locator('[data-dodge]')).toBeHidden();
  });
});

test('390 px: two hunters caught in one blast pick sequentially and exclude the first hunter\'s chosen tile', async ({ device }) => {
  const { gm, pages: [playerA, playerB] } = await setupRoom(
    device,
    [
      { label: 'playerA', name: HUNTER, viewport: PHONE },
      { label: 'playerB', name: HUNTER_B, viewport: PHONE },
    ],
    PHONE,
  );
  const { hunterIds } = await startBlastFight(
    gm,
    [playerA!, playerB!],
    [
      { name: HUNTER, at: { x: 4, y: 4 } },
      { name: HUNTER_B, at: { x: 5, y: 4 } },
    ],
    { x: 4, y: 8 },
  );
  const kaiId = hunterIds[HUNTER]!, miraId = hunterIds[HUNTER_B]!;

  await gmCastBlast(gm, 4, 4);

  // First dodger: Kai picks; Mira sees Waiting for Kai
  await expect(combat(playerA!).locator('.tb-dodge')).toContainText('DODGE · Frost Nova');
  await expect(combat(playerB!).locator('.tb-wait')).toContainText(`Waiting for ${HUNTER} to dodge.`);
  await expect(combat(gm).locator('[data-dodge]')).toContainText(`Waiting for ${HUNTER} to dodge ${FROST_NOVA.name}.`);

  const kaiOffer = await playerDodgeTiles(playerA!);
  // Pick a tile on the east/north side that would also be reachable by Mira if unoccupied (e.g. nearest to (5, 4))
  const kaiPick = [...kaiOffer.tiles].sort((a, b) => (Math.abs(a.x - 5) + Math.abs(a.y - 4)) - (Math.abs(b.x - 5) + Math.abs(b.y - 4)))[0]!;
  await tapTile(playerA!, kaiPick.x, kaiPick.y);
  await expect(map(playerA!).locator(`[data-dtile="${kaiPick.x},${kaiPick.y}"]`)).toHaveClass(/\bon\b/);
  await map(playerA!).locator('[data-confirm] [data-go]').tap();

  // Second dodger: Mira opens dodge, sees Kai already standing at kaiPick, and kaiPick is NOT offered to Mira
  await expect(combat(playerB!).locator('.tb-dodge')).toContainText('DODGE · Frost Nova', { timeout: 15_000 });
  await expect(combat(playerA!).locator('.tb-wait')).toContainText(`Waiting for ${HUNTER_B} to dodge.`);
  await expect.poll(() => placeOf(playerB!, kaiId), { timeout: 15_000 }).toEqual([kaiPick.x, kaiPick.y]);

  const miraOffer = await playerDodgeTiles(playerB!);
  expect(miraOffer.tiles.some(t => t.x === kaiPick.x && t.y === kaiPick.y), 'Kai\'s chosen tile is excluded from Mira\'s dodge options').toBe(false);

  const miraPick = await visibleAltTile(playerB!, miraOffer.auto);
  await tapTile(playerB!, miraPick.x, miraPick.y);
  await expect(map(playerB!).locator(`[data-dtile="${miraPick.x},${miraPick.y}"]`)).toHaveClass(/\bon\b/);
  await map(playerB!).locator('[data-confirm] [data-go]').tap();

  // Both hunters end up on their chosen tiles on all phones and dodge closes
  await expect.poll(async () => (await fightRow(gm, HUNTER)).place, { timeout: 15_000 }).toEqual(kaiPick);
  await expect.poll(async () => (await fightRow(gm, HUNTER_B)).place, { timeout: 15_000 }).toEqual(miraPick);
  await expect.poll(() => placeOf(playerA!, miraId), { timeout: 15_000 }).toEqual([miraPick.x, miraPick.y]);
  await expect(combat(gm).locator('[data-dodge]')).toBeHidden();
});

test('360 px: reloading both phones mid-pick preserves the dodge prompt and resolves cleanly', async ({ device }) => {
  const { gm, pages: [player] } = await setupRoom(device, [{ label: 'player', name: HUNTER, viewport: SMALL_PHONE }], SMALL_PHONE);
  const { hunterIds } = await startBlastFight(gm, [player!], [{ name: HUNTER, at: { x: 4, y: 4 } }], { x: 4, y: 8 });
  const kaiId = hunterIds[HUNTER]!;

  await gmCastBlast(gm, 4, 4);
  await expect(combat(player!).locator('.tb-dodge')).toContainText('DODGE · Frost Nova');
  await expect(combat(gm).locator('[data-dodge]')).toContainText(`Waiting for ${HUNTER} to dodge ${FROST_NOVA.name}.`);

  // Reload both GM and player phones mid-pick
  await gm.reload({ waitUntil: 'networkidle' });
  await gm.waitForFunction(() => window.hunterApp && document.querySelectorAll('#nav-top a').length > 0);
  await go(gm, 'combat');
  await player!.reload({ waitUntil: 'networkidle' });
  await player!.waitForFunction(() => window.hunterApp && document.querySelectorAll('#nav-top a').length > 0);
  await go(player!, 'combat');

  // Prompt survives on both phones
  await expect(combat(gm).locator('[data-dodge]')).toContainText(`Waiting for ${HUNTER} to dodge ${FROST_NOVA.name}.`);
  await expect(map(player!).locator('[data-confirm] [data-go]')).toHaveText('Dodge here');

  const offered = await playerDodgeTiles(player!);
  const alt = await visibleAltTile(player!, offered.auto);
  await tapTile(player!, alt.x, alt.y);
  await expect(map(player!).locator(`[data-dtile="${alt.x},${alt.y}"]`)).toHaveClass(/\bon\b/);
  await map(player!).locator('[data-confirm] [data-go]').tap();

  await expect.poll(async () => (await fightRow(gm, HUNTER)).place, { timeout: 15_000 }).toEqual(alt);
  await expect.poll(() => placeOf(player!, kaiId), { timeout: 15_000 }).toEqual([alt.x, alt.y]);
  await expect(combat(gm).locator('[data-dodge]')).toBeHidden();
});

test('390 px: ring-only dodge shows outer-ring wording, Stay here default, and switches to Dodge here on another ring tile', async ({ device }) => {
  const { gm, pages: [player] } = await setupRoom(device, [{ label: 'player', name: HUNTER, viewport: PHONE }], PHONE);
  // 7x7 grid, RING_NOVA outer radius 4 centered at (3,3) covers every reachable tile from Kai at (3,1); cover at (2,1)
  const { hunterIds } = await startBlastFight(
    gm,
    [player!],
    [{ name: HUNTER, at: { x: 3, y: 1 } }],
    { x: 3, y: 6 },
    RING_NOVA,
    { w: 7, h: 7, cover: [{ x: 2, y: 1 }] },
  );
  const kaiId = hunterIds[HUNTER]!;

  await gmCastBlast(gm, 3, 3);

  // GM sees ring-only waiting copy and Use nearest ring tile
  await expect(combat(gm).locator('[data-dodge]')).toContainText(`Waiting for ${HUNTER} to pick an outer-ring tile for ${RING_NOVA.name} (no way clear).`);
  await expect(combat(gm).locator('[data-dodge-auto]')).toHaveText('Use nearest ring tile');

  // Player sees ring-only prompt and Stay here default button
  await expect(combat(player!).locator('.tb-dodge')).toContainText('No way clear. Tap an outer-ring tile, or tap Stay here.');
  const goBtn = map(player!).locator('[data-confirm] [data-go]');
  await expect(goBtn).toHaveText('Stay here');
  await expect(map(player!).locator('[data-confirm] [data-words]')).toContainText('No way clear');
  await player!.evaluate(() => scrollTo(0, 0));
  await player!.screenshot({ path: join(SHOTS, 'ring-only-390.png') });

  // Tap cover tile (2,1) inside the outer ring -> button changes to Dodge here
  const offered = await playerDodgeTiles(player!);
  expect(offered.mode).toBe('ring');
  expect(offered.auto).toEqual({ x: 3, y: 1 });
  expect(offered.tiles.some(t => t.x === 2 && t.y === 1)).toBe(true);
  await tapTile(player!, 2, 1);
  await expect(goBtn).toHaveText('Dodge here');
  await expect(map(player!).locator('[data-confirm] [data-words]')).toContainText('outer-ring tile');
  await goBtn.tap();

  await expect.poll(async () => (await fightRow(gm, HUNTER)).place, { timeout: 15_000 }).toEqual({ x: 2, y: 1 });
  await expect.poll(() => placeOf(player!, kaiId), { timeout: 15_000 }).toEqual([2, 1]);
  await expect(combat(gm).locator('[data-dodge]')).toBeHidden();
});
