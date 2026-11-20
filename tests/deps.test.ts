// The dependency map (scripts/deps.ts, docs/dependency-map.md) is current, and the invisible links it shows hold:
// every event heard is emitted, every event emitted is heard, every entry of AppEvents is used, every app.api member
// used is registered, every one declared in AppApi (src/core/api.ts) is registered and the reverse, every one
// registered is used, nothing new is unresolved, every import keeps its layer's rule (a type import too), and no
// modules load one another (value imports; a type import is erased). Each allow list names what is wrong today; an
// entry that is fixed must leave its list, and a new problem fails the test. The layers and the cycles have no list. That an event name is an entry of AppEvents and that a member used is declared in
// AppApi is the compiler's check (tsconfig.json and tsconfig.views.json), not this file's.

import { expect, test } from 'bun:test';
import { assemble, buildMap, layerBreaks, mapIsCurrent, readTypeTable, scanFile, valueCycles, type DepsMap, type Scan, type Unresolved } from '../scripts/deps.ts';

const map: DepsMap = await buildMap();
const TESTS_ONLY = 'used only by browser tests, for setup or to read state';

/** Events emitted that no module hears. */
const UNHEARD: Record<string, string> = {};
/** Events heard that no module emits. */
const UNSENT: Record<string, string> = {};
/** `api.member` registered that no module uses. */
const UNUSED: Record<string, string> = {
  // the Job Change browser tests in gates-quests-dailies.e2e.ts tap Complete; the app's own level steps complete in their step (grant.ts)
  'quests.complete': TESTS_ONLY,
};
/** Unresolved entries, without their line (a line moves with every edit above it). */
const UNRESOLVED: string[] = [];

const sorted = (xs: Iterable<string>): string[] => [...xs].sort();
const events = [...map.events.values()];

test('the committed dependency map is what bun run deps -- --write writes', async () => {
  const { current } = await mapIsCurrent();
  expect(current, 'docs/dependency-map.md is out of date. Run bun run deps -- --write and commit it.').toBe(true);
});

test('every event a module hears is emitted by some module', () => {
  const unsent = events.filter(e => e.listeners.length && !e.emitters.length).map(e => e.name);
  expect(sorted(unsent), 'an app.on for an event nothing emits never runs. Emit it, or remove the listener.').toEqual(sorted(Object.keys(UNSENT)));
});

test('every event a module emits is heard by some module', () => {
  const unheard = events.filter(e => e.emitters.length && !e.listeners.length).map(e => e.name);
  expect(sorted(unheard), 'an app.emit nobody hears does nothing. Listen for it, or stop emitting it. A fixed one leaves UNHEARD.').toEqual(sorted(Object.keys(UNHEARD)));
});

test('every entry of AppEvents is emitted and heard by some module', () => {
  const idle = [...map.eventTable.keys()].filter(n => !map.events.get(n)?.emitters.length || !map.events.get(n)?.listeners.length);
  expect(idle, 'an event nobody emits or nobody hears is dead: remove its entry from AppEvents, or use it').toEqual([]);
});

test('every app.api member a module uses is registered by the module that owns the name', () => {
  const missing = [...map.apis.values()].flatMap(a => a.uses
    .filter(u => !a.at.length || (u.member !== null && !a.members.has(u.member)))
    .map(u => `${u.file}:${u.line}: app.api.${a.name}${u.member === null ? '' : `.${u.member}`}`));
  expect(missing, 'this call reaches a name no module registers. Register it in its owner\'s app.api object, or fix the name.').toEqual([]);
});

test('AppApi in src/core/api.ts lists exactly the app.api names the modules register', () => {
  const registered = [...map.apis.values()].filter(a => a.at.length).map(a => a.name);
  expect(sorted(map.apiTable.keys()), 'a registered name needs its type in AppApi; a name nobody registers leaves AppApi').toEqual(sorted(registered));
});

test('each API type declares exactly the members its module registers', () => {
  const drift = [...map.apis.values()].flatMap(a => {
    const declared = [...(map.apiTable.get(a.name)?.members.keys() ?? [])];
    return [
      ...declared.filter(m => !a.members.has(m)).map(m => `${a.name}.${m}: declared in src/core/api.ts, not registered`),
      ...[...a.members.keys()].filter(m => !declared.includes(m)).map(m => `${a.name}.${m}: registered, not declared in src/core/api.ts`),
    ];
  });
  expect(drift, 'the type, the registration and the uses of an API member change together').toEqual([]);
});

test('every registered app.api member is used by some module', () => {
  const used = new Set([...map.apis.values()].flatMap(a => a.uses.map(u => `${a.name}.${u.member}`)));
  const unused = [...map.apis.values()].flatMap(a => [...a.members.keys()].map(m => `${a.name}.${m}`)).filter(k => !used.has(k));
  expect(sorted(unused), 'a member nobody uses is dead code. Remove it, or use it. A fixed one leaves UNUSED.').toEqual(sorted(Object.keys(UNUSED)));
});

