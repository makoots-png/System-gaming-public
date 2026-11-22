// counts.ts: what a feat counts, and the one step that moves a count by a fact (feature 1's notes section 5.6). Pure.
// A count is one fact kind, up to `TESTS_MAX` tests of its fields (all must hold), what it measures (each fact, the sum
// of a numeric field, the different values of a field, a field's highest value) and its window: ever, in a row (a fact
// of its kind that fails its tests starts it again), one session, one day, or between two rests (a new window
// starts the count again). The tests name a kind's fields as `FACT_FIELDS` lists them, so the parser refuses a test of a
// field its kind lacks: dropping it would widen what the count counts ("beasts" becoming "any foe").
import { RANKS, rankIdx } from '../rules.ts';
import { FACT_FIELDS } from './facts.ts';
import type { Fact, FactKind, FactStamp, FieldSpec } from './facts.ts';

export const WITHINS = ['ever', 'row', 'session', 'day', 'rest'] as const;
/** A count's window: its whole life, an unbroken row, one session, one day, between two rests. */
export type Within = (typeof WITHINS)[number];
export const TEST_OPS = ['>=', '<=', '='] as const;
export type TestOp = (typeof TEST_OPS)[number];
/** A test of one field of the counted kind: a number, a rank (compared E to S), a choice, a flag or text (compared whole, in any case). */
export type Test = { readonly field: string; readonly op: TestOp; readonly value: number | string | boolean };
export const MEASURES = ['facts', 'sum', 'distinct', 'max'] as const;
/** Each passing fact counts 1; or a numeric field's sum; or the number of different values of a field; or a numeric field's highest value. */
export type CountMeasure = { readonly of: 'facts' } | { readonly of: 'sum' | 'distinct' | 'max'; readonly field: string };
export type FactCount = { readonly on: FactKind; readonly where: readonly Test[]; readonly measure: CountMeasure; readonly within: Within };
/** Where a count stands: its number, the mark of the window it counts in, and the values seen (a `distinct` count only). */
export type Counted = { readonly n: number; readonly mark: string; readonly vals?: readonly string[] };
export const NO_COUNT: Counted = { n: 0, mark: '' };
/** At most this many tests a count; a count's number past this is junk. */
export const TESTS_MAX = 4, COUNT_MAX = 1e9, VALS_MAX = 200;

/** The mark of the window a fact counts in: none for ever and a row, else its session, its day, or the rests before it. */
export function markOf(within: Within, stamp: FactStamp, rests: number): string {
  switch (within) {
    case 'ever': case 'row': return '';
    case 'session': return `s${stamp.session}`;
    case 'day': return stamp.day;
    case 'rest': return `r${rests}`;
  }
}

const field = (f: Fact, name: string): unknown => (f as unknown as Record<string, unknown>)[name];
const specOf = (kind: FactKind, name: string): FieldSpec | null => (FACT_FIELDS[kind] as Readonly<Record<string, FieldSpec>>)[name] ?? null;
/** Whether test `t` holds of `f` (of the count's kind). A field with no value (a boss rank when there was none) fails every test. */
function holds(f: Fact, t: Test): boolean {
  const spec = specOf(f.kind, t.field), v = field(f, t.field);
  if (!spec || v === null || v === undefined) return false;
  const cmp = (a: number, b: number): boolean => (t.op === '>=' ? a >= b : t.op === '<=' ? a <= b : a === b);
  switch (spec.t) {
    case 'num': return typeof v === 'number' && typeof t.value === 'number' && cmp(v, t.value);
    case 'rank': return cmp(rankIdx(v), rankIdx(t.value));
    case 'flag': return v === t.value;
    case 'pick': return v === t.value;
    case 'text': return typeof v === 'string' && typeof t.value === 'string' && v.trim().toLowerCase() === t.value.trim().toLowerCase();
  }
}
/** Whether `f` is of the count's kind and passes all its tests. */
export const passes = (f: Fact, c: FactCount): boolean => f.kind === c.on && c.where.every(t => holds(f, t));

