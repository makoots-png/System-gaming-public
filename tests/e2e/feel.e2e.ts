// The lag test: what a GM and a player do most, on a 390 px phone with the CPU slowed four times, never drops more
// frames than FRAMES allows and never leaves a tap without an answer past TAP_MS. Animations stay on (the app's own;
// device() does not turn them off), so a move that runs layout or blocks input fails here.
//
// The numbers and why (measured runs and spread in docs/agent-handoff/feel/notes-2-redraw.md):
// - CPU_RATE 4: Chrome DevTools' "4x slowdown", the usual stand-in for a mid-range phone on a laptop-class CPU.
// - TAP_MS 100: the time a touch still feels instant. Measured from the pointerdown to the first frame drawn after it,
//   which shows the pressed state or the window the tap opened. The slowest seen in ten runs at 4x: 89.7 ms (a maker).
// - FRAMES, the longest gap between two frames at 60 Hz, in frames. Three frames (50 ms) is a stutter anyone sees, and
//   it is the limit where it held in every one of ten runs at 4x: the sheet scrolling and a player's phone during the
//   GM's turn. Where it did not, the limit is the worst of those ten runs plus one frame, and the notes say what bounds it:
//   - the fight turn, 6 frames (100 ms): the GM's card and turn order update in place (src/views/patch.ts), and nine of
//     ten runs held 50 ms (median 50, worst 83 ms; before the change median 83, worst 150). What is left in the longest frame is
//     the style, layout and paint of the card's content for the row whose turn it now is, the store's save repair on
//     each command, and a crit's burst in the frame after.
//   - the maker opening, 5 frames (83 ms): the window and its first fields come in the tap's frame and the rest of the
//     form in the frames after (`data-later`, maker.js); eight of ten runs held 50 ms (median 33, worst 67 ms, with a
//     71 to 76 ms task in the two that did not).
// - the map with twenty tokens (docs/agent-handoff/map/notes-m3.md, eight runs at 4x): a pan and a pinch move one
//   layer's transform and held one frame (16.8 ms) in every run, so 3; picking an ability draws its reach and held 33.4 ms
//   at worst, so 3; a use is the fight's redraw (the store's update, the card and order in place, the map's tokens and the
//   number rising) and keeps the fight's own limit of 6. After the final unit's step 0 (docs/agent-handoff/final/notes-final.md)
//   twenty runs gave a median of 50 ms and a worst of 83.4 ms (five frames).
// - the odds (src/core/combat/odds.ts, docs/agent-handoff/audit/notes-lag-steal.md): the engine plays on a worker thread
//   (`playAway`, src/edge/odds-run.ts) and the page draws the newest count once a frame (odds-box.js), so the screen must
//   keep the plain limit of 3 frames while 100 fights play. The CPU throttle does not reach the worker, so this measures
//   the page's drawing of the count, not the engine.
// FEEL_CPU=1 runs the same test unthrottled and FEEL_MOTION=reduce with every move cut, for the measurements in the notes.
import type { Page } from '@playwright/test';
import { test, expect, onboardGM, onboardPlayer, go, startGoblinDenFight, createRoom, dismissAll, PHONE, chooseList } from './helpers.ts';

// No trace here: a trace takes a snapshot of the page at each action, inside the window this file times. Profiled at 4x
// (FEEL_PROFILE=1, merge notes in docs/agent-handoff/final/notes-final.md) each was a 35 to 110 ms task of Playwright's
// own script in the page, one with a 30 ms major GC, so a frame it fell in measured the harness, not the app.
test.use({ trace: 'off' });

const CPU_RATE = Number(process.env.FEEL_CPU ?? 4);
const TAP_MS = 100;
const FRAMES = { fight: 6, maker: 5, scroll: 3, watch: 3, mapGesture: 3, mapPick: 3, mapUse: 6, odds: 3 } as const;

type Feel = { frames: number[]; taps: number[]; longtasks: number[] };

