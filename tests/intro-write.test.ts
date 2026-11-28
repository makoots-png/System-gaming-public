// The GM's serialized `_intro` doc writer machine (src/core/sync/intro-write.ts): stale-poll guard, retries on failed
// PUTs, coalescing with per-call outcome resolution, stretch-leave cleanup, and randomized invariant walk.
import { describe, expect, test } from 'bun:test';
import { introEnd, introStart, introStep } from '../src/core/intro.ts';
import type { IntroDoc } from '../src/core/protocol.ts';
import {
  INTRO_RETRY_DELAYS_MS,
  INTRO_WRITE_EVENTS,
  INTRO_WRITE_IDLE,
  INTRO_WRITE_PUTS,
  INTRO_WRITE_STATES,
  INTRO_WRITE_TABLE,
  INTRO_WRITE_WORDS,
  introPollStamp,
  introWriteStep,
  keepLocalIntro,
} from '../src/core/sync/intro-write.ts';
import type { IntroWrite, IntroWriteEffect, IntroWriteEvent, IntroWritePut } from '../src/core/sync/intro-write.ts';
import type { Gen } from '../src/core/sync/link.ts';

const G1 = 1 as Gen;
const G2 = 2 as Gen;
const DOC_0 = introStart('run-1', '2026-11-27T20:00:00.000Z');
const DOC_1 = introStep(DOC_0, 1, '2026-11-27T20:00:01.000Z')!;
const DOC_2 = introStep(DOC_1, 1, '2026-11-27T20:00:02.000Z')!;
const DOC_END = introEnd('2026-11-27T20:00:03.000Z');

function driver(initial: IntroWrite<string> = INTRO_WRITE_IDLE) {
  let state = initial;
  let fx: readonly IntroWriteEffect<string>[] = [];
  const answers: { waiter: string; ok: boolean }[] = [];
  const puts: { gen: Gen; doc: IntroDoc }[] = [];
  const timers: { gen: Gen; ms: number }[] = [];
  let clears = 0;

  const on = (e: IntroWriteEvent<string>) => {
    const r = introWriteStep(state, e);
    state = r.state;
    fx = r.effects;
    for (const eff of fx) {
      if (eff.type === 'answer') for (const w of eff.waiters) answers.push({ waiter: w, ok: eff.ok });
      else if (eff.type === 'put') puts.push({ gen: eff.gen, doc: eff.doc });
      else if (eff.type === 'setTimer') timers.push({ gen: eff.gen, ms: eff.ms });
      else if (eff.type === 'clearTimer') clears++;
    }
    return api;
  };

  const api = {
    get state() { return state; },
    get fx() { return fx; },
    get answers() { return answers; },
    get puts() { return puts; },
    get timers() { return timers; },
    get clears() { return clears; },
    write(doc: IntroDoc, reply: string, gen: Gen = G1) { return on({ type: 'write', gen, doc, reply }); },
    answered(put: IntroWritePut, gen: Gen = G1) { return on({ type: 'answered', gen, put }); },
    due(gen: Gen = G1) { return on({ type: 'due', gen }); },
    left() { return on({ type: 'left' }); },
  };
  return api;
}

describe('stale-poll guard (Must-fix 1)', () => {
  test('a poll sent while a put is out and answered after it keeps the written doc', () => {
    const d = driver();
    // 1. GM sends PUT for Card 1; PUT is now in flight (seq = 1, at = 'sending').
    d.write(DOC_1, 'call-1');
    expect(d.state.at).toBe('sending');

    // 2. While PUT is still in flight, a room poll GET goes out and snapshots the stamp.
    const overlappingPoll = introPollStamp(d.state);
    expect(overlappingPoll).toEqual({ seq: 1, inFlight: true });

    // 3. PUT succeeds (200) and returns the machine to idle (seq is still 1, at = 'idle').
    d.answered('stored');
    expect(d.state).toEqual({ at: 'idle', seq: 1 });
    expect(d.answers).toEqual([{ waiter: 'call-1', ok: true }]);

    // 4. Now the overlapping poll (carrying stale Card 0) arrives: must keep the written doc!
    expect(keepLocalIntro(d.state, overlappingPoll)).toBe(true);

    // 5. A fresh poll sent AFTER the PUT finished accepts the room's doc (so a second GM tab syncs).
    const freshPoll = introPollStamp(d.state);
    expect(freshPoll).toEqual({ seq: 1, inFlight: false });
    expect(keepLocalIntro(d.state, freshPoll)).toBe(false);
  });

  test('a poll sent before a write or while retrying also keeps the local doc', () => {
    const d = driver();
    const beforeWrite = introPollStamp(d.state);
    expect(beforeWrite).toEqual({ seq: 0, inFlight: false });

    d.write(DOC_1, 'call-1');
    expect(keepLocalIntro(d.state, beforeWrite)).toBe(true);

    // Poll sent during retrying state
    d.answered('failed');
    expect(d.state.at).toBe('retrying');
    const duringRetry = introPollStamp(d.state);
    expect(duringRetry.inFlight).toBe(true);

    d.due().answered('stored');
    expect(d.state.at).toBe('idle');
    expect(keepLocalIntro(d.state, beforeWrite)).toBe(true);
    expect(keepLocalIntro(d.state, duringRetry)).toBe(true);
  });
});

