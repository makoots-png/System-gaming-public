// The chart of the room server's database (src/core/room-server.ts), walked with the events of tests/models/db-events.ts.
import { DB_STATES, dbStep } from '../../src/core/room-server.ts';
import type { Db, DbEvent, DbState } from '../../src/core/room-server.ts';
import { START, WALK_EVENTS } from '../../tests/models/db-events.ts';
import type { AnyStore } from '../../tests/models/db-events.ts';
import { bfs, machine } from '../statecharts.ts';

/** What the deploy's log and /api/health say. */
const LABEL: { readonly [S in DbState]: string } = {
  opening: 'Starting (Postgres asked)',
  ready: 'Rooms served',
  down: 'No rooms: health 503, the log says why',
  closed: 'Shut down: no rooms, no more tries',
};

function step(e: DbEvent<AnyStore>, from: Db<AnyStore>): string {
  if (e.type === 'close') return 'the server shuts down';
  if (e.type === 'opened') return from.at === 'down' ? 'Postgres answers a try (every 10 s)' : 'Postgres answers';
  return from.at === 'down' ? 'a try fails (every 10 s)' : 'Postgres does not answer';
}

export const db = machine<Db<AnyStore>, DbEvent<AnyStore>>({
  name: 'The room server\'s database',
  walked: `Every state reachable from the server's start (tests/models/db-events.ts) under the ${WALK_EVENTS.length} events of the walk, breadth first.`,
  walk: () => bfs([START], s => WALK_EVENTS.map(event => ({ event, to: dbStep(s, event) })), s => JSON.stringify(s)),
  kinds: DB_STATES,
  kindsOf: s => [s.at],
  views: [{
    title: 'The rooms\' database, from the server\'s start (with DATABASE_URL)',
    note: 'Without DATABASE_URL the rooms are in memory and the database is ready from the start. With it, the rooms are in Postgres and nowhere else: while it is down no room route answers (503, never "no such room", so no phone takes its room for gone), the site itself still loads, and the server opens it again every 10 s. A query that fails once the database is ready is that request\'s 500, and /api/health asks Postgres each time, so it answers 503 then too; the chart leaves that out, since nothing is reopened. A shutdown closes it from any state, and a try that answers after it is closed again.',
    hides: '',
    state: s => LABEL[s.at],
    step,
  }],
  where: [
    ['The union', '`Db`, `DbEvent`, `DB_STATES` and `DB_EVENTS` in `src/core/room-server.ts`'],
    ['What changes it', '`dbStep(db, event)` and its `TABLE`; `dbHealth` for what /api/health answers'],
    ['Who calls it', '`database(url)` and `openDatabase(store)` in `server.ts`: the first opens Postgres and tries again while it is down; both hold their `Db` as their one state and close through it'],
    ['The test to copy', '`tests/room-server.test.ts`; the walk\'s events are in `tests/models/db-events.ts`; a down Postgres end to end in `tests/server-rooms.test.ts` and `tests/server-start.test.ts`'],
    ['The recipe', 'docs/guide/hunters.md, "A state or event of the ... machine"'],
  ],
});