/** Records frame gaps (requestAnimationFrame deltas), long tasks and each tap's time to its first frame while `on`. */
function recorder() {
  const w = window as any;
  const feel = { on: false, frames: [] as number[], taps: [] as number[], longtasks: [] as number[], last: 0 };
  w.__feel = feel;
  const loop = (t: number) => {
    if (feel.on) { if (feel.last) feel.frames.push(t - feel.last); feel.last = t; } else feel.last = 0;
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  try { new PerformanceObserver(l => { if (feel.on) for (const e of l.getEntries()) feel.longtasks.push(e.duration); }).observe({ type: 'longtask' }); } catch { /* not in this browser */ }
  addEventListener('pointerdown', e => {
    if (!feel.on) return;
    const t0 = e.timeStamp;
    requestAnimationFrame(() => feel.taps.push(performance.now() - t0));
  }, { capture: true });
}

async function slowPhone(page: Page): Promise<void> {
  if (process.env.FEEL_MOTION === 'reduce') await page.evaluate(() => { document.documentElement.dataset['motion'] = 'reduce'; });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU_RATE });
}

/**
 * Runs `act` with the recorder on, waits until no animation is left running, and answers what was recorded.
 * FEEL_PROFILE=1 also traces `act` and prints the three longest tasks on the page's main thread with where each one's
 * time went (events by name, an event handler by its type): the evidence for what bounds the worst frame.
 */
async function measure(page: Page, act: () => Promise<void>): Promise<Feel> {
  const browser = process.env.FEEL_PROFILE ? page.context().browser() : null;
  const cdp = process.env.FEEL_PROFILE ? await page.context().newCDPSession(page) : null;
  if (browser) await browser.startTracing(page, { categories: ['devtools.timeline', 'disabled-by-default-devtools.timeline', 'blink.user_timing'] });
  if (cdp) { await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 100 }); await cdp.send('Profiler.start'); }
  await page.evaluate(() => { const f = (window as any).__feel; f.frames = []; f.taps = []; f.longtasks = []; f.last = 0; f.on = true; });
  await act();
  await expect.poll(() => page.evaluate(() => document.getAnimations().filter(a => a.playState === 'running' && (a.effect?.getTiming().iterations ?? 1) !== Infinity).length)).toBe(0);
  const feel: Feel = await page.evaluate(() => { const f = (window as any).__feel; f.on = false; return { frames: f.frames, taps: f.taps, longtasks: f.longtasks }; });
  if (cdp) console.log(busiestRuns((await cdp.send('Profiler.stop')).profile as CpuProfile));
  if (browser) console.log(longestTasks(JSON.parse(String(await browser.stopTracing()))));
  return feel;
}

type CpuProfile = { nodes: { id: number; callFrame: { functionName: string; url: string; lineNumber: number }; children?: number[] }[]; samples: number[]; timeDeltas: number[] };
/**
 * The CPU profile's two longest runs of samples with no idle between them (a task, near enough), each with the functions
 * that took the most of it, inclusive (a function counted once per sample however deep it recurs) and self. Native work a
 * function forced (a style or layout read, an innerHTML parse) is in that function's self time; work the browser did on
 * its own after the script (the frame's style, layout and paint) is `(program)`.
 */
function busiestRuns(p: CpuProfile): string {
  const byId = new Map(p.nodes.map(n => [n.id, n])), parent = new Map<number, number>();
  for (const n of p.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
  const name = (id: number) => { const c = byId.get(id)!.callFrame; return `${c.functionName || '(anon)'}${c.url ? `@${c.url.split('/').pop()}:${c.lineNumber + 1}` : ''}`; };
  const runs: { ms: number; samples: [number, number][] }[] = [];
  let run: { ms: number; samples: [number, number][] } | null = null;
  p.samples.forEach((id, i) => {
    const dt = (p.timeDeltas[i + 1] ?? 0) / 1000, idle = byId.get(id)!.callFrame.functionName === '(idle)';
    if (idle) { if (run) runs.push(run); run = null; return; }
    run ??= { ms: 0, samples: [] };
    run.ms += dt; run.samples.push([id, dt]);
  });
  if (run) runs.push(run);
  return runs.sort((a, b) => b.ms - a.ms).slice(0, 2).map(r => {
    const self = new Map<string, number>(), incl = new Map<string, number>();
    for (const [id, dt] of r.samples) {
      self.set(name(id), (self.get(name(id)) ?? 0) + dt);
      const seen = new Set<string>();
      for (let n: number | undefined = id; n !== undefined; n = parent.get(n)) { const k = name(n); if (!seen.has(k)) { seen.add(k); incl.set(k, (incl.get(k) ?? 0) + dt); } }
    }
    const top = (m: Map<string, number>, n: number) => [...m].filter(([k]) => k !== '(root)').sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => `${k} ${round(v)}`).join(', ');
    return `[feel] run ${round(r.ms)} ms\n  inclusive: ${top(incl, 14)}\n  self: ${top(self, 10)}`;
  }).join('\n');
}

