// The lag test: what a GM and a player do most, on a 390 px phone, never runs one task on the page's main thread longer
// than its case's bound in TASK_MS, never holds a frame past FRAMES and never leaves a tap without a frame past TAP_MS.
// Animations stay on (the app's own; device() does not turn them off), so a move that runs layout or blocks input fails here.
//
// What is measured and why (the experiment, its table and its limits: docs/agent-handoff/audit/notes-lag-measure.md):
// - The first check is the longest task on the measured page's main thread in CPU time: each task's thread time in a
//   Chrome trace of the window. It counts the page's own work and not the time the box gave to anything else, so it holds
//   still when the box is busy. Beside four busy loops every case's median moved by -1.7 to +0.2 ms, where the frame gap
//   this file used to bound (at 4x) rose by up to 50 ms in its worst runs. A fixed 7 ms of extra work in the fight's
//   redraw moved it by +5.8 to +9.1 ms.
// - It runs at 1x, with no CPU throttle: Chrome's throttle is counted in the thread's CPU time (a task's CPU time at 4x
//   was its wall time), so a throttled trace would measure the box again. The phone this test stands for is DevTools'
//   "4x slowdown" (a mid-range phone on a laptop-class CPU): a task takes it about four times as long as here, so 4 ms
//   here is about one 60 Hz frame there.
// - The frame gap and the tap stay as a second, looser check, on the wall clock at 1x. They catch what a bound on one
//   task cannot see: a frame held up by a run of short tasks with no frame between them, by work off the main thread
//   (the compositor, raster) or by the page waiting on a timer or a request.
// FEEL_MOTION=reduce runs with every move cut. FEEL_PROFILE=1 also takes a CPU profile of each window and prints where
// its two busiest runs went by function; the profiler's own cost lands in the tasks, so the bounds do not hold under it.
import type { Page } from '@playwright/test';
import { test, expect, onboardGM, onboardPlayer, go, startGoblinDenFight, createRoom, dismissAll, PHONE, chooseList } from './helpers.ts';

// No Playwright trace: it takes a snapshot of the page at each action, a task of the harness's own inside the window this
// file measures (35 to 110 ms tasks at 4x, docs/agent-handoff/final/notes-final.md). The Chrome trace below records only.
test.use({ trace: 'off' });

/**
 * The longest task each case may run on the page's main thread, in ms of CPU on the box that runs the test.
 * Each is the worst of 12 runs of this test on 20 November (six on an idle box, six beside four busy loops) plus a
 * quarter, rounded up, and never under 4 ms (one frame on the phone). The watching, the maker's and the map use's stay
 * above that for a rare long task of the app's own. That box ran the same app 30 to 60% slower in CPU than the box of
 * 19 November (the app of 19 November, c034f55, rerun beside it), and some runs ran every task of a case about 1.5 times
 * its usual CPU with the box idle, so most bounds rose (notes, part 3).
 * A failure means: on a mid-range phone the screen holds still for about four times the measured task after the tap
 * named in the message, and anything moving stops for that long. The bounds are this box's: a slower or faster machine
 * needs them measured again (the notes say how).
 */
const TASK_MS = {
  // worst 16.2 (median 13.0, best 8.8): the redraw after the use or after Next, its script mostly slideTo's read of the
  // rows forcing layout. Past 21: a frame of about 85 ms on a phone, the turn's answer drawn five frames late.
  fight: 21,
  // worst 6.3 (median 4.6): the player's redraw when the GM's hit arrives, or the app's receipt of the GM's message. Kept
  // above the rule (8) for a rare 7.4 of the receipt in a check run (notes). Past 10 the HUD drops two frames on a phone.
  watch: 10,
  // worst 16.4 (median 12.9): the click's build of the form, then the first field's focus forcing style and layout. Kept
  // above the rule (21) for a rare 17.9 seen on the faster box of 19 November (notes); past 23 the window comes up about
  // 90 ms after the tap on a phone.
  maker: 23,
  // worst 1.6 (median 1.3): the page's longest task while the sheet scrolls is a timer's. Past 4, scrolling drops a frame
  // on a phone.
  scroll: 4,
  // worst 8.5 (median 5.5, best 4.0): the frame after the pan's first move restyles about 69 elements of the map. Past 11
  // the map lags the finger by more than two frames.
  mapGesture: 11,
  // worst 7.1 (median 5.8): the pick's own script at the lift (2.6 to 5.1 ms) and the tap's pointerdown in one task, or
  // the frame's restyle of about 48 elements after it. Past 9 the reach comes a frame late.
  mapPick: 9,
  // worst 16.4 (median 13.9): the fight's redraw with the map's tokens. Kept above the rule (21) for a rare 20.4
  // (19 November) and 21.0 (20 November, the app before the merge), the app's own (notes); past 26 the hit lands about
  // 100 ms after the tap on a phone.
  mapUse: 26,
  // worst 8.7 (median 6.5): the page draws the count once a frame while the worker plays. Past 11 the count stutters.
  odds: 11,
} as const;
// Three frames (50 ms) is a stutter anyone sees. In the 12 runs of 20 November, 88 of 96 windows held one frame, six held
// two and two held three (the sheet scrolling, idle; the pan and pinch, loaded): at the bound, a fault of the app or the
// box to find (notes, part 3).
const FRAMES = 3;
// The time a touch still feels instant, from the pointerdown to the first frame after it. At 1x: 8 to 60 ms on 20 November.
const TAP_MS = 100;

