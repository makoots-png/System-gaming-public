// day.ts: the day's clock, one rule of time for the daily quests, the penalty and an urgent quest's due time. A day is
// named by its key, the local calendar date (YYYY-MM-DD) on which it began, and it begins at the first local instant at
// or after the reset hour on that date (`resetOn`). The day key and the countdown's next reset are both read from that
// instant, so the key turns exactly when the countdown reaches zero, on a day the clocks change too. Pure: every
// function takes the time; the local time zone is the one the phone runs in.

import type { Brand } from './ids.ts';

/** A day's name: the local date it began on, `YYYY-MM-DD` (`dayKey`). Made only by `dayKey` and read by `parseDayKey`. */
export type DayKey = Brand<string, 'DayKey'>;
const DAY_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;
/** A stored day key, or null when it is not one. */
export const parseDayKey = (v: unknown): DayKey | null => (typeof v === 'string' && DAY_KEY_RE.test(v) ? (v as DayKey) : null);

const HOUR_MS = 3600e3;
/** The latest instant a JavaScript date can hold, in ms either side of 1970. */
const DATE_LIMIT_MS = 8.64e15;
const pad = (n: number): string => String(n).padStart(2, '0');
const keyOf = (d: Date): DayKey => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` as DayKey;

/** The instant the day of local date y-m-d begins: `hour`:00 local, or the first instant after it when the clocks skip it. */
const resetOn = (y: number, m: number, d: number, hour: number): Date => new Date(y, m, d, hour);

/** The day that holds `now`, at reset hour `hour` (0 to 23): the local date whose reset is the last one at or before `now`. */
export function dayKey(now: Date, hour: number): DayKey {
  const y = now.getFullYear(), m = now.getMonth(), d = now.getDate();
  return now.getTime() < resetOn(y, m, d, hour).getTime() ? keyOf(new Date(y, m, d - 1)) : keyOf(new Date(y, m, d));
}

/**
 * When a step happens: the time `now` as stored, and its day at the save's reset hour (`dayKey`). The one answer for every
 * step that is dated (a grant, a quest's end, a fight's settle), so no two steps of one moment read two days (implicit
 * audit 2, N13). The save's repair keeps the hour a whole number from 0 to 23.
 */
export const stepTime = (save: { readonly settings: { readonly dailyResetHour: number } }, now: Date): { at: string; today: DayKey } =>
  ({ at: now.toISOString(), today: dayKey(now, save.settings.dailyResetHour) });

/** The next reset after `now`: when `dayKey` turns, and what the daily countdown counts down to. */
export function nextReset(now: Date, hour: number): Date {
  const y = now.getFullYear(), m = now.getMonth(), d = now.getDate(), today = resetOn(y, m, d, hour);
  return now.getTime() < today.getTime() ? today : resetOn(y, m, d + 1, hour);
}

/** Whole days from day key `a` to day key `b`: calendar days, so a 23 or 25 hour day at a clock change is one. */
export const dayGap = (a: DayKey, b: DayKey): number => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400e3);

/** The due time `hours` after `now` (the forms' "Due in hours"), or null when that is no time ahead a date can hold. */
export function dueAt(hours: number, now: Date): string | null {
  const t = now.getTime() + hours * HOUR_MS;
  return hours > 0 && Math.abs(t) <= DATE_LIMIT_MS ? new Date(t).toISOString() : null;
}

/** A time as a save or a form holds it: the ISO text of a time a date can hold, or null for anything else. */
export function timeOf(v: unknown): string | null {
  const t = typeof v === 'string' ? Date.parse(v) : Number.NaN;
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

/**
 * Two times as a save holds them (ISO text) compared as instants: below 0 when `a` is earlier, above 0 when later, 0 when
 * the same. A text that is no time (`''` for never) is earlier than every time. The one way two stored times are compared,
 * so no caller compares their text (tests/lint.test.ts).
 */
export function compareTimes(a: string | null, b: string | null): number {
  const x = msOf(a), y = msOf(b);
  return x < y ? -1 : x > y ? 1 : 0;
}
const msOf = (v: string | null): number => { const t = v ? Date.parse(v) : Number.NaN; return Number.isFinite(t) ? t : -Infinity; };

/**
 * The longest the phone waits before it reads the wall clock again. A timer counts the phone's running time, not the
 * wall clock: when the wall clock moves under it (a laptop asleep with the page shown, the clock or the time zone set
 * by hand) a timer set for the next reset is still hours away. Within this long the rollover sees the new time.
 */
export const RECHECK_MS = 60_000;
