// The chart of a view's main part or a panel on the page (src/core/panel.ts `panelDrawn`, audits SMX-sync-10 and
// SMX-views-9), walked with each answer of its `when` and each of its calls throwing or not.
import { PANEL_SAID, PANEL_STATES, panelDrawn } from '../../src/core/panel.ts';
import type { PanelCall, PanelSaid, PanelState } from '../../src/core/panel.ts';
import { bfs, machine } from '../statecharts.ts';

/** One draw: what `when` answered, and which call of the part threw (null: none). */
type Draw = { readonly said: PanelSaid; readonly throws: PanelCall | null };
const WALK: readonly Draw[] = PANEL_SAID.flatMap(said => ([null, 'mount', 'update'] as const).map(throws => ({ said, throws })));

const WORDS: { readonly [S in PanelState]: string } = {
  asked: 'Not mounted yet',
  live: 'Mounted, updated each draw it shows',
  failed: '"This section failed to load"',
};
function step(e: Draw): string {
  return e.said === 'threw' || e.throws !== null ? 'its when, mount or update throws' : 'a draw where it shows';
}

export const panel = machine<PanelState, Draw>({
  name: 'A view\'s part or a panel on the page',
  walked: `Every place reachable from a part not drawn yet, under the ${WALK.length} draws (each answer of its \`when\`, with no call, its mount or its update throwing), breadth first.`,
  walk: () => bfs<PanelState, Draw>(['asked'], s => WALK.flatMap(event => { const to = panelDrawn(s, event.said, call => call !== event.throws); return to === s ? [] : [{ event, to }]; }), s => s),
  kinds: PANEL_STATES,
  kindsOf: s => [s],
  views: [{
    title: 'A part from its first draw to mounted or failed',
    note: 'Each draw of its view asks the part\'s `when` once. A `when` that says no hides the part wherever it is and changes nothing. A part is mounted once, the first time it shows, and updated each draw it shows after. A `when` or a call that throws is a bug, logged: the part shows "This section failed to load" whenever its `when` does not say no, and runs nothing more until a reload; a part whose `when` threw before it showed is never mounted.',
    hides: '',
    state: s => WORDS[s],
    step,
  }],
  where: [
    ['The union', '`PanelState`, `PanelSaid`, `PanelCall`, `PanelDraw`, `PANEL_STATES` and `PANEL_SAID` in `src/core/panel.ts`'],
    ['What changes it', '`panelDrawn(at, said, ran)` and its `TABLE`; `panelDraw` says whether the part shows'],
    ['Who calls it', '`src/app.js`, which keeps each part\'s place (`part.at`) and moves it only by `panelDrawn` as it draws a view'],
    ['The test to copy', '`tests/views.test.ts`, the life of a part'],
    ['The recipe', 'docs/guide/makers.md, the panel row'],
  ],
});
