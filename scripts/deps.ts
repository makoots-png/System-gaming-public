// The dependency map: who imports whom, who calls which `app.api` member, who emits and who hears each event, and
// which save keys each module changes. It reads `src/` and `server.ts` as text with regular expressions over the
// patterns this codebase uses (listed in docs/agent-handoff/p3/notes-deps.md). What the patterns cannot follow goes
// in the Unresolved list with its file and line; nothing is guessed.
//
//   bun scripts/deps.ts              print the whole map as Markdown
//   bun scripts/deps.ts <name>       one entry, both directions: a file, an API name, `name.member`, or an event
//   bun scripts/deps.ts --write      write docs/dependency-map.md
//   bun scripts/deps.ts --check      exit 1 when docs/dependency-map.md is not what --write would write

import { readdir } from 'node:fs/promises';

const ROOT = import.meta.dir + '/..';
export const MAP_FILE = 'docs/dependency-map.md';

export type Loc = { file: string; line: number };
export type Layer = 'core' | 'edge' | 'views' | 'entry' | 'server';
export type Use = Loc & { api: string; member: string | null };
export type Unresolved = Loc & { what: string };
export type Module = {
  file: string; layer: Layer;
  imports: string[]; importedBy: string[];
  provides: string[]; uses: Use[];
  emits: Loc[]; listens: Loc[]; emitNames: string[]; listenNames: string[];
  writes: string[]; unreadUpdates: number;
};
/** A screen or a panel a module registers with `app.registerView` or `app.registerPanel`. A view's `view` is null. */
export type Screen = { id: string; view: string | null; at: Loc };
export type Api = { name: string; at: Loc[]; members: Map<string, Loc>; uses: Use[] };
export type Event = { name: string; emitters: Loc[]; listeners: Loc[] };
/** One entry of a type literal read from the source: a key, its type as written, and its doc comment. */
export type Entry = { name: string; type: string; doc: string; at: Loc };
export type DepsMap = {
  modules: Map<string, Module>; apis: Map<string, Api>; events: Map<string, Event>; unresolved: Unresolved[];
  /** `AppEvents` in src/core/events.ts: each event name the app may use, with its payload type. */
  eventTable: Map<string, Entry>;
  /** `AppApi` in src/core/api.ts: each API name, the type it names, and that type's members with their signatures. */
  apiTable: Map<string, { type: string; members: Map<string, Entry> }>;
  /** Every view and panel registered, in file order. */
  views: Screen[]; panels: Screen[];
};
export const EVENTS_FILE = 'src/core/events.ts';
export const API_FILE = 'src/core/api.ts';

// ── reading the source ──

/** The text with comments blanked (`code`), and a copy with string, template and regex text blanked too (`skel`), for
 * matching brackets. Both keep every offset and newline of the source. */
export function lex(text: string): { code: string; skel: string } {
  const code = text.split(''), skel = text.split('');
  const blank = (from: number, to: number, both: boolean): void => {
    for (let k = from; k < to; k++) if (text[k] !== '\n') { skel[k] = ' '; if (both) code[k] = ' '; }
  };
  const tmpl: number[] = []; // brace depth at each open `${`
  let depth = 0, i = 0, inTmpl = false;
  const regexAhead = (at: number): boolean => {
    let j = at - 1; while (j >= 0 && /\s/.test(code[j]!)) j--;
    if (j < 0) return true;
    const c = code[j]!;
    if ('(,=:[!&|?{};+-*%<>~^'.includes(c)) return true;
    if (!/[\w$]/.test(c)) return false;
    let k = j; while (k >= 0 && /[\w$]/.test(code[k]!)) k--;
    return ['return', 'typeof', 'case', 'do', 'else', 'in', 'of', 'void', 'yield', 'await'].includes(code.slice(k + 1, j + 1).join(''));
  };
  while (i < text.length) {
    const c = text[i]!;
    if (inTmpl) {
      if (c === '\\') { blank(i, i + 2, false); i += 2; continue; }
      if (c === '`') { inTmpl = false; i++; continue; }
      if (c === '$' && text[i + 1] === '{') { tmpl.push(depth); depth++; inTmpl = false; i += 2; continue; }
      blank(i, i + 1, false); i++; continue;
    }
    if (c === '/' && text[i + 1] === '/') { const end = text.indexOf('\n', i); const to = end < 0 ? text.length : end; blank(i, to, true); i = to; continue; }
    if (c === '/' && text[i + 1] === '*') { const end = text.indexOf('*/', i + 2); const to = end < 0 ? text.length : end + 2; blank(i, to, true); i = to; continue; }
    if (c === '\'' || c === '"') {
      let j = i + 1; while (j < text.length && text[j] !== c && text[j] !== '\n') j += text[j] === '\\' ? 2 : 1;
      blank(i + 1, j, false); i = j + 1; continue;
    }
    if (c === '`') { inTmpl = true; i++; continue; }
    if (c === '/' && regexAhead(i)) {
      let j = i + 1, cls = false;
      while (j < text.length && text[j] !== '\n' && (cls || text[j] !== '/')) { if (text[j] === '\\') j++; else if (text[j] === '[') cls = true; else if (text[j] === ']') cls = false; j++; }
      blank(i + 1, j, false); i = j + 1; continue;
    }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (tmpl.length && tmpl[tmpl.length - 1] === depth) { tmpl.pop(); inTmpl = true; } }
    i++;
  }
  return { code: code.join(''), skel: skel.join('') };
}

