// The chart of a hunter's life (src/core/hunter/vitals.ts), walked with the events of the walk in tests/vitals.test.ts.
import { LIFE_STATES, lifeAfter, newVitals } from '../../src/core/hunter/vitals.ts';
import type { Life, LifeEvent, LifeState } from '../../src/core/hunter/vitals.ts';
import { WALK_EVENTS, WALK_MAX, maxAfter } from '../../tests/models/life-events.ts';
import { bfs, machine } from '../statecharts.ts';

/** A life and the maximum HP it is played against. */
type Hunter = { life: Life; hpMax: number };

/** The words of the sheet and the GM's cards (`LIFE_TAG` in src/core/hunter/vitals.ts), with Up for a hunter on their feet. */
const LABEL: { readonly [S in LifeState]: string } = { up: 'Up', dying: 'Dying', stable: 'Stable', dead: 'Dead' };

function step(e: LifeEvent, from: Hunter, to: Hunter): string {
  switch (e.type) {
    case 'damage': return 'damage takes HP to 0';
    case 'heal': return 'healed (a heal, a rest or a refill)';
    case 'setHp': return to.life.at === 'up' ? 'HP set above 0 on the bar' : 'HP set to 0 on the bar';
    case 'deathSave':
      if (to.life.at === 'up') return 'a death save of 20, up at 1 HP';
      return to.life.at === 'stable' ? 'a third death save succeeds' : 'a third death save fails (a 1 counts as two)';
    case 'stabilize': return 'the GM taps Stabilize';
    case 'revive': return 'the GM taps Revive or a Resurrection Crystal is used, up at 1 HP';
    case 'maxChanged': throw new Error(`maxChanged moved a life from ${from.life.at} to ${to.life.at}, which the chart has no label for`);
  }
}

export const life = machine<Hunter, LifeEvent>({
  name: 'A hunter\'s life',
  walked: `Every life reachable from a new hunter (up at ${WALK_MAX} of ${WALK_MAX} HP) under the ${WALK_EVENTS.length} events of the walk in tests/vitals.test.ts (tests/models/life-events.ts), breadth first.`,
  walk: () => bfs(
    [{ life: newVitals({ hpMax: WALK_MAX, manaMax: 0, fatigueMax: 0 }).life, hpMax: WALK_MAX }],
    h => WALK_EVENTS.map(event => { const hpMax = maxAfter(event, h.hpMax); return { event, to: { life: lifeAfter(h.life, event, hpMax), hpMax } }; }),
    h => JSON.stringify(h),
  ),
  kinds: LIFE_STATES,
  kindsOf: h => [h.life.at],
  views: [{
    title: 'A hunter\'s life, from up to dead and back',
    note: 'The chart shows what the sheet, the GM board and a combat card say of a hunter. Everything that keeps the hunter up stays in Up: damage that leaves HP above 0, a heal, a lower maximum. A dying hunter\'s first and second saves, of either kind, stay in Dying; the pips count them, and getting up clears them. Damage to a hunter who is down changes nothing. Only a revive leaves Dead, the GM\'s Revive or a Resurrection Crystal used from the bag outside a fight: healing, a rest and a refill do not. MP, fatigue and a collapse are kept beside the life and are not drawn.',
    hides: '',
    state: h => LABEL[h.life.at],
    step,
  }],
  where: [
    ['The union', '`Life`, `LifeEvent` and `LIFE_STATES` in `src/core/hunter/vitals.ts`'],
    ['What changes it', '`lifeAfter(life, event, hpMax)` and its `TABLE`; `hit`, `rest` and `refill` for a hunter\'s vitals; `can(life, eventType)` for a button'],
    ['Who calls it', '`lifeEvent` and `api.life` in `src/views/hunter.js` (the sheet; the GM board\'s Revive in `src/views/gm.js` calls `api.life`), `useItem` in `src/core/hunter/use.ts` (a Resurrection Crystal, through `sheetEdit`), and the fight\'s HP effects in `src/views/combat.js`'],
    ['The test to copy', '`tests/vitals.test.ts`; the walk\'s events are in `tests/models/life-events.ts`'],
    ['The recipe', 'docs/guide/hunters.md, "To add a field to a hunter" (a new life state or event)'],
  ],
});
