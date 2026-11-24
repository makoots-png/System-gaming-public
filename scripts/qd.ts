// Date-slug ID validator and row adder for docs/agent-handoff/questionable-decisions.md.
// Replaces sequential 1..N row numbering so parallel branches never collide on row IDs.
// Existing rows 1..87 keep frozen `(row N)` aliases so every historical citation stays findable.

export const QD_DEFAULT_PATH = `${import.meta.dir}/../docs/agent-handoff/questionable-decisions.md`;
export const LEGACY_ROW_MAX = 87;
export const QD_MIN_YEAR = 2026;
export const QD_SLUG_MIN = 3;
export const QD_SLUG_MAX = 64;

const QD_ID_RE = /^(\d{4})-(\d{2})-(\d{2})-([a-z0-9]+(?:-[a-z0-9]+)*)$/;
const HAS_LETTER_RE = /[a-z]/;
const CANONICAL_POS_INT_RE = /^[1-9]\d*$/;
const NEON_REVIEW_RE = /^## Neon review\b/;
const RETIRED_HEADING_RE = /^## Retired ids\b/;
const ONGOING_HEADING_RE = /^## Decisions \(Nov 24 onward\)\s*$/;
const H2_RE = /^##\s+/;

/** A validated date-slug decision ID (`YYYY-MM-DD-kebab-slug`). */
export type QdParsedId = {
  readonly id: string;
  readonly date: string;
  readonly slug: string;
};

/** One parsed decision row before `## Neon review`. */
export type QdRow = {
  readonly id: string;
  readonly line: number;
  readonly legacyRow: number | null;
};

/** Validation report returned by `checkQdRows`. */
export type QdRowCheck = {
  readonly count: number;
  readonly rows: readonly QdRow[];
  readonly retired: readonly string[];
  readonly duplicateIds: readonly string[];
  readonly reusedRetired: readonly string[];
  readonly invalidIds: readonly string[];
  readonly malformedLines: readonly number[];
  readonly duplicateAliases: readonly number[];
  readonly missingAliases: readonly number[];
  readonly invalidAliases: readonly string[];
  readonly errors: readonly string[];
};

/** Input fields for appending a new decision row with `addQdRow`. */
export type QdAddInput = {
  readonly slug: string;
  readonly title: string;
  readonly body: string;
  readonly date?: string;
};

/** Result of `addQdRow`. */
export type QdAddResult =
  | { readonly ok: true; readonly id: string; readonly markdown: string }
  | { readonly ok: false; readonly error: string };

/** Checks whether `date` is a real `YYYY-MM-DD` calendar date in `QD_MIN_YEAR` or later. */
export function isValidCalendarDate(date: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < QD_MIN_YEAR || month < 1 || month > 12 || day < 1 || day > 31) return false;
  const dt = new Date(Date.UTC(year, month - 1, day));
  return dt.getUTCFullYear() === year && dt.getUTCMonth() === month - 1 && dt.getUTCDate() === day;
}

/**
 * Parses a date-slug ID (`YYYY-MM-DD-kebab-slug`).
 * Requires a valid calendar date, a lowercase kebab suffix of 3 to 64 characters,
 * and at least one ASCII letter in the suffix (blocking disguised numbers like `2026-11-24-88`).
 */
export function parseQdId(raw: string): QdParsedId | null {
  const match = QD_ID_RE.exec(raw);
  if (!match) return null;
  const date = `${match[1]!}-${match[2]!}-${match[3]!}`;
  const slug = match[4]!;
  if (!isValidCalendarDate(date)) return null;
  if (slug.length < QD_SLUG_MIN || slug.length > QD_SLUG_MAX) return null;
  if (!HAS_LETTER_RE.test(slug)) return null;
  return { id: raw, date, slug };
}

/**
 * Validates every decision row in `markdown` before `## Neon review` and any optional `## Retired ids` section.
 * Enforces date-slug shape, unique IDs, no reuse of retired IDs, no legacy numbered rows,
 * and exact preservation of frozen legacy aliases `1..legacyMax`.
 */
