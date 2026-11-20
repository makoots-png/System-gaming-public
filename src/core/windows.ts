// windows.ts: which windows are on screen, which wait their turn and which are going (audit SM-views-1), one table. A
// System window (`system`: a notice, a confirm, a prompt) opens one at a time, and not over the first-run window (which
// takes the whole screen, its quick start guide too): asked while either is open, it waits, and opens when its turn
// comes. A maker, the first-run window, the GM's shelf of awards and a story's window open at once. A sheet over the page
// (the dice roller, the Fight tools over a map) counts while its owner shows it. Every window that opens, a waiting one
// whose turn came too, goes on top of what is drawn, so the order here is the order on screen and the top open window
// that is not a sheet is the one that takes the keys. src/views/ui.js keeps the one value, is its one writer (`move`),
// carries out each effect and draws the top System window's Confirm all from it.

import type { Brand } from './ids.ts';

/** A window's id, given by src/views/ui.js as it makes one. */
export type WindowId = Brand<number, 'WindowId'>;
export const windowId = (n: number): WindowId => n as WindowId;
export type WindowKind = 'system' | 'maker' | 'onboard' | 'shelf' | 'story' | 'sheet';
/** A window drawn: `open`, or `leaving` while its move out plays (no longer open: it takes no key and counts for nothing). */
export type Shown = { readonly id: WindowId; readonly kind: WindowKind; readonly at: 'open' | 'leaving' };
/** The windows: those drawn, bottom first, and the System windows waiting their turn, oldest first. */
export type Windows = { readonly shown: readonly Shown[]; readonly queued: readonly WindowId[] };
/** Where one window is: waiting, open or leaving. A window in none of them is off the stack. */
export type WindowAt = 'queued' | Shown['at'];
export const WINDOW_STATES = ['queued', 'open', 'leaving'] as const satisfies readonly WindowAt[];
/** No window: the page as the app opens. */
export const NO_WINDOWS: Windows = { shown: [], queued: [] };

/**
 * What moves the windows. `ask`: a System window is asked for; it waits its turn. `next`: the oldest waiting opens, unless
 * a System window or the first-run window is open (ui.js sends it as a window is asked, and a task after one of them
 * closes, so the closed one's move out starts first). `open`: a maker, the first-run window, the shelf, a story's window or a sheet opens now.
 * `close`: an open window goes; a sheet is off at once (its owner hides it), any other leaves. `gone`: a leaving
 * window's move out ended. `answered`: a waiting window was answered without opening, by the Confirm all of the open
 * System window (with none open, nothing answers it).
 */
export type WindowEvent =
  | { readonly kind: 'ask'; readonly id: WindowId }
  | { readonly kind: 'next' }
  | { readonly kind: 'open'; readonly id: WindowId; readonly of: Exclude<WindowKind, 'system'> }
  | { readonly kind: 'close'; readonly id: WindowId }
  | { readonly kind: 'gone'; readonly id: WindowId }
  | { readonly kind: 'answered'; readonly id: WindowId };
export type WindowEventKind = WindowEvent['kind'];
export const WINDOW_EVENTS = ['ask', 'next', 'open', 'close', 'gone', 'answered'] as const satisfies readonly WindowEventKind[];

/**
 * What src/views/ui.js carries out. `draw`: a System window's turn came; draw it on top. `dismiss`: play the window's move
 * out, then answer `gone`. `next`: a System window or the first-run window went; send `next` a task later. `forget`: the
 * window is off the stack; drop what the page kept of it.
 */
export type WindowFx =
  | { readonly kind: 'draw' | 'dismiss' | 'forget'; readonly id: WindowId }
  | { readonly kind: 'next' };
export type WindowsMoved = { readonly windows: Windows; readonly fx: readonly WindowFx[] };

/** Where window `id` is, or 'off' when it is not on the stack. */
export function windowAt(s: Windows, id: WindowId): WindowAt | 'off' {
  if (s.queued.includes(id)) return 'queued';
  return s.shown.find(w => w.id === id)?.at ?? 'off';
}
/**
 * The windows a waiting System window waits behind while they are open: another System window (one at a time), and the
 * first-run window, which takes the whole screen above every other window, so one opened over it would be drawn under it.
 */
