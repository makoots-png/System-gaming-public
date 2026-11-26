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
    case 'down': return 'its HP reaches 0 (unreformed)';
    case 'evicted': return 'its owner adds another in the same lane past cap (it is the oldest)';
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
    note: 'A summon row is either a timed summon (`until: Tick`, 1 to 5 rounds, cap `kit.summons`) or a risen corpse (`until: null`, `rose: corpse.id`, cap `raise.maxRisen`). It acts on its own turns, a standard interval after it came, and its owner\'s phone commands it. A timed summon leaves at its first turn start at or after its end (risen rows skip time expiry). Either leaves when its owner goes down or leaves, at 0 HP if unreformed, when its owner exceeds its lane\'s cap, or when the fight ends. It gives no XP, is written to no sheet and keeps no side up: a fight whose side has only summons left is over.',
    hides: 'a turn that starts before its end keeps it present and is not drawn',
    state: s => (s === 'present' ? 'Present' : 'Gone'),
    step,
  }],
  where: [
    ['The union', '`SummonState`, `SummonEvent` and `SUMMON_STATES` in `src/core/combat/summons.ts`; a row\'s `owner`, `until` and `rose` in `Body` (`effect-ops.ts`)'],
    ['What changes it', '`summonStep(state, event)` and its `TABLE`; `dismissed`, `timeUp` and `crowded` read it'],
    ['Who calls it', '`summoned` and `risen` in `src/core/combat/fight.ts`; `consequences`, `sentAway`, `ended` and `startTurn` in `src/core/combat/fight-turn.ts`; `summonRow` in `src/core/combat/rows.ts` and `risenRow` in `src/core/combat/rise.ts`'],
    ['The test to copy', '`tests/fight.test.ts` ("a timed summon"), `tests/rise.test.ts`, `tests/rows.test.ts` ("a summon"); the walk\'s events are in `tests/models/summon-events.ts`'],
    ['The recipe', 'docs/guide/combat.md, "A summon"'],
  ],
});
