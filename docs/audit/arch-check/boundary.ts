// boundary.ts: outside data parsed once at the edge, then trusted. Principle: boundary-discipline.
//
//   bun docs/audit/arch-check/boundary.ts
//
// 1. Where JSON.parse runs: each is a boundary and should hand its result to a parser on the same line or the next.
// 2. Guards in views on data the api already typed (`Array.isArray(x.data...)`, `typeof q.title === 'string'`): either
//    the boundary did not parse it, or the guard is noise that hides which one is the parser.
// 3. Views that import the wire module (src/core/protocol.ts): a view that knows the wire shape, not the domain one.
// 4. Core modules that are not parsers but test types of values (`typeof x === 'object'`, `isObj(`), per file.

import { SOURCES, filesUnder, grep, report, text } from './lib.ts';

const VIEWS = filesUnder('src/views');
report('1. JSON.parse', grep(SOURCES(), /JSON\.parse\(/));

report('2. Shape guards in views on typed data', grep(VIEWS, /Array\.isArray\(\w+(\.\w+)*\.data\b|typeof \w+\.(title|name|data|hp|level|status)\b\s*===/));

report('3. Views that import src/core/protocol.ts, and what', grep(VIEWS, /from '\.\.\/core\/protocol\.ts'/), 300);

console.log('\n## 4. Shape tests in src/core outside the parser modules (typeof x === object / isObj / Array.isArray), per file');
const PARSERS = /parse|protocol|repair|save\.ts|registry\/|overrides|pack\.ts|one-of|ids\.ts|rules\.ts|room-server|fight-parse|story\/story|applied/;
const counts = filesUnder('src/core', ['.ts']).filter(f => !PARSERS.test(f)).map(f => {
  const t = text(f);
  return { f, n: (t.match(/typeof \w+(\.\w+)* === 'object'|\bisObj\(|Array\.isArray\(/g) ?? []).length };
}).filter(c => c.n > 0).sort((a, b) => b.n - a.n);
for (const c of counts) console.log(`${String(c.n).padStart(3)}  ${c.f}`);
