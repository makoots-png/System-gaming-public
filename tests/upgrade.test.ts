import { afterEach, describe, expect, test } from 'bun:test';
import { NO_UPDATE, STUCK_TEXT, TABLE, UPDATE_QUIET_MS, UPDATE_STATES, UPGRADE_TAKEOVER_WORDS, countOf, counted, decideUpgrade, firstCount, installOf, takeoverCause, updateStep } from '../src/core/upgrade.ts';
import type { Count, Update, UpdateEffect, UpdateEvent, UpdateState } from '../src/core/upgrade.ts';
import { READ_ONLY_WHYS, TAKEOVER_WORDS } from '../src/core/store-life.ts';
import { warningFaults } from '../src/core/warning.ts';
import { BUILD, WALK_EVENTS } from './models/upgrade-events.ts';

describe('the decision a refusal brings', () => {
  test('a refused tab that has not reloaded yet reloads', () => {
    expect(decideUpgrade({ serverBuild: 'bbb', reloadedFor: null })).toEqual({ to: 'reload', build: 'bbb' });
  });

  test('a tab that reloaded for an earlier build reloads again for a newer one', () => {
    expect(decideUpgrade({ serverBuild: 'ccc', reloadedFor: 'bbb' })).toEqual({ to: 'reload', build: 'ccc' });
  });

  test('a tab that already reloaded for this server build and is refused again is stuck', () => {
    expect(decideUpgrade({ serverBuild: 'bbb', reloadedFor: 'bbb' })).toEqual({ to: 'stuck' });
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
const kept: UpdateEvent = { type: 'noted', kept: true };
const caching = (done: number, failed: number, of: number): UpdateEvent => ({ type: 'caching', count: { done, failed, of } });

describe('the transition table: every state against every event', () => {
  const OTHER = 'other-build';
  const S = {
    none: { at: 'none' },
    noting: { at: 'noting', build: BUILD },
    installing: { at: 'installing', build: BUILD, count: { done: 1, failed: 0, of: 2 } },
    ready: { at: 'ready', build: BUILD },
    reloading: { at: 'reloading', build: BUILD },
    stuck: { at: 'stuck' },
  } satisfies { readonly [K in UpdateState]: Extract<Update, { at: K }> };
  const E = {
    'refused, reload': { type: 'refused', decision: { to: 'reload', build: OTHER } },
    'refused, stuck': { type: 'refused', decision: { to: 'stuck' } },
    'noted, kept': { type: 'noted', kept: true },
    'noted, lost': { type: 'noted', kept: false },
    'looked, installing': { type: 'looked', worker: 'installing' },
    'looked, waiting': { type: 'looked', worker: 'waiting' },
    'looked, none': { type: 'looked', worker: 'none' },
    'caching, counting': caching(1, 0, 2),
    'caching, cached': caching(2, 0, 2),
    'caching, failed': caching(1, 1, 2),
    controlled: { type: 'controlled' },
    quiet: { type: 'quiet' },
  } satisfies Record<string, UpdateEvent>;
  type Name = keyof typeof E;
  /** `same`: the state object answered as it was, and nothing to do. Every cell not listed is `same`. */
  type Cell = 'same' | readonly [Update, readonly UpdateEffect[]];
  const reloads: Cell = [{ at: 'reloading', build: BUILD }, ['reload']];
  const EXPECTED: { readonly [K in UpdateState]: Partial<Record<Name, Cell>> } = {
    none: {
      'refused, reload': [{ at: 'noting', build: OTHER }, ['note']],
      'refused, stuck': [{ at: 'stuck' }, ['stuck']],
    },
    noting: {
      'noted, kept': [{ at: 'installing', build: BUILD, count: null }, ['look', 'wait']],
      'noted, lost': [{ at: 'stuck' }, ['stuck']],
    },
    installing: {
      'looked, installing': [S.installing, ['wait']],
      'looked, waiting': [{ at: 'ready', build: BUILD }, ['wait']],
      'looked, none': reloads,
      'caching, counting': [{ at: 'installing', build: BUILD, count: { done: 1, failed: 0, of: 2 } }, ['wait']],
      'caching, cached': [{ at: 'ready', build: BUILD }, ['wait']],
      'caching, failed': reloads,
      controlled: reloads,
      quiet: reloads,
    },
    ready: { controlled: reloads, quiet: reloads },
    reloading: {},
    stuck: {},
  };

  for (const at of UPDATE_STATES) {
    for (const name of Object.keys(E) as Name[]) {
      const cell = EXPECTED[at][name] ?? 'same';
      test(`${at} + ${name}: ${cell === 'same' ? 'the same' : `${cell[0].at}, ${cell[1].join(' and ') || 'nothing to do'}`}`, () => {
        const r = updateStep(S[at], E[name]);
        if (cell === 'same') expect(r).toEqual({ state: S[at], effects: [] });
        else expect(r).toEqual({ state: cell[0], effects: cell[1] });
        if (cell === 'same') expect(r.state).toBe(S[at]);
      });
    }
  }

  test('the table names every state and every kind of event', () => {
    expect(Object.keys(S).sort()).toEqual([...UPDATE_STATES].sort());
    expect([...new Set(Object.values(E).map(e => e.type))].sort()).toEqual([...new Set(WALK_EVENTS.map(e => e.type))].sort());
    for (const s of UPDATE_STATES) expect(Object.keys(TABLE[s]).sort()).toEqual(['caching', 'controlled', 'looked', 'noted', 'quiet', 'refused']);
  });
});

describe('the app update', () => {
  test('a refused tab first notes that it reloads for the new build', () => {
    expect(play([refused])).toMatchObject({ state: { at: 'noting', build: BUILD }, effects: ['note'] });
  });

  test('once noted it looks for the new worker and starts the quiet timer', () => {
    expect(play([refused, kept])).toMatchObject({ state: { at: 'installing', build: BUILD, count: null }, each: [['note'], ['look', 'wait']] });
  });

  test('a tab that cannot keep its note is stuck rather than reload without end', () => {
    expect(play([refused, { type: 'noted', kept: false }])).toMatchObject({ state: { at: 'stuck' }, effects: ['note', 'stuck'] });
  });

  test('a tab with no new worker to wait for (none, blocked, or already in control) reloads at once', () => {
    const r = play([refused, kept, { type: 'looked', worker: 'none' }]);
    expect(r.state).toEqual({ at: 'reloading', build: BUILD });
    expect(r.each[2]).toEqual(['reload']);
  });

  test('a new worker already installed and waiting when the check answers is waited for: the tab reloads when it takes over, not under the old worker (SMX-sync-6.2)', () => {
    const found = play([refused, kept, { type: 'looked', worker: 'waiting' }]);
    expect(found.state).toEqual({ at: 'ready', build: BUILD });
    expect(found.effects).not.toContain('reload');
    const r = play([{ type: 'controlled' }], found.state);
    expect(r).toEqual({ state: { at: 'reloading', build: BUILD }, effects: ['reload'], each: [['reload']] });
  });

  test('a refusal for another build while the tab updates notes nothing and keeps the first build (SMX-sync-6.3)', () => {
    const again: UpdateEvent = { type: 'refused', decision: { to: 'reload', build: 'build-3' } };
    for (const before of [[refused], [refused, kept], [refused, kept, caching(3, 0, 3)], [refused, kept, { type: 'quiet' }]] as const) {
      const r = play([...before, again]);
      expect(r.effects.filter(fx => fx === 'note')).toEqual(['note']);
      expect(r.each.at(-1)).toEqual([]);
      expect(r.state).toEqual(play(before).state);
    }
  });

  test('the tab follows the new worker\'s count and reloads only once the worker takes over', () => {
    const r = play([refused, kept, { type: 'looked', worker: 'installing' }, caching(0, 0, 3), caching(1, 0, 3), caching(2, 0, 3), caching(3, 0, 3), { type: 'controlled' }]);
    expect(r.each.slice(3, 7).map(fx => fx.includes('reload'))).toEqual([false, false, false, false]);
    expect(play([refused, kept, caching(2, 0, 3)]).state).toEqual({ at: 'installing', build: BUILD, count: { done: 2, failed: 0, of: 3 } });
    expect(play([refused, kept, caching(3, 0, 3)]).state).toEqual({ at: 'ready', build: BUILD });
    expect(r.state).toEqual({ at: 'reloading', build: BUILD });
    expect(r.effects.filter(fx => fx === 'reload')).toEqual(['reload']);
    expect(r.each.at(-1)).toEqual(['reload']);
  });

  test('every word of the worker restarts the quiet timer, so a slow phone still counting is not reloaded mid-count', () => {
    const r = play([refused, kept, { type: 'looked', worker: 'installing' }, caching(0, 0, 3), caching(1, 0, 3), caching(2, 0, 3), caching(3, 0, 3)]);
    expect(r.each.slice(2)).toEqual([['wait'], ['wait'], ['wait'], ['wait'], ['wait']]);
  });

  test('a file the worker could not cache ends the wait: the tab reloads from the network at once', () => {
    const r = play([refused, kept, caching(1, 0, 3), caching(1, 1, 3)]);
    expect(r.state).toEqual({ at: 'reloading', build: BUILD });
    expect(r.each.at(-1)).toEqual(['reload']);
  });

  test('a worker that says nothing for the quiet time is not waited for', () => {
    expect(play([refused, kept, { type: 'quiet' }]).state).toEqual({ at: 'reloading', build: BUILD });
    expect(play([refused, kept, caching(1, 0, 3), { type: 'quiet' }]).state).toEqual({ at: 'reloading', build: BUILD });
    expect(play([refused, kept, caching(3, 0, 3), { type: 'quiet' }]).state).toEqual({ at: 'reloading', build: BUILD });
  });

  test('a new worker that takes over before its last count arrives reloads the tab', () => {
    expect(play([refused, kept, caching(1, 0, 3), { type: 'controlled' }]).state).toEqual({ at: 'reloading', build: BUILD });
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

  test('over any order of events the tab notes once, reloads at most once, says stuck at most once, and never both', () => {
    let seed = 7;
    const next = () => { seed = (seed * 1103515245 + 12345) % 2 ** 31; return seed / 2 ** 31; };
    for (let run = 0; run < 2000; run++) {
      const events = Array.from({ length: 1 + Math.floor(next() * 12) }, () => WALK_EVENTS[Math.floor(next() * WALK_EVENTS.length)]!);
      const { state, effects } = play(events);
      const count = (fx: UpdateEffect) => effects.filter(x => x === fx).length;
      expect([count('note') <= 1, count('reload') <= 1, count('stuck') <= 1, count('reload') + count('stuck') <= 1]).toEqual([true, true, true, true]);
      expect(count('reload') === 1).toBe(state.at === 'reloading');
      expect(count('stuck') === 1).toBe(state.at === 'stuck');
      if (effects.includes('look') || effects.includes('reload')) expect(effects.slice(0, 2)).toEqual(['note', 'look']);
    }
  });
});

describe('the update on a page (src/edge/upgrade.ts with a browser of fakes)', () => {
  type Edge = typeof import('../src/edge/upgrade.ts');
  /** The registration's workers once its update check answered. */
  type Found = { installing: object | null; waiting: object | null };
  const NOTE = 'hunter-system-upgrade';
  const g = globalThis as unknown as Record<string, unknown>;
  const faked = ['navigator', 'location', 'sessionStorage', 'setTimeout', 'clearTimeout'] as const;
  const saved = faked.map(k => [k, Object.getOwnPropertyDescriptor(g, k)] as const);
  afterEach(() => { for (const [k, d] of saved) { if (d) Object.defineProperty(g, k, d); else delete g[k]; } });
  const realTimeout = setTimeout;
  const settle = () => new Promise<void>(resolve => realTimeout(resolve, 0));
  let pages = 0;

  /** A page of the app on its own copy of the module: its registration after the update check (`'no workers'` where the browser has none), its tab storage, and what it did. */
  async function open(o: { found?: Found | 'no workers'; storage?: 'kept' | 'blocked'; note?: string } = {}) {
    const did = { reloads: 0, looks: 0, stuck: [] as string[], timers: new Map<number, () => void>() };
    const tab = new Map<string, string>(o.note ? [[NOTE, o.note]] : []);
    const listeners: Record<string, ((e: { data?: unknown }) => void)[]> = {};
    let ids = 0;
    const set = (k: (typeof faked)[number], value: unknown) => Object.defineProperty(g, k, { value, configurable: true, writable: true });
    const blocked = () => { throw new Error('storage blocked'); };
    set('navigator', o.found === 'no workers' ? {} : { serviceWorker: {
      addEventListener: (type: string, f: (e: { data?: unknown }) => void) => { (listeners[type] ??= []).push(f); },
      getRegistration: async () => {
        did.looks++;
        const registration = { installing: null as object | null, waiting: null as object | null, update: async () => { Object.assign(registration, o.found ?? { installing: {}, waiting: null }); } };
        return registration;
      },
    } });
    set('location', { reload: () => { did.reloads++; } });
    set('sessionStorage', o.storage === 'blocked' ? { getItem: blocked, setItem: blocked }
      : { getItem: (k: string) => tab.get(k) ?? null, setItem: (k: string, v: string) => { tab.set(k, v); } });
    set('setTimeout', (fn: () => void) => { const id = ++ids; did.timers.set(id, fn); return id; });
    set('clearTimeout', (id: number) => { did.timers.delete(id); });
    const edge = await import(`../src/edge/upgrade.ts?page=${++pages}`) as Edge;
    return {
      edge, did, tab,
      refuse: (build: string) => edge.upgradeRefused(build, text => { did.stuck.push(text); }),
      worker: (type: 'message' | 'controllerchange', data?: unknown) => { for (const f of listeners[type] ?? []) f({ data }); },
    };
  }

  test('with no service worker the tab reloads once and leaves no quiet timer behind (SMX-sync-6.1)', async () => {
    const p = await open({ found: 'no workers' });
    p.refuse('b2');
    expect(p.did.reloads).toBe(1);
    expect(p.did.timers.size, 'no quiet timer is armed after the reload').toBe(0);
    expect(p.edge.updateNow()).toEqual({ at: 'reloading', build: 'b2' });
    expect(p.tab.get(NOTE)).toBe('b2');
  });

  test('a new worker found waiting is waited for: the tab reloads when it takes over, not under the old worker (SMX-sync-6.2)', async () => {
    const p = await open({ found: { installing: null, waiting: {} } });
    p.refuse('b2');
    await settle();
    expect(p.did.reloads, 'no reload under the old worker').toBe(0);
    expect(p.edge.updateNow()).toEqual({ at: 'ready', build: 'b2' });
    p.worker('controllerchange');
    expect(p.did.reloads).toBe(1);
    expect(p.did.timers.size).toBe(0);
  });

  test('a second refusal while the tab updates leaves its note and its state on the first build (SMX-sync-6.3)', async () => {
    const p = await open();
    p.refuse('b2');
    await settle();
    p.refuse('b3');
    expect(p.tab.get(NOTE)).toBe('b2');
    expect(p.edge.updateNow()).toEqual({ at: 'installing', build: 'b2', count: null });
    p.worker('message', { type: 'caching', done: 2, failed: 0, of: 2 });
    expect(p.edge.updateNow()).toEqual({ at: 'ready', build: 'b2' });
    p.worker('controllerchange');
    expect([p.did.reloads, p.did.looks, p.did.stuck.length]).toEqual([1, 1, 0]);
  });

  test('a worker that says nothing for the quiet time is not waited for', async () => {
    const p = await open();
    p.refuse('b2');
    await settle();
    expect([p.did.reloads, p.did.timers.size]).toEqual([0, 1]);
    for (const fire of [...p.did.timers.values()]) fire();
    expect(p.did.reloads).toBe(1);
    expect(UPDATE_QUIET_MS).toBeGreaterThan(0);
  });

  test('a tab that cannot keep its note says it is out of date and neither looks for a worker nor reloads', async () => {
    const p = await open({ storage: 'blocked' });
    p.refuse('b2');
    await settle();
    expect(p.did.stuck).toEqual([p.edge.STUCK_TEXT]);
    expect([p.did.reloads, p.did.looks, p.did.timers.size]).toEqual([0, 0, 0]);
    expect(p.edge.updateNow()).toEqual({ at: 'stuck' });
  });

  test('a tab refused again for the build it reloaded for says it is out of date and keeps its note', async () => {
    const p = await open({ note: 'b2' });
    p.refuse('b2');
    await settle();
    expect(p.did.stuck).toEqual([p.edge.STUCK_TEXT]);
    expect([p.did.reloads, p.did.looks]).toEqual([0, 0]);
    expect(p.tab.get(NOTE)).toBe('b2');
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

describe('stuck-update takeover cause and copy', () => {
  test('a stuck update takes priority over every read-only cause so Take over here is never offered on an out-of-date build', () => {
    const stuck: Update = { at: 'stuck' };
    expect(takeoverCause(null, stuck)).toBe('upgradeStuck');
    for (const why of READ_ONLY_WHYS) {
      expect(takeoverCause(why, stuck)).toBe('upgradeStuck');
    }
    const nonStuck: readonly Update[] = [
      NO_UPDATE,
      { at: 'noting', build: BUILD },
      { at: 'installing', build: BUILD, count: null },
      { at: 'ready', build: BUILD },
      { at: 'reloading', build: BUILD },
    ];
    for (const u of nonStuck) {
      expect(takeoverCause(null, u)).toBeNull();
      for (const why of READ_ONLY_WHYS) expect(takeoverCause(why, u)).toBe(why);
    }
  });

  test('stuck-update takeover copy passes Variant 1 warning rules and avoids personification', () => {
    expect(UPGRADE_TAKEOVER_WORDS.tag).toBe('Update required');
    expect(UPGRADE_TAKEOVER_WORDS.reload).toBe('Reload app');
    expect(UPGRADE_TAKEOVER_WORDS.body).toContain(STUCK_TEXT);
    expect(STUCK_TEXT.toLowerCase()).not.toContain('update itself');
    expect(STUCK_TEXT).not.toContain('!');
    expect(warningFaults({
      tag: UPGRADE_TAKEOVER_WORDS.tag,
      title: UPGRADE_TAKEOVER_WORDS.heading,
      body: UPGRADE_TAKEOVER_WORDS.body,
      actions: [
        { label: UPGRADE_TAKEOVER_WORDS.reload, primary: true },
        { label: TAKEOVER_WORDS.exportBackup },
      ],
    })).toEqual([]);
  });
});
