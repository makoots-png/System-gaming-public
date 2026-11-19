// The chart of a stacking status's count (src/core/combat/stacks.ts, kits design table 2.1), walked with the events of
// tests/models/stack-events.ts on a Resonance-like rule.
import { STACK_STATES, stackStep } from '../../src/core/combat/stacks.ts';
import type { Stack, StackEvent } from '../../src/core/combat/stacks.ts';
import { RESONANCE, WALK_EVENTS } from '../../tests/models/stack-events.ts';
import { bfs, machine } from '../statecharts.ts';

const AT = RESONANCE.at ?? 0;

function step(e: StackEvent, from: Stack, to: Stack): string {
  const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;
  switch (e.type) {
    case 'apply': {
      const fired = stackStep(from, e, RESONANCE).fired;
      return fired ? `${plural(e.k, 'stack')} applied: the count reaches ${AT}, the threshold's ops land and ${AT} are spent` : `${plural(e.k, 'stack')} applied`;
    }
    case 'round': return 'a whole round held: one leaves';
    case 'event': return `its bearer ${e.event === 'struck' ? 'is struck' : e.event}: all leave`;
    case 'price': return `a price takes ${plural(e.m, 'stack')} (never fires the threshold)`;
    case 'timeEnds': return 'its time runs out (its end lands, if it has one)';
    case 'cure': return e.n === null ? 'a cure takes them all' : `a cure takes ${plural(e.n, 'stack')}`;
    case 'fightEnds': return to.at === 'absent' ? 'the fight ends: a fight\'s count goes with it' : 'the fight ends: a sheet\'s count is written back';
  }
}

export const stacks = machine<Stack, StackEvent>({
  name: 'A stacking status',
  walked: `Every count reachable from none under the ${WALK_EVENTS.length} events of tests/models/stack-events.ts, on a rule with a cap of ${RESONANCE.rule.cap}, one stack leaving a round, a fight's count and a threshold at ${AT} that spends, breadth first.`,
  walk: () => bfs([{ at: 'absent' } as Stack], s => WALK_EVENTS.map(event => ({ event, to: stackStep(s, event, RESONANCE).stack })), s => JSON.stringify(s)),
  kinds: STACK_STATES,
  kindsOf: s => [s.at],
  views: [{
    title: 'A stacking status on one bearer, from its first stack to its last',
    note: `The chart follows one status's count on one bearer: Resonance, whose threshold at ${AT} bursts and spends, so the count never rests at ${AT} or more and a burst drops it back to what was over. A threshold is a cell of this table, not a state: nothing records that it fired, so a threshold that keeps its count fires again only after the count falls below it and climbs back. The bearer's event changes nothing on this rule (its stacks leave a round); on a rule whose stacks leave on an event, that event takes them all, as a cure of all does here. An apply that sets nothing off (the GM's window, a sheet) adds without firing. What the threshold's ops do, and an end that lands, are the fight's (resolve.ts, the settle).`,
    hides: '',
    state: s => (s.at === 'absent' ? 'No stacks' : ['Held', `${s.n} stack${s.n === 1 ? '' : 's'}`]),
    step,
  }],
  where: [
    ['The union', '`Stack`, `StackEvent` and `STACK_STATES` in `src/core/combat/stacks.ts`; a def\'s `StackRule` in `src/core/combat/effect-ops.ts`'],
    ['What changes it', '`stackStep(stack, event, ctx)` and its `TABLE`'],
    ['Who calls it', '`applyStatus`, `cureStatus` and `settle` in `src/core/combat/effect-ops.ts`; a use\'s threshold in `src/core/combat/resolve.ts` (rule 18a)'],
    ['The test to copy', '`tests/effect-ops.test.ts` ("the stack machine, cell by cell"); the walk\'s events are in `tests/models/stack-events.ts`'],
    ['The recipe', 'docs/guide/combat.md, "A stacking status"'],
  ],
});
