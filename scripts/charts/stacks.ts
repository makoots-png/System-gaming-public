// The chart of a stacking status's count (src/core/combat/stacks.ts, kits design table 2.1), walked with the events of
// tests/models/stack-events.ts on a Resonance-like rule; and, below, of a status's own life (`statusLife`).
import { STACK_STATES, stackStep } from '../../src/core/combat/stacks.ts';
import type { Stack, StackEvent } from '../../src/core/combat/stacks.ts';
import { STATUS_LIVES, statusStep } from '../../src/core/combat/standing.ts';
import type { StatusEvent, StatusLife } from '../../src/core/combat/standing.ts';
import { RESONANCE, STATUS_WALK, WALK_EVENTS } from '../../tests/models/stack-events.ts';
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

// The chart of a status's own life on its bearer (src/core/combat/standing.ts `statusStep`, SMX-rules-2), walked with
// the events of tests/models/stack-events.ts `STATUS_WALK`.
const LIFE_LABEL: { readonly [L in StatusLife]: string } = {
  gone: 'Not on the bearer', active: 'Active: its time runs, and it counts', owed: 'Owed: its time ran out; it counts for nothing and waits for its bearer\'s settle',
};
function lifeStep(e: StatusEvent, from: StatusLife, to: StatusLife): string {
  switch (e.type) {
    case 'land': return from === 'gone' ? (e.runs ? 'a use, a land op, a spread or the GM puts it on' : 'put on with its end already behind it') : 'put on again with an end ahead: it runs again';
    case 'time': return to === 'owed' ? 'fight time passes its end while its settle owes a round\'s share or its end' : 'fight time passes its end, and it owes nothing';
    case 'settle': return from === 'owed' ? 'its bearer\'s settle pays what it owes, and its end lands' : 'its bearer\'s settle at or past its end: its end lands';
    case 'taken': return 'a cure, a dispel or a spend of its last stack takes it whole';
  }
}

export const statusLifeChart = machine<StatusLife, StatusEvent>({
  name: 'A status\'s life',
  walked: `Every life reachable from not on the bearer under the ${STATUS_WALK.length} events of tests/models/stack-events.ts \`STATUS_WALK\`, breadth first.`,
  walk: () => bfs<StatusLife, StatusEvent>(['gone'], s => STATUS_WALK.map(event => ({ event, to: statusStep(s, event) })), s => s),
  kinds: STATUS_LIVES,
  kindsOf: s => [s],
  views: [{
    title: 'A status on one bearer, from put on to gone',
    note: 'A status counts for every reader of its ops (its wards, shares, stats, dice, a hold) only while it is active: `counts` reads the row `STATUS_COUNTS`, whose `owed` cell is SMX-rules-2.1\'s ruling: it does not count (the owner, Nov 22). Once fight time passes its end it is owed while its bearer\'s next settle still has a per-round share to pay or an end to land, and it is gone at that settle; with nothing owed it is gone as time moves. Its count, when it stacks, is the stack machine\'s, and whether its end lands at a cure is the delayed effect\'s.',
    hides: '',
    state: s => LIFE_LABEL[s],
    step: lifeStep,
  }],
  where: [
    ['The union', '`StatusLife`, `StatusEvent` and `STATUS_LIVES` in `src/core/combat/standing.ts`; the owed mark `Status.owed` in `src/core/combat/effect-ops.ts`'],
    ['What changes it', '`statusStep(life, event)` and its `STATUS_TABLE`; whether it counts, `counts` and its `STATUS_COUNTS`'],
    ['Who calls it', '`applyStatus` (a land) and `settle` in `src/core/combat/effect-ops.ts`; `advance` (time) in `src/core/combat/fight-turn.ts`; every reader asks `counts` (standing.ts, `modsOf`, land.ts `live`)'],
    ['The test to copy', '`tests/effect-ops.test.ts` ("a status\'s own life on its bearer"); the walk\'s events are in `tests/models/stack-events.ts`'],
    ['The recipe', 'docs/guide/combat.md, "A stacking status"'],
  ],
});
