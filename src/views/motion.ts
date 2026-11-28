// motion.ts: every move the app makes, in one place. A view calls a move from here; it never writes a time, an easing or
// a keyframe of its own (tests/lint.test.ts holds that). The times and easings are the tokens on :root in public/app.css,
// read here; the CSS this module owns is the "Motion" block at the end of that file.
//
// Every move keeps four rules:
// - only `transform` and `opacity` animate, so the compositor runs them and layout never does;
// - a move on an element that is already moving takes it over from where it is, it never queues;
// - under reduced motion (the device's choice in custom.js, else the OS) a move ends at once in its final state and
//   `burst` draws nothing;
// - a move blocks no input and no view awaits one before it sends: a move shows a result that already happened.
//
// A move answers a promise that settles when the move is done or was taken over. Nothing needs to wait on it.

export type Move = Promise<void>;
/** `hold`: not a move's time, the press that reads a hotbar ability (map.js) instead of picking it. */
type Speed = 'fast' | 'base' | 'slow' | 'breath' | 'hold';
type Ease = 'arrive' | 'leave' | 'pop' | 'sway';
type Frame = { transform?: string; opacity?: number | string; offset?: number };

const SPEED_TOKEN: Record<Speed, string> = { fast: '--t-fast', base: '--t-base', slow: '--t-slow', breath: '--t-breath', hold: '--t-hold' };
const EASE_TOKEN: Record<Ease, string> = { arrive: '--ease-arrive', leave: '--ease-leave', pop: '--ease-pop', sway: '--ease-sway' };
const DONE: Move = Promise.resolve();

/** A CSS time token's value in ms ("120ms" or ".2s"); NaN when it is not a time. */
export function parseTime(v: string): number {
  const m = /^\s*(-?[\d.]+)(ms|s)\s*$/.exec(v);
  return m ? Number(m[1]) * (m[2] === 's' ? 1000 : 1) : NaN;
}

let tokens: { ms: Record<Speed, number>; ease: Record<Ease, string> } | null = null;
function token(): NonNullable<typeof tokens> {
  if (tokens) return tokens;
  const cs = getComputedStyle(document.documentElement);
  const time = (s: Speed) => { const n = parseTime(cs.getPropertyValue(SPEED_TOKEN[s])); return Number.isFinite(n) ? n : 0; };
  const ease = (e: Ease) => cs.getPropertyValue(EASE_TOKEN[e]).trim() || 'ease';
  tokens = {
    ms: { fast: time('fast'), base: time('base'), slow: time('slow'), breath: time('breath'), hold: time('hold') },
    ease: { arrive: ease('arrive'), leave: ease('leave'), pop: ease('pop'), sway: ease('sway') },
  };
  return tokens;
}
/** A token's time in ms, for a view that must pace something other than an animation by it. */
export const ms = (s: Speed): number => token().ms[s];

/** The device's choice (`<html data-motion>`, set by custom.js) wins over the OS setting. */
let osReduce: MediaQueryList | null = null;
export const reduced = (): boolean => {
  const m = document.documentElement.dataset['motion'];
  return m === 'reduce' || (m !== 'full' && (osReduce ??= matchMedia('(prefers-reduced-motion: reduce)')).matches);
};

// ── the one runner: takes over a running move from where the element is now ──
const running = new WeakMap<Element, Animation>();
const settle = (a: Animation): Move => a.finished.then(() => undefined, () => undefined);

/**
 * On the page and not inside a `hidden` element (a view not shown): a move there would be seen by no one. It reads the
 * DOM only, never style or layout, so a view that draws many bars forces no extra layout by asking.
 */
const seen = (el: Element): boolean => el.isConnected && !el.closest('[hidden]');

/** Where a moving element is now, for a move that takes it over. Read it before changing the page: it costs a style pass. */
const now = (el: Element): Frame | null => {
  const prev = running.get(el);
  if (!prev || prev.playState !== 'running') return null;
  const cs = getComputedStyle(el);
  return { transform: cs.transform, opacity: cs.opacity };
};

