// The chart of one message in the outbox (src/core/sync/outbox.ts), walked with the events of tests/models/outbox-events.ts.
import { ENTRY_STATES, entryStep } from '../../src/core/sync/outbox.ts';
import type { Entry, EntryEvent, EntryState } from '../../src/core/sync/outbox.ts';
import { START, WALK_EVENTS } from '../../tests/models/outbox-events.ts';
import { bfs, machine } from '../statecharts.ts';

type S = Entry | { readonly at: 'sent' | 'dropped' };

/** What the player's phone holds of the message. */
const LABEL: { readonly [K in EntryState]: string } = {
  queued: 'Kept on this phone, waiting',
  sending: 'On its way to the room',
  sent: 'The room has it',
  refused: 'Refused by the room (kept to show)',
  dropped: 'Let go',
};

function step(e: EntryEvent, from: S): string {
  switch (e.type) {
    case 'send': return 'a good poll, or the post itself [first of its room]';
    case 'sent': return 'the room takes it';
    case 'failed': return 'no answer, or the server fails';
    case 'refused': return from.at === 'queued' ? 'the room no longer exists' : 'the room refuses it (4xx)';
    case 'reload': return 'the page reloads';
    case 'drop': return from.at === 'refused' ? 'a newer refusal, or a full box' : from.at === 'sending' ? 'its hunter (a tombstone\'s) is bound again' : 'its hunter is bound again, or a full box';
  }
}

export const outbox = machine<S, EntryEvent>({
  name: 'A message to the room',
  walked: `Every state reachable from a message just posted, under the ${WALK_EVENTS.length} events of tests/models/outbox-events.ts, breadth first.`,
  walk: () => bfs<S, EntryEvent>([START], s => (s.at === 'sent' || s.at === 'dropped' ? [] : WALK_EVENTS.map(event => {
    const to = entryStep(s as Entry, event);
    return { event, to: typeof to === 'string' ? { at: to } : to };
  })), s => s.at),
  kinds: ENTRY_STATES,
  kindsOf: s => [s.at],
  views: [{
    title: 'One message in the outbox: a use, a roll, a coin call, an award, a deleted hunter\'s tombstone',
    note: 'The outbox is in the save, so a message posted offline or before a reload is still there after it. Messages of one room go one at a time, oldest first, and only while this phone is in that room; another room\'s wait. A message whose send got no answer may have reached the room: it is sent again, and the room takes an event id once (server.ts `addEvent`; a tombstone is a sheet put), so it is never a second message. A full box (100) lets the oldest refusal go, then the oldest waiting message, and says so.',
    hides: '',
    state: s => LABEL[s.at],
    step,
  }],
  where: [
    ['The union', '`Entry`, `Letter`, `EntryEvent`, `ENTRY_STATES` and `ENTRY_EVENTS` in `src/core/sync/outbox.ts`; the box is the save\'s `settings.sync.outbox`'],
    ['What changes it', '`entryStep` and its `TABLE`; the box\'s `post`, `step`, `next`, `reloaded`, `roomGone`, `rebound`'],
    ['Who calls it', '`postLetter`, `flush` and `deliver` in `src/edge/sync.ts` (`app.api.sync.post`, `forget`), after each good poll; the room\'s answer through `callOf` and `sentEvent`'],
    ['The test to copy', '`tests/outbox.test.ts`; the walk\'s events are in `tests/models/outbox-events.ts`; two and three phones in `tests/room-system-model.test.ts`'],
    ['The recipe', 'docs/guide/room-sync.md, "A room message"'],
  ],
});
