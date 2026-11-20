// shared-docs.ts: the room's documents, who writes each, and who reads each. Principle: separate-before-serializing-
// shared-state ("do these actors need one canonical object?").
//
//   bun docs/audit/arch-check/shared-docs.ts
//
// A room doc is one key the server keeps whole: the last put wins. A doc is safe when one phone writes it. Every GM
// phone of a room publishes its own copy (src/edge/sync.ts publishNow puts it whenever it differs from the room's), so
// a doc with no merge on a GM phone flips between two GM phones' copies. The check prints, per doc, its publisher and
// each place that reads it, so a reader sees which docs a second GM phone merges (only `world`, gates.js mergeWorld).
// Also: device memory keys (store.device) named by more than one file.

import { SOURCES, grep, report, text } from './lib.ts';

const table = text('src/core/protocol.ts').match(/type Docs = \{([^}]*)\}/)?.[1] ?? '';
const names = [...table.matchAll(/(\w+):/g)].map(m => m[1]!);
for (const n of names) {
  const pub = grep(SOURCES(), new RegExp(`publish\\('${n}'`));
  const reads = grep(SOURCES(), new RegExp(`doc\\('${n}'\\)|docs\\.${n}\\b|docs\\[['"]${n}['"]\\]`));
  report(`doc '${n}': published by ${pub.map(p => `${p.file}:${p.line}`).join(', ') || 'no publish call (written another way)'}; read at`, reads, 140);
}

console.log('\n## Device memory keys named by more than one file');
const keys = new Map<string, Set<string>>();
for (const f of SOURCES()) for (const m of text(f).matchAll(/\.device\('([^']+)'/g)) keys.set(m[1]!, (keys.get(m[1]!) ?? new Set()).add(f));
const shared = [...keys].filter(([, fs]) => fs.size > 1);
console.log(shared.length ? shared.map(([k, fs]) => `${k}: ${[...fs].join(', ')}`).join('\n') : 'none');