export function checkQdRows(markdown: string, legacyMax: number = LEGACY_ROW_MAX): QdRowCheck {
  const lines = markdown.split(/\r?\n/);
  const cutoff = lines.findIndex(line => NEON_REVIEW_RE.test(line));
  const activeEnd = cutoff >= 0 ? cutoff : lines.length;

  const retiredLineSet = new Set<number>();
  const retiredById = new Map<string, number[]>();
  const invalidIds: string[] = [];
  const invalidIdDetails: string[] = [];
  const malformedLines: number[] = [];
  const malformedDetails: string[] = [];

  // Scan any `## Retired ids` section anywhere in the document.
  let inRetired = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (H2_RE.test(line)) {
      inRetired = RETIRED_HEADING_RE.test(line);
      if (inRetired) retiredLineSet.add(i);
      continue;
    }
    if (!inRetired) continue;
    retiredLineSet.add(i);
    if (!line.startsWith('- ')) continue;
    const lineNo = i + 1;
    const m = /^-\s+`([^`]*)`/.exec(line);
    if (!m) {
      malformedLines.push(lineNo);
      malformedDetails.push(`line ${lineNo}: retired entry must start with \`- \`YYYY-MM-DD-slug\`\``);
      continue;
    }
    const rawId = m[1]!;
    const parsed = parseQdId(rawId);
    if (!parsed) {
      invalidIds.push(rawId);
      invalidIdDetails.push(`${rawId || '(empty)'} (line ${lineNo}, retired)`);
      continue;
    }
    const prev = retiredById.get(parsed.id);
    if (prev) prev.push(lineNo);
    else retiredById.set(parsed.id, [lineNo]);
  }

  const rows: QdRow[] = [];
  const linesById = new Map<string, number[]>();
  const linesByAlias = new Map<number, number[]>();
  const invalidAliases: string[] = [];
  const invalidAliasDetails: string[] = [];

  for (let i = 0; i < activeEnd; i++) {
    if (retiredLineSet.has(i)) continue;
    const line = lines[i]!;
    const lineNo = i + 1;

    if (/^\d+\.\s+\*\*/.test(line)) {
      malformedLines.push(lineNo);
      malformedDetails.push(`line ${lineNo}: sequential numbered rows are retired; use \`- \`YYYY-MM-DD-slug\`: **...**\``);
      continue;
    }

    if (/^-\s+\*\*/.test(line)) {
      malformedLines.push(lineNo);
      malformedDetails.push(`line ${lineNo}: row bullet is missing a date-slug ID before the bold title`);
      continue;
    }

    const backtickBullet = /^-\s+`([^`]*)`(.*)$/.exec(line);
    if (!backtickBullet) continue;

    const rawId = backtickBullet[1]!;
    const rest = backtickBullet[2]!;
    const parsed = parseQdId(rawId);
    if (!parsed) {
      invalidIds.push(rawId);
      invalidIdDetails.push(`${rawId || '(empty)'} (line ${lineNo})`);
    }

    let legacyRow: number | null = null;
    if (/^:\s+\*\*/.test(rest)) {
      legacyRow = null;
    } else {
      const aliasMatch = /^\s+\(row\s+([^)]+)\):\s+\*\*/.exec(rest);
      if (!aliasMatch) {
        malformedLines.push(lineNo);
        malformedDetails.push(`line ${lineNo}: row header must be \`- \`YYYY-MM-DD-slug\`: **...**\` or \`- \`YYYY-MM-DD-slug\` (row N): **...**\``);
        continue;
      }
      const rawAlias = aliasMatch[1]!;
      const num = Number(rawAlias);
      if (!CANONICAL_POS_INT_RE.test(rawAlias) || num < 1 || num > legacyMax) {
        invalidAliases.push(rawAlias);
        invalidAliasDetails.push(`row ${rawAlias} (line ${lineNo}; frozen legacy range is 1..${legacyMax})`);
      } else {
        legacyRow = num;
        const prevAlias = linesByAlias.get(num);
        if (prevAlias) prevAlias.push(lineNo);
        else linesByAlias.set(num, [lineNo]);
      }
    }

    if (parsed) {
      rows.push({ id: parsed.id, line: lineNo, legacyRow });
      const prevId = linesById.get(parsed.id);
      if (prevId) prevId.push(lineNo);
      else linesById.set(parsed.id, [lineNo]);
    }
  }

  const retired = [...retiredById.keys()].sort();
  const duplicateRetired = [...retiredById.entries()]
    .filter(([, at]) => at.length > 1)
    .map(([id, at]) => `${id} (lines ${at.join(', ')})`)
    .sort();

  const duplicateIds = [...linesById.entries()]
    .filter(([, at]) => at.length > 1)
    .map(([id]) => id)
    .sort();

  const reusedRetired = [...linesById.keys()]
    .filter(id => retiredById.has(id))
    .sort();

  const duplicateAliases = [...linesByAlias.entries()]
    .filter(([, at]) => at.length > 1)
    .map(([num]) => num)
    .sort((a, b) => a - b);

  const missingAliases: number[] = [];
  for (let n = 1; n <= legacyMax; n++) {
    if (!linesByAlias.has(n)) missingAliases.push(n);
  }

  const errors: string[] = [];
  if (rows.length === 0) errors.push('no rows found before "## Neon review"');
  if (malformedDetails.length > 0) errors.push(`malformed row(s): ${malformedDetails.join('; ')}`);
  if (invalidIdDetails.length > 0) errors.push(`invalid row ID(s): ${invalidIdDetails.join(', ')}`);
  if (duplicateIds.length > 0) {
    const detail = duplicateIds.map(id => `${id} (lines ${linesById.get(id)!.join(', ')})`).join(', ');
    errors.push(`duplicate row ID(s): ${detail}`);
  }
  if (duplicateRetired.length > 0) errors.push(`duplicate retired ID(s): ${duplicateRetired.join(', ')}`);
  if (reusedRetired.length > 0) {
    const detail = reusedRetired.map(id => `${id} (lines ${linesById.get(id)!.join(', ')})`).join(', ');
    errors.push(`reused retired ID(s): ${detail}`);
  }
  if (invalidAliasDetails.length > 0) errors.push(`invalid legacy alias(es): ${invalidAliasDetails.join(', ')}`);
  if (duplicateAliases.length > 0) {
    const detail = duplicateAliases.map(n => `row ${n} (lines ${linesByAlias.get(n)!.join(', ')})`).join(', ');
    errors.push(`duplicate legacy alias(es): ${detail}`);
  }
  if (missingAliases.length > 0) {
    errors.push(`missing legacy alias(es) in 1..${legacyMax}: ${missingAliases.join(', ')}`);
  }

  return {
    count: rows.length,
    rows,
    retired,
    duplicateIds,
    reusedRetired,
    invalidIds,
    malformedLines,
    duplicateAliases,
    missingAliases,
    invalidAliases,
    errors,
  };
}

