// legacy.ts: code kept so an older save, room or caller still works. Principles: migrate-callers-then-delete-legacy-apis
// and subtract-before-you-add. The owner's rule: old saves and rooms need not work, except that a player's hunters cross
// a save format change through the one-way migration at load. Anything else that reads an old shape is a layer to cut.
//
//   bun docs/audit/arch-check/legacy.ts
//
// 1. Comments that say a shape is old (a build before, an older save, kept for, legacy, no longer, was stored).
// 2. Exports of src/ that no other file of src/, server.ts, scripts/ or tests/ names (dead, or alive only in tests).

import { readdirSync } from 'node:fs';
import { ROOT, SOURCES, filesUnder, grep, report, text } from './lib.ts';

report('1. Comments about an old shape', grep(SOURCES(), /\/[/*].*\b(builds? before|from before|older (save|build|room)|old saves?|old rooms?|legacy|kept for|no longer|was stored|deprecated|compat)/i), 200);

console.log('\n## 2. Exports no other file names');
const src = SOURCES();
const all = [...src, ...filesUnder('scripts'), ...readdirSync(`${ROOT}/tests`).filter(f => f.endsWith('.ts')).map(f => `tests/${f}`), ...filesUnder('tests/e2e')];
const texts = new Map(all.map(f => [f, text(f)]));
const dead: string[] = [], local: string[] = [], testOnly: string[] = [];
for (const f of src) {
  const own = texts.get(f)!;
  for (const m of own.matchAll(/^export (?:async )?(?:const|function|let|class) (\w+)/gm)) {
    const name = m[1]!, re = new RegExp(`\\b${name}\\b`);
    const users = all.filter(o => o !== f && re.test(texts.get(o)!));
    const ownUses = (own.match(new RegExp(`\\b${name}\\b`, 'g')) ?? []).length - 1;
    if (users.length === 0) (ownUses > 0 ? local : dead).push(`${f}  ${name}`);
    else if (users.every(u => u.startsWith('tests/'))) testOnly.push(`${f}  ${name}  (${users.length} tests)`);
  }
}
console.log(`used nowhere, not even in its own file (${dead.length}):`); for (const d of dead) console.log(`  ${d}`);
console.log(`exported but used only in its own file (${local.length}): ${local.map(d => d.split('  ')[1]).join(', ')}`);
console.log(`only tests (${testOnly.length}):`); for (const d of testOnly) console.log(`  ${d}`);
