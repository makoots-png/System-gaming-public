// The chart of a gesture on the battle map (src/core/combat/gesture.ts), walked with the events of
// tests/models/gesture-events.ts.
import { GESTURE_KINDS, IDLE, fingers, gesture } from '../../src/core/combat/gesture.ts';
import type { Gesture, GestureEvent } from '../../src/core/combat/gesture.ts';
import { WALK_EVENTS } from '../../tests/models/gesture-events.ts';
import { bfs, machine } from '../statecharts.ts';

function label(g: Gesture): string {
  switch (g.kind) {
    case 'idle': return 'No finger down';
    case 'maybe': return g.lifts ? 'A press on a token (the GM\'s map)' : 'A press (a tap if it lifts now)';
    case 'pan': return 'Panning';
    case 'drag': return g.far ? 'A token carried' : 'A token held up';
    case 'pinch': return 'Pinching';
    case 'paint': return 'Painting';
    case 'press': return g.timed ? 'A press on a hotbar slot (held: its detail)' : 'A press on a control';
    case 'held': return 'A hotbar slot held: its detail shows';
    case 'rest': return 'Fingers left, doing nothing';
    default: return g satisfies never;
  }
}
function words(e: GestureEvent, from: Gesture, to: Gesture): string {
  switch (e.kind) {
    case 'down': {
      if (fingers(from).length) return 'another finger touches';
      const p = e.press;
      if (p.on === 'control') return p.hold === null ? 'a finger touches a control' : 'a finger touches a hotbar slot';
      return p.mode === 'paint' ? 'a finger touches in paint mode' : p.mode === 'arrange' && p.target.tok ? 'the GM touches a token' : 'a finger touches the map';
    }
    case 'move': if (from.kind === 'press') return 'the finger slides past 8 px (no longer a hold)';
      return (from.kind === 'maybe' || from.kind === 'drag') && to.kind === 'pan' ? (from.kind === 'drag' ? 'it had moved past 8 px before the hold (heard late)' : 'the finger moves past 8 px')
      : from.kind === 'drag' ? 'the finger carries the token' : from.kind === 'held' ? 'it had slid before the hold (heard late)' : 'a finger moves';
    case 'up': case 'cancel': return 'a finger lifts or the browser takes it';
    case 'hold': return from.kind === 'press' ? 'held 350 ms (detail)' : 'held 450 ms';
    default: return e satisfies never;
  }
}

export const gestureChart = machine<Gesture, GestureEvent>({
  name: 'A gesture on the map',
  walked: `Every gesture reachable from no finger down under the ${WALK_EVENTS.length} pointer events of tests/models/gesture-events.ts, breadth first.`,
  walk: () => bfs([IDLE], g => WALK_EVENTS.map(event => ({ event, to: gesture(g, event).gesture })).filter(s => s.to !== g), g => JSON.stringify(g)),
  kinds: GESTURE_KINDS,
  kindsOf: g => [g.kind],
  views: [{
    title: 'A gesture on the map and its controls, from a finger touching to the last finger lifting',
    note: 'An arrow marked (tap), (press), (drop) or (paint) ends the gesture in that; a gesture ends in at most one, and a press only when the finger lifts on the control it came down on (tests/gesture.test.ts walks random pointer sequences to hold it). A control acts at the lift, never on the browser\'s click (Chrome sends none for a tap right after a touch pan); a hotbar slot held 350 ms shows its detail instead. A press on the map is a tap until its finger moves past 8 px; on the GM\'s map a press on a token is held up after 450 ms (the view starts the timer when the gesture says `timer`), and let go without moving it is still a tap. A finger that only moves within 8 px, or a move of the pan or the pinch, stays in its box and draws no arrow. The pan and zoom each move gives the view are effects, not states.',
    hides: 'a second finger on any one-finger gesture but a press on the map (each starts a pinch, or on a control the fingers rest, as the arrows from the press on the map and from Pinching show)',
    state: label,
    step: (e, from, to) => {
      const sent = gesture(from, e).fx.filter(f => f.kind === 'tap' || f.kind === 'drop' || f.kind === 'paint' || f.kind === 'press').map(f => f.kind);
      if (e.kind === 'down' && fingers(from).length && from.kind !== 'maybe' && from.kind !== 'pinch') return null;
      if (e.kind === 'down' && from.kind === 'maybe' && from.lifts) return null;
      const late = from.kind === 'held' && e.kind === 'up' && e.t - from.t0 < from.hold ? ' before the hold (heard late)' : '';
      return sent.length ? `the finger lifts${late} (${sent.join(', ')})` : words(e, from, to);
    },
  }],
  where: [
    ['The states, events and effects', '`Gesture`, `GestureEvent`, `GestureFx` and `TABLE` in `src/core/combat/gesture.ts`'],
    ['What changes it', '`gesture(g, event)`; `zoomAbout` for the wheel'],
    ['Who calls it', '`feed` in `src/views/map.js`, from the frame\'s pointer events; a `tap` goes on to the map\'s choice (`choose`)'],
    ['The test to copy', '`tests/gesture.test.ts` (its last case walks random pointer sequences); the chart\'s events are in `tests/models/gesture-events.ts`'],
    ['The recipe', 'docs/guide/combat.md, "A machine of the map"'],
  ],
});
