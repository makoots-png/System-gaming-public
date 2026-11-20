// model-domain.ts: signs that the domain lives in scattered branches instead of one structure.
// Principle: model-the-domain ("a new feature that grows an existing if/else chain by one more branch, or a second
// boolean that must stay in sync with the first").
//
//   bun docs/audit/arch-check/model-domain.ts
//
// 1. A discriminant value (`x.kind === 'personal'`) branched on in many files: each new variant means a visit to each.
// 2. A type of src/core with three or more boolean fields: flags that may need to stay in step.
// 3. A state-like field (status, state, phase, mode, kind, step) of src/core typed as a plain string, not a union.

import { SOURCES, filesUnder, grep, report, text } from './lib.ts';

console.log('\n## 1. Discriminant values branched on in 5 or more files');
const DISC = /\.(kind|type|status|state|phase|mode|op|on|seat)\s*[!=]==\s*'([\w-]+)'/g;
const where = new Map<string, Set<string>>();
for (const f of SOURCES()) for (const m of text(f).matchAll(DISC)) {
  const k = `${m[1]} '${m[2]}'`;
  where.set(k, (where.get(k) ?? new Set()).add(f));
}
const spread = [...where].filter(([, fs]) => fs.size >= 5).sort((a, b) => b[1].size - a[1].size);
for (const [k, fs] of spread) console.log(`${String(fs.size).padStart(3)} files  .${k}  ${[...fs].map(f => f.replace(/^src\//, '')).join(', ')}`);

console.log('\n## 2. Types of src/core with three or more boolean fields');
for (const f of filesUnder('src/core', ['.ts'])) {
  const t = text(f);
  for (const m of t.matchAll(/(?:type|interface)\s+(\w+)(?:<[^>]*>)?\s*=?\s*\{/g)) {
    let depth = 0, i = m.index! + m[0].length - 1;
    for (; i < t.length; i++) { if (t[i] === '{') depth++; else if (t[i] === '}' && --depth === 0) break; }
    const body = t.slice(m.index!, i);
    const flags = [...body.matchAll(/(\w+)\??:\s*boolean\b/g)].map(x => x[1]);
    if (flags.length >= 3) console.log(`${f}:${t.slice(0, m.index!).split('\n').length}  ${m[1]}: ${flags.join(', ')}`);
  }
}

report('3. State-like fields of src/core typed as a plain string', grep(filesUnder('src/core', ['.ts']), /\b(status|state|phase|mode|kind|step)\??:\s*string\b/));
