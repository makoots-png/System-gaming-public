// gesture.ts: what a finger does on the battle map and its controls, one table (docs/state-machines.md, "A gesture on
// the map"). The view (src/views/map.js) feeds each pointer event in as data, with the place under the finger already
// turned into a tile, or the control it is on named, and the map's pan and zoom as they were; `gesture` answers the next
// state and what the view carries out (a tap, a control pressed, a control held for its detail, a GM's drop, a GM's
// paint, the pan and zoom, a token lifted and put back, the hold timer). Every tap, press and hold is decided here, at
// the finger's lift or the hold timer's end, never by the browser's click: Chrome sends no click for a tap that comes
// right after a touch pan, and a redraw, a framing move or a late click between the press and the lift cannot change
// what the finger was on. Pure: no DOM, no clock (the view passes the hold timer's end in as an event).
import type { CombatantId } from './ability-types.ts';
import type { Place } from './space.ts';

/** Pixels a finger moves before a press becomes a pan (or a lifted token counts as carried). */
export const SLOP = 8;
/** Milliseconds a finger holds a token before the GM picks it up: longer than a tap, so a pan is never taken for a drag. */
export const HOLD_MS = 450;
/** The closest zoom the map frames at (map.js `fit`): a tile a little over 70 pixels. */
export const MAX_ZOOM = 1.8;
/** A pinch or the wheel goes a fifth past the closest frame, and out to a fifth of a tile's pixels. */
const ZOOM_MOST = MAX_ZOOM * 1.2, ZOOM_LEAST = 0.2;

/** A time in milliseconds on the page's clock (`PointerEvent.timeStamp`). */
export type Ms = number;
/** A pointer, as the browser numbers it (`PointerEvent.pointerId`). */
export type PointerId = number;
/** A point in the map's frame, in pixels from its top left corner. */
export type Pt = { readonly x: number; readonly y: number };
/** The pan and zoom: the world's offset in the frame in pixels, and its scale. */
export type View = { readonly x: number; readonly y: number; readonly s: number };
/** What a finger touched on the map: a token (and the tile it stood on), or a tile of open ground; null off the grid. */
export type Target = { readonly tok: CombatantId | null; readonly tile: Place | null };
/** A control of the map (a hotbar slot, Move, Use, Grid...), by the name the view gives it. */
export type ControlKey = string;
/**
 * Where a finger came down: on the map (what it touched, and what a press may do there), or on a control (its name, its
 * box, how long a press is held for its detail, null when it has none, and `off` for a control that is off: a hotbar
 * slot not ready, held for its detail but never pressed). A press is on the same control when the
 * finger lifts inside that box: read at the press, so a detail opened or a redraw before the page hears the lift does
 * not move it.
 */
export type Press =
  | { readonly on: 'map'; readonly target: Target; readonly mode: GestureMode }
  | { readonly on: 'control'; readonly control: ControlKey; readonly area: Area; readonly hold: number | null; readonly off: boolean };
/** A control's box in the frame's pixels (`Pt`), both ends included, as it was when the finger came down on it. */
export type Area = { readonly x0: number; readonly y0: number; readonly x1: number; readonly y1: number };
/**
 * What a press may do here: `look` (a tap and a pan), `arrange` (the GM's map: a token held is lifted and dropped on
 * another tile), `paint` (the GM's paint mode: a stroke paints the tiles it crosses).
 */
export type GestureMode = 'look' | 'arrange' | 'paint';

export const GESTURE_KINDS = ['idle', 'maybe', 'pan', 'drag', 'pinch', 'paint', 'press', 'held', 'rest'] as const;
export type GestureKind = (typeof GESTURE_KINDS)[number];
type Finger = { readonly id: PointerId; readonly at: Pt };
/**
 * `from` is where a finger touched and `at` where it is now. `idle`: no finger down. `maybe`: one finger down, not yet
 * moved past `SLOP`: a tap if it lifts now. `pan`: one finger
 * moving the map. `drag`: the GM holds a token (`far` once it has moved past `SLOP`). `pinch`: two fingers zooming.
 * `paint`: one finger painting tiles. `press`: one finger on a control (`timed` while its hold timer runs). `held`: a
 * control held past its hold, its detail shown; its lift does nothing. `rest`: fingers still down after a pinch ended,
 * a second finger came on a control, or a third finger came; nothing happens until every finger is up.
 */