/**
 * What fact `f` did to a count (`countStep`). `moved`: it passed the count's tests and the count after it (a new window
 * starts again from 0 first). `same`: it is of the count's kind and left the count as it was: it failed the tests of a
 * count not in a row, gave a different-values count a value it has seen in this window, or had no value for the field
 * its count measures. `broke`: it failed the tests
 * of a count in a row, and the count after it is 0 with no values seen, so a new row counts every value again
 * (SMX-rules-9.2). A feat and a quest's objective both read this one answer (noticed.ts, `objectiveStep`).
 */
export type CountMove = { readonly to: 'moved' | 'broke'; readonly count: Counted } | { readonly to: 'same' };
const SAME: CountMove = { to: 'same' };
/**
 * A count after fact `f` at window mark `mark` (`markOf`): null when `f` is not of its kind, else its move (`CountMove`).
 *   window      | passes, same mark | passes, new mark | fails its tests
 *   ever        | n + adds          | (no new mark)    | same
 *   row         | n + adds          | (no new mark)    | broke (n 0, no values)
 *   session ... | n + adds          | adds             | same
 * `adds`: 1 for `facts`; the field's value for `sum`; for `distinct` 1 when the value is new (then kept), else the count
 * is the same; for `max` the rise of the field's value over `n`, never below 0.
 */
export function countStep(c: Counted, f: Fact, count: FactCount, mark: string): CountMove | null {
  if (f.kind !== count.on) return null;
  if (!passes(f, count)) return count.within === 'row' ? { to: 'broke', count: { n: 0, mark: c.mark } } : SAME;
  const fresh = c.mark !== mark, base: Counted = fresh ? { n: 0, mark } : c;
  const moved = (to: Counted): CountMove => ({ to: 'moved', count: to });
  const m = count.measure;
  if (m.of === 'facts') return moved({ ...base, n: Math.min(COUNT_MAX, base.n + 1) });
  const v = field(f, m.field);
  if (m.of === 'distinct') {
    const key = v === null || v === undefined ? null : String(v).trim().toLowerCase(), seen = base.vals ?? [];
    if (key === null || seen.includes(key)) return fresh ? moved(base) : SAME;
    return moved({ ...base, n: base.n + 1, vals: [...seen, key].slice(-VALS_MAX) });
  }
  if (typeof v !== 'number') return fresh ? moved(base) : SAME;
  return moved(m.of === 'sum' ? { ...base, n: Math.min(COUNT_MAX, base.n + Math.max(0, v)) } : { ...base, n: Math.max(base.n, v) });
}

// ── the boundary ──
type Rec = Record<string, unknown>;
const isObj = (v: unknown): v is Rec => v !== null && typeof v === 'object' && !Array.isArray(v);
const isKind = (v: unknown): v is FactKind => typeof v === 'string' && Object.hasOwn(FACT_FIELDS, v);
/** A test's value read by its field's spec, or undefined when it does not read. */
function valueOf(spec: FieldSpec, v: unknown): number | string | boolean | undefined {
  switch (spec.t) {
    case 'num': return typeof v === 'number' && Number.isFinite(v) ? Math.min(spec.max, Math.max(spec.min, v)) : undefined;
    case 'flag': return typeof v === 'boolean' ? v : undefined;
    case 'rank': return (RANKS as readonly unknown[]).includes(v) ? v as string : undefined;
    case 'pick': return (spec.of as readonly unknown[]).includes(v) ? v as string : undefined;
    case 'text': return typeof v === 'string' && v.trim() ? v.trim().slice(0, spec.max) : undefined;
  }
}
/** The ops a field's spec may be compared with: an order for a number or a rank, equality for the rest. */
export const opsFor = (spec: FieldSpec): readonly TestOp[] => (spec.t === 'num' || spec.t === 'rank' ? TEST_OPS : ['=']);
/** The fields of kind `kind` that measure `of` may read: a number field for a sum or a highest, any field for different values. */
export function measureFields(kind: FactKind, of: Exclude<CountMeasure['of'], 'facts'>): readonly string[] {
  return (Object.entries(FACT_FIELDS[kind]) as [string, FieldSpec][]).filter(([, s]) => of === 'distinct' || s.t === 'num').map(([f]) => f);
}
/** The measures a count of kind `kind` may take: each time, and every other measure that has a field of the kind to read. */
export const measuresFor = (kind: FactKind): readonly CountMeasure['of'][] => MEASURES.filter(m => m === 'facts' || measureFields(kind, m).length > 0);
/**
 * A count from outside data, or null. A test of a field its kind lacks, an op its field cannot take or a value that does
 * not read refuses the count, and so does an unknown kind; a window that does not read is `ever`; a measure that names
 * a field of the wrong sort (a sum of text) refuses it.
 */
