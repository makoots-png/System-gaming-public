import { describe, expect, test } from 'bun:test';
import { presenceAge, rosterSignature, rosterStatus } from '../src/core/sync/connection.ts';
import type { RosterEntry } from '../src/core/sync/connection.ts';

describe('presenceAge', () => {
  test('maps null and non-finite inputs to null and clamps negative skew to now', () => {
    expect(presenceAge(null)).toBeNull();
    expect(presenceAge(Number.NaN)).toBeNull();
    expect(presenceAge(Number.POSITIVE_INFINITY)).toBeNull();
    expect(presenceAge(-5_000)).toEqual({ unit: 'now' });
  });

  test('buckets elapsed milliseconds into now, minutes, hours, and days', () => {
    expect(presenceAge(0)).toEqual({ unit: 'now' });
    expect(presenceAge(29_999)).toEqual({ unit: 'now' });
    expect(presenceAge(30_000)).toEqual({ unit: 'min', value: 1 });
    expect(presenceAge(89_999)).toEqual({ unit: 'min', value: 1 });
    expect(presenceAge(90_000)).toEqual({ unit: 'min', value: 2 });
    expect(presenceAge(59 * 60_000)).toEqual({ unit: 'min', value: 59 });
    expect(presenceAge(60 * 60_000)).toEqual({ unit: 'hour', value: 1 });
    expect(presenceAge(23 * 60 * 60_000)).toEqual({ unit: 'hour', value: 23 });
    expect(presenceAge(24 * 60 * 60_000)).toEqual({ unit: 'day', value: 1 });
  });
});

describe('rosterStatus', () => {
  test('renders online, away, and unknown states from structured state and elapsed ms', () => {
    expect(rosterStatus('online', null)).toBe('online');
    expect(rosterStatus('online', 5_000)).toBe('online');
    expect(rosterStatus('online', 120_000)).toBe('online');

    expect(rosterStatus('away', null)).toBe('away');
    expect(rosterStatus('away', 10_000)).toBe('away');
    expect(rosterStatus('away', 29_999)).toBe('away');
    expect(rosterStatus('away', 30_000)).toBe('away 1 min');
    expect(rosterStatus('away', 120_000)).toBe('away 2 min');
    expect(rosterStatus('away', 2 * 3600_000)).toBe('away 2 h');
    expect(rosterStatus('away', 3 * 86400_000)).toBe('away 3 d');

    expect(rosterStatus('unknown', null)).toBe('');
    expect(rosterStatus('unknown', 10_000)).toBe('last sync a moment ago');
    expect(rosterStatus('unknown', 60_000)).toBe('last sync 1 min ago');
    expect(rosterStatus('unknown', 3600_000)).toBe('last sync 1 h ago');
    expect(rosterStatus('unknown', 86400_000)).toBe('last sync 1 d ago');
  });
});

describe('rosterSignature', () => {
  const row = (overrides: Partial<RosterEntry> = {}): RosterEntry => ({
    key: 'd-p1:h1',
    name: 'Kai',
    level: 5,
    job: 'Shadow',
    state: 'away',
    seenMs: 10_000,
    ...overrides,
  });
  const idle = () => false;

  test('stays identical across polls in the same age bucket so an open Manage panel keeps focus', () => {
    const open = new Set(['d-p1:h1']);
    expect(rosterSignature([row({ state: 'online', seenMs: 1_000 })], open, idle))
      .toBe(rosterSignature([row({ state: 'online', seenMs: 12_000 })], open, idle));
    expect(rosterSignature([row({ state: 'away', seenMs: 16_000 })], open, idle))
      .toBe(rosterSignature([row({ state: 'away', seenMs: 28_000 })], open, idle));
    expect(rosterSignature([row({ state: 'away', seenMs: 35_000 })], open, idle))
      .toBe(rosterSignature([row({ state: 'away', seenMs: 85_000 })], open, idle));
  });

  test('changes when the age bucket changes, when state changes, or when open or busy changes', () => {
    const open = new Set(['d-p1:h1']);
    const atNow = rosterSignature([row({ state: 'away', seenMs: 20_000 })], open, idle);
    const atOneMin = rosterSignature([row({ state: 'away', seenMs: 65_000 })], open, idle);
    const atTwoMin = rosterSignature([row({ state: 'away', seenMs: 125_000 })], open, idle);
    expect(atNow).not.toBe(atOneMin);
    expect(atOneMin).not.toBe(atTwoMin);

    expect(rosterSignature([row({ state: 'online', seenMs: 5_000 })], open, idle))
      .not.toBe(atNow);
    expect(rosterSignature([row({ state: 'away', seenMs: 20_000 })], new Set(), idle))
      .not.toBe(atNow);
    expect(rosterSignature([row({ state: 'away', seenMs: 20_000 })], open, k => k === 'd-p1:h1'))
      .not.toBe(atNow);
  });
});
