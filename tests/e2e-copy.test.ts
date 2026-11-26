// Guard against stale on-screen words in browser tests (tests/e2e/*.e2e.ts).
// When UI text changes in src/ or public/, hard-coded text literals in e2e tests silently drift until a full browser
// run catches them. This check scans the on-screen text matchers at unit-test speed and fails with the file, line,
// and missing words.
import { readdir } from 'node:fs/promises';
import { describe, expect, test } from 'bun:test';

const ROOT = `${import.meta.dir}/..`;

type Token =
  | { readonly kind: 'id'; readonly text: string; readonly line: number }
  | { readonly kind: 'str'; readonly value: string; readonly line: number; readonly idx: number }
  | { readonly kind: 'tpl'; readonly parts: readonly { readonly text: string; readonly line: number }[]; readonly line: number; readonly idx: number }
  | { readonly kind: 'punct'; readonly text: string; readonly line: number };

type MatcherHit = {
  readonly file: string;
  readonly line: number;
  readonly matcher: string;
  readonly negated: boolean;
  readonly chunk: string;
  readonly litIdx: number;
};

type TemplatePattern = {
  readonly parts: readonly string[];
  readonly leadHole: boolean;
  readonly trailHole: boolean;
};

type AppWords = {
  readonly blobLower: string;
  readonly exactLower: ReadonlySet<string>;
  readonly templates: readonly TemplatePattern[];
};

export type StaleCopy = {
  readonly file: string;
  readonly line: number;
  readonly matcher: string;
  readonly chunk: string;
};

export type AllowEntry = {
  readonly file: string;
  readonly chunk: string;
  readonly reason: string;
};

const HOLE = '\uE000';
const SEG = '\uE001';
const INLINE_TAG = /^<\/?(?:b|strong|i|em|small|code|mark|u|s|sup|sub)\b[^>]*>$/i;

function decodeEscapes(raw: string): string {
  let out = '';
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i]!;
    if (c !== '\\') { out += c; continue; }
    const n = raw[++i];
    if (n === undefined) break;
    if (n === 'n') out += '\n';
    else if (n === 'r') out += '\r';
    else if (n === 't') out += '\t';
    else if (n === 'u') {
      if (raw[i + 1] === '{') {
        const end = raw.indexOf('}', i + 2);
        if (end > 0) { out += String.fromCodePoint(parseInt(raw.slice(i + 2, end), 16)); i = end; }
      } else {
        out += String.fromCharCode(parseInt(raw.slice(i + 1, i + 5), 16)); i += 4;
      }
    } else if (n === 'x') {
      out += String.fromCharCode(parseInt(raw.slice(i + 1, i + 3), 16)); i += 2;
    } else {
      out += n;
    }
  }
  return out;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&apos;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&middot;/g, '·')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&mdash;|&#8212;/g, '—')
    .replace(/&ndash;|&#8211;/g, '–')
    .replace(/&hellip;/g, '…')
    .replace(/&times;/g, '×')
    .replace(/&minus;/g, '−')
    .replace(/&rarr;/g, '→')
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCharCode(Number(d)));
}

function splitHtmlIntoTextsAndTemplates(parts: readonly string[]): { strings: string[]; templates: string[][] } {
  const strings: string[] = [];
  const templates: string[][] = [];
  const joined = parts.join(HOLE);

  // Extract accessible-name attributes (aria-label, title, alt, placeholder) before stripping tags.
  const attrRe = /\b(?:aria-label|title|alt|placeholder)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
  let m: RegExpExecArray | null;
  while ((m = attrRe.exec(joined)) !== null) {
    const val = decodeEntities(m[1] ?? m[2] ?? '');
    if (val.includes(HOLE)) templates.push(val.split(HOLE));
    else if (val.trim()) strings.push(val);
  }

  // Keep inline formatting tags merged while splitting block/element boundaries into separate templates.
  const withSegs = joined.replace(/<[^>]*>/g, tag => (INLINE_TAG.test(tag) ? '' : SEG));
  for (const seg of withSegs.split(SEG)) {
    const text = decodeEntities(seg);
    if (!text.replaceAll(HOLE, '').trim()) continue;
    if (text.includes(HOLE)) templates.push(text.split(HOLE));
    else strings.push(text);
  }

  const allVisible = decodeEntities(joined.replace(/<[^>]*>/g, ''));
  if (!allVisible.includes(HOLE) && allVisible.trim()) strings.push(allVisible);

  return { strings, templates };
}

