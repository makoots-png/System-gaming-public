// The dependency map (scripts/deps.ts) builds and renders cleanly from the live source, and the invisible links hold:
// every event heard is emitted, every event emitted is heard, every entry of AppEvents is used, every app.api member
// used is registered, every one declared in AppApi (src/core/api.ts) is registered and the reverse, every one
// registered is used, nothing new is unresolved, every import keeps its layer's rule (a type import too), no modules
// load one another (value imports; a type import is erased), and no new peer directory value cycles or parent-child
// value tangles appear. Each allow list names what is wrong today; an entry that is fixed must leave its list, and a
// new problem fails the test. The layers and file cycles have no list. That an event name is an entry of AppEvents and
// that a member used is declared in AppApi is the compiler's check (tsconfig.json and tsconfig.views.json), not this file's.

import { expect, test } from 'bun:test';
import { assemble, buildMap, checkMap, layerBreaks, parentChildTangles, peerDirCycles, peerDirSccs, readTypeTable, renderMap, scanFile, valueCycles, type DepsMap, type Scan, type Unresolved } from '../scripts/deps.ts';

const map: DepsMap = await buildMap();
const TESTS_ONLY = 'used only by browser tests, for setup or to read state';

/** Events emitted that no module hears. */
const UNHEARD: Record<string, string> = {};
/** Events heard that no module emits. */
const UNSENT: Record<string, string> = {};
/** `api.member` registered that no module uses. */
const UNUSED: Record<string, string> = {
  // setupGoblinDenGM in tests/e2e/helpers.ts rolls legacy fixture gates; starter.js now builds Tidewall Cannery Gate deterministically in core
  'gates.roll': TESTS_ONLY,
  // the Job Change browser tests in gates-quests-dailies.e2e.ts tap Complete; the app's own level steps complete in their step (grant.ts)
  'quests.complete': TESTS_ONLY,
};
/** Unresolved entries, without their line (a line moves with every edit above it). */
const UNRESOLVED: string[] = [];
/** Mutual value-import cycles between peer directories; fixing one forces removing it here. */
const PEER_DIR_CYCLES: string[] = [
  'src/core/combat <-> src/core/hunter',
  'src/core/combat <-> src/core/registry',
  'src/core/gates <-> src/core/hunter',
  'src/core/hunter <-> src/core/registry',
];
/** Strongly connected groups of two or more peer directories in the value-import graph (catches 3+ directory peer cycles). */
const PEER_DIR_SCCS: string[][] = [
  ['src/core/combat', 'src/core/gates', 'src/core/hunter', 'src/core/registry', 'src/core/trade'],
];
/** Parent-child value-import tangles (`file <-> childDir`); fixing one forces removing it here. */
const PARENT_CHILD_TANGLES: string[] = [
  'src/core/draws.ts <-> src/core/combat',
  'src/core/effects.ts <-> src/core/combat',
  'src/core/effects.ts <-> src/core/hunter',
  'src/core/protocol.ts <-> src/core/combat',
  'src/core/protocol.ts <-> src/core/gates',
  'src/core/protocol.ts <-> src/core/hunter',
  'src/core/protocol.ts <-> src/core/trade',
  'src/core/rewards.ts <-> src/core/combat',
  'src/core/rewards.ts <-> src/core/hunter',
  'src/core/rewards.ts <-> src/core/registry',
  'src/core/rules.ts <-> src/core/combat',
  'src/core/rules.ts <-> src/core/hunter',
  'src/core/rules.ts <-> src/core/registry',
  'src/core/save.ts <-> src/core/hunter',
  'src/core/session-log.ts <-> src/core/hunter',
];

const sorted = (xs: Iterable<string>): string[] => [...xs].sort();
const events = [...map.events.values()];

