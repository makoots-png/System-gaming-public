// The chart of a gate's life (src/core/gates/gate.ts), walked with the events of the walk in tests/gate.test.ts.
import { GATE_STATUSES, transition } from '../../src/core/gates/gate.ts';
import type { Gate, GateEvent, GateStatus } from '../../src/core/gates/gate.ts';
import { WALK_EVENTS, den } from '../../tests/models/gate-events.ts';
import { bfs, machine } from '../statecharts.ts';

/** The words of the gate card (STATUS_LABEL in src/views/gates.js). */
const LABEL: { readonly [S in GateStatus]: string } = {
  detected: 'Detected', raiding: 'Raiding', broken: 'Dungeon break', cleared: 'Cleared', closed: 'Closed',
};
/** Cleared and closed gates are listed under Finished gates. */
const finished = (g: Gate): boolean => g.status === 'cleared' || g.status === 'closed';

function step(e: GateEvent, from: Gate, to: Gate): string | null {
  switch (e.type) {
    case 'enter': case 'fightStarted': return 'the party enters, or a fight starts in it';
    case 'dayAdvanced': return 'its break day comes';
    case 'clear': return 'the GM taps Clear';
    case 'close': return 'the GM taps Close';
    case 'gmSet': return finished(from) && to.status === 'detected' ? 'the GM sets it back in Edit' : null;
    case 'paid': return 'a fight or the Clear pays its XP';
  }
}

/** The gate's XP paid is left out of the key: no step reads it, so two gates that differ only there move the same. */
const key = (g: Gate): string => JSON.stringify({ ...g, xpPaid: 0 });

export const gate = machine<Gate, GateEvent>({
  name: 'A gate',
  walked: 'Every gate reachable from a new detected gate (the Goblin Den of tests/models/gate-events.ts, which breaks on day 5) under the 13 events of the walk in tests/gate.test.ts, breadth first.',
  walk: () => bfs([den('detected')], g => WALK_EVENTS.map(event => ({ event, to: transition(g, event) })), key),
  kinds: GATE_STATUSES,
  kindsOf: g => [g.status],
  views: [{
    title: 'A gate, from detected to finished',
    note: 'The chart shows the status on the gate card. It leaves out the XP a gate has paid, which only goes up and never moves the status, and the day a gate was cleared. A day that passes before the break day changes nothing. Entering or fighting in a gate that is already raiding or broken keeps its status.',
    hides: 'the GM can set any status from any status in the Edit form. The chart draws only the edit that puts a finished gate back to detected, so each finished gate still shows its way out',
    state: g => LABEL[g.status],
    step,
  }],
  where: [
    ['The union', '`Gate` and `GATE_STATUSES` in `src/core/gates/gate.ts`'],
    ['What changes it', '`transition(gate, event)` and its `TABLE`; `can(gate, eventType)` for a button'],
    ['Who calls it', '`step()` in `src/views/gates.js`, and `endEncounter` in `src/views/combat.js`'],
    ['The test to copy', '`tests/gate.test.ts`; the walk\'s events are in `tests/models/gate-events.ts`'],
    ['The recipe', 'docs/guide/gates-solo.md, "To add a gate status or event"'],
  ],
});
