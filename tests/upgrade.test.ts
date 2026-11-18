import { describe, expect, test } from 'bun:test';
import { NO_UPDATE, TABLE, UPDATE_STATES, countOf, counted, decideUpgrade, firstCount, installOf, updateStep } from '../src/core/upgrade.ts';
import type { Count, Update, UpdateEffect, UpdateEvent } from '../src/core/upgrade.ts';
import { BUILD, WALK_EVENTS } from './models/upgrade-events.ts';

describe('the decision a refusal brings', () => {
  test('a refused tab that has not reloaded yet reloads', () => {
    expect(decideUpgrade({ serverBuild: 'bbb', reloadedFor: null, noted: true })).toEqual({ to: 'reload', build: 'bbb' });
  });

  test('a tab that reloaded for an earlier build reloads again for a newer one', () => {
    expect(decideUpgrade({ serverBuild: 'ccc', reloadedFor: 'bbb', noted: true })).toEqual({ to: 'reload', build: 'ccc' });
  });

  test('a tab that already reloaded for this server build and is refused again is stuck', () => {
    expect(decideUpgrade({ serverBuild: 'bbb', reloadedFor: 'bbb', noted: true })).toEqual({ to: 'stuck' });
  });

  test('a tab that cannot keep its note is stuck rather than reload without end', () => {
    expect(decideUpgrade({ serverBuild: 'bbb', reloadedFor: null, noted: false })).toEqual({ to: 'stuck' });
  });
});

/** Runs events from `start`: the last state and every effect in order. */
function play(events: readonly UpdateEvent[], start: Update = NO_UPDATE): { state: Update; effects: UpdateEffect[]; each: UpdateEffect[][] } {
  let state = start;
  const each: UpdateEffect[][] = [];
  for (const e of events) { const r = updateStep(state, e); state = r.state; each.push([...r.effects]); }
  return { state, effects: each.flat(), each };
}

const refused: UpdateEvent = { type: 'refused', decision: { to: 'reload', build: BUILD } };
const caching = (done: number, failed: number, of: number): UpdateEvent => ({ type: 'caching', count: { done, failed, of } });