type Task = { cpu: number; wall: number; after: string; parts: string };
/** A frame gap or a tap's time to its first frame, in ms, with the last tap on the page before it. */
type Timed = { ms: number; after: string };
type Feel = { frames: Timed[]; taps: Timed[]; tasks: Task[] };

/** Records frame gaps (requestAnimationFrame deltas) and each tap's time to its first frame while `on`, each with the tap before it, and marks each tap in the trace. */
function recorder() {
  const w = window as any;
  const feel = { on: false, frames: [] as Timed[], taps: [] as Timed[], last: 0, tap: 'no tap on this page yet' };
  w.__feel = feel;
  const loop = (t: number) => {
    if (feel.on) { if (feel.last) feel.frames.push({ ms: t - feel.last, after: feel.tap }); feel.last = t; } else feel.last = 0;
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  addEventListener('pointerdown', e => {
    if (!feel.on) return;
    const t0 = e.timeStamp;
    const el = e.target instanceof Element ? e.target.closest('button, a, input, select, [data-tok]') ?? e.target : null;
    const words = el ? (el.getAttribute('aria-label') ?? el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 40) : '';
    const name = `${el ? el.tagName.toLowerCase() : 'the page'}${words ? ` "${words}"` : ''}`;
    performance.mark(`feel-tap ${name}`);
    feel.tap = `the tap on ${name}`;
    requestAnimationFrame(() => feel.taps.push({ ms: performance.now() - t0, after: `the tap on ${name}` }));
  }, { capture: true });
}

async function motion(page: Page): Promise<void> {
  if (process.env.FEEL_MOTION === 'reduce') await page.evaluate(() => { document.documentElement.dataset['motion'] = 'reduce'; });
}

/** Runs `act` with the recorder on and a Chrome trace of the window, waits until no animation is left running, and answers what was recorded. */
async function measure(page: Page, act: () => Promise<void>): Promise<Feel> {
  const browser = page.context().browser()!;
  const cdp = process.env.FEEL_PROFILE ? await page.context().newCDPSession(page) : null;
  await browser.startTracing(page, { categories: ['devtools.timeline', 'disabled-by-default-devtools.timeline', 'blink.user_timing'] });
  if (cdp) { await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 100 }); await cdp.send('Profiler.start'); }
  await page.evaluate(() => { const f = (window as any).__feel; f.frames = []; f.taps = []; f.last = 0; f.tap = 'no tap on this page yet'; performance.mark('feel-start'); f.on = true; });
  await act();
  // the redraw a tap asked for runs in the next frame and starts its moves there: without these two frames a fast
  // box closed the window before the redraw, and the case measured the tap alone
  await page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
  await expect.poll(() => page.evaluate(() => document.getAnimations().filter(a => a.playState === 'running' && (a.effect?.getTiming().iterations ?? 1) !== Infinity).length)).toBe(0);
  // the window closes in a task of its own, before the read: the read's copy of a few hundred frames out of the page is
  // the harness's work, a task of 2 to 5 ms with no traced event in it, and was the sheet's longest task (notes, part 3)
  await page.evaluate(() => { (window as any).__feel.on = false; performance.mark('feel-end'); });
  const feel = await page.evaluate(() => { const f = (window as any).__feel; return { frames: f.frames as Timed[], taps: f.taps as Timed[] }; });
  if (cdp) console.log(busiestRuns((await cdp.send('Profiler.stop')).profile as CpuProfile));
  return { ...feel, tasks: tasksOf(JSON.parse(String(await browser.stopTracing()))) };
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

