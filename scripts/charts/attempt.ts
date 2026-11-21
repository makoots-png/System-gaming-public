// The chart of a Create or Join tap, from the tap until its promise answers (src/core/sync/attempt.ts `attemptStep`,
// audit SM-sync-2), walked with the events of tests/models/attempt-events.ts.
import { ATTEMPT_STATES, attemptStep } from '../../src/core/sync/attempt.ts';
import type { Attempt, AttemptEvent, JoinsAs } from '../../src/core/sync/attempt.ts';
import type { LinkNotice } from '../../src/core/sync/link.ts';
import type { Asked } from '../../tests/models/attempt-events.ts';
import { START, WALK_EVENTS, eventsFrom } from '../../tests/models/attempt-events.ts';
import { bfs, machine } from '../statecharts.ts';

const JOINS: { readonly [K in JoinsAs['as']]: string } = {
  gm: 'As the GM',
  picked: 'As a hunter of the party',
  named: 'As a new hunter, made once in the room',
};

function label(s: Attempt<Asked>): string | readonly string[] {
  switch (s.at) {
    case 'none': return 'No tap out';
    case 'handed': return 'Handed to the link';
    case 'creating': return 'Creating a room';
    case 'joining': return ['Joining a room', JOINS[s.joins.as]];
  }
}

/** How the link's notice that ends a tap reads on an arrow. */
const ENDED: { readonly [N in LinkNotice]?: string } = {
  notFound: 'no such room: fails', keyRefused: 'the key is refused: fails', notAllowedBack: 'not allowed back: fails as removed',
  unreachable: 'no answer: fails as net', serverError: 'the server fails: fails as net', replaced: 'the campaign is replaced: fails, with no words',
};

function step(e: AttemptEvent<Asked>, from: Attempt<Asked>, to: Attempt<Asked>): string | null {
  switch (e.type) {
    case 'tap': return `${e.tap.type === 'create' ? 'Create' : 'Join'} tapped`;
    case 'linked': {
      if (from.at === 'handed') return to.at === 'none' ? (e.link.at === 'upgrading' || e.link.at === 'off' ? 'no server, or an update: fails as net' : 'the link does not take it: fails as busy') : 'the link takes it';
      if (to.at !== 'none') return null;
      if (e.took.type === 'leave') return 'you tap Leave room or Later: fails as left, with no words';
      const told = e.notices[0];
      if (told === undefined) return e.link.at === 'live' ? 'in the room: answers the code, gm or player' : 'out with no word: fails as net';
      return ENDED[told] ?? told;
    }
  }
}

const key = (s: Attempt<Asked>): string => (s.at === 'none' ? 'none' : JSON.stringify({ ...s, reply: '' }));

export const attempt = machine<Attempt<Asked>, AttemptEvent<Asked>>({
  name: 'A Create or Join tap',
  walked: `Every state reachable from no tap out, under the ${WALK_EVENTS.length} events of tests/models/attempt-events.ts (a create never ends with a join's notice), breadth first, a state's tap and who it is for making a state (not which promise it answers).`,
  walk: () => bfs([START], s => eventsFrom(s).flatMap(event => { const to = attemptStep(s, event).state; return to === s ? [] : [{ event, to }]; }), key),
  kinds: ATTEMPT_STATES,
  kindsOf: s => [s.at],
  views: [{
    title: 'One tap at a time, from Create or Join until the view that tapped is answered',
    note: 'The link does the room\'s side (its requests, its stretch, where a failed tap returns); this machine answers the tap. A tap while one is out starts nothing and is answered at once as busy, which the view words "Another create or join is under way". A join for a typed name makes its hunter only once the phone is in the room, in the write that binds it, so a join that fails made nothing. Page memory: a reload starts with no tap out.',
    hides: 'Each event that changes nothing: a tap while one is out (answered busy, the state unchanged), and a link step that stays in the stretch.',
    state: label,
    step,
  }],
  where: [
    ['The union', '`Attempt`, `AttemptEvent`, `AttemptEffect`, `JoinsAs`, `ATTEMPT_STATES` and `ATTEMPT_EVENTS` in `src/core/sync/attempt.ts`'],
    ['What changes it', '`attemptStep` and its table'],
    ['Who calls it', '`attemptDo` in `src/edge/sync.ts`, the only mover of `attempt`: `begin` raises `tap`, `drain` raises `linked` after each link step, `bindJoin` and the head read who a join is for through `joinBinds`'],
    ['The test to copy', '`tests/attempt.test.ts`; the walk\'s events are in `tests/models/attempt-events.ts`; on screen, `tests/e2e/room-sync-fixes.e2e.ts` ("a GM who taps New room while Open as GM is on its way", "a player whose join as a new hunter fails")'],
    ['The recipe', 'docs/guide/machines.md and docs/guide/room-sync.md, the Create or Join tap rows'],
  ],
});
