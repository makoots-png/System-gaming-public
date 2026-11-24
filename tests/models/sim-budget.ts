// Deterministic work-budget runner for tests/fight-sim.test.ts.
// Judges every simulation row on deterministic work counts (fights played, simulation steps, and
// max steps in any single fight) rather than wall or CPU clocks, which inflate unpredictably on
// shared hosts under concurrent load. Calling-thread CPU and wall time are recorded for diagnostic
// logging only and never fail a test; Bun's wide wall-clock timeout guards against true infinite loops.
import { expect, test } from 'bun:test';

/** Deterministic work bounds enforced for one simulation test row. */
export type WorkBudget = {
  /** Maximum `playFight` calls allowed in the row. */
  readonly maxFights: number;
  /** Maximum total simulation steps (`playStep` turns plus direct `reduce` trials) allowed in the row. */
  readonly maxSteps: number;
  /** Maximum `playStep` turns allowed in any single fight of the row. */
  readonly maxFightSteps: number;
};

/** Deterministic work performed during one row, plus diagnostic-only timing in milliseconds. */
export type RowWork = {
  /** Number of `playFight` calls executed during the row. */
  readonly fights: number;
  /** Total simulation steps (`playStep` turns plus direct `reduce` trials) executed during the row. */
  readonly steps: number;
  /** Largest step count of any single fight executed during the row. */
  readonly maxFightSteps: number;
  /** Diagnostic-only calling-thread user CPU time in milliseconds (never asserted). */
  readonly threadUserMs: number;
  /** Diagnostic-only calling-thread system CPU time in milliseconds (never asserted). */
  readonly threadSystemMs: number;
  /** Diagnostic-only elapsed wall-clock time in milliseconds (never asserted). */
  readonly wallMs: number;
};

/** Max `playStep` turns allowed in any single fight (4.3x the 116-step model peak across all rows; 10x below PLAY_STEPS_MAX). */
export const MAX_FIGHT_STEPS = 500;
/** Average steps-per-fight budget factor (about 1.5x the highest row average of 68.8 steps/fight). */
export const MAX_STEPS_PER_FIGHT = 100;

/** Derives a deterministic `WorkBudget` from a row's maximum fight count. */
export function workBudget(maxFights: number, maxSteps: number = maxFights === 0 ? 0 : Math.max(MAX_FIGHT_STEPS, maxFights * MAX_STEPS_PER_FIGHT)): WorkBudget {
  return { maxFights, maxSteps, maxFightSteps: MAX_FIGHT_STEPS };
}

/**
 * Default per-row deterministic work budget for `ROWS` in `tests/fight-sim.test.ts`.
 * Cold-cache maxima across all standard rows: 1,200 fights (`B5`), 55,657 steps (`B5 Zaratan`), 116 steps in one fight.
 */
export const DEFAULT_WORK_BUDGET: WorkBudget = workBudget(1_500);

/** Bun wall-clock hang guard so multi-minute host pauses do not abort healthy rows while true infinite loops still fail. */
export const WALL_TIMEOUT_MS = 600_000;
/** Wall minus thread-user gap above which simTest logs a diagnostic host-stall notice. */
export const PAUSE_NOTE_MS = 10_000;
/** Thread-user threshold above which simTest logs diagnostic timing beside the row output. */
export const CPU_LOG_MS = 5_000;

type ActiveWork = {
  readonly name: string;
  readonly budget: WorkBudget | null;
  fights: number;
  steps: number;
  currentFightSteps: number;
  maxFightSteps: number;
};

let activeWork: ActiveWork | null = null;

/** Formats a deterministic work-budget violation naming the row, measured counts, and limits. */
export function budgetFailureMessage(name: string, work: Pick<RowWork, 'fights' | 'steps' | 'maxFightSteps'>, budget: WorkBudget): string {
  const reasons: string[] = [];
  if (work.fights > budget.maxFights) reasons.push(`fights ${work.fights} > ${budget.maxFights}`);
  if (work.steps > budget.maxSteps) reasons.push(`steps ${work.steps} > ${budget.maxSteps}`);
  if (work.maxFightSteps > budget.maxFightSteps) reasons.push(`maxFightSteps ${work.maxFightSteps} > ${budget.maxFightSteps}`);
  return `${name} exceeded its deterministic work budget (${reasons.join(', ')}; total fights ${work.fights}, steps ${work.steps}, maxFightSteps ${work.maxFightSteps})`;
}

