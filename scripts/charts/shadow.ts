// The chart of a shadow's life (src/core/hunter/shadows.ts), walked with the events of tests/models/shadow-events.ts.
import { SHADOW_CASES, shadowCase, shadowColumn, shadowState, stepShadow } from '../../src/core/hunter/shadows.ts';
import type { ShadowCase, ShadowColumn, ShadowEvent } from '../../src/core/hunter/shadows.ts';
import type { Hunter } from '../../src/core/save.ts';
import { isRefused } from '../../src/core/save-step.ts';
import { ARMY, WALK_EVENTS } from '../../tests/models/shadow-events.ts';
import { bfs, machine } from '../statecharts.ts';

/** The words of the Shadows panel, and its HP line at 0. */
const LABEL: { readonly [C in ShadowCase]: string } = {
  resting: 'In the army', restingFallen: 'In the army at 0 HP',
  summoned: 'Summoned', summonedFallen: 'Summoned at 0 HP',
  released: 'Released (gone)',
};

const WORDS: { readonly [C in ShadowColumn]: string } = {
  summon: 'Summon (pays its rank\'s summon mana)',
  dismiss: 'Dismiss (no mana back)',
  release: 'Release, after a confirm',
  fought: 'a fight leaves it above 0 HP',
  fell: 'it falls to 0 HP in a fight',
  heal: 'Full HP',
};

const caseOf = (h: Hunter): ShadowCase => shadowCase(shadowState(h, 'sh1'));

export const shadow = machine<Hunter, ShadowEvent>({
  name: 'A shadow',
  walked: `Every state of one shadow reachable from a hunter with that shadow resting at full HP (tests/models/shadow-events.ts) under the ${WALK_EVENTS.length} events of its life, breadth first.`,
  walk: () => bfs([ARMY()], h => WALK_EVENTS.flatMap(event => { const to = stepShadow(h, 'sh1', event); return isRefused(to) ? [] : [{ event, to }]; }), h => JSON.stringify(shadowState(h, 'sh1'))),
  kinds: SHADOW_CASES,
  kindsOf: h => [caseOf(h)],
  views: [{
    title: 'A shadow, from its extraction to its release',
    note: 'The chart starts when a shadow has joined the army (an extraction that passed, or the GM\'s grant). Its HP is in its state, and a box is drawn for a shadow at 0 HP; a fight that leaves it hurt but above 0, and Full HP on a shadow above 0, stay in their box. Two cells wait on the owner (rules-10.1): a shadow that falls stays Summoned, and one at 0 HP may be summoned. A summon the hunter has not the mana for is refused before the event; its name and notes do not move the state.',
    hides: '',
    state: h => LABEL[caseOf(h)],
    step: e => WORDS[shadowColumn(e)],
  }],
  where: [
    ['The union', '`ShadowState` (where it is, with its HP), `ShadowEvent`, the table\'s `ShadowCase` and `ShadowColumn` in `src/core/hunter/shadows.ts`'],
    ['What changes it', '`stepShadow(hunter, id, event)` and its `TABLE`; `setShadowHp` (a fight\'s write-back) and `healShadow` (Full HP) step it; `can` for the panel\'s buttons'],
    ['Who calls it', '`src/views/shadows.js` (Summon, Dismiss, Full HP, Release), `src/core/combat/fight-save.ts` and `src/core/gates/solo.ts` (a fight\'s HP)'],
    ['The test to copy', '`tests/shadows.test.ts`; the walk\'s events are in `tests/models/shadow-events.ts`'],
    ['The recipe', 'docs/guide/hunters.md, "A state or event of the ... machine"'],
  ],
});
