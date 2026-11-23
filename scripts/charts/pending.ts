// The chart of a reward waiting for the GM (src/core/hunter/pending.ts `pendingStep`), walked with every event.
import { PENDING_STATES, ROUTE, pendingStep } from '../../src/core/hunter/pending.ts';
import type { PendingEvent, PendingReward, PendingState } from '../../src/core/hunter/pending.ts';
import { newRewards } from '../../src/core/save.ts';
import { bfs, machine } from '../statecharts.ts';

const REC = { id: 'd-p1-1abc-wxyz', room: 'ABC234', to: 'd-p1:h1', name: 'Mira', from: 'quest', what: 'Ten Beasts', rewards: newRewards(), heard: '2026-11-22T10:00:00.000Z', at: 'waiting' } as unknown as PendingReward;
const EVENTS: readonly PendingEvent[] = [{ type: 'edit', rewards: { ...newRewards(), gold: 90 } }, { type: 'approve' }, { type: 'refuse' }];
const LABEL: { readonly [S in PendingState]: string } = { waiting: 'Waiting for you', approved: 'Approved, given once', refused: 'Refused, the player told' };
const STEP: { readonly [E in PendingEvent['type']]: string } = {
  edit: 'the GM edits the reward in the Award form\'s fields',
  approve: 'the GM approves: the award is given in the same write',
  refuse: 'the GM refuses: the player\'s window says so',
};

export const pending = machine<PendingState, PendingEvent>({
  name: 'A reward waiting for the GM',
  walked: `Every state reachable from a reward heard (\`waiting\`) under the events of \`PENDING_EVENTS\` (${EVENTS.map(e => e.type).join(', ')}), breadth first.`,
  walk: () => bfs<PendingState, PendingEvent>(['waiting'], s => EVENTS.flatMap(event => { const to = pendingStep({ ...REC, at: s }, event); return to ? [{ event, to: to.at }] : []; }), s => s),
  kinds: PENDING_STATES,
  kindsOf: s => [s],
  views: [{
    title: 'A reward the app would pay by itself waits for the GM\'s edit and approval',
    note: `World rule 8: "every System message and every reward must be editable and approved by the GM before players see it." The owner, Nov 22, rule d: "Yes" to a room solo clear, a counted quest, a feat and a Give… from the shelf (and Nov 22 row 51: personal-gate clears too). Where a reward goes is by the phone's seat (\`ROUTE\`): alone ${ROUTE.alone} (no GM to ask, so it is paid at once), a player's phone ${ROUTE.player} (the \`rewardAsk\` message), the GM's phone ${ROUTE.gm} (this record in its save). The GM edits freely, above what the rule pays too. Approved and refused are ends: a second approve pays nothing.`,
    hides: '',
    state: s => LABEL[s],
    step: e => STEP[e.type],
  }],
  where: [
    ['The union', '`PendingReward`, `PendingEvent` and `PENDING_STATES` in `src/core/hunter/pending.ts`; the records are `settings.sync.pending` in the GM\'s save'],
    ['What changes it', '`pendingStep(record, event)` and its `TABLE`; `pendingHeard`, `pendingApproved`, `pendingRefused` on the save; `selfPay` / `selfPaid` route a reward by `ROUTE`'],
    ['Who calls it', '`noticed.ts` (a feat, a counted quest), `soloRan` (a cleared personal gate) and `soloTaken` (a won room run) in `src/core/gates/solo.ts`, the GM view\'s "Waiting for you" list and its Approve through Send award (`src/views/gm.js`)'],
    ['The test to copy', '`tests/pending.test.ts`'],
    ['The recipe', 'docs/guide/room-sync.md, "A room message"'],
  ],
});
