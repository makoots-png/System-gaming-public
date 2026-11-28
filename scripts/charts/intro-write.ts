// The chart of the GM phone's `_intro` doc write machine (src/core/sync/intro-write.ts), walked with
// tests/models/intro-write-events.ts.
import { INTRO_WRITE_STATES, introWriteStep } from '../../src/core/sync/intro-write.ts';
import type { IntroWrite, IntroWriteAt, IntroWriteEvent } from '../../src/core/sync/intro-write.ts';
import { START, WALK_EVENTS } from '../../tests/models/intro-write-events.ts';
import { bfs, machine } from '../statecharts.ts';

const LABEL: { readonly [K in IntroWriteAt]: string } = {
  idle: 'Idle',
  sending: 'Putting _intro to the room',
  sendingQueued: 'Putting _intro, newer write queued',
  retrying: 'Put failed: waiting to retry',
};

function step(e: IntroWriteEvent<string>, from: IntroWrite<string>, to: IntroWrite<string>): string {
  switch (e.type) {
    case 'write':
      if (from.at === 'sending') return 'another write while the put is out';
      if (from.at === 'retrying') return 'a newer write cancels the backoff and puts now';
      return 'GM writes _intro';
    case 'due':
      return 'retry timer fires';
    case 'answered':
      if (from.at === 'sendingQueued') return 'put answered: immediately put the queued doc';
      if (e.put === 'stored') return 'room stores _intro';
      if (e.put === 'tooBig') return 'room refuses as too big';
      return to.at === 'retrying' ? 'put fails with retries left' : 'put fails after retries are exhausted';
    case 'left':
      return 'link leaves stretch: drop timer and fail waiters';
  }
}

export const introWriteChart = machine<IntroWrite<string>, IntroWriteEvent<string>>({
  name: 'The GM _intro doc writer',
  walked: `Every state reachable from idle, under the ${WALK_EVENTS.length} events of tests/models/intro-write-events.ts, breadth first.`,
  walk: () => bfs<IntroWrite<string>, IntroWriteEvent<string>>(
    [START],
    s => WALK_EVENTS.map(event => ({ event, to: introWriteStep(s, event).state })),
    s => (s.at === 'sending' || s.at === 'retrying' ? `${s.at}:${s.retriesLeft}` : s.at),
  ),
  kinds: INTRO_WRITE_STATES,
  kindsOf: s => [s.at],
  views: [{
    title: 'GM _intro doc write machine (serialized puts, retries, and stale-poll guard)',
    note: 'At most one PUT _intro is in flight per link stretch. Newer writes coalesce into sendingQueued and run right after the in-flight PUT ends. Failed PUTs retry on INTRO_RETRY_DELAYS_MS before resolving waiters false. Polls capture (seq, inFlight) at send time so a poll overlapping a PUT never overwrites the written doc.',
    hides: '',
    state: s => LABEL[s.at],
    step,
  }],
  where: [
    ['The union', '`IntroWrite`, `IntroWriteEvent`, `IntroWriteEffect`, `INTRO_WRITE_STATES` in `src/core/sync/intro-write.ts`'],
    ['What changes it', '`introWriteStep` and `INTRO_WRITE_TABLE`'],
    ['Who calls it', '`introWriteDo`, `setIntro`, `ask` (`introPollStamp`), `apply` (`keepLocalIntro`), and `stretchLeft` in `src/edge/sync.ts`'],
    ['The test to copy', '`tests/intro-write.test.ts`; the walk\'s events are in `tests/models/intro-write-events.ts`'],
    ['The recipe', 'docs/guide/machines.md and docs/guide/room-sync.md'],
  ],
});