/** The 1-based line of each offset in a text. */
function liner(text: string): (at: number) => number {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') starts.push(i + 1);
  return at => { let lo = 0, hi = starts.length - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (starts[mid]! <= at) lo = mid; else hi = mid - 1; } return lo + 1; };
}

/** The span of the innermost `{ ... }` block around an offset, or the whole text. */
function blockOf(skel: string, offset: number): [number, number] {
  let depth = 0;
  for (let i = offset - 1; i >= 0; i--) {
    const c = skel[i]!;
    if (c === '}') depth++;
    else if (c === '{') { if (depth === 0) return [i, closing(skel, i) + 1]; depth--; }
  }
  return [0, skel.length];
}

/** The offset of the bracket that closes the one at `open`, in a skeleton. */
function closing(skel: string, open: number): number {
  let depth = 0;
  for (let i = open; i < skel.length; i++) {
    const c = skel[i]!;
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') { depth--; if (depth === 0) return i; }
  }
  return skel.length;
}

async function sourceFiles(): Promise<string[]> {
  const names = (await readdir(`${ROOT}/src`, { recursive: true })).filter(name => /\.(ts|js)$/.test(name)).map(name => `src/${name}`);
  return [...names, 'server.ts'].sort();
}

function layerOf(file: string): Layer {
  if (file.startsWith('src/core/')) return 'core';
  if (file.startsWith('src/edge/')) return 'edge';
  if (file.startsWith('src/views/')) return 'views';
  if (file.startsWith('src/')) return 'entry';
  return 'server';
}

/** `a/b/../c.ts` to `a/c.ts`. */
function normalize(path: string): string {
  const out: string[] = [];
  for (const part of path.split('/')) { if (part === '..') out.pop(); else if (part !== '.' && part !== '') out.push(part); }
  return out.join('/');
}

// ── one file ──

const ID = String.raw`[A-Za-z_$][\w$]*`;
const CHAIN = String.raw`((?:\s*[?!]?\.\s*${ID})*)`;
const names = (chain: string): string[] => chain.match(new RegExp(ID, 'g')) ?? [];
const quote = (name: string): string => name.replace(/\$/g, '\\$');

/** What a name in a file stands for: the app object, the `app.api` bag, or one module's API. `fn` when it is a
 * function that answers that (`A = () => app.api`). */
type Alias = { kind: 'app' | 'api' | `api:${string}`; fn: boolean };
type Ref = { api: string | null; member: string | null; rest: string[] };

/** Where a member chain off an alias lands: `app` + `.api.combat.add` is the API `combat`, member `add`. */
function landing(alias: Alias, chain: string[]): Ref | null {
  let parts = chain;
  if (alias.kind === 'app') { if (parts[0] !== 'api') return null; parts = parts.slice(1); }
  if (alias.kind.startsWith('api:')) return { api: alias.kind.slice(4), member: parts[0] ?? null, rest: parts.slice(1) };
  return { api: parts[0] ?? null, member: parts[1] ?? null, rest: parts.slice(2) };
}

export type Scan = {
  imports: string[]; provides: { api: string; member: string | null; at: Loc }[]; uses: Use[];
  emits: { name: string; at: Loc }[]; listens: { name: string; at: Loc }[];
  writes: string[]; unreadUpdates: number; unresolved: Unresolved[];
  views: Screen[]; panels: Screen[];
};