type TraceEvent = { name: string; ph: string; ts: number; dur?: number; pid: number; tid: number; args?: { name?: string; data?: { type?: string; functionName?: string; url?: string } } };
function longestTasks(trace: { traceEvents: TraceEvent[] }): string {
  const ev = trace.traceEvents, main = ev.find(e => e.ph === 'M' && e.name === 'thread_name' && e.args?.name === 'CrRendererMain');
  const mine = ev.filter(e => main && e.pid === main.pid && e.tid === main.tid && e.ph === 'X' && e.dur);
  const tasks = mine.filter(e => e.name === 'RunTask').sort((a, b) => b.dur! - a.dur!).slice(0, 3);
  return tasks.map(t => {
    const inside = mine.filter(e => e !== t && e.ts >= t.ts && e.ts + e.dur! <= t.ts + t.dur! && e.name !== 'RunTask');
    const by = new Map<string, number>();
    for (const e of inside) {
      const k = e.name === 'EventDispatch' ? `EventDispatch(${e.args?.data?.type})` : e.name === 'FunctionCall' ? `FunctionCall(${e.args?.data?.functionName || '?'})` : e.name;
      by.set(k, (by.get(k) ?? 0) + e.dur! / 1000);
    }
    const styled = inside.filter(e => e.name === 'UpdateLayoutTree').map(e => (e.args as any)?.elementCount ?? '?');
    const laid = inside.filter(e => e.name === 'Layout').map(e => `${(e.args as any)?.beginData?.dirtyObjects ?? '?'}/${(e.args as any)?.beginData?.totalObjects ?? '?'}`);
    return `[feel] task ${round(t.dur! / 1000)} ms: ${[...by].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => `${k} ${round(v)}`).join(', ')}\n  styled elements per recalc: ${styled.join(', ')}; layout dirty/total objects: ${laid.join(', ')}`;
  }).join('\n');
}

const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)]! : 0; };
const round = (n: number) => Math.round(n * 10) / 10;

function judge(name: string, feel: Feel, limit: number): void {
  const worstFrame = Math.max(0, ...feel.frames), worstTap = Math.max(0, ...feel.taps);
  // rAF times fall on the 60 Hz beat, so a gap of three frames reads 49.9 to 50.2 ms: the limit counts whole frames
  const frames = (ms: number) => Math.round(ms / (1000 / 60));
  console.log(`[feel] ${name} cpu=${CPU_RATE}x frames=${feel.frames.length} median=${round(median(feel.frames))} worst=${round(worstFrame)} taps=${feel.taps.length} worstTap=${round(worstTap)} longtasks=[${feel.longtasks.map(round).join(',')}]`);
  expect(feel.frames.length, 'frames were recorded').toBeGreaterThan(5);
  expect(frames(worstFrame), `the longest frame gap, in 60 Hz frames, while ${name} (${round(worstFrame)} ms)`).toBeLessThanOrEqual(limit);
  expect(worstTap, `the slowest tap's first frame (ms) while ${name}`).toBeLessThanOrEqual(TAP_MS);
}

