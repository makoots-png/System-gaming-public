// The chart of a timed summon (src/core/combat/summons.ts `summonStep`, kits design table 2.4), walked with the events of
// tests/models/summon-events.ts.
import { SUMMON_STATES, summonStep } from '../../src/core/combat/summons.ts';
import type { SummonEvent, SummonState } from '../../src/core/combat/summons.ts';
import { SUMMON_WALK } from '../../tests/models/summon-events.ts';
import { bfs, machine } from '../statecharts.ts';

function step(e: SummonEvent): string | null {
  switch (e.type) {
    case 'turn': return e.late ? 'its turn starts at or after its end: it leaves before it acts' : null;
    case 'ownerGone': return 'its owner goes down or leaves';
    case 'down': return 'its HP reaches 0';
    case 'third': return 'its owner calls a third (it is the oldest)';
    case 'fightEnds': return 'the fight ends (never written to a sheet)';
  }
}

export const summon = machine<SummonState, SummonEvent>({
  name: 'A timed summon',
  walked: `Every state reachable from present under the ${SUMMON_WALK.length} events of tests/models/summon-events.ts, breadth first.`,
  walk: () => bfs(['present' as SummonState], s => SUMMON_WALK.map(event => ({ event, to: summonStep(s, event) })), s => s),
  kinds: SUMMON_STATES,
  kindsOf: s => [s],
  views: [{
    title: 'A summon, from called to gone',
    note: 'An ability that summons calls a row of its archetype\'s body at its user\'s rank to its user\'s side, on the free tile nearest its user, for 1 to 5 rounds. It acts on its own turns, a standard interval after it came, and its owner\'s phone commands it. It leaves at its first turn start at or after its end (a summon of 2 rounds acts in 2 rounds of time), when its owner goes down or leaves, at 0 HP, or when its owner calls a third. It gives no XP, is written to no sheet and keeps no side up: a fight whose side has only summons left is over.',
    hides: 'a turn that starts before its end keeps it present and is not drawn',
    state: s => (s === 'present' ? 'Present' : 'Gone'),
    step,
  }],
  where: [
    ['The union', '`SummonState`, `SummonEvent` and `SUMMON_STATES` in `src/core/combat/summons.ts`; a row\'s `owner` and `until` in `Body` (`effect-ops.ts`)'],
    ['What changes it', '`summonStep(state, event)` and its `TABLE`; `dismissed`, `timeUp` and `crowded` read it'],
    ['Who calls it', '`summoned` (rule 18d) in `src/core/combat/fight.ts`; `consequences`, `sentAway` and `startTurn` in `src/core/combat/fight-turn.ts`; the row is `summonRow` in `src/core/combat/rows.ts`'],
    ['The test to copy', '`tests/fight.test.ts` ("a timed summon"), `tests/rows.test.ts` ("a summon"); the walk\'s events are in `tests/models/summon-events.ts`'],
    ['The recipe', 'docs/guide/combat.md, "A summon"'],
  ],
});
