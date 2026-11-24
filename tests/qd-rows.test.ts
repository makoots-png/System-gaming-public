// Date-slug ID and legacy alias guard for docs/agent-handoff/questionable-decisions.md.
// Parallel branches previously collided on sequential 1..N row numbers at merge time.
// Rows now use unique `YYYY-MM-DD-kebab-slug` IDs, while historical rows 1..87 keep frozen `(row N)` aliases.
import { describe, expect, test } from 'bun:test';
import {
  LEGACY_ROW_MAX,
  QD_DEFAULT_PATH,
  addQdRow,
  checkQdRows,
  isValidCalendarDate,
  parseQdId,
} from '../scripts/qd.ts';

describe('questionable-decisions.md date-slug IDs', () => {
  test('live file passes with unique date-slug IDs and every frozen legacy alias 1..87 intact', async () => {
    const text = await Bun.file(QD_DEFAULT_PATH).text();
    const res = checkQdRows(text);
    expect(res.errors, `questionable-decisions.md check failed: ${res.errors.join('; ')}`).toEqual([]);
    expect(res.count).toBeGreaterThanOrEqual(LEGACY_ROW_MAX);
    expect(res.duplicateIds).toEqual([]);
    expect(res.missingAliases).toEqual([]);
    expect(res.duplicateAliases).toEqual([]);
    expect(res.invalidAliases).toEqual([]);
    expect(res.reusedRetired).toEqual([]);
    // Spot-check that historical citations like "QD row 70" remain findable by `(row 70)` on the row line.
    const row70 = res.rows.find(r => r.legacyRow === 70);
    expect(row70).toBeDefined();
    expect(row70!.id).toMatch(/^2026-11-23-/);
  });

  test('CLI `bun scripts/qd.ts check` succeeds on the live file', () => {
    const res = Bun.spawnSync([process.execPath, 'scripts/qd.ts', 'check']);
    expect(res.exitCode, res.stderr.toString()).toBe(0);
    expect(res.stdout.toString()).toContain(`legacy aliases 1..${LEGACY_ROW_MAX} intact`);
  });

  test('validates calendar dates and date-slug shapes', () => {
    expect(isValidCalendarDate('2026-11-23')).toBe(true);
    expect(isValidCalendarDate('2028-02-29')).toBe(true);
    expect(isValidCalendarDate('2026-02-29')).toBe(false);
    expect(isValidCalendarDate('2026-13-01')).toBe(false);
    expect(isValidCalendarDate('2026-00-10')).toBe(false);
    expect(isValidCalendarDate('2025-11-23')).toBe(false);

    expect(parseQdId('2026-11-23-personal-gate-wait')).toEqual({
      id: '2026-11-23-personal-gate-wait',
      date: '2026-11-23',
      slug: 'personal-gate-wait',
    });
    expect(parseQdId('2026-11-24-row-32-shatter')).not.toBeNull();

    // Disguised sequential numbers, bad casing, bad separators, impossible dates, and bad lengths fail.
    for (const bad of [
      '2026-11-24-88',
      '2026-11-24-1-2',
      '2026-11-24-ab',
      `2026-11-24-${'a'.repeat(65)}`,
      '2026-11-24-Personal-Gate',
      '2026-11-24-personal_gate',
      '2026-11-24-personal--gate',
      '2026-11-24--personal',
      '2026-11-24-personal-',
      '2026-02-30-impossible-date',
      'personal-gate-wait',
      '',
    ]) {
      expect(parseQdId(bad), `expected "${bad}" to be rejected`).toBeNull();
    }
  });

  test('fails and names duplicate slug IDs with their line numbers', () => {
    const sample = [
      '# Questionable decisions',
      '',
      '## Decisions (Nov 24 onward)',
      '',
      '- `2026-11-24-personal-gate-wait` (row 1): **First call.** Details.',
      '- `2026-11-24-guild-cap-floor`: **Branch A call.** Details.',
      '- `2026-11-24-guild-cap-floor`: **Branch B duplicate.** Details.',
      '',
      '## Neon review (Nov 22)',
      '1. Row 1: something.',
    ].join('\n');

    const res = checkQdRows(sample, 1);
    expect(res.duplicateIds).toEqual(['2026-11-24-guild-cap-floor']);
    expect(res.errors.join('; ')).toContain('duplicate row ID(s): 2026-11-24-guild-cap-floor (lines 6, 7)');
  });

  test('rejects sequential numbered rows, un-slugged bold bullets, and malformed headers', () => {
    const sample = [
      '# Questionable decisions',
      '',
      '## Decided while he was away',
      '- `2026-11-22-first-call` (row 1): **First.** Details.',
      '88. **Old numbered row.** Details.',
      '- **Forgot the slug.** Details.',
      '- `2026-11-24-missing-colon` **No colon.** Details.',
      '- `2026-11-24-wrong-alias` (#2): **Wrong alias syntax.** Details.',
      '- `2026-11-24-88`: **Numeric slug disguised as counter.** Details.',
    ].join('\n');

    const res = checkQdRows(sample, 1);
    expect(res.malformedLines).toEqual([5, 6, 7, 8]);
    expect(res.invalidIds).toEqual(['2026-11-24-88']);
    expect(res.errors.length).toBeGreaterThanOrEqual(2);
    expect(res.errors.join('; ')).toContain('line 5');
    expect(res.errors.join('; ')).toContain('2026-11-24-88');
  });

  test('enforces frozen legacy aliases: no duplicates, no gaps, no zero/padded, no new numbers above max', () => {
    const sample = [
      '## Decided',
      '- `2026-11-22-one-a` (row 1): **One A.**',
      '- `2026-11-22-one-b` (row 1): **One B.**',
      '- `2026-11-22-zero` (row 0): **Zero.**',
      '- `2026-11-22-padded` (row 02): **Padded.**',
      '- `2026-11-24-too-high` (row 4): **Above frozen max.**',
    ].join('\n');

    const res = checkQdRows(sample, 3);
    expect(res.duplicateAliases).toEqual([1]);
    expect(res.missingAliases).toEqual([2, 3]);
    expect(res.invalidAliases).toEqual(['0', '02', '4']);
    expect(res.errors.join('; ')).toContain('duplicate legacy alias(es): row 1 (lines 2, 3)');
    expect(res.errors.join('; ')).toContain('missing legacy alias(es) in 1..3: 2, 3');
    expect(res.errors.join('; ')).toContain('row 4');
  });

  test('blocks reuse of retired IDs and flags invalid or duplicate retired entries', () => {
    const sample = [
      '# Questionable decisions',
      '',
      '## Decisions (Nov 24 onward)',
      '- `2026-11-22-keep-one` (row 1): **Keep.** Details.',
      '- `2026-11-24-old-idea`: **Reused retired ID.** Details.',
      '',
      '## Neon review (Nov 22)',
      '1. Row 1: fine.',
      '',
      '## Retired ids',
      '- `2026-11-24-old-idea` (retired)',
      '- `2026-11-24-old-idea` (duplicate)',
      '- `bad-retired-id`',
    ].join('\n');

    const res = checkQdRows(sample, 1);
    expect(res.reusedRetired).toEqual(['2026-11-24-old-idea']);
    expect(res.invalidIds).toContain('bad-retired-id');
    expect(res.errors.join('; ')).toContain('reused retired ID(s): 2026-11-24-old-idea (lines 5)');
    expect(res.errors.join('; ')).toContain('duplicate retired ID(s): 2026-11-24-old-idea (lines 11, 12)');
  });

  test('ignores numbered lists and bullets after "## Neon review"', () => {
    const sample = [
      '# Questionable decisions',
      '',
      '## Decided while he was away',
      '- `2026-11-22-first-call` (row 1): **First.** Details.',
      '- `2026-11-24-new-call`: **New call without alias.** Details.',
      '',
      '## Neon review (Nov 22)',
      '## Top 5',
      '1. Row 1 (change): something.',
      '2. **Even a bold numbered item after Neon review is ignored.**',
      '## Wording flags',
      '- Row 1 (`src/core/dc-pick.ts`): wording note.',
    ].join('\n');

    const res = checkQdRows(sample, 1);
    expect(res.errors).toEqual([]);
    expect(res.count).toBe(2);
  });

  test('addQdRow appends valid date-slug rows, blocks duplicates/retired IDs, and merges parallel branches without renumbering', () => {
    const base = [
      '# Questionable decisions',
      '',
      '## Decided while he was away',
      '',
      '- `2026-11-22-first-call` (row 1): **First.** Details.',
      '',
      '## Decisions (Nov 24 onward)',
      '',
      '## Neon review (Nov 22)',
      '1. Row 1: notes.',
      '',
      '## Retired ids',
      '- `2026-11-24-retired-rule`',
      '',
    ].join('\n');

    const branchA = addQdRow(base, {
      slug: 'personal-gate-wait',
      title: 'Personal gates wait for GM approval.',
      body: 'Undo with: "pay personal gates at once".',
      date: '2026-11-24',
    }, 1);
    expect(branchA.ok).toBe(true);
    if (!branchA.ok) return;
    expect(branchA.id).toBe('2026-11-24-personal-gate-wait');
    expect(checkQdRows(branchA.markdown, 1).errors).toEqual([]);

    // Adding a second branch's decision on top keeps both distinct IDs with zero renumbering.
    const merged = addQdRow(branchA.markdown, {
      slug: 'guild-cap-floor',
      title: 'Guild cut keeps at least 1 gold.',
      body: 'Undo with: "allow zero kept gold".',
      date: '2026-11-24',
    }, 1);
    expect(merged.ok).toBe(true);
    if (!merged.ok) return;
    const mergedCheck = checkQdRows(merged.markdown, 1);
    expect(mergedCheck.errors).toEqual([]);
    expect(mergedCheck.rows.map(r => r.id)).toEqual([
      '2026-11-22-first-call',
      '2026-11-24-personal-gate-wait',
      '2026-11-24-guild-cap-floor',
    ]);

    // Refuses duplicate, retired, and invalid IDs.
    const dup = addQdRow(merged.markdown, {
      slug: 'guild-cap-floor',
      title: 'Dup.',
      body: 'Dup.',
      date: '2026-11-24',
    }, 1);
    expect(dup.ok).toBe(false);

    const retired = addQdRow(merged.markdown, {
      slug: 'retired-rule',
      title: 'Reused.',
      body: 'Reused.',
      date: '2026-11-24',
    }, 1);
    expect(retired.ok).toBe(false);

    const bad = addQdRow(base, {
      slug: '88',
      title: 'Counter.',
      body: 'Counter.',
      date: '2026-11-24',
    }, 1);
    expect(bad.ok).toBe(false);
  });
});
