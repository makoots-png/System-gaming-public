// The chart of a foe's life (src/core/combat/row-life.ts `FOE_TABLE`): a monster's, a shadow's or a summon's row in a
// fight, walked with the events of the hunter's life walk (tests/models/life-events.ts), which the foe table takes too.
import { FOE_LIFE_STATES, foeLifeAfter } from '../../src/core/combat/row-life.ts';
import type { FoeLife, FoeLifeState } from '../../src/core/combat/row-life.ts';
import type { LifeEvent } from '../../src/core/hunter/vitals.ts';
import { WALK_EVENTS, WALK_MAX, maxAfter } from '../../tests/models/life-events.ts';
import { bfs, machine } from '../statecharts.ts';

/** A foe's life and the maximum HP it is played against. */
type Foe = { life: FoeLife; hpMax: number };

/** The words of a combat card: a foe at 0 HP is defeated. */
const LABEL: { readonly [S in FoeLifeState]: string } = { up: 'Up', dead: 'Defeated' };

function step(e: LifeEvent, from: Foe, to: Foe): string {
  switch (e.type) {
    case 'damage': return 'damage takes HP to 0';
    case 'setHp': return 'HP set to 0';
    case 'revive': return 'the GM taps Revive, up at 1 HP';
    case 'heal': case 'maxChanged':
      throw new Error(`${e.type} moved a foe's life from ${from.life.at} to ${to.life.at}, which the chart has no label for`);
  }
}

export const foeLife = machine<Foe, LifeEvent>({
  name: 'A foe\'s life in a fight',
  walked: `Every life reachable from a foe up at ${WALK_MAX} of ${WALK_MAX} HP under the ${WALK_EVENTS.length} events of the hunter's life walk (tests/models/life-events.ts), breadth first.`,
  walk: () => bfs(
    [{ life: { at: 'up', hp: WALK_MAX }, hpMax: WALK_MAX } as Foe],
    f => WALK_EVENTS.map(event => { const hpMax = maxAfter(event, f.hpMax); return { event, to: { life: foeLifeAfter(f.life, event, hpMax, 0), hpMax } }; }),
    f => JSON.stringify(f),
  ),
  kinds: FOE_LIFE_STATES,
  kindsOf: f => [f.life.at],
  views: [{
    title: 'A monster, shadow or summon in a fight, from up to defeated and back',
    note: 'The chart shows what a combat card says of a row that is not a hunter. Damage that leaves HP above 0, a heal and a lower maximum stay in Up. At 0 HP the row is defeated and gone from the map: no heal, no GM\'s hand edit and no regeneration lifts it, only the GM\'s Revive. A hunter\'s life follows the same states (see "A hunter\'s life").',
    hides: '',
    state: f => LABEL[f.life.at],
    step,
  }],
  where: [
    ['The union', '`FoeLife` and `FOE_LIFE_STATES` in `src/core/combat/row-life.ts`; a row holds it by its kind (`BodyLife` in `src/core/combat/effect-ops.ts`)'],
    ['What changes it', '`foeLifeAfter(life, event, hpMax, floor)` and its `FOE_TABLE` (the floor a mythic\'s gate, 0 on every other row); `rowLifeAfter(row, event)`, the one writer of a row\'s life, picks this table or the hunter\'s by the row\'s kind'],
    ['Who calls it', 'every HP change of the fight through `rowLifeAfter` (`hurt` and `healed` in `land.ts`, `payDue` in `fight-turn.ts`, an HP price in `charge.ts`, `withStatuses` in `effect-ops.ts`, `adjust` and the `revive` command in `fight.ts`)'],
    ['The test to copy', '`tests/fight.test.ts`, "a row\'s life"'],
    ['The recipe', 'docs/guide/combat.md, "Where a fight row\'s life changes"'],
  ],
});