describe('the app update', () => {
  test('a refused tab looks for the new worker and starts the quiet timer', () => {
    expect(play([refused])).toMatchObject({ state: { at: 'installing', build: BUILD, count: null }, effects: ['look', 'wait'] });
  });

  test('a tab with no new worker to wait for (none, blocked, or already in control) reloads at once', () => {
    const r = play([refused, { type: 'looked', installing: false }]);
    expect(r.state).toEqual({ at: 'reloading', build: BUILD });
    expect(r.each[1]).toEqual(['reload']);
  });

  test('the tab follows the new worker\'s count and reloads only once the worker takes over', () => {
    const r = play([refused, { type: 'looked', installing: true }, caching(0, 0, 3), caching(1, 0, 3), caching(2, 0, 3), caching(3, 0, 3), { type: 'controlled' }]);
    expect(r.each.slice(2, 5).map(fx => fx.includes('reload'))).toEqual([false, false, false]);
    expect(play([refused, caching(2, 0, 3)]).state).toEqual({ at: 'installing', build: BUILD, count: { done: 2, failed: 0, of: 3 } });
    expect(play([refused, caching(3, 0, 3)]).state).toEqual({ at: 'ready', build: BUILD });
    expect(r.state).toEqual({ at: 'reloading', build: BUILD });
    expect(r.effects.filter(fx => fx === 'reload')).toEqual(['reload']);
    expect(r.each.at(-1)).toEqual(['reload']);
  });

  test('every word of the worker restarts the quiet timer, so a slow phone still counting is not reloaded mid-count', () => {
    const r = play([refused, { type: 'looked', installing: true }, caching(0, 0, 3), caching(1, 0, 3), caching(2, 0, 3), caching(3, 0, 3)]);
    expect(r.each.slice(1)).toEqual([['wait'], ['wait'], ['wait'], ['wait'], ['wait']]);
  });

  test('a file the worker could not cache ends the wait: the tab reloads from the network at once', () => {
    const r = play([refused, caching(1, 0, 3), caching(1, 1, 3)]);
    expect(r.state).toEqual({ at: 'reloading', build: BUILD });
    expect(r.each.at(-1)).toEqual(['reload']);
  });

  test('a worker that says nothing for the quiet time is not waited for', () => {
    expect(play([refused, { type: 'quiet' }]).state).toEqual({ at: 'reloading', build: BUILD });
    expect(play([refused, caching(1, 0, 3), { type: 'quiet' }]).state).toEqual({ at: 'reloading', build: BUILD });
    expect(play([refused, caching(3, 0, 3), { type: 'quiet' }]).state).toEqual({ at: 'reloading', build: BUILD });
  });

  test('a new worker that takes over before its last count arrives reloads the tab', () => {
    expect(play([refused, caching(1, 0, 3), { type: 'controlled' }]).state).toEqual({ at: 'reloading', build: BUILD });
  });

  test('a stuck tab says so once and never reloads, whatever the worker does after', () => {
    const r = play([{ type: 'refused', decision: { to: 'stuck' } }, ...WALK_EVENTS, ...WALK_EVENTS]);
    expect(r.state).toEqual({ at: 'stuck' });
    expect(r.effects).toEqual(['stuck']);
  });

  test('a worker installing while no server refused the tab changes nothing: the tab runs on', () => {
    const quietEvents = WALK_EVENTS.filter(e => e.type !== 'refused');
    expect(play(quietEvents)).toEqual({ state: NO_UPDATE, effects: [], each: quietEvents.map(() => []) });
  });

  test('over any order of events the tab reloads at most once, says stuck at most once, and never both', () => {
    let seed = 7;
    const next = () => { seed = (seed * 1103515245 + 12345) % 2 ** 31; return seed / 2 ** 31; };
    for (let run = 0; run < 2000; run++) {
      const events = Array.from({ length: 1 + Math.floor(next() * 12) }, () => WALK_EVENTS[Math.floor(next() * WALK_EVENTS.length)]!);
      const { state, effects } = play(events);
      const reloads = effects.filter(fx => fx === 'reload').length, stucks = effects.filter(fx => fx === 'stuck').length;
      expect([reloads <= 1, stucks <= 1, reloads + stucks <= 1]).toEqual([true, true, true]);
      expect(reloads === 1).toBe(state.at === 'reloading');
      expect(stucks === 1).toBe(state.at === 'stuck');
      if (effects.includes('look')) expect(effects.indexOf('look')).toBe(0);
    }
  });

  test('every state answers every event (the table is whole)', () => {
    for (const s of UPDATE_STATES) expect(Object.keys(TABLE[s]).sort()).toEqual(['caching', 'controlled', 'looked', 'quiet', 'refused']);
  });
});

describe('the worker\'s count', () => {
  const answers = (oks: readonly boolean[]): Count => oks.reduce(counted, firstCount(oks.length));

  test('every file cached is a whole install', () => {
    expect(answers([true, true, true])).toEqual({ done: 3, failed: 0, of: 3 });
    expect(installOf(answers([true, true, true]))).toBe('cached');
  });

  test('one file that failed fails the install, however many cached', () => {
    expect(answers([true, false, true])).toEqual({ done: 2, failed: 1, of: 3 });
    expect(installOf(answers([true, false, true]))).toBe('failed');
    expect(installOf(counted(firstCount(3), false))).toBe('failed');
  });

  test('files still out are counting', () => {
    expect(installOf(counted(counted(firstCount(3), true), true))).toBe('counting');
    expect(installOf(firstCount(3))).toBe('counting');
  });

  test('the tab reads the worker\'s message and nothing else', () => {
    expect(countOf({ type: 'caching', done: 2, failed: 1, of: 4 })).toEqual({ done: 2, failed: 1, of: 4 });
    for (const bad of [null, 'caching', { type: 'other', done: 1, failed: 0, of: 2 }, { type: 'caching', done: 1, of: 2 },
      { type: 'caching', done: 2, failed: 1, of: 2 }, { type: 'caching', done: -1, failed: 0, of: 2 }, { type: 'caching', done: 0.5, failed: 0, of: 2 },
      { type: 'caching', done: 0, failed: 0, of: 0 }]) expect(countOf(bad)).toBeNull();
  });
});
