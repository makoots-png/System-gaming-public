// windows.ts: which windows are on screen, which wait their turn and which are going (audit SM-views-1), one table. A
// System window (`system`: a notice, a confirm, a prompt) opens one at a time, and not over the first-run window (which
// takes the whole screen, its quick start guide too): asked while either is open, it waits, and opens when its turn
// comes. A maker, the first-run window, the GM's shelf of awards and a story's window open at once. A sheet over the page
// (`WindowSheet`: the dice roller, the Fight tools, a card over a map) is up while its owner shows it, and goes as Escape
// is pressed while it is on top or as the page under it changes (a tab tapped, the one shown too): its owner is told to
// take it down (audit SMX-views-6). Every window that opens, a waiting one whose turn came too, goes on top of what is
// drawn, so the order here is the order on screen and the top open window takes the keys (a sheet only Escape).
// src/views/ui.js keeps the one value, is its one writer (`move`), carries out each effect and draws the top System
// window's Confirm all from it.

import type { Brand } from './ids.ts';

/** A window's id, given by src/views/ui.js as it makes one. */
export type WindowId = Brand<number, 'WindowId'>;
export const windowId = (n: number): WindowId => n as WindowId;
export type WindowKind = 'system' | 'maker' | 'onboard' | 'shelf' | 'story' | 'sheet' | 'takeover';
/**
 * Every sheet over the page, by its owner: the dice roller (`quickRoll`, dice.js), the GM's Fight tools over a map
 * (`fightTools`) and the card of the row picked on a phone's map (`rowCard`, both combat.js), and a player's card of a
 * token on its map (`tokenCard`, table.js), and a maker's icon picker over the maker (`iconPick`, maker.js). One of each at most.
 */
export type WindowSheet = 'quickRoll' | 'fightTools' | 'rowCard' | 'tokenCard' | 'iconPick';
export const WINDOW_SHEETS = ['quickRoll', 'fightTools', 'rowCard', 'tokenCard', 'iconPick'] as const satisfies readonly WindowSheet[];
/**
 * A window drawn: `open`, or `leaving` while its move out plays (no longer open: it takes no key and counts for nothing).
 * A sheet is open until it goes, at once, with no move out.
 */
export type Shown =
  | { readonly id: WindowId; readonly kind: Exclude<WindowKind, 'sheet'>; readonly at: 'open' | 'leaving' }
  | { readonly id: WindowId; readonly kind: 'sheet'; readonly sheet: WindowSheet; readonly at: 'open' };
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
 * closes, so the closed one's move out starts first). `open`: a maker, the first-run window, the shelf, a story's window
 * or a sheet opens now (a sheet already up is not opened again). `close`: an open window goes; a sheet is off at once
 * (its owner took it down), any other leaves. `gone`: a leaving window's move out ended. `answered`: a waiting window was
 * answered without opening, by the Confirm all of the open System window (with none open, nothing answers it).
 * `escape`: Escape was pressed while the window takes the keys: a sheet goes and its owner is told (a sheet under another
 * window takes no key, so it stays); any other window answers Escape itself (a System window's cancel, a maker's "Discard changes?"), so it changes nothing here. `went`: the
 * page under the windows changed (app.js `route`: a tab, a link, a tap on the tab shown): every sheet goes, each owner
 * told; the other windows stay.
 */
export type WindowEvent =
  | { readonly kind: 'ask'; readonly id: WindowId }
  | { readonly kind: 'next' }
  | { readonly kind: 'open'; readonly id: WindowId; readonly of: Exclude<WindowKind, 'system' | 'sheet'> }
  | { readonly kind: 'open'; readonly id: WindowId; readonly of: 'sheet'; readonly sheet: WindowSheet }
  | { readonly kind: 'close'; readonly id: WindowId }
  | { readonly kind: 'gone'; readonly id: WindowId }
  | { readonly kind: 'answered'; readonly id: WindowId }
  | { readonly kind: 'escape'; readonly id: WindowId }
  | { readonly kind: 'went' };
export type WindowEventKind = WindowEvent['kind'];
export const WINDOW_EVENTS = ['ask', 'next', 'open', 'close', 'gone', 'answered', 'escape', 'went'] as const satisfies readonly WindowEventKind[];

/**
 * What src/views/ui.js carries out. `draw`: a System window's turn came; draw it on top, then run its `drawn` (what in
 * it takes its size from the window measures it then: the room's QR code). A window is drawn once, as it goes from waiting
 * to open. `dismiss`: play the window's move
 * out, then answer `gone`. `next`: a System window or the first-run window went; send `next` a task later. `shut`: a sheet
 * went by Escape or a tab; its owner takes it down. `forget`: the window is off the stack; drop what the page kept of it.
 */
