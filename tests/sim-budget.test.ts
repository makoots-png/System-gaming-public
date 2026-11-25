// Unit tests for tests/models/sim-budget.ts: proves the simulation guard judges deterministic work
// counts (fights, steps, maxFightSteps), fails fast on runaway loops, and never false-fails from
// host stalls, CPU inflation, or clock drift.
import { describe, expect, test } from 'bun:test';
import {
  assertRowBudget,
  beginFight,
  budgetFailureMessage,
  DEFAULT_WORK_BUDGET,
  MAX_FIGHT_STEPS,
  MAX_STEPS_PER_FIGHT,
  measureRow,
  recordFightStep,
  recordSteps,
  WALL_TIMEOUT_MS,
  workBudget,
} from './models/sim-budget.ts';

const sleepSync = (ms: number): void => {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
};

describe('sim-budget deterministic work guard', () => {
  test('never false-fails from host stalls or extreme CPU/wall clock inflation when work stays in budget', () => {
    const budget = workBudget(2);
    const work = measureRow(() => {
      sleepSync(120);
      // Deterministic CPU work independent of wall-clock preemption on shared runners.
      let acc = 1;
      for (let i = 1; i <= 5_000_000; i++) acc = (Math.imul(acc, 1664525) + i) | 0;
      expect(acc).not.toBe(0);
      beginFight();
      for (let i = 0; i < 25; i++) recordFightStep();
      beginFight();
      for (let i = 0; i < 40; i++) recordFightStep();
    }, budget, 'slow host row');

    expect(work.fights).toBe(2);
    expect(work.steps).toBe(65);
    expect(work.maxFightSteps).toBe(40);
    expect(work.wallMs).toBeGreaterThanOrEqual(100);
    expect(Number.isFinite(work.threadUserMs) && work.threadUserMs > 0).toBe(true);
    expect(Number.isFinite(work.threadSystemMs) && work.threadSystemMs >= 0).toBe(true);
    expect(() => assertRowBudget('slow host row', work, budget)).not.toThrow();

    // Even a 20x host slowdown (87 s thread-user CPU, 93 s wall) passes when deterministic counts are inside budget.
    const inflatedHost = { fights: 600, steps: 28_909, maxFightSteps: 82, threadUserMs: 86_998, threadSystemMs: 6_288, wallMs: 93_324 };
    expect(() => assertRowBudget('cannon pen S', inflatedHost, DEFAULT_WORK_BUDGET)).not.toThrow();
  });

  test('fails fast when a runaway loop exceeds maxFights without executing the remaining iterations', () => {
    const budget = { maxFights: 3, maxSteps: 1_000, maxFightSteps: 100 };
    let started = 0;
    expect(() => measureRow(() => {
      for (let i = 0; i < 10_000; i++) {
        started++;
        beginFight();
        recordFightStep();
      }
    }, budget, 'runaway fights')).toThrow(/runaway fights exceeded its deterministic work budget \(fights 4 > 3;/);
    expect(started).toBe(4);
  });

  test('fails fast when a single fight spins past maxFightSteps (even in a 1-fight row)', () => {
    const budget = workBudget(1);
    let stepsRun = 0;
    expect(() => measureRow(() => {
      beginFight();
      for (let i = 0; i < 5_000; i++) {
        stepsRun++;
        recordFightStep();
      }
    }, budget, 'stalemate fight')).toThrow(/stalemate fight exceeded its deterministic work budget \(.*maxFightSteps 501 > 500/);
    expect(stepsRun).toBe(MAX_FIGHT_STEPS + 1);
  });

  test('fails fast when total steps across fights or direct reduce trials exceed maxSteps', () => {
    const budget = { maxFights: 10, maxSteps: 50, maxFightSteps: 30 };
    expect(() => measureRow(() => {
      beginFight();
      for (let i = 0; i < 25; i++) recordFightStep();
      beginFight();
      for (let i = 0; i < 25; i++) recordFightStep();
      beginFight();
      recordFightStep();
    }, budget, 'too many fight steps')).toThrow(/too many fight steps exceeded its deterministic work budget \(steps 51 > 50;/);

    let trials = 0;
    expect(() => measureRow(() => {
      for (let i = 0; i < 5_000; i++) {
        trials++;
        recordSteps(1);
      }
    }, budget, 'runaway bestUse')).toThrow(/runaway bestUse exceeded its deterministic work budget \(steps 51 > 50;/);
    expect(trials).toBe(51);
  });

  test('derives deterministic budgets from fight counts and preserves wide wall hang guard', () => {
    expect(workBudget(0)).toEqual({ maxFights: 0, maxSteps: 0, maxFightSteps: MAX_FIGHT_STEPS });
    expect(workBudget(1)).toEqual({ maxFights: 1, maxSteps: MAX_FIGHT_STEPS, maxFightSteps: MAX_FIGHT_STEPS });
    expect(workBudget(80)).toEqual({ maxFights: 80, maxSteps: 80 * MAX_STEPS_PER_FIGHT, maxFightSteps: MAX_FIGHT_STEPS });
    expect(workBudget(3_600)).toEqual({ maxFights: 3_600, maxSteps: 3_600 * MAX_STEPS_PER_FIGHT, maxFightSteps: MAX_FIGHT_STEPS });
    expect(DEFAULT_WORK_BUDGET.maxFights).toBeGreaterThanOrEqual(1_200);
    expect(DEFAULT_WORK_BUDGET.maxSteps).toBeGreaterThanOrEqual(100_000);
    expect(DEFAULT_WORK_BUDGET.maxFightSteps).toBe(MAX_FIGHT_STEPS);
    expect(WALL_TIMEOUT_MS).toBeGreaterThanOrEqual(600_000);

    const over = { fights: 1_501, steps: 200_000, maxFightSteps: 501 };
    expect(() => assertRowBudget('bad row', over, DEFAULT_WORK_BUDGET)).toThrow(budgetFailureMessage('bad row', over, DEFAULT_WORK_BUDGET));
  });

  test('treats work recorders as no-ops outside measureRow and isolates nested measurements', () => {
    expect(() => {
      beginFight();
      recordFightStep();
      recordSteps(10);
    }).not.toThrow();

    const outer = measureRow(() => {
      beginFight();
      recordFightStep();
      const inner = measureRow(() => {
        beginFight();
        for (let i = 0; i < 4; i++) recordFightStep();
      });
      expect(inner.fights).toBe(1);
      expect(inner.steps).toBe(4);
      expect(inner.maxFightSteps).toBe(4);
      recordFightStep();
    });
    expect(outer.fights).toBe(1);
    expect(outer.steps).toBe(2);
    expect(outer.maxFightSteps).toBe(2);
  });
});
