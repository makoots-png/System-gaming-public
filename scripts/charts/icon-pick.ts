// The chart of a maker's Icon row (src/core/icon-pick.ts `iconPickStep`, icons design section 6), walked from an item
// maker opened on a new item with a tap on the row, a group, a pick, "Default" and a close.
import { ICON_PICK_STATES, iconPickStart, iconPickStep } from '../../src/core/icon-pick.ts';
import type { IconPick, IconPickEvent } from '../../src/core/icon-pick.ts';
import { bfs, machine } from '../statecharts.ts';

/** Every kind of event: the row tapped, another group and the item's own, a cell, the "Default" cell, and a close. */
const WALK: readonly IconPickEvent[] = [{ kind: 'opened' }, { kind: 'group', group: 'foe' }, { kind: 'group', group: 'item' }, { kind: 'picked', key: 'raven' }, { kind: 'picked', key: null }, { kind: 'shut' }];

function step(e: IconPickEvent): string {
  switch (e.kind) {
    case 'opened': return 'the GM taps the Icon row';
    case 'group': return 'the GM taps a group';
    case 'picked': return e.key ? 'the GM taps an icon' : 'the GM taps Default';
    case 'shut': return 'Escape, a tap beside the sheet or its ×';
  }
}

export const iconPick = machine<IconPick, IconPickEvent>({
  name: 'A maker\'s icon',
  walked: `Every state reachable from an item maker opened on a new item, under the ${WALK.length} events of each kind, breadth first.`,
  walk: () => bfs([iconPickStart('item')], s => WALK.flatMap(event => { const to = iconPickStep(s, event); return to === s ? [] : [{ event, to }]; }), s => JSON.stringify(s)),
  kinds: ICON_PICK_STATES,
  kindsOf: s => [s.at],
  views: [{
    title: 'The Icon row of the monster, item and status makers',
    note: 'The sheet opens on the thing\'s own group (a monster\'s Foe, an item\'s Item, a status\'s Status), or on the group of the icon picked, so the pick in use is lit. Default stores no key: the thing shows the picture its form gives (icon-defaults.ts), and the row\'s line says which field gives it. The pick is saved only with the form: Cancel drops it as it drops any field. The walk taps one group past the item\'s own, Foe; each other group moves it the same way.',
    hides: '',
    state: s => (s.at === 'closed' ? (s.pick ? 'Closed, an icon picked' : 'Closed, Default') : `Open on ${s.group === 'foe' ? 'another group' : 'its own group'}${s.pick ? ', an icon picked' : ''}`),
    step,
  }],
  where: [
    ['The union', '`IconPick`, `IconPickEvent`, `ICON_PICK_STATES` and `ICON_PICK_EVENTS` in `src/core/icon-pick.ts`'],
    ['What changes it', '`iconPickStep(icon, event)` and its `TABLE` in `src/core/icon-pick.ts`; the row\'s line is `iconShown` and `iconWords` there'],
    ['Who calls it', '`iconField` in `src/views/maker.js`, which keeps one `picker` per maker and moves it only by `iconPickStep`; its sheet is a window over the maker (ui.js `openWindow`)'],
    ['The test to copy', '`tests/icon-pick.test.ts`, "every state against every event"'],
    ['The recipe', 'docs/guide/makers.md, "An icon"'],
  ],
});