export function parseCount(v: unknown): FactCount | null {
  if (!isObj(v) || !isKind(v.on)) return null;
  const on = v.on, raw = Array.isArray(v.where) ? v.where : [];
  if (raw.length > TESTS_MAX) return null;
  const where: Test[] = [];
  for (const t of raw) {
    if (!isObj(t) || typeof t.field !== 'string') return null;
    const spec = specOf(on, t.field), op = TEST_OPS.find(o => o === t.op);
    if (!spec || !op || !opsFor(spec).includes(op)) return null;
    const value = valueOf(spec, t.value);
    if (value === undefined) return null;
    where.push({ field: t.field, op, value });
  }
  const m = isObj(v.measure) ? v.measure : { of: 'facts' };
  let measure: CountMeasure = { of: 'facts' };
  if (m.of === 'sum' || m.of === 'max' || m.of === 'distinct') {
    if (typeof m.field !== 'string' || !measureFields(on, m.of).includes(m.field)) return null;
    measure = { of: m.of, field: m.field };
  } else if (m.of !== 'facts') return null;
  const within = WITHINS.find(w => w === v.within) ?? 'ever';
  return { on, where, measure, within };
}
/** A count's place from outside data (a hunter's feat state): its number in bounds, its mark, its values; junk is none. */
export function parseCounted(v: unknown): Counted {
  if (!isObj(v)) return NO_COUNT;
  const n = typeof v.n === 'number' && Number.isFinite(v.n) ? Math.max(0, Math.min(COUNT_MAX, Math.round(v.n))) : 0;
  const mark = typeof v.mark === 'string' ? v.mark.slice(0, 40) : '';
  const vals = Array.isArray(v.vals) ? v.vals.filter((x): x is string => typeof x === 'string').slice(-VALS_MAX).map(x => x.slice(0, 80)) : null;
  return vals && vals.length ? { n, mark, vals } : { n, mark };
}

// ── a quest's objective the System counts (feature 1's notes 17.14) ──
/**
 * An objective the System counts: its count (the `FactCount` a feat counts with) and where it stands in its window (its
 * mark, a distinct count's values). Its number is the objective's own `progress`, capped at the objective's target.
 */
export type ObjectiveCount = { readonly rule: FactCount; readonly mark: string; readonly vals?: readonly string[] };
/** An objective's count from outside data, or null: a rule `parseCount` refuses leaves the objective moved by taps. */
export function parseObjectiveCount(v: unknown): ObjectiveCount | null {
  if (!isObj(v)) return null;
  const rule = parseCount(v.rule);
  if (!rule) return null;
  const c = parseCounted(v);
  return { rule, mark: c.mark, ...(c.vals ? { vals: c.vals } : {}) };
}
/**
 * Counted objective `o` after fact `f` in the window of `mark` (`markOf`): its progress and count, or null when the fact
 * does not move it. A full objective is not counted again, so a row broken after it was full does not empty it.
 */
export function objectiveStep(o: { readonly target: number; readonly progress: number; readonly count: ObjectiveCount }, f: Fact, mark: string): { progress: number; count: ObjectiveCount } | null {
  if (o.progress >= o.target) return null;
  const from: Counted = { n: o.progress, mark: o.count.mark, ...(o.count.vals ? { vals: o.count.vals } : {}) };
  const r = countStep(from, f, o.count.rule, mark);
  if (r === null || r.to === 'same') return null;
  const to = r.count;
  return { progress: Math.min(o.target, to.n), count: { rule: o.count.rule, mark: to.mark, ...(to.vals ? { vals: to.vals } : {}) } };
}