export type WindowFx =
  | { readonly kind: 'draw' | 'dismiss' | 'shut' | 'forget'; readonly id: WindowId }
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
const HOLDS: { readonly [K in WindowKind]: boolean } = { system: true, onboard: true, takeover: true, maker: false, shelf: false, story: false, sheet: false };
/** Whether a waiting System window waits: a window that holds it is open. */
const held = (s: Windows): boolean => s.shown.some(w => HOLDS[w.kind] && w.at === 'open');
/** The window that takes the keys: an open takeover screen always wins, else the top open window, or null. A sheet takes only Escape (ui.js gives it no other key). */
export function keyWindow(s: Windows): WindowId | null {
  for (let i = s.shown.length - 1; i >= 0; i--) { const w = s.shown[i]!; if (w.kind === 'takeover' && w.at === 'open') return w.id; }
  for (let i = s.shown.length - 1; i >= 0; i--) { const w = s.shown[i]!; if (w.at === 'open') return w.id; }
  return null;
}
/** The System window that is open, or null. */
export const openSystem = (s: Windows): WindowId | null => s.shown.find(w => w.kind === 'system' && w.at === 'open')?.id ?? null;
/** Sheet `sheet` while it is up, or null. */
export const openSheet = (s: Windows, sheet: WindowSheet): WindowId | null => s.shown.find(w => w.kind === 'sheet' && w.sheet === sheet)?.id ?? null;
/** Whether a window or a sheet is open over the page: the app's keys wait, and the fight's news is a toast. */
export const anyOpen = (s: Windows): boolean => s.shown.some(w => w.at === 'open');

const moved = (windows: Windows, ...fx: WindowFx[]): WindowsMoved => ({ windows, fx });
const stay = (s: Windows): WindowsMoved => moved(s);
const without = (s: Windows, id: WindowId): Windows => ({ shown: s.shown.filter(w => w.id !== id), queued: s.queued.filter(q => q !== id) });
/** Window `id` as it is drawn: it is open (the cells of the `open` row are only reached for a window drawn). */
const drawn = (s: Windows, id: WindowId): Shown => s.shown.find(w => w.id === id)!;
/** A sheet sent off by Escape or a tab: off at once, and its owner told to take it down; any other window stays. */
const sentOff = (s: Windows, id: WindowId): WindowsMoved =>
  (drawn(s, id).kind === 'sheet' ? moved(without(s, id), { kind: 'shut', id }, { kind: 'forget', id }) : stay(s));
/** What opens for an `open`: a sheet with its name, any other window by its kind. */
const opened = (e: Extract<WindowEvent, { kind: 'open' }>): Shown =>
  (e.of === 'sheet' ? { id: e.id, kind: 'sheet', sheet: e.sheet, at: 'open' } : { id: e.id, kind: e.of, at: 'open' });

/** The windows an event is about, each in turn: its own, for `next` the oldest waiting, for `went` every window drawn. */
const subjects = (s: Windows, e: WindowEvent): readonly WindowId[] =>
  (e.kind === 'next' ? s.queued.slice(0, 1) : e.kind === 'went' ? s.shown.map(w => w.id) : [e.id]);
type Cell<K extends WindowEventKind> = (s: Windows, e: Extract<WindowEvent, { kind: K }>, id: WindowId) => WindowsMoved;
type Row = { readonly [K in WindowEventKind]: Cell<K> };
/** What each event does to the window it is about, by where that window is; a cell that answers `stay` is a move that changes nothing. */
const TABLE: { readonly [A in WindowAt | 'off']: Row } = {
  off: {
    ask: (s, e) => moved({ ...s, queued: [...s.queued, e.id] }),
    next: s => stay(s),
    open: (s, e) => (e.of === 'sheet' && openSheet(s, e.sheet) !== null ? stay(s) : moved({ ...s, shown: [...s.shown, opened(e)] })),
    close: s => stay(s),
    gone: s => stay(s),
    answered: s => stay(s),
    escape: s => stay(s),
    went: s => stay(s),
  },
  queued: {
    ask: s => stay(s),
    next: (s, _, id) => (held(s) ? stay(s) : moved({ shown: [...s.shown, { id, kind: 'system', at: 'open' }], queued: s.queued.slice(1) }, { kind: 'draw', id })),
    open: s => stay(s),
    close: s => stay(s),
    gone: s => stay(s),
    answered: (s, _, id) => (openSystem(s) === null ? stay(s) : moved(without(s, id), { kind: 'forget', id })),
    escape: s => stay(s),
    went: s => stay(s),
  },
  open: {
    ask: s => stay(s),
    next: s => stay(s),
    open: s => stay(s),
    close: (s, _, id) => {
      const w = drawn(s, id);
      if (w.kind === 'sheet') return moved(without(s, id), { kind: 'forget', id });
      const leaving = { ...s, shown: s.shown.map(x => (x.id === id ? { ...w, at: 'leaving' as const } : x)) };
      return HOLDS[w.kind] ? moved(leaving, { kind: 'dismiss', id }, { kind: 'next' }) : moved(leaving, { kind: 'dismiss', id });
    },
    gone: s => stay(s),
    answered: s => stay(s),
    escape: (s, _, id) => (keyWindow(s) === id ? sentOff(s, id) : stay(s)),
    went: (s, _, id) => sentOff(s, id),
  },
  leaving: {
    ask: s => stay(s),
    next: s => stay(s),
    open: s => stay(s),
    close: s => stay(s),
    gone: (s, _, id) => moved(without(s, id), { kind: 'forget', id }),
    answered: s => stay(s),
    escape: s => stay(s),
    went: s => stay(s),
  },
};

/** The windows after `e`, and what the page does about it, in order; the same value when `e` changes nothing. */
export function windowStep(s: Windows, e: WindowEvent): WindowsMoved {
  return subjects(s, e).reduce<WindowsMoved>((m, id) => {
    const cell = TABLE[windowAt(m.windows, id)][e.kind] as (s: Windows, e: WindowEvent, id: WindowId) => WindowsMoved;
    const r = cell(m.windows, e, id);
    return r.windows === m.windows && !r.fx.length ? m : { windows: r.windows, fx: [...m.fx, ...r.fx] };
  }, stay(s));
}