describe('failed PUT retry and per-call outcome resolution (Must-fix 2)', () => {
  test('a failed put stays pending and is retried on INTRO_RETRY_DELAYS_MS until stored', () => {
    const d = driver();
    d.write(DOC_1, 'call-1');
    expect(d.puts).toHaveLength(1);
    expect(d.answers).toEqual([]);

    // First attempt fails: enters retrying with first delay; caller stays pending (not resolved yet).
    d.answered('failed');
    expect(d.state.at).toBe('retrying');
    expect(d.timers).toEqual([{ gen: G1, ms: INTRO_RETRY_DELAYS_MS[0]! }]);
    expect(d.answers).toEqual([]);

    // First retry fires and fails: enters retrying with second delay.
    d.due();
    expect(d.state.at).toBe('sending');
    expect(d.puts).toHaveLength(2);
    d.answered('failed');
    expect(d.state.at).toBe('retrying');
    expect(d.timers).toEqual([
      { gen: G1, ms: INTRO_RETRY_DELAYS_MS[0]! },
      { gen: G1, ms: INTRO_RETRY_DELAYS_MS[1]! },
    ]);
    expect(d.answers).toEqual([]);

    // Second retry fires and succeeds: resolves caller true and emits stored.
    d.due().answered('stored');
    expect(d.state.at).toBe('idle');
    expect(d.puts).toHaveLength(3);
    expect(d.fx.some(e => e.type === 'stored' && e.doc === DOC_1)).toBe(true);
    expect(d.answers).toEqual([{ waiter: 'call-1', ok: true }]);
  });

  test('a failed put resolves false only after all retries are exhausted', () => {
    const d = driver();
    d.write(DOC_1, 'call-1');
    for (let i = 0; i < INTRO_RETRY_DELAYS_MS.length; i++) {
      d.answered('failed');
      expect(d.state.at).toBe('retrying');
      expect(d.answers).toEqual([]);
      d.due();
    }
    d.answered('failed');
    expect(d.state.at).toBe('idle');
    expect(d.puts).toHaveLength(1 + INTRO_RETRY_DELAYS_MS.length);
    expect(d.answers).toEqual([{ waiter: 'call-1', ok: false }]);
    expect(INTRO_WRITE_WORDS.failedToast.length).toBeGreaterThan(10);
  });

  test('tooBig fails immediately without retrying', () => {
    const d = driver();
    d.write(DOC_1, 'call-1').answered('tooBig');
    expect(d.state.at).toBe('idle');
    expect(d.timers).toEqual([]);
    expect(d.answers).toEqual([{ waiter: 'call-1', ok: false }]);
  });

  test('a second write while a put is in flight does NOT resolve true early; it waits for the write carrying its value', () => {
    const d = driver();
    d.write(DOC_1, 'call-1');
    d.write(DOC_2, 'call-2');
    expect(d.state.at).toBe('sendingQueued');
    // Neither caller has resolved while PUT 1 is still out.
    expect(d.answers).toEqual([]);
    expect(d.puts).toHaveLength(1);

    // PUT 1 succeeds -> call-1 resolves true, PUT 2 goes out immediately, call-2 is still pending.
    d.answered('stored');
    expect(d.state.at).toBe('sending');
    expect(d.puts).toHaveLength(2);
    expect(d.puts[1]!.doc).toBe(DOC_2);
    expect(d.answers).toEqual([{ waiter: 'call-1', ok: true }]);

    // PUT 2 fails through all retries -> call-2 resolves false!
    for (let i = 0; i < INTRO_RETRY_DELAYS_MS.length; i++) d.answered('failed').due();
    d.answered('failed');
    expect(d.state.at).toBe('idle');
    expect(d.answers).toEqual([
      { waiter: 'call-1', ok: true },
      { waiter: 'call-2', ok: false },
    ]);
  });

  test('coalescing multiple queued writes and a newer write during retry', () => {
    const d = driver();
    d.write(DOC_0, 'c0').write(DOC_1, 'c1').write(DOC_2, 'c2');
    expect(d.state.at).toBe('sendingQueued');
    d.answered('failed');
    // c0's PUT failed; c1 and c2 were coalesced into DOC_2 which goes out now.
    expect(d.answers).toEqual([{ waiter: 'c0', ok: false }]);
    expect(d.puts[1]!.doc).toBe(DOC_2);

    // DOC_2 fails once (retrying), then a newer write DOC_END cancels backoff and sends immediately.
    d.answered('failed');
    expect(d.state.at).toBe('retrying');
    d.write(DOC_END, 'c3');
    expect(d.state.at).toBe('sending');
    expect(d.clears).toBe(1);
    expect(d.puts[2]!.doc).toBe(DOC_END);
    d.answered('stored');
    expect(d.answers).toEqual([
      { waiter: 'c0', ok: false },
      { waiter: 'c1', ok: true },
      { waiter: 'c2', ok: true },
      { waiter: 'c3', ok: true },
    ]);
  });

  test('leaving a link stretch clears retry timers, fails pending waiters, and ignores old-gen replies', () => {
    const d = driver();
    d.write(DOC_1, 'c1', G1).answered('failed', G1);
    expect(d.state.at).toBe('retrying');
    d.left();
    expect(d.state.at).toBe('idle');
    expect(d.clears).toBe(1);
    expect(d.answers).toEqual([{ waiter: 'c1', ok: false }]);

    // New write in G2 ignores late due/answered from G1.
    d.write(DOC_2, 'c2', G2);
    expect(d.due(G1).fx).toEqual([]);
    expect(d.answered('failed', G1).fx).toEqual([]);
    expect(d.state.at).toBe('sending');
    d.answered('stored', G2);
    expect(d.answers).toEqual([
      { waiter: 'c1', ok: false },
      { waiter: 'c2', ok: true },
    ]);
  });
});

