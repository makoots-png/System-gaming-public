import { describe, expect, test } from 'bun:test';
import { NO_WINDOWS, WINDOW_EVENTS, keyWindow, openSystem, windowAt, windowId, windowStep } from '../src/core/windows.ts';
import type { WindowEvent, Windows } from '../src/core/windows.ts';
import { bfs } from '../scripts/statecharts.ts';
import { FIRST_RUN, SYSTEM_WINDOWS, WINDOW_WALK } from './models/window-events.ts';

const [A, B] = SYSTEM_WINDOWS;
const MAKER = windowId(7), SHEET = windowId(8);
/** Runs `events` from `s`: the windows at the end and every effect, in order, as `kind id` (or `next`). */
function run(s: Windows, ...events: WindowEvent[]): { windows: Windows; fx: string[] } {
  const fx: string[] = [];
  for (const e of events) { const r = windowStep(s, e); s = r.windows; fx.push(...r.fx.map(f => ('id' in f ? `${f.kind} ${f.id}` : f.kind))); }
  return { windows: s, fx };
}
/** A System window asked for, as ui.js asks: then its turn is tried at once. */
const asked = (id: typeof A): WindowEvent[] => [{ kind: 'ask', id }, { kind: 'next' }];
const order = (s: Windows) => s.shown.map(w => `${w.id} ${w.at}`);

describe('the windows', () => {
  test('a System window asked with none up opens at once and takes the keys', () => {
    const { windows, fx } = run(NO_WINDOWS, ...asked(A));
    expect(windowAt(windows, A)).toBe('open');
    expect(keyWindow(windows)).toBe(A);
    expect(fx).toEqual([`draw ${A}`]);
  });

  test('a second System window waits while the first is open, and its turn comes a task after the first is answered', () => {
    const two = run(NO_WINDOWS, ...asked(A), ...asked(B));
    expect(windowAt(two.windows, B)).toBe('queued');
    expect(keyWindow(two.windows)).toBe(A);
    const answered = run(two.windows, { kind: 'close', id: A });
    expect(answered.fx).toEqual([`dismiss ${A}`, 'next']);
    expect(keyWindow(answered.windows)).toBe(null);
    const next = run(answered.windows, { kind: 'next' });
    expect(order(next.windows)).toEqual([`${A} leaving`, `${B} open`]);
    expect(next.fx).toEqual([`draw ${B}`]);
    expect(run(next.windows, { kind: 'gone', id: A })).toEqual({ windows: { shown: [{ id: B, kind: 'system', at: 'open' }], queued: [] }, fx: [`forget ${A}`] });
  });

  test('a System window asked while one leaves opens at once, over the one leaving', () => {
    const { windows } = run(NO_WINDOWS, ...asked(A), { kind: 'close', id: A }, ...asked(B));
    expect(order(windows)).toEqual([`${A} leaving`, `${B} open`]);
  });

  test('a System window asked while the first-run window is open waits behind it, and opens when it closes', () => {
    const behind = run(NO_WINDOWS, { kind: 'open', id: FIRST_RUN, of: 'onboard' }, ...asked(A));
    expect(windowAt(behind.windows, A)).toBe('queued');
    expect(keyWindow(behind.windows)).toBe(FIRST_RUN);
    const closed = run(behind.windows, { kind: 'close', id: FIRST_RUN }, { kind: 'next' });
    expect(closed.fx).toEqual([`dismiss ${FIRST_RUN}`, 'next', `draw ${A}`]);
    expect(keyWindow(closed.windows)).toBe(A);
  });

  test('the first-run window opened over an open System window is on top and takes the keys', () => {
    const { windows } = run(NO_WINDOWS, ...asked(A), { kind: 'open', id: FIRST_RUN, of: 'onboard' });
    expect(order(windows)).toEqual([`${A} open`, `${FIRST_RUN} open`]);
    expect(keyWindow(windows)).toBe(FIRST_RUN);
  });

  test('a System window that waited opens on top of a maker opened while it waited, and takes the keys from it', () => {
    const { windows } = run(NO_WINDOWS, ...asked(A), ...asked(B), { kind: 'close', id: A }, { kind: 'open', id: MAKER, of: 'maker' }, { kind: 'next' });
    expect(order(windows)).toEqual([`${A} leaving`, `${MAKER} open`, `${B} open`]);
    expect(keyWindow(windows)).toBe(B);
  });

  test('a System window opens over a maker at once: a maker holds no System window', () => {
    const { windows } = run(NO_WINDOWS, { kind: 'open', id: MAKER, of: 'maker' }, ...asked(A));
    expect(order(windows)).toEqual([`${MAKER} open`, `${A} open`]);
  });

  test('a sheet never takes the keys, and goes at once with no move out', () => {
    const on = run(NO_WINDOWS, { kind: 'open', id: MAKER, of: 'maker' }, { kind: 'open', id: SHEET, of: 'sheet' });
    expect(keyWindow(on.windows)).toBe(MAKER);
    expect(run(on.windows, { kind: 'close', id: SHEET })).toEqual({ windows: { shown: [{ id: MAKER, kind: 'maker', at: 'open' }], queued: [] }, fx: [`forget ${SHEET}`] });
  });

  test('Confirm all of the open System window answers a waiting one; with none open nothing answers it', () => {
    const two = run(NO_WINDOWS, ...asked(A), ...asked(B)).windows;
    expect(run(two, { kind: 'answered', id: B })).toEqual({ windows: { shown: [{ id: A, kind: 'system', at: 'open' }], queued: [] }, fx: [`forget ${B}`] });
    const waiting = run(NO_WINDOWS, { kind: 'ask', id: A }).windows;
    expect(windowStep(waiting, { kind: 'answered', id: A }).windows).toBe(waiting);
  });

  test('a window closed twice, gone while open or asked twice changes nothing and does nothing', () => {
    const open = run(NO_WINDOWS, ...asked(A)).windows, leaving = run(open, { kind: 'close', id: A }).windows;
    expect(windowStep(leaving, { kind: 'close', id: A })).toEqual({ windows: leaving, fx: [] });
    expect(windowStep(open, { kind: 'gone', id: A })).toEqual({ windows: open, fx: [] });
    expect(windowStep(open, { kind: 'ask', id: A })).toEqual({ windows: open, fx: [] });
    expect(windowStep(NO_WINDOWS, { kind: 'next' })).toEqual({ windows: NO_WINDOWS, fx: [] });
  });

  test('in every state the walk reaches: one place per window, at most one System window open, none over the first-run window, and the keys with the top open one', () => {
    expect([...new Set(WINDOW_WALK.map(e => e.kind))].sort()).toEqual([...WINDOW_EVENTS].sort());
    const walk = bfs([NO_WINDOWS], s => WINDOW_WALK.map(event => ({ event, to: windowStep(s, event).windows })), s => JSON.stringify(s));
    expect(walk.states.length).toBeGreaterThan(20);
    for (const s of walk.states) {
      const ids = [...s.shown.map(w => w.id), ...s.queued];
      expect(new Set(ids).size).toBe(ids.length);
      expect(s.shown.filter(w => w.kind === 'system' && w.at === 'open').length).toBeLessThanOrEqual(1);
      const firstRun = s.shown.findIndex(w => w.id === FIRST_RUN && w.at === 'open'), sys = openSystem(s);
      if (firstRun >= 0 && sys !== null) expect(s.shown.findIndex(w => w.id === sys)).toBeLessThan(firstRun);
      const top = [...s.shown].reverse().find(w => w.at === 'open');
      expect(keyWindow(s)).toBe(top ? top.id : null);
    }
  });
});
