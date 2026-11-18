// The pointer events of a gesture on the battle map, a few of each kind on fixed points, so the walk is finite. Shared by
// tests/gesture.test.ts's chart walk and the state chart (scripts/charts/gesture.ts), so both walk the same events.
import { combatantId } from '../../src/core/combat/ability-types.ts';
import { place } from '../../src/core/combat/space.ts';
import type { GestureEvent, Target, View } from '../../src/core/combat/gesture.ts';

const V: View = { x: 0, y: 0, s: 1 };
const RAT: Target = { tok: combatantId('rat'), tile: place(1, 1) }, GROUND: Target = { tok: null, tile: place(0, 0) };
/**
 * A first finger on open ground, on a token of the GM's map, on the ground in paint mode, on Use (no hold) and on a
 * hotbar slot (held for its detail after 350 ms); a second and a third finger; the first finger moved a little (within
 * 8 px) and far; the second moved; each finger lifted (the first on its own tile and control, and elsewhere), each
 * cancelled; the hold timer's end. Moves and lifts are timed at 600 ms, past both holds, and one lift and one move at
 * 100 ms: inside the hold window, as a busy page hears them after the timer.
 */
export const WALK_EVENTS: readonly GestureEvent[] = [
  { kind: 'down', t: 0, id: 1, at: { x: 60, y: 60 }, view: V, press: { on: 'map', target: GROUND, mode: 'look' } },
  { kind: 'down', t: 0, id: 1, at: { x: 60, y: 60 }, view: V, press: { on: 'map', target: RAT, mode: 'arrange' } },
  { kind: 'down', t: 0, id: 1, at: { x: 60, y: 60 }, view: V, press: { on: 'map', target: GROUND, mode: 'paint' } },
  { kind: 'down', t: 0, id: 1, at: { x: 60, y: 60 }, view: V, press: { on: 'control', control: 'go', area: { x0: 40, y0: 40, x1: 80, y1: 80 }, hold: null, off: false } },
  { kind: 'down', t: 0, id: 1, at: { x: 60, y: 60 }, view: V, press: { on: 'control', control: 'ab:strike', area: { x0: 40, y0: 40, x1: 80, y1: 80 }, hold: 350, off: false } },
  { kind: 'down', t: 0, id: 2, at: { x: 160, y: 60 }, view: V, press: { on: 'map', target: GROUND, mode: 'look' } },
  { kind: 'down', t: 0, id: 3, at: { x: 160, y: 160 }, view: V, press: { on: 'map', target: GROUND, mode: 'look' } },
  { kind: 'move', t: 600, id: 1, at: { x: 64, y: 60 }, tile: place(1, 1) },
  { kind: 'move', t: 600, id: 1, at: { x: 120, y: 60 }, tile: place(2, 1) },
  { kind: 'move', t: 600, id: 2, at: { x: 200, y: 60 }, tile: place(4, 1) },
  { kind: 'up', t: 600, id: 1, at: { x: 64, y: 60 }, tile: place(1, 1) },
  { kind: 'up', t: 100, id: 1, at: { x: 64, y: 60 }, tile: null },
  { kind: 'move', t: 100, id: 1, at: { x: 120, y: 60 }, tile: place(2, 1) },
  { kind: 'up', t: 600, id: 1, at: { x: 120, y: 60 }, tile: place(2, 1) },
  { kind: 'up', t: 600, id: 2, at: { x: 200, y: 60 }, tile: place(4, 1) },
  { kind: 'up', t: 600, id: 3, at: { x: 160, y: 160 }, tile: place(3, 3) },
  { kind: 'cancel', t: 600, id: 1 }, { kind: 'cancel', t: 600, id: 2 }, { kind: 'cancel', t: 600, id: 3 },
  { kind: 'hold' },
];
