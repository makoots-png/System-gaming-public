import { afterEach, describe, expect, test } from 'bun:test';
import { dayGap, dayKey, dueAt, nextReset, compareTimes, stepTime } from '../src/core/day.ts';
import { day as key } from './fixtures/ids.ts';

// The day's rule, from design: a day is named by the local date it began on, and it begins at the reset hour, local
// time (the first instant after it when the clocks skip it). Each zone is set with TZ, as a phone in that zone runs.
const ZONE = process.env.TZ;
afterEach(() => { process.env.TZ = ZONE ?? 'Etc/UTC'; });
const inZone = (tz: string): void => { process.env.TZ = tz; };
const at = (iso: string): Date => new Date(iso);
const MIN = 60e3, HOUR = 3600e3;

describe('the day a time falls in, and the reset the countdown shows', () => {
  // [zone, the day the clocks change, reset hour, a time before that day's reset, the reset (UTC), a time after it]
  const rows: [string, string, number, string, string, string][] = [
    // Berlin springs from 02:00 CET to 03:00 CEST on 29 March 2026: 04:00 CEST is 02:00 UTC
    ['Europe/Berlin', '2026-03-29', 4, '2026-03-29T01:59:00Z', '2026-03-29T02:00:00.000Z', '2026-03-29T02:30:00Z'],
    ['Europe/Berlin', '2026-03-29', 0, '2026-03-28T22:59:00Z', '2026-03-28T23:00:00.000Z', '2026-03-28T23:30:00Z'],
    // Berlin falls from 03:00 CEST to 02:00 CET on 25 October 2026: 04:00 CET is 03:00 UTC
    ['Europe/Berlin', '2026-10-25', 4, '2026-10-25T02:30:00Z', '2026-10-25T03:00:00.000Z', '2026-10-25T03:30:00Z'],
    ['Europe/Berlin', '2026-10-25', 0, '2026-10-24T21:59:00Z', '2026-10-24T22:00:00.000Z', '2026-10-24T22:30:00Z'],
    // New York springs from 02:00 EST to 03:00 EDT on 8 March 2026: 04:00 EDT is 08:00 UTC; 02:00 is skipped, so the
    // day begins at 03:00 EDT
    ['America/New_York', '2026-03-08', 4, '2026-03-08T07:59:00Z', '2026-03-08T08:00:00.000Z', '2026-03-08T08:30:00Z'],
    ['America/New_York', '2026-03-08', 0, '2026-03-08T04:59:00Z', '2026-03-08T05:00:00.000Z', '2026-03-08T05:30:00Z'],
    ['America/New_York', '2026-03-08', 2, '2026-03-08T06:59:00Z', '2026-03-08T07:00:00.000Z', '2026-03-08T07:30:00Z'],
    // New York falls from 02:00 EDT to 01:00 EST on 1 November 2026: 04:00 EST is 09:00 UTC
    ['America/New_York', '2026-11-01', 4, '2026-11-01T08:59:00Z', '2026-11-01T09:00:00.000Z', '2026-11-01T09:30:00Z'],
    ['America/New_York', '2026-11-01', 0, '2026-11-01T03:59:00Z', '2026-11-01T04:00:00.000Z', '2026-11-01T04:30:00Z'],
  ];
  for (const [zone, day, hour, before, reset, after] of rows) {
    test(`${zone} on ${day}, reset at ${hour}:00: the day turns at the reset the countdown counts down to`, () => {
      inZone(zone);
      const yesterday = new Date(Date.parse(day + 'T12:00:00Z') - 24 * HOUR).toISOString().slice(0, 10);
      expect(nextReset(at(before), hour).toISOString()).toBe(reset);
      expect(dayKey(at(before), hour)).toBe(key(yesterday));
      expect(dayKey(at(reset), hour)).toBe(key(day));
      expect(dayKey(at(after), hour)).toBe(key(day));
      expect(nextReset(at(after), hour).getTime()).toBeGreaterThan(at(reset).getTime() + 22 * HOUR);
    });
  }

  test('in every zone and at every reset hour, around every clock change of 2026, the key turns only at the next reset, to the next date', () => {
    const zones = ['Etc/UTC', 'Europe/Berlin', 'America/New_York', 'America/Santiago', 'Australia/Lord_Howe', 'Asia/Kolkata'];
    let checked = 0;
    for (const zone of zones) {
      inZone(zone);
      const year = Date.parse('2026-01-01T00:00:00Z'), changes = [year + 100 * 24 * HOUR];
      for (let t = year; t < year + 365 * 24 * HOUR; t += HOUR) {
        if (new Date(t).getTimezoneOffset() !== new Date(t + HOUR).getTimezoneOffset()) changes.push(t);
      }
      for (const change of changes) {
        for (let hour = 0; hour < 24; hour++) {
          for (let t = change - 36 * HOUR; t < change + 36 * HOUR; t += 20 * MIN) {
            const now = new Date(t), next = nextReset(now, hour), key = dayKey(now, hour);
            const why = `${zone}, reset ${hour}:00, at ${now.toISOString()}`;
            expect(next.getTime(), why).toBeGreaterThan(t);
            expect(next.getTime() - t, why).toBeLessThanOrEqual(25 * HOUR);
            expect(dayKey(new Date(next.getTime() - 1), hour), why).toBe(key);
            expect(dayGap(key, dayKey(next, hour)), why).toBe(1);
            expect(next.getHours() === hour || next.getHours() === hour + 1 || next.getMinutes() !== 0, why).toBe(true);
            checked++;
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(zones.length * 24 * 216);
  });
});

describe('days between keys', () => {
  test('calendar days, whatever the hours in between', () => {
    expect(dayGap(key('2026-03-28'), key('2026-03-30'))).toBe(2);
    expect(dayGap(key('2026-10-24'), key('2026-10-25'))).toBe(1);
    expect(dayGap(key('2026-12-31'), key('2027-01-01'))).toBe(1);
  });
});

describe('a due time from hours', () => {
  const now = at('2026-11-14T10:00:00.000Z');
  test('the time that many hours ahead', () => {
    expect(dueAt(1.5, now)).toBe('2026-11-14T11:30:00.000Z');
    expect(dueAt(999, now)).toBe('2026-12-26T01:00:00.000Z');
  });
  test('no due time for no hours, hours behind, or more hours than a date can hold', () => {
    for (const hours of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, 1e15]) expect(dueAt(hours, now)).toBeNull();
  });
});

describe('two stored times compared (audit row 59)', () => {
  test('they are compared as instants, not as text: 09:00 at UTC-2 is after 10:00 UTC', () => {
    expect('2026-11-14T09:00:00-02:00' > '2026-11-14T10:00:00Z', 'the text alone says earlier').toBe(false);
    expect(compareTimes('2026-11-14T09:00:00-02:00', '2026-11-14T10:00:00Z')).toBe(1);
    expect(compareTimes('2026-11-14T10:00:00Z', '2026-11-14T10:00:00.000Z')).toBe(0);
    expect(compareTimes('2026-11-14T10:00:00Z', '2026-11-14T10:00:01Z')).toBe(-1);
  });

  test('never (an empty text) and a text that is no time are earlier than every time', () => {
    expect(compareTimes('', '1970-01-01T00:00:00Z')).toBe(-1);
    expect(compareTimes('soon', '')).toBe(0);
    expect(compareTimes(null, '2026-11-14T10:00:00Z')).toBe(-1);
  });
});

describe('when a step happens (stepTime)', () => {
  test('the time as stored and its day at the save\'s reset hour: before the hour it is still yesterday', () => {
    const at = (h: number) => ({ settings: { dailyResetHour: h } });
    const now = new Date(2026, 10, 15, 5, 30);
    expect(stepTime(at(6), now)).toEqual({ at: now.toISOString(), today: dayKey(now, 6) });
    expect(stepTime(at(6), now).today).toBe(key('2026-11-14'));
    expect(stepTime(at(0), now).today).toBe(key('2026-11-15'));
  });
});