/**
 * Pure row adder: validates a new date-slug row, blocks duplicates and retired IDs,
 * and appends it under `## Decisions (Nov 24 onward)` (or just before `## Neon review`).
 */
export function addQdRow(markdown: string, input: QdAddInput, legacyMax: number = LEGACY_ROW_MAX): QdAddResult {
  const date = input.date ?? new Date().toISOString().slice(0, 10);
  const slug = input.slug.trim();
  const title = input.title.trim();
  const body = input.body.trim();

  if (!title) return { ok: false, error: 'title is required' };
  if (!body) return { ok: false, error: 'body is required' };
  if (/[\r\n]/.test(title) || /[\r\n]/.test(body)) {
    return { ok: false, error: 'title and body must be single lines' };
  }

  const id = `${date}-${slug}`;
  if (!parseQdId(id)) {
    return {
      ok: false,
      error: `invalid date-slug ID "${id}": expected YYYY-MM-DD-<kebab-slug> (3 to 64 lowercase letters, digits, and single hyphens, with at least one letter)`,
    };
  }

  const existing = checkQdRows(markdown, legacyMax);
  if (existing.rows.some(r => r.id === id)) {
    return { ok: false, error: `row ID "${id}" already exists` };
  }
  if (existing.retired.includes(id)) {
    return { ok: false, error: `row ID "${id}" is retired and cannot be reused` };
  }

  const rowLine = `- \`${id}\`: **${title}** ${body}`;
  const lines = markdown.split(/\r?\n/);
  const ongoingIdx = lines.findIndex(l => ONGOING_HEADING_RE.test(l));
  const neonIdx = lines.findIndex(l => NEON_REVIEW_RE.test(l));

  if (ongoingIdx >= 0) {
    let nextH2 = lines.length;
    for (let i = ongoingIdx + 1; i < lines.length; i++) {
      if (H2_RE.test(lines[i]!)) { nextH2 = i; break; }
    }
    let insertAt = nextH2;
    while (insertAt > ongoingIdx + 1 && lines[insertAt - 1]!.trim() === '') insertAt--;
    const needsLeadBlank = insertAt === ongoingIdx + 1;
    const toInsert = needsLeadBlank ? ['', rowLine] : [rowLine];
    lines.splice(insertAt, 0, ...toInsert);
    // Keep one blank line before the next section heading when one exists.
    const afterRow = insertAt + toInsert.length;
    if (afterRow < lines.length && lines[afterRow]!.trim() !== '') {
      lines.splice(afterRow, 0, '');
    }
  } else if (neonIdx >= 0) {
    let insertAt = neonIdx;
    while (insertAt > 0 && lines[insertAt - 1]!.trim() === '') insertAt--;
    lines.splice(insertAt, 0, rowLine);
    if (lines[insertAt + 1] !== '') lines.splice(insertAt + 1, 0, '');
  } else {
    while (lines.length > 0 && lines[lines.length - 1]!.trim() === '') lines.pop();
    lines.push(rowLine, '');
  }

  return { ok: true, id, markdown: lines.join('\n') };
}

