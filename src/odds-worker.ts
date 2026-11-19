// odds-worker.ts: the worker thread that plays the odds engine for src/edge/odds-run.ts. It runs the machine of
// src/core/combat/odds.ts from the ask to its end with no slices, since nothing here draws, and sends its count at most
// once a frame and the run as it ended. scripts/build.ts bundles it as /odds-worker.js.
import { IDLE, oddsStep, progressOf } from './core/combat/odds.ts';
import type { OddsAsk, OddsNews } from './edge/odds-run.ts';

/** A frame at 60 Hz, in ms: the page draws the count at most this often, so it is sent no more often. */
const FRAME_MS = 1000 / 60;
const scope = globalThis as unknown as { onmessage: ((e: MessageEvent<OddsAsk>) => void) | null; postMessage(m: OddsNews): void };

scope.onmessage = e => {
  const { fight, seed, of, R } = e.data;
  let run = oddsStep(IDLE, { type: 'ask', fight, seed, of }, R), sent = 0;
  while (run.state === 'running') {
    run = oddsStep(run, { type: 'step', commands: 1 }, R);
    const now = performance.now(), count = progressOf(run, R);
    if (count && now - sent >= FRAME_MS) { scope.postMessage({ count }); sent = now; }
  }
  scope.postMessage({ run });
};