export type Gesture =
  | { readonly kind: 'idle' }
  | { readonly kind: 'maybe'; readonly id: PointerId; readonly t0: Ms; readonly from: Pt; readonly at: Pt; readonly target: Target; readonly view: View; readonly lifts: boolean }
  | { readonly kind: 'pan'; readonly id: PointerId; readonly from: Pt; readonly at: Pt; readonly view: View }
  | { readonly kind: 'drag'; readonly id: PointerId; readonly t0: Ms; readonly from: Pt; readonly at: Pt; readonly view: View; readonly tok: CombatantId; readonly target: Target; readonly far: boolean }
  | { readonly kind: 'pinch'; readonly a: Finger; readonly b: Finger; readonly d0: number; readonly mid0: Pt; readonly view: View }
  | { readonly kind: 'paint'; readonly id: PointerId; readonly at: Pt; readonly tiles: readonly Place[] }
  | { readonly kind: 'press'; readonly id: PointerId; readonly t0: Ms; readonly from: Pt; readonly control: ControlKey; readonly area: Area; readonly off: boolean; readonly hold: Ms | null; readonly timed: boolean }
  | { readonly kind: 'held'; readonly id: PointerId; readonly t0: Ms; readonly from: Pt; readonly control: ControlKey; readonly area: Area; readonly off: boolean; readonly hold: Ms }
  | { readonly kind: 'rest'; readonly down: readonly PointerId[] };
export const IDLE: Gesture = { kind: 'idle' };

export const GESTURE_EVENTS = ['down', 'move', 'up', 'cancel', 'hold'] as const;
export type GestureEventKind = (typeof GESTURE_EVENTS)[number];
/**
 * `down`: a finger touched (where, the pan and zoom then, and what: `Press`). `move`: a finger moved (and the tile under it). `up`: a finger
 * lifted (and the tile under it). `cancel`: the browser took the finger away
 * (`pointercancel`, a scroll of the hotbar, or the map lost it). `hold`: the hold timer the view started for `timer` ran
 * out. Each pointer event carries `t`, the time it happened (`PointerEvent.timeStamp`), not the time the page heard of it:
 * on a busy page the hold timer can run before a lift that came in time is heard, so the timer only says "look", and
 * a hold stands only if no event timed inside the hold window says otherwise.
 */
export type GestureEvent =
  | { readonly kind: 'down'; readonly id: PointerId; readonly t: Ms; readonly at: Pt; readonly view: View; readonly press: Press }
  | { readonly kind: 'move'; readonly id: PointerId; readonly t: Ms; readonly at: Pt; readonly tile: Place | null }
  | { readonly kind: 'up'; readonly id: PointerId; readonly t: Ms; readonly at: Pt; readonly tile: Place | null }
  | { readonly kind: 'cancel'; readonly id: PointerId; readonly t: Ms }
  | { readonly kind: 'hold' };

/**
 * What the view carries out, in order. `capture`: keep the pointer's events on the frame. `timer`, `untimer`: start or
 * clear the hold timer. `view`: the pan and zoom is now this. `lift`, `carry`, `putBack`: a token held by the GM rises,
 * follows the finger, goes back to its tile. `tap`, `press`, `detail`, `drop`, `paint`: what a gesture ends in, one at
 * most: a tap on the map, a control pressed (lifted on the control it came down on), a control's detail (held).
 * `undetail`: a detail shown for a hold that an event timed inside the hold window turned out not to be.
 */
export type GestureFx =
  | { readonly kind: 'capture'; readonly id: PointerId }
  | { readonly kind: 'timer'; readonly ms: number }
  | { readonly kind: 'untimer' }
  | { readonly kind: 'view'; readonly view: View }
  | { readonly kind: 'lift'; readonly tok: CombatantId }
  | { readonly kind: 'carry'; readonly tok: CombatantId; readonly at: Pt }
  | { readonly kind: 'putBack'; readonly tok: CombatantId }
  | { readonly kind: 'tap'; readonly target: Target }
  | { readonly kind: 'press'; readonly control: ControlKey }
  | { readonly kind: 'detail'; readonly control: ControlKey }
  | { readonly kind: 'undetail'; readonly control: ControlKey }
  | { readonly kind: 'drop'; readonly tok: CombatantId; readonly to: Place }
  | { readonly kind: 'paint'; readonly tiles: readonly Place[] };