function tokenize(src: string): Token[] {
  const toks: Token[] = [];
  let i = 0, line = 1, tokIdx = 0;
  let prevKind: 'none' | 'value' | 'op' | 'kw' = 'none';
  const step = () => { if (src[i] === '\n') line++; i++; };

  const readTemplate = (): Token => {
    const startLine = line, myIdx = tokIdx++;
    step();
    const parts: { text: string; line: number }[] = [];
    let partLine = line, raw = '';
    while (i < src.length) {
      const c = src[i]!;
      if (c === '\\') { raw += c + (src[i + 1] ?? ''); step(); if (i < src.length) step(); continue; }
      if (c === '`') { step(); parts.push({ text: decodeEscapes(raw), line: partLine }); break; }
      if (c === '$' && src[i + 1] === '{') {
        parts.push({ text: decodeEscapes(raw), line: partLine });
        step(); step();
        let depth = 1;
        while (i < src.length && depth > 0) {
          const d = src[i]!, e = src[i + 1];
          if (d === '/' && e === '/') { while (i < src.length && src[i] !== '\n') step(); continue; }
          if (d === '/' && e === '*') { step(); step(); while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) step(); step(); step(); continue; }
          if (d === '"' || d === "'") {
            const q = d; step();
            while (i < src.length && src[i] !== q && src[i] !== '\n') { if (src[i] === '\\') step(); if (i < src.length) step(); }
            if (i < src.length) step();
            continue;
          }
          if (d === '`') { readTemplate(); continue; }
          if (d === '{') { depth++; step(); continue; }
          if (d === '}') { depth--; step(); continue; }
          step();
        }
        raw = ''; partLine = line; continue;
      }
      raw += c; step();
    }
    return { kind: 'tpl', parts, line: startLine, idx: myIdx };
  };

  while (i < src.length) {
    const c = src[i]!, n = src[i + 1];
    if (/\s/.test(c)) { step(); continue; }
    if (c === '/' && n === '/') { while (i < src.length && src[i] !== '\n') step(); continue; }
    if (c === '/' && n === '*') { step(); step(); while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) step(); step(); step(); continue; }
    if (c === '"' || c === "'") {
      const startLine = line, q = c; let raw = ''; step();
      while (i < src.length && src[i] !== q && src[i] !== '\n') {
        if (src[i] === '\\') { raw += '\\' + (src[i + 1] ?? ''); step(); if (i < src.length) step(); continue; }
        raw += src[i]!; step();
      }
      if (i < src.length) step();
      toks.push({ kind: 'str', value: decodeEscapes(raw), line: startLine, idx: tokIdx++ });
      prevKind = 'value'; continue;
    }
    if (c === '`') { toks.push(readTemplate()); prevKind = 'value'; continue; }
    if (c === '/' && (prevKind === 'none' || prevKind === 'op' || prevKind === 'kw')) {
      step(); let cls = false;
      while (i < src.length && src[i] !== '\n') {
        const d = src[i]!;
        if (d === '\\') { step(); if (i < src.length) step(); continue; }
        if (d === '[') cls = true;
        else if (d === ']') cls = false;
        else if (d === '/' && !cls) { step(); break; }
        step();
      }
      while (i < src.length && /[a-z]/i.test(src[i]!)) step();
      prevKind = 'value'; continue;
    }
    if (/[A-Za-z_$]/.test(c)) {
      const startLine = line; let text = '';
      while (i < src.length && /[A-Za-z0-9_$]/.test(src[i]!)) { text += src[i]!; step(); }
      toks.push({ kind: 'id', text, line: startLine });
      prevKind = /^(return|typeof|case|in|of|void|yield|await|new|delete|throw|else)$/.test(text) ? 'kw' : 'value';
      continue;
    }
    if (/[0-9]/.test(c)) {
      while (i < src.length && /[0-9._a-fA-FxXoObBn]/.test(src[i]!)) step();
      prevKind = 'value'; continue;
    }
    toks.push({ kind: 'punct', text: c, line });
    prevKind = (c === ')' || c === ']' || c === '}') ? 'value' : 'op';
    step();
  }
  return toks;
}

