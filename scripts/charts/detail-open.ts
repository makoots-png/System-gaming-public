// The chart of one list's open "more info" detail (src/core/detail-open.ts `detailStep`, audit SM-views-2), walked with
// the events of tests/models/detail-open-events.ts over two things of the list.
import { CLOSED, DETAIL_OPEN_STATES, detailStep } from '../../src/core/detail-open.ts';
import type { DetailEvent, DetailOpen } from '../../src/core/detail-open.ts';
import { DETAIL_WALK } from '../../tests/models/detail-open-events.ts';
import { bfs, machine } from '../statecharts.ts';

function step(e: DetailEvent): string {
  switch (e.kind) {
    case 'toggle': return `a tap on thing ${e.key} (on the map, a hold)`;
    case 'close': return 'closed (a tap on the map\'s detail, an ability picked)';
    case 'drop': return `thing ${e.key} dropped (a hold that was not one, or gone from the screen)`;
  }
}

export const detailOpen = machine<DetailOpen, DetailEvent>({
  name: 'A list\'s open detail',
  walked: `Every state reachable from a closed list of two things, under the ${DETAIL_WALK.length} events of tests/models/detail-open-events.ts, breadth first.`,
  walk: () => bfs([CLOSED], s => DETAIL_WALK.flatMap(event => { const to = detailStep(s, event); return to === s ? [] : [{ event, to }]; }), s => JSON.stringify(s)),
  kinds: DETAIL_OPEN_STATES,
  kindsOf: s => [s.at],
  views: [{
    title: 'One list\'s open detail',
    note: 'A list is the things one view draws together (the sheet\'s status chips, the GM card\'s abilities, the map\'s hotbar and zones), two of them here. Each move is drawn by the view\'s redraw, a close as an open; an event that changes nothing (a close on a closed list, a drop of a thing not open) is no move and draws nothing. Every list is closed when the app opens.',
    hides: '',
    state: s => (s.at === 'open' ? `Thing ${s.key} open` : 'All closed'),
    step,
  }],
  where: [
    ['The union', '`DetailOpen`, `DetailEvent`, `DETAIL_OPEN_STATES` and `DETAIL_EVENTS` in `src/core/detail-open.ts`'],
    ['What changes it', '`detailStep(open, event)` and its `TABLE`, through `move` in `src/views/detail.js`, which keeps each list\'s value and redraws'],
    ['Who calls it', 'a tap on a control `wire` sees (every view that draws a detail), and `src/views/map.js` (a hold on the hotbar, a zone tapped, its detail tapped, an ability picked, a thing gone)'],
    ['The test to copy', '`tests/detail-open.test.ts`; the walk\'s events are in `tests/models/detail-open-events.ts`; on screen, `tests/e2e/look.e2e.ts` ("opens it again")'],
    ['The recipe', 'docs/guide/makers.md, "More info on a thing"'],
  ],
});
