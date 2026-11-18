// The motion system's rules that hold without a browser: a count lands on its value, the particle pool has a cap, the
// tokens are the times the design names, and under reduced motion every move ends at once in its final state.
import { afterEach, expect, test } from 'bun:test';
import { BURSTS, POOL_CAP, burst, countAt, countTo, enter, fillTo, makePool, parseTime, percent, spreadOf, tumbleFaces } from '../src/views/motion.ts';

const css = await Bun.file(import.meta.dir + '/../public/app.css').text();
const token = (name: string) => parseTime(new RegExp(`${name}:([^;]+);`).exec(css)?.[1] ?? '');

test('the three durations are the design\'s: about 120, 200 and 320 ms, each longer than the one before', () => {
  const [fast, base, slow] = [token('--t-fast'), token('--t-base'), token('--t-slow')];
  expect([fast, base, slow].every(Number.isFinite)).toBe(true);
  expect(Math.abs(fast - 120)).toBeLessThanOrEqual(20);
  expect(Math.abs(base - 200)).toBeLessThanOrEqual(30);
  expect(Math.abs(slow - 320)).toBeLessThanOrEqual(40);
  expect(fast < base && base < slow).toBe(true);
});

test('a count shows its start at the start, lands exactly on its value at the end, and never runs past it', () => {
  for (const [from, to] of [[0, 1], [10, 250], [250, 10], [-5, 7], [0, 1_000_000], [3, 3]] as const) {
    expect(countAt(from, to, 0)).toBe(from);
    expect(countAt(from, to, 1)).toBe(to);
    expect(countAt(from, to, 1.7)).toBe(to);
    const shown = Array.from({ length: 21 }, (_, i) => countAt(from, to, i / 20));
    expect(shown.every(n => Number.isInteger(n) && n >= Math.min(from, to) && n <= Math.max(from, to))).toBe(true);
    expect(shown.every((n, i) => i === 0 || (to >= from ? n >= shown[i - 1]! : n <= shown[i - 1]!))).toBe(true);
  }
});

test('the particle pool never makes more than its cap, and a burst past it gets fewer', () => {
  const pool = makePool(POOL_CAP, () => ({}));
  const first = pool.take(30), second = pool.take(30);
  expect(first).toHaveLength(30);
  expect(second).toHaveLength(POOL_CAP - 30);
  expect(pool.size()).toBe(POOL_CAP);
  first.forEach(t => pool.give(t));
  expect(pool.take(24)).toHaveLength(24);
  expect(pool.size()).toBe(POOL_CAP);
});

test('every burst kind keeps the budget: at most 24 particles, gone within 600 ms', () => {
  const slow = token('--t-slow');
  for (const [kind, k] of Object.entries(BURSTS)) {
    expect(k.count, kind).toBeLessThanOrEqual(24);
    expect(k.life * slow, kind).toBeLessThanOrEqual(600);
  }
  expect(POOL_CAP).toBeGreaterThanOrEqual(2 * Math.max(...Object.values(BURSTS).map(k => k.count)));
});

test('a burst throws its particles all round, none further than its spread', () => {
  const n = 16, spread = 64, at = Array.from({ length: n }, (_, i) => spreadOf(i, n, spread));
  expect(at.every(({ dx, dy }) => Math.hypot(dx, dy) <= spread + 1)).toBe(true);
  for (const quadrant of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) expect(at.some(({ dx, dy }) => Math.sign(dx) === quadrant[0] && Math.sign(dy) === quadrant[1])).toBe(true);
});

test('a percentage is whole and shows 100% only when all of it is there', () => {
  expect(percent(0)).toBe(0);
  expect(percent(0.426)).toBe(42);
  expect(percent(0.999)).toBe(99);
  expect(percent(1)).toBe(100);
  expect(percent(0.29)).toBe(29);
  expect(percent(2)).toBe(100);
  expect(percent(Number.NaN)).toBe(0);
});

test('a die tumbles through other faces of the die and lands on the value rolled', () => {
  for (const [value, sides] of [[1, 20], [20, 20], [4, 6], [2, 2], [57, 100]] as const) {
    const faces = tumbleFaces(value, sides, 6);
    expect(faces.at(-1)).toBe(value);
    expect(faces.slice(0, -1).every(f => f !== value && f >= 1 && f <= sides)).toBe(true);
  }
});

// ── reduced motion, with the smallest page the moves touch ──
const g = globalThis as Record<string, unknown>;
const saved = { document: g['document'], matchMedia: g['matchMedia'] };
afterEach(() => { g['document'] = saved.document; g['matchMedia'] = saved.matchMedia; });
function reducedPage(choice: 'reduce' | 'os') {
  const made: string[] = [];
  g['document'] = { documentElement: { dataset: { motion: choice === 'reduce' ? 'reduce' : 'os' } }, createElement: (t: string) => { made.push(t); return {}; } };
  g['matchMedia'] = (q: string) => ({ matches: choice === 'os' && q.includes('reduce') });
  return made;
}
const animated: string[] = [];
const fakeEl = () => {
  const style = new Map<string, string>();
  return { textContent: '', isConnected: true, classList: { add() {} }, style: { setProperty: (k: string, v: string) => style.set(k, v) }, styleOf: style,
    animate: () => { animated.push('animate'); throw new Error('a move animated under reduced motion'); }, querySelector: () => null };
};

for (const choice of ['reduce', 'os'] as const) {
  test(`under reduced motion (${choice === 'reduce' ? 'the device\'s choice' : 'the OS setting'}) a count, a bar and an entrance end at once in their final state, and a burst draws nothing`, async () => {
    const made = reducedPage(choice);
    const n = fakeEl();
    await countTo(n as unknown as HTMLElement, 10, 250, v => `${v} HP`);
    expect(n.textContent).toBe('250 HP');
    const fill = fakeEl(), bar = { querySelector: (s: string) => (s.includes('> i') ? fill : null) };
    await fillTo(bar as unknown as Element, 0.75);
    await fillTo(bar as unknown as Element, 0.25);
    expect(fill.styleOf.get('--f')).toBe('0.25');
    await enter(fakeEl() as unknown as Element);
    await burst('crit', { x: 10, y: 10 });
    expect(made).toEqual([]);
    expect(animated).toEqual([]);
  });
}
