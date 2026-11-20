// The chart of this phone's solo run, from the tap on Enter alone until its outcome's window closes
// (src/core/gates/solo-run.ts `runPhaseStep`, audit SM-gates-1), walked with the events of tests/models/solo-run-events.ts.
import { NO_RUN, RUN_PHASES, runPhaseStep } from '../../src/core/gates/solo-run.ts';
import type { RunPhase, RunPhaseEvent } from '../../src/core/gates/solo-run.ts';
import { RUN_PHASE_WALK } from '../../tests/models/solo-run-events.ts';
import { bfs, machine } from '../statecharts.ts';

const LABEL: { readonly [S in RunPhase['at']]: string } = {
  idle: 'No run: Enter alone may be tapped',
  asking: 'Asking: the odds, then the question',
  playing: 'Playing: its round and moves on its card',
  told: 'Written: its window open',
};
function step(e: RunPhaseEvent, from: RunPhase): string | null {
  switch (e.type) {
    case 'enter': return `Enter alone tapped on the ${e.gate.kind} gate`;
    case 'go': return 'the question answered Enter alone, the hunter still ready';
    case 'played': return null;
    case 'wrote': return 'the run ended and its one write was taken';
    case 'done': return from.at === 'asking' ? 'refused, no odds, or Not now' : from.at === 'playing' ? 'no end, or the write refused' : 'its window closed';
  }
}

export const runPhaseChart = machine<RunPhase, RunPhaseEvent>({
  name: 'A solo run on this phone',
  walked: `Every state reachable from no run, under the ${RUN_PHASE_WALK.length} events of tests/models/solo-run-events.ts over a personal and a world gate, breadth first, a run's gate and phase making a state (not its round).`,
  walk: () => bfs([NO_RUN], s => RUN_PHASE_WALK.flatMap(event => { const to = runPhaseStep(s, event); return to === s ? [] : [{ event, to }]; }),
    s => JSON.stringify(s.at === 'idle' ? s : { at: s.at, gate: s.gate })),
  kinds: RUN_PHASES,
  kindsOf: s => [s.at],
  views: [{
    title: 'One run at a time, from the tap to its window',
    note: 'A run plays the hunter as it stands and stores nothing until its one write, so a phone has at most one in flight: every Enter alone is disabled until it is over, and a tap meanwhile changes nothing. The panel draws the run from this value, so a redraw in the middle of a run (the minute\'s clock, a room poll) draws its card again with its round and moves. Each new round or move count is a step within Playing, not drawn. Page memory: a reload starts with no run, and nothing of a run before its write was stored.',
    hides: 'A new round or move count within Playing, and each event that changes nothing (a tap while a run is in flight among them).',
    state: s => LABEL[s.at],
    step,
  }],
  where: [
    ['The union', '`RunPhase`, `RunPhaseEvent`, `RUN_PHASES` and `RUN_PHASE_EVENTS` in `src/core/gates/solo-run.ts`'],
    ['What changes it', '`runPhaseStep(run, event)` and its `TABLE`, through `runMoved` in `src/views/gates.js`, which keeps the one value and redraws'],
    ['Who calls it', '`enterAlone` and `runAlone` in `src/views/gates.js`; the solo panel reads it through `mayEnter` and `playingOn`'],
    ['The test to copy', '`tests/solo-run.test.ts`; the walk\'s events are in `tests/models/solo-run-events.ts`; on screen, `tests/e2e/solo.e2e.ts` ("Enter alone cannot be tapped again", "a redraw of the solo panel")'],
    ['The recipe', 'docs/guide/gates-solo.md, the solo run rows'],
  ],
});
