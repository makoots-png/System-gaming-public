// Every view and panel the modules register, read from the source as the dependency map reads it (scripts/deps.ts).
// A new view or panel is checked here with no new test.
import { expect, test } from 'bun:test';
import { buildMap } from '../scripts/deps.ts';

const map = await buildMap();
const appJs = await Bun.file(`${import.meta.dir}/../src/app.js`).text();
const dupes = (xs: string[]): string[] => xs.filter((x, i) => xs.indexOf(x) !== i);

test('the modules register views and panels the map can read', () => {
  expect(map.views.length).toBeGreaterThan(0);
  expect(map.panels.length).toBeGreaterThan(0);
  expect(map.unresolved.filter(u => /register(View|Panel)/.test(u.what))).toEqual([]);
});

test('no two views share an id, and no two panels: the nav and the router find each by its id', () => {
  expect(dupes(map.views.map(v => v.id))).toEqual([]);
  expect(dupes(map.panels.map(p => p.id))).toEqual([]);
});

test('every panel names a view that some module registers, or it is never shown', () => {
  const ids = new Set(map.views.map(v => v.id));
  expect(map.panels.filter(p => !ids.has(p.view!)).map(p => `${p.id} -> ${p.view}`)).toEqual([]);
});

test('every module in MODULES is imported in src/app.js, and every module that registers a view or panel is in MODULES', () => {
  const modules = appJs.match(/const MODULES = \{([^}]*)\}/)![1]!.split(',').map(s => s.trim()).filter(Boolean);
  const imported = new Map([...appJs.matchAll(/^import \* as (\w+) from '\.\/([^']+)';$/gm)].map(m => [m[1]!, `src/${m[2]}`]));
  expect(modules.filter(m => !imported.has(m))).toEqual([]);
  const registered = new Set(modules.map(m => imported.get(m)));
  const registering = [...new Set([...map.views, ...map.panels].map(s => s.at.file))];
  expect(registering.filter(f => !registered.has(f))).toEqual([]);
});