async function runCli(): Promise<void> {
  const args = process.argv.slice(2);
  const cmd = args[0];

  if (cmd === 'check') {
    const path = args[1] ?? QD_DEFAULT_PATH;
    const text = await Bun.file(path).text();
    const res = checkQdRows(text);
    if (res.errors.length > 0) {
      console.error(`qd check failed:\n- ${res.errors.join('\n- ')}`);
      process.exit(1);
    }
    console.log(`qd check ok: ${res.count} rows, legacy aliases 1..${LEGACY_ROW_MAX} intact`);
    return;
  }

  if (cmd === 'add') {
    let date: string | undefined;
    const positional: string[] = [];
    for (let i = 1; i < args.length; i++) {
      const a = args[i]!;
      if (a === '--date') {
        const next = args[i + 1];
        if (!next) {
          console.error('qd add failed: --date requires a YYYY-MM-DD value');
          process.exit(2);
        }
        date = next;
        i++;
      } else {
        positional.push(a);
      }
    }
    const [slug, title, body] = positional;
    if (!slug || !title || !body) {
      console.error('usage: bun scripts/qd.ts add <kebab-slug> "<Bold title.>" "<Details and undo words.>" [--date YYYY-MM-DD]');
      process.exit(2);
    }
    const text = await Bun.file(QD_DEFAULT_PATH).text();
    const input: QdAddInput = date === undefined ? { slug, title, body } : { slug, title, body, date };
    const added = addQdRow(text, input);
    if (!added.ok) {
      console.error(`qd add failed: ${added.error}`);
      process.exit(1);
    }
    const check = checkQdRows(added.markdown);
    if (check.errors.length > 0) {
      console.error(`qd add refused: resulting file fails check:\n- ${check.errors.join('\n- ')}`);
      process.exit(1);
    }
    await Bun.write(QD_DEFAULT_PATH, added.markdown);
    console.log(added.id);
    return;
  }

  console.error('usage: bun scripts/qd.ts <check | add <kebab-slug> "<title>" "<body>" [--date YYYY-MM-DD]>');
  process.exit(2);
}

if (import.meta.main) {
  await runCli();
}