/** Asserts that a row's deterministic work counts stayed within `budget`. Never asserts clock time. */
export function assertRowBudget(name: string, work: Pick<RowWork, 'fights' | 'steps' | 'maxFightSteps'>, budget: WorkBudget): void {
  const msg = budgetFailureMessage(name, work, budget);
  expect(work.fights, msg).toBeLessThanOrEqual(budget.maxFights);
  expect(work.steps, msg).toBeLessThanOrEqual(budget.maxSteps);
  expect(work.maxFightSteps, msg).toBeLessThanOrEqual(budget.maxFightSteps);
}

/** Records the start of one `playFight` call against the active row, failing fast if `maxFights` is exceeded. */
export function beginFight(): void {
  if (!activeWork) return;
  activeWork.fights += 1;
  activeWork.currentFightSteps = 0;
  if (activeWork.budget && activeWork.fights > activeWork.budget.maxFights) {
    throw new Error(budgetFailureMessage(activeWork.name, activeWork, activeWork.budget));
  }
}

/** Records one `playStep` turn in the active fight, failing fast if `maxFightSteps` or `maxSteps` is exceeded. */
export function recordFightStep(): void {
  if (!activeWork) return;
  activeWork.steps += 1;
  activeWork.currentFightSteps += 1;
  if (activeWork.currentFightSteps > activeWork.maxFightSteps) activeWork.maxFightSteps = activeWork.currentFightSteps;
  if (activeWork.budget && (activeWork.steps > activeWork.budget.maxSteps || activeWork.currentFightSteps > activeWork.budget.maxFightSteps)) {
    throw new Error(budgetFailureMessage(activeWork.name, activeWork, activeWork.budget));
  }
}

/** Records direct simulation `reduce` trials (such as `bestUse`) against the active row, failing fast if `maxSteps` is exceeded. */
export function recordSteps(count: number): void {
  if (!activeWork || count <= 0) return;
  activeWork.steps += count;
  if (activeWork.budget && activeWork.steps > activeWork.budget.maxSteps) {
    throw new Error(budgetFailureMessage(activeWork.name, activeWork, activeWork.budget));
  }
}

/** Runs `fn`, returning deterministic work counts and diagnostic-only timing. If `budget` is given, fails fast during execution on any violation. */
export function measureRow(fn: () => void, budget?: WorkBudget, name = 'row'): RowWork {
  const prev = activeWork;
  const current: ActiveWork = { name, budget: budget ?? null, fights: 0, steps: 0, currentFightSteps: 0, maxFightSteps: 0 };
  activeWork = current;
  const thr0 = process.threadCpuUsage();
  const wall0 = performance.now();
  let wallMs = 0;
  let thr = { user: 0, system: 0 };
  try {
    fn();
  } finally {
    wallMs = performance.now() - wall0;
    thr = process.threadCpuUsage(thr0);
    activeWork = prev;
  }
  return {
    fights: current.fights,
    steps: current.steps,
    maxFightSteps: current.maxFightSteps,
    threadUserMs: thr.user / 1000,
    threadSystemMs: thr.system / 1000,
    wallMs,
  };
}

/** Runs one simulation test under a deterministic work budget and a wide wall-clock hang guard. */
export function simTest(name: string, fn: () => void, budget: WorkBudget = DEFAULT_WORK_BUDGET): void {
  test(name, () => {
    const w = measureRow(fn, budget, name);
    const stalledMs = Math.max(0, w.wallMs - w.threadUserMs);
    if (stalledMs >= PAUSE_NOTE_MS) {
      console.log(`  [host pause] ${name}: wall ${(w.wallMs / 1000).toFixed(1)} s, thread-user ${(w.threadUserMs / 1000).toFixed(1)} s, thread-sys ${(w.threadSystemMs / 1000).toFixed(1)} s, stalled ${(stalledMs / 1000).toFixed(1)} s (fights ${w.fights}, steps ${w.steps}, max ${w.maxFightSteps})`);
    } else if (w.threadUserMs >= CPU_LOG_MS) {
      console.log(`  [timing] ${name}: thread-user ${Math.round(w.threadUserMs)} ms, thread-sys ${Math.round(w.threadSystemMs)} ms, wall ${Math.round(w.wallMs)} ms (fights ${w.fights}, steps ${w.steps}, max ${w.maxFightSteps})`);
    }
    assertRowBudget(name, w, budget);
  }, WALL_TIMEOUT_MS);
}
