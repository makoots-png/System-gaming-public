// Pure machine-stall detection for the lag test (tests/e2e/feel.e2e.ts).
// Keeps every app bound unchanged while distinguishing host pauses and host memory slowdowns from app work.

/** One interval between consecutive V8 CPU profiler samples, in ms relative to feel-start. */
export type SampleInterval = {
  readonly startMs: number;
  readonly endMs: number;
  readonly dtMs: number;
};

/** One fixed memory-walk timing from the background canary worker, in ms relative to feel-start. */
export type CanarySample = {
  readonly startMs: number;
  readonly endMs: number;
  readonly wallMs: number;
  readonly ratio: number;
};

/** One main-thread RunTask from the measured page's Chrome trace, in ms relative to feel-start. */
export type TaskSpan = {
  readonly cpu: number;
  readonly wall: number;
  readonly startMs: number;
  readonly endMs: number;
  readonly after: string;
  readonly parts: string;
};

/** One frame gap or tap-to-first-frame duration, in ms relative to feel-start. */
export type TimedSpan = {
  readonly ms: number;
  readonly startMs: number;
  readonly endMs: number;
  readonly after: string;
};

/** One RunTask on a Chrome rendering pipeline thread (Compositor, Viz, GPU) during the window. */
export type PipelineTask = {
  readonly cpu: number;
  readonly startMs: number;
  readonly endMs: number;
};

export type FeelWindow = {
  readonly frames: readonly TimedSpan[];
  readonly taps: readonly TimedSpan[];
  readonly tasks: readonly TaskSpan[];
  readonly pipelineTasks: readonly PipelineTask[];
  readonly profilerSamples: readonly SampleInterval[];
  readonly canarySamples: readonly CanarySample[];
};

export type StallVerdict =
  | { readonly outcome: 'pass' }
  | { readonly outcome: 'rerun'; readonly reasons: readonly string[] }
  | { readonly outcome: 'fail'; readonly reasons: readonly string[] };

/** Minimal V8 CPU profile fields needed to build sample intervals (timestamps are in microseconds). */
export type ProfileTicks = {
  readonly startTime: number;
  readonly samples: readonly number[];
  readonly timeDeltas: readonly number[];
};

// Measured on this 8-vCPU box (see .lead-scratch/lag-findings.md):
// - At 1 ms V8 sampling, normal tasks and 30 to 219 ms real JS/DOM/Layout/GC workloads keep max sample delta at 1.1 to 1.7 ms.
//   Single-vCPU host freezes jump to 6.4 to 18.5 ms (and up to 100 ms on long pauses).
export const FREEZE_GAP_MS = 4.0;
export const PROFILER_TICK_MS = 1.5;
// - The 2 MB memory-walk canary stays at 1.13x to 1.17x on clean runs (p99 = 1.17x over 20 s) and jumps to 3.1x to 24x during
//   multi-core host stalls and memory slowdowns.
export const CANARY_RATIO = 2.2;
export const CANARY_MARGIN_MS = 30;
// - Guest OS descheduling shows up as wall - cpu >= 15 ms on an overlapping task.
export const DESCHED_MS = 15;
// - A wall-clock frame gap (> 50 ms) or tap (> 100 ms) with little work on both the main thread and render pipeline threads
//   points to a host stall during idle rather than app or compositor work.
export const EMPTY_FRAME_WORK_MS = 15;
export const EMPTY_TAP_WORK_MS = 25;

export const round1 = (n: number): number => Math.round(n * 10) / 10;

/** Whole 60 Hz frames in a requestAnimationFrame gap (49.9 to 50.2 ms counts as 3 frames). */
export const framesOf = (ms: number): number => Math.round(ms / (1000 / 60));

/** Converts V8 CPU profile sample deltas into ms intervals relative to `startTsUs` (Chrome monotonic clock). */
export function profilerSamplesOf(profile: ProfileTicks, startTsUs: number, endTsUs: number): SampleInterval[] {
  const out: SampleInterval[] = [];
  let cur = profile.startTime;
  for (let i = 0; i < profile.samples.length; i++) {
    const dt = profile.timeDeltas[i] ?? 0;
    const prev = cur;
    cur += dt;
    // Skip i === 0 because timeDeltas[0] spans profiler startup before the first regular tick.
    if (i === 0) continue;
    if (cur < startTsUs || prev > endTsUs) continue;
    out.push({ startMs: (prev - startTsUs) / 1000, endMs: (cur - startTsUs) / 1000, dtMs: dt / 1000 });
  }
  return out;
}

function overlapMs(a0: number, a1: number, b0: number, b1: number): number {
  return Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
}

function maxProfilerGap(samples: readonly SampleInterval[], startMs: number, endMs: number): { maxDt: number; excessMs: number } {
  let maxDt = 0, excessMs = 0;
  for (const s of samples) {
    if (s.dtMs < FREEZE_GAP_MS) continue;
    const ov = overlapMs(s.startMs, s.endMs, startMs, endMs);
    if (ov <= 0) continue;
    if (s.dtMs > maxDt) maxDt = s.dtMs;
    excessMs += Math.max(0, Math.min(ov, s.dtMs - PROFILER_TICK_MS));
  }
  return { maxDt, excessMs };
}

