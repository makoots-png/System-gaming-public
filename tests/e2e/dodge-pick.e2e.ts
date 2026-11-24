// Two-phone browser tests for dodge picker v2 (src/core/combat/fight.ts, src/core/combat/fight-doc.ts,
// src/core/combat/map-view.ts, src/views/map.js, src/views/combat.js, src/views/table.js).
// Covers 360 px and 390 px viewports: free pick with walk route and single gold marker, Stay here (0 movement),
// partly spent movement bank and 0-bank auto-stay, GM override, two hunters in one blast, reload mid-pick, and ring-only.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { RULES } from '../../src/core/rules.ts';
import { abilityId } from '../../src/core/combat/ability-types.ts';
import { percent, tiles } from '../../src/core/combat/space.ts';
import { abilityOf } from '../../src/core/registry/ability-kinds.ts';
import { docDodge } from '../../src/core/combat/map-view.ts';
import type { FightDoc } from '../../src/core/combat/fight-doc.ts';
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
 * Starts a fight with `hunters` and one or more Frost Imp casters that hold `blast`, puts everyone at their starting
 * tiles, and opens Combat on every phone.
 */
async function startBlastFight(
  gm: Page,
  players: Page[],
  hunters: readonly { name: string; at: { x: number; y: number } }[],
  impAt: { x: number; y: number },
  blast: typeof FROST_NOVA = FROST_NOVA,
  opts?: {
    grid?: { w: number; h: number; cover?: readonly { x: number; y: number }[] };
    extraImp?: { x: number; y: number };
    hunterFirst?: boolean;
  },
): Promise<{ impId: string; extraImpId: string | null; hunterIds: Record<string, string> }> {
  await go(gm, 'combat');
  await chooseList(gm);
  for (const h of hunters) {
    await combat(gm).locator('[data-hsel]').selectOption({ label: `${h.name} (player phone)` });
    await combat(gm).locator('[data-addh]').tap();
  }
  const monsterCount = opts?.extraImp ? 2 : 1;
  await combat(gm).locator('[data-qline]').fill(`${MONSTER}${monsterCount > 1 ? ` x${monsterCount}` : ''}, E, caster`);
  await combat(gm).locator('[data-qadd]').tap();
  await combat(gm).locator('[data-start]').tap();
  await expect(combat(gm).locator('.cmb-row.cur')).toHaveCount(1);

  const ids = await gm.evaluate(([hs, mAt, ab, extra]) => {
    const hunterIds: Record<string, string> = {};
    let impId = '', extraImpId: string | null = null;
    hunterApp.store.update((d: any) => {
      const f = d.fight;
      if (extra?.grid) {
        const tilesArr = Array.from({ length: extra.grid.w * extra.grid.h }, () => 'floor');
        for (const c of extra.grid.cover ?? []) tilesArr[c.y * extra.grid.w + c.x] = 'cover';
        f.grid = { w: extra.grid.w, h: extra.grid.h, tiles: tilesArr };
      }
      const imps = f.rows.filter((r: any) => r.kind === 'monster');
      const imp = imps[0];
      imp.place = mAt;
      imp.at = extra?.hunterFirst ? f.now + 50 : f.now;
      imp.tie = 0;
      imp.mana = imp.sheet.manaMax;
      imp.abilities = [ab, ...imp.abilities.filter((x: any) => x.id !== ab.id)];
      impId = imp.id;
      if (extra?.extraImp && imps[1]) {
        const imp2 = imps[1];
        imp2.place = extra.extraImp;
        imp2.at = extra.hunterFirst ? f.now + 100 : f.now + 5;
        imp2.tie = 0;
        imp2.mana = imp2.sheet.manaMax;
        imp2.abilities = [ab, ...imp2.abilities.filter((x: any) => x.id !== ab.id)];
        extraImpId = imp2.id;
      }
      hs.forEach((h: any, i: number) => {
        const row = f.rows.find((r: any) => r.name === h.name);
        row.place = h.at;
        row.at = extra?.hunterFirst && i === 0 ? f.now : f.now + 200 + i;
        row.tie = 0;
        delete row.moved;
        hunterIds[h.name] = row.id;
      });
      f.currentId = extra?.hunterFirst ? hunterIds[hs[0]!.name] : imp.id;
      f.log = [];
    }, 'test-setup');
    return { impId, extraImpId, hunterIds };
  }, [hunters, impAt, blast, opts ?? null] as const);

  await combat(gm).locator('[data-fview="map"]').tap();
  await expect(token(gm, ids.impId)).toBeVisible();
  await highestDice(gm);

  const firstId = opts?.hunterFirst ? ids.hunterIds[hunters[0]!.name]! : ids.impId;
  for (let i = 0; i < players.length; i++) {
    const p = players[i]!, h = hunters[i]!;
    await setupDoc(p, h.name, h.at);
    await go(p, 'combat');
    await expect(combat(p).locator('[data-panel="table-hud"]')).toBeVisible();
    await expect.poll(() => p.evaluate(id => (hunterApp.api.sync.doc('fight') as any)?.currentId ?? null, firstId)).toBe(firstId);
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

/** Decodes the player's current dodge prompt using core's shared `docDodge`. */
async function playerDodgeTiles(player: Page) {
  const doc = await player.evaluate(() => hunterApp.api.sync.doc('fight') as FightDoc);
  if (!doc || doc.ended) throw new Error('expected live fight doc');
  const dg = docDodge(doc);
  if (!dg) throw new Error('expected open dodge prompt');
  return dg;
}

/** Picks an offered dodge tile that lies cleanly inside the visible map frame (not under top tools), matches `want`, and differs from `avoid`. */
async function visibleAltTile(
  player: Page,
  avoid: { x: number; y: number },
  want: 'out' | 'ring' | 'any' = 'out',
): Promise<{ x: number; y: number; steps: number; avoid: string }> {
  const offered = await playerDodgeTiles(player);
  const frameBox = (await map(player).locator('[data-frame]').boundingBox())!;
  const pool = want === 'any' ? offered.tiles : offered.tiles.filter(t => t.avoid === want);
  const visible: { x: number; y: number; steps: number; avoid: string }[] = [];
  for (const t of pool) {
    const p = await tileAt(player, t.place.x, t.place.y);
    if (p.x >= frameBox.x + 12 && p.x <= frameBox.x + frameBox.width - 12 && p.y >= frameBox.y + 52 && p.y <= frameBox.y + frameBox.height - 12) {
      visible.push({ x: t.place.x, y: t.place.y, steps: t.steps, avoid: t.avoid });
    }
  }
  const alt = visible.find(t => t.x !== avoid.x || t.y !== avoid.y);
  expect(alt, 'at least one non-default offered dodge tile is directly visible in the map frame').toBeDefined();
  return alt!;
}

/** Checks no horizontal overflow and that the confirm button fits above the bottom nav bar. */
async function checkMobileFit(page: Page, label: string): Promise<void> {
  await page.evaluate(() => scrollTo(0, 0));
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${label}: no horizontal overflow`).toBe(true);
  const navBox = (await page.locator('.nav-bottom').boundingBox())!;
  const goBox = (await map(page).locator('[data-confirm] [data-go]').boundingBox())!;
  expect(goBox.height, `${label}: confirm button >= 44 px`).toBeGreaterThanOrEqual(44);
  expect(goBox.y + goBox.height, `${label}: confirm bar sits above bottom nav`).toBeLessThanOrEqual(navBox.y + 2);
}

test('360 px: list-view dodge banner, Stay here (0 movement), free pick with route, GM override view, and screenshots', async ({ device }) => {
  const { gm, pages: [player] } = await setupRoom(device, [{ label: 'player', name: HUNTER, viewport: SMALL_PHONE }], SMALL_PHONE);
  const { hunterIds } = await startBlastFight(gm, [player!], [{ name: HUNTER, at: { x: 4, y: 4 } }], { x: 4, y: 8 });
  const kaiId = hunterIds[HUNTER]!;

  // Put the player in List view before the blast so the List-view dodge banner is verified too
  await combat(player!).locator('[data-fview="list"]').tap();
  await expect(combat(player!).locator('.tb-rows')).toBeVisible();

  await gmCastBlast(gm, 4, 4);

  // GM sees waiting banner with movement bank + Use nearest safe tile, with confirm bar above bottom nav at 360 px
  await expect(combat(gm).locator('[data-dodge]')).toContainText('6 of 6 movement left');
  await expect(combat(gm).locator('[data-dodge]')).toContainText(FROST_NOVA.name);
  await expect(combat(gm).locator('[data-dodge-auto]')).toHaveText('Use nearest safe tile');
  await checkMobileFit(gm, 'gm-override-360');
  await gm.screenshot({ path: join(SHOTS, 'gm-override-360.png') });

  // Player in List view sees DODGE banner with movement bank + Open map to dodge button, no horizontal overflow
  await expect(combat(player!).locator('.tb-dodge')).toContainText('DODGE · Frost Nova');
  await expect(combat(player!).locator('.tb-dodge')).toContainText('6 movement left');
  await expect(combat(player!).locator('[data-dodge-map]')).toHaveText('Open map to dodge');
  await player!.evaluate(() => scrollTo(0, 0));
  expect(await player!.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  // Tap Open map to dodge -> Map opens with single gold marker, route shade, and Dodge here confirm bar
  await combat(player!).locator('[data-dodge-map]').tap();
  const confirmBtn = map(player!).locator('[data-confirm] [data-go]');
  const confirmWords = map(player!).locator('[data-confirm] [data-words]');
  await expect(confirmBtn).toHaveText('Dodge here');
  await expect(map(player!).locator('[data-dtile]')).toHaveCount(1);
  await expect(map(player!).locator('[data-shade="way"]')).toHaveCount(1);
  await expect(map(player!).locator('[data-confirm] [data-cancel]')).toBeHidden();
  await expect(map(player!).locator('[data-hot]')).toBeHidden();
  await expect(confirmWords).toContainText('Clear of attack.');

  // Tap own token (4,4) -> Stay here with 0 movement and Full hit warning
  await tapTile(player!, 4, 4);
  await expect(confirmBtn).toHaveText('Stay here');
  await expect(confirmWords).toHaveText('Stay here (0 movement). Full hit.');
  await expect(map(player!).locator('[data-dtile="4,4"]')).toHaveClass(/\bon\b/);
  await checkMobileFit(player!, 'stay-here-360');
  await player!.screenshot({ path: join(SHOTS, 'stay-here-360.png') });

  // Pick a non-default free out tile visible in the frame -> route + single gold marker + movement cost
  const offered = await playerDodgeTiles(player!);
  expect(offered.tiles.length).toBeGreaterThanOrEqual(2);
  const alt = await visibleAltTile(player!, offered.auto, 'out');
  await tapTile(player!, alt.x, alt.y);
  await expect(confirmBtn).toHaveText('Dodge here');
  await expect(confirmWords).toContainText('Clear of attack.');
  expect(await confirmWords.textContent()).toBe(`Uses ${alt.steps} of 6 movement. Clear of attack.`);
  await expect(map(player!).locator(`[data-dtile="${alt.x},${alt.y}"]`)).toHaveClass(/\bon\b/);
  await expect(map(player!).locator('[data-dtile]')).toHaveCount(1);
  await expect(map(player!).locator('[data-shade="way"]')).toHaveCount(1);
  await checkMobileFit(player!, 'free-pick-360');
  await player!.screenshot({ path: join(SHOTS, 'free-pick-360.png') });

  await confirmBtn.tap();

  // Both phones place Kai on the chosen non-default tile and close dodge
  await expect.poll(async () => (await fightRow(gm, HUNTER)).place, { timeout: 15_000 }).toEqual({ x: alt.x, y: alt.y });
  await expect.poll(() => placeOf(gm, kaiId), { timeout: 15_000 }).toEqual([alt.x, alt.y]);
  await expect.poll(() => placeOf(player!, kaiId), { timeout: 15_000 }).toEqual([alt.x, alt.y]);
  await expect(combat(gm).locator('[data-dodge]')).toBeHidden();
  await expect(combat(player!).locator('.tb-dodge')).toHaveCount(0);
});

test('390 px: Stay here (0 movement), free pick with route, one-tap default confirm, and GM one-tap override', async ({ device }) => {
  const { gm, pages: [player] } = await setupRoom(device, [{ label: 'player', name: HUNTER, viewport: PHONE }], PHONE);
  const { impId, hunterIds } = await startBlastFight(gm, [player!], [{ name: HUNTER, at: { x: 4, y: 4 } }], { x: 4, y: 8 });
  const kaiId = hunterIds[HUNTER]!;

  await test.step('Stay here (0 movement) and free pick screenshots at 390 px, then default one-tap confirm', async () => {
    await gmCastBlast(gm, 4, 4);
    const goBtn = map(player!).locator('[data-confirm] [data-go]');
    const words = map(player!).locator('[data-confirm] [data-words]');
    await expect(goBtn).toHaveText('Dodge here');

    // Tap own token -> Stay here (0 movement)
    await tapTile(player!, 4, 4);
    await expect(goBtn).toHaveText('Stay here');
    await expect(words).toHaveText('Stay here (0 movement). Full hit.');
    await checkMobileFit(player!, 'stay-here-390');
    await player!.screenshot({ path: join(SHOTS, 'stay-here-390.png') });

    // Tap a non-default out tile -> free pick with route and single gold marker
    const offered = await playerDodgeTiles(player!);
    const alt = await visibleAltTile(player!, offered.auto, 'out');
    await tapTile(player!, alt.x, alt.y);
    await expect(goBtn).toHaveText('Dodge here');
    await expect(words).toContainText('Clear of attack.');
    expect(await words.textContent()).toBe(`Uses ${alt.steps} of 6 movement. Clear of attack.`);
    await expect(map(player!).locator('[data-shade="way"]')).toHaveCount(1);
    await expect(map(player!).locator(`[data-dtile="${alt.x},${alt.y}"]`)).toHaveClass(/\bon\b/);
    await checkMobileFit(player!, 'free-pick-390');
    await player!.screenshot({ path: join(SHOTS, 'free-pick-390.png') });

    // Confirm on the chosen free tile
    await goBtn.tap();
    await expect.poll(async () => (await fightRow(gm, HUNTER)).place, { timeout: 15_000 }).toEqual({ x: alt.x, y: alt.y });
    await expect.poll(() => placeOf(player!, kaiId), { timeout: 15_000 }).toEqual([alt.x, alt.y]);
    await expect(combat(gm).locator('[data-dodge]')).toBeHidden();
  });

  await test.step('GM one-tap override resolves the dodge for a remote player', async () => {
    await gm.evaluate(([mId, kId]) => {
      hunterApp.store.update((d: any) => {
        const f = d.fight;
        const imp = f.rows.find((r: any) => r.id === mId), kai = f.rows.find((r: any) => r.id === kId);
        kai.place = { x: 4, y: 4 }; kai.life = { at: 'up', hp: kai.sheet.hpMax }; kai.at = f.now + 10; delete kai.moved;
        imp.place = { x: 4, y: 8 }; imp.at = f.now; imp.readyAt = {}; imp.mana = imp.sheet.manaMax;
        f.currentId = imp.id;
      }, 'test-setup');
    }, [impId, kaiId] as const);
    await setupDoc(player!, HUNTER, { x: 4, y: 4 });
    await expect.poll(() => placeOf(player!, kaiId), { timeout: 15_000 }).toEqual([4, 4]);

    await gmCastBlast(gm, 4, 4);
    await expect(combat(player!).locator('.tb-dodge')).toContainText('DODGE · Frost Nova');
    await expect(combat(gm).locator('[data-dodge-auto]')).toHaveText('Use nearest safe tile');
    await checkMobileFit(gm, 'gm-override-390');
    await gm.screenshot({ path: join(SHOTS, 'gm-override-390.png') });

    const offered = await playerDodgeTiles(player!);
    await combat(gm).locator('[data-dodge-auto]').tap();

    await expect.poll(async () => (await fightRow(gm, HUNTER)).place, { timeout: 15_000 }).toEqual(offered.auto);
    await expect.poll(() => placeOf(player!, kaiId), { timeout: 15_000 }).toEqual([offered.auto.x, offered.auto.y]);
    await expect(combat(player!).locator('.tb-dodge')).toHaveCount(0);
    await expect(combat(gm).locator('[data-dodge]')).toBeHidden();
  });
});

test('360 px & 390 px: partly spent movement bank caps dodge reach and 0 movement left auto-stays', async ({ device }) => {
  const { gm, pages: [player] } = await setupRoom(device, [{ label: 'player', name: HUNTER, viewport: SMALL_PHONE }], SMALL_PHONE);
  const { impId, extraImpId, hunterIds } = await startBlastFight(
    gm,
    [player!],
    [{ name: HUNTER, at: { x: 4, y: 0 } }],
    { x: 4, y: 8 },
    FROST_NOVA,
    { extraImp: { x: 3, y: 8 }, hunterFirst: true },
  );
  const kaiId = hunterIds[HUNTER]!;

  // Kai dashes 4 tiles from (4,0) to (4,4), spending 4 of 6 movement -> 2 movement left
  await tapTile(player!, 4, 4);
  const dashBtn = map(player!).locator('[data-confirm] [data-go]');
  await expect(dashBtn).toHaveText('Dash');
  await dashBtn.tap();
  await expect.poll(async () => (await fightRow(gm, HUNTER)).place, { timeout: 15_000 }).toEqual({ x: 4, y: 4 });
  await expect.poll(() => gm.evaluate(() => (hunterApp.store.get().fight as any)?.currentId ?? null), { timeout: 15_000 }).toBe(impId);

  // First Frost Imp blasts (4,4): Kai only has 2 of 6 movement left -> outer ring at best
  await gmCastBlast(gm, 4, 4);
  await expect(combat(gm).locator('[data-dodge]')).toContainText('2 of 6 movement left');
  await expect(combat(gm).locator('[data-dodge]')).toContainText('outer ring at best');
  await expect(combat(gm).locator('[data-dodge-auto]')).toHaveText('Use nearest ring tile');
  await expect(combat(player!).locator('.tb-dodge')).toContainText('Up to 2 tiles (2 movement left).');

  const offered = await playerDodgeTiles(player!);
  expect([offered.reach, offered.left, offered.mode]).toEqual([2, 2, 'ring']);
  await expect(map(player!).locator('[data-confirm] [data-go]')).toHaveText('Dodge here');
  await expect(map(player!).locator('[data-confirm] [data-words]')).toHaveText('Uses 2 of 2 movement. Outer ring (reduced damage).');
  await checkMobileFit(player!, 'partly-spent-360');
  await player!.screenshot({ path: join(SHOTS, 'partly-spent-360.png') });

  // Also capture partly-spent bank at 390 px
  await player!.setViewportSize(PHONE);
  await checkMobileFit(player!, 'partly-spent-390');
  await player!.screenshot({ path: join(SHOTS, 'partly-spent-390.png') });
  await player!.setViewportSize(SMALL_PHONE);

  // Confirm 2-step dodge to offered.auto -> spends remaining 2 movement (6 of 6 spent, 0 left)
  await map(player!).locator('[data-confirm] [data-go]').tap();
  await expect.poll(async () => (await fightRow(gm, HUNTER)).place, { timeout: 15_000 }).toEqual(offered.auto);
  await expect.poll(() => gm.evaluate(() => (hunterApp.store.get().fight as any)?.currentId ?? null), { timeout: 15_000 }).toBe(extraImpId);

  // Second Frost Imp blasts Kai's new tile while Kai has 0 movement left -> resolves immediately with no dodge prompt
  await gmCastBlast(gm, offered.auto.x, offered.auto.y);
  await expect.poll(() => gm.evaluate(id => {
    const f = hunterApp.store.get().fight as any;
    return !!f && !f.dodge && (f.phase === 'ended' || f.currentId === id);
  }, kaiId), { timeout: 15_000 }).toBe(true);
  await expect(combat(gm).locator('[data-dodge]')).toBeHidden();
  await expect(combat(player!).locator('.tb-dodge')).toHaveCount(0);
  expect((await fightRow(gm, HUNTER)).place).toEqual(offered.auto);
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
  await expect(combat(gm).locator('[data-dodge]')).toContainText('6 of 6 movement left');

  const kaiOffer = await playerDodgeTiles(playerA!);
  // Pick an out tile nearest to (5, 4) that would also be reachable by Mira if unoccupied
  const kaiPick = [...kaiOffer.tiles.filter(t => t.avoid === 'out')]
    .sort((a, b) => (Math.abs(a.place.x - 5) + Math.abs(a.place.y - 4)) - (Math.abs(b.place.x - 5) + Math.abs(b.place.y - 4)))[0]!.place;
  await tapTile(playerA!, kaiPick.x, kaiPick.y);
  await expect(map(playerA!).locator(`[data-dtile="${kaiPick.x},${kaiPick.y}"]`)).toHaveClass(/\bon\b/);
  await map(playerA!).locator('[data-confirm] [data-go]').tap();

  // Second dodger: Mira opens dodge, sees Kai already standing at kaiPick, and kaiPick is NOT offered to Mira
  await expect(combat(playerB!).locator('.tb-dodge')).toContainText('DODGE · Frost Nova', { timeout: 15_000 });
  await expect(combat(playerA!).locator('.tb-wait')).toContainText(`Waiting for ${HUNTER_B} to dodge.`);
  await expect.poll(() => placeOf(playerB!, kaiId), { timeout: 15_000 }).toEqual([kaiPick.x, kaiPick.y]);

  const miraOffer = await playerDodgeTiles(playerB!);
  expect(miraOffer.tiles.some(t => t.place.x === kaiPick.x && t.place.y === kaiPick.y), 'Kai\'s chosen tile is excluded from Mira\'s dodge options').toBe(false);

  const miraPick = await visibleAltTile(playerB!, miraOffer.auto, 'out');
  await tapTile(playerB!, miraPick.x, miraPick.y);
  await expect(map(playerB!).locator(`[data-dtile="${miraPick.x},${miraPick.y}"]`)).toHaveClass(/\bon\b/);
  await map(playerB!).locator('[data-confirm] [data-go]').tap();

  // Both hunters end up on their chosen tiles on all phones and dodge closes
  await expect.poll(async () => (await fightRow(gm, HUNTER)).place, { timeout: 15_000 }).toEqual(kaiPick);
  await expect.poll(async () => (await fightRow(gm, HUNTER_B)).place, { timeout: 15_000 }).toEqual({ x: miraPick.x, y: miraPick.y });
  await expect.poll(() => placeOf(playerA!, miraId), { timeout: 15_000 }).toEqual([miraPick.x, miraPick.y]);
  await expect(combat(gm).locator('[data-dodge]')).toBeHidden();
});

test('360 px: reloading both phones mid-pick preserves the dodge prompt and resolves cleanly', async ({ device }) => {
  const { gm, pages: [player] } = await setupRoom(device, [{ label: 'player', name: HUNTER, viewport: SMALL_PHONE }], SMALL_PHONE);
  const { hunterIds } = await startBlastFight(gm, [player!], [{ name: HUNTER, at: { x: 4, y: 4 } }], { x: 4, y: 8 });
  const kaiId = hunterIds[HUNTER]!;

  await gmCastBlast(gm, 4, 4);
  await expect(combat(player!).locator('.tb-dodge')).toContainText('DODGE · Frost Nova');
  await expect(combat(gm).locator('[data-dodge]')).toContainText('6 of 6 movement left');

  // Reload both GM and player phones mid-pick
  await gm.reload({ waitUntil: 'networkidle' });
  await gm.waitForFunction(() => window.hunterApp && document.querySelectorAll('#nav-top a').length > 0);
  await go(gm, 'combat');
  await player!.reload({ waitUntil: 'networkidle' });
  await player!.waitForFunction(() => window.hunterApp && document.querySelectorAll('#nav-top a').length > 0);
  await go(player!, 'combat');

  // Prompt survives on both phones
  await expect(combat(gm).locator('[data-dodge]')).toContainText('6 of 6 movement left');
  await expect(map(player!).locator('[data-confirm] [data-go]')).toHaveText('Dodge here');

  const offered = await playerDodgeTiles(player!);
  const alt = await visibleAltTile(player!, offered.auto, 'out');
  await tapTile(player!, alt.x, alt.y);
  await expect(map(player!).locator(`[data-dtile="${alt.x},${alt.y}"]`)).toHaveClass(/\bon\b/);
  await map(player!).locator('[data-confirm] [data-go]').tap();

  await expect.poll(async () => (await fightRow(gm, HUNTER)).place, { timeout: 15_000 }).toEqual({ x: alt.x, y: alt.y });
  await expect.poll(() => placeOf(player!, kaiId), { timeout: 15_000 }).toEqual([alt.x, alt.y]);
  await expect(combat(gm).locator('[data-dodge]')).toBeHidden();
});

test('360 px & 390 px: ring-only dodge shows Stay here default, Stay in outer ring on GM, and switches to Dodge here on cover', async ({ device }) => {
  const { gm, pages: [player] } = await setupRoom(device, [{ label: 'player', name: HUNTER, viewport: PHONE }], PHONE);
  // 7x7 grid, RING_NOVA outer radius 4 centered at (3,3) covers every reachable tile from Kai at (3,1); cover at (2,1)
  const { hunterIds } = await startBlastFight(
    gm,
    [player!],
    [{ name: HUNTER, at: { x: 3, y: 1 } }],
    { x: 3, y: 6 },
    RING_NOVA,
    { grid: { w: 7, h: 7, cover: [{ x: 2, y: 1 }] } },
  );
  const kaiId = hunterIds[HUNTER]!;

  await gmCastBlast(gm, 3, 3);

  // GM sees ring-only waiting copy with bank and Stay in outer ring (auto is Kai's own tile)
  await expect(combat(gm).locator('[data-dodge]')).toContainText('outer ring at best');
  await expect(combat(gm).locator('[data-dodge]')).toContainText('6 of 6 movement left');
  await expect(combat(gm).locator('[data-dodge-auto]')).toHaveText('Stay in outer ring');

  // Player sees ring-only prompt and Stay here default button
  await expect(combat(player!).locator('.tb-dodge')).toContainText('No way clear.');
  const goBtn = map(player!).locator('[data-confirm] [data-go]');
  const words = map(player!).locator('[data-confirm] [data-words]');
  await expect(goBtn).toHaveText('Stay here');
  await expect(words).toHaveText('Stay here (0 movement). Outer ring (reduced damage).');
  await checkMobileFit(player!, 'ring-only-390');
  await player!.screenshot({ path: join(SHOTS, 'ring-only-390.png') });

  // Also capture ring-only at 360 px
  await player!.setViewportSize(SMALL_PHONE);
  await checkMobileFit(player!, 'ring-only-360');
  await player!.screenshot({ path: join(SHOTS, 'ring-only-360.png') });
  await player!.setViewportSize(PHONE);

  // Tap cover tile (2,1) inside the outer ring -> button changes to Dodge here
  const offered = await playerDodgeTiles(player!);
  expect(offered.mode).toBe('ring');
  expect(offered.auto).toEqual({ x: 3, y: 1 });
  expect(offered.tiles.some(t => t.place.x === 2 && t.place.y === 1)).toBe(true);
  await tapTile(player!, 2, 1);
  await expect(goBtn).toHaveText('Dodge here');
  await expect(words).toHaveText('Uses 1 of 6 movement. Outer ring (reduced damage).');
  await goBtn.tap();

  await expect.poll(async () => (await fightRow(gm, HUNTER)).place, { timeout: 15_000 }).toEqual({ x: 2, y: 1 });
  await expect.poll(() => placeOf(player!, kaiId), { timeout: 15_000 }).toEqual([2, 1]);
  await expect(combat(gm).locator('[data-dodge]')).toBeHidden();
});