test('on a slow phone the GM plays a turn: a monster\'s use on Brakk and Next, every tap answered at once and no stutter past the fight\'s own redraw', async ({ device }) => {
  const page = (await device('gm', { viewport: PHONE })).page;
  await page.addInitScript(recorder);
  await onboardGM(page);
  await chooseList(page);
  await startGoblinDenFight(page);
  const combat = page.locator('#view-combat');
  await page.evaluate(() => {
    Object.defineProperty(crypto, 'getRandomValues', { configurable: true, value: (a: Uint32Array) => a.fill(0) });
    hunterApp.store.update((d: any) => {
      const f = d.fight, g = f.rows.find((r: any) => r.id === f.currentId), brakk = f.rows.find((r: any) => r.name === 'Brakk Ironhide');
      const taken = new Set(f.rows.map((r: any) => `${r.place.x},${r.place.y}`));
      const free = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([x, y]) => ({ x: brakk.place.x + x!, y: brakk.place.y + y! })).find(p => p.x >= 0 && p.y >= 0 && p.x < f.grid.w && p.y < f.grid.h && !taken.has(`${p.x},${p.y}`));
      g.place = free;
    }, 'test-setup');
  });
  const card = combat.locator('.cmb-card.turn');
  await expect(card).toContainText(await page.evaluate(() => { const f = hunterApp.store.get().fight; return f.rows.find((r: any) => r.id === f.currentId).name as string; }));
  await card.locator('[data-ab]').first().evaluate(el => el.scrollIntoView({ block: 'center' }));
  await slowPhone(page);

  const feel = await measure(page, async () => {
    const hpBefore = await page.evaluate(() => hunterApp.store.get().fight.rows.find((r: any) => r.name === 'Brakk Ironhide').hp);
    await card.locator('[data-ab]').first().tap();
    const picker = page.locator('.sys-overlay.show', { hasText: /Use .+ on…/ });
    await expect(picker).toBeVisible();
    await picker.locator('.sys-actions button', { hasText: 'Brakk Ironhide' }).tap();
    await expect.poll(() => page.evaluate(() => hunterApp.store.get().fight.rows.find((r: any) => r.name === 'Brakk Ironhide').hp)).toBeLessThan(hpBefore);
    const was = await combat.locator('.cmb-row.cur .cmb-nm').innerText();
    await combat.locator('[data-next]').evaluate(el => el.scrollIntoView({ block: 'center' }));
    await combat.locator('[data-next]').tap();
    await expect(combat.locator('.cmb-row.cur .cmb-nm')).not.toHaveText(was);
  });
  judge('a fight turn', feel, FRAMES.fight);
});

test('on a slow phone a player watches the GM\'s turn: the HUD takes the GM\'s hit on their hunter and the next turn with no stutter', async ({ device }) => {
  const gm = (await device('gm', { viewport: PHONE })).page, player = (await device('player', { viewport: PHONE })).page;
  await player.addInitScript(recorder);
  await onboardGM(gm);
  await chooseList(gm);
  const code = await createRoom(gm);
  await onboardPlayer(player, 'Kai Feel', code);
  await chooseList(player);
  await expect.poll(() => player.evaluate(() => hunterApp.api.sync.room())).toBe(code);
  await dismissAll(player, 4);
  await go(gm, 'gm');
  await expect(gm.locator('#gm-board .gm-card.remote', { hasText: 'Kai Feel' })).toHaveCount(1);
  const combat = gm.locator('#view-combat'), hud = player.locator('#view-combat');
  await go(gm, 'combat');
  await combat.locator('[data-hsel]').selectOption({ label: 'Kai Feel (remote)' });
  await combat.locator('[data-addh]').tap();
  await combat.locator('[data-qline]').fill('Cave Rat x4, E, brute');
  await combat.locator('[data-qadd]').tap();
  await combat.locator('[data-start]').tap();
  await gm.evaluate(() => hunterApp.store.update((d: any) => {
    const f = d.fight, rats = f.rows.filter((r: any) => r.kind === 'monster'), kai = f.rows.find((r: any) => r.kind === 'hunter');
    [...rats.slice(0, 2), kai, ...rats.slice(2)].forEach((r: any, i: number) => { r.at = f.now + i; r.tie = 0; });
    f.currentId = rats[0].id; f.log = [];
  }, 'test-setup'));
  await combat.locator('.cmb-pick', { hasText: 'Kai Feel' }).tap();
  await go(player, 'combat');
  const kai = hud.locator('.tb-row', { hasText: 'Kai Feel' });
  await expect(kai).toBeVisible();
  await expect(hud.locator('.tb-row.cur')).toContainText('Cave Rat A');
  await slowPhone(player);

  const feel = await measure(player, async () => {
    const was = await kai.locator('.tb-band > span:last-child').innerText();
    await combat.locator('[data-q="-5"]').tap();
    await expect(kai.locator('.tb-band > span:last-child')).not.toHaveText(was);
    await combat.locator('[data-next]').tap();
    await expect(hud.locator('.tb-row.cur')).toContainText('Cave Rat B');
  });
  judge('a player watching the GM\'s turn', feel, FRAMES.watch);
});

