// lib.ts: the shared part of the architecture checks in this folder. Each check reads `src/` and `server.ts` as text,
// line by line, and prints `file:line  text` for each hit. Nothing here changes a file.
//
//   bun docs/audit/arch-check/<check>.ts          print the hits of one check
//   bash docs/audit/arch-check/run-all.sh          every check, one after another

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

export const ROOT = join(import.meta.dir, '..', '..', '..');

/** Every source file under `dir` (relative to the repo root), recursively. */
export function filesUnder(dir: string, exts: readonly string[] = ['.ts', '.js']): string[] {
  const out: string[] = [];
  const walk = (rel: string): void => {
    for (const name of readdirSync(join(ROOT, rel)).sort()) {
      const p = `${rel}/${name}`;
      if (statSync(join(ROOT, p)).isDirectory()) walk(p);
      else if (exts.some(e => name.endsWith(e))) out.push(p);
    }
  };
  walk(dir);
  return out;
}

/** The files every check reads: all of `src/` and `server.ts`. */
export const SOURCES = (): string[] => [...filesUnder('src'), 'server.ts'];

export const lines = (file: string): string[] => readFileSync(join(ROOT, file), 'utf8').split('\n');
export const text = (file: string): string => readFileSync(join(ROOT, file), 'utf8');

/** Each line of `files` that matches `re`, with its 1-based line number. */
export function grep(files: readonly string[], re: RegExp): { file: string; line: number; text: string }[] {
  const out: { file: string; line: number; text: string }[] = [];
  for (const file of files) lines(file).forEach((t, i) => { if (re.test(t)) out.push({ file, line: i + 1, text: t.trim() }); });
  return out;
}

/** Prints a heading and each hit, cut to `width` characters, then the count. */
export function report(title: string, hits: readonly { file: string; line: number; text: string; why?: string }[], width = 170): void {
  console.log(`\n## ${title} (${hits.length})`);
  for (const h of hits) console.log(`${h.file}:${h.line}  ${h.why ? `[${h.why}] ` : ''}${h.text.slice(0, width)}`);
}