export type Moved = { readonly gesture: Gesture; readonly fx: readonly GestureFx[] };

// ── arithmetic ──
const far = (a: Pt, b: Pt): boolean => Math.hypot(a.x - b.x, a.y - b.y) > SLOP;
const mid = (a: Pt, b: Pt): Pt => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const zoomIn = (s: number): number => Math.min(ZOOM_MOST, Math.max(ZOOM_LEAST, s));
const sameTile = (a: Place | null, b: Place | null): boolean => !!a && !!b && a.x === b.x && a.y === b.y;
/** The view zoomed to `s` (within the zoom's bounds) about point `at` of the frame, which stays over the same spot of the world. */
export function zoomAbout(v: View, at: Pt, s: number): View {
  const z = zoomIn(s);
  return { x: at.x - (at.x - v.x) * z / v.s, y: at.y - (at.y - v.y) * z / v.s, s: z };
}
/** A pinch: the zoom grows with the fingers' spread, and the spot of the world under their first middle follows their middle. */
function pinched(g: Extract<Gesture, { kind: 'pinch' }>): View {
  const s = zoomIn(g.view.s * Math.hypot(g.a.at.x - g.b.at.x, g.a.at.y - g.b.at.y) / g.d0), m = mid(g.a.at, g.b.at);
  return { x: m.x - (g.mid0.x - g.view.x) * s / g.view.s, y: m.y - (g.mid0.y - g.view.y) * s / g.view.s, s };
}
function pinchOf(a: Finger, b: Finger, view: View): Extract<Gesture, { kind: 'pinch' }> {
  return { kind: 'pinch', a, b, d0: Math.hypot(a.at.x - b.at.x, a.at.y - b.at.y) || 1, mid0: mid(a.at, b.at), view };
}

// ── the table ──
type In<S extends GestureKind> = Extract<Gesture, { kind: S }>;
type Ev<E extends GestureEventKind> = Extract<GestureEvent, { kind: E }>;
type Step<S extends GestureKind, E extends GestureEventKind> = (g: In<S>, e: Ev<E>) => Moved;
type Row<S extends GestureKind> = { readonly [E in GestureEventKind]: Step<S, E> | null };
type One = 'maybe' | 'pan' | 'drag' | 'paint';

const stay = (g: Gesture): Moved => ({ gesture: g, fx: [] });
const to = (gesture: Gesture, ...fx: GestureFx[]): Moved => ({ gesture, fx });
const panned = (v: View, from: Pt, at: Pt): View => ({ x: v.x + at.x - from.x, y: v.y + at.y - from.y, s: v.s });

/** The first finger: a stroke in paint mode, else a press that may still be a tap; a token under it may be held (the GM's). */
const touched: Step<'idle', 'down'> = (_g, e) => {
  const capture: GestureFx = { kind: 'capture', id: e.id }, p = e.press;
  if (p.on === 'control') return to({ kind: 'press', id: e.id, t0: e.t, from: e.at, control: p.control, area: p.area, off: p.off, hold: p.hold, timed: p.hold !== null }, capture, ...(p.hold !== null ? [{ kind: 'timer', ms: p.hold } as const] : []));
  if (p.mode === 'paint') return to({ kind: 'paint', id: e.id, at: e.at, tiles: p.target.tile ? [p.target.tile] : [] }, capture);
  const lifts = p.mode === 'arrange' && p.target.tok !== null;
  return to({ kind: 'maybe', id: e.id, t0: e.t, from: e.at, at: e.at, target: p.target, view: e.view, lifts }, capture, ...(lifts ? [{ kind: 'timer', ms: HOLD_MS } as const] : []));
};
/**
 * A second finger on a one-finger gesture starts a pinch from where both fingers are; what the first was doing stops
 * (`stop`) and sends nothing.
 */
