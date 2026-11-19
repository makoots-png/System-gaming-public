// odds-run.ts: plays the odds engine (src/core/combat/odds.ts) on a worker thread, `src/odds-worker.ts`, so the page's
// thread keeps its frames while a hundred fights play. On the page's thread one command of the reducer took 35 to 60 ms
// at 4x the first time it ran and 2 to 12 ms after, so a frame's slice of `ODDS_FRAME_MS` overran and the screen fell
// to 15 to 30 frames a second (docs/agent-handoff/audit/notes-lag-steal.md). The worker runs the same machine with the
// same seed, so the answer is the one the page would have worked out. Each run is its own worker, ended by `stop`.
import type { OddsRun } from '../core/combat/odds.ts';
import type { Running, Setup } from '../core/combat/fight-types.ts';
import type { Rules } from '../core/rules.ts';
import { reported } from './report.ts';

/** What a run asks the worker: the odds machine's `ask` and the rules it plays by. */
export type OddsAsk = { readonly fight: Setup | Running; readonly seed: number; readonly of: number; readonly R: Rules };
/** How far the run has got (`progressOf`), as the worker's machine has it. */
export type OddsCount = { readonly done: number; readonly of: number; readonly commands: number; readonly round: number };
/** What the worker sends: its count while it plays, at most once a frame, then the run as it ended (done). */
export type OddsNews = { readonly count: OddsCount } | { readonly run: OddsRun };

/**
 * Plays `ask` on a worker: `count` hears how far it has got, `end` the run once it is done, or null when the worker
 * failed (reported). `stop` ends the worker; neither hears anything after it.
 */
export function playAway(ask: OddsAsk, count: (c: OddsCount) => void, end: (run: OddsRun | null) => void): { stop(): void } {
  const w = new Worker('odds-worker.js');
  w.onmessage = (e: MessageEvent<OddsNews>) => {
    const m = e.data;
    if ('count' in m) { count(m.count); return; }
    w.terminate();
    end(m.run);
  };
  w.onerror = e => { e.preventDefault(); w.terminate(); reported('odds:worker', e.message); end(null); };
  w.postMessage(ask);
  return { stop: () => w.terminate() };
}
