// warning.ts: Variant 1 warning window layout contract, ordering, focus, Enter target, typed match, and runtime faults.
// Pure: no DOM, no storage, no network. src/views/ui.js draws every Variant 1 red window through `ui.warn`, using these
// functions, and reports any `warningFaults` to `reported()` so browser tests fail on malformed built strings.
import type { SystemKind } from './protocol.ts';

/** The two red window kinds `ui.warn` renders. */
export type WarningKind = Extract<SystemKind, 'warning' | 'penalty'>;

/** Every toast and fight-news kind (`public/app.css` `.toast-*`, `map.js` `.mp-news.*`). Replaces the broken `'warn'`. */
export const TOAST_KINDS = ['info', 'warning', 'good', 'levelup'] as const;
export type ToastKind = (typeof TOAST_KINDS)[number];

/**
 * One action button in a System or warning window.
 * Combining `primary: true` and `danger: true` is a type error: Variant 1 separates cyan filled primary actions from
 * red-outline danger actions.
 */
export type SystemAction =
  | { readonly label: string; readonly value?: unknown; readonly cancel?: boolean; readonly primary?: boolean; readonly danger?: false }
  | { readonly label: string; readonly value?: unknown; readonly cancel?: boolean; readonly primary?: false; readonly danger?: boolean };

/** Required confirmation word for a typed destructive prompt (matched case-insensitively with collapsed whitespace). */
export type WarningMatch = {
  readonly word: string;
  readonly error?: string;
};

/** Text confirmation field inside a Variant 1 warning window. */
export type WarningForm = {
  readonly label: string;
  readonly value?: string;
  readonly maxlength?: number;
  readonly match?: WarningMatch;
};

/** Input accepted by `ui.warn`, `warningWindow`, and `warningFaults`. */
export type WarningInput = {
  readonly tag: string;
  readonly title: string;
  readonly kind?: WarningKind;
  readonly body?: string | readonly string[];
  readonly lines?: readonly string[];
  readonly actions?: readonly SystemAction[];
  readonly form?: WarningForm;
};

/** Normalized Variant 1 warning window specification returned by `warningWindow`. */
export type WarningSpec = {
  readonly tag: string;
  readonly title: string;
  readonly kind: WarningKind;
  readonly body: readonly string[];
  readonly lines: readonly string[];
  readonly actions: readonly SystemAction[];
  readonly form?: WarningForm;
};

/** Bare one-word labels forbidden on non-cancel warning actions (must name the target). */
const BARE_LABELS: ReadonlySet<string> = new Set([
  'confirm', 'ok', 'yes', 'delete', 'remove', 'reset', 'replace', 'clear',
  'restore', 'discard', 'abandon', 'release', 'overwrite', 'respec',
  'continue', 'proceed', 'submit',
]);

/** Collapses whitespace and lowercases text for typed confirmation comparisons. */
export const normalizeTyped = (text: string): string => text.replace(/\s+/g, ' ').trim().toLowerCase();

/** Whether `typed` matches `match.word` (case-insensitive, collapsed whitespace). */
export const matchTyped = (typed: string, match: WarningMatch): boolean =>
  normalizeTyped(typed) === normalizeTyped(match.word);

/** Bucket rank for Variant 1 stacked button order: primary (0), danger (1), plain (2), cancel (3). */
const actionRank = (a: SystemAction): number =>
  a.primary ? 0 : a.danger ? 1 : a.cancel ? 3 : 2;

/** Returns actions in fixed Variant 1 stack order (primary, danger, plain, cancel), preserving order within each group. */
export function orderWarningActions(actions: readonly SystemAction[]): SystemAction[] {
  return [...actions].sort((a, b) => actionRank(a) - actionRank(b));
}

/** Normalizes a `WarningInput` into a `WarningSpec` ready for `ui.js` to draw. */
export function warningWindow(w: WarningInput): WarningSpec {
  const rawBody = Array.isArray(w.body) ? w.body : typeof w.body === 'string' ? [w.body] : [];
  const body = rawBody.map(s => String(s).trim()).filter(Boolean);
  const lines = (w.lines ?? []).map(String).filter(Boolean);
  const actions: readonly SystemAction[] = w.actions && w.actions.length
    ? orderWarningActions(w.actions)
    : [{ label: 'Close', value: null, cancel: true }];
  return {
    tag: w.tag,
    title: w.title,
    kind: w.kind ?? 'warning',
    body,
    lines,
    actions,
    ...(w.form ? { form: w.form } : {}),
  };
}

/** Whether `title` is shouted in all caps (3+ ASCII letters with no lowercase letter). */
function isAllCapsTitle(title: string): boolean {
  const letters = title.replace(/[^A-Za-z]/g, '');
  return letters.length >= 3 && title === title.toUpperCase();
}

/**
 * Rule breaks in a Variant 1 warning window. `ui.warn` reports each hit via `reported()` so tests fail on malformed
 * strings, including dynamically built titles, tags, or labels.
 */
export function warningFaults(w: WarningInput): string[] {
  const faults: string[] = [];
  const tag = String(w.tag ?? '').trim();
  const title = String(w.title ?? '').trim();
  if (!tag) faults.push('warning tag must not be blank');
  else if (tag.includes('!')) faults.push(`warning tag must not contain "!": ${tag}`);
  if (!title) faults.push('warning title must not be blank');
  else if (isAllCapsTitle(title)) faults.push(`warning title must use sentence case, not all caps: ${title}`);

  const actions = w.actions ?? [];
  let primaries = 0;
  for (const a of actions) {
    const raw = a as { label?: string; primary?: boolean; danger?: boolean; cancel?: boolean };
    if (raw.primary) primaries++;
    if (raw.primary && raw.danger) faults.push(`warning action cannot be both primary and danger: ${raw.label ?? ''}`);
    const words = String(raw.label ?? '').trim();
    if (!words) { faults.push('warning action label must not be blank'); continue; }
    if (!raw.cancel && BARE_LABELS.has(words.toLowerCase())) {
      faults.push(`warning action label is too vague or bare: ${words}`);
    } else if (raw.danger && words.split(/\s+/).length < 2) {
      faults.push(`danger action label must be at least two words: ${words}`);
    }
  }
  if (primaries > 1) faults.push(`warning window has ${primaries} primary actions (at most 1 allowed)`);
  return faults;
}

/**
 * The action triggered by Enter in a form input or Ctrl/Cmd+Enter in a form dialog:
 * prefers `primary`, falls back to the first non-cancel action (e.g. danger submit), and never picks Cancel.
 */
export function pickEnterAction(actions: readonly SystemAction[]): SystemAction | null {
  return actions.find(a => a.primary) ?? actions.find(a => !a.cancel) ?? null;
}

/**
 * Index in `actions` that receives initial focus when a window has no form input:
 * prefers `primary`; on a danger window without `primary`, lands on `cancel` so Enter never destroys data;
 * otherwise focuses the first button (or `-1` if there are no actions).
 */
export function pickInitialFocus(actions: readonly SystemAction[]): number {
  const primary = actions.findIndex(a => a.primary);
  if (primary >= 0) return primary;
  if (actions.some(a => a.danger)) {
    const cancel = actions.findIndex(a => a.cancel);
    if (cancel >= 0) return cancel;
  }
  return actions.length > 0 ? 0 : -1;
}
