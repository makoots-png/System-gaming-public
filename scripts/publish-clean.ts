// publish-clean.ts: makes the copy of this repository that may be public. `bun scripts/publish-clean.ts <out dir>`
// writes the tree at HEAD into <out dir> with no history, without `.private/`, and with every rule of
// `.private/scrub-terms.tsv` applied to file contents and to file names (the owner's name, email and other personal
// words). It then reads the result back and fails if any rule still matches anywhere, so a copy that is written is
// clean by check, not by hope. It pushes nothing: the caller commits and pushes the folder.
import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const out = process.argv[2];
if (!out) { console.error('usage: bun scripts/publish-clean.ts <out dir>'); process.exit(2); }

type Rule = { readonly find: RegExp; readonly to: string };
const rules: Rule[] = readFileSync('.private/scrub-terms.tsv', 'utf8').split('\n')
  .filter(l => l.trim() !== '' && !l.startsWith('#'))
  .map(l => { const [find, to = ''] = l.split('\t'); return { find: new RegExp(find!, 'g'), to }; });

/** The text with every rule applied, and "the owner" capitalized where it now starts a sentence, a line or a list item. */
const scrubbed = (text: string): string => rules.reduce((t, r) => t.replace(r.find, r.to), text)
  .replace(/(^|[.!?]["')]?\s+|\n[ \t]*(?:[-*]|\d+\.)[ \t]+|\n[ \t]*\|[ \t]*|\n#+[ \t]+)the owner/g, (_, lead: string) => `${lead}The owner`);

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const tar = Bun.spawnSync(['sh', '-c', `git archive HEAD | tar -x -C "${out}"`]);
if (tar.exitCode !== 0) { console.error('git archive failed'); process.exit(1); }
rmSync(join(out, '.private'), { recursive: true, force: true });

const files = (dir: string): string[] => readdirSync(dir).flatMap(n => { const p = join(dir, n); return statSync(p).isDirectory() ? files(p) : [p]; });
/** A file is text when it holds no zero byte. */
const isText = (buf: Uint8Array): boolean => !buf.subarray(0, 8000).includes(0);

let changed = 0, renamed = 0;
for (const path of files(out)) {
  const rel = path.slice(out.length + 1), to = join(out, scrubbed(rel));
  const buf = readFileSync(path);
  if (isText(buf)) {
    const text = buf.toString('utf8'), next = scrubbed(text);
    if (next !== text) { writeFileSync(path, next); changed++; }
  }
  if (to !== path) { mkdirSync(dirname(to), { recursive: true }); renameSync(path, to); renamed++; }
}

// the check: nothing any rule finds may be left, in a text or in a name
const left: string[] = [];
for (const path of files(out)) {
  const rel = path.slice(out.length + 1), buf = readFileSync(path);
  for (const r of rules) {
    r.find.lastIndex = 0;
    if (r.find.test(rel)) left.push(`${rel}: its name`);
    r.find.lastIndex = 0;
    if (isText(buf) && r.find.test(buf.toString('utf8'))) left.push(`${rel}: its text`);
  }
}
if (left.length) { console.error(`publish-clean: ${left.length} places still match a rule:\n${left.slice(0, 20).join('\n')}`); process.exit(1); }
console.log(`publish-clean: ${files(out).length} files written to ${out}; ${changed} texts changed, ${renamed} files renamed; no rule matches what was written.`);