export function scanFile(file: string, text: string): Scan {
  const { code, skel } = lex(text), lineOf = liner(text);
  const at = (offset: number): Loc => ({ file, line: lineOf(offset) });
  const out: Scan = { imports: [], provides: [], uses: [], emits: [], listens: [], writes: [], unreadUpdates: 0, unresolved: [], views: [], panels: [] };
  const unresolved = (offset: number, what: string): void => {
    const u = { ...at(offset), what };
    if (!out.unresolved.some(x => x.line === u.line && x.what === what)) out.unresolved.push(u);
  };
  const inCode = (offset: number): boolean => skel[offset] !== ' '; // not inside a string, a template's text or a regex

  // imports, static and dynamic, relative only
  const dir = file.includes('/') ? file.slice(0, file.lastIndexOf('/')) : '';
  for (const m of code.matchAll(/\b(?:import|export)\s+(?:type\s+)?(?:[^'";]*?\bfrom\s*)?['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) {
    const path = m[1] ?? m[2]!;
    if (path.startsWith('.')) out.imports.push(normalize(`${dir}/${path}`));
  }

  // aliases: `X = app.api`, `X = () => app.api.sync`, `X = Y()`, `X = A().sync || {}`, `X = app.api.hunter!`, and so on, to a fixed point.
  // A declared alias holds in the block it is declared in; an assignment without const/let (`A = app` in forge.js)
  // holds in the whole file. `app` holds everywhere.
  type Scoped = Alias & { from: number; to: number };
  const aliases = new Map<string, Scoped[]>([['app', [{ kind: 'app', fn: false, from: 0, to: code.length }]]]);
  const aliasAt = (name: string, offset: number): Scoped | undefined => aliases.get(name)?.find(s => s.from <= offset && offset < s.to);
  const decl = new RegExp(String.raw`(?<![\w$])(?<![^.]\.)(${ID})\s*=(?![=>])\s*(\(\)\s*=>\s*)?(${ID})(\(\))?${CHAIN}(?=!?\s*(?:(?:\|\||\?\?)\s*(?:\{\s*\}|null|undefined)\s*)?[;,)\n]|\s*=(?![=>]))`, 'g');
  for (let round = 0, grew = true; grew && round < 6; round++) {
    grew = false;
    for (const m of code.matchAll(decl)) {
      const [, name, arrow, base, call, chain] = m as unknown as [string, string, string | undefined, string, string | undefined, string];
      const from = aliasAt(base, m.index!);
      if (!from || name === 'app' || from.fn !== !!call || !inCode(m.index!)) continue;
      const ref = landing(from, names(chain));
      if (names(chain).length && (!ref || ref.member)) continue;
      const kind: Alias['kind'] = !names(chain).length ? from.kind : ref!.api ? `api:${ref!.api}` : 'api';
      const declared = /(?:\b(?:const|let|var)\s+|,\s*)$/.test(code.slice(Math.max(0, m.index! - 8), m.index!));
      const [lo, hi] = declared ? blockOf(skel, m.index!) : [0, code.length];
      const had = aliases.get(name) ?? [];
      if (had.some(s => s.from === lo && s.to === hi)) continue;
      aliases.set(name, [...had, { kind, fn: !!arrow, from: lo, to: hi }].sort((a, b) => (b.from - a.from) || (a.to - b.to))); // innermost first
      grew = true;
    }
  }

  // every chain off an alias: a registration (`... = {`), a use, a computed name, or an API handed out whole
  const refRe = new RegExp(String.raw`(?<![\w$])(?<![^.]\.)(${[...aliases.keys()].map(quote).join('|')})(?![\w$])(\(\))?${CHAIN}`, 'g');
  for (const m of code.matchAll(refRe)) {
    const [whole, base, call, chain] = m as unknown as [string, string, string | undefined, string];
    const alias = aliasAt(base, m.index!);
    if (!alias || alias.fn !== !!call || !inCode(m.index!)) continue;
    const ref = landing(alias, names(chain)), end = m.index! + whole.length;
    if (!ref) continue;
    const after = code.slice(end).match(/^\s*(\S)(\S)?/), next = after?.[1] ?? '', next2 = after?.[2] ?? '';
    if (!chain && !call && next === '=' && next2 !== '=') continue; // the alias itself being declared
    if (!chain && next === '(') continue; // a function of the same name, called
    const dotted = `${base}${call ?? ''}${chain.replace(/\s+/g, '')}`;
    if (next === '[' && (!ref.api || !ref.member)) { unresolved(m.index!, `\`${dotted}[...]\`: an API ${ref.api ? 'member' : 'name'} computed at run time`); continue; }
    if (!ref.api) continue;
    if (next === '=' && next2 !== '=' && next2 !== '>' && !ref.rest.length) {
      const eq = code.indexOf('=', end), open = eq + 1 + code.slice(eq + 1).search(/\S/);
      if (ref.member) { out.provides.push({ api: ref.api, member: ref.member, at: at(m.index!) }); continue; }
      if (code[open] !== '{') { unresolved(m.index!, `\`${dotted}\` is set to something other than an object literal; its members are not read`); continue; }
      out.provides.push({ api: ref.api, member: null, at: at(m.index!) });
      for (const key of keysOf(code, skel, open)) {
        if (key.name) out.provides.push({ api: ref.api, member: key.name, at: at(key.offset) });
        else unresolved(key.offset, `a member of \`app.api.${ref.api}\` whose name is not written out (\`${key.text}\`)`);
      }
      continue;
    }
    if (!ref.member && /\breturn\s*$/.test(code.slice(Math.max(0, m.index! - 12), m.index!)) && /^\s*!?\s*[;}]/.test(code.slice(end))) {
      unresolved(m.index!, `\`${dotted}\` is handed out whole; calls made through it elsewhere are not traced`);
    }
    out.uses.push({ ...at(m.index!), api: ref.api, member: ref.member });
  }

  // events: app.emit / app.on with a literal name, or a loop over a literal list on the same line
  const appNames = [...aliases].filter(([, ss]) => ss.some(a => a.kind === 'app' && !a.fn)).map(([n]) => quote(n)).join('|');
  for (const m of code.matchAll(new RegExp(String.raw`(?<![\w$])(?<![^.]\.)(${appNames})(?![\w$])\s*\.\s*(emit|on)\s*\(\s*`, 'g'))) {
    const app = aliasAt(m[1]!, m.index!);
    if (!inCode(m.index!) || app?.kind !== 'app' || app.fn) continue;
    const kind = m[2] as 'emit' | 'on', rest = code.slice(m.index! + m[0].length);
    const list = kind === 'emit' ? out.emits : out.listens;
    const lit = rest.match(/^(['"`])([^'"`$\n]*)\1/);
    if (lit) { list.push({ name: lit[2]!, at: at(m.index!) }); continue; }
    const v = rest.match(new RegExp(String.raw`^(${ID})\s*[,)]`))?.[1];
    const line = code.slice(code.lastIndexOf('\n', m.index!) + 1, m.index!);
    const loop = v ? line.match(new RegExp(String.raw`for\s*\(\s*(?:const|let|var)\s+${quote(v)}\s+of\s+\[([^\]]*)\]\s*\)`)) : null;
    const items = loop ? loop[1]!.split(',').map(s => s.trim()).filter(Boolean) : [];
    if (items.length && items.every(s => /^(['"])[^'"]*\1$/.test(s))) { for (const s of items) list.push({ name: s.slice(1, -1), at: at(m.index!) }); continue; }
    unresolved(m.index!, `\`app.${kind}(${rest.split(/[,)]/)[0]!.trim().slice(0, 40)}, ...)\`: an event name computed at run time`);
  }

  // save keys a store.update callback reaches through its save argument
  const writes = new Set<string>();
  for (const m of code.matchAll(/\bstore\s*(?:\(\s*\))?\s*\.\s*update\s*\(/g)) {
    if (!inCode(m.index!)) continue;
    const open = m.index! + m[0].length - 1, body = code.slice(open + 1, closing(skel, open));
    const param = body.match(new RegExp(String.raw`^\s*(?:async\s*)?(?:\(\s*(${ID})?\s*\)|(${ID}))\s*=>`));
    const p = param?.[1] ?? param?.[2];
    const keys = p ? [...body.matchAll(new RegExp(String.raw`(?<![\w$])(?<![^.]\.)${quote(p)}\s*[?!]?\.\s*(${ID})(?:\s*[?!]?\.\s*(${ID}))?`, 'g'))]
      .map(k => (k[1] === 'settings' && k[2] ? `settings.${k[2]}` : k[1]!)) : [];
    if (keys.length) for (const k of keys) writes.add(k); else out.unreadUpdates++;
  }
  out.writes = [...writes].sort();

  // views and panels: `.registerView({ id: '...' })`, `.registerPanel({ id: '...', view: '...' })`
  for (const m of code.matchAll(/\.\s*(registerView|registerPanel)\s*\(\s*\{/g)) {
    if (!inCode(m.index!)) continue;
    const open = m.index! + m[0].length - 1, panel = m[1] === 'registerPanel', lit: Record<string, string> = {};
    for (const key of keysOf(code, skel, open)) {
      const v = key.name === 'id' || key.name === 'view' ? code.slice(key.offset).match(/^\w+\s*:\s*(['"])([^'"\n]*)\1/) : null;
      if (v) lit[key.name!] = v[2]!;
    }
    if (!lit.id || (panel && !lit.view)) { unresolved(m.index!, `\`${m[1]}\` with an id${panel ? ' or a view' : ''} that is not a literal`); continue; }
    (panel ? out.panels : out.views).push({ id: lit.id, view: panel ? lit.view! : null, at: at(m.index!) });
  }
  return out;
}

/** The members of the object literal that opens at `open`: a name for each one written out, null for a spread or a
 * computed key. */
function keysOf(code: string, skel: string, open: number): { name: string | null; offset: number; text: string }[] {
  const close = closing(skel, open), keys: { name: string | null; offset: number; text: string }[] = [];
  const take = (from: number, to: number): void => {
    const lead = code.slice(from, to).search(/\S/); if (lead < 0) return;
    const offset = from + lead, text = code.slice(offset, to).trim();
    const m = text.match(new RegExp(String.raw`^(?:async\s+)?(?:(?:get|set)\s+(?=${ID}\s*\())?\*?\s*(${ID})\s*(?:[(:]|$)`)) ?? text.match(/^(['"])([^'"]+)\1\s*:/);
    keys.push({ name: m ? m[m.length - 1]! : null, offset, text: text.slice(0, 30) });
  };
  let start = open + 1, depth = 0;
  for (let i = open + 1; i < close; i++) {
    const c = skel[i]!;
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') depth--;
    else if (c === ',' && depth === 0) { take(start, i); start = i + 1; }
  }
  take(start, close);
  return keys;
}

// ── typed tables ──

/** The entries of `export type <name> = { ... }` (or `export interface <name> { ... }`) in a file, or null when the
 * file has no such type. An entry whose key cannot be read goes to `unresolved`. */
export function readTypeTable(file: string, text: string, name: string, unresolved: Unresolved[]): Map<string, Entry> | null {
  const { code, skel } = lex(text), lineOf = liner(text);
  const head = code.match(new RegExp(String.raw`\bexport\s+(?:type\s+${quote(name)}\s*=|interface\s+${quote(name)}(?:\s+extends[^{]*)?)\s*\{`));
  if (!head) return null;
  const open = head.index! + head[0].length - 1, close = closing(skel, open), out = new Map<string, Entry>();
  const take = (from: number, to: number): void => {
    const lead = code.slice(from, to).search(/\S/); if (lead < 0) return;
    const at = from + lead, src = code.slice(at, to);
    const m = src.match(new RegExp(String.raw`^(?:readonly\s+)?(?:'([^']+)'|"([^"]+)"|(${ID}))\s*(\??)\s*([:(<])`));
    if (!m) { unresolved.push({ file, line: lineOf(at), what: `an entry of \`${name}\` whose name is not written out (\`${src.trim().slice(0, 30)}\`)` }); return; }
    const key = m[1] ?? m[2] ?? m[3]!, rest = code.slice(at + m[0].length - 1, to).replace(/\s+/g, ' ').trim();
    const type = m[5] === ':' ? rest.slice(1).trim() : rest; // a method keeps its parameter list: `(id: string): X`
    const docs = [...text.slice(from, at).matchAll(/\/\*\*([\s\S]*?)\*\//g)];
    const doc = docs.length ? docs[docs.length - 1]![1]!.replace(/^\s*\*\s?/gm, '').replace(/\s+/g, ' ').trim() : '';
    out.set(key, { name: key, type: m[4] ? `${type} (optional)` : type, doc, at: { file, line: lineOf(at) } });
  };
  let start = open + 1, depth = 0;
  for (let i = open + 1; i < close; i++) {
    const c = skel[i]!;
    if (c === '(' || c === '[' || c === '{' || c === '<') depth++;
    else if (c === ')' || c === ']' || c === '}' || (c === '>' && skel[i - 1] !== '=')) depth--;
    else if ((c === ';' || c === ',') && depth === 0) { take(start, i); start = i + 1; }
  }
  take(start, close);
  return out;
}

// ── the whole map ──

const byLoc = (a: Loc, b: Loc): number => (a.file < b.file ? -1 : a.file > b.file ? 1 : a.line - b.line);
const uniq = (xs: string[]): string[] => [...new Set(xs)].sort();
export const filesOf = (locs: Loc[]): string[] => uniq(locs.map(l => l.file));

export function assemble(scans: Map<string, Scan>): DepsMap {
  const modules = new Map<string, Module>(), apis = new Map<string, Api>(), events = new Map<string, Event>(), unresolved: Unresolved[] = [];
  const views: Screen[] = [], panels: Screen[] = [];
  const api = (name: string): Api => { let a = apis.get(name); if (!a) apis.set(name, a = { name, at: [], members: new Map(), uses: [] }); return a; };
  const event = (name: string): Event => { let e = events.get(name); if (!e) events.set(name, e = { name, emitters: [], listeners: [] }); return e; };
  for (const [file, s] of [...scans].sort(([a], [b]) => (a < b ? -1 : 1))) {
    modules.set(file, {
      file, layer: layerOf(file), imports: uniq(s.imports), importedBy: [],
      provides: uniq(s.provides.map(p => p.api)), uses: s.uses,
      emits: s.emits.map(e => e.at), listens: s.listens.map(e => e.at),
      emitNames: uniq(s.emits.map(e => e.name)), listenNames: uniq(s.listens.map(e => e.name)),
      writes: s.writes, unreadUpdates: s.unreadUpdates,
    });
    for (const p of s.provides) { const a = api(p.api); if (p.member === null) a.at.push(p.at); else if (!a.members.has(p.member)) a.members.set(p.member, p.at); }
    for (const u of s.uses) api(u.api).uses.push(u);
    for (const e of s.emits) event(e.name).emitters.push(e.at);
    for (const e of s.listens) event(e.name).listeners.push(e.at);
    unresolved.push(...s.unresolved);
    views.push(...s.views); panels.push(...s.panels);
  }
  for (const m of modules.values()) for (const target of m.imports) modules.get(target)?.importedBy.push(m.file);
  for (const m of modules.values()) m.importedBy.sort();
  unresolved.sort(byLoc);
  return { modules, apis: new Map([...apis].sort(([a], [b]) => (a < b ? -1 : 1))), events: new Map([...events].sort(([a], [b]) => (a < b ? -1 : 1))), unresolved, eventTable: new Map(), apiTable: new Map(), views, panels };
}

export async function buildMap(): Promise<DepsMap> {
  const scans = new Map<string, Scan>(), texts = new Map<string, string>();
  for (const file of await sourceFiles()) { const text = await Bun.file(`${ROOT}/${file}`).text(); texts.set(file, text); scans.set(file, scanFile(file, text)); }
  const map = assemble(scans);
  map.eventTable = readTypeTable(EVENTS_FILE, texts.get(EVENTS_FILE) ?? '', 'AppEvents', map.unresolved) ?? new Map();
  const apiText = texts.get(API_FILE) ?? '';
  for (const [name, row] of readTypeTable(API_FILE, apiText, 'AppApi', map.unresolved) ?? []) {
    const members = /^[A-Za-z_$][\w$]*$/.test(row.type) ? readTypeTable(API_FILE, apiText, row.type, map.unresolved) : null;
    if (!members) { map.unresolved.push({ ...row.at, what: `\`AppApi\` names \`${row.type}\` for \`${name}\`, which is not a type literal declared in ${API_FILE}` }); continue; }
    map.apiTable.set(name, { type: row.type, members });
  }
  map.unresolved.sort(byLoc);
  return map;
}

/** The module that registers an API, or the files, when it is registered twice or never. */
export const ownerOf = (a: Api): string => filesOf(a.at).join(', ') || 'nobody (never registered)';
/** The members of an API that some module uses, with the files that use each; a member nobody registers included. */
export function memberUsers(a: Api): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const name of a.members.keys()) out.set(name, []);
  for (const u of a.uses) if (u.member !== null) out.set(u.member, [...(out.get(u.member) ?? []), u.file]);
  return new Map([...out].sort(([x], [y]) => (x < y ? -1 : 1)).map(([k, v]) => [k, uniq(v)]));
}

// ── Markdown ──

const tick = (s: string): string => `\`${s}\``;
const list = (xs: string[]): string => xs.map(tick).join(', ');
const IMPORT_RULE: Record<Layer, { rule: string; may: string[] }> = {
  core: { rule: 'Imports only from `src/core`. No DOM, storage, network or module-level `let` (`tests/lint.test.ts`).', may: ['core'] },
  edge: { rule: 'Imports from `src/core` and `src/edge`. Holds the store, the room link and the rules views read.', may: ['core', 'edge'] },
  views: { rule: 'Imports from `src/core`, `src/edge` and `src/views`. Reaches what another view registers through `app.api` and events.', may: ['core', 'edge', 'views'] },
  entry: { rule: '`src/app.js` imports every module it lists in `MODULES` and passes each the `app` object. `src/sw.js` stands alone.', may: ['core', 'edge', 'views', 'entry'] },
  server: { rule: '`server.ts` imports `src/core` and `scripts/`, never `src/edge` or `src/views`.', may: ['core', 'other'] },
};
const targetLayer = (path: string): string => (path.startsWith('src/') ? layerOf(path) : 'other');

export function renderMap(map: DepsMap): string {
  const mods = [...map.modules.values()], apis = [...map.apis.values()], events = [...map.events.values()];
  const members = apis.reduce((n, a) => n + a.members.size, 0);
  const out: string[] = [
    '# Dependency map',
    '',
    'Generated by `scripts/deps.ts` from the text of `src/` and `server.ts`. Do not edit it by hand. After a change to a module\'s imports, its `app.api` or its events, run `bun run deps -- --write`. `tests/deps.test.ts` fails while this file is out of date.',
    '',
    'For one entry with line numbers and both directions, run `bun run deps -- <name>`. The name is a file (`gates.js`, `src/views/gates.js`), an API (`combat`), an API member (`combat.add`) or an event (`combat:turn`).',
    '',
    `${mods.length} modules, ${apis.length} \`app.api\` names with ${members} members, ${events.length} events, ${map.unresolved.length} unresolved.`,
    '',
    '## Layers',
    '',
    '| Layer | Files | Import rule | Imports that break it |',
    '|---|---|---|---|',
  ];
  for (const layer of ['core', 'edge', 'views', 'entry', 'server'] as const) {
    const inLayer = mods.filter(m => m.layer === layer);
    const breaks = inLayer.flatMap(m => m.imports.filter(t => !IMPORT_RULE[layer].may.includes(targetLayer(t))).map(t => `${m.file} imports ${t}`));
    out.push(`| ${layer} | ${inLayer.length} | ${IMPORT_RULE[layer].rule} | ${breaks.length ? list(breaks) : 'none'} |`);
  }

  out.push('', '## Modules', '');
  for (const m of mods) {
    out.push(`### ${tick(m.file)}`, '');
    const lines: [string, string][] = [];
    lines.push(['Imports', list(m.imports)], ['Imported by', list(m.importedBy)]);
    const own = m.provides.map(n => map.apis.get(n)!);
    lines.push(['Provides', own.map(a => `${tick(`app.api.${a.name}`)}: ${list(uniq([...a.members.keys()]))}`).join('; ')]);
    const called = uniq(m.uses.filter(u => !m.provides.includes(u.api)).map(u => u.api));
    lines.push(['Uses', called.map(n => {
      const ms = uniq(m.uses.filter(u => u.api === n && u.member !== null).map(u => u.member!));
      return `${tick(`app.api.${n}`)}${ms.length ? ` (${ms.join(', ')})` : ''} from ${list(filesOf(map.apis.get(n)!.at)) || 'no module'}`;
    }).join('; ')]);
    lines.push(['Used by', own.map(a => {
      const users = uniq(a.uses.map(u => u.file).filter(f => f !== m.file));
      return `${tick(`app.api.${a.name}`)}: ${users.length ? list(users) : 'nobody'}`;
    }).join('; ')]);
    lines.push(['Emits', m.emitNames.map(n => `${tick(n)} (heard by ${list(filesOf(map.events.get(n)!.listeners)) || 'nobody'})`).join(', ')]);
    lines.push(['Hears', m.listenNames.map(n => `${tick(n)} (emitted by ${list(filesOf(map.events.get(n)!.emitters)) || 'nobody'})`).join(', ')]);
    const unread = m.unreadUpdates ? `${m.writes.length ? '; ' : ''}${m.unreadUpdates} \`store.update\` call${m.unreadUpdates > 1 ? 's' : ''} change${m.unreadUpdates > 1 ? '' : 's'} objects the callback already holds` : '';
    lines.push(['Changes in the save', list(m.writes) + unread]);
    for (const [label, text] of lines) if (text) out.push(`- ${label}: ${text}`);
    out.push('');
  }

  out.push('## The app.api names', '', `Each name is an object one module puts on \`app.api\` in its \`register(app)\`. Its type is the one \`AppApi\` in ${tick(API_FILE)} names for it. "Used by" counts any reference to the member, a call or a check that it exists.`, '');
  const cell = (s: string): string => s.replace(/\|/g, '\\|');
  for (const a of apis) {
    const typed = map.apiTable.get(a.name);
    out.push(`### ${tick(`app.api.${a.name}`)}`, '', `Registered in ${a.at.length ? list(filesOf(a.at)) : 'no module'}. Type: ${typed ? tick(typed.type) : 'not in `AppApi`'}.`, '', '| Member | Signature | Used by |', '|---|---|---|');
    for (const [name, users] of memberUsers(a)) {
      const sig = typed?.members.get(name);
      out.push(`| ${tick(name)}${a.members.has(name) ? '' : ' (not registered)'} | ${sig ? tick(cell(sig.type)) : 'not declared'} | ${users.length ? list(users) : 'nobody'} |`);
    }
    const bare = filesOf(a.uses.filter(u => u.member === null)).filter(f => !a.uses.some(u => u.file === f && u.member !== null));
    if (bare.length) out.push('', `Held or checked without a member by ${list(bare)}.`);
    out.push('');
  }

  out.push('## Events', '', `An event is a string name: \`app.emit(name, payload)\` calls every \`app.on(name, fn)\`. Each name and its payload type is an entry of \`AppEvents\` in ${tick(EVENTS_FILE)}; the comments there say who emits it and why a listener cares.`, '', '| Event | Payload | Emitted by | Heard by |', '|---|---|---|---|');
  for (const name of uniq([...map.eventTable.keys(), ...map.events.keys()])) {
    const e = map.events.get(name) ?? { name, emitters: [], listeners: [] }, row = map.eventTable.get(name);
    out.push(`| ${tick(name)} | ${row ? tick(cell(row.type)) : 'not in `AppEvents`'} | ${list(filesOf(e.emitters)) || 'nobody'} | ${list(filesOf(e.listeners)) || 'nobody'} |`);
  }

  out.push('', '## Views and panels', '', 'A view is a screen in the nav (`app.registerView`); a panel is a part under one view (`app.registerPanel`). Their shapes are `ViewDef` and `PanelDef` in `src/views/app.ts`, which also holds the defaults of what they leave out.', '', '| View | Registered in | Panels (registered in) |', '|---|---|---|');
  for (const v of map.views) {
    const ps = map.panels.filter(p => p.view === v.id);
    out.push(`| ${tick(v.id)} | ${tick(v.at.file)} | ${ps.map(p => `${tick(p.id)} (${p.at.file.replace(/^src\/(?:views|edge)\//, '')})`).join(', ') || 'none'} |`);
  }
  const lost = map.panels.filter(p => !map.views.some(v => v.id === p.view));
  if (lost.length) out.push('', `Panels for a view nobody registers: ${lost.map(p => `${tick(p.id)} (${tick(p.view!)}, ${p.at.file})`).join(', ')}.`);

  out.push('', '## Unresolved', '', 'What the patterns in `scripts/deps.ts` cannot follow. Nothing here is guessed. Each one is a dependency the map above does not show in full; `tests/deps.test.ts` fails on a new one.', '');
  for (const u of map.unresolved) out.push(`- ${tick(`${u.file}:${u.line}`)}: ${u.what}`);
  if (!map.unresolved.length) out.push('None.');
  return out.join('\n') + '\n';
}

// ── one entry, both directions, with lines ──

/** `a.js:3, 9; b.js:4` */
function where(locs: Loc[]): string {
  if (!locs.length) return 'nobody';
  const by = new Map<string, number[]>();
  for (const l of [...locs].sort(byLoc)) by.set(l.file, uniq([...(by.get(l.file) ?? []).map(String), String(l.line)]).map(Number).sort((a, b) => a - b));
  return [...by].map(([f, ls]) => `${f}:${ls.join(', ')}`).join('; ');
}

function moduleEntry(map: DepsMap, m: Module): string[] {
  const out = [`## ${m.file} (${m.layer})`, '', 'Depends on:'];
  for (const t of m.imports) out.push(`- imports ${t}`);
  for (const n of uniq(m.uses.map(u => u.api))) {
    const mine = m.uses.filter(u => u.api === n);
    for (const member of uniq(mine.map(u => u.member ?? ''))) {
      out.push(`- uses app.api.${n}${member ? `.${member}` : ''} (registered in ${ownerOf(map.apis.get(n)!)}) at ${where(mine.filter(u => (u.member ?? '') === member))}`);
    }
  }
  for (const n of m.listenNames) {
    const e = map.events.get(n)!;
    out.push(`- hears '${n}' at ${where(e.listeners.filter(l => l.file === m.file))}, emitted by ${where(e.emitters)}`);
  }
  out.push('', 'Depended on by:');
  for (const f of m.importedBy) out.push(`- imported by ${f}`);
  for (const n of m.provides) {
    const a = map.apis.get(n)!;
    for (const [member, users] of memberUsers(a)) {
      out.push(`- app.api.${n}.${member}${users.length ? '' : ': used by nobody'}${users.length ? ` used at ${where(a.uses.filter(u => u.member === member))}` : ''}`);
    }
  }
  for (const n of m.emitNames) {
    const e = map.events.get(n)!;
    out.push(`- emits '${n}' at ${where(e.emitters.filter(l => l.file === m.file))}, heard by ${where(e.listeners)}`);
  }
  if (m.writes.length || m.unreadUpdates) out.push('', `Changes in the save: ${m.writes.join(', ') || 'nothing it names'}${m.unreadUpdates ? ` (and ${m.unreadUpdates} store.update calls whose keys cannot be read off)` : ''}`);
  return out;
}

function apiEntry(map: DepsMap, a: Api, only?: string): string[] {
  const typed = map.apiTable.get(a.name);
  const out = [`## app.api.${a.name}${only ? `.${only}` : ''}`, '', `Registered in ${a.at.length ? where(a.at) : 'no module'}. Type: ${typed ? `${typed.type} (${API_FILE})` : 'NOT IN AppApi'}.`, ''];
  for (const [member, users] of memberUsers(a)) {
    if (only !== undefined && member !== only) continue;
    const def = a.members.get(member), sig = typed?.members.get(member);
    out.push(`- ${member}${sig ? `${sig.type.startsWith('(') ? '' : ': '}${sig.type}` : ' (NOT DECLARED)'}`);
    out.push(`  ${def ? `defined at ${def.file}:${def.line}` : 'NOT REGISTERED'}; ${users.length ? `used at ${where(a.uses.filter(u => u.member === member))}` : 'used by nobody'}${sig?.doc ? `. ${sig.doc}` : ''}`);
  }
  const bare = a.uses.filter(u => u.member === null);
  if (!only && bare.length) out.push(`- held or checked without a member at ${where(bare)}`);
  return out;
}

const eventEntry = (e: Event, row: Entry | undefined): string[] => [`## event '${e.name}'`, '',
  row ? `- payload: ${row.type} (${row.at.file}:${row.at.line})${row.doc ? `. ${row.doc}` : ''}` : `- NOT IN AppEvents (${EVENTS_FILE})`,
  `- emitted by ${where(e.emitters)}`, `- heard by ${where(e.listeners)}`];

/** Every entry whose name matches: a file, an API, `api.member`, or an event. */
export function lookup(map: DepsMap, query: string): string[] {
  const q = query.replace(/^app\.api\./, ''), out: string[] = [];
  const stem = (f: string): string => f.replace(/\.(ts|js)$/, '');
  for (const m of map.modules.values()) {
    const base = m.file.slice(m.file.lastIndexOf('/') + 1);
    if ([m.file, m.file.replace(/^src\//, ''), stem(m.file), stem(m.file.replace(/^src\//, '')), base, stem(base)].includes(q)) out.push(...moduleEntry(map, m), '');
  }
  const api = map.apis.get(q);
  if (api) out.push(...apiEntry(map, api), '');
  const dot = q.indexOf('.'), owner = dot > 0 ? map.apis.get(q.slice(0, dot)) : undefined;
  if (owner && memberUsers(owner).has(q.slice(dot + 1))) out.push(...apiEntry(map, owner, q.slice(dot + 1)), '');
  const ev = map.events.get(q) ?? (map.eventTable.has(q) ? { name: q, emitters: [], listeners: [] } : undefined);
  if (ev) out.push(...eventEntry(ev, map.eventTable.get(q)), '');
  for (const u of map.unresolved) if (u.file.includes(q) || u.what.includes(q)) out.push(`Unresolved ${u.file}:${u.line}: ${u.what}`);
  return out;
}

/** What --check compares: the committed file against what --write would write. */
export async function mapIsCurrent(): Promise<{ current: boolean; want: string }> {
  const want = renderMap(await buildMap()), file = Bun.file(`${ROOT}/${MAP_FILE}`);
  return { current: (await file.exists()) && (await file.text()) === want, want };
}

if (import.meta.main) {
  const arg = process.argv[2];
  if (arg === '--write') {
    await Bun.write(`${ROOT}/${MAP_FILE}`, renderMap(await buildMap()));
    console.log(`wrote ${MAP_FILE}`);
  } else if (arg === '--check') {
    const { current } = await mapIsCurrent();
    console.log(current ? `${MAP_FILE} is current` : `${MAP_FILE} is out of date: run bun run deps -- --write`);
    process.exit(current ? 0 : 1);
  } else if (arg) {
    const found = lookup(await buildMap(), arg);
    if (!found.length) { console.log(`Nothing named ${arg}. Try a file (gates.js), an API (combat), an API member (combat.add) or an event (combat:turn).`); process.exit(1); }
    console.log(found.join('\n').trimEnd());
  } else {
    console.log(renderMap(await buildMap()).trimEnd());
  }
}
