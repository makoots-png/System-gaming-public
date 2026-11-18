// The chart of a run of the odds engine (src/core/combat/odds.ts), walked with the events of tests/models/odds-events.ts.
import { ODDS_STATES, oddsStep } from '../../src/core/combat/odds.ts';
import type { OddsEvent, OddsRun, OddsState } from '../../src/core/combat/odds.ts';
import { RULES } from '../../src/core/rules.ts';
import { START, WALK_EVENTS } from '../../tests/models/odds-events.ts';
import { bfs, machine } from '../statecharts.ts';

/** What the GM's fight screen shows of the odds. */
const LABEL: { readonly [K in OddsState]: string } = {
  idle: 'Play it out 100 times',
  running: 'Playing, the count shown',
  done: 'The odds: one line and its detail',
  stale: 'The odds, marked: the fight changed since',
};

function step(e: OddsEvent, from: OddsRun, to: OddsRun): string | null {
  switch (e.type) {
    case 'ask': return from.state === 'idle' ? 'the GM taps Play it out' : from.state === 'running' ? null : 'the GM taps Play it out again';
    case 'step': return to.state === 'done' ? 'the last fight ends' : 'a frame plays a few commands';
    case 'changed': return 'the fight on screen changes';
    case 'cancel': return 'the GM taps Stop';
  }
}

export const odds = machine<OddsRun, OddsEvent>({
  name: 'The odds of a fight',
  walked: `Every state reachable from no run, under the ${WALK_EVENTS.length} events of tests/models/odds-events.ts (a run of one fight), breadth first.`,
  walk: () => bfs<OddsRun, OddsEvent>([START], s => WALK_EVENTS.map(event => ({ event, to: oddsStep(s, event, RULES) })), s => s.state),
  kinds: ODDS_STATES,
  kindsOf: s => [s.state],
  views: [{
    title: 'A run of the odds engine on the GM\'s fight screen or a solo gate\'s card',
    note: 'It runs only when the GM asks. Each frame plays commands of the fight on the real reducer for `ODDS_FRAME_MS`, so the screen keeps its frames, and the count is real. It writes nothing: the run lives in the fight screen\'s page memory, never in the save, a backup or the room. An answer for a fight that has changed since stays, marked; a run under way for one is dropped.',
    hides: 'Ask while running (it starts again, an arrow to the same state).',
    state: s => LABEL[s.state],
    step,
  }],
  where: [
    ['The union', '`OddsRun`, `OddsEvent`, `ODDS_STATES` and `ODDS_EVENTS` in `src/core/combat/odds.ts`'],
    ['What changes it', '`oddsStep` and its `TABLE`; a play of one fight is `playBegin` and `playStep` (src/core/combat/play.ts), every row on `sensible` (policy.ts)'],
    ['Who calls it', '`app.api.odds` (`paint`, `ask`) in `src/views/odds-box.js`, mounted by `src/views/combat.js` and `src/views/gates.js`; the seed is `oddsSeed` (src/edge/roll.ts); a solo run is one more play, asked by `enterAlone` in gates.js'],
    ['The test to copy', '`tests/odds.test.ts`; the walk\'s events are in `tests/models/odds-events.ts`'],
    ['The recipe', 'AGENTS.md, "A policy\'s new choice"'],
  ],
});