function play(el: Element, frames: Frame[], speed: Speed, ease: Ease, o: { fill?: FillMode; delay?: number; scale?: number; from?: Frame | null; iterations?: number } = {}): Move {
  if (reduced() || typeof el.animate !== 'function' || !seen(el)) return DONE;
  const at = o.from !== undefined ? o.from : now(el);
  if (at) frames = [{ ...frames[0], ...at }, ...frames.slice(1)];
  running.get(el)?.cancel();
  const a = el.animate(frames as Keyframe[], { duration: ms(speed) * (o.scale ?? 1), easing: token().ease[ease], fill: o.fill ?? 'none', delay: o.delay ?? 0, iterations: o.iterations ?? 1 });
  running.set(el, a);
  return settle(a).then(() => { if (running.get(el) === a) running.delete(el); });
}

/**
 * Something lasting on the ground breathes: its opacity eases down a fifth and back, over `--t-breath`, for as long as it
 * stays (a zone on the map). Calling it again on an element that breathes changes nothing.
 */
export function breathe(el: Element): Move {
  const a = running.get(el);
  if (a && a.playState === 'running' && a.effect?.getComputedTiming().iterations === Infinity) return DONE;
  return play(el, [{ opacity: 1 }, { opacity: 0.8 }, { opacity: 1 }], 'breath', 'sway', { iterations: Infinity, from: null });
}

/** Stop whatever move an element is in, leaving it in its own (final) style. */
export function stop(el: Element): void { running.get(el)?.cancel(); running.delete(el); }

// ── arriving, going, answering ──
const FROM = { below: 'translateY(10px) scale(.98)', toast: 'translateY(14px)', fade: 'none' } as const;

/** Something arrives: it rises a little and settles (`--t-base`, `--ease-arrive`). */
export const enter = (el: Element, from: keyof typeof FROM = 'below'): Move =>
  play(el, [{ opacity: 0, transform: FROM[from] }, { opacity: 1, transform: 'none' }], 'base', 'arrive');

/** Reveals `els` one after another (`opacity` + small rise, spaced by `--t-slow`). Instant under reduced motion. */
export function staggerReveal(els: readonly Element[]): Move {
  if (reduced() || !els.length) return DONE;
  const step = Math.max(ms('slow'), 120);
  return Promise.all(
    els.map((el, i) => play(el, [{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }], 'base', 'arrive', { delay: i * step, fill: 'backwards', from: null })),
  ).then(() => undefined);
}