type TraceEvent = { name: string; ph: string; ts: number; dur?: number; tdur?: number; pid: number; tid: number; args?: { data?: { type?: string; functionName?: string; url?: string; lineNumber?: number; columnNumber?: number }; elementCount?: number; beginData?: { dirtyObjects?: number; totalObjects?: number } } };
/**
 * The measured page's main-thread tasks, longest in CPU first. The page is the renderer whose main thread made the
 * `feel-start` mark (another phone of the test is another renderer in the same trace); its tasks start after that mark
 * and end before `feel-end` (the two tasks that make the marks are the harness's). Each task names the last tap on the
 * page before it and where its CPU went by trace event (nested events overlap, so the parts can sum past the task).
 */
function tasksOf(trace: { traceEvents: TraceEvent[] }): Task[] {
  const ev = trace.traceEvents, start = ev.find(e => e.name === 'feel-start'), end = ev.find(e => e.name === 'feel-end');
  if (!start || !end) throw new Error('the trace holds no feel-start or no feel-end mark, so the measured window cannot be told apart');
  const mine = ev.filter(e => e.pid === start.pid && e.tid === start.tid && e.ph === 'X' && e.dur && e.ts >= start.ts && e.ts + e.dur <= end.ts);
  const taps = ev.filter(e => e.pid === start.pid && e.name.startsWith('feel-tap ')).sort((a, b) => a.ts - b.ts);
  const cpu = (e: TraceEvent) => (e.tdur ?? e.dur!) / 1000;
  const label = (e: TraceEvent) => {
    if (e.name === 'EventDispatch') return `EventDispatch(${e.args?.data?.type})`;
    if (e.name === 'FunctionCall') { const d = e.args?.data; return `FunctionCall(${d?.functionName || `${d?.url?.split('/').pop() ?? '?'}:${(d?.lineNumber ?? 0) + 1}:${(d?.columnNumber ?? 0) + 1}`})`; }
    if (e.name === 'UpdateLayoutTree') return `UpdateLayoutTree(${e.args?.elementCount ?? '?'} elements)`;
    if (e.name === 'Layout') return `Layout(${e.args?.beginData?.dirtyObjects ?? '?'}/${e.args?.beginData?.totalObjects ?? '?'} objects)`;
    return e.name;
  };
  return mine.filter(e => e.name === 'RunTask').map(t => {
    const by = new Map<string, number>();
    for (const e of mine) if (e !== t && e.name !== 'RunTask' && e.ts >= t.ts && e.ts + e.dur! <= t.ts + t.dur!) by.set(label(e), (by.get(label(e)) ?? 0) + cpu(e));
    const tap = taps.filter(m => m.ts <= t.ts + t.dur!).at(-1);
    return { cpu: cpu(t), wall: t.dur! / 1000, after: tap ? `the tap on ${tap.name.slice('feel-tap '.length)}` : 'no tap on this page yet',
      parts: [...by].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, v]) => `${k} ${round(v)}`).join(', ') || 'no traced script, style, layout or paint event inside it' };
  }).sort((a, b) => b.cpu - a.cpu);
}

const round = (n: number) => Math.round(n * 10) / 10;

function judge(name: string, feel: Feel, key: keyof typeof TASK_MS): void {
  const worst = (list: Timed[]) => list.reduce((a, b) => (b.ms > a.ms ? b : a), { ms: 0, after: 'none recorded' });
  const worstFrame = worst(feel.frames), worstTap = worst(feel.taps), longest = feel.tasks[0]?.cpu ?? 0;
  // rAF times fall on the 60 Hz beat, so a gap of three frames reads 49.9 to 50.2 ms: the limit counts whole frames
  const frames = (ms: number) => Math.round(ms / (1000 / 60));
  const report = [`[feel] ${name}: longest task ${round(longest)} ms CPU (bound ${TASK_MS[key]}), worst frame gap ${round(worstFrame.ms)} ms of ${feel.frames.length} frames (bound ${FRAMES} frames) after ${worstFrame.after}, slowest tap ${round(worstTap.ms)} ms (bound ${TAP_MS}) on ${worstTap.after.replace(/^the tap on /, '')}`,
    ...feel.tasks.slice(0, 3).map(t => `  ${round(t.cpu)} ms CPU (${round(t.wall)} ms wall) after ${t.after}: ${t.parts}`)].join('\n');
  console.log(report);
  expect(feel.frames.length, `frames were recorded while ${name}`).toBeGreaterThan(5);
  expect.soft(longest, `the longest task on the page's main thread (ms of CPU) while ${name}\n${report}`).toBeLessThanOrEqual(TASK_MS[key]);
  expect.soft(frames(worstFrame.ms), `the longest frame gap (60 Hz frames) while ${name}\n${report}`).toBeLessThanOrEqual(FRAMES);
  expect.soft(worstTap.ms, `the slowest tap's first frame (ms) while ${name}\n${report}`).toBeLessThanOrEqual(TAP_MS);
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
  await motion(page);

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
  judge('a fight turn', feel, 'fight');
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
  await motion(player);

  const feel = await measure(player, async () => {
    const was = await kai.locator('.tb-band > span:last-child').innerText();
    await combat.locator('[data-q="-5"]').tap();
    await expect(kai.locator('.tb-band > span:last-child')).not.toHaveText(was);
    await combat.locator('[data-next]').tap();
    await expect(hud.locator('.tb-row.cur')).toContainText('Cave Rat B');
  });
  judge('a player watching the GM\'s turn', feel, 'watch');
});

