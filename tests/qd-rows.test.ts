// Row numbering guard for docs/agent-handoff/questionable-decisions.md.
// Two parallel branches once both added row 53; a non-conflicting merge would have let duplicate numbers through
// silently, breaking citations in for-the-owner.md and the Google Doc.
import { describe, expect, test } from 'bun:test';

const QD_PATH = `${import.meta.dir}/../docs/agent-handoff/questionable-decisions.md`;

export type QdRowCheck = {
  readonly count: number;
  readonly duplicates: readonly number[];
  readonly missing: readonly number[];
  readonly invalid: readonly number[];
  readonly errors: readonly string[];
};

/**
 * Checks row headers (`N. **...`) in sections before `## Neon review`.
 * Rows across those sections must form 1..N with no duplicates, no gaps, and no invalid numbers.
 * Numbered lists in `## Neon review` and later sections (`## Top 5`, etc.) are ignored.
 */
export function checkQdRows(markdown: string): QdRowCheck {
  const lines = markdown.split(/\r?\n/);
  const cutoff = lines.findIndex(line => /^## Neon review\b/.test(line));
  const scope = cutoff >= 0 ? lines.slice(0, cutoff) : lines;

  const linesByNum = new Map<number, number[]>();
  const invalid: number[] = [];
  const invalidDetails: string[] = [];
  let count = 0;

  for (let i = 0; i < scope.length; i++) {
    const match = /^(\d+)\.\s+\*\*/.exec(scope[i]!);
    if (!match) continue;
    count++;
    const raw = match[1]!;
    const num = Number(raw);
    const lineNo = i + 1;
    if (num < 1 || raw !== String(num)) {
      invalid.push(num);
      invalidDetails.push(`${raw} (line ${lineNo})`);
      continue;
    }
    const prev = linesByNum.get(num);
    if (prev) prev.push(lineNo);
    else linesByNum.set(num, [lineNo]);
  }

  const duplicates = [...linesByNum.entries()]
    .filter(([, at]) => at.length > 1)
    .map(([num]) => num)
    .sort((a, b) => a - b);

  const positiveNums = [...linesByNum.keys()];
  const max = positiveNums.length > 0 ? Math.max(...positiveNums) : 0;
  const missing: number[] = [];
  for (let n = 1; n <= max; n++) {
    if (!linesByNum.has(n)) missing.push(n);
  }

  const errors: string[] = [];
  if (count === 0) errors.push('no rows found before "## Neon review"');
  if (invalidDetails.length > 0) errors.push(`invalid row number(s): ${invalidDetails.join(', ')}`);
  if (duplicates.length > 0) {
    const detail = duplicates.map(n => `${n} (lines ${linesByNum.get(n)!.join(', ')})`).join(', ');
    errors.push(`duplicate row number(s): ${detail}`);
  }
  if (missing.length > 0) errors.push(`missing row number(s) in 1..${max}: ${missing.join(', ')}`);

  return { count, duplicates, missing, invalid, errors };
}

describe('questionable-decisions.md row numbering', () => {
  test('rows before "## Neon review" are 1..N with no duplicates or gaps', async () => {
    const text = await Bun.file(QD_PATH).text();
    const res = checkQdRows(text);
    expect(res.errors, `questionable-decisions.md row numbering failed: ${res.errors.join('; ')}`).toEqual([]);
    expect(res.count).toBeGreaterThan(0);
  });

  test('fails and names the duplicated row number when two branches add the same number', () => {
    const sample = [
      '# Questionable decisions',
      '',
      '## Decided while he was away',
      '',
      '1. **First call.** Details.',
      '2. **Second call.** Details.',
      '3. **Row 53 equivalent from branch A.** Details.',
      '3. **Row 53 equivalent from branch B.** Details.',
      '',
      '## Neon review (Nov 22)',
      '## Top 5',
      '1. Row 3: something.',
    ].join('\n');

    const res = checkQdRows(sample);
    expect(res.duplicates).toEqual([3]);
    expect(res.missing).toEqual([]);
    expect(res.errors.length).toBeGreaterThan(0);
    expect(res.errors.join('; ')).toContain('3');
    expect(res.errors.join('; ')).toContain('lines 7, 8');
  });

  test('fails on the real row-53-twice shape and names 53', () => {
    const rows = Array.from({ length: 53 }, (_, i) => `${i + 1}. **Call ${i + 1}.**`);
    rows.push('53. **Second branch also used 53.**');
    const res = checkQdRows(['## Decided while he was away', ...rows, '## Neon review (Nov 22)'].join('\n'));
    expect(res.duplicates).toEqual([53]);
    expect(res.errors.join('; ')).toContain('duplicate row number(s): 53');
  });

  test('fails and names missing numbers when there is a gap or rows do not start at 1', () => {
    const withGap = [
      '## Decided while he was away',
      '1. **First.**',
      '2. **Second.**',
      '4. **Fourth.**',
      '6. **Sixth.**',
    ].join('\n');
    const gapRes = checkQdRows(withGap);
    expect(gapRes.missing).toEqual([3, 5]);
    expect(gapRes.errors.join('; ')).toContain('3, 5');

    const noOne = [
      '## Decided while he was away',
      '2. **Second.**',
      '3. **Third.**',
    ].join('\n');
    const noOneRes = checkQdRows(noOne);
    expect(noOneRes.missing).toEqual([1]);
    expect(noOneRes.errors.join('; ')).toContain('1');
  });

  test('fails on invalid row numbers or no rows', () => {
    const zeroRes = checkQdRows('## Decided\n0. **Zero.**\n1. **One.**\n');
    expect(zeroRes.invalid).toEqual([0]);
    expect(zeroRes.errors.join('; ')).toContain('0');

    const paddedRes = checkQdRows('## Decided\n01. **Padded.**\n');
    expect(paddedRes.invalid).toEqual([1]);
    expect(paddedRes.errors.join('; ')).toContain('01');

    const emptyRes = checkQdRows('# Questionable decisions\n\n## Neon review (Nov 22)\n1. **Not a row.**\n');
    expect(emptyRes.count).toBe(0);
    expect(emptyRes.errors.length).toBeGreaterThan(0);
  });

  test('allows rows split across sections before "## Neon review" and ignores later lists', () => {
    const sample = [
      '# Questionable decisions',
      '',
      '## Decided while he was away',
      '1. **First.**',
      '2. **Second.**',
      '5. **Fifth.**',
      '6. **Sixth.**',
      '1. Not bold, so not a row.',
      '',
      '## Decided earlier in this session',
      '3. **Third.**',
      '4. **Fourth.**',
      '',
      '## Neon review (Nov 22)',
      '## Top 5',
      '1. Row 5 (change): something.',
      '2. Row 1 (needs the owner): something else.',
      '1. **Even a bold list item after Neon review is ignored.**',
    ].join('\n');

    const res = checkQdRows(sample);
    expect(res.errors).toEqual([]);
    expect(res.count).toBe(6);
    expect(res.duplicates).toEqual([]);
    expect(res.missing).toEqual([]);
  });
});