const HOLDS: { readonly [K in WindowKind]: boolean } = { system: true, onboard: true, maker: false, shelf: false, story: false, sheet: false };
/** Whether a waiting System window waits: a window that holds it is open. */
const held = (s: Windows): boolean => s.shown.some(w => HOLDS[w.kind] && w.at === 'open');
/** The window that takes the keys: the top open window that is not a sheet, or null. */
export function keyWindow(s: Windows): WindowId | null {
  for (let i = s.shown.length - 1; i >= 0; i--) { const w = s.shown[i]!; if (w.at === 'open' && w.kind !== 'sheet') return w.id; }
  return null;
}
/** The System window that is open, or null. */
export const openSystem = (s: Windows): WindowId | null => s.shown.find(w => w.kind === 'system' && w.at === 'open')?.id ?? null;

const moved = (windows: Windows, ...fx: WindowFx[]): WindowsMoved => ({ windows, fx });
const stay = (s: Windows): WindowsMoved => moved(s);
const without = (s: Windows, id: WindowId): Windows => ({ shown: s.shown.filter(w => w.id !== id), queued: s.queued.filter(q => q !== id) });

/** The window an event is about: its own id, or for `next` the oldest waiting. */
const subject = (s: Windows, e: WindowEvent): WindowId | undefined => (e.kind === 'next' ? s.queued[0] : e.id);
type Cell<K extends WindowEventKind> = (s: Windows, e: Extract<WindowEvent, { kind: K }>, id: WindowId) => WindowsMoved;
type Row = { readonly [K in WindowEventKind]: Cell<K> };
/** What each event does to the window it is about, by where that window is; a cell that answers `stay` is a move that changes nothing. */
const TABLE: { readonly [A in WindowAt | 'off']: Row } = {
  off: {
    ask: (s, e) => moved({ ...s, queued: [...s.queued, e.id] }),
    next: s => stay(s),
    open: (s, e) => moved({ ...s, shown: [...s.shown, { id: e.id, kind: e.of, at: 'open' }] }),
    close: s => stay(s),
    gone: s => stay(s),
    answered: s => stay(s),
  },
  queued: {
    ask: s => stay(s),
    next: (s, _, id) => (held(s) ? stay(s) : moved({ shown: [...s.shown, { id, kind: 'system', at: 'open' }], queued: s.queued.slice(1) }, { kind: 'draw', id })),
    open: s => stay(s),
    close: s => stay(s),
    gone: s => stay(s),
    answered: (s, _, id) => (openSystem(s) === null ? stay(s) : moved(without(s, id), { kind: 'forget', id })),
  },
  open: {
    ask: s => stay(s),
    next: s => stay(s),
    open: s => stay(s),
    close: (s, _, id) => {
      const w = s.shown.find(x => x.id === id)!;
      if (w.kind === 'sheet') return moved(without(s, id), { kind: 'forget', id });
      const leaving = { ...s, shown: s.shown.map(x => (x.id === id ? { ...x, at: 'leaving' as const } : x)) };
      return HOLDS[w.kind] ? moved(leaving, { kind: 'dismiss', id }, { kind: 'next' }) : moved(leaving, { kind: 'dismiss', id });
    },
    gone: s => stay(s),
    answered: s => stay(s),
  },
  leaving: {
    ask: s => stay(s),
    next: s => stay(s),
    open: s => stay(s),
    close: s => stay(s),
    gone: (s, _, id) => moved(without(s, id), { kind: 'forget', id }),
    answered: s => stay(s),
  },
};

/** The windows after `e`, and what the page does about it; the same value when `e` changes nothing. */
export function windowStep(s: Windows, e: WindowEvent): WindowsMoved {
  const id = subject(s, e);
  if (id === undefined) return stay(s);
  const cell = TABLE[windowAt(s, id)][e.kind] as (s: Windows, e: WindowEvent, id: WindowId) => WindowsMoved;
  return cell(s, e, id);
}
