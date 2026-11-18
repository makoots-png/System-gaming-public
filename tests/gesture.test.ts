// A finger on the battle map (src/core/combat/gesture.ts): a tap, a pan, a pinch, the GM's drag and paint, from pointer
// events given as data. Expected values come from the rules in the module's comments: a press is a tap until its finger
// moves past SLOP (8 px); the GM's press on a token is lifted after HOLD_MS; a pinch keeps the spot of the world under the
// fingers' first middle under their middle. The random walk at the end drives every kind of pointer sequence.
import { describe, expect, test } from 'bun:test';
import { IDLE, MAX_ZOOM, SLOP, fingers, gesture, zoomAbout } from '../src/core/combat/gesture.ts';
import type { Gesture, GestureEvent, GestureFx, GestureMode, Press, Pt, Target, View } from '../src/core/combat/gesture.ts';
import { combatantId } from '../src/core/combat/ability-types.ts';
import { place } from '../src/core/combat/space.ts';
import type { Place } from '../src/core/combat/space.ts';
import { rng } from './models/fight-play.ts';

const V: View = { x: 10, y: 20, s: 1 };
const RAT = combatantId('rat');
const onRat: Target = { tok: RAT, tile: place(3, 2) }, ground: Target = { tok: null, tile: place(1, 1) };
/** A finger's events at their times: a press at 0, and by default its moves and lift a second later, well past any hold. */
const down = (id: number, at: Pt, target: Target = ground, mode: GestureMode = 'look', view: View = V, t = 0): GestureEvent => ({ kind: 'down', id, t, at, view, press: { on: 'map', target, mode } });
/** A finger down on a control 40 px square centred where it touched. */
const onControl = (id: number, at: Pt, control: string, hold: number | null = null, t = 0): GestureEvent => ({ kind: 'down', id, t, at, view: V, press: { on: 'control', control, area: { x0: at.x - 20, y0: at.y - 20, x1: at.x + 20, y1: at.y + 20 }, hold, off: false } });
const move = (id: number, at: Pt, tile: Place | null = null, t = 1000): GestureEvent => ({ kind: 'move', id, t, at, tile });
const up = (id: number, at: Pt, tile: Place | null = null, t = 1000): GestureEvent => ({ kind: 'up', id, t, at, tile });
const cancel = (id: number, t = 1000): GestureEvent => ({ kind: 'cancel', id, t });
/** Runs `events` from no finger down: the gesture at the end and every effect, in order. */
function run(events: readonly GestureEvent[], from: Gesture = IDLE): { g: Gesture; fx: GestureFx[] } {
  let g = from;
  const fx: GestureFx[] = [];
  for (const e of events) { const r = gesture(g, e); g = r.gesture; fx.push(...r.fx); }
  return { g, fx };
}
const commands = (fx: readonly GestureFx[]) => fx.filter(f => f.kind === 'tap' || f.kind === 'drop' || f.kind === 'paint' || f.kind === 'press' || f.kind === 'detail');
const views = (fx: readonly GestureFx[]) => fx.flatMap(f => (f.kind === 'view' ? [f.view] : []));

describe('a tap and a pan', () => {
  test('a finger that touches and lifts is a tap on what it touched, however it is framed by then', () => {
    const r = run([down(1, { x: 50, y: 50 }, onRat), up(1, { x: 51, y: 50 }, place(9, 9))]);
    expect(commands(r.fx)).toEqual([{ kind: 'tap', target: onRat }]);
    expect(r.g).toEqual(IDLE);
  });
  test('a finger that moves no more than 8 px is still a tap, and the map does not move', () => {
    const r = run([down(1, { x: 50, y: 50 }), move(1, { x: 50 + SLOP, y: 50 }), up(1, { x: 50 + SLOP, y: 50 })]);
    expect(commands(r.fx)).toEqual([{ kind: 'tap', target: ground }]);
    expect(views(r.fx)).toEqual([]);
  });
  test('past 8 px the press is a pan: the map follows the finger from where it touched, and its lift taps nothing', () => {
    const r = run([down(1, { x: 50, y: 50 }), move(1, { x: 60, y: 50 }), move(1, { x: 80, y: 30 }), up(1, { x: 80, y: 30 })]);
    expect(views(r.fx)).toEqual([{ x: 20, y: 20, s: 1 }, { x: 40, y: 0, s: 1 }]);
    expect(commands(r.fx)).toEqual([]);
    expect(r.g).toEqual(IDLE);
  });
  test('a press the browser takes away (a cancel) taps nothing', () => {
    expect(commands(run([down(1, { x: 50, y: 50 }), cancel(1)]).fx)).toEqual([]);
  });
  test('a mouse moving over the map with no button down, or a lift the map never saw go down, does nothing', () => {
    expect(run([move(7, { x: 1, y: 1 }), up(7, { x: 1, y: 1 }), cancel(7)])).toEqual({ g: IDLE, fx: [] });
  });
  test('a player\'s press on a token is never lifted: no hold timer starts', () => {
    expect(run([down(1, { x: 50, y: 50 }, onRat, 'look')]).fx.some(f => f.kind === 'timer')).toBe(false);
  });
});

