// The chart of a player's turn held on this phone (src/core/combat/hold.ts `turnHoldStep`, audit SMX-views-5), walked
// with one command posted from the doc at `doc-1` as outbox entry `e-1`, the docs `doc-1` and `doc-2`, and another
// entry's refusal and drop.
import { TURN_FREE, TURN_HOLD_STATES, turnHoldStep } from '../../src/core/combat/hold.ts';
import type { TurnHold, TurnHoldEvent } from '../../src/core/combat/hold.ts';
import { bfs, machine } from '../statecharts.ts';

/** Every event of the hold, the entry and the doc of the sent command and of another. */
const WALK: readonly TurnHoldEvent[] = [
  { kind: 'tap', via: 'turn' },
  { kind: 'tap', via: 'bag' },
  { kind: 'posted', from: 'doc-1', id: 'e-1' },
  { kind: 'unposted' },
  { kind: 'doc', at: 'doc-1' },
  { kind: 'doc', at: 'doc-2' },
  { kind: 'refused', id: 'e-1' },
  { kind: 'refused', id: 'e-2' },
  { kind: 'dropped', id: 'e-1' },
  { kind: 'dropped', id: 'e-2' },
  { kind: 'left' },
];

function step(e: TurnHoldEvent): string {
  switch (e.kind) {
    case 'tap': return 'a step, a use, End turn or a Release is tapped (the table or the Skills panel)';
    case 'posted': return 'the command goes to the outbox';
    case 'unposted': return 'nothing is posted (the window cancelled, nobody in reach, not the turn by then)';
    case 'doc': return 'a fight doc after it arrives (the GM\'s phone answered)';
    case 'refused': return 'the room refuses the command';
    case 'dropped': return 'a full outbox drops the command';
    case 'left': return 'the phone\'s room changes';
  }
}

const WORDS: { readonly [S in TurnHold['at']]: string } = {
  free: 'The turn\'s buttons on',
  picking: 'A command being picked or posted (buttons off)',
  sent: 'A command sent, waiting on the GM (buttons off)',
};

export const turnHold = machine<TurnHold, TurnHoldEvent>({
  name: 'A player\'s held turn',
  walked: `Every state reachable from a free turn, under the ${WALK.length} events of the hold (one command's entry and doc, and another's), breadth first.`,
  walk: () => bfs([TURN_FREE], s => WALK.flatMap(event => { const to = turnHoldStep(s, event).hold; return to === s ? [] : [{ event, to }]; }), s => JSON.stringify(s)),
  kinds: TURN_HOLD_STATES,
  kindsOf: s => [s.at],
  views: [{
    title: 'A player\'s turn, held from the tap to the GM\'s answer',
    note: 'src/views/uses.js keeps the one hold for the phone (`hold`, `command`), so a command tapped on the table or in the Skills panel waits under it whichever screen is up, and the table reads it to turn its buttons off. A sent command lets go only on a doc of another `at`, or on its own outbox entry refused or dropped; a doc, a refusal or a drop of another entry moves nothing. A consumable thrown from the Bag (`via: \'bag\'`) goes through the same `command` but posts unheld and leaves the turn free (ruling SMX-views-5.1; ruled the other way, it holds like a use from the map).',
    hides: '',
    state: s => WORDS[s.at],
    step,
  }],
  where: [
    ['The union', '`TurnHold`, `TurnHoldEvent`, `TurnHoldVia`, `TURN_HOLD_STATES` and `TURN_HOLD_EVENTS` in `src/core/combat/hold.ts`'],
    ['What changes it', '`turnHoldStep(hold, event)` and its `TABLE` in `src/core/combat/hold.ts`'],
    ['Who calls it', '`src/views/uses.js`, its one writer (`holdTo`, `hold`, `command`); the events `sync:outbox` (refused, dropped), `sync:room` and `sync:docs`; `src/views/table.js`, the Skills panel and the Bag post through `app.api.uses.command`'],
    ['The test to copy', '`tests/hold.test.ts`, the whole table'],
    ['The recipe', 'docs/guide/room-sync.md, the held turn\'s row'],
  ],
});
