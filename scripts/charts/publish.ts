// The chart of one room doc the GM's phone publishes (src/core/sync/publish.ts), walked with the events of
// tests/models/publish-events.ts.
import { PUBLISH_STATES, publishStep } from '../../src/core/sync/publish.ts';
import type { Publish, PublishAt, PublishEvent } from '../../src/core/sync/publish.ts';
import { START, WALK_EVENTS } from '../../tests/models/publish-events.ts';
import { bfs, machine } from '../statecharts.ts';

/** What the GM's phone is doing with the doc. */
const LABEL: { readonly [K in PublishAt]: string } = {
  idle: 'Nothing to put',
  waiting: 'Changed: waiting for the burst of changes to end',
  sending: 'One put on its way to the room',
  sendingStale: 'One put on its way, and the doc changed since',
};

function step(e: PublishEvent, from: Publish): string {
  switch (e.type) {
    case 'changed': return from.at === 'sending' ? 'a change while the put is out' : 'the save, a poll or the link changes';
    case 'due': return 'the timer fires: the doc is built and put if the room holds another';
    case 'answered': return from.at === 'sendingStale' ? 'the put is answered: build it again' : {
      stored: 'the room takes it', tooBig: 'the room refuses it as too big', failed: 'no answer, or another refusal', unsent: 'nothing to put: the room holds it already',
    }[e.put];
  }
}

export const publish = machine<Publish, PublishEvent>({
  name: 'A room doc the GM publishes',
  walked: `Every state reachable from nothing due, under the ${WALK_EVENTS.length} events of tests/models/publish-events.ts, breadth first.`,
  walk: () => bfs<Publish, PublishEvent>([START], s => WALK_EVENTS.map(event => ({ event, to: publishStep(s, event).state })), s => s.at),
  kinds: PUBLISH_STATES,
  kindsOf: s => [s.at],
  views: [{
    title: 'One room doc on the GM\'s phone: the fight, the world, the rules, the codex, the solo gates, the feats',
    note: 'One machine per doc. The doc itself is not in the machine: when a put is due the GM\'s phone builds it and puts it only when the room holds another, so a failed put is tried again at the next change or poll. A doc the room refused as too big is marked with the stretch of the link it was refused in, and the pill says so; the chart leaves the mark out.',
    hides: '',
    state: s => LABEL[s.at],
    step,
  }],
  where: [
    ['The union', '`Publish`, `PublishEvent`, `PublishEffect`, `PUBLISH_STATES`, `PUBLISH_EVENTS` and `PUTS` in `src/core/sync/publish.ts`'],
    ['What changes it', '`publishStep` and its `TABLE`'],
    ['Who calls it', '`publishDo` in `src/edge/sync.ts`: `republish` raises `changed` for each doc, the timer `due`, `publishNow` `answered`'],
    ['The test to copy', '`tests/publish.test.ts`; the walk\'s events are in `tests/models/publish-events.ts`'],
    ['The recipe', 'docs/guide/machines.md and docs/guide/room-sync.md, "A state or event of the ... machine"'],
  ],
});
