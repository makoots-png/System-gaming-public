// The chart of a hunter's rests in a gate (src/core/hunter/rests.ts `restStep`), walked with its three events and the
// shipped rules' rests a gate.
import { REST_EVENT_TYPES, REST_STATES, restState, restStep } from '../../src/core/hunter/rests.ts';
import type { RestEvent, RestEventType } from '../../src/core/hunter/rests.ts';
import { RULES } from '../../src/core/rules.ts';
import { isRefused } from '../../src/core/save-step.ts';
import { bfs, machine } from '../statecharts.ts';

const EVENTS: readonly RestEvent[] = REST_EVENT_TYPES.map(type => ({ type }));
const pct = (share: number): string => `${Math.round(share * 100)}%`;

const STEP: { readonly [E in RestEventType]: string } = {
  rest: `a rest: ${pct(RULES.rest.hp)} of max HP and ${pct(RULES.rest.mana)} of max mana back, ${pct(RULES.rest.fatigue)} of the fatigue off`,
  cleared: 'a gate the hunter was paid for is cleared: everything back',
  gateLeft: 'a solo run lost or retreated from: the gate ends, nothing back',
};

export const rests = machine<number, RestEvent>({
  name: 'A hunter\'s rests',
  walked: `Every count reachable from no rest taken under the ${EVENTS.length} events of \`REST_EVENT_TYPES\`, with the shipped rules (${RULES.rest.perGate} rests a gate), breadth first.`,
  walk: () => bfs([0], n => EVENTS.flatMap(event => { const to = restStep(n, event, RULES); return isRefused(to) ? [] : [{ event, to }]; }), n => String(n)),
  kinds: REST_STATES,
  kindsOf: n => [restState(n, RULES)],
  views: [{
    title: 'Rests taken in a gate, and the gate\'s end that gives them back',
    note: 'the owner, Nov 22: "They should get 2x per dungeon, and after a dungeon clear they should get everything back." A dungeon is a gate. A player\'s phone cannot know which gate its hunter is in; what reaches it is a gate\'s Clear (its `gate` fact) and its own solo run\'s end, so the count is the rests since a gate last ended for the hunter: a rest outside a gate counts toward the next. With none left a rest is refused (`spent`) and changes nothing. A dead hunter\'s rest is refused before the count, and a Clear gives the dead nothing but the count started again (vitals.ts `VITAL_TABLE`). The shares and the rests a gate are `RULES.rest`.',
    hides: '',
    state: n => `${n} of ${RULES.rest.perGate} taken`,
    step: e => STEP[e.type],
  }],
  where: [
    ['The union', '`RestState`, `RestEvent` and `REST_STATES` in `src/core/hunter/rests.ts`; the count is `Hunter.restsTaken`'],
    ['What changes it', '`restStep(taken, event, R)` and its `TABLE`'],
    ['Who calls it', '`sheetEdit` in `src/core/hunter/grant.ts`, its one writer: a rest (with the vitals\' `rest`), a Clear (`cleared`, with the vitals\' `cleared`, through `noteFacts`: `settleClear` in `src/core/gates/pay.ts`, `soloRan` in `src/core/gates/solo.ts`, the `noted` applier in `src/edge/room-events.ts`), a solo run\'s end (`gateLeft`, `soloRan`); the Rest button is `api.hunter.rest` in `src/views/hunter.js`'],
    ['The test to copy', '`tests/rests.test.ts`'],
    ['The recipe', 'docs/guide/hunters.md, "To add a field to a hunter"'],
  ],
});