test('nothing new is unresolved in the dependency map', () => {
  const now = map.unresolved.map(u => `${u.file}: ${u.what}`);
  expect(sorted(now), 'write the call so the map can follow it: a literal event name, app.api.<name>.<member> or a declared alias of app.api.').toEqual(sorted(UNRESOLVED));
});

test('every import keeps its layer\'s rule: core imports only core, edge never a view, the server no browser module', () => {
  expect(layerBreaks(map), 'move the file, or the type both sides need, to the layer it belongs to. The Layers table of docs/dependency-map.md says what each layer may import; a type import counts too.').toEqual([]);
});

test('the layer check sees an edge module that imports a view, though the import is only a type', () => {
  const scans = new Map<string, Scan>([
    ['src/edge/link.ts', scanFile('src/edge/link.ts', "import type { App } from '../views/app.ts';\nimport { step } from '../core/step.ts';\n")],
    ['src/views/app.ts', scanFile('src/views/app.ts', "import { link } from '../edge/link.ts';\n")],
    ['src/core/step.ts', scanFile('src/core/step.ts', 'export const step = 1;\n')],
  ]);
  expect(layerBreaks(assemble(scans))).toEqual(['src/edge/link.ts imports src/views/app.ts']);
});

test('no modules load one another: each module has loaded everything it imports a value from before it runs', () => {
  expect(valueCycles(map), 'in a cycle one module runs before another has loaded, and a value it reads at its top is not there yet. Move what both sides need into a module that imports neither, or import only its type.').toEqual([]);
});

test('the map tells an import of types, which the build erases, from an import that loads its module', () => {
  const s = scanFile('src/core/x.ts', [
    "import type { A } from './a.ts';",
    "export type { B } from './b.ts';",
    "import { type C } from './c.ts';",
    "import { d } from './d.ts';",
    "export * from './e.ts';",
    "import './f.ts';",
    "const g = () => import('./g.ts');",
  ].join('\n'));
  expect(s.typeImports).toEqual(['src/core/a.ts', 'src/core/b.ts']);
  expect(s.imports).toEqual(['src/core/c.ts', 'src/core/d.ts', 'src/core/e.ts', 'src/core/f.ts', 'src/core/g.ts']);
});

test('the cycle check finds modules that load one another, and not a loop closed by a type import', () => {
  const scans = new Map<string, Scan>([
    ['src/core/a.ts', scanFile('src/core/a.ts', "import { b } from './b.ts';\nexport const a = 1;\n")],
    ['src/core/b.ts', scanFile('src/core/b.ts', "import { c } from './c.ts';\nexport const b = 1;\n")],
    ['src/core/c.ts', scanFile('src/core/c.ts', "import { a } from './a.ts';\nimport { d } from './d.ts';\nexport const c = 1;\n")],
    ['src/core/d.ts', scanFile('src/core/d.ts', "import type { C } from './c.ts';\nexport const d = 1;\n")],
  ]);
  expect(valueCycles(assemble(scans))).toEqual([['src/core/a.ts imports src/core/b.ts', 'src/core/b.ts imports src/core/c.ts', 'src/core/c.ts imports src/core/a.ts']]);
});

test('the map follows an alias of app.api into a call, and reads each member of a registration', () => {
  const s = scanFile('x.js', [
    'export function register(app) {',
    '  const A = () => app.api;',
    '  const S = A().sync || {};',
    '  app.api.demo = { first, second: () => S.send(1), async third() {} };',
    '}',
  ].join('\n'));
  expect(s.uses.filter(u => u.member).map(u => `${u.api}.${u.member}:${u.line}`)).toEqual(['sync.send:4']);
  expect(s.provides.filter(p => p.member).map(p => p.member)).toEqual(['first', 'second', 'third']);
});

test('the map reads each entry of a type table with its type and comment, and lists a key it cannot read', () => {
  const unresolved: Unresolved[] = [];
  const t = readTypeTable('x.ts', [
    'export type Table = {',
    '  /** Says who sends it. */',
    "  'a:b': { n: number; s: string };",
    '  get(id: string): number | null;',
    '  [k: string]: unknown;',
    '};',
  ].join('\n'), 'Table', unresolved);
  expect([...t!.values()].map(e => [e.name, e.type, e.doc, e.at.line])).toEqual([
    ['a:b', '{ n: number; s: string }', 'Says who sends it.', 3],
    ['get', '(id: string): number | null', '', 4],
  ]);
  expect(unresolved.map(u => u.line)).toEqual([5]);
});

test('the map lists a computed event name as unresolved and reads no event out of a string', () => {
  const s = scanFile('x.js', [
    'export function register(app) {',
    '  const name = pick();',
    '  app.emit(name, 1);',
    '  const help = "call app.on(\'never\', fn) to listen";',
    '  for (const ev of [\'a\', \'b\']) app.on(ev, () => {});',
    '}',
  ].join('\n'));
  expect(s.emits).toEqual([]);
  expect(s.listens.map(e => e.name)).toEqual(['a', 'b']);
  expect(s.unresolved.map(u => u.line)).toEqual([3]);
});