const pinchFrom = <S extends One>(stop: (g: In<S>) => readonly GestureFx[]): Step<S, 'down'> => (g, e) => {
  const first = g as In<One>;
  return to(pinchOf({ id: first.id, at: first.at }, { id: e.id, at: e.at }, e.view), ...stop(g), { kind: 'capture', id: e.id });
};
const untimer = (g: In<'maybe'>): readonly GestureFx[] => (g.lifts ? [{ kind: 'untimer' }] : []);
const stopTimer = (g: In<'press'>): readonly GestureFx[] => (g.timed ? [{ kind: 'untimer' }] : []);
/** A held control taken back to a press that is no longer a hold. */
const pressOf = (g: In<'held'>): Gesture => ({ kind: 'press', id: g.id, t0: g.t0, from: g.from, control: g.control, area: g.area, off: g.off, hold: g.hold, timed: false });
const inside = (a: Area, p: Pt): boolean => p.x >= a.x0 && p.x <= a.x1 && p.y >= a.y0 && p.y <= a.y1;
/** A press ends in its control's press when the finger lifts inside the control's box and the control is on. */
const pressed = (g: In<'press'> | In<'held'>, at: Pt): readonly GestureFx[] => (!g.off && inside(g.area, at) ? [{ kind: 'press', control: g.control }] : []);
/** Fingers still down after a pinch: they do nothing until the last is up. */
const lessOf = (g: In<'rest'>, id: PointerId): Moved => {
  const down = g.down.filter(x => x !== id);
  return down.length ? to({ kind: 'rest', down }) : to(IDLE);
};
/** One of a pinch's fingers lifts: the pinch ends, and the other finger rests. */
const offPinch = (g: In<'pinch'>, id: PointerId): Moved => to({ kind: 'rest', down: [id === g.a.id ? g.b.id : g.a.id] });