describe('table coverage and randomized invariant walk', () => {
  test('INTRO_WRITE_TABLE matches every state and event kind', () => {
    expect(Object.keys(INTRO_WRITE_TABLE).sort()).toEqual([...INTRO_WRITE_STATES].sort());
    for (const s of INTRO_WRITE_STATES) {
      expect(Object.keys(INTRO_WRITE_TABLE[s]).sort()).toEqual([...INTRO_WRITE_EVENTS].sort());
    }
  });

  test('random writes, replies, retries, and leaves resolve every caller once and keep at most one PUT in flight', () => {
    let seed = 42;
    const rand = (n: number): number => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
    const docs = [DOC_0, DOC_1, DOC_2, DOC_END] as const;

    for (let walk = 0; walk < 200; walk++) {
      let state: IntroWrite<number> = INTRO_WRITE_IDLE;
      let gen = 1 as Gen;
      let nextCall = 0;
      const pendingCalls = new Set<number>();
      let inFlightGen: Gen | null = null;
      let timerGen: Gen | null = null;

      const apply = (e: IntroWriteEvent<number>) => {
        const r = introWriteStep(state, e);
        state = r.state;
        for (const fx of r.effects) {
          if (fx.type === 'put') {
            expect(inFlightGen, `walk ${walk}: at most one PUT in flight`).toBeNull();
            inFlightGen = fx.gen;
          } else if (fx.type === 'setTimer') {
            timerGen = fx.gen;
          } else if (fx.type === 'clearTimer') {
            timerGen = null;
          } else if (fx.type === 'answer') {
            for (const w of fx.waiters) {
              expect(pendingCalls.has(w), `walk ${walk}: waiter ${w} resolved exactly once`).toBe(true);
              pendingCalls.delete(w);
            }
          }
        }
      };

      for (let step = 0; step < 40; step++) {
        const pick = rand(5);
        if (pick <= 1) {
          const id = ++nextCall;
          pendingCalls.add(id);
          apply({ type: 'write', gen, doc: docs[rand(docs.length)]!, reply: id });
        } else if (pick === 2 && inFlightGen !== null) {
          const g = inFlightGen;
          inFlightGen = null;
          apply({ type: 'answered', gen: g, put: INTRO_WRITE_PUTS[rand(INTRO_WRITE_PUTS.length)]! });
        } else if (pick === 3 && timerGen !== null) {
          const g = timerGen;
          timerGen = null;
          apply({ type: 'due', gen: g });
        } else if (pick === 4 && rand(3) === 0) {
          gen = (gen + 1) as Gen;
          inFlightGen = null;
          timerGen = null;
          apply({ type: 'left' });
          expect(state.at).toBe('idle');
          expect(pendingCalls.size).toBe(0);
        }
      }

      // Drain remaining puts and timers
      for (let drain = 0; drain < 20 && (inFlightGen !== null || timerGen !== null); drain++) {
        if (inFlightGen !== null) {
          const g = inFlightGen;
          inFlightGen = null;
          apply({ type: 'answered', gen: g, put: 'stored' });
        } else if (timerGen !== null) {
          const g = timerGen;
          timerGen = null;
          apply({ type: 'due', gen: g });
        }
      }
      expect(state.at).toBe('idle');
      expect(pendingCalls.size).toBe(0);
    }
  });
});
