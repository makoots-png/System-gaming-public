import { describe, expect, test } from 'bun:test';
import { framesOf, profilerSamplesOf, verdictOf, type CanarySample, type FeelWindow, type PipelineTask, type SampleInterval, type TaskSpan, type TimedSpan } from './e2e/feel-stall.ts';

function cleanWindow(overrides: Partial<FeelWindow> = {}): FeelWindow {
  const frames: TimedSpan[] = Array.from({ length: 12 }, (_, i) => ({
    ms: 16.7,
    startMs: i * 16.7,
    endMs: (i + 1) * 16.7,
    after: 'the tap on button "Next turn"',
  }));
  const tasks: TaskSpan[] = [{ cpu: 9.0, wall: 9.2, startMs: 40, endMs: 49.2, after: 'the tap on button "Next turn"', parts: 'FireAnimationFrame 6.0' }];
  const profilerSamples: SampleInterval[] = Array.from({ length: 200 }, (_, i) => ({ startMs: i, endMs: i + 1, dtMs: 1.0 }));
  const canarySamples: CanarySample[] = Array.from({ length: 30 }, (_, i) => ({ startMs: i * 6, endMs: i * 6 + 1, wallMs: 1.0, ratio: 1.05 }));
  const pipelineTasks: PipelineTask[] = [{ cpu: 1.2, startMs: 48, endMs: 49.2 }];
  return { frames, taps: [{ ms: 30, startMs: 30, endMs: 60, after: 'the tap on button "Next turn"' }], tasks, pipelineTasks, profilerSamples, canarySamples, ...overrides };
}