test('on a slow phone a maker opens from the GM\'s Make row, its first frame at once and no stutter past the form\'s own build', async ({ device }) => {
  const page = (await device('gm', { viewport: PHONE })).page;
  await page.addInitScript(recorder);
  await onboardGM(page);
  await chooseList(page);
  await go(page, 'gm');
  const make = page.locator('#gm-make [data-make="item"]');
  await make.scrollIntoViewIfNeeded();
  await motion(page);

  const feel = await measure(page, async () => {
    await make.tap();
    await expect(page.locator('[aria-modal="true"] [data-apply]')).toBeVisible();
  });
  judge('a maker opening', feel, 'maker');
});

test('on a slow phone the hunter\'s sheet scrolls top to bottom and back with no frame dropped', async ({ device }) => {
  const page = (await device('player', { viewport: PHONE })).page;
  await page.addInitScript(recorder);
  await onboardPlayer(page, 'Mira Feel');
  await chooseList(page);
  await go(page, 'status');
  await expect(page.locator('#view-status [data-bar="hp"]')).toBeVisible();
  const cdp = await page.context().newCDPSession(page);
  await motion(page);

  const feel = await measure(page, async () => {
    for (const yDistance of [-2400, 2400]) await cdp.send('Input.synthesizeScrollGesture', { x: 195, y: 420, yDistance, speed: 1600, gestureSourceType: 'touch' });
  });
  expect(await page.evaluate(() => document.scrollingElement!.scrollHeight > innerHeight * 1.5), 'the sheet is long enough to scroll').toBe(true);
  judge('the sheet scrolling', feel, 'scroll');
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
  await motion(page);
  const box = (await frame.boundingBox())!;

  const gesture = await measure(page, async () => {
    await page.mouse.move(box.x + 40, box.y + box.height - 40);
    await page.mouse.down();
    await page.mouse.move(box.x + 140, box.y + box.height - 120, { steps: 12 });
    await page.mouse.up();
    await cdp.send('Input.synthesizePinchGesture', { x: box.x + box.width / 2, y: box.y + box.height / 2, scaleFactor: 1.4, gestureSourceType: 'touch' });
  });
  judge('a pan and a pinch on the map', gesture, 'mapGesture');
  await frame.dblclick({ position: { x: 4, y: 4 } });

  const pick = await measure(page, async () => {
    await map.locator('[data-hot] .mp-hb').first().tap();
    await expect(map.locator('[data-shade="reach"]').first()).toBeAttached();
  });
  judge('an ability picked on the map', pick, 'mapPick');

  const hp = await page.evaluate(id => hunterApp.store.get().fight.rows.find((r: any) => r.id === id).hp, ids.rat);
  const rat = map.locator(`[data-tok="${ids.rat}"]`);
  const use = await measure(page, async () => {
    await rat.tap();
    await map.locator('[data-go]').tap();
    await expect.poll(() => page.evaluate(id => hunterApp.store.get().fight.rows.find((r: any) => r.id === id).hp, ids.rat)).toBeLessThan(hp);
  });
  judge('a use from the map', use, 'mapUse');
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
  await motion(page);

  const feel = await measure(page, async () => {
    await ask.tap();
    await expect(page.locator('#view-combat [data-oddsline]')).toHaveText(/^The party wins \d+% of 100 fights\./, { timeout: 120_000 });
  });
  judge('the odds playing', feel, 'odds');
});