function extractSrcLiterals(src: string): { strings: string[]; templates: string[][] } {
  const strings: string[] = [];
  const templates: string[][] = [];
  let i = 0;
  let prevKind: 'none' | 'value' | 'op' | 'kw' = 'none';

  const emitParts = (rawParts: readonly string[]) => {
    const res = splitHtmlIntoTextsAndTemplates(rawParts);
    strings.push(...res.strings);
    templates.push(...res.templates);
  };

  const readTpl = () => {
    i++;
    const parts: string[] = [];
    let raw = '';
    while (i < src.length) {
      const c = src[i]!;
      if (c === '\\') { raw += c + (src[i + 1] ?? ''); i += 2; continue; }
      if (c === '`') { i++; parts.push(decodeEscapes(raw)); break; }
      if (c === '$' && src[i + 1] === '{') {
        parts.push(decodeEscapes(raw));
        i += 2;
        scan(1);
        raw = '';
        continue;
      }
      raw += c; i++;
    }
    emitParts(parts);
  };

  const scan = (stopAtBraceDepth: number) => {
    let depth = stopAtBraceDepth;
    while (i < src.length) {
      const c = src[i]!, n = src[i + 1];
      if (/\s/.test(c)) { i++; continue; }
      if (c === '/' && n === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
      if (c === '/' && n === '*') { i += 2; while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++; i += 2; continue; }
      if (c === '"' || c === "'") {
        const q = c; i++; let raw = '';
        while (i < src.length && src[i] !== q && src[i] !== '\n') {
          if (src[i] === '\\') { raw += '\\' + (src[i + 1] ?? ''); i += 2; continue; }
          raw += src[i]!; i++;
        }
        if (i < src.length) i++;
        emitParts([decodeEscapes(raw)]);
        prevKind = 'value'; continue;
      }
      if (c === '`') { readTpl(); prevKind = 'value'; continue; }
      if (c === '/' && (prevKind === 'none' || prevKind === 'op' || prevKind === 'kw')) {
        i++; let cls = false;
        while (i < src.length && src[i] !== '\n') {
          const d = src[i]!;
          if (d === '\\') { i += 2; continue; }
          if (d === '[') cls = true;
          else if (d === ']') cls = false;
          else if (d === '/' && !cls) { i++; break; }
          i++;
        }
        while (i < src.length && /[a-z]/i.test(src[i]!)) i++;
        prevKind = 'value'; continue;
      }
      if (c === '{') { depth++; prevKind = 'op'; i++; continue; }
      if (c === '}') {
        depth--; i++;
        if (stopAtBraceDepth > 0 && depth === 0) return;
        prevKind = 'value'; continue;
      }
      if (/[A-Za-z_$]/.test(c)) {
        let text = '';
        while (i < src.length && /[A-Za-z0-9_$]/.test(src[i]!)) { text += src[i]!; i++; }
        prevKind = /^(return|typeof|case|in|of|void|yield|await|new|delete|throw|else)$/.test(text) ? 'kw' : 'value';
        continue;
      }
      if (/[0-9]/.test(c)) {
        while (i < src.length && /[0-9._a-fA-FxXoObBn]/.test(src[i]!)) i++;
        prevKind = 'value'; continue;
      }
      prevKind = (c === ')' || c === ']') ? 'value' : 'op';
      i++;
    }
  };
  scan(0);
  return { strings, templates };
}

function skipBalanced(toks: readonly Token[], i: number, open: string, close: string): number {
  let depth = 0;
  for (let k = i; k < toks.length; k++) {
    const t = toks[k]!;
    if (t.kind === 'punct' && t.text === open) depth++;
    else if (t.kind === 'punct' && t.text === close) { depth--; if (depth === 0) return k; }
  }
  return toks.length - 1;
}

function extractExprLiterals(toks: readonly Token[], start: number, end: number): { text: string; line: number; idx: number }[] {
  const out: { text: string; line: number; idx: number }[] = [];
  if (start > end) return out;
  const first = toks[start]!;
  if (start === end) {
    if (first.kind === 'str') out.push({ text: first.value, line: first.line, idx: first.idx });
    else if (first.kind === 'tpl') {
      for (const p of first.parts) out.push({ text: p.text, line: p.line, idx: first.idx });
    }
  } else if (first.kind === 'punct' && first.text === '[' && toks[end]?.kind === 'punct' && toks[end]?.text === ']') {
    let cur = start + 1, depth = 0;
    for (let k = start + 1; k <= end; k++) {
      const t = toks[k]!;
      if (t.kind === 'punct' && (t.text === '[' || t.text === '(' || t.text === '{')) depth++;
      else if (t.kind === 'punct' && (t.text === ']' || t.text === ')' || t.text === '}')) {
        if (depth === 0) { if (cur < k) out.push(...extractExprLiterals(toks, cur, k - 1)); break; }
        depth--;
      } else if (depth === 0 && t.kind === 'punct' && t.text === ',') {
        if (cur < k) out.push(...extractExprLiterals(toks, cur, k - 1));
        cur = k + 1;
      }
    }
  }
  return out;
}

function splitArgs(toks: readonly Token[], openParen: number): [number, number][] {
  const closeParen = skipBalanced(toks, openParen, '(', ')');
  const args: [number, number][] = [];
  let cur = openParen + 1, depth = 0;
  for (let k = openParen + 1; k < closeParen; k++) {
    const t = toks[k]!;
    if (t.kind === 'punct' && (t.text === '(' || t.text === '[' || t.text === '{')) depth++;
    else if (t.kind === 'punct' && (t.text === ')' || t.text === ']' || t.text === '}')) depth--;
    else if (depth === 0 && t.kind === 'punct' && t.text === ',') { args.push([cur, k - 1]); cur = k + 1; }
  }
  if (cur < closeParen) args.push([cur, closeParen - 1]);
  return args;
}

const isPunct = (t: Token | undefined, text: string): boolean => t !== undefined && t.kind === 'punct' && t.text === text;
const isId = (t: Token | undefined, text: string): boolean => t !== undefined && t.kind === 'id' && t.text === text;

function findObjProp(toks: readonly Token[], objStart: number, objEnd: number, prop: string): [number, number] | null {
  if (!isPunct(toks[objStart], '{')) return null;
  let depth = 0;
  for (let k = objStart + 1; k < objEnd; k++) {
    const t = toks[k]!;
    if (t.kind === 'punct' && (t.text === '{' || t.text === '(' || t.text === '[')) { depth++; continue; }
    if (t.kind === 'punct' && (t.text === '}' || t.text === ')' || t.text === ']')) { depth--; continue; }
    if (depth === 0 && t.kind === 'id' && t.text === prop && isPunct(toks[k + 1], ':')) {
      const valStart = k + 2;
      let valEnd = objEnd - 1, d2 = 0;
      for (let j = valStart; j < objEnd; j++) {
        const u = toks[j]!;
        if (u.kind === 'punct' && (u.text === '{' || u.text === '(' || u.text === '[')) d2++;
        else if (u.kind === 'punct' && (u.text === '}' || u.text === ')' || u.text === ']')) d2--;
        else if (d2 === 0 && u.kind === 'punct' && u.text === ',') { valEnd = j - 1; break; }
      }
      return [valStart, valEnd];
    }
  }
  return null;
}

function collectMatcherHits(file: string, toks: readonly Token[]): MatcherHit[] {
  const hits: MatcherHit[] = [];
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i]!;
    const isNeg = isPunct(toks[i - 1], '.') && isId(toks[i - 2], 'not');
    if (t.kind === 'id' && (t.text === 'toContainText' || t.text === 'toHaveText' || t.text === 'getByText') &&
        isPunct(toks[i - 1], '.') && isPunct(toks[i + 1], '(')) {
      const args = splitArgs(toks, i + 1);
      if (args[0]) {
        for (const lit of extractExprLiterals(toks, args[0][0], args[0][1])) {
          hits.push({ file, line: lit.line, matcher: t.text, negated: isNeg, chunk: lit.text, litIdx: lit.idx });
        }
      }
    }
    if (t.kind === 'id' && t.text === 'getByRole' && isPunct(toks[i - 1], '.') && isPunct(toks[i + 1], '(')) {
      const args = splitArgs(toks, i + 1);
      if (args[1]) {
        const prop = findObjProp(toks, args[1][0], args[1][1], 'name');
        if (prop) {
          for (const lit of extractExprLiterals(toks, prop[0], prop[1])) {
            hits.push({ file, line: lit.line, matcher: 'getByRole.name', negated: false, chunk: lit.text, litIdx: lit.idx });
          }
        }
      }
    }
    if (t.kind === 'id' && t.text === 'selectOption' && isPunct(toks[i - 1], '.') && isPunct(toks[i + 1], '(')) {
      const args = splitArgs(toks, i + 1);
      if (args[0]) {
        const prop = findObjProp(toks, args[0][0], args[0][1], 'label');
        if (prop) {
          for (const lit of extractExprLiterals(toks, prop[0], prop[1])) {
            hits.push({ file, line: lit.line, matcher: 'selectOption.label', negated: false, chunk: lit.text, litIdx: lit.idx });
          }
        }
      }
    }
    if (t.kind === 'id' && t.text === 'hasText' && isPunct(toks[i + 1], ':')) {
      let valEnd = i + 2, depth = 0;
      for (let j = i + 2; j < toks.length; j++) {
        const u = toks[j]!;
        if (u.kind === 'punct' && (u.text === '{' || u.text === '(' || u.text === '[')) depth++;
        else if (u.kind === 'punct' && (u.text === '}' || u.text === ')' || u.text === ']')) {
          if (depth === 0) { valEnd = j - 1; break; }
          depth--;
        } else if (depth === 0 && u.kind === 'punct' && u.text === ',') { valEnd = j - 1; break; }
      }
      for (const lit of extractExprLiterals(toks, i + 2, valEnd)) {
        hits.push({ file, line: lit.line, matcher: 'hasText', negated: false, chunk: lit.text, litIdx: lit.idx });
      }
    }
  }
  return hits;
}

