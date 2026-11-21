import { describe, expect, test } from 'bun:test';
import { NO_WINDOWS, WINDOW_EVENTS, keyWindow, openSheet, openSystem, windowAt, windowId, windowStep } from '../src/core/windows.ts';
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

  test('a sheet its owner takes down goes at once with no move out, and its owner is not told again', () => {
    const on = run(NO_WINDOWS, { kind: 'open', id: MAKER, of: 'maker' }, { kind: 'open', id: SHEET, of: 'sheet', sheet: 'fightTools' });
    expect(run(on.windows, { kind: 'close', id: SHEET })).toEqual({ windows: { shown: [{ id: MAKER, kind: 'maker', at: 'open' }], queued: [] }, fx: [`forget ${SHEET}`] });
  });

  test('a sheet on top takes the keys (Escape takes it down wherever the focus is), and a window opened over it takes them back', () => {
    const on = run(NO_WINDOWS, { kind: 'open', id: SHEET, of: 'sheet', sheet: 'quickRoll' });
    expect(keyWindow(on.windows)).toBe(SHEET);
    expect(openSheet(on.windows, 'quickRoll')).toBe(SHEET);
    const under = run(on.windows, ...asked(A)).windows;
    expect(keyWindow(under)).toBe(A);
    expect(windowStep(under, { kind: 'escape', id: SHEET })).toEqual({ windows: under, fx: [] });
  });

  test('Escape on an open sheet takes it off and tells its owner to take it down; on any other window Escape is its own and changes nothing here', () => {
    const on = run(NO_WINDOWS, { kind: 'open', id: SHEET, of: 'sheet', sheet: 'quickRoll' });
    expect(run(on.windows, { kind: 'escape', id: SHEET })).toEqual({ windows: NO_WINDOWS, fx: [`shut ${SHEET}`, `forget ${SHEET}`] });
    const sys = run(NO_WINDOWS, ...asked(A)).windows;
    expect(windowStep(sys, { kind: 'escape', id: A })).toEqual({ windows: sys, fx: [] });
    const maker = run(NO_WINDOWS, { kind: 'open', id: MAKER, of: 'maker' }).windows;
    expect(windowStep(maker, { kind: 'escape', id: MAKER })).toEqual({ windows: maker, fx: [] });
  });

  test('a tap on a tab, the one shown too, takes every sheet off and tells each owner; the System windows and makers stay', () => {
    const CARD = windowId(9);
    const up = run(NO_WINDOWS, { kind: 'open', id: MAKER, of: 'maker' }, { kind: 'open', id: SHEET, of: 'sheet', sheet: 'fightTools' },
      { kind: 'open', id: CARD, of: 'sheet', sheet: 'rowCard' }, ...asked(A)).windows;
    const went = run(up, { kind: 'went' });
    expect(order(went.windows)).toEqual([`${MAKER} open`, `${A} open`]);
    expect(went.fx).toEqual([`shut ${SHEET}`, `forget ${SHEET}`, `shut ${CARD}`, `forget ${CARD}`]);
    const none = run(NO_WINDOWS, ...asked(A)).windows;
    expect(windowStep(none, { kind: 'went' }).windows).toBe(none);
  });

  test('Escape and a tab move only an open sheet: every other window, in every place, stays as it is', () => {
    const places: Record<string, Windows> = {
      'a System window waiting': run(NO_WINDOWS, ...asked(B), ...asked(A)).windows,
      'a System window open': run(NO_WINDOWS, ...asked(A)).windows,
      'a System window leaving': run(NO_WINDOWS, ...asked(A), { kind: 'close', id: A }).windows,
      'a maker open': run(NO_WINDOWS, { kind: 'open', id: A, of: 'maker' }).windows,
      'the first-run window open': run(NO_WINDOWS, { kind: 'open', id: A, of: 'onboard' }).windows,
      'a sheet open': run(NO_WINDOWS, { kind: 'open', id: A, of: 'sheet', sheet: 'tokenCard' }).windows,
      'no window': NO_WINDOWS,
    };
    const moves = (s: Windows) => [windowStep(s, { kind: 'escape', id: A }), windowStep(s, { kind: 'went' })].map(r => (r.windows === s ? 'stays' : `off, ${r.fx.map(f => f.kind).join(' ')}`));
    expect(Object.fromEntries(Object.entries(places).map(([k, s]) => [k, moves(s)]))).toEqual({
      'a System window waiting': ['stays', 'stays'],
      'a System window open': ['stays', 'stays'],
      'a System window leaving': ['stays', 'stays'],
      'a maker open': ['stays', 'stays'],
      'the first-run window open': ['stays', 'stays'],
      'a sheet open': ['off, shut forget', 'off, shut forget'],
      'no window': ['stays', 'stays'],
    });
  });

  test('a sheet already up is not opened twice: one Quick Roll at most', () => {
    const on = run(NO_WINDOWS, { kind: 'open', id: SHEET, of: 'sheet', sheet: 'quickRoll' }).windows;
    expect(windowStep(on, { kind: 'open', id: windowId(9), of: 'sheet', sheet: 'quickRoll' })).toEqual({ windows: on, fx: [] });
    expect(windowStep(on, { kind: 'open', id: windowId(9), of: 'sheet', sheet: 'tokenCard' }).windows.shown).toHaveLength(2);
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

  test('in every state the walk reaches: one place per window, at most one System window open, none over the first-run window, one sheet of a name, and the keys with the top open one', () => {
    expect([...new Set(WINDOW_WALK.map(e => e.kind))].sort()).toEqual([...WINDOW_EVENTS].sort());
    const walk = bfs([NO_WINDOWS], s => WINDOW_WALK.map(event => ({ event, to: windowStep(s, event).windows })), s => JSON.stringify(s));
    expect(walk.states.length).toBeGreaterThan(20);
    for (const s of walk.states) {
      const ids = [...s.shown.map(w => w.id), ...s.queued];
      expect(new Set(ids).size).toBe(ids.length);
      expect(s.shown.filter(w => w.kind === 'system' && w.at === 'open').length).toBeLessThanOrEqual(1);
      const sheets = s.shown.flatMap(w => (w.kind === 'sheet' ? [w.sheet] : []));
      expect(new Set(sheets).size).toBe(sheets.length);
      const firstRun = s.shown.findIndex(w => w.id === FIRST_RUN && w.at === 'open'), sys = openSystem(s);
      if (firstRun >= 0 && sys !== null) expect(s.shown.findIndex(w => w.id === sys)).toBeLessThan(firstRun);
      const top = [...s.shown].reverse().find(w => w.at === 'open');
      expect(keyWindow(s)).toBe(top ? top.id : null);
    }
  });
});
