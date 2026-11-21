// The chart of the battle map's life on the page (src/core/combat/map-mount.ts `mapMount`, audit SM-views-3), walked with
// the events of tests/models/map-mount-events.ts over two fights.
import { BLANK, BUILD_DRAWER_STATES, MAP_MOUNT_STATES, MAP_SLOT_EVENTS, MAP_SLOT_STATES, SCREEN, buildDrawer, mapMount, mapSlot } from '../../src/core/combat/map-mount.ts';
import type { BuildDrawer, BuildDrawerEvent, MapMount, MapMountEvent, MapSlot, MapSlotEvent } from '../../src/core/combat/map-mount.ts';
import { DRAWER_WALK, MOUNT_WALK } from '../../tests/models/map-mount-events.ts';
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

// The GM's fight screen around its map (src/views/combat.js, audit SMX-views-8): its box and the Build drawer.
const slotWords = (s: MapSlot): string => (s === 'mounted' ? 'A map in the box, drawn with the fight' : 'No map in the box');
export const mapSlotChart = machine<MapSlot, MapSlotEvent>({
  name: 'The fight screen\'s map box',
  walked: 'Both states of the box under its two draws, breadth first from an empty box.',
  walk: () => bfs<MapSlot, MapSlotEvent>(['empty'], s => MAP_SLOT_EVENTS.flatMap(event => { const to = mapSlot(s, event).slot; return to === s ? [] : [{ event, to }]; }), s => s),
  kinds: MAP_SLOT_STATES,
  kindsOf: s => [s],
  views: [{
    title: 'The GM\'s fight box holds a map only while it shows one',
    note: 'The screen draws its box with the fight on the map (Map view, the GM seat, a fight with rows) or hides it (List view, the Player seat, no fight, or the box about to be replaced). A hidden map is destroyed: it stops listening, closes its open detail and empties the box; showing the map again mounts a new one, framed afresh. A draw of a shown map draws it and moves nothing.',
    hides: '',
    state: slotWords,
    step: (e, from) => `${e === 'shows' ? 'the box shows the fight on the map' : 'the box hides the map'}${from === 'empty' && e === 'shows' ? ' (mount)' : from === 'mounted' && e === 'hides' ? ' (destroy)' : ''}`,
  }],
  where: [
    ['The union', '`MapSlot`, `MapSlotEvent`, `MapSlotFx`, `MAP_SLOT_STATES` and `MAP_SLOT_EVENTS` in `src/core/combat/map-mount.ts`'],
    ['What changes it', '`mapSlot(slot, event)` and its table, through `slotTo` in `src/views/combat.js`, the one writer of the screen\'s `mapView`'],
    ['Who calls it', '`render` in `src/views/combat.js`: each draw of a fight, and before the box\'s markup is replaced'],
    ['The test to copy', '`tests/map-mount.test.ts` ("the fight screen\'s map box"); on screen, `tests/e2e/battle-map.e2e.ts` ("leaves no map behind in the hidden box")'],
  ],
});

export const buildDrawerChart = machine<BuildDrawer, BuildDrawerEvent>({
  name: 'Who holds the Build drawer',
  walked: `Every state reachable from the screen's drawer, under the ${DRAWER_WALK.length} events of tests/models/map-mount-events.ts over two fights and none, breadth first.`,
  walk: () => bfs([SCREEN], s => DRAWER_WALK.flatMap(event => { const to = buildDrawer(s, event); return to === s ? [] : [{ event, to }]; }), s => JSON.stringify(s)),
  kinds: BUILD_DRAWER_STATES,
  kindsOf: s => [s.at],
  views: [{
    title: 'Add to the fight: the screen\'s, or the GM\'s for one fight',
    note: 'The screen opens the drawer, and closes it on a desktop once a fight is under way. A toggle against what the screen wants makes it the GM\'s for the fight on screen (none, when no fight is on or it has ended); the GM keeps it through that fight, and a draw of another fight, no fight, or that fight ended gives it back to the screen.',
    hides: '',
    state: s => (s.at === 'screen' ? 'The screen\'s: open, closed on a desktop once a fight is under way' : 'The GM\'s, for the fight it was moved in'),
    step: (e, from) => (e.kind === 'drawn' ? 'the screen draws another fight, or none (a fight that ended is none)'
      : from.at === 'screen' ? 'the GM opens or closes it against the screen' : 'the GM moves it again'),
  }],
  where: [
    ['The union', '`BuildDrawer`, `BuildDrawerEvent`, `BUILD_DRAWER_STATES` and `SCREEN` in `src/core/combat/map-mount.ts`'],
    ['What changes it', '`buildDrawer(drawer, event)` and its table, through `drawerTo` in `src/views/combat.js`, its one writer'],
    ['Who calls it', '`render` in `src/views/combat.js` (each draw, with the fight on screen) and the document\'s `toggle` listener for `[data-build]`'],
    ['The test to copy', '`tests/map-mount.test.ts` ("who opens the Build drawer"); on screen, `tests/e2e/battle-map.e2e.ts` ("folds away again when the next fight starts")'],
  ],
});