describe('feel-stall verdictOf', () => {
  test('passes when all tasks, frame gaps, and taps stay inside bounds', () => {
    expect(verdictOf(cleanWindow(), 21, 3, 100)).toEqual({ outcome: 'pass' });
  });

  test('fails immediately when an app task exceeds the bound with steady 1 ms profiler ticks and normal canary', () => {
    const slow = cleanWindow({
      tasks: [{ cpu: 38.0, wall: 38.2, startMs: 40, endMs: 78.2, after: 'the tap on button "Next turn"', parts: 'FireAnimationFrame 35.0' }],
    });
    const v = verdictOf(slow, 21, 3, 100);
    expect(v.outcome).toBe('fail');
  });

  test('fails immediately when a small host freeze lands on a task whose real app work still exceeds the bound', () => {
    // 35 ms real work + 5 ms freeze = 40 ms task; subtracting 3.5 ms freeze excess leaves 36.5 ms > 21 ms bound.
    const samples: SampleInterval[] = [
      ...Array.from({ length: 50 }, (_, i) => ({ startMs: i, endMs: i + 1, dtMs: 1.0 })),
      { startMs: 50, endMs: 55, dtMs: 5.0 },
      ...Array.from({ length: 40 }, (_, i) => ({ startMs: 55 + i, endMs: 56 + i, dtMs: 1.0 })),
    ];
    const slow = cleanWindow({
      tasks: [{ cpu: 40.0, wall: 40.0, startMs: 40, endMs: 80.0, after: 'the tap on button "Next turn"', parts: 'FireAnimationFrame 38.0' }],
      profilerSamples: samples,
    });
    const v = verdictOf(slow, 21, 3, 100);
    expect(v.outcome).toBe('fail');
  });

  test('reruns when a single-vCPU host freeze explains the task breach (real run 3 odds shape)', () => {
    // 13.9 ms task (bound 11) with a 12.2 ms V8 profiler gap inside it: non-frozen work is 3.2 ms <= 11 ms.
    const samples: SampleInterval[] = [
      { startMs: 325.7, endMs: 337.9, dtMs: 12.2 },
    ];
    const frozen = cleanWindow({
      tasks: [{ cpu: 13.9, wall: 13.9, startMs: 325.3, endMs: 339.2, after: 'the tap on button "Simulate 100 fights"', parts: 'UpdateLayoutTree(11 elements) 12.4' }],
      profilerSamples: samples,
    });
    const v = verdictOf(frozen, 11, 3, 100);
    expect(v.outcome).toBe('rerun');
    if (v.outcome === 'rerun') expect(v.reasons[0]).toContain('host vCPU freeze');
  });

  test('reruns when the memory canary proves a concurrent multi-core host slowdown (real run 9 mapUse shape)', () => {
    const slowed = cleanWindow({
      tasks: [{ cpu: 40.8, wall: 52.1, startMs: 123.1, endMs: 175.2, after: 'the tap on button "Use Strike"', parts: 'FireAnimationFrame 25.9' }],
      canarySamples: [
        { startMs: 100, endMs: 101, wallMs: 1.0, ratio: 1.0 },
        { startMs: 140, endMs: 144.2, wallMs: 4.2, ratio: 4.1 },
      ],
    });
    const v = verdictOf(slowed, 26, 3, 100);
    expect(v.outcome).toBe('rerun');
    if (v.outcome === 'rerun') expect(v.reasons[0]).toContain('host memory slowdown');
  });

  test('does not excuse a task breach for a canary spike outside its time window', () => {
    const slow = cleanWindow({
      tasks: [{ cpu: 35.0, wall: 35.0, startMs: 40, endMs: 75, after: 'the tap on button "Next turn"', parts: 'FireAnimationFrame 32.0' }],
      canarySamples: [{ startMs: 500, endMs: 510, wallMs: 10.0, ratio: 9.5 }],
    });
    expect(verdictOf(slow, 21, 3, 100).outcome).toBe('fail');
  });

  test('fails immediately when a frame gap is filled by a run of short main-thread tasks', () => {
    const shortTasks: TaskSpan[] = Array.from({ length: 6 }, (_, i) => ({
      cpu: 10.0,
      wall: 10.0,
      startMs: 100 + i * 11,
      endMs: 110 + i * 11,
      after: 'the tap on button "Next turn"',
      parts: 'FunctionCall 9.5',
    }));
    const w = cleanWindow({
      frames: [{ ms: 83.3, startMs: 100, endMs: 183.3, after: 'the tap on button "Next turn"' }],
      tasks: shortTasks,
    });
    expect(verdictOf(w, 21, 3, 100).outcome).toBe('fail');
  });

  test('fails immediately when a frame gap is filled by heavy compositor or GPU work', () => {
    const w = cleanWindow({
      frames: [{ ms: 83.3, startMs: 100, endMs: 183.3, after: 'the tap on button "Use Strike"' }],
      tasks: [{ cpu: 2.0, wall: 2.0, startMs: 105, endMs: 107, after: 'the tap on button "Use Strike"', parts: 'Paint 1.0' }],
      pipelineTasks: [{ cpu: 35.0, startMs: 110, endMs: 145 }],
    });
    expect(verdictOf(w, 26, 3, 100).outcome).toBe('fail');
  });

  test('reruns when a frame gap has almost no main-thread or compositor work inside it', () => {
    const w = cleanWindow({
      frames: [{ ms: 83.3, startMs: 410, endMs: 493.3, after: 'the tap on button "Use Strike"' }],
      tasks: [{ cpu: 0.3, wall: 0.3, startMs: 420, endMs: 420.3, after: 'the tap on button "Use Strike"', parts: 'FireAnimationFrame 0.1' }],
      pipelineTasks: [{ cpu: 0.2, startMs: 421, endMs: 421.2 }],
    });
    const v = verdictOf(w, 26, 3, 100);
    expect(v.outcome).toBe('rerun');
    if (v.outcome === 'rerun') expect(v.reasons[0]).toContain('empty 83.3 ms frame gap');
  });

  test('reruns when the renderer was descheduled inside a breaching frame gap', () => {
    const w = cleanWindow({
      frames: [{ ms: 66.7, startMs: 600, endMs: 666.7, after: 'the tap on button "Simulate 100 fights"' }],
      tasks: [{ cpu: 5.1, wall: 43.3, startMs: 605, endMs: 648.3, after: 'the tap on button "Simulate 100 fights"', parts: 'Paint 1.6' }],
      pipelineTasks: [{ cpu: 20.0, startMs: 610, endMs: 630 }],
    });
    const v = verdictOf(w, 11, 3, 100);
    expect(v.outcome).toBe('rerun');
    if (v.outcome === 'rerun') expect(v.reasons[0]).toContain('descheduled');
  });

  test('fails immediately when one breach is machine-caused and another in the same window is app-caused', () => {
    const w = cleanWindow({
      frames: [{ ms: 83.3, startMs: 410, endMs: 493.3, after: 'the tap on button "Next turn"' }],
      tasks: [{ cpu: 35.0, wall: 35.0, startMs: 40, endMs: 75, after: 'the tap on button "Next turn"', parts: 'FireAnimationFrame 34.0' }],
      pipelineTasks: [],
    });
    expect(verdictOf(w, 21, 3, 100).outcome).toBe('fail');
  });

  test('fails immediately when a tap exceeds 100 ms with heavy main-thread work inside it', () => {
    const w = cleanWindow({
      taps: [{ ms: 120, startMs: 100, endMs: 220, after: 'the tap on button "Next turn"' }],
      tasks: Array.from({ length: 4 }, (_, i) => ({
        cpu: 15,
        wall: 15,
        startMs: 110 + i * 20,
        endMs: 125 + i * 20,
        after: 'the tap on button "Next turn"',
        parts: 'FunctionCall 14',
      })),
    });
    expect(verdictOf(w, 21, 3, 100).outcome).toBe('fail');
  });
});

describe('profilerSamplesOf and framesOf', () => {
  test('skips the initial startup delta and aligns samples to feel-start', () => {
    const samples = profilerSamplesOf(
      { startTime: 100_000, samples: [1, 2, 3, 4], timeDeltas: [7_500, 1_000, 12_200, 1_100] },
      107_000,
      125_000,
    );
    expect(samples).toEqual([
      { startMs: 0.5, endMs: 1.5, dtMs: 1.0 },
      { startMs: 1.5, endMs: 13.7, dtMs: 12.2 },
      { startMs: 13.7, endMs: 14.8, dtMs: 1.1 },
    ]);
  });

  test('counts whole 60 Hz frames', () => {
    expect(framesOf(16.8)).toBe(1);
    expect(framesOf(50.2)).toBe(3);
    expect(framesOf(66.7)).toBe(4);
  });
});
