// The chart of a trigger's limit on its bearer (src/core/combat/triggers.ts `tripStep`, kits design table 2.5), walked
// with the events of tests/models/trip-events.ts under each of its limits.
import { READY, TRIP_STATES, tripStep } from '../../src/core/combat/triggers.ts';
import type { Limit, Trip, TripEvent } from '../../src/core/combat/triggers.ts';
import { LIMITS, WALK_EVENTS } from '../../tests/models/trip-events.ts';
import { bfs, machine } from '../statecharts.ts';

/** A trip and the limit it is counted under. */
type S = { readonly limit: Limit; readonly trip: Trip };
const LIMIT_WORDS: { readonly [K in Limit['kind']]: string } = { each: 'Every time', round: 'Once a round', fight: 'Twice a fight' };

function label(s: S): readonly string[] {
  const t = s.trip, head = LIMIT_WORDS[s.limit.kind];
  switch (t.at) {
    case 'ready': return [head, 'Ready'];
    case 'tripped': return [head, 'Fired this round'];
    case 'counting': return [head, `Fired ${t.k} of ${s.limit.kind === 'fight' ? s.limit.n : t.k}`];
    case 'spent': return [head, 'Spent for the fight'];
  }
}

function step(e: TripEvent, from: S, to: S): string {
  if (e.type === 'skipped') return 'past the chain\'s depth or the command\'s 16 firings: skipped';
  const fires = tripStep(from.trip, e, from.limit).fires;
  return fires ? (from.trip.at === 'tripped' ? 'its event in a later round: it fires again' : 'its event: it fires') : `its event${to.trip.at === 'tripped' ? ' in the same round' : ''}: nothing`;
}

export const trips = machine<S, TripEvent>({
  name: 'A trigger\'s limit',
  walked: `Every trip reachable from ready under each of ${LIMITS.length} limits (every time, once a round, twice a fight) and the ${WALK_EVENTS.length} events of tests/models/trip-events.ts (its event in round 0, in round 1, and a skip), breadth first.`,
  walk: () => bfs(LIMITS.map(limit => ({ limit, trip: READY })), s => WALK_EVENTS.map(event => ({ event, to: { limit: s.limit, trip: tripStep(s.trip, event, s.limit).trip } })), s => JSON.stringify(s)),
  kinds: TRIP_STATES,
  kindsOf: s => [s.trip.at],
  views: [{
    title: 'One trigger of one status on one bearer, against its limit',
    note: 'The chart follows one trigger, under each of the three limits a GM picks. Its round is the fight\'s, `floor(now / round)`, so a trigger that fired in round 0 fires again in round 1 and not before. The count lives on the bearer\'s row, keyed by the status and the trigger\'s place in it, so a cure and a fresh copy of the status do not reset a once-a-fight trigger. A trigger past the chain\'s depth (2) or past 16 firings in one command is skipped and not counted. What its ops do is the fight\'s (`fire`, rule 19b).',
    hides: '',
    state: label,
    step,
  }],
  where: [
    ['The union', '`Trip`, `TripEvent` and `TRIP_STATES` in `src/core/combat/triggers.ts`; a def\'s `Trigger` and its `Limit` in the same file'],
    ['What changes it', '`tripStep(trip, event, limit)` and its `TABLE`'],
    ['Who calls it', '`fire` in `src/core/combat/triggers.ts`, called by the reducer after a use, a move and a turn\'s end (`fight.ts`) and at a turn\'s start (`fight-turn.ts`)'],
    ['The test to copy', '`tests/triggers.test.ts`; the walk\'s events are in `tests/models/trip-events.ts`'],
    ['The recipe', 'AGENTS.md, "A trigger event"'],
  ],
});
