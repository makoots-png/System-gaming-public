// The chart of the Dice view's quick check DC (src/core/dc-pick.ts `dcPickStep`, audit SMX-views-13), walked from a
// view opened on a hunter of rank E with a pick of a rank's level, a pick of no DC and the hunter's rank read again.
import { DC_PICK_STATES, dcPickStep, dcStart } from '../../src/core/dc-pick.ts';
import type { DcPick, DcPickEvent } from '../../src/core/dc-pick.ts';
import { bfs, machine } from '../statecharts.ts';

/** Every kind of event: a pick of a rank's level, a pick of no DC, and a draw that reads a hunter of another rank. */
const WALK: readonly DcPickEvent[] = [{ kind: 'picked', key: 'D:0' }, { kind: 'picked', key: 'none' }, { kind: 'hunterRank', rank: 'S' }];

function step(e: DcPickEvent): string {
  switch (e.kind) {
    case 'picked': return 'the player picks a DC in the select (the one shown too)';
    case 'hunterRank': return 'the view draws again (another hunter, a rank up)';
  }
}

export const dcPick = machine<DcPick, DcPickEvent>({
  name: 'The quick check\'s DC',
  walked: `Every state reachable from a Dice view opened on a hunter of rank E, under the ${WALK.length} events of each kind, breadth first.`,
  walk: () => bfs([dcStart('E')], s => WALK.flatMap(event => { const to = dcPickStep(s, event); return to === s ? [] : [{ event, to }]; }), s => JSON.stringify(s)),
  kinds: DC_PICK_STATES,
  kindsOf: s => [s.at],
  views: [{
    title: 'The Dice view\'s quick check DC',
    note: 'The view opens on the active hunter\'s rank at Standard. A pick in the select, the option shown included, makes the DC the player\'s until the view is drawn anew from its start (another visit to Dice). A pick is a rank and a level, or no DC, never a number: the roll reads its number from the rules\' rank table then, so a GM\'s change to the table moves the number and keeps the pick. The hunter\'s rank read at a draw moves nothing today (ruling SMX-views-13.1; ruled yes, a defaulted DC follows it).',
    hides: '',
    state: s => (s.at === 'defaulted' ? 'The hunter\'s rank, Standard' : 'The player\'s pick'),
    step,
  }],
  where: [
    ['The union', '`DcPick`, `DcPickEvent`, `DC_PICK_STATES` and `DC_PICK_EVENTS` in `src/core/dc-pick.ts`'],
    ['What changes it', '`dcPickStep(dc, event)` and its `TABLE` in `src/core/dc-pick.ts`'],
    ['Who calls it', '`src/views/dice.js`, which keeps one `dc` and moves it only by `dcPickStep` (the select\'s change, each draw)'],
    ['The test to copy', '`tests/dc-pick.test.ts`, "every state against every event"'],
    ['The recipe', 'docs/guide/hunters.md, "A state or event of the ... machine"'],
  ],
});
