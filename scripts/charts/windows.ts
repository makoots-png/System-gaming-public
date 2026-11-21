// The chart of the windows (src/core/windows.ts `windowStep`, audits SM-views-1 and SMX-views-6), walked with the events
// of tests/models/window-events.ts over two System windows, the first-run window and the dice roller's sheet.
import { NO_WINDOWS, WINDOW_STATES, windowStep } from '../../src/core/windows.ts';
import type { WindowEvent, Windows } from '../../src/core/windows.ts';
import { FIRST_RUN, QUICK_ROLL, WINDOW_WALK } from '../../tests/models/window-events.ts';
import { bfs, machine } from '../statecharts.ts';

const count = (n: number, what: string): string => (n === 0 ? '' : `${n === 1 ? 'one' : String(n)} ${what}`);
function systems(s: Windows): string {
  const mine = s.shown.filter(w => w.kind === 'system');
  const open = mine.some(w => w.at === 'open'), leaving = mine.filter(w => w.at === 'leaving').length;
  const behind = !open && s.shown.some(w => w.id === FIRST_RUN && w.at === 'open') ? ' behind the first-run window' : '';
  const said = [open ? 'one open' : '', count(leaving, 'leaving'), count(s.queued.length, 'waiting') + (s.queued.length ? behind : '')].filter(Boolean).join(', ');
  return said ? said[0]!.toUpperCase() + said.slice(1) : 'None';
}
function firstRun(s: Windows): string {
  const w = s.shown.find(x => x.id === FIRST_RUN);
  return !w ? 'Not up' : w.at === 'leaving' ? 'Leaving' : 'Open, on top (takes the keys)';
}
function sheet(s: Windows): string {
  const i = s.shown.findIndex(w => w.id === QUICK_ROLL);
  if (i < 0) return 'Closed';
  return s.shown.slice(i + 1).some(w => w.at === 'open') ? 'Open, under a window' : 'Open, on top (takes Escape)';
}
function step(e: WindowEvent): string {
  switch (e.kind) {
    case 'ask': return 'a System window is asked for';
    case 'next': return 'its turn: the oldest waiting opens on top';
    case 'open': return e.of === 'sheet' ? 'the dice roller opens on top' : 'setup or the quick start guide opens on top';
    case 'close': return e.id === FIRST_RUN ? 'setup or the guide closes' : e.id === QUICK_ROLL ? 'its × is tapped' : 'the open System window is answered';
    case 'gone': return 'its move out ends';
    case 'answered': return 'Confirm all of the open one answers it';
    case 'escape': return 'Escape is pressed';
    case 'went': return 'a tab is tapped (the one shown too)';
    default: return e satisfies never;
  }
}

export const windowsChart = machine<Windows, WindowEvent>({
  name: 'The windows',
  walked: `Every state reachable from no window, under the ${WINDOW_WALK.length} events of tests/models/window-events.ts over two System windows, the first-run window and the dice roller's sheet, breadth first.`,
  walk: () => bfs([NO_WINDOWS], s => WINDOW_WALK.flatMap(event => { const to = windowStep(s, event).windows; return to === s ? [] : [{ event, to }]; }), s => JSON.stringify(s)),
  kinds: WINDOW_STATES,
  kindsOf: s => [...new Set([...(s.queued.length ? ['queued'] : []), ...s.shown.map(w => w.at)])],
  views: [{
    title: 'The System windows, the first-run window and a sheet',
    note: 'A System window (a notice, a confirm, a prompt) opens one at a time and not over the first-run window, which takes the whole screen (its quick start guide too): asked while either is open, it waits, and the oldest waiting opens a task after the one before it closes. A maker, the shelf of awards and a story\'s window open at once over whatever is up and hold no System window. A sheet over the page (the dice roller here; the Fight tools and a card over a map act the same) is up while its owner shows it and goes at once: by its own close, by Escape while it is on top wherever the focus is, or by a tap on a tab, the one shown too. Every window that opens goes on top, so the order of the windows is the order on screen, and the top open window takes the keys (a sheet only Escape). Confirm all on the open System window answers it and the waiting ones that have one answer.',
    hides: '',
    state: s => ({ 'System windows': systems(s), 'The first-run window': firstRun(s), 'The dice roller': sheet(s) }),
    step,
  }],
  where: [
    ['The union', '`Windows`, `WindowEvent`, `WindowFx`, `WINDOW_STATES` and `WINDOW_EVENTS` in `src/core/windows.ts`'],
    ['What changes it', '`windowStep(windows, event)` and its `TABLE`, through `move` in `src/views/ui.js`, its one writer, which carries out each effect'],
    ['Who calls it', '`system` (and `confirm`, `promptNum`, `promptText`), `openWindow` and `closeWindow` (`maker.js`, `onboard.js`, `give-shelf.js`, `stories.js`), `sheet` (`dice.js`, `combat.js`, `table.js`, each with its `WindowSheet`), all in `src/views/ui.js`; `went` from `route` in `src/app.js`'],
    ['The test to copy', '`tests/windows.test.ts`; the walk\'s events are in `tests/models/window-events.ts`; on screen, `tests/e2e/windows.e2e.ts`'],
    ['The recipe', 'docs/guide/makers.md, "A window on screen"'],
  ],
});