function maxCanaryRatio(samples: readonly CanarySample[], startMs: number, endMs: number): number {
  let max = 0;
  for (const s of samples) {
    if (s.endMs < startMs - CANARY_MARGIN_MS || s.startMs > endMs + CANARY_MARGIN_MS) continue;
    if (s.ratio > max) max = s.ratio;
  }
  return max;
}

function taskStallProof(task: TaskSpan, boundMs: number, feel: FeelWindow): string | null {
  const gap = maxProfilerGap(feel.profilerSamples, task.startMs, task.endMs);
  if (gap.maxDt >= FREEZE_GAP_MS && task.cpu - gap.excessMs <= boundMs) {
    return `host vCPU freeze in ${round1(task.cpu)} ms task (profiler gap ${round1(gap.maxDt)} ms, non-frozen work ${round1(Math.max(0, task.cpu - gap.excessMs))} ms <= ${boundMs} ms)`;
  }
  const ratio = maxCanaryRatio(feel.canarySamples, task.startMs, task.endMs);
  if (ratio >= CANARY_RATIO) {
    return `host memory slowdown in ${round1(task.cpu)} ms task (canary ${round1(ratio)}x baseline)`;
  }
  return null;
}

function spanStallProof(kind: 'frame gap' | 'tap', span: TimedSpan, emptyLimitMs: number, feel: FeelWindow): string | null {
  const gap = maxProfilerGap(feel.profilerSamples, span.startMs, span.endMs);
  if (gap.maxDt >= FREEZE_GAP_MS) {
    return `host vCPU freeze during ${round1(span.ms)} ms ${kind} (profiler gap ${round1(gap.maxDt)} ms)`;
  }
  const ratio = maxCanaryRatio(feel.canarySamples, span.startMs, span.endMs);
  if (ratio >= CANARY_RATIO) {
    return `host memory slowdown during ${round1(span.ms)} ms ${kind} (canary ${round1(ratio)}x baseline)`;
  }
  const mainIn = feel.tasks.filter(t => overlapMs(t.startMs, t.endMs, span.startMs - 2, span.endMs + 2) > 0);
  const maxDesched = mainIn.reduce((m, t) => Math.max(m, t.wall - t.cpu), 0);
  if (maxDesched >= DESCHED_MS) {
    return `renderer descheduled ${round1(maxDesched)} ms during ${round1(span.ms)} ms ${kind}`;
  }
  const mainCpu = mainIn.reduce((sum, t) => sum + t.cpu, 0);
  const pipeCpu = feel.pipelineTasks
    .filter(t => overlapMs(t.startMs, t.endMs, span.startMs - 2, span.endMs + 2) > 0)
    .reduce((sum, t) => sum + t.cpu, 0);
  if (mainCpu < emptyLimitMs && pipeCpu < emptyLimitMs) {
    return `empty ${round1(span.ms)} ms ${kind} with ${round1(mainCpu)} ms main-thread and ${round1(pipeCpu)} ms compositor/GPU work`;
  }
  return null;
}

/**
 * Decides whether a measured window passes, fails immediately for app work, or warrants a rerun for a proven machine stall.
 * Every breaching task, frame gap, and tap must have direct machine-stall proof before a rerun is allowed.
 */
export function verdictOf(feel: FeelWindow, boundMs: number, maxFrames: number, maxTapMs: number): StallVerdict {
  const badTasks = feel.tasks.filter(t => t.cpu > boundMs);
  const badFrames = feel.frames.filter(f => framesOf(f.ms) > maxFrames);
  const badTaps = feel.taps.filter(tp => tp.ms > maxTapMs);
  if (badTasks.length === 0 && badFrames.length === 0 && badTaps.length === 0) return { outcome: 'pass' };

  const stallReasons: string[] = [];
  const appReasons: string[] = [];

  for (const t of badTasks) {
    const proof = taskStallProof(t, boundMs, feel);
    if (proof) stallReasons.push(proof);
    else appReasons.push(`task ${round1(t.cpu)} ms CPU > ${boundMs} ms after ${t.after}`);
  }
  for (const f of badFrames) {
    const proof = spanStallProof('frame gap', f, EMPTY_FRAME_WORK_MS, feel);
    if (proof) stallReasons.push(proof);
    else appReasons.push(`frame gap ${round1(f.ms)} ms (${framesOf(f.ms)} frames > ${maxFrames}) after ${f.after}`);
  }
  for (const tp of badTaps) {
    const proof = spanStallProof('tap', tp, EMPTY_TAP_WORK_MS, feel);
    if (proof) stallReasons.push(proof);
    else appReasons.push(`tap ${round1(tp.ms)} ms > ${maxTapMs} ms on ${tp.after.replace(/^the tap on /, '')}`);
  }

  if (appReasons.length > 0) return { outcome: 'fail', reasons: appReasons };
  return { outcome: 'rerun', reasons: stallReasons };
}