describe('the GM\'s drag', () => {
  const pressed = [down(1, { x: 50, y: 50 }, onRat, 'arrange')];
  test('a GM\'s press on a token starts the hold timer, and the hold lifts the token', () => {
    const r = run([...pressed, { kind: 'hold' }]);
    expect(r.fx).toEqual([{ kind: 'capture', id: 1 }, { kind: 'timer', ms: 450 }, { kind: 'lift', tok: RAT }]);
    expect(r.g.kind).toBe('drag');
  });
  test('carried to another tile, the token is put back to be drawn where the fight puts it, and is dropped there once', () => {
    const r = run([...pressed, { kind: 'hold' }, move(1, { x: 90, y: 50 }, place(5, 2)), up(1, { x: 130, y: 50 }, place(6, 2))]);
    expect(r.fx.filter(f => f.kind === 'carry').map(f => f.kind === 'carry' && f.at)).toEqual([{ x: 90, y: 50 }]);
    expect(commands(r.fx)).toEqual([{ kind: 'drop', tok: RAT, to: place(6, 2) }]);
    expect(r.fx.filter(f => f.kind === 'putBack')).toHaveLength(1);
  });
  test('held and let go without moving, a slow tap is a tap on the token, not a lost press', () => {
    const r = run([...pressed, { kind: 'hold' }, up(1, { x: 50, y: 50 }, place(3, 2))]);
    expect(commands(r.fx)).toEqual([{ kind: 'tap', target: onRat }]);
  });
  test('carried away and brought back to its own tile, the token is only put back', () => {
    const r = run([...pressed, { kind: 'hold' }, move(1, { x: 120, y: 50 }), move(1, { x: 52, y: 50 }), up(1, { x: 52, y: 50 }, place(3, 2))]);
    expect(commands(r.fx)).toEqual([]);
    expect(r.fx.at(-1)).toEqual({ kind: 'putBack', tok: RAT });
  });
  test('a pan started before the hold clears the timer, so the token is never lifted', () => {
    const r = run([...pressed, move(1, { x: 70, y: 50 })]);
    expect(r.fx).toContainEqual({ kind: 'untimer' });
    expect(run([{ kind: 'hold' }], r.g).fx).toEqual([]);
  });
  test('a second finger on a lifted token puts it back and zooms; nothing is dropped when the fingers lift', () => {
    const r = run([...pressed, { kind: 'hold' }, down(2, { x: 150, y: 50 }), up(1, { x: 50, y: 50 }, place(1, 1)), up(2, { x: 150, y: 50 }, place(1, 1))]);
    expect(r.fx).toContainEqual({ kind: 'putBack', tok: RAT });
    expect(commands(r.fx)).toEqual([]);
    expect(r.g).toEqual(IDLE);
  });
});

describe('a pinch and the wheel', () => {
  test('two fingers spread to twice their distance zoom in twice, and the spot under their first middle stays under their middle', () => {
    const start: View = { x: 0, y: 0, s: 0.5 };
    const r = run([down(1, { x: 100, y: 100 }, ground, 'look', start), down(2, { x: 200, y: 100 }, ground, 'look', start), move(2, { x: 300, y: 100 })]);
    const v = views(r.fx).at(-1)!;
    expect(v.s).toBe(1);
    // the world spot under (150, 100) at zoom 0.5 is (300, 200); at zoom 1 it must be under the middle (200, 100)
    expect({ x: v.x + 300 * v.s, y: v.y + 200 * v.s }).toEqual({ x: 200, y: 100 });
  });
  test('a finger lifted from a pinch ends it: the other finger then does nothing until it lifts, and nothing is tapped', () => {
    const r = run([down(1, { x: 100, y: 100 }), down(2, { x: 200, y: 100 }), up(1, { x: 100, y: 100 }), move(2, { x: 400, y: 400 }), up(2, { x: 400, y: 400 })]);
    expect(views(r.fx)).toEqual([]);
    expect(commands(r.fx)).toEqual([]);
    expect(r.g).toEqual(IDLE);
  });
  test('the zoom stays between a fifth of a tile\'s pixels and a fifth past the closest frame', () => {
    expect(zoomAbout(V, { x: 0, y: 0 }, 100).s).toBeCloseTo(MAX_ZOOM * 1.2);
    expect(zoomAbout(V, { x: 0, y: 0 }, 0.001).s).toBe(0.2);
    const z = zoomAbout({ x: 40, y: 60, s: 1 }, { x: 140, y: 160 }, 1.5);
    expect({ x: (140 - z.x) / z.s, y: (160 - z.y) / z.s }).toEqual({ x: 100, y: 100 });
  });
});

