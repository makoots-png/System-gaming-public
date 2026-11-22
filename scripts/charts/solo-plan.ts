// The chart of what the GM's phone does with a player's solo run (src/core/gates/solo.ts `PLAN_TABLE`, `soloPlan`),
// walked from a run of each outcome arriving, against each way the GM's gate can be found.
import { RUN_OUTCOMES } from '../../src/core/combat/odds.ts';
import type { RunOutcome } from '../../src/core/combat/odds.ts';
import { PLAN_TABLE, SOLO_GATE_FOUND } from '../../src/core/gates/solo.ts';
import type { SoloGateFound } from '../../src/core/gates/solo.ts';
import { SOLO_REFUSED } from '../../src/core/protocol.ts';
import { bfs, machine } from '../statecharts.ts';

type Cell = (typeof PLAN_TABLE)[SoloGateFound][RunOutcome];
/** A run on the GM's phone: arrived with its outcome, or planned by the table. */
type Run = { readonly at: 'arrived'; readonly outcome: RunOutcome } | { readonly at: 'planned'; readonly cell: Cell };

const CELL_WORDS: { readonly [C in Cell]: string } = {
  pay: 'Paid as the gate\'s Clear for one',
  report: 'Noted (it enters a detected gate)',
  gone: 'Refused: the gate is gone',
  taken: 'Refused: already cleared',
  closed: 'Refused: the gate is closed',
};
const FOUND_WORDS: { readonly [G in SoloGateFound]: string } = {
  gone: 'its gate is gone',
  cleared: 'its gate is already cleared',
  closed: 'its gate cannot be cleared',
  notSolo: 'open to solo runs, or taken out of them meanwhile',
  open: 'open to solo runs, or taken out of them meanwhile',
};

export const soloPlanChart = machine<Run, SoloGateFound>({
  name: 'A player\'s solo run on the GM\'s phone',
  walked: `A run of each of the ${RUN_OUTCOMES.length} outcomes arriving, against each of the ${SOLO_GATE_FOUND.length} ways \`PLAN_TABLE\` finds the GM's gate.`,
  walk: () => bfs<Run, SoloGateFound>(RUN_OUTCOMES.map(outcome => ({ at: 'arrived', outcome })),
    s => (s.at === 'arrived' ? SOLO_GATE_FOUND.map(event => ({ event, to: { at: 'planned', cell: PLAN_TABLE[event][s.outcome] } })) : []),
    s => JSON.stringify(s)),
  kinds: ['arrived', 'pay', 'report', ...SOLO_REFUSED],
  kindsOf: s => [s.at === 'arrived' ? 'arrived' : s.cell],
  views: [{
    title: 'What the GM\'s phone does with a run',
    note: 'The table is asked when the run arrives and again inside its one write (`soloTaken`), which is refused (`changed`) when the plan no longer holds. A paid run is the gate\'s Clear for a party of one, paid at once (ruling SMX-gates-2.3 waits). A gate the GM took out of solo runs while the run played still pays a won run: the run counts (the owner\'s ruling of Nov 22, SMX-gates-2.2). A lost or stalled run is noted whatever the gate. The player\'s phone hears the answer as `soloAnswer`; a run nobody answers waits (`soloWait`).',
    hides: '',
    state: s => (s.at === 'arrived' ? `A ${s.outcome} run arrives` : CELL_WORDS[s.cell]),
    step: (e, _from, to) => (to.at === 'planned' && to.cell === 'report' ? 'whatever its gate' : FOUND_WORDS[e]),
  }],
  where: [
    ['The table', '`PLAN_TABLE`, `SoloGateFound`, `SOLO_GATE_FOUND` and `SoloPlan` in `src/core/gates/solo.ts`; the refusals `SOLO_REFUSED` in `src/core/protocol.ts`'],
    ['What reads it', '`soloPlan(save, run, R)`, asked again by `soloTaken` inside the write'],
    ['Who calls it', '`src/views/gates.js`, on a player\'s `soloRun` arriving at the GM\'s phone'],
    ['The test to copy', '`tests/solo.test.ts`, the plan of a run'],
    ['The recipe', 'docs/guide/gates-solo.md, the solo run rows'],
  ],
});
