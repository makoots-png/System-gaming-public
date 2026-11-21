// The charts of a hunter's life and of its fatigue and collapse (src/core/hunter/vitals.ts), walked with the events of
// tests/models/life-events.ts, which tests/vitals.test.ts plays too.
import { FATIGUE_STATES, LIFE_STATES, fatigueState, lifeAfter, newVitals, vitalStep } from '../../src/core/hunter/vitals.ts';
import type { FatigueState, Life, LifeEvent, LifeState, Maxima, VitalEvent, Vitals } from '../../src/core/hunter/vitals.ts';
import { RULES } from '../../src/core/rules.ts';
import { isRefused } from '../../src/core/save-step.ts';
import { COLLAPSE_EVENTS, COLLAPSE_MAX, WALK_EVENTS, WALK_MAX, collapseMaxAfter, maxAfter } from '../../tests/models/life-events.ts';
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
    ['What changes it', '`lifeAfter(life, event, hpMax)` and its `TABLE`; on a sheet `vitalStep` and its `VITAL_TABLE` (the life\'s events through `TABLE`), called by `sheetEdit` in `src/core/hunter/grant.ts`; `can(life, eventType)` for a button'],
    ['Who calls it', '`lifeEvent` and `api.life` in `src/views/hunter.js`, through `sheetEdit` (the sheet; the GM board\'s Revive in `src/views/gm.js` calls `api.life`), `useItem` in `src/core/hunter/use.ts` (a Resurrection Crystal, through `sheetEdit`), and in a fight `rowLifeAfter` in `src/core/combat/row-life.ts`, the one writer of a hunter row\'s life, which the `vitals` write-back carries to the sheet'],
    ['The test to copy', '`tests/vitals.test.ts`; the walk\'s events are in `tests/models/life-events.ts`'],
    ['The recipe', 'docs/guide/hunters.md, "To add a field to a hunter" (a new life state or event)'],
  ],
});

/** The collapse's walk: a hunter's vitals and the maxima they are played against. */
type Tired = { v: Vitals; m: Maxima };
/** The words of the sheet: Exhausted is the chip of a collapse. */
const FATIGUE_LABEL: { readonly [S in FatigueState]: string } = { fresh: 'Fresh', tired: 'Tired (a check penalty)', collapsed: 'Collapsed (Exhausted)' };

function collapseStep(e: VitalEvent, from: Tired, to: Tired): string | null {
  const into = fatigueState(to.v, to.m, RULES);
  switch (e.type) {
    case 'fatigue': return e.delta > 0 ? (into === 'collapsed' ? 'fatigue reaches the collapse share' : 'fatigue rises') : 'fatigue falls';
    case 'rest': return e.kind === 'long' ? 'a long rest' : 'a short rest';
    case 'maxChanged': return 'the capacity is lowered (today it collapses no one)';
    case 'fightTotals': return into === 'collapsed' && !from.v.collapsed ? 'the fight writes back fatigue at the collapse share' : 'the fight writes back its fatigue';
    case 'refill': return 'a level-up\'s refill';
    default: throw new Error(`${e.type} moved fatigue from ${fatigueState(from.v, from.m, RULES)} to ${into}, which the chart has no label for`);
  }
}

export const collapse = machine<Tired, VitalEvent>({
  name: 'A hunter\'s fatigue and collapse',
  walked: `Every fatigue and collapse reachable from a rested hunter (fatigue 0 of ${COLLAPSE_MAX.fatigueMax}) under the ${COLLAPSE_EVENTS.length} events of tests/models/life-events.ts (\`COLLAPSE_EVENTS\`), with the shipped rules, breadth first.`,
  walk: () => bfs(
    [{ v: newVitals(COLLAPSE_MAX), m: COLLAPSE_MAX }],
    t => COLLAPSE_EVENTS.flatMap(event => {
      const m = collapseMaxAfter(event, t.m), v = vitalStep(t.v, event, m, RULES);
      return isRefused(v) ? [] : [{ event, to: { v: { ...v, life: t.v.life }, m } }];
    }),
    t => JSON.stringify([t.v.fatigue, t.v.collapsed, t.m.fatigueMax]),
  ),
  kinds: FATIGUE_STATES,
  kindsOf: t => [fatigueState(t.v, t.m, RULES)],
  views: [{
    title: 'A hunter\'s fatigue, from fresh to collapsed and back',
    note: 'Tired is the rules\' check penalty share of the capacity and above; Collapsed is the latch, set when fatigue reaches the collapse share and ended only by a long rest, whatever fatigue does after. Two rows wait on the owner and are drawn as the app behaves today: a capacity lowered under the fatigue does not collapse the hunter (SMX-rules-6.1), and a collapse the fight\'s totals reached stays after the fight brings fatigue back down (SMX-rules-6.2). The life is not drawn (the chart above); a refill changes no fatigue.',
    hides: '',
    state: t => FATIGUE_LABEL[fatigueState(t.v, t.m, RULES)],
    step: collapseStep,
  }],
  where: [
    ['The union', '`FatigueState` and `FATIGUE_STATES` in `src/core/hunter/vitals.ts`; the stored latch is `Vitals.collapsed`'],
    ['What changes it', '`vitalStep` and its `COLLAPSE_MOVES` (rise, keep, or a long rest\'s recount)'],
    ['Who calls it', '`sheetEdit` in `src/core/hunter/grant.ts` (a hand edit, a rest, the fight\'s totals); `fitted` in `src/core/hunter/sheet.ts` (a lowered capacity)'],
    ['The test to copy', '`tests/vitals.test.ts`, "the collapse"; the walk\'s events are in `tests/models/life-events.ts`'],
    ['The recipe', 'docs/guide/hunters.md, "To add a field to a hunter"'],
  ],
});
