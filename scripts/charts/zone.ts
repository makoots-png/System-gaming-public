// The chart of a zone's life in the kits (src/core/combat/zones.ts `zoneStep`, kits design table 2.6), walked with the
// events of tests/models/zone-events.ts.
import { ZONE_STATES, zoneStep } from '../../src/core/combat/zones.ts';
import type { ZoneEvent, ZoneLife } from '../../src/core/combat/zones.ts';
import { ZONE_WALK } from '../../tests/models/zone-events.ts';
import { bfs, machine } from '../statecharts.ts';

function label(z: ZoneLife): string | readonly string[] {
  switch (z.at) {
    case 'laid': return 'On the ground';
    case 'lapsed': return ['Gone', 'Lapsed: its upkeep unpaid'];
    case 'evicted': return ['Gone', 'Evicted by its owner\'s fourth'];
    case 'ended': return ['Gone', z.landed ? 'Ended: its end landed' : 'Ended: nothing landed'];
  }
}

function step(e: ZoneEvent): string {
  switch (e.type) {
    case 'paid': return 'its owner\'s turn starts and pays the upkeep';
    case 'unpaid': return 'its owner\'s turn starts and cannot pay';
    case 'fourth': return 'its owner lays a fourth zone (it is the oldest)';
    case 'price': return e.old ? 'its owner\'s zone price, a round or more after it was laid' : 'its owner\'s zone price, younger than a round';
    case 'time': return e.old ? 'its time passes, a round or more after it was laid' : 'its time passes, younger than a round';
    case 'ownerDown': return 'its owner goes down (a zone that ends with its owner)';
  }
}

export const zone = machine<ZoneLife, ZoneEvent>({
  name: 'A zone with an upkeep and an end',
  walked: `Every state reachable from a zone on the ground under the ${ZONE_WALK.length} events of tests/models/zone-events.ts, breadth first.`,
  walk: () => bfs([{ at: 'laid' } as ZoneLife], z => ZONE_WALK.map(event => ({ event, to: zoneStep(z, event).to })), z => JSON.stringify(z)),
  kinds: ZONE_STATES,
  kindsOf: z => [z.at],
  views: [{
    title: 'A zone of the kits, from laid to gone',
    note: 'A zone an ability left may cost its owner an upkeep a round in fatigue or mana, paid at its owner\'s turn start for the time since it last paid; one it cannot pay lapses at once. One owner holds at most 3: a fourth evicts the oldest. Its end lands on whoever stands in it when it ends by its time or its owner\'s zone price, but only a round or more after it was laid, so placing and popping it in one turn is no blast with no wind-up. A lapse, an eviction and its owner going down land nothing. A zone the GM or a map put down has no upkeep and no age: its end lands when its time passes.',
    hides: '',
    state: label,
    step,
  }],
  where: [
    ['The union', '`ZoneLife`, `ZoneEvent` and `ZONE_STATES` in `src/core/combat/zones.ts`; a zone\'s `upkeep`, `end`, `triggers`, `laid` and `paid` in `ZoneKit`'],
    ['What changes it', '`zoneStep(life, event)` and its `ZONE_TABLE`; `placeZone` (the cap), `payUpkeep` (the upkeep), `pricedZones` (a price)'],
    ['Who calls it', '`act` and `release` in `src/core/combat/fight.ts`; `grounded`, `zoneEnds` and `startTurn` in `src/core/combat/fight-turn.ts`'],
    ['The test to copy', '`tests/fight.test.ts` ("a zone on the ground: the kits\' upkeep"); the walk\'s events are in `tests/models/zone-events.ts`'],
    ['The recipe', 'docs/guide/combat.md, "A zone op" and "A way a zone can lie"'],
  ],
});
