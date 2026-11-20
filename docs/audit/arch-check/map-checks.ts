// map-checks.ts: questions asked of the dependency map (scripts/deps.ts), not of the text.
//
//   bun docs/audit/arch-check/map-checks.ts
//
// 1. Separate before serializing: each save key more than one module writes (a shared write target).
// 2. Blast radius: the modules most others import, and whether a unit test imports each one directly.
// 3. Subtract before you add: each AppApi member no module calls (an api surface nobody uses).
// 4. Minimize reader load: each AppApi member exactly one module calls (a cross-module hop for one caller).

import { readdirSync, readFileSync } from 'node:fs';
import { buildMap, memberUsers } from '../../../scripts/deps.ts';
import { ROOT } from './lib.ts';

const map = await buildMap();

console.log('\n## 1. Save keys written by more than one module');
const writers = new Map<string, string[]>();
for (const m of map.modules.values()) for (const k of m.writes) writers.set(k, [...(writers.get(k) ?? []), m.file]);
const shared = [...writers].filter(([, w]) => w.length > 1).sort((a, b) => b[1].length - a[1].length);
for (const [k, w] of shared) console.log(`${k} (${w.length}): ${w.join(', ')}`);
console.log(`${shared.length} of ${writers.size} save keys have more than one writing module`);

console.log('\n## 2. Fan-in: modules imported by the most others, and the unit tests that import them');
const tests = readdirSync(`${ROOT}/tests`).filter(f => f.endsWith('.test.ts'));
const testText = tests.map(f => readFileSync(`${ROOT}/tests/${f}`, 'utf8'));
const testedBy = (file: string): number => {
  const tail = file.replace(/^src\//, '').replace(/\.(ts|js)$/, '');
  return testText.filter(t => t.includes(`/${tail}.ts'`) || t.includes(`/${tail}.js'`) || t.includes(`/${tail}'`)).length;
};
const fan = [...map.modules.values()].map(m => ({ file: m.file, n: m.importedBy.length, t: testedBy(m.file) })).sort((a, b) => b.n - a.n);
for (const f of fan.slice(0, 25)) console.log(`${String(f.n).padStart(3)} importers  ${String(f.t).padStart(2)} tests  ${f.file}`);
const untested = fan.filter(f => f.n >= 5 && f.t === 0 && f.file.startsWith('src/core'));
console.log(`core modules with 5 or more importers and no unit test that imports them: ${untested.map(f => `${f.file} (${f.n})`).join(', ') || 'none'}`);

console.log('\n## 3 and 4. AppApi members by how many modules call them');
const none: string[] = [], one: string[] = [];
for (const [name, a] of map.apis) {
  const users = memberUsers(a);
  for (const member of a.members.keys()) {
    const u = users.get(member) ?? [];
    if (u.length === 0) none.push(`${name}.${member}`);
    else if (u.length === 1) one.push(`${name}.${member} (${u[0]})`);
  }
}
console.log(`called by no module (${none.length}): ${none.join(', ')}`);
console.log(`called by one module (${one.length}): ${one.join(', ')}`);
