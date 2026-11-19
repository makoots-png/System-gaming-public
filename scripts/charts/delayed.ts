// The chart of a delayed effect (src/core/combat/delayed.ts `endStep`, kits design table 2.2), walked with the events of
// tests/models/delayed-events.ts under each of its two cleanses.
import { DELAYED_STATES, endStep } from '../../src/core/combat/delayed.ts';
import type { Delayed, DelayedEvent } from '../../src/core/combat/delayed.ts';
import type { End } from '../../src/core/combat/effect-ops.ts';
import { ENDS, WALK_EVENTS } from '../../tests/models/delayed-events.ts';
import { bfs, machine } from '../statecharts.ts';

type S = { readonly end: End; readonly d: Delayed };
const LABEL: { readonly [K in Delayed['at']]: string } = {
  absent: 'Not on the bearer', armed: 'Armed: its time runs', landed: 'Landed', cancelled: 'Cancelled: nothing lands', void: 'Void: nothing lands',
};
const HEAD = (e: End): string => (e.cleanse === 'cancel' ? 'A cleanse saves you' : 'A cleanse sets it off');

function step(e: DelayedEvent, from: S): string {
  switch (e.type) {
    case 'apply': return from.d.at === 'absent' ? 'a use or the GM puts it on' : 'put on again: the later end';
    case 'due': return 'its bearer\'s turn starts at or after its end: its ops land';
    case 'cure': return from.end.cleanse === 'land' ? 'a cure: it lands at once' : 'a cure: nothing lands';
    case 'spent': return 'a price spends it to 0';
    case 'down': return 'its bearer goes down';
    case 'fightEnds': return 'the fight ends (never written to a sheet)';
  }
}

export const delayed = machine<S, DelayedEvent>({
  name: 'A delayed effect',
  walked: `Every state reachable from not on the bearer under the ${WALK_EVENTS.length} events of tests/models/delayed-events.ts, for each of the two cleanses, breadth first.`,
  walk: () => bfs(ENDS.map(end => ({ end, d: { at: 'absent' } as Delayed })), s => WALK_EVENTS.map(event => ({ event, to: { end: s.end, d: endStep(s.d, event, s.end).to } })), s => JSON.stringify(s)),
  kinds: DELAYED_STATES,
  kindsOf: s => [s.d.at],
  views: [{
    title: 'A status with an end, from put on to landed or gone',
    note: 'A delayed effect is a status whose `end` lands on its bearer when its time runs out (Hemoplague, a rend, a bomb). It lands at its bearer\'s first turn start at or after its end, from the status\'s source at its formulas\' averages, times its stacks. A cure does what the status says: by default nothing lands, so a cleanse saves you; a detonation lands at once. A price that spends it to 0, its bearer going down (a hunter at 0 keeps it, but has no settle while it is down) and the fight\'s end land nothing, and it is never written to a sheet.',
    hides: '',
    state: s => [HEAD(s.end), LABEL[s.d.at]],
    step,
  }],
  where: [
    ['The union', '`Delayed`, `DelayedEvent` and `DELAYED_STATES` in `src/core/combat/delayed.ts`; a def\'s `End` in `src/core/combat/effect-ops.ts`'],
    ['What changes it', '`endStep(delayed, event, end)` and its `TABLE`'],
    ['Who calls it', 'the settle in `src/core/combat/fight-turn.ts` (`settleRow`), a cure in `src/core/combat/resolve.ts` (rule 18) and `src/core/combat/land.ts` (`cureLands`, `landEnd`)'],
    ['The test to copy', '`tests/fight.test.ts` ("a delayed effect"); the walk\'s events are in `tests/models/delayed-events.ts`'],
    ['The recipe', 'docs/guide/combat.md, "A stacking status, its threshold and its end"'],
  ],
});