/** Something goes: faster than it came (`--t-fast`, `--ease-leave`). It stays invisible after; the caller removes it. */
const OUT: Frame[] = [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(6px) scale(.98)' }];
export const leave = (el: Element): Move => play(el, OUT, 'fast', 'leave', { fill: 'forwards' });

/**
 * Something that stays on the page goes (a sheet): it leaves as `leave` does, then is `hidden`, and shows as itself when
 * it is next unhidden. Brought back while it leaves (an `enter`), it stays.
 */
export function hide(el: HTMLElement): Move {
  const m = leave(el), mine = running.get(el);
  if (!mine) { el.hidden = true; return DONE; }
  return m.then(() => { if (mine.playState === 'finished') { el.hidden = true; mine.cancel(); } });
}

/**
 * Takes a window or a toast off the screen: it is out of the page at once (not modal, not focusable, no longer matched as
 * open, the page behind it scrolls again), fades while it goes, then is removed. `win` is the part that moves; the rest fades.
 */
export function dismiss(el: HTMLElement, win: Element | null = null): Move {
  if (reduced()) { el.remove(); return DONE; }
  // where a window still rising is, read before the page changes: after, the read would restyle the whole page
  const fromWin = win && now(win), fromEl = now(el);
  el.classList.remove('show', 'sys-overlay');
  el.classList.add('m-leaving');
  el.inert = true;
  el.setAttribute('aria-hidden', 'true');
  for (const w of [el, win]) for (const a of ['aria-modal', 'role', 'id', 'aria-labelledby', 'aria-live']) w?.removeAttribute(a);
  const moves = win
    ? [play(win, OUT, 'fast', 'leave', { fill: 'forwards', from: fromWin }), play(el, [{ opacity: 1 }, { opacity: 0 }], 'fast', 'leave', { fill: 'forwards', from: fromEl })]
    : [play(el, OUT, 'fast', 'leave', { fill: 'forwards', from: fromEl })];
  return Promise.all(moves).then(() => el.remove());
}

/** A press made without a finger (a key, a shortcut). A tap's press is CSS (`:active` in the Motion block), in the same frame. */
export const press = (el: Element): Move => play(el, [{ transform: 'scale(.96)' }, { transform: 'none' }], 'fast', 'arrive');

/** Something new that matters appears: it grows past its size and settles (`--ease-pop`). */
export const pop = (el: Element): Move =>
  play(el, [{ opacity: 0, transform: 'scale(.6)' }, { opacity: 1, transform: 'none' }], 'base', 'pop');

/** One short shake: a crit, a hunter going down. Never for an ordinary hit. */
export const shake = (el: Element): Move => play(el, [
  { transform: 'none' }, { transform: 'translateX(-6px)', offset: .15 }, { transform: 'translateX(5px)', offset: .35 },
  { transform: 'translateX(-3px)', offset: .55 }, { transform: 'translateX(2px)', offset: .75 }, { transform: 'none' },
], 'slow', 'arrive');

// ── the coin (src/views/coin.js): it goes up and turns over until it is told where it landed ──
// Every frame is `translateY() rotateY()`, so the browser turns the angle itself; a frame of another shape would be
// blended as a matrix, which takes the shortest way round and loses the turns. Neither move takes over from where the
// coin is (`from: null`): a coin turns too fast for the jump to its first frame to show.
/**
 * A called coin in the air: it rises, turns over and over and stays up, one turn each `--t-slow`, until `landOn` takes
 * it over. It never settles by itself. Under reduced motion it holds still and the words say it is in the air.
 */
export const spin = (el: Element): Move => play(el, [
  { transform: 'translateY(-18px) rotateY(0deg)' }, { transform: 'translateY(-24px) rotateY(180deg)', offset: .5 }, { transform: 'translateY(-18px) rotateY(360deg)' },
], 'slow', 'arrive', { iterations: Infinity, from: null });
/**
 * The coin comes down on `side` with two more turns and settles with a small bounce (`--ease-pop`). It ends where the
 * coin's CSS rests it: heads up, or turned over (180 degrees, here 900) for tails.
 */
export const landOn = (el: Element, side: 'heads' | 'tails'): Move => play(el, [
  { transform: 'translateY(-24px) rotateY(0deg)' }, { transform: `translateY(0px) rotateY(${side === 'tails' ? 900 : 720}deg)` },
], 'slow', 'pop', { scale: 2, from: null });

// ── the layer: one fixed, untouchable layer over the page for what is drawn above an element (a flash, a burst) ──
let layerEl: HTMLElement | null = null;
function layer(): HTMLElement {
  if (layerEl && layerEl.isConnected) return layerEl;
  layerEl = document.createElement('div');
  layerEl.className = 'm-layer';
  layerEl.setAttribute('aria-hidden', 'true');
  document.body.appendChild(layerEl);
  return layerEl;
}

/** A pale light over an element, gone in `--t-slow`: "this one just changed" (a card saved, a row updated). */
export function flash(el: Element, tone: 'acc' | 'gold' | 'red' = 'acc'): Move {
  if (reduced() || !el.isConnected) return DONE;
  const r = el.getBoundingClientRect();
  const f = document.createElement('i');
  f.className = `m-flash m-${tone}`;
  layer().appendChild(f);
  const at = `translate(${r.left}px,${r.top}px) scale(${r.width / 100},${r.height / 100})`;
  return play(f, [{ transform: at, opacity: 0 }, { transform: at, opacity: .3, offset: .25 }, { transform: at, opacity: 0 }], 'slow', 'leave')
    .then(() => f.remove());
}

/**
 * A thing removed fades off where it stood: a copy of it on the layer, with no id, data or role, so nothing finds or taps
 * it while it goes. Call it just before the element is removed or redrawn.
 */
export function fadeOff(el: Element): Move {
  if (reduced() || !el.isConnected) return DONE;
  const r = el.getBoundingClientRect();
  if (!r.width || !r.height) return DONE;
  const c = el.cloneNode(true) as HTMLElement;
  for (const n of [c, ...c.querySelectorAll('*')]) for (const a of [...n.attributes]) if (a.name !== 'class' && a.name !== 'style') n.removeAttribute(a.name);
  c.style.width = `${r.width}px`; c.style.height = `${r.height}px`; c.style.margin = '0'; c.style.boxSizing = 'border-box';
  layer().appendChild(c);
  const at = `translate(${r.left}px,${r.top}px)`;
  return play(c, [{ transform: at, opacity: 1 }, { transform: `${at} scale(.92)`, opacity: 0 }], 'fast', 'leave', { fill: 'forwards' }).then(() => c.remove());
}

/** A mark of light travels from one box's edge to another's (the bottom bar's lit tab), so the eye follows where it went. */
export function travel(from: DOMRect, to: DOMRect, edge: 'top' | 'left' = 'top'): Move {
  if (reduced() || (from.left === to.left && from.top === to.top)) return DONE;
  const m = document.createElement('i');
  m.className = `m-travel m-travel-${edge}`;
  layer().appendChild(m);
  const at = (r: DOMRect) => (edge === 'top' ? `translate(${r.left}px,${r.top}px) scaleX(${r.width / 100})` : `translate(${r.left}px,${r.top}px) scaleY(${r.height / 100})`);
  return play(m, [{ transform: at(from), opacity: 1 }, { transform: at(to), opacity: 1, offset: .8 }, { transform: at(to), opacity: 0 }], 'base', 'arrive')
    .then(() => m.remove());
}

// ── slide: rows move to their new places (FLIP: where they were, change, where they are, move back by transform, let go) ──
type Spot = { x: number; y: number };
const marks = new WeakMap<Element, Map<string, Spot>>();
/** Where each row is inside `box`, so a scroll between two looks changes nothing. */
function spots(box: Element, rows: () => Iterable<HTMLElement>, key: (el: HTMLElement) => string | undefined): Map<string, Spot> {
  const b = box.getBoundingClientRect(), out = new Map<string, Spot>();
  for (const el of rows()) { const k = key(el); if (k) { const r = el.getBoundingClientRect(); out.set(k, { x: r.left - b.left, y: r.top - b.top }); } }
  return out;
}

/**
 * `change` redraws the rows inside `box` (`rows()` finds them, `key` names each). With `moved`, a row that was there
 * before slides from its old place to its new one and a new row just appears; without, the change is drawn as it is.
 * Where the rows were is remembered from the last redraw (read at the start of the next frame, when the page is laid out
 * already), so a slide costs one layout, the one the frame needs anyway.
 */
export function slideTo(box: Element, rows: () => Iterable<HTMLElement>, key: (el: HTMLElement) => string | undefined, change: () => void, moved = true): Move {
  if (reduced() || !seen(box)) { change(); marks.delete(box); return DONE; }
  const before = moved ? marks.get(box) ?? spots(box, rows, key) : null;
  change();
  if (!before) { requestAnimationFrame(() => { if (seen(box)) marks.set(box, spots(box, rows, key)); }); return DONE; }
  const list = [...rows()];
  list.forEach(stop);
  const after = spots(box, rows, key);
  marks.set(box, after);
  const moves: Move[] = [];
  for (const el of list) {
    const k = key(el), was = k ? before.get(k) : undefined, is = k ? after.get(k) : undefined;
    if (!was || !is) continue;
    const dx = was.x - is.x, dy = was.y - is.y;
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;
    moves.push(play(el, [{ transform: `translate(${dx}px,${dy}px)` }, { transform: 'none' }], 'base', 'arrive', { from: null }));
  }
  return Promise.all(moves).then(() => undefined);
}

// ── the map (src/views/map.js): a token goes its way, a number rises off it, a blast's ring opens ──
/**
 * A token goes along its way: through each of `points` (its `transform` at each tile, the first where it stood) at a
 * walk's pace, a tile at a time, and ends in its own style. A straight move is two points.
 */
export function along(el: Element, points: readonly string[]): Move {
  if (points.length < 2) return DONE;
  const frames = points.map((transform, i) => ({ transform, offset: i / (points.length - 1) }));
  return play(el, frames, 'base', 'arrive', { scale: Math.min(2.5, Math.max(1, (points.length - 1) / 2)), from: null });
}
/** A number rises off a token and fades: what a hit or a heal just did. It stays invisible after; the caller removes it. */
export const rise = (el: Element): Move => play(el, [
  { transform: 'translateY(0) scale(.8)', opacity: 0 }, { transform: 'translateY(-10px) scale(1)', opacity: 1, offset: .2 }, { transform: 'translateY(-30px)', opacity: 0 },
], 'slow', 'leave', { scale: 1.25, fill: 'forwards', from: null });
/** A blast's ring opens from its centre to its size and fades where it landed. */
export const spread = (el: Element): Move => play(el, [{ transform: 'scale(.15)', opacity: .9 }, { transform: 'scale(1)', opacity: 0 }], 'slow', 'arrive', { fill: 'forwards', from: null });

// ── numbers ──
/** Leaves fast and settles: where a counted number is at time t (0 to 1) of its count. */
export const easeOut = (t: number): number => 1 - (1 - Math.min(1, Math.max(0, t))) ** 3;
/** The whole number a count from `from` to `to` shows at time t; exactly `to` at the end. */
export const countAt = (from: number, to: number, t: number): number => (t >= 1 ? to : Math.round(from + (to - from) * easeOut(t)));

const counting = new WeakMap<Element, { shown: number; stop(): void }>();
/** Forgets what a bar or number showed, so the next `fillTo` or `numberTo` on it is drawn at once: it shows another thing now. */
export function forget(el: Element): void { fillsOf.delete(el); lastShownOf.delete(el); counting.get(el)?.stop(); }

/** What a number redrawn as new markup showed last, by key (the sheet's XP percentage). Kept to the most recent SHOWN_CAP keys. */
const SHOWN_CAP = 400;
/**
 * A number rolls to its value over `--t-slow`. Its digits are tabular, so its width does not jump. A count already running
 * on the element is taken over from the number it shows.
 */
export function countTo(el: HTMLElement, from: number, to: number, format: (n: number) => string = String): Move {
  el.classList.add('m-num');
  const prev = counting.get(el);
  if (prev) { from = prev.shown; prev.stop(); }
  if (reduced() || from === to || !seen(el)) { el.textContent = format(to); return DONE; }
  const dur = ms('slow');
  return new Promise(resolve => {
    let raf = 0;
    const t0 = performance.now();
    const state = { shown: from, stop: () => { cancelAnimationFrame(raf); counting.delete(el); resolve(); } };
    counting.set(el, state);
    const tick = (now: number) => {
      const t = el.isConnected ? (now - t0) / dur : 1;
      state.shown = countAt(from, to, t);
      el.textContent = format(state.shown);
      if (t < 1) raf = requestAnimationFrame(tick); else { counting.delete(el); resolve(); }
    };
    el.textContent = format(from);
    raf = requestAnimationFrame(tick);
  });
}

const lastShown = new Map<string, number>();
const lastShownOf = new WeakMap<Element, number>();
/**
 * Shows `n` in `el`: it counts from the number shown there last (by `key` when the element is redrawn as new markup), or
 * is set at once the first time, while hidden, or when it did not change.
 */
export function numberTo(el: HTMLElement, n: number, format: (n: number) => string = String, key?: string): Move {
  const was = key !== undefined ? lastShown.get(key) : lastShownOf.get(el);
  if (key !== undefined) { lastShown.delete(key); lastShown.set(key, n); if (lastShown.size > SHOWN_CAP) lastShown.delete(lastShown.keys().next().value ?? ''); }
  lastShownOf.set(el, n);
  if (was === undefined || was === n) { el.classList.add('m-num'); if (!counting.has(el)) el.textContent = format(n); return DONE; }
  return countTo(el, was, n, format);
}

/** The face of a die while it tumbles: `steps` numerals that are not the rolled one, then the rolled one. */
export const tumbleFaces = (value: number, sides: number, steps: number): number[] =>
  Array.from({ length: steps }, (_, i) => { const n = ((value - 1 + (i + 1) * 7) % Math.max(2, sides)) + 1; return n === value ? (n % sides) + 1 : n; }).concat(value);

/** A die's numerals tumble for `--t-slow` and land on the value already rolled (src/edge/roll.ts rolled it; this only shows it). */
export function tumble(el: HTMLElement, value: number, sides: number, format: (n: number) => string = String): Move {
  el.classList.add('m-num');
  const prev = counting.get(el);
  if (prev) prev.stop();
  if (reduced() || sides < 2 || !seen(el)) { el.textContent = format(value); return DONE; }
  const faces = tumbleFaces(value, sides, 6), dur = ms('slow');
  return new Promise(resolve => {
    let raf = 0;
    const t0 = performance.now();
    const state = { shown: value, stop: () => { cancelAnimationFrame(raf); counting.delete(el); el.textContent = format(value); resolve(); } };
    counting.set(el, state);
    const tick = (now: number) => {
      const t = el.isConnected ? (now - t0) / dur : 1;
      el.textContent = format(faces[Math.min(faces.length - 1, Math.floor(t * (faces.length - 1)))] ?? value);
      if (t < 1) { raf = requestAnimationFrame(tick); return; }
      el.textContent = format(value); counting.delete(el); void pop(el).then(resolve);
    };
    raf = requestAnimationFrame(tick);
  });
}

// ── bars ──
const clamp01 = (f: number): number => (Number.isFinite(f) ? Math.min(1, Math.max(0, f)) : 0);

/** The markup of a bar's fill at a fraction, for a view's first draw: `<div class="bar …">${fillMarkup(f)}</div>`. */
export const fillMarkup = (fraction: number): string => `<i style="--f:${clamp01(fraction)}"></i>`;

const fillsOf = new WeakMap<Element, number>();
/**
 * A bar fills or drains to `fraction` by `transform: scaleX` over `--t-slow`. On a loss a pale trail stays at the old
 * value for a beat and then follows, so the size of the hit is seen. The bar remembers what it showed, so a screen that
 * updates in place (src/views/patch.ts) keeps the node and the move starts from there; the first fill is drawn at once.
 */
export function fillTo(bar: Element, fraction: number, o: { trail?: boolean; from?: number } = {}): Move {
  const f = clamp01(fraction);
  const fill = bar.querySelector<HTMLElement>(':scope > i');
  if (!fill) return DONE;
  const was = o.from !== undefined ? clamp01(o.from) : fillsOf.get(bar);
  let trail = bar.querySelector<HTMLElement>(':scope > .m-trail');
  // where a moving fill and trail are, read before the bar changes: after a write the read restyles it in this task
  const fillAt = now(fill), trailAt = trail && now(trail);
  fillsOf.set(bar, f);
  fill.style.setProperty('--f', String(f));
  if (reduced()) { trail?.style.setProperty('--f', String(f)); return DONE; }
  if (o.trail !== false && was !== undefined && f < was) {
    if (!trail) { trail = document.createElement('b'); trail.className = 'm-trail'; bar.insertBefore(trail, fill); }
    trail.style.setProperty('--f', String(f));
  } else if (trail) trail.style.setProperty('--f', String(f));
  if (was === undefined || was === f) return DONE;
  const moves = [play(fill, [{ transform: `scaleX(${was})` }, { transform: `scaleX(${f})` }], f < was ? 'base' : 'slow', 'arrive', { from: fillAt })];
  if (trail && f < was) moves.push(play(trail, [{ transform: `scaleX(${was})` }, { transform: `scaleX(${was})`, offset: .35 }, { transform: `scaleX(${f})` }], 'slow', 'leave', { scale: 1.6, from: trailAt }));
  return Promise.all(moves).then(() => undefined);
}

/** The whole percentage a fraction shows: 100% only when it is all there. */
export const percent = (fraction: number): number => Math.floor(clamp01(fraction) * 100 + 1e-9);

/**
 * Real progress in `el`: a fraction is a bar and a whole percentage; null is "waiting, no number to show": a quiet pulse
 * and the words of what it waits for. Never a made-up number.
 */
export function progress(el: HTMLElement, fraction: number | null, words = ''): void {
  const mode = fraction === null ? 'wait' : 'bar';
  if (el.dataset['prog'] !== mode) {
    el.dataset['prog'] = mode;
    el.classList.add('m-prog');
    el.innerHTML = mode === 'wait'
      ? '<span class="m-wait" aria-hidden="true"></span><span class="m-prog-words"></span>'
      : `<span class="bar m-prog-bar">${fillMarkup(0)}</span><span class="m-prog-pct m-num"></span><span class="m-prog-words"></span>`;
  }
  // the bar first: it reads where its fill is moving, a style pass of its own once the words below have changed
  if (fraction !== null) void fillTo(el.querySelector('.m-prog-bar') as Element, fraction, { trail: false });
  (el.querySelector('.m-prog-words') as HTMLElement).textContent = words;
  if (fraction === null) { el.setAttribute('role', 'status'); el.removeAttribute('aria-valuenow'); return; }
  const p = percent(fraction);
  el.setAttribute('role', 'progressbar');
  el.setAttribute('aria-valuemin', '0'); el.setAttribute('aria-valuemax', '100'); el.setAttribute('aria-valuenow', String(p));
  (el.querySelector('.m-prog-pct') as HTMLElement).textContent = `${p}%`;
}

// ── bursts: particles on earned moments only. A kind is a row; `life` is in units of --t-slow ──
type BurstKind = { colour: string; count: number; spread: number; rise: number; life: number };
export const BURSTS = {
  /** a critical hit: gold sparks thrown out evenly */
  crit: { colour: '--gold', count: 16, spread: 64, rise: 0, life: 1.4 },
  /** a monster goes down: red shards fall away */
  kill: { colour: '--red', count: 20, spread: 72, rise: 36, life: 1.75 },
  /** a level-up: the System's blue light rises */
  levelup: { colour: '--cyan', count: 24, spread: 80, rise: -120, life: 1.8 },
  /** a boss staggered: a tight gold ring */
  stagger: { colour: '--gold', count: 12, spread: 48, rise: 0, life: 1.2 },
  /** a channel released: mana motes thrown out */
  channel: { colour: '--mp', count: 18, spread: 70, rise: -24, life: 1.5 },
  /** a shadow extracted: violet smoke rising */
  extract: { colour: '--purple', count: 22, spread: 60, rise: -90, life: 1.8 },
} as const satisfies Record<string, BurstKind>;
export type Burst = keyof typeof BURSTS;

/** The most particles alive at once, across every burst: two full bursts. A burst past it draws fewer. */
export const POOL_CAP = 48;

/** A fixed set of things made at most `cap` times and reused. `take` answers fewer than asked when all are in use. */
export function makePool<T>(cap: number, make: () => T): { take(n: number): T[]; give(t: T): void; size(): number } {
  const free: T[] = [];
  let made = 0;
  return {
    take(n) {
      const out: T[] = [];
      while (out.length < n) {
        const t = free.pop() ?? (made < cap ? (made++, make()) : undefined);
        if (t === undefined) break;
        out.push(t);
      }
      return out;
    },
    give(t) { free.push(t); },
    size: () => made,
  };
}

/** Where particle i of n goes: evenly round the circle (golden angle), at a distance that varies so it is not a ring. */
export function spreadOf(i: number, n: number, spread: number): { dx: number; dy: number } {
  const a = i * 2.39996, d = spread * (0.55 + 0.45 * (((i * 7) % n) / Math.max(1, n - 1)));
  return { dx: Math.round(Math.cos(a) * d), dy: Math.round(Math.sin(a) * d) };
}

let bits: ReturnType<typeof makePool<HTMLElement>> | null = null;
/** A burst of particles at a point or an element's centre. Nothing under reduced motion. */
export function burst(kind: Burst, at: Element | { x: number; y: number }): Move {
  if (reduced() || ('getBoundingClientRect' in at && !seen(at))) return DONE;
  const k: BurstKind = BURSTS[kind];
  const p = 'getBoundingClientRect' in at ? (r => ({ x: r.left + r.width / 2, y: r.top + r.height / 2 }))(at.getBoundingClientRect()) : at;
  const L = layer();
  bits ??= makePool(POOL_CAP, () => { const b = document.createElement('i'); b.className = 'm-bit'; return b; });
  const got = bits.take(k.count);
  return Promise.all(got.map((b, i) => {
    if (b.parentNode !== L) L.appendChild(b);
    b.style.background = `var(${k.colour})`;
    const { dx, dy } = spreadOf(i, k.count, k.spread);
    const from = `translate(${p.x}px,${p.y}px) scale(1)`, to = `translate(${p.x + dx}px,${p.y + dy + k.rise}px) scale(.3)`;
    return play(b, [{ transform: from, opacity: 1 }, { transform: to, opacity: 0 }], 'slow', 'arrive', { scale: k.life, fill: 'forwards' })
      .then(() => { bits?.give(b); });
  })).then(() => undefined);
}