describe('a control of the map (a hotbar slot, Move, Use, Grid)', () => {
  test('a finger that comes down on Use and lifts on it presses Use once, with no click from the browser', () => {
    expect(commands(run([onControl(1, { x: 10, y: 10 }, 'go'), up(1, { x: 12, y: 10 }, null)]).fx)).toEqual([{ kind: 'press', control: 'go' }]);
  });
  test('a finger that slides off the control before it lifts presses nothing, and one the browser takes (a hotbar scroll) neither', () => {
    expect(commands(run([onControl(1, { x: 10, y: 10 }, 'go'), move(1, { x: 80, y: 10 }), up(1, { x: 80, y: 10 }, null)]).fx)).toEqual([]);
    expect(commands(run([onControl(1, { x: 10, y: 10 }, 'ab:strike', 350), cancel(1)]).fx)).toEqual([]);
  });
  test('a hotbar slot held to its hold time shows its detail and its lift picks nothing; a quick lift picks it', () => {
    const held = run([onControl(1, { x: 10, y: 10 }, 'ab:strike', 350), { kind: 'hold' }, up(1, { x: 10, y: 10 }, null)]);
    expect(held.fx).toEqual([{ kind: 'capture', id: 1 }, { kind: 'timer', ms: 350 }, { kind: 'detail', control: 'ab:strike' }]);
    const quick = run([onControl(1, { x: 10, y: 10 }, 'ab:strike', 350), up(1, { x: 10, y: 10 }, null)]);
    expect(quick.fx).toEqual([{ kind: 'capture', id: 1 }, { kind: 'timer', ms: 350 }, { kind: 'untimer' }, { kind: 'press', control: 'ab:strike' }]);
  });
  test('a finger that slides past 8 px on a hotbar slot is no longer a hold, and still picks it when it lifts on it', () => {
    const r = run([onControl(1, { x: 10, y: 10 }, 'ab:strike', 350), move(1, { x: 25, y: 10 }), { kind: 'hold' }, up(1, { x: 25, y: 10 }, null)]);
    expect(commands(r.fx)).toEqual([{ kind: 'press', control: 'ab:strike' }]);
  });
  test('right after a pan, a finger on Use presses it: the pan is over when its finger lifts', () => {
    const r = run([down(1, { x: 50, y: 50 }), move(1, { x: 120, y: 50 }), up(1, { x: 120, y: 50 }), onControl(2, { x: 10, y: 300 }, 'go'), up(2, { x: 10, y: 300 }, null)]);
    expect(commands(r.fx)).toEqual([{ kind: 'press', control: 'go' }]);
  });
  test('a hotbar slot that is not ready shows its detail when held and picks nothing when tapped', () => {
    const off: GestureEvent = { kind: 'down', id: 1, t: 0, at: { x: 10, y: 10 }, view: V, press: { on: 'control', control: 'ab:strike', area: { x0: 0, y0: 0, x1: 40, y1: 40 }, hold: 350, off: true } };
    expect(commands(run([off, up(1, { x: 10, y: 10 })]).fx)).toEqual([]);
    expect(commands(run([off, { kind: 'hold' }, up(1, { x: 10, y: 10 })]).fx)).toEqual([{ kind: 'detail', control: 'ab:strike' }]);
  });
  test('a second finger while a control is pressed presses nothing, and the map does not zoom', () => {
    const r = run([onControl(1, { x: 10, y: 10 }, 'go'), down(2, { x: 200, y: 200 }), move(2, { x: 300, y: 300 }), up(1, { x: 10, y: 10 }, null), up(2, { x: 300, y: 300 })]);
    expect([commands(r.fx), views(r.fx), r.g]).toEqual([[], [], IDLE]);
  });
});

