// lessons.ts: lessons that live as a comment, not as a check. Principle: encode-lessons-in-structure ("if the fix is
// structural, only use the structural fix; the instruction is the symptom").
//
//   bun docs/audit/arch-check/lessons.ts
//
// 1. Each audit finding a comment in src/ or server.ts cites, and whether any file of tests/ names the same finding.
//    One no test names is a lesson kept only in words: the next writer may not read the comment.
// 2. The lint that holds "found by its id" covers only lists named hunters, monsters, rows, remotes() and list(): the
//    by-name hits of by-name.ts on other lists are the same lesson with no check.

import { readdirSync } from 'node:fs';
import { ROOT, SOURCES, text } from './lib.ts';

const ID = /\b((?:BUG|SM|AW)-[a-z]+-\d+|implicit audit \d+, [A-Z]\d+)/g;
const testText = readdirSync(`${ROOT}/tests`).filter(f => f.endsWith('.ts')).map(f => text(`tests/${f}`)).join('\n');
const cited = new Map<string, string[]>();
for (const f of SOURCES()) text(f).split('\n').forEach((l, i) => { for (const m of l.matchAll(ID)) cited.set(m[1]!, [...(cited.get(m[1]!) ?? []), `${f}:${i + 1}`]); });
console.log('\n## 1. Audit findings cited in source, and whether a test names them');
let bare = 0;
for (const [id, at] of [...cited].sort()) {
  const short = id.replace(/^implicit audit (\d+), /, 'audit $1 ');
  const named = testText.includes(id) || testText.includes(short);
  if (!named) bare++;
  console.log(`${named ? 'test names it ' : 'NO TEST NAMES '} ${id}  ${at.join(', ')}`);
}
console.log(`${bare} of ${cited.size} cited findings are named by no test (a test may still hold the rule without its ID)`);

console.log('\n## 2. The lists the "found by its id" lint covers');
const lint = text('tests/lint.test.ts');
console.log(lint.match(/const byName = (\/\\b\(\?:hunters.*);/)?.[1] ?? 'not found');
console.log('Run by-name.ts for the hits on other lists (skills, items, shop, titles, zones).');