function buildTemplatePatterns(templates: readonly (readonly string[])[]): TemplatePattern[] {
  const seen = new Set<string>();
  const out: TemplatePattern[] = [];

  const add = (rawParts: readonly string[]) => {
    const slice = rawParts.map(p => p.replace(/\s+/g, ' ').toLowerCase());
    if (slice.join('').replace(/[^a-z]/g, '').length < 3) return;
    const leadHole = slice[0]!.trim() === '';
    const trailHole = slice[slice.length - 1]!.trim() === '';
    const inner = slice.filter((p, idx) => !(p.trim() === '' && (idx === 0 || idx === slice.length - 1)));
    const cleaned = inner.map((p, idx) => {
      let s = p;
      if (idx === 0) s = s.trimStart();
      if (idx === inner.length - 1) s = s.trimEnd();
      return s;
    }).filter(p => p.length > 0);
    if (cleaned.length === 0) return;
    const totalAlpha = cleaned.join('').replace(/[^a-z]/g, '').length;
    if (totalAlpha < 3) return;
    // Reject patterns with only one word-bearing static piece surrounded by holes (ignoring trailing punctuation like ".").
    const wordParts = cleaned.filter(p => /[a-z]{2,}/.test(p));
    const surroundedByHoles = leadHole && (trailHole || !/[a-z]/.test(cleaned[cleaned.length - 1]!));
    if (surroundedByHoles && wordParts.length === 1 && totalAlpha < 4) return;
    if (surroundedByHoles && wordParts.length === 1 && !/[:.,-]/.test(wordParts[0]!) && totalAlpha < 5) return;
    const key = `${leadHole ? 1 : 0}|${trailHole ? 1 : 0}|${cleaned.join('\0')}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ parts: cleaned, leadHole, trailHole });
  };

  for (const rawParts of templates) {
    add(rawParts);
    const last = rawParts[rawParts.length - 1]!;
    if (last.trimEnd().endsWith('.')) add([...rawParts.slice(0, -1), last.trimEnd().slice(0, -1)]);

    // Allow dropping a trailing `: ${...}` or `, ${...}` clause only when the kept prefix has at least 2 static parts
    // (for example `Rests left this gate: ${a} of ${b}.` or `Phase ${a} of ${b}: ${c}`).
    for (let cut = rawParts.length - 1; cut >= 2; cut--) {
      const prefix = rawParts.slice(0, cut);
      const nonEmptyPrefix = prefix.filter(p => p.replace(/[^A-Za-z]/g, '').length >= 2);
      if (nonEmptyPrefix.length >= 2) {
        const tail = prefix[prefix.length - 1]!;
        const trimmedTail = tail.replace(/[:.,\s]+$/, '');
        if (trimmedTail) add([...prefix.slice(0, -1), trimmedTail]);
        if (/[:.,]$/.test(tail.trimEnd())) add([...prefix.slice(0, -1), '']);
      }
    }

    // Split multi-sentence templates at `. ` or `.${HOLE}` so each sentence can match independently.
    const joined = rawParts.join(HOLE);
    const sentences = joined.split(/\.(?:\s+|(?=\uE000))/);
    if (sentences.length > 1) {
      for (const sent of sentences) {
        if (!sent.includes(HOLE)) continue;
        add(sent.split(HOLE));
        const withDot = sent.trimEnd().endsWith('.') ? sent : `${sent}.`;
        add(withDot.split(HOLE));
      }
    }
  }
  return out;
}

function matchesTemplate(sLower: string, pat: TemplatePattern): boolean {
  const { parts, leadHole, trailHole } = pat;
  let pos = 0, startIdx = 0, endIdx = parts.length;
  const validHole = (holeText: string) => {
    if (holeText.includes('. ') || holeText.length > 50) return false;
    const words = (holeText.match(/[a-z]{2,}/g) ?? []).length;
    return parts.length === 1 ? words <= 5 : words <= 8;
  };

  if (!leadHole) {
    const first = parts[0]!;
    if (!sLower.startsWith(first)) return false;
    pos = first.length;
    startIdx = 1;
  } else {
    const first = parts[0]!;
    if (sLower.startsWith(first)) {
      pos = first.length;
      startIdx = 1;
    } else if (/^[^a-z0-9]/.test(first)) {
      const at = sLower.indexOf(first);
      if (at < 0 || !validHole(sLower.slice(0, at))) return false;
      pos = at + first.length;
      startIdx = 1;
    } else {
      const at = sLower.indexOf(` ${first}`);
      if (at < 0 || !validHole(sLower.slice(0, at))) return false;
      pos = at + 1 + first.length;
      startIdx = 1;
    }
  }

  if (!trailHole) {
    const last = parts[parts.length - 1]!;
    if (endIdx - 1 < startIdx) return pos === sLower.length;
    if (!sLower.endsWith(last)) return false;
    endIdx = parts.length - 1;
    const limit = sLower.length - last.length;
    if (limit < pos) return false;
    for (let k = startIdx; k < endIdx; k++) {
      const p = parts[k]!;
      const at = sLower.indexOf(p, pos);
      if (at < 0 || at + p.length > limit) return false;
      if (!validHole(sLower.slice(pos, at))) return false;
      pos = at + p.length;
    }
    return validHole(sLower.slice(pos, limit));
  }

  for (let k = startIdx; k < endIdx; k++) {
    const p = parts[k]!;
    const at = sLower.indexOf(p, pos);
    if (at < 0) return false;
    if (!validHole(sLower.slice(pos, at))) return false;
    pos = at + p.length;
  }
  return validHole(sLower.slice(pos));
}

function stripOuterDecor(s: string): string {
  return s.replace(/^[·.:,\-\s]+|[·.:,\-\s]+$/g, '').trim();
}

function peelNumericDecor(low: string): string {
  // Strip ratios (3/6, 0/6), counts (×2), trailing minus (Epic−), or single trailing copy letter (Cave Rat B).
  // Never strip a plain leading integer (`1 open` must stay `1 open`).
  return low
    .replace(/^\d+\/\d+\s+/, '')
    .replace(/\s+(?:\d+\/\d+|×\s*\d+|[a-z])$/, '')
    .replace(/−$/, '')
    .trim();
}

function matchesComposed(
  raw: string,
  app: AppWords,
  fileExact: ReadonlySet<string>,
  fileTemplates: readonly TemplatePattern[],
): boolean {
  const s = raw.replace(/\s+/g, ' ').trim();
  const candidates: string[][] = [];

  // Split `Name (detail)` only when `Name` is non-empty so standalone `(remote)` is never stripped of parens.
  const paren = /^(.+?)\s*\(([^()]+)\)\.?$/.exec(s);
  if (paren && paren[1]!.trim().length >= 2) candidates.push([paren[1]!.trim(), paren[2]!.trim()]);

  const delimParts = s.split(/\s*[·→]\s*|\.\s+|:\s+|,\s+/).map(stripOuterDecor).filter(Boolean);
  if (delimParts.length >= 2) candidates.push(delimParts);

  const isExactAtom = (piece: string, depth: number): boolean => {
    const t = piece.trim();
    if (!t) return true;
    const letters = t.replace(/[^A-Za-z]/g, '');
    if (letters.length <= 2) return true;
    const low = t.toLowerCase();
    if (app.exactLower.has(low) || fileExact.has(low)) return true;
    if (app.templates.some(pat => matchesTemplate(low, pat))) return true;
    if (fileTemplates.some(pat => matchesTemplate(low, pat))) return true;

    const peeled = peelNumericDecor(low)
      .replace(/^(?:[+-]?\d+(?:[.,/]\d+)?(?:d\d+)?%?\s+|\d+\.\s+|[esdcba]\s+)/, '')
      .replace(/\s+(?:[×x]?\s*[+-−]?\d+(?:[.,/]\d+)?%?(?:\s*g)?)$/, '')
      .trim();
    if (peeled && peeled !== low) {
      if (peeled.replace(/[^a-z]/g, '').length <= 2) return true;
      if (app.exactLower.has(peeled) || fileExact.has(peeled)) return true;
      if (app.templates.some(pat => matchesTemplate(peeled, pat))) return true;
    }
    if (depth < 2) return matchesComposed(t, app, fileExact, fileTemplates);
    return false;
  };

  return candidates.some(pieces => pieces.every(p => isExactAtom(p, 1)));
}

function buildAppWords(appFiles: ReadonlyMap<string, string>): AppWords {
  const staticTexts: string[] = [];
  const exactLower = new Set<string>();
  const allTemplates: string[][] = [];

  const addExact = (s: string) => {
    const c = s.replace(/\s+/g, ' ').trim();
    if (!c) return;
    staticTexts.push(c);
    exactLower.add(c.toLowerCase());
    const stripped = stripOuterDecor(c).toLowerCase();
    if (stripped) exactLower.add(stripped);
  };

  for (const [path, src] of appFiles) {
    if (path.startsWith('src/') && /\.(ts|js)$/.test(path)) {
      const { strings, templates } = extractSrcLiterals(src);
      for (const s of strings) addExact(s);
      for (const parts of templates) {
        allTemplates.push(parts);
        for (const part of parts) addExact(part);
      }
    } else if (path.startsWith('public/') && /\.(html|json|webmanifest)$/.test(path)) {
      const res = splitHtmlIntoTextsAndTemplates([src.replace(/<!--[\s\S]*?-->/g, ' ')]);
      for (const s of res.strings) addExact(s);
    }
  }

  return {
    blobLower: staticTexts.join('\n').toLowerCase(),
    exactLower,
    templates: buildTemplatePatterns(allTemplates),
  };
}

export function findStaleCopy(
  appFiles: ReadonlyMap<string, string>,
  e2eFiles: ReadonlyMap<string, string>,
  helperSource: string,
  allowlist: readonly AllowEntry[] = [],
): StaleCopy[] {
  const app = buildAppWords(appFiles);
  const allowed = new Set(allowlist.map(e => `${e.file}\0${e.chunk}`));

  const helperToks = tokenize(helperSource);
  const helperMatcherIdxs = new Set(collectMatcherHits('tests/e2e/helpers.ts', helperToks).map(h => h.litIdx));
  const helperNonMatcher = new Set<string>();
  for (const t of helperToks) {
    if (t.kind === 'str' && !helperMatcherIdxs.has(t.idx)) helperNonMatcher.add(t.value);
    if (t.kind === 'tpl' && !helperMatcherIdxs.has(t.idx)) for (const p of t.parts) helperNonMatcher.add(p.text);
  }

  const stale: StaleCopy[] = [];
  for (const [file, src] of [...e2eFiles.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const toks = tokenize(src);
    const hits = collectMatcherHits(file, toks);
    const matcherIdxs = new Set(hits.map(h => h.litIdx));

    const fileNonMatcher = new Set<string>(helperNonMatcher);
    const fileExact = new Set<string>([...helperNonMatcher].map(x => stripOuterDecor(x).toLowerCase()));
    const fileRawTemplates: string[][] = [];
    for (const t of toks) {
      if (t.kind === 'str' && !matcherIdxs.has(t.idx)) {
        fileNonMatcher.add(t.value);
        fileExact.add(stripOuterDecor(t.value).toLowerCase());
      }
      if (t.kind === 'tpl' && !matcherIdxs.has(t.idx)) {
        fileRawTemplates.push(t.parts.map(p => p.text));
        for (const p of t.parts) {
          fileNonMatcher.add(p.text);
          fileExact.add(stripOuterDecor(p.text).toLowerCase());
        }
      }
    }
    const nonMatcherBlob = [...fileNonMatcher].join('\n');
    const fileTemplates = buildTemplatePatterns(fileRawTemplates);

    for (const h of hits) {
      if (h.negated) continue;
      const chunk = h.chunk.replace(/\s+/g, ' ').trim();
      const letters = chunk.replace(/[^A-Za-z]/g, '');
      if (chunk.length < 4 || letters.length < 4) continue;
      if (allowed.has(`${file}\0${chunk}`)) continue;

      const lower = chunk.toLowerCase();
      if (app.blobLower.includes(lower)) continue;
      if (nonMatcherBlob.includes(chunk)) continue;

      const trimmed = stripOuterDecor(chunk);
      const trimmedLower = trimmed.toLowerCase();
      if (trimmed !== chunk && trimmed.replace(/[^A-Za-z]/g, '').length >= 4) {
        if (app.blobLower.includes(trimmedLower) || nonMatcherBlob.includes(trimmed)) continue;
      }

      const peeled = peelNumericDecor(lower);
      if (peeled !== lower && peeled.replace(/[^a-z]/g, '').length >= 4) {
        if (app.exactLower.has(peeled) || fileExact.has(peeled)) continue;
      }

      if (app.templates.some(pat => matchesTemplate(lower, pat))) continue;
      if (fileTemplates.some(pat => matchesTemplate(lower, pat))) continue;
      if (matchesComposed(chunk, app, fileExact, fileTemplates)) continue;

      stale.push({ file, line: h.line, matcher: h.matcher, chunk });
    }
  }
  return stale;
}

export function formatStaleCopy(hits: readonly StaleCopy[]): string {
  return hits
    .map(h => `${h.file}:${h.line} [${h.matcher}] missing words: ${JSON.stringify(h.chunk)}`)
    .join('\n');
}

export const ALLOWLIST: readonly AllowEntry[] = [
  { file: 'tests/e2e/character.e2e.ts', chunk: '60 armor cuts damage by 38%', reason: 'Worked example clause interpolated mid-sentence from RULES.fight in src/views/rulesref.js.' },
  { file: 'tests/e2e/combat-turns.e2e.ts', chunk: 'Brakk Ironhide uses', reason: 'Prefix of the fight log template where "uses" is too short to match with open holes.' },
  { file: 'tests/e2e/feel.e2e.ts', chunk: 'Cave Rat B', reason: 'Pack-lettered copy of the quick-add input "Cave Rat x4, E, brute" in the same file.' },
  { file: 'tests/e2e/kits.e2e.ts', chunk: 'When one inside it starts its turn', reason: 'Zone trigger line built from concatenated timing words in src/core/combat/effect-ops.ts.' },
  { file: 'tests/e2e/layout.e2e.ts', chunk: 'Kai · Longsword 1d8 = 6', reason: 'Dice feed entry combining test hunter Kai, weapon Longsword, and the rolled result.' },
  { file: 'tests/e2e/look.e2e.ts', chunk: 'Won a fight in The Drowned Cathedral of Saint Averno against 3 Goblins, Hobgoblin, Goblin Shaman, 2 Dire Wolves in 6 rounds, at 12% HP.', reason: 'Seeded chronicle log sentence with custom gate and monster names.' },
  { file: 'tests/e2e/makers.e2e.ts', chunk: 'Different values of title: 1, all time.', reason: 'Dynamic feat condition summary joining MEASURE_WORDS.distinct, field name, count, and window.' },
  { file: 'tests/e2e/map-extras.e2e.ts', chunk: 'Three Heads at', reason: 'Prefix of the omen landing template where "at" is too short to match with open holes.' },
  { file: 'tests/e2e/maps.e2e.ts', chunk: 'Leaves Healing light around the user for 2 rounds', reason: 'Dynamic zone summary joining "Leaves", zone name, placement phrase, and duration.' },
  { file: 'tests/e2e/room-sync-fixes.e2e.ts', chunk: 'Could not remove Kai Test', reason: 'Prefix of the room removal error toast without its trailing colon and refusal reason.' },
  { file: 'tests/e2e/stories.e2e.ts', chunk: 'Loses 1 ability point', reason: 'Negative reward line built in src/core/rewards.ts by prepending a ternary "Loses " prefix.' },
  { file: 'tests/e2e/trade.e2e.ts', chunk: 'Brakk gave Eldrin 1 Healing Potion.', reason: 'Gift toast built from `${from} gave ${to} ${what}.` where "gave" is too short to match with open holes.' },
];

async function loadWorktreeFiles(): Promise<{
  appFiles: Map<string, string>;
  e2eFiles: Map<string, string>;
  helperSource: string;
}> {
  const appFiles = new Map<string, string>();
  for (const dir of ['src', 'public']) {
    const names = (await readdir(`${ROOT}/${dir}`, { recursive: true }))
      .filter(n => /\.(ts|js|html|json|webmanifest)$/.test(n))
      .sort();
    for (const name of names) {
      appFiles.set(`${dir}/${name}`, await Bun.file(`${ROOT}/${dir}/${name}`).text());
    }
  }
  const e2eFiles = new Map<string, string>();
  const e2eNames = (await readdir(`${ROOT}/tests/e2e`)).filter(n => n.endsWith('.e2e.ts')).sort();
  for (const name of e2eNames) {
    e2eFiles.set(`tests/e2e/${name}`, await Bun.file(`${ROOT}/tests/e2e/${name}`).text());
  }
  const helperSource = await Bun.file(`${ROOT}/tests/e2e/helpers.ts`).text();
  return { appFiles, e2eFiles, helperSource };
}

describe('e2e on-screen copy guard', () => {
  test('every on-screen word literal in tests/e2e/*.e2e.ts matches src/ or public/ (or test-written data)', async () => {
    const { appFiles, e2eFiles, helperSource } = await loadWorktreeFiles();
    const rawStale = findStaleCopy(appFiles, e2eFiles, helperSource, []);
    const allowed = new Set(ALLOWLIST.map(e => `${e.file}\0${e.chunk}`));
    const stale = rawStale.filter(h => !allowed.has(`${h.file}\0${h.chunk}`));
    expect(
      formatStaleCopy(stale),
      'Update the e2e test to match the current UI text (import from the *_WORDS table where one exists), or add a one-line reason in ALLOWLIST if the text is built dynamically.',
    ).toBe('');

    const rawKeys = new Set(rawStale.map(h => `${h.file}\0${h.chunk}`));
    const unused = ALLOWLIST.filter(e => !rawKeys.has(`${e.file}\0${e.chunk}`)).map(e => `${e.file}: ${JSON.stringify(e.chunk)}`);
    expect(unused, 'Remove unused ALLOWLIST entries once the lint no longer needs them.').toEqual([]);
    // Scans every src/, public/, and tests/e2e/*.e2e.ts file (~1.2 s idle, ~2.9 s under parallel load); 30 s avoids default-5 s CI flakes.
  }, 30_000);

  test('catches stale e2e words from the plain-copy pass and names the file, line, and missing words', () => {
    const appFiles = new Map<string, string>([
      ['src/views/combat.js', "const opt = `${p.name} (player phone)`;"],
      ['src/views/workshop.js', "const btn = `<button aria-label=\"Start story ${s.name}\">Start</button>`;"],
      ['src/views/gm.js', "const p = `Fight loot: ${drop}. Tap Send award to give it, or collapse the Award section to save it for later.`;"],
      ['src/core/trade/words.ts', "export const TRADE_WORDS = { summary: (n: number) => `${n} open offer` };"],
      ['src/core/registry/feats.ts', "const desc = 'Finish the daily quest seven days in a row.';"],
    ]);
    const e2eFiles = new Map<string, string>([
      [
        'tests/e2e/sample.e2e.ts',
        [
          "const HUNTER = 'Kai Test';",
          "await page.fill('[data-name]', 'The wager');",
          "await page.locator('[data-hsel]').selectOption({ label: `${HUNTER} (remote)` });",
          "await page.getByRole('button', { name: 'Turn on The wager' }).tap();",
          "await expect(page.locator('#gm-hsum-trade')).toHaveText('1 open');",
          "await expect(page.locator('#feat')).toContainText('The daily quest finished seven days running.');",
          "await expect(page.locator('#tie')).toHaveText('Fight loot: 75 gold. Tap Send award to give it. Close Award to save it for later.');",
          "await expect(page.locator('#rules')).not.toContainText('Unconscious');",
          "await expect(page.locator('#card', { hasText: 'The wager' })).toBeVisible();",
        ].join('\n'),
      ],
    ]);

    const hits = findStaleCopy(appFiles, e2eFiles, '');
    expect(hits).toEqual([
      { file: 'tests/e2e/sample.e2e.ts', line: 3, matcher: 'selectOption.label', chunk: '(remote)' },
      { file: 'tests/e2e/sample.e2e.ts', line: 4, matcher: 'getByRole.name', chunk: 'Turn on The wager' },
      { file: 'tests/e2e/sample.e2e.ts', line: 5, matcher: 'toHaveText', chunk: '1 open' },
      { file: 'tests/e2e/sample.e2e.ts', line: 6, matcher: 'toContainText', chunk: 'The daily quest finished seven days running.' },
      { file: 'tests/e2e/sample.e2e.ts', line: 7, matcher: 'toHaveText', chunk: 'Fight loot: 75 gold. Tap Send award to give it. Close Award to save it for later.' },
    ]);
    expect(formatStaleCopy(hits)).toContain('tests/e2e/sample.e2e.ts:3 [selectOption.label] missing words: "(remote)"');
  });
});