describe('a page too busy to hear a finger in time', () => {
  // The timer's end is raised when the page gets to it; a lift or a move that happened before it, by its own time, may
  // still be waiting behind it. What the finger did is read from the events' times.
  test('a lift timed inside a hotbar slot\'s hold window but heard after the hold took its detail back and picks the slot', () => {
    const r = run([onControl(1, { x: 10, y: 10 }, 'ab:strike', 350, 0), { kind: 'hold' }, up(1, { x: 10, y: 10 }, null, 100)]);
    expect(commands(r.fx)).toEqual([{ kind: 'detail', control: 'ab:strike' }, { kind: 'press', control: 'ab:strike' }]);
    expect(r.fx).toContainEqual({ kind: 'undetail', control: 'ab:strike' });
  });
  test('a lift after the hold window, by its time, is a hold: the detail stays and nothing is picked', () => {
    const r = run([onControl(1, { x: 10, y: 10 }, 'ab:strike', 350, 0), { kind: 'hold' }, up(1, { x: 10, y: 10 }, null, 400)]);
    expect(commands(r.fx)).toEqual([{ kind: 'detail', control: 'ab:strike' }]);
  });
  test('on the GM\'s map, a move past 8 px timed before the hold but heard after it is a pan: the token goes back and is never dropped', () => {
    const r = run([down(1, { x: 50, y: 50 }, onRat, 'arrange', V, 0), { kind: 'hold' }, move(1, { x: 90, y: 50 }, place(5, 2), 120), up(1, { x: 120, y: 50 }, place(6, 2), 200)]);
    expect(commands(r.fx)).toEqual([]);
    expect(r.fx).toContainEqual({ kind: 'putBack', tok: RAT });
    expect(views(r.fx)).toEqual([{ x: V.x + 40, y: V.y, s: 1 }]);
  });
  test('on the GM\'s map, a lift timed inside the hold window but heard after it is a tap on the token', () => {
    const r = run([down(1, { x: 50, y: 50 }, onRat, 'arrange', V, 0), { kind: 'hold' }, up(1, { x: 50, y: 50 }, place(3, 2), 100)]);
    expect(commands(r.fx)).toEqual([{ kind: 'tap', target: onRat }]);
  });
});

describe('the GM\'s paint', () => {
  test('a stroke paints each tile it crosses once, in order, when the finger lifts', () => {
    const r = run([down(1, { x: 0, y: 0 }, { tok: null, tile: place(0, 0) }, 'paint'), move(1, { x: 40, y: 0 }, place(1, 0)), move(1, { x: 45, y: 0 }, place(1, 0)), move(1, { x: 80, y: 0 }, place(2, 0)), up(1, { x: 80, y: 0 }, place(2, 0))]);
    expect(commands(r.fx)).toEqual([{ kind: 'paint', tiles: [place(0, 0), place(1, 0), place(2, 0)] }]);
  });
  test('a cancelled stroke paints nothing, and one a second finger turns into a pinch paints nothing', () => {
    expect(commands(run([down(1, { x: 0, y: 0 }, ground, 'paint'), cancel(1)]).fx)).toEqual([]);
    expect(commands(run([down(1, { x: 0, y: 0 }, ground, 'paint'), down(2, { x: 90, y: 0 }), up(1, { x: 0, y: 0 }), up(2, { x: 90, y: 0 })]).fx)).toEqual([]);
  });
});

