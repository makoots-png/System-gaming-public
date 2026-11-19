// detail-open.ts: which "more info" detail of one list is open (audit BUG-views-1, SM-views-2). A list is the things one
// view draws together (the sheet's status chips, the GM card's abilities, the map's hotbar and zones); at most one of
// its details is open. A small machine: the list is closed or open on one key, and three events move it, a tap on a
// thing (or a hold on the hotbar) that toggles it, a close of whatever is open, and a drop of one key that closes it
// only when it is the open one. src/views/detail.js keeps one value per list and is the one place it moves: each move
// is drawn by the view's redraw, an open and a close alike, so no drawn markup can say otherwise. The detail's words are
// src/core/detail.ts.

/** One list's open detail: none, or the one of `key`. */
export type DetailOpen = { readonly at: 'closed' } | { readonly at: 'open'; readonly key: string };
export const DETAIL_OPEN_STATES = ['closed', 'open'] as const satisfies readonly DetailOpen['at'][];
/** Nothing open: every list starts so when the app opens. */
export const CLOSED: DetailOpen = { at: 'closed' };

/**
 * What moves a list's detail: `toggle` a tap on a thing's control (or a hold on a hotbar slot), `close` closes whatever
 * is open (a tap on the map's detail, an ability picked), `drop` closes `key` only when it is the open one (a hold that
 * turned out not to be one, a thing gone from the screen).
 */
export type DetailEvent = { readonly kind: 'toggle'; readonly key: string } | { readonly kind: 'close' } | { readonly kind: 'drop'; readonly key: string };
export const DETAIL_EVENTS = ['toggle', 'close', 'drop'] as const satisfies readonly DetailEvent['kind'][];

type Cell<S extends DetailOpen['at'], K extends DetailEvent['kind']> = (s: Extract<DetailOpen, { at: S }>, e: Extract<DetailEvent, { kind: K }>) => DetailOpen;
/** What each event does from each state; a cell that answers its state unchanged is a move that changes nothing. */
const TABLE: { readonly [S in DetailOpen['at']]: { readonly [K in DetailEvent['kind']]: Cell<S, K> } } = {
  closed: {
    toggle: (_, e) => ({ at: 'open', key: e.key }),
    close: s => s,
    drop: s => s,
  },
  open: {
    toggle: (s, e) => (s.key === e.key ? CLOSED : { at: 'open', key: e.key }),
    close: () => CLOSED,
    drop: (s, e) => (s.key === e.key ? CLOSED : s),
  },
};

/** The list's detail after `e`; the same value when `e` changes nothing, so a caller draws only a change. */
export function detailStep(s: DetailOpen, e: DetailEvent): DetailOpen {
  const row = TABLE[s.at] as { readonly [K in DetailEvent['kind']]: (s: DetailOpen, e: DetailEvent) => DetailOpen };
  return row[e.kind](s, e);
}