test('on a slow phone a maker opens from the GM\'s Make row, its first frame at once and no stutter past the form\'s own build', async ({ device }) => {
  const page = (await device('gm', { viewport: PHONE })).page;
  await page.addInitScript(recorder);
  await onboardGM(page);
  await chooseList(page);
  await go(page, 'gm');
  const make = page.locator('#gm-make [data-make="item"]');
  await make.scrollIntoViewIfNeeded();
  await slowPhone(page);

  const feel = await measure(page, async () => {
    await make.tap();
    await expect(page.locator('[aria-modal="true"] [data-apply]')).toBeVisible();
  });
  judge('a maker opening', feel, FRAMES.maker);
});

test('on a slow phone the hunter\'s sheet scrolls top to bottom and back with no frame dropped', async ({ device }) => {
  const page = (await device('player', { viewport: PHONE })).page;
  await page.addInitScript(recorder);
  await onboardPlayer(page, 'Mira Feel');
  await chooseList(page);
  await go(page, 'status');
  await expect(page.locator('#view-status [data-bar="hp"]')).toBeVisible();
  const cdp = await page.context().newCDPSession(page);
  await slowPhone(page);

  const feel = await measure(page, async () => {
    for (const yDistance of [-2400, 2400]) await cdp.send('Input.synthesizeScrollGesture', { x: 195, y: 420, yDistance, speed: 1600, gestureSourceType: 'touch' });
  });
  expect(await page.evaluate(() => document.scrollingElement!.scrollHeight > innerHeight * 1.5), 'the sheet is long enough to scroll').toBe(true);
  judge('the sheet scrolling', feel, FRAMES.scroll);
});