describe('any sequence of pointer events', () => {
  /**
   * Random presses, moves, lifts, cancels and hold timers on up to three fingers, in every mode. A gesture runs from a
   * first finger down to the last finger up. Checked after every event: the gesture holds exactly the fingers that are
   * down; a gesture sends at most one command, the tap on what its first finger touched, a drop only in the GM's arrange
   * mode of a token it lifted onto another tile, a paint only in paint mode; a lifted token is put back once; the hold
   * timer never runs with no finger down; the map pans or zooms only while a pan or a pinch runs.
   */
  test('no sequence leaves a gesture open, ends in two things, or ends in one its press did not offer', () => {
    const MODES: readonly GestureMode[] = ['look', 'arrange', 'paint'];
    const CONTROLS = ['go', 'ab:strike'];
    for (let seed = 1; seed <= 400; seed++) {
      const r = rng(seed);
      let g: Gesture = IDLE, first: Press | null = null;
      const held = new Set<number>();
      let sent = 0, timer = false, clock = 0, shown: string | null = null;
      const lifted = new Set<string>();
      const pt = (): Pt => ({ x: r.int(0, 400), y: r.int(0, 400) });
      const tile = (): Place | null => (r.chance(0.1) ? null : place(r.int(0, 5), r.int(0, 5)));
      /** Half the time, a point inside the control the gesture began on. */
      const onBox = (p: Press | null): Pt | null => (p && p.on === 'control' && r.chance(0.5) ? { x: p.area.x0 + 5, y: p.area.y0 + 5 } : null);
      for (let step = 0; step < 60; step++) {
        const id = r.int(1, 3), roll = r.next();
        clock += r.int(0, 300);
        const e: GestureEvent = roll < 0.25 ? (r.chance(0.3) ? onControl(id, pt(), r.pick(CONTROLS), r.chance(0.5) ? 350 : null, clock)
            : down(id, pt(), r.chance(0.5) ? { tok: r.pick([RAT, combatantId('kai')]), tile: tile() } : { tok: null, tile: tile() }, r.pick(MODES), { x: r.int(-50, 50), y: r.int(-50, 50), s: 1 }, clock))
          : roll < 0.6 ? move(id, r.chance(0.5) ? pt() : { x: 50 + r.int(-9, 9), y: 50 }, tile(), clock)
          : roll < 0.8 ? up(id, onBox(first as Press | null) ?? pt(), tile(), clock)
          : roll < 0.9 ? cancel(id, clock) : { kind: 'hold' };
        const was = g, out = gesture(g, e);
        g = out.gesture;
        if (e.kind === 'down') { if (!held.size) { first = e.press; sent = 0; shown = null; } held.add(e.id); }
        if (e.kind === 'up' || e.kind === 'cancel') held.delete(e.id);
        const where = `seed ${seed} step ${step} ${JSON.stringify(e)} from ${was.kind}`;
        expect(new Set(fingers(g)), `${where}: the gesture holds the fingers that are down`).toEqual(held);
        for (const f of out.fx) {
          if (f.kind === 'timer') { expect(timer, `${where}: one hold timer at a time`).toBe(false); timer = true; }
          if (f.kind === 'untimer') timer = false;
          const onMap = first?.on === 'map' ? first : null, onCtl = first?.on === 'control' ? first : null;
          if (f.kind === 'lift') { expect(onMap?.mode, `${where}: only the GM lifts`).toBe('arrange'); expect(f.tok).toBe(onMap!.target.tok!); lifted.add(f.tok); }
          if (f.kind === 'putBack') { expect(lifted.has(f.tok), `${where}: only a lifted token is put back`).toBe(true); lifted.delete(f.tok); }
          if (f.kind === 'view') expect(['pan', 'pinch'], `${where}: only a pan or a pinch moves the map`).toContain(g.kind);
          if (f.kind === 'tap') expect(f.target, `${where}: a tap is on what the first finger touched`).toEqual(onMap?.target);
          if (f.kind === 'drop') {
            expect(onMap?.mode, `${where}: only the GM drops`).toBe('arrange');
            expect(f.tok).toBe(onMap!.target.tok!);
            expect(f.to, `${where}: a drop lands on another tile`).not.toEqual(onMap!.target.tile);
          }
          if (f.kind === 'paint') expect(onMap?.mode, `${where}: only paint mode paints`).toBe('paint');
          if (f.kind === 'press') {
            expect<string | null>(f.control, `${where}: a press is of the control the first finger touched`).toBe(onCtl?.control ?? null);
            const a = onCtl!.area;
            expect(e.kind === 'up' && e.at.x >= a.x0 && e.at.x <= a.x1 && e.at.y >= a.y0 && e.at.y <= a.y1, `${where}: and lifted inside its box`).toBe(true);
          }
          if (f.kind === 'detail') { expect([f.control, onCtl?.hold !== null], `${where}: a detail only of a held control`).toEqual([onCtl?.control ?? null, true]); shown = f.control; }
          if (f.kind === 'undetail') { expect<string | null>(f.control, `${where}: only a detail shown is taken back`).toBe(shown); shown = null; sent--; }
          if (f.kind === 'tap' || f.kind === 'drop' || f.kind === 'paint' || f.kind === 'press' || f.kind === 'detail') { sent++; expect(sent, `${where}: one end a gesture (a detail taken back is none)`).toBe(1); }
        }
        if (e.kind === 'hold' && ((was.kind === 'maybe' && g.kind === 'drag') || (was.kind === 'press' && g.kind === 'held'))) timer = false;
        if (!held.size) {
          expect(g, `${where}: no finger down, no gesture`).toEqual(IDLE);
          expect(lifted.size, `${where}: no token left lifted`).toBe(0);
          expect(timer, `${where}: no hold timer left running`).toBe(false);
        }
      }
    }
  });
});
