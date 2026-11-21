// panel.ts: a view's main part or a panel on the page (audit SMX-sync-10, SMX-views-9), one table. Each draw of its view
// asks the part's `when` once; that answer and where the part is say whether it shows and which of its calls run. A part
// is mounted once, the first time it shows, and updated each draw it shows after. A `when` or a call that throws is a
// bug: the part fails, shows "This section failed to load" and runs nothing more until a reload. A part whose `when`
// threw before it ever showed is never mounted. src/app.js keeps each part's place and moves it only by `panelDrawn`.

/** Where a part is: `asked` until it first shows, `live` once mounted, `failed` once its `when` or a call threw. */
export type PanelState = 'asked' | 'live' | 'failed';
export const PANEL_STATES = ['asked', 'live', 'failed'] as const satisfies readonly PanelState[];
/** What the part's `when` answered this draw: show it, hide it, or it threw. */
export type PanelSaid = 'yes' | 'no' | 'threw';
export const PANEL_SAID = ['yes', 'no', 'threw'] as const satisfies readonly PanelSaid[];
/** A call of the part's own code. */
export type PanelCall = 'mount' | 'update';
/** One draw: whether the part is on the page, the calls it runs in order, and where it is once they all return. */
export type PanelDraw = { readonly shown: boolean; readonly runs: readonly PanelCall[]; readonly to: PanelState };

const hidden = (to: PanelState): PanelDraw => ({ shown: false, runs: [], to });
const FAILED: PanelDraw = { shown: true, runs: [], to: 'failed' };
/** Each place against each answer of `when`. A failed part shows failed while its `when` does not say no. */
const TABLE: { readonly [A in PanelState]: { readonly [S in PanelSaid]: PanelDraw } } = {
  asked: { yes: { shown: true, runs: ['mount', 'update'], to: 'live' }, no: hidden('asked'), threw: FAILED },
  live: { yes: { shown: true, runs: ['update'], to: 'live' }, no: hidden('live'), threw: FAILED },
  failed: { yes: FAILED, no: hidden('failed'), threw: FAILED },
};

/** The draw of a part at `at` whose `when` answered `said`. */
export const panelDraw = (at: PanelState, said: PanelSaid): PanelDraw => TABLE[at][said];

/**
 * Where a part at `at` is after a draw whose `when` answered `said`: `ran` makes each call in order and answers false
 * when it threw; the first that throws fails the part and no call after it runs.
 */
export function panelDrawn(at: PanelState, said: PanelSaid, ran: (call: PanelCall) => boolean): PanelState {
  const d = TABLE[at][said];
  return d.runs.every(ran) ? d.to : 'failed';
}
