// Read only by tsconfig.views.json. The views are DOM code that finds elements by selector and reads event targets;
// lib.dom answers `Element` and `EventTarget` there, which carry none of the fields a view reads, so every lookup
// was an error that says nothing about a contract. Here a lookup and an event's target are a `ViewElement`: an HTML
// element with the fields of the form controls the views read. The views' calls into typed code stay fully checked.

/** An element a view found by a selector, or an event's target. */
interface ViewElement extends HTMLElement {
  value: string;
  checked: boolean;
  disabled: boolean;
  type: string;
  name: string;
  open: boolean;
  selectionStart: number | null;
  selectionEnd: number | null;
  select(): void;
  setSelectionRange(start: number | null, end: number | null): void;
  readonly elements: HTMLFormControlsCollection;
  /** The page shows a number as its text: `el.textContent = n` is how the views write one. */
  get textContent(): string;
  set textContent(value: string | number | null);
}

/** A form a view reads its controls from by name (`form.job.value`, `form.elements.dst.value`): what a lookup by a
 * selector that starts with `form` answers. A form's own `name`, `type` and `title` are shadowed by controls of that
 * name, so here they are controls too. */
type ViewForm = Omit<ViewElement, 'name' | 'type' | 'title' | 'elements'> & { [control: string]: ViewElement } & {
  readonly elements: HTMLFormControlsCollection & { [control: string]: ViewElement };
  reset(): void;
  requestSubmit(): void;
};

/** The values the views keep on an element between redraws. */
interface HTMLElement {
  /** The HTML last written, so a redraw with the same HTML is skipped (hunter.js, custom.js). */
  _h?: string;
  /** A toast's or a button label's timer (ui.js, room.js). */
  _t?: ReturnType<typeof setTimeout>;
  /** A held toast's write, run as it ends unless Undo dropped it (ui.js `toast`'s `hold`). */
  _act?: (() => void) | null;
  /** A gate card's signature: the card is rebuilt when it changes (gates.js). */
  _sig?: string;
  /** The Gates view's redraw and its "open this gate's panel" (gates.js). */
  _render?: () => void;
  _open?: (id: string, mode: string) => void;
}

/** An event a view hears: every field of the events the views listen to, and a `ViewElement` target. */
interface ViewEvent extends KeyboardEvent, PointerEvent {
  readonly target: ViewElement;
  readonly currentTarget: ViewElement;
}

/** A submit event: its target is the form. */
interface ViewSubmitEvent extends SubmitEvent {
  readonly target: ViewForm;
}

interface ParentNode {
  /** A selector that starts with `form` finds a form. */
  querySelector(selectors: `form${string}`): ViewForm | null;
  querySelector(selectors: string): ViewElement | null;
  querySelectorAll(selectors: string): NodeListOf<ViewElement>;
}

interface Element {
  closest(selectors: `form${string}`): ViewForm | null;
  closest(selectors: string): ViewElement | null;
  readonly children: HTMLCollectionOf<ViewElement>;
  readonly firstElementChild: ViewElement | null;
  readonly lastElementChild: ViewElement | null;
}

interface DocumentFragment {
  readonly firstElementChild: ViewElement | null;
}

interface Element {
  /** An attribute's value is text; a number or a boolean is written as its text (`aria-expanded`, `width`). */
  setAttribute(qualifiedName: string, value: string | number | boolean): void;
}

interface Document {
  readonly activeElement: ViewElement | null;
  getElementById(elementId: string): ViewElement | null;
}

interface Window {
  /** Safari before 14.1. */
  webkitAudioContext?: typeof AudioContext;
  /** The app, for the browser tests (app.js). */
  hunterApp?: import('../../src/views/app.ts').App;
}

type ViewListener = (ev: ViewEvent) => void;
interface HTMLElement {
  addEventListener(type: 'submit', listener: (ev: ViewSubmitEvent) => void, options?: boolean | AddEventListenerOptions): void;
  addEventListener(type: string, listener: ViewListener, options?: boolean | AddEventListenerOptions): void;
}
interface Document { addEventListener(type: string, listener: ViewListener, options?: boolean | AddEventListenerOptions): void }
interface Window { addEventListener(type: string, listener: ViewListener, options?: boolean | AddEventListenerOptions): void }
