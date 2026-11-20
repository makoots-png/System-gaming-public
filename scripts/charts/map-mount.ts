// The chart of the battle map's life on the page (src/core/combat/map-mount.ts `mapMount`, audit SM-views-3), walked with
// the events of tests/models/map-mount-events.ts over two fights.
import { BLANK, MAP_MOUNT_STATES, mapMount } from '../../src/core/combat/map-mount.ts';
import type { MapMount, MapMountEvent } from '../../src/core/combat/map-mount.ts';
import { MOUNT_WALK } from '../../tests/models/map-mount-events.ts';
import { bfs, machine } from '../statecharts.ts';

function state(s: MapMount): string {
  switch (s.at) {
    case 'blank': return 'Blank: no fight to show (hidden)';
    case 'opening': return `Opening fight ${s.fight}, not framed yet`;
    case 'framed': return `Fight ${s.fight} framed`;
    case 'gone': return 'Gone: off the page, listening to nothing';
    default: return s satisfies never;
  }
}
function step(e: MapMountEvent, from: MapMount, to: MapMount): string | null {
  const fx = mapMount(from, e).fx.map(f => f.kind), said = fx.length ? ` (${fx.join(', ')})` : '';
  switch (e.kind) {
    case 'show': return `${e.fight === null ? 'the source shows no fight' : `a draw shows fight ${e.fight}`}${said}`;
    case 'drawn': return null;
    case 'sized': return from.at === 'framed' && to.at === 'framed' ? null : `the frame read with a size${said}`;
    case 'resized': return `the window resized${e.shown ? '' : ' while the frame was hidden'}${said}`;
    case 'gone': return `the screen takes it off the page${said}`;
    default: return e satisfies never;
  }
}

export const mapMountChart = machine<MapMount, MapMountEvent>({
  name: 'The battle map on the page',
  walked: `Every state reachable from a map just mounted, under the ${MOUNT_WALK.length} events of tests/models/map-mount-events.ts over two fights, breadth first.`,
  walk: () => bfs([BLANK], s => MOUNT_WALK.flatMap(event => { const to = mapMount(s, event).mount; return to === s ? [] : [{ event, to }]; }), s => JSON.stringify(s)),
  kinds: MAP_MOUNT_STATES,
  kindsOf: s => [s.at],
  views: [{
    title: 'A battle map from its mount in a screen\'s box to its removal',
    note: 'One map is mounted in the GM\'s fight screen or a player\'s HUD and outlives the fights it shows. A fight is its id, so the next fight on the same ground forgets what the last left (the gesture and its hold timer, the choice, the brush, the tokens\' and zones\' last draw, the open detail) and is framed afresh. A draw moves nothing itself: where the frame\'s size decides a move (a fight opening, new words over a framed one) it asks for it (measure), and the view reads it once and answers. An effect that leaves the fight framed draws no arrow: new words over the frame work its height out again (reheight), a resize of a shown map frames it again, and a draw whose turn came to a body out of sight frames it again at the frame\'s last size.',
    hides: '',
    state,
    step,
  }],
  where: [
    ['The union', '`MapMount`, `MapMountEvent`, `MapMountFx`, `MAP_MOUNT_STATES` and `MAP_MOUNT_EVENTS` in `src/core/combat/map-mount.ts`'],
    ['What changes it', '`mapMount(mount, event)` and its `TABLE`, through `live` in `src/views/map.js`, its one writer'],
    ['Who calls it', '`draw` in `src/views/map.js` (a draw begins, a draw is on the page, the frame\'s size read when the map asks), the window\'s resize, and `destroy`, which `src/views/combat.js` and `src/views/table.js` call when they take the map\'s box off the page'],
    ['The test to copy', '`tests/map-mount.test.ts`; the walk\'s events are in `tests/models/map-mount-events.ts`; on screen, `tests/e2e/battle-map.e2e.ts` ("zoomed the map out in one fight")'],
  ],
});
