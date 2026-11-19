// The chart of a limited use (src/core/combat/uses.ts `usesStep`, kits design table 2.3), walked with the events of
// tests/models/uses-events.ts for an ability of two uses a fight and one of two uses a long rest.
import { USES_STATES, usesStep } from '../../src/core/combat/uses.ts';
import type { Uses, UsesEvent } from '../../src/core/combat/uses.ts';
import type { AbilityGate } from '../../src/core/combat/ability-types.ts';
import { USES_WALK } from '../../tests/models/uses-events.ts';
import { bfs, machine } from '../statecharts.ts';

type G = Extract<AbilityGate, { kind: 'uses' }>;
type S = { readonly gate: G; readonly u: Uses };
const GATES: readonly G[] = [{ kind: 'uses', per: 'fight', n: 2 }, { kind: 'uses', per: 'rest', n: 2 }];

function step(e: UsesEvent, from: S): string {
  switch (e.type) {
    case 'used': return 'a use resolves';
    case 'fightEnds': return from.gate.per === 'fight' ? 'the fight ends: the next fight starts with all' : 'the fight ends: the sheet keeps the count';
    case 'longRest': return 'a long rest';
    case 'gmSets': return 'the GM sets the uses spent';
  }
}

export const uses = machine<S, UsesEvent>({
  name: 'A limited use',
  walked: `Every state reachable from all uses left, for an ability of 2 uses a fight and one of 2 a long rest, under the ${USES_WALK.length} events of tests/models/uses-events.ts, breadth first.`,
  walk: () => bfs(GATES.map(gate => ({ gate, u: { at: 'ready', left: gate.n } as Uses })), s => USES_WALK.map(event => ({ event, to: { gate: s.gate, u: usesStep(s.u, event, s.gate) } })), s => JSON.stringify(s)),
  kinds: USES_STATES,
  kindsOf: s => [s.u.at],
  views: [{
    title: 'An ability with uses a fight or a long rest',
    note: 'A use counts when it resolves, not when it is refused; a spent one is refused (`noUses`) and changes nothing. One limited a fight starts every fight with all its uses (its row is new). One limited a long rest starts the fight with what its hunter\'s sheet has spent since the last long rest, and the fight writes its count back with the hunter\'s vitals; a long rest gives them all back. A "per day" in the sheet reads as per long rest. The GM sets the uses spent with the fight\'s Adjust.',
    hides: '',
    state: s => [s.gate.per === 'fight' ? 'Two a fight' : 'Two a long rest', s.u.at === 'spent' ? 'Spent' : `${s.u.left} left`],
    step,
  }],
  where: [
    ['The union', '`Uses`, `UsesEvent` and `USES_STATES` in `src/core/combat/uses.ts`; the row\'s count is `Body.used`, the sheet\'s `Vitals.used`'],
    ['What changes it', '`usesStep(uses, event, gate)` and its `TABLE`; `usesOf` reads a row, `counted` counts a use'],
    ['Who calls it', 'rule 3b (`gated`) in `src/core/combat/resolve.ts`; `act` and `adjust` in `src/core/combat/fight.ts`; `writeBack` in `src/core/combat/fight-turn.ts`; a long rest in `src/core/hunter/vitals.ts`'],
    ['The test to copy', '`tests/fight.test.ts` ("a limited use"); the walk\'s events are in `tests/models/uses-events.ts`'],
    ['The recipe', 'docs/guide/combat.md, "A price or a gate kind"'],
  ],
});