const TABLE: { readonly [S in GestureKind]: Row<S> } = {
  idle: { down: touched, move: null, up: null, cancel: null, hold: null },
  maybe: {
    down: pinchFrom<'maybe'>(untimer),
    move: (g, e) => (far(e.at, g.from) ? to({ kind: 'pan', id: g.id, from: g.from, at: e.at, view: g.view }, ...untimer(g), { kind: 'view', view: panned(g.view, g.from, e.at) }) : to({ ...g, at: e.at })),
    up: g => to(IDLE, ...untimer(g), { kind: 'tap', target: g.target }),
    cancel: g => to(IDLE, ...untimer(g)),
    hold: g => (g.lifts && g.target.tok ? to({ kind: 'drag', id: g.id, t0: g.t0, from: g.from, at: g.at, view: g.view, tok: g.target.tok, target: g.target, far: false }, { kind: 'lift', tok: g.target.tok }) : stay(g)),
  },
  pan: {
    down: pinchFrom<'pan'>(() => []),
    move: (g, e) => to({ ...g, at: e.at }, { kind: 'view', view: panned(g.view, g.from, e.at) }),
    up: () => to(IDLE),
    cancel: () => to(IDLE),
    hold: null,
  },
  drag: {
    down: pinchFrom<'drag'>(g => [{ kind: 'putBack', tok: g.tok }]),
    // a finger past SLOP before the hold was due (a move the page heard after the timer) was a pan: the token goes back
    move: (g, e) => (!g.far && e.t - g.t0 < HOLD_MS && far(e.at, g.from)
      ? to({ kind: 'pan', id: g.id, from: g.from, at: e.at, view: g.view }, { kind: 'putBack', tok: g.tok }, { kind: 'view', view: panned(g.view, g.from, e.at) })
      : to({ ...g, at: e.at, far: g.far || far(e.at, g.from) }, { kind: 'carry', tok: g.tok, at: e.at })),
    // a token held and let go without moving was a slow tap; carried and brought back to its tile, it is only put back
    up: (g, e) => to(IDLE, { kind: 'putBack', tok: g.tok }, ...(!g.far ? [{ kind: 'tap', target: g.target } as const]
      : e.tile && !sameTile(e.tile, g.target.tile) ? [{ kind: 'drop', tok: g.tok, to: e.tile } as const] : [])),
    cancel: g => to(IDLE, { kind: 'putBack', tok: g.tok }),
    hold: null,
  },
  pinch: {
    down: (g, e) => to({ kind: 'rest', down: [g.a.id, g.b.id, e.id] }, { kind: 'capture', id: e.id }),
    move: (g, e) => {
      const next = e.id === g.a.id ? { ...g, a: { id: g.a.id, at: e.at } } : { ...g, b: { id: g.b.id, at: e.at } };
      return to(next, { kind: 'view', view: pinched(next) });
    },
    up: (g, e) => offPinch(g, e.id),
    cancel: (g, e) => offPinch(g, e.id),
    hold: null,
  },
  paint: {
    // a second finger zooms; the stroke so far is dropped
    down: pinchFrom<'paint'>(() => []),
    move: (g, e) => to({ ...g, at: e.at, tiles: e.tile && !g.tiles.some(t => sameTile(t, e.tile)) ? [...g.tiles, e.tile] : g.tiles }),
    up: g => to(IDLE, { kind: 'paint', tiles: g.tiles }),
    cancel: () => to(IDLE),
    hold: null,
  },
  press: {
    // a second finger on a control is not a pinch of the map: nothing happens until both are up
    down: (g, e) => to({ kind: 'rest', down: [g.id, e.id] }, ...stopTimer(g), { kind: 'capture', id: e.id }),
    // a finger that slides past SLOP is no longer a hold; it is still a press if it lifts on the same control
    move: (g, e) => (g.timed && far(e.at, g.from) ? to({ ...g, timed: false }, { kind: 'untimer' }) : stay(g)),
    up: (g, e) => to(IDLE, ...stopTimer(g), ...pressed(g, e.at)),
    cancel: g => to(IDLE, ...stopTimer(g)),
    hold: g => (g.timed && g.hold !== null ? to({ kind: 'held', id: g.id, t0: g.t0, from: g.from, control: g.control, area: g.area, off: g.off, hold: g.hold }, { kind: 'detail', control: g.control }) : stay(g)),
  },
  held: {
    down: (g, e) => to({ kind: 'rest', down: [g.id, e.id] }, { kind: 'capture', id: e.id }),
    // an event timed inside the hold window, heard after the timer, says the press was not held: the detail goes, and
    // a lift on the control is a press, a slide is a press that is no longer a hold
    move: (g, e) => (e.t - g.t0 < g.hold && far(e.at, g.from) ? to(pressOf(g), { kind: 'undetail', control: g.control }) : stay(g)),
    up: (g, e) => (e.t - g.t0 < g.hold ? to(IDLE, { kind: 'undetail', control: g.control }, ...pressed(g, e.at)) : to(IDLE)),
    cancel: (g, e) => (e.t - g.t0 < g.hold ? to(IDLE, { kind: 'undetail', control: g.control }) : to(IDLE)),
    hold: null,
  },
  rest: {
    down: (g, e) => to({ kind: 'rest', down: [...g.down, e.id] }, { kind: 'capture', id: e.id }),
    move: null,
    up: (g, e) => lessOf(g, e.id),
    cancel: (g, e) => lessOf(g, e.id),
    hold: null,
  },
};

/** The fingers a gesture holds down. */
export function fingers(g: Gesture): readonly PointerId[] {
  switch (g.kind) {
    case 'idle': return [];
    case 'pinch': return [g.a.id, g.b.id];
    case 'rest': return g.down;
    default: return [g.id];
  }
}

/**
 * The gesture after `e`, and what the view carries out. The same gesture and nothing to do where `e` does not apply:
 * a move, a lift or a cancel of a finger it does not hold (a mouse hovering, a pointer the frame never saw go down), and
 * a second down of a finger it holds.
 */
export function gesture(g: Gesture, e: GestureEvent): Moved {
  if (e.kind !== 'hold' && fingers(g).includes(e.id) !== (e.kind !== 'down')) return stay(g);
  // The table's type pairs each state's row with the steps for that state, so the cell for `e.kind` takes `g` and `e`.
  const step = TABLE[g.kind][e.kind] as Step<GestureKind, GestureEventKind> | null;
  return step ? step(g as never, e as never) : stay(g);
}
