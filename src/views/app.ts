// The app object `src/app.js` builds and hands to each module's `register(app)`. A view names it in one JSDoc line,
// `/** @param {import('./app.ts').App} app */`, and tsconfig.views.json checks the view's calls against it.
// It lives with the views, not next to `AppApi` in core: it holds the store and the windows (views/ui.js), which core
// may not import. src/edge/sync.ts is registered like a view and takes the same type.

import type { AppApi } from '../core/api.ts';
import type { Rules } from '../core/rules.ts';
import type { Seat } from '../core/role.ts';
import type { RULES } from '../edge/rules.ts';
import type { Bus } from '../edge/bus.ts';
import type { store } from '../edge/store.ts';
import type * as Ui from './ui.js';

/** A screen: one entry in the nav. `mount` runs once with the view's element, `update` after each change while shown. */
export type ViewDef = {
  id: string; label: string; icon?: string; order?: number; gmOnly?: boolean; when?: () => boolean;
  mount?(el: HTMLElement): void; update?(el: HTMLElement): void;
};
/** A panel under a view's main part. */
export type PanelDef = {
  id: string; view: string; title?: string; order?: number; gmOnly?: boolean; when?: () => boolean;
  /** The label of this panel's chip in its view's row of jumps (`App.jumps`); absent, the panel has none. */
  jump?: string;
  mount?(el: HTMLElement): void; update?(el: HTMLElement): void;
};
/** What a view or a panel gets for each field it leaves out: listed at order 50, for everyone, always shown. */
export const VIEW_DEFAULTS = { order: 50, gmOnly: false, when: (): boolean => true, icon: '◆' } satisfies Partial<ViewDef>;
export const PANEL_DEFAULTS = { order: 50, gmOnly: false, when: (): boolean => true } satisfies Partial<PanelDef>;

/** A keyboard shortcut. `view`: only while that view is shown. */
export type KeyDef = {
  key: string; label: string; group?: string; view?: string; gmOnly?: boolean; when?: () => boolean;
  run(e: KeyboardEvent): void;
};

export type App = Bus & {
  store: typeof store;
  rules(): Rules;
  RULES: typeof RULES;
  ui: typeof Ui;
  /** What each module registered (`MODULES` in app.js). A read of a name no module registered throws (src/edge/api-table.ts). */
  api: AppApi;
  registerView(v: ViewDef): void;
  registerPanel(p: PanelDef): void;
  /** The chips of view `view`'s row of jumps: each panel shown there that has a `jump`, in the order the view draws its panels. */
  jumps(view: string): { label: string; id: string }[];
  /** Goes to a view: a tap on a tab, a link, a flow that ends on another screen. Never a redraw: a tab tapped before its `hashchange` would be undone. */
  go(id: string): void;
  /** Draws the shown view, its panels and the header again in the next frame, for a change outside the save (a room doc, a view's own memory). */
  redraw(): void;
  /** Whether this phone is the GM: in a room its seat, alone what it chose (`roleOf` in src/core/role.ts). For GM tools. */
  isGM(): boolean;
  /** Where this phone sits: alone, the room's GM or a player in it (`seatOf` in src/core/role.ts). For anything that depends on a room. */
  seat(): Seat;
  layout: { desktop(): boolean; wide(): boolean };
  keys: { add(def: KeyDef): () => void; list(): { key: string; label: string; group: string }[] };
  /** The build id, set by src/edge/sync.ts. */
  build?: string;
};
