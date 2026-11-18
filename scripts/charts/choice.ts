// The chart of what the map has chosen (`choose` in src/core/combat/map-view.ts), walked with the events of
// tests/models/choice-events.ts on one small fight.
import { CHOSEN_KINDS, choose } from '../../src/core/combat/map-view.ts';
import type { Choice } from '../../src/core/combat/map-view.ts';
import { START, WALK_EVENTS } from '../../tests/models/choice-events.ts';
import { bfs, machine } from '../statecharts.ts';

type Walked = (typeof WALK_EVENTS)[number];
function label(c: Choice): string {
  if (c.actor === null) return 'Watching (another body\'s turn)';
  switch (c.now.kind) {
    case 'none': return 'Nothing chosen: the movement area shows';
    case 'move': return 'A tile chosen: Move shows';
    case 'aim': return c.now.at || c.now.ability.aim === 'self' ? 'An ability aimed: Use shows' : 'An ability picked: its reach shows';
    default: return c.now satisfies never;
  }
}
const key = (c: Choice): string => JSON.stringify({ ...c, now: c.now.kind === 'aim' ? { ...c.now, ability: c.now.ability.id } : c.now, taps: c.taps.map(t => (t.kind === 'aim' ? { ...t, ability: t.ability.id } : t)) });

export const choiceChart = machine<Choice, Walked>({
  name: 'What the map has chosen',
  walked: `Every choice reachable from a turn just begun under the ${WALK_EVENTS.length} events of tests/models/choice-events.ts (a hunter with a foe beside it and one far off, a Strike and a self Ward), breadth first.`,
  walk: () => bfs([START], c => WALK_EVENTS.map(event => ({ event, to: choose(c, event.of(c)).choice })), key),
  kinds: CHOSEN_KINDS,
  kindsOf: c => [c.now.kind],
  views: [{
    title: 'What the map has chosen, from a turn begun to a command sent',
    note: 'An arrow marked (move), (use) or (pass) sends that command, and the same step puts the choice down, so a second press before the map redraws sends nothing (tests/map-view.test.ts walks random taps and stale scenes to hold it). The More drawer, a card or a zone opened by a tap, and the way of a sent move drawn until its answer are effects or fields that change no box. A tile chosen that the scene stops offering is put down at the next draw (`drawn`), which this fight with bodies that do not move never shows.',
    hides: 'a double tap, which puts back what its two taps chose and so can lead from any box to any other',
    state: label,
    step: (e, from, to) => {
      const ev = e.of(from), sent = choose(from, ev).fx.filter(f => f.kind === 'move' || f.kind === 'use' || f.kind === 'pass').map(f => f.kind);
      if (sent.length) return `${ev.kind === 'pass' ? 'End turn' : ev.kind === 'go' && sent[0] === 'move' ? 'Move' : 'Use'} (${sent.join(', ')})`;
      if (ev.kind === 'double') return null;
      if (ev.kind === 'seen') return e.name;
      if (to.now.kind === 'none') return 'Cancel, a tap off it, or the same ability again';
      if (ev.kind === 'pick') return 'pick an ability';
      return to.now.kind === 'move' ? 'tap a tile in reach' : 'tap a target';
    },
  }],
  where: [
    ['The states, events and effects', '`Choice`, `Chosen`, `ChoiceEvent`, `ChoiceFx` and `CHOICE_TABLE` in `src/core/combat/map-view.ts`'],
    ['What changes it', '`choose(choice, event)`'],
    ['Who calls it', '`act` in `src/views/map.js`: a tap from the gesture, the hotbar\'s buttons, Move, Use, Cancel, and `seen` and `drawn` in each draw'],
    ['The test to copy', '`tests/map-view.test.ts`, "what the map has chosen"; the chart\'s events are in `tests/models/choice-events.ts`'],
    ['The recipe', 'AGENTS.md, "A machine of the map"'],
  ],
});