test('the dependency map generator renders every section and every module from the live source', () => {
  const rendered = renderMap(map);
  expect(map.modules.size).toBeGreaterThan(0);
  expect(rendered.startsWith('# Dependency map\n')).toBe(true);
  for (const heading of ['## Layers', '## Cycles of value imports', '## Modules', '## The app.api names', '## Events', '## Views and panels', '## Unresolved']) {
    expect(rendered).toContain(`\n${heading}\n`);
  }
  for (const file of map.modules.keys()) expect(rendered).toContain(`### \`${file}\``);
  expect(checkMap(map)).toEqual([]);
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
  expect(layerBreaks(map), 'move the file, or the type both sides need, to the layer it belongs to. IMPORT_RULE in scripts/deps.ts (or bun run deps) says what each layer may import; a type import counts too.').toEqual([]);
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

test('no new mutual value-import cycles between peer directories', () => {
  expect(
    peerDirCycles(map),
    'break the new peer directory value cycle (move shared code lower or import types only). A fixed cycle must leave PEER_DIR_CYCLES.',
  ).toEqual(PEER_DIR_CYCLES);
});

test('no new peer directory strongly connected value-import cycles', () => {
  expect(
    peerDirSccs(map),
    'do not pull a directory into a peer value-import cycle (including 3+ directory cycles). A directory that leaves a cycle must leave PEER_DIR_SCCS.',
  ).toEqual(PEER_DIR_SCCS);
});

test('no new parent-child value-import tangles', () => {
  expect(
    parentChildTangles(map),
    'do not make a parent file both import values from and be value-imported by the same child directory. A fixed tangle must leave PARENT_CHILD_TANGLES.',
  ).toEqual(PARENT_CHILD_TANGLES);
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
    "type H = import('./h.ts').Hold;",
    "const i = import('./i.ts').then(m => m);",
    'const fake = "import \'./j.ts\'";',
  ].join('\n'));
  expect(s.typeImports).toEqual(['src/core/a.ts', 'src/core/b.ts', 'src/core/h.ts']);
  expect(s.imports).toEqual(['src/core/c.ts', 'src/core/d.ts', 'src/core/e.ts', 'src/core/f.ts', 'src/core/g.ts', 'src/core/i.ts']);
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

test('the peer directory cycle checks catch 2-dir and 3-dir cycles with no file cycles, and ignore type-only loops and parent-child edges', () => {
  const scans = new Map<string, Scan>([
    // 2-dir peer cycle (a <-> b) with zero file cycles
    ['src/core/a/a1.ts', scanFile('src/core/a/a1.ts', "import { b1 } from '../b/b1.ts';\nexport const a1 = b1;\n")],
    ['src/core/a/a2.ts', scanFile('src/core/a/a2.ts', 'export const a2 = 1;\n')],
    ['src/core/b/b1.ts', scanFile('src/core/b/b1.ts', 'export const b1 = 1;\n')],
    ['src/core/b/b2.ts', scanFile('src/core/b/b2.ts', "import { a2 } from '../a/a2.ts';\nexport const b2 = a2;\n")],
    // 3-dir peer cycle (p -> q -> r -> p) with zero file cycles and zero 2-dir pairs
    ['src/core/p/p1.ts', scanFile('src/core/p/p1.ts', "import { q1 } from '../q/q1.ts';\nexport const p1 = q1;\n")],
    ['src/core/p/p2.ts', scanFile('src/core/p/p2.ts', 'export const p2 = 1;\n')],
    ['src/core/q/q1.ts', scanFile('src/core/q/q1.ts', 'export const q1 = 1;\n')],
    ['src/core/q/q2.ts', scanFile('src/core/q/q2.ts', "import { r1 } from '../r/r1.ts';\nexport const q2 = r1;\n")],
    ['src/core/r/r1.ts', scanFile('src/core/r/r1.ts', 'export const r1 = 1;\n')],
    ['src/core/r/r2.ts', scanFile('src/core/r/r2.ts', "import { p2 } from '../p/p2.ts';\nexport const r2 = p2;\n")],
    // Type-only peer loop (t1 <-> t2) via import type, export type, and import().Type: must not fire
    ['src/core/t1/x.ts', scanFile('src/core/t1/x.ts', "import { y } from '../t2/y.ts';\nexport const x = y;\n")],
    ['src/core/t2/y.ts', scanFile('src/core/t2/y.ts', "import type { X } from '../t1/z.ts';\nexport type { X2 } from '../t1/z.ts';\nexport type Q = import('../t1/z.ts').X;\nexport const y = 1;\n")],
    ['src/core/t1/z.ts', scanFile('src/core/t1/z.ts', 'export type X = number;\nexport type X2 = string;\n')],
    // Parent-child two-way edges: must not appear in peer checks
    ['src/core/parent.ts', scanFile('src/core/parent.ts', "import { a2 } from './a/a2.ts';\nexport const p = a2;\n")],
    ['src/core/a/a3.ts', scanFile('src/core/a/a3.ts', "import { p } from '../parent.ts';\nexport const a3 = p;\n")],
  ]);
  const g = assemble(scans);
  expect(valueCycles(g)).toEqual([]);
  expect(peerDirCycles(g)).toEqual(['src/core/a <-> src/core/b']);
  expect(peerDirSccs(g)).toEqual([
    ['src/core/a', 'src/core/b'],
    ['src/core/p', 'src/core/q', 'src/core/r'],
  ]);

  // Breaking the a <-> b return edge drops it from both checks, so a stale allowlist no longer matches
  const fixed = new Map(scans);
  fixed.set('src/core/b/b2.ts', scanFile('src/core/b/b2.ts', 'export const b2 = 1;\n'));
  const gFixed = assemble(fixed);
  expect(peerDirCycles(gFixed)).toEqual([]);
  expect(peerDirSccs(gFixed)).toEqual([['src/core/p', 'src/core/q', 'src/core/r']]);
});

test('the parent-child tangle check catches two-way file-to-subdir value tangles with no file cycles, and ignores type-only and one-way edges', () => {
  const scans = new Map<string, Scan>([
    // Direct child tangle (parent.ts <-> sub) with zero file cycles
    ['src/core/parent.ts', scanFile('src/core/parent.ts', "import { c1 } from './sub/c1.ts';\nexport const p = c1;\n")],
    ['src/core/sub/c1.ts', scanFile('src/core/sub/c1.ts', 'export const c1 = 1;\n')],
    ['src/core/sub/c2.ts', scanFile('src/core/sub/c2.ts', "import { p } from '../parent.ts';\nexport const c2 = p;\n")],
    // Nested descendant tangle (nested.ts -> deep/a.ts and deep/inner/b.ts -> nested.ts)
    ['src/core/nested.ts', scanFile('src/core/nested.ts', "import { a } from './deep/a.ts';\nexport const n = a;\n")],
    ['src/core/deep/a.ts', scanFile('src/core/deep/a.ts', 'export const a = 1;\n')],
    ['src/core/deep/inner/b.ts', scanFile('src/core/deep/inner/b.ts', "import { n } from '../../nested.ts';\nexport const b = n;\n")],
    // Type-only return edge (typed.ts -> clean/x.ts, clean/y.ts import type typed.ts): must not fire
    ['src/core/typed.ts', scanFile('src/core/typed.ts', "import { x } from './clean/x.ts';\nexport type T = number;\nexport const t = x;\n")],
    ['src/core/clean/x.ts', scanFile('src/core/clean/x.ts', 'export const x = 1;\n')],
    ['src/core/clean/y.ts', scanFile('src/core/clean/y.ts', "import type { T } from '../typed.ts';\nexport type Y = import('../typed.ts').T;\nexport const y = 1;\n")],
    // One-way parent -> child only: must not fire
    ['src/core/oneway.ts', scanFile('src/core/oneway.ts', "import { x } from './clean/x.ts';\nexport const o = x;\n")],
  ]);
  const g = assemble(scans);
  expect(valueCycles(g)).toEqual([]);
  expect(parentChildTangles(g)).toEqual([
    'src/core/nested.ts <-> src/core/deep',
    'src/core/parent.ts <-> src/core/sub',
  ]);

  // Breaking parent.ts <-> sub drops it from the output, forcing removal from an exact allowlist
  const fixed = new Map(scans);
  fixed.set('src/core/sub/c2.ts', scanFile('src/core/sub/c2.ts', "import type { p } from '../parent.ts';\nexport const c2 = 1;\n"));
  expect(parentChildTangles(assemble(fixed))).toEqual(['src/core/nested.ts <-> src/core/deep']);
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