test('on a slow phone the GM fights from the map with twenty tokens, a boss with a stagger bar, a shield and a channel, walls, two zones and the fog: a pan, a pinch, an ability picked and used, with no stutter past the fight\'s own redraw', async ({ device }) => {
  const page = (await device('gm', { viewport: PHONE })).page;
  await page.addInitScript(recorder);
  await onboardGM(page);
  await chooseList(page);
  await startGoblinDenFight(page);
  const combat = page.locator('#view-combat');
  await combat.locator('[data-qline]').fill('Cave Rat x15, E, brute');
  await combat.locator('[data-qadd]').tap();
  await combat.locator('[data-fview="map"]').tap();
  const map = combat.locator('[data-mapbox]');
  await expect(map.locator('.mp-tok')).toHaveCount(await page.evaluate(() => hunterApp.store.get().fight.rows.length));
  expect(await map.locator('.mp-tok').count()).toBeGreaterThanOrEqual(20);
  const ids = await page.evaluate(() => {
    Object.defineProperty(crypto, 'getRandomValues', { configurable: true, value: (a: Uint32Array) => a.fill(0) });
    let out = { brakk: '', rat: '' };
    hunterApp.store.update((d: any) => {
      const f = d.fight, brakk = f.rows.find((r: any) => r.name === 'Brakk Ironhide'), rat = f.rows.find((r: any) => r.name === 'Cave Rat A');
      brakk.place = { x: 9, y: 6 }; rat.place = { x: 9, y: 7 }; brakk.at = f.now; brakk.tie = 0; f.currentId = brakk.id;
      // a boss as milestone 5 draws one: a stagger bar, a shield and a channel on its token, and its intent's line
      const boss = f.rows.find((r: any) => r.kind === 'monster' && r.id !== rat.id);
      boss.stagger = { fill: 40, max: 100, hit: 25 }; boss.shield = { amount: 20, until: f.now + 2000 };
      boss.channel = { ability: boss.abilities[0].id, aim: brakk.id, charge: 2, state: 'holding' };
      // a walled map as milestone 6 draws one: two runs of wall, cover, rough ground, a fire and a mud zone, and the fog
      const { w, h } = f.grid, wall = (x: number, y: number) => y === 4 && ((x >= 2 && x <= 6) || (x >= 13 && x <= 17));
      f.grid = { w, h, tiles: Array.from({ length: w * h }, (_, i) => { const x = i % w, y = Math.floor(i / w); return wall(x, y) ? 'wall' : y === 5 && x >= 4 && x <= 6 ? 'cover' : y === 8 && x >= 12 && x <= 15 ? 'rough' : 'floor'; }) };
      const area = (x0: number, y0: number, x1: number, y1: number) => Array.from({ length: (x1 - x0 + 1) * (y1 - y0 + 1) }, (_, i) => ({ x: x0 + (i % (x1 - x0 + 1)), y: y0 + Math.floor(i / (x1 - x0 + 1)) }));
      f.zones = [
        { id: 'z-fire', name: 'Burning ground', ground: { kind: 'tiles', tiles: area(5, 7, 7, 8) }, owner: null, spares: null, tier: 0, until: null, endsWithOwner: false, ops: [{ op: 'damage', type: 'magical', amount: { kind: 'number', value: 3 } }] },
        { id: 'z-mud', name: 'Mud', ground: { kind: 'tiles', tiles: area(11, 5, 13, 6) }, owner: null, spares: null, tier: 0, until: null, endsWithOwner: false, ops: [{ op: 'speed', pct: -30 }] },
      ];
      f.fog = { sight: 8, seen: '0'.repeat(w * h) };
      out = { brakk: brakk.id, rat: rat.id };
    }, 'test-setup');
    return out;
  });
  const frame = map.locator('[data-frame]');
  await frame.scrollIntoViewIfNeeded();
  await frame.dblclick({ position: { x: 4, y: 4 } });
  await expect(map.locator('[data-shade="dash"]').first()).toBeAttached();
  // the shaded area in tiles: the stride's and the dash's outlines (40 pixels a tile), each loop's area by the shoelace sum
  const tilesShaded = await map.locator('[data-shade="stride"], [data-shade="dash"]').evaluateAll(paths => paths.reduce((n, p) => n + (p.getAttribute('d') ?? '').split('Z').filter(Boolean).reduce((m, loop) => {
    const pts = loop.replace('M', '').split('L').map(c => c.trim().split(' ').map(Number));
    return m + pts.reduce((a, [x, y], i) => { const [x2, y2] = pts[(i + 1) % pts.length]!; return a + x! * y2! - x2! * y!; }, 0) / 2 / 1600;
  }, 0), 0));
  expect(tilesShaded, 'the movement area is about a hundred tiles').toBeGreaterThanOrEqual(80);
  const cdp = await page.context().newCDPSession(page);
  await slowPhone(page);
  const box = (await frame.boundingBox())!;

  const gesture = await measure(page, async () => {
    await page.mouse.move(box.x + 40, box.y + box.height - 40);
    await page.mouse.down();
    await page.mouse.move(box.x + 140, box.y + box.height - 120, { steps: 12 });
    await page.mouse.up();
    await cdp.send('Input.synthesizePinchGesture', { x: box.x + box.width / 2, y: box.y + box.height / 2, scaleFactor: 1.4, gestureSourceType: 'touch' });
  });
  judge('a pan and a pinch on the map', gesture, FRAMES.mapGesture);
  await frame.dblclick({ position: { x: 4, y: 4 } });

  const pick = await measure(page, async () => {
    await map.locator('[data-hot] .mp-hb').first().tap();
    await expect(map.locator('[data-shade="reach"]').first()).toBeAttached();
  });
  judge('an ability picked on the map', pick, FRAMES.mapPick);

  const hp = await page.evaluate(id => hunterApp.store.get().fight.rows.find((r: any) => r.id === id).hp, ids.rat);
  const rat = map.locator(`[data-tok="${ids.rat}"]`);
  const use = await measure(page, async () => {
    await rat.tap();
    await map.locator('[data-go]').tap();
    await expect.poll(() => page.evaluate(id => hunterApp.store.get().fight.rows.find((r: any) => r.id === id).hp, ids.rat)).toBeLessThan(hp);
  });
  judge('a use from the map', use, FRAMES.mapUse);
});

test('on a slow phone the GM plays a fight out 100 times for its odds, and the screen keeps its frames while the count runs', async ({ device }) => {
  const page = (await device('gm', { viewport: PHONE })).page;
  await page.addInitScript(recorder);
  await onboardGM(page);
  await go(page, 'combat');
  await page.locator('#view-combat [data-addparty]').tap();
  await page.locator('#view-combat [data-mcount]').fill('3');
  await page.locator('#view-combat [data-addm]').tap();
  const ask = page.locator('#view-combat [data-odds-ask]');
  await ask.scrollIntoViewIfNeeded();
  await slowPhone(page);

  const feel = await measure(page, async () => {
    await ask.tap();
    await expect(page.locator('#view-combat [data-oddsline]')).toHaveText(/^The party wins \d+% of 100 fights\./, { timeout: 120_000 });
  });
  judge('the odds playing', feel, FRAMES.odds);
});
