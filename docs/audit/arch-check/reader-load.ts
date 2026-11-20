// reader-load.ts: where a reader must trace layers or hold state to answer "where does X come from, what changes X".
// Principle: minimize-reader-load.
//
//   bun docs/audit/arch-check/reader-load.ts
//
// 1. Pass-through api members: a member published as `name: (a, b) => fn(a, b)`, the same arguments handed on. A
//    reader of the caller goes api table -> view -> function to learn what one call does.
// 2. The biggest modules, with how many `let`s and functions each holds: state to keep in the head while reading.

import { SOURCES, grep, lines, report } from './lib.ts';

const pass = grep(SOURCES(), /^\s*(\w+): \(([\w, ]*)\) => (?:A\(\)\.)?[\w.]+\(\2\),?\s*(\/\/.*)?$/).filter(h => {
  const m = h.text.match(/^(\w+): \(([\w, ]*)\) => ([\w.]+)\(/);
  return m !== null && m[2]!.length > 0;
});
report('1. Pass-through members (same arguments handed on)', pass);

console.log('\n## 2. Modules over 600 lines: lines, lets, functions');
const big = SOURCES().map(f => {
  const ls = lines(f), code = ls.filter(l => !/^\s*(\/\/|\*|\/\*\*)/.test(l));
  return { f, n: ls.length, lets: code.filter(l => /\blet \w/.test(l)).length, fns: code.filter(l => /\bfunction \w|\b(const|let) \w+ = (async )?(\([^)]*\)|\w+) =>/.test(l)).length };
}).filter(m => m.n > 600).sort((a, b) => b.n - a.n);
for (const m of big) console.log(`${String(m.n).padStart(5)} lines ${String(m.lets).padStart(4)} lets ${String(m.fns).padStart(4)} functions  ${m.f}`);
