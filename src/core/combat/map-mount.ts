// map-mount.ts: the battle map's life on the page (src/views/map.js `mount`), one table (docs/state-machines.md, "The
// battle map on the page"; audit BUG-views-8, SM-views-3). A map is mounted once in a screen's box (the GM's fight
// screen, a player's HUD) and outlives the fights it shows: blank while its source shows no fight, opening a fight it has
// not framed yet, framed for that fight, gone once the screen takes it off the page. The fight it shows is the fight's
// id, so a new fight on the same ground is a new fight: what the last one left (the gesture and its timer, the choice,
// the paint brush, the tokens' and zones' last draw, the open detail) is forgotten and the new one is framed as a map
// frames a fight it opens. The view feeds in each draw's fight before it draws and what the draw left after, the
// window's resize, and its own removal; `mapMount` answers the next state and what the view carries out. Pure.
// Whether the frame has a size is a layout read, and a read in the middle of a redraw lays the page out there and again
// in the frame after (the lag test's pick on the map): a draw says only what it drew, and the map asks for the frame's
// size (`measure`) only where the answer decides a move, the view answering `sized`.
import type { FightId } from './fight-types.ts';

/**
 * The map on the page: `blank` (no fight to show: hidden, nothing of a fight kept), `opening` a fight not framed yet (no
 * token drawn yet, or its frame has no size), `framed` for a fight (`over`: the source's words over the frame when its
 * height was last worked out), `gone` (off the page: it listens to nothing and draws nothing).
 */
export type MapMount =
  | { readonly at: 'blank' }
  | { readonly at: 'opening'; readonly fight: FightId }
  | { readonly at: 'framed'; readonly fight: FightId; readonly over: string }
  | { readonly at: 'gone' };
export type MapMountState = MapMount['at'];
export const MAP_MOUNT_STATES = ['blank', 'opening', 'framed', 'gone'] as const satisfies readonly MapMountState[];
/** A map just mounted: no fight shown yet. */
export const BLANK: MapMount = { at: 'blank' };

/**
 * What moves it. `show`: a draw begins, and the source shows `fight` (null: none). `drawn`: the draw is on the page,
 * `tokens` when the scene has a token, `over` the source's words over the frame, `lost` when a turn came to a body out
 * of the frame's sight. `sized`: the view's answer to `measure`, `shown` when the frame has a size, `over` the words of
 * the draw that asked. `resized`: the window changed size, `shown` when the frame has a size then. `gone`: the screen
 * took the map off the page.
 */
export type MapMountEvent =
  | { readonly kind: 'show'; readonly fight: FightId | null }
  | { readonly kind: 'drawn'; readonly tokens: boolean; readonly over: string; readonly lost: boolean }
  | { readonly kind: 'sized'; readonly shown: boolean; readonly over: string }
  | { readonly kind: 'resized'; readonly shown: boolean }
  | { readonly kind: 'gone' };
export type MapMountEventKind = MapMountEvent['kind'];
export const MAP_MOUNT_EVENTS = ['show', 'drawn', 'sized', 'resized', 'gone'] as const satisfies readonly MapMountEventKind[];

/**
 * What the view carries out. `forget`: drop what the last fight left (the gesture and its hold timer, the choice, the
 * brush, the tokens' and zones' last draw, the open detail). `measure`: read whether the frame has a size and answer
 * `sized` with the draw's words over the frame. `frame`: work the frame's height out, then frame the fight.
 * `reheight`: work the height out again, and frame again only when it changed. `refit`: frame again at the frame's size
 * as last framed. `stop`: stop listening (the window's resize, the hotbar's observer, the news line, the timers).
 */
export type MapMountFx = { readonly kind: 'forget' | 'measure' | 'frame' | 'reheight' | 'refit' | 'stop' };
export type MapMountMoved = { readonly mount: MapMount; readonly fx: readonly MapMountFx[] };

const stay = (mount: MapMount): MapMountMoved => ({ mount, fx: [] });
const to = (mount: MapMount, ...kinds: MapMountFx['kind'][]): MapMountMoved => ({ mount, fx: kinds.map(kind => ({ kind })) });
const stop = (): MapMountMoved => to({ at: 'gone' }, 'stop');
/** A fight shown: the same one stays as it is; another, or none, forgets the last. */
const shown = (s: Extract<MapMount, { fight: FightId }>, e: Extract<MapMountEvent, { kind: 'show' }>): MapMountMoved =>
  e.fight === s.fight ? stay(s) : e.fight === null ? to(BLANK, 'forget') : to({ at: 'opening', fight: e.fight }, 'forget');

type Cell<S extends MapMountState, K extends MapMountEventKind> = (s: Extract<MapMount, { at: S }>, e: Extract<MapMountEvent, { kind: K }>) => MapMountMoved;
/** What each event does in each state; a cell that answers its state with no effect is a move that changes nothing. */
const TABLE: { readonly [S in MapMountState]: { readonly [K in MapMountEventKind]: Cell<S, K> } } = {
  blank: {
    show: (s, e) => (e.fight === null ? stay(s) : to({ at: 'opening', fight: e.fight })),
    drawn: s => stay(s),
    sized: s => stay(s),
    resized: s => stay(s),
    gone: stop,
  },
  opening: {
    show: shown,
    // a draw with a token asks whether the frame has a size; a hidden frame waits for a draw that finds it shown
    drawn: (s, e) => (e.tokens ? to(s, 'measure') : stay(s)),
    sized: (s, e) => (e.shown ? to({ at: 'framed', fight: s.fight, over: e.over }, 'frame') : stay(s)),
    resized: s => stay(s),
    gone: stop,
  },
  framed: {
    show: shown,
    // a draw with no token works nothing out; new words over the frame change its height, worked out when the frame
    // is shown (a hidden frame keeps the words it was worked out for, so the next draw asks again); a draw of the same
    // words reads nothing
    drawn: (s, e) => (!e.tokens ? stay(s) : e.over !== s.over ? to(s, 'measure') : e.lost ? to(s, 'refit') : stay(s)),
    sized: (s, e) => (e.shown && e.over !== s.over ? to({ ...s, over: e.over }, 'reheight') : stay(s)),
    // a resize while the frame is hidden leaves its frame stale: the fight is framed again when it next shows
    resized: (s, e) => (e.shown ? to(s, 'frame') : to({ at: 'opening', fight: s.fight })),
    gone: stop,
  },
  gone: {
    show: s => stay(s),
    drawn: s => stay(s),
    sized: s => stay(s),
    resized: s => stay(s),
    gone: s => stay(s),
  },
};

/** The map's life after `e`, and what the view carries out for it; the same state with no effect when `e` changes nothing. */
export function mapMount(s: MapMount, e: MapMountEvent): MapMountMoved {
  // The table's type pairs each state's row with the cells for that state, so the cell for `e.kind` takes `s` and `e`.
  const row = TABLE[s.at] as { readonly [K in MapMountEventKind]: (s: MapMount, e: MapMountEvent) => MapMountMoved };
  return row[e.kind](s, e);
}
