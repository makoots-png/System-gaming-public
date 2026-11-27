// The chart of what one item is to a hunter (src/core/hunter/inventory.ts `TABLE`), walked with the events of
// tests/models/gear-events.ts.
import { WEAR_STATES, wearOf } from '../../src/core/hunter/inventory.ts';
import { RULES } from '../../src/core/rules.ts';
import type { WearEvent, WearState } from '../../src/core/hunter/inventory.ts';
import type { Hunter } from '../../src/core/save.ts';
import { isRefused } from '../../src/core/save-step.ts';
import { GEAR, IN_BAG, WALK_EVENTS, wearBy } from '../../tests/models/gear-events.ts';
import { bfs, machine } from '../statecharts.ts';

type Walked = { readonly h: Hunter; readonly inFight: boolean };
type Event = (typeof WALK_EVENTS)[number];

/** The words of the Bag and the Gear panel, out of a fight and in one. */
const LABEL: { readonly [S in WearState]: readonly [string, string] } = {
  bag: ['In the bag', 'In the bag, in a fight'],
  worn: ['Worn', 'Worn, locked by the fight'],
  gone: ['Gone', 'Gone'],
};
const label = (s: Walked): string => LABEL[wearOf(s.h, GEAR, RULES)][s.inFight ? 1 : 0];

const WORDS: { readonly [E in WearEvent]: string } = {
  equip: 'Equip',
  unequip: 'Unequip',
  edit: 'Edit its words',
  reslot: 'Edit it to another slot or a stack',
  remove: 'Sell or remove',
};
function step(e: Event): string {
  switch (e) {
    case 'fight starts': return 'a fight with the hunter starts';
    case 'fight ends': return 'the fight ends';
    default: return WORDS[e];
  }
}

function moves(s: Walked): { event: Event; to: Walked }[] {
  return WALK_EVENTS.flatMap((event): { event: Event; to: Walked }[] => {
    if (event === 'fight starts') return s.inFight ? [] : [{ event, to: { h: s.h, inFight: true } }];
    if (event === 'fight ends') return s.inFight ? [{ event, to: { h: s.h, inFight: false } }] : [];
    const h = wearBy(s.h, event, s.inFight);
    return isRefused(h) ? [] : [{ event, to: { h, inFight: s.inFight } }];
  });
}

export const gear = machine<Walked, Event>({
  name: 'Gear',
  walked: `Every state of one shield reachable from a hunter with it in the bag (tests/models/gear-events.ts) under the ${WALK_EVENTS.length} events of its wear and the hunter's fight, breadth first.`,
  walk: () => bfs([{ h: IN_BAG(), inFight: false }], moves, s => `${wearOf(s.h, GEAR, RULES)}|${s.inFight}`),
  kinds: WEAR_STATES,
  kindsOf: s => [wearOf(s.h, GEAR, RULES)],
  views: [{
    title: 'One item, from the bag to worn to gone',
    note: 'The chart follows one shield, a single one. It leaves out a stack: Equip on one splits a single item off and wears that, and the stack stays in the bag. It leaves out which slot a worn item is in (a ring takes the first free ring slot) and the item a new one swaps out of its slot, which goes back to the bag. A save is read to these states by `parseWorn` (hunter.ts: one item in two slots stays in the first; a stack goes back to the bag) and every read by `wornOf` (inventory.ts: an item whose def no longer fits its slot, or an off-hand item under a two-handed weapon, is in the bag). A worn item used up or given away leaves through `takeItems`, which no tap offers in a fight.',
    hides: '',
    state: label,
    step,
  }],
  where: [
    ['The union', '`WearState`, `WearEvent`, `WEAR_STATES` and `WEAR_EVENTS` in `src/core/hunter/inventory.ts`'],
    ['What changes it', '`TABLE` and `wearMove` in `src/core/hunter/inventory.ts`, asked by `wearPlan`, `equip`, `unequip`, `editItem`, `removeItem` and `sell`; `wearSet` handles loadouts; `fitWorn` (read through `wornOf`) is the single statement of the worn invariant'],
    ['Who calls it', '`src/views/inventory.js` (Equip, Unequip, Edit, Sell, Remove; `wearRefused` before a confirm), `src/views/custom.js` (a loadout\'s swap)'],
    ['The test to copy', '`tests/inventory.test.ts`, "what one item is"; the walk\'s events are in `tests/models/gear-events.ts`'],
    ['The recipe', 'docs/guide/hunters.md, "A state or event of the ... machine"'],
  ],
});
