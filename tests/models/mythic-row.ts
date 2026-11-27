// mythic-row.ts: shared assertion helper for solo Mythic boss simulation rows.
// Pure row contract with zero class names: enforces the 75%..98% win-rate band, zero capped fights,
// exact baseline win ratchet, per-boss tally floors, and the plain-only ceiling + pressure clause.
import { expect } from 'bun:test';
import { PLAIN } from '../../src/core/registry/mythics.ts';
import type { MythicScriptId } from '../../src/core/registry/mythics.ts';
import type { SoloMythicResult } from './fight-sim.ts';

/** Standard seeded fight count per solo boss row. */
export const SOLO_RUNS = 200;
/** Minimum acceptable win rate on any solo boss row. */
export const SOLO_FLOOR = 0.75;
/** Default maximum acceptable win rate on any solo boss row. */
export const SOLO_CEILING = 0.98;
/** Maximum allowed ceiling when a plain row declares a passing pressure floor. */
export const SOLO_PLAIN_MAX_CEILING = 1.0;
/** Minimum required pressure floor rate whenever a plain row declares ceiling > SOLO_CEILING. */
export const SOLO_PRESSURE_MIN_FLOOR = 0.5;

/** One per-boss mechanical or hook tally check declared as data. */
export type TallyCheck = {
  readonly name: string;
  readonly actual: number;
  readonly min: number;
  readonly max?: number;
};

/** Pressure floor required whenever a plain row declares ceiling > SOLO_CEILING. */
export type PressureCheck = {
  readonly label?: string;
  readonly minRate: number;
  readonly actual: number;
  /** Exact recorded pressure rate ratchet (required whenever ceiling > SOLO_CEILING). */
  readonly exact?: number;
};

/** Input contract for one solo boss simulation row. */
export type SoloRowOpts = {
  readonly className: string;
  readonly boss: MythicScriptId;
  readonly res: SoloMythicResult;
  readonly baseline: number;
  readonly ceiling?: number;
  readonly pressure?: PressureCheck;
  readonly tallies?: readonly TallyCheck[];
  readonly label?: string;
  readonly quiet?: boolean;
};

/**
 * Verifies one solo boss simulation row against the shared ceiling, floor, cap, ratchet, pressure,
 * and tally contract. Allows `ceiling > 0.98` (up to `1.0`) only on `plain` and only when a passing
 * `pressure` floor (`minRate >= SOLO_PRESSURE_MIN_FLOOR`, `actual >= minRate`) is supplied.
 */
export function soloRow(opts: SoloRowOpts): void {
  const ceil = opts.ceiling ?? SOLO_CEILING;
  const tag = opts.label ? `${opts.className} (${opts.label}) vs ${opts.boss}` : `${opts.className} vs ${opts.boss}`;
  const pct = (opts.res.winRate * 100).toFixed(1);
  const se = (opts.res.se * 100).toFixed(1);

  if (!opts.quiet) {
    const pressNote = opts.pressure
      ? `, ${opts.pressure.label ?? 'pressure'} ${(opts.pressure.actual * 100).toFixed(1)}% (floor ${(opts.pressure.minRate * 100).toFixed(0)}%)`
      : '';
    console.log(
      `[solo-mythic] ${tag}: ${pct}% (${opts.res.wins}/${opts.res.runs}, se ${se}%, mean ${opts.res.meanRounds.toFixed(1)} rounds, ${opts.res.capped} capped, baseline ${opts.baseline}/${opts.res.runs}${pressNote})`,
    );
  }

  expect(Number.isFinite(ceil), `${tag}: ceiling must be finite`).toBe(true);
  expect(ceil, `${tag}: ceiling ${ceil} below floor ${SOLO_FLOOR}`).toBeGreaterThanOrEqual(SOLO_FLOOR);
  expect(ceil, `${tag}: ceiling ${ceil} exceeds max ${SOLO_PLAIN_MAX_CEILING}`).toBeLessThanOrEqual(SOLO_PLAIN_MAX_CEILING);

  if (ceil > SOLO_CEILING) {
    expect(opts.boss, `${tag}: ceiling ${ceil} > ${SOLO_CEILING} is only allowed on ${PLAIN}`).toBe(PLAIN);
    expect(opts.pressure, `${tag}: ceiling ${ceil} > ${SOLO_CEILING} on ${PLAIN} requires a pressure floor`).toBeDefined();
    expect(
      opts.pressure!.minRate,
      `${tag}: pressure minRate ${opts.pressure!.minRate} below required floor ${SOLO_PRESSURE_MIN_FLOOR}`,
    ).toBeGreaterThanOrEqual(SOLO_PRESSURE_MIN_FLOOR);
    expect(opts.pressure!.minRate, `${tag}: pressure minRate must be <= 1`).toBeLessThanOrEqual(1);
    expect(
      opts.pressure!.exact,
      `${tag}: ceiling ${ceil} > ${SOLO_CEILING} on ${PLAIN} requires pressure.exact`,
    ).toBeDefined();
    expect(
      Number.isFinite(opts.pressure!.exact),
      `${tag}: pressure.exact must be finite`,
    ).toBe(true);
  }

  if (opts.pressure) {
    const pName = opts.pressure.label ?? 'pressure';
    expect(
      opts.pressure.actual,
      `${tag}: ${pName} ${(opts.pressure.actual * 100).toFixed(1)}% below floor ${(opts.pressure.minRate * 100).toFixed(1)}%`,
    ).toBeGreaterThanOrEqual(opts.pressure.minRate);
    if (opts.pressure.exact !== undefined) {
      expect(
        opts.pressure.actual,
        `${tag}: ${pName} ${(opts.pressure.actual * 100).toFixed(1)}% drifted from recorded ${(opts.pressure.exact * 100).toFixed(1)}%`,
      ).toBe(opts.pressure.exact);
    }
  }

  expect(opts.res.mythicId, `${tag}: result boss ${opts.res.mythicId} does not match ${opts.boss}`).toBe(opts.boss);
  expect(opts.res.runs, `${tag}: runs ${opts.res.runs} must equal SOLO_RUNS (${SOLO_RUNS})`).toBe(SOLO_RUNS);
  expect(
    opts.res.winRate,
    `${tag}: winRate ${opts.res.winRate} does not match wins/runs (${opts.res.wins}/${opts.res.runs})`,
  ).toBe(opts.res.wins / opts.res.runs);
  expect(opts.res.capped, `${tag}: had ${opts.res.capped} capped fights`).toBe(0);
  expect(
    opts.res.winRate,
    `${tag}: win rate ${pct}% below ${(SOLO_FLOOR * 100).toFixed(0)}% floor`,
  ).toBeGreaterThanOrEqual(SOLO_FLOOR);
  expect(
    opts.res.winRate,
    `${tag}: win rate ${pct}% above ${(ceil * 100).toFixed(1)}% ceiling`,
  ).toBeLessThanOrEqual(ceil);
  expect(
    opts.res.wins,
    `${tag}: wins ${opts.res.wins}/${opts.res.runs} drifted from recorded baseline ${opts.baseline}/${opts.res.runs}`,
  ).toBe(opts.baseline);

  for (const t of opts.tallies ?? []) {
    expect(
      t.actual,
      `${tag}: tally "${t.name}" (${t.actual}) below floor ${t.min}`,
    ).toBeGreaterThanOrEqual(t.min);
    if (t.max !== undefined) {
      expect(
        t.actual,
        `${tag}: tally "${t.name}" (${t.actual}) above max ${t.max}`,
      ).toBeLessThanOrEqual(t.max);
    }
  }
}
