// The chart of a shadow's life (src/core/hunter/shadows.ts), walked with the events of tests/models/shadow-events.ts.
import { SHADOW_STATES, shadowState, stepShadow } from '../../src/core/hunter/shadows.ts';
import type { ShadowEvent, ShadowState } from '../../src/core/hunter/shadows.ts';
import type { Hunter } from '../../src/core/save.ts';
import { isRefused } from '../../src/core/save-step.ts';
import { ARMY, WALK_EVENTS } from '../../tests/models/shadow-events.ts';
import { bfs, machine } from '../statecharts.ts';

/** The words of the Shadows panel. */
const LABEL: { readonly [S in ShadowState]: string } = { resting: 'In the army', summoned: 'Summoned', released: 'Released (gone)' };

function step(e: ShadowEvent): string {
  switch (e) {
    case 'summon': return 'Summon (pays its rank\'s summon mana)';
    case 'dismiss': return 'Dismiss (no mana back)';
    case 'release': return 'Release, after a confirm';
  }
}

export const shadow = machine<Hunter, ShadowEvent>({
  name: 'A shadow',
  walked: `Every state of one shadow reachable from a hunter with that shadow resting (tests/models/shadow-events.ts) under the ${WALK_EVENTS.length} events of its life, breadth first.`,
  walk: () => bfs([ARMY()], h => WALK_EVENTS.flatMap(event => { const to = stepShadow(h, 'sh1', event); return isRefused(to) ? [] : [{ event, to }]; }), h => shadowState(h, 'sh1')),
  kinds: SHADOW_STATES,
  kindsOf: h => [shadowState(h, 'sh1')],
  views: [{
    title: 'A shadow, from its extraction to its release',
    note: 'The chart starts when a shadow has joined the army (an extraction that passed, or the GM\'s grant). It leaves out its HP, which a fight writes back and Heal refills, its name and its notes: none of them moves the state. A summon the hunter has not the mana for is refused before the event.',
    hides: '',
    state: h => LABEL[shadowState(h, 'sh1')],
    step,
  }],
  where: [
    ['The union', '`ShadowState`, `ShadowEvent`, `SHADOW_STATES` and `SHADOW_EVENTS` in `src/core/hunter/shadows.ts`'],
    ['What changes it', '`stepShadow(hunter, id, event)` and its `TABLE`; `can` for the panel\'s buttons'],
    ['Who calls it', '`src/views/shadows.js` (Summon, Dismiss, Release)'],
    ['The test to copy', '`tests/shadows.test.ts`; the walk\'s events are in `tests/models/shadow-events.ts`'],
    ['The recipe', 'docs/guide/hunters.md, "A state or event of the ... machine"'],
  ],
});
