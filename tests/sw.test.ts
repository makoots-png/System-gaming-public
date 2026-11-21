// The built service worker (the sw.js scripts/build.ts serves) run in a scope of fakes: a cache whose `add` fails for
// the files a test names, one page that keeps what the worker posts, and a count of `skipWaiting`. What the browser does
// with an install that rejects (the worker is dropped and the old one stays) is the browser's rule, not tested here;
// tests/e2e/upgrade.e2e.ts sees it in Chromium.
import { beforeAll, describe, expect, test } from 'bun:test';
import { buildApp } from '../scripts/build.ts';
import { NO_UPDATE, countOf, updateStep } from '../src/core/upgrade.ts';
import type { Update } from '../src/core/upgrade.ts';

type Built = { code: string; build: string; shell: string[] };
let built: Built;

beforeAll(async () => {
  const { build, files } = await buildApp();
  const code = new TextDecoder().decode(files.get('/sw.js')!.body);
  const shell = ['./', ...[...files.keys()].filter(p => !p.endsWith('.map') && p !== '/sw.js').map(p => p.slice(1))];
  built = { code, build, shell };
});

type Installed = { outcome: 'resolved' | 'rejected'; posted: unknown[]; caches: Map<string, Set<string>>; skipped: number };

/** Installs the built worker with `fails` failing to fetch, and answers what it did. */
async function install(fails: ReadonlySet<string>): Promise<Installed> {
  const listeners = new Map<string, (e: unknown) => void>();
  const posted: unknown[] = [], stored = new Map<string, Set<string>>();
  let skipped = 0, waited: Promise<unknown> | null = null;
  const caches = {
    open: async (name: string) => {
      const files = stored.get(name) ?? new Set<string>();
      stored.set(name, files);
      return { add: async (url: string) => { await Promise.resolve(); if (fails.has(url)) throw new TypeError(`Failed to fetch ${url}`); files.add(url); } };
    },
    delete: async (name: string) => stored.delete(name),
  };
  const self = {
    addEventListener: (type: string, f: (e: unknown) => void) => { listeners.set(type, f); },
    clients: { matchAll: async () => [{ postMessage: (m: unknown) => { posted.push(m); } }] },
    skipWaiting: async () => { skipped++; },
  };
  new Function('self', 'caches', built.code)(self, caches);
  listeners.get('install')!({ waitUntil: (p: Promise<unknown>) => { waited = p; } });
  const outcome = await waited!.then(() => 'resolved' as const, () => 'rejected' as const);
  return { outcome, posted, caches: stored, skipped };
}

/** What a refused tab's update machine makes of the messages, as src/edge/upgrade.ts feeds them. */
function tabAfter(posted: readonly unknown[]): Update {
  let u = updateStep(updateStep(NO_UPDATE, { type: 'refused', decision: { to: 'reload', build: built.build } }).state, { type: 'noted', kept: true }).state;
  for (const m of posted) { const count = countOf(m); if (count) u = updateStep(u, { type: 'caching', count }).state; }
  return u;
}

describe('the service worker\'s install', () => {
  test('with every file cached it counts each one, keeps its cache and takes over', async () => {
    const r = await install(new Set());
    const n = built.shell.length;
    expect(r.outcome).toBe('resolved');
    expect(r.skipped).toBe(1);
    expect([...r.caches.get(`hunter-system-${built.build}`)!].sort()).toEqual([...built.shell].sort());
    expect(r.posted).toEqual(Array.from({ length: n + 1 }, (_, done) => ({ type: 'caching', done, failed: 0, of: n })));
    expect(tabAfter(r.posted)).toEqual({ at: 'ready', build: built.build });
  });

  test('a file that does not cache is counted as failed, and the worker drops its cache and does not take over', async () => {
    const lost = built.shell.includes('index.html') ? 'index.html' : built.shell[1]!;
    const r = await install(new Set([lost]));
    const n = built.shell.length, last = r.posted.at(-1);
    expect(r.outcome).toBe('rejected');
    expect(r.skipped).toBe(0);
    expect(r.caches.has(`hunter-system-${built.build}`)).toBe(false);
    expect(last).toEqual({ type: 'caching', done: n - 1, failed: 1, of: n });
    expect(r.posted.length).toBe(n + 1);
    expect(tabAfter(r.posted)).toEqual({ at: 'reloading', build: built.build });
  });
});
